// Sound plans (9.5): Central Keys, Central Plugins, Central Instrument and Central Pedals, yearly, as package keys.
//  - Buying plans (a yearly Stripe subscription) gives one package key, SXXX-XXXX-XXXX-XXXX, with those plans. It's
//    emailed to the buyer and on their Account page. It lasts as long as the subscription: renewals carry it on; when the
//    subscription ends, the key's package ends too.
//  - A church bundle (all four plans for N people) gives N package keys. The church account, the main admins and admins
//    give them to people on the Teams page (each gets theirs by email) and take them back: the key taken back stops
//    working and a new one takes its place, ready for someone else.
//  - A free trial (TRIALRUN, 7FREE) gives trial package keys with all four plans until the trial ends.
// On any device (Central Pedal, Central Pedal Control, Central Control, Central Usage): Settings → Packages → Add a
// package, paste the key. It works on PACKAGE_DEVICES devices at a time. The apps use /v1/package/activate, /check and
// /release (below); they check again every few days.
import crypto from "node:crypto";
import { q, one, pool } from "./db.js";
import { config, PLANS, PLAN_IDS, PACKAGE_DEVICES } from "./config.js";
import { requireStep } from "./signin.js";
import { sendMail, escHtml, mailOn } from "./mail.js";

function bad(msg, status = 400) { const e = new Error(msg); e.status = status; return e; }
const isMain = (role) => role === "church" || role === "owner";
const trialOn = (c) => !!(c && c.trial_until && new Date(c.trial_until) > new Date());
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const ABC = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";   // (the same signs as the P, A and U keys)
export const canon = (k) => String(k || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
export const pretty = (k) => { const c = canon(k); return c.length === 16 ? c.match(/.{4}/g).join("-") : String(k); };
function newPackageKey() { let s = "S"; for (let i = 0; i < 15; i++) s += ABC[crypto.randomInt(ABC.length)]; return s; }
const day = (d) => new Date(d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: config.timeZone || "America/Chicago" });
const APPS = { pedal: "Central Pedal", "pedal-control": "Central Pedal Control", control: "Central Control", usage: "Central Usage" };
const planNames = (plans) => (PLAN_IDS.every((id) => plans.includes(id)) ? "all four sound plans" : PLAN_IDS.filter((id) => plans.includes(id)).map((id) => PLANS[id].name).join(" and "));

// a subscription counts while Stripe says it's on and it's paid through a date still ahead. A renewal that didn't go
// through (past_due) keeps it 14 more days while Stripe tries the card again.
const endOf = (p) => `(CASE WHEN ${p}status='past_due' THEN LEAST(${p}period_end, COALESCE(${p}past_due_since, now()) + interval '14 days') ELSE ${p}period_end END)`;
export const PLAN_END = endOf("");
export const PLAN_LIVE = "status IN ('active','trialing','past_due') AND period_end IS NOT NULL AND " + PLAN_END + " > now()";
// a package key with what decides it: ends (the date its plans end, or ended), live
const KEY_SQL = `SELECT k.*, c.name AS church, c.closed_at, s.status AS sub_status, s.kind AS sub_kind, s.cancel_at_period_end,
    CASE WHEN k.trial THEN k.ends_at WHEN s.status IN ('active','trialing','past_due') THEN ${endOf("s.")} ELSE COALESCE(LEAST(s.ended_at, s.period_end), s.period_end) END AS ends,
    (CASE WHEN k.trial THEN k.ends_at > now() ELSE s.status IN ('active','trialing','past_due') AND s.period_end IS NOT NULL AND ${endOf("s.")} > now() END) AS live
  FROM package_keys k LEFT JOIN plan_subs s ON s.id=k.plan_sub_id LEFT JOIN churches c ON c.id=k.church_id`;
// a person's package keys: bought by them, or given to them
export const packageRows = (email, userId) => q(KEY_SQL + " WHERE NOT k.revoked AND (k.holder_email=$1 OR (k.user_id=$2 AND k.church_id IS NULL)) ORDER BY k.created_at DESC", [String(email || "").toLowerCase(), userId]);
const findKey = async (key) => { const c = canon(key); return c.length === 16 && c[0] === "S" ? one(KEY_SQL + " WHERE k.key=$1", [c]) : null; };

