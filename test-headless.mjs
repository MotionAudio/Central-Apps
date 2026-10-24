#!/usr/bin/env node
/**
 * Pad Pedal - headless app test
 * ==============================
 * Loads index.html in real headless Chromium (Playwright) and drives it the
 * way a player and the hardware control surface would. No screen, speaker or
 * Raspberry Pi needed.
 *
 *   npm i playwright && npx playwright install chromium   (once, on a PC)
 *   node test-headless.mjs [path/to/index.html] [screenshot-dir]
 */
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";

const here = path.dirname(fileURLToPath(import.meta.url));
const pagePath = path.resolve(process.argv[2] || path.join(here, "index.html"));
const shotDir = process.argv[3] || null;

let failures = 0;
async function check(label, fn) {
  try { await fn(); console.log("  ✓ " + label); }
  catch (error) { failures++; console.error("  ✗ " + label + "\n      " + (error && error.message ? error.message.split("\n").slice(0, 12).join("\n      ") : error)); }
}

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
// (opened from a file this is Central Pedal Control, which needs a key: the default P key, as a church would enter it today)
await page.addInitScript(() => { try { if (!localStorage.getItem("cc-license")) localStorage.setItem("cc-license", JSON.stringify({ key: "PDEF-AULT-KEY0-2026", kind: "P", app: "pedal-control", okAt: Date.now(), production: "Test church", isDefault: true })); } catch (_) { } });
// The app tries ws://127.0.0.1:8765 (the pedal driver). On a machine without the
// driver that connection is refused; the app handles it, Chrome still logs it.
const benign = /127\.0\.0\.1:876[56]|ERR_CONNECTION_REFUSED/;  // the pedal driver is not running on a PC
const errors = [];
page.on("console", (m) => { if (m.type() === "error" && !benign.test(m.text())) errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto("file://" + pagePath);
await page.waitForFunction(() => window.__test && window.__pedalBridge);
await page.evaluate(() => { if (window.PPShell) window.PPShell.showTab("pads"); });   // (it opens on LIVE; these checks are about the Pad tab)
const T = (fn, arg) => page.evaluate(fn, arg);
const hw = (msg) => T((m) => window.__pedalBridge.handleMessage(m), msg);
const wait = (ms) => page.waitForTimeout(ms);

console.log("Audio engine:");
await check("page loads with no errors", () => assert.deepEqual(errors, []));
await check("Start Pad Sound creates a running voice", async () => {
  await page.click("#startButton"); await wait(250);
  const s = await T(() => ({ state: __test.engine.ctx.state, playing: __test.playingIndex(), sel: __test.selectedIndex() }));
  assert.equal(s.state, "running"); assert.equal(s.playing, s.sel);
});
await check("clicking Pad 3 in the editor crossfades to it", async () => {
  await page.click('[data-pad="2"]'); await wait(250);
  assert.equal(await T(() => __test.playingIndex()), 2);
});

console.log("\nHardware control surface (simulated messages):");
await check("footswitch 5 -> Pad 5 plays", async () => {
  await hw({ type: "pad", index: 4 }); await wait(200);
  assert.equal(await T(() => __test.playingIndex()), 4);
});
await check("footswitch 5 again -> Pad 5 fades out", async () => {
  await hw({ type: "pad", index: 4 }); await wait(100);
  assert.equal(await T(() => __test.playingIndex()), -1);
  assert.ok(await T(() => __test.engine.releasing.length) > 0, "voice should still be fading");
});
await check("Stop pressed again while fading -> instant cut", async () => {
  await hw({ type: "stop" }); await wait(50);
  assert.equal(await T(() => __test.engine.releasing.length), 0);
});
await check("Volume knob -> master gain and on-screen knob follow", async () => {
  await hw({ type: "knob", id: "volume", value: 0.2 }); await wait(250);
  const r = await T(() => ({ gain: __test.engine.master.gain.value, saved: __test.performance().volume, aria: document.querySelector('[data-knob="volume"]').getAttribute("aria-valuenow") }));
  assert.ok(r.gain < 0.1, "gain " + r.gain); assert.equal(r.saved, 0.2); assert.equal(r.aria, "20");
});
await check("Tone knob fully down -> master low-pass near 250 Hz", async () => {
  await hw({ type: "knob", id: "tone", value: 0 }); await wait(250);
  const hz = await T(() => __test.engine.tone.frequency.value);
  assert.ok(hz < 300, "cutoff " + hz);
});
await check("Fade knob fully up -> 16x the pad's fade time", async () => {
  await hw({ type: "knob", id: "fade", value: 1 });
  const text = await T(() => document.querySelector('[data-knob="fade"] .k-val').textContent);
  const pad = await T(() => __test.currentPad().crossfade);
  assert.equal(text, Math.min(12, (pad / 1000) * 16).toFixed(1) + " s");
});
await check("expression pedal -> swell gain", async () => {
  await hw({ type: "expression", value: 0 }); await wait(250);
  const low = await T(() => __test.engine.swell.gain.value);
  await hw({ type: "expression", value: 1 }); await wait(250);
  const high = await T(() => __test.engine.swell.gain.value);
  assert.ok(low < 0.2 && high > 0.95, low + " / " + high);
});
await check("encoder turn -> selected pad's key goes up a semitone", async () => {
  const before = await T(() => __test.currentPad().key);
  await hw({ type: "encoder", delta: 1 });
  const after = await T(() => __test.currentPad().key);
  const keys = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
  assert.equal(keys.indexOf(after), (keys.indexOf(before) + 1) % 12);
});
await check("encoder press -> plays the selected pad, press again -> fades it", async () => {
  await hw({ type: "encoderPress" }); await wait(200);
  assert.equal(await T(() => __test.playingIndex()), await T(() => __test.selectedIndex()));
  await hw({ type: "encoderPress" }); await wait(50);
  assert.equal(await T(() => __test.playingIndex()), -1);
});
await check("app reports playing pad back to the driver (for the LEDs)", async () => {
  await T(() => { window.__sent = []; __pedalBridge.socket = { readyState: 1, send: (s) => window.__sent.push(JSON.parse(s)) }; });
  await hw({ type: "pad", index: 1 }); await wait(150);
  const last = await T(() => window.__sent[window.__sent.length - 1]);
  assert.deepEqual(last, { type: "state", playing: 1, playingAll: [1], selected: 1 });
  await T(() => { __pedalBridge.socket = null; });
});
await check("hello from the driver -> the 'Central Pedal' connected badge", async () => {
  await hw({ type: "hello", pads: 7, knobs: ["volume"], expression: true, encoder: true });
  assert.equal(await T(() => document.querySelector("#pfHw").classList.contains("on")), true);
});

console.log("\nPerform screen:");
await check("encoder hold -> switches to the Perform screen", async () => {
  await hw({ type: "encoderHold" });
  assert.equal(await T(() => __test.isPerforming()), true);
  assert.equal(await page.locator("#pfPads .pf-pad").count(), 8);
  assert.equal(await page.locator("#pfKnobs .knob").count(), 4);
});
await check("tapping a big pad plays it, tapping it again fades it", async () => {
  await page.click('[data-pf-pad="5"]'); await wait(200);
  assert.equal(await T(() => __test.playingIndex()), 5);
  assert.equal(await page.locator('[data-pf-pad="5"].playing').count(), 1);
  await page.click('[data-pf-pad="5"]'); await wait(50);
  assert.equal(await T(() => __test.playingIndex()), -1);
});
await check("dragging the Reverb knob up raises it", async () => {
  await hw({ type: "knob", id: "reverb", value: 0.5 });
  const box = await page.locator('[data-knob="reverb"]').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 60, { steps: 6 }); await page.mouse.up();
  const v = await T(() => __test.performance().reverb);
  assert.ok(v > 0.8, "reverb " + v);
});
await check("key + button changes the key display", async () => {
  const before = await page.textContent("#pfKey");
  await page.click("#pfKeyUp");
  assert.notEqual(await page.textContent("#pfKey"), before);
});
await check("knob settings survive a reload", async () => {
  await hw({ type: "knob", id: "volume", value: 0.66 }); await wait(250);
  await page.reload(); await page.waitForFunction(() => window.__test);
  assert.equal(await T(() => __test.performance().volume), 0.66);
  assert.equal(await T(() => __test.isPerforming()), true, "should reopen in Perform mode");
});
if (shotDir) {
  for (const [w, h] of [[800, 480], [1280, 800], [390, 844]]) {
    await page.setViewportSize({ width: w, height: h });
    await hw({ type: "pad", index: 2 }); await wait(300);
    await page.screenshot({ path: path.join(shotDir, `perform-${w}x${h}.png`) });
    await T(() => __test.engine.panic());
  }
}
await check("Edit button returns to the editor", async () => {
  await page.click("#pfEdit");
  assert.equal(await T(() => __test.isPerforming()), false);
});

console.log("\nEffects and sound design:");
const play = async (i) => { await T((i) => __test.setSelectedPad(i, true), i); await wait(300); };
const voice = () => T(() => { const v = PP.engine.voiceFor(PP.selected()); return v ? true : false; });
await check("every effect can be switched on together on a playing pad, with no errors", async () => {
  await play(0);
  await T(() => { const fx = PP.currentPad().effects; ["compressor","drive","filter","phaser","chorus","tremolo","width","delay","reverb","lfo","texture"].forEach(k => fx[k].enabled = true); fx.reverb.shimmer = 60; PP.engine.update(PP.currentPad()); });
  await wait(600);
  assert.equal(await voice(), true); assert.deepEqual(errors, []);
});
await check("each effect panel draws its graph", async () => {
  for (const tab of ["compressor","drive","filter","phaser","chorus","tremolo","width","delay","reverb","lfo","texture"]) {
    await page.click(`.tab[data-panel="${tab}"]`); await wait(120);
    const painted = await T((tab) => [...document.querySelectorAll(`#panel-${tab} canvas[data-graph]`)].every(c => { const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 40) if (d[i]) n++; return n > 50; }), tab);
    assert.ok(painted, tab + " graph is blank");
  }
});
await check("compressor types really differ (Opto slow, FET coloured, Limiter 20:1)", async () => {
  const r = await T(() => { const p = PP.currentPad(), v = PP.engine.voiceFor(PP.selected()), out = {};
    for (const t of ["VCA", "FET", "Opto", "Limiter"]) { p.effects.compressor.type = t; p.effects.compressor.attack = 2; v.apply(p); out[t] = { attack: PP.compSettings(p.effects.compressor).attack, ratio: PP.compSettings(p.effects.compressor).ratio, colored: !!v.compColor.curve }; }
    return out; });
  assert.equal(r.VCA.colored, false); assert.equal(r.FET.colored, true); assert.ok(r.Opto.attack >= 30); assert.equal(r.Limiter.ratio, 20);
});
await check("built-in pads play chords: 'Root + 5th' uses more oscillators than 'Single note'", async () => {
  const count = async (chord) => { await T((c) => { PP.currentPad().chord = c; PP.currentPad().sampleId = null; PP.currentPad().voice = "Warm Pad"; }, chord); await play(0); return T(() => PP.engine.active.oscillators.length); };
  const single = await count("root"), fifth = await count("fifth"), add9 = await count("add9");
  assert.ok(fifth > single && add9 > fifth, single + " / " + fifth + " / " + add9);
});
await check("octave layers: sub and octave-up levels reach the audio graph live", async () => {
  await T(() => { PP.currentPad().octaves = { sub: 80, up: 40 }; PP.engine.update(PP.currentPad()); }); await wait(200);
  const g = await T(() => [PP.engine.active.layerSub.gain.value, PP.engine.active.layerUp.gain.value]);
  assert.ok(g[0] > .4 && g[1] > .1, JSON.stringify(g));
});
await check("auto-swell: a 4 s swell is still quiet after half a second", async () => {
  await T(() => { PP.currentPad().swell.attack = 4; }); await play(0);
  const level = await T(() => PP.engine.active.input.gain.value);
  await T(() => { PP.currentPad().swell.attack = 0; });
  assert.ok(level < .5, "input gain " + level);
});
await check("the library has 14 built-in pad sounds", async () => {
  assert.ok((await T(() => document.querySelectorAll("#voice option").length)) >= 14);
});

