// Motion Audio server: serves the website (public/) and the Central Tracks API used by the website and by
// Central Pedal / Central Pedal Control (docs/CENTRAL-TRACKS-API.md in the apps repo).
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config, STAR_PRICE_CENTS, POOL_SHARE, PRODUCTS, SUBSCRIPTION, KEY_KINDS, RENEWAL, MAIN_ADMINS_MAX, PLANS, PLAN_IDS, PLAN_ALL, PLAN_BUNDLES, PACKAGE_DEVICES, TRACK_KINDS, ITEM_KINDS, DEMO_MAX_SECONDS } from "./config.js";
import { q, one, migrate } from "./db.js";
import { hashPassword, checkPassword, makeToken, attachUser, requireUser, isAdmin } from "./auth.js";
import * as store from "./storage.js";
import { gradeAudio } from "./grade.js";
import * as pay from "./payments.js";
import * as lic from "./licenses.js";
import * as svc from "./services.js";
import * as acct from "./account.js";
import * as signin from "./signin.js";
import * as support from "./support.js";
import * as church from "./church.js";
import * as backup from "./backup.js";
import * as trials from "./trials.js";
import * as prices from "./prices.js";
import * as content from "./content.js";
import * as plans from "./plans.js";
import * as downloads from "./downloads.js";
import * as libraries from "./libraries.js";
import * as defaultkeys from "./defaultkeys.js";
import * as setlists from "./setlists.js";

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
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});
const jsonSmall = express.json({ limit: "256kb" }), jsonBig = express.json({ limit: "12mb" });   // (edit mode sends pictures and whole pages)
api.use((req, res, next) => (/^\/admin\/content/.test(req.path) ? jsonBig : jsonSmall)(req, res, next));
api.use(wrap(attachUser));

// a brake on guessing (passwords, codes): 20 failed tries per internet address per 15 minutes. Only failures count, so a
// whole church signing in on the same Wi-Fi isn't slowed down.
const tries = new Map();
function brake(req) {
  const now = Date.now(), k = req.ip, t = (tries.get(k) || []).filter((x) => now - x < 15 * 60e3);
  tries.set(k, t);
  if (t.length >= 20) { const e = new Error("Too many tries. Wait a few minutes and try again."); e.status = 429; throw e; }
  if (req.res && !req.braked) { req.braked = true; req.res.on("finish", () => { if (req.res.statusCode >= 400 && req.res.statusCode !== 429) (tries.get(k) || tries.set(k, []).get(k)).push(Date.now()); }); }
}
setInterval(() => { const now = Date.now(); for (const [k, t] of tries) if (!t.some((x) => now - x < 15 * 60e3)) tries.delete(k); }, 15 * 60e3).unref();
function bad(msg, status = 400) { const e = new Error(msg); e.status = status; return e; }
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
lic.routes(api, { wrap, brake, requireUser });
svc.routes(api, { wrap, requireUser });
acct.routes(api, { wrap, brake });
signin.routes(api, { wrap, brake, requireUser });
support.routes(api, { wrap, brake, requireUser });
church.routes(api, { wrap, brake, requireUser });
prices.routes(api, { wrap, requireUser });
content.routes(app, api, { wrap, requireUser });
defaultkeys.routes(api, { wrap, requireUser });
plans.routes(api, { wrap, requireUser });
downloads.routes(api, { wrap, requireUser });
libraries.routes(api, { wrap });
// a song for a setlist (the website's "Add songs"): owned already, or added with Central Tracks Unlimited; else buy it first
setlists.routes(api, { wrap, requireUser, addTrack: async (u, id) => {
  const t = await liveTrack(id);
  if (await owns(u.id, t)) return t;
  if (!(await pay.isSubscribed(u))) { const e = bad("Buy this song first, or subscribe to Central Tracks Unlimited and add any song.", 402); e.checkoutUrl = config.publicUrl + "/#buy-" + t.id; throw e; }
  await q("INSERT INTO library (user_id,track_id,how) VALUES ($1,$2,'subscription') ON CONFLICT DO NOTHING", [u.id, t.id]);
  await q("INSERT INTO earnings (publisher_id,track_id,buyer_id,reason,cents) VALUES ($1,$2,$3,'subscriber_add',0) ON CONFLICT DO NOTHING", [t.publisher_id, t.id, u.id]);
  return t;
} });
function needConfirmed(u) { if (u && !u.email_confirmed) { const e = bad("Confirm your email first: we sent you a link (Account → Send it again)."); e.status = 403; e.needConfirm = true; throw e; } }

