/* Central Control (10.2) - "New run sheet": a few questions, then runsheet-gen.js makes the run sheet.
 *   1. When: the name, the date (or every week), the start time, how long it runs, the countdown before it
 *   2. What happens, in order: tick the parts, move them up or down; the worship set takes songs from the track
 *      player's setlist (or just how many); the sermon its title, speaker and length; add your own parts
 *   3. Who's on: the worship leader, the speaker, the tech team
 * The run sheet it makes can be changed afterwards like any other (Service tab). */
(function () {
  "use strict";
  var CU = window.CentralUsage, G = window.CURunsheetGen; if (!CU || !G) return;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function nextSunday() { var d = new Date(); d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7)); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  var W = null;   // { step, a, songs, onDone, dlg }

  function fresh(songs) {
    var last = CU.store.get("rsWizard", null);   // (the last answers come back as the starting point: most weeks look alike)
    var on = {}; G.DEFAULT_ORDER.forEach(function (k) { on[k] = true; });
    var a = { name: "Sunday morning", date: nextSunday(), weekly: false, time: "10:00", length: 75, countdown: 5, order: G.ELEMENTS.map(function (e) { return e.kind; }), on: on,
      worship: { songs: songs.map(function (q) { return q.id || q.name; }).slice(0, 5), count: 4 }, response: { songs: [], count: 1 }, sermon: { title: "", speaker: "", minutes: 35 }, scripture: { title: "" }, video: { title: "", minutes: 3 },
      custom: [], team: { leader: "", speaker: "", tech: "" } };
    if (last) { ["name", "time", "length", "countdown", "order", "on", "custom"].forEach(function (k) { if (last[k] != null) a[k] = last[k]; }); if (last.team) a.team = last.team; if (last.sermon) { a.sermon.minutes = last.sermon.minutes; a.sermon.speaker = last.sermon.speaker || ""; } }
    if (!songs.length) a.worship.songs = [];
    a.order = a.order.filter(function (k) { return G.ELEMENTS.some(function (e) { return e.kind === k; }) || /^custom:/.test(k); });
    G.ELEMENTS.forEach(function (e) { if (a.order.indexOf(e.kind) < 0) a.order.push(e.kind); });
    a.custom.forEach(function (c) { if (a.order.indexOf("custom:" + c.id) < 0) a.order.push("custom:" + c.id); });
    return a;
  }
  function label(k) { if (/^custom:/.test(k)) { var c = W.a.custom.filter(function (x) { return "custom:" + x.id === k; })[0]; return c ? c.title || "Your part" : "Your part"; } var e = G.ELEMENTS.filter(function (x) { return x.kind === k; })[0]; return e ? e.label : k; }
  function extra(k) {
    var a = W.a, songs = W.songs;
    function picker(key) {
      var cfg = a[key];
      if (!songs.length) return '<label>How many songs <input type="number" min="1" max="12" data-rw="' + key + '.count" value="' + cfg.count + '" style="width:64px"></label><span class="muted small">No setlist on the track player yet: they\'ll be "Song 1", "Song 2"…</span>';
      return '<div class="rw-songs">' + songs.map(function (q) { var v = q.id || q.name; return '<label class="toggle"><input type="checkbox" data-rw-song="' + key + '" value="' + esc(v) + '"' + (cfg.songs.indexOf(v) >= 0 ? " checked" : "") + "> " + esc(q.name) + (q.duration ? ' <small class="muted">' + Math.floor(q.duration / 60) + ":" + pad(Math.round(q.duration % 60)) + "</small>" : "") + "</label>"; }).join("") + "</div>";
    }
    if (k === "worship") return picker("worship");
    if (k === "response") return picker("response");
    if (k === "sermon") return '<label>Title <input data-rw="sermon.title" value="' + esc(a.sermon.title) + '"></label><label>Speaker <input data-rw="sermon.speaker" value="' + esc(a.sermon.speaker) + '"></label><label>Minutes <input type="number" min="5" max="120" data-rw="sermon.minutes" value="' + a.sermon.minutes + '" style="width:64px"></label>';
    if (k === "scripture") return '<label>Passage <input data-rw="scripture.title" value="' + esc(a.scripture.title) + '" placeholder="e.g. Psalm 23"></label>';
    if (k === "video") return '<label>Video <input data-rw="video.title" value="' + esc(a.video.title) + '" placeholder="its slide\'s name"></label><label>Minutes <input type="number" min="1" max="60" step="0.5" data-rw="video.minutes" value="' + a.video.minutes + '" style="width:64px"></label>';
    if (/^custom:/.test(k)) { var c = a.custom.filter(function (x) { return "custom:" + x.id === k; })[0]; if (!c) return ""; return '<label>Name <input data-rw-custom="' + c.id + '" data-f="title" value="' + esc(c.title) + '"></label><label>Minutes <input type="number" min="1" max="120" data-rw-custom="' + c.id + '" data-f="minutes" value="' + c.minutes + '" style="width:64px"></label><button class="mini" data-rw-del="' + c.id + '">Remove</button>'; }
    return "";
  }
  function stepHtml() {
    var a = W.a;
    if (W.step === 1) return "<h3>New run sheet · 1 of 3: when</h3>" +
      '<div class="rw-grid"><label>Name <input data-rw="name" value="' + esc(a.name) + '"></label>' +
      '<label class="toggle"><input type="checkbox" data-rw="weekly"' + (a.weekly ? " checked" : "") + "> Every week (no date)</label>" +
      (a.weekly ? '<label>Day <select data-rw="day">' + ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map(function (d, i) { return '<option value="' + i + '"' + ((a.day || 0) === i ? " selected" : "") + ">" + d + "</option>"; }).join("") + "</select></label>" : '<label>Date <input type="date" data-rw="date" value="' + esc(a.date) + '"></label>') +
      '<label>Starts at <input type="time" data-rw="time" value="' + esc(a.time) + '"></label>' +
      '<label>Runs for (minutes) <input type="number" min="15" max="300" data-rw="length" value="' + a.length + '"></label>' +
      '<label>Countdown before it (minutes) <input type="number" min="0" max="30" data-rw="countdown" value="' + a.countdown + '"></label></div>';
    if (W.step === 2) return "<h3>2 of 3: what happens, in order</h3><p class=\"muted small\">Tick what's in this service and use the arrows to put it in order. The welcome, announcements, prayer, offering and closing stretch or shrink so it fits " + a.length + " minutes.</p>" +
      '<ol class="rw-order">' + a.order.map(function (k, i) {
        var on = /^custom:/.test(k) || !!a.on[k];
        return '<li class="' + (on ? "on" : "") + '"><div class="rw-line"><label class="toggle">' + (/^custom:/.test(k) ? "" : '<input type="checkbox" data-rw-on="' + k + '"' + (on ? " checked" : "") + ">") + " <b>" + esc(label(k)) + '</b></label><span class="rw-move"><button class="mini" data-rw-up="' + i + '" title="Earlier"' + (i ? "" : " disabled") + '>↑</button><button class="mini" data-rw-down="' + i + '" title="Later"' + (i < a.order.length - 1 ? "" : " disabled") + ">↓</button></span></div>" +
          (on ? '<div class="rw-extra">' + extra(k) + "</div>" : "") + "</li>";
      }).join("") + '</ol><button data-rw-add>+ Add your own part</button>';
    var tm = a.team;
    return "<h3>3 of 3: who's on</h3>" +
      '<div class="rw-grid"><label>Worship leader <input data-rw="team.leader" value="' + esc(tm.leader) + '"></label><label>Speaker <input data-rw="team.speaker" value="' + esc(tm.speaker || a.sermon.speaker) + '"></label><label class="wide">Tech team <input data-rw="team.tech" value="' + esc(tm.tech) + '" placeholder="Sam on sound, Lee on lights…"></label></div>' +
      '<p class="muted small">Then it makes the run sheet: start times, lengths (a song\'s from its tracks), who leads each part and the cues each computer fires. You can change anything after.</p>';
  }
  function paint() {
    var d = W.dlg; d.querySelector(".rw-body").innerHTML = stepHtml();
    d.querySelector("[data-rw-back]").hidden = W.step === 1;
    d.querySelector("[data-rw-next]").textContent = W.step === 3 ? "Make the run sheet" : "Next";
  }
  function setPath(path, v) { var p = path.split("."), o = W.a; for (var i = 0; i < p.length - 1; i++) o = o[p[i]]; o[p[p.length - 1]] = v; }
  function onInput(e) {
    var t = e.target;
    if (t.dataset.rw) { var v = t.type === "checkbox" ? t.checked : t.type === "number" ? Number(t.value) : t.value; setPath(t.dataset.rw, v); if (t.dataset.rw === "weekly" || t.dataset.rw === "sermon.speaker") { if (t.dataset.rw === "weekly") paint(); } return; }
    if (t.dataset.rwOn) { W.a.on[t.dataset.rwOn] = t.checked; paint(); return; }
    if (t.dataset.rwSong) { var cfg = W.a[t.dataset.rwSong], val = t.value; cfg.songs = cfg.songs.filter(function (x) { return x !== val; }); if (t.checked) { var all = W.songs.map(function (q) { return q.id || q.name; }); cfg.songs.push(val); cfg.songs.sort(function (x, y) { return all.indexOf(x) - all.indexOf(y); }); } return; }
    if (t.dataset.rwCustom) { var c = W.a.custom.filter(function (x) { return x.id === t.dataset.rwCustom; })[0]; if (c) c[t.dataset.f] = t.dataset.f === "minutes" ? Number(t.value) : t.value; }
  }
  function onClick(e) {
    var b = e.target.closest("button"); if (!b) return; var a = W.a;
    if (b.dataset.rwUp != null) { var i = Number(b.dataset.rwUp); a.order.splice(i - 1, 0, a.order.splice(i, 1)[0]); paint(); return; }
    if (b.dataset.rwDown != null) { var j = Number(b.dataset.rwDown); a.order.splice(j + 1, 0, a.order.splice(j, 1)[0]); paint(); return; }
    if (b.hasAttribute("data-rw-add")) { var id = Date.now().toString(36); a.custom.push({ id: id, title: "", minutes: 5 }); a.order.push("custom:" + id); paint(); return; }
    if (b.dataset.rwDel) { a.custom = a.custom.filter(function (x) { return x.id !== b.dataset.rwDel; }); a.order = a.order.filter(function (k) { return k !== "custom:" + b.dataset.rwDel; }); paint(); return; }
    if (b.hasAttribute("data-rw-back")) { W.step = Math.max(1, W.step - 1); paint(); return; }
    if (b.hasAttribute("data-rw-next")) { if (W.step < 3) { W.step++; paint(); } else finish(); return; }
    if (b.hasAttribute("data-rw-cancel")) W.dlg.close();
  }
  // the answers -> runsheet-gen.js
  function answers() {
    var a = W.a, els = [];
    a.order.forEach(function (k) {
      if (/^custom:/.test(k)) { var c = a.custom.filter(function (x) { return "custom:" + x.id === k; })[0]; if (c && String(c.title).trim()) els.push({ kind: "custom", title: c.title, minutes: c.minutes }); return; }
      if (!a.on[k]) return;
      if (k === "worship" || k === "response") els.push({ kind: k, songs: a[k].songs.slice(), count: a[k].count });
      else if (k === "sermon") els.push({ kind: "sermon", title: a.sermon.title, speaker: a.sermon.speaker || a.team.speaker, minutes: a.sermon.minutes });
      else if (k === "scripture") els.push({ kind: "scripture", title: a.scripture.title });
      else if (k === "video") els.push({ kind: "video", title: a.video.title, minutes: a.video.minutes });
      else els.push({ kind: k });
    });
    return { name: a.name, date: a.weekly ? "" : a.date, day: a.weekly ? a.day || 0 : undefined, time: a.time, length: a.length, countdown: a.countdown, elements: els,
      team: { leader: a.team.leader, speaker: a.team.speaker || a.sermon.speaker, tech: String(a.team.tech || "").split(",").map(function (x) { return x.trim(); }).filter(Boolean) } };
  }
  function finish() {
    var sv = G.generate(answers(), W.songs);
    try { CU.store.set("rsWizard", W.a); } catch (_) { }
    W.dlg.close();
    if (W.onDone) W.onDone(sv);
    var f = G.fit(sv);
    if (sv.length && f.over >= 1 && window.CURoles && window.CURoles.toast) window.CURoles.toast("This run sheet is " + Math.round(f.over) + " minutes over " + sv.length + ". Shorten a song or the sermon, or drop a part.");
  }
  function open(opts) {
    opts = opts || {};
    var songs = (opts.songs || []).filter(function (q) { return q && q.name; });
    var d = document.createElement("dialog"); d.className = "rw";
    d.innerHTML = '<div class="rw-body"></div><div class="row rw-foot"><button data-rw-cancel>Cancel</button><span class="spacer"></span><button data-rw-back>Back</button><button class="primary" data-rw-next>Next</button></div>';
    document.body.appendChild(d);
    W = { step: 1, songs: songs, a: fresh(songs), onDone: opts.onDone, dlg: d };
    d.addEventListener("input", onInput); d.addEventListener("change", onInput); d.addEventListener("click", onClick);
    d.addEventListener("close", function () { d.remove(); });
    paint(); d.showModal();
    return W;
  }
  window.CURunsheetWizard = { open: open, answers: function () { return W ? answers() : null; } };
})();
