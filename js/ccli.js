/* Central Pedal / Central Pedal Control / Central Control - CCLI (10.2).
 *
 *   The copyright line  CCLI asks for the song's title, writers, copyright, CCLI song number and the church's CCLI
 *                       licence number on the lyric slides (the first or the last slide of each song). The church's
 *                       numbers and how the line looks are kept on the church account (website → Account → CCLI, or
 *                       Settings → Songs & CCLI here); creditLine() builds it and the lyric screens show it.
 *   Usage               every time a song's words are shown on a screen, it's streamed, recorded or its lyrics printed,
 *                       log(song, kind) notes it (once per song, kind and day) and sends it to the church account, which
 *                       makes the CCLI report (Church Copyright Licence: display, print, record, translate; Streaming
 *                       Licence: stream). Offline, the notes wait on this device and go when it's back online.
 *   Settings card       the licence numbers, the copyright line, and the report (with the file to send CCLI).
 *
 * The core (songKey, creditLine, dayOf) has no app dependencies, so the tests and the website can use it. */
(function (root) {
  "use strict";
  var KINDS = { display: "Shown on a screen", print: "Lyrics printed", record: "Recorded", stream: "Streamed", translate: "Translated" };
  var DEFAULT_TEMPLATE = "{title} · {authors} · © {copyright} · CCLI Song # {ccli} · CCLI License # {license}";

  // ------------------------------------------------------------------ the core
  function normTitle(t) { return String(t || "").toLowerCase().replace(/\([^)]*\)/g, " ").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").replace(/^(the|a|an) /, "").trim(); }
  function ccliOf(song) { var v = song && (song.ccli || (song.pco && song.pco.ccli)); v = v == null ? "" : String(v).replace(/[^0-9]/g, ""); return v || null; }
  function songKey(song) { var c = ccliOf(song); return c ? "ccli:" + c : "t:" + normTitle(song && (song.title || song.name)); }
  function authorsText(song) { var a = song && (song.authors || song.author || (song.pco && song.pco.author)); return Array.isArray(a) ? a.filter(Boolean).join(", ") : String(a || "").trim(); }
  function dayOf(d) { d = d ? new Date(d) : new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  // the copyright line for a song: null when it's off, or not on this slide ("first": the song's first slide, "last":
  // its last, "every": all of them). A part of the line whose fields are all empty is left out (no "©" with nothing
  // after it); the licence number only goes with a song that has a CCLI number (public-domain hymns don't need it).
  function creditLine(song, settings, where) {
    var s = settings || {}, c = s.credit || {};
    if (!song || c.on === false) return null;
    var at = c.where || "first";
    if (where && at !== "every" && !(at === "first" ? where.first : where.last)) return null;
    var num = ccliOf(song), fields = {
      title: String(song.title || song.name || "").trim(), authors: authorsText(song), copyright: String(song.copyright || "").replace(/^\s*(©|\(c\)|copyright)\s*/i, "").trim(),
      ccli: num || "", license: num ? String(s.license || "").trim() : "", streaming: num ? String(s.streaming || "").trim() : ""
    };
    if (!fields.title) return null;
    if (!num && !fields.copyright && !fields.authors) return fields.title;
    var tpl = String(c.template || DEFAULT_TEMPLATE);
    var out = tpl.split(/(\s*·\s*|\s*\|\s*|\n)/).map(function (seg) {
      if (/^(\s*·\s*|\s*\|\s*|\n)$/.test(seg)) return seg;
      var toks = seg.match(/\{(\w+)\}/g) || [];
      if (toks.length && toks.every(function (t) { return !fields[t.slice(1, -1)]; })) return null;
      return seg.replace(/\{(\w+)\}/g, function (_, k) { return fields[k] == null ? "" : fields[k]; });
    });
    // drop the separators left next to a dropped part
    var parts = [], sep = null;
    out.forEach(function (x) { if (x === null) { sep = null; return; } if (/^(\s*·\s*|\s*\|\s*|\n)$/.test(x)) { if (parts.length) sep = x; return; } if (sep && parts.length) parts.push(sep); sep = null; parts.push(x); });
    return parts.join("").replace(/©\s*(public domain)/ig, "$1").replace(/\s+$/, "") || null;
  }
  var CORE = { songKey: songKey, normTitle: normTitle, ccliOf: ccliOf, creditLine: creditLine, dayOf: dayOf, KINDS: KINDS, DEFAULT_TEMPLATE: DEFAULT_TEMPLATE };
  if (typeof module === "object" && module.exports) module.exports = CORE;
  if (!root || !root.document) return;

  // ------------------------------------------------------------------ the app side
  var LS_SET = "pp-ccli-settings", LS_Q = "pp-ccli-queue", LS_SENT = "pp-ccli-sent";
  var st = { settings: null, canEdit: false, partner: null, church: null, msg: "", err: "", report: null, from: null, to: null, busy: false, loadedAt: 0, own: { displays: {}, connected: [] } };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function load(k, d) { try { var v = JSON.parse(localStorage.getItem(k) || "null"); return v == null ? d : v; } catch (_) { return d; } }
  function keep(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { } }
  st.settings = load(LS_SET, null) || { license: "", streaming: "", credit: { on: true, where: "first", template: DEFAULT_TEMPLATE } };

  // the church account: the license key's sign-in (all four apps), or Central Tracks' sign-in (Central Pedal Control)
  function account() {
    var L = root.PPLicense, s = L && L.state && L.state(), tok = s && s.account && s.account.token, base = L && L.server && L.server();
    if (base && tok) return { base: String(base).replace(/\/+$/, ""), tok: tok };
    var CT = root.PPCentralTracks; if (CT && CT.api && CT.signedIn && CT.signedIn()) return { ct: CT };
    return null;
  }
  async function api(method, path, body) {
    var a = account(); if (!a) { var e0 = new Error("Sign in to your church account first (Settings → License)."); e0.status = 401; throw e0; }
    if (a.ct) return a.ct.api(method, path, body);
    var r = await fetch(a.base + "/v1" + path, { method: method, headers: { "Content-Type": "application/json", Authorization: "Bearer " + a.tok }, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
    var j = {}; try { j = await r.json(); } catch (_) { }
    if (!r.ok || j.error) { var e = new Error(j.error || ("The website answered " + r.status)); e.status = r.status; throw e; }
    return j;
  }
  async function refreshSettings() {
    try { var j = await api("GET", "/ccli/settings"); st.settings = { license: j.license || "", streaming: j.streaming || "", credit: j.credit || st.settings.credit }; st.canEdit = !!j.canEdit; st.partner = j.partner || null; st.church = j.church || null; st.loadedAt = Date.now(); keep(LS_SET, st.settings); st.err = ""; }
    catch (e) { if (e.status !== 401) st.err = e.message; }
    redraw();
  }
  function settings() { return st.settings; }
  function credit(song, where) { return creditLine(song, st.settings, where); }

  // ---- usage: once per song, kind and day on this device (the website keeps one per church too)
  function log(song, kind, opts) {
    if (!song || !KINDS[kind]) return false;
    var title = String(song.title || song.name || "").trim(); if (!title) return false;
    var day = dayOf(opts && opts.at), key = songKey(song) + "|" + kind + "|" + day, sent = load(LS_SENT, []);
    if (sent.indexOf(key) >= 0) return false;
    var q = load(LS_Q, []); if (q.some(function (x) { return x.key === key; })) return false;
    q.push({ key: key, title: title, ccli: ccliOf(song), authors: authorsText(song), copyright: String(song.copyright || ""), kind: kind, day: day, at: new Date().toISOString(), device: (opts && opts.device) || deviceName() });
    keep(LS_Q, q.slice(-500)); setTimeout(flush, 1500); return true;
  }
  function deviceName() { var L = root.PPLicense, s = L && L.state && L.state(); return (s && s.deviceName) || (root.CentralUsage && root.CentralUsage.appName) || "Central Pedal"; }
  var flushing = false;
  async function flush() {
    var q = load(LS_Q, []); if (!q.length || flushing || !account()) return;
    flushing = true;
    try {
      var batch = q.slice(0, 200), j = await api("POST", "/ccli/usage", { entries: batch.map(function (x) { return { title: x.title, ccli: x.ccli, authors: x.authors, copyright: x.copyright, kind: x.kind, day: x.day, at: x.at, device: x.device }; }) });
      var done = batch.map(function (x) { return x.key; }), sent = load(LS_SENT, []).concat(done).slice(-600);
      keep(LS_SENT, sent); keep(LS_Q, load(LS_Q, []).filter(function (x) { return done.indexOf(x.key) < 0; }));
      st.lastSent = { n: j.saved != null ? j.saved : batch.length, at: Date.now() };
    } catch (_) { /* stays queued: sent next time */ }
    flushing = false; redraw();
  }
  setInterval(flush, 60000);

  // ---- the Central Pedal's own screens: the words count as shown when one of its HDMI ports shows the lyrics (or
  // Central Control's slides) with a monitor plugged in, and the projector isn't blanked
  var F = root.PPFeatures;
  if (F && F.on) F.on("systemStatus", function (m) { st.own = { displays: m.displays || {}, connected: m.connectedDisplays || [] }; });
  function ownLyricScreen() {
    var d = st.own.displays || {}, conn = st.own.connected || [];
    return [1, 2].some(function (n) { var what = d["hdmi" + n] || (n === 2 ? "lyrics" : "app"); if (what !== "lyrics" && what !== "slides") return false; return conn.some(function (c) { return c.connected && new RegExp("HDMI-A-" + n + "$").test(c.name); }); });
  }
  // (tracks.js calls this with each display message)
  function onDisplay(msg) {
    if (!msg || !msg.song || !msg.lyrics || !(msg.lyrics.lines || []).length) return;
    if (msg.projector && msg.projector.blank) return;
    if (!ownLyricScreen()) return;
    log(msg.song, "display");
  }

  // ------------------------------------------------------------------ the settings card
  function monthsAgo(n) { var d = new Date(); d.setMonth(d.getMonth() - n); return dayOf(d); }
  function reportHtml() {
    var r = st.report; if (!r) return "";
    if (!r.songs.length) return '<p class="muted small">Nothing was logged from ' + esc(r.from) + " to " + esc(r.to) + ".</p>";
    return '<div class="ccli-report"><table class="io-t"><tr><th>Song</th><th>CCLI #</th><th>Shown</th><th>Printed</th><th>Recorded</th><th>Streamed</th></tr>' +
      r.songs.map(function (s) { return "<tr><td>" + esc(s.title) + (s.authors ? '<br><span class="muted small">' + esc(s.authors) + "</span>" : "") + "</td><td>" + (s.ccli ? esc(s.ccli) : '<span class="muted small">none</span>') + "</td><td>" + (s.display || "") + "</td><td>" + (s.print || "") + "</td><td>" + (s.record || "") + "</td><td>" + (s.stream || "") + "</td></tr>"; }).join("") +
      "</table>" + (r.missingCcli ? '<p class="muted small">' + r.missingCcli + " song" + (r.missingCcli === 1 ? " has" : "s have") + " no CCLI number: public-domain songs don't need one; for the others, add it in the song editor.</p>" : "") + "</div>";
  }
  function settingsHtml(cls) {
    if (!st.loadedAt && account()) setTimeout(refreshSettings, 0);
    var s = st.settings || {}, c = s.credit || {}, signed = !!account(), ed = st.canEdit, q = load(LS_Q, []).length;
    var nums = ed ? '<div class="row"><label>CCLI licence number<input data-ccli-set="license" inputmode="numeric" maxlength="12" value="' + esc(s.license || "") + '" placeholder="e.g. 1234567"></label><label>Streaming licence number<input data-ccli-set="streaming" inputmode="numeric" maxlength="12" value="' + esc(s.streaming || "") + '" placeholder="if you stream"></label></div>'
      : '<p class="small">Licence: <b>' + esc(s.license || "not set") + "</b>" + (s.streaming ? " · Streaming: <b>" + esc(s.streaming) + "</b>" : "") + (signed ? ' <span class="muted">(the main admin sets these)</span>' : "") + "</p>";
    var sample = creditLine({ title: "Amazing Grace (My Chains Are Gone)", authors: ["Chris Tomlin", "John Newton", "Louie Giglio"], copyright: "2006 sixsteps Music", ccli: "4768151" }, s);
    var look = '<label class="toggle"><input type="checkbox" data-ccli-set="on"' + (c.on !== false ? " checked" : "") + (ed ? "" : " disabled") + '> Show the copyright line on the lyric screens</label>' +
      '<div class="row"><label>On<select data-ccli-set="where"' + (ed ? "" : " disabled") + '>' + [["first", "each song's first slide"], ["last", "each song's last slide"], ["every", "every slide"]].map(function (o) { return '<option value="' + o[0] + '"' + ((c.where || "first") === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select></label></div>" +
      (ed ? '<label>How it reads<input data-ccli-set="template" value="' + esc(c.template || DEFAULT_TEMPLATE) + '"></label><p class="muted small">Use {title}, {authors}, {copyright}, {ccli}, {license} and {streaming}. A part with nothing to show is left out.</p>' : "") +
      (sample ? '<p class="small ccli-sample">' + esc(sample) + "</p>" : "");
    var rep = signed ? '<div class="row"><label>From<input type="date" data-ccli-from value="' + esc(st.from || monthsAgo(6)) + '"></label><label>To<input type="date" data-ccli-to value="' + esc(st.to || dayOf()) + '"></label><button data-ccli="report"' + (st.busy ? " disabled" : "") + '>Show the report</button><button data-ccli="csv"' + (st.busy ? " disabled" : "") + ">Download the file for CCLI</button></div>" + reportHtml()
      : '<p class="muted small">Sign in to your church account (Settings → License) to keep the report. Songs are noted on this device until then.</p>';
    var partner = st.partner && !st.partner.enabled ? '<p class="muted small">' + esc(st.partner.why || "Searching SongSelect and sending the report straight to CCLI are waiting for CCLI partner approval.") + "</p>" : "";
    return '<section class="' + (cls || "") + '" data-st="ccli" id="ccliSettings"><h3>CCLI</h3><p class="muted">Songs shown on the screens, streamed, recorded or printed are noted for your CCLI report. To bring in a song from SongSelect, open the song editor → Upload a PDF / text chart, and pick the .txt, .usr or ChordPro file.</p>' +
      nums + look + "<h4>Report</h4>" + rep + partner +
      (q ? '<p class="muted small">' + q + " song" + (q === 1 ? "" : "s") + " waiting to be sent from this device.</p>" : "") +
      (st.err ? '<p class="small bad">' + esc(st.err) + "</p>" : "") + (st.msg ? '<p class="small">' + esc(st.msg) + "</p>" : "") + "</section>";
  }
  function redraw() { var el = document.getElementById("ccliSettings"); if (!el) return; var f = document.activeElement; if (f && el.contains(f) && f.tagName === "INPUT" && f.type !== "checkbox") return; el.outerHTML = settingsHtml(el.className); }
  var saveT = 0;
  function saveSettings() {
    clearTimeout(saveT);
    saveT = setTimeout(async function () {
      try { var j = await api("POST", "/ccli/settings", { license: st.settings.license, streaming: st.settings.streaming, credit: st.settings.credit }); st.settings = { license: j.license || "", streaming: j.streaming || "", credit: j.credit || st.settings.credit }; keep(LS_SET, st.settings); st.msg = "Saved."; st.err = ""; }
      catch (e) { st.err = e.message; }
      redraw(); setTimeout(function () { st.msg = ""; redraw(); }, 2500);
    }, 600);
  }
  async function showReport(csv) {
    st.busy = true; st.err = ""; redraw();
    var from = st.from || monthsAgo(6), to = st.to || dayOf();
    try {
      if (csv) {
        var a = account(), url = "/ccli/report?format=csv&from=" + from + "&to=" + to, text;
        if (a && a.base) { var r = await fetch(a.base + "/v1" + url, { headers: { Authorization: "Bearer " + a.tok }, cache: "no-store" }); if (!r.ok) throw new Error("The website answered " + r.status); text = await r.text(); }
        else { var j0 = await api("GET", "/ccli/report?from=" + from + "&to=" + to); text = j0.csv || ""; }
        var blob = new Blob([text], { type: "text/csv" }), link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "ccli-report-" + from + "-to-" + to + ".csv"; document.body.appendChild(link); link.click(); setTimeout(function () { URL.revokeObjectURL(link.href); link.remove(); }, 1000);
        st.msg = "Saved the file. Enter the songs and counts on CCLI's reporting page.";
      } else st.report = await api("GET", "/ccli/report?from=" + from + "&to=" + to);
    } catch (e) { st.err = e.message; }
    st.busy = false; redraw();
  }
  document.addEventListener("change", function (e) {
    var t = e.target; if (!t || !t.closest || !t.closest("#ccliSettings")) return;
    if (t.hasAttribute("data-ccli-from")) { st.from = t.value; return; }
    if (t.hasAttribute("data-ccli-to")) { st.to = t.value; return; }
    var k = t.dataset.ccliSet; if (!k) return;
    var s = st.settings, c = s.credit || (s.credit = {});
    if (k === "license" || k === "streaming") s[k] = t.value.replace(/[^0-9]/g, "").slice(0, 12);
    else if (k === "on") c.on = t.checked; else if (k === "where") c.where = t.value; else if (k === "template") c.template = t.value.slice(0, 300) || DEFAULT_TEMPLATE;
    keep(LS_SET, s); saveSettings(); redraw();
  });
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-ccli]"); if (!b) return;
    if (b.dataset.ccli === "report") showReport(false); else if (b.dataset.ccli === "csv") showReport(true);
  });
  setTimeout(function () { if (account()) refreshSettings(); flush(); }, 6000);
  root.PPCcli = Object.assign({}, CORE, { api: api, account: account, settings: settings, refreshSettings: refreshSettings, credit: credit, log: log, flush: flush, onDisplay: onDisplay, settingsHtml: settingsHtml, queue: function () { return load(LS_Q, []); }, state: function () { return st; } });
})(typeof window !== "undefined" ? window : null);
