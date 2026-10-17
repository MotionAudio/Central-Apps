// Unit test of the cu-mixer engine on its own (no app, no ports): the null backend, several devices
// combined into one set of inputs / outputs, the 64 stereo mixes and the per-mix wired outputs,
// talkback (an interface input or a network mic into chosen mixes, the music dimmed), multitrack recording
// (24-bit WAVs, one per source, plus the stereo program) and the repair of files left by a crash.
//   node native/test-mixer.mjs [path/to/cu-mixer]
import { spawn, spawnSync } from "node:child_process";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const bin = process.argv[2] || path.join(here, "build", "cu-mixer" + (process.platform === "win32" ? ".exe" : ""));

function engine(args) {
  const p = spawn(bin, args, { stdio: ["pipe", "pipe", "inherit"] });
  let buf = Buffer.alloc(0); const events = []; const waiters = []; const taps = {};
  p.stdout.on("data", (c) => {
    buf = Buffer.concat([buf, c]);
    while (buf.length >= 5) {
      const n = buf.readUInt32LE(1); if (buf.length < 5 + n) break;
      const t = String.fromCharCode(buf[0]), body = buf.subarray(5, 5 + n); buf = buf.subarray(5 + n);
      if (t === "J") { const e = JSON.parse(body.toString("utf8")); events.push(e); waiters.slice().forEach((w) => { if (w.test(e)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(e); } }); }
      else if (t === "A") { const tap = body[0]; taps[tap] = (taps[tap] || 0) + 1; }
    }
  });
  const cmd = (o) => { const b = Buffer.from(JSON.stringify(o)), h = Buffer.alloc(5); h[0] = 74; h.writeUInt32LE(b.length, 1); p.stdin.write(Buffer.concat([h, b])); };
  // network audio in: u8 source, u8 channels, u16 frames, int16 interleaved
  const net = (source, ch, frames, pcm) => { const h = Buffer.alloc(9); h[0] = 78; h.writeUInt32LE(4 + pcm.length, 1); h[5] = source; h[6] = ch; h.writeUInt16LE(frames, 7); p.stdin.write(Buffer.concat([h, pcm])); };
  const wait = (test, ms = 8000) => new Promise((resolve, reject) => { const hit = events.find((e) => !e._used && test(e)); if (hit) { hit._used = true; return resolve(hit); } const w = { test: (e) => !e._used && test(e) && (e._used = true), resolve }; waiters.push(w); setTimeout(() => reject(new Error("timeout waiting for event")), ms); });
  const meters = async (pred, ms = 6000) => { const t0 = Date.now(); for (;;) { const m = await wait((e) => e.ev === "meters" && !e._seen, 3000); m._seen = true; if (pred(m)) return m; if (Date.now() - t0 > ms) return m; } };
  const exited = new Promise((r) => p.on("exit", r));
  return { p, cmd, net, wait, meters, taps, exited, quit: () => { cmd({ cmd: "quit" }); setTimeout(() => p.kill(), 800); } };
}
// a WAV written by the engine: header fields, and its samples (24 bit) as floats per channel
function readWav(file) {
  const b = fs.readFileSync(file), h = { riff: b.toString("latin1", 0, 4), wave: b.toString("latin1", 8, 12), fmt: b.readUInt16LE(20), ch: b.readUInt16LE(22), rate: b.readUInt32LE(24), byteRate: b.readUInt32LE(28), align: b.readUInt16LE(32), bits: b.readUInt16LE(34), riffSize: b.readUInt32LE(4), dataTag: b.toString("latin1", 36, 40), data: b.readUInt32LE(40), size: b.length };
  const n = Math.floor((b.length - 44) / h.align), chans = []; let odd = 0;
  for (let c = 0; c < h.ch; c++) chans.push(new Float32Array(n));
  for (let f = 0; f < n; f++) for (let c = 0; c < h.ch; c++) { const v = b.readIntLE(44 + f * h.align + c * 3, 3); if (v & 255) odd++; chans[c][f] = v / 8388607; }
  h.frames = n; h.chans = chans; h.lowBytesUsed = odd;
  h.peak = chans.map((x) => x.reduce((a, v) => Math.max(a, Math.abs(v)), 0));
  return h;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const watchdog = setTimeout(() => { console.error("\nMIXER TEST TIMED OUT (" + (globalThis.__step || "start") + ")"); process.exit(2); }, 300000); watchdog.unref && watchdog.unref();
async function check(label, fn) { globalThis.__step = label; try { await fn(); console.log("  ✓ " + label); } catch (e) { failures++; console.error("  ✗ " + label + "\n      " + (e && e.message || e)); } }

const e = engine(["--backend", "null", "--capture", "NULL#8|NULL#4", "--playback", "NULL#16|NULL#16", "--block", "256"]);
let st;
await check("status: null backend, two capture devices combined (8 + 4 inputs), two playback devices (32 outputs)", async () => {
  st = await e.wait((x) => x.ev === "status");
  assert.equal(st.backend, "null", JSON.stringify(st).slice(0, 300));
  assert.equal(st.inputs, 12); assert.equal(st.outputs, 32);
  assert.equal(st.captureDevices.length, 2); assert.equal(st.captureDevices[1].first, 8); assert.equal(st.captureDevices[0].clock, 1); assert.equal(st.captureDevices[1].clock, 0);
  assert.equal(st.max.mixes, 64);
  assert.ok(/:in_8$/.test(st.captureNames[7]) && /:in_1$/.test(st.captureNames[8]), st.captureNames.join(" "));
});
await check("a tone on the second device's first channel (input 9) reaches the meters through the drift-corrected bridge", async () => {
  e.cmd({ cmd: "input", i: 5, src: 1, ch: 8, fader: 0, pan: 0 });
  e.cmd({ cmd: "testgen", ch: 8, freq: 440, level: 0.5 });
  const m = await e.meters((x) => x.in[5] > 0.3);
  assert.ok(m.in[5] > 0.3, "input meter " + m.in[5]);
});
await check("mix 64 (the last): a send, a wired output pair on the second playback device, and a tap", async () => {
  e.cmd({ cmd: "mix", m: 63, level: 0, mute: 0, outL: 30, outR: 31, stereo: 1, tap: 1, used: 1 });
  e.cmd({ cmd: "send", m: 63, i: 5, level: 0, pan: 0, on: 1 });
  const m = await e.meters((x) => x.mix[126] > 0.2);
  assert.ok(m.mix[126] > 0.2 && m.mix[127] > 0.2, "mix 64 meters " + m.mix[126] + " / " + m.mix[127]);
  await new Promise((r) => setTimeout(r, 400));
  assert.ok(e.taps[64] > 2, "tap 64 messages: " + e.taps[64]);
});
await check("mixes 1-64 all usable at once", async () => {
  for (let m = 0; m < 64; m++) { e.cmd({ cmd: "mix", m, level: 0, mute: 0, outL: -1, outR: -1, stereo: 1, tap: 0, used: 1 }); e.cmd({ cmd: "send", m, i: 5, level: -6, pan: 0, on: 1 }); }
  const m = await e.meters((x) => { for (let k = 0; k < 64; k++) if (!(x.mix[k * 2] > 0.1)) return false; return true; });
  const silent = []; for (let k = 0; k < 64; k++) if (!(m.mix[k * 2] > 0.1)) silent.push(k + 1);
  assert.equal(silent.length, 0, "silent mixes: " + silent.join(","));
});
e.quit();

// ---- talkback: a mic into chosen mixes (an interface input, or a computer's mic over the network), the music dimmed
const t = engine(["--backend", "null", "--capture", "NULL#4", "--playback", "NULL#4", "--block", "256"]);
await t.wait((x) => x.ev === "status");
const mixPeak = (m, k) => Math.max(m.mix[k * 2], m.mix[k * 2 + 1]);
await check("talkback from an interface input: only the chosen mix hears it, at its level, on top of the music", async () => {
  t.cmd({ cmd: "testgen", ch: 0, freq: 220, level: 0.3 }); t.cmd({ cmd: "testgen", ch: 2, freq: 440, level: 0.5 });   // ch 0: the music, ch 2: the talkback mic
  t.cmd({ cmd: "input", i: 0, src: 1, ch: 0, fader: -90 });
  for (const m of [0, 1]) { t.cmd({ cmd: "mix", m, level: 0, mute: 0, outL: m * 2, outR: m * 2 + 1, stereo: 1, tap: 1, used: 1 }); t.cmd({ cmd: "send", m, i: 0, level: 0, pan: 0, on: 1 }); }
  const before = await t.meters((x) => mixPeak(x, 0) > 0.25 && mixPeak(x, 1) > 0.25);
  assert.ok(Math.abs(mixPeak(before, 0) - 0.3) < 0.03, "music alone " + mixPeak(before, 0));
  t.cmd({ cmd: "talk", slot: 0, on: 1, src: 1, ch: 2, gain: 0, dim: 0, mixes: [0] });
  const on = await t.meters((x) => mixPeak(x, 0) > 0.6 && x.talk[0] > 0.4);
  assert.ok(mixPeak(on, 0) > 0.6 && mixPeak(on, 0) < 0.85, "mix 1 with talkback " + mixPeak(on, 0));
  assert.ok(Math.abs(mixPeak(on, 1) - 0.3) < 0.03, "mix 2 doesn't hear it: " + mixPeak(on, 1));
  assert.ok(Math.abs(on.talk[0] - 0.5) < 0.06, "talk meter " + on.talk[0]);
});
await check("talkback dims the music in its mixes (-12 dB) while it talks, and lets it back up after", async () => {
  t.cmd({ cmd: "talk", slot: 0, on: 0 });
  t.cmd({ cmd: "talk", slot: 1, on: 1, src: 1, ch: 3, gain: 0, dim: -12, mixes: [1] });   // ch 3 is silent: only the dim is heard
  const dim = await t.meters((x) => mixPeak(x, 1) < 0.1 && mixPeak(x, 0) > 0.25);
  assert.ok(Math.abs(mixPeak(dim, 1) - 0.3 / 3.98) < 0.015, "dimmed " + mixPeak(dim, 1));
  assert.ok(Math.abs(mixPeak(dim, 0) - 0.3) < 0.03, "the other mix is not dimmed (and slot 1 is off there): " + mixPeak(dim, 0));
  t.cmd({ cmd: "talk", slot: 1, on: 0 });
  const back = await t.meters((x) => mixPeak(x, 1) > 0.28); assert.ok(mixPeak(back, 1) > 0.28, "back up " + mixPeak(back, 1));
});
await check("talkback from a computer's mic over the network (source 4 + slot), to every mix with all:1", async () => {
  t.cmd({ cmd: "net", src: 6, channels: 1, rate: 48000, latency: 40 });
  t.cmd({ cmd: "talk", slot: 2, on: 1, src: 2, gain: 0, dim: 0, all: 1 });
  let ph = 0; const tick = setInterval(() => { const n = 480, b = Buffer.alloc(n * 2); for (let f = 0; f < n; f++) { b.writeInt16LE(Math.round(0.4 * 32767 * Math.sin(ph)), f * 2); ph += 2 * Math.PI * 330 / 48000; } t.net(6, 1, n, b); }, 10);
  try {
    const m = await t.meters((x) => x.talk[2] > 0.3 && mixPeak(x, 0) > 0.55 && mixPeak(x, 1) > 0.55, 8000);
    assert.ok(m.talk[2] > 0.3, "network talk meter " + m.talk[2]); assert.ok(mixPeak(m, 0) > 0.55 && mixPeak(m, 1) > 0.55, "both mixes hear it " + mixPeak(m, 0) + " / " + mixPeak(m, 1));
  } finally { clearInterval(tick); }
  t.cmd({ cmd: "talk", slot: 2, on: 0 });
});
// ---- recording
const recRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cu-rec-"));
await check("recording: one 24-bit 48 kHz WAV per input, the stereo program, correct headers and contents", async () => {
  const dir = path.join(recRoot, "2026-10-17 10.30 - Sunday"); fs.mkdirSync(dir);
  t.cmd({ cmd: "input", i: 0, src: 1, ch: 0, fader: 0, pan: 0 });   // the main mix (program) carries ch 0's tone
  t.cmd({ cmd: "rec", on: 1, dir, files: "In 01 - Music.wav|In 03 - Mic é.wav|Program.wav", ins: [0, 2], net: [], prog: 0 });
  const st = await t.wait((x) => x.ev === "rec" && x.state !== "idle"); assert.equal(st.state, "recording", JSON.stringify(st)); assert.equal(st.tracks, 3);
  await sleep(1500);
  const live = await t.meters((x) => x.rec && x.rec.on && x.rec.frames > 48000); assert.ok(live.rec.frames > 48000, "frames while recording " + JSON.stringify(live.rec));
  t.cmd({ cmd: "rec", on: 0 });
  const done = await t.wait((x) => x.ev === "rec" && x.state === "stopped"); assert.equal(done.dropped, 0, "dropped " + done.dropped); assert.ok(!done.error, done.error);
  const a = readWav(path.join(dir, "In 01 - Music.wav")), b = readWav(path.join(dir, "In 03 - Mic é.wav")), p = readWav(path.join(dir, "Program.wav"));
  for (const [w, ch] of [[a, 1], [b, 1], [p, 2]]) {
    assert.deepEqual([w.riff, w.wave, w.fmt, w.ch, w.rate, w.bits, w.align, w.byteRate, w.dataTag], ["RIFF", "WAVE", 1, ch, 48000, 24, ch * 3, 48000 * ch * 3, "data"]);
    assert.equal(w.data, w.size - 44, "data size in the header"); assert.equal(w.riffSize, w.size - 8, "RIFF size");
  }
  assert.ok(a.frames > 48000 * 1.3 && a.frames < 48000 * 3, "frames " + a.frames); assert.equal(a.frames, b.frames); assert.equal(a.frames, p.frames);
  assert.equal(a.frames, done.frames, "the files have every frame the engine counted");
  assert.ok(Math.abs(a.peak[0] - 0.3) < 0.02 && Math.abs(b.peak[0] - 0.5) < 0.02, "inputs " + a.peak + " / " + b.peak);
  assert.ok(Math.abs(p.peak[0] - 0.3) < 0.03 && Math.abs(p.peak[1] - 0.3) < 0.03, "program " + p.peak);
  assert.ok(b.lowBytesUsed > b.frames / 2, "real 24-bit samples (not 16-bit padded)");
});
await check("a crash leaves WAVs whose headers --repair fixes; a clean quit closes them properly by itself", async () => {
  const r = engine(["--backend", "null", "--capture", "NULL#2", "--block", "256"]); await r.wait((x) => x.ev === "status");
  const dir = path.join(recRoot, "crash"); fs.mkdirSync(dir);
  r.cmd({ cmd: "rec", on: 1, dir, files: "In 01.wav|In 02.wav|Program.wav", ins: [0, 1], prog: 0 }); await r.wait((x) => x.ev === "rec" && x.state === "recording");
  await sleep(1300); r.p.kill("SIGKILL"); await r.exited;
  const files = ["In 01.wav", "In 02.wav", "Program.wav"].map((f) => path.join(dir, f));
  const broken = readWav(files[0]); assert.ok(broken.size > 44 + 48000 * 3 && broken.data !== broken.size - 44, "after the crash: header " + broken.data + ", file " + broken.size);
  const out = spawnSync(bin, ["--repair", ...files], { encoding: "utf8" }); const rep = JSON.parse(out.stdout);
  assert.equal(rep.files.length, 3); assert.ok(rep.files.every((f) => f.ok && f.fixed), out.stdout);
  for (const f of files) { const w = readWav(f); assert.equal(w.data, w.size - 44 - ((w.size - 44) % w.align)); assert.equal(w.riffSize, w.data + 36); }
  const again = JSON.parse(spawnSync(bin, ["--repair"], { input: files.join("\n") + "\n", encoding: "utf8" }).stdout);   // (the paths on stdin, as the app does)
  assert.equal(again.files.length, 3); assert.ok(again.files.every((f) => f.ok && !f.fixed), "a second repair changes nothing");
  // quitting while recording (the app closes the engine): the writer finishes the files
  const q = engine(["--backend", "null", "--capture", "NULL#2", "--block", "256"]); await q.wait((x) => x.ev === "status");
  const dir2 = path.join(recRoot, "quit"); fs.mkdirSync(dir2);
  q.cmd({ cmd: "rec", on: 1, dir: dir2, files: "In 01.wav", ins: [0] }); await q.wait((x) => x.ev === "rec" && x.state === "recording");
  await sleep(800); q.cmd({ cmd: "quit" }); await q.exited;
  const w = readWav(path.join(dir2, "In 01.wav")); assert.ok(w.frames > 48000 * 0.5 && w.data === w.size - 44, "closed on quit: " + w.data + " / " + w.size);
});
await check("a second start while recording is refused; a stop when idle says so", async () => {
  const dir = path.join(recRoot, "twice"); fs.mkdirSync(dir);
  t.cmd({ cmd: "rec", on: 1, dir, files: "a.wav", ins: [0] }); await t.wait((x) => x.ev === "rec" && x.state === "recording");
  t.cmd({ cmd: "rec", on: 1, dir, files: "b.wav", ins: [1] }); const e2 = await t.wait((x) => x.ev === "rec" && x.state === "error"); assert.match(e2.error, /already/);
  t.cmd({ cmd: "rec", on: 0 }); await t.wait((x) => x.ev === "rec" && x.state === "stopped");
  t.cmd({ cmd: "rec", on: 0 }); await t.wait((x) => x.ev === "rec" && x.state === "idle");
  const bad = path.join(recRoot, "missing", "deeper"); t.cmd({ cmd: "rec", on: 1, dir: bad, files: "a.wav", ins: [0] });
  const e3 = await t.wait((x) => x.ev === "rec" && x.state === "error"); assert.match(e3.error, /could not create/);
});
t.quit();
fs.rmSync(recRoot, { recursive: true, force: true });

const s = engine(["--backend", "internal"]);
await check("internal clock still works (no device)", async () => { const x = await s.wait((v) => v.ev === "status"); assert.equal(x.backend, "internal"); assert.equal(x.inputs, 0); await s.wait((v) => v.ev === "meters"); });
s.quit();

const bad = engine(["--backend", "null", "--capture", "Nope Device"]);
await check("a device that isn't there is reported, the rest still opens", async () => { const x = await bad.wait((v) => v.ev === "status"); assert.ok(/not found/.test(x.deviceError || ""), JSON.stringify(x).slice(0, 300)); });
bad.quit();

setTimeout(() => { console.log(failures ? "\n" + failures + " MIXER CHECK(S) FAILED" : "\nALL MIXER CHECKS PASSED"); process.exit(failures ? 1 : 0); }, 1200);
