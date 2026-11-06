// 10.3: the website's new pages in a real browser (Playwright), against a stand-in Stripe (its API, its payment form
// and its signed webhooks): every way to buy - an app key from an app page ("Just me"), a church pack from Pricing with
// a code and more than one, a sound plan from its page, a church bundle from "Which plan do I need?", Central Tracks
// Unlimited from its page - each to the thank-you page with the keys; the cart kept from page to page and through
// signing in; the Apps and Sounds menus; Account → My products (keys, Copy, the devices with Release, downloads,
// renewal) and Help & tickets; the Help Center (search over guides and questions, Contact support with its hidden box
// for robots, the ticket link, staff answering on the Support card); and the status page.
//   node test/v103-site.mjs postgres://.../ma [port] [screenshot folder]      (needs: npm i -g playwright)
import { spawn, execSync } from "node:child_process";
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Stripe from "stripe";

const here = path.dirname(fileURLToPath(import.meta.url));
const db = process.argv[2] || "postgres://postgres@127.0.0.1:55432/ma", port = Number(process.argv[3] || 18940), base = "http://127.0.0.1:" + port;
const shots = process.argv[4] || ""; if (shots) fs.mkdirSync(shots, { recursive: true });
let pw; try { pw = createRequire(import.meta.url)("playwright"); } catch (_) { try { pw = createRequire(execSync("npm root -g").toString().trim() + "/")("playwright"); } catch (_) { console.log("  - skipped: Playwright isn't installed (npm i -g playwright)"); process.exit(0); } }
const S = Date.now(), WHSEC = "whsec_test103", HELP = "support@motion.test", STAFF = "staff103-" + S + "@motion.test";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "v103-"));

// ---- email: a stand-in Resend
const mails = [];
const mailSrv = http.createServer((req, res) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => { mails.push(JSON.parse(b || "{}")); res.end('{"id":"x"}'); }); });
await new Promise((r) => mailSrv.listen(0, "127.0.0.1", r));
const to = (who, re) => mails.filter((m) => m.to && m.to[0] === who && (!re || re.test(m.subject)));
const waitMail = async (who, re) => { for (let i = 0; i < 60; i++) { const m = to(who, re).pop(); if (m) return m; await new Promise((r) => setTimeout(r, 100)); } return null; };
const codeIn = (m) => (m && (m.subject.match(/(\d{6})/) || m.text.match(/(\d{6})/)) || [])[1];

