/* The DAW's arrange view: the ruler (loop and punch strip, bars, sections, tempo changes), the tracks with their clips,
 * automation lanes, and every way of editing clips with the mouse:
 *   click: select (Shift adds) · drag: move (snaps; onto another track of the same kind) · Alt-drag: copy
 *   edges: trim · top corners (audio): fades · double-click: edit it (an empty instrument lane: a new 1-bar clip)
 *   right-click: split, duplicate, loop, mute, rename, colour, takes, reverse, delete · drag on empty space: select several
 *   keys: Delete, Ctrl+D duplicate, S split at the playhead, Ctrl+C / Ctrl+V, arrows nudge, M mute, Shift+S solo */
(function () {
  "use strict";
  var D = window.CDaw, UI = window.CDawUI, U = UI.U, $ = UI.$, $$ = UI.$$, esc = UI.esc;
  var el = null, wrap = null, content = null, peaks = {};
  function P() { return D.project(); }
  function HW() { return UI.headerW(); }
  function RH() { return UI.compact() ? 52 : 70; }   // the ruler's height
  function bx(b) { return b * U.zoom; }
  function xb(x) { return Math.max(0, x / U.zoom); }
  function snap(b, e) { return e && e.shiftKey && e.type !== "pointerdown" ? b : D.snapBeat(b); }
  function totalBeats() { var bpb = D.tempo.bpb(); return Math.max(D.songEnd(), P().loop.end || 0, (P().markers || []).reduce(function (a, m) { return Math.max(a, m.beat); }, 0)) + bpb * 16; }
  var AUTO_RANGE = { volume: [-60, 6, "dB"], pan: [-1, 1, ""] };
  function autoRange(t, key) {
    if (AUTO_RANGE[key]) return AUTO_RANGE[key];
    if (key.indexOf("send:") === 0) return [-60, 6, "dB"];
    var parts = key.split(":"), fx = (t.inserts || []).filter(function (f) { return f.id === parts[1]; })[0], def = fx && D.fxDef(fx), prm = def && def.params.filter(function (q) { return q[0] === parts[2]; })[0];
    return prm ? [prm[2], prm[3], prm[5]] : [0, 1, ""];
  }
  function autoName(t, key) {
    if (key === "volume") return "Volume"; if (key === "pan") return "Pan";
    if (key.indexOf("send:") === 0) { var b = D.track(key.slice(5)); return "Send to " + (b ? b.name : "bus"); }
    var parts = key.split(":"), fx = (t.inserts || []).filter(function (f) { return f.id === parts[1]; })[0], def = fx && D.fxDef(fx), prm = def && def.params.filter(function (q) { return q[0] === parts[2]; })[0];
    return (def ? def.name : "Effect") + " " + (prm ? prm[1] : parts[2]);
  }
  function autoParams(t) {
    var out = [["volume", "Volume"], ["pan", "Pan"]];
    (t.sends || []).forEach(function (s) { out.push(["send:" + s.to, autoName(t, "send:" + s.to)]); });
    (t.inserts || []).forEach(function (f) { var def = D.fxDef(f); if (!def || f.type === "cmfx") return; def.params.forEach(function (q) { if (!q[7]) out.push(["fx:" + f.id + ":" + q[0], def.name + " " + q[1]]); }); });
    return out;
  }
  UI.autoParams = autoParams; UI.autoName = autoName;

  function build(container) {
    el = container;
    el.innerHTML = '<div class="cd-lanes-wrap"><div class="cd-content"><canvas class="cd-grid"></canvas><div class="cd-rulerrow"><div class="cd-corner"><button class="cd-add" title="Add a track">+ Track</button></div><canvas class="cd-ruler"></canvas></div><div class="cd-rows"></div><div class="cd-playhead"></div><div class="cd-band" hidden></div></div></div>';
    wrap = $(".cd-lanes-wrap", el); content = $(".cd-content", el);
    wrap.addEventListener("scroll", function () { paintGrid(); paintRuler(); });
    wrap.addEventListener("wheel", function (e) { if (e.ctrlKey || e.metaKey) { e.preventDefault(); var r = wrap.getBoundingClientRect(); UI.zoom(e.deltaY < 0 ? 1.15 : 0.87, xb(e.clientX - r.left + wrap.scrollLeft - HW())); } }, { passive: false });
    $(".cd-add", el).onclick = function () { addTrackMenu(this); };
    rulerEvents($(".cd-ruler", el));
    laneEvents();
  }
  function addTrackMenu(btn) {
    function add(kind, name, sound) { D.edit("Add a track", function (p) { var t = D.newTrack(kind, name, sound); t.color = D.COLORS[p.tracks.length % D.COLORS.length]; if (kind === "bus") p.tracks.push(t); else D.insertTrack(t); U.sel = t.id; }); }
    UI.menu(btn, [["Audio (a microphone, a guitar, an interface input)", function () { add("audio"); }], ["Instrument (keys, synths, strings…)", function () { add("instrument", "Keys"); }], ["Drums", function () { add("drums"); }], null,
      ["Bus (a reverb or delay return, or a group)", function () { add("bus", "Bus"); }]]);
  }

  // ------------------------------------------------------------- drawing
  function draw(what) {
    if (!el) return;
    var p = P(), W = Math.max(totalBeats() * U.zoom, wrap.clientWidth), rows = $(".cd-rows", el);
    content.style.width = (HW() + W) + "px";
    if (what === "nudge" && rows.childElementCount) { updateHeads(); return; }
    var html = "";
    p.tracks.forEach(function (t) {
      var sel = t.id === U.sel, h = t.height || 64, kindIcon = { audio: "〰", instrument: "♪", drums: "🥁", bus: "⇢" }[t.kind] || "♪";
      html += '<div class="cd-row' + (sel ? " sel" : "") + (t.kind === "bus" ? " bus" : "") + '" data-t="' + t.id + '" style="height:' + h + 'px;--tc:' + t.color + '"><div class="cd-head" data-t="' + t.id + '"><i class="cd-tc"></i>' +
        '<div class="cd-hl1"><span class="cd-ticon" title="' + esc(t.kind) + '">' + kindIcon + '</span><input class="cd-tname" value="' + esc(t.name) + '" aria-label="Track name"><button class="cd-tmenu" data-tm="' + t.id + '" title="More">⋯</button></div>' +
        '<div class="cd-hl2"><button class="cd-m' + (t.mute ? " on" : "") + '" data-tb="mute" title="Mute (M)">M</button><button class="cd-s' + (t.solo ? " on" : "") + '" data-tb="solo" title="Solo (Shift+S)">S</button>' +
        (t.kind !== "bus" ? '<button class="cd-r' + (t.arm ? " on" : "") + '" data-tb="arm" title="Arm for recording">●</button>' : "") + (t.kind === "audio" ? '<button class="cd-i' + (t.monitor === "in" ? " on" : t.monitor === "auto" ? " auto" : "") + '" data-tb="monitor" title="Hear the input: automatic (while armed), always, or off">I</button>' : "") +
        '<button class="cd-a' + (t.lanes && t.lanes.length ? " on" : "") + '" data-tb="auto" title="Automation lanes">A</button><input class="cd-vol" type="range" min="-60" max="6" step="0.1" value="' + t.volume + '" data-tv="' + t.id + '" title="Volume ' + t.volume.toFixed(1) + ' dB"><canvas class="cd-hmeter" data-hm="' + t.id + '"></canvas></div></div>' +
        '<div class="cd-lane" data-lane="' + t.id + '">' + t.clips.map(function (c) { return clipHtml(t, c); }).join("") + "</div></div>";
      (t.lanes || []).forEach(function (key) {
        var r = autoRange(t, key);
        html += '<div class="cd-row cd-autorow" data-t="' + t.id + '" data-auto="' + esc(key) + '" style="height:56px;--tc:' + t.color + '"><div class="cd-head cd-autohead"><i class="cd-tc"></i><select data-aset="' + esc(key) + '">' + autoParams(t).map(function (o) { return '<option value="' + esc(o[0]) + '"' + (o[0] === key ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("") +
          '</select><button class="ghost" data-adel="' + esc(key) + '" title="Hide this lane (its points stay)">✕</button><span class="cd-arange">' + r[0] + "…" + r[1] + " " + esc(r[2]) + '</span></div><div class="cd-lane cd-autolane"><canvas class="cd-autocv" data-acv="' + esc(key) + '"></canvas></div></div>';
      });
    });
    rows.innerHTML = html + '<div class="cd-row cd-endrow"><div class="cd-head cd-endhead"><button class="cd-add2">+ Add a track</button></div><div class="cd-lane cd-endlane"></div></div>';
    $(".cd-add2", rows).onclick = function () { addTrackMenu(this); };
    content.style.height = (RH() + rows.offsetHeight) + "px";
    $$(".cd-clip", rows).forEach(paintClip);
    $$(".cd-autocv", rows).forEach(paintAuto);
    headEvents(rows);
    paintGrid(); paintRuler();
  }
  function clipHtml(t, c) {
    var sel = U.clips.indexOf(c.id) >= 0, col = c.color || t.color, tk = c.takes && c.takes.length > 1 ? '<span class="cd-takes">' + (c.takes.findIndex(function (k) { return k.id === c.take; }) + 1) + "/" + c.takes.length + "</span>" : "";
    return '<div class="cd-clip ' + c.kind + (sel ? " sel" : "") + (c.mute ? " muted" : "") + '" data-c="' + c.id + '" style="left:' + bx(c.start) + "px;width:" + Math.max(3, bx(c.len)) + "px;--cc:" + col + '"><span class="cd-cname">' + esc(c.name || t.name || (c.kind === "audio" ? "Audio" : "MIDI")) + (c.audio && c.audio.loop || c.loopLen ? " ↻" : "") + "</span>" + tk + '<canvas class="cd-ccv"></canvas><i class="cd-hl"></i><i class="cd-hr"></i>' + (c.kind === "audio" ? '<i class="cd-fi" title="Fade in"></i><i class="cd-fo" title="Fade out"></i>' : "") + "</div>";
  }
  function peaksOf(id) {
    var b = D.buffers[id]; if (!b) return null; if (peaks[id] && peaks[id].b === b) return peaks[id];
    var per = 256, n = Math.ceil(b.length / per), mn = new Float32Array(n), mx = new Float32Array(n), ch = [];
    for (var c = 0; c < b.numberOfChannels; c++) ch.push(b.getChannelData(c));
    for (var i = 0; i < n; i++) { var lo = 0, hi = 0; for (var k = i * per; k < Math.min(b.length, (i + 1) * per); k += 2) { var v = 0; for (var q = 0; q < ch.length; q++) v += ch[q][k]; v /= ch.length; if (v < lo) lo = v; if (v > hi) hi = v; } mn[i] = lo; mx[i] = hi; }
    return (peaks[id] = { b: b, mn: mn, mx: mx, per: per, rate: b.sampleRate });
  }
  function paintClip(div) {
    var f = D.findClip(div.dataset.c); if (!f) return;
    var c = f.clip, cv = $(".cd-ccv", div), w = Math.min(8000, div.clientWidth), h = div.clientHeight - 16, dpr = Math.min(2, window.devicePixelRatio || 1);
    if (w < 2 || h < 4) return; cv.width = w * dpr; cv.height = h * dpr; cv.style.width = w + "px"; cv.style.height = h + "px";
    var g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = "rgba(255,255,255,.82)";
    var scale = div.clientWidth / w;
    if (c.kind === "audio") {
      var pk = peaksOf(D.clipSrc(c)); if (!pk) { g.fillText("missing audio", 4, 12); return; }
      var gain = D.dbToGain(c.audio.gain || 0), mid = h / 2, s0 = D.tempo.beatToSec(c.start), loopLen = pk.mn.length * pk.per / pk.rate - (c.audio.offset || 0);
      for (var x = 0; x < w; x++) {
        var beat = c.start + xb(x * scale), into = D.tempo.beatToSec(beat) - s0; if (c.audio.loop && loopLen > 0) into = into % loopLen;
        var i = Math.floor(((c.audio.offset || 0) + into) * pk.rate / pk.per); if (i < 0 || i >= pk.mn.length) continue;
        g.fillRect(x, mid - pk.mx[i] * gain * mid, 1, Math.max(1, (pk.mx[i] - pk.mn[i]) * gain * mid));
      }
      // the fades
      var fi = (c.audio.fadeIn || 0), fo = (c.audio.fadeOut || 0), fiX = (D.tempo.secToBeat(s0 + fi) - c.start) * U.zoom / scale, foX = w - (c.start + c.len - D.tempo.secToBeat(D.tempo.beatToSec(c.start + c.len) - fo)) * U.zoom / scale;
      g.fillStyle = "rgba(0,0,0,.35)"; g.beginPath(); g.moveTo(0, 0); g.lineTo(fiX, 0); g.lineTo(0, h); g.fill(); g.beginPath(); g.moveTo(w, 0); g.lineTo(foX, 0); g.lineTo(w, h); g.fill();
      $(".cd-fi", div).style.left = Math.max(0, fiX * scale - 5) + "px"; $(".cd-fo", div).style.left = Math.min(div.clientWidth - 10, foX * scale - 5) + "px";
    } else {
      var notes = c.notes || [], L = c.loopLen > 0 ? c.loopLen : c.len, lo = 127, hi = 0; notes.forEach(function (n) { lo = Math.min(lo, n.p); hi = Math.max(hi, n.p); }); if (lo > hi) return; lo -= 2; hi += 2;
      var rowH = Math.max(1.5, Math.min(6, h / (hi - lo + 1)));
      for (var r = 0; r * L < c.len; r++) { if (r > 0) { g.fillStyle = "rgba(0,0,0,.25)"; g.fillRect(bx(r * L) / scale, 0, 1, h); g.fillStyle = "rgba(255,255,255,.82)"; } notes.forEach(function (n) { if (n.s >= L) return; var s = r * L + n.s; if (s >= c.len) return; g.globalAlpha = 0.45 + n.v / 254; g.fillRect(bx(s) / scale, (hi - n.p) / (hi - lo + 1) * h, Math.max(1.5, bx(Math.min(n.d, c.len - s)) / scale), rowH); }); }
      g.globalAlpha = 1;
    }
  }
  UI.paintClips = function () { if (el) $$(".cd-clip", el).forEach(paintClip); };
  function paintGrid() {
    if (!el) return;
    var cv = $(".cd-grid", el), w = Math.max(10, wrap.clientWidth - HW()), h = content.offsetHeight - RH(), dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.style.left = (wrap.scrollLeft + HW()) + "px"; cv.style.top = RH() + "px"; cv.style.width = w + "px"; cv.style.height = Math.max(0, h) + "px";
    cv.width = w * dpr; cv.height = Math.max(1, h) * dpr; var g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    var from = xb(wrap.scrollLeft), to = xb(wrap.scrollLeft + w), p = P();
    if (p.loop.on) { g.fillStyle = "rgba(226,194,126,.05)"; g.fillRect(bx(p.loop.start) - wrap.scrollLeft, 0, bx(p.loop.end - p.loop.start), h); }
    if (p.punch.on) { g.fillStyle = "rgba(229,72,77,.06)"; g.fillRect(bx(p.punch.start) - wrap.scrollLeft, 0, bx(p.punch.end - p.punch.start), h); }
    var step = D.SNAP[p.snap] || 1; if (step * U.zoom < 6) step = 1; if (U.zoom < 6) step = 4;
    for (var b = Math.floor(from / step) * step; b <= to; b += step) {
      var bb = D.tempo.beatToBar(b), x = Math.round(bx(b) - wrap.scrollLeft) + 0.5, isBar = Math.abs(bb.beat) < 1e-6, isBeat = Math.abs(bb.beat - Math.round(bb.beat)) < 1e-6;
      if (!isBar && U.zoom < 10) continue;
      g.fillStyle = isBar ? "#2E343D" : isBeat ? "#22262D" : "#1B1E23"; g.fillRect(x, 0, 1, h);
    }
    (p.markers || []).forEach(function (m) { var x = bx(m.beat) - wrap.scrollLeft; if (x >= 0 && x <= w) { g.fillStyle = "rgba(141,181,222,.35)"; g.fillRect(x, 0, 1, h); } });
  }
  function paintRuler() {
    if (!el) return;
    var cv = $(".cd-ruler", el), w = Math.max(10, wrap.clientWidth - HW()), h = RH(), dpr = Math.min(2, window.devicePixelRatio || 1), p = P(), compact = UI.compact();
    cv.style.width = w + "px"; cv.style.height = h + "px"; cv.width = w * dpr; cv.height = h * dpr;
    var g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.fillStyle = "#14171B"; g.fillRect(0, 0, w, h);
    var sl = wrap.scrollLeft, X = function (b) { return bx(b) - sl; };
    // the loop / punch strip
    g.fillStyle = "#101215"; g.fillRect(0, 0, w, 14);
    if (p.loop.end > p.loop.start) { g.fillStyle = p.loop.on ? "#B4873C" : "#3A3426"; g.fillRect(X(p.loop.start), 2, bx(p.loop.end - p.loop.start), 10); }
    if (p.punch.on) { g.fillStyle = "#C2383D"; g.fillRect(X(p.punch.start), 9, bx(p.punch.end - p.punch.start), 4); }
    // bars
    g.font = "600 11px Archivo, sans-serif"; var from = xb(sl), to = xb(sl + w), lastX = -99, bar0 = D.tempo.beatToBar(from).bar;
    for (var bar = bar0; ; bar++) { var b = D.tempo.barToBeat(bar); if (b > to) break; var x = X(b); g.fillStyle = "#3A414C"; g.fillRect(Math.round(x), 14, 1, 18); if (x - lastX > 26) { g.fillStyle = "#C9C3B8"; g.fillText(String(bar + 1), x + 3, 27); lastX = x; } if (U.zoom > 20) { var per = D.tempo.beatToBar(b).per; for (var k = 1; k < per; k++) { g.fillStyle = "#2A2F37"; g.fillRect(Math.round(X(b + k)), 24, 1, 8); } } }
    // sections (markers)
    g.fillStyle = "#181B20"; g.fillRect(0, 32, w, 18); g.font = "600 11px Archivo, sans-serif";
    (p.markers || []).slice().sort(function (a, z) { return a.beat - z.beat; }).forEach(function (m, i, arr) { var x = X(m.beat), nx = i + 1 < arr.length ? X(arr[i + 1].beat) : x + 400; if (nx < 0 || x > w) return; g.fillStyle = m.color || "#2D4A66"; g.fillRect(x, 33, Math.max(2, nx - x - 1), 16); g.fillStyle = "#E7EEF6"; g.save(); g.beginPath(); g.rect(x, 33, Math.max(2, nx - x - 4), 16); g.clip(); g.fillText(m.name, x + 4, 45); g.restore(); });
    if (!(p.markers || []).length && !compact) { g.fillStyle = "#59606B"; g.fillText("Double-click here to add a section (Verse, Chorus…)", 8 - Math.min(0, sl), 45); }
    if (!compact) {   // tempo / time-signature changes
      g.fillStyle = "#111316"; g.fillRect(0, 50, w, 20); g.font = "11px Archivo, sans-serif";
      g.fillStyle = "#9AA1AB"; g.fillText(Math.round(p.bpm * 10) / 10 + " BPM  " + p.sig.join("/"), 4 - sl > 4 ? 4 : 4, 64);
      (p.tempos || []).forEach(function (t) { var x = X(D.tempo.barToBeat(t.bar)); g.fillStyle = "#E8A65A"; g.fillRect(x, 51, 2, 18); g.fillText(t.bpm + " BPM", x + 4, 64); });
      (p.sigs || []).forEach(function (s) { var x = X(D.tempo.barToBeat(s.bar)); g.fillStyle = "#8DB5DE"; g.fillRect(x, 51, 2, 18); g.fillText(s.n + "/" + s.d, x + 4, 64 - 0); });
    }
  }
  function playhead(st) {
    if (!el) return;
    var ph = $(".cd-playhead", el), x = HW() + bx(st.pos); ph.style.transform = "translateX(" + x + "px)"; ph.classList.toggle("rec", st.recording);
    if (st.playing && !U.dragging) { var vis0 = wrap.scrollLeft + HW(), vis1 = wrap.scrollLeft + wrap.clientWidth - 40; if (x > vis1 || x < vis0) wrap.scrollLeft = Math.max(0, x - HW() - 60); }
  }
  function meters() {
    if (!el) return; var g = D.graph(); if (!g) return;
    $$(".cd-hmeter", el).forEach(function (cv) { var s = g.strips[cv.dataset.hm]; if (!s) return; UI.meterDraw(cv, UI.level("h" + cv.dataset.hm, s.meter), false); });
  }
  function updateHeads() { var p = P(); p.tracks.forEach(function (t) { var v = el.querySelector('[data-tv="' + t.id + '"]'); if (v && document.activeElement !== v) v.value = t.volume; }); }

  // ------------------------------------------------------------- automation lanes
  function paintAuto(cv) {
    var row = cv.closest(".cd-row"), t = D.track(row.dataset.t), key = cv.dataset.acv, list = (t.auto || {})[key] || [], r = autoRange(t, key);
    var w = Math.min(16000, Math.max(10, totalBeats() * U.zoom)), h = 52, dpr = Math.min(2, window.devicePixelRatio || 1); cv.style.width = w + "px"; cv.style.height = h + "px"; cv.width = Math.min(16000, w * dpr); cv.height = h * dpr;
    var g = cv.getContext("2d"), sx = cv.width / w; g.setTransform(dpr * sx / dpr * dpr / dpr, 0, 0, dpr, 0, 0); g.setTransform(sx, 0, 0, dpr, 0, 0);
    var Y = function (v) { return 4 + (1 - (v - r[0]) / (r[1] - r[0])) * (h - 8); };
    var base = key === "volume" ? t.volume : key === "pan" ? t.pan : null;
    if (base != null) { g.strokeStyle = "#3A414C"; g.setLineDash([3, 4]); g.beginPath(); g.moveTo(0, Y(base)); g.lineTo(w, Y(base)); g.stroke(); g.setLineDash([]); }
    if (!list.length) { g.fillStyle = "#59606B"; g.font = "11px Archivo, sans-serif"; g.fillText("Click to add a point. Drag to move it, double-click to remove it.", 8, 30); return; }
    g.strokeStyle = t.color; g.lineWidth = 2; g.beginPath(); g.moveTo(0, Y(list[0].v)); list.forEach(function (q) { g.lineTo(bx(q.b), Y(q.v)); }); g.lineTo(w, Y(list[list.length - 1].v)); g.stroke();
    g.fillStyle = "#F0D9A4"; list.forEach(function (q) { g.beginPath(); g.arc(bx(q.b), Y(q.v), 4, 0, 7); g.fill(); });
  }
  function autoEvents(cv, e) {
    var row = cv.closest(".cd-row"), t = D.track(row.dataset.t), key = cv.dataset.acv, r = autoRange(t, key), rect = cv.getBoundingClientRect();
    function at(ev) { var b = snap(xb(ev.clientX - rect.left), ev), v = r[0] + (1 - D.clamp((ev.clientY - rect.top - 4) / (rect.height - 8), 0, 1)) * (r[1] - r[0]); return { b: b, v: Math.round(v * 100) / 100 }; }
    function hit(ev) { var list = (t.auto || {})[key] || [], q = at(ev); for (var i = 0; i < list.length; i++) { var x = bx(list[i].b), y = 4 + (1 - (list[i].v - r[0]) / (r[1] - r[0])) * (rect.height - 8); if (Math.abs(x - (ev.clientX - rect.left)) < 7 && Math.abs(y - (ev.clientY - rect.top)) < 7) return i; } return -1; }
    if (e.detail === 2) { var hi = hit(e); if (hi >= 0) D.edit("Remove automation point", function () { t.auto[key].splice(hi, 1); }); return; }
    var i = hit(e);
    if (i < 0) { var q = at(e); D.edit("Add automation point", function () { t.auto = t.auto || {}; var l = t.auto[key] = t.auto[key] || []; l.push(q); l.sort(function (a, z) { return a.b - z.b; }); }); i = (D.track(t.id).auto[key] || []).findIndex(function (x) { return x.b === q.b && x.v === q.v; }); t = D.track(t.id); }
    U.dragging = true; var first = true;
    function mv(ev) { var q = at(ev), tt = D.track(row.dataset.t), l = tt.auto[key]; if (!l || !l[i]) return; (first ? D.edit : D.nudge)("Move automation point", function () { var l2 = D.track(row.dataset.t).auto[key]; l2[i].b = q.b; l2[i].v = q.v; }); first = false; }
    function up() { U.dragging = false; document.removeEventListener("pointermove", mv); document.removeEventListener("pointerup", up); D.edit("Move automation point", function () { var l2 = D.track(row.dataset.t).auto[key]; if (l2) l2.sort(function (a, z) { return a.b - z.b; }); }); }
    document.addEventListener("pointermove", mv); document.addEventListener("pointerup", up);
  }

  // ------------------------------------------------------------- the track headers
  function headEvents(rows) {
    $$(".cd-head[data-t]", rows).forEach(function (h) {
      h.onpointerdown = function (e) { if (e.target.closest("input,button,select")) return; U.sel = h.dataset.t; UI.draw("select"); };
    });
    $$(".cd-tname", rows).forEach(function (inp) { inp.onchange = function () { var id = inp.closest("[data-t]").dataset.t, v = inp.value.trim() || "Track"; D.edit("Rename track", function () { D.track(id).name = v; }); }; inp.onfocus = function () { U.sel = inp.closest("[data-t]").dataset.t; }; });
    $$("[data-tb]", rows).forEach(function (b) { b.onclick = function () { var id = b.closest("[data-t]").dataset.t, k = b.dataset.tb; U.sel = id;
      if (k === "auto") { D.edit("Automation lane", function () { var t = D.track(id); t.lanes = t.lanes && t.lanes.length ? [] : ["volume"]; }); return; }
      if (k === "monitor") { D.edit("Input monitoring", function () { var t = D.track(id); t.monitor = { auto: "in", "in": "off", off: "auto" }[t.monitor || "auto"]; }); return; }
      D.edit(k === "mute" ? "Mute" : k === "solo" ? "Solo" : "Arm", function () { var t = D.track(id); t[k] = !t[k]; }); }; });
    $$("[data-tv]", rows).forEach(function (s) { s.oninput = function () { var id = s.dataset.tv, v = +s.value; D.nudge("Volume", function () { D.track(id).volume = v; }); s.title = "Volume " + v.toFixed(1) + " dB"; }; s.ondblclick = function () { var id = s.dataset.tv; D.edit("Volume", function () { D.track(id).volume = 0; }); }; });
    $$("[data-tm]", rows).forEach(function (b) { b.onclick = function () { trackMenu(b, D.track(b.dataset.tm)); }; });
    $$("[data-aset]", rows).forEach(function (s) { s.onchange = function () { var id = s.closest("[data-t]").dataset.t, old = s.dataset.aset, v = s.value; D.edit("Automation lane", function () { var t = D.track(id), i = t.lanes.indexOf(old); if (i >= 0) t.lanes[i] = v; }); }; });
    $$("[data-adel]", rows).forEach(function (b) { b.onclick = function () { var id = b.closest("[data-t]").dataset.t, k = b.dataset.adel; D.edit("Hide automation lane", function () { var t = D.track(id); t.lanes = t.lanes.filter(function (x) { return x !== k; }); }); }; });
  }
  function trackMenu(btn, t) {
    var p = P(), buses = p.tracks.filter(function (x) { return x.kind === "bus" && x.id !== t.id; });
    var items = [];
    if (t.kind === "instrument" || t.kind === "drums") items.push(["Choose its sound…", function () { U.sel = t.id; UI.openEditor("sound"); }]);
    if (t.kind === "audio") items.push(["Input: " + ({ "1": "input 1", "2": "input 2", "1+2": "inputs 1 + 2 (stereo)" }[t.input] || "input 1") + " - change", function () { D.edit("Input", function () { var x = D.track(t.id); x.input = { "1": "2", "2": "1+2", "1+2": "1" }[x.input] || "1"; }); }]);
    items.push(["Add an automation lane", function () { D.edit("Automation lane", function () { var x = D.track(t.id), opts = autoParams(x).map(function (o) { return o[0]; }).filter(function (k) { return x.lanes.indexOf(k) < 0; }); if (opts.length) x.lanes.push(opts[0]); }); }]);
    if (buses.length && t.kind !== "bus") items.push(["Send to " + buses[0].name, function () { D.edit("Send", function () { var x = D.track(t.id); if (!x.sends.some(function (s) { return s.to === buses[0].id; })) x.sends.push({ to: buses[0].id, level: -12, pre: false }); }); UI.openEditor("mixer"); }]);
    items.push(["Output: " + (t.output === "master" || !t.output ? "the main mix" : (D.track(t.output) || {}).name || "a bus") + " - change", function () { var outs = ["master"].concat(buses.map(function (b) { return b.id; })); D.edit("Output", function () { var x = D.track(t.id), i = outs.indexOf(x.output || "master"); x.output = outs[(i + 1) % outs.length]; }); }]);
    items.push(null, ["Taller", function () { D.edit("Track height", function () { var x = D.track(t.id); x.height = Math.min(220, (x.height || 64) + 24); }, { what: "select" }); }], ["Shorter", function () { D.edit("Track height", function () { var x = D.track(t.id); x.height = Math.max(40, (x.height || 64) - 24); }, { what: "select" }); }],
      ["Colour", function () { D.edit("Colour", function () { var x = D.track(t.id); x.color = D.COLORS[(D.COLORS.indexOf(x.color) + 1) % D.COLORS.length]; }); }],
      ["Duplicate", function () { D.edit("Duplicate track", function (q) { var c = D.clone(t); c.id = D.uid("t"); c.name = t.name + " 2"; c.arm = false; c.clips.forEach(function (cl) { cl.id = D.uid("c"); }); var i = q.tracks.findIndex(function (x) { return x.id === t.id; }); q.tracks.splice(i + 1, 0, c); }); }],
      ["Move up", function () { D.edit("Move track", function (q) { var i = q.tracks.findIndex(function (x) { return x.id === t.id; }); if (i > 0) q.tracks.splice(i - 1, 0, q.tracks.splice(i, 1)[0]); }); }],
      ["Move down", function () { D.edit("Move track", function (q) { var i = q.tracks.findIndex(function (x) { return x.id === t.id; }); if (i < q.tracks.length - 1) q.tracks.splice(i + 1, 0, q.tracks.splice(i, 1)[0]); }); }], null,
      ["Delete track", function () { D.edit("Delete track", function (q) { q.tracks = q.tracks.filter(function (x) { return x.id !== t.id; }); q.tracks.forEach(function (x) { x.sends = (x.sends || []).filter(function (s) { return s.to !== t.id; }); if (x.output === t.id) x.output = "master"; }); }); }]);
    UI.menu(btn, items);
  }

  // ------------------------------------------------------------- the ruler: playhead, loop, punch, sections, tempo
  function rulerEvents(cv) {
    cv.addEventListener("pointerdown", function (e) {
      var r = cv.getBoundingClientRect(), y = e.clientY - r.top, b = xb(e.clientX - r.left + wrap.scrollLeft), p = P();
      if (y < 14) {   // the loop strip: drag to set the loop (Alt: punch)
        var punch = e.altKey, a0 = D.snapBeat(b), first = true; U.dragging = true;
        var mv = function (ev) { var b2 = D.snapBeat(xb(ev.clientX - r.left + wrap.scrollLeft)), lo = Math.min(a0, b2), hi = Math.max(a0, b2); if (hi - lo < 0.25) return; (first ? D.edit : D.nudge)(punch ? "Punch range" : "Loop range", function (q) { var o = punch ? q.punch : q.loop; o.start = lo; o.end = hi; o.on = true; }); first = false; paintRuler(); paintGrid(); };
        var up = function () { U.dragging = false; document.removeEventListener("pointermove", mv); document.removeEventListener("pointerup", up); };
        document.addEventListener("pointermove", mv); document.addEventListener("pointerup", up); return;
      }
      if (y >= 32 && y < 50) {   // sections
        var hitM = (p.markers || []).filter(function (m) { return Math.abs(bx(m.beat) - bx(b)) < 6 || (b >= m.beat && b < m.beat + 8 / U.zoom * 40 && Math.abs(bx(b) - bx(m.beat)) < 60); })[0];
        if (e.detail === 2) { if (hitM) renameMarker(hitM); else { var at = D.snapBeat(b, "bar"), names = ["Intro", "Verse", "Pre-chorus", "Chorus", "Bridge", "Tag", "Outro"]; D.edit("Add section", function (q) { q.markers.push({ id: D.uid("m"), beat: at, name: names[q.markers.length % names.length] }); }); } return; }
        if (e.button === 2 && hitM) { e.preventDefault(); UI.menu(null, [["Rename", function () { renameMarker(hitM); }], ["Colour", function () { D.edit("Section colour", function (q) { var m = q.markers.filter(function (x) { return x.id === hitM.id; })[0], cols = ["#2D4A66", "#4A3E22", "#3E2D4A", "#2D4A3A", "#4A2D2D"]; m.color = cols[(cols.indexOf(m.color) + 1) % cols.length]; }); }], ["Loop this section", function () { var ms = p.markers.slice().sort(function (a, z) { return a.beat - z.beat; }), i = ms.findIndex(function (x) { return x.id === hitM.id; }), end = i + 1 < ms.length ? ms[i + 1].beat : hitM.beat + D.tempo.bpb() * 8; D.edit("Loop", function (q) { q.loop = { on: true, start: hitM.beat, end: end }; }); }], ["Delete", function () { D.edit("Delete section", function (q) { q.markers = q.markers.filter(function (x) { return x.id !== hitM.id; }); }); }]], e.clientX, e.clientY); return; }
        if (hitM) { var f = true; U.dragging = true; var mv2 = function (ev) { var nb = D.snapBeat(xb(ev.clientX - r.left + wrap.scrollLeft)); (f ? D.edit : D.nudge)("Move section", function (q) { q.markers.filter(function (x) { return x.id === hitM.id; })[0].beat = nb; }); f = false; paintRuler(); paintGrid(); }; var up2 = function () { U.dragging = false; document.removeEventListener("pointermove", mv2); document.removeEventListener("pointerup", up2); }; document.addEventListener("pointermove", mv2); document.addEventListener("pointerup", up2); return; }
        D.setPos(D.snapBeat(b)); return;
      }
      if (y >= 50 && !UI.compact()) {   // tempo / signature: double-click to add a change at that bar, click one to edit it
        var bar = D.tempo.beatToBar(b).bar + (D.tempo.beatToBar(b).beat > D.tempo.beatToBar(b).per / 2 ? 1 : 0);
        var ex = (p.tempos || []).filter(function (t) { return Math.abs(bx(D.tempo.barToBeat(t.bar)) - bx(b)) < 30; })[0];
        if (e.detail === 2 || ex) return tempoDialog(ex ? ex.bar : bar, ex);
        D.setPos(D.snapBeat(b)); return;
      }
      // the bars: click to move the playhead, drag to scrub
      D.setPos(Math.max(0, D.snapBeat(b))); var mv3 = function (ev) { D.setPos(Math.max(0, xb(ev.clientX - r.left + wrap.scrollLeft))); }, up3 = function () { document.removeEventListener("pointermove", mv3); document.removeEventListener("pointerup", up3); };
      document.addEventListener("pointermove", mv3); document.addEventListener("pointerup", up3);
    });
    cv.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  }
  function renameMarker(m) { modal("Rename section", '<input id="cdmn" value="' + esc(m.name) + '">', function (d) { var v = $("#cdmn", d).value.trim() || "Section"; D.edit("Rename section", function (q) { q.markers.filter(function (x) { return x.id === m.id; })[0].name = v; }); }); }
  function tempoDialog(bar, ex) {
    var p = P(), sigEx = (p.sigs || []).filter(function (s) { return s.bar === bar; })[0];
    modal("Changes at bar " + (bar + 1), '<label>Tempo from here <input id="cdtb" type="number" min="30" max="300" step="0.1" value="' + (ex ? ex.bpm : D.tempo.bpmAt(D.tempo.barToBeat(bar))) + '"></label><label>Time signature from here <select id="cdts"><option value="">No change</option>' + ["4/4", "3/4", "6/8", "2/4", "5/4", "7/8", "12/8"].map(function (s) { return "<option" + (sigEx && sigEx.n + "/" + sigEx.d === s ? " selected" : "") + ">" + s + "</option>"; }).join("") + '</select></label>' + (ex || sigEx ? '<label class="cd-check"><input type="checkbox" id="cdtr"> Remove the changes at this bar</label>' : ""), function (d) {
      var rm = $("#cdtr", d) && $("#cdtr", d).checked, v = D.clamp(+$("#cdtb", d).value, 30, 300), s = $("#cdts", d).value;
      D.edit("Tempo change", function (q) { q.tempos = (q.tempos || []).filter(function (t) { return t.bar !== bar; }); q.sigs = (q.sigs || []).filter(function (x) { return x.bar !== bar; }); if (rm || bar === 0) { if (bar === 0 && !rm) { q.bpm = v; if (s) q.sig = s.split("/").map(Number); } return; } if (Math.abs(v - D.tempo.bpmAt(D.tempo.barToBeat(bar) - 0.01)) > 0.01) q.tempos.push({ bar: bar, bpm: v }); if (s) { var ns = s.split("/").map(Number); q.sigs.push({ bar: bar, n: ns[0], d: ns[1] }); } });
      if (D.rewarp()) D.fire("change", "rewarp");
    });
  }
  function modal(title, body, ok) {
    var m = $(".cd-modal", U.root); m.innerHTML = '<div class="cd-dialog"><h3>' + esc(title) + '</h3><div class="cd-form">' + body + '</div><div class="cd-line end"><button data-m="no">Cancel</button><button class="primary" data-m="ok">OK</button></div></div>'; m.hidden = false;
    var f = m.querySelector("input,select"); if (f) { f.focus(); if (f.select) f.select(); }
    m.onclick = function (e) { var b = e.target.closest("[data-m]"); if (!b) return; m.hidden = true; if (b.dataset.m === "ok") ok(m); };
    m.onkeydown = function (e) { if (e.key === "Enter") { m.hidden = true; ok(m); } if (e.key === "Escape") m.hidden = true; };
  }
  UI.modal = modal;

  // ------------------------------------------------------------- clips with the mouse
  function laneEvents() {
    wrap.addEventListener("pointerdown", function (e) {
      if (e.target.closest(".cd-head,.cd-rulerrow")) return;
      var acv = e.target.closest(".cd-autocv"); if (acv) { autoEvents(acv, e); return; }
      var clipEl = e.target.closest(".cd-clip"), lane = e.target.closest(".cd-lane[data-lane]");
      if (e.button === 2) { if (clipEl) { if (U.clips.indexOf(clipEl.dataset.c) < 0) U.clips = [clipEl.dataset.c]; UI.draw("select"); clipMenu(e); } return; }
      if (!clipEl) { if (lane) { U.sel = lane.dataset.lane; if (e.detail === 2) return newClipAt(lane, e); band(e); } return; }
      var id = clipEl.dataset.c, f = D.findClip(id); if (!f) return;
      if (e.detail === 2) { U.clips = [id]; U.sel = f.track.id; UI.openEditor("editor"); UI.draw("select"); return; }
      U.sel = f.track.id;
      if (e.shiftKey) { var i = U.clips.indexOf(id); if (i >= 0) U.clips.splice(i, 1); else U.clips.push(id); UI.draw("select"); return; }
      if (U.clips.indexOf(id) < 0) U.clips = [id];
      var mode = e.target.classList.contains("cd-hl") ? "trimL" : e.target.classList.contains("cd-hr") ? "trimR" : e.target.classList.contains("cd-fi") ? "fadeIn" : e.target.classList.contains("cd-fo") ? "fadeOut" : "move";
      dragClips(e, mode, e.altKey);
    });
    wrap.addEventListener("contextmenu", function (e) { if (e.target.closest(".cd-lane")) e.preventDefault(); });
    wrap.addEventListener("dragover", function (e) { if (e.target.closest(".cd-lane")) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } });
    wrap.addEventListener("drop", function (e) {
      var lane = e.target.closest(".cd-lane"); if (!lane) return; e.preventDefault();
      var r = wrap.getBoundingClientRect(), beat = D.snapBeat(xb(e.clientX - r.left + wrap.scrollLeft - HW())), tid = lane.dataset.lane || null;
      if (UI.parts.browser && UI.parts.browser.drop(e, tid, beat)) return;
      var files = Array.prototype.slice.call(e.dataTransfer.files || []);
      files.reduce(function (pr, file, i) { return pr.then(function () { return file.arrayBuffer().then(function (b) { return D.importAudio(i === 0 ? tid : null, new Uint8Array(b), file.name, beat); }); }); }, Promise.resolve()).catch(function () { UI.say("That file isn't audio this computer can read.", true); });
    });
  }
  function newClipAt(lane, e) {
    var t = D.track(lane.dataset.lane); if (!t || t.kind === "audio" || t.kind === "bus") return;
    var r = lane.getBoundingClientRect(), b = D.tempo.barToBeat(D.tempo.beatToBar(xb(e.clientX - r.left)).bar), len = D.tempo.bpb(b);
    var cl = D.edit("New clip", function () { var c = { id: D.uid("c"), kind: "midi", start: b, len: len, name: t.name, notes: [] }; D.track(t.id).clips.push(c); return c; });
    U.clips = [cl.id]; UI.openEditor("editor"); UI.draw("select");
  }
  function band(e) {
    var r = content.getBoundingClientRect(), x0 = e.clientX - r.left, y0 = e.clientY - r.top, b = $(".cd-band", el), moved = false;
    if (!D.state().playing) { var bb = Math.max(0, D.snapBeat(xb(x0 - HW()))); D.setPos(bb); }
    function mv(ev) { var x1 = ev.clientX - r.left, y1 = ev.clientY - r.top; if (Math.abs(x1 - x0) + Math.abs(y1 - y0) < 5) return; moved = true; b.hidden = false; b.style.left = Math.min(x0, x1) + "px"; b.style.top = Math.min(y0, y1) + "px"; b.style.width = Math.abs(x1 - x0) + "px"; b.style.height = Math.abs(y1 - y0) + "px"; }
    function up() { document.removeEventListener("pointermove", mv); document.removeEventListener("pointerup", up); if (!moved) { U.clips = []; UI.draw("select"); return; }
      var br = b.getBoundingClientRect(); b.hidden = true; U.clips = $$(".cd-clip", el).filter(function (c) { var cr = c.getBoundingClientRect(); return cr.right > br.left && cr.left < br.right && cr.bottom > br.top && cr.top < br.bottom; }).map(function (c) { return c.dataset.c; }); UI.draw("select"); }
    document.addEventListener("pointermove", mv); document.addEventListener("pointerup", up);
  }
  function dragClips(e, mode, copy) {
    var x0 = e.clientX, y0 = e.clientY, orig = {}, p = P(), first = true, ids = U.clips.slice(), anchor = D.findClip(ids[ids.length - 1] || "") || D.findClip(e.target.closest(".cd-clip").dataset.c);
    ids.forEach(function (id) { var f = D.findClip(id); if (f) orig[id] = { track: f.track.id, clip: D.clone(f.clip) }; });
    var srcTrackIdx = p.tracks.findIndex(function (t) { return t.id === anchor.track.id; }), copied = null;
    U.dragging = true;
    function mv(ev) {
      var dxB = (ev.clientX - x0) / U.zoom; if (first && Math.abs(ev.clientX - x0) < 3 && Math.abs(ev.clientY - y0) < 3) return;
      var label = { move: copy ? "Copy clip" : "Move clip", trimL: "Trim clip", trimR: "Trim clip", fadeIn: "Fade in", fadeOut: "Fade out" }[mode];
      (first ? D.edit : D.nudge)(label, function (q) {
        if (first && copy && mode === "move") { copied = {}; ids.forEach(function (id) { var o = orig[id], c = D.clone(o.clip); c.id = D.uid("c"); D.track(o.track).clips.push(c); copied[id] = c.id; }); }
        // which track it's over (moving only)
        var rowEl = document.elementFromPoint(ev.clientX, ev.clientY), row = rowEl && rowEl.closest && rowEl.closest(".cd-row[data-t]:not(.cd-autorow)"), dTrack = row ? q.tracks.findIndex(function (t) { return t.id === row.dataset.t; }) - srcTrackIdx : 0;
        ids.forEach(function (id) {
          var o = orig[id], cid = copied ? id : id, f = D.findClip(copied ? id : id); if (!f) return;
          var c = f.clip, oc = o.clip;
          if (mode === "move") {
            var ns = Math.max(0, D.snapBeat(oc.start + dxB)); if (ev.shiftKey) ns = Math.max(0, oc.start + dxB); c.start = ns;
            var ti = q.tracks.findIndex(function (t) { return t.id === o.track; }) + dTrack, tt = q.tracks[ti];
            if (dTrack && tt && tt.kind !== "bus" && (tt.kind === "audio") === (c.kind === "audio") && tt.id !== f.track.id) { f.track.clips = f.track.clips.filter(function (x) { return x !== c; }); tt.clips.push(c); }
          } else if (mode === "trimR") {
            var ne = Math.max(oc.start + 0.0625, ev.shiftKey ? oc.start + oc.len + dxB : D.snapBeat(oc.start + oc.len + dxB));
            if (c.kind === "audio" && !c.audio.loop) { var buf = D.buffers[D.clipSrc(c)]; if (buf) ne = Math.min(ne, D.tempo.secToBeat(D.tempo.beatToSec(c.start) + buf.duration - (c.audio.offset || 0))); }
            if (c.kind === "midi" && ne > oc.start + oc.len && !(oc.loopLen > 0)) c.loopLen = oc.len;   // (stretching a MIDI clip past its end repeats it)
            c.len = ne - c.start;
          } else if (mode === "trimL") {
            var ns2 = Math.min(oc.start + oc.len - 0.0625, Math.max(0, ev.shiftKey ? oc.start + dxB : D.snapBeat(oc.start + dxB))), d = ns2 - oc.start;
            if (c.kind === "audio") { var off = (oc.audio.offset || 0) + D.tempo.beatToSec(ns2) - D.tempo.beatToSec(oc.start); if (off < 0 && !c.audio.loop) { off = 0; ns2 = oc.start - D.tempo.secToBeat(oc.audio.offset || 0) + 0; d = ns2 - oc.start; } c.audio.offset = Math.max(0, off); }
            else c.notes = (oc.notes || []).map(function (n) { return Object.assign({}, n, { s: n.s - d }); }).filter(function (n) { return n.s >= 0 || n.s + n.d > 0; }).map(function (n) { if (n.s < 0) { n.d += n.s; n.s = 0; } return n; });
            c.start = ns2; c.len = oc.len - d;
          } else if (mode === "fadeIn" || mode === "fadeOut") {
            var dur = D.tempo.beatToSec(oc.start + oc.len) - D.tempo.beatToSec(oc.start), dxS = (ev.clientX - x0) / U.zoom * 60 / D.tempo.bpmAt(oc.start);
            if (mode === "fadeIn") c.audio.fadeIn = D.clamp((oc.audio.fadeIn || 0) + dxS, 0.002, dur - (c.audio.fadeOut || 0)); else c.audio.fadeOut = D.clamp((oc.audio.fadeOut || 0) - dxS, 0.002, dur - (c.audio.fadeIn || 0));
          }
        });
      });
      first = false;
    }
    function up() { U.dragging = false; document.removeEventListener("pointermove", mv); document.removeEventListener("pointerup", up); if (!first) D.fire("change", "drop"); }
    document.addEventListener("pointermove", mv); document.addEventListener("pointerup", up);
  }
  function selected() { return U.clips.map(D.findClip).filter(Boolean); }
  function clipMenu(e) {
    var s = selected(), one = s.length === 1 ? s[0] : null, pos = D.state().pos;
    var items = [["Split at the playhead", splitSel, s.some(function (f) { return pos > f.clip.start && pos < f.clip.start + f.clip.len; }), "S"], ["Duplicate", duplicate, true, "Ctrl+D"], ["Copy", copySel, true, "Ctrl+C"], [s.every(function (f) { return f.clip.mute; }) ? "Unmute" : "Mute", function () { D.edit("Mute clip", function () { var m = !s.every(function (f) { return f.clip.mute; }); selected().forEach(function (f) { f.clip.mute = m; }); }); }]];
    if (one) items.push(["Rename", function () { modal("Rename clip", '<input id="cdcn" value="' + esc(one.clip.name || "") + '">', function (d) { var v = $("#cdcn", d).value; D.edit("Rename clip", function () { D.findClip(one.clip.id).clip.name = v; }); }); }]);
    items.push(["Colour", function () { D.edit("Clip colour", function () { selected().forEach(function (f) { var i = D.COLORS.indexOf(f.clip.color || f.track.color); f.clip.color = D.COLORS[(i + 1) % D.COLORS.length]; }); }); }]);
    if (one && one.clip.kind === "audio") {
      items.push([one.clip.audio.loop ? "Stop looping" : "Loop it (stretch the right edge to repeat it)", function () { D.edit("Loop clip", function () { var c = D.findClip(one.clip.id).clip; c.audio.loop = !c.audio.loop; }); }]);
      items.push(["Reverse", function () { var b = D.buffers[D.clipSrc(one.clip)]; if (!b) return; var r = new AudioBuffer({ numberOfChannels: b.numberOfChannels, length: b.length, sampleRate: b.sampleRate }); for (var c = 0; c < b.numberOfChannels; c++) { var d = new Float32Array(b.getChannelData(c)); d.reverse(); r.copyToChannel(d, c); } var id = D.addAudio(r); D.edit("Reverse", function () { var c2 = D.findClip(one.clip.id).clip; c2.audio.src = id; c2.takes = null; c2.take = null; }); }]);
      if (one.clip.takes && one.clip.takes.length > 1) one.clip.takes.forEach(function (k) { items.push(["Take: " + k.name + (k.id === one.clip.take ? " ✓" : ""), function () { D.edit("Pick take", function () { D.findClip(one.clip.id).clip.take = k.id; }); }]); });
    }
    if (one && one.clip.kind === "midi") items.push(["Quantize to " + P().snap, function () { D.edit("Quantize", function () { D.quantize(D.findClip(one.clip.id).clip.notes, P().snap, 1); }); }]);
    items.push(null, ["Delete", deleteSel, true, "Del"]);
    UI.menu(null, items, e.clientX, e.clientY);
  }
  function splitSel() { var pos = D.state().pos; D.edit("Split", function () { selected().forEach(function (f) { var r = D.split(f.clip.id, D.snapBeat(pos) === pos ? pos : pos); if (r) U.clips.push(r.id); }); }); }
  function duplicate() { var s = selected(); if (!s.length) return; var lo = Math.min.apply(null, s.map(function (f) { return f.clip.start; })), hi = Math.max.apply(null, s.map(function (f) { return f.clip.start + f.clip.len; })), sh = Math.ceil((hi - lo) / D.tempo.bpb() - 1e-6) * D.tempo.bpb() || hi - lo; var made = []; D.edit("Duplicate", function () { s.forEach(function (f) { var c = D.clone(f.clip); c.id = D.uid("c"); c.start += sh; D.track(f.track.id).clips.push(c); made.push(c.id); }); }); U.clips = made; UI.draw("select"); }
  function copySel() { var s = selected(); if (!s.length) return; var lo = Math.min.apply(null, s.map(function (f) { return f.clip.start; })); U.clipboard = s.map(function (f) { return { track: f.track.id, clip: D.clone(f.clip), rel: f.clip.start - lo }; }); UI.say(s.length + " clip" + (s.length > 1 ? "s" : "") + " copied."); }
  function paste() { if (!U.clipboard) return; var at = D.snapBeat(D.state().pos), made = []; D.edit("Paste", function (q) { U.clipboard.forEach(function (x) { var t = D.track(x.track) || UI.track(); if (!t) return; var c = D.clone(x.clip); c.id = D.uid("c"); c.start = at + x.rel; t.clips.push(c); made.push(c.id); }); }); U.clips = made; UI.draw("select"); }
  function deleteSel() { var ids = U.clips.slice(); if (!ids.length) return; D.edit("Delete", function (q) { q.tracks.forEach(function (t) { t.clips = t.clips.filter(function (c) { return ids.indexOf(c.id) < 0; }); }); }); U.clips = []; }
  function nudgeSel(dir) { var g = D.SNAP[P().snap] || 0.25; D.edit("Nudge", function () { selected().forEach(function (f) { f.clip.start = Math.max(0, f.clip.start + dir * g); }); }); }
  function key(e) {
    var k = e.key, low = k.toLowerCase(), mod = e.ctrlKey || e.metaKey;
    if ((k === "Delete" || k === "Backspace") && U.clips.length) { deleteSel(); return true; }
    if (mod && low === "d") { duplicate(); return true; }
    if (mod && low === "c" && U.clips.length) { copySel(); return true; }
    if (mod && low === "v") { paste(); return true; }
    if (mod && low === "a") { U.clips = []; P().tracks.forEach(function (t) { t.clips.forEach(function (c) { U.clips.push(c.id); }); }); UI.draw("select"); return true; }
    if (!mod && low === "s" && !e.shiftKey) { if (U.clips.length) splitSel(); return true; }
    if (!mod && low === "s" && e.shiftKey) { var t = UI.track(); if (t) D.edit("Solo", function () { D.track(t.id).solo = !D.track(t.id).solo; }); return true; }
    if (!mod && low === "m") { var t2 = UI.track(); if (t2) D.edit("Mute", function () { D.track(t2.id).mute = !D.track(t2.id).mute; }); return true; }
    if (U.clips.length && (k === "ArrowLeft" || k === "ArrowRight")) { nudgeSel(k === "ArrowLeft" ? -1 : 1); return true; }
    if (k === "ArrowUp" || k === "ArrowDown") { var p = P(), i = p.tracks.findIndex(function (x) { return x.id === U.sel; }); var ni = D.clamp(i + (k === "ArrowUp" ? -1 : 1), 0, p.tracks.length - 1); U.sel = p.tracks[ni].id; UI.draw("select"); return true; }
    return false;
  }
  UI.parts.arrange = { build: build, draw: draw, playhead: playhead, meters: meters, key: key, paintGrid: paintGrid, paintRuler: paintRuler };
})();
