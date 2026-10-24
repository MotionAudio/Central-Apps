#!/usr/bin/env node
/**
 * The factory test on a card built by hand, end to end: the real driver (simulated pins, knobs and small screen)
 * and the real app on HDMI 1. The test page opens by itself, footswitches and knobs pass as they're used (and don't
 * play anything), the small screen's test pattern, Save report, Finish - then the customer's first start (the pedal
 * unplugged): no test, no pairing question on HDMI (the code is picked on the phone).
 *   node test-factory.mjs [screenshot folder]
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import assert from "node:assert/strict";

const here = path.dirname(fileURLToPath(import.meta.url));
const shots = process.argv[2] || "";
if (shots) fs.mkdirSync(shots, { recursive: true });
let failures = 0;
async function check(label, fn) { try { await fn(); console.log("  ✓ " + label); } catch (e) { failures++; console.error("  ✗ " + label + "\n      " + String(e && e.message ? e.message.split("\n").slice(0, 6).join("\n      ") : e)); } }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 8000, every = 100) { const t0 = Date.now(); for (;;) { try { const v = await fn(); if (v) return v; } catch (_) { } if (Date.now() - t0 > ms) throw new Error("timed out waiting"); await wait(every); } }
const bootId = (() => { try { return fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim(); } catch (_) { return "boot"; } })();

function startDriver(tmp) {
  const d = spawn("python3", [path.join(here, "pedal-driver.py"), "--simulate", tmp, "--app-root", here], { stdio: ["ignore", "pipe", "pipe"], env: Object.assign({}, process.env, { CC_UPDATE_API: "http://127.0.0.1:9" }) });
  d.log = ""; d.stdout.on("data", (x) => { d.log += x; }); d.stderr.on("data", (x) => { d.log += x; });
  return d;
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pp-factory-"));
fs.writeFileSync(path.join(tmp, "factory.json"), JSON.stringify({ state: "factory", boot: bootId, started: Date.now() / 1000 }));   // (as the card's marker leaves it)
let driver = startDriver(tmp);
await until(() => /listening on ws/.test(driver.log), 15000);

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
const page = await ctx.newPage(); const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto("http://127.0.0.1:8766/app/#perform");
const T = (fn, arg) => page.evaluate(fn, arg);
const sim = (m) => T((m) => window.__pedalBridge.send(Object.assign({ type: "sim" }, m)), m);

console.log("The factory test (first start of a card built by hand):");
await check("the test opens by itself, full window on HDMI 1; no pairing question (the customer picks the code on the phone)", async () => {
  await page.waitForSelector("dialog#factoryTest[open] .ft-head", { timeout: 15000 });
  await until(() => T(() => document.querySelectorAll("#factoryTest .ft-key").length >= 12), 8000);
  await wait(800);
  assert.equal(await T(() => !!(document.getElementById("pinDialog") && document.getElementById("pinDialog").open)), false);
  assert.match(await page.textContent("#factoryTest"), /Footswitches/);
  assert.match(await page.textContent("#factoryTest"), /small touch screen/);
});
if (shots) await page.screenshot({ path: path.join(shots, "factory-1920.png"), fullPage: true });
await check("a footswitch press passes it (and plays nothing: the app's actions wait while the test is open)", async () => {
  await T(() => { window.__ran = 0; const o = PPActions.onControl; PPActions.onControl = function () { window.__ran++; return o.apply(this, arguments); }; });
  await sim({ sim: "press", id: "b1" }); await wait(150); await sim({ sim: "release", id: "b1" });
  await until(() => T(() => document.querySelector('#factoryTest .ft-key[data-ft-mark="in:b1"]').classList.contains("pass")), 4000);
  assert.equal(await T(() => window.__ran), 0);
});
await check("a knob passes once it has been all the way down and up; its bar follows", async () => {
  await sim({ sim: "knob", id: "k1", value: 0.0 }); await wait(400);
  await sim({ sim: "knob", id: "k1", value: 0.5 }); await wait(300);
  await until(() => T(() => parseFloat(document.querySelector('#factoryTest [data-bar="k1"]').style.width) > 30), 4000);
  await sim({ sim: "knob", id: "k1", value: 1.0 }); await wait(400);
  await until(() => T(() => /Pass/.test(document.querySelector('#factoryTest .ft-row[data-key="in:k1"] .ft-badge').textContent)), 4000);
});
await check("the small screen's test pattern: shown from here, and its corners count", async () => {
  await page.click('#factoryTest [data-ft="pattern"]');
  await until(() => T(() => PPFactory.status() && PPFactory.status().pattern), 4000);
  await until(() => T(() => /Hide/.test(document.querySelector('#factoryTest [data-ft="pattern"]').textContent)), 4000);
});
await check("the touch screen can be changed here (the catalog, then 'Use this screen and restart')", async () => {
  const n = await T(() => document.querySelectorAll("#ftScreen option").length);
  assert.ok(n > 20, "screens listed: " + n);
  assert.equal(await T(() => document.getElementById("ftScreen").value), await T(() => PPFactory.status().touchScreen), "the pedal's screen is picked");
});
await check("an output is marked by hand after playing it; Save report writes factory-report.json", async () => {
  await page.click('#factoryTest [data-ft-play="tracks"]');
  await page.click('#factoryTest [data-ft-mark="out:tracks"][data-v="pass"]');
  await page.click('#factoryTest [data-ft="save"]');
  await until(() => fs.existsSync(path.join(tmp, "factory-report.json")), 4000);
  const rep = JSON.parse(fs.readFileSync(path.join(tmp, "factory-report.json"), "utf8"));
  assert.equal(rep.results["out:tracks"], "pass"); assert.equal(rep.results["in:b1"], "pass"); assert.equal(rep.results["in:k1"], "pass");
});
await page.setViewportSize({ width: 1280, height: 720 }); await wait(300);
if (shots) await page.screenshot({ path: path.join(shots, "factory-1280.png") });
await check("Finish: 'Now unplug the pedal' - the next start is the customer's", async () => {
  page.once("dialog", (d) => d.accept());
  await page.click('#factoryTest [data-ft="finish"]');
  await until(() => T(() => /Now unplug the pedal/.test(document.getElementById("factoryTest").textContent)), 4000);
  await until(() => JSON.parse(fs.readFileSync(path.join(tmp, "factory.json"), "utf8")).finished === true, 4000);
});
if (shots) await page.screenshot({ path: path.join(shots, "factory-done.png") });

console.log("Unplugged: the customer's first start");
driver.kill(); await until(() => driver.exitCode !== null || driver.signalCode, 5000).catch(() => {}); await wait(800);
const fj = JSON.parse(fs.readFileSync(path.join(tmp, "factory.json"), "utf8")); fj.boot = "an-earlier-start"; fs.writeFileSync(path.join(tmp, "factory.json"), JSON.stringify(fj));
for (const f of ["code-chosen"]) try { fs.unlinkSync(path.join(tmp, f)); } catch (_) { }
driver = startDriver(tmp);
await until(() => /listening on ws/.test(driver.log), 15000);
await check("the next start (not one the test asked for) is the customer's: no test, no pairing question; the touch screen stays", async () => {
  await page.reload(); await page.waitForFunction(() => window.__pedalBridge && window.__pedalBridge.connected, null, { timeout: 15000 });
  await wait(2500);
  assert.equal(await T(() => !!(document.getElementById("factoryTest") && document.getElementById("factoryTest").open)), false);
  assert.equal(await T(() => !!(document.getElementById("pinDialog") && document.getElementById("pinDialog").open)), false);
  const j = JSON.parse(fs.readFileSync(path.join(tmp, "factory.json"), "utf8"));
  assert.equal(j.state, "customer"); assert.equal(j.firstBoot, true);
});
await check("no page errors", async () => { assert.deepEqual(errors, []); });

await browser.close(); driver.kill();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures ? "\n" + failures + " FACTORY CHECK(S) FAILED" : "\nALL FACTORY CHECKS PASSED");
process.exit(failures ? 1 : 0);
