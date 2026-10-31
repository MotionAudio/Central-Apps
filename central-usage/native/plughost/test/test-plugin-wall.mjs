// The community plugin wall's checks (10.1; docs/COMMUNITY-PLUGINS.md). Linux and macOS.
//   node plughost/test/test-plugin-wall.mjs [build folder]      (make test-wall)
// Sets up a libraries folder the way the apps install a Make & sell library (community-plugins.json switched on,
// community-plugins/<id>/<bundle>, the <id>.json record with each program file's sha256), then:
//   1. test-bridge: audio round-trips through cm-plugbridge with bounded latency, parameters and presets cross the wall,
//      the wall blocks the internet, the musician's files and starting programs, a crashing / hung / too heavy plugin
//      is bypassed while the sound goes on, a revoked or switched-off plugin stops live, a changed program file
//      doesn't start;
//   2. through cu-rig, as the app uses it: the board plays a community plugin, the app hears pluginBypassed when it
//      crashes, "Try again" (pluginRestart) brings it back, and revoking it unloads it live.
import { spawn, spawnSync } from "node:child_process";
import assert from "node:assert";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url)), native = path.join(here, "..", "..");
const out = path.resolve(process.argv[2] || path.join(native, "build"));
const need = (f) => { if (!fs.existsSync(f)) { console.error("  ✗ missing " + f + " (make test-wall builds it)"); process.exit(1); } return f; };
if (process.platform === "win32") { console.log("  (Windows: community plugins don't run there - nothing to test)"); process.exit(0); }
const rig = need(path.join(out, "cu-rig")), bridge = need(path.join(out, "cm-plugbridge")), tb = need(path.join(out, "test-bridge"));
const plugs = path.join(out, "test-plugins"), gain = need(path.join(plugs, "central-test.clap")), evil = need(path.join(plugs, "evil-test.clap"));
void bridge;

if (process.platform === "linux") {
  const bw = spawnSync("bwrap", ["--unshare-all", "--die-with-parent", "--ro-bind", "/", "/", "true"], { encoding: "utf8" });
  if (bw.status !== 0) {
    const why = bw.error ? "bubblewrap isn't installed" : "bubblewrap can't make its namespaces here (" + (bw.stderr || "").trim() + ")";
    if (process.env.CI && !process.env.CM_ALLOW_NO_BWRAP) { console.error("  ✗ " + why); process.exit(1); }
    console.log("  (" + why + ": the wall's checks are skipped)"); process.exit(0);
  }
}

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cm-wall-")));
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
function install(libs, id, src, bundle, extra) {
  const dir = path.join(libs, "community-plugins", id); fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(src, path.join(dir, bundle)); fs.chmodSync(path.join(dir, bundle), 0o755);
  for (const [n, body] of Object.entries(extra || {})) fs.writeFileSync(path.join(dir, n), body);
  fs.writeFileSync(path.join(libs, id + ".json"), JSON.stringify({ id, title: id, community: { item: 1, creator: "Test Creator", kind: "plugin" },
    plugins: [{ name: bundle, format: "clap", platform: process.platform === "darwin" ? "mac" : "linux-" + (process.arch === "arm64" ? "aarch64" : "x86_64"), bundle, path: path.join(dir, bundle), binaries: [{ name: bundle, sha256: sha(path.join(dir, bundle)) }] }] }));
  return path.join(dir, bundle);
}
function setup(name) {
  const libs = path.join(tmp, name, "libraries"), data = path.join(tmp, name, "data"); fs.mkdirSync(libs, { recursive: true }); fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(path.join(libs, "community-plugins.json"), JSON.stringify({ on: true }));
  const secret = path.join(tmp, name, "musician-secret.txt"); fs.writeFileSync(secret, "the musician's own file");
  return { libs, data, secret, gain: install(libs, "community-7", gain, "central-test.clap"), evil: install(libs, "community-8", evil, "evil-test.clap", { "probe-path.txt": secret + "\n" }) };
}

let failures = 0;
const ok = (label) => console.log("  ✓ " + label), bad = (label) => { failures++; console.error("  ✗ " + label); };

