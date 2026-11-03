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
const watchdog = setTimeout(() => { console.error("\nRIG TEST TIMED OUT (" + (globalThis.__step || "start") + ")"); process.exit(2); }, 300000); watchdog.unref && watchdog.unref();
async function check(label, fn) { globalThis.__step = label; try { await fn(); console.log("  ✓ " + label); } catch (e) { failures++; console.error("  ✗ " + label + "\n      " + (e && e.message || e)); } }

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
await check("Central Pedals (our own DSP, the same as the Pi's central-pedals.so): each one alone is audible, tuner mute is silent, a knob turns live", async () => {
  const own = P.pedals.filter((q) => q.opts.own), bad = [];
  assert.ok(own.length >= 40, "only " + own.length + " Central Pedals");
  send({ action: "testtone", freq: 196, level: 0.3 });
  for (const ped of own) {
    assert.ok(R[ped.id] && Object.keys(R[ped.id].controls).length === Object.keys(ped.knobs).length, ped.id + ": the rig map should list every knob");
    send({ action: "apply", config: { kind: "electric", input: { device: "auto", channel: "L", gainDb: 0, gateOn: false }, chain: [item(ped.id, ped.id === "ma-whammy" ? { position: 1 } : {})], levelDb: 0, routing: {} } });
    await sleep(150); send({ action: "meters" }); await sleep(150); send({ action: "meters" });
    const m = await next((x) => x.type === "instrumentMeters");
    if (ped.id === "ma-mute" ? !(m.out < 0.001) : !(isFinite(m.out) && m.out > 0.005 && m.out < 20)) bad.push(ped.id + "=" + m.out);
  }
  assert.equal(bad.length, 0, bad.join(", "));
  send({ action: "apply", config: { kind: "electric", input: { device: "auto", channel: "L", gainDb: 0, gateOn: false }, chain: [item("ma-boost", { gain: 0 }, { uid: "mab" })], levelDb: 0, routing: {} } });
  await sleep(300); const flat = await meters();
  send({ action: "set", uid: "mab", sym: "gain", value: 12 }); await sleep(400); const up = await meters();
  assert.ok(up.out > flat.out * 2.5, "Clean Boost +12 dB: " + flat.out + " -> " + up.out);
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
// the Studio effects: real units, real behaviour (testtone 0.3 = -10.5 dBFS, 196 Hz)
const studio = async (id, values, opts) => { send({ action: "apply", config: { kind: "electric", input: { device: "auto", channel: "L", gainDb: 0, gateOn: false }, chain: [item(id, values, Object.assign({ uid: "st" }, opts || {}))], levelDb: 0, routing: {} } }); await sleep(400); return meters(); };
await check("Studio EQ: a +12 dB bell at the tone's pitch makes it louder, a -12 dB one quieter, flat leaves it alone", async () => {
  send({ action: "testtone", freq: 196, level: 0.3 });
  const flat = await studio("studio-eq", {}), up = await studio("studio-eq", { p1_freq: 196, p1_gain: 12, p1_q: 1 }), down = await studio("studio-eq", { p1_freq: 196, p1_gain: -12, p1_q: 1 });
  assert.ok(Math.abs(flat.out - 0.3) < 0.04, "flat " + flat.out); assert.ok(up.out > 0.8, "boost " + up.out); assert.ok(down.out < 0.12, "cut " + down.out);
  const cut = await studio("studio-eq", { hp_freq: 800 }); assert.ok(cut.out < 0.1, "a low cut at 800 Hz takes out 196 Hz: " + cut.out);
});
await check("Studio Compressor: over the threshold it turns the tone down and reports the gain reduction", async () => {
  send({ action: "testtone", freq: 196, level: 0.3 });
  const soft = await studio("x42-comp", { threshold: -10, Ratio: 0 }), hard = await studio("x42-comp", { threshold: -40, Ratio: 0.9, attack: 0.001 });
  assert.ok(hard.out < soft.out * 0.75, "compressed " + hard.out + " vs " + soft.out);
  assert.ok(hard.gr && hard.gr.st < -6, "gain reduction " + JSON.stringify(hard.gr));
});
await check("Studio Limiter: nothing gets past the ceiling, even pushed 20 dB", async () => {
  send({ action: "testtone", freq: 196, level: 0.3 });
  const m = await studio("x42-limiter", { gain: 20, threshold: -6, release: 0.05 });
  assert.ok(m.out <= 0.502 && m.out > 0.4, "ceiling -6 dB = 0.501: " + m.out);
});
await check("De-esser: highs over the threshold duck, lows go straight through", async () => {
  send({ action: "testtone", freq: 196, level: 0.3 }); const low = await studio("studio-deess", { thresh: 0, freq: 0.5, hf_drive: 0.5 });
  assert.ok(Math.abs(low.out - 0.3) < 0.05, "196 Hz untouched: " + low.out);
  send({ action: "testtone", freq: 8000, level: 0.3 }); const s = await studio("studio-deess", { thresh: 0, freq: 0.5, hf_drive: 0.5 });
  assert.ok(s.out < 0.15, "8 kHz ducked: " + s.out);
  send({ action: "testtone", freq: 196, level: 0.3 });
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
if (haveSf2) await check("play any sound: a guitar note plays the chosen sound, synth mode makes its own, the dry blend, and off", async () => {
  const s = msgs.slice().reverse().find((m) => m.type === "instrumentStatus" && (m.keysCatalog || []).length);
  const bank = s.keysCatalog.find((b) => /Test Sine/.test(b.name)), patch = { file: bank.file, bank: bank.presets[0].bank, prog: bank.presets[0].prog, name: "Test Sine" };
  const about = (x, want, tol, what) => assert.ok(Math.abs(x - want) <= tol, what + ": " + x + " (expected about " + want + ")");
  const config = (playAny) => ({ action: "apply", config: { kind: "electric", input: { device: "auto", channel: "L", gainDb: 0, gateOn: false }, chain: [], levelDb: 0, routing: {}, playAny } });
  send({ action: "testtone", level: 0 }); send(config({ on: true, patch, mode: "notes", dry: 0, sensitivity: 0.5 }));
  const st = await next((m) => m.type === "instrumentStatus" && m.kind === "electric"); assert.ok(st.playAny && st.playAny.on, JSON.stringify(st.playAny));
  await sleep(300); send({ action: "testtone", freq: 329.63, level: 0.3 }); await sleep(500);   // E4
  const m = await meters(); assert.ok(m.playAny, "meters say what plays: " + JSON.stringify(m));
  assert.equal(m.playAny.state, "note"); assert.equal(m.playAny.note, 64); assert.ok(m.out > 0.02, "the sound plays: " + m.out);
  send({ action: "playany", playAny: { on: true, patch, mode: "synth", dry: 0 } }); await sleep(400); const sy = await meters();
  assert.equal(sy.playAny.state, "synth"); assert.ok(sy.out > 0.01, "synth mode out " + sy.out);
  send({ action: "playany", playAny: { on: true, patch, mode: "synth", dry: 1, volume: 0 } }); await sleep(400); const dry = await meters();
  about(dry.out, 0.3, 0.05, "dry blend 1, play-any volume 0: the guitar as it is");
  send({ action: "playany", playAny: { on: false, patch } }); await sleep(400); const off = await meters();
  assert.ok(!off.playAny, "off: " + JSON.stringify(off.playAny)); about(off.out, 0.3, 0.05, "off: the guitar as it is");
  send({ action: "testtone", level: 0 });
});
// ---- the musician's own plugins: two test CLAP plugins (plughost/test/test-plugins.c), built next to the rig by the
// Makefile (or here with a C compiler); a third one crashes as it loads
const exe = process.platform === "win32" ? ".dll" : "";
let testPlugDir = path.join(path.dirname(bin), "test-plugins");
if (!fs.existsSync(path.join(testPlugDir, "central-test.clap"))) {
  testPlugDir = path.join(tmp, "test-plugins"); fs.mkdirSync(testPlugDir, { recursive: true });
  const src = path.join(here, "plughost", "test", "test-plugins.c"), cc = process.env.CC || (process.platform === "win32" ? "gcc" : "cc");
  if (process.platform === "linux") spawnSync("bash", [path.join(here, "plughost", "test", "make-test-plugins.sh"), tmp, "linux"], { stdio: "inherit" });
  else for (const [name, def] of [["central-test.clap", []], ["crash-test.clap", ["-DCENTRAL_TEST_CRASH"]]]) spawnSync(cc, ["-shared", "-fPIC", "-O2", ...def, "-o", path.join(testPlugDir, name), src, "-lm"], { stdio: "inherit" });
}
const testClap = path.join(testPlugDir, "central-test.clap"), havePlugins = fs.existsSync(testClap);
if (!havePlugins) { if (process.env.CI) { console.error("  ✗ the test plugins are missing (make builds them into test-plugins/ next to cu-rig)"); process.exit(1); } console.log("  (no test plugins and no C compiler: the plugin checks are skipped)"); }
const gainPlug = { format: "clap", id: "audio.motion.test-gain", path: testClap, name: "Central Test Gain" }, synthPlug = { format: "clap", id: "audio.motion.test-synth", path: testClap, name: "Central Test Synth" };
const plugFx = (uid, extra) => Object.assign({ uid, id: "plug", plugin: gainPlug, on: true, mix: 1, levelDb: 0 }, extra || {});
const electric = (chain) => ({ action: "apply", config: { kind: "electric", input: { device: "auto", channel: "L", gainDb: 0, gateOn: false }, chain, levelDb: 0, routing: {} } });
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, what + ": " + a + " (expected about " + b + ")");
const formats = { clap: { fx: gainPlug, synth: synthPlug } };
if (havePlugins) {
  await check("plugins: a scan finds the CLAP (and VST3) effects and instruments, each file in a process of its own, and lists the plugin that crashes as failed", async () => {
    send({ action: "plugins", scan: true, force: true, folders: [testPlugDir] });
    const l = await next((m) => m.type === "pluginList" && m.plugins.some((x) => x.id === "audio.motion.test-gain"), 60000);
    const fx = l.plugins.find((x) => x.id === "audio.motion.test-gain"), syn = l.plugins.find((x) => x.id === "audio.motion.test-synth");
    assert.equal(fx.kind, "effect"); assert.equal(fx.format, "clap"); assert.equal(fx.name, "Central Test Gain"); assert.equal(fx.vendor, "Motion Audio");
    assert.ok(syn && syn.kind === "instrument", "the synth is an instrument");
    assert.ok(l.failed.some((f) => /crash-test/.test(f.path)), "the crashing plugin is listed as failed: " + JSON.stringify(l.failed));
    assert.ok(/clap/.test(l.formats), "formats " + l.formats);
    assert.equal(p.exitCode, null, "the rig is still running");
    if (process.env.CI) assert.ok(/vst3/.test(l.formats) && fs.existsSync(path.join(testPlugDir, "central-test.vst3")), "in CI the VST3 test plugin is there and VST3 is hosted: " + l.formats);
    if (/vst3/.test(l.formats) && fs.existsSync(path.join(testPlugDir, "central-test.vst3"))) {
      const vfx = l.plugins.find((x) => x.format === "vst3" && x.name === "Central Test Gain VST3"), vsyn = l.plugins.find((x) => x.format === "vst3" && x.name === "Central Test Synth VST3");
      assert.ok(vfx && vfx.kind === "effect" && vfx.vendor === "Motion Audio" && /^[0-9A-F]{32}$/.test(vfx.id), "the VST3 effect: " + JSON.stringify(vfx));
      assert.ok(vsyn && vsyn.kind === "instrument", "the VST3 instrument: " + JSON.stringify(vsyn));
      formats.vst3 = { fx: vfx, synth: vsyn };
    }
  });
  for (const [fmt, pl] of Object.entries(formats)) {
    if (fmt === "clap") continue;
    await check(fmt.toUpperCase() + ": an effect's Gain works live and comes back from its saved state; an instrument plays a keys layer", async () => {
      send({ action: "testtone", freq: 196, level: 0.3 });
      send(electric([{ uid: "vg1", id: "plug", plugin: pl.fx, on: true, mix: 1, levelDb: 0 }])); const st = await next((m) => m.type === "instrumentStatus" && m.kind === "electric" && m.pluginSlots && (m.pluginSlots.vg1 || m.pluginErrors.vg1));
      assert.ok(st.pluginSlots.vg1, "loaded: " + JSON.stringify(st.pluginErrors)); await sleep(400); near((await meters()).out, 0.3, 0.03, "unity");
      send({ action: "pluginParams", uid: "vg1" }); const pr = await next((m) => m.type === "pluginParams" && m.uid === "vg1"); assert.equal(pr.params[0].name, "Gain"); assert.match(pr.params[0].text, /0\.0 dB/);
      send({ action: "pluginSet", uid: "vg1", id: pr.params[0].id, value: 0.75 }); await sleep(400); near((await meters()).out, 0.3 * 3.98, 0.1, "+12 dB");
      send({ action: "apply", config: { kind: "off" } }); await next((m) => m.type === "instrumentStatus" && m.kind === "off");
      send(electric([{ uid: "vg1", id: "plug", plugin: pl.fx, on: true, mix: 1, levelDb: 0 }])); await sleep(500); near((await meters()).out, 0.3 * 3.98, 0.1, "+12 dB after reloading");
      send({ action: "testtone", level: 0 });
      send({ action: "apply", config: { kind: "keys", keys: { volume: 1, layers: [{ uid: "vl1", plugin: pl.synth, volume: 1 }] }, chain: [], levelDb: 0, routing: {} } });
      await next((m) => m.type === "instrumentStatus" && m.kind === "keys"); await sleep(300);
      send({ action: "note", on: true, note: 69, velocity: 127 }); await sleep(300); const on = await meters(); assert.ok(on.out > 0.1, "a note sounds: " + on.out);
      send({ action: "note", on: false, note: 69, velocity: 0 }); await sleep(300); const off = await meters(); assert.ok(off.out < 0.01, "note off stops it: " + off.out);
    });
  }
  await check("a CLAP effect in the board: it passes sound, its Gain parameter works live, and the app sees it", async () => {
    send({ action: "testtone", freq: 196, level: 0.3 });
    send(electric([plugFx("pg1")])); await sleep(500); const a = await meters(); near(a.out, 0.3, 0.03, "unity gain");
    send({ action: "pluginParams", uid: "pg1" }); const pr = await next((m) => m.type === "pluginParams" && m.uid === "pg1");
    assert.equal(pr.params.length, 1); assert.equal(pr.params[0].name, "Gain"); near(pr.params[0].value, 0.5, 0.001, "Gain (normalized)"); assert.match(pr.params[0].text, /0\.0 dB/);
    send({ action: "pluginSet", uid: "pg1", id: pr.params[0].id, value: 0.75 }); await sleep(400); const b = await meters(); near(b.out, 0.3 * Math.pow(10, 12 / 20), 0.08, "+12 dB");
    send({ action: "status" }); const s = await next((m) => m.type === "instrumentStatus" && m.pluginSlots && m.pluginSlots.pg1);
    assert.equal(s.pluginSlots.pg1.name, "Central Test Gain"); assert.equal(s.pluginSlots.pg1.instrument, false);
    send({ action: "bypass", uid: "pg1", on: false }); await sleep(300); const c = await meters(); near(c.out, 0.3, 0.03, "bypassed");
  });
  await check("a plugin keeps its settings: through board changes (same instance), after it is removed (saved state), and a new pedal can start from it", async () => {
    send(electric([item("ts9", {}, { uid: "drv", on: false }), plugFx("pg1")])); await sleep(400); near((await meters()).out, 0.3 * 3.98, 0.1, "still +12 dB after the board changed");
    send({ action: "apply", config: { kind: "off" } }); await next((m) => m.type === "instrumentStatus" && m.kind === "off");
    assert.ok(fs.existsSync(path.join(tmp, "data", "plugin-states", "pg1.state")), "the state file was saved");
    send(electric([plugFx("pg1")])); await sleep(500); near((await meters()).out, 0.3 * 3.98, 0.1, "+12 dB restored from the saved state");
    send(electric([plugFx("pg2", { stateFrom: "pg1" })])); await sleep(500); near((await meters()).out, 0.3 * 3.98, 0.1, "a new slot started from pg1's state");
    send({ action: "pluginCopyState", from: "pg1", to: "board1" }); const cp = await next((m) => m.type === "pluginCopyState"); assert.equal(cp.ok, true);
  });
  await check("(10.3) the DAW's native plugins, live: a chain with its latency, blocks streamed through it, automation inside a block, a reset plays out what's left", async () => {
    const dly = { slot: "dwlive1", format: "clap", id: "audio.motion.test-delay", path: testClap, name: "Central Test Delay" }, gn = { slot: "dwlive2", format: "clap", id: "audio.motion.test-gain", path: testClap, name: "Central Test Gain" };
    send({ action: "dawChain", stream: 3, rate: 48000, plugins: [dly, Object.assign({ params: [[1, 0.75]] }, gn)] });
    const ch = await next((m) => m.type === "dawChain" && m.stream === 3, 20000); assert.ok(ch.ok, JSON.stringify(ch)); assert.equal(ch.latency, 480); assert.deepEqual(ch.names, ["Central Test Delay", "Central Test Gain"]);
    const F = 4096, enc = (f) => Buffer.from(f.buffer).toString("base64"), dec = (b) => new Float32Array(Buffer.from(b, "base64").buffer.slice(0));
    const imp = new Float32Array(F * 2); imp[2 * 100] = imp[2 * 100 + 1] = 0.25;
    send({ action: "dawProcess", seq: 1, frames: F, streams: [{ s: 3, d: enc(imp), reset: true }, { s: 9, d: enc(imp) }] });
    const r1 = await next((m) => m.type === "dawProcessed" && m.seq === 1, 20000), o = dec(r1.streams[0].d), thru = dec(r1.streams[1].d);
    assert.equal(r1.streams[0].lat, 480); let at = -1; for (let i = 0; i < F; i++) if (Math.abs(o[2 * i]) > 0.1) { at = i; break; }
    assert.equal(at, 580, "the impulse comes out 480 samples later"); near(o[2 * 580], 0.25 * 3.98, 0.02, "+12 dB from the knob given with the chain");
    assert.equal(thru[200], 0.25, "a stream without plugins passes through");
    const sine = new Float32Array(F * 2); for (let i = 0; i < F; i++) sine[2 * i] = sine[2 * i + 1] = 0.1;
    send({ action: "dawProcess", seq: 2, frames: F, streams: [{ s: 3, d: enc(sine), a: [[2048, 1, 1, 0.5]] }] });
    const o2 = dec((await next((m) => m.type === "dawProcessed" && m.seq === 2, 20000)).streams[0].d);
    near(o2[2 * 1000], 0.1 * 3.98, 0.02, "before the automation point"); near(o2[2 * (2048 + 480 + 200)], 0.1, 0.01, "after it (0 dB), the delay's latency later");
    send({ action: "dawProcess", seq: 3, frames: F, streams: [{ s: 3, d: enc(new Float32Array(F * 2)), reset: true }] });
    const o3 = dec((await next((m) => m.type === "dawProcessed" && m.seq === 3, 20000)).streams[0].d); let mx = 0; for (let i = 0; i < F; i++) mx = Math.max(mx, Math.abs(o3[2 * i]));
    assert.ok(mx < 1e-6, "after a reset nothing old comes out: " + mx);
    send({ action: "dawDrop", stream: 3 });
  });
  await check("(10.2) the DAW's native inserts, offline: --process plays a sound through the slot's saved state, lines it up and reports the latency", async () => {
    send({ action: "pluginSave" }); await sleep(200);
    const rate = 48000, n = rate, buf = new Float32Array(n * 2); for (let i = 0; i < n; i++) { buf[2 * i] = buf[2 * i + 1] = 0.25 * Math.sin(2 * Math.PI * 220 * i / rate); }
    const inF = path.join(tmp, "daw-in.f32"), outF = path.join(tmp, "daw-out.f32"), job = path.join(tmp, "daw-job.json"); fs.writeFileSync(inF, Buffer.from(buf.buffer));
    fs.writeFileSync(job, JSON.stringify({ rate, frames: n, in: inF, out: outF, tail: 0.5, plugins: [Object.assign({ slot: "pg1" }, gainPlug)] }));
    const r = spawnSync(bin, ["--data", path.join(tmp, "data"), "--process", job], { encoding: "utf8", timeout: 60000 }), line = JSON.parse(r.stdout.trim().split("\n").pop());
    assert.ok(line.ok, JSON.stringify(line)); assert.equal(line.frames, n + rate / 2); assert.equal(line.latency, 0); assert.deepEqual(line.names, ["Central Test Gain"]);
    const o = new Float32Array(fs.readFileSync(outF).buffer.slice(0)); let pk = 0; for (let i = 1000; i < n - 1000; i++) pk = Math.max(pk, Math.abs(o[2 * i]));
    near(pk, 0.25 * 3.98, 0.05, "+12 dB from the saved state");
    fs.writeFileSync(job, JSON.stringify({ rate, frames: n, in: inF, out: outF, plugins: [{ slot: "zz", format: "clap", id: "no.such", path: testClap, name: "Nothing" }] }));
    const bad = JSON.parse(spawnSync(bin, ["--data", path.join(tmp, "data"), "--process", job], { encoding: "utf8", timeout: 60000 }).stdout.trim().split("\n").pop());
    assert.equal(bad.ok, false); assert.match(bad.error, /Nothing didn't load/);
  });
  await check("a plugin that is missing says why, and the rest of the board still plays", async () => {
    send(electric([plugFx("pgx", { plugin: { format: "clap", id: "no.such.plugin", path: testClap } }), item("ts9", {}, { uid: "drv" })]));
    const s = await next((m) => m.type === "instrumentStatus" && m.pluginErrors && m.pluginErrors.pgx); assert.ok(s.pluginErrors.pgx.length > 3, s.pluginErrors.pgx);
    await sleep(300); const m = await meters(); assert.ok(m.out > 0.05, "the drive still plays: " + m.out);
    send(electric([plugFx("pgv", { plugin: { format: "vst3", id: "0123", path: path.join(tmp, "nothing.vst3") } })])); const v = await next((x) => x.type === "instrumentStatus" && x.pluginErrors && x.pluginErrors.pgv); assert.ok(v.pluginErrors.pgv, "a VST3 that isn't there");
  });
  await check("a CLAP instrument plays as a keys layer, with the layer's split, octave and volume", async () => {
    send({ action: "testtone", level: 0 });
    send({ action: "apply", config: { kind: "keys", keys: { volume: 1, layers: [{ uid: "lay1", plugin: synthPlug, volume: 1, lo: 0, hi: 127 }] }, chain: [], levelDb: 0, routing: {} } });
    await next((m) => m.type === "instrumentStatus" && m.kind === "keys"); await sleep(300);
    const quiet = await meters(); assert.ok(quiet.out < 0.01, "silent before a note: " + quiet.out);
    send({ action: "note", on: true, note: 69, velocity: 127 }); await sleep(300); const on = await meters(); assert.ok(on.out > 0.1, "a note sounds: " + on.out);
    send({ action: "note", on: false, note: 69, velocity: 0 }); await sleep(300); const off = await meters(); assert.ok(off.out < 0.01, "note off stops it: " + off.out);
    send({ action: "keys", keys: { volume: 1, layers: [{ uid: "lay1", plugin: synthPlug, volume: 1, lo: 0, hi: 59 }] } }); await sleep(200);
    send({ action: "note", on: true, note: 69, velocity: 127 }); await sleep(300); const out = await meters(); assert.ok(out.out < 0.01, "a note above the split is not played: " + out.out);
    send({ action: "note", on: false, note: 69, velocity: 0 });
    send({ action: "status" }); const s = await next((m) => m.type === "instrumentStatus" && m.pluginSlots && m.pluginSlots.lay1); assert.equal(s.pluginSlots.lay1.instrument, true);
  });
}
if (havePlugins) await check("a plugin that crashes the engine as it loads is paused after the restart (until Scan again), so it can't crash it again", async () => {
  const data2 = path.join(tmp, "data-crash"), crash = { format: "clap", id: "audio.motion.test-gain", path: path.join(testPlugDir, "crash-test.clap"), name: "Crash" };
  const run = () => { const q = spawn(bin, ["--data", data2, "--backend", "null"], { stdio: ["pipe", "pipe", "ignore"] }); let b = "", got = []; q.stdout.on("data", (c) => { b += c; let i; while ((i = b.indexOf("\n")) >= 0) { try { got.push(JSON.parse(b.slice(0, i))); } catch (_) { } b = b.slice(i + 1); } }); return { q, got, send: (m) => q.stdin.write(JSON.stringify(m) + "\n") }; };
  const cfg = { action: "apply", config: { kind: "electric", input: { device: "auto", channel: "L", gainDb: 0, gateOn: false }, chain: [{ uid: "cr1", id: "plug", plugin: crash, on: true, mix: 1, levelDb: 0 }], levelDb: 0, routing: {} } };
  const a = run(); await sleep(300); a.send(cfg); const code = await new Promise((r) => { a.q.on("exit", (c, sig) => r(c === null ? sig : c)); setTimeout(() => r("still running"), 8000); });
  assert.notEqual(code, "still running", "the crash plugin should take the first engine down"); assert.notEqual(code, 0);
  const b = run(); await sleep(300); b.send(cfg); await sleep(1500);
  const st = b.got.filter((m) => m.type === "instrumentStatus" && m.pluginErrors && m.pluginErrors.cr1).pop();
  assert.ok(st && /paused/.test(st.pluginErrors.cr1), "paused after the crash: " + JSON.stringify(st && st.pluginErrors));
  assert.equal(b.q.exitCode, null, "the second engine is still running");
  b.send({ action: "plugins", scan: true, force: true, folders: [] }); await sleep(400);
  assert.equal(fs.readFileSync(path.join(data2, "plugin-paused.txt"), "utf8").trim(), "", "Scan again un-pauses it");
  b.q.stdin.end(); if (a.q.exitCode === null) a.q.kill();
});
await check("off stops the audio", async () => { send({ action: "apply", config: { kind: "off" } }); const s = await next((m) => m.type === "instrumentStatus" && m.kind === "off"); assert.equal(s.running, false); });
p.stdin.end();
setTimeout(() => { p.kill(); console.log(failures ? "\n" + failures + " RIG CHECK(S) FAILED" : "\nALL RIG CHECKS PASSED"); process.exit(failures ? 1 : 0); }, 800);
