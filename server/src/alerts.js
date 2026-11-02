// (10.2) A church's alerts from its own computers: the pre-service check (Central Control, the main admin's computer)
// found problems before a service. POST /v1/church/alert { key, device, kind, subject, text, service, at }
//   - the key must be one of the church's admin (A) keys, active on that device (the app sends its key and device id,
//     the same as /license/check) - so only the church's own computers can send them;
//   - it's emailed to the church's main admins and the church account (sendMail; without email set up it's kept and
//     the reply says so);
//   - at most one alert per church every 10 minutes (a check that keeps failing doesn't flood anyone's inbox);
//   - every alert is kept (church_alerts), so the Account page can show the last ones.
// Central Services has no push to phones yet: the email is the phone alert for now (it's on their phone too).
import { q, one } from "./db.js";
import { sendMail, escHtml, mailOn } from "./mail.js";

const GAP_MINUTES = Number(process.env.ALERT_GAP_MINUTES || 10);
const KINDS = { precheck: "Pre-service check" };
const canon = (k) => String(k || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const text = (s, n) => String(s == null ? "" : s).replace(/[\u0000-\u0008\u000b-\u001f]/g, "").slice(0, n);

class Bad extends Error { constructor(msg, status) { super(msg); this.status = status || 400; } }

// the church's people who get it: its main admins (owner) and the church account's own email
export async function recipients(churchId) {
  const rows = await q("SELECT DISTINCT u.email FROM church_members m JOIN users u ON u.id = m.user_id WHERE m.church_id=$1 AND m.role='owner' " +
    "UNION SELECT u.email FROM churches c JOIN users u ON u.id = c.owner_id WHERE c.id=$1", [churchId]);
  return rows.map((r) => String(r.email || "").toLowerCase()).filter((e, i, a) => e && a.indexOf(e) === i);
}

export async function sendAlert(body) {
  const b = body || {}, key = canon(b.key), dev = text(b.device, 120), kind = KINDS[b.kind] ? b.kind : "precheck";
  if (key.length < 12 || !dev) throw new Bad("A key and this computer's id are needed.");
  const l = await one("SELECT * FROM licenses WHERE key=$1 OR regexp_replace(upper(key),'[^A-Z0-9]','','g')=$1 LIMIT 1", [key]);
  if (!l || l.revoked || !l.church_id) throw new Bad("That key isn't one of a church's keys.", 403);
  if (l.kind !== "A") throw new Bad("Alerts come from the church's admin computers (Central Control).", 403);
  if (!(await one("SELECT 1 FROM license_devices WHERE key=$1 AND device_id=$2", [l.key, dev]))) throw new Bad("That key isn't active on this computer.", 403);
  const c = await one("SELECT id, name FROM churches WHERE id=$1 AND closed_at IS NULL", [l.church_id]);
  if (!c) throw new Bad("That church isn't here any more.", 404);
  const recent = await one("SELECT sent_at FROM church_alerts WHERE church_id=$1 AND sent_at > now() - ($2 || ' minutes')::interval ORDER BY sent_at DESC LIMIT 1", [c.id, String(GAP_MINUTES)]);
  const subject = text(b.subject, 160) || KINDS[kind] + ": problems found", msg = text(b.text, 6000), service = text(b.service, 120);
  const row = await one("INSERT INTO church_alerts (church_id, license_key, device_id, kind, subject, body, service, mailed) VALUES ($1,$2,$3,$4,$5,$6,$7,FALSE) RETURNING id", [c.id, l.key, dev, kind, subject, msg, service]);
  if (recent) return { ok: true, id: row.id, mailed: 0, held: true, note: "An alert went out less than " + GAP_MINUTES + " minutes ago; this one is kept on the website." };
  const to = await recipients(c.id);
  const html = "<p><b>" + escHtml(c.name) + "</b>: " + escHtml(subject) + (service ? " (" + escHtml(service) + ")" : "") + "</p>" +
    "<pre style=\"white-space:pre-wrap;font:14px/1.5 Helvetica,Arial,sans-serif;margin:0\">" + escHtml(msg) + "</pre>" +
    "<p style=\"color:#69717D\">Sent by Central Control's pre-service check on the main admin's computer. Open the Service tab there to check again.</p>";
  let mailed = 0, why = "";
  for (const email of to) { const r = await sendMail(email, c.name + " - " + subject, c.name + ": " + subject + "\n\n" + msg, html); if (r.sent) mailed++; else why = r.why || why; }
  await q("UPDATE church_alerts SET mailed=$2 WHERE id=$1", [row.id, mailed > 0]);
  return { ok: true, id: row.id, mailed, to: to.length, note: mailed ? "" : (mailOn ? why : "Email isn't set up on the website yet, so it's kept here.") };
}

export function routes(api, { wrap, requireUser }) {
  api.post("/church/alert", wrap(async (req, res) => {
    try { res.json(await sendAlert(req.body)); }
    catch (e) { if (e instanceof Bad) return res.status(e.status).json({ error: e.message }); throw e; }
  }));
  // the main admins see the church's last alerts (Account page)
  api.get("/church/alerts", requireUser, wrap(async (req, res) => {
    const m = await one("SELECT church_id, role FROM church_members WHERE user_id=$1", [req.user.id]);
    const c = m ? null : await one("SELECT id FROM churches WHERE owner_id=$1", [req.user.id]);
    const churchId = m ? m.church_id : c && c.id;
    if (!churchId || (m && m.role === "user")) return res.json({ alerts: [] });
    res.json({ alerts: await q("SELECT id, kind, subject, body, service, mailed, sent_at FROM church_alerts WHERE church_id=$1 ORDER BY sent_at DESC LIMIT 20", [churchId]) });
  }));
}
