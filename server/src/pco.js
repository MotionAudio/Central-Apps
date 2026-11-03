// Planning Center Services (10.2): a church signs in with its own Planning Center account (OAuth 2), and its plans
// become Central setlists - the songs in order with their keys and arrangements, the whole order of service (headers,
// other items and their lengths) and who's on the team. The setlist follows the plan: when the plan changes, the
// setlist changes too (a refresh every PCO_REFRESH_MINUTES for upcoming services, and on request).
//
// Motion Audio's app keys live in Render (PCO_CLIENT_ID / PCO_CLIENT_SECRET). Until they're there, the website and the
// apps say "Planning Center isn't connected yet" and a plan can still come in from a file (importPlanFile: a CSV
// exported from Planning Center, or the plan's JSON).
//
// Planning Center's API (publicly documented at developer.planning.center): OAuth at /oauth/authorize and
// /oauth/token (access tokens last 2 hours, refresh tokens 90 days, scope "services"); Services at /services/v2:
// service_types, plans (filter=future), a plan's items (include=song,arrangement,key) and team_members.
//
// The run sheet (feat/10.2-service) plugs in with setRunSheetMaker(fn): fn({ user, church, setlist, plan, items, team,
// source }) is called after each import and its answer comes back as "runSheet". Without it, plan -> setlist works.
import crypto from "node:crypto";
import { q, one } from "./db.js";
import { config } from "./config.js";
import { churchOf } from "./licenses.js";
import { setlistOut, cleanSongs, SETLIST_LIMITS } from "./setlists.js";

function bad(msg, status = 400) { const e = new Error(msg); e.status = status; return e; }
const text = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
export function configured() { return !!(config.pco.clientId && config.pco.clientSecret); }
export function redirectUri() { return config.publicUrl + "/pco/callback"; }
const NOT_YET = "Planning Center isn't connected yet. Motion Audio is setting it up; until then, export the plan from Planning Center and import the file here.";

// ------------------------------------------------------------------ who
async function scopeOf(user) {
  const c = await churchOf(user.id);
  return { c, key: c ? "c:" + c.id : "u:" + user.id, where: c ? "church_id=$1" : "church_id IS NULL AND owner_id=$1", arg: c ? c.id : user.id,
    mainAdmin: !c || c.role === "church" || c.role === "owner", admin: !c || c.role !== "user" };
}
function needMain(s) { if (!s.mainAdmin) throw bad("Only a main admin can connect or disconnect Planning Center.", 403); }
function needAdmin(s) { if (!s.admin) throw bad("Bringing in plans is for the church's admins.", 403); }

// ------------------------------------------------------------------ the tokens, sealed with TOKEN_SECRET
function key() { return crypto.createHash("sha256").update("pco-tokens:" + config.tokenSecret).digest(); }
export function seal(t) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", key(), iv), enc = Buffer.concat([c.update(String(t), "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64url")).join(".");
}
export function unseal(s) {
  const [iv, tag, enc] = String(s || "").split(".").map((x) => Buffer.from(x || "", "base64url"));
  const d = crypto.createDecipheriv("aes-256-gcm", key(), iv); d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}
// the OAuth "state": who started it, for which church, where to go back to, and until when (signed)
function sign(s) { return crypto.createHmac("sha256", config.tokenSecret).update("pco-state:" + s).digest("base64url"); }
export function makeState(o) { const body = Buffer.from(JSON.stringify(Object.assign({ x: Date.now() + 15 * 60e3, n: crypto.randomBytes(6).toString("hex") }, o))).toString("base64url"); return body + "." + sign(body); }
export function readState(s) {
  const [body, mac] = String(s || "").split(".");
  if (!body || !mac || mac.length !== sign(body).length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(sign(body)))) return null;
  try { const o = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); return o.x > Date.now() ? o : null; } catch { return null; }
}