console.log("\nLive performance:");
await check("layering: holding pad 1's footswitch and pressing pad 4 plays both", async () => {
  await T(() => PP.engine.panic()); await wait(100);
  await hw({ type: "hello", version: 3, pads: 7 });
  await hw({ type: "pad", index: 0 }); await wait(250);
  await hw({ type: "pad", index: 3 }); await wait(250);
  await hw({ type: "padRelease", index: 0 }); await hw({ type: "padRelease", index: 3 });
  assert.deepEqual(await T(() => PP.engine.playingIndexes()), [0, 3]);
});
await check("LAYER mode: a tapped pad stacks; tapping it again takes it out", async () => {
  await page.click("#pfLayer").catch(async () => { await T(() => PP.setPerformMode(true)); await page.click("#pfLayer"); });
  await T(() => PP.triggerPad(5)); await wait(250);
  const three = await T(() => PP.engine.playingIndexes());
  await T(() => PP.triggerPad(5)); await wait(150);
  const two = await T(() => PP.engine.playingIndexes());
  await page.click("#pfLayer");
  assert.deepEqual(three, [0, 3, 5]); assert.deepEqual(two, [0, 3]);
});
await check("MORPH: pick pads 2 and 6, then the expression pedal blends between them", async () => {
  await T(() => PP.engine.panic()); await wait(100);
  await page.click("#pfMorph"); await T(() => { PP.triggerPad(1); PP.triggerPad(5); }); await wait(600);
  assert.ok(await T(() => !!PP.engine.morph), "morph not started");
  await hw({ type: "expression", value: 0 }); await wait(300);
  const a = await T(() => PP.engine.voices().map(v => +v.mix.gain.value.toFixed(2)));
  await hw({ type: "expression", value: 1 }); await wait(300);
  const b = await T(() => PP.engine.voices().map(v => +v.mix.gain.value.toFixed(2)));
  assert.ok(a[0] > .9 && a[1] < .1 && b[0] < .1 && b[1] > .9, JSON.stringify([a, b]));
  await page.click("#pfMorph"); await wait(200);
});
await check("FREEZE holds the sound after the pads stop", async () => {
  await play(2); await wait(1800);
  const frozen = await T(() => PP.engine.freeze());
  await T(() => PP.engine.stop()); await wait(300);
  const still = await T(() => !!PP.engine.frozen);
  await T(() => PP.engine.unfreeze(.05));
  assert.ok(frozen && still);
});
await check("tap tempo: four taps half a second apart = 120 BPM, and a synced delay follows", async () => {
  await play(0); await T(() => { const d = PP.currentPad().effects.delay; d.enabled = true; d.sync = true; d.division = ".5"; PP.engine.update(PP.currentPad()); });
  for (let i = 0; i < 4; i++) { await hw({ type: "tap" }); await wait(500); }
  await wait(200);
  const r = await T(() => [PP.project().tempo.bpm, PP.engine.active.delay.delayTime.value]);
  assert.ok(Math.abs(r[0] - 120) < 4, "bpm " + r[0]); assert.ok(Math.abs(r[1] - .25) < .02, "delay " + r[1]);
});
await check("setlist: NEXT SONG crossfades the playing pad into the next song's key and tempo", async () => {
  await T(() => { const p = PP.project(); p.songs = [{ id: "a", name: "Way Maker", key: "E", bpm: 68, pad: -1, notes: "" }, { id: "b", name: "Goodness", key: "A", bpm: 63, pad: -1, notes: "" }]; PPFeatures.loadSong(0); });
  await wait(300);
  await hw({ type: "nextSong" }); await wait(400);
  const r = await T(() => [PP.project().songIndex, PP.project().tempo.bpm, PP.engine.active && PP.engine.active.key, document.querySelector("#pfSongName").textContent]);
  assert.equal(r[0], 1); assert.equal(r[1], 63); assert.equal(r[2], "A"); assert.match(r[3], /Goodness/);
});
await check("MIDI: program change 2 plays pad 3, a note sets the key, CC7 sets volume", async () => {
  await T(() => PPFeatures.handleMidi([0xC0, 2])); await wait(300);
  const pad = await T(() => PP.playingIndex());
  await T(() => PPFeatures.handleMidi([0x90, 64, 100])); await wait(300);
  const key = await T(() => PP.engine.active.key);
  await T(() => PPFeatures.handleMidi([0xB0, 7, 0]));
  const vol = await T(() => PP.project().performance.volume);
  await T(() => PPFeatures.handleMidi([0xB0, 7, 100]));
  assert.equal(pad, 2); assert.equal(key, "E"); assert.equal(vol, 0);
});
await check("MIDI clock at 100 BPM sets the tempo", async () => {
  await T(() => { const t0 = performance.now(); for (let i = 0; i < 49; i++) PPFeatures.handleMidi([0xF8], t0 + i * 25); });
  assert.ok(Math.abs((await T(() => PP.project().tempo.bpm)) - 100) < 1);
});
await check("audio input channel turns on with its own effects chain", async () => {
  const ok = await T(() => PP.engine.setInput(true)); await wait(300);
  const has = await T(() => !!PP.engine.inputVoice && PP.engine.inputVoice.pad.isInput);
  await T(() => PP.engine.setInput(false));
  assert.ok(ok && has);
});
await check("output meters move while sound plays", async () => {
  await T(() => { PP.setPerformMode(false); PP.setPerformance("fade", .5); }); await play(0); await wait(900);
  const cover = await T(() => parseFloat(document.querySelector("#vuL").style.width));
  const info = await T(() => { const e = PP.engine, d = new Float32Array(2048); e.postL.getFloatTimeDomainData(d); let s = 0; for (const x of d) s += x * x; const v = e.active; return { rms: Math.sqrt(s / 2048), state: e.ctx.state, voices: e.voices().length, master: e.master.gain.value, swell: e.swell.gain.value, tone: e.tone.frequency.value, fade: v && v.fade.gain.value, level: v && v.levelGain.gain.value, mix: v && v.mix.gain.value, inGain: v && v.input.gain.value, pad: PP.selected(), perf: PP.project().performance }; });
  assert.ok(cover < 95, "meter cover " + cover + "% " + JSON.stringify(info));
});
await check("songs, tempo and new pad settings survive a reload", async () => {
  await T(() => PP.persistNow()); await page.reload(); await page.waitForFunction(() => window.PPFeatures);
  const r = await T(() => [PP.project().songs.length, PP.project().songIndex, Math.round(PP.project().tempo.bpm), PP.project().pads[0].octaves.sub]);
  assert.deepEqual(r, [2, 1, 100, 80]);
});

