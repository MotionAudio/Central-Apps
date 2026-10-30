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
    var onsets = [], strengths = [], last = -1e9, peakRms = 0; for (f = 0; f < frames; f++) peakRms = Math.max(peakRms, rms[f]);
    var floor = peakRms * 0.06, W = Math.max(4, Math.round(0.25 * rate / hop));
    for (f = 2; f < frames - 1; f++) {
      if (flux[f] < flux[f - 1] || flux[f] < flux[f + 1] || rms[f] < floor) continue;
      var lo = Math.max(0, f - W), hiI = Math.min(frames, f + W), m = 0; for (var k = lo; k < hiI; k++) m += flux[k]; m /= (hiI - lo);
      if (flux[f] > Math.max(0.5, m * 2.5) && (f - last) * hop / rate > 0.09) { onsets.push(f * hop / rate); strengths.push(flux[f]); last = f; }
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
    var okBpm = bpm && conf >= 0.15 ? Math.round(bpm * 10) / 10 : null, grid = okBpm ? beatGrid(onsets, strengths, okBpm) : null;
    return { duration: n / rate, overview: overview, onsets: onsets, onsetStrength: strengths.map(function (v) { return Math.round(v * 100) / 100; }), bpm: okBpm, bpmConfidence: Math.round(conf * 100) / 100,
      beatOffset: grid ? grid.offset : null, downbeatOffset: grid ? grid.downbeat : null, gridConfidence: grid ? grid.confidence : 0,
      loudness: Math.round(20 * Math.log10(1e-6 + loud) * 10) / 10, percussive: percussive };
  }

  // ------------------------------------------------------------- where the beats fall (10.0)
  // The tempo says how far apart the beats are; this finds where they are: the offset (0..one beat) that lines the
  // most onset strength up with the beats, and which of four beats is the bar's first (the one the strongest onsets
  // land on - the kick and the crash usually mark it).
  //   beatGrid(onsets [t], strengths [s] (optional), bpm) -> { offset, downbeat (s), confidence 0..1 }
  function beatGrid(onsets, strengths, bpm) {
    if (!bpm || !onsets || onsets.length < 4) return null;
    var P = 60 / bpm, sig = Math.min(0.03, P / 8), best = -1, bestPh = 0, total = 0, i;
    var w = function (k) { return strengths && strengths[k] != null ? Math.max(0.05, strengths[k]) : 1; };
    for (i = 0; i < onsets.length; i++) total += w(i);
    for (var step = 0; step < 64; step++) {
      var ph = step / 64 * P, sc = 0;
      for (i = 0; i < onsets.length; i++) { var d = ((onsets[i] - ph) % P + P) % P; d = Math.min(d, P - d); sc += w(i) * Math.exp(-0.5 * (d / sig) * (d / sig)); }
      if (sc > best) { best = sc; bestPh = ph; }
    }
    // refine: the mean of the onsets close to the grid
    var off = 0, cnt = 0;
    for (i = 0; i < onsets.length; i++) { var r = ((onsets[i] - bestPh) % P + P) % P; if (r > P / 2) r -= P; if (Math.abs(r) < P / 6) { off += r; cnt++; } }
    if (cnt) bestPh = ((bestPh + off / cnt) % P + P) % P;
    var acc = [0, 0, 0, 0];
    for (i = 0; i < onsets.length; i++) { var bi = Math.round((onsets[i] - bestPh) / P), dd = Math.abs(onsets[i] - bestPh - bi * P); if (dd < P / 6) acc[((bi % 4) + 4) % 4] += w(i); }
    var db = acc.indexOf(Math.max.apply(null, acc));
    return { offset: Math.round(bestPh * 1000) / 1000, downbeat: Math.round((bestPh + db * P) * 1000) / 1000, confidence: total ? Math.round(clamp(best / total, 0, 1) * 100) / 100 : 0 };
  }

  // ------------------------------------------------------------- live beat tracking (10.0): no timeline (a band
  // playing live, or a song with no tempo) - the onsets of the room's sound give the tempo and where the beat is.
  //   var bt = beatTracker(); bt.onset(t, strength); bt.at(t) -> { bpm, beatFrac, downbeat, confidence } | null
  function beatTracker() {
    var hist = [], P = 0, next = 0, n = 0, conf = 0, accent = [0, 0, 0, 0];
    function estimate(now) {
      var keep = hist.filter(function (o) { return now - o.t < 8; }); hist = keep; if (keep.length < 6) return 0;
      // the inter-onset intervals (up to 2 s apart), folded into 70..170 BPM, voted with a little blur
      var bins = new Float32Array(101), lo = 60 / 170, hi = 60 / 70;
      for (var i = 0; i < keep.length; i++) for (var j = i + 1; j < keep.length; j++) {
        var d = keep[j].t - keep[i].t; if (d > 2) break; if (d < 0.1) continue;
        while (d < lo) d *= 2; while (d > hi) d /= 2;
        var b = (d - lo) / (hi - lo) * 100, wgt = keep[i].s * keep[j].s;
        for (var k = Math.max(0, Math.floor(b) - 2); k <= Math.min(100, Math.ceil(b) + 2); k++) bins[k] += wgt * Math.exp(-0.5 * (k - b) * (k - b));
      }
      var top = 0, at = -1, sum = 0; for (i = 0; i <= 100; i++) { sum += bins[i]; if (bins[i] > top) { top = bins[i]; at = i; } }
      if (at < 0 || !sum) return 0;
      conf = clamp(top / sum * 6, 0, 1);
      return lo + at / 100 * (hi - lo);
    }
    return {
      onset: function (t, strength) {
        var s = strength == null ? 1 : Math.max(0.05, strength); hist.push({ t: t, s: s });
        var est = estimate(t);
        if (est) P = P ? P + (est - P) * 0.25 : est;
        if (!P) return;
        if (!next) { next = t + P; n = 0; return; }
        while (t > next + P / 2) { next += P; n++; }
        var err = t - next;   // (a phase-locked loop: onsets near the predicted beat pull it towards them)
        if (Math.abs(err) < P * 0.2) { next += err * 0.25; P += err * 0.03; accent[n % 4] = accent[n % 4] * 0.9 + s; }
      },
      at: function (t) {
        if (!P || !next) return null;
        var since = t - (next - P), frac = since / P, beatsAgo = Math.floor(frac), idx = n - 1 + beatsAgo;
        var strong = accent.indexOf(Math.max.apply(null, accent));
        return { bpm: Math.round(600 / P) / 10, beatFrac: frac - Math.floor(frac), downbeat: ((idx - strong) % 4 + 4) % 4 === 0, confidence: Math.round(conf * 100) / 100 };
      },
      reset: function () { hist = []; P = 0; next = 0; n = 0; conf = 0; accent = [0, 0, 0, 0]; }
    };
  }

  // ------------------------------------------------------------- sections from the sound alone (10.0): a song with no
  // section markers (a recording, not tracks) is split where its level changes for good - never into pieces shorter
  // than 8 bars (or 16 s) - and each piece named by how it sits in the song (quiet start = Intro, the loudest = Chorus…)
  //   segmentAudio(overview [0..1], duration, bpm) -> [{ name, start, end, type, auto: true }]
  function segmentAudio(ov, dur, bpm) {
    if (!ov || ov.length < 16 || !dur || dur < 90) return [];
    var win = bpm ? 4 * 4 * 60 / bpm : 8, nW = Math.max(4, Math.round(dur / win)), means = [];
    for (var i = 0; i < nW; i++) { var a = Math.floor(i * ov.length / nW), b = Math.max(a + 1, Math.floor((i + 1) * ov.length / nW)); means.push(mean(ov.slice(a, b))); }
    var top = Math.max.apply(null, means) || 1, diffs = []; for (i = 1; i < nW; i++) diffs.push(Math.abs(means[i] - means[i - 1]));
    var th = Math.max(0.12 * top, 1.6 * median(diffs)), cuts = [0];
    for (i = 1; i < nW; i++) if (Math.abs(means[i] - means[i - 1]) >= th) cuts.push(i);
    cuts.push(nW);
    var segs = []; for (i = 0; i + 1 < cuts.length; i++) segs.push({ a: cuts[i], b: cuts[i + 1] });
    var minW = Math.max(1, Math.ceil((bpm ? 8 * 4 * 60 / bpm : 16) / win));
    // merge the short ones into the neighbour closest in level
    var lvl = function (sg) { return mean(means.slice(sg.a, sg.b)); };
    for (var guard = 0; guard < 50; guard++) {
      var k = -1; for (i = 0; i < segs.length; i++) if (segs[i].b - segs[i].a < minW && segs.length > 1) { k = i; break; }
      if (k < 0) break;
      var left = k > 0 ? segs[k - 1] : null, right = k + 1 < segs.length ? segs[k + 1] : null, me = segs[k];
      var into = !left ? right : !right ? left : Math.abs(lvl(left) - lvl(me)) <= Math.abs(lvl(right) - lvl(me)) ? left : right;
      into.a = Math.min(into.a, me.a); into.b = Math.max(into.b, me.b); segs.splice(k, 1);
    }
    if (segs.length < 2) return [];
    var levels = segs.map(lvl), sorted = levels.slice().sort(function (x, y) { return x - y; }), lo3 = sorted[Math.floor((sorted.length - 1) / 3)], hi3 = sorted[Math.ceil((sorted.length - 1) * 2 / 3)];
    var counts = {}, med2 = median(levels);
    return segs.map(function (sg, j) {
      var L = levels[j], type;
      if (j === 0 && L <= med2) type = "intro";
      else if (j === segs.length - 1 && L <= med2) type = "outro";
      else if (L >= hi3 && L > lo3) type = "chorus";
      else if (L <= lo3) type = j > segs.length / 2 && j > 1 ? "bridge" : "verse";
      else type = j + 1 < segs.length && levels[j + 1] > L ? "prechorus" : "verse";
      var base = { intro: "Intro", outro: "Outro", chorus: "Chorus", verse: "Verse", bridge: "Bridge", prechorus: "Build" }[type];
      counts[base] = (counts[base] || 0) + 1;
      return { name: base + (type === "verse" || type === "chorus" ? " " + counts[base] : ""), start: Math.round(sg.a / nW * dur * 100) / 100, end: Math.round(sg.b / nW * dur * 100) / 100, type: type, auto: true };
    });
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
    var fromAudio = false;
    if (!secs.length) { secs = segmentAudio(ov, dur, bpm); fromAudio = secs.length > 0; if (fromAudio) why.push("sections found in the sound"); }
    if (!secs.length) secs = [{ name: "Song", start: 0, end: dur || 1, type: "other" }];
    var lvlRaw = secs.map(function (s) { var r = ovRange(s.start, s.end); return r.length ? mean(r) : null; });
    // (10.0) how busy each section is (onsets or drum hits a second) joins its level - but only when it changes
    // through the song (a steady kick from start to end says nothing about which part is bigger)
    var evs = events.slice().sort(function (x, y) { return x - y; }), dens = secs.map(function (s) {
      if (!evs.length) return null; var c = 0; for (var q = 0; q < evs.length; q++) if (evs[q] >= s.start && evs[q] < s.end) c++; return c / Math.max(1, s.end - s.start);
    });
    var dHave = dens.filter(function (x) { return x != null; }), dTop = dHave.length ? Math.max.apply(null, dHave) : 0, dMean = mean(dHave);
    var dSd = dHave.length ? Math.sqrt(mean(dHave.map(function (x) { return (x - dMean) * (x - dMean); }))) : 0, useDens = dTop > 0 && dMean > 0 && dSd / dMean > 0.15;
    var lTop = Math.max.apply(null, lvlRaw.filter(function (x) { return x != null; }).concat([0]));
    var raw = lvlRaw.map(function (v, i) { if (v == null) return null; return useDens ? 0.7 * v / (lTop || 1) + 0.3 * (dens[i] || 0) / dTop : v; });
    if (useDens) why.push("busier parts lit bigger");
    var have = raw.filter(function (x) { return x != null; });
    var top = have.length ? Math.max.apply(null, have) : 0, med = have.length ? median(have) / (top || 1) : 0.5;
    // (10.0) the words: a section with sung lines keeps the faces up; one with none is an instrumental moment
    var words = (song.words || song.lyrics || []).map(function (w) { return w && w.t != null ? w.t : w && w.beat != null && bpm ? w.beat * 60 / bpm : null; }).filter(function (t) { return t != null; });
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
      var sung = words.length ? words.some(function (t) { return t >= s.start && t < s.end; }) : null;
      return { name: s.name, start: s.start, end: s.end, type: s.type, energy: Math.round(clamp(e, 0, 1) * 100) / 100, trend: trend, dropAfter: !!drop, detected: det, style: STYLES.indexOf(ov2) >= 0 ? ov2 : det, overridden: STYLES.indexOf(ov2) >= 0,
        sung: sung, instrumental: sung === false, auto: !!s.auto };
    });
    // (10.0) the song's shape: each chorus a little bigger than the last; the last full one is the peak; a chorus
    // sung quietly after the bridge (a "down chorus") is lit like a quiet moment
    var big = out.filter(function (x) { return x.type === "chorus" || x.type === "tag"; });
    if (big.length) {
      var bigE = mean(big.map(function (x) { return x.energy; }));
      big.forEach(function (x, k) {
        if (big.length >= 3 && x.energy < bigE * 0.6) { x.down = true; if (!x.overridden) { var si2 = STYLES.indexOf(x.style); x.style = STYLES[Math.max(0, si2 - 1, STYLES.indexOf(style) - 1)]; } return; }
        x.energy = Math.round(clamp(x.energy + 0.04 * k, 0, 1) * 100) / 100;
      });
      var full = big.filter(function (x) { return !x.down; }), maxE = Math.max.apply(null, full.map(function (x) { return x.energy; }).concat([0]));
      for (var pk = full.length - 1; pk >= 0; pk--) if (full[pk].energy >= maxE * 0.9) { full[pk].peak = true; break; }
    }
    return { style: style, detected: detected, overridden: style !== detected, score: Math.round(score * 100) / 100, why: why, bpm: bpm, key: key ? key.name : "", dynamics: Math.round(dyn * 100) / 100, hasDrums: hasDrums, palette: paletteFor(key, style), sections: out, sectionsFromAudio: fromAudio };
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
  function lookFor(sec, a, i, rs) {
    var P = a.palette, st = sec.style, e = sec.energy, t = sec.type, big = (t === "chorus" || t === "tag") && !sec.down, quiet = t === "breakdown" || t === "intro" || t === "outro" || !!sec.down, peak = !!sec.peak && st !== "intimate";
    var main = t === "bridge" ? P.accent : quiet ? (st === "upbeat" ? P.main : P.deep) : P.main, second = t === "bridge" ? P.main : P.accent;
    var lvl = st === "intimate" ? 0.3 + 0.4 * e : st === "mid" ? 0.4 + 0.5 * e : 0.5 + 0.5 * e;
    var g = {}, k = {};
    // front: faces always lit (a little brighter when it's big; never dark in a quiet moment)
    g.front = G(st === "intimate" ? 0.55 + 0.1 * e : st === "mid" ? 0.65 + 0.15 * e : 0.75 + 0.2 * e, P.face, { w: st === "upbeat" ? 0.25 : 0.1 });
    // (10.0) words being sung: faces a touch brighter; an instrumental part lets the colour carry it (faces never below half)
    if (sec.sung) g.front.dim = Math.round(clamp(g.front.dim + 0.05, 0, 1) * 100) / 100;
    else if (sec.instrumental && !quiet) { g.front.dim = Math.round(Math.max(0.5, g.front.dim - 0.12) * 100) / 100; lvl = clamp(lvl + 0.1, 0, 1); }
    // washes / pars at the back: the colour
    if (st === "intimate") g.back = G(lvl, main, { a: 0.25, fx: "breathe", speed: big ? 4 : 8, size: 0.25 });
    else if (st === "mid") g.back = G(lvl, main, big ? { fx: "pulse", speed: 1, size: 0.3 } : { fx: "breathe", speed: 4, size: 0.3 });
    else g.back = G(lvl, main, big ? { fx: "alternate", color2: second, speed: 1, size: 0.6 } : quiet ? { fx: "breathe", speed: 2, size: 0.4 } : { fx: "pulse", speed: 1, size: 0.45 });
    // movers: over the stage when it's soft, out over the room only when it's big
    if (st === "intimate") k.mover = G(0.25 + 0.25 * e, quiet ? P.deep : second, { fx: "sweep", speed: 16, size: 0.25, tilt: 0.3, fan: 0.35 });
    else if (st === "mid") k.mover = G(0.4 + 0.4 * e, big ? "#ffffff" : second, { w: big ? 0.6 : 0, fx: big ? "circle" : "sweep", speed: big ? 4 : 8, size: 0.35, tilt: big ? 0.5 : 0.35, fan: 0.5 });
    else k.mover = G(0.55 + 0.45 * e, big ? "#ffffff" : second, { w: big ? 1 : 0, fx: big ? "ballyhoo" : quiet ? "tiltwave" : "circle", speed: big ? 2 : 4, size: big ? 0.65 : 0.4, tilt: big ? 0.55 : 0.4, fan: 0.6 });
    // (10.0) the song's peak: the movers go out over the room and fan wide, a mid song gets its one big moment
    if (peak) { k.mover.tilt = Math.max(k.mover.tilt, 0.58); k.mover.fan = 0.75; k.mover.dim = 1; if (st === "mid") { k.mover.fx = "ballyhoo"; k.mover.speed = 4; } }
    // pixel bars: their own effects along the cells
    if (st === "intimate") k.bar = G(0.2 + 0.35 * e, main, { a: 0.2, fx: big ? "wipe" : "breathe", color2: P.deep, speed: big ? 8 : 8, size: big ? 0.6 : 0.3 });
    else if (st === "mid") k.bar = G(0.35 + 0.5 * e, main, { fx: big ? "wipe" : t === "bridge" ? "sparkle" : "bounce", color2: second, speed: big ? 2 : 4, size: 0.6 });
    else k.bar = G(0.5 + 0.5 * e, main, { fx: big ? "chase" : quiet ? "sparkle" : "bounce", color2: second, speed: big ? 0.5 : 1, size: 0.8 });
    // the room: the house lights and the blinders warm it in intimate moments; dark in an upbeat chorus
    g.house = G(st === "intimate" ? (quiet ? 0.25 : 0.18) : st === "mid" ? 0.1 : 0.05, P.warm);
    k.blinder = G(st === "intimate" && (big || t === "bridge") ? 0.18 : st === "mid" && big ? (peak ? 0.22 : 0.1) : peak ? 0.15 : 0, "#ffc78a");
    // strobes: off in every look (they only fire on big hits in upbeat songs: the hit looks below)
    k.strobe = G(0, "#ffffff");
    g.fx = G(0, "#ffffff");
    // beam group lights that aren't movers (pars aimed up, beam bars): the second colour
    g.beam = G(0.3 + 0.5 * e * (st === "intimate" ? 0.6 : 1), second, st === "upbeat" ? { fx: big ? "chase" : "pulse", speed: big ? 0.5 : 1, size: 0.6 } : { fx: "breathe", speed: 8, size: 0.25 });
    g.haze = G(st === "intimate" ? 0.25 : st === "mid" ? 0.32 : 0.42);
    var fade = st === "intimate" ? (big ? 4 : 6) : st === "mid" ? 2 : (big || sec.trend === "build" ? 0.5 : 1);
    var prev = i > 0 ? a.sections[i - 1] : null;
    if (prev && prev.dropAfter && st !== "intimate") fade = 0;   // (after a drop: straight in - but never a snap into something soft)
    // (10.0) out of a build into the peak: on the downbeat, no fade; down from something big into something soft: a
    // short settle (a beat) rather than a snap, so it never looks like a mistake
    if (peak && prev && prev.trend === "build" && st === "upbeat") fade = 0;
    else if (prev && prev.energy - e > 0.35 && fade < 1 && st !== "upbeat") fade = 1;
    var lk = { g: g, k: k };
    if (rs) fitRig(lk, rs, st, big, P, second);
    return { id: "", name: (sec.name || "Section") + " · " + STYLE_NAME[st] + (peak ? " · peak" : ""), swatch: main, fade: fade, g: g, k: k, auto: true, style: st, energy: e, trend: sec.trend, peak: peak || undefined };
  }
  // (10.0) every rig is different: what's missing gets its job done by what's there
  //   rs = rigSummary(rig): { groups: { front: n… }, kinds: { mover: n, bar: n… } }
  function fitRig(lk, rs, st, big, P, second) {
    var gr = rs.groups || {}, kd = rs.kinds || {}, g = lk.g;
    // no front lights: the washes carry a little warm white so the people on stage are never in the dark
    if (!gr.front && g.back) { g.back.w = Math.max(g.back.w || 0, st === "upbeat" ? 0.1 : 0.22); g.back.dim = Math.max(g.back.dim, 0.45); }
    // no movers and no pixel bars: the movement lives on the washes (an alternating chase in the big parts)
    if (!kd.mover && !kd.bar && big && g.back && st !== "intimate") { g.back.fx = "alternate"; g.back.color2 = g.back.color2 || second; g.back.speed = st === "upbeat" ? 1 : 2; }
    // lots of washes: two colours across them in the big parts, so the stage has depth
    if ((gr.back || 0) >= 4 && big && g.back && g.back.fx !== "alternate" && st === "mid") { g.back.fx = "alternate"; g.back.color2 = second; g.back.speed = 2; }
    // no beam lights and no movers: nothing to do there; no house lights: the blinders warm the room in quiet worship
    if (!gr.house && kd.blinder && lk.k.blinder && st === "intimate") lk.k.blinder.dim = Math.max(lk.k.blinder.dim, 0.12);
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
      kick: { name: "Kick", swatch: P.main, flash: true, soft: true, g: { back: G(1, P.main) }, k: { bar: G(1, P.accent) } },
      // (10.0) the breath before the peak: everything but the faces drops for half a beat, then the chorus lands
      dip: { name: "Dip", swatch: "#101010", flash: true, soft: true, g: { back: G(0.06, P.deep), beam: G(0, P.deep), front: G(0.5, P.face) }, k: { bar: G(0, P.deep), mover: G(0.05, P.deep) } }
    };
  }
  // analysis -> the looks and which section uses which
  function buildLooks(a, prefix, rig) {
    prefix = prefix || "auto";
    var rs = rig ? (rig.kinds || rig.groups ? rig : rigSummary(rig)) : null;
    var looks = {}, sections = a.sections.map(function (s, i) { var l = lookFor(s, a, i, rs); l.id = prefix + ":s" + i; looks[l.id] = l; return { start: s.start, look: l.id }; });
    var fl = flashLooks(a); Object.keys(fl).forEach(function (k) { fl[k].id = prefix + ":" + k; fl[k].auto = true; looks[fl[k].id] = fl[k]; });
    return { looks: looks, sections: sections, flash: { swell: prefix + ":swell", soft: prefix + ":soft", hit: prefix + ":hit", kick: prefix + ":kick", dip: prefix + ":dip" } };
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
    // (10.0) the peak after a build lands harder after a breath: half a beat of dark just before it (upbeat songs)
    a.sections.forEach(function (s, i) {
      var prev = a.sections[i - 1]; if (!s.peak || !prev || prev.trend !== "build" || s.style !== "upbeat" || !built.flash.dip) return;
      var bb = barBeatAt(Math.max(0, s.start - beatLen * 0.5)); out.push({ id: "auto-dip-" + i, bar: bb.bar, beat: bb.beat, look: built.flash.dip, fade: 0, kind: "flash", dur: 0.45, auto: true, label: "Dip" });
    });
    return safeFlashes(out, beatLen);
  }

  // ------------------------------------------------------------- safety (10.0): flashing light can trigger seizures in
  // people with photosensitive epilepsy. The usual broadcast limit is no more than 3 flashes a second, so the automatic
  // show never flashes faster than that: flash cues closer than a third of a second keep only the most important one
  // (a hit, then a crash or a swell, then a kick), strobes never run faster than 3 a second, and a strobe burst lasts
  // 2 seconds at most with 8 seconds before the next. "Safe strobes" (on by default) holds the hand-programmed ones to
  // the same limits.
  var SAFE = { maxHz: 3, minGap: 1 / 3, burstMax: 2, burstRest: 8 };
  var PRIORITY = { Hit: 4, Dip: 4, Crash: 3, Swell: 3, Kick: 1 };
  function safeFlashes(list, beatLen) {
    var flashes = [], rest = [];
    list.forEach(function (c) { (c.kind === "flash" ? flashes : rest).push(c); });
    var at = function (c) { return ((c.bar - 1) * 4 + (c.beat - 1)) * beatLen; };
    var kept = [];
    flashes.slice().sort(function (x, y) { return (PRIORITY[y.label] || 2) - (PRIORITY[x.label] || 2) || at(x) - at(y); }).forEach(function (c) {
      var t = at(c); if (kept.some(function (k) { return Math.abs(at(k) - t) < SAFE.minGap - 1e-6; })) return; kept.push(c);
    });
    kept.sort(function (x, y) { return at(x) - at(y); });
    return rest.concat(kept);
  }
  // a strobe's rate in flashes a second, held to the safe limit when safe is on
  function safeHz(hz, safe) { return safe === false ? hz : Math.min(hz, SAFE.maxHz); }
  // strobing (a burst on a hit, the Strobe button held): may it go on? Asked every frame while it strobes; after 2 s of
  // strobing without a break it rests for 8 s (state kept by the caller between frames; burstStop when it stops)
  function burstAllowed(state, now, safe) {
    if (safe === false) return true;
    if (state.on != null && now - state.on < SAFE.burstMax * 1000) return true;
    if (state.on != null) { state.restUntil = state.on + (SAFE.burstMax + SAFE.burstRest) * 1000; state.on = null; }
    if (state.restUntil != null && now < state.restUntil) return false;
    state.on = now; return true;
  }
  // strobing stopped by itself (the hit's burst ended) before the limit: no rest needed
  function burstStop(state) { if (state.on != null) state.on = null; }
  // a flash from the live music (no timeline): not closer than a third of a second to the last one (half a second
  // when it's Mid), whatever the room's sound is doing
  function flashGate(state, now, style) {
    var gap = (style === "mid" ? 0.5 : SAFE.minGap) * 1000;
    if (state.last != null && now - state.last < gap) return false;
    state.last = now; return true;
  }

  // ------------------------------------------------------------- the live layer: each frame, from the music
  // ctx: { style, energy, trend, progress (0..1 through the section), level (0..1, null = no audio), beatFrac (0..1
  //        through the beat), downbeat (bool), state (kept between frames) }
  // -> { front, back, beam, house, haze, fx, bar, mover, blinder, strobe } level multipliers (1 = as the look says)
  var LIVE = {
    intimate: { follow: 0.25, tau: 1.2, faces: 0.1, beat: 0, build: 0.15, slew: 0.6 },
    mid: { follow: 0.4, tau: 0.35, faces: 0.15, beat: 0.12, build: 0.25, slew: 2.5 },
    upbeat: { follow: 0.55, tau: 0.1, faces: 0.2, beat: 0.25, build: 0.35, slew: 8 }
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
    // (10.0) no flicker: each part moves no faster than the feel's own speed (the beat's bump is the music, and kept),
    // and changes smaller than 1% are left alone
    var slew = L.slew * dt, prev = s.out || null, keys = Object.keys(out);
    if (prev) for (var q = 0; q < keys.length; q++) {
      var key = keys[q], want = out[key], was = prev[key] == null ? want : prev[key];
      if (Math.abs(want - was) < 0.01) { out[key] = was; continue; }
      var lim = key === "back" || key === "bar" ? slew + L.beat * 2 : slew;
      out[key] = Math.round((was + clamp(want - was, -lim, lim)) * 1000) / 1000;
    }
    s.out = Object.assign({}, out);
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
    beatGrid: beatGrid, beatTracker: beatTracker, segmentAudio: segmentAudio, safeFlashes: safeFlashes, safeHz: safeHz, burstAllowed: burstAllowed, burstStop: burstStop, flashGate: flashGate, SAFE: SAFE,
    parseKey: parseKey, typeOfSection: typeOfSection, STYLES: STYLES, STYLE_NAME: STYLE_NAME, paletteFor: paletteFor };
});
