// Creators (10.1): anyone signed in makes (in the studio on the website) or uploads samples, loops, pads, instruments,
// pedal boards and plugins. They go into the yearly sound plans:
//   loops, pads -> Central Pads · samples, instruments -> Central Keys or Central Instrument (the creator picks)
//   plugins -> Central Plugins · pedal boards -> Central Pedals · tracks -> Central Tracks (the publishing flow, as before)
// Every upload is checked by machine (creatorfiles.js), then waits for a review admin on the review site, who listens,
// grades it 1-5 stars and approves or rejects it (with a reason, emailed). Approved items show in the apps under
// "Community", install like library items (a library zip made here) and open with the plan's key.
// The pool: each month, a share of each pack's money (staff set it per pack - 75% to start - with a history of
// changes) is split by downloads x stars. Motion Audio's own library downloads count in the total and keep their part.
// A download counts once per item, per downloader (package key or account), per month.
// Plugins: they're programs, so besides the review there's a revoke list the apps check (a pulled item, or a file
// staff block by its sha256, is taken off every device), the apps keep them off unless "Allow community plugins" is on,
// and they run walled off (see community.js / community_sandbox.py in the apps).
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { q, one, pool } from "./db.js";
import { config, PLANS, PLAN_IDS, STAR_PRICE_CENTS, withPads } from "./config.js";
import { isAdmin, isOwner } from "./auth.js";
import { requireStep, needsCode } from "./signin.js";
import * as store from "./storage.js";
import { gradeAudio } from "./grade.js";
import { sendMail, escHtml } from "./mail.js";
import { findKey, keyState, packageRows } from "./plans.js";
import { defaultKind, defaultKeysOn, demoPlans } from "./defaultkeys.js";
import { writeZip } from "./zipfile.js";
import * as CF from "./creatorfiles.js";
import { libraries } from "./libraries.js";

const here = path.dirname(fileURLToPath(import.meta.url));
function bad(msg, status = 400) { const e = new Error(msg); e.status = status; return e; }
export const DEFAULT_SHARE = 0.75;
export const PACKS = ["keys", "instrument", "plugins", "pedals", "pads"];
const monthOf = (d) => new Date(d || Date.now()).toISOString().slice(0, 7);
const prevMonth = (m, n = 1) => { const [y, mo] = m.split("-").map(Number); return new Date(Date.UTC(y, mo - 1 - n, 1)).toISOString().slice(0, 7); };
const libId = (id) => "community-" + id;

// ---------------------------------------------------------------- settings and roles
export async function settings() {
  const r = await one("SELECT data FROM site_settings WHERE name='creators'").catch(() => null);
  const d = (r && r.data) || {};
  return { holdTracks: d.holdTracks != null ? !!d.holdTracks : process.env.NODE_ENV === "production", officialStars: Math.min(5, Math.max(1, Number(d.officialStars) || 3)), minPayoutCents: Number(d.minPayoutCents) || 1000 };
}
async function saveSettings(patch, who) {
  const cur = await settings(), data = Object.assign({}, cur, patch);
  await q("INSERT INTO site_settings (name,data,updated_by) VALUES ('creators',$1,$2) ON CONFLICT (name) DO UPDATE SET data=EXCLUDED.data, updated_at=now(), updated_by=EXCLUDED.updated_by", [data, who]);
  return data;
}
export async function isReviewer(user) {
  if (!user) return false;
  if (isAdmin(user)) return true;
  if (user.email_confirmed === false) return false;
  return !!(await one("SELECT 1 FROM review_admins WHERE email=$1", [user.email.toLowerCase()]));
}
async function reviewer(req) { if (!(await isReviewer(req.user))) throw bad("Review admins only.", 403); await requireStep(req); }
async function staff(req) { if (!isAdmin(req.user)) throw bad("Only the website's main admin can do that.", 403); await requireStep(req); }
export function reviewPath() {
  if (config.reviewPath && config.reviewPath !== "/") return config.reviewPath;
  return "/review-" + crypto.createHmac("sha256", config.tokenSecret).update("review-site").digest("hex").slice(0, 20);
}

// the creators' share of a pack's money in a month: the newest change that applies by then
export async function shareFor(pack, month) {
  const r = await one("SELECT share FROM creator_share_changes WHERE pack=$1 AND from_month <= $2 ORDER BY from_month DESC, id DESC LIMIT 1", [pack, month]);
  return r ? Number(r.share) : DEFAULT_SHARE;
}

