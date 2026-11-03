/* The DAW's screen - shared by Central Production (layout "full") and the Studio in Central Usage (layout "compact": the
 * same code, fewer panels showing, and "Open in Central Production" for the rest).
 *   CDawUI.mount(el, { layout, openInProduction(), loops() -> Promise<[{ id, name, bpm, key, bars, read() -> Promise<bytes> }]>,
 *                      onSave(), title })
 *   [toolbar: transport, position, tempo, key, click, loop, punch, snap, zoom, undo]
 *   [browser (sounds, loops, files) | arrange (ruler, sections, tracks, clips, automation lanes)]
 *   [dock: Editor (piano roll / drum grid / audio clip / sound) | Mixer]
 * The parts are in daw-ui-arrange.js, daw-ui-editors.js, daw-ui-mixer.js and daw-ui-browser.js; they share CDawUI.U. */
(function () {
  "use strict";
  var D = window.CDaw;
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function store(k, d) { try { var v = localStorage.getItem("cdaw-" + k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } }
  function keep(k, v) { try { localStorage.setItem("cdaw-" + k, JSON.stringify(v)); } catch (_) { } }
  // the shared screen state
  var U = { root: null, opts: {}, sel: null, clips: [], zoom: store("zoom", 32), dock: store("dock", "editor"), dockH: store("dockH", 260), browser: store("browser", true), mixer: false, keys: false, keyOct: 4, msg: "", rafOn: false, clipboard: null, editorMode: null };
  var UI = window.CDawUI = { U: U, $: $, $$: $$, esc: esc, store: store, keep: keep, parts: {} };
  function P() { return D.project(); }
  UI.track = function () { var t = D.track(U.sel); if (!t) { t = P().tracks.filter(function (x) { return x.kind !== "bus"; })[0] || null; U.sel = t && t.id; } return t; };
  UI.say = function (m, bad) { U.msg = m; var e = U.root && $(".cd-msg", U.root); if (e) { e.textContent = m; e.classList.toggle("bad", !!bad); clearTimeout(UI._mt); UI._mt = setTimeout(function () { e.textContent = ""; }, bad ? 7000 : 4000); } };
  D.on("message", function (m) { UI.say(m, true); });
  UI.posText = function (beat) { var b = D.tempo.beatToBar(Math.max(0, beat)), s = D.tempo.beatToSec(Math.max(0, beat)); return (b.bar + 1) + "." + (Math.floor(b.beat + 1e-6) + 1) + "." + String(Math.floor((b.beat % 1) * 4 + 1e-6) + 1); };
  UI.timeText = function (beat) { var s = Math.max(0, D.tempo.beatToSec(Math.max(0, beat))); return Math.floor(s / 60) + ":" + ("0" + (s % 60).toFixed(1)).slice(-4); };
  UI.noteName = function (n) { return ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1); };
  // a small menu next to an element: items [[label, fn, enabled?, hint?], null = a line]
  UI.menu = function (anchor, items, x, y) {
    var m = $(".cd-pop", U.root); m.innerHTML = items.map(function (it, i) { return it ? '<button data-i="' + i + '"' + (it[2] === false ? " disabled" : "") + ">" + esc(it[0]) + (it[3] ? "<kbd>" + esc(it[3]) + "</kbd>" : "") + "</button>" : "<hr>"; }).join("");
    var r = anchor ? anchor.getBoundingClientRect() : { left: x, bottom: y }, rr = U.root.getBoundingClientRect();
    m.hidden = false; m.style.left = Math.max(4, Math.min((x != null ? x : r.left) - rr.left, rr.width - 260)) + "px"; m.style.top = ((y != null ? y : r.bottom + 2) - rr.top) + "px";
    m.onclick = function (e) { var b = e.target.closest("[data-i]"); if (!b) return; m.hidden = true; items[+b.dataset.i][1](); };
    function done() { m.hidden = true; document.removeEventListener("pointerdown", off, true); document.removeEventListener("keydown", esc2, true); }
    function off(e) { if (!m.contains(e.target)) done(); }
    function esc2(e) { if (e.key === "Escape" && !m.hidden) { e.stopPropagation(); e.preventDefault(); done(); } }
    setTimeout(function () { document.addEventListener("pointerdown", off, true); document.addEventListener("keydown", esc2, true); }, 0);
  };
  UI.compact = function () { return U.opts.layout === "compact"; };

  // ------------------------------------------------------------- the frame
  function frame() {
    var c = UI.compact(), K = D.KEYS;
    U.root.innerHTML =
      '<div class="cd-top">' +
        '<div class="cd-g cd-transport"><button data-a="home" title="To the start (Home)">⏮</button><button data-a="play" class="cd-play" title="Play / stop (Space)">▶</button><button data-a="stop" title="Stop (Enter: back to where it started)">■</button><button data-a="rec" class="cd-recbtn" title="Record (R)">●</button>' +
        '<div class="cd-lcd"><b class="cd-pos">1.1.1</b><span class="cd-time">0:00.0</span></div></div>' +
        '<div class="cd-g"><label class="cd-f">BPM<input class="cd-bpm" type="number" min="30" max="300" step="0.1"></label><button data-a="tap" title="Tap the tempo">Tap</button>' +
        (c ? "" : '<select class="cd-sig" aria-label="Time signature"><option>4/4</option><option>3/4</option><option>6/8</option><option>2/4</option><option>5/4</option><option>7/8</option><option>12/8</option></select>') +
        '<select class="cd-key" aria-label="Key">' + K.map(function (k) { return "<option>" + k + "</option>"; }).join("") + K.map(function (k) { return "<option>" + k + "m</option>"; }).join("") + "</select></div>" +
        '<div class="cd-g"><button data-a="click" class="cd-t" title="Click (C)">Click</button><select class="cd-count" aria-label="Count-in"><option value="0">No count-in</option><option value="1">Count in 1 bar</option><option value="2">Count in 2 bars</option></select><button data-a="loop" class="cd-t" title="Loop (L) - drag on the ruler\'s top strip to set it">Loop</button>' +
        (c ? "" : '<button data-a="punch" class="cd-t" title="Punch in / out (P) - Alt-drag on the ruler\'s top strip to set it">Punch</button><button data-a="overdub" class="cd-t" title="Record MIDI over what\'s there instead of replacing it">Overdub</button>') + "</div>" +
        '<div class="cd-g"><label class="cd-f">Snap<select class="cd-snap"><option value="bar">Bar</option><option value="1/2">1/2</option><option value="1/4">1/4</option><option value="1/8">1/8</option><option value="1/16">1/16</option><option value="1/32">1/32</option><option value="1/8T">1/8 T</option><option value="1/16T">1/16 T</option><option value="off">Off</option></select></label>' +
        '<button data-a="zout" title="Zoom out (−)">−</button><button data-a="zin" title="Zoom in (+)">+</button><button data-a="zfit" title="Show the whole song (Z)">Fit</button></div>' +
        '<div class="cd-g"><button data-a="undo" title="Undo (Ctrl+Z)">↶</button><button data-a="redo" title="Redo (Ctrl+Shift+Z)">↷</button></div>' +
        '<div class="cd-g cd-views"><button data-a="browser" class="cd-t" title="Sounds, loops and files (B)">' + (c ? "Sounds" : "Browser") + '</button><button data-a="editor" class="cd-t" title="Editor (E)">Editor</button><button data-a="mixer" class="cd-t" title="Mixer (X)">Mixer</button><button data-a="keys" class="cd-t" title="Play with the computer keys (K): A W S E D F T G Y H U J K, Z / X octave">Keys</button><button data-a="audio" title="Audio: the input and output, sample rate, buffer, and lining up recordings">Audio</button>' +
        (c && U.opts.openInProduction ? '<button data-a="production" class="cd-prod" title="The same song in Central Production, with everything">Open in Central Production</button>' : "") + "</div>" +
        '<div class="cd-status"><span class="cd-lat"></span><span class="cd-msg"></span></div>' +
      "</div>" +
      '<div class="cd-main"><aside class="cd-browser"></aside><div class="cd-arrange"></div></div>' +
      '<div class="cd-dock"><div class="cd-dock-grip" title="Drag to make it taller or shorter"></div><div class="cd-dtabs"><button data-dock="editor">Editor</button><button data-dock="sound">Sound</button><button data-dock="mixer">Mixer</button><span class="cd-dtitle"></span></div><div class="cd-dbody"></div></div>' +
      '<div class="cd-pop" hidden></div><div class="cd-modal" hidden></div>';
    wire();
    if (UI.parts.arrange) UI.parts.arrange.build($(".cd-arrange", U.root));
    if (UI.parts.browser) UI.parts.browser.build($(".cd-browser", U.root));
  }
  function wire() {
    var r = U.root;
    $(".cd-top", r).onclick = function (e) { var b = e.target.closest("[data-a]"); if (b) action(b.dataset.a); };
    $(".cd-bpm", r).onchange = function () { var v = D.clamp(+this.value, 30, 300); D.edit("Tempo", function (p) { p.bpm = v; }); if (D.rewarp()) D.fire("change", "rewarp"); };
    var sig = $(".cd-sig", r); if (sig) sig.onchange = function () { var v = this.value.split("/").map(Number); D.edit("Time signature", function (p) { p.sig = v; }); };
    $(".cd-key", r).onchange = function () { var v = this.value; D.edit("Key", function (p) { p.key = v; }); if (D.rewarp()) D.fire("change", "rewarp"); };
    $(".cd-count", r).onchange = function () { var v = +this.value; D.edit("Count-in", function (p) { p.metronome.countIn = v; }); };
    $(".cd-snap", r).onchange = function () { var v = this.value; D.edit("Snap", function (p) { p.snap = v; }, { what: "select" }); };
    $(".cd-dtabs", r).onclick = function (e) { var b = e.target.closest("[data-dock]"); if (!b) return; U.dock = U.dock === b.dataset.dock && U.dockOpen ? U.dock : b.dataset.dock; U.dockOpen = true; keep("dock", U.dock); drawDock(); };
    // the dock's height: drag its top edge
    var grip = $(".cd-dock-grip", r);
    grip.onpointerdown = function (e) { var y0 = e.clientY, h0 = U.dockH; grip.setPointerCapture(e.pointerId); grip.onpointermove = function (ev) { U.dockH = D.clamp(h0 + (y0 - ev.clientY), 120, Math.max(160, U.root.clientHeight - 200)); layout(); }; grip.onpointerup = function () { grip.onpointermove = null; keep("dockH", U.dockH); layout(); drawDock(); }; };
  }
  var taps = [];
  function action(a) {
    var p = P();
    if (a === "play") { D.toggle(); }
    else if (a === "stop") { if (D.state().playing) D.stop({ back: true }); else D.stop({ home: true }); }
    else if (a === "home") D.setPos(0);
    else if (a === "rec") D.record();
    else if (a === "click") D.edit("Click", function (q) { q.metronome.on = !q.metronome.on; });
    else if (a === "loop") D.edit("Loop", function (q) { q.loop.on = !q.loop.on; if (q.loop.on && !(q.loop.end > q.loop.start)) { q.loop.start = 0; q.loop.end = D.tempo.bpb() * 4; } });
    else if (a === "punch") D.edit("Punch", function (q) { q.punch.on = !q.punch.on; });
    else if (a === "overdub") D.edit("Overdub", function (q) { q.overdub = !q.overdub; });
    else if (a === "undo") { var u = D.undo(); if (u) UI.say("Undid: " + u); }
    else if (a === "redo") { var rd = D.redo(); if (rd) UI.say("Redid: " + rd); }
    else if (a === "zin" || a === "zout") zoom(a === "zin" ? 1.25 : 0.8);
    else if (a === "zfit") { var w = ($(".cd-lanes-wrap", U.root) || U.root).clientWidth - 40, end = Math.max(D.songEnd(), D.tempo.bpb() * 8); U.zoom = D.clamp(w / end, 2, 400); keep("zoom", U.zoom); UI.draw(); }
    else if (a === "browser") { U.browser = !U.browser; keep("browser", U.browser); layout(); if (U.browser && UI.parts.browser) UI.parts.browser.draw(); }
    else if (a === "editor" || a === "mixer") { if (U.dockOpen && U.dock === a) U.dockOpen = false; else { U.dock = a; U.dockOpen = true; keep("dock", a); } layout(); drawDock(); }
    else if (a === "audio") UI.audioDialog();
    else if (a === "keys") { U.keys = !U.keys; UI.say(U.keys ? "The computer keys play the selected track: A W S E D F T G Y H U J K (Z / X: octave)." : "Computer keys off."); drawTop(); }
    else if (a === "tap") { var now = performance.now(); taps = taps.filter(function (t) { return now - t < 2500; }); taps.push(now); if (taps.length >= 3) { var avg = (taps[taps.length - 1] - taps[0]) / (taps.length - 1), v = Math.round(60000 / avg * 10) / 10; D.edit("Tempo", function (q) { q.bpm = D.clamp(v, 30, 300); }); } }
    else if (a === "production" && U.opts.openInProduction) U.opts.openInProduction();
    drawTop();
  }
  function zoom(f, anchorBeat) {
    var sc = $(".cd-lanes-wrap", U.root), before = anchorBeat != null ? anchorBeat : sc ? (sc.scrollLeft + sc.clientWidth / 2 - UI.headerW()) / U.zoom : 0;
    U.zoom = D.clamp(U.zoom * f, 2, 400); keep("zoom", U.zoom); UI.draw();
    if (sc) sc.scrollLeft = Math.max(0, before * U.zoom - sc.clientWidth / 2 + UI.headerW());
  }
  UI.zoom = zoom;
  UI.headerW = function () { return UI.compact() ? 190 : 248; };   // (10.2: room for a readable name, the buttons and the meter - the same as daw.css)
  function layout() {
    if (!U.root) return;
    U.root.classList.toggle("cd-compact", UI.compact());
    $(".cd-browser", U.root).hidden = !U.browser;
    var dock = $(".cd-dock", U.root); dock.classList.toggle("open", !!U.dockOpen); dock.style.height = U.dockOpen ? U.dockH + "px" : "";
  }
  function drawTop() {
    var r = U.root; if (!r) return; var p = P(), st = D.state();
    var bpm = $(".cd-bpm", r); if (document.activeElement !== bpm) bpm.value = Math.round(p.bpm * 10) / 10;
    var sig = $(".cd-sig", r); if (sig) sig.value = p.sig.join("/");
    $(".cd-key", r).value = p.key; $(".cd-count", r).value = String(p.metronome.countIn || 0); $(".cd-snap", r).value = p.snap;
    function tg(a, on) { var b = $('[data-a="' + a + '"]', r); if (b) b.classList.toggle("on", !!on); }
    tg("click", p.metronome.on); tg("loop", p.loop.on); tg("punch", p.punch.on); tg("overdub", p.overdub); tg("browser", U.browser); tg("editor", U.dockOpen && U.dock === "editor"); tg("mixer", U.dockOpen && U.dock === "mixer"); tg("keys", U.keys);
    $('[data-a="play"]', r).classList.toggle("on", st.playing); $('[data-a="play"]', r).textContent = st.playing ? "❚❚" : "▶"; $('[data-a="rec"]', r).classList.toggle("on", st.recording);
    $('[data-a="undo"]', r).disabled = !D.canUndo(); $('[data-a="undo"]', r).title = D.canUndo() ? "Undo: " + D.canUndo() + " (Ctrl+Z)" : "Nothing to undo"; $('[data-a="redo"]', r).disabled = !D.canRedo(); $('[data-a="redo"]', r).title = D.canRedo() ? "Redo: " + D.canRedo() : "Nothing to redo";
    var m = D.monitor(), lat = D.latency(); $(".cd-lat", r).textContent = m.ok ? "Live playing: " + (m.latencyMs || 3) + " ms (low-delay player)" : lat.total ? "Output delay " + Math.round(lat.total * 1000) + " ms (recordings are lined up for it)" : "";
  }
  UI.drawTop = drawTop;
  function drawDock() {
    var r = U.root; if (!r) return; layout();
    $$("[data-dock]", r).forEach(function (b) { b.classList.toggle("on", U.dockOpen && b.dataset.dock === U.dock); });
    if (!U.dockOpen) return;
    var body = $(".cd-dbody", r), part = UI.parts[U.dock === "mixer" ? "mixer" : "editors"];
    if (part) part.draw(body, U.dock);
  }
  UI.drawDock = drawDock;
  UI.openEditor = function (what) { U.dock = what || "editor"; U.dockOpen = true; keep("dock", U.dock); drawDock(); drawTop(); };
  UI.draw = function (what) {
    if (!U.root) return;
    drawTop();
    if (UI.parts.arrange) UI.parts.arrange.draw(what);
    if (what !== "nudge") drawDock();
  };

  // ------------------------------------------------------------- per frame: the playhead, the position, the meters
  function frameLoop() {
    if (!U.root || !U.root.isConnected) { U.rafOn = false; return; }
    var st = D.state(), r = U.root;
    $(".cd-pos", r).textContent = st.countingIn ? "Count-in" : UI.posText(st.pos); $(".cd-time", r).textContent = UI.timeText(st.pos);
    if (UI.parts.arrange) UI.parts.arrange.playhead(st);
    if (UI.parts.mixer && U.dockOpen && U.dock === "mixer") UI.parts.mixer.meters();
    if (UI.parts.arrange && UI.parts.arrange.meters) UI.parts.arrange.meters();
    if (UI.parts.editors && UI.parts.editors.playhead && U.dockOpen && U.dock === "editor") UI.parts.editors.playhead(st);
    requestAnimationFrame(frameLoop);
  }
  // meter levels from a strip's analyser: { peak, rms } (linear), with a peak hold kept per id
  var holds = {}, mbuf = new Float32Array(1024);
  UI.level = function (id, analyser) {
    analyser.getFloatTimeDomainData(mbuf); var pk = 0, sum = 0; for (var i = 0; i < mbuf.length; i++) { var x = Math.abs(mbuf[i]); if (x > pk) pk = x; sum += mbuf[i] * mbuf[i]; }
    var h = holds[id] || (holds[id] = { v: 0, t: 0, clip: false }), now = performance.now();
    if (pk >= h.v || now - h.t > 1500) { h.v = pk >= h.v ? pk : Math.max(pk, h.v * 0.92); if (pk >= h.v) h.t = now; }
    if (pk >= 0.999) h.clip = true;
    return { peak: pk, rms: Math.sqrt(sum / mbuf.length), hold: h.v, clip: h.clip, reset: function () { h.clip = false; h.v = 0; } };
  };
  UI.meterDraw = function (cv, lv, vertical) {
    var w = cv.clientWidth, h = cv.clientHeight; if (cv.width !== w) cv.width = w; if (cv.height !== h) cv.height = h; var g = cv.getContext("2d"); g.clearRect(0, 0, w, h);
    function pos(v) { var db = 20 * Math.log10(Math.max(1e-6, v)); return D.clamp((db + 60) / 66, 0, 1); }
    var L = vertical ? h : w, a = pos(lv.rms) * L, pk = pos(lv.peak) * L, hd = pos(lv.hold) * L;
    var grad = vertical ? g.createLinearGradient(0, h, 0, 0) : g.createLinearGradient(0, 0, w, 0); grad.addColorStop(0, "#4FA36B"); grad.addColorStop(0.75, "#9BCB86"); grad.addColorStop(0.9, "#E8C25A"); grad.addColorStop(1, "#E5484D");
    g.fillStyle = "#0B0D10"; g.fillRect(0, 0, w, h); g.fillStyle = grad; g.globalAlpha = 0.45;
    if (vertical) g.fillRect(0, h - pk, w, pk); else g.fillRect(0, 0, pk, h); g.globalAlpha = 1;
    if (vertical) g.fillRect(0, h - a, w, a); else g.fillRect(0, 0, a, h);
    g.fillStyle = lv.clip ? "#E5484D" : "#ECE7DD"; if (vertical) g.fillRect(0, h - hd - 1, w, 2); else g.fillRect(hd - 1, 0, 2, h);
  };

  // ------------------------------------------------------------- the keyboard: a real DAW's shortcuts, and the computer keys
  var KEYMAP = "awsedftgyhujkolp;'", held = {};
  function typing(e) { var t = e.target; return /input|textarea|select/i.test(t.tagName || "") || t.isContentEditable; }
  function onKey(e) {
    if (!U.root || !U.root.isConnected || U.root.offsetParent === null) return;
    var k = e.key, low = k.toLowerCase(), mod = e.ctrlKey || e.metaKey;
    if (typing(e) && !(mod && (low === "z" || low === "s"))) return;
    if (e.target.closest && e.target.closest(".cd-modal:not([hidden])")) return;
    if (U.keys && !mod && !e.altKey) {
      if (low === "z" || low === "x") { U.keyOct = D.clamp(U.keyOct + (low === "z" ? -1 : 1), 0, 8); UI.say("Octave " + U.keyOct); e.preventDefault(); return; }
      var i = KEYMAP.indexOf(low); if (i >= 0) { e.preventDefault(); if (e.repeat || held[low]) return; var n = (U.keyOct + 1) * 12 + i, t = UI.track(); if (t) { held[low] = { t: t.id, n: n }; D.live(t.id, [0x90, n, 100]); } return; }
    }
    if (mod && low === "z") { e.preventDefault(); action(e.shiftKey ? "redo" : "undo"); return; }
    if (mod && low === "y") { e.preventDefault(); action("redo"); return; }
    if (mod && low === "s") { if (U.opts.onSave) { e.preventDefault(); U.opts.onSave(); } return; }
    var handled = true;
    if (k === " ") { if (D.state().playing) D.stop({ back: e.shiftKey ? false : false }); else D.toggle(); }
    else if (k === "Enter") { if (D.state().playing) D.stop({ back: true }); else D.setPos(0); }
    else if (k === "Home") D.setPos(0);
    else if (!mod && low === "r") D.record();
    else if (!mod && low === "l") action("loop");
    else if (!mod && low === "c" ) action("click");
    else if (!mod && low === "p") action("punch");
    else if (!mod && low === "b") action("browser");
    else if (!mod && low === "e") action("editor");
    else if (!mod && low === "x") action("mixer");
    else if (!mod && low === "k") action("keys");
    else if (!mod && low === "z") action("zfit");
    else if (!mod && (k === "+" || k === "=")) zoom(1.25);
    else if (!mod && (k === "-" || k === "_")) zoom(0.8);
    else if (!mod && k === "ArrowLeft" && !U.clips.length) { var b = D.tempo.beatToBar(D.state().pos); D.setPos(D.tempo.barToBeat(Math.max(0, b.beat > 0.01 ? b.bar : b.bar - 1))); }
    else if (!mod && k === "ArrowRight" && !U.clips.length) { var b2 = D.tempo.beatToBar(D.state().pos); D.setPos(D.tempo.barToBeat(b2.bar + 1)); }
    else if (UI.parts.arrange && UI.parts.arrange.key && UI.parts.arrange.key(e)) { }
    else handled = false;
    if (handled) e.preventDefault();
  }
  function onKeyUp(e) { var low = e.key.toLowerCase(), h = held[low]; if (h) { D.live(h.t, [0x80, h.n, 0]); delete held[low]; } }
  document.addEventListener("keydown", function (e) { if (UI.parts.editors && UI.parts.editors.key && U.dockOpen && U.dock === "editor" && UI.parts.editors.focused && UI.parts.editors.key(e)) return; onKey(e); });
  document.addEventListener("keyup", onKeyUp);

  // ------------------------------------------------------------- MIDI keyboards: the armed (or selected) instrument tracks
  var midiOff = null;
  function midiIn(m) {
    if (!U.root || !U.root.isConnected || U.root.offsetParent === null) return;
    var st = m.data[0]; if (st === 0xFA) { D.play(); return; } if (st === 0xFC) { D.stop(); return; }
    var p = P(), dev = m.device && m.device.name, to = p.tracks.filter(function (t) { return t.kind !== "audio" && t.kind !== "bus" && t.arm && (t.input === "any" || t.input === dev); });
    if (!to.length) { var t = UI.track(); if (t && t.kind !== "audio" && t.kind !== "bus") to = [t]; }
    to.forEach(function (t) { D.live(t.id, m.data, m.time); });
    if (UI.parts.editors && UI.parts.editors.midi) UI.parts.editors.midi(m);
  }

  // ------------------------------------------------------------- Settings → Audio (the same panel in both apps)
  // The input and output devices, sample rate, buffer size, how many input channels to open, and lining recordings up:
  // the delay the system reports, or a loopback measurement (clicks out of an output, back into an input).
  UI.audioPanel = function (el) {
    var A = D.audio, a = A.settings();
    function ms(v) { return v == null ? "-" : (Math.round(v * 10) / 10) + " ms"; }
    function opt(list, cur, none) { return '<option value="">' + none + "</option>" + list.map(function (d) { return '<option value="' + esc(d.id) + '"' + (d.id === cur ? " selected" : "") + ">" + esc(d.name) + "</option>"; }).join(""); }
    el.innerHTML = '<div class="cd-audio"><p class="cd-dim">Looking for your audio devices…</p></div>';
    A.devices().then(function (dv) {
      a = A.settings();
      el.innerHTML = '<div class="cd-audio">' +
        '<label class="cd-line">Input<select data-au="input">' + opt(dv.inputs, a.input, "The computer's default input") + "</select></label>" +
        '<label class="cd-line">Output<select data-au="output"' + (dv.canPickOutput ? "" : " disabled") + ">" + opt(dv.outputs, a.output, "The computer's default output") + "</select></label>" +
        (dv.names ? "" : '<p class="cd-dim">The device names show once you allow the input. <button data-au-names>Show their names</button></p>') +
        '<div class="cd-line"><label>Sample rate<select data-au="rate">' + [44100, 48000, 88200, 96000].map(function (r) { return '<option value="' + r + '"' + (r === a.rate ? " selected" : "") + ">" + (r / 1000) + " kHz</option>"; }).join("") + "</select></label>" +
        '<label>Buffer<select data-au="buffer">' + [64, 128, 256, 512, 1024, 2048].map(function (b) { return '<option value="' + b + '"' + (b === a.buffer ? " selected" : "") + ">" + b + " (" + ms(b / a.rate * 1000) + ")</option>"; }).join("") + "</select></label>" +
        '<label>Input channels<select data-au="channels">' + [1, 2, 4, 6, 8, 10, 12, 16, 18, 24, 32].map(function (n) { return '<option value="' + n + '"' + (n === a.channels ? " selected" : "") + ">" + n + "</option>"; }).join("") + "</select></label></div>" +
        '<p class="cd-dim">A smaller buffer plays with less delay but needs a faster computer. Each audio track records from one input (mono) or a pair (stereo): choose it in the track\'s menu (right-click its name).</p>' +
        '<h4>Lining up recordings</h4><div class="cd-auinfo cd-dim">Opening the input…</div>' +
        '<div class="cd-line"><button data-au-measure class="primary">Measure it (loopback)</button><button data-au-clear' + (a.loopbackMs == null ? " hidden" : "") + '>Use the reported delay</button></div>' +
        '<p class="cd-dim">Loopback: connect an output of your interface to one of its inputs with a cable (or hold a mic by a speaker) and turn it up. Six clicks play and the time they take to come back lines up everything you record.</p></div>';
      function info() {
        A.info().then(function (i) {
          var box = $(".cd-auinfo", el); if (!box) return;
          box.innerHTML = "Input: " + esc(i.device || "the default") + " · " + i.channels + " channel" + (i.channels === 1 ? "" : "s") + " · " + (i.rate / 1000) + " kHz<br>" +
            "Input delay (reported) " + ms(i.inputMs) + " · output delay " + ms(i.outputMs) + " · buffer " + ms(i.bufferMs) + "<br>" +
            (i.measuredMs != null ? "<b>Measured round trip " + ms(i.measuredMs) + "</b>: recordings are moved back by that." : "Recordings are moved back by " + ms(i.usedMs) + " (what the system reports). Measuring it is more exact.");
        }).catch(function (e) { var box = $(".cd-auinfo", el); if (box) box.textContent = "The input isn't open: " + (e && e.message || e); });
      }
      info();
      el.onchange = function (e) { var k = e.target.dataset.au; if (!k) return; var v = e.target.value, patch = {}; patch[k] = k === "input" || k === "output" ? v : +v; A.set(patch); UI.say("Audio: " + (k === "rate" || k === "buffer" ? "the sound restarted with the new setting." : "changed.")); UI.audioPanel(el); };
      el.onclick = function (e) {
        if (e.target.closest("[data-au-names]")) { A.info().then(function () { UI.audioPanel(el); }).catch(function (er) { UI.say("The input wasn't allowed: " + (er.message || er), true); }); }
        if (e.target.closest("[data-au-clear]")) { A.set({ loopbackMs: null }); UI.audioPanel(el); }
        var mb = e.target.closest("[data-au-measure]"); if (mb) { mb.disabled = true; mb.textContent = "Listening…"; A.measure().then(function (v) { UI.say("Round trip: " + ms(v) + ". Recordings line up with it."); UI.audioPanel(el); }).catch(function (er) { mb.disabled = false; mb.textContent = "Measure it (loopback)"; UI.say(er.message || String(er), true); }); }
      };
    });
  };
  UI.audioDialog = function () {
    var m = $(".cd-modal", U.root); if (!m) return;
    m.innerHTML = '<div class="cd-dialog cd-wide"><h3>Audio</h3><div class="cd-aubody"></div><div class="cd-line end"><button class="primary" data-r="close">Done</button></div></div>'; m.hidden = false;
    UI.audioPanel($(".cd-aubody", m));
    m.onclick = function (e) { if (e.target.closest("[data-r=close]") || e.target === m) { m.hidden = true; m.innerHTML = ""; } };
  };

  // ------------------------------------------------------------- recovering work after a crash
  UI.offerRecovery = function (host, onRestored) {
    D.recovery.host = host || "";
    return D.recovery.list().then(function (list) {
      list = list.filter(function (x) { return !host || !x.host || x.host === host; }).filter(function (x) { return Date.now() - x.at < 14 * 864e5; });
      if (!list.length || !U.root) return;
      var x = list[0], m = $(".cd-modal", U.root);
      m.innerHTML = '<div class="cd-dialog"><h3>Bring back your unsaved work?</h3><p>“' + esc(x.name) + "” had changes that weren't saved (" + esc(new Date(x.at).toLocaleString()) + '). The app keeps your work every few seconds, so this is close to where you were.</p><div class="cd-line end"><button data-r="no">Throw it away</button><button class="primary" data-r="yes">Bring it back</button></div></div>';
      m.hidden = false;
      m.onclick = function (e) { var b = e.target.closest("[data-r]"); if (!b) return; m.hidden = true; if (b.dataset.r === "yes") D.recovery.restore(x.id).then(function (p) { UI.say("Brought back “" + p.name + "”."); if (onRestored) onRestored(p); }).catch(function (er) { UI.say(er.message, true); }); else D.recovery.forget(x.id); };
    });
  };

  // ------------------------------------------------------------- mount
  UI.mount = function (el, opts) {
    U.root = el; U.opts = opts || {}; el.classList.add("cdaw"); U.dockOpen = store("dockOpen", false);
    if (UI.compact()) { U.browser = store("browser-compact", false); }
    frame(); layout(); UI.draw();
    D.ctx();
    // (10.2) VST3 / CLAP plugins: in the apps, the rig hosts them (CU.studio.native, central-usage/studio.js)
    var NS = window.CU && window.CU.studio && window.CU.studio.native;
    if (NS && !D.native.host()) {
      D.native.setHost({ stream: NS.stream || null, list: function (scan) { return NS.plugins(scan).then(function (r) { if (!r || !r.ok) throw new Error(r && r.error || "no plugin host"); return r.plugins; }); }, process: function (job) { return NS.process(job); }, monitor: function (m) { NS.monitor(m); }, editor: function (slot, plugins, open) { return NS.editor(slot, plugins, open); } });
      NS.on(function (m) { if (m.type === "rigStopped") { D.native.setHost(D.native.host()); if (D.state && D.state().playing) UI.say("The plugin host stopped: press play again.", true); } if (m.type === "pluginScan") UI.say("Looking for plugins: " + m.done + " of " + m.total + (m.current ? " (" + m.current + ")" : "")); if (m.type === "instrumentStatus" && m.pluginErrors && Object.keys(m.pluginErrors).length) UI.say("A plugin didn't load: " + Object.values(m.pluginErrors)[0], true); });
    }
    D.on("freeze", function () { if (UI.parts.mixer && U.dockOpen) try { drawDock(); } catch (_) { } UI.draw(); });
    if (window.CUMidiIn) { window.CUMidiIn.start().catch(function () { }); if (!midiOff) midiOff = window.CUMidiIn.on(midiIn); }
    if (window.CUStudioSounds && window.CUStudioSounds.refresh) window.CUStudioSounds.refresh();
    D.startMonitor();
    if (!U.rafOn) { U.rafOn = true; requestAnimationFrame(frameLoop); }
  };
  UI.unmount = function () { U.root = null; };
  UI.select = function (trackId, clipIds) { if (trackId) U.sel = trackId; U.clips = clipIds || []; UI.draw("select"); };
  D.on("change", function (w) { if (!U.root) return; if (w === "load") { U.sel = null; U.clips = []; } UI.draw(w); });
  D.on("transport", function () { drawTop(); });
  D.on("record", function () { drawTop(); });
  D.on("monitor", function () { drawTop(); });
  window.addEventListener("resize", function () { if (U.root) UI.draw("nudge"); });
  var _dockKeep = store; UI._keepDockOpen = function () { keep("dockOpen", U.dockOpen); };
  setInterval(function () { if (U.root) keep("dockOpen", U.dockOpen); }, 5000);
})();