api.post("/signup", wrap(async (req, res) => {
  brake(req);
  const email = String(req.body.email || "").trim().toLowerCase(), pw = String(req.body.password || ""), name = String(req.body.name || "").trim().slice(0, 80);
  if (!emailOk(email)) throw bad("Enter a valid email address.");
  if (pw.length < 8) throw bad("Use a password of at least 8 characters.");
  if (await one("SELECT 1 FROM users WHERE email=$1", [email])) throw bad("There's already an account with that email. Sign in instead.", 409);
  // checked before the account is made: a wrong church code shouldn't leave a half-made account
  const join = String(req.body.churchCode || "").trim(), make = String(req.body.churchName || "").trim();
  if (join && !(await one("SELECT 1 FROM churches WHERE (admin_code=$1 OR user_code=$1) AND NOT personal", [lic.canon(join)]))) throw bad("That church code isn't right. Ask your main admin for it.", 404);
  const u = await one("INSERT INTO users (email,name,pass_hash) VALUES ($1,$2,$3) RETURNING *", [email, name, hashPassword(pw)]);
  let church = null;
  try {
    if (req.body.invite) church = (await lic.acceptInvite(u, req.body.invite)).church;   // (the link in a Teams email)
    else if (join) church = (await lic.joinChurch(u, join, req.body.churchRole)).name; else if (make) church = (await lic.createChurch(u, make)).name;
    // (added on a Teams page but signed up without the email's link: the invite counts once the email is confirmed)
  }
  catch (e) { await confirmOrSend(u, req.body.invite); return res.json(await signin.issue(u, req.body, { churchError: e.message })); }
  await confirmOrSend(u, req.body.invite);
  const fresh = await one("SELECT * FROM users WHERE id=$1", [u.id]);
  if (!church) church = await acct.joinByEmail(fresh);   // (no email set up on the website: confirmed already)
  res.json(await signin.issue(fresh, req.body, { church }));
}));
// a new account's email: confirmed already when it came from an invite sent to that email, otherwise a link goes to it
async function confirmOrSend(u, inviteToken) {
  const inv = inviteToken ? await one("SELECT email FROM invites WHERE token=$1", [String(inviteToken)]) : null;
  if (inv && inv.email === u.email) await q("UPDATE users SET email_confirmed=TRUE WHERE id=$1", [u.id]);
  else await acct.sendConfirm(u);
}
api.post("/login", wrap(async (req, res) => {
  brake(req);
  const u = await one("SELECT * FROM users WHERE email=$1 AND deleted_at IS NULL", [String(req.body.email || "").trim().toLowerCase()]);
  if (!u || !checkPassword(String(req.body.password || ""), u.pass_hash)) throw bad("That email and password don't match.", 401);
  res.json(await signin.issue(u, req.body));   // (the main admin and admins: a code to their phone on a new device)
}));
trials.routes(api, { wrap, brake, requireUser, needConfirmed });
api.get("/me", requireUser, wrap(async (req, res) => {
  const u = req.user;
  const c = await lic.churchOf(u.id);
  const payoutsReady = u.connect_account && !u.connect_ready ? await pay.refreshConnect(u) : !!u.connect_ready;   // (back from Stripe's payout setup)
  res.json({ email: u.email, name: u.name, subscribed: await pay.isSubscribed(u), ownSubscription: u.subscribed, admin: isAdmin(u), payoutsReady, payoutsStarted: !!u.connect_account,
    idStatus: u.id_status, idRequired: !!(config.stripe.requireIdToPublish && pay.stripe),
    emailConfirmed: !!u.email_confirmed, phone: u.phone ? signin.maskPhone(u.phone) : null, phoneConfirmed: u.phone_confirmed, twoStep: await signin.needsCode(u),
    church: c ? { name: c.name, role: c.role, hasPack: c.has_pack, owned: await pay.ownedCounts(c.id), hasServices: (c.services_slots || 0) > 0 || lic.trialActive(c), servicesSlots: c.services_slots || 0, subscribed: c.subscribed, trialUntil: lic.trialActive(c) ? c.trial_until : null, trialUsed: !!c.trial_code } : null });
}));
api.get("/config", wrap(async (req, res) => {
  const preview = req.query.preview && req.user && isAdmin(req.user);   // (staff see a saved sale before it's live)
  res.json({ renewal: RENEWAL, supportEmail: config.supportEmail || null, sms: signin.smsOn, payments: !!pay.stripe, publishableKey: config.stripe.publishable || null,
    products: PRODUCTS, keyKinds: KEY_KINDS, subscription: SUBSCRIPTION, starPrices: STAR_PRICE_CENTS, poolShare: POOL_SHARE, mainAdminsMax: MAIN_ADMINS_MAX,
    plans: PLANS, planIds: PLAN_IDS, planAll: PLAN_ALL, planBundles: PLAN_BUNDLES, packageDevices: PACKAGE_DEVICES, trackKinds: TRACK_KINDS, itemKinds: ITEM_KINDS, demoMaxSeconds: DEMO_MAX_SECONDS,
    sale: preview ? publicSale((await saleRow()).draft, true) : publicSale(await pay.liveSale()) });
}));

