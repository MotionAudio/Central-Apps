/* Central Pedal / Central Pedal Control / Central Control's player window - Setlists (10.0).
 *
 *   Load setlist   the earlier ones: the ones on this device, and (signed in) the church's, from any device
 *   Create new     a name, the day, and the team - people from the church's Central Services teams, as many as it
 *                  has slots
 *   Add songs      opens the website on this setlist (#setlist-<id>): buy what you don't have, or add anything with
 *                  Central Tracks Unlimited. This app checks the setlist every few seconds and downloads what was added.
 *
 * Where the tracks are kept and played: Central Pedal Control or Central Control keeps every song and runs them; the
 * pedal controls them. With no computer around the pedal plays, and keeps one setlist's tracks at a time (the driver
 * does that: SongSync.keep_one_setlist). A setlist that lives on the church account has setlistId "cl_<id>" here, and
 * project.setlistCloud = { local: "cl_<id>", id, team }. */
(function () {
  "use strict";
  var PP = window.PP, F = window.PPFeatures; if (!PP || !F) return;
  var MEDIA = "http://127.0.0.1:8766";
  var esc = PP.escapeHtml || function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var st = { view: "load", local: null, cloud: null, cloudErr: "", church: null, teamMax: 0, people: [], peopleWhy: "", pick: [], find: "", msg: "", busy: false, host: null, watchUntil: 0, importing: {}, notHere: 0 };
  var pushed = {};   // cloud id -> the song list last sent
  var known = {};    // Central Tracks id -> a song this device has (another setlist can use it without downloading it again)
  function remember() { PP.project().songs.forEach(function (s) { if (s.ctId) known[s.ctId] = s; }); }
  function $(s, r) { return (r || document).querySelector(s); }
  function CT() { return window.PPCentralTracks || null; }
  function online() { var c = CT(); return !!(c && c.signedIn && c.signedIn()); }
  function api(m, p, b) { return CT().api(m, p, b); }
  function driverOn() { return !!(window.__pedalBridge && window.__pedalBridge.connected); }
  function dget(p) { return fetch(MEDIA + p, { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); }
  function ago(ts) { if (!ts) return ""; var t = typeof ts === "number" ? ts : Date.parse(ts), s = (Date.now() - t) / 1000; return s < 90 ? "just now" : s < 5400 ? Math.round(s / 60) + " min ago" : s < 129600 ? Math.round(s / 3600) + " h ago" : new Date(t).toLocaleDateString(); }
  function playing() { return !!(window.PPTracks && window.PPTracks.isPlaying && window.PPTracks.isPlaying()); }
  function cloud() {
    var p = PP.project(), c = p.setlistCloud;
    if (c && c.local === p.setlistId && c.id) return c;
    if (/^cl_\d+$/.test(p.setlistId || "")) { p.setlistCloud = { local: p.setlistId, id: p.setlistId.slice(3), team: [] }; return p.setlistCloud; }   // (opened from the song sync)
    return null;
  }
  function nextSunday() { var d = new Date(); d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7)); return d; }
  function isoDay(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }

  // ------------------------------------------------------------------ where the tracks run (the driver says)
  F.on("hello", function (m) { st.host = m.tracksHost || null; line(); });
  F.on("tracksHost", function (m) { st.host = m; line(); if (isOpen()) paint(); });
  F.on("pedalRole", function () { if (F.sendToDriver) F.sendToDriver({ type: "tracksHost" }); });
  function whereText() {
    var h = st.host || {}, pl = h.player || {};
    if (!driverOn()) return "";
    if (h.me === "pedal-control") return h.runTracks ? "This computer keeps the songs and runs the tracks." + (h.controllers && h.controllers.length ? " " + h.controllers.join(", ") + " control" + (h.controllers.length === 1 ? "s" : "") + " them." : " A linked pedal controls them when it's on.") : "This computer only edits the songs. The pedal keeps and plays its own set (Upload sends it).";
    if (h.me === "player") return "Central Control keeps the songs and runs the tracks on this computer. The pedals control them.";
    if (h.me === "pi" && !h.plays && h.via === "pedal-control") return (pl.name || "Central Pedal Control") + " keeps the songs and runs the tracks. This pedal controls them, and plays them itself if that computer goes away.";
    if (h.me === "pi" && !h.plays) return "The tracks run on " + (pl.name || "the main admin's computer") + ". This pedal controls them.";
    if (h.me === "pi") return "The tracks play on this pedal. It keeps one setlist's tracks at a time" + (h.keptOnlyHere ? " (and " + h.keptOnlyHere + " song" + (h.keptOnlyHere === 1 ? " that's" : "s that are") + " only here)" : "") + ". Link Central Pedal Control on a computer to keep all your songs there.";
    return "This computer keeps every song's tracks.";
  }
  function line() {
    var el = $("#slWhere"); if (el) el.textContent = whereText();
    var info = $("#slInfo"); if (!info) return;
    var c = cloud(), team = c && c.team || [];
    info.innerHTML = c ? "On your church's account" + (team.length ? " · playing: " + esc(team.map(function (t) { return t.name || t.email; }).join(", ")) : "") : "";
  }

  // ------------------------------------------------------------------ the dialog
  function isOpen() { var d = $("#slDialog"); return !!(d && d.open); }
  function close() { var d = $("#slDialog"); if (d && d.open) d.close(); }
  function open(view) {
    var d = $("#slDialog");
    if (!d) {
      d = document.createElement("dialog"); d.id = "slDialog"; d.className = "sync-dialog sl-dialog";
      d.innerHTML = '<div class="row spread"><div><h2>Setlists</h2><p class="muted small" id="slWhere"></p></div><button data-sl="close">Close</button></div>' +
        '<div class="sl-big"><button data-sl-view="load">Load setlist</button><button data-sl-view="create">Create new</button><button data-sl-view="add" class="primary">Add songs</button></div><div id="slBody" class="sync-body"></div>';
      document.body.appendChild(d);
      d.addEventListener("click", onClick); d.addEventListener("input", onInput); d.addEventListener("change", onChange);
    }
    st.view = view || st.view || "load"; st.msg = "";
    if (st.view === "create") { st.pick = []; st.find = ""; }
    if (!d.open) d.showModal();
    if (F.sendToDriver) F.sendToDriver({ type: "tracksHost" });
    if (st.view === "add") return addSongs();
    paint(); if (st.view === "load") loadLists(); if (st.view === "create") findPeople("");
  }
  async function loadLists() {
    st.busy = true; paint();
    var j = driverOn() ? await dget("/sync/setlists") : null;
    st.local = (j && j.setlists) || [];
    st.cloud = null; st.cloudErr = "";
    if (online()) {
      try { var r = await api("GET", "/setlists"); st.cloud = r.setlists || []; st.church = r.church; st.teamMax = r.teamMax || 0; }
      catch (e) { st.cloudErr = e.message; }
    }
    st.busy = false; paint();
  }
  async function findPeople(q) {
    if (!online()) { st.people = []; st.peopleWhy = ""; return paint(); }
    try { var r = await api("GET", "/setlists/people?q=" + encodeURIComponent(q || "")); st.people = r.people || []; st.teamMax = r.max || 0; st.peopleWhy = r.why || ""; st.church = r.church; }
    catch (e) { st.people = []; st.peopleWhy = e.message; }
    paint();
  }
  function paint() {
    var body = $("#slBody"); if (!body) return;
    var d = $("#slDialog"); if (d) d.querySelectorAll("[data-sl-view]").forEach(function (b) { b.classList.toggle("on", b.dataset.slView === st.view); });
    line();
    var p = PP.project(), html = "";
    if (st.host && st.host.me === "pedal-control" && st.view === "load") html += '<label class="toggle small"><input type="checkbox" id="slRun"' + (st.host.runTracks ? " checked" : "") + "><span>Run the tracks on this computer while a pedal is linked (the pedal controls them, and plays them itself if this computer goes away)</span></label>";
    if (st.view === "load") {
      var cl = st.cloud || [], mineIds = {}; cl.forEach(function (x) { mineIds["cl_" + x.id] = 1; });
      var loc = (st.local || []).filter(function (x) { return !mineIds[x.id]; }), here = {}; (st.local || []).forEach(function (x) { here[x.id] = 1; });
      html += st.busy && !st.local ? '<p class="muted">Looking…</p>' : "";
      if (online()) {
        html += "<h3>" + esc(st.church ? st.church + "'s setlists" : "Your setlists") + "</h3>" + (st.cloudErr ? '<p class="warn small">' + esc(st.cloudErr) + "</p>" : "") +
          (cl.length ? '<div class="sync-list">' + cl.map(function (x) {
            var cur = "cl_" + x.id === p.setlistId;
            return '<div class="sync-row' + (cur ? " current" : "") + '"><div><b>' + esc(x.name) + "</b><small>" + x.count + " song" + (x.count === 1 ? "" : "s") + (x.titles && x.titles.length ? ": " + esc(x.titles.join(", ")) + (x.count > x.titles.length ? "…" : "") : "") +
              (x.team && x.team.length ? " · " + esc(x.team.map(function (t) { return t.name || t.email; }).join(", ")) : "") + " · " + (x.serviceAt ? "for " + new Date(x.serviceAt).toLocaleDateString() : "changed " + ago(x.updatedAt)) + (here["cl_" + x.id] ? " · on this device" : "") + "</small></div>" +
              (cur ? '<span class="pill">open</span>' : '<button class="primary" data-sl-cloud="' + esc(x.id) + '">Open</button>') + "</div>";
          }).join("") + "</div>" : st.cloud ? '<p class="muted">No setlists on your account yet. Make one with Create new.</p>' : "");
      } else {
        html += '<p class="muted small">Sign in to Central Tracks (Add songs → Central Tracks) to see your church\'s setlists from every device. <button data-sl="signin">Sign in</button></p>';
      }
      html += "<h3>On this device</h3>" + (loc.length ? '<div class="sync-list">' + loc.map(function (x) {
        var cur = x.id === p.setlistId;
        return '<div class="sync-row' + (cur ? " current" : "") + '"><div><b>' + esc(x.name) + "</b><small>" + x.count + " song" + (x.count === 1 ? "" : "s") + " · made on " + esc(x.by) + " · " + ago(x.ts) + "</small></div>" +
          (cur ? '<span class="pill">open</span>' : '<button class="primary" data-sl-local="' + esc(x.id) + '">Open</button>') + "</div>";
      }).join("") + "</div>" : '<p class="muted">' + (driverOn() ? "None yet." : "Needs the Central Pedal service.") + "</p>");
    } else if (st.view === "create") {
      var max = st.teamMax, full = online() && st.pick.length >= max;
      html += '<div class="form"><label>Name<input id="slName" value="' + esc(st.name || "Sunday " + nextSunday().toLocaleDateString(undefined, { month: "short", day: "numeric" })) + '"></label>' +
        '<label>Day (optional)<input id="slDay" type="date" value="' + esc(st.day || isoDay(nextSunday())) + '"></label></div>';
      if (online()) {
        html += "<h3>Team</h3>" + (max ? '<p class="muted small">' + st.pick.length + " of " + max + " (your church's Central Services slots)</p>" : "") + (st.peopleWhy ? '<p class="muted small">' + esc(st.peopleWhy) + "</p>" : "") +
          '<div class="sl-chips">' + st.pick.map(function (t, i) { return '<span class="sl-chip">' + esc(t.name || t.email) + (t.role ? " <small>" + esc(t.role) + "</small>" : "") + ' <button data-sl-unpick="' + i + '" aria-label="Take ' + esc(t.name || t.email) + ' off">✕</button></span>'; }).join("") + "</div>" +
          (max ? '<label>Find someone<input id="slFind" value="' + esc(st.find) + '" placeholder="Name, email or role"></label><div class="sync-list sl-people">' + st.people.filter(function (x) { return !st.pick.some(function (y) { return y.email === x.email; }); }).slice(0, 20).map(function (x) {
            return '<div class="sync-row"><div><b>' + esc(x.name || x.email) + "</b><small>" + esc([x.email, x.role, x.team].filter(Boolean).join(" · ")) + '</small></div><button data-sl-pick="' + esc(x.email) + '"' + (full ? " disabled title=\"That's every slot\"" : "") + ">Add</button></div>";
          }).join("") + "</div>" : "");
      } else html += '<p class="muted small">The team comes from your church\'s Central Services teams once you\'re signed in to Central Tracks. Without it, the setlist is kept on this device.</p>';
      html += '<div class="row"><button class="primary" data-sl="create"' + (st.busy ? " disabled" : "") + ">Create setlist</button></div>";
    } else if (st.view === "add") {
      var c = cloud();
      if (c && online()) {
        var url = CT().base() + "/#setlist-" + encodeURIComponent(c.id), pi = st.host && st.host.me === "pi";
        html += "<p>Pick the songs for <b>" + esc(p.name) + "</b> on the Motion Audio website. If you have Central Tracks Unlimited, any song goes straight in; otherwise you buy the ones you don't have yet. They download here by themselves.</p>" +
          (pi ? '<div class="sl-qr" id="slQr"></div><p class="muted small">Scan it with your phone, or open <span style="user-select:all">' + esc(url) + "</span></p>" : '<div class="row"><button class="primary" data-sl="web">Open the website</button><span class="muted small" style="user-select:all">' + esc(url) + "</span></div>") +
          '<p class="sl-wait">' + (Date.now() < st.watchUntil ? "Watching for new songs…" : "") + " " + esc(st.msg || "") + "</p>" +
          '<p class="muted small">Your own tracks (stems you have, MultiTracks.com, a whole song to split) go in with <button data-sl="own">+ Add song</button> as always.</p>';
      } else {
        html += '<p class="muted">' + (online() ? "This setlist is only on this device. " : "") + "Add songs from your own files, MultiTracks.com, or Central Tracks:</p><div class=\"row\"><button class=\"primary\" data-sl=\"own\">Add songs</button></div>" +
          (!online() ? '<p class="muted small">Signed in to Central Tracks, a new setlist is kept on your church\'s account and Add songs opens the website.</p>' : "");
      }
    }
    if (st.msg && st.view !== "add") html += '<p class="sl-msg">' + esc(st.msg) + "</p>";
    body.innerHTML = html;
    var qr = $("#slQr");
    if (qr && window.qrcode) { try { var q = window.qrcode(0, "M"); q.addData(CT().base() + "/#setlist-" + encodeURIComponent(cloud().id)); q.make(); qr.innerHTML = q.createSvgTag({ cellSize: 4, margin: 2 }); } catch (_) { } }
  }

  // ------------------------------------------------------------------ actions
  function switchTo(name, slid, info) {
    remember();
    var p = PP.project();
    if (playing()) window.PPTracks.stop();
    p.songs = []; p.songIndex = -1; p.name = name; p.setlistId = slid;
    p.setlistCloud = info ? Object.assign({ local: slid }, info) : null;
    var nameEl = $("#projectName"); if (nameEl) nameEl.value = name;
    PP.persistNow(); F.loadSong(-1); F.renderSetlist(); F.renderPerformExtras(); line();
  }
  async function create() {
    var name = (($("#slName") || {}).value || "").trim(), day = (($("#slDay") || {}).value || "").trim();
    if (!name) { st.msg = "Give the setlist a name."; return paint(); }
    st.busy = true; st.msg = ""; paint();
    try {
      if (online()) {
        var r = await api("POST", "/setlists", { name: name, team: st.pick, serviceAt: day ? new Date(day + "T12:00:00").toISOString() : null });
        switchTo(r.setlist.name, "cl_" + r.setlist.id, { id: r.setlist.id, team: r.setlist.team, serviceAt: r.setlist.serviceAt });
        pushed[r.setlist.id] = sig();
      } else {
        switchTo(name, "p_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 9), null);
      }
      PP.setStatus("New setlist “" + name + "”");
      st.busy = false; st.view = "add"; st.name = ""; st.day = ""; addSongs();
    } catch (e) { st.busy = false; st.msg = e.message; paint(); }
  }
  async function openCloud(id) {
    remember();
    st.msg = ""; st.busy = true; paint();
    try {
      var r = await api("GET", "/setlists/" + encodeURIComponent(id)), s = r.setlist, slid = "cl_" + s.id;
      var local = driverOn() ? await dget("/sync/setlist/" + encodeURIComponent(slid)) : null;
      if (local && window.PPSync) { await window.PPSync.openSetlist(slid); var p = PP.project(); p.setlistCloud = { local: slid, id: s.id, team: s.team, serviceAt: s.serviceAt }; PP.persistSoon(); }
      else switchTo(s.name, slid, { id: s.id, team: s.team, serviceAt: s.serviceAt });
      await bringIn(s, true);
      st.busy = false; close();
      PP.setStatus("Opened “" + s.name + "”" + (st.notHere ? " · " + st.notHere + " song" + (st.notHere === 1 ? " isn't" : "s aren't") + " on this device yet" : ""));
    } catch (e) { st.busy = false; st.msg = "Couldn't open it: " + e.message; paint(); }
  }
  // the songs of the account's setlist that this device doesn't have in it yet: from this device's song library, or
  // downloaded from Central Tracks
  async function bringIn(s, firstTime) {
    var p = PP.project(), c = cloud(); if (!c || String(c.id) !== String(s.id)) return;
    var lib = firstTime && driverOn() ? ((await dget("/sync/songs")) || {}).songs || [] : null, notHere = 0;
    for (var i = 0; i < (s.songs || []).length; i++) {
      var x = s.songs[i];
      if (p.songs.some(function (y) { return (x.trackId && y.ctId === x.trackId) || (x.localId && y.id === x.localId); })) continue;
      var have = x.trackId && known[x.trackId] ? JSON.parse(JSON.stringify(known[x.trackId])) : null;
      if (!have && lib) {
        var hit = lib.filter(function (y) { return (x.localId && y.id === x.localId) || y.name === x.title; })[0];
        if (hit) have = await dget("/sync/song/" + encodeURIComponent(hit.id));
      }
      if (have) { p.songs.push(have); continue; }
      if (x.trackId) { await download(x); continue; }
      notHere++;
    }
    st.notHere = notHere;
    PP.persistSoon(); F.renderSetlist(); F.renderPerformExtras();
  }
  async function download(x) {
    if (st.importing[x.trackId]) return; st.importing[x.trackId] = true;
    try {
      st.msg = "Downloading " + x.title + "…"; if (isOpen()) paint();
      var j = await api("POST", "/tracks/" + encodeURIComponent(x.trackId) + "/add");
      await CT().install({ id: x.trackId, title: x.title, key: x.key, bpm: x.bpm, kind: x.kind || "Multitrack" }, j.files || []);
      st.msg = "✓ " + x.title + " is in the setlist.";
    } catch (e) { st.msg = x.title + ": " + e.message; }
    finally { delete st.importing[x.trackId]; if (isOpen()) paint(); }
  }
  function addSongs() {
    st.view = "add";
    var c = cloud();
    if (!(c && online())) { paint(); return; }
    st.watchUntil = Date.now() + 45 * 60000; paint(); check();
  }
  // while Add songs is open (and for a while after): what was added on the website comes down
  var checking = false;
  async function check() {
    var c = cloud(); if (checking || !c || !online()) return; checking = true;
    try { var r = await api("GET", "/setlists/" + encodeURIComponent(c.id)); if (cloud() && String(cloud().id) === String(r.setlist.id)) { cloud().team = r.setlist.team; await bringIn(r.setlist, false); } }
    catch (e) { st.msg = e.message; }
    finally { checking = false; line(); if (isOpen() && st.view === "add") paint(); }
  }
  setInterval(function () { if (Date.now() < st.watchUntil) check(); }, 4000);
  window.addEventListener("focus", function () { if (Date.now() < st.watchUntil) check(); });

  // what this device changes in an account setlist (order, songs taken out, songs added here) goes up to it
  function sig() { return JSON.stringify(PP.project().songs.map(function (s) { return [s.ctId || "", s.id, s.name]; })); }
  setInterval(async function () {
    remember();
    var c = cloud(); if (!c || !online()) return;
    var now = sig(); if (pushed[c.id] === now) return;
    var before = pushed[c.id] ? JSON.parse(pushed[c.id]) : [], ids = PP.project().songs.map(function (s) { return s.ctId; }).filter(Boolean);
    var removed = before.map(function (b) { return b[0]; }).filter(function (t) { return t && ids.indexOf(t) < 0; });
    pushed[c.id] = now;
    try { await api("POST", "/setlists/" + encodeURIComponent(c.id), { songs: PP.project().songs.map(function (s) { return { title: s.name, key: s.key, bpm: s.bpm, trackId: s.ctId || undefined, localId: s.id }; }), removed: removed }); }
    catch (e) { pushed[c.id] = null; }
  }, 5000);

  function onClick(e) {
    var b = e.target.closest("button"); if (!b) return;
    if (b.dataset.sl === "close") return close();
    if (b.dataset.slView) { st.view = b.dataset.slView; st.msg = ""; if (st.view === "add") return addSongs(); paint(); if (st.view === "load") loadLists(); if (st.view === "create") { st.pick = []; findPeople(st.find); } return; }
    if (b.dataset.slLocal) { if (window.PPSync) window.PPSync.openSetlist(b.dataset.slLocal).then(function () { close(); }); return; }
    if (b.dataset.slCloud) return openCloud(b.dataset.slCloud);
    if (b.dataset.slPick) { var x = st.people.filter(function (y) { return y.email === b.dataset.slPick; })[0]; if (x && st.pick.length < st.teamMax) st.pick.push(x); rememberForm(); return paint(); }
    if (b.dataset.slUnpick != null) { st.pick.splice(Number(b.dataset.slUnpick), 1); rememberForm(); return paint(); }
    if (b.dataset.sl === "create") return create();
    if (b.dataset.sl === "web") { var c = cloud(); if (c) { try { window.open(CT().base() + "/#setlist-" + encodeURIComponent(c.id), "_blank"); } catch (_) { } } return; }
    if (b.dataset.sl === "own" || b.dataset.sl === "signin") { close(); if (window.PPSources) window.PPSources.open(b.dataset.sl === "signin" ? "central" : undefined); if (b.dataset.sl === "signin" && CT() && CT().showSignIn) CT().showSignIn(); return; }
  }
  function rememberForm() { var n = $("#slName"), d = $("#slDay"); if (n) st.name = n.value; if (d) st.day = d.value; }
  var findTimer = 0;
  function onInput(e) {
    if (e.target.id === "slFind") { st.find = e.target.value; rememberForm(); clearTimeout(findTimer); findTimer = setTimeout(function () { findPeople(st.find).then(function () { var f = $("#slFind"); if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); } }); }, 250); }
  }
  function onChange(e) {
    if (e.target.id === "slRun") { if (F.sendToDriver) F.sendToDriver({ type: "tracksHost", action: "set", on: e.target.checked }); }
  }

  // the Setlist dialog gets the three buttons and a line about this setlist
  function wireSetlistDialog() {
    var d = $("#setlistDialog"); if (!d || $("#slButtons", d)) return;
    var bar = document.createElement("div"); bar.id = "slButtons"; bar.className = "sl-big";
    bar.innerHTML = '<button data-slx="load">Load setlist</button><button data-slx="create">Create new</button><button data-slx="add" class="primary">Add songs</button>';
    var info = document.createElement("p"); info.id = "slInfo"; info.className = "muted small";
    var rows = $("#setlistRows", d); d.insertBefore(bar, rows); d.insertBefore(info, rows);
    bar.addEventListener("click", function (e) { var b = e.target.closest("[data-slx]"); if (!b) return; d.close(); open(b.dataset.slx); });
    line();
  }
  wireSetlistDialog();
  window.PPSetlists = { open: open, cloud: cloud, check: check, where: whereText, state: st, bringIn: bringIn };
})();
