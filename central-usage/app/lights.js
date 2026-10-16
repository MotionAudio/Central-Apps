/* Central Usage - Lighting: a small Lightkey-style controller.
 *
 *  Fixtures   patch the rig: profile (par, RGBW, moving head, bar, strobe, hazer, custom), universe,
 *             DMX address, group (front / back / beams / house / fx / haze) and a spot on the stage plot.
 *  Looks      what each group does: colour, white, amber, UV, intensity, strobe, position and an effect
 *             that moves with the song's beat (pulse, chase, alternate, breathe, rainbow, sweep, flicker).
 *  Show       a cue list on the song's timeline - made automatically from the sections and the big hits
 *             the Central Control finds, and edited by hand (click to add, drag to move). Cues are kept on
 *             the Central Control per song, so every computer running Central Usage gets them.
 *  Output     USB-DMX (ENTTEC Pro protocol), Art-Net or sACN from this computer, and / or MIDI to Lightkey.
 *
 * The page follows the Central Control's song position, beat grid and tempo; everything is computed
 * here ~40 times a second and the universes go to the main process (dmx.js), which sends them. */
(function () {
  "use strict";
  var CU = window.CentralUsage; if (!CU) return;
  function $(s) { return document.querySelector(s); }
  function $$(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function uid() { return Math.random().toString(36).slice(2, 9); }
  var store = { get: function (k, d) { try { var v = localStorage.getItem("cu-" + k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } }, set: function (k, v) { try { localStorage.setItem("cu-" + k, JSON.stringify(v)); } catch (_) { } } };
  var DMX = (window.CU && window.CU.dmx) || null;

  // ------------------------------------------------------------- fixture profiles
  var PROFILES = {
    dimmer: { name: "Dimmer / conventional (1 ch)", ch: ["dim"] },
    rgb3: { name: "RGB par (3 ch)", ch: ["r", "g", "b"] },
    rgbd4: { name: "Dimmer + RGB par (4 ch)", ch: ["dim", "r", "g", "b"] },
    rgbw4: { name: "RGBW par (4 ch)", ch: ["r", "g", "b", "w"] },
    rgbwd5: { name: "Dimmer + RGBW par (5 ch)", ch: ["dim", "r", "g", "b", "w"] },
    rgbwds6: { name: "Dimmer + RGBW + strobe (6 ch)", ch: ["dim", "r", "g", "b", "w", "strobe"] },
    rgbawuv6: { name: "RGBAW+UV par (6 ch)", ch: ["r", "g", "b", "a", "w", "uv"] },
    rgbwauvds8: { name: "Dimmer + strobe + RGBWA+UV (8 ch)", ch: ["dim", "strobe", "r", "g", "b", "w", "a", "uv"] },
    bar8rgb: { name: "LED bar 8 × RGB (24 ch)", ch: ["r", "g", "b", "r", "g", "b", "r", "g", "b", "r", "g", "b", "r", "g", "b", "r", "g", "b", "r", "g", "b", "r", "g", "b"] },
    mhmini9: { name: "Moving head, mini RGBW (9 ch)", ch: ["pan", "tilt", "dim", "strobe", "r", "g", "b", "w", "speed"], mover: true },
    mhwash14: { name: "Moving head wash RGBW (14 ch)", ch: ["pan", "panf", "tilt", "tiltf", "speed", "dim", "strobe", "r", "g", "b", "w", "zero", "zero", "zero"], mover: true },
    mhspot11: { name: "Moving head spot (11 ch)", ch: ["pan", "panf", "tilt", "tiltf", "speed", "dim", "strobe", "wheel", "gobo", "prism", "focus"], mover: true },
    strobe2: { name: "Strobe (2 ch: intensity, rate)", ch: ["dim", "strobe"] },
    blinder2: { name: "Blinder 2-cell (2 ch)", ch: ["dim", "dim"] },
    hazer2: { name: "Hazer (2 ch: output, fan)", ch: ["haze", "fan"] },
    fog1: { name: "Fogger (1 ch)", ch: ["haze"] }
  };
  var CH_TYPES = ["dim", "r", "g", "b", "w", "a", "uv", "strobe", "pan", "panf", "tilt", "tiltf", "speed", "wheel", "gobo", "prism", "focus", "haze", "fan", "zero", "full"];
  var GROUPS = [["front", "Front / key"], ["back", "Back / colour"], ["beam", "Beams / movers"], ["house", "House / audience"], ["fx", "Strobes / blinders"], ["haze", "Haze / fog"]];
  var FX = [["none", "Steady"], ["pulse", "Pulse on the beat"], ["chase", "Chase"], ["alternate", "Alternate odd / even"], ["breathe", "Breathe (slow)"], ["rainbow", "Rainbow"], ["sweep", "Sweep (movers)"], ["circle", "Circle (movers)"], ["figure8", "Figure 8 (movers)"], ["panwave", "Pan wave (movers)"], ["tiltwave", "Tilt wave (movers)"], ["ballyhoo", "Ballyhoo (movers)"], ["flicker", "Flicker"], ["flash", "Flash on the beat"]];
  // where the movers point: pan / tilt 0..1 (0.5 / 0.5 = straight down the middle)
  var POSITIONS = [["Home", 0.5, 0.5], ["Audience", 0.5, 0.78], ["Stage", 0.5, 0.25], ["Ceiling", 0.5, 0.02], ["Cross L", 0.36, 0.62], ["Cross R", 0.64, 0.62], ["Fan out", 0.5, 0.55, 0.5], ["Floor", 0.5, 0.97]];
  function libEntry(id) { return (rig.library || []).filter(function (x) { return x.id === id; })[0] || null; }
  function profileFor(id) { if (PROFILES[id]) return PROFILES[id]; var e = libEntry(id); return e ? { name: e.name, ch: e.ch, mover: e.mover } : null; }
  function profileOf(f) { if (/^lib:/.test(f.profile || "")) return profileFor(f.profile) || PROFILES.dimmer; return f.profile === "custom" ? { name: "Custom", ch: f.channels || ["dim"], mover: (f.channels || []).indexOf("pan") >= 0 } : PROFILES[f.profile] || PROFILES.dimmer; }

  // ------------------------------------------------------------- looks
  function G(dim, color, o) { return Object.assign({ dim: dim, color: color || "#ffffff", w: 0, a: 0, uv: 0, strobe: 0, fx: "none", speed: 1, size: 0.6, pan: 0.5, tilt: 0.5 }, o || {}); }
  var WARM = "#ffb36b", BLUE = "#1f4dff", DEEP = "#0a1fb0", PURPLE = "#7a2bff", RED = "#ff2a10", AMBER = "#ff8a00", CYAN = "#00c8ff", WHITE = "#ffffff";
  function BUILTIN() {
    return [
      { id: "blackout", name: "Blackout", swatch: "#000000", g: {} },
      { id: "walkin", name: "Walk-in", swatch: "#2b3cff", g: { house: G(0.7, WARM), back: G(0.45, DEEP, { fx: "breathe", speed: 4, size: 0.3 }), beam: G(0.25, BLUE, { fx: "sweep", speed: 8, size: 0.4 }) } },
      { id: "worship", name: "Worship blue", swatch: BLUE, g: { front: G(0.55, WARM), back: G(0.85, BLUE), beam: G(0.5, BLUE, { fx: "sweep", speed: 8, size: 0.35 }), house: G(0.08, WARM), haze: G(0.25) } },
      { id: "verse", name: "Warm verse", swatch: AMBER, g: { front: G(0.7, WARM), back: G(0.5, AMBER, { a: 0.5 }), house: G(0.05, WARM), haze: G(0.2) } },
      { id: "build", name: "Build", swatch: RED, g: { front: G(0.7, WARM), back: G(0.9, RED, { fx: "pulse", speed: 1, size: 0.5 }), beam: G(0.8, WHITE, { fx: "chase", speed: 0.5, size: 0.8 }), haze: G(0.35) } },
      { id: "chorus", name: "Chorus (full)", swatch: "#a238ff", g: { front: G(0.95, WARM, { w: 0.3 }), back: G(1, PURPLE), beam: G(1, WHITE, { w: 1, fx: "sweep", speed: 4, size: 0.7 }), fx: G(0, WHITE), haze: G(0.4) } },
      { id: "bridge", name: "Bridge", swatch: PURPLE, g: { front: G(0.6, WARM), back: G(0.9, PURPLE, { fx: "breathe", speed: 2, size: 0.4 }), beam: G(0.6, PURPLE, { fx: "alternate", speed: 2, size: 0.7 }), haze: G(0.3) } },
      { id: "breakdown", name: "Breakdown", swatch: DEEP, g: { front: G(0.4, WARM), back: G(0.3, DEEP), haze: G(0.2) } },
      { id: "prayer", name: "Prayer / response", swatch: "#5a6bff", g: { front: G(0.35, WARM), back: G(0.25, BLUE), house: G(0.2, WARM) } },
      { id: "ending", name: "Ending", swatch: "#3355ff", g: { front: G(0.5, WARM), back: G(0.45, BLUE, { fx: "breathe", speed: 4, size: 0.5 }) } },
      { id: "celebrate", name: "Celebrate", swatch: "#ff3ea5", g: { front: G(0.9, WARM), back: G(1, WHITE, { fx: "rainbow", speed: 4, size: 1 }), beam: G(1, WHITE, { fx: "rainbow", speed: 2, size: 1, w: 0 }), fx: G(0.4, WHITE, { fx: "flash", speed: 1, size: 1 }) } },
      { id: "hit", name: "Hit (white flash)", swatch: "#ffffff", flash: true, g: { front: G(1, WHITE, { w: 1 }), back: G(1, WHITE, { w: 1 }), beam: G(1, WHITE, { w: 1 }), fx: G(1, WHITE, { w: 1 }), house: G(0.6, WHITE) } },
      { id: "strobehit", name: "Strobe hit", swatch: "#e8f4ff", flash: true, g: { fx: G(1, WHITE, { w: 1, strobe: 0.8 }), beam: G(1, WHITE, { w: 1, strobe: 0.8 }), back: G(1, WHITE, { strobe: 0.6 }) } }
    ].map(function (l) { l.builtIn = true; return l; });
  }

  // ------------------------------------------------------------- the rig (fixtures, looks, output) - kept on this computer
  function defaultRig() {
    var f = [], add = function (name, profile, group, addr, x, y) { f.push({ id: uid(), name: name, profile: profile, group: group, universe: 1, address: addr, x: x, y: y }); };
    add("Front L", "rgbwd5", "front", 1, 0.3, 0.86); add("Front R", "rgbwd5", "front", 6, 0.7, 0.86);
    for (var i = 0; i < 4; i++) add("Back " + (i + 1), "rgbwd5", "back", 11 + i * 5, 0.2 + i * 0.2, 0.18);
    add("Mover L", "mhmini9", "beam", 31, 0.3, 0.32); add("Mover R", "mhmini9", "beam", 40, 0.7, 0.32);
    add("Blinder", "blinder2", "fx", 49, 0.5, 0.06); add("House", "dimmer", "house", 51, 0.5, 0.97); add("Hazer", "hazer2", "haze", 52, 0.08, 0.1);
    return { fixtures: f, looks: BUILTIN(), output: { mode: "off", path: "", host: "", offset: 0 }, master: 1, groupLevel: {}, stopped: "walkin", snap: "beat", rules: null };
  }
  var rig = store.get("rig", null) || defaultRig();
  if (!rig.looks || !rig.looks.length) rig.looks = BUILTIN();
  BUILTIN().forEach(function (b) { if (!rig.looks.some(function (l) { return l.id === b.id; })) rig.looks.push(b); });
  function saveRig() { store.set("rig", rig); }
  function lookById(id) { return rig.looks.filter(function (l) { return l.id === id; })[0] || rig.looks[0]; }

  // ------------------------------------------------------------- song position (follows the Central Control)
  var song = { id: null, name: "", pos: 0, at: 0, playing: false, speed: 1, bpm: 120, bpb: 4, bars: [], barBeats: [], hits: [], sections: [], duration: 0 };
  function posNow() { return song.playing ? song.pos + (performance.now() - song.at) / 1000 * (song.speed || 1) : song.pos; }
  function barLen(i) { var b = song.bars; if (!b.length) return 60 / song.bpm * song.bpb; if (i + 1 < b.length) return b[i + 1] - b[i]; return i > 0 ? b[i] - b[i - 1] : 60 / song.bpm * song.bpb; }
  function beatsIn(i) { return song.barBeats[i] || song.bpb || 4; }
  function timeOf(bar, beat) { var i = clamp(Math.round(bar) - 1, 0, 1e6), b = song.bars; if (!b.length) return (bar - 1) * 60 / song.bpm * song.bpb + (beat - 1) * 60 / song.bpm; var base = i < b.length ? b[i] : b[b.length - 1] + (i - b.length + 1) * barLen(b.length - 1); return base + (beat - 1) * barLen(Math.min(i, b.length - 1)) / beatsIn(i); }
  function barBeatAt(t) {  // -> { bar, beat (1-based, fractional) }
    var b = song.bars; if (!b.length) { var bl = 60 / song.bpm; var beatsTot = t / bl; return { bar: Math.floor(beatsTot / song.bpb) + 1, beat: beatsTot % song.bpb + 1 }; }
    var lo = 0, hi = b.length - 1; if (t < b[0]) return { bar: 1, beat: 1 + (t - b[0]) / (barLen(0) / beatsIn(0)) };
    while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (b[mid] <= t) lo = mid; else hi = mid - 1; }
    return { bar: lo + 1, beat: 1 + (t - b[lo]) / (barLen(lo) / beatsIn(lo)) };
  }
  function beatsAt(t) {  // total beats from the song start (for effects)
    if (!song.bars.length) return t / (60 / song.bpm);
    var bb = barBeatAt(t), n = 0; for (var i = 0; i < bb.bar - 1 && i < song.barBeats.length; i++) n += beatsIn(i); if (bb.bar - 1 > song.barBeats.length) n += (bb.bar - 1 - song.barBeats.length) * song.bpb; return n + bb.beat - 1;
  }
  var freeBeat = { at: performance.now(), beats: 0 };
  function beatClock() { var now = performance.now(); if (song.playing) { var b = beatsAt(posNow()); freeBeat = { at: now, beats: b }; return b; } return freeBeat.beats + (now - freeBeat.at) / 1000 * (song.bpm || 100) / 60; }

  // ------------------------------------------------------------- the show (cues) of the current song - kept on the Central Control
  var show = { song: null, cues: [], auto: true, saved: true, loading: false, by: "" }, saveTimer = 0;
  var SECTION_RULES = [[/^intro|^walk|^instrumental/i, "worship"], [/^verse/i, "verse"], [/^pre/i, "build"], [/^chorus|^refrain|^hook/i, "chorus"], [/^bridge/i, "bridge"], [/^break|^down|^interlude/i, "breakdown"], [/^tag|^vamp/i, "chorus"], [/^outro|^end|^coda/i, "ending"], [/^build/i, "build"], [/^turn/i, "worship"]];
  function lookForSection(name) { for (var i = 0; i < SECTION_RULES.length; i++) if (SECTION_RULES[i][0].test(name || "")) return SECTION_RULES[i][1]; return "worship"; }
  function autoCues() {
    var cues = [], secs = song.sections || [];
    secs.forEach(function (s, i) {
      var bb = s.bar ? { bar: s.bar, beat: 1 } : barBeatAt(s.start);
      var lk = lookForSection(s.name);
      cues.push({ id: uid(), bar: Math.round(bb.bar), beat: 1, look: lk, fade: lk === "chorus" ? 0.5 : lk === "build" ? 1 : 2, kind: "look", auto: true, label: s.name });
    });
    if (secs.length) {
      var last = secs[secs.length - 1], end = barBeatAt(Math.max(0, (last.end || song.duration) - 0.01));
      cues.push({ id: uid(), bar: end.bar + 1, beat: 1, look: "blackout", fade: 4, kind: "look", auto: true, label: "End" });
    } else cues.push({ id: uid(), bar: 1, beat: 1, look: "worship", fade: 2, kind: "look", auto: true, label: "Start" });
    (song.hits || []).forEach(function (h) {
      var bb = barBeatAt(h), beat = Math.round((bb.beat) * 2) / 2;  // snap to the half beat
      if (secs.some(function (s) { return Math.abs(s.start - h) < 60 / song.bpm * 0.75; })) return; // the section change already lands there
      cues.push({ id: uid(), bar: bb.bar, beat: beat >= beatsIn(bb.bar - 1) + 1 ? 1 : beat, look: "hit", fade: 0, kind: "flash", dur: 0.5, auto: true, label: "Hit" });
    });
    return sortCues(cues);
  }
  function cueTime(c) { return timeOf(c.bar, c.beat || 1); }
  function sortCues(list) { return list.sort(function (a, b) { return a.bar - b.bar || (a.beat || 1) - (b.beat || 1); }); }
  async function loadShow(songId) {
    show = { song: songId, cues: [], auto: true, saved: true, loading: true, by: "" }; renderShowPanel();
    var saved = null;
    try { var r = await fetch(CU.api("/lighting?song=" + encodeURIComponent(songId)), { cache: "no-store" }); if (r.ok) saved = await r.json(); } catch (_) { }
    if (show.song !== songId) return;
    show.loading = false;
    if (saved && Array.isArray(saved.cues) && saved.cues.length) { show.cues = sortCues(saved.cues); show.auto = !!saved.auto; show.by = saved.by || ""; }
    else { show.cues = autoCues(); show.auto = true; }
    renderShowPanel();
  }
  function changed() {
    show.auto = false; show.saved = false; renderShowPanel();
    clearTimeout(saveTimer); saveTimer = setTimeout(saveShow, 900);
  }
  async function saveShow() {
    if (!show.song) return;
    var code = CU.prefs.code;
    if (!code) { $("#lxSaveState").textContent = "not saved - enter the pairing code (Code) to keep cues on the Central Control"; return; }
    try {
      var r = await fetch(CU.api("/lighting"), { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ song: show.song, code: code, by: "Central Usage-" + selfId, show: { cues: show.cues, auto: show.auto, song: song.name } }) });
      var j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || r.status);
      show.saved = true; show.updated = j.updated;
    } catch (e) { $("#lxSaveState").textContent = "could not save: " + e.message; return; }
    renderShowPanel();
  }

  // ------------------------------------------------------------- engine: look -> each fixture -> DMX
  var live = { manual: null, manualFrom: null, manualAt: 0, manualFade: 0.6, flash: null, blackout: false, hold: false, lastFrame: null, fixtureColor: {} };
  function hexRgb(h) { h = String(h || "#000").replace("#", ""); if (h.length === 3) h = h.split("").map(function (c) { return c + c; }).join(""); var n = parseInt(h, 16) || 0; return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }
  function hsv(h, s, v) { var i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s); switch (((i % 6) + 6) % 6) { case 0: return [v, t, p]; case 1: return [q, v, p]; case 2: return [p, v, t]; case 3: return [p, q, v]; case 4: return [t, p, v]; default: return [v, p, q]; } }
  var flickerState = {};
  function stateFor(look, f, idx, n, beats) {
    var g = look && look.g && look.g[f.group];
    var st = { dim: 0, r: 0, g: 0, b: 0, w: 0, a: 0, uv: 0, strobe: 0, pan: 0.5, tilt: 0.5, haze: 0 };
    if (!g) return st;
    var rgb = hexRgb(g.color), dim = g.dim, speed = Math.max(0.125, g.speed || 1), size = g.size == null ? 0.6 : g.size, ph = beats / speed, frac = ph - Math.floor(ph);
    switch (g.fx) {
      case "pulse": dim *= (1 - size) + size * Math.exp(-frac * 4); break;
      case "chase": dim *= (Math.floor(ph) % Math.max(1, n)) === idx ? 1 : 1 - size; break;
      case "alternate": dim *= (Math.floor(ph) % 2) === (idx % 2) ? 1 : 1 - size; break;
      case "breathe": dim *= (1 - size) + size * (0.5 - 0.5 * Math.cos(2 * Math.PI * (beats / (speed * 4)))); break;
      case "rainbow": rgb = hsv(((beats / (speed * 4)) + idx / Math.max(1, n)) % 1, size, 1); break;
      case "flash": dim *= frac < 0.12 ? 1 : 1 - size; break;
      case "flicker": var k = f.id, fs = flickerState[k] || (flickerState[k] = 1); fs += (0.75 + Math.random() * 0.25 - fs) * 0.25; flickerState[k] = fs; dim *= 1 - size + size * fs; break;
    }
    var pan = g.pan == null ? 0.5 : g.pan, tilt = g.tilt == null ? 0.5 : g.tilt;
    var spread = n > 1 ? (idx / (n - 1) - 0.5) : 0; pan = clamp(pan + spread * (g.fan || 0), 0, 1);   // fan: the movers of a group spread out
    var ang = 2 * Math.PI * (beats / (speed * 4) + (g.offset == null ? 1 : g.offset) * idx / Math.max(2, n));
    if (g.fx === "sweep") { pan = clamp(pan + size * 0.33 * Math.sin(ang), 0, 1); tilt = clamp(tilt + size * 0.12 * Math.cos(ang), 0, 1); }
    else if (g.fx === "circle") { pan = clamp(pan + size * 0.2 * Math.sin(ang), 0, 1); tilt = clamp(tilt + size * 0.2 * Math.cos(ang), 0, 1); }
    else if (g.fx === "figure8") { pan = clamp(pan + size * 0.22 * Math.sin(ang), 0, 1); tilt = clamp(tilt + size * 0.14 * Math.sin(2 * ang), 0, 1); }
    else if (g.fx === "panwave") pan = clamp(pan + size * 0.3 * Math.sin(ang), 0, 1);
    else if (g.fx === "tiltwave") tilt = clamp(tilt + size * 0.25 * Math.sin(ang), 0, 1);
    else if (g.fx === "ballyhoo") { pan = clamp(pan + size * 0.3 * Math.sin(ang * 1.7 + idx) * Math.cos(ang * 0.6), 0, 1); tilt = clamp(tilt + size * 0.2 * Math.sin(ang * 1.3 + idx * 2), 0, 1); }
    if (f.invertPan) pan = 1 - pan; if (f.invertTilt) tilt = 1 - tilt;
    st.dim = clamp(dim, 0, 1); st.r = rgb[0]; st.g = rgb[1]; st.b = rgb[2]; st.w = g.w || 0; st.a = g.a || 0; st.uv = g.uv || 0; st.strobe = g.strobe || 0; st.pan = pan; st.tilt = tilt; st.haze = f.group === "haze" ? clamp(dim, 0, 1) : 0;
    return st;
  }
  function mix(a, b, p) { var o = {}; for (var k in a) o[k] = a[k] + (b[k] - a[k]) * p; if (p >= 0.5) o.strobe = b.strobe; else o.strobe = a.strobe; return o; }
  function activeLooks(t) {  // -> { from, to, p } from the cue list at song time t
    var cues = show.cues.filter(function (c) { return c.kind !== "flash"; }), cur = -1;
    for (var i = 0; i < cues.length; i++) if (cueTime(cues[i]) <= t + 1e-4) cur = i;
    if (cur < 0) return { from: lookById(rig.stopped || "walkin"), to: lookById(rig.stopped || "walkin"), p: 1 };
    var c = cues[cur], prev = cur > 0 ? lookById(cues[cur - 1].look) : lookById(rig.stopped || "walkin"), beatLen = 60 / (song.bpm || 100), fade = (c.fade || 0) * beatLen;
    return { from: prev, to: lookById(c.look), p: fade > 0 ? clamp((t - cueTime(c)) / fade, 0, 1) : 1, cue: c };
  }
  function activeFlash(t) {
    var beatLen = 60 / (song.bpm || 100);
    for (var i = show.cues.length - 1; i >= 0; i--) { var c = show.cues[i]; if (c.kind !== "flash") continue; var at = cueTime(c), d = (c.dur || 0.5) * beatLen; if (t >= at && t < at + d) return { look: lookById(c.look), p: 1 - (t - at) / d }; }
    return null;
  }
  function render() {
    var t = posNow(), beats = beatClock(), groups = {}, now = performance.now();
    rig.fixtures.forEach(function (f) { (groups[f.group] = groups[f.group] || []).push(f); });
    var base;
    if (live.manual) { var mp = clamp((now - live.manualAt) / 1000 / live.manualFade, 0, 1); base = { from: live.manualFrom || live.manual, to: live.manual, p: mp }; }
    else if (song.playing || live.hold) base = activeLooks(t);
    else base = { from: lookById(rig.stopped || "walkin"), to: lookById(rig.stopped || "walkin"), p: 1 };
    var fl = song.playing ? activeFlash(t) : null;
    if (live.flash && now < live.flash.until) fl = { look: lookById(live.flash.look), p: (live.flash.until - now) / live.flash.len };
    var unis = {}, colors = {};
    rig.fixtures.forEach(function (f) {
      var list = groups[f.group], idx = list.indexOf(f), n = list.length;
      var st = base.p >= 1 ? stateFor(base.to, f, idx, n, beats) : mix(stateFor(base.from, f, idx, n, beats), stateFor(base.to, f, idx, n, beats), base.p);
      if (fl && fl.look.g[f.group]) { var fs = stateFor(fl.look, f, idx, n, beats); st = mix(st, fs, clamp(fl.p * 1.5, 0, 1)); }
      var gl = rig.groupLevel[f.group] == null ? 1 : rig.groupLevel[f.group], m = live.blackout ? 0 : (rig.master == null ? 1 : rig.master) * gl;
      st.dim *= m; st.haze *= live.blackout ? 0 : gl;
      if (live.identify && now < live.identify.until) {  // "Find": this fixture full white and blinking, the rest dark
        var on = f.id === live.identify.id && Math.floor(now / 250) % 2 === 0;
        st = { dim: on ? 1 : 0, r: 1, g: 1, b: 1, w: 1, a: 0, uv: 0, strobe: 0, pan: 0.5, tilt: 0.5, haze: 0 };
      }
      colors[f.id] = st;
      write(unis, f, st);
    });
    live.fixtureColor = colors; live.state = { t: t, beats: beats, cue: base.cue || null, manual: !!live.manual };
    live.lastFrame = unis;
    return unis;
  }
  function write(unis, f, st) {
    var u = String(f.universe || 1), data = unis[u] || (unis[u] = new Uint8Array(512)), p = profileOf(f), hasDim = p.ch.indexOf("dim") >= 0, hasW = p.ch.indexOf("w") >= 0, hasA = p.ch.indexOf("a") >= 0;
    var r = st.r, g = st.g, b = st.b, w = st.w, a = st.a;
    if (!hasW && w) { r = Math.min(1, r + w); g = Math.min(1, g + w); b = Math.min(1, b + w); }
    if (!hasA && a) { r = Math.min(1, r + a); g = Math.min(1, g + a * 0.55); }
    var k = hasDim ? 1 : st.dim, pan16 = Math.round(st.pan * 65535), tilt16 = Math.round(st.tilt * 65535);
    var values = { dim: st.dim, r: r * k, g: g * k, b: b * k, w: hasW ? w * k : 0, a: hasA ? a * k : 0, uv: st.uv * k, strobe: st.strobe > 0 ? (10 + st.strobe * 245) / 255 : 0, haze: st.haze, fan: st.haze > 0 ? 0.6 : 0, speed: 0.1, wheel: 0, gobo: 0, prism: 0, focus: 0.5, zero: 0, full: 1 };
    for (var i = 0; i < p.ch.length; i++) {
      var addr = (f.address || 1) - 1 + i; if (addr < 0 || addr > 511) continue;
      var type = p.ch[i], v;
      if (type === "pan") v = pan16 >> 8; else if (type === "panf") v = pan16 & 255; else if (type === "tilt") v = tilt16 >> 8; else if (type === "tiltf") v = tilt16 & 255;
      else v = Math.round(clamp(values[type] == null ? 0 : values[type], 0, 1) * 255);
      data[addr] = v;
    }
  }
  // the frame loop: 40 per second; DMX goes out only when something changed (plus a keep-alive each second)
  var lastSent = "", lastSentAt = 0;
  function tick() {
    var unis = render(), now = performance.now(), key = Object.keys(unis).map(function (u) { return u + ":" + Array.prototype.join.call(unis[u], ","); }).join("|");
    if (DMX && rig.output.mode !== "off" && (key !== lastSent || now - lastSentAt > 1000)) { var plain = {}; Object.keys(unis).forEach(function (u) { plain[u] = Array.from(unis[u]); }); DMX.frame(plain); lastSent = key; lastSentAt = now; }
    if (visible()) drawLive();
  }
  setInterval(tick, 25);

  // ------------------------------------------------------------- from the Central Control
  function onMessage(m) {
    if (m.type === "display") {
      var d = m;
      song.pos = d.pos || 0; song.at = performance.now(); song.playing = !!d.playing; song.speed = d.speed || 1;
      song.bpm = d.bpm || song.bpm; song.bpb = d.bpb || 4; song.duration = d.duration || 0; song.name = d.song ? d.song.name : "";
      if (d.grid) { song.bars = d.grid.bars || []; song.barBeats = d.grid.barBeats || []; song.bpm = d.grid.bpm || song.bpm; }
      if (d.hits) song.hits = d.hits;
      var secs = (d.sections || []).map(function (s) { return { name: s.name, start: s.start, end: s.end, bar: s.bar }; }), sk = JSON.stringify(secs);
      var sid = d.songId || (d.song ? d.song.name : null);
      if (sid !== song.id) {
        song.id = sid; song.sections = secs; song.secKey = sk;
        if (!d.grid) { song.bars = []; song.barBeats = []; song.hits = []; }
        if (sid) loadShow(sid); else { show = { song: null, cues: [], auto: true, saved: true }; renderShowPanel(); }
      } else if (sk !== song.secKey) {
        song.sections = secs; song.secKey = sk;
        if (show.auto) { show.cues = autoCues(); renderShowPanel(); }
      } else if (d.grid && show.auto && !show.loading && (d.hits || []).length !== show.hitCount) { show.cues = autoCues(); show.hitCount = (d.hits || []).length; renderShowPanel(); }
    } else if (m.type === "lighting" && m.song === show.song && m.by !== "Central Usage-" + selfId) {
      if (show.saved) loadShow(show.song);
    }
  }
  var selfId = uid();

  // ------------------------------------------------------------- UI
  var view = store.get("lxView", "show"), selectedCue = null, selectedLook = store.get("lxLook", "worship"), drag = null;
  function visible() { return CU.prefs.tab === "lights"; }
  function showSub(v) { view = v; store.set("lxView", v); $$("#lxNav [data-lx]").forEach(function (b) { b.classList.toggle("on", b.dataset.lx === v); }); $$(".lx-view").forEach(function (el) { el.hidden = el.dataset.lxv !== v; }); renderAll(); }
  function renderAll() { if (view === "show") { renderPalette(); renderShowPanel(); renderFaders(); } else if (view === "looks") renderLooks(); else if (view === "fixtures") renderFixtures(); else if (view === "output") { renderOutput(); renderRemote(); if (window.CUTimecode) window.CUTimecode.render(); } }

  // ---- show view: stage plot, look palette, faders, timeline
  function renderPalette() {
    var root = $("#lxPalette"); if (!root) return;
    root.innerHTML = rig.looks.map(function (l) { return '<button class="lx-look' + (live.manual && live.manual.id === l.id ? " live" : "") + (selectedLook === l.id ? " sel" : "") + '" data-look="' + esc(l.id) + '" style="--sw:' + esc(l.swatch || "#888") + '"><i></i><span>' + esc(l.name) + "</span></button>"; }).join("");
    $("#lxFollow").classList.toggle("on", !live.manual); $("#lxBlackout").classList.toggle("on", live.blackout);
  }
  function renderFaders() {
    var root = $("#lxFaders"); if (!root) return;
    root.innerHTML = '<label class="lx-fader master">Master<input type="range" min="0" max="1" step="0.01" data-fader="master" value="' + (rig.master == null ? 1 : rig.master) + '"></label>' +
      GROUPS.map(function (g) { if (!rig.fixtures.some(function (f) { return f.group === g[0]; })) return ""; return '<label class="lx-fader">' + esc(g[1]) + '<input type="range" min="0" max="1" step="0.01" data-fader="' + g[0] + '" value="' + (rig.groupLevel[g[0]] == null ? 1 : rig.groupLevel[g[0]]) + '"></label>'; }).join("");
  }
  function drawLive() {
    if (view === "show") { drawPlot(); drawTimeline(); var cue = live.state && live.state.cue; $("#lxNow").textContent = live.manual ? "Live: " + live.manual.name + " (manual)" : !song.playing ? "Stopped: " + lookById(rig.stopped || "walkin").name : cue ? "Cue: " + lookById(cue.look).name + (cue.label ? " · " + cue.label : "") : "No cue yet"; }
    else if (view === "output") drawMonitor();
  }
  function drawPlot() {
    var svg = $("#lxPlot"); if (!svg) return;
    if (svg.dataset.n !== String(rig.fixtures.length) + JSON.stringify(rig.fixtures.map(function (f) { return [f.x, f.y, f.name]; }))) {
      svg.dataset.n = String(rig.fixtures.length) + JSON.stringify(rig.fixtures.map(function (f) { return [f.x, f.y, f.name]; }));
      svg.innerHTML = '<rect x="0" y="0" width="1000" height="560" rx="16" class="lx-stage"></rect><text x="22" y="544" class="lx-aud" style="text-anchor:start">▼ AUDIENCE</text>' + rig.fixtures.map(function (f) {
        var x = (f.x == null ? 0.5 : f.x) * 1000, y = (f.y == null ? 0.5 : f.y) * 520 + 10, mover = profileOf(f).mover;
        return '<g class="lx-fix" data-fix="' + esc(f.id) + '" transform="translate(' + x + "," + y + ')"><circle r="' + (mover ? 26 : f.group === "haze" ? 18 : 22) + '" class="lx-body"></circle><circle r="' + (mover ? 18 : 15) + '" class="lx-lens" id="lens-' + esc(f.id) + '"></circle>' + (mover ? '<line x1="0" y1="0" x2="0" y2="-34" class="lx-beam" id="beam-' + esc(f.id) + '"></line>' : "") + '<text y="' + (y > 470 ? -(mover ? 34 : 30) : (mover ? 50 : 44)) + '">' + esc(f.name) + "</text></g>";
      }).join("");
    }
    rig.fixtures.forEach(function (f) {
      var st = live.fixtureColor[f.id], el = document.getElementById("lens-" + f.id); if (!st || !el) return;
      var k = f.group === "haze" ? st.haze : st.dim, r = Math.round(clamp((st.r + st.w + st.a) * k, 0, 1) * 255), g = Math.round(clamp((st.g + st.w + st.a * 0.55) * k, 0, 1) * 255), b = Math.round(clamp((st.b + st.w + st.uv * 0.6) * k, 0, 1) * 255);
      if (f.group === "haze") { r = g = b = Math.round(160 * k); }
      el.style.fill = "rgb(" + r + "," + g + "," + b + ")"; el.style.filter = k > 0.05 ? "drop-shadow(0 0 " + Math.round(4 + 14 * k) + "px rgb(" + r + "," + g + "," + b + "))" : "none";
      var beam = document.getElementById("beam-" + f.id); if (beam) { var ang = (st.pan - 0.5) * 300, len = 20 + st.tilt * 50; beam.setAttribute("x2", String(Math.sin(ang * Math.PI / 180) * len)); beam.setAttribute("y2", String(-Math.cos(ang * Math.PI / 180) * len)); beam.style.stroke = "rgb(" + r + "," + g + "," + b + ")"; beam.style.opacity = String(0.2 + k * 0.8); }
    });
  }
  // timeline: x = time, rows: sections, hits, cues
  var tl = { x0: 0, x1: 0, w: 0 };
  function tlTime(px) { var dur = Math.max(10, song.duration || 60); return clamp(px / tl.w, 0, 1) * dur; }
  function tlX(t) { var dur = Math.max(10, song.duration || 60); return t / dur * tl.w; }
  function drawTimeline() {
    var cv = $("#lxTimeline"); if (!cv) return;
    var dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight; if (!W) return;
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    var ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H); tl.w = W;
    var dur = Math.max(10, song.duration || 60);
    // bars
    ctx.fillStyle = "rgba(255,255,255,.06)"; song.bars.forEach(function (b, i) { var x = tlX(b); ctx.fillRect(x, 0, 1, H); if (i % 4 === 0 && W / (song.bars.length || 1) * 4 > 26) { ctx.fillStyle = "rgba(255,255,255,.35)"; ctx.font = "10px sans-serif"; ctx.fillText(String(i + 1), x + 2, H - 4); ctx.fillStyle = "rgba(255,255,255,.06)"; } });
    // sections
    var cols = ["#1d3a66", "#244b3a", "#4b2a5c", "#5c3a1d", "#1d4c5c", "#5c1d33"];
    song.sections.forEach(function (s, i) { var x = tlX(s.start), x2 = tlX(s.end || dur); ctx.fillStyle = cols[i % cols.length]; ctx.globalAlpha = 0.7; ctx.fillRect(x, 0, Math.max(1, x2 - x - 1), 20); ctx.globalAlpha = 1; ctx.fillStyle = "#e8f2ff"; ctx.font = "bold 11px sans-serif"; ctx.save(); ctx.beginPath(); ctx.rect(x, 0, x2 - x - 2, 20); ctx.clip(); ctx.fillText(s.name, x + 4, 14); ctx.restore(); });
    // hits
    ctx.fillStyle = "#ffd765"; song.hits.forEach(function (h) { ctx.fillRect(tlX(h) - 1, 22, 2, 8); });
    // cues
    show.cues.forEach(function (c) {
      var x = tlX(cueTime(c)), l = lookById(c.look), y = c.kind === "flash" ? 58 : 34, h = c.kind === "flash" ? 16 : 22;
      if (c.kind !== "flash" && c.fade) { var fw = tlX(cueTime(c) + c.fade * 60 / song.bpm) - x; ctx.fillStyle = "rgba(255,255,255,.12)"; ctx.fillRect(x, y, fw, h); }
      ctx.fillStyle = l.swatch || "#888"; ctx.fillRect(x - 3, y, 6, h); ctx.strokeStyle = c === selectedCue ? "#5de6b0" : "rgba(0,0,0,.6)"; ctx.lineWidth = c === selectedCue ? 3 : 1; ctx.strokeRect(x - 3.5, y - 0.5, 7, h + 1);
      if (c.kind !== "flash") { ctx.fillStyle = "#dfe9f5"; ctx.font = "11px sans-serif"; ctx.fillText(l.name, x + 6, y + 15); }
    });
    // playhead
    var px = tlX(posNow()); ctx.fillStyle = "#5de6b0"; ctx.fillRect(px - 1, 0, 2, H);
  }
  function cueAtPx(px, py) { var best = null, bd = 9; show.cues.forEach(function (c) { var x = tlX(cueTime(c)), y = c.kind === "flash" ? 66 : 45, d = Math.abs(x - px) + (Math.abs(y - py) > 16 ? 20 : 0); if (d < bd) { bd = d; best = c; } }); return best; }
  function snapTime(t) {
    var bb = barBeatAt(t), bar = bb.bar, beat = bb.beat;
    if (rig.snap === "bar") { if (beat > beatsIn(bar - 1) / 2 + 1) bar++; beat = 1; }
    else if (rig.snap === "half") beat = Math.round(beat * 2) / 2; else beat = Math.round(beat);
    if (beat > beatsIn(bar - 1)) { bar++; beat = 1; } if (beat < 1) beat = 1;
    return { bar: Math.max(1, bar), beat: beat };
  }
  function renderShowPanel() {
    var info = $("#lxShowInfo"); if (!info) return;
    info.textContent = !show.song ? "No song on the Central Control." : show.loading ? "Loading the light show…" : (show.auto ? "Automatic show (from the sections and the hits) - edit anything to make it yours" : show.cues.length + " cues") + " · " + (song.name || "");
    $("#lxSaveState").textContent = show.saved ? (show.auto ? "" : "saved on the Central Control") : "saving…";
    var ins = $("#lxCue");
    if (!selectedCue || show.cues.indexOf(selectedCue) < 0) { selectedCue = null; ins.innerHTML = '<span class="muted">Click the timeline to add a cue with the selected look (snap: ' + esc(rig.snap) + '). Click a cue to edit it, drag it to move it.</span>'; return; }
    var c = selectedCue;
    ins.innerHTML = '<label>Look<select data-cue="look">' + rig.looks.map(function (l) { return '<option value="' + esc(l.id) + '"' + (l.id === c.look ? " selected" : "") + ">" + esc(l.name) + "</option>"; }).join("") + "</select></label>" +
      '<label>Kind<select data-cue="kind"><option value="look"' + (c.kind !== "flash" ? " selected" : "") + '>Go to look</option><option value="flash"' + (c.kind === "flash" ? " selected" : "") + ">Flash (then back)</option></select></label>" +
      '<label>Bar<input type="number" min="1" data-cue="bar" value="' + c.bar + '"></label><label>Beat<input type="number" min="1" max="12" step="0.5" data-cue="beat" value="' + (c.beat || 1) + '"></label>' +
      (c.kind === "flash" ? '<label>Length (beats)<input type="number" min="0.125" step="0.125" data-cue="dur" value="' + (c.dur || 0.5) + '"></label>' : '<label>Fade (beats)<input type="number" min="0" max="64" step="0.5" data-cue="fade" value="' + (c.fade || 0) + '"></label>') +
      '<button data-cue="go" title="Jump the Central Control here">▶ Play from here</button><button data-cue="del" class="danger">Delete</button>';
  }

  // ---- looks view
  var editLook = null;
  function renderLooks() {
    var list = $("#lxLookList"); if (!list) return;
    if (!editLook || rig.looks.indexOf(editLook) < 0) editLook = lookById(selectedLook);
    list.innerHTML = rig.looks.map(function (l) { return '<button class="lx-look' + (l === editLook ? " sel" : "") + '" data-edit-look="' + esc(l.id) + '" style="--sw:' + esc(l.swatch || "#888") + '"><i></i><span>' + esc(l.name) + "</span></button>"; }).join("") + '<button class="lx-look add" data-a="look-new"><i></i><span>+ New look</span></button>';
    var l = editLook, ed = $("#lxLookEdit");
    ed.innerHTML = '<div class="row"><label>Name<input data-lk="name" value="' + esc(l.name) + '"></label><label>Button colour<input type="color" data-lk="swatch" value="' + esc(l.swatch || "#888888") + '"></label><label class="toggle"><input type="checkbox" data-lk="flash"' + (l.flash ? " checked" : "") + '> Flash look (for hits)</label><button data-a="look-try">Try it live</button><button data-a="look-dup">Duplicate</button>' + (l.builtIn ? '<button data-a="look-reset">Reset</button>' : '<button data-a="look-del" class="danger">Delete</button>') + "</div>" +
      '<div class="lx-groups">' + GROUPS.map(function (gr) {
        var g = l.g[gr[0]], on = !!g; g = g || G(0, "#ffffff");
        var mover = gr[0] === "beam", haze = gr[0] === "haze";
        return '<div class="lx-group' + (on ? "" : " off") + '" data-group="' + gr[0] + '"><div class="row spread"><b>' + esc(gr[1]) + '</b><label class="toggle"><input type="checkbox" data-lg="on"' + (on ? " checked" : "") + "> on</label></div>" +
          '<label>' + (haze ? "Output" : "Intensity") + ' <output>' + Math.round(g.dim * 100) + '%</output><input type="range" min="0" max="1" step="0.01" data-lg="dim" value="' + g.dim + '"></label>' +
          (haze ? "" : '<div class="row"><label>Colour<input type="color" data-lg="color" value="' + esc(g.color) + '"></label><span class="lx-swatches">' + ["#ffb36b", "#ffffff", "#1f4dff", "#0a1fb0", "#7a2bff", "#ff2a10", "#ff8a00", "#00c8ff", "#00e676", "#ff3ea5"].map(function (c) { return '<button data-lg-color="' + c + '" style="background:' + c + '"></button>'; }).join("") + "</span></div>" +
          '<div class="row"><label>White <input type="range" min="0" max="1" step="0.05" data-lg="w" value="' + (g.w || 0) + '"></label><label>Amber <input type="range" min="0" max="1" step="0.05" data-lg="a" value="' + (g.a || 0) + '"></label><label>UV <input type="range" min="0" max="1" step="0.05" data-lg="uv" value="' + (g.uv || 0) + '"></label><label>Strobe <input type="range" min="0" max="1" step="0.05" data-lg="strobe" value="' + (g.strobe || 0) + '"></label></div>' +
          '<div class="row"><label>Effect<select data-lg="fx">' + FX.map(function (f) { return '<option value="' + f[0] + '"' + (f[0] === g.fx ? " selected" : "") + ">" + f[1] + "</option>"; }).join("") + '</select></label><label>Every<select data-lg="speed">' + [[0.25, "¼ beat"], [0.5, "½ beat"], [1, "beat"], [2, "2 beats"], [4, "bar"], [8, "2 bars"], [16, "4 bars"]].map(function (s) { return '<option value="' + s[0] + '"' + (Number(g.speed) === s[0] ? " selected" : "") + ">" + s[1] + "</option>"; }).join("") + '</select></label><label>Depth <input type="range" min="0" max="1" step="0.05" data-lg="size" value="' + (g.size == null ? 0.6 : g.size) + '"></label></div>' +
          (mover || groupHasMovers(gr[0]) ? moverEditor(g) : "")) + "</div>";
      }).join("") + "</div>";
  }

  // ---- moving heads: an XY pad (pan across, tilt down), position presets, fan and phase
  function groupHasMovers(gk) { return rig.fixtures.some(function (f) { return f.group === gk && profileOf(f).mover; }); }
  function moverEditor(g) {
    var pan = g.pan == null ? 0.5 : g.pan, tilt = g.tilt == null ? 0.5 : g.tilt;
    return '<div class="lx-mover"><div class="lx-xy" data-xy="1" title="Drag: where the movers point (left-right = pan, up-down = tilt)"><i style="left:' + (pan * 100) + '%;top:' + (tilt * 100) + '%"></i><span>pan ' + Math.round(pan * 100) + " · tilt " + Math.round(tilt * 100) + '</span></div><div class="lx-mv-side"><div class="lx-pos">' +
      POSITIONS.map(function (p, i) { return '<button data-pos="' + i + '">' + esc(p[0]) + "</button>"; }).join("") + '</div><label>Fan out <input type="range" min="0" max="1" step="0.05" data-lg="fan" value="' + (g.fan || 0) + '"></label><label>Phase <input type="range" min="0" max="1" step="0.05" data-lg="offset" value="' + (g.offset == null ? 1 : g.offset) + '" title="0 = all movers together, 1 = spread around the shape"></label></div></div>';
  }
  function profileOptions(sel) {
    var lib = rig.library || [];
    return '<optgroup label="Generic">' + Object.keys(PROFILES).map(function (k) { return '<option value="' + k + '"' + (k === sel ? " selected" : "") + ">" + esc(PROFILES[k].name) + "</option>"; }).join("") + "</optgroup>" +
      (lib.length ? '<optgroup label="Your fixture library">' + lib.map(function (e) { return '<option value="' + esc(e.id) + '"' + (e.id === sel ? " selected" : "") + ">" + esc(e.name) + "</option>"; }).join("") + "</optgroup>" : "");
  }
  function fillAddProfiles() { var el = $("#lxAddProfile"); if (el) { var v = el.value; el.innerHTML = profileOptions(v || "rgbwd5"); if (v) el.value = v; } }
  // ---- the fixture library: QLC+ definitions on this computer, or .qxf / OFL .json files you pick
  var libScan = null, libQuery = "";
  function addToLibrary(entries) { rig.library = rig.library || []; var added = 0; entries.forEach(function (e) { if (!rig.library.some(function (x) { return x.id === e.id; })) { rig.library.push(e); added++; } }); rig.library.sort(function (a, b) { return a.name.localeCompare(b.name); }); saveRig(); fillAddProfiles(); renderLibrary(); return added; }
  function renderLibrary() {
    var root = $("#lxLib"); if (!root) return;
    var lib = rig.library || [], q = libQuery.toLowerCase(), hits = libScan ? libScan.filter(function (x) { return !q || (x.maker + " " + x.model).toLowerCase().indexOf(q) >= 0; }).slice(0, 60) : [];
    root.innerHTML = '<div class="row"><button id="lxLibImport">Import fixture files (.qxf / .json)…</button><button id="lxLibScan">' + (libScan ? "Search again" : "Search the QLC+ library on this computer") + '</button>' + (libScan ? '<input id="lxLibQ" placeholder="Maker or model…" value="' + esc(libQuery) + '">' : "") + '<span class="muted small">' + (libScan ? libScan.length + " fixture files found" : "Get definitions at open-fixture-library.org (Download → OFL JSON or QLC+), or install QLC+ for its whole library.") + "</span></div>" +
      (hits.length ? '<div class="lx-libhits">' + hits.map(function (x) { return '<button data-libfile="' + esc(x.path) + '"><b>' + esc(x.model) + "</b><small>" + esc(x.maker) + "</small></button>"; }).join("") + "</div>" : libScan && q ? '<p class="muted">Nothing matches.</p>' : "") +
      (lib.length ? '<div class="lx-libmine"><b>Your fixture library</b> (' + lib.length + " modes)" + lib.map(function (e) { return '<div class="lx-libitem"><span>' + esc(e.name) + '</span><small class="muted">' + esc(e.ch.join(" ")) + '</small><button data-libdel="' + esc(e.id) + '" title="Remove from the library">✕</button></div>'; }).join("") + "</div>" : "");
  }
  function wireLibrary() {
    var root = $("#lxLib"); if (!root) return;
    root.addEventListener("click", async function (e) {
      var b = e.target.closest("button"); if (!b) return; var FL = window.CU && window.CU.fixtures;
      if (b.id === "lxLibImport") { if (!FL) return alert("Importing fixtures works in the Central Usage app."); var files = await FL.open(), n = 0, errs = []; files.forEach(function (f) { try { n += addToLibrary(window.CUFixtureLib.parse(f.name, f.text)); } catch (err) { errs.push(f.name + ": " + err.message); } }); if (errs.length) alert("Some files could not be read:\n" + errs.join("\n")); return; }
      if (b.id === "lxLibScan") { if (!FL) return; b.disabled = true; libScan = await FL.scan(); b.disabled = false; renderLibrary(); var qi = $("#lxLibQ"); if (qi) qi.focus(); if (!libScan.length) alert("No QLC+ fixture library found on this computer (sudo apt install qlcplus adds it), or import files instead."); return; }
      if (b.dataset.libfile) { var text = await FL.read(b.dataset.libfile); if (!text) return; try { var es = window.CUFixtureLib.parseQxf(text), n2 = addToLibrary(es); b.classList.add("added"); b.title = n2 + " mode(s) added"; } catch (err) { alert(err.message); } return; }
      if (b.dataset.libdel) { if (rig.fixtures.some(function (f) { return f.profile === b.dataset.libdel; }) && !confirm("Fixtures use this type. Remove it anyway? (they turn into 1-channel dimmers)")) return; rig.library = (rig.library || []).filter(function (x) { return x.id !== b.dataset.libdel; }); saveRig(); fillAddProfiles(); renderLibrary(); renderFixtures(); }
    });
    root.addEventListener("input", function (e) { if (e.target.id === "lxLibQ") { libQuery = e.target.value; var pos = e.target.selectionStart; renderLibrary(); var qi = $("#lxLibQ"); if (qi) { qi.focus(); qi.setSelectionRange(pos, pos); } } });
  }

  // ---- fixtures view
  function renderFixtures() {
    renderLibrary();
    var root = $("#lxFixTable"); if (!root) return;
    var used = {}, clash = {};
    rig.fixtures.forEach(function (f) { var n = profileOf(f).ch.length; for (var i = 0; i < n; i++) { var k = (f.universe || 1) + ":" + ((f.address || 1) + i); if (used[k] && used[k] !== f.id) { clash[f.id] = true; clash[used[k]] = true; } used[k] = f.id; } });
    root.innerHTML = '<table class="lx-table"><thead><tr><th>Name</th><th>Type</th><th>Group</th><th>Universe</th><th>Address</th><th>Channels</th><th></th></tr></thead><tbody>' + rig.fixtures.map(function (f) {
      var p = profileOf(f), n = p.ch.length, end = (f.address || 1) + n - 1;
      return '<tr data-fx="' + esc(f.id) + '"' + (clash[f.id] ? ' class="clash"' : "") + '><td><input data-ff="name" value="' + esc(f.name) + '"></td><td><select data-ff="profile">' + profileOptions(f.profile) + '<option value="custom"' + (f.profile === "custom" ? " selected" : "") + '>Custom…</option></select>' + (p.mover ? '<span class="lx-inv"><label class="toggle" title="Mirror the pan (a mover hung the other way round)"><input type="checkbox" data-ff="invertPan"' + (f.invertPan ? " checked" : "") + '>invert pan</label><label class="toggle"><input type="checkbox" data-ff="invertTilt"' + (f.invertTilt ? " checked" : "") + ">invert tilt</label></span>" : "") + (f.profile === "custom" ? '<input data-ff="channels" title="Channel types in order: ' + CH_TYPES.join(" ") + '" value="' + esc((f.channels || []).join(" ")) + '">' : "") + "</td>" +
        '<td><select data-ff="group">' + GROUPS.map(function (g) { return '<option value="' + g[0] + '"' + (g[0] === f.group ? " selected" : "") + ">" + esc(g[1]) + "</option>"; }).join("") + '</select></td><td><input type="number" min="1" max="64" data-ff="universe" value="' + (f.universe || 1) + '"></td><td><input type="number" min="1" max="512" data-ff="address" value="' + (f.address || 1) + '"></td><td class="muted">' + n + " (" + f.address + "–" + end + ")" + (clash[f.id] ? ' <b class="bad">overlaps</b>' : end > 512 ? ' <b class="bad">past 512</b>' : "") + '</td><td><button data-ff="identify" title="Flash this fixture">Find</button><button data-ff="del" title="Remove">✕</button></td></tr>';
    }).join("") + "</tbody></table>";
    var next = rig.fixtures.reduce(function (m, f) { return (f.universe || 1) === 1 ? Math.max(m, (f.address || 1) + profileOf(f).ch.length) : m; }, 1);
    $("#lxAddAddr").value = Math.min(512, next);
  }
  function addFixtures() {
    var prof = $("#lxAddProfile").value, P = profileFor(prof) || PROFILES.dimmer, n = clamp(Number($("#lxAddCount").value) || 1, 1, 48), addr = clamp(Number($("#lxAddAddr").value) || 1, 1, 512), grp = $("#lxAddGroup").value, le = libEntry(prof), name = $("#lxAddName").value.trim() || (le ? le.model : P.name.replace(/\s*\(.*$/, ""));
    for (var i = 0; i < n; i++) rig.fixtures.push({ id: uid(), name: n > 1 ? name + " " + (i + 1) : name, profile: prof, group: grp, universe: 1, address: addr + i * P.ch.length, x: n > 1 ? 0.15 + 0.7 * i / (n - 1) : 0.5, y: { front: 0.85, back: 0.2, beam: 0.34, house: 0.96, fx: 0.08, haze: 0.1 }[grp] || 0.5 });
    saveRig(); renderFixtures(); $("#lxPlot").dataset.n = "";
  }

  // ---- output view
  var outStatus = null;
  async function renderOutput() {
    var o = rig.output;
    $$('input[name="lxOut"]').forEach(function (r) { r.checked = r.value === o.mode; });
    $("#lxHost").value = o.host || ""; $("#lxUniOffset").value = o.offset || 0;
    $("#lxUsbRow").hidden = o.mode !== "usb"; $("#lxUsbHelp").hidden = o.mode !== "usb"; $("#lxNetRow").hidden = !(o.mode === "artnet" || o.mode === "sacn");
    $("#lxHostLabel").firstChild.textContent = o.mode === "sacn" ? "Node IP (empty = multicast) " : "Node IP (empty = broadcast) ";
    if (!DMX) { $("#lxOutState").textContent = "DMX output works in the Central Usage app (not in a browser)."; return; }
    var ports = await DMX.ports();
    $("#lxPort").innerHTML = '<option value="">— choose the USB-DMX interface —</option>' + ports.map(function (p) { return '<option value="' + esc(p.path) + '"' + (p.path === o.path ? " selected" : "") + ">" + esc(p.name) + (p.likely ? " ★" : "") + " (" + esc(p.device) + ")</option>"; }).join("");
    outStatus = await DMX.status();
    $("#lxOutState").textContent = o.mode === "off" ? "DMX output is off." : outStatus.error ? "⚠ " + outStatus.error : "Sending to " + (outStatus.target || "?") + " · " + outStatus.frames + " frames";
  }
  async function applyOutput() { saveRig(); if (DMX) { await DMX.configure(Object.assign({ universe: 1 }, rig.output)); lastSent = ""; } renderOutput(); }
  function drawMonitor() {
    var root = $("#lxMonitor"); if (!root || !live.lastFrame) return;
    var u = live.lastFrame["1"] || new Uint8Array(512), last = rig.fixtures.reduce(function (m, f) { return (f.universe || 1) === 1 ? Math.max(m, (f.address || 1) + profileOf(f).ch.length - 1) : m; }, 16), n = clamp(Math.ceil(last / 16) * 16, 16, 512);
    if (root.children.length !== n) { var h = ""; for (var i = 0; i < n; i++) h += '<span title="' + (i + 1) + '"><i></i><b>' + (i + 1) + "</b></span>"; root.innerHTML = h; }
    for (var k = 0; k < n; k++) { var el = root.children[k].firstChild; el.style.height = (u[k] / 255 * 100) + "%"; root.children[k].title = (k + 1) + ": " + u[k]; }
  }

  // ------------------------------------------------------------- events
  function goLook(id) { var l = lookById(id); if (l.flash) { live.flash = { look: l.id, until: performance.now() + 450, len: 450 }; return; } live.manualFrom = live.manual || (live.state && live.state.cue ? lookById(live.state.cue.look) : lookById(rig.stopped || "walkin")); live.manual = l; live.manualAt = performance.now(); renderPalette(); }
  function wire() {
    $("#lxNav").addEventListener("click", function (e) { var b = e.target.closest("[data-lx]"); if (b) showSub(b.dataset.lx); });
    $("#lxPalette").addEventListener("click", function (e) { var b = e.target.closest("[data-look]"); if (!b) return; selectedLook = b.dataset.look; store.set("lxLook", selectedLook); goLook(b.dataset.look); renderPalette(); });
    $("#lxFollow").addEventListener("click", function () { live.manual = null; renderPalette(); });
    $("#lxBlackout").addEventListener("click", function () { live.blackout = !live.blackout; renderPalette(); });
    function recordHit() { if (!live.rec || !song.playing || !show.song) return; var bb = barBeatAt(posNow() - (CU.prefs.offsetMs || 0) / 1000), beat = Math.round(bb.beat * 2) / 2, bar = bb.bar; if (beat >= beatsIn(bar - 1) + 1) { bar++; beat = 1; } show.cues.push({ id: uid(), bar: bar, beat: beat, look: "hit", kind: "flash", dur: 0.5 }); sortCues(show.cues); changed(); }
    $("#lxRec").addEventListener("click", function () { live.rec = !live.rec; this.classList.toggle("rec", live.rec); this.textContent = live.rec ? "■ Stop recording" : "● Record hits"; });
    document.addEventListener("keydown", function (e) { if (!visible() || e.target.matches("input,select,textarea") || e.repeat) return; if (e.key === "h" || e.key === "H") { live.flash = { look: "hit", until: performance.now() + 250, len: 250 }; recordHit(); } });
    $("#lxFlash").addEventListener("pointerdown", function () { live.flash = { look: "hit", until: performance.now() + 100000, len: 100000 }; recordHit(); });
    ["pointerup", "pointerleave"].forEach(function (ev) { $("#lxFlash").addEventListener(ev, function () { if (live.flash && live.flash.len > 1000) live.flash = { look: "hit", until: performance.now() + 250, len: 250 }; }); });
    $("#lxFaders").addEventListener("input", function (e) { var k = e.target.dataset.fader; if (!k) return; if (k === "master") rig.master = Number(e.target.value); else rig.groupLevel[k] = Number(e.target.value); saveRig(); });
    $("#lxAuto").addEventListener("click", function () { if (show.cues.length && !show.auto && !confirm("Replace this song's cues with an automatic show from its sections and hits?")) return; show.cues = autoCues(); show.auto = false; selectedCue = null; changed(); });
    $("#lxClear").addEventListener("click", function () { if (!confirm("Remove every cue from this song?")) return; show.cues = []; selectedCue = null; changed(); });
    $("#lxSnap").value = rig.snap || "beat"; $("#lxSnap").addEventListener("change", function () { rig.snap = this.value; saveRig(); renderShowPanel(); });
    $("#lxStopped").innerHTML = rig.looks.map(function (l) { return '<option value="' + esc(l.id) + '"' + (l.id === rig.stopped ? " selected" : "") + ">" + esc(l.name) + "</option>"; }).join(""); $("#lxStopped").addEventListener("change", function () { rig.stopped = this.value; saveRig(); });
    var cv = $("#lxTimeline");
    cv.addEventListener("pointerdown", function (e) {
      var r = cv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top, c = cueAtPx(px, py);
      if (c) { selectedCue = c; drag = { cue: c, moved: false }; cv.setPointerCapture(e.pointerId); renderShowPanel(); return; }
      if (!show.song) return;
      var at = snapTime(tlTime(px)), l = lookById(selectedLook);
      var cue = { id: uid(), bar: at.bar, beat: at.beat, look: l.id, kind: l.flash ? "flash" : "look", fade: l.flash ? 0 : 1, dur: 0.5 };
      show.cues.push(cue); sortCues(show.cues); selectedCue = cue; changed();
    });
    cv.addEventListener("pointermove", function (e) { if (!drag) return; var r = cv.getBoundingClientRect(), at = snapTime(tlTime(e.clientX - r.left)); if (at.bar !== drag.cue.bar || at.beat !== drag.cue.beat) { drag.cue.bar = at.bar; drag.cue.beat = at.beat; drag.moved = true; renderShowPanel(); } });
    cv.addEventListener("pointerup", function () { if (drag && drag.moved) { sortCues(show.cues); changed(); } drag = null; });
    $("#lxCue").addEventListener("change", function (e) { var f = e.target.dataset.cue, c = selectedCue; if (!f || !c) return; var v = e.target.value; if (f === "look") { c.look = v; if (lookById(v).flash) c.kind = "flash"; } else if (f === "kind") c.kind = v; else c[f] = Number(v); delete c.auto; sortCues(show.cues); changed(); });
    $("#lxCue").addEventListener("click", function (e) { var f = e.target.dataset.cue, c = selectedCue; if (!c) return; if (f === "del") { show.cues.splice(show.cues.indexOf(c), 1); selectedCue = null; changed(); } else if (f === "go") { var t = cueTime(c), idx = -1; (song.sections || []).forEach(function (s, i) { if (s.start <= t + 0.01) idx = i; }); if (idx >= 0) CU.action("goSection", { index: idx }); } });
    document.addEventListener("keydown", function (e) { if (!visible() || view !== "show" || e.target.matches("input,select,textarea")) return; if ((e.key === "Delete" || e.key === "Backspace") && selectedCue) { show.cues.splice(show.cues.indexOf(selectedCue), 1); selectedCue = null; changed(); e.preventDefault(); } });
    // plot: drag fixtures around
    var plot = $("#lxPlot"), pdrag = null;
    plot.addEventListener("pointerdown", function (e) { var g = e.target.closest("[data-fix]"); if (!g) return; pdrag = rig.fixtures.filter(function (f) { return f.id === g.dataset.fix; })[0]; plot.setPointerCapture(e.pointerId); });
    plot.addEventListener("pointermove", function (e) { if (!pdrag) return; var r = plot.getBoundingClientRect(); pdrag.x = clamp((e.clientX - r.left) / r.width, 0.03, 0.97); pdrag.y = clamp(((e.clientY - r.top) / r.height * 560 - 10) / 520, 0, 1); plot.dataset.n = ""; });
    plot.addEventListener("pointerup", function () { if (pdrag) { saveRig(); pdrag = null; } });
    // looks editor
    $("#lxLookList").addEventListener("click", function (e) { var b = e.target.closest("[data-edit-look],[data-a]"); if (!b) return; if (b.dataset.editLook) { editLook = lookById(b.dataset.editLook); selectedLook = editLook.id; store.set("lxLook", selectedLook); } else if (b.dataset.a === "look-new") { editLook = { id: uid(), name: "New look", swatch: "#44aaff", g: { front: G(0.6, WARM), back: G(0.8, BLUE) } }; rig.looks.push(editLook); saveRig(); } renderLooks(); });
    var lookEd = $("#lxLookEdit");
    function lookField(e) {
      var l = editLook, el = e.target; if (!l) return;
      if (el.dataset.lk) { if (el.dataset.lk === "flash") l.flash = el.checked; else l[el.dataset.lk] = el.value; if (el.dataset.lk === "name") $$('[data-edit-look="' + l.id + '"] span').forEach(function (s) { s.textContent = el.value; }); saveRig(); return; }
      var box = el.closest("[data-group]"); if (!box) return; var gk = box.dataset.group, f = el.dataset.lg; if (!f) return;
      if (f === "on") { if (el.checked) l.g[gk] = l.g[gk] || G(0.7, "#ffffff"); else delete l.g[gk]; saveRig(); renderLooks(); return; }
      l.g[gk] = l.g[gk] || G(0.7, "#ffffff");
      l.g[gk][f] = f === "color" || f === "fx" ? el.value : Number(el.value);
      var out = el.parentNode.querySelector("output"); if (out) out.textContent = Math.round(Number(el.value) * 100) + "%";
      saveRig();
    }
    lookEd.addEventListener("input", lookField); lookEd.addEventListener("change", lookField);
    var xyDrag = null;
    function xyMove(e) { if (!xyDrag || !editLook) return; var r = xyDrag.el.getBoundingClientRect(), g = editLook.g[xyDrag.gk] = editLook.g[xyDrag.gk] || G(0.7); g.pan = Math.round(clamp((e.clientX - r.left) / r.width, 0, 1) * 100) / 100; g.tilt = Math.round(clamp((e.clientY - r.top) / r.height, 0, 1) * 100) / 100; var dot = xyDrag.el.querySelector("i"); dot.style.left = g.pan * 100 + "%"; dot.style.top = g.tilt * 100 + "%"; xyDrag.el.querySelector("span").textContent = "pan " + Math.round(g.pan * 100) + " · tilt " + Math.round(g.tilt * 100); }
    lookEd.addEventListener("pointerdown", function (e) { var el = e.target.closest("[data-xy]"); if (!el) return; xyDrag = { el: el, gk: el.closest("[data-group]").dataset.group }; el.setPointerCapture(e.pointerId); xyMove(e); if (!live.manual || live.manual.id !== editLook.id) goLook(editLook.id); });
    lookEd.addEventListener("pointermove", xyMove);
    lookEd.addEventListener("pointerup", function () { if (xyDrag) { xyDrag = null; saveRig(); } });
    lookEd.addEventListener("click", function (e) {
      var b = e.target.closest("[data-a],[data-lg-color],[data-pos]"); if (!b || !editLook) return;
      if (b.dataset.pos != null) { var gp = b.closest("[data-group]").dataset.group, P = POSITIONS[Number(b.dataset.pos)], gg = editLook.g[gp] = editLook.g[gp] || G(0.7); gg.pan = P[1]; gg.tilt = P[2]; if (P[3] != null) gg.fan = P[3]; saveRig(); renderLooks(); return; }
      if (b.dataset.lgColor) { var gk = b.closest("[data-group]").dataset.group; editLook.g[gk] = editLook.g[gk] || G(0.7); editLook.g[gk].color = b.dataset.lgColor; saveRig(); renderLooks(); return; }
      var a = b.dataset.a;
      if (a === "look-try") { selectedLook = editLook.id; goLook(editLook.id); }
      else if (a === "look-dup") { var c = JSON.parse(JSON.stringify(editLook)); c.id = uid(); c.name += " copy"; delete c.builtIn; rig.looks.push(c); editLook = c; saveRig(); renderLooks(); }
      else if (a === "look-del") { if (confirm("Delete the look \"" + editLook.name + "\"? Cues using it fall back to the first look.")) { rig.looks.splice(rig.looks.indexOf(editLook), 1); editLook = null; saveRig(); renderLooks(); } }
      else if (a === "look-reset") { var orig = BUILTIN().filter(function (x) { return x.id === editLook.id; })[0]; if (orig) { rig.looks[rig.looks.indexOf(editLook)] = orig; editLook = orig; saveRig(); renderLooks(); } }
    });
    // fixtures
    fillAddProfiles(); wireLibrary();
    $("#lxAddGroup").innerHTML = GROUPS.map(function (g) { return '<option value="' + g[0] + '">' + esc(g[1]) + "</option>"; }).join("");
    $("#lxAddBtn").addEventListener("click", addFixtures);
    $("#lxFixTable").addEventListener("change", function (e) {
      var row = e.target.closest("[data-fx]"), f = row && rig.fixtures.filter(function (q) { return q.id === row.dataset.fx; })[0], k = e.target.dataset.ff; if (!f || !k) return;
      if (k === "universe" || k === "address") f[k] = clamp(Math.round(Number(e.target.value) || 1), 1, k === "address" ? 512 : 64);
      else if (k === "channels") f.channels = e.target.value.trim().split(/[\s,]+/).filter(function (c) { return CH_TYPES.indexOf(c) >= 0; });
      else if (k === "invertPan" || k === "invertTilt") f[k] = e.target.checked;
      else { f[k] = e.target.value; if (k === "profile" && f.profile === "custom" && !f.channels) f.channels = ["dim", "r", "g", "b"]; }
      saveRig(); renderFixtures(); $("#lxPlot").dataset.n = "";
    });
    $("#lxFixTable").addEventListener("click", function (e) {
      var row = e.target.closest("[data-fx]"), f = row && rig.fixtures.filter(function (q) { return q.id === row.dataset.fx; })[0], k = e.target.dataset.ff; if (!f) return;
      if (k === "del") { rig.fixtures.splice(rig.fixtures.indexOf(f), 1); saveRig(); renderFixtures(); $("#lxPlot").dataset.n = ""; }
      else if (k === "identify") { live.identify = { id: f.id, until: performance.now() + 2500 }; }
    });
    $("#lxRigSave").addEventListener("click", function () { var text = JSON.stringify({ format: "central-usage-rig", version: 1, fixtures: rig.fixtures, looks: rig.looks.filter(function (l) { return !l.builtIn || true; }), output: rig.output }, null, 1); if (window.CU && window.CU.saveFile) window.CU.saveFile("lighting-rig.json", text); else { var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "application/json" })); a.download = "lighting-rig.json"; a.click(); } });
    $("#lxRigOpen").addEventListener("click", async function () { var text = window.CU && window.CU.openFile ? await window.CU.openFile() : null; if (!text) return; try { var j = JSON.parse(text); if (j.format !== "central-usage-rig") throw new Error("not a Central Usage rig"); rig.fixtures = j.fixtures || []; rig.looks = j.looks && j.looks.length ? j.looks : BUILTIN(); saveRig(); renderAll(); } catch (err) { alert("Could not open it: " + err.message); } });
    $("#lxRigReset").addEventListener("click", function () { if (!confirm("Start again with the example rig (10 fixtures)?")) return; var keep = rig.output; rig = defaultRig(); rig.output = keep; saveRig(); renderAll(); });
    // output
    $$('input[name="lxOut"]').forEach(function (r) { r.addEventListener("change", function () { rig.output.mode = this.value; applyOutput(); }); });
    $("#lxPort").addEventListener("change", function () { rig.output.path = this.value; applyOutput(); });
    $("#lxRescan").addEventListener("click", renderOutput);
    $("#lxHost").addEventListener("change", function () { rig.output.host = this.value.trim(); applyOutput(); });
    $("#lxUniOffset").addEventListener("change", function () { rig.output.offset = Number(this.value) || 0; applyOutput(); });
    setInterval(function () { if (visible() && view === "output" && DMX) DMX.status().then(function (s) { outStatus = s; var o = rig.output; $("#lxOutState").textContent = o.mode === "off" ? "DMX output is off." : s.error ? "⚠ " + s.error : "Sending to " + (s.target || "?") + " · " + s.frames + " frames"; }); }, 1500);
  }
  // ------------------------------------------------------------- phone remote (the page is served by the main process)
  var RM = window.CU && window.CU.remote, remoteOn = false;
  function remoteState() {
    var cue = live.state && live.state.cue;
    return { song: song.name || "", now: live.blackout ? "Blackout" : live.manual ? "Live: " + live.manual.name : !song.playing ? "Stopped: " + lookById(rig.stopped || "walkin").name : cue ? "Show: " + lookById(cue.look).name : "Show",
      manual: !!live.manual, blackout: !!live.blackout, looks: rig.looks.map(function (l) { return { id: l.id, name: l.name, swatch: l.swatch, flash: !!l.flash, live: !!(live.manual && live.manual.id === l.id) }; }),
      faders: [{ id: "master", name: "Master", value: rig.master == null ? 1 : rig.master }].concat(GROUPS.filter(function (g) { return rig.fixtures.some(function (f) { return f.group === g[0]; }); }).map(function (g) { return { id: g[0], name: g[1], value: rig.groupLevel[g[0]] == null ? 1 : rig.groupLevel[g[0]] }; })) };
  }
  function remoteCommand(c) {
    if (c.cmd === "look" && c.id) goLook(c.id);
    else if (c.cmd === "follow") live.manual = null;
    else if (c.cmd === "blackout") live.blackout = !live.blackout;
    else if (c.cmd === "flash") live.flash = c.on ? { look: "hit", until: performance.now() + 100000, len: 100000 } : { look: "hit", until: performance.now() + 250, len: 250 };
    else if (c.cmd === "fader" && c.id) { var v = clamp(Number(c.value) || 0, 0, 1); if (c.id === "master") rig.master = v; else rig.groupLevel[c.id] = v; saveRig(); if (view === "show") renderFaders(); }
    if (view === "show") renderPalette();
    if (RM) RM.state(remoteState());
  }
  async function renderRemote() {
    var el = $("#lxRemote"); if (!el) return;
    if (!RM) { el.innerHTML = '<p class="muted">The phone remote works in the Central Usage app.</p>'; return; }
    var st = await RM.status(); remoteOn = st.enabled;
    el.innerHTML = '<label class="toggle"><input type="checkbox" id="lxRmOn"' + (st.enabled ? " checked" : "") + '> Allow a phone on this Wi-Fi to run the lights</label><div class="row"><label>Port <input id="lxRmPort" type="number" min="1024" max="65535" value="' + st.port + '" style="width:90px"></label><span>Code <b class="lx-pin">' + esc(st.pin) + '</b></span><button id="lxRmPin">New code</button></div>' +
      (st.enabled ? '<p class="muted">On the phone, open ' + st.urls.map(function (u) { return "<b>" + esc(u) + "</b>"; }).join(" or ") + " and enter the code. Looks, Follow, Flash, Blackout and the faders.</p>" : "");
  }
  if (RM) {
    RM.onCommand(remoteCommand);
    RM.status().then(function (st) { remoteOn = st.enabled; });
    setInterval(function () { if (remoteOn) RM.state(remoteState()); }, 500);
    document.addEventListener("change", async function (e) {
      if (e.target.id === "lxRmOn" || e.target.id === "lxRmPort") { await RM.config({ enabled: $("#lxRmOn").checked, port: Number($("#lxRmPort").value) || 8091 }); renderRemote(); }
    });
    document.addEventListener("click", async function (e) { if (e.target.id === "lxRmPin") { await RM.config({ newPin: true, enabled: remoteOn }); renderRemote(); } });
  }

  wire(); showSub(view);
  if (DMX && rig.output.mode !== "off") DMX.configure(Object.assign({ universe: 1 }, rig.output));
  window.CULights = { posNow: posNow, profileOf: profileOf, addToLibrary: addToLibrary, remoteState: remoteState, remoteCommand: remoteCommand, POSITIONS: POSITIONS, onMessage: onMessage, render: render, renderAll: renderAll, show: function () { return show; }, rig: function () { return rig; }, song: song, live: live, autoCues: autoCues, timeOf: timeOf, barBeatAt: barBeatAt, lookById: lookById, goLook: goLook, profiles: PROFILES, write: write, stateFor: stateFor, saveShow: saveShow, showSub: showSub, selectCue: function (c) { selectedCue = c; renderShowPanel(); } };
})();
