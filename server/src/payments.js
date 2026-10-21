// Stripe for Motion Audio (see ../STRIPE-PLAN.md):
//  - Payments + Billing: Checkout Sessions for the store, single tracks and the $77/month subscription. Products and
//    prices live in Stripe (synced at startup by lookup key), so receipts and the Dashboard show real product names.
//  - Connect: publishers are Accounts v2 "recipient" accounts (Express dashboard). Motion Audio is the merchant of
//    record; publishers are paid by monthly transfers (separate charges and transfers), see payouts.js.
//  - Identity: publishers verify their ID before their first upload.
//  - Radar: runs on every Checkout payment. Refunds, disputes and early fraud warnings remove access and claw back
//    the publisher's share.
//  - Tax: off (automatic_tax false, as set in Checkout Studio). Products already carry tax codes for when it's turned on.
// Checkout uses the embedded form (ui_mode "form", settings from Checkout Studio): the browser gets a client_secret and
// shows the payment form on our own page. Fulfillment happens only in the webhook (/stripe/webhook).
import Stripe from "stripe";
import crypto from "node:crypto";
import { config, PUBLISHER_SHARE, TAX_CODES, LICENSE_KINDS, APP_MAJOR } from "./config.js";
import { q, one, pool } from "./db.js";

const S = config.stripe;
export const stripe = S.secret ? new Stripe(S.secret, { apiVersion: S.apiVersion, appInfo: { name: "Motion Audio", url: "https://motionaudio.org" } }) : null;
export function needStripe() { if (!stripe) { const e = new Error("Payments aren't set up yet (STRIPE_SECRET_KEY is missing)."); e.status = 503; throw e; } }

// Checkout Studio settings (fixed_by_ui) shared by every Checkout Session
const STUDIO = {
  ui_mode: "form",
  billing_address_collection: "auto",
  phone_number_collection: { enabled: false },
  automatic_tax: { enabled: false },
  integration_identifier: "custom_embedded_web_0001",
};

// ---------------------------------------------------------------- catalog (read from your Stripe Dashboard)
let catalogCache = { at: 0, products: [], subscription: null };
function parseKeys(spec) {
  const out = {};
  String(spec || "").split(/[,;]/).forEach((part) => { const m = part.trim().match(/^([a-z][a-z-]*)\s*[:=x*]?\s*(\d+)$/i); if (m) out[m[1].toLowerCase()] = (out[m[1].toLowerCase()] || 0) + Number(m[2]); });
  return out;
}
export async function catalog(force) {
  needStripe();
  if (!force && Date.now() - catalogCache.at < 60e3) return catalogCache;
  const products = [];
  for await (const p of stripe.products.list({ active: true, limit: 100, expand: ["data.default_price"] })) {
    const price = p.default_price;
    if (!price || typeof price === "string" || !price.active || price.type !== "one_time" || price.currency !== "usd" || price.unit_amount == null) continue;
    if (String(p.metadata.hidden) === "true") continue;
    const ships = String(p.metadata.ships) === "true" || p.tax_code === TAX_CODES.tangible || (p.tax_code && p.tax_code.id === TAX_CODES.tangible);
    const keys = "ma_id" in p.metadata || p.metadata.keys ? parseKeys(p.metadata.keys) : ships ? {} : { license: 1 };
    products.push({ priceId: price.id, productId: p.id, maId: p.metadata.ma_id || p.id, name: p.name, description: p.description || "", features: (p.marketing_features || []).map((f) => f.name).filter(Boolean),
      image: (p.images || [])[0] || null, cents: price.unit_amount, ships, keys, services: Number(p.metadata.services) || 0, addonFor: p.metadata.addon_for || null,
      codes: String(p.metadata.no_codes) !== "true", order: Number(p.metadata.order) || 999 });
  }
  products.forEach((x) => { if (x.addonFor) { const base = products.find((b) => b.maId === x.addonFor); x.addonFor = base ? base.priceId : null; } });
  products.sort((a, b) => a.order - b.order || a.cents - b.cents);
  let sub = (await stripe.prices.list({ lookup_keys: ["ma_subscription"], active: true, limit: 1 })).data[0];
  if (!sub) { const monthly = (await stripe.prices.list({ active: true, type: "recurring", limit: 10, expand: ["data.product"] })).data.filter((x) => x.recurring.interval === "month" && x.product.active); if (monthly.length === 1) sub = monthly[0]; }
  catalogCache = { at: Date.now(), products, subscription: sub ? { priceId: sub.id, cents: sub.unit_amount, productId: typeof sub.product === "string" ? sub.product : sub.product.id } : null };
  return catalogCache;
}

