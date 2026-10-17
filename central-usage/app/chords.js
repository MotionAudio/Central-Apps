/* Central Control / Central Usage - chord symbols, chart text, transposition,
 * capo + transposing instruments, Nashville numbers, and (in Central Control)
 * "listen and write the chord chart" from the song's audio.
 * The core (PPChords.*) has no app dependencies so the companion apps share it. */
(function (global) {
  "use strict";
  var KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  var FLATS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
  var FLAT_KEYS = { F: 1, Bb: 1, Eb: 1, Ab: 1, Db: 1, Gb: 1, Cb: 1, Dm: 1, Gm: 1, Cm: 1, Fm: 1, Bbm: 1, Ebm: 1, Abm: 1 };
  var NOTE_INDEX = { C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, Fb: 4, F: 5, "E#": 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11, Cb: 11 };
  var CHORD_RE = /^\(?([A-G](?:#|b|♯|♭)?)((?:maj|min|dim|aug|sus|add|m|M|\+|°|ø|-|\d|\(|\)|#|b|♯|♭)*)(?:\/([A-G](?:#|b|♯|♭)?))?\)?$/;
  var SECTION_RE = /^\[?\s*(intro|verse|chorus|pre-?chorus|bridge|tag|outro|ending|interlude|instrumental|turnaround|vamp|refrain|hook|solo|breakdown|build|coda|pre|channel|post-?chorus)\s*(\d+|[a-d])?\s*\]?\s*:?\s*$/i;
  function norm(n) { return String(n || "").replace(/♯/g, "#").replace(/♭/g, "b"); }
  function noteIndex(n) { var k = norm(n); if (!k) return -1; k = k.length > 1 ? k[0].toUpperCase() + k.slice(1) : k.toUpperCase(); return NOTE_INDEX[k] != null ? NOTE_INDEX[k] : -1; }
  function noteName(i, flats) { return (flats ? FLATS : KEYS)[((i % 12) + 12) % 12]; }
  function pretty(n) { return String(n || "").replace(/#/g, "♯").replace(/([A-G])b/g, "$1♭"); }
  function keyPrefersFlats(key) { var k = norm(key || "C"); return !!FLAT_KEYS[k]; }
  function isChord(tok) { var t = norm(tok).replace(/[,.;:!?]+$/, ""); if (!t) return false; if (/^(a|am|be|me|do|go|no|so|up|as|ad)$/i.test(t) && t !== "Am" && t !== "A") return false; return CHORD_RE.test(t); }
  function parse(sym) {
    var m = CHORD_RE.exec(norm(sym).trim()); if (!m) return null;
    var q = m[2] || ""; if (q === "M") q = "maj"; if (q === "-") q = "m"; if (q === "min") q = "m";
    return { root: noteIndex(m[1]), quality: q, bass: m[3] ? noteIndex(m[3]) : -1, minor: /^(m(?!aj)|min|-)/.test(m[2] || "") };
  }
  function format(obj, flats) { if (!obj || obj.root < 0) return "N.C."; return noteName(obj.root, flats) + obj.quality + (obj.bass >= 0 ? "/" + noteName(obj.bass, flats) : ""); }
  function transpose(sym, n, flats) { var o = parse(sym); if (!o) return sym; o.root = (o.root + n + 1200) % 12; if (o.bass >= 0) o.bass = (o.bass + n + 1200) % 12; return format(o, flats); }
  var DEGREES = ["1", "b2", "2", "b3", "3", "4", "#4", "5", "b6", "6", "b7", "7"];
  function nashville(sym, key, mode) {
    var o = parse(sym); if (!o) return sym;
    var k = norm(key || "C"), ki = noteIndex(k.replace(/m$/, "")); if (ki < 0) ki = 0;
    if (mode === "minor" || /m$/.test(k)) ki = (ki + 3) % 12; // number against the relative major
    var deg = DEGREES[(o.root - ki + 12) % 12], q = o.quality.replace(/^m(?!aj)/, "-");
    return deg + q + (o.bass >= 0 ? "/" + DEGREES[(o.bass - ki + 12) % 12] : "");
  }

  // ---------------------------------------------------------------- transposing instruments + capo
  var INSTRUMENTS = [
    { id: "concert", name: "Concert pitch: piano, keys, vocals, bass, violin, cello, flute, oboe, trombone, tuba", shift: 0 },
    { id: "guitar", name: "Guitar (capo + chord shapes)", shift: 0, capo: true, shapes: ["G", "C", "D", "A", "E", "F", "Am", "Em", "Dm"] },
    { id: "ukulele", name: "Ukulele (capo + shapes)", shift: 0, capo: true, shapes: ["C", "G", "F", "D", "A", "Am", "Dm"] },
    { id: "banjo", name: "Banjo / mandolin (capo)", shift: 0, capo: true, shapes: ["G", "C", "D", "A", "E"] },
    { id: "Bb", name: "B♭ instruments: trumpet, cornet, flugelhorn, clarinet, tenor sax, soprano sax, bass clarinet", shift: 2 },
    { id: "Eb", name: "E♭ instruments: alto sax, baritone sax, E♭ clarinet, alto horn", shift: 9 },
    { id: "F", name: "F instruments: French horn, English horn", shift: 7 },
    { id: "A", name: "A clarinet", shift: 3 },
    { id: "G", name: "Alto flute (G)", shift: 5 },
    { id: "D", name: "D trumpet / piccolo trumpet", shift: 10 },
    { id: "BbTC", name: "B♭ treble-clef baritone / euphonium / tuba", shift: 2 },
    { id: "EbTC", name: "E♭ treble-clef tuba", shift: 9 }
  ];
  function instrument(id) { return INSTRUMENTS.filter(function (i) { return i.id === id; })[0] || INSTRUMENTS[0]; }
  function keyRoot(key) { return noteIndex(norm(key || "C").replace(/m$/, "")); }
  function isMinorKey(key) { return /m$/.test(norm(key || "")); }
  // what the player should see: the chart's chords moved to the song key, then to the instrument's written pitch,
  // or (capo instruments) to the chosen shape key with a capo on the right fret
  function view(opts) {
    opts = opts || {};
    var chartKey = opts.chartKey || opts.songKey || "C", songKey = opts.songKey || chartKey, inst = instrument(opts.instrument);
    var songIdx = keyRoot(songKey), minor = isMinorKey(songKey), toSong = (songIdx - keyRoot(chartKey) + 1200) % 12;
    var shift = toSong, capo = 0, shapeKey = null, writtenKey = songKey;
    if (inst.capo) {
      var want = opts.shape && opts.shape !== "auto" ? opts.shape : null;
      if (!want) { // the shape with the fewest frets of capo (never past 7); minor songs prefer minor shapes
        var best = null; inst.shapes.forEach(function (sh) { if (isMinorKey(sh) !== minor) return; var c = (songIdx - keyRoot(sh) + 1200) % 12; if (c <= 7 && (best === null || c < best.c)) best = { sh: sh, c: c }; });
        if (!best) inst.shapes.forEach(function (sh) { var c = (songIdx - keyRoot(sh) + 1200) % 12; if (best === null || c < best.c) best = { sh: sh, c: c }; });
        want = best ? best.sh : songKey;
      }
      capo = (songIdx - keyRoot(want) + 1200) % 12; shapeKey = want; shift = (toSong - capo + 1200) % 12; writtenKey = want;
    } else if (inst.shift) { shift = (toSong + inst.shift) % 12; var wi = (songIdx + inst.shift) % 12; writtenKey = noteName(wi, keyPrefersFlats(noteName(wi, false) + (minor ? "m" : "")) || keyPrefersFlats(noteName(wi, true) + (minor ? "m" : ""))) + (minor ? "m" : ""); }
    var flats = keyPrefersFlats(writtenKey);
    return { shift: shift, capo: capo, shapeKey: shapeKey, writtenKey: writtenKey, flats: flats, instrument: inst, songKey: songKey, chartKey: chartKey,
      chord: function (sym) { return opts.nashville ? nashville(transpose(sym, toSong, flats), songKey, opts.mode) : transpose(sym, shift, flats); } };
  }

  // ---------------------------------------------------------------- chart text -> structure
  // { title, key, capo, tempo, time, sections: [{ name, lines: [{ bars: false, tokens: [{ c: chord|null, t: text }] } | { bars: true, tokens: [{ chords: [..] }] }] }] }
  function parseChart(text) {
    var lines = String(text || "").replace(/\r/g, "").split("\n"), out = { title: null, key: null, capo: 0, tempo: null, time: null, sections: [] }, cur = null, i;
    function section(name) { cur = { name: name, lines: [] }; out.sections.push(cur); }
    function pushLine(tokens, bars) { if (!cur) section("Verse 1"); cur.lines.push({ tokens: tokens, bars: !!bars }); }
    for (i = 0; i < lines.length; i++) {
      var line = lines[i].replace(/\s+$/, "");
      if (!line.trim()) continue;
      var dm = /^\{\s*([a-z_]+)\s*:\s*(.*?)\s*\}$/i.exec(line.trim());
      if (dm) { var dk = dm[1].toLowerCase(), dv = dm[2]; if (dk === "title" || dk === "t") out.title = dv; else if (dk === "key") out.key = dv; else if (dk === "capo") out.capo = Number(dv) || 0; else if (dk === "tempo") out.tempo = Number(dv) || null; else if (dk === "time") out.time = dv; else if (dk === "c" || dk === "comment") pushLine([{ c: null, t: dv, comment: true }], false); continue; }
      var sm = SECTION_RE.exec(line.trim());
      if (sm) { var nm = sm[1].toLowerCase(); nm = nm.indexOf("pre") === 0 ? "Pre-Chorus" : nm.indexOf("post") === 0 ? "Post-Chorus" : nm[0].toUpperCase() + nm.slice(1); if (sm[2]) nm += " " + sm[2].toUpperCase(); section(nm); continue; }
      if (!out.key) { var km = /\bkey\s*(?:of|:|=)?\s*([A-G][#b♯♭]?m?)\b/i.exec(line); if (km) { out.key = norm(km[1]); if (/^(key|capo|tempo|bpm|time)\b/i.test(line.trim())) continue; } }
      if (!out.capo) { var cm = /\bcapo\s*:?\s*(\d+)/i.exec(line); if (cm) { out.capo = Number(cm[1]); if (/^capo/i.test(line.trim())) continue; } }
      if (/^(copyright|ccli|©|\(c\)|words and music|by |tempo\b|bpm\b|time\b|key\b|capo\b)/i.test(line.trim())) continue;
      if (/\[[A-G][^\]]*\]/.test(line)) { // ChordPro inline chords
        var toks = [], re = /\[([^\]]*)\]/g, last = 0, mm, pending = null;
        while ((mm = re.exec(line))) { var txt = line.slice(last, mm.index); if (pending !== null || txt) toks.push({ c: pending, t: txt }); pending = mm[1]; last = re.lastIndex; }
        toks.push({ c: pending, t: line.slice(last) });
        pushLine(toks.filter(function (t) { return t.c !== null || t.t; }), false); continue;
      }
      var words = line.trim().split(/\s+/).filter(function (w) { return w !== "|" && w !== "||" && w !== "%" && w !== "/" && w !== "-" && w !== "·"; });
      var chordy = words.filter(isChord).length;
      if (words.length && chordy / words.length >= 0.6) {
        var next = null, j = i + 1; while (j < lines.length && !lines[j].trim()) j++;
        if (line.indexOf("|") < 0 && j < lines.length && !SECTION_RE.test(lines[j].trim()) && !/^\{/.test(lines[j].trim()) && lines[j].indexOf("|") < 0 && !/\[[A-G][^\]]*\]/.test(lines[j])) { var nw = lines[j].trim().split(/\s+/); if (nw.length && nw.filter(isChord).length / nw.length < 0.6) next = lines[j]; }
        if (next !== null) { // chords above lyrics: align by column
          var cre = /\S+/g, cm2, toks2 = [], pos = [];
          while ((cm2 = cre.exec(line))) if (isChord(cm2[0])) pos.push({ col: cm2.index, c: norm(cm2[0]).replace(/[()]/g, "") });
          if (!pos.length || pos[0].col > 0) toks2.push({ c: null, t: next.slice(0, pos.length ? pos[0].col : next.length) });
          pos.forEach(function (p, k) { var end = k + 1 < pos.length ? pos[k + 1].col : Math.max(next.length, p.col); toks2.push({ c: p.c, t: next.slice(p.col, end) }); });
          pushLine(toks2.filter(function (t) { return t.c !== null || t.t.trim(); }), false); i = j; continue;
        }
        var btoks = [];
        if (line.indexOf("|") > -1) { var cells = line.split("|"); cells.forEach(function (cell, ci) { var cs = cell.trim(); if (!cs && (ci === 0 || ci === cells.length - 1)) return; btoks.push({ chords: cs.split(/\s+/).filter(function (w) { return w && w !== "%" && w !== "/" && w !== "·"; }).map(function (w) { return norm(w).replace(/[()]/g, ""); }) }); }); }
        else words.forEach(function (w) { btoks.push({ chords: [norm(w).replace(/[()]/g, "")] }); });
        pushLine(btoks, true); continue;
      }
      if (out.title === null && !cur && !out.sections.length && line.trim().length < 70) { out.title = line.trim(); continue; }
      pushLine([{ c: null, t: line.trim() }], false);
    }
    if (!out.key) { // guess the key from the chords (first and last chords weigh most)
      var count = {}, all = chordsIn(out);
      all.forEach(function (c, k) { var o = parse(c); if (!o) return; var w = 1 + (k === 0 ? 3 : 0) + (k === all.length - 1 ? 2 : 0); var name = noteName(o.root, false) + (o.minor ? "m" : ""); count[name] = (count[name] || 0) + w; });
      var bestK = null; Object.keys(count).forEach(function (k) { if (bestK === null || count[k] > count[bestK]) bestK = k; }); out.key = bestK;
    }
    return out;
  }
  function chordsIn(parsed) { var all = []; parsed.sections.forEach(function (s) { s.lines.forEach(function (l) { l.tokens.forEach(function (t) { if (l.bars) all.push.apply(all, t.chords); else if (t.c) all.push(t.c); }); }); }); return all; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  // HTML for a chart: chords above lyrics; bar boxes for chord-only lines. opts: view (from view()), lyricsOnly, chordsOnly
  function renderChart(parsed, opts) {
    opts = opts || {}; var v = opts.view || { chord: function (c) { return c; } };
    return parsed.sections.map(function (s, si) {
      var body = s.lines.map(function (l) {
        if (l.bars) { if (opts.lyricsOnly) return ""; return '<div class="cl bars">' + l.tokens.map(function (b) { return '<span class="bar">' + (b.chords.length ? b.chords.map(function (c) { return '<b class="ch">' + esc(pretty(v.chord(c))) + "</b>"; }).join(" ") : '<b class="ch rest">·</b>') + "</span>"; }).join("") + "</div>"; }
        if (l.tokens.length === 1 && l.tokens[0].comment) return '<div class="cl comment">' + esc(l.tokens[0].t) + "</div>";
        if (opts.lyricsOnly) return '<div class="cl lyric">' + esc(l.tokens.map(function (t) { return t.t; }).join("")) + "</div>";
        if (opts.chordsOnly) return '<div class="cl bars">' + l.tokens.filter(function (t) { return t.c; }).map(function (t) { return '<span class="bar"><b class="ch">' + esc(pretty(v.chord(t.c))) + "</b></span>"; }).join("") + "</div>";
        return '<div class="cl">' + l.tokens.map(function (t) { return '<span class="tok"><b class="ch">' + (t.c ? esc(pretty(v.chord(t.c))) : "&nbsp;") + '</b><span class="ly">' + esc(t.t).replace(/ /g, "&nbsp;") + "</span></span>"; }).join("") + "</div>";
      }).join("");
      return '<section class="csec" data-csec="' + si + '" data-name="' + esc(s.name) + '"><h4>' + esc(s.name) + "</h4>" + body + "</section>";
    }).join("");
  }
  function lyricsOf(parsed) { return parsed.sections.map(function (s) { return { name: s.name, lines: s.lines.filter(function (l) { return !l.bars && !(l.tokens[0] && l.tokens[0].comment); }).map(function (l) { return l.tokens.map(function (t) { return t.t; }).join("").replace(/\s+/g, " ").trim(); }).filter(Boolean) }; }); }

  // ---------------------------------------------------------------- recognised chords -> chart text
  // chords: [{label, bar, beat, beats, bass}] from the analyser; sections: [{name, bar, lyrics}] sorted by bar
  function chartFromChords(chords, sections, totalBars, bpb, meta) {
    meta = meta || {}; var flats = keyPrefersFlats(meta.key || "C");
    function labelOf(c) { if (c.label === "N") return "N.C."; var o = parse(c.label); if (!o) return c.label; if (c.bass) o.bass = noteIndex(c.bass); return format(o, flats); }
    var perBar = {}; chords.forEach(function (c) { if (c.bar < 1) return; (perBar[c.bar] = perBar[c.bar] || []).push(c); });
    var secs = sections && sections.length ? sections.slice().sort(function (a, b) { return a.bar - b.bar; }) : [{ name: "Song", bar: 1 }];
    var text = ["{title: " + (meta.title || "Chart") + "}", "{key: " + (meta.key || "C") + "}"]; if (meta.bpm) text.push("{tempo: " + Math.round(meta.bpm) + "}"); text.push("{time: " + (bpb || 4) + "/4}", "");
    var last = null;
    secs.forEach(function (sec, i) {
      var from = Math.max(1, sec.bar), to = i + 1 < secs.length ? secs[i + 1].bar - 1 : totalBars; if (to < from) return;
      text.push(sec.name);
      var before = chords.filter(function (c) { return c.bar >= 1 && c.bar < from; }).sort(function (p, q) { return p.bar - q.bar || p.beat - q.beat; });
      if (before.length) last = before[before.length - 1];  // a chord that started before this section carries into it
      var cells = [];
      for (var b = from; b <= to; b++) {
        var list = (perBar[b] || []).slice().sort(function (p, q) { return p.beat - q.beat; });
        if ((!list.length || list[0].beat > 1) && last) list.unshift({ label: last.label, bass: last.bass, beat: 1, beats: 0 });
        var names = [], prev = null; list.forEach(function (c) { var nm = labelOf(c); if (nm !== prev) names.push(nm); prev = nm; last = c; });
        cells.push(names.join("  ") || "·");
      }
      for (var k = 0; k < cells.length; k += 4) text.push("| " + cells.slice(k, k + 4).join(" | ") + " |");
      if (sec.lyrics) text.push(sec.lyrics);
      text.push("");
    });
    return text.join("\n");
  }

  var api = { KEYS: KEYS, FLATS: FLATS, INSTRUMENTS: INSTRUMENTS, isChord: isChord, parse: parse, format: format, transpose: transpose, nashville: nashville, noteIndex: noteIndex, noteName: noteName, pretty: pretty, keyPrefersFlats: keyPrefersFlats,
    instrument: instrument, view: view, parseChart: parseChart, chordsIn: chordsIn, renderChart: renderChart, lyricsOf: lyricsOf, chartFromChords: chartFromChords, esc: esc };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  global.PPChords = Object.assign(global.PPChords || {}, api);

  // ================================================================ Central Control integration
  var PP = global.PP, T = global.PPTracks; if (!PP || !T) return;
  var MEDIA = "http://127.0.0.1:8766";
  // listen to the song and write its chart (saved on the Pi as a text chart -> phones, projector, Central Usage)
  async function generateChart(s, progress) {
    var t = T.data(s); if (!t || !t.stems.length) throw new Error("This song has no tracks yet.");
    if (progress) progress("Listening to the tracks…");
    var mix = await T.mixdown(s, function (st) { return st.bus !== "click" && st.role !== "guide" && st.role !== "drums"; }) || await T.mixdown(s, function (st) { return st.bus !== "click"; });
    if (!mix) throw new Error("No audio to analyse.");
    var g = T.grid(s), key = t.originalKey || s.key, mode = t.originalMode || "major";
    var beats = [], phase = 0; for (var i = 0; i < g.times.length; i++) if (g.times[i] >= 0) { if (!beats.length) { for (var p = i; p < g.times.length; p++) if (g.down[p]) { phase = p - i; break; } } beats.push(g.times[i]); }
    // the bass track on its own, when there is one: the bass note decides between chords that share their notes (Em7 / G6, Am / C6)
    var bassStem = t.stems.filter(function (st) { return st.bus !== "click" && (st.role === "bass" || /\bbass\b|\bbs\b|sub ?bass/i.test(st.name || "")); })[0], bassMix = null;
    if (bassStem) { if (progress) progress("Listening to the bass…"); try { bassMix = await T.mixdown(s, function (st) { return st.id === bassStem.id; }); } catch (_) { bassMix = null; } }
    var res = await T.workerJob("chords", mix.mono, mix.rate, { beats: beats, beatsPerBar: g.bpb, phase: phase, key: key, mode: mode, bass: bassMix ? bassMix.mono : null, bassRate: bassMix ? bassMix.rate : null });
    res.chords.forEach(function (c) { var tb = T.timeToBar(s, c.start + 0.01); c.bar = tb.bar; c.beat = tb.beat; });
    t.chords = res.chords; t.chordsKey = key;
    var totalBars = Math.max(1, T.timeToBar(s, t.duration).bar);
    var secs = t.sections.slice().sort(function (a, b) { return a.bar - b.bar; }).map(function (x) { return { name: x.name, bar: x.bar, lyrics: x.lyrics && !/\|/.test(x.lyrics) ? x.lyrics : "" }; });
    var text = chartFromChords(res.chords, secs, totalBars, g.bpb, { title: s.name, key: key + (mode === "minor" ? "m" : ""), bpm: s.bpm });
    if (progress) progress("Saving the chart…");
    var saved = null;
    try { var r = await fetch(MEDIA + "/chart/text", { method: "POST", body: JSON.stringify({ name: s.name + " (auto chart)", text: text }) }); saved = await r.json(); } catch (_) { saved = null; }
    if (saved && saved.id) { await T.refreshCharts(); await T.applyChart(s, saved); }
    else s.chart = { id: null, name: s.name + " (auto chart)", pageCount: 0 }; // no Pi: the text stays in the project
    t.chartText = text; PP.persistSoon(); T.render(); T.sendDisplay();
    return { text: text, chords: res.chords, saved: !!(saved && saved.id) };
  }
  function currentChord(s, pos) { var t = s && T.data(s); if (!t || !t.chords) return null; for (var i = t.chords.length - 1; i >= 0; i--) if (pos >= t.chords[i].start) return t.chords[i]; return null; }
  global.PPChords.generateChart = generateChart; global.PPChords.currentChord = currentChord;
})(typeof window !== "undefined" ? window : globalThis);
