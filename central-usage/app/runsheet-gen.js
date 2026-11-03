/* Central Control (10.2) - makes a run sheet from a few answers: the date and time, how long the service runs, the
 * countdown before it, which parts and in what order (the worship set from the setlist, the sermon with its speaker
 * and length…), and who's on. Each part gets a length (a song: its tracks' length), a note, who leads it and the cues
 * it fires on every computer: the song, lyrics on or off, a lighting look, a slide, a camera, a stream scene, a lower
 * third. The flexible parts (welcome, announcements, prayer, offering, communion, closing) stretch or shrink so the
 * service fits the time asked; songs, the sermon, videos and readings keep their length.
 * Used by the Service tab (the "New run sheet" questions) and by test-service.mjs in Node. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CURunsheetGen = api;
})(typeof window !== "undefined" ? window : this, function () {
  "use strict";
  var ALL = ["lighting", "production", "slides", "lyrics", "mix", "inears", "band"];
  // what each kind of part is: its label, usual minutes, the roles it uses, whether it stretches to fit, the cues it fires
  var KINDS = {
    countdown: { label: "Countdown", minutes: 5, roles: ["lighting", "slides", "mix"], cues: { slide: "Countdown", lyrics: "off", look: "Walk-in" } },
    welcome: { label: "Welcome", minutes: 3, roles: ["lighting", "production", "slides", "mix"], flex: true, cues: { slide: "Welcome", lyrics: "off", look: "Stage wash", camera: "Wide" } },
    song: { label: "Song", minutes: 5, roles: ALL, cues: { lyrics: "on", camera: "Wide" } },
    announcements: { label: "Announcements", minutes: 5, roles: ["production", "slides", "mix"], flex: true, cues: { slide: "Announcements", lyrics: "off", look: "Stage wash", camera: "Pulpit" } },
    scripture: { label: "Scripture reading", minutes: 3, roles: ["production", "slides", "mix"], cues: { lyrics: "off", look: "Speaker", camera: "Pulpit" } },
    prayer: { label: "Prayer", minutes: 3, roles: ["lighting", "production", "mix"], flex: true, cues: { lyrics: "off", look: "Prayer", camera: "Pulpit" } },
    offering: { label: "Offering", minutes: 4, roles: ["lighting", "slides", "mix", "band"], flex: true, cues: { slide: "Offering", lyrics: "off", look: "Stage wash" } },
    video: { label: "Video", minutes: 3, roles: ["production", "slides", "mix"], cues: { lyrics: "off", look: "Video", scene: "Video" } },
    sermon: { label: "Sermon", minutes: 35, roles: ["production", "slides", "mix"], cues: { lyrics: "off", look: "Speaker", camera: "Pulpit", scene: "Sermon" } },
    communion: { label: "Communion", minutes: 8, roles: ["lighting", "slides", "mix", "band"], flex: true, cues: { slide: "Communion", lyrics: "off", look: "Prayer" } },
    baptism: { label: "Baptism", minutes: 10, roles: ["lighting", "production", "mix", "band"], cues: { lyrics: "off", look: "Baptism", camera: "Baptism" } },
    closing: { label: "Closing & benediction", minutes: 2, roles: ["lighting", "production", "slides", "mix"], flex: true, cues: { slide: "Thanks for coming", lyrics: "off", look: "Stage wash", camera: "Wide" } },
    other: { label: "Other", minutes: 5, roles: ["lighting", "production", "slides", "mix"], cues: {} }
  };
  // the parts the questions offer, in their usual order (worship and response become songs; custom becomes "other")
  var ELEMENTS = [
    { kind: "welcome", label: "Welcome" }, { kind: "worship", label: "Worship set" }, { kind: "announcements", label: "Announcements" },
    { kind: "scripture", label: "Scripture reading" }, { kind: "prayer", label: "Prayer" }, { kind: "offering", label: "Offering" },
    { kind: "video", label: "Video" }, { kind: "sermon", label: "Sermon" }, { kind: "communion", label: "Communion" },
    { kind: "baptism", label: "Baptism" }, { kind: "response", label: "Response song" }, { kind: "closing", label: "Closing & benediction" }
  ];
  var DEFAULT_ORDER = ["welcome", "worship", "announcements", "offering", "sermon", "response", "closing"];
  function uid(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function round(m, step) { step = step || 0.5; return Math.max(0, Math.round(m / step) * step); }
  function copy(o) { var out = {}; for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) out[k] = o[k]; return out; }
  function findSong(songs, ref) { if (!ref) return null; for (var i = 0; i < songs.length; i++) { var q = songs[i]; if (q.id === ref || q.name === ref) return q; } return null; }
  function item(kind, over) {
    var k = KINDS[kind] || KINDS.other, it = { id: uid("it"), title: k.label, kind: KINDS[kind] ? kind : "other", minutes: k.minutes, roles: k.roles.slice(), song: "", note: "", who: "", cues: copy(k.cues) };
    if (over) for (var key in over) if (over[key] != null && over[key] !== "") it[key] = over[key];
    return it;
  }
  function songItem(q, n, extra) {
    var mins = q && q.duration > 0 ? Math.round(q.duration / 60 * 100) / 100 : KINDS.song.minutes;
    var it = item("song", { title: q ? q.name : "Song " + n, minutes: mins, song: q ? (q.id || q.name) : "" });
    if (q) it.cues.song = q.id || q.name;
    if (q && !q.duration) it.note = "Length guessed: this song has no tracks yet.";
    if (extra) for (var key in extra) it[key] = extra[key];
    return it;
  }
  function dayOf(date) { var d = String(date || "").split("-").map(Number); return d.length === 3 ? new Date(d[0], d[1] - 1, d[2]).getDay() : null; }

  // a: { name, date, time, length, countdown, day?, setlist?, elements: [{kind, songs?, count?, title?, speaker?, minutes?}], team: {leader, speaker, tech} }
  function generate(a, songs) {
    a = a || {}; songs = songs || [];
    var team = a.team || {}, leader = String(team.leader || "").trim(), speaker = String(team.speaker || "").trim(), items = [];
    var cd = Math.max(0, Math.min(60, Number(a.countdown) || 0));
    if (cd) items.push(item("countdown", { minutes: cd, note: "Before the service starts" }));
    var songN = 0;
    (a.elements && a.elements.length ? a.elements : DEFAULT_ORDER.map(function (k) { return { kind: k }; })).forEach(function (el) {
      var kind = el.kind;
      if (kind === "worship" || kind === "response") {
        var refs = (el.songs || []).map(function (r) { return findSong(songs, r) || { name: String(r), id: "", duration: 0, missing: true }; });
        var n = refs.length || Math.max(1, Math.min(12, Number(el.count) || (kind === "worship" ? 4 : 1)));
        for (var i = 0; i < n; i++) {
          var q = refs[i] && !refs[i].missing ? refs[i] : null; songN++;
          var it = songItem(q, songN, { who: leader });
          if (!q && refs[i]) { it.title = refs[i].name; it.note = "Not in the setlist on the track player yet."; }
          if (kind === "response") it.note = (it.note ? it.note + " " : "") + "Response song";
          items.push(it);
        }
        return;
      }
      if (kind === "custom") { items.push(item("other", { title: String(el.title || "Item").slice(0, 60), minutes: Number(el.minutes) || KINDS.other.minutes, note: el.note || "" })); return; }
      if (!KINDS[kind]) return;
      var over = {};
      if (el.minutes != null && el.minutes !== "" && !isNaN(Number(el.minutes))) over.minutes = Math.max(0, Math.min(240, Number(el.minutes)));
      if (kind === "sermon") {
        var who = String(el.speaker || speaker || "").trim(), t = String(el.title || "").trim();
        over.title = t ? "Sermon: " + t : "Sermon"; over.who = who;
        var x = item("sermon", over); if (who || t) x.cues.lowerThird = [who, t].filter(Boolean).join(" · "); if (t) x.cues.slide = t;
        items.push(x); return;
      }
      if (kind === "scripture" && el.title) { over.title = "Scripture: " + String(el.title).slice(0, 48); var sc = item("scripture", over); sc.cues.slide = String(el.title).slice(0, 80); sc.cues.lowerThird = String(el.title).slice(0, 80); items.push(sc); return; }
      if (kind === "video" && el.title) { over.title = String(el.title).slice(0, 60); var vi = item("video", over); vi.cues.slide = over.title; items.push(vi); return; }
      if (kind === "welcome" || kind === "announcements" || kind === "prayer" || kind === "closing") over.who = speaker || leader;
      if (kind === "offering" || kind === "communion") over.who = speaker;
      items.push(item(kind, over));
    });
    var date = /^\d{4}-\d{2}-\d{2}$/.test(String(a.date || "")) ? String(a.date) : "", day = date ? dayOf(date) : Math.max(0, Math.min(6, Number(a.day) || 0));
    var sv = { id: uid("sv"), name: String(a.name || "").trim() || "Service", date: date, day: day, time: /^\d{1,2}:\d{2}$/.test(String(a.time || "")) ? String(a.time) : "09:00",
      length: Math.max(0, Math.min(600, Math.round(Number(a.length) || 0))), countdown: cd, team: { leader: leader, speaker: speaker, tech: (team.tech || []).map(function (s) { return String(s).trim(); }).filter(Boolean) },
      setlist: String(a.setlist || ""), notes: String(a.notes || ""), roles: ALL.slice(), record: !!a.record, items: items };
    stretch(sv);
    return sv;
  }
  // the flexible parts stretch (up to double) or shrink (down to half) so the service fits its length
  function stretch(sv) {
    if (!sv.length) return sv;
    var fixed = 0, flex = 0;
    sv.items.forEach(function (it) { if (it.kind === "countdown") return; if ((KINDS[it.kind] || {}).flex) flex += it.minutes; else fixed += it.minutes; });
    if (!flex) return sv;
    var ratio = Math.max(0.5, Math.min(2, (sv.length - fixed) / flex)), flexItems = sv.items.filter(function (it) { return (KINDS[it.kind] || {}).flex; });
    flexItems.forEach(function (it) { it.minutes = Math.max(1, round(it.minutes * ratio)); });
    // whatever rounding left over goes to the longest flexible part, within its limits
    var total = sv.items.reduce(function (t, it) { return it.kind === "countdown" ? t : t + it.minutes; }, 0), left = round(sv.length - total);
    if (left && ratio > 0.5 && ratio < 2) { var big = flexItems.slice().sort(function (x, y) { return y.minutes - x.minutes; })[0]; if (big) big.minutes = Math.max(1, round(big.minutes + left)); }
    return sv;
  }
  // how the run sheet fits its length: planned minutes (without the countdown), over (+) or under (-)
  function fit(sv) {
    var planned = (sv.items || []).reduce(function (t, it) { return it.kind === "countdown" ? t : t + (Number(it.minutes) || 0); }, 0);
    return { planned: Math.round(planned * 100) / 100, length: sv.length || 0, over: sv.length ? Math.round((planned - sv.length) * 100) / 100 : 0 };
  }
  function clock(mins) { mins = ((mins % 1440) + 1440) % 1440; var h = Math.floor(mins / 60), m = Math.floor(mins % 60); return h + ":" + (m < 10 ? "0" : "") + m; }
  // when each part starts: minutes from the service's start (the countdown before it is negative) and the clock time
  function times(sv) {
    var p = String(sv.time || "09:00").split(":").map(Number), start = p[0] * 60 + p[1], pre = 0, out = [], t;
    var i = 0; while (i < sv.items.length && sv.items[i].kind === "countdown") { pre += Number(sv.items[i].minutes) || 0; i++; }
    t = -pre;
    sv.items.forEach(function (it) { out.push({ offset: t, clock: (function (c) { var s = clock(start + c); return s.length === 4 ? "0" + s : s; })(t) }); t += Number(it.minutes) || 0; });
    return out;
  }
  function esc(x) { return String(x == null ? "" : x).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var CUE_NAMES = { song: "Song", lyrics: "Lyrics", look: "Lights", slide: "Slide", camera: "Camera", scene: "Stream", lowerThird: "Lower third" };
  function whenText(sv) {
    if (sv.date) { var d = sv.date.split("-").map(Number); try { return new Date(d[0], d[1] - 1, d[2]).toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" }) + " · " + sv.time; } catch (_) { return sv.date + " · " + sv.time; } }
    return "Every " + DAYS[sv.day || 0] + " · " + sv.time;
  }
  // the run sheet as a page to print or read on a phone (light, for paper)
  function sheetHtml(sv, opts) {
    opts = opts || {}; var songs = opts.songs || [], t = times(sv), f = fit(sv), team = sv.team || {};
    var songName = function (ref) { for (var i = 0; i < songs.length; i++) if (songs[i].id === ref || songs[i].name === ref) return songs[i].name; return ref; };
    var rows = (sv.items || []).map(function (it, i) {
      var cues = it.cues || {}, cl = Object.keys(CUE_NAMES).filter(function (k) { return cues[k]; }).map(function (k) { return "<span><b>" + CUE_NAMES[k] + "</b> " + esc(k === "song" ? songName(cues[k]) : cues[k]) + "</span>"; }).join(" ");
      return '<tr class="' + (it.kind === "song" ? "song" : it.kind === "countdown" ? "pre" : "") + (opts.live === i ? " live" : "") + '"><td class="t">' + esc(t[i] ? t[i].clock : "") + '</td><td><div class="ti">' + esc(it.title) + "</div>" + (it.note ? '<div class="no">' + esc(it.note) + "</div>" : "") + (cl ? '<div class="cu">' + cl + "</div>" : "") + "</td><td>" + esc(it.who || "") + '</td><td class="m">' + (Math.round((Number(it.minutes) || 0) * 10) / 10) + "</td></tr>";
    }).join("");
    var who = [team.leader ? "Worship: " + esc(team.leader) : "", team.speaker ? "Speaker: " + esc(team.speaker) : "", team.tech && team.tech.length ? "Tech: " + esc(team.tech.join(", ")) : ""].filter(Boolean).join(" · ");
    return '<section class="rs"><header><h1>' + esc(sv.name) + "</h1><p>" + esc(whenText(sv)) + (sv.length ? " · runs " + sv.length + " min" : "") + " · planned " + Math.round(f.planned) + " min" + (sv.length && Math.abs(f.over) >= 1 ? " (" + Math.abs(Math.round(f.over)) + (f.over > 0 ? " over)" : " under)") : "") + "</p>" + (who ? "<p>" + who + "</p>" : "") + (sv.notes ? '<p class="no">' + esc(sv.notes) + "</p>" : "") + "</header>" +
      "<table><thead><tr><th>Starts</th><th>Item</th><th>Who</th><th>Min</th></tr></thead><tbody>" + rows + "</tbody></table></section>";
  }
  var PRINT_CSS = "body{font:13px/1.4 Inter,system-ui,sans-serif;color:#111;margin:24px}h1{font-size:22px;margin:0 0 4px}header p{margin:2px 0;color:#444}table{width:100%;border-collapse:collapse;margin-top:14px}th{text-align:left;font-size:11px;color:#666;border-bottom:2px solid #222;padding:4px}" +
    "td{padding:6px 4px;border-bottom:1px solid #ddd;vertical-align:top}td.t{font-weight:700;width:56px;font-variant-numeric:tabular-nums}td.m{text-align:right;width:40px}.ti{font-weight:650}.no{color:#555;font-style:italic}.cu{margin-top:3px;font-size:11px;color:#333}.cu span{margin-right:10px}.cu b{color:#777;font-weight:600}" +
    "tr.song .ti{padding-left:0}tr.pre td{color:#777}tr.live td{background:#fff4d6}.rs{page-break-after:always}.rs:last-child{page-break-after:auto}@media print{body{margin:10mm}}";
  function printHtml(sv, opts) { return '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(sv.name) + "</title><style>" + PRINT_CSS + "</style></head><body>" + sheetHtml(sv, opts) + "</body></html>"; }
  return { KINDS: KINDS, sheetHtml: sheetHtml, printHtml: printHtml, PRINT_CSS: PRINT_CSS, whenText: whenText, ELEMENTS: ELEMENTS, DEFAULT_ORDER: DEFAULT_ORDER, ALL: ALL, generate: generate, stretch: stretch, fit: fit, times: times, item: item, clock: clock, dayOf: dayOf };
});