// ---- 1. the bridge and the wall, through the plugin host's API
console.log("Community plugins, walled off (" + process.platform + "):");
{
  const s = setup("bridge");
  // (sanity: the probe can do what it says - outside the wall it reads and writes the musician's file)
  const r = spawnSync(tb, [s.libs, s.data], { encoding: "utf8", timeout: 240000, env: Object.assign({}, process.env, { CM_WALL_DEBUG: "1" }) });
  for (const line of (r.stdout || "").split("\n")) { if (line.startsWith("ok ")) ok(line.slice(3)); else if (line.startsWith("FAIL ")) bad(line.slice(5)); }
  if (r.status !== 0 && !/summary/.test(r.stdout || "")) bad("test-bridge ended early: " + (r.error || r.signal || r.status) + "\n" + (r.stderr || "").slice(-2000));
  if (failures && process.platform === "darwin") macWhy(r.stderr || "");
}
// (macOS) why the walled-off host didn't start: its own errors, the profile run by hand, the sandbox's refusals, a crash report
function macWhy(stderr) {
  const say = (title, text) => console.error("    (" + title + ")\n      " + String(text || "").trim().slice(-3000).replace(/\n/g, "\n      "));
  say("test-bridge stderr", stderr.slice(-3000));
  const m = /cm-wall: profile (\S+) exe (\S+) plugin (\S+)/.exec(stderr);
  if (m) {
    const plain = spawnSync(m[2], [], { encoding: "utf8", timeout: 20000 }); say("cm-plugbridge with no arguments, no wall: status " + plain.status + " signal " + plain.signal, plain.stderr);
    if (fs.existsSync(m[1])) {
      say("the profile", fs.readFileSync(m[1], "utf8"));
      const walled = spawnSync("/usr/bin/sandbox-exec", ["-f", m[1], m[2]], { encoding: "utf8", timeout: 20000 }); say("cm-plugbridge with no arguments, walled: status " + walled.status + " signal " + walled.signal, walled.stderr);
      const tr = spawnSync("/usr/bin/sandbox-exec", ["-f", m[1], "/usr/bin/true"], { encoding: "utf8", timeout: 20000 }); say("/usr/bin/true walled (should be refused): status " + tr.status, tr.stderr);
    }
  }
  const lg = spawnSync("/usr/bin/log", ["show", "--last", "5m", "--style", "compact", "--predicate", 'sender == "Sandbox" OR eventMessage CONTAINS "cm-plugbridge"'], { encoding: "utf8", timeout: 60000 });
  say("the sandbox's log", (lg.stdout || "").split("\n").filter((l) => /deny|cm-plugbridge/i.test(l)).slice(-60).join("\n"));
  const dr = path.join(os.homedir(), "Library/Logs/DiagnosticReports");
  try { for (const f of fs.readdirSync(dr).filter((f) => /cm-plugbridge/.test(f)).slice(-2)) say("crash report " + f, fs.readFileSync(path.join(dr, f), "utf8").slice(0, 3000)); } catch (_) { }
}

