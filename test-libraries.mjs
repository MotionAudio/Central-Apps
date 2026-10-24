#!/usr/bin/env node
/**
 * Central Pedal / Central Control / Central Usage - the Libraries panel (Settings → Packages → Libraries, 9.8) in real
 * headless Chromium, with the website and the Central Pedal's driver stood in (Playwright routes - no ports used):
 *   * the libraries of the plans this device has, from /v1/libraries (the others named below);
 *   * Install on the Central Pedal: the driver gets the url, sha256 and size from the list; progress; installed;
 *     the Instrument page is told (its presets and boards); Update when a newer version is listed; Remove;
 *     Install from a file… (checked against the listed sha256 when the file is named as a listed library);
 *   * on a computer the same through the app (window.CU.libraries); with no website the built-in list (not installable
 *     from the list - Install from a file…);
 *   * the Instrument page: a library's presets and boards keep its plan (locked without it, open with it), its banks
 *     keep their plan even in the user folder, a board's IR is found by name and keeps its plan; a new version replaces
 *     them, a removed library takes them away.
 *     node test-libraries.mjs
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pp-libs-"));
const future = new Date(Date.now() + 200 * 864e5).toISOString();
const SHA = { keys: "a".repeat(64), pedals: "d".repeat(64), plugins: "c".repeat(64), instrument: "b".repeat(64) };
const LIST = { source: "index", libraries: [
  { id: "central-keys-library", plan: "keys", planName: "Central Keys", title: "Central Keys Library", version: "1.1", file: "central-keys-library-1.1.zip", size: 150e6, sha256: SHA.keys, url: "https://cdn.test/central-keys-library-1.1.zip", ready: true, summary: "Pianos" },
  { id: "central-pedals-library", plan: "pedals", planName: "Central Pedals", title: "Central Pedals Library", version: "1.0", file: "central-pedals-library-1.0.zip", size: 2e5, sha256: SHA.pedals, url: "https://cdn.test/central-pedals-library-1.0.zip", ready: true, summary: "IRs" },
  { id: "central-plugins-library", plan: "plugins", planName: "Central Plugins", title: "Central Plugins Library", version: "1.0", file: "central-plugins-library-1.0.zip", size: 1e5, sha256: SHA.plugins, url: "https://cdn.test/p.zip", ready: true },
  { id: "central-instrument-library", plan: "instrument", planName: "Central Instrument", title: "Central Instrument Library", version: "1.0", file: "central-instrument-library-1.0.zip", size: 1e8, sha256: SHA.instrument, url: "https://cdn.test/i.zip", ready: true },
] };

function settingsPage(name, extra) {
  const f = path.join(tmp, name + ".html");
  fs.writeFileSync(f, `<!doctype html><meta charset="utf-8"><body><div id="set"></div>
<script>${extra || ""}
var L = {}; window.PPFeatures = { on: function (t, f) { (L[t] = L[t] || []).push(f); }, emit: function (m) { (L[m.type] || []).forEach(function (f) { f(m); }); } };
window.__synced = []; window.__events = 0; window.PPInstrument = { syncLibraries: function (list) { window.__synced.push(JSON.parse(JSON.stringify(list))); } };
window.addEventListener("pp-libraries", function () { window.__events++; });</script>
<script src="${url("js/license.js")}"></script><script src="${url("js/pedals.js")}"></script><script src="${url("js/libraries.js")}"></script>`);
  return "file://" + f;
}
const browser = await chromium.launch();
try {
  // ------------------------------------------------------------- the Central Pedal: through its driver
  console.log("Libraries on the Central Pedal (its driver):");
  const page = await browser.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  const driver = { installed: [{ id: "central-keys-library", plan: "keys", version: "1.0", title: "Central Keys Library", counts: { sound: 3, preset: 12 }, presets: [{ name: "Upright Ballad", kind: "keys", chain: [["dfly-hall", {}]], library: "central-keys-library", tier: "keys" }], boards: [] }], jobs: {}, calls: [] };
  await page.route("http://website.test/**", (route) => {
    const u = new URL(route.request().url());
    const body = u.pathname === "/v1/libraries" ? LIST : u.pathname === "/v1/package/check" ? { packages: [{ key: "SABC-DEFG-HJKL-MNPQ", ok: true, plans: { keys: future, pedals: future }, end: future }] } : {};
    route.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(body) });
  });
  let polls = 0;
  await page.route("http://127.0.0.1:8766/**", async (route) => {
    const req = route.request(), u = new URL(req.url()), j = (o, s) => route.fulfill({ status: s || 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(o) });
    driver.calls.push({ method: req.method(), path: u.pathname, query: Object.fromEntries(u.searchParams), body: req.method() === "POST" ? req.postDataJSON() : req.method() === "PUT" ? (req.postDataBuffer() || Buffer.alloc(0)).length : null });
    if (u.pathname === "/libraries") {
      const job = driver.jobs["central-pedals-library"];
      if (job && ++polls >= 2) { driver.jobs = { "central-pedals-library": { state: "done", version: "1.0" } }; driver.installed.push({ id: "central-pedals-library", plan: "pedals", version: "1.0", title: "Central Pedals Library", counts: { ir: 14, board: 14 }, boards: [{ name: "Pedals: Edge", kind: "electric", chain: [["ir-cab", {}, { ir: "Central 1x12 Open Back" }]] }], presets: [] }); }
      return j({ available: true, installed: driver.installed, jobs: driver.jobs });
    }
    if (u.pathname === "/libraries/install") { driver.jobs = { "central-pedals-library": { state: "downloading", done: 1000, total: 200000 } }; return j({ ok: true, started: true }); }
    if (u.pathname === "/libraries/remove") { driver.installed = driver.installed.filter((x) => x.id !== req.postDataJSON().id); return j({ ok: true, installed: driver.installed }); }
    if (u.pathname === "/libraries/file") return j({ ok: true, record: { id: "central-keys-library", version: "1.1" }, installed: driver.installed });
    j({ error: "unknown" }, 404);
  });
  await page.addInitScript((pk) => { localStorage.setItem("cc-packages", JSON.stringify([pk])); }, { key: "SABC-DEFG-HJKL-MNPQ", plans: { keys: future, pedals: future }, okAt: Date.now(), ok: true });
  await page.goto(settingsPage("pedal", `window.PP_LICENSE_CONFIG = { server: "http://website.test", required: true }; window.__pedalBridge = { connected: true, info: { deviceId: "pedal-0123456789ab" }, send: function () { return true; } };`));
  await page.evaluate(() => { PPLicense.init({ app: "pedal", packages: JSON.parse(localStorage.getItem("cc-packages")) }); document.getElementById("set").innerHTML = PPLicense.settingsHtml(); });
  await page.waitForFunction(() => document.querySelectorAll("#libSettings li[data-lib]").length > 0, null, { timeout: 5000 });
  const R = (fn, arg) => page.evaluate(fn, arg);
  await check("Settings → Packages has a Libraries panel with the libraries of this device's plans (Central Keys, Central Pedals); the others are named", async () => {
    const r = await R(() => ({ ids: [...document.querySelectorAll("#libSettings li[data-lib]")].map((e) => e.dataset.lib), text: document.getElementById("libSettings").textContent, under: !!document.querySelector("#pkgSettings + #libSettings") }));
    assert.deepEqual(r.ids, ["central-keys-library", "central-pedals-library"]); assert.ok(/With other plans: Central Plugins Library/.test(r.text) && r.under, r.text);
  });
  await check("installed 1.0 with 1.1 listed: Update to 1.1 and Remove; the Instrument page was given the installed presets", async () => {
    const r = await R(() => ({ upd: (document.querySelector('[data-lib-install="central-keys-library"]') || {}).textContent, rm: !!document.querySelector('[data-lib-remove="central-keys-library"]'), synced: window.__synced.pop() }));
    assert.equal(r.upd, "Update to 1.1"); assert.ok(r.rm); assert.equal(r.synced[0].presets[0].name, "Upright Ballad");
  });
  await check("Install: the driver gets the library's url, sha256 and size from the list; the download's progress shows; then it's installed and the Instrument page hears of its boards", async () => {
    await page.click('[data-lib-install="central-pedals-library"]');
    const call = driver.calls.filter((c) => c.path === "/libraries/install").pop();
    assert.deepEqual(call.body, { id: "central-pedals-library", url: "https://cdn.test/central-pedals-library-1.0.zip", sha256: SHA.pedals, size: 2e5 });
    await page.waitForFunction(() => /is installed/.test(document.getElementById("libSettings").textContent), null, { timeout: 6000 });
    const r = await R(() => ({ text: document.querySelector('#libSettings li[data-lib="central-pedals-library"]').textContent, synced: window.__synced[window.__synced.length - 1], ev: window.__events }));
    assert.ok(/Installed · version 1\.0/.test(r.text) && /14 impulse responses/.test(r.text), r.text);
    assert.ok(r.synced.some((l) => l.id === "central-pedals-library" && l.boards[0].name === "Pedals: Edge") && r.ev > 0);
  });
  await check("Install from a file…: the zip goes to the driver, with the listed sha256 when it's named as a listed library", async () => {
    const fileZip = path.join(tmp, "central-keys-library-1.1.zip"); fs.writeFileSync(fileZip, Buffer.from("PK fake zip"));
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click("[data-lib-file]")]);
    await chooser.setFiles(fileZip); await wait(400);
    const call = driver.calls.filter((c) => c.path === "/libraries/file").pop();
    assert.ok(call && call.method === "PUT" && call.query.sha256 === SHA.keys && call.query.name === "central-keys-library-1.1.zip" && call.body > 0, JSON.stringify(call));
    assert.ok(/Installed from the file \(version 1\.1\)/.test(await page.textContent("#libSettings")));
  });
  await check("Remove: the driver takes it away and the Instrument page is told (its boards go)", async () => {
    await page.click('[data-lib-remove="central-pedals-library"]'); await wait(300);
    const r = await R(() => ({ text: document.getElementById("libSettings").textContent, synced: window.__synced[window.__synced.length - 1] }));
    assert.ok(/was removed/.test(r.text) && !r.synced.some((l) => l.id === "central-pedals-library"), r.text);
  });
  await check("no page errors", async () => { assert.deepEqual(errs, []); });

  // ------------------------------------------------------------- a computer: through the app
  console.log("\nLibraries on a computer (the app installs them):");
  const p2 = await browser.newPage();
  await p2.route("http://website.test/**", (route) => route.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(new URL(route.request().url()).pathname === "/v1/libraries" ? LIST : { packages: [] }) }));
  await p2.goto(settingsPage("computer", `window.PP_LICENSE_CONFIG = { server: "http://website.test", required: false };
    window.__cu = []; var inst = []; window.CU = { libraries: { list: function () { return Promise.resolve({ ok: true, installed: inst }); },
      install: function (l) { window.__cu.push(["install", l]); inst = [{ id: l.id, plan: "plugins", version: "1.0", title: "Central Plugins Library", counts: { board: 11 }, boards: [], presets: [] }]; return Promise.resolve({ ok: true, installed: inst, record: { id: l.id, version: "1.0" } }); },
      installFile: function (o) { window.__cu.push(["file", o]); return Promise.resolve({ ok: false, error: "that isn't a library file (a .zip from the Downloads page)", installed: inst }); },
      remove: function (id) { window.__cu.push(["remove", id]); inst = []; return Promise.resolve({ ok: true, installed: inst }); } } };`));
  await p2.evaluate(() => { PPLicense.init({ app: "usage" }); document.getElementById("set").innerHTML = PPLicense.packagesHtml(); });
  await p2.waitForFunction(() => document.querySelectorAll("#libSettings li[data-lib]").length === 4, null, { timeout: 5000 });
  await check("licensing off (no keys needed yet): every library is listed", async () => { assert.equal(await p2.evaluate(() => document.querySelectorAll("#libSettings li[data-lib]").length), 4); });
  await check("Install goes through the app (window.CU.libraries) with the url and sha256; the Instrument frame is told", async () => {
    await p2.click('[data-lib-install="central-plugins-library"]'); await wait(200);
    const r = await p2.evaluate(() => ({ cu: window.__cu, ev: window.__events, text: document.getElementById("libSettings").textContent }));
    assert.deepEqual(r.cu[0], ["install", { id: "central-plugins-library", url: "https://cdn.test/p.zip", sha256: SHA.plugins, size: 1e5 }]);
    assert.ok(r.ev > 0 && /Central Plugins Library 1\.0 is installed/.test(r.text), r.text);
  });
  await check("Install from a file… asks the app (which opens the file dialog), with the listed checksums by file name; its error shows", async () => {
    await p2.click("[data-lib-file]"); await wait(200);
    const r = await p2.evaluate(() => ({ cu: window.__cu.pop(), text: document.getElementById("libSettings").textContent }));
    assert.equal(r.cu[0], "file"); assert.equal(r.cu[1].byFile["central-keys-library-1.1.zip"], SHA.keys); assert.ok(/isn't a library file/.test(r.text));
  });

  // ------------------------------------------------------------- no website yet
  console.log("\nNo website yet:");
  const p3 = await browser.newPage();
  await p3.goto(settingsPage("offline", `window.PP_LICENSE_CONFIG = { server: "", required: true }; window.CU = { libraries: { list: function () { return Promise.resolve({ installed: [] }); } } };`));
  await p3.evaluate(() => { PPLicense.init({ app: "control" }); document.getElementById("set").innerHTML = PPLicense.packagesHtml(); });
  await p3.waitForFunction(() => document.querySelectorAll("#libSettings li[data-lib]").length === 4, null, { timeout: 5000 });
  await check("the built-in list: the four libraries, not installable from the list (Install from a file…)", async () => {
    const r = await p3.evaluate(() => ({ dis: [...document.querySelectorAll("[data-lib-install]")].every((b) => b.disabled), n: document.querySelectorAll("[data-lib-install]").length, text: document.getElementById("libSettings").textContent, file: !!document.querySelector("[data-lib-file]") }));
    assert.ok(r.n === 4 && r.dis && r.file && /Not published yet/.test(r.text) && /Install from a file/.test(r.text), r.text);
  });

  // ------------------------------------------------------------- the Instrument page
  console.log("\nThe Instrument page (a library's presets, boards, banks and IRs keep its plan):");
  const f4 = path.join(tmp, "instrument.html");
  fs.writeFileSync(f4, `<!doctype html><meta charset="utf-8"><body><div id="instrumentRoot"></div><div id="status"></div>
<script src="${url("central-usage/app/instrument-shim.js")}"></script><script src="${url("js/pedals.js")}"></script><script src="${url("js/instrument.js")}"></script>`);
  const p4 = await browser.newPage(); const e4 = []; p4.on("pageerror", (e) => e4.push(String(e)));
  await p4.goto("file://" + f4);
  const plans = (list) => p4.evaluate((l) => new Promise((res) => { window.postMessage({ cu: "inst", msg: { type: "plans", on: true, plans: l } }, "*"); setTimeout(res, 50); }), list);
  await plans({});
  await p4.evaluate(() => PPFeatures.emit({ type: "instrumentStatus", available: true, running: true, inputs: [], midiInputs: [],
    keysCatalog: [{ file: "/u/sf2/Central Keys Pianos - central-keys-pianos.sf2", name: "Central Keys Pianos", user: true, tier: "keys", presets: [{ bank: 0, prog: 0, name: "Upright Piano" }] }, { file: "/u/sf2/Mine.sf2", name: "Mine", user: true, presets: [{ bank: 0, prog: 0, name: "My Pad" }] }],
    irs: [{ name: "Central 1x12 Open Back", file: "/u/ir/Central 1x12 Open Back.wav", tier: "pedals" }, { name: "my ir", file: "/u/ir/my ir.wav" }] }));
  const LIBS = [{ id: "central-keys-library", plan: "keys", version: "1.0", presets: [{ name: "Upright Ballad", kind: "keys", chain: [["dfly-hall", { Decay: 2.4 }]], sound: "upright piano" }], boards: [] },
    { id: "central-pedals-library", plan: "pedals", version: "1.0", presets: [], boards: [{ name: "Pedals: Edge Delay 1x12", kind: "electric", chain: [["ts9", { Drive: 0.25 }], ["ir-cab", {}, { ir: "Central 1x12 Open Back" }]] }] }];
  await p4.evaluate((l) => window.postMessage({ cu: "inst", msg: { type: "libraries", libraries: l } }, "*"), LIBS); await wait(100);
  const B = () => p4.evaluate(() => PPInstrument.config().custom.filter((b) => b.library).map((b) => ({ id: b.id, name: b.name, plans: b.plans, lib: b.library, v: b.libraryVersion, locked: PPPedals.boardLocked(b) })));
  await check("the libraries' presets and boards arrive (through the frame's message) as your boards, each with its library's plan, locked without it", async () => {
    const b = await B();
    assert.deepEqual(b.map((x) => [x.name, x.plans, x.locked]), [["Upright Ballad", ["keys"], true], ["Pedals: Edge Delay 1x12", ["pedals"], true]]);
  });
  await check("a library's bank in the user folder keeps its plan (locked, listed by kind not as yours); the musician's own bank stays theirs and free", async () => {
    const r = await p4.evaluate(() => PPInstrument.catalog().keys.map((s) => ({ name: s.name, user: s.user, tier: PPPedals.soundTier(s), locked: !PPPedals.has(PPPedals.soundTier(s)) })));
    const lib = r.find((s) => s.name === "Upright Piano"), mine = r.find((s) => s.name === "My Pad");
    assert.ok(lib && !lib.user && lib.tier === "keys" && lib.locked, JSON.stringify(lib)); assert.ok(mine && mine.user && mine.tier === "free" && !mine.locked, JSON.stringify(mine));
  });
  await check("a board's IR is found by name, and locked without its plan; with Central Pedals it plays", async () => {
    const id = (await B())[1].id;
    await p4.evaluate((i) => PPInstrument.loadBoard("electric", i), id);
    const r = await p4.evaluate(() => PPInstrument.resolvedChain("electric").map((x) => ({ id: x.id, file: x.file, on: x.on, locked: !!x.locked })));
    assert.deepEqual(r.find((x) => x.id === "ir-cab"), { id: "ir-cab", file: "/u/ir/Central 1x12 Open Back.wav", on: false, locked: true });
    await plans({ keys: true, pedals: true });
    const r2 = await p4.evaluate(() => PPInstrument.resolvedChain("electric").find((x) => x.id === "ir-cab"));
    const b = await B();
    assert.ok(r2.on && !r2.locked && b.every((x) => !x.locked), JSON.stringify([r2, b]));
  });
  await check("a new version replaces its library's boards; one you deleted stays deleted until then; a removed library takes its boards away", async () => {
    await p4.evaluate(() => { var c = PPInstrument.config(); c.custom = c.custom.filter((b) => b.name !== "Upright Ballad"); });
    await p4.evaluate((l) => PPInstrument.syncLibraries(l), LIBS);
    let b = await B(); assert.deepEqual(b.map((x) => x.name), ["Pedals: Edge Delay 1x12"]);
    const v2 = JSON.parse(JSON.stringify(LIBS)); v2[0].version = "1.1"; v2[0].presets.push({ name: "Felt Upright Ambient", kind: "keys", chain: [["dfly-hall", {}]], sound: "soft upright" });
    await p4.evaluate((l) => PPInstrument.syncLibraries(l), v2);
    b = await B(); assert.deepEqual(b.map((x) => x.name + "@" + x.v).sort(), ["Felt Upright Ambient@1.1", "Pedals: Edge Delay 1x12@1.0", "Upright Ballad@1.1"]);
    await p4.evaluate((l) => PPInstrument.syncLibraries(l), [v2[0]]);
    b = await B(); assert.ok(!b.some((x) => x.lib === "central-pedals-library") && b.length === 2, JSON.stringify(b));
  });
  await check("no page errors on the Instrument page", async () => { assert.deepEqual(e4, []); });
} finally {
  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(failures ? "\n" + failures + " FAILED" : "\nALL LIBRARIES PANEL CHECKS PASSED");
process.exit(failures ? 1 : 0);
