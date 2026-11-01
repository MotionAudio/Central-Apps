// CCLI (10.2): the church's licence numbers, the copyright line on the lyric slides, every use of a song, and the
// CCLI report.
//
//   Settings   GET/POST /v1/ccli/settings: the CCLI licence number and the streaming licence number, and how the
//              copyright line reads (on/off, on the first / last / every slide, the wording). On by default, as CCLI
//              asks. The main admins change them; everyone in the church reads them (the apps show the line).
//   Usage      POST /v1/ccli/usage: the apps send each song shown on a screen (display), streamed, recorded, printed
//              or translated - once per song, kind and day for the whole church (two screens, or the pedal and
//              Central Control both showing it, count once, the way CCLI counts a service).
//   Report     GET /v1/ccli/report?from&to[&format=csv]: each song with its CCLI number and how many times it was used
//              each way. The file has the columns CCLI's reporting page asks for (Digital - shown on screens -, Print,
//              Record, Translate, and Stream for the Streaming Licence), ready to enter.
//   SongSelect GET /v1/ccli/songselect/search, POST /v1/ccli/report/submit: the direct connection (ccli-partner.js),
//              off until CCLI approves Motion Audio as a partner.
import { q, one } from "./db.js";
import { churchOf } from "./licenses.js";
import * as partner from "./ccli-partner.js";

function bad(msg, status = 400) { const e = new Error(msg); e.status = status; return e; }
const text = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
export const KINDS = ["display", "print", "record", "stream", "translate"];
export const DEFAULT_TEMPLATE = "{title} · {authors} · © {copyright} · CCLI Song # {ccli} · CCLI License # {license}";
// (the same keys as js/ccli.js: a song is its CCLI number, or its plain title when it has none)
export function normTitle(t) { return String(t || "").toLowerCase().replace(/\([^)]*\)/g, " ").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(/^(the|a|an) /, "").trim(); }
export function songKey(s) { const c = String((s && s.ccli) || "").replace(/[^0-9]/g, ""); return c ? "ccli:" + c : "t:" + normTitle(s && s.title); }