// ---- a stand-in Stripe: the API the server calls
const calls = []; let n = 0;
function nest(params) { const out = {}; for (const [k, v] of params) { const parts = k.replace(/\]/g, "").split("["); let o = out; parts.forEach((p, i) => { const last = i === parts.length - 1, nextNum = !last && /^\d+$/.test(parts[i + 1]); if (last) o[p] = v; else { o[p] = o[p] || (nextNum ? [] : {}); o = o[p]; } }); } return out; }
const stripeSrv = http.createServer((req, res) => {
  let raw = ""; req.on("data", (d) => (raw += d)); req.on("end", () => {
    const u = new URL(req.url, "http://x"), body = /json/.test(req.headers["content-type"] || "") ? JSON.parse(raw || "{}") : nest(new URLSearchParams(raw));
    calls.push({ method: req.method, path: u.pathname, body });
    const send = (o, code = 200) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); }, p = u.pathname;
    if (p === "/v1/customers") return send({ id: "cus_" + ++n, object: "customer" });
    if (p.startsWith("/v1/customers/")) return send({ id: p.split("/")[3], object: "customer" });
    if (p === "/v1/coupons") return send({ id: body.id, object: "coupon", percent_off: Number(body.percent_off), duration: body.duration });
    if (/^\/v1\/checkout\/sessions\/[^/]+\/expire$/.test(p)) return send({ id: p.split("/")[4], object: "checkout.session", status: "expired" });
    if (p === "/v1/checkout/sessions") { const id = "cs_test_" + S + "_" + ++n; return send({ id, object: "checkout.session", client_secret: id + "_secret", url: null }); }
    if (p.startsWith("/v1/payment_intents/")) { const id = p.split("/")[3]; return send({ id, object: "payment_intent", latest_charge: { id: "ch_" + id, object: "charge" } }); }
    if (p === "/v1/billing_portal/sessions") return send({ id: "bps_1", url: "https://billing.stripe.test/p" });
    send({ error: { message: "stand-in Stripe doesn't know " + req.method + " " + p, type: "invalid_request_error" } }, 404);
  });
});
await new Promise((r) => stripeSrv.listen(0, "127.0.0.1", r));
const sessions = () => calls.filter((c) => c.path === "/v1/checkout/sessions");
const signer = new Stripe("sk_test_103");
async function hook(type, object) {
  const payload = JSON.stringify({ id: "evt_" + ++n, object: "event", type, data: { object } });
  return (await fetch(base + "/stripe/webhook", { method: "POST", headers: { "Content-Type": "application/json", "Stripe-Signature": signer.webhooks.generateTestHeaderString({ payload, secret: WHSEC }) }, body: payload })).status;
}
// ---- Stripe's payment form in the page: a stand-in with one Pay button; paying goes back to the return address
const STRIPE_JS = `window.Stripe = function () { return { initCheckoutFormSdk: function (o) { var secret = null, ready = Promise.resolve(o.clientSecret).then(function (s) { secret = s; }), onConfirm = null;
  return { createForm: function () { return { mount: function (sel) { var el = document.querySelector(sel); el.innerHTML = '<button type="button" id="stubPay" class="btn">Pay (test)</button>'; el.querySelector("#stubPay").onclick = function () { onConfirm && onConfirm({}); }; }, on: function (ev, fn) { if (ev === "confirm") onConfirm = fn; } }; },
    loadActions: function () { return ready.then(function () { return { type: "success", actions: { confirm: function () { window.__paid = secret.replace(/_secret$/, ""); return Promise.resolve({ type: "success" }); } } }; }); } }; } }; };`;

const srv = spawn(process.execPath, [path.join(here, "..", "src", "index.js")], { env: Object.assign({}, process.env, { DATABASE_URL: db, PORT: String(port), STRIPE_SECRET_KEY: "sk_test_103", STRIPE_PUBLISHABLE_KEY: "pk_test_103", STRIPE_WEBHOOK_SECRET: WHSEC,
  STRIPE_API_URL: "http://127.0.0.1:" + stripeSrv.address().port, RESEND_API_KEY: "re_test", MAIL_FROM: "M <t@motion.test>", RESEND_API_URL: "http://127.0.0.1:" + mailSrv.address().port + "/emails",
  PUBLIC_URL: base, ADMIN_EMAILS: STAFF, REMINDERS: "off", SUPPORT_EMAIL: HELP, STATUS_CHECKS: "off", CC_UPDATE_API: "http://127.0.0.1:9", LOCAL_STORAGE_DIR: path.join(tmp, "files"), HYMNS: "off" }), stdio: ["ignore", "pipe", "pipe"] });
let log = ""; srv.stdout.on("data", (d) => (log += d)); srv.stderr.on("data", (d) => (log += d));
for (let i = 0; i < 150 && !/Motion Audio server on/.test(log); i++) await new Promise((r) => setTimeout(r, 100));