// kind: Pad, Multitrack, Prime (recordings) or Sound, Board, Click (installed by the apps: format sf2, zip or json;
// they have a demo clip, GET /tracks/:id/demo). The apps install what /tracks/:id/add answers by its kind.
function trackOut(t) {
  const item = !!ITEM_KINDS[t.kind];
  return { id: String(t.id), title: t.title, artist: t.artist, kind: t.kind, key: t.song_key, bpm: Number(t.bpm) || 0, stars: t.stars, price: t.price_cents / 100, owned: !!t.owned, mine: !!t.mine,
    item, format: item ? t.item_format || null : undefined, demo: item || undefined };
}
api.get("/tracks", wrap(async (req, res) => {   // ?kind=Sound, or several: ?kind=Sound,Board,Click
  const uid = req.user ? req.user.id : 0, text = String(req.query.q || "").trim().slice(0, 100), kinds = String(req.query.kind || "").split(",").map((k) => k.trim()).filter((k) => TRACK_KINDS.includes(k));
  const params = [uid], where = ["t.status='live'"];
  if (text) { params.push("%" + text.replace(/[%_\\]/g, "\\$&") + "%"); where.push("(t.title ILIKE $" + params.length + " OR t.artist ILIKE $" + params.length + " OR t.song_key ILIKE $" + params.length + ")"); }
  if (kinds.length) { params.push(kinds); where.push("t.kind = ANY($" + params.length + ")"); }
  if (req.query.mine && uid) where.push("t.publisher_id=$1");
  const rows = await q(`SELECT t.*, (l.user_id IS NOT NULL OR t.publisher_id=$1) AS owned, (t.publisher_id=$1) AS mine
    FROM tracks t LEFT JOIN library l ON l.track_id=t.id AND l.user_id=$1
    WHERE ${where.join(" AND ")} ORDER BY t.created_at DESC LIMIT 200`, params);
  res.json({ tracks: rows.map(trackOut) });
}));

