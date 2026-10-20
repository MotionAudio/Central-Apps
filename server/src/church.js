// The main admin's controls: the church's billing (card, receipts, invoices - in the church's name), people's roles,
// and handing the main admin role to someone else. (Adding people is the Teams page; removing is /church/remove.)
import { q, one, pool } from "./db.js";
import { checkPassword } from "./auth.js";
import { churchOf } from "./licenses.js";
import { churchBillingPortal, syncChurchCustomer } from "./payments.js";
import { requireStep } from "./signin.js";
import { sendMail, escHtml } from "./mail.js";

function bad(msg, status = 400) { const e = new Error(msg); e.status = status; return e; }
async function ownerChurch(req) {
  const c = await churchOf(req.user.id);
  if (!c || c.role !== "owner") throw bad("Only the main admin can do that.", 403);
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
    if (m.role === "owner") throw bad("That's the main admin. Use Make main admin to hand it over.", 400);
    await q("UPDATE church_members SET role=$1 WHERE church_id=$2 AND user_id=$3", [role, c.id, m.id]);
    if (role === "user") await q("DELETE FROM service_schedulers WHERE church_id=$1 AND user_id=$2", [c.id, m.id]);
    res.json({ ok: true, email: m.email, role });
  }));
  // hand the main admin role to someone already in the church (right away; your password to be sure). You stay an admin.
  // The billing stays with the church: its card and receipts don't change, the receipts go to the new main admin.
  api.post("/church/handover", requireUser, wrap(async (req, res) => {
    brake(req);
    const c = await ownerChurch(req);
    if (!checkPassword(String(req.body.password || ""), req.user.pass_hash)) throw bad("That password isn't right.", 403);
    const m = await member(c, req.body.email);
    if (m.id === req.user.id) throw bad("You're already the main admin.");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const now = (await client.query("SELECT owner_id FROM churches WHERE id=$1 FOR UPDATE", [c.id])).rows[0];   // (locked; still the main admin?)
      if (!now || String(now.owner_id) !== String(req.user.id)) throw bad("You're not the main admin any more.", 409);
      await client.query("UPDATE church_members SET role='admin' WHERE church_id=$1 AND user_id=$2", [c.id, req.user.id]);
      await client.query("UPDATE church_members SET role='owner' WHERE church_id=$1 AND user_id=$2", [c.id, m.id]);
      await client.query("UPDATE churches SET owner_id=$1 WHERE id=$2", [m.id, c.id]);
      await client.query("DELETE FROM invites WHERE church_id=$1 AND section='owner'", [c.id]);
      await client.query("COMMIT");
    } catch (e) { try { await client.query("ROLLBACK"); } catch (_) { } throw e; } finally { client.release(); }
    await syncChurchCustomer(c.id);
    const who = req.user.name || req.user.email;
    await sendMail(m.email, "You're now the main admin of " + c.name, "Hi" + (m.name ? " " + m.name : "") + ",\n\n" + who + " made you the main admin of " + c.name + " on Motion Audio. You can now change people's roles, add and remove people, and manage the church's billing (Account on the website).\n\nMotion Audio\n",
      "<div style=\"font:15px/1.5 system-ui,sans-serif\"><p>Hi" + (m.name ? " " + escHtml(m.name) : "") + ",</p><p>" + escHtml(who) + " made you the main admin of <b>" + escHtml(c.name) + "</b> on Motion Audio. You can now change people's roles, add and remove people, and manage the church's billing (Account on the website).</p><p>Motion Audio</p></div>");
    res.json({ ok: true, owner: m.email });
  }));
}
