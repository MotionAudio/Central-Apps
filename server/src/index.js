// Motion Audio server: serves the website (public/) and the Central Tracks API used by the website and by
// Central Pedal / Central Pedal Control (docs/CENTRAL-TRACKS-API.md in the apps repo).
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config, STAR_PRICE_CENTS, POOL_SHARE, PRODUCTS, SUBSCRIPTION } from "./config.js";
import { q, one, migrate } from "./db.js";
import { hashPassword, checkPassword, makeToken, attachUser, requireUser, isAdmin } from "./auth.js";
import * as store from "./storage.js";
import { gradeAudio } from "./grade.js";
import * as pay from "./payments.js";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1);
const here = path.dirname(fileURLToPath(import.meta.url));
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Stripe needs the raw body to check the signature, so this comes before the JSON parser
app.post("/stripe/webhook", express.raw({ type: "application/json" }), wrap(async (req, res) => {
  res.json(await pay.handleWebhook(req.body, req.headers["stripe-signature"]));
}));

// local file storage, only when R2 isn't configured (testing)
app.put("/local-files/*", wrap(async (req, res) => {
  const key = decodeURI(req.params[0]);
  if (store.usingR2 || req.query.op !== "put" || !store.checkLocalSig("put", key, req.query.exp, req.query.sig)) return res.status(403).end();
  const p = store.localPath(key); fs.mkdirSync(path.dirname(p), { recursive: true });
  await new Promise((ok, bad) => { const out = fs.createWriteStream(p); req.pipe(out); out.on("finish", ok); out.on("error", bad); });
  res.status(200).end();
}));
app.get("/local-files/*", (req, res) => {
  const key = decodeURI(req.params[0]);
  if (store.usingR2 || req.query.op !== "get" || !store.checkLocalSig("get", key, req.query.exp, req.query.sig)) return res.status(403).end();
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.sendFile(store.localPath(key));
});

// ---------------------------------------------------------------- API
const api = express.Router();
api.use((req, res, next) => {  // the apps call from http://127.0.0.1:8766 (Pi) and file:// (Mac); tokens, not cookies
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});
api.use(express.json({ limit: "256kb" }));
api.use(wrap(attachUser));

const tries = new Map();  // simple brake on password guessing: 10 tries per IP per 15 minutes
function brake(req) {
  const now = Date.now(), k = req.ip, t = (tries.get(k) || []).filter((x) => now - x < 15 * 60e3);
  t.push(now); tries.set(k, t);
  if (t.length > 10) { const e = new Error("Too many tries. Wait a few minutes and try again."); e.status = 429; throw e; }
}
function bad(msg, status = 400) { const e = new Error(msg); e.status = status; return e; }
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

api.post("/signup", wrap(async (req, res) => {
  brake(req);
  const email = String(req.body.email || "").trim().toLowerCase(), pw = String(req.body.password || ""), name = String(req.body.name || "").trim().slice(0, 80);
  if (!emailOk(email)) throw bad("Enter a valid email address.");
  if (pw.length < 8) throw bad("Use a password of at least 8 characters.");
  if (await one("SELECT 1 FROM users WHERE email=$1", [email])) throw bad("There's already an account with that email. Sign in instead.", 409);
  const u = await one("INSERT INTO users (email,name,pass_hash) VALUES ($1,$2,$3) RETURNING id", [email, name, hashPassword(pw)]);
  res.json({ token: makeToken(u.id) });
}));
api.post("/login", wrap(async (req, res) => {
  brake(req);
  const u = await one("SELECT * FROM users WHERE email=$1", [String(req.body.email || "").trim().toLowerCase()]);
  if (!u || !checkPassword(String(req.body.password || ""), u.pass_hash)) throw bad("That email and password don't match.", 401);
  res.json({ token: makeToken(u.id) });
}));
api.get("/me", requireUser, wrap(async (req, res) => {
  const u = req.user;
  res.json({ email: u.email, name: u.name, subscribed: u.subscribed, admin: isAdmin(u), payoutsReady: u.connect_ready, payoutsStarted: !!u.connect_account });
}));
api.get("/config", (_req, res) => res.json({ payments: !!pay.stripe, products: PRODUCTS, subscription: SUBSCRIPTION, starPrices: STAR_PRICE_CENTS, poolShare: POOL_SHARE }));

