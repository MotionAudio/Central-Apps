// Central Services: the church's schedule. Up to 4 worship teams and 4 production teams; up to 4 schedulers (the main
// admin and admins they pick) make services and ask people from the teams; up to 120 people see the schedule and
// accept or decline. Everyone sees every team: who's on it, their role, and who said yes or no.
// The app (central-services/) asks /services/me who is signed in: schedulers get the scheduling screens.
import { q, one, pool } from "./db.js";
import { config, SERVICES_LIMITS as LIM } from "./config.js";
import { churchOf } from "./licenses.js";
import { sendMail, escHtml } from "./mail.js";

function bad(msg, status = 400) { const e = new Error(msg); e.status = status; return e; }
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const KINDS = ["worship", "production"];

async function schedulersOf(c) {
  const chosen = await q("SELECT user_id FROM service_schedulers WHERE church_id=$1", [c.id]);
  if (chosen.length) return chosen.map((r) => String(r.user_id));
  const staff = await q("SELECT user_id FROM church_members WHERE church_id=$1 AND role IN ('owner','admin') ORDER BY (role='owner') DESC, joined_at LIMIT $2", [c.id, LIM.schedulers]);
  return staff.map((r) => String(r.user_id));
}
async function ctx(req) {
  const c = await churchOf(req.user.id);
  if (!c) throw bad("Your account isn't in a church yet. Ask your main admin to add you on the Teams page.", 403);
  if (!c.has_services) throw bad("Your church doesn't have Central Services yet. The main admin can add it in the store ($25, free with a church pack).", 402);
  const sched = await schedulersOf(c);
  return { c, scheduler: sched.includes(String(req.user.id)), schedulers: sched };
}
function needSched(x) { if (!x.scheduler) throw bad("Only the schedulers can do that.", 403); }
async function team(x, id) {
  const t = await one("SELECT * FROM service_teams WHERE id=$1 AND church_id=$2", [Number(id) || 0, x.c.id]);
  if (!t) throw bad("No such team.", 404);
  return t;
}
async function peopleCount(churchId, extra) {   // everyone on the teams (by email), with these new ones
  const rows = await q("SELECT DISTINCT m.email FROM service_team_members m JOIN service_teams t ON t.id=m.team_id WHERE t.church_id=$1", [churchId]);
  const set = new Set(rows.map((r) => r.email)); (extra || []).forEach((e) => set.add(e));
  return set.size;
}
function when(d) { try { return new Date(d).toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: config.timeZone || "America/Chicago" }); } catch (_) { return String(d); } }
async function askByEmail(c, s, list) {   // "You're asked to serve" - accept or decline in Central Services (or on the website)
  for (const r of list) {
    const link = config.publicUrl + "/#services";
    await sendMail(r.email, c.name + ": " + s.title + " - " + when(s.starts_at), (r.name ? "Hi " + r.name + ",\n\n" : "Hi,\n\n") + "You're asked to serve" + (r.role ? " as " + r.role : "") + " at " + s.title + ", " + when(s.starts_at) + "." + songsText(s.songs || []) + "\n\nAccept or decline in Central Services, or here: " + link + "\n\n" + c.name + "\n",
      '<div style="font:15px/1.5 system-ui,sans-serif;max-width:520px"><p>' + (r.name ? "Hi " + escHtml(r.name) + "," : "Hi,") + "</p><p>You're asked to serve" + (r.role ? " as <b>" + escHtml(r.role) + "</b>" : "") + " at <b>" + escHtml(s.title) + "</b>, " + escHtml(when(s.starts_at)) + ".</p>" + songsHtml(s.songs || []) + "<p>Accept or decline in <b>Central Services</b>, or <a href=\"" + escHtml(link) + "\">on the website</a>.</p><p>" + escHtml(c.name) + "</p></div>");
  }
}