console.log("\nImport from USB / SD (served by the real driver code):");
const mediaDir = fs.mkdtempSync(path.join(os.tmpdir(), "pp-usb-"));
const driverPath = path.join(path.dirname(pagePath), "pedal-driver.py");
// a "USB stick" with one pad on it, served by the real driver in simulation mode
fs.mkdirSync(path.join(mediaDir, "media", "usb-sda1", "Pads"), { recursive: true });
{
  const rate = 44100, n = rate, data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(8000 * Math.sin(2 * Math.PI * 293.66 * i / rate)), i * 2);
  const h = Buffer.alloc(44); h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVEfmt ", 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(path.join(mediaDir, "media", "usb-sda1", "Pads", "Test Pad D.wav"), Buffer.concat([h, data]));
}
fs.writeFileSync(path.join(mediaDir, "code-chosen"), "1");
const py = spawn("python3", [driverPath, "--simulate", mediaDir, "--app-root", path.dirname(pagePath)], { stdio: ["pipe", "pipe", "pipe"] });
await new Promise((resolve) => { const up = (b) => { if (String(b).includes("USB/SD browser on")) resolve(); }; py.stdout.on("data", up); py.stderr.on("data", up); setTimeout(resolve, 8000); });
await wait(300);
await check("Import Sound opens the USB browser; tapping a file imports it into the pad", async () => {
  await T(() => PP.setPerformMode(false));
  await page.click("#importAudio"); await page.waitForSelector("#usbDialog[open] #usbList button[data-dir]", { timeout: 6000 });
  for (const folder of ["usb-sda1", "Pads"]) {  // the drive list shows the stick itself, then its folders
    await page.waitForSelector(`#usbList button[data-dir$="/${folder}"]`); await page.click(`#usbList button[data-dir$="/${folder}"]`);
    await page.waitForFunction((f) => document.querySelector("#usbPath").textContent.endsWith("/" + f), folder);
    await wait(150);
  }
  await page.waitForSelector("#usbList button[data-file]", { timeout: 4000 });
  await page.click("#usbList button[data-file]"); await wait(800);
  const r = await T(() => [PP.currentPad().sampleId ? PP.sampleFor(PP.currentPad().sampleId).name : null, document.querySelector("#usbDialog").open]);
  assert.deepEqual(r, ["Test Pad D", false]);
});
py.kill();
await T(() => document.querySelectorAll("dialog[open]").forEach((d) => d.close()));

