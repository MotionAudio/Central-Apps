// The price page (Motion Audio staff): store prices and what each pack includes (keys and Central Services slots), the
// renewal and Central Tracks Unlimited prices, discount codes, and the Central Tracks star prices. Saved in
// site_settings and laid over config.js's defaults - the same objects everything else uses, so a change takes effect
// at once (and on every start).
import { q, one } from "./db.js";
import { PRODUCTS, SUBSCRIPTION, STAR_PRICE_CENTS, RENEWAL, DISCOUNTS, PLANS, PLAN_IDS, PLAN_ALL, PLAN_BUNDLES, PLANS_95 } from "./config.js";
import { isAdmin } from "./auth.js";
import { requireStep } from "./signin.js";

function bad(msg, status = 400) { const e = new Error(msg); e.status = status; return e; }
const DEFAULTS = JSON.parse(JSON.stringify({ PRODUCTS, SUBSCRIPTION, STAR_PRICE_CENTS, RENEWAL, DISCOUNTS, PLANS, PLAN_ALL, PLAN_BUNDLES }));
const cents = (v, what) => { const n = Math.round(Number(v)); if (!Number.isFinite(n) || n < 0 || n > 10000000) throw bad(what + ": a price from $0 to $100,000."); return n; };
const count = (v, what) => { const n = Math.round(Number(v)); if (!Number.isFinite(n) || n < 0 || n > 500) throw bad(what + ": 0 to 500."); return n; };

export function current() { return { PRODUCTS, SUBSCRIPTION, STAR_PRICE_CENTS, RENEWAL, DISCOUNTS, PLANS, PLAN_ALL, PLAN_BUNDLES }; }
// (the database keeps JSON keys in its own order: put them back in the store's order, then any new ones)
function replaceInto(target, src, order) {
  const copy = JSON.parse(JSON.stringify(src)), keys = Object.keys(copy), first = (order ? Object.keys(order) : []).filter((k) => k in copy);
  for (const k of Object.keys(target)) delete target[k];
  for (const k of first.concat(keys.filter((k) => !first.includes(k)))) target[k] = copy[k];
}
// (9.8) a list saved with the 9.5 plan prices still on it: today's (each plan +$20 with Central Pads in it)
function upgrade95(d) {
  const P = d.PLANS || {}, old = ["keys", "plugins", "instrument", "pedals"].every((id) => P[id] && P[id].cents === PLANS_95[id]);
  if (old && !P.pads) { d.PLANS = DEFAULTS.PLANS; if ((d.PLAN_ALL || {}).cents === PLANS_95.all) d.PLAN_ALL = DEFAULTS.PLAN_ALL; }
  if (d.PLAN_BUNDLES && JSON.stringify(Object.entries(d.PLAN_BUNDLES).map(([n, c]) => [Number(n), c])) === JSON.stringify(Object.entries(PLANS_95.bundles).map(([n, c]) => [Number(n), c]))) d.PLAN_BUNDLES = DEFAULTS.PLAN_BUNDLES;
  return d;
}
function apply(data) {
  const d = upgrade95(Object.assign({}, DEFAULTS, data || {}));
  replaceInto(PRODUCTS, d.PRODUCTS, DEFAULTS.PRODUCTS); replaceInto(SUBSCRIPTION, d.SUBSCRIPTION); replaceInto(STAR_PRICE_CENTS, d.STAR_PRICE_CENTS);
  replaceInto(RENEWAL, d.RENEWAL); replaceInto(DISCOUNTS, d.DISCOUNTS, DEFAULTS.DISCOUNTS);
  replaceInto(PLANS, d.PLANS, DEFAULTS.PLANS); replaceInto(PLAN_ALL, d.PLAN_ALL); replaceInto(PLAN_BUNDLES, d.PLAN_BUNDLES);   // (a price list from before 9.5: the plans' starting prices)
  for (const id of PLAN_IDS) if (!PLANS[id]) PLANS[id] = JSON.parse(JSON.stringify(DEFAULTS.PLANS[id]));   // (a list from before a plan was added)
}
// (a price list saved before 9.3 - three church packs, Central Services monthly - gives way to today's store)
export async function loadPrices() { const r = await one("SELECT data FROM site_settings WHERE name='prices'"); if (r && r.data && r.data.PRODUCTS && !r.data.PRODUCTS["pack-small"]) apply(r.data); else apply(null); }

