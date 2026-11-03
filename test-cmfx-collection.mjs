// The Central FX collection (10.3) and the engine's quality.  node test-cmfx-collection.mjs
//   1. every plugin in production/plugin-collection loads, makes sound, stays finite and sensible in level, sounds the
//      same native and in WebAssembly, and every one of its starting points does too; the families each have a free one;
//      the generated cmfx-collection.js matches the folder;
//   2. it's light enough for the Central Pedal: the native CPU time of each plugin, per second of sound, under a budget
//      (BUDGET_PCT of one core of this machine; a Pi 4 core is about 4x slower for this kind of code);
//   3. the engine against reference behaviour: oversampled drive aliasing, the pitch shift's purity and steadiness, the
//      reverb's decay time and density, the compressor's static curve (knee) and the opto release, the true-peak
//      limiter's ceiling between samples, and the crossover bands adding back up flat.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url)), src = path.join(root, "central-usage", "native", "cmfx"), dir = path.join(root, "production", "plugin-collection");
const require = createRequire(import.meta.url), CMFx = require(path.join(root, "production/cmfx/cmfx.js"));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cmfx-coll-"));
const BUDGET_PCT = Number(process.env.CMFX_BUDGET_PCT || 3.5);
let failures = 0;
const ok = (m) => console.log("  ✓ " + m), bad = (m) => { failures++; console.error("  ✗ " + m); };
const check = (c, m) => (c ? ok(m) : bad(m));

const cli = path.join(tmp, "cmfx-cli" + (process.platform === "win32" ? ".exe" : ""));
const b = spawnSync(process.env.CC || "cc", ["-O2", "-ffp-contract=off", "-o", cli, ...["cmfx-cli.c", "cmfx.c", "cmfx_code.c", "cmfx_util.c"].map((f) => path.join(src, f)), "-lm"], { encoding: "utf8" });
if (b.status !== 0) { bad("the C core builds: " + (b.stderr || b.error)); process.exit(1); }

const SR = 48000;
// music-like test sound: plucked notes, a chord, noise bursts, a click, then silence for the tails
function signal(secs) {
  const N = Math.round(SR * secs), L = new Float32Array(N), R = new Float32Array(N); let s = 3;
  const rnd = () => { s = (s * 1103515245 + 12345) >>> 0; return (s / 4294967296) * 2 - 1; };
  const notes = [110, 165, 220, 277, 330, 440, 554, 660];
  notes.forEach((f, k) => { const at = Math.round(k * 0.18 * SR); for (let i = 0; i < SR * 0.6 && at + i < N; i++) { const t = i / SR, e = Math.exp(-t * 5); const v = 0.35 * e * (Math.sin(6.2832 * f * t) + 0.4 * Math.sin(12.566 * f * t) + 0.2 * Math.sin(18.85 * f * t)); L[at + i] += v; R[at + i] += v * 0.85; } });
  for (let i = Math.round(1.5 * SR); i < Math.min(N, 2.1 * SR); i++) { const t = i / SR; const v = 0.12 * (Math.sin(6.2832 * 196 * t) + Math.sin(6.2832 * 247 * t) + Math.sin(6.2832 * 294 * t)); L[i] += v; R[i] += v; }
  for (let i = Math.round(2.2 * SR); i < Math.min(N, 2.4 * SR); i++) { L[i] += 0.3 * rnd(); R[i] += 0.3 * rnd(); }
  if (N > 2.5 * SR) L[Math.round(2.5 * SR)] += 0.9;
  return { L, R, N };
}
const SIG = signal(4);
function writeIn(sig, f) { const a = new Float32Array(sig.N * 2); for (let i = 0; i < sig.N; i++) { a[2 * i] = sig.L[i]; a[2 * i + 1] = sig.R[i]; } fs.writeFileSync(f, Buffer.from(a.buffer)); }
writeIn(SIG, path.join(tmp, "in.f32"));
function native(pl, values, inFile, N) {
  const pf = path.join(tmp, "p.cmfx.json"), out = path.join(tmp, "out.f32"); fs.writeFileSync(pf, JSON.stringify(pl));
  const r = spawnSync(cli, ["render", pf, String(SR), inFile || path.join(tmp, "in.f32"), out, "128", ...Object.entries(values || {}).map(([k, v]) => k + "=" + v)], { encoding: "utf8", env: Object.assign({}, process.env, { CMFX_TIME: "1" }), timeout: 120000 });
  if (r.status !== 0) return { error: (r.stdout || "") + (r.stderr || "") };
  const f = new Float32Array(new Uint8Array(fs.readFileSync(out)).buffer), n = N || SIG.N, L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { L[i] = f[2 * i]; R[i] = f[2 * i + 1]; }
  const m = /cpu: ([\d.]+) ms for ([\d.]+) s/.exec(r.stderr || ""); return { L, R, cpu: m ? +m[1] / (+m[2] * 1000) * 100 : null };
}
const wasm = (pl, values, sig) => { const s = sig || SIG, r = CMFx.render(pl, SR, s.L, s.R, values); return r.error ? { error: r.error } : { L: r.left, R: r.right }; };
const rms = (a, from, to) => { let e = 0; from = from || 0; to = to || a.length; for (let i = from; i < to; i++) e += a[i] * a[i]; return Math.sqrt(e / Math.max(1, to - from)); };
const peak = (a) => { let p = 0; for (const x of a) p = Math.max(p, Math.abs(x)); return p; };
const finite = (a) => a.every(Number.isFinite);
const diff = (a, b2) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b2[i])); return m; };
const db = (x) => 20 * Math.log10(Math.max(1e-12, x));

