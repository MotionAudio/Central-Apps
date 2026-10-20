// Signing in. Everyone: email and password. The main admin and admins (and Motion Audio staff) also: a 6-digit code
// sent to their phone - once per device, which is then trusted for 30 days. Codes go by text message through Twilio
// (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM); until Twilio is set up they go by email instead. With no way to
// send a code at all (no Twilio and no email), the code step is skipped.
// Adding the phone (the first time, or a number not confirmed yet) needs two codes: one texted to the phone and one
// emailed - so knowing the password isn't enough to put someone else's phone on an account. Changing it later is in
// Account (signed in, with the password, and a code to the new number). A new phone always gets an email notice.
// Every place that hands out a sign-in goes through issue(): { token } or { step: "phone" | "code", ticket, to, both }.
// A token from a sign-in that passed the code is marked; admin tools (requireStep) need that mark.
import crypto from "node:crypto";
import { q, one } from "./db.js";
import { config } from "./config.js";
import { makeToken, isAdmin, checkPassword } from "./auth.js";
import { sendMail, mailOn, escHtml } from "./mail.js";

function bad(msg, status = 400) { const e = new Error(msg); e.status = status; return e; }
const hash = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");
const TRUST_DAYS = 30, CODE_MINUTES = 10, MAX_TRIES = 5, MAX_SENDS = 5, SMS_PER_USER_DAY = 10, SMS_PER_PHONE_DAY = 8;
const COUNTRIES = String(process.env.SMS_COUNTRIES || "1").split(",").map((s) => s.trim().replace(/\D/g, "")).filter(Boolean);   // calling codes texts may go to (1 = US and Canada)
export const smsOn = !!(config.sms.sid && config.sms.token && config.sms.from);