// a service's songs: [{ title, key, bpm, notes }] (up to 40)
function songsOf(list) {
  return (Array.isArray(list) ? list : []).slice(0, 40).map((x) => ({ title: String((x && x.title) || "").trim().slice(0, 120), key: String((x && x.key) || "").trim().slice(0, 12),
    bpm: Math.max(0, Math.min(400, Math.round(Number(x && x.bpm) || 0))), notes: String((x && x.notes) || "").trim().slice(0, 300) })).filter((x) => x.title);
}
function songsText(songs) { return songs.length ? "\n\nSongs:\n" + songs.map((x, i) => (i + 1) + ". " + x.title + (x.key ? " (" + x.key + ")" : "") + (x.bpm ? " " + x.bpm + " BPM" : "")).join("\n") : ""; }
function songsHtml(songs) { return songs.length ? "<p><b>Songs</b></p><ol>" + songs.map((x) => "<li>" + escHtml(x.title) + (x.key ? " <span style=\"color:#555\">(" + escHtml(x.key) + ")</span>" : "") + (x.bpm ? " <span style=\"color:#555\">" + x.bpm + " BPM</span>" : "") + "</li>").join("") + "</ol>" : ""; }
// the church's day of a service (blockout dates are days in TIME_ZONE)
function dayOf(d) { return new Date(d).toLocaleDateString("en-CA", { timeZone: config.timeZone || "America/Chicago" }); }
async function awayOn(churchId, day) {
  return new Set((await q("SELECT email FROM service_blockouts WHERE church_id=$1 AND starts_on <= $2::date AND ends_on >= $2::date", [churchId, day])).map((r) => r.email));
}