async function filesFor(trackId) {   // (a Sound, Board or Click: its one file, role "item" - not the demo clip)
  const files = await q("SELECT * FROM track_files WHERE track_id=$1 ORDER BY is_mix, id", [trackId]);
  const stems = files.filter((f) => !f.is_mix), use = stems.length ? stems : files;  // stems when there are any, else the mix
  return Promise.all(use.map(async (f) => ({ name: f.name, role: f.role || undefined, url: await store.downloadUrl(f.storage_key, f.name) })));
}
// what the apps get when they add or buy something: its kind (how to install it), the format of an item, and the files
const delivery = async (t) => ({ kind: t.kind, format: ITEM_KINDS[t.kind] ? t.item_format || null : undefined, files: await filesFor(t.id) });
async function liveTrack(id) {
  const t = await one("SELECT * FROM tracks WHERE id=$1", [Number(id) || 0]);
  if (!t || t.status !== "live") throw bad("That track isn't available.", 404);
  return t;
}
async function owns(uid, t) { return t.publisher_id === uid || !!(await one("SELECT 1 FROM library WHERE user_id=$1 AND track_id=$2", [uid, t.id])); }

api.post("/tracks/:id/add", requireUser, wrap(async (req, res) => {
  const u = req.user, t = await liveTrack(req.params.id);
  if (await owns(u.id, t)) return res.json(await delivery(t));
  if (!(await pay.isSubscribed(u))) return res.status(402).json({ error: "Buy this " + (ITEM_KINDS[t.kind] ? t.kind.toLowerCase() : "track") + " or subscribe to Central Tracks Unlimited.", checkoutUrl: config.publicUrl + "/#buy-" + t.id });   // (the apps open the website to pay)
  await q("INSERT INTO library (user_id,track_id,how) VALUES ($1,$2,'subscription') ON CONFLICT DO NOTHING", [u.id, t.id]);
  await q("INSERT INTO earnings (publisher_id,track_id,buyer_id,reason,cents) VALUES ($1,$2,$3,'subscriber_add',0) ON CONFLICT DO NOTHING", [t.publisher_id, t.id, u.id]);  // counts toward this month's pool
  res.json(await delivery(t));
}));
api.get("/tracks/:id/demo", wrap(async (req, res) => {   // a Sound, Board or Click's demo clip: anyone can listen before buying
  const t = await liveTrack(req.params.id);
  if (!ITEM_KINDS[t.kind]) throw bad("Only Sounds, Boards and Clicks have a demo clip.", 404);
  const f = await one("SELECT * FROM track_files WHERE track_id=$1 AND is_mix ORDER BY id LIMIT 1", [t.id]);
  if (!f) throw bad("This one has no demo clip.", 404);
  res.json({ name: f.name, url: await store.downloadUrl(f.storage_key, f.name) });
}));
api.post("/tracks/:id/purchase", requireUser, wrap(async (req, res) => {
  const u = req.user, t = await liveTrack(req.params.id); needConfirmed(u);
  if (await owns(u.id, t)) return res.json(await delivery(t));
  if (!req.query.web) return res.json({ checkoutUrl: config.publicUrl + "/#buy-" + t.id });   // the apps open the website to pay
  res.json(await pay.trackCheckout(u, t));   // the website: the payment form's { clientSecret }
}));
api.get("/tracks/:id", wrap(async (req, res) => {   // one track (the website's Buy link from the apps)
  const uid = req.user ? req.user.id : 0, t = await liveTrack(req.params.id);
  res.json({ track: trackOut({ ...t, owned: uid ? await owns(uid, t) : false, mine: t.publisher_id === uid }) });
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
  if (!title || !artist) throw bad("Add the " + (ITEM_KINDS[b.kind] ? "name" : "song title") + " and the artist.");
  if (!TRACK_KINDS.includes(b.kind)) throw bad("Choose Pad, Multitrack, Prime, Sound, Board or Click.");
  const item = ITEM_KINDS[b.kind];
  if (b.rights !== true) throw bad(item ? "Confirm that you made this " + b.kind.toLowerCase() + " or have the rights to sell it." : "Confirm that you own this recording or have the rights to sell it.");
  if (config.stripe.requireIdToPublish && pay.stripe && u.id_status !== "verified") throw bad("Verify your ID before you publish (once, about 2 minutes): Publishing → Verify my ID.", 403);
  if (!b.mix || !mine(b.mix.key) || !(await store.exists(b.mix.key))) throw bad(item ? "Upload a short demo clip first (MP3 or WAV): we grade it, and its stars set the price." : "Upload the full mix first.");
  const stems = item ? [] : (Array.isArray(b.stems) ? b.stems : []).slice(0, 64);
  for (const s of stems) if (!mine(s.key) || !(await store.exists(s.key))) throw bad("One of the stems didn't finish uploading. Try again.");
  let format = null;
  if (item) {   // a Sound, Board or Click: the file the apps install, checked here
    if (!b.item || !mine(b.item.key) || !(await store.exists(b.item.key))) throw bad("Upload the " + b.kind.toLowerCase() + " itself: " + item.what + ".");
    format = path.extname(String(b.item.name || "")).slice(1).toLowerCase();
    if (!item.ext.includes(format)) throw bad("A " + b.kind + " is " + item.what + ".");
    format = await checkItem(b.kind, format, b.item.key, item);
  }

  const tmp = await store.fetchToTemp(b.mix.key);
  let g; try { g = await gradeAudio(tmp); } finally { fs.rm(path.dirname(tmp), { recursive: true, force: true }, () => {}); }
  if (item && g.info.duration > DEMO_MAX_SECONDS + 0.5) throw bad("Keep the demo clip under " + Math.round(DEMO_MAX_SECONDS / 60) + " minutes: it's a taste of the " + b.kind.toLowerCase() + ".");
  const t = await one(`INSERT INTO tracks (publisher_id,title,artist,kind,song_key,bpm,stars,price_cents,grade_report,rights_ok,item_format)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE,$10) RETURNING *`,
    [u.id, title, artist, b.kind, String(b.key || "").slice(0, 8), Math.max(0, Math.min(400, Number(b.bpm) || 0)), g.stars, STAR_PRICE_CENTS[g.stars], JSON.stringify(g.checks), format]);
  await q("INSERT INTO track_files (track_id,name,role,storage_key,is_mix) VALUES ($1,$2,$3,$4,TRUE)", [t.id, String(b.mix.name || (item ? "Demo" : "Mix")).slice(0, 200), item ? "demo" : "", b.mix.key]);
  if (item) await q("INSERT INTO track_files (track_id,name,role,storage_key,is_mix) VALUES ($1,$2,'item',$3,FALSE)", [t.id, String(b.item.name).slice(0, 200), b.item.key]);
  for (const s of stems) await q("INSERT INTO track_files (track_id,name,role,storage_key,is_mix) VALUES ($1,$2,$3,$4,FALSE)", [t.id, String(s.name || "Stem").slice(0, 200), ROLES.includes(s.role) ? s.role : "", s.key]);
  res.json({ track: trackOut({ ...t, owned: true, mine: true }), grade: g });
}));
// a Sound (.sf2 or a zip of samples), a Board (a JSON preset) or a Click (a zip of WAVs): the right size, and really that
// kind of file (an .sf2 starts RIFF....sfbk, a zip PK; a Board is a JSON object). Answers its format.
async function checkItem(kind, format, key, item) {
  const tmp = await store.fetchToTemp(key);
  try {
    const size = fs.statSync(tmp).size;
    if (size > item.maxBytes) throw bad("That " + kind.toLowerCase() + " is too big (up to " + (item.maxBytes >= 1024 ** 3 ? item.maxBytes / 1024 ** 3 + " GB" : Math.round(item.maxBytes / 1024 ** 2) + " MB") + ").");
    if (size < 4) throw bad("That file is empty.");
    const fd = fs.openSync(tmp, "r"), head = Buffer.alloc(12); fs.readSync(fd, head, 0, 12, 0); fs.closeSync(fd);
    if (format === "sf2" && !(head.toString("latin1", 0, 4) === "RIFF" && head.toString("latin1", 8, 12) === "sfbk")) throw bad("That isn't a SoundFont (.sf2) file.");
    if (format === "zip" && head.toString("latin1", 0, 2) !== "PK") throw bad("That isn't a zip file.");
    if (format === "json") {
      let v; try { v = JSON.parse(fs.readFileSync(tmp, "utf8")); } catch { throw bad("That Board isn't readable JSON. Export it again from the pedal board."); }
      if (!v || typeof v !== "object" || Array.isArray(v)) throw bad("A Board is a pedal board preset: one JSON object.");
    }
    return format;
  } finally { fs.rm(path.dirname(tmp), { recursive: true, force: true }, () => {}); }
}
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
// every checkout answers { clientSecret, session }: the page shows Stripe's payment form with it
api.post("/checkout/store", requireUser, wrap(async (req, res) => { needConfirmed(req.user); res.json(await pay.storeCheckout(req.user, req.body.items, req.body.church, req.body.code, undefined, req.body.for)); }));
api.post("/checkout/store/check", requireUser, wrap(async (req, res) => { needConfirmed(req.user); res.json(await pay.storeCheckout(req.user, req.body.items, req.body.church, req.body.code, "check", req.body.for)); }));   // (the cart: any problem shows before the payment form)
api.post("/checkout/subscription", requireUser, wrap(async (req, res) => { needConfirmed(req.user); res.json(await pay.subscriptionCheckout(req.user)); }));
// sound plans (yearly), as package keys: your own { plans: ["keys", ...] or "all", code } (one key, emailed to you), or a
// church bundle { seats: 4 | 8 | 12 | 16 | 20, code } (that many keys, handed out on the Teams page)
api.post("/checkout/plans", requireUser, wrap(async (req, res) => { needConfirmed(req.user); res.json(await pay.planCheckout(req.user, req.body.plans, req.body.code)); }));
api.post("/checkout/plans/check", requireUser, wrap(async (req, res) => { needConfirmed(req.user); res.json(await pay.planCheckout(req.user, req.body.plans, req.body.code, "check")); }));
api.post("/checkout/plan-bundle", requireUser, wrap(async (req, res) => { needConfirmed(req.user); res.json(await pay.bundleCheckout(req.user, req.body.seats, req.body.code)); }));
api.post("/checkout/plan-bundle/check", requireUser, wrap(async (req, res) => { needConfirmed(req.user); res.json(await pay.bundleCheckout(req.user, req.body.seats, req.body.code, "check")); }));
api.post("/billing", requireUser, wrap(async (req, res) => res.json({ url: await pay.billingPortal(req.user) })));
// publishers: payout setup (Stripe's pages), the payout settings shown on the website, and the one-time ID check
api.post("/connect", requireUser, wrap(async (req, res) => res.json({ url: await pay.connectLink(req.user) })));
api.post("/connect/session", requireUser, wrap(async (req, res) => res.json({ clientSecret: await pay.connectSession(req.user) })));
api.post("/identity", requireUser, wrap(async (req, res) => {
  if (req.user.id_status === "verified") return res.json({ verified: true });
  res.json({ url: await pay.identitySession(req.user) });
}));
api.get("/orders/:session", wrap(async (req, res) => {  // the Checkout session id (only the buyer has it) shows the order's license keys
  const o = await one("SELECT * FROM orders WHERE stripe_session=$1", [String(req.params.session)]);
  if (!o) return res.json({ pending: true });
  const keys = await q("SELECT key, product, kind FROM licenses WHERE order_id=$1 ORDER BY kind, product, key", [o.id]);
  const ch = o.church_id ? await one("SELECT name, personal FROM churches WHERE id=$1", [o.church_id]) : null;   // ("Just me": the Downloads page; a church: next, add your people)
  res.json({ total: o.total_cents / 100, items: o.items, slots: o.slots || 0, status: o.status, shipping: !!o.shipping, personal: !!(ch && ch.personal), church: ch && !ch.personal ? ch.name : null,
    itemNames: Object.entries(o.items || {}).filter(([id]) => PRODUCTS[id]).map(([id, n]) => ({ name: PRODUCTS[id].name, n: Number(n) || 0 })),
    licenses: o.status === "paid" ? keys.map((k) => ({ key: lic.pretty(k.key), kind: k.kind, product: KEY_KINDS[k.kind] || (PRODUCTS[k.product] ? PRODUCTS[k.product].name : k.product) })) : [] });
}));

