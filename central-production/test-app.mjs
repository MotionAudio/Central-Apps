// Central Production as the real Electron app: it opens on the start page; a track project is made, saved to disk as
// a .cmproj (in Documents/Central Production, listed under recent ones), and opened again from the list; a .cmproj
// given on the command line opens by itself; Install into my apps puts a personal library into this app (and into
// Central Control / Central Usage on this computer when they're there); the sound list includes the computer's banks.
//   bash prepare.sh && ELECTRON_PATH=<electron> xvfb-run -a node test-app.mjs
import { _electron as electron } from "playwright";
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import assert from "node:assert";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
let failures = 0; async function check(label, fn) { try { await fn(); console.log("  ✓ " + label); } catch (e) { failures++; console.error("  ✗ " + label + "\n      " + String(e && e.stack || e).split("\n").slice(0, 6).join("\n      ")); } }
const exe = [process.env.ELECTRON_PATH, path.join(here, "node_modules", "electron", "dist", "electron"), path.join(here, "..", "central-usage", "node_modules", "electron", "dist", "electron")].filter((p) => p && fs.existsSync(p))[0];
if (!exe) { console.log("SKIP: no Electron (npm install, or ELECTRON_PATH)"); process.exit(0); }
if (!fs.existsSync(path.join(here, "src", "production", "index.html"))) { console.log("run bash prepare.sh first"); process.exit(1); }
const home = fs.mkdtempSync(path.join(os.tmpdir(), "cp-app-")), userData = path.join(home, "data"), docs = path.join(home, "Documents");
const env = Object.assign({}, process.env, { HOME: home, XDG_DOCUMENTS_DIR: docs, XDG_CONFIG_HOME: path.join(home, ".config"), CC_UPDATE_API: "http://127.0.0.1:9" });
fs.mkdirSync(docs, { recursive: true });
// a Central Control here, to receive what's installed into "my apps"
fs.mkdirSync(path.join(home, ".config", "Central Usage"), { recursive: true });
env.CLAP_PATH = path.join(here, "..", "central-usage", "native", "build", "test-plugins");   // (the plugin host's test plugins)
let app = await electron.launch({ executablePath: exe, args: [here, "--no-sandbox", "--user-data-dir=" + userData], env });
let win = await app.firstWindow(); const errs = []; win.on("pageerror", (e) => errs.push(String(e)));
const T = (fn, a) => win.evaluate(fn, a);
await check("it opens on the start page, as the app (CPDesktop), with its version", async () => {
  await win.waitForFunction(() => window.CP && window.CPDesktop && document.querySelector("#cpStart [data-new]"), null, { timeout: 30000 });
  assert.equal(await T(() => CPHost.kind), "desktop"); assert.match(await T(() => CPDesktop.version()), /^\d+\.\d+\.\d+$/);
});
let saved = null;
await check("a new track, saved: a .cmproj in Documents/Central Production, listed under recent", async () => {
  await T(() => CP.create("track", { name: "App Song" })); await win.waitForSelector(".cdaw .cd-tname");
  await T(() => { const t = CDaw.project().tracks.find((x) => x.name === "Keys"); CDaw.edit("c", () => { CDaw.track(t.id).clips.push({ id: "c1", kind: "midi", start: 0, len: 4, notes: [{ p: 60, v: 100, s: 0, d: 1 }] }); }); });
  await T(() => CP.save());
  const l = await T(() => CPHost.local.list()); saved = l.find((x) => x.name === "App Song");
  assert.ok(saved && fs.existsSync(saved.path) && saved.path.startsWith(path.join(home)) && /\.cmproj$/.test(saved.path), JSON.stringify(l));
  assert.equal(fs.readFileSync(saved.path).toString("latin1", 0, 2), "PK");
});
await check("opened again from the recent list: the clip is there", async () => {
  await T(() => CP.create("board", { name: "x" })); await win.waitForSelector(".cp-board");
  await T(async (id) => { const r = await CPHost.local.open(id); await CP.load(r.bytes, { localId: id, path: r.entry.path }); }, saved.id);
  await win.waitForSelector(".cdaw .cd-tname");
  assert.equal(await T(() => CDaw.project().tracks.find((x) => x.name === "Keys").clips.length), 1);
});
await check("Install into my apps: a personal library in this app and in Central Control on this computer", async () => {
  await T(() => CP.create("board", { name: "My Board" })); await win.waitForSelector(".cp-board");
  await win.locator("#bdList [data-add]").first().click();
  const r = await T(async () => { const lib = await CPPublish.libraryOf(CP.project(), await CP.mod().install()); return CPDesktop.installPersonal(lib.zip, lib.id + ".zip"); });
  assert.ok(r.ok, JSON.stringify(r)); assert.deepEqual(r.apps, ["Central Production", "Central Control"]);
  const recs = fs.readdirSync(path.join(home, ".config", "Central Usage", "libraries")).filter((f) => f.endsWith(".json"));
  const rec = JSON.parse(fs.readFileSync(path.join(home, ".config", "Central Usage", "libraries", recs[0]), "utf8"));
  assert.ok(rec.personal && rec.boards.length === 1, JSON.stringify(rec).slice(0, 300));
});
await check("the sound list has the built-in sounds (and the computer's banks when it has them)", async () => {
  await T(() => window.CUStudioSounds.refresh()); await win.waitForTimeout(500);
  assert.ok(await T(() => CUStudioSounds.list().length >= 5));
});
const rigBin = path.join(here, "..", "central-usage", "native", "build", "cu-rig"), testPlugs = path.join(here, "..", "central-usage", "native", "build", "test-plugins");
if (fs.existsSync(rigBin) && fs.existsSync(path.join(testPlugs, "central-test.clap"))) await check("(10.2) VST3 / CLAP on a track: the rig finds them; freezing plays the track through one (with its saved settings), exports use it", async () => {
  const list = await T(() => CDaw.native.host().list(true).then((l) => l.map((p) => ({ id: p.id, format: p.format, path: p.path, name: p.name }))));
  const gain = list.find((p) => p.id === "audio.motion.test-gain"); assert.ok(gain, "found: " + JSON.stringify(list.map((p) => p.name)));
  assert.ok(!list.some((p) => p.id === "audio.motion.test-synth"), "instruments aren't offered as inserts");
  // its settings, as its window would leave them: +12 dB in the slot's saved state (the rig on its own, then quit)
  const slot = "dwfN1", q = (await import("node:child_process")).spawn(rigBin, ["--data", path.join(userData, "daw-rig"), "--backend", "null"], { stdio: ["pipe", "pipe", "ignore"] });
  const say = (m) => q.stdin.write(JSON.stringify(m) + "\n");
  say({ action: "apply", config: { kind: "electric", input: { device: "auto", channel: "L", gainDb: 0, gateOn: false }, chain: [{ uid: slot, id: "plug", plugin: gain, on: true, mix: 1, levelDb: 0 }], levelDb: 0, routing: {} } });
  await new Promise((r) => setTimeout(r, 1500)); say({ action: "pluginParams", uid: slot }); await new Promise((r) => setTimeout(r, 500));
  say({ action: "pluginSet", uid: slot, id: 1, value: 0.75 }); await new Promise((r) => setTimeout(r, 400)); say({ action: "pluginSave" }); await new Promise((r) => setTimeout(r, 400)); q.stdin.end(); await new Promise((r) => q.on("close", r));
  const r = await T(async (g) => {
    CP.setDirty(false); CDaw.markSaved(); await CP.create("track", { name: "Native" }); const t = CDaw.project().tracks.find((x) => x.name === "Keys");
    CDaw.edit("n", () => { const k = CDaw.track(t.id); k.clips = [{ id: "cn", kind: "midi", start: 0, len: 4, notes: [{ p: 57, v: 100, s: 0, d: 3 }] }]; k.inserts = []; });
    const peak = (b) => { let m = 0; const d = b.getChannelData(0); for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i])); return m; };
    const dry = peak(await CDaw.render({ from: 0, to: 4, tracks: [t.id], tail: 0 }));
    CDaw.edit("add", () => { CDaw.track(t.id).inserts.unshift({ id: "fN1", type: "native", on: true, params: {}, plugin: g, v: 0 }); });
    const before = CDaw.native.state(CDaw.track(t.id)), wet = peak(await CDaw.render({ from: 0, to: 4, tracks: [t.id], tail: 0 }));   // (an export plays it through the plugins, for that export only)
    const kept = CDaw.native.state(CDaw.track(t.id)); await CDaw.native.freeze(t.id); const after = CDaw.native.state(CDaw.track(t.id));   // (10.3: freezing is optional, to save CPU)
    CDaw.edit("move", () => { CDaw.track(t.id).clips[0].notes[0].p = 60; }); const stale = CDaw.native.state(CDaw.track(t.id));
    return { dry, wet, before, kept, after, stale, audio: CDaw.usedAudio().length };
  }, gain);
  assert.equal(r.before, "unfrozen"); assert.equal(r.kept, "unfrozen", "an export leaves the track live"); assert.equal(r.after, "frozen"); assert.equal(r.stale, "stale"); assert.ok(r.audio >= 1, "the frozen sound is saved with the project");
  assert.ok(r.wet > r.dry * 3.2 && r.wet < r.dry * 4.8, "+12 dB through the plugin: dry " + r.dry + ", frozen " + r.wet);
});
await win.evaluate(() => { CP.setDirty(false); CDaw.markSaved(); }).catch(() => { }); await app.close();
await check("a .cmproj given to the app (double-clicked) opens by itself", async () => {
  app = await electron.launch({ executablePath: exe, args: [here, "--no-sandbox", "--user-data-dir=" + userData, saved.path], env });
  win = await app.firstWindow(); win.on("pageerror", (e) => errs.push(String(e)));
  await win.waitForFunction(() => window.CP && CP.project() && CP.project().name === "App Song", null, { timeout: 30000 });
});
await win.evaluate(() => { CP.setDirty(false); CDaw.markSaved(); }).catch(() => { }); await app.close();
if (errs.length) { failures++; console.error("page errors:\n  " + errs.join("\n  ")); }
fs.rmSync(home, { recursive: true, force: true });
console.log(failures ? "\n" + failures + " FAILED" : "\nall passed");
process.exit(failures ? 1 : 0);
