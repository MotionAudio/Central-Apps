#!/usr/bin/env node
/**
 * 10.0: the demo church's built-in keys in the apps, before the website is online (js/license.js offline mode):
 * Central Control takes ADMO-RVST-ADMN-2026 and shows "Demo key" with Riverstone Church (demo); the demo package keys
 * add their own plans (with Central Pads); other made-up keys are still refused; the downloads link is the website's.
 *   node test-demo-keys.mjs
 */
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const here = path.dirname(fileURLToPath(import.meta.url));
let failures = 0;
async function check(label, fn) { try { await fn(); console.log("  ✓ " + label); } catch (e) { failures++; console.error("  ✗ " + label + "\n      " + String(e && e.message ? e.message.split("\n").slice(0, 6).join("\n      ") : e)); } }
const page0 = (cfg) => `<!doctype html><meta charset="utf-8"><body><div id="host"></div><script>window.PP_LICENSE_CONFIG=${JSON.stringify(cfg)};</script><script src="/js/license.js"></script></body>`;
let cfg = { server: "" };
const srv = http.createServer((req, res) => {
  if (req.url.startsWith("/js/")) { res.setHeader("Content-Type", "text/javascript"); return res.end(fs.readFileSync(path.join(here, req.url.split("?")[0]))); }
  res.setHeader("Content-Type", "text/html"); res.end(page0(cfg));
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const base = "http://127.0.0.1:" + srv.address().port + "/";
const browser = await chromium.launch();
const errors = [];
try {
  const page = await browser.newPage(); page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base); await page.evaluate(() => localStorage.clear()); await page.reload();
  await check("offline, Central Control asks for a key and suggests the demo church's key too", async () => {
    await page.evaluate(() => PPLicense.init({ app: "control" }));
    await page.waitForSelector("#licWiz");
    if (await page.$("#lwProd")) { await page.fill("#lwProd", "Riverstone"); await page.click('#licWiz [data-lw="prod"]'); }
    await page.waitForSelector("#lwKey");
    const t = await page.textContent("#licWiz");
    assert.match(t, /ADEF-AULT-KEY0-2026/); assert.match(t, /ADMO-RVST-ADMN-2026/);
  });
  await check("...a made-up key is refused; the demo A key is taken: Demo key, Riverstone Church (demo)", async () => {
    await page.fill("#lwKey", "ABCD-EFGH-JKLM-2026"); await page.click('#licWiz [data-lw="key"]');
    assert.match(await page.textContent("#licWiz"), /can't be checked yet/);
    await page.fill("#lwKey", "admo-rvst-admn-2026"); await page.click('#licWiz [data-lw="key"]');
    await page.waitForFunction(() => PPLicense.licensed());
    const s = await page.evaluate(() => PPLicense.state());
    assert.equal(s.key, "ADMO-RVST-ADMN-2026"); assert.equal(s.church, "Riverstone Church (demo)"); assert.equal(s.isDemo, true);
    const html = await page.evaluate(() => PPLicense.settingsHtml("x"));
    assert.match(html, /Demo key/); assert.match(html, /Riverstone Church \(demo\)/); assert.doesNotMatch(html, /Default key \(temporary\)/);
  });
  await check("the demo package keys: each adds its own plans (with Central Pads); the default one adds every plan", async () => {
    await page.evaluate(() => { document.getElementById("host").innerHTML = PPLicense.settingsHtml("x"); });
    for (const k of ["SDMO-RVST-PLUG-2026", "SDMO-RVST-PADS-2026"]) {
      await page.fill("#pkgKey", k); await page.click('[data-pkg="add"]');
      await page.waitForFunction((key) => (JSON.parse(localStorage.getItem("cc-packages") || "[]")).some((p) => p.key === key), k);
    }
    const list = await page.evaluate(() => JSON.parse(localStorage.getItem("cc-packages")));
    const plug = list.find((p) => p.key === "SDMO-RVST-PLUG-2026"), pads = list.find((p) => p.key === "SDMO-RVST-PADS-2026");
    assert.deepEqual(Object.keys(plug.plans).sort(), ["pads", "plugins"]); assert.deepEqual(Object.keys(pads.plans), ["pads"]);
    assert.ok(plug.isDemo && plug.church === "Riverstone Church (demo)");
    assert.match(await page.textContent("#pkgSettings"), /Demo package/);
    await page.fill("#pkgKey", "SXXX-RVST-PLUG-2026"); await page.click('[data-pkg="add"]');
    assert.match(await page.textContent("#pkgSettings"), /can't be checked yet/);
  });
  await check("the Downloads link: a stand-in until the website is online, then the website's own Downloads page", async () => {
    assert.equal(await page.evaluate(() => PPLicense.downloadsUrl()), "https://motionaudio.github.io/Central-Apps/");
    cfg = { server: "https://motion.test" }; await page.reload();
    assert.equal(await page.evaluate(() => PPLicense.downloadsUrl()), "https://motion.test/#downloads");
  });
  await check("no page errors", () => assert.deepEqual(errors, []));
} finally { await browser.close(); srv.close(); }
console.log(failures ? "\n" + failures + " CHECK(S) FAILED" : "\nALL CHECKS PASSED");
process.exit(failures ? 1 : 0);