// ---- a sale on the website (staff): saved as a draft, seen by staff only ("Preview"), then put live for everyone
const SALE_KEYS = ["name", "percent", "banner", "endsAt", "includePedal"];
async function saleRow() { const r = await one("SELECT data FROM site_settings WHERE name='sale'"); return (r && r.data) || { draft: null, live: null }; }
function publicSale(x, preview) { return x && x.percent ? { name: x.name || "Sale", percent: x.percent, banner: x.banner || "", endsAt: x.endsAt || null, includePedal: !!x.includePedal, preview: !!preview } : null; }
async function saveSale(data, by) { await q("INSERT INTO site_settings (name,data,updated_by) VALUES ('sale',$1,$2) ON CONFLICT (name) DO UPDATE SET data=EXCLUDED.data, updated_at=now(), updated_by=EXCLUDED.updated_by", [data, by]); }
const staffOnly = async (req) => { if (!isAdmin(req.user)) throw bad("Admins only.", 403); await signin.requireStep(req); };
api.get("/admin/sale", requireUser, wrap(async (req, res) => { await staffOnly(req); res.json(await saleRow()); }));
api.post("/admin/sale", requireUser, wrap(async (req, res) => {   // save the draft
  await staffOnly(req);
  const b = req.body || {}, pct = Math.round(Number(b.percent));
  if (!(pct >= 1 && pct <= 90)) throw bad("A sale is 1% to 90% off.");
  const endsAt = b.endsAt ? new Date(b.endsAt) : null; if (endsAt && (isNaN(endsAt) || endsAt < new Date())) throw bad("The end date has to be in the future.");
  const draft = { name: String(b.name || "Sale").trim().slice(0, 60), percent: pct, banner: String(b.banner || "").trim().slice(0, 160), endsAt: endsAt ? endsAt.toISOString() : null, includePedal: !!b.includePedal };
  const row = await saleRow(); await saveSale({ ...row, draft }, req.user.email);
  res.json({ ok: true, draft });
}));
api.post("/admin/sale/live", requireUser, wrap(async (req, res) => {   // put the draft live, or end the live sale
  await staffOnly(req);
  const row = await saleRow();
  if (req.body && req.body.end) { await saveSale({ ...row, live: null }, req.user.email); return res.json({ ok: true, live: null }); }
  if (!row.draft) throw bad("Save a sale first.");
  const live = Object.fromEntries(SALE_KEYS.map((k) => [k, row.draft[k]]));
  await saveSale({ ...row, live: { ...live, at: new Date().toISOString() } }, req.user.email);
  res.json({ ok: true, live });
}));

