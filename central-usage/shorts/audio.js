/* Shorts - reading the recording with ffmpeg (the copy that comes with Central Control):
 *   probe(file)                       how long it is, whether it has picture and sound, the picture's size
 *   analyze(file, opts)               the sound in 0.1 s steps: level (dB), spectral flatness, zero crossings - read as a
 *                                     stream, so a two-hour service never sits in memory
 *   pcm(file, start, dur)             16 kHz mono samples of one stretch (for the speech model)
 *   envelope(file, rate)              the level only, at `rate` per second (to line the camera recording up with the sound)
 *   align(a, b, rate, maxLag)         how many seconds b starts after a (by matching their levels)
 *   motion(file, start, dur)          where the movement is across the picture over time (to keep the speaker in frame) */
"use strict";
const { spawn } = require("node:child_process");

function run(bin, args, onData, opts) {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true, cwd: opts && opts.cwd });
    if (opts && opts.low) lowPriority(p.pid);
    let err = "";
    p.stdout.on("data", (b) => { if (onData) onData(b); });
    p.stderr.on("data", (b) => { err = (err + b).slice(-8000); });
    p.on("error", reject);
    p.on("close", (code) => resolve({ code, err }));
    if (opts && opts.signal) opts.signal.onabort = () => { try { p.kill(); } catch (_) { } };
  });
}
function lowPriority(pid) { try { require("node:os").setPriority(pid, 19); } catch (_) { } }

async function probe(bin, file) {
  const r = await run(bin, ["-hide_banner", "-i", file], null);
  const t = r.err, d = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(t);
  const v = /Stream #\S+.*Video: [^\n]*?(\d{2,5})x(\d{2,5})/.exec(t);
  return { duration: d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0, video: v ? { w: Number(v[1]), h: Number(v[2]) } : null, audio: /Stream #\S+.*Audio:/.test(t) };
}

// a small radix-2 FFT (in place), for the flatness of each step
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const a = i + k, b = a + len / 2, xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr; re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
  }
}

/* the features, in steps of hop seconds (16 kHz mono from ffmpeg). progress(seconds read) */
async function analyze(bin, file, opts) {
  const o = Object.assign({ hop: 0.1, start: 0, dur: 0 }, opts || {}), SR = 16000, step = Math.round(SR * o.hop), N = 512;
  const rms = [], flat = [], zcr = [];
  const win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
  const re = new Float64Array(N), im = new Float64Array(N);
  let carry = Buffer.alloc(0), frame = new Float32Array(step), fill = 0, done = 0;
  const one = () => {
    let sq = 0, zc = 0; for (let i = 0; i < step; i++) { const v = frame[i]; sq += v * v; if (i && (v >= 0) !== (frame[i - 1] >= 0)) zc++; }
    rms.push(10 * Math.log10(sq / step + 1e-10)); zcr.push(zc / step);
    // flatness: geometric over arithmetic mean of the power spectrum (noise ~1, a note ~0)
    const off = Math.max(0, Math.floor((step - N) / 2)); for (let i = 0; i < N; i++) { re[i] = (frame[off + i] || 0) * win[i]; im[i] = 0; }
    fft(re, im); let lg = 0, ar = 0; const K = N / 2; for (let k = 1; k < K; k++) { const p = re[k] * re[k] + im[k] * im[k] + 1e-12; lg += Math.log(p); ar += p; }
    flat.push(Math.exp(lg / (K - 1)) / (ar / (K - 1)));
    done++; if (o.progress && done % 600 === 0) o.progress(done * o.hop);
  };
  const args = ["-hide_banner", "-loglevel", "error"].concat(o.start ? ["-ss", String(o.start)] : [], ["-i", file], o.dur ? ["-t", String(o.dur)] : [], ["-vn", "-ac", "1", "-ar", String(SR), "-f", "f32le", "pipe:1"]);
  const r = await run(bin, args, (b) => {
    const buf = carry.length ? Buffer.concat([carry, b]) : b; const whole = buf.length - (buf.length % 4);
    for (let p = 0; p < whole; p += 4) { frame[fill++] = buf.readFloatLE(p); if (fill === step) { one(); fill = 0; } }
    carry = buf.subarray(whole);
  }, { low: true, signal: o.signal });
  if (r.code !== 0 && !rms.length) throw new Error("ffmpeg couldn't read " + file + ": " + r.err.trim().split("\n").pop());
  const f = { hop: o.hop, rms: Float32Array.from(rms), flat: Float32Array.from(flat), zcr: Float32Array.from(zcr), dur: rms.length * o.hop };
  const sorted = Array.from(f.rms).sort((a, b) => a - b); f.floor = sorted[Math.floor(sorted.length * 0.1)] || -80;
  return f;
}

