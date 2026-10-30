// 9.3 against a real Postgres and a stand-in Stripe: the embedded payment form (Checkout Studio settings, prices with
// tax included, codes and sales, never on the pedal), fulfilment from the webhook (keys, Central Services slots, a
// renewal, a track, the subscription), refunds, disputes and fraud warnings taking it all back, two main admins,
// staff sales with a preview, the apps paying on the website, and publishers verifying their ID.
//   node test/v93.mjs postgres://.../ma [port]
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Stripe from "stripe";

const here = path.dirname(fileURLToPath(import.meta.url));
const db = process.argv[2] || "postgres://postgres@127.0.0.1:55432/ma", port = Number(process.argv[3] || 18899), base = "http://127.0.0.1:" + port;
const S = Date.now(), STAFF = "staff93" + S + "@motion.test", WHSEC = "whsec_test93";
const E = (n) => n + S + "@grace93.test";

// ---- email: a stand-in Resend
const mails = [];
const mailSrv = http.createServer((req, res) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => { mails.push(JSON.parse(b || "{}")); res.end('{"id":"x"}'); }); });
await new Promise((r) => mailSrv.listen(0, "127.0.0.1", r));
const to = (who) => mails.filter((m) => m.to && m.to[0] === who);

// ---- a stand-in Stripe: records what the server asks for, answers like Stripe does
const calls = [], charges = {}, invoicePays = {};
let n = 0;
function nest(params) {   // a[b][0][c]=x → { a: { b: [{ c: "x" }] } }
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
    if (/^\/v1\/checkout\/sessions\/[^/]+\/expire$/.test(p)) return send({ id: p.split("/")[4], object: "checkout.session", status: "expired" });
    if (p === "/v1/checkout/sessions") { const id = "cs_test_" + S + "_" + ++n; return send({ id, object: "checkout.session", client_secret: id + "_secret", url: null }); }
    if (p.startsWith("/v1/payment_intents/")) { const id = p.split("/")[3]; return send({ id, object: "payment_intent", latest_charge: Object.assign({ id: "ch_" + id, object: "charge", disputed: false, refunded: false }, charges[id] || {}) }); }
    if (p === "/v1/refunds") return send({ id: "re_" + ++n, object: "refund" });
    if (p === "/v1/invoice_payments") { const pi = u.searchParams.get("payment[payment_intent]"); return send({ object: "list", data: invoicePays[pi] ? [{ id: "inpay_1", invoice: invoicePays[pi] }] : [], has_more: false }); }
    if (p.startsWith("/v1/invoices/")) return send({ id: p.split("/")[3], object: "invoice", parent: { subscription_details: { subscription: "sub_disputed" } } });
    if (p.startsWith("/v1/subscriptions/") && req.method === "DELETE") return send({ id: p.split("/")[3], object: "subscription", status: "canceled" });
    if (p === "/v1/billing_portal/sessions") return send({ id: "bps_1", url: "https://billing.stripe.test/p" });
    if (p === "/v1/identity/verification_sessions") return send({ id: "vs_" + S, object: "identity.verification_session", url: "https://verify.stripe.test/vs" });
    if (p === "/v1/account_sessions") return send({ object: "account_session", client_secret: "acs_secret" });
    if (p === "/v2/core/accounts" && req.method === "POST") return send({ id: "acct_" + S, object: "v2.core.account" });
    if (p.startsWith("/v2/core/accounts/")) return send({ id: p.split("/")[4], object: "v2.core.account", configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { status: "active" } } } } } });
    if (p === "/v2/core/account_links") return send({ object: "v2.core.account_link", url: "https://connect.stripe.test/setup" });
    send({ error: { message: "stand-in Stripe doesn't know " + req.method + " " + p, type: "invalid_request_error" } }, 404);
  });
});
await new Promise((r) => stripeSrv.listen(0, "127.0.0.1", r));
const sessions = () => calls.filter((c) => c.path === "/v1/checkout/sessions");
const lastSession = () => sessions().pop().body;

