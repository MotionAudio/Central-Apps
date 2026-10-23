// Central Control as the real Electron app: the phone remote's web server, the update check against a
// stand-in GitHub, the checksum guard of the updater, and the fixture library IPC.
//   npm install && xvfb-run -a node test-app.mjs      (needs a display: Xvfb is fine)
import { _electron as electron } from "playwright";
import http from "node:http"; import crypto from "node:crypto"; import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import assert from "node:assert";
import { createRequire } from "node:module"; import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url)), require = createRequire(import.meta.url);
let failures = 0; async function check(label, fn) { try { await fn(); console.log("  ✓ " + label); } catch (e) { failures++; console.error("  ✗ " + label + "\n      " + String(e && e.message || e).split("\n").slice(0, 6).join("\n      ")); } }

// a stand-in for api.github.com + its download host
const deb = Buffer.from("!<arch>\nfake central-usage 2.4.0 package\n"), appimg = Buffer.from("\x7fELF fake appimage");
const sums = ["central-usage-2.4.0-amd64.deb", "central-usage-2.4.0-x86_64.AppImage"].map((n, i) => crypto.createHash("sha256").update(i ? appimg : deb).digest("hex") + "  " + n).join("\n") + "\n";
const gh = http.createServer((req, res) => {
  const base = "http://127.0.0.1:" + gh.address().port, send = (b, type) => { res.writeHead(200, { "Content-Type": type || "application/json" }); res.end(b); };
  const rel = (r) => (req.url.includes("?") ? [r] : r);   // (the updater reads the list of releases; older tools the newest one)
  if (req.url === "/repos/church/cc/releases/latest" || req.url.startsWith("/repos/church/cc/releases?")) return send(JSON.stringify(rel({ tag_name: "v2.4.0", body: "Lighting remote fixes", assets: [
    { name: "central-usage-2.4.0-amd64.deb", browser_download_url: base + "/dl/deb" }, { name: "central-usage-2.4.0-x86_64.AppImage", browser_download_url: base + "/dl/appimage" },
    { name: "central-control-source.zip", browser_download_url: base + "/dl/zip" }, { name: "SHA256SUMS", browser_download_url: base + "/dl/sums" }] })));
  if (req.url === "/dl/deb") { res.writeHead(302, { Location: base + "/dl/deb2" }); return res.end(); }   // GitHub redirects downloads
  if (req.url === "/dl/deb2") return send(deb, "application/octet-stream");
  if (req.url === "/dl/sums") return send(sums, "text/plain");
  res.writeHead(404); res.end();
});
await new Promise((r) => gh.listen(0, "127.0.0.1", r));
const API = "http://127.0.0.1:" + gh.address().port;
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "cu-app-"));

const exe = [process.env.ELECTRON_PATH, path.join(here, "node_modules", "electron", "dist", "electron")].filter((p) => p && fs.existsSync(p))[0];
const app = await electron.launch({ executablePath: exe, args: [path.join(here, "main.js"), "--no-sandbox", "--user-data-dir=" + userData], env: Object.assign({}, process.env, { CC_UPDATE_API: API, CU_CENTER_PORT: "18095", CU_NO_BEACON: "1" }) });
const win = await app.firstWindow();
await win.waitForFunction(() => window.CULights && window.CU && window.CU.remote);

