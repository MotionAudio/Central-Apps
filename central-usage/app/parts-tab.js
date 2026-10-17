/* Central Control - the Chord chart tab can show any instrument's part instead of the chart:
 * guitar (chart with capo + chord diagrams, tab), bass, keys (both hands), vocals (melody + words),
 * horns in their own key, strings, drums. Made by PPParts from what the Central Pedal knows about
 * the song (its chords, sections, the tracks written down) - follows the song the Pi is on. */
(function () {
  "use strict";
  var CU = window.CentralUsage, P = window.PPParts; if (!CU || !P) return;
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var part = CU.store.get("part", "chart"), view = CU.store.get("partView", ""), cache = {}, loading = null, shown = "";
  var bar = $("#view-chart .bar"), chart = $("#chart"); if (!bar || !chart) return;
  // the picker, next to the instrument (transposition) picker
  var groups = {}; P.INSTRUMENTS.forEach(function (i) { if (i.id !== "chords" && i.id !== "nashville") (groups[i.group] = groups[i.group] || []).push(i); });
  var label = document.createElement("label"); label.id = "partWrap"; label.className = "part-pick";
  label.innerHTML = 'Part <select id="partPick"><option value="chart">Chord chart</option>' + Object.keys(groups).map(function (g) { return '<optgroup label="' + esc(g) + '">' + groups[g].map(function (i) { return '<option value="' + i.id + '">' + esc(i.name) + "</option>"; }).join("") + "</optgroup>"; }).join("") + '</select><span id="partViews" class="part-views"></span>';
  bar.insertBefore(label, bar.firstChild.nextSibling);
  var box = document.createElement("div"); box.id = "partView"; box.className = "part-view"; box.hidden = true; chart.parentNode.insertBefore(box, chart.nextSibling);
  $("#partPick").value = part;

  function song() { var d = CU.state.display; if (!d || !d.song) return null; var songs = d.songs || []; var s = songs[d.song.index] || {}; return { id: s.id || d.song.id, name: s.name || d.song.name }; }
  async function music(s) {
    if (!s) return null;
    var key = s.id || s.name; if (cache[key]) return cache[key];
    try {
      // only songs the Central Pedal has shared (asking for any other one is a 404)
      var list = await (await fetch(CU.api("/hub"), { cache: "no-store" })).json(), hit = (list.songs || []).filter(function (q) { return s.id ? q.id === s.id : q.name === s.name; })[0], id = hit && hit.id;
      if (!id) return null;
      var j = await (await fetch(CU.api("/hub/" + encodeURIComponent(id)), { cache: "no-store" })).json();
      cache[key] = j && j.music ? j.music : null;
      if (cache[key] && !cache[key].chartText && window.CentralUsageChartText) cache[key].chartText = window.CentralUsageChartText();
      return cache[key];
    } catch (_) { return null; }
  }
  async function paint(force) {
    var on = part !== "chart"; box.hidden = !on; chart.hidden = on; $("#partViews").innerHTML = "";
    var shapes = $("#shapesWrap"), inst = $("#instrument"); if (inst) inst.closest("label").hidden = on; if (shapes && on) shapes.hidden = true;
    if (!on) { shown = ""; return; }
    var s = song(); if (!s) { box.innerHTML = '<div class="empty">No song on the Central Pedal yet.</div>'; return; }
    var key = (s.id || s.name) + "|" + part + "|" + view; if (!force && key === shown) return;
    var my = loading = {}; box.innerHTML = box.innerHTML || '<div class="empty">Writing the part…</div>';
    var ctx = await music(s); if (loading !== my) return;
    if (!ctx) { box.innerHTML = '<div class="empty">The Central Pedal has not shared this song\'s music yet (it does a few seconds after the song changes). Charts made there, and tracks it has listened to, become the parts here.</div>'; shown = ""; return; }
    var dk = CU.state.display && CU.state.display.key; if (dk && dk !== ctx.key) ctx = Object.assign({}, ctx, { key: dk, chords: transposeChords(ctx.chords, ctx.key, dk) });
    var p = P.build(ctx, part), v = view && p.views.indexOf(view) >= 0 ? view : p.views[0];
    $("#partViews").innerHTML = p.views.length > 1 ? p.views.map(function (x) { return '<button class="' + (x === v ? "on" : "") + '" data-pv="' + x + '">' + ({ chart: "Chart", notation: "Notation", tab: "Tab", drums: "Drums" }[x] || x) + "</button>"; }).join("") : "";
    box.innerHTML = P.render(p, v, { ctx: ctx, width: Math.max(560, box.clientWidth || chart.clientWidth || 900) - 30, shape: CU.prefs.shapes });
    shown = key;
  }
  // the Central Pedal can play the song in another key (key up / down): the parts follow it
  function transposeChords(chords, from, to) {
    var C = window.PPChords; if (!C || !chords) return chords;
    var shift = (C.noteIndex(to) - C.noteIndex(from) + 12) % 12; if (!shift) return chords;
    var flats = C.keyPrefersFlats(to);
    return chords.map(function (c) { return Object.assign({}, c, { label: C.transpose(c.label, shift, flats), bass: c.bass ? C.transpose(c.bass, shift, flats) : c.bass }); });
  }
  $("#partPick").addEventListener("change", function (e) { part = e.target.value; CU.store.set("part", part); view = ""; paint(true); });
  $("#partViews").addEventListener("click", function (e) { var b = e.target.closest("[data-pv]"); if (!b) return; view = b.dataset.pv; CU.store.set("partView", view); paint(true); });
  var lastSong = "";
  CU.on("message", function (m) {
    if (m.type === "display") { var s = song(), k = s ? (s.id || s.name) + "|" + (CU.state.display.key || "") : ""; if (k !== lastSong) { lastSong = k; paint(true); } }
    if (m.type === "hub" && m.changed) { m.changed.forEach(function (id) { Object.keys(cache).forEach(function (k) { if (k === id) delete cache[k]; }); }); var s2 = song(); if (s2 && m.changed.indexOf(s2.id) >= 0) paint(true); }
  });
  CU.on("tab", function (t) { if (t === "chart") paint(true); });
  window.addEventListener("resize", function () { if (part !== "chart") { clearTimeout(paint.t); paint.t = setTimeout(function () { paint(true); }, 250); } });
  window.CUParts = { paint: paint, set: function (p) { part = p; CU.store.set("part", p); $("#partPick").value = p; return paint(true); } };
  paint(true);
})();
