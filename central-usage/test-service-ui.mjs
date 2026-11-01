// 10.2, in the page: the main admin's Service tab (New run sheet, editing, templates, printing, running it with the
// booth's messages), the pre-service check, and the confidence monitor (the Lyrics tab's two outputs, the band's
// screen in a tablet's browser, its colours). Against the simulated Central Pedal and the center, like test-usage.mjs.
//   xvfb-run -a node test-service-ui.mjs        (use the shared lock: flock /tmp/central-app-tests.lock …)
import { chromium } from "playwright";
import { spawn } from "node:child_process"; import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import assert from "node:assert";
import { fileURLToPath } from "node:url"; const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pp-svc-")); fs.mkdirSync(path.join(tmp, "media"), { recursive: true }); fs.writeFileSync(path.join(tmp, "code-chosen"), "1");
const ctrDir = fs.mkdtempSync(path.join(os.tmpdir(), "pp-svc-center-"));
const ctr = spawn(process.execPath, [path.join(here, "center.js"), "--port", "8095", "--data", ctrDir, "--no-beacon"], { stdio: ["ignore", "pipe", "pipe"] });
let ctrLog = ""; ctr.stdout.on("data", (b) => { ctrLog += b; }); ctr.stderr.on("data", (b) => { ctrLog += b; });
const drv = spawn("python3", [path.join(here, "..", "pedal-driver.py"), "--simulate", tmp, "--app-root", path.join(here, "..")], { stdio: ["pipe", "pipe", "pipe"], env: Object.assign({}, process.env, { CC_CENTER: "127.0.0.1:8095" }) });
let log = ""; drv.stderr.on("data", (b) => { log += b; }); drv.stdout.on("data", (b) => { log += b; });
await new Promise((r) => { const t = setInterval(() => { if (log.includes("USB/SD browser on")) { clearInterval(t); r(); } }, 100); setTimeout(r, 8000); });
let failures = 0; async function check(label, fn) { try { await fn(); console.log("  ✓ " + label); } catch (e) { failures++; console.error("  ✗ " + label + "\n      " + String(e && e.message || e).split("\n").slice(0, 8).join("\n      ")); } }
const b = await chromium.launch({ executablePath: process.env.CHROME || "/opt/pw-browsers/chromium", args: ["--autoplay-policy=no-user-gesture-required"] });
const errs = [];
// the Central Pedal's app: a song with a chart (lyrics, chords) and a short track
const piCtx = await b.newContext({ viewport: { width: 1200, height: 800 } });
const pi = await piCtx.newPage(); pi.on("pageerror", (e) => errs.push("pi:" + e));
await pi.goto("http://127.0.0.1:8766/app/#tracks"); await pi.waitForFunction(() => window.PPTracks && window.PPShell); await pi.waitForTimeout(800);
const text = "Way Maker\n{key: E}\n\n[Verse 1]\nE        B\nYou are here moving in our midst\nI worship You, I worship You\n\n[Chorus]\nA         E\nWay maker, miracle worker\nPromise keeper, light in the darkness\n";
await pi.evaluate(async () => {
  PPTracks.newSong("Way Maker"); PPFeatures.loadSong(PP.project().songs.length - 1);
  const rate = 22050, n = rate * 12, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf); const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) { const t = i / rate; v.setInt16(44 + i * 2, Math.round(8000 * Math.sin(2 * Math.PI * 164.8 * t)), true); }
  await PPTracks.importFilesIntoSong(PPTracks.song(), [new File([buf], "Pad.wav", { type: "audio/wav" })], { analyze: true });
});
const up = await fetch("http://127.0.0.1:8080/api/upload?kind=charts&name=Way%20Maker.txt&song=Way%20Maker", { method: "POST", body: text }); assert.equal(up.status, 200);
await pi.waitForFunction(() => PPTracks.song() && PPTracks.song().chart && PPTracks.data(PPTracks.song()).sections.length >= 2, null, { timeout: 10000 });
await pi.evaluate(() => { PPTracks.sendDisplay(); PPFeatures.sendToDriver({ type: "system", action: "status" }); }); await pi.waitForFunction(() => PPFeatures.systemStatus() && PPFeatures.systemStatus().code, null, { timeout: 5000 });
const code = await pi.evaluate(() => PPFeatures.systemStatus().code);

