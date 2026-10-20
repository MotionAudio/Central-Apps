// The price page (Motion Audio staff): store prices and what each pack includes, the renewal and monthly prices
// (Central Services' plan, Central Tracks Unlimited), discount codes, and the Central Tracks star prices. Saved in
// site_settings and laid over config.js's defaults - the same objects everything else uses, so a change takes effect
// at once (and on every start).
import { q, one } from "./db.js";
import { PRODUCTS, SUBSCRIPTION, STAR_PRICE_CENTS, RENEWAL, DISCOUNTS, SERVICES_PLAN } from "./config.js";
import { isAdmin } from "./auth.js";
import { requireStep } from "./signin.js";

function bad(msg, status = 400) { const e = new Error(msg); e.status = status; return e; }
const DEFAULTS = JSON.parse(JSON.stringify({ PRODUCTS, SUBSCRIPTION, STAR_PRICE_CENTS, RENEWAL, DISCOUNTS, SERVICES_PLAN }));
const cents = (v, what) => { const n = Math.round(Number(v)); if (!Number.isFinite(n) || n < 0 || n > 10000000) throw bad(what + ": a price from $0 to $100,000."); return n; };
const count = (v, what) => { const n = Math.round(Number(v)); if (!Number.isFinite(n) || n < 0 || n > 500) throw bad(what + ": 0 to 500."); return n; };

export function current() { return { PRODUCTS, SUBSCRIPTION, STAR_PRICE_CENTS, RENEWAL, DISCOUNTS, SERVICES_PLAN }; }
// (the database keeps JSON keys in its own order: put them back in the store's order, then any new ones)
function replaceInto(target, src, order) {
  const copy = JSON.parse(JSON.stringify(src)), keys = Object.keys(copy), first = (order ? Object.keys(order) : []).filter((k) => k in copy);
  for (const k of Object.keys(target)) delete target[k];
  for (const k of first.concat(keys.filter((k) => !first.includes(k)))) target[k] = copy[k];
}
function apply(data) {
  const d = Object.assign({}, DEFAULTS, data || {});
  replaceInto(PRODUCTS, d.PRODUCTS, DEFAULTS.PRODUCTS); replaceInto(SUBSCRIPTION, d.SUBSCRIPTION); replaceInto(STAR_PRICE_CENTS, d.STAR_PRICE_CENTS);
  replaceInto(RENEWAL, d.RENEWAL); replaceInto(DISCOUNTS, d.DISCOUNTS, DEFAULTS.DISCOUNTS); replaceInto(SERVICES_PLAN, d.SERVICES_PLAN);
}
export async function loadPrices() { const r = await one("SELECT data FROM site_settings WHERE name='prices'"); if (r) apply(r.data); }

// checks a whole price list from the page; returns it cleaned up
function clean(b) {
  const P = {};
  for (const [id, p] of Object.entries(b.PRODUCTS || {})) {
    if (!/^[a-z0-9-]{2,30}$/.test(id)) throw bad("Product ids are lowercase letters, digits and dashes.");
    const keys = {}; for (const k of ["P", "A", "U"]) { const n = count((p.keys || {})[k] || 0, (p.name || id) + " " + k + " keys"); if (n) keys[k] = n; }
    P[id] = { name: String(p.name || id).trim().slice(0, 80), cents: cents(p.cents, p.name || id), keys };
    for (const f of ["ships", "hardware", "pack", "needsPack"]) if (p[f]) P[id][f] = true;
    if (p.hidden) P[id].hidden = true;
  }
  if (!Object.keys(P).length) throw bad("Keep at least one product.");
  const D = {};
  for (const [code0, x] of Object.entries(b.DISCOUNTS || {})) {
    const code = String(code0).trim().toUpperCase();
    if (!/^[A-Z0-9]{3,20}$/.test(code)) throw bad("Codes are 3 to 20 letters and digits (" + code0 + ").");
    if (x.trial) { const days = Math.round(Number(x.days)); if (!(days >= 1 && days <= 366)) throw bad(code + ": a trial is 1 to 366 days."); D[code] = { trial: true, days, label: String(x.label || days + "-day free trial").slice(0, 80), on: x.on !== false }; }
    else { const pc = Math.round(Number(x.percent)); if (!(pc >= 1 && pc <= 100)) throw bad(code + ": 1% to 100% off."); D[code] = { percent: pc, label: String(x.label || pc + "% off the software").slice(0, 80), on: x.on !== false }; }
  }
  const sp = b.SERVICES_PLAN || {}, tiers = (sp.tiers || []).map((t) => ({ upTo: count(t.upTo, "Central Services tier"), cents: cents(t.cents, "Central Services tier") })).filter((t) => t.upTo > 0).sort((a, z) => a.upTo - z.upTo);
  if (!tiers.length) throw bad("Central Services needs at least one size.");
  const star = {}; for (let i = 1; i <= 5; i++) star[i] = cents((b.STAR_PRICE_CENTS || {})[i], i + "-star tracks");
  return {
    PRODUCTS: P, DISCOUNTS: D, STAR_PRICE_CENTS: star,
    SERVICES_PLAN: { name: "Central Services", tiers, extraCents: cents(sp.extraCents, "Central Services per extra member") },
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
