// 10.0 (website): the demo church's built-in keys and account, Purchases (the account icon), and downloads on our own
// address (/download/<app>/<platform>, /download/library/<id>, /install.sh) with GitHub behind them.
//   node test/v10web.mjs postgres://... [port]
import { spawn, execSync } from "node:child_process";
import { createRequire } from "node:module";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const db = process.argv[2] || "postgres://postgres@127.0.0.1:55432/ma", port = Number(process.argv[3] || 18997), base = "http://127.0.0.1:" + port;
const S = Date.now(), STAFF = "staffweb" + S + "@motion.test";
const mails = [];
const mailSrv = http.createServer((req, res) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => { mails.push(JSON.parse(b || "{}")); res.end('{"id":"x"}'); }); });
await new Promise((r) => mailSrv.listen(0, "127.0.0.1", r));
// a stand-in GitHub: the newest release's files, the Linux installer and the libraries' index
let ghUp = true;
const FILES = ["CentralControl-10.0.0-win-x64.exe", "CentralControl-10.0.0-mac-arm64.dmg", "CentralControl-10.0.0-mac-x64.dmg", "CentralControl-10.0.0-x86_64.AppImage", "CentralControl-10.0.0-amd64.deb",
  "CentralUsage-10.0.0-win-x64.exe", "CentralUsage-10.0.0.apk", "central-pedal-control-10.0.0-win-x64.exe", "central-pedal-control-10.0.0-android.apk", "central-services-10.0.0-mac-arm64.dmg", "SHA256SUMS"];
const gh = http.createServer((req, res) => {
  if (!ghUp) { res.statusCode = 502; return res.end("down"); }
  if (req.url === "/repos/MotionAudio/Central-Apps/releases/latest") { res.setHeader("Content-Type", "application/json"); return res.end(JSON.stringify({ tag_name: "v10.0.0", assets: FILES.map((n) => ({ name: n, size: 10, browser_download_url: "https://files.example/" + n })) })); }
  if (req.url === "/pages/install.sh") return res.end("#!/usr/bin/env bash\necho installing\n");
  if (req.url === "/libs/libraries-index.json") { res.setHeader("Content-Type", "application/json"); return res.end(JSON.stringify({ libraries: [{ id: "central-keys-library", plan: "keys", title: "Central Keys Library", version: "1.0", file: "central-keys-library-1.0.zip", size: 1000, sha256: "a".repeat(64) }] })); }
  res.statusCode = 404; res.end("{}");
});
await new Promise((r) => gh.listen(0, "127.0.0.1", r));
const GH = "http://127.0.0.1:" + gh.address().port;
process.env.DATABASE_URL = db;
const srv = spawn(process.execPath, [path.join(here, "..", "src", "index.js")], { env: Object.assign({}, process.env, { DATABASE_URL: db, PORT: String(port), STRIPE_SECRET_KEY: "", RESEND_API_KEY: "re_test", MAIL_FROM: "M <t@motion.test>",
  RESEND_API_URL: "http://127.0.0.1:" + mailSrv.address().port + "/emails", PUBLIC_URL: "https://motion.test", ADMIN_EMAILS: STAFF, REMINDERS: "off",
  CC_UPDATE_API: GH, CC_PAGES_URL: GH + "/pages", LIBRARIES_BASE_URL: GH + "/libs" }), stdio: ["ignore", "pipe", "pipe"] });
let log = ""; srv.stdout.on("data", (d) => { log += d; }); srv.stderr.on("data", (d) => { log += d; });
for (let i = 0; i < 100 && !/Motion Audio server on/.test(log); i++) await new Promise((r) => setTimeout(r, 100));