function trackOut(t) {
  return { id: String(t.id), title: t.title, artist: t.artist, kind: t.kind, key: t.song_key, bpm: Number(t.bpm) || 0, stars: t.stars, price: t.price_cents / 100, owned: !!t.owned, mine: !!t.mine };
}
api.get("/tracks", wrap(async (req, res) => {
  const uid = req.user ? req.user.id : 0, text = String(req.query.q || "").trim().slice(0, 100), kind = String(req.query.kind || "");
  const params = [uid], where = ["t.status='live'"];
  if (text) { params.push("%" + text.replace(/[%_\\]/g, "\\$&") + "%"); where.push("(t.title ILIKE $" + params.length + " OR t.artist ILIKE $" + params.length + " OR t.song_key ILIKE $" + params.length + ")"); }
  if (["Pad", "Multitrack", "Prime"].includes(kind)) { params.push(kind); where.push("t.kind=$" + params.length); }
  if (req.query.mine && uid) where.push("t.publisher_id=$1");
  const rows = await q(`SELECT t.*, (l.user_id IS NOT NULL OR t.publisher_id=$1) AS owned, (t.publisher_id=$1) AS mine
    FROM tracks t LEFT JOIN library l ON l.track_id=t.id AND l.user_id=$1
    WHERE ${where.join(" AND ")} ORDER BY t.created_at DESC LIMIT 200`, params);
  res.json({ tracks: rows.map(trackOut) });
}));

async function filesFor(trackId) {
  const files = await q("SELECT * FROM track_files WHERE track_id=$1 ORDER BY is_mix, id", [trackId]);
  const stems = files.filter((f) => !f.is_mix), use = stems.length ? stems : files;  // stems when there are any, else the mix
  return Promise.all(use.map(async (f) => ({ name: f.name, role: f.role || undefined, url: await store.downloadUrl(f.storage_key, f.name) })));
}
async function liveTrack(id) {
  const t = await one("SELECT * FROM tracks WHERE id=$1", [Number(id) || 0]);
  if (!t || t.status !== "live") throw bad("That track isn't available.", 404);
  return t;
}
async function owns(uid, t) { return t.publisher_id === uid || !!(await one("SELECT 1 FROM library WHERE user_id=$1 AND track_id=$2", [uid, t.id])); }

api.post("/tracks/:id/add", requireUser, wrap(async (req, res) => {
  const u = req.user, t = await liveTrack(req.params.id);
  if (await owns(u.id, t)) return res.json({ files: await filesFor(t.id) });
  if (!u.subscribed) return res.status(402).json({ error: "Buy this track or subscribe to Central Tracks Unlimited.", checkoutUrl: pay.stripe ? await pay.trackCheckout(u, t) : undefined });
  await q("INSERT INTO library (user_id,track_id,how) VALUES ($1,$2,'subscription') ON CONFLICT DO NOTHING", [u.id, t.id]);
  await q("INSERT INTO earnings (publisher_id,track_id,buyer_id,reason,cents) VALUES ($1,$2,$3,'subscriber_add',0) ON CONFLICT DO NOTHING", [t.publisher_id, t.id, u.id]);  // counts toward this month's pool
  res.json({ files: await filesFor(t.id) });
}));
api.post("/tracks/:id/purchase", requireUser, wrap(async (req, res) => {
  const u = req.user, t = await liveTrack(req.params.id);
  if (await owns(u.id, t)) return res.json({ files: await filesFor(t.id) });
  res.json({ checkoutUrl: await pay.trackCheckout(u, t) });
}));
api.get("/library", requireUser, wrap(async (req, res) => {
  const rows = await q("SELECT t.*, TRUE AS owned FROM library l JOIN tracks t ON t.id=l.track_id WHERE l.user_id=$1 AND t.status='live' ORDER BY l.added_at DESC", [req.user.id]);
  res.json({ tracks: rows.map(trackOut) });
}));
api.post("/tracks/:id/report", wrap(async (req, res) => {
  const t = await one("SELECT id FROM tracks WHERE id=$1", [Number(req.params.id) || 0]); if (!t) throw bad("Track not found.", 404);
  const reason = String(req.body.reason || "").trim().slice(0, 2000); if (!reason) throw bad("Say what's wrong with this track.");
  await q("INSERT INTO reports (track_id,reporter,reason) VALUES ($1,$2,$3)", [t.id, req.user ? req.user.email : String(req.body.email || "anonymous").slice(0, 200), reason]);
  res.json({ ok: true });
}));

