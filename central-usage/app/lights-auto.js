/* Central Control - Lighting, the smart Auto: each song is listened to (its tempo, key, how loud each section is,
 * how busy the drums are, where it builds and drops), sorted into a feel - Intimate, Mid or Upbeat - and lit for it:
 *   Intimate  warm, soft, slow fades, faces lit, movers drifting slowly over the stage, no strobes, no white flashes
 *   Mid       colour washes, gentle movement, pulses on the beat, soft hits
 *   Upbeat    saturated colours, movement, chases locked to the beat, white hits and strobe bursts on the big ones
 * Every light in the rig gets a job: front lights keep faces lit, washes and pars carry the colour, pixel bars run
 * their effects, movers aim at the stage (or sweep the room when it's loud), blinders warm the room in quiet worship
 * and hit on the big moments, strobes only on big hits in upbeat songs, haze always.
 * Then, while it plays, a live layer follows the music: the level breathes the lights, upbeat songs pulse on the beat,
 * builds rise to the next section. No internet, no model: the same song always gets the same show.
 *   CULightsAuto.analyseAudio(samples, rate)        -> { duration, overview, onsets, bpm, loudness }  (raw audio)
 *   CULightsAuto.analyse(song, overrides)           -> { style, score, why, palette, sections: [{ start, end, name, type, energy, trend, style }] }
 *   CULightsAuto.buildLooks(analysis, rig)          -> { looks: { id: look }, sections: [{ start, look }] , flashes: {...} }
 *   CULightsAuto.cues(analysis, built, song, barBeatAt) -> automatic cues (looks per section + hits, by feel)
 *   CULightsAuto.liveMod(ctx)                       -> per light-kind level multipliers for this frame
 * Runs in the app (window.CULightsAuto) and in Node (tests). */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CULightsAuto = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function mean(a) { if (!a.length) return 0; var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return s / a.length; }
  function median(a) { if (!a.length) return 0; var s = a.slice().sort(function (x, y) { return x - y; }); var m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
  function pct(a, p) { if (!a.length) return 0; var s = a.slice().sort(function (x, y) { return x - y; }); return s[clamp(Math.round(p * (s.length - 1)), 0, s.length - 1)]; }

  var STYLES = ["intimate", "mid", "upbeat"];
  var STYLE_NAME = { intimate: "Intimate", mid: "Mid", upbeat: "Upbeat" };
  function typeOfSection(name) {
    var n = String(name || "").toLowerCase();
    if (/pre ?chorus|build|lift|climb/.test(n)) return "prechorus"; if (/chorus|refrain|hook/.test(n)) return "chorus"; if (/verse/.test(n)) return "verse"; if (/bridge/.test(n)) return "bridge";
    if (/tag|vamp/.test(n)) return "tag"; if (/intro|count|walk/.test(n)) return "intro"; if (/outro|ending|end|coda/.test(n)) return "outro"; if (/instrumental|interlude|turn ?around|solo/.test(n)) return "instrumental";
    if (/breakdown|break|down|quiet/.test(n)) return "breakdown"; return "other";
  }

  // ------------------------------------------------------------- raw audio: the envelope, the onsets, the tempo
  // samples: mono Float32Array (or a plain array), rate in Hz. Frames of ~23 ms (1024 at 44.1 kHz, hop half that).
  function analyseAudio(samples, rate) {
    rate = rate || 44100;
    var n = samples.length, hop = Math.max(64, Math.round(rate * 0.0116)), win = hop * 2, frames = Math.max(1, Math.floor((n - win) / hop) + 1);
    var rms = new Float32Array(frames), hi = new Float32Array(frames), prev = 0;
    for (var f = 0; f < frames; f++) {
      var s = 0, d = 0, o = f * hop;
      for (var i = 0; i < win && o + i < n; i++) { var x = samples[o + i]; s += x * x; var dx = x - prev; d += dx * dx; prev = x; }
      rms[f] = Math.sqrt(s / win); hi[f] = Math.sqrt(d / win);   // (the difference brings out the clicks of drums over a pad's slow swell)
    }
    // onset strength: how much the (log) level jumps over the last ~35 ms - a third from the whole sound, two thirds
    // from its bright part (drums click; a pad's slow swell and its notes beating against each other don't)
    var flux = new Float32Array(frames), quiet = 1e-3;
    for (f = 3; f < frames; f++) {
      var pr = Math.max(rms[f - 1], rms[f - 2], rms[f - 3]), ph = Math.max(hi[f - 1], hi[f - 2], hi[f - 3]);
      var a = Math.log(quiet + rms[f]) - Math.log(quiet + pr), b = Math.log(quiet + hi[f]) - Math.log(quiet + ph);
      flux[f] = Math.max(0, a) / 3 + Math.max(0, b) * 2 / 3;
    }
    // the onsets: a peak above the local average, loud enough to be heard, at least 90 ms after the last
    var onsets = [], last = -1e9, peakRms = 0; for (f = 0; f < frames; f++) peakRms = Math.max(peakRms, rms[f]);
    var floor = peakRms * 0.06, W = Math.max(4, Math.round(0.25 * rate / hop));
    for (f = 2; f < frames - 1; f++) {
      if (flux[f] < flux[f - 1] || flux[f] < flux[f + 1] || rms[f] < floor) continue;
      var lo = Math.max(0, f - W), hiI = Math.min(frames, f + W), m = 0; for (var k = lo; k < hiI; k++) m += flux[k]; m /= (hiI - lo);
      if (flux[f] > Math.max(0.5, m * 2.5) && (f - last) * hop / rate > 0.09) { onsets.push(f * hop / rate); last = f; }
    }
    // the tempo: the onset strength's autocorrelation between 60 and 180 BPM (the strongest beat period, with its
    // half and double as a check), only when there are enough onsets to say
    var bpm = null, conf = 0;
    if (onsets.length >= 8) {
      var minLag = Math.round(60 / 180 * rate / hop), maxLag = Math.round(60 / 60 * rate / hop), best = -1, bestLag = 0, ac = {};
      var e = new Float32Array(frames); var mu = mean(Array.prototype.slice.call(flux)); for (f = 0; f < frames; f++) e[f] = flux[f] - mu;
      var energy = 0; for (f = 0; f < frames; f++) energy += e[f] * e[f];
      for (var lag = minLag; lag <= maxLag; lag++) {
        var c = 0; for (f = 0; f + lag < frames; f++) c += e[f] * e[f + lag];
        c /= Math.max(1, frames - lag); ac[lag] = c;
      }
      for (lag = minLag; lag <= maxLag; lag++) {
        // (tempos near 120 are the likelier reading of a pulse that would also fit half or double: a gentle weight,
        // an octave away counts about two thirds)
        var bpmAt = 60 / (lag * hop / rate), w = Math.exp(-0.5 * Math.pow(Math.log2(bpmAt / 120) / 1.1, 2)), score = Math.max(0, ac[lag]) * w;
        if (score > best) { best = score; bestLag = lag; }
      }
      if (bestLag) {
        // refine between frames (parabola through the neighbours)
        var y0 = ac[bestLag - 1] != null ? ac[bestLag - 1] : ac[bestLag], y1 = ac[bestLag], y2 = ac[bestLag + 1] != null ? ac[bestLag + 1] : ac[bestLag];
        var den = y0 - 2 * y1 + y2, off = den ? clamp(0.5 * (y0 - y2) / den, -0.5, 0.5) : 0;
        // a pulse twice as fast that's nearly as strong (a kick on every beat under a snare on 2 and 4) is the beat
        var h2 = Math.round(bestLag / 2); if (h2 >= minLag && ac[h2] != null && ac[h2] >= 0.5 * ac[bestLag] && 60 / (h2 * hop / rate) <= 160) { bestLag = h2; off = 0; }
        bpm = 60 / ((bestLag + off) * hop / rate);
        while (bpm < 70) bpm *= 2; while (bpm > 170) bpm /= 2;
        conf = energy > 0 ? clamp(ac[bestLag] / (energy / frames), 0, 1) : 0;
      }
    }
    // the overview: 480 bins of the level over the song (like the Central Pedal's waveform)
    var bins = 480, overview = [];
    for (var bI = 0; bI < bins; bI++) { var fa = Math.floor(bI * frames / bins), fb = Math.max(fa + 1, Math.floor((bI + 1) * frames / bins)), mx = 0; for (f = fa; f < fb && f < frames; f++) mx = Math.max(mx, rms[f] * 1.41); overview.push(Math.round(clamp(mx, 0, 1) * 1000) / 1000); }
    var loud = mean(Array.prototype.slice.call(rms));
    var perSec = onsets.length / Math.max(1, n / rate), percussive = perSec >= 1.2 && conf >= 0.25;
    return { duration: n / rate, overview: overview, onsets: onsets, bpm: bpm && conf >= 0.15 ? Math.round(bpm * 10) / 10 : null, bpmConfidence: Math.round(conf * 100) / 100, loudness: Math.round(20 * Math.log10(1e-6 + loud) * 10) / 10, percussive: percussive };
  }

  // ------------------------------------------------------------- a song -> its feel and its sections' energy
  var KEYS = { c: 0, "b#": 0, "c#": 7, db: 7, d: 2, "d#": 9, eb: 9, e: 4, fb: 4, f: 11, "e#": 11, "f#": 6, gb: 6, g: 1, "g#": 8, ab: 8, a: 3, "a#": 10, bb: 10, b: 5, cb: 5 };
  function parseKey(k) {
    var m = String(k || "").trim().match(/^([A-Ga-g])([#b♯♭]?)\s*(m(?!aj)|min|minor)?/);
    if (!m) return null;
    var name = (m[1] + (m[2] || "").replace("♯", "#").replace("♭", "b")).toLowerCase(), fifths = KEYS[name];
    if (fifths == null) return null;
    return { fifths: fifths, minor: !!m[3], name: m[1].toUpperCase() + (m[2] || "") + (m[3] ? "m" : "") };
  }
  var TYPE_BIAS = { intro: -0.45, verse: -0.3, prechorus: 0.15, chorus: 0.45, bridge: -0.1, tag: 0.3, instrumental: 0.1, breakdown: -0.8, outro: -0.5, other: 0 };
  function styleOfScore(s) { return s <= -0.45 ? "intimate" : s >= 0.45 ? "upbeat" : "mid"; }
  // song: { bpm, key, duration, sections: [{ name, start, end, type }], overview: [0..1 × N over the song], hits: [t],
  //         drumHits: { kick, snare, hat, crash }, stems: [{ role }], onsets: [t] (from analyseAudio), loudness (dBFS) }
  // overrides: { song: "auto" | "intimate" | "mid" | "upbeat", sections: { "<start>": style } }
  function analyse(song, overrides) {
    song = song || {}; overrides = overrides || {};
    var dur = song.duration || 0, ov = song.overview || [], bpm = song.bpm || null, why = [];
    if (!dur && ov.length) dur = ov.length;   // (no length: the overview's bins are the clock)
    function ovRange(a, b) { if (!ov.length || !dur) return []; var i0 = Math.floor(clamp(a / dur, 0, 1) * ov.length), i1 = Math.max(i0 + 1, Math.ceil(clamp(b / dur, 0, 1) * ov.length)); return ov.slice(i0, i1); }
    var dh = song.drumHits || {}, drumCount = ["kick", "snare", "hat", "crash"].reduce(function (a, k) { return a + ((dh[k] || []).length); }, 0);
    var hasDrums = drumCount > 0 || !!song.percussive || (song.stems || []).some(function (s) { return /drum|kit|perc|loop/i.test((s.role || "") + " " + (s.name || "")); });
    // the rhythm: the audio's onsets or the drum hits (the song's big hits are moments, not the groove). Only when the
    // song was listened to (audio, or its drums split out) does "no beat" or "no drums" count against it.
    var listened = song.loudness != null || drumCount > 0 || (song.stems || []).length > 0;
    var events = (song.onsets && song.onsets.length ? song.onsets : []).concat(dh.kick || [], dh.snare || []);
    var beats = bpm && dur ? dur * bpm / 60 : 0, density = beats && (events.length || song.loudness != null) ? events.length / beats : null;
    // the song's score: below zero leans intimate, above leans upbeat
    var score = 0, n = 0;
    if (bpm) { var tb = clamp((bpm - 96) / 28, -1, 1); score += tb * 1.5; n++; why.push(Math.round(bpm) + " BPM"); }
    if (density != null && events.length) { score += clamp((density - 1.2) / 1.0, -1, 1); n++; why.push(density > 1.6 ? "busy drums" : density > 0.6 ? "steady beat" : "few hits"); }
    else if (density != null) { score -= 0.6; n++; why.push("no beat found"); }
    var lvl = ov.length ? mean(ov) : null, dyn = ov.length ? pct(ov, 0.9) - pct(ov, 0.2) : 0;
    if (song.loudness != null) { score += clamp((song.loudness + 20) / 10, -1, 1) * 0.8; n++; why.push(song.loudness > -16 ? "loud" : song.loudness < -26 ? "quiet" : "medium level"); }
    else if (lvl != null) { score += clamp((lvl - 0.32) / 0.22, -1, 1) * 0.3; n++; }   // (a waveform's level says little: most tracks are mastered loud)
    if (hasDrums) { score += 0.3; why.push("drums"); } else if (listened) { score -= 0.35; why.push("no drums"); }
    var key = parseKey(song.key); if (key && key.minor) { score -= 0.15; why.push("minor key"); }
    score = n ? score / Math.max(1.6, n * 0.8) : 0;
    var detected = styleOfScore(score), style = STYLES.indexOf(overrides.song) >= 0 ? overrides.song : detected;
    // the sections: their energy (how loud against the song's loudest section), their trend (builds and drops)
    var secs = (song.sections || []).filter(function (s) { return s && (s.end == null || s.end > s.start); }).map(function (s, i, all) { return { name: s.name || "", start: s.start || 0, end: s.end != null ? s.end : (all[i + 1] ? all[i + 1].start : dur), type: s.type || typeOfSection(s.name) }; });
    if (!secs.length) secs = [{ name: "Song", start: 0, end: dur || 1, type: "other" }];
    var raw = secs.map(function (s) { var r = ovRange(s.start, s.end); return r.length ? mean(r) : null; }), have = raw.filter(function (x) { return x != null; });
    var top = have.length ? Math.max.apply(null, have) : 0, med = have.length ? median(have) / (top || 1) : 0.5;
    var styleScore = { intimate: -0.9, mid: 0, upbeat: 0.9 }[style];
    var out = secs.map(function (s, i) {
      var e = raw[i] != null && top > 0 ? raw[i] / top : 0.5 + TYPE_BIAS[s.type] * 0.4;
      var r = ovRange(s.start, s.end), trend = "steady";
      if (r.length >= 6) { var third = Math.max(1, Math.floor(r.length / 3)), a = mean(r.slice(0, third)), b = mean(r.slice(-third)); if (top > 0 && (b - a) / top > 0.12) trend = "build"; else if (top > 0 && (a - b) / top > 0.15) trend = "fade"; }
      if (s.type === "prechorus" && trend === "steady") trend = "build";
      var next = raw[i + 1], drop = next != null && raw[i] != null && top > 0 && (raw[i] - next) / top > 0.3;
      var sScore = styleScore * 0.75 + (e - med) * 1.4 + TYPE_BIAS[s.type] * 0.5;
      var det = styleOfScore(sScore);
      // a section never jumps two steps from its song (an intimate song's chorus is Mid at most; an upbeat song's
      // verse is Mid at least)
      var si = STYLES.indexOf(style), di = STYLES.indexOf(det); if (Math.abs(di - si) > 1) det = STYLES[si + (di > si ? 1 : -1)];
      var ov2 = overrides.sections && overrides.sections[String(Math.round(s.start * 1000) / 1000)];
      return { name: s.name, start: s.start, end: s.end, type: s.type, energy: Math.round(clamp(e, 0, 1) * 100) / 100, trend: trend, dropAfter: !!drop, detected: det, style: STYLES.indexOf(ov2) >= 0 ? ov2 : det, overridden: STYLES.indexOf(ov2) >= 0 };
    });
    return { style: style, detected: detected, overridden: style !== detected, score: Math.round(score * 100) / 100, why: why, bpm: bpm, key: key ? key.name : "", dynamics: Math.round(dyn * 100) / 100, hasDrums: hasDrums, palette: paletteFor(key, style), sections: out };
  }

  // ------------------------------------------------------------- colours: the song's key picks its palette (the same
  // song always looks the same; songs next to each other in a set usually differ), the feel picks the family
  var PALETTES = {
    intimate: [{ main: "#ff9a4a", accent: "#4a63ff", deep: "#1a2a9a" }, { main: "#ffb36b", accent: "#9a7bff", deep: "#3a1f8a" }, { main: "#ff8a5c", accent: "#3a8cff", deep: "#0a3a8a" }, { main: "#ffc078", accent: "#ff6f9a", deep: "#7a1a4a" }],
    mid: [{ main: "#1f4dff", accent: "#8a2bff", deep: "#0a1fb0" }, { main: "#00a8ff", accent: "#1f4dff", deep: "#06338a" }, { main: "#7a2bff", accent: "#ff4f9a", deep: "#3a0a8a" }, { main: "#00c8a0", accent: "#1f6dff", deep: "#004a5a" }],
    upbeat: [{ main: "#ff1a5a", accent: "#00d8ff", deep: "#5a0aa0" }, { main: "#8a2bff", accent: "#ff7a00", deep: "#2a0a8a" }, { main: "#ff2a10", accent: "#ffb000", deep: "#8a0a1a" }, { main: "#00e0ff", accent: "#ff1ad8", deep: "#0a1fb0" }]
  };
  function paletteFor(key, style) {
    var fam = PALETTES[style] || PALETTES.mid, i = key ? (key.fifths + (key.minor ? 2 : 0)) % fam.length : 0;
    return { main: fam[i].main, accent: fam[i].accent, deep: fam[i].deep, warm: "#ffc78a", face: style === "upbeat" ? "#ffe2c0" : "#ffcf9a" };
  }

  // ------------------------------------------------------------- the looks: one per section, for every kind of light
  function G(dim, color, o) { var g = { dim: Math.round(clamp(dim, 0, 1) * 100) / 100, color: color || "#ffffff", w: 0, a: 0, uv: 0, strobe: 0, fx: "none", speed: 1, size: 0.6, pan: 0.5, tilt: 0.5 }; for (var k in o || {}) g[k] = o[k]; return g; }
  // what the rig has: { groups: { front: n, … }, kinds: { mover: n, bar: n, strobe: n, blinder: n, haze: n, par: n } }
  function rigSummary(rig) {
    var groups = {}, kinds = {}; (rig && rig.fixtures || []).forEach(function (f) { groups[f.group] = (groups[f.group] || 0) + 1; var k = f.kind || "par"; kinds[k] = (kinds[k] || 0) + 1; });
    return { groups: groups, kinds: kinds };
  }
  function lookFor(sec, a, i) {
    var P = a.palette, st = sec.style, e = sec.energy, t = sec.type, big = t === "chorus" || t === "tag", quiet = t === "breakdown" || t === "intro" || t === "outro";
    var main = t === "bridge" ? P.accent : quiet ? (st === "upbeat" ? P.main : P.deep) : P.main, second = t === "bridge" ? P.main : P.accent;
    var lvl = st === "intimate" ? 0.3 + 0.4 * e : st === "mid" ? 0.4 + 0.5 * e : 0.5 + 0.5 * e;
    var g = {}, k = {};
    // front: faces always lit (a little brighter when it's big; never dark in a quiet moment)
    g.front = G(st === "intimate" ? 0.55 + 0.1 * e : st === "mid" ? 0.65 + 0.15 * e : 0.75 + 0.2 * e, P.face, { w: st === "upbeat" ? 0.25 : 0.1 });
    // washes / pars at the back: the colour
    if (st === "intimate") g.back = G(lvl, main, { a: 0.25, fx: "breathe", speed: big ? 4 : 8, size: 0.25 });
    else if (st === "mid") g.back = G(lvl, main, big ? { fx: "pulse", speed: 1, size: 0.3 } : { fx: "breathe", speed: 4, size: 0.3 });
    else g.back = G(lvl, main, big ? { fx: "alternate", color2: second, speed: 1, size: 0.6 } : quiet ? { fx: "breathe", speed: 2, size: 0.4 } : { fx: "pulse", speed: 1, size: 0.45 });
    // movers: over the stage when it's soft, out over the room only when it's big
    if (st === "intimate") k.mover = G(0.25 + 0.25 * e, quiet ? P.deep : second, { fx: "sweep", speed: 16, size: 0.25, tilt: 0.3, fan: 0.35 });
    else if (st === "mid") k.mover = G(0.4 + 0.4 * e, big ? "#ffffff" : second, { w: big ? 0.6 : 0, fx: big ? "circle" : "sweep", speed: big ? 4 : 8, size: 0.35, tilt: big ? 0.5 : 0.35, fan: 0.5 });
    else k.mover = G(0.55 + 0.45 * e, big ? "#ffffff" : second, { w: big ? 1 : 0, fx: big ? "ballyhoo" : quiet ? "tiltwave" : "circle", speed: big ? 2 : 4, size: big ? 0.65 : 0.4, tilt: big ? 0.55 : 0.4, fan: 0.6 });
    // pixel bars: their own effects along the cells
    if (st === "intimate") k.bar = G(0.2 + 0.35 * e, main, { a: 0.2, fx: big ? "wipe" : "breathe", color2: P.deep, speed: big ? 8 : 8, size: big ? 0.6 : 0.3 });
    else if (st === "mid") k.bar = G(0.35 + 0.5 * e, main, { fx: big ? "wipe" : t === "bridge" ? "sparkle" : "bounce", color2: second, speed: big ? 2 : 4, size: 0.6 });
    else k.bar = G(0.5 + 0.5 * e, main, { fx: big ? "chase" : quiet ? "sparkle" : "bounce", color2: second, speed: big ? 0.5 : 1, size: 0.8 });
    // the room: the house lights and the blinders warm it in intimate moments; dark in an upbeat chorus
    g.house = G(st === "intimate" ? (quiet ? 0.25 : 0.18) : st === "mid" ? 0.1 : 0.05, P.warm);
    k.blinder = G(st === "intimate" && (big || t === "bridge") ? 0.18 : st === "mid" && big ? 0.1 : 0, "#ffc78a");
    // strobes: off in every look (they only fire on big hits in upbeat songs: the hit looks below)
    k.strobe = G(0, "#ffffff");
    g.fx = G(0, "#ffffff");
    // beam group lights that aren't movers (pars aimed up, beam bars): the second colour
    g.beam = G(0.3 + 0.5 * e * (st === "intimate" ? 0.6 : 1), second, st === "upbeat" ? { fx: big ? "chase" : "pulse", speed: big ? 0.5 : 1, size: 0.6 } : { fx: "breathe", speed: 8, size: 0.25 });
    g.haze = G(st === "intimate" ? 0.25 : st === "mid" ? 0.32 : 0.42);
    var fade = st === "intimate" ? (big ? 4 : 6) : st === "mid" ? 2 : (big || sec.trend === "build" ? 0.5 : 1);
    if (i > 0 && a.sections[i - 1].dropAfter && st !== "intimate") fade = 0;   // (after a drop: straight in - but never a snap into something soft)
    return { id: "", name: (sec.name || "Section") + " · " + STYLE_NAME[st], swatch: main, fade: fade, g: g, k: k, auto: true, style: st, energy: e, trend: sec.trend };
  }
  function flashLooks(a) {
    var P = a.palette;
    return {
      // intimate: a hit is a warm swell, never white
      swell: { name: "Swell", swatch: P.warm, flash: true, soft: true, g: { front: G(0.8, P.face, { w: 0.1 }), back: G(0.9, P.main, { a: 0.3 }), beam: G(0.5, P.accent) }, k: { bar: G(0.7, P.main), mover: G(0.5, P.accent, { tilt: 0.3 }) } },
      // mid: a bright hit, no strobes, no blinders
      soft: { name: "Hit", swatch: "#ffffff", flash: true, soft: true, g: { front: G(0.95, P.face, { w: 0.3 }), back: G(1, "#ffffff", { w: 0.6 }), beam: G(1, "#ffffff", { w: 1 }) }, k: { bar: G(1, "#ffffff", { w: 1 }), mover: G(1, "#ffffff", { w: 1, tilt: 0.5 }) } },
      // upbeat: everything white, the blinders hit (and the strobes burst)
      hit: { name: "Hit", swatch: "#ffffff", flash: true, g: { front: G(1, "#ffffff", { w: 1 }), back: G(1, "#ffffff", { w: 1 }), beam: G(1, "#ffffff", { w: 1 }), fx: G(1, "#ffffff", { w: 1 }), house: G(0.4, "#ffffff") }, k: { bar: G(1, "#ffffff", { w: 1 }), mover: G(1, "#ffffff", { w: 1, tilt: 0.55 }), blinder: G(1, "#ffffff"), strobe: G(1, "#ffffff", { w: 1, strobe: 0.8 }) } },
      // upbeat: the kick bumps the colour on the bars and washes (not white)
      kick: { name: "Kick", swatch: P.main, flash: true, soft: true, g: { back: G(1, P.main) }, k: { bar: G(1, P.accent) } }
    };
  }
  // analysis -> the looks and which section uses which
  function buildLooks(a, prefix) {
    prefix = prefix || "auto";
    var looks = {}, sections = a.sections.map(function (s, i) { var l = lookFor(s, a, i); l.id = prefix + ":s" + i; looks[l.id] = l; return { start: s.start, look: l.id }; });
    var fl = flashLooks(a); Object.keys(fl).forEach(function (k) { fl[k].id = prefix + ":" + k; fl[k].auto = true; looks[fl[k].id] = fl[k]; });
    return { looks: looks, sections: sections, flash: { swell: prefix + ":swell", soft: prefix + ":soft", hit: prefix + ":hit", kick: prefix + ":kick" } };
  }
  // the automatic cues: each section's look at its first bar, and the hits as the feel allows
  //   barBeatAt(t) -> { bar, beat }; beatLen in seconds
  function cues(a, built, song, barBeatAt) {
    var out = [], beatLen = 60 / (song.bpm || a.bpm || 100), dh = song.drumHits || {};
    a.sections.forEach(function (s, i) {
      var bb = barBeatAt(s.start), l = built.looks[built.sections[i].look];
      out.push({ id: "auto-" + s.start, bar: Math.max(1, Math.round(bb.bar)), beat: 1, look: l.id, fade: l.fade, kind: "look", auto: true, label: s.name, style: s.style });
    });
    var last = a.sections[a.sections.length - 1];
    if (last && song.duration) { var end = barBeatAt(Math.max(0, (last.end || song.duration) - 0.01)); out.push({ id: "auto-end", bar: end.bar + 1, beat: 1, look: "blackout", fade: a.style === "upbeat" ? 1 : 4, kind: "look", auto: true, label: "End" }); }
    function secAt(t) { for (var i = a.sections.length - 1; i >= 0; i--) if (t >= a.sections[i].start - 1e-3) return a.sections[i]; return a.sections[0]; }
    function nearSection(t) { return a.sections.some(function (s) { return Math.abs(s.start - t) < beatLen * 0.75; }); }
    var lastSwell = -1e9;
    (song.hits || []).forEach(function (h, k) {
      var s = secAt(h); if (nearSection(h)) return;
      var bb = barBeatAt(h), cue = { id: "auto-hit-" + k, bar: bb.bar, beat: bb.beat, fade: 0, kind: "flash", auto: true, label: "Hit" };
      // (an intimate song: swells only, even in its bigger sections)
      if (s.style === "intimate" || a.style === "intimate") { if (h - lastSwell < beatLen * 16) return; lastSwell = h; cue.look = built.flash.swell; cue.dur = 4; cue.label = "Swell"; }
      else if (s.style === "mid") { cue.look = built.flash.soft; cue.dur = 0.5; }
      else { cue.look = built.flash.hit; cue.dur = 0.5; }
      out.push(cue);
    });
    // the drums: crashes hit in upbeat sections (soft in mid ones), kicks bump the colour in big upbeat sections only
    (dh.crash || []).forEach(function (h, k) {
      var s = secAt(h); if (s.style === "intimate" || a.style === "intimate" || nearSection(h)) return;
      if ((song.hits || []).some(function (x) { return Math.abs(x - h) < 0.12; })) return;
      var bb = barBeatAt(h); out.push({ id: "auto-crash-" + k, bar: bb.bar, beat: bb.beat, look: s.style === "upbeat" && s.energy >= 0.6 ? built.flash.hit : built.flash.soft, fade: 0, kind: "flash", dur: 0.5, auto: true, label: "Crash", drum: "crash" });
    });
    (dh.kick || []).forEach(function (h, k) {
      var s = secAt(h); if (s.style !== "upbeat" || s.energy < 0.7) return;
      var bb = barBeatAt(h); out.push({ id: "auto-kick-" + k, bar: bb.bar, beat: bb.beat, look: built.flash.kick, fade: 0, kind: "flash", dur: 0.25, auto: true, label: "Kick", drum: "kick" });
    });
    return out;
  }

  // ------------------------------------------------------------- the live layer: each frame, from the music
  // ctx: { style, energy, trend, progress (0..1 through the section), level (0..1, null = no audio), beatFrac (0..1
  //        through the beat), downbeat (bool), state (kept between frames) }
  // -> { front, back, beam, house, haze, fx, bar, mover, blinder, strobe } level multipliers (1 = as the look says)
  var LIVE = {
    intimate: { follow: 0.25, tau: 1.2, faces: 0.1, beat: 0, build: 0.15 },
    mid: { follow: 0.4, tau: 0.35, faces: 0.15, beat: 0.12, build: 0.25 },
    upbeat: { follow: 0.55, tau: 0.1, faces: 0.2, beat: 0.25, build: 0.35 }
  };
  function liveMod(ctx) {
    var L = LIVE[ctx.style] || LIVE.mid, s = ctx.state || {}, dt = ctx.dt || 0.025, out = { front: 1, back: 1, beam: 1, house: 1, haze: 1, fx: 1, bar: 1, mover: 1, blinder: 1, strobe: 1 };
    // the level, smoothed by the feel (slow and gentle when intimate, quick when upbeat)
    if (ctx.level != null) {
      var k = 1 - Math.exp(-dt / L.tau); s.level = s.level == null ? ctx.level : s.level + (ctx.level - s.level) * k;
      var m = (1 - L.follow) + L.follow * (0.3 + 0.7 * clamp(s.level, 0, 1));
      out.back = out.beam = out.bar = out.mover = m; out.front = (1 - L.faces) + L.faces * (0.5 + 0.5 * clamp(s.level, 0, 1));
    }
    // the beat: a bump on each beat (upbeat), on the bar's first beat (mid); nothing when intimate
    if (L.beat > 0 && ctx.beatFrac != null && ctx.playing) {
      var bump = Math.exp(-ctx.beatFrac * 6), amt = ctx.style === "mid" ? (ctx.downbeat ? L.beat : 0) : L.beat;
      if (amt) { var b = (1 - amt) + amt * bump; out.back *= b; out.bar *= b; }
    }
    // a build: the lights rise through it to the next section
    if (ctx.trend === "build" && ctx.progress != null) { var r = (1 - L.build) + L.build * clamp(ctx.progress, 0, 1); out.back *= r; out.beam *= r; out.bar *= r; out.mover *= r; }
    ctx.state = s;
    return out;
  }
  // the onsets of live audio (no hits on the timeline): what kind of flash, if any
  function onsetFlash(style, energy) { return style === "intimate" ? null : style === "mid" ? "soft" : energy >= 0.55 ? "hit" : "soft"; }

  // which part of a look a light follows: its kind's (movers, pixel bars, strobes, blinders - wherever they hang),
  // else its group's. Front and house lights always follow their group (a bar used as a front light stays a face light).
  var KIND_PARTS = { mover: 1, bar: 1, strobe: 1, blinder: 1 };
  function partFor(look, group, kind) {
    if (!look) return null;
    if (look.k && KIND_PARTS[kind] && look.k[kind] && group !== "front" && group !== "house") return look.k[kind];
    return look.g ? look.g[group] || null : null;
  }
  return { partFor: partFor, analyseAudio: analyseAudio, analyse: analyse, buildLooks: buildLooks, cues: cues, liveMod: liveMod, onsetFlash: onsetFlash, rigSummary: rigSummary,
    parseKey: parseKey, typeOfSection: typeOfSection, STYLES: STYLES, STYLE_NAME: STYLE_NAME, paletteFor: paletteFor };
});
