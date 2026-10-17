#!/usr/bin/env node
/**
 * Pad Pedal - end-to-end test: the real driver (simulated pins) + the real app
 * in headless Chromium + the real companion pages, all talking to each other
 * over the same websockets and HTTP the Pad Pedal uses.
 *
 *   pip install gpiozero websockets pillow     node: npm i playwright && npx playwright install chromium
 *   node test-integration.mjs
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import assert from "node:assert/strict";

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pp-e2e-"));
let failures = 0;
async function check(label, fn) { try { await fn(); console.log("  ✓ " + label); } catch (e) { failures++; console.error("  ✗ " + label + "\n      " + String(e && e.message ? e.message.split("\n").slice(0, 12).join("\n      ") : e)); } }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 6000, every = 60) { const t0 = Date.now(); for (;;) { try { const v = await fn(); if (v) return v; } catch (_) { } if (Date.now() - t0 > ms) throw new Error("timed out waiting"); await wait(every); } }

// ---- a synthetic song: 120 BPM, key G, kick on every beat, accent + bass on beat 1, 24 s
function wav(bpm, keyIdx, seconds, rate) {
  const n = Math.floor(seconds * rate), beat = 60 / bpm, freqs = [0, 4, 7, 12].map((s) => 440 * Math.pow(2, (keyIdx - 9 + s) / 12));
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8); buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const t = i / rate; let v = 0;
    for (const f of freqs) v += 0.08 * Math.sin(2 * Math.PI * f * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 0.5 * t));
    const bi = Math.floor(t / beat), ph = t - bi * beat, down = bi % 4 === 0;
    if (ph < 0.08) v += (down ? 0.9 : 0.45) * Math.sin(2 * Math.PI * (down ? 55 : 180) * ph) * Math.exp(-ph * 40);
    if (ph < 0.02) v += 0.5 * (Math.random() * 2 - 1) * Math.exp(-ph * 300);
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 20000))), 44 + i * 2);
  }
  return buf;
}
const songFile = path.join(tmp, "Drums.wav");
fs.writeFileSync(songFile, wav(120, 7, 24, 22050));

// ---- the driver in simulation mode
// ---- a stand-in for Planning Center (same JSON:API shapes as api.planningcenteronline.com)
import http from "node:http";
const pcoWav = wav(100, 9, 6, 22050);
const PCO_AUTH = "Basic " + Buffer.from("app123:secret456").toString("base64");
const pcoChart = "VERSE 1\n[G]Amazing grace how [C]sweet the sound\nCHORUS\n[D]My chains are gone, I've been set free\n";
const pco = http.createServer((req, res) => {
  const p = req.url.split("?")[0], send = (code, body, type = "application/json") => { const b = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body)); res.writeHead(code, { "Content-Type": type, "Content-Length": b.length }); res.end(b); };
  if (p.startsWith("/files/")) return send(200, pcoWav, "audio/wav");
  if (req.headers.authorization !== PCO_AUTH) return send(401, { errors: [] });
  const base = "http://127.0.0.1:" + pco.address().port, routes = {
    "/services/v2": { data: { attributes: { name: "Grace Church" } } },
    "/services/v2/service_types": { data: [{ id: "77", attributes: { name: "Sunday Morning" } }], links: {} },
    "/services/v2/service_types/77/plans": { data: [{ id: "900", attributes: { title: "Easter", dates: "April 5, 2026" } }], links: {} },
    "/services/v2/service_types/77/plans/900/items": { data: [{ id: "2", attributes: { title: "Amazing Grace", item_type: "song", key_name: "Ab" }, relationships: { song: { data: { id: "s1" } }, arrangement: { data: { id: "a1" } } } }],
      included: [{ type: "Song", id: "s1", attributes: { title: "Amazing Grace (My Chains Are Gone)", author: "Chris Tomlin" } }, { type: "Arrangement", id: "a1", attributes: { name: "Default", bpm: 100, meter: "3/4", sequence: ["Verse 1", "Chorus", "Verse 1", "Chorus"], chord_chart: pcoChart } }], links: {} },
    "/services/v2/songs/s1/arrangements/a1": { data: { attributes: { bpm: 100, meter: "3/4", sequence: ["Verse 1", "Chorus", "Verse 1", "Chorus"], chord_chart: pcoChart } } },
    "/services/v2/songs/s1/arrangements/a1/attachments": { data: [{ id: "f1", attributes: { filename: "Keys.wav" } }, { id: "f2", attributes: { filename: "Amazing Grace - Full Mix.mp3" } }], links: {} },
    "/services/v2/attachments/f1/open": { data: { attributes: { attachment_url: base + "/files/f1" } } },
  };
  return routes[p] ? send(200, routes[p]) : send(404, { errors: [] });
});
await new Promise((r) => pco.listen(0, "127.0.0.1", r));
const driver = spawn("python3", [path.join(here, "pedal-driver.py"), "--simulate", tmp, "--app-root", here], { stdio: ["ignore", "pipe", "pipe"], env: Object.assign({}, process.env, { CC_PCO_BASE: "http://127.0.0.1:" + pco.address().port }) });
let driverLog = "";
driver.stdout.on("data", (d) => { driverLog += d; }); driver.stderr.on("data", (d) => { driverLog += d; });
await until(() => /listening on ws/.test(driverLog), 15000, 100);
let code = fs.readFileSync(path.join(tmp, "code"), "utf8").trim();

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 } });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto("http://127.0.0.1:8766/app/#perform");
await page.waitForFunction(() => window.__test && window.PPShell && window.PPTracks);
const T = (fn, arg) => page.evaluate(fn, arg);
async function sim(m) { await T((m) => window.__pedalBridge.send(Object.assign({ type: "sim" }, m)), m); }

console.log("\nConnection and the Learn tab:");
await check("the app is served by the driver and connects to it", async () => { await until(() => T(() => window.__pedalBridge.connected)); assert.match(await T(() => document.querySelector("#pfHw").textContent), /^Central Control 8\./); });
await check("the driver's inputs show in the Learn tab with their pins", async () => { await T(() => PPShell.showTab("learn")); await wait(200); const txt = await T(() => document.querySelector('[data-learn="b1"] small').textContent); assert.match(txt, /GPIO 4/); assert.equal(await T(() => document.querySelectorAll("#lnBoard .ln-row").length), 22); });

console.log("\nPairing PIN:");
await check("the first start asks for a 4-digit pairing PIN, and the question cannot be closed without one", async () => {
  await page.waitForSelector("#pinDialog[open]", { timeout: 8000 });
  await page.keyboard.press("Escape"); await wait(200);
  assert.ok(await T(() => document.querySelector("#pinDialog").open));
});
await check("a PIN that is not 4 digits is refused", async () => {
  await page.click('#pinDialog [data-pk="1"]'); await page.click('#pinDialog [data-pk="2"]'); await page.click('#pinDialog [data-pk="ok"]');
  assert.match(await page.textContent("#pinErr"), /4 digits/);
  await page.click('#pinDialog [data-pk="del"]'); await page.click('#pinDialog [data-pk="del"]');
});
await check("the PIN picked on the screen is saved on the Central Control; devices pair with it", async () => {
  for (const k of ["4", "8", "2", "6"]) await page.click(`#pinDialog [data-pk="${k}"]`);
  await page.click('#pinDialog [data-pk="ok"]');
  await page.waitForFunction(() => !document.querySelector("#pinDialog").open, null, { timeout: 5000 });
  assert.equal(fs.readFileSync(path.join(tmp, "code"), "utf8").trim(), "4826");
  assert.ok(fs.existsSync(path.join(tmp, "code-chosen")));
  code = "4826";
  const ok = await fetch("http://127.0.0.1:8080/api/action", { method: "POST", body: JSON.stringify({ name: "none", code }) }); assert.equal(ok.status, 200);
});
await check("Settings shows the pairing PIN and can change it", async () => {
  await T(() => PPShell.showTab("settings")); await page.waitForSelector("#pinChange");
  assert.match(await page.textContent("#pinSection"), /4826/);
  await page.click("#pinChange"); await page.waitForSelector("#pinDialog[open]");
  for (const k of ["4", "8", "2", "7"]) await page.click(`#pinDialog [data-pk="${k}"]`);
  await page.click('#pinDialog [data-pk="ok"]'); await page.waitForFunction(() => !document.querySelector("#pinDialog").open);
  assert.equal(fs.readFileSync(path.join(tmp, "code"), "utf8").trim(), "4827"); code = "4827";
  assert.match(await page.textContent("#pinSection"), /4827/);
  await T(() => PPShell.showTab("pads"));
});

console.log("\nButtons and knobs drive the pads:");
await check("one layout: button 1 (Play all) plays the song's pad when the song has no tracks", async () => { await T(() => PPShell.showTab("pads")); await sim({ sim: "press", id: "b1" }); await until(() => T(() => __test.playingIndex() === 0)); await sim({ sim: "release", id: "b1" }); });
await check("button 2 (Stop all) stops it", async () => { await sim({ sim: "press", id: "b2" }); await until(() => T(() => PP.engine.voices().length === 0)); await sim({ sim: "release", id: "b2" }); });
await check("knob 1 sets the master volume", async () => { await sim({ sim: "knob", id: "k1", value: 0.9 }); await until(() => T(() => Math.abs(PP.project().performance.volume - 0.9) < 0.03)); });
await check("slider 1 is the expression / swell", async () => { await sim({ sim: "knob", id: "s1", value: 0.25 }); await until(() => T(() => Math.abs(parseFloat(document.querySelector("#pfExpr").style.width) - 25) < 4)); });
await check("knob 5 sets the tone", async () => { await sim({ sim: "knob", id: "k5", value: 0.6 }); await until(() => T(() => Math.abs(PP.project().performance.tone - 0.6) < 0.03)); });
await check("holding button 11 freezes (hold action)", async () => { await sim({ sim: "press", id: "b1" }); await until(() => T(() => __test.playingIndex() === 0)); await sim({ sim: "release", id: "b1" }); await sim({ sim: "press", id: "b11" }); await until(() => T(() => !!PP.engine.frozen), 4000); await sim({ sim: "release", id: "b11" }); await T(() => { PPFeatures.toggleFreeze(); PP.engine.panic(); }); });
await check("button 10 is key up", async () => { const before = await T(() => PP.currentPad().key); await sim({ sim: "press", id: "b10" }); await sim({ sim: "release", id: "b10" }); await until(() => T((b) => PP.currentPad().key !== b, before)); await T(() => PP.changeKey(-1)); });

console.log("\nLearn:");
await check("Learn on Button 3, press a switch on GPIO 17 -> Button 3 is now GPIO 17", async () => {
  await T(() => PPShell.showTab("learn")); await page.click('[data-learn="b3"] [data-ln="learn"]');
  await until(() => T(() => document.querySelector('[data-learn="b3"]').classList.contains("learning")));
  await sim({ sim: "gpio", pin: 17, low: true }); await wait(100); await sim({ sim: "gpio", pin: 17, low: false });
  await until(() => T(() => /GPIO 17/.test(document.querySelector('[data-learn="b3"] small').textContent)));
  await until(() => /GPIO ready/.test(driverLog.split("learning b3").pop() || ""), 4000, 100);
});
await check("...and the driver now reports presses on GPIO 17 as Button 3", async () => { await T(() => { PPShell.showTab("pads"); PPActions.mapping().b3 = { action: "pad", args: { index: 2 } }; PPActions.modeChanged(); }); await sim({ sim: "gpio", pin: 17, low: true }); await until(() => T(() => __test.playingIndex() === 2)); await sim({ sim: "gpio", pin: 17, low: false }); await T(() => PP.engine.panic()); });
await check("Configure: button 2 remapped to 'Tap tempo' works", async () => {
  await T(() => { PPActions.mapping().b2 = { action: "tap" }; PPActions.modeChanged(); window.__taps = 0; const orig = PPActions.ACTIONS.tap.run; PPActions.ACTIONS.tap.run = function () { window.__taps++; return orig.apply(this, arguments); }; });
  for (let i = 0; i < 4; i++) { await sim({ sim: "press", id: "b2" }); await wait(30); await sim({ sim: "release", id: "b2" }); await wait(470); }
  const taps = await T(() => window.__taps); assert.equal(taps, 4, "tap action fired " + taps + " times");
  const bpm = await T(() => PP.project().tempo.bpm); assert.ok(bpm > 60 && bpm < 240, "bpm " + bpm + " (taps are timed by this machine, so only a sane range is checked)");
  await T(() => { PPActions.mapping().b2 = { action: "stopAll", hold: { action: "panic" } }; PPActions.mapping().b3 = { action: "prevSection" }; PPActions.modeChanged(); });
});

console.log("\nTracks:");
await check("a song gets a WAV, the tempo (120) and key (G) are detected and sections appear", async () => {
  await T(() => { PPShell.showTab("tracks"); PPTracks.newSong("Test Song"); PPFeatures.loadSong(PP.project().songs.length - 1); PPTracks.openEditor(); });
  await page.setInputFiles("#seStemFiles", songFile);
  await until(() => T(() => { const s = PPTracks.song(); return s && s.tracks && s.tracks.analysis && s.tracks.analysis.bpm; }), 40000, 200);
  const r = await T(() => ({ bpm: PPTracks.song().tracks.analysis.bpm, key: PPTracks.song().key, secs: PPTracks.data(PPTracks.song()).sections.length, dur: PPTracks.data(PPTracks.song()).duration }));
  assert.ok(Math.abs(r.bpm - 120) < 1.5, "bpm " + r.bpm); assert.equal(r.key, "G"); assert.ok(r.secs >= 2 && r.dur > 20, JSON.stringify(r));
  await T(() => document.querySelector("#songDialog").close());
});
await check("'not the right tempo?' chips: picking the half-time guess re-fits the grid at 60 BPM, a key chip changes the tracks' key", async () => {
  await T(() => PPTracks.openEditor());
  await until(() => T(() => document.querySelectorAll("#seGuesses [data-guess-bpm]").length > 0), 5000, 100);
  const chips = await T(() => Array.from(document.querySelectorAll("#seGuesses [data-guess-bpm]")).map((b) => Number(b.dataset.guessBpm)));
  assert.ok(chips.some((b) => Math.abs(b - 60) < 1), "half-time chip " + JSON.stringify(chips));
  await T(() => { const b = Array.from(document.querySelectorAll("#seGuesses [data-guess-bpm]")).find((x) => Math.abs(Number(x.dataset.guessBpm) - 60) < 1); b.click(); });
  await until(() => T(() => Math.abs(PPTracks.data(PPTracks.song()).grid.bpm - 60) < 1), 40000, 200);
  const g = await T(() => ({ bpm: PPTracks.data(PPTracks.song()).grid.bpm, songBpm: PPTracks.song().bpm, secs: PPTracks.data(PPTracks.song()).sections.length }));
  assert.ok(Math.abs(g.songBpm - 60) < 1, JSON.stringify(g));
  const keyChip = await T(() => { const b = document.querySelector("#seGuesses [data-guess-key]"); return b ? { key: b.dataset.guessKey, mode: b.dataset.guessMode } : null; });
  assert.ok(keyChip, "a key chip");
  await T(() => document.querySelector("#seGuesses [data-guess-key]").click());
  await until(() => T((k) => PPTracks.data(PPTracks.song()).originalKey === k, keyChip.key), 3000, 50);
  assert.equal(await T(() => PPTracks.song().key), keyChip.key);
  // back to the detected tempo so the rest of the run plays at 120
  await T(() => { const b = Array.from(document.querySelectorAll("#seGuesses [data-guess-bpm]")).find((x) => Math.abs(Number(x.dataset.guessBpm) - 120) < 1); b.click(); });
  await until(() => T(() => Math.abs(PPTracks.data(PPTracks.song()).grid.bpm - 120) < 1), 40000, 200);
  await T(() => { PPTracks.data(PPTracks.song()).originalKey = "G"; PPTracks.data(PPTracks.song()).originalMode = "major"; PPTracks.song().key = "G"; PPTracks.data(PPTracks.song()).keyShift = 0; document.querySelector("#songDialog").close(); });
});
await check("tempo map: a 3/4 section at 90 BPM and a 2-bar ritardando ending move the beats, bars and the click", async () => {
  const r = await T(() => {
    const s = PPTracks.song(), t = PPTracks.data(s), g0 = PPTracks.grid(s);
    const bars120 = g0.bars.slice(0, 5).map((x) => Math.round(x * 100) / 100);
    t.tempoMap = [{ bar: 3, bpm: 90, bpb: 3 }, { bar: 5, bpm: 120, bpb: 4, ritBars: 2, ritTo: 60 }];
    PPTracks.pushAll(s);
    const g = PPTracks.grid(s);
    const bars = g.bars.slice(0, 8).map((x) => Math.round(x * 100) / 100);
    const beatsBar3 = g.times.filter((x) => x >= g.bars[2] - 1e-6 && x < g.bars[3] - 1e-6).length;
    PPTracks.render();
    const b7 = PPTracks.timeToBar(s, g.bars[6] + 0.1), meter = document.querySelector("#trSongMeta").textContent;
    t.tempoMap = []; PPTracks.pushAll(s); PPTracks.render();
    return { bars120, bars, beatsBar3, barLen3: Math.round((g.bars[3] - g.bars[2]) * 100) / 100, barLen5: Math.round((g.bars[5] - g.bars[4]) * 100) / 100, barLen6: Math.round((g.bars[6] - g.bars[5]) * 100) / 100, barLen7: Math.round((g.bars[7] - g.bars[6]) * 100) / 100, b7: b7.bar, meter };
  });
  // 120 BPM 4/4 = 2 s bars; bar 3-4 in 3/4 at 90 = 2 s each (3 beats of 0.667); bar 5 ramps 120 -> 60 over 2 bars, bar 7 on at 60 (4 s)
  assert.ok(Math.abs(r.bars120[1] - r.bars120[0] - 2) < 0.05, JSON.stringify(r));
  assert.equal(r.beatsBar3, 3, JSON.stringify(r)); assert.ok(Math.abs(r.barLen3 - 2) < 0.05, JSON.stringify(r));
  assert.ok(r.barLen5 > 2.2 && r.barLen5 < 2.9 && r.barLen6 > 2.9 && r.barLen6 < 3.9 && Math.abs(r.barLen7 - 4) < 0.08, JSON.stringify(r));
  assert.equal(r.b7, 7); assert.match(r.meter, /4\/4 → 3\/4 → 4\/4/);
});
await check("the imported file is kept in the library on the driver and a stem can be re-decoded from it", async () => {
  await until(() => T(() => { const st = PPTracks.data(PPTracks.song()).stems[0]; return st && st.file && /\/library\//.test(st.file); }), 8000, 100);
  const file = await T(() => PPTracks.data(PPTracks.song()).stems[0].file);
  assert.ok(fs.existsSync(file) && fs.statSync(file).size > 1000, "library file " + file);
  const r = await T(async () => {
    const st = PPTracks.data(PPTracks.song()).stems[0];
    // forget the decoded copy (as a fresh card would), then ask for it again
    await new Promise((res) => { const q = indexedDB.open("pad-pedal-tracks-v1", 1); q.onsuccess = () => { const tx = q.result.transaction("stems", "readwrite"); tx.objectStore("stems").delete(st.id); tx.oncomplete = res; tx.onerror = res; }; q.onerror = res; });
    PPTracks.forgetStem(st.id);
    const rec = await PPTracks.getStem(st.id);
    return { ok: !!rec, length: rec ? rec.length : 0 };
  });
  assert.ok(r.ok && r.length > 20000, JSON.stringify(r));
});
await check("Settings → Backup: a backup zip lands on the (simulated) USB stick and is listed for restore", async () => {
  fs.mkdirSync(path.join(tmp, "media", "usb-stick"), { recursive: true });
  await T(() => PPShell.showTab("settings"));
  await T(() => document.querySelector("#bkBackup").click());
  await until(() => T(() => document.querySelector("#bkList [data-bk-to]")), 5000, 100);
  await T(() => document.querySelector("#bkList [data-bk-to]").click());
  await until(() => T(() => /Backup written/.test(document.querySelector("#bkList").textContent)), 30000, 200);
  const zips = fs.readdirSync(path.join(tmp, "media", "usb-stick", "Central Control")).filter((f) => /^central-control-backup-.*\.zip$/.test(f));
  assert.equal(zips.length, 1, JSON.stringify(zips));
  await T(() => document.querySelector("#bkRestore").click());
  await until(() => T(() => document.querySelector("#bkList [data-bk-restore]")), 5000, 100);
  const listed = await T(() => document.querySelector("#bkList [data-bk-restore]").textContent);
  assert.ok(listed.includes(zips[0]), listed);
  assert.ok(fs.existsSync(path.join(tmp, "project.json")), "project.json mirrored to the driver");
  await T(() => PPShell.showTab("tracks"));
});
await check("listen & write chord chart: a G-major chart is written, saved on the driver and attached to the song", async () => {
  const res = await T(async () => { const r = await PPChords.generateChart(PPTracks.song()); return { n: r.chords.length, saved: r.saved, text: r.text, chart: PPTracks.song().chart }; });
  assert.ok(res.n >= 1 && res.saved, "chords " + res.n + " saved " + res.saved);
  assert.match(res.text, /\{key: G\}/); assert.ok(/\| G /.test(res.text), "G bars in chart:\n" + res.text.slice(0, 200));
  assert.ok(res.chart && res.chart.id, "chart attached");
  const parsed = await T((t) => PPChords.parseChart(t), res.text); assert.equal(parsed.key, "G");
  const v = await T((t) => { const p = PPChords.parseChart(t); const vw = PPChords.view({ chartKey: p.key, songKey: "A", instrument: "guitar", shape: "G" }); return { capo: vw.capo, first: PPChords.chordsIn(p)[0], shown: vw.chord(PPChords.chordsIn(p)[0]) }; }, res.text);
  assert.equal(v.capo, 2, JSON.stringify(v)); assert.ok(/^G/.test(v.shown), JSON.stringify(v));
});
await check("sheet music: the stem is transcribed and notation, tab, piano roll and Nashville views render", async () => {
  await T(() => PPNotation.open());
  await page.waitForSelector("#sheetDialog[open]");
  await page.selectOption("#shMode", "mono"); await page.click("#shGo");
  await until(() => T(() => /notes/.test(document.querySelector("#shStatus").textContent)), 60000, 300);
  const n = await T(() => PPTracks.data(PPTracks.song()).transcriptions[Object.keys(PPTracks.data(PPTracks.song()).transcriptions)[0]].notes.length); assert.ok(n > 4, "notes " + n);
  assert.ok(await page.$("#shBody svg.notation"), "notation svg");
  await page.click('[data-view="tab"]'); assert.ok(await page.$("#shBody svg.notation.tab"), "tab svg");
  await page.click('[data-view="roll"]'); assert.ok(await page.$("#shBody canvas.sh-roll"), "piano roll canvas");
  await page.click('[data-view="nashville"]'); assert.ok((await page.textContent("#shBody")).indexOf("1") > -1, "nashville");
  await page.selectOption("#shInst", "Bb"); await page.click('[data-view="chart"]'); assert.match(await page.textContent("#shBody"), /reads in A/);
  await T(() => document.querySelector("#sheetDialog").close());
});
await check("USE TRACKS on + play: the transport runs, the click bus makes sound, the driver gets the display state", async () => {
  await T(async () => { PPTracks.setTracksMode(true); await PPTracks.play({ countIn: false }); });
  await until(() => T(() => PPTracks.state.playing && PPTracks.state.pos > 0.5), 8000);
  const click = await T(async () => { const e = PP.engine, a = e.ctx.createAnalyser(); a.fftSize = 2048; e.clickBus.connect(a); let peak = 0; for (let i = 0; i < 40; i++) { const d = new Float32Array(2048); a.getFloatTimeDomainData(d); for (const x of d) peak = Math.max(peak, Math.abs(x)); await new Promise(r => setTimeout(r, 50)); } return peak; });
  assert.ok(click > 0.05, "click peak " + click);
  const d = await (await fetch("http://127.0.0.1:8080/api/display")).json();
  assert.equal(d.song.name, "Test Song"); assert.equal(d.playing, true); assert.ok(d.sections.length >= 2);
});
await check("with tracks: button 2 stops all, button 1 plays all, button 4 is next section", async () => {
  async function dbg(step) { const d = await T(() => ({ playing: PPTracks.state.playing, section: PPTracks.state.section, pos: PPTracks.state.pos, loop: PPTracks.state.loop, tracksMode: PP.project().tracksMode, entry: PPActions.entryFor("b1") })); return step + ": " + JSON.stringify(d); }
  if (!(await T(() => PPTracks.state.playing))) await T(async () => { await PPTracks.play({ countIn: false }); });
  await until(() => T(() => PPTracks.state.playing), 5000);
  try { await sim({ sim: "press", id: "b2" }); await until(() => T(() => !PPTracks.state.playing), 5000); await sim({ sim: "release", id: "b2" }); } catch (e) { throw new Error(await dbg("b2 should stop")); }
  await wait(300);
  try { await sim({ sim: "press", id: "b1" }); await until(() => T(() => PPTracks.state.playing), 5000); await sim({ sim: "release", id: "b1" }); } catch (e) { throw new Error(await dbg("b1 should play again")); }
  try { await T(() => PPTracks.goSection(0, { immediate: true })); await until(() => T(() => PPTracks.state.section === 0), 5000); } catch (e) { throw new Error(await dbg("goSection 0")); }
  await wait(300);
  await sim({ sim: "press", id: "b4" }); await sim({ sim: "release", id: "b4" });
  try { await until(() => T(() => PPTracks.state.section === 1), 8000); } catch (e) { throw new Error(await dbg("b4 next section")); }
});
await check("key up shifts the tracks (+1) and the pads follow the song key", async () => { await T(() => PPTracks.shiftKey(1)); const r = await T(() => ({ key: PPTracks.song().key, shift: PPTracks.data(PPTracks.song()).keyShift, padKey: PP.playKeyFor(PP.currentPad()) })); assert.equal(r.key, "G#"); assert.equal(r.shift, 1); assert.equal(r.padKey, "G#"); await T(() => PPTracks.shiftKey(-1)); });
await check("repeat section loops back", async () => { await T(() => { PPTracks.goSection(0, { immediate: true }); PPTracks.setLoop(0); }); const end = await T(() => PPTracks.sectionsOf(PPTracks.song())[0].end); await until(() => T(() => PPTracks.state.pos > 0.2), 3000); await until(() => T((end) => PPTracks.state.loop === 0 && PPTracks.state.pos < end, end), 2000); await T(() => PPTracks.setLoop(-1)); });

await check("flow: Intro → Verse → Intro plays the Verse, then jumps back to the Intro gaplessly; hold-to-queue and skip edit the flow", async () => {
  const r0 = await T(() => {
    const s = PPTracks.song(), t = PPTracks.data(s), secs = PPTracks.sectionsOf(s);
    // make the sections short so the test is quick: Intro bar 1, Verse bar 3, Chorus bar 5
    t.sections = [{ id: "sI", name: "Intro", bar: 1, pad: -1, transition: "inherit", cue: "auto", lyrics: "", page: 0 }, { id: "sV", name: "Verse 1", bar: 3, pad: -1, transition: "inherit", cue: "auto", lyrics: "", page: 0 }, { id: "sC", name: "Chorus", bar: 5, pad: -1, transition: "inherit", cue: "auto", lyrics: "", page: 0 }];
    t.flow = ["sI", "sV", "sI", "sC"]; t.flowOn = true; t.cues.on = false;
    PPTracks.pushAll(s); PPTracks.render();
    return { entries: PPTracks.flowEntries(s).map((x) => x.sec.name), chips: document.querySelectorAll("#trFlow .fl-chip").length, on: /ON/.test(document.querySelector("#trFlow .fl-toggle").textContent) };
  });
  assert.deepEqual(r0.entries, ["Intro", "Verse 1", "Intro", "Chorus"]); assert.equal(r0.chips, 4); assert.ok(r0.on, JSON.stringify(r0));
  // play from the start of the Verse (flow entry 1): at its end (bar 5) the player must land back on the Intro (bar 1)
  await T(() => { PPTracks.goSection(1, { immediate: true }); PPTracks.play({ countIn: false }); });
  const verseEnd = await T(() => PPTracks.sectionsOf(PPTracks.song())[1].end);
  await until(() => T(() => PPTracks.state.pos > 0.5 && PPTracks.state.flowIndex === 1), 4000, 50);
  await until(() => T((e) => PPTracks.state.flowIndex === 2 && PPTracks.state.pos < e - 0.5, verseEnd), 8000, 30);
  const after = await T(() => ({ idx: PPTracks.state.flowIndex, pos: PPTracks.state.pos, section: PPTracks.state.section, current: document.querySelector("#trFlow .fl-chip.current").textContent }));
  assert.ok(after.pos < 2.5 && after.section === 0 && after.current === "Intro", JSON.stringify(after));
  await T(() => PPTracks.pause());
  // hold a section button -> queued next; skip -> removed
  await T(() => { PPTracks.state.flowIndex = 2; PPTracks.queueSection(2); });
  let fl = await T(() => PPTracks.data(PPTracks.song()).flow);
  assert.deepEqual(fl, ["sI", "sV", "sI", "sC", "sC"], JSON.stringify(fl));
  await T(() => PPTracks.flowSkip());
  fl = await T(() => PPTracks.data(PPTracks.song()).flow);
  assert.deepEqual(fl, ["sI", "sV", "sI", "sC"], JSON.stringify(fl));
  // the display state carries the flow, the next section, the beat grid and the hits for the lights
  const disp = await T(() => new Promise((res) => { const orig = window.__pedalBridge.send; window.__pedalBridge.send = function (m) { if (m.type === "display") { window.__pedalBridge.send = orig; res({ flow: m.flow, next: m.next, hasGrid: !!(m.grid && m.grid.bars && m.grid.bars.length), hits: Array.isArray(m.hits) }); } return orig.call(this, m); }; PPTracks.state.flowIndex = 1; PPTracks.pushAll(PPTracks.song()); PPTracks.render(); PPTracks.seek(0); }));
  assert.ok(disp.flow && disp.flow.entries.length === 4 && disp.next && disp.next.name, JSON.stringify(disp));
  await T(() => { const t = PPTracks.data(PPTracks.song()); t.flowOn = false; t.flow = []; t.cues.on = true; PPTracks.pushAll(PPTracks.song()); PPTracks.render(); PPTracks.goSection(0, { immediate: true }); PPTracks.play({ countIn: false }); });
  await until(() => T(() => PPTracks.state.playing), 3000);
});

await check("per-stem direct outputs: offered only with a multi-channel USB interface; a stem routed to output 5 leaves the mix and the worklet gets its slot", async () => {
  const r = await T(async () => {
    const s = PPTracks.song(), t = PPTracks.data(s), st = t.stems[0];
    const before = !!document.querySelector("#trStems .stem-out");
    // pretend the OS reports a 6-channel output with a USB interface (as the Pi does with an interface plugged in)
    PPFeatures.handleHardware({ type: "systemStatus", audio: { channels: ["1 · jack L", "2 · jack R", "3 · DAC L", "4 · DAC R", "5 · USB Scarlett out 1", "6 · USB Scarlett out 2"], hdmi: false, usbFirst: false } });
    await new Promise((r) => setTimeout(r, 100));
    const offered = !!document.querySelector("#trStems .stem-out");
    const sel = document.querySelector("#trStems .stem-out"); sel.value = "5"; sel.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 100));
    const maxCh = PP.engine.ctx.destination.maxChannelCount;
    return { before, offered, out: st.out, slot: st.outSlot, routed: PP.engine.routing && PP.engine.routing.direct ? PP.engine.routing.direct[st.id] : null, maxCh, mode: PP.engine.routing && PP.engine.routing.mode, label: document.querySelector("#trStems .stem small:last-child").textContent };
  });
  assert.equal(r.before, false, "no picker without a USB interface");
  assert.equal(r.offered, true, "picker with a USB interface");
  assert.equal(r.out, 5); assert.equal(r.slot, 0); assert.match(r.label, /out 5/);
  // headless Chromium's destination is stereo, so the engine folds the direct out back into the mix (and says so); on the Pi routing.direct carries the channel
  if (r.maxCh > 5) assert.equal(r.routed, 5, JSON.stringify(r)); else assert.equal(r.mode, "stereo2", JSON.stringify(r));
  await T(() => { const sel = document.querySelector("#trStems .stem-out"); sel.value = "0"; sel.dispatchEvent(new Event("change", { bubbles: true })); PPFeatures.handleHardware({ type: "systemStatus", audio: { channels: ["1 · jack L", "2 · jack R"], hdmi: false, usbFirst: false } }); });
});
const stagePage = await ctx.newPage();
await check("the stage display page shows the section, what is next, the beat, the countdown and the flow", async () => {
  await stagePage.goto("http://127.0.0.1:8080/stage?code=" + code);
  await T(() => { PPTracks.goSection(0, { immediate: true }); PPTracks.play({ countIn: false }); });
  await until(() => stagePage.evaluate(() => !document.querySelector("#wrap").hidden && document.querySelector("#section").textContent === "Intro"), 8000, 100);
  const r = await stagePage.evaluate(() => ({ next: document.querySelector("#nextName").textContent, beats: document.querySelectorAll("#beats .beat").length, flow: document.querySelectorAll("#flow span").length, time: document.querySelector("#time").textContent, idle: document.querySelector("#idle").hidden }));
  assert.ok(r.next === "Verse 1" && r.beats === 4 && r.flow >= 2 && /\d:\d\d \/ 0:24/.test(r.time) && r.idle, JSON.stringify(r));
});

console.log("\nAdding songs:");
await check("Planning Center: connect with a token, pick the plan, import - key, BPM, 3/4, sections in service order with lyrics, the chart and the stem, top of the setlist", async () => {
  await T(() => PPSources.open("pco"));
  await page.waitForSelector("#pcoApp", { timeout: 5000 });
  await page.fill("#pcoApp", "app123"); await page.fill("#pcoSecret", "secret456");
  await page.click('[data-a="pco-connect"]');
  await page.waitForSelector("#addBody [data-item]", { timeout: 8000 });
  const listed = await T(() => document.querySelector("#addBody .add-list").textContent);
  assert.match(listed, /Amazing Grace/); assert.match(listed, /G♯ · 100 BPM · 3\/4/);
  await page.click('[data-a="pco-import"]');
  await until(() => T(() => /✓ Amazing Grace/.test(document.querySelector("#addBody .add-progress").textContent)), 40000, 200);
  const r = await T(() => { const s = PP.project().songs[0], t = PPTracks.data(s); return { name: s.name, key: s.key, bpb: t.grid.bpb, secs: t.sections.map((x) => x.name), lyr: t.sections[1] && t.sections[1].lyrics, stems: t.stems.map((q) => q.name + ":" + q.role), chart: !!s.chart, pco: !!s.pco }; });
  assert.equal(r.name, "Amazing Grace (My Chains Are Gone)"); assert.equal(r.key, "G#"); assert.equal(r.bpb, 3);
  assert.deepEqual(r.secs, ["Verse 1", "Chorus", "Verse 1", "Chorus"]); assert.match(r.lyr || "", /My chains are gone/);
  assert.deepEqual(r.stems, ["Keys:keys"]); assert.ok(r.chart && r.pco, JSON.stringify(r));
  await T(() => document.querySelector("#addDialog").close());
});
await check("track pack: a MultiTracks-style folder on the stick is scanned (title, key, BPM, roles, full mix left out) and imported as a song", async () => {
  const dir = path.join(tmp, "media", "usb-stick", "Goodness of God (A) 63 BPM");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "Click.wav"), wav(63, 9, 5, 22050)); fs.writeFileSync(path.join(dir, "Bass.wav"), wav(63, 9, 5, 22050)); fs.writeFileSync(path.join(dir, "Goodness of God - Full Mix.wav"), wav(63, 9, 5, 22050));
  const scan = await T(async (d) => { const r = await fetch("http://127.0.0.1:8766/pack/scan", { method: "POST", body: JSON.stringify({ path: d }) }); const j = await r.json(); j.stems.forEach((e) => { e.keep = e.use; }); PPSources.state.pack = j; PPSources.open("pack"); return j; }, dir);
  assert.equal(scan.title, "Goodness of God"); assert.equal(scan.key, "A"); assert.equal(scan.bpm, 63);
  assert.deepEqual(scan.stems.filter((e) => e.use).map((e) => e.name + ":" + e.role).sort(), ["Bass.wav:bass", "Click.wav:click"]);
  await page.click('[data-a="pack-import"]');
  await until(() => T(() => /✓ Goodness of God/.test(document.querySelector("#addBody .add-progress").textContent)), 40000, 200);
  const r = await T(() => { const s = PPTracks.findSongByName("Goodness of God"), t = PPTracks.data(s); return { key: s.key, stems: t.stems.map((q) => q.role + ":" + q.bus).sort(), files: t.stems.every((q) => /\/library\//.test(q.file || "")) }; });
  assert.equal(r.key, "A"); assert.deepEqual(r.stems, ["bass:music", "click:click"]);
  await T(() => document.querySelector("#addDialog").close());
  await until(() => T(() => PPTracks.data(PPTracks.findSongByName("Goodness of God")).stems.every((q) => /\/library\//.test(q.file || ""))), 5000, 100);
  await T(() => { const p = PP.project(); const i = p.songs.findIndex((s) => s.name === "Test Song"); if (i >= 0) PPFeatures.loadSong(i); });
  await until(() => T(() => PPTracks.song().name === "Test Song"), 3000);
  await wait(400); await T(() => { PPTracks.goSection(0, { immediate: true }); PPTracks.play({ countIn: false }); });
  await until(() => T(() => PPTracks.state.playing), 5000);
});

console.log("\nInstrument:");
await check("the Instrument tab shows the electric board with real plugin knobs and a footswitch toggles a pedal", async () => {
  await T(() => { PPShell.showTab("instrument"); PPInstrument.setKind("electric"); }); await page.waitForSelector("#pbChain svg.pedal", { timeout: 5000 });
  const n = await page.$$eval("#pbChain svg.pedal", (l) => l.length); assert.ok(n >= 5, "pedals " + n);
  const knobs = await page.$$eval("#pbChain svg.pedal:first-child .pk-lbl", (l) => l.map((e) => e.textContent)); assert.ok(knobs.length >= 2, "knob labels " + knobs.join(","));
  await page.click("#pbChain svg.pedal:first-child .pk-sw"); await wait(200);
  assert.equal(await T(() => PPInstrument.pedalNames()[0].on), false);
  await T(() => PPActions.run("pedalToggle", { index: 0 })); assert.equal(await T(() => PPInstrument.pedalNames()[0].on), true);
});
await check("the driver receives the chain (apply) and reports instrument status; knob changes go out as set messages", async () => {
  const sent = await T(() => PPInstrument.hostConfig()); assert.equal(sent.kind, "electric"); assert.ok(sent.chain.length >= 5 && sent.chain.every((c) => c.uri && c.uid && Object.keys(c.values).length), JSON.stringify(sent.chain[0]));
  await until(() => T(() => /running|Problem|Starting|Preview/.test(document.querySelector(".in-status").textContent)), 6000);
  await page.click("#pbChain svg.pedal:first-child"); await page.waitForSelector(".in-controls input[type=range]", { timeout: 4000 });
  await T(() => { window.__sent = []; const b = window.__pedalBridge, orig = b.send; b.send = function (m) { window.__sent.push(m); return orig.call(b, m); }; });
  await page.$eval(".in-controls input[type=range]", (el) => { el.value = 900; el.dispatchEvent(new Event("input", { bubbles: true })); }); await wait(300);
  const setMsg = await T(() => window.__sent.filter((m) => m.type === "instrument" && m.action === "set")[0]); assert.ok(setMsg && setMsg.uid && setMsg.sym && typeof setMsg.value === "number", JSON.stringify(setMsg));
});
await check("keys: the sound list arrives from the driver and the on-screen keyboard sends notes", async () => {
  await T(() => PPInstrument.setKind("keys")); await until(() => T(() => document.querySelectorAll(".keys-item").length > 0 || /No sound banks/.test(document.querySelector(".in-keys").textContent)), 8000);
  await page.waitForSelector(".kk.white", { timeout: 4000 }); await T(() => { window.__sent = []; }); await page.dispatchEvent(".kk.white", "pointerdown"); await page.dispatchEvent(".kk.white", "pointerup"); await wait(300);
  const notes = await T(() => window.__sent.filter((m) => m.type === "instrument" && m.action === "note").map((m) => m.on)); assert.deepEqual(notes, [true, false], "note on + off sent: " + JSON.stringify(notes));
  await T(() => { PPInstrument.setKind("off"); PPShell.showTab("tracks"); });
});
console.log("\nVersion 7 - mixer, scenes, segues, layers, looper, ProPresenter, updates:");
await T(() => { window.__sent = []; const b = window.__pedalBridge; if (!b.__wrapped && !/__sent/.test(b.send.toString())) { const orig = b.send; b.send = function (m) { (window.__sent = window.__sent || []).push(m); return orig.call(b, m); }; b.__wrapped = true; } PPShell.showTab("tracks"); });
await check("the mixer: every track gets a big fader with a meter, mute / solo and pan, plus Tracks / Click / Cues; it moves while the song plays", async () => {
  await T(() => { const p = PP.project(); const i = p.songs.findIndex((s) => s.name === "Test Song"); PPFeatures.loadSong(i); });
  await until(() => T(() => PPTracks.song() && PPTracks.data(PPTracks.song()).stems.length > 0));
  await page.click("#trMixer"); await page.waitForSelector("#mixDialog[open] #mixStrips .stem[data-stem]");
  const r = await T(() => ({ stems: document.querySelectorAll("#mixStrips .stem[data-stem]").length, buses: [...document.querySelectorAll("#mixStrips .stem.bus")].map((b) => b.dataset.bus), n: PPTracks.data(PPTracks.song()).stems.length, meters: document.querySelectorAll("#mixStrips .stem-meter").length }));
  assert.equal(r.stems, r.n); assert.deepEqual(r.buses, ["tracks", "click", "cue"]); assert.equal(r.meters, r.n);
  await T(() => { PPTracks.goSection(0, { immediate: true }); PPTracks.play({ countIn: false }); });
  await until(() => T(() => Object.values(PPTracks.meters()).some((v) => v > 0.001)), 6000);
  const id = await T(() => PPTracks.data(PPTracks.song()).stems[0].id);
  await page.$eval('#mixStrips .stem[data-stem="' + id + '"] .stem-fader', (el) => { el.value = 0.5; el.dispatchEvent(new Event("input", { bubbles: true })); });
  const g = await T((id) => ({ data: PPTracks.data(PPTracks.song()).stems.find((s) => s.id === id).gain, small: document.querySelector('#trStems .stem[data-stem="' + id + '"] .stem-fader').value, db: document.querySelector('#mixStrips .stem[data-stem="' + id + '"] .stem-db').textContent }), id);
  assert.equal(g.data, 0.5); assert.equal(Number(g.small), 0.5); assert.match(g.db, /-6\.0 dB/);
  await page.click("#mixDialog [data-close=mixDialog]");
});
await check("pads: up to 4 layers at once (a 5th replaces the oldest), each with its own level", async () => {
  await T(() => { PP.engine.stop(); PP.project().performance.layerMode = true; });
  await wait(300);
  for (let i = 0; i < 5; i++) { await T((i) => PP.triggerPad(i, { layer: true }), i); await wait(150); }
  await until(() => T(() => PP.engine.layerState().length === 4));
  const ls = await T(() => PP.engine.layerState().map((l) => l.pad));
  assert.deepEqual(ls.slice().sort(), [1, 2, 3, 4], "pad 1 made room: " + JSON.stringify(ls));
  await T(() => PP.engine.setLayerLevel(2, 0.4));
  assert.equal(await T(() => PP.engine.layerState().find((l) => l.pad === 2).level), 0.4);
  await until(() => T(() => document.querySelectorAll("#pfLayers .pf-layer").length === 4));
});
await check("scenes: capture pads (with levels) + mix, change everything, recall - pads and faders come back, smoothly", async () => {
  const r = await T(async () => {
    const s = PPTracks.song(), t = PPTracks.data(s), id = t.stems[0].id;
    PPTracks.applyMix([{ id, gain: 0.3, mute: false }], 0);
    const sc = PPScenes.newScene({ pads: true, mix: true }, "Verse feel");
    PP.engine.stop(); PPTracks.applyMix([{ id, gain: 1 }], 0);
    await new Promise((r) => setTimeout(r, 400));
    PPScenes.recall(sc, { now: true });
    await new Promise((r) => setTimeout(r, 1200));
    return { pads: PP.engine.layerState().map((l) => [l.pad, Math.round(l.level * 100) / 100]).sort(), gain: t.stems[0].gain, desc: PPScenes.describe(sc), active: PPScenes.activeIndex(), scenes: PPScenes.scenes(s).length };
  });
  assert.equal(r.pads.length, 4); assert.ok(r.pads.some((p) => p[0] === 2 && p[1] === 0.4), JSON.stringify(r.pads));
  assert.equal(r.gain, 0.3); assert.match(r.desc, /mix of/); assert.equal(r.active, 0);
});
await check("a section's scene is recalled automatically when the section starts; a MIDI program change recalls a scene; MIDI learn works", async () => {
  const r = await T(async () => {
    const s = PPTracks.song(), t = PPTracks.data(s), id = t.stems[0].id;
    PPTracks.applyMix([{ id, gain: 0.8 }], 0);
    const loud = PPScenes.newScene({ mix: true }, "Chorus lift");
    const secs = PPTracks.sectionsOf(s); secs[1].sec.scene = loud.id;
    PPTracks.applyMix([{ id, gain: 0.2 }], 0); PPScenes.recall(PPScenes.scenes(s)[0], { now: true });
    PPTracks.goSection(1, { immediate: true }); if (!PPTracks.isPlaying()) PPTracks.play({ countIn: false });
    await new Promise((r) => setTimeout(r, 900));
    const autoGain = t.stems[0].gain, autoActive = PPScenes.activeIndex();
    PPScenes.scenes(s)[0].midi = { type: "pc", ch: 0, num: 5 };
    PPFeatures.handleHardware({ type: "midi", data: [0xC2, 5] });
    await new Promise((r) => setTimeout(r, 300));
    return { autoGain, autoActive, midiActive: PPScenes.activeIndex() };
  });
  assert.equal(r.autoGain, 0.8); assert.equal(r.autoActive, 1); assert.equal(r.midiActive, 0);
  await T(() => PPTracks.openEditor()); await page.waitForSelector("#seScenes .sc-row");
  await page.click('#seScenes .sc-row:nth-child(2) [data-sclearn]');
  await T(() => PPFeatures.handleHardware({ type: "midi", data: [0x90, 61, 100] }));
  const cue = await T(() => PPScenes.scenes(PPTracks.song())[1].midi);
  assert.deepEqual(cue, { type: "note", ch: 1, num: 61 });
  assert.ok(await T(() => document.querySelector('#seSections [data-secf="scene"]') !== null), "section scene picker in the editor");
  await T(() => document.querySelector("#songDialog").close());
});
await check("ProPresenter: a section with a slide number sends it to the driver when it starts", async () => {
  await T(() => { const s = PPTracks.song(); PPTracks.sectionsOf(s)[0].sec.slide = 2; window.__sent = []; PPTracks.goSection(0, { immediate: true }); });
  const m = await until(() => T(() => (window.__sent || []).find((x) => x.type === "propresenter" && x.action === "section")), 4000);
  assert.equal(m.slide, 2); assert.equal(m.song, "Test Song");
});
await check("segue: the next song is loaded on the second player and starts as this one ends (gapless), the song changes on its own", async () => {
  const r0 = await T(async () => {
    const p = PP.project(), cur = p.songIndex, s = PPTracks.song(), t = PPTracks.data(s);
    const other = p.songs.findIndex((q, i) => i !== cur && q.tracks && q.tracks.stems && q.tracks.stems.length);
    if (other !== cur + 1) { const [mv] = p.songs.splice(other, 1); const at = p.songs.indexOf(s); p.songs.splice(at + 1, 0, mv); p.songIndex = at; }
    const ci = p.songs.indexOf(s);
    t.after = "segue"; t.overlap = 0; t.flowOn = false; PPTracks.setLoop(-1);
    return { cur: s.name, next: p.songs[ci + 1].name, deck: PPTracks.segueState().deck, order: p.songs.map((q) => q.name + ":" + ((q.tracks && q.tracks.stems) || []).length) };
  });
  await T(() => { const t = PPTracks.data(PPTracks.song()); PPTracks.seek(Math.max(0, t.duration - 4)); if (!PPTracks.isPlaying()) PPTracks.play({ countIn: false }); });
  const diag = () => T(() => ({ seg: PPTracks.segueState(), song: PPTracks.song().name, pos: PPTracks.state.pos, playing: PPTracks.isPlaying(), dur: PPTracks.data(PPTracks.song()).duration, after: PPTracks.afterMode(PPTracks.data(PPTracks.song())), idx: PP.project().songIndex, next: (PP.project().songs[PP.project().songIndex + 1] || {}).name, tm: PP.project().tracksMode }));
  let preloaded = false;
  try { await until(async () => { const st = await T(() => ({ other: PPTracks.segueState().other, name: PPTracks.song().name })); if (st.other) preloaded = true; return st.name === r0.next; }, 15000, 40); } catch (e) { throw new Error("no segue: " + JSON.stringify(r0) + " now " + JSON.stringify(await diag()) + " preloaded " + preloaded); }
  assert.ok(preloaded, "the next song was waiting on the second player before the end");
  const r = await T(() => ({ playing: PPTracks.isPlaying(), pos: PPTracks.state.pos, deck: PPTracks.segueState().deck }));
  assert.ok(r.playing, "still playing after the segue"); assert.ok(r.pos < 3, "the new song starts at its top: " + r.pos); assert.notEqual(r.deck, r0.deck);
  await T(() => PPTracks.stop(true));
});
await check("instrument: every pedal has Mix and Level (sent live), keys get up to 8 layers with a split", async () => {
  await T(() => { PPShell.showTab("instrument"); PPInstrument.setKind("electric"); });
  await page.waitForSelector("#pbChain svg.pedal"); await page.click("#pbChain svg.pedal:first-child");
  await page.waitForSelector("[data-pmix]"); await T(() => { window.__sent = []; });
  await page.$eval("[data-pmix]", (el) => { el.value = 40; el.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.$eval("[data-plevel]", (el) => { el.value = -6; el.dispatchEvent(new Event("input", { bubbles: true })); });
  const pm = await T(() => window.__sent.filter((m) => m.action === "pedalmix"));
  assert.equal(pm[pm.length - 1].mix, 0.4); assert.equal(pm[pm.length - 1].levelDb, -6);
  assert.ok(await T(() => PPInstrument.hostConfig().chain[0].mix === 0.4));
  await T(() => PPInstrument.setKind("keys")); await page.waitForSelector("#klAdd");
  for (let i = 0; i < 8; i++) { const dis = await page.$eval("#klAdd", (b) => b.disabled); if (dis) break; await page.click("#klAdd"); }
  const n = await T(() => PPInstrument.layers().length); assert.equal(n, 8, "8 layers at most");
  assert.ok(await page.$eval("#klAdd", (b) => b.disabled), "no 9th layer");
  await page.click("#klSplit");
  const k = await T(() => PPInstrument.hostConfig().keys.layers);
  assert.equal(k.length, 8); assert.equal(k[0].hi, 59); assert.equal(k[1].lo, 60);
});
await check("instrument scenes: capture the rig, switch pedals, recall - one 'scene' message switches them back without a restart", async () => {
  await T(() => PPInstrument.setKind("electric")); await wait(500);
  const r = await T(async () => {
    const sc = PPScenes.newScene({ rig: true }, "Lead");
    PPInstrument.togglePedal(0); PPInstrument.togglePedal(1);
    window.__sent = []; PPScenes.recall(sc, { now: true });
    await new Promise((r) => setTimeout(r, 200));
    return { msgs: window.__sent.filter((m) => m.type === "instrument").map((m) => m.action), on: PPInstrument.pedalNames().slice(0, 2).map((p) => p.on), saved: sc.rig.pedals.slice(0, 2).map((p) => p.on) };
  });
  assert.deepEqual(r.msgs, ["scene"]); assert.deepEqual(r.on, r.saved);
  await T(() => PPInstrument.setKind("off"));
});
await check("looper: records a loop from the instrument, closes it, plays it, overdubs, undoes and clears", async () => {
  const r = await T(async () => {
    const ctx = PP.engine.ctx, osc = ctx.createOscillator(); osc.frequency.value = 220; osc.start();
    await PPLooper.useNode(osc); PPLooper.config().sync = false;
    const states = [];
    const waitState = async (want) => { for (let i = 0; i < 60; i++) { if (PPLooper.state().state === want) return true; await new Promise((r) => setTimeout(r, 50)); } return false; };
    await PPLooper.main(); states.push(await waitState("recording"));
    await new Promise((r) => setTimeout(r, 500));
    await PPLooper.main(); states.push(await waitState("playing"));
    const len = PPLooper.state().len;
    await PPLooper.main(); states.push(await waitState("dubbing"));
    await PPLooper.main(); states.push(await waitState("playing"));
    PPLooper.undo(); await new Promise((r) => setTimeout(r, 150)); const undone = !PPLooper.state().undo;
    PPLooper.stop(); states.push(await waitState("stopped"));
    PPLooper.clear(); states.push(await waitState("empty"));
    osc.stop();
    return { states, len, rate: ctx.sampleRate, undone };
  });
  assert.deepEqual(r.states, [true, true, true, true, true, true]); assert.ok(r.len > r.rate * 0.3 && r.len < r.rate * 1.5, "loop length " + r.len); assert.ok(r.undone);
});
await check("updates: a newer release asks 'Update available - update now?'; Yes waits until nothing is playing; No closes it", async () => {
  await T(() => { PPTracks.stop(true); PP.engine.stop(); }); await wait(300);
  await T(() => { PPShell.showTab("pads"); PP.triggerPad(0); }); await until(() => T(() => PP.engine.voices().length > 0), 5000);
  await T(() => { PPFeatures.handleHardware({ type: "updateStatus", current: "7.0.0", latest: "7.1.0", available: true, notes: "Better", repo: "church/cc", auto: true }); });
  await until(() => T(() => document.querySelector("#updAsk") && document.querySelector("#updAsk").open));
  assert.match(await T(() => document.querySelector("#updAsk").textContent), /7\.1\.0[\s\S]*Stop the pads/);
  assert.ok(await T(() => document.querySelector('#updAsk [data-ask="yes"]').disabled), "Yes waits while pads play");
  assert.ok(await T(() => document.querySelector("#updBanner").classList.contains("hidden")), "no banner under the question");
  await T(() => PP.engine.panic ? PP.engine.panic() : PP.engine.stop()); await wait(3600);
  assert.equal(await T(() => document.querySelector('#updAsk [data-ask="yes"]').disabled), false);
  assert.match(await T(() => document.querySelector("#updAsk").textContent), /Want to update now\?/);
  await page.click('#updAsk [data-ask="no"]');
  assert.ok(await T(() => !document.querySelector("#updAsk").open && document.querySelector("#updBanner").classList.contains("hidden")));
  await T(() => { PPFeatures.handleHardware({ type: "updateStatus", current: "7.0.0", latest: "7.1.0", available: true, notes: "Better", repo: "church/cc", auto: true }); }); await wait(300);
  assert.ok(await T(() => !document.querySelector("#updAsk").open), "No: not asked again until the app opens again");
});

// back to the state the companion checks expect: Test Song chosen and stopped, pads in normal mode
await T(() => { PPTracks.stop(true); PP.engine.stop(); PP.project().performance.layerMode = false; const p = PP.project(), i = p.songs.findIndex((q) => q.name === "Test Song"); PPTracks.data(p.songs[i]).after = "stop"; PPFeatures.loadSong(i); PPShell.showTab("tracks"); });
await wait(800); await T(() => { PPTracks.goSection(0, { immediate: true }); PPTracks.play({ countIn: false }); }); await until(() => T(() => PPTracks.isPlaying()), 5000);
console.log("\nCompanion devices:");
const charts = await ctx.newPage();
await charts.goto("http://127.0.0.1:8080/");
await check("the charts page follows the Pad Pedal's song and sections", async () => { await until(() => charts.evaluate(() => /Test Song/.test(document.querySelector("#song").textContent)), 8000); await until(() => charts.evaluate(() => document.querySelectorAll("#sections button").length >= 2)); });
await check("a chart uploaded over Wi-Fi gives the song its lyrics and sections", async () => {
  const text = "Test Song\nKey: G  72 BPM\n\n[Verse 1]\nG     D\nThis is the first verse line\nAnd the second verse line\n\n[Chorus]\nC   G\nSing the chorus line here\n";
  const r = await fetch("http://127.0.0.1:8080/api/upload?kind=charts&name=Test%20Song.txt&song=Test%20Song", { method: "POST", body: text });
  assert.equal(r.status, 200);
  await until(() => T(() => { const s = PPTracks.song(); return s.chart && PPTracks.data(s).sections.some(x => /first verse/.test(x.lyrics)); }), 8000);
});
await check("...and the charts page shows the chart text with the current section highlighted", async () => { await T(() => { PPTracks.goSection(0, { immediate: true }); }); await until(() => charts.evaluate(() => /first verse line/.test(document.body.textContent)), 8000); await until(() => charts.evaluate(() => !!document.querySelector(".textchart section.current")), 8000); });
const lyrics = await ctx.newPage();
await lyrics.goto("http://127.0.0.1:8080/lyrics");
await check("the projector lyrics page shows the lyrics of the section that is playing (no chords)", async () => { await T(() => { PPTracks.goSection(0, { immediate: true }); }); await until(() => lyrics.evaluate(() => /first verse line/.test(document.querySelector(".lines") ? document.querySelector(".lines").textContent : "")), 8000); assert.equal(await lyrics.evaluate(() => /G\s+D/.test(document.body.textContent)), false); });
await check("a remote action with the pairing code jumps to the next section; without it, it is refused", async () => {
  const before = await T(() => PPTracks.state.section);
  const bad = await fetch("http://127.0.0.1:8080/api/action", { method: "POST", body: JSON.stringify({ name: "nextSection", code: "x" }) }); assert.equal(bad.status, 403);
  const ok = await fetch("http://127.0.0.1:8080/api/action", { method: "POST", body: JSON.stringify({ name: "nextSection", code }) }); assert.equal(ok.status, 200);
  await until(() => T((b) => PPTracks.state.section === b + 1, before), 6000);
});
const mini = await ctx.newPage();
await mini.goto("http://127.0.0.1:8080/mini?code=" + code);
await check("the big version of the 3.5\" screen shows the pads and transport, and its buttons work", async () => { try { await until(() => mini.evaluate(() => document.querySelectorAll("#pads .pad").length === 9 && /Test Song/.test(document.querySelector("#song").textContent)), 8000); } catch (e) { throw new Error("mini shows: " + await mini.evaluate(() => document.querySelectorAll("#pads .pad").length + " pads, song " + document.querySelector("#song").textContent) + " / app song " + await T(() => PPTracks.song() && PPTracks.song().name)); } await mini.evaluate(() => document.querySelector('[data-act="playPause"]').dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))); await until(() => T(() => !PPTracks.state.playing), 5000); });
await check("the driver drew the small screen with the song name", async () => { const fb = fs.readFileSync(path.join(tmp, "fb1")); assert.ok(fb.some((b) => b !== 0)); });
const remote = await ctx.newPage();
await remote.goto("http://127.0.0.1:8080/remote?code=" + code);
await check("the phone remote lists pads, sections and songs", async () => { await until(() => remote.evaluate(() => document.querySelectorAll("#pads .pad").length === 9 && document.querySelectorAll("#songs button").length >= 1 && document.querySelectorAll("#sections button").length >= 2), 8000); });

console.log("\nSystem:");
await check("the System menu shows the Wi-Fi / screens / companion sections with the pairing code and QR", async () => { await T(() => document.querySelector("#systemButton").click()); await until(() => T((c) => document.querySelector("#sysExtra").textContent.indexOf(c) > -1, code), 6000); assert.ok(await T(() => !!document.querySelector("#sysQr svg"))); assert.ok(await T(() => !!document.querySelector('[data-sys="hdmi2"]'))); await T(() => PPShell.showTab("tracks")); });
await check("Settings → Screens: per-screen resolution (with the modes the screen offers), zoom and edge margin; a change goes to the driver merged", async () => {
  await T(() => document.querySelectorAll("dialog[open]").forEach((d) => d.close()));
  await T(() => PPShell.showTab("settings")); await until(() => T(() => !!document.querySelector('[data-sys="mode1"]')), 6000);
  const opts = await T(() => [...document.querySelector('[data-sys="mode1"]').options].map((o) => o.value));
  assert.equal(opts[0], "auto");
  await T(() => { const r = document.querySelector('[data-sys="inset1"]'); r.value = "32"; r.dispatchEvent(new Event("input", { bubbles: true })); r.dispatchEvent(new Event("change", { bubbles: true })); });
  await until(async () => { const st = JSON.parse(fs.readFileSync(path.join(tmp, "displays.json"), "utf8")); return st.inset1 === 32 && st.hdmi2 === "lyrics"; }, 4000);
  await T(() => PPShell.showTab("tracks"));
});
await check("the app's own text box (the PC app has no prompt()): a pasted chord chart keeps its lines, Esc cancels", async () => {
  const text = "[Verse 1]\nA        E\nI love You Lord\n\n[Chorus]\nD         A\nAll my life You have been faithful";
  const p = T((t) => PP.ask("chart", { multiline: true }), null);
  await page.waitForSelector("dialog.pp-ask[open] textarea"); await page.fill("dialog.pp-ask textarea", text); await page.click("dialog.pp-ask button.primary");
  assert.equal(await p, text);
  const c = T(() => PP.ask("name")); await page.waitForSelector("dialog.pp-ask[open] input"); await page.keyboard.press("Escape"); assert.equal(await c, null);
});
await check("...and Learn → + Add MIDI button asks for the name and adds it", async () => {
  await T(() => PPShell.showTab("learn")); await page.waitForSelector("#lnAddMidiButton");
  await T(() => document.querySelector("#lnAddMidiButton").click());
  await page.waitForSelector("dialog.pp-ask[open] input"); await page.fill("dialog.pp-ask input", "Next song footswitch"); await page.click("dialog.pp-ask button.primary");
  await until(() => T(() => (PP.project().inputs || []).some((i) => i.name === "Next song footswitch" && i.midi)));
  await page.keyboard.press("Escape"); await T(() => { document.querySelectorAll("dialog[open]").forEach((d) => d.close()); PPShell.showTab("tracks"); });
});
console.log("\nCentral Usage link:");
await check("I/O tab: every input and output - network audio, outputs, inputs, MIDI, screens, control surface, devices", async () => {
  await T(() => PPShell.showTab("io")); await until(() => T(() => document.querySelectorAll("#ioRoot .io-card").length >= 6), 5000);
  const t = await T(() => document.querySelector("#ioRoot").textContent);
  assert.ok(/Audio to Central Usage/.test(t) && /Audio outputs/.test(t) && /Audio inputs/.test(t) && /MIDI/.test(t) && /HDMI 2 shows/.test(t) && /Control surface/.test(t), t.slice(0, 300));
});
await check("network audio: set to Wi-Fi on the I/O tab, a Central Usage subscribes and gets every track on its own channel + click, pads, tracks mix", async () => {
  await T(() => { const r = document.querySelector('#ioRoot input[name="ioNet"][value="wifi"]'); r.checked = true; r.dispatchEvent(new Event("change", { bubbles: true })); });
  await until(() => T(() => PPNetSend.status() && PPNetSend.status().config.mode === "wifi"), 5000);
  const ws = new WebSocket("ws://127.0.0.1:8081"); ws.binaryType = "arraybuffer"; const packets = [], msgs = [];
  ws.onmessage = (e) => { if (typeof e.data === "string") msgs.push(JSON.parse(e.data)); else packets.push(e.data); };
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.send(JSON.stringify({ type: "client", app: "central-usage", mode: "admin", name: "Test desk" }));
  ws.send(JSON.stringify({ type: "audioSubscribe", code, sources: [0], name: "Test desk" }));
  await T(() => { PPTracks.goSection(0, { immediate: true }); PPTracks.play({ countIn: false }); });
  await until(() => packets.length > 10, 8000);
  const info = msgs.filter((m) => m.type === "audioStream").pop(), names = info.sources["0"].channels;
  assert.ok(names.includes("Click + cues") && names.includes("Tracks mix L") && names.length >= 6, names.join(","));
  const v = new DataView(packets[packets.length - 1]); assert.equal(String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3)), "CCA1"); assert.equal(v.getUint8(5), names.length);
  const listening = await until(() => T(() => /Test desk/.test(document.querySelector("#ioRoot").textContent)), 5000); assert.ok(listening);
  ws.close(); await T(() => { PPTracks.stop(true); PPNetSend.configure({ mode: "off" }); });
});
await check("the hub: the app's songs (tempo, sections, waveform) are on the driver for Central Usage", async () => {
  await T(() => PPHub.push(true));
  const hub = await until(async () => { const j = await (await fetch("http://127.0.0.1:8080/api/hub")).json(); return j.songs.some((s) => s.name === "Test Song") ? j : null; }, 8000);
  const id = hub.songs.find((s) => s.name === "Test Song").id, d = await (await fetch("http://127.0.0.1:8080/api/hub/" + id)).json();
  assert.ok(d.sections.length >= 2 && d.overview.length > 100 && d.bpm > 0 && d.stems.length >= 1, JSON.stringify(d).slice(0, 200));
});
await check("parts: every instrument gets a part (bass, keys both hands, trumpet in its key, drums); listening to the tracks writes them down", async () => {
  await page.evaluate(() => { const p = PP.project(); const i = p.songs.findIndex((s) => s.tracks && s.tracks.stems && s.tracks.stems.length); if (i >= 0 && i !== p.songIndex) PPFeatures.loadSong(i); });
  await page.waitForTimeout(400);
  await page.evaluate(() => PPPartsUI.open("bass")); await page.waitForSelector("#partsDialog[open] #ptBody .pt-paper", { timeout: 5000 });
  for (const inst of ["bass", "keys", "trumpet", "drums", "guitar"]) {
    await page.selectOption("#ptInst", inst); await page.waitForTimeout(150);
    const html = await page.innerHTML("#ptBody"); assert.ok(/<svg/.test(html) || /chart-view/.test(html), inst + ": " + html.slice(0, 200));
  }
  await page.click("#ptListen");
  await page.waitForFunction(() => /written down|No tracks here|Stopped/.test(document.querySelector("#ptStatus").textContent), null, { timeout: 120000 });
  const st = await page.textContent("#ptStatus"); assert.ok(!/Stopped/.test(st), st);
  const heard = await page.evaluate(() => { const t = PPTracks.data(PPTracks.song()); return Object.keys(t.transcriptions || {}).length + (t.drums ? 1 : 0); });
  const jobs = await page.evaluate(() => PPTracks.data(PPTracks.song()).stems.filter(PPPartsUI.jobFor).length);
  assert.equal(heard >= jobs, true, heard + " of " + jobs);
  const music = await page.evaluate(() => PPTracks.hubSong(PPTracks.song()).music); assert.ok(music && music.bpb && Array.isArray(music.stems), JSON.stringify(music).slice(0, 200));
  await page.evaluate(() => document.querySelector("#partsDialog").close());
});
await check("setlists: the open setlist is kept by the driver; a new one starts empty and the old one opens again with its songs", async () => {
  const before = await page.evaluate(() => ({ id: PP.project().setlistId, name: PP.project().name, n: PP.project().songs.length }));
  assert.ok(before.id && before.n >= 1, JSON.stringify(before));
  await page.evaluate(() => PP.persistNow());
  const lists = await until(async () => { const j = await (await fetch("http://127.0.0.1:8766/sync/setlists")).json(); return j.setlists.some((x) => x.id === before.id && x.count === before.n) ? j.setlists : null; }, 8000);
  await page.evaluate(() => document.querySelector("#syncOpen").click());
  await page.waitForSelector("#syncDialog .sync-row.current", { timeout: 5000 });
  assert.match(await page.textContent("#syncDialog .sync-row.current"), new RegExp(before.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  await page.click("#syncDialog [data-sync='new']"); await page.fill(".sync-ask [data-q]", "Wednesday Night"); await page.click(".sync-ask button[value='ok']");
  await page.waitForFunction(() => PP.project().name === "Wednesday Night" && PP.project().songs.length === 0);
  await page.evaluate(() => PP.persistNow());
  await until(async () => { const j = await (await fetch("http://127.0.0.1:8766/sync/setlists")).json(); return j.setlists.some((x) => x.name === "Wednesday Night") ? 1 : null; }, 8000);
  await page.evaluate(() => PPSync.open("songs")); await page.waitForSelector("#syncDialog [data-add]", { timeout: 5000 });
  await page.click("#syncDialog [data-add]"); await page.waitForFunction(() => PP.project().songs.length === 1);
  await page.evaluate(() => PPSync.open("setlists")); await page.waitForSelector("#syncDialog [data-open]");
  await page.click(`#syncDialog [data-open="${before.id}"]`);
  await page.waitForFunction((b) => PP.project().setlistId === b.id && PP.project().songs.length === b.n, before, { timeout: 5000 });
  assert.equal(await page.evaluate(() => document.querySelector("#projectName").value), before.name);
});
await check("setlists: a song changed on another Central Control updates the open setlist in place", async () => {
  const s = await page.evaluate(() => JSON.parse(JSON.stringify(PP.project().songs[0])));
  await page.evaluate((song) => PPFeatures.emit({ type: "sync", event: "song", song: Object.assign(song, { bpm: 77, notes: "changed on the PC" }) }), s);
  assert.deepEqual(await page.evaluate(() => [PP.project().songs[0].bpm, PP.project().songs[0].notes]), [77, "changed on the PC"]);
  await page.evaluate((id) => PPFeatures.emit({ type: "sync", event: "removed", id }), s.id);
  assert.ok(await page.evaluate((id) => !PP.project().songs.some((x) => x.id === id), s.id));
});
console.log("\nTouch select, saved setups, tuner:");
await check("touch select: knob 3 given the job, a tap on a slider hands it to knob 3 (the tap does not move the slider)", async () => {
  await T(() => { PPShell.showTab("pads"); PP.setPerformMode(false); PP.setSelectedPad(0, false); PPActions.mapping().k3 = { action: "touchSelect" }; PPActions.modeChanged(); const el = document.querySelector("#level"); el.value = "70"; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); });
  await page.waitForFunction(() => PP.currentPad().level === 70);
  await page.click("#level", { position: { x: 8, y: 8 } });
  await page.waitForFunction(() => PPTouchSelect.held().k3, null, { timeout: 3000 });
  const h = await T(() => PPTouchSelect.held().k3); assert.match(h.label, /Output volume/i);
  assert.equal(await T(() => document.querySelector("#level").value), "70");
  assert.ok(await T(() => document.querySelector("#level").classList.contains("ts-target")));
  assert.match(await page.textContent("#tsChip"), /Knob 3[\s\S]*Output volume/);
});
await check("touch select: pick-up - the knob far below the setting only shows an arrow; once it reaches the setting it takes over", async () => {
  await sim({ sim: "knob", id: "k3", value: 0.1 });
  await until(() => T(() => PPTouchSelect.held().k3.dir === "up"));
  assert.equal(await T(() => PP.currentPad().level), 70);
  assert.match(await page.textContent("#tsChip"), /turn up/);
  await sim({ sim: "knob", id: "k3", value: 0.7 });
  await until(() => T(() => PPTouchSelect.held().k3.caught));
  await sim({ sim: "knob", id: "k3", value: 0.3 });
  await until(() => T(() => Math.abs(PP.currentPad().level - 30) <= 1));   // the knob reading is smoothed: within a step
  assert.equal(await T(() => Number(document.querySelector("#level").value)), await T(() => PP.currentPad().level));
});
await check("touch select: it stays until another setting is tapped; tapping that one again lets it go", async () => {
  await sim({ sim: "knob", id: "k3", value: 0.45 }); await until(() => T(() => Math.abs(PP.currentPad().level - 45) <= 1));
  const lv = await T(() => PP.currentPad().level);
  await page.click("#crossfade", { position: { x: 8, y: 8 } });
  await until(() => T(() => /Crossfade/i.test((PPTouchSelect.held().k3 || {}).label || "")));
  assert.equal(await T(() => PPTouchSelect.held().k3.caught), false);
  assert.equal(await T(() => PP.currentPad().level), lv);
  await page.click("#crossfade", { position: { x: 8, y: 8 } });
  await until(() => T(() => !PPTouchSelect.held().k3));
  assert.ok(await T(() => document.querySelector("#tsChip").hidden));
});
await check("touch select on the encoder: with two touch controls, the one turned next takes the tapped setting; the encoder steps it", async () => {
  await T(() => { PPActions.mapping().enc = { action: "touchSelectStep", press: { action: "playPauseAll" } }; PPActions.modeChanged(); });
  const before = await T(() => PP.currentPad().level);
  await page.click("#level", { position: { x: 8, y: 8 } });
  await until(() => T(() => PPTouchSelect.pending()));
  await T(() => PPActions.onControl({ id: "enc", delta: 1 }));
  await until(() => T((b) => PP.currentPad().level === b + 1, before));
  assert.ok(await T(() => !!PPTouchSelect.held().enc && !PPTouchSelect.held().k3));
  await T(() => { PPTouchSelect.release(); const m = PPActions.mapping(), d = PPActions.defaults(); m.k3 = d.k3; m.enc = d.enc; PPActions.modeChanged(); });
});
await check("touch select is a choice for knobs, sliders and the encoder on the Configure tab", async () => {
  await T(() => PPShell.showTab("configure")); await page.waitForSelector('#cfRows [data-input="k1"]');
  assert.ok(await T(() => !!document.querySelector('#cfRows [data-input="k1"] select[data-cf="action"] option[value="touchSelect"]')));
  assert.ok(await T(() => !!document.querySelector('#cfRows [data-input="enc"] select[data-cf="action"] option[value="touchSelectStep"]')));
  assert.ok(await T(() => !document.querySelector('#cfRows [data-input="b1"] select[data-cf="action"] option[value="touchSelect"]')));
});
await check("saved setups: save one, change things, bring it back with one tap", async () => {
  await T(() => { PP.setPerformance("volume", 0.8); PPSetups.save("Sunday"); PP.setPerformance("volume", 0.2); PPActions.mapping().k1 = { action: "tone" }; PPActions.modeChanged(); PPShell.showTab("settings"); });
  await page.waitForSelector("#setupsSection [data-su-row] [data-su='apply']");
  await page.click("#setupsSection [data-su-row] [data-su='apply']");
  await until(() => T(() => Math.abs(PP.project().performance.volume - 0.8) < 0.01 && PPActions.mapping().k1.action === "volume"));
});
await check("saved setups: a song can have its own setup - picking the song brings it back; others fall back to a chosen one", async () => {
  await T(() => { const p = PP.project(); if (p.songs.length < 2) { p.songs.push({ id: "su_a", name: "Setup song A", key: "G", bpm: 80, pad: -1, notes: "" }, { id: "su_b", name: "Setup song B", key: "D", bpm: 90, pad: -1, notes: "" }); } PPFeatures.loadSong(0); PP.setPerformance("volume", 0.3); PPSetups.save("Acoustic"); PPSetups.render(); });
  const ids = await T(() => PP.project().songs.slice(0, 2).map((s) => s.id));
  await page.selectOption(`#setupsSection select[data-su="song"][data-song="${ids[0]}"]`, { label: "Sunday" });
  await page.selectOption('#setupsSection select[data-su="default"]', { label: "Acoustic" });
  await T(() => PPFeatures.loadSong(1)); await until(() => T(() => Math.abs(PP.project().performance.volume - 0.3) < 0.01));
  await T(() => PPFeatures.loadSong(0)); await until(() => T(() => Math.abs(PP.project().performance.volume - 0.8) < 0.01));
  assert.match(await page.textContent("#setupsSection"), /Sunday[\s\S]*Setup song A|Sunday/);
});
await check("saved setups stay on this device: they are not part of the songs or setlists that sync", async () => {
  await T(() => PP.persistNow());
  const songs = await T(() => PP.project().songs.map((s) => Object.keys(s).join(",")).join("|")); assert.ok(!/setup/i.test(songs), songs);
  const j = await (await fetch("http://127.0.0.1:8766/sync/setlists")).json(); assert.ok(!/Sunday|Acoustic/.test(JSON.stringify(j)));
  await T(() => { PP.project().setupDefault = ""; });
});
await check("tuner: only on the Instrument tab - a footswitch brings that tab up; leaving the tab turns it off", async () => {
  await T(() => { if (PPInstrument.kind() === "off" || PPInstrument.kind() === "keys") PPInstrument.setKind("electric"); PPShell.showTab("pads"); }); await T(() => PPActions.run("tuner"));
  await until(() => T(() => PPShell.currentTab() === "instrument" && PPInstrument.tunerOn() && document.querySelector("#tunerOverlay").classList.contains("on")));
  assert.ok(await T(() => !!document.querySelector("#tnMute")));
  await T(() => PPShell.showTab("pads")); await until(() => T(() => !PPInstrument.tunerOn() && !document.querySelector("#tunerOverlay").classList.contains("on")));
  await T(() => PPShell.showTab("instrument")); await wait(300);
  assert.equal(await T(() => document.querySelectorAll("#inTunerBtn").length), 1);
});
await check("no page errors during the whole run", () => assert.deepEqual(errors.filter((e) => !/favicon/.test(e)), []));

await browser.close();
driver.kill("SIGTERM"); pco.close();
console.log(failures ? "\n" + failures + " CHECK(S) FAILED" : "\nALL END-TO-END CHECKS PASSED");
if (failures) { console.log("\n--- driver log tail ---\n" + driverLog.split("\n").slice(-30).join("\n")); }
process.exit(failures ? 1 : 0);
