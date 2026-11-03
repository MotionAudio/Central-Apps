// The public status page (10.3): /status. Every few minutes the server checks what churches depend on and keeps the
// answers for two weeks:
//   website      this server answers and its database does
//   signin       accounts can be read (the users table) and new sign-ins work (the token secret is set)
//   downloads    GitHub's releases answer (every app and library downloads from there)
//   payments     Stripe answers (only when payments are set up; otherwise "not set up")
//   storage      Central Tracks storage: a small file written and read back
// Each is up, degraded (slow or partly working) or down. Motion Audio staff can post an incident note, shown on top.
//   STATUS_CHECKS=off stops the checks (tests); STATUS_EVERY_MIN sets how often (default 3).
import { q, one } from "./db.js";
import { config } from "./config.js";
import { isAdmin } from "./auth.js";
import { requireStep } from "./signin.js";
import * as store from "./storage.js";

function bad(msg, status = 400) { const e = new Error(msg); e.status = status; return e; }
export const SERVICES = [["website", "Website"], ["signin", "Sign-in and accounts"], ["downloads", "Downloads (app updates and libraries)"], ["payments", "Payments"], ["storage", "Central Tracks storage"]];
const SLOW_MS = 4000;
const releasesApi = () => String(process.env.CC_UPDATE_API || "https://api.github.com/repos/MotionAudio/Central-Apps/releases/latest");
const stripeApi = () => String(process.env.STRIPE_API_URL || "https://api.stripe.com").replace(/\/+$/, "");

async function timed(fn) { const t = Date.now(); try { const v = await fn(); return Object.assign({ ms: Date.now() - t }, v); } catch (e) { return { state: "down", ms: Date.now() - t, note: String(e.message || e).slice(0, 200) }; } }
const speed = (r) => (r.state === "up" && r.ms > SLOW_MS ? Object.assign(r, { state: "degraded", note: r.note || "Answering slowly" }) : r);
async function answers(url, opts) {
  const r = await fetch(url, Object.assign({ signal: AbortSignal.timeout(8000), headers: { "User-Agent": "motion-audio-status" } }, opts || {}));
  return r.status;
}
export async function runChecks() {
  const res = {};
  res.website = await timed(async () => { await one("SELECT 1 AS ok"); return { state: "up" }; });
  res.signin = await timed(async () => { await one("SELECT COUNT(*) FROM users"); return { state: config.tokenSecret ? "up" : "degraded", note: config.tokenSecret ? "" : "No token secret set" }; });
  res.downloads = await timed(async () => { const s = await answers(releasesApi()); return s < 400 ? { state: "up" } : s === 403 || s === 429 ? { state: "degraded", note: "GitHub is limiting requests" } : { state: "down", note: "GitHub answered " + s }; });
  res.payments = config.stripe && config.stripe.secret
    ? await timed(async () => { const s = await answers(stripeApi() + "/v1/balance", { headers: { Authorization: "Bearer " + config.stripe.secret } }); return s < 500 ? { state: "up" } : { state: "down", note: "Stripe answered " + s }; })
    : { state: "off", ms: 0, note: "Payments aren't set up yet" };
  res.storage = await timed(async () => { const k = "status/probe.txt", v = String(Date.now()); await store.putFile(k, Buffer.from(v), "text/plain"); const back = (await store.readFile(k)).toString(); return { state: back === v ? "up" : "degraded", note: back === v ? "" : "Read back something else" }; });
  for (const [k] of SERVICES) { const r = speed(res[k]); await q("INSERT INTO status_checks (service,state,ms,note) VALUES ($1,$2,$3,$4)", [k, r.state, Math.round(r.ms || 0), r.note || ""]); }
  await q("DELETE FROM status_checks WHERE checked_at < now() - interval '14 days'");
  return res;
}
export function start() {
  if (String(process.env.STATUS_CHECKS || "").toLowerCase() === "off") return;
  const every = Math.max(1, Number(process.env.STATUS_EVERY_MIN) || 3) * 60e3;
  const go = () => runChecks().catch((e) => console.error("status checks:", e.message));
  setTimeout(go, 15e3).unref(); setInterval(go, every).unref();
}

export function routes(api, { wrap, requireUser }) {
  api.get("/status", wrap(async (req, res) => {
    const latest = await q("SELECT DISTINCT ON (service) service, state, ms, note, checked_at FROM status_checks ORDER BY service, checked_at DESC");
    // the last 24 hours in 48 half-hour bars: the worst answer in each
    const bars = await q(`SELECT service, floor(extract(epoch FROM now() - checked_at) / 1800)::int AS ago,
        MAX(CASE state WHEN 'down' THEN 3 WHEN 'degraded' THEN 2 WHEN 'up' THEN 1 ELSE 0 END) AS worst
      FROM status_checks WHERE checked_at > now() - interval '24 hours' GROUP BY 1, 2`);
    const up = await q(`SELECT service, ROUND(100.0 * SUM(CASE WHEN state IN ('up','off') THEN 1 ELSE 0 END) / COUNT(*), 2) AS pct FROM status_checks WHERE checked_at > now() - interval '14 days' GROUP BY 1`);
    const incidents = await q("SELECT id, title, message, state, created_at, resolved_at FROM status_incidents WHERE state='open' OR resolved_at > now() - interval '7 days' ORDER BY created_at DESC LIMIT 10");
    const name = ["none", "up", "degraded", "down"];
    res.set("Cache-Control", "no-store");
    res.json({ services: SERVICES.map(([k, label]) => {
      const l = latest.find((x) => x.service === k), h = Array(48).fill("none");
      bars.filter((b) => b.service === k && b.ago >= 0 && b.ago < 48).forEach((b) => (h[47 - b.ago] = name[b.worst]));
      const u = up.find((x) => x.service === k);
      return { id: k, label, state: l ? l.state : "unknown", note: l ? l.note : "Not checked yet", ms: l ? l.ms : null, checked: l ? l.checked_at : null, history: h, uptime: u ? Number(u.pct) : null };
    }), incidents });
  }));
  const staff = async (req) => { if (!isAdmin(req.user)) throw bad("Motion Audio staff only.", 403); await requireStep(req); };
  api.post("/admin/status/incident", requireUser, wrap(async (req, res) => {
    await staff(req);
    const b = req.body || {}, title = String(b.title || "").trim().slice(0, 140), message = String(b.message || "").trim().slice(0, 2000);
    if (!title) throw bad("Give the note a title.");
    const r = await one("INSERT INTO status_incidents (title,message,created_by) VALUES ($1,$2,$3) RETURNING id", [title, message, req.user.email]);
    res.json({ ok: true, id: Number(r.id) });
  }));
  api.post("/admin/status/incident/:id/resolve", requireUser, wrap(async (req, res) => {
    await staff(req);
    await q("UPDATE status_incidents SET state='resolved', resolved_at=now() WHERE id=$1", [Number(req.params.id) || 0]);
    res.json({ ok: true });
  }));
  api.post("/admin/status/check", requireUser, wrap(async (req, res) => { await staff(req); res.json({ ok: true, results: await runChecks() }); }));
}