export function routes(api, { wrap, requireUser }) {
  // who is signed in: a scheduler (the scheduling screens) or a member (their requests and the schedule)
  api.get("/services/me", requireUser, wrap(async (req, res) => {
    const c = await churchOf(req.user.id);
    if (!c) return res.json({ church: null, role: null });
    const sched = c.has_services ? await schedulersOf(c) : [];
    res.json({ church: c.name, churchRole: c.role, hasServices: !!c.has_services, role: sched.includes(String(req.user.id)) ? "scheduler" : "member",
      name: req.user.name, email: req.user.email, limits: LIM });
  }));
  // the whole board: teams with their people, the services from a week ago on (or a range), each with its requests
  api.get("/services/board", requireUser, wrap(async (req, res) => {
    const x = await ctx(req), from = req.query.from ? new Date(String(req.query.from)) : new Date(Date.now() - 7 * 864e5), days = Math.max(1, Math.min(366, Number(req.query.days) || 120));
    const teams = await q("SELECT * FROM service_teams WHERE church_id=$1 ORDER BY kind DESC, created_at", [x.c.id]);
    const members = teams.length ? await q("SELECT * FROM service_team_members WHERE team_id = ANY($1) ORDER BY name, email", [teams.map((t) => t.id)]) : [];
    const svc = await q("SELECT * FROM services WHERE church_id=$1 AND starts_at >= $2 AND starts_at < $2::timestamptz + ($3 || ' days')::interval ORDER BY starts_at", [x.c.id, isNaN(from) ? new Date() : from, String(days)]);
    const reqs = svc.length ? await q("SELECT * FROM service_requests WHERE service_id = ANY($1) ORDER BY name, email", [svc.map((s) => s.id)]) : [];
    const me = req.user.email.toLowerCase();
    const people = x.scheduler ? await q("SELECT u.name, u.email, m.role FROM church_members m JOIN users u ON u.id=m.user_id WHERE m.church_id=$1 ORDER BY u.name, u.email", [x.c.id]) : [];
    const schedUsers = x.schedulers.length ? await q("SELECT id, name, email FROM users WHERE id = ANY($1)", [x.schedulers]) : [];
    const away = await q("SELECT *, to_char(starts_on,'YYYY-MM-DD') AS day1, to_char(ends_on,'YYYY-MM-DD') AS day2 FROM service_blockouts WHERE church_id=$1 AND ends_on >= (now() AT TIME ZONE $2)::date - 1 ORDER BY starts_on, name", [x.c.id, config.timeZone || "America/Chicago"]);
    res.json({
      church: x.c.name, role: x.scheduler ? "scheduler" : "member", me, limits: LIM, schedulers: schedUsers.map((u) => ({ name: u.name, email: u.email })), people,
      teams: teams.map((t) => ({ id: String(t.id), kind: t.kind, name: t.name, members: members.filter((m) => m.team_id === t.id).map((m) => ({ email: m.email, name: m.name, role: m.role })) })),
      blockouts: away.map((b) => ({ id: String(b.id), email: b.email, name: b.name, from: b.day1, to: b.day2, note: b.note, mine: b.email === me })),
      services: svc.map((s) => ({ id: String(s.id), title: s.title, startsAt: s.starts_at, day: dayOf(s.starts_at), notes: s.notes, songs: s.songs || [],
        requests: reqs.filter((r) => r.service_id === s.id).map((r) => ({ id: String(r.id), teamId: String(r.team_id), email: r.email, name: r.name, role: r.role, status: r.status, note: r.note, mine: r.email === me })) })),
    });
  }));

  // ---- schedulers: teams and their people
  api.post("/services/teams", requireUser, wrap(async (req, res) => {
    const x = await ctx(req); needSched(x);
    const kind = String(req.body.kind || ""), name = String(req.body.name || "").trim().slice(0, 60);
    if (!KINDS.includes(kind)) throw bad("Worship or production.");
    if (!name) throw bad("Give the team a name.");
    const n = await one("SELECT COUNT(*)::int AS n FROM service_teams WHERE church_id=$1 AND kind=$2", [x.c.id, kind]);
    if (n.n >= LIM.teamsPerKind) throw bad("Up to " + LIM.teamsPerKind + " " + kind + " teams.");
    const t = await one("INSERT INTO service_teams (church_id,kind,name) VALUES ($1,$2,$3) RETURNING id", [x.c.id, kind, name]);
    res.json({ ok: true, id: String(t.id) });
  }));
  api.post("/services/teams/:id/rename", requireUser, wrap(async (req, res) => {
    const x = await ctx(req); needSched(x); const t = await team(x, req.params.id), name = String(req.body.name || "").trim().slice(0, 60);
    if (!name) throw bad("Give the team a name.");
    await q("UPDATE service_teams SET name=$1 WHERE id=$2", [name, t.id]); res.json({ ok: true });
  }));
  api.post("/services/teams/:id/remove", requireUser, wrap(async (req, res) => {
    const x = await ctx(req); needSched(x); const t = await team(x, req.params.id);
    await q("DELETE FROM service_teams WHERE id=$1", [t.id]); res.json({ ok: true });
  }));
  api.post("/services/teams/:id/members", requireUser, wrap(async (req, res) => {   // [{ name, email, role }] - added or changed
    const x = await ctx(req); needSched(x); const t = await team(x, req.params.id);
    const list = (Array.isArray(req.body.members) ? req.body.members : []).slice(0, LIM.people).map((m) => ({ email: String(m.email || "").trim().toLowerCase(), name: String(m.name || "").trim().slice(0, 80), role: String(m.role || "").trim().slice(0, 60) }));
    const badOne = list.find((m) => !emailOk(m.email)); if (badOne) throw bad("“" + badOne.email + "” isn't an email address.");
    if (await peopleCount(x.c.id, list.map((m) => m.email)) > LIM.people) throw bad("Central Services is for up to " + LIM.people + " people.");
    for (const m of list) await q(`INSERT INTO service_team_members (team_id,email,name,role) VALUES ($1,$2,$3,$4)
      ON CONFLICT (team_id,email) DO UPDATE SET name=EXCLUDED.name, role=EXCLUDED.role`, [t.id, m.email, m.name, m.role]);
    res.json({ ok: true });
  }));
  api.post("/services/teams/:id/members/remove", requireUser, wrap(async (req, res) => {
    const x = await ctx(req); needSched(x); const t = await team(x, req.params.id);
    await q("DELETE FROM service_team_members WHERE team_id=$1 AND email=$2", [t.id, String(req.body.email || "").toLowerCase()]); res.json({ ok: true });
  }));

  // ---- schedulers: services, and who is asked
  api.post("/services/events", requireUser, wrap(async (req, res) => {   // { title, startsAt, notes, ask: [{ teamId, email }] | teams: [teamId] (everyone on them) }
    const x = await ctx(req); needSched(x);
    const title = String(req.body.title || "").trim().slice(0, 100), at = new Date(String(req.body.startsAt || "")), notes = String(req.body.notes || "").slice(0, 2000);
    if (!title) throw bad("Give the service a name (Sunday 9:00, Christmas Eve…).");
    if (isNaN(at)) throw bad("Pick the date and time.");
    const s = await one("INSERT INTO services (church_id,title,starts_at,notes,created_by,songs) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *", [x.c.id, title, at, notes, req.user.id, JSON.stringify(songsOf(req.body.songs))]);
    const asked = await addRequests(x, s, req.body);
    if (req.body.email !== false) await askByEmail(x.c, s, asked);
    res.json({ ok: true, id: String(s.id), asked: asked.length, away: asked.away });
  }));
  async function addRequests(x, s, body) {
    const teams = await q("SELECT * FROM service_teams WHERE church_id=$1", [x.c.id]), tid = new Set(teams.map((t) => String(t.id)));
    let ask = Array.isArray(body.ask) ? body.ask.map((a) => ({ teamId: String(a.teamId), email: String(a.email || "").toLowerCase() })) : [];
    if (Array.isArray(body.teams)) for (const t of body.teams.map(String)) if (tid.has(t)) for (const m of await q("SELECT email FROM service_team_members WHERE team_id=$1", [Number(t)])) ask.push({ teamId: t, email: m.email });
    const out = [], away = await awayOn(x.c.id, dayOf(s.starts_at)); out.away = [];
    for (const a of ask) {
      if (!tid.has(a.teamId)) continue;
      const m = await one("SELECT * FROM service_team_members WHERE team_id=$1 AND email=$2", [Number(a.teamId), a.email]); if (!m) continue;
      if (away.has(m.email)) { if (!out.away.includes(m.name || m.email)) out.away.push(m.name || m.email); continue; }   // (they said they're away that day)
      const r = await one(`INSERT INTO service_requests (service_id,team_id,email,name,role) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (service_id,team_id,email) DO NOTHING RETURNING *`, [s.id, m.team_id, m.email, m.name, m.role]);
      if (r) out.push(r);
    }
    return out;
  }
  api.post("/services/events/:id/ask", requireUser, wrap(async (req, res) => {   // ask more people
    const x = await ctx(req); needSched(x);
    const s = await one("SELECT * FROM services WHERE id=$1 AND church_id=$2", [Number(req.params.id) || 0, x.c.id]); if (!s) throw bad("No such service.", 404);
    const asked = await addRequests(x, s, req.body);
    if (req.body.email !== false) await askByEmail(x.c, s, asked);
    res.json({ ok: true, asked: asked.length, away: asked.away });
  }));
  api.post("/services/events/:id/edit", requireUser, wrap(async (req, res) => {
    const x = await ctx(req); needSched(x);
    const s = await one("SELECT * FROM services WHERE id=$1 AND church_id=$2", [Number(req.params.id) || 0, x.c.id]); if (!s) throw bad("No such service.", 404);
    const title = req.body.title != null ? String(req.body.title).trim().slice(0, 100) || s.title : s.title, at = req.body.startsAt ? new Date(String(req.body.startsAt)) : s.starts_at;
    if (isNaN(at)) throw bad("Pick the date and time.");
    await q("UPDATE services SET title=$1, starts_at=$2, notes=$3 WHERE id=$4", [title, at, req.body.notes != null ? String(req.body.notes).slice(0, 2000) : s.notes, s.id]); res.json({ ok: true });
  }));
  api.post("/services/events/:id/songs", requireUser, wrap(async (req, res) => {   // { songs: [{ title, key, bpm, notes }] } - the whole list
    const x = await ctx(req); needSched(x);
    const s = await one("UPDATE services SET songs=$1 WHERE id=$2 AND church_id=$3 RETURNING songs", [JSON.stringify(songsOf(req.body.songs)), Number(req.params.id) || 0, x.c.id]);
    if (!s) throw bad("No such service.", 404);
    res.json({ ok: true, songs: s.songs });
  }));
  // ---- everyone: the days you can't serve (schedulers can add them for anyone on a team)
  api.post("/services/blockouts", requireUser, wrap(async (req, res) => {   // { from: "YYYY-MM-DD", to, note, email? }
    const x = await ctx(req), me = req.user.email.toLowerCase();
    const email = x.scheduler && req.body.email ? String(req.body.email).trim().toLowerCase() : me;
    const from = String(req.body.from || ""), to = String(req.body.to || req.body.from || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || isNaN(new Date(from)) || isNaN(new Date(to))) throw bad("Pick the first and last day you're away.");
    if (to < from) throw bad("The last day is before the first day.");
    if ((new Date(to) - new Date(from)) / 864e5 > 366) throw bad("Up to a year at a time.");
    const who = email === me ? req.user.name : ((await one("SELECT m.name FROM service_team_members m JOIN service_teams t ON t.id=m.team_id WHERE t.church_id=$1 AND m.email=$2 LIMIT 1", [x.c.id, email])) || {}).name;
    const n = await one("SELECT COUNT(*)::int AS n FROM service_blockouts WHERE church_id=$1 AND email=$2 AND ends_on >= now()::date", [x.c.id, email]);
    if (n.n >= 50) throw bad("That's a lot of dates away. Remove some old ones first.");
    const b = await one("INSERT INTO service_blockouts (church_id,email,name,starts_on,ends_on,note) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id", [x.c.id, email, who || "", from, to, String(req.body.note || "").trim().slice(0, 200)]);
    // already asked for a service on those days and not answered yet: it's a no
    const hit = await q(`UPDATE service_requests r SET status='declined', note=CASE WHEN r.note='' THEN 'Away' ELSE r.note END, responded_at=now() FROM services s
      WHERE s.id=r.service_id AND s.church_id=$1 AND r.email=$2 AND r.status='pending' AND s.starts_at > now()
      AND (s.starts_at AT TIME ZONE $5)::date BETWEEN $3::date AND $4::date RETURNING r.id`, [x.c.id, email, from, to, config.timeZone || "America/Chicago"]);
    res.json({ ok: true, id: String(b.id), declined: hit.length });
  }));
  api.post("/services/blockouts/:id/remove", requireUser, wrap(async (req, res) => {
    const x = await ctx(req);
    const b = await one("SELECT * FROM service_blockouts WHERE id=$1 AND church_id=$2", [Number(req.params.id) || 0, x.c.id]);
    if (!b) throw bad("No such date.", 404);
    if (b.email !== req.user.email.toLowerCase() && !x.scheduler) throw bad("That's someone else's.", 403);
    await q("DELETE FROM service_blockouts WHERE id=$1", [b.id]); res.json({ ok: true });
  }));
  api.post("/services/events/:id/remove", requireUser, wrap(async (req, res) => {
    const x = await ctx(req); needSched(x);
    await q("DELETE FROM services WHERE id=$1 AND church_id=$2", [Number(req.params.id) || 0, x.c.id]); res.json({ ok: true });
  }));
  api.post("/services/requests/:id/remove", requireUser, wrap(async (req, res) => {
    const x = await ctx(req); needSched(x);
    await q("DELETE FROM service_requests r USING services s WHERE r.id=$1 AND s.id=r.service_id AND s.church_id=$2", [Number(req.params.id) || 0, x.c.id]); res.json({ ok: true });
  }));

  // ---- everyone: accept or decline (your own requests; a scheduler can mark anyone's)
  api.post("/services/requests/:id", requireUser, wrap(async (req, res) => {
    const x = await ctx(req), status = String(req.body.status || "");
    if (!["accepted", "declined", "pending"].includes(status)) throw bad("Accept or decline.");
    const r = await one("SELECT r.* FROM service_requests r JOIN services s ON s.id=r.service_id WHERE r.id=$1 AND s.church_id=$2", [Number(req.params.id) || 0, x.c.id]);
    if (!r) throw bad("No such request.", 404);
    if (r.email !== req.user.email.toLowerCase() && !x.scheduler) throw bad("That's someone else's request.", 403);
    await q("UPDATE service_requests SET status=$1, note=$2, responded_at=now() WHERE id=$3", [status, String(req.body.note || "").slice(0, 300), r.id]);
    res.json({ ok: true });
  }));

  // ---- the main admin: who schedules (up to 4)
  api.post("/services/schedulers", requireUser, wrap(async (req, res) => {   // { emails: [...] }
    const c = await churchOf(req.user.id);
    if (!c || c.role !== "owner") throw bad("Only the main admin picks the schedulers.", 403);
    const emails = (Array.isArray(req.body.emails) ? req.body.emails : []).map((e) => String(e).toLowerCase()).slice(0, LIM.schedulers + 1);
    if (emails.length > LIM.schedulers) throw bad("Up to " + LIM.schedulers + " schedulers.");
    const users = emails.length ? await q("SELECT u.id, u.email FROM users u JOIN church_members m ON m.user_id=u.id WHERE m.church_id=$1 AND u.email = ANY($2)", [c.id, emails]) : [];
    if (users.length !== emails.length) throw bad("Schedulers must be people in your church with an account.");
    const client = await pool.connect();
    try {
      await client.query("BEGIN"); await client.query("DELETE FROM service_schedulers WHERE church_id=$1", [c.id]);
      for (const u of users) await client.query("INSERT INTO service_schedulers (church_id,user_id) VALUES ($1,$2)", [c.id, u.id]);
      await client.query("COMMIT");
    } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
    res.json({ ok: true });
  }));
}

