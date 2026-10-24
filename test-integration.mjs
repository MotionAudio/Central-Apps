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
import fs from "node:fs"; import zlib from "node:zlib";
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
// a stand-in for Demucs (the stem splitter): four tones as stems, with tqdm-style progress
const fakeDemucs = path.join(tmp, "fake-demucs.py");
fs.writeFileSync(fakeDemucs, [
  "import math, os, struct, sys, time, wave",
  "a = sys.argv[1:]; out = a[a.index('-o') + 1]; model = a[a.index('-n') + 1]",
  "stems = ['drums', 'bass', 'other', 'vocals']",
  "for p in (0, 40, 80, 100):",
  "    sys.stdout.write('%3d%%|####| %d/100\\r' % (p, p)); sys.stdout.flush(); time.sleep(0.15)",
  "d = os.path.join(out, model); os.makedirs(d, exist_ok=True)",
  "for k, s in enumerate(stems):",
  "    w = wave.open(os.path.join(d, s + '.wav'), 'wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(22050)",
  "    w.writeframes(b''.join(struct.pack('<hh', int(6000 * math.sin(2 * math.pi * (110 * (k + 1)) * i / 22050)), int(6000 * math.sin(2 * math.pi * (110 * (k + 1)) * i / 22050))) for i in range(22050 * 2))); w.close()",
  ""].join("\n"));
// ...and for audio-separator (the best-quality models): vocals / instrumental, or the drum parts
const fakeSep = path.join(tmp, "fake-separator.py");
fs.writeFileSync(fakeSep, [
  "import math, os, struct, sys, time, wave",
  "a = sys.argv[1:]; src = a[0]; model = a[a.index('-m') + 1]; out = a[a.index('--output_dir') + 1]",
  "stems = ['kick', 'snare', 'toms', 'hh', 'ride', 'crash'] if 'DrumSep' in model else ['No Reverb', 'Reverb'] if 'DeReverb' in model else ['Vocals', 'Instrumental']",
  "for p in (0, 50, 100):",
  "    sys.stdout.write('%3d%%|####| %d/100\\r' % (p, p)); sys.stdout.flush(); time.sleep(0.1)",
  "os.makedirs(out, exist_ok=True); base = os.path.basename(src).rsplit('.', 1)[0]",
  "for k, s in enumerate(stems):",
  "    w = wave.open(os.path.join(out, '%s_(%s)_%s.wav' % (base, s, model.rsplit('.', 1)[0])), 'wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(22050)",
  "    hit = {'kick': (0.25, 60, 0.03), 'snare': (0.5, 190, 0.05)}.get(s)   # (the kick and the snare are hits at known times, for the lights)",
  "    v = (lambda i: 9000 * math.exp(-((i / 22050.0 - hit[0]) % 0.5) / hit[2]) * math.sin(2 * math.pi * hit[1] * i / 22050)) if hit else (lambda i: 5000 * math.sin(2 * math.pi * (150 * (k + 2)) * i / 22050))",
  "    w.writeframes(b''.join(struct.pack('<hh', int(v(i)), int(v(i))) for i in range(22050 * 2))); w.close()",
  ""].join("\n"));
