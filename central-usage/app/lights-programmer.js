/* Central Control - the scene programmer and each light's own settings (10.2).
 *
 * Program lights (a scene's row on the Songs page, next to its preset): pick lights (the list, a group, or the little
 * map of the stage) and set everything they can do - on/off, intensity, colour (picker, white / amber / UV, colour
 * temperature, the colour wheel's slots), position (pan / tilt pad, fine, speed), zoom, focus, iris, gobo and its
 * rotation, prism, frost, strobe, a moving effect spread across the selection, and a fade. It plays live while you
 * program. "Record into the scene" keeps it: the scene's preset gives the base look and what you programmed sits on
 * top and wins. "Save as a preset" makes it one of the church's own presets.
 *
 * Stored on a scene (a song's look cue) as cue.prog = {fixtureId: values}, and on a preset as look.prog. The values:
 *   on (false = off), dim 0-1, color "#rrggbb", w a uv 0-1, ctemp 0-1, wheel (dmx), pan tilt 0-1, speed 0-1, zoom focus
 *   iris frost 0-1, gobo (dmx), goborot 0-1, prism (dmx), prismrot 0-1, strobe 0-1, fx {type, speed beats, size, ph},
 *   fade (beats).
 *
 * A light's own settings (fixture.*, the ⚙ on the Fixtures page; fixture-picker.js draws them):
 *   movable (true / false / unset = from its profile), home {pan, tilt}, panRange / tiltRange [lo, hi] 0-1, upsideDown,
 *   maxDim 0-1, curve ("linear" | "square" | "smooth" | "led"), calib {r, g, b} 0-1.5, auto (false = the auto lights and
 *   the AI leave it alone), tags (its own groups).
 *
 * The engine calls apply() for every light after the scene's preset, and limit() last (lights.js render()). */
