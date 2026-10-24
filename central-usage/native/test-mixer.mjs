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
  let buf = Buffer.alloc(0); const events = []; const waiters = []; const taps = {}; const caps = {};   // caps[tap] = [] keeps that tap's audio
  p.stdout.on("data", (c) => {
    buf = Buffer.concat([buf, c]);
    while (buf.length >= 5) {
      const n = buf.readUInt32LE(1); if (buf.length < 5 + n) break;
      const t = String.fromCharCode(buf[0]), body = buf.subarray(5, 5 + n); buf = buf.subarray(5 + n);
      if (t === "J") { const e = JSON.parse(body.toString("utf8")); events.push(e); waiters.slice().forEach((w) => { if (w.test(e)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(e); } }); }
      else if (t === "A") { const tap = body[0]; taps[tap] = (taps[tap] || 0) + 1; if (caps[tap]) caps[tap].push(Buffer.from(body.subarray(3))); }
    }
  });
  const cmd = (o) => { const b = Buffer.from(JSON.stringify(o)), h = Buffer.alloc(5); h[0] = 74; h.writeUInt32LE(b.length, 1); p.stdin.write(Buffer.concat([h, b])); };
  // network audio in: u8 source, u8 channels, u16 frames, int16 interleaved
  const net = (source, ch, frames, pcm) => { const h = Buffer.alloc(9); h[0] = 78; h.writeUInt32LE(4 + pcm.length, 1); h[5] = source; h[6] = ch; h.writeUInt16LE(frames, 7); p.stdin.write(Buffer.concat([h, pcm])); };
  const wait = (test, ms = 8000) => new Promise((resolve, reject) => { const hit = events.find((e) => !e._used && test(e)); if (hit) { hit._used = true; return resolve(hit); } const w = { test: (e) => !e._used && test(e) && (e._used = true), resolve }; waiters.push(w); setTimeout(() => reject(new Error("timeout waiting for event")), ms); });
  const meters = async (pred, ms = 6000) => { const t0 = Date.now(); for (;;) { const m = await wait((e) => e.ev === "meters" && !e._seen, 3000); m._seen = true; if (pred(m)) return m; if (Date.now() - t0 > ms) return m; } };
  const exited = new Promise((r) => p.on("exit", r));
  return { p, cmd, net, wait, meters, taps, caps, events, exited, quit: () => { cmd({ cmd: "quit" }); setTimeout(() => p.kill(), 800); } };
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
  const on = await t.meters((x) => mixPeak(x, 0) > 0.6 && x.talk[0] > 0.45, 8000);   // (a slow machine meters the talk fading in first)
  assert.ok(mixPeak(on, 0) > 0.6 && mixPeak(on, 0) < 0.85, "mix 1 with talkback " + mixPeak(on, 0));
  assert.ok(Math.abs(mixPeak(on, 1) - 0.3) < 0.03, "mix 2 doesn't hear it: " + mixPeak(on, 1));
  assert.ok(Math.abs(on.talk[0] - 0.5) < 0.06, "talk meter " + on.talk[0]);
});
await check("talkback dims the music in its mixes (-12 dB) while it talks, and lets it back up after", async () => {
  t.cmd({ cmd: "talk", slot: 0, on: 0 });
  t.cmd({ cmd: "talk", slot: 1, on: 1, src: 1, ch: 3, gain: 0, dim: -12, mixes: [1] });   // ch 3 is silent: only the dim is heard
  const dim = await t.meters((x) => Math.abs(mixPeak(x, 1) - 0.3 / 3.98) < 0.012 && mixPeak(x, 0) > 0.25, 8000);   // (once the dim has settled: a slow machine meters the ramp first)
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
    // the music alone peaks at 0.3 in each mix: well above that = the talk is in both
    const m = await t.meters((x) => x.talk[2] > 0.3 && mixPeak(x, 0) > 0.42 && mixPeak(x, 1) > 0.42, 8000);
    assert.ok(m.talk[2] > 0.3, "network talk meter " + m.talk[2]); assert.ok(mixPeak(m, 0) > 0.42 && mixPeak(m, 1) > 0.42, "both mixes hear it " + mixPeak(m, 0) + " / " + mixPeak(m, 1));
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
  await sleep(2200); r.p.kill("SIGKILL"); await r.exited;
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

// ---- channel processing (gate, the second EQ mid), the FX returns (reverb, delay) and the stream mix
const x = engine(["--backend", "null", "--capture", "NULL#8", "--playback", "NULL#8", "--block", "256"]);
await x.wait((v) => v.ev === "status");
const ch = (i, o) => x.cmd(Object.assign({ cmd: "input", i, src: 1, ch: i, fader: -90, pan: 0 }, o));
const FLAT_EQ = [1, 100, 0, 1000, 0, 1, 8000, 0];
const REV = (on, ret, decay) => ({ cmd: "fx", rev: [on, decay || 2, 0, 0.5, 100, 1, ret] });
await check("status says what this engine has: gate, 4-band EQ, FX, the stream mix (tap 65)", async () => {
  const st2 = x.events.find((v) => v.ev === "status"); assert.deepEqual(st2.features, ["gate", "eq4", "fx", "stream"]); assert.equal(st2.streamTap, 65);
});
await check("gate: a quiet signal under the threshold is closed down by its range (-40 dB); a loud one passes untouched", async () => {
  x.cmd({ cmd: "testgen", ch: 0, freq: 300, level: 0.01 });   // -40 dBFS
  ch(0, { gate: [1, -30, -40, 0.5, 0, 50] });
  const shut = await x.meters((m) => m.in[0] < 0.0003 && m.gate[0] > 30);
  assert.ok(shut.in[0] < 0.0003, "closed: " + shut.in[0]); assert.ok(shut.gate[0] > 30 && shut.gate[0] < 41, "gate meter " + shut.gate[0]);
  x.cmd({ cmd: "testgen", ch: 0, freq: 300, level: 0.3 });
  const open = await x.meters((m) => Math.abs(m.in[0] - 0.3) < 0.02 && m.gate[0] < 1);
  assert.ok(Math.abs(open.in[0] - 0.3) < 0.02, "open: " + open.in[0]);
  ch(0, { gate: [1, -30, -90, 0.5, 0, 50] }); x.cmd({ cmd: "testgen", ch: 0, freq: 300, level: 0.01 });
  const hard = await x.meters((m) => m.in[0] < 0.00001); assert.ok(hard.in[0] < 0.00001, "range -90: fully shut " + hard.in[0]);
  x.cmd({ cmd: "testgen", ch: 0, level: 0 });
});
await check("EQ: the second mid (+12 dB at 1 kHz) lifts a 1 kHz tone 4x; off when its gain is 0", async () => {
  x.cmd({ cmd: "testgen", ch: 1, freq: 1000, level: 0.1 });
  ch(1, { eq: FLAT_EQ.concat([1000, 12, 1]) });
  const up = await x.meters((m) => m.in[1] > 0.35); assert.ok(up.in[1] > 0.37 && up.in[1] < 0.42, "lifted " + up.in[1]);
  ch(1, { eq: FLAT_EQ.concat([1000, 0, 1]) });
  const flat = await x.meters((m) => Math.abs(m.in[1] - 0.1) < 0.005); assert.ok(Math.abs(flat.in[1] - 0.1) < 0.005, "flat " + flat.in[1]);
});
await check("reverb: a channel's send (post fader) rings on after the tone stops - in the main mix and in an in-ear mix with a reverb return; not in one without", async () => {
  ch(1, { fader: 0, fx: [0, -90] });
  x.cmd(REV(1, 0, 2.5));
  for (const m of [0, 1]) x.cmd({ cmd: "mix", m, level: 0, mute: 0, outL: -1, outR: -1, stereo: 1, tap: 0, used: 1, rRev: m === 0 ? 0 : -90 });
  await x.meters((m) => m.fx[0] > 0.01);
  x.cmd({ cmd: "testgen", ch: 1, level: 0 });
  await sleep(250);
  const tail = await x.meters((m) => m.in[1] < 0.001);
  assert.ok(tail.in[1] < 0.001, "the tone is gone: " + tail.in[1]);
  assert.ok(tail.main[0] > 0.002 && tail.fx[0] > 0.002, "the main mix still rings: " + tail.main[0] + " fx " + tail.fx[0]);
  assert.ok(tail.mix[0] > 0.002, "mix 1 (return 0 dB) rings: " + tail.mix[0]); assert.ok(tail.mix[2] < 0.0005, "mix 2 (no return) is quiet: " + tail.mix[2]);   // (two numbers per mix: L, R)
  // the fader moves the send: fader all the way down, nothing reaches the reverb
  x.cmd({ cmd: "testgen", ch: 1, freq: 1000, level: 0.1 }); ch(1, { fader: -90, fx: [0, -90] });
  await sleep(300); const none = await x.meters((m) => m.fx[0] < 0.0005, 4000); assert.ok(none.fx[0] < 0.0005, "post fader: " + none.fx[0]);
  x.cmd({ cmd: "testgen", ch: 1, level: 0 }); x.cmd(REV(0, -90));
});
await check("delay: a click comes back once, 250 ms later (12000 samples), at the return level", async () => {
  x.cmd({ cmd: "net", src: 0, channels: 1, rate: 48000, latency: 40 });
  x.cmd({ cmd: "input", i: 2, src: 2, ch: 0, fader: 0, pan: 0, fx: [-90, 0] });
  x.cmd({ cmd: "fx", dly: [1, 250, 250, 0, 20000, 20, 0, 0] });
  x.cmd({ cmd: "main", level: 0, mute: 0, outL: -1, outR: -1, stereo: 1, tap: 1, used: 1 });
  // (a slow CI runner can drop the network packet with the click: up to 3 tries, each with a fresh click)
  let hits = [];
  for (let attempt = 0; attempt < 3 && hits.length !== 2; attempt++) {
    x.caps[0] = [];
    let sent = 0; const tick = setInterval(() => { const n = 480, b = Buffer.alloc(n * 2); if (sent === 40) b.writeInt16LE(Math.round(0.8 * 32767), 100); sent++; x.net(0, 1, n, b); }, 10);
    try { await sleep(1500); } finally { clearInterval(tick); }
    await sleep(300);
    const pcm = Buffer.concat(x.caps[0] || []); delete x.caps[0];
    hits = []; for (let k = 0; k < pcm.length / 4; k++) { const v = pcm.readInt16LE(k * 4) / 32767; if (Math.abs(v) > 0.3 && (!hits.length || k - hits[hits.length - 1].k > 1000)) hits.push({ k, v }); }
  }
  assert.equal(hits.length, 2, "the click and one echo: " + JSON.stringify(hits));
  assert.ok(Math.abs(hits[1].k - hits[0].k - 12000) <= 2, "echo after " + (hits[1].k - hits[0].k) + " samples");
  assert.ok(Math.abs(hits[1].v - hits[0].v) < 0.05, "the same level: " + hits[0].v + " / " + hits[1].v);
  x.cmd({ cmd: "fx", dly: [0, 250, 250, 0, 20000, 20, -90, 0] }); x.cmd({ cmd: "input", i: 2, src: 0 });
});
await check("stream mix: its own levels (the main fader down, the stream still hears the channel), its mute, its tap (65)", async () => {
  x.cmd({ cmd: "testgen", ch: 3, freq: 440, level: 0.2 });
  ch(3, { fader: -90 });
  x.cmd({ cmd: "stream", level: 0, mute: 0, outL: 4, outR: 5, tap: 1, used: 1, comp: [0, -20, 4, 10, 150, 0] });
  x.cmd({ cmd: "ssend", i: 3, level: 0, pan: 0, on: 1 });
  const on = await x.meters((m) => m.stream[0] > 0.18 && m.main[0] < 0.005);
  assert.ok(Math.abs(on.stream[0] - 0.2) < 0.02 && Math.abs(on.stream[1] - 0.2) < 0.02, "stream " + on.stream); assert.ok(on.main[0] < 0.005, "the main mix doesn't have it: " + on.main[0]);
  await sleep(300); assert.ok(x.taps[65] > 2, "stream tap messages: " + x.taps[65]);
  x.cmd({ cmd: "stream", level: 0, mute: 1, outL: 4, outR: 5, tap: 1, used: 1 });
  const off = await x.meters((m) => m.stream[0] < 0.001); assert.ok(off.stream[0] < 0.001, "muted " + off.stream[0]);
  ch(3, { fader: 0 }); const mainOnly = await x.meters((m) => m.main[0] > 0.18); assert.ok(mainOnly.stream[0] < 0.001, "the main fader doesn't open the stream: " + mainOnly.stream[0]);
  ch(3, { fader: -90 });
});
await check("stream mix: its compressor (glue) pulls a loud mix down; the limiter keeps it under -1 dBFS", async () => {
  x.cmd({ cmd: "testgen", ch: 3, freq: 440, level: 0.5 });
  x.cmd({ cmd: "stream", level: 0, mute: 0, outL: 4, outR: 5, tap: 1, used: 1, comp: [1, -20, 4, 5, 100, 0] });
  const c = await x.meters((m) => m.streamGr > 6 && m.stream[0] < 0.2); assert.ok(c.streamGr > 6 && c.streamGr < 12, "gain reduction " + c.streamGr); assert.ok(c.stream[0] < 0.2, "level " + c.stream[0]);
  x.cmd({ cmd: "stream", level: 10, mute: 0, outL: 4, outR: 5, tap: 1, used: 1, comp: [0, -20, 4, 5, 100, 0] });
  const lim = await x.meters((m) => m.stream[0] > 0.8); assert.ok(lim.stream[0] <= 0.895, "limited " + lim.stream[0]);
  x.cmd({ cmd: "stream", level: 0, mute: 0, outL: 4, outR: 5, tap: 1, used: 1, comp: [0, -20, 4, 5, 100, 0] }); x.cmd({ cmd: "testgen", ch: 3, freq: 440, level: 0.2 });
});
await check("the stream mix records as its own stereo program (prog 65 -> stream.wav)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cu-stream-"));
  const before = await x.meters((m) => Math.abs(m.stream[0] - 0.2) < 0.005 && m.streamGr < 0.1); assert.ok(Math.abs(before.stream[0] - 0.2) < 0.005, "stream before " + before.stream[0]);
  x.cmd({ cmd: "rec", on: 1, dir, files: "", ins: [], prog: 65 }); await x.wait((v) => v.ev === "rec" && v.state === "recording");
  await sleep(1200); x.cmd({ cmd: "rec", on: 0 }); await x.wait((v) => v.ev === "rec" && v.state === "stopped");
  const w = readWav(path.join(dir, "stream.wav")); assert.equal(w.ch, 2); assert.ok(Math.abs(w.peak[0] - 0.2) < 0.02 && Math.abs(w.peak[1] - 0.2) < 0.02, "stream.wav " + w.peak);
  fs.rmSync(dir, { recursive: true, force: true });
});
x.quit();

const s = engine(["--backend", "internal"]);
await check("internal clock still works (no device)", async () => { const x = await s.wait((v) => v.ev === "status"); assert.equal(x.backend, "internal"); assert.equal(x.inputs, 0); await s.wait((v) => v.ev === "meters"); });
s.quit();

const bad = engine(["--backend", "null", "--capture", "Nope Device"]);
await check("a device that isn't there is reported, the rest still opens", async () => { const x = await bad.wait((v) => v.ev === "status"); assert.ok(/not found/.test(x.deviceError || ""), JSON.stringify(x).slice(0, 300)); });
bad.quit();

setTimeout(() => { console.log(failures ? "\n" + failures + " MIXER CHECK(S) FAILED" : "\nALL MIXER CHECKS PASSED"); process.exit(failures ? 1 : 0); }, 1200);
