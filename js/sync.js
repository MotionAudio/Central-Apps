/* Central Control - the same songs and setlists on every Central Control (the Pi and Central Control on a PC).
 * The driver does the copying (pedal-driver.py SongSync); this file is the app's side:
 *   - songs and setlists that arrive are put into the open setlist (an edit on another device shows up here)
 *   - "Setlists": every setlist from every device, Open one; New setlist
 *   - "Song library": every song, add it to this setlist; delete on this device or everywhere
 *   - "Devices": find the other Central Controls on the network and link once with their code */
(function () {
  "use strict";
  var PP = window.PP, F = window.PPFeatures; if (!PP || !F) return;
  var MEDIA = "http://127.0.0.1:8766";
  var status = null, view = "setlists";
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function driverOn() { return window.__pedalBridge && window.__pedalBridge.connected; }
  function get(p) { return fetch(MEDIA + p, { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }
  function post(p, body) { return fetch(MEDIA + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) }).then(function (r) { return r.json(); }).catch(function (e) { return { ok: false, error: String(e) }; }); }
  function ago(ts) { if (!ts) return ""; var s = (Date.now() - ts) / 1000; return s < 90 ? "just now" : s < 5400 ? Math.round(s / 60) + " min ago" : s < 129600 ? Math.round(s / 3600) + " h ago" : new Date(ts).toLocaleDateString(); }

  // a small text question in the page (Electron has no window.prompt)
  function ask(label, value) {
    return new Promise(function (resolve) {
      var d = document.createElement("dialog"); d.className = "sync-ask";
      d.innerHTML = '<form method="dialog"><p>' + esc(label) + '</p><input data-q value="' + esc(value || "") + '"><div class="row"><button value="ok" class="primary">OK</button><button value="cancel" formnovalidate>Cancel</button></div></form>';
      document.body.appendChild(d); d.showModal(); var inp = d.querySelector("[data-q]"); inp.focus(); inp.select();
      d.addEventListener("close", function () { var v = d.returnValue === "ok" ? inp.value : null; d.remove(); resolve(v); });
    });
  }

  // ------------------------------------------------------------- what arrives from the other devices
  function replaceSong(target, fresh) { Object.keys(target).forEach(function (k) { delete target[k]; }); Object.assign(target, fresh); }
  F.on("sync", function (m) {
    var p = PP.project();
    if (m.event === "status") { status = m; line(); if (isOpen()) paint(); return; }
    if (m.event === "song" && m.song) {
      var i = p.songs.findIndex(function (s) { return s.id === m.song.id; });
      if (i < 0) { if (isOpen()) paint(); return; }
      replaceSong(p.songs[i], m.song);
      if (window.PPTracks && window.PPTracks.forgetStem) (m.song.tracks && m.song.tracks.stems || []).forEach(function (st) { window.PPTracks.forgetStem(st.id); });
      PP.persistSoon(); F.renderSetlist(); F.renderPerformExtras();
      if (i === p.songIndex) F.loadSong(i);
      PP.setStatus("\"" + m.song.name + "\" was changed on another Central Control");
    }
    if (m.event === "setlist" && m.id === p.setlistId) {
      if (m.deleted || !m.setlist) { PP.setStatus("This setlist was deleted on another Central Control (it stays open here until you open another)."); return; }
      applySetlist(m.setlist);
    }
    if (m.event === "removed") {
      var j = p.songs.findIndex(function (s) { return s.id === m.id; });
      if (j >= 0) { var nm = p.songs[j].name; p.songs.splice(j, 1); if (p.songIndex >= p.songs.length) p.songIndex = p.songs.length - 1; PP.persistSoon(); F.renderSetlist(); F.renderPerformExtras(); PP.setStatus("\"" + nm + "\" was deleted on another Central Control"); }
    }
    if (isOpen()) paint();
  });
  // the open setlist was changed elsewhere: same order, new songs fetched, removed ones gone
  async function applySetlist(sl) {
    var p = PP.project(), have = {}, cur = p.songs[p.songIndex];
    p.songs.forEach(function (s) { have[s.id] = s; });
    var next = [];
    for (var i = 0; i < sl.songIds.length; i++) {
      var id = sl.songIds[i];
      if (have[id]) next.push(have[id]); else { var s = await get("/sync/song/" + encodeURIComponent(id)); if (s) next.push(s); }
    }
    p.songs = next; p.name = sl.name || p.name;
    p.songIndex = cur ? next.indexOf(cur) : -1;
    var nameEl = $("#projectName"); if (nameEl) nameEl.value = p.name;
    PP.persistSoon(); F.renderSetlist(); F.renderPerformExtras();
  }

  // ------------------------------------------------------------- open / new setlist
  async function openSetlist(id) {
    var sl = await get("/sync/setlist/" + encodeURIComponent(id)); if (!sl) return PP.setStatus("That setlist is not here any more.");
    var p = PP.project();
    if (window.PPTracks && window.PPTracks.isPlaying && window.PPTracks.isPlaying()) window.PPTracks.stop();
    p.songs = sl.songs; p.setlistId = sl.id; p.name = sl.name; p.songIndex = -1;
    var nameEl = $("#projectName"); if (nameEl) nameEl.value = p.name;
    PP.persistNow(); F.loadSong(sl.songs.length ? 0 : -1); F.renderSetlist(); F.renderPerformExtras();
    PP.setStatus("Opened \"" + sl.name + "\" · " + sl.songs.length + " song" + (sl.songs.length === 1 ? "" : "s") + (sl.missingStems ? " · " + sl.missingStems + " still copying their tracks" : ""));
    close();
  }
  async function newSetlist() {
    var nm = await ask("Name of the new setlist:", "Sunday " + new Date().toLocaleDateString()); if (!nm) return;
    var p = PP.project();
    if (window.PPTracks && window.PPTracks.isPlaying && window.PPTracks.isPlaying()) window.PPTracks.stop();
    p.songs = []; p.songIndex = -1; p.name = nm; p.setlistId = "p_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 9);
    var nameEl = $("#projectName"); if (nameEl) nameEl.value = nm;
    PP.persistNow(); F.loadSong(-1); F.renderSetlist(); F.renderPerformExtras(); close();
    PP.setStatus("New setlist \"" + nm + "\" - add songs from the Song library or + Add song");
  }
  async function addSong(id) {
    var p = PP.project(); if (p.songs.some(function (s) { return s.id === id; })) return PP.setStatus("That song is already in this setlist.");
    var s = await get("/sync/song/" + encodeURIComponent(id)); if (!s) return;
    p.songs.push(s); PP.persistSoon(); F.renderSetlist(); F.renderPerformExtras(); paint();
    PP.setStatus("\"" + s.name + "\" added to " + p.name + (status && status.kind === "pi" ? " - its tracks copy over now if they are not here yet" : ""));
  }

  // ------------------------------------------------------------- deleting asks where
  function askDelete(song, index) {
    var d = document.createElement("dialog"); d.className = "sync-ask";
    d.innerHTML = '<h3>Remove "' + esc(song.name) + '"?</h3><div class="sync-ask-opts">' +
      '<button data-del="list" class="primary">From this setlist only<small>the song stays in the Song library on every device</small></button>' +
      '<button data-del="here">Delete on this Central Control<small>its tracks are removed here; the other devices keep it</small></button>' +
      '<button data-del="everywhere" class="danger">Delete everywhere<small>from every linked Central Control</small></button></div><div class="row"><button data-del="cancel">Cancel</button></div>';
    document.body.appendChild(d); d.showModal();
    d.addEventListener("close", function () { d.remove(); });
    d.addEventListener("click", async function (e) {
      var b = e.target.closest("[data-del]"); if (!b) return; var what = b.dataset.del; d.close();
      if (what === "cancel") return;
      var p = PP.project(), i = index != null ? index : p.songs.indexOf(song);
      if (i >= 0) { p.songs.splice(i, 1); if (p.songIndex >= p.songs.length) p.songIndex = p.songs.length - 1; PP.persistNow(); F.renderSetlist(); F.renderPerformExtras(); }
      if (what !== "list") {
        var r = await post("/sync/delete", { kind: "song", id: song.id, scope: what });
        PP.setStatus(r.ok ? "\"" + song.name + "\" deleted " + (what === "here" ? "on this Central Control" : "everywhere") : "Not deleted: " + (r.error || ""));
      }
      if (isOpen()) paint();
    });
  }

  // ------------------------------------------------------------- the dialog
  function isOpen() { var d = $("#syncDialog"); return d && d.open; }
  function close() { var d = $("#syncDialog"); if (d && d.open) d.close(); }
  function open(which) {
    var d = $("#syncDialog");
    if (!d) {
      d = document.createElement("dialog"); d.id = "syncDialog"; d.className = "sync-dialog";
      d.innerHTML = '<div class="row spread"><div><h2>Setlists, songs and devices</h2><p class="muted">The same songs and setlists on every linked Central Control - the Pi and Central Control on your computers.</p></div><button data-sync="close">Close</button></div>' +
        '<div class="add-tabs" id="syncTabs"><button data-view="setlists">Setlists</button><button data-view="songs">Song library</button><button data-view="devices">Devices</button></div><div id="syncBody" class="sync-body"></div>';
      document.body.appendChild(d);
      d.addEventListener("click", onClick);
      d.addEventListener("change", onChange);
    }
    view = which || view; if (!d.open) d.showModal(); paint();
  }
  var paintSeq = 0;
  async function paint() {
    var d = $("#syncDialog"); if (!d) return;
    var seq = ++paintSeq, mine = function () { return seq === paintSeq; };   // a newer paint replaces an older one still waiting
    d.querySelectorAll("#syncTabs [data-view]").forEach(function (b) { b.classList.toggle("on", b.dataset.view === view); });
    var body = $("#syncBody", d);
    if (!driverOn()) { body.innerHTML = '<p class="muted">Needs the Central Control service (it is running on the Pi and in Central Control on a PC).</p>'; return; }
    var p = PP.project();
    if (view === "setlists") {
      var j = await get("/sync/setlists"), lists = j && j.setlists || []; if (!mine()) return;
      body.innerHTML = '<div class="row"><button class="primary" data-sync="new">+ New setlist</button>' + linkedNote() + "</div>" +
        (lists.length ? '<div class="sync-list">' + lists.map(function (x) {
          var cur = x.id === p.setlistId;
          return '<div class="sync-row' + (cur ? " current" : "") + '"><div><b>' + esc(x.name) + "</b><small>" + x.count + " song" + (x.count === 1 ? "" : "s") + " · made on " + esc(x.by) + " · " + ago(x.ts) + "</small></div>" +
            (cur ? '<span class="pill">open</span>' : '<button class="primary" data-open="' + esc(x.id) + '">Open</button>') + '<button data-del-list="' + esc(x.id) + '" title="Delete this setlist everywhere (the songs stay)">Delete</button></div>';
        }).join("") + "</div>" : '<p class="muted">No setlists yet - the one open now is saved as soon as it has a song.</p>');
    } else if (view === "songs") {
      var s = await get("/sync/songs"), songs = (s && s.songs || []).filter(function (x) { return x.here; }), inThis = {}; if (!mine()) return;
      p.songs.forEach(function (x) { inThis[x.id] = 1; });
      body.innerHTML = '<div class="row"><input id="syncFind" placeholder="Find a song" value=""><span class="muted small">' + songs.length + " song" + (songs.length === 1 ? "" : "s") + "</span>" + linkedNote() + "</div>" +
        '<div class="sync-list" id="syncSongs">' + songs.map(function (x) {
          return '<div class="sync-row" data-name="' + esc(x.name.toLowerCase()) + '"><div><b>' + esc(x.name) + "</b><small>" + esc((x.key || "") + (x.bpm ? " · " + x.bpm + " BPM" : "")) + (x.stems ? " · " + x.stems + " tracks" + (x.stemsHere ? "" : ' <span class="warn">(tracks not on this device yet)</span>') : "") +
            (x.setlists.length ? " · in " + esc(x.setlists.join(", ")) : " · in no setlist") + " · from " + esc(x.by) + "</small></div>" +
            (inThis[x.id] ? '<span class="pill">in this setlist</span>' : '<button class="primary" data-add="' + esc(x.id) + '">+ Add</button>') + '<button data-del-song="' + esc(x.id) + '" data-name="' + esc(x.name) + '">Delete…</button></div>';
        }).join("") + "</div>";
    } else {
      var st = await get("/sync/status") || status || {}; if (!mine()) return;
      status = st;
      var peers = st.peers || [];
      body.innerHTML = '<table class="sync-t"><tr><td>This Central Control</td><td><input id="syncName" value="' + esc(st.name || "") + '"> <span class="muted small">' + (st.kind === "pi" ? "Raspberry Pi - keeps the tracks of songs in a setlist" : "computer - keeps every song's tracks") + "</span></td></tr>" +
        "<tr><td>Songs / setlists</td><td>" + (st.songs || 0) + " / " + (st.setlists || 0) + (st.activity && st.activity.busy ? ' · <span class="ok">copying ' + esc(st.activity.file || "") + "…</span>" : "") + "</td></tr>" +
        (st.activity && st.activity.warning ? '<tr><td></td><td class="warn">' + esc(st.activity.warning) + "</td></tr>" : "") + "</table>" +
        "<h3>Other Central Controls on this network</h3>" +
        (peers.length ? '<div class="sync-list">' + peers.map(function (x) {
          return '<div class="sync-row"><div><span class="dot' + (x.online ? "" : " off") + '"></span> <b>' + esc(x.name || x.address) + "</b><small>" + esc(x.address || "") + (x.kind ? " · " + (x.kind === "pi" ? "Raspberry Pi" : "computer") : "") + (x.linked ? " · linked" + (x.lastSync ? ", synced " + ago(x.lastSync) : "") : "") + (x.error ? ' · <span class="warn">' + esc(x.error) + "</span>" : "") + "</small></div>" +
            (x.linked ? '<span class="pill ok">linked</span>' : '<button class="primary" data-link="' + esc(x.address) + '" data-port="' + esc(x.port || 8080) + '" data-name="' + esc(x.name || "") + '">Link…</button>') + "</div>";
        }).join("") + "</div>" : '<p class="muted">None found yet. They show up here when they are on the same network (Pi: Settings shows its address).</p>') +
        '<div class="row"><button data-sync="manual">Link by address…</button>' + (st.linked ? '<button data-sync="now">Sync now</button><button data-sync="unlink">Unlink this device</button>' : "") + "</div>" +
        '<p class="muted small">Link once with the other one\'s pairing code (its Settings). After that, songs, setlists, charts, stems and light shows copy both ways by themselves; the newest edit wins.</p>';
    }
  }
  function linkedNote() {
    var st = status; if (!st) return "";
    var n = (st.peers || []).filter(function (x) { return x.linked; }).length;
    return '<span class="muted small sync-note">' + (st.linked ? "Shared with " + n + " other Central Control" + (n === 1 ? "" : "s") : 'Only on this device - <a href="#" data-view="devices">link another</a>') + "</span>";
  }
  async function onClick(e) {
    var b = e.target.closest("button,a"); if (!b) return;
    if (b.dataset.view) { e.preventDefault(); view = b.dataset.view; return paint(); }
    if (b.dataset.sync === "close") return close();
    if (b.dataset.sync === "new") return newSetlist();
    if (b.dataset.open) return openSetlist(b.dataset.open);
    if (b.dataset.add) return addSong(b.dataset.add);
    if (b.dataset.delList) { if (confirm("Delete this setlist on every Central Control? Its songs stay in the Song library.")) { await post("/sync/delete", { kind: "setlist", id: b.dataset.delList, scope: "everywhere" }); paint(); } return; }
    if (b.dataset.delSong) {
      var p = PP.project(), inList = p.songs.find(function (s) { return s.id === b.dataset.delSong; });
      if (inList) return askDelete(inList);
      var where = confirm("Delete \"" + b.dataset.name + "\" on EVERY Central Control?\n\nOK = everywhere · Cancel = choose this device only") ? "everywhere" : (confirm("Delete it on this Central Control only?") ? "here" : null);
      if (where) { await post("/sync/delete", { kind: "song", id: b.dataset.delSong, scope: where }); paint(); }
      return;
    }
    if (b.dataset.link || b.dataset.sync === "manual") {
      var addr = b.dataset.link, port = Number(b.dataset.port || 8080);
      if (!addr) { var a = await ask("Address of the other Central Control (e.g. padpedal.local or 192.168.1.40):", ""); if (!a) return; var hp = a.trim().split(":"); addr = hp[0]; port = Number(hp[1] || 8080); }
      var code = await ask("Pairing code of " + (b.dataset.name || addr) + " (4 digits, in its Settings):", ""); if (!code) return;
      var r = await post("/sync/link", { address: addr, port: port, code: code.trim() });
      PP.setStatus(r.ok ? "Linked with " + (r.name || addr) + " - songs and setlists are copying" : "Not linked: " + (r.error || ""));
      status = await get("/sync/status"); return paint();
    }
    if (b.dataset.sync === "now") { await post("/sync/now"); PP.setStatus("Syncing…"); return; }
    if (b.dataset.sync === "unlink") { if (confirm("Unlink this Central Control? Its songs stay here; nothing copies any more until you link again.")) { await post("/sync/unlink"); status = await get("/sync/status"); paint(); } }
  }
  async function onChange(e) {
    if (e.target.id === "syncName") { status = await post("/sync/name", { name: e.target.value }); }
  }
  document.addEventListener("input", function (e) {
    if (e.target.id !== "syncFind") return; var q = e.target.value.trim().toLowerCase();
    document.querySelectorAll("#syncSongs .sync-row").forEach(function (r) { r.hidden = q && r.dataset.name.indexOf(q) < 0; });
  });

  // a line under the setlist: who it is shared with
  function line() {
    var el = $("#syncLine"); if (!el) return; var st = status;
    if (!st) { el.textContent = ""; return; }
    var linked = (st.peers || []).filter(function (x) { return x.linked; }), on = linked.filter(function (x) { return x.online; });
    el.innerHTML = st.linked ? "Shared with " + linked.map(function (x) { return esc(x.name) + (x.online ? "" : " (off)"); }).join(", ") + (st.activity && st.activity.busy ? " · copying tracks…" : on.length ? " · up to date" : "") : "Only on this Central Control · Setlists… → Devices to link another";
  }
  document.addEventListener("click", function (e) { if (e.target.closest("#syncOpen")) { e.preventDefault(); open("setlists"); } });
  F.on("hello", function () { setTimeout(function () { get("/sync/status").then(function (s) { if (s) { status = s; line(); } }); PP.persistSoon(); }, 1200); });

  window.PPSync = { ask: ask, open: open, openSetlist: openSetlist, askDelete: askDelete, linked: function () { return !!(status && status.linked); }, status: function () { return status; } };
})();