// ---------------------------------------------------------------- the packs' money
// a sound plan payment (Stripe invoice.paid on a plan subscription): kept, then spread over its 12 months
export async function recordPlanPayment(inv, planSubId, plans) {
  if (!inv || !inv.id || !(inv.amount_paid > 0)) return;
  const paidBy = ((inv.payments && inv.payments.data) || []).find((p) => p.payment && p.payment.payment_intent);
  await q("INSERT INTO plan_payments (invoice_id,plan_sub_id,plans,cents,payment_intent,paid_at) VALUES ($1,$2,$3,$4,$5,to_timestamp($6)) ON CONFLICT DO NOTHING",
    [inv.id, planSubId || null, withPads(plans || []), inv.amount_paid, paidBy ? String(paidBy.payment.payment_intent) : (inv.payment_intent ? String(inv.payment_intent) : null), (inv.status_transitions && inv.status_transitions.paid_at) || Math.floor(Date.now() / 1000)]);
}
// a refund or chargeback: the payment stops counting from now (months already shared out stay as they were)
export async function reversePlanPayment(invoiceId) {
  if (invoiceId) await q("UPDATE plan_payments SET reversed=TRUE, reversed_at=COALESCE(reversed_at, now()) WHERE invoice_id=$1", [invoiceId]);
}
// how a payment splits across the packs it pays for: by the plans' own prices (a $70 Central Keys year is keys + pads)
export function splitPayment(cents, plans) {
  const ids = withPads(plans || []).filter((p) => PLAN_IDS.includes(p)), total = ids.reduce((a, p) => a + PLANS[p].cents, 0);
  const out = {}; if (!total) return out;
  ids.forEach((p) => { out[p] = (cents * PLANS[p].cents) / total; });
  return out;
}
// each pack's income in a month (cents, whole): every year's payment counts 1/12 in each of the 12 months from the
// month it was paid
export async function packIncome(month) {
  const start = prevMonth(month, 11) + "-01", endNext = prevMonth(month, -1) + "-01";
  const rows = await q("SELECT cents, plans FROM plan_payments WHERE paid_at >= $1::date AND paid_at < $2::date AND (NOT reversed OR reversed_at >= $2::date)", [start, endNext]);
  const out = Object.fromEntries(PACKS.map((p) => [p, 0]));
  for (const r of rows) { const s = splitPayment(r.cents, r.plans); for (const p of Object.keys(s)) out[p] += s[p] / 12; }
  for (const p of PACKS) out[p] = Math.floor(out[p]);
  return out;
}
// a month's pool for every pack (safe to run twice). Each creator gets pot x (their downloads x stars) / (everyone's,
// Motion Audio's included), rounded down; the leftover cents go to the biggest remainders, never past the creators' part.
export async function sharePacks(month) {
  if (await one("SELECT 1 FROM pack_pools WHERE month=$1 LIMIT 1", [month])) return { month, already: true };
  const income = await packIncome(month), out = [];
  for (const pack of PACKS) {
    const share = await shareFor(pack, month), pot = Math.floor(income[pack] * share);
    const rows = await q("SELECT creator_id, COUNT(*)::int AS downloads, SUM(stars)::int AS weight FROM pack_downloads WHERE month=$1 AND pack=$2 GROUP BY creator_id", [month, pack]);
    const total = rows.reduce((a, r) => a + r.weight, 0), motion = rows.filter((r) => r.creator_id == null).reduce((a, r) => a + r.weight, 0);
    const creators = rows.filter((r) => r.creator_id != null).map((r) => ({ ...r, exact: total ? (pot * r.weight) / total : 0 }));
    creators.forEach((r) => { r.cents = Math.floor(r.exact); });
    let left = Math.floor(total ? (pot * (total - motion)) / total : 0) - creators.reduce((a, r) => a + r.cents, 0);
    creators.slice().sort((a, b) => (b.exact - b.cents) - (a.exact - a.cents)).forEach((r) => { if (left > 0) { r.cents++; left--; } });
    await q("INSERT INTO pack_pools (month,pack,income,share,pot,total_weight,motion_weight) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING", [month, pack, income[pack], share, pot, total, motion]);
    for (const r of creators) await q("INSERT INTO creator_shares (month,pack,creator_id,downloads,weight,cents) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING", [month, pack, r.creator_id, r.downloads, r.weight, r.cents]);
    out.push({ pack, income: income[pack], share, pot, totalWeight: total, motionWeight: motion, creators: creators.map((r) => ({ creator: r.creator_id, downloads: r.downloads, weight: r.weight, cents: r.cents })) });
  }
  return { month, packs: out };
}

// ---------------------------------------------------------------- downloads that count
async function countDownload(item, downloader) {
  if (!downloader) return false;
  const r = await q("INSERT INTO pack_downloads (month,pack,item_ref,creator_id,stars,downloader) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING 1",
    [monthOf(), item.pack, "c" + item.id, item.creator_id, item.stars || 1, downloader]);
  return r.length > 0;
}
// Motion Audio's own library downloaded (the /download/library/<id> link, or the apps' list): counts with the
// official star value, once per downloader a month
export async function countOfficialDownload(lib, downloader) {
  if (!lib || !PACKS.includes(lib.plan) || !downloader) return;
  const s = await settings();
  await q("INSERT INTO pack_downloads (month,pack,item_ref,creator_id,stars,downloader) VALUES ($1,$2,$3,NULL,$4,$5) ON CONFLICT DO NOTHING", [monthOf(), lib.plan, String(lib.id), s.officialStars, downloader]).catch(() => { });
}

// which packs a key or an account opens; and who the downloader is (for counting)
async function access(req, body) {
  const key = String((body && body.key) || "").trim();
  if (key) {
    if (defaultKind(key) === "S") {
      if (!(await defaultKeysOn())) throw bad("This was a temporary key. Get your own on the website.", 403);
      return { packs: demoPlans(key) || PACKS.slice(), downloader: null, how: "default" };   // (default and demo keys: they open, but don't count in the pool)
    }
    const k = await findKey(key), st = keyState(k);
    if (!st.ok) throw bad(st.error, 403);
    return { packs: Object.keys(st.plans), downloader: "key:" + k.key, how: "key" };
  }
  if (req.user) {
    if (await isReviewer(req.user)) return { packs: PACKS.slice(), downloader: null, how: "staff" };
    const rows = await packageRows(req.user.email, req.user.id), packs = new Set();
    for (const r of rows) { const st = keyState(r); if (st.ok) Object.keys(st.plans).forEach((p) => packs.add(p)); }
    return { packs: [...packs], downloader: "user:" + req.user.id, how: "account" };
  }
  throw bad("Sign in, or send the package key that opens this plan.", 401);
}

