/* Central Pedal - saved setups: everything personal to this device, saved under a name ("Sunday",
 * "Youth night", "Acoustic set") and brought back with one tap - what every button / knob / slider does,
 * the performance knobs (volume, tone, reverb, fade), the instrument (boards, pedals, keys sounds, input /
 * output), the textures, the colours and the projector look.
 * A song can have its own setup: picking the song brings its setup back (songs without one keep what is up,
 * or go back to a chosen setup).
 * Setups stay on this device. Songs, tracks, charts and setlists are what travel between Central Pedals;
 * a setup never does (it is saved in this device's project, which sync does not carry). */
(function () {
  "use strict";
  var PP = window.PP, F = window.PPFeatures; if (!PP || !F) return;
  var esc = PP.escapeHtml;
  function $(s) { return document.querySelector(s); }
  function project() { return PP.project(); }
  var PARTS = ["mapping", "performance", "instrument", "textures", "theme", "projector"];
  var PART_NAMES = { mapping: "buttons, knobs & sliders", performance: "volume / tone / reverb / fade", instrument: "instrument (boards, pedals, keys)", textures: "textures", theme: "colours", projector: "projector look" };

  function list() { var p = project(); if (!Array.isArray(p.setups)) p.setups = []; return p.setups; }
  function songMap() { var p = project(); if (!p.songSetups || typeof p.songSetups !== "object") p.songSetups = {}; return p.songSetups; }
  function byId(id) { return list().filter(function (s) { return s.id === id; })[0] || null; }
  function byName(name) { var n = String(name || "").trim().toLowerCase(); return list().filter(function (s) { return s.name.toLowerCase() === n; })[0] || null; }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function capture() { var p = project(), d = {}; PARTS.forEach(function (k) { if (p[k] != null) d[k] = clone(p[k]); }); return d; }

  function save(name, opts) {
    opts = opts || {}; name = String(name || "").trim(); if (!name) return null;
    var s = byName(name);
    if (!s) { s = { id: "su_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: name }; list().push(s); }
    s.data = capture(); s.at = Date.now();
    project().setupCurrent = s.id;
    if (opts.song) songMap()[opts.song] = s.id;
    PP.persistSoon(); render(); PP.setStatus("Setup \"" + s.name + "\" saved");
    return s;
  }
  function apply(id, opts) {
    var s = byId(id); if (!s || !s.data) return false;
    opts = opts || {};
    var p = project(), d = clone(s.data);
    if (d.mapping) p.mapping = d.mapping;
    if (d.performance) Object.keys(d.performance).forEach(function (k) { var v = d.performance[k]; if (typeof v === "number" && typeof p.performance[k] === "number") PP.setPerformance(k, v); else if (k !== "morph") p.performance[k] = v; });
    if (d.instrument) p.instrument = d.instrument;
    if (Array.isArray(d.textures)) {
      // the texture choices and levels come back; what is sounding right now keeps sounding (or stays off)
      var now = Array.isArray(p.textures) ? p.textures : [];
      p.textures = d.textures.map(function (c, i) { return Object.assign({}, c, { enabled: now[i] ? !!now[i].enabled : false }); });
    }
    if (d.theme) p.theme = Object.assign(p.theme || {}, d.theme);
    if (d.projector) p.projector = d.projector;
    p.setupCurrent = s.id;
    PP.applyTheme();
    if (window.PPInstrument) { window.PPInstrument.apply("setup"); if (window.PPShell && window.PPShell.currentTab() === "instrument") window.PPInstrument.render(); }
    if (window.PPTextures) { window.PPTextures.apply(); window.PPTextures.render && window.PPTextures.render(); }
    if (window.PPTouchSelect) window.PPTouchSelect.release();
    if (window.PPActions) window.PPActions.modeChanged();
    if (window.PPTracks) window.PPTracks.sendDisplay();
    PP.renderPerform && PP.renderPerform();
    PP.persistSoon(); render();
    if (!opts.quiet) PP.setStatus("Setup \"" + s.name + "\" is up");
    return true;
  }
  function remove(id) {
    var s = byId(id); if (!s) return;
    project().setups = list().filter(function (x) { return x.id !== id; });
    var m = songMap(); Object.keys(m).forEach(function (k) { if (m[k] === id) delete m[k]; });
    if (project().setupDefault === id) project().setupDefault = "";
    if (project().setupCurrent === id) project().setupCurrent = "";
    PP.persistSoon(); render();
  }
  function rename(id, name) { var s = byId(id); name = String(name || "").trim(); if (!s || !name) return; s.name = name; PP.persistSoon(); render(); }
  function setForSong(songId, id) { var m = songMap(); if (id) m[songId] = id; else delete m[songId]; PP.persistSoon(); render(); }
  function forSongId(songId) { var id = songMap()[songId]; return id && byId(id) ? id : ""; }

  // a song was picked (features.js loadSong)
  function onSong(song) {
    if (!song) return;
    var id = forSongId(song.id) || project().setupDefault || "";
    if (id && id !== project().setupCurrent) apply(id, { quiet: true });
    else if (id) render();
  }

  // ------------------------------------------------------------- screens: Settings → Saved setups, and the bar on Configure
  function options(sel, none) { return '<option value="">' + esc(none) + "</option>" + list().map(function (s) { return '<option value="' + esc(s.id) + '"' + (s.id === sel ? " selected" : "") + ">" + esc(s.name) + "</option>"; }).join(""); }
  function currentSong() { var p = project(); return p.songs && p.songIndex >= 0 ? p.songs[p.songIndex] : null; }
  function bar() {
    var song = currentSong(), cur = byId(project().setupCurrent);
    return '<div class="su-bar"><label>Setup<select data-su="pick">' + options(cur ? cur.id : "", "— choose a saved setup —") + '</select></label>' +
      '<button data-su="save"' + (cur ? "" : " disabled") + ' title="Save what is set up now into this setup">Save</button><button data-su="saveas">Save as new…</button>' +
      (song ? '<label>"' + esc(song.name) + '" uses<select data-su="song" data-song="' + esc(song.id) + '">' + options(forSongId(song.id), "no setup of its own") + "</select></label>" : "") + "</div>";
  }
  function section() {
    var p = project(), songs = p.songs || [], rows = list();
    return '<h3>Saved setups</h3><p class="muted">Save everything personal to this Central Pedal under a name and bring it back with one tap: what every button, knob and slider does, the volume / tone / reverb / fade knobs, the instrument (boards, pedals, keys sounds), textures, colours and the projector look. Setups stay on this device - songs, tracks and setlists are what go to your other devices.</p>' +
      bar() +
      (rows.length ? '<table class="su-table"><tr><th>Setup</th><th>Saved</th><th>Songs using it</th><th></th></tr>' + rows.map(function (s) {
        var users = songs.filter(function (q) { return songMap()[q.id] === s.id; }).map(function (q) { return esc(q.name); });
        return '<tr data-su-row="' + esc(s.id) + '"' + (s.id === p.setupCurrent ? ' class="on"' : "") + '><td><input data-su="name" value="' + esc(s.name) + '"></td><td class="muted small">' + (s.at ? new Date(s.at).toLocaleString() : "") + '</td><td class="small">' + (users.join(", ") || '<span class="muted">—</span>') + '</td><td class="se-row"><button data-su="apply">Use now</button><button data-su="update">Save over</button><button data-su="del" class="danger">✕</button></td></tr>';
      }).join("") + "</table>" : '<p class="muted">No setups saved yet. Set things up the way you like, then "Save as new…".</p>') +
      '<label>Songs with no setup of their own<select data-su="default">' + options(p.setupDefault || "", "keep what is up") + "</select></label>" +
      (songs.length ? '<details class="su-songs"><summary>Setup for each song in "' + esc(p.name || "this setlist") + '"</summary><table class="su-table">' + songs.map(function (q) { return '<tr><td>' + esc(q.name) + '</td><td><select data-su="song" data-song="' + esc(q.id) + '">' + options(forSongId(q.id), "no setup of its own") + "</select></td></tr>"; }).join("") + "</table></details>" : "") +
      '<p class="muted small">A setup holds: ' + PARTS.map(function (k) { return PART_NAMES[k]; }).join(" · ") + ". Pads stay with the songs (each song's own pads), and the scenes of a song still work on top.</p>";
  }
  function render() {
    var sec = $("#setupsSection"); if (sec) sec.innerHTML = section();
    var cf = $("#cfSetup"); if (cf) cf.innerHTML = bar();
  }
  async function onClick(e) {
    var b = e.target.closest("[data-su]"); if (!b || b.tagName !== "BUTTON") return;
    var row = b.closest("[data-su-row]"), id = row ? row.dataset.suRow : project().setupCurrent, k = b.dataset.su;
    if (k === "saveas") { var song = currentSong(), name = await PP.ask("Name for this setup", song ? song.name : "Sunday"); if (name) save(name); }
    else if (k === "save") { var cur = byId(project().setupCurrent); if (cur) save(cur.name); }
    else if (k === "apply") apply(id);
    else if (k === "update") { var s = byId(id); if (s && confirm("Save what is set up now over \"" + s.name + "\"?")) save(s.name); }
    else if (k === "del") { var s2 = byId(id); if (s2 && confirm("Delete the setup \"" + s2.name + "\"?")) remove(id); }
  }
  function onChange(e) {
    var k = e.target.dataset && e.target.dataset.su; if (!k) return;
    if (k === "pick") { if (e.target.value) apply(e.target.value); }
    else if (k === "song") setForSong(e.target.dataset.song, e.target.value);
    else if (k === "default") { project().setupDefault = e.target.value; PP.persistSoon(); }
    else if (k === "name") { var row = e.target.closest("[data-su-row]"); if (row) rename(row.dataset.suRow, e.target.value); }
  }
  document.addEventListener("click", function (e) { if (e.target.closest("#setupsSection, #cfSetup")) onClick(e); });
  document.addEventListener("change", function (e) { if (e.target.closest("#setupsSection, #cfSetup")) onChange(e); });
  render();
  window.PPSetups = { list: list, save: save, apply: apply, remove: remove, rename: rename, setForSong: setForSong, forSong: forSongId, onSong: onSong, capture: capture, render: render, PARTS: PARTS };
})();