// ---- publishing: upload straight to storage, then publish (the server grades the mix and sets the price)
api.post("/uploads", requireUser, wrap(async (req, res) => {
  const name = String(req.body.name || "audio"), size = Number(req.body.size) || 0;
  if (size > 2 * 1024 ** 3) throw bad("Files can be up to 2 GB.");
  const key = store.newKey(req.user.id, name);
  res.json({ key, url: await store.uploadUrl(key, req.body.type) });
}));
const ROLES = ["", "music", "drums", "bass", "keys", "guitar", "vocals", "click", "guide"];
api.post("/publish", requireUser, wrap(async (req, res) => {
  const u = req.user, b = req.body, mine = (k) => typeof k === "string" && k.startsWith("u" + u.id + "/");
  const title = String(b.title || "").trim().slice(0, 140), artist = String(b.artist || "").trim().slice(0, 140);
  if (!title || !artist) throw bad("Add the song title and the artist.");
  if (!["Pad", "Multitrack", "Prime"].includes(b.kind)) throw bad("Choose Pad, Multitrack or Prime.");
  if (b.rights !== true) throw bad("Confirm that you own this recording or have the rights to sell it.");
  if (!b.mix || !mine(b.mix.key) || !(await store.exists(b.mix.key))) throw bad("Upload the full mix first.");
  const stems = (Array.isArray(b.stems) ? b.stems : []).slice(0, 64);
  for (const s of stems) if (!mine(s.key) || !(await store.exists(s.key))) throw bad("One of the stems didn't finish uploading. Try again.");

  const tmp = await store.fetchToTemp(b.mix.key);
  let g; try { g = await gradeAudio(tmp); } finally { fs.rm(path.dirname(tmp), { recursive: true, force: true }, () => {}); }
  const t = await one(`INSERT INTO tracks (publisher_id,title,artist,kind,song_key,bpm,stars,price_cents,grade_report,rights_ok)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE) RETURNING *`,
    [u.id, title, artist, b.kind, String(b.key || "").slice(0, 8), Math.max(0, Math.min(400, Number(b.bpm) || 0)), g.stars, STAR_PRICE_CENTS[g.stars], JSON.stringify(g.checks)]);
  await q("INSERT INTO track_files (track_id,name,role,storage_key,is_mix) VALUES ($1,$2,'',$3,TRUE)", [t.id, String(b.mix.name || "Mix").slice(0, 200), b.mix.key]);
  for (const s of stems) await q("INSERT INTO track_files (track_id,name,role,storage_key,is_mix) VALUES ($1,$2,$3,$4,FALSE)", [t.id, String(s.name || "Stem").slice(0, 200), ROLES.includes(s.role) ? s.role : "", s.key]);
  res.json({ track: trackOut({ ...t, owned: true, mine: true }), grade: g });
}));
api.get("/publisher", requireUser, wrap(async (req, res) => {
  const uid = req.user.id;
  const tracks = await q(`SELECT t.*, TRUE AS owned, TRUE AS mine,
      (SELECT COUNT(*) FROM earnings e WHERE e.track_id=t.id AND e.reason='purchase')::int AS sales,
      (SELECT COUNT(*) FROM earnings e WHERE e.track_id=t.id AND e.reason='subscriber_add')::int AS adds
    FROM tracks t WHERE t.publisher_id=$1 AND t.status<>'removed' ORDER BY t.created_at DESC`, [uid]);
  const sum = await one(`SELECT COALESCE(SUM(cents) FILTER (WHERE transfer_id IS NULL),0)::int AS unpaid, COALESCE(SUM(cents) FILTER (WHERE transfer_id IS NOT NULL),0)::int AS paid
    FROM (SELECT cents, transfer_id FROM earnings WHERE publisher_id=$1 UNION ALL SELECT cents, transfer_id FROM pool_shares WHERE publisher_id=$1) x`, [uid]);
  const monthAdds = await one("SELECT COUNT(*)::int AS n FROM earnings WHERE publisher_id=$1 AND reason='subscriber_add' AND created_at >= date_trunc('month', now())", [uid]);
  res.json({ unpaid: sum.unpaid / 100, paid: sum.paid / 100, addsThisMonth: monthAdds.n, payoutsReady: req.user.connect_ready, tracks: tracks.map((t) => ({ ...trackOut(t), status: t.status, sales: t.sales, adds: t.adds })) });
}));

