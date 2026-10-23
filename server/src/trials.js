// Discount codes in the cart, free trials (TRIALRUN, 7FREE), renewals and the church's Central Services slots.
// A trial: no payment. Until it ends the church gets unlimited keys (admins, users, Pedal Control: made as they're
// needed, on the Teams page or with + key), Central Services and Central Tracks Unlimited. Then its trial keys stop - the
// apps lock until a bought key is entered - and the rest goes back to what it pays for. One free code per church or
// production company, ever.
import { q, one, pool } from "./db.js";
import { DISCOUNTS, RENEWAL } from "./config.js";
import { churchOf, createChurch, mintTrialKey, trialActive, pretty } from "./licenses.js";
import { requireStep } from "./signin.js";
import * as pay from "./payments.js";
import { sendMail, escHtml } from "./mail.js";
import { config } from "./config.js";
import { currentTenths, fmt, everyoneList, setEveryone } from "./versions.js";
import { isAdmin } from "./auth.js";
import { mintTrialPackage, sendPackage, pretty as prettyPackage } from "./plans.js";

function bad(msg, status = 400) { const e = new Error(msg); e.status = status; return e; }
const day = (d) => new Date(d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: config.timeZone || "America/Chicago" });

// a church's Central Services slots: how many it has, and how many people are on its teams (each takes one)
export async function slotsOf(c) {
  const used = (await one(`SELECT COUNT(DISTINCT m.email)::int AS n FROM service_team_members m JOIN service_teams t ON t.id=m.team_id WHERE t.church_id=$1
    AND m.email NOT IN (SELECT u.email FROM church_members cm JOIN users u ON u.id=cm.user_id WHERE cm.church_id=$1 AND cm.role='church')`, [c.id])).n;   // (the church account uses no slot)
  const trial = trialActive(c);
  return { slots: c.services_slots || 0, used, free: Math.max(0, (c.services_slots || 0) - used), on: trial || (c.services_slots || 0) > 0, trial: trial ? c.trial_until : null };
}