// ---- admin (ADMIN_EMAILS): the nightly backups (and Back up now)
api.get("/admin/backups", requireUser, wrap(async (req, res) => { if (!isAdmin(req.user)) throw bad("Admins only.", 403); await signin.requireStep(req); res.json({ backups: (await backup.listBackups()).slice(0, 40) }); }));
api.post("/admin/backups", requireUser, wrap(async (req, res) => { if (!isAdmin(req.user)) throw bad("Admins only.", 403); await signin.requireStep(req); res.json(await backup.makeBackup()); }));

// ---- admin (ADMIN_EMAILS): reports and hiding tracks
api.get("/admin/reports", requireUser, wrap(async (req, res) => {
  if (!isAdmin(req.user)) throw bad("Admins only.", 403); await signin.requireStep(req);
  res.json({ reports: await q("SELECT r.*, t.title, t.status FROM reports r JOIN tracks t ON t.id=r.track_id ORDER BY r.created_at DESC LIMIT 200") });
}));
api.post("/admin/tracks/:id/status", requireUser, wrap(async (req, res) => {
  if (!isAdmin(req.user)) throw bad("Admins only.", 403); await signin.requireStep(req);
  if (!["live", "hidden", "removed"].includes(req.body.status)) throw bad("Status must be live, hidden or removed.");
  await q("UPDATE tracks SET status=$1 WHERE id=$2", [req.body.status, Number(req.params.id) || 0]);
  res.json({ ok: true });
}));

