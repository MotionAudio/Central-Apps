// Unit test of cu-rig, the built-in instrument rig (Windows / macOS): null audio devices, a pedal board of
// every effect kind, live knob / bypass changes, and SoundFont keys with layers.
//   node native/test-rig.mjs [path/to/cu-rig]
import { spawn, spawnSync } from "node:child_process";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.join(here, "..", "..");
const bin = process.argv[2] || path.join(here, "build", "cu-rig" + (process.platform === "win32" ? ".exe" : ""));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cu-rig-"));
const map = path.join(tmp, "rig-map.json");
spawnSync(process.execPath, [path.join(root, "tools", "make-rig-map.js"), map], { stdio: "inherit" });
const P = (await import("node:module")).createRequire(import.meta.url)(path.join(root, "js", "pedals.js"));
const R = JSON.parse(fs.readFileSync(map, "utf8"));

// a small SoundFont made from two sine "samples" (C4, C5) - the same builder the Pi uses for WAV banks
const wavDir = path.join(tmp, "wavs"); fs.mkdirSync(wavDir);
function sineWav(file, freq) { const rate = 22050, n = rate, b = Buffer.alloc(44 + n * 2); b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40); for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(12000 * Math.sin(2 * Math.PI * freq * i / rate)), 44 + i * 2); fs.writeFileSync(file, b); }
sineWav(path.join(wavDir, "C4.wav"), 261.63); sineWav(path.join(wavDir, "C5.wav"), 523.25);
const sfDir = path.join(tmp, "data", "sounds", "sf2"); fs.mkdirSync(sfDir, { recursive: true });
const sf2 = path.join(sfDir, "Test Sine.sf2");
const py = spawnSync(process.platform === "win32" ? "python" : "python3", ["-c", "import sys; sys.path.insert(0, sys.argv[1]); import instrument_host as h; print(h.build_sf2_from_wavs(sys.argv[2], sys.argv[3], 'Test Sine'))", root, wavDir, sf2], { encoding: "utf8" });
const haveSf2 = fs.existsSync(sf2);
if (!haveSf2) console.log("  (no python to build the test SoundFont: " + (py.stderr || py.error) + ")");

