// Forgot password, and the reminders that go out by themselves.
// Forgot password: the website, the apps' account step and Central Services all call /password/forgot with an email.
// If there's an account, it gets a link (website /#reset-<token>) that works once, for an hour. Setting the new
// password signs that account out everywhere else (sign-ins from before it stop working) and signs it in here.
// Reminders (runReminders, every hour - index.js): Teams invites nobody answered (after 3 days, again after 7), and
// Central Services' day-before email (accepted: "you're serving tomorrow"; not answered: "please answer").
import crypto from "node:crypto";
import { q, one, pool } from "./db.js";
import { config } from "./config.js";
import { hashPassword, makeToken, requireUser, isAdmin } from "./auth.js";
import { sendMail, mailOn, escHtml } from "./mail.js";
import { remindInvites } from "./licenses.js";
import { remindServices } from "./services.js";

function bad(msg, status = 400) { const e = new Error(msg); e.status = status; return e; }
const hash = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");
const RESET_MINUTES = 60, RESETS_PER_HOUR = 3;

export function routes(api, { wrap, brake }) {
  // always the same answer (it doesn't tell anyone whether an email has an account)
  api.post("/password/forgot", wrap(async (req, res) => {
    brake(req);
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad("Enter the email of your account.");
    if (!mailOn) throw bad("The website can't send email yet, so it can't reset passwords. Ask Motion Audio for help.", 503);
    const u = await one("SELECT * FROM users WHERE email=$1", [email]);
    if (u) {
      const recent = await one("SELECT COUNT(*)::int AS n FROM password_resets WHERE user_id=$1 AND created_at > now() - interval '1 hour'", [u.id]);
      if (recent.n < RESETS_PER_HOUR) {
        const token = crypto.randomBytes(24).toString("base64url"), link = config.publicUrl + "/#reset-" + token;
        await q("INSERT INTO password_resets (token_hash,user_id,expires_at) VALUES ($1,$2,now() + ($3 || ' minutes')::interval)", [hash(token), u.id, String(RESET_MINUTES)]);
        await sendMail(u.email, "Reset your Motion Audio password",
          (u.name ? "Hi " + u.name + ",\n\n" : "Hi,\n\n") + "Set a new password for your Motion Audio account here (the link works once, for an hour):\n" + link +
            "\n\nThe same account signs in to Central Pedal, Central Pedal Control, Central Control, Central Usage and Central Services.\nDidn't ask for this? Ignore this email - your password stays the same.\n\nMotion Audio\n",
          '<div style="font:15px/1.5 system-ui,sans-serif;color:#10202e;max-width:520px"><p>' + (u.name ? "Hi " + escHtml(u.name) + "," : "Hi,") + "</p><p>Set a new password for your Motion Audio account (the link works once, for an hour):</p>" +
            '<p><a href="' + escHtml(link) + '" style="display:inline-block;background:#d97706;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Set a new password</a></p>' +
            "<p style=\"color:#555\">The same account signs in to all the Central apps. Didn't ask for this? Ignore this email - your password stays the same.</p><p>Motion Audio</p></div>");
      }
    }
    res.json({ ok: true, message: "If there's an account with that email, a link to set a new password is on its way. It works for an hour." });
  }));
  api.get("/password/reset/:token", wrap(async (req, res) => {   // (the page checks the link before asking for a password)
    const r = await one("SELECT u.email FROM password_resets p JOIN users u ON u.id=p.user_id WHERE p.token_hash=$1 AND NOT p.used AND p.expires_at > now()", [hash(req.params.token)]);
    if (!r) throw bad("That link has expired or was already used. Ask for a new one (Forgot password?).", 404);
    res.json({ email: r.email });
  }));
  api.post("/password/reset", wrap(async (req, res) => {
    brake(req);
    const pw = String(req.body.password || "");
    if (pw.length < 8) throw bad("Use a password of at least 8 characters.");
    const client = await pool.connect(); let uid;
    try {
      await client.query("BEGIN");
      const r = (await client.query("SELECT * FROM password_resets WHERE token_hash=$1 AND NOT used AND expires_at > now() FOR UPDATE", [hash(req.body.token)])).rows[0];
      if (!r) { await client.query("ROLLBACK"); throw bad("That link has expired or was already used. Ask for a new one (Forgot password?).", 404); }
      uid = r.user_id;
      await client.query("UPDATE password_resets SET used=TRUE WHERE user_id=$1", [uid]);   // (every other link it was sent too)
      await client.query("UPDATE users SET pass_hash=$1, pw_changed_at=$2 WHERE id=$3", [hashPassword(pw), new Date(), uid]);
      await client.query("COMMIT");
    } catch (e) { try { await client.query("ROLLBACK"); } catch (_) { } throw e; } finally { client.release(); }
    const u = await one("SELECT email FROM users WHERE id=$1", [uid]);
    res.json({ ok: true, token: makeToken(uid), email: u.email });
  }));
  // Motion Audio staff: send the reminders that are due now (they also go out by themselves every hour)
  api.post("/admin/reminders", requireUser, wrap(async (req, res) => {
    if (!isAdmin(req.user)) throw bad("Admins only.", 403);
    res.json(await runReminders());
  }));
}

// one server at a time sends them (a lock in the database), so nobody gets the same reminder twice
let running = false;
export async function runReminders() {
  if (running || !mailOn) return { invites: 0, services: 0, skipped: running ? "running" : "no email" };
  running = true;
  const client = await pool.connect();
  try {
    const got = (await client.query("SELECT pg_try_advisory_lock(80612) AS ok")).rows[0].ok;
    if (!got) return { invites: 0, services: 0, skipped: "another server" };
    try { return { invites: await remindInvites(), services: await remindServices() }; }
    finally { await client.query("SELECT pg_advisory_unlock(80612)"); }
  } finally { client.release(); running = false; }
}
export function startReminders() {
  const tick = () => runReminders().then((r) => { if (r.invites || r.services) console.log("reminders sent: " + r.invites + " invites, " + r.services + " services"); }).catch((e) => console.error("reminders:", e.message));
  setTimeout(tick, 60e3).unref();
  setInterval(tick, 60 * 60e3).unref();
}
