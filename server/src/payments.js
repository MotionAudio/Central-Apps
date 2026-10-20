// Stripe: store checkout, the Central Tracks subscription, single track sales, and Connect accounts for publishers.
// Checkout pages are hosted by Stripe; the webhook (/stripe/webhook) is what actually records a payment.
import Stripe from "stripe";
import { config, PRODUCTS, SUBSCRIPTION, PUBLISHER_SHARE } from "./config.js";
import { q, one, pool } from "./db.js";
import { churchOf, createChurch, issueKeys } from "./licenses.js";

export const stripe = config.stripe.secret ? new Stripe(config.stripe.secret) : null;
export function needStripe() { if (!stripe) { const e = new Error("Payments aren't set up yet (STRIPE_SECRET_KEY is missing)."); e.status = 503; throw e; } }

async function customerFor(user) {
  if (user.stripe_customer) return user.stripe_customer;
  const c = await stripe.customers.create({ email: user.email, name: user.name || undefined, metadata: { user_id: String(user.id) } });
  await q("UPDATE users SET stripe_customer=$1 WHERE id=$2", [c.id, user.id]);
  return c.id;
}

// the church's own billing (its name on the receipts; the card stays with the church when the main admin changes)
export async function churchCustomer(church) {
  if (church.stripe_customer) return church.stripe_customer;
  const owner = church.owner_id ? await one("SELECT email FROM users WHERE id=$1", [church.owner_id]) : null;
  const c = await stripe.customers.create({ name: church.name, email: owner ? owner.email : undefined, metadata: { church_id: String(church.id) } });
  await q("UPDATE churches SET stripe_customer=$1 WHERE id=$2", [c.id, church.id]);
  return c.id;
}
export async function churchBillingPortal(church) {
  needStripe();
  const s = await stripe.billingPortal.sessions.create({ customer: await churchCustomer(church), return_url: config.publicUrl + "/#account" });
  return s.url;
}
export async function syncChurchCustomer(churchId) {   // (a new name, or a new main admin: the receipts' name and email)
  if (!stripe) return;
  const c = await one("SELECT c.*, u.email AS owner_email FROM churches c LEFT JOIN users u ON u.id=c.owner_id WHERE c.id=$1", [churchId]);
  if (!c || !c.stripe_customer) return;
  try { await stripe.customers.update(c.stripe_customer, { name: c.name, email: c.owner_email || undefined }); } catch (e) { console.error("stripe customer:", e.message); }
}
// Central Tracks Unlimited: yours, or your church's (the main admin subscribes for everyone in it)
export async function isSubscribed(user) {
  if (!user) return false;
  if (user.subscribed) return true;
  return !!(await one("SELECT 1 FROM church_members m JOIN churches c ON c.id=m.church_id WHERE m.user_id=$1 AND c.subscribed", [user.id]));
}

// everything in the store comes with license keys, and keys belong to a church: you buy signed in, and the first
// purchase makes your church (you become its main admin) when you're not in one yet
export async function storeCheckout(user, items, churchName) {
  if (!user) { const e = new Error("Sign in or make an account first: your keys go to your church's account."); e.status = 401; throw e; }
  let church = await churchOf(user.id);
  if (!church && !String(churchName || "").trim()) { const e = new Error("Name your church or production first: your keys go to its account."); e.status = 400; e.needChurch = true; throw e; }
  const lines = [], meta = {}, qty = {};
  let ships = false;
  for (const [id, q0] of Object.entries(items || {})) { const n = Math.max(0, Math.min(50, Math.floor(Number(q0) || 0))); if (PRODUCTS[id] && n) qty[id] = n; }   // (whole numbers, checked once)
  for (const [id, n] of Object.entries(qty)) {
    const p = PRODUCTS[id];
    if (p.onePerChurch && (n > 1 || (church && church.has_services))) { const e = new Error(church && church.has_services ? "Your church already has Central Services." : "Central Services is one per church."); e.status = 400; throw e; }
    if (p.needsPack && !(church && church.has_pack) && !Object.keys(qty).some((k) => PRODUCTS[k].pack)) {
      const e = new Error("The $10 user price is for churches with a church pack. Add Central Usage (user) at $20 instead."); e.status = 400; throw e;
    }
    lines.push({ quantity: n, price_data: { currency: "usd", unit_amount: p.cents, product_data: { name: p.name } } });
    meta[id] = String(n); if (p.ships) ships = true;
  }
  if (!lines.length) { const e = new Error("Your cart is empty."); e.status = 400; throw e; }
  needStripe();
  if (!church) church = await createChurch(user, churchName);
  const s = await stripe.checkout.sessions.create({
    mode: "payment", line_items: lines,
    customer: await churchCustomer(church),
    shipping_address_collection: ships ? { allowed_countries: ["US", "CA"] } : undefined,
    metadata: { kind: "store", user_id: String(user.id), church_id: String(church.id), items: JSON.stringify(meta) },
    success_url: config.publicUrl + "/#order-done-{CHECKOUT_SESSION_ID}",
    cancel_url: config.publicUrl + "/#store",
  });
  return s.url;
}