// what a key gives now: { ok, plans: { keys: "<ISO end>" }, end, error }
export function keyState(k) {
  if (!k) return { ok: false, error: "That package key isn't right. Check it in the email it came in, or on your account page." };
  if (k.revoked) return { ok: false, error: k.revoked_why === "replaced" ? "This package key was given to someone else. Ask your church's main admin for yours." : "This package key was taken back. Ask your church's main admin." };
  if (k.closed_at) return { ok: false, error: "This package's church was closed." };
  if (!k.live) return { ok: false, end: k.ends ? new Date(k.ends).toISOString() : null, error: k.ends ? (k.trial ? "This free trial package ended on " + day(k.ends) + ". Get sound plans on the website's store." : "This package ended on " + day(k.ends) + ". Renew it on your account page.") : "This package isn't paid for yet. Finish the checkout on the website." };
  const end = new Date(k.ends).toISOString();
  return { ok: true, plans: Object.fromEntries(PLAN_IDS.filter((id) => k.plans.includes(id)).map((id) => [id, end])), end };
}

// ---------------------------------------------------------------- making and giving keys
async function insertKey(client, row) {
  for (let tries = 0; tries < 5; tries++) {
    const k = newPackageKey();
    const r = await client.query(`INSERT INTO package_keys (key,plans,plan_sub_id,church_id,user_id,holder_email,holder_name,given_at,trial,ends_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (key) DO NOTHING RETURNING key`,
      [k, row.plans, row.plan_sub_id || null, row.church_id || null, row.user_id || null, row.holder_email || null, row.holder_name || "", row.holder_email ? new Date() : null, !!row.trial, row.ends_at || null]);
    if (r.rows[0]) return k;
  }
  throw bad("Couldn't make a package key. Try again.", 500);
}
// the email with a package key (to the buyer, or to the person the church gave it to)
export async function sendPackage(key, how) {
  const k = await findKey(key); if (!k || !k.holder_email) return { sent: false, why: "nobody to send it to" };
  const name = k.holder_name, what = planNames(k.plans), link = config.publicUrl + "/#account";
  const lead = how === "bought" ? "Thanks for getting " + what + "! Here's your package key."
    : k.trial ? (k.church || "Your church") + "'s free trial includes " + what + " until " + day(k.ends) + ". Here's your package key."
    : (k.church || "Your church") + " gave you " + what + ". Here's your package key.";
  const steps = "On any of your devices - Central Pedal, Central Pedal Control, Central Control or Central Usage - open Settings → Packages → Add a package, and paste it. It works on " + PACKAGE_DEVICES + " devices at a time.";
  const text = "Hi" + (name ? " " + name : "") + ",\n\n" + lead + "\n\n    " + pretty(k.key) + "\n\n" + steps + "\n\n" + (k.trial ? "" : "It's yours until " + day(k.ends) + (k.sub_kind === "person" && !k.cancel_at_period_end ? ", and it renews by itself every year" : "") + ". ") + "It's on your account page too: " + link + "\n\nTalk soon,\nThe Motion Audio team\n";
  const html = '<div style="font:15px/1.5 system-ui,sans-serif;color:#10202e;max-width:520px"><p>Hi' + (name ? " " + escHtml(name) : "") + ",</p><p>" + escHtml(lead) + "</p>" +
    '<p><code style="font:600 20px ui-monospace,monospace;letter-spacing:.05em">' + escHtml(pretty(k.key)) + "</code></p><p>" + escHtml(steps) + "</p>" +
    "<p>" + (k.trial ? "" : "It's yours until <b>" + escHtml(day(k.ends)) + "</b>" + (k.sub_kind === "person" && !k.cancel_at_period_end ? ", and it renews by itself every year" : "") + ". ") + 'It\'s on your <a href="' + escHtml(link) + '">account page</a> too.</p><p>Talk soon,<br>The Motion Audio team</p></div>';
  return sendMail(k.holder_email, (how === "bought" ? "Your package key: " : "Your package key from " + (k.church || "your church") + ": ") + (what[0].toUpperCase() + what.slice(1)), text, html);
}
// a paid checkout: its keys (once, however often Stripe repeats itself). A person's key is theirs and emailed to them;
// a bundle's wait on the Teams page.
export async function issuePackages(subId) {
  const client = await pool.connect(); let made = [], person = null;
  try {
    await client.query("BEGIN");
    const s = (await client.query("SELECT * FROM plan_subs WHERE id=$1 FOR UPDATE", [subId])).rows[0];
    if (s && !(await client.query("SELECT 1 FROM package_keys WHERE plan_sub_id=$1", [subId])).rows[0]) {
      if (s.kind === "person") {
        person = (await client.query("SELECT email, name FROM users WHERE id=$1", [s.user_id])).rows[0];
        made.push(await insertKey(client, { plans: s.plans, plan_sub_id: s.id, user_id: s.user_id, holder_email: person && person.email, holder_name: person && person.name }));
      } else for (let i = 0; i < s.seats; i++) made.push(await insertKey(client, { plans: PLAN_IDS, plan_sub_id: s.id, church_id: s.church_id }));
    }
    await client.query("COMMIT");
  } catch (e) { try { await client.query("ROLLBACK"); } catch (_) { } throw e; } finally { client.release(); }
  if (person) for (const k of made) await sendPackage(k, "bought");
  return made;
}
// a free trial: a package key with all four plans until the trial ends (for someone, or for the Teams page to give)
export async function mintTrialPackage(church, holder) {
  const client = await pool.connect();
  try { return await insertKey(client, { plans: PLAN_IDS, church_id: church.id, trial: true, ends_at: church.trial_until, holder_email: holder && holder.email, holder_name: holder && holder.name }); }
  finally { client.release(); }
}
// take a church's key back: it stops working, and a new key with the same plans takes its place (nobody's yet)
async function replaceKey(client, k) {
  await client.query("UPDATE package_keys SET revoked=TRUE, revoked_why='replaced' WHERE key=$1", [k.key]);
  await client.query("DELETE FROM package_devices WHERE key=$1", [k.key]);
  if (k.trial) return null;   // (a trial key: more are made as they're needed)
  return insertKey(client, { plans: k.plans, plan_sub_id: k.plan_sub_id, church_id: k.church_id });
}
// someone left the church (taken out, off every team, their account deleted): the church's keys they had come back
export async function takeBackAll(churchId, email) {
  if (!email) return;
  const keys = await q("SELECT * FROM package_keys WHERE holder_email=$1 AND church_id IS NOT NULL AND NOT revoked" + (churchId ? " AND church_id=$2" : ""), churchId ? [String(email).toLowerCase(), churchId] : [String(email).toLowerCase()]);
  for (const k of keys) { const client = await pool.connect(); try { await client.query("BEGIN"); await replaceKey(client, k); await client.query("COMMIT"); } catch (e) { await client.query("ROLLBACK").catch(() => { }); throw e; } finally { client.release(); } }
}

