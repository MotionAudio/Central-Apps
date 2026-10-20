// Forgot password, and the reminders that go out by themselves.
// Forgot password: the website, the apps' account step and Central Services all call /password/forgot with an email.
// If there's an account, it gets a link (website /#reset-<token>) that works once, for an hour. Setting the new
// password signs that account out everywhere else (sign-ins from before it stop working) and signs it in here.
// Reminders (runReminders, every hour - index.js): Teams invites nobody answered (after 3 days, again after 7), and
// Central Services' day-before email (accepted: "you're serving tomorrow"; not answered: "please answer").
import crypto from "node:crypto";
import { q, one, pool } from "./db.js";
import { config } from "./config.js";
import { hashPassword, checkPassword, requireUser, isAdmin } from "./auth.js";
import { issue, requireStep } from "./signin.js";
import { stripe } from "./payments.js";
import { sendMail, mailOn, escHtml } from "./mail.js";
import { remindInvites, churchOf, acceptInvite } from "./licenses.js";
import { remindServices } from "./services.js";
import { remindTrials } from "./trials.js";
import { syncServicesPrices } from "./payments.js";

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
            '<p><a href="' + escHtml(link) + '" style="display:inline-block;background:#12161C;color:#fff;padding:12px 20px;border-radius:6px;font-weight:600;text-decoration:none">Set a new password</a></p>' +
            "<p style=\"color:#555\">The same account signs in to all the Central apps. Didn't ask for this? Ignore this email - your password stays the same.</p><p>Talk soon,<br>The Motion Audio team</p></div>");
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
      await client.query("UPDATE users SET pass_hash=$1, pw_changed_at=$2, email_confirmed=TRUE WHERE id=$3", [hashPassword(pw), new Date(), uid]);   // (the link came to that email)
      await client.query("DELETE FROM trusted_devices WHERE user_id=$1", [uid]);   // (a new password: every device confirms again)
      await client.query("COMMIT");
    } catch (e) { try { await client.query("ROLLBACK"); } catch (_) { } throw e; } finally { client.release(); }
    const u = await one("SELECT * FROM users WHERE id=$1", [uid]);
    res.json(await issue(u, req.body, { ok: true, email: u.email }));   // (an admin still needs the phone code on a new device)
  }));
  // ---- confirm email: a link at sign-up (7 days); checkout needs a confirmed email (receipts and keys go there)
  api.post("/account/confirm", wrap(async (req, res) => {
    const r = await one("DELETE FROM email_confirms WHERE token_hash=$1 AND expires_at > now() RETURNING user_id, email", [hash(req.body.token)]);
    if (!r) throw bad("That link has expired or was already used. Sign in and send a new one.", 404);
    const u = await one("UPDATE users SET email_confirmed=TRUE WHERE id=$1 AND email=$2 RETURNING *", [r.user_id, r.email]);
    if (!u) throw bad("That link is for an email this account doesn't use any more.", 409);
    const church = await joinByEmail(u);   // (added on a Teams page, signed up without the invite's link: now that the email is theirs)
    res.json({ ok: true, email: u.email, church });
  }));
  api.post("/account/confirm/resend", requireUser, wrap(async (req, res) => {
    if (req.user.email_confirmed) return res.json({ ok: true, already: true });
    const n = await one("SELECT COUNT(*)::int AS n FROM email_confirms WHERE user_id=$1 AND created_at > now() - interval '1 hour'", [req.user.id]);
    if (n.n >= 3) throw bad("We've sent 3 links in the last hour. Check your spam folder, or wait a bit.", 429);
    const r = await sendConfirm(req.user);
    res.json({ ok: true, sent: r.sent });
  }));
  // ---- delete my account: personal details gone, keys free, out of the church; the main admin hands over first
  api.post("/account/delete", requireUser, wrap(async (req, res) => {
    brake(req);
    const u = req.user;
    if (!checkPassword(String(req.body.password || ""), u.pass_hash)) throw bad("That password isn't right.", 403);
    const c = await churchOf(u.id);
    if (c && c.role === "owner") {
      const others = await one("SELECT COUNT(*)::int AS n FROM church_members WHERE church_id=$1 AND user_id<>$2", [c.id, u.id]);
      if (others.n) throw bad("You're the main admin of " + c.name + ". Make someone else the main admin first (Account → Members → Make main admin), then delete your account.", 409);
      if (!req.body.closeChurch) { const e = bad("You're the only one in " + c.name + ". Deleting your account also closes it: its keys stop working.", 409); e.needClose = true; throw e; }
    }
    res.json(await deleteAccount(u, c));
  }));
  // Motion Audio staff: send the reminders that are due now (they also go out by themselves every hour)
  api.post("/admin/reminders", requireUser, wrap(async (req, res) => {
    if (!isAdmin(req.user)) throw bad("Admins only.", 403); await requireStep(req);
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
    try { return { invites: await remindInvites(), services: await remindServices(), trials: await remindTrials(), plans: await syncServicesPrices() }; }
    finally { await client.query("SELECT pg_advisory_unlock(80612)"); }
  } finally { client.release(); running = false; }
}
export function startReminders() {
  const tick = () => runReminders().then((r) => { if (r.invites || r.services) console.log("reminders sent: " + r.invites + " invites, " + r.services + " services"); }).catch((e) => console.error("reminders:", e.message));
  setTimeout(tick, 60e3).unref();
  setInterval(tick, 60 * 60e3).unref();
}

export async function sendConfirm(user) {
  if (!mailOn) { await q("UPDATE users SET email_confirmed=TRUE WHERE id=$1", [user.id]); return { sent: false }; }   // (no email: nothing to confirm with)
  const token = crypto.randomBytes(24).toString("base64url"), link = config.publicUrl + "/#confirm-" + token;
  await q("INSERT INTO email_confirms (token_hash,user_id,email,expires_at) VALUES ($1,$2,$3,now() + interval '7 days')", [hash(token), user.id, user.email]);
  return sendMail(user.email, "Confirm your email - Motion Audio",
    (user.name ? "Hi " + user.name + ",\n\n" : "Hi,\n\n") + "Confirm this is your email (the link works for 7 days):\n" + link + "\n\nYour receipts, keys, invites and password resets come here.\n\nMotion Audio\n",
    '<div style="font:15px/1.5 system-ui,sans-serif;color:#10202e;max-width:520px"><p>' + (user.name ? "Hi " + escHtml(user.name) + "," : "Hi,") + '</p><p>Confirm this is your email:</p><p><a href="' + escHtml(link) + '" style="display:inline-block;background:#12161C;color:#fff;padding:12px 20px;border-radius:6px;font-weight:600;text-decoration:none">Confirm my email</a></p><p style="color:#555">Your receipts, keys, invites and password resets come here. The link works for 7 days.</p><p>Talk soon,<br>The Motion Audio team</p></div>');
}

// what's left of an account: nothing that says who it was (the row stays so past orders and payouts still add up)
export async function deleteAccount(u, c) {
  const email = u.email, client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (c && c.role === "owner") {   // (locked, and checked again: nobody joined meanwhile)
      await client.query("SELECT id FROM churches WHERE id=$1 FOR UPDATE", [c.id]);
      const others = (await client.query("SELECT COUNT(*)::int AS n FROM church_members WHERE church_id=$1 AND user_id<>$2", [c.id, u.id])).rows[0].n;
      if (others) { const e = bad("Someone just joined " + c.name + ". Make someone else the main admin first.", 409); throw e; }
    }
    const keys = (await client.query("SELECT key FROM licenses WHERE user_id=$1 OR assigned_email=$2", [u.id, email])).rows.map((r) => r.key);
    if (keys.length) { await client.query("DELETE FROM license_devices WHERE key = ANY($1)", [keys]); await client.query("UPDATE licenses SET user_id=NULL, assigned_email=NULL, assigned_name=NULL WHERE key = ANY($1)", [keys]); }
    await client.query("DELETE FROM invites WHERE user_id=$1 OR email=$2", [u.id, email]);
    await client.query("DELETE FROM service_schedulers WHERE user_id=$1", [u.id]);
    await client.query("DELETE FROM church_members WHERE user_id=$1", [u.id]);
    for (const t of ["user_settings", "password_resets", "email_confirms", "login_codes", "trusted_devices"]) await client.query("DELETE FROM " + t + " WHERE user_id=$1", [u.id]);
    await client.query("DELETE FROM service_team_members WHERE email=$1", [email]);
    await client.query("DELETE FROM service_blockouts WHERE email=$1", [email]);
    await client.query("DELETE FROM service_requests r USING services s WHERE s.id=r.service_id AND r.email=$1 AND s.starts_at > now()", [email]);
    await client.query("UPDATE service_requests SET email='deleted-' || id, name='', note='' WHERE email=$1", [email]);
    await client.query("UPDATE tracks SET status='hidden' WHERE publisher_id=$1 AND status='live'", [u.id]);
    if (c && c.role === "owner") await client.query("UPDATE churches SET owner_id=NULL, closed_at=now() WHERE id=$1", [c.id]);
    await client.query(`UPDATE users SET email='deleted-' || id || '@deleted.invalid', name='', pass_hash='!', phone=NULL, phone_confirmed=FALSE,
      subscribed=FALSE, deleted_at=now() WHERE id=$1`, [u.id]);
    await client.query("COMMIT");
  } catch (e) { try { await client.query("ROLLBACK"); } catch (_) { } throw e; } finally { client.release(); }
  if (stripe) {   // (their own card and subscription; a closed church's too)
    try { if (u.stripe_customer) await stripe.customers.del(u.stripe_customer); } catch (_) { }
    try { if (c && c.role === "owner" && c.stripe_customer) await stripe.customers.del(c.stripe_customer); } catch (_) { }
  }
  await sendMail(email, "Your Motion Audio account is deleted", "Your Motion Audio account (" + email + ") is deleted" + (c && c.role === "owner" ? ", and " + c.name + " is closed" : "") + ". Its keys are free again and your details are gone.\n\nMotion Audio\n",
    "<p style=\"font:15px/1.5 system-ui,sans-serif\">Your Motion Audio account (" + escHtml(email) + ") is deleted" + (c && c.role === "owner" ? ", and " + escHtml(c.name) + " is closed" : "") + ". Its keys are free again and your details are gone.</p>");
  return { ok: true, closedChurch: !!(c && c.role === "owner") };
}

// someone the Teams page invited who made their account without the email's link: once their email is confirmed, the
// invite counts (before that, anyone could sign up with that address)
export async function joinByEmail(u) {
  if (!u.email_confirmed || (await churchOf(u.id))) return null;
  const inv = await one("SELECT token FROM invites WHERE email=$1 AND user_id IS NULL AND section<>'owner' ORDER BY created_at DESC LIMIT 1", [u.email]);
  if (!inv) return null;
  try { return (await acceptInvite(u, inv.token)).church; } catch (_) { return null; }
}