await check("the phone remote: switched on in Lighting → Output, it serves its page and the lights' state with the code, refuses a wrong code", async () => {
  await win.evaluate(() => { document.querySelector('[data-tab="lights"]').click(); CULights.showSub("output"); });
  await win.waitForSelector("#lxRmOn", { timeout: 5000 });
  await win.evaluate(() => { document.querySelector("#lxRmPort").value = "18191"; const on = document.querySelector("#lxRmOn"); on.checked = true; on.dispatchEvent(new Event("change", { bubbles: true })); });
  await win.waitForFunction(() => /18191/.test(document.querySelector("#lxRemote").textContent), null, { timeout: 5000 });
  const pin = await win.evaluate(() => document.querySelector(".lx-pin").textContent);
  const page = await (await fetch("http://127.0.0.1:18191/")).text(); assert.match(page, /Lights remote/);
  let st = null; for (let i = 0; i < 20 && !(st && st.looks && st.looks.length); i++) { await new Promise((r) => setTimeout(r, 200)); st = await (await fetch("http://127.0.0.1:18191/api/state?pin=" + pin)).json(); }
  assert.ok(st.looks.length >= 10 && st.faders.some((f) => f.id === "master"), JSON.stringify(st).slice(0, 200));
  assert.equal((await fetch("http://127.0.0.1:18191/api/state?pin=0000")).status, 403);
  const r = await fetch("http://127.0.0.1:18191/api/cmd?pin=" + pin, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cmd: "look", id: "bridge" }) });
  assert.equal(r.status, 200);
  await win.waitForFunction(() => CULights.live.manual && CULights.live.manual.id === "bridge", null, { timeout: 3000 });
});
await check("Lighting, the smart Auto: a 128 BPM song is Upbeat (movers, bars and washes all working, strobes waiting for the hits); a 68 BPM one is Intimate (warm, the strobe never fires, a hit is a swell); the feel can be set", async () => {
  const r = await win.evaluate(async () => {
    CULights.live.manual = null; CULights.showSub("show");
    const secs = (list) => { let at = 0; return list.map(([name, len]) => { const s = { name, start: at, end: at + len }; at += len; return s; }); };
    const play = (id, name, bpm, key, list, pos, hits) => [0, 1].forEach(() => CULights.onMessage({ type: "display", songId: id, song: { name, hasTracks: true, key }, key, bpm, bpb: 4, playing: true, pos, duration: list[list.length - 1].end, sections: list, hits: hits || [] }));   // (twice: the display comes many times a second; a new song's first one clears the old hits)
    const lightsBy = () => { const out = {}; CULights.rig().fixtures.forEach((f) => { out[f.name] = CULights.live.fixtureColor[f.id]; }); return out; };
    const up = secs([["Intro", 8], ["Verse 1", 22], ["Pre-Chorus", 8], ["Chorus", 22], ["Breakdown", 8], ["Chorus", 22], ["Outro", 8]]);
    play("lx-up", "Anthem", 128, "A", up, 45, [30.2]); await new Promise((r) => setTimeout(r, 400));
    const a = CULights.smart().analysis, cues = CULights.cuesNow(), sec = cues.filter((c) => c.kind === "look" && /^auto:lx-up:s/.test(c.look)); const upLooks = sec.map((c) => CULights.lookById(c.look).style);
    CULights.render(); const upLights = lightsBy();
    const panel = document.getElementById("lxAutoPanel"), panelText = panel.hidden ? "" : panel.textContent, chips = panel.querySelectorAll(".lx-ausec").length;
    const ballad = secs([["Verse 1", 40], ["Chorus", 40], ["Verse 2", 40]]);
    play("lx-soft", "Still", 68, "D", ballad, 61.0, [61.0]); await new Promise((r) => setTimeout(r, 400));
    const b = CULights.smart().analysis, flashes = CULights.cuesNow().filter((c) => c.kind === "flash").map((c) => c.look);
    let strobeMax = 0, frontMin = 1; for (let i = 0; i < 12; i++) { CULights.render(); const L = lightsBy(); strobeMax = Math.max(strobeMax, L.Strobe.dim); frontMin = Math.min(frontMin, L["Front L"].dim); await new Promise((r) => setTimeout(r, 30)); }
    CULights.setFeel("song", "upbeat"); const set = CULights.smart().analysis;
    const setText = document.getElementById("lxAutoPanel").textContent; CULights.setFeel("song", "auto");
    return { upStyle: a.style, sectionCues: sec.length, sections: up.length, upLooks, upLights, panelText, chips, softStyle: b.style, flashes, strobeMax, frontMin, setStyle: set.style, setText };
  });
  assert.equal(r.upStyle, "upbeat"); assert.equal(r.sectionCues, r.sections, "section cues " + r.sectionCues); assert.ok(r.upLooks.includes("upbeat"), r.upLooks.join());
  for (const n of ["Mover L", "Mover R", "Bar L", "Back 1", "Front L", "Hazer"]) assert.ok(r.upLights[n] && (r.upLights[n].dim > 0 || r.upLights[n].haze > 0), n + " " + JSON.stringify(r.upLights[n]));
  assert.equal(r.upLights.Strobe.dim, 0, "the strobe waits for a hit");
  assert.match(r.panelText, /Auto lighting[\s\S]*Upbeat/, "panel: " + r.panelText); assert.equal(r.chips, r.sections, "chips " + r.chips);
  assert.equal(r.softStyle, "intimate"); assert.ok(r.flashes.length && r.flashes.every((l) => /:swell$/.test(l)), r.flashes.join());
  assert.equal(r.strobeMax, 0, "strobe " + r.strobeMax); assert.ok(r.frontMin >= 0.4, "faces lit " + r.frontMin);
  assert.equal(r.setStyle, "upbeat"); assert.match(r.setText, /set by you/, "panel: " + r.setText);
});
await check("updates: with the update source set, a newer Central Control on the release page is found (and which file fits this computer); with Install by itself off it asks", async () => {
  const st = await win.evaluate(async () => { await CU.updates.config({ repo: "https://github.com/church/cc", auto: true, autoInstall: false }); return CU.updates.check(); });
  assert.equal(st.autoInstall, false);
  assert.equal(st.repo, "church/cc"); assert.equal(st.latest, "2.4.0"); assert.equal(st.available, true, JSON.stringify(st)); assert.equal(st.kind, "deb");
  await win.waitForFunction(() => document.querySelector("#updAsk").open, null, { timeout: 3000 });
  assert.match(await win.evaluate(() => document.querySelector("#updAsk").textContent), /Central Control 2\.4\.0[\s\S]*Want to update now\?/);
  assert.ok(await win.evaluate(() => document.querySelector("#updBanner").hidden), "no banner under the question");
  await win.click('#updAsk [data-ask="no"]');
  await win.waitForFunction(() => !document.querySelector("#updAsk").open && document.querySelector("#updBanner").hidden, null, { timeout: 3000 });
});
await check("updates: when the app opens and finds it, a new version installs by itself after a 10-second notice; Not now skips it", async () => {
  await win.evaluate(() => CU.updates.config({ autoInstall: true }));
  await win.reload(); await win.waitForFunction(() => window.CUUpdates && window.CU && window.CU.updates);
  await win.waitForFunction(() => document.querySelector("#updAsk").open && /installs in \d+ s/.test(document.querySelector("#updAsk").textContent), null, { timeout: 8000 });
  assert.match(await win.textContent("#updAsk"), /2\.4\.0[\s\S]*songs, setlists and settings stay/);
  assert.equal(await win.evaluate(() => document.getElementById("updAutoInstall").checked), true);
  await win.click('#updAsk [data-ask="no"]'); await win.waitForTimeout(1500);
  const st = await win.evaluate(() => CU.updates.status());
  assert.ok(!st.busy && await win.evaluate(() => !document.querySelector("#updAsk").open), "nothing installs");
});
await check("updates: an empty update source means the official releases (MotionAudio/Central-Apps)", async () => {
  const { Updater } = require("./updater.js");
  const u = new Updater({ product: "central-usage", current: "1.2.0", dir: fs.mkdtempSync(path.join(os.tmpdir(), "cu-upd-")), api: API });
  assert.equal(u.save({ repo: "" }).repo, process.env.CC_UPDATE_REPO || "MotionAudio/Central-Apps");
});
await check("the updater only accepts a download whose checksum is in SHA256SUMS (redirects followed)", async () => {
  const { Updater } = require("./updater.js");
  const u = new Updater({ product: "central-usage", current: "1.2.0", dir: userData, api: API }); u.save({ repo: "church/cc" }); await u.check();
  const file = await u.download(); assert.deepEqual(fs.readFileSync(file), deb);
  u.latest.assets.SHA256SUMS = API + "/dl/deb2";   // a wrong checksum list
  await assert.rejects(() => u.download(), /SHA256SUMS has no line|checksum/);
});
await check("fixture library: the QLC+ library scan answers (empty when QLC+ is not installed) and reading is limited to scanned files", async () => {
  const r = await win.evaluate(async () => { const list = await CU.fixtures.scan(); const bad = await CU.fixtures.read("/etc/passwd"); return { n: list.length, bad }; });
  assert.ok(r.n >= 0); assert.equal(r.bad, null);
});
await check("the main admin's computer is the center: it starts when this computer becomes the main admin (devices pair with it, phones open /cu/ from it) and stops when it is not", async () => {
  const st = await win.evaluate(async () => { await CentralUsage.setRole("main"); for (let i = 0; i < 40; i++) { const s = await CU.center.status(); if (s.on && s.running) return s; await new Promise((r) => setTimeout(r, 100)); } return CU.center.status(); });
  assert.ok(st.on && st.port === 18095, JSON.stringify(st));
  const info = await (await fetch("http://127.0.0.1:18095/api/center")).json(); assert.equal(info.app, "central-control-center");
  const page = await fetch("http://127.0.0.1:18095/cu/"); assert.equal(page.status, 200);
  await win.waitForFunction(() => window.CUCenter && window.CUCenter.connected(), null, { timeout: 8000 });
  const pl = await win.evaluate(() => CU.player.status()); assert.ok(pl.available, "the player is part of Central Control: " + JSON.stringify(pl));
  // the player window: the Central Pedal app built in - it starts, pairs with this computer's center and is the track player
  const op = await win.evaluate(() => CU.player.open()); assert.ok(op.ok, JSON.stringify(op));
  try { await win.waitForFunction(() => { const v = CURoles.view(); return v && v.pedals && v.pedals.some((p) => p.local && p.online && p.job === "player"); }, null, { timeout: 30000 }); }
  catch (e) { throw new Error("the player did not pair: " + await win.evaluate(() => JSON.stringify(CURoles.view() && CURoles.view().pedals)) + " " + require("node:fs").readFileSync(require("node:path").join(userData, "player-driver.log"), "utf8").slice(-800)); }
  let wins = [];
  for (let i = 0; i < 40; i++) { wins = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.webContents.getURL())); if (wins.some((u) => /8766/.test(u))) break; await new Promise((r) => setTimeout(r, 500)); }
  assert.ok(wins.some((u) => /127\.0\.0\.1:8766\/app\//.test(u)), "the player window is open: " + wins.join(", "));
  await win.waitForFunction(() => CentralUsage.state.connected, null, { timeout: 15000 });   // and this computer follows it (songs, charts, lyrics)
  await win.evaluate(() => CU.player.stop());
  const off = await win.evaluate(async () => { await CentralUsage.setRole("admin"); await new Promise((r) => setTimeout(r, 400)); return CU.center.status(); });
  assert.equal(off.on, false);
  // two apps: Central Control is for the main admin and admins; User 1 / User 2 are Central Usage's
  const still = await win.evaluate(async () => { await CentralUsage.setRole("user1"); return (await CU.config.get()).role; }).catch(() => null);
  assert.notEqual(still, "user1", "Central Control refuses User 1");
  await assert.rejects(() => fetch("http://127.0.0.1:18095/api/center"));
});
await app.close(); gh.close();
console.log(failures ? "\n" + failures + " CHECK(S) FAILED" : "\nALL CENTRAL USAGE APP CHECKS PASSED"); process.exit(failures ? 1 : 0);
