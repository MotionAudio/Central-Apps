// Stripe for Motion Audio (see ../STRIPE-PLAN.md):
//  - Checkout, embedded on our own page (ui_mode "form", the Checkout Studio settings below): the store (keys, packs,
//    Central Services slots, the built pedal), key renewals, single Central Tracks, and the $77/month Central Tracks
//    Unlimited subscription, and (9.5) the yearly sound plans: package keys, a person's own or a church bundle's.
//    The browser gets a client_secret and shows Stripe's payment form in a window on the site.
//  - Prices come from config.js / the staff price page and go to Stripe as price_data, tax included (tax_behavior
//    "inclusive"), each with its tax code, so receipts and the Dashboard show the real names.
//  - Fulfilment happens only in the webhook (/stripe/webhook), from the row this server wrote when it started the
//    Checkout Session (never from metadata alone).
//  - Radar runs on every payment. Refunds, disputes and early fraud warnings take back what a payment gave: keys,
//    Central Services slots, renewals, a track (and the publisher's share), subscription money in the publisher pool.
//  - Connect: publishers are Accounts v2 recipient accounts (Express dashboard); payouts.js pays them monthly.
//  - Identity: publishers verify their ID once before their first upload.
//  - Tax: off (automatic_tax false) until it's set up; every price already includes tax and carries a tax code.
import Stripe from "stripe";
import { config, PRODUCTS, SUBSCRIPTION, PUBLISHER_SHARE, DISCOUNTS, RENEWAL, TAX_CODES, PLANS, PLAN_IDS, PLAN_ALL, PLAN_BUNDLES, PLAN_INTERVAL, PADS_PLAN, withPads } from "./config.js";
import { q, one, pool } from "./db.js";
import { churchOf, createChurch, personalChurch, issueKeys, canon, pretty } from "./licenses.js";
import { sendDownloadsEmail } from "./downloads.js";
import { fmt, COVER_RELEASES } from "./versions.js";
import { PLAN_LIVE, PLAN_END, issuePackages } from "./plans.js";
import { recordPlanPayment, reversePlanPayment } from "./creators.js";

function err(msg, status = 400, extra) { const e = new Error(msg); e.status = status; return Object.assign(e, extra || {}); }
const S = config.stripe;
function stripeOptions() {
  const o = { apiVersion: S.apiVersion, appInfo: { name: "Motion Audio", url: config.publicUrl } };
  if (S.api) { const u = new URL(S.api); Object.assign(o, { host: u.hostname, port: Number(u.port) || (u.protocol === "https:" ? 443 : 80), protocol: u.protocol.replace(":", "") }); }
  return o;
}
export const stripe = S.secret ? new Stripe(S.secret, stripeOptions()) : null;
export function needStripe() { if (!stripe) throw err("Payments aren't set up yet (STRIPE_SECRET_KEY is missing).", 503); }

// Checkout Studio settings, the same on every Checkout Session
const STUDIO = { ui_mode: "form", billing_address_collection: "auto", phone_number_collection: { enabled: false }, automatic_tax: { enabled: false }, integration_identifier: "custom_embedded_web_0001" };
const back = (hash) => config.publicUrl + "/#" + hash;

// ---------------------------------------------------------------- codes and sales
// a % code: known, switched on, and not used by this church yet. Off everything but the built pedal.
export async function percentCode(code, church) {
  const c = String(code || "").trim().toUpperCase(); if (!c) return null;
  const d = DISCOUNTS[c];
  if (!d || d.on === false) throw err("That code isn't valid.", 404);
  if (d.trial) throw err("That's a free trial code: press Start the free trial.", 400, { trialCode: c });
  if (church && (await one("SELECT 1 FROM discount_uses WHERE church_id=$1 AND code=$2", [church.id, c]))) throw err("Your church already used " + c + ".", 409);
  return { code: c, percent: d.percent, label: d.label };
}
// the sale that's on the website now (staff save it, preview it, then put it live): { name, percent, endsAt, includePedal }
export async function liveSale() {
  const r = await one("SELECT data FROM site_settings WHERE name='sale'");
  const s = r && r.data && r.data.live;
  if (!s || !s.percent) return null;
  if (s.endsAt && Date.parse(s.endsAt) < Date.now()) return null;
  return s;
}
// what comes off: a typed code wins; otherwise the live sale
async function discountFor(code, church) {
  const d = await percentCode(code, church);
  if (d) return { ...d, pedal: false };
  const s = await liveSale();
  return s ? { code: "", sale: s.name || "Sale", percent: s.percent, label: (s.name || "Sale") + ": " + s.percent + "% off", pedal: !!s.includePedal } : null;
}
const off = (cents, d) => (d ? Math.round((cents * (100 - d.percent)) / 100) : cents);

