// Everything set through environment variables (Render → the service → Environment). See ../.env.example.
const env = process.env;
export const config = {
  port: Number(env.PORT || 8080),
  publicUrl: (env.PUBLIC_URL || env.RENDER_EXTERNAL_URL || "http://localhost:" + (env.PORT || 8080)).replace(/\/+$/, ""),
  databaseUrl: env.DATABASE_URL || "postgres://localhost/motionaudio",
  tokenSecret: env.TOKEN_SECRET || "dev-only-secret-change-me",
  timeZone: env.TIME_ZONE || "America/Chicago",   // (the times in schedule emails)
  supportEmail: (env.SUPPORT_EMAIL || "").trim(),              // technical support: the Contact support form, error alerts
  alertEmail: (env.ALERT_EMAIL || env.SUPPORT_EMAIL || "").trim(),   // (error alerts somewhere else, if wanted)
  sms: { sid: env.TWILIO_ACCOUNT_SID || "", token: env.TWILIO_AUTH_TOKEN || "", from: env.TWILIO_FROM || "", api: env.TWILIO_API_URL || "https://api.twilio.com" },
  adminEmails: (env.ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
  stripe: {
    secret: env.STRIPE_SECRET_KEY || "",
    webhookSecret: env.STRIPE_WEBHOOK_SECRET || "",
  },
  // Cloudflare R2 (or any S3-compatible storage). Left empty, files go to a local folder (for testing only).
  storage: {
    endpoint: env.R2_ENDPOINT || "",
    bucket: env.R2_BUCKET || "",
    accessKey: env.R2_ACCESS_KEY_ID || "",
    secretKey: env.R2_SECRET_ACCESS_KEY || "",
    localDir: env.LOCAL_STORAGE_DIR || "./data/files",
  },
};

// Prices (cents). Change them here. "keys" is the license keys each one comes with: P (Central Pedal and Central
// Pedal Control), A (Central Control, for admins), U (Central Usage, for users). Each key works on one device at a time.
export const PRODUCTS = {
  pedal: { name: "Central Pedal (built, software installed)", cents: 25000, ships: true, hardware: true, keys: { P: 1 } },
  "pedal-control": { name: "Central Pedal Control", cents: 5000, keys: { P: 1 } },
  admin: { name: "Central Control (admin)", cents: 5000, keys: { A: 1 } },
  user: { name: "Central Usage (user)", cents: 2000, keys: { U: 1 } },
  "user-pack": { name: "Central Usage (user, church pack price)", cents: 1000, keys: { U: 1 }, needsPack: true },
  "pack-small": { name: "Small church pack", cents: 30000, pack: true, keys: { P: 1, A: 2, U: 6 } },
  "pack-medium": { name: "Medium church pack", cents: 50000, pack: true, keys: { P: 1, A: 4, U: 12 } },
  "pack-large": { name: "Large church pack", cents: 75000, pack: true, keys: { P: 1, A: 7, U: 20 } },
};
// Discount codes (typed in the cart; any capitals). Staff change them (and every price here) on the website's price page.
// percent codes: off the software (keys, packs, renewals) - not the built pedal, not monthly plans; each once per church.
// trial codes: everything free for that long (unlimited keys, Central Services, Central Tracks Unlimited); one free code
// per church or production company, ever.
export const DISCOUNTS = {
  USAGE10: { percent: 10, label: "10% off the software", on: true },
  "2026": { percent: 50, label: "50% off the software", on: true },
  TESTRUN: { trial: true, days: 183, label: "Test run: everything free for 6 months", on: true },
  "7FREE": { trial: true, days: 7, label: "7-day free trial of everything", on: true },
  BETATEST: { trial: true, days: 92, label: "Beta test: everything free for 3 months", on: true },
};
// renewing a Central Control (A) or Central Usage (U) key: ten more full releases of updates
export const RENEWAL = { name: "Update renewal (one key, ten more releases)", cents: 2000 };
export const KEY_KINDS = { P: "Central Pedal / Central Pedal Control", A: "Central Control (admin)", U: "Central Usage (user)" };
export const LICENSE_RECHECK_DAYS = 30;
// Central Services: a monthly plan per church, by how many accounts are in it: up to 10 $10, up to 25 $25, up to 50 $50,
// then $0.50 a month for each one past 50. The price follows the church's size.
export const SERVICES_PLAN = { name: "Central Services", tiers: [{ upTo: 10, cents: 1000 }, { upTo: 25, cents: 2500 }, { upTo: 50, cents: 5000 }], extraCents: 50 };
export function servicesCents(members) {
  const t = SERVICES_PLAN.tiers.slice().sort((a, b) => a.upTo - b.upTo), n = Math.max(1, Number(members) || 0), last = t[t.length - 1];
  for (const x of t) if (n <= x.upTo) return x.cents;
  return last.cents + (n - last.upTo) * SERVICES_PLAN.extraCents;
}
export const SERVICES_LIMITS = { teamsPerKind: 4, schedulers: 4, people: 1000 };
export const SUBSCRIPTION = { name: "Central Tracks Unlimited", cents: 7700, interval: "month" };
export const STAR_PRICE_CENTS = { 1: 500, 2: 1000, 3: 1500, 4: 2000, 5: 3000 };
export const PUBLISHER_SHARE = 0.75;          // of each purchase
// Subscriber pool: this share of each month's subscription money is split among publishers by how many
// subscriber adds they got that month (each subscriber counts once per track). Never pays out more than comes in.
export const POOL_SHARE = 0.5;
export const MIN_PAYOUT_CENTS = 1000;         // monthly payouts start at $10
