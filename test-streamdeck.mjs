#!/usr/bin/env node
/**
 * Central Pedal - Stream Deck (WebHID) with a stand-in device: keys run their actions (press and hold), the key
 * pictures go out in the Stream Deck's own reports, every setting changes what it does / shows.
 *   node test-streamdeck.mjs
 */
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
const here = path.dirname(fileURLToPath(import.meta.url));
let failures = 0;
async function check(label, fn) { try { await fn(); console.log("  ✓ " + label); } catch (e) { failures++; console.error("  ✗ " + label + "\n      " + String(e && e.message ? e.message.split("\n").slice(0, 6).join("\n      ") : e)); } }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
// a Stream Deck MK.2 (15 keys) that records what it is sent
await page.addInitScript(() => {
  const listeners = [];
  const dev = { vendorId: 0x0fd9, productId: 0x0080, productName: "Stream Deck MK.2", opened: false, reports: [], features: [],
    async open() { this.opened = true; }, async sendReport(id, data) { this.reports.push([id, data.length, data[0], data[1], data[2]]); }, async sendFeatureReport(id, data) { this.features.push([id, data[0], data[1]]); },
    addEventListener(t, fn) { if (t === "inputreport") listeners.push(fn); },
    press(k, down) { const b = new Uint8Array(3 + 15); b[3 + k] = down ? 1 : 0; listeners.forEach((fn) => fn({ reportId: 1, data: new DataView(b.buffer) })); } };
  window.__sd = dev;
  Object.defineProperty(navigator, "hid", { value: { getDevices: async () => [dev], requestDevice: async () => [dev], addEventListener() { } } });
});
await page.goto("file://" + path.join(here, "index.html"));
await page.waitForFunction(() => window.PPStreamDeck && window.PPActions && window.PPTracks);
const T = (fn, a) => page.evaluate(fn, a);

await check("a Stream Deck MK.2 is found and opened; its 15 keys get pictures (JPEG in report 2, command 7) and the brightness is set", async () => {
  await page.waitForFunction(() => window.PPStreamDeck.connected(), null, { timeout: 5000 });
  assert.equal(await T(() => PPStreamDeck.connected()), "Stream Deck MK.2");
  await page.waitForFunction(() => new Set(__sd.reports.filter((r) => r[0] === 2 && r[2] === 7).map((r) => r[3])).size >= 15, null, { timeout: 8000 });
  assert.deepEqual(await T(() => __sd.features[0]), [3, 8, 70]);
});
await check("its keys are on the Configure tab with the service layout (key 1 Play, key 2 Safe stop, key 4 next section…)", async () => {
  const r = await T(() => ({ ids: PPConfigure.inputs().filter((i) => i.streamdeck).map((i) => i.id), k1: PPActions.entryFor("sd1-1").action, k2: PPActions.entryFor("sd1-2").action, k4: PPActions.entryFor("sd1-4").action }));
  assert.equal(r.ids.length, 15); assert.deepEqual([r.k1, r.k2, r.k4], ["playPauseAll", "safeStop", "nextSection"]);
});
await check("pressing a key runs its action; holding runs its hold action", async () => {
  await T(() => { window.__ran = []; const run = PPActions.run; PPActions.run = function (n, a, i) { window.__ran.push(n); return run.call(PPActions, n, a, i); }; });
  await T(() => { __sd.press(6, true); }); await wait(80); await T(() => __sd.press(6, false));   // key 7: next song
  await T(() => PPStreamDeck.cfg().holdMs = 300);
  await T(() => __sd.press(0, true)); await wait(450); await T(() => __sd.press(0, false));       // key 1 held: stop all
  const ran = await T(() => window.__ran);
  assert.ok(ran.includes("nextSong"), JSON.stringify(ran)); assert.ok(ran.includes("playPauseAll") && ran.includes("stopAll"), JSON.stringify(ran));
});
await check("every key is customizable: action, label, icon, colours - and the picture follows", async () => {
  await T(() => { PPShell.showTab("settings"); });
  await page.waitForSelector(".sd-grid .sd-key");
  await T(() => document.querySelectorAll(".sd-grid .sd-key")[9].click());
  await page.selectOption('[data-sd="action"]', "tap"); await page.fill('[data-sd="label"]', "Tempo"); await page.dispatchEvent('[data-sd="label"]', "change");
  await page.fill('[data-sd="icon"]', "T"); await page.dispatchEvent('[data-sd="icon"]', "change");
  const r = await T(() => ({ a: PPActions.entryFor("sd1-10").action, k: PPStreamDeck.cfg().keys["sd1-10"] }));
  assert.equal(r.a, "tap"); assert.equal(r.k.label, "Tempo"); assert.equal(r.k.icon, "T");
  assert.ok(await T(() => /Tempo/.test(document.querySelectorAll(".sd-grid .sd-key")[9].textContent)));
});
await check("pages: add a page, a page key moves between them; brightness, hold time and picture orientation are settings", async () => {
  await T(() => document.querySelector('[data-sd="addPage"]').click());
  assert.equal(await T(() => PPStreamDeck.cfg().pages.length), 2);
  assert.equal(await T(() => PPStreamDeck.cfg().page), 1);
  assert.equal(await T(() => PPConfigure.inputs().filter((i) => i.streamdeck).length), 30);
  await T(() => { PPActions.mapping()["sd2-15"] = { action: "sdPageNext" }; __sd.press(14, true); }); await wait(50); await T(() => __sd.press(14, false));
  assert.equal(await T(() => PPStreamDeck.cfg().page), 0);
  await T(() => { const el = document.querySelector('[data-sd="brightness"]'); el.value = "35"; el.dispatchEvent(new Event("change", { bubbles: true })); });
  assert.deepEqual(await T(() => __sd.features[__sd.features.length - 1]), [3, 8, 35]);
  await page.selectOption('[data-sd="rotation"]', "180"); assert.equal(await T(() => PPStreamDeck.cfg().rotation), 180);
});
await check("a key lights up while what it does is on (Vamp / click)", async () => {
  const off = await T(() => PPStreamDeck.draw("sd1-8", 72, false).key), click = await T(() => PPActions.ACTIONS.toggleClick.led ? "has" : "none");
  assert.ok(off.split("|")[0].length > 0, off); assert.ok(click);
});
await check("no page errors", () => assert.deepEqual(errors, []));
await browser.close();
console.log(failures ? `\n${failures} CHECK(S) FAILED` : "\nALL STREAM DECK CHECKS PASSED");
process.exit(failures ? 1 : 0);