// ---- 2. through cu-rig, the way the apps use it
{
  const s = setup("rig");
  const p = spawn(rig, ["--data", s.data, "--backend", "null", "--block", "128"], { stdio: ["pipe", "pipe", "pipe"] });
  let buf = "", errBuf = ""; const msgs = [], waiters = [];
  p.stderr.on("data", (c) => { errBuf += c; });
  p.stdout.on("data", (c) => { buf += c; let i; while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); let m; try { m = JSON.parse(line); } catch (_) { continue; } msgs.push(m); waiters.slice().forEach((w) => { if (w.t(m)) { waiters.splice(waiters.indexOf(w), 1); w.r(m); } }); } });
  const send = (m) => p.stdin.write(JSON.stringify(m) + "\n");
  const next = (t, ms = 8000) => { const old = msgs.find(t); if (old) { msgs.splice(msgs.indexOf(old), 1); return Promise.resolve(old); } return new Promise((res, rej) => { waiters.push({ t, r: (m) => { msgs.splice(msgs.indexOf(m), 1); res(m); } }); setTimeout(() => rej(new Error("timeout")), ms); }); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const dropOld = (type) => { for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].type === type) msgs.splice(i, 1); };
  const meters = async () => { send({ action: "meters" }); await sleep(300); dropOld("instrumentMeters"); send({ action: "meters" }); return next((m) => m.type === "instrumentMeters"); };
  const board = (items) => ({ action: "apply", config: { kind: "electric", input: { device: "auto", channel: "L", gainDb: 0, gateOn: false }, chain: items, levelDb: 0, routing: {} } });
  const fx = (uid, file, id) => ({ uid, id: "plug", plugin: { format: "clap", id, path: file, name: "Test", community: true }, on: true, mix: 1, levelDb: 0 });
  async function check(label, fn) { try { await fn(); ok(label); } catch (e) { bad(label + "\n      " + (e && e.message || e)); } }
  try {
    await next((m) => m.type === "instrumentStatus", 10000);
    await check("the rig plays a community plugin on a board, walled off, and says it is one", async () => {
      dropOld("instrumentStatus"); send(board([fx("cp1", s.gain, "audio.motion.test-gain")]));
      const st = await next((m) => m.type === "instrumentStatus" && m.pluginSlots && (m.pluginSlots.cp1 || (m.pluginErrors && m.pluginErrors.cp1)), 15000);
      assert.ok(st.pluginSlots.cp1, "loaded: " + JSON.stringify(st.pluginErrors));
      assert.equal(st.pluginSlots.cp1.community, true);
      send({ action: "testtone", freq: 220, level: 0.3 }); await sleep(500);
      const m = await meters(); assert.ok(Math.abs(m.out - 0.3) < 0.04, "unity through the wall: " + m.out);
      send({ action: "pluginParams", uid: "cp1" }); const pr = await next((x) => x.type === "pluginParams" && x.uid === "cp1");
      assert.equal(pr.params[0].name, "Gain");
      send({ action: "pluginSet", uid: "cp1", id: pr.params[0].id, value: 0.75 }); await sleep(500);
      const m2 = await meters(); assert.ok(Math.abs(m2.out - 0.3 * 3.98) < 0.12, "+12 dB set across the wall: " + m2.out);
    });
    await check("a community plugin that crashes on the board: bypassed, the app is told, the board keeps playing; Try again brings it back", async () => {
      dropOld("instrumentStatus"); send(board([fx("cp2", s.evil, "audio.motion.test-evil")]));
      const st = await next((m) => m.type === "instrumentStatus" && m.pluginSlots && (m.pluginSlots.cp2 || (m.pluginErrors && m.pluginErrors.cp2)), 15000);
      assert.ok(st.pluginSlots.cp2, "loaded: " + JSON.stringify(st.pluginErrors));
      send({ action: "pluginParams", uid: "cp2" }); const pr = await next((x) => x.type === "pluginParams" && x.uid === "cp2");
      const mode = pr.params.find((q) => q.name === "Mode"), probe = pr.params.find((q) => q.name === "Probe");
      assert.equal(probe && probe.value, 0, "walled off (the probe got nowhere): " + JSON.stringify(probe));
      send({ action: "pluginSet", uid: "cp2", id: mode.id, value: 1 / 3 });
      const ev = await next((m) => m.type === "pluginBypassed" && m.uid === "cp2", 6000);
      assert.equal(ev.reason, "crashed");
      await sleep(300); const m = await meters(); assert.ok(Math.abs(m.out - 0.3) < 0.04, "the board plays on, dry: " + m.out);
      dropOld("instrumentStatus"); send({ action: "status" }); const s2 = await next((x) => x.type === "instrumentStatus" && x.pluginSlots && x.pluginSlots.cp2);
      assert.equal(s2.pluginSlots.cp2.bypassed, "crashed");
      fs.rmSync(path.join(s.data, "plugin-states", "cp2.state"), { force: true });   // (its saved Mode would crash it again)
      dropOld("instrumentStatus"); send({ action: "pluginRestart", uid: "cp2" });
      const s3 = await next((x) => x.type === "instrumentStatus" && x.pluginSlots && x.pluginSlots.cp2 && !x.pluginSlots.cp2.bypassed, 15000);
      assert.ok(s3.pluginSlots.cp2);
    });
    await check("a community plugin revoked while it plays is unloaded live, and the board keeps playing", async () => {
      dropOld("instrumentStatus"); send(board([fx("cp3", s.gain, "audio.motion.test-gain")]));
      await next((m) => m.type === "instrumentStatus" && m.pluginSlots && m.pluginSlots.cp3, 15000);
      const before = spawnSync("pgrep", ["-f", "cm-plugbridge clap audio.motion.test-gain"], { encoding: "utf8" }).stdout.trim();
      fs.rmSync(path.join(s.libs, "community-plugins", "community-7"), { recursive: true, force: true }); fs.rmSync(path.join(s.libs, "community-7.json"), { force: true });
      const ev = await next((m) => m.type === "pluginBypassed" && m.uid === "cp3", 6000);
      assert.equal(ev.reason, "revoked");
      await sleep(300); const m = await meters(); assert.ok(m.out > 0.2, "the board plays on: " + m.out);
      if (before && process.platform === "linux") { const after = spawnSync("pgrep", ["-f", "cm-plugbridge clap audio.motion.test-gain"], { encoding: "utf8" }).stdout.trim(); assert.equal(after, "", "its process is gone (was " + before + ")"); }
    });
  } finally {
    p.stdin.end(); await sleep(500); try { p.kill("SIGKILL"); } catch (_) { }
    if (failures && errBuf) console.error("    (rig stderr) " + errBuf.slice(-1500).replace(/\n/g, "\n    "));
  }
}