// ---------------------------------------------------------------- customers + tax
async function customerFor(user) {
  if (user.stripe_customer) return user.stripe_customer;
  const c = await stripe.customers.create({ email: user.email, name: user.name || undefined, metadata: { user_id: String(user.id) } });
  await q("UPDATE users SET stripe_customer=$1 WHERE id=$2", [c.id, user.id]);
  return c.id;
}
// ---------------------------------------------------------------- discount codes, trials, sales
export const TRIAL_CODE = "7FREE";
async function findPromo(code) {
  const c = String(code || "").trim(); if (!c) return null;
  const pc = (await stripe.promotionCodes.list({ code: c, active: true, limit: 1 })).data[0];
  if (!pc) { const e = new Error("That code isn't valid (or has ended)."); e.status = 400; throw e; }
  return pc;
}
// what goes on a Checkout Session: a typed code wins; otherwise the sale that's live on the website (if any)
async function discountsFor(code, { subscription } = {}) {
  const c = String(code || "").trim().toUpperCase();
  if (c === TRIAL_CODE) { if (!subscription) { const e = new Error(TRIAL_CODE + " is a free trial of Central Tracks Unlimited. Use it when you subscribe."); e.status = 400; throw e; } return { trial: true }; }
  if (c) return { discounts: [{ promotion_code: (await findPromo(c)).id }] };
  const sale = await liveSale();
  return sale && sale.couponId ? { discounts: [{ coupon: sale.couponId }] } : {};
}
export async function liveSale() {
  const r = await one("SELECT live FROM site_settings WHERE key='sale'");
  const s = r && r.live;
  if (!s || !s.active || !s.couponId) return null;
  if (s.endsAt && Date.parse(s.endsAt) < Date.now()) return null;
  return s;
}

async function remember(sessionId, kind, userId, trackId, items) {
  await q("INSERT INTO checkouts (session_id,kind,user_id,track_id,items) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING", [sessionId, kind, userId, trackId, items ? JSON.stringify(items) : null]);
}

// ---------------------------------------------------------------- checkout
export async function storeCheckout(user, items, code) {
  needStripe();
  if (!user) { const e = new Error("Sign in or make an account first. Your keys and Central Services accounts belong to your church's account."); e.status = 401; throw e; }
  const { products } = await catalog();
  const lines = [], clean = {};
  let ships = false;
  for (const [priceId, qty] of Object.entries(items || {})) {
    const p = products.find((x) => x.priceId === priceId), n = Math.max(0, Math.min(50, Math.floor(Number(qty) || 0)));
    if (!p || !n) continue;
    lines.push({ price: p.priceId, quantity: n });
    clean[p.priceId] = { qty: n, name: p.name, keys: p.keys, ships: p.ships, services: p.services }; if (p.ships) ships = true;
  }
  for (const [priceId, it] of Object.entries(clean)) {   // an add-on only goes with its pack (one per pack)
    const p = products.find((x) => x.priceId === priceId);
    if (p.addonFor && it.qty > ((clean[p.addonFor] || {}).qty || 0)) { const base = products.find((x) => x.priceId === p.addonFor); const e = new Error(p.name + " goes with " + (base ? base.name : "its pack") + ": add one of those for each."); e.status = 400; throw e; }
  }
  const disc = await discountsFor(code);
  if (!lines.length) { const e = new Error("Your cart is empty, or those items are no longer for sale. Refresh the page."); e.status = 400; throw e; }
  const customer = user ? await customerFor(user) : undefined;
  const s = await stripe.checkout.sessions.create({
    ...STUDIO, mode: "payment", submit_type: "auto", line_items: lines, discounts: disc.discounts,
    customer, customer_creation: customer ? undefined : "always",
    shipping_address_collection: ships ? { allowed_countries: ["US", "CA"] } : undefined,
    return_url: config.publicUrl + "/#order-done-{CHECKOUT_SESSION_ID}",
  });
  await remember(s.id, "store", user ? user.id : null, null, clean);
  return s.client_secret;
}

