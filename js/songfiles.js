/* Central Pedal / Central Control / Central Pedal Control - song files from CCLI SongSelect and other worship apps.
 *
 *   SongSelect lyrics (.txt)   "Download lyrics": the title, the sections ("Verse 1", "Chorus"...), then the footer:
 *                              "CCLI Song # 1234567", the writers ("A | B | C"), "© 2006 ...", the terms line and
 *                              "CCLI License # ..."
 *   SongSelect import (.usr)   the older import file: an ini-style [File] block, then "[S A1234567]" with Title=,
 *                              Author=, Copyright=, Keys=, Fields= (section names, split by "/t") and Words= (each
 *                              section's lines: "/t" between sections, "/n" between lines)
 *   ChordPro (.cho .pro .chopro .crd)   {title:} {artist:} {author:} {key:} {tempo:} {time:} {ccli:} {copyright:},
 *                              sections as {comment: Verse 1} / {start_of_chorus} / {start_of_verse: Verse 2} or a
 *                              plain "Verse 1" line, chords inline as [G]words
 *
 * parse(fileName, text) gives one shape for all of them:
 *   { format, title, authors: [..], copyright, ccli, key, tempo, time, sections: [{ name, lines: ["[G]Amazing [C]grace", ..] }] }
 * (lines keep inline [chords] when the file had chords). toChart(song) makes the chart text the song editor and the
 * lyric screens read (PPChords.parseChart): {title:} {key:} lines, [Verse 1] headings, lines with inline chords.
 * No app dependencies, so the website and the tests use it too. */