const QUALITY_ONLY = !!process.env.CMFX_QUALITY_ONLY;
console.log("Central FX collection:");
// ---- 1. every plugin
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".cmfx.json")).sort(), all = files.map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
check(all.length >= 30, all.length + " plugins in the collection (" + all.filter((p) => p.tier === "free").length + " free, " + all.filter((p) => p.tier === "plugins").length + " with Central Plugins)");
const fams = [...new Set(all.map((p) => p.family))];
check(fams.every((f) => all.some((p) => p.family === f && p.tier === "free") || ["saturation", "stereo"].includes(f)), "the basic one of each main family is free (" + fams.map((f) => f + ": " + all.filter((p) => p.family === f && p.tier === "free").map((p) => p.name).join("/")).join(", ") + ")");
const coll = fs.readFileSync(path.join(root, "js/cmfx-collection.js"), "utf8");
check(all.every((p) => coll.includes('"id":"' + p.id + '"')) && (coll.match(/"format":"central-fx"/g) || []).length === all.length, "js/cmfx-collection.js has exactly the collection (else run tools/build-cmfx.sh)");
let worstCpu = 0, worstName = "", worstDiff = 0;
for (const p of QUALITY_ONLY ? [] : all) {
  const c = CMFx.check(p);
  if (!c.ok) { bad(p.name + ": " + c.error); continue; }
  const n = native(p), w = wasm(p);
  if (n.error || w.error) { bad(p.name + ": " + (n.error || w.error)); continue; }
  const d = Math.max(diff(n.L, w.L), diff(n.R, w.R)), lin = rms(SIG.L, 0, 2.5 * SR), lout = rms(n.L, 0, 2.5 * SR), pk = Math.max(peak(n.L), peak(n.R));
  worstDiff = Math.max(worstDiff, d); if (n.cpu > worstCpu) { worstCpu = n.cpu; worstName = p.name; }
  const lvl = db(lout / lin), problems = [];
  if (d > 1e-4) problems.push("native vs WebAssembly differ by " + d.toExponential(2));
  if (!finite(n.L) || !finite(n.R)) problems.push("not finite");
  if (lout < 1e-4) problems.push("silent");
  if (pk > 4) problems.push("peak " + pk.toFixed(2));
  if (lvl < -20 || lvl > 14) problems.push("level " + lvl.toFixed(1) + " dB from the input");
  if (n.cpu > BUDGET_PCT) problems.push("CPU " + n.cpu.toFixed(2) + "% of a core");
  if (!p.description || !p.presets || p.presets.length < 3 || !p.params.length) problems.push("needs a description, knobs and 3+ starting points");
  for (const pr of p.presets || []) {
    const pn = native(p, pr.values), pw = wasm(p, pr.values);
    if (pn.error || pw.error || !finite(pn.L) || peak(pn.L) > 6 || rms(pn.L) < 1e-5 || Math.max(diff(pn.L, pw.L), diff(pn.R, pw.R)) > 1e-4) problems.push("starting point \"" + pr.name + "\" " + (pn.error || pw.error || "misbehaves"));
  }
  if (problems.length) bad(p.name + ": " + problems.join("; "));
  else ok(p.name + " (" + p.tier + "): loads, plays (" + (lvl >= 0 ? "+" : "") + lvl.toFixed(1) + " dB, peak " + pk.toFixed(2) + "), " + p.presets.length + " starting points, native = WebAssembly, " + n.cpu.toFixed(2) + "% CPU");
}
if (!QUALITY_ONLY) check(worstCpu <= BUDGET_PCT, "light enough for the Pi: the heaviest (" + worstName + ") takes " + worstCpu.toFixed(2) + "% of one core here, under " + BUDGET_PCT + "% (about " + (worstCpu * 4).toFixed(0) + "% of a Pi 4 core)");