// ------------------------------------------------------------------ talking to Planning Center
async function tokenCall(params) {
  const body = new URLSearchParams(Object.assign({ client_id: config.pco.clientId, client_secret: config.pco.clientSecret }, params));
  const r = await fetch(config.pco.base + "/oauth/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw bad("Planning Center didn't accept the sign-in" + (j.error_description ? ": " + j.error_description : j.error ? " (" + j.error + ")" : "") + ".", 502);
  return j;
}
async function saveLink(scope, tok, extra) {
  const exp = new Date(Date.now() + Math.max(60, Number(tok.expires_in) || 7200) * 1000);
  await q(`INSERT INTO pco_links (scope, access_enc, refresh_enc, expires_at, organization, connected_by) VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (scope) DO UPDATE SET access_enc=EXCLUDED.access_enc, refresh_enc=EXCLUDED.refresh_enc, expires_at=EXCLUDED.expires_at,
      organization=CASE WHEN EXCLUDED.organization <> '' THEN EXCLUDED.organization ELSE pco_links.organization END,
      connected_by=CASE WHEN EXCLUDED.connected_by <> '' THEN EXCLUDED.connected_by ELSE pco_links.connected_by END, last_error=NULL, updated_at=now()`,
  [scope, seal(tok.access_token), seal(tok.refresh_token || ""), exp, (extra && extra.organization) || "", (extra && extra.by) || ""]);
}
async function accessToken(scope) {
  const link = await one("SELECT * FROM pco_links WHERE scope=$1", [scope]);
  if (!link) throw bad("Planning Center isn't connected for your church. A main admin connects it (Account → Planning Center, or in Central Control).", 409);
  if (new Date(link.expires_at).getTime() - Date.now() > 120e3) return unseal(link.access_enc);
  let refresh = ""; try { refresh = unseal(link.refresh_enc); } catch { }
  if (!refresh) throw bad("Planning Center needs you to connect again.", 409);
  try { const tok = await tokenCall({ grant_type: "refresh_token", refresh_token: refresh }); await saveLink(scope, tok); return tok.access_token; }
  catch (e) { await q("UPDATE pco_links SET last_error=$2, updated_at=now() WHERE scope=$1", [scope, "The sign-in ran out. A main admin connects Planning Center again."]); throw bad("Planning Center needs a main admin to connect again (the sign-in ran out).", 409); }
}
async function pcoGet(scope, path, params) {
  const tok = await accessToken(scope);
  let url = path.startsWith("http") ? path : config.pco.base + path;
  if (params) url += (url.includes("?") ? "&" : "?") + new URLSearchParams(params).toString();
  const r = await fetch(url, { headers: { Authorization: "Bearer " + tok, Accept: "application/json", "User-Agent": "MotionAudio-Central (worship playback)" } });
  if (r.status === 401) throw bad("Planning Center refused the sign-in. A main admin connects it again.", 409);
  if (r.status === 404) throw bad("Planning Center doesn't have that any more.", 404);
  if (r.status === 429) throw bad("Planning Center asked us to slow down. Try again in a minute.", 503);
  if (!r.ok) throw bad("Planning Center answered " + r.status + ".", 502);
  return r.json();
}
async function pcoAll(scope, path, params, limit = 300) {
  let url = path, first = true, data = [], included = [];
  for (let page = 0; url && page < 10 && data.length < limit; page++) {
    const j = await pcoGet(scope, url, first ? Object.assign({ per_page: 100 }, params || {}) : null);
    first = false; data = data.concat(j.data || []); included = included.concat(j.included || []);
    url = j.links && j.links.next ? j.links.next : null;
  }
  return { data, included };
}

// ------------------------------------------------------------------ plans in a common shape
const KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"], FLAT = { Db: "C#", Eb: "D#", Gb: "F#", Ab: "G#", Bb: "A#", Cb: "B", Fb: "E" };
function normKey(k) { const m = /^\s*([A-Ga-g])([#b♯♭]?)\s*(m(?!aj)|min|minor)?/.exec(String(k || "")); if (!m) return ""; let r = m[1].toUpperCase() + m[2].replace("♯", "#").replace("♭", "b"); r = FLAT[r] || r; return KEYS.includes(r) ? r + (m[3] ? "m" : "") : ""; }
export function itemsFromApi(data, included) {
  const inc = new Map((included || []).map((i) => [i.type + ":" + i.id, i.attributes || {}]));
  return (data || []).map((d) => {
    const a = d.attributes || {}, rel = d.relationships || {}, id = (r) => r && r.data && r.data.id;
    const song = inc.get("Song:" + id(rel.song)) || {}, arr = inc.get("Arrangement:" + id(rel.arrangement)) || {}, k = inc.get("Key:" + id(rel.key)) || {};
    const type = ["song", "header", "media", "item"].includes(a.item_type) ? a.item_type : "item";
    const o = { id: String(d.id), type, title: text(a.title || song.title, 160), length: Math.max(0, Math.round(Number(a.length) || 0)), description: text(a.description, 400), position: a.service_position || "during" };
    if (type === "song") Object.assign(o, { title: text(song.title || a.title, 160) || "Song", key: normKey(a.key_name || k.starting_key || k.name || arr.chord_chart_key), bpm: Math.round(Number(arr.bpm) || 0) || null,
      meter: arr.meter || null, arrangement: text(arr.name, 80), ccli: song.ccli_number ? String(song.ccli_number) : null, author: text(song.author, 200), copyright: text(song.copyright, 200),
      songId: id(rel.song) || null, arrangementId: id(rel.arrangement) || null, sequence: Array.isArray(arr.sequence) ? arr.sequence.slice(0, 40) : [] });
    if (!o.length && type === "song" && arr.length) o.length = Math.round(Number(arr.length) || 0);
    return o;
  }).filter((x) => x.title || x.type === "header");
}
export function teamFromApi(data, included) {
  const inc = new Map((included || []).map((i) => [i.type + ":" + i.id, i.attributes || {}]));
  const ST = { C: "confirmed", U: "not answered yet", D: "declined" };
  return (data || []).map((d) => { const a = d.attributes || {}, t = inc.get("Team:" + (d.relationships && d.relationships.team && d.relationships.team.data && d.relationships.team.data.id)) || {};
    return { name: text(a.name, 120), position: text(a.team_position_name, 80), team: text(t.name, 80), status: ST[a.status] || text(a.status, 20) }; }).filter((p) => p.name);
}
export function planHash(items, team) { return crypto.createHash("sha256").update(JSON.stringify([items.map((i) => [i.type, i.title, i.length, i.key, i.arrangement, i.ccli, i.position]), team.map((p) => [p.name, p.position, p.status])])).digest("hex").slice(0, 24); }

async function serviceTypes(scope) { const { data } = await pcoAll(scope, "/services/v2/service_types", { order: "sequence" }); return data.map((d) => ({ id: String(d.id), name: text(d.attributes && d.attributes.name, 120) || "Service" })); }
async function plans(scope, st) {
  const { data } = await pcoAll(scope, "/services/v2/service_types/" + encodeURIComponent(st) + "/plans", { filter: "future", order: "sort_date" }, 30);
  return data.slice(0, 30).map((d) => { const a = d.attributes || {}; return { id: String(d.id), title: text(a.title || a.series_title, 160), dates: text(a.dates || a.short_dates, 80), sortDate: a.sort_date || null, items: a.items_count || 0, updatedAt: a.updated_at || null }; });
}
async function planDetail(scope, st, planId) {
  const base = "/services/v2/service_types/" + encodeURIComponent(st) + "/plans/" + encodeURIComponent(planId);
  const p = await pcoGet(scope, base), a = (p.data && p.data.attributes) || {};
  const types = await serviceTypes(scope).catch(() => []), typeName = (types.find((t) => t.id === String(st)) || {}).name || "";
  const it = await pcoAll(scope, base + "/items", { include: "song,arrangement,key" });
  const tm = await pcoAll(scope, base + "/team_members", { include: "team" }).catch(() => ({ data: [], included: [] }));
  return { plan: { id: String(planId), serviceType: String(st), serviceTypeName: typeName, title: text(a.title || a.series_title, 160), dates: text(a.dates || a.short_dates, 80), sortDate: a.sort_date || null, updatedAt: a.updated_at || null },
    items: itemsFromApi(it.data, it.included), team: teamFromApi(tm.data, tm.included) };
}

// ------------------------------------------------------------------ a plan from a file
// Planning Center's exports vary (print layouts, the plan's CSV, spreadsheets people make from it), so this reads any
// CSV with a header row it recognises: a title/item/song column, and any of type, length/time/duration, key, BPM,
// arrangement, author, CCLI, notes. A second table with name + position columns is the team. A plain list (one item
// per line, "3:45 Song title" or "Song title - G") works too. JSON: Planning Center's own items response.
export function parseCsv(textIn) {
  const rows = [], s = String(textIn || "").replace(/^﻿/, "");
  const delim = (s.split("\n")[0].match(/\t/g) || []).length > (s.split("\n")[0].match(/,/g) || []).length ? "\t" : (s.split("\n")[0].match(/;/g) || []).length > (s.split("\n")[0].match(/,/g) || []).length ? ";" : ",";
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) { if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += ch; continue; }
    if (ch === '"' && cell === "") { quoted = true; continue; }
    if (ch === delim) { row.push(cell); cell = ""; continue; }
    if (ch === "\n" || ch === "\r") { if (ch === "\r" && s[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; continue; }
    cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((c) => c.trim()));
}
export function seconds(v) {
  const t = String(v || "").trim().toLowerCase(); if (!t) return 0;
  let m = /^(\d+):(\d{1,2}):(\d{2})$/.exec(t); if (m) return +m[1] * 3600 + +m[2] * 60 + +m[3];
  m = /^(\d+):(\d{2})$/.exec(t); if (m) return +m[1] * 60 + +m[2];
  m = /^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m(?:in)?)?\s*(?:(\d+)\s*s(?:ec)?)?$/.exec(t); if (m && (m[1] || m[2] || m[3])) return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
  return /^\d+$/.test(t) ? +t : 0;
}
const COLS = { title: /^(title|item|item title|song|song title|name of item|element)$/, type: /^(type|item type|kind)$/, length: /^(length|time|duration|len)$/, key: /^(key|song key)$/, bpm: /^(bpm|tempo)$/,
  arrangement: /^(arrangement|arr)$/, author: /^(author|authors|writer|writers|artist)$/, ccli: /^(ccli|ccli #|ccli number|ccli song #|ccli song number)$/, description: /^(notes|note|description|details)$/,
  person: /^(person|name|team member|people)$/, position: /^(position|role|team position)$/, team: /^(team)$/, status: /^(status)$/ };
export function parsePlanFile(name, body) {
  const out = { title: "", dates: "", items: [], team: [] }, raw = String(body || "");
  if (/^\s*\{/.test(raw)) {   // Planning Center's JSON (the items endpoint, optionally with "team_members" beside it)
    let j; try { j = JSON.parse(raw); } catch { throw bad("That file isn't readable JSON."); }
    out.items = itemsFromApi(j.data || [], j.included || []);
    if (j.team_members) out.team = teamFromApi(j.team_members.data || [], j.team_members.included || []);
    out.title = text(j.meta && j.meta.parent && j.meta.parent.attributes && j.meta.parent.attributes.title, 160);
    return out;
  }
  const rows = parseCsv(raw).filter((r) => r.some(Boolean));
  let cols = null, team = null;
  for (const r of rows) {
    const low = r.map((c) => c.toLowerCase());
    const find = (re) => low.findIndex((c) => re.test(c));
    // a header row: at least two cells are column names we know (a data row like "Welcome,Item,2:00" isn't)
    const named = low.filter((c) => Object.values(COLS).some((re) => re.test(c))).length;
    if (named >= 2 && low.some((c) => COLS.person.test(c)) && low.some((c) => COLS.position.test(c))) { team = { person: find(COLS.person), position: find(COLS.position), team: find(COLS.team), status: find(COLS.status) }; cols = null; continue; }
    if (named >= 2 && low.some((c) => COLS.title.test(c))) { cols = {}; for (const k of Object.keys(COLS)) cols[k] = find(COLS[k]); team = null; continue; }
    if (team) { const nm = text(r[team.person], 120); if (nm) out.team.push({ name: nm, position: text(r[team.position], 80), team: team.team >= 0 ? text(r[team.team], 80) : "", status: team.status >= 0 ? text(r[team.status], 20) : "" }); continue; }
    if (!cols) {
      // before any header: "Plan title, dates" lines, or a plain list
      if (r.length === 1 || r.filter(Boolean).length === 1) {
        const line = r.filter(Boolean)[0]; if (!out.items.length && !out.title && /service|sunday|worship|plan|\d{4}/i.test(line) && !/^\d+:\d{2}/.test(line)) { out.title = text(line, 160); continue; }
        const m = /^(\d+:\d{2}(?::\d{2})?)\s+(.+)$/.exec(line) || null, km = /^(.+?)\s+[-–]\s+([A-G][#b]?m?)$/.exec(m ? m[2] : line);
        out.items.push({ id: "f" + (out.items.length + 1), type: km ? "song" : "item", title: text(km ? km[1] : m ? m[2] : line, 160), length: m ? seconds(m[1]) : 0, key: km ? normKey(km[2]) : "", description: "", position: "during" });
      }
      continue;
    }
    const get = (k) => (cols[k] >= 0 ? r[cols[k]] || "" : "");
    const title = text(get("title"), 160); if (!title) continue;
    let type = get("type").toLowerCase(); type = /song/.test(type) ? "song" : /header|heading|section/.test(type) ? "header" : /media|video/.test(type) ? "media" : type ? "item" : "";
    const key = normKey(get("key")), ccli = (get("ccli").match(/\d{3,10}/) || [])[0] || null;
    if (!type) type = key || ccli || get("arrangement") || get("author") ? "song" : "item";
    const it = { id: "f" + (out.items.length + 1), type, title, length: seconds(get("length")), description: text(get("description"), 400), position: "during" };
    if (type === "song") Object.assign(it, { key, bpm: Math.round(Number(get("bpm")) || 0) || null, arrangement: text(get("arrangement"), 80), ccli, author: text(get("author"), 200) });
    out.items.push(it);
  }
  // a plan with no songs marked: items that look like songs (they have a key) are songs
  if (!out.items.length) throw bad("Couldn't find the plan's items in that file. Export the plan from Planning Center as CSV (or a list with one item per line).");
  if (!out.title) out.title = text(String(name || "").replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "), 160);
  return out;
}

// ------------------------------------------------------------------ matching songs to Central Tracks
export function normTitle(t) { return String(t || "").toLowerCase().replace(/\([^)]*\)/g, " ").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(/^(the|a|an) /, "").trim(); }
async function match(songs, user) {
  const live = await q("SELECT id, title, kind, song_key, bpm, ccli, price_cents FROM tracks WHERE status='live' AND kind IN ('Multitrack','Prime','Pad')");
  const owned = new Set((await q("SELECT track_id FROM library WHERE user_id=$1", [user.id])).map((r) => String(r.track_id)));
  const byCcli = new Map(), byTitle = new Map();
  for (const t of live) { if (t.ccli) byCcli.set(String(t.ccli), t); const k = normTitle(t.title); if (k && !byTitle.has(k)) byTitle.set(k, t); else if (k && t.kind === "Multitrack" && byTitle.get(k).kind !== "Multitrack") byTitle.set(k, t); }
  const missing = [];
  const out = songs.map((s) => {
    const t = (s.ccli && byCcli.get(String(s.ccli))) || byTitle.get(normTitle(s.title));
    if (t && owned.has(String(t.id))) return Object.assign({}, s, { trackId: String(t.id), kind: t.kind });
    if (t) missing.push({ title: s.title, trackId: String(t.id), why: "In Central Tracks: buy it, or add it with Central Tracks Unlimited." });
    else missing.push({ title: s.title, why: "Not in Central Tracks. If the church already has it, the apps find it by its name or CCLI number." });
    return s;
  });
  return { songs: out, missing };
}

// ------------------------------------------------------------------ plan -> setlist
let runSheetMaker = null;
export function setRunSheetMaker(fn) { runSheetMaker = typeof fn === "function" ? fn : null; }
function songsFromItems(items) {
  return items.filter((i) => i.type === "song").slice(0, SETLIST_LIMITS.songs).map((i) => ({ title: i.title, key: i.key || "", bpm: i.bpm || 0, ccli: i.ccli || null, author: i.author || "", arrangement: i.arrangement || "", length: i.length || 0, fromPco: true, pcoItem: i.id }));
}
async function existingFor(s, planId) { return planId ? one("SELECT * FROM setlists WHERE NOT deleted AND " + s.where + " AND pco->>'plan' = $2 ORDER BY updated_at DESC LIMIT 1", [s.arg, String(planId)]) : null; }
// save (or update) the setlist for a plan: the plan's songs first, in its order; songs added in the apps or on the
// website stay after them
async function saveSetlist(user, s, d, source, opts) {
  const songs = songsFromItems(d.items), m = await match(songs, user);
  const name = text([d.plan.serviceTypeName, d.plan.dates || d.plan.title].filter(Boolean).join(" · ") || d.plan.title || "Planning Center plan", 120);
  const at = d.plan.sortDate ? new Date(d.plan.sortDate) : null;
  const pco = { source, serviceType: d.plan.serviceType || null, plan: d.plan.id || null, title: d.plan.title || "", dates: d.plan.dates || "", serviceTypeName: d.plan.serviceTypeName || "",
    items: d.items.slice(0, 200), team: d.team.slice(0, 200), missing: m.missing, hash: planHash(d.items, d.team), importedAt: new Date().toISOString(), refreshedAt: new Date().toISOString() };
  let row = opts && opts.setlistId ? await one("SELECT * FROM setlists WHERE id=$2 AND NOT deleted AND " + s.where, [s.arg, Number(opts.setlistId) || 0]) : await existingFor(s, d.plan.id);
  if (opts && opts.setlistId && !row) throw bad("That setlist isn't here any more.", 404);
  if (row) {
    // the songs added in the apps or on the website (not the plan's own, even when an app sent them back unmarked)
    const same = (x, y) => (x.pcoItem && x.pcoItem === y.pcoItem) || (x.trackId && x.trackId === y.trackId) || (x.ccli && x.ccli === y.ccli) || normTitle(x.title) === normTitle(y.title);
    const others = (Array.isArray(row.songs) ? row.songs : []).filter((x) => !x.fromPco && !m.songs.some((y) => same(x, y)));
    const keepImported = row.pco && row.pco.importedAt ? row.pco.importedAt : pco.importedAt; pco.importedAt = keepImported;
    row = await one("UPDATE setlists SET songs=$2, pco=$3, service_at=COALESCE($4, service_at), updated_at=now() WHERE id=$1 RETURNING *", [row.id, JSON.stringify(cleanSongs(m.songs.concat(others))), JSON.stringify(pco), at && !isNaN(at) ? at : null]);
  } else {
    const n = (await one("SELECT COUNT(*)::int AS n FROM setlists WHERE NOT deleted AND " + s.where, [s.arg])).n;
    if (n >= SETLIST_LIMITS.perChurch) throw bad("That's " + SETLIST_LIMITS.perChurch + " setlists already. Delete some old ones first.");
    row = await one("INSERT INTO setlists (church_id, owner_id, name, team, songs, service_at, created_by, pco) VALUES ($1,$2,$3,'[]',$4,$5,$6,$7) RETURNING *",
      [s.c ? s.c.id : null, user.id, name, JSON.stringify(cleanSongs(m.songs)), at && !isNaN(at) ? at : null, user.email, JSON.stringify(pco)]);
  }
  const out = { setlist: setlistOut(row, true), matched: m.songs.filter((x) => x.trackId).length, songs: songs.length, missing: m.missing };
  if (runSheetMaker) { try { out.runSheet = await runSheetMaker({ user, church: s.c, setlist: out.setlist, plan: d.plan, items: d.items, team: d.team, source }); } catch (e) { out.runSheetError = e.message; } }
  return out;
}
// a plan already in the common shape ({ plan, items, team }) -> the setlist (the run sheet code and the tests use it)
export async function importPlan(user, d, source, opts) { const s = await scopeOf(user); needAdmin(s); return saveSetlist(user, s, { plan: Object.assign({ id: null, serviceType: null, serviceTypeName: "", title: "", dates: "", sortDate: null }, d.plan || {}), items: d.items || [], team: d.team || [] }, source || "file", opts || {}); }
// the setlist follows its plan: fetch it again, and change the setlist only when the plan changed
export async function refreshSetlist(row, user) {
  if (!row || !row.pco || row.pco.source !== "api" || !row.pco.plan) return { changed: false };
  const s = row.church_id ? { c: await one("SELECT c.*, 'owner' AS role FROM churches c WHERE id=$1", [row.church_id]), key: "c:" + row.church_id, where: "church_id=$1", arg: row.church_id, admin: true } : { c: null, key: "u:" + row.owner_id, where: "church_id IS NULL AND owner_id=$1", arg: row.owner_id, admin: true };
  const d = await planDetail(s.key, row.pco.serviceType, row.pco.plan);
  if (planHash(d.items, d.team) === row.pco.hash) { await q("UPDATE setlists SET pco = jsonb_set(pco, '{refreshedAt}', to_jsonb($2::text)) WHERE id=$1", [row.id, new Date().toISOString()]); return { changed: false }; }
  const owner = user || await one("SELECT * FROM users WHERE id=$1", [row.owner_id]);
  const r = await saveSetlist(owner, s, d, "api", { setlistId: row.id });
  return { changed: true, setlist: r.setlist, missing: r.missing };
}
let refreshing = false;
export async function refreshUpcoming() {
  if (refreshing || !configured()) return 0; refreshing = true; let n = 0;
  try {
    const rows = await q(`SELECT s.* FROM setlists s JOIN pco_links l ON l.scope = CASE WHEN s.church_id IS NULL THEN 'u:' || s.owner_id ELSE 'c:' || s.church_id END
      WHERE NOT s.deleted AND s.pco->>'source' = 'api' AND l.last_error IS NULL AND (s.service_at IS NULL OR (s.service_at > now() - interval '1 day' AND s.service_at < now() + interval '30 days'))
      ORDER BY s.service_at NULLS LAST LIMIT 100`);
    for (const r of rows) { try { if ((await refreshSetlist(r)).changed) n++; } catch (_) { } }
  } finally { refreshing = false; }
  return n;
}

// ------------------------------------------------------------------ routes
const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font:16px/1.5 Inter,system-ui,sans-serif;background:#0d1117;color:#e6edf3;display:grid;place-items:center;min-height:100vh;margin:0}main{max-width:460px;padding:2rem;text-align:center}a{color:#7cc4ff}</style></head><body><main>${body}</main></body></html>`;
const escH = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export function routes(api, app, { wrap, requireUser }) {
  api.get("/pco/status", requireUser, wrap(async (req, res) => {
    const s = await scopeOf(req.user), link = await one("SELECT organization, connected_by, created_at, updated_at, last_error FROM pco_links WHERE scope=$1", [s.key]);
    res.json({ configured: configured(), connected: !!link && !link.last_error, organization: link ? link.organization : "", connectedBy: link ? link.connected_by : "", connectedAt: link ? link.created_at : null,
      problem: link && link.last_error ? link.last_error : "", canConnect: s.mainAdmin, canImport: s.admin, why: configured() ? "" : NOT_YET, redirectUri: redirectUri() });
  }));
  api.post("/pco/connect", requireUser, wrap(async (req, res) => {
    const s = await scopeOf(req.user); needMain(s);
    if (!configured()) throw bad(NOT_YET, 409);
    const from = req.body && req.body.from === "app" ? "app" : "web";
    const state = makeState({ u: String(req.user.id), s: s.key, r: from });
    const url = config.pco.base + "/oauth/authorize?" + new URLSearchParams({ client_id: config.pco.clientId, redirect_uri: redirectUri(), response_type: "code", scope: "services", state }).toString();
    res.json({ url });
  }));
  app.get("/pco/callback", wrap(async (req, res) => {
    const st = readState(req.query.state), back = (ok, msg) => st && st.r === "web" ? res.redirect(302, config.publicUrl + "/#account-pco-" + (ok ? "connected" : "failed")) :
      res.status(ok ? 200 : 400).type("html").send(page("Planning Center", ok ? "<h1>Planning Center is connected</h1><p>You can close this window and go back to the app.</p>" : "<h1>Planning Center didn't connect</h1><p>" + escH(msg) + "</p><p>Close this window and try again from the app.</p>"));
    if (!st) return res.status(400).type("html").send(page("Planning Center", "<h1>That link ran out</h1><p>Start again from Account → Planning Center, or from the app.</p>"));
    if (req.query.error || !req.query.code) return back(false, req.query.error === "access_denied" ? "The sign-in was cancelled." : "Planning Center didn't send the sign-in back.");
    const user = await one("SELECT * FROM users WHERE id=$1", [Number(st.u) || 0]);
    if (!user) return back(false, "That account isn't here any more.");
    const s = await scopeOf(user); if (s.key !== st.s || !s.mainAdmin) return back(false, "Only a main admin of the church can connect Planning Center.");
    try {
      const tok = await tokenCall({ grant_type: "authorization_code", code: String(req.query.code), redirect_uri: redirectUri() });
      await saveLink(s.key, tok, { by: user.email });
      let org = ""; try { const j = await pcoGet(s.key, "/services/v2"); org = text(j.data && j.data.attributes && j.data.attributes.name, 120); } catch (_) { }
      if (org) await q("UPDATE pco_links SET organization=$2 WHERE scope=$1", [s.key, org]);
      back(true);
    } catch (e) { back(false, e.message); }
  }));
  api.post("/pco/disconnect", requireUser, wrap(async (req, res) => {
    const s = await scopeOf(req.user); needMain(s);
    const link = await one("SELECT * FROM pco_links WHERE scope=$1", [s.key]);
    if (link && configured()) { try { await fetch(config.pco.base + "/oauth/revoke", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: unseal(link.access_enc), client_id: config.pco.clientId, client_secret: config.pco.clientSecret }) }); } catch (_) { } }
    await q("DELETE FROM pco_links WHERE scope=$1", [s.key]);
    res.json({ ok: true });
  }));
  api.get("/pco/service-types", requireUser, wrap(async (req, res) => { const s = await scopeOf(req.user); needAdmin(s); res.json({ serviceTypes: await serviceTypes(s.key) }); }));
  api.get("/pco/plans", requireUser, wrap(async (req, res) => {
    const s = await scopeOf(req.user); needAdmin(s); const st = String(req.query.serviceType || ""); if (!/^\d{1,15}$/.test(st)) throw bad("Which service type?");
    const list = await plans(s.key, st), mine = await q("SELECT id, pco->>'plan' AS plan FROM setlists WHERE NOT deleted AND " + s.where + " AND pco IS NOT NULL", [s.arg]);
    const have = new Map(mine.map((m) => [m.plan, String(m.id)]));
    res.json({ plans: list.map((p) => Object.assign(p, { setlistId: have.get(p.id) || null })) });
  }));
  api.get("/pco/plan", requireUser, wrap(async (req, res) => {
    const s = await scopeOf(req.user); needAdmin(s); const st = String(req.query.serviceType || ""), pl = String(req.query.plan || "");
    if (!/^\d{1,15}$/.test(st) || !/^\d{1,15}$/.test(pl)) throw bad("Which plan?");
    res.json(await planDetail(s.key, st, pl));
  }));
  api.post("/pco/import", requireUser, wrap(async (req, res) => {
    const s = await scopeOf(req.user); needAdmin(s); const st = String(req.body.serviceType || ""), pl = String(req.body.plan || "");
    if (!/^\d{1,15}$/.test(st) || !/^\d{1,15}$/.test(pl)) throw bad("Which plan?");
    res.json(await saveSetlist(req.user, s, await planDetail(s.key, st, pl), "api", { setlistId: req.body.setlistId }));
  }));
  api.post("/pco/import-file", requireUser, wrap(async (req, res) => {
    const s = await scopeOf(req.user); needAdmin(s);
    const body = String(req.body.text || ""); if (!body.trim()) throw bad("The file is empty."); if (body.length > 250000) throw bad("That file is too big for a plan.");
    const f = parsePlanFile(req.body.name, body);
    const d = { plan: { id: null, serviceType: null, serviceTypeName: "", title: f.title, dates: text(req.body.dates, 80) || f.dates, sortDate: req.body.serviceAt || null }, items: f.items, team: f.team };
    res.json(await saveSetlist(req.user, s, d, "file", { setlistId: req.body.setlistId }));
  }));
  api.post("/pco/refresh", requireUser, wrap(async (req, res) => {
    const s = await scopeOf(req.user), row = await one("SELECT * FROM setlists WHERE id=$2 AND NOT deleted AND " + s.where, [s.arg, Number(req.body.setlistId) || 0]);
    if (!row) throw bad("That setlist isn't here any more.", 404);
    if (!row.pco || row.pco.source !== "api") throw bad("That setlist didn't come from Planning Center's sign-in, so there's nothing to check.", 409);
    res.json(await refreshSetlist(row, req.user));
  }));
  // the setlists follow their plans: upcoming services every PCO_REFRESH_MINUTES (0 = only when asked)
  if (config.pco.refreshMinutes > 0) { const t = setInterval(() => { refreshUpcoming().catch(() => { }); }, config.pco.refreshMinutes * 60e3); if (t.unref) t.unref(); }
}