let fails = 0;
const ok = (c, m, d) => { console.log((c ? "  ✓ " : "  ✗ ") + m + (c || d === undefined ? "" : "   -- " + (typeof d === "object" ? JSON.stringify(d) : String(d)).slice(0, 600))); if (!c) fails++; };
let ip = 0;
const j = async (method, p, body, tok) => { const r = await fetch(base + "/v1" + p, { method, headers: Object.assign({ "Content-Type": "application/json", "X-Forwarded-For": "10.103." + (++ip % 200) + ".9" }, tok ? { Authorization: "Bearer " + tok } : {}), body: body ? JSON.stringify(body) : undefined }); return Object.assign(await r.json().catch(() => ({})), { _status: r.status }); };
// an account (test only): signed up, the phone and code if it asks (no Twilio here: the code comes by email), email confirmed
async function account(email, extra) {
  let r = await j("POST", "/signup", Object.assign({ email, password: "pass-" + S + "-x", name: email.split("@")[0], device: "t103" }, extra || {}));
  if (r.step) {
    if (r.step === "phone") Object.assign(r, await j("POST", "/login/phone", { ticket: r.ticket, phone: "555-013-" + String(S + mails.length).slice(-4) }));
    const m = await waitMail(email, /code/i), codes = to(email, /code/i).map(codeIn);
    r = await j("POST", "/login/code", { ticket: r.ticket, code: codeIn(m), emailCode: codes[codes.length - 1], device: "t103" });
  }
  const cm = await waitMail(email, /Confirm your email/); if (cm) await j("POST", "/account/confirm", { token: cm.text.match(/#confirm-([A-Za-z0-9_-]+)/)[1] });
  return r.token;
}

const browser = await pw.chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const errors = [];
async function newPage(token, vp) {
  const ctx = await browser.newContext({ viewport: vp || { width: 1280, height: 900 } });
  await ctx.route("https://js.stripe.com/**", (r) => r.fulfill({ status: 200, contentType: "application/javascript", body: STRIPE_JS }));
  await ctx.route("https://connect-js.stripe.com/**", (r) => r.fulfill({ status: 200, contentType: "application/javascript", body: "" }));
  if (token) await ctx.addInitScript((t) => { try { localStorage.setItem("ma-token", t); } catch (_) { } }, token);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(p.url().replace(base, "") + ": " + e.message)); p.on("dialog", (d) => d.accept());
  return p;
}
let shotN = 0; const shot = async (p, name, full) => { if (shots) await p.screenshot({ path: path.join(shots, String(++shotN).padStart(2, "0") + "-" + name + ".png"), fullPage: !!full }); };
// pay in the stand-in form, Stripe says it's paid (the signed webhook), and the browser goes back where Stripe sends it
async function pay(p, paidObject) {
  await p.waitForSelector("#stubPay", { timeout: 8000 });
  // (on a slow machine the form can be on screen before its Pay handler is ready: press again until it's paid)
  for (let i = 0; i < 4; i++) { await p.click("#stubPay").catch(() => { }); if (await p.waitForFunction(() => !!window.__paid, null, { timeout: 5000 }).then(() => true, () => false)) break; }
  await p.waitForFunction(() => !!window.__paid, null, { timeout: 2000 });
  const id = await p.evaluate(() => window.__paid), s = sessions().pop().body;
  const st = await hook("checkout.session.completed", Object.assign({ id, object: "checkout.session", payment_status: "paid", payment_intent: "pi_" + id, amount_total: 1, customer_details: { email: "buyer@grace103.test" } }, paidObject || {}));
  await p.goto(s.return_url.replace("{CHECKOUT_SESSION_ID}", id));
  return { id, session: s, hook: st };
}

try {
  // ---------------------------------------------------------------- the pages and the menus, as a visitor
  {
    const p = await newPage();
    await p.goto(base + "/", { waitUntil: "networkidle" });
    await p.hover("#siteNav .dd-btn >> nth=0"); await p.waitForSelector("#ddApps a", { state: "visible" });
    const apps = await p.$$eval("#ddApps a b", (x) => x.map((e) => e.textContent));
    ok(apps.join() === "Central Pedal,Central Pedal Control,Central Control,Central Usage,Central Services,Central Production", "the Apps menu: a page for each of the six apps", apps);
    await p.click("#ddApps a[href='/apps/usage/']"); await p.waitForSelector("h1");
    const t = await p.textContent("main");
    ok(/Each musician's chart, sound and mix/.test(t) && await p.$$eval(".fgroup", (x) => x.length) >= 3 && /Musician/.test(await p.textContent(".hero2 .chips")) && /iPhone and iPad/.test(t) && /Android/.test(t) && await p.$eval(".hero2 figure img", (i) => i.naturalWidth > 0),
      "Central Usage's page: a real screenshot, every feature in groups, who it's for, where it runs");
    await p.waitForFunction(() => /\$\d/.test(document.querySelector(".hero2 [data-price-of=user]").textContent), null, { timeout: 5000 }).catch(() => {});
    ok(/\$\d+/.test(await p.textContent(".hero2 [data-price-of=user]")) && /Central Usage/.test(await p.title()) && /og\/app-usage\.jpg$/.test(await p.$eval('meta[property="og:image"]', (m) => m.content)) && await p.$eval('meta[property="og:image"]', (m) => m.content.startsWith("http")),
      "...its price from the server, its own title and picture to share (with the site's address)");
    await shot(p, "app-usage");
    await p.goto(base + "/apps/", { waitUntil: "networkidle" });
    ok(await p.$$eval(".app-card", (x) => x.length) === 6 && await p.$$eval("table.cmp tbody tr", (x) => x.length) >= 8, "the Apps page: six apps and which ones a church needs");
    await p.hover("#siteNav .dd-btn >> nth=1"); await p.waitForSelector("#ddSounds a", { state: "visible" });
    ok((await p.$$eval("#ddSounds a b", (x) => x.map((e) => e.textContent))).length === 7, "the Sounds menu: the six plans and Central Tracks Unlimited");
    await p.goto(base + "/sounds/utility/", { waitUntil: "networkidle" });
    await p.evaluate(async () => { const all = [...document.querySelectorAll("#utilBgs img, #utilThemes img")]; all.forEach((i) => (i.loading = "eager")); await Promise.all(all.map((i) => i.decode().catch(() => {}))); });
    ok(await p.$$eval("#utilBgs img", (x) => x.length >= 8 && x.every((i) => i.complete && i.naturalWidth > 0)) && await p.$$eval("#utilThemes img", (x) => x.length >= 4 && x.every((i) => i.naturalWidth > 0)), "Central Utility's page shows its backgrounds and slide themes");
    await p.goto(base + "/sounds/keys/", { waitUntil: "networkidle" });
    ok(await p.$$eval(".item", (x) => x.length) >= 8 && /Central Keys/.test(await p.textContent(".item .chip.plan")) && /Free/.test(await p.textContent(".free-list")), "Central Keys' page: its best sounds with a plan badge, and what's free");
    await p.goto(base + "/status/", { waitUntil: "networkidle" }); await p.waitForSelector(".svc");
    ok(await p.$$eval(".svc", (x) => x.length) === 5 && await p.$$eval(".svc .hist i", (x) => x.length) === 5 * 48, "the status page: five services, each with 24 hours of history");
    // phone: the Menu button opens the menus
    const ph = await newPage(null, { width: 390, height: 844 });
    await ph.goto(base + "/apps/control/", { waitUntil: "networkidle" });
    ok(!(await ph.isVisible("#navMain")) && await ph.isVisible("#navToggle") && await ph.isVisible("#cartBtn"), "phone: the cart and a Menu button");
    await ph.click("#navToggle"); await ph.click("#siteNav .dd-btn >> nth=0");
    ok(await ph.isVisible("#ddApps a[href='/apps/pedal/']") && (await ph.evaluate(() => document.documentElement.scrollWidth)) <= 391, "...Menu → Apps lists the apps, and nothing scrolls sideways");
    await shot(ph, "phone-menu");
    await ph.context().close(); await p.context().close();
  }

  // ---------------------------------------------------------------- 1. an app key from its page, "Just me", signing in on the way
  const ME = "me103-" + S + "@grace103.test", meTok = await account(ME);
  {
    const p = await newPage();
    await p.goto(base + "/apps/usage/", { waitUntil: "networkidle" });
    await p.click(".hero2 [data-add=user]"); await p.waitForTimeout(200);
    ok((await p.textContent("#cartBtn")).includes("1") && await p.isVisible(".toast button"), "add to cart from an app page: the cart counts 1, with View cart");
    await p.goto(base + "/sounds/", { waitUntil: "networkidle" });
    ok((await p.textContent("#cartBtn")).includes("1"), "the cart follows you to the next page");
    await p.click("#cartBtn"); await p.waitForSelector(".modal [data-q=user][data-d='1']");
    await p.click(".modal [data-q=user][data-d='1']"); await p.waitForTimeout(150);
    const userCents = (await j("GET", "/config")).products.user.cents;
    ok(/Central Usage/.test(await p.textContent(".modal")) && (await p.textContent(".modal .total")).includes("$" + (userCents * 2 / 100).toFixed(2)), "quantities: two Central Usage keys, twice the price", await p.textContent(".modal .total"));
    await p.click(".modal [data-q=user][data-d='-1']"); await p.waitForTimeout(150);
    await p.click("#checkout"); await p.waitForURL(/\/#account$/, { timeout: 6000 });
    await p.fill("#inEmail", ME); await p.fill("#inPass", "pass-" + S + "-x"); await p.click("#inForm .btn:not(.ghost)");
    await p.waitForURL(/\/sounds\/$/, { timeout: 8000 }).catch(() => {}); await p.waitForSelector(".modal [name=coFor]", { timeout: 8000 }).catch(() => {});
    ok(/\/sounds\/$/.test(p.url()) && /Central Usage/.test(await p.textContent(".modal").catch(() => "")), "signing in brings you back to the page you were on, with the cart open", p.url());
    await p.check("[name=coFor][value=me]"); await p.waitForTimeout(150);
    await p.click("#checkout");
    const r = await pay(p);
    ok(r.hook === 200 && r.session.line_items.length === 1 && /\/#order-done-\{CHECKOUT_SESSION_ID\}$/.test(r.session.return_url), "checkout: Stripe's form, paid, Stripe's signed webhook");
    await p.waitForSelector("#purchases:not([hidden]) .pu-card", { timeout: 15000 }).catch(() => {});
    const t = await p.textContent("#purchases").catch(() => "");
    ok(/Thank you/.test(t) && /U[A-Z0-9]{3}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/.test(t) && (await p.$$("#purchases [data-copy]")).length >= 1 && (await p.$$eval("#purchases a.btn", (x) => x.some((a) => /Download/.test(a.textContent)))), "the thank-you page: the key with Copy, and the download");
    ok((await p.textContent("#cartBtn")).includes("0"), "...and the cart is empty");
    await shot(p, "thanks-just-me", true);
    // My products: the key, a device it's on (Release), the download, Buy more
    const key = t.match(/U[A-Z0-9]{3}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/)[0];
    const act = await j("POST", "/license/activate", { key, device: "dev-103-" + S, deviceName: "Choir laptop", app: "usage" });
    ok(act.ok !== false && act._status === 200, "the key works in the app (on the choir laptop)", act);
    await p.goto(base + "/#account-products"); await p.waitForFunction(() => /Choir laptop/.test((document.querySelector("#productsCard") || {}).textContent || ""), null, { timeout: 8000 }).catch(() => {});
    const pt = await p.textContent("#productsCard");
    ok(pt.includes(key) && /Choir laptop/.test(pt) && /updates through/.test(pt) && /Renew/.test(pt) && await p.$("#productsCard [data-rel][data-dev='Choir laptop']") && await p.$('#productsCard a[href="/apps/usage/"]') && await p.$("#productsCard a.btn[href*='download']").catch(() => true),
      "Account → My products: the key, Copy, the device it's on with Release, renewal, the download and Buy more", pt.replace(/\s+/g, " ").slice(0, 400));
    await shot(p, "my-products", true);
    await p.click("#productsCard [data-rel][data-dev='Choir laptop']"); await p.waitForFunction(() => !/Choir laptop/.test(document.querySelector("#productsCard").textContent), null, { timeout: 5000 }).catch(() => {});
    ok(!/Choir laptop/.test(await p.textContent("#productsCard")) && (await j("POST", "/license/check", { key, device: "dev-103-" + S })).ok === false, "Release: the device is gone, and the app there asks for a key again");
    await p.context().close();
  }

  // ---------------------------------------------------------------- 2. a church pack from Pricing, with a code, for the church
  const OWNER = "owner103-" + S + "@grace103.test", ownTok = await account(OWNER, { churchName: "Grace 103 " + S });
  {
    const p = await newPage(ownTok);
    await p.goto(base + "/pricing/", { waitUntil: "networkidle" }); await p.waitForSelector("#packs [data-add=pack-lite]");
    await p.click("#packs [data-add=pack-lite]"); await p.click("#cartBtn"); await p.waitForSelector("#pcCode");
    await p.fill("#pcCode", "betatest"); await p.click("#pcApply"); await p.waitForFunction(() => /BETATEST/.test(document.querySelector(".modal").textContent), null, { timeout: 5000 });
    ok(/−\$/.test(await p.textContent(".modal")) && /Grace 103/.test(await p.textContent(".modal")), "Pricing: the Lite pack with BETATEST off, for the church");
    await p.click("#checkout");
    const r = await pay(p);
    ok(/BETATEST/.test(r.session.line_items[0].price_data.product_data.name), "the code reached Stripe's checkout");
    await p.waitForSelector("#thanks", { timeout: 15000 }).catch(() => {});
    const t = await p.textContent("#downloads").catch(() => "");
    ok(/Thank you! Next: add your people/.test(t) && /Lite/.test(t) && /[AUP][A-Z0-9]{3}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/.test(t) && await p.$("#goTeams"), "the church's thank-you: what was bought, the keys, then add your people on Teams");
    await shot(p, "thanks-church", true);
    await p.context().close();
  }

  // ---------------------------------------------------------------- 3. a sound plan from its page; 4. a bundle from "Which plan"; 5. Central Tracks Unlimited
  {
    const p = await newPage(meTok);
    await p.goto(base + "/sounds/keys/", { waitUntil: "networkidle" });
    await p.click(".page-hero [data-plan=keys]"); await p.waitForTimeout(150);
    ok(/In your cart/.test(await p.textContent(".page-hero [data-plan=keys]")) && (await p.textContent("#cartBtn")).includes("1"), "a plan page's Add to cart: it's in the cart (and the button says so)");
    await p.click("#cartBtn"); await p.waitForSelector("#plGo");
    ok(/Central Keys/.test(await p.textContent(".modal .cart-plans")) && /Central Pads/.test(await p.textContent(".modal .cart-plans")) && /included/.test(await p.textContent(".modal .cart-plans")), "the cart: Central Keys, with Central Pads included");
    const before = sessions().length;
    await p.click("#plGo");
    await p.waitForSelector("#stubPay", { timeout: 8000 }).catch(() => {});
    for (let i = 0; i < 80 && sessions().length === before; i++) await new Promise((r) => setTimeout(r, 100));   // (the form shows before the checkout is made)
    const s = sessions().pop().body;
    ok(s.mode === "subscription" && /#plans-done$/.test(s.success_url || s.return_url || ""), "the plan checks out on its own, yearly (Stripe's form)", { mode: s.mode, ret: s.return_url });
    await p.click("#stubPay"); await p.waitForFunction(() => !!window.__paid);
    await p.goto(s.return_url); await p.waitForSelector(".modal h3", { timeout: 6000 }).catch(() => {});
    ok(/Thank you/.test(await p.textContent(".modal").catch(() => "")) && /package key/.test(await p.textContent(".modal").catch(() => "")), "...the thank-you: the package key comes by email, and where to paste it");
    await p.click(".modal [data-close]").catch(() => {});
    // "Which plan do I need?": a team of 8 → the Regular pack and a bundle for 8, into the cart
    await p.goto(base + "/pricing/", { waitUntil: "networkidle" });
    await p.check("#planHelper [name=for][value=team]"); await p.check("#planHelper [name=need][value=keys]"); await p.check("#planHelper [name=need][value=utility]");
    await p.waitForSelector("#helperAdd");
    const ans = await p.textContent("#helperAnswer");
    ok(/8 people/.test(ans) && /Regular/.test(ans) && /a year/.test(ans), "Which plan do I need? A team of 5 to 8: the Regular pack and sound plans for 8", ans.replace(/\s+/g, " "));
    await shot(p, "which-plan", false);
    await p.click("#helperAdd"); await p.waitForSelector(".modal #bnGo");
    ok(/Sound plans for 8 people/.test(await p.textContent(".modal")) && /Regular/.test(await p.textContent(".modal")), "...Add to cart: both are in the cart");
    await p.click("#clear");
    // Central Tracks Unlimited from its page
    await p.goto(base + "/sounds/tracks/", { waitUntil: "networkidle" });
    const before2 = sessions().length;
    await p.click(".page-hero [data-subscribe]"); await p.waitForSelector("#stubPay", { timeout: 8000 }).catch(() => {});
    for (let i = 0; i < 80 && sessions().length === before2; i++) await new Promise((r) => setTimeout(r, 100));
    ok(sessions().pop().body.mode === "subscription" && await p.isVisible("#stubPay"), "Central Tracks Unlimited: Subscribe opens Stripe's form");
    await p.context().close();
  }

  // ---------------------------------------------------------------- the Help Center: search, a guide, Contact support → a ticket
  {
    const p = await newPage(meTok);
    await p.goto(base + "/help/", { waitUntil: "networkidle" }); await p.waitForSelector("#hcCats .hc-cat");
    ok(await p.$$eval("#hcCats .hc-cat", (x) => x.length) >= 8 && await p.$$eval(".faq-group", (x) => x.length) === 9 && /support@motion\.test|support@motionaudio\.org/.test(await p.textContent("#contact")), "the Help Center: guides by category, the questions in nine groups, the support address");
    await p.fill("#hcQ", "crackles headphone"); await p.waitForTimeout(400);
    ok(await p.isVisible("#results") && /headphone jack/.test(await p.textContent("#hcResults")) && /Biggest/.test(await p.textContent("#hcResults")), "search: a question and its answer (crackles on the headphone jack)");
    await p.fill("#hcQ", "setting up pedal"); await p.waitForTimeout(400);
    ok(/Setting up the Central Pedal/.test(await p.textContent("#hcResults")) && await p.$('#hcResults a[href="/help/article.html?a=set-up-the-central-pedal"]'), "search: guides come first (Setting up the Central Pedal)");
    await p.fill("#hcQ", "zzqx nothing"); await p.waitForTimeout(400);
    ok(/Nothing found/.test(await p.textContent("#hcResTitle")), "search: nothing found says so, and offers to ask us");
    await p.fill("#hcQ", ""); await p.waitForTimeout(300);
    ok(!(await p.isVisible("#results")), "...and clearing it shows everything again");
    await p.goto(base + "/help/article.html?a=set-up-the-central-pedal", { waitUntil: "networkidle" }); await p.waitForSelector("#artBody ol.steps");
    ok(/Setting up the Central Pedal/.test(await p.textContent("h1")) && await p.$$eval("#artBody img", (x) => x.length && x.every((i) => i.naturalWidth > 0)), "a guide: steps and pictures from the apps");
    await p.click("[data-helpful='1']"); await p.waitForTimeout(300);
    ok(/glad it helped/i.test(await p.textContent("#artThanks")), "Was this helpful? Yes");
    await p.goto(base + "/help/#contact", { waitUntil: "networkidle" });
    await p.waitForFunction((me) => document.querySelector("#ctEmail").value === me, ME, { timeout: 5000 }).catch(() => {});
    ok(await p.$eval("#ctWebsite", (e) => e.getBoundingClientRect().right < 0 && !!e.closest("[aria-hidden=true]") && e.tabIndex === -1) && (await p.inputValue("#ctEmail")) === ME, "Contact support: the box for robots is out of sight (and out of the tab order); your email is filled in");
    await p.click("#ctSend"); await p.waitForTimeout(150);
    ok(/Tell us what's going on/.test(await p.textContent("#ctErr")), "an empty message is caught before sending");
    await p.fill("#ctSubject", "Keys moved " + S); await p.fill("#ctMsg", "How do I move my key to a new laptop?"); await p.click("#ctSend");
    await p.waitForSelector("#ctDone:not([hidden]) a", { timeout: 6000 });
    const sup = await waitMail(HELP, new RegExp("Keys moved " + S));
    ok(!!sup && [].concat(sup.reply_to)[0] === ME, "sent to support@, with the person as Reply-To", sup && sup.reply_to);
    await shot(p, "contact-sent");
    // a robot that fills in the hidden box: told it went; nothing is sent
    await p.reload({ waitUntil: "networkidle" });
    await p.evaluate(() => { document.querySelector("#ctWebsite").value = "http://spam.test"; });
    await p.fill("#ctMsg", "Cheap things " + S); await p.click("#ctSend"); await p.waitForSelector("#ctDone:not([hidden])", { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 400));
    ok(!mails.some((m) => (m.text || "").includes("Cheap things " + S)), "the hidden box: a robot is told it went, and nothing is sent");
    // Account → Help & tickets lists it; the ticket link shows it
    await p.goto(base + "/#account-help"); await p.waitForSelector("#helpCard a.tm", { timeout: 8000 }).catch(() => {});
    ok(new RegExp("Keys moved " + S).test(await p.textContent("#helpCard")), "Account → Help & tickets: your ticket");
    await p.click("#helpCard a.tm"); await p.waitForSelector("#tkBody .msg");
    ok(/How do I move my key/.test(await p.textContent("#tkBody")) && /Open/.test(await p.textContent("#tkSub")), "the ticket page: your message, open");
    await p.context().close();
  }

  // ---------------------------------------------------------------- staff: answer it on the Support card; the customer answers on the website
  {
    const stTok = await account(STAFF);
    const p = await newPage(stTok);
    await p.goto(base + "/#account"); await p.waitForSelector("#supportDeskCard [data-tk]", { timeout: 10000 }).catch(() => {});
    ok(await p.$("#editHowCard") && /Edit this page/.test(await p.textContent("#editHowCard")) && /Help articles/.test(await p.textContent("#editHowCard")) && /review site/i.test(await p.textContent("#editHowCard")) && /Prices/.test(await p.textContent("#editHowCard")) && /Codes/.test(await p.textContent("#editHowCard")),
      "staff: How to edit the website (Edit this page, Prices, Codes, Help articles, the review site, review admins)");
    const tk = await p.$(`#supportDeskCard details:has-text("Keys moved ${S}")`);
    ok(!!tk && await p.$("#statusCard"), "staff: the ticket on the Support card, and the Status card");
    await tk.click(); await tk.$eval("[data-ans]", (e) => (e.value = "Release it under My products, then type it on the new laptop."));
    await (await tk.$("[data-send]")).click();
    const back = await waitMail(ME, new RegExp("Re: Keys moved " + S));
    ok(back && /Answer on the website/.test(back.html), "the answer goes by email, with a link to answer on the website");
    await shot(p, "support-desk", true);
    const link = back.html.match(/href="([^"]+\/help\/ticket\.html#[\w-]+)"/)[1];
    const c = await newPage();
    await c.goto(link, { waitUntil: "networkidle" }); await c.waitForSelector("#tkBody .msg.staff");
    ok(/Release it under My products/.test(await c.textContent("#tkBody")) && /Waiting for you/.test(await c.textContent("#tkSub")), "the customer's link: our answer, waiting for them");
    await c.fill("#tkMsg", "Done, thanks!"); await c.click("#tkSend"); await c.waitForFunction(() => /Done, thanks/.test(document.querySelector("#tkBody").textContent), null, { timeout: 5000 }).catch(() => {});
    ok(/Done, thanks/.test(await c.textContent("#tkBody")) && !!(await waitMail(HELP, /they answered/)), "...they answer on the website; support gets it by email");
    await c.context().close(); await p.context().close();
  }
  ok(!errors.length, "no page errors", errors);
} catch (e) { ok(false, "stopped: " + (e && e.stack || e)); }
finally { await browser.close().catch(() => {}); srv.kill(); stripeSrv.close(); mailSrv.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(fails ? "\n" + fails + " FAILED" : "\nall passed");
process.exit(fails ? 1 : 0);