// ---- 3. quality against reference behaviour
console.log("The engine's quality:");
const one = (blocks, wires, params) => ({ format: "central-fx", version: 1, name: "t", params: params || [], graph: { blocks: [{ id: "in", type: "input" }, ...blocks, { id: "out", type: "output" }], wires } });
const chain1 = (type, props) => one([{ id: "x", type, props }], [{ from: "in", to: "x" }, { from: "x", to: "out" }]);
const sine = (f, a, secs, phase) => { const N = Math.round(SR * secs), L = new Float32Array(N); for (let i = 0; i < N; i++) L[i] = a * Math.sin(2 * Math.PI * f * i / SR + (phase || 0)); return { L, R: L, N }; };
function dft(x, f, from, n) { let re = 0, im = 0; for (let i = 0; i < n; i++) { const w = 2 * Math.PI * f * i / SR; re += x[from + i] * Math.cos(w); im -= x[from + i] * Math.sin(w); } return Math.sqrt(re * re + im * im) * 2 / n; }
{   // drive: aliasing with and without oversampling (7 kHz into a hard tanh: everything not a harmonic is aliasing)
  const s = sine(7000, 0.8, 1), from = SR / 2, n = 9600;   // (bins every 5 Hz)
  const alias = (os) => { const o = wasm(chain1("drive", { mode: "soft", drive: 12, tone: 20000, level: 0, mix: 1, oversample: os }), {}, s).L; let ha = 0, al = 0;
    for (let f = 500; f < 23500; f += 500) { const a = dft(o, f, from, n); if (f % 7000 === 0) ha += a * a; else al += a * a; } return 10 * Math.log10(al / ha); };
  const a1 = alias(1), a4 = alias(4);
  check(a4 < a1 - 20 && a4 < -40, "drive oversampled 4x: aliasing " + a4.toFixed(1) + " dB below the harmonics, against " + a1.toFixed(1) + " dB without (" + (a1 - a4).toFixed(0) + " dB cleaner)");
}
{   // pitch shift: +12 on a steady 330 Hz tone: the energy at 660 Hz, and how steady its level is (the old 2-grain shifter, for comparison, in JS)
  const s = sine(330, 0.5, 2), o = wasm(chain1("pitch", { semitones: 12, mix: 1, window: 60 }), {}, s).L, from = SR, n = SR / 2;
  const want = dft(o, 660, from, n), tot = rms(o, from, from + n) * Math.SQRT2, purity = db(want / tot);
  const env = []; for (let k = 0; k < 40; k++) env.push(rms(o, from + k * 600, from + (k + 1) * 600)); const ripple = db(Math.max(...env) / Math.min(...env));
  // the 10.2 shifter: two taps, a raised-cosine crossfade
  const W = 0.06 * SR, len = Math.round(W * 1.2) + 8, buf = new Float32Array(len), old = new Float32Array(s.N); let pos = 0, ph = 0;
  const rd = (d) => { d = Math.min(Math.max(d, 0), len - 3); const di = Math.floor(d), fr = d - di; let i0 = pos - 1 - di; while (i0 < 0) i0 += len; let i1 = i0 - 1; if (i1 < 0) i1 += len; return buf[i0] + (buf[i1] - buf[i0]) * fr; };
  for (let i = 0; i < s.N; i++) { buf[pos] = s.L[i]; pos = (pos + 1) % len; ph += (1 - 2) / W; ph -= Math.floor(ph); const p2 = (ph + 0.5) % 1, g1 = 0.5 - 0.5 * Math.cos(2 * Math.PI * ph); old[i] = g1 * rd(ph * W) + (1 - g1) * rd(p2 * W); }
  const oenv = []; for (let k = 0; k < 40; k++) oenv.push(rms(old, from + k * 600, from + (k + 1) * 600)); const oldRipple = db(Math.max(...oenv) / Math.min(...oenv));
  check(purity > -1.5 && ripple < oldRipple, "pitch +12: " + (100 * Math.pow(10, purity / 10)).toFixed(0) + "% of the energy on the octave, level steady within " + ripple.toFixed(1) + " dB (the 10.2 shifter: " + oldRipple.toFixed(1) + " dB)");
}
{   // reverb: the decay time follows Size (0.25 s x 48^size), and the response is dense (no gaps)
  const imp = { L: new Float32Array(SR * 8), R: new Float32Array(SR * 8), N: SR * 8 }; imp.L[100] = 1; imp.R[100] = 1;
  const res = [];
  for (const size of [0.3, 0.6]) {
    const o = wasm(chain1("reverb", { size, mix: 1, damp: 0, predelay: 0, mod: 0.4 }), {}, imp).L, e = new Float64Array(o.length);
    let acc = 0; for (let i = o.length - 1; i >= 0; i--) { acc += o[i] * o[i]; e[i] = acc; }   // Schroeder
    const at = (dB) => { for (let i = 0; i < e.length; i++) if (10 * Math.log10(e[i] / e[0]) < dB) return i / SR; return e.length / SR; };
    const rt = (at(-25) - at(-5)) * 3, want = 0.25 * Math.pow(48, size);
    let nz = 0; for (let i = Math.round(0.05 * SR); i < 0.1 * SR; i++) if (Math.abs(o[i]) > 1e-6) nz++;
    res.push({ size, rt, want, dens: nz / (0.05 * SR) });
  }
  check(res.every((r) => Math.abs(r.rt / r.want - 1) < 0.35 && r.dens > 0.97), "reverb: decay " + res.map((r) => "size " + r.size + " -> " + r.rt.toFixed(2) + " s (aim " + r.want.toFixed(2) + ")").join(", ") + "; " + (100 * Math.min(...res.map((r) => r.dens))).toFixed(0) + "% of samples busy after 50 ms");
}
{   // compressor: the static curve against the textbook soft knee (threshold -20, ratio 4, knee 10), and the opto release
  const curve = (lvl, style) => { const s = sine(1000, Math.pow(10, lvl / 20), 0.6); const o = wasm(chain1("compressor", { threshold: -20, ratio: 4, knee: 10, attack: 1, release: 50, style: style || "clean" }), {}, s).L; return db(peak(o.subarray(SR * 0.4))); };
  const ideal = (x) => { const o = x + 20; if (2 * o < -10) return x; if (2 * o > 10) return -20 + o / 4; return x + (1 / 4 - 1) * (o + 5) * (o + 5) / 20; };
  let worst = 0; for (const lvl of [-40, -30, -25, -22, -20, -18, -15, -10, -5, 0]) worst = Math.max(worst, Math.abs(curve(lvl) - ideal(lvl)));
  check(worst < 0.5, "compressor: the static curve through the soft knee is within " + worst.toFixed(2) + " dB of the textbook curve");
  // opto: after a long hard push it lets go more slowly than after a short one
  const burst = (secs) => { const N = SR * (secs + 1.5), L = new Float32Array(N); for (let i = 0; i < N; i++) L[i] = (i < secs * SR ? 0.9 : 0.1) * Math.sin(2 * Math.PI * 500 * i / SR); return { L, R: L, N }; };
  const recover = (secs) => { const s = burst(secs), o = wasm(chain1("compressor", { style: "opto", threshold: -30, ratio: 6, release: 80 }), {}, s).L, at = Math.round((secs + 0.15) * SR); return db(peak(o.subarray(at, at + 2400)) / 0.1); };
  const shortR = recover(0.1), longR = recover(1.5);
  check(longR < shortR - 1, "opto style: 150 ms after a 1.5 s push it still holds " + (-longR).toFixed(1) + " dB of reduction, after a 0.1 s push only " + (-shortR).toFixed(1) + " dB (programme-dependent release)");
}
{   // true-peak limiter: a tone whose samples miss its crests (fs/4, 45 degrees): the crests between samples stay under the ceiling
  const s = sine(SR / 4, 1.4, 1, Math.PI / 4);
  const up4 = (x) => { const y = new Float32Array(x.length * 4); for (let i = 0; i < x.length; i++) for (let k = 0; k < 4; k++) { let a = 0; for (let j = -16; j <= 16; j++) { const t = j - k / 4, v = x[i + j] || 0; a += v * (t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t)) * (0.5 + 0.5 * Math.cos(Math.PI * t / 17)); } y[i * 4 + k] = a; } return y; };
  const tp = (o) => db(peak(up4(o.subarray(SR / 2, SR / 2 + 4800))));
  const plain = tp(wasm(chain1("limiter", { ceiling: -1 }), {}, s).L), truep = tp(wasm(chain1("limiter", { ceiling: -1, detect: "truepeak", lookahead: 5 }), {}, s).L);
  check(truep <= -0.8 && plain > truep + 0.5, "true-peak limiter: " + truep.toFixed(2) + " dBTP with a -1 dB ceiling (the sample-peak limiter lets " + plain.toFixed(2) + " dBTP through)");
  const L = new Float32Array(SR), tr = { L, R: L, N: SR }; for (let i = 0; i < SR; i++) L[i] = (i > SR / 2 && i < SR / 2 + 30 ? 1.5 : 0.2) * Math.sin(i * 0.03);
  const lo = wasm(chain1("limiter", { ceiling: -1, detect: "truepeak", lookahead: 5 }), {}, tr).L;
  check(peak(lo) <= 0.8913 + 1e-4, "look-ahead: a sudden peak is caught before it arrives (peak " + db(peak(lo)).toFixed(2) + " dBFS)");
}
{   // crossover: low + mid + high add back up flat (an impulse's spectrum)
  const N = 16384, imp = { L: new Float32Array(N), R: new Float32Array(N), N }; imp.L[0] = 1; imp.R[0] = 1;
  const sum = new Float32Array(N); for (const band of ["low", "mid", "high"]) { const o = wasm(chain1("crossover", { band, low: 250, high: 3000 }), {}, imp).L; for (let i = 0; i < N; i++) sum[i] += o[i]; }
  let lo = 0, hi = -99; for (const f of [40, 100, 250, 600, 1500, 3000, 6000, 12000, 18000]) { const a = db(dft(sum, f, 0, N) * N / 2); lo = Math.min(lo, a); hi = Math.max(hi, a); }
  check(hi - lo < 0.2 && Math.abs(hi) < 0.2, "crossover: the three bands add back to within " + (hi - lo).toFixed(2) + " dB of flat from 40 Hz to 18 kHz");
}
check(worstDiff <= 1e-4, "native and WebAssembly agree on every plugin (largest difference " + worstDiff.toExponential(2) + ")");
fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures ? "\n" + failures + " FAILED" : "\nall passed");
process.exit(failures ? 1 : 0);