async function subscriptionPrice() {
  const c = await catalog();
  if (!c.subscription) { const e = new Error("The Central Tracks subscription isn't set up in Stripe yet."); e.status = 503; throw e; }
  return c.subscription.priceId;
}
export async function subscriptionCheckout(user, code) {
  needStripe();
  const disc = await discountsFor(code, { subscription: true });
  if (disc.trial && (user.had_trial || user.subscription_id)) { const e = new Error("The free trial is for first-time subscribers."); e.status = 400; throw e; }
  if (user.subscribed) { const e = new Error("You're already subscribed."); e.status = 400; throw e; }
  const customer = await customerFor(user);
  const s = await stripe.checkout.sessions.create({
    ...STUDIO, mode: "subscription", payment_method_collection: "always", submit_type: "auto", customer, discounts: disc.discounts,
    subscription_data: disc.trial ? { trial_period_days: 7, metadata: { trial_code: TRIAL_CODE } } : undefined,
    line_items: [{ price: await subscriptionPrice(), quantity: 1 }],
    return_url: config.publicUrl + "/#subscribed",
  });
  await remember(s.id, "subscription", user.id, null, disc.trial ? { trial: true } : null);
  return s.client_secret;
}
export async function billingPortal(user) {
  needStripe();
  const s = await stripe.billingPortal.sessions.create({ customer: await customerFor(user), return_url: config.publicUrl + "/#account" });
  return s.url;
}

export async function trackCheckout(user, track) {
  needStripe();
  const customer = await customerFor(user);
  const s = await stripe.checkout.sessions.create({
    ...STUDIO, mode: "payment", submit_type: "auto", customer,
    line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: track.price_cents, tax_behavior: "exclusive",
      product_data: { name: track.title + " (" + track.kind + ")", description: "Central Tracks · " + track.artist, tax_code: TAX_CODES.track } } }],
    return_url: config.publicUrl + "/#bought-" + track.id,
  });
  await remember(s.id, "track", user.id, track.id, null);
  return s.client_secret;
}

// ---------------------------------------------------------------- Connect (publishers)
// Accounts v2 recipient account, Express dashboard, Motion Audio collects fees and owns losses (marketplace).
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
  const link = await stripe.v2.core.accountLinks.create({ account: acct, use_case: { type: user.connect_ready ? "account_update" : "account_onboarding",
    [user.connect_ready ? "account_update" : "account_onboarding"]: { refresh_url: config.publicUrl + "/#payouts-refresh", return_url: config.publicUrl + "/#payouts-done" } } });
  return link.url;
}
// the source of truth for "can we send this publisher money": the v2 transfers capability
export async function transfersActive(accountId) {
  const a = await stripe.v2.core.accounts.retrieve(accountId, { include: ["configuration.recipient"] });
  const c = a.configuration && a.configuration.recipient && a.configuration.recipient.capabilities;
  return !!(c && c.stripe_balance && c.stripe_balance.stripe_transfers && c.stripe_balance.stripe_transfers.status === "active");
}
export async function refreshConnect(user) {
  if (!stripe || !user.connect_account) return user.connect_ready;
  const ready = await transfersActive(user.connect_account).catch(() => user.connect_ready);
  if (ready !== user.connect_ready) await q("UPDATE users SET connect_ready=$1 WHERE id=$2", [ready, user.id]);
  return ready;
}
// for the embedded notification banner + payout settings on the account page
export async function connectSession(user) {
  needStripe();
  if (!user.connect_account) { const e = new Error("Set up payouts first."); e.status = 400; throw e; }
  const s = await stripe.accountSessions.create({ account: user.connect_account, components: {
    notification_banner: { enabled: true }, account_management: { enabled: true }, payouts: { enabled: true } } });
  return s.client_secret;
}