export async function subscriptionCheckout(user) {
  needStripe();
  if (await isSubscribed(user)) { const e = new Error("You're already subscribed."); e.status = 400; throw e; }
  const church = await churchOf(user.id), forChurch = !!(church && church.role === "owner");   // (the main admin: for the whole church, billed to it)
  const s = await stripe.checkout.sessions.create({
    mode: "subscription", customer: forChurch ? await churchCustomer(church) : await customerFor(user),
    line_items: [{ quantity: 1, price_data: { currency: "usd", unit_amount: SUBSCRIPTION.cents, recurring: { interval: SUBSCRIPTION.interval }, product_data: { name: SUBSCRIPTION.name + (forChurch ? " - " + church.name : "") } } }],
    metadata: { kind: "subscription", user_id: String(user.id), church_id: forChurch ? String(church.id) : "" },
    subscription_data: { metadata: { user_id: String(user.id), church_id: forChurch ? String(church.id) : "" } },
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

// ---------------------------------------------------------------- webhook
export async function handleWebhook(rawBody, signature) {
  needStripe();
  const ev = stripe.webhooks.constructEvent(rawBody, signature, config.stripe.webhookSecret);
  const o = ev.data.object;
  if (ev.type === "checkout.session.completed" && o.payment_status !== "unpaid") {
    const kind = o.metadata && o.metadata.kind, uid = Number(o.metadata && o.metadata.user_id) || null;
    if (kind === "store") await recordOrder(o, uid);
    else if (kind === "track") await recordTrackSale(uid, Number(o.metadata.track_id));
    else if (kind === "subscription" && Number(o.metadata.church_id)) await q("UPDATE churches SET subscribed=TRUE, subscription_id=$1 WHERE id=$2", [o.subscription, Number(o.metadata.church_id)]);
    else if (kind === "subscription" && uid) await q("UPDATE users SET subscribed=TRUE, subscription_id=$1 WHERE id=$2", [o.subscription, uid]);
  } else if (ev.type === "customer.subscription.updated" || ev.type === "customer.subscription.deleted" || ev.type === "customer.subscription.created") {
    const on = ev.type !== "customer.subscription.deleted" && ["active", "trialing", "past_due"].includes(o.status);
    await q("UPDATE users SET subscribed=$1, subscription_id=$2 WHERE stripe_customer=$3", [on, o.id, o.customer]);
    await q("UPDATE churches SET subscribed=$1, subscription_id=$2 WHERE stripe_customer=$3", [on, o.id, o.customer]);
  } else if (ev.type === "invoice.paid" && (o.subscription || (o.parent && o.parent.subscription_details)) && o.amount_paid > 0) {
    const u = await one("SELECT id FROM users WHERE stripe_customer=$1", [o.customer]);
    await q("INSERT INTO subscription_payments (invoice_id,user_id,cents,paid_at) VALUES ($1,$2,$3,to_timestamp($4)) ON CONFLICT DO NOTHING", [o.id, u ? u.id : null, o.amount_paid, o.status_transitions && o.status_transitions.paid_at || Math.floor(Date.now() / 1000)]);
  } else if (ev.type === "account.updated") {
    await q("UPDATE users SET connect_ready=$1 WHERE connect_account=$2", [!!(o.payouts_enabled && o.details_submitted), o.id]);
  }
  return { received: true };
}

// checkouts started before 8.10's prices (a Stripe page stays open up to a day): their keys
const LEGACY = { "pedal-sw": { keys: { P: 2 } }, "pedal-hw": { keys: { P: 1 } }, control: { keys: { A: 1 } }, usage: { keys: { U: 1 } } };
export async function recordOrder(sess, uid) {
  const items = JSON.parse((sess.metadata && sess.metadata.items) || "{}"), churchId = Number(sess.metadata && sess.metadata.church_id) || null;
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const r = await c.query("INSERT INTO orders (user_id,email,stripe_session,items,total_cents,shipping,church_id) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (stripe_session) DO NOTHING RETURNING id",
      [uid, (sess.customer_details && sess.customer_details.email) || "", sess.id, items, sess.amount_total || 0, sess.shipping_details || (sess.collected_information && sess.collected_information.shipping_details) || null, churchId]);
    if (r.rows[0]) for (const [id, n] of Object.entries(items)) {
      const p = PRODUCTS[id] || LEGACY[id]; if (!p) continue;
      await issueKeys(c, r.rows[0].id, churchId, id, p, Number(n) || 0);
      if (p.pack && churchId) await c.query("UPDATE churches SET has_pack=TRUE WHERE id=$1", [churchId]);
      if (p.services && churchId) await c.query("UPDATE churches SET has_services=TRUE WHERE id=$1", [churchId]);
    }
    await c.query("COMMIT");
  } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
}

export async function recordTrackSale(uid, trackId) {
  const t = await one("SELECT * FROM tracks WHERE id=$1", [trackId]); if (!t || !uid) return;
  await q("INSERT INTO library (user_id,track_id,how) VALUES ($1,$2,'purchase') ON CONFLICT (user_id,track_id) DO UPDATE SET how='purchase'", [uid, trackId]);
  if (t.publisher_id !== uid) await q("INSERT INTO earnings (publisher_id,track_id,buyer_id,reason,cents) VALUES ($1,$2,$3,'purchase',$4) ON CONFLICT DO NOTHING", [t.publisher_id, trackId, uid, Math.round(t.price_cents * PUBLISHER_SHARE)]);
}
