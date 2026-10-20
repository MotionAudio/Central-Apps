// License keys, church accounts and Teams.
// A key is 16 characters: its kind (P = Central Pedal / Central Pedal Control, A = Central Control for admins,
// U = Central Usage for users) and 15 random letters and digits (no 0/O, 1/I/L look-alikes), shown in fours:
// P7K3-9QXM-2HDA-VW8F. The app activates it with its device id and checks it again every 30 days; Release (in the
// app's settings, or on the website) frees a device. Devices per key: an A key one; a U key or a Pedal Control P key
// two (a church device and a home device), both signed in with the same account; a pedal's own P key one.
// A church (or production) owns the keys it bought. Its main admin adds people on the Teams page (Admins, Users,
// Pedal Control): each gets an email with a link to make their account, their app's download link and their key.
import crypto from "node:crypto";
import { q, one, pool } from "./db.js";
import { config, KEY_KINDS, LICENSE_RECHECK_DAYS } from "./config.js";
import { isAdmin } from "./auth.js";
import { sendMail, mailOn, escHtml } from "./mail.js";
import { requireStep } from "./signin.js";
import { newCoverage, currentTenths, fmt } from "./versions.js";

const ABC = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";   // 31 signs: no I, L, O, 0, 1
const APP_KIND = { pedal: "P", "pedal-control": "P", control: "A", usage: "U" };
const APP_NAME = { pedal: "Central Pedal", "pedal-control": "Central Pedal Control", control: "Central Control", usage: "Central Usage" };
const SECTION = { admin: { kind: "A", app: "Central Control", role: "admin", anchor: "control" }, user: { kind: "U", app: "Central Usage", role: "user", anchor: "usage" },
  pedal: { kind: "P", app: "Central Pedal Control", role: "user", anchor: "pedal-control" } };
const APPS_URL = "https://motionaudio.github.io/Central-Apps/";

export function newKey(kind) {
  let s = kind;
  for (let i = 0; i < 15; i++) s += ABC[crypto.randomInt(ABC.length)];
  return s;
}
export function canon(k) { return String(k || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }
export function pretty(k) { const c = canon(k); return c.length === 16 ? c.match(/.{4}/g).join("-") : String(k); }
function code() { let s = ""; for (let i = 0; i < 8; i++) s += ABC[crypto.randomInt(ABC.length)]; return s; }
function bad(msg, status = 400) { const e = new Error(msg); e.status = status; return e; }
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
export function maxDevices(kind, app, devices) {   // how many devices a key can be on at once
  if (app === "pedal" || (devices || []).some((d) => d.app === "pedal")) return 1;   // (a pedal's own key)
  return kind === "A" ? 1 : 2;
}

async function findKey(k, client) {
  const c = canon(k); if (c.length < 12) return null;
  const r = await (client || pool).query("SELECT * FROM licenses WHERE key=$1 OR regexp_replace(upper(key),'[^A-Z0-9]','','g')=$1 LIMIT 1" + (client ? " FOR UPDATE" : ""), [c]);
  return r.rows[0] || null;
}
const devicesOf = (key) => q("SELECT * FROM license_devices WHERE key=$1 ORDER BY activated_at", [key]);
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
      const r = await client.query("INSERT INTO licenses (key,order_id,product,kind,church_id,updates_until) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (key) DO NOTHING RETURNING key", [k, orderId, productId, kind, churchId, kind === "P" ? null : await newCoverage()]);
      if (r.rows[0]) { out.push(k); break; }
    }
  }
  return out;
}
// a church in a free trial (TESTRUN, 7FREE): as many keys as it wants until then
export function trialActive(c) { return !!(c && c.trial_until && new Date(c.trial_until) > new Date()); }
export async function mintTrialKey(client, c, kind) {
  for (let tries = 0; tries < 5; tries++) {
    const k = newKey(kind);
    const r = await client.query("INSERT INTO licenses (key,product,kind,church_id,trial,expires_at,note) VALUES ($1,'trial',$2,$3,TRUE,$4,$5) ON CONFLICT (key) DO NOTHING RETURNING key", [k, kind, c.id, c.trial_until, "trial " + (c.trial_code || "")]);
    if (r.rows[0]) return r.rows[0].key;
  }
  throw bad("Couldn't make a key. Try again.", 500);
}
const expired = (l) => !!(l.expires_at && new Date(l.expires_at) <= new Date());
const FREE_KEY = `NOT revoked AND user_id IS NULL AND assigned_email IS NULL AND (expires_at IS NULL OR expires_at > now())
  AND NOT EXISTS (SELECT 1 FROM license_devices d WHERE d.key=licenses.key)`;