// ---------------------------------------------------------------- Central Tracks Unlimited (for /license/check)
// the person a license key belongs to: the account signed in with it, else the person the Teams page gave it to, else
// (nobody's: a spare) the church itself - its church account (or, before 9.3.1, its main admin)
export async function keyPerson(l) {
  if (l.user_id) { const u = await one("SELECT id, email, subscribed FROM users WHERE id=$1 AND deleted_at IS NULL", [l.user_id]); if (u) return u; }
  if (l.assigned_email) return (await one("SELECT id, email, subscribed FROM users WHERE email=$1 AND deleted_at IS NULL", [l.assigned_email])) || { id: null, email: l.assigned_email, subscribed: false };
  if (!l.church_id) return null;
  const acct = await one("SELECT u.id, u.email, u.subscribed FROM church_members m JOIN users u ON u.id=m.user_id WHERE m.church_id=$1 AND m.role='church'", [l.church_id])
    || await one("SELECT u.id, u.email, u.subscribed FROM churches c JOIN users u ON u.id=c.owner_id WHERE c.id=$1", [l.church_id]);
  return acct ? Object.assign({ churchKey: true }, acct) : null;
}
// the person's own subscription, or the church's (or its free trial), which covers the church account, the main admins,
// Pedal Control (P keys) and the church's own spare keys - not each user
export async function tracksUnlimitedFor(l) {
  const person = await keyPerson(l), church = l.church_id ? await one("SELECT * FROM churches WHERE id=$1", [l.church_id]) : null;
  if (person && person.subscribed) return true;
  if (!church || !(church.subscribed || trialOn(church))) return false;
  if (l.kind === "P" || (person && person.churchKey)) return true;
  if (!person || !person.id) return false;
  const m = await one("SELECT role FROM church_members WHERE church_id=$1 AND user_id=$2", [church.id, person.id]);
  return !!(m && isMain(m.role));
}