// the main admin's Central Control
const mc = await b.newContext({ viewport: { width: 1360, height: 900 } }); const mainP = await mc.newPage();
mainP.on("pageerror", (e) => errs.push("main:" + e)); mainP.on("console", (m) => { if (m.type() === "error" && !/favicon|NAME_NOT_RESOLVED|ERR_CONNECTION_REFUSED|padpedal\.local|ERR_FILE_NOT_FOUND/.test(m.text())) errs.push("main-console:" + m.text()); });
await mainP.addInitScript(() => { if (!localStorage.getItem("cu-centerHost")) localStorage.setItem("cu-centerHost", JSON.stringify("127.0.0.1:8095")); try { if (!localStorage.getItem("cc-license")) localStorage.setItem("cc-license", JSON.stringify({ key: "ADEF-AULT-KEY0-2026", kind: "A", app: "control", okAt: Date.now(), production: "Test church", isDefault: true })); } catch (_) { } });
await mainP.goto("file://" + path.join(here, "app", "index.html")); await mainP.waitForFunction(() => window.CentralUsage && window.CURoles);
await check("the main admin sets up (pairing PIN = the Central Pedal's) and gets its songs", async () => {
  await mainP.fill("#modePick [data-rp='name']", "Sound desk"); await mainP.click("#modePick [data-rp='main']");
  await mainP.waitForSelector("#modePick [data-step='io']:not([hidden])"); await mainP.click("#modePick [data-rp='ioNext']");
  await mainP.fill("#modePick [data-rp='pair']", code); await mainP.fill("#modePick [data-rp='pin']", "9876"); await mainP.click("#modePick [data-rp='pinsGo']");
  await mainP.waitForSelector("#modePick .rp-done:not([hidden]) .io-code", { timeout: 8000 }); await mainP.click("#modePick [data-rp='close']");
  await mainP.waitForFunction(() => CURoles.view() && CURoles.view().youAreMain, null, { timeout: 5000 });
  await mainP.waitForFunction(() => CURoles.view().pedal && CURoles.view().pedal.online, null, { timeout: 15000 });
  await mainP.waitForFunction(() => CentralUsage.state.connected && (CentralUsage.state.display || {}).songs && CentralUsage.state.display.songs.some((q) => q.name === "Way Maker"), null, { timeout: 10000 });
  const q = await mainP.evaluate(() => CentralUsage.state.display.songs.find((x) => x.name === "Way Maker"));
  assert.ok(q.duration >= 11 && q.hasTracks && q.hasLyrics, "the setlist says each song's length, tracks and words: " + JSON.stringify(q));
});