// The day before a service (from 9 in the morning, in TIME_ZONE), or when it's less than 18 hours away: everyone who
// accepted gets "you're serving tomorrow", and anyone who hasn't answered gets "please answer". Once per request; not
// for someone asked in the last hour (they just got the ask), nor once the service has started.
export async function remindServices() {
  const tz = config.timeZone || "America/Chicago";
  const due = await q(`SELECT r.*, s.title, s.starts_at, s.notes, s.songs, s.church_id, c.name AS church, t.name AS team
    FROM service_requests r JOIN services s ON s.id=r.service_id JOIN churches c ON c.id=s.church_id JOIN service_teams t ON t.id=r.team_id
    WHERE r.reminded_at IS NULL AND r.status IN ('accepted','pending') AND r.asked_at < now() - interval '1 hour' AND s.starts_at > now() AND c.has_services AND (
      ((s.starts_at AT TIME ZONE $1)::date = (now() AT TIME ZONE $1)::date + 1 AND extract(hour FROM now() AT TIME ZONE $1) >= 9)
      OR s.starts_at < now() + interval '18 hours')
    ORDER BY s.starts_at, r.id LIMIT 1000`, [tz]);
  let n = 0;
  for (const r of due) {
    const claimed = await one("UPDATE service_requests SET reminded_at=now() WHERE id=$1 AND reminded_at IS NULL RETURNING id", [r.id]);   // (once, even if two run)
    if (!claimed) continue;
    const yes = r.status === "accepted", link = config.publicUrl + "/#services", w = when(r.starts_at);
    const subject = yes ? "Reminder: you're serving at " + r.title + " - " + w : "Please answer: " + r.title + " - " + w;
    const line = yes ? "You're serving" + (r.role ? " as " + r.role : "") + " (" + r.team + ") at " + r.title + ", " + w + "."
      : "You're asked to serve" + (r.role ? " as " + r.role : "") + " (" + r.team + ") at " + r.title + ", " + w + ", and you haven't answered yet. Accept or decline so the team knows.";
    const m = await sendMail(r.email, subject, (r.name ? "Hi " + r.name + ",\n\n" : "Hi,\n\n") + line + (r.notes ? "\n\nNotes: " + r.notes : "") + (yes ? songsText(r.songs || []) : "") + "\n\nCentral Services, or here: " + link + "\n\n" + r.church + "\n",
      '<div style="font:15px/1.5 system-ui,sans-serif;max-width:520px"><p>' + (r.name ? "Hi " + escHtml(r.name) + "," : "Hi,") + "</p><p>" + escHtml(line) + "</p>" + (r.notes ? '<p style="color:#555">Notes: ' + escHtml(r.notes) + "</p>" : "") + (yes ? songsHtml(r.songs || []) : "") +
        "<p>See the schedule in <b>Central Services</b>, or <a href=\"" + escHtml(link) + "\">on the website</a>.</p><p>" + escHtml(r.church) + "</p></div>");
    if (m.sent) n++;
  }
  return n;
}
