// Setlists (10.0): the church's setlists live on its account, so Central Pedal Control, Central Control and the pedal
// all see the earlier ones ("Load setlist"). Making one ("Create new") names it and picks the team from the people on
// the church's Central Services teams - as many as the church has slots. "Add songs" opens the website on the
// setlist (#setlist-<id>): songs the person owns, or any song with Central Tracks Unlimited, go straight in; the rest
// are bought first. The app that opened it checks the setlist every few seconds and downloads what was added.
// Someone without a church keeps their own setlists (no team).
import { q, one } from "./db.js";
import { config, SERVICES_LIMITS as LIM } from "./config.js";
import { churchOf, trialActive } from "./licenses.js";

function bad(msg, status = 400) { const e = new Error(msg); e.status = status; return e; }
const text = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
export const SETLIST_LIMITS = { songs: 100, perChurch: 500 };

// how many people a setlist's team can have: the church's Central Services slots (a trial: anyone on the teams)
export function teamMax(c) {
  if (!c) return 0;
  if ((c.services_slots || 0) > 0) return c.services_slots;
  return trialActive(c) ? LIM.people : 0;
}
async function scope(req) {
  const c = await churchOf(req.user.id);
  return { c, where: c ? "church_id=$1" : "church_id IS NULL AND owner_id=$1", arg: c ? c.id : req.user.id };
}
async function mine(req, id) {
  const s = await scope(req);
  const row = await one("SELECT * FROM setlists WHERE id=$2 AND NOT deleted AND " + s.where, [s.arg, Number(id) || 0]);
  if (!row) throw bad("That setlist isn't here any more.", 404);
  return { s, row };
}
export function setlistOut(r, full) {
  const songs = Array.isArray(r.songs) ? r.songs : [], team = Array.isArray(r.team) ? r.team : [];
  const o = { id: String(r.id), name: r.name, count: songs.length, team: team.map((t) => ({ email: t.email, name: t.name || "", role: t.role || "" })),
    serviceAt: r.service_at || null, createdBy: r.created_by || "", updatedAt: r.updated_at, createdAt: r.created_at };
  if (full) o.songs = songs; else o.titles = songs.slice(0, 6).map((x) => x.title);
  return o;
}
// the people a setlist's team is picked from: the church's Central Services teams and its members
async function people(c) {
  if (!c) return [];
  const onTeams = await q("SELECT DISTINCT ON (m.email) m.email, m.name, m.role, t.name AS team FROM service_team_members m JOIN service_teams t ON t.id=m.team_id WHERE t.church_id=$1 ORDER BY m.email, t.kind DESC", [c.id]);
  const members = await q("SELECT u.email, u.name, m.role AS church_role FROM church_members m JOIN users u ON u.id=m.user_id WHERE m.church_id=$1 AND m.role <> 'church'", [c.id]);
  const out = new Map();
  for (const p of onTeams) out.set(p.email.toLowerCase(), { email: p.email.toLowerCase(), name: p.name || "", role: p.role || "", team: p.team || "" });
  for (const p of members) { const k = p.email.toLowerCase(); if (!out.has(k)) out.set(k, { email: k, name: p.name || "", role: "", team: "" }); else if (!out.get(k).name && p.name) out.get(k).name = p.name; }
  return [...out.values()].sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email));
}
async function cleanTeam(c, list) {
  if (!Array.isArray(list) || !list.length) return [];
  const max = teamMax(c);
  if (!c) throw bad("Adding a team needs a church account with Central Services.", 403);
  if (!max) throw bad("Your church doesn't have Central Services yet, so there's no team to pick from. Every pack comes with some slots, or get them on the website.", 402);
  const known = new Map((await people(c)).map((p) => [p.email, p]));
  const out = [], seen = new Set();
  for (const x of list) {
    const email = text(x && x.email, 200).toLowerCase();
    if (!emailOk(email) || seen.has(email)) continue;
    const p = known.get(email);
    if (!p) throw bad(email + " isn't on your church's teams. Add them in Central Services first.");
    seen.add(email); out.push({ email, name: p.name, role: text(x && x.role, 40) || p.role });
  }
  if (out.length > max) throw bad("Your church has " + max + " Central Services slot" + (max === 1 ? "" : "s") + ", so a setlist can have up to " + max + " people.", 402);
  return out;
}
function cleanSongs(list) {
  return (Array.isArray(list) ? list : []).slice(0, SETLIST_LIMITS.songs).map((x) => {
    const s = { title: text(x && x.title, 120) };
    if (x && x.trackId != null && String(x.trackId).match(/^\d{1,12}$/)) s.trackId = String(x.trackId);
    if (x && x.localId) s.localId = text(x.localId, 80);
    if (x && x.key) s.key = text(x.key, 12);
    const bpm = Math.round(Number(x && x.bpm) || 0); if (bpm > 0 && bpm < 400) s.bpm = bpm;
    if (x && x.kind) s.kind = text(x.kind, 20);
    if (x && x.tracks) s.tracks = true;   // (10.0.1: an app's own song that has multitracks - Central Services shows it)
    if (x && x.addedBy) s.addedBy = text(x.addedBy, 200);
    if (x && x.at) s.at = text(x.at, 40);
    return s;
  }).filter((s) => s.title);
}

