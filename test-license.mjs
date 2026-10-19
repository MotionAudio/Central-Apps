#!/usr/bin/env node
/**
 * License keys and the first-open setup, end to end: the real website (server/, on a Postgres), the real driver and
 * the apps in headless Chromium - Central Pedal (with a key put on its card), Central Control (A key) and Central
 * Usage (U key): set up, wrong keys, Release key, released on the website, 30 days offline.
 *   MA_DATABASE_URL=postgres://... MA_SERVER_DIR=path/to/server (with node_modules) node test-license.mjs
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import assert from "node:assert/strict";

const here = path.dirname(fileURLToPath(import.meta.url));
const DB = process.env.MA_DATABASE_URL, SRV = process.env.MA_SERVER_DIR || path.join(here, "server");
if (!DB) { console.log("SKIP: set MA_DATABASE_URL (a Postgres for the website) to run the license tests"); process.exit(0); }
const PORT = 18892, WEB = "http://127.0.0.1:" + PORT, stamp = Date.now();
let failures = 0;
async function check(label, fn) { try { await fn(); console.log("  ✓ " + label); } catch (e) { failures++; console.error("  ✗ " + label + "\n      " + String(e && e.message ? e.message.split("\n").slice(0, 8).join("\n      ") : e)); } }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 8000, every = 100) { const t0 = Date.now(); for (;;) { try { const v = await fn(); if (v) return v; } catch (_) { } if (Date.now() - t0 > ms) throw new Error("timed out waiting"); await wait(every); } }
const j = async (method, p, body, tok) => { const r = await fetch(WEB + "/v1" + p, { method, headers: { "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); return Object.assign(await r.json().catch(() => ({})), { _status: r.status }); };

// the website
const web = spawn(process.execPath, [path.join(SRV, "src", "index.js")], { env: Object.assign({}, process.env, { DATABASE_URL: DB, PORT: String(PORT), ADMIN_EMAILS: "boss@motion.test", STRIPE_SECRET_KEY: "" }), stdio: ["ignore", "pipe", "pipe"] });
let webLog = ""; web.stdout.on("data", (d) => { webLog += d; }); web.stderr.on("data", (d) => { webLog += d; });
await until(() => /Motion Audio server on/.test(webLog), 15000);
// a church with keys (made by Motion Audio staff, as for a pedal they build)
const owner = await j("POST", "/signup", { email: "lead" + stamp + "@grace.test", password: "password123", name: "Lead", churchName: "Grace Church " + stamp });
let boss = await j("POST", "/signup", { email: "boss@motion.test", password: "password123" }); if (!boss.token) boss = await j("POST", "/login", { email: "boss@motion.test", password: "password123" });
const code = (await j("GET", "/church", null, owner.token)).church.adminCode;
const mk = async (kind, n) => (await j("POST", "/admin/keys", { kind, count: n, church: code, note: "test" }, boss.token)).keys;
const [P1, P2] = await mk("P", 2), [A1] = await mk("A", 1), [U1] = await mk("U", 1);

// the Central Pedal, with its key on the card (pad-pedal-key.txt / license-key.txt)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pp-lic-"));
fs.writeFileSync(path.join(tmp, "license-key.txt"), P1 + "\n"); fs.writeFileSync(path.join(tmp, "code-chosen"), "1");   // (no pairing PIN prompt here)
const driver = spawn("python3", [path.join(here, "pedal-driver.py"), "--simulate", tmp, "--app-root", here], { stdio: ["ignore", "pipe", "pipe"] });
let drvLog = ""; driver.stdout.on("data", (d) => { drvLog += d; }); driver.stderr.on("data", (d) => { drvLog += d; });
await until(() => /listening on ws/.test(drvLog), 15000);

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
await ctx.addInitScript((server) => { window.PP_LICENSE_CONFIG = { server: server, required: true }; }, WEB);
const errors = [];
const page = await ctx.newPage(); page.on("pageerror", (e) => errors.push(String(e))); page.on("dialog", (d) => d.accept());
const T = (fn, arg) => page.evaluate(fn, arg);
await page.goto("http://127.0.0.1:8766/app/#perform");

await check("Central Pedal opens on the setup: internet ✓, then the production's name", async () => {
  await until(() => T(() => !!document.getElementById("licWiz")), 10000);
  await until(() => T(() => !!document.getElementById("lwProd")), 8000);
  const steps = await T(() => Array.from(document.querySelectorAll("#licWiz .lw-steps span")).map((s) => s.textContent));
  assert.deepEqual(steps, ["✓ Internet", "2. Production", "3. License key", "4. Account"]);
  await page.keyboard.press("Escape"); await page.keyboard.press("Escape"); await wait(300);
  assert.ok(await T(() => document.getElementById("licWiz") && document.getElementById("licWiz").open), "Escape (twice) doesn't skip it");
});
await check("...the name, then the key that came on the card is already filled in, with this pedal's name", async () => {
  await page.fill("#lwProd", "Grace Church"); await page.click('#licWiz [data-lw="prod"]');
  const k = await until(() => T(() => { const i = document.getElementById("lwKey"); return i ? { key: i.value, dev: document.getElementById("lwDev").value } : null; }));
  assert.equal(k.key, P1); assert.match(k.dev, /^Central Pedal/);
  assert.equal(await T(() => PP.project().name), "Grace Church", "the set is named after the production");
});
await check("...a wrong kind of key is caught before it is sent; a key used on another device says where", async () => {
  await page.fill("#lwKey", A1); await page.click('#licWiz [data-lw="key"]');
  assert.match(await T(() => document.querySelector("#licWiz .bad").textContent), /needs a key that starts with P/);
  await j("POST", "/license/activate", { key: P2, device: "dev-someone-elses", deviceName: "Youth room pedal", app: "pedal" });
  await page.fill("#lwKey", P2); await page.click('#licWiz [data-lw="key"]');
  await until(() => T(() => /Youth room pedal/.test((document.querySelector("#licWiz .bad") || {}).textContent || "")));
});
await check("...its own key works; then the account: the main admin signs in, and the setup is done", async () => {
  await page.fill("#lwKey", P1.toLowerCase().replace(/-/g, "")); await page.click('#licWiz [data-lw="key"]');
  await until(() => T(() => !!document.getElementById("lwEmail")), 8000);
  assert.match(await T(() => document.getElementById("licWiz").textContent), /Grace Church .*admin account/);
  await page.fill("#lwEmail", "lead" + stamp + "@grace.test"); await page.fill("#lwPass", "password123"); await page.click('#licWiz [data-lw="acct"]');
  await until(() => T(() => !document.getElementById("licWiz")), 8000);
  const s = await T(() => ({ ok: PPLicense.licensed(), st: PPLicense.state(), ct: JSON.parse(localStorage.getItem("central-tracks") || "{}") }));
  assert.ok(s.ok && s.st.kind === "P" && s.st.app === "pedal" && s.st.account.email.startsWith("lead"), JSON.stringify(s.st));
  assert.ok(s.ct.server === WEB && s.ct.token, "Central Tracks is signed in with the same account");
  const ch = await j("GET", "/church", null, owner.token);
  assert.ok(ch.keys.some((k) => k.key === P1 && k.inUse && /^Central Pedal/.test(k.device)), "the website shows the key on this pedal");
});
await check("the pedal keeps a copy with its driver (a wiped browser profile doesn't ask again) and uses its own id", async () => {
  await until(() => fs.existsSync(path.join(tmp, "license-state.json")) && JSON.parse(fs.readFileSync(path.join(tmp, "license-state.json"), "utf8")).key === P1, 6000);
  assert.equal(await T(() => PPLicense.deviceId() === window.__pedalBridge.info.deviceId && /^dev-[0-9a-f]{24}$/.test(PPLicense.deviceId())), true);
  await T(() => { localStorage.removeItem("cc-license"); localStorage.removeItem("cc-device-id"); });
  await page.reload(); await page.waitForFunction(() => window.PPLicense && PPLicense.app()); await wait(2000);
  assert.equal(await T(() => !document.getElementById("licWiz") && PPLicense.complete()), true, "no setup after the profile was wiped");
});
await check("Settings → License shows the key and Release key frees it (the setup comes back)", async () => {
  await T(() => PPShell.showTab("settings")); await until(() => T(() => !!document.querySelector('#licSettings [data-lic="release"]')), 6000);
  assert.match(await T(() => document.getElementById("licSettings").textContent), /P key.*Grace Church/);
  await page.click('#licSettings [data-lic="release"]');
  await until(() => T(() => !!document.getElementById("lwKey")), 8000).catch(async () => { throw new Error("no key step: " + await T(() => JSON.stringify(PPLicense.state()) + " :: " + ((document.getElementById("licWiz") || {}).textContent || "no wizard") + " :: dialogs " + Array.from(document.querySelectorAll("dialog[open]")).map((d) => d.id))); });
  assert.match(await T(() => document.getElementById("licWiz").textContent), /Released/);
  const ch = await j("GET", "/church", null, owner.token);
  assert.ok(ch.keys.some((k) => k.key === P1 && !k.inUse), "free on the website");
});
await check("a key released on the website (a lost device) stops the app at its next check", async () => {
  await page.fill("#lwKey", P1); await page.click('#licWiz [data-lw="key"]');
  await until(() => T(() => !document.getElementById("licWiz")), 8000);   // (the account is remembered)
  await j("POST", "/church/release", { key: P1 }, owner.token);
  await T(() => PPLicense.recheck());
  await until(() => T(() => /released/.test((document.getElementById("licWiz") || {}).textContent || "")), 8000);
});
await check("offline: it keeps working for 30 days after the last check, then asks for the internet", async () => {
  await j("POST", "/license/activate", { key: P1, device: await T(() => PPLicense.deviceId()), deviceName: "Central Pedal", app: "pedal" });
  const p2 = await ctx.newPage(); p2.on("pageerror", (e) => errors.push("p2:" + e));
  await p2.addInitScript(() => { window.PP_LICENSE_CONFIG = { server: "http://127.0.0.1:9", required: true }; });   // (nothing answers there: offline)
  const setAge = (days) => p2.evaluate((d) => { const s = JSON.parse(localStorage.getItem("cc-license")); s.okAt = Date.now() - d * 864e5; s.blocked = null; s.app = "pedal"; s.account = s.account || { email: "x" }; localStorage.setItem("cc-license", JSON.stringify(s)); }, days);
  await p2.goto("http://127.0.0.1:8766/app/#perform"); await p2.waitForFunction(() => window.PPLicense);
  await p2.evaluate((k) => { const s = JSON.parse(localStorage.getItem("cc-license") || "{}"); s.key = k; s.kind = "P"; localStorage.setItem("cc-license", JSON.stringify(s)); }, P1);
  await setAge(10); await p2.reload(); await p2.waitForFunction(() => window.PPLicense && PPLicense.app()); await p2.waitForTimeout(2500);
  assert.equal(await p2.evaluate(() => !!document.getElementById("licWiz")), false, "10 days offline: still works");
  await setAge(31); await p2.reload(); await p2.waitForFunction(() => window.PPLicense && PPLicense.app());
  await p2.waitForFunction(() => document.getElementById("licWiz") && /internet/i.test(document.getElementById("licWiz").textContent), null, { timeout: 15000 });
  await p2.close();
});
await check("the player window inside Central Control needs no key (Central Control's A key covers it)", async () => {
  const p3 = await ctx.newPage(); await p3.goto("http://127.0.0.1:8766/app/?player=1#perform"); await p3.waitForFunction(() => window.PPLicense && PPLicense.app());
  await p3.waitForTimeout(1200); assert.equal(await p3.evaluate(() => PPLicense.app() + ":" + !!document.getElementById("licWiz")), "player:false"); await p3.close();
});
await check("Central Control: an A key; Central Usage: a U key and the user's own new account joins the church as a user", async () => {
  const cuApp = "file://" + path.join(here, "central-usage", "app", "index.html");
  const c1 = await ctx.newPage(); c1.on("pageerror", (e) => errors.push("cc:" + e));
  await c1.goto(cuApp + "?edition=control");
  await c1.waitForFunction(() => window.PPLicense && document.getElementById("lwProd"), null, { timeout: 15000 }).catch(async (e) => { throw new Error(e.message + " :: " + await c1.evaluate(() => (window.PPLicense ? PPLicense.app() + " " + JSON.stringify(PPLicense.state()) : "no license") + " :: " + ((document.getElementById("licWiz") || {}).textContent || "no wizard"))); });
  await c1.fill("#lwProd", "Grace Church"); await c1.click('#licWiz [data-lw="prod"]');
  await c1.fill("#lwKey", U1); await c1.click('#licWiz [data-lw="key"]');
  assert.match(await c1.evaluate(() => document.querySelector("#licWiz .bad").textContent), /starts with A/);
  await c1.fill("#lwKey", A1); await c1.click('#licWiz [data-lw="key"]');
  await c1.waitForFunction(() => document.getElementById("lwEmail") && /admins can share one/.test(document.getElementById("licWiz").textContent));
  await c1.fill("#lwEmail", "lead" + stamp + "@grace.test"); await c1.fill("#lwPass", "password123"); await c1.click('#licWiz [data-lw="acct"]');
  await c1.waitForFunction(() => !document.getElementById("licWiz") && PPLicense.licensed());
  await c1.close();
  const c2 = await ctx.newPage(); c2.on("pageerror", (e) => errors.push("cu:" + e));
  await c2.goto(cuApp + "?edition=usage&cudev=dev-phone-" + stamp); await c2.waitForFunction(() => window.PPLicense && document.getElementById("lwKey"), null, { timeout: 15000 });   // (the production's name is known on this computer: straight to the key)
  await c2.fill("#lwKey", U1); await c2.click('#licWiz [data-lw="key"]');
  await c2.waitForFunction(() => document.getElementById("lwEmail") && /your own/.test(document.getElementById("licWiz").textContent));
  await c2.click('#licWiz [data-lw="up"]'); await c2.fill("#lwName", "Bass player"); await c2.fill("#lwEmail", "bass" + stamp + "@grace.test"); await c2.fill("#lwPass", "password123"); await c2.click('#licWiz [data-lw="acct"]');
  await c2.waitForFunction(() => !document.getElementById("licWiz") && PPLicense.licensed());
  assert.equal(await c2.evaluate(() => PPLicense.deviceId()), "dev-phone-" + stamp, "the phone app's own id is used");
  await c2.close();
  const ch = await j("GET", "/church", null, owner.token);
  assert.ok(ch.counts.A.inUse === 1 && ch.counts.U.inUse === 1 && ch.members.some((m) => m.role === "user" && /^bass/.test(m.email)), JSON.stringify(ch.counts));
});
await check("the website: packs and keys in the store, a new account makes the church, its page shows the codes and how many keys are left", async () => {
  const w = await ctx.newPage(); w.on("pageerror", (e) => errors.push("web:" + e)); w.on("dialog", (d) => d.accept());
  await w.goto(WEB + "/"); await w.waitForFunction(() => document.querySelectorAll("#packs .prod").length === 3);
  const store = await w.evaluate(() => ({ packs: Array.from(document.querySelectorAll("#packs .prod")).map((p) => p.querySelector("h3").textContent + " " + p.querySelector(".price").textContent.split(" ")[0]),
    rack: Array.from(document.querySelectorAll("#rack .prod")).map((p) => p.querySelector("h3").textContent + " " + p.querySelector(".price").textContent.split(" ")[0]) }));
  assert.deepEqual(store.packs, ["Small church $400", "Medium church $600", "Large church $850"]);
  assert.deepEqual(store.rack, ["Central Pedal $250", "Central Pedal Control $50", "Central Control (admin) $50", "Central Usage (user) $20"], "the $10 user price shows only with a pack");
  await w.click('#packs [data-add="pack-small"]');
  assert.ok(await w.evaluate(() => Array.from(document.querySelectorAll("#rack .prod h3")).length === 5), "with a pack in the cart, the $10 user is there");
  await w.click("#cartBtn"); assert.match(await w.textContent(".modal"), /Sign in or make an account first/); await w.click('.modal [data-close], .modal #clear');
  await w.goto(WEB + "/#account"); await w.waitForSelector("#upForm");
  await w.check('[name="upCh"][value="make"]'); await w.fill("#upName", "Pastor"); await w.fill("#upEmail", "pastor" + stamp + "@hope.test"); await w.fill("#upPass", "password123"); await w.fill("#upChurch", "Hope Church");
  await w.click("#upForm button.btn");
  await w.waitForFunction(() => /Hope Church/.test((document.getElementById("churchCard") || {}).textContent || "") && /Admin code/.test(document.getElementById("churchCard").textContent));
  const card = await w.textContent("#churchCard");
  assert.match(card, /you're main admin/); assert.match(card, /User code [A-Z2-9]{8}/); assert.match(card, /No keys yet/);
  await w.close();
});
await check("no page errors", () => assert.deepEqual(errors.filter((e) => !/favicon|Failed to fetch|NetworkError|AbortError/.test(e)), []));

await browser.close(); driver.kill("SIGTERM"); web.kill();
console.log(failures ? "\n" + failures + " LICENSE CHECK(S) FAILED\n--- website ---\n" + webLog.slice(-1500) : "\nALL LICENSE APP CHECKS PASSED");
process.exit(failures ? 1 : 0);
