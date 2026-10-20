// Central Services as the real Electron app, against the real website (server/, on a Postgres) and a stand-in GitHub:
// a new version found when it opens is announced and installs by itself after 10 seconds ("Not now" skips it); the
// website's address is set in ⚙ App settings; signing in, the account decides what it is - a scheduler (the main
// admin) or a team member, who sees the request and accepts it.
//   bash prepare.sh && MA_DATABASE_URL=postgres://... MA_SERVER_DIR=../server ELECTRON_PATH=... xvfb-run -a node test-app.mjs
import { _electron as electron } from "playwright";
import http from "node:http"; import crypto from "node:crypto"; import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import assert from "node:assert";
import { spawn } from "node:child_process"; import { fileURLToPath, pathToFileURL } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const DB = process.env.MA_DATABASE_URL, SRV = process.env.MA_SERVER_DIR || path.join(here, "..", "server");
if (!DB) { console.log("SKIP: set MA_DATABASE_URL (a Postgres for the website) to run the Central Services app checks"); process.exit(0); }
let failures = 0; async function check(label, fn) { try { await fn(); console.log("  ✓ " + label); } catch (e) { failures++; console.error("  ✗ " + label + "\n      " + String(e && e.message || e).split("\n").slice(0, 6).join("\n      ")); } }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// a stand-in for api.github.com: the official releases have Central Services 9.5.0
const deb = Buffer.from("!<arch>\nfake central-services 9.5.0\n");
const gh = http.createServer((req, res) => {
  const base = "http://127.0.0.1:" + gh.address().port, send = (b, type) => { res.writeHead(200, { "Content-Type": type || "application/json" }); res.end(b); };
  const rel = (r) => (req.url.includes("?") ? [r] : r);   // (the updater reads the list of releases; older tools the newest one)
  if (req.url === "/repos/MotionAudio/Central-Apps/releases/latest" || req.url.startsWith("/repos/MotionAudio/Central-Apps/releases?")) return send(JSON.stringify(rel({ tag_name: "v9.5.0", body: "Schedules", assets: [
    { name: "central-services-9.5.0-amd64.deb", browser_download_url: base + "/dl/deb" }, { name: "central-services-9.5.0-x86_64.AppImage", browser_download_url: base + "/dl/ai" }, { name: "SHA256SUMS", browser_download_url: base + "/dl/sums" }] })));
  if (req.url === "/dl/sums") return send(crypto.createHash("sha256").update(deb).digest("hex") + "  central-services-9.5.0-amd64.deb\n", "text/plain");
  res.writeHead(404); res.end();
});
await new Promise((r) => gh.listen(0, "127.0.0.1", r));

