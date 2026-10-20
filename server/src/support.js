// Technical support and error alerts.
// Contact support (website, every app, Central Services): the message goes to SUPPORT_EMAIL, with Reply-To set to the
// person, and they get a copy saying it arrived. Kept in support_requests too.
// Errors: the website's own (a request that failed, a crash) and every app's (they report what goes wrong on their
// screens and behind them) land in app_errors, one row per kind of error with a count. Each new kind is emailed to
// ALERT_EMAIL (or SUPPORT_EMAIL) right away; one that keeps happening, at most once a day.
import crypto from "node:crypto";
import { q, one } from "./db.js";
import { config } from "./config.js";
import { isAdmin } from "./auth.js";
import { requireStep } from "./signin.js";
import { sendMail, mailOn, escHtml } from "./mail.js";

function bad(msg, status = 400) { const e = new Error(msg); e.status = status; return e; }
const SOURCES = ["website", "central-pedal", "central-pedal-control", "central-control", "central-usage", "central-services"];
const clip = (s, n) => String(s == null ? "" : s).slice(0, n);

function fingerprint(source, message, stack) {
  const msg = String(message).replace(/\d+/g, "#").replace(/["'][^"']{0,80}["']/g, "'…'").slice(0, 200);
  const top = String(stack || "").split("\n").map((l) => l.trim()).filter((l) => /^at |@/.test(l))[0] || "";
  const where = top.replace(/\?[^:)]*/g, "").replace(/:\d+(:\d+)?\)?$/, "").replace(/https?:\/\/[^/]+/, "");
  return crypto.createHash("sha256").update(source + "|" + msg + "|" + where).digest("hex").slice(0, 32);
}
let inserted = 0;
export async function recordError(e) {
  try {
    const source = SOURCES.includes(e.source) ? e.source : "website", message = clip(e.message || "Unknown error", 500), stack = clip(e.stack, 4000);
    const fp = fingerprint(source, message, stack);
    const r = await one(`INSERT INTO app_errors (fingerprint,source,version,message,stack,detail) VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (fingerprint) DO UPDATE SET count=app_errors.count+1, last_at=now(), version=EXCLUDED.version, detail=EXCLUDED.detail, resolved=FALSE
      RETURNING *, (xmax = 0) AS fresh`, [fp, source, clip(e.version, 40), message, stack, JSON.stringify(e.detail || {}).length < 4000 ? e.detail || {} : {}]);
    const due = r.fresh || !r.alerted_at || Date.now() - new Date(r.alerted_at).getTime() > 864e5;
    const recent = due ? await one("SELECT COUNT(*)::int AS n FROM app_errors WHERE alerted_at > now() - interval '1 hour'") : { n: 0 };
    if (due && config.alertEmail && mailOn && (recent.n < 20 || e.internal)) {   // (at most 20 alert emails an hour from reports; the website's own always)
      const claimed = await one("UPDATE app_errors SET alerted_at=now() WHERE id=$1 AND (alerted_at IS NULL OR alerted_at < now() - interval '1 day' OR $2) RETURNING id", [r.id, r.fresh]);
      if (claimed) {
        const where = (r.fresh ? "New error" : "Still happening (" + r.count + " times)") + " in " + source + (r.version ? " " + r.version : "");
        await sendMail(config.alertEmail, "[Motion Audio] " + where + ": " + message.slice(0, 90),
          where + "\n\n" + message + "\n\n" + stack + "\n\n" + JSON.stringify(r.detail, null, 1) + "\n\nAll errors: " + config.publicUrl + "/#account (Motion Audio staff → Errors)\n",
          '<div style="font:14px/1.45 system-ui,sans-serif"><p><b>' + escHtml(where) + "</b></p><p>" + escHtml(message) + '</p><pre style="font:12px ui-monospace,monospace;white-space:pre-wrap;background:#f4f4f5;padding:8px;border-radius:6px">' + escHtml(stack) + "\n\n" + escHtml(JSON.stringify(r.detail, null, 1)) +
          '</pre><p><a href="' + escHtml(config.publicUrl) + '/#account">All errors</a> (Motion Audio staff → Errors)</p></div>');
      }
    }
    if (r.fresh && ++inserted % 100 === 0) {   // (kept to the newest 5,000 kinds)
      const n = await one("SELECT COUNT(*)::int AS n FROM app_errors");
      if (n.n > 5000) await q("DELETE FROM app_errors WHERE id IN (SELECT id FROM app_errors ORDER BY resolved DESC, last_at ASC LIMIT $1)", [n.n - 4500]);
    }
    return r;
  } catch (err) { console.error("recordError:", err.message); return null; }
}