function keyOut(l, devs, full, me) {
  const mine = !!(me && l.user_id === me);
  return { key: full || mine ? pretty(l.key) : "••••-••••-••••-" + canon(l.key).slice(-4), mine, kind: l.kind, kindName: KEY_KINDS[l.kind] || l.kind, inUse: devs.length > 0,
    devices: devs.map((d) => ({ name: d.device_name || "a device", app: APP_NAME[d.app] || d.app, lastSeen: d.last_seen })), max: maxDevices(l.kind, null, devs),
    device: devs.length ? devs.map((d) => d.device_name || "a device").join(" · ") : null, app: devs[0] ? APP_NAME[devs[0].app] || devs[0].app : null,
    assignedTo: full ? (l.assigned_name || l.assigned_email || null) : null, lastSeen: devs.reduce((a, d) => (!a || d.last_seen > a ? d.last_seen : a), null), revoked: l.revoked,
    updatesUntil: l.kind === "P" ? "forever" : fmt(l.updates_until), trial: l.trial, expiresAt: l.expires_at, expired: expired(l), renewable: l.kind !== "P" && !l.trial && !l.revoked };
}

// ---------------------------------------------------------------- invites (the Teams page)
function inviteLink(token) { return config.publicUrl + "/#invite-" + token; }
// how: undefined (the first email, or Resend), "reminder" (nobody answered yet), "moved" (to another team: new app and key)
async function sendInvite(inv, church, how) {
  const s = SECTION[inv.section], link = inviteLink(inv.token), owner = inv.section === "owner", joined = !!inv.user_id;
  const key = inv.key ? pretty(inv.key) : "", step1 = joined ? "Sign in with your account" : "Make your account";
  const subject = (how === "reminder" ? "Reminder: " : "") + (owner ? "You're the main admin of " + church.name + " - Motion Audio"
    : how === "moved" ? church.name + " moved you to " + s.app : church.name + " added you to the team - " + s.app);
  const lead = how === "moved" ? church.name + " moved you to " + s.app + (inv.role_text ? " (" + inv.role_text + ")" : "") + ". Your old key no longer works; here's your new one."
    : church.name + " added you" + (inv.role_text ? " as " + inv.role_text : "") + "." + (how === "reminder" ? " Your key is waiting for you." : "");
  const text = (inv.name ? "Hi " + inv.name + ",\n\n" : "Hi,\n\n") + (owner
    ? church.name + " made you its main admin on Motion Audio." + (how === "reminder" ? " The invite is still waiting." : "") + "\n\n1. Make your account (or sign in): " + link + "\n"
    : lead + "\n\n1. " + step1 + ": " + link + "\n2. Download " + s.app + ": " + APPS_URL + "#" + s.anchor +
      "\n3. Open it, connect to Wi-Fi, and enter your key: " + key + "\n" + (inv.section === "user" || inv.section === "pedal" ? "\nYour key works on two of your devices (for example one at church and one at home), signed in with your account - your settings go with you.\n" : "")) +
    (church.has_services ? "\nYour church's schedule is in Central Services: " + APPS_URL + "#central-services - sign in with the same account.\n" : "") +
    "\nMotion Audio\n";
  const html = '<div style="font:15px/1.5 system-ui,sans-serif;color:#10202e;max-width:520px">' + (inv.name ? "<p>Hi " + escHtml(inv.name) + ",</p>" : "<p>Hi,</p>") + (owner
    ? "<p><b>" + escHtml(church.name) + "</b> made you its main admin on Motion Audio." + (how === "reminder" ? " The invite is still waiting." : "") + "</p><p><a href=\"" + escHtml(link) + "\" style=\"display:inline-block;background:#d97706;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none\">Make your account</a></p>"
    : "<p>" + escHtml(lead) + "</p><ol>" +
      "<li><a href=\"" + escHtml(link) + "\">" + step1 + "</a></li><li><a href=\"" + APPS_URL + "#" + s.anchor + "\">Download " + escHtml(s.app) + "</a></li>" +
      "<li>Open it, connect to Wi-Fi, and enter your key:<br><code style=\"font:600 18px ui-monospace,monospace;letter-spacing:.05em\">" + escHtml(key) + "</code></li></ol>" +
      (inv.section !== "admin" ? "<p style=\"color:#555\">Your key works on two of your devices (for example one at church and one at home), signed in with your account - your settings go with you.</p>" : "")) +
    (church.has_services ? "<p>Your church's schedule is in <a href=\"" + APPS_URL + "#central-services\">Central Services</a> - sign in with the same account.</p>" : "") + "<p>Motion Audio</p></div>";
  const r = await sendMail(inv.email, subject, text, html);
  await q("UPDATE invites SET sent_at=now(), sent_ok=$1 WHERE id=$2", [r.sent, inv.id]);
  return r;
}
// someone with an invite made their account (or signed in): they join, the key is theirs
export async function acceptInvite(user, token) {
  const inv = await one("SELECT * FROM invites WHERE token=$1", [String(token || "")]);
  if (!inv) throw bad("That invite isn't valid any more. Ask your main admin to send it again.", 404);
  if (inv.user_id && inv.user_id !== user.id) throw bad("That invite was already used by another account.", 409);
  const mine = await churchOf(user.id);
  if (mine && mine.id !== inv.church_id) throw bad("Your account is already in another church (" + mine.name + ").", 409);
  if (inv.section === "owner") {
    const c = await one("SELECT * FROM churches WHERE id=$1", [inv.church_id]);
    if (!mine) await q("INSERT INTO church_members (church_id,user_id,role) VALUES ($1,$2,'owner')", [inv.church_id, user.id]);
    else await q("UPDATE church_members SET role='owner' WHERE user_id=$1", [user.id]);
    if (c.owner_id && c.owner_id !== user.id) await q("UPDATE church_members SET role='admin' WHERE user_id=$1 AND church_id=$2", [c.owner_id, c.id]);   // (the one who made it stays, as an admin)
    await q("UPDATE churches SET owner_id=$1 WHERE id=$2", [user.id, c.id]);
    (await import("./payments.js")).syncChurchCustomer(c.id).catch(() => { });   // (the receipts go to the new main admin)
  } else {
    const role = SECTION[inv.section].role;
    if (!mine) await q("INSERT INTO church_members (church_id,user_id,role) VALUES ($1,$2,$3)", [inv.church_id, user.id, role]);
    else if (mine.role === "user" && role === "admin") await q("UPDATE church_members SET role='admin' WHERE user_id=$1", [user.id]);
    if (inv.key) await q("UPDATE licenses SET user_id=$1 WHERE key=$2", [user.id, inv.key]);
  }
  await q("UPDATE invites SET user_id=$1 WHERE id=$2", [user.id, inv.id]);
  const c = await churchOf(user.id);
  return { church: c.name, role: c.role, key: inv.key ? pretty(inv.key) : null, app: SECTION[inv.section] ? SECTION[inv.section].app : null };
}

