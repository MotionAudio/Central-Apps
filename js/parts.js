/* Central Pedal / Central Control - a part for every instrument.
 * From what the song already knows - its chords (from the chart or heard in the tracks), sections, key,
 * tempo, the hits, the lyrics with their timing - and from the tracks themselves when the song has
 * one for that instrument: what that track really plays (transcribed) comes first; with no track
 * the part is written from the chords (bass on the roots, keys voiced close, horns and strings on
 * guide tones, a drum chart that follows the sections).
 *   PPParts.INSTRUMENTS                    the list (chord chart, numbers, guitar, bass, keys, vocals,
 *                                          trumpet, clarinet, alto / tenor sax, horn in F, trombone,
 *                                          violin, cello, drums)
 *   PPParts.build(ctx, id)                 -> a part (notes in concert pitch + how to write it)
 *   PPParts.render(part, view, opts)       -> HTML (SVG notation / tab / drums / chord diagrams)
 * ctx = { name, key, mode, bpb, bpm, bars, chords: [{bar, beat, label, bass}], sections: [{name, bar}],
 *         hits: [beat], words: [{beat, text}], chartText, stems: [{id, name, role}],
 *         transcriptions: {stemId: {mode, notes: [{start, dur, midi}]}}, drums: {kick, snare, hat, crash: [beat]} }
 * Beats count from the first beat of bar 1 (0). Works in the page and in node (tests). */
