#!/usr/bin/env node
/**
 * Central Pedal - effects on tracks, pads and the buses (js/fx.js), in real headless Chromium.
 *   node test-fx.mjs [path/to/index.html]
 */
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const here = path.dirname(fileURLToPath(import.meta.url));
const pagePath = path.resolve(process.argv[2] || path.join(here, "index.html"));
let failures = 0;
async function check(label, fn) {
  try { await fn(); console.log("  ✓ " + label); }
  catch (error) { failures++; console.error("  ✗ " + label + "\n      " + (error && error.message ? error.message.split("\n").slice(0, 10).join("\n      ") : error)); }
}
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const page = await context.newPage();
await page.addInitScript(() => { try { if (!localStorage.getItem("cc-license")) localStorage.setItem("cc-license", JSON.stringify({ key: "PDEF-AULT-KEY0-2026", kind: "P", app: "pedal-control", okAt: Date.now(), production: "Test church", isDefault: true })); } catch (_) { } });
const benign = /127\.0\.0\.1:876[56]|ERR_CONNECTION_REFUSED|ERR_FILE_NOT_FOUND/;
const errors = [];
page.on("console", (m) => { if (m.type() === "error" && !benign.test(m.text())) errors.push(m.text()); });
page.on("pageerror", (e) => errors.push(String(e)));
const T = (fn, arg) => page.evaluate(fn, arg);
const wait = (ms) => page.waitForTimeout(ms);
async function until(fn, ms = 20000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await wait(100); } throw new Error("timed out"); }

await page.goto("file://" + pagePath);
await page.waitForFunction(() => window.__test && window.PPTracks && window.PPFx);

