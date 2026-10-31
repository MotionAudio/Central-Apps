#!/usr/bin/env node
/**
 * Central Pedal / Central Control / Central Usage - Settings → Packages → Community (10.1) in real headless Chromium,
 * with the website and the Central Pedal's driver stood in (Playwright routes - no ports used):
 *   * the community items of this device's plans (Central Keys brings Central Pads), grouped by plan, with who made them;
 *   * a plugin carries "Community plugin - made by <creator>, checked by Motion Audio" and can't be installed until this
 *     device's "Allow community plugins" is on (off by default) - the switch goes to the driver / the app;
 *   * Install asks the website with the plan's package key and this device's platform, then installs through the driver
 *     (or the app on a computer) like a library; Report sends what's wrong; the revoke list takes items off the device.
 *     node test-community.mjs
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import assert from "node:assert/strict";

const { chromium } = createRequire(import.meta.url)("playwright");
const here = path.dirname(fileURLToPath(import.meta.url));
let failures = 0;
async function check(label, fn) {
  try { await fn(); console.log("  ✓ " + label); }
  catch (error) { failures++; console.error("  ✗ " + label + "\n      " + (error && error.message ? error.message.split("\n").slice(0, 10).join("\n      ") : error)); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const url = (p) => "file://" + path.join(here, p).split(path.sep).map(encodeURIComponent).join("/");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pp-community-"));
const future = new Date(Date.now() + 200 * 864e5).toISOString();
const SHA = "e".repeat(64);
const ITEMS = {
  pads: [{ id: "7", libraryId: "community-7", kind: "loop", pack: "pads", title: "Ambient Swells", creator: "Ana Loops", stars: 4, description: "Warm swells at 72 BPM", packages: { all: { size: 1000, sha256: SHA } } }],
  keys: [{ id: "8", libraryId: "community-8", kind: "instrument", pack: "keys", title: "Felt Piano", creator: "Ana Loops", stars: 5, packages: { all: { size: 1000, sha256: SHA } } }],
  plugins: [{ id: "9", libraryId: "community-9", kind: "plugin", pack: "plugins", title: "Shimmer Verb", creator: "Ben Pads", stars: 3, packages: { "linux-arm64": { size: 1600, sha256: SHA }, "linux-x64": { size: 1600, sha256: SHA } } }],
};
function settingsPage(name, extra) {
  const f = path.join(tmp, name + ".html");
  fs.writeFileSync(f, `<!doctype html><meta charset="utf-8"><body><div id="set"></div>
<script>${extra || ""}
var L = {}; window.PPFeatures = { on: function (t, f) { (L[t] = L[t] || []).push(f); }, emit: function (m) { (L[m.type] || []).forEach(function (f) { f(m); }); } };
window.PPInstrument = { syncLibraries: function () { } };</script>
<script src="${url("js/license.js")}"></script><script src="${url("js/pedals.js")}"></script><script src="${url("js/libraries.js")}"></script><script src="${url("js/community.js")}"></script>`);
  return "file://" + f;
}
function website(page, seen, revoked) {
  return page.route("http://website.test/**", (route) => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname;
    let body = {};
    if (p === "/v1/libraries") body = { source: "index", libraries: [] };
    else if (p === "/v1/package/check") body = { packages: [{ key: "SABC-DEFG-HJKL-MNPQ", ok: true, plans: { keys: future, plugins: future, pads: future }, end: future }] };
    else if (p === "/v1/community") body = { items: ITEMS[u.searchParams.get("pack")] || [] };
    else if (p === "/v1/community/revoked") body = { items: revoked(), hashes: [] };
    else if (/^\/v1\/community\/\d+\/download$/.test(p)) { seen.push({ path: p, body: req.postDataJSON() }); const id = p.split("/")[3]; body = { id: "community-" + id, item: id, version: "1", url: "https://cdn.test/community-" + id + ".zip", sha256: SHA, size: 1000 }; }
    else if (/^\/v1\/community\/\d+\/report$/.test(p)) { seen.push({ path: p, body: req.postDataJSON() }); body = { ok: true }; }
    route.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(body) });
  });
}
const browser = await chromium.launch();
try {
  console.log("Community on the Central Pedal (its driver):");
  const page = await browser.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  const seen = [], driver = { installed: [], jobs: {}, allowed: false, calls: [] };
  let revokedList = [];
  await website(page, seen, () => revokedList);
  await page.route("http://127.0.0.1:8766/**", async (route) => {
    const req = route.request(), u = new URL(req.url()), j = (o, s) => route.fulfill({ status: s || 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: JSON.stringify(o) });
    const body = req.method() === "POST" ? req.postDataJSON() : null;
    driver.calls.push({ path: u.pathname, body });
    if (u.pathname === "/libraries") return j({ available: true, installed: driver.installed, jobs: driver.jobs, pluginsAllowed: driver.allowed });
    if (u.pathname === "/libraries/install") { driver.jobs[body.id] = { state: "done" }; driver.installed.push({ id: body.id, plan: "pads", version: "1", title: body.id, counts: { loop: 1 }, community: { creator: "Ana Loops" } }); return j({ ok: true, started: true }); }
    if (u.pathname === "/libraries/remove") { driver.installed = driver.installed.filter((x) => x.id !== body.id); return j({ ok: true, installed: driver.installed }); }
    if (u.pathname === "/libraries/community") {
      if ("pluginsAllowed" in body) driver.allowed = body.pluginsAllowed === true;
      const gone = (body.revokeIds || []).filter((id) => driver.installed.some((x) => x.id === id));
      driver.installed = driver.installed.filter((x) => !gone.includes(x.id));
      return j({ ok: true, pluginsAllowed: driver.allowed, revoked: gone, installed: driver.installed });
    }
    j({ error: "unknown" }, 404);
  });
  await page.addInitScript((pk) => { localStorage.setItem("cc-packages", JSON.stringify([pk])); }, { key: "SABC-DEFG-HJKL-MNPQ", plans: { keys: future, plugins: future, pads: future }, okAt: Date.now(), ok: true });
  await page.goto(settingsPage("pedal", `window.PP_LICENSE_CONFIG = { server: "http://website.test", required: true }; window.__pedalBridge = { connected: true, info: { deviceId: "pedal-0123456789ab" }, send: function () { return true; } };`));
  await page.evaluate(() => { PPLicense.init({ app: "pedal", packages: JSON.parse(localStorage.getItem("cc-packages")) }); document.getElementById("set").innerHTML = PPLicense.settingsHtml(); });
  await page.waitForFunction(() => document.querySelectorAll("#cmSettings li[data-cm]").length === 3, null, { timeout: 6000 });
  const text = () => page.textContent("#cmSettings");
  await check("Settings → Packages has Community under Libraries: this device's plans' items (Central Pads with Central Keys), by plan, with who made them", async () => {
    const r = await page.evaluate(() => ({ under: !!document.querySelector("#libSettings + #cmSettings"), heads: [...document.querySelectorAll("#cmSettings h4")].map((h) => h.textContent), ids: [...document.querySelectorAll("#cmSettings li[data-cm]")].map((e) => e.dataset.cm) }));
    assert.ok(r.under); assert.deepEqual(r.heads, ["Central Pads", "Central Keys", "Central Plugins"]); assert.deepEqual(r.ids, ["7", "8", "9"]);
    assert.ok(/Community - made by Ana Loops/.test(await text()));
  });
  await check("the plugin's label: \"Community plugin - made by Ben Pads, checked by Motion Audio\"", async () => {
    assert.equal(await page.textContent('#cmSettings li[data-cm="9"] .cm-label'), "Community plugin - made by Ben Pads, checked by Motion Audio");
  });
  await check("Allow community plugins is off by default: the plugin can't be installed (it says why)", async () => {
    assert.equal(await page.isChecked("[data-cm-plugins]"), false);
    assert.equal(await page.locator('[data-cm-install="9"]').count(), 0);
    assert.ok(/Switch on Allow community plugins to install it/.test(await page.textContent('#cmSettings li[data-cm="9"]')));
  });
  await check("switching it on goes to the driver (this device's setting); then the plugin can be installed", async () => {
    await page.check("[data-cm-plugins]"); await wait(300);
    assert.deepEqual(driver.calls.filter((c) => c.path === "/libraries/community").pop().body, { pluginsAllowed: true });
    assert.ok(driver.allowed && (await page.locator('[data-cm-install="9"]').count()) === 1, await text());
  });
  await check("Install: the website is asked with the plan's package key and the Central Pedal's platform; the driver installs it like a library", async () => {
    await page.click('[data-cm-install="7"]');
    await page.waitForFunction(() => /is installed/.test(document.getElementById("cmSettings").textContent), null, { timeout: 6000 });
    const d = seen.filter((s) => /download/.test(s.path)).pop();
    assert.equal(d.path, "/v1/community/7/download"); assert.equal(d.body.key, "SABC-DEFG-HJKL-MNPQ"); assert.equal(d.body.platform, "linux-arm64");
    assert.deepEqual(driver.calls.filter((c) => c.path === "/libraries/install").pop().body, { id: "community-7", url: "https://cdn.test/community-7.zip", sha256: SHA, size: 1000 });
    assert.ok(/Installed/.test(await page.textContent('#cmSettings li[data-cm="7"]')) && (await page.locator('[data-cm-remove="community-7"]').count()) === 1);
  });
  await check("Report: what's wrong goes to the website (for the review site)", async () => {
    await page.click('[data-cm-report="7"]'); await page.fill('[data-cm-why="7"]', "Clicks at the loop point"); await page.click('[data-cm-send="7"]'); await wait(300);
    const r = seen.filter((s) => /report/.test(s.path)).pop();
    assert.equal(r.body.reason, "Clicks at the loop point"); assert.ok(/pedal/.test(r.body.device) && /Thanks/.test(await text()));
  });
  await check("the revoke list: an item Motion Audio took down comes off this device, and it says so", async () => {
    revokedList = [{ id: "7", libraryId: "community-7", kind: "loop", status: "pulled", reason: "rights" }];
    await page.evaluate(() => PPCommunity.checkRevoked());
    const c = driver.calls.filter((x) => x.path === "/libraries/community").pop();
    assert.deepEqual(c.body.revokeIds, ["community-7"]);
    assert.ok(!driver.installed.some((x) => x.id === "community-7") && /took a community item down/.test(await text()), await text());
  });
  await check("switching it off again goes to the driver too", async () => {
    await page.uncheck("[data-cm-plugins]"); await wait(300);
    assert.ok(!driver.allowed && (await page.locator('[data-cm-install="9"]').count()) === 0);
  });
  await check("no page errors", async () => { assert.deepEqual(errs, []); });
  await page.screenshot({ path: path.join(process.env.SHOTS || tmp, "app-community.png"), fullPage: true });

  console.log("\nCommunity on a computer (the app installs them):");
  for (const [plat, arch, want] of [["darwin", "arm64", "mac"], ["linux", "x64", "linux-x64"], ["win32", "x64", "win-x64"]]) {
    const p2 = await browser.newPage(), seen2 = [];
    await website(p2, seen2, () => []);
    await p2.addInitScript((pk) => { localStorage.setItem("cc-packages", JSON.stringify([pk])); }, { key: "SABC-DEFG-HJKL-MNPQ", plans: { keys: future, plugins: future, pads: future }, okAt: Date.now(), ok: true });
    await p2.goto(settingsPage("computer-" + plat, `window.PP_LICENSE_CONFIG = { server: "http://website.test", required: false };
      window.__cu = []; var inst = [], allowed = false; window.CU = { platform: "${plat}", arch: "${arch}", libraries: { list: function () { return Promise.resolve({ ok: true, installed: inst }); },
        install: function (l) { window.__cu.push(["install", l]); inst = inst.concat([{ id: l.id, plan: "plugins", version: "1", title: l.id }]); return Promise.resolve({ ok: true, installed: inst }); },
        remove: function (id) { inst = inst.filter(function (x) { return x.id !== id; }); return Promise.resolve({ ok: true, installed: inst }); },
        community: function (o) { window.__cu.push(["community", o]); if ("pluginsAllowed" in o) allowed = o.pluginsAllowed === true; return Promise.resolve({ ok: true, pluginsAllowed: allowed, revoked: [], installed: inst }); } } };`));
    await p2.evaluate(() => { PPLicense.init({ app: "usage" }); document.getElementById("set").innerHTML = PPLicense.packagesHtml(); });
    await p2.waitForFunction(() => document.querySelectorAll("#cmSettings li[data-cm]").length === 3, null, { timeout: 6000 });
    if (want === "win-x64") {
      await check("Windows: no switch, and plugins say they can't run walled off there yet", async () => {
        assert.equal(await p2.locator("[data-cm-plugins]").count(), 0);
        assert.ok(/can't run walled off on Windows yet/.test(await p2.textContent('#cmSettings li[data-cm="9"]')));
      });
      continue;
    }
    await check(plat + ": the switch goes through the app; a plugin download asks for this computer's build (" + want + ")", async () => {
      await p2.check("[data-cm-plugins]"); await wait(200);
      assert.deepEqual((await p2.evaluate(() => window.__cu)).filter((c) => c[0] === "community").pop()[1], { pluginsAllowed: true });
      if (want === "mac") { assert.ok(/Not made for this device/.test(await p2.textContent('#cmSettings li[data-cm="9"]'))); await p2.click('[data-cm-install="8"]'); }
      else await p2.click('[data-cm-install="9"]');
      await p2.waitForFunction(() => /is installed/.test(document.getElementById("cmSettings").textContent), null, { timeout: 6000 });
      assert.equal(seen2.filter((s) => /download/.test(s.path)).pop().body.platform, want);
      assert.equal((await p2.evaluate(() => window.__cu)).filter((c) => c[0] === "install").pop()[1].sha256, SHA);
    });
  }
  console.log("\nWalled off on a computer (central-usage/community-sandbox.js):");
  const SB = createRequire(import.meta.url)("./central-usage/community-sandbox.js");
  await check("macOS: sandbox-exec, deny by default - no network, no launching programs, reads only the system, audio parts and the plugin, writes only its own temp folder", async () => {
    const w = SB.wrap("/Apps/cu-rig", ["--scan-one", "vst3", "/p/Shimmer.vst3"], { platform: "darwin", pluginDir: "/p", tmpDir: "/t/x" }), prof = w.args[1];
    assert.equal(w.cmd, "/usr/bin/sandbox-exec"); assert.equal(w.args[0], "-p"); assert.deepEqual(w.args.slice(2), ["/Apps/cu-rig", "--scan-one", "vst3", "/p/Shimmer.vst3"]);
    assert.ok(/\(deny default\)/.test(prof) && /\(deny network\*\)/.test(prof) && /\(allow process-exec \(literal "\/Apps\/cu-rig"\)\)/.test(prof) && !/allow process-exec\*/.test(prof) && /\(subpath "\/p"\)/.test(prof) && /file-write\* \(subpath "\/t\/x"\)/.test(prof) && !/file-write\*[^\n]*\/p"/.test(prof), prof);
  });
  await check("Linux: bubblewrap - own namespaces, no capabilities, read-only system and plugin, only the PipeWire socket", async () => {
    const w = SB.wrap("/opt/cu-rig", ["--scan-one", "lv2", "/p/S.lv2"], { platform: "linux", pluginDir: "/p", runtimeDir: "/run/user/1000" }), s = w.args.join(" ");
    assert.equal(w.cmd, "bwrap"); assert.ok(/--unshare-all/.test(s) && /--cap-drop ALL/.test(s) && /--ro-bind \/p \/plugin/.test(s) && /\/run\/user\/1000\/pipewire-0 \/tmp\/run\/pipewire-0/.test(s) && !/--share-net/.test(s) && / --bind /.test(s) === false, s);
    assert.deepEqual(w.args.slice(-5), ["--", "/opt/cu-rig", "--scan-one", "lv2", "/p/S.lv2"]);
  });
  await check("Windows: not walled off yet - it says so (and the app keeps community plugins off there)", async () => {
    assert.ok(/can't run walled off on Windows yet/.test(SB.wrap("C:/cu-rig.exe", [], { platform: "win32", pluginDir: "C:/p" }).unsupported));
  });
} finally {
  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(failures ? "\n" + failures + " FAILED" : "\nall passed");
process.exit(failures ? 1 : 0);