// ---------------------------------------------------------------- the API
export function routes(api, { wrap, requireUser }) {
  // wrong keys: 30 from one address in 15 minutes and it waits (right keys don't count)
  const misses = new Map(), recent = (k) => (misses.get(k) || []).filter((x) => Date.now() - x < 15 * 60e3);
  const braked = (req) => recent(req.ip).length >= 30, miss = (req) => { const t = recent(req.ip); t.push(Date.now()); misses.set(req.ip, t); };
  setInterval(() => { for (const k of misses.keys()) if (!recent(k).length) misses.delete(k); }, 10 * 60e3).unref();
  const devOk = (d) => /^[A-Za-z0-9-]{8,80}$/.test(String(d || ""));
  const devicesOf = (key) => q("SELECT * FROM package_devices WHERE key=$1 ORDER BY activated_at", [key]);
  const holderOf = (k) => k.holder_name || k.holder_email || "";

  // ---- the apps: Settings → Packages
  // { key, deviceId, app, deviceName? } → { ok: true, key, plans: { keys: "<ISO end>", ... }, end, holder, church } | { ok: false, error }
  api.post("/package/activate", wrap(async (req, res) => {
    const b = req.body || {};
    if (braked(req)) return res.json({ ok: false, error: "Too many wrong keys. Wait a few minutes and try again." });
    if (!devOk(b.deviceId)) return res.json({ ok: false, error: "This device has no id yet. Restart the app and try again." });
    const app = String(b.app || ""); if (!APPS[app]) return res.json({ ok: false, error: "Unknown app." });
    const client = await pool.connect(); let k, st;
    try {
      await client.query("BEGIN");
      const c = canon(b.key);
      if (c.length === 16 && c[0] === "S") await client.query("SELECT key FROM package_keys WHERE key=$1 FOR UPDATE", [c]);   // (two devices at the same moment take turns)
      k = await findKey(c); st = keyState(k);
      if (!k) miss(req);
      if (!st.ok) { await client.query("ROLLBACK"); return res.json({ ok: false, error: st.error }); }
      const devs = (await client.query("SELECT * FROM package_devices WHERE key=$1", [k.key])).rows, here = devs.some((d) => d.device_id === b.deviceId), others = devs.filter((d) => d.device_id !== b.deviceId);
      if (!here && others.length >= PACKAGE_DEVICES) {
        await client.query("ROLLBACK");
        return res.json({ ok: false, error: "This package is already on " + others.map((d) => "“" + (d.device_name || APPS[d.app] || "another device") + "”").join(" and ") + " (it works on " + PACKAGE_DEVICES + " devices at a time). Release it on one of them (Settings → Packages) or on your account page, then try again." });
      }
      await client.query(`INSERT INTO package_devices (key,device_id,app,device_name) VALUES ($1,$2,$3,$4)
        ON CONFLICT (key,device_id) DO UPDATE SET app=EXCLUDED.app, device_name=EXCLUDED.device_name, last_seen=now()`, [k.key, b.deviceId, app, String(b.deviceName || "").trim().slice(0, 80) || APPS[app]]);
      await client.query("COMMIT");
    } catch (e) { try { await client.query("ROLLBACK"); } catch (_) { } throw e; } finally { client.release(); }
    res.json({ ok: true, key: pretty(k.key), plans: st.plans, end: st.end, holder: holderOf(k), church: k.church || "", trial: !!k.trial });
  }));
  // { keys: [...], deviceId } → { packages: [{ key, ok, plans, end, error? }] }
  api.post("/package/check", wrap(async (req, res) => {
    const b = req.body || {}, keys = (Array.isArray(b.keys) ? b.keys : []).slice(0, 20), out = [];
    for (const key of keys) {
      const k = await findKey(key), st = keyState(k);
      if (!k) miss(req);
      if (st.ok && !(await one("SELECT 1 FROM package_devices WHERE key=$1 AND device_id=$2", [k.key, String(b.deviceId || "")]))) { out.push({ key: pretty(key), ok: false, plans: {}, end: st.end, error: "This package was released from this device. Add it again (Settings → Packages → Add a package)." }); continue; }
      if (st.ok) await q("UPDATE package_devices SET last_seen=now() WHERE key=$1 AND device_id=$2", [k.key, String(b.deviceId)]);
      out.push({ key: pretty(key), ok: st.ok, plans: st.plans || {}, end: st.end || null, error: st.error });
    }
    res.json({ packages: out });
  }));
  api.post("/package/release", wrap(async (req, res) => {   // from the device that has it
    const b = req.body || {}, c = canon(b.key);
    if (c.length === 16) await q("DELETE FROM package_devices WHERE key=$1 AND device_id=$2", [c, String(b.deviceId || "")]);
    res.json({ ok: true });
  }));

  // ---- the Account page: my package keys (bought, or given to me), their devices
  const keyOut = (k, devs) => {
    const st = keyState(k);
    return { key: pretty(k.key), plans: k.plans, ok: st.ok, end: k.ends ? new Date(k.ends).toISOString() : null, error: st.ok ? undefined : st.error, trial: k.trial,
      from: k.trial ? "trial" : k.sub_kind === "bundle" ? "church" : "own", church: k.church || null, renews: k.sub_kind === "person" && st.ok && !k.cancel_at_period_end && k.sub_status !== "past_due", pastDue: k.sub_status === "past_due",
      holder: k.holder_email ? { email: k.holder_email, name: k.holder_name } : null,
      devices: devs.map((d) => ({ id: d.device_id, name: d.device_name || APPS[d.app] || "a device", app: APPS[d.app] || d.app, lastSeen: d.last_seen })), max: PACKAGE_DEVICES };
  };
  api.get("/packages/mine", requireUser, wrap(async (req, res) => {
    const rows = await packageRows(req.user.email, req.user.id);
    const devs = rows.length ? await q("SELECT * FROM package_devices WHERE key = ANY($1) ORDER BY activated_at", [rows.map((r) => r.key)]) : [];
    res.json({ packages: rows.filter((k) => keyState(k).ok || k.ends).map((k) => keyOut(k, devs.filter((d) => d.key === k.key))) });
  }));
  // release a package from a device (one that's lost or broken): the person it's for, its buyer, or the church's staff
  api.post("/packages/release", requireUser, wrap(async (req, res) => {
    const k = await findKey(req.body.key); if (!k) throw bad("That package key isn't right.", 404);
    let may = k.holder_email === req.user.email.toLowerCase() || (k.user_id === req.user.id && !k.church_id);
    if (!may && k.church_id) { const m = await one("SELECT role FROM church_members WHERE church_id=$1 AND user_id=$2", [k.church_id, req.user.id]); may = !!(m && (isMain(m.role) || m.role === "admin")); }
    if (!may) throw bad("That isn't one of your packages.", 403);
    if (req.body.device) await q("DELETE FROM package_devices WHERE key=$1 AND device_id=$2", [k.key, String(req.body.device)]);
    else await q("DELETE FROM package_devices WHERE key=$1", [k.key]);
    res.json({ ok: true });
  }));

  // ---- the Teams page: the church's package keys (bundles and the free trial)
  async function staffChurch(req) {
    const c = await one("SELECT c.*, m.role FROM church_members m JOIN churches c ON c.id=m.church_id WHERE m.user_id=$1", [req.user.id]);
    if (!c || !(isMain(c.role) || c.role === "admin")) throw bad("Only the church account, the main admins and admins hand out package keys.", 403);
    await requireStep(req);
    return c;
  }
  const people = (c) => q(`SELECT email, MAX(name) AS name FROM (
      SELECT u.email, u.name FROM church_members m JOIN users u ON u.id=m.user_id WHERE m.church_id=$1 AND u.deleted_at IS NULL
      UNION ALL SELECT email, name FROM invites WHERE church_id=$1 AND section<>'owner') x GROUP BY email ORDER BY MAX(name), email`, [c.id]);
  async function view(c) {
    const rows = await q(KEY_SQL + " WHERE k.church_id=$1 AND NOT k.revoked ORDER BY k.holder_email NULLS LAST, k.created_at", [c.id]);
    const live = rows.filter((k) => keyState(k).ok);
    const devs = live.length ? await q("SELECT * FROM package_devices WHERE key = ANY($1) ORDER BY activated_at", [live.map((r) => r.key)]) : [];
    const subs = await q(`SELECT id, seats, ${PLAN_END} AS ends, cancel_at_period_end, status FROM plan_subs WHERE kind='bundle' AND church_id=$1 AND ${PLAN_LIVE} ORDER BY id`, [c.id]);
    const all = await people(c), given = live.filter((k) => k.holder_email);
    return {
      bundles: subs.map((s) => ({ id: String(s.id), seats: s.seats, until: s.ends, renews: !s.cancel_at_period_end && s.status !== "past_due" })),
      total: live.filter((k) => !k.trial).length, given: given.length, free: live.filter((k) => !k.holder_email).length, trialUntil: trialOn(c) ? c.trial_until : null,
      keys: live.map((k) => keyOut(k, devs.filter((d) => d.key === k.key))),
      people: all.filter((p) => !given.some((k) => k.holder_email === p.email)).map((p) => ({ email: p.email, name: p.name || "" })), mail: mailOn,
    };
  }
  api.get("/church/packages", requireUser, wrap(async (req, res) => res.json(await view(await staffChurch(req)))));
  // give a package key to someone in the church: { email, name, key? } - a free key (or, in a free trial, a new trial key)
  api.post("/church/packages/give", requireUser, wrap(async (req, res) => {
    const c = await staffChurch(req), email = String(req.body.email || "").trim().toLowerCase();
    if (!emailOk(email)) throw bad("That email doesn't look right.");
    const who = (await people(c)).find((p) => p.email === email);
    if (!who) throw bad(email + " isn't in " + c.name + ". Add them on a team first (or they join with the church's code).", 404);
    const name = String(req.body.name || who.name || "").trim().slice(0, 80);
    const client = await pool.connect(); let key;
    try {
      await client.query("BEGIN");
      await client.query("SELECT id FROM churches WHERE id=$1 FOR UPDATE", [c.id]);   // (two people giving the last key take turns)
      const has = (await client.query(KEY_SQL + " WHERE k.church_id=$1 AND k.holder_email=$2 AND NOT k.revoked", [c.id, email])).rows.find((k) => keyState(k).ok);
      if (has) throw bad((name || email) + " has a package key already (" + pretty(has.key) + "). Use Resend.", 409);
      const want = req.body.key ? canon(req.body.key) : null;
      const free = (await client.query(KEY_SQL + " WHERE k.church_id=$1 AND k.holder_email IS NULL AND NOT k.revoked ORDER BY k.trial, k.created_at", [c.id])).rows.filter((k) => keyState(k).ok && (!want || k.key === want));
      if (free[0]) { key = free[0].key; await client.query("UPDATE package_keys SET holder_email=$1, holder_name=$2, given_at=now() WHERE key=$3", [email, name, key]); }
      else if (trialOn(c)) key = await insertKey(client, { plans: PLAN_IDS, church_id: c.id, trial: true, ends_at: c.trial_until, holder_email: email, holder_name: name });
      else {
        const total = (await client.query(KEY_SQL + " WHERE k.church_id=$1 AND NOT k.revoked", [c.id])).rows.filter((k) => keyState(k).ok).length;
        throw bad(total ? "All " + total + " package keys are given. Take one back, or add another bundle in the store." : c.name + " has no sound plan bundle yet. Get one in the store (Sound plans → For your church).", total ? 409 : 402);
      }
      await client.query("COMMIT");
    } catch (e) { try { await client.query("ROLLBACK"); } catch (_) { } throw e; } finally { client.release(); }
    const r = await sendPackage(key, "given");
    res.json(Object.assign({ ok: true, key: pretty(key), email, sent: !!r.sent, why: r.why }, await view(c)));
  }));
  // take a key back: it stops working on their devices; a new key takes its place, free for someone else
  api.post("/church/packages/take-back", requireUser, wrap(async (req, res) => {
    const c = await staffChurch(req), k = await findKey(req.body.key);
    if (!k || k.church_id !== c.id || k.revoked) throw bad("That isn't one of " + c.name + "'s package keys.", 404);
    if (!k.holder_email) throw bad("Nobody has that key.", 400);
    const client = await pool.connect(); let fresh;
    try { await client.query("BEGIN"); fresh = await replaceKey(client, k); await client.query("COMMIT"); }
    catch (e) { try { await client.query("ROLLBACK"); } catch (_) { } throw e; } finally { client.release(); }
    res.json(Object.assign({ ok: true, replacedBy: fresh ? pretty(fresh) : null }, await view(c)));
  }));
  api.post("/church/packages/resend", requireUser, wrap(async (req, res) => {
    const c = await staffChurch(req), k = await findKey(req.body.key);
    if (!k || k.church_id !== c.id || k.revoked || !k.holder_email) throw bad("That isn't a key you gave someone.", 404);
    const r = await sendPackage(k.key, "given");
    res.json({ ok: true, sent: !!r.sent, why: r.why });
  }));
}
