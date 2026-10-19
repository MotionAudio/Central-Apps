// Stripe: store checkout, the Central Tracks subscription, single track sales, and Connect accounts for publishers.
// Checkout pages are hosted by Stripe; the webhook (/stripe/webhook) is what actually records a payment.
import Stripe from "stripe";
import crypto from "node:crypto";
import { config, PRODUCTS, SUBSCRIPTION, PUBLISHER_SHARE } from "./config.js";
import { q, one, pool } from "./db.js";

export const stripe = config.stripe.secret ? new Stripe(config.stripe.secret) : null;
export function needStripe() { if (!stripe) { const e = new Error("Payments aren't set up yet (STRIPE_SECRET_KEY is missing)."); e.status = 503; throw e; } }

async function customerFor(user) {
  if (user.stripe_customer) return user.stripe_customer;
  const c = await stripe.customers.create({ email: user.email, name: user.name || undefined, metadata: { user_id: String(user.id) } });
  await q("UPDATE users SET stripe_customer=$1 WHERE id=$2", [c.id, user.id]);
  return c.id;
}

export async function storeCheckout(user, items) {
  needStripe();
  const lines = [], meta = {};
  let ships = false;
  for (const [id, qty] of Object.entries(items || {})) {
    const p = PRODUCTS[id], n = Math.max(0, Math.min(50, Math.floor(Number(qty) || 0)));
    if (!p || !n) continue;
    lines.push({ quantity: n, price_data: { currency: "usd", unit_amount: p.cents, product_data: { name: p.name } } });
    meta[id] = String(n); if (p.ships) ships = true;
  }
  if (!lines.length) { const e = new Error("Your cart is empty."); e.status = 400; throw e; }
  const s = await stripe.checkout.sessions.create({
    mode: "payment", line_items: lines,
    customer: user ? await customerFor(user) : undefined,
    customer_creation: user ? undefined : "always",
    shipping_address_collection: ships ? { allowed_countries: ["US", "CA"] } : undefined,
    metadata: { kind: "store", user_id: user ? String(user.id) : "", items: JSON.stringify(meta) },
    success_url: config.publicUrl + "/#order-done-{CHECKOUT_SESSION_ID}",
    cancel_url: config.publicUrl + "/#store",
  });
  return s.url;
}

export async function subscriptionCheckout(user) {
  needStripe();
  if (user.subscribed) { const e = new Error("You're already subscribed."); e.status = 400; throw e; }
  const s = await stripe.checkout.sessions.create({
    mode: "subscription", customer: await customerFor(user),
    line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: SUBSCRIPTION.cents, recurring: { interval: SUBSCRIPTION.interval }, product_data: { name: SUBSCRIPTION.name } } }],
    metadata: { kind: "subscription", user_id: String(user.id) },
    subscription_data: { metadata: { user_id: String(user.id) } },
    success_url: config.publicUrl + "/#subscribed", cancel_url: config.publicUrl + "/#tracks",
  });
  return s.url;
}
export async function billingPortal(user) {
  needStripe();
  const s = await stripe.billingPortal.sessions.create({ customer: await customerFor(user), return_url: config.publicUrl + "/#account" });
  return s.url;
}

export async function trackCheckout(user, track) {
  needStripe();
  const s = await stripe.checkout.sessions.create({
    mode: "payment", customer: await customerFor(user),
    line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: track.price_cents, product_data: { name: track.title + " (" + track.kind + ")", description: "Central Tracks · " + track.artist } } }],
    metadata: { kind: "track", user_id: String(user.id), track_id: String(track.id) },
    success_url: config.publicUrl + "/#bought-" + track.id, cancel_url: config.publicUrl + "/#tracks",
  });
  return s.url;
}

// publishers get paid through a Stripe Connect Express account (Stripe collects their bank and tax details)
export async function connectLink(user) {
  needStripe();
  let acct = user.connect_account;
  if (!acct) {
    const a = await stripe.accounts.create({ type: "express", email: user.email, capabilities: { transfers: { requested: true } }, metadata: { user_id: String(user.id) } });
    acct = a.id; await q("UPDATE users SET connect_account=$1 WHERE id=$2", [acct, user.id]);
  }
  const link = await stripe.accountLinks.create({ account: acct, type: "account_onboarding", refresh_url: config.publicUrl + "/#publish", return_url: config.publicUrl + "/#publish" });
  return link.url;
}

function licenseKey(product) {
  const p = { "pedal-sw": "CP", control: "CC", usage: "CU", "pedal-hw": "CP" }[product] || "MA";
  return p + "-" + crypto.randomBytes(8).toString("hex").toUpperCase().match(/.{4}/g).join("-");
}

// ---------------------------------------------------------------- webhook
export async function handleWebhook(rawBody, signature) {
  needStripe();
  const ev = stripe.webhooks.constructEvent(rawBody, signature, config.stripe.webhookSecret);
  const o = ev.data.object;
  if (ev.type === "checkout.session.completed" && o.payment_status !== "unpaid") {
    const kind = o.metadata && o.metadata.kind, uid = Number(o.metadata && o.metadata.user_id) || null;
    if (kind === "store") await recordOrder(o, uid);
    else if (kind === "track") await recordTrackSale(uid, Number(o.metadata.track_id));
    else if (kind === "subscription" && uid) await q("UPDATE users SET subscribed=TRUE, subscription_id=$1 WHERE id=$2", [o.subscription, uid]);
  } else if (ev.type === "customer.subscription.updated" || ev.type === "customer.subscription.deleted" || ev.type === "customer.subscription.created") {
    const on = ev.type !== "customer.subscription.deleted" && ["active", "trialing", "past_due"].includes(o.status);
    await q("UPDATE users SET subscribed=$1, subscription_id=$2 WHERE stripe_customer=$3", [on, o.id, o.customer]);
  } else if (ev.type === "account.updated") {
    await q("UPDATE users SET connect_ready=$1 WHERE connect_account=$2", [!!(o.payouts_enabled && o.details_submitted), o.id]);
  }
  return { received: true };
}

async function recordOrder(sess, uid) {
  const items = JSON.parse((sess.metadata && sess.metadata.items) || "{}");
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const r = await c.query("INSERT INTO orders (user_id,email,stripe_session,items,total_cents,shipping) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (stripe_session) DO NOTHING RETURNING id",
      [uid, (sess.customer_details && sess.customer_details.email) || "", sess.id, items, sess.amount_total || 0, sess.shipping_details || (sess.collected_information && sess.collected_information.shipping_details) || null]);
    if (r.rows[0]) for (const [id, n] of Object.entries(items)) if (PRODUCTS[id] && PRODUCTS[id].license) for (let i = 0; i < Number(n); i++) await c.query("INSERT INTO licenses (key,order_id,product) VALUES ($1,$2,$3)", [licenseKey(id), r.rows[0].id, id]);
    await c.query("COMMIT");
  } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
}

export async function recordTrackSale(uid, trackId) {
  const t = await one("SELECT * FROM tracks WHERE id=$1", [trackId]); if (!t || !uid) return;
  await q("INSERT INTO library (user_id,track_id,how) VALUES ($1,$2,'purchase') ON CONFLICT (user_id,track_id) DO UPDATE SET how='purchase'", [uid, trackId]);
  if (t.publisher_id !== uid) await q("INSERT INTO earnings (publisher_id,track_id,buyer_id,reason,cents) VALUES ($1,$2,$3,'purchase',$4) ON CONFLICT DO NOTHING", [t.publisher_id, trackId, uid, Math.round(t.price_cents * PUBLISHER_SHARE)]);
}
