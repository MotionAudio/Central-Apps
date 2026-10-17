/* Central Control - sheet music from a stem: standard notation (SVG), guitar /
 * bass tab (SVG), piano roll (canvas, follows the playhead) and Nashville
 * numbers, plus the "Sheet music" dialog that transcribes a stem and shows them.
 * The renderers (PPNotation.*) only need the note list, so Central Usage can reuse them. */
(function (global) {
  "use strict";
  var C = global.PPChords;
  var LETTERS = ["C", "D", "E", "F", "G", "A", "B"], LETTER_PC = [0, 2, 4, 5, 7, 9, 11];
  var SHARP_ORDER = ["F", "C", "G", "D", "A", "E", "B"], FLAT_ORDER = ["B", "E", "A", "D", "G", "C", "F"];
  var KEY_SIGS = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, "F#": 6, "C#": 7, F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7 };
  var MINOR_TO_MAJOR = { Am: "C", Em: "G", Bm: "D", "F#m": "A", "C#m": "E", "G#m": "B", "D#m": "F#", Dm: "F", Gm: "Bb", Cm: "Eb", Fm: "Ab", Bbm: "Db", Ebm: "Gb", "A#m": "F#" };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function keySig(key) { key = String(key || "C").replace(/♯/g, "#").replace(/♭/g, "b"); if (MINOR_TO_MAJOR[key]) key = MINOR_TO_MAJOR[key]; if (KEY_SIGS[key] == null) { var alt = { "A#": "Bb", "D#": "Eb", "G#": "Ab", "C#": "Db" }[key]; key = alt || "C"; } return KEY_SIGS[key] || 0; }
  // spell a midi note in a key: letter index 0-6, accidental -1/0/1, octave
  function spell(midi, sig) {
    var pc = ((midi % 12) + 12) % 12, oct = Math.floor(midi / 12) - 1, li = LETTER_PC.indexOf(pc);
    if (li >= 0) return { letter: li, acc: 0, oct: oct };
    if (sig >= 0) { li = LETTER_PC.indexOf(pc - 1); return { letter: li, acc: 1, oct: oct }; }
    li = LETTER_PC.indexOf((pc + 1) % 12); return { letter: li, acc: -1, oct: pc === 11 ? oct + 1 : oct };
  }
  function sigAccidentals(sig) { var m = {}; if (sig > 0) SHARP_ORDER.slice(0, sig).forEach(function (l) { m[l] = 1; }); else if (sig < 0) FLAT_ORDER.slice(0, -sig).forEach(function (l) { m[l] = -1; }); return m; }
  // duration (beats, quarter = 1) -> list of [symbolBeats, dots]
  var SYMBOLS = [[4, 0], [3, 1], [2, 0], [1.5, 1], [1, 0], [0.75, 1], [0.5, 0], [0.25, 0]];
  function splitDuration(d) { var out = [], left = Math.round(d * 4) / 4; var guard = 0; while (left > 1e-6 && guard++ < 16) { var pick = SYMBOLS.filter(function (s) { return s[0] <= left + 1e-6; })[0] || [0.25, 0]; out.push({ beats: pick[0], dots: pick[1] }); left = Math.round((left - pick[0]) * 4) / 4; } return out; }

  // ---------------------------------------------------------------- layout shared by notation + tab
  function layout(notes, opts) {
    var bpb = opts.beatsPerBar || 4, startBar = 0, totalBeats = 0;
    notes.forEach(function (n) { totalBeats = Math.max(totalBeats, n.start + n.dur); });
    var bars = Math.max(1, opts.minBars || 1, Math.ceil((totalBeats - 1e-6) / bpb)), perLine = opts.barsPerLine || 4, beatW = opts.beatWidth || 34, pad = 16;
    var measures = [];
    for (var b = 0; b < bars; b++) {
      // events in this bar, split at the bar line with ties
      var ms = b * bpb, me = ms + bpb, groups = {};
      notes.forEach(function (n) {
        var s = n.start, e = n.start + n.dur; if (e <= ms + 1e-6 || s >= me - 1e-6) return;
        var cs = Math.max(s, ms), ce = Math.min(e, me), key = Math.round((cs - ms) * 4) + ":" + Math.round((ce - cs) * 4);
        (groups[key] = groups[key] || { at: cs - ms, dur: ce - cs, midis: [], tieIn: s < ms - 1e-6, tieOut: e > me + 1e-6, vel: n.vel || 90 }).midis.push(n.midi);
      });
      var events = Object.keys(groups).map(function (k) { return groups[k]; }).sort(function (p, q) { return p.at - q.at || p.dur - q.dur; });
      // rests: gaps between the end of the previous event (longest) and the next start
      var items = [], cursor = 0;
      events.forEach(function (ev) {
        if (ev.at > cursor + 1e-6) splitDuration(ev.at - cursor).forEach(function (d) { items.push({ rest: true, at: cursor, dur: d.beats, dots: d.dots }); cursor += d.beats; });
        var parts = splitDuration(ev.dur), at = ev.at;
        parts.forEach(function (d, i) { items.push({ at: at, dur: d.beats, dots: d.dots, midis: ev.midis.slice().sort(function (x, y) { return x - y; }), tieIn: i === 0 ? ev.tieIn : true, tieOut: i < parts.length - 1 ? true : ev.tieOut, vel: ev.vel }); at += d.beats; });
        cursor = Math.max(cursor, ev.at + ev.dur);
      });
      if (cursor < bpb - 1e-6) splitDuration(bpb - cursor).forEach(function (d) { items.push({ rest: true, at: cursor, dur: d.beats, dots: d.dots }); cursor += d.beats; });
      if (!events.length) items = [{ rest: true, at: 0, dur: bpb, dots: 0, whole: true }];
      measures.push({ index: b, items: items, width: bpb * beatW + pad });
    }
    var lines = []; for (var i = 0; i < measures.length; i += perLine) lines.push(measures.slice(i, i + perLine));
    return { measures: measures, lines: lines, beatW: beatW, pad: pad, bpb: bpb, startBar: startBar };
  }

  // ---------------------------------------------------------------- standard notation
  function clefPath(kind, x, y, S) { // x = left edge, y = top staff line, S = line spacing
    function P(px, py) { return (x + px * S).toFixed(1) + " " + (y + py * S).toFixed(1); }
    if (kind === "bass") return '<path class="n-glyphs" fill="none" stroke-width="' + (0.32 * S) + '" stroke-linecap="round" d="M' + P(0.55, 1.45) + ' C' + P(0.55, 0.25) + ' ' + P(1.55, -0.15) + ' ' + P(2.25, 0.1) + ' C' + P(3.25, 0.45) + ' ' + P(3.3, 1.7) + ' ' + P(2.55, 2.5) + ' C' + P(2.05, 3.05) + ' ' + P(1.45, 3.55) + ' ' + P(0.75, 4.0) + '"/><circle class="n-glyph" cx="' + (x + 0.78 * S) + '" cy="' + (y + 1.45 * S) + '" r="' + (0.3 * S) + '"/><circle class="n-glyph" cx="' + (x + 3.55 * S) + '" cy="' + (y + 0.5 * S) + '" r="' + (0.22 * S) + '"/><circle class="n-glyph" cx="' + (x + 3.55 * S) + '" cy="' + (y + 1.5 * S) + '" r="' + (0.22 * S) + '"/>';
    return '<path class="n-glyphs" fill="none" stroke-width="' + (0.26 * S) + '" stroke-linecap="round" stroke-linejoin="round" d="M' + P(2.35, 5.6) + ' C' + P(2.4, 6.45) + ' ' + P(1.15, 6.5) + ' ' + P(1.2, 5.85) + ' M' + P(2.35, 5.6) + ' L' + P(2.35, -1.6) + ' C' + P(2.35, -2.7) + ' ' + P(3.45, -2.2) + ' ' + P(3.15, -1.05) + ' C' + P(2.85, 0.0) + ' ' + P(1.15, 1.15) + ' ' + P(1.0, 2.35) + ' C' + P(0.9, 3.35) + ' ' + P(1.9, 4.0) + ' ' + P(2.75, 3.65) + ' C' + P(3.5, 3.3) + ' ' + P(3.35, 2.15) + ' ' + P(2.5, 2.0) + ' C' + P(1.75, 1.9) + ' ' + P(1.35, 2.55) + ' ' + P(1.75, 2.95) + '"/><circle class="n-glyph" cx="' + (x + 1.5 * S) + '" cy="' + (y + 5.85 * S) + '" r="' + (0.3 * S) + '"/>';
  }
  function accidentalPath(kind, x, y, S) { // centred on the note head's y
    var w = (0.11 * S).toFixed(2);
    function P(px, py) { return (x + px * S).toFixed(1) + " " + (y + py * S).toFixed(1); }
    if (kind === 1) return '<path class="n-glyphs" fill="none" stroke-width="' + w + '" d="M' + P(-0.17, -0.75) + ' L' + P(-0.17, 0.75) + ' M' + P(0.17, -0.85) + ' L' + P(0.17, 0.65) + ' M' + P(-0.45, -0.12) + ' L' + P(0.45, -0.38) + ' M' + P(-0.45, 0.38) + ' L' + P(0.45, 0.12) + '"/>';
    if (kind === -1) return '<path class="n-glyphs" fill="none" stroke-width="' + w + '" d="M' + P(-0.3, -1.1) + ' L' + P(-0.3, 0.55) + ' C' + P(0.55, 0.0) + ' ' + P(0.55, -0.55) + ' ' + P(-0.3, -0.35) + '"/>';
    return '<path class="n-glyphs" fill="none" stroke-width="' + w + '" d="M' + P(-0.2, -0.85) + ' L' + P(-0.2, 0.4) + ' L' + P(0.2, 0.25) + ' M' + P(0.2, 0.85) + ' L' + P(0.2, -0.4) + ' L' + P(-0.2, -0.25) + '"/>';
  }
  function flagPath(sx, end, up, S) { var d = up ? 1 : -1; return '<path class="n-glyph" d="M' + sx + ' ' + end + ' c 0 ' + (d * 0.9 * S) + ' ' + (1.3 * S) + ' ' + (d * 1.1 * S) + ' ' + (1.05 * S) + ' ' + (d * 2.6 * S) + ' c ' + (0.1 * S) + ' ' + (-d * 1.1 * S) + ' ' + (-0.5 * S) + ' ' + (-d * 1.5 * S) + ' ' + (-1.05 * S) + ' ' + (-d * 1.75 * S) + ' z"/>'; }
  function renderNotation(notes, opts) {
    opts = opts || {}; var sig = keySig(opts.key), accSig = sigAccidentals(sig), L = layout(notes, opts), S = opts.spacing || 8;
    var lowest = 127, highest = 0; notes.forEach(function (n) { lowest = Math.min(lowest, n.midi); highest = Math.max(highest, n.midi); });
    var clef = opts.clef && opts.clef !== "auto" ? opts.clef : (notes.length && (lowest + highest) / 2 < 60 ? "bass" : "treble");
    // staff position: steps above the bottom line (treble bottom line = E4 = step 0; bass bottom line = G2)
    var refStep = clef === "bass" ? 2 * 7 + 4 : 4 * 7 + 2; // octave*7 + letter index
    function stepOf(sp) { return sp.oct * 7 + sp.letter - refStep; }
    var off = opts.barOffset || 0, lyr = opts.lyrics || null;
    var lineGap = S * (lyr ? 16 : 13), left = 10, out = [], width = opts.width || 760, y0 = (opts.title ? 30 : 8) + S * 3.9, clefW = S * 5, sigW = Math.abs(sig) * S * 1.1 + (sig ? S : 0), tsW = S * 3;
    var chordAt = opts.chords || null; // [{bar(1-based), beat(1-based), label}]
    L.lines.forEach(function (line, li) {
      var top = y0 + li * lineGap, x = left, lineW = clefW + sigW + tsW + line.reduce(function (a, m) { return a + m.width; }, 0);
      for (var s = 0; s < 5; s++) out.push('<line class="n-line" x1="' + left + '" y1="' + (top + s * S) + '" x2="' + (left + lineW) + '" y2="' + (top + s * S) + '"/>');
      out.push('<line class="n-bar" x1="' + left + '" y1="' + top + '" x2="' + left + '" y2="' + (top + 4 * S) + '"/>');
      out.push(clefPath(clef, x + 2, top, S)); x += clefW;
      // key signature
      var order = sig > 0 ? SHARP_ORDER : FLAT_ORDER, treblePos = sig > 0 ? [8, 5, 9, 6, 3, 7, 4] : [4, 7, 3, 6, 2, 5, 1], bassPos = treblePos.map(function (p) { return p - 2; });
      for (var a = 0; a < Math.abs(sig); a++) { var step = (clef === "bass" ? bassPos : treblePos)[a], yy = top + 4 * S - step * S / 2; out.push(accidentalPath(sig > 0 ? 1 : -1, x + S * 0.5, yy, S)); x += S * 1.1; }
      if (sig) x += S;
      if (li === 0 && opts.showTime !== false) { out.push('<text class="n-ts" x="' + x + '" y="' + (top + 2 * S - 1) + '">' + L.bpb + '</text><text class="n-ts" x="' + x + '" y="' + (top + 4 * S - 1) + '">4</text>'); }
      x += tsW;
      line.forEach(function (m) {
        var mx = x, accState = Object.assign({}, accSig), beamGroups = {};
        if (chordAt) chordAt.filter(function (c) { return c.bar === m.index + 1 + off; }).forEach(function (c) { out.push('<text class="n-chord" x="' + (mx + L.pad / 2 + (c.beat - 1) * L.beatW) + '" y="' + (top - S * 3.9) + '">' + esc(C ? C.pretty(c.label) : c.label) + "</text>"); });
        out.push('<text class="n-num" x="' + (mx + 2) + '" y="' + (top - S * 0.3) + '">' + (m.index + 1 + off) + "</text>");
        if (lyr) lyr.forEach(function (w) { var b0 = m.index * L.bpb; if (w.beat >= b0 - 1e-6 && w.beat < b0 + L.bpb - 1e-6) out.push('<text class="n-lyric" x="' + (mx + L.pad / 2 + (w.beat - b0) * L.beatW - 2) + '" y="' + (top + 4 * S + S * 4.2) + '">' + esc(w.text) + "</text>"); });
        var groupDir = {}; // one stem direction per beamed beat group
        m.items.forEach(function (it) { if (it.rest || it.dur >= 1) return; var k = Math.floor(it.at), sum = 0, n = 0; it.midis.forEach(function (mi) { sum += stepOf(spell(mi, sig)); n++; }); var g = groupDir[k] = groupDir[k] || { sum: 0, n: 0 }; g.sum += sum; g.n += n; });
        Object.keys(groupDir).forEach(function (k) { groupDir[k] = groupDir[k].sum / groupDir[k].n < 4; });
        m.items.forEach(function (it, ii) {
          var ix = mx + L.pad / 2 + it.at * L.beatW;
          if (it.rest) {
            var ry = top + 2 * S;
            if (it.dur >= 4 || it.whole) out.push('<rect class="n-glyph" x="' + (ix - 4) + '" y="' + (top + S) + '" width="' + (S * 1.4) + '" height="' + (S * 0.5) + '"/>');
            else if (it.dur >= 2) out.push('<rect class="n-glyph" x="' + (ix - 4) + '" y="' + (top + 1.5 * S) + '" width="' + (S * 1.4) + '" height="' + (S * 0.5) + '"/>');
            else if (it.dur >= 1) out.push('<path class="n-glyphs" fill="none" stroke-width="2" d="M' + ix + ' ' + (ry - S * 1.2) + ' l ' + (S * 0.7) + ' ' + (S * 0.9) + ' l ' + (-S * 0.6) + ' ' + (S * 0.7) + ' l ' + (S * 0.6) + ' ' + (S * 0.8) + ' q ' + (-S * 0.8) + ' ' + (-S * 0.4) + ' ' + (-S * 0.3) + ' ' + (S * 0.9) + '"/>');
            else { out.push('<circle class="n-glyph" cx="' + (ix + 2) + '" cy="' + (ry - S * 0.3) + '" r="' + (S * 0.28) + '"/><path class="n-glyphs" fill="none" stroke-width="1.6" d="M' + (ix + 2) + ' ' + (ry - S * 0.3) + ' q ' + (S * 0.5) + ' ' + (S * 0.5) + ' ' + (S * 1) + ' ' + (-S * 0.4) + ' l ' + (-S * 0.9) + ' ' + (S * 2.2) + '"/>'); if (it.dur < 0.5) out.push('<circle class="n-glyph" cx="' + (ix + 1) + '" cy="' + (ry + S * 0.3) + '" r="' + (S * 0.26) + '"/>'); }
            if (it.dots) out.push('<circle class="n-glyph" cx="' + (ix + S * 1.6) + '" cy="' + (ry - S * 0.5) + '" r="1.6"/>');
            return;
          }
          var heads = it.midis.map(function (mi) { var sp = spell(mi, sig), st = stepOf(sp); return { midi: mi, sp: sp, step: st, y: top + 4 * S - st * S / 2 }; });
          var stemUp = it.dur < 1 && groupDir[Math.floor(it.at)] != null ? groupDir[Math.floor(it.at)] : (heads[0].step + heads[heads.length - 1].step) / 2 < 4, filled = it.dur < 2;
          // ledger lines
          heads.forEach(function (h) { for (var st = -2; st >= h.step; st -= 2) out.push('<line class="n-line" x1="' + (ix - S * 0.9) + '" y1="' + (top + 4 * S - st * S / 2) + '" x2="' + (ix + S * 0.9) + '" y2="' + (top + 4 * S - st * S / 2) + '"/>'); for (st = 10; st <= h.step; st += 2) out.push('<line class="n-line" x1="' + (ix - S * 0.9) + '" y1="' + (top + 4 * S - st * S / 2) + '" x2="' + (ix + S * 0.9) + '" y2="' + (top + 4 * S - st * S / 2) + '"/>'); });
          // accidentals (per measure state)
          heads.forEach(function (h) { var letter = LETTERS[h.sp.letter] + h.sp.oct, want = h.sp.acc, have = accState[letter] != null ? accState[letter] : (accSig[LETTERS[h.sp.letter]] || 0); if (want !== have) { out.push(accidentalPath(want, ix - S * 1.35, h.y, S)); accState[letter] = want; } });
          heads.forEach(function (h, hi) { var shift = hi > 0 && Math.abs(h.step - heads[hi - 1].step) === 1 ? (stemUp ? S * 1.1 : -S * 1.1) : 0; out.push('<ellipse class="' + (filled ? "n-glyph" : "n-head-open") + '" cx="' + (ix + shift) + '" cy="' + h.y + '" rx="' + (S * 0.62) + '" ry="' + (S * 0.45) + '" transform="rotate(-20 ' + (ix + shift) + ' ' + h.y + ')"/>'); if (it.dots) out.push('<circle class="n-glyph" cx="' + (ix + S * 1.1) + '" cy="' + (h.y - (h.step % 2 === 0 ? S * 0.5 : 0)) + '" r="1.6"/>'); });
          if (it.dur < 4) { // stem
            var sx = ix + (stemUp ? S * 0.58 : -S * 0.58), yTop = Math.min.apply(null, heads.map(function (h) { return h.y; })), yBot = Math.max.apply(null, heads.map(function (h) { return h.y; }));
            var stemEnd = stemUp ? yTop - S * 3.4 : yBot + S * 3.4;
            out.push('<line class="n-stem" x1="' + sx + '" y1="' + (stemUp ? yBot : yTop) + '" x2="' + sx + '" y2="' + stemEnd + '"/>');
            if (it.dur < 1) { var key = Math.floor(it.at); (beamGroups[key] = beamGroups[key] || []).push({ x: sx, end: stemEnd, up: stemUp, dur: it.dur }); }
            it.stemX = sx; it.stemEnd = stemEnd;
          }
          it.headY = heads.map(function (h) { return h.y; }); it.x = ix;
          // ties
          if (it.tieIn) heads.forEach(function (h) { out.push('<path class="n-tie" d="M' + (ix - S * 2.2) + ' ' + (h.y + S * 0.6) + ' q ' + (S * 1.1) + ' ' + (S * 0.9) + ' ' + (S * 2.2) + ' 0"/>'); });
        });
        // beams / flags
        Object.keys(beamGroups).forEach(function (k) {
          var g = beamGroups[k];
          if (g.length > 1 && g.every(function (q) { return q.up === g[0].up; })) {
            var yb = g[0].up ? Math.min.apply(null, g.map(function (q) { return q.end; })) : Math.max.apply(null, g.map(function (q) { return q.end; }));
            g.forEach(function (q) { out.push('<line class="n-stem" x1="' + q.x + '" y1="' + q.end + '" x2="' + q.x + '" y2="' + yb + '"/>'); });
            out.push('<line class="n-beam" x1="' + g[0].x + '" y1="' + yb + '" x2="' + g[g.length - 1].x + '" y2="' + yb + '"/>');
            var dir = g[0].up ? 1 : -1;
            g.forEach(function (q, qi) { if (q.dur < 0.5) { var nx = qi + 1 < g.length ? g[qi + 1].x : q.x - S * 1.2, px = g[qi + 1] && g[qi + 1].dur < 0.5 ? g[qi + 1].x : q.x + (qi + 1 < g.length ? S * 1.2 : -S * 1.2); out.push('<line class="n-beam" x1="' + Math.min(q.x, px) + '" y1="' + (yb + dir * S * 0.75) + '" x2="' + Math.max(q.x, px) + '" y2="' + (yb + dir * S * 0.75) + '"/>'); } });
          } else g.forEach(function (q) { out.push(flagPath(q.x, q.end, q.up, S)); if (q.dur < 0.5) out.push(flagPath(q.x, q.end + (q.up ? 1 : -1) * S * 0.9, q.up, S)); });
        });
        x += m.width;
        out.push('<line class="n-bar" x1="' + x + '" y1="' + top + '" x2="' + x + '" y2="' + (top + 4 * S) + '"/>');
      });
      if (li === L.lines.length - 1) out.push('<line class="n-bar thick" x1="' + (x + 3) + '" y1="' + top + '" x2="' + (x + 3) + '" y2="' + (top + 4 * S) + '"/>');
    });
    var h = y0 + L.lines.length * lineGap, w = Math.max(width, left + clefW + sigW + tsW + (L.lines[0] || []).reduce(function (a, m) { return a + m.width; }, 0) + 20);
    return '<svg class="notation" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '">' + (opts.title ? '<text class="n-title" x="' + left + '" y="18">' + esc(opts.title) + "</text>" : "") + out.join("") + "</svg>";
  }

  // ---------------------------------------------------------------- guitar / bass tab
  function renderTab(notes, opts) {
    opts = opts || {}; var L = layout(notes, opts), S = opts.spacing || 9;
    var lowest = 127; notes.forEach(function (n) { lowest = Math.min(lowest, n.midi); });
    var tuning = opts.tuning || (lowest < 40 && lowest >= 28 ? [28, 33, 38, 43] : [40, 45, 50, 55, 59, 64]), strings = tuning.length, lineGap = S * (strings + 4), left = 10, y0 = 26, out = [], hand = 0;
    function place(midi) { var best = null; for (var s = 0; s < strings; s++) { var fret = midi - tuning[s]; if (fret < 0 || fret > 19) continue; var cost = Math.abs(fret - hand) + (fret === 0 ? -1 : 0) + fret * 0.15; if (!best || cost < best.cost) best = { s: s, fret: fret, cost: cost }; } return best; }
    L.lines.forEach(function (line, li) {
      var top = y0 + li * lineGap, x = left, lineW = S * 3 + line.reduce(function (a, m) { return a + m.width; }, 0);
      for (var s = 0; s < strings; s++) out.push('<line class="n-line" x1="' + left + '" y1="' + (top + s * S) + '" x2="' + (left + lineW) + '" y2="' + (top + s * S) + '"/>');
      out.push('<text class="n-ts" x="' + (x + 2) + '" y="' + (top + S * strings / 2 + 5) + '">T</text>'); x += S * 3;
      line.forEach(function (m) {
        out.push('<text class="n-num" x="' + (x + 2) + '" y="' + (top - 6) + '">' + (m.index + 1) + "</text>");
        m.items.forEach(function (it) {
          if (it.rest) return;
          var ix = x + L.pad / 2 + it.at * L.beatW, used = {};
          it.midis.slice().sort(function (a, b) { return b - a; }).forEach(function (mi) { var p = place(mi); if (!p) return; var tries = 0; while (used[p.s] && tries++ < strings) { var alt = null; for (var s2 = 0; s2 < strings; s2++) { var f2 = mi - tuning[s2]; if (!used[s2] && f2 >= 0 && f2 <= 19) { alt = { s: s2, fret: f2 }; break; } } if (!alt) return; p = alt; } used[p.s] = 1; hand = p.fret > 0 ? p.fret : hand; var yy = top + (strings - 1 - p.s) * S; out.push('<rect class="n-tabbg" x="' + (ix - S * 0.75) + '" y="' + (yy - S * 0.55) + '" width="' + (S * 1.5) + '" height="' + (S * 1.1) + '"/><text class="n-tab" x="' + ix + '" y="' + (yy + S * 0.38) + '" text-anchor="middle">' + p.fret + "</text>"); });
          if (it.dur < 1) { var sy = top + strings * S + S * 0.4; out.push('<line class="n-stem" x1="' + ix + '" y1="' + sy + '" x2="' + ix + '" y2="' + (sy + S * 1.6) + '"/>'); if (it.dur < 0.5) out.push('<line class="n-beam" x1="' + ix + '" y1="' + (sy + S * 1.3) + '" x2="' + (ix + S * 0.8) + '" y2="' + (sy + S * 1.3) + '"/>'); }
        });
        x += m.width; out.push('<line class="n-bar" x1="' + x + '" y1="' + top + '" x2="' + x + '" y2="' + (top + (strings - 1) * S) + '"/>');
      });
    });
    var h = y0 + L.lines.length * lineGap, w = Math.max(opts.width || 760, left + S * 3 + (L.lines[0] || []).reduce(function (a, m) { return a + m.width; }, 0) + 20);
    return '<svg class="notation tab" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '">' + (opts.title ? '<text class="n-title" x="' + left + '" y="16">' + esc(opts.title) + "</text>" : "") + out.join("") + "</svg>";
  }

  // ---------------------------------------------------------------- piano roll (canvas)
  function drawPianoRoll(canvas, notes, opts) {
    opts = opts || {}; var ctx = canvas.getContext("2d"), dpr = window.devicePixelRatio || 1, W = canvas.clientWidth || 600, H = canvas.clientHeight || 300;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    var lo = 127, hi = 0; notes.forEach(function (n) { lo = Math.min(lo, n.midi); hi = Math.max(hi, n.midi); }); if (!notes.length) { lo = 48; hi = 72; } lo = Math.max(0, lo - 2); hi = Math.min(127, hi + 2);
    var rows = hi - lo + 1, rh = H / rows, bpb = opts.beatsPerBar || 4, beatsVisible = opts.beatsVisible || 16, pos = opts.playBeat != null ? opts.playBeat : 0, x0 = opts.follow ? Math.max(0, pos - beatsVisible * 0.3) : (opts.scrollBeat || 0), bw = W / beatsVisible, keyW = 26;
    var css = getComputedStyle(document.documentElement), accent = css.getPropertyValue("--accent").trim() || "#5de6b0", blue = css.getPropertyValue("--blue").trim() || "#75adff", text = css.getPropertyValue("--text").trim() || "#fff", line = css.getPropertyValue("--line").trim() || "#345";
    for (var r = 0; r < rows; r++) { var midi = hi - r, black = [1, 3, 6, 8, 10].indexOf(midi % 12) > -1; ctx.fillStyle = black ? "rgba(0,0,0,.28)" : "rgba(255,255,255,.03)"; ctx.fillRect(keyW, r * rh, W - keyW, rh); ctx.fillStyle = black ? "#223" : "#e8eef5"; ctx.fillRect(0, r * rh, keyW - 2, rh - 1); if (midi % 12 === 0) { ctx.fillStyle = "#223"; ctx.font = "9px sans-serif"; ctx.fillText("C" + (Math.floor(midi / 12) - 1), 3, r * rh + rh * 0.8); } }
    ctx.strokeStyle = line; ctx.lineWidth = 1;
    for (var b = Math.floor(x0); b <= x0 + beatsVisible; b++) { var xx = keyW + (b - x0) * bw; ctx.globalAlpha = b % bpb === 0 ? 0.9 : 0.3; ctx.beginPath(); ctx.moveTo(xx, 0); ctx.lineTo(xx, H); ctx.stroke(); if (b % bpb === 0) { ctx.globalAlpha = 0.8; ctx.fillStyle = text; ctx.font = "10px sans-serif"; ctx.fillText(String(b / bpb + 1), xx + 3, 11); } }
    ctx.globalAlpha = 1;
    if (opts.chords) opts.chords.forEach(function (c) { var beat = (c.bar - 1) * bpb + (c.beat - 1); if (beat < x0 - 1 || beat > x0 + beatsVisible) return; ctx.fillStyle = blue; ctx.font = "bold 12px sans-serif"; ctx.fillText(C ? C.pretty(c.label) : c.label, keyW + (beat - x0) * bw + 3, 24); });
    notes.forEach(function (n) { var xs = keyW + (n.start - x0) * bw, xe = keyW + (n.start + n.dur - x0) * bw; if (xe < keyW || xs > W) return; var r2 = hi - n.midi, playing = pos >= n.start && pos < n.start + n.dur; ctx.fillStyle = playing ? "#ffd765" : accent; ctx.globalAlpha = 0.45 + 0.55 * Math.min(1, (n.vel || 90) / 110); ctx.fillRect(Math.max(keyW, xs) + 1, r2 * rh + 1, Math.max(2, xe - Math.max(keyW, xs) - 2), Math.max(2, rh - 2)); });
    ctx.globalAlpha = 1;
    if (opts.playBeat != null) { var px = keyW + (pos - x0) * bw; ctx.strokeStyle = "#ffd765"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke(); }
  }

  var api = { renderNotation: renderNotation, renderTab: renderTab, drawPianoRoll: drawPianoRoll, layout: layout, keySig: keySig, spell: spell, splitDuration: splitDuration };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.PPNotation = Object.assign(global.PPNotation || {}, api);

  // ================================================================ Central Control: the Sheet music dialog + song-editor buttons
  var PP = global.PP, T = global.PPTracks; if (!PP || !T || typeof document === "undefined") return;
  var MEDIA = "http://127.0.0.1:8766";
  function $(s) { return document.querySelector(s); }
  var ui = { stem: null, view: "notation", mode: "auto", division: 4, clef: "auto", instrument: "concert", follow: true, scroll: 0 }, raf = 0, busy = false;
  function dialog() {
    var d = $("#sheetDialog"); if (d) return d;
    d = document.createElement("dialog"); d.id = "sheetDialog"; d.className = "sheet";
    d.innerHTML = '<div class="row spread"><div><h2>Sheet music</h2><p class="muted" id="shInfo">Listen to one track and write down what it plays.</p></div><div class="se-row"><button id="shExport">Save SVG</button><button id="shUsb">Save to USB</button><button data-close="sheetDialog">Done</button></div></div>' +
      '<div class="sh-bar"><label>Track<select id="shStem"></select></label><label>Hearing<select id="shMode"><option value="auto">Auto (single line or chords)</option><option value="mono">Single line (vocal, bass, lead)</option><option value="poly">Chords (keys, guitar)</option></select></label><label>Smallest note<select id="shDiv"><option value="2">Eighths</option><option value="4">Sixteenths</option></select></label><label>Clef<select id="shClef"><option value="auto">Auto</option><option value="treble">Treble</option><option value="bass">Bass</option></select></label><label>Written for<select id="shInst"></select></label><button class="primary" id="shGo">▶ Transcribe</button><span class="muted" id="shStatus"></span></div>' +
      '<div class="tabs" id="shViews"><button class="tab active" data-view="notation">Standard notation</button><button class="tab" data-view="tab">Guitar / bass tab</button><button class="tab" data-view="roll">Piano roll</button><button class="tab" data-view="nashville">Nashville numbers</button><button class="tab" data-view="chart">Chord chart</button></div>' +
      '<div class="sh-body" id="shBody"><p class="muted">Pick a track and press Transcribe.</p></div>';
    document.body.appendChild(d);
    var inst = d.querySelector("#shInst"); inst.innerHTML = C.INSTRUMENTS.filter(function (i) { return !i.capo; }).map(function (i) { return '<option value="' + i.id + '">' + esc(i.name.split(":")[0]) + "</option>"; }).join("");
    d.addEventListener("change", function (e) { var el = e.target; if (el.id === "shStem") ui.stem = el.value; else if (el.id === "shMode") ui.mode = el.value; else if (el.id === "shDiv") ui.division = Number(el.value); else if (el.id === "shClef") ui.clef = el.value; else if (el.id === "shInst") ui.instrument = el.value; renderBody(); });
    d.addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b) return;
      if (b.dataset.view) { ui.view = b.dataset.view; d.querySelectorAll("[data-view]").forEach(function (q) { q.classList.toggle("active", q === b); }); renderBody(); }
      else if (b.id === "shGo") transcribeNow();
      else if (b.id === "shExport") exportSvg(false);
      else if (b.id === "shUsb") exportSvg(true);
      else if (b.dataset.close) { d.close(); cancelAnimationFrame(raf); }
    });
    return d;
  }
  function trans(s) { var t = T.data(s); return t && t.transcriptions && ui.stem ? t.transcriptions[ui.stem] : null; }
  function open() {
    var s = T.song(); if (!s) { PP.setStatus("Pick a song first."); return; }
    var d = dialog(), t = T.data(s), sel = d.querySelector("#shStem");
    sel.innerHTML = t.stems.map(function (st) { return '<option value="' + st.id + '">' + esc(st.name) + (t.transcriptions && t.transcriptions[st.id] ? " ✓" : "") + "</option>"; }).join("");
    if (!ui.stem || !t.stems.some(function (st) { return st.id === ui.stem; })) ui.stem = t.stems.length ? t.stems[0].id : null;
    sel.value = ui.stem || ""; d.querySelector("#shMode").value = ui.mode; d.querySelector("#shDiv").value = String(ui.division); d.querySelector("#shClef").value = ui.clef; d.querySelector("#shInst").value = ui.instrument;
    d.querySelector("#shInfo").textContent = s.name + " · " + T.keyName(s.key) + " · " + Math.round(s.bpm) + " BPM";
    if (!d.open) d.showModal(); renderBody();
  }
  async function transcribeNow() {
    var s = T.song(), t = s && T.data(s); if (!t || !ui.stem || busy) return;
    var st = t.stems.filter(function (q) { return q.id === ui.stem; })[0]; if (!st) return;
    busy = true; var status = $("#shStatus"); status.textContent = "Listening to " + st.name + "…"; $("#shGo").disabled = true;
    try {
      var rec = await T.getStem(st.id); if (!rec) throw new Error("track audio missing");
      var L = new Int16Array(rec.L), R = rec.R ? new Int16Array(rec.R) : null, mono = new Float32Array(L.length), g = 1 / 32768;
      for (var i = 0; i < L.length; i++) mono[i] = (R ? (L[i] + R[i]) * .5 : L[i]) * g;
      var grid = T.grid(s), first = grid.bars.length ? grid.bars[0] : 0, opts = { mode: ui.mode, grid: { period: grid.period, first: first }, beatsPerBar: grid.bpb, division: ui.division };
      if (st.role === "bass") { opts.fmin = 30; opts.fmax = 400; opts.low = 24; opts.high = 60; } else if (st.role === "vocals") { opts.fmin = 80; opts.fmax = 1100; }
      var res = await T.workerJob("transcribe", mono, PP.engine.context().sampleRate, opts);
      t.transcriptions = t.transcriptions || {}; t.transcriptions[st.id] = { mode: res.mode, notes: res.notes, lowest: res.lowest, highest: res.highest, division: ui.division, at: Date.now() };
      PP.persistSoon(); status.textContent = res.notes.length + " notes · heard as " + (res.mode === "poly" ? "chords" : "a single line");
      var sel = $("#shStem"); Array.from(sel.options).forEach(function (o) { if (o.value === st.id && o.textContent.indexOf("✓") < 0) o.textContent += " ✓"; });
    } catch (error) { status.textContent = "Could not transcribe: " + error.message; }
    busy = false; $("#shGo").disabled = false; renderBody();
  }
  function chordsFor(s) { var t = T.data(s); return t && t.chords ? t.chords.map(function (c) { return { bar: c.bar, beat: c.beat, label: c.label === "N" ? "N.C." : c.label + (c.bass ? "/" + c.bass : "") }; }) : null; }
  function viewNotes(tr) { var inst = C.instrument(ui.instrument), shift = inst.shift || 0; if (!shift) return tr.notes; return tr.notes.map(function (n) { return Object.assign({}, n, { midi: n.midi + shift }); }); }
  function renderBody() {
    var body = $("#shBody"), s = T.song(); if (!body || !s) return; cancelAnimationFrame(raf);
    var t = T.data(s), tr = trans(s), key = s.key, inst = C.instrument(ui.instrument), writtenKey = inst.shift ? C.noteName(C.noteIndex(key) + inst.shift, C.keyPrefersFlats(C.noteName(C.noteIndex(key) + inst.shift, true))) : key;
    var chords = chordsFor(s), width = Math.max(600, body.clientWidth - 20);
    if (ui.view === "notation" || ui.view === "tab") {
      if (!tr) { body.innerHTML = '<p class="muted">No transcription of this track yet. Press ▶ Transcribe.</p>'; return; }
      var notes = viewNotes(tr), opts = { key: writtenKey, beatsPerBar: t.grid.bpb || 4, barsPerLine: Math.max(2, Math.floor(width / 170)), width: width, chords: ui.view === "notation" ? chords : null, clef: ui.clef, title: s.name + (inst.shift ? " · written for " + inst.name.split(":")[0] : "") };
      body.innerHTML = '<div class="sh-scroll">' + (ui.view === "notation" ? renderNotation(notes, opts) : renderTab(tr.notes, opts)) + "</div>";
    } else if (ui.view === "roll") {
      if (!tr) { body.innerHTML = '<p class="muted">No transcription of this track yet. Press ▶ Transcribe.</p>'; return; }
      body.innerHTML = '<div class="sh-rollbar"><label class="toggle"><input type="checkbox" id="shFollow"' + (ui.follow ? " checked" : "") + "> Follow the playhead</label><input type=\"range\" id=\"shScroll\" min=\"0\" max=\"" + Math.max(1, Math.ceil(tr.notes.reduce(function (a, n) { return Math.max(a, n.start + n.dur); }, 0))) + '" value="' + ui.scroll + '"></div><canvas id="shRoll" class="sh-roll"></canvas>';
      body.querySelector("#shFollow").addEventListener("change", function (e) { ui.follow = e.target.checked; }); body.querySelector("#shScroll").addEventListener("input", function (e) { ui.scroll = Number(e.target.value); ui.follow = false; body.querySelector("#shFollow").checked = false; });
      var canvas = body.querySelector("#shRoll"), grid = T.grid(s);
      (function frame() { var pos = T.state.pos, beat = grid.bars.length ? (pos - grid.bars[0]) / grid.period : pos / grid.period; drawPianoRoll(canvas, tr.notes, { beatsPerBar: grid.bpb, playBeat: beat, follow: ui.follow && T.isPlaying(), scrollBeat: ui.follow ? Math.max(0, beat - 4) : ui.scroll, chords: chords, beatsVisible: 24 }); raf = requestAnimationFrame(frame); })();
    } else {
      var text = t.chartText || (s.chart && s.chart.text) || "";
      if (!text) { body.innerHTML = '<p class="muted">No chart yet. In the song editor press <b>Listen & write chord chart</b>, or upload / paste a chart.</p>'; return; }
      var parsed = C.parseChart(text), v = C.view({ chartKey: parsed.key || t.chordsKey || key, songKey: key, instrument: ui.view === "nashville" ? "concert" : ui.instrument, nashville: ui.view === "nashville", mode: t.originalMode });
      body.innerHTML = '<div class="chart-view">' + (ui.view === "nashville" ? '<p class="muted">Numbers against ' + esc(C.pretty(/m$/.test(key) ? key : key)) + " major (minor songs use the relative major).</p>" : (v.instrument.shift ? '<p class="muted">Written for ' + esc(v.instrument.name.split(":")[0]) + " · sounds in " + esc(C.pretty(key)) + ", reads in " + esc(C.pretty(v.writtenKey)) + "</p>" : "")) + C.renderChart(parsed, { view: v }) + "</div>";
    }
  }
  async function exportSvg(toUsb) {
    var svg = $("#shBody svg"), s = T.song(); if (!svg || !s) { PP.setStatus("Nothing to save yet."); return; }
    var text = '<?xml version="1.0" encoding="UTF-8"?>\n' + svg.outerHTML.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" style="background:#fff;color:#000" ').replace(/class="n-/g, 'fill="#000" class="n-'), name = s.name.replace(/[^\w\- ]+/g, "") + " - " + ui.view + ".svg";
    if (toUsb) { try { var r = await fetch(MEDIA + "/export?name=" + encodeURIComponent(name), { method: "PUT", body: text }); var j = await r.json(); PP.setStatus(j.path ? "Saved " + j.path : (j.error || "No USB stick found")); } catch (_) { PP.setStatus("Only on the Central Control (USB)."); } return; }
    var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "image/svg+xml" })); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  // Song editor: the "Charts & sheet music" section
  function wireEditor() {
    var d = $("#songDialog"); if (!d || $("#seSheetSection")) return;
    var sec = document.createElement("section"); sec.id = "seSheetSection";
    sec.innerHTML = '<h3>Charts &amp; sheet music</h3><p class="muted" id="seChordInfo">Listen to the tracks and write the chord chart (sent to phones, the projector and Central Usage), or transcribe one track to notation, tab or a piano roll.</p><div class="se-row"><button class="primary" id="seMakeChart">♫ Listen &amp; write chord chart</button><button id="seSheet">𝄞 Sheet music…</button></div>';
    var grid = d.querySelector(".se-grid"); if (grid) grid.appendChild(sec);
    sec.addEventListener("click", async function (e) {
      if (e.target.id === "seSheet") open();
      else if (e.target.id === "seMakeChart") {
        var s = T.song(); if (!s) return; var info = $("#seChordInfo"), btn = e.target; btn.disabled = true;
        try { var res = await window.PPChords.generateChart(s, function (m) { info.textContent = m; }); info.textContent = res.chords.length + " chord changes written" + (res.saved ? " and saved on the Central Control (phones and Central Usage get it now)." : " (saved in this project)."); T.renderEditor(); }
        catch (error) { info.textContent = "Could not write the chart: " + error.message; }
        btn.disabled = false;
      }
    });
  }
  wireEditor();
  // the current chord, for the Tracks tab, the 3.5" screen and the companions
  function currentChordLabel() { var s = T.song(); if (!s) return null; var c = window.PPChords.currentChord(s, T.state.pos); return c ? (c.label === "N" ? "N.C." : C.pretty(c.label + (c.bass ? "/" + c.bass : ""))) : null; }
  setInterval(function () { var el = $("#trChordNow"); var label = currentChordLabel(); if (!el) { var now = $("#trLyricsNow"); if (now && now.parentNode) { el = document.createElement("div"); el.id = "trChordNow"; el.className = "tr-chord"; now.parentNode.insertBefore(el, now); } } if (el) { el.textContent = label || ""; el.classList.toggle("hidden", !label); } }, 250);
  global.PPNotation.open = open; global.PPNotation.currentChordLabel = currentChordLabel;
})(typeof window !== "undefined" ? window : globalThis);