// checks a whole price list from the page; returns it cleaned up
function clean(b) {
  const P = {};
  for (const [id, p] of Object.entries(b.PRODUCTS || {})) {
    if (!/^[a-z0-9-]{2,30}$/.test(id)) throw bad("Product ids are lowercase letters, digits and dashes.");
    const keys = {}; for (const k of ["P", "A", "U"]) { const n = count((p.keys || {})[k] || 0, (p.name || id) + " " + k + " keys"); if (n) keys[k] = n; }
    P[id] = { name: String(p.name || id).trim().slice(0, 80), cents: cents(p.cents, p.name || id), keys };
    const slots = count(p.slots || 0, (p.name || id) + " Central Services slots"); if (slots) P[id].slots = slots;
    for (const f of ["ships", "hardware", "pack"]) if (p[f]) P[id][f] = true;
    if (p.addonFor) P[id].addonFor = String(p.addonFor);
    if (p.hidden) P[id].hidden = true;
  }
  if (!Object.keys(P).length) throw bad("Keep at least one product.");
  for (const [id, p] of Object.entries(P)) if (p.addonFor && !P[p.addonFor]) throw bad(p.name + " goes with a product that isn't in the list any more.");
  const D = {};
  for (const [code0, x] of Object.entries(b.DISCOUNTS || {})) {
    const code = String(code0).trim().toUpperCase();
    if (!/^[A-Z0-9]{3,20}$/.test(code)) throw bad("Codes are 3 to 20 letters and digits (" + code0 + ").");
    if (x.trial) { const days = Math.round(Number(x.days)); if (!(days >= 1 && days <= 366)) throw bad(code + ": a trial is 1 to 366 days."); D[code] = { trial: true, days, label: String(x.label || days + "-day free trial").slice(0, 80), on: x.on !== false }; }
    else { const pc = Math.round(Number(x.percent)); if (!(pc >= 1 && pc <= 100)) throw bad(code + ": 1% to 100% off."); D[code] = { percent: pc, label: String(x.label || pc + "% off").slice(0, 80), on: x.on !== false }; if (x.plans === false) D[code].plans = false; }   // (plans: false - not on sound plans)
  }
  const star = {}; for (let i = 1; i <= 5; i++) star[i] = cents((b.STAR_PRICE_CENTS || {})[i], i + "-star tracks");
  // sound plans (yearly): each plan, all of them, and the church bundles (all of them for N people). Left out: kept as they are.
  const bp = b.PLANS || PLANS, plans = {};
  for (const id of PLAN_IDS) { const p = bp[id] || PLANS[id] || DEFAULTS.PLANS[id]; plans[id] = { name: String(p.name || DEFAULTS.PLANS[id].name).trim().slice(0, 80), cents: cents(p.cents, p.name || id), what: String(p.what || DEFAULTS.PLANS[id].what).slice(0, 300) }; }
  const ba = b.PLAN_ALL || PLAN_ALL, all = { name: String(ba.name || DEFAULTS.PLAN_ALL.name).slice(0, 80), cents: cents(ba.cents, "All sound plans") };
  const bundles = {};
  for (const [n0, c] of Object.entries(b.PLAN_BUNDLES || PLAN_BUNDLES)) { const n = Math.round(Number(n0)); if (!(n >= 1 && n <= 500)) throw bad("A bundle is for 1 to 500 people."); bundles[n] = cents(c, "Sound plans for " + n + " people"); }
  if (!Object.keys(bundles).length) throw bad("Keep at least one church bundle.");
  return {
    PRODUCTS: P, DISCOUNTS: D, STAR_PRICE_CENTS: star, PLANS: plans, PLAN_ALL: all, PLAN_BUNDLES: bundles,
    SUBSCRIPTION: { name: String((b.SUBSCRIPTION || {}).name || DEFAULTS.SUBSCRIPTION.name).slice(0, 80), cents: cents((b.SUBSCRIPTION || {}).cents, "Central Tracks Unlimited"), interval: "month" },
    RENEWAL: { name: String((b.RENEWAL || {}).name || DEFAULTS.RENEWAL.name).slice(0, 80), cents: cents((b.RENEWAL || {}).cents, "Renewal") },
  };
}

export function routes(api, { wrap, requireUser }) {
  const staff = async (req) => { if (!isAdmin(req.user)) throw bad("Admins only.", 403); await requireStep(req); };
  api.get("/admin/prices", requireUser, wrap(async (req, res) => {
    await staff(req);
    const r = await one("SELECT updated_at, updated_by FROM site_settings WHERE name='prices'");
    res.json({ prices: current(), defaults: DEFAULTS, updatedAt: r && r.updated_at, updatedBy: r && r.updated_by });
  }));
  api.post("/admin/prices", requireUser, wrap(async (req, res) => {
    await staff(req);
    const data = req.body && req.body.reset ? null : clean(req.body.prices || {});
    if (data) await q("INSERT INTO site_settings (name,data,updated_by) VALUES ('prices',$1,$2) ON CONFLICT (name) DO UPDATE SET data=EXCLUDED.data, updated_at=now(), updated_by=EXCLUDED.updated_by", [data, req.user.email]);
    else await q("DELETE FROM site_settings WHERE name='prices'");
    apply(data);
    res.json({ ok: true, prices: current() });
  }));
}
