/* Central - the song sheet: one small description of a song's chart that every screen draws the way each
 * musician wants it (chord chart, number chart, sheet music or lyrics; their instrument's key, clef and capo).
 * It travels with the Central Pedal's display state, so when the tracks move on - next song, a section jump,
 * a change in the flow, a seek, the key or the tempo - every chart and lyric screen follows at once.
 *
 *   PPSheets.sheetOf(song, tracks, grid)        -> the sheet (key as played, sections with their bars, chords, chart text)
 *   PPSheets.render(sheet, prefs, opts)         -> { html, note } for one musician (prefs: type, instrument, part, clef, capo)
 *   PPSheets.lengths(sections, totalBars)       -> [{id, name, bar, bars}] (sorted)
 *   PPSheets.setLength / add / remove (tracks)  -> section editing that keeps the flow, the lyrics and the chart in step
 *   PPSheets.syncChart(text, before, after)     -> the chart text with sections renamed / added / taken out
 *   PPSheets.tidyChords(chords, bpb)            -> detected chords without the flickers (passing chords shorter than a beat)
 * No app dependencies (PPChords, PPParts and PPNotation are used when they're there), so the companion pages,
 * Central Control, Central Usage and the tests share it. */
(function (global) {
  "use strict";
  function C() { return global.PPChords; }
  function P() { return global.PPParts; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function id() { return "s" + Math.random().toString(36).slice(2, 10); }

  // ---------------------------------------------------------------- sections: bars, length, add, take away
  function sortedSecs(list) { return (list || []).slice().sort(function (a, b) { return a.bar - b.bar; }); }
  // each section's length in bars (the last one runs to the end of the song)
  function lengths(sections, totalBars) {
    var s = sortedSecs(sections), end = Math.max(1, totalBars || 1);
    return s.map(function (sec, i) { var next = i + 1 < s.length ? s[i + 1].bar : Math.max(end + 1, sec.bar + 1); return { id: sec.id, name: sec.name, bar: sec.bar, bars: Math.max(1, next - sec.bar) }; });
  }
  // a section N bars long: the next section starts N bars after this one (the one after that stays where it is,
  // so a longer section takes bars from the next one). The audio doesn't move - only where the sections start.
  function setLength(t, secId, bars, totalBars) {
    var s = sortedSecs(t.sections), i = s.map(function (q) { return q.id; }).indexOf(secId);
    if (i < 0) return { ok: false, why: "That section isn't in this song." };
    if (i === s.length - 1) return { ok: false, why: "The last section runs to the end of the song. Make the one before it shorter or longer instead." };
    var next = s[i + 1], limit = i + 2 < s.length ? s[i + 2].bar - 1 : Math.max(next.bar, totalBars || next.bar);
    var want = Math.round(Number(bars) || 1), bar = Math.max(s[i].bar + 1, Math.min(limit, s[i].bar + want));
    next.bar = bar;
    return { ok: bar === s[i].bar + want, bar: bar, why: bar === s[i].bar + want ? "" : "Only " + (bar - s[i].bar) + " bars fit before " + (s[i + 2] ? s[i + 2].name : "the end") + "." };
  }
  function newSection(name, bar) { return { id: id(), name: name, bar: bar, pad: -1, transition: "inherit", cue: "auto", lyrics: "", page: 0 }; }
  // a new section at a bar; a bar where one already starts splits that section in the middle instead
  function add(t, bar, name, totalBars) {
    var s = sortedSecs(t.sections), want = Math.max(1, Math.round(Number(bar) || 1));
    if (s.some(function (q) { return q.bar === want; })) {
      var L = lengths(t.sections, totalBars), hit = L.filter(function (q) { return q.bar === want; })[0];
      if (!hit || hit.bars < 2) return null;
      want = hit.bar + Math.floor(hit.bars / 2);
    }
    var sec = newSection(name || "Section " + (s.length + 1), want);
    t.sections.push(sec);
    return sec;
  }
  // take a section away: its bars join the one before (or the next one, for the first section), its lyrics go with
  // them, and it leaves the flow
  function remove(t, secId) {
    var s = sortedSecs(t.sections), i = s.map(function (q) { return q.id; }).indexOf(secId); if (i < 0) return false;
    var gone = s[i], keep = i > 0 ? s[i - 1] : s[i + 1] || null;
    if (keep && gone.lyrics && String(gone.lyrics).trim()) keep.lyrics = i > 0 ? [keep.lyrics, gone.lyrics].filter(function (x) { return x && String(x).trim(); }).join("\n") : [gone.lyrics, keep.lyrics].filter(function (x) { return x && String(x).trim(); }).join("\n");
    if (i === 0 && keep) keep.bar = gone.bar;
    t.sections = t.sections.filter(function (q) { return q !== gone; });
    if (Array.isArray(t.flow)) t.flow = t.flow.filter(function (x) { return x !== secId; });
    return true;
  }

  // ---------------------------------------------------------------- the chart text keeps its sections in step
  var SEC_WORDS = /^(intro|verse|chorus|pre-?chorus|bridge|tag|outro|ending|interlude|instrumental|turnaround|vamp|refrain|hook|solo|breakdown|build|coda|pre|channel|post-?chorus|section)\b/i;
  function headerName(line) {
    var t = String(line || "").trim(); if (!t) return null;
    var m = /^\[([^\]]+)\]$/.exec(t); if (m && !(C() && C().isChord(m[1]))) return m[1].trim();
    m = /^\{\s*(?:c|comment|start_of_\w+)\s*:\s*(.+?)\s*\}$/i.exec(t); if (m && SEC_WORDS.test(m[1])) return m[1].trim();
    t = t.replace(/:\s*$/, ""); if (SEC_WORDS.test(t) && t.split(/\s+/).length <= 3 && !/[.,!?]/.test(t)) return t;
    return null;
  }
  function norm(n) { return String(n || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
  // before / after: the song's sections [{id, name}] in bar order, before and after an edit
  function syncChart(text, before, after) {
    if (!text) return text;
    var lines = String(text).replace(/\r/g, "").split("\n"), heads = [];
    lines.forEach(function (l, i) { var h = headerName(l); if (h) heads.push({ i: i, name: h }); });
    if (!heads.length) return text;
    var bId = {}, aId = {}; (before || []).forEach(function (q) { bId[q.id] = q; }); (after || []).forEach(function (q) { aId[q.id] = q; });
    var afterNames = {}; (after || []).forEach(function (q) { afterNames[norm(q.name)] = true; });
    // renamed: a header with the old name gets the new one (only when no section still has the old name)
    var renames = {}; (after || []).forEach(function (q) { var b = bId[q.id]; if (b && norm(b.name) !== norm(q.name) && !afterNames[norm(b.name)]) renames[norm(b.name)] = q.name; });
    heads.forEach(function (h) { var nn = renames[norm(h.name)]; if (nn) { lines[h.i] = lines[h.i].replace(h.name, nn); h.name = nn; } });
    // taken out: the block under a header whose name no section has any more
    var drop = {}; (before || []).forEach(function (q) { if (!aId[q.id] && !afterNames[norm(q.name)]) drop[norm(q.name)] = true; });
    var keep = lines.map(function () { return true; });
    heads.forEach(function (h, k) { if (!drop[norm(h.name)]) return; var end = k + 1 < heads.length ? heads[k + 1].i : lines.length; for (var j = h.i; j < end; j++) keep[j] = false; });
    var out = [], chartNames = {};
    lines.forEach(function (l, i) { if (keep[i]) out.push(l); });
    heads.forEach(function (h) { if (!drop[norm(h.name)]) chartNames[norm(h.name)] = true; });
    // added: a new section's header goes in front of the next section that's in the chart (or at the end)
    (after || []).forEach(function (q, k) {
      if (bId[q.id] || chartNames[norm(q.name)]) return;
      var nextName = null; for (var j = k + 1; j < after.length; j++) if (chartNames[norm(after[j].name)]) { nextName = after[j].name; break; }
      var at = out.length;
      if (nextName) for (var n = 0; n < out.length; n++) { var h2 = headerName(out[n]); if (h2 && norm(h2) === norm(nextName)) { at = n; break; } }
      var block = ["[" + q.name + "]", ""];
      if (at === out.length && out.length && out[out.length - 1].trim()) block.unshift("");
      out.splice.apply(out, [at, 0].concat(block));
      chartNames[norm(q.name)] = true;
    });
    return out.join("\n").replace(/\n{3,}/g, "\n\n");
  }

  // ---------------------------------------------------------------- better chords from the audio
  // the chord detector sees every wobble: a chord shorter than a beat between two of the same chord is a flicker,
  // and a short chord just before a bar line usually belongs to the next bar (it's the push into it)
  function tidyChords(chords, bpb) {
    bpb = bpb || 4; var list = (chords || []).filter(function (c) { return c && c.label; }).slice().sort(function (a, b) { return (a.bar - b.bar) || (a.beat - b.beat); });
    var out = [];
    list.forEach(function (c, i) {
      var beats = c.beats != null ? c.beats : (list[i + 1] ? (list[i + 1].bar - c.bar) * bpb + (list[i + 1].beat - c.beat) : bpb);
      var prev = out[out.length - 1], next = list[i + 1];
      if (prev && prev.label === c.label && (prev.bass || "") === (c.bass || "")) return;            // the same chord again
      if (c.label === "N" && beats < bpb && prev) return;                                              // a short gap in the sound (not a real "no chord")
      if (beats < 1 && prev && next && prev.label === next.label) return;                             // a flicker inside one chord
      if (beats <= 1 && c.conf != null && c.conf < 0.3 && prev) return;                               // one beat the detector wasn't sure about
      if (beats <= 1 && c.beat > bpb - 0.75 && next && next.bar === c.bar + 1 && next.beat <= 1.01) return;   // a push into the next bar
      out.push(Object.assign({}, c));
    });
    // after the flickers are gone, chords that now repeat join up
    return out.filter(function (c, i) { var p = out[i - 1]; return !p || p.label !== c.label || (p.bass || "") !== (c.bass || ""); });
  }

  // ---------------------------------------------------------------- the sheet
  function hash(s) { var h = 2166136261; s = String(s); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
  // song s, its tracks t (or null for a song with no tracks), the beat grid g (or null)
  function sheetOf(s, t, g) {
    if (!s) return null;
    var bpb = (g && g.bpb) || (t && t.grid && t.grid.bpb) || 4, total = 1;
    if (t && g && t.duration) (g.bars || []).forEach(function (b) { if (b <= t.duration) total++; });
    total = Math.max(1, total - 1);
    (t && t.sections || []).forEach(function (q) { total = Math.max(total, q.bar); });
    var shift = t && t.keyShift ? t.keyShift : 0, playKey = s.key || "C", flats = C() ? C().keyPrefersFlats(playKey) : false;
    // detected chords are where the tracks really are; the tracks play shifted by keyShift, so the chords move with them
    var chords = (t && t.chords || []).slice(0, 2000).map(function (c) {
      var lab = c.label, bass = c.bass || null;
      if (shift && C() && lab && lab !== "N") { try { lab = C().transpose(lab, shift, flats); if (bass) bass = C().noteName(C().noteIndex(bass) + shift, flats); } catch (_) { } }
      return { bar: c.bar, beat: c.beat || 1, label: lab, bass: bass, beats: c.beats };
    });
    chords = tidyChords(chords, bpb).map(function (c) { return { bar: c.bar, beat: c.beat, label: c.label, bass: c.bass }; });
    var secs = lengths(t ? t.sections : [], total).map(function (q) { var full = ((t && t.sections) || []).filter(function (x) { return x.id === q.id; })[0] || {}; return { id: q.id, name: q.name, bar: q.bar, bars: q.bars, lyrics: String(full.lyrics || "").slice(0, 4000) }; });
    var sheet = {
      id: s.id || null, name: s.name || "", key: playKey, mode: (t && t.originalMode) || (/m$/.test(playKey) ? "minor" : "major"),
      origKey: (t && t.originalKey) || null, keyShift: shift, bpm: Math.round((s.bpm || 0) * 10) / 10, tempo: t && t.tempoPercent ? t.tempoPercent : 100,
      bpb: bpb, bars: total, sections: secs, flow: t && t.flowOn && Array.isArray(t.flow) ? t.flow.slice(0, 200) : null,
      chords: chords, chartText: String((t && t.chartText) || "").slice(0, 60000)
    };
    sheet.sig = hash(JSON.stringify([sheet.key, sheet.keyShift, sheet.tempo, sheet.bpb, sheet.bars, sheet.sections, sheet.flow, sheet.chartText, sheet.chords.length, sheet.chords.slice(0, 50)]));
    return sheet;
  }
  // the chart's words: the chart text, or one made from the heard chords and the sections' lyrics
  function textOf(sheet) {
    if (!sheet) return "";
    if (sheet.chartText && sheet.chartText.trim()) return sheet.chartText;
    var Ch = C(); if (!Ch) return "";
    if ((sheet.chords || []).length) return Ch.chartFromChords(sheet.chords, sheet.sections.map(function (q) { return { name: q.name, bar: q.bar, lyrics: q.lyrics || "" }; }), sheet.bars, sheet.bpb, { title: sheet.name, key: sheet.key + (sheet.mode === "minor" && !/m$/.test(sheet.key) ? "m" : ""), bpm: sheet.bpm });
    var withWords = (sheet.sections || []).filter(function (q) { return q.lyrics && q.lyrics.trim(); });
    if (!withWords.length) return "";
    return ["{title: " + sheet.name + "}", "{key: " + sheet.key + "}", ""].concat(sheet.sections.map(function (q) { return "[" + q.name + "]\n" + (q.lyrics || "") + "\n"; })).join("\n");
  }

  // ---------------------------------------------------------------- one musician's view
  var TYPES = [["chords", "Chord chart"], ["numbers", "Number chart"], ["sheet", "Sheet music"], ["lyrics", "Words only"]];
  var CLEFS = [["auto", "Usual for the instrument"], ["treble", "Treble"], ["bass", "Bass"], ["alto", "Alto (viola)"], ["tenor", "Tenor"]];
  // the parts that have sheet music (from PPParts), for the "Sheet music for" picker
  function sheetParts() { var p = P(); return p ? p.INSTRUMENTS.filter(function (i) { return i.views.indexOf("notation") >= 0; }).map(function (i) { return [i.id, i.name]; }) : []; }
  // the shape key a capo on fret n gives in this song key (capo 2 in A -> G shapes)
  function shapeForCapo(key, capo) { var Ch = C(); if (!Ch) return null; var minor = /m$/.test(key || ""), root = Ch.noteIndex(String(key || "C").replace(/m$/, "")); var sh = Ch.noteName(root - capo + 1200, false); var pretty = { "C#": "Db", "D#": "Eb", "G#": "Ab", "A#": "Bb" }[sh] || sh; return pretty + (minor ? "m" : ""); }
  function render(sheet, prefs, opts) {
    prefs = prefs || {}; opts = opts || {};
    var Ch = C(); if (!sheet || !Ch) return { html: '<div class="empty">No song yet.</div>', note: "" };
    var type = prefs.type || "chords", tempo = sheet.bpm ? Math.round(sheet.bpm * (sheet.tempo || 100) / 100) : 0;
    var head = [];
    if (type === "sheet") {
      var Pp = P(); if (!Pp) return { html: '<div class="empty">Sheet music isn\'t available on this screen.</div>', note: "" };
      var ctx = { name: sheet.name, key: sheet.key, mode: sheet.mode, bpb: sheet.bpb, bpm: tempo || sheet.bpm, bars: sheet.bars, chords: sheet.chords || [], sections: (sheet.sections || []).map(function (q) { return { name: q.name, bar: q.bar }; }), hits: [], words: [], chartText: sheet.chords && sheet.chords.length ? "" : textOf(sheet), stems: [], transcriptions: {} };
      var partId = prefs.part || "keys", part = Pp.build(ctx, partId);
      var view = part.views.indexOf("notation") >= 0 ? "notation" : part.views[0];
      var html = Pp.render(part, view, { ctx: ctx, width: opts.width || 900, clef: prefs.clef && prefs.clef !== "auto" ? prefs.clef : null });
      return { html: html, note: "Sheet music · " + part.name + (tempo ? " · ♩ = " + tempo : "") };
    }
    var text = textOf(sheet);
    if (!text) return { html: '<div class="empty">' + (type === "lyrics" ? "No words for this song yet." : "No chart for this song yet. Add one in the song editor, or let the Central Pedal listen to the tracks and write it.") + "</div>", note: "" };
    var parsed = Ch.parseChart(text), inst = Ch.instrument(prefs.instrument || "concert"), shape = null;
    if (inst.capo && prefs.capo != null && prefs.capo !== "auto" && prefs.capo !== "") shape = shapeForCapo(sheet.key, Math.max(0, Math.min(11, Number(prefs.capo) || 0)));
    var v = Ch.view({ chartKey: parsed.key || sheet.origKey || sheet.key, songKey: sheet.key, instrument: inst.id, nashville: type === "numbers", mode: sheet.mode, shape: shape || prefs.shape || "auto" });
    if (type === "numbers") head.push("Numbers in " + Ch.pretty(sheet.key));
    else if (type !== "lyrics") {
      head.push("Key of " + Ch.pretty(sheet.key));
      if (inst.capo) head.push(v.capo ? "capo " + v.capo + ", play " + Ch.pretty(v.shapeKey) + " shapes" : "no capo");
      else if (inst.shift) head.push("written in " + Ch.pretty(v.writtenKey) + " for your instrument");
    }
    if (tempo) head.push("♩ = " + tempo + (sheet.tempo && sheet.tempo !== 100 ? " (" + sheet.tempo + "%)" : ""));
    return { html: '<div class="chart-view">' + Ch.renderChart(parsed, { view: v, lyricsOnly: type === "lyrics" }) + "</div>", note: head.join(" · "), parsed: parsed };
  }
  // which drawn chart section is the one playing: the same name, counting repeats (Chorus, then Chorus again)
  function chartSectionFor(sheet, parsed, sectionIndex) {
    if (!sheet || !parsed || sectionIndex == null || sectionIndex < 0) return -1;
    var secs = sheet.sections || [], cur = secs[sectionIndex]; if (!cur) return -1;
    var name = norm(cur.name), base = name.replace(/\d+$/, ""), nth = 0;
    for (var i = 0; i < sectionIndex; i++) if (norm(secs[i].name) === name) nth++;
    var exact = [], loose = [];
    parsed.sections.forEach(function (q, k) { var n = norm(q.name); if (n === name) exact.push(k); else if (n.replace(/\d+$/, "") === base) loose.push(k); });
    var list = exact.length ? exact : loose; if (!list.length) return -1;
    return list[Math.min(nth, list.length - 1)];
  }

  var api = { sheetOf: sheetOf, textOf: textOf, render: render, lengths: lengths, setLength: setLength, add: add, remove: remove, syncChart: syncChart, headerName: headerName,
    tidyChords: tidyChords, chartSectionFor: chartSectionFor, shapeForCapo: shapeForCapo, sheetParts: sheetParts, TYPES: TYPES, CLEFS: CLEFS, esc: esc };
  global.PPSheets = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
