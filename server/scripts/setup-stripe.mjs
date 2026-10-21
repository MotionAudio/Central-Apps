// Creates (or updates) the Motion Audio catalog and discount codes in a Stripe account.
// Safe to run again: products are matched by metadata.ma_id (or name), prices are replaced only when they change.
//   STRIPE_SECRET_KEY=sk_test_... node scripts/setup-stripe.mjs            (sandbox)
//   STRIPE_SECRET_KEY=sk_live_... node scripts/setup-stripe.mjs            (live, when you launch)
// All prices include tax (tax_behavior "inclusive").
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2026-09-30.endive" });
const SOFTWARE = "txcd_10202003", TANGIBLE = "txcd_99999999", TRACKS_SUB = "txcd_10804010";  // proposed tax codes

// keys: license keys per unit · services: Central Services accounts per unit (per church, no keys)
const CATALOG = [
  { id: "pack-lite", name: "Central-Apps Lite", cents: 25000, order: 1, keys: "main-admin:1, admin:2, user:6, pedal-control:1", services: 15,
    description: "For a small church team: 1 Main Admin, 2 admins and 6 users, 15 Central Services accounts, and 1 Central Pedal Control license." },
  { id: "pack-regular", name: "Central-Apps Regular", cents: 35000, order: 2, keys: "main-admin:1, admin:3, user:8, pedal-control:1", services: 18,
    description: "1 Main Admin, 3 admins and 8 users, 18 Central Services accounts, and 1 Central Pedal Control license." },
  { id: "pack-plus", name: "Central-Apps Plus", cents: 50000, order: 3, keys: "main-admin:1, admin:4, user:10, pedal-control:1", services: 20,
    description: "1 Main Admin, 4 admins and 10 users, 20 Central Services accounts, and 1 Central Pedal Control license." },
  { id: "pack-ultra", name: "Central-Apps Ultra", cents: 70000, order: 4, keys: "main-admin:1, admin:5, user:16, pedal-control:1", services: 30,
    description: "For large teams and production companies: 1 Main Admin, 5 admins and 16 users, 30 Central Services accounts, and 1 Central Pedal Control license." },
  { id: "ultra-plus10", name: "Ultra: +10 Central Services accounts", cents: 3500, order: 5, keys: "", services: 10, addonFor: "pack-ultra",
    description: "Takes Central-Apps Ultra from 30 to 40 Central Services accounts." },
  { id: "admin", name: "Central Admin", cents: 5000, order: 10, keys: "admin:1", description: "One more admin key for Central Control (lights, slides, lyrics, cameras, in-ears, tracks and mixing)." },
  { id: "user", name: "Central User", cents: 2000, order: 11, keys: "user:1", description: "One more user key: the instrument, lyrics and chord charts on any phone, tablet or computer." },
  { id: "services", name: "Central Services account", cents: 500, order: 12, keys: "", services: 1, description: "One more Central Services account for your church. No key needed: accounts belong to your church." },
  { id: "pedal-control", name: "Central Pedal Control", cents: 5000, order: 13, keys: "pedal-control:1", description: "The software for editing songs and settings and uploading them to a Central Pedal (macOS and iPad)." },
  { id: "pedal", name: "Central Pedal", cents: 25000, order: 20, keys: "", ships: true, taxCode: TANGIBLE, noCodes: true,
    description: "The pedal itself: assembled with buttons and knobs, software installed and tested. Ships to the US and Canada." },
];
const SUB = { id: "tracks", name: "Central Tracks Unlimited", cents: 7700, taxCode: TRACKS_SUB, lookup: "ma_subscription",
  description: "Unlimited pads, multitracks and Prime tracks from the Central Tracks library, straight to your pedal storage." };
// products made by earlier versions of this server, and what they became
const LEGACY = { "pedal-hw": "pedal", subscription: "tracks", control: null, usage: null, "pedal-sw": null };

const all = [];
for await (const p of stripe.products.list({ limit: 100 })) all.push(p);
const used = new Set();
function find(spec) {
  return all.find((p) => p.metadata.ma_id === spec.id) || all.find((p) => LEGACY[p.metadata.ma_product] === spec.id) || all.find((p) => p.name === spec.name && !used.has(p.id));
}
async function upsert(spec, recurring) {
  const meta = { ma_id: spec.id, keys: spec.keys || "", services: String(spec.services || 0), order: String(spec.order || 0), ships: spec.ships ? "true" : "", addon_for: spec.addonFor || "", no_codes: spec.noCodes ? "true" : "" };
  const fields = { name: spec.name, description: spec.description, tax_code: spec.taxCode || SOFTWARE, active: true, metadata: meta };
  let prod = find(spec);
  prod = prod ? await stripe.products.update(prod.id, fields) : await stripe.products.create(fields);
  used.add(prod.id);
  const cur = prod.default_price ? await stripe.prices.retrieve(prod.default_price) : null;
  const same = cur && cur.active && cur.unit_amount === spec.cents && cur.tax_behavior === "inclusive" && (!!cur.recurring === !!recurring);
  if (!same) {
    const price = await stripe.prices.create({ product: prod.id, currency: "usd", unit_amount: spec.cents, tax_behavior: "inclusive", recurring,
      lookup_key: spec.lookup || "ma_" + spec.id.replace(/-/g, "_"), transfer_lookup_key: true });
    await stripe.products.update(prod.id, { default_price: price.id });
    for await (const old of stripe.prices.list({ product: prod.id, active: true, limit: 100 })) if (old.id !== price.id) await stripe.prices.update(old.id, { active: false });
  }
  console.log((same ? "  ok      " : "  updated ") + spec.name + "  $" + spec.cents / 100 + (recurring ? "/month" : ""));
  return prod.id;
}

console.log("Products:");
const ids = {};
for (const spec of CATALOG) ids[spec.id] = await upsert(spec);
ids.tracks = await upsert(SUB, { interval: "month" });
for (const p of all) if (p.active && !used.has(p.id) && p.metadata.ma_product) { await stripe.products.update(p.id, { active: false }); console.log("  archived " + p.name + " (replaced)"); }

// ---- discount codes: work on everything except the physical pedal
const codeable = Object.entries(ids).filter(([id]) => !(CATALOG.find((c) => c.id === id) || {}).noCodes).map(([, pid]) => pid);
async function code(code, coupon) {
  let c = await stripe.coupons.retrieve(code).catch(() => null);
  if (!c) c = await stripe.coupons.create({ id: code, name: coupon.name, ...coupon.terms, applies_to: { products: codeable } });
  const promo = (await stripe.promotionCodes.list({ code, limit: 1 })).data[0];
  if (!promo) await stripe.promotionCodes.create({ code, promotion: { type: "coupon", coupon: c.id }, metadata: coupon.meta || {} });
  console.log("  " + code + ": " + coupon.name);
}
console.log("Codes:");
await code("TRIALRUN", { name: "Trial run: 100% off for 6 months", terms: { percent_off: 100, duration: "repeating", duration_in_months: 6 } });
await code("BETATEST", { name: "Beta test: 50% off", terms: { percent_off: 50, duration: "once" } });
console.log("  7FREE: 7-day free trial of Central Tracks Unlimited (handled by the website, not a Stripe coupon)");
console.log("Done.");
