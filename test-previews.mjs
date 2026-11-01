#!/usr/bin/env node
/**
 * Central Pedal / Central Pedal Control / Central Control / Central Usage - Listen before you download (10.2), in real
 * headless Chromium. The website, the published library list and the previews themselves are stood in (Playwright
 * routes - no ports used):
 *   * Settings → Packages → Libraries: each library's previews (pads, loop sets, loops, instruments, presets, IRs) in a
 *     "Listen" fold, and the other plans' libraries with theirs - to hear before buying;
 *   * a Listen button streams the preview (nothing is downloaded or installed): it turns into Stop with the time left,
 *     another one stops it (one at a time, everywhere), Stop stops it; a preview that isn't there says so;
 *   * the whole app (index.html): the pad editor's "Hear the Central Pads styles", the Instrument page's "Hear more
 *     sounds" (only sounds not playable here), and Central Tracks' rows (the hymns' own previews with no server set);
 *   * the website keeps an exact copy of js/previews.js (server/public/previews.js).
 *     node test-previews.mjs
 */
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import assert from "node:assert/strict";

const here = path.dirname(fileURLToPath(import.meta.url));
let failures = 0;
async function check(label, fn) {
  try { await fn(); console.log("  ✓ " + label); }
  catch (error) { failures++; console.error("  ✗ " + label + "\n      " + (error && error.message ? error.message.split("\n").slice(0, 10).join("\n      ") : error)); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const url = (p) => "file://" + path.join(here, p).split(path.sep).map(encodeURIComponent).join("/");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pp-prev-"));
const future = new Date(Date.now() + 200 * 864e5).toISOString();

// a 3-second WAV the stand-in serves for every preview (the browser plays it; the name says .mp3 - like the real ones)
function wav(seconds = 3, f = 330) {
  const rate = 22050, n = Math.round(seconds * rate), b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVE", 8); b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(2 * Math.PI * f * i / rate) * 8000), 44 + i * 2);
  return b;
}
const AUDIO = wav();
const P = (kind, name, extra) => Object.assign({ kind, name, url: "https://cdn.test/preview--" + kind + "--" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-") + ".mp3", seconds: 30 }, extra || {});
const LIST = { source: "index", libraries: [
  { id: "central-keys-library", plan: "keys", planName: "Central Keys", title: "Central Keys Library", version: "1.2", file: "central-keys-library-1.2.zip", size: 150e6, sha256: "a".repeat(64), url: "https://cdn.test/k.zip", ready: true, summary: "Pianos and more.",
    previews: [P("sound", "Central Keys Grand Pianos", { preset: "Concert Grand (Stei" }), P("sound", "Central Keys Synths", { preset: "Saw Lead" }), P("sound", "Central Keys Pads", { preset: "Warm Pad" }), P("preset", "Upright Ballad")] },
  { id: "central-pads-library", plan: "pads", planName: "Central Pads", title: "Central Pads Library", version: "1.2", file: "central-pads-library-1.2.zip", size: 2e8, sha256: "e".repeat(64), url: "https://cdn.test/p.zip", ready: true,
    previews: [P("pad", "Warm"), P("pad", "Air"), P("pad", "Choir Aah"), P("loops", "Ambient loops", { set: "ambient" }), P("loop", "Sparkle", { set: "ambient" })] },
  { id: "central-pedals-library", plan: "pedals", planName: "Central Pedals", title: "Central Pedals Library", version: "1.2", file: "central-pedals-library-1.2.zip", size: 2e5, sha256: "d".repeat(64), url: "https://cdn.test/d.zip", ready: true,
    previews: [P("ir", "Central 2x12 Worship Smooth"), P("ir", "Central Missing Cab")] },
] };
async function routes(page, served) {
  await page.route("https://cdn.test/**", (route) => {
    const u = route.request().url(); served.push(u);
    if (/missing/.test(u)) return route.fulfill({ status: 404, body: "no" });
    route.fulfill({ status: 200, contentType: "audio/wav", headers: { "Access-Control-Allow-Origin": "*", "Accept-Ranges": "bytes" }, body: AUDIO });
  });
  await page.route("https://github.com/**", (route) => { served.push(route.request().url()); route.fulfill({ status: 200, contentType: "audio/wav", body: AUDIO }); });
  await page.route("http://website.test/**", (route) => {
    const u = new URL(route.request().url());
    const body = u.pathname === "/v1/libraries" ? LIST : u.pathname === "/v1/package/check" ? { packages: [{ key: "SABC-DEFG-HJKL-MNPQ", ok: true, plans: { keys: future, pads: future }, end: future }] } : {};
    route.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(body) });
  });
}
function settingsPage(name, extra) {
  const f = path.join(tmp, name + ".html");
  fs.writeFileSync(f, `<!doctype html><meta charset="utf-8"><body><div id="set"></div>
<script>${extra || ""}
var L = {}; window.PPFeatures = { on: function (t, f) { (L[t] = L[t] || []).push(f); }, emit: function (m) { (L[m.type] || []).forEach(function (f) { f(m); }); } };
window.PPInstrument = { syncLibraries: function () { } };</script>
<script src="${url("js/license.js")}"></script><script src="${url("js/pedals.js")}"></script><script src="${url("js/previews.js")}"></script><script src="${url("js/libraries.js")}"></script>`);
  return "file://" + f;
}

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
try {
  console.log("Settings → Packages → Libraries:");
  const page = await browser.newPage(), served = [], errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  await routes(page, served);
  await page.route("http://127.0.0.1:8766/**", (route) => route.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify({ available: true, installed: [], jobs: {} }) }));
  await page.addInitScript((pk) => { localStorage.setItem("cc-packages", JSON.stringify([pk])); }, { key: "SABC-DEFG-HJKL-MNPQ", plans: { keys: future, pads: future }, okAt: Date.now(), ok: true });
  await page.goto(settingsPage("pedal", `window.PP_LICENSE_CONFIG = { server: "http://website.test", required: true }; window.__pedalBridge = { connected: true, info: { deviceId: "pedal-0123456789ab" }, send: function () { return true; } };`));
  await page.evaluate(() => { PPLicense.init({ app: "pedal", packages: JSON.parse(localStorage.getItem("cc-packages")) }); document.getElementById("set").innerHTML = PPLicense.settingsHtml(); });
  await page.waitForFunction(() => document.querySelectorAll("#libSettings li[data-lib]").length > 0, null, { timeout: 8000 });

  await check("each library of this device's plans has its previews in a Listen fold, grouped (pads, loop sets, loops, instruments, presets)", async () => {
    const t = await page.evaluate(() => { const li = document.querySelector('#libSettings li[data-lib="central-pads-library"]'), k = document.querySelector('#libSettings li[data-lib="central-keys-library"]'); return { pads: li && li.querySelector(".pv-list summary").textContent, groups: li ? Array.from(li.querySelectorAll(".pv-group b")).map((b) => b.textContent) : [], keys: k ? Array.from(k.querySelectorAll(".pv-name")).map((b) => b.textContent) : [], n: document.querySelectorAll("#libSettings [data-pv]").length }; });
    assert.match(t.pads, /Listen before you download \(5 previews, 30 seconds each\)/);
    assert.deepEqual(t.groups, ["Pads", "Loop sets", "Loops"]);
    assert.deepEqual(t.keys, ["Concert Grand (Stei", "Saw Lead", "Warm Pad", "Upright Ballad"]);
  });
  await check("the other plans' libraries are there to hear before buying (Central Pedals here, with its IRs)", async () => {
    const t = await page.evaluate(() => { const li = document.querySelector('#libSettings li[data-lib-other="central-pedals-library"]'); return li ? { text: li.textContent, n: li.querySelectorAll("[data-pv]").length } : null; });
    assert.ok(t, "no row for the other plan"); assert.match(t.text, /comes with Central Pedals/); assert.equal(t.n, 2);
  });
  await check("Listen streams the preview (nothing installs): the button turns into Stop with the time left", async () => {
    const calls = served.length;
    await page.click('#libSettings li[data-lib="central-pads-library"] .pv-list summary');
    await page.click('#libSettings [data-pv$="preview--pad--warm.mp3"]');
    await page.waitForFunction(() => /Stop \d:\d\d/.test(document.querySelector('[data-pv$="preview--pad--warm.mp3"]').textContent), null, { timeout: 6000 });
    assert.equal(await page.evaluate(() => PPPreview.playing()), "https://cdn.test/preview--pad--warm.mp3");
    assert.ok(served.slice(calls).some((u) => /pad--warm/.test(u)), "the preview wasn't asked for");
    assert.equal(await page.evaluate(() => document.querySelector('[data-pv$="preview--pad--warm.mp3"]').getAttribute("aria-pressed")), "true");
  });
  await check("one at a time: another Listen stops the first; Stop stops it", async () => {
    await page.click('#libSettings [data-pv$="preview--pad--air.mp3"]');
    await page.waitForFunction(() => PPPreview.playing().indexOf("pad--air") > 0 && !/Stop/.test(document.querySelector('[data-pv$="preview--pad--warm.mp3"]').textContent), null, { timeout: 6000 });
    await page.click('#libSettings [data-pv$="preview--pad--air.mp3"]');
    await page.waitForFunction(() => PPPreview.playing() === "" && /Listen/.test(document.querySelector('[data-pv$="preview--pad--air.mp3"]').textContent), null, { timeout: 4000 });
  });
  await check("a preview that isn't published yet says so on its button (and comes back to Listen)", async () => {
    await page.click('#libSettings li[data-lib-other="central-pedals-library"] .pv-list summary');
    await page.click('#libSettings [data-pv$="central-missing-cab.mp3"]');
    await page.waitForFunction(() => /No preview yet/.test(document.querySelector('[data-pv$="central-missing-cab.mp3"]').textContent), null, { timeout: 6000 });
    assert.equal(await page.evaluate(() => PPPreview.playing()), "");
  });
  await check("a redraw while one plays keeps its button showing Stop", async () => {
    await page.click('#libSettings [data-pv$="preview--pad--choir-aah.mp3"]');
    await page.waitForFunction(() => /Stop/.test(document.querySelector('[data-pv$="preview--pad--choir-aah.mp3"]').textContent), null, { timeout: 6000 });
    await page.evaluate(() => { const el = document.getElementById("libSettings"); el.outerHTML = PPLibraries.html(el.className); });
    await page.click('#libSettings li[data-lib="central-pads-library"] .pv-list summary');
    await page.waitForFunction(() => /Stop/.test(document.querySelector('[data-pv$="preview--pad--choir-aah.mp3"]').textContent), null, { timeout: 3000 });
    await page.evaluate(() => PPPreview.stop());
  });
  await check("PPPreview.find: an instrument by its (cut) preset name, a pad by name", async () => {
    const r = await page.evaluate((list) => ({ grand: (PPPreview.forItem(list.libraries, "sound", "Central Keys Grand Pianos", "Concert Grand (Steinway B)") || {}).url, warm: (PPPreview.forItem(list.libraries, "pad", "warm") || {}).url, none: PPPreview.forItem(list.libraries, "pad", "Nope") }), LIST);
    assert.match(r.grand, /concert-grand|central-keys-grand-pianos/); assert.match(r.warm, /pad--warm/); assert.equal(r.none, null);
  });
  await check("no page errors", async () => assert.deepEqual(errs, []));
  await page.close();

  console.log("The whole app (index.html):");
  const app = await browser.newPage(), served2 = [], errs2 = [];
  app.on("pageerror", (e) => errs2.push(String(e)));
  await routes(app, served2);
  await app.route("http://127.0.0.1:8766/**", (route) => {
    const u = new URL(route.request().url()), j = (o, s) => route.fulfill({ status: s || 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(o) });
    if (u.pathname === "/libraries/index") return j({ ok: true, source: "release", libraries: LIST.libraries });
    if (u.pathname === "/libraries") return j({ available: true, installed: [], jobs: {} });
    j({ error: "not here" }, 404);
  });
  await app.goto("file://" + path.join(here, "index.html"));
  await app.waitForFunction(() => window.PPLibraries && window.PPPreview && window.PPInstrument && window.PPCentralTracks, null, { timeout: 15000 });
  await app.evaluate((pk) => { PPLicense.init({ app: "pedal", packages: [pk] }); return PPLibraries.load(true); }, { key: "SABC-DEFG-HJKL-MNPQ", plans: { keys: future, pads: future }, okAt: Date.now(), ok: true });   // (the Central Pedal: its installer lists the published libraries)
  await check("the pad editor: Hear the Central Pads styles, 30 seconds each, before downloading them", async () => {
    await app.evaluate(() => window.dispatchEvent(new CustomEvent("pp-plans")));
    await app.waitForFunction(() => document.querySelectorAll("#voiceHear [data-pv]").length === 3, null, { timeout: 8000 });
    const t = await app.evaluate(() => document.querySelector("#voiceHear summary").textContent);
    assert.match(t, /Hear the Central Pads styles/);
  });
  await check("the Instrument page: Hear more sounds - only the sound plans' instruments that can't play here yet", async () => {
    const r = await app.evaluate(() => { PPInstrument.setKind("keys"); PPInstrument.render(); const d = document.querySelector(".keys-hear"); return d ? { names: Array.from(d.querySelectorAll(".pv-name")).map((x) => x.firstChild.textContent.trim()), n: d.querySelectorAll("[data-pv]").length } : null; });
    assert.ok(r, "no Hear more sounds fold");
    assert.ok(r.names.includes("Saw Lead") && r.names.includes("Concert Grand (Stei"), JSON.stringify(r));
  });
  await check("Central Tracks (no server set): each hymn has a Listen button with its own preview from the release", async () => {
    await app.evaluate(() => PPCentralTracks.render());
    await wait(300);
    const html = await app.evaluate(() => PPCentralTracks.render());
    const urls = Array.from(html.matchAll(/data-pv="([^"]+)"/g)).map((m) => m[1]);
    assert.ok(urls.length >= 5, html.slice(0, 300));
    assert.ok(urls.includes("https://github.com/MotionAudio/Central-Apps/releases/download/central-tracks/amazing-grace--amazing-grace-preview.mp3"), urls.join(" "));
  });
  await check("no page errors in the app", async () => assert.deepEqual(errs2.filter((e) => !/AudioContext|NotAllowedError|play\(\)/.test(e)), []));
  await app.close();

  console.log("The website:");
  await check("the website keeps an exact copy of js/previews.js (server/public/previews.js)", async () => {
    assert.equal(fs.readFileSync(path.join(here, "server/public/previews.js"), "utf8"), fs.readFileSync(path.join(here, "js/previews.js"), "utf8"));
  });
} finally {
  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(failures ? "\n" + failures + " FAILED" : "\nall passed");
process.exit(failures ? 1 : 0);
