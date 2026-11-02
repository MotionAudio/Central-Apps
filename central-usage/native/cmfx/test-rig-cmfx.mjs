// Central FX plugins (10.2) in the rig and on the Central Pedal's extra stage.
//   node cmfx/test-rig-cmfx.mjs [build folder]      (make test-cmfx)
// cu-rig (Central Usage / Central Control's boards, the Studio's effects) with null audio: a scan finds .cmfx.json
// files, a board plays one, its knobs work live from the app and come back from its saved state, a code plugin plays;
// a community one is checked (switch, record, sha256) and stopped live when taken down or switched off. Then
// cm-pwnode (Linux, the Central Pedal) takes Central FX plugins as well as community ones.
import { spawn } from "node:child_process";
import assert from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url)), native = path.join(here, ".."), root = path.join(native, "..", "..");
const out = path.resolve(process.argv[2] || path.join(native, "build")), exe = process.platform === "win32" ? ".exe" : "";
const rig = path.join(out, "cu-rig" + exe);
if (!fs.existsSync(rig)) { console.error("  ✗ missing " + rig + " (make builds it)"); process.exit(1); }
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cmfx-rig-")));
let failures = 0;
const ok = (m) => console.log("  ✓ " + m), bad = (m) => { failures++; console.error("  ✗ " + m); };
async function check(label, fn) { try { await fn(); ok(label); } catch (e) { bad(label + "\n      " + (e && e.message || e)); } }

const gainPlugin = { format: "central-fx", version: 1, name: "Test Volume", author: "Motion Audio", params: [{ id: "g", name: "Gain", min: -24, max: 12, default: 0, unit: "dB" }],
  graph: { blocks: [{ id: "in", type: "input" }, { id: "v", type: "gain", props: { gain: { param: "g" } } }, { id: "out", type: "output" }], wires: [{ from: "in", to: "v" }, { from: "v", to: "out" }] } };
const plugDir = path.join(tmp, "my-fx"); fs.mkdirSync(plugDir);
const gainFile = path.join(plugDir, "test-volume.cmfx.json"); fs.writeFileSync(gainFile, JSON.stringify(gainPlugin));
fs.writeFileSync(path.join(plugDir, "broken.cmfx.json"), JSON.stringify({ format: "central-fx", name: "Broken", graph: { blocks: [{ id: "x", type: "nope" }] } }));
const ringFile = path.join(root, "production", "plugin-builder", "presets", "ring-mod-code.cmfx.json");

function rigProc(data) {
  const p = spawn(rig, ["--data", data, "--backend", "null", "--block", "256"], { stdio: ["pipe", "pipe", "inherit"] });
  let buf = ""; const msgs = [];
  p.stdout.on("data", (c) => { buf += c; let i; while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); try { msgs.push(JSON.parse(line)); } catch (_) { } } });
  const waitFor = async (t, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { const i = msgs.findIndex(t); if (i >= 0) return msgs.splice(i, 1)[0]; await new Promise((r) => setTimeout(r, 40)); } throw new Error("timeout waiting"); };
  const send = (m) => p.stdin.write(JSON.stringify(m) + "\n");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const meters = async () => { send({ action: "meters" }); await sleep(300); msgs.splice(0, msgs.length, ...msgs.filter((m) => m.type !== "instrumentMeters")); send({ action: "meters" }); return waitFor((m) => m.type === "instrumentMeters"); };
  return { p, msgs, waitFor, send, sleep, meters };
}
const electric = (chain) => ({ action: "apply", config: { kind: "electric", input: { device: "auto", channel: "L", gainDb: 0, gateOn: false }, chain, levelDb: 0, routing: {} } });
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, what + ": " + a + " (expected about " + b + ")");

