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
    secret: env.STRIPE_SECRET_KEY || "",                 // sk_... or a restricted rk_... key (SETUP.md lists its permissions)
    publishable: env.STRIPE_PUBLISHABLE_KEY || "",       // pk_...: the payment form on the page, and the payout settings
    webhookSecret: env.STRIPE_WEBHOOK_SECRET || "",
    apiVersion: "2026-09-30.endive",
    api: env.STRIPE_API_URL || "",                       // (tests: a stand-in Stripe)
    requireIdToPublish: env.REQUIRE_ID_TO_PUBLISH === "on",   // off: anyone with an account publishes. "on": publishers verify their ID once first (Stripe Identity)
  },
  // Cloudflare R2 (or any S3-compatible storage). Left empty, files go to a local folder (for testing only).
  storage: {
    endpoint: env.R2_ENDPOINT || "",
    bucket: env.R2_BUCKET || "",
    accessKey: env.R2_ACCESS_KEY_ID || "",
    secretKey: env.R2_SECRET_ACCESS_KEY || "",
    localDir: env.LOCAL_STORAGE_DIR || "./data/files",
  },
  // the sound libraries (libraries.js): where their zips and libraries-index.json are downloaded from. Today the GitHub
  // release "libraries" (the apps repository's CI publishes it); later the Cloudflare R2 bucket's public address.
  librariesBaseUrl: (env.LIBRARIES_BASE_URL || "https://github.com/MotionAudio/central-apps/releases/download/libraries").trim().replace(/\/+$/, ""),
};

// Prices (cents), tax included. Change them on the website's price page (staff), or here for the defaults.
// keys: the license keys each one comes with - P (Central Pedal and Central Pedal Control), A (Central Control: the main
// admin and admins), U (Central Usage: users). A church has up to 2 main admins: both use A keys (an admin is made a main
// admin on the church's page). slots: Central Services slots - one person on the church's teams each; when someone is
// taken off the teams, their slot is free for someone else. addonFor: only with that pack (one for each).
export const PRODUCTS = {
  "pack-lite": { name: "Central-Apps Lite", cents: 25000, pack: true, keys: { P: 1, A: 3, U: 6 }, slots: 15 },
  "pack-regular": { name: "Central-Apps Regular", cents: 35000, pack: true, keys: { P: 1, A: 4, U: 8 }, slots: 18 },
  "pack-plus": { name: "Central-Apps Plus", cents: 50000, pack: true, keys: { P: 1, A: 5, U: 10 }, slots: 20 },
  "pack-ultra": { name: "Central-Apps Ultra", cents: 70000, pack: true, keys: { P: 1, A: 6, U: 16 }, slots: 30 },
  "ultra-plus10": { name: "Ultra: 10 more Central Services slots", cents: 3500, keys: {}, slots: 10, addonFor: "pack-ultra" },
  admin: { name: "Central Admin key", cents: 5000, keys: { A: 1 } },
  user: { name: "Central User key", cents: 2000, keys: { U: 1 } },
  "services-slot": { name: "Central Services slot", cents: 500, keys: {}, slots: 1 },
  "pedal-control": { name: "Central Pedal Control", cents: 5000, keys: { P: 1 } },
  pedal: { name: "Central Pedal (built, software installed)", cents: 25000, ships: true, hardware: true, keys: { P: 1 } },
};
// Discount codes (typed in the cart; any capitals). Staff change them on the website's price page.
// percent codes: off everything but the built pedal (keys, packs, slots, renewals; not monthly plans); once per church.
// They also take that much off the first year of a sound plan (once per person, or once per church for a bundle),
// unless the code has plans: false. With no code typed, a live sale (the staff Sale page) does the same; they don't stack.
// trial codes: everything free for that long (unlimited keys, Central Services, Central Tracks Unlimited); one free code
// per church or production company, ever.
export const DISCOUNTS = {
  TRIALRUN: { trial: true, days: 183, label: "Trial run: everything free for 6 months", on: true },
  BETATEST: { percent: 50, label: "Beta test: 50% off", on: true },
  "7FREE": { trial: true, days: 7, label: "7-day free trial of everything", on: true },
};
// renewing a Central Control (A) or Central Usage (U) key: ten more full releases of updates
export const RENEWAL = { name: "Update renewal (one key, ten more releases)", cents: 2000 };
export const KEY_KINDS = { P: "Central Pedal / Central Pedal Control", A: "Central Control (main admin or admin)", U: "Central Usage (user)" };
export const LICENSE_RECHECK_DAYS = 30;
// default keys, one per kind, for now (staff switch them off on the staff page: see defaultkeys.js)
export const DEFAULT_KEYS = { P: "PDEF-AULT-KEY0-2026", A: "ADEF-AULT-KEY0-2026", U: "UDEF-AULT-KEY0-2026", S: "SDEF-AULT-KEY0-2026" };
// (10.0) the demo church: built-in keys like the default ones (the same staff switch turns them off), to show the apps
// to a church. The plan keys open their own plan (and Central Pads, like the real plans).
export const DEMO_CHURCH = "Riverstone Church (demo)";
export const DEMO_KEYS = { P: "PDMO-RVST-PCTL-2026", A: "ADMO-RVST-ADMN-2026", U: "UDMO-RVST-USER-2026" };
export const DEMO_PACKAGES = { "SDMO-RVST-ALL0-2026": ["keys", "plugins", "instrument", "pedals", "pads"], "SDMO-RVST-KEYS-2026": ["keys", "pads"], "SDMO-RVST-PLUG-2026": ["plugins", "pads"],
  "SDMO-RVST-INST-2026": ["instrument", "pads"], "SDMO-RVST-PEDL-2026": ["pedals", "pads"], "SDMO-RVST-PADS-2026": ["pads"] };