// ---------------------------------------------------------------- Identity (publishers)
export async function identitySession(user) {
  needStripe();
  const v = await stripe.identity.verificationSessions.create({
    type: "document", client_reference_id: String(user.id),
    options: { document: { require_matching_selfie: true } },
    return_url: config.publicUrl + "/#id-done",
  });
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
      if (o.payment_status !== "unpaid") await fulfill(o);
      break;
    case "checkout.session.async_payment_failed":
      console.warn("payment failed for checkout", o.id);
      break;
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const on = ev.type !== "customer.subscription.deleted" && ["active", "trialing", "past_due"].includes(o.status);
      await q("UPDATE users SET subscribed=$1, subscription_id=$2 WHERE stripe_customer=$3", [on, o.id, o.customer]);
      break;
    }
    case "invoice.paid":
      if (o.amount_paid > 0 && o.parent && o.parent.type === "subscription_details") {
        const u = await one("SELECT id FROM users WHERE stripe_customer=$1", [o.customer]);
        const pay = (o.payments && o.payments.data || []).find((p) => p.payment && p.payment.payment_intent);
        await q("INSERT INTO subscription_payments (invoice_id,user_id,cents,paid_at,payment_intent) VALUES ($1,$2,$3,to_timestamp($4),$5) ON CONFLICT DO NOTHING",
          [o.id, u ? u.id : null, o.amount_paid, (o.status_transitions && o.status_transitions.paid_at) || Math.floor(Date.now() / 1000), pay ? String(pay.payment.payment_intent) : null]);
      }
      break;
    case "invoice.payment_failed":
      console.warn("subscription payment failed", o.id, o.customer);  // Stripe retries and emails; subscription.updated changes access
      break;
    case "charge.refunded":
      if (o.refunded) await reverse(o.payment_intent, "refunded");  // full refunds only
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

async function fulfill(sess) {
  const c = await one("SELECT * FROM checkouts WHERE session_id=$1", [sess.id]);
  if (!c) return console.warn("checkout not started by this server:", sess.id);
  if (c.kind === "subscription") {
    if (c.user_id) await q("UPDATE users SET subscribed=TRUE, subscription_id=$1, had_trial = had_trial OR $3 WHERE id=$2", [sess.subscription, c.user_id, !!(c.items && c.items.trial)]);
    return;
  }
  const pi = String(sess.payment_intent);
  if (await one("SELECT 1 FROM stripe_payments WHERE payment_intent=$1", [pi])) return;  // already fulfilled (webhooks can repeat)
  if (c.kind === "track") {
    await recordTrackSale(c.user_id, c.track_id);
    await q("INSERT INTO stripe_payments (payment_intent,session_id,kind,user_id,track_id) VALUES ($1,$2,'track',$3,$4) ON CONFLICT DO NOTHING", [pi, sess.id, c.user_id, c.track_id]);
  } else if (c.kind === "store") {
    const orderId = await recordOrder(sess, c.user_id, c.items || {});
    await q("INSERT INTO stripe_payments (payment_intent,session_id,kind,user_id,order_id) VALUES ($1,$2,'store',$3,$4) ON CONFLICT DO NOTHING", [pi, sess.id, c.user_id, orderId]);
  }
  // a refund or dispute can arrive before this event: check the charge now so the order of webhooks doesn't matter
  const ch = (await stripe.paymentIntents.retrieve(pi, { expand: ["latest_charge"] })).latest_charge;
  if (ch && ch.disputed) await reverse(pi, "disputed");
  else if (ch && ch.refunded) await reverse(pi, "refunded");
}

function licenseKey(kind) {
  const p = kind.split("-").map((w) => w[0]).join("").toUpperCase().padEnd(2, "K").slice(0, 2);
  return p + "-" + crypto.randomBytes(8).toString("hex").toUpperCase().match(/.{4}/g).join("-");
}
async function recordOrder(sess, uid, items) {
  const cl = await pool.connect();
  try {
    await cl.query("BEGIN");
    const ship = (sess.collected_information && sess.collected_information.shipping_details) || sess.shipping_details || null;
    const r = await cl.query("INSERT INTO orders (user_id,email,stripe_session,items,total_cents,shipping) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (stripe_session) DO UPDATE SET status=orders.status RETURNING id, (xmax = 0) AS fresh",
      [uid, (sess.customer_details && sess.customer_details.email) || "", sess.id, items, sess.amount_total || 0, ship]);
    const { id, fresh } = r.rows[0];
    const services = Object.values(items).reduce((a, it) => a + (Number(it.services) || 0) * (Number(it.qty) || 0), 0);
    if (fresh && services && uid) await cl.query("UPDATE users SET services_accounts = services_accounts + $1 WHERE id=$2", [services, uid]);
    if (fresh) for (const item of Object.values(items)) for (const [kind, per] of Object.entries(item.keys || {})) {
      const k = LICENSE_KINDS[kind] || { name: kind, app: null }, major = k.app ? APP_MAJOR[k.app] || null : null;
      for (let i = 0; i < per * item.qty; i++) await cl.query("INSERT INTO licenses (key,order_id,product,kind,app,major) VALUES ($1,$2,$3,$4,$5,$6)", [licenseKey(kind), id, item.name, kind, k.app, major]);
    }
    await cl.query("COMMIT");
    return id;
  } catch (e) { await cl.query("ROLLBACK"); throw e; } finally { cl.release(); }
}