// ---- payments
api.post("/checkout/store", wrap(async (req, res) => res.json({ url: await pay.storeCheckout(req.user, req.body.items) })));
api.post("/checkout/subscription", requireUser, wrap(async (req, res) => res.json({ url: await pay.subscriptionCheckout(req.user) })));
api.post("/billing", requireUser, wrap(async (req, res) => res.json({ url: await pay.billingPortal(req.user) })));
api.post("/connect", requireUser, wrap(async (req, res) => res.json({ url: await pay.connectLink(req.user) })));
api.get("/orders/:session", wrap(async (req, res) => {  // the Checkout session id (only the buyer has it) shows the order's license keys
  const o = await one("SELECT * FROM orders WHERE stripe_session=$1", [String(req.params.session)]);
  if (!o) return res.json({ pending: true });
  const keys = await q("SELECT key, product FROM licenses WHERE order_id=$1 ORDER BY product, key", [o.id]);
  res.json({ total: o.total_cents / 100, items: o.items, licenses: keys.map((k) => ({ key: k.key, product: PRODUCTS[k.product] ? PRODUCTS[k.product].name : k.product })) });
}));

// ---- admin (ADMIN_EMAILS): reports and hiding tracks
api.get("/admin/reports", requireUser, wrap(async (req, res) => {
  if (!isAdmin(req.user)) throw bad("Admins only.", 403);
  res.json({ reports: await q("SELECT r.*, t.title, t.status FROM reports r JOIN tracks t ON t.id=r.track_id ORDER BY r.created_at DESC LIMIT 200") });
}));
api.post("/admin/tracks/:id/status", requireUser, wrap(async (req, res) => {
  if (!isAdmin(req.user)) throw bad("Admins only.", 403);
  if (!["live", "hidden", "removed"].includes(req.body.status)) throw bad("Status must be live, hidden or removed.");
  await q("UPDATE tracks SET status=$1 WHERE id=$2", [req.body.status, Number(req.params.id) || 0]);
  res.json({ ok: true });
}));

app.use("/v1", api);
app.get("/health", (_req, res) => res.json({ ok: true, payments: !!pay.stripe, storage: store.usingR2 ? "r2" : "local" }));
app.use(express.static(path.join(here, "..", "public"), { extensions: ["html"] }));

app.use((err, req, res, _next) => {
  const status = err.status || (err.type === "StripeSignatureVerificationError" ? 400 : 500);
  if (status >= 500) console.error(req.method, req.path, err);
  res.status(status).json({ error: status >= 500 && !err.status ? "Something went wrong on the server." : err.message });
});

if (process.env.NODE_ENV === "production") {
  if (config.tokenSecret === "dev-only-secret-change-me") throw new Error("Set TOKEN_SECRET before running in production.");
  if (!store.usingR2) console.warn("WARNING: R2 storage isn't set, so uploads go to the server's disk and are lost on every deploy. Set the R2_* variables.");
}
await migrate();
app.listen(config.port, () => console.log("Motion Audio server on " + config.publicUrl + " (storage: " + (store.usingR2 ? "R2" : "local folder") + ", payments: " + (pay.stripe ? "on" : "off") + ")"));