console.log("\nSystem menu:");
await check("Settings tab opens and explains safe mode needs the Pi", async () => {
  await page.click("#systemButton"); await wait(150);
  assert.ok(!(await page.$eval("#tabSettings", (e) => e.classList.contains("hidden"))), "settings tab shown");
  assert.match(await page.textContent("#safeText"), /Central Pedal \(Raspberry Pi\) itself/);
  const rows = await page.$$eval("#routingMatrix select[data-rt]", (l) => l.map((s) => s.dataset.rt));
  assert.deepEqual(rows, ["tracks", "pad", "click", "instrument"]);
  await page.click('[data-tab="pads"]');
});
await check("outputs: 1-2 the Pi's jack, 3-4 the DAC; quick set-ups (4 mono, 2 stereo), each bus mono or a stereo pair, buses can share an output, a USB interface adds outputs", async () => {
  const r = await page.evaluate(async () => {
    PPFeatures.handleHardware({ type: "systemStatus", audio: { channels: ["Headphone jack L", "Headphone jack R", "DAC board L", "DAC board R", "USB out 1", "USB out 2"], hdmi: false, usbFirst: false } });
    PPShell.showTab("settings"); await new Promise((ok) => setTimeout(ok, 100));
    const R = () => JSON.stringify(PP.project().routing.buses), out = {};
    out.def = PPSettings.routingSummary().mode;
    document.querySelector('[data-rtpreset="stereo2"]').click(); await new Promise((ok) => setTimeout(ok, 50));
    out.stereo2 = R(); out.shared = PPSettings.routingSummary().buses.find((b) => b.id === "tracks").shared.join();
    const sel = document.querySelector('#routingMatrix select[data-rt="click"]'); sel.value = "5s"; sel.dispatchEvent(new Event("change", { bubbles: true })); await new Promise((ok) => setTimeout(ok, 50));
    out.custom = PPSettings.routingSummary(); out.opts = [...document.querySelectorAll('#routingMatrix select[data-rt="pad"] option')].map((o) => o.value);
    PPSettings.stepBus("instrument", 1); out.stepped = PP.project().routing.buses.instrument;
    document.querySelector('[data-rtpreset="mono4"]').click(); await new Promise((ok) => setTimeout(ok, 50)); out.back = R();
    PPShell.showTab("pads"); return out;
  });
  assert.equal(r.def, "mono4", "4 mono outputs by default");
  assert.equal(r.stereo2, JSON.stringify({ tracks: { ch: 1, st: true }, pad: { ch: 1, st: true }, click: { ch: 3, st: true }, instrument: { ch: 3, st: true } }));
  assert.equal(r.shared, "Pads", "tracks and pads share 1-2 (mixed there)");
  assert.equal(r.custom.mode, "custom"); assert.match(r.custom.buses.find((b) => b.id === "click").out, /^5–6 stereo/);
  assert.deepEqual(r.opts, ["0", "1", "2", "3", "4", "5", "6", "1s", "3s", "5s"], "Off, each of the 6 outputs, each stereo pair");
  assert.deepEqual(r.stepped, { ch: 5, st: true }, "the small screen steps a bus to the next choice (3–4 stereo → 5–6 stereo)");
  assert.equal(r.back, JSON.stringify({ tracks: { ch: 1, st: false }, pad: { ch: 2, st: false }, click: { ch: 3, st: false }, instrument: { ch: 4, st: false } }));
});