async function scopeOf(user) {
  const c = await churchOf(user.id);
  return { c, key: c ? "c:" + c.id : "u:" + user.id, mainAdmin: !c || c.role === "church" || c.role === "owner", admin: !c || c.role !== "user" };
}
function cleanCredit(c) {
  c = c || {};
  return { on: c.on !== false, where: ["first", "last", "every"].includes(c.where) ? c.where : "first", template: text(String(c.template || "").replace(/[<>]/g, ""), 300) || DEFAULT_TEMPLATE };
}
export async function settingsFor(scope) {
  const r = await one("SELECT data FROM ccli_settings WHERE scope=$1", [scope]), d = (r && r.data) || {};
  return { license: d.license || "", streaming: d.streaming || "", credit: cleanCredit(d.credit) };
}
const digits = (v) => String(v == null ? "" : v).replace(/[^0-9]/g, "").slice(0, 12);
function validDay(d) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d || ""))) return null;
  const t = Date.parse(d + "T12:00:00Z"); if (isNaN(t)) return null;
  if (t > Date.now() + 2 * 86400e3 || t < Date.now() - 800 * 86400e3) return null;   // (a clock that's far out: not a real day)
  return d;
}
const csvCell = (v) => { const s = String(v == null ? "" : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
export async function report(scope, from, to) {
  const rows = await q(`SELECT song_key, max(title) AS title, max(ccli) AS ccli, max(authors) AS authors, max(copyright) AS copyright,
      count(*) FILTER (WHERE kind='display')::int AS display, count(*) FILTER (WHERE kind='print')::int AS print, count(*) FILTER (WHERE kind='record')::int AS record,
      count(*) FILTER (WHERE kind='stream')::int AS stream, count(*) FILTER (WHERE kind='translate')::int AS translate, min(day)::text AS first, max(day)::text AS last
    FROM ccli_usage WHERE scope=$1 AND day BETWEEN $2 AND $3 GROUP BY song_key ORDER BY lower(max(title))`, [scope, from, to]);
  const songs = rows.map((r) => ({ title: r.title, ccli: r.ccli || null, authors: r.authors || "", copyright: r.copyright || "", display: r.display, print: r.print, record: r.record, stream: r.stream, translate: r.translate, total: r.display + r.print + r.record + r.stream + r.translate, first: r.first, last: r.last }));
  const totals = songs.reduce((t, s) => { KINDS.forEach((k) => { t[k] += s[k]; }); return t; }, { display: 0, print: 0, record: 0, stream: 0, translate: 0 });
  return { from, to, songs, totals, missingCcli: songs.filter((s) => !s.ccli).length };
}
export function reportCsv(r, info) {
  const head = ["Song Title", "CCLI Song #", "Authors", "Copyright", "Digital (shown on screens)", "Print", "Record", "Translate", "Stream", "First used", "Last used"];
  const lines = [head.map(csvCell).join(",")].concat(r.songs.map((s) => [s.title, s.ccli || "", s.authors, s.copyright, s.display, s.print, s.record, s.translate, s.stream, s.first, s.last].map(csvCell).join(",")));
  lines.push("");
  lines.push(["Church", info.church || ""].map(csvCell).join(","));
  lines.push(["CCLI License #", info.license || "not set"].map(csvCell).join(","));
  lines.push(["CCLI Streaming License #", info.streaming || "not set"].map(csvCell).join(","));
  lines.push(["Period", r.from + " to " + r.to].map(csvCell).join(","));
  lines.push(["Counted", "once per song, use and day (a service), as CCLI counts"].map(csvCell).join(","));
  return lines.join("\r\n") + "\r\n";
}

export function routes(api, { wrap, requireUser }) {
  api.get("/ccli/settings", requireUser, wrap(async (req, res) => {
    const s = await scopeOf(req.user);
    res.json(Object.assign(await settingsFor(s.key), { canEdit: s.mainAdmin, church: s.c ? s.c.name : null, partner: partner.status() }));
  }));
  api.post("/ccli/settings", requireUser, wrap(async (req, res) => {
    const s = await scopeOf(req.user); if (!s.mainAdmin) throw bad("Only a main admin can change the CCLI settings.", 403);
    const cur = await settingsFor(s.key), b = req.body || {};
    const next = { license: b.license !== undefined ? digits(b.license) : cur.license, streaming: b.streaming !== undefined ? digits(b.streaming) : cur.streaming, credit: b.credit !== undefined ? cleanCredit(Object.assign({}, cur.credit, b.credit)) : cur.credit };
    await q(`INSERT INTO ccli_settings (scope, data, updated_by) VALUES ($1,$2,$3) ON CONFLICT (scope) DO UPDATE SET data=EXCLUDED.data, updated_by=EXCLUDED.updated_by, updated_at=now()`, [s.key, JSON.stringify(next), req.user.email]);
    res.json(Object.assign(next, { canEdit: true, church: s.c ? s.c.name : null, partner: partner.status() }));
  }));
  api.post("/ccli/usage", requireUser, wrap(async (req, res) => {
    const s = await scopeOf(req.user), list = Array.isArray(req.body && req.body.entries) ? req.body.entries.slice(0, 200) : [];
    let saved = 0, skipped = 0;
    for (const e of list) {
      const title = text(e && e.title, 200), kind = String(e && e.kind || ""), day = validDay(e && e.day);
      if (!title || !KINDS.includes(kind) || !day) { skipped++; continue; }
      const ccli = String(e.ccli || "").replace(/[^0-9]/g, "").slice(0, 10) || null;
      const r = await one(`INSERT INTO ccli_usage (scope, song_key, title, ccli, authors, copyright, kind, day, first_at, device, by_email) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9::timestamptz, now()),$10,$11)
        ON CONFLICT (scope, song_key, kind, day) DO UPDATE SET authors = CASE WHEN ccli_usage.authors = '' THEN EXCLUDED.authors ELSE ccli_usage.authors END,
          copyright = CASE WHEN ccli_usage.copyright = '' THEN EXCLUDED.copyright ELSE ccli_usage.copyright END RETURNING (xmax = 0) AS fresh`,
      [s.key, songKey({ ccli, title }), title, ccli, text(e.authors, 300), text(e.copyright, 300), kind, day, e.at && !isNaN(Date.parse(e.at)) ? e.at : null, text(e.device, 80), req.user.email]);
      if (r && r.fresh) saved++;
    }
    res.json({ saved, already: list.length - saved - skipped, skipped });
  }));
  api.get("/ccli/report", requireUser, wrap(async (req, res) => {
    const s = await scopeOf(req.user); if (!s.admin) throw bad("The CCLI report is for the church's admins.", 403);
    const to = validDay(req.query.to) || new Date().toISOString().slice(0, 10);
    const from = validDay(req.query.from) || new Date(Date.parse(to) - 182 * 86400e3).toISOString().slice(0, 10);
    if (from > to) throw bad("The start of the report is after its end.");
    const r = await report(s.key, from, to), set = await settingsFor(s.key), info = { church: s.c ? s.c.name : req.user.name || req.user.email, license: set.license, streaming: set.streaming };
    if (req.query.format === "csv") { res.setHeader("Content-Type", "text/csv; charset=utf-8"); res.setHeader("Content-Disposition", 'attachment; filename="ccli-report-' + from + "-to-" + to + '.csv"'); return res.send(reportCsv(r, info)); }
    res.json(Object.assign(r, info, { partner: partner.status() }));
  }));
  api.get("/ccli/songselect/search", requireUser, wrap(async (req, res) => { res.json({ songs: await partner.search(req.query.q) }); }));
  api.post("/ccli/report/submit", requireUser, wrap(async (req, res) => {
    const s = await scopeOf(req.user); if (!s.mainAdmin) throw bad("Only a main admin sends the CCLI report.", 403);
    res.json(await partner.submitReport(req.body || {}));
  }));
}