console.log("Track effects:");
await check("the page loads with the effects code and no errors", () => { assert.deepEqual(errors, []); });
await T(async () => {
  const rate = 22050, n = rate * 4, voc = new Float32Array(n), drums = new Float32Array(n);
  for (let i = 0; i < n; i++) { const t = i / rate; voc[i] = 0.2 * Math.sin(2 * Math.PI * 440 * t) * (0.5 + 0.5 * Math.sin(2 * Math.PI * 0.5 * t)); const ph = t % 0.5; drums[i] = ph < 0.05 ? 0.6 * Math.sin(2 * Math.PI * 60 * ph) * Math.exp(-ph * 60) : 0.0005 * Math.sin(i); }
  const P = PPPractice, file = (name, x) => new File([P.encodeWav(x, x, rate, 16)], name, { type: "audio/wav" });
  const s = PPTracks.newSong("FX Test");
  await PPTracks.importFilesIntoSong(s, [file("Vocals.wav", voc), file("Drums.wav", drums)], { analyze: false });
  const p = PP.project(); PPTracks.setTracksMode(true); PPFeatures.loadSong(p.songs.indexOf(s)); PPShell.showTab("tracks");
});
await until(() => T(() => document.querySelectorAll("#trStems [data-stem]").length === 2));
await check("every track strip and the tracks bus get an FX button", async () => {
  await until(() => T(() => document.querySelectorAll("#trStems [data-fx-stem]").length === 2 && document.querySelectorAll('#trStems [data-fx-bus="tracks"]').length === 1));
});
// watch what goes to the player
await until(() => T(() => (PPTracks.netDecks() || []).some((d) => d.songId === PPTracks.song().id)));
await T(() => { window.__fxMsgs = []; (PPTracks.netDecks() || []).forEach((d) => { const port = d.node.port, orig = port.postMessage.bind(port); port.postMessage = (m, tr) => { if (m && m.cmd === "stemfx") window.__fxMsgs.push({ id: m.id, fx: m.fx, n: m.L && m.L.length }); return orig(m, tr); }; }); });
await check("FX on a track opens its panel (gate, EQ, compressor, reverb, delay)", async () => {
  await page.click("#trStems [data-fx-stem]");
  const s = await T(() => ({ open: document.getElementById("fxDialog").open, title: document.querySelector("#fxDialog h3").textContent, sections: [...document.querySelectorAll("#fxDialog .fx-body header")].map((h) => h.textContent.trim().split(" ")[0]) }));
  assert.ok(s.open); assert.match(s.title, /Vocals/); assert.deepEqual(s.sections, ["Gate", "EQ", "Compressor", "Reverb", "Delay"]);
});
await check("a preset turns the effects on and the processed track goes to the player", async () => {
  await page.click('#fxDialog [data-fx-preset="Vocal stem"]');
  await until(() => T(() => { const st = PPTracks.data(PPTracks.song()).stems[0]; return st.fx && st.fx.on && st.fxKey && PPFx.pending() === 0; }));
  await until(() => T(() => window.__fxMsgs.some((m) => m.fx === true)));
  const r = await T(async () => {
    const st = PPTracks.data(PPTracks.song()).stems[0], raw = await PPTracks.getStem(st.id), fx = await PPTracks.getStemLocal(st.fxKey);
    const a = new Int16Array(raw.L), b = new Int16Array(fx.L); let diff = 0; for (let i = 0; i < a.length; i += 7) diff += Math.abs(a[i] - b[i]);
    return { same: a.length === b.length, diff, stereo: !!fx.R, btn: document.querySelector('#trStems [data-fx-stem="' + st.id + '"]').classList.contains("on") };
  });
  assert.ok(r.same, "same length"); assert.ok(r.diff > 1000, "processed"); assert.ok(r.stereo, "reverb makes it stereo"); assert.ok(r.btn, "FX button lit");
});
await check("tracks play with no pad playing", async () => {
  await T(() => { PP.engine.stop(); PPTracks.data(PPTracks.song()).padFollow = { start: false, stop: false, swell: false }; PPTracks.play({ countIn: false }); });   // (the song's "pads follow the tracks" off)
  await until(() => T(() => PPTracks.isPlaying()));
  assert.equal(await T(() => __test.playingIndex()), -1);
  await T(() => PPTracks.stop());
});
await check("turning the track's effects off sends the plain track back (bypass)", async () => {
  await T(() => { window.__fxMsgs.length = 0; const box = document.querySelector('#fxDialog [data-fx="on"]'); box.checked = false; box.dispatchEvent(new Event("change", { bubbles: true })); });
  await until(() => T(() => window.__fxMsgs.some((m) => m.fx === false)));
  assert.equal(await T(() => PPTracks.data(PPTracks.song()).stems[0].fx.on), false);
  await T(() => { const box = document.querySelector('#fxDialog [data-fx="on"]'); box.checked = true; box.dispatchEvent(new Event("change", { bubbles: true })); });
  await until(() => T(() => window.__fxMsgs.some((m) => m.fx === true)));   // (the rendered copy is kept: back at once)
});
await check("a pro preset is locked without Central Plugins, and pro settings fall back to the basics", async () => {
  const r = await T(() => {
    PPPedals.__has = PPPedals.has; PPPedals.has = (t) => t !== "plugins";
    const st = PPTracks.data(PPTracks.song()).stems[1]; PPFx.openStem(st.id);
    const btn = document.querySelector('#fxDialog [data-fx-preset="Lead vocal · plate"]'), locked = btn.classList.contains("locked"); btn.click();
    const applied = st.fx.preset === "Lead vocal · plate";
    st.fx = PPFx.applyPreset(st.fx, PPFx.presets.stem.filter((p) => p.name === "Lead vocal · plate")[0]);
    const basic = PPFx.plan(PPTracks.song(), st); PPPedals.has = PPPedals.__has; const full = PPFx.plan(PPTracks.song(), st);
    const lockNote = !!document.querySelector("#fxDialog .fx-lock");
    st.fx.on = false;
    return { locked, applied, basicRev: basic.reverb.type, fullRev: full.reverb.type, basicPing: basic.delay.pingpong, fullPing: full.delay.pingpong, lockNote };
  });
  assert.ok(r.locked, "pro preset marked locked"); assert.ok(!r.applied, "locked preset not applied");
  assert.equal(r.basicRev, "room"); assert.equal(r.fullRev, "plate"); assert.equal(r.basicPing, false); assert.equal(r.fullPing, true); assert.ok(r.lockNote);
  await T(() => document.getElementById("fxDialog").close());
});
await check("the tracks bus chain goes in when turned on and comes out when off", async () => {
  const r = await T(async () => {
    await PP.engine.ensure(); const fx = PPFx.busFx("tracks"); fx.on = true; fx.comp.on = true; fx.reverb.on = true; PPFx.setBusFx("tracks", fx);
    const inserted = !!(PPFx.busChain("tracks") && PPFx.busChain("tracks").inserted);
    fx.on = false; PPFx.setBusFx("tracks", fx); return { inserted, after: PPFx.busChain("tracks").inserted };
  });
  assert.ok(r.inserted); assert.equal(r.after, false);
});
await check("the effects are saved with the song and come back after a restart (no new render)", async () => {
  await T(() => PP.persistNow());
  await page.reload(); await page.waitForFunction(() => window.__test && window.PPTracks && window.PPFx);
  await T(() => { const p = PP.project(), i = p.songs.findIndex((s) => s.name === "FX Test"); PPFeatures.loadSong(i); });
  await until(() => T(() => PPTracks.song() && PPTracks.song().name === "FX Test"));
  const r = await T(async () => { const s = PPTracks.song(), st = PPTracks.data(s).stems[0], raw = await PPTracks.getStem(st.id), hit = await PPFx.stemFor(s, st, raw); return { on: st.fx.on, preset: st.fx.preset, cached: !!hit, renders: PPFx.stats().renders }; });
  assert.ok(r.on); assert.equal(r.preset, "Vocal stem"); assert.ok(r.cached, "rendered copy kept"); assert.equal(r.renders, 0);
});