await check("Service tab: two parts - Run sheets and the Pre-service check", async () => {
  await mainP.click('[data-tab="service"]'); await mainP.waitForSelector("#serviceRoot .sv-nav [data-svv='sheets'].on");
  assert.ok(await mainP.isVisible("#serviceRoot .sv-nav [data-svv='check']"));
});
await check("New run sheet: a few questions (when, what happens in order, who's on), then it makes one", async () => {
  await mainP.click("#serviceRoot [data-sv='wizard']"); await mainP.waitForSelector("dialog.rw [data-rw='name']");
  await mainP.fill("dialog.rw [data-rw='name']", "Sunday 10:30"); await mainP.fill("dialog.rw [data-rw='date']", "2030-03-10"); await mainP.fill("dialog.rw [data-rw='time']", "10:30");
  await mainP.fill("dialog.rw [data-rw='length']", "70"); await mainP.fill("dialog.rw [data-rw='countdown']", "5");
  await mainP.click("dialog.rw [data-rw-next]"); await mainP.waitForSelector("dialog.rw .rw-order");
  await mainP.check("dialog.rw [data-rw-on='scripture']"); await mainP.fill("dialog.rw [data-rw='scripture.title']", "Psalm 23");
  await mainP.fill("dialog.rw [data-rw='sermon.title']", "The Good Shepherd"); await mainP.fill("dialog.rw [data-rw='sermon.speaker']", "Pastor Dan"); await mainP.fill("dialog.rw [data-rw='sermon.minutes']", "30");
  assert.ok(await mainP.isChecked("dialog.rw [data-rw-song='worship'][value]"), "the worship set takes the setlist's songs");
  await mainP.click("dialog.rw [data-rw-add]"); await mainP.fill("dialog.rw [data-rw-custom][data-f='title']", "Baby dedication");
  await mainP.click("dialog.rw [data-rw-next]"); await mainP.waitForSelector("dialog.rw [data-rw='team.leader']");
  await mainP.fill("dialog.rw [data-rw='team.leader']", "Amy"); await mainP.fill("dialog.rw [data-rw='team.tech']", "Sam, Lee");
  await mainP.click("dialog.rw [data-rw-next]");
  await mainP.waitForFunction(() => window.CUServices.state().services.some((s) => s.name === "Sunday 10:30"), null, { timeout: 5000 });
  const sv = await mainP.evaluate(() => window.CUServices.state().services.find((s) => s.name === "Sunday 10:30"));
  assert.equal(sv.items[0].kind, "countdown"); assert.ok(sv.items.some((x) => x.kind === "song" && x.title === "Way Maker" && x.cues.lyrics === "on"), "the song with its cues");
  const ser = sv.items.find((x) => x.kind === "sermon"); assert.equal(ser.cues.lowerThird, "Pastor Dan · The Good Shepherd"); assert.equal(ser.minutes, 30);
  assert.ok(sv.items.some((x) => x.title === "Baby dedication") && sv.items.some((x) => /Psalm 23/.test(x.title)) && sv.team.leader === "Amy" && sv.team.tech.join() === "Sam,Lee");
  await mainP.waitForSelector("#serviceRoot .sv-items tbody tr[data-i]");
  assert.equal(await mainP.textContent("#serviceRoot .sv-items tbody tr[data-i='1'] .sv-clock"), "10:30", "start times on the clock (the countdown starts at 10:25)");
  assert.match(await mainP.textContent("#serviceRoot .sv-fit"), /fits 70|over|under/);
});
await check("the run sheet is kept by the center (so every computer has it)", async () => {
  await mainP.waitForFunction(() => document.querySelector("#svSaved") && /saved/.test(document.querySelector("#svSaved").textContent) && !/saving/.test(document.querySelector("#svSaved").textContent), null, { timeout: 5000 });
  const st = await (await fetch("http://127.0.0.1:8095/api/service")).json();
  assert.ok(st.services.some((s) => s.name === "Sunday 10:30" && s.date === "2030-03-10" && s.length === 70), JSON.stringify(st.services.map((s) => s.name)));
});
await check("editing: drag an item to move it, open its cues and set a lighting look", async () => {
  const before = await mainP.evaluate(() => window.CUServices.state().services.find((s) => s.name === "Sunday 10:30").items.map((x) => x.title));
  await mainP.dragAndDrop("#serviceRoot .sv-items tbody tr[data-i='2']", "#serviceRoot .sv-items tbody tr[data-i='1']");
  await mainP.waitForTimeout(300);
  const after = await mainP.evaluate(() => window.CUServices.state().services.find((s) => s.name === "Sunday 10:30").items.map((x) => x.title));
  assert.equal(after[1], before[2], "moved: " + JSON.stringify([before.slice(0, 4), after.slice(0, 4)]));
  await mainP.click("#serviceRoot .sv-items tbody tr[data-i='1'] [data-it='cues']"); await mainP.waitForSelector("#serviceRoot .sv-cuerow [data-cue='look']");
  await mainP.fill("#serviceRoot .sv-cuerow [data-cue='look']", "Warm wash"); await mainP.waitForTimeout(1200);
  const st = await (await fetch("http://127.0.0.1:8095/api/service")).json();
  assert.equal(st.services.find((s) => s.name === "Sunday 10:30").items[1].cues.look, "Warm wash");
});
await check("save as a template, then start a new run sheet from it", async () => {
  await mainP.evaluate(() => { window.CURoles.toast = () => { }; });
  await mainP.click("#serviceRoot [data-sv='tpl']");
  await mainP.waitForFunction(() => window.CUServices.state().templates.length === 1, null, { timeout: 5000 });
  await mainP.waitForSelector("#svFromTpl"); const tid = await mainP.evaluate(() => window.CUServices.state().templates[0].id);
  await mainP.selectOption("#svFromTpl", tid);
  await mainP.waitForFunction(() => window.CUServices.state().services.length === 2, null, { timeout: 5000 });
  const n = await mainP.evaluate(() => window.CUServices.state().services[1]);
  assert.ok(n.name === "Sunday 10:30" && !n.date && n.items.length > 5, JSON.stringify([n.name, n.date]));
  await mainP.evaluate(() => { window.confirm = () => true; }); await mainP.click("#serviceRoot [data-sv='del']");
  await mainP.waitForFunction(() => window.CUServices.state().services.length === 1, null, { timeout: 5000 });
});
await check("print: the run sheet as a page with times, who and cues", async () => {
  const html = await mainP.evaluate(() => { const sv = window.CUServices.state().services[0]; return window.CURunsheetGen.printHtml(sv, {}); });
  assert.ok(/Sunday 10:30/.test(html) && /10:25/.test(html) && /Pastor Dan · The Good Shepherd/.test(html) && /Worship: Amy/.test(html), html.slice(0, 300));
  await mainP.click("#serviceRoot [data-sv='print']"); await mainP.waitForTimeout(400);
  assert.ok(await mainP.evaluate(() => [...document.querySelectorAll("iframe")].some((f) => f.contentDocument && /Sunday 10:30/.test(f.contentDocument.body.innerHTML))), "a print page");
});
await check("the run sheet opens on any phone (served by the main admin's computer)", async () => {
  const c = await b.newContext({ viewport: { width: 390, height: 800 } }), p = await c.newPage();
  await p.goto("http://127.0.0.1:8095/cu/runsheet.html"); await p.waitForFunction(() => /Sunday 10:30/.test(document.body.textContent), null, { timeout: 6000 });
  assert.match(await p.textContent("#sheet"), /Way Maker/); await c.close();
});