let fails = 0, ipN = 0;
const ok = (c, m, d) => { console.log((c ? "  ✓ " : "  ✗ ") + m + (c || d === undefined ? "" : "   -- " + JSON.stringify(d).slice(0, 700))); if (!c) fails++; };
const j = async (method, p, body, tok) => { const r = await fetch(base + "/v1" + p, { method, headers: { "Content-Type": "application/json", "X-Forwarded-For": "10.97." + (++ipN % 200) + ".1", ...(tok ? { Authorization: "Bearer " + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); return Object.assign(await r.json().catch(() => ({})), { _status: r.status }); };
const raw = (p) => fetch(base + p, { redirect: "manual" });
async function finish(r, email) {
  if (!r.step) return r;
  if (r.step === "phone") Object.assign(r, await j("POST", "/login/phone", { ticket: r.ticket, phone: "555-097-" + String(S).slice(-4) }));
  const m = mails.filter((x) => x.to && x.to[0] === email && /sign-in code/.test(x.subject)).pop();
  return Object.assign({}, r, { token: (await j("POST", "/login/code", { ticket: r.ticket, code: m.subject.match(/(\d{6})/)[1] })).token });
}
const dev = (n) => "dev-web-" + S + "-" + n;
const DEMO = { P: "PDMO-RVST-PCTL-2026", A: "ADMO-RVST-ADMN-2026", U: "UDMO-RVST-USER-2026" }, DEMO_EMAIL = "riverstone-demo@motionaudio.org", DEMO_PW = "Riverstone-Demo-2026";

try {
  const { q, one } = await import("../src/db.js");
  // ---------------------------------------------------------------- the demo church's keys
  console.log("\nThe demo church's keys:");
  const a = await j("POST", "/license/activate", { key: DEMO.A, device: dev(1), app: "control" });
  ok(a.ok && a.key === DEMO.A && a.kind === "A" && a.church === "Riverstone Church (demo)" && a.demoKey === true && a.updatesUntilText === "forever" && a.tracksUnlimited === true,
    "the demo A key works in Central Control, with the demo church's name and Central Tracks Unlimited", a);
  const u = await j("POST", "/license/activate", { key: "udmo-rvst-user-2026", device: dev(2), app: "usage" }), p = await j("POST", "/license/activate", { key: DEMO.P, device: dev(3), app: "pedal-control" });
  ok(u.ok && u.kind === "U" && u.church === "Riverstone Church (demo)" && u.tracksUnlimited === false && p.ok && p.kind === "P" && p.tracksUnlimited === true, "...the U key in Central Usage (any capitals), the P key in Central Pedal Control", { u, p });
  const wrong = await j("POST", "/license/activate", { key: DEMO.U, device: dev(4), app: "control" });
  ok(wrong._status === 400 && /Central Control needs an A key/.test(wrong.error), "each only for its own app", wrong);
  const chk = await j("POST", "/license/check", { key: DEMO.A, device: dev(77) });
  ok(chk.ok && chk.church === "Riverstone Church (demo)" && chk.demoKey === true, "the check: ok, with the demo church", chk);
  const pk = {};
  for (const [k, want] of [["SDMO-RVST-ALL0-2026", ["keys", "plugins", "instrument", "pedals", "pads"]], ["SDMO-RVST-KEYS-2026", ["keys", "pads"]], ["SDMO-RVST-PLUG-2026", ["plugins", "pads"]],
    ["SDMO-RVST-INST-2026", ["instrument", "pads"]], ["SDMO-RVST-PEDL-2026", ["pedals", "pads"]], ["SDMO-RVST-PADS-2026", ["pads"]]]) {
    const r = await j("POST", "/package/activate", { key: k, deviceId: dev(5), app: "usage" });
    pk[k] = r.ok && r.church === "Riverstone Church (demo)" && r.demoKey === true && JSON.stringify(Object.keys(r.plans).sort()) === JSON.stringify(want.slice().sort()) ? "ok" : r;
  }
  ok(Object.values(pk).every((x) => x === "ok"), "the six demo package keys: all plans, then one plan each (with Central Pads) - only their own plans", pk);
  const pc = await j("POST", "/package/check", { keys: ["SDMO-RVST-KEYS-2026"], deviceId: dev(99) });
  ok(pc.packages[0].ok && pc.packages[0].plans.keys && pc.packages[0].plans.pads && !pc.packages[0].plans.plugins, "the package check: the Central Keys demo key opens Keys and Pads, not Plugins", pc);
  ok(!(await q("SELECT 1 FROM licenses WHERE regexp_replace(key,'-','','g') LIKE '%RVST%'")).length && !(await q("SELECT 1 FROM package_keys WHERE key LIKE '%RVST%'")).length, "no rows: the demo keys are built in");

  // ---------------------------------------------------------------- the demo account
  console.log("\nThe demo account:");
  const li = await j("POST", "/login", { email: DEMO_EMAIL, password: DEMO_PW, device: "browser-web-" + S });
  ok(li.token && !li.step, "it signs in with the shared password and no phone code (it was made when the server started)", li);
  const me = await j("GET", "/me", null, li.token);
  ok(me.email === DEMO_EMAIL && me.subscribed === true && me.church && me.church.name === "Riverstone Church (demo)" && me.emailConfirmed === true, "...its church is Riverstone Church (demo), with Central Tracks Unlimited", me);
  const pu = await j("GET", "/purchases", null, li.token), demo = (pu.purchases || []).find((x) => x.type === "demo");
  ok(demo && demo.apps.length === 3 && demo.apps.map((x) => x.keys[0].key).sort().join() === Object.values(DEMO).sort().join() && demo.packages.length === 6 && demo.libraries.length === 5
    && demo.apps.every((x) => x.links.windows && x.links.windows.startsWith("https://motion.test/download/")), "Purchases: the demo keys (3 apps, 6 packages), the libraries and our own download links", demo);
  const del = await j("POST", "/account/delete", { password: DEMO_PW }, li.token), fg = await j("POST", "/password/forgot", { email: DEMO_EMAIL }), ph = await j("POST", "/account/phone", { password: DEMO_PW, phone: "555-111-2222" }, li.token);
  ok(del._status === 403 && fg._status === 403 && ph._status === 403, "it can't be deleted, have its password reset or get a phone", { del, fg, ph });
  const before = mails.length;
  const c = await one("SELECT c.* FROM churches c JOIN church_members m ON m.church_id=c.id JOIN users u ON u.id=m.user_id WHERE u.email=$1", [DEMO_EMAIL]);
  ok(c && c.demo === true, "its church is marked as the demo", c && c.demo);

  // ---------------------------------------------------------------- Purchases for a buyer
  console.log("\nPurchases:");
  const buyer = "buyer" + S + "@grace.test";
  const b = await j("POST", "/signup", { email: buyer, password: "password123", name: "Bea" });
  const bu = await one("SELECT * FROM users WHERE email=$1", [buyer]);
  const o = await one("INSERT INTO orders (user_id,email,stripe_session,items,total_cents,status) VALUES ($1,$2,$3,$4,$5,'paid') RETURNING *", [bu.id, buyer, "cs_web_" + S, { user: 1, "pedal-control": 1 }, 7000]);
  await q("INSERT INTO licenses (key,order_id,product,kind,user_id,updates_until) VALUES ($1,$2,'user','U',$3,104), ($4,$2,'pedal-control','P',$3,NULL)", ["UWEB" + String(S).slice(-12), o.id, bu.id, "PWEB" + String(S).slice(-12)]);
  const sub = await one("INSERT INTO plan_subs (kind,user_id,plans,seats,cents,status,period_end) VALUES ('person',$1,$2,1,7000,'active',now() + interval '300 days') RETURNING *", [bu.id, ["keys"]]);
  await q("INSERT INTO package_keys (key,plans,plan_sub_id,user_id,holder_email,holder_name) VALUES ($1,$2,$3,$4,$5,'Bea')", ["SWEB" + String(S).slice(-12), ["keys"], sub.id, bu.id, buyer]);
  const bp = await j("GET", "/purchases", null, b.token);
  const ord = bp.purchases.find((x) => x.type === "order"), plan = bp.purchases.find((x) => x.type === "plan");
  ok(ord && /Central Usage key/.test(ord.title) && ord.apps.length === 2 && ord.apps.find((x) => x.kind === "U").keys[0].updatesUntil === "10.4" && ord.apps.find((x) => x.kind === "P").links.android === "https://motion.test/download/pedal-control/android"
    && ord.apps.every((x) => x.steps.windows && /install\.sh \| bash -s/.test(x.linuxCommand) && x.linuxCommand.startsWith("curl -fsSL https://motion.test/install.sh")),
    "an order: what it was, each app's keys, download links on our address, install steps and the Linux line", ord);
  ok(plan && /Central Keys/.test(plan.title) && plan.packages.length === 1 && plan.libraries.map((x) => x.plan).join() === "keys,pads" && plan.libraries[0].link === "https://motion.test/download/library/keys" && plan.renews && /One key opens everything/.test(plan.oneKey),
    "a sound plan: ONE key opens the whole plan, its libraries (with Central Pads), when it renews", plan);
  const anon = await j("GET", "/purchases");
  ok(anon._status === 401, "Purchases needs signing in", anon._status);

  // ---------------------------------------------------------------- downloads on our own address
  console.log("\nDownloads:");
  const r1 = await raw("/download/control/windows"), r2 = await raw("/download/usage/android"), r3 = await raw("/download/control/mac-intel");
  ok(r1.status === 302 && r1.headers.get("location") === "https://files.example/CentralControl-10.0.0-win-x64.exe" && r2.headers.get("location") === "https://files.example/CentralUsage-10.0.0.apk" && r3.headers.get("location").endsWith("mac-x64.dmg"),
    "/download/<app>/<platform> sends the browser on to the newest release's file", [r1.status, r1.headers.get("location"), r2.headers.get("location")]);
  const r4 = await raw("/download/usage/linux"), r5 = await raw("/download/nothing/windows");
  ok(r4.status === 404 && /isn't in this release/.test(await r4.text()) && r5.status === 404 && !/github/i.test(await r5.text()), "not in the release, or no such app: our own page, no GitHub", [r4.status, r5.status]);
  const lib = await raw("/download/library/keys"), lib2 = await raw("/download/library/central-keys-library");
  ok(lib.status === 302 && lib.headers.get("location") === GH + "/libs/central-keys-library-1.0.zip" && lib2.status === 302, "/download/library/<id or plan> sends it on to the library's file", [lib.status, lib.headers.get("location")]);
  const sh = await fetch(base + "/install.sh");
  ok(sh.ok && /installing/.test(await sh.text()), "/install.sh: the Linux installer, from our address");
  ghUp = false;
  const r6 = await raw("/download/control/linux-deb");
  ok(r6.status === 302 && r6.headers.get("location").endsWith("amd64.deb"), "GitHub down: the last list read still works", r6.status);
  ghUp = true;
  const av = await j("GET", "/downloads/available");
  ok(av.version === "10.0.0" && av.apps.control.includes("windows") && !av.apps.usage.includes("linux"), "/v1/downloads/available: the version and which files each app has", av);
  const pub = await j("GET", "/downloads/apps");
  ok(pub.apps.every((x) => x.links && Object.values(x.links).every((l) => l.startsWith("https://motion.test/download/")) && !/github/i.test(x.download + x.linuxCommand)) && !/github/i.test(JSON.stringify(pub)),
    "the public Downloads data: only our own links, no GitHub anywhere", pub.apps.map((x) => x.download));
  const html = await (await fetch(base + "/")).text(), help = await (await fetch(base + "/help/install.html")).text(), appsPage = await (await fetch(base + "/apps/")).text();
  ok(!/github\.(com|io)/i.test(html + help + appsPage), "the home page, the install guide and the apps page don't link to GitHub");

  // ---------------------------------------------------------------- in the browser: the account icon → Purchases
  let pw = null; try { pw = createRequire(import.meta.url)("playwright"); } catch (_) { try { pw = createRequire(execSync("npm root -g").toString().trim() + "/")("playwright"); } catch (_) { } }
  if (pw) {
    console.log("\nIn the browser:");
    const browser = await pw.chromium.launch(), page = await browser.newPage({ viewport: { width: 1280, height: 900 } }), errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    try {
      await page.goto(base + "/"); await page.evaluate((t) => localStorage.setItem("ma-token", t), b.token); await page.goto(base + "/"); await page.waitForSelector("#acctMenu:not([hidden])", { timeout: 8000 });
      ok(!(await page.isVisible("#acctLink")) && await page.isVisible("#acctIcon"), "signed in: an account icon instead of the Sign in link");
      await page.click("#acctIcon");
      const items = await page.$$eval("#acctDrop a, #acctDrop button", (x) => x.map((e) => e.textContent.trim()));
      ok(JSON.stringify(items) === JSON.stringify(["Account", "Purchases", "Downloads", "Sign out"]) && /Bea/.test(await page.textContent("#acctWho")), "its menu: Account, Purchases, Downloads, Sign out (with who's signed in)", items);
      await page.click('#acctDrop a[href="#purchases"]'); await page.waitForSelector("#purchases:not([hidden]) .pu-card", { timeout: 8000 });
      const t = await page.textContent("#purchases"), dl = await page.$$eval("#purchases a.btn", (x) => x.map((e) => e.getAttribute("href")));
      ok(/Central Usage key/.test(t) && /Package key/.test(t) && /One key opens everything/.test(t) && /Next renewal/.test(t) && /UWEB/.test(t) && dl.some((h) => /\/download\/(usage|pedal-control)\//.test(h)) && dl.some((h) => /\/download\/library\/keys$/.test(h)) && dl.every((h) => !/github/i.test(h)),
        "Purchases: the order and the plan, their keys, our own download buttons, the library, the renewal date", { dl });
      ok(await page.isHidden("#acctDrop") && (await page.$$("#purchases [data-copy]")).length >= 3, "the menu closed; each key has Copy");
      if (process.env.SHOTS) { await page.locator("#purchases").screenshot({ path: process.env.SHOTS + "/purchases.png" }); await page.click("#acctIcon"); await page.screenshot({ path: process.env.SHOTS + "/menu.png", clip: { x: 640, y: 0, width: 640, height: 320 } }); await page.click("#acctIcon"); }
      await page.evaluate(() => { location.hash = "downloads"; }); await page.waitForSelector("#downloads:not([hidden]) .dl-card", { timeout: 8000 });
      ok(await page.isHidden("#purchases") && !/github/i.test(await page.innerHTML("#downloads")), "Downloads replaces it, with no GitHub links");
      ok(!errs.length, "no script errors", errs);
    } finally { await browser.close(); }
  } else console.log("  - browser checks skipped: Playwright isn't installed");

  // ---------------------------------------------------------------- the switch: demo keys and account go with the default keys
  console.log("\nThe switch:");
  const st = (await finish(await j("POST", "/signup", { email: STAFF, password: "password123" }), STAFF)).token;
  const g = await j("GET", "/admin/default-keys", null, st);
  ok(g.demo && g.demo.church === "Riverstone Church (demo)" && g.demo.keys.A === DEMO.A && Object.keys(g.demo.packages).length === 6, "the staff card lists the demo keys", g.demo);
  await j("POST", "/admin/default-keys", { on: false }, st);
  const off1 = await j("POST", "/license/check", { key: DEMO.A, device: dev(1) }), off2 = await j("POST", "/package/activate", { key: "SDMO-RVST-ALL0-2026", deviceId: dev(6), app: "usage" }), off3 = await j("POST", "/login", { email: DEMO_EMAIL, password: DEMO_PW, device: "b2-" + S });
  ok(off1.ok === false && off2.ok === false && off3._status === 403, "off: the demo keys stop and the demo account can't sign in", { off1, off2, off3 });
  await j("POST", "/admin/default-keys", { on: true }, st);
  ok(mails.length === before || !mails.slice(before).some((m) => m.to && m.to[0] === DEMO_EMAIL), "no email ever went to the demo account");
} catch (e) { console.error(e); fails++; }
finally { srv.kill(); mailSrv.close(); gh.close(); if (fails) console.log(log.slice(-3000)); console.log(fails ? "\n" + fails + " CHECK(S) FAILED" : "\nALL CHECKS PASSED"); process.exit(fails ? 1 : 0); }