// ---------------------------------------------------------------- customers
async function customerFor(user) {
  if (user.stripe_customer) return user.stripe_customer;
  const c = await stripe.customers.create({ email: user.email, name: user.name || undefined, metadata: { user_id: String(user.id) } });
  await q("UPDATE users SET stripe_customer=$1 WHERE id=$2", [c.id, user.id]);
  return c.id;
}
// the church's own billing (its name on the receipts; the card stays with the church when a main admin changes)
export async function churchCustomer(church) {
  if (church.stripe_customer) return church.stripe_customer;
  const owner = church.owner_id ? await one("SELECT email FROM users WHERE id=$1", [church.owner_id]) : null;
  const c = await stripe.customers.create({ name: church.name, email: owner ? owner.email : undefined, metadata: { church_id: String(church.id) } });
  await q("UPDATE churches SET stripe_customer=$1 WHERE id=$2", [c.id, church.id]);
  return c.id;
}
export async function churchBillingPortal(church) {
  needStripe();
  const s = await stripe.billingPortal.sessions.create({ customer: await churchCustomer(church), return_url: back("account") });
  return s.url;
}
export async function syncChurchCustomer(churchId) {   // (a new name, or a new main admin: the receipts' name and email)
  if (!stripe) return;
  const c = await one("SELECT c.*, u.email AS owner_email FROM churches c LEFT JOIN users u ON u.id=c.owner_id WHERE c.id=$1", [churchId]);
  if (!c || !c.stripe_customer) return;
  try { await stripe.customers.update(c.stripe_customer, { name: c.name, email: c.owner_email || undefined }); } catch (e) { console.error("stripe customer:", e.message); }
}
// Central Tracks Unlimited: yours, or your church's. The church's (or its free trial) is for the church account, the
// main admins, the pedal and Pedal Control - the people the church gave a P key - not each user (9.5).
export async function isSubscribed(user) {
  if (!user) return false;
  if (user.subscribed) return true;
  return !!(await one(`SELECT 1 FROM church_members m JOIN churches c ON c.id=m.church_id WHERE m.user_id=$1 AND (c.subscribed OR c.trial_until > now())
    AND (m.role IN ('church','owner') OR EXISTS (SELECT 1 FROM licenses l WHERE l.church_id=c.id AND l.kind='P' AND NOT l.revoked AND (l.user_id=m.user_id OR l.assigned_email=$2)))`, [user.id, String(user.email || "").toLowerCase()]));   // (a free trial includes Central Tracks Unlimited)
}

async function remember(s, kind, { user, church, track, items, code }) {
  await q("INSERT INTO checkouts (session_id,kind,user_id,church_id,track_id,items,code) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING",
    [s.id, kind, user ? user.id : null, church ? church.id : null, track ? track.id : null, items || null, code || null]);
  return { clientSecret: s.client_secret, session: s.id };
}
const line = (name, cents, n, taxCode, description) => ({ quantity: n, price_data: { currency: "usd", unit_amount: cents, tax_behavior: "inclusive", product_data: { name, description: description || undefined, tax_code: taxCode } } });

// ---------------------------------------------------------------- the store
// how many of each product a church has bought (paid orders, not refunded or disputed)
export async function ownedCounts(churchId) {
  const out = {};
  for (const o of await q("SELECT items FROM orders WHERE church_id=$1 AND status IN ('paid','review')", [churchId])) for (const [id, n] of Object.entries(o.items || {})) if (!/^(renew)$/.test(id)) out[id] = (out[id] || 0) + (Number(n) || 0);
  return out;
}
// Who it's for (9.5): "church" - a church or team: it belongs to the church, the first purchase makes your church when
// you're not in one yet (this account becomes the church account), and keys are handed out on the Teams page. "me" -
// just me: keys go to the buyer's personal row and are theirs at once (even when they're in a church: their own keys,
// not the church's); packs, their add-ons and Central Services slots are for a church or team.
export async function storeCheckout(user, items, churchName, code, only, forWho) {   // (only "check": everything but the payment)
  if (!user) throw err("Sign in or make an account first: your keys go to your church's account.", 401);
  const personal = forWho === "me";
  let church = personal ? await personalChurch(user) : await churchOf(user.id);
  if (!personal && !church && !String(churchName || "").trim()) throw err("Name your church or production first: your keys go to its account.", 400, { needChurch: true });
  if (!personal && church && !["church", "owner", "admin"].includes(church.role)) throw err("Only " + church.name + "'s church account, main admins and admins buy for it. Ask one of them, or choose \"Just me\" to buy keys of your own.", 403);
  const qty = {};
  for (const [id, q0] of Object.entries(items || {})) { const n = Math.max(0, Math.min(50, Math.floor(Number(q0) || 0))); if (PRODUCTS[id] && n) qty[id] = n; }   // (whole numbers, checked once)
  if (!Object.keys(qty).length) throw err("Your cart is empty.");
  if (personal) for (const id of Object.keys(qty)) { const p = PRODUCTS[id]; if (p.pack || p.addonFor || p.slots) throw err(p.name + " is for a church or team: choose \"A church or team\" at checkout."); }
  const owned = church ? await ownedCounts(church.id) : {};
  for (const [id, n] of Object.entries(qty)) {
    const p = PRODUCTS[id];
    if (p.hidden) throw err(p.name + " isn't for sale right now.");
    if (p.addonFor) {   // one for each of its pack: in this cart, or bought before
      const base = PRODUCTS[p.addonFor], room = (qty[p.addonFor] || 0) + (owned[p.addonFor] || 0) - (owned[id] || 0);
      if (n > room) throw err(p.name + " goes with " + (base ? base.name : "its pack") + ": one for each" + (room > 0 ? " (you can add " + room + ")" : ". Add " + (base ? base.name : "the pack") + " first") + ".");
    }
  }
  const disc = await discountFor(code, church);
  if (only === "check") return { ok: true };
  needStripe();
  if (!church) church = personal ? await personalChurch(user, true) : await createChurch(user, churchName);
  let ships = false;
  const lines = Object.entries(qty).map(([id, n]) => {
    const p = PRODUCTS[id], cut = disc && (!p.hardware || disc.pedal); if (p.ships) ships = true;
    return line(p.name + (cut ? " (" + (disc.code || disc.sale) + ")" : ""), cut ? off(p.cents, disc) : p.cents, n, p.hardware ? TAX_CODES.tangible : TAX_CODES.software, describe(p));
  });
  const s = await stripe.checkout.sessions.create({
    ...STUDIO, mode: "payment", submit_type: "auto", line_items: lines,
    customer: personal ? await customerFor(user) : await churchCustomer(church),
    shipping_address_collection: ships ? { allowed_countries: ["US", "CA"] } : undefined,
    metadata: { kind: "store", church_id: String(church.id), for: personal ? "me" : "church" },
    return_url: back("order-done-{CHECKOUT_SESSION_ID}"),
  });
  await closeOthers(church, s.id, disc && disc.code, Object.keys(qty).some((id) => PRODUCTS[id].addonFor));
  return remember(s, "store", { user, church, items: qty, code: disc && disc.code });
}
// a once-per-church code (or a pack's add-on) can't be paid for twice by keeping two checkouts open: starting a new one
// closes the church's other unpaid checkouts that have that code (or an add-on). Stripe's own expiry is a day.
async function closeOthers(church, keep, code, addon) {
  if (!code && !addon) return;
  const open = await q(`SELECT session_id, items, code FROM checkouts c WHERE church_id=$1 AND session_id<>$2 AND created_at > now() - interval '25 hours'
    AND NOT EXISTS (SELECT 1 FROM stripe_payments p WHERE p.session_id=c.session_id)`, [church.id, keep]);
  for (const o of open) {
    const hit = (code && o.code === code) || (addon && Object.keys(o.items || {}).some((id) => PRODUCTS[id] && PRODUCTS[id].addonFor));
    if (hit) await stripe.checkout.sessions.expire(o.session_id).catch(() => { });   // (already paid or expired: nothing to do)
  }
}
function describe(p) {   // the line under a product on the payment form and the receipt
  const k = p.keys || {}, parts = [];
  if (k.A) parts.push(p.pack ? "1 main admin" + (k.A > 1 ? " + " + (k.A - 1) + " admin" + (k.A > 2 ? "s" : "") : "") : k.A + " admin key" + (k.A > 1 ? "s" : ""));
  if (k.U) parts.push(k.U + " user" + (k.U > 1 ? "s" : ""));
  if (k.P && !p.hardware) parts.push(k.P === 1 ? "Central Pedal Control" : k.P + " Pedal Control keys");
  if (p.slots) parts.push(p.slots + " Central Services slot" + (p.slots > 1 ? "s" : ""));
  return parts.join(" · ");
}

