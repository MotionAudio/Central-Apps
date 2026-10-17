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
  function chartFromWords(words, opts) {
    opts = opts || {}; words = (words || []).filter(function (w) { return clean(w.text); });
    var secs = (opts.sections || []).slice().sort(function (a, b) { return a.start - b.start; });
    if (!secs.length || secs[0].start > (words[0] ? words[0].start : 0) + 0.5) secs.unshift({ name: secs.length ? "Intro" : "Verse 1", start: 0 });
    var chords = (opts.chords || []).filter(function (c) { return c.label && c.label !== "N"; }).slice().sort(function (a, b) { return a.start - b.start; });
    var lines = ["{title: " + (opts.title || "Untitled") + "}"]; if (opts.key) lines.push("{key: " + opts.key + "}"); lines.push("");
    secs.forEach(function (sec, si) {
      var end = si + 1 < secs.length ? secs[si + 1].start : Infinity;
      var ws = words.filter(function (w) { return w.start >= sec.start - 0.05 && w.start < end - 0.05; });
      var cs = chords.filter(function (c) { return c.start >= sec.start - 0.1 && c.start < end - 0.1; });
      lines.push("[" + sec.name + "]");
      if (!ws.length) { if (cs.length) lines.push("| " + cs.map(function (c) { return label(c); }).join(" | ") + " |"); lines.push(""); return; }
      // phrases: break at a breath (gap), or when a line gets long
      var phrases = [], cur = [];
      ws.forEach(function (w, i) {
        var prev = ws[i - 1], gapS = prev ? w.start - (prev.end || prev.start) : 0;
        if (cur.length && (gapS > 0.9 || (cur.length >= 8 && gapS > 0.3) || cur.length >= 12)) { phrases.push(cur); cur = []; }
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
      if (before.length) lines.push("| " + before.map(label).join(" | ") + " |");
      phrases.forEach(function (ph) {
        lines.push(ph.map(function (w) { var lead = w.chords.length ? w.chords.map(function (c) { return "[" + label(c) + "]"; }).join("") : ""; var tail = w.after ? " " + w.after.map(function (c) { return "[" + label(c) + "]"; }).join("") : ""; return lead + w.text + tail; }).join(" "));
      });
      lines.push("");
    });
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
  }
  function label(c) { return c.label + (c.bass && String(c.label).indexOf("/") < 0 ? "/" + c.bass : ""); }

  var out = { available: available, listen: listen, voiced: voiced, to16k: to16k, chartFromWords: chartFromWords, api: api };
  global.PPLyricsAI = out;
  if (typeof module !== "undefined" && module.exports) module.exports = out;
})(typeof window !== "undefined" ? window : globalThis);