(function (root) {
  "use strict";
  var SECTION_WORDS = "intro|verse|chorus|pre-?chorus|bridge|tag|outro|ending|interlude|instrumental|turnaround|vamp|refrain|hook|solo|breakdown|build|coda|channel|post-?chorus|misc|descant|ad-?lib";
  var SECTION_LINE = new RegExp("^\\s*[\\[(]?\\s*(" + SECTION_WORDS + ")\\s*(\\d+|[a-d])?\\s*[\\])]?\\s*:?\\s*(\\(.*\\))?\\s*$", "i");
  // the names the lyric screens know (PPChords): anything else becomes the nearest one
  var KNOWN = /^(intro|verse|chorus|pre-chorus|post-chorus|bridge|tag|outro|ending|interlude|instrumental|turnaround|vamp|refrain|hook|solo|breakdown|build|coda|channel)( (\d+|[A-D]))?$/i;

  function clean(s) { return String(s == null ? "" : s).replace(/ /g, " ").replace(/[ \t]+$/g, ""); }
  function titleCase(w) { return w.replace(/\b\w/g, function (c) { return c.toUpperCase(); }); }
  function sectionName(word, num) {
    var w = String(word || "").toLowerCase().replace(/\s+/g, "");
    // (names every screen and the Central Pedal know: a post-chorus plays as a tag, a channel as a bridge)
    var name = /^pre-?chorus$/.test(w) ? "Pre-Chorus" : /^post-?chorus$/.test(w) ? "Tag" : /^channel$/.test(w) ? "Bridge" : /^misc$/.test(w) ? "Tag" : /^descant$/.test(w) ? "Tag" : /^ad-?lib$/.test(w) ? "Vamp" : titleCase(w);
    return name + (num ? " " + String(num).toUpperCase() : "");
  }
  // any section heading text ("Verse 1", "CHORUS 2", "Misc 1", "Chorus (Repeat)") -> a name the screens know
  function normSection(text) {
    var m = SECTION_LINE.exec(String(text || ""));
    if (m) return sectionName(m[1], m[2]);
    var t = String(text || "").trim();
    return KNOWN.test(t) ? titleCase(t.toLowerCase()) : t ? "Verse" : "Verse";
  }
  function authorsOf(s) {
    return String(s || "").split(/\s*(?:\||;|\/|,(?![^()]*\))|\band\b|&)\s*/i).map(function (x) { return x.trim(); }).filter(function (x) { return x && !/^(words|music|words and music|by)$/i.test(x); });
  }
  function ccliOf(s) { var m = /(\d{3,9})/.exec(String(s || "")); return m ? m[1] : null; }
  function stripCopyright(s) { return String(s || "").replace(/^\s*(?:copyright|©|\(c\))\s*/i, "").trim(); }
  function emptySong(format) { return { format: format, title: "", authors: [], copyright: "", ccli: null, key: null, tempo: null, time: null, sections: [] }; }
  function finish(song) {
    song.sections = song.sections.map(function (s) {
      var lines = s.lines.slice(); while (lines.length && !lines[lines.length - 1].trim()) lines.pop(); while (lines.length && !lines[0].trim()) lines.shift();
      return { name: s.name, lines: lines };
    }).filter(function (s) { return s.lines.length; });
    // verses without numbers get them (Verse, Verse -> Verse 1, Verse 2); a chorus or bridge that comes back keeps its name
    var plain = song.sections.filter(function (s) { return s.name === "Verse"; }).length, k = 0;
    if (plain > 1) song.sections.forEach(function (s) { if (s.name === "Verse") s.name = "Verse " + (++k); });
    song.title = String(song.title || "").trim();
    song.copyright = stripCopyright(song.copyright);
    return song;
  }

  // ---------------------------------------------------------------- SongSelect lyrics (.txt)
  function parseSongSelectText(text) {
    var song = emptySong("songselect-txt"), lines = String(text || "").replace(/\r/g, "").split("\n").map(clean), body = [], i;
    // the footer: from the first "CCLI Song #" (or a © / "For use solely" line near the end) to the end
    var foot = lines.length;
    for (i = 0; i < lines.length; i++) if (/^\s*CCLI\s+Song\s*(#|No|Number)/i.test(lines[i])) { foot = i; break; }
    if (foot === lines.length) for (i = Math.max(0, lines.length - 8); i < lines.length; i++) if (/^\s*(©|\(c\)|copyright\b|for use solely)/i.test(lines[i])) { foot = i; break; }
    var footer = lines.slice(foot), head = lines.slice(0, foot);
    footer.forEach(function (l) {
      var t = l.trim(); if (!t) return;
      if (/^CCLI\s+Song\s*(#|No|Number)/i.test(t)) song.ccli = ccliOf(t);
      else if (/^CCLI\s+Licen[cs]e/i.test(t)) song.license = ccliOf(t);
      else if (/^(©|\(c\)|copyright\b)/i.test(t)) song.copyright = song.copyright ? song.copyright + "; " + stripCopyright(t) : stripCopyright(t);
      else if (/for use solely|all rights reserved|www\.ccli\.com|songselect/i.test(t)) { /* the terms line */ }
      else if (!song.authors.length) song.authors = authorsOf(t);
    });
    // the title: the first line that isn't empty (SongSelect puts it on top), unless it's already a section heading
    var start = 0; while (start < head.length && !head[start].trim()) start++;
    if (start < head.length && !SECTION_LINE.test(head[start])) { song.title = head[start].trim(); start++; }
    var cur = null;
    for (i = start; i < head.length; i++) {
      var l = head[i];
      if (SECTION_LINE.test(l)) { cur = { name: normSection(l), lines: [] }; song.sections.push(cur); continue; }
      if (!l.trim()) { if (cur) cur.lines.push(""); continue; }
      if (!cur) { cur = { name: "Verse", lines: [] }; song.sections.push(cur); }
      cur.lines.push(l.trim());
    }
    // a blank line inside a section ends that stanza: the lines stay together (the screens page them)
    song.sections.forEach(function (s) { s.lines = s.lines.filter(function (x, k, a) { return x.trim() || (k > 0 && a[k - 1].trim()); }); });
    return finish(song);
  }

  // ---------------------------------------------------------------- SongSelect import (.usr)
  function parseUsr(text) {
    var song = emptySong("songselect-usr"), lines = String(text || "").replace(/\r/g, "").split("\n"), fields = [], words = [], inSong = false;
    lines.forEach(function (raw) {
      var l = raw.trim(); if (!l) return;
      var sec = /^\[(.+)\]$/.exec(l);
      if (sec) { inSong = /^S\b/i.test(sec[1]); if (inSong) { var n = ccliOf(sec[1]); if (n) song.ccli = n; } return; }
      var kv = /^([A-Za-z]+)\s*=\s*(.*)$/.exec(l); if (!kv) return;
      var k = kv[1].toLowerCase(), v = kv[2];
      if (k === "title") song.title = v;
      else if (k === "author") song.authors = authorsOf(v);
      else if (k === "copyright") song.copyright = v.replace(/\/t/g, "; ").replace(/\/n/g, " ");
      else if (k === "keys") song.key = (v.split(/\/t|,|\s+/)[0] || "").trim() || null;
      else if (k === "fields") fields = v.split("/t");
      else if (k === "words") words = v.split("/t");
      else if (k === "ccli" || k === "songnumber" || k === "number") song.ccli = ccliOf(v) || song.ccli;
    });
    words.forEach(function (w, k) {
      var name = normSection(fields[k] || ("Verse " + (k + 1)));
      song.sections.push({ name: name, lines: w.split("/n").map(function (x) { return clean(x).trim(); }) });
    });
    return finish(song);
  }

  // ---------------------------------------------------------------- ChordPro
  function parseChordPro(text) {
    var song = emptySong("chordpro"), lines = String(text || "").replace(/\r/g, "").split("\n").map(clean), cur = null, block = null, n = { verse: 0, chorus: 0, bridge: 0 };
    function open(name) { cur = { name: name, lines: [] }; song.sections.push(cur); }
    function auto(kind) { n[kind] = (n[kind] || 0) + 1; return kind === "chorus" ? "Chorus" : kind === "bridge" ? "Bridge" : "Verse " + n[kind]; }
    lines.forEach(function (l) {
      var t = l.trim();
      if (/^#/.test(t)) return;   // a ChordPro comment for the editor
      var d = /^\{\s*([a-z_]+)\s*(?::\s*(.*?))?\s*\}$/i.exec(t);
      if (d) {
        var k = d[1].toLowerCase(), v = (d[2] || "").trim();
        if (k === "title" || k === "t") song.title = v;
        else if (k === "subtitle" || k === "st") { if (!song.authors.length) song.authors = authorsOf(v); }
        else if (k === "artist" || k === "author" || k === "composer" || k === "lyricist" || k === "words" || k === "music") { authorsOf(v).forEach(function (a) { if (song.authors.indexOf(a) < 0) song.authors.push(a); }); }
        else if (k === "key") song.key = v || null;
        else if (k === "tempo") song.tempo = Number(v) || null;
        else if (k === "time") song.time = v || null;
        else if (k === "ccli" || k === "ccli_number" || k === "ccli_song") song.ccli = ccliOf(v);
        else if (k === "copyright" || k === "footer") { if (/©|copyright|\(c\)|\d{4}/i.test(v) || k === "copyright") song.copyright = v; }
        else if (k === "comment" || k === "c" || k === "comment_italic" || k === "ci" || k === "comment_box" || k === "cb" || k === "highlight") { if (SECTION_LINE.test(v)) open(normSection(v)); }
        else if (/^(start_of_chorus|soc)$/.test(k)) { block = "chorus"; open(v ? normSection(v) : "Chorus"); }
        else if (/^(start_of_verse|sov)$/.test(k)) { block = "verse"; open(v ? normSection(v) : auto("verse")); }
        else if (/^(start_of_bridge|sob)$/.test(k)) { block = "bridge"; open(v ? normSection(v) : "Bridge"); }
        else if (/^(start_of_part|sop|start_of_tab|sot|start_of_grid|sog)$/.test(k)) { block = k; if (v) open(normSection(v)); }
        else if (/^(end_of_|eo)/.test(k)) { block = null; }
        else if (k === "chorus") { song.sections.push({ name: "Chorus", lines: [], repeat: true }); }
        return;
      }
      if (block && /^(start_of_tab|sot|start_of_grid|sog)$/.test(block)) return;   // tabs and grids aren't lyrics
      if (SECTION_LINE.test(t)) { open(normSection(t)); return; }
      if (!t) { if (cur) cur.lines.push(""); return; }
      if (!cur) open(auto("verse"));
      cur.lines.push(t);
    });
    // {chorus} (repeat the chorus here): the chorus's lines again
    var chorus = song.sections.filter(function (s) { return /^Chorus/.test(s.name) && s.lines.length; })[0];
    song.sections.forEach(function (s) { if (s.repeat) { s.lines = chorus ? chorus.lines.slice() : []; delete s.repeat; } });
    if (!song.copyright) { var c = lines.filter(function (l) { return /^\s*(©|\(c\)|copyright\b)/i.test(l); })[0]; if (c) song.copyright = c; }
    song.sections.forEach(function (s) { s.lines = s.lines.filter(function (x) { return !/^\s*(©|\(c\)|copyright\b|ccli\b)/i.test(x); }); });
    return finish(song);
  }

  // ---------------------------------------------------------------- which format
  function detect(name, text) {
    var ext = (/\.([a-z0-9]+)$/i.exec(String(name || "")) || [])[1]; ext = ext ? ext.toLowerCase() : "";
    var t = String(text || "");
    if (ext === "usr" || /^\s*\[File\][\s\S]*Type\s*=\s*SongSelect/i.test(t) || /^\s*\[S\s+A?\d+\]/m.test(t)) return "songselect-usr";
    if (/^(cho|chopro|chordpro|crd|pro)$/.test(ext) || /^\s*\{\s*(title|t|soc|start_of_chorus|key|artist)\s*[:}]/im.test(t)) return "chordpro";
    if (/CCLI\s+Song\s*(#|No|Number)/i.test(t) || /for use solely with the songselect/i.test(t)) return "songselect-txt";
    if (/\[[A-G][#b]?[^\]\s]{0,8}\]/.test(t)) return "chordpro";
    return "text";
  }
  function parse(name, text) {
    var kind = detect(name, text);
    var song = kind === "songselect-usr" ? parseUsr(text) : kind === "chordpro" ? parseChordPro(text) : parseSongSelectText(text);
    if (kind === "text") song.format = "text";
    if (!song.title && name) song.title = String(name).replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").trim();
    return song;
  }
  function hasChords(song) { return (song.sections || []).some(function (s) { return s.lines.some(function (l) { return /\[[A-G][^\]]*\]/.test(l); }); }); }
  // the chart text the apps keep with a song (PPChords.parseChart reads it; the lyric screens take the words from it)
  function toChart(song) {
    var out = [];
    if (song.title) out.push("{title: " + song.title + "}");
    if (song.key) out.push("{key: " + song.key + "}");
    if (song.tempo) out.push("{tempo: " + song.tempo + "}");
    if (song.time) out.push("{time: " + song.time + "}");
    (song.sections || []).forEach(function (s) { out.push(""); out.push("[" + s.name + "]"); s.lines.forEach(function (l) { if (l.trim()) out.push(l); }); });
    return out.join("\n").trim() + "\n";
  }
  // a section's words without chords (for the lyric screens and the song editor's section lyrics)
  function wordsOf(lines) { return (lines || []).map(function (l) { return l.replace(/\[[^\]]*\]/g, "").replace(/\s{2,}/g, " ").trim(); }).filter(Boolean).join("\n"); }
  // what the song keeps for CCLI: title, writers, copyright, number
  function meta(song) { return { title: song.title || "", author: (song.authors || []).join(", "), authors: (song.authors || []).slice(), copyright: song.copyright || "", ccli: song.ccli || null, key: song.key || null, tempo: song.tempo || null }; }

  var API = { parse: parse, detect: detect, toChart: toChart, wordsOf: wordsOf, meta: meta, hasChords: hasChords, normSection: normSection, authorsOf: authorsOf,
    parseSongSelectText: parseSongSelectText, parseUsr: parseUsr, parseChordPro: parseChordPro, EXTENSIONS: [".txt", ".usr", ".cho", ".chopro", ".chordpro", ".crd", ".pro"] };
  if (typeof module === "object" && module.exports) module.exports = API;
  if (root) root.PPSongFiles = API;
})(typeof window !== "undefined" ? window : null);
