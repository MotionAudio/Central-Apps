// Discount codes in the cart, free trials (TESTRUN, 7FREE), renewals and Central Services' monthly plan.
// A trial: no payment. Until it ends the church gets as many keys as it wants (admins, users, Pedal Control: the Teams
// page and Make a key), Central Services and Central Tracks Unlimited. Then its trial keys stop - the apps lock until a
// bought key is entered - and the rest goes back to what it pays for. One free code per church, ever (and per main admin).
import { q, one, pool } from "./db.js";
import { DISCOUNTS, RENEWAL, SERVICES_PLAN, servicesCents } from "./config.js";
import { churchOf, createChurch, mintTrialKey, trialActive, pretty } from "./licenses.js";
import { requireStep } from "./signin.js";
import * as pay from "./payments.js";
import { sendMail, escHtml } from "./mail.js";
import { config } from "./config.js";
import { currentTenths, fmt } from "./versions.js";

function bad(msg, status = 400) { const e = new Error(msg); e.status = status; return e; }
const day = (d) => new Date(d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: config.timeZone || "America/Chicago" });

export async function remindTrials() {   // the day before a trial ends: an email to the main admin
  let n = 0;
  for (const c of await q(`SELECT c.*, u.email, u.name AS owner_name FROM churches c JOIN users u ON u.id=c.owner_id
      WHERE c.trial_until > now() AND c.trial_until < now() + interval '1 day' AND NOT c.trial_reminded`)) {
    const claimed = await one("UPDATE churches SET trial_reminded=TRUE WHERE id=$1 AND NOT trial_reminded RETURNING id", [c.id]); if (!claimed) continue;
    const link = config.publicUrl + "/#store";
    const r = await sendMail(c.email, "Your free trial ends " + day(c.trial_until) + " - " + c.name,
      "Hi" + (c.owner_name ? " " + c.owner_name : "") + ",\n\n" + c.name + "'s free trial ends " + day(c.trial_until) + ". After that, the trial keys stop and the apps ask for a key. Your songs, setlists and settings stay.\n\nGet keys (or a church pack) and Central Services here: " + link + "\n\nMotion Audio\n",
      '<div style="font:15px/1.5 system-ui,sans-serif;max-width:520px"><p>Hi' + (c.owner_name ? " " + escHtml(c.owner_name) : "") + ",</p><p><b>" + escHtml(c.name) + "</b>'s free trial ends <b>" + escHtml(day(c.trial_until)) + "</b>. After that, the trial keys stop and the apps ask for a key. Your songs, setlists and settings stay.</p><p><a href=\"" + escHtml(link) + "\">Get keys, a church pack and Central Services</a></p><p>Motion Audio</p></div>");
    if (r.sent) n++;
  }
  return n;
}

export function routes(api, { wrap, brake, requireUser, needConfirmed }) {
  // what a code does (the cart checks it before checkout)
  api.get("/discount/:code", wrap(async (req, res) => {
    const code = String(req.params.code || "").trim().toUpperCase(), d = DISCOUNTS[code];
    if (!d || d.on === false) throw bad("That code isn't valid.", 404);
    const c = req.user ? await churchOf(req.user.id) : null;
    const used = d.trial ? !!(c && c.trial_code) : !!(c && (await one("SELECT 1 FROM discount_uses WHERE church_id=$1 AND code=$2", [c.id, code])));
    res.json({ code, label: d.label, percent: d.percent || 0, trial: !!d.trial, days: d.days || 0, used });
  }));
  // start a free trial (the main admin; makes the church if there isn't one yet)
  api.post("/trial", requireUser, wrap(async (req, res) => {
    brake(req);
    needConfirmed(req.user);
    const code = String(req.body.code || "").trim().toUpperCase(), d = DISCOUNTS[code];
    if (!d || d.on === false || !d.trial) throw bad("That isn't a free trial code.", 404);
    let c = await churchOf(req.user.id);
    if (c && c.role !== "owner") throw bad("Only the main admin can start a trial for " + c.name + ".", 403);
    if (c && c.trial_code) throw bad(c.name + " already had its free trial (" + c.trial_code + ").", 409);
    if (await one("SELECT 1 FROM churches WHERE trial_by=$1", [req.user.id])) throw bad("You already started a free trial for another church. One free trial each.", 409);
    if (!c) { if (!String(req.body.church || "").trim()) { const e = bad("Name your church or production first."); e.needChurch = true; throw e; } await createChurch(req.user, req.body.church); c = await churchOf(req.user.id); }
    const until = new Date(Date.now() + d.days * 864e5), client = await pool.connect(), keys = [];
    try {
      await client.query("BEGIN");
      const ok = (await client.query("UPDATE churches SET trial_until=$1, trial_code=$2, trial_by=$3 WHERE id=$4 AND trial_code IS NULL RETURNING *", [until, code, req.user.id, c.id])).rows[0];
      if (!ok) throw bad(c.name + " already had its free trial.", 409);
      for (const k of ["P", "A", "U"]) keys.push({ kind: k, key: pretty(await mintTrialKey(client, ok, k)) });   // (one of each to start; more any time)
      await client.query("COMMIT");
    } catch (e) { try { await client.query("ROLLBACK"); } catch (_) { } throw e; } finally { client.release(); }
    res.json({ ok: true, church: c.name, until, label: d.label, keys });
  }));
  // during a trial: another key (as many as you like)
  api.post("/church/trial-key", requireUser, wrap(async (req, res) => {
    const c = await churchOf(req.user.id);
    if (!c || !(c.role === "owner" || c.role === "admin")) throw bad("Only the main admin and admins can make keys.", 403);
    await requireStep(req);
    if (!trialActive(c)) throw bad("Your church isn't in a free trial.", 409);
    const kind = String(req.body.kind || ""); if (!["P", "A", "U"].includes(kind)) throw bad("P, A or U.");
    const client = await pool.connect();
    try { res.json({ ok: true, key: pretty(await mintTrialKey(client, c, kind)), until: c.trial_until }); } finally { client.release(); }
  }));
  // renew keys (main admin and admins pay; billed to the church)
  api.post("/checkout/renew", requireUser, wrap(async (req, res) => {
    needConfirmed(req.user);
    const c = await churchOf(req.user.id);
    if (!c || !(c.role === "owner" || c.role === "admin")) throw bad("Only the main admin and admins can renew keys.", 403);
    await requireStep(req);
    res.json({ url: await pay.renewCheckout(req.user, c, req.body.keys, req.body.code) });
  }));
  // Central Services' monthly plan (the main admin)
  api.get("/services/plan", requireUser, wrap(async (req, res) => {
    const c = await churchOf(req.user.id); if (!c) return res.json({ church: null });
    const members = await pay.membersOf(c.id);
    res.json({ members, cents: servicesCents(members), tiers: SERVICES_PLAN.tiers, extraCents: SERVICES_PLAN.extraCents, active: !!c.has_services, status: c.services_status, charging: c.services_cents, trial: trialActive(c) ? c.trial_until : null });
  }));
  api.post("/checkout/services", requireUser, wrap(async (req, res) => {
    needConfirmed(req.user);
    const c = await churchOf(req.user.id);
    if (!c || c.role !== "owner") throw bad("Only the main admin can subscribe the church.", 403);
    await requireStep(req);
    res.json({ url: await pay.servicesCheckout(req.user, c) });
  }));
  // what the website shows about versions and renewals
  api.get("/versions", wrap(async (_req, res) => { const t = await currentTenths(); res.json({ current: fmt(t), renewalCents: RENEWAL.cents }); }));
}
