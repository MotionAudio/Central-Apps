/* Central Control - the page inside the app window: connection to the Central
 * Control (WebSocket + its small HTTP API), the chord chart with instrument
 * transposition / capo / Nashville, lyrics, and the lighting tab that turns
 * the Pi's MIDI events (hits, section notes, clock) into local MIDI output,
 * lined up with the Pi's clock. */
(function () {
  "use strict";
  var C = window.PPChords;
  function $(s) { return document.querySelector(s); }
  function esc(s) { return C.esc(s); }
  // preferences that follow the person's account (the church's device and the one at home match); this computer's
  // own things - the pedal's address, PINs, audio and MIDI devices, the light rig, timing offsets - stay here
  var SYNCED = ["instrument", "shapes", "nashville", "chordsOnly", "fontSize", "lyricsSize", "lyricsNext", "part", "partView", "iaMix", "mxSel", "mxAll", "lxView", "lxRight", "vidView", "vidBus", "tbGroup", "tbTargets", "tbDim", "aiUse", "slides", "svcSel", "recName"];
  function syncName() { return EDITION === "usage" ? "usage" : "control"; }
  var store = { get: function (k, d) { try { var v = localStorage.getItem("cu-" + k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } }, set: function (k, v) { try { localStorage.setItem("cu-" + k, JSON.stringify(v)); } catch (_) { } if (SYNCED.indexOf(k) >= 0 && window.PPLicense && window.PPLicense.settingsChanged) window.PPLicense.settingsChanged(syncName()); } };
  // opened in a browser from the Central Pedal (http://<pi>:8080/cu/ - iPhone, iPad, any phone): users only, and it
  // talks to the Central Pedal it came from. The app (window.CU) has everything.
  var WEB = !window.CU && /^https?:$/.test(location.protocol);
  // (opened from the main admin's computer - :8095 - the Central Pedal's address comes from the center: center-link.js)
  if (WEB) { if (!location.port || location.port === "8080") { try { localStorage.setItem("cu-host", JSON.stringify(location.hostname)); } catch (_) { } } document.documentElement.dataset.web = "1"; }
  var prefs = { host: store.get("host", "padpedal.local"), code: store.get("code", ""), instrument: store.get("instrument", "concert"), shapes: store.get("shapes", "auto"), nashville: store.get("nashville", false), chordsOnly: store.get("chordsOnly", false), fontSize: store.get("fontSize", 18), lyricsSize: store.get("lyricsSize", 44), lyricsNext: store.get("lyricsNext", true), midiOut: store.get("midiOut", ""), sendClock: store.get("sendClock", true), offsetMs: store.get("offsetMs", 0), follow: true, tab: store.get("tab", "chart") };

  // ------------------------------------------------------------- connection
  var state = { connected: false, authed: false, hostname: "", display: null, wsPort: 8081, offset: null, rtt: null, clock: null, pickedSong: -1, interfaces: [], audioHost: null, netAudio: null, appVersion: "" };
  // ---- a tiny event bus for the tab modules (mix, in-ears, slides, lights, I/O, settings)
  var bus = {};
  function on(type, fn) { (bus[type] = bus[type] || []).push(fn); }
  function fire(type, a, b) { (bus[type] || []).forEach(function (fn) { try { fn(a, b); } catch (e) { console.warn("listener", type, e); } }); }
  // ---- this computer's role: the main admin (one), admins, User 1 and User 2 - which tabs it has.
  // mode() is the side (admin / user) the tab modules check; role() is the exact role.
  var MODES = { main: ["devices", "service", "lights", "mix", "inears", "lyrics", "slides", "video", "io", "settings"], admin: ["lights", "mix", "inears", "lyrics", "slides", "video", "io", "settings"],
    user1: ["chart", "instrument", "lyrics", "inears", "io", "settings"], user2: ["lyrics", "chart", "inears", "settings"] };
  // an admin's jobs (given by the main admin): only those tabs, or General = every admin tab
  var JOB_TABS = { lighting: ["lights"], production: ["video"], mix: ["mix"], inears: ["inears"], slides: ["slides", "lyrics"] };
  var JOB_NAMES = { general: "Everything (production manager)", lighting: "Lighting", production: "Production (cameras)", mix: "Mix", inears: "In-ears", slides: "Slides & lyrics" };
  function jobs() { var j = cuCfg.jobs; return Array.isArray(j) && j.length && j.indexOf("general") < 0 ? j.filter(function (x) { return JOB_TABS[x]; }) : ["general"]; }
  function tabsFor(r) {
    var hide = window.CULock && window.CULock.hiddenTabs ? window.CULock.hiddenTabs() : [];   // the main admin's service lock
    var keep = function (list) { return hide.length ? list.filter(function (t) { return hide.indexOf(t) < 0; }) : list; };
    if (WEB) return keep(MODES[r === "user2" ? "user2" : "user1"].filter(function (t) { return t !== "instrument" && t !== "io"; }));   // a phone / tablet browser: the user side, no native parts
    if (r !== "admin" && r !== "main") return keep(MODES[r]);
    // admins - and the main admin too - work by their jobs: everything (production manager), or only lighting, mix…
    var j = jobs(); if (j[0] === "general") return keep(MODES[r]);
    var want = {}; j.forEach(function (x) { JOB_TABS[x].forEach(function (t) { want[t] = 1; }); });
    return keep(MODES[r].filter(function (t) { return want[t] || t === "io" || t === "settings" || t === "devices" || t === "service"; }));
  }
  var ROLE_NAMES = { main: "Main admin", admin: "Admin", user1: "User 1", user2: "User 2" };
  // which app this is: Central Control (the main admin and admins) or Central Usage (musicians: User 1 / User 2 -
  // also every phone and tablet opening it from the main admin's computer, and the iPhone / iPad / Android apps)
  var EDITION = (window.CU && window.CU.edition) || (function () { var q = null; try { q = new URLSearchParams(location.search).get("edition"); } catch (_) { } return q === "usage" || q === "control" ? q : WEB ? "usage" : "all"; })();   // ("all": a plain page from the files - tests)
  // two apps: Central Control is for the main admin and admins, Central Usage for the musicians (User 1 / User 2)
  function roleAllowed(r) { if (r === null) return true; if (EDITION === "usage") return r === "user1" || r === "user2"; if (EDITION === "control") return r === "main" || r === "admin"; return true; }
  var cuCfg = { mode: store.get("mode", null), role: store.get("role", null), jobs: store.get("jobs", null), name: store.get("name", "") };
  function role() {
    var r = cuCfg.role;
    if (MODES[r]) return r;
    return cuCfg.mode === "admin" ? "admin" : cuCfg.mode === "user" ? "user1" : null;   // a computer set up before roles
  }
  function mode() { var r = role(); return r === "main" || r === "admin" ? "admin" : r ? "user" : null; }
  function applyMode() {
    var r = role() || "user1", m = mode() || "user", allowed = tabsFor(r);
    document.body.dataset.mode = m; document.body.dataset.role = r;
    document.querySelectorAll("#tabs [data-tab]").forEach(function (b) { b.hidden = allowed.indexOf(b.dataset.tab) < 0; });
    if (allowed.indexOf(prefs.tab) < 0) showTab(allowed[0]);
    send({ type: "client", app: "central-usage", edition: EDITION, mode: m, role: r, name: cuCfg.name || (EDITION === "usage" ? "Central Usage" : "Central Control") });
    fire("mode", m); fire("role", r);
  }
  async function setRole(r) {
    if (!MODES[r] && r !== null) return;
    if (!roleAllowed(r)) { if (window.CURoles && window.CURoles.toast) window.CURoles.toast(EDITION === "control" ? ROLE_NAMES[r] + " is in Central Usage, the musicians' app. This is Central Control, for the main admin and admins." : ROLE_NAMES[r] + " needs Central Control - this is Central Usage, for musicians (User 1 / User 2)."); return; }
    cuCfg.role = r; cuCfg.mode = r ? (r === "main" || r === "admin" ? "admin" : "user") : null;
    store.set("role", r); store.set("mode", cuCfg.mode);
    if (window.CU && window.CU.config) { try { cuCfg = await window.CU.config.set({ role: r }); } catch (_) { } }
    var pick = document.getElementById("modePick"); if (pick && r && !pick.dataset.keep) pick.remove();   // (the main admin's setup keeps going)
    if (r) applyMode(); else askMode();
  }
  async function setJobs(j) {
    cuCfg.jobs = j; store.set("jobs", j);
    if (window.CU && window.CU.config) { try { cuCfg = await window.CU.config.set({ jobs: j }); } catch (_) { } }
    applyMode();
  }
  function setMode(m) { return setRole(m === "admin" ? "admin" : m === "user" ? "user1" : m); }
  function askMode() { if (window.CURoles) window.CURoles.firstLaunch(); }
  var socket = null, retryTimer = 0, pingTimer = 0, httpBase = "";
  function api(p) { return httpBase + "/api" + p; }
  function setConn(txt, cls) { $("#connInfo").textContent = txt; $("#dot").className = "dot" + (cls ? " " + cls : ""); }
  function connect(host) {
    if (host) { prefs.host = host; store.set("host", host); }
    host = prefs.host || "padpedal.local"; $("#host").value = host;
    httpBase = "http://" + host + ":8080";
    clearTimeout(retryTimer); if (socket) { try { socket.onclose = null; socket.close(); } catch (_) { } socket = null; }
    setConn("connecting to " + host + "…", "warn");
    fetch(api("/info"), { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (j) { if (j.wsPort) state.wsPort = j.wsPort; state.hostname = j.hostname || host; open(host); }).catch(function () { open(host); });
  }
  function open(host) {
    try { socket = new WebSocket("ws://" + host + ":" + state.wsPort); } catch (_) { retryTimer = setTimeout(function () { connect(); }, 3000); return; }
    socket.onopen = function () { state.connected = true; setConn("connected to " + (state.hostname || host), ""); send({ type: "client", app: "central-usage", mode: mode() || "user", role: role() || "user1", name: cuCfg.name || "Central Control" }); if (prefs.code) send({ type: "auth", code: prefs.code }); clearInterval(pingTimer); pingTimer = setInterval(ping, 2000); ping(); fire("connected", true); };
    socket.onmessage = function (e) { var m; try { m = JSON.parse(e.data); } catch (_) { return; } if (window.CUCenter && (FROM_CENTER_ONLY[m.type] || (m.type === "audioHost" && CUCenter.connected()))) return; if (m.type === "hello" && window.CUCenter && CUCenter.connected()) m.audioHost = state.audioHost; onMessage(m); };
    socket.onclose = function () { state.connected = false; state.authed = false; setConn("lost " + host + " - retrying", "off"); clearInterval(pingTimer); retryTimer = setTimeout(function () { connect(); }, 2500); fire("connected", false); };
  }
  // roles, devices, locks and services belong to the center (the main admin): an older Central Pedal's own copy is ignored
  var FROM_CENTER_ONLY = { cuRoles: 1, cuRoleReply: 1, cuRoleAssigned: 1, services: 1, serviceReply: 1, pairCodeChanged: 1 };
  function send(m) { if (socket && socket.readyState === 1) { socket.send(JSON.stringify(m)); return true; } return false; }
  // Only the Central Pedal plays, stops and moves the tracks: from here only the lyrics can be paged
  function action(name, args) { if (["lyricsNext", "lyricsPrev"].indexOf(name) < 0) return; if (!state.authed && !prefs.code) { askCode(); if (!prefs.code) return; } send({ type: "action", name: name, args: args || {}, code: prefs.code }); }
  // a small text question in the page (Electron has no window.prompt)
  function askText(label, value) {
    return new Promise(function (resolve) {
      var d = document.createElement("dialog"); d.className = "ask";
      d.innerHTML = '<form method="dialog"><label>' + esc(label) + '<input name="v" autocomplete="off"></label><div class="row"><button value="cancel" type="button" data-x>Cancel</button><button class="primary" value="ok">OK</button></div></form>';
      document.body.appendChild(d); var inp = d.querySelector("input"); inp.value = value || "";
      d.querySelector("[data-x]").addEventListener("click", function () { d.close("cancel"); });
      d.addEventListener("close", function () { var ok = d.returnValue === "ok"; resolve(ok ? inp.value : null); d.remove(); });
      d.showModal(); inp.focus(); inp.select();
    });
  }
  async function askCode() { var v = await askText("Pairing PIN of the Central Pedal (the 4 digits picked on it - shown in its Settings → Wi-Fi & devices):", prefs.code || ""); if (v == null) return; prefs.code = v.trim(); store.set("code", prefs.code); if (prefs.code) send({ type: "auth", code: prefs.code }); }
  // clock sync: NTP-style; keep the lowest-latency sample
  function ping() { send({ type: "ping", t: performance.now() }); }
  function onPong(m) {
    var now = performance.now(), rtt = now - (m.t || now), offset = m.serverT - (m.t + rtt / 2);   // Pi clock = local + offset
    if (state.rtt == null || rtt <= state.rtt * 1.2 || now - (state.syncAt || 0) > 30000) { state.rtt = rtt; state.offset = offset; state.syncAt = now; }
    if (m.clock) onClock(m.clock);
    $("#liveSync").textContent = Math.round(state.rtt) + " ms";
  }
  function piToLocal(piMs) { return state.offset == null ? performance.now() : piMs - state.offset; }

  function onMessage(m) {
    if (m.type === "hello") { state.hostname = m.hostname || state.hostname; state.interfaces = m.interfaces || []; state.audioHost = m.audioHost || null; state.netAudio = m.netAudio || null; state.appVersion = m.appVersion || ""; setConn("connected to " + state.hostname, ""); fire("hello", m); fire("audioHost", state.audioHost); }
    else if (m.type === "auth") { var was = state.authed; state.authed = !!m.ok; if (!m.ok && prefs.code && !m.for) { prefs.code = ""; store.set("code", ""); alert("That pairing code was refused. Check it in Central Pedal → Settings."); } if (state.authed && !was) fire("authed", true); }
    else if (m.type === "audioHost") { state.audioHost = m.host || null; fire("audioHost", state.audioHost); }
    else if (m.type === "hub") fire("hub", m);
    else if (m.type === "refused") fire("refused", m);
    else if (m.type === "display") { if (m.sheet !== undefined) state.sheet = m.sheet; state.display = m; render(); }   // (the song's sheet only comes when it changes)
    else if (m.type === "pong") onPong(m);
    else if (m.type === "midi") onMidi(m);
    else if (m.type === "clock") onClock(m);
    if (window.CULights) window.CULights.onMessage(m);
    fire("message", m);
    if (m.type === "display" && m.song && window.CUTimecode) window.CUTimecode.setSong(m.song.index);
  }

  // ------------------------------------------------------------- tabs
  function showTab(name) { var r = role(); if (r && tabsFor(r).indexOf(name) < 0) name = tabsFor(r)[0]; prefs.tab = name; store.set("tab", name); fire("tab", name); document.querySelectorAll(".tab").forEach(function (b) { b.classList.toggle("active", b.dataset.tab === name); }); document.querySelectorAll(".view").forEach(function (v) { v.classList.toggle("active", v.id === "view-" + name); }); if (name === "lights") { initMidi(); if (window.CULights) window.CULights.renderAll(); } }
  $("#tabs").addEventListener("click", function (e) { var b = e.target.closest("[data-tab]"); if (b) showTab(b.dataset.tab); });

  // ------------------------------------------------------------- chart
  var chartId = null, chartInfo = null, parsed = null, lastSectionKey = null, lastSongKey = null, lastSheetText = "";
  // the song the Central Pedal is on, as its sheet: the chart text with every section edit, key change and new chart
  // already in it (a chart file is only used when the sheet has no chart, e.g. a PDF)
  function sheetText() { var d = state.display, sh = state.sheet; if (!prefs.follow || !d || !sh || !window.PPSheets || !d.songId || sh.id !== d.songId) return ""; return window.PPSheets.textOf(sh) || ""; }
  function fillInstruments() {
    var sel = $("#instrument"); sel.innerHTML = C.INSTRUMENTS.map(function (i) { return '<option value="' + i.id + '"' + (prefs.instrument === i.id ? " selected" : "") + ">" + esc(i.name) + "</option>"; }).join("");
    fillShapes();
  }
  function fillShapes() { var inst = C.instrument(prefs.instrument), sel = $("#shapes"); $("#shapesWrap").style.display = inst.capo ? "" : "none"; if (!inst.capo) return; sel.innerHTML = '<option value="auto">Auto (fewest capo frets)</option>' + inst.shapes.map(function (s) { return '<option value="' + s + '"' + (prefs.shapes === s ? " selected" : "") + ">" + esc(C.pretty(s)) + " shapes</option>"; }).join(""); }
  function currentSong() { var d = state.display; if (!d) return null; var songs = d.songs || []; if (prefs.follow) return d.song ? Object.assign({ index: d.song.index }, songs[d.song.index] || {}, d.song) : null; return state.pickedSong >= 0 ? Object.assign({ index: state.pickedSong }, songs[state.pickedSong]) : null; }
  function songKeyNow() { var d = state.display, s = currentSong(); if (!s) return "C"; return (prefs.follow && d && d.key) ? d.key : s.key || "C"; }
  window.CentralUsageChartText = function () { return chartInfo && chartInfo.text || ""; };   // for the parts (parts-tab.js)
  async function loadChart(id) {
    chartId = id; chartInfo = null; parsed = null; lastSectionKey = null;
    if (!id) { $("#chart").innerHTML = '<div class="empty">This song has no chord chart yet.<br><small>In Central Pedal: song editor → "Listen &amp; write chord chart", or upload a text / PDF chart.</small></div>'; $("#written").textContent = ""; return; }
    try { var r = await fetch(api("/charts/" + encodeURIComponent(id) + "/chart.json"), { cache: "no-store" }); chartInfo = await r.json(); } catch (_) { chartInfo = null; }
    if (!chartInfo || chartId !== id) { $("#chart").innerHTML = '<div class="empty">Could not load the chart.</div>'; return; }
    if (chartInfo.text) parsed = C.parseChart(chartInfo.text);
    renderChart();
  }
  function renderChart() {
    var s = currentSong(), root = $("#chart");
    if (!chartInfo) return;
    if (parsed && parsed.sections.length) {
      var chartKey = parsed.key || chartInfo.key || songKeyNow(), v = C.view({ chartKey: chartKey, songKey: songKeyNow(), instrument: prefs.instrument, shape: prefs.shapes, nashville: prefs.nashville });
      root.innerHTML = C.renderChart(parsed, { view: v, chordsOnly: prefs.chordsOnly });
      var w = v.instrument.capo ? (v.capo ? "Capo " + v.capo + " · " + C.pretty(v.shapeKey) + " shapes" : "No capo · " + C.pretty(v.shapeKey) + " shapes") : v.instrument.shift ? "Sounds in " + C.pretty(songKeyNow()) + " · written in " + C.pretty(v.writtenKey) : "Key " + C.pretty(songKeyNow()) + (chartKey !== songKeyNow() ? " (chart was in " + C.pretty(chartKey) + ")" : "");
      $("#written").textContent = prefs.nashville ? "Numbers in " + C.pretty(songKeyNow()) : w;
    } else if (chartInfo.pageCount > 0) {
      var html = '<div class="pages">'; for (var n = 1; n <= chartInfo.pageCount; n++) html += '<div class="pg" data-page="' + n + '"><img src="' + api("/charts/" + encodeURIComponent(chartId) + "/page-" + n + ".png") + '" alt="page ' + n + '"></div>';
      root.innerHTML = html + "</div>"; $("#written").textContent = "PDF chart: shown as is (text charts can be transposed)";
    } else root.innerHTML = '<div class="empty">Empty chart.</div>';
    lastSectionKey = null; highlightSection();
  }
  function highlightSection() {
    var d = state.display; if (!d || !prefs.follow) return;
    var cur = d.section ? d.section.index : -1, page = d.chart ? d.chart.page : 0, key = cur + ":" + page; if (key === lastSectionKey) return; lastSectionKey = key;
    var el = null, name = d.section ? d.section.name : null, nextName = d.sections && cur + 1 < d.sections.length ? d.sections[cur + 1].name : null;
    document.querySelectorAll("#chart .csec").forEach(function (sec) { var same = name && norm(sec.dataset.name) === norm(name); sec.classList.toggle("current", !!same); sec.classList.toggle("next", !!(nextName && norm(sec.dataset.name) === norm(nextName) && !same)); if (same && !el) el = sec; });
    document.querySelectorAll("#chart .pg").forEach(function (pg) { var same = Number(pg.dataset.page) === Math.max(1, page || 1); pg.classList.toggle("current", same); if (same && !el) el = pg; });
    if (el) el.scrollIntoView({ block: "start", behavior: "smooth" });
  }
  function norm(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
  function render() {
    var d = state.display; if (!d) return;
    var songs = d.songs || [], s = currentSong();
    $("#songName").textContent = s ? (s.index + 1) + ". " + s.name : (songs.length ? "No song selected" : "No songs yet");
    $("#songMeta").textContent = s ? C.pretty(songKeyNow()) + " · " + (d.bpm || s.bpm || "–") + " BPM" + (d.section && prefs.follow ? " · " + d.section.name : "") + (d.tracksMode ? (d.playing ? " · ▶ " : " · ❚❚ ") + fmtTime(d.pos) : "") : "";
    var pick = $("#songPick"), names = songs.map(function (q) { return q.name; }).join("|"); if (pick.dataset.names !== names) { pick.dataset.names = names; pick.innerHTML = '<option value="-1">— follow the Central Pedal —</option>' + songs.map(function (q, i) { return '<option value="' + i + '">' + (i + 1) + ". " + esc(q.name) + "</option>"; }).join(""); } pick.value = String(prefs.follow ? -1 : state.pickedSong);
    var secs = prefs.follow ? (d.sections || []) : [], cur = d.section ? d.section.index : -1, skey = secs.map(function (q) { return q.name; }).join("|") + "#" + cur;
    if ($("#sections").dataset.key !== skey) { $("#sections").dataset.key = skey; $("#sections").innerHTML = secs.map(function (q, i) { return '<button data-sec="' + i + '" class="' + (i === cur ? "current" : i === cur + 1 ? "next" : "") + '">' + esc(q.name) + "</button>"; }).join(""); var cb = $("#sections .current"); if (cb) cb.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" }); }
    var want = s && s.chart ? (s.chart.id || s.chart) : null; if (typeof want === "object" && want) want = want.id;
    var st = sheetText();
    if (st) {
      if (st !== lastSheetText || lastSongKey !== (s && s.name + "|" + songKeyNow())) { lastSheetText = st; lastSongKey = s && s.name + "|" + songKeyNow(); chartId = want; chartInfo = { text: st, pageCount: 0, key: state.sheet.origKey || state.sheet.key }; parsed = C.parseChart(st); renderChart(); }
    } else if (lastSheetText || want !== chartId || lastSongKey !== (s && s.name + "|" + songKeyNow())) { var was = lastSheetText; lastSheetText = ""; lastSongKey = s && s.name + "|" + songKeyNow(); if (want !== chartId || was) loadChart(want); else renderChart(); }
    highlightSection(); renderLyrics();
    $("#liveBpm").textContent = d.bpm || "–"; $("#liveBar").textContent = d.bar || "–";
  }
  function fmtTime(t) { t = Math.max(0, t || 0); var m = Math.floor(t / 60), s = Math.floor(t % 60); return m + ":" + (s < 10 ? "0" : "") + s; }

  // ------------------------------------------------------------- lyrics
  function renderLyrics() {
    var d = state.display, root = $("#lyrics"); if (!d) return;
    var ls = d.lyrics || { lines: [], next: [], section: "" }, lines = ls.lines || [], next = prefs.lyricsNext ? (ls.next || []) : [];
    if (!lines.length && parsed && d.section) { var sec = C.lyricsOf(parsed).filter(function (q) { return norm(q.name) === norm(d.section.name); })[0]; if (sec) lines = sec.lines.slice(0, 6); }
    if (!lines.length && !ls.section) { root.innerHTML = '<div class="empty">' + (d.song ? "No lyrics for this part." : "Pick a song on the Central Pedal.") + "</div>"; return; }
    root.innerHTML = '<div class="sec">' + esc(ls.section || (d.section ? d.section.name : "")) + "</div>" + lines.map(function (l) { return '<div class="line">' + esc(l) + "</div>"; }).join("") + (next.length ? '<div class="next">' + next.map(esc).join("<br>") + "</div>" : "");
  }

  // ------------------------------------------------------------- lighting (Web MIDI out)
  var midi = null, outPort = null, clock = { bpm: null, running: false, timer: 0, nextTick: 0, piT: 0 }, logLines = [];
  function log(s) { logLines.push(new Date().toLocaleTimeString() + "  " + s); if (logLines.length > 80) logLines.shift(); var el = $("#log"); if (el) { el.textContent = logLines.join("\n"); el.scrollTop = el.scrollHeight; } }
  async function initMidi() {
    if (midi) return;
    if (!navigator.requestMIDIAccess) { $("#midiState").textContent = "Web MIDI is not available in this build."; return; }
    try { midi = await navigator.requestMIDIAccess({ sysex: true }).catch(function () { return navigator.requestMIDIAccess({ sysex: false }); }); midi.sysexOk = !!midi.sysexEnabled; } catch (error) { $("#midiState").textContent = "MIDI access refused: " + error.message; return; }
    midi.onstatechange = fillPorts; fillPorts();
  }
  function fillPorts() {
    var sel = $("#midiOut"), ports = []; midi.outputs.forEach(function (p) { ports.push(p); });
    sel.innerHTML = '<option value="">— choose a port —</option>' + ports.map(function (p) { return '<option value="' + esc(p.id) + '"' + (prefs.midiOut === p.id ? " selected" : "") + ">" + esc(p.name) + (p.manufacturer ? " (" + esc(p.manufacturer) + ")" : "") + "</option>"; }).join("");
    outPort = ports.filter(function (p) { return p.id === prefs.midiOut; })[0] || null;
    $("#midiState").textContent = ports.length ? (outPort ? "Sending to " + outPort.name + "." : ports.length + " MIDI output" + (ports.length > 1 ? "s" : "") + " found - choose one.") : "No MIDI outputs found. Plug in a USB MIDI interface, or make a virtual port (Linux: a2jmidid / 'snd-virmidi'; Mac: IAC bus).";
  }
  function midiSend(data, at) { if (!outPort) return; try { outPort.send(data, at); } catch (_) { try { outPort.send(data); } catch (__) { } } }
  function onMidi(m) {
    var base = piToLocal(m.t) + (prefs.offsetMs || 0), now = performance.now();
    (m.messages || []).forEach(function (msg) {
      var when = base + (msg.at || 0), d = msg.data || []; if (!d.length) return;
      if (when < now - 1500) return; // too stale to matter
      midiSend(d, Math.max(now, when));
      var st = d[0] & 0xF0, ch = (d[0] & 0x0F) + 1;
      if (st === 0x90 && d[2] > 0) { var delay = Math.max(0, when - now); setTimeout(function () { flash(ch === 1 && d[1] < 60 ? "hit" : "note"); }, delay); log("note " + d[1] + " vel " + d[2] + " ch " + ch + (delay > 1 ? " in " + Math.round(delay) + " ms" : "")); }
      else if (st === 0xC0) log("program " + d[1] + " ch " + ch);
    });
  }
  function flash(kind) { var el = $("#hitLight"); if (kind === "hit") { el.classList.add("on"); setTimeout(function () { el.classList.remove("on"); }, 160); } else { var b = $("#beatLight"); b.classList.add("on"); setTimeout(function () { b.classList.remove("on"); }, 90); } }
  // MIDI clock: 24 ppq generated here from the Pi's tempo + transport, on the local clock
  function onClock(c) {
    if (!c) return; var was = clock.running; clock.bpm = c.bpm || clock.bpm; clock.running = !!c.running; clock.piT = c.t;
    $("#liveBpm").textContent = clock.bpm ? Math.round(clock.bpm) : "–";
    if (clock.running && !was) startClock(); else if (!clock.running && was) stopClock();
  }
  function startClock() {
    if (!prefs.sendClock || !outPort) return;
    midiSend([0xFA]); clock.nextTick = performance.now() + 10; clock.ticks = 0; clearInterval(clock.timer);
    clock.timer = setInterval(function () { if (!clock.bpm) return; var interval = 60000 / clock.bpm / 24, now = performance.now(); while (clock.nextTick < now + 40) { midiSend([0xF8], clock.nextTick); clock.nextTick += interval; if (++clock.ticks % 24 === 0) { var d = clock.nextTick - now; setTimeout(function () { var b = $("#beatLight"); b.classList.add(clock.ticks % 96 === 0 ? "down" : "on"); setTimeout(function () { b.classList.remove("on"); b.classList.remove("down"); }, 90); }, Math.max(0, d)); } } }, 20);
    log("MIDI clock started at " + Math.round(clock.bpm) + " BPM");
  }
  function stopClock() { clearInterval(clock.timer); clock.timer = 0; midiSend([0xFC]); log("MIDI clock stopped"); }

  // ------------------------------------------------------------- discovery
  async function discover() {
    var d = $("#findDialog"), list = $("#findList"); list.innerHTML = '<p class="muted">Looking on this Wi-Fi… (a few seconds)</p>'; if (!d.open) d.showModal();
    var found = window.CU ? await window.CU.discover() : [];
    list.innerHTML = found.length ? found.map(function (f) { return '<button data-host="' + esc(f.host) + '"><b>' + esc(f.hostname) + "</b><small>" + esc(f.host) + (f.ip ? " (" + esc(f.ip) + ")" : "") + " · Central Pedal v" + esc(f.version || "?") + "</small></button>"; }).join("") : '<p class="muted">None found. Is this computer on the same Wi-Fi as the Central Pedal? You can also type its address (padpedal.local or its IP, shown in Central Pedal → Settings → Wi-Fi).</p>';
  }

  // ------------------------------------------------------------- wiring
  function wire() {
    $("#host").value = prefs.host; $("#fontSize").value = prefs.fontSize; $("#lyricsSize").value = prefs.lyricsSize; $("#lyricsNext").checked = prefs.lyricsNext; $("#nashville").checked = prefs.nashville; $("#chordsOnly").checked = prefs.chordsOnly; $("#sendClock").checked = prefs.sendClock; $("#offsetMs").value = prefs.offsetMs; $("#offsetOut").textContent = prefs.offsetMs + " ms";
    document.documentElement.style.setProperty("--chart-size", prefs.fontSize + "px"); document.documentElement.style.setProperty("--lyrics-size", prefs.lyricsSize + "px");
    $("#connectBtn").addEventListener("click", function () { connect($("#host").value.trim() || "padpedal.local"); }); $("#host").addEventListener("keydown", function (e) { if (e.key === "Enter") $("#connectBtn").click(); });
    $("#findBtn").addEventListener("click", discover); $("#findAgain").addEventListener("click", discover); $("#findClose").addEventListener("click", function () { $("#findDialog").close(); });
    $("#findList").addEventListener("click", function (e) { var b = e.target.closest("[data-host]"); if (b) { $("#findDialog").close(); connect(b.dataset.host); } });
    $("#codeBtn").addEventListener("click", askCode);
    $("#follow").addEventListener("change", function (e) { prefs.follow = e.target.checked; render(); }); $("#songPick").addEventListener("change", function (e) { state.pickedSong = Number(e.target.value); prefs.follow = state.pickedSong < 0; $("#follow").checked = prefs.follow; render(); });
    $("#instrument").addEventListener("change", function (e) { prefs.instrument = e.target.value; store.set("instrument", prefs.instrument); fillShapes(); renderChart(); });
    $("#shapes").addEventListener("change", function (e) { prefs.shapes = e.target.value; store.set("shapes", prefs.shapes); renderChart(); });
    $("#nashville").addEventListener("change", function (e) { prefs.nashville = e.target.checked; store.set("nashville", prefs.nashville); renderChart(); });
    $("#chordsOnly").addEventListener("change", function (e) { prefs.chordsOnly = e.target.checked; store.set("chordsOnly", prefs.chordsOnly); renderChart(); });
    $("#fontSize").addEventListener("input", function (e) { prefs.fontSize = Number(e.target.value); store.set("fontSize", prefs.fontSize); document.documentElement.style.setProperty("--chart-size", prefs.fontSize + "px"); });
    $("#lyricsSize").addEventListener("input", function (e) { prefs.lyricsSize = Number(e.target.value); store.set("lyricsSize", prefs.lyricsSize); document.documentElement.style.setProperty("--lyrics-size", prefs.lyricsSize + "px"); });
    $("#lyricsNext").addEventListener("change", function (e) { prefs.lyricsNext = e.target.checked; store.set("lyricsNext", prefs.lyricsNext); renderLyrics(); });
    $("#lyricsPrev").addEventListener("click", function () { action("lyricsPrev"); }); $("#lyricsNextBtn").addEventListener("click", function () { action("lyricsNext"); });
    // the section buttons show where the song is; they don't move it (only the Central Pedal does)
    $("#midiOut").addEventListener("change", function (e) { prefs.midiOut = e.target.value; store.set("midiOut", prefs.midiOut); fillPorts(); if (clock.running) startClock(); });
    $("#sendClock").addEventListener("change", function (e) { prefs.sendClock = e.target.checked; store.set("sendClock", prefs.sendClock); if (!prefs.sendClock) stopClock(); else if (clock.running) startClock(); });
    $("#offsetMs").addEventListener("input", function (e) { prefs.offsetMs = Number(e.target.value); store.set("offsetMs", prefs.offsetMs); $("#offsetOut").textContent = prefs.offsetMs + " ms"; });
    $("#testHit").addEventListener("click", function () { midiSend([0x90, 48, 127]); setTimeout(function () { midiSend([0x80, 48, 0]); }, 120); flash("hit"); log("test hit"); });
    $("#testSection").addEventListener("click", function () { midiSend([0x90, 60, 100]); setTimeout(function () { midiSend([0x80, 60, 0]); }, 120); flash("note"); log("test section note 60"); });
    $("#panic").addEventListener("click", function () { for (var ch = 0; ch < 16; ch++) midiSend([0xB0 | ch, 123, 0]); log("all notes off"); });
    document.addEventListener("keydown", function (e) { if (e.target.matches("input,select,textarea")) return; if (e.key === "F1") showTab("chart"); else if (e.key === "F2") showTab("lyrics"); else if (e.key === "F3") showTab("lights"); else if (e.key === "ArrowRight" || e.key === "PageDown") { if (prefs.tab === "lyrics") action("lyricsNext"); } else if (e.key === "ArrowLeft" || e.key === "PageUp") { if (prefs.tab === "lyrics") action("lyricsPrev"); } });
    if (window.CU && window.CU.onMenu) window.CU.onMenu(function (name, arg) { if (name === "connect") { askText("Central Pedal address (padpedal.local or its IP):", prefs.host).then(function (h) { if (h) connect(h.trim()); }); } else if (name === "discover") discover(); else if (name === "code") askCode(); else if (name === "updates" && window.CUUpdates) window.CUUpdates.open(); else if (name === "tab") showTab(arg); else if (name === "font") { var el = prefs.tab === "lyrics" ? $("#lyricsSize") : $("#fontSize"); el.value = Number(el.value) + arg * 2; el.dispatchEvent(new Event("input")); } });
  }
  fillInstruments(); wire(); showTab(prefs.tab); connect(); initMidi();
  (async function () {   // this computer's settings live in the app (cu.json); in a plain browser: local storage
    if (window.CU && window.CU.config) { try { var c = await window.CU.config.get(); if (c) { cuCfg = c; if (c.mode) store.set("mode", c.mode); if (c.role) store.set("role", c.role); if (c.jobs) store.set("jobs", c.jobs); } } catch (_) { } }
    if (!cuCfg.name) cuCfg.name = store.get("name", "") || "Central Control";
    if (!role()) askMode(); applyMode(); fire("ready");
  })();
  function syncedPrefs() { var o = {}; SYNCED.forEach(function (k) { var v = store.get(k, undefined); if (v !== undefined) o[k] = v; }); return o; }
  function applySyncedPrefs(d) {
    SYNCED.forEach(function (k) { if (!d || !(k in d)) return; try { localStorage.setItem("cu-" + k, JSON.stringify(d[k])); } catch (_) { } if (k in prefs) prefs[k] = d[k]; });
    try {
      $("#fontSize").value = prefs.fontSize; $("#lyricsSize").value = prefs.lyricsSize; $("#lyricsNext").checked = prefs.lyricsNext; $("#nashville").checked = prefs.nashville; $("#chordsOnly").checked = prefs.chordsOnly;
      document.documentElement.style.setProperty("--chart-size", prefs.fontSize + "px"); document.documentElement.style.setProperty("--lyrics-size", prefs.lyricsSize + "px");
      if ($("#instrument")) $("#instrument").value = prefs.instrument; fillShapes(); renderChart(); render();
    } catch (_) { }
    fire("prefsSynced", d);
  }
  window.CentralUsage = { state: state, prefs: prefs, syncedPrefs: syncedPrefs, applySyncedPrefs: applySyncedPrefs, syncName: syncName, connect: connect, render: render, onMessage: onMessage, piToLocal: piToLocal, action: action, send: send, api: api, askCode: askCode, on: on, fire: fire, mode: mode, role: role, roleName: function (r) { return ROLE_NAMES[r || role()] || ""; }, edition: function () { return EDITION; }, appName: EDITION === "usage" ? "Central Usage" : "Central Control", roleAllowed: roleAllowed, setRole: setRole, setMode: setMode, isAdmin: function () { return mode() === "admin"; }, web: WEB, jobs: jobs, setJobs: setJobs, jobNames: JOB_NAMES, tabsFor: tabsFor, applyMode: applyMode, config: function () { return cuCfg; }, setConfig: function (c) { cuCfg = c || cuCfg; applyMode(); }, showTab: showTab, store: store, askText: askText,
    midiSend: function (d, at) { midiSend(d, at); }, midiSysex: function (d) { if (midi && midi.sysexEnabled) midiSend(d); } };
  (function () { var hb = document.querySelector(".brand b"); if (hb) hb.textContent = window.CentralUsage.appName; if (EDITION === "usage") document.title = "Central Usage"; })();   // (the header says which app this is)
})();