console.log("Central FX in the rig:");
const data = path.join(tmp, "data"); fs.mkdirSync(data);
const R = rigProc(data);
try {
  await R.waitFor((m) => m.type === "instrumentStatus");
  let found = null;
  await check("a scan finds Central FX plugins (.cmfx.json) and lists a broken one as failed, with the reason", async () => {
    R.send({ action: "plugins", scan: true, force: true, folders: [plugDir] });
    const l = await R.waitFor((m) => m.type === "pluginList" && m.plugins.some((x) => x.format === "cmfx"), 60000);
    found = l.plugins.find((x) => x.format === "cmfx" && x.name === "Test Volume");
    assert.ok(found && found.kind === "effect" && found.vendor === "Motion Audio" && found.path === gainFile, JSON.stringify(l.plugins.filter((x) => x.format === "cmfx")));
    assert.ok(l.failed.some((f) => /broken/.test(f.path) && /block type/.test(f.error)), "the broken one: " + JSON.stringify(l.failed));
    assert.ok(/cmfx/.test(l.formats), "formats " + l.formats);
  });
  await check("a board plays it; its knob works live from the app (+12 dB)", async () => {
    R.send({ action: "testtone", freq: 196, level: 0.3 });
    R.send(electric([{ uid: "cf1", id: "plug", plugin: { format: "cmfx", id: "Test Volume", path: gainFile }, on: true, mix: 1, levelDb: 0 }]));
    const st = await R.waitFor((m) => m.type === "instrumentStatus" && m.kind === "electric" && m.pluginSlots && (m.pluginSlots.cf1 || (m.pluginErrors || {}).cf1));
    assert.ok(st.pluginSlots.cf1, "loaded: " + JSON.stringify(st.pluginErrors));
    await R.sleep(500); near((await R.meters()).out, 0.3, 0.05, "0 dB");
    R.send({ action: "pluginParams", uid: "cf1" }); const pr = await R.waitFor((m) => m.type === "pluginParams" && m.uid === "cf1");
    assert.equal(pr.params[0].name, "Gain"); assert.match(pr.params[0].text, /0\.00 dB/);
    R.send({ action: "pluginSet", uid: "cf1", id: pr.params[0].id, value: 1 }); await R.sleep(500); near((await R.meters()).out, 0.3 * 3.98, 0.12, "+12 dB");
  });
  await check("it keeps its knobs through a board change (its saved state)", async () => {
    R.send({ action: "apply", config: { kind: "off" } }); await R.waitFor((m) => m.type === "instrumentStatus" && m.kind === "off");
    R.send(electric([{ uid: "cf1", id: "plug", plugin: { format: "cmfx", id: "Test Volume", path: gainFile }, on: true, mix: 1, levelDb: 0 }])); await R.sleep(700);
    near((await R.meters()).out, 0.3 * 3.98, 0.12, "+12 dB after reloading");
  });
  await check("a plugin written in code plays on a board", async () => {
    R.send(electric([{ uid: "cf2", id: "plug", plugin: { format: "cmfx", id: "Ring Modulator (code)", path: ringFile }, on: true, mix: 1, levelDb: 0 }]));
    const st = await R.waitFor((m) => m.type === "instrumentStatus" && m.kind === "electric" && m.pluginSlots && (m.pluginSlots.cf2 || (m.pluginErrors || {}).cf2));
    assert.ok(st.pluginSlots.cf2, JSON.stringify(st.pluginErrors)); await R.sleep(400); const m = await R.meters(); assert.ok(m.out > 0.05 && m.out < 2, "out " + m.out);
  });

  // a community one
  const libs = path.join(tmp, "libraries"), cdir = path.join(libs, "community-plugins", "community-9"); fs.mkdirSync(cdir, { recursive: true });
  fs.writeFileSync(path.join(libs, "community-plugins.json"), JSON.stringify({ on: true }));
  const cfile = path.join(cdir, "shared-volume.cmfx.json"); fs.writeFileSync(cfile, JSON.stringify(Object.assign({}, gainPlugin, { name: "Shared Volume" })));
  const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
  const record = (h) => fs.writeFileSync(path.join(libs, "community-9.json"), JSON.stringify({ id: "community-9", title: "Shared Volume", community: { item: 9, creator: "Someone", kind: "plugin" },
    plugins: [{ name: "Shared Volume", format: "cmfx", platform: "all", bundle: "shared-volume.cmfx.json", path: cfile, binaries: [{ name: "shared-volume.cmfx.json", sha256: h }] }] }));
  const comm = (uid) => electric([{ uid, id: "plug", plugin: { format: "cmfx", id: "Shared Volume", path: cfile }, on: true, mix: 1, levelDb: 0 }]);
  await check("a community Central FX plugin whose file isn't the one Motion Audio checked doesn't start", async () => {
    record("0".repeat(64)); R.send(comm("cc0"));
    const st = await R.waitFor((m) => m.type === "instrumentStatus" && m.kind === "electric" && ((m.pluginErrors || {}).cc0 || (m.pluginSlots || {}).cc0));
    assert.ok(!st.pluginSlots.cc0 && /don't match/.test(st.pluginErrors.cc0), JSON.stringify(st.pluginErrors));
  });
  await check("a checked community one plays (in this process: no wall needed) and says it's a community plugin", async () => {
    record(sha(cfile)); R.send(comm("cc1"));
    const st = await R.waitFor((m) => m.type === "instrumentStatus" && m.kind === "electric" && ((m.pluginSlots || {}).cc1 || (m.pluginErrors || {}).cc1));
    assert.ok(st.pluginSlots.cc1 && st.pluginSlots.cc1.community, JSON.stringify(st));
  });
  await check("switching community plugins off stops it live; taking it down does too", async () => {
    fs.writeFileSync(path.join(libs, "community-plugins.json"), JSON.stringify({ on: false }));
    const ev = await R.waitFor((m) => m.type === "pluginBypassed" && m.uid === "cc1", 6000); assert.equal(ev.reason, "off");
    fs.writeFileSync(path.join(libs, "community-plugins.json"), JSON.stringify({ on: true }));
    R.send({ action: "pluginRestart", uid: "cc1" }); R.send(comm("cc1")); await R.sleep(600);
    fs.rmSync(cdir, { recursive: true, force: true });
    const ev2 = await R.waitFor((m) => m.type === "pluginBypassed" && m.uid === "cc1", 6000); assert.equal(ev2.reason, "revoked");
    near((await R.meters()).out, 0.3, 0.06, "the board keeps playing (dry)");
  });
} finally { R.p.stdin.end(); await new Promise((r) => setTimeout(r, 300)); try { R.p.kill("SIGKILL"); } catch (_) { } }

// ---- the Central Pedal's extra stage
const pwnode = path.join(out, "cm-pwnode");
if (process.platform === "linux" && fs.existsSync(pwnode)) {
  console.log("Central FX on the Central Pedal (cm-pwnode):");
  const d2 = path.join(tmp, "pi"); fs.mkdirSync(d2);
  const p = spawn(pwnode, ["--data", d2, "--name", "cm-fx-test"], { stdio: ["pipe", "pipe", "pipe"] });
  let buf = ""; const msgs = [];
  p.stdout.on("data", (c) => { buf += c; let i; while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); try { msgs.push(JSON.parse(line)); } catch (_) { } } });
  const waitFor = async (t, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { const i = msgs.findIndex(t); if (i >= 0) return msgs.splice(i, 1)[0]; await new Promise((r) => setTimeout(r, 40)); } throw new Error("timeout"); };
  const send = (m) => p.stdin.write(JSON.stringify(m) + "\n");
  await check("the extra stage hosts a Central FX plugin (and still refuses other plugins that aren't community ones)", async () => {
    await waitFor((m) => m.type === "communityStatus");
    send({ action: "chain", items: [{ uid: "px1", plugin: { format: "cmfx", id: "Test Volume", path: gainFile }, on: true, mix: 1 }, { uid: "px2", plugin: { format: "clap", id: "x", path: "/nowhere/x.clap" }, on: true, mix: 1 }] });
    const st = await waitFor((m) => m.type === "communityStatus" && m.slots && m.slots.px1);
    assert.equal(st.slots.px1.format, "cmfx"); assert.ok(/only community/.test(st.errors.px2), JSON.stringify(st.errors));
    send({ action: "pluginParams", uid: "px1" }); const pr = await waitFor((m) => m.type === "pluginParams" && m.uid === "px1"); assert.equal(pr.params[0].name, "Gain");
  });
  p.stdin.end(); await new Promise((r) => setTimeout(r, 300)); try { p.kill("SIGKILL"); } catch (_) { }
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures ? "\n" + failures + " FAILED" : "\nall passed");
process.exit(failures ? 1 : 0);
