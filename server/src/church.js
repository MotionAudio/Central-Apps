// The main admins' controls: the church's billing (card, receipts, invoices - in the church's name), people's roles,
// making an admin a second main admin (up to 2), and handing the main admin role to someone else. (Adding people is
// the Teams page; removing is /church/remove.) Both main admins have the same controls; the one in churches.owner_id
// is the church's billing contact (Stripe's receipts go to them).
import { q, one, pool } from "./db.js";
import { checkPassword } from "./auth.js";
import { churchOf, isMain } from "./licenses.js";
import { churchBillingPortal, syncChurchCustomer } from "./payments.js";
import { MAIN_ADMINS_MAX } from "./config.js";
import { requireStep } from "./signin.js";
import { sendMail, escHtml } from "./mail.js";

function bad(msg, status = 400) { const e = new Error(msg); e.status = status; return e; }
async function ownerChurch(req) {
  const c = await churchOf(req.user.id);
  if (!c || !isMain(c.role)) throw bad("Only the church account or a main admin can do that.", 403);
  await requireStep(req);
  return c;
}
async function member(c, email) {
  const m = await one("SELECT u.*, m.role FROM church_members m JOIN users u ON u.id=m.user_id WHERE m.church_id=$1 AND u.email=$2", [c.id, String(email || "").trim().toLowerCase()]);
  if (!m) throw bad("That person isn't in " + c.name + " (they need an account in it first).", 404);
  return m;
}