export async function recordTrackSale(uid, trackId) {
  const t = await one("SELECT * FROM tracks WHERE id=$1", [trackId]); if (!t || !uid) return;
  await q("INSERT INTO library (user_id,track_id,how) VALUES ($1,$2,'purchase') ON CONFLICT (user_id,track_id) DO UPDATE SET how='purchase'", [uid, trackId]);
  if (t.publisher_id !== uid) await q("INSERT INTO earnings (publisher_id,track_id,buyer_id,reason,cents) VALUES ($1,$2,$3,'purchase',$4) ON CONFLICT DO NOTHING", [t.publisher_id, trackId, uid, Math.round(t.price_cents * PUBLISHER_SHARE)]);
}

// A refund or dispute: take back what the payment gave. Found through the PaymentIntent (our stripe_payments row for
// one-time payments; Stripe's invoice payments for the subscription).
async function reverse(paymentIntent, why) {
  if (!paymentIntent) return;
  const pi = String(paymentIntent), p = await one("SELECT * FROM stripe_payments WHERE payment_intent=$1", [pi]);
  if (p) {
    if (p.status === why) return;
    await q("UPDATE stripe_payments SET status=$1 WHERE payment_intent=$2", [why, pi]);
    if (p.kind === "track") {
      await q("DELETE FROM library WHERE user_id=$1 AND track_id=$2 AND how='purchase'", [p.user_id, p.track_id]);
      const e = await one("SELECT * FROM earnings WHERE track_id=$1 AND buyer_id=$2 AND reason='purchase'", [p.track_id, p.user_id]);
      if (e && !e.transfer_id) await q("DELETE FROM earnings WHERE id=$1", [e.id]);  // not paid out yet: just drop it
      else if (e) await q("INSERT INTO earnings (publisher_id,track_id,buyer_id,reason,cents) VALUES ($1,$2,$3,'reversal',$4) ON CONFLICT DO NOTHING", [e.publisher_id, e.track_id, e.buyer_id, -e.cents]);  // already paid: comes off the next payout
    } else if (p.kind === "store" && p.order_id) {
      await q("UPDATE orders SET status=$1 WHERE id=$2", [why, p.order_id]);
      await q("UPDATE licenses SET revoked=TRUE WHERE order_id=$1", [p.order_id]);
      const o = await one("SELECT items, user_id FROM orders WHERE id=$1", [p.order_id]);
      const services = Object.values((o && o.items) || {}).reduce((a, it) => a + (Number(it.services) || 0) * (Number(it.qty) || 0), 0);
      if (services && o.user_id) await q("UPDATE users SET services_accounts = GREATEST(0, services_accounts - $1) WHERE id=$2", [services, o.user_id]);
    }
    return;
  }
  // subscription renewal: drop it from the pool income; on a dispute, also end the subscription
  const ip = (await stripe.invoicePayments.list({ payment: { type: "payment_intent", payment_intent: pi }, limit: 1 })).data[0];
  if (!ip) return console.warn("refund/dispute for an unknown payment", pi);
  const invoiceId = typeof ip.invoice === "string" ? ip.invoice : ip.invoice.id;
  await q("UPDATE subscription_payments SET reversed=TRUE WHERE invoice_id=$1", [invoiceId]);
  if (why === "disputed") {
    const inv = await stripe.invoices.retrieve(invoiceId);
    const sub = inv.parent && inv.parent.subscription_details && inv.parent.subscription_details.subscription;
    if (sub) await stripe.subscriptions.cancel(typeof sub === "string" ? sub : sub.id).catch((e) => console.warn("cancel:", e.message));
  }
}

