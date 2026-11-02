/* The DAW's editors (the dock): the piano roll with its velocity lane, the drum grid, the audio clip editor (gain, fades,
 * loop, tempo / key fit, takes) and the track's sound (up to four layers, split and velocity ranges).
 * Piano roll: click to add a note, drag to move (up / down for pitch), drag its right end for the length, Alt-drag to copy,
 * Ctrl-drag to select several, Delete, Ctrl+A, arrow keys (Shift: octave), Q quantize. Velocity: drag the bars. */
(function () {
  "use strict";
  var D = window.CDaw, UI = window.CDawUI, U = UI.U, $ = UI.$, $$ = UI.$$, esc = UI.esc, SND = window.CUStudioSounds;
  var ed = { body: null, clip: null, sel: [], zoom: UI.store("prZoom", 80), rowH: 12, top: 84, drum: null, lastLen: 1, q: UI.store("qStrength", 100), hum: UI.store("humanize", { ms: 12, vel: 10 }) };
  var DRUMS = [[49, "Crash"], [57, "Crash 2"], [51, "Ride"], [53, "Ride bell"], [46, "Open hat"], [44, "Pedal hat"], [42, "Closed hat"], [50, "High tom"], [48, "Mid tom"], [45, "Low tom"], [43, "Floor tom"], [39, "Clap"], [54, "Tambourine"], [37, "Side stick"], [40, "Snare 2"], [38, "Snare"], [36, "Kick"], [35, "Kick 2"]];
  function P() { return D.project(); }
  function cur() { var f = U.clips.length === 1 ? D.findClip(U.clips[0]) : null; if (!f && U.clips.length) f = D.findClip(U.clips[U.clips.length - 1]); return f; }
  var api = { focused: false };

  function draw(body, which) {
    ed.body = body; var title = $(".cd-dtitle", U.root);
    if (which === "sound") { var t = UI.track(); title.textContent = t ? "The sound of “" + t.name + "”" : ""; return drawSound(body, t); }
    var f = cur();
    if (!f) { var t2 = UI.track(); title.textContent = ""; body.innerHTML = '<div class="cd-empty"><p>Pick a clip to edit it here.</p><p class="cd-dim">' + (t2 && t2.kind !== "audio" && t2.kind !== "bus" ? "Double-click in “" + esc(t2.name) + "”'s lane to make a new clip, or arm it (●) and record." : "Arm an audio track (●) and press R to record, or drag audio files onto it.") + "</p></div>"; return; }
    title.textContent = (f.clip.name || "Clip") + " · " + f.track.name;
    if (f.clip.kind === "audio") return drawAudio(body, f);
    var drum = ed.drum != null ? ed.drum : f.track.kind === "drums";
    return drum ? drawDrums(body, f) : drawRoll(body, f);
  }

  // ------------------------------------------------------------- the piano roll
  function drawRoll(body, f) {
    var c = f.clip;
    body.innerHTML = '<div class="cd-edtools"><div class="cd-seg"><button class="on">Piano roll</button><button data-e="drum">Drum grid</button></div>' +
      '<button data-e="quant" title="Quantize the selected notes (or all) to the snap (Q)">Quantize</button><label class="cd-f">Strength<input type="range" min="10" max="100" step="5" value="' + ed.q + '" data-e="qs"></label>' +
      '<button data-e="hum" title="Nudge timing and velocity a little, like a person playing">Humanize</button><label class="cd-f">±<input type="number" min="0" max="60" value="' + ed.hum.ms + '" data-e="hms" style="width:48px"> ms</label><label class="cd-f">±<input type="number" min="0" max="40" value="' + ed.hum.vel + '" data-e="hvel" style="width:44px"> vel</label>' +
      '<button data-e="up" title="Up a semitone (↑, Shift: octave)">▲</button><button data-e="down" title="Down a semitone">▼</button><button data-e="legato" title="Each note up to the next one">Legato</button>' +
      '<span class="cd-dim">' + (c.loopLen > 0 ? "Repeats every " + c.loopLen + " beats" : (c.notes || []).length + " notes") + '</span><button data-e="zo">−</button><button data-e="zi">+</button></div>' +
      '<div class="cd-roll"><div class="cd-roll-scroll"><canvas class="cd-roll-cv"></canvas></div><canvas class="cd-vel-cv" title="Velocity: drag the bars"></canvas></div>';
    tools(body, f);
    var sc = $(".cd-roll-scroll", body), cv = $(".cd-roll-cv", body), vel = $(".cd-vel-cv", body);
    var H = 88 * ed.rowH, W = 60 + Math.max(c.len, (c.loopLen || 0)) * ed.zoom + 40;
    cv.style.width = W + "px"; cv.style.height = H + "px";
    if (ed.clip !== c.id) { ed.clip = c.id; ed.sel = []; var ps = (c.notes || []).map(function (n) { return n.p; }), mid = ps.length ? (Math.min.apply(null, ps) + Math.max.apply(null, ps)) / 2 : 60; ed.scroll = null; ed.mid = mid; }
    requestAnimationFrame(function () { if (ed.scroll) { sc.scrollTop = ed.scroll[0]; sc.scrollLeft = ed.scroll[1]; } else sc.scrollTop = Math.max(0, (108 - ed.mid) * ed.rowH - sc.clientHeight / 2); });
    paintRoll(cv, f); paintVel(vel, f, sc);
    sc.onscroll = function () { ed.scroll = [sc.scrollTop, sc.scrollLeft]; paintVel(vel, f, sc); };
    rollEvents(cv, vel, sc, f);
  }
  function L(c) { return c.loopLen > 0 ? c.loopLen : c.len; }
  function noteY(p) { return (108 - p) * ed.rowH; }
  function paintRoll(cv, f) {
    var c = f.clip, dpr = Math.min(2, window.devicePixelRatio || 1), W = parseInt(cv.style.width, 10), H = parseInt(cv.style.height, 10);
    cv.width = Math.min(16000, W * dpr); cv.height = H * dpr; var g = cv.getContext("2d"), sx = cv.width / W; g.setTransform(sx, 0, 0, dpr, 0, 0);
    for (var p = 21; p <= 108; p++) { var y = noteY(p), black = [1, 3, 6, 8, 10].indexOf(p % 12) >= 0; g.fillStyle = black ? "#15181C" : "#1B1E23"; g.fillRect(60, y, W, ed.rowH); if (p % 12 === 0) { g.fillStyle = "#2A2F37"; g.fillRect(60, y + ed.rowH - 1, W, 1); } g.fillStyle = black ? "#22252B" : "#D9D4CA"; g.fillRect(0, y, black ? 36 : 58, ed.rowH - 1); if (p % 12 === 0) { g.fillStyle = "#555"; g.font = "9px Archivo"; g.fillText(UI.noteName(p), 38, y + ed.rowH - 2); } }
    var grid = D.SNAP[P().snap] || 0.25; if (grid * ed.zoom < 5) grid = 1;
    for (var b = 0; b <= Math.max(c.len, L(c)) + 1e-6; b += grid) { var bb = D.tempo.beatToBar(c.start + b); g.fillStyle = Math.abs(bb.beat) < 1e-6 ? "#3A414C" : Math.abs(bb.beat % 1) < 1e-6 ? "#2A2F37" : "#202329"; g.fillRect(60 + b * ed.zoom, 0, 1, H); }
    g.fillStyle = "rgba(0,0,0,.35)"; g.fillRect(60 + L(c) * ed.zoom, 0, W, H);   // (past the part that repeats)
    (c.notes || []).forEach(function (n, i) {
      var x = 60 + n.s * ed.zoom, y = noteY(n.p), w = Math.max(3, n.d * ed.zoom - 1), sel = ed.sel.indexOf(i) >= 0;
      g.fillStyle = sel ? "#F0D9A4" : "hsl(" + (40 - n.v / 4) + ",60%," + (38 + n.v / 5) + "%)"; g.fillRect(x, y + 1, w, ed.rowH - 2);
      g.fillStyle = "rgba(0,0,0,.35)"; g.fillRect(x + w - 3, y + 1, 3, ed.rowH - 2);
    });
  }
  function paintVel(cv, f, sc) {
    var c = f.clip, dpr = Math.min(2, window.devicePixelRatio || 1), w = cv.clientWidth, h = cv.clientHeight; cv.width = w * dpr; cv.height = h * dpr; var g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = "#101215"; g.fillRect(0, 0, w, h); g.fillStyle = "#59606B"; g.font = "10px Archivo"; g.fillText("Velocity", 4, 12);
    var off = sc.scrollLeft;
    (c.notes || []).forEach(function (n, i) { var x = 60 + n.s * ed.zoom - off, bh = n.v / 127 * (h - 6); if (x < 56 || x > w) return; g.fillStyle = ed.sel.indexOf(i) >= 0 ? "#F0D9A4" : "#E2C27E"; g.fillRect(x, h - bh, 3, bh); g.beginPath(); g.arc(x + 1.5, h - bh, 3, 0, 7); g.fill(); });
  }
  function audition(t, p) { D.live(t.id, [0x90, p, 96]); setTimeout(function () { D.live(t.id, [0x80, p, 0]); }, 220); }
  function rollEvents(cv, vel, sc, f) {
    api.focused = true;
    cv.onpointerdown = function (e) {
      api.focused = true; var r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, c = D.findClip(f.clip.id).clip, t = f.track;
      var pitch = 108 - Math.floor(y / ed.rowH), beat = (x - 60) / ed.zoom;
      if (x < 60) { audition(t, pitch); return; }
      var hit = -1, edge = false; (c.notes || []).forEach(function (n, i) { if (n.p === pitch && beat >= n.s && beat <= n.s + n.d) { hit = i; edge = (n.s + n.d - beat) * ed.zoom < 6; } });
      if (e.button === 2) { if (hit >= 0) D.edit("Delete note", function () { D.findClip(c.id).clip.notes.splice(hit, 1); }); ed.sel = []; return; }
      if (hit < 0 && (e.ctrlKey || e.metaKey)) return rollBand(cv, e, f);
      var g = D.SNAP[P().snap] || 0, snapB = function (b) { return e.shiftKey || !g ? b : Math.round(b / g) * g; };
      if (hit < 0) {   // a new note, its length dragged out
        var s = Math.max(0, g ? Math.floor(beat / g) * g : beat); if (s >= L(c)) return;
        D.edit("Add note", function () { var cc = D.findClip(c.id).clip; cc.notes.push({ p: pitch, v: 100, s: s, d: ed.lastLen }); hit = cc.notes.length - 1; });
        ed.sel = [hit]; edge = true; audition(t, pitch);
      } else if (ed.sel.indexOf(hit) < 0) ed.sel = e.shiftKey ? ed.sel.concat([hit]) : [hit];
      var orig = D.clone(D.findClip(c.id).clip.notes), x0 = e.clientX, y0 = e.clientY, first = true, copy = e.altKey && !edge, lastP = pitch;
      function mv(ev) {
        var db = (ev.clientX - x0) / ed.zoom, dp = -Math.round((ev.clientY - y0) / ed.rowH); if (first && Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 3) return;
        (first ? D.edit : D.nudge)(edge ? "Note length" : copy ? "Copy notes" : "Move notes", function () {
          var cc = D.findClip(c.id).clip;
          if (first && copy) { var base = cc.notes.length; ed.sel.forEach(function (i) { cc.notes.push(D.clone(orig[i])); }); ed.sel = ed.sel.map(function (_, k) { return base + k; }); orig = D.clone(cc.notes); }
          ed.sel.forEach(function (i) { var o = orig[i], n = cc.notes[i]; if (!o || !n) return; if (edge) { n.d = Math.max(g ? g / 2 : 0.05, snapB(o.s + o.d + db) - o.s); ed.lastLen = n.d; } else { n.s = D.clamp(snapB(o.s + db), 0, L(cc) - 0.01); n.p = D.clamp(o.p + dp, 0, 127); } });
        });
        if (!edge && dp + pitch !== lastP) { lastP = dp + pitch; audition(t, lastP); }
        first = false;
      }
      function up() { document.removeEventListener("pointermove", mv); document.removeEventListener("pointerup", up); UI.drawDock(); }
      document.addEventListener("pointermove", mv); document.addEventListener("pointerup", up);
    };
    cv.oncontextmenu = function (e) { e.preventDefault(); };
    vel.onpointerdown = function (e) {
      var r = vel.getBoundingClientRect(), first = true;
      function set(ev) { var x = ev.clientX - r.left + sc.scrollLeft, v = D.clamp(Math.round((1 - (ev.clientY - r.top) / r.height) * 127), 1, 127), cc = D.findClip(f.clip.id).clip, idx = [];
        (cc.notes || []).forEach(function (n, i) { var nx = 60 + n.s * ed.zoom; if (Math.abs(nx - x) < 5) idx.push(i); });
        if (ed.sel.length && idx.some(function (i) { return ed.sel.indexOf(i) >= 0; })) idx = ed.sel.slice();
        if (!idx.length) return; (first ? D.edit : D.nudge)("Velocity", function () { var c2 = D.findClip(f.clip.id).clip; idx.forEach(function (i) { if (c2.notes[i]) c2.notes[i].v = v; }); }); first = false; paintVel(vel, f, sc); }
      set(e); function up() { document.removeEventListener("pointermove", set); document.removeEventListener("pointerup", up); UI.drawDock(); } document.addEventListener("pointermove", set); document.addEventListener("pointerup", up);
    };
  }
  function rollBand(cv, e, f) {
    var r = cv.getBoundingClientRect(), x0 = e.clientX - r.left, y0 = e.clientY - r.top;
    function up(ev) { document.removeEventListener("pointerup", up); var x1 = ev.clientX - r.left, y1 = ev.clientY - r.top, b0 = (Math.min(x0, x1) - 60) / ed.zoom, b1 = (Math.max(x0, x1) - 60) / ed.zoom, p0 = 108 - Math.floor(Math.max(y0, y1) / ed.rowH), p1 = 108 - Math.floor(Math.min(y0, y1) / ed.rowH);
      ed.sel = []; (D.findClip(f.clip.id).clip.notes || []).forEach(function (n, i) { if (n.s + n.d > b0 && n.s < b1 && n.p >= p0 && n.p <= p1) ed.sel.push(i); }); UI.drawDock(); }
    document.addEventListener("pointerup", up);
  }
  function tools(body, f) {
    $(".cd-edtools", body).onclick = function (e) {
      var b = e.target.closest("[data-e]"); if (!b) return; var k = b.dataset.e, id = f.clip.id;
      function notes(fn, label) { D.edit(label, function () { var c = D.findClip(id).clip, list = ed.sel.length ? ed.sel.map(function (i) { return c.notes[i]; }).filter(Boolean) : c.notes; fn(list, c); }); }
      if (k === "drum") { ed.drum = true; UI.drawDock(); } else if (k === "roll") { ed.drum = false; UI.drawDock(); }
      else if (k === "quant") notes(function (l) { D.quantize(l, P().snap, ed.q / 100); }, "Quantize");
      else if (k === "hum") notes(function (l) { D.humanize(l, ed.hum.ms / 1000 * D.tempo.bpmAt(f.clip.start) / 60, ed.hum.vel); }, "Humanize");
      else if (k === "up" || k === "down") notes(function (l) { l.forEach(function (n) { n.p = D.clamp(n.p + (k === "up" ? 1 : -1) * (e.shiftKey ? 12 : 1), 0, 127); }); }, "Transpose");
      else if (k === "legato") notes(function (l) { var s = l.slice().sort(function (a, z) { return a.s - z.s; }); s.forEach(function (n, i) { var nx = s.slice(i + 1).filter(function (m) { return m.s > n.s + 1e-6; })[0]; if (nx) n.d = nx.s - n.s; }); }, "Legato");
      else if (k === "zi" || k === "zo") { ed.zoom = D.clamp(ed.zoom * (k === "zi" ? 1.25 : 0.8), 12, 600); UI.keep("prZoom", ed.zoom); UI.drawDock(); }
    };
    $$("[data-e=qs],[data-e=hms],[data-e=hvel]", body).forEach(function (i) { i.onchange = function () { if (i.dataset.e === "qs") { ed.q = +i.value; UI.keep("qStrength", ed.q); } else { ed.hum[i.dataset.e === "hms" ? "ms" : "vel"] = +i.value; UI.keep("humanize", ed.hum); } }; });
  }
  api.key = function (e) {
    var f = cur(); if (!f || f.clip.kind !== "midi" || !ed.body || !ed.body.isConnected) return false;
    var k = e.key, low = k.toLowerCase(), mod = e.ctrlKey || e.metaKey; if (/input|textarea|select/i.test(e.target.tagName || "")) return false;
    if (!ed.body.matches(":hover") && !api.focused) return false;
    if ((k === "Delete" || k === "Backspace") && ed.sel.length) { var s = ed.sel.slice().sort(function (a, b) { return b - a; }); D.edit("Delete notes", function () { var c = D.findClip(f.clip.id).clip; s.forEach(function (i) { c.notes.splice(i, 1); }); }); ed.sel = []; e.preventDefault(); return true; }
    if (mod && low === "a") { ed.sel = (f.clip.notes || []).map(function (_, i) { return i; }); UI.drawDock(); e.preventDefault(); return true; }
    if (!mod && low === "q") { D.edit("Quantize", function () { var c = D.findClip(f.clip.id).clip; D.quantize(ed.sel.length ? ed.sel.map(function (i) { return c.notes[i]; }) : c.notes, P().snap, ed.q / 100); }); e.preventDefault(); return true; }
    if ((k === "ArrowUp" || k === "ArrowDown") && ed.sel.length) { D.edit("Transpose", function () { var c = D.findClip(f.clip.id).clip; ed.sel.forEach(function (i) { var n = c.notes[i]; if (n) n.p = D.clamp(n.p + (k === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 12 : 1), 0, 127); }); }); e.preventDefault(); return true; }
    if ((k === "ArrowLeft" || k === "ArrowRight") && ed.sel.length) { var g = D.SNAP[P().snap] || 0.25; D.edit("Move notes", function () { var c = D.findClip(f.clip.id).clip; ed.sel.forEach(function (i) { var n = c.notes[i]; if (n) n.s = Math.max(0, n.s + (k === "ArrowLeft" ? -g : g)); }); }); e.preventDefault(); return true; }
    return false;
  };
  document.addEventListener("pointerdown", function (e) { api.focused = !!(ed.body && ed.body.contains(e.target)); });

  // ------------------------------------------------------------- the drum grid
  function drawDrums(body, f) {
    var c = f.clip, step = D.SNAP[P().snap] && D.SNAP[P().snap] <= 0.5 ? D.SNAP[P().snap] : 0.25, steps = Math.round(L(c) / step), used = {}; (c.notes || []).forEach(function (n) { used[n.p] = 1; });
    var rows = DRUMS.concat(Object.keys(used).map(Number).filter(function (p) { return !DRUMS.some(function (d) { return d[0] === p; }); }).map(function (p) { return [p, UI.noteName(p)]; }));
    body.innerHTML = '<div class="cd-edtools"><div class="cd-seg"><button data-e="roll">Piano roll</button><button class="on">Drum grid</button></div><span class="cd-dim">Click a step to add or remove a hit; drag across to paint. Shift-click: a soft hit. Steps follow the snap (' + esc(P().snap) + ').</span>' +
      '<button data-e="quant">Quantize</button><button data-e="hum">Humanize</button></div><div class="cd-drums"><div class="cd-dgrid" style="grid-template-columns:110px repeat(' + steps + ',minmax(18px,1fr))">' +
      rows.map(function (d) { var h = '<button class="cd-dname" data-dp="' + d[0] + '">' + esc(d[1]) + "</button>"; for (var s = 0; s < steps; s++) { var n = (c.notes || []).filter(function (x) { return x.p === d[0] && Math.abs(x.s - s * step) < step / 2; })[0], bb = D.tempo.beatToBar(c.start + s * step); h += '<i class="cd-step' + (n ? " on" : "") + (Math.abs(bb.beat % 1) < 1e-6 ? " beat" : "") + (Math.abs(bb.beat) < 1e-6 ? " bar" : "") + '" data-p="' + d[0] + '" data-s="' + s + '"' + (n ? ' style="--v:' + (n.v / 127) + '"' : "") + "></i>"; } return h; }).join("") + "</div></div>";
    tools(body, f);
    var grid = $(".cd-dgrid", body), painting = null;
    grid.onpointerdown = function (e) {
      var nm = e.target.closest("[data-dp]"); if (nm) { audition(f.track, +nm.dataset.dp); return; }
      var cell = e.target.closest(".cd-step"); if (!cell) return; painting = cell.classList.contains("on") ? "off" : "on"; toggle(cell, e.shiftKey); first = false;
      grid.setPointerCapture(e.pointerId);
    };
    var first = true;
    grid.onpointermove = function (e) { if (!painting) return; var cell = document.elementFromPoint(e.clientX, e.clientY); cell = cell && cell.closest && cell.closest(".cd-step"); if (cell && (painting === "on") !== cell.classList.contains("on")) toggle(cell, e.shiftKey, true); };
    grid.onpointerup = function () { painting = null; UI.drawDock(); };
    function toggle(cell, soft, quiet) {
      var p = +cell.dataset.p, s = +cell.dataset.s * step, on = !cell.classList.contains("on");
      (quiet ? D.nudge : D.edit)(on ? "Add hit" : "Remove hit", function () { var cc = D.findClip(f.clip.id).clip; cc.notes = (cc.notes || []).filter(function (n) { return !(n.p === p && Math.abs(n.s - s) < step / 2); }); if (on) cc.notes.push({ p: p, v: soft ? 64 : 104, s: s, d: step * 0.9 }); });
      cell.classList.toggle("on", on); if (on) audition(f.track, p);
    }
  }

  // ------------------------------------------------------------- an audio clip
  function drawAudio(body, f) {
    var c = f.clip, a = c.audio, buf = D.buffers[D.clipSrc(c)], w = a.warp;
    body.innerHTML = '<div class="cd-audio"><canvas class="cd-aw"></canvas><div class="cd-acontrols">' +
      '<label class="cd-f">Gain <input type="range" min="-30" max="12" step="0.1" value="' + (a.gain || 0) + '" data-a="gain"><output>' + (a.gain || 0).toFixed(1) + ' dB</output></label>' +
      '<label class="cd-f">Fade in <input type="number" min="0" max="20000" step="1" value="' + Math.round((a.fadeIn || 0) * 1000) + '" data-a="fadeIn"> ms</label><label class="cd-f">Fade out <input type="number" min="0" max="20000" step="1" value="' + Math.round((a.fadeOut || 0) * 1000) + '" data-a="fadeOut"> ms</label>' +
      '<label class="cd-check"><input type="checkbox" data-a="loop"' + (a.loop ? " checked" : "") + '> Loop (stretch the right edge to repeat it)</label><button data-a="norm">Normalise</button>' +
      '<div class="cd-warp"><b>Tempo and key</b> ' + (w ? 'A loop at <input type="number" min="30" max="300" step="0.1" value="' + w.from + '" data-a="wfrom" style="width:64px"> BPM' + (w.key ? " in " + esc(w.key) : "") + ', stretched to the song (' + Math.round(D.tempo.bpmAt(c.start) * 10) / 10 + ' BPM, ' + esc(P().key) + ').' :
        'Its own tempo <input type="number" min="30" max="300" step="0.1" placeholder="BPM" data-a="srcbpm" style="width:70px"> <button data-a="fit">Fit to the song\'s tempo</button>') +
      ' <label class="cd-f">Pitch <input type="number" min="-12" max="12" step="1" value="' + (w ? w.semis || 0 : 0) + '" data-a="semis" style="width:52px"> semitones</label></div>' +
      (c.takes && c.takes.length > 1 ? '<div class="cd-takelist"><b>Takes</b> ' + c.takes.map(function (k) { return '<button data-take="' + k.id + '" class="' + (k.id === c.take ? "on" : "") + '">' + esc(k.name) + "</button>"; }).join("") + '<span class="cd-dim">Comping: split the clip (S) where you want to change takes, then pick a take for each piece.</span></div>' : "") +
      "</div></div>";
    var cv = $(".cd-aw", body); paintAudio(cv, c, buf);
    function set(label, fn) { D.edit(label, function () { fn(D.findClip(c.id).clip); }); }
    $$("[data-a]", body).forEach(function (i) {
      var k = i.dataset.a;
      if (k === "gain") { i.oninput = function () { i.nextElementSibling.textContent = (+i.value).toFixed(1) + " dB"; D.nudge("Clip gain", function () { D.findClip(c.id).clip.audio.gain = +i.value; }); }; }
      else if (k === "fadeIn" || k === "fadeOut") i.onchange = function () { set(k === "fadeIn" ? "Fade in" : "Fade out", function (cc) { cc.audio[k] = Math.max(0.002, +i.value / 1000); }); };
      else if (k === "loop") i.onchange = function () { set("Loop clip", function (cc) { cc.audio.loop = i.checked; }); };
      else if (k === "norm") i.onclick = function () { if (!buf) return; var pk = 0; for (var ch = 0; ch < buf.numberOfChannels; ch++) { var d = buf.getChannelData(ch); for (var j = 0; j < d.length; j++) pk = Math.max(pk, Math.abs(d[j])); } if (pk > 0) set("Normalise", function (cc) { cc.audio.gain = Math.round((20 * Math.log10(0.891 / pk)) * 10) / 10; }); };
      else if (k === "fit" || k === "wfrom" || k === "semis") { var go = function () { var bpm = +($('[data-a="srcbpm"]', body) || $('[data-a="wfrom"]', body) || {}).value || (w && w.from), semis = +$('[data-a="semis"]', body).value || 0; warpTo(c, bpm, semis); }; if (k === "fit") i.onclick = go; else i.onchange = go; }
    });
    $$("[data-take]", body).forEach(function (b) { b.onclick = function () { set("Pick take", function (cc) { cc.take = b.dataset.take; }); }; });
  }
  function warpTo(c, bpm, semis) {
    var w = c.audio.warp, origId = w ? w.orig : D.clipSrc(c), orig = D.buffers[origId]; if (!orig) return;
    if (!bpm && !semis) return UI.say("Type the clip's own tempo first.", true);
    var want = D.tempo.bpmAt(c.start), st = window.CDawStretch.stretch(orig, bpm ? bpm / want : 1, semis || 0), id = D.addAudio(st);
    D.edit("Fit to tempo", function () { var cc = D.findClip(c.id).clip; cc.audio.src = id; cc.audio.warp = { from: bpm || want, orig: origId, semis: semis || 0, at: want, key: null }; cc.audio.offset = 0; if (!cc.audio.loop) cc.len = D.tempo.secToBeat(D.tempo.beatToSec(cc.start) + st.duration) - cc.start; });
  }
  function paintAudio(cv, c, buf) {
    var dpr = Math.min(2, window.devicePixelRatio || 1), w = cv.clientWidth, h = cv.clientHeight; cv.width = w * dpr; cv.height = h * dpr; var g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = "#0E1013"; g.fillRect(0, 0, w, h); if (!buf) { g.fillStyle = "#9AA1AB"; g.fillText("The audio for this clip is missing.", 10, 20); return; }
    var off = c.audio.offset || 0, dur = D.tempo.beatToSec(c.start + c.len) - D.tempo.beatToSec(c.start), total = buf.duration, mid = h / 2, d = buf.getChannelData(0), gain = D.dbToGain(c.audio.gain || 0);
    var a = off / total * w, b = Math.min(1, (off + dur) / total) * w; g.fillStyle = "rgba(226,194,126,.08)"; g.fillRect(a, 0, b - a, h);
    for (var x = 0; x < w; x++) { var s = Math.floor(x / w * d.length), e = Math.floor((x + 1) / w * d.length), lo = 0, hi = 0; for (var i = s; i < e; i += 8) { if (d[i] < lo) lo = d[i]; if (d[i] > hi) hi = d[i]; } g.fillStyle = x >= a && x <= b ? "#E2C27E" : "#4A4F58"; g.fillRect(x, mid - hi * mid * gain, 1, Math.max(1, (hi - lo) * mid * gain)); }
    g.fillStyle = "#9AA1AB"; g.font = "11px Archivo"; g.fillText(total.toFixed(2) + " s · " + buf.sampleRate + " Hz · " + (buf.numberOfChannels > 1 ? "stereo" : "mono") + " · the bright part plays", 8, 14);
  }

  // ------------------------------------------------------------- the track's sound (instrument layers)
  function drawSound(body, t) {
    if (!t || t.kind === "audio" || t.kind === "bus") { body.innerHTML = '<div class="cd-empty"><p>' + (t && t.kind === "audio" ? "An audio track plays what you record or drop on it. Its effects are in the Mixer." : "Pick an instrument or drums track to choose its sound.") + "</p></div>"; return; }
    var list = SND ? SND.list() : [], cats = SND ? SND.CAT_ORDER : [], layers = t.layers || [];
    body.innerHTML = '<div class="cd-sound">' + layers.map(function (l, i) {
      var s = SND && SND.byId(l.sound), locked = s && SND.locked(s);
      return '<div class="cd-layer" data-l="' + i + '"><div class="cd-line"><b>Layer ' + (i + 1) + '</b><select data-ls="sound">' + cats.map(function (cat) { var items = list.filter(function (x) { return x.category === cat && (t.kind !== "drums" || x.drums || cat === "Drums"); }); return items.length ? '<optgroup label="' + esc(cat) + '">' + items.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === l.sound ? " selected" : "") + ">" + esc(x.name) + (x.bankName && !x.builtin ? " · " + esc(x.bankName) : "") + (SND.locked(x) ? " (" + esc(SND.lockText(x)) + ")" : "") + "</option>"; }).join("") + "</optgroup>" : ""; }).join("") + "</select>" +
        (locked ? '<span class="cd-lock">' + esc(SND.lockText(s)) + ": a built-in sound plays instead</span>" : "") + (layers.length > 1 ? '<button class="ghost" data-ldel="' + i + '">Remove</button>' : "") + "</div>" +
        '<div class="cd-line"><label class="cd-f">Keys <input type="number" min="0" max="127" value="' + (l.lo || 0) + '" data-ls="lo" style="width:56px">–<input type="number" min="0" max="127" value="' + (l.hi == null ? 127 : l.hi) + '" data-ls="hi" style="width:56px"></label>' +
        '<label class="cd-f">Velocity <input type="number" min="1" max="127" value="' + (l.velLo || 1) + '" data-ls="velLo" style="width:52px">–<input type="number" min="1" max="127" value="' + (l.velHi || 127) + '" data-ls="velHi" style="width:52px"></label>' +
        '<label class="cd-f">Octave <input type="number" min="-3" max="3" value="' + (l.octave || 0) + '" data-ls="octave" style="width:48px"></label><label class="cd-f">Level <input type="range" min="0" max="1.5" step="0.01" value="' + (l.volume == null ? 1 : l.volume) + '" data-ls="volume"></label><label class="cd-f">Pan <input type="range" min="-1" max="1" step="0.01" value="' + (l.pan || 0) + '" data-ls="pan"></label></div></div>';
    }).join("") + '<div class="cd-line">' + (layers.length < 4 ? '<button data-ladd>Add a layer</button>' : "") + '<span class="cd-dim">Layers play together - a piano with a pad under it, or split the keyboard (a bass below C3, keys above). Plan sounds are open with your sound plan\'s package key.</span></div></div>';
    function set(i, k, v) { D.edit("Sound", function () { var tt = D.track(t.id); tt.layers[i][k] = v; }); }
    $$("[data-ls]", body).forEach(function (inp) { var i = +inp.closest("[data-l]").dataset.l, k = inp.dataset.ls; inp.onchange = function () { set(i, k, k === "sound" ? inp.value : +inp.value); if (k === "sound") audition(t, 60); }; });
    $$("[data-ldel]", body).forEach(function (b) { b.onclick = function () { D.edit("Remove layer", function () { D.track(t.id).layers.splice(+b.dataset.ldel, 1); }); }; });
    var add = $("[data-ladd]", body); if (add) add.onclick = function () { D.edit("Add layer", function () { D.track(t.id).layers.push({ sound: "builtin:pad", lo: 0, hi: 127, velLo: 1, velHi: 127, octave: 0, transpose: 0, volume: 0.7, pan: 0 }); }); };
  }
  api.playhead = function (st) { };
  api.draw = draw;
  UI.parts.editors = api;
})();
