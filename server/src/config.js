// Everything set through environment variables (Render → the service → Environment). See ../.env.example.
const env = process.env;
export const config = {
  port: Number(env.PORT || 8080),
  publicUrl: (env.PUBLIC_URL || env.RENDER_EXTERNAL_URL || "http://localhost:" + (env.PORT || 8080)).replace(/\/+$/, ""),
  databaseUrl: env.DATABASE_URL || "postgres://localhost/motionaudio",
  tokenSecret: env.TOKEN_SECRET || "dev-only-secret-change-me",
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
  pedal: { name: "Central Pedal (built, software installed)", cents: 25000, ships: true, keys: { P: 1 } },
  "pedal-control": { name: "Central Pedal Control", cents: 5000, keys: { P: 1 } },
  admin: { name: "Central Control (admin)", cents: 5000, keys: { A: 1 } },
  user: { name: "Central Usage (user)", cents: 2000, keys: { U: 1 } },
  "user-pack": { name: "Central Usage (user, church pack price)", cents: 1000, keys: { U: 1 }, needsPack: true },
  "pack-small": { name: "Small church pack", cents: 40000, ships: true, pack: true, keys: { P: 2, A: 2, U: 6 } },
  "pack-medium": { name: "Medium church pack", cents: 60000, ships: true, pack: true, keys: { P: 2, A: 4, U: 12 } },
  "pack-large": { name: "Large church pack", cents: 85000, ships: true, pack: true, keys: { P: 2, A: 7, U: 20 } },
};
export const KEY_KINDS = { P: "Central Pedal / Central Pedal Control", A: "Central Control (admin)", U: "Central Usage (user)" };
export const LICENSE_RECHECK_DAYS = 30;   // the apps check their key again this often, and keep working offline that long
export const SUBSCRIPTION = { name: "Central Tracks Unlimited", cents: 7700, interval: "month" };
export const STAR_PRICE_CENTS = { 1: 500, 2: 1000, 3: 1500, 4: 2000, 5: 3000 };
export const PUBLISHER_SHARE = 0.75;          // of each purchase
// Subscriber pool: this share of each month's subscription money is split among publishers by how many
// subscriber adds they got that month (each subscriber counts once per track). Never pays out more than comes in.
export const POOL_SHARE = 0.5;
export const MIN_PAYOUT_CENTS = 1000;         // monthly payouts start at $10
