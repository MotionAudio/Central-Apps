/* (11.0) The bar screen (strip.html) on the main board rev B: what's playing, and pages you swipe through - the
 * sounds (pads), the setlist, the loops, the keys sounds and the scenes. Everything here goes through the driver:
 * {type:"strip", action:"run", name, args} runs an app action (the same ones a footswitch runs), "pick" picks from
 * one of the app's lists (the same lists the 3.5" screen uses). The app answers with "display" and "stripLists". */
(function () {
  "use strict";
  var $ = function (s) { return document.querySelector(s); };
  var socket = null, connected = false, display = null, lists = {}, status = null, page = "now", lastRender = 0, renderTimer = null;
  var PAGES = [["now", "Now"], ["pads", "Sounds"], ["songs", "Songs"], ["loops", "Loops"], ["keys", "Keys"], ["scenes", "Scenes"]];
  var screenN = (location.search.match(/[?&]screen=(\d)/) || [])[1] || "";

  function send(m) { if (socket && socket.readyState === 1) { try { socket.send(JSON.stringify(m)); return true; } catch (_) { } } return false; }
  function run(name, args) { send({ type: "strip", action: "run", name: name, args: args || {} }); }
  function pick(what, id, target) { send({ type: "strip", action: "pick", what: what, id: id, target: target }); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function toast(text) { var t = $("#toast"); t.textContent = text; t.classList.add("on"); clearTimeout(toast.t); toast.t = setTimeout(function () { t.classList.remove("on"); }, 1800); }
  function mmss(s) { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ":" + ("0" + (s % 60)).slice(-2); }

  function connect() {
    try { socket = new WebSocket("ws://127.0.0.1:8765"); } catch (_) { setTimeout(connect, 1000); return; }
    socket.onopen = function () { connected = true; $("#off").classList.remove("on"); send({ type: "strip", action: "hello", screen: screenN }); };
    socket.onmessage = function (e) { var m; try { m = JSON.parse(e.data); } catch (_) { return; } handle(m); };
    socket.onclose = function () { connected = false; socket = null; $("#off").classList.add("on"); setTimeout(connect, performance.now() < 20000 ? 400 : 2000); };
  }
  function handle(m) {
    if (m.type === "display") { display = m; renderSoon(); }
    else if (m.type === "stripLists") { Object.keys(m.lists || {}).forEach(function (k) { lists[k] = m.lists[k]; }); renderSoon(); }
    else if (m.type === "systemStatus") { status = m; renderTop(); }
    else if (m.type === "miniResult" && m.text) toast(m.text);
    else if (m.type === "hello") { /* the driver's hello: nothing to do, our own hello went already */ }
  }
  function renderSoon() { if (renderTimer) return; renderTimer = setTimeout(function () { renderTimer = null; render(); }, 40); }

  // ---- the top line: song, part, time, battery
  function renderTop() {
    var d = display || {}, s = d.song;
    $("#song").innerHTML = s ? esc(s.name) + "<small>" + esc([s.key ? "Key " + s.key : "", s.bpm ? s.bpm + " bpm" : ""].filter(Boolean).join(" · ")) + "</small>" : "Central Pedal" + (d.key ? "<small>Pad key " + esc(d.key) + "</small>" : "");
    $("#sec").textContent = d.section ? d.section.name : "";
    $("#next").textContent = d.next ? "→ " + d.next.name : "";
    $("#time").textContent = s && d.duration ? mmss(d.pos) + " / " + mmss(d.duration) + (d.bar ? "  ·  bar " + d.bar : "") : "";
    var bar = $("#bar"); bar.classList.toggle("playing", !!d.playing);
    bar.querySelector("i").style.width = s && d.duration ? Math.min(100, (d.pos || 0) / d.duration * 100) + "%" : "0";
    var b = status && status.battery, el = $("#bat");
    if (b) { el.textContent = (b.usb ? "⚡ " : "") + b.percent + " %" + (b.charging ? " charging" : ""); el.classList.toggle("low", !!b.low && !b.charging); } else el.textContent = "";
  }
  function renderTabs() {
    $("#tabs").innerHTML = PAGES.map(function (p) { return '<button data-page="' + p[0] + '"' + (p[0] === page ? ' class="on"' : "") + ">" + p[1] + "</button>"; }).join("");
  }

  // ---- the pages
  function tile(cls, inner, attrs) { return '<div class="tile ' + cls + '" ' + (attrs || "") + ">" + inner + "</div>"; }
  function nowPage() {
    var d = display || {}, s = d.song, html = "";
    html += '<div class="big"><div class="t">' + esc(s ? s.name : (d.pads || []).filter(function (p) { return p.selected; }).map(function (p) { return p.name; })[0] || "Nothing loaded") + "</div>" +
      '<div class="k">' + esc(s ? [s.key ? "Key of " + s.key : "", s.bpm ? s.bpm + " bpm" : "", d.tracksMode ? "Tracks" : "Pads"].filter(Boolean).join(" · ") : (d.key ? "Pad key " + d.key : "")) + "</div></div>";
    if (d.sections && d.sections.length) {
      html += '<div class="sections">' + d.sections.map(function (q, i) { return tile("sec" + (d.section && d.section.index === i ? " now" : ""), "<b>" + esc(q.name) + "</b><small>" + mmss(q.start) + "</small>", 'data-run="goSection" data-index="' + i + '"'); }).join("") + "</div>";
    }
    var playing = (d.pads || []).map(function (p, i) { return Object.assign({ i: i }, p); }).filter(function (p) { return p.playing || p.selected; });
    if (playing.length) html += '<div class="pads">' + playing.map(function (p) { return tile("pad" + (p.playing ? " live" : "") + (p.selected ? " sel" : ""), '<span class="n">pad ' + (p.i + 1) + "</span><b>" + esc(p.name) + "</b><small>" + (p.playing ? "playing" : "selected") + "</small>", 'data-run="pad" data-index="' + p.i + '"'); }).join("") + "</div>";
    if (d.looper && d.looper.loops && d.looper.loops.some(function (l) { return l.state !== "empty"; })) html += '<div class="pads">' + d.looper.loops.map(function (l, i) { return l.state === "empty" ? "" : loopTile(l, i, d.looper.sel === i); }).join("") + "</div>";
    return html;
  }
  function padsPage() {
    var d = display || {}, pads = d.pads || [];
    if (!pads.length) return '<div class="empty">No sounds yet - add pads in the app.</div>';
    return pads.map(function (p, i) { return tile("pad" + (p.playing ? " live" : "") + (p.selected ? " sel" : ""), '<span class="n">' + (i + 1) + "</span><b>" + esc(p.name) + "</b><small>" + (p.playing ? "playing · tap to stop" : "tap to play") + "</small>", 'data-run="pad" data-index="' + i + '"'); }).join("");
  }
  function songsPage() {
    var d = display || {}, songs = d.songs || [];
    if (!songs.length) return '<div class="empty">The setlist is empty - add songs in the app (♫ Setlist).</div>';
    return songs.map(function (q, i) { var cur = d.song && d.song.index === i; return tile("wide" + (cur ? " sel" : "") + (cur && d.playing ? " live" : ""), '<span class="n">' + (i + 1) + "</span><b>" + esc(q.name) + "</b><small>" + esc([q.key ? "Key " + q.key : "", q.hasTracks ? "tracks" + (q.duration ? " · " + mmss(q.duration) : "") : "pads", q.hasLyrics ? "lyrics" : ""].filter(Boolean).join(" · ")) + "</small>", 'data-run="loadSong" data-index="' + i + '"'); }).join("");
  }
  var LOOP_STATE = { empty: "REC", armed: "WAIT…", recording: "● REC", playing: "▶ PLAY", dubbing: "● DUB", stopped: "■ STOP" };
  function loopTile(l, i, sel) {
    var cls = "loop" + (sel ? " sel" : "") + (l.state === "recording" ? " rec" : l.state === "dubbing" ? " dub" : l.state === "playing" ? " play" : "");
    return tile(cls, "<small>Loop " + (i + 1) + (l.mute ? " · muted" : "") + '</small><div class="st">' + esc(l.label || LOOP_STATE[l.state] || l.state) + "</div>" +
      '<div class="row"><button data-run="looperRec" data-index="' + i + '">' + (l.state === "empty" ? "Record" : l.state === "recording" || l.state === "dubbing" ? "Play" : "Overdub") + "</button>" +
      (l.state !== "empty" ? '<button data-run="looperTrackStop" data-index="' + i + '">' + (l.state === "stopped" ? "Play" : "Stop") + '</button><button data-run="looperTrackClear" data-index="' + i + '">Clear</button>' : "") + "</div>", "");
  }
  function loopsPage() {
    var d = display || {}, L = d.looper;
    if (!L || !L.loops || !L.loops.length) return '<div class="empty">The looper is on the LOOPER tab in the app; its loops show here.</div>';
    return L.loops.map(function (l, i) { return loopTile(l, i, L.sel === i); }).join("") + tile("loop", '<small>All loops</small><div class="row"><button data-run="looperPlayAll">Play all</button><button data-run="looperStopAll">Stop all</button></div>', "");
  }
  function keysPage() {
    var l = lists.patches, items = l && l.items ? l.items : [];
    if (!items.length) return '<div class="empty">Keys sounds show here when the instrument is on (Instrument tab → Keys).</div>';
    return items.map(function (p) { return tile((l.current != null && (p.id === l.current || p.current) ? "sel" : ""), "<b>" + esc(p.label || p.name) + "</b><small>" + esc(p.sub || p.bank || "") + "</small>", 'data-pick="patches" data-id="' + esc(p.id) + '"'); }).join("");
  }
  function scenesPage() {
    var l = lists.scenes, items = l && l.items ? l.items : [];
    if (!items.length) return '<div class="empty">No scenes saved yet (Scenes in the app).</div>';
    return items.map(function (sc) { return tile("wide" + (l.current === sc.id ? " sel" : ""), "<b>" + esc(sc.label) + "</b><small>" + esc(sc.sub || "") + "</small>", 'data-pick="scenes" data-id="' + sc.id + '"'); }).join("");
  }
  function render() {
    renderTop(); renderTabs();
    var pages = $("#pages"), html = PAGES.map(function (p) {
      var inner = p[0] === "now" ? nowPage() : p[0] === "pads" ? padsPage() : p[0] === "songs" ? songsPage() : p[0] === "loops" ? loopsPage() : p[0] === "keys" ? keysPage() : scenesPage();
      return '<div class="page' + (p[0] === "now" ? " nowpage" : "") + '" data-pg="' + p[0] + '">' + inner + "</div>";
    }).join("");
    if (pages.innerHTML !== html) { var scrolls = {}; pages.querySelectorAll(".page").forEach(function (el) { scrolls[el.dataset.pg] = el.scrollLeft; }); pages.innerHTML = html; pages.querySelectorAll(".page").forEach(function (el) { if (scrolls[el.dataset.pg]) el.scrollLeft = scrolls[el.dataset.pg]; }); }
    var i = PAGES.findIndex(function (p) { return p[0] === page; });
    if (Math.abs(pages.scrollLeft - i * pages.clientWidth) > 4 && performance.now() - lastRender > 600) pages.scrollLeft = i * pages.clientWidth;
  }

  // ---- touches
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-page]"); if (b) { page = b.dataset.page; lastRender = 0; render(); return; }
    var r = e.target.closest("[data-run]");
    if (r) {
      var name = r.dataset.run, args = r.dataset.index != null ? { index: Number(r.dataset.index) } : {};
      run(name, args);
      r.classList.add("sel"); return;
    }
    var p = e.target.closest("[data-pick]"); if (p) { pick(p.dataset.pick, isNaN(Number(p.dataset.id)) ? p.dataset.id : Number(p.dataset.id)); }
  });
  var pages = $("#pages");
  pages.addEventListener("scroll", function () {   // a swipe to another page selects its tab
    var i = Math.round(pages.scrollLeft / Math.max(1, pages.clientWidth)); lastRender = performance.now();
    if (PAGES[i] && PAGES[i][0] !== page) { page = PAGES[i][0]; renderTabs(); }
  });
  // the lists come from the app through the driver; ask for the ones this screen shows once we're connected
  setInterval(function () { if (connected) { send({ type: "strip", action: "request", what: "patches" }); send({ type: "strip", action: "request", what: "scenes" }); } }, 6000);
  renderTabs(); render(); connect();
})();
