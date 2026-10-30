// Purchases (10.0): the account icon → Purchases. Everything you bought, newest first, each with what it is, its keys
// (with Copy on the page), a Download button for each app or sound library it covers, short install steps, and when it
// renews. Keys your church gave you are there too, under the church's name. A sound plan's ONE package key opens
// everything in its plan (every sound, board, pedal, plugin and effect), so a plan shows one key and its library.
import { q, one } from "./db.js";
import { config, PRODUCTS, PLANS, PLAN_IDS, SUBSCRIPTION, withPads, KEY_KINDS } from "./config.js";
import { APPS, steps, PEDAL_SETUP } from "./downloads.js";
import { appLink, installLine, platformsOf, libraryLink, APP_OF_KIND, PLATFORM_NAMES } from "./getfile.js";
import { endOf } from "./plans.js";
import { fmt } from "./versions.js";
import { isDemoUser, demoPurchase } from "./demo.js";

const pretty = (k) => { const c = String(k || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); return c.length === 16 ? c.match(/.{4}/g).join("-") : String(k); };
const MAIN_PLANS = PLAN_IDS.filter((id) => id !== "pads");
const planText = (ids) => (MAIN_PLANS.every((id) => ids.includes(id)) ? "All sound plans (with Central Pads)" : PLAN_IDS.filter((id) => ids.includes(id)).map((id) => PLANS[id].name).join(", "));
const address = (s) => { if (!s) return null; const a = s.address || {}; return [s.name, a.line1, a.line2, [a.city, a.state, a.postal_code].filter(Boolean).join(" "), a.country].filter(Boolean).join(", "); };

// an app card: its download buttons (our own links), the install steps and the line for Linux
function appBlock(kind, keys) {
  const a = APPS[kind], app = APP_OF_KIND[kind];
  return { kind, app, name: a.name, icon: a.icon, runsOn: a.runsOn, devices: a.devices, phone: a.phone, steps: steps(a), linuxCommand: installLine(a.linux),
    links: Object.fromEntries(platformsOf(app).map((p) => [p, appLink(app, p)])), keys };
}
const libraries = (ids) => withPads(ids).map((id) => ({ plan: id, name: PLANS[id].name + " Library", link: libraryLink(id) }));
const appKeys = (rows) => {
  const by = {};
  for (const l of rows) (by[l.kind] = by[l.kind] || []).push({ key: pretty(l.key), who: l.assigned_name || l.assigned_email || null, inUse: l.devices || 0, trial: !!l.trial,
    updatesUntil: l.kind === "P" ? "forever" : fmt(l.updates_until), expiresAt: l.expires_at || null });
  return ["P", "A", "U"].filter((k) => by[k]).map((k) => appBlock(k, by[k]));
};