// Teams invites nobody answered (no account yet): a reminder 3 days after it was sent, another after 7, then no more.
// Moving someone to another team starts the count again.
export async function remindInvites() {
  const due = await q(`SELECT i.* FROM invites i WHERE i.user_id IS NULL AND i.sent_ok AND (
      (i.reminders = 0 AND COALESCE(i.sent_at, i.created_at) < now() - interval '3 days') OR
      (i.reminders = 1 AND i.reminded_at < now() - interval '4 days'))
    AND NOT EXISTS (SELECT 1 FROM users u WHERE u.email = i.email AND EXISTS (SELECT 1 FROM church_members m WHERE m.user_id=u.id AND m.church_id=i.church_id))
    ORDER BY i.id LIMIT 500`);
  let n = 0;
  for (const inv of due) {
    const c = await one("SELECT * FROM churches WHERE id=$1", [inv.church_id]);
    const claimed = await one("UPDATE invites SET reminders=reminders+1, reminded_at=now() WHERE id=$1 AND reminders=$2 RETURNING id", [inv.id, inv.reminders]);   // (once, even if two run)
    if (!claimed || !c) continue;
    const r = await sendInvite(inv, c, "reminder");
    if (r.sent) n++;
  }
  return n;
}

// what a key tells its app: how far its updates go (null: forever), and when a trial key stops
function coverage(l) { return { updatesUntil: l.kind === "P" ? null : l.updates_until, updatesUntilText: l.kind === "P" ? "forever" : fmt(l.updates_until), expiresAt: l.expires_at || null, trial: !!l.trial }; }

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
  async function staffChurch(req, ownerOnly) {
    const c = await churchOf(req.user.id);
    if (!c || !(c.role === "owner" || (!ownerOnly && c.role === "admin"))) throw bad(ownerOnly ? "Only the main admin can do that." : "Only the main admin and admins can do that.", 403);
    await requireStep(req);
    return c;
  }

  // ---- the apps
  api.post("/license/activate", wrap(async (req, res) => {
    keyBrake(req);
    const b = req.body || {}, dev = device(b), app = String(b.app || ""), want = APP_KIND[app];
    if (!want) throw bad("Unknown app.");
    const name = String(b.deviceName || "").trim().slice(0, 80) || APP_NAME[app];
    const client = await pool.connect();
    let l;
    try {
      await client.query("BEGIN");
      l = await findKey(b.key, client);   // (locked: two devices at the same moment take turns)
      if (l && l.church_id && (await client.query("SELECT closed_at FROM churches WHERE id=$1", [l.church_id])).rows[0].closed_at) { await client.query("ROLLBACK"); throw bad("That key's church was closed. Ask Motion Audio support.", 403); }
      if (!l || l.revoked) { await client.query("ROLLBACK"); miss(req); throw bad("That key isn't right. Check it on your receipt or your church's page on the website.", 404); }
      if (l && expired(l)) { await client.query("ROLLBACK"); throw bad("This trial key ended on " + new Date(l.expires_at).toLocaleDateString("en-US") + ". Enter a key your church bought (Motion Audio store), or ask your main admin.", 403); }
      if (l.kind !== want) { await client.query("ROLLBACK"); throw bad("That's a " + (KEY_KINDS[l.kind] || "different") + " key. " + APP_NAME[app] + " needs " + (want === "P" ? "a P key" : want === "A" ? "an A key (admin)" : "a U key (user)") + ".", 400); }
      const devs = (await client.query("SELECT * FROM license_devices WHERE key=$1", [l.key])).rows, here = devs.find((d) => d.device_id === dev), others = devs.filter((d) => d.device_id !== dev);
      const max = maxDevices(l.kind, app, others);
      if (!here && others.length >= max) {
        await client.query("ROLLBACK");
        throw bad("This key is already used on " + others.map((d) => "“" + (d.device_name || "another device") + "”").join(" and ") + (max > 1 ? " (it works on " + max + " devices)" : "") + ". Release it there (Settings → License → Release key) or on the website, then try again.", 409);
      }
      await client.query(`INSERT INTO license_devices (key,device_id,device_name,app) VALUES ($1,$2,$3,$4)
        ON CONFLICT (key,device_id) DO UPDATE SET device_name=EXCLUDED.device_name, app=EXCLUDED.app, last_seen=now()`, [l.key, dev, name, app]);
      await client.query("COMMIT");
    } catch (e) { try { await client.query("ROLLBACK"); } catch (_) { } throw e; } finally { client.release(); }
    const c = l.church_id ? await one("SELECT name FROM churches WHERE id=$1", [l.church_id]) : null;
    res.json({ ok: true, key: pretty(l.key), kind: l.kind, church: c ? c.name : "", recheckDays: LICENSE_RECHECK_DAYS, account: l.assigned_email ? { email: l.assigned_email } : null, ...coverage(l) });
  }));
  api.post("/license/check", wrap(async (req, res) => {
    keyBrake(req);
    const b = req.body || {}, dev = device(b), l = await findKey(b.key);
    if (!l || l.revoked) { miss(req); return res.json({ ok: false, reason: "invalid" }); }
    if (l.church_id && (await one("SELECT closed_at FROM churches WHERE id=$1", [l.church_id])).closed_at) return res.json({ ok: false, reason: "invalid" });   // (its church was closed)
    if (expired(l)) return res.json({ ok: false, reason: "expired", expiresAt: l.expires_at });   // (a trial that ended: the app locks until a bought key is entered)
    const devs = await devicesOf(l.key);
    if (!devs.some((d) => d.device_id === dev)) return res.json({ ok: false, reason: devs.length >= maxDevices(l.kind, null, devs) ? "elsewhere" : "released", device: devs.map((d) => d.device_name).join(" and ") || null });
    await q("UPDATE license_devices SET last_seen=now() WHERE key=$1 AND device_id=$2", [l.key, dev]);
    const c = l.church_id ? await one("SELECT name FROM churches WHERE id=$1", [l.church_id]) : null;
    res.json({ ok: true, kind: l.kind, church: c ? c.name : "", recheckDays: LICENSE_RECHECK_DAYS, ...coverage(l) });
  }));
  api.post("/license/release", wrap(async (req, res) => {   // from the device that has it
    keyBrake(req);
    const b = req.body || {}, dev = device(b), l = await findKey(b.key);
    if (l) await q("DELETE FROM license_devices WHERE key=$1 AND device_id=$2", [l.key, dev]);
    res.json({ ok: true });
  }));
  // the account signed in on a device. The key belongs to one account: its second device must be signed in with the
  // same one (so a key isn't shared). A key the Teams page sent to someone is theirs. The account joins the key's church:
  // an A key makes it an admin; P and U keys a user.
  api.post("/license/link", requireUser, wrap(async (req, res) => {
    const b = req.body || {}, dev = device(b), l = await findKey(b.key);
    const devs = l ? await devicesOf(l.key) : [];
    if (!l || l.revoked || !devs.some((d) => d.device_id === dev)) throw bad("Activate the key on this device first.", 400);
    const owner = l.user_id ? await one("SELECT email, name FROM users WHERE id=$1", [l.user_id]) : null;
    const wrongAccount = (l.user_id && l.user_id !== req.user.id) ? (owner ? owner.email : "another account")
      : (!l.user_id && l.assigned_email && l.assigned_email !== req.user.email.toLowerCase()) ? l.assigned_email : null;
    if (wrongAccount && !(await churchOf(req.user.id).then((c) => c && c.id === l.church_id && (c.role === "owner" || c.role === "admin") && l.kind !== "U"))) {
      await q("DELETE FROM license_devices WHERE key=$1 AND device_id=$2", [l.key, dev]);   // (this device doesn't keep the key)
      throw bad("This key belongs to " + wrongAccount + ". Sign in with that account - a key works on two devices of the same person.", 409);
    }
    if (l.church_id) {
      const mine = await churchOf(req.user.id);
      if (mine && mine.id !== l.church_id) throw bad("This account belongs to another church (" + mine.name + "). Sign in with your church's account.", 409);
      if (!mine) await q("INSERT INTO church_members (church_id,user_id,role) VALUES ($1,$2,$3)", [l.church_id, req.user.id, l.kind === "A" ? "admin" : "user"]);
      else if (mine.role === "user" && l.kind === "A") await q("UPDATE church_members SET role='admin' WHERE user_id=$1", [req.user.id]);
    }
    if (!l.user_id) await q("UPDATE licenses SET user_id=$1 WHERE key=$2", [req.user.id, l.key]);
    await q("UPDATE invites SET user_id=$1 WHERE key=$2 AND user_id IS NULL AND email=$3", [req.user.id, l.key, req.user.email.toLowerCase()]);   // (the person it was sent to - not a shared admin account)
    const c = await churchOf(req.user.id);
    res.json({ ok: true, church: c ? c.name : null, role: c ? c.role : null });
  }));

  // ---- invites
  api.get("/invite/:token", wrap(async (req, res) => {
    const inv = await one("SELECT i.*, c.name AS church FROM invites i JOIN churches c ON c.id=i.church_id WHERE i.token=$1", [String(req.params.token)]);
    if (!inv) throw bad("That invite isn't valid any more. Ask your main admin to send it again.", 404);
    const s = SECTION[inv.section];
    res.json({ church: inv.church, name: inv.name, email: inv.email, section: inv.section, role: inv.role_text, used: !!inv.user_id,
      app: s ? s.app : null, download: s ? APPS_URL + "#" + s.anchor : null, key: inv.key ? pretty(inv.key) : null });
  }));
  api.post("/invite/accept", requireUser, wrap(async (req, res) => res.json(Object.assign({ ok: true }, await acceptInvite(req.user, req.body.token)))));

  // ---- the church, on the website
  api.get("/church", requireUser, wrap(async (req, res) => {
    const c = await churchOf(req.user.id);
    if (!c) return res.json({ church: null });
    const staff = c.role === "owner" || c.role === "admin";
    if (staff) await requireStep(req);
    const keys = await q("SELECT * FROM licenses WHERE church_id=$1 ORDER BY kind, created_at, key", [c.id]);
    const devs = await q("SELECT d.* FROM license_devices d JOIN licenses l ON l.key=d.key WHERE l.church_id=$1", [c.id]);
    const dv = (k) => devs.filter((d) => d.key === k);
    const counts = {};
    for (const k of Object.keys(KEY_KINDS)) {
      const list = keys.filter((x) => x.kind === k && !x.revoked && !(x.expires_at && new Date(x.expires_at) <= new Date())), used = list.filter((x) => dv(x.key).length || x.assigned_email || x.user_id);
      counts[k] = { name: KEY_KINDS[k], total: list.length, inUse: list.filter((x) => dv(x.key).length).length, given: used.length, free: list.length - used.length };
    }
    const members = staff ? await q("SELECT u.name, u.email, m.role FROM church_members m JOIN users u ON u.id=m.user_id WHERE m.church_id=$1 ORDER BY m.role, u.name", [c.id]) : [];
    res.json({ current: fmt(await currentTenths()), trial: { active: trialActive(c), until: c.trial_until, code: c.trial_code, used: !!c.trial_code },
      church: { name: c.name, role: c.role, hasPack: c.has_pack, hasServices: !!c.has_services || trialActive(c), servicesPaid: !!c.has_services, adminCode: c.role === "owner" ? c.admin_code : undefined, userCode: staff ? c.user_code : undefined, mail: mailOn },
      counts, keys: keys.map((l) => keyOut(l, dv(l.key), staff, req.user.id)), members });
  }));
  api.post("/church", requireUser, wrap(async (req, res) => {
    const c = await createChurch(req.user, req.body.name);
    let invite = null;   // a main admin who isn't the person making it
    const oe = String(req.body.ownerEmail || "").trim().toLowerCase();
    if (oe && oe !== req.user.email.toLowerCase()) invite = await makeOwnerInvite(c, oe, String(req.body.ownerName || ""));
    res.json({ ok: true, church: c.name, invite });
  }));
  async function makeOwnerInvite(c, email, name) {
    if (!emailOk(email)) throw bad("That main admin email doesn't look right.");
    await q("DELETE FROM invites WHERE church_id=$1 AND section='owner'", [c.id]);
    const inv = await one("INSERT INTO invites (church_id,section,name,email,token) VALUES ($1,'owner',$2,$3,$4) RETURNING *", [c.id, name.slice(0, 80), email, crypto.randomBytes(18).toString("base64url")]);
    const r = await sendInvite(inv, c);
    return { sent: r.sent, why: r.why, link: inviteLink(inv.token) };
  }
  api.post("/church/owner", requireUser, wrap(async (req, res) => {   // make someone else the main admin (they accept with the emailed link)
    const c = await staffChurch(req, true);
    res.json(Object.assign({ ok: true }, await makeOwnerInvite(c, String(req.body.email || "").trim().toLowerCase(), String(req.body.name || ""))));
  }));
  api.post("/church/join", requireUser, wrap(async (req, res) => { brake(req); const c = await joinChurch(req.user, req.body.code, req.body.role); res.json({ ok: true, church: c.name }); }));
  api.post("/church/codes", requireUser, wrap(async (req, res) => {   // new codes (an old one got out); people already in stay in
    const c = await staffChurch(req, true);
    await q("UPDATE churches SET admin_code=$1, user_code=$2 WHERE id=$3", [code(), code(), c.id]); res.json({ ok: true });
  }));
  async function freeKey(key) {   // a key back to the church: off its devices, not anyone's
    await q("DELETE FROM license_devices WHERE key=$1", [key]);
    await q("UPDATE licenses SET user_id=NULL, assigned_email=NULL, assigned_name=NULL WHERE key=$1", [key]);
  }
  api.post("/church/remove", requireUser, wrap(async (req, res) => {   // take someone out of the church: their keys are free again
    const c = await staffChurch(req, true);
    const u = await one("SELECT u.id FROM users u JOIN church_members m ON m.user_id=u.id WHERE m.church_id=$1 AND u.email=$2", [c.id, String(req.body.email || "").toLowerCase()]);
    if (!u) throw bad("That person isn't in your church.", 404);
    if (u.id === req.user.id) throw bad("You can't take yourself out.", 400);
    for (const l of await q("SELECT key FROM licenses WHERE church_id=$1 AND (user_id=$2 OR assigned_email=$3)", [c.id, u.id, String(req.body.email || "").toLowerCase()])) await freeKey(l.key);
    await q("DELETE FROM invites WHERE church_id=$1 AND (user_id=$2 OR email=$3)", [c.id, u.id, String(req.body.email || "").toLowerCase()]);
    await q("DELETE FROM church_members WHERE user_id=$1", [u.id]);
    res.json({ ok: true });
  }));
  api.post("/church/rename", requireUser, wrap(async (req, res) => {
    const c = await staffChurch(req, true), name = String(req.body.name || "").trim().slice(0, 100);
    if (!name) throw bad("Give it a name.");
    await q("UPDATE churches SET name=$1 WHERE id=$2", [name, c.id]);
    (await import("./payments.js")).syncChurchCustomer(c.id).catch(() => { });   // (the name on the receipts)
    res.json({ ok: true });
  }));
  api.post("/church/release", requireUser, wrap(async (req, res) => {   // free a key's devices (a lost or broken one): all, or one by name
    const c = await churchOf(req.user.id), l = await findKey(req.body.key);
    if (!c) throw bad("Your account isn't in a church.", 403);
    if (!l || l.church_id !== c.id) throw bad("That key isn't one of your church's.", 404);
    if (!(c.role === "owner" || c.role === "admin" || l.user_id === req.user.id)) throw bad("Only the main admin, admins, and the person using the key can release it.", 403);   // (a user: their own devices)
    if (req.body.device) await q("DELETE FROM license_devices WHERE key=$1 AND device_name=$2", [l.key, String(req.body.device)]);
    else await q("DELETE FROM license_devices WHERE key=$1", [l.key]);
    res.json({ ok: true });
  }));

  // ---- Teams: Admins, Users, Pedal Control - add people, each gets a key and an email
  api.get("/church/team", requireUser, wrap(async (req, res) => {
    const c = await staffChurch(req);
    const inv = await q(`SELECT i.*, u.email AS joined_email, (SELECT COUNT(*) FROM license_devices d WHERE d.key=i.key)::int AS devices
      FROM invites i LEFT JOIN users u ON u.id=i.user_id WHERE i.church_id=$1 ORDER BY i.section, i.created_at`, [c.id]);
    const out = { admin: [], user: [], pedal: [], owner: [] };
    for (const i of inv) out[i.section].push({ id: String(i.id), name: i.name, email: i.email, role: i.role_text, key: i.key ? pretty(i.key) : null,
      status: i.devices ? "set up" : i.user_id ? "joined" : "invited", devices: i.devices, reminders: i.reminders, sent: i.sent_ok, sentAt: i.sent_at, link: inviteLink(i.token) });
    const counts = {};
    for (const s of ["admin", "user", "pedal"]) { const k = SECTION[s].kind; counts[s] = (await one(`SELECT COUNT(*)::int AS n FROM licenses WHERE church_id=$1 AND kind=$2 AND ${FREE_KEY}`, [c.id, k])).n; }
    res.json({ sections: out, free: counts, mail: mailOn, trialUntil: trialActive(c) ? c.trial_until : null });
  }));
  api.post("/church/team", requireUser, wrap(async (req, res) => {   // { section, members: [{ name, email, role }] } - "Done"
    const c = await staffChurch(req), section = String(req.body.section || "");
    if (!SECTION[section]) throw bad("Admins, Users or Pedal Control.");
    const list = (Array.isArray(req.body.members) ? req.body.members : []).slice(0, 50), results = [];
    for (const m of list) {
      const email = String(m.email || "").trim().toLowerCase(), name = String(m.name || "").trim().slice(0, 80), role = String(m.role || "").trim().slice(0, 60);
      if (!emailOk(email)) { results.push({ email, ok: false, error: "That email doesn't look right." }); continue; }
      if (await one("SELECT 1 FROM invites WHERE church_id=$1 AND section=$2 AND email=$3", [c.id, section, email])) { results.push({ email, ok: false, error: "Already on this team (use Resend)." }); continue; }
      const client = await pool.connect(); let inv = null;
      try {
        await client.query("BEGIN");
        const k = (await client.query(`SELECT key FROM licenses WHERE church_id=$1 AND kind=$2 AND ${FREE_KEY} ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`, [c.id, SECTION[section].kind])).rows[0] || (trialActive(c) ? { key: await mintTrialKey(client, c, SECTION[section].kind) } : null);
        if (!k) { await client.query("ROLLBACK"); results.push({ email, ok: false, error: "No " + SECTION[section].kind + " keys left. Buy more in the store." }); continue; }
        await client.query("UPDATE licenses SET assigned_email=$1, assigned_name=$2 WHERE key=$3", [email, name, k.key]);
        inv = (await client.query("INSERT INTO invites (church_id,section,name,email,role_text,key,token) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *", [c.id, section, name, email, role, k.key, crypto.randomBytes(18).toString("base64url")])).rows[0];
        await client.query("COMMIT");
      } catch (e) { try { await client.query("ROLLBACK"); } catch (_) { } throw e; } finally { client.release(); }
      const existing = await one("SELECT id FROM users WHERE email=$1", [email]);   // (someone who already has an account and isn't in a church: they're in)
      if (existing && !(await churchOf(existing.id))) { try { await acceptInvite({ id: existing.id, email }, inv.token); } catch (_) { } }
      const r = await sendInvite(inv, c);
      results.push({ email, ok: true, sent: r.sent, why: r.why, key: pretty(inv.key), link: inviteLink(inv.token) });
    }
    res.json({ results });
  }));
  api.post("/church/team/resend", requireUser, wrap(async (req, res) => {
    const c = await staffChurch(req), inv = await one("SELECT * FROM invites WHERE id=$1 AND church_id=$2", [Number(req.body.id) || 0, c.id]);
    if (!inv) throw bad("Not on your team.", 404);
    const r = await sendInvite(inv, c);
    res.json({ ok: true, sent: r.sent, why: r.why, link: inviteLink(inv.token) });
  }));
  api.post("/church/team/remove", requireUser, wrap(async (req, res) => {   // off the team: their key is free again right away
    const c = await staffChurch(req), inv = await one("SELECT * FROM invites WHERE id=$1 AND church_id=$2", [Number(req.body.id) || 0, c.id]);
    if (!inv) throw bad("Not on your team.", 404);
    if (inv.section === "owner") { await q("DELETE FROM invites WHERE id=$1", [inv.id]); return res.json({ ok: true }); }
    if (inv.key) await freeKey(inv.key);
    await q("DELETE FROM invites WHERE id=$1", [inv.id]);
    if (inv.user_id) {   // (out of the church too, unless they're on another team or they're the main admin)
      const still = await one("SELECT 1 FROM invites WHERE church_id=$1 AND user_id=$2", [c.id, inv.user_id]);
      if (!still) await q("DELETE FROM church_members WHERE church_id=$1 AND user_id=$2 AND role<>'owner'", [c.id, inv.user_id]);
    }
    res.json({ ok: true });
  }));

  // move someone to another team (Admins, Users, Pedal Control): they keep their place in the church; their old key is
  // free again, they get a key of the new kind and an email with the new app and key; their church role follows
  // (Admins: admin; Users / Pedal Control: user - never the main admin's)
  api.post("/church/team/move", requireUser, wrap(async (req, res) => {
    const c = await staffChurch(req), to = String(req.body.section || "");
    const inv = await one("SELECT * FROM invites WHERE id=$1 AND church_id=$2", [Number(req.body.id) || 0, c.id]);
    if (!inv || inv.section === "owner") throw bad("Not on your team.", 404);
    if (!SECTION[to]) throw bad("Admins, Users or Pedal Control.");
    if (to === inv.section) throw bad("They're already on that team.");
    if (await one("SELECT 1 FROM invites WHERE church_id=$1 AND section=$2 AND email=$3", [c.id, to, inv.email])) throw bad((inv.name || inv.email) + " is already on that team. Remove them from this one instead.", 409);
    const client = await pool.connect(); let moved;
    try {
      await client.query("BEGIN");
      const k = (await client.query(`SELECT key FROM licenses WHERE church_id=$1 AND kind=$2 AND ${FREE_KEY} ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`, [c.id, SECTION[to].kind])).rows[0] || (trialActive(c) ? { key: await mintTrialKey(client, c, SECTION[to].kind) } : null);
      if (!k) { await client.query("ROLLBACK"); throw bad("No " + SECTION[to].kind + " keys left for " + SECTION[to].app + ". Buy more in the store, then move them.", 409); }
      await client.query("UPDATE licenses SET assigned_email=$1, assigned_name=$2, user_id=$3 WHERE key=$4", [inv.email, inv.name, inv.user_id, k.key]);
      if (inv.key) {   // (the old key: off its devices, nobody's)
        await client.query("DELETE FROM license_devices WHERE key=$1", [inv.key]);
        await client.query("UPDATE licenses SET user_id=NULL, assigned_email=NULL, assigned_name=NULL WHERE key=$1", [inv.key]);
      }
      moved = (await client.query("UPDATE invites SET section=$1, key=$2, reminders=0, reminded_at=NULL WHERE id=$3 RETURNING *", [to, k.key, inv.id])).rows[0];
      if (inv.user_id) {
        const admin = to === "admin" || !!(await client.query("SELECT 1 FROM invites WHERE church_id=$1 AND user_id=$2 AND section='admin' AND id<>$3", [c.id, inv.user_id, inv.id])).rows[0];
        await client.query("UPDATE church_members SET role=$1 WHERE church_id=$2 AND user_id=$3 AND role<>'owner'", [admin ? "admin" : "user", c.id, inv.user_id]);
      }
      await client.query("COMMIT");
    } catch (e) { try { await client.query("ROLLBACK"); } catch (_) { } throw e; } finally { client.release(); }
    const r = await sendInvite(moved, c, "moved");
    res.json({ ok: true, sent: r.sent, why: r.why, key: pretty(moved.key), app: SECTION[to].app, link: inviteLink(moved.token) });
  }));

  // ---- settings that follow the account (both devices of a key share them)
  api.get("/settings/:app", requireUser, wrap(async (req, res) => {
    const r = await one("SELECT data, updated_at FROM user_settings WHERE user_id=$1 AND app=$2", [req.user.id, String(req.params.app).slice(0, 40)]);
    res.json(r ? { data: r.data, updated: Number(r.updated_at) } : { data: null, updated: 0 });
  }));
  api.post("/settings/:app", requireUser, wrap(async (req, res) => {
    const app = String(req.params.app).slice(0, 40), data = req.body && req.body.data, at = Math.min(Date.now() + 60e3, Number(req.body && req.body.updated) || Date.now());
    if (!data || typeof data !== "object" || JSON.stringify(data).length > 200000) throw bad("Settings must be an object under 200 KB.");
    const r = await one(`INSERT INTO user_settings (user_id,app,data,updated_at) VALUES ($1,$2,$3,$4)
      ON CONFLICT (user_id,app) DO UPDATE SET data=EXCLUDED.data, updated_at=EXCLUDED.updated_at WHERE user_settings.updated_at <= EXCLUDED.updated_at RETURNING updated_at`, [req.user.id, app, data, at]);
    res.json({ ok: true, kept: !!r });
  }));

  // ---- Motion Audio staff (ADMIN_EMAILS): make keys (a pedal you build and ship, a replacement), find and fix keys
  api.post("/admin/keys", requireUser, wrap(async (req, res) => {
    if (!isAdmin(req.user)) throw bad("Admins only.", 403); await requireStep(req);
    const kind = String(req.body.kind || ""), n = Math.max(1, Math.min(100, Number(req.body.count) || 1)), note = String(req.body.note || "").slice(0, 200);
    if (!KEY_KINDS[kind]) throw bad("Kind must be P, A or U.");
    let churchId = null;
    if (req.body.church) { const c = await one("SELECT id FROM churches WHERE id=$1 OR admin_code=$2 OR user_code=$2", [Number(req.body.church) || 0, canon(req.body.church)]); if (!c) throw bad("No church with that id or code.", 404); churchId = c.id; }
    const keys = [];
    for (let i = 0; i < n; i++) { const k = newKey(kind); await q("INSERT INTO licenses (key,product,kind,church_id,note) VALUES ($1,'made',$2,$3,$4)", [k, kind, churchId, note]); keys.push(pretty(k)); }
    res.json({ keys });
  }));
  api.get("/admin/keys", requireUser, wrap(async (req, res) => {
    if (!isAdmin(req.user)) throw bad("Admins only.", 403); await requireStep(req);
    const s = canon(req.query.q || ""), name = String(req.query.q || "").trim().replace(/[%_\\]/g, "\\$&").slice(0, 100);
    const rows = await q(`SELECT l.*, c.name AS church FROM licenses l LEFT JOIN churches c ON c.id=l.church_id
      WHERE $1='' OR regexp_replace(upper(l.key),'[^A-Z0-9]','','g') LIKE '%'||$1||'%' OR c.name ILIKE '%'||$2||'%' ORDER BY l.created_at DESC LIMIT 200`, [s, name]);
    const devs = rows.length ? await q("SELECT * FROM license_devices WHERE key = ANY($1)", [rows.map((r) => r.key)]) : [];
    res.json({ keys: rows.map((l) => Object.assign(keyOut(l, devs.filter((d) => d.key === l.key), true), { church: l.church || "", note: l.note, created: l.created_at })) });
  }));
  api.post("/admin/keys/:key/:action", requireUser, wrap(async (req, res) => {
    if (!isAdmin(req.user)) throw bad("Admins only.", 403); await requireStep(req);
    const l = await findKey(req.params.key); if (!l) throw bad("No such key.", 404);
    const a = req.params.action;
    if (a === "release") await q("DELETE FROM license_devices WHERE key=$1", [l.key]);
    else if (a === "revoke" || a === "restore") await q("UPDATE licenses SET revoked=$1 WHERE key=$2", [a === "revoke", l.key]);
    else throw bad("Release, revoke or restore.");
    res.json({ ok: true });
  }));
}