// ---------------------------------------------------------------- shaping items for the pages and the apps
const PUBLIC_STATUS = ["live"];
async function filesOf(id, role) { return q("SELECT * FROM community_files WHERE item_id=$1" + (role ? " AND role=$2" : "") + " ORDER BY id", role ? [id, role] : [id]); }
async function itemOut(r, opts = {}) {
  const files = await filesOf(r.id);
  const demo = files.find((f) => f.role === "demo"), pkgs = files.filter((f) => f.role === "package");
  const o = {
    id: r.id, libraryId: libId(r.id), kind: r.kind, kindName: (CF.KINDS[r.kind] || {}).name || r.kind, pack: r.pack, packName: (PLANS[r.pack] || {}).name || r.pack,
    title: r.title, description: r.description, tags: r.tags || [], key: r.song_key || "", bpm: Number(r.bpm) || 0, bars: r.bars || 0, stars: r.stars || null,
    creator: r.creator_name || "", status: r.status, version: r.version, madeInStudio: !!r.made_in_studio, downloads: Number(r.downloads) || 0, created: r.created_at,
    label: r.kind === "plugin" ? "Community plugin - made by " + (r.creator_name || "a creator") + ", checked by Motion Audio" : "Community - made by " + (r.creator_name || "a creator"),
    demo: demo ? await store.downloadUrl(demo.storage_key, demo.name) : null,
    packages: Object.fromEntries(pkgs.map((f) => [f.platform || "all", { size: Number(f.bytes), sha256: f.sha256 }])),
  };
  if (opts.private) Object.assign(o, { reason: r.reason, checks: r.checks, autoStars: r.auto_stars, submitted: r.submitted_at, reviewed: r.reviewed_at, reviewedBy: opts.staff ? r.reviewed_by : undefined });
  if (opts.staff) {
    o.creatorEmail = r.creator_email; o.creatorId = r.creator_id;
    o.files = await Promise.all(files.map(async (f) => ({ id: f.id, role: f.role, platform: f.platform, name: f.name, bytes: Number(f.bytes), sha256: f.sha256, binaries: f.binaries, url: await store.downloadUrl(f.storage_key, f.name) })));
    o.reports = await q("SELECT reporter, reason, device, created_at FROM community_reports WHERE item_id=$1 ORDER BY created_at DESC LIMIT 20", [r.id]);
  }
  return o;
}
const ITEM_SQL = `SELECT i.*, u.name AS creator_name, u.email AS creator_email,
  (SELECT COUNT(*) FROM pack_downloads d WHERE d.item_ref='c' || i.id)::int AS downloads FROM community_items i JOIN users u ON u.id=i.creator_id`;

// ---------------------------------------------------------------- building the library zip the apps install
const safeFile = (s, d) => String(s || d).replace(/[^\w.\- ]+/g, "").trim().slice(0, 80) || d;
async function readStored(key) { const tmp = await store.fetchToTemp(key); try { return fs.readFileSync(tmp); } finally { fs.rm(path.dirname(tmp), { recursive: true, force: true }, () => { }); } }
function manifest(item, items) {
  return { format: 1, id: libId(item.id), plan: item.pack, version: String(item.version), title: item.title.slice(0, 80), summary: (item.description || "").slice(0, 380),
    community: { item: item.id, creator: item.creator_name || "", kind: item.kind }, items };
}
// checks every uploaded file and builds the package(s); answers { checks, packages: [{ platform, data }], binaries }
async function build(item, files, blocked) {
  const src = files.filter((f) => f.role === "source");
  if (!src.length) throw bad("Upload " + (CF.KINDS[item.kind] || {}).what + " first.");
  const read = async (f) => ({ name: f.name, data: await readStored(f.storage_key), platform: f.platform, row: f });
  const checks = [], packages = [];
  const zipOf = (items, extra) => { const man = manifest(item, items.map((x) => x.entry)); return writeZip([{ name: "manifest.json", data: JSON.stringify(man, null, 1) }, ...items.map((x) => ({ name: x.entry.file, data: x.data })), ...(extra || [])]); };
  const entry = (kind, file, data, more) => ({ entry: Object.assign({ kind, file, sha256: CF.sha256(data), license: "Community" }, more || {}), data });
  if (item.kind === "sample" || item.kind === "instrument") {
    const f = await read(src[0]), r = CF.buildSound(f.name, f.data, item.title);
    checks.push(...r.checks);
    packages.push({ platform: "", data: zipOf([entry("sound", safeFile(item.title, "Sound") + " - " + libId(item.id) + ".sf2", r.sf2, { name: item.title })]) });
  } else if (item.kind === "loop") {
    const all = await Promise.all(src.map(read)), r = CF.buildLoops(all, { bpm: Number(item.bpm) || 0, key: item.song_key });
    checks.push(...r.checks);
    const set = safeFile(item.title, "loops").replace(/\s+/g, "-");
    packages.push({ platform: "", data: zipOf(r.loops.map((l, i) => entry("loop", "loops/" + String(i + 1).padStart(2, "0") + "-" + safeFile(l.name, "loop.wav"), l.data,
      Object.assign({ name: r.loops.length > 1 ? item.title + " " + (i + 1) : item.title, set, group: "Community" }, Number(item.bpm) ? { bpm: Number(item.bpm) } : {}, item.bars ? { bars: item.bars } : {}, CF.KEYS.includes(item.song_key) ? { key: item.song_key } : {}, { seconds: l.seconds })))) });
  } else if (item.kind === "pad") {
    const f = await read(src[0]), r = CF.buildPad(f.name, f.data);
    checks.push(...r.checks);
    packages.push({ platform: "", data: zipOf(CF.KEYS.map((k) => entry("pad", "pads/" + k.replace("#", "s") + ".wav", r.keys[k].data, { key: k, name: item.title }))) });
  } else if (item.kind === "board") {
    const f = await read(src[0]), r = CF.buildBoard(f.data);
    checks.push(...r.checks);
    const b = Object.assign({}, r.board, { name: item.title.slice(0, 60) });
    packages.push({ platform: "", data: zipOf([entry("board", "board.json", Buffer.from(JSON.stringify(b)), { name: b.name })]) });
  } else if (item.kind === "plugin") {
    const seen = new Set();
    for (const f0 of src) {
      if (seen.has(f0.platform)) throw bad("Upload one zip per platform (two for " + f0.platform + ").");
      seen.add(f0.platform);
      const f = await read(f0), r = CF.checkPlugin(f.platform, f.name, f.data, blocked);
      checks.push(...r.checks.map((c) => ({ ok: c.ok, text: CF.PLATFORMS[f.platform] + ": " + c.text })));
      packages.push({ platform: f.platform, binaries: r.binaries, data: zipOf([entry("plugin", "plugin/" + r.bundle + ".zip", f.data, { name: item.title, platform: f.platform, format: r.format, bundle: r.bundle, binaries: r.binaries })]) });
    }
  } else throw bad("Unknown kind.");
  return { checks, packages };
}