export async function purchasesFor(user) {
  const email = String(user.email || "").toLowerCase(), out = [];
  const LIC = "SELECT l.*, (SELECT COUNT(*) FROM license_devices d WHERE d.key=l.key)::int AS devices FROM licenses l";
  // ---- orders: apps, packs, keys, slots, the built pedal
  const orders = await q("SELECT o.*, c.name AS church, c.personal FROM orders o LEFT JOIN churches c ON c.id=o.church_id WHERE o.user_id=$1 AND o.status IN ('paid','review','refunded') ORDER BY o.created_at DESC", [user.id]);
  for (const o of orders) {
    const items = Object.entries(o.items || {}).filter(([id]) => PRODUCTS[id]).map(([id, n]) => ({ id, name: PRODUCTS[id].name, n: Number(n) || 0 }));
    const keys = await q(LIC + " WHERE l.order_id=$1 AND NOT l.revoked ORDER BY l.kind, l.created_at", [o.id]);
    out.push({ type: "order", id: "order-" + o.id, date: o.created_at, title: items.map((x) => (x.n > 1 ? x.n + " × " : "") + x.name).join(", ") || "Order", total: o.total_cents / 100,
      status: o.status, church: o.church && !o.personal ? o.church : null, slots: o.slots || 0, apps: appKeys(keys), packages: [], libraries: [],
      pedal: items.some((x) => PRODUCTS[x.id].ships) ? { shipsTo: address(o.shipping), held: o.status === "review", setup: PEDAL_SETUP } : null,
      renews: null, renewText: keys.some((l) => l.kind !== "P") ? "App keys don't expire. Each Central Control and Central Usage key gets ten full releases of updates; renew it any time for ten more." : null });
  }
  // ---- sound plans bought by this account (your own, or a church bundle)
  const subs = await q(`SELECT s.*, ${endOf("s.")} AS ends, c.name AS church FROM plan_subs s LEFT JOIN churches c ON c.id=s.church_id WHERE s.user_id=$1 AND s.status <> 'incomplete' ORDER BY s.created_at DESC`, [user.id]);
  for (const s of subs) {
    const keys = await q("SELECT * FROM package_keys WHERE plan_sub_id=$1 AND NOT revoked ORDER BY created_at", [s.id]);
    const ids = withPads(s.plans), on = ["active", "trialing", "past_due"].includes(s.status);
    out.push({ type: "plan", id: "plan-" + s.id, date: s.created_at, title: planText(ids) + (s.kind === "bundle" ? " for " + s.seats + " people" : ""), total: (s.cents || 0) / 100, status: on ? "active" : s.status,
      church: s.kind === "bundle" ? s.church : null, apps: [], libraries: libraries(ids),
      packages: keys.map((k) => ({ key: pretty(k.key), plans: planText(withPads(k.plans)), who: k.holder_name || k.holder_email || null })),
      renews: on && !s.cancel_at_period_end ? s.ends : null, ends: s.ends, renewText: on ? (s.cancel_at_period_end ? "Ends on its date; it won't renew." : "Renews every year.") : "Ended.",
      oneKey: "One key opens everything in " + (ids.length > 1 ? "these plans" : "this plan") + ": every sound, board, pedal, plugin and effect, on " + 3 + " of your devices (each a different app)." });
  }
  // ---- Central Tracks Unlimited (your own)
  if (user.subscribed) out.push({ type: "subscription", id: "tracks-unlimited", date: user.created_at, title: SUBSCRIPTION.name, total: SUBSCRIPTION.cents / 100, status: "active", apps: [], packages: [], libraries: [],
    renewText: "Renews every month. Every community Pad, Multitrack, Prime, Sound, Board and Click, for your church account, main admins, the pedal and Central Pedal Control.", renews: null });
  // ---- given to you by your church (app keys and package keys)
  const given = await q(LIC + " LEFT JOIN orders o ON o.id=l.order_id WHERE l.assigned_email=$1 AND NOT l.revoked AND (o.user_id IS NULL OR o.user_id<>$2) ORDER BY l.kind", [email, user.id]);
  const givenPk = await q(`SELECT k.*, c.name AS church, ${endOf("s.")} AS ends FROM package_keys k LEFT JOIN plan_subs s ON s.id=k.plan_sub_id LEFT JOIN churches c ON c.id=k.church_id
    WHERE k.holder_email=$1 AND NOT k.revoked AND (s.user_id IS NULL OR s.user_id<>$2) ORDER BY k.created_at DESC`, [email, user.id]);
  if (given.length || givenPk.length) {
    const ch = await one("SELECT c.name FROM churches c JOIN church_members m ON m.church_id=c.id WHERE m.user_id=$1", [user.id]);
    const ids = withPads(givenPk.flatMap((k) => k.plans));
    out.push({ type: "given", id: "given", date: null, title: "From " + ((ch && ch.name) || (givenPk[0] && givenPk[0].church) || "your church"), church: (ch && ch.name) || null, status: "active", apps: appKeys(given),
      packages: givenPk.map((k) => ({ key: pretty(k.key), plans: planText(withPads(k.plans)), until: k.trial ? k.ends_at : k.ends, trial: !!k.trial })), libraries: libraries(ids),
      renewText: "Your church looks after these. Ask your main admin if one stops working." });
  }
  // ---- the demo account: Riverstone Church (demo)'s built-in keys
  if (isDemoUser(user)) {
    const d = demoPurchase();
    out.unshift({ type: "demo", id: "demo", date: null, title: d.church + ": every app and every plan", church: d.church, status: "active",
      apps: d.apps.map((x) => appBlock(x.kind, [{ key: x.key, who: null, inUse: 0, updatesUntil: "forever" }])),
      packages: d.packages.map((p) => ({ key: p.key, plans: p.plans })), libraries: libraries(PLAN_IDS),
      renewText: "Demo keys work until Motion Audio staff switch the default keys off. Central Tracks Unlimited is on for the demo church." });
  }
  return { purchases: out, platformNames: PLATFORM_NAMES, keyKinds: KEY_KINDS, guide: config.publicUrl + "/help/install.html" };
}

export function routes(api, { wrap, requireUser }) {
  api.get("/purchases", requireUser, wrap(async (req, res) => res.json(await purchasesFor(req.user))));
}