export function routes(api, { wrap, brake, requireUser }) {
  // the apps and the website's pages report what went wrong (no sign-in needed; at most 60 every 10 minutes per address)
  const seen = new Map(), freshBy = new Map();
  setInterval(() => { const now = Date.now(); for (const [k, v] of seen) if (!v.filter((t) => now - t < 600e3).length) seen.delete(k); }, 600e3).unref();
  api.post("/errors", wrap(async (req, res) => {
    const now = Date.now(), t = (seen.get(req.ip) || []).filter((x) => now - x < 600e3);
    if (t.length >= 60) return res.status(204).end();
    t.push(now); seen.set(req.ip, t);
    const b = req.body || {};
    if (!b.message) throw bad("message?");
    const day = Math.floor(now / 864e5), f = freshBy.get(req.ip) || { day, n: 0 }; if (f.day !== day) { f.day = day; f.n = 0; }
    if (f.n >= 30) return res.status(204).end();   // (30 new kinds of error a day from one address is plenty)
    const r = await recordError({ source: String(b.source || ""), version: b.version, message: b.message, stack: b.stack,
      detail: { url: clip(b.url, 300), platform: clip(b.platform, 120), device: clip(b.device, 80), user: req.user ? req.user.email : undefined, kind: clip(b.kind, 40) } });
    if (r && r.fresh) { f.n++; freshBy.set(req.ip, f); }
    res.json({ ok: true });
  }));
  api.post("/support", wrap(async (req, res) => {
    brake(req);
    const b = req.body || {}, email = String(b.email || (req.user && req.user.email) || "").trim().toLowerCase(), message = String(b.message || "").trim().slice(0, 8000);
    const name = String(b.name || (req.user && req.user.name) || "").trim().slice(0, 80), subject = String(b.subject || "").trim().slice(0, 140) || "Help";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad("Enter your email so we can answer.");
    if (message.length < 5) throw bad("Tell us what's going on.");
    const row = await one("INSERT INTO support_requests (user_id,name,email,subject,message,app,version) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
      [req.user ? req.user.id : null, name, email, subject, message, clip(b.app, 40), clip(b.version, 40)]);
    let sent = false;
    if (config.supportEmail && mailOn) {
      const church = req.user ? await one("SELECT c.name, m.role FROM church_members m JOIN churches c ON c.id=m.church_id WHERE m.user_id=$1", [req.user.id]) : null;
      const about = [b.app && "App: " + clip(b.app, 40) + " " + clip(b.version, 40), b.platform && "Device: " + clip(b.platform, 120), church && "Church: " + church.name + " (" + church.role + ")", req.user ? "Signed in: yes" : "Signed in: no"].filter(Boolean).join("\n");
      const r = await sendMail(config.supportEmail, "[Support #" + row.id + "] " + subject, (name || email) + " <" + email + "> wrote:\n\n" + message + "\n\n" + about + "\n",
        "<div style=\"font:15px/1.5 system-ui,sans-serif\"><p><b>" + escHtml(name || email) + "</b> &lt;" + escHtml(email) + "&gt; wrote:</p><p style=\"white-space:pre-wrap\">" + escHtml(message) + "</p><p style=\"color:#555;white-space:pre-line\">" + escHtml(about) + "</p></div>", email);
      sent = r.sent;
      if (sent && req.user && req.user.email === email) await sendMail(email, "We got your message (#" + row.id + ") - Motion Audio support", "Hi" + (name ? " " + name : "") + ",\n\nThanks - we got your message and will answer by email.\n\n> " + message.replace(/\n/g, "\n> ") + "\n\nMotion Audio support\n",
        "<div style=\"font:15px/1.5 system-ui,sans-serif\"><p>Hi" + (name ? " " + escHtml(name) : "") + ",</p><p>Thanks - we got your message and will answer by email.</p><blockquote style=\"color:#555;white-space:pre-wrap\">" + escHtml(message) + "</blockquote><p>Motion Audio support</p></div>", config.supportEmail);
      await q("UPDATE support_requests SET sent=$1 WHERE id=$2", [sent, row.id]);
    }
    res.json({ ok: true, id: row.id, sent, message: sent ? "Sent. We'll answer by email" + (req.user && req.user.email === email ? " (a copy is in your inbox)." : ".") : "Saved. Email isn't set up on the website yet; we'll see it on the staff page." });
  }));
  // Motion Audio staff: the errors, and the support messages
  api.get("/admin/errors", requireUser, wrap(async (req, res) => {
    if (!isAdmin(req.user)) throw bad("Admins only.", 403); await requireStep(req);
    res.json({ errors: await q("SELECT id, source, version, message, stack, detail, count, first_at, last_at, resolved FROM app_errors ORDER BY resolved, last_at DESC LIMIT 200"),
      support: await q("SELECT id, name, email, subject, message, app, version, sent, created_at FROM support_requests ORDER BY created_at DESC LIMIT 50") });
  }));
  api.post("/admin/errors/:id/resolve", requireUser, wrap(async (req, res) => {
    if (!isAdmin(req.user)) throw bad("Admins only.", 403); await requireStep(req);
    await q("UPDATE app_errors SET resolved=TRUE WHERE id=$1", [Number(req.params.id) || 0]); res.json({ ok: true });
  }));
}