process.env.DATABASE_URL = db;
const srv = spawn(process.execPath, [path.join(here, "..", "src", "index.js")], { env: Object.assign({}, process.env, { PORT: String(port), STRIPE_SECRET_KEY: "sk_test_93", STRIPE_PUBLISHABLE_KEY: "pk_test_93", STRIPE_WEBHOOK_SECRET: WHSEC,
  STRIPE_API_URL: "http://127.0.0.1:" + stripeSrv.address().port, RESEND_API_KEY: "re_test", MAIL_FROM: "M <t@motion.test>", RESEND_API_URL: "http://127.0.0.1:" + mailSrv.address().port + "/emails",
  PUBLIC_URL: "https://motion.test", ADMIN_EMAILS: STAFF, REMINDERS: "off", REQUIRE_ID_TO_PUBLISH: "on" }), stdio: ["ignore", "pipe", "pipe"] });
let log = ""; srv.stdout.on("data", (d) => { log += d; }); srv.stderr.on("data", (d) => { log += d; });
for (let i = 0; i < 100 && !/Motion Audio server on/.test(log); i++) await new Promise((r) => setTimeout(r, 100));

let fails = 0;
const ok = (c, m, d) => { console.log((c ? "  ✓ " : "  ✗ ") + m + (c || d === undefined ? "" : "   -- " + JSON.stringify(d).slice(0, 700))); if (!c) fails++; };
let ipN = 0;
const j = async (method, p, body, tok) => { const r = await fetch(base + "/v1" + p, { method, headers: { "Content-Type": "application/json", "X-Forwarded-For": "10.93." + (++ipN % 200) + ".1", ...(tok ? { Authorization: "Bearer " + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); return Object.assign(await r.json().catch(() => ({})), { _status: r.status }); };
async function finish(r, email) {   // (main admins and admins: a code by email here - no Twilio)
  if (!r.step) return r;
  if (r.step === "phone") Object.assign(r, await j("POST", "/login/phone", { ticket: r.ticket, phone: "555-093-" + String(S).slice(-4) }));
  const m = to(email).filter((x) => /sign-in code/.test(x.subject)).pop();
  return Object.assign({}, r, { token: (await j("POST", "/login/code", { ticket: r.ticket, code: m.subject.match(/(\d{6})/)[1] })).token });
}
const confirm = async (email) => { const m = to(email).filter((x) => /Confirm your email/.test(x.subject)).pop(); return j("POST", "/account/confirm", { token: m.text.match(/#confirm-([A-Za-z0-9_-]+)/)[1] }); };
const account = async (who, extra) => { const r = await finish(await j("POST", "/signup", Object.assign({ email: E(who), password: "password123", name: who }, extra || {})), E(who)); await confirm(E(who)); return r.token; };
const signer = new Stripe("sk_test_93");
async function hook(type, object, secret) {   // a webhook event, signed the way Stripe signs it
  const payload = JSON.stringify({ id: "evt_" + ++n, object: "event", type, data: { object } });
  const sig = signer.webhooks.generateTestHeaderString({ payload, secret: secret || WHSEC });
  const r = await fetch(base + "/stripe/webhook", { method: "POST", headers: { "Content-Type": "application/json", "Stripe-Signature": sig }, body: payload });
  return r.status;
}
const paid = (sessionId, pi, extra) => hook("checkout.session.completed", Object.assign({ id: sessionId, object: "checkout.session", payment_status: "paid", payment_intent: pi, amount_total: 1, customer_details: { email: "buyer@grace93.test" } }, extra || {}));

try {
  const { q, one } = await import("../src/db.js");
  const cfg = await j("GET", "/config");
  ok(cfg.payments && cfg.publishableKey === "pk_test_93" && cfg.sale === null, "the page gets the publishable key for the payment form; no sale on");

  // ---------------------------------------------------------------- the store: the embedded form
  const T = await account("main", { churchName: "Grace 93 " + S });
  // (this church plays one from before 9.3.1, made by a person: its maker is its main admin - test/v931.mjs has church accounts)
  await q("UPDATE church_members SET role='owner' WHERE role='church' AND church_id=(SELECT id FROM churches WHERE name=$1)", ["Grace 93 " + S]);
  const st = await j("POST", "/checkout/store", { items: { "pack-ultra": 1, "ultra-plus10": 1, pedal: 1, "services-slot": 2 }, code: "betatest" }, T);
  const s1 = lastSession(), L = s1.line_items;
  ok(st.clientSecret && st.clientSecret.endsWith("_secret") && st.session, "a checkout answers with the payment form's client secret", st);
  ok(s1.ui_mode === "form" && s1.integration_identifier === "custom_embedded_web_0001" && s1.billing_address_collection === "auto" && s1.automatic_tax.enabled === "false" && s1.phone_number_collection.enabled === "false" && /\/#order-done-\{CHECKOUT_SESSION_ID\}$/.test(s1.return_url) && !s1.success_url,
    "Checkout Studio settings: the embedded form, address when needed, no phone, Stripe Tax off, a return link", s1);
  const byName = (re) => L.find((x) => re.test(x.price_data.product_data.name));
  const ul = byName(/^Ultra pack/), add = byName(/10 more/), ped = byName(/Central Pedal \(built/), slot = byName(/^Central Services slot/);
  ok(ul.price_data.unit_amount === "35000" && add.price_data.unit_amount === "1750" && slot.price_data.unit_amount === "250" && slot.quantity === "2" && ped.price_data.unit_amount === "25000" && /BETATEST/.test(ul.price_data.product_data.name) && !/BETATEST/.test(ped.price_data.product_data.name),
    "BETATEST: half off the pack, its 10 more slots and the slots; the built pedal stays $250", L.map((x) => x.price_data.product_data.name + " " + x.price_data.unit_amount));
  ok(L.every((x) => x.price_data.tax_behavior === "inclusive" && x.price_data.currency === "usd") && ped.price_data.product_data.tax_code === "txcd_99999999" && ul.price_data.product_data.tax_code === "txcd_10202003",
    "every price includes tax and carries its tax code (the pedal: physical goods; software for the rest)");
  ok(/1 main admin \+ 5 admins · 16 users · Central Pedal Control · 30 Central Services slots/.test(ul.price_data.product_data.description) && s1.shipping_address_collection.allowed_countries.join() === "US,CA",
    "the form says what's in the pack, and asks where to ship the pedal (US and Canada)", ul.price_data.product_data.description);
  ok((await j("POST", "/checkout/store", { items: { "ultra-plus10": 2, "pack-ultra": 1 } }, T))._status === 400, "one +10 slots for each Ultra pack");

  // ---------------------------------------------------------------- the webhook does the work
  const forged = await hook("checkout.session.completed", { id: st.session, object: "checkout.session", payment_status: "paid", payment_intent: "pi_store" }, "whsec_wrong");
  ok(forged === 400 && !(await one("SELECT 1 FROM orders WHERE stripe_session=$1", [st.session])), "a webhook with a wrong signature is refused (nothing happens)");
  ok((await j("GET", "/orders/" + st.session)).pending, "until Stripe says it's paid, the order is waiting");
  ok(await paid(st.session, "pi_store_" + S, { shipping_details: { name: "Grace", address: { country: "US" } } }) === 200 && await paid(st.session, "pi_store_" + S) === 200, "Stripe's paid event (sent twice, as Stripe may)");
  const ord = await j("GET", "/orders/" + st.session);
  ok(ord.licenses.length === 1 + 6 + 16 + 1 && ord.slots === 30 + 10 + 2 && ord.status === "paid" && ord.shipping, "...once: 24 keys (pedal + Pedal Control, 6 A, 16 U) and 42 Central Services slots", { keys: ord.licenses.length, slots: ord.slots });
  const ch1 = await j("GET", "/church", null, T);
  ok(ch1.church.servicesSlots === 42 && ch1.counts.A.total === 6 && ch1.church.hasPack, "the church has its keys and 42 slots", ch1.church);
  ok((await j("GET", "/discount/BETATEST", null, T)).used, "BETATEST is used up for this church");
  ok(await paid("cs_nobody_" + S, "pi_x") === 200, "a paid event for a checkout this server didn't start changes nothing (no error)");
  const twice = await j("POST", "/checkout/store", { items: { "ultra-plus10": 1 } }, T);
  ok(twice._status === 400 && /goes with Ultra pack/.test(twice.error), "the Ultra's 10 more slots: one for each Ultra pack (this one has them)", twice);

  // ---------------------------------------------------------------- refunds, disputes, fraud warnings
  const small = await j("POST", "/checkout/store", { items: { admin: 1, "services-slot": 3 } }, T);
  await paid(small.session, "pi_small_" + S);
  const smallKey = (await one("SELECT l.key FROM licenses l JOIN orders o ON o.id=l.order_id WHERE o.stripe_session=$1", [small.session])).key;
  const act = await j("POST", "/license/activate", { key: smallKey, device: "dev-" + S, deviceName: "Booth", app: "control" });
  const slots0 = (await j("GET", "/services/slots", null, T)).slots;
  ok(act.ok && slots0 === 45, "an admin key and 3 more slots (45 now)", { act, slots0 });
  ok(await hook("charge.refunded", { id: "ch_1", object: "charge", refunded: true, payment_intent: "pi_small_" + S }) === 200, "Stripe: that payment was refunded");
  const chk = await j("POST", "/license/check", { key: smallKey, device: "dev-" + S });
  ok(!chk.ok && (await j("GET", "/services/slots", null, T)).slots === 42 && (await one("SELECT status FROM orders WHERE stripe_session=$1", [small.session])).status === "refunded",
    "a refund takes back its key (the app stops) and its 3 slots", chk);
  await hook("charge.refunded", { id: "ch_1", object: "charge", refunded: true, payment_intent: "pi_small_" + S });
  ok((await j("GET", "/services/slots", null, T)).slots === 42, "...once (the event repeating changes nothing)");
  await hook("charge.dispute.created", { id: "dp_0", object: "dispute", payment_intent: "pi_small_" + S });
  await hook("radar.early_fraud_warning.created", { id: "issfr_0", object: "radar.early_fraud_warning", actionable: true, charge: "ch_small", payment_intent: "pi_small_" + S });
  ok((await j("GET", "/services/slots", null, T)).slots === 42 && (await one("SELECT status FROM orders WHERE stripe_session=$1", [small.session])).status === "refunded" && !calls.some((c) => c.path === "/v1/refunds" && c.body.charge === "ch_small"),
    "refunded, then disputed, then a fraud warning: taken back only once (no slots from other orders lost, no second refund)");

  // a dispute that arrives before the paid event: still taken back
  const late = await j("POST", "/checkout/store", { items: { user: 1 } }, T);
  charges["pi_late_" + S] = { disputed: true };
  await paid(late.session, "pi_late_" + S);
  ok((await one("SELECT bool_and(revoked) AS r FROM licenses l JOIN orders o ON o.id=l.order_id WHERE o.stripe_session=$1", [late.session])).r === true, "a payment disputed before Stripe said it was paid: its key never works");

  // Radar's early fraud warning: digital goods are refunded at once; a built pedal is held
  await hook("radar.early_fraud_warning.created", { id: "issfr_1", object: "radar.early_fraud_warning", actionable: true, charge: "ch_store", payment_intent: "pi_store_" + S });
  ok((await one("SELECT status FROM orders WHERE stripe_session=$1", [st.session])).status === "review" && !calls.some((c) => c.path === "/v1/refunds" && c.body.charge === "ch_store"), "a fraud warning on an order with the pedal holds it for review (don't ship), no refund yet");
  const dig = await j("POST", "/checkout/store", { items: { user: 1 } }, T); await paid(dig.session, "pi_dig_" + S);
  await hook("radar.early_fraud_warning.created", { id: "issfr_2", object: "radar.early_fraud_warning", actionable: true, charge: "ch_dig", payment_intent: "pi_dig_" + S });
  ok(calls.some((c) => c.path === "/v1/refunds" && c.body.charge === "ch_dig" && c.body.reason === "fraudulent"), "...on a digital order it's refunded right away (cheaper than a dispute)");

  // a once-per-church code can't be paid twice by keeping two checkouts open: the newer one closes the older
  const tw = await account("twotabs", { churchName: "Two tabs " + S });
  const tab1 = await j("POST", "/checkout/store", { items: { user: 1 }, code: "BETATEST" }, tw);
  const tab2 = await j("POST", "/checkout/store", { items: { admin: 1 }, code: "BETATEST" }, tw);
  ok(tab1.clientSecret && tab2.clientSecret && calls.some((c) => c.path === "/v1/checkout/sessions/" + tab1.session + "/expire") && !calls.some((c) => c.path === "/v1/checkout/sessions/" + tab2.session + "/expire"),
    "BETATEST in two checkouts at once: the first one is closed, so the code is paid for once");

  // ---------------------------------------------------------------- renewals
  const aKey = (await one("SELECT key, updates_until FROM licenses WHERE church_id=(SELECT church_id FROM orders WHERE stripe_session=$1) AND kind='A' AND NOT revoked LIMIT 1", [st.session]));
  const rn = await j("POST", "/checkout/renew", { keys: [aKey.key] }, T);
  ok(rn.clientSecret && /Update renewal/.test(lastSession().line_items[0].price_data.product_data.name) && lastSession().line_items[0].price_data.unit_amount === "2000", "renewing a key: $20 on the payment form", lastSession().line_items[0]);
  await paid(rn.session, "pi_ren_" + S);
  const after = (await one("SELECT updates_until FROM licenses WHERE key=$1", [aKey.key])).updates_until;
  ok(after === aKey.updates_until + 10, "...paid: ten more releases", { before: aKey.updates_until, after });
  await hook("charge.dispute.created", { id: "dp_1", object: "dispute", payment_intent: "pi_ren_" + S });
  ok((await one("SELECT updates_until FROM licenses WHERE key=$1", [aKey.key])).updates_until === aKey.updates_until, "...disputed: the ten releases come off again");

  // ---------------------------------------------------------------- a sale (staff save it, preview it, put it live)
  const sTok = (await finish(await j("POST", "/signup", { email: STAFF, password: "password123" }), STAFF)).token;
  ok((await j("POST", "/admin/sale", { name: "Easter", percent: 30, banner: "30% off everything for Easter" }, T))._status === 403, "only Motion Audio staff make sales");
  const dr = await j("POST", "/admin/sale", { name: "Easter", percent: 30, banner: "30% off everything for Easter", endsAt: new Date(Date.now() + 864e5).toISOString() }, sTok);
  ok(dr.ok && (await j("GET", "/config")).sale === null && (await j("GET", "/config?preview=1", null, sTok)).sale.percent === 30 && (await j("GET", "/config?preview=1", null, T)).sale === null,
    "Save: only staff see it (Preview); everyone else still sees no sale");
  ok((await j("POST", "/admin/sale", { percent: 95 }, sTok))._status === 400, "a sale is 1% to 90% off");
  await j("POST", "/admin/sale/live", {}, sTok);
  const pub = (await j("GET", "/config")).sale;
  ok(pub && pub.percent === 30 && pub.name === "Easter" && /Easter/.test(pub.banner), "Put it live: everyone sees it", pub);
  const other = await account("other", { churchName: "Other 93 " + S });
  await j("POST", "/checkout/store", { items: { "pack-lite": 1, pedal: 1 } }, other);
  const ls = lastSession().line_items;
  ok(ls.find((x) => /Lite/.test(x.price_data.product_data.name)).price_data.unit_amount === "17500" && ls.find((x) => /Pedal \(built/.test(x.price_data.product_data.name)).price_data.unit_amount === "25000", "the live sale comes off at checkout ($250 → $175), not off the pedal", ls.map((x) => x.price_data.unit_amount));
  await j("POST", "/checkout/store", { items: { "pack-lite": 1 }, code: "BETATEST" }, other);
  ok(lastSession().line_items[0].price_data.unit_amount === "12500", "a typed code wins over the sale");
  await j("POST", "/admin/sale/live", { end: true }, sTok);
  ok((await j("GET", "/config")).sale === null, "End the sale: it's gone");
  const ou = await j("POST", "/checkout/store", { items: { "pack-ultra": 1 } }, other); await paid(ou.session, "pi_ou_" + S);
  const later = await j("POST", "/checkout/store", { items: { "ultra-plus10": 1 } }, other);
  ok(later.clientSecret && /10 more/.test(lastSession().line_items[0].price_data.product_data.name), "with an Ultra pack bought, its 10 more slots can be added later");

  // ---------------------------------------------------------------- two main admins
  const adminTok = await account("adm", {});
  const codes = (await j("GET", "/church", null, T)).church;
  await j("POST", "/church/join", { code: codes.adminCode, role: "admin" }, adminTok);
  const userTok = await account("usr", {});
  await j("POST", "/church/join", { code: codes.userCode, role: "user" }, userTok);
  const ub = await j("POST", "/checkout/store", { items: { user: 1 } }, userTok);
  ok(ub._status === 403 && /main admins and admins buy/.test(ub.error), "a user can't buy on the church's account (main admins and admins do)", ub);
  const third = await account("third", {}); await j("POST", "/church/join", { code: codes.adminCode, role: "admin" }, third);
  ok((await j("POST", "/church/main-admin", { email: E("usr") }, T))._status === 400, "a user can't be made a main admin straight away (they're made an admin first)");
  const prom = await j("POST", "/church/main-admin", { email: E("adm") }, T);
  ok(prom.ok && prom.mainAdmins === 2 && to(E("adm")).some((m) => /You're now a main admin/.test(m.subject)), "a main admin makes an admin a second main admin (they're told by email)", prom);
  const adminTok2 = (await finish(await j("POST", "/login", { email: E("adm"), password: "password123" }), E("adm"))).token;
  ok((await j("GET", "/me", null, adminTok2)).church.role === "owner" && (await j("POST", "/church/role", { email: E("usr"), role: "admin" }, adminTok2)).ok, "...who has the main admin's controls (here: making the user an admin)");
  const t3 = await j("POST", "/church/main-admin", { email: E("third") }, adminTok2);
  ok(t3._status === 409 && /2 main admins already/.test(t3.error), "a third is refused: up to 2", t3);
  ok((await j("POST", "/church/main-admin", { email: E("adm"), on: false }, adminTok2)).ok && (await j("GET", "/me", null, adminTok2)).church.role === "admin", "Back to admin: one of them steps down");
  const last = await j("POST", "/church/main-admin", { email: E("main"), on: false }, T);
  ok(last._status === 409 && /needs a main admin/.test(last.error), "...but never the last one", last);
  await j("POST", "/church/main-admin", { email: E("adm") }, T);
  const del = await j("POST", "/account/delete", { password: "password123" }, adminTok2);
  const ch2 = await one("SELECT c.owner_id, c.closed_at, u.email FROM churches c LEFT JOIN users u ON u.id=c.owner_id WHERE c.name=$1", ["Grace 93 " + S]);
  ok(del.ok && !del.closedChurch && ch2.email === E("main") && !ch2.closed_at, "with two main admins, one can delete their account: the church carries on with the other", { del, ch2 });
  await j("POST", "/church/main-admin", { email: E("third") }, T);
  const delMain = await j("POST", "/account/delete", { password: "password123" }, T);
  const ch3 = await one("SELECT c.closed_at, u.email FROM churches c LEFT JOIN users u ON u.id=c.owner_id WHERE c.name=$1", ["Grace 93 " + S]);
  ok(delMain.ok && !delMain.closedChurch && ch3.email === E("third") && !ch3.closed_at, "...even the one the receipts go to: they go to the other main admin now", ch3);

  // ---------------------------------------------------------------- the subscription and the publisher pool
  const subTok = await account("sub", {});
  const sc = await j("POST", "/checkout/subscription", null, subTok), ss = lastSession();
  ok(sc.clientSecret && ss.mode === "subscription" && ss.payment_method_collection === "always" && ss.line_items[0].price_data.recurring.interval === "month" && ss.line_items[0].price_data.unit_amount === "7700" && ss.line_items[0].price_data.tax_behavior === "inclusive",
    "Central Tracks Unlimited: $77 a month (tax included) on the same payment form", ss.line_items[0]);
  await hook("checkout.session.completed", { id: sc.session, object: "checkout.session", payment_status: "paid", subscription: "sub_" + S, mode: "subscription" });
  ok((await j("GET", "/me", null, subTok)).subscribed, "...paid: subscribed");
  const subUser = await one("SELECT id, stripe_customer FROM users WHERE email=$1", [E("sub")]);
  await hook("invoice.paid", { id: "in_" + S, object: "invoice", customer: subUser.stripe_customer, amount_paid: 7700, parent: { type: "subscription_details", subscription_details: { subscription: "sub_" + S } }, payments: { data: [{ payment: { payment_intent: "pi_inv_" + S } }] }, status_transitions: { paid_at: Math.floor(Date.now() / 1000) } });
  ok((await one("SELECT cents, reversed FROM subscription_payments WHERE invoice_id=$1", ["in_" + S])).cents === 7700, "each month's payment goes into the publisher pool");
  invoicePays["pi_inv_" + S] = "in_" + S;
  await hook("charge.dispute.created", { id: "dp_2", object: "dispute", payment_intent: "pi_inv_" + S });
  ok((await one("SELECT reversed FROM subscription_payments WHERE invoice_id=$1", ["in_" + S])).reversed && calls.some((c) => c.method === "DELETE" && c.path === "/v1/subscriptions/sub_disputed"), "a disputed month comes out of the pool, and the subscription ends");
  await hook("customer.subscription.deleted", { id: "sub_" + S, object: "subscription", status: "canceled", customer: subUser.stripe_customer, metadata: { kind: "tracks", user_id: String(subUser.id) } });
  ok(!(await j("GET", "/me", null, subTok)).subscribed, "...and access ends with it");

  // ---------------------------------------------------------------- publishers: ID check, payouts, a sale taken back
  const pubTok = await account("pub", {});
  const noId = await j("POST", "/publish", { title: "Song", artist: "Me", kind: "Pad", rights: true, mix: { key: "x" } }, pubTok);
  ok(noId._status === 403 && /Verify your ID/.test(noId.error), "publishing waits for a one-time ID check", noId);
  const idv = await j("POST", "/identity", null, pubTok);
  ok(idv.url && calls.some((c) => c.path === "/v1/identity/verification_sessions" && c.body.type === "document" && c.body.options.document.require_matching_selfie === "true"), "Verify my ID: Stripe Identity (a photo ID and a selfie)");
  await hook("identity.verification_session.verified", { id: "vs_" + S, object: "identity.verification_session", status: "verified" });
  const yesId = await j("POST", "/publish", { title: "Song", artist: "Me", kind: "Pad", rights: true, mix: { key: "x" } }, pubTok);
  ok(yesId._status === 400 && /Upload the full mix/.test(yesId.error) && (await j("GET", "/me", null, pubTok)).idStatus === "verified", "...verified: publishing goes ahead (here it asks for the upload)", yesId);
  const cn = await j("POST", "/connect", null, pubTok);
  const acc = calls.find((c) => c.path === "/v2/core/accounts" && c.method === "POST"), lk = calls.filter((c) => c.path === "/v2/core/account_links").pop();
  ok(cn.url && acc.body.dashboard === "express" && acc.body.configuration.recipient.capabilities.stripe_balance.stripe_transfers.requested === true && lk.body.use_case.type === "account_onboarding" && lk.body.use_case.account_onboarding.configurations[0] === "recipient",
    "payout setup: a Stripe recipient account (Express) and Stripe's setup pages", { acc: acc && acc.body, lk: lk && lk.body });
  ok((await j("GET", "/me", null, pubTok)).payoutsReady === true, "back from Stripe: payouts are ready once Stripe says transfers are active");
  ok((await j("POST", "/connect/session", null, pubTok)).clientSecret === "acs_secret", "the payout settings show on the website (Stripe's embedded components)");
  // a track sale, then a refund after it was paid out: the share comes off the next payout
  const pubId = (await one("SELECT id FROM users WHERE email=$1", [E("pub")])).id, buyerTok = await account("buyer", {}), buyerId = (await one("SELECT id FROM users WHERE email=$1", [E("buyer")])).id;
  const tr = await one("INSERT INTO tracks (publisher_id,title,artist,kind,stars,price_cents,status) VALUES ($1,'Hymn','Pub','Pad',4,2000,'live') RETURNING id", [pubId]);
  const tAdd = await j("POST", "/tracks/" + tr.id + "/add", null, buyerTok);
  ok(tAdd._status === 402 && tAdd.checkoutUrl === "https://motion.test/#buy-" + tr.id, "the apps: not subscribed? they open the website to buy the track", tAdd);
  ok((await j("POST", "/tracks/" + tr.id + "/purchase", null, buyerTok)).checkoutUrl === "https://motion.test/#buy-" + tr.id, "...the apps' Buy button goes to the website too");
  const tb = await j("POST", "/tracks/" + tr.id + "/purchase?web=1", null, buyerTok);
  ok(tb.clientSecret && lastSession().line_items[0].price_data.unit_amount === "2000" && lastSession().line_items[0].price_data.product_data.tax_code === "txcd_10401100", "the website: a 4★ track is $20 on the payment form");
  ok((await j("GET", "/tracks/" + tr.id, null, buyerTok)).track.price === 20, "the website can show the track the apps sent you to");
  await paid(tb.session, "pi_track_" + S);
  ok((await j("GET", "/library", null, buyerTok)).tracks.some((t) => t.id === String(tr.id)) && (await one("SELECT cents FROM earnings WHERE track_id=$1 AND reason='purchase'", [tr.id])).cents === 1500, "paid: the track is theirs; the publisher has 75% ($15)");
  await q("UPDATE earnings SET transfer_id='tr_paid' WHERE track_id=$1", [tr.id]);
  await hook("charge.refunded", { id: "ch_t", object: "charge", refunded: true, payment_intent: "pi_track_" + S });
  ok(!(await j("GET", "/library", null, buyerTok)).tracks.some((t) => t.id === String(tr.id)) && (await one("SELECT cents FROM earnings WHERE track_id=$1 AND reason='reversal'", [tr.id])).cents === -1500,
    "refunded after payout: the track is taken back and $15 comes off the publisher's next payout");
} catch (e) { ok(false, "crashed: " + e.message, e.stack); }
finally { srv.kill(); stripeSrv.close(); mailSrv.close(); }
console.log(fails ? "\n" + fails + " 9.3 CHECK(S) FAILED\n" + log.slice(-3000) : "\nALL 9.3 CHECKS PASSED");
process.exit(fails ? 1 : 0);
