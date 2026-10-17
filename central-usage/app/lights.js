/* Central Usage - Lighting: a Lightkey-style controller that follows the Central Control.
 *
 *  Show      the song's timeline: waveform (from the Central Control's tracks), the sections in their
 *            colours, the hits as lines, and the cues. Three modes per song:
 *              Auto       the sections and the hits (MIDI hits from the pedal) + the music (the streamed audio)
 *              Semi-auto  the same, plus your own cues on top
 *              Manual     only your cues (program them on the waveform, the hit lines show where to land)
 *            Tell it the show in plain words (lights-ai.js), record what you press while the song plays and
 *            record over any part again, change every light's colour in the list under the stage plot.
 *  Songs     every song on the Central Control (with or without tracks) plus your own songs; any number of
 *            scenes per song, set to the bar and beat - programmed at one tempo, they follow any other.
 *  Presets   every preset's colours, levels, motion (effects, movers) and timing (speed, fade).
 *  Fixtures  the rig: profile, universe, DMX address, group, place on the stage plot.
 *  Output    DMX per universe (USB-DMX, Art-Net, sACN), MIDI out, the click, the lights and the music,
 *            timecode, the phone remote.
 * Everything is computed here ~40 times a second and the universes go to the main process (dmx.js). */
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
  var SEC_COLORS = { intro: "#6f8cff", verse: "#3fcf8e", prechorus: "#e7c53c", chorus: "#ff6b4a", bridge: "#a57bff", tag: "#ff5fa8", instrumental: "#33c4e0", breakdown: "#7b8a9c", outro: "#4f6bd1", other: "#5a7896" };
  function secType(name) { return window.CULightsAI ? window.CULightsAI.typeOfSection(name) : "other"; }

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
  var POSITIONS = [["Home", 0.5, 0.5], ["Audience", 0.5, 0.78], ["Stage", 0.5, 0.25], ["Ceiling", 0.5, 0.02], ["Cross L", 0.36, 0.62], ["Cross R", 0.64, 0.62], ["Fan out", 0.5, 0.55, 0.5], ["Floor", 0.5, 0.97]];
  function libEntry(id) { return (rig.library || []).filter(function (x) { return x.id === id; })[0] || null; }
  function profileFor(id) { if (PROFILES[id]) return PROFILES[id]; var e = libEntry(id); return e ? { name: e.name, ch: e.ch, mover: e.mover } : null; }
  function profileOf(f) { if (/^lib:/.test(f.profile || "")) return profileFor(f.profile) || PROFILES.dimmer; return f.profile === "custom" ? { name: "Custom", ch: f.channels || ["dim"], mover: (f.channels || []).indexOf("pan") >= 0 } : PROFILES[f.profile] || PROFILES.dimmer; }

  // ------------------------------------------------------------- presets (looks)
  function G(dim, color, o) { return Object.assign({ dim: dim, color: color || "#ffffff", w: 0, a: 0, uv: 0, strobe: 0, fx: "none", speed: 1, size: 0.6, pan: 0.5, tilt: 0.5 }, o || {}); }
  var WARM = "#ffb36b", BLUE = "#1f4dff", DEEP = "#0a1fb0", PURPLE = "#7a2bff", RED = "#ff2a10", AMBER = "#ff8a00", WHITE = "#ffffff";
  function BUILTIN() {
    return [
      { id: "blackout", name: "Blackout", swatch: "#000000", g: {} },
      { id: "walkin", name: "Walk-in", swatch: "#2b3cff", fade: 4, g: { house: G(0.7, WARM), back: G(0.45, DEEP, { fx: "breathe", speed: 4, size: 0.3 }), beam: G(0.25, BLUE, { fx: "sweep", speed: 8, size: 0.4 }) } },
      { id: "worship", name: "Worship blue", swatch: BLUE, fade: 2, g: { front: G(0.55, WARM), back: G(0.85, BLUE), beam: G(0.5, BLUE, { fx: "sweep", speed: 8, size: 0.35 }), house: G(0.08, WARM), haze: G(0.25) } },
      { id: "verse", name: "Warm verse", swatch: AMBER, fade: 2, g: { front: G(0.7, WARM), back: G(0.5, AMBER, { a: 0.5 }), house: G(0.05, WARM), haze: G(0.2) } },
      { id: "build", name: "Build", swatch: RED, fade: 1, g: { front: G(0.7, WARM), back: G(0.9, RED, { fx: "pulse", speed: 1, size: 0.5 }), beam: G(0.8, WHITE, { fx: "chase", speed: 0.5, size: 0.8 }), haze: G(0.35) } },
      { id: "chorus", name: "Chorus (full)", swatch: "#a238ff", fade: 0.5, g: { front: G(0.95, WARM, { w: 0.3 }), back: G(1, PURPLE), beam: G(1, WHITE, { w: 1, fx: "sweep", speed: 4, size: 0.7 }), fx: G(0, WHITE), haze: G(0.4) } },
      { id: "bridge", name: "Bridge", swatch: PURPLE, fade: 2, g: { front: G(0.6, WARM), back: G(0.9, PURPLE, { fx: "breathe", speed: 2, size: 0.4 }), beam: G(0.6, PURPLE, { fx: "alternate", speed: 2, size: 0.7 }), haze: G(0.3) } },
      { id: "breakdown", name: "Breakdown", swatch: DEEP, fade: 2, g: { front: G(0.4, WARM), back: G(0.3, DEEP), haze: G(0.2) } },
      { id: "prayer", name: "Prayer / response", swatch: "#5a6bff", fade: 4, g: { front: G(0.35, WARM), back: G(0.25, BLUE), house: G(0.2, WARM) } },
      { id: "ending", name: "Ending", swatch: "#3355ff", fade: 4, g: { front: G(0.5, WARM), back: G(0.45, BLUE, { fx: "breathe", speed: 4, size: 0.5 }) } },
      { id: "celebrate", name: "Celebrate", swatch: "#ff3ea5", fade: 1, g: { front: G(0.9, WARM), back: G(1, WHITE, { fx: "rainbow", speed: 4, size: 1 }), beam: G(1, WHITE, { fx: "rainbow", speed: 2, size: 1, w: 0 }), fx: G(0.4, WHITE, { fx: "flash", speed: 1, size: 1 }) } },
      { id: "hit", name: "Hit (white flash)", swatch: "#ffffff", flash: true, g: { front: G(1, WHITE, { w: 1 }), back: G(1, WHITE, { w: 1 }), beam: G(1, WHITE, { w: 1 }), fx: G(1, WHITE, { w: 1 }), house: G(0.6, WHITE) } },
      { id: "strobehit", name: "Strobe hit", swatch: "#e8f4ff", flash: true, g: { fx: G(1, WHITE, { w: 1, strobe: 0.8 }), beam: G(1, WHITE, { w: 1, strobe: 0.8 }), back: G(1, WHITE, { strobe: 0.6 }) } }
    ].map(function (l) { l.builtIn = true; return l; });
  }

  // ------------------------------------------------------------- the rig - kept on this computer
  function defaultRig() {
    var f = [], add = function (name, profile, group, addr, x, y) { f.push({ id: uid(), name: name, profile: profile, group: group, universe: 1, address: addr, x: x, y: y }); };
    add("Front L", "rgbwd5", "front", 1, 0.3, 0.86); add("Front R", "rgbwd5", "front", 6, 0.7, 0.86);
    for (var i = 0; i < 4; i++) add("Back " + (i + 1), "rgbwd5", "back", 11 + i * 5, 0.2 + i * 0.2, 0.18);
    add("Mover L", "mhmini9", "beam", 31, 0.3, 0.32); add("Mover R", "mhmini9", "beam", 40, 0.7, 0.32);
    add("Blinder", "blinder2", "fx", 49, 0.5, 0.06); add("House", "dimmer", "house", 51, 0.5, 0.97); add("Hazer", "hazer2", "haze", 52, 0.08, 0.1);
    return { fixtures: f, looks: BUILTIN(), outputs: [{ universe: 1, mode: "off", path: "", host: "", offset: 0 }], master: 1, groupLevel: {}, stopped: "walkin", snap: "beat" };
  }
  var rig = store.get("rig", null) || defaultRig();
  if (!rig.looks || !rig.looks.length) rig.looks = BUILTIN();
  BUILTIN().forEach(function (b) { if (!rig.looks.some(function (l) { return l.id === b.id; })) rig.looks.push(b); else { var mine = rig.looks.filter(function (l) { return l.id === b.id; })[0]; if (mine.builtIn && mine.fade == null) mine.fade = b.fade; } });
  if (!Array.isArray(rig.outputs)) rig.outputs = [Object.assign({ universe: 1, mode: "off", path: "", host: "", offset: 0 }, rig.output || {}, { universe: 1 })];   // one output (1.x) -> one per universe
  delete rig.output;
  rig.click = Object.assign({ hear: true, follow: true, output: false, device: "", level: 0.6, accent: true }, rig.click || {});
  rig.audio = Object.assign({ react: true, amount: 0.45, onsets: true }, rig.audio || {});
  rig.localSongs = rig.localSongs || [];
  rig.defaultMode = rig.defaultMode || "semi";
  rig.groupLevel = rig.groupLevel || {};
  function saveRig() { store.set("rig", rig); }
  function lookById(id) { return rig.looks.filter(function (l) { return l.id === id; })[0] || rig.looks[0]; }

  // ------------------------------------------------------------- song position (follows the Central Control, or the preview here)
  var song = { id: null, name: "", pos: 0, at: 0, playing: false, speed: 1, bpm: 120, bpb: 4, bars: [], barBeats: [], hits: [], sections: [], duration: 0, overview: [], hasTracks: false, local: false };
  var preview = null;   // { ctx, sources, startAt, offset, click } when "Preview here" plays
  function posNow() {
    if (preview) return preview.offset + (preview.ctx.currentTime - preview.startAt);
    return song.playing ? song.pos + (performance.now() - song.at) / 1000 * (song.speed || 1) : song.pos;
  }
  function playingNow() { return !!preview || song.playing; }
  function barLen(i) { var b = song.bars; if (!b.length) return 60 / song.bpm * song.bpb; if (i + 1 < b.length) return b[i + 1] - b[i]; return i > 0 ? b[i] - b[i - 1] : 60 / song.bpm * song.bpb; }
  function beatsIn(i) { return song.barBeats[i] || song.bpb || 4; }
  function timeOf(bar, beat) { var i = clamp(Math.round(bar) - 1, 0, 1e6), b = song.bars; if (!b.length) return (bar - 1) * 60 / song.bpm * song.bpb + (beat - 1) * 60 / song.bpm; var base = i < b.length ? b[i] : b[b.length - 1] + (i - b.length + 1) * barLen(b.length - 1); return base + (beat - 1) * barLen(Math.min(i, b.length - 1)) / beatsIn(i); }
  function barBeatAt(t) {
    var b = song.bars; if (!b.length) { var bl = 60 / song.bpm; var beatsTot = t / bl; return { bar: Math.floor(beatsTot / song.bpb) + 1, beat: beatsTot % song.bpb + 1 }; }
    var lo = 0, hi = b.length - 1; if (t < b[0]) return { bar: 1, beat: 1 + (t - b[0]) / (barLen(0) / beatsIn(0)) };
    while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (b[mid] <= t) lo = mid; else hi = mid - 1; }
    return { bar: lo + 1, beat: 1 + (t - b[lo]) / (barLen(lo) / beatsIn(lo)) };
  }
  function beatsAt(t) {
    if (!song.bars.length) return t / (60 / song.bpm);
    var bb = barBeatAt(t), n = 0; for (var i = 0; i < bb.bar - 1 && i < song.barBeats.length; i++) n += beatsIn(i); if (bb.bar - 1 > song.barBeats.length) n += (bb.bar - 1 - song.barBeats.length) * song.bpb; return n + bb.beat - 1;
  }
  var freeBeat = { at: performance.now(), beats: 0 };
  function beatClock() { var now = performance.now(); if (playingNow()) { var b = beatsAt(posNow()); freeBeat = { at: now, beats: b }; return b; } return freeBeat.beats + (now - freeBeat.at) / 1000 * (song.bpm || 100) / 60; }

  // ------------------------------------------------------------- the show of the current song (cues kept on the Central Control, per song)
  // show.cues are YOUR cues; the automatic ones (sections + hits) are made live in Auto and Semi-auto.
  var show = { song: null, cues: [], mode: rig.defaultMode, bpm: null, saved: true, loading: false, by: "" }, saveTimer = 0, effective = null;
  var SECTION_RULES = [[/^intro|^walk|^instrumental/i, "worship"], [/^verse/i, "verse"], [/^pre/i, "build"], [/^chorus|^refrain|^hook/i, "chorus"], [/^bridge/i, "bridge"], [/^break|^down|^interlude/i, "breakdown"], [/^tag|^vamp/i, "chorus"], [/^outro|^end|^coda/i, "ending"], [/^build/i, "build"], [/^turn/i, "worship"]];
  function lookForSection(name) { for (var i = 0; i < SECTION_RULES.length; i++) if (SECTION_RULES[i][0].test(name || "")) return SECTION_RULES[i][1]; return "worship"; }
  function autoCues() {
    var cues = [], secs = song.sections || [];
    secs.forEach(function (s) {
      var bb = s.bar ? { bar: s.bar, beat: 1 } : barBeatAt(s.start), lk = lookForSection(s.name), l = lookById(lk);
      cues.push({ id: "auto-" + s.start, bar: Math.round(bb.bar), beat: 1, look: lk, fade: l.fade != null ? l.fade : 2, kind: "look", auto: true, label: s.name });
    });
    if (secs.length) {
      var last = secs[secs.length - 1], end = barBeatAt(Math.max(0, (last.end || song.duration) - 0.01));
      cues.push({ id: "auto-end", bar: end.bar + 1, beat: 1, look: "blackout", fade: 4, kind: "look", auto: true, label: "End" });
    } else cues.push({ id: "auto-start", bar: 1, beat: 1, look: "worship", fade: 2, kind: "look", auto: true, label: "Start" });
    (song.hits || []).forEach(function (h, k) {
      var bb = barBeatAt(h), beat = Math.round((bb.beat) * 2) / 2;
      if (secs.some(function (s) { return Math.abs(s.start - h) < 60 / song.bpm * 0.75; })) return;
      cues.push({ id: "auto-hit-" + k, bar: bb.bar, beat: beat >= beatsIn(bb.bar - 1) + 1 ? 1 : beat, look: "hit", fade: 0, kind: "flash", dur: 0.5, auto: true, label: "Hit" });
    });
    return sortCues(cues);
  }
  function cueTime(c) { return timeOf(c.bar, c.beat || 1); }
  function sortCues(list) { return list.sort(function (a, b) { return a.bar - b.bar || (a.beat || 1) - (b.beat || 1); }); }
  function cuesNow() {   // what runs: Auto = automatic, Semi = automatic + yours, Manual = yours
    if (effective) return effective;
    var m = show.mode, list = m === "manual" ? show.cues.slice() : m === "auto" ? autoCues() : autoCues().concat(show.cues);
    effective = sortCues(list); return effective;
  }
  function dirty() { effective = null; }
  async function loadShow(songId) {
    show = { song: songId, cues: [], mode: rig.defaultMode, bpm: null, saved: true, loading: true, by: "" }; dirty(); renderShowPanel();
    var saved = null;
    try { var r = await fetch(CU.api("/lighting?song=" + encodeURIComponent(songId)), { cache: "no-store" }); if (r.ok) saved = await r.json(); } catch (_) { }
    if (show.song !== songId) return;
    show.loading = false;
    if (saved && Array.isArray(saved.cues)) {
      if (saved.mode) { show.mode = saved.mode; show.cues = saved.cues.filter(function (c) { return !c.auto; }); }
      else if (saved.auto) { show.mode = "auto"; show.cues = []; }             // 1.x: an automatic show was saved
      else { show.mode = saved.cues.length ? "manual" : rig.defaultMode; show.cues = saved.cues; }
      show.bpm = saved.bpm || null; show.by = saved.by || "";
      (saved.looks || []).forEach(function (l) { if (l && l.id && !rig.looks.some(function (x) { return x.id === l.id; })) rig.looks.push(l); });   // presets the chat box made travel with the show
      sortCues(show.cues);
    }
    dirty(); renderShowPanel(); renderSongsSoon();
  }
  function changed() {
    show.saved = false; dirty(); renderShowPanel();
    clearTimeout(saveTimer); saveTimer = setTimeout(saveShow, 900);
  }
  async function saveShow() {
    if (!show.song) return;
    var code = CU.prefs.code;
    if (!code) { $("#lxSaveState").textContent = "not saved - enter the pairing code (Code) to keep cues on the Central Control"; return; }
    var used = {}; show.cues.forEach(function (c) { if (c.look) used[c.look] = true; });
    var looks = rig.looks.filter(function (l) { return used[l.id] && !l.builtIn; });
    try {
      var r = await fetch(CU.api("/lighting"), { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ song: show.song, code: code, by: "Central Usage-" + selfId, show: { cues: show.cues, mode: show.mode, bpm: show.bpm || song.bpm, song: song.name, looks: looks } }) });
      var j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || r.status);
      show.saved = true; show.updated = j.updated;
    } catch (e) { $("#lxSaveState").textContent = "could not save: " + e.message; return; }
    renderShowPanel();
  }
  var selfId = uid();

  // ------------------------------------------------------------- the hub: the Central Control's songs (waveform, sections, hits, tempo)
  var hub = { list: [], detail: {}, loading: {} };
  async function hubList() { try { var r = await fetch(CU.api("/hub"), { cache: "no-store" }); if (r.ok) { hub.list = (await r.json()).songs || []; renderSongsSoon(); } } catch (_) { } }
  async function hubSong(id, force) {
    if (!id) return null; if (hub.detail[id] && !force) return hub.detail[id]; if (hub.loading[id]) return hub.loading[id];
    hub.loading[id] = fetch(CU.api("/hub/" + encodeURIComponent(id)), { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (j) { delete hub.loading[id]; if (j) hub.detail[id] = j; return j; });
    return hub.loading[id];
  }
  function applyHub(h) {   // fill in what the live display didn't bring (no tracks playing, a song being programmed)
    if (!h || h.id !== song.id) return;
    song.overview = h.overview || [];
    if (!song.bars.length && h.grid) { song.bars = h.grid.bars || []; song.barBeats = h.grid.barBeats || []; song.bpm = h.grid.bpm || song.bpm; }
    if (!song.hits.length && h.hits) song.hits = h.hits;
    if (!song.duration && h.duration) song.duration = h.duration;
    if (!song.sections.length && h.sections) song.sections = h.sections.map(function (s) { return { name: s.name, start: s.start, end: s.end, bar: s.bar, color: s.color, type: s.type }; });
    else song.sections.forEach(function (s) { var m = (h.sections || []).filter(function (x) { return x.name === s.name && Math.abs(x.start - s.start) < 0.5; })[0]; if (m) { s.color = m.color; s.type = m.type; } });
    song.hasTracks = !!h.hasTracks; dirty();
  }

  // ------------------------------------------------------------- engine: preset -> each fixture -> DMX
  var live = { manual: null, manualFrom: null, manualAt: 0, manualFade: 0.6, flash: null, blackout: false, hold: false, lastFrame: null, fixtureColor: {}, over: {}, audio: { level: 0, peak: 0.05, onsets: null } };
  function hexRgb(h) { h = String(h || "#000").replace("#", ""); if (h.length === 3) h = h.split("").map(function (c) { return c + c; }).join(""); var n = parseInt(h, 16) || 0; return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }
  function rgbHex(r, g, b) { return "#" + [r, g, b].map(function (v) { return ("0" + Math.round(clamp(v, 0, 1) * 255).toString(16)).slice(-2); }).join(""); }
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
      case "alternate": if (g.color2) { if ((Math.floor(ph) + idx) % 2) rgb = hexRgb(g.color2); } else dim *= (Math.floor(ph) % 2) === (idx % 2) ? 1 : 1 - size; break;   // two colours: they swap on the beat
      case "breathe": dim *= (1 - size) + size * (0.5 - 0.5 * Math.cos(2 * Math.PI * (beats / (speed * 4)))); break;
      case "rainbow": rgb = hsv(((beats / (speed * 4)) + idx / Math.max(1, n)) % 1, size, 1); break;
      case "flash": dim *= frac < 0.12 ? 1 : 1 - size; break;
      case "flicker": var k = f.id, fs = flickerState[k] || (flickerState[k] = 1); fs += (0.75 + Math.random() * 0.25 - fs) * 0.25; flickerState[k] = fs; dim *= 1 - size + size * fs; break;
    }
    var pan = g.pan == null ? 0.5 : g.pan, tilt = g.tilt == null ? 0.5 : g.tilt;
    var spread = n > 1 ? (idx / (n - 1) - 0.5) : 0; pan = clamp(pan + spread * (g.fan || 0), 0, 1);
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
  function overState(st, o) {   // a light's own colour / level (the list under the stage plot, or a recorded light cue)
    var s = Object.assign({}, st);
    if (o.color) { var c = hexRgb(o.color); s.r = c[0]; s.g = c[1]; s.b = c[2]; s.w = /^#?f{6}$/i.test(String(o.color).replace("#", "")) ? 1 : 0; s.a = 0; s.uv = 0; }
    if (o.dim != null) s.dim = clamp(o.dim, 0, 1); else if (s.dim === 0 && o.color) s.dim = 0.8;
    if (o.strobe != null) s.strobe = o.strobe;
    return s;
  }
  function activeLooks(t) {
    var cues = cuesNow().filter(function (c) { return c.kind === "look" || c.kind == null; }), cur = -1;
    for (var i = 0; i < cues.length; i++) if (cueTime(cues[i]) <= t + 1e-4) cur = i;
    if (cur < 0) return { from: lookById(rig.stopped || "walkin"), to: lookById(rig.stopped || "walkin"), p: 1 };
    var c = cues[cur], prev = cur > 0 ? lookById(cues[cur - 1].look) : lookById(rig.stopped || "walkin"), beatLen = 60 / (song.bpm || 100), fade = (c.fade || 0) * beatLen;
    return { from: prev, to: lookById(c.look), p: fade > 0 ? clamp((t - cueTime(c)) / fade, 0, 1) : 1, cue: c };
  }
  function activeFlash(t) {
    var beatLen = 60 / (song.bpm || 100), cues = cuesNow();
    for (var i = cues.length - 1; i >= 0; i--) { var c = cues[i]; if (c.kind !== "flash") continue; var at = cueTime(c), d = (c.dur || 0.5) * beatLen; if (t >= at && t < at + d) return { look: lookById(c.look), p: 1 - (t - at) / d }; }
    return null;
  }
  function cueOverrides(t) {   // light cues: they hold until the next preset cue
    var out = {}, cues = cuesNow(), beatLen = 60 / (song.bpm || 100);
    for (var i = 0; i < cues.length; i++) {
      var c = cues[i], at = cueTime(c); if (at > t + 1e-4) break;
      if (c.kind === "look" || c.kind == null) { if (!c.keepLights) out = {}; }
      else if (c.kind === "fixture" && c.fixtures) Object.keys(c.fixtures).forEach(function (id) { out[id] = Object.assign({ p: (c.fade || 0) > 0 ? clamp((t - at) / ((c.fade || 0) * beatLen), 0, 1) : 1 }, c.fixtures[id]); });
    }
    return out;
  }
  // the music: the 3 bands and the onsets of the Central Control's audio (from the audio host's engine)
  function audioLevel() {
    var X = window.CUMix, m = X && X.meters; if (!m || !m.bands || !rig.audio.react || show.mode === "manual") return null;
    var e = m.bands[0] * 0.6 + m.bands[1] * 0.4, a = live.audio;
    a.peak = Math.max(e, a.peak * 0.9995, 0.02); a.level = clamp(e / a.peak, 0, 1);
    if (rig.audio.onsets && playingNow() && !(song.hits && song.hits.length) && a.onsets != null && m.onsets > a.onsets) live.flash = { look: "hit", until: performance.now() + 140, len: 140 };
    a.onsets = m.onsets;
    return a.level;
  }
  function render() {
    var t = posNow(), beats = beatClock(), groups = {}, now = performance.now(), playing = playingNow();
    rig.fixtures.forEach(function (f) { (groups[f.group] = groups[f.group] || []).push(f); });
    var base;
    if (live.manual) { var mp = clamp((now - live.manualAt) / 1000 / live.manualFade, 0, 1); base = { from: live.manualFrom || live.manual, to: live.manual, p: mp }; }
    else if (playing || live.hold) base = activeLooks(t);
    else base = { from: lookById(rig.stopped || "walkin"), to: lookById(rig.stopped || "walkin"), p: 1 };
    var fl = playing && !live.manual ? activeFlash(t) : null;
    if (live.flash && now < live.flash.until) fl = { look: lookById(live.flash.look), p: (live.flash.until - now) / live.flash.len };
    var cueOver = playing && !live.manual ? cueOverrides(t) : {}, lvl = playing ? audioLevel() : null, amt = rig.audio.amount;
    var unis = {}, colors = {};
    rig.fixtures.forEach(function (f) {
      var list = groups[f.group], idx = list.indexOf(f), n = list.length;
      var st = base.p >= 1 ? stateFor(base.to, f, idx, n, beats) : mix(stateFor(base.from, f, idx, n, beats), stateFor(base.to, f, idx, n, beats), base.p);
      if (cueOver[f.id]) st = mix(st, overState(st, cueOver[f.id]), cueOver[f.id].p);
      if (live.over[f.id]) st = overState(st, live.over[f.id]);
      if (lvl != null && f.group !== "house" && f.group !== "haze") st.dim *= (1 - amt) + amt * (0.35 + 0.65 * lvl);
      if (fl && fl.look.g[f.group]) { var fs = stateFor(fl.look, f, idx, n, beats); st = mix(st, fs, clamp(fl.p * 1.5, 0, 1)); }
      var gl = rig.groupLevel[f.group] == null ? 1 : rig.groupLevel[f.group], m = live.blackout ? 0 : (rig.master == null ? 1 : rig.master) * gl;
      st.dim *= m; st.haze *= live.blackout ? 0 : gl;
      if (live.identify && now < live.identify.until) { var on = f.id === live.identify.id && Math.floor(now / 250) % 2 === 0; st = { dim: on ? 1 : 0, r: 1, g: 1, b: 1, w: 1, a: 0, uv: 0, strobe: 0, pan: 0.5, tilt: 0.5, haze: 0 }; }
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
  function outputsOn() { return rig.outputs.some(function (o) { return o.mode !== "off"; }); }
  function tick() {
    var unis = render(), now = performance.now();
    rig.outputs.forEach(function (o) { if (!unis[String(o.universe)]) unis[String(o.universe)] = new Uint8Array(512); });   // a universe with an output but no fixtures still goes out (dark)
    var key = Object.keys(unis).map(function (u) { return u + ":" + Array.prototype.join.call(unis[u], ","); }).join("|");
    if (DMX && outputsOn() && (key !== lastSent || now - lastSentAt > 1000)) { var plain = {}; Object.keys(unis).forEach(function (u) { plain[u] = Array.from(unis[u]); }); DMX.frame(plain); lastSent = key; lastSentAt = now; }
    clickTick();
    if (visible()) drawLive();
  }
  setInterval(tick, 25);

  // ------------------------------------------------------------- from the Central Control
  function setSong(sid, name, secs, local) {
    song.id = sid; song.name = name || ""; song.sections = secs || []; song.secKey = JSON.stringify(song.sections.map(function (s) { return [s.name, s.start]; })); song.local = !!local; song.overview = []; dirty();
    if (sid) { loadShow(sid); if (!local || hub.list.some(function (x) { return x.id === sid; })) hubSong(sid).then(function (h) { if (h) { applyHub(h); renderShowPanel(); } }); }
    else { show = { song: null, cues: [], mode: rig.defaultMode, saved: true }; renderShowPanel(); }
  }
  function onMessage(m) {
    if (m.type === "display") {
      var d = m, sid = d.songId || (d.song ? d.song.name : null);
      if (preview && (d.playing || sid !== song.id) && !song.local) stopPreview();   // the Central Control takes over
      if (song.local && sid && d.playing) { stopPreview(); song.local = false; song.id = null; }   // it plays: back to its song
      if (song.local) return;
      if (localRun && !d.playing && sid === song.id) return;   // the click here runs the timeline
      if (localRun && d.playing) { localRun = false; toggleFreeClick(false); }
      song.pos = d.pos || 0; song.at = performance.now(); song.playing = !!d.playing || (!d.song || !d.song.hasTracks ? clockRun.running : false); song.speed = d.speed || 1;
      song.bpm = d.bpm || song.bpm; song.bpb = d.bpb || 4; song.duration = d.duration || song.duration || 0; song.name = d.song ? d.song.name : "";
      if (d.grid) { song.bars = d.grid.bars || []; song.barBeats = d.grid.barBeats || []; song.bpm = d.grid.bpm || song.bpm; dirty(); }
      if (d.hits) { song.hits = d.hits; dirty(); }
      if (d.song && !d.song.hasTracks && clockRun.running) { song.pos = clockRun.pos(); song.at = performance.now(); song.playing = true; song.speed = 1; }
      var secs = (d.sections || []).map(function (s) { return { name: s.name, start: s.start, end: s.end, bar: s.bar, color: s.color, type: s.type }; }), sk = JSON.stringify(secs.map(function (s) { return [s.name, s.start]; }));
      if (sid !== song.id) { if (!d.grid) { song.bars = []; song.barBeats = []; song.hits = []; } song.duration = d.duration || 0; setSong(sid, song.name, secs, false); }
      else if (sk !== song.secKey) { song.sections = secs; song.secKey = sk; dirty(); renderShowPanel(); }
    } else if (m.type === "lighting" && m.song === show.song && m.by !== "Central Usage-" + selfId) {
      if (show.saved) loadShow(show.song);
    } else if (m.type === "hub") {
      hubList(); (m.changed || []).forEach(function (id) { delete hub.detail[id]; if (id === song.id) hubSong(id, true).then(function (h) { applyHub(h); renderShowPanel(); }); });
    } else if (m.type === "clock") {
      clockRun.onClock(m);
    } else if (m.type === "midi") {
      // the pedal's MIDI hits (note < 60 on channel 1): in Auto / Semi-auto they flash when the song has no detected hits of its own
      if (show.mode === "manual" || (song.hits && song.hits.length)) return;
      var base = CU.piToLocal(m.t) + (CU.prefs.offsetMs || 0);
      (m.messages || []).forEach(function (msg) { var d0 = msg.data || []; if ((d0[0] & 0xF0) === 0x90 && d0[2] > 0 && (d0[0] & 0x0F) === 0 && d0[1] < 60) setTimeout(function () { live.flash = { look: "hit", until: performance.now() + 220, len: 220 }; recordFlash("hit"); }, Math.max(0, base + (msg.at || 0) - performance.now())); });
    }
  }
  // songs without tracks: the Central Control's clock (its tempo, start / stop) runs the timeline
  var clockRun = { running: false, startedAt: 0, bpm: 0, pos: function () { return this.running ? (performance.now() - this.startedAt) / 1000 : 0; },
    onClock: function (c) { var was = this.running; this.running = !!c.running; if (c.bpm) this.bpm = c.bpm; if (this.running && !was) this.startedAt = CU.piToLocal(c.t || 0) || performance.now(); if (!song.hasTracks && !song.local && song.id) { song.playing = this.running; song.pos = this.pos(); song.at = performance.now(); if (c.bpm && !song.bars.length) song.bpm = c.bpm; } } };

  // ------------------------------------------------------------- the click: hear it while programming, lights follow it, an audio output
  var click = { ctx: null, next: -1, running: false, start: 0, bpm: 120, outCtx: null };
  function clickCtx() {
    if (!click.ctx) { click.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: "interactive" }); }
    if (rig.click.output && rig.click.device && click.ctx.setSinkId && click.sink !== rig.click.device) { click.sink = rig.click.device; click.ctx.setSinkId(rig.click.device).catch(function () { }); }
    if (!rig.click.output && click.sink && click.ctx.setSinkId) { click.sink = ""; click.ctx.setSinkId("").catch(function () { }); }
    if (click.ctx.state !== "running") click.ctx.resume();
    return click.ctx;
  }
  function beep(at, accent) {
    var c = clickCtx(), o = c.createOscillator(), g = c.createGain(); o.frequency.value = accent ? 1760 : 1175; o.type = "sine";
    g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(rig.click.level * (accent ? 1 : 0.7), at + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
    o.connect(g).connect(c.destination); o.start(at); o.stop(at + 0.06);
  }
  function clickWanted() { return (preview && rig.click.hear) || click.running || (rig.click.output && song.playing && !preview); }
  function clickTick() {   // schedule the next beats a little ahead on the audio clock
    if (!clickWanted()) { click.next = -1; return; }
    var c = clickCtx(), ahead = 0.15, t = posNow(), bpm = song.bpm || 100;
    if (click.running && !playingNow()) { var el = c.currentTime - click.start, beatLen = 60 / bpm, nb = Math.ceil(el / beatLen - 1e-6); if (click.next < nb) click.next = nb; while (click.next * beatLen < el + ahead) { beep(click.start + click.next * beatLen, click.next % song.bpb === 0); click.next++; } freeBeat = { at: performance.now(), beats: el / beatLen }; return; }
    var beats = beatsAt(t), nbeat = Math.ceil(beats - 1e-6); if (click.next < 0 || click.next > nbeat + 4 || click.next < nbeat - 2) click.next = nbeat;
    var secPerBeat = 60 / bpm / (song.speed || 1);
    while (click.next <= beats + ahead / secPerBeat) { var dt = (click.next - beats) * secPerBeat; if (dt >= -0.01) { var bb = Math.round(click.next); beep(c.currentTime + Math.max(0, dt), rig.click.accent && bb % (song.bpb || 4) === 0); } click.next++; }
  }
  function toggleFreeClick(on) {   // a click at the song's tempo while nothing plays (program a song without tracks); the lights' effects follow it
    click.running = on == null ? !click.running : !!on;
    if (click.running) { var c = clickCtx(); click.start = c.currentTime + 0.05; click.next = 0; if (rig.click.follow) freeBeat = { at: performance.now(), beats: 0 }; }
    renderShowPanel();
  }

  // ------------------------------------------------------------- "Preview here": the song plays on this computer (to program along), not on the Central Control
  async function startPreview(from) {
    stopPreview();
    var sid = song.id; if (!sid) return;
    var h = await hubSong(sid), c = clickCtx(), files = (h && h.stems || []).filter(function (s) { return s.file && !s.mute && s.bus !== "click"; }), code = CU.prefs.code;
    if (files.length && !code) { CU.askCode(); return; }
    var offset = Math.max(0, from != null ? from : song.pos || 0);
    if (files.length) setNow("Loading the song to preview…");
    var buffers = await Promise.all(files.map(function (s) { return fetch(CU.api("/hub-file?code=" + encodeURIComponent(code) + "&path=" + encodeURIComponent(s.file))).then(function (r) { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }).then(function (ab) { return c.decodeAudioData(ab); }).then(function (buf) { return { buf: buf, gain: s.gain == null ? 1 : s.gain, pan: s.pan || 0 }; }).catch(function () { return null; }); }));
    buffers = buffers.filter(Boolean);
    if (song.id !== sid) return;
    if (!buffers.length && files.length) setNow("Could not load the tracks from the Central Control - the click runs instead.");
    var p = { ctx: c, sources: [], startAt: c.currentTime + 0.1, offset: offset };
    buffers.forEach(function (b) { var src = c.createBufferSource(), g = c.createGain(), pn = c.createStereoPanner ? c.createStereoPanner() : null; src.buffer = b.buf; g.gain.value = b.gain * 0.8; src.connect(g); if (pn) { pn.pan.value = b.pan; g.connect(pn); pn.connect(c.destination); } else g.connect(c.destination); src.start(p.startAt, offset); p.sources.push(src); });
    if (!song.duration && buffers.length) song.duration = Math.max.apply(null, buffers.map(function (b) { return b.buf.duration; }));
    if (!song.duration) song.duration = 240;
    preview = p; click.next = -1; renderShowPanel();
  }
  function stopPreview() { if (!preview) return; var end = posNow(); preview.sources.forEach(function (s) { try { s.stop(); } catch (_) { } }); preview = null; song.pos = end; finishRecording(); renderShowPanel(); }

  // ------------------------------------------------------------- recording what you press (record over any part again)
  var rec = null;   // { from, cues: [] } while the song plays with Record on
  function snapNow() { return snapTime(posNow() - (CU.prefs.offsetMs || 0) / 1000); }
  function recPush(cue) { if (!rec) return; var at = snapNow(); cue.id = uid(); cue.bar = at.bar; cue.beat = at.beat; cue.rec = true; rec.cues = rec.cues.filter(function (c) { return !(c.kind === cue.kind && c.bar === cue.bar && c.beat === cue.beat && cue.kind !== "fixture"); }); rec.cues.push(cue); drawTimeline(); }
  function recordLook(l) { if (rec) recPush(l.flash ? { kind: "flash", look: l.id, dur: 0.5 } : { kind: "look", look: l.id, fade: l.fade != null ? l.fade : 1 }); }
  function recordFlash(lookId) { if (rec) recPush({ kind: "flash", look: lookId || "hit", dur: 0.5 }); }
  function recordFixture(id, o) { if (!rec) return; var at = snapNow(), last = rec.cues.filter(function (c) { return c.kind === "fixture" && c.bar === at.bar && c.beat === at.beat; })[0]; if (last) { last.fixtures[id] = Object.assign({}, o); return; } var fx = {}; fx[id] = Object.assign({}, o); recPush({ kind: "fixture", fixtures: fx, fade: 0.5 }); }
  function finishRecording() {
    if (!rec) return; var r = rec; rec = null;
    var a = r.from, b = posNow(); if (b < a) { var t = a; a = b; b = t; }
    if (b - a < 0.25 && !r.cues.length) return;
    show.cues = show.cues.filter(function (c) { var tc = cueTime(c); return tc < a - 0.02 || tc > b + 0.02; }).concat(r.cues.map(function (c) { delete c.rec; return c; }));   // what was there is replaced
    sortCues(show.cues);
    if (show.mode === "auto") show.mode = "semi";
    if (r.cues.length) { live.manual = null; live.over = {}; renderPalette(); renderLights(); }   // what you pressed is now on the timeline
    lastRec = { from: a, to: b }; changed();
    setNow("Recorded " + r.cues.length + " cue" + (r.cues.length === 1 ? "" : "s") + " between " + fmtBB(a) + " and " + fmtBB(b));
  }
  var lastRec = null;
  function fmtBB(t) { var bb = barBeatAt(t); return "bar " + bb.bar + "." + Math.floor(bb.beat); }
  setInterval(function () { if (live.rec && playingNow() && !rec && show.song) rec = { from: posNow(), cues: [] }; else if (rec && (!playingNow() || !live.rec)) finishRecording(); }, 100);

  // ------------------------------------------------------------- UI
  var view = store.get("lxView", "show"), selectedCue = null, selectedLook = store.get("lxLook", "worship"), drag = null, nowText = "", nowAt = 0;
  function visible() { return CU.prefs.tab === "lights"; }
  function setNow(t) { nowText = t; nowAt = performance.now(); }
  function showSub(v) { view = v; store.set("lxView", v); $$("#lxNav [data-lx]").forEach(function (b) { b.classList.toggle("on", b.dataset.lx === v); }); $$(".lx-view").forEach(function (el) { el.hidden = el.dataset.lxv !== v; }); renderAll(); }
  function renderAll() { if (view === "show") { renderPalette(); renderShowPanel(); renderFaders(); renderLights(); } else if (view === "songs") { hubList(); renderSongs(); } else if (view === "looks") renderLooks(); else if (view === "fixtures") renderFixtures(); else if (view === "output") { renderOutput(); renderClick(); renderAudio(); renderRemote(); if (window.CUTimecode) window.CUTimecode.render(); } }

  // ---- show view: stage plot, preset palette, faders, timeline, lights list
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
    if (view === "show") {
      drawPlot(); drawTimeline(); drawLights();
      var cue = live.state && live.state.cue, txt = performance.now() - nowAt < 4000 && nowText ? nowText : live.manual ? "Live: " + live.manual.name + " (manual)" : rec ? "● Recording… (" + rec.cues.length + ")" : preview ? "▶ Preview here · " + fmtBB(posNow()) : !playingNow() ? "Stopped: " + lookById(rig.stopped || "walkin").name : cue ? "Cue: " + lookById(cue.look).name + (cue.label ? " · " + cue.label : "") : "No cue yet";
      var el = $("#lxNow"); if (el.textContent !== txt) el.textContent = txt;
    } else if (view === "output") drawMonitor();
  }
  function drawPlot() {
    var svg = $("#lxPlot"); if (!svg) return;
    var key = String(rig.fixtures.length) + JSON.stringify(rig.fixtures.map(function (f) { return [f.x, f.y, f.name]; }));
    if (svg.dataset.n !== key) {
      svg.dataset.n = key;
      svg.innerHTML = '<rect x="0" y="0" width="1000" height="560" rx="16" class="lx-stage"></rect><text x="22" y="544" class="lx-aud" style="text-anchor:start">▼ AUDIENCE</text>' + rig.fixtures.map(function (f) {
        var x = (f.x == null ? 0.5 : f.x) * 1000, y = (f.y == null ? 0.5 : f.y) * 520 + 10, mover = profileOf(f).mover;
        return '<g class="lx-fix" data-fix="' + esc(f.id) + '" transform="translate(' + x + "," + y + ')"><circle r="' + (mover ? 26 : f.group === "haze" ? 18 : 22) + '" class="lx-body"></circle><circle r="' + (mover ? 18 : 15) + '" class="lx-lens" id="lens-' + esc(f.id) + '"></circle>' + (mover ? '<line x1="0" y1="0" x2="0" y2="-34" class="lx-beam" id="beam-' + esc(f.id) + '"></line>' : "") + '<text y="' + (y > 470 ? -(mover ? 34 : 30) : (mover ? 50 : 44)) + '">' + esc(f.name) + "</text></g>";
      }).join("");
    }
    rig.fixtures.forEach(function (f) {
      var st = live.fixtureColor[f.id], el = document.getElementById("lens-" + f.id); if (!st || !el) return;
      var c = lensColor(f, st);
      el.style.fill = c.css; el.style.filter = c.k > 0.05 ? "drop-shadow(0 0 " + Math.round(4 + 14 * c.k) + "px " + c.css + ")" : "none";
      var beam = document.getElementById("beam-" + f.id); if (beam) { var ang = (st.pan - 0.5) * 300, len = 20 + st.tilt * 50; beam.setAttribute("x2", String(Math.sin(ang * Math.PI / 180) * len)); beam.setAttribute("y2", String(-Math.cos(ang * Math.PI / 180) * len)); beam.style.stroke = c.css; beam.style.opacity = String(0.2 + c.k * 0.8); }
    });
  }
  function lensColor(f, st) { var k = f.group === "haze" ? st.haze : st.dim, r = Math.round(clamp((st.r + st.w + st.a) * k, 0, 1) * 255), g = Math.round(clamp((st.g + st.w + st.a * 0.55) * k, 0, 1) * 255), b = Math.round(clamp((st.b + st.w + st.uv * 0.6) * k, 0, 1) * 255); if (f.group === "haze") { r = g = b = Math.round(160 * k); } return { css: "rgb(" + r + "," + g + "," + b + ")", k: k }; }
  // timeline: the waveform, the sections in their colours, the hits as lines, the cues
  var tl = { w: 0, h: 0 };
  function dur() { return Math.max(10, song.duration || (song.sections.length ? song.sections[song.sections.length - 1].end : 0) || 120); }
  function tlTime(px) { return clamp(px / tl.w, 0, 1) * dur(); }
  function tlX(t) { return t / dur() * tl.w; }
  var ROW = { sec: 0, look: 64, fixture: 92, flash: 112 };
  function cueY(c) { return c.kind === "flash" ? ROW.flash : c.kind === "fixture" ? ROW.fixture : ROW.look; }
  function drawTimeline() {
    var cv = $("#lxTimeline"); if (!cv) return;
    var dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight; if (!W) return;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    var ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H); tl.w = W; tl.h = H;
    var D = dur();
    // waveform (the Central Control's tracks, all of them together)
    var ov = song.overview || [], mid = 20 + (H - 20 - 26) / 2, amp = (H - 20 - 26) / 2 - 2;
    if (ov.length) { var played = tlX(posNow()); for (var i = 0; i < ov.length; i++) { var x = i / ov.length * W, w = Math.max(1, W / ov.length - 0.4), v = Math.min(1, ov[i] * 1.1) * amp; ctx.fillStyle = x < played && playingNow() ? "rgba(93,230,176,.55)" : "rgba(200,220,240,.28)"; ctx.fillRect(x, mid - v, w, Math.max(1, v * 2)); } }
    else { ctx.fillStyle = "rgba(255,255,255,.25)"; ctx.font = "12px sans-serif"; ctx.fillText(song.id ? (song.hasTracks === false ? "No tracks: the timeline runs on the Central Control's click (or the click here)" : "Waveform: comes with the Central Control's tracks") : "No song", 10, mid + 4); }
    // bars
    ctx.fillStyle = "rgba(255,255,255,.06)"; var bars = song.bars.length ? song.bars : null, nb = bars ? bars.length : Math.ceil(D / (60 / song.bpm * song.bpb));
    for (var b = 0; b < nb; b++) { var bx = tlX(bars ? bars[b] : b * 60 / song.bpm * song.bpb); ctx.fillRect(bx, 20, 1, H - 20); if (b % 4 === 0 && W / nb * 4 > 26) { ctx.fillStyle = "rgba(255,255,255,.35)"; ctx.font = "10px sans-serif"; ctx.fillText(String(b + 1), bx + 2, H - 3); ctx.fillStyle = "rgba(255,255,255,.06)"; } }
    // sections, in their colours
    song.sections.forEach(function (s) { var x = tlX(s.start), x2 = tlX(s.end || D), col = s.color || SEC_COLORS[s.type || secType(s.name)] || "#5a7896"; ctx.fillStyle = col; ctx.globalAlpha = 0.85; ctx.fillRect(x, 0, Math.max(1, x2 - x - 1), 18); ctx.globalAlpha = 0.07; ctx.fillRect(x, 18, Math.max(1, x2 - x - 1), H - 18); ctx.globalAlpha = 1; ctx.fillStyle = "#08111d"; ctx.font = "bold 11px sans-serif"; ctx.save(); ctx.beginPath(); ctx.rect(x, 0, x2 - x - 2, 18); ctx.clip(); ctx.fillText(s.name, x + 4, 13); ctx.restore(); });
    // the hits: lines where they are (land your cues on them)
    ctx.strokeStyle = "rgba(255,215,101,.55)"; ctx.lineWidth = 1; (song.hits || []).forEach(function (h) { var hx = Math.round(tlX(h)) + 0.5; ctx.beginPath(); ctx.moveTo(hx, 18); ctx.lineTo(hx, H); ctx.stroke(); });
    // the part just recorded
    if (lastRec) { ctx.fillStyle = "rgba(255,120,120,.10)"; ctx.fillRect(tlX(lastRec.from), 18, tlX(lastRec.to) - tlX(lastRec.from), H - 18); }
    if (rec) { ctx.fillStyle = "rgba(255,80,80,.18)"; ctx.fillRect(tlX(rec.from), 18, tlX(posNow()) - tlX(rec.from), H - 18); }
    // cues (automatic ones dimmer)
    var list = cuesNow().concat(rec ? rec.cues : []);
    list.forEach(function (c) {
      var x = tlX(cueTime(c)), y = cueY(c), h = c.kind === "flash" ? 12 : c.kind === "fixture" ? 14 : 20, l = c.look ? lookById(c.look) : null;
      ctx.globalAlpha = c.auto ? 0.55 : 1;
      if (c.kind === "look" && c.fade) { var fw = tlX(cueTime(c) + c.fade * 60 / song.bpm) - x; ctx.fillStyle = "rgba(255,255,255,.12)"; ctx.fillRect(x, y, fw, h); }
      if (c.kind === "fixture") { var ids = Object.keys(c.fixtures || {}); ids.slice(0, 4).forEach(function (id, k) { ctx.fillStyle = c.fixtures[id].color || "#888"; ctx.fillRect(x - 3, y + k * 3.5, 6, 3.5); }); ctx.strokeStyle = c === selectedCue ? "#5de6b0" : "rgba(0,0,0,.6)"; ctx.lineWidth = c === selectedCue ? 3 : 1; ctx.strokeRect(x - 3.5, y - 0.5, 7, h + 1); }
      else { ctx.fillStyle = (l && l.swatch) || "#888"; ctx.fillRect(x - 3, y, 6, h); ctx.strokeStyle = c === selectedCue ? "#5de6b0" : "rgba(0,0,0,.6)"; ctx.lineWidth = c === selectedCue ? 3 : 1; ctx.strokeRect(x - 3.5, y - 0.5, 7, h + 1); }
      if (c.kind === "look" && l) { ctx.fillStyle = "#dfe9f5"; ctx.font = "11px sans-serif"; ctx.fillText(l.name, x + 6, y + 14); }
      ctx.globalAlpha = 1;
    });
    var px = tlX(posNow()); ctx.fillStyle = "#5de6b0"; ctx.fillRect(px - 1, 0, 2, H);
  }
  function cueAtPx(px, py) { var best = null, bd = 9; cuesNow().forEach(function (c) { if (c.auto) return; var x = tlX(cueTime(c)), y = cueY(c) + 8, d = Math.abs(x - px) + (Math.abs(y - py) > 14 ? 20 : 0); if (d < bd) { bd = d; best = c; } }); return best; }
  function snapTime(t) {
    var bb = barBeatAt(t), bar = bb.bar, beat = bb.beat;
    if (rig.snap === "bar") { if (beat > beatsIn(bar - 1) / 2 + 1) bar++; beat = 1; }
    else if (rig.snap === "half") beat = Math.round(beat * 2) / 2; else if (rig.snap === "quarter") beat = Math.round(beat * 4) / 4; else beat = Math.round(beat);
    if (beat >= beatsIn(bar - 1) + 1) { bar++; beat = 1; } if (beat < 1) beat = 1;
    return { bar: Math.max(1, bar), beat: beat };
  }
  function renderShowPanel() {
    var info = $("#lxShowInfo"); if (!info) return;
    var mode = show.mode, mine = show.cues.length;
    $("#lxMode").value = mode;
    info.textContent = !show.song ? "No song." : show.loading ? "Loading the light show…" : (mode === "auto" ? "Automatic: the sections, the hits and the music" : mode === "semi" ? "Automatic + " + mine + " cue" + (mine === 1 ? "" : "s") + " of yours" : mine + " cue" + (mine === 1 ? "" : "s")) + " · " + (song.name || "") + (show.bpm && Math.abs(show.bpm - song.bpm) > 0.5 ? " · programmed at " + Math.round(show.bpm) + " BPM, playing at " + Math.round(song.bpm) + " - the cues follow the tempo" : "");
    $("#lxSaveState").textContent = show.saved ? (show.cues.length ? "saved on the Central Control" : "") : "saving…";
    $("#lxPreview").textContent = preview ? "■ Stop preview" : (song.hasTracks === false || (!song.overview.length && !song.hasTracks) ? "▶ Run the click here" : "▶ Preview here"); $("#lxPreview").classList.toggle("on", !!preview || click.running);
    var rb = $("#lxRec"); rb.classList.toggle("rec", !!live.rec); rb.textContent = live.rec ? (rec ? "■ Stop recording" : "● Armed - play the song") : "● Record";
    var ins = $("#lxCue");
    if (!selectedCue || show.cues.indexOf(selectedCue) < 0) { selectedCue = null; ins.innerHTML = '<span class="muted">Click the timeline to add a cue with the selected preset (snap: ' + esc(rig.snap) + '). Click a cue to edit it, drag it to move it. The yellow lines are the hits.</span>'; return; }
    var c = selectedCue;
    if (c.kind === "fixture") { ins.innerHTML = '<b>Light colours</b>' + Object.keys(c.fixtures || {}).map(function (id) { var f = rig.fixtures.filter(function (x) { return x.id === id; })[0], o = c.fixtures[id]; return '<label>' + esc(f ? f.name : id) + '<input type="color" data-cuef="' + esc(id) + '" value="' + esc(o.color || "#ffffff") + '"></label>'; }).join("") + '<label>Bar<input type="number" min="1" data-cue="bar" value="' + c.bar + '"></label><label>Beat<input type="number" min="1" max="12" step="0.25" data-cue="beat" value="' + (c.beat || 1) + '"></label><label>Fade (beats)<input type="number" min="0" max="64" step="0.5" data-cue="fade" value="' + (c.fade || 0) + '"></label><button data-cue="del" class="danger">Delete</button>'; return; }
    ins.innerHTML = '<label>Preset<select data-cue="look">' + rig.looks.map(function (l) { return '<option value="' + esc(l.id) + '"' + (l.id === c.look ? " selected" : "") + ">" + esc(l.name) + "</option>"; }).join("") + "</select></label>" +
      '<label>Kind<select data-cue="kind"><option value="look"' + (c.kind !== "flash" ? " selected" : "") + '>Go to preset</option><option value="flash"' + (c.kind === "flash" ? " selected" : "") + ">Flash (then back)</option></select></label>" +
      '<label>Bar<input type="number" min="1" data-cue="bar" value="' + c.bar + '"></label><label>Beat<input type="number" min="1" max="12" step="0.25" data-cue="beat" value="' + (c.beat || 1) + '"></label>' +
      (c.kind === "flash" ? '<label>Length (beats)<input type="number" min="0.125" step="0.125" data-cue="dur" value="' + (c.dur || 0.5) + '"></label>' : '<label>Fade (beats)<input type="number" min="0" max="64" step="0.5" data-cue="fade" value="' + (c.fade || 0) + '"></label>') +
      '<button data-cue="del" class="danger">Delete</button>';
  }
  // ---- every light: its colour and level, live (and recorded while Record is on)
  function renderLights() {
    var root = $("#lxLights"); if (!root) return;
    root.innerHTML = '<div class="row spread"><b>Lights</b><span><button data-lt="cue" title="Put these colours on the timeline at the playhead">+ Cue with these colours</button><button data-lt="clear">Every light follows the show</button></span></div><div class="lx-lgrid">' + rig.fixtures.map(function (f) {
      var o = live.over[f.id] || {}, st = live.fixtureColor[f.id], cur = o.color || (st ? rgbHex(st.r + st.w, st.g + st.w, st.b + st.w) : "#ffffff");
      return '<div class="lx-lt' + (live.over[f.id] ? " over" : "") + '" data-lt-id="' + esc(f.id) + '"><i class="lx-sw"></i><span class="lx-ltn">' + esc(f.name) + '<small>' + esc((GROUPS.filter(function (g) { return g[0] === f.group; })[0] || ["", f.group])[1]) + "</small></span>" +
        '<input type="color" data-lt="color" value="' + esc(cur) + '" title="This light\'s colour"><input type="range" min="0" max="1" step="0.01" data-lt="dim" value="' + (o.dim != null ? o.dim : st ? st.dim : 1) + '" title="Level"><button data-lt="follow" title="Back to the show"' + (live.over[f.id] ? "" : " disabled") + '>↺</button><button data-lt="find" title="Flash it">Find</button></div>';
    }).join("") + "</div>";
  }
  function drawLights() { $$("#lxLights .lx-lt").forEach(function (el) { var f = rig.fixtures.filter(function (x) { return x.id === el.dataset.ltId; })[0], st = f && live.fixtureColor[f.id]; if (st) el.querySelector(".lx-sw").style.background = lensColor(f, st).css; }); }

  // ---- songs: the Central Control's (with or without tracks) and your own; scenes on bars and beats
  var songSel = store.get("lxSong", null), songEdit = null, songsTimer = 0;
  function renderSongsSoon() { clearTimeout(songsTimer); songsTimer = setTimeout(function () { if (visible() && view === "songs") renderSongs(); }, 150); }
  function allSongs() { var list = hub.list.map(function (s) { return Object.assign({ from: "cc" }, s); }); rig.localSongs.forEach(function (s) { list.push(Object.assign({ from: "local", hasTracks: false }, s)); }); return list; }
  async function loadEdit(id) {
    if (show.song === id) { songEdit = { id: id, live: true }; renderSongs(); return; }
    songEdit = { id: id, cues: [], mode: rig.defaultMode, bpm: null, loading: true }; renderSongs();
    try { var r = await fetch(CU.api("/lighting?song=" + encodeURIComponent(id)), { cache: "no-store" }); var j = r.ok ? await r.json() : {}; if (songEdit.id !== id) return; songEdit.cues = (j.cues || []).filter(function (c) { return !c.auto; }); songEdit.mode = j.mode || (j.auto ? "auto" : (j.cues || []).length ? "manual" : rig.defaultMode); songEdit.bpm = j.bpm || null; (j.looks || []).forEach(function (l) { if (l && l.id && !rig.looks.some(function (x) { return x.id === l.id; })) rig.looks.push(l); }); } catch (_) { }
    songEdit.loading = false; renderSongs();
  }
  function editTarget() { return songEdit && songEdit.live ? show : songEdit; }
  async function saveEdit() {
    var e = songEdit; if (!e || e.live) { changed(); return; }
    var code = CU.prefs.code; if (!code) { CU.askCode(); return; }
    var info = allSongs().filter(function (s) { return s.id === e.id; })[0] || {};
    try { await fetch(CU.api("/lighting"), { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify({ song: e.id, code: code, by: "Central Usage-" + selfId, show: { cues: e.cues, mode: e.mode, bpm: e.bpm || info.bpm, song: info.name } }) }); e.saved = true; } catch (_) { }
  }
  function renderSongs() {
    var root = $("#lxSongs"); if (!root) return;
    var list = allSongs(); if (!songSel && list.length) songSel = list[0].id;
    var s = list.filter(function (x) { return x.id === songSel; })[0];
    if (s && (!songEdit || songEdit.id !== s.id)) { loadEdit(s.id); return; }
    var e = editTarget();
    root.innerHTML = '<div class="lx-slist"><div class="row spread"><b>Songs</b><button data-ls="new">+ Song</button></div>' +
      '<p class="muted small">On the Central Control</p>' + (hub.list.length ? hub.list.map(function (x) { return '<button class="lx-sitem' + (x.id === songSel ? " sel" : "") + (x.id === show.song ? " live" : "") + '" data-ls-pick="' + esc(x.id) + '"><b>' + esc(x.name) + "</b><small>" + (x.hasTracks ? "tracks · " : "no tracks · ") + Math.round(x.bpm || 0) + " BPM" + (x.key ? " · " + esc(x.key) : "") + "</small></button>"; }).join("") : '<p class="muted small">' + (CU.state.connected ? "No songs yet." : "Connect to the Central Control.") + "</p>") +
      '<p class="muted small">Yours (no tracks)</p>' + (rig.localSongs.length ? rig.localSongs.map(function (x) { return '<button class="lx-sitem' + (x.id === songSel ? " sel" : "") + '" data-ls-pick="' + esc(x.id) + '"><b>' + esc(x.name) + "</b><small>" + Math.round(x.bpm || 0) + " BPM · " + (x.bpb || 4) + "/4</small></button>"; }).join("") : '<p class="muted small">Add a song with + Song.</p>') + "</div>" +
      '<div class="lx-sedit">' + (!s ? '<p class="muted">Pick a song.</p>' : songEditor(s, e)) + "</div>";
  }
  function songEditor(s, e) {
    if (!e || e.loading) return '<p class="muted">Loading…</p>';
    var scenes = e.cues.filter(function (c) { return c.kind === "look" || c.kind == null; }), info = hub.detail[s.id];
    var secOpts = function (c) { var secs = info && info.sections || []; return '<option value="">bar ' + c.bar + "</option>" + secs.map(function (q, k) { return '<option value="' + k + '"' + (q.bar === c.bar && (c.beat || 1) === 1 ? " selected" : "") + ">" + esc(q.name) + " (bar " + q.bar + ")</option>"; }).join(""); };
    return '<div class="row"><h3>' + esc(s.name) + "</h3>" + (s.from === "local" ? '<label>Name <input data-ls="name" value="' + esc(s.name) + '"></label><label>BPM <input type="number" min="30" max="300" step="0.5" data-ls="bpm" value="' + (s.bpm || 120) + '" style="width:80px"></label><label>Beats per bar <input type="number" min="2" max="12" data-ls="bpb" value="' + (s.bpb || 4) + '" style="width:60px"></label><button data-ls="del" class="danger">Delete song</button>' : '<span class="muted">' + Math.round(s.bpm || 0) + " BPM" + (s.key ? " · " + esc(s.key) : "") + (s.hasTracks ? " · with tracks" : " · no tracks (follows the Central Control's click)") + "</span>") + "</div>" +
      '<div class="row"><label>Mode <select data-ls="mode"><option value="auto"' + (e.mode === "auto" ? " selected" : "") + '>Auto - from the pedal\'s MIDI hits and the music</option><option value="semi"' + (e.mode === "semi" ? " selected" : "") + '>Semi-auto - automatic + these scenes</option><option value="manual"' + (e.mode === "manual" ? " selected" : "") + ">Scenes only</option></select></label>" +
      '<span class="muted small">' + (e.bpm && s.bpm && Math.abs(e.bpm - s.bpm) > 0.5 ? "Programmed at " + Math.round(e.bpm) + " BPM - played at " + Math.round(s.bpm) + ": every scene stays on its bar and beat." : "Scenes sit on bars and beats: at another tempo they move with it.") + "</span></div>" +
      '<table class="lx-table lx-scenes"><thead><tr><th>#</th><th>Starts</th><th>Bar</th><th>Beat</th><th>Preset</th><th>Fade (beats)</th><th>Name</th><th></th></tr></thead><tbody>' + scenes.map(function (c, k) { return '<tr data-sc="' + k + '"><td>' + (k + 1) + '</td><td><select data-scf="at">' + secOpts(c) + '</select></td><td><input type="number" min="1" data-scf="bar" value="' + c.bar + '" style="width:70px"></td><td><input type="number" min="1" max="12" step="0.25" data-scf="beat" value="' + (c.beat || 1) + '" style="width:64px"></td><td><select data-scf="look">' + rig.looks.filter(function (l) { return !l.flash; }).map(function (l) { return '<option value="' + esc(l.id) + '"' + (l.id === c.look ? " selected" : "") + ">" + esc(l.name) + "</option>"; }).join("") + '</select></td><td><input type="number" min="0" max="64" step="0.5" data-scf="fade" value="' + (c.fade || 0) + '" style="width:64px"></td><td><input data-scf="label" value="' + esc(c.label || "") + '" placeholder="Verse lights"></td><td><button data-sc-del="' + k + '">✕</button></td></tr>'; }).join("") + "</tbody></table>" +
      '<div class="row"><button data-ls="scene" class="primary">+ Scene</button>' + (s.id === show.song ? '<button data-ls="open">Open in the Show tab</button>' : '<button data-ls="program" title="Program it on the Show tab (with the preview / the click here) while the Central Control is on another song">Program it on the Show tab</button>') + '<span class="muted small">' + (e.cues.length - scenes.length ? (e.cues.length - scenes.length) + " flashes / light cues too (Show tab)" : "") + "</span></div>";
  }
  function programSong(id) {   // the Show tab works on this song (lights follow it) until the Central Control plays
    stopPreview(); var s = allSongs().filter(function (x) { return x.id === id; })[0]; if (!s) return;
    song.local = true; song.playing = false; song.pos = 0; song.bars = []; song.barBeats = []; song.hits = []; song.bpm = s.bpm || 120; song.bpb = s.bpb || 4; song.duration = s.duration || 0; song.hasTracks = !!s.hasTracks;
    setSong(id, s.name, [], true); showSub("show");
  }

  // ---- presets view
  var editLook = null;
  function renderLooks() {
    var list = $("#lxLookList"); if (!list) return;
    if (!editLook || rig.looks.indexOf(editLook) < 0) editLook = lookById(selectedLook);
    list.innerHTML = rig.looks.map(function (l) { return '<button class="lx-look' + (l === editLook ? " sel" : "") + '" data-edit-look="' + esc(l.id) + '" style="--sw:' + esc(l.swatch || "#888") + '"><i></i><span>' + esc(l.name) + "</span></button>"; }).join("") + '<button class="lx-look add" data-a="look-new"><i></i><span>+ New preset</span></button>';
    var l = editLook, ed = $("#lxLookEdit");
    ed.innerHTML = '<div class="row"><label>Name<input data-lk="name" value="' + esc(l.name) + '"></label><label>Button colour<input type="color" data-lk="swatch" value="' + esc(l.swatch || "#888888") + '"></label><label>Fade in (beats)<input type="number" min="0" max="64" step="0.5" data-lk="fade" value="' + (l.fade != null ? l.fade : 1) + '" style="width:70px"></label><label class="toggle"><input type="checkbox" data-lk="flash"' + (l.flash ? " checked" : "") + '> Flash preset (for hits)</label><button data-a="look-try">Try it live</button><button data-a="look-dup">Duplicate</button>' + (l.builtIn ? '<button data-a="look-reset">Reset</button>' : '<button data-a="look-del" class="danger">Delete</button>') + "</div>" +
      '<p class="muted small">Colour, level, motion (effect, movers) and timing (how often, depth, phase, fade) for each group. Every change plays live while "Try it live" is on.</p>' +
      '<div class="lx-groups">' + GROUPS.map(function (gr) {
        var g = l.g[gr[0]], on = !!g; g = g || G(0, "#ffffff");
        var haze = gr[0] === "haze";
        return '<div class="lx-group' + (on ? "" : " off") + '" data-group="' + gr[0] + '"><div class="row spread"><b>' + esc(gr[1]) + '</b><label class="toggle"><input type="checkbox" data-lg="on"' + (on ? " checked" : "") + "> on</label></div>" +
          '<label>' + (haze ? "Output" : "Intensity") + ' <output>' + Math.round(g.dim * 100) + '%</output><input type="range" min="0" max="1" step="0.01" data-lg="dim" value="' + g.dim + '"></label>' +
          (haze ? "" : '<div class="row"><label>Colour<input type="color" data-lg="color" value="' + esc(g.color) + '"></label><label>2nd colour<input type="color" data-lg="color2" value="' + esc(g.color2 || g.color) + '" title="With Alternate: the lights swap between the two colours"></label><span class="lx-swatches">' + ["#ffb36b", "#ffffff", "#1f4dff", "#0a1fb0", "#7a2bff", "#ff2a10", "#ff8a00", "#00c8ff", "#00e676", "#ff3ea5"].map(function (c) { return '<button data-lg-color="' + c + '" style="background:' + c + '"></button>'; }).join("") + "</span></div>" +
          '<div class="row"><label>White <input type="range" min="0" max="1" step="0.05" data-lg="w" value="' + (g.w || 0) + '"></label><label>Amber <input type="range" min="0" max="1" step="0.05" data-lg="a" value="' + (g.a || 0) + '"></label><label>UV <input type="range" min="0" max="1" step="0.05" data-lg="uv" value="' + (g.uv || 0) + '"></label><label>Strobe <input type="range" min="0" max="1" step="0.05" data-lg="strobe" value="' + (g.strobe || 0) + '"></label></div>' +
          '<div class="row"><label>Motion<select data-lg="fx">' + FX.map(function (f) { return '<option value="' + f[0] + '"' + (f[0] === g.fx ? " selected" : "") + ">" + f[1] + "</option>"; }).join("") + '</select></label><label>Every<select data-lg="speed">' + [[0.25, "¼ beat"], [0.5, "½ beat"], [1, "beat"], [2, "2 beats"], [4, "bar"], [8, "2 bars"], [16, "4 bars"]].map(function (s) { return '<option value="' + s[0] + '"' + (Number(g.speed) === s[0] ? " selected" : "") + ">" + s[1] + "</option>"; }).join("") + '</select></label><label>Depth <input type="range" min="0" max="1" step="0.05" data-lg="size" value="' + (g.size == null ? 0.6 : g.size) + '"></label></div>' +
          (gr[0] === "beam" || groupHasMovers(gr[0]) ? moverEditor(g) : "")) + "</div>";
      }).join("") + "</div>";
  }
  function groupHasMovers(gk) { return rig.fixtures.some(function (f) { return f.group === gk && profileOf(f).mover; }); }
  function moverEditor(g) {
    var pan = g.pan == null ? 0.5 : g.pan, tilt = g.tilt == null ? 0.5 : g.tilt;
    return '<div class="lx-mover"><div class="lx-xy" data-xy="1" title="Drag: where the movers point (left-right = pan, up-down = tilt)"><i style="left:' + (pan * 100) + '%;top:' + (tilt * 100) + '%"></i><span>pan ' + Math.round(pan * 100) + " · tilt " + Math.round(tilt * 100) + '</span></div><div class="lx-mv-side"><div class="lx-pos">' +
      POSITIONS.map(function (p, i) { return '<button data-pos="' + i + '">' + esc(p[0]) + "</button>"; }).join("") + '</div><label>Fan out <input type="range" min="0" max="1" step="0.05" data-lg="fan" value="' + (g.fan || 0) + '"></label><label>Phase <input type="range" min="0" max="1" step="0.05" data-lg="offset" value="' + (g.offset == null ? 1 : g.offset) + '" title="0 = all movers together, 1 = spread around the shape"></label></div></div>';
  }

  // ---- fixtures view
  function profileOptions(sel) {
    var lib = rig.library || [];
    return '<optgroup label="Generic">' + Object.keys(PROFILES).map(function (k) { return '<option value="' + k + '"' + (k === sel ? " selected" : "") + ">" + esc(PROFILES[k].name) + "</option>"; }).join("") + "</optgroup>" +
      (lib.length ? '<optgroup label="Your fixture library">' + lib.map(function (e) { return '<option value="' + esc(e.id) + '"' + (e.id === sel ? " selected" : "") + ">" + esc(e.name) + "</option>"; }).join("") + "</optgroup>" : "");
  }
  function fillAddProfiles() { var el = $("#lxAddProfile"); if (el) { var v = el.value; el.innerHTML = profileOptions(v || "rgbwd5"); if (v) el.value = v; } }
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
  function renderFixtures() {
    renderLibrary();
    var root = $("#lxFixTable"); if (!root) return;
    var used = {}, clash = {};
    rig.fixtures.forEach(function (f) { var n = profileOf(f).ch.length; for (var i = 0; i < n; i++) { var k = (f.universe || 1) + ":" + ((f.address || 1) + i); if (used[k] && used[k] !== f.id) { clash[f.id] = true; clash[used[k]] = true; } used[k] = f.id; } });
    root.innerHTML = '<table class="lx-table"><thead><tr><th>Name</th><th>Type</th><th>Group</th><th>Universe</th><th>Address</th><th>Channels</th><th></th></tr></thead><tbody>' + rig.fixtures.map(function (f) {
      var p = profileOf(f), n = p.ch.length, end = (f.address || 1) + n - 1, hasOut = rig.outputs.some(function (o) { return o.universe === (f.universe || 1) && o.mode !== "off"; });
      return '<tr data-fx="' + esc(f.id) + '"' + (clash[f.id] ? ' class="clash"' : "") + '><td><input data-ff="name" value="' + esc(f.name) + '"></td><td><select data-ff="profile">' + profileOptions(f.profile) + '<option value="custom"' + (f.profile === "custom" ? " selected" : "") + '>Custom…</option></select>' + (p.mover ? '<span class="lx-inv"><label class="toggle" title="Mirror the pan (a mover hung the other way round)"><input type="checkbox" data-ff="invertPan"' + (f.invertPan ? " checked" : "") + '>invert pan</label><label class="toggle"><input type="checkbox" data-ff="invertTilt"' + (f.invertTilt ? " checked" : "") + ">invert tilt</label></span>" : "") + (f.profile === "custom" ? '<input data-ff="channels" title="Channel types in order: ' + CH_TYPES.join(" ") + '" value="' + esc((f.channels || []).join(" ")) + '">' : "") + "</td>" +
        '<td><select data-ff="group">' + GROUPS.map(function (g) { return '<option value="' + g[0] + '"' + (g[0] === f.group ? " selected" : "") + ">" + esc(g[1]) + "</option>"; }).join("") + '</select></td><td><input type="number" min="1" max="64" data-ff="universe" value="' + (f.universe || 1) + '">' + (hasOut ? "" : ' <small class="warn" title="No output sends this universe (Output tab)">no output</small>') + '</td><td><input type="number" min="1" max="512" data-ff="address" value="' + (f.address || 1) + '"></td><td class="muted">' + n + " (" + f.address + "–" + end + ")" + (clash[f.id] ? ' <b class="bad">overlaps</b>' : end > 512 ? ' <b class="bad">past 512</b>' : "") + '</td><td><button data-ff="identify" title="Flash this fixture">Find</button><button data-ff="del" title="Remove">✕</button></td></tr>';
    }).join("") + "</tbody></table>";
    var uni = Number($("#lxAddUni").value) || 1, next = rig.fixtures.reduce(function (m, f) { return (f.universe || 1) === uni ? Math.max(m, (f.address || 1) + profileOf(f).ch.length) : m; }, 1);
    $("#lxAddAddr").value = Math.min(512, next);
  }
  function addFixtures() {
    var prof = $("#lxAddProfile").value, P = profileFor(prof) || PROFILES.dimmer, n = clamp(Number($("#lxAddCount").value) || 1, 1, 48), addr = clamp(Number($("#lxAddAddr").value) || 1, 1, 512), uni = clamp(Number($("#lxAddUni").value) || 1, 1, 64), grp = $("#lxAddGroup").value, le = libEntry(prof), name = $("#lxAddName").value.trim() || (le ? le.model : P.name.replace(/\s*\(.*$/, ""));
    for (var i = 0; i < n; i++) rig.fixtures.push({ id: uid(), name: n > 1 ? name + " " + (i + 1) : name, profile: prof, group: grp, universe: uni, address: addr + i * P.ch.length, x: n > 1 ? 0.15 + 0.7 * i / (n - 1) : 0.5, y: { front: 0.85, back: 0.2, beam: 0.34, house: 0.96, fx: 0.08, haze: 0.1 }[grp] || 0.5 });
    if (!rig.outputs.some(function (o) { return o.universe === uni; })) rig.outputs.push({ universe: uni, mode: "off", path: "", host: "", offset: 0 });
    saveRig(); renderFixtures(); $("#lxPlot").dataset.n = "";
  }

  // ---- output view: one output per universe
  var outStatus = null, ports = [];
  function universes() { var u = {}; rig.fixtures.forEach(function (f) { u[f.universe || 1] = true; }); rig.outputs.forEach(function (o) { u[o.universe] = true; }); return Object.keys(u).map(Number).sort(function (a, b) { return a - b; }); }
  async function renderOutput() {
    var root = $("#lxOutputs"); if (!root) return;
    if (DMX) { try { ports = await DMX.ports(); outStatus = await DMX.status(); } catch (_) { } }
    root.innerHTML = rig.outputs.map(function (o, k) {
      var st = outStatus && outStatus.outputs ? outStatus.outputs.filter(function (x) { return x.universe === o.universe; })[0] : null;
      return '<div class="lx-out" data-out="' + k + '"><b>Universe <input type="number" min="1" max="64" data-o="universe" value="' + o.universe + '" style="width:60px"></b><select data-o="mode">' + [["off", "Off"], ["usb", "USB-DMX interface"], ["artnet", "Art-Net"], ["sacn", "sACN (E1.31)"]].map(function (m) { return '<option value="' + m[0] + '"' + (o.mode === m[0] ? " selected" : "") + ">" + m[1] + "</option>"; }).join("") + "</select>" +
        (o.mode === "usb" ? '<select data-o="path"><option value="">— choose the USB-DMX interface —</option>' + ports.map(function (p) { return '<option value="' + esc(p.path) + '"' + (p.path === o.path ? " selected" : "") + ">" + esc(p.name) + (p.likely ? " ★" : "") + " (" + esc(p.device) + ")</option>"; }).join("") + "</select>" : "") +
        (o.mode === "artnet" || o.mode === "sacn" ? '<input data-o="host" placeholder="' + (o.mode === "sacn" ? "node IP (empty = multicast)" : "node IP (empty = broadcast)") + '" value="' + esc(o.host || "") + '">' + (o.mode === "artnet" ? '<label title="Art-Net counts universes from 0: universe 1 goes out as Art-Net universe 0 + this">Art-Net offset <input type="number" min="-1" max="32767" data-o="offset" value="' + (o.offset || 0) + '" style="width:70px"></label>' : "") : "") +
        '<span class="muted small">' + (o.mode === "off" ? "off" : st ? (st.error ? "⚠ " + esc(st.error) : "→ " + esc(st.target || "") + " · " + st.frames + " frames") : DMX ? "" : "works in the app") + '</span><button data-o="del" title="Remove">✕</button></div>';
    }).join("");
    $("#lxOutState").textContent = !DMX ? "DMX output works in the Central Usage app (not in a browser)." : outputsOn() ? rig.fixtures.length + " fixtures on " + universes().length + " universe" + (universes().length === 1 ? "" : "s") : "DMX output is off.";
    var mu = $("#lxMonUni"), cur = Number(mu.value) || universes()[0] || 1; mu.innerHTML = universes().map(function (u) { return '<option value="' + u + '"' + (u === cur ? " selected" : "") + ">" + u + "</option>"; }).join("");
  }
  async function applyOutput() { saveRig(); if (DMX) { await DMX.configure({ outputs: rig.outputs }); lastSent = ""; } renderOutput(); }
  function drawMonitor() {
    var root = $("#lxMonitor"); if (!root || !live.lastFrame) return;
    var uni = Number($("#lxMonUni").value) || 1, u = live.lastFrame[String(uni)] || new Uint8Array(512), last = rig.fixtures.reduce(function (m, f) { return (f.universe || 1) === uni ? Math.max(m, (f.address || 1) + profileOf(f).ch.length - 1) : m; }, 16), n = clamp(Math.ceil(last / 16) * 16, 16, 512);
    if (root.children.length !== n) { var h = ""; for (var i = 0; i < n; i++) h += '<span title="' + (i + 1) + '"><i></i><b>' + (i + 1) + "</b></span>"; root.innerHTML = h; }
    for (var k = 0; k < n; k++) { var el = root.children[k].firstChild; el.style.height = (u[k] / 255 * 100) + "%"; root.children[k].title = (k + 1) + ": " + u[k]; }
  }
  function renderClick() {
    var root = $("#lxClick"); if (!root) return; var c = rig.click;
    root.innerHTML = '<label class="toggle"><input type="checkbox" data-ck="hear"' + (c.hear ? " checked" : "") + '> Hear a click while programming (Preview here, the click here)</label>' +
      '<label class="toggle"><input type="checkbox" data-ck="follow"' + (c.follow ? " checked" : "") + '> The lights follow the click (songs without tracks, the click here)</label>' +
      '<label class="toggle"><input type="checkbox" data-ck="output"' + (c.output ? " checked" : "") + '> The click as an audio output (follows the Central Control while it plays)</label>' +
      '<div class="row"><label>Output <select data-ck="device"><option value="">This computer\'s output</option></select></label><label>Level <input type="range" min="0" max="1" step="0.05" data-ck="level" value="' + c.level + '"></label><label class="toggle"><input type="checkbox" data-ck="accent"' + (c.accent ? " checked" : "") + "> Accent the first beat</label></div>" +
      '<button data-ck="run">' + (click.running ? "■ Stop the click" : "▶ Run the click now (" + Math.round(song.bpm || 120) + " BPM)") + "</button>";
    var sel = root.querySelector('[data-ck="device"]'); if (navigator.mediaDevices) navigator.mediaDevices.enumerateDevices().then(function (list) { list.filter(function (d) { return d.kind === "audiooutput" && d.deviceId !== "default"; }).forEach(function (d) { var o = document.createElement("option"); o.value = d.deviceId; o.textContent = d.label || "Output " + d.deviceId.slice(0, 6); if (d.deviceId === c.device) o.selected = true; sel.appendChild(o); }); }).catch(function () { });
  }
  function renderAudio() {
    var root = $("#lxAudio"); if (!root) return; var a = rig.audio, X = window.CUMix, has = !!(X && X.meters && X.meters.bands);
    root.innerHTML = '<p class="muted small">In Auto and Semi-auto the lights breathe with the music (its level) and, in songs without detected hits, flash on the strong beats. The music is the Central Control\'s audio on the audio host.</p>' +
      '<label class="toggle"><input type="checkbox" data-au="react"' + (a.react ? " checked" : "") + '> React to the music</label><label>How much <input type="range" min="0" max="1" step="0.05" data-au="amount" value="' + a.amount + '"></label><label class="toggle"><input type="checkbox" data-au="onsets"' + (a.onsets ? " checked" : "") + "> Flash on the strong beats (when there are no hits)</label>" +
      '<p class="muted small">' + (has ? "✓ hearing the music" : "No audio here yet: it needs the audio host (I/O tab) and the Central Control's audio over the network.") + "</p>";
  }

  // ------------------------------------------------------------- the chat box: plain words -> cues
  async function chat(text) {
    var A = window.CULightsAI, out = $("#lxChatOut"); if (!A || !text.trim()) return;
    if (!show.song) { out.textContent = "Pick a song first (the Central Control's, or one on the Songs tab)."; return; }
    var ctx = { groups: GROUPS.filter(function (g) { return rig.fixtures.some(function (f) { return f.group === g[0]; }); }), fixtures: rig.fixtures.map(function (f) { return { id: f.id, name: f.name, group: f.group, profileName: profileOf(f).name }; }), sections: song.sections.map(function (s) { return { name: s.name, start: s.start, end: s.end, bar: s.bar || barBeatAt(s.start).bar, type: s.type || secType(s.name) }; }), hits: song.hits || [], bpb: song.bpb, bpm: song.bpm, duration: dur(), barBeatAt: barBeatAt };
    var res = A.parse(text, ctx), steps = res.steps, how = "";
    var AI = window.CU && window.CU.ai;
    if (AI && store.get("aiUse", true)) {
      try { var st = await AI.status(); if (st.downloaded && st.server) { out.textContent = "Asking the model…"; var ans = await AI.ask(A.systemPrompt(ctx), text); if (ans && ans.text) { var j = null; try { j = JSON.parse((ans.text.match(/\{[\s\S]*\}/) || [""])[0]); } catch (_) { } var ms = A.fromModel(j, ctx); if (ms && ms.length >= steps.length) { steps = ms; how = " (AI model)"; } } } } catch (_) { }
    }
    if (!steps.length) { out.textContent = "I didn't find anything to do in that. Try: \"back blue 40% for the verse, chorus full white, strobes on the hits\"."; return; }
    var plan = A.build(steps, ctx);
    // the sections it talked about get the new cues (their old cues go)
    var spans = []; steps.forEach(function (s) { ctx.sections.forEach(function (q, k) { if (s.section === "all" || q.type === s.section) { if (s.num == null || ctx.sections.filter(function (x) { return x.type === s.section; }).indexOf(q) === s.num - 1) spans.push([q.start, q.end]); } }); if (s.section === "all" && !ctx.sections.length) spans.push([0, 1e9]); });
    show.cues = show.cues.filter(function (c) { var t = cueTime(c); return !spans.some(function (sp) { return t >= sp[0] - 0.02 && t < sp[1] - 0.02; }); });
    plan.looks.forEach(function (l) { rig.looks.push(l); });
    show.cues = sortCues(show.cues.concat(plan.cues));
    if (show.mode === "auto") show.mode = "semi";
    saveRig(); renderPalette(); changed();
    var unknown = res.notes.length ? " · didn't understand: " + res.notes.join(", ") : "";
    out.textContent = "✓ " + plan.cues.length + " cues" + how + ": " + plan.summary + (plan.notes.length ? " · " + plan.notes.join(" ") : "") + unknown;
  }

  // ------------------------------------------------------------- events
  function goLook(id) { var l = lookById(id); recordLook(l); if (l.flash) { live.flash = { look: l.id, until: performance.now() + 450, len: 450 }; return; } live.manualFrom = live.manual || (live.state && live.state.cue ? lookById(live.state.cue.look) : lookById(rig.stopped || "walkin")); live.manual = l; live.manualAt = performance.now(); live.manualFade = Math.max(0.05, (l.fade != null ? l.fade : 1) * 60 / (song.bpm || 100)); renderPalette(); }
  function wire() {
    $("#lxNav").addEventListener("click", function (e) { var b = e.target.closest("[data-lx]"); if (b) showSub(b.dataset.lx); });
    $("#lxPalette").addEventListener("click", function (e) { var b = e.target.closest("[data-look]"); if (!b) return; selectedLook = b.dataset.look; store.set("lxLook", selectedLook); goLook(b.dataset.look); renderPalette(); });
    $("#lxFollow").addEventListener("click", function () { live.manual = null; renderPalette(); });
    $("#lxBlackout").addEventListener("click", function () { live.blackout = !live.blackout; renderPalette(); });
    $("#lxRec").addEventListener("click", function () { live.rec = !live.rec; if (!live.rec) finishRecording(); else if (playingNow()) rec = { from: posNow(), cues: [] }; renderShowPanel(); });
    $("#lxPreview").addEventListener("click", function () {
      if (preview) stopPreview();
      else if (click.running) toggleFreeClick(false);
      else if (song.hasTracks !== false && (song.overview.length || (hub.detail[song.id] && hub.detail[song.id].hasTracks))) startPreview();
      else { toggleFreeClick(true); if (!song.playing) clockLocal(); }   // no tracks: the click here runs the timeline
      renderShowPanel();
    });
    document.addEventListener("keydown", function (e) { if (!visible() || e.target.matches("input,select,textarea") || e.repeat) return; if (e.key === "h" || e.key === "H") { live.flash = { look: "hit", until: performance.now() + 250, len: 250 }; recordFlash("hit"); } });
    $("#lxFlash").addEventListener("pointerdown", function () { live.flash = { look: "hit", until: performance.now() + 100000, len: 100000 }; recordFlash("hit"); });
    ["pointerup", "pointerleave"].forEach(function (ev) { $("#lxFlash").addEventListener(ev, function () { if (live.flash && live.flash.len > 1000) live.flash = { look: "hit", until: performance.now() + 250, len: 250 }; }); });
    $("#lxFaders").addEventListener("input", function (e) { var k = e.target.dataset.fader; if (!k) return; if (k === "master") rig.master = Number(e.target.value); else rig.groupLevel[k] = Number(e.target.value); saveRig(); });
    $("#lxMode").addEventListener("change", function () { show.mode = this.value; changed(); });
    $("#lxAuto").addEventListener("click", function () { if (show.cues.length && !confirm("Replace this song's cues with an automatic show from its sections and hits? (you can then change them)")) return; var a = autoCues(); a.forEach(function (c) { c.id = uid(); delete c.auto; }); show.cues = a; show.mode = "manual"; selectedCue = null; changed(); });
    $("#lxClear").addEventListener("click", function () { if (!confirm("Remove every cue of yours from this song?")) return; show.cues = []; selectedCue = null; changed(); });
    $("#lxSnap").value = rig.snap || "beat"; $("#lxSnap").addEventListener("change", function () { rig.snap = this.value; saveRig(); renderShowPanel(); });
    $("#lxStopped").innerHTML = rig.looks.map(function (l) { return '<option value="' + esc(l.id) + '"' + (l.id === rig.stopped ? " selected" : "") + ">" + esc(l.name) + "</option>"; }).join(""); $("#lxStopped").addEventListener("change", function () { rig.stopped = this.value; saveRig(); });
    $("#lxChatGo").addEventListener("click", function () { chat($("#lxChatIn").value); });
    $("#lxChatIn").addEventListener("keydown", function (e) { if (e.key === "Enter") chat(this.value); });
    var cv = $("#lxTimeline");
    cv.addEventListener("pointerdown", function (e) {
      var r = cv.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top, c = cueAtPx(px, py);
      if (e.shiftKey && preview) { startPreview(tlTime(px)); return; }
      if (c) { selectedCue = c; drag = { cue: c, moved: false }; cv.setPointerCapture(e.pointerId); renderShowPanel(); return; }
      if (!show.song) return;
      var at = snapTime(tlTime(px)), l = lookById(selectedLook);
      var cue = { id: uid(), bar: at.bar, beat: at.beat, look: l.id, kind: l.flash ? "flash" : "look", fade: l.flash ? 0 : (l.fade != null ? l.fade : 1), dur: 0.5 };
      show.cues.push(cue); sortCues(show.cues); selectedCue = cue; if (show.mode === "auto") show.mode = "semi"; changed();
    });
    cv.addEventListener("pointermove", function (e) { if (!drag) return; var r = cv.getBoundingClientRect(), at = snapTime(tlTime(e.clientX - r.left)); if (at.bar !== drag.cue.bar || at.beat !== drag.cue.beat) { drag.cue.bar = at.bar; drag.cue.beat = at.beat; drag.moved = true; dirty(); renderShowPanel(); } });
    cv.addEventListener("pointerup", function () { if (drag && drag.moved) { sortCues(show.cues); changed(); } drag = null; });
    $("#lxCue").addEventListener("change", function (e) { var f = e.target.dataset.cue, c = selectedCue; if (!c) return; if (e.target.dataset.cuef) { c.fixtures[e.target.dataset.cuef].color = e.target.value; changed(); return; } if (!f) return; var v = e.target.value; if (f === "look") { c.look = v; if (lookById(v).flash) c.kind = "flash"; } else if (f === "kind") c.kind = v; else c[f] = Number(v); delete c.auto; sortCues(show.cues); changed(); });
    $("#lxCue").addEventListener("click", function (e) { var f = e.target.dataset.cue, c = selectedCue; if (!c) return; if (f === "del") { show.cues.splice(show.cues.indexOf(c), 1); selectedCue = null; changed(); } });
    document.addEventListener("keydown", function (e) { if (!visible() || view !== "show" || e.target.matches("input,select,textarea")) return; if ((e.key === "Delete" || e.key === "Backspace") && selectedCue) { show.cues.splice(show.cues.indexOf(selectedCue), 1); selectedCue = null; changed(); e.preventDefault(); } });
    // the lights list
    var lt = $("#lxLights");
    lt.addEventListener("input", function (e) { var row = e.target.closest("[data-lt-id]"), k = e.target.dataset.lt; if (!row || (k !== "color" && k !== "dim")) return; var id = row.dataset.ltId, o = live.over[id] = live.over[id] || {}; if (k === "color") o.color = e.target.value; else o.dim = Number(e.target.value); row.classList.add("over"); row.querySelector('[data-lt="follow"]').disabled = false; recordFixture(id, o); });
    lt.addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return; var row = b.closest("[data-lt-id]"), id = row && row.dataset.ltId;
      if (b.dataset.lt === "follow" && id) { delete live.over[id]; renderLights(); }
      else if (b.dataset.lt === "find" && id) live.identify = { id: id, until: performance.now() + 2500 };
      else if (b.dataset.lt === "clear") { live.over = {}; renderLights(); }
      else if (b.dataset.lt === "cue") { var ids = Object.keys(live.over); if (!ids.length) return alert("Change a light's colour or level first."); if (!show.song) return; var at = snapTime(playingNow() ? posNow() : 0), fx = {}; ids.forEach(function (i2) { fx[i2] = Object.assign({}, live.over[i2]); }); var cue = { id: uid(), bar: at.bar, beat: at.beat, kind: "fixture", fixtures: fx, fade: 0.5 }; show.cues.push(cue); sortCues(show.cues); selectedCue = cue; if (show.mode === "auto") show.mode = "semi"; live.over = {}; renderLights(); changed(); }
    });
    // plot: drag fixtures around
    var plot = $("#lxPlot"), pdrag = null;
    plot.addEventListener("pointerdown", function (e) { var g = e.target.closest("[data-fix]"); if (!g) return; pdrag = rig.fixtures.filter(function (f) { return f.id === g.dataset.fix; })[0]; plot.setPointerCapture(e.pointerId); });
    plot.addEventListener("pointermove", function (e) { if (!pdrag) return; var r = plot.getBoundingClientRect(); pdrag.x = clamp((e.clientX - r.left) / r.width, 0.03, 0.97); pdrag.y = clamp(((e.clientY - r.top) / r.height * 560 - 10) / 520, 0, 1); plot.dataset.n = ""; });
    plot.addEventListener("pointerup", function () { if (pdrag) { saveRig(); pdrag = null; } });
    // songs
    var sv = $("#lxSongs");
    sv.addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return; var t = editTarget();
      if (b.dataset.lsPick) { songSel = b.dataset.lsPick; store.set("lxSong", songSel); songEdit = null; renderSongs(); return; }
      if (b.dataset.ls === "new") { var s = { id: "cu-" + uid(), name: "New song", bpm: Math.round(song.bpm || 120), bpb: 4 }; rig.localSongs.push(s); saveRig(); songSel = s.id; songEdit = null; renderSongs(); return; }
      if (b.dataset.ls === "del") { if (!confirm("Delete this song (and its scenes)?")) return; rig.localSongs = rig.localSongs.filter(function (x) { return x.id !== songSel; }); saveRig(); songSel = null; songEdit = null; renderSongs(); return; }
      if (b.dataset.ls === "open") { showSub("show"); return; }
      if (b.dataset.ls === "program") { programSong(songSel); return; }
      if (!t) return;
      if (b.dataset.ls === "scene") { var last = t.cues.filter(function (c) { return c.kind === "look"; }).pop(), bar = last ? last.bar + 4 : 1; t.cues.push({ id: uid(), bar: bar, beat: 1, look: "worship", kind: "look", fade: 2, label: "" }); sortCues(t.cues); if (t.mode === "auto") t.mode = "manual"; t.bpm = t.bpm || (allSongs().filter(function (x) { return x.id === songSel; })[0] || {}).bpm; dirty(); saveEdit(); renderSongs(); return; }
      if (b.dataset.scDel != null) { var scenes = t.cues.filter(function (c) { return c.kind === "look" || c.kind == null; }), c2 = scenes[Number(b.dataset.scDel)]; t.cues.splice(t.cues.indexOf(c2), 1); dirty(); saveEdit(); renderSongs(); }
    });
    sv.addEventListener("change", function (e) {
      var el = e.target, t = editTarget(), s = allSongs().filter(function (x) { return x.id === songSel; })[0];
      if (el.dataset.ls === "name" || el.dataset.ls === "bpm" || el.dataset.ls === "bpb") { var ls = rig.localSongs.filter(function (x) { return x.id === songSel; })[0]; if (ls) { ls[el.dataset.ls] = el.dataset.ls === "name" ? el.value : Number(el.value); saveRig(); if (show.song === ls.id && el.dataset.ls !== "name") { song.bpm = ls.bpm; song.bpb = ls.bpb; dirty(); } renderSongs(); } return; }
      if (!t) return;
      if (el.dataset.ls === "mode") { t.mode = el.value; dirty(); saveEdit(); renderShowPanel(); return; }
      var row = el.closest("[data-sc]"); if (!row) return; var scenes = t.cues.filter(function (c) { return c.kind === "look" || c.kind == null; }), c = scenes[Number(row.dataset.sc)], k = el.dataset.scf; if (!c) return;
      if (k === "at") { var h = hub.detail[songSel], q = h && h.sections && h.sections[Number(el.value)]; if (q) { c.bar = q.bar; c.beat = 1; if (!c.label) c.label = q.name; } }
      else if (k === "look" || k === "label") c[k] = el.value; else c[k] = Number(el.value);
      sortCues(t.cues); dirty(); saveEdit(); renderSongs();
    });
    // presets editor
    $("#lxLookList").addEventListener("click", function (e) { var b = e.target.closest("[data-edit-look],[data-a]"); if (!b) return; if (b.dataset.editLook) { editLook = lookById(b.dataset.editLook); selectedLook = editLook.id; store.set("lxLook", selectedLook); } else if (b.dataset.a === "look-new") { editLook = { id: uid(), name: "New preset", swatch: "#44aaff", fade: 1, g: { front: G(0.6, WARM), back: G(0.8, BLUE) } }; rig.looks.push(editLook); saveRig(); } renderLooks(); });
    var lookEd = $("#lxLookEdit");
    function lookField(e) {
      var l = editLook, el = e.target; if (!l) return;
      if (el.dataset.lk) { if (el.dataset.lk === "flash") l.flash = el.checked; else if (el.dataset.lk === "fade") l.fade = Number(el.value); else l[el.dataset.lk] = el.value; if (el.dataset.lk === "name") $$('[data-edit-look="' + l.id + '"] span').forEach(function (s) { s.textContent = el.value; }); saveRig(); return; }
      var box = el.closest("[data-group]"); if (!box) return; var gk = box.dataset.group, f = el.dataset.lg; if (!f) return;
      if (f === "on") { if (el.checked) l.g[gk] = l.g[gk] || G(0.7, "#ffffff"); else delete l.g[gk]; saveRig(); renderLooks(); return; }
      l.g[gk] = l.g[gk] || G(0.7, "#ffffff");
      l.g[gk][f] = f === "color" || f === "color2" || f === "fx" ? el.value : Number(el.value);
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
      else if (a === "look-del") { if (confirm("Delete the preset \"" + editLook.name + "\"? Cues using it fall back to the first preset.")) { rig.looks.splice(rig.looks.indexOf(editLook), 1); editLook = null; saveRig(); renderLooks(); } }
      else if (a === "look-reset") { var orig = BUILTIN().filter(function (x) { return x.id === editLook.id; })[0]; if (orig) { rig.looks[rig.looks.indexOf(editLook)] = orig; editLook = orig; saveRig(); renderLooks(); } }
    });
    // fixtures
    fillAddProfiles(); wireLibrary();
    $("#lxAddGroup").innerHTML = GROUPS.map(function (g) { return '<option value="' + g[0] + '">' + esc(g[1]) + "</option>"; }).join("");
    $("#lxAddBtn").addEventListener("click", addFixtures);
    $("#lxAddUni").addEventListener("change", renderFixtures);
    $("#lxFixTable").addEventListener("change", function (e) {
      var row = e.target.closest("[data-fx]"), f = row && rig.fixtures.filter(function (q) { return q.id === row.dataset.fx; })[0], k = e.target.dataset.ff; if (!f || !k) return;
      if (k === "universe" || k === "address") { f[k] = clamp(Math.round(Number(e.target.value) || 1), 1, k === "address" ? 512 : 64); if (k === "universe" && !rig.outputs.some(function (o) { return o.universe === f.universe; })) rig.outputs.push({ universe: f.universe, mode: "off", path: "", host: "", offset: 0 }); }
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
    $("#lxRigSave").addEventListener("click", function () { var text = JSON.stringify({ format: "central-usage-rig", version: 2, fixtures: rig.fixtures, looks: rig.looks, outputs: rig.outputs, library: rig.library || [] }, null, 1); if (window.CU && window.CU.saveFile) window.CU.saveFile("lighting-rig.json", text); else { var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "application/json" })); a.download = "lighting-rig.json"; a.click(); } });
    $("#lxRigOpen").addEventListener("click", async function () { var text = window.CU && window.CU.openFile ? await window.CU.openFile() : null; if (!text) return; try { var j = JSON.parse(text); if (j.format !== "central-usage-rig") throw new Error("not a Central Usage rig"); rig.fixtures = j.fixtures || []; rig.looks = j.looks && j.looks.length ? j.looks : BUILTIN(); if (Array.isArray(j.outputs)) rig.outputs = j.outputs; else if (j.output) rig.outputs = [Object.assign({ universe: 1 }, j.output)]; if (j.library) rig.library = j.library; saveRig(); applyOutput(); renderAll(); } catch (err) { alert("Could not open it: " + err.message); } });
    $("#lxRigReset").addEventListener("click", function () { if (!confirm("Start again with the example rig (10 fixtures)?")) return; var keep = rig.outputs, ck = rig.click, au = rig.audio, songs = rig.localSongs; rig = defaultRig(); rig.outputs = keep; rig.click = ck; rig.audio = au; rig.localSongs = songs; saveRig(); renderAll(); });
    // outputs
    var outs = $("#lxOutputs");
    outs.addEventListener("change", function (e) { var row = e.target.closest("[data-out]"), o = row && rig.outputs[Number(row.dataset.out)], k = e.target.dataset.o; if (!o || !k) return; if (k === "universe" || k === "offset") o[k] = Number(e.target.value) || (k === "universe" ? 1 : 0); else o[k] = e.target.value.trim(); applyOutput(); });
    outs.addEventListener("click", function (e) { var b = e.target.closest('[data-o="del"]'); if (!b) return; rig.outputs.splice(Number(b.closest("[data-out]").dataset.out), 1); applyOutput(); });
    $("#lxAddOutput").addEventListener("click", function () { var max = rig.outputs.reduce(function (m, o) { return Math.max(m, o.universe); }, 0); rig.outputs.push({ universe: max + 1, mode: rig.outputs.length ? rig.outputs[rig.outputs.length - 1].mode : "artnet", path: "", host: rig.outputs.length ? rig.outputs[rig.outputs.length - 1].host : "", offset: 0 }); applyOutput(); });
    $("#lxRescan").addEventListener("click", renderOutput);
    $("#lxMonUni").addEventListener("change", function () { $("#lxMonitor").innerHTML = ""; });
    $("#lxClick").addEventListener("change", function (e) { var k = e.target.dataset.ck; if (!k) return; rig.click[k] = e.target.type === "checkbox" ? e.target.checked : e.target.type === "range" ? Number(e.target.value) : e.target.value; saveRig(); if (k === "device" || k === "output") clickCtx(); });
    $("#lxClick").addEventListener("click", function (e) { if (e.target.dataset.ck === "run") { toggleFreeClick(); renderClick(); } });
    $("#lxAudio").addEventListener("change", function (e) { var k = e.target.dataset.au; if (!k) return; rig.audio[k] = e.target.type === "checkbox" ? e.target.checked : Number(e.target.value); saveRig(); });
    setInterval(function () { if (visible() && view === "output" && DMX) DMX.status().then(function (s) { outStatus = s; $$("#lxOutputs [data-out]").forEach(function (row) { var o = rig.outputs[Number(row.dataset.out)], st = s.outputs ? s.outputs.filter(function (x) { return x.universe === o.universe; })[0] : null, span = row.querySelector("span.muted"); if (span && o.mode !== "off" && st) span.textContent = st.error ? "⚠ " + st.error : "→ " + (st.target || "") + " · " + st.frames + " frames"; }); }); }, 1500);
  }
  // songs without tracks: the click here is the transport while the Central Control isn't playing
  var localRun = false;
  function clockLocal() { localRun = true; song.pos = 0; song.at = performance.now(); song.playing = true; song.speed = 1; }
  setInterval(function () { if (localRun && !click.running) { song.pos = posNow(); song.playing = false; localRun = false; finishRecording(); renderShowPanel(); } }, 200);

  // ------------------------------------------------------------- phone remote (the page is served by the main process)
  var RM = window.CU && window.CU.remote, remoteOn = false;
  function remoteState() {
    var cue = live.state && live.state.cue;
    return { song: song.name || "", now: live.blackout ? "Blackout" : live.manual ? "Live: " + live.manual.name : !playingNow() ? "Stopped: " + lookById(rig.stopped || "walkin").name : cue ? "Show: " + lookById(cue.look).name : "Show",
      manual: !!live.manual, blackout: !!live.blackout, looks: rig.looks.map(function (l) { return { id: l.id, name: l.name, swatch: l.swatch, flash: !!l.flash, live: !!(live.manual && live.manual.id === l.id) }; }),
      faders: [{ id: "master", name: "Master", value: rig.master == null ? 1 : rig.master }].concat(GROUPS.filter(function (g) { return rig.fixtures.some(function (f) { return f.group === g[0]; }); }).map(function (g) { return { id: g[0], name: g[1], value: rig.groupLevel[g[0]] == null ? 1 : rig.groupLevel[g[0]] }; })) };
  }
  function remoteCommand(c) {
    if (c.cmd === "look" && c.id) goLook(c.id);
    else if (c.cmd === "follow") live.manual = null;
    else if (c.cmd === "blackout") live.blackout = !live.blackout;
    else if (c.cmd === "flash") { live.flash = c.on ? { look: "hit", until: performance.now() + 100000, len: 100000 } : { look: "hit", until: performance.now() + 250, len: 250 }; if (c.on) recordFlash("hit"); }
    else if (c.cmd === "fader" && c.id) { var v = clamp(Number(c.value) || 0, 0, 1); if (c.id === "master") rig.master = v; else rig.groupLevel[c.id] = v; saveRig(); if (view === "show") renderFaders(); }
    if (view === "show") renderPalette();
    if (RM) RM.state(remoteState());
  }
  async function renderRemote() {
    var el = $("#lxRemote"); if (!el) return;
    if (!RM) { el.innerHTML = '<p class="muted">The phone remote works in the Central Usage app.</p>'; return; }
    var st = await RM.status(); remoteOn = st.enabled;
    el.innerHTML = '<label class="toggle"><input type="checkbox" id="lxRmOn"' + (st.enabled ? " checked" : "") + '> Allow a phone on this Wi-Fi to run the lights</label><div class="row"><label>Port <input id="lxRmPort" type="number" min="1024" max="65535" value="' + st.port + '" style="width:90px"></label><span>Code <b class="lx-pin">' + esc(st.pin) + '</b></span><button id="lxRmPin">New code</button></div>' +
      (st.enabled ? '<p class="muted">On the phone, open ' + st.urls.map(function (u) { return "<b>" + esc(u) + "</b>"; }).join(" or ") + " and enter the code. Presets, Follow, Flash, Blackout and the faders.</p>" : "");
  }
  if (RM) {
    RM.onCommand(remoteCommand);
    RM.status().then(function (st) { remoteOn = st.enabled; });
    setInterval(function () { if (remoteOn) RM.state(remoteState()); }, 500);
    document.addEventListener("change", async function (e) { if (e.target.id === "lxRmOn" || e.target.id === "lxRmPort") { await RM.config({ enabled: $("#lxRmOn").checked, port: Number($("#lxRmPort").value) || 8091 }); renderRemote(); } });
    document.addEventListener("click", async function (e) { if (e.target.id === "lxRmPin") { await RM.config({ newPin: true, enabled: remoteOn }); renderRemote(); } });
  }

  wire(); showSub(view);
  if (DMX && outputsOn()) DMX.configure({ outputs: rig.outputs });
  CU.on("authed", hubList); CU.on("hello", hubList);
  CU.on("tab", function (t) { if (t === "lights") renderAll(); });
  window.CULights = { posNow: posNow, profileOf: profileOf, addToLibrary: addToLibrary, remoteState: remoteState, remoteCommand: remoteCommand, POSITIONS: POSITIONS, onMessage: onMessage, render: render, renderAll: renderAll, show: function () { return show; }, rig: function () { return rig; }, song: song, live: live,
    autoCues: autoCues, cuesNow: cuesNow, dirty: dirty, timeOf: timeOf, barBeatAt: barBeatAt, lookById: lookById, goLook: goLook, profiles: PROFILES, write: write, stateFor: stateFor, saveShow: saveShow, showSub: showSub, selectCue: function (c) { selectedCue = c; renderShowPanel(); },
    chat: chat, startPreview: startPreview, stopPreview: stopPreview, preview: function () { return preview; }, programSong: programSong, hub: hub, hubList: hubList, setMode: function (m) { show.mode = m; changed(); }, record: function (on) { live.rec = !!on; if (!on) finishRecording(); else if (playingNow()) rec = { from: posNow(), cues: [] }; }, recording: function () { return rec; },
    setOverride: function (id, o) { if (o) { live.over[id] = o; recordFixture(id, o); } else delete live.over[id]; }, toggleClick: toggleFreeClick, click: click };
})();