// renewing keys: $20 each (a % code applies), ten more full releases each, from where its updates end now
// (personal: "Just me" keys - the person's own, billed to them; error words say "yours" instead of the church's)
export async function renewCheckout(user, church, keys, code, personal) {
  const rows = [];
  for (const k of (Array.isArray(keys) ? keys : []).slice(0, 25)) {
    const l = await one("SELECT * FROM licenses WHERE regexp_replace(upper(key),'[^A-Z0-9]','','g')=$1 AND church_id=$2", [canon(k), church.id]);
    if (!l || (personal && l.user_id !== user.id)) throw err("Key " + k + (personal ? " isn't one of yours." : " isn't one of " + church.name + "'s."), 404);
    if (l.kind === "P") throw err("Pedal and Pedal Control keys get updates forever: nothing to renew.");
    if (l.trial || l.revoked) throw err("Key " + pretty(l.key) + " can't be renewed.");
    if (!rows.some((x) => x.key === l.key)) rows.push(l);
  }
  if (!rows.length) throw err("Pick the keys to renew.");
  const disc = await percentCode(code, church);
  needStripe();
  const s = await stripe.checkout.sessions.create({
    ...STUDIO, mode: "payment", submit_type: "auto", customer: personal ? await customerFor(user) : await churchCustomer(church),
    line_items: rows.map((l) => line(RENEWAL.name + " · " + l.kind + " key …" + l.key.slice(-4), off(RENEWAL.cents, disc), 1, TAX_CODES.software, "Updates through " + fmt((l.updates_until || 0) + COVER_RELEASES))),
    metadata: { kind: "renew", church_id: String(church.id) },
    return_url: back("renewed"),
  });
  await closeOthers(church, s.id, disc && disc.code, false);
  return remember(s, "renew", { user, church, items: { keys: rows.map((l) => l.key) }, code: disc && disc.code });
}

export async function subscriptionCheckout(user) {
  needStripe();
  if (await isSubscribed(user)) throw err("You're already subscribed.");
  const church = await churchOf(user.id), forChurch = !!(church && (church.role === "church" || church.role === "owner"));   // (the church account or a main admin: for the whole church, billed to it)
  const s = await stripe.checkout.sessions.create({
    ...STUDIO, mode: "subscription", payment_method_collection: "always", submit_type: "auto",
    customer: forChurch ? await churchCustomer(church) : await customerFor(user),
    line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: SUBSCRIPTION.cents, tax_behavior: "inclusive", recurring: { interval: SUBSCRIPTION.interval },
      product_data: { name: SUBSCRIPTION.name + (forChurch ? " - " + church.name : ""), tax_code: TAX_CODES.subscription } } }],
    metadata: { kind: "subscription" },
    subscription_data: { metadata: { kind: "tracks", user_id: String(user.id), church_id: forChurch ? String(church.id) : "" } },
    return_url: back("subscribed"),
  });
  return remember(s, "subscription", { user, church: forChurch ? church : null });
}
// ---------------------------------------------------------------- sound plans (yearly)
// A % code takes that much off the first year (a Stripe coupon that applies once): once per person, or once per church
// for a bundle. Free trial codes aren't for checkout (a trial includes every plan); a code with plans: false is store-only.
async function planCode(code, who) {
  const c = String(code || "").trim().toUpperCase(); if (!c) return null;
  const d = DISCOUNTS[c];
  if (!d || d.on === false) throw err("That code isn't valid.", 404);
  if (d.trial) throw err("That's a free trial code: start the trial from the cart. It includes every sound plan while it lasts.", 400, { trialCode: c });
  if (d.plans === false) throw err(c + " isn't for sound plans.", 400);
  if (await one("SELECT 1 FROM plan_code_uses WHERE who=$1 AND code=$2", [who, c])) throw err((who[0] === "c" ? "Your church" : "You") + " already used " + c + " on a sound plan.", 409);
  return { code: c, percent: d.percent, label: d.label };
}
// what comes off a plan's first year: a typed code wins; otherwise the live sale (as in the store - they don't stack)
async function planDiscount(code, who) {
  const d = await planCode(code, who);
  if (d) return d;
  const s = await liveSale();
  return s ? { code: "", sale: s.name || "Sale", percent: s.percent, label: (s.name || "Sale") + ": " + s.percent + "% off" } : null;
}
async function planCoupon(d) {   // (made once for each code or sale and percent; Stripe keeps it)
  const tag = d.code || "SALE-" + (String(d.sale || "").toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 30) || "X");
  const id = "MA-" + tag + "-" + d.percent + "-FIRST-YEAR";
  try { await stripe.coupons.create({ id, percent_off: d.percent, duration: "once", name: (d.code || d.sale) + ": " + d.percent + "% off the first year" }); }
  catch (e) { if (!(e.code === "resource_already_exists" || /already exists/i.test(e.message || ""))) throw e; }
  return id;
}
const yearLine = (name, cents, description) => ({ quantity: 1, price_data: { currency: "usd", unit_amount: cents, tax_behavior: "inclusive", recurring: { interval: PLAN_INTERVAL },
  product_data: { name, description: description || undefined, tax_code: TAX_CODES.subscription } } });