app.use("/v1", api);
app.get("/health", (_req, res) => { res.setHeader("Access-Control-Allow-Origin", "*"); res.json({ ok: true, payments: !!pay.stripe, storage: store.usingR2 ? "r2" : "local" }); });   // (the apps' "is the internet there?")
// the home page with the site's own address filled in (the picture a shared link shows needs a full address)
let homeHtml = null;
app.get(["/", "/index.html"], (_req, res, next) => {
  try { if (!homeHtml) homeHtml = fs.readFileSync(path.join(here, "..", "public", "index.html"), "utf8").replace(/%PUBLIC_URL%/g, config.publicUrl); } catch (_) { return next(); }
  res.setHeader("Content-Type", "text/html; charset=utf-8"); res.setHeader("Cache-Control", "no-cache"); res.send(homeHtml);
});
app.use(express.static(path.join(here, "..", "public"), { extensions: ["html"] }));

app.use((err, req, res, _next) => {
  const status = err.status || (err.type === "StripeSignatureVerificationError" ? 400 : 500);
  if (status >= 500) { console.error(req.method, req.path, err); if (!err.status) support.recordError({ source: "website", internal: true, message: err.message, stack: err.stack, detail: { request: req.method + " " + req.path, user: req.user ? req.user.email : undefined } }); }
  res.status(status).json({ error: status >= 500 && !err.status ? "Something went wrong on the server." : err.message, trialCode: err.trialCode || undefined, needChurch: err.needChurch || undefined, needClose: err.needClose || undefined, needConfirm: err.needConfirm || undefined });
});