// the website, with a church that has Central Services (a pack), a team and a service asking a member
const PORT = 18894, WEB = "http://127.0.0.1:" + PORT, S = Date.now();
const web = spawn(process.execPath, [path.join(SRV, "src", "index.js")], { env: Object.assign({}, process.env, { DATABASE_URL: DB, PORT: String(PORT), STRIPE_SECRET_KEY: "", RESEND_API_KEY: "" }), stdio: ["ignore", "pipe", "pipe"] });
let webLog = ""; web.stdout.on("data", (d) => { webLog += d; }); web.stderr.on("data", (d) => { webLog += d; });
for (let i = 0; i < 150 && !/Motion Audio server on/.test(webLog); i++) await wait(100);
const j = async (method, p, body, tok) => { const r = await fetch(WEB + "/v1" + p, { method, headers: { "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); return Object.assign(await r.json().catch(() => ({})), { _status: r.status }); };
const owner = await j("POST", "/signup", { email: "pastor" + S + "@faith.test", password: "password123", name: "Pastor Ann", churchName: "Faith Church " + S });
process.env.DATABASE_URL = DB;
const { recordOrder } = await import(pathToFileURL(path.join(SRV, "src", "payments.js")).href);
const { one } = await import(pathToFileURL(path.join(SRV, "src", "db.js")).href);
const cid = (await one("SELECT id FROM churches WHERE owner_id=(SELECT id FROM users WHERE email=$1)", ["pastor" + S + "@faith.test"])).id;
await recordOrder({ id: "cs_app_" + S, metadata: { items: JSON.stringify({ "pack-small": "1" }), church_id: String(cid) }, amount_total: 30000, customer_details: { email: "p@faith.test" } }, null);
await one("UPDATE churches SET has_services=TRUE WHERE id=$1 RETURNING id", [cid]);   // (Central Services' monthly plan, as Stripe's webhook records it)
const userCode = (await j("GET", "/church", null, owner.token)).church.userCode;
await j("POST", "/signup", { email: "keys" + S + "@faith.test", password: "password123", name: "Kim Keys", churchCode: userCode, churchRole: "user" });
const team = await j("POST", "/services/teams", { kind: "worship", name: "Worship A" }, owner.token);
await j("POST", "/services/teams/" + team.id + "/members", { members: [{ name: "Kim Keys", email: "keys" + S + "@faith.test", role: "Keys" }] }, owner.token);
await j("POST", "/services/events", { title: "Sunday 9am", startsAt: new Date(Date.now() + 5 * 864e5).toISOString(), teams: [team.id], email: false }, owner.token);

const exe = [process.env.ELECTRON_PATH, path.join(here, "node_modules", "electron", "dist", "electron")].filter((p) => p && fs.existsSync(p))[0];
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "cs-app-"));
const app = await electron.launch({ executablePath: exe, args: [path.join(here, "main.js"), "--no-sandbox", "--user-data-dir=" + userData], env: Object.assign({}, process.env, { CC_UPDATE_API: "http://127.0.0.1:" + gh.address().port }) });
const win = await app.firstWindow(); const errors = []; win.on("pageerror", (e) => errors.push(String(e)));
win.on("dialog", (d) => d.accept());

await check("it opens on sign-in; with no website address yet it says where to put it", async () => {
  await win.waitForFunction(() => window.CentralServices && document.querySelector(".center"));
  assert.match(await win.textContent("#root"), /App settings/);
});
await check("a new version found when it opens: a 10-second notice, then it would install by itself; Not now skips it", async () => {
  await win.waitForFunction(() => document.getElementById("csUpd") && /Updating Central Services to 9\.5\.0 in \d+ s/.test(document.getElementById("csUpd").textContent), null, { timeout: 15000 });
  assert.match(await win.textContent("#csUpd"), /nothing is lost/);
  await win.click('#csUpd [data-a="upnot"]'); await wait(1500);
  assert.equal(await win.evaluate(() => !!document.getElementById("csUpd")), false);
  assert.equal(await win.evaluate(() => CentralServices.updates().busy), false, "nothing installs");
});
await check("⚙ App settings: the website's address, and Install by itself (on; it can be turned off)", async () => {
  await win.click('[data-tab="app"]'); await win.waitForSelector("#aServer");
  assert.equal(await win.evaluate(() => document.getElementById("aAuto").checked), true);
  await win.fill("#aServer", WEB); await win.evaluate(() => { document.getElementById("aAuto").checked = false; }); await win.click('[data-a="saveapp"]');
  await win.waitForFunction(() => document.getElementById("sEmail"));
  const st = await win.evaluate(() => window.CSDesktop.updates.status()); assert.equal(st.autoInstall, false);
  await win.evaluate(() => window.CSDesktop.updates.config({ autoInstall: true }));
});
await check("the main admin signs in: the church's name, Main admin and Scheduler, opening on the schedule; the new service is on it", async () => {
  await win.fill("#sEmail", "pastor" + S + "@faith.test"); await win.fill("#sPass", "password123"); await win.click('[data-a="login"]');
  await win.waitForFunction(() => document.querySelector("header h1"));
  assert.equal(await win.textContent("header h1"), "Faith Church " + S);
  assert.equal(await win.textContent("header .badge"), "Main admin");
  assert.equal(await win.textContent("header .badge.sched"), "Scheduler");
  assert.ok(await win.evaluate(() => document.querySelector('[data-tab="schedule"]').classList.contains("on")), "an admin opens on the whole schedule");
  assert.ok(await win.evaluate(() => !!document.querySelector('[data-tab="new"]')), "a scheduler can make services");
  await win.click('[data-tab="schedule"]'); await win.waitForFunction(() => /Sunday 9am[\s\S]*Kim Keys[\s\S]*Not yet/.test(document.getElementById("root").textContent));
  await win.click('[data-a="logout"]');
});
await check("a team member signs in: User, opening on My requests, no + New service; they accept the request and the schedule shows it", async () => {
  await win.waitForFunction(() => document.getElementById("sEmail"));
  await win.fill("#sEmail", "keys" + S + "@faith.test"); await win.fill("#sPass", "password123"); await win.click('[data-a="login"]');
  await win.waitForFunction(() => document.querySelector("header .badge"));
  assert.equal(await win.textContent("header .badge"), "User");
  assert.equal(await win.evaluate(() => !!document.querySelector("header .badge.sched")), false);
  assert.ok(await win.evaluate(() => document.querySelector('[data-tab="mine"]').classList.contains("on")), "a user opens on their own requests");
  assert.equal(await win.evaluate(() => !!document.querySelector('[data-tab="new"]')), false);
  await win.waitForSelector('[data-ans="accepted"]'); await win.click('[data-ans="accepted"]');
  await win.click('[data-tab="schedule"]'); await win.waitForFunction(() => /Kim Keys[\s\S]*✓ Yes/.test(document.getElementById("root").textContent));
});
await check("no page errors", () => assert.deepEqual(errors, []));

await app.close(); web.kill(); gh.close();
console.log(failures ? "\n" + failures + " CENTRAL SERVICES APP CHECK(S) FAILED\n" + webLog.slice(-800) : "\nALL CENTRAL SERVICES APP CHECKS PASSED");
process.exit(failures ? 1 : 0);