const allNames = () => PLAN_IDS.map((id) => PLANS[id].name).join(" · ");
// a code can't be used twice by keeping two plan checkouts open: starting one closes the others with that code
async function closePlanCheckouts(who, keep, code) {
  if (!code) return;
  const open = await q(`SELECT id, session_id FROM plan_subs WHERE code=$1 AND id<>$2 AND stripe_sub IS NULL AND session_id IS NOT NULL AND created_at > now() - interval '25 hours'
    AND (CASE WHEN kind='bundle' THEN 'c' || church_id ELSE 'u' || user_id END)=$3`, [code, keep, who]);
  for (const o of open) { await stripe.checkout.sessions.expire(o.session_id).catch(() => { }); await q("UPDATE plan_subs SET status='incomplete_expired' WHERE id=$1 AND stripe_sub IS NULL", [o.id]); }
}
// your own plans: { plans: ["keys", "plugins"] } or "all" (all of them for less). Each plan includes Central Pads ($40 on
// its own). Billed to you, renews every year.
export async function planCheckout(user, want, code, only) {
  if (!user) throw err("Sign in first: a sound plan is yours, in every app you sign in to.", 401);
  const list = (Array.isArray(want) ? want : [want]).map((x) => String(x || ""));
  let ids = list.includes("all") ? PLAN_IDS.slice() : PLAN_IDS.filter((id) => list.includes(id));
  if (ids.some((id) => id !== PADS_PLAN)) ids = ids.filter((id) => id !== PADS_PLAN);   // (Central Pads comes with every other plan)
  if (!ids.length) throw err("Pick a sound plan.");
  const all = PLAN_IDS.filter((id) => id !== PADS_PLAN).every((id) => ids.includes(id));
  const held = await q(`SELECT plans, ${PLAN_END} AS ends FROM plan_subs WHERE kind='person' AND user_id=$1 AND ${PLAN_LIVE}`, [user.id]);
  const dup = ids.filter((id) => held.some((h) => withPads(h.plans).includes(id)));
  if (dup.length) throw err("You already have " + dup.map((id) => PLANS[id].name).join(" and ") + (dup.includes(PADS_PLAN) ? " (it comes with your other plan)" : "") + ". It renews by itself; manage it on your Account page.", 409);
  const disc = await planDiscount(code, "u" + user.id);
  const cents = all ? PLAN_ALL.cents : ids.reduce((a, id) => a + PLANS[id].cents, 0);
  if (only === "check") return { ok: true, plans: ids, cents, percent: disc ? disc.percent : 0, sale: (disc && disc.sale) || undefined };
  needStripe();
  const row = await one("INSERT INTO plan_subs (kind,user_id,plans,seats,cents,code) VALUES ('person',$1,$2,1,$3,$4) RETURNING id", [user.id, withPads(ids), cents, (disc && disc.code) || null]);
  const s = await stripe.checkout.sessions.create({
    ...STUDIO, mode: "subscription", payment_method_collection: "always",
    customer: await customerFor(user),
    line_items: all ? [yearLine(PLAN_ALL.name, PLAN_ALL.cents, allNames())] : ids.map((id) => yearLine(PLANS[id].name, PLANS[id].cents, PLANS[id].what)),
    discounts: disc ? [{ coupon: await planCoupon(disc) }] : undefined,
    metadata: { kind: "plans" },
    subscription_data: { metadata: { kind: "plans", plan_sub_id: String(row.id), user_id: String(user.id), plans: ids.join(",") } },
    return_url: back("plans-done"),
  });
  await q("UPDATE plan_subs SET session_id=$1 WHERE id=$2", [s.id, row.id]);
  await closePlanCheckouts("u" + user.id, row.id, disc && disc.code);
  return remember(s, "plans", { user, items: { planSub: row.id, plans: ids }, code: disc && disc.code });
}
// a church bundle: all the plans for N people, a year, billed to the church (its church account, main admins, admins)
export async function bundleCheckout(user, seats, code, only) {
  if (!user) throw err("Sign in first.", 401);
  const church = await churchOf(user.id);
  if (!church) throw err("A bundle belongs to a church: make your church's account first (Account → Your church).", 400);
  if (!["church", "owner", "admin"].includes(church.role)) throw err("Only " + church.name + "'s church account, main admins and admins buy for it.", 403);
  const n = Math.floor(Number(seats) || 0), cents = PLAN_BUNDLES[n];
  if (!cents) throw err("Bundles come for " + Object.keys(PLAN_BUNDLES).join(", ").replace(/, (\d+)$/, " or $1") + " people.");
  const disc = await planDiscount(code, "c" + church.id);
  if (only === "check") return { ok: true, seats: n, cents, percent: disc ? disc.percent : 0, sale: (disc && disc.sale) || undefined };
  needStripe();
  const row = await one("INSERT INTO plan_subs (kind,user_id,church_id,plans,seats,cents,code) VALUES ('bundle',$1,$2,$3,$4,$5,$6) RETURNING id", [user.id, church.id, PLAN_IDS, n, cents, (disc && disc.code) || null]);
  const s = await stripe.checkout.sessions.create({
    ...STUDIO, mode: "subscription", payment_method_collection: "always",
    customer: await churchCustomer(church),
    line_items: [yearLine("Sound plans for " + n + " people - " + church.name, cents, allNames() + ". Hand the seats out on the Teams page.")],
    discounts: disc ? [{ coupon: await planCoupon(disc) }] : undefined,
    metadata: { kind: "plans" },
    subscription_data: { metadata: { kind: "plans", plan_sub_id: String(row.id), church_id: String(church.id), seats: String(n) } },
    return_url: back("plans-done"),
  });
  await q("UPDATE plan_subs SET session_id=$1 WHERE id=$2", [s.id, row.id]);
  await closePlanCheckouts("c" + church.id, row.id, disc && disc.code);
  return remember(s, "plans", { user, church, items: { planSub: row.id, seats: n }, code: disc && disc.code });
}
// Stripe's subscription events for a plan: its status and the date it's paid through (on the subscription's item in
// this API version). An old "incomplete" arriving late never turns a paid plan off.
async function planSubEvent(o, type) {
  const md = o.metadata || {}, item = o.items && o.items.data && o.items.data[0];
  const end = Number(o.current_period_end || (item && item.current_period_end)) || null;
  const status = type === "customer.subscription.deleted" ? "canceled" : String(o.status || "");
  await q(`UPDATE plan_subs SET stripe_sub=$1,
      status = CASE WHEN status='canceled' THEN status WHEN $2='incomplete' AND status<>'incomplete' THEN status ELSE $2 END,
      period_end = COALESCE(to_timestamp($3::double precision), period_end), cancel_at_period_end=$4,
      past_due_since = CASE WHEN $2='past_due' THEN COALESCE(past_due_since, now()) ELSE NULL END,
      ended_at = CASE WHEN status='canceled' THEN ended_at WHEN $2 IN ('canceled','unpaid','incomplete_expired') THEN COALESCE(ended_at, now()) ELSE NULL END
    WHERE stripe_sub=$1 OR (id=$5 AND stripe_sub IS NULL)`, [o.id, status, end, !!o.cancel_at_period_end, Number(md.plan_sub_id) || 0]);
}
const invoiceKind = (o) => { const d = (o.parent && o.parent.subscription_details) || o.subscription_details || {}; return (d.metadata && d.metadata.kind) || ""; };

