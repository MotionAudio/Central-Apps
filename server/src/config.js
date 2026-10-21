// Everything set through environment variables (Render → the service → Environment). See ../.env.example.
const env = process.env;
export const config = {
  port: Number(env.PORT || 8080),
  publicUrl: (env.PUBLIC_URL || env.RENDER_EXTERNAL_URL || "http://localhost:" + (env.PORT || 8080)).replace(/\/+$/, ""),
  databaseUrl: env.DATABASE_URL || "postgres://localhost/motionaudio",
  tokenSecret: env.TOKEN_SECRET || "dev-only-secret-change-me",
  adminEmails: (env.ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
  stripe: {
    secret: env.STRIPE_SECRET_KEY || "",            // use a restricted key (rk_) in production; see STRIPE-PLAN.md
    publishable: env.STRIPE_PUBLISHABLE_KEY || "",  // for Connect embedded components (payout settings banner)
    webhookSecret: env.STRIPE_WEBHOOK_SECRET || "",
    apiVersion: "2026-09-30.endive",
    // Stripe Tax is off (Checkout Studio: automatic_tax false). Before turning it on, add a head office address
    // (Tax → Settings) and registrations (Tax → Locations), or Stripe silently collects $0.
    requireIdToPublish: env.REQUIRE_ID_TO_PUBLISH !== "off",  // Stripe Identity check before a publisher's first upload
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

// Prices (cents). Change them here.
// The store sells whatever is active in your Stripe Dashboard (Products); scripts/setup-stripe.mjs creates the
// Motion Audio catalog. Product metadata the store reads:
//   keys     = license keys per unit, e.g. "main-admin:1, admin:2, user:6, pedal-control:1" (empty = none)
//   services = Central Services accounts per unit (they belong to the church's account; no keys)
//   addon_for = ma_id of the product this is an add-on to (e.g. Ultra's +10 accounts)
//   no_codes = "true" to leave it out of discount codes (the physical pedal)
//   ships = "true" to collect a shipping address (automatic for the "General - Tangible Goods" tax code)
//   order = a number to sort the store by; hidden = "true" to leave it off the website
// The subscription is the active monthly price with lookup key "ma_subscription" (or the only monthly price).
export const TAX_CODES = { track: "txcd_10401100", tangible: "txcd_99999999" };  // single tracks; physical goods
// License key kinds, the app each one unlocks, and the major version line keys sold today are good for.
// Updates stay inside a line (8.0-8.9); the next major (9.0) is a new purchase. Raise a number when you ship a new major.
export const LICENSE_KINDS = {
  "main-admin": { name: "Main Admin (Central Control)", app: "control" },
  admin: { name: "Central Admin", app: "control" },
  control: { name: "Central Control", app: "control" },
  user: { name: "Central User", app: "usage" },
  usage: { name: "Central Usage", app: "usage" },
  schedule: { name: "Central Schedule user", app: "schedule" },
  "pedal-control": { name: "Central Pedal Control", app: "pedal" },
  pedal: { name: "Central Pedal", app: "pedal" },
  license: { name: "License", app: null },
};
export const APP_MAJOR = { pedal: 8, control: 2, usage: 2, schedule: 1 };
export const STAR_PRICE_CENTS = { 1: 500, 2: 1000, 3: 1500, 4: 2000, 5: 3000 };
export const PUBLISHER_SHARE = 0.75;          // of each purchase
// Subscriber pool: this share of each month's subscription money is split among publishers by how many
// subscriber adds they got that month (each subscriber counts once per track). Never pays out more than comes in.
export const POOL_SHARE = 0.5;
export const MIN_PAYOUT_CENTS = 1000;         // monthly payouts start at $10