if (process.env.NODE_ENV === "production") {
  if (config.tokenSecret === "dev-only-secret-change-me") throw new Error("Set TOKEN_SECRET before running in production.");
  if (!store.usingR2) console.warn("WARNING: R2 storage isn't set, so uploads go to the server's disk and are lost on every deploy. Set the R2_* variables.");
}
// the website's own crashes are reported too (then it restarts, as Render does for any exit)
process.on("unhandledRejection", (e) => { console.error("unhandled:", e); support.recordError({ source: "website", internal: true, message: "Unhandled: " + ((e && e.message) || String(e)), stack: e && e.stack }); });
process.on("uncaughtException", (e) => { console.error("crash:", e); support.recordError({ source: "website", internal: true, message: "Crash: " + e.message, stack: e.stack }).finally(() => process.exit(1)); setTimeout(() => process.exit(1), 5000).unref(); });
await migrate();
await prices.loadPrices();
setInterval(() => prices.loadPrices().catch(() => { }), 5 * 60e3).unref();   // (another server changed them)
if (process.env.REMINDERS !== "off") acct.startReminders();   // (every hour: invites nobody answered, the day before a service)
app.listen(config.port, () => console.log("Motion Audio server on " + config.publicUrl + " (storage: " + (store.usingR2 ? "R2" : "local folder") + ", payments: " + (pay.stripe ? "on" : "off") + ")"));