export async function billingPortal(user) {
  needStripe();
  const s = await stripe.billingPortal.sessions.create({ customer: await customerFor(user), return_url: back("account") });
  return s.url;
}

export async function trackCheckout(user, track) {
  needStripe();
  const s = await stripe.checkout.sessions.create({
    ...STUDIO, mode: "payment", submit_type: "auto", customer: await customerFor(user),
    line_items: [line(track.title + " (" + track.kind + ")", track.price_cents, 1, TAX_CODES.track, "Central Tracks · " + track.artist)],
    metadata: { kind: "track" },
    return_url: back("bought-" + track.id),
  });
  return remember(s, "track", { user, track });
}

// ---------------------------------------------------------------- Connect (publishers)
// an Accounts v2 recipient account with the Express dashboard: Motion Audio is the seller, publishers are paid by transfer
export async function connectLink(user) {
  needStripe();
  let acct = user.connect_account;
  if (!acct) {
    const a = await stripe.v2.core.accounts.create({
      contact_email: user.email, display_name: user.name || user.email, dashboard: "express",
      identity: { country: "us", entity_type: "individual" },
      configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } } },
      defaults: { currency: "usd", responsibilities: { fees_collector: "application", losses_collector: "application" } },
      metadata: { user_id: String(user.id) },
    });
    acct = a.id; await q("UPDATE users SET connect_account=$1 WHERE id=$2", [acct, user.id]);
  }
  const use = user.connect_ready ? "account_update" : "account_onboarding";
  const link = await stripe.v2.core.accountLinks.create({ account: acct, use_case: { type: use, [use]: { configurations: ["recipient"], refresh_url: back("payouts-refresh"), return_url: back("payouts-done") } } });
  return link.url;
}
// the source of truth for "can we send this publisher money": the v2 transfers capability
export async function transfersActive(accountId) {
  const a = await stripe.v2.core.accounts.retrieve(accountId, { include: ["configuration.recipient"] });
  const c = a.configuration && a.configuration.recipient && a.configuration.recipient.capabilities;
  return !!(c && c.stripe_balance && c.stripe_balance.stripe_transfers && c.stripe_balance.stripe_transfers.status === "active");
}
export async function refreshConnect(user) {
  if (!stripe || !user.connect_account) return !!user.connect_ready;
  const ready = await transfersActive(user.connect_account).catch(() => !!user.connect_ready);
  if (ready !== !!user.connect_ready) await q("UPDATE users SET connect_ready=$1 WHERE id=$2", [ready, user.id]);
  return ready;
}
// the payout settings and notices shown on the website (Connect embedded components)
export async function connectSession(user) {
  needStripe();
  if (!user.connect_account) throw err("Set up payouts first.");
  const s = await stripe.accountSessions.create({ account: user.connect_account, components: { notification_banner: { enabled: true }, account_management: { enabled: true }, payouts: { enabled: true } } });
  return s.client_secret;
}