// ---------------------------------------------------------------- emails
async function tellCreator(item, subject, text) {
  const u = await one("SELECT email, name FROM users WHERE id=$1", [item.creator_id]);
  if (!u) return;
  await sendMail(u.email, subject, "Hi " + (u.name || "there") + ",\n\n" + text + "\n\nYour items and earnings: " + config.publicUrl + "/create/\n\nThe Motion Audio team\n",
    "<p>Hi " + escHtml(u.name || "there") + ",</p><p>" + escHtml(text).replace(/\n/g, "<br>") + '</p><p><a href="' + escHtml(config.publicUrl) + '/create/">Your items and earnings</a></p><p>The Motion Audio team</p>').catch(() => { });
}

// ---------------------------------------------------------------- routes
export function routes(api, app, { wrap, requireUser }) {
  const num = (v) => Number(v) || 0;
  const mine = async (req) => { const r = await one(ITEM_SQL + " WHERE i.id=$1 AND i.creator_id=$2 AND i.status<>'removed'", [num(req.params.id), req.user.id]); if (!r) throw bad("That isn't one of your items.", 404); return r; };

  // ---- what creators can make, for the upload page
  api.get("/creator/kinds", (_req, res) => res.json({ kinds: Object.entries(CF.KINDS).map(([id, k]) => ({ id, name: k.name, packs: k.packs.map((p) => ({ id: p, name: PLANS[p].name })), what: k.what, maxBytes: k.max })), platforms: CF.PLATFORMS, keys: CF.KEYS, share: DEFAULT_SHARE }));

  // ---- start an item: { kind, pack, title, description, tags, key, bpm, bars, rights, studio }
  api.post("/creator/items", requireUser, wrap(async (req, res) => {
    const b = req.body || {}, k = CF.KINDS[b.kind];
    if (!k) throw bad("Pick what you're uploading: samples, an instrument, loops, a pad, a pedal board or a plugin.");
    const pack = k.packs.length === 1 ? k.packs[0] : String(b.pack || "");
    if (!k.packs.includes(pack)) throw bad("Pick the sound plan it goes in: " + k.packs.map((p) => PLANS[p].name).join(" or ") + ".");
    const title = String(b.title || "").trim().slice(0, 80); if (!title) throw bad("Give it a name.");
    if (b.rights !== true) throw bad("Confirm that you made it, or have the rights to share and sell it.");
    if (req.user.email_confirmed === false) throw bad("Confirm your email first (we sent you a link), then upload.", 403);
    const key = b.key ? (CF.keyName(b.key) || "") : "";
    const n = await one("SELECT COUNT(*)::int AS n FROM community_items WHERE creator_id=$1 AND status='uploading'", [req.user.id]);
    if (n.n >= 20) throw bad("You have 20 unfinished uploads. Finish or delete some first.", 429);
    const r = await one(`INSERT INTO community_items (creator_id,kind,pack,title,description,tags,song_key,bpm,bars,rights_ok,made_in_studio) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE,$10) RETURNING *`,
      [req.user.id, b.kind, pack, title, String(b.description || "").trim().slice(0, 1000), (Array.isArray(b.tags) ? b.tags : String(b.tags || "").split(",")).map((t) => String(t).trim().toLowerCase().slice(0, 24)).filter(Boolean).slice(0, 10),
        key, Math.max(0, Math.min(400, Number(b.bpm) || 0)), Math.max(0, Math.min(64, Math.round(Number(b.bars) || 0))), !!b.studio]);
    res.json({ item: await itemOut(Object.assign(r, { creator_name: req.user.name }), { private: true }) });
  }));
  // ---- an upload link for one file: { role: source|demo, platform?, name, size, type }
  api.post("/creator/items/:id/upload", requireUser, wrap(async (req, res) => {
    const it = await mine(req), b = req.body || {}, k = CF.KINDS[it.kind];
    if (it.status !== "uploading" && it.status !== "rejected") throw bad("This item was already sent for review. Make a new one to change it.");
    const role = b.role === "demo" ? "demo" : "source", name = String(b.name || "file").slice(0, 160), size = Number(b.size) || 0;
    if (role === "demo" && size > 60 * 1024 ** 2) throw bad("A demo clip can be up to 60 MB.");
    if (role === "source" && size > k.max) throw bad("That's too big for a " + k.name.toLowerCase() + " (up to " + Math.round(k.max / 1024 ** 2) + " MB).");
    const platform = it.kind === "plugin" && role === "source" ? String(b.platform || "") : "";
    if (it.kind === "plugin" && role === "source" && !CF.PLATFORMS[platform]) throw bad("Pick the platform this plugin zip is for.");
    if (role === "demo") await q("DELETE FROM community_files WHERE item_id=$1 AND role='demo'", [it.id]);
    if (role === "source" && it.kind === "plugin") await q("DELETE FROM community_files WHERE item_id=$1 AND role='source' AND platform=$2", [it.id, platform]);
    else if (role === "source" && (it.kind !== "loop" || b.replace)) await q("DELETE FROM community_files WHERE item_id=$1 AND role='source'", [it.id]);   // (loops: several files; the first of a new set replaces the old ones)
    const key = "community/" + it.id + "/src/" + Date.now().toString(36) + "-" + crypto.randomBytes(5).toString("hex") + path.extname(name).toLowerCase().replace(/[^.a-z0-9]/g, "").slice(0, 8);
    await q("INSERT INTO community_files (item_id,role,platform,name,storage_key,bytes) VALUES ($1,$2,$3,$4,$5,$6)", [it.id, role, platform, name, key, size]);
    res.json({ key, url: await store.uploadUrl(key, b.type) });
  }));
  // ---- send it for review: the machine checks and builds it now; a problem comes back here, plainly
  api.post("/creator/items/:id/submit", requireUser, wrap(async (req, res) => {
    const it = await mine(req);
    if (it.status !== "uploading" && it.status !== "rejected") throw bad("This item is already " + (it.status === "waiting" ? "waiting for review." : it.status + "."));
    const files = await filesOf(it.id);
    for (const f of files) if (f.role !== "package" && !(await store.exists(f.storage_key))) throw bad(f.name + " didn't finish uploading. Upload it again.");
    const needsDemo = !["plugin", "board"].includes(it.kind);
    const demo = files.find((f) => f.role === "demo");
    if (needsDemo && !demo) throw bad("Add a short demo clip (MP3 or WAV, up to 2 minutes): it's what people hear before they download, and what the reviewer listens to.");
    const blocked = new Set((await q("SELECT sha256 FROM blocked_hashes")).map((r) => r.sha256));
    let built, auto = null;
    try { built = await build(Object.assign({}, it), files, blocked); }
    catch (e) { await q("UPDATE community_items SET checks=$1 WHERE id=$2", [JSON.stringify([{ ok: false, text: e.message }]), it.id]); throw bad(e.message); }
    for (const f of files.filter((x) => x.role === "source")) { const d = await readStored(f.storage_key), h = CF.sha256(d); if (blocked.has(h)) throw bad("That file is on our list of known harmful files."); await q("UPDATE community_files SET sha256=$1, bytes=$2 WHERE id=$3", [h, d.length, f.id]); }
    if (demo) {
      const tmp = await store.fetchToTemp(demo.storage_key);
      try { const g = await gradeAudio(tmp); if (g.info.duration > 125) throw bad("Keep the demo clip under 2 minutes."); auto = g.stars; built.checks.push(...g.checks.map((c) => ({ ok: c.ok, text: "Demo: " + c.text }))); }
      catch (e) { if (e.status) throw e; throw bad("The demo clip isn't audio we can read (" + e.message + "). Upload an MP3 or WAV."); }
      finally { fs.rm(path.dirname(tmp), { recursive: true, force: true }, () => { }); }
    }
    await q("DELETE FROM community_files WHERE item_id=$1 AND role='package'", [it.id]);
    for (const p of built.packages) {
      const key = "community/" + it.id + "/v" + it.version + "/" + (p.platform || "all") + ".zip";
      await store.putFile(key, p.data, "application/zip");
      await q("INSERT INTO community_files (item_id,role,platform,name,storage_key,bytes,sha256,binaries) VALUES ($1,'package',$2,$3,$4,$5,$6,$7)",
        [it.id, p.platform || "", libId(it.id) + (p.platform ? "-" + p.platform : "") + ".zip", key, p.data.length, CF.sha256(p.data), JSON.stringify(p.binaries || [])]);
    }
    const r = await one("UPDATE community_items SET status='waiting', checks=$1, auto_stars=$2, submitted_at=now(), reason=NULL WHERE id=$3 RETURNING *", [JSON.stringify(built.checks), auto, it.id]);
    res.json({ item: await itemOut(Object.assign(r, { creator_name: req.user.name }), { private: true }) });
  }));
  api.post("/creator/items/:id/remove", requireUser, wrap(async (req, res) => {
    const it = await mine(req);
    await q("UPDATE community_items SET status='removed', reason='Removed by its creator.' WHERE id=$1", [it.id]);
    res.json({ ok: true });
  }));
  // ---- the creator's page: items, this month's downloads, earnings, statements
  api.get("/creator", requireUser, wrap(async (req, res) => {
    const uid = req.user.id;
    const items = await q(ITEM_SQL + " WHERE i.creator_id=$1 AND i.status<>'removed' ORDER BY i.created_at DESC", [uid]);
    const month = monthOf();
    const thisMonth = await q("SELECT pack, COUNT(*)::int AS downloads, SUM(stars)::int AS weight FROM pack_downloads WHERE month=$1 AND creator_id=$2 GROUP BY pack", [month, uid]);
    const sum = await one("SELECT COALESCE(SUM(cents) FILTER (WHERE transfer_id IS NULL),0)::int AS unpaid, COALESCE(SUM(cents) FILTER (WHERE transfer_id IS NOT NULL),0)::int AS paid FROM creator_shares WHERE creator_id=$1", [uid]);
    const statements = await q(`SELECT s.month, s.pack, s.downloads, s.weight, s.cents, s.transfer_id IS NOT NULL AS paid, p.income, p.share, p.pot, p.total_weight
      FROM creator_shares s JOIN pack_pools p ON p.month=s.month AND p.pack=s.pack WHERE s.creator_id=$1 ORDER BY s.month DESC, s.pack LIMIT 120`, [uid]);
    const shares = {}; for (const p of PACKS) shares[p] = await shareFor(p, month);
    const st = await settings();
    res.json({ items: await Promise.all(items.map((r) => itemOut(r, { private: true }))), month, thisMonth, shares, minPayout: st.minPayoutCents / 100,
      unpaid: sum.unpaid / 100, paid: sum.paid / 100, payoutsReady: !!req.user.connect_ready,
      statements: statements.map((s) => ({ month: s.month, pack: s.pack, packName: PLANS[s.pack].name, downloads: s.downloads, weight: s.weight, totalWeight: s.total_weight, income: s.income / 100, share: Number(s.share), pot: s.pot / 100, earned: s.cents / 100, paid: s.paid })) });
  }));

  // ---- the community list (the website's pages and the apps): live items only
  api.get("/community", wrap(async (req, res) => {
    const where = ["i.status='live'"], params = [];
    const add = (sql, v) => { params.push(v); where.push(sql.replace("?", "$" + params.length)); };
    if (PACKS.includes(req.query.pack)) add("i.pack=?", req.query.pack);
    if (CF.KINDS[req.query.kind]) add("i.kind=?", req.query.kind);
    if (req.query.q) add("(i.title ILIKE ? OR array_to_string(i.tags,' ') ILIKE $" + (params.length + 1) + " OR u.name ILIKE $" + (params.length + 1) + ")", "%" + String(req.query.q).slice(0, 60) + "%");
    const order = req.query.sort === "new" ? "i.reviewed_at DESC NULLS LAST" : "downloads DESC, i.stars DESC, i.reviewed_at DESC";
    const rows = await q(ITEM_SQL + " WHERE " + where.join(" AND ") + " ORDER BY " + order + " LIMIT 200", params);
    res.json({ items: await Promise.all(rows.map((r) => itemOut(r))) });
  }));
  api.get("/community/revoked", wrap(async (_req, res) => {   // (the apps check this: anything here comes off every device)
    const items = await q("SELECT id, kind, status, reason FROM community_items WHERE status='pulled' OR (status='removed' AND stars IS NOT NULL) ORDER BY id");
    const hashes = (await q("SELECT sha256 FROM blocked_hashes ORDER BY added_at")).map((r) => r.sha256);
    res.set("Cache-Control", "max-age=300");
    res.json({ checked: new Date().toISOString(), items: items.map((r) => ({ id: r.id, libraryId: libId(r.id), kind: r.kind, status: r.status, reason: r.reason || "" })), hashes });
  }));
  api.get("/community/:id", wrap(async (req, res) => {
    const r = await one(ITEM_SQL + " WHERE i.id=$1", [num(req.params.id)]);
    if (!r || (!PUBLIC_STATUS.includes(r.status) && !(req.user && (r.creator_id === req.user.id || (await isReviewer(req.user)))))) throw bad("That item isn't available.", 404);
    res.json({ item: await itemOut(r, { private: !!(req.user && r.creator_id === req.user.id) }) });
  }));
  // ---- a download: { key?, platform?, deviceId? } (the apps send the plan's package key; the website, the account)
  api.post("/community/:id/download", wrap(async (req, res) => {
    const r = await one(ITEM_SQL + " WHERE i.id=$1", [num(req.params.id)]);
    if (!r) throw bad("That item isn't available.", 404);
    const a = await access(req, req.body || {});
    const live = r.status === "live";
    if (!live && a.how !== "staff") throw bad(r.status === "pulled" ? "This item was taken down" + (r.reason ? ": " + r.reason : ".") : "That item isn't available.", 410);
    if (!a.packs.includes(r.pack)) throw bad("This is part of " + PLANS[r.pack].name + ". Add that plan's package key (Settings → Packages) to download it.", 403);
    const pkgs = (await filesOf(r.id, "package"));
    let p = null;
    if (r.kind === "plugin") {
      const platform = String((req.body || {}).platform || "");
      p = pkgs.find((f) => f.platform === platform);
      if (!p) throw bad("This plugin isn't made for " + (CF.PLATFORMS[platform] || "this device") + " (it's for " + pkgs.map((f) => CF.PLATFORMS[f.platform]).join(", ") + ").", 404);
    } else p = pkgs[0];
    if (!p) throw bad("This item isn't ready to download.", 404);
    const counted = live && a.downloader ? await countDownload(r, a.downloader) : false;
    res.json({ id: libId(r.id), item: r.id, version: String(r.version), url: await store.downloadUrl(p.storage_key, p.name), sha256: p.sha256, size: Number(p.bytes), counted,
      label: r.kind === "plugin" ? "Community plugin - made by " + (r.creator_name || "a creator") + ", checked by Motion Audio" : "Community - made by " + (r.creator_name || "a creator") });
  }));
  // ---- Motion Audio's own library installed by an app (with the plan's key): counts in the pool total, once a month
  api.post("/libraries/:id/installed", wrap(async (req, res) => {
    const l = ((await libraries()).libraries || []).find((x) => x.id === String(req.params.id || ""));
    if (!l) throw bad("We couldn't find that sound library.", 404);
    const a = await access(req, req.body || {});
    if (!a.packs.includes(l.plan)) throw bad("This library is part of " + PLANS[l.plan].name + ".", 403);
    if (a.downloader) await countOfficialDownload(l, a.downloader);
    res.json({ ok: true, counted: !!a.downloader });
  }));
  api.post("/community/:id/report", wrap(async (req, res) => {
    const r = await one("SELECT id FROM community_items WHERE id=$1", [num(req.params.id)]);
    if (!r) throw bad("That item isn't available.", 404);
    const reason = String((req.body || {}).reason || "").trim().slice(0, 2000); if (!reason) throw bad("Say what's wrong with it.");
    await q("INSERT INTO community_reports (item_id,reporter,reason,device) VALUES ($1,$2,$3,$4)", [r.id, req.user ? req.user.email : String((req.body || {}).email || "an app").slice(0, 200), reason, String((req.body || {}).device || "").slice(0, 80)]);
    res.json({ ok: true });
  }));

  // ---------------------------------------------------------------- the review site (staff)
  api.get("/review/me", wrap(async (req, res) => {
    const rev = await isReviewer(req.user);
    res.json({ signedIn: !!req.user, reviewer: rev, owner: isAdmin(req.user), email: req.user ? req.user.email : null, stepped: !!req.stepped || (rev && !(await needsCode(req.user))) });   // (no code step on a server without email or texts)
  }));
  api.get("/review/link", requireUser, wrap(async (req, res) => { await reviewer(req); res.json({ url: config.publicUrl + reviewPath() + "/" }); }));
  api.get("/review/queue", requireUser, wrap(async (req, res) => {
    await reviewer(req);
    const status = ["waiting", "live", "rejected", "pulled"].includes(req.query.status) ? req.query.status : "waiting";
    const items = await q(ITEM_SQL + " WHERE i.status=$1 ORDER BY " + (status === "waiting" ? "i.kind='plugin' DESC, i.submitted_at" : "i.reviewed_at DESC NULLS LAST") + " LIMIT 200", [status]);
    const tracks = await q(`SELECT t.*, u.email AS publisher_email, u.name AS publisher_name FROM tracks t JOIN users u ON u.id=t.publisher_id WHERE t.status=$1 ORDER BY t.created_at DESC LIMIT 200`,
      [status === "waiting" ? "review" : status === "pulled" ? "hidden" : status === "rejected" ? "removed" : "live"]);
    const trackFiles = async (t) => Promise.all((await q("SELECT * FROM track_files WHERE track_id=$1 ORDER BY is_mix DESC, id", [t.id])).map(async (f) => ({ name: f.name, role: f.role, mix: f.is_mix, url: await store.downloadUrl(f.storage_key, f.name) })));
    const counts = await one(`SELECT (SELECT COUNT(*) FROM community_items WHERE status='waiting')::int AS items, (SELECT COUNT(*) FROM tracks WHERE status='review')::int AS tracks,
      (SELECT COUNT(*) FROM community_reports WHERE created_at > now() - interval '30 days')::int AS reports`);
    res.json({ status, counts, items: await Promise.all(items.map((r) => itemOut(r, { private: true, staff: true }))),
      tracks: await Promise.all(tracks.map(async (t) => ({ id: t.id, title: t.title, artist: t.artist, kind: t.kind, key: t.song_key, bpm: Number(t.bpm), stars: t.stars, price: t.price_cents / 100, grade: t.grade_report, status: t.status,
        publisher: t.publisher_name, publisherEmail: t.publisher_email, created: t.created_at, note: t.review_note, files: await trackFiles(t) }))) });
  }));
  const stars = (v) => { const s = Math.round(Number(v)); if (!(s >= 1 && s <= 5)) throw bad("Give it 1 to 5 stars."); return s; };
  const reasonOf = (b) => { const r = String((b || {}).reason || "").trim().slice(0, 1000); if (!r) throw bad("Say why, so the creator knows what to fix."); return r; };
  const reviewedItem = async (req) => { const r = await one(ITEM_SQL + " WHERE i.id=$1", [num(req.params.id)]); if (!r) throw bad("No such item.", 404); return r; };
  api.post("/review/items/:id/approve", requireUser, wrap(async (req, res) => {
    await reviewer(req); const it = await reviewedItem(req), s = stars(req.body && req.body.stars);
    if (!["waiting", "pulled", "rejected"].includes(it.status)) throw bad("It's already " + it.status + ".");
    if (!(await one("SELECT 1 FROM community_files WHERE item_id=$1 AND role='package'", [it.id]))) throw bad("It has no package to install (the creator hasn't sent it in).");
    await q("UPDATE community_items SET status='live', stars=$1, reason=NULL, reviewed_by=$2, reviewed_at=now() WHERE id=$3", [s, req.user.email, it.id]);
    await tellCreator(it, "“" + it.title + "” is live", "“" + it.title + "” passed review with " + s + " star" + (s === 1 ? "" : "s") + ". It's now part of " + PLANS[it.pack].name + ": everyone with that plan can download it, and each download counts toward your share of the plan's money.");
    res.json({ ok: true });
  }));
  api.post("/review/items/:id/reject", requireUser, wrap(async (req, res) => {
    await reviewer(req); const it = await reviewedItem(req), reason = reasonOf(req.body);
    if (it.status !== "waiting") throw bad("Only something waiting for review can be rejected (pull a live one instead).");
    await q("UPDATE community_items SET status='rejected', reason=$1, reviewed_by=$2, reviewed_at=now() WHERE id=$3", [reason, req.user.email, it.id]);
    await tellCreator(it, "“" + it.title + "” needs changes", "We couldn't accept “" + it.title + "” yet. The reviewer said:\n\n" + reason + "\n\nFix it and send it in again from your creator page.");
    res.json({ ok: true });
  }));
  api.post("/review/items/:id/pull", requireUser, wrap(async (req, res) => {
    await reviewer(req); const it = await reviewedItem(req), reason = reasonOf(req.body);
    if (it.status !== "live") throw bad("Only a live item can be pulled.");
    await q("UPDATE community_items SET status='pulled', reason=$1, reviewed_by=$2, reviewed_at=now() WHERE id=$3", [reason, req.user.email, it.id]);
    if (req.body && req.body.block) for (const f of await filesOf(it.id, "package")) for (const b of f.binaries || []) await q("INSERT INTO blocked_hashes (sha256,why,added_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [b.sha256, "pulled item " + it.id + ": " + reason, req.user.email]);
    await tellCreator(it, "“" + it.title + "” was taken down", "We took “" + it.title + "” down, so it's no longer in " + PLANS[it.pack].name + " and comes off the devices it was installed on. The reason:\n\n" + reason);
    res.json({ ok: true });
  }));
  api.post("/review/items/:id/stars", requireUser, wrap(async (req, res) => {
    await reviewer(req); const it = await reviewedItem(req), s = stars(req.body && req.body.stars);
    await q("UPDATE community_items SET stars=$1, reviewed_by=$2, reviewed_at=now() WHERE id=$3", [s, req.user.email, it.id]);
    res.json({ ok: true });
  }));
  // Central Tracks: approve (with stars: they set the price), reject, change stars, take down
  const reviewedTrack = async (req) => { const t = await one("SELECT t.*, u.email AS publisher_email FROM tracks t JOIN users u ON u.id=t.publisher_id WHERE t.id=$1", [num(req.params.id)]); if (!t) throw bad("No such track.", 404); return t; };
  const tellPublisher = (t, subject, text) => tellCreator({ creator_id: t.publisher_id }, subject, text);
  api.post("/review/tracks/:id/approve", requireUser, wrap(async (req, res) => {
    await reviewer(req); const t = await reviewedTrack(req), s = stars(req.body && req.body.stars);
    await q("UPDATE tracks SET status='live', stars=$1, price_cents=$2, reviewed_by=$3, reviewed_at=now(), review_note=NULL WHERE id=$4", [s, STAR_PRICE_CENTS[s], req.user.email, t.id]);
    if (t.status === "review") await tellPublisher(t, "“" + t.title + "” is live on Central Tracks", "“" + t.title + "” passed review with " + s + " star" + (s === 1 ? "" : "s") + " ($" + STAR_PRICE_CENTS[s] / 100 + ").");
    res.json({ ok: true });
  }));
  api.post("/review/tracks/:id/stars", requireUser, wrap(async (req, res) => {
    await reviewer(req); const t = await reviewedTrack(req), s = stars(req.body && req.body.stars);
    await q("UPDATE tracks SET stars=$1, price_cents=$2, reviewed_by=$3, reviewed_at=now() WHERE id=$4", [s, STAR_PRICE_CENTS[s], req.user.email, t.id]);
    res.json({ ok: true });
  }));
  api.post("/review/tracks/:id/reject", requireUser, wrap(async (req, res) => {
    await reviewer(req); const t = await reviewedTrack(req), reason = reasonOf(req.body);
    await q("UPDATE tracks SET status=$1, review_note=$2, reviewed_by=$3, reviewed_at=now() WHERE id=$4", [t.status === "review" ? "removed" : "hidden", reason, req.user.email, t.id]);
    await tellPublisher(t, "“" + t.title + "” " + (t.status === "review" ? "needs changes" : "was taken down"), (t.status === "review" ? "We couldn't put “" + t.title + "” on Central Tracks yet." : "We took “" + t.title + "” off Central Tracks.") + " The reviewer said:\n\n" + reason);
    res.json({ ok: true });
  }));
  api.get("/review/reports", requireUser, wrap(async (req, res) => {
    await reviewer(req);
    res.json({ reports: await q("SELECT r.*, i.title, i.kind, i.status FROM community_reports r JOIN community_items i ON i.id=r.item_id ORDER BY r.created_at DESC LIMIT 200") });
  }));

  // ---- the main admin only: review admins, the creators' share, settings, blocked files
  api.get("/review/admins", requireUser, wrap(async (req, res) => { await staff(req); res.json({ admins: await q("SELECT email, added_by, added_at FROM review_admins ORDER BY added_at"), staff: config.adminEmails.concat(config.ownerEmails) }); }));
  api.post("/review/admins", requireUser, wrap(async (req, res) => {
    await staff(req);
    const email = String((req.body || {}).email || "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad("Type their account's email.");
    if ((req.body || {}).remove) await q("DELETE FROM review_admins WHERE email=$1", [email]);
    else await q("INSERT INTO review_admins (email,added_by) VALUES ($1,$2) ON CONFLICT DO NOTHING", [email, req.user.email]);
    res.json({ admins: await q("SELECT email, added_by, added_at FROM review_admins ORDER BY added_at") });
  }));
  const shareView = async () => {
    const month = monthOf(), now = {}, next = {};
    for (const p of PACKS) { now[p] = await shareFor(p, month); next[p] = await shareFor(p, prevMonth(month, -1)); }
    return { month, current: now, nextMonth: next, packs: PACKS.map((p) => ({ id: p, name: PLANS[p].name })),
      history: await q("SELECT pack, share, from_month, note, changed_by, changed_at FROM creator_share_changes ORDER BY changed_at DESC LIMIT 100"), settings: await settings() };
  };
  api.get("/review/share", requireUser, wrap(async (req, res) => { await staff(req); res.json(await shareView()); }));
  // { pack, percent, fromMonth ('YYYY-MM', this month or later), note }
  api.post("/review/share", requireUser, wrap(async (req, res) => {
    await staff(req); const b = req.body || {};
    const packs = b.pack === "all" ? PACKS : PACKS.includes(b.pack) ? [b.pack] : null; if (!packs) throw bad("Pick a sound plan (or all of them).");
    const pct = Number(b.percent); if (!(pct >= 0 && pct <= 100)) throw bad("The share is a percentage from 0 to 100.");
    const from = /^\d{4}-\d{2}$/.test(String(b.fromMonth || "")) ? String(b.fromMonth) : monthOf();
    if (from < monthOf()) throw bad("A change can start this month or later (months already worked out stay as they were).");
    for (const p of packs) await q("INSERT INTO creator_share_changes (pack,share,from_month,note,changed_by) VALUES ($1,$2,$3,$4,$5)", [p, Math.round(pct * 100) / 10000, from, String(b.note || "").slice(0, 300), req.user.email]);
    res.json(await shareView());
  }));
  api.post("/review/settings", requireUser, wrap(async (req, res) => {
    await staff(req); const b = req.body || {}, patch = {};
    if (b.holdTracks != null) patch.holdTracks = !!b.holdTracks;
    if (b.officialStars != null) patch.officialStars = Math.min(5, Math.max(1, Math.round(Number(b.officialStars) || 3)));
    if (b.minPayout != null) patch.minPayoutCents = Math.max(100, Math.round(Number(b.minPayout) * 100) || 1000);
    res.json({ settings: await saveSettings(patch, req.user.email) });
  }));
  api.get("/review/blocked", requireUser, wrap(async (req, res) => { await reviewer(req); res.json({ hashes: await q("SELECT * FROM blocked_hashes ORDER BY added_at DESC LIMIT 500") }); }));
  api.post("/review/blocked", requireUser, wrap(async (req, res) => {
    await reviewer(req); const h = String((req.body || {}).sha256 || "").trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(h)) throw bad("A sha256 is 64 letters and digits.");
    if ((req.body || {}).remove) { await staff(req); await q("DELETE FROM blocked_hashes WHERE sha256=$1", [h]); }
    else await q("INSERT INTO blocked_hashes (sha256,why,added_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [h, String((req.body || {}).why || "").slice(0, 300), req.user.email]);
    res.json({ ok: true });
  }));
  api.get("/review/pools", requireUser, wrap(async (req, res) => {
    await staff(req);
    res.json({ pools: await q("SELECT * FROM pack_pools ORDER BY month DESC, pack LIMIT 120"), income: await packIncome(monthOf()) });
  }));

  // ---- the review site itself: its own address, only staff have the link; never indexed, never cached
  const page = path.join(here, "..", "review", "index.html");
  const serve = (req, res) => {
    res.set({ "X-Robots-Tag": "noindex, nofollow", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY" });
    res.type("html").send(fs.readFileSync(page, "utf8"));
  };
  app.get(reviewPath(), (req, res) => (req.originalUrl.split("?")[0].endsWith("/") ? serve(req, res) : res.redirect(302, reviewPath() + "/")));   // (Express matches it with or without the slash)
}
