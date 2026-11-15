// The email list: "Get updates by email" on motionaudio.org/apps/pedal/ (Kickstarter news and what's new at Motion Audio).
// Someone leaves their email, gets one email with a link to confirm it was them (double opt-in, so nobody can sign up
// someone else), and once they press it they're on the list. The list itself lives in Resend's contacts, because the
// list emails go out from Resend Broadcasts, which puts the unsubscribe link in every one: RESEND_SEGMENT_ID is the
// segment they're added to. This table keeps our own copy (it's in the nightly backup too).
// Every email from here ends with MAILING_ADDRESS (US anti-spam law, CAN-SPAM); it's an env var so it isn't in the repo.
import crypto from "node:crypto";
import { q, one } from "./db.js";
import { config } from "./config.js";
import { isAdmin } from "./auth.js";
import { requireStep } from "./signin.js";
import { sendMail, mailOn, escHtml } from "./mail.js";

const KEY = process.env.RESEND_API_KEY || "", SEGMENT = (process.env.RESEND_SEGMENT_ID || "").trim();
const ADDRESS = (process.env.MAILING_ADDRESS || "").trim();
const API = (process.env.RESEND_API_BASE || "https://api.resend.com").replace(/\/+$/, "");
export const listOn = !!(KEY && SEGMENT);
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 254;
const clip = (s, n) => String(s == null ? "" : s).trim().slice(0, n);
function bad(msg, status = 400) { const e = new Error(msg); e.status = status; return e; }

