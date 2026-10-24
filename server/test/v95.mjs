// 9.5 against a real Postgres and a stand-in Stripe: the yearly sound plans (Central Keys, Central Plugins, Central
// Instrument, Central Pedals) as package keys - a person's own, all four for less, a % code on the first year, church
// bundles whose keys are handed out on the Teams page, free trial keys - and what the apps ask (/v1/package/activate,
// /check, /release; tracksUnlimited on /v1/license/check), refunds, the price page, and the community kinds Sound, Board
// and Click (a demo clip graded for the price, the file the apps install).
//   node test/v95.mjs postgres://.../srv95 [port]
import { spawn, execFileSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Stripe from "stripe";

const here = path.dirname(fileURLToPath(import.meta.url));
const db = process.argv[2] || "postgres://postgres@127.0.0.1:55432/srv95", port = Number(process.argv[3] || 18995), base = "http://127.0.0.1:" + port;
const S = Date.now(), STAFF = "staff95" + S + "@motion.test", WHSEC = "whsec_test95";
const E = (n) => n + S + "@grace95.test";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "v95-"));   // (uploads and test files; removed at the end)

// ---- email: a stand-in Resend
const mails = [];
const mailSrv = http.createServer((req, res) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => { mails.push(JSON.parse(b || "{}")); res.end('{"id":"x"}'); }); });
await new Promise((r) => mailSrv.listen(0, "127.0.0.1", r));
const to = (who) => mails.filter((m) => m.to && m.to[0] === who);
const mailedKey = (who) => { const m = to(who).filter((x) => /package key/i.test(x.subject)).pop(); return m ? (m.text.match(/S[A-Z0-9]{3}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/) || [])[0] : null; };

// ---- a stand-in Stripe
const calls = [], coupons = new Set(), invoiceSubs = {}, invoicePays = {};
let n = 0;
function nest(params) {
  const out = {};
  for (const [k, v] of params) {
    const parts = k.replace(/\]/g, "").split("["); let o = out;
    parts.forEach((p, i) => { const last = i === parts.length - 1, nextNum = !last && /^\d+$/.test(parts[i + 1]); if (last) o[p] = v; else { o[p] = o[p] || (nextNum ? [] : {}); o = o[p]; } });
  }
  return out;
}
const stripeSrv = http.createServer((req, res) => {
  let raw = ""; req.on("data", (d) => (raw += d)); req.on("end", () => {
    const u = new URL(req.url, "http://x"), body = /json/.test(req.headers["content-type"] || "") ? JSON.parse(raw || "{}") : nest(new URLSearchParams(raw));
    calls.push({ method: req.method, path: u.pathname, body, query: Object.fromEntries(u.searchParams) });
    const send = (o, code = 200) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
    const p = u.pathname;
    if (p === "/v1/customers") return send({ id: "cus_" + ++n, object: "customer" });
    if (p.startsWith("/v1/customers/")) return send({ id: p.split("/")[3], object: "customer" });
    if (p === "/v1/coupons") {
      if (coupons.has(body.id)) return send({ error: { code: "resource_already_exists", message: "Coupon already exists.", type: "invalid_request_error" } }, 400);
      coupons.add(body.id); return send({ id: body.id, object: "coupon", percent_off: Number(body.percent_off), duration: body.duration });
    }
    if (/^\/v1\/checkout\/sessions\/[^/]+\/expire$/.test(p)) return send({ id: p.split("/")[4], object: "checkout.session", status: "expired" });
    if (p === "/v1/checkout/sessions") { const id = "cs_test_" + S + "_" + ++n; return send({ id, object: "checkout.session", client_secret: id + "_secret", url: null }); }
    if (p.startsWith("/v1/payment_intents/")) { const id = p.split("/")[3]; return send({ id, object: "payment_intent", latest_charge: { id: "ch_" + id, object: "charge", disputed: false, refunded: false } }); }
    if (p === "/v1/invoice_payments") { const pi = u.searchParams.get("payment[payment_intent]"); return send({ object: "list", data: invoicePays[pi] ? [{ id: "inpay_" + pi, invoice: invoicePays[pi] }] : [], has_more: false }); }
    if (p.startsWith("/v1/invoices/")) { const id = p.split("/")[3]; return send({ id, object: "invoice", parent: { subscription_details: { subscription: invoiceSubs[id] || "sub_none" } } }); }
    if (p.startsWith("/v1/subscriptions/") && req.method === "DELETE") return send({ id: p.split("/")[3], object: "subscription", status: "canceled" });
    if (p === "/v1/billing_portal/sessions") return send({ id: "bps_1", url: "https://billing.stripe.test/p" });
    send({ error: { message: "stand-in Stripe doesn't know " + req.method + " " + p, type: "invalid_request_error" } }, 404);
  });
});
await new Promise((r) => stripeSrv.listen(0, "127.0.0.1", r));
const lastSession = () => calls.filter((c) => c.path === "/v1/checkout/sessions").pop().body;

process.env.DATABASE_URL = db;
const srv = spawn(process.execPath, [path.join(here, "..", "src", "index.js")], { env: Object.assign({}, process.env, { PORT: String(port), STRIPE_SECRET_KEY: "sk_test_95", STRIPE_PUBLISHABLE_KEY: "pk_test_95", STRIPE_WEBHOOK_SECRET: WHSEC,
  STRIPE_API_URL: "http://127.0.0.1:" + stripeSrv.address().port, RESEND_API_KEY: "re_test", MAIL_FROM: "M <t@motion.test>", RESEND_API_URL: "http://127.0.0.1:" + mailSrv.address().port + "/emails",
  PUBLIC_URL: base, ADMIN_EMAILS: STAFF, REMINDERS: "off", LOCAL_STORAGE_DIR: path.join(tmp, "files") }), stdio: ["ignore", "pipe", "pipe"] });
let log = ""; srv.stdout.on("data", (d) => { log += d; }); srv.stderr.on("data", (d) => { log += d; });
for (let i = 0; i < 100 && !/Motion Audio server on/.test(log); i++) await new Promise((r) => setTimeout(r, 100));

