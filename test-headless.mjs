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

await check("no errors during the whole run", () => assert.deepEqual(errors, []));

await browser.close();
console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll app checks passed.");
process.exit(failures ? 1 : 0);
