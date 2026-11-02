/* Central Control - Scripture in seconds (the Slides tab): type a reference or some words, get slides.
 *
 *   CUScripture.parse("Ps 23:1-4; John 3:16")    -> [{ book: 18, c1: 23, v1: 1, c2: 23, v2: 4 }, ...] (books 0..65)
 *   CUScripture.lookup("John 3:16-18", "kjv")    -> Promise<{ label: "John 3:16-18", translation: "KJV", verses: [{ b, c, v, text }] }>
 *   CUScripture.search("love one another", "web") -> Promise<[{ b, c, v, text, label }]>
 *   CUScripture.split(passage, { maxChars })      -> [{ label, text, verses }] one per slide, verses kept whole where they fit
 *
 * The Bibles are bundled, offline, and public domain only: King James (KJV), World English Bible (WEB), American Standard
 * (ASV) and the Spanish Reina-Valera 1909 (RV1909) - app/bible/<id>.js, made by tools/make-bibles.py. Copyrighted
 * translations (NIV, ESV, NLT...) are not included; a licensed service can be added with registerProvider() and then shows
 * up in the translation list next to the bundled ones.
 * Works in the app (a <script>), in the center's /cu/ pages and in Node (the tests: require("./scripture.js")). */
(function (root) {
  "use strict";
  var BOOKS = [
    ["Genesis", "gen ge gn genesis génesis genesis"], ["Exodus", "ex exo exod exodus éxodo exodo"], ["Leviticus", "lev le lv leviticus levítico levitico"],
    ["Numbers", "num nu nm nb numbers números numeros"], ["Deuteronomy", "deut deu dt de deuteronomy deuteronomio"], ["Joshua", "josh jos jsh joshua josué josue"],
    ["Judges", "judg jdg jg jdgs judges jueces jue"], ["Ruth", "ruth rth ru rut"], ["1 Samuel", "1sam 1sa 1sm 1s 1samuel"], ["2 Samuel", "2sam 2sa 2sm 2s 2samuel"],
    ["1 Kings", "1kgs 1ki 1kg 1k 1kings 1reyes 1re"], ["2 Kings", "2kgs 2ki 2kg 2k 2kings 2reyes 2re"], ["1 Chronicles", "1chr 1ch 1chron 1chronicles 1crónicas 1cronicas 1cr"],
    ["2 Chronicles", "2chr 2ch 2chron 2chronicles 2crónicas 2cronicas 2cr"], ["Ezra", "ezra ezr esdras esd"], ["Nehemiah", "neh ne nehemiah nehemías nehemias"],
    ["Esther", "esth est es esther ester"], ["Job", "job jb"], ["Psalms", "ps psa psalm psalms pss psm pslm salmo salmos sal"], ["Proverbs", "prov pro prv pr proverbs proverbios"],
    ["Ecclesiastes", "eccl ecc ec eccles qoh ecclesiastes eclesiastés eclesiastes"], ["Song of Solomon", "song sos so songofsolomon songofsongs canticles cantares cnt cant"],
    ["Isaiah", "isa is isaiah isaías isaias"], ["Jeremiah", "jer je jr jeremiah jeremías jeremias"], ["Lamentations", "lam la lamentations lamentaciones"],
    ["Ezekiel", "ezek eze ezk ezekiel ezequiel"], ["Daniel", "dan da dn daniel"], ["Hosea", "hos ho hosea oseas os"], ["Joel", "joel jl"], ["Amos", "amos am amós"],
    ["Obadiah", "obad ob obadiah abdías abdias abd"], ["Jonah", "jonah jon jnh jonás jonas"], ["Micah", "mic mi micah miqueas miq"], ["Nahum", "nah na nahum nahúm"],
    ["Habakkuk", "hab hb habakkuk habacuc"], ["Zephaniah", "zeph zep zp zephaniah sofonías sofonias sof"], ["Haggai", "hag hg haggai hageo"],
    ["Zechariah", "zech zec zc zechariah zacarías zacarias zac"], ["Malachi", "mal ml malachi malaquías malaquias"], ["Matthew", "matt mt mat matthew mateo"],
    ["Mark", "mark mk mrk mr marcos mc"], ["Luke", "luke lk luk lc lucas"], ["John", "john jn jhn joh juan"], ["Acts", "acts ac act hechos hch"],
    ["Romans", "rom ro rm romans romanos"], ["1 Corinthians", "1cor 1co 1corinthians 1corintios"], ["2 Corinthians", "2cor 2co 2corinthians 2corintios"],
    ["Galatians", "gal ga galatians gálatas galatas"], ["Ephesians", "eph ephes ephesians efesios ef"], ["Philippians", "phil php pp philippians filipenses flp fil"],
    ["Colossians", "col co colossians colosenses"], ["1 Thessalonians", "1thess 1th 1thes 1thessalonians 1tesalonicenses 1ts"], ["2 Thessalonians", "2thess 2th 2thes 2thessalonians 2tesalonicenses 2ts"],
    ["1 Timothy", "1tim 1ti 1tm 1timothy 1timoteo"], ["2 Timothy", "2tim 2ti 2tm 2timothy 2timoteo"], ["Titus", "titus tit ti tito"], ["Philemon", "philem phm phlm philemon filemón filemon flm"],
    ["Hebrews", "heb he hebrews hebreos"], ["James", "jas jm james santiago stg"], ["1 Peter", "1pet 1pe 1pt 1p 1peter 1pedro"], ["2 Peter", "2pet 2pe 2pt 2p 2peter 2pedro"],
    ["1 John", "1john 1jn 1jo 1jhn 1juan"], ["2 John", "2john 2jn 2jo 2jhn 2juan"], ["3 John", "3john 3jn 3jo 3jhn 3juan"], ["Jude", "jude jud judas"],
    ["Revelation", "rev re rv revelation revelations apocalypse apocalipsis ap apoc"]
  ];
  // Spanish book names for labels in the Reina-Valera
  var ES = ["Génesis", "Éxodo", "Levítico", "Números", "Deuteronomio", "Josué", "Jueces", "Rut", "1 Samuel", "2 Samuel", "1 Reyes", "2 Reyes", "1 Crónicas", "2 Crónicas", "Esdras", "Nehemías", "Ester", "Job", "Salmos", "Proverbios", "Eclesiastés", "Cantares", "Isaías", "Jeremías", "Lamentaciones", "Ezequiel", "Daniel", "Oseas", "Joel", "Amós", "Abdías", "Jonás", "Miqueas", "Nahúm", "Habacuc", "Sofonías", "Hageo", "Zacarías", "Malaquías", "Mateo", "Marcos", "Lucas", "Juan", "Hechos", "Romanos", "1 Corintios", "2 Corintios", "Gálatas", "Efesios", "Filipenses", "Colosenses", "1 Tesalonicenses", "2 Tesalonicenses", "1 Timoteo", "2 Timoteo", "Tito", "Filemón", "Hebreos", "Santiago", "1 Pedro", "2 Pedro", "1 Juan", "2 Juan", "3 Juan", "Judas", "Apocalipsis"];
  // books with one chapter: "Jude 3" is verse 3
  var ONE_CHAPTER = { 30: 1, 56: 1, 62: 1, 63: 1, 64: 1 };
  var TRANSLATIONS = [
    { id: "kjv", name: "King James Version", short: "KJV", lang: "en", license: "Public domain" },
    { id: "web", name: "World English Bible", short: "WEB", lang: "en", license: "Public domain" },
    { id: "asv", name: "American Standard Version", short: "ASV", lang: "en", license: "Public domain" },
    { id: "rv1909", name: "Reina-Valera 1909", short: "RV1909", lang: "es", license: "Public domain" }
  ];
  var providers = {};   // id -> { id, name, short, lang, lookup(refs) -> Promise<[{ b, c, v, text }]> }

  function fold(s) { return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, ""); }
  // the book lookup: every abbreviation and full name, folded (no accents, no spaces, no dots)
  var KEYS = {}, NAMES = [];
  BOOKS.forEach(function (b, i) {
    var full = fold(b[0]).replace(/\s+/g, ""); KEYS[full] = i; NAMES.push([full, i]);
    b[1].split(/\s+/).forEach(function (k) { KEYS[fold(k)] = i; });
    var es = fold(ES[i]).replace(/\s+/g, ""); KEYS[es] = i; NAMES.push([es, i]);
  });
  function bookOf(word) {
    var w = fold(word).replace(/\./g, "").replace(/\s+/g, " ").trim();
    // "I John", "2nd Kings", "First Corinthians", "Primera de Juan" -> 1john, 2kings, 1corinthians, 1juan (a roman numeral needs a space after it: "Isaiah" stays)
    w = w.replace(/^(iii|3rd|third|tercer[ao]?)\s+(de\s+)?/, "3").replace(/^(ii|2nd|second|segund[ao])\s+(de\s+)?/, "2").replace(/^(i|1st|first|primer[ao]?)\s+(de\s+)?/, "1");
    w = w.replace(/\s+/g, "");
    if (!w) return -1;
    if (KEYS[w] != null) return KEYS[w];
    if (w === "songofsongs" || w === "song") return 21;
    var hits = NAMES.filter(function (n) { return n[0].indexOf(w) === 0; }).map(function (n) { return n[1]; });
    hits = hits.filter(function (x, k) { return hits.indexOf(x) === k; });
    return hits.length === 1 && w.length >= 2 ? hits[0] : -1;
  }

  // "John 3:16-18, 20; Rom 8" -> ranges. A part without a book uses the one before ("John 3:16; 4:1").
  function parse(text) {
    var out = [], errors = [], last = null;
    String(text || "").replace(/[–—]/g, "-").split(/;/).forEach(function (part) {
      part = part.trim(); if (!part) return;
      var m = /^((?:[1-3]|i{1,3}|first|second|third|1st|2nd|3rd)?\s*[a-zA-ZÀ-ſ][a-zA-ZÀ-ſ.\s]*?)\s*(\d[\d:.,\-\s]*)?$/i.exec(part), book, rest;
      if (m && bookOf(m[1]) >= 0) { book = bookOf(m[1]); rest = (m[2] || "").trim(); }
      else if (last && /^\d/.test(part)) { book = last.book; rest = part; }
      else { errors.push(part); return; }
      var chapterCtx = null;
      if (!rest) { out.push({ book: book, c1: 1, v1: 1, c2: 999, v2: 999, whole: "book" }); last = { book: book }; return; }
      rest.replace(/\./g, ":").split(/,/).forEach(function (seg) {
        seg = seg.replace(/\s+/g, ""); if (!seg) return;
        var r = /^(\d+)(?::(\d+))?(?:-(\d+)(?::(\d+))?)?$/.exec(seg); if (!r) { errors.push(part); return; }
        var a = +r[1], b = r[2] != null ? +r[2] : null, c = r[3] != null ? +r[3] : null, d = r[4] != null ? +r[4] : null, one = ONE_CHAPTER[book];
        if (one && b == null && d == null) { out.push({ book: book, c1: 1, v1: a, c2: 1, v2: c != null ? c : a }); chapterCtx = 1; return; }   // Jude 3-5
        if (b == null && chapterCtx != null && seg.indexOf(":") < 0 && (out.length && out[out.length - 1].book === book)) {   // "John 3:16, 18" - 18 is a verse
          out.push({ book: book, c1: chapterCtx, v1: a, c2: chapterCtx, v2: c != null ? c : a }); return;
        }
        if (b == null) { out.push({ book: book, c1: a, v1: 1, c2: c != null ? c : a, v2: 999, whole: "chapter" }); chapterCtx = null; return; }   // "1 Cor 13", "Gen 1-2"
        if (c == null) { out.push({ book: book, c1: a, v1: b, c2: a, v2: b }); chapterCtx = a; return; }
        if (d == null) { out.push({ book: book, c1: a, v1: b, c2: a, v2: c }); chapterCtx = a; return; }   // 3:16-18
        out.push({ book: book, c1: a, v1: b, c2: c, v2: d }); chapterCtx = c;   // 3:16-4:2
      });
      last = { book: book };
    });
    return { refs: out, errors: errors };
  }

  // ---------------------------------------------------------------- the Bibles
  var loaded = {}, loading = {}, bibleBase = "bible/";
  function decodeB64(b64) {
    if (typeof Buffer !== "undefined" && typeof window === "undefined") return Buffer.from(b64, "base64");
    var bin = atob(b64), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u;
  }
  async function gunzipText(bytes) {
    if (typeof window === "undefined") return require("node:zlib").gunzipSync(bytes).toString("utf8");
    var ds = new DecompressionStream("gzip"), s = new Blob([bytes]).stream().pipeThrough(ds);
    return await new Response(s).text();
  }
  var pendingData = {};
  root.CUBibleData = function (id, b64) { pendingData[id] = b64; if (pendingData["_cb_" + id]) pendingData["_cb_" + id](); };
  function load(id) {
    id = id || "kjv";
    if (loaded[id]) return Promise.resolve(loaded[id]);
    if (loading[id]) return loading[id];
    if (!TRANSLATIONS.some(function (t) { return t.id === id; })) return Promise.reject(new Error("That translation isn't bundled here."));
    loading[id] = new Promise(function (resolve, reject) {
      function done() {
        var b64 = pendingData[id]; delete pendingData[id];
        gunzipText(decodeB64(b64)).then(function (txt) { loaded[id] = JSON.parse(txt); resolve(loaded[id]); }, reject);
      }
      if (typeof window === "undefined") {   // Node (the tests): read the script and take the base64 out of it
        try { var src = require("node:fs").readFileSync(require("node:path").join(__dirname, "bible", id + ".js"), "utf8"); pendingData[id] = /CUBibleData\("[^"]+","([^"]+)"\)/.exec(src)[1]; done(); } catch (e) { reject(e); }
        return;
      }
      if (pendingData[id]) return done();
      pendingData["_cb_" + id] = function () { delete pendingData["_cb_" + id]; done(); };
      var s = document.createElement("script"); s.src = bibleBase + id + ".js"; s.async = true;
      s.onerror = function () { delete loading[id]; reject(new Error("The " + id.toUpperCase() + " Bible file is missing from this install.")); };
      document.head.appendChild(s);
    });
    return loading[id];
  }
  function bookName(b, lang) { return lang === "es" ? ES[b] : BOOKS[b][0]; }
  function label(r, lang) {
    var n = bookName(r.book, lang);
    if (r.whole === "book") return n;
    if (ONE_CHAPTER[r.book]) return n + " " + (r.v1 === r.v2 ? r.v1 : r.v1 + "-" + r.v2);
    if (r.whole === "chapter") return n + " " + (r.c1 === r.c2 ? r.c1 : r.c1 + "-" + r.c2);
    if (r.c1 === r.c2) return n + " " + r.c1 + ":" + (r.v1 === r.v2 ? r.v1 : r.v1 + "-" + r.v2);
    return n + " " + r.c1 + ":" + r.v1 + "-" + r.c2 + ":" + r.v2;
  }
  function versesOf(bible, r) {
    var out = [], book = bible.books[r.book]; if (!book) return out;
    var c2 = Math.min(r.c2, book.length);
    for (var c = r.c1; c <= c2; c++) {
      var ch = book[c - 1]; if (!ch) continue;
      var from = c === r.c1 ? r.v1 : 1, to = c === c2 && r.c2 === c2 ? Math.min(r.v2, ch.length) : ch.length;
      for (var v = from; v <= to; v++) if (ch[v - 1]) out.push({ b: r.book, c: c, v: v, text: ch[v - 1] });
    }
    return out;
  }
  function translation(id) { return TRANSLATIONS.filter(function (t) { return t.id === id; })[0] || providers[id] || null; }
  // a reference -> the verses (bundled Bible or a registered provider)
  async function lookup(ref, id, opts) {
    opts = opts || {}; id = id || "kjv";
    var p = typeof ref === "string" ? parse(ref) : { refs: ref, errors: [] };
    if (!p.refs.length) throw new Error(p.errors.length ? "I couldn't read \"" + p.errors[0] + "\" as a Bible reference." : "Type a reference, like John 3:16.");
    var t = translation(id); if (!t) throw new Error("That translation isn't available.");
    var lang = t.lang || "en", verses = [];
    var refs = p.refs.map(function (r) { return r.whole === "book" ? Object.assign({}, r, { c1: 1, c2: 1, v1: 1, v2: 999, whole: "chapter" }) : r; });   // (a whole book on screen is never meant: its first chapter)
    if (providers[id]) verses = await providers[id].lookup(refs);
    else { var bible = await load(id); refs.forEach(function (r) { verses = verses.concat(versesOf(bible, r)); }); }
    if (!verses.length) throw new Error("There's no " + refs.map(function (r) { return label(r, lang); }).join("; ") + " in the " + t.short + ".");
    if (opts.maxVerses && verses.length > opts.maxVerses) verses = verses.slice(0, opts.maxVerses);
    return { label: refs.map(function (r) { return label(r, lang); }).join("; "), translation: t.short, translationId: id, lang: lang, verses: verses, refs: refs };
  }
  // words -> verses with all of them (accents and case ignored), in Bible order
  async function search(words, id, limit) {
    id = id || "kjv"; limit = limit || 50;
    var bible = await load(id), lang = bible.lang, ws = fold(words).split(/[^a-z0-9ñ']+/).filter(function (w) { return w.length > 1; });
    if (!ws.length) return [];
    var phrase = " " + ws.join(" ") + " ", exact = [], loose = [];
    for (var b = 0; b < bible.books.length && exact.length < limit; b++) {
      var book = bible.books[b];
      for (var c = 0; c < book.length && exact.length < limit; c++) {
        var ch = book[c];
        for (var v = 0; v < ch.length; v++) {
          var t = " " + fold(ch[v]).replace(/[^a-z0-9ñ']+/g, " ") + " ";   // whole words: "love" isn't "beloved"
          if (!ws.every(function (w) { return t.indexOf(" " + w + " ") >= 0; })) continue;
          var hit = { b: b, c: c + 1, v: v + 1, text: ch[v], label: bookName(b, lang) + " " + (c + 1) + ":" + (v + 1) };
          if (ws.length > 1 && t.indexOf(phrase) >= 0) exact.push(hit); else if (loose.length < limit) loose.push(hit);   // the words together come first
        }
      }
    }
    return exact.concat(loose).slice(0, limit);
  }
  // a long verse is broken at a sentence, then a clause, then a word
  function breakLong(text, max) {
    var parts = [], rest = text;
    while (rest.length > max) {
      var cut = -1, window_ = rest.slice(0, max + 1);
      [/[.?!;:]["”’)]?\s/g, /[,]["”’)]?\s/g, /\s/g].some(function (re) { var m, best = -1; re.lastIndex = 0; while ((m = re.exec(window_))) { if (m.index > max * 0.45) best = m.index + m[0].length; } if (best > 0) { cut = best; return true; } return false; });
      if (cut < 0) cut = max;
      parts.push(rest.slice(0, cut).trim()); rest = rest.slice(cut).trim();
    }
    if (rest) parts.push(rest);
    return parts;
  }
  // the passage -> slides: whole verses together up to maxChars, a long verse over several slides
  function split(passage, opts) {
    opts = opts || {}; var max = opts.maxChars || 260, nums = opts.verseNumbers !== false, out = [], cur = null, lang = passage.lang || "en";
    function flush() { if (cur && cur.text) out.push(cur); cur = null; }
    function vlabel(vs) { var a = vs[0], z = vs[vs.length - 1]; if (!a) return passage.label; var n = bookName(a.b, lang); return a.c === z.c ? n + " " + a.c + ":" + (a.v === z.v ? a.v : a.v + "-" + z.v) : n + " " + a.c + ":" + a.v + "-" + z.c + ":" + z.v; }
    passage.verses.forEach(function (v) {
      var piece = (nums ? sup(v.v) + " " : "") + v.text;
      if (piece.length > max) {
        flush();
        breakLong(v.text, max).forEach(function (p, k) { out.push({ text: (nums && k === 0 ? sup(v.v) + " " : "") + p, verses: [v] }); });
        return;
      }
      if (cur && cur.text.length + 1 + piece.length > max) flush();
      if (!cur) cur = { text: "", verses: [] };
      cur.text += (cur.text ? " " : "") + piece; cur.verses.push(v);
    });
    flush();
    out.forEach(function (s) { s.label = vlabel(s.verses) + " " + passage.translation; });
    return out;
  }
  var SUP = { 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };
  function sup(n) { return String(n).split("").map(function (d) { return SUP[d]; }).join(""); }

  function registerProvider(p) {
    if (!p || !p.id || typeof p.lookup !== "function") throw new Error("A provider needs an id and a lookup function.");
    providers[p.id] = { id: p.id, name: p.name || p.id, short: p.short || p.id.toUpperCase(), lang: p.lang || "en", license: p.license || "Licensed", lookup: p.lookup, provider: true };
  }
  function translations() { return TRANSLATIONS.concat(Object.keys(providers).map(function (k) { return providers[k]; })); }
  function setBase(b) { bibleBase = b; }

  root.CUScripture = { parse: parse, lookup: lookup, search: search, split: split, label: label, bookName: bookName, bookOf: bookOf, translations: translations, registerProvider: registerProvider, load: load, setBase: setBase, BOOKS: BOOKS.map(function (b) { return b[0]; }) };
  if (typeof module !== "undefined" && module.exports) module.exports = root.CUScripture;
})(typeof window !== "undefined" ? window : globalThis);