console.log("\nPad effects:");
await T(() => { PPShell.showTab("pads"); PP.setPerformMode(true); PP.renderPerform(); });
await check("every pad gets an FX chip, plus FX for all pads", async () => {
  await until(() => T(() => document.querySelectorAll("#pfPads .fx-chip").length === PP.project().pads.length && !!document.querySelector('[data-fx-bus="pads"]')));
});
await check("tapping a pad's FX opens its panel and doesn't play the pad", async () => {
  await T(() => PP.engine.stop()); await wait(100);
  await page.click('#pfPads [data-fx-pad="1"]');
  const r = await T(() => ({ open: document.getElementById("fxDialog").open, title: document.querySelector("#fxDialog h3").textContent, playing: __test.playingIndex(), gate: !![...document.querySelectorAll("#fxDialog header")].find((h) => /Gate/.test(h.textContent)) }));
  assert.ok(r.open); assert.match(r.title, /Pad 2/); assert.equal(r.playing, -1); assert.equal(r.gate, false);
});
await check("a pad preset sets the pad's own chain (Warm pad)", async () => {
  await page.click('#fxDialog [data-fx-preset="Warm pad"]');
  const e = await T(() => PP.project().pads[1].effects);
  assert.equal(e.reverb.enabled, true); assert.equal(e.reverb.type, "hall"); assert.equal(e.reverb.wet, 35); assert.equal(e.eq.bands[4].gain, -3); assert.equal(e.eq.bands[1].gain, 2);
});
await check("the pad's compressor amount drives its compressor", async () => {
  await T(() => { const box = document.querySelector('#fxDialog [data-fx="comp.on"]'); box.checked = true; box.dispatchEvent(new Event("change", { bubbles: true })); const r = document.querySelector('#fxDialog [data-fx="comp.amount"]'); r.value = 80; r.dispatchEvent(new Event("input", { bubbles: true })); });
  const c = await T(() => PP.project().pads[1].effects.compressor);
  assert.equal(c.enabled, true); assert.ok(c.threshold <= -20, "threshold " + c.threshold); assert.ok(c.ratio >= 4, "ratio " + c.ratio);
});
await check("pads play with no tracks playing", async () => {
  await T(() => document.getElementById("fxDialog").close());
  await T(() => { PPTracks.stop(); PP.triggerPad(1); }); await wait(250);
  assert.equal(await T(() => __test.playingIndex()), 1); assert.equal(await T(() => PPTracks.isPlaying()), false);
  await T(() => PP.engine.stop());
});
await check("the pads bus chain sits between the pads and the mix", async () => {
  await page.screenshot({ path: process.env.FX_SHOT || "/tmp/fx-perform.png" });
  await T(() => document.querySelector('.pf-side [data-fx-bus="pads"]').click());
  await T(() => { const box = document.querySelector('#fxDialog [data-fx="on"]'); box.checked = true; box.dispatchEvent(new Event("change", { bubbles: true })); });
  assert.ok(await T(() => !PPFx.busChain("pads") || !PPFx.busChain("pads").inserted), "on, but nothing to do: not in the way");
  await T(() => { const box = document.querySelector('#fxDialog [data-fx="comp.on"]'); box.checked = true; box.dispatchEvent(new Event("change", { bubbles: true })); });
  assert.ok(await T(() => PPFx.busChain("pads") && PPFx.busChain("pads").inserted));
  await T(() => { const box = document.querySelector('#fxDialog [data-fx="on"]'); box.checked = false; box.dispatchEvent(new Event("change", { bubbles: true })); document.getElementById("fxDialog").close(); });
  assert.equal(await T(() => PPFx.busChain("pads").inserted), false);
});
await check("no page errors", () => assert.deepEqual(errors, []));

await browser.close();
if (failures) { console.error("\n" + failures + " failed"); process.exit(1); }
console.log("\nall passed");