(function (global) {
  "use strict";
  var L = function () { return global.CULights; };
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function hexRgb(h) { var m = /^#?([0-9a-f]{6})$/i.exec(String(h || "")); if (!m) return [1, 1, 1]; var n = parseInt(m[1], 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }
  function copy(o) { return JSON.parse(JSON.stringify(o || {})); }
  var KEYS = ["dim", "r", "g", "b", "w", "a", "uv", "strobe", "pan", "tilt", "haze"];
  var EXTRA = ["zoom", "focus", "iris", "frost", "gobo", "goborot", "prism", "prismrot", "ctemp", "wheel"];

  // ---------------------------------------------------------------- the engine side
  var P = { open: false, cue: null, target: null, look: null, sel: [], work: {}, hist: [], fut: [], highlight: false, changed: false };
  var extras = {}, programmed = {}, lastBase = null;
  function mixState(a, b, p) { if (p >= 1) return b; if (p <= 0) return a; var o = Object.assign({}, a); KEYS.forEach(function (k) { if (a[k] != null && b[k] != null) o[k] = a[k] + (b[k] - a[k]) * p; }); o.strobe = p >= 0.5 ? b.strobe : a.strobe; return o; }
  function movable(f) { if (f.movable === true || f.movable === false) return f.movable; var p = L().profileOf(f); return !!(p && p.mover); }
  function fxMod(fx, beats, s) {   // a programmed effect: on the song's beat, each light at its own phase
    var sp = Math.max(0.25, fx.speed || 1), ph = (beats / sp + (fx.ph || 0)) % 1, size = fx.size == null ? 1 : fx.size;
    switch (fx.type) {
      case "pulse": s.dim *= 1 - size * ph; break;
      case "breathe": s.dim *= 1 - size * (0.5 - 0.5 * Math.cos(ph * Math.PI * 2)); break;
      case "chase": s.dim *= ph < 0.5 ? 1 : 1 - size; break;
      case "alternate": s.dim *= ((Math.floor(beats / sp) + Math.round((fx.ph || 0) * 2)) % 2) ? 1 - size : 1; break;
      case "sparkle": s.dim *= (Math.sin(beats * 37.1 + (fx.ph || 0) * 91.7) > 0.6) ? 1 : 1 - size; break;
      case "sweep": s.pan = clamp(s.pan + 0.18 * size * Math.sin(ph * Math.PI * 2), 0, 1); break;
      case "circle": s.pan = clamp(s.pan + 0.15 * size * Math.sin(ph * Math.PI * 2), 0, 1); s.tilt = clamp(s.tilt + 0.12 * size * Math.cos(ph * Math.PI * 2), 0, 1); break;
      case "rainbow": var c = hsv(ph, 1, 1); s.r = c[0]; s.g = c[1]; s.b = c[2]; s.w = 0; break;
    }
    return s;
  }
  function hsv(h, s, v) { var i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s); return [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6]; }
  function overlay(st, v, f, beats) {
    var s = Object.assign({}, st);
    if (v.dim != null) s.dim = clamp(v.dim, 0, 1);
    if (v.color) { var c = hexRgb(v.color); s.r = c[0]; s.g = c[1]; s.b = c[2]; if (v.w == null) s.w = 0; if (v.a == null) s.a = 0; if (v.uv == null) s.uv = 0; if (v.dim == null && !(s.dim > 0)) s.dim = 0.8; }
    if (v.w != null) s.w = v.w; if (v.a != null) s.a = v.a; if (v.uv != null) s.uv = v.uv;
    if (v.strobe != null) s.strobe = v.strobe;
    if (movable(f)) { if (v.pan != null) s.pan = clamp(v.pan, 0, 1); if (v.tilt != null) s.tilt = clamp(v.tilt, 0, 1); }
    if (v.fx && v.fx.type && v.fx.type !== "none") fxMod(v.fx, beats, s);
    if (v.on === false) s.dim = 0;
    var x = extras[f.id] || (extras[f.id] = {});
    EXTRA.forEach(function (k) { if (v[k] != null) x[k] = v[k]; });
    if (v.speed != null) x.speed = v.speed;
    return s;
  }
  function beatLen() { var s = L() && L().song; return 60 / ((s && s.bpm) || 100); }
  function apply(st, f, base, beats, t) {
    lastBase = base; delete extras[f.id]; programmed[f.id] = false;
    var to = base && base.to, from = base && base.from, p = base ? base.p : 1;
    if (from && from !== to && from.prog && from.prog[f.id] && p < 1) { st = mixState(overlay(st, from.prog[f.id], f, beats), st, p); programmed[f.id] = true; }
    if (to && to.prog && to.prog[f.id]) { st = mixState(st, overlay(st, to.prog[f.id], f, beats), p); programmed[f.id] = true; }
    var cue = base && base.cue;
    if (cue && cue.prog && cue.prog[f.id] && !(P.open && P.cue === cue)) {
      var v = cue.prog[f.id], pp = v.fade != null ? (v.fade > 0 ? clamp((t - L().cueTime(cue)) / (v.fade * beatLen()), 0, 1) : 1) : p;
      st = mixState(st, overlay(st, v, f, beats), pp); programmed[f.id] = true;
    }
    if (P.open && P.work[f.id]) { st = overlay(st, P.work[f.id], f, beats); programmed[f.id] = true; }   // (live while programming)
    if (P.open && P.highlight && P.sel.indexOf(f.id) >= 0) { st = Object.assign({}, st, { dim: 1, r: 1, g: 1, b: 1, w: 1, a: 0, uv: 0, strobe: 0 }); var hx = extras[f.id] || (extras[f.id] = {}); hx.iris = null; hx.gobo = null; hx.prism = null; hx.frost = null; }
    return st;
  }
  var CURVES = { linear: function (x) { return x; }, square: function (x) { return x * x; }, smooth: function (x) { return x * x * (3 - 2 * x); }, led: function (x) { return x <= 0 ? 0 : Math.pow(x, 2.2); } };
  function limit(st, f) {
    var s = st, own = f.maxDim != null || f.curve || f.calib || f.panRange || f.tiltRange || f.upsideDown || f.movable === false || f.auto === false;
    if (!own) return st;
    s = Object.assign({}, st);
    if (f.auto === false && !programmed[f.id] && lastBase && lastBase.to && /^auto:/.test(lastBase.to.id || "")) s.dim = 0;   // (the auto lights and the AI leave it alone)
    if (f.movable === false) { var h = f.home || {}; s.pan = h.pan != null ? h.pan : 0.5; s.tilt = h.tilt != null ? h.tilt : 0.5; }
    else {
      if (f.panRange) s.pan = f.panRange[0] + clamp(s.pan, 0, 1) * (f.panRange[1] - f.panRange[0]);
      if (f.tiltRange) s.tilt = f.tiltRange[0] + clamp(s.tilt, 0, 1) * (f.tiltRange[1] - f.tiltRange[0]);
      if (f.upsideDown) s.tilt = 1 - s.tilt;
    }
    if (f.curve && CURVES[f.curve]) s.dim = CURVES[f.curve](clamp(s.dim, 0, 1));
    if (f.maxDim != null) s.dim *= clamp(f.maxDim, 0, 1);
    if (f.calib) { s.r = clamp(s.r * (f.calib.r == null ? 1 : f.calib.r), 0, 1); s.g = clamp(s.g * (f.calib.g == null ? 1 : f.calib.g), 0, 1); s.b = clamp(s.b * (f.calib.b == null ? 1 : f.calib.b), 0, 1); }
    return s;
  }

  // ---------------------------------------------------------------- what the selected lights can do
  function fixtures() { return L().rig().fixtures; }
  function fx(id) { return fixtures().filter(function (f) { return f.id === id; })[0]; }
  function caps(ids) {
    var c = { color: false, w: false, a: false, uv: false, ctemp: false, wheel: [], strobe: false, move: false, speed: false, zoom: false, focus: false, iris: false, gobo: false, goborot: false, prism: false, prismrot: false, frost: false, gobos: 0 };
    ids.forEach(function (id) {
      var f = fx(id); if (!f) return; var p = L().profileOf(f), ch = p.ch || [], cv = (p.src && p.src.cv) || {};
      if (ch.indexOf("r") >= 0 || ch.indexOf("c") >= 0) c.color = true;
      ["w", "a", "uv", "ctemp", "strobe", "speed", "zoom", "focus", "iris", "gobo", "goborot", "prism", "prismrot", "frost"].forEach(function (k) { if (ch.indexOf(k) >= 0) c[k] = true; });
      ch.forEach(function (j, i) { if (j === "wheel") { c.color = true; ((cv[i] || {}).sl || []).forEach(function (s) { if (!c.wheel.some(function (x) { return x[1] === s[1]; })) c.wheel.push(s); }); } });
      if (movable(f)) c.move = true;
    });
    return c;
  }

  // ---------------------------------------------------------------- the panel
  var SWATCHES = ["#ffffff", "#ffd7a0", "#ffb36b", "#ff8a00", "#ff2a10", "#ff2f8e", "#b13bff", "#7a2bff", "#1f4dff", "#0a1fb0", "#00b7ff", "#00e0a0", "#38d430", "#e8ff3a"];
  var FXT = [["none", "None"], ["pulse", "Pulse"], ["breathe", "Breathe"], ["chase", "Chase"], ["alternate", "Alternate"], ["sparkle", "Sparkle"], ["rainbow", "Rainbow"], ["sweep", "Sweep (moving lights)"], ["circle", "Circle (moving lights)"]];
  var GROUP_NAME = { front: "Front", back: "Back", beam: "Beams", house: "House", fx: "Strobes", haze: "Haze" };
  function panel() { var el = $("#lpPanel"); if (!el) { el = document.createElement("div"); el.id = "lpPanel"; el.className = "lp-panel"; el.hidden = true; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", "Program lights"); document.body.appendChild(el); wire(el); } return el; }
  function snapshot() { P.hist.push(JSON.stringify(P.work)); if (P.hist.length > 100) P.hist.shift(); P.fut = []; P.changed = true; }
  var lastSnap = 0;
  function willChange(slider) { var now = Date.now(); if (!slider || now - lastSnap > 600) snapshot(); lastSnap = now; }
  function first() { return P.sel.length ? (P.work[P.sel[0]] || {}) : {}; }
  function val(k, d) { var v = first()[k]; return v == null ? d : v; }
  function setAll(k, v) { P.sel.forEach(function (id) { var w = P.work[id] = P.work[id] || {}; if (v === null) delete w[k]; else w[k] = v; if (!Object.keys(w).length) delete P.work[id]; }); }
  function render() {
    var el = panel(); if (!P.open) { el.hidden = true; return; }
    var all = fixtures(), c = caps(P.sel), groups = {}, tags = {};
    all.forEach(function (f) { groups[f.group] = true; (f.tags || []).forEach(function (t) { tags[t] = true; }); });
    var title = P.look ? "Preset: " + P.look.name : "Scene " + (P.index + 1) + (P.cue && P.cue.label ? " - " + P.cue.label : "") + " (bar " + (P.cue ? P.cue.bar : "?") + ")";
    var none = !P.sel.length, on = val("on", true) !== false, slider = function (k, label, d, attrs) { return '<label class="lp-sl"><span>' + label + "</span><input type=\"range\" min=\"0\" max=\"1\" step=\"0.01\" data-lp=\"" + k + '" value="' + val(k, d) + '"' + (attrs || "") + '><output>' + Math.round(val(k, d) * 100) + "%</output></label>"; };
    el.innerHTML = '<div class="lp-head"><div><b>Program lights</b><small>' + esc(title) + '</small></div><div class="lp-head-btns"><button data-lpa="undo" title="Undo"' + (P.hist.length ? "" : " disabled") + '>Undo</button><button data-lpa="redo" title="Redo"' + (P.fut.length ? "" : " disabled") + '>Redo</button><button data-lpa="close" title="Close">✕</button></div></div>' +
      '<div class="lp-body"><section class="lp-pick"><div class="lp-groups">' + Object.keys(groups).map(function (g) { return '<button data-lpg="' + esc(g) + '">' + esc(GROUP_NAME[g] || g) + "</button>"; }).join("") + Object.keys(tags).map(function (t) { return '<button data-lpt="' + esc(t) + '">' + esc(t) + "</button>"; }).join("") + '<button data-lpa="all">All</button><button data-lpa="clear">Clear selection</button></div>' +
      '<div class="lp-map" title="Click a light to pick it, Shift-click to add it">' + all.map(function (f) { var pos = f.pos || {}, x = pos.x != null ? 50 + pos.x * 4 : (f.x || 0.5) * 100, y = pos.z != null ? 60 + pos.z * 3 : (f.y || 0.5) * 100; return '<i data-lpf="' + esc(f.id) + '" class="' + (P.sel.indexOf(f.id) >= 0 ? "sel" : "") + (P.work[f.id] ? " prog" : "") + '" style="left:' + clamp(x, 2, 98) + "%;top:" + clamp(y, 4, 96) + '%" title="' + esc(f.name) + '"></i>'; }).join("") + "</div>" +
      '<div class="lp-list">' + all.map(function (f) { return '<label class="lp-fx' + (P.work[f.id] ? " prog" : "") + '"><input type="checkbox" data-lpc="' + esc(f.id) + '"' + (P.sel.indexOf(f.id) >= 0 ? " checked" : "") + "><span>" + esc(f.name) + "</span><small>" + esc(GROUP_NAME[f.group] || f.group) + (movable(f) ? " · moves" : "") + (P.work[f.id] ? " · programmed" : "") + "</small></label>"; }).join("") + "</div></section>" +
      '<section class="lp-ctl">' + (none ? '<p class="muted">Pick one or more lights to program them.</p>' :
        '<div class="lp-row"><label class="toggle"><input type="checkbox" data-lp="on"' + (on ? " checked" : "") + '> On</label><label class="toggle"><input type="checkbox" data-lpa="highlight"' + (P.highlight ? " checked" : "") + '> Highlight (full white)</label><span class="muted small">' + P.sel.length + " light" + (P.sel.length > 1 ? "s" : "") + "</span></div>" +
        slider("dim", "Intensity", 1) +
        (c.color ? '<h4>Colour</h4><div class="lp-row"><input type="color" data-lp="color" value="' + esc(val("color", "#ffffff")) + '"><span class="lp-sw">' + SWATCHES.map(function (s) { return '<button data-lpsw="' + s + '" style="background:' + s + '" title="' + s + '"></button>'; }).join("") + "</span></div>" +
          (c.w ? slider("w", "White", 0) : "") + (c.a ? slider("a", "Amber", 0) : "") + (c.uv ? slider("uv", "UV", 0) : "") + (c.ctemp ? slider("ctemp", "Colour temperature (warm → cool)", 0) : "") +
          (c.wheel.length ? '<div class="lp-row lp-wheel"><span>Colour wheel</span>' + c.wheel.map(function (s) { return '<button data-lpwh="' + s[0] + '" style="background:' + esc(s[1]) + '" class="' + (val("wheel", null) === s[0] ? "on" : "") + '" title="slot at ' + s[0] + '"></button>'; }).join("") + '<button data-lpwh="" class="lp-wh-auto">Match the colour</button></div>' : "") : "") +
        (c.move ? '<h4>Position</h4><div class="lp-row"><div class="lp-xy" data-lpxy="1"><i style="left:' + (val("pan", 0.5) * 100) + "%;top:" + (val("tilt", 0.5) * 100) + '%"></i></div><div class="lp-col">' + slider("pan", "Pan", 0.5, ' step="0.001"') + slider("tilt", "Tilt", 0.5, ' step="0.001"') + (c.speed ? slider("speed", "Move speed (fast → slow)", 0) : "") +
          '<div class="lp-pos">' + (L().POSITIONS || []).map(function (q, i) { return '<button data-lppos="' + i + '">' + esc(q[0]) + "</button>"; }).join("") + "</div></div></div>" : "") +
        (c.zoom || c.focus || c.iris || c.frost || c.gobo || c.prism ? '<h4>Beam</h4>' + (c.zoom ? slider("zoom", "Zoom", 0.5) : "") + (c.focus ? slider("focus", "Focus", 0.5) : "") + (c.iris ? slider("iris", "Iris (open → closed)", 0) : "") + (c.frost ? slider("frost", "Frost", 0) : "") +
          (c.gobo ? '<label class="lp-sl"><span>Gobo (wheel position)</span><input type="range" min="0" max="255" step="1" data-lpraw="gobo" value="' + val("gobo", 0) + '"><output>' + val("gobo", 0) + '</output></label><div class="lp-row"><button data-lpa="goboopen">Gobo open</button></div>' + (c.goborot ? slider("goborot", "Gobo rotation", 0) : "") : "") +
          (c.prism ? '<div class="lp-row"><label class="toggle"><input type="checkbox" data-lpa="prism"' + (val("prism", 0) ? " checked" : "") + "> Prism in</label></div>" + (c.prismrot ? slider("prismrot", "Prism rotation", 0) : "") : "") : "") +
        (c.strobe ? slider("strobe", "Strobe (off → fast)", 0) : "") +
        '<h4>Effect</h4><div class="lp-row"><select data-lpfx="type">' + FXT.map(function (o) { return '<option value="' + o[0] + '"' + ((val("fx", {}) || {}).type === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + '</select><label>Every <select data-lpfx="speed">' + [[0.25, "¼ beat"], [0.5, "½ beat"], [1, "beat"], [2, "2 beats"], [4, "bar"], [8, "2 bars"]].map(function (o) { return '<option value="' + o[0] + '"' + (((val("fx", {}) || {}).speed || 1) == o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + '</select></label><label>Spread <input type="range" min="0" max="1" step="0.05" data-lpfx="spread" value="' + (P.spread == null ? 1 : P.spread) + '" title="0 = all lights together, 1 = spread across the selection"></label></div>' +
        '<div class="lp-row"><label>Fade <input type="number" min="0" max="64" step="0.5" data-lp="fade" value="' + (val("fade", "") === "" ? "" : val("fade", "")) + '" placeholder="scene" style="width:70px"> beats</label><button data-lpa="forget" title="Take the selected lights out of what is programmed here">Clear these lights</button></div>') +
      "</section></div>" +
      '<div class="lp-foot">' + (P.look ? '<button class="primary" data-lpa="savelook">Save the preset</button>' : '<button class="primary" data-lpa="record" title="Keep the selected lights\' programming in the scene">Record into scene</button><button data-lpa="update" title="Keep everything programmed here in the scene">Update scene</button>') + '<button data-lpa="aspreset">Save as a new preset…</button><button data-lpa="showbase" title="Show the scene\'s preset under what you program">Show the scene\'s preset</button><span class="muted small lp-note">' + esc(P.note || "") + "</span></div>";
    el.hidden = false;
  }
  function selectOnly(ids, add) { if (add) ids.forEach(function (id) { var k = P.sel.indexOf(id); if (k >= 0) P.sel.splice(k, 1); else P.sel.push(id); }); else P.sel = ids.slice(); render(); }
  function wire(el) {
    el.addEventListener("click", function (e) {
      var b = e.target.closest("button, i[data-lpf], input[type=checkbox]"); if (!b) return;
      if (b.dataset.lpf) return selectOnly([b.dataset.lpf], e.shiftKey || e.metaKey || e.ctrlKey);
      if (b.dataset.lpg) return selectOnly(fixtures().filter(function (f) { return f.group === b.dataset.lpg; }).map(function (f) { return f.id; }), e.shiftKey);
      if (b.dataset.lpt) return selectOnly(fixtures().filter(function (f) { return (f.tags || []).indexOf(b.dataset.lpt) >= 0; }).map(function (f) { return f.id; }), e.shiftKey);
      if (b.dataset.lpsw) { willChange(); setAll("color", b.dataset.lpsw); setAll("on", null); return render(); }
      if (b.dataset.lpwh != null) { willChange(); setAll("wheel", b.dataset.lpwh === "" ? null : Number(b.dataset.lpwh)); return render(); }
      if (b.dataset.lppos != null) { var q = L().POSITIONS[Number(b.dataset.lppos)]; willChange(); setAll("pan", q[1]); setAll("tilt", q[2]); return render(); }
      var a = b.dataset.lpa; if (!a) return;
      if (a === "close") return close();
      if (a === "undo" && P.hist.length) { P.fut.push(JSON.stringify(P.work)); P.work = JSON.parse(P.hist.pop()); return render(); }
      if (a === "redo" && P.fut.length) { P.hist.push(JSON.stringify(P.work)); P.work = JSON.parse(P.fut.pop()); return render(); }
      if (a === "all") return selectOnly(fixtures().map(function (f) { return f.id; }));
      if (a === "clear") return selectOnly([]);
      if (a === "highlight") { P.highlight = b.checked; return; }
      if (a === "goboopen") { willChange(); setAll("gobo", null); return render(); }
      if (a === "prism") { willChange(); var on = b.checked; P.sel.forEach(function (id) { var f = fx(id), p = L().profileOf(f), i = (p.ch || []).indexOf("prism"), cv = p.src && p.src.cv && p.src.cv[i]; var w = P.work[id] = P.work[id] || {}; if (on) w.prism = cv && cv.o != null && cv.o > 100 ? 0 : 200; else delete w.prism; }); return; }
      if (a === "forget") { willChange(); P.sel.forEach(function (id) { delete P.work[id]; }); return render(); }
      if (a === "record") return record(false);
      if (a === "update") return record(true);
      if (a === "savelook") return saveLook();
      if (a === "aspreset") return asPreset();
      if (a === "showbase") { if (P.cue && L().goLook) L().goLook(P.cue.look); return; }
    });
    el.addEventListener("change", function (e) {
      var t = e.target;
      if (t.dataset.lpc) { var k = P.sel.indexOf(t.dataset.lpc); if (t.checked && k < 0) P.sel.push(t.dataset.lpc); if (!t.checked && k >= 0) P.sel.splice(k, 1); return render(); }
      if (t.dataset.lp === "on") { willChange(); setAll("on", t.checked ? null : false); return render(); }
      if (t.dataset.lp === "color") { willChange(); setAll("color", t.value); return render(); }
      if (t.dataset.lp === "fade") { willChange(); setAll("fade", t.value === "" ? null : clamp(Number(t.value) || 0, 0, 64)); return; }
      if (t.dataset.lpfx) {
        willChange();
        if (t.dataset.lpfx === "spread") P.spread = Number(t.value);
        var type = $('[data-lpfx="type"]', panel()).value, speed = Number($('[data-lpfx="speed"]', panel()).value) || 1, spread = P.spread == null ? 1 : P.spread, n = P.sel.length;
        P.sel.forEach(function (id, i) { var w = P.work[id] = P.work[id] || {}; if (type === "none") delete w.fx; else w.fx = { type: type, speed: speed, size: 1, ph: n > 1 ? (i / n) * spread : 0 }; });
        return render();
      }
    });
    el.addEventListener("input", function (e) {
      var t = e.target, out = t.parentNode && t.parentNode.querySelector("output");
      if (t.dataset.lp && t.type === "range") { willChange(true); setAll(t.dataset.lp, Number(t.value)); if (t.dataset.lp !== "dim" || Number(t.value) > 0) setAll("on", null); if (out) out.textContent = Math.round(Number(t.value) * 100) + "%"; if (t.dataset.lp === "pan" || t.dataset.lp === "tilt") moveDot(); }
      if (t.dataset.lpraw) { willChange(true); setAll(t.dataset.lpraw, Number(t.value)); if (out) out.textContent = t.value; }
      if (t.dataset.lp === "color") setAll("color", t.value);
    });
    el.addEventListener("pointerdown", function (e) {
      var pad = e.target.closest("[data-lpxy]"); if (!pad) return; e.preventDefault(); willChange();
      var move = function (ev) { var r = pad.getBoundingClientRect(); setAll("pan", clamp((ev.clientX - r.left) / r.width, 0, 1)); setAll("tilt", clamp((ev.clientY - r.top) / r.height, 0, 1)); moveDot(); syncSliders(); };
      move(e); var up = function () { document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); }; document.addEventListener("pointermove", move); document.addEventListener("pointerup", up);
    });
    document.addEventListener("keydown", function (e) { if (!P.open) return; if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); el.querySelector(e.shiftKey ? '[data-lpa="redo"]' : '[data-lpa="undo"]').click(); } else if (e.key === "Escape" && !el.hidden) close(); });
  }
  function moveDot() { var d = $(".lp-xy i", panel()); if (d) { d.style.left = val("pan", 0.5) * 100 + "%"; d.style.top = val("tilt", 0.5) * 100 + "%"; } }
  function syncSliders() { ["pan", "tilt"].forEach(function (k) { var s = $('[data-lp="' + k + '"]', panel()); if (s) { s.value = val(k, 0.5); var o = s.parentNode.querySelector("output"); if (o) o.textContent = Math.round(val(k, 0.5) * 100) + "%"; } }); }

  // ---------------------------------------------------------------- opening, recording, saving
  function scenesOf(target) { return target ? target.cues.filter(function (c) { return c.kind === "look" || c.kind == null; }) : []; }
  function openScene(index) {
    var target = L().editTarget(), cue = scenesOf(target)[index]; if (!cue) return false;
    if (P.open && P.changed && !confirm("Leave the lights you programmed without recording them?")) return false;
    Object.assign(P, { open: true, cue: cue, target: target, look: null, index: index, sel: P.sel.filter(function (id) { return !!fx(id); }), work: copy(cue.prog), hist: [], fut: [], highlight: false, changed: false, note: "" });
    render(); return true;
  }
  function openLook(look) {
    if (P.open && P.changed && !confirm("Leave the lights you programmed without recording them?")) return false;
    Object.assign(P, { open: true, cue: null, target: null, look: look, index: 0, work: copy(look.prog), hist: [], fut: [], highlight: false, changed: false, note: "" }); render(); return true;
  }
  function close(force) {
    if (!force && P.changed && !confirm("Close without recording what you programmed?")) return;
    P.open = false; P.highlight = false; P.changed = false; render();
  }
  function cleanProg(o) { var out = {}; Object.keys(o || {}).forEach(function (id) { if (fx(id) && o[id] && Object.keys(o[id]).length) out[id] = o[id]; }); return out; }
  function record(all) {
    if (!P.cue) return;
    var prog = copy(P.cue.prog), ids = all ? Object.keys(P.work).concat(Object.keys(prog)) : P.sel;
    ids.forEach(function (id) { if (P.work[id]) prog[id] = copy(P.work[id]); else delete prog[id]; });
    prog = cleanProg(prog);
    if (Object.keys(prog).length) P.cue.prog = prog; else delete P.cue.prog;
    P.changed = false; P.note = all ? "The scene now has everything programmed here." : "Recorded " + P.sel.length + " light" + (P.sel.length === 1 ? "" : "s") + " into the scene.";
    var X = L(); X.dirty(); X.saveEdit(); X.renderSongs(); render();
  }
  function saveLook() { if (!P.look) return; var prog = cleanProg(P.work); if (Object.keys(prog).length) P.look.prog = prog; else delete P.look.prog; P.changed = false; P.note = "Saved."; L().dirty(); L().saveRig(); render(); }
  function asPreset() {
    var X = L(), base = P.look || (P.cue ? X.lookById(P.cue.look) : null), name = prompt("Name for the new preset", (base ? base.name + " " : "") + "(programmed)"); if (!name) return;
    var nl = copy(base || { g: {} }); nl.id = "mine-" + Math.random().toString(36).slice(2, 9); nl.name = name; nl.mine = true; delete nl.auto;
    var prog = cleanProg(P.work); if (Object.keys(prog).length) nl.prog = prog; else delete nl.prog;
    X.rig().looks.push(nl); X.dirty(); X.saveRig(); if (X.renderLooks) X.renderLooks();
    P.note = '"' + name + '" is now one of your presets.'; render();
  }

  // ---------------------------------------------------------------- the "Program lights" buttons on the scenes
  function decorateScenes() {
    var root = document.getElementById("lxSongs"); if (!root || !L() || !L().editTarget) return;
    var target = L().editTarget(), scenes = scenesOf(target);
    root.querySelectorAll(".lx-scenes tr[data-sc]").forEach(function (tr) {
      var k = Number(tr.dataset.sc), cue = scenes[k], sel = tr.querySelector('[data-scf="look"]'); if (!sel || !cue) return;
      var n = cue.prog ? Object.keys(cue.prog).length : 0, btn = tr.querySelector("[data-lp-open]");
      if (!btn) { btn = document.createElement("button"); btn.type = "button"; btn.className = "lp-open"; btn.dataset.lpOpen = String(k); sel.parentNode.appendChild(btn); }
      var label = n ? "Program lights (" + n + ")" : "Program lights"; if (btn.textContent !== label) btn.textContent = label;   // (only when it changes: the observer below would see its own change forever)
      btn.title = n ? n + " light" + (n === 1 ? " is" : "s are") + " programmed on top of the preset" : "Set each light's colour, level, position and more for this scene";
    });
  }
  document.addEventListener("click", function (e) { var b = e.target.closest("[data-lp-open]"); if (!b) return; e.preventDefault(); openScene(Number(b.dataset.lpOpen)); });
  function watch() {
    var root = document.getElementById("lxSongs"); if (!root) return setTimeout(watch, 800);
    new MutationObserver(function () { decorateScenes(); }).observe(root, { childList: true, subtree: true });
    decorateScenes();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watch); else setTimeout(watch, 0);
  // a 3D stage that tells us which light was clicked (lights3d.js may send it)
  document.addEventListener("cu-fixture-pick", function (e) { if (P.open && e.detail && e.detail.id) selectOnly([e.detail.id], !!e.detail.add); });

  global.CULightsProg = { apply: apply, limit: limit, extras: function (id) { return extras[id] || null; }, movable: movable, caps: caps,
    openScene: openScene, openLook: openLook, close: close, select: function (ids) { selectOnly(ids); }, set: function (k, v) { willChange(); setAll(k, v); render(); },
    record: record, state: function () { return P; }, decorate: decorateScenes, CURVES: Object.keys(CURVES) };
})(window);