let fails = 0;
const ok = (c, m, d) => { console.log((c ? "  ✓ " : "  ✗ ") + m + (c || d === undefined ? "" : "   -- " + JSON.stringify(d).slice(0, 900))); if (!c) fails++; };
let ipN = 0;
const j = async (method, p, body, tok) => { const r = await fetch(base + "/v1" + p, { method, headers: { "Content-Type": "application/json", "X-Forwarded-For": "10.95." + (++ipN % 200) + ".1", ...(tok ? { Authorization: "Bearer " + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); return Object.assign(await r.json().catch(() => ({})), { _status: r.status }); };
async function finish(r, email) {
  if (!r.step) return r;
  if (r.step === "phone") Object.assign(r, await j("POST", "/login/phone", { ticket: r.ticket, phone: "555-095-" + String(S).slice(-4) }));
  const m = to(email).filter((x) => /sign-in code/.test(x.subject)).pop();
  return Object.assign({}, r, { token: (await j("POST", "/login/code", { ticket: r.ticket, code: m.subject.match(/(\d{6})/)[1] })).token });
}
const confirm = async (email) => { const m = to(email).filter((x) => /Confirm your email/.test(x.subject)).pop(); if (m) return j("POST", "/account/confirm", { token: m.text.match(/#confirm-([A-Za-z0-9_-]+)/)[1] }); };
const account = async (who, extra) => { const r = await finish(await j("POST", "/signup", Object.assign({ email: E(who), password: "password123", name: who }, extra || {})), E(who)); await confirm(E(who)); return r.token; };
const signer = new Stripe("sk_test_95");
async function hook(type, object) {
  const payload = JSON.stringify({ id: "evt_" + ++n, object: "event", type, data: { object } });
  const sig = signer.webhooks.generateTestHeaderString({ payload, secret: WHSEC });
  return (await fetch(base + "/stripe/webhook", { method: "POST", headers: { "Content-Type": "application/json", "Stripe-Signature": sig }, body: payload })).status;
}
const completed = (session, sub) => hook("checkout.session.completed", { id: session, object: "checkout.session", mode: "subscription", payment_status: "paid", subscription: sub, amount_total: 1 });
const subEvent = (type, sub, status, md, end, extra) => hook(type, Object.assign({ id: sub, object: "subscription", status, metadata: md, items: { data: [{ id: "si_" + sub, current_period_end: end }] }, cancel_at_period_end: false }, extra || {}));
const day = 864e5, yearOn = () => Math.floor((Date.now() + 365 * day) / 1000);
const near = (iso, ms, slack) => !!iso && Math.abs(new Date(iso).getTime() - ms) < (slack || 120e3);
const ALL = ["keys", "plugins", "instrument", "pedals"];
let keyN = 0;
const KEYABC = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const newKeyStr = (kind) => kind + Array.from({ length: 15 }, (_, i) => KEYABC[(S + i * 7 + ++keyN * 13) % KEYABC.length]).join("");
let dev = 0;
const newDev = () => "dev-95-" + S + "-" + ++dev;
async function useKey(key, app) { const d = newDev(); const a = await j("POST", "/license/activate", { key, device: d, deviceName: "Test " + dev, app }); return Object.assign(a, { device: d }); }
const check = (key, device) => j("POST", "/license/check", { key, device });
async function pkg(key, app) { const d = newDev(); const a = await j("POST", "/package/activate", { key, deviceId: d, app, deviceName: "Device " + dev }); return Object.assign(a, { deviceId: d }); }
const pkgCheck = async (key, deviceId) => (await j("POST", "/package/check", { keys: [key], deviceId })).packages[0];

try {
  const { q, one } = await import("../src/db.js");

  // ---------------------------------------------------------------- the prices
  const cfg = await j("GET", "/config");
  ok(cfg.plans.keys.cents === 5000 && cfg.plans.plugins.cents === 12000 && cfg.plans.instrument.cents === 8000 && cfg.plans.pedals.cents === 5000 && cfg.planAll.cents === 22000
    && cfg.plans.keys.name === "Central Keys" && cfg.plans.pedals.name === "Central Pedals" && cfg.planIds.join() === ALL.join() && cfg.packageDevices === 2,
    "the plans: Central Keys $50, Central Plugins $120, Central Instrument $80, Central Pedals $50 a year; all four $220; a package works on 2 devices", { plans: cfg.plans, all: cfg.planAll });
  ok(JSON.stringify(cfg.planBundles) === JSON.stringify({ 4: 68000, 8: 136000, 12: 184000, 16: 257000, 20: 290000 }), "church bundles: 4 $680, 8 $1,360, 12 $1,840, 16 $2,570, 20 $2,900 a year", cfg.planBundles);
  ok(["Sound", "Board", "Click"].every((k) => cfg.trackKinds.includes(k)) && cfg.itemKinds.Board.ext.join() === "json", "Central Tracks takes Sound, Board and Click too", cfg.trackKinds);

  // ---------------------------------------------------------------- a person's own plans: a package key
  const pat = await account("pat"), patId = (await one("SELECT id FROM users WHERE email=$1", [E("pat")])).id;
  const pk = await j("POST", "/checkout/plans/check", { plans: ["keys", "plugins"] }, pat);
  ok(pk.ok && pk.cents === 17000 && pk.plans.join() === "keys,plugins", "Central Keys + Central Plugins: $170 a year", pk);
  ok((await j("POST", "/checkout/plans", { plans: ["nope"] }, pat))._status === 400, "an unknown plan is refused");
  const co = await j("POST", "/checkout/plans", { plans: ["keys", "plugins"] }, pat), s1 = lastSession(), L1 = s1.line_items;
  ok(co.clientSecret && s1.mode === "subscription" && s1.ui_mode === "form" && L1.length === 2 && L1.every((x) => x.price_data.recurring.interval === "year" && x.price_data.tax_behavior === "inclusive")
    && L1[0].price_data.unit_amount === "5000" && L1[0].price_data.product_data.name === "Central Keys" && L1[1].price_data.unit_amount === "12000" && /^cus_/.test(s1.customer) && !s1.discounts,
    "the payment form: two yearly lines, tax included, billed to the person", s1);
  const md1 = s1.subscription_data.metadata;
  ok(md1.kind === "plans" && md1.plans === "keys,plugins" && Number(md1.plan_sub_id) > 0 && /\/#plans-done$/.test(s1.return_url), "the subscription is marked as a sound plan (not Central Tracks)", md1);
  ok((await j("GET", "/packages/mine", null, pat)).packages.length === 0, "until it's paid: no package key");
  await subEvent("customer.subscription.created", "sub_pat_" + S, "incomplete", md1, yearOn());
  await completed(co.session, "sub_pat_" + S);
  await completed(co.session, "sub_pat_" + S);   // (Stripe may send it twice)
  await subEvent("customer.subscription.created", "sub_pat_" + S, "incomplete", md1, yearOn());   // (and late, out of order)
  let mine = await j("GET", "/packages/mine", null, pat);
  const patPkg = mine.packages[0], patMail = to(E("pat")).filter((m) => /package key/i.test(m.subject)).pop();
  ok(mine.packages.length === 1 && /^S[A-Z0-9]{3}(-[A-Z0-9]{4}){3}$/.test(patPkg.key) && patPkg.plans.join() === "keys,plugins" && patPkg.ok && patPkg.from === "own" && patPkg.renews && near(patPkg.end, Date.now() + 365 * day, day),
    "paid: one package key (S…) with Central Keys and Central Plugins for a year, renewing (a late 'incomplete' doesn't switch it off)", mine);
  ok(patMail && mailedKey(E("pat")) === patPkg.key && /Your package key: Central Keys and Central Plugins/.test(patMail.subject) && /Settings → Packages → Add a package/.test(patMail.text),
    "the key is emailed to the buyer, with how to add it (Settings → Packages)", patMail && { s: patMail.subject, t: patMail.text });
  const endTs = Math.floor((Date.now() + 400 * day) / 1000);
  await subEvent("customer.subscription.updated", "sub_pat_" + S, "active", md1, endTs);
  ok(near((await j("GET", "/packages/mine", null, pat)).packages[0].end, endTs * 1000, 2000), "Stripe's period end is the date it renews to");

  // the apps: Settings → Packages
  const a1 = await pkg(patPkg.key.toLowerCase(), "usage");
  ok(a1.ok === true && a1.key === patPkg.key && Object.keys(a1.plans).join() === "keys,plugins" && near(a1.plans.keys, endTs * 1000, 2000) && /^\d{4}-\d\d-\d\dT.*Z$/.test(a1.plans.plugins) && a1.holder === "pat" && a1.church === "",
    "Add a package: { ok, key, plans: { keys, plugins: ISO end }, holder, church }", a1);
  const a2 = await pkg(patPkg.key, "control"), a3 = await pkg(patPkg.key, "pedal");
  ok(a2.ok && a3.ok === false && /already on .* 2 devices/.test(a3.error) && !a3.plans, "a package key works on 2 devices at a time (the third is told where it is)", a3);
  ok((await j("POST", "/package/release", { key: patPkg.key, deviceId: a1.deviceId })).ok, "Release on a device");
  const a4 = await pkg(patPkg.key, "pedal");
  ok(a4.ok, "...frees it for another (Central Pedal needs no P key for its packages)", a4);
  const c1 = await j("POST", "/package/check", { keys: [patPkg.key, "SAAA-BBBB-CCCC-DDDD"], deviceId: a4.deviceId });
  ok(c1.packages.length === 2 && c1.packages[0].ok && c1.packages[0].plans.keys && near(c1.packages[0].end, endTs * 1000, 2000) && c1.packages[1].ok === false && /isn't right/.test(c1.packages[1].error),
    "check: { packages: [{ key, ok, plans, end, error? }] }, for several keys at once", c1);
  const rel = await pkgCheck(patPkg.key, a1.deviceId);
  ok(rel.ok === false && /released from this device/.test(rel.error), "a device it was released from is told to add it again", rel);
  ok((await pkg("PXXX-XXXX-XXXX-XXXX", "usage")).ok === false && (await pkg(patPkg.key, "nope")).ok === false, "a P key isn't a package; an unknown app is refused");
  const mineDev = (await j("GET", "/packages/mine", null, pat)).packages[0];
  ok(mineDev.devices.length === 2 && mineDev.devices.some((d) => d.app === "Central Pedal"), "the Account page lists the devices it's on", mineDev.devices);
  ok((await j("POST", "/packages/release", { key: patPkg.key, device: a2.deviceId }, pat)).ok && (await pkgCheck(patPkg.key, a2.deviceId)).ok === false, "...and releases one (a lost device)");
  ok((await j("POST", "/packages/release", { key: patPkg.key }, await account("stranger")))._status === 403, "...only the person whose it is (or their church)");

  // the license check no longer carries plans (tracksUnlimited stays)
  const patKey = newKeyStr("U");
  await q("INSERT INTO licenses (key,product,kind,user_id,updates_until) VALUES ($1,'made','U',$2,105)", [patKey, patId]);
  const la = await useKey(patKey, "usage"), lc = await check(patKey, la.device);
  ok(lc.ok === true && lc.kind === "U" && lc.church === "" && lc.recheckDays === 30 && lc.updatesUntil === 105 && lc.updatesUntilText === "10.5" && lc.trial === false && lc.expiresAt === null && lc.tracksUnlimited === false && !("plans" in lc) && la.tracksUnlimited === false,
    "license check: as before, plus tracksUnlimited; no plans (those are package keys)", lc);

  ok((await j("POST", "/checkout/plans/check", { plans: ["keys"] }, pat))._status === 409, "the same plan twice is refused (it renews by itself)");
  ok((await j("POST", "/checkout/plans/check", { plans: ["pedals"] }, pat)).ok, "...another plan is fine");
  await hook("invoice.paid", { id: "in_pat_" + S, object: "invoice", customer: "cus_x", amount_paid: 17000, parent: { type: "subscription_details", subscription_details: { subscription: "sub_pat_" + S, metadata: { kind: "plans" } } }, status_transitions: { paid_at: Math.floor(Date.now() / 1000) } });
  ok(!(await one("SELECT 1 FROM subscription_payments WHERE invoice_id=$1", ["in_pat_" + S])), "plan money doesn't go into the Central Tracks publisher pool");
  // past due: 14 more days while Stripe tries the card again; canceled: the package ends
  await subEvent("customer.subscription.updated", "sub_pat_" + S, "past_due", md1, endTs);
  const pd = await pkgCheck(patPkg.key, a4.deviceId);
  ok(pd.ok && near(pd.plans.keys, Date.now() + 14 * day, 3600e3), "a renewal that didn't go through: 14 more days", pd);
  await subEvent("customer.subscription.updated", "sub_pat_" + S, "active", md1, endTs);
  ok(near((await pkgCheck(patPkg.key, a4.deviceId)).end, endTs * 1000, 2000), "...paid after all: back to the full year");
  await subEvent("customer.subscription.deleted", "sub_pat_" + S, "canceled", md1, endTs);
  await subEvent("customer.subscription.updated", "sub_pat_" + S, "active", md1, endTs);   // (a stale event after it ended)
  const gone = await pkgCheck(patPkg.key, a4.deviceId);
  ok(gone.ok === false && /^This package ended on \w+ \d+, \d{4}\. Renew it on your account page\.$/.test(gone.error) && near(gone.end, Date.now(), 120e3), "the subscription ends: the package ends (\"" + gone.error + "\")", gone);
  const after = (await j("GET", "/packages/mine", null, pat)).packages[0];
  ok(after.ok === false && !after.renews && /Renew it/.test(after.error), "the Account page shows it ended, to renew", after);

  // all four, with BETATEST off the first year
  const co2 = await j("POST", "/checkout/plans", { plans: "all", code: "betatest" }, pat), s2 = lastSession();
  const coupon = calls.filter((c) => c.path === "/v1/coupons").pop();
  ok(co2.clientSecret && s2.line_items.length === 1 && s2.line_items[0].price_data.unit_amount === "22000" && s2.line_items[0].price_data.product_data.name === "All four sound plans"
    && s2.discounts[0].coupon === "MA-BETATEST-50-FIRST-YEAR" && coupon.body.percent_off === "50" && coupon.body.duration === "once",
    "all four: one $220 line; BETATEST is 50% off the first year (a coupon that applies once)", { s2, coupon: coupon.body });
  await completed(co2.session, "sub_pat_all_" + S);
  const allKey = mailedKey(E("pat")), aa = await pkg(allKey, "usage");
  ok(allKey && allKey !== patPkg.key && aa.ok && ALL.every((id) => aa.plans[id]), "a new package key with all four plans", aa);
  ok((await j("POST", "/checkout/plans/check", { plans: [] }, pat))._status === 400, "(nothing picked: refused)");
  const pat2 = await account("pat2");
  const p2co = await j("POST", "/checkout/plans", { plans: ["keys"], code: "BETATEST" }, pat2);
  ok(lastSession().discounts[0].coupon === "MA-BETATEST-50-FIRST-YEAR" && calls.filter((c) => c.path === "/v1/coupons").length === 2, "the coupon is reused (Stripe already has it)");
  await completed(p2co.session, "sub_pat2_" + S);
  const used = await j("POST", "/checkout/plans", { plans: ["pedals"], code: "BETATEST" }, pat2);
  ok(used._status === 409 && /already used BETATEST/.test(used.error), "once per person", used);
  const dc = await j("GET", "/discount/BETATEST", null, pat2);
  ok(dc.plans === true && dc.planUsed === true, "the cart knows the code works on plans, and that it was used", dc);
  const tr = await j("POST", "/checkout/plans", { plans: ["pedals"], code: "7FREE" }, pat2);
  ok(tr._status === 400 && tr.trialCode === "7FREE", "a free trial code isn't for checkout (the trial has its own package keys)", tr);

  // ---------------------------------------------------------------- a church: a bundle's keys, given on the Teams page
  const O = await account("office", { churchName: "Grace 95 " + S });
  const cid = (await one("SELECT id FROM churches WHERE name=$1", ["Grace 95 " + S])).id;
  const codes = (await j("GET", "/church", null, O)).church;
  const ula = await account("ula", { churchCode: codes.userCode, churchRole: "user" });
  const amy = await account("amy", { churchCode: codes.adminCode, churchRole: "admin" });
  ok((await j("POST", "/checkout/plan-bundle/check", { seats: 5 }, O))._status === 400, "bundles come in 4, 8, 12, 16 or 20");
  ok((await j("POST", "/checkout/plan-bundle", { seats: 8 }, ula))._status === 403, "a user can't buy a bundle for the church");
  ok((await j("POST", "/checkout/plan-bundle/check", { seats: 8 }, pat))._status === 400, "...and someone without a church can't either");
  const noBundle = await j("POST", "/church/packages/give", { email: E("ula") }, O);
  ok(noBundle._status === 402, "no bundle yet: no keys to give", noBundle);
  const b8 = await j("POST", "/checkout/plan-bundle", { seats: 8 }, O), s3 = lastSession(), md3 = s3.subscription_data.metadata;
  ok(b8.clientSecret && s3.line_items[0].price_data.unit_amount === "136000" && s3.line_items[0].price_data.recurring.interval === "year" && /^Sound plans for 8 people - Grace 95/.test(s3.line_items[0].price_data.product_data.name)
    && md3.kind === "plans" && md3.church_id === String(cid) && md3.seats === "8", "a bundle for 8: $1,360 a year, billed to the church", s3);
  ok(calls.some((c) => c.path === "/v1/customers" && c.body.metadata && c.body.metadata.church_id === String(cid)), "...on the church's own Stripe customer");
  await completed(b8.session, "sub_b8_" + S);
  let tp = await j("GET", "/church/packages", null, O);
  ok(tp.total === 8 && tp.free === 8 && tp.keys.length === 8 && tp.keys.every((k) => k.plans.join() === ALL.join() && k.ok && !k.holder) && tp.people.some((p) => p.email === E("ula")) && tp.people.some((p) => p.email === E("amy")),
    "Teams: 8 package keys with all four plans, nobody's yet; the church's people are listed to give them to", tp);
  ok((await j("GET", "/church/packages", null, ula))._status === 403, "a user doesn't hand out keys");
  const g1 = await j("POST", "/church/packages/give", { email: E("ula") }, amy);
  const ulaKey = mailedKey(E("ula")), ulaMail = to(E("ula")).filter((m) => /package key/i.test(m.subject)).pop();
  ok(g1.ok && g1.sent && g1.given === 1 && ulaKey === g1.key && /Grace 95/.test(ulaMail.subject) && /Settings → Packages/.test(ulaMail.text), "an admin gives Ula a key: it's emailed to her", { g1, s: ulaMail && ulaMail.subject });
  ok((await j("POST", "/church/packages/give", { email: E("ula") }, O))._status === 409, "...one each");
  ok((await j("POST", "/church/packages/give", { email: E("pat") }, O))._status === 404, "someone outside the church can't be given one");
  const um = await j("GET", "/packages/mine", null, ula);
  ok(um.packages.length === 1 && um.packages[0].from === "church" && um.packages[0].church === "Grace 95 " + S && um.packages[0].key === ulaKey, "Ula's Account page shows it, from her church", um);
  const ua = await pkg(ulaKey, "usage");
  ok(ua.ok && ALL.every((id) => near(ua.plans[id], Date.now() + 365 * day, day)) && ua.holder === "ula" && ua.church === "Grace 95 " + S, "Ula adds it on her device: all four plans", ua);
  for (let i = 0; i < 8; i++) await q("INSERT INTO invites (church_id,section,name,email,token) VALUES ($1,'user',$2,$3,$4)", [cid, "P" + i, E("p" + i), "tok95-" + S + "-" + i]);
  for (let i = 0; i < 7; i++) await j("POST", "/church/packages/give", { email: E("p" + i), name: "P" + i }, O);
  tp = await j("GET", "/church/packages", null, O);
  const full = await j("POST", "/church/packages/give", { email: E("p7") }, O);
  ok(tp.given === 8 && tp.free === 0 && full._status === 409 && /All 8 package keys are given/.test(full.error), "8 of 8 given: a ninth is refused", full);
  const p6Key = mailedKey(E("p6")), p6 = await pkg(p6Key, "usage");
  const back = await j("POST", "/church/packages/take-back", { key: p6Key }, O);
  const p6c = await pkgCheck(p6Key, p6.deviceId);
  ok(back.ok && back.free === 1 && back.replacedBy && back.replacedBy !== p6Key && back.keys.some((k) => k.key === back.replacedBy && !k.holder) && back.people.some((p) => p.email === E("p6")),
    "Take back: a new key takes its place, free for someone else", back);
  ok(p6c.ok === false && /given to someone else/.test(p6c.error) && (await pkg(p6Key, "control")).ok === false, "...and the first person's copy stops working", p6c);
  const g7 = await j("POST", "/church/packages/give", { email: E("p7"), name: "P7" }, O);
  ok(g7.ok && g7.key === back.replacedBy && mailedKey(E("p7")) === back.replacedBy, "the new key goes to the next person, by email", g7);
  ok((await j("POST", "/church/packages/resend", { key: g7.key }, O)).sent && to(E("p7")).filter((m) => /package key/i.test(m.subject)).length === 2, "Resend sends it again");
  await j("POST", "/church/remove", { email: E("ula") }, O);
  const ug = await pkgCheck(ulaKey, ua.deviceId);
  tp = await j("GET", "/church/packages", null, O);
  ok(ug.ok === false && tp.free === 1 && !tp.keys.some((k) => k.key === ulaKey), "Ula taken out of the church: her key stops, a new one is free", { ug, free: tp.free });
  const b4 = await j("POST", "/checkout/plan-bundle", { seats: 4 }, O); await completed(b4.session, "sub_b4_" + S);
  tp = await j("GET", "/church/packages", null, O);
  ok(tp.total === 12 && tp.free === 5 && tp.bundles.length === 2, "another bundle (4): 12 keys", { total: tp.total, free: tp.free });
  await subEvent("customer.subscription.deleted", "sub_b8_" + S, "canceled", md3, yearOn());
  tp = await j("GET", "/church/packages", null, O);
  const p0c = await pkgCheck(mailedKey(E("p0")), "dev-none-123");
  ok(tp.total === 4 && tp.free === 4 && p0c.ok === false && /ended on/.test(p0c.error), "the 8 bundle ends: its 8 keys end; the 4 bundle's keys are left", { total: tp.total, p0c });

  // ---------------------------------------------------------------- Central Tracks Unlimited per license key
  await q("UPDATE churches SET subscribed=TRUE WHERE id=$1", [cid]);
  const spareKey = newKeyStr("P"), amyKey = newKeyStr("A"), offKey = newKeyStr("A"), u2Key = newKeyStr("U"), pcKey = newKeyStr("P");
  await q("INSERT INTO licenses (key,product,kind,church_id) VALUES ($1,'made','P',$2)", [spareKey, cid]);
  await q("INSERT INTO licenses (key,product,kind,church_id,assigned_email,updates_until) VALUES ($1,'made','A',$2,$3,105),($4,'made','A',$2,$5,105),($6,'made','U',$2,$7,105),($8,'made','P',$2,$7,NULL)",
    [amyKey, cid, E("amy"), offKey, E("office"), u2Key, E("p0"), pcKey]);
  const ks = await useKey(spareKey, "pedal-control"), ka = await useKey(amyKey, "control"), ko = await useKey(offKey, "control"), ku = await useKey(u2Key, "usage"), kp = await useKey(pcKey, "pedal-control");
  ok(kp.tracksUnlimited === true && ks.tracksUnlimited === true, "the church subscribes: Pedal Control keys (and the church's spare) have Central Tracks Unlimited", { kp, ks });
  ok(ko.tracksUnlimited === true && ka.tracksUnlimited === false && ku.tracksUnlimited === false, "...and the church account (and main admins); an admin's or a user's key doesn't", { ko: ko.tracksUnlimited, ka: ka.tracksUnlimited, ku: ku.tracksUnlimited });
  ok((await j("GET", "/me", null, O)).subscribed === true && (await j("GET", "/me", null, amy)).subscribed === false, "the website agrees (the church account adds anything; an admin buys)");
  await j("POST", "/church/main-admin", { email: E("amy"), on: true }, O);
  ok((await check(amyKey, ka.device)).tracksUnlimited === true, "Amy made a main admin: her key has it now");
  await q("UPDATE users SET subscribed=TRUE WHERE email=$1", [E("pat")]);
  ok((await check(patKey, la.device)).tracksUnlimited === true, "a person's own subscription covers their keys");
  await q("UPDATE churches SET subscribed=FALSE WHERE id=$1", [cid]);
  ok((await check(pcKey, kp.device)).tracksUnlimited === false, "the church's subscription ends: off");

  // ---------------------------------------------------------------- a free trial: trial package keys with all four plans
  const T = await account("trial", { churchName: "Trial 95 " + S });
  const tt = await j("POST", "/trial", { code: "7FREE" }, T);
  const tk = await pkg(tt.packageKey, "usage");
  ok(tt.ok && tt.packageKey && mailedKey(E("trial")) === tt.packageKey && tk.ok && ALL.every((id) => near(tk.plans[id], new Date(tt.until).getTime(), 2000)),
    "7FREE: a trial package key (emailed) with every plan until the trial ends", { tt, tk });
  const ts = await j("POST", "/church/trial-key", { kind: "S" }, T);
  ok(ts.ok && /^S/.test(ts.key) && (await pkg(ts.key, "control")).ok, "+ Package key: another, any time during the trial");
  const tTeam = await j("POST", "/church/team", { section: "user", members: [{ name: "Tess", email: E("tess") }] }, T);
  const tg = await j("POST", "/church/packages/give", { email: E("tess") }, T);
  ok(tTeam.results[0].ok && tg.ok && tg.sent && mailedKey(E("tess")) === tg.key && (await j("GET", "/church/packages", null, T)).trialUntil, "the Teams page gives trial package keys too (one is made for each person)", tg);
  const tessInv = to(E("tess")).find((m) => /added you to the team/.test(m.subject));
  ok(tessInv && /2\. Download Central Usage: [^\n]+\n   How to install it: http[^\n]+\/help\/install\.html#before-you-start/.test(tessInv.text) && /how to install it<\/a>/.test(tessInv.html), "the Teams email says how to install the app, next to its download link", tessInv && tessInv.text);
  await q("UPDATE churches SET trial_until=now() - interval '1 minute' WHERE name=$1", ["Trial 95 " + S]);
  await q("UPDATE package_keys SET ends_at=now() - interval '1 minute' WHERE church_id=(SELECT id FROM churches WHERE name=$1)", ["Trial 95 " + S]);
  const te = await pkgCheck(tt.packageKey, tk.deviceId);
  ok(te.ok === false && /free trial package ended/.test(te.error), "the trial ends: its package keys end", te);

  // ---------------------------------------------------------------- a refund ends a plan
  const pr = await account("refund");
  const cr = await j("POST", "/checkout/plans", { plans: ["instrument"] }, pr); await completed(cr.session, "sub_rf_" + S);
  const rk = mailedKey(E("refund")), rka = await pkg(rk, "usage");
  ok(rka.ok && Object.keys(rka.plans).join() === "instrument", "Central Instrument, paid: its key works", rka);
  invoicePays["pi_rf_" + S] = "in_rf_" + S; invoiceSubs["in_rf_" + S] = "sub_rf_" + S;
  await hook("charge.refunded", { id: "ch_rf", object: "charge", refunded: true, payment_intent: "pi_rf_" + S });
  ok((await pkgCheck(rk, rka.deviceId)).ok === false && calls.some((c) => c.method === "DELETE" && c.path === "/v1/subscriptions/sub_rf_" + S), "refunded: the package ends and Stripe stops renewing it");

  // ---------------------------------------------------------------- "Just me": the keys are the buyer's, with a Downloads page
  const solo = await account("solo"), soloId = (await one("SELECT id FROM users WHERE email=$1", [E("solo")])).id;
  const sc1 = await j("POST", "/checkout/store/check", { items: { "pack-lite": 1 }, for: "me" }, solo);
  const sc2 = await j("POST", "/checkout/store/check", { items: { "services-slot": 3 }, for: "me" }, solo);
  ok(sc1._status === 400 && /for a church or team/.test(sc1.error) && sc2._status === 400, "Just me: packs and Central Services slots are for a church or team", sc1);
  ok((await j("POST", "/checkout/store/check", { items: { user: 1, pedal: 1 }, for: "me" }, solo)).ok, "...a pedal and a Central Usage key are fine, with no church to name");
  const so = await j("POST", "/checkout/store", { items: { user: 1, pedal: 1 }, for: "me" }, solo), sos = lastSession();
  ok(so.clientSecret && sos.metadata.for === "me" && sos.shipping_address_collection && !(await j("GET", "/me", null, solo)).church, "the payment form: billed to the person; no church is made for them", sos.metadata);
  await hook("checkout.session.completed", { id: so.session, object: "checkout.session", payment_status: "paid", payment_intent: "pi_solo_" + S, amount_total: 27000, customer_details: { email: E("solo") },
    collected_information: { shipping_details: { name: "Sam Solo", address: { line1: "12 Hymn St", city: "Nashville", state: "TN", postal_code: "37201", country: "US" } } } });
  const soOrder = await j("GET", "/orders/" + so.session);
  const soKeys = await q("SELECT l.kind, l.user_id, l.assigned_email FROM licenses l JOIN orders o ON o.id=l.order_id WHERE o.stripe_session=$1 ORDER BY kind", [so.session]);
  ok(soOrder.personal === true && soOrder.church === null && soKeys.length === 2 && soKeys.every((k) => Number(k.user_id) === Number(soloId) && k.assigned_email === E("solo")), "paid: every key is the buyer's at once (no Teams handout); the order says it's personal", { soOrder, soKeys });
  const dlMail = to(E("solo")).filter((m) => /Your downloads and keys/.test(m.subject)).pop();
  ok(dlMail && /CENTRAL USAGE/.test(dlMail.text) && /U[A-Z0-9]{3}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/.test(dlMail.text) && /motionaudio\.github\.io\/Central-Apps\/#usage/.test(dlMail.text) && /Run anyway/.test(dlMail.text) && /install\.sh \| bash -s usage/.test(dlMail.text)
    && /ships to Sam Solo, 12 Hymn St, Nashville TN 37201, US/.test(dlMail.text) && /Central Pedal Setup/.test(dlMail.text) && /CENTRAL PEDAL CONTROL/.test(dlMail.text), "the buyer's email: each key, its download link, how to install it, and the pedal's address and phone setup", dlMail && dlMail.text);
  const pubDl = await j("GET", "/downloads/apps");
  ok(pubDl.apps.length === 3 && pubDl.apps.every((a) => a.keys.length === 0 && a.download && a.steps.windows) && pubDl.services && /account/.test(pubDl.services.note) && pubDl.pedalSetup.length, "anyone can see every app's download and install steps (no sign-in, no keys)");
  const dl = await j("GET", "/downloads", null, solo);
  const dlU = dl.apps.find((a) => a.kind === "U"), dlP = dl.apps.find((a) => a.kind === "P");
  ok(dlU && dlP && dlU.keys.length === 1 && /#usage$/.test(dlU.download) && dlU.steps.windows.length && dlU.steps.mac.length && dlU.steps.android && /bash -s usage/.test(dlU.linuxCommand) && /Safari/.test(dlU.phone)
    && dl.pedals.length === 1 && /Nashville/.test(dl.pedals[0].shipsTo) && dl.pedalSetup.some((s) => /Central Pedal Setup/.test(s)) && /#making-your-own-sd-card$/.test(dl.sdCard),
    "Downloads: a card per app (download link, steps for each computer and phone, the key) and the pedal (where it ships, the phone setup, the SD card guide)", dl);
  const sUse = await useKey(dlU.keys[0].key, "usage");
  ok(sUse.ok && (await j("POST", "/license/link", { key: dlU.keys[0].key, device: sUse.device }, solo)).ok && !(await j("GET", "/me", null, solo)).church, "the key works and signs in with the buyer's account; still no church");
  ok((await j("POST", "/church/release", { key: dlU.keys[0].key }, solo)).ok && (await check(dlU.keys[0].key, sUse.device)).ok === false, "the buyer can release their own key (Downloads → Release)");
  // someone in a church buys for themselves: their own keys, not the church's
  const mem = await account("member", { churchCode: codes.userCode, churchRole: "user" });
  ok((await j("POST", "/checkout/store/check", { items: { user: 1 } }, mem))._status === 403, "a user in a church can't buy for the church...");
  const mo = await j("POST", "/checkout/store", { items: { "pedal-control": 1 }, for: "me" }, mem);
  await hook("checkout.session.completed", { id: mo.session, object: "checkout.session", payment_status: "paid", payment_intent: "pi_mem_" + S, amount_total: 5000, customer_details: { email: E("member") } });
  const memKey = (await j("GET", "/downloads", null, mem)).apps.find((a) => a.kind === "P").keys[0].key, mk = await useKey(memKey, "pedal-control");
  const ml = await j("POST", "/license/link", { key: memKey, device: mk.device }, mem);
  ok(mo.clientSecret && mk.ok && ml.ok && ml.church === "Grace 95 " + S && (await j("GET", "/me", null, mem)).church.name === "Grace 95 " + S && (await one("SELECT c.personal FROM licenses l JOIN churches c ON c.id=l.church_id WHERE regexp_replace(l.key,'-','','g')=$1", [memKey.replace(/-/g, "")])).personal,
    "...but buys \"Just me\": a key of their own (not the church's) that works while they stay in the church", { ml });
  // renewing updates for your own key: same price and rules as a church's, billed to you
  const dl2 = await j("GET", "/downloads", null, solo), uk = dl2.apps.find((a) => a.kind === "U").keys[0], pk0 = dl2.apps.find((a) => a.kind === "P").keys[0];
  ok(uk.renewable && /^\d+\.\d+$/.test(uk.updatesUntil) && !pk0.renewable && pk0.updatesUntil === "forever" && dl2.renewalCents === 2000, "Downloads: your own Central Usage key can be renewed ($20); Pedal Control keys get updates forever", { uk, pk0 });
  const upd0 = (await one("SELECT updates_until FROM licenses WHERE regexp_replace(key,'-','','g')=$1", [uk.key.replace(/-/g, "")])).updates_until;
  const rn = await j("POST", "/checkout/renew", { keys: [uk.key], for: "me" }, solo), rs = lastSession();
  ok(rn.clientSecret && rs.customer === (await one("SELECT stripe_customer FROM users WHERE id=$1", [soloId])).stripe_customer && rs.line_items[0].price_data.unit_amount === "2000" && /Update renewal/.test(rs.line_items[0].price_data.product_data.name),
    "Renew: $20 for ten more releases, billed to the person", rs);
  await hook("checkout.session.completed", { id: rn.session, object: "checkout.session", payment_status: "paid", payment_intent: "pi_solo_renew_" + S, amount_total: 2000, customer_details: { email: E("solo") } });
  ok((await one("SELECT updates_until FROM licenses WHERE regexp_replace(key,'-','','g')=$1", [uk.key.replace(/-/g, "")])).updates_until === upd0 + 10, "...paid: ten more releases");
  const churchKey = (await one("SELECT key FROM licenses WHERE church_id=$1 AND kind='U' LIMIT 1", [cid])).key;
  ok((await j("POST", "/checkout/renew", { keys: [memKey], for: "me" }, solo))._status === 404 && (await j("POST", "/checkout/renew", { keys: [churchKey], for: "me" }, mem))._status === 404 && (await j("POST", "/checkout/renew", { keys: [uk.key], for: "me" }, mem))._status === 404,
    "only your own keys: not someone else's, and not a church's (that's the church's renewal)");
  // and their own sound plan, pasted into the Central Usage their church gave them
  const memU = newKeyStr("U");
  await q("INSERT INTO licenses (key,product,kind,church_id,assigned_email,updates_until) VALUES ($1,'made','U',$2,$3,105)", [memU, cid, E("member")]);
  const mu = await useKey(memU, "usage");
  const mp = await j("POST", "/checkout/plans", { plans: ["keys"] }, mem); await completed(mp.session, "sub_mem_" + S);
  const memPkg = mailedKey(E("member")), mpa = await j("POST", "/package/activate", { key: memPkg, deviceId: mu.device, app: "usage" });
  ok(mu.ok && mpa.ok && mpa.plans.keys && mpa.church === "" && (await check(memU, mu.device)).ok, "a church's user buys their own Central Keys and adds it to the Central Usage the church gave them (same device)", mpa);

  // ---------------------------------------------------------------- the price page
  const st = (await finish(await j("POST", "/signup", { email: STAFF, password: "password123" }), STAFF)).token;
  const pp = await j("GET", "/admin/prices", null, st);
  ok(pp.prices.PLANS.keys.cents === 5000 && pp.prices.PLAN_BUNDLES[16] === 257000 && pp.defaults.PLAN_ALL.cents === 22000, "staff see the plan prices on the price page", pp.prices.PLAN_ALL);
  const np = JSON.parse(JSON.stringify(pp.prices));
  np.PLANS.keys.cents = 6000; np.PLAN_ALL.cents = 23000; np.PLAN_BUNDLES = { 4: 70000, 8: 136000 }; np.DISCOUNTS.BETATEST.plans = false;
  ok((await j("POST", "/admin/prices", { prices: np }, st)).ok, "staff change Central Keys to $60, all four to $230, two bundle sizes, and BETATEST off plans");
  const c2 = await j("GET", "/config");
  ok(c2.plans.keys.cents === 6000 && c2.planAll.cents === 23000 && JSON.stringify(c2.planBundles) === JSON.stringify({ 4: 70000, 8: 136000 }), "...right away", { plans: c2.plans.keys, b: c2.planBundles });
  const nb = await j("POST", "/checkout/plans/check", { plans: ["keys"], code: "BETATEST" }, pr);
  ok(nb._status === 400 && /isn't for sound plans/.test(nb.error), "a code staff keep off plans is refused there", nb);
  const keep = JSON.parse(JSON.stringify(pp.prices)); delete keep.PLANS; delete keep.PLAN_ALL; delete keep.PLAN_BUNDLES;
  await j("POST", "/admin/prices", { prices: keep }, st);
  ok((await j("GET", "/config")).plans.keys.cents === 6000, "saving a price list without the plans keeps them as they are");
  await j("POST", "/admin/prices", { reset: true }, st);
  const c3 = await j("GET", "/config");
  ok(c3.plans.keys.cents === 5000 && c3.planAll.cents === 22000 && c3.planBundles[20] === 290000, "Back to the starting prices");

  // ---------------------------------------------------------------- a sale on the website: off a plan's first year too
  await j("POST", "/admin/sale", { name: "Spring sale", percent: 20, banner: "20% off" }, st);
  await j("POST", "/admin/sale/live", {}, st);
  const sp = await account("spring");
  const sc = await j("POST", "/checkout/plans/check", { plans: ["keys"] }, sp);
  ok(sc.ok && sc.percent === 20 && sc.sale === "Spring sale", "a live sale comes off a plan with no code typed", sc);
  await j("POST", "/checkout/plans", { plans: "all" }, sp);
  const ss = lastSession(), sCoupon = calls.filter((c) => c.path === "/v1/coupons").pop().body;
  ok(ss.discounts[0].coupon === "MA-SALE-SPRINGSALE-20-FIRST-YEAR" && sCoupon.percent_off === "20" && sCoupon.duration === "once" && /Spring sale: 20% off the first year/.test(sCoupon.name) && ss.line_items[0].price_data.unit_amount === "22000",
    "...as a coupon on the first year (the yearly price stays $220)", { d: ss.discounts, sCoupon });
  const sb = await j("POST", "/checkout/plans/check", { plans: ["keys"], code: "BETATEST" }, sp);
  ok(sb.percent === 50 && !sb.sale, "a typed code wins over the sale (they don't stack)", sb);
  ok((await j("POST", "/checkout/plan-bundle/check", { seats: 4 }, O)).percent === 20, "the sale is off a church bundle's first year too");
  await j("POST", "/checkout/plans", { plans: ["pedals"] }, sp);
  ok(!(await one("SELECT code FROM plan_subs WHERE id=$1", [Number(lastSession().subscription_data.metadata.plan_sub_id)])).code, "(a sale isn't a code: nothing is used up)");
  await j("POST", "/admin/sale/live", { end: true }, st);
  const se = await j("POST", "/checkout/plans/check", { plans: ["keys"] }, sp);
  ok(se.percent === 0 && !se.sale, "the sale ends: full price", se);

  // ---------------------------------------------------------------- Sound, Board and Click in Central Tracks
  const pub = await account("pub"), buyer = await account("buyer"), fan = await account("fan");
  await q("UPDATE users SET subscribed=TRUE WHERE email=$1", [E("fan")]);
  const ff = (name, args) => { const f = path.join(tmp, name); execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args, f]); return f; };
  const demo = ff("demo.wav", ["-f", "lavfi", "-i", "sine=frequency=330:duration=6", "-ar", "44100", "-ac", "2", "-c:a", "pcm_s16le"]);
  const longDemo = ff("long.wav", ["-f", "lavfi", "-i", "sine=frequency=330:duration=130", "-ar", "8000", "-ac", "1", "-c:a", "pcm_s16le"]);
  const sf2 = path.join(tmp, "grand.sf2"); fs.writeFileSync(sf2, Buffer.concat([Buffer.from("RIFF"), Buffer.from([16, 0, 0, 0]), Buffer.from("sfbkLIST"), Buffer.alloc(64)]));
  const fake = path.join(tmp, "fake.sf2"); fs.writeFileSync(fake, "not a soundfont at all");
  const zip = path.join(tmp, "clicks.zip"); fs.writeFileSync(zip, Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(60)]));
  const board = path.join(tmp, "worship-drive.json"); fs.writeFileSync(board, JSON.stringify({ name: "Worship drive", pedals: [{ type: "overdrive", gain: 0.4 }, { type: "delay", ms: 375 }] }));
  const badBoard = path.join(tmp, "broken.json"); fs.writeFileSync(badBoard, "{ not json");
  async function upload(file, type) {
    const u = await j("POST", "/uploads", { name: path.basename(file), type, size: fs.statSync(file).size }, pub);
    const r = await fetch(u.url, { method: "PUT", body: fs.readFileSync(file), headers: { "Content-Type": type } });
    if (!r.ok) throw new Error("upload " + r.status);
    return { key: u.key, name: path.basename(file) };
  }
  const dU = await upload(demo, "audio/wav"), sU = await upload(sf2, "application/octet-stream");
  ok(/\.sf2$/.test(sU.key), "an .sf2 upload keeps its extension in storage", sU);
  const noItem = await j("POST", "/publish", { title: "Grand", artist: "Pub", kind: "Sound", rights: true, mix: dU }, pub);
  ok(noItem._status === 400 && /Upload the sound itself/.test(noItem.error), "a Sound needs the sound file itself", noItem);
  const fk = await j("POST", "/publish", { title: "Grand", artist: "Pub", kind: "Sound", rights: true, mix: dU, item: await upload(fake, "application/octet-stream") }, pub);
  ok(fk._status === 400 && /isn't a SoundFont/.test(fk.error), "a file that isn't really an .sf2 is refused", fk);
  const wrongExt = await j("POST", "/publish", { title: "Grand", artist: "Pub", kind: "Board", rights: true, mix: dU, item: sU }, pub);
  ok(wrongExt._status === 400 && /pedal board preset/.test(wrongExt.error), "a Board is a .json preset", wrongExt);
  const tooLong = await j("POST", "/publish", { title: "Grand", artist: "Pub", kind: "Sound", rights: true, mix: await upload(longDemo, "audio/wav"), item: sU }, pub);
  ok(tooLong._status === 400 && /under 2 minutes/.test(tooLong.error), "the demo clip is short (under 2 minutes)", tooLong);
  const ps = await j("POST", "/publish", { title: "Felt Grand", artist: "Pub", kind: "Sound", rights: true, mix: dU, item: sU }, pub);
  ok(ps.track && ps.track.kind === "Sound" && ps.track.item === true && ps.track.format === "sf2" && ps.track.stars >= 1 && ps.track.price === c3.starPrices[ps.track.stars] / 100 && ps.grade.checks.length,
    "a Sound is published: the demo's grade (" + (ps.track ? ps.track.stars : "?") + "★) sets its price", ps);
  const bb = await j("POST", "/publish", { title: "Broken", artist: "Pub", kind: "Board", rights: true, mix: dU, item: await upload(badBoard, "application/json") }, pub);
  ok(bb._status === 400 && /isn't readable JSON/.test(bb.error), "a Board that isn't JSON is refused", bb);
  const pb = await j("POST", "/publish", { title: "Worship Drive", artist: "Pub", kind: "Board", rights: true, mix: dU, item: await upload(board, "application/json") }, pub);
  const pk2 = await j("POST", "/publish", { title: "Soft Clicks", artist: "Pub", kind: "Click", rights: true, mix: dU, item: await upload(zip, "application/zip") }, pub);
  ok(pb.track && pb.track.format === "json" && pk2.track && pk2.track.kind === "Click" && pk2.track.format === "zip", "a Board (JSON) and a Click (zip of WAVs) are published", { pb: pb.track, pk2: pk2.track });
  const ls1 = await j("GET", "/tracks?kind=Sound");
  const ls3 = await j("GET", "/tracks?kind=Sound,Board,Click&q=" + encodeURIComponent("Pub"));
  ok(ls1.tracks.some((t) => t.id === ps.track.id && t.kind === "Sound" && t.format === "sf2") && !ls1.tracks.some((t) => t.kind !== "Sound"), "the listing filters by kind and says each one's kind and format", ls1.tracks.slice(0, 3));
  ok([ps.track.id, pb.track.id, pk2.track.id].every((id) => ls3.tracks.some((t) => t.id === id)) && ls3.tracks.every((t) => ["Sound", "Board", "Click"].includes(t.kind)), "...several kinds at once (Sound,Board,Click)");
  const dm = await j("GET", "/tracks/" + ps.track.id + "/demo");
  const dmFile = dm.url ? await fetch(dm.url) : null;
  ok(dm.url && dmFile.ok && (await dmFile.arrayBuffer()).byteLength === fs.statSync(demo).size, "anyone can play the demo clip before buying", dm);
  ok((await j("POST", "/tracks/" + ps.track.id + "/add", null, buyer))._status === 402, "not subscribed: buy it (the apps open the website)");
  const fa = await j("POST", "/tracks/" + ps.track.id + "/add", null, fan);
  const got = fa.files && fa.files[0] ? await fetch(fa.files[0].url) : null;
  ok(fa.kind === "Sound" && fa.format === "sf2" && fa.files.length === 1 && fa.files[0].role === "item" && fa.files[0].name === "grand.sf2" && got && got.ok && Buffer.from(await got.arrayBuffer()).equals(fs.readFileSync(sf2)),
    "Central Tracks Unlimited adds it: the apps get its kind, its format and the file to install (not the demo)", fa);
  const fb = await j("POST", "/tracks/" + pb.track.id + "/add", null, fan);
  ok(fb.kind === "Board" && fb.format === "json" && fb.files[0].name === "worship-drive.json", "a Board arrives as its JSON", fb);
  ok((await j("GET", "/library", null, fan)).tracks.some((t) => t.id === ps.track.id && t.kind === "Sound"), "it's in their storage, with its kind");
  const padRow = await one("INSERT INTO tracks (publisher_id,title,artist,kind,stars,price_cents,status) VALUES ((SELECT id FROM users WHERE email=$1),'Hymn pad','Pub','Pad',3,1500,'live') RETURNING id", [E("pub")]);
  ok((await j("GET", "/tracks/" + padRow.id + "/demo"))._status === 404, "a recording has no separate demo clip");
  const fp = await j("POST", "/tracks/" + padRow.id + "/add", null, fan);
  ok(fp.kind === "Pad" && fp.format === undefined, "a recording still arrives as before (kind Pad)", fp);

  // ---------------------------------------------------------------- deleting an account
  ok((await j("POST", "/account/delete", { password: "password123" }, pat2)).ok, "(an account with nothing to hand over is deleted)");
  const p1Key = (await j("POST", "/church/packages/give", { email: E("p1") }, O)).key, p1 = await account("p1");   // (a key from the bundle still on)
  const before = await pkg(p1Key, "usage");
  await q("INSERT INTO church_members (church_id,user_id,role) SELECT $1, id, 'user' FROM users WHERE email=$2 ON CONFLICT DO NOTHING", [cid, E("p1")]);
  ok((await j("POST", "/account/delete", { password: "password123" }, p1)).ok && (await pkgCheck(p1Key, before.deviceId)).ok === false, "someone deletes their account: the church's key they had stops (a new one takes its place)");
} catch (e) { console.error(e); fails++; }
finally {
  srv.kill(); mailSrv.close(); stripeSrv.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  if (fails) console.log(log.slice(-4000));
  console.log(fails ? "\n" + fails + " CHECK(S) FAILED" : "\nALL CHECKS PASSED"); process.exit(fails ? 1 : 0);
}