await check("no errors during the whole run", () => assert.deepEqual(errors, []));

// ---- the license keys before the website opens: Central Pedal Control asks for its key (production name, then the key);
// only the default P key works; it survives a reload; Settings → License says it's the default key
console.log("\nLicense keys with no website (default keys):");
{
  const p3 = await browser.newPage({ viewport: { width: 1100, height: 800 } }); const errs3 = []; p3.on("pageerror", (e) => errs3.push(String(e)));
  await p3.addInitScript(() => { window.CP_CONTROL = true; });   // (Central Pedal Control, as its app and /control/ mark it)
  await p3.goto("file://" + pagePath); await p3.waitForFunction(() => window.PPLicense && window.PPShell);
  await check("Central Pedal Control opens on the setup with no website: the production's name, then the key (no internet or account steps)", async () => {
    await p3.waitForSelector("dialog#licWiz[open]", { timeout: 8000 });
    const steps = await p3.$$eval("#licWiz .lw-steps span", (l) => l.map((s) => s.textContent)); assert.deepEqual(steps, ["1. Production", "2. License key"]);
    await p3.fill("#lwProd", "Grace Church"); await p3.click('#licWiz [data-lw="prod"]'); await p3.waitForSelector("#lwKey");
    assert.match(await p3.textContent("#licWiz"), /PDEF-AULT-KEY0-2026/);
  });
  await check("a key for another app and a random key are refused with the right words", async () => {
    await p3.fill("#lwKey", "ADEF-AULT-KEY0-2026"); await p3.click('#licWiz [data-lw="key"]'); await wait(100);
    assert.match(await p3.textContent("#licWiz .bad"), /That's an A key \(Central Control - admins\)\. Central Pedal Control needs a key that starts with P\./);
    await p3.fill("#lwKey", "PQ7K-2MXR-9TLB-4WZD"); await p3.click('#licWiz [data-lw="key"]'); await wait(100);
    assert.equal(await p3.textContent("#licWiz .bad"), "This key can't be checked yet - the Motion Audio website isn't open. Use the default key for now.");
  });
  await check("the default key opens it, survives a reload, and Settings → License calls it the default key (temporary)", async () => {
    await p3.fill("#lwKey", "pdef-ault-key0-2026"); await p3.click('#licWiz [data-lw="key"]'); await wait(300);
    assert.equal(await p3.$("dialog#licWiz"), null, "the setup closed");
    await p3.reload(); await p3.waitForFunction(() => window.PPLicense && window.PPShell); await wait(800);
    assert.equal(await p3.$("dialog#licWiz"), null, "no setup after a reload");
    const r = await p3.evaluate(() => ({ html: PPLicense.settingsHtml(), cov: PPLicense.coverage(), st: PPLicense.state(), keys: PPLicense.hasPlan("keys") }));
    assert.match(r.html, /Default key \(temporary\)/); assert.equal(r.st.production, "Grace Church"); assert.deepEqual([r.cov.updatesUntil, r.cov.text, r.cov.expiresAt], [null, "forever", null]);
    assert.equal(r.keys, true, "sound plans stay open until the website opens");
    assert.deepEqual(errs3, []);
  });
  await p3.close();
}

// ---- packages (the sound plans) against a stand-in website, on a page with just the license file: the Central Pedal has no key
// of its own (no setup wizard), its packages are activated for the pedal's id and kept with its driver; 14 days offline at most
console.log("\nPackages (sound plans):");
{
  const http = await import("node:http");
  const calls = [], pk = { ok: true, plans: null };
  const future = new Date(Date.now() + 300 * 864e5).toISOString(), soon = new Date(Date.now() + 30 * 864e5).toISOString();
  const srv = http.createServer((req, res) => {
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Content-Type": "application/json" };
    if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
    let body = ""; req.on("data", (d) => { body += d; }); req.on("end", () => {
      const j = body ? JSON.parse(body) : {}; calls.push([req.url, j]);
      let out = { ok: true };
      if (req.url === "/v1/package/activate") out = /^SABC/.test(j.key) ? { ok: true, key: j.key, plans: { keys: future, instrument: soon }, holder: "Sam", church: "Grace" } : { ok: false, error: "That package key isn't valid." };
      else if (req.url === "/v1/package/check") out = { packages: j.keys.map((k) => pk.ok ? { key: k, ok: true, plans: pk.plans || { keys: future, instrument: soon }, end: future } : { key: k, ok: false, error: "refunded" }) };
      else if (req.url === "/v1/versions") out = { everyone: [] };
      res.writeHead(200, cors); res.end(JSON.stringify(out));
    });
  });
  await new Promise((ok) => srv.listen(18893, "127.0.0.1", ok));
  const tmpPage = path.join(os.tmpdir(), "pp-packages-" + process.pid + ".html");
  fs.writeFileSync(tmpPage, `<!doctype html><meta charset="utf-8"><body><div id="set"></div>
<script>window.PP_LICENSE_CONFIG = { server: "http://127.0.0.1:18893", required: true }; window.__sent = []; window.__plansEvents = 0;
var L = {}; window.PPFeatures = { on: function (t, f) { (L[t] = L[t] || []).push(f); }, emit: function (m) { (L[m.type] || []).forEach(function (f) { f(m); }); }, sendToDriver: function () { } };
window.__pedalBridge = { connected: true, info: { deviceId: "pedal-0123456789ab" }, send: function (m) { window.__sent.push(m); return true; } };
window.addEventListener("pp-plans", function () { window.__plansEvents++; });</script>
<script src="${pathToFileURLish(path.join(here, "js", "license.js"))}"></script><script src="${pathToFileURLish(path.join(here, "js", "pedals.js"))}"></script>`);
  function pathToFileURLish(p) { return "file://" + p.split(path.sep).map(encodeURIComponent).join("/"); }
  const p2 = await browser.newPage();
  const errs = []; p2.on("pageerror", (e) => errs.push(String(e)));
  await p2.goto("file://" + tmpPage);
  const R = (fn, arg) => p2.evaluate(fn, arg);
  await check("the Central Pedal opens without a license key (no setup wizard); Settings shows Packages, not License; nothing is open yet", async () => {
    await R(() => PPLicense.init({ app: "pedal", packages: [] })); await wait(300);
    const r = await R(() => ({ wiz: !!document.querySelector("dialog#licWiz"), html: PPLicense.settingsHtml(), keys: PPLicense.hasPlan("keys"), free: PPLicense.hasPlan("free"), lockedMuff: PPPedals.pedalLocked("muff"), ts9: PPPedals.pedalLocked("ts9") }));
    assert.equal(r.wiz, false); assert.ok(/<h3>Packages<\/h3>/.test(r.html) && !/<h3>License<\/h3>/.test(r.html), r.html.slice(0, 200));
    assert.equal(r.keys, false); assert.equal(r.free, true); assert.equal(r.lockedMuff, true); assert.equal(r.ts9, false);
  });
  await check("Add a package: a wrong key is caught here; a good one is activated for the pedal's own id, opens its plans and is kept with the driver", async () => {
    await R(() => { document.getElementById("set").innerHTML = PPLicense.settingsHtml(); });
    await p2.fill("#pkgKey", "hello"); await p2.click('[data-pkg="add"]'); await wait(100);
    const bad = await p2.textContent("#pkgSettings"); const nCalls = calls.filter((c) => c[0] === "/v1/package/activate").length;
    await p2.fill("#pkgKey", "sabc-defg-hjkl-mnpq"); await p2.click('[data-pkg="add"]'); await wait(400);
    const act = calls.filter((c) => c[0] === "/v1/package/activate").pop()[1];
    const r = await R(() => ({ keys: PPLicense.hasPlan("keys"), inst: PPLicense.hasPlan("instrument"), plugins: PPLicense.hasPlan("plugins"), plans: Object.keys(PPLicense.plans()).sort(), saved: window.__sent.filter((m) => m.type === "packages" && m.action === "save").pop(), text: document.getElementById("pkgSettings").textContent, events: window.__plansEvents }));
    assert.ok(/starts with S/.test(bad) && nCalls === 0, bad);
    assert.deepEqual(act, { key: "SABC-DEFG-HJKL-MNPQ", deviceId: "pedal-0123456789ab", app: "pedal" });
    assert.ok(r.keys && r.inst && !r.plugins, JSON.stringify(r)); assert.deepEqual(r.plans, ["instrument", "keys"]);
    assert.ok(r.saved && r.saved.packages.length === 1 && r.saved.packages[0].key === "SABC-DEFG-HJKL-MNPQ", JSON.stringify(r.saved));
    assert.ok(/Central Keys until/.test(r.text) && /active/.test(r.text) && r.events >= 1, r.text);
  });
  await check("offline it keeps working 14 days after the last good check, never past a plan's end date; a refunded package stops at the next check", async () => {
    const r = await R(async () => {
      const set = (days, plans) => { const l = PPLicense.packages(); l[0].okAt = Date.now() - days * 864e5; if (plans) l[0].plans = plans; window.PPFeatures.emit({ type: "packages", packages: l }); };
      set(13); const d13 = PPLicense.hasPlan("keys"); set(15); const d15 = PPLicense.hasPlan("keys");
      set(1, { keys: new Date(Date.now() - 864e5).toISOString() }); const ended = PPLicense.hasPlan("keys");
      return { d13, d15, ended };
    });
    pk.ok = false; await R(() => PPLicense.checkPackages()); await wait(200);
    const after = await R(() => ({ keys: PPLicense.hasPlan("keys"), text: PPLicense.packagesHtml() }));
    assert.deepEqual(r, { d13: true, d15: false, ended: false }); assert.equal(after.keys, false); assert.ok(/refunded/.test(after.text), after.text.slice(0, 300));
    const chk = calls.filter((c) => c[0] === "/v1/package/check").pop()[1]; assert.deepEqual(chk, { keys: ["SABC-DEFG-HJKL-MNPQ"], deviceId: "pedal-0123456789ab" });
  });
  await check("Remove releases the key on the website and takes it off the pedal", async () => {
    await R(() => { document.getElementById("set").innerHTML = PPLicense.settingsHtml(); }); await p2.click("[data-pkg-remove]"); await wait(300);
    const rel = calls.filter((c) => c[0] === "/v1/package/release").pop();
    const r = await R(() => ({ n: PPLicense.packages().length, saved: window.__sent.filter((m) => m.type === "packages").pop() }));
    assert.deepEqual(rel && rel[1], { key: "SABC-DEFG-HJKL-MNPQ", deviceId: "pedal-0123456789ab" }); assert.equal(r.n, 0); assert.deepEqual(r.saved.packages, []);
    assert.deepEqual(errs, []);
  });
  await check("with no website the Central Pedal still needs no key; Settings → Packages takes only the default package key (every plan)", async () => {
    const p4 = await browser.newPage(); const html = fs.readFileSync(tmpPage, "utf8").replace('server: "http://127.0.0.1:18893", ', "");
    const tmp4 = tmpPage.replace(/\.html$/, "-nosite.html"); fs.writeFileSync(tmp4, html);
    await p4.goto("file://" + tmp4); await p4.evaluate(() => { localStorage.clear(); PPLicense.init({ app: "pedal", packages: [] }); document.getElementById("set").innerHTML = PPLicense.settingsHtml(); }); await wait(200);
    const wiz = await p4.$("dialog#licWiz"), open = await p4.evaluate(() => PPLicense.hasPlan("pedals"));
    await p4.fill("#pkgKey", "SQ7K-2MXR-9TLB-4WZD"); await p4.click('[data-pkg="add"]'); await wait(100);
    const refused = await p4.textContent("#pkgSettings .small");
    await p4.fill("#pkgKey", "SDEF-AULT-KEY0-2026"); await p4.click('[data-pkg="add"]'); await wait(200);
    const r = await p4.evaluate(() => ({ list: PPLicense.packages(), text: document.getElementById("pkgSettings").textContent, saved: window.__sent.filter((m) => m.type === "packages").pop() }));
    assert.equal(wiz, null); assert.equal(open, true); assert.match(refused, /website isn't open\. Use the default key for now/);
    assert.equal(r.list.length, 1); assert.deepEqual(Object.keys(r.list[0].plans).sort(), ["instrument", "keys", "pedals", "plugins"]); assert.match(r.text, /Default package \(temporary\)/);
    assert.ok(r.saved && r.saved.packages[0].key === "SDEF-AULT-KEY0-2026", "kept with the pedal's driver");
    await p4.close(); fs.rmSync(tmp4, { force: true });
  });
  await p2.close(); srv.close(); fs.rmSync(tmpPage, { force: true });
}

await browser.close();
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll app checks passed.");
process.exit(failures ? 1 : 0);