export const DEMO_ACCOUNT = { email: "riverstone-demo@motionaudio.org", password: "Riverstone-Demo-2026", name: "Riverstone demo" };
export const MAIN_ADMINS_MAX = 2;
// Central Services: slots bought once (packs come with some). Each person on the church's teams takes one.
export const SERVICES_LIMITS = { teamsPerKind: 4, schedulers: 4, people: 1000 };
// Stripe tax codes (prices include tax; Stripe Tax is off until it's set up - see server/SETUP.md)
export const TAX_CODES = { software: "txcd_10202003", tangible: "txcd_99999999", subscription: "txcd_10804010", track: "txcd_10401100" };
export const SUBSCRIPTION = { name: "Central Tracks Unlimited", cents: 7700, interval: "month" };
// Sound plans (9.5): yearly. Each opens a part of the sounds in the apps (the starter set stays free). Buying one gives
// a package key (S + 15 letters and digits, like P7K3-9QXM-…), emailed and on the Account page; the person pastes it in
// any app's Settings → Packages → Add a package. A church bundle gives N package keys with all the plans, handed out on
// the Teams page. A free trial (TRIALRUN, 7FREE) gives trial package keys with all the plans. Staff change prices on the
// price page.
export const PLANS = {
  keys: { name: "Central Keys", cents: 7000, what: "Pianos and synths, plus Central Pads" },
  plugins: { name: "Central Plugins", cents: 14000, what: "EQ, compressors, reverb, delay and more on tracks, pads, channels and the instrument, in Central Control, Central Usage and Central Pedal, plus Central Pads" },
  instrument: { name: "Central Instrument", cents: 10000, what: "Instrument sounds other than keys: bass and guitar sounds, and what the play-anything input turns your instrument into, plus Central Pads" },
  pedals: { name: "Central Pedals", cents: 7000, what: "Guitar pedals for anything with a 1/4\" or 1/8\" input: electric, bass, acoustic, keys, cello, plus Central Pads" },
  pads: { name: "Central Pads", cents: 4000, what: "Pads in every key for the pad pedal: warm, air, choir, shimmer, strings and more" },
};
export const PLAN_IDS = ["keys", "plugins", "instrument", "pedals", "pads"];
// (9.8) Central Pads comes with every other plan: a key with any of the four opens the pads too
export const PADS_PLAN = "pads";
export const withPads = (plans) => { const l = (plans || []).filter((id) => PLAN_IDS.includes(id)); return l.some((id) => id !== PADS_PLAN) && !l.includes(PADS_PLAN) ? l.concat(PADS_PLAN) : l; };
export const PLAN_ALL = { name: "All sound plans", cents: 24000 };
// church bundles: all the plans for this many people, a year (a package key each, given and taken back on Teams)
export const PLAN_BUNDLES = { 4: 70000, 8: 138000, 12: 186000, 16: 259000, 20: 292000 };
// the 9.5 prices (before Central Pads): a price list saved with exactly these moves to today's
export const PLANS_95 = { keys: 5000, plugins: 12000, instrument: 8000, pedals: 5000, all: 22000, bundles: { 4: 68000, 8: 136000, 12: 184000, 16: 257000, 20: 290000 } };
export const PLAN_INTERVAL = "year";
// a package key works on this many devices at a time, all with the same account (email), each a different app:
// any 3 of Central Pedal, Central Pedal Control, Central Control and Central Usage (never 2 pedals or 2 Usages)
export const PACKAGE_DEVICES = 3;
export const STAR_PRICE_CENTS = { 1: 500, 2: 1000, 3: 1500, 4: 2000, 5: 3000 };
// Central Tracks kinds: recordings (Pad, Multitrack, Prime) and, since 9.5, things the apps install: a Sound (an .sf2,
// or a zip of samples: a keys or instrument sound), a Board (a pedal board preset, JSON) and a Click (a click and
// count-in set, a zip of WAVs). Those come with a short demo clip, graded like a track: its stars set the price.
// Central Tracks Unlimited includes all of them.
export const RECORDING_KINDS = ["Pad", "Multitrack", "Prime"];
export const ITEM_KINDS = {
  Sound: { ext: ["sf2", "zip"], maxBytes: 2 * 1024 ** 3, what: "an .sf2 or a zip of samples" },
  Board: { ext: ["json"], maxBytes: 1024 ** 2, what: "a pedal board preset (.json)" },
  Click: { ext: ["zip"], maxBytes: 200 * 1024 ** 2, what: "a zip of WAVs" },
};
export const TRACK_KINDS = RECORDING_KINDS.concat(Object.keys(ITEM_KINDS));
export const DEMO_MAX_SECONDS = 120;   // a Sound, Board or Click's demo clip
export const PUBLISHER_SHARE = 0.75;          // of each purchase
// Subscriber pool: this share of each month's subscription money is split among publishers by how many
// subscriber adds they got that month (each subscriber counts once per track). Never pays out more than comes in.
export const POOL_SHARE = 0.5;
export const MIN_PAYOUT_CENTS = 1000;         // monthly payouts start at $10