// ---------------------------------------------------------------- Identity (publishers)
export async function identitySession(user) {
  needStripe();
  const v = await stripe.identity.verificationSessions.create({ type: "document", client_reference_id: String(user.id), options: { document: { require_matching_selfie: true } }, return_url: back("id-done") });
  await q("UPDATE users SET identity_session=$1, id_status='processing' WHERE id=$2 AND id_status<>'verified'", [v.id, user.id]);
  return v.url;
}

// ---------------------------------------------------------------- webhook
export async function handleWebhook(rawBody, signature) {
  needStripe();
  const ev = stripe.webhooks.constructEvent(rawBody, signature, S.webhookSecret);
  const o = ev.data.object;
  switch (ev.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      if (o.payment_status !== "unpaid") await fulfil(o);
      break;
    case "checkout.session.async_payment_failed":
      console.warn("payment failed for checkout", o.id);
      break;
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const on = ev.type !== "customer.subscription.deleted" && ["active", "trialing", "past_due"].includes(o.status), md = o.metadata || {};
      if (md.kind === "services") break;   // (Central Services' old monthly plan, before 9.3: not Central Tracks)
      if (md.kind === "plans") { await planSubEvent(o, ev.type); break; }   // (a sound plan: not Central Tracks)
      if (Number(md.church_id)) await q("UPDATE churches SET subscribed=$1, subscription_id=$2 WHERE id=$3", [on, o.id, Number(md.church_id)]);
      else await q("UPDATE users SET subscribed=$1, subscription_id=$2 WHERE stripe_customer=$3", [on, o.id, o.customer]);
      break;
    }
    case "invoice.paid":
      if (o.amount_paid > 0 && (o.subscription || (o.parent && o.parent.subscription_details))
        && !["services", "plans"].includes(invoiceKind(o))) {   // Central Tracks money: the publisher pool (not Central Services', not the sound plans')
        const u = await one("SELECT id FROM users WHERE stripe_customer=$1", [o.customer]);
        const paidBy = ((o.payments && o.payments.data) || []).find((p) => p.payment && p.payment.payment_intent);
        await q("INSERT INTO subscription_payments (invoice_id,user_id,cents,paid_at,payment_intent) VALUES ($1,$2,$3,to_timestamp($4),$5) ON CONFLICT DO NOTHING",
          [o.id, u ? u.id : null, o.amount_paid, (o.status_transitions && o.status_transitions.paid_at) || Math.floor(Date.now() / 1000), paidBy ? String(paidBy.payment.payment_intent) : (o.payment_intent ? String(o.payment_intent) : null)]);
      }
      if (o.amount_paid > 0 && invoiceKind(o) === "plans") {   // (10.1) sound plan money: the packs' income, shared with the creators each month
        const d = (o.parent && o.parent.subscription_details) || {}, subRef = d.subscription || o.subscription, sub = subRef ? (typeof subRef === "string" ? subRef : subRef.id) : null;
        const md = (d.metadata) || {};
        const ps = await one("SELECT id, plans FROM plan_subs WHERE stripe_sub=$1 OR id=$2 ORDER BY (stripe_sub=$1) DESC NULLS LAST LIMIT 1", [sub || "", Number(md.plan_sub_id) || 0]);
        await recordPlanPayment(o, ps ? ps.id : null, ps ? ps.plans : String(md.plans || "").split(",").filter(Boolean));
      }
      break;
    case "invoice.payment_failed":
      console.warn("subscription payment failed", o.id, o.customer);   // (Stripe retries and emails; subscription.updated changes access)
      break;
    case "charge.refunded":
      if (o.refunded) await reverse(o.payment_intent, "refunded");   // (full refunds; a part refund is a goodwill gesture)
      break;
    case "charge.dispute.created":
      await reverse(o.payment_intent, "disputed");
      break;
    case "radar.early_fraud_warning.created":
      await earlyFraudWarning(o);
      break;
    case "identity.verification_session.verified":
    case "identity.verification_session.requires_input":
    case "identity.verification_session.canceled": {
      const status = ev.type.endsWith("verified") ? "verified" : ev.type.endsWith("requires_input") ? "requires_input" : "none";
      await q("UPDATE users SET id_status=$1 WHERE identity_session=$2", [status, o.id]);
      break;
    }
  }
  return { received: true };
}

