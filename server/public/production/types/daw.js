/* Central Production - Track and Loop: both are the DAW (../daw/: tracks, clips, the piano roll and drum grid,
 * recording, the mixer, automation, sections, tempo changes), with a strip above it for what each one needs:
 *   Track: the song - title, artist, the lyrics and chords of each section (the sections are the DAW's own, on the ruler),
 *          what each track is -> Central Tracks (stems + click + the mix + song.json), and Publish to Central Tracks.
 *   Loop:  how many bars, one loop or one per track, tags -> seamless loops (the reverb's tail wraps round) for Central Pads. */
(function () {
  "use strict";
  var D = window.CDaw, A = window.CPAudio, Z = window.CMProj, H = window.CPHost;
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) { return window.CP.esc(s); }
  var ROLES = [["music", "Music"], ["drums", "Drums"], ["bass", "Bass"], ["keys", "Keys"], ["guitar", "Guitar"], ["vocals", "Vocals"], ["guide", "Guide"], ["click", "Click"]];
  function data() { return window.CP.project().data; }
  function bpb(b) { return D.tempo.bpb(b || 0); }
  function guessRole(t) { var n = (t.name || "").toLowerCase(); if (t.kind === "drums" || /drum|kit|perc/.test(n)) return "drums"; if (/bass/.test(n)) return "bass"; if (/guide|cue/.test(n)) return "guide"; if (/click|metronome/.test(n)) return "click"; if (/vox|vocal|sing/.test(n)) return "vocals"; if (/guitar|gtr/.test(n)) return "guitar"; if (/key|piano|pad|organ|synth/.test(n)) return "keys"; return "music"; }
  var strip = { el: null, open: false };

  function frame(el, kind) {
    var wrap = document.createElement("div"); wrap.className = "cp-daw";
    wrap.innerHTML = '<div class="cp-strip" id="cpStrip"><div class="cp-strip-h"><b>' + (kind === "track" ? "The song" : "The loop") + '</b><span class="muted small" id="cpStripSum"></span><button class="ghost small" id="cpStripT">Show</button></div><div class="cp-strip-b" id="cpStripB"></div></div><div class="cp-daw-host" id="cpDawHost"></div>';
    el.appendChild(wrap); strip.el = wrap;
    window.CP.showStudio($("#cpDawHost", wrap));
    $("#cpStripT", wrap).onclick = function () { strip.open = !strip.open; drawStrip(); };
    return wrap;
  }
  function drawStrip() {
    if (!strip.el) return; var p = window.CP.project(), b = $("#cpStripB", strip.el);
    $("#cpStripT", strip.el).textContent = strip.open ? "Hide" : (p.type === "track" ? "Edit the song" : "Edit the loop"); b.hidden = !strip.open;
    if (p.type === "track") drawSong(b); else drawLoop(b);
  }

  // ------------------------------------------------------------- Track: the song
  function sections() {   // the DAW's sections (markers), in order, each with its bars
    var m = (D.project().markers || []).slice().sort(function (a, z) { return a.beat - z.beat; }), end = Math.max(D.songEnd(), m.length ? m[m.length - 1].beat + bpb() * 8 : 0);
    return m.map(function (x, i) { var nb = i + 1 < m.length ? m[i + 1].beat : end, b0 = D.tempo.beatToBar(x.beat).bar, b1 = D.tempo.beatToBar(nb).bar; return { id: x.id, name: x.name, bar: b0, bars: Math.max(1, b1 - b0), beat: x.beat }; });
  }
  function drawSong(b) {
    var d = data(), secs = sections(), dp = D.project(), lyr = d.lyrics || {}, ch = d.chords || {};
    $("#cpStripSum", strip.el).textContent = (d.title || window.CP.project().name) + (d.artist ? " · " + d.artist : "") + " · " + secs.length + " section" + (secs.length === 1 ? "" : "s");
    b.innerHTML = '<div class="cp-row"><label>Title <input id="sgTitle" value="' + esc(d.title || window.CP.project().name) + '"></label><label>Artist <input id="sgArtist" value="' + esc(d.artist || "") + '" placeholder="Who wrote or recorded it"></label><label class="toggle"><input type="checkbox" id="sgClick"' + (d.click !== false ? " checked" : "") + '> A click stem</label>' +
      '<span class="muted small">The sections are on the ruler (double-click its Sections strip to add one). Chords: a bar per “|”, two chords in a bar with a space: G | D/F# | Em C | C</span></div>' +
      (window.CDawSong && secs.length ? '<div class="cp-arr"><span class="muted small">Arrangement (drag a section to move it; its music goes with it):</span><div class="cp-arr-chips">' + secs.map(function (s) { return '<span class="cp-arr-chip" draggable="true" data-sec="' + s.id + '" title="' + esc(s.name) + ", bar " + (s.bar + 1) + '"><b>' + esc(s.name) + '</b><button data-dup title="Play it again (duplicate it with its music)">⧉</button><button data-del title="Take it out, with its music"' + (secs.length < 2 ? " disabled" : "") + '>✕</button></span>'; }).join("") + "</div></div>" : "") +
      (window.CDawSong ? '<div class="cp-row"><button id="sgCG" title="A click and a spoken guide (“Chorus” a bar before each section), on their own tracks">Make click &amp; guide tracks</button><button id="sgKT" title="The whole song in a new key and tempo">Key &amp; tempo…</button><button id="sgGrade" title="The stars Central Tracks will give the mix, and its loudness, before you publish">Check the grade &amp; loudness</button></div>' : "") +
      (secs.length ? '<div class="cp-sections">' + secs.map(function (s) { return '<div class="cp-sec" data-m="' + s.id + '"><b>' + esc(s.name) + '</b><span class="muted small">bar ' + (s.bar + 1) + " · " + s.bars + ' bars</span><input class="sec-chords" value="' + esc(ch[s.id] || "") + '" placeholder="Chords"><textarea class="sec-lyrics" rows="1" placeholder="Lyrics">' + esc(lyr[s.id] || "") + "</textarea></div>"; }).join("") + "</div>" : '<p class="muted small">No sections yet.</p>') +
      '<div class="cp-roles"><span class="muted small">What each track is in Central Tracks:</span>' + dp.tracks.filter(function (t) { return t.kind !== "bus"; }).map(function (t) { var r = (d.roles || {})[t.id] || guessRole(t); return "<label>" + esc(t.name) + ' <select data-role="' + t.id + '">' + ROLES.map(function (x) { return '<option value="' + x[0] + '"' + (x[0] === r ? " selected" : "") + ">" + x[1] + "</option>"; }).join("") + "</select></label>"; }).join("") + "</div>";
    function set(label, fn) { window.CP.edit(label, fn); }
    $("#sgTitle", b).onchange = function () { var v = this.value; set("Song title", function (x) { x.title = v; }); };
    $("#sgArtist", b).onchange = function () { var v = this.value; set("Artist", function (x) { x.artist = v; }); };
    $("#sgClick", b).onchange = function () { var v = this.checked; set("Click stem", function (x) { x.click = v; }); };
    $$(".cp-sec", b).forEach(function (row) { var id = row.dataset.m; $(".sec-chords", row).onchange = function () { var v = this.value; set("Chords", function (x) { x.chords = x.chords || {}; x.chords[id] = v; }); }; $(".sec-lyrics", row).onchange = function () { var v = this.value; set("Lyrics", function (x) { x.lyrics = x.lyrics || {}; x.lyrics[id] = v; }); }; });
    $$("[data-role]", b).forEach(function (s) { s.onchange = function () { var id = s.dataset.role, v = s.value; set("Track role", function (x) { x.roles = x.roles || {}; x.roles[id] = v; }); }; });
    if (window.CDawSong) wireArrangement(b);
  }
  // (10.6) the arrangement: sections as chips; drag to reorder, ⧉ to repeat one, ✕ to take one out (the music goes with them)
  function wireArrangement(b) {
    var S = window.CDawSong, chips = $$(".cp-arr-chip", b), dragId = null;
    function order() { return chips.map(function (c) { return c.dataset.sec; }); }
    function apply(fn, ok) {
      try {
        var r = fn(); if (!r) return;
        var map = r.map || {}, extra = Object.keys(map).filter(function (k) { return map[k] !== k; });
        if (extra.length) window.CP.edit("Section words", function (x) { x.lyrics = x.lyrics || {}; x.chords = x.chords || {}; extra.forEach(function (k) { if (x.lyrics[map[k]]) x.lyrics[k] = x.lyrics[map[k]]; if (x.chords[map[k]]) x.chords[k] = x.chords[map[k]]; }); });
        window.CP.toast(ok); drawStrip();
      } catch (e) { window.CP.toast(e.message || String(e), "bad"); }
    }
    chips.forEach(function (c) {
      c.ondragstart = function (e) { dragId = c.dataset.sec; c.classList.add("drag"); try { e.dataTransfer.setData("text/plain", dragId); e.dataTransfer.effectAllowed = "move"; } catch (_) { } };
      c.ondragend = function () { c.classList.remove("drag"); chips.forEach(function (x) { x.classList.remove("over"); }); };
      c.ondragover = function (e) { if (!dragId || dragId === c.dataset.sec) return; e.preventDefault(); chips.forEach(function (x) { x.classList.toggle("over", x === c); }); };
      c.ondrop = function (e) {
        e.preventDefault(); var from = dragId; dragId = null; if (!from || from === c.dataset.sec) return;
        var o = order(), i = o.indexOf(from), j = o.indexOf(c.dataset.sec); o.splice(i, 1); o.splice(j, 0, from);
        apply(function () { return S.arrange(o, "Move section"); }, "Moved, with its music.");
      };
      $("[data-dup]", c).onclick = function () { apply(function () { return S.duplicate(c.dataset.sec); }, "Repeated, with its music."); };
      $("[data-del]", c).onclick = function () { apply(function () { return S.remove(c.dataset.sec); }, "Taken out, and the rest closed up."); };
    });
    var cg = $("#sgCG", b); if (cg) cg.onclick = function () { cg.disabled = true; S.makeClickAndGuide().then(function (r) { window.CP.toast("Click and guide tracks made" + (r.cues ? " (" + r.cues + " spoken cues)" : "") + ". Name the sections Verse, Chorus, Bridge… for cues."); }).catch(function (e) { window.CP.toast(e.message, "bad"); }).then(function () { cg.disabled = false; }); };
    var kt = $("#sgKT", b); if (kt) kt.onclick = function () { S.keyTempoDialog(); };
    var gr = $("#sgGrade", b); if (gr) gr.onclick = function () { window.CP.busy("Rendering the mix…"); D.render().then(function (mix) { window.CP.busy(); gradeBox(mix, "The mix"); }).catch(function (e) { window.CP.busy(); window.CP.toast(e.message, "bad"); }); };
  }
  /** The stars Central Tracks will give it (the website's own checks) and its loudness. */
  function gradeBox(mix, what, extra) {
    var S = window.CDawSong; if (!S) return;
    var g = S.grade(mix, 24), l = S.loudness(mix);
    function star(n) { return "★★★★★".slice(0, n) + "☆☆☆☆☆".slice(0, 5 - n); }
    var tips = [];
    if (l.truePeak > -1) tips.push("The true peak is " + l.truePeak + " dBTP: set the master limiter's ceiling to -1 dB so it doesn't distort on phones and streaming.");
    if (l.integrated < -18) tips.push("It's quiet for a finished song (" + l.integrated + " LUFS). Around -14 LUFS sits well next to other songs; turn up the limiter's gain.");
    if (l.integrated > -8) tips.push("It's very loud (" + l.integrated + " LUFS). Streaming turns it down anyway, and it loses its punch: try -14 to -10 LUFS.");
    window.CP.modal("<h2>" + esc(what) + ': <span class="cp-stars">' + star(g.stars) + "</span></h2>" +
      '<p class="muted">The stars Central Tracks gives it (' + g.stars + " of 5" + (g.price ? ", sold at $" + g.price : "") + "). It's the same check the website does when you publish.</p>" +
      '<ul class="cp-checks">' + g.checks.map(function (c) { return '<li class="' + (c.ok ? "ok" : "bad") + '">' + (c.ok ? "✓ " : "✕ ") + esc(c.text) + "</li>"; }).join("") + "</ul>" +
      '<div class="cp-loud"><div><b>' + l.integrated + '</b><span>LUFS integrated</span></div><div><b>' + l.truePeak + '</b><span>dBTP true peak</span></div><div><b>' + l.shortMax + '</b><span>LUFS loudest 3 s</span></div><div><b>' + l.range + '</b><span>LU range</span></div></div>' +
      (tips.length ? '<ul class="cp-tips">' + tips.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") + "</ul>" : '<p class="muted small">Loudness looks good for streaming and for Central Tracks.</p>') +
      (extra || "") + '<div class="cp-row end"><button class="primary" data-close>Done</button></div>');
  }
  /** (10.6) Central Pedal: a track pack the pedal reads straight away (Title - Artist - 72bpm - G.zip). */
  function pedalPack() {
    var d = data(), secs = sections();
    return window.CDawSong.pedalPack({ title: d.title || window.CP.project().name, artist: d.artist || "", roles: d.roles || {}, chart: chartText(d, secs), song: songInfo(), click: d.click !== false }).then(function (pk) {
      return H.exportFiles(pk.name, [{ name: pk.name + ".zip", data: pk.zip }]).then(function (where) {
        if (where) gradeBox(pk.mix, "Exported for Central Pedal", '<p class="muted small">In the pack: ' + esc(pk.files.map(function (f) { return f.name; }).join(", ")) + '. In Central Pedal Control, press + Song, choose Multitrack and pick this zip. The sections come in from Markers.mid, so the pedal can jump to them.</p>');
        return where;
      });
    });
  }
  function chordsOf(d, secs) {
    var out = [], prev = null;
    secs.forEach(function (s) { String((d.chords || {})[s.id] || "").split("|").forEach(function (bar, i) { var list = bar.trim().split(/\s+/).filter(Boolean); list.forEach(function (c, k) { if (c === prev) return; prev = c; var parts = c.split("/"); out.push({ label: parts[0], bass: parts[1] || null, bar: s.bar + i, beat: 1 + Math.round(k * bpb(s.beat) / list.length) }); }); }); });
    return out;
  }
  function chartText(d, secs) { return secs.map(function (s) { var bars = String((d.chords || {})[s.id] || "").split("|").map(function (x) { return x.trim(); }).filter(Boolean), l = (d.lyrics || {})[s.id]; return "[" + s.name + "]\n" + (bars.length ? "| " + bars.join(" | ") + " |\n" : "") + (l ? l + "\n" : ""); }).join("\n"); }
  function clickBuffer(end) {
    var rate = 48000, n = Math.ceil((D.tempo.beatToSec(end) + 3.02) * rate), b = A.make(2, n, rate), L = b.getChannelData(0), R = b.getChannelData(1);
    for (var k = 0; k < end; k++) { var at = Math.round((0.02 + D.tempo.beatToSec(k)) * rate), down = Math.abs(D.tempo.beatToBar(k).beat) < 1e-6, f = down ? 1600 : 1000; for (var i = 0; i < 0.03 * rate && at + i < n; i++) { var v = Math.sin(2 * Math.PI * f * i / rate) * Math.exp(-i / (0.006 * rate)) * 0.8; L[at + i] = v; R[at + i] = v; } }
    return b;
  }
  function songInfo(stemList) {
    var d = data(), p = D.project(), end = D.songEnd(), secs = sections();
    return { format: 1, kind: "central-tracks-song", title: d.title || window.CP.project().name, artist: d.artist || "", key: p.key, bpm: p.bpm, bpb: p.sig[0], duration: Math.round(D.tempo.beatToSec(end) * 100) / 100,
      sections: secs.map(function (s) { return { name: s.name, bar: s.bar, bars: s.bars, lyrics: (d.lyrics || {})[s.id] || "" }; }), chords: chordsOf(d, secs), chartText: chartText(d, secs),
      tempos: (p.tempos || []).slice(), stems: stemList || [], credits: { arrangement: "Made in Central Production" } };
  }
  function tracksPackage() {
    var d = data(), p = D.project(), end = D.songEnd(); if (!(end > 0)) return Promise.reject(new Error("The timeline is empty: record or put clips on it first."));
    var roles = d.roles || {}, stems = [], files = [], secs = sections(), title = d.title || window.CP.project().name;
    return D.stems().then(function (list) {
      list.forEach(function (x) { var r = roles[x.track.id] || guessRole(x.track); if (r === "click" && d.click !== false) return;   /* (10.6: the made Click track: the package makes its own) */ stems.push({ name: x.track.name, role: r, mute: r === "guide" || r === "click", buf: x.buffer }); });
      if (d.click !== false) stems.push({ name: "Click", role: "click", mute: true, buf: clickBuffer(Math.ceil(end)) });
      return D.render();
    }).then(function (mix) {
      var song = songInfo(stems.map(function (s) { return { name: s.name, role: s.role, mute: !!s.mute }; }));
      stems.forEach(function (s) { files.push({ name: Z.slug(title) + "--" + s.name.replace(/[^\w\- ]+/g, "") + ".wav", data: new Uint8Array(Z.wav(s.buf, 24)), role: s.role, stem: s }); });
      files.push({ name: Z.slug(title) + "--mix.wav", data: new Uint8Array(Z.wav(mix, 24)), mix: true, buf: mix });
      files.push({ name: "song.json", data: new TextEncoder().encode(JSON.stringify(song, null, 1)), song: song });
      return { song: song, files: files, mix: mix, title: title };
    });
  }

  // ------------------------------------------------------------- Loop
  function drawLoop(b) {
    var d = data(), p = D.project(), bars = d.bars || 4;
    $("#cpStripSum", strip.el).textContent = bars + " bar" + (bars > 1 ? "s" : "") + " · " + p.bpm + " BPM · " + p.key + (d.set ? " · a loop per track" : "");
    b.innerHTML = '<div class="cp-row"><label>Length <select id="lpBars">' + [1, 2, 4, 8, 16].map(function (n) { return '<option value="' + n + '"' + (n === bars ? " selected" : "") + ">" + n + " bar" + (n > 1 ? "s" : "") + "</option>"; }).join("") + "</select></label>" +
      '<div class="cp-seg"><button data-lps="one"' + (d.set ? "" : ' class="on"') + '>One loop</button><button data-lps="set"' + (d.set ? ' class="on"' : "") + '>A loop per track</button></div>' +
      '<label>Tags <input id="lpTags" value="' + esc((d.tags || []).join(", ")) + '" placeholder="worship, ambient, kick"></label><button id="lpPlay">▶ Hear it as a loop</button><span class="muted small">The DAW loops these bars while you work. The reverb and delay tails wrap round to the start, so it repeats with no gap.</span></div>';
    $("#lpBars", b).onchange = function () { var n = +this.value; window.CP.edit("Loop length", function (x) { x.bars = n; }); D.edit("Loop", function (q) { q.loop = { on: true, start: 0, end: D.tempo.barToBeat(n) }; }); drawStrip(); };
    $$("[data-lps]", b).forEach(function (x) { x.onclick = function () { var v = x.dataset.lps === "set"; window.CP.edit("Loop set", function (q) { q.set = v; }); drawStrip(); }; });
    $("#lpTags", b).onchange = function () { var v = this.value.split(",").map(function (x) { return x.trim().toLowerCase(); }).filter(Boolean).slice(0, 10); window.CP.edit("Tags", function (x) { x.tags = v; }); };
    $("#lpPlay", b).onclick = function () { renderLoops(false).then(function (l) { A.audition(D.ctx(), l[0].buf, { loop: true }); window.CP.toast("Playing it as a loop. Esc stops it."); }).catch(function (e) { window.CP.toast(e.message, "bad"); }); };
  }
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") A.stopAudition(); });
  function loopEnd() { return D.tempo.barToBeat(data().bars || 4); }
  function renderLoops(set) {
    var end = loopEnd(), secs = D.tempo.beatToSec(end);
    if (!D.project().tracks.some(function (t) { return t.clips.some(function (c) { return c.start < end && !c.mute; }); })) return Promise.reject(new Error("The loop is empty: record or draw clips in bars 1 to " + (data().bars || 4) + "."));
    if (!set) return D.render({ from: 0, to: end }).then(function (b) { return [{ name: window.CP.project().name, buf: A.asLoop(b, secs, 0.02) }]; });
    var out = [], list = D.project().tracks.filter(function (t) { return t.kind !== "bus" && t.clips.some(function (c) { return c.start < end && !c.mute; }); });
    return list.reduce(function (pr, t) { return pr.then(function () { return D.render({ from: 0, to: end, tracks: [t.id] }).then(function (b) { out.push({ name: window.CP.project().name + " - " + t.name, buf: A.asLoop(b, secs, 0.02) }); }); }); }, Promise.resolve()).then(function () { return out; });
  }

  // ------------------------------------------------------------- exports
  function range() { var p = D.project(); return p.loop.on && p.loop.end > p.loop.start && window.CP.project().type === "loop" ? { from: p.loop.start, to: p.loop.end } : { from: 0, to: D.songEnd() }; }
  function mixWav() { return D.render(range()).then(function (b) { return H.exportFiles(window.CP.project().name, [{ name: Z.slug(window.CP.project().name) + ".wav", data: new Uint8Array(Z.wav(b, 24)) }]); }); }
  function mixMp3() { return D.render(range()).then(function (b) { return H.exportFiles(window.CP.project().name, [{ name: Z.slug(window.CP.project().name) + ".mp3", data: A.mp3(b, 256) }]); }); }
  function stems() { return D.stems(range()).then(function (l) { return H.exportFiles(window.CP.project().name + " stems", l.map(function (x, i) { return { name: String(i + 1).padStart(2, "0") + " " + x.track.name.replace(/[^\w\- ]+/g, "") + ".wav", data: new Uint8Array(Z.wav(x.buffer, 24)) }; })); }); }

  var common = {
    daw: true, tempo: true,
    mount: function (el, project) { frame(el, this.id); drawStrip(); this._off = D.on("change", function (w) { if (w !== "nudge" && w !== "select" && project.type === "track") { var f = document.activeElement; if (!(f && strip.el && strip.el.contains(f))) drawStrip(); } }); },
    unmount: function () { if (this._off) this._off(); strip.el = null; A.stopAudition(); D.stop(); },
    changed: function () { drawStrip(); },
    collect: function (project) { return { data: project.data, files: {} }; }
  };
  window.CP.type(Object.assign({}, common, {
    id: "track", name: "Track", blurb: "A song with stems, a click and a guide, for Central Tracks",
    long: "Record and arrange a song: drums, bass, keys, guitars, vocals and a spoken guide. Mark the sections on the ruler, add the lyrics and chords, and it exports as a Central Tracks song (stems, click, the mix and song file) or publishes to Central Tracks.",
    dawOptions: function () { return { tracks: [["drums", "Drums", "builtin:kit"], ["instrument", "Bass", "builtin:bass"], ["instrument", "Keys", "builtin:keys"], ["instrument", "Pad", "builtin:pad"], ["audio", "Vocals", null], ["audio", "Guide", null]] }; },
    afterFresh: function () { D.edit("Sections", function (p) { var b = D.tempo.bpb(); p.markers = [{ id: D.uid("m"), beat: 0, name: "Intro" }, { id: D.uid("m"), beat: b * 4, name: "Verse 1" }, { id: D.uid("m"), beat: b * 12, name: "Chorus" }]; }); D.markSaved(); },
    create: function (opts) { return { title: opts.name || "", artist: "", click: true, roles: {}, lyrics: {}, chords: {} }; },
    exports: [["Export the mix (WAV)", mixWav, "The whole song, mixed, 24-bit"], ["Export the mix (MP3)", mixMp3, "256 kbps, for sharing"], ["Export stems (WAV)", stems, "One WAV per track, all the same length"],
      ["Export for Central Tracks", function () { return tracksPackage().then(function (pk) { return H.exportFiles(pk.title + " (Central Tracks)", pk.files.map(function (f) { return { name: f.name, data: f.data }; })).then(function (where) { if (where && window.CDawSong) gradeBox(pk.mix, "Exported for Central Tracks"); return where; }); }); }, "Stems, click, the mix and song.json (sections, lyrics, chords)"]]
      .concat(window.CDawSong ? [["Export for Central Pedal", pedalPack, "A track pack: the stems by part, click, spoken guide, sections (Markers.mid) and the chart"]] : []),
    publish: { store: "tracks", build: tracksPackage },
    install: function () { return tracksPackage().then(function (pk) { return { song: pk }; }); },
    tracksPackage: tracksPackage, pedalPack: pedalPack, gradeBox: gradeBox
  }));
  window.CP.type(Object.assign({}, common, {
    id: "loop", name: "Loop", blurb: "A tempo- and key-tagged loop (or a set, one per track)",
    long: "Make a loop: the DAW loops the bars you pick while you work, and it exports seamless (the reverb wraps round). Tagged with its tempo and key, for Central Pads and the other apps' loop players.",
    options: function () { return '<label>Length <select id="npBars"><option value="1">1 bar</option><option value="2">2 bars</option><option value="4" selected>4 bars</option><option value="8">8 bars</option><option value="16">16 bars</option></select></label>'; },
    readOptions: function (d) { return { bars: +$("#npBars", d).value || 4 }; },
    dawOptions: function () { return { tracks: [["drums", "Drums", "builtin:kit"], ["instrument", "Bass", "builtin:bass"], ["instrument", "Keys", "builtin:keys"], ["audio", "Audio", null]] }; },
    afterFresh: function (opts) { var bars = opts.bars || 4; D.edit("Loop", function (p) { p.loop = { on: true, start: 0, end: D.tempo.barToBeat(bars) }; }); D.markSaved(); },
    create: function (opts) { return { bars: opts.bars || 4, set: false, tags: [] }; },
    exports: [["Export the loop (WAV)", function () { return renderLoops(data().set).then(function (l) { return H.exportFiles(window.CP.project().name, l.map(function (x) { return { name: x.name.replace(/[^\w\- ]+/g, "") + " " + D.project().bpm + "bpm " + D.project().key + ".wav", data: new Uint8Array(Z.wav(x.buf, 24)) }; })); }); }, "Seamless, named with its tempo and key"],
      ["Export the loop (MP3)", function () { return renderLoops(false).then(function (l) { return H.exportFiles(window.CP.project().name, [{ name: Z.slug(window.CP.project().name) + ".mp3", data: A.mp3(A.repeat(l[0].buf, Math.max(l[0].buf.duration, 8)), 256) }]); }); }, "For sharing (use the WAV in the apps: MP3 adds a tiny gap)"],
      ["Export stems (WAV)", stems, "One WAV per track"]],
    publish: { store: "make", kind: "loop", build: function () { return renderLoops(data().set).then(function (l) { return { loops: l, demo: A.demo(A.repeat(l[0].buf, Math.min(30, Math.max(l[0].buf.duration * 2, 12))), 30), bpm: D.project().bpm, key: D.project().key, bars: data().bars }; }); } },
    install: function () { return renderLoops(data().set).then(function (l) { return { loops: l, bpm: D.project().bpm, key: D.project().key, bars: data().bars }; }); },
    renderLoops: renderLoops
  }));
})();