// addTrack(user, trackId) -> the track row (owned now, or added with the subscription); throws 402 { checkoutUrl } otherwise
export function routes(api, { wrap, requireUser, addTrack }) {
  api.get("/setlists", requireUser, wrap(async (req, res) => {
    const s = await scope(req);
    const rows = await q("SELECT * FROM setlists WHERE NOT deleted AND " + s.where + " ORDER BY updated_at DESC LIMIT 200", [s.arg]);
    // (?full=1: each setlist's songs too - Central Services shows every service's setlist with its keys, tempos and tracks)
    res.json({ setlists: rows.map((r) => setlistOut(r, req.query.full === "1")), church: s.c ? s.c.name : null, teamMax: teamMax(s.c) });
  }));
  // who can be on a setlist's team (search by name or email), and how many there can be
  api.get("/setlists/people", requireUser, wrap(async (req, res) => {
    const s = await scope(req), term = text(req.query.q, 80).toLowerCase();
    const all = await people(s.c);
    const hits = term ? all.filter((p) => (p.name + " " + p.email + " " + p.role + " " + p.team).toLowerCase().includes(term)) : all;
    res.json({ people: hits.slice(0, 50), total: all.length, max: teamMax(s.c), church: s.c ? s.c.name : null,
      why: !s.c ? "Teams come from a church account. You can still make setlists for yourself." : !teamMax(s.c) ? "Your church doesn't have Central Services yet. Every pack comes with some slots." : "" });
  }));
  api.get("/setlists/:id", requireUser, wrap(async (req, res) => { const { row } = await mine(req, req.params.id); res.json({ setlist: setlistOut(row, true) }); }));
  api.post("/setlists", requireUser, wrap(async (req, res) => {
    const s = await scope(req), name = text(req.body.name, 120);
    if (!name) throw bad("Give the setlist a name.");
    const n = (await one("SELECT COUNT(*)::int AS n FROM setlists WHERE NOT deleted AND " + s.where, [s.arg])).n;
    if (n >= SETLIST_LIMITS.perChurch) throw bad("That's " + SETLIST_LIMITS.perChurch + " setlists already. Delete some old ones first.");
    const team = await cleanTeam(s.c, req.body.team), songs = cleanSongs(req.body.songs);
    const at = req.body.serviceAt ? new Date(req.body.serviceAt) : null;
    const row = await one("INSERT INTO setlists (church_id, owner_id, name, team, songs, service_at, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *",
      [s.c ? s.c.id : null, req.user.id, name, JSON.stringify(team), JSON.stringify(songs), at && !isNaN(at) ? at : null, req.user.email]);
    res.json({ setlist: setlistOut(row, true) });
  }));
  // rename, change the team, or (the apps) put the setlist's songs in the order they have them
  api.post("/setlists/:id", requireUser, wrap(async (req, res) => {
    const { s, row } = await mine(req, req.params.id), sets = [], args = [row.id];
    if (req.body.name != null) { const name = text(req.body.name, 120); if (!name) throw bad("Give the setlist a name."); args.push(name); sets.push("name=$" + args.length); }
    if (req.body.team != null) { args.push(JSON.stringify(await cleanTeam(s.c, req.body.team))); sets.push("team=$" + args.length); }
    if (req.body.songs != null) {
      // songs added on the website since the app last looked stay, after the app's own list
      const next = cleanSongs(req.body.songs), have = new Set(next.filter((x) => x.trackId).map((x) => x.trackId));
      const keep = (Array.isArray(row.songs) ? row.songs : []).filter((x) => x.trackId && !have.has(x.trackId) && x.fromWeb && !(req.body.removed || []).map(String).includes(x.trackId));
      args.push(JSON.stringify(next.concat(keep).slice(0, SETLIST_LIMITS.songs))); sets.push("songs=$" + args.length);
    }
    if (req.body.serviceAt !== undefined) { const at = req.body.serviceAt ? new Date(req.body.serviceAt) : null; args.push(at && !isNaN(at) ? at : null); sets.push("service_at=$" + args.length); }
    if (!sets.length) return res.json({ setlist: setlistOut(row, true) });
    const out = await one("UPDATE setlists SET " + sets.join(", ") + ", updated_at=now() WHERE id=$1 RETURNING *", args);
    res.json({ setlist: setlistOut(out, true) });
  }));
  api.post("/setlists/:id/remove", requireUser, wrap(async (req, res) => {
    const { row } = await mine(req, req.params.id);
    await q("UPDATE setlists SET deleted=TRUE, updated_at=now() WHERE id=$1", [row.id]);
    res.json({ ok: true });
  }));
  // the website's "Add songs": a Central Tracks song goes into the setlist (bought first when it has to be)
  api.post("/setlists/:id/songs", requireUser, wrap(async (req, res) => {
    const { row } = await mine(req, req.params.id), id = String(req.body.trackId || "");
    if (!/^\d{1,12}$/.test(id)) throw bad("Which song?");
    const songs = Array.isArray(row.songs) ? row.songs : [];
    if (songs.some((x) => x.trackId === id)) return res.json({ setlist: setlistOut(row, true), already: true });
    if (songs.length >= SETLIST_LIMITS.songs) throw bad("A setlist holds up to " + SETLIST_LIMITS.songs + " songs.");
    let t;
    try { t = await addTrack(req.user, id); }
    catch (e) { if (e.status === 402) return res.status(402).json({ error: e.message, checkoutUrl: e.checkoutUrl || config.publicUrl + "/#buy-" + id }); throw e; }
    if (!["Pad", "Multitrack", "Prime"].includes(t.kind)) throw bad("Only songs (multitracks, Prime tracks and pads) go in a setlist. Sounds, boards and clicks install in the app.");
    songs.push({ trackId: id, title: t.title, key: t.song_key || "", bpm: Number(t.bpm) || 0, kind: t.kind, addedBy: req.user.email, at: new Date().toISOString(), fromWeb: true });
    const out = await one("UPDATE setlists SET songs=$2, updated_at=now() WHERE id=$1 RETURNING *", [row.id, JSON.stringify(songs)]);
    res.json({ setlist: setlistOut(out, true) });
  }));
  api.post("/setlists/:id/songs/remove", requireUser, wrap(async (req, res) => {
    const { row } = await mine(req, req.params.id), id = String(req.body.trackId || "");
    const songs = (Array.isArray(row.songs) ? row.songs : []).filter((x) => x.trackId !== id);
    const out = await one("UPDATE setlists SET songs=$2, updated_at=now() WHERE id=$1 RETURNING *", [row.id, JSON.stringify(songs)]);
    res.json({ setlist: setlistOut(out, true) });
  }));
}