const p = spawn(bin, ["--data", path.join(tmp, "data"), "--map", map, "--backend", "null", "--block", "256"], { stdio: ["pipe", "pipe", "inherit"] });
let buf = "", msgs = []; const waiters = [];
p.stdout.on("data", (c) => { buf += c; let i; while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); let m; try { m = JSON.parse(line); } catch (_) { continue; } msgs.push(m); waiters.slice().forEach((w) => { if (w.t(m)) { waiters.splice(waiters.indexOf(w), 1); w.r(m); } }); } });
const send = (m) => p.stdin.write(JSON.stringify(m) + "\n");
const next = (t, ms = 6000) => new Promise((r, j) => { waiters.push({ t, r }); setTimeout(() => j(new Error("timeout")), ms); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function meters() { send({ action: "meters" }); await sleep(300); send({ action: "meters" }); return next((m) => m.type === "instrumentMeters"); }
let failures = 0;
async function check(label, fn) { try { await fn(); console.log("  ✓ " + label); } catch (e) { failures++; console.error("  ✗ " + label + "\n      " + (e && e.message || e)); } }

function item(id, values, extra) { const ped = P.byId(id); assert.ok(ped, "pedal " + id); return Object.assign({ uid: "u" + id.replace(/[^a-z0-9]/gi, "").slice(0, 8), id, uri: ped.uri, on: true, values: values || {}, mix: 1, levelDb: 0 }, extra || {}); }

await check("starts and reports itself available, with the pedals' controls for the app", async () => {
  const s = msgs.find((m) => m.type === "instrumentStatus") || await next((m) => m.type === "instrumentStatus");
  assert.equal(s.available, true); assert.equal(s.engine, "cu-rig"); assert.ok(Object.keys(s.plugins).length > 150, "plugins " + Object.keys(s.plugins).length);
});
// one pedal of every kind in a board
const kinds = {}; P.pedals.forEach((pd) => { if (!kinds[pd.category] && R[pd.id] && pd.uri !== "builtin:convolver") kinds[pd.category] = pd.id; });
const board = Object.values(kinds).map((id) => item(id));
await check("a guitar board with one pedal of every kind (" + Object.keys(kinds).length + " kinds) runs and passes sound", async () => {
  send({ action: "apply", config: { kind: "electric", input: { device: "auto", channel: "L", gainDb: 0, gateOn: false, gateDb: -70 }, chain: board, levelDb: 0, routing: {} } });
  const s = await next((m) => m.type === "instrumentStatus" && m.kind === "electric");
  assert.equal(s.running, true, JSON.stringify(s.error));
  send({ action: "testtone", freq: 196, level: 0.3 });
  await sleep(500); const m = await meters();
  assert.ok(m.out > 0.01 && m.out < 50, "out " + m.out);
});
await check("every pedal of the catalogue alone stays finite and audible-or-silent (no NaN, no runaway)", async () => {
  const bad = [];
  for (const ped of P.pedals) {
    if (ped.uri === "builtin:convolver") continue;
    send({ action: "apply", config: { kind: "electric", input: { device: "auto", channel: "L", gainDb: 0, gateOn: false }, chain: [item(ped.id)], levelDb: 0, routing: {} } });
    await sleep(120); send({ action: "meters" }); await sleep(120); send({ action: "meters" });
    const m = await next((x) => x.type === "instrumentMeters");
    if (!(isFinite(m.out) && m.out < 20)) bad.push(ped.id + "=" + m.out);
  }
  assert.equal(bad.length, 0, bad.join(", "));
});
await check("bypass and a knob change take effect live", async () => {
  send({ action: "apply", config: { kind: "electric", input: { device: "auto", channel: "L", gainDb: 0, gateOn: false }, chain: [item("ts9", {}, { uid: "drv" })], levelDb: 0, routing: {} } });
  await sleep(300); const on = await meters();
  const drive = Object.keys(R.ts9.controls).find((k) => /drive/i.test(R.ts9.controls[k][5])); assert.ok(drive, "no Drive control");
  send({ action: "set", uid: "drv", sym: drive, value: R.ts9.controls[drive][1] }); await sleep(300); const hot = await meters();
  assert.ok(hot.out !== on.out, "drive knob changed nothing: " + on.out + " -> " + hot.out);
  send({ action: "bypass", uid: "drv", on: false }); await sleep(300); const off = await meters();
  assert.ok(Math.abs(off.out - 0.3) < 0.05, "bypassed output ~ the input (0.3): " + off.out + " (on: " + on.out + ")");
});
if (haveSf2) await check("keys: a SoundFont bank is listed, two layers play a note, the level follows the layer volume", async () => {
  send({ action: "testtone", level: 0 }); send({ action: "rescan" });
  const s = await next((m) => m.type === "instrumentStatus" && (m.keysCatalog || []).length > 0);
  const bank = s.keysCatalog.find((b) => /Test Sine/.test(b.name)); assert.ok(bank, JSON.stringify(s.keysCatalog));
  const patch = { file: bank.file, bank: bank.presets[0].bank, prog: bank.presets[0].prog };
  send({ action: "apply", config: { kind: "keys", chain: [item("dfly-hall")], keys: { layers: [{ patch, on: true, volume: 1 }, { patch, on: true, volume: 0.5, octave: 1 }], volume: 0.8 }, levelDb: 0, routing: {} } });
  await next((m) => m.type === "instrumentStatus" && m.kind === "keys");
  send({ action: "note", note: 60, on: true, velocity: 110 }); await sleep(400); const m = await meters();
  assert.ok(m.out > 0.02, "keys out " + m.out);
  send({ action: "midi", data: [0x80, 60, 0] }); send({ action: "note", note: 60, on: false });
});
await check("off stops the audio", async () => { send({ action: "apply", config: { kind: "off" } }); const s = await next((m) => m.type === "instrumentStatus" && m.kind === "off"); assert.equal(s.running, false); });
p.stdin.end();
setTimeout(() => { p.kill(); console.log(failures ? "\n" + failures + " RIG CHECK(S) FAILED" : "\nALL RIG CHECKS PASSED"); process.exit(failures ? 1 : 0); }, 800);