const driver = spawn("python3", [path.join(here, "pedal-driver.py"), "--simulate", tmp, "--app-root", here], { stdio: ["ignore", "pipe", "pipe"], env: Object.assign({}, process.env, { CC_UPDATE_API: "http://127.0.0.1:9", CC_PCO_BASE: "http://127.0.0.1:" + pco.address().port, CC_DEMUCS_CMD: "python3 " + fakeDemucs, CC_SEPARATOR_CMD: "python3 " + fakeSep, CC_STEMTOOL_PYTHON: "python3" }) });
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
await check("the Central Pedal itself opens without a license key (no setup), even with keys required and no website", async () => {
  await wait(1500); assert.equal(await T(() => PPLicense.app()), "pedal"); assert.equal(await page.$("dialog#licWiz"), null);
});
await check("the app is served by the driver and connects to it", async () => { await until(() => T(() => window.__pedalBridge.connected)); assert.match(await T(() => document.querySelector("#pfHw").textContent), /^Central Pedal \d+\./); });
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
await check("the PIN picked on the screen is saved on the Central Pedal; devices pair with it", async () => {
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
  await until(() => T(() => PPTracks.state.pos > 0.5 && PPTracks.state.flowIndex === 1), 8000, 50);
  await until(() => T((e) => PPTracks.state.flowIndex === 2 && PPTracks.state.pos < e - 0.5, verseEnd), 16000, 30);
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
await check("track pack with an Ableton set: the sections come from its locators; 'combine' sums the drum stems into one track (click on its own)", async () => {
  const dir = path.join(tmp, "media", "usb-stick", "Firm Foundation (C) 70 BPM");
  fs.mkdirSync(dir, { recursive: true });
  for (const n of ["Click.wav", "Drums.wav", "Perc.wav", "Bass.wav"]) fs.writeFileSync(path.join(dir, n), wav(70, 0, 34, 22050));
  const als = '<?xml version="1.0"?><Ableton><LiveSet><MasterTrack><DeviceChain><Mixer><Tempo><Manual Value="70" /></Tempo></Mixer></DeviceChain></MasterTrack><Locators><Locators>' +
    '<Locator Id="0"><Time Value="0" /><Name Value="Intro" /></Locator><Locator Id="1"><Time Value="16" /><Name Value="Verse 1" /></Locator><Locator Id="2"><Time Value="32" /><Name Value="Chorus" /></Locator></Locators></Locators></LiveSet></Ableton>';
  fs.writeFileSync(path.join(dir, "Firm Foundation.als"), zlib.gzipSync(als));
  const scan = await T(async (d) => { const r = await fetch("http://127.0.0.1:8766/pack/scan", { method: "POST", body: JSON.stringify({ path: d }) }); const j = await r.json(); j.stems.forEach((e) => { e.keep = e.use; }); j.combine = true; PPSources.state.pack = j; PPSources.state.many = null; PPSources.open("pack"); return j; }, dir);
  assert.deepEqual(scan.markers.map((m) => m.name), ["Intro", "Verse 1", "Chorus"]); assert.equal(scan.bpm, 70);
  await until(() => T(() => /3 sections from Firm Foundation\.als/.test(document.querySelector("#addBody").textContent)), 3000);
  await page.click('[data-a="pack-import"]');
  await until(() => T(() => /✓ Firm Foundation/.test(document.querySelector("#addBody .add-progress").textContent)), 60000, 200);
  const r = await T(() => { const s = PPTracks.findSongByName("Firm Foundation"), t = PPTracks.data(s); return { stems: t.stems.map((q) => q.name + ":" + q.role + ":" + q.bus).sort(), parts: (t.stems.find((q) => q.parts) || {}).parts, secs: t.sections.map((x) => x.name + "@" + x.bar), bpm: Math.round(t.grid.bpm), files: (t.stems.find((q) => q.parts) || {}).files }; });
  assert.deepEqual(r.stems, ["Bass:bass:music", "Click:click:click", "Drums (combined):drums:music"], JSON.stringify(r));
  assert.deepEqual(r.parts.sort(), ["Drums", "Perc"]); assert.equal(r.files.length, 2, "the combined track remembers its files (decoded again from them if needed)");
  assert.equal(r.bpm, 70);
  assert.deepEqual(r.secs.map((x) => x.split("@")[0]), ["Intro", "Verse 1", "Chorus"]);
  const bars = r.secs.map((x) => Number(x.split("@")[1])); assert.ok(bars[0] === 1 && Math.abs(bars[1] - 5) <= 1 && Math.abs(bars[2] - 9) <= 1, r.secs.join(", "));
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
await check("PAN on every track: labelled, says L 30 / C / R 30, follows on both strips, double-click centres; the stemPan action and the small screens' state", async () => {
  const id = await T(() => PPTracks.data(PPTracks.song()).stems[0].id);
  const lab = await T((id) => { const b = document.querySelector('#trStems .stem[data-stem="' + id + '"] .stem-panbox'); return b ? b.querySelector("span").textContent + "|" + b.querySelector(".stem-panv").textContent : null; }, id);
  assert.equal(lab, "PAN|C");
  await page.$eval('#trStems .stem[data-stem="' + id + '"] .stem-pan', (el) => { el.value = -0.3; el.dispatchEvent(new Event("input", { bubbles: true })); });
  const p = await T((id) => ({ data: PPTracks.data(PPTracks.song()).stems.find((s) => s.id === id).pan, text: document.querySelector('#trStems .stem[data-stem="' + id + '"] .stem-panv').textContent, mini: PPTracks.data(PPTracks.song()).stems.length }), id);
  assert.equal(p.data, -0.3); assert.equal(p.text, "L 30");
  await page.dblclick('#trStems .stem[data-stem="' + id + '"] .stem-pan');
  assert.equal(await T((id) => PPTracks.data(PPTracks.song()).stems.find((s) => s.id === id).pan, id), 0);
  await T(() => PPActions.run("stemPan", { index: 0 }, { value: 0.9 }));
  const a = await T(() => ({ pan: PPTracks.data(PPTracks.song()).stems[0].pan, text: document.querySelector("#trStems .stem[data-stem] .stem-panv").textContent, listed: PPActions.list().some((x) => x.id === "stemPan") }));
  assert.equal(a.pan, 0.8); assert.equal(a.text, "R 80"); assert.ok(a.listed, "a knob / MIDI can learn it");
  await T(() => PPActions.run("stemPan", { index: 0, pan: 0 }, { value: 0.9 }));
  assert.equal(await T(() => PPTracks.data(PPTracks.song()).stems[0].pan), 0);
});
await check("pads: up to 4 layers at once (a 5th replaces the oldest), each with its own level", async () => {
  await T(() => { PPTracks.stop(true); PP.engine.stop(); PP.project().performance.layerMode = true; });   // (the tracks stopped: a section starting would swell the pads)
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
await check("play any sound: a guitar gets its panel; on, mode, sound and dry blend go to the driver live; the footswitch action toggles it", async () => {
  await T(() => { PPShell.showTab("instrument"); PPInstrument.setKind("electric"); });
  await page.waitForSelector("#paOn"); await T(() => { window.__sent = []; });
  const last = () => T(() => window.__sent.filter((m) => m.type === "instrument" && m.action === "playany").pop() || null);
  await page.click("#paOn"); await wait(200);
  let m = await last(); assert.ok(m && m.playAny.on === true && m.playAny.mode === "auto", JSON.stringify(m));
  await page.waitForSelector('[data-pamode="synth"]'); await page.click('[data-pamode="synth"]'); await wait(200);
  m = await last(); assert.equal(m.playAny.mode, "synth");
  await page.$eval("#paDry", (el) => { el.value = 30; el.dispatchEvent(new Event("input", { bubbles: true })); }); await wait(250);
  m = await last(); assert.equal(m.playAny.dry, 0.3);
  assert.equal(await T(() => PPInstrument.hostConfig().playAny.dry), 0.3, "the apply config carries it too");
  assert.ok(await T(() => PPActions.list().some((a) => a.id === "playAnyToggle")), "a footswitch action");
  await T(() => PPActions.run("playAnyToggle")); await wait(200);
  m = await last(); assert.equal(m.playAny.on, false, "the footswitch turned it off");
  assert.equal(await T(() => PPInstrument.playAnyOn()), false);
  // it's part of Central Instrument: without that plan the footswitch and the button don't turn it on, and the panel says why
  const locked = await T(() => { const h = PPLicense.hasPlan; PPLicense.hasPlan = (id) => id !== "instrument"; window.dispatchEvent(new CustomEvent("pp-plans")); const on = PPInstrument.togglePlayAny(); PPInstrument.render(); const r = { on: on, cfgOn: PPInstrument.hostConfig().playAny.on, note: (document.querySelector(".pa-lock") || {}).textContent || "", btn: document.getElementById("paOn").disabled }; PPLicense.hasPlan = h; window.dispatchEvent(new CustomEvent("pp-plans")); PPInstrument.render(); return r; });
  assert.ok(locked.on === false && locked.cfgOn === false && /Central Instrument/.test(locked.note) && locked.btn, JSON.stringify(locked));
  await T(() => PPInstrument.setKind("keys")); await wait(200);
  assert.equal(await T(() => PPInstrument.hostConfig().playAny), undefined, "keys: no play any sound");
  assert.equal(await page.$("#paOn"), null);
  await T(() => PPInstrument.setKind("off"));
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
console.log("\nSound plans (9.5): tiers, locks, packages, Central Tracks sounds / boards / clicks:");
await check("plans: with licensing off everything is open; every pedal and board has a tier; the free set is a dozen-odd pedals and four boards", async () => {
  const r = await T(() => ({ off: ["keys", "plugins", "instrument", "pedals"].every((id) => PPLicense.hasPlan(id)), noTier: PPPedals.pedals.filter((p) => !p.tier).length,
    free: PPPedals.pedals.filter((p) => p.tier === "free").length, freeBoards: PPPedals.boards.filter((b) => !b.plans.length).map((b) => b.id),
    muff: PPPedals.byId("muff").tier, reverb: PPPedals.byId("zitarev").tier, lock: PPPedals.lockText("instrument"), pkgs: !!document.querySelector("#pkgSettings") || PPLicense.packagesHtml().includes("no packages needed") }));
  assert.ok(r.off, "licensing off: all plans open"); assert.equal(r.noTier, 0); assert.ok(r.free >= 12 && r.free <= 16, "free pedals " + r.free);
  // (four free boards; the 9.6 orchestra boards are Central Instrument's)
  assert.deepEqual(r.freeBoards, ["clean-worship", "acoustic-dry", "bass-di", "keys-stage"]); assert.equal(r.muff, "pedals"); assert.equal(r.reverb, "plugins");
  assert.equal(r.lock, "Part of Central Instrument · $80 a year"); assert.ok(r.pkgs, "Settings → Packages says no packages are needed");
});
await check("plans: a saved board keeps a locked pedal, bypassed with a lock and its plan; the footswitch, Add pedal and board stepping skip what's locked", async () => {
  const r = await T(async () => {
    const L = PPLicense; window.__hasPlan = L.hasPlan; L.hasPlan = (id) => id === "plugins" || id === "instrument";   // (Central Pedals and Central Keys ended)
    window.dispatchEvent(new CustomEvent("pp-plans"));
    PPShell.showTab("instrument"); PPInstrument.setKind("electric");
    const c = PPInstrument.config(); c.boards.electric = "fuzz-wall";
    c.chains.electric = [{ uid: "lk1", pedal: "muff", on: true, values: {} }, { uid: "lk2", pedal: "booster", on: true, values: {} }, { uid: "lk3", pedal: "zitarev", on: true, values: {} }];
    window.__sent = []; window.dispatchEvent(new CustomEvent("pp-plans")); PPInstrument.render(); await new Promise((ok) => setTimeout(ok, 100));
    const host = PPInstrument.hostConfig().chain, applied = window.__sent.filter((m) => m.action === "apply").pop();
    const svgLocked = document.querySelectorAll("#pbChain svg.pedal.locked").length, svgText = (document.querySelector("#pbChain svg.pedal.locked") || {}).textContent || "";
    const toggled = PPInstrument.togglePedal(0), names = PPInstrument.pedalNames(), info = PPInstrument.lockInfo();
    const dis = { modern: (document.querySelector('#inBoard option[value="modern-gain"]') || {}).disabled, clean: (document.querySelector('#inBoard option[value="clean-worship"]') || {}).disabled, cur: (document.querySelector('#inBoard option[value="fuzz-wall"]') || {}).disabled };
    document.querySelector("#pbAdd").click(); await new Promise((ok) => setTimeout(ok, 50));
    const addItem = document.querySelector('.pb-item.locked[data-add="muff"]'), addText = addItem ? addItem.textContent : ""; if (addItem) addItem.click();
    const lenAfterAdd = PPInstrument.config().chains.electric.length; document.querySelector("#pbAddClose") && document.querySelector("#pbAddClose").click();
    const seen = new Set(); for (let i = 0; i < 12; i++) { PPInstrument.stepBoard(1); seen.add(PPInstrument.config().boards.electric); }
    return { host: host.map((p) => [p.id, p.on, !!p.locked]), sentOff: applied && applied.config.chain[0].on, svgLocked, svgText, toggled, names: names.map((n) => [n.on, n.locked || ""]), info, dis, addText, lenAfterAdd, seen: [...seen].sort() };
  });
  assert.deepEqual(r.host, [["muff", false, true], ["booster", true, false], ["zitarev", true, false]]); assert.equal(r.sentOff, false, "the engine gets it bypassed");
  assert.equal(r.svgLocked, 1); assert.ok(/Central Pedals/.test(r.svgText) && /bypassed/.test(r.svgText), r.svgText);
  assert.equal(r.toggled, false); assert.deepEqual(r.names[0], [false, "Part of Central Pedals · $50 a year"]); assert.ok(/Central Pedals/.test(r.info.board || ""), JSON.stringify(r.info));
  assert.deepEqual(r.dis, { modern: true, clean: false, cur: false }); assert.ok(/Part of Central Pedals · \$50 a year/.test(r.addText), r.addText); assert.equal(r.lenAfterAdd, 3, "a locked pedal isn't added");
  assert.deepEqual(r.seen, ["ambient-swell", "clean-worship"], "stepping lands only on open boards");
});
await check("plans: keys sounds carry their bank's tier (or by what they are); a locked sound is listed with its plan, muted in a saved layer and skipped by patch stepping", async () => {
  const r = await T(async () => {
    PPInstrument.setKind("keys");
    PPFeatures.emit({ type: "instrumentStatus", available: true, running: true, kind: "keys", inputs: [], midiInputs: [], keysCatalog: [
      { file: "/s/Upright-Piano-KW - u.sf2", name: "Upright Piano KW", tier: "free", presets: [{ name: "Upright Piano KW", bank: 0, prog: 0 }] },
      { file: "/s/Salamander-Grand-Piano - s.sf2", name: "Salamander Grand Piano", tier: "keys", presets: [{ name: "Salamander Grand", bank: 0, prog: 0 }] },
      { file: "/usr/share/sounds/sf2/FluidR3_GM.sf2", name: "General MIDI (FluidR3)", presets: [{ name: "Cello", bank: 0, prog: 42 }, { name: "Rhodes EP", bank: 0, prog: 4 }, { name: "Synth Bass 1", bank: 0, prog: 38 }, { name: "Fingered Bass", bank: 0, prog: 33 }] },
      { file: "/data/sf2/Mine.sf2", name: "Mine", user: true, presets: [{ name: "My Pad", bank: 0, prog: 0 }] }] });
    await new Promise((ok) => setTimeout(ok, 50));
    const cat = PPInstrument.catalog().keys, tiers = {}; cat.forEach((s) => { tiers[s.name] = s.tier; });
    const c = PPInstrument.config(), ls = PPInstrument.layers(); const sal = cat.find((s) => s.name === "Salamander Grand");
    ls[0].patch = { id: sal.id, file: sal.file, bank: 0, prog: 0, name: sal.name }; c.keys.patch = ls[0].patch; PPInstrument.render();
    const layerOn = PPInstrument.hostConfig().keys.layers[0].on, lockedItems = [...document.querySelectorAll(".keys-item.locked")].map((b) => b.textContent);
    const muted = (document.querySelector(".kl-lock") || {}).textContent || "", info = PPInstrument.lockInfo();
    const visited = new Set(); for (let i = 0; i < 8; i++) { PPInstrument.stepPatch(1); visited.add(PPInstrument.layers()[0].patch.name); }
    return { tiers, layerOn, lockedItems, muted, info, visited: [...visited].sort() };
  });
  assert.deepEqual(r.tiers, { "Upright Piano KW": "free", "Salamander Grand": "keys", Cello: "instrument", "Rhodes EP": "keys", "Synth Bass 1": "keys", "Fingered Bass": "instrument", "My Pad": "free" });
  assert.equal(r.layerOn, false, "a saved layer with a locked sound is muted"); assert.ok(/muted · Part of Central Keys · \$50 a year/.test(r.muted), r.muted); assert.ok(/Central Keys/.test(r.info.patch || ""));
  assert.equal(r.lockedItems.length, 3); assert.ok(r.lockedItems.every((t) => /Part of Central Keys/.test(t)), r.lockedItems.join(" | "));
  assert.deepEqual(r.visited, ["Cello", "Fingered Bass", "My Pad", "Upright Piano KW"]);
});
await check("plans: with Central Keys back, \"Worship Grand\" brings its grand piano; the small screens hear what's locked", async () => {
  const r = await T(async () => {
    PPLicense.hasPlan = () => true; window.dispatchEvent(new CustomEvent("pp-plans")); await new Promise((ok) => setTimeout(ok, 50));
    const sel = document.querySelector("#inBoard"); sel.value = "worship-grand"; sel.dispatchEvent(new Event("change", { bubbles: true }));
    const out = { patch: PPInstrument.layers()[0].patch.name, on: PPInstrument.hostConfig().keys.layers[0].on, board: PPInstrument.config().boards.keys };
    PPLicense.hasPlan = (id) => id !== "pedals"; PPInstrument.setKind("electric"); const c = PPInstrument.config(); c.chains.electric = [{ uid: "lk1", pedal: "muff", on: true, values: {} }]; c.boards.electric = "fuzz-wall";
    let disp = null; const b = window.__pedalBridge, orig = b.send; b.send = function (m) { if (m.type === "display") disp = m; return orig.call(b, m); };
    PPTracks.sendDisplay && PPTracks.sendDisplay(); await new Promise((ok) => setTimeout(ok, 400)); b.send = orig;
    const ins = disp && disp.mini && disp.mini.instrument;
    out.mini = ins ? { locked: ins.pedals[0].locked, board: ins.boardLocked } : null;
    PPLicense.hasPlan = window.__hasPlan; window.dispatchEvent(new CustomEvent("pp-plans")); PPInstrument.setKind("off");
    return out;
  });
  assert.equal(r.board, "worship-grand"); assert.equal(r.patch, "Salamander Grand"); assert.equal(r.on, true);
  assert.deepEqual(r.mini, { locked: "Part of Central Pedals · $50 a year", board: "Part of Central Pedals · $50 a year" });
});
await check("Central Tracks: a Board installs as one of your boards, a Click (zip of two WAVs) as a click sound - both straight from the download", async () => {
  const r = await T(async () => {
    // a zip made here: the board stored, the WAVs deflated (CompressionStream), as the site would send them
    function wav(freq) { const n = 2400, b = new ArrayBuffer(44 + n * 2), v = new DataView(b), w = (o, s) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
      w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 48000, true); v.setUint32(28, 96000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 2, true);
      for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round(12000 * Math.sin(2 * Math.PI * freq * i / 48000) * Math.exp(-i / 600)), true); return new Uint8Array(b); }
    async function zip(entries) {
      const parts = [], central = []; let off = 0;
      for (const e of entries) {
        const name = new TextEncoder().encode(e.name), data = e.deflate ? new Uint8Array(await new Response(new Blob([e.data]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer()) : e.data;
        const h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(8, e.deflate ? 8 : 0, true); h.setUint32(18, data.length, true); h.setUint32(22, e.data.length, true); h.setUint16(26, name.length, true);
        const c = new DataView(new ArrayBuffer(46)); c.setUint32(0, 0x02014b50, true); c.setUint16(10, e.deflate ? 8 : 0, true); c.setUint32(20, data.length, true); c.setUint32(24, e.data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
        parts.push(new Uint8Array(h.buffer), name, data); central.push(new Uint8Array(c.buffer), name); off += 30 + name.length + data.length;
      }
      const size = central.reduce((a, x) => a + x.length, 0), end = new DataView(new ArrayBuffer(22)); end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true); end.setUint32(12, size, true); end.setUint32(16, off, true);
      return new Blob([...parts, ...central, new Uint8Array(end.buffer)]);
    }
    const boardZip = await zip([{ name: "board/Shimmer Lead.json", data: new TextEncoder().encode(JSON.stringify({ name: "Shimmer Lead", kind: "electric", chain: [["ts9", { Drive: 0.4 }], ["not-a-pedal", {}], ["dfly-hall", { Decay: 5 }]] })) }]);
    const clickZip = await zip([{ name: "Rimshot/accent.wav", data: wav(1800), deflate: true }, { name: "Rimshot/beat.wav", data: wav(1200), deflate: true }, { name: "__MACOSX/._beat.wav", data: new Uint8Array(4) }]);
    const before = PPInstrument.config().custom.length;
    await PPCentralTracks.install({ id: "b1", kind: "Board", title: "Shimmer Lead" }, [{ url: URL.createObjectURL(boardZip), name: "shimmer.zip" }]);
    const board = PPInstrument.config().custom[before];
    await PPCentralTracks.install({ id: "c1", kind: "Click", title: "Rimshot Click" }, [{ url: URL.createObjectURL(clickZip), name: "rimshot.zip" }]);
    const sets = PPTracks.clickSets(), last = sets[sets.length - 1];
    return { board: board && { name: board.name, kind: board.kind, chain: board.chain.map((x) => x[0]) }, inList: PPInstrument.config().custom.length - before, click: last && { name: last.name, id: last.id, hi: last.hi.length > 1000, lo: last.lo.length > 1000 }, log: PPCentralTracks.state.log };
  });
  assert.deepEqual(r.board, { name: "Shimmer Lead", kind: "electric", chain: ["ts9", "dfly-hall"] }); assert.equal(r.inList, 1);
  assert.ok(r.click && r.click.name === "Rimshot Click" && /^set:/.test(r.click.id) && r.click.hi && r.click.lo, JSON.stringify(r));
  assert.ok(/click sound/.test(r.log), r.log);
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
await check("updates: when the app opens and nothing plays, a new version installs by itself after a 10-second notice (Not now skips it; the setting turns it off)", async () => {
  const p2 = await ctx.newPage(); p2.on("pageerror", (e) => errors.push("upd:" + e));
  await p2.goto("http://127.0.0.1:8766/app/#perform"); await p2.waitForFunction(() => window.PPFeatures && window.PPIntegrations);
  await p2.evaluate(() => { PPFeatures.handleHardware({ type: "updateStatus", current: "7.0.0", latest: "7.2.0", available: true, notes: "", repo: "church/cc", auto: true, autoInstall: true }); });
  await p2.waitForFunction(() => document.querySelector("#updAsk") && document.querySelector("#updAsk").open && /installs in \d+ s/.test(document.querySelector("#updAsk").textContent));
  assert.match(await p2.textContent("#updAsk"), /songs, setlists and settings stay/);
  const a = await p2.evaluate(() => +document.querySelector("#updAsk").textContent.match(/installs in (\d+) s/)[1]); await p2.waitForTimeout(2200);
  const b = await p2.evaluate(() => +document.querySelector("#updAsk").textContent.match(/installs in (\d+) s/)[1]);
  assert.ok(b < a, "it counts down " + a + " → " + b);
  await p2.click('#updAsk [data-ask="no"]'); await p2.waitForTimeout(1500);
  assert.ok(await p2.evaluate(() => !document.querySelector("#updAsk").open && !PPIntegrations.updates().busy), "Not now: nothing installs");
  await p2.close();
  // turned off: it asks instead
  const p3 = await ctx.newPage(); p3.on("pageerror", (e) => errors.push("upd2:" + e));
  await p3.goto("http://127.0.0.1:8766/app/#perform"); await p3.waitForFunction(() => window.PPFeatures && window.PPIntegrations);
  await p3.evaluate(() => { PPFeatures.handleHardware({ type: "updateStatus", current: "7.0.0", latest: "7.2.0", available: true, notes: "", repo: "church/cc", auto: true, autoInstall: false }); });
  await p3.waitForFunction(() => document.querySelector("#updAsk") && document.querySelector("#updAsk").open);
  assert.match(await p3.textContent("#updAsk"), /Want to update now\?/);
  assert.equal(await p3.evaluate(() => document.getElementById("updAutoInstall") && document.getElementById("updAutoInstall").checked), false, "Settings → Software updates shows it off");
  await p3.click('#updAsk [data-ask="no"]'); await p3.close();
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
await check("the copy of the small screen has its tabs: Tracks → Mixer moves a level, Instrument → Pedals switches a pedal (straight to the app)", async () => {
  const tap = (sel) => mini.evaluate((s) => { const el = document.querySelector(s); if (!el) return false; el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: el.getBoundingClientRect().left + el.getBoundingClientRect().width * 0.3 })); el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: el.getBoundingClientRect().left + el.getBoundingClientRect().width * 0.3 })); return true; }, sel);
  await tap('[data-tab="tracks"]'); await tap('[data-sub="mix"]');
  await until(() => mini.evaluate(() => !!document.querySelector('[data-fader="tracksLevel"]')), 5000);
  await tap('[data-fader="tracksLevel"]');
  await wait(1700); await T(() => PPTracks.sendDisplay());   // (after the screen's own 1.5 s: the level the app now has)
  await until(() => mini.evaluate(() => { const b = document.querySelector('[data-fader="tracksLevel"] b'); return b && Math.abs(parseFloat(b.style.width) - 30) < 6; }), 3000);
  // each track's PAN beside its level: shows where it is, a double-tap centres it (in the app)
  await T(() => { PPTracks.setStem(PPTracks.data(PPTracks.song()).stems[0].id, "pan", -0.3); PPTracks.sendDisplay(); });
  await until(() => mini.evaluate(() => { const r = document.querySelector('.row.stem .panbox'); return r && r.querySelector("small").textContent === "PAN" && r.querySelector(".pv").textContent === "L 30"; }), 4000);
  await mini.evaluate(() => { const el = document.querySelector('[data-fader="stemPan"]'), x = el.getBoundingClientRect().left + 5; for (let k = 0; k < 2; k++) { el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: x })); el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: x })); } });
  await until(() => T(() => PPTracks.data(PPTracks.song()).stems[0].pan === 0), 4000);
  await T(() => { if (window.PPInstrument) PPInstrument.setKind("electric"); }); await wait(600); await T(() => PPTracks.sendDisplay()); await wait(400);
  await tap('[data-tab="instrument"]'); await tap('[data-sub="pedals"]');
  await until(() => mini.evaluate(() => document.querySelectorAll(".pedal").length > 0), 6000);
  const before = await T(() => PPInstrument.pedalNames()[0].on);
  await tap(".pedal");
  await until(() => T((b) => PPInstrument.pedalNames()[0].on !== b, before), 5000);
  await T(() => PPInstrument.togglePedal(0)); await T(() => PPInstrument.setKind("off"));
  await tap('[data-tab="pads"]');
});
await check("Central Pedal Control in a browser (an iPad): the Central Pedal serves it at /control/ as the editor, with ● Live", async () => {
  const html = await (await fetch("http://127.0.0.1:8080/control/")).text();
  assert.match(html, /window\.CP_CONTROL = true/); assert.match(html, /apple-mobile-web-app-capable/);
  assert.equal((await fetch("http://127.0.0.1:8080/control/pedal-driver.py")).status, 404, "the driver itself is not served");
  const man = await (await fetch("http://127.0.0.1:8080/control/manifest.webmanifest")).json(); assert.equal(man.start_url, "/control/");
  const cp = await ctx.newPage(); cp.on("pageerror", (e) => errors.push("control:" + e));
  await cp.goto("http://127.0.0.1:8080/control/"); await cp.waitForFunction(() => window.PPTransfer && document.querySelector('[data-cpo="live"]'), null, { timeout: 15000 });
  // no website yet: Pedal Control asks for its P key (production, then the key); the default P key opens it and stays after a reload
  await cp.waitForSelector("dialog#licWiz[open] #lwProd", { timeout: 8000 });
  await cp.fill("#lwProd", "Grace Church"); await cp.click('#licWiz [data-lw="prod"]'); await cp.waitForSelector("#lwKey");
  await cp.fill("#lwKey", "UDEF-AULT-KEY0-2026"); await cp.click('#licWiz [data-lw="key"]');
  assert.match(await cp.textContent("#licWiz .bad"), /That's a U key .*needs a key that starts with P/);
  await cp.fill("#lwKey", "PDEF-AULT-KEY0-2026"); await cp.click('#licWiz [data-lw="key"]'); await cp.waitForSelector("dialog#licWiz", { state: "detached", timeout: 4000 });
  await cp.reload(); await cp.waitForFunction(() => window.PPTransfer && document.querySelector('[data-cpo="live"]'), null, { timeout: 15000 }); await cp.waitForTimeout(800);
  assert.equal(await cp.$("dialog#licWiz"), null, "the default key stays after a reload");
  assert.equal(await cp.evaluate(() => PPLicense.app()), "pedal-control");
  await cp.evaluate(() => document.querySelector('[data-cpo="live"]').click());
  assert.equal(await cp.evaluate(() => document.querySelector('#cpTransferDialog [data-cp="host"]').value), "127.0.0.1:8080", "opened from the pedal: that pedal");
  await cp.evaluate((c) => { document.querySelector('#cpTransferDialog [data-cp="pin"]').value = c; document.querySelector('#cpTransferDialog [data-cp="live"]').click(); }, code);
  await cp.waitForFunction(() => { const f = document.querySelector("#cpLive iframe"); return f && /\/mini\?code=/.test(f.src) && !document.querySelector("#cpLive").classList.contains("hidden"); }, null, { timeout: 8000 });
  await cp.close();
});
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
await check("Settings → Touch screen: screens by size (GPIO, HDMI, ribbon cable); picking the blue 3.5\" XPT2046 board sets it up and HDMI 1 keeps the app (a copy is one pick away)", async () => {
  await T(() => PPShell.showTab("settings")); await until(() => T(() => !!document.querySelector('[data-ts="pick"]')), 6000);
  const groups = await T(() => [...document.querySelectorAll('[data-ts="pick"] optgroup')].map((g) => g.label + ":" + g.children.length));
  assert.equal(groups.length, 3, groups.join(" | "));
  await T(() => { const s = document.querySelector('[data-ts="pick"]'); s.value = "rpi35-xpt2046"; s.dispatchEvent(new Event("change", { bubbles: true })); });
  assert.match(await T(() => document.querySelector(".ts-info").textContent), /built into/);
  await T(() => document.querySelector('[data-ts="apply"]').click());
  await until(() => T(() => /restart/i.test(document.querySelector(".ts").textContent) && !!document.querySelector('[data-ts="restart"]')), 6000);
  await until(async () => { const st = JSON.parse(fs.readFileSync(path.join(tmp, "displays.json"), "utf8")); return st.hdmi1 === "app" && st.touchKind === "spi"; }, 4000);
  await until(() => T(() => document.querySelector('[data-sys="hdmi1"]') && document.querySelector('[data-sys="hdmi1"]').value === "app" && [...document.querySelector('[data-sys="hdmi1"]').options].some((o) => o.value === "touch")), 6000);
  assert.ok(await T(() => [...document.querySelector('[data-sys="hdmi2"]').options].slice(0, 2).map((o) => o.value).join() === "lyrics,charts"));
  await T(() => { const s = document.querySelector('[data-ts="pick"]'); s.value = "off"; s.dispatchEvent(new Event("change", { bubbles: true })); document.querySelector('[data-ts="apply"]').click(); });
  await until(async () => JSON.parse(fs.readFileSync(path.join(tmp, "displays.json"), "utf8")).touchKind === "off", 4000);
});
await check("Settings → Wi-Fi: a failed connection says why (here: no NetworkManager on this PC), with Other network… and the country", async () => {
  await until(() => T(() => !!document.querySelector('[data-wf="other"]') && !!document.querySelector('[data-wf="country"]')), 6000);
  await T(() => PPFeatures.handleHardware({ type: "wifiResult", ok: false, message: "Wrong password - check it (it is case-sensitive) and try again." }));
  await until(() => T(() => /Wrong password/.test(document.querySelector(".wf").textContent)), 3000);
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
console.log("\nCentral Control link:");
await check("I/O tab: every input and output - network audio, outputs, inputs, MIDI, screens, control surface, devices", async () => {
  await T(() => PPShell.showTab("io")); await until(() => T(() => document.querySelectorAll("#ioRoot .io-card").length >= 6), 5000);
  const t = await T(() => document.querySelector("#ioRoot").textContent);
  assert.ok(/Audio to Central Control/.test(t) && /Audio outputs/.test(t) && /Audio inputs/.test(t) && /MIDI/.test(t) && /HDMI 2 shows/.test(t) && /Control surface/.test(t), t.slice(0, 300));
});
await check("network audio: set to Wi-Fi on the I/O tab, a Central Control subscribes and gets every track on its own channel + click, pads, tracks mix", async () => {
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
await check("the hub: the app's songs (tempo, sections, waveform) are on the driver for Central Control", async () => {
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
await check("setlists: a song changed on another Central Pedal updates the open setlist in place", async () => {
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
await check("pedal jobs: as a foot controller its buttons go to the track player; as an instrument rig the song buttons do nothing here; the instrument always stays local", async () => {
  await T(() => { window.__fw = []; const orig = PPFeatures.sendToDriver; window.__origSend = orig; PPFeatures.sendToDriver = (m) => { if (m.type === "forwardAction") { window.__fw.push(m); return true; } return orig(m); }; PPPedalJob.set("controller"); });
  assert.ok(await T(() => !!document.querySelector("#pedalJobBar") && /Foot controller/.test(document.querySelector("#pedalJobBar").textContent)));
  const sec = await T(() => PPTracks.state.section);
  await T(() => { PPActions.run("nextSection"); PPActions.run("tracksLevel", {}, { value: 0.3 }); });
  assert.deepEqual(await T(() => window.__fw.map((m) => [m.name, m.value])), [["nextSection", undefined], ["tracksLevel", 0.3]]);
  assert.equal(await T(() => PPTracks.state.section), sec, "nothing moved here");
  await T(() => { window.__fw = []; PPActions.run("boardNext"); }); assert.equal(await T(() => window.__fw.length), 0, "instrument actions stay on this pedal");
  await T(() => PPPedalJob.set("instrument")); await T(() => PPActions.run("playAll")); await wait(200);
  assert.equal(await T(() => PPTracks.isPlaying() || window.__fw.length > 0), false);
  assert.ok(await T(() => /Instrument rig/.test(document.querySelector("#pedalJobBar").textContent)));
  await T(() => { PPPedalJob.set("player"); PPFeatures.sendToDriver = window.__origSend; });
  assert.ok(await T(() => !document.querySelector("#pedalJobBar")));
});
await check("LIVE: the setlist, the song with its key / BPM / time left, its sections; a section button jumps there", async () => {
  await T(() => { PPTracks.stop(true); PP.engine.stop(); const p = PP.project(); let i = p.songs.findIndex((q) => PPTracks.data(q).stems.length && PPTracks.sectionsOf(q).length >= 2);
    if (i < 0) i = 0; window.__liveName = p.songs[i] && p.songs[i].name; PPTracks.data(p.songs[i]).after = "stop"; PPFeatures.loadSong(i); PPShell.showTab("live"); });
  await until(() => T(() => PPShell.currentTab() === "live" && !document.querySelector("#tabLive").classList.contains("hidden") && document.querySelector("#lvSong").textContent.indexOf(window.__liveName) > -1));
  const v = await T(() => ({ rows: document.querySelectorAll("#lvSetlist .lv-row").length, songs: PP.project().songs.length, secs: document.querySelectorAll(".lv-sec").length, want: PPTracks.sectionsOf(PPFeatures && PP.project().songs[PP.project().songIndex]).length, left: document.querySelector("#lvLeft").textContent }));
  assert.equal(v.rows, v.songs); assert.equal(v.secs, v.want); assert.ok(v.secs >= 2, "sections"); assert.match(v.left, /^−\d+:\d\d$/);
  await T(() => document.querySelectorAll(".lv-sec")[1].click());
  await until(() => T(() => { const s = PP.project().songs[PP.project().songIndex], x = PPTracks.sectionsOf(s)[1]; return Math.abs(PPTracks.state.pos - x.start) < 0.6; }));
});
await check("LIVE: Play, then Safe Stop fades the tracks out (not a cut) and stops them; the faders come back for the next song", async () => {
  await T(() => document.querySelector('[data-lv="play"]').click());
  await until(() => T(() => PPTracks.isPlaying()), 8000);
  const g0 = await T(() => PP.engine.tracksBus.gain.value);
  await T(() => document.querySelector('[data-lv="safeStop"]').click());
  await wait(1200);
  const mid = await T(() => ({ g: PP.engine.tracksBus.gain.value, playing: PPTracks.isPlaying(), fading: document.querySelector('[data-lv="safeStop"]').classList.contains("fading") }));
  assert.ok(mid.playing && mid.fading && mid.g < g0 * 0.8, JSON.stringify({ g0, mid }));
  await until(() => T(() => !PPTracks.isPlaying()), 4000);
  await wait(600);
  assert.ok(await T(() => PP.engine.tracksBus.gain.value) > g0 * 0.5, "faders back");
});
await check("LIVE: the service lock keeps the other tabs, the mixer and tracks mode away until the PIN unlocks it; playing still works", async () => {
  await T(() => PPLive.setLocked(true));
  assert.equal(await T(() => { PPShell.showTab("settings"); return PPShell.currentTab(); }), "live");
  assert.equal(await T(() => { PPActions.run("tab", { tab: "tracks" }); return PPShell.currentTab(); }), "live");
  assert.ok(await T(() => document.body.classList.contains("service-locked") && document.querySelector('[data-lv="tracksMode"]').disabled));
  await T(() => PPActions.run("nextSection")); await wait(150);
  const code = await T(() => String((PPFeatures.systemStatus() || {}).code || window.__pedalBridge.info.code));
  await T(() => { window.__ask = PP.ask; PP.ask = async () => "0000"; }); await T(() => PPLive.unlock()); await wait(100);
  assert.equal(await T(() => PPLive.locked()), true, "a wrong PIN keeps it locked");
  await T((c) => { PP.ask = async () => c; }, code); await T(() => PPLive.unlock()); await wait(100);
  await T(() => { PP.ask = window.__ask; });
  assert.equal(await T(() => PPLive.locked()), false);
  assert.equal(await T(() => { PPShell.showTab("tracks"); return PPShell.currentTab(); }), "tracks");
});
await check("Ready check: one list of what is fine and what to fix (sound, outputs and click, every song's tracks, the Pi), with a summary", async () => {
  await T(() => { PPShell.showTab("live"); PPLive.openReady(); });
  await until(() => T(() => !document.querySelector("#lvReady").classList.contains("hidden") && document.querySelectorAll("#lvReady li").length >= 4));
  const r = await T(() => { const x = PPLive.readyCheck(); return { titles: x.items.map((i) => i.title), summary: x.summary.label }; });
  assert.ok(r.titles.some((t) => /Sound/.test(t)) && r.titles.some((t) => /song|setlist/i.test(t)) && r.titles.some((t) => /Storage/.test(t)), JSON.stringify(r));
  assert.match(r.summary, /Ready|to check|problem/);
  await T(() => document.querySelector('[data-lv="readyClose"]').click());
});
await check("service report: today's songs (when, how long, how each ended, its sections), Safe Stop and the lock are written down and shown", async () => {
  await T(() => PPReport.flush()); await wait(600);
  await T(() => document.querySelector('[data-lv="report"]').click());
  await until(() => T(() => document.querySelectorAll("#lvReport .rp-songs tbody tr").length >= 1), 10000);
  const txt = await T(() => PPReport.text());
  assert.match(txt, /Songs played: [1-9]/); assert.match(txt, /Safe Stop/); assert.match(txt, /Service lock on/); assert.match(txt, /▶ Play/);
  await T(() => document.querySelector('#lvReport [data-rp="close"]').click());
});
await check("LIVE: the tuner opens on the LIVE screen itself (no tab change) and closes when leaving it", async () => {
  await T(() => { if (PPInstrument.kind() === "off" || PPInstrument.kind() === "keys") PPInstrument.setKind("electric"); PPShell.showTab("live"); });
  await until(() => T(() => !!document.querySelector('[data-lv="tuner"]')));
  await T(() => document.querySelector('[data-lv="tuner"]').click());
  await until(() => T(() => PPInstrument.tunerOn() && PPShell.currentTab() === "live"));
  await T(() => PPShell.showTab("pads")); await until(() => T(() => !PPInstrument.tunerOn()));
});
await check("backup player: it follows the track player's song and place silently (no MIDI hits), keeps in step, and takes over when the player goes quiet mid-song", async () => {
  await T(() => { PPShell.showTab("live"); PPTracks.stop(true); PP.engine.stop(); PPBackup.cfg().timeoutMs = 800; PPBackup.cfg().fadeMs = 100; PPPedalJob.set("backup"); });
  const sid = await T(() => { const p = PP.project(), i = p.songs.findIndex((q) => PPTracks.data(q).stems.length && PPTracks.data(q).duration > 6); return i < 0 ? null : p.songs[i].id; });
  assert.ok(sid, "a song with tracks");
  // the track player plays it from 2.0 s (4 updates a second)
  await T((id) => { window.__bkT0 = performance.now(); window.__bkTimer = setInterval(() => { const pos = 2 + (performance.now() - window.__bkT0) / 1000; PPFeatures.emit({ type: "backupFollow", songId: id, playing: true, pos, speed: 1, countIn: 0, loop: -1, tracksMode: true, pads: [] }); }, 250); }, sid);
  await until(() => T(() => PPTracks.isPlaying()), 8000);
  await wait(900);
  const f = await T(() => ({ out: PPTracks.outLevel(), silent: PPBackup.silent(), song: PP.project().songs[PP.project().songIndex].id, drift: Math.abs(PPTracks.state.pos - PPBackup.state().predicted), midi: (function () { const b = window.__pedalBridge, o = b.send; let sent = false; b.send = function (m) { if (m.type === "midiOut") sent = true; return o.call(b, m); }; window.__bkMidi = () => sent; return true; })() }));
  assert.equal(f.out, 0, "silent"); assert.ok(f.silent); assert.equal(f.song, sid); assert.ok(f.drift < 0.35, "in step: " + f.drift);
  // the track player goes quiet: the backup fades in where the song is
  await T(() => clearInterval(window.__bkTimer));
  await until(() => T(() => PPTracks.outLevel() === 1 && PPBackup.state().took), 4000);
  const g = await T(() => ({ playing: PPTracks.isPlaying(), pos: PPTracks.state.pos, tab: PPShell.currentTab() }));
  assert.ok(g.playing && g.pos > 2.5, JSON.stringify(g));
  await T(() => { PPTracks.stop(true); PPPedalJob.set("player"); PPTracks.setOut(1); });
});
await check("LIVE shows the Pi's temperature in °F (status chip and the Ready check)", async () => {
  const r = await T(() => { const real = PPFeatures.systemStatus; PPFeatures.systemStatus = () => Object.assign({}, real() || {}, { health: Object.assign({}, (real() || {}).health || {}, { tempC: 65 }) });
    try { PPShell.showTab("live"); PPLive.render(); const chip = document.body.textContent, items = JSON.stringify(PPLive.readyCheck()); return { chip: /149°F/.test(chip), ready: /Temperature 149°F/.test(items), celsius: /\d°C/.test(chip + items) }; } finally { PPFeatures.systemStatus = real; } });
  assert.deepEqual(r, { chip: true, ready: true, celsius: false });
});
await check("practice mixes: the time-stretch keeps the pitch, the key change moves it, and the WAV is right", async () => {
  const r = await T(async () => {
    const P = PPPractice, rate = 22050, n = rate * 2, sine = new Float32Array(n); for (let i = 0; i < n; i++) sine[i] = 0.5 * Math.sin(2 * Math.PI * 440 * i / rate);
    const freq = (ch) => { let z = 0; for (let i = 1; i < ch.length; i++) if (ch[i - 1] < 0 && ch[i] >= 0) z++; return z / (ch.length / rate); };
    const plan = await P.stretchPlan(sine, 1 / 0.75), slow = P.applyPlan(sine, plan, P.hann(2048)), up = P.resample(sine, Math.pow(2, 2 / 12));
    const wav = new DataView(P.encodeWav(new Float32Array([0, 0.5, -0.5]), new Float32Array([0, 0.25, -1]), 48000, 24));
    return { slowLen: slow.length / n, slowHz: freq(slow.subarray(4096, slow.length - 4096)), upHz: freq(up), wavRate: wav.getUint32(24, true), bits: wav.getUint16(34, true), ch: wav.getUint16(22, true), size: wav.byteLength };
  });
  assert.ok(Math.abs(r.slowLen - 1 / 0.75) < 0.01, "75% tempo is 1.33× as long: " + r.slowLen);
  assert.ok(Math.abs(r.slowHz - 440) < 6, "...still 440 Hz: " + r.slowHz);
  assert.ok(Math.abs(r.upHz - 440 * Math.pow(2, 2 / 12)) < 6, "+2 semitones: " + r.upHz);
  assert.deepEqual([r.wavRate, r.bits, r.ch, r.size], [48000, 24, 2, 44 + 3 * 2 * 3]);
});
await check("practice mixes: made for a song (a normal mix and a slow drums mix in another key, with a count-in), kept on the Central Pedal with a playlist, and listed for phones", async () => {
  const info = await T(() => {
    const p = PP.project(), s = p.songs.find((q) => PPTracks.data(q).stems.length && PPTracks.data(q).duration > 6); PPTracks.stop(true);
    const c = PPPractice.cfg(); c.songs = "pick"; c.picked = [s.id]; c.folder = "E2E Practice"; c.dest = "pedal"; c.format = "wav16"; c.countIn = 1; c.clickSource = "generated"; c.playlist = true; c.tempoMode = "song"; c.keyMode = "song";
    c.mixes = [{ id: "a", name: "Full band", on: true, levels: {} }, { id: "b", name: "Slow drums", on: true, levels: { drums: "solo" }, tempo: 75, key: 2 }, { id: "c", name: "Off one", on: false, levels: {} }];
    PPPractice.cfg(); PPPractice.open();
    return { dur: PPTracks.data(s).duration, name: s.name, bpm: PPTracks.data(s).grid.bpm, n: PPPractice.songsToMake(c).length, button: document.querySelector('[data-pm-act="make"]').textContent };
  });
  assert.equal(info.n, 1); assert.match(info.button, /Make 2 files/);
  await T(() => document.querySelector('[data-pm-act="make"]').click());
  const job = await until(() => T(() => { const j = PPPractice.job(); return j && !j.running ? { files: j.files, errors: j.errors } : null; }), 90000, 300);
  assert.deepEqual(job.errors, []); assert.equal(job.files.length, 2);
  const list = await T(async () => (await (await fetch("http://127.0.0.1:8766/practice/list")).json()).folders.find((f) => f.folder === "E2E Practice"));
  const names = list.files.map((f) => f.name).sort();
  assert.ok(names.some((n) => /Slow drums\)\.wav$/.test(n)) && names.some((n) => /Full band\)\.wav$/.test(n)) && names.includes("Slow drums (playlist).m3u"), names.join(", "));
  const lens = await T(async (names) => { const out = {}; for (const n of names.filter((x) => x.endsWith(".wav"))) { const b = await (await fetch("http://127.0.0.1:8766/practice/file?folder=E2E%20Practice&name=" + encodeURIComponent(n))).arrayBuffer(), v = new DataView(b); out[/Slow/.test(n) ? "slow" : "full"] = (b.byteLength - 44) / v.getUint32(28, true); } return out; }, names);
  const pre = 2 * 60 / info.bpm * 2;   // (a bar of 4 at the song's tempo, roughly)
  assert.ok(lens.full > info.dur - 1 && lens.full < info.dur + pre + 1.5, "full mix length " + lens.full + " vs " + info.dur);
  assert.ok(Math.abs(lens.slow / lens.full - 1 / 0.75) < 0.12, "the slow one is a third longer: " + lens.slow + " / " + lens.full);
  const page = await T(async () => (await fetch("http://127.0.0.1:8766/practice/caps")).json());
  assert.equal(page.share, "open");
  await T(() => { document.getElementById("pmDialog").close(); });
});
await check("sections are found from the tracks: verse, pre-chorus, chorus, bridge, intro and outro, on the right bars", async () => {
  await page.addScriptTag({ content: '// (runs in the page) a 40-bar song at 120 BPM: intro 4, verse 8, chorus 8, verse 8, chorus 8, outro 4\nasync function structureCheck(form) {\n  form = form || [["intro", 4], ["verse", 8], ["chorus", 8], ["verse", 8], ["chorus", 8], ["outro", 4]];\n  const plan = []; form.forEach(([p, l]) => { for (let k = 0; k < l; k++) plan.push(p); });\n  const rate = 22050, bar = 2, nb = plan.length, n = rate * bar * nb;\n  const chords = { verse: [[261.6, 329.6, 392], [220, 261.6, 329.6]], chorus: [[349.2, 440, 523.3], [392, 493.9, 587.3]], intro: [[261.6, 329.6, 392], [220, 261.6, 329.6]], outro: [[261.6, 329.6, 392], [220, 261.6, 329.6]], pre: [[233.1, 293.7, 349.2], [207.7, 261.6, 311.1]], bridge: [[220, 261.6, 329.6], [174.6, 220, 261.6]] };\n  const keys = new Float32Array(n), voc = new Float32Array(n), drums = new Float32Array(n);\n  for (let i = 0; i < n; i++) {\n    const t = i / rate, b = Math.floor(t / bar), part = plan[b], ch = chords[part][Math.floor(t / (bar * 2)) % 2], loud = part === "chorus" ? 0.22 : part === "verse" ? 0.13 : part === "pre" ? 0.16 : part === "bridge" ? 0.17 : 0.08;\n    let v = 0; for (const f of ch) v += Math.sin(2 * Math.PI * f * t); keys[i] = v * loud / 3;\n    if (part !== "intro" && part !== "outro") { const note = ch[Math.floor(t * 2) % 3] * 2; voc[i] = 0.18 * Math.sin(2 * Math.PI * note * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 0.5 * t)); }\n    const ph = t % 0.5; drums[i] = ph < 0.05 ? 0.5 * Math.sin(2 * Math.PI * 60 * ph) * Math.exp(-ph * 60) * (part === "chorus" ? 1.4 : 1) : 0;\n  }\n  const P = PPPractice, file = (name, x) => new File([P.encodeWav(x, x, rate, 16)], name, { type: "audio/wav" });\n  const s = PPTracks.newSong("Structure Test " + nb);\n  await PPTracks.importFilesIntoSong(s, [file("Keys.wav", keys), file("Vocals.wav", voc), file("Drums.wav", drums)], { analyze: false });\n  const t = PPTracks.data(s); t.grid = { mode: "manual", bpm: 120, first: 0, bpb: 4 }; t.tempoMap = []; t.sections = [];\n  const secs = await PPStructure.detect(s);\n  return (secs || []).map((x) => x.name + "@" + x.bar);\n}\n' });
  const a = await T(() => structureCheck());
  assert.deepEqual(a, ["Intro@1", "Verse 1@5", "Chorus@13", "Verse 2@21", "Chorus@29", "Outro@37"]);
  const b = await T(() => structureCheck([["intro", 4], ["verse", 8], ["pre", 4], ["chorus", 8], ["verse", 8], ["pre", 4], ["chorus", 8], ["bridge", 8], ["chorus", 8], ["outro", 4]]));
  assert.deepEqual(b, ["Intro@1", "Verse 1@5", "Pre-Chorus@13", "Chorus@17", "Verse 2@25", "Pre-Chorus@33", "Chorus@37", "Bridge@45", "Chorus@53", "Outro@61"]);
});
await check("stem splitter: installed (a stand-in Demucs here), a stereo file is split and comes back as a new song with drums / bass / vocals / other tracks", async () => {
  const before = await T(() => PP.project().songs.length);
  await T(async () => {
    const c = PPStemSplit.cfg(); c.into = "new"; c.analyze = false; c.model = "htdemucs"; c.twoStems = ""; c.skip = []; c.keepOriginal = false; c.quality = "demucs"; c.review = false; c.cleanup = false; c.trackSet = "plain"; c.leadBacking = false; c.drumParts = false;
    PPStemSplit.open(); await PPStemSplit.refresh();
    const rate = 22050, L = new Float32Array(rate * 2); for (let i = 0; i < L.length; i++) L[i] = 0.3 * Math.sin(2 * Math.PI * 220 * i / rate);
    PPStemSplit.pick(new File([PPPractice.encodeWav(L, L, rate, 16)], "Split Test.wav", { type: "audio/wav" }));
  });
  const st = await T(() => PPStemSplit.state());
  assert.ok(st.status && st.status.installed && st.status.custom, JSON.stringify(st.status && { i: st.status.installed, c: st.status.custom }));
  assert.ok(await T(() => !document.querySelector('[data-ss-act="start"]').disabled), "Split it is ready");
  await T(() => document.querySelector('[data-ss-act="start"]').click());
  const song = await until(() => T((n) => { const p = PP.project(); if (p.songs.length <= n) return null; const s = p.songs.find((q) => q.name === "Split Test"); return s && PPTracks.data(s).stems.length === 4 ? PPTracks.data(s).stems.map((x) => x.name + ":" + x.role).sort() : null; }, before), 30000, 300)
    .catch(async () => { throw new Error("no new song: " + JSON.stringify(await T(() => ({ st: PPStemSplit.state().msg, job: PPStemSplit.state().current, songs: PP.project().songs.map((q) => q.name + "/" + PPTracks.data(q).stems.length) })))); });
  assert.deepEqual(song, ["Bass:bass", "Drums:drums", "Other:music", "Vocals:vocals"]);
  assert.match(await T(() => PPStemSplit.state().msg), /4 tracks added/);
  await T(() => document.getElementById("ssDialog").close());
});
await check("stem splitter, best quality and split further: lead / backing vocals and the drum parts come back as their own tracks, with the click and the spoken guide on", async () => {
  await T(async () => {
    const c = PPStemSplit.cfg(); Object.assign(c, { into: "new", quality: "best", leadBacking: true, drumParts: true, keepDrums: false, analyze: true, sections: true, clickOn: true, guideOn: true, skip: [],
      review: false, cleanup: false, dereverb: false, trackSet: "plain", kit: "pieces", clickTrack: false, guideTrack: false });
    PPStemSplit.open(); await PPStemSplit.refresh();
    const rate = 22050, L = new Float32Array(rate * 3); for (let i = 0; i < L.length; i++) L[i] = 0.3 * Math.sin(2 * Math.PI * 220 * i / rate);
    PPStemSplit.pick(new File([PPPractice.encodeWav(L, L, rate, 16)], "Best Test.wav", { type: "audio/wav" }));
  });
  const keep = await T(() => Array.from(document.querySelectorAll("[data-ss-keep]")).map((x) => x.dataset.ssKeep));
  assert.deepEqual(keep, ["lead_vocals", "backing_vocals", "drum_kick", "drum_snare", "drum_toms", "drum_hh", "drum_ride", "drum_crash", "bass", "other"]);
  await T(() => document.querySelector('[data-ss-act="start"]').click());
  const got = await until(() => T(() => { const s = PP.project().songs.find((q) => q.name === "Best Test"); const t = s && PPTracks.data(s); return t && t.stems.length >= 10 && !PPStemSplit.state().importing ? { stems: t.stems.map((x) => x.name + ":" + x.role).sort(), click: t.click.on, cues: t.cues.on } : null; }), 40000, 300)
    .catch(async () => { throw new Error(JSON.stringify(await T(() => ({ msg: PPStemSplit.state().msg, job: PPStemSplit.state().current })))); });
  assert.deepEqual(got.stems, ["Backing vocals:vocals", "Bass:bass", "Crash:drums", "Hi-hat:drums", "Kick:drums", "Lead vocals:vocals", "Other:music", "Ride:drums", "Snare:drums", "Toms:drums"]);
  assert.ok(got.click && got.cues, JSON.stringify(got));
  await T(() => document.getElementById("ssDialog").close());
});
await check("stem splitter, Studio: the clean-up and MultiTracks-style tracks, checked before adding (solo, rename, merge, split again), then Click and Guide tracks and the drum hits for the lights", async () => {
  await T(async () => {
    const c = PPStemSplit.cfg(); Object.assign(c, { into: "new", quality: "studio", ensemble: true, leadBacking: true, drumParts: true, kit: "drums", dereverb: true, keepReverb: true, cleanup: true, bleed: 50, trim: true, mono: true,
      dropSilent: true, perc: true, trackSet: "multitracks", hits: true, review: true, analyze: true, sections: true, clickTrack: true, guideTrack: true, guideCount: true, skip: [], keepFiles: false, keepOriginal: false });
    PPStemSplit.open(); await PPStemSplit.refresh();
    const rate = 22050, L = new Float32Array(rate * 3); for (let i = 0; i < L.length; i++) L[i] = 0.3 * Math.sin(2 * Math.PI * 220 * i / rate);
    PPStemSplit.pick(new File([PPPractice.encodeWav(L, L, rate, 16)], "Studio Test.wav", { type: "audio/wav" }));
  });
  const opts = await T(() => PPStemSplit.optsFor(PPStemSplit.cfg(), null));
  assert.ok(opts.quality === "studio" && opts.cleanup && opts.kit === "drums" && opts.trackSet === "multitracks" && opts.dereverb && opts.review && opts.trim, JSON.stringify(opts));
  await T(() => document.querySelector('[data-ss-act="start"]').click());
  const rv = await until(() => T(() => { const r = PPStemSplit.state().review; return r ? r.items.map((x) => x.name + ":" + x.role + (x.keep ? "" : ":off")) : null; }), 60000, 300)
    .catch(async () => { throw new Error(JSON.stringify(await T(() => ({ msg: PPStemSplit.state().msg, job: PPStemSplit.state().current })))); });
  assert.deepEqual(rv, ["Lead Vox:vocals", "BGVs:vocals", "Vox FX:vocals", "Drums:drums", "Perc:drums", "Bass:bass", "Instruments:music"], "the MultiTracks-style set, checked before adding");
  const shown = await T(() => ({ rows: document.querySelectorAll("#ssDialog [data-rv-item]").length, add: document.querySelector('[data-rv="add"]').textContent, hits: PPStemSplit.state().review.hits }));
  assert.equal(shown.rows, 7); assert.match(shown.add, /Add 7 tracks to a new song/);
  assert.ok(shown.hits.kick && shown.hits.kick.length >= 3 && shown.hits.snare && shown.hits.snare.length >= 3, "drum hits from the kit pieces: " + JSON.stringify(shown.hits));
  // listen: play, solo one, then pause
  await page.click('#ssDialog [data-rv="play"]');
  await until(() => T(() => PPStemSplit.state().player.playing), 4000);
  await page.click('#ssDialog [data-rv-item] [data-rvb="solo"]');
  assert.equal(await T(() => Object.values(PPStemSplit.state().player.solo).filter(Boolean).length), 1);
  await page.click('#ssDialog [data-rv="play"]');
  // rename "Instruments" -> "Keys & Pads" and make it keys; merge BGVs + Vox FX
  const row = (name) => T((n) => Array.from(document.querySelectorAll("#ssDialog [data-rv-item]")).findIndex((r) => r.querySelector('[data-rvf="name"]').value === n), name);
  let i = await row("Instruments");
  await page.fill(`#ssDialog [data-rv-item]:nth-child(${i + 2}) [data-rvf="name"]`, "Keys & Pads");
  await page.locator(`#ssDialog [data-rv-item]:nth-child(${i + 2}) [data-rvf="name"]`).dispatchEvent("change");
  i = await row("Keys & Pads"); await page.selectOption(`#ssDialog [data-rv-item]:nth-child(${i + 2}) [data-rvf="role"]`, "keys");
  for (const n of ["BGVs", "Vox FX"]) { const k = await row(n); await page.check(`#ssDialog [data-rv-item]:nth-child(${k + 2}) [data-rvf="merge"]`); }
  await page.click('#ssDialog [data-rv="merge"]');
  await until(() => T(() => PPStemSplit.state().review.items.some((x) => x.name === "BGVs + Vox FX")), 8000);
  // split the Drums again into the kit pieces
  i = await row("Drums"); await page.selectOption(`#ssDialog [data-rv-item]:nth-child(${i + 2}) [data-rvf="again"]`, "drums");
  const after = await until(() => T(() => { const r = PPStemSplit.state().review; return r.items.some((x) => /^Drums · Kick$/.test(x.name)) && !r.items.some((x) => x.sub) ? r.items.map((x) => x.name + ":" + x.role + (x.keep ? "" : ":off")) : null; }), 40000, 300)
    .catch(async () => { throw new Error(JSON.stringify(await T(() => ({ msg: PPStemSplit.state().msg, items: PPStemSplit.state().review.items.map((x) => [x.name, x.sub && x.sub.state, x.sub && x.sub.error]) })))); });
  assert.deepEqual(after, ["Lead Vox:vocals", "BGVs + Vox FX:vocals", "BGVs:vocals:off", "Vox FX:vocals:off", "Drums:drums:off", "Drums · Kick:drums", "Drums · Snare:drums", "Drums · Toms:drums", "Drums · Hi-Hat:drums", "Drums · Ride:drums", "Drums · Crash:drums", "Drums · Perc:drums", "Perc:drums", "Bass:bass", "Keys & Pads:keys"]);
  // add them: the song gets the tracks, a Click and a Guide (to the click out), and the drum hits
  await page.click('#ssDialog [data-rv="add"]');
  const got = await until(() => T(() => { const s = PP.project().songs.find((q) => q.name === "Studio Test"), t = s && PPTracks.data(s); return t && !PPStemSplit.state().importing && !PPStemSplit.state().review && t.stems.some((x) => x.role === "click") ? { stems: t.stems.map((x) => x.name + ":" + x.role + ":" + x.bus), click: t.click.on, cues: t.cues.on, hits: t.drumHits, hub: PPTracks.hubSong(s).drumHits, secs: PPTracks.sectionsOf(s).map((x) => x.sec.name + "@" + Math.round(x.start * 100) / 100) } : null; }), 40000, 300)
    .catch(async () => { throw new Error(JSON.stringify(await T(() => ({ msg: PPStemSplit.state().msg, review: !!PPStemSplit.state().review })))); });
  assert.ok(got.stems.includes("Click:click:click") && got.stems.some((x) => /^Guide:guide:click$/.test(x)), "Click and Guide tracks on the click out: " + got.stems.join(", ") + " · sections " + got.secs.join(", ") + " · cue words: " + JSON.stringify(await T(async () => [!!(await PPTracks.cueBuffer("1")), PPTracks.cueIdFor({ name: "Verse 1" }), !!(await PPTracks.cueBuffer(PPTracks.cueIdFor({ name: "Verse 1" })))])));
  assert.ok(got.stems.includes("Keys & Pads:keys:music") && got.stems.includes("BGVs + Vox FX:vocals:music") && !got.stems.some((x) => /^BGVs:/.test(x)) && got.stems.length === 14, got.stems.join(", "));
  assert.ok(got.click === false && got.cues === false, "the tracks play the click and the guide (the live ones are off)");
  assert.ok(got.hits && got.hits.kick.length >= 3 && got.hub && got.hub.kick.length === got.hits.kick.length && got.hub.snare.length >= 3, JSON.stringify(got.hub));
  assert.match(await T(() => PPStemSplit.state().msg), /drum hits for the lights/);
  // play it: the kick goes out as its own note (36) on the lights channel, the crash/hit setting is there in MIDI out
  const notes = await T(async () => {
    const b = window.__pedalBridge, o = b.send, seen = []; b.send = function (m) { if (m.type === "midiOut") (m.messages || []).forEach((x) => seen.push(x.data)); return o.call(b, m); };
    const p = PP.project(); p.midiOut = p.midiOut || {}; p.midiOut.lightsDrums = true; PPTracks.setTracksMode(true);
    PPFeatures.loadSong(p.songs.findIndex((q) => q.name === "Studio Test")); await new Promise((r) => setTimeout(r, 1500));
    await PPTracks.play({ countIn: false }); await new Promise((r) => setTimeout(r, 2500)); PPTracks.pause(); b.send = o;
    return seen.filter((d) => (d[0] & 0xF0) === 0x90 && d[2] > 0).map((d) => (d[0] & 15) + ":" + d[1]);
  });
  assert.ok(notes.includes("0:36") && notes.includes("0:38"), "kick (36) and snare (38) notes on the lights channel: " + notes.join(" "));
  await T(() => document.getElementById("ssDialog").close());
});
await check("Add a song: your songs first (this setlist and the library), then the four ways - own stems, the whole song split, MultiTracks.com / Prime, Central Tracks", async () => {
  await T(() => { document.querySelectorAll("dialog[open]").forEach((d) => d.close()); PPSources.open(); });
  const first = await T(() => ({ newBtn: !!document.querySelector('[data-a="song-new"]'), rows: document.querySelectorAll("#addBody [data-song]").length, tabsHidden: document.getElementById("addTabs").classList.contains("hidden"), songs: PP.project().songs.length }));
  assert.ok(first.newBtn && first.rows >= first.songs && first.tabsHidden, JSON.stringify(first));
  await page.click('[data-a="song-new"]'); await page.fill("#asName", "Flow Song");
  const ways = await T(() => Array.from(document.querySelectorAll(".as-way b")).map((b) => b.textContent));
  assert.deepEqual(ways, ["Your own stems", "The whole song, split", "MultiTracks.com or Prime", "Central Tracks"]);
  const [fc] = await Promise.all([page.waitForEvent("filechooser"), page.click('[data-way="own"]')]);
  await fc.setFiles(songFile);
  const made = await until(() => T(() => { const s = PP.project().songs.find((q) => q.name === "Flow Song"); return s && PPTracks.data(s).stems.length === 1 ? { active: PP.activeSong() && PP.activeSong().name, stem: PPTracks.data(s).stems[0].name } : null; }), 30000, 200);
  assert.equal(made.active, "Flow Song"); assert.equal(made.stem, "Drums");
  // an existing song: its page says so; Central Tracks opens that tab; back returns to the four ways
  await T(() => PPSources.open());
  await T(() => { const b = Array.from(document.querySelectorAll("#addBody [data-song]")).find((x) => /Flow Song/.test(x.textContent)); b.click(); });
  assert.match(await T(() => document.querySelector("#addBody h3").textContent), /Add tracks to Flow Song/);
  await page.click('[data-way="central"]');
  const tab = await T(() => ({ on: document.querySelector("#addTabs .on").dataset.src, shown: !document.getElementById("addTabs").classList.contains("hidden"), back: !document.getElementById("addBack").classList.contains("hidden") }));
  assert.deepEqual(tab, { on: "central", shown: true, back: true });
  await until(() => T(() => /Central Tracks|Motion Audio/.test(document.getElementById("addBody").textContent) && !/Loading Central Tracks/.test(document.getElementById("addBody").textContent)), 8000);
  await page.click("#addBack"); assert.equal(await T(() => document.querySelectorAll(".as-way").length), 4);
  // the whole song: the stem splitter opens with the file picked, into this song
  const [fc2] = await Promise.all([page.waitForEvent("filechooser"), page.click('[data-way="split"]')]);
  await fc2.setFiles(songFile);
  const intoBefore = await T(() => PPStemSplit.cfg().into);
  const sp = await until(() => T(() => { const d = document.getElementById("ssDialog"); return d && d.open ? { picked: PPStemSplit.state().picked && PPStemSplit.state().picked.name, target: (PP.project().songs.find((q) => q.id === PPStemSplit.state().intoSong) || {}).name, says: /The tracks go into Flow Song/.test(d.textContent), into: PPStemSplit.cfg().into } : null; }), 8000);
  assert.deepEqual(sp, { picked: "Drums.wav", target: "Flow Song", says: true, into: intoBefore }, "into this song just this once - the splitter's own setting is unchanged");
  await T(() => document.getElementById("ssDialog").close());
});
await check("no page errors during the whole run", () => assert.deepEqual(errors.filter((e) => !/favicon/.test(e)), []));

await browser.close();
driver.kill("SIGTERM"); pco.close();
console.log(failures ? "\n" + failures + " CHECK(S) FAILED" : "\nALL END-TO-END CHECKS PASSED");
if (failures) { console.log("\n--- driver log tail ---\n" + driverLog.split("\n").slice(-30).join("\n")); }
process.exit(failures ? 1 : 0);