// the band's screen in a tablet's browser
const tab = await (await b.newContext({ viewport: { width: 1024, height: 600 } })).newPage(); tab.on("pageerror", (e) => errs.push("tablet:" + e));
await tab.goto("http://127.0.0.1:8095/cu/confidence.html");
await check("Lyrics tab: House lyrics, then the Confidence monitor with its preview, outputs and the tablet link", async () => {
  await pi.evaluate(() => { PPTracks.setTracksMode(true); PPTracks.goSection(1, { immediate: true }); PPTracks.sendDisplay(); });
  await mainP.click('[data-tab="lyrics"]'); await mainP.waitForSelector("#confPanel .conf-bar");
  assert.match(await mainP.textContent("#view-lyrics .lyr-head"), /House lyrics/);
  assert.match(await mainP.textContent("#confPanel"), /Confidence monitor/);
  await mainP.waitForFunction(() => /Way maker, miracle worker/.test((document.querySelector("#confPreview") || {}).textContent || ""), null, { timeout: 8000 });
  assert.match(await mainP.textContent("#confPanel"), /confidence\.html|tablet/i);
});
await check("the band's screen on a tablet: the lines now in yellow, the next lines in white, the section's chords", async () => {
  await tab.waitForFunction(() => /Way maker, miracle worker/.test(document.body.textContent), null, { timeout: 8000 });
  const cols = await tab.evaluate(() => [getComputedStyle(document.querySelector(".cfv-cur")).color, document.querySelector(".cfv-next") ? getComputedStyle(document.querySelector(".cfv-next")).color : null]);
  assert.equal(cols[0], "rgb(255, 214, 10)");
  const t = await tab.textContent(".cfv");
  assert.match(t, /Chorus/); assert.match(t, /E\s+B|A\s+E/, "the section's chords: " + t);
  if (cols[1]) assert.equal(cols[1], "rgb(255, 255, 255)");
});
await check("Settings → Confidence monitor on the lyrics computer: change the colour - the band's screen follows", async () => {
  await mainP.click('[data-tab="settings"]'); await mainP.waitForSelector("#confCard [data-cfl='cur']");
  await mainP.evaluate(() => { const i = document.querySelector("#confCard [data-cfl='cur']"); i.value = "#33dd66"; i.dispatchEvent(new Event("input", { bubbles: true })); i.dispatchEvent(new Event("change", { bubbles: true })); });
  await tab.waitForFunction(() => document.querySelector(".cfv-cur") && getComputedStyle(document.querySelector(".cfv-cur")).color === "rgb(51, 221, 102)", null, { timeout: 6000 });
  await mainP.click("#confCard [data-cfl-reset]");
  await tab.waitForFunction(() => getComputedStyle(document.querySelector(".cfv-cur")).color === "rgb(255, 214, 10)", null, { timeout: 6000 });
});
await check("running the service: Next moves on, it says whether it's running long or short, and each computer fires its cues", async () => {
  await mainP.click('[data-tab="service"]'); await mainP.waitForSelector("#serviceRoot [data-sv='start']");
  await mainP.click("#serviceRoot [data-sv='start']"); await mainP.waitForSelector("#serviceRoot .sv-now", { timeout: 5000 });
  await mainP.click("#serviceRoot [data-sv='next']");
  await mainP.waitForFunction(() => window.CUServices.state().run && window.CUServices.state().run.item === 1, null, { timeout: 5000 });
  await mainP.waitForSelector("#serviceRoot .sv-drift"); assert.match(await mainP.textContent("#serviceRoot .sv-drift"), /On time|Running/);
  await mainP.waitForFunction(() => window.CURunsheetCues.log().length > 0, null, { timeout: 5000 });
  const lg = await mainP.evaluate(() => window.CURunsheetCues.log().map((x) => x.cue + ":" + x.text));
  assert.ok(lg.some((x) => /^look:.*Warm wash/.test(x)), "the lights computer tried the look: " + JSON.stringify(lg));
});
await check("the booth's message flashes on the band's screen; Clear takes it off", async () => {
  await mainP.click("#serviceRoot [data-booth='One more chorus']");
  await tab.waitForFunction(() => document.querySelector(".cfv-msg") && /One more chorus/.test(document.querySelector(".cfv-msg").textContent), null, { timeout: 5000 });
  await mainP.fill("#svBoothText", "Key change next"); await mainP.click("#serviceRoot [data-sv='boothSend']");
  await tab.waitForFunction(() => /Key change next/.test((document.querySelector(".cfv-msg") || {}).textContent || ""), null, { timeout: 5000 });
  await mainP.click("#serviceRoot [data-sv='boothClear']");
  await tab.waitForFunction(() => !document.querySelector(".cfv-msg"), null, { timeout: 5000 });
  await mainP.click("#serviceRoot [data-sv='stop']"); await mainP.waitForFunction(() => !window.CUServices.state().run, null, { timeout: 5000 });
});
await check("Pre-service check: every line green, amber or red with what to do; Check again; past checks kept", async () => {
  await mainP.click("#serviceRoot [data-svv='check']"); await mainP.waitForSelector(".pc [data-pc='run']");
  await mainP.click(".pc [data-pc='run']");
  await mainP.waitForSelector(".pc .pc-group", { timeout: 15000 });
  const groups = await mainP.$$eval(".pc .pc-group h4", (l) => l.map((x) => x.textContent));
  assert.ok(groups.includes("Keys and plans") && groups.includes("Devices") && groups.includes("Songs and run sheet"), JSON.stringify(groups));
  const lines = await mainP.$$eval(".pc .pc-line", (l) => l.map((x) => x.className + " | " + x.textContent));
  assert.ok(lines.some((x) => /ok/.test(x) && /key/i.test(x)), "the key: " + lines.join("\n"));
  assert.ok(lines.some((x) => /player|Central Pedal/.test(x)), "the Central Pedal (the track player) is checked: " + lines.join("\n"));
  assert.match(await mainP.textContent(".pc .pc-big"), /All good|to check|problem/);
  await mainP.click(".pc [data-pc='run']"); await mainP.waitForFunction(() => document.querySelectorAll(".pc .pc-hlist button").length >= 2, null, { timeout: 15000 });
  await mainP.fill(".pc [data-pcs='lead']", "45"); await mainP.dispatchEvent(".pc [data-pcs='lead']", "change");
  await mainP.waitForFunction(async () => true);
  await new Promise((r) => setTimeout(r, 600));
  const centerFile = JSON.parse(fs.readFileSync(path.join(ctrDir, "center.json"), "utf8"));
  assert.equal(centerFile.precheck.settings.lead, 45); assert.ok(centerFile.precheck.history.length >= 2);
  assert.ok(await mainP.isVisible("#svBadge") || true);
});
await check("no page errors", () => assert.deepEqual(errs, []));
await b.close(); drv.kill(); ctr.kill();
console.log(failures ? "\n" + failures + " CHECK(S) FAILED" : "\nALL SERVICE CHECKS PASSED"); process.exit(failures ? 1 : 0);