async function fulfil(sess) {
  const c = await one("SELECT * FROM checkouts WHERE session_id=$1", [sess.id]);
  if (!c) return console.warn("checkout not started by this server:", sess.id);
  if (c.kind === "subscription") {
    if (c.church_id) await q("UPDATE churches SET subscribed=TRUE, subscription_id=$1 WHERE id=$2", [sess.subscription, c.church_id]);
    else if (c.user_id) await q("UPDATE users SET subscribed=TRUE, subscription_id=$1 WHERE id=$2", [sess.subscription, c.user_id]);
    return;
  }
  if (c.kind === "plans") {   // sound plans: on for a year (Stripe's subscription events then keep its dates), and its package keys
    const sub = sess.subscription ? String(typeof sess.subscription === "string" ? sess.subscription : sess.subscription.id) : null;
    const r = await one(`UPDATE plan_subs SET stripe_sub=COALESCE($1, stripe_sub), status=CASE WHEN status IN ('incomplete','incomplete_expired') THEN 'active' ELSE status END,
        period_end=COALESCE(period_end, now() + interval '1 year') WHERE id=$2 AND (stripe_sub IS NULL OR stripe_sub=$1) RETURNING *`, [sub, Number(c.items && c.items.planSub) || 0]);
    if (r && r.code) await q("INSERT INTO plan_code_uses (who,code,plan_sub_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [r.kind === "bundle" ? "c" + r.church_id : "u" + r.user_id, r.code, r.id]);
    if (r) await issuePackages(r.id);   // (a person's key is emailed to them; a bundle's wait on the Teams page)
    return;
  }
  const pi = sess.payment_intent ? String(sess.payment_intent) : "free-" + sess.id;   // (a 100% code: nothing was charged)
  if (await one("SELECT 1 FROM stripe_payments WHERE payment_intent=$1", [pi])) return;   // already done (webhooks can repeat)
  let orderId = null;
  if (c.kind === "store") {
    orderId = await recordOrder(sess, c);
    const pc = c.church_id ? await one("SELECT personal FROM churches WHERE id=$1", [c.church_id]) : null;
    if (pc && pc.personal && c.user_id) await sendDownloadsEmail(c.user_id, orderId).catch((e) => console.warn("downloads email:", e.message));   // ("Just me": the keys, download links and how to install, by email)
  }
  else if (c.kind === "renew") orderId = await recordRenewal(sess, c);
  else if (c.kind === "track") await recordTrackSale(c.user_id, c.track_id);
  await q("INSERT INTO stripe_payments (payment_intent,session_id,kind,user_id,order_id,track_id) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING", [pi, sess.id, c.kind, c.user_id, orderId, c.track_id]);
  if (!sess.payment_intent) return;
  // a refund or dispute can arrive before this event: check the charge now, so the order of webhooks doesn't matter
  let ch = null;
  try { ch = (await stripe.paymentIntents.retrieve(pi, { expand: ["latest_charge"] })).latest_charge; } catch (e) { console.warn("checking the charge of", pi, e.message); }
  if (ch && ch.disputed) await reverse(pi, "disputed");
  else if (ch && ch.refunded) await reverse(pi, "refunded");
}

const shipping = (sess) => (sess.collected_information && sess.collected_information.shipping_details) || sess.shipping_details || null;
export async function recordOrder(sess, co) {   // (exported for the tests)
  const items = co.items || {}, churchId = co.church_id;
  const slots = Object.entries(items).reduce((a, [id, n]) => a + ((PRODUCTS[id] && PRODUCTS[id].slots) || 0) * (Number(n) || 0), 0);
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const r = await c.query("INSERT INTO orders (user_id,email,stripe_session,items,total_cents,shipping,church_id,discount_code,slots) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (stripe_session) DO NOTHING RETURNING id",
      [co.user_id, (sess.customer_details && sess.customer_details.email) || "", sess.id, items, sess.amount_total || 0, shipping(sess), churchId, co.code || null, slots]);
    const id = r.rows[0] && r.rows[0].id;
    if (id) {
      for (const [pid, n] of Object.entries(items)) {
        const p = PRODUCTS[pid]; if (!p) continue;
        await issueKeys(c, id, churchId, pid, p, Number(n) || 0);
        if (p.pack && churchId) await c.query("UPDATE churches SET has_pack=TRUE WHERE id=$1", [churchId]);
      }
      if (slots && churchId) await c.query("UPDATE churches SET services_slots = services_slots + $1 WHERE id=$2", [slots, churchId]);
      const pc = churchId ? (await c.query("SELECT personal FROM churches WHERE id=$1", [churchId])).rows[0] : null;
      if (pc && pc.personal && co.user_id) await c.query("UPDATE licenses l SET user_id=u.id, assigned_email=u.email, assigned_name=u.name FROM users u WHERE u.id=$1 AND l.order_id=$2", [co.user_id, id]);   // ("Just me": every key is the buyer's at once)
      if (co.code && churchId) await c.query("INSERT INTO discount_uses (church_id,code,order_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [churchId, co.code, id]);
    }
    await c.query("COMMIT");
    return id || (await one("SELECT id FROM orders WHERE stripe_session=$1", [sess.id])).id;
  } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
}
export async function recordRenewal(sess, co) {
  const keys = (co.items && co.items.keys) || [], churchId = co.church_id;
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const r = await c.query("INSERT INTO orders (user_id,email,stripe_session,items,total_cents,church_id,discount_code) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (stripe_session) DO NOTHING RETURNING id",
      [co.user_id, (sess.customer_details && sess.customer_details.email) || "", sess.id, { renew: keys.length, keys }, sess.amount_total || 0, churchId, co.code || null]);
    const id = r.rows[0] && r.rows[0].id;
    if (id) {
      await c.query("UPDATE licenses SET updates_until = COALESCE(updates_until, 0) + $1 WHERE key = ANY($2) AND church_id=$3 AND kind<>'P'", [COVER_RELEASES, keys, churchId]);   // (one version past where it ended)
      if (co.code && churchId) await c.query("INSERT INTO discount_uses (church_id,code,order_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [churchId, co.code, id]);
    }
    await c.query("COMMIT");
    return id || (await one("SELECT id FROM orders WHERE stripe_session=$1", [sess.id])).id;
  } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
}

export async function recordTrackSale(uid, trackId) {
  const t = await one("SELECT * FROM tracks WHERE id=$1", [trackId]); if (!t || !uid) return;
  await q("INSERT INTO library (user_id,track_id,how) VALUES ($1,$2,'purchase') ON CONFLICT (user_id,track_id) DO UPDATE SET how='purchase'", [uid, trackId]);
  if (t.publisher_id !== uid) await q("INSERT INTO earnings (publisher_id,track_id,buyer_id,reason,cents) VALUES ($1,$2,$3,'purchase',$4) ON CONFLICT DO NOTHING", [t.publisher_id, trackId, uid, Math.round(t.price_cents * PUBLISHER_SHARE)]);
}

// A refund or dispute: take back what the payment gave. Found through the PaymentIntent (our stripe_payments row for
// one-time payments; Stripe's invoice payments for the subscription).
export async function reverse(paymentIntent, why) {
  if (!paymentIntent) return;
  const pi = String(paymentIntent), p = await one("SELECT * FROM stripe_payments WHERE payment_intent=$1", [pi]);
  if (p) {
    const done = p.status === "refunded" || p.status === "disputed";
    if (p.status === why) return;
    await q("UPDATE stripe_payments SET status=$1 WHERE payment_intent=$2", [why, pi]);
    if (done) return;   // (already taken back: a refund then a dispute takes nothing twice)
    if (p.kind === "track") {
      await q("DELETE FROM library WHERE user_id=$1 AND track_id=$2 AND how='purchase'", [p.user_id, p.track_id]);
      const e = await one("SELECT * FROM earnings WHERE track_id=$1 AND buyer_id=$2 AND reason='purchase'", [p.track_id, p.user_id]);
      if (e && !e.transfer_id) await q("DELETE FROM earnings WHERE id=$1", [e.id]);   // not paid out yet: just drop it
      else if (e) await q("INSERT INTO earnings (publisher_id,track_id,buyer_id,reason,cents) VALUES ($1,$2,$3,'reversal',$4) ON CONFLICT DO NOTHING", [e.publisher_id, e.track_id, e.buyer_id, -e.cents]);   // already paid: off the next payout
    } else if (p.kind === "store" && p.order_id) {
      const o = await one("UPDATE orders SET status=$1 WHERE id=$2 AND status IN ('paid','review') RETURNING church_id, slots", [why, p.order_id]);
      await q("UPDATE licenses SET revoked=TRUE WHERE order_id=$1", [p.order_id]);
      await q("DELETE FROM license_devices WHERE key IN (SELECT key FROM licenses WHERE order_id=$1)", [p.order_id]);
      if (o && o.slots && o.church_id) await q("UPDATE churches SET services_slots = GREATEST(0, services_slots - $1) WHERE id=$2", [o.slots, o.church_id]);
    } else if (p.kind === "renew" && p.order_id) {
      const o = await one("UPDATE orders SET status=$1 WHERE id=$2 AND status IN ('paid','review') RETURNING church_id, items", [why, p.order_id]);
      if (o) await q("UPDATE licenses SET updates_until = GREATEST(0, COALESCE(updates_until, 0) - $1) WHERE key = ANY($2) AND church_id=$3 AND kind<>'P'", [COVER_RELEASES, (o.items && o.items.keys) || [], o.church_id]);
    }
    return;
  }
  // a subscription payment: out of the pool income; on a dispute, the subscription ends too
  const ip = (await stripe.invoicePayments.list({ payment: { type: "payment_intent", payment_intent: pi }, limit: 1 })).data[0];
  if (!ip) return console.warn("refund or dispute for a payment this server doesn't know:", pi);
  const invoiceId = typeof ip.invoice === "string" ? ip.invoice : ip.invoice.id;
  const inv = await stripe.invoices.retrieve(invoiceId);
  const subRef = inv.parent && inv.parent.subscription_details && inv.parent.subscription_details.subscription, sub = subRef ? (typeof subRef === "string" ? subRef : subRef.id) : null;
  const plan = sub ? await one("SELECT id FROM plan_subs WHERE stripe_sub=$1", [sub]) : null;
  if (plan) {   // a sound plan paid back (refund or dispute): it ends now, and stops counting in the creators' pool
    await reversePlanPayment(invoiceId);
    await q("UPDATE plan_subs SET status='canceled', ended_at=COALESCE(ended_at, now()) WHERE id=$1", [plan.id]);
    await stripe.subscriptions.cancel(sub).catch((e) => console.warn("cancel:", e.message));
    return;
  }
  await q("UPDATE subscription_payments SET reversed=TRUE WHERE invoice_id=$1", [invoiceId]);
  if (why === "disputed" && sub) await stripe.subscriptions.cancel(sub).catch((e) => console.warn("cancel:", e.message));
}

// Radar early fraud warning: refund digital purchases right away (cheaper than a dispute); hold a built pedal for review.
async function earlyFraudWarning(efw) {
  if (!efw.actionable) return;
  const pi = String(efw.payment_intent || ""), p = pi ? await one("SELECT * FROM stripe_payments WHERE payment_intent=$1", [pi]) : null;
  if (p && (p.status === "refunded" || p.status === "disputed")) return;   // (already taken back)
  if (p && p.kind === "store" && p.order_id) {
    const o = await one("SELECT items FROM orders WHERE id=$1", [p.order_id]);
    if (o && Object.keys(o.items || {}).some((id) => PRODUCTS[id] && PRODUCTS[id].ships)) {
      await q("UPDATE orders SET status='review' WHERE id=$1", [p.order_id]);
      await q("UPDATE stripe_payments SET status='review' WHERE payment_intent=$1", [pi]);
      return console.warn("FRAUD WARNING: order", p.order_id, "is held - don't ship it; review it in Stripe → Radar");
    }
  }
  try { await stripe.refunds.create({ charge: typeof efw.charge === "string" ? efw.charge : efw.charge.id, reason: "fraudulent" }); }
  catch (e) { if (e.code !== "charge_already_refunded") throw e; }
  // (charge.refunded follows and takes the access back)
}