export function cleanPhone(p) {   // US numbers without the +1 are fine; anything else with its country code
  let s = String(p || "").trim(); const plus = s.startsWith("+"); s = s.replace(/[^0-9]/g, "");
  if (!plus && s.length === 10) s = "1" + s;
  if (s.length < 10 || s.length > 15) return null;
  return "+" + s;
}
function phoneAllowed(p) { return COUNTRIES.some((c) => p.startsWith("+" + c)); }
export function maskPhone(p) { const s = String(p || ""); return s ? "•••-•••-" + s.slice(-4) : ""; }
async function sendSms(userId, to, text) {
  if (!phoneAllowed(to)) return { sent: false, why: "codes can only be texted to numbers starting +" + COUNTRIES.join(", +") };
  const u = await one("SELECT COUNT(*)::int AS n FROM sms_sends WHERE user_id=$1 AND at > now() - interval '1 day'", [userId]);
  const p = await one("SELECT COUNT(*)::int AS n FROM sms_sends WHERE phone=$1 AND at > now() - interval '1 day'", [to]);
  if (u.n >= SMS_PER_USER_DAY || p.n >= SMS_PER_PHONE_DAY) return { sent: false, why: "too many codes today; try again tomorrow or contact support" };
  await q("INSERT INTO sms_sends (user_id,phone) VALUES ($1,$2)", [userId, to]);
  try {
    const r = await fetch(config.sms.api + "/2010-04-01/Accounts/" + encodeURIComponent(config.sms.sid) + "/Messages.json", {
      method: "POST", headers: { Authorization: "Basic " + Buffer.from(config.sms.sid + ":" + config.sms.token).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: to, From: config.sms.from, Body: text }).toString(), signal: AbortSignal.timeout(15000) });
    if (!r.ok) return { sent: false, why: "the text service answered " + r.status };
    return { sent: true };
  } catch (e) { return { sent: false, why: e.message }; }
}
async function emailCode(user, code, note) {
  return sendMail(user.email, "Your Motion Audio sign-in code: " + code, code + " is your Motion Audio sign-in code. It works for " + CODE_MINUTES + " minutes. Don't share it." + (note ? "\n\n" + note : "") + "\n",
    '<div style="font:15px/1.5 system-ui,sans-serif;max-width:520px"><p>Your Motion Audio sign-in code:</p><p style="font:700 28px ui-monospace,monospace;letter-spacing:.2em">' + escHtml(code) + "</p><p style=\"color:#555\">It works for " + CODE_MINUTES + " minutes. Don't share it." + (note ? " " + escHtml(note) : "") + "</p></div>");
}
async function phoneNotice(user, phone) {
  await sendMail(user.email, "A phone was added to your Motion Audio account", "The phone number ending " + phone.slice(-4) + " now gets the sign-in codes for " + user.email + ".\n\nNot you? Set a new password right away (Forgot password? on the website) and contact support.\n\nMotion Audio\n",
    '<div style="font:15px/1.5 system-ui,sans-serif;max-width:520px"><p>The phone number ending <b>' + escHtml(phone.slice(-4)) + "</b> now gets the sign-in codes for " + escHtml(user.email) + ".</p><p><b>Not you?</b> Set a new password right away (Forgot password? on the website) and contact support.</p><p>Motion Audio</p></div>");
}
export async function needsCode(user) {
  if (!smsOn && !mailOn) return false;
  if (isAdmin(user)) return true;
  const m = await one("SELECT role FROM church_members WHERE user_id=$1", [user.id]);
  return !!(m && (m.role === "owner" || m.role === "admin"));
}
// admin tools: the sign-in must have passed the code (someone who became an admin after signing in signs in again)
export async function requireStep(req) {
  if (req.stepped || !(await needsCode(req.user))) return;
  throw bad("For admin tools, sign in again: admins confirm their sign-in with a code sent to their phone.", 401);
}
async function trusted(user, device) {
  if (!device) return false;
  return !!(await one("SELECT 1 FROM trusted_devices WHERE user_id=$1 AND device_hash=$2 AND expires_at > now()", [user.id, hash(user.id + ":" + device)]));
}
// a new code for a ticket: to the phone (or by email until Twilio is set up); enrolling a phone also needs an emailed code
async function newCode(row, user) {
  if (row.sends >= MAX_SENDS) throw bad("Too many codes. Start signing in again.", 429);
  const code = String(crypto.randomInt(0, 1e6)).padStart(6, "0"), toPhone = smsOn && !!row.phone;
  const both = toPhone && (row.purpose === "login" && !(user.phone_confirmed && user.phone === row.phone));
  const ecode = both ? String(crypto.randomInt(0, 1e6)).padStart(6, "0") : null;
  await q("UPDATE login_codes SET code_hash=$1, email_code_hash=$2, via=$3, attempts=0, sends=sends+1, expires_at=now() + ($4 || ' minutes')::interval WHERE nonce=$5",
    [hash(row.nonce + ":" + code), ecode ? hash(row.nonce + ":e:" + ecode) : null, toPhone ? "text" : "email", String(CODE_MINUTES), row.nonce]);
  const r = toPhone ? await sendSms(user.id, row.phone, code + " is your Motion Audio sign-in code. It works for " + CODE_MINUTES + " minutes. Don't share it.")
    : await emailCode(user, code, smsOn ? "" : "(Text messages aren't set up on the website yet, so it came by email.)");
  if (!r.sent) throw bad("The code couldn't be sent (" + r.why + ").", 502);
  if (ecode) { const m = await emailCode(user, ecode, "This is the email code for adding your phone. The other code was texted to it."); if (!m.sent) throw bad("The email code couldn't be sent (" + m.why + ").", 502); }
  return { step: "code", ticket: row.nonce, by: toPhone ? "text" : "email", to: toPhone ? maskPhone(row.phone) : "your email", both: !!ecode, phone: row.phone ? maskPhone(row.phone) : null };
}
async function newTicket(user, device, purpose, phone) {
  const nonce = crypto.randomBytes(18).toString("base64url");
  return one("INSERT INTO login_codes (nonce,user_id,phone,device,purpose,expires_at) VALUES ($1,$2,$3,$4,$5,now() + interval '15 minutes') RETURNING *", [nonce, user.id, phone || null, device || "", purpose]);
}

// the sign-in, or the next step for an admin on a new device
export async function issue(user, body, extra) {
  const device = String((body && body.device) || "").slice(0, 100);
  if (!(await needsCode(user))) return Object.assign({ token: makeToken(user.id) }, extra || {});
  if (await trusted(user, device)) return Object.assign({ token: makeToken(user.id, true) }, extra || {});
  const row = await newTicket(user, device, "login", user.phone || null);
  if (!user.phone) return Object.assign({ step: "phone", ticket: row.nonce, by: smsOn ? "text" : "email" }, extra || {});
  return Object.assign(await newCode(row, user), extra || {});
}