// Radar early fraud warning: refund digital purchases right away (cheaper than a dispute); hold a built pedal for review.
async function earlyFraudWarning(efw) {
  if (!efw.actionable) return;
  const pi = String(efw.payment_intent || ""), p = pi ? await one("SELECT * FROM stripe_payments WHERE payment_intent=$1", [pi]) : null;
  if (p && p.kind === "store" && p.order_id) {
    const o = await one("SELECT items FROM orders WHERE id=$1", [p.order_id]);
    if (o && o.items && Object.values(o.items).some((it) => it && it.ships)) {
      await q("UPDATE orders SET status='review' WHERE id=$1", [p.order_id]);
      await q("UPDATE stripe_payments SET status='review' WHERE payment_intent=$1", [pi]);
      return console.warn("FRAUD WARNING: hold order", p.order_id, "- don't ship; review it in Stripe → Radar");
    }
  }
  try { await stripe.refunds.create({ charge: typeof efw.charge === "string" ? efw.charge : efw.charge.id, reason: "fraudulent" }); }
  catch (e) { if (e.code !== "charge_already_refunded") throw e; }
  // charge.refunded follows and removes access
}

// ---------------------------------------------------------------- admin: discount codes and sales
async function codeableProducts(includePedal) {
  const c = await catalog(true), ids = c.products.filter((p) => includePedal || p.codes).map((p) => p.productId);
  if (c.subscription) ids.push(c.subscription.productId);
  return [...new Set(ids)];
}
export async function listCodes() {
  needStripe();
  const out = [];
  for await (const pc of stripe.promotionCodes.list({ limit: 100, expand: ["data.promotion.coupon"] })) {
    const cp = pc.promotion && pc.promotion.coupon;
    out.push({ id: pc.id, code: pc.code, active: pc.active, used: pc.times_redeemed, max: pc.max_redemptions, expires: pc.expires_at,
      percent: cp && cp.percent_off, duration: cp && cp.duration, months: cp && cp.duration_in_months, name: cp && cp.name });
  }
  out.push({ id: "trial", code: TRIAL_CODE, active: true, builtIn: true, name: "7-day free trial of Central Tracks Unlimited (first-time subscribers)" });
  return out;
}
export async function createCode({ code, percent, duration, months, expires, max, includePedal, name }) {
  needStripe();
  const c = String(code || "").trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,30}$/.test(c)) { const e = new Error("Codes are 3-30 letters or numbers (dashes and underscores are OK)."); e.status = 400; throw e; }
  if (c === TRIAL_CODE) { const e = new Error(TRIAL_CODE + " is the built-in free trial."); e.status = 400; throw e; }
  const pct = Number(percent); if (!(pct > 0 && pct <= 100)) { const e = new Error("Percent off must be between 1 and 100."); e.status = 400; throw e; }
  const dur = ["once", "repeating", "forever"].includes(duration) ? duration : "once";
  const coupon = await stripe.coupons.create({ name: name || c + ": " + pct + "% off", percent_off: pct, duration: dur, duration_in_months: dur === "repeating" ? Math.max(1, Number(months) || 1) : undefined,
    applies_to: { products: await codeableProducts(!!includePedal) } });
  const pc = await stripe.promotionCodes.create({ code: c, promotion: { type: "coupon", coupon: coupon.id },
    expires_at: expires ? Math.floor(Date.parse(expires) / 1000) : undefined, max_redemptions: Number(max) || undefined });
  return { id: pc.id, code: pc.code };
}
export async function setCodeActive(id, active) { needStripe(); await stripe.promotionCodes.update(id, { active: !!active }); }
// a sale's coupon is made when the sale is published (Stripe coupons can't change afterwards)
export async function saleCoupon(sale) {
  needStripe();
  const coupon = await stripe.coupons.create({ name: (sale.name || "Sale") + ": " + sale.percent + "% off", percent_off: Number(sale.percent), duration: "once",
    applies_to: { products: await codeableProducts(!!sale.includePedal) }, redeem_by: sale.endsAt ? Math.floor(Date.parse(sale.endsAt) / 1000) : undefined });
  return coupon.id;
}