export function routes(api, { wrap, brake, requireUser }) {
  // Settings → Billing: Stripe's page for the church's card on file, receipts and invoices
  api.post("/church/billing", requireUser, wrap(async (req, res) => { const c = await ownerChurch(req); res.json({ url: await churchBillingPortal(c) }); }));
  // admin <-> user
  api.post("/church/role", requireUser, wrap(async (req, res) => {
    const c = await ownerChurch(req), role = String(req.body.role || "");
    if (!["admin", "user"].includes(role)) throw bad("Admin or user.");
    const m = await member(c, req.body.email);
    if (m.role === "church") throw bad("That's the church account: it keeps its controls.", 400);
    if (m.role === "owner") throw bad("That's a main admin. Use Back to admin first.", 400);
    await q("UPDATE church_members SET role=$1 WHERE church_id=$2 AND user_id=$3", [role, c.id, m.id]);
    if (role === "user") await q("DELETE FROM service_schedulers WHERE church_id=$1 AND user_id=$2", [c.id, m.id]);
    res.json({ ok: true, email: m.email, role });
  }));
  // a second main admin (up to 2): an admin gets the main admin's controls too. Or back to admin (never the last one).
  api.post("/church/main-admin", requireUser, wrap(async (req, res) => {
    brake(req);
    const c = await ownerChurch(req), on = req.body.on !== false;
    const m = await member(c, req.body.email);
    const client = await pool.connect();
    let owners;
    try {
      await client.query("BEGIN");
      const ch = (await client.query("SELECT owner_id FROM churches WHERE id=$1 FOR UPDATE", [c.id])).rows[0];   // (locked: two people can't both add a third)
      const list = (await client.query("SELECT user_id FROM church_members WHERE church_id=$1 AND role='owner'", [c.id])).rows.map((r) => String(r.user_id));
      const account = (await client.query("SELECT user_id FROM church_members WHERE church_id=$1 AND role='church'", [c.id])).rows[0];
      if (!list.includes(String(req.user.id)) && !(account && String(account.user_id) === String(req.user.id))) throw bad("You're not a main admin any more.", 409);
      if (m.role === "church") throw bad("That's the church account: it isn't one of the " + MAIN_ADMINS_MAX + " main admins.");
      if (on) {
        if (m.role === "owner") throw bad((m.name || m.email) + " is a main admin already.");
        if (m.role !== "admin") throw bad("Make " + (m.name || m.email) + " an admin first: a main admin is promoted from the admins.");
        if (list.length >= MAIN_ADMINS_MAX) throw bad(c.name + " has " + MAIN_ADMINS_MAX + " main admins already. Put one back to admin first.", 409);
        await client.query("UPDATE church_members SET role='owner' WHERE church_id=$1 AND user_id=$2", [c.id, m.id]);
      } else {
        if (m.role !== "owner") throw bad((m.name || m.email) + " isn't a main admin.");
        if (list.length <= 1 && !account) throw bad("A church needs a main admin. Make someone else a main admin first.", 409);
        await client.query("UPDATE church_members SET role='admin' WHERE church_id=$1 AND user_id=$2", [c.id, m.id]);
        if (String(ch.owner_id) === String(m.id) && list.length > 1) await client.query("UPDATE churches SET owner_id=$1 WHERE id=$2", [list.find((id) => id !== String(m.id)), c.id]);   // (the billing contact is the other one now)
      }
      await client.query("DELETE FROM invites WHERE church_id=$1 AND section='owner'", [c.id]);
      owners = (await client.query("SELECT COUNT(*)::int AS n FROM church_members WHERE church_id=$1 AND role='owner'", [c.id])).rows[0].n;
      await client.query("COMMIT");
    } catch (e) { try { await client.query("ROLLBACK"); } catch (_) { } throw e; } finally { client.release(); }
    await syncChurchCustomer(c.id);
    const who = req.user.name || req.user.email;
    if (on) await sendMail(m.email, "You're now a main admin of " + c.name, "Hi" + (m.name ? " " + m.name : "") + ",\n\n" + who + " made you a main admin of " + c.name + " on Motion Audio. Like them, you can now change people's roles, add and remove people, and manage the church's billing (Account on the website).\n\nMotion Audio\n",
      "<div style=\"font:15px/1.5 system-ui,sans-serif\"><p>Hi" + (m.name ? " " + escHtml(m.name) : "") + ",</p><p>" + escHtml(who) + " made you a main admin of <b>" + escHtml(c.name) + "</b> on Motion Audio. Like them, you can now change people's roles, add and remove people, and manage the church's billing (Account on the website).</p><p>Talk soon,<br>The Motion Audio team</p></div>");
    res.json({ ok: true, email: m.email, role: on ? "owner" : "admin", mainAdmins: owners });
  }));
  // hand the main admin role to someone already in the church (right away; your password to be sure). You stay an admin.
  // The billing stays with the church: its card and receipts don't change, the receipts go to the new main admin.
  api.post("/church/handover", requireUser, wrap(async (req, res) => {
    brake(req);
    const c = await ownerChurch(req);
    if (c.role === "church") throw bad("The church account keeps its controls. Make an admin a main admin instead.", 400);
    if (!checkPassword(String(req.body.password || ""), req.user.pass_hash)) throw bad("That password isn't right.", 403);
    const m = await member(c, req.body.email);
    if (m.id === req.user.id) throw bad("You're already a main admin.");
    if (m.role === "owner") throw bad((m.name || m.email) + " is a main admin already.");
    if (m.role === "church") throw bad("That's the church account.");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const now = (await client.query("SELECT owner_id FROM churches WHERE id=$1 FOR UPDATE", [c.id])).rows[0];   // (locked; still a main admin?)
      const still = (await client.query("SELECT 1 FROM church_members WHERE church_id=$1 AND user_id=$2 AND role='owner'", [c.id, req.user.id])).rows[0];
      if (!now || !still) throw bad("You're not a main admin any more.", 409);
      await client.query("UPDATE church_members SET role='admin' WHERE church_id=$1 AND user_id=$2", [c.id, req.user.id]);
      await client.query("UPDATE church_members SET role='owner' WHERE church_id=$1 AND user_id=$2", [c.id, m.id]);
      if (!now.owner_id || String(now.owner_id) === String(req.user.id)) await client.query("UPDATE churches SET owner_id=$1 WHERE id=$2", [m.id, c.id]);   // (the billing contact moves with it)
      await client.query("DELETE FROM invites WHERE church_id=$1 AND section='owner'", [c.id]);
      await client.query("COMMIT");
    } catch (e) { try { await client.query("ROLLBACK"); } catch (_) { } throw e; } finally { client.release(); }
    await syncChurchCustomer(c.id);
    const who = req.user.name || req.user.email;
    await sendMail(m.email, "You're now the main admin of " + c.name, "Hi" + (m.name ? " " + m.name : "") + ",\n\n" + who + " made you the main admin of " + c.name + " on Motion Audio. You can now change people's roles, add and remove people, and manage the church's billing (Account on the website).\n\nMotion Audio\n",
      "<div style=\"font:15px/1.5 system-ui,sans-serif\"><p>Hi" + (m.name ? " " + escHtml(m.name) : "") + ",</p><p>" + escHtml(who) + " made you the main admin of <b>" + escHtml(c.name) + "</b> on Motion Audio. You can now change people's roles, add and remove people, and manage the church's billing (Account on the website).</p><p>Talk soon,<br>The Motion Audio team</p></div>");
    res.json({ ok: true, owner: m.email });
  }));
}