// ---- 3. the Central Pedal's community stage (cm-pwnode): its commands, walled-off plugins and live revoking (the
// PipeWire node itself needs a PipeWire server; without one it says so and still manages its plugins)
const pwnode = path.join(out, "cm-pwnode");
if (process.platform === "linux" && fs.existsSync(pwnode)) {
  const s = setup("pi");
  const p = spawn(pwnode, ["--data", s.data, "--name", "cm-community-test"], { stdio: ["pipe", "pipe", "pipe"] });
  let buf = ""; const msgs = [];
  p.stdout.on("data", (c) => { buf += c; let i; while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); try { msgs.push(JSON.parse(line)); } catch (_) { } } });
  const waitFor = async (t, ms = 10000) => { const end = Date.now() + ms; while (Date.now() < end) { const i = msgs.findIndex(t); if (i >= 0) return msgs.splice(i, 1)[0]; await new Promise((r) => setTimeout(r, 50)); } throw new Error("timeout"); };
  const send = (m) => p.stdin.write(JSON.stringify(m) + "\n");
  try {
    await waitFor((m) => m.type === "communityStatus");
    send({ action: "chain", items: [{ uid: "pc1", plugin: { format: "clap", id: "audio.motion.test-gain", path: s.gain }, on: true, mix: 1 }, { uid: "pc2", plugin: { format: "clap", id: "audio.motion.test-gain", path: gain }, on: true, mix: 1 }] });
    const st = await waitFor((m) => m.type === "communityStatus" && m.slots && m.slots.pc1);
    assert.equal(st.slots.pc1.community, true); assert.ok(/only community/.test(st.errors.pc2), "a plugin that isn't a community one is refused: " + JSON.stringify(st.errors));
    send({ action: "pluginParams", uid: "pc1" }); const pr = await waitFor((m) => m.type === "pluginParams" && m.uid === "pc1"); assert.equal(pr.params[0].name, "Gain");
    fs.rmSync(path.join(s.libs, "community-plugins", "community-7"), { recursive: true, force: true });
    const ev = await waitFor((m) => m.type === "pluginBypassed" && m.uid === "pc1", 6000); assert.equal(ev.reason, "revoked");
    ok("the Central Pedal's community stage (cm-pwnode) hosts community plugins walled off, refuses other plugins, and unloads a revoked one live");
  } catch (e) { bad("the Central Pedal's community stage (cm-pwnode): " + (e && e.message || e)); }
  finally { p.stdin.end(); await new Promise((r) => setTimeout(r, 400)); try { p.kill("SIGKILL"); } catch (_) { } }
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures ? "\n" + failures + " FAILED" : "\nall passed");
process.exit(failures ? 1 : 0);