async function pcm(bin, file, start, dur, signal) {
  const parts = []; let len = 0;
  const r = await run(bin, ["-hide_banner", "-loglevel", "error", "-ss", String(Math.max(0, start)), "-i", file, "-t", String(dur), "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "pipe:1"], (b) => { parts.push(b); len += b.length; }, { low: true, signal });
  if (r.code !== 0 && !len) throw new Error("ffmpeg couldn't read " + file);
  const buf = Buffer.concat(parts, len), out = new Float32Array(Math.floor(len / 4));
  for (let i = 0; i < out.length; i++) out[i] = buf.readFloatLE(i * 4);
  return out;
}

async function envelope(bin, file, rate) {
  const SR = 8000, step = Math.round(SR / rate), out = []; let carry = Buffer.alloc(0), sq = 0, n = 0;
  await run(bin, ["-hide_banner", "-loglevel", "error", "-i", file, "-vn", "-ac", "1", "-ar", String(SR), "-f", "f32le", "pipe:1"], (b) => {
    const buf = carry.length ? Buffer.concat([carry, b]) : b; const whole = buf.length - (buf.length % 4);
    for (let p = 0; p < whole; p += 4) { const v = buf.readFloatLE(p); sq += v * v; if (++n === step) { out.push(10 * Math.log10(sq / n + 1e-10)); sq = 0; n = 0; } }
    carry = buf.subarray(whole);
  }, { low: true });
  return Float32Array.from(out);
}

/* the lag (seconds) that lines b up with a: b's moment 0 is a's moment `lag`. Pearson correlation of the two level curves */
function align(a, b, rate, maxLagSec) {
  const maxLag = Math.round((maxLagSec || 900) * rate);
  const z = (x) => { let m = 0; for (const v of x) m += v; m /= x.length || 1; let s = 0; for (const v of x) s += (v - m) * (v - m); s = Math.sqrt(s / (x.length || 1)) || 1; return Float32Array.from(x, (v) => (v - m) / s); };
  const A = z(a), B = z(b); let best = 0, bestC = -Infinity;
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    let c = 0, n = 0;
    const i0 = Math.max(0, lag), j0 = i0 - lag, len = Math.min(A.length - i0, B.length - j0);
    if (len < rate * 20) continue;
    for (let k = 0; k < len; k += 2) { c += A[i0 + k] * B[j0 + k]; n++; }
    c /= n; if (c > bestC) { bestC = c; best = lag; }
  }
  return { lag: best / rate, confidence: bestC };
}

/* movement across the picture: [{ t, x 0..1 (centre of movement), mass 0..1 }] at `fps` */
async function motion(bin, file, start, dur, fps) {
  fps = fps || 4; const W = 96, H = 54, size = W * H, out = []; let carry = Buffer.alloc(0), prev = null, k = 0;
  await run(bin, ["-hide_banner", "-loglevel", "error", "-ss", String(Math.max(0, start)), "-i", file, "-t", String(dur), "-an", "-vf", "fps=" + fps + ",scale=" + W + ":" + H + ",format=gray", "-f", "rawvideo", "pipe:1"], (b) => {
    let buf = carry.length ? Buffer.concat([carry, b]) : b;
    while (buf.length >= size) {
      const fr = buf.subarray(0, size);
      if (prev) {
        let tot = 0, wx = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const d = Math.abs(fr[y * W + x] - prev[y * W + x]); if (d > 12) { tot += d; wx += d * x; } }
        out.push({ t: k / fps, x: tot ? (wx / tot) / (W - 1) : 0.5, mass: Math.min(1, tot / (size * 40)) });
      }
      prev = Buffer.from(fr); k++; buf = buf.subarray(size);
    }
    carry = Buffer.from(buf);
  }, { low: true });
  return out;
}

/* a smooth path for the 9:16 window from the movement: holds still unless the speaker moves away (a dead zone), eases
 * over; [{ t, x 0..1 }] at half-second steps. Too little movement anywhere: null (use the centre / blurred wide shot) */
function cropPath(mv, dur, cropFrac) {
  if (!mv.length) return null;
  const moving = mv.filter((m) => m.mass > 0.002);
  if (moving.length < mv.length * 0.25) return null;
  const half = cropFrac / 2, pts = []; let cur = null;
  for (let t = 0; t <= dur + 0.01; t += 0.5) {
    const near = mv.filter((m) => Math.abs(m.t - t) <= 1.5 && m.mass > 0.002);
    let target = near.length ? near.reduce((s, m) => s + m.x * m.mass, 0) / near.reduce((s, m) => s + m.mass, 0) : cur == null ? 0.5 : cur;
    if (cur == null) cur = target;
    if (Math.abs(target - cur) > half * 0.45) cur += (target - cur) * 0.35;   // only when the speaker leaves the middle of the frame
    cur = Math.max(half, Math.min(1 - half, cur));
    pts.push({ t: Math.round(t * 100) / 100, x: Math.round(cur * 1000) / 1000 });
  }
  return pts;
}

module.exports = { run, probe, analyze, pcm, envelope, align, motion, cropPath, fft, lowPriority };
