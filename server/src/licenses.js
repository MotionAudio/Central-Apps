// License keys and church accounts.
// A key is 16 characters: its kind (P = Central Pedal / Central Pedal Control, A = Central Control for admins,
// U = Central Usage for users) and 15 random letters and digits (no 0/O, 1/I/L look-alikes), shown in fours:
// P7K3-9QXM-2HDA-VW8F. It works on one device at a time: the app activates it with its device id, checks it
// again every 30 days, and Release (in the app's settings, or on the website) frees it for another device.
// A church (or production) owns the keys it bought. The main user makes it; admins and users join with its codes.
import crypto from "node:crypto";
import { q, one, pool } from "./db.js";
import { KEY_KINDS, LICENSE_RECHECK_DAYS } from "./config.js";
import { isAdmin } from "./auth.js";

const ABC = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";   // 31 signs: no I, L, O, 0, 1
const APP_KIND = { pedal: "P", "pedal-control": "P", control: "A", usage: "U" };
const APP_NAME = { pedal: "Central Pedal", "pedal-control": "Central Pedal Control", control: "Central Control", usage: "Central Usage" };

export function newKey(kind) {
  let s = kind;
  for (let i = 0; i < 15; i++) s += ABC[crypto.randomInt(ABC.length)];
  return s;
}
export function canon(k) { return String(k || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }
export function pretty(k) { const c = canon(k); return c.length === 16 ? c.match(/.{4}/g).join("-") : String(k); }
function code() { let s = ""; for (let i = 0; i < 8; i++) s += ABC[crypto.randomInt(ABC.length)]; return s; }
function bad(msg, status = 400, extra) { const e = new Error(msg); e.status = status; if (extra) e.extra = extra; return e; }

async function findKey(k) {
  const c = canon(k); if (c.length < 12) return null;
  return one("SELECT * FROM licenses WHERE key=$1 OR regexp_replace(upper(key),'[^A-Z0-9]','','g')=$1 LIMIT 1", [c]);
}
export async function churchOf(userId) {
  return userId ? one("SELECT c.*, m.role FROM church_members m JOIN churches c ON c.id=m.church_id WHERE m.user_id=$1", [userId]) : null;
}
export async function createChurch(user, name) {
  name = String(name || "").trim().slice(0, 100);
  if (!name) throw bad("Give your church or production a name.");
  if (await churchOf(user.id)) throw bad("Your account is already in a church.", 409);
  const c = await one("INSERT INTO churches (name,owner_id,admin_code,user_code) VALUES ($1,$2,$3,$4) RETURNING *", [name, user.id, code(), code()]);
  await q("INSERT INTO church_members (church_id,user_id,role) VALUES ($1,$2,'owner')", [c.id, user.id]);
  return c;
}
export async function joinChurch(user, joinCode, role) {
  const cc = canon(joinCode), c = await one("SELECT * FROM churches WHERE admin_code=$1 OR user_code=$1", [cc]);
  if (!c) throw bad("That church code isn't right. Ask your main admin for it (it's on their account page).", 404);
  const r = role === "admin" ? "admin" : "user";
  if (r === "admin" && c.admin_code !== cc) throw bad("That's the users' code. Admins join with the admin code.", 403);
  const mine = await churchOf(user.id);
  if (mine && mine.id !== c.id) throw bad("Your account is already in another church.", 409);
  if (mine) { if (mine.role !== "owner" && r === "admin" && mine.role === "user") await q("UPDATE church_members SET role='admin' WHERE user_id=$1", [user.id]); return c; }
  await q("INSERT INTO church_members (church_id,user_id,role) VALUES ($1,$2,$3)", [c.id, user.id, r]);
  return c;
}
// keys for an order (inside its transaction)
export async function issueKeys(client, orderId, churchId, productId, product, n) {
  const out = [];
  for (let i = 0; i < n; i++) for (const [kind, count] of Object.entries(product.keys || {})) for (let j = 0; j < count; j++) {
    for (let tries = 0; tries < 5; tries++) {
      const k = newKey(kind);
      const r = await client.query("INSERT INTO licenses (key,order_id,product,kind,church_id) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (key) DO NOTHING RETURNING key", [k, orderId, productId, kind, churchId]);
      if (r.rows[0]) { out.push(k); break; }
    }
  }
  return out;
}
function keyOut(l, full, me) {
  const mine = !!(me && l.user_id === me);
  return { key: full || mine ? pretty(l.key) : "••••-••••-••••-" + canon(l.key).slice(-4), mine, kind: l.kind, kindName: KEY_KINDS[l.kind] || l.kind, inUse: !!l.device_id,
    device: l.device_id ? l.device_name || "a device" : null, app: l.app ? APP_NAME[l.app] || l.app : null, lastSeen: l.last_seen, revoked: l.revoked };
}

export function routes(api, { wrap, brake, requireUser }) {
  // key guessing: 30 wrong keys from one address in 15 minutes and it waits (right keys don't count: a whole church
  // behind one internet address can set up and open its apps together)
  const misses = new Map();
  const recent = (k) => (misses.get(k) || []).filter((x) => Date.now() - x < 15 * 60e3);
  function keyBrake(req) { if (recent(req.ip).length >= 30) throw bad("Too many wrong keys. Wait a few minutes and try again.", 429); }
  function miss(req) { const t = recent(req.ip); t.push(Date.now()); misses.set(req.ip, t); }
  setInterval(() => { for (const k of misses.keys()) if (!recent(k).length) misses.delete(k); }, 10 * 60e3).unref();
  function device(b) {
    const d = String(b.device || "");
    if (!/^[A-Za-z0-9-]{8,80}$/.test(d)) throw bad("This device has no id yet. Restart the app and try again.");
    return d;
  }

  // ---- the apps
  api.post("/license/activate", wrap(async (req, res) => {
    keyBrake(req);
    const b = req.body || {}, dev = device(b), app = String(b.app || ""), want = APP_KIND[app];
    if (!want) throw bad("Unknown app.");
    const l = await findKey(b.key);
    if (!l || l.revoked) { miss(req); throw bad("That key isn't right. Check it on your receipt or your church's page on the website.", 404); }
    if (l.kind !== want) throw bad("That's a " + (KEY_KINDS[l.kind] || "different") + " key. " + APP_NAME[app] + " needs " + (want === "P" ? "a P key" : want === "A" ? "an A key (admin)" : "a U key (user)") + ".", 400);
    if (l.device_id && l.device_id !== dev) throw bad("This key is already used on “" + (l.device_name || "another device") + "”. Release it there (Settings → Release key) or on the website, then try again.", 409);
    const name = String(b.deviceName || "").trim().slice(0, 80) || APP_NAME[app];
    const got = await one(`UPDATE licenses SET device_id=$1, device_name=$2, app=$3, activated_at=COALESCE(CASE WHEN device_id=$1 THEN activated_at END, now()), last_seen=now()
      WHERE key=$4 AND (device_id IS NULL OR device_id=$1) RETURNING key`, [dev, name, app, l.key]);   // (two devices at the same moment: only one gets it)
    if (!got) throw bad("This key was just taken by another device. Release it there, then try again.", 409);
    const c = l.church_id ? await one("SELECT name FROM churches WHERE id=$1", [l.church_id]) : null;
    res.json({ ok: true, key: pretty(l.key), kind: l.kind, church: c ? c.name : "", recheckDays: LICENSE_RECHECK_DAYS });
  }));
  api.post("/license/check", wrap(async (req, res) => {
    keyBrake(req);
    const b = req.body || {}, dev = device(b), l = await findKey(b.key);
    if (!l || l.revoked) { miss(req); return res.json({ ok: false, reason: "invalid" }); }
    if (l.device_id !== dev) return res.json({ ok: false, reason: l.device_id ? "elsewhere" : "released", device: l.device_id ? l.device_name : null });
    await q("UPDATE licenses SET last_seen=now() WHERE key=$1", [l.key]);
    const c = l.church_id ? await one("SELECT name FROM churches WHERE id=$1", [l.church_id]) : null;
    res.json({ ok: true, kind: l.kind, church: c ? c.name : "", recheckDays: LICENSE_RECHECK_DAYS });
  }));
  api.post("/license/release", wrap(async (req, res) => {   // from the device that has it
    keyBrake(req);
    const b = req.body || {}, dev = device(b), l = await findKey(b.key);
    if (l && l.device_id === dev) await q("UPDATE licenses SET device_id=NULL, device_name=NULL, app=NULL WHERE key=$1", [l.key]);
    res.json({ ok: true });
  }));
  // the account signed in on a device joins the key's church: an A key makes it an admin; P and U keys a user (a P key
  // can be on a musician's Pedal Control - admins join with an A key or the admin code). The key remembers the account.
  api.post("/license/link", requireUser, wrap(async (req, res) => {
    const b = req.body || {}, dev = device(b), l = await findKey(b.key);
    if (!l || l.revoked || l.device_id !== dev) throw bad("Activate the key on this device first.", 400);
    if (!l.church_id) { await q("UPDATE licenses SET user_id=$1 WHERE key=$2", [req.user.id, l.key]); return res.json({ ok: true, church: null }); }
    const mine = await churchOf(req.user.id);
    if (mine && mine.id !== l.church_id) throw bad("This account belongs to another church (" + mine.name + "). Sign in with your church's account.", 409);
    if (!mine) await q("INSERT INTO church_members (church_id,user_id,role) VALUES ($1,$2,$3)", [l.church_id, req.user.id, l.kind === "A" ? "admin" : "user"]);
    else if (mine.role === "user" && l.kind === "A") await q("UPDATE church_members SET role='admin' WHERE user_id=$1", [req.user.id]);
    await q("UPDATE licenses SET user_id=$1 WHERE key=$2", [req.user.id, l.key]);
    const c = await churchOf(req.user.id);
    res.json({ ok: true, church: c.name, role: c.role });
  }));

  // ---- the church, on the website
  api.get("/church", requireUser, wrap(async (req, res) => {
    const c = await churchOf(req.user.id);
    if (!c) return res.json({ church: null });
    const staff = c.role === "owner" || c.role === "admin";
    const keys = await q("SELECT * FROM licenses WHERE church_id=$1 ORDER BY kind, created_at, key", [c.id]);
    const counts = {};
    for (const k of Object.keys(KEY_KINDS)) { const list = keys.filter((x) => x.kind === k && !x.revoked); counts[k] = { name: KEY_KINDS[k], total: list.length, inUse: list.filter((x) => x.device_id).length, free: list.filter((x) => !x.device_id).length }; }
    const members = staff ? await q("SELECT u.name, u.email, m.role FROM church_members m JOIN users u ON u.id=m.user_id WHERE m.church_id=$1 ORDER BY m.role, u.name", [c.id]) : [];
    res.json({ church: { name: c.name, role: c.role, hasPack: c.has_pack, adminCode: c.role === "owner" ? c.admin_code : undefined, userCode: staff ? c.user_code : undefined },
      counts, keys: keys.map((l) => keyOut(l, staff, req.user.id)), members });
  }));
  api.post("/church", requireUser, wrap(async (req, res) => { const c = await createChurch(req.user, req.body.name); res.json({ ok: true, church: c.name }); }));
  api.post("/church/join", requireUser, wrap(async (req, res) => { brake(req); const c = await joinChurch(req.user, req.body.code, req.body.role); res.json({ ok: true, church: c.name }); }));
  api.post("/church/codes", requireUser, wrap(async (req, res) => {   // new codes (an old one got out); people already in stay in
    const c = await churchOf(req.user.id); if (!c || c.role !== "owner") throw bad("Only the main admin can change the codes.", 403);
    await q("UPDATE churches SET admin_code=$1, user_code=$2 WHERE id=$3", [code(), code(), c.id]); res.json({ ok: true });
  }));
  api.post("/church/remove", requireUser, wrap(async (req, res) => {   // take someone out of the church (their keys stay the church's)
    const c = await churchOf(req.user.id); if (!c || c.role !== "owner") throw bad("Only the main admin can take people out.", 403);
    const u = await one("SELECT u.id FROM users u JOIN church_members m ON m.user_id=u.id WHERE m.church_id=$1 AND u.email=$2", [c.id, String(req.body.email || "").toLowerCase()]);
    if (!u) throw bad("That person isn't in your church.", 404);
    if (u.id === req.user.id) throw bad("You can't take yourself out.", 400);
    await q("DELETE FROM church_members WHERE user_id=$1", [u.id]); await q("UPDATE licenses SET user_id=NULL WHERE user_id=$1 AND church_id=$2", [u.id, c.id]);
    res.json({ ok: true });
  }));
  api.post("/church/rename", requireUser, wrap(async (req, res) => {
    const c = await churchOf(req.user.id), name = String(req.body.name || "").trim().slice(0, 100);
    if (!c || c.role !== "owner") throw bad("Only the main admin can rename the church.", 403);
    if (!name) throw bad("Give it a name.");
    await q("UPDATE churches SET name=$1 WHERE id=$2", [name, c.id]); res.json({ ok: true });
  }));
  api.post("/church/release", requireUser, wrap(async (req, res) => {   // free a key from a lost or broken device
    const c = await churchOf(req.user.id), l = await findKey(req.body.key);
    if (!c) throw bad("Your account isn't in a church.", 403);
    if (!l || l.church_id !== c.id) throw bad("That key isn't one of your church's.", 404);
    if (!(c.role === "owner" || c.role === "admin" || l.user_id === req.user.id)) throw bad("Only the main admin, admins, and the person using the key can release it.", 403);   // (a user: their own device)
    await q("UPDATE licenses SET device_id=NULL, device_name=NULL, app=NULL WHERE key=$1", [l.key]);
    res.json({ ok: true });
  }));

  // ---- Motion Audio staff (ADMIN_EMAILS): make keys (a pedal you build and ship, a replacement), find and fix keys
  api.post("/admin/keys", requireUser, wrap(async (req, res) => {
    if (!isAdmin(req.user)) throw bad("Admins only.", 403);
    const kind = String(req.body.kind || ""), n = Math.max(1, Math.min(100, Number(req.body.count) || 1)), note = String(req.body.note || "").slice(0, 200);
    if (!KEY_KINDS[kind]) throw bad("Kind must be P, A or U.");
    let churchId = null;
    if (req.body.church) { const c = await one("SELECT id FROM churches WHERE id=$1 OR admin_code=$2 OR user_code=$2", [Number(req.body.church) || 0, canon(req.body.church)]); if (!c) throw bad("No church with that id or code.", 404); churchId = c.id; }
    const client = await pool.connect(), keys = [];
    try { for (let i = 0; i < n; i++) { const k = newKey(kind); await client.query("INSERT INTO licenses (key,product,kind,church_id,note) VALUES ($1,'made',$2,$3,$4)", [k, kind, churchId, note]); keys.push(pretty(k)); } }
    finally { client.release(); }
    res.json({ keys });
  }));
  api.get("/admin/keys", requireUser, wrap(async (req, res) => {
    if (!isAdmin(req.user)) throw bad("Admins only.", 403);
    const s = canon(req.query.q || ""), name = String(req.query.q || "").trim().replace(/[%_\\]/g, "\\$&").slice(0, 100);
    const rows = await q(`SELECT l.*, c.name AS church FROM licenses l LEFT JOIN churches c ON c.id=l.church_id
      WHERE $1='' OR regexp_replace(upper(l.key),'[^A-Z0-9]','','g') LIKE '%'||$1||'%' OR c.name ILIKE '%'||$2||'%' ORDER BY l.created_at DESC LIMIT 200`, [s, name]);
    res.json({ keys: rows.map((l) => Object.assign(keyOut(l, true), { church: l.church || "", note: l.note, created: l.created_at })) });
  }));
  api.post("/admin/keys/:key/:action", requireUser, wrap(async (req, res) => {
    if (!isAdmin(req.user)) throw bad("Admins only.", 403);
    const l = await findKey(req.params.key); if (!l) throw bad("No such key.", 404);
    const a = req.params.action;
    if (a === "release") await q("UPDATE licenses SET device_id=NULL, device_name=NULL, app=NULL WHERE key=$1", [l.key]);
    else if (a === "revoke" || a === "restore") await q("UPDATE licenses SET revoked=$1 WHERE key=$2", [a === "revoke", l.key]);
    else throw bad("Release, revoke or restore.");
    res.json({ ok: true });
  }));
}