export async function remindTrials() {   // the day before a trial ends: an email to the main admin
  let n = 0;
  for (const c of await q(`SELECT c.*, u.email, u.name AS owner_name FROM churches c JOIN users u ON u.id=c.owner_id
      WHERE c.trial_until > now() AND c.trial_until < now() + interval '1 day' AND NOT c.trial_reminded`)) {
    const claimed = await one("UPDATE churches SET trial_reminded=TRUE WHERE id=$1 AND NOT trial_reminded RETURNING id", [c.id]); if (!claimed) continue;
    const link = config.publicUrl + "/#store";
    const r = await sendMail(c.email, "Your free trial ends " + day(c.trial_until) + " - " + c.name,
      "Hi" + (c.owner_name ? " " + c.owner_name : "") + ",\n\n" + c.name + "'s free trial ends " + day(c.trial_until) + ". After that, the trial keys stop and the apps ask for a key. Your songs, setlists and settings stay.\n\nGet a pack or keys (with Central Services slots) here: " + link + "\n\nTalk soon,\nThe Motion Audio team\n",
      '<div style="font:15px/1.5 system-ui,sans-serif;max-width:520px"><p>Hi' + (c.owner_name ? " " + escHtml(c.owner_name) : "") + ",</p><p><b>" + escHtml(c.name) + "</b>'s free trial ends <b>" + escHtml(day(c.trial_until)) + "</b>. After that, the trial keys stop and the apps ask for a key. Your songs, setlists and settings stay.</p><p><a href=\"" + escHtml(link) + "\">Get a pack or keys, with Central Services slots</a></p><p>Talk soon,<br>The Motion Audio team</p></div>");
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
    // (sound plans: a % code takes that much off the first year, once per person / once per church for a bundle)
    const plans = !d.trial && d.plans !== false, planUsed = plans && req.user ? !!(await one("SELECT 1 FROM plan_code_uses WHERE who=$1 AND code=$2", ["u" + req.user.id, code])) : false;
    res.json({ code, label: d.label, percent: d.percent || 0, trial: !!d.trial, days: d.days || 0, used, plans, planUsed });
  }));
  // start a free trial (the main admin; makes the church if there isn't one yet)
  api.post("/trial", requireUser, wrap(async (req, res) => {
    brake(req);
    needConfirmed(req.user);
    const code = String(req.body.code || "").trim().toUpperCase(), d = DISCOUNTS[code];
    if (!d || d.on === false || !d.trial) throw bad("That isn't a free trial code.", 404);
    let c = await churchOf(req.user.id);
    if (c && !(c.role === "church" || c.role === "owner")) throw bad("Only the church account or a main admin can start a trial for " + c.name + ".", 403);
    if (c && c.trial_code) throw bad(c.name + " already had its free trial (" + c.trial_code + ").", 409);
    if (!c) { if (!String(req.body.church || "").trim()) { const e = bad("Name your church or production first."); e.needChurch = true; throw e; } await createChurch(req.user, req.body.church); c = await churchOf(req.user.id); }
    const until = new Date(Date.now() + d.days * 864e5);
    const ok = await one("UPDATE churches SET trial_until=$1, trial_code=$2, trial_by=$3 WHERE id=$4 AND trial_code IS NULL RETURNING id", [until, code, req.user.id, c.id]);
    if (!ok) throw bad(c.name + " already had its free trial.", 409);
    // (9.5) every sound plan too: a trial package key for whoever started it (more on the Teams page, for anyone in the church)
    const pk = await mintTrialPackage({ id: c.id, trial_until: until }, { email: req.user.email, name: req.user.name });
    await sendPackage(pk, "given");
    res.json({ ok: true, church: c.name, until, label: d.label, packageKey: prettyPackage(pk) });   // (keys: unlimited, made as they're needed)
  }));
  // during a trial: another key (as many as you like)
  api.post("/church/trial-key", requireUser, wrap(async (req, res) => {
    const c = await churchOf(req.user.id);
    if (!c || !["church", "owner", "admin"].includes(c.role)) throw bad("Only the church account, the main admins and admins can make keys.", 403);
    await requireStep(req);
    if (!trialActive(c)) throw bad("Your church isn't in a free trial.", 409);
    const kind = String(req.body.kind || ""); if (!["P", "A", "U", "S"].includes(kind)) throw bad("P, A, U or S.");
    if (kind === "S") return res.json({ ok: true, key: prettyPackage(await mintTrialPackage(c)), until: c.trial_until });   // (a package key: every sound plan until the trial ends)
    const client = await pool.connect();
    try { res.json({ ok: true, key: pretty(await mintTrialKey(client, c, kind)), until: c.trial_until }); } finally { client.release(); }
  }));
  // renew keys (main admin and admins pay; billed to the church)
  api.post("/checkout/renew", requireUser, wrap(async (req, res) => {
    needConfirmed(req.user);
    const c = await churchOf(req.user.id);
    if (!c || !["church", "owner", "admin"].includes(c.role)) throw bad("Only the church account, the main admins and admins can renew keys.", 403);
    await requireStep(req);
    res.json(await pay.renewCheckout(req.user, c, req.body.keys, req.body.code));
  }));
  // Central Services: the church's slots (bought once; each person on the teams takes one, and a slot is free again
  // when that person comes off the teams)
  api.get("/services/slots", requireUser, wrap(async (req, res) => {
    const c = await churchOf(req.user.id); if (!c) return res.json({ church: null });
    res.json(Object.assign({ church: c.name }, await slotsOf(c)));
  }));
  // what the website and the apps read about versions: the current one, the renewal price, and the releases Motion Audio
  // sent to every device (an emergency fix installs even past a key's updates)
  api.get("/versions", wrap(async (_req, res) => { const t = await currentTenths(); res.json({ current: fmt(t), renewalCents: RENEWAL.cents, everyone: await everyoneList() }); }));

  // ---- Motion Audio staff: every code and who used it; releases and "Release to all devices"
  const staff = async (req) => { if (!isAdmin(req.user)) throw bad("Admins only.", 403); await requireStep(req); };
  api.get("/admin/codes", requireUser, wrap(async (req, res) => {
    await staff(req);
    const uses = await q("SELECT d.code, d.used_at, c.name AS church, o.total_cents FROM discount_uses d JOIN churches c ON c.id=d.church_id LEFT JOIN orders o ON o.id=d.order_id ORDER BY d.used_at DESC");
    const trials = await q("SELECT trial_code AS code, name AS church, trial_until AS until, (trial_until > now()) AS active FROM churches WHERE trial_code IS NOT NULL ORDER BY trial_until DESC");
    const codes = Object.entries(DISCOUNTS).map(([code, d]) => {
      const u = d.trial ? trials.filter((t) => t.code === code) : uses.filter((x) => x.code === code);
      return { code, kind: d.trial ? "trial" : "percent", percent: d.percent || 0, days: d.days || 0, label: d.label, on: d.on !== false, used: u.length, active: d.trial ? u.filter((t) => t.active).length : undefined, uses: u.slice(0, 200) };
    });
    const gone = [...new Set(uses.map((x) => x.code).concat(trials.map((t) => t.code)))].filter((c) => !DISCOUNTS[c]);   // (codes deleted since, still in the records)
    res.json({ codes, deleted: gone.map((code) => ({ code, uses: uses.filter((x) => x.code === code).concat(trials.filter((t) => t.code === code)) })) });
  }));
  api.get("/admin/releases", requireUser, wrap(async (req, res) => {
    await staff(req);
    const ev = await everyoneList(), apiBase = process.env.CC_UPDATE_API || "https://api.github.com", repo = process.env.CC_UPDATE_REPO || "MotionAudio/Central-Apps";
    let list = [];
    try { const r = await fetch(apiBase + "/repos/" + repo + "/releases?per_page=30", { headers: { Accept: "application/vnd.github+json", "User-Agent": "motion-audio" }, signal: AbortSignal.timeout(10000) }); if (r.ok) list = await r.json(); } catch (_) { }
    res.json({ current: fmt(await currentTenths()), releases: (Array.isArray(list) ? list : []).filter((x) => !x.draft).map((x) => { const v = String(x.tag_name || "").replace(/^v/i, ""); return { version: v, name: x.name || x.tag_name, published: x.published_at, everyone: ev.includes(v) }; }), everyone: ev });
  }));
  api.post("/admin/releases", requireUser, wrap(async (req, res) => {
    await staff(req);
    const v = String(req.body.version || "").trim().replace(/^v/i, "");
    if (!/^\d+\.\d+(\.\d+)?$/.test(v)) throw bad("A version like 9.4.1.");
    res.json({ ok: true, everyone: await setEveryone(v, req.body.everyone !== false, req.user.email) });
  }));
}