// ---------------------------------------------------------------- Resend contacts
async function resend(method, path, body) {
  const r = await fetch(API + path, { method, headers: { Authorization: "Bearer " + KEY, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
  const text = await r.text();
  return { ok: r.ok, status: r.status, text: text.slice(0, 300) };
}
// on the list in Resend: the contact (made if it's new, subscribed again if it was off) and in the launch segment
export async function syncIn(row) {
  if (!listOn) return { synced: false, why: "RESEND_API_KEY or RESEND_SEGMENT_ID isn't set" };
  const email = encodeURIComponent(row.email);
  const made = await resend("POST", "/contacts", Object.assign({ email: row.email, unsubscribed: false }, row.name ? { first_name: row.name } : {}));
  if (!made.ok) {   // (already a contact: just make sure they're subscribed)
    const upd = await resend("PATCH", "/contacts/" + email, { unsubscribed: false });
    if (!upd.ok) return { synced: false, why: "Resend answered " + made.status + ": " + made.text };
  }
  const seg = await resend("POST", "/contacts/" + email + "/segments/" + encodeURIComponent(SEGMENT));
  if (!seg.ok && seg.status !== 409) return { synced: false, why: "Resend (segment) answered " + seg.status + ": " + seg.text };
  await q("UPDATE launch_list SET synced_at=now() WHERE id=$1", [row.id]);
  return { synced: true };
}

// ---------------------------------------------------------------- the emails
const footerText = () => "\n\n--\nMotion Audio" + (ADDRESS ? ", " + ADDRESS : "") + "\nYou're getting this because this email was signed up for Motion Audio updates at motionaudio.org.";
const footerHtml = () => '<p style="color:#69717D;font-size:12px;line-height:1.5;margin:22px 0 0">Motion Audio' + (ADDRESS ? ", " + escHtml(ADDRESS) : "") + "<br>You're getting this because this email was signed up for Motion Audio updates at motionaudio.org.</p>";
function confirmLink(row) { return config.publicUrl + "/v1/launch-list/confirm?t=" + row.token; }
async function sendConfirm(row) {
  const link = confirmLink(row);
  const r = await sendMail(row.email, "Confirm your email for Motion Audio updates",
    "Hi" + (row.name ? " " + row.name : "") + ",\n\nThanks for signing up for updates from Motion Audio. Press this link to confirm it was you:\n\n" + link +
      "\n\nOnce you do, I'll email you when Central Pedal goes on Kickstarter and when there's something new to show you. If you didn't ask for this, just ignore this email and you won't hear from me again.\n\nSam, Motion Audio" + footerText(),
    "<p>Hi" + (row.name ? " " + escHtml(row.name) : "") + ",</p><p>Thanks for signing up for updates from Motion Audio. Press the button to confirm it was you.</p>" +
      '<p><a href="' + escHtml(link) + '" style="display:inline-block;background:#15181D;color:#ECE7DD;text-decoration:none;padding:11px 18px;border-radius:8px;font-weight:600">Yes, sign me up</a></p>' +
      "<p>Once you do, I'll email you when Central Pedal goes on Kickstarter and when there's something new to show you. If you didn't ask for this, just ignore this email and you won't hear from me again.</p><p>Sam, Motion Audio</p>" + footerHtml());
  if (r.sent) await q("UPDATE launch_list SET confirm_sent_at=now() WHERE id=$1", [row.id]);
  return r;
}

// a small page for the confirm link (it's opened from an email, so it gets a page, not JSON)
function page(res, title, text, status = 200) {
  res.status(status).type("html").send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escHtml(title)} | Motion Audio</title><link rel="stylesheet" href="/site.css"></head>
<body><main class="wrap" style="max-width:560px;padding:4rem 1.2rem"><p class="label">Motion Audio updates</p><h1 style="font-size:1.8rem">${escHtml(title)}</h1><p>${text}</p><p><a class="btn ghost" href="/apps/pedal/">Back to Central Pedal</a></p></main></body></html>`);
}

export function routes(api, { wrap, requireUser }) {
  // at most 8 sign-ups an hour from one internet address (a church on one Wi-Fi is fine; a script filling it isn't)
  const recent = new Map();
  setInterval(() => { const now = Date.now(); for (const [k, t] of recent) if (!t.some((x) => now - x < 3600e3)) recent.delete(k); }, 600e3).unref();

  api.post("/launch-list", wrap(async (req, res) => {
    const b = req.body || {};
    if (clip(b.website, 200)) return res.json({ ok: true });   // (the hidden field only a robot fills in)
    const email = clip(b.email, 254).toLowerCase(), name = clip(b.name, 80), source = clip(b.source, 40);
    if (!emailOk(email)) throw bad("That email address doesn't look right.");
    const now = Date.now(), t = (recent.get(req.ip) || []).filter((x) => now - x < 3600e3);
    if (t.length >= 8) throw bad("Too many sign-ups from here. Try again in an hour.", 429);
    t.push(now); recent.set(req.ip, t);
    let row = await one("SELECT * FROM launch_list WHERE email=$1", [email]);
    if (!row) row = await one("INSERT INTO launch_list (email,name,source,token) VALUES ($1,$2,$3,$4) ON CONFLICT (email) DO UPDATE SET email=EXCLUDED.email RETURNING *", [email, name, source, crypto.randomBytes(24).toString("base64url")]);
    else if (row.unsubscribed_at) row = await one("UPDATE launch_list SET unsubscribed_at=NULL, confirmed_at=NULL, name=COALESCE(NULLIF($2,''),name) WHERE id=$1 RETURNING *", [row.id, name]);   // (coming back: confirm again)
    // the answer is the same whether they were on the list already or not, so the form can't be used to look people up
    if (row.confirmed_at && !row.unsubscribed_at) return res.json({ ok: true, confirm: false });
    if (!mailOn) {   // (email isn't set up on the website: no way to confirm, so they're on the list as they are)
      row = await one("UPDATE launch_list SET confirmed_at=now() WHERE id=$1 RETURNING *", [row.id]);
      await syncIn(row).catch((e) => console.error("launch list:", e.message));
      return res.json({ ok: true, confirm: false });
    }
    if (row.confirm_sent_at && Date.now() - new Date(row.confirm_sent_at).getTime() < 10 * 60e3) return res.json({ ok: true, confirm: true });   // (one email per 10 minutes)
    const sent = await sendConfirm(row);
    if (!sent.sent) { console.error("launch list confirm email:", sent.why); throw bad("We couldn't send the email just now. Try again in a few minutes.", 503); }
    res.json({ ok: true, confirm: true });
  }));

  api.get("/launch-list/confirm", wrap(async (req, res) => {
    let row = await one("SELECT * FROM launch_list WHERE token=$1", [clip(req.query.t, 100)]);
    if (!row) return page(res, "That link didn't work", "It may be old or cut short. You can sign up again on the <a href=\"/apps/pedal/#launch-list\">Central Pedal page</a>.", 404);
    if (!row.confirmed_at || row.unsubscribed_at) row = await one("UPDATE launch_list SET confirmed_at=now(), unsubscribed_at=NULL WHERE id=$1 RETURNING *", [row.id]);
    const s = await syncIn(row).catch((e) => ({ synced: false, why: e.message }));
    if (!s.synced && listOn) console.error("launch list sync:", s.why);
    page(res, "You're on the list", "Thanks. I'll email you when Central Pedal goes on Kickstarter and when there's something new to show you. Every email has a link to leave the list, and I won't share your address with anyone.");
  }));

  // staff: how many are on it, and whether the website is set up to add them to Resend
  api.get("/admin/launch-list", requireUser, wrap(async (req, res) => {
    if (!isAdmin(req.user)) throw bad("Admins only.", 403);
    const n = await one(`SELECT COUNT(*) FILTER (WHERE confirmed_at IS NOT NULL AND unsubscribed_at IS NULL)::int AS confirmed,
      COUNT(*) FILTER (WHERE confirmed_at IS NULL AND unsubscribed_at IS NULL)::int AS waiting, COUNT(*) FILTER (WHERE unsubscribed_at IS NOT NULL)::int AS left,
      COUNT(*) FILTER (WHERE confirmed_at IS NOT NULL AND unsubscribed_at IS NULL AND synced_at IS NULL)::int AS not_in_resend FROM launch_list`);
    res.json(Object.assign({ email: mailOn, resend: listOn, address: !!ADDRESS }, n));
  }));
  // staff: put everyone confirmed who isn't in Resend yet into it (after RESEND_SEGMENT_ID is set for the first time)
  api.post("/admin/launch-list/sync", requireUser, wrap(async (req, res) => {
    if (!isAdmin(req.user)) throw bad("Admins only.", 403); await requireStep(req);
    if (!listOn) throw bad("Set RESEND_API_KEY and RESEND_SEGMENT_ID on Render first.");
    const rows = await q("SELECT * FROM launch_list WHERE confirmed_at IS NOT NULL AND unsubscribed_at IS NULL AND synced_at IS NULL ORDER BY id LIMIT 500");
    let done = 0; const errors = [];
    for (const r of rows) { const s = await syncIn(r).catch((e) => ({ synced: false, why: e.message })); if (s.synced) done++; else if (errors.length < 5) errors.push(r.email + ": " + s.why); }
    res.json({ added: done, tried: rows.length, errors });
  }));
}