export function routes(api, { wrap, brake, requireUser }) {
  async function ticket(body, purpose) {
    const row = await one("SELECT * FROM login_codes WHERE nonce=$1 AND purpose=$2 AND created_at > now() - interval '30 minutes'", [String(body.ticket || ""), purpose || "login"]);
    if (!row) throw bad("That sign-in has expired. Sign in again.", 410);
    return { row, user: await one("SELECT * FROM users WHERE id=$1 AND deleted_at IS NULL", [row.user_id]) };
  }
  // one try at a time: the try is counted before the code is compared (so guesses sent together can't get round it)
  async function checkCode(row, body) {
    const r = await one("UPDATE login_codes SET attempts=attempts+1 WHERE nonce=$1 AND attempts < $2 AND code_hash IS NOT NULL RETURNING *", [row.nonce, MAX_TRIES]);
    if (!r) throw bad(row.code_hash ? "Too many wrong codes. Send a new one." : "Ask for a code first.", 429);
    if (new Date(r.expires_at) < new Date()) throw bad("That code has expired. Send a new one.", 410);
    const ok = hash(r.nonce + ":" + String(body.code || "").replace(/\D/g, "")) === r.code_hash &&
      (!r.email_code_hash || hash(r.nonce + ":e:" + String(body.emailCode || "").replace(/\D/g, "")) === r.email_code_hash);
    if (!ok) { const left = MAX_TRIES - r.attempts; throw bad((r.email_code_hash ? "One of the codes isn't right." : "That code isn't right.") + (left > 0 ? " " + left + " tries left." : " Send a new one."), 401); }
    await q("DELETE FROM login_codes WHERE nonce=$1 OR (user_id=$2 AND created_at < now() - interval '1 day')", [r.nonce, r.user_id]);
    return r;
  }
  // the phone number (no phone yet, or one not confirmed yet): a code to it and one to the email
  api.post("/login/phone", wrap(async (req, res) => {
    brake(req);
    const { row, user } = await ticket(req.body);
    if (!user || user.phone_confirmed) throw bad("This account already has a confirmed phone. To change it, sign in and use Account → Change phone.", 409);
    const phone = cleanPhone(req.body.phone);
    if (!phone) throw bad("Enter your mobile number, for example 555-123-4567.");
    if (smsOn && !phoneAllowed(phone)) throw bad("Codes can only be texted to numbers starting +" + COUNTRIES.join(", +") + " for now.");
    await q("UPDATE login_codes SET phone=$1 WHERE nonce=$2", [phone, row.nonce]); row.phone = phone;
    res.json(await newCode(row, user));
  }));
  api.post("/login/resend", wrap(async (req, res) => {
    brake(req);
    const { row, user } = await ticket(req.body);
    if (!user) throw bad("That sign-in has expired. Sign in again.", 410);
    if (!row.phone && !user.phone) throw bad("Enter your phone number first.");
    res.json(await newCode(row, user));
  }));
  api.post("/login/code", wrap(async (req, res) => {
    brake(req);
    const { row, user } = await ticket(req.body);
    if (!user) throw bad("That sign-in has expired. Sign in again.", 410);
    const r = await checkCode(row, req.body);
    if (r.phone && r.phone !== user.phone || (r.via === "text" && !user.phone_confirmed)) {   // (a phone added: confirmed once a text reached it)
      await q("UPDATE users SET phone=$1, phone_confirmed=$2 WHERE id=$3", [r.phone, r.via === "text", user.id]);
      if (r.via === "text") await phoneNotice(user, r.phone);
    }
    if (r.device && req.body.trust !== false) await q(`INSERT INTO trusted_devices (user_id,device_hash,expires_at) VALUES ($1,$2,now() + ($3 || ' days')::interval)
      ON CONFLICT (user_id,device_hash) DO UPDATE SET expires_at=EXCLUDED.expires_at`, [user.id, hash(user.id + ":" + r.device), String(TRUST_DAYS)]);
    res.json({ token: makeToken(user.id, true) });
  }));
  // Account → Change phone: signed in, the password, then a code texted to the new number (until Twilio: saved as is)
  api.post("/account/phone", requireUser, wrap(async (req, res) => {
    brake(req);
    if (!checkPassword(String(req.body.password || ""), req.user.pass_hash)) throw bad("That password isn't right.", 403);
    await requireStep(req);
    const phone = cleanPhone(req.body.phone); if (!phone) throw bad("Enter your mobile number, for example 555-123-4567.");
    if (!smsOn) {
      await q("UPDATE users SET phone=$1, phone_confirmed=FALSE WHERE id=$2", [phone, req.user.id]);
      await phoneNotice(req.user, phone);
      return res.json({ ok: true, phone: maskPhone(phone) });
    }
    if (!phoneAllowed(phone)) throw bad("Codes can only be texted to numbers starting +" + COUNTRIES.join(", +") + " for now.");
    const row = await newTicket(req.user, "", "phone", phone);
    res.json(Object.assign(await newCode(row, req.user), { ok: true }));
  }));
  api.post("/account/phone/confirm", requireUser, wrap(async (req, res) => {
    brake(req);
    const { row } = await ticket(req.body, "phone");
    if (row.user_id !== req.user.id) throw bad("That isn't your code.", 403);
    const r = await checkCode(row, req.body);
    await q("UPDATE users SET phone=$1, phone_confirmed=TRUE WHERE id=$2", [r.phone, req.user.id]);
    await q("DELETE FROM trusted_devices WHERE user_id=$1", [req.user.id]);   // (every device confirms with the new phone)
    await phoneNotice(req.user, r.phone);
    res.json({ ok: true, phone: maskPhone(r.phone) });
  }));
}
