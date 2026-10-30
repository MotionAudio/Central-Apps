/* Central Pedal (PC) / Central Control - lyrics heard in the vocal track, and the lyric chart they make.
 *   PPLyricsAI.available()                   true on a PC app (the speech model runs there, not on the Pi)
 *   PPLyricsAI.listen(mono, rate, progress)  -> [{ text, start, end }] (seconds): only the stretches where
 *                                           someone sings are sent to the model (vocal tracks are mostly quiet)
 *   PPLyricsAI.chartFromWords(words, opts)   -> a ChordPro chart: sections, lines split at breaths, the chords
 *                                           placed on the word they land on; bars of chords where nobody sings */
(function (global) {
  "use strict";
  function api() { return (global.CCDesktop && global.CCDesktop.asr) || (global.CU && global.CU.asr) || null; }
  function available() { return !!api(); }

  // 16 kHz mono (what the model wants)
  function to16k(mono, rate) {
    if (rate === 16000) return mono;
    var n = Math.floor(mono.length * 16000 / rate), out = new Float32Array(n), r = rate / 16000;
    // a little low-pass before dropping samples (average over the step)
    for (var i = 0; i < n; i++) { var a = i * r, s = 0, c = 0; for (var k = Math.floor(a); k < Math.min(mono.length, Math.floor(a + r) + 1); k++) { s += mono[k]; c++; } out[i] = c ? s / c : 0; }
    return out;
  }
  // where someone sings: 50 ms loudness against the loud parts, joined across short breaths, padded
  function voiced(x, rate, opts) {
    opts = opts || {}; var win = Math.round(rate * 0.05), n = Math.floor(x.length / win), rms = new Float32Array(n), max = 0;
    for (var i = 0; i < n; i++) { var s = 0; for (var k = i * win; k < (i + 1) * win; k++) s += x[k] * x[k]; rms[i] = Math.sqrt(s / win); }
    var sorted = Array.from(rms).sort(function (a, b) { return a - b; }); max = sorted[Math.floor(sorted.length * 0.98)] || sorted[sorted.length - 1] || 0;
    var thr = Math.max(max * (opts.level || 0.08), 1e-4), regions = [], cur = null, gap = (opts.join || 1.5) / 0.05, pad = (opts.pad || 0.35);
    for (i = 0; i < n; i++) {
      if (rms[i] > thr) { if (cur && i - cur.end <= gap) cur.end = i; else { cur = { start: i, end: i }; regions.push(cur); } }
    }
    var out = [], maxLen = opts.maxLen || 28;
    regions.forEach(function (r) {
      var a = Math.max(0, r.start * 0.05 - pad), b = Math.min(x.length / rate, (r.end + 1) * 0.05 + pad);
      if (b - a < 0.4) return;
      for (var t = a; t < b; t += maxLen) out.push({ start: t, end: Math.min(b, t + maxLen) });
    });
    return out;
  }
  async function listen(mono, rate, progress) {
    var A = api(); if (!A) throw new Error("Lyrics are heard on a computer (Central Control or Central Pedal on a PC).");
    var x = to16k(mono, rate), parts = voiced(x, 16000), words = [];
    if (!parts.length) return words;
    var total = parts.reduce(function (a, p) { return a + p.end - p.start; }, 0), done = 0;
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i], pcm = x.slice(Math.floor(p.start * 16000), Math.floor(p.end * 16000));
      if (progress) progress("Listening… " + Math.round(done / total * 100) + "%", done / total);
      var r = await A.run({ pcm: pcm, offset: p.start });
      if (!r || !r.ok) throw new Error((r && r.error) || "the speech model did not answer");
      r.words.forEach(function (w) { if (!words.length || w.start >= words[words.length - 1].start - 0.05) words.push(w); });
      done += p.end - p.start;
    }
    if (progress) progress("Listening… 100%", 1);
    return words;
  }

  // ---------------------------------------------------------------- the lyric chart
  function clean(t) { return String(t || "").replace(/\s+/g, " ").trim(); }
  // what the speech model hears that isn't a sung word: [Music], (applause), ♪, and the sign-offs it makes up in
  // quiet stretches ("Thank you for watching")
  var NOT_WORDS = /^(\[[^\]]*\]|\([^)]*\)|♪+|♫+|\*+[^*]*\*+|-+)$/;
  var MADE_UP = /^(thank you( so much)?( for watching)?|thanks for watching|please subscribe|subtitles by.*|transcribed by.*|amara\.org.*)[.!]*$/i;
  function tidyWords(words) {
    var out = [];
    (words || []).forEach(function (w) {
      var text = clean(w && w.text).replace(/^["“”]+|["“”]+$/g, "");
      if (!text || NOT_WORDS.test(text)) return;
      text = text.replace(/\bi\b/g, "I").replace(/\bi'(m|ll|ve|d)\b/gi, function (m, x) { return "I'" + x.toLowerCase(); });
      var prev = out[out.length - 1];
      // the same word twice in a row, almost at once, is the model stuttering (a held "Holy, holy" is further apart)
      if (prev && prev.text.toLowerCase().replace(/[^a-z']/g, "") === text.toLowerCase().replace(/[^a-z']/g, "") && w.start - (prev.end || prev.start) < 0.12) { prev.end = Math.max(prev.end || prev.start, w.end || w.start); return; }
      out.push({ text: text, start: w.start, end: w.end == null ? w.start + 0.3 : w.end });
    });
    // a made-up sign-off spread over a few words
    for (var i = 0; i < out.length; i++) { for (var n = 6; n >= 2; n--) { if (i + n > out.length) continue; var phrase = out.slice(i, i + n).map(function (x) { return x.text; }).join(" "); if (MADE_UP.test(phrase)) { out.splice(i, n); i--; break; } } }
    return out.filter(function (w) { return !MADE_UP.test(w.text); });
  }
  function capFirst(line) { return line.replace(/^(\W*)([a-z])/, function (m, a, b) { return a + b.toUpperCase(); }); }
  function chartFromWords(words, opts) {
    opts = opts || {}; words = tidyWords(words);
    var bars = (opts.bars || []).slice().sort(function (a, b) { return a - b; });   // bar start times (s): lines like to start on a bar
    function nearBar(t) { for (var k = 0; k < bars.length; k++) { if (Math.abs(bars[k] - t) < 0.22) return true; if (bars[k] > t + 0.3) break; } return false; }
    var secs = (opts.sections || []).slice().sort(function (a, b) { return a.start - b.start; });
    if (!secs.length || secs[0].start > (words[0] ? words[0].start : 0) + 0.5) secs.unshift({ name: secs.length ? "Intro" : "Verse 1", start: 0 });
    var chords = (opts.chords || []).filter(function (c) { return c.label && c.label !== "N"; }).slice().sort(function (a, b) { return a.start - b.start; });
    // a chord that only flickers past (shorter than minChord seconds, default a little under half a second) isn't written
    var minChord = opts.minChord != null ? opts.minChord : 0.45;
    chords = chords.filter(function (c, k) { var end = c.end != null ? c.end : (chords[k + 1] ? chords[k + 1].start : c.start + 2); return end - c.start >= minChord || chords.length === 1; })
      .filter(function (c, k, all) { var p = all[k - 1]; return !p || label(p) !== label(c); });
    var Ch = global.PPChords, flats = Ch && opts.key ? Ch.keyPrefersFlats(opts.key) : false;
    function spell(c) { var l = label(c); if (!Ch) return l; var o = Ch.parse(l); return o ? Ch.format(o, flats) : l; }
    var lines = ["{title: " + (opts.title || "Untitled") + "}"]; if (opts.key) lines.push("{key: " + opts.key + "}"); lines.push("");
    secs.forEach(function (sec, si) {
      var end = si + 1 < secs.length ? secs[si + 1].start : Infinity;
      var ws = words.filter(function (w) { return w.start >= sec.start - 0.05 && w.start < end - 0.05; });
      var cs = chords.filter(function (c) { return c.start >= sec.start - 0.1 && c.start < end - 0.1; });
      lines.push("[" + sec.name + "]");
      if (!ws.length) { if (cs.length) lines.push("| " + cs.map(spell).join(" | ") + " |"); lines.push(""); return; }
      // phrases: break at a breath (gap), or when a line gets long
      var phrases = [], cur = [];
      ws.forEach(function (w, i) {
        var prev = ws[i - 1], gapS = prev ? w.start - (prev.end || prev.start) : 0;
        // a new line: at a breath, at a pause that falls on a bar line once the line has a few words, or when it gets long
        if (cur.length && (gapS > 0.9 || (cur.length >= 4 && gapS > 0.35 && nearBar(w.start)) || (cur.length >= 8 && gapS > 0.3) || cur.length >= 12)) { phrases.push(cur); cur = []; }
        cur.push({ text: clean(w.text), start: w.start, end: w.end, chords: [] });
      });
      if (cur.length) phrases.push(cur);
      // each chord lands on the first word sung at or after it (within the same phrase), else on the next phrase's first word
      var before = [];   // chords before any word in the section: an intro bar line
      cs.forEach(function (c) {
        var target = null, best = Infinity, flat = [];   // the word sung closest to the chord, from just before it on (words are in time order)
        phrases.forEach(function (ph) { ph.forEach(function (w) { flat.push(w); }); });
        for (var k = 0; k < flat.length; k++) { var w = flat[k]; if (w.start < c.start - 0.25) continue; var d = Math.abs(w.start - c.start); if (d < best) { best = d; target = w; } else break; }
        if (!target) { var lastP = phrases[phrases.length - 1]; target = lastP[lastP.length - 1]; target.after = (target.after || []).concat([c]); return; }
        if (phrases[0][0] === target && c.start < target.start - 2.5) before.push(c); else target.chords.push(c);
      });
      if (before.length) lines.push("| " + before.map(spell).join(" | ") + " |");
      phrases.forEach(function (ph) {
        lines.push(capFirst(ph.map(function (w) { var lead = w.chords.length ? w.chords.map(function (c) { return "[" + spell(c) + "]"; }).join("") : ""; var tail = w.after ? " " + w.after.map(function (c) { return "[" + spell(c) + "]"; }).join("") : ""; return lead + w.text + tail; }).join(" ")).replace(/^((?:\[[^\]]*\])*)(\W*)([a-z])/, function (m, a, b, c) { return a + b + c.toUpperCase(); }));
      });
      lines.push("");
    });
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  }
  function label(c) { return c.label + (c.bass && String(c.label).indexOf("/") < 0 ? "/" + c.bass : ""); }

  var out = { available: available, listen: listen, voiced: voiced, to16k: to16k, chartFromWords: chartFromWords, tidyWords: tidyWords, api: api };
  global.PPLyricsAI = out;
  if (typeof module !== "undefined" && module.exports) module.exports = out;
})(typeof window !== "undefined" ? window : globalThis);