(function (global) {
  "use strict";
  var C = global.PPChords;
  function N() { return global.PPNotation; }
  var PCS = { C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11, Cb: 11, "E#": 5, "B#": 0, Fb: 4 };
  function pcOf(n) { n = String(n || "").replace(/♯/g, "#").replace(/♭/g, "b"); return PCS[n] != null ? PCS[n] : -1; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  var INSTRUMENTS = [
    { id: "chords", name: "Chord chart", group: "Charts", views: ["chart"] },
    { id: "nashville", name: "Number chart (Nashville)", group: "Charts", views: ["chart"] },
    { id: "guitar", name: "Guitar", group: "Band", views: ["chart", "tab", "notation"], match: /gtr|guitar|\beg\b|\bag\b|acoustic|electric/i, low: 40, high: 84, clef: "treble", octave: 12 },
    { id: "bass", name: "Bass", group: "Band", views: ["notation", "tab", "chart"], match: /bass|\bbs\b|sub/i, role: "bass", low: 28, high: 55, clef: "bass", octave: 12 },
    { id: "keys", name: "Keys / piano", group: "Band", views: ["notation", "chart"], match: /key|piano|\bpno\b|organ|rhodes|wurli|synth|\bep\b/i, role: "keys", low: 33, high: 96 },
    { id: "vocals", name: "Vocals (melody + lyrics)", group: "Band", views: ["notation", "chart"], match: /lead ?vox|lead ?vocal|vocal|vox|\blv\b|melody|bgv|choir/i, role: "vocals", low: 45, high: 84, clef: "treble" },
    { id: "drums", name: "Drums", group: "Band", views: ["drums"], match: /drum|kit|perc|\bdr\b/i, role: "drums" },
    { id: "trumpet", name: "Trumpet (B♭)", group: "Horns", views: ["notation"], match: /trumpet|tpt|horns?|brass/i, shift: 2, low: 55, high: 79, clef: "treble", guide: ["third", "fifth", "seventh"], plays: 2 },
    { id: "clarinet", name: "Clarinet (B♭)", group: "Horns", views: ["notation"], match: /clarinet|\bcl\b|woodwind/i, shift: 2, low: 52, high: 82, clef: "treble", guide: ["fifth", "third"], plays: 2 },
    { id: "altosax", name: "Alto sax (E♭)", group: "Horns", views: ["notation"], match: /alto|sax/i, shift: 9, low: 49, high: 77, clef: "treble", guide: ["third", "seventh", "fifth"], plays: 2 },
    { id: "tenorsax", name: "Tenor sax (B♭)", group: "Horns", views: ["notation"], match: /tenor|sax/i, shift: 14, low: 44, high: 72, clef: "treble", guide: ["seventh", "third", "root"], plays: 2 },
    { id: "horn", name: "Horn in F", group: "Horns", views: ["notation"], match: /french horn|\bhorn\b|\bhn\b/i, shift: 7, low: 41, high: 72, clef: "treble", guide: ["fifth", "third"], plays: 2 },
    { id: "trombone", name: "Trombone", group: "Horns", views: ["notation"], match: /trombone|tbn|bone/i, shift: 0, low: 40, high: 67, clef: "bass", guide: ["third", "seventh", "root"], plays: 2 },
    { id: "violin", name: "Violin", group: "Strings", views: ["notation"], match: /violin|vln|strings?|orch/i, shift: 0, low: 55, high: 88, clef: "treble", guide: ["fifth", "third", "root"], plays: 1 },
    { id: "cello", name: "Cello", group: "Strings", views: ["notation"], match: /cello|vc\b|strings?|orch/i, shift: 0, low: 36, high: 62, clef: "bass", guide: ["root", "fifth"], plays: 1 }
  ];
  function instrument(id) { return INSTRUMENTS.filter(function (i) { return i.id === id; })[0] || INSTRUMENTS[0]; }

  // ---------------------------------------------------------------- chords
  function parseChord(label) {
    var m = /^\s*([A-G][#b♯♭]?)([^/]*?)(?:\/([A-G][#b♯♭]?))?\s*$/.exec(String(label || "")); if (!m) return null;
    var root = pcOf(m[1]); if (root < 0) return null;
    var q = m[2] || "", ql = q.toLowerCase(), third = 4, fifth = 7, sev = null, ext = [];
    var minor = /^(m(?!aj)|min|-)/.test(q) && !/^maj/i.test(q);
    if (minor) third = 3;
    if (/sus2/.test(ql)) third = 2; else if (/sus/.test(ql)) third = 5;
    if (/m7b5|ø/.test(ql)) { third = 3; fifth = 6; sev = 10; }
    else if (/dim|°/.test(ql)) { third = 3; fifth = 6; if (/7/.test(ql)) sev = 9; }
    if (/aug|\+|#5/.test(ql)) fifth = 8;
    if (sev == null) { if (/maj7|ma7|Δ/.test(ql) || /M7/.test(q)) sev = 11; else if (/(^|[^d])(7|9|11|13)/.test(ql) && !/add/.test(ql)) sev = 10; }
    if (/6/.test(ql)) ext.push(9);
    if (/add9|add2/.test(ql) || (/9/.test(ql) && sev == null)) ext.push(2);
    var tones = [0, third, fifth].concat(sev != null ? [sev] : []).concat(ext).map(function (i) { return (root + i) % 12; });
    var bass = m[3] ? pcOf(m[3]) : root;
    return { label: String(label).trim(), root: root, bass: bass < 0 ? root : bass, third: (root + third) % 12, fifth: (root + fifth) % 12, seventh: sev != null ? (root + sev) % 12 : null, tones: tones, minor: third === 3 };
  }
  function spans(ctx) {
    var bpb = ctx.bpb || 4, end = Math.max(1, ctx.bars || 1) * bpb;
    var list = (ctx.chords || []).map(function (c) { var lab = c.label === "N" || c.label === "N.C." ? null : c.label + (c.bass && String(c.label).indexOf("/") < 0 ? "/" + c.bass : ""); return { at: (Number(c.bar) - 1) * bpb + (Number(c.beat || 1) - 1), label: lab }; })
      .filter(function (c) { return c.at >= 0 && c.at < end; }).sort(function (a, b) { return a.at - b.at; });
    var out = [];
    list.forEach(function (c, i) {
      var e = i + 1 < list.length ? list[i + 1].at : end; if (e <= c.at) return;
      out.push({ start: c.at, end: e, ch: c.label ? parseChord(c.label) : null, label: c.label });
    });
    return out.filter(function (s) { return s.ch; });
  }
  // ---------------------------------------------------------------- sections and how hard they hit
  var ENERGY = { intro: 1, verse: 1, prechorus: 2, chorus: 3, bridge: 2, tag: 3, instrumental: 2, breakdown: 1, outro: 1, other: 2 };
  function typeOf(name) {
    if (global.PPColors) return global.PPColors.typeOf(name);
    var n = String(name || "").toLowerCase();
    return /intro/.test(n) ? "intro" : /pre/.test(n) ? "prechorus" : /chorus|refrain/.test(n) ? "chorus" : /verse/.test(n) ? "verse" : /bridge/.test(n) ? "bridge" : /tag|vamp/.test(n) ? "tag" : /outro|ending|end/.test(n) ? "outro" : /instrumental|interlude|solo|turn/.test(n) ? "instrumental" : /breakdown|quiet/.test(n) ? "breakdown" : "other";
  }
  function sectionList(ctx) { return (ctx.sections || []).filter(function (s) { return s && s.bar >= 1; }).slice().sort(function (a, b) { return a.bar - b.bar; }); }
  function sectionAt(ctx, beat) { var bpb = ctx.bpb || 4, cur = null; sectionList(ctx).forEach(function (s) { if ((s.bar - 1) * bpb <= beat + 1e-6) cur = s; }); return cur; }
  function energy(ctx, beat) { var s = sectionAt(ctx, beat); return s ? (ENERGY[typeOf(s.name)] || 2) : 2; }
  function marks(ctx) { return sectionList(ctx).map(function (s) { return { bar: s.bar, text: s.name }; }); }

  // ---------------------------------------------------------------- voicing helpers
  function nearestPc(pcs, prev, lo, hi) {
    var best = null; for (var m = lo; m <= hi; m++) { if (pcs.indexOf(((m % 12) + 12) % 12) < 0) continue; var d = Math.abs(m - prev); if (!best || d < best.d) best = { m: m, d: d }; }
    return best ? best.m : Math.round((lo + hi) / 2);
  }
  function closeVoicing(ch, prevCenter, lo, hi) {
    var base = [ch.root, ch.third, ch.fifth], best = null;
    for (var inv = 0; inv < 3; inv++) {
      var pcs = base.slice(inv).concat(base.slice(0, inv));
      for (var oct = 3; oct <= 6; oct++) {
        var notes = [], last = -1;
        pcs.forEach(function (pc) { var m = oct * 12 + pc; while (m <= last) m += 12; notes.push(m); last = m; });
        if (notes[0] < lo || notes[2] > hi) continue;
        var center = (notes[0] + notes[2]) / 2, d = Math.abs(center - prevCenter);
        if (!best || d < best.d) best = { notes: notes, d: d };
      }
    }
    return best ? best.notes : [60 + ch.root, 60 + ch.third, 60 + ch.fifth];
  }
  function push(out, start, dur, midi, extra) { if (dur > 1e-6) out.push(Object.assign({ start: Math.round(start * 4) / 4, dur: Math.round(dur * 4) / 4, midi: midi, vel: 90 }, extra || {})); }
  function pulses(start, end, step, fn) { for (var t = start; t < end - 1e-6; t += step) fn(t, Math.min(step, end - t)); }

  // ---------------------------------------------------------------- written from the chords
  function genBass(ctx) {
    var out = [], prev = 36, sp = spans(ctx);
    sp.forEach(function (s, i) {
      var e = energy(ctx, s.start), root = nearestPc([s.ch.bass], prev, 28, 47), next = sp[i + 1], len = s.end - s.start; prev = root;
      if (e === 1 || len < 2) { push(out, s.start, len, root); return; }
      var step = e === 2 ? 2 : 1;
      pulses(s.start, s.end, step, function (t, d) {
        var m = root;
        if (e === 3 && next && t + d >= s.end - 1e-6 && len >= 2) { var nr = nearestPc([next.ch.bass], root, 28, 47); if (Math.abs(nr - root) > 2) m = nr + (nr > root ? -2 : 2); }
        push(out, t, d, m);
      });
    });
    return out;
  }
  function genKeys(ctx) {
    var rh = [], lh = [], center = 66, prevBass = 43;
    spans(ctx).forEach(function (s) {
      var e = energy(ctx, s.start), v = closeVoicing(s.ch, center, 57, 79), bass = nearestPc([s.ch.bass], prevBass, 36, 50); center = (v[0] + v[2]) / 2; prevBass = bass;
      var rstep = e === 1 ? s.end - s.start : e === 2 ? 2 : 1, lstep = e === 1 ? s.end - s.start : 2;
      pulses(s.start, s.end, rstep, function (t, d) { v.forEach(function (m) { push(rh, t, d, m); }); });
      pulses(s.start, s.end, lstep, function (t, d) { push(lh, t, d, bass); if (e >= 2) push(lh, t, d, bass + 12 <= 55 ? bass + 12 : bass); });
    });
    return { rh: rh, lh: dedupe(lh) };
  }
  function genGuide(ctx, inst) {
    var out = [], prev = Math.round((inst.low + inst.high) / 2), plays = inst.plays || 1;
    spans(ctx).forEach(function (s) {
      if (energy(ctx, s.start) < plays) return;
      var pcs = []; (inst.guide || ["third"]).forEach(function (g) { var pc = g === "root" ? s.ch.root : g === "third" ? s.ch.third : g === "fifth" ? s.ch.fifth : s.ch.seventh; if (pc != null && pcs.indexOf(pc) < 0) pcs.push(pc); });
      var m = nearestPc(pcs.slice(0, 2), prev, inst.low, inst.high); prev = m;
      push(out, s.start, s.end - s.start, m);
    });
    return out;
  }
  function genDrums(ctx) {
    var bpb = ctx.bpb || 4, bars = Math.max(1, ctx.bars || 1), out = [], secs = sectionList(ctx), starts = {};
    secs.forEach(function (s) { starts[s.bar] = true; });
    for (var b = 1; b <= bars; b++) {
      var t0 = (b - 1) * bpb, e = energy(ctx, t0), lastOfSection = starts[b + 1] && b > 1;
      var hatStep = e === 1 ? 1 : 0.5, four = bpb === 4;
      if (starts[b] && e >= 2) out.push({ start: t0, voice: "crash" });
      pulses(t0, t0 + bpb, hatStep, function (t) { if (!(starts[b] && e >= 2 && t === t0)) out.push({ start: t, voice: e === 3 ? "ride" : "hat" }); });
      out.push({ start: t0, voice: "kick" });
      if (four) {
        if (e === 1) out.push({ start: t0 + 2, voice: "snare" });
        else { out.push({ start: t0 + 1, voice: "snare" }, { start: t0 + 3, voice: "snare" }, { start: t0 + 2, voice: "kick" }); if (e === 3) out.push({ start: t0 + 1.5, voice: "kick" }); }
      } else { out.push({ start: t0 + Math.floor(bpb / 2), voice: "snare" }); }
      if (lastOfSection && e >= 1 && bpb >= 3) {   // a fill into the next section
        out = out.filter(function (n) { return !(n.start >= t0 + bpb - 1 - 1e-6 && n.start < t0 + bpb && (n.voice === "hat" || n.voice === "ride" || n.voice === "snare")); });
        pulses(t0 + bpb - 1, t0 + bpb, e === 3 ? 0.25 : 0.5, function (t, d) { out.push({ start: t, voice: t - (t0 + bpb - 1) < 0.5 ? "snare" : "tom" }); });
      }
    }
    (ctx.hits || []).forEach(function (h) { var q = Math.round(h * 2) / 2; if (q >= 0 && q < bars * bpb) out.push({ start: q, voice: "crash", accent: true }, { start: q, voice: "kick" }); });
    return dedupeDrums(out);
  }
  function dedupe(notes) { var seen = {}; return notes.filter(function (n) { var k = n.start + ":" + n.midi; if (seen[k]) return false; seen[k] = 1; return true; }); }
  function dedupeDrums(list) { var seen = {}; return list.filter(function (n) { var k = n.start + ":" + n.voice; if (seen[k]) return false; seen[k] = 1; return true; }).sort(function (a, b) { return a.start - b.start; }); }

  // ---------------------------------------------------------------- from the tracks
  function findStem(ctx, inst) {
    var stems = ctx.stems || [], tr = ctx.transcriptions || {};
    var cands = stems.filter(function (s) { return (inst.role && s.role === inst.role) || (inst.match && inst.match.test(s.name || "")); });
    if (inst.id === "vocals") cands.sort(function (a, b) { return (/lead|\blv\b|melody/i.test(b.name) ? 1 : 0) - (/lead|\blv\b|melody/i.test(a.name) ? 1 : 0); });
    var withTr = cands.filter(function (s) { return tr[s.id] && tr[s.id].notes && tr[s.id].notes.length; });
    return { stem: withTr[0] || cands[0] || null, transcribed: !!withTr[0] };
  }
  function fitRange(notes, lo, hi) {   // move a transcribed line by octaves into the instrument's range
    if (!notes.length) return notes;
    var mid = notes.reduce(function (a, n) { return a + n.midi; }, 0) / notes.length, want = (lo + hi) / 2, shift = Math.round((want - mid) / 12) * 12;
    return notes.map(function (n) { var m = n.midi + shift; while (m < lo) m += 12; while (m > hi) m -= 12; return Object.assign({}, n, { midi: m }); });
  }

  // lyrics under a vocal line: the words with their times (heard), or the chart's words spread over the notes
  function attachLyrics(ctx, notes) {
    var onsets = []; notes.forEach(function (n) { if (!onsets.length || Math.abs(onsets[onsets.length - 1] - n.start) > 1e-6) onsets.push(n.start); });
    if (ctx.words && ctx.words.length) {
      var used = {}, out = [];
      ctx.words.forEach(function (w) {
        var best = null; onsets.forEach(function (o) { var d = Math.abs(o - w.beat); if (d <= 0.75 && !used[o] && (!best || d < best.d)) best = { o: o, d: d }; });
        var at = best ? best.o : Math.round(w.beat * 2) / 2; if (best) used[best.o] = 1; out.push({ beat: at, text: w.text });
      });
      return { lyrics: out, approx: false };
    }
    if (!ctx.chartText || !C) return { lyrics: [], approx: false };
    var parsed = C.parseChart(ctx.chartText), bpb = ctx.bpb || 4, secs = sectionList(ctx), out2 = [];
    var bySection = {}; parsed.sections.forEach(function (sec) { var words = []; sec.lines.forEach(function (l) { l.tokens.forEach(function (t) { String(t.t || "").trim().split(/\s+/).forEach(function (w) { if (w) words.push(w); }); }); }); (bySection[sec.name.toLowerCase()] = bySection[sec.name.toLowerCase()] || []).push(words); });
    var usedCount = {};
    secs.forEach(function (s, i) {
      var key = String(s.name).toLowerCase(), lists = bySection[key] || bySection[key.replace(/\s*\d+$/, "")]; if (!lists) return;
      var n = usedCount[key] || 0, words = lists[Math.min(n, lists.length - 1)]; usedCount[key] = n + 1;
      var a = (s.bar - 1) * bpb, b = secs[i + 1] ? (secs[i + 1].bar - 1) * bpb : Infinity, here = onsets.filter(function (o) { return o >= a - 1e-6 && o < b; });
      words.forEach(function (w, wi) { if (wi < here.length) out2.push({ beat: here[wi], text: w }); else if (here.length) out2[out2.length - 1].text += " " + w; });
    });
    return { lyrics: out2, approx: true };
  }

  // no chords heard yet but a chart: its chords spread over the song's sections (a bar line "| G | D |" is a bar)
  function chordsFromChart(ctx) {
    if (!C || !ctx.chartText) return ctx;
    var parsed = C.parseChart(ctx.chartText), bpb = ctx.bpb || 4, chartSecs = parsed.sections.map(function (sec) {
      var items = [];
      sec.lines.forEach(function (l) { if (l.bars) l.tokens.forEach(function (b) { items.push({ chords: b.chords.slice(), bar: true }); }); else l.tokens.forEach(function (t) { if (t.c) items.push({ chords: [t.c], bar: false }); }); });
      return { name: sec.name, items: items };
    }).filter(function (x) { return x.items.length; });
    if (!chartSecs.length) return ctx;
    var songSecs = sectionList(ctx), plan = [], used = {};
    function find(name) { var k = String(name).toLowerCase(), base = k.replace(/\s*\d+$/, ""), hits = chartSecs.filter(function (c) { return c.name.toLowerCase() === k; }); if (!hits.length) hits = chartSecs.filter(function (c) { return c.name.toLowerCase().replace(/\s*\d+$/, "") === base; }); if (!hits.length) return null; var n = used[base] || 0; used[base] = n + 1; return hits[Math.min(n, hits.length - 1)]; }
    if (songSecs.length) songSecs.forEach(function (ss, i) { var cs = find(ss.name); if (!cs) return; var endBar = songSecs[i + 1] ? songSecs[i + 1].bar : Math.max(ss.bar + 1, (ctx.bars || ss.bar) + 1); plan.push({ name: ss.name, bar: ss.bar, bars: Math.max(1, endBar - ss.bar), items: cs.items }); });
    else { var bar = 1; chartSecs.forEach(function (cs) { var bars = cs.items.length; plan.push({ name: cs.name, bar: bar, bars: bars, items: cs.items }); bar += bars; }); }
    var chords = [];
    plan.forEach(function (p) {
      var beats = p.bars * bpb, allBars = p.items.every(function (it) { return it.bar; }), per = allBars ? bpb : Math.max(2, Math.round(beats / p.items.length / 2) * 2), at = 0;
      p.items.forEach(function (it) {
        var step = per / it.chords.length;
        it.chords.forEach(function (c, ci) { var b = at + ci * step; if (b < beats) chords.push({ bar: p.bar + Math.floor(b / bpb), beat: Math.floor(b % bpb) + 1, label: c }); });
        at += per;
      });
    });
    // a chart written in another key than the song is played in: its chords move to the song's key
    var chartKey = String(parsed.key || ctx.key || "C").replace(/m$/, ""), songKey = String(ctx.key || chartKey).replace(/m$/, "");
    var shift = (C.noteIndex(songKey) - C.noteIndex(chartKey) + 12) % 12;
    if (shift) { var flats = C.keyPrefersFlats(ctx.key || songKey); chords.forEach(function (c) { try { c.label = C.transpose(c.label, shift, flats); } catch (_) { } }); }
    var bars = Math.max(ctx.bars || 1, plan.reduce(function (a, p) { return Math.max(a, p.bar + p.bars - 1); }, 1));
    return Object.assign({}, ctx, { chords: chords, sections: songSecs.length ? ctx.sections : plan.map(function (p) { return { name: p.name, bar: p.bar }; }), bars: bars, estimated: true });
  }

  // ---------------------------------------------------------------- one part
  function transposeLabel(label, shift, key) {
    if (!shift || !C) return label;
    var written = C.noteName(C.noteIndex(key || "C") + shift, true), flats = C.keyPrefersFlats(written);
    try { return C.transpose(label, shift, flats); } catch (_) { return label; }
  }
  function build(ctx, id) {
    if (!(ctx.chords || []).length && ctx.chartText) ctx = chordsFromChart(ctx);
    var inst = instrument(id), bpb = ctx.bpb || 4, shift = inst.shift || 0;
    var part = { id: inst.id, name: inst.name, views: inst.views.slice(), source: "chart", bpb: bpb, bars: ctx.bars || 1, key: ctx.key || "C", shift: shift, clef: inst.clef || "auto", marks: marks(ctx), warn: [] };
    part.writtenKey = shift && C ? C.noteName(C.noteIndex(ctx.key || "C") + shift, C.keyPrefersFlats(C.noteName(C.noteIndex(ctx.key || "C") + shift, true))) + (/m$/.test(ctx.key || "") ? "m" : "") : (ctx.key || "C");
    part.chords = (ctx.chords || []).filter(function (c) { return c.label && c.label !== "N"; }).map(function (c) { return { bar: c.bar, beat: c.beat || 1, label: transposeLabel(c.label + (c.bass && String(c.label).indexOf("/") < 0 ? "/" + c.bass : ""), shift, ctx.key) }; });
    if (ctx.estimated && inst.id !== "chords" && inst.id !== "nashville") part.warn.push("Bars estimated from the chart - when the Central Pedal has listened to the tracks the chords land exactly.");
    if (inst.id === "chords" || inst.id === "nashville") { part.kind = "chart"; part.nashville = inst.id === "nashville"; if (!ctx.chartText && !(ctx.chords || []).length) part.warn.push("No chart yet: upload one, or let the Central Pedal listen to the tracks and write it."); return part; }
    var found = inst.id === "drums" || inst.views[0] === "notation" || inst.id === "guitar" ? findStem(ctx, inst) : { stem: null };
    if (inst.id === "drums") {
      part.kind = "drums";
      if (found.stem && ctx.drums && (ctx.drums.kick || []).length) { part.source = "stem"; part.stemName = found.stem.name; part.drums = [].concat((ctx.drums.kick || []).map(function (b) { return { start: b, voice: "kick" }; }), (ctx.drums.snare || []).map(function (b) { return { start: b, voice: "snare" }; }), (ctx.drums.hat || []).map(function (b) { return { start: b, voice: "hat" }; }), (ctx.drums.crash || []).map(function (b) { return { start: b, voice: "crash" }; })); part.drums = dedupeDrums(part.drums); }
      else { part.drums = genDrums(ctx); if (found.stem) part.warn.push("Written from the sections - transcribe the " + found.stem.name + " track for the exact groove."); }
      return part;
    }
    var tr = found.stem && found.transcribed ? ctx.transcriptions[found.stem.id] : null;
    if (tr) { part.source = "stem"; part.stemName = found.stem.name; }
    else if (found.stem) part.warn.push("Written from the chords - transcribe the \"" + found.stem.name + "\" track for what it really plays.");
    if (inst.id === "keys") {
      part.kind = "grand";
      if (tr) { var all = tr.notes.filter(function (n) { return n.dur > 0; }); part.rh = all.filter(function (n) { return n.midi >= 60; }); part.lh = all.filter(function (n) { return n.midi < 60; }); }
      else { var k = genKeys(ctx); part.rh = k.rh; part.lh = k.lh; }
      return part;
    }
    if (inst.id === "guitar") {
      part.kind = "guitar";
      part.notes = tr ? fitRange(tr.notes, inst.low, inst.high) : [];
      if (!tr) part.views = ["chart"];
      return part;
    }
    part.kind = "single";
    if (inst.id === "vocals") {
      if (!tr) { part.kind = "chart"; part.views = ["chart"]; part.warn = ["No vocal track to hear the melody from - this is the lead sheet (words and chords)."]; return part; }
      part.notes = fitRange(tr.notes.filter(function (n) { return n.dur > 0; }), inst.low, inst.high);
      var ly = attachLyrics(ctx, part.notes); part.lyrics = ly.lyrics; if (ly.approx && ly.lyrics.length) part.warn.push("Words placed from the chart - let the PC listen to the vocal for exact timing.");
      return part;
    }
    if (inst.id === "bass") part.notes = tr ? fitRange(tr.notes, inst.low, inst.high) : genBass(ctx);
    else part.notes = tr ? fitRange(tr.notes, inst.low, inst.high) : genGuide(ctx, inst);
    if (!part.notes.length) part.warn.push("Nothing to play from the chords in this song" + (inst.plays > 1 ? " (horns rest in quiet sections)" : "") + ".");
    return part;
  }

  // ---------------------------------------------------------------- guitar chord shapes
  var OPEN = { C: "x32010", D: "xx0232", Dm: "xx0231", D7: "xx0212", E: "022100", Em: "022000", E7: "020100", F: "133211", G: "320003", G7: "320001", A: "x02220", Am: "x02210", A7: "x02020", Am7: "x02010", Em7: "022030", Dm7: "xx0211",
    Cmaj7: "x32000", Fmaj7: "xx3210", Dsus4: "xx0233", Dsus2: "xx0230", Asus4: "x02230", Asus2: "x02200", Esus4: "022200", Cadd9: "x32033", "G/B": "x20003", "C/E": "032010", "D/F#": "200232", "C/G": "332010", "A/C#": "x42220",
    Bm: "x24432", B7: "x21202", Bb: "x13331", Gsus4: "330013", G6: "320000", Am9: "x02413", Dmaj7: "xx0222", Amaj7: "x02120", Emaj7: "021100", Gmaj7: "320002", Fadd9: "xx3213", "G/D": "xx0003", "Em/G": "320000", "E/G#": "4x2100" };
  function shape(label) {
    if (OPEN[label]) return { frets: OPEN[label], base: 1 };
    var ch = parseChord(label); if (!ch) return null;
    var minor = ch.minor, sev = ch.seventh != null && ch.seventh === (ch.root + 10) % 12;
    var e6 = (ch.root - 4 + 12) % 12 || 12, a5 = (ch.root - 9 + 12) % 12 || 12;   // fret of the root on the low E / A string
    var useE = e6 <= a5 + 1 && e6 <= 9;
    var f = useE ? e6 : a5, rel;
    if (useE) rel = minor ? [0, 2, 2, 0, 0, 0] : sev ? [0, 2, 0, 1, 0, 0] : [0, 2, 2, 1, 0, 0];
    else rel = minor ? [null, 0, 2, 2, 1, 0] : sev ? [null, 0, 2, 0, 2, 0] : [null, 0, 2, 2, 2, 0];
    return { frets: rel.map(function (r) { return r == null ? "x" : String(f + r); }), base: f };
  }
  function diagramSvg(label) {
    var sh = shape(label); if (!sh) return "";
    var frets = Array.isArray(sh.frets) ? sh.frets : sh.frets.split(""), nums = frets.map(function (x) { return x === "x" ? null : Number(x); });
    var played = nums.filter(function (n) { return n != null && n > 0; }), lo = played.length ? Math.min.apply(null, played) : 1, hi = played.length ? Math.max.apply(null, played) : 1;
    var start = hi <= 4 ? 1 : lo, W = 58, H = 74, x0 = 9, y0 = 18, dx = 8, dy = 11, out = [];
    out.push('<svg class="chord-diagram" viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '"><text class="cd-name" x="' + (W / 2) + '" y="10">' + esc(C ? C.pretty(label) : label) + "</text>");
    for (var s = 0; s < 6; s++) out.push('<line class="cd-l" x1="' + (x0 + s * dx) + '" y1="' + y0 + '" x2="' + (x0 + s * dx) + '" y2="' + (y0 + 5 * dy) + '"/>');
    for (var r = 0; r <= 5; r++) out.push('<line class="' + (r === 0 && start === 1 ? "cd-nut" : "cd-l") + '" x1="' + x0 + '" y1="' + (y0 + r * dy) + '" x2="' + (x0 + 5 * dx) + '" y2="' + (y0 + r * dy) + '"/>');
    if (start > 1) out.push('<text class="cd-fr" x="' + (x0 + 5 * dx + 3) + '" y="' + (y0 + dy * 0.8) + '">' + start + "fr</text>");
    nums.forEach(function (n, si) { var x = x0 + si * dx; if (n == null) out.push('<text class="cd-x" x="' + x + '" y="' + (y0 - 3) + '">×</text>'); else if (n === 0) out.push('<circle class="cd-o" cx="' + x + '" cy="' + (y0 - 5) + '" r="2.4"/>'); else out.push('<circle class="cd-dot" cx="' + x + '" cy="' + (y0 + (n - start + 0.5) * dy) + '" r="3.3"/>'); });
    out.push("</svg>"); return out.join("");
  }

  // ---------------------------------------------------------------- drawing
  function writtenNotes(notes, shift) { return shift ? notes.map(function (n) { return Object.assign({}, n, { midi: n.midi + shift }); }) : notes; }
  function totalBeats(notes, bpb) { var t = 0; notes.forEach(function (n) { t = Math.max(t, n.start + (n.dur || 0)); }); return Math.ceil((t + 1e-6) / bpb) * bpb; }
  function chunk(notes, from, to) { return notes.filter(function (n) { return n.start < to - 1e-6 && n.start + n.dur > from + 1e-6; }).map(function (n) { var s = Math.max(n.start, from), e = Math.min(n.start + n.dur, to); return Object.assign({}, n, { start: s - from, dur: e - s }); }); }
  function marksSvgless(part, from, to) { var bpb = part.bpb; return (part.marks || []).filter(function (m) { var b = (m.bar - 1) * bpb; return b >= from && b < to; }); }
  function systemHeader(part, from, to) {
    var m = marksSvgless(part, from, to); return m.length ? '<div class="pt-marks">' + m.map(function (x) { return "<span>" + esc(x.text) + " <small>bar " + x.bar + "</small></span>"; }).join("") + "</div>" : "";
  }
  function renderSingle(part, notes, opts) {
    var NN = N(); if (!NN) return "";
    var bpb = part.bpb, per = opts.barsPerLine, total = Math.max(totalBeats(notes, bpb), (part.bars || 1) * bpb, bpb), html = [];
    for (var from = 0, li = 0; from < total; from += per * bpb, li++) {
      var to = from + per * bpb, bars = Math.round((Math.min(to, total) - from) / bpb);
      var lyr = part.lyrics ? part.lyrics.filter(function (w) { return w.beat >= from && w.beat < to; }).map(function (w) { return { beat: w.beat - from, text: w.text }; }) : null;
      html.push('<div class="pt-system">' + systemHeader(part, from, to) + NN.renderNotation(chunk(notes, from, to), { key: part.writtenKey, beatsPerBar: bpb, barsPerLine: per, width: opts.width, chords: part.chords, clef: opts.clef || part.clef, barOffset: from / bpb, showTime: li === 0, lyrics: lyr && lyr.length ? lyr : null, minBars: bars }) + "</div>");
    }
    return html.join("");
  }
  function renderGrand(part, opts) {
    var NN = N(); if (!NN) return "";
    var bpb = part.bpb, per = opts.barsPerLine, rh = part.rh || [], lh = part.lh || [], total = Math.max(totalBeats(rh, bpb), totalBeats(lh, bpb), (part.bars || 1) * bpb, bpb), html = [];
    for (var from = 0, li = 0; from < total; from += per * bpb, li++) {
      var to = from + per * bpb, bars = Math.round((Math.min(to, total) - from) / bpb);
      var o = { key: part.writtenKey, beatsPerBar: bpb, barsPerLine: per, width: opts.width, barOffset: from / bpb, showTime: li === 0, minBars: bars };
      // both staves get the same number of bars, so their bar lines line up
      html.push('<div class="pt-system grand">' + systemHeader(part, from, to) + NN.renderNotation(chunk(rh, from, to), Object.assign({}, o, { clef: "treble", chords: part.chords })) + NN.renderNotation(chunk(lh, from, to), Object.assign({}, o, { clef: "bass" })) + "</div>");
    }
    return html.join("");
  }
  // drums: one staff, kick below, snare in the middle, hi-hat / ride / crash on top as x
  var DRUM_STEP = { kick: 1, tom: 6, snare: 5, hat: 9, ride: 8, crash: 10 };
  function renderDrums(part, opts) {
    var bpb = part.bpb, per = opts.barsPerLine, S = 8, beatW = 34, pad = 16, list = part.drums || [];
    var total = Math.max(bpb, Math.ceil((list.reduce(function (a, n) { return Math.max(a, n.start); }, 0) + 1e-6) / bpb) * bpb), html = [];
    for (var from = 0; from < total; from += per * bpb) {
      var to = Math.min(total, from + per * bpb), bars = Math.round((to - from) / bpb), top = 30, left = 10, W = left + 40 + bars * (bpb * beatW + pad) + 10, out = [];
      out.push('<svg class="notation drums" viewBox="0 0 ' + W + " " + (top + 7 * S) + '" width="' + W + '" height="' + (top + 7 * S) + '">');
      for (var s = 0; s < 5; s++) out.push('<line class="n-line" x1="' + left + '" y1="' + (top + s * S) + '" x2="' + (W - 10) + '" y2="' + (top + s * S) + '"/>');
      out.push('<rect class="n-glyph" x="' + (left + 8) + '" y="' + (top + S) + '" width="3" height="' + (2 * S) + '"/><rect class="n-glyph" x="' + (left + 14) + '" y="' + (top + S) + '" width="3" height="' + (2 * S) + '"/>');
      var x = left + 40;
      for (var b = 0; b < bars; b++) {
        var bar0 = from + b * bpb, mx = x;
        out.push('<line class="n-bar" x1="' + (mx - pad / 2) + '" y1="' + top + '" x2="' + (mx - pad / 2) + '" y2="' + (top + 4 * S) + '"/><text class="n-num" x="' + (mx - pad / 2 + 2) + '" y="' + (top - 3) + '">' + (bar0 / bpb + 1) + "</text>");
        (part.marks || []).forEach(function (m) { if ((m.bar - 1) * bpb === bar0) out.push('<text class="n-mark" x="' + (mx - pad / 2 + 2) + '" y="' + (top - S * 2) + '">' + esc(m.text) + "</text>"); });
        for (var beat = 0; beat < bpb; beat++) {
          var bs = bar0 + beat, hits = list.filter(function (n) { return n.start >= bs - 1e-6 && n.start < bs + 1 - 1e-6; });
          var upper = hits.filter(function (n) { return n.voice !== "kick"; }), lower = hits.filter(function (n) { return n.voice === "kick"; });
          var times = {}; upper.forEach(function (n) { (times[n.start] = times[n.start] || []).push(n); });
          var keys = Object.keys(times).map(Number).sort(function (a, c) { return a - c; }), stemTop = top - S * 1.6;
          keys.forEach(function (t) {
            var hx = mx + (t - bar0) * beatW;
            times[t].forEach(function (n) { var y = top + 4 * S - DRUM_STEP[n.voice] * S / 2; if (n.voice === "snare" || n.voice === "tom") out.push('<ellipse class="n-glyph" cx="' + hx + '" cy="' + y + '" rx="' + (S * 0.62) + '" ry="' + (S * 0.45) + '"/>'); else out.push('<path class="n-x" d="M' + (hx - 3.5) + " " + (y - 3.5) + " l7 7 m0 -7 l-7 7\"/>"); if (n.voice === "crash" || n.voice === "ride" && n.accent) out.push('<line class="n-line" x1="' + (hx - 6) + '" y1="' + (top - S) + '" x2="' + (hx + 6) + '" y2="' + (top - S) + '"/>'); if (n.accent) out.push('<text class="n-acc" x="' + (hx - 4) + '" y="' + (stemTop - 4) + '">&gt;</text>'); });
            out.push('<line class="n-stem" x1="' + (hx + S * 0.55) + '" y1="' + stemTop + '" x2="' + (hx + S * 0.55) + '" y2="' + (top + 4 * S - Math.min.apply(null, times[t].map(function (n) { return DRUM_STEP[n.voice]; })) * S / 2) + '"/>');
          });
          if (keys.length > 1) { var x1 = mx + (keys[0] - bar0) * beatW + S * 0.55, x2 = mx + (keys[keys.length - 1] - bar0) * beatW + S * 0.55; out.push('<line class="n-beam" x1="' + x1 + '" y1="' + stemTop + '" x2="' + x2 + '" y2="' + stemTop + '"/>'); if (keys.length > 2) out.push('<line class="n-beam" x1="' + x1 + '" y1="' + (stemTop + 5) + '" x2="' + x2 + '" y2="' + (stemTop + 5) + '"/>'); }
          if (!keys.length) { var rx = mx + beat * beatW; out.push('<path class="n-glyphs" fill="none" stroke-width="2" d="M' + rx + " " + (top + S * 0.8) + " l " + (S * 0.7) + " " + (S * 0.9) + " l " + (-S * 0.6) + " " + (S * 0.7) + " l " + (S * 0.6) + " " + (S * 0.8) + '"/>'); }
          lower.forEach(function (n) { var hx = mx + (n.start - bar0) * beatW, y = top + 4 * S - DRUM_STEP.kick * S / 2; out.push('<ellipse class="n-glyph" cx="' + hx + '" cy="' + y + '" rx="' + (S * 0.62) + '" ry="' + (S * 0.45) + '"/><line class="n-stem" x1="' + (hx - S * 0.55) + '" y1="' + y + '" x2="' + (hx - S * 0.55) + '" y2="' + (y + S * 3) + '"/>'); });
        }
        x += bpb * beatW + pad;
      }
      out.push('<line class="n-bar" x1="' + (x - pad / 2) + '" y1="' + top + '" x2="' + (x - pad / 2) + '" y2="' + (top + 4 * S) + '"/></svg>');
      html.push(out.join(""));
    }
    return '<p class="pt-key muted small">Kick below the staff lines · snare in the middle · × hi-hat / ride on top, crash above with a line · fills before each new section.</p>' + html.join("");
  }
  function chartHtml(part, ctx, opts) {
    var text = ctx.chartText || (C && (ctx.chords || []).length ? C.chartFromChords((ctx.chords || []).map(function (c) { return { label: c.label, bass: c.bass, bar: c.bar, beat: c.beat || 1 }; }), sectionList(ctx).map(function (s) { return { name: s.name, bar: s.bar, lyrics: "" }; }), Math.max(1, ctx.bars || 1), part.bpb, { title: ctx.name || "", key: ctx.key }) : "");
    if (!text || !C) return '<p class="muted">No chart for this song yet.</p>';
    var parsed = C.parseChart(text), instId = part.id === "guitar" ? "guitar" : part.id === "nashville" || part.id === "chords" || part.id === "vocals" || part.id === "keys" || part.id === "bass" ? "concert" : "concert";
    if (part.shift) { var match = C.INSTRUMENTS.filter(function (i) { return i.shift === part.shift && !i.capo; })[0]; if (match) instId = match.id; }
    var v = C.view({ chartKey: parsed.key || ctx.key || "C", songKey: ctx.key || parsed.key || "C", instrument: opts.instrument || instId, nashville: !!part.nashville, mode: ctx.mode, shape: opts.shape });
    var head = "";
    if (part.id === "guitar") {
      var names = {}; parsed.sections.forEach(function (sec) { sec.lines.forEach(function (l) { l.tokens.forEach(function (t) { if (t.c) names[v.chord(t.c)] = 1; }); }); });
      head = '<div class="pt-diagrams">' + Object.keys(names).filter(Boolean).slice(0, 24).map(diagramSvg).join("") + "</div>";
    }
    var note = part.nashville ? "Numbers against " + (ctx.key || parsed.key || "") : v.capo ? "Capo " + v.capo + " · play " + v.writtenKey + " shapes" : v.instrument && v.instrument.shift ? "Written in " + v.writtenKey : "";
    return (note ? '<p class="pt-note">' + esc(C.pretty(note)) + "</p>" : "") + head + '<div class="chart-view">' + C.renderChart(parsed, { view: v }) + "</div>";
  }
  function render(part, view, opts) {
    opts = opts || {}; var ctx = opts.ctx || {}, width = opts.width || 900, per = Math.max(2, Math.min(6, Math.floor(width / 190)));
    var o = { width: width, barsPerLine: per, clef: opts.clef && opts.clef !== "auto" ? opts.clef : part.clef !== "auto" ? part.clef : null };   // (a musician can pick their own clef)
    view = view && part.views.indexOf(view) >= 0 ? view : part.views[0];
    var head = '<div class="pt-head"><b>' + esc(part.name) + "</b>" + (part.shift ? ' <span class="muted small">written in ' + esc(C ? C.pretty(part.writtenKey) : part.writtenKey) + " (sounds in " + esc(C ? C.pretty(part.key) : part.key) + ")</span>" : "") +
      ' <span class="pt-src ' + part.source + '">' + (part.source === "stem" ? "from the " + esc(part.stemName) + " track" : part.kind === "chart" ? "chart" : "written from the chords") + "</span></div>" +
      (part.warn && part.warn.length ? '<p class="pt-warn">' + part.warn.map(esc).join("<br>") + "</p>" : "");
    var body = "";
    if (view === "chart") body = chartHtml(part, ctx, opts);
    else if (view === "drums") body = renderDrums(part, o);
    else if (view === "tab") { var NN = N(); body = NN ? NN.renderTab(writtenNotes(part.notes || [], 0), { key: part.writtenKey, beatsPerBar: part.bpb, barsPerLine: per, width: width, strings: part.id === "bass" ? 4 : 6 }) : ""; }
    else if (part.kind === "grand") body = renderGrand(part, o);
    else body = renderSingle(part, writtenNotes(part.notes || [], part.shift), o);
    return head + '<div class="pt-paper">' + (body || '<p class="muted">Nothing to show.</p>') + "</div>";
  }

  // ---------------------------------------------------------------- the song's context (Central Pedal side)
  function shiftLabel(label, n, key) { if (!n || !C || !label || label === "N") return label; try { return C.transpose(label, n, C.keyPrefersFlats(key || "C")); } catch (_) { return label; } }
  function shiftNote(note, n, key) { if (!n || !C) return note; var i = C.noteIndex(note); return i < 0 ? note : C.noteName(i + n + 1200, C.keyPrefersFlats(key || "C")); }
  function shiftTranscriptions(tr, n) { var out = {}; Object.keys(tr).forEach(function (k) { var x = tr[k]; out[k] = x && Array.isArray(x.notes) ? Object.assign({}, x, { notes: x.notes.map(function (q) { return Object.assign({}, q, { midi: q.midi + n }); }) }) : x; }); return out; }
  function contextOf(s, t, g, extra) {
    extra = extra || {}; if (!s) return null;
    var bpb = (g && g.bpb) || (t && t.grid && t.grid.bpb) || 4, bars = 1;
    if (t && g && t.duration) { var n = 0; (g.bars || []).forEach(function (b) { if (b <= t.duration) n++; }); bars = Math.max(1, n); }
    (t && t.chords || []).forEach(function (c) { bars = Math.max(bars, c.bar); });
    (t && t.sections || []).forEach(function (q) { bars = Math.max(bars, q.bar); });
    var first = g && g.bars && g.bars.length ? g.bars[0] : 0, period = g && g.period ? g.period : 60 / (s.bpm || 100);
    var toBeat = function (sec) { return (sec - first) / period; }, ks = t && t.keyShift ? Math.round(t.keyShift) : 0;
    return {
      name: s.name, key: s.key, mode: t && t.originalMode, bpb: bpb, bpm: s.bpm, bars: bars,
      // what was heard in the tracks moves with them when they play in another key (keyShift: semitones from the recording)
      chords: (t && t.chords || []).map(function (c) { return { bar: c.bar, beat: c.beat, label: shiftLabel(c.label, ks, s.key), bass: c.bass ? shiftNote(c.bass, ks, s.key) : null }; }),
      sections: (t && t.sections || []).map(function (q) { return { name: q.name, bar: q.bar }; }),
      hits: (t && t.hits || []).map(function (h) { return Math.round(toBeat(h) * 4) / 4; }).filter(function (b) { return b >= 0; }),
      words: (t && t.words || []).map(function (w) { return { beat: Math.round(toBeat(w.start) * 4) / 4, text: w.text }; }).filter(function (w) { return w.beat >= 0; }),
      chartText: extra.chartText || (t && t.chartText) || "",
      stems: (t && t.stems || []).map(function (st) { return { id: st.id, name: st.name, role: st.role || "" }; }),
      transcriptions: ks ? shiftTranscriptions(t && t.transcriptions || {}, ks) : (t && t.transcriptions || {}), drums: t && t.drums || null
    };
  }

  var api = { chordsFromChart: chordsFromChart, INSTRUMENTS: INSTRUMENTS, instrument: instrument, parseChord: parseChord, spans: spans, build: build, render: render, contextOf: contextOf, diagramSvg: diagramSvg, shape: shape,
    findStem: findStem, energy: energy, genBass: genBass, genKeys: genKeys, genGuide: genGuide, genDrums: genDrums };
  global.PPParts = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
