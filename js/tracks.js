/* Pad Pedal - Tracks: multitrack songs (stems or one file), auto tempo / key /
 * downbeat detection, a generated click + spoken cues on their own output,
 * sections with loops and pad transitions, live key / tempo change, lyrics,
 * chord charts, MIDI out (lights + general), Ableton Link, and the "display"
 * state that the 3.5" screen, the projector and companion devices mirror. */
(function () {
  "use strict";
  var PP = window.PP, F = window.PPFeatures; if (!PP || !F) return;
  var engine = PP.engine, clamp = PP.clamp, esc = PP.escapeHtml, KEYS = PP.KEYS;
  var MEDIA = "http://127.0.0.1:8766";
  function $(s) { return document.querySelector(s); }
  function $$(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }
  function project() { return PP.project(); }
  function bridge() { return window.__pedalBridge; }
  function send(m) {
    // the backup player follows silently: no MIDI hits / clock / Link / ProPresenter from it until it takes over
    if (m && window.PPBackup && window.PPBackup.silent() && /^(midiOut|midiClock|link|propresenter)$/.test(m.type)) return false;
    var b = bridge(); return b && b.send ? b.send(m) : false;
  }
  function driverOn() { var b = bridge(); return !!(b && b.connected); }
  function fmtTime(t) { t = Math.max(0, t || 0); var m = Math.floor(t / 60), s = Math.floor(t % 60); return m + ":" + (s < 10 ? "0" : "") + s; }
  function keyName(k) { return (k || "C").replace("#", "♯"); }
  function slug(s) { return String(s || "").toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }

  // ------------------------------------------------------------- song data
  var ROLE_WORDS = [["click", /click|metronome|clik/i], ["guide", /guide|cue|md\b|director|talk/i], ["drums", /drum|kick|snare|perc|loop|beat/i], ["bass", /bass/i], ["keys", /key|piano|synth|pad|organ|rhodes/i], ["guitar", /gtr|guitar|acoustic|elec|\beg\s*\d*\b|\bag\s*\d*\b|dobro|mandolin|banjo/i], ["vocals", /vox|vocal|bgv|choir|lead/i]];
  function guessRole(name) { for (var i = 0; i < ROLE_WORDS.length; i++) if (ROLE_WORDS[i][1].test(name)) return ROLE_WORDS[i][0]; return "music"; }
  function data(s) {
    if (!s) return null;
    var t = s.tracks = s.tracks || {};
    if (!Array.isArray(t.stems)) t.stems = [];
    if (t.duration == null) t.duration = 0;
    if (t.keyShift == null) t.keyShift = 0;
    if (t.tempoPercent == null) t.tempoPercent = 100;
    if (t.countIn == null) t.countIn = 1;
    if (!t.click) t.click = { on: true, level: 80, sub: 1, sound: "wood", stems: true };
    if (!t.cues) t.cues = { on: true, level: 90, leadBars: 1, countVoice: true };
    if (!Array.isArray(t.sections)) t.sections = [];
    if (!Array.isArray(t.hits)) t.hits = [];
    if (t.autoHits == null) t.autoHits = true;
    if (!t.transition) t.transition = { type: "swell", seconds: 2.5 };
    if (!t.grid) t.grid = { mode: "auto", bpm: s.bpm || 72, first: 0, bpb: 4 };
    if (t.lyricsLines == null) t.lyricsLines = 4;
    if (t.jump == null) t.jump = "bar";
    if (!t.after) t.after = t.autoNext ? "play" : "stop";
    if (t.gap == null) t.gap = 2;
    if (t.overlap == null) t.overlap = 0;
    t.sections.forEach(function (sec, i) { if (!sec.id) sec.id = PP.id(); if (sec.bar == null) sec.bar = 1; if (sec.pad == null) sec.pad = -1; if (!sec.transition) sec.transition = "inherit"; if (sec.cue == null) sec.cue = "auto"; if (sec.lyrics == null) sec.lyrics = ""; if (sec.page == null) sec.page = 0; if (!sec.name) sec.name = "Section " + (i + 1); });
    return t;
  }
  function song() { return PP.activeSong(); }
  function tdata() { return data(song()); }

  // ------------------------------------------------------------- stem storage (IndexedDB)
  var DB = "pad-pedal-tracks-v1", STORE = "stems", dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve) { if (!window.indexedDB) return resolve(null); var r = indexedDB.open(DB, 1); r.onupgradeneeded = function () { r.result.createObjectStore(STORE); }; r.onsuccess = function () { idbOk = true; resolve(r.result); }; r.onerror = function () { resolve(null); }; });
    return dbp;
  }
  // decoded stems kept in memory for quick loading: only the most recent ones, within a budget (a Pi has little
  // memory, and the song that plays has its own copy in the player) - the rest are read back from IndexedDB
  var idbOk = false, stemMemory = new Map(), MEM_BUDGET = Math.max(160, Math.min(900, ((navigator.deviceMemory || 4) * 1024) * 0.12)) * 1048576;
  function stemBytes(rec) { return rec ? (rec.L ? rec.L.byteLength : 0) + (rec.R ? rec.R.byteLength : 0) : 0; }
  function remember(id, rec) {
    stemMemory.delete(id); stemMemory.set(id, rec);
    var total = 0; stemMemory.forEach(function (r) { total += stemBytes(r); });
    if (!idbOk) return;   // (no IndexedDB: memory is the only copy)
    for (var k of stemMemory.keys()) { if (total <= MEM_BUDGET || stemMemory.size <= 1) break; if (k === id) continue; total -= stemBytes(stemMemory.get(k)); stemMemory.delete(k); }
  }
  async function putStem(id, rec) { remember(id, rec); var d = await db(); if (!d) return; await new Promise(function (res) { var tx = d.transaction(STORE, "readwrite"); tx.objectStore(STORE).put(rec, id); tx.oncomplete = res; tx.onerror = res; }); }
  async function getStemLocal(id) {
    if (stemMemory.has(id)) { var hit = stemMemory.get(id); remember(id, hit); return hit; }
    var d = await db(); if (!d) return null;
    var rec = await new Promise(function (res) { var tx = d.transaction(STORE, "readonly"), q = tx.objectStore(STORE).get(id); q.onsuccess = function () { res(q.result || null); }; q.onerror = function () { res(null); }; });
    if (rec) remember(id, rec);
    return rec;
  }
  // A stem whose decoded copy is gone from this browser (new card, restored backup, cleared profile) is
  // decoded again from the file the driver keeps in /data/pad-pedal/library.
  var restoring = {};
  async function getStem(id) {
    var rec = await getStemLocal(id); if (rec) return rec;
    var st = null; (project().songs || []).some(function (sg) { return (sg.tracks && sg.tracks.stems || []).some(function (q) { if (q.id === id) st = q; return !!st; }); });
    if (!st || !(st.file || (st.files && st.files.length)) || !driverOn()) return null;
    if (!restoring[id]) restoring[id] = (async function () {
      try {
        PP.setStatus("Loading " + st.name + " from the library…");
        var buffer = st.file ? await decodeFile(await fileFromMedia(st.file)) : await decodeSum(await Promise.all(st.files.map(fileFromMedia))), pcm = toPcm(buffer);
        await putStem(id, pcm); st.length = pcm.length; return pcm;
      } catch (error) { console.warn("library restore failed", st.file, error); return null; }
      finally { delete restoring[id]; }
    })();
    return restoring[id];
  }
  async function delStem(id) { stemMemory.delete(id); var d = await db(); if (!d) return; await new Promise(function (res) { var tx = d.transaction(STORE, "readwrite"); tx.objectStore(STORE).delete(id); tx.oncomplete = res; tx.onerror = res; }); }

  // ------------------------------------------------------------- analysis worker
  var worker = null, jobs = {}, jobId = 0;
  function ensureWorker() {
    if (worker || !window.PP_ANALYSIS_WORKER) return worker;
    var src = "(" + window.PP_ANALYSIS_WORKER.toString() + ")();";
    try { worker = new Worker("data:text/javascript;charset=utf-8," + encodeURIComponent(src)); }
    catch (error) { console.warn("analysis worker unavailable", error); return null; }
    worker.onmessage = function (e) { var j = jobs[e.data.id]; if (!j) return; delete jobs[e.data.id]; if (e.data.error) j.reject(new Error(e.data.error)); else j.resolve(e.data.result); };
    return worker;
  }
  function mono(buffer, maxSeconds) {
    var n = Math.min(buffer.length, maxSeconds ? Math.floor(maxSeconds * buffer.sampleRate) : buffer.length), out = new Float32Array(n), ch = buffer.numberOfChannels;
    for (var c = 0; c < ch; c++) { var d = buffer.getChannelData(c); for (var i = 0; i < n; i++) out[i] += d[i] / ch; }
    return out;
  }
  function analyzeBuffer(buffer, opts) {
    var w = ensureWorker(); if (!w) return Promise.reject(new Error("no worker"));
    var id = ++jobId, m = mono(buffer);
    return new Promise(function (resolve, reject) { jobs[id] = { resolve: resolve, reject: reject }; w.postMessage({ cmd: "analyze", id: id, mono: m, rate: buffer.sampleRate, opts: opts || {} }, [m.buffer]); });
  }
  function workerJob(cmd, monoData, rate, opts) {
    var w = ensureWorker(); if (!w) return Promise.reject(new Error("no worker"));
    var id = ++jobId, copy = monoData.slice ? monoData.slice() : new Float32Array(monoData);
    return new Promise(function (resolve, reject) { jobs[id] = { resolve: resolve, reject: reject }; w.postMessage({ cmd: cmd, id: id, mono: copy, rate: rate, opts: opts || {} }, [copy.buffer]); });
  }
  // mono sum of the song's stems (or just the ones `filter` accepts) as a Float32Array at the engine rate
  async function mixdown(s, filter) {
    var t = data(s); if (!t || !t.stems.length) return null;
    var rate = engine.context().sampleRate, length = 0, count = 0;
    t.stems.forEach(function (st) { if (!filter || filter(st)) length = Math.max(length, st.length || 0); });
    if (!length) return null;
    var d = new Float32Array(length);
    for (var i = 0; i < t.stems.length; i++) {
      var st = t.stems[i]; if (filter && !filter(st)) continue;
      var rec = await getStem(st.id); if (!rec) continue;
      var L = new Int16Array(rec.L), R = rec.R ? new Int16Array(rec.R) : null, g = (st.gain != null ? Math.min(1.3, st.gain) : 1) / 32768;
      for (var k = 0; k < L.length; k++) d[k] += (R ? (L[k] + R[k]) * .5 : L[k]) * g;
      count++;
    }
    return count ? { mono: d, rate: rate } : null;
  }
  function keyOf(buffer) {
    var w = ensureWorker(); if (!w) return Promise.resolve(null);
    var id = ++jobId, m = mono(buffer, 30);
    return new Promise(function (resolve) { jobs[id] = { resolve: resolve, reject: function () { resolve(null); } }; w.postMessage({ cmd: "key", id: id, mono: m, rate: buffer.sampleRate }, [m.buffer]); });
  }
  window.PPAnalysis = { analyze: analyzeBuffer, keyOf: keyOf };

  // ------------------------------------------------------------- decoding stems
  async function decodeFile(file) {
    await engine.ensure();
    var rate = engine.ctx.sampleRate, bytes = await file.arrayBuffer();
    var off = new OfflineAudioContext(2, 1, rate);
    return off.decodeAudioData(bytes.slice(0));
  }
  function toPcm(buffer) {
    var n = buffer.length, L = new Int16Array(n), R = null, l = buffer.getChannelData(0), r = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null, same = true;
    for (var i = 0; i < n; i++) { L[i] = Math.max(-32768, Math.min(32767, Math.round(l[i] * 32767))); }
    if (r) { for (var k = 0; k < n; k += 97) { if (Math.abs(l[k] - r[k]) > 1e-4) { same = false; break; } } if (!same) { R = new Int16Array(n); for (var j = 0; j < n; j++) R[j] = Math.max(-32768, Math.min(32767, Math.round(r[j] * 32767))); } }
    return { L: L.buffer, R: R ? R.buffer : null, length: n, rate: buffer.sampleRate };
  }
  function overview(buffer, bins) {
    var out = new Array(bins), per = Math.max(1, Math.floor(buffer.length / bins)), d = buffer.getChannelData(0);
    for (var b = 0; b < bins; b++) { var m = 0, s = b * per, e = Math.min(buffer.length, s + per); for (var i = s; i < e; i += 4) { var v = Math.abs(d[i]); if (v > m) m = v; } out[b] = Math.round(m * 100) / 100; }
    return out;
  }
  // one waveform for the whole song: every track (not the click / guide) mixed together
  function combinedOverview(t) {
    var bins = 960, acc = new Float32Array(bins), used = 0;
    t.stems.forEach(function (st) {
      if (!st.overview || !st.overview.length || st.role === "click" || st.role === "guide" || st.mute) return;
      var ov = st.overview, g = st.gain == null ? 1 : st.gain; used++;
      for (var b = 0; b < bins; b++) { var v = ov[Math.min(ov.length - 1, Math.floor(b * ov.length / bins))] * g; acc[b] += v * v; }
    });
    if (!used) return t.overview || [];
    var max = 0, out = new Array(bins); for (var i = 0; i < bins; i++) { out[i] = Math.sqrt(acc[i]); if (out[i] > max) max = out[i]; }
    for (var j = 0; j < bins; j++) out[j] = max ? Math.round(out[j] / max * 100) / 100 : 0;
    return out;
  }
  function refreshOverview(t) { t.overview = combinedOverview(t); t.overviewMix = 2; }
  // what Central Control gets for a song (lighting songs, waveform, sections, hits): see hub.js
  function hubSong(s) {
    var t = data(s); if (!s || !t) return null;
    if (t.stems.length && (t.overviewMix !== 2 || !t.overview || !t.overview.length)) refreshOverview(t);
    var g = t.stems.length ? grid(s) : null, ov = t.overview || [], bins = 480, out = [], C = window.PPColors;
    if (ov.length) for (var i = 0; i < bins; i++) { var a = Math.floor(i * ov.length / bins), b = Math.max(a + 1, Math.floor((i + 1) * ov.length / bins)), m = 0; for (var k = a; k < b; k++) m = Math.max(m, Math.abs(ov[k] || 0)); out.push(Math.round(m * 1000) / 1000); }
    var r3 = function (x) { return Math.round((x || 0) * 1000) / 1000; };
    return { id: s.id, name: s.name, key: s.key || "", bpm: Math.round((s.bpm || 0) * 10) / 10, bpb: g ? g.bpb : 4, duration: r3(t.duration), hasTracks: !!t.stems.length,
      sections: sectionsOf(s).map(function (q) { return { name: q.sec.name, start: r3(q.start), end: r3(q.end), bar: q.sec.bar, type: C ? C.typeOf(q.sec.name) : null, color: C ? C.section(q.sec.name) : null, note: q.sec.note || "" }; }),
      grid: g ? { bpm: Math.round((s.bpm || 0) * 10) / 10, bpb: g.bpb, bars: g.bars.slice(0, 800).map(r3), barBeats: g.barBeats ? g.barBeats.slice(0, 800) : [] } : null,
      hits: (t.hits || []).slice(0, 600).map(r3), overview: out,
      drumHits: t.drumHits ? DRUMS.reduce(function (o, k) { o[k] = (t.drumHits[k] || []).slice(0, 4000).map(r3); return o; }, {}) : null,   // (kick, snare, hi-hat, crash - from a split's kit pieces)
      stems: t.stems.map(function (st) { return { name: st.name, role: st.role || "", file: st.file || null, gain: st.gain == null ? 1 : st.gain, pan: st.pan || 0, mute: !!st.mute, bus: st.bus || "music" }; }),
      // everything the parts for each instrument are made from (chords, sections, the tracks written down, the words' timing)
      music: window.PPParts ? window.PPParts.contextOf(s, t, g, { chartText: t.chartText || "" }) : null };
  }
  async function addStemFile(s, file, progress) {
    var t = data(s), name = file.name.replace(/\.[^.]+$/, "");
    if (progress) progress("Decoding " + name + "…");
    var buffer = await decodeFile(file), pcm = toPcm(buffer), id = PP.id();
    await putStem(id, pcm);
    var role = file._role || guessRole(name);
    var rec = { id: id, name: name, role: role, gain: 1, pan: 0, mute: !!file._mute, solo: false, bus: role === "click" || role === "guide" ? "click" : "music", length: pcm.length, overview: overview(buffer, 960) };   // (the click and the guide go to the in-ears)
    t.stems.push(rec);
    keepInLibrary(s, file, rec);
    t.duration = Math.max(t.duration, buffer.duration);
    refreshOverview(t);
    PP.persistSoon();
    return { stem: t.stems[t.stems.length - 1], buffer: buffer };
  }
  async function analyzeSong(s, buffers, progress, opts) {
    var t = data(s); if (!t.stems.length) return;
    opts = opts || {};
    if (progress) progress(opts.bpm ? "Re-fitting the beat grid at " + opts.bpm + " BPM…" : "Finding the tempo and key…");
    // analyze the drums if there is a drum stem, else the sum of everything that isn't click/guide
    var pick = null, rate = engine.ctx.sampleRate;
    if (buffers) { pick = buffers.filter(function (b) { return b.stem.role === "drums"; })[0] || null; }
    var length = Math.max.apply(null, t.stems.map(function (st) { return st.length; }));
    var mix = engine.ctx.createBuffer(1, length, rate), d = mix.getChannelData(0), count = 0;
    for (var i = 0; i < t.stems.length; i++) {
      var st = t.stems[i]; if (st.bus === "click" || st.role === "guide") continue;
      var rec = await getStem(st.id); if (!rec) continue;
      var L = new Int16Array(rec.L), R = rec.R ? new Int16Array(rec.R) : null, g = 1 / 32768;
      if (pick && pick.stem.id !== st.id) continue;
      for (var k = 0; k < L.length; k++) d[k] += (R ? (L[k] + R[k]) * .5 : L[k]) * g;
      count++;
    }
    if (!count) return;
    var secTimes = opts.bpm ? t.sections.map(function (sec) { return sec.bar <= 1 ? -1 : barStart(s, sec.bar); }) : null;  // sections keep their place in time when the tempo changes (a section at bar 1 stays there)
    var res = await analyzeBuffer(mix, { beatsPerBar: t.grid.bpb || 4, bpm: opts.bpm || 0 });
    if (opts.bpm && t.analysis) { res.tempoCandidates = t.analysis.tempoCandidates; res.keyCandidates = res.keyCandidates || t.analysis.keyCandidates; }  // keep the other guesses on screen
    t.analysis = res;
    if (opts.bpm) t.grid.mode = "fitted";
    if (t.grid.mode === "auto" || t.grid.mode === "fitted") { t.grid.bpm = res.bpm; t.grid.first = res.grid ? res.grid.first : (res.beats[res.phase] || 0); t.grid.mode = res.grid && res.grid.steady ? "fitted" : "detected"; }
    if (!t.originalKey) { t.originalKey = res.key; t.originalMode = res.mode; if (t.keyShift === 0) { s.key = res.key; } }
    if (t.autoHits) t.hits = res.hits.slice();
    s.bpm = Math.round(res.bpm * 10) / 10 / (t.tempoPercent / 100);
    if (secTimes) { t.sections.forEach(function (sec, i) { if (secTimes[i] < 0) { sec.bar = 1; return; } var b = timeToBar(s, secTimes[i]); sec.bar = b.bar + (b.frac > 0.5 ? 1 : 0); }); }
    if (!t.sections.length && opts.sections !== false) {   // found from the tracks (js/structure.js); else every 8 bars
      var found = null;
      if (window.PPStructure) { try { if (progress) progress("Finding the sections…"); found = await window.PPStructure.detect(s); } catch (error) { console.warn("sections", error); } }
      if (!found) autoSections(s);
    }
    PP.persistSoon();
    return res;
  }

  // ------------------------------------------------------------- beat grid & sections
  var gridCache = { key: null, value: null };
  // Tempo map: t.tempoMap = [{ bar, bpm, bpb, ritBars, ritTo }, ...] - from that bar on, this tempo and meter;
  // with ritBars / ritTo the tempo slides from bpm to ritTo over ritBars bars and stays there (an ending, a
  // slow bridge). Bar 1 is the song's main tempo (t.grid) unless the map says otherwise.
  function tempoSegments(t) {
    var base = { bar: 1, bpm: Math.max(20, t.grid.bpm || 120), bpb: t.grid.bpb || 4 }, map = (t.tempoMap || []).filter(function (m) { return m && m.bar >= 1; }).map(function (m) {
      return { bar: Math.max(1, Math.round(m.bar)), bpm: Math.max(20, Number(m.bpm) || base.bpm), bpb: clamp(Math.round(Number(m.bpb) || base.bpb), 1, 12), ritBars: Math.max(0, Math.round(Number(m.ritBars) || 0)), ritTo: Math.max(20, Number(m.ritTo) || 0) };
    }).sort(function (a, b) { return a.bar - b.bar; });
    if (!map.length || map[0].bar > 1) map.unshift(base);
    var seen = {}; return map.filter(function (m) { if (seen[m.bar]) return false; seen[m.bar] = 1; return true; });
  }
  function segmentAt(segs, bar) { var seg = segs[0]; for (var i = 0; i < segs.length; i++) if (segs[i].bar <= bar) seg = segs[i]; return seg; }
  function bpmAt(segs, bar, beatInBar) {  // tempo of one beat, with any ritardando applied
    var seg = segmentAt(segs, bar);
    if (!seg.ritBars || !seg.ritTo) return seg.bpm;
    var beatsIn = (bar - seg.bar) * seg.bpb + beatInBar, total = seg.ritBars * seg.bpb;
    return beatsIn >= total ? seg.ritTo : seg.bpm + (seg.ritTo - seg.bpm) * (beatsIn / total);
  }
  function grid(s) {
    var t = data(s); if (!t) return null;
    var key = s.id + "|" + t.grid.mode + "|" + t.grid.bpm + "|" + t.grid.first + "|" + t.grid.bpb + "|" + t.duration + "|" + (t.analysis ? t.analysis.beats.length : 0) + "|" + JSON.stringify(t.tempoMap || []);
    if (gridCache.key === key) return gridCache.value;
    var segs = tempoSegments(t), bpb = segs[0].bpb, times = [], down = [], barBeats = [], dur = Math.max(t.duration, 1) + 8;
    if (t.grid.mode === "detected" && t.analysis && t.analysis.beats.length > 4) {
      var b = t.analysis.beats, phase = t.analysis.phase || 0, period = 60 / t.grid.bpm;
      // extend backwards to the first downbeat, forwards to the end
      var first = b[0] - Math.ceil(b[0] / period) * period; if (first < -0.02) first += period;
      var extra = []; for (var x = first; x < b[0] - period * .5; x += period) extra.push(x);
      var all = extra.concat(b); var last = all[all.length - 1]; while (last + period < dur) { last += period; all.push(last); }
      var offset = extra.length, barNo = 1, inBar = 0, curBpb = bpb;
      all.forEach(function (tm, i) {
        var k = i - offset - phase;
        if (k < 0) { times.push(tm); down.push(((k % bpb) + bpb) % bpb === 0 ? 1 : 0); return; }
        times.push(tm);
        if (inBar === 0) { curBpb = segmentAt(segs, barNo).bpb; down.push(1); barBeats.push(curBpb); } else down.push(0);
        inBar++; if (inBar >= curBpb) { inBar = 0; barNo++; }
      });
    } else {
      var f = t.grid.first || 0, per0 = 60 / segs[0].bpm;
      while (f - per0 * bpb >= -0.02) f -= per0 * bpb;
      var tm2 = f, bar = 1;
      while (tm2 < dur && bar < 4000) {
        var seg = segmentAt(segs, bar);
        barBeats.push(seg.bpb);
        for (var q2 = 0; q2 < seg.bpb; q2++) { times.push(Math.max(0, tm2)); down.push(q2 === 0 ? 1 : 0); tm2 += 60 / bpmAt(segs, bar, q2); }
        bar++;
      }
    }
    var value = { times: times, down: down, bpb: bpb, period: 60 / segs[0].bpm, bars: [], barBeats: barBeats, segments: segs };
    for (var i3 = 0; i3 < times.length; i3++) if (down[i3]) value.bars.push(times[i3]);
    value.barLen = value.bars.map(function (st, i) { return i + 1 < value.bars.length ? value.bars[i + 1] - st : (value.bars.length > 1 ? value.bars[i] - value.bars[i - 1] : value.period * bpb); });
    gridCache = { key: key, value: value };
    return value;
  }
  function barLength(g, barIndex) { if (!g || !g.bars.length) return 2; var i = clamp(barIndex, 0, g.barLen.length - 1); return g.barLen[i] || g.period * g.bpb; }
  function beatsInBar(s, bar) { var g = grid(s); if (!g) return 4; var segs = g.segments || tempoSegments(data(s)); return segmentAt(segs, Math.max(1, bar)).bpb; }
  function barStart(s, bar) { var g = grid(s); if (!g || !g.bars.length) return 0; bar = Math.max(1, Math.round(bar)); return bar - 1 < g.bars.length ? g.bars[bar - 1] : g.bars[g.bars.length - 1] + (bar - g.bars.length) * barLength(g, g.bars.length - 1); }
  function timeToBar(s, tm) {
    var g = grid(s); if (!g || !g.bars.length) return { bar: 1, beat: 1, frac: 0 };
    var i = 0; while (i < g.bars.length - 1 && g.bars[i + 1] <= tm) i++;
    var barLen = barLength(g, i), within = tm - g.bars[i];
    // the beat inside the bar from the real beat times (they are not evenly spaced in a ritardando)
    var beat = 1, bi = g.times.indexOf(g.bars[i]); if (bi >= 0) { var n = 0; while (bi + n + 1 < g.times.length && !g.down[bi + n + 1] && g.times[bi + n + 1] <= tm) n++; beat = n + 1; }
    return { bar: i + 1, beat: beat, frac: clamp(within / barLen, 0, .999) };
  }
  function sectionsOf(s) { var t = data(s); if (!t) return []; var list = t.sections.slice().sort(function (a, b) { return a.bar - b.bar; }), out = []; list.forEach(function (sec, i) { var start = barStart(s, sec.bar), end = i < list.length - 1 ? barStart(s, list[i + 1].bar) : Math.max(start + 1, t.duration); out.push({ sec: sec, index: i, start: start, end: end }); }); return out; }
  function sectionAt(s, tm) { var list = sectionsOf(s); for (var i = list.length - 1; i >= 0; i--) if (tm >= list[i].start - 0.001) return list[i]; return list.length ? null : null; }
  function autoSections(s) {
    var t = data(s), g = grid(s); if (!g) return;
    var totalBars = Math.max(1, timeToBar(s, t.duration).bar), names = ["Intro", "Verse 1", "Chorus", "Verse 2", "Chorus", "Bridge", "Chorus", "Outro"], n = 0;
    t.sections = [];
    for (var bar = 1; bar <= totalBars; bar += 8) { t.sections.push({ id: PP.id(), name: names[n] || "Section " + (n + 1), bar: bar, pad: -1, transition: "inherit", cue: "auto", lyrics: "", page: 0 }); n++; }
    PP.persistSoon();
  }

  // ------------------------------------------------------------- worklet
  // per-stem direct outputs (only offered when a USB interface gives more than the four built-in channels)
  var DIRECT_SLOTS = 8, NET_SLOTS = 24, directGains = [];
  function outputChannels() { var st = F.systemStatus && F.systemStatus(); var names = st && st.audio && st.audio.channels ? st.audio.channels : null; if (names && names.length) return names; var c = engine.ctx; return c ? Array.from({ length: Math.max(2, c.destination.maxChannelCount || 2) }, function (_, i) { return "Output " + (i + 1); }) : []; }
  function directOutsAvailable() { var st = F.systemStatus && F.systemStatus(); if (st && st.audio && st.audio.channels) return st.audio.channels.length > 4 && st.audio.channels.some(function (n) { return /usb/i.test(n); }); var c = engine.ctx; return !!(c && (c.destination.maxChannelCount || 2) > 4); }
  function applyDirectOuts() {  // the song's stems with an output -> engine.directOuts slots -> routeOutput
    var s = song(), t = s && data(s); if (!directGains.length) return;
    var list = [], slot = 0;
    (t ? t.stems : []).forEach(function (st) { if (st.out > 0 && slot < DIRECT_SLOTS && directOutsAvailable()) { st.outSlot = slot; list.push({ id: st.id, node: directGains[slot], ch: st.out }); slot++; } else st.outSlot = -1; });
    engine.directOuts = list; engine.routeOutput();
    var multi = engine.routing && engine.routing.mode !== "stereo2";
    post({ cmd: "fold", on: !multi || !list.length });
    if (t) t.stems.forEach(function (st) { post({ cmd: "stem", id: st.id, out: multi && st.outSlot >= 0 ? st.outSlot : -1 }); });
  }
  var node = null, workletReady = null, loadedSongId = null, state = { playing: false, pos: 0, countIn: 0, loop: -1, section: -1, lyricsPage: -1, lyricsManual: null, ended: false, flowIndex: 0 };
  function ensureWorklet() {
    if (workletReady) return workletReady;
    workletReady = (async function () {
      await engine.ensure();
      if (!window.PP_MULTITRACK_WORKLET) throw new Error("worklet source missing");
      var src = "(" + window.PP_MULTITRACK_WORKLET.toString() + ")();";
      await engine.ctx.audioWorklet.addModule("data:text/javascript;charset=utf-8," + encodeURIComponent(src));
      // two players ("decks"): the song on stage plays on one; the next song is loaded into the other so a
      // segue can start it gaplessly or crossfade into it. Both feed the same buses and direct outputs.
      directGains = [];
      for (var di = 0; di < DIRECT_SLOTS; di++) { var g = engine.ctx.createGain(); g.channelCount = 1; g.channelCountMode = "explicit"; directGains.push(g); }
      decks = [0, 1].map(function (n) {
        var d = { n: n, songId: null, node: new AudioWorkletNode(engine.ctx, "pp-multitrack", { numberOfInputs: 0, numberOfOutputs: 4, outputChannelCount: [2, 2, DIRECT_SLOTS, NET_SLOTS] }), music: engine.ctx.createGain(), click: engine.ctx.createGain() };
        d.node.connect(d.music, 0); d.music.connect(engine.tracksBus); d.node.connect(d.click, 1); d.click.connect(engine.clickBus);
        var split = engine.ctx.createChannelSplitter(DIRECT_SLOTS); d.node.connect(split, 2);
        directGains.forEach(function (gn, i) { split.connect(gn, i); });
        d.node.port.onmessage = function (e) { if (d === deck) onWorklet(e.data); else onOtherDeck(d, e.data); };
        return d;
      });
      deck = decks[0]; node = deck.node;
      applyDirectOuts();
      post({ cmd: "meters", on: true }); decks[1].node.port.postMessage({ cmd: "meters", on: true });
      sendClickSets();
      applyLevels();
      return node;
    })();
    workletReady.catch(function (error) { console.warn("multitrack worklet failed", error); workletReady = null; });
    return workletReady;
  }
  function post(m, transfer) { if (node) node.port.postMessage(m, transfer || []); }
  // ---- click sounds from Central Tracks ("Click" items): two short samples, the accent and the beat, kept in the project
  function b64ToF32(b64) { try { var bin = atob(b64 || ""), n = bin.length >> 1, out = new Float32Array(n); for (var i = 0; i < n; i++) { var v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8); out[i] = (v > 32767 ? v - 65536 : v) / 32768; } return out; } catch (_) { return new Float32Array(0); } }
  function f32ToB64(f) { var s = ""; for (var i = 0; i < f.length; i++) { var v = Math.max(-32768, Math.min(32767, Math.round(f[i] * 32767))) & 0xffff; s += String.fromCharCode(v & 255, v >> 8); } return btoa(s); }
  function clickSets() { var p = project(); return Array.isArray(p.clickSets) ? p.clickSets : []; }
  function sendClickSets() { var sets = {}; clickSets().forEach(function (c) { sets[c.id] = { hi: b64ToF32(c.hi), lo: b64ToF32(c.lo), rate: c.rate || 48000 }; }); (decks || []).forEach(function (d) { if (d && d.node) d.node.port.postMessage({ cmd: "clickSets", sets: sets }); }); }
  function addClickSet(name, hi, lo, rate) {   // hi, lo: Float32Array (cut to half a second)
    var p = project(), max = Math.round((rate || 48000) * 0.5), id = "set:" + Math.random().toString(36).slice(2, 8);
    p.clickSets = clickSets().concat([{ id: id, name: String(name || "Click").slice(0, 40), rate: rate || 48000, hi: f32ToB64(hi.subarray(0, max)), lo: f32ToB64((lo || hi).subarray(0, max)) }]).slice(-12);
    PP.persistSoon(); sendClickSets(); clickOptions(); return id;
  }
  function clickOptions() {
    var sel = document.getElementById("seClickSound"); if (!sel) return; var cur = sel.value;
    sel.innerHTML = [["wood", "Wood"], ["sticks", "Sticks"], ["beep", "Beep"]].concat(clickSets().map(function (c) { return [c.id, c.name]; })).map(function (o) { return '<option value="' + PP.escapeHtml(o[0]) + '">' + PP.escapeHtml(o[1]) + "</option>"; }).join("");
    if (cur) sel.value = cur;
  }
  // the player's whole output (tracks, click, cues, direct and network outs): the backup player follows a song
  // silently (0) and fades in when it takes over
  var outLevel = 1;
  function setOut(v, fadeMs) { outLevel = clamp(Number(v) || 0, 0, 1); (decks || []).forEach(function (d) { if (d && d.node) d.node.port.postMessage({ cmd: "set", out: outLevel, fadeMs: fadeMs || 0 }); }); if (node && !(decks || []).some(function (d) { return d && d.node === node; })) post({ cmd: "set", out: outLevel, fadeMs: fadeMs || 0 }); }
  function postAll(m) { decks.forEach(function (d) { d.node.port.postMessage(m); }); }
  var decks = [], deck = null;
  function otherDeck() { return decks[0] === deck ? decks[1] : decks[0]; }
  function onOtherDeck(d, m) { /* the outgoing song during a crossfade, or the preloaded one: nothing to show */ }
  function swapDeck() { var od = otherDeck(); if (!od) return; deck = od; node = od.node; loadedSongId = od.songId; document.dispatchEvent(new CustomEvent("pp-stems")); }
  async function stemsFor(s) {
    var t = data(s), stems = [], transfer = [], length = 0;
    for (var i = 0; i < t.stems.length; i++) {
      var st = t.stems[i], rec = await getStem(st.id);
      if (!rec) { st.missing = true; continue; }
      if (st.fx && st.fx.on && window.PPFx) { var fxRec = await window.PPFx.stemFor(s, st, rec); if (fxRec) rec = fxRec; }   // (its effects, rendered - js/fx.js)
      var L = rec.L.slice(0), R = rec.R ? rec.R.slice(0) : null;
      stems.push({ id: st.id, L: new Int16Array(L), R: R ? new Int16Array(R) : null, gain: st.gain, pan: st.pan, mute: st.mute, solo: st.solo, role: st.role, bus: st.bus, out: -1 });
      transfer.push(L); if (R) transfer.push(R);
      length = Math.max(length, rec.length); st.missing = false;
    }
    return { stems: stems, transfer: transfer, length: length, names: stems.map(function (q) { var st = t.stems.filter(function (x) { return x.id === q.id; })[0]; return st ? st.name : "Track"; }),
      pans: stems.map(function (q) { return Math.max(-1, Math.min(1, Number(q.pan) || 0)); }) };   // (each track's pan: Central Control's channel starts there)
  }

  // ------------------------------------------------------------- segues: what happens when a song ends
  // t.after: "stop" (stay on the song) · "ready" (go to the next song, stopped) · "play" (next song plays after t.gap s)
  //          · "segue" (the next song starts as this one ends: gapless, or crossfaded over t.overlap s)
  var segue = { loading: false, running: false, armed: false };
  function afterMode(t) { return t.after || (t.autoNext ? "play" : "stop"); }
  function nextSong() { var p = project(); return p.songIndex >= 0 ? p.songs[p.songIndex + 1] || null : null; }
  function songEnd(s) {
    var t = data(s), end = t.duration || 0;
    if (flowActive(s)) { var l = flowEntries(s), last = l[l.length - 1]; if (last) end = Math.min(end, last.end); }
    return end;
  }
  async function preloadNext() {
    var s = song(), t = s && data(s), n = nextSong(); if (!s || !n || afterMode(t) !== "segue" || !data(n).stems.length) return;
    var d = otherDeck(); if (!d || d.songId === n.id || segue.loading || segue.running) return;
    segue.loading = true;
    try {
      var r = await stemsFor(n); if (otherDeck() !== d || segue.running) return;
      d.node.port.postMessage({ cmd: "pause" }); d.node.port.postMessage({ cmd: "load", stems: r.stems, length: r.length }, r.transfer); d.netNames = r.names; d.netPans = r.pans;
      var tn = data(n), g = grid(n);
      d.node.port.postMessage({ cmd: "stop", to: 0 });
      d.node.port.postMessage({ cmd: "beats", times: Float64Array.from(g.times.map(function (x) { return x * engine.ctx.sampleRate; })), downbeats: Uint8Array.from(g.down) });
      d.node.port.postMessage({ cmd: "click", enabled: !!tn.click.on, level: Math.pow(clamp(tn.click.level, 0, 100) / 100, 1.3), sub: tn.click.sub || 1, sound: tn.click.sound || "wood", stems: tn.click.stems !== false });
      d.node.port.postMessage({ cmd: "set", speed: tn.tempoPercent / 100, pitch: Math.pow(2, tn.keyShift / 12), musicLevel: 1, out: outLevel });
      d.songId = n.id;
      PP.setStatus("Next song ready: " + n.name + ((t.overlap || 0) > 0 ? " (crossfade " + t.overlap + " s)" : " (gapless)"));
    } catch (error) { console.warn("preload failed", error); }
    finally { segue.loading = false; }
  }
  function startSegue() {
    var s = song(), t = s && data(s), n = nextSong(), d = otherDeck(); if (!s || !n || !d || d.songId !== n.id || segue.running) return false;
    var ov = clamp(Number(t.overlap) || 0, 0, 30), now = engine.ctx.currentTime, old = deck;
    segue.running = true; segue.armed = false;
    d.music.gain.cancelScheduledValues(now); d.click.gain.cancelScheduledValues(now); d.click.gain.setValueAtTime(1, now);
    if (ov > 0) { d.music.gain.setValueAtTime(0.0001, now); d.music.gain.exponentialRampToValueAtTime(1, now + ov); old.music.gain.setValueAtTime(old.music.gain.value || 1, now); old.music.gain.linearRampToValueAtTime(0, now + ov); }
    else d.music.gain.setValueAtTime(1, now);
    old.click.gain.setValueAtTime(0, now + 0.01);   // the band only hears the new song's click from here on
    d.node.port.postMessage({ cmd: "play", countIn: 0 });
    swapDeck();
    setTimeout(function () { old.node.port.postMessage({ cmd: "pause" }); old.node.port.postMessage({ cmd: "clear" }); old.songId = null; var tt = engine.ctx.currentTime; old.music.gain.cancelScheduledValues(tt); old.music.gain.setValueAtTime(1, tt); old.click.gain.cancelScheduledValues(tt); old.click.gain.setValueAtTime(1, tt); }, ov * 1000 + 400);
    F.stepSong(1);   // F.onSong sees segue.running and keeps the new deck playing
    return true;
  }
  function songEnded() {
    var s = song(), t = s && data(s), mode = t ? afterMode(t) : "stop";
    if (mode === "segue") { if (!startSegue()) stepSongAndPlay(1, 0); return; }
    if (mode === "play") { stepSongAndPlay(1, Math.max(0, Number(t.gap) || 0)); return; }
    if (mode === "ready" && nextSong()) F.stepSong(1);
  }
  function watchSegue() {   // called on every position update
    var s = song(); if (!s || !state.playing || segue.running) return; var t = data(s); if (afterMode(t) !== "segue") return;
    if (state.pos > 2 && !segue.loading && otherDeck() && (!nextSong() || otherDeck().songId !== nextSong().id)) preloadNext();
    var ov = clamp(Number(t.overlap) || 0, 0, 30), end = songEnd(s);
    // gapless: start the next song one audio block before this one runs out; crossfade: overlap seconds before
    if (end > 0 && state.pos >= end - Math.max(ov, 0.06) * (t.tempoPercent / 100)) startSegue();
  }

  // ------------------------------------------------------------- mixer: per-track meters and mix changes
  var meters = {}, meterPeaks = {}, meterRaf = 0;
  function onMeters(ids, vals) {
    for (var i = 0; i < ids.length; i++) { var v = vals[i] || 0, prev = meters[ids[i]] || 0; meters[ids[i]] = v > prev ? v : prev * 0.82; if (v > (meterPeaks[ids[i]] || 0)) meterPeaks[ids[i]] = v; }
    if (!meterRaf) meterRaf = requestAnimationFrame(drawMeters);
  }
  function drawMeters() {
    meterRaf = 0;
    document.querySelectorAll(".stem[data-stem] .stem-meter").forEach(function (el) {
      var id = el.closest("[data-stem]").dataset.stem, v = meters[id] || 0, db = v > 0 ? 20 * Math.log10(v) : -90, h = clamp((db + 60) / 66 * 100, 0, 100);
      var bar = el.firstChild; if (bar) { bar.style.height = h + "%"; bar.className = db > -1 ? "clip" : db > -9 ? "hot" : ""; }
    });
  }
  // apply a set of stem values at once (a scene): [{id, gain, mute, pan}], faded over `ramp` seconds
  function applyMix(list, ramp) {
    var s = song(); if (!s) return; var t = data(s), byId = {}; list.forEach(function (q) { byId[q.id] = q; });
    t.stems.forEach(function (st) { var q = byId[st.id]; if (!q) return; if (q.gain != null) st.gain = q.gain; if (q.mute != null) st.mute = !!q.mute; if (q.pan != null) st.pan = q.pan; });
    post({ cmd: "mix", stems: list, ramp: ramp == null ? 0.5 : ramp }); PP.persistSoon(); renderStems();
  }
  function captureMix() { var s = song(); return s ? data(s).stems.map(function (st) { return { id: st.id, gain: st.gain, mute: !!st.mute, pan: st.pan || 0 }; }) : []; }
  function openMixer() { var d = $("#mixDialog"); if (!d) return; renderStems(); if (!d.open) d.showModal(); }
  async function loadSong(s) {
    var t = data(s);
    if (!s || !t.stems.length) { loadedSongId = null; post({ cmd: "clear" }); state.playing = false; state.pos = 0; render(); return; }
    await ensureWorklet();
    if (loadedSongId === s.id) return;
    // already waiting on the other deck (preloaded for a segue): just swap
    var od = otherDeck(); if (od && od.songId === s.id && !segue.running) { swapDeck(); pushAll(s); applyDirectOuts(); state.playing = false; state.pos = 0; state.countIn = 0; state.loop = -1; state.section = -1; state.ended = false; state.flowIndex = 0; render(); return; }
    var r = await stemsFor(s), stems = r.stems, transfer = r.transfer, length = r.length;
    loadedSongId = s.id; deck.songId = s.id; deck.netNames = r.names; deck.netPans = r.pans;
    post({ cmd: "load", stems: stems, length: length }, transfer);
    document.dispatchEvent(new CustomEvent("pp-stems"));
    applyDirectOuts();
    state.playing = false; state.pos = 0; state.countIn = 0; state.loop = -1; state.section = -1; state.ended = false; state.flowIndex = 0;
    pushAll(s);
    render();
  }
  // ------------------------------------------------------------- flow: the live arrangement
  // t.flow = [sectionId, ...] is the order the sections are played in (a section may appear several times);
  // t.flowOn makes the player follow it: at the end of one entry it carries on, gaplessly, at the next.
  var flowJumpId = 0;
  function flowEntries(s) {
    var t = data(s); if (!t) return [];
    var secs = sectionsOf(s), byId = {}; secs.forEach(function (x) { byId[x.sec.id] = x; });
    var ids = (t.flow && t.flow.length) ? t.flow : secs.map(function (x) { return x.sec.id; });
    return ids.map(function (id) { return byId[id]; }).filter(Boolean);
  }
  function flowActive(s) { var t = s && data(s); return !!(t && t.flowOn && t.flow && t.flow.length); }
  function flowIndexFor(s, pos, prefer) {  // which flow entry the playhead is in (the one at/after `prefer` when a section repeats)
    var list = flowEntries(s), x = sectionAt(s, Math.max(0, pos)); if (!x) return 0;
    for (var i = Math.max(0, prefer || 0); i < list.length; i++) if (list[i].index === x.index) return i;
    for (var k = 0; k < list.length; k++) if (list[k].index === x.index) return k;
    return clamp(prefer || 0, 0, Math.max(0, list.length - 1));
  }
  function armFlow(s) {
    s = s || song(); if (!node || !s) return;
    var t = data(s);
    if (!flowActive(s)) { post({ cmd: "jump" }); return; }
    var list = flowEntries(s), i = clamp(state.flowIndex || 0, 0, list.length - 1), cur = list[i], next = list[i + 1];
    if (!cur) { post({ cmd: "jump" }); return; }
    flowJumpId++;
    if (next) {
      if (Math.abs(next.start - cur.end) < 0.002) post({ cmd: "jump" });  // contiguous: nothing to do, the section change moves the flow on
      else post({ cmd: "jump", at: cur.end, to: next.start, id: flowJumpId });
    } else if (cur.end < t.duration - 0.05) post({ cmd: "jump", at: cur.end, to: -1, id: flowJumpId });  // the flow ends before the audio does
    else post({ cmd: "jump" });
  }
  function flowRelocate(s, prefer) { s = s || song(); if (!s) return; state.flowIndex = flowIndexFor(s, state.pos, prefer); armFlow(s); renderFlow(); }
  function setFlowOn(on) {
    var s = song(); if (!s) return; var t = data(s);
    if (on && !(t.flow && t.flow.length)) t.flow = sectionsOf(s).map(function (x) { return x.sec.id; });
    t.flowOn = !!on; PP.persistSoon(); flowRelocate(s, state.flowIndex); PP.setStatus(on ? "Following the flow" : "Flow off - playing the song straight through"); render(); sendDisplay();
  }
  function queueSection(index) {  // play this section after the current one
    var s = song(); if (!s) return; var t = data(s), secs = sectionsOf(s); if (index < 0 || index >= secs.length) return;
    if (!flowActive(s)) { t.flow = secs.map(function (x) { return x.sec.id; }); t.flowOn = true; state.flowIndex = flowIndexFor(s, state.pos, 0); }
    var at = clamp((state.flowIndex || 0) + 1, 0, t.flow.length);
    t.flow.splice(at, 0, secs[index].sec.id); PP.persistSoon(); armFlow(s); renderFlow(); PP.setStatus("Next: " + secs[index].sec.name); sendDisplay();
  }
  function flowRepeat() { var s = song(); if (!s) return; var x = sectionAt(s, Math.max(0, state.pos)); if (x) queueSection(x.index); }
  function flowSkip() {
    var s = song(); if (!s) return; var t = data(s);
    if (!flowActive(s)) { var x = sectionAt(s, Math.max(0, state.pos)), secs = sectionsOf(s); if (!x || x.index + 2 >= secs.length) return; t.flow = secs.map(function (q) { return q.sec.id; }); t.flowOn = true; state.flowIndex = x.index; }
    var i = (state.flowIndex || 0) + 1; if (i >= t.flow.length) { PP.setStatus("Nothing after this section"); return; }
    var list = flowEntries(s), gone = list[i]; t.flow.splice(i, 1); PP.persistSoon(); armFlow(s); renderFlow(); PP.setStatus("Skipping " + (gone ? gone.sec.name : "the next section")); sendDisplay();
  }
  function flowReset() { var s = song(); if (!s) return; var t = data(s); t.flow = sectionsOf(s).map(function (x) { return x.sec.id; }); PP.persistSoon(); flowRelocate(s, 0); renderFlow(); }
  function renderFlow() {
    var root = $("#trFlow"), s = song(); if (!root) return;
    var t = s && data(s), list = s ? flowEntries(s) : [], on = flowActive(s), cur = state.flowIndex || 0;
    if (!s || !sectionsOf(s).length) { root.innerHTML = ""; root.classList.add("hidden"); return; }
    root.classList.remove("hidden");
    root.innerHTML = '<button class="fl-toggle' + (on ? " on" : "") + '" data-fl="toggle" title="Follow the flow (the arrangement) instead of playing straight through"><small>FLOW</small><b>' + (on ? "ON" : "OFF") + "</b></button>" +
      '<div class="fl-list">' + (on ? list.map(function (x, i) { return '<span class="fl-chip' + (i === cur ? " current" : i < cur ? " past" : "") + '" data-fl-i="' + i + '" title="' + esc(x.sec.name) + ' · bar ' + x.sec.bar + '">' + esc(x.sec.name) + "</span>"; }).join('<span class="fl-arrow">›</span>') : '<span class="muted">Playing the song straight through. Tap FLOW to follow the arrangement; hold a section to play it next.</span>') + "</div>" +
      '<div class="fl-btns"><button data-fl="repeat" title="Play the current section once more"><small>SECTION</small><b>⟲ again</b></button><button data-fl="skip" title="Leave out the next section"><small>NEXT</small><b>⤼ skip</b></button><button data-fl="queue" class="' + (queueArmed ? "on" : "") + '" title="Then tap the section that should play next"><small>PLAY</small><b>next…</b></button></div>';
  }
  var queueArmed = false;

  function pushAll(s) {
    if (!node || !s) return;
    var t = data(s), g = grid(s);
    armFlow(s);
    post({ cmd: "beats", times: Float64Array.from(g.times.map(function (x) { return x * engine.ctx.sampleRate; })), downbeats: Uint8Array.from(g.down) });
    post({ cmd: "click", enabled: !!t.click.on && !!project().tracksMode, level: Math.pow(clamp(t.click.level, 0, 100) / 100, 1.3), sub: t.click.sub || 1, sound: t.click.sound || "wood", stems: t.click.stems !== false });
    post({ cmd: "set", speed: t.tempoPercent / 100, pitch: Math.pow(2, t.keyShift / 12), musicLevel: 1, out: outLevel, cueLevel: Math.pow(clamp(t.cues.level, 0, 100) / 100, 1.2) });
    pushCues(s); pushEvents(s);
  }
  var DRUMS = ["kick", "snare", "hat", "crash"], DRUM_NOTES = { kick: 36, snare: 38, hat: 42, crash: 49 };   // (General MIDI drum notes; each is a setting)
  function drumNote(mo, k) { var n = mo.drumNotes && mo.drumNotes[k]; return clamp(n == null || n === "" ? DRUM_NOTES[k] : Number(n), 0, 59); }
  function pushEvents(s) {
    var t = data(s), list = [], mo = project().midiOut || {};
    if (mo.lightsHits !== false) t.hits.forEach(function (h, i) { list.push({ time: h, id: "hit:" + i }); });
    if (mo.lightsDrums !== false && t.drumHits) DRUMS.forEach(function (k) { if (mo.drumParts && mo.drumParts[k] === false) return; (t.drumHits[k] || []).forEach(function (h, i) { list.push({ time: h, id: "dh:" + k + ":" + i }); }); });
    sectionsOf(s).forEach(function (x) { list.push({ time: x.start, id: "sec:" + x.index }); });
    post({ cmd: "events", list: list });
  }
  function cueIdFor(sec) {
    if (!sec || sec.cue === "none") return null;
    if (sec.cue && sec.cue !== "auto") return sec.cue;
    var id = slug(sec.name); if (cueSet[id]) return id;
    var base = id.split("-")[0]; if (cueSet[base]) return base;
    return "say:" + sec.name.replace(/\(.*?\)/g, "").trim();
  }
  async function pushCues(s) {
    var t = data(s), target = node; if (!node) return;
    var g = grid(s), leadBars = clamp(t.cues.leadBars == null ? 1 : t.cues.leadBars, 0, 4), list = [];
    if (t.cues.on && project().tracksMode) {
      var secs = sectionsOf(s);
      for (var i = 0; i < secs.length; i++) {
        var id = cueIdFor(secs[i].sec); if (!id) continue;
        var buf = await cueBuffer(id); if (!buf) continue;
        var at = secs[i].start - leadBars * barLength(g, Math.max(0, timeToBar(s, secs[i].start).bar - 1 - leadBars)); if (at < 0.05 && i === 0) continue;
        list.push({ time: Math.max(0, at), id: id, level: 1 });
      }
    }
    if (target) target.port.postMessage({ cmd: "cues", list: list });
  }
  // cue voices: the Pi serves pre-rendered words (/cues/*.wav) and renders new ones (/tts?text=)
  var cueSet = {}, cueBuffers = {}, cueListLoaded = false, cueCustom = [];
  async function loadCueList(force) {
    if (cueListLoaded && !force) return; cueListLoaded = true;
    try { var r = await fetch(MEDIA + "/cues", { cache: "no-store" }); if (r.ok) { var j = await r.json(); (j.cues || []).forEach(function (c) { cueSet[c] = true; }); cueCustom = j.custom || []; } } catch (_) { }
  }
  // ---- record cue words with a mic (saved on the Pi as /data/pad-pedal/cues/<word>.wav, used instead of the built-in word)
  var rec = { stream: null, recorder: null, chunks: [], buffer: null, source: null };
  function cueWordId(text) { return slug(String(text || "").replace(/\(.*?\)/g, "")); }
  function drawCueWave(buf) {
    var cv = $("#cueWave"); if (!cv) return; var ctx = cv.getContext("2d"), W = cv.width, H = cv.height; ctx.clearRect(0, 0, W, H); if (!buf) return;
    var d = buf.getChannelData(0), per = Math.max(1, Math.floor(d.length / W)); ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#e2c27e";
    for (var x = 0; x < W; x++) { var m = 0; for (var i = x * per; i < Math.min(d.length, (x + 1) * per); i += 2) { var v = Math.abs(d[i]); if (v > m) m = v; } ctx.fillRect(x, H / 2 - m * H / 2, 1, Math.max(1, m * H)); }
  }
  function trimSilence(buf) {  // cut leading / trailing silence, keep 60 ms of air, normalise
    var d = buf.getChannelData(0), n = d.length, thr = 0.02, a = 0, b = n - 1; while (a < n && Math.abs(d[a]) < thr) a++; while (b > a && Math.abs(d[b]) < thr) b--;
    a = Math.max(0, a - Math.round(buf.sampleRate * 0.06)); b = Math.min(n - 1, b + Math.round(buf.sampleRate * 0.12)); if (b - a < buf.sampleRate * 0.1) return null;
    var out = new Float32Array(b - a), peak = 0; for (var i = a; i < b; i++) { out[i - a] = d[i]; if (Math.abs(d[i]) > peak) peak = Math.abs(d[i]); }
    if (peak > 0) for (var k = 0; k < out.length; k++) out[k] *= .9 / peak;
    var o = engine.ctx.createBuffer(1, out.length, buf.sampleRate); o.getChannelData(0).set(out); return o;
  }
  function wavOf(buf) {  // 16-bit mono WAV
    var d = buf.getChannelData(0), n = d.length, ab = new ArrayBuffer(44 + n * 2), v = new DataView(ab), w = function (o, str) { for (var i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
    w(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, buf.sampleRate, true); v.setUint32(28, buf.sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, n * 2, true);
    for (var i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.max(-32768, Math.min(32767, Math.round(d[i] * 32767))), true);
    return new Blob([ab], { type: "audio/wav" });
  }
  function renderCueDialog() {
    var list = $("#cueCustomList"); if (!list) return;
    list.innerHTML = cueCustom.length ? cueCustom.map(function (id) { return '<span class="cue-item">' + esc(id.replace(/-/g, " ")) + '<button data-cue-play="' + esc(id) + '" title="Play">▶</button><button data-cue-del="' + esc(id) + '" title="Remove (the built-in word comes back)">✕</button></span>'; }).join("") : '<p class="muted">None yet.</p>';
    $("#cueWords").innerHTML = Object.keys(cueSet).filter(function (k) { return !/^\d+$/.test(k); }).sort().map(function (k) { return '<option value="' + esc(k.replace(/-/g, " ")) + '">'; }).join("");
  }
  async function openCueDialog() {
    await loadCueList(true); renderCueDialog(); rec.buffer = null; drawCueWave(null);
    $("#cuePlayBtn").disabled = true; $("#cueSaveBtn").disabled = true; $("#cueRecStatus").textContent = driverOn() ? "Type the word, then press Record and say it." : "Recording works on the Central Pedal itself (the words are kept on its card).";
    $("#cueDialog").showModal();
  }
  async function cueRecordToggle() {
    var btn = $("#cueRecBtn");
    if (rec.recorder && rec.recorder.state === "recording") { rec.recorder.stop(); return; }
    try {
      await engine.ensure();
      rec.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: true } });
    } catch (e) { $("#cueRecStatus").textContent = "No microphone: " + (e && e.message); return; }
    rec.chunks = []; rec.recorder = new MediaRecorder(rec.stream);
    rec.recorder.ondataavailable = function (e) { if (e.data && e.data.size) rec.chunks.push(e.data); };
    rec.recorder.onstop = async function () {
      rec.stream.getTracks().forEach(function (t) { t.stop(); }); btn.classList.remove("recording"); btn.textContent = "● Record";
      try {
        var raw = await engine.ctx.decodeAudioData(await new Blob(rec.chunks).arrayBuffer()), m = mono(raw), tmp = engine.ctx.createBuffer(1, m.length, raw.sampleRate); tmp.getChannelData(0).set(m);
        rec.buffer = trimSilence(tmp); drawCueWave(rec.buffer);
        if (!rec.buffer) { $("#cueRecStatus").textContent = "Nothing heard - try again, closer to the mic."; return; }
        $("#cuePlayBtn").disabled = false; $("#cueSaveBtn").disabled = !cueWordId($("#cueWord").value); $("#cueRecStatus").textContent = (rec.buffer.duration).toFixed(2) + " s recorded. Play it, then Save.";
      } catch (e) { $("#cueRecStatus").textContent = "Could not read the recording: " + e.message; }
    };
    rec.recorder.start(); btn.classList.add("recording"); btn.textContent = "■ Stop"; $("#cueRecStatus").textContent = "Recording… say the word, then press Stop.";
    setTimeout(function () { if (rec.recorder && rec.recorder.state === "recording") rec.recorder.stop(); }, 4000);
  }
  function cuePlayBuffer(buf) { if (!buf) return; var src = engine.ctx.createBufferSource(); src.buffer = buf; src.connect(engine.clickBus); src.start(); }
  async function cueSave() {
    var id = cueWordId($("#cueWord").value); if (!id || !rec.buffer) return;
    try {
      var r = await fetch(MEDIA + "/cues/record?id=" + encodeURIComponent(id), { method: "PUT", body: wavOf(rec.buffer) }), j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || r.status);
      cueSet[id] = true; cueCustom = j.custom || []; delete cueBuffers[id]; renderCueDialog(); $("#cueRecStatus").textContent = "Saved \"" + id.replace(/-/g, " ") + "\" - it is used from now on."; PP.setStatus("Cue word saved: " + id); if (song()) pushCues(song());
    } catch (e) { $("#cueRecStatus").textContent = "Could not save: " + e.message; }
  }
  async function cueDelete(id) {
    try { var r = await fetch(MEDIA + "/cues/remove", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: id }) }), j = await r.json(); cueCustom = j.custom || []; delete cueBuffers[id]; renderCueDialog(); if (song()) pushCues(song()); } catch (_) { }
  }
  async function cueBuffer(id) {
    if (cueBuffers[id]) return cueBuffers[id];
    if (!driverOn() && !cueListLoaded) return null;
    var url = id.indexOf("say:") === 0 ? MEDIA + "/tts?text=" + encodeURIComponent(id.slice(4)) : MEDIA + "/cues/" + id + ".wav";
    try {
      var r = await fetch(url, { cache: cueCustom.indexOf(id) >= 0 ? "no-cache" : "default" }); if (!r.ok) return null;
      var buf = await engine.ctx.decodeAudioData(await r.arrayBuffer()), m = mono(buf), peak = 0;
      for (var i = 0; i < m.length; i++) if (Math.abs(m[i]) > peak) peak = Math.abs(m[i]);
      if (peak > 0) for (var k = 0; k < m.length; k++) m[k] *= .8 / peak;
      // resample to the context rate if needed
      if (buf.sampleRate !== engine.ctx.sampleRate) { var ratio = buf.sampleRate / engine.ctx.sampleRate, n = Math.floor(m.length / ratio), out = new Float32Array(n); for (var j = 0; j < n; j++) { var p = j * ratio, a = Math.floor(p), f = p - a; out[j] = m[a] + ((m[a + 1] || 0) - m[a]) * f; } m = out; }
      cueBuffers[id] = m;
      var bufs = {}; bufs[id] = m; postAll({ cmd: "cueBuffers", buffers: bufs });
      return m;
    } catch (_) { return null; }
  }
  async function preloadCountVoice() { for (var i = 1; i <= 8; i++) await cueBuffer(String(i)); }
  function say(id) { cueBuffer(id).then(function (b) { if (b) post({ cmd: "sayNow", id: id }); else if (window.speechSynthesis && !driverOn()) { try { speechSynthesis.speak(new SpeechSynthesisUtterance(id.replace(/^say:/, "").replace(/-/g, " "))); } catch (_) { } } }); }

  function onWorklet(m) {
    if (m.type === "pos") {
      if (m.meters && m.ids) onMeters(m.ids, m.meters);
      state.pos = m.pos; state.playing = m.playing; state.countIn = m.countIn || 0;
      if (m.started) { state.countIn = 0; onTransport(); }
      onPosition();
    } else if (m.type === "countIn") { state.countIn = m.remaining; renderTransport(); }
    else if (m.type === "looped") { state.pos = m.pos; onPosition(true); }
    else if (m.type === "jumped") { state.pos = m.pos; if (m.id === flowJumpId) { state.flowIndex = (state.flowIndex || 0) + 1; armFlow(song()); } onPosition(true); renderFlow(); }
    else if (m.type === "ended") { state.playing = false; state.pos = m.pos; state.ended = true; onTransport(); onPosition(); songEnded(); }
    else if (m.type === "event") { onEvent(m.id, m.inMs); }
  }

  // ------------------------------------------------------------- transport
  function isActive() { return !!(project().tracksMode && song() && data(song()).stems.length); }
  async function play(opts) {
    opts = opts || {}; var s = song(); if (!s || !data(s).stems.length) { PP.setStatus("This song has no tracks yet. Open the song editor to add stems."); return; }
    if (!project().tracksMode) setTracksMode(true);
    await loadSong(s); await engine.ensure(); await loadCueList();
    var t = data(s), countBeats = opts.countIn === false ? 0 : (t.countIn || 0) * (grid(s).bpb || 4);
    if (countBeats && t.cues.countVoice) await preloadCountVoice();
    state.ended = false;
    post({ cmd: "play", countIn: countBeats, voice: !!t.cues.countVoice && !!t.cues.on });
    state.playing = true; onTransport(); renderTransport();
  }
  function pause() { post({ cmd: "pause" }); state.playing = false; onTransport(); renderTransport(); }
  function stop(toStart) { post({ cmd: "stop", to: toStart ? 0 : state.pos }); state.playing = false; state.countIn = 0; if (toStart) state.pos = 0; onTransport(); onPosition(); renderTransport(); }
  function togglePlay() { if (state.playing) pause(); else play(); }
  function seek(tm) { var s = song(); if (!s) return; state.pos = clamp(tm, 0, data(s).duration || 0); post({ cmd: "seek", time: state.pos }); if (flowActive(s)) flowRelocate(s, state.flowIndex); onPosition(true); }
  function goSection(index, opts) {
    var s = song(); if (!s) return; var secs = sectionsOf(s); if (!secs.length) return;
    index = clamp(index, 0, secs.length - 1); var target = secs[index], t = data(s);
    if (state.loop >= 0 && state.loop !== index) setLoop(-1);
    var mode = (opts && opts.jump) || t.jump;
    if (state.playing && mode === "bar" && !(opts && opts.immediate)) {
      // musical jump: land on the section when the current bar ends
      var g = grid(s), bar = timeToBar(s, state.pos), nextBar = barStart(s, bar.bar + 1), wait = Math.max(0, nextBar - state.pos) / (t.tempoPercent / 100);
      if (wait > 0.03 && wait < barLength(g, bar.bar - 1) * 1.05) { pendingJump = { at: performance.now() + wait * 1000, time: target.start }; PP.setStatus("Next: " + target.sec.name + " (at the bar)"); renderSections(); return; }
    }
    seek(target.start); PP.setStatus("▶ " + target.sec.name);
  }
  var pendingJump = null;
  setInterval(function () { if (pendingJump && performance.now() >= pendingJump.at) { var j = pendingJump; pendingJump = null; seek(j.time); } }, 10);
  function currentSectionIndex() { var s = song(); if (!s) return -1; var x = sectionAt(s, Math.max(0, state.pos)); return x ? x.index : -1; }
  function nextSection() { var i = currentSectionIndex(); goSection(i + 1); }
  function prevSection() { var s = song(); if (!s) return; var x = sectionAt(s, Math.max(0, state.pos)); if (!x) { goSection(0); return; } goSection(state.pos - x.start > 2 ? x.index : x.index - 1, { immediate: true }); }
  function restartSection() { var x = song() && sectionAt(song(), Math.max(0, state.pos)); if (x) { seek(x.start); PP.setStatus("↺ " + x.sec.name); } else seek(0); }
  function startOver() { stop(true); PP.setStatus("Back to the start"); }
  function setLoop(index) {
    var s = song(); if (!s) return; var secs = sectionsOf(s);
    if (index < 0 || index >= secs.length) { state.loop = -1; post({ cmd: "loop" }); }
    else { state.loop = index; post({ cmd: "loop", start: secs[index].start, end: secs[index].end }); }
    renderSections(); renderTransport(); sendDisplay();
  }
  // ---- rehearsal: loop any A–B part (snapped to the beat), slow down / speed up without changing the pitch
  var ab = { a: null, b: null, on: false };
  function snapBeat(s, tm) { var g = grid(s); if (!g || !g.beats || !g.beats.length) return tm; var best = tm, d = 1e9; for (var i = 0; i < g.beats.length; i++) { var dd = Math.abs(g.beats[i] - tm); if (dd < d) { d = dd; best = g.beats[i]; } if (g.beats[i] > tm + 2) break; } return best; }
  function abApply() { if (ab.on && ab.a != null && ab.b != null && ab.b > ab.a + .2) { state.loop = -2; post({ cmd: "loop", start: ab.a, end: ab.b }); } else if (state.loop === -2) { state.loop = -1; post({ cmd: "loop" }); } renderRehearse(); drawTimeline(); }
  function abSet(which) { var s = song(); if (!s) return; var tm = snapBeat(s, state.pos); ab[which] = tm; if (ab.a != null && ab.b != null && ab.b < ab.a) { var x = ab.a; ab.a = ab.b; ab.b = x; } if (which === "b" && ab.a != null) ab.on = true; PP.setStatus("Loop point " + which.toUpperCase() + " at " + fmtTime(tm)); abApply(); }
  function abToggle() { if (ab.a == null || ab.b == null) { PP.setStatus("Set A and B first (at the start and the end of the part to practise)"); return; } ab.on = !ab.on; if (ab.on && (state.pos < ab.a || state.pos > ab.b)) seek(ab.a); abApply(); }
  function abClear() { ab = { a: null, b: null, on: false }; abApply(); }
  function nudgeTempo(d) { var s = song(); if (!s) return; setTempoPercent((data(s).tempoPercent || 100) + d); renderRehearse(); }
  function renderRehearse() {
    var root = $("#trRehearse"), s = song(); if (!root) return; if (!s || !data(s).stems.length) { root.innerHTML = ""; return; }
    var t = data(s), pct = t.tempoPercent || 100;
    root.innerHTML = '<span class="muted">Rehearse</span>' +
      '<button class="pf-btn" data-rh="secPrev"><small>SECTION</small><b>◀ BACK</b></button><button class="pf-btn' + (state.loop >= 0 ? " on" : "") + '" data-rh="secLoop"><small>LOOP</small><b>SECTION</b></button><button class="pf-btn" data-rh="secNext"><small>SECTION</small><b>NEXT ▶</b></button>' +
      '<span class="rh-sep"></span><button class="pf-btn' + (ab.a != null ? " set" : "") + '" data-rh="a"><small>LOOP FROM</small><b>A ' + (ab.a != null ? fmt(ab.a) : "") + '</b></button><button class="pf-btn' + (ab.b != null ? " set" : "") + '" data-rh="b"><small>LOOP TO</small><b>B ' + (ab.b != null ? fmt(ab.b) : "") + '</b></button><button class="pf-btn' + (ab.on ? " on" : "") + '" data-rh="ab"><small>A–B</small><b>' + (ab.on ? "LOOPING" : "LOOP") + '</b></button><button data-rh="abClear" title="Clear A and B">✕</button>' +
      '<span class="rh-sep"></span><span class="muted">Speed (same pitch)</span>' + [60, 75, 90, 100].map(function (v) { return '<button class="rh-speed' + (pct === v ? " on" : "") + '" data-rh-speed="' + v + '">' + v + '%</button>'; }).join("") + '<button data-rh="slower">−5%</button><b class="rh-pct">' + pct + '%</b><button data-rh="faster">+5%</button>';
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-rh],[data-rh-speed]"); if (!b) return;
    if (b.dataset.rhSpeed) { setTempoPercent(Number(b.dataset.rhSpeed)); renderRehearse(); return; }
    var k = b.dataset.rh;
    if (k === "secPrev") prevSection(); else if (k === "secNext") nextSection(); else if (k === "secLoop") toggleLoop();
    else if (k === "a" || k === "b") abSet(k); else if (k === "ab") abToggle(); else if (k === "abClear") abClear();
    else if (k === "slower") nudgeTempo(-5); else if (k === "faster") nudgeTempo(5);
    renderRehearse();
  });
  function toggleLoop() { var i = currentSectionIndex(); if (state.loop === i || i < 0) { setLoop(-1); PP.setStatus("Repeat off"); } else { setLoop(i); PP.setStatus("Repeating " + sectionsOf(song())[i].sec.name); } }
  function shiftKey(delta) {
    var s = song(); if (!s) { PP.changeKey(delta); return; }
    var t = data(s), n = ((PP.noteIndex(s.key) + delta) % 12 + 12) % 12; s.key = KEYS[n];
    if (t.originalKey) { var diff = ((n - PP.noteIndex(t.originalKey)) % 12 + 12) % 12; if (diff > 6) diff -= 12; t.keyShift = diff; } else t.keyShift = ((t.keyShift + delta + 6) % 12 + 12) % 12 - 6;
    post({ cmd: "set", pitch: Math.pow(2, t.keyShift / 12) });
    PP.persistSoon(); PP.renderPads();
    var playing = engine.playingIndexes(); if (playing.length) engine.playPad(playing[0]);
    PP.setStatus("Key " + keyName(s.key) + (t.keyShift ? " (tracks " + (t.keyShift > 0 ? "+" : "") + t.keyShift + ")" : "")); render(); sendDisplay();
  }
  function setTempoPercent(pct) {
    var s = song(); if (!s) return; var t = data(s); t.tempoPercent = clamp(Math.round(pct), 50, 150);
    post({ cmd: "set", speed: t.tempoPercent / 100 });
    if (t.grid.bpm) { s.bpm = Math.round(t.grid.bpm * t.tempoPercent / 100 * 10) / 10; F.setTempo(s.bpm, "song"); }
    PP.persistSoon(); render(); sendDisplay();
  }
  function stepSongAndPlay(delta, gap) { F.stepSong(delta); setTimeout(function () { if (song() && data(song()).stems.length) play({ countIn: false }); }, 300 + (gap || 0) * 1000); }

  // ------------------------------------------------------------- what happens while playing
  // ---- the pads follow the tracks: start / stop with them, swell with the sections, the song's own pad
  var SWELL = [[/intro/i, 70], [/pre[- ]?chorus|build|lift/i, 80], [/chorus|refrain|hook/i, 100], [/bridge/i, 85], [/break|drop|quiet/i, 45], [/tag|vamp/i, 90], [/instrumental|interlude|solo|turn/i, 75], [/outro|ending|end/i, 55], [/verse/i, 62]];
  function follow(t) { var f = (t && t.padFollow) || {}; return { start: f.start !== false, stop: f.stop !== false, swell: f.swell !== false }; }
  function songPad(s) { return s && s.pad >= 0 && s.pad < PP.PAD_COUNT ? s.pad : PP.selected(); }
  function sectionSwell(sec) { if (sec.padLevel != null && sec.padLevel !== "" && sec.padLevel >= 0) return clamp(Number(sec.padLevel) / 100, 0, 1.2); for (var i = 0; i < SWELL.length; i++) if (SWELL[i][0].test(sec.name || "")) return SWELL[i][1] / 100; return .8; }
  var wasPlaying = false, swellNow = 1;
  function padsFollowTransport() {
    var s = song(), t = s && data(s); if (!t || !t.stems.length) { wasPlaying = state.playing; return; }
    var f = follow(t), seconds = clamp(t.transition.seconds || 3, .3, 20);
    if (state.playing && !wasPlaying && f.start && !engine.voices().length) {
      var pad = songPad(s), x = sectionAt(s, Math.max(0, state.pos)), lvl = f.swell && x ? sectionSwell(x.sec) : 1;
      PP.setSelectedPad(pad, false); engine.playPad(pad, null, { fade: seconds, level: lvl }); swellNow = lvl;
    } else if (!state.playing && wasPlaying && f.stop && !segue.running && !state.ended && engine.voices().length) engine.stop();
    wasPlaying = state.playing;
  }
  function padsFollowSection(x) {
    var s = song(), t = data(s), f = follow(t); if (!f.swell || x.sec.pad === -2) return;
    var lvl = sectionSwell(x.sec); if (Math.abs(lvl - swellNow) < .01) return; var prev = swellNow; swellNow = lvl;
    var secs = clamp(t.transition.seconds || 3, .3, 12);
    // every playing layer moves by the same amount, so a mix of layers (one pad quieter than another) keeps its balance
    engine.layerState().forEach(function (l) { engine.setLayerLevel(l.pad, prev > .01 ? clamp(l.level * lvl / prev, 0, 1.4) : lvl, secs); });
  }
  function onTransport() {
    padsFollowTransport();
    var s = song(), t = s && data(s), mo = project().midiOut || {};
    if (mo.clockOut !== false) send({ type: "midiClock", bpm: s ? s.bpm : project().tempo.bpm, running: state.playing });
    if (project().link && project().link.enabled) send({ type: "link", enabled: true, bpm: s ? s.bpm : project().tempo.bpm, playing: state.playing });
    renderTransport(); sendDisplay();
    if (window.PPActions) window.PPActions.sendLeds();
  }
  var lastSectionKey = null;
  function onPosition(jumped) {
    var s = song(); if (!s) return;
    var x = sectionAt(s, Math.max(0, state.pos)), idx = x ? x.index : -1;
    if (idx !== state.section || jumped) {
      var prev = state.section; state.section = idx; state.lyricsManual = null;
      if (flowActive(s) && !jumped) { var fl = flowEntries(s), ni = (state.flowIndex || 0) + 1; if (fl[ni] && fl[ni].index === idx && (!fl[state.flowIndex] || fl[state.flowIndex].index !== idx)) { state.flowIndex = ni; armFlow(s); renderFlow(); } }
      if (x && (state.playing || jumped)) sectionEntered(x, prev);
      renderSections();
    }
    renderPosition(); throttleDisplay(); watchSegue();
  }
  function sectionEntered(x, prevIndex) {
    var s = song(), t = data(s), sec = x.sec;
    if (window.PPScenes) window.PPScenes.onSection(x);
    if (sec.slide != null && sec.slide !== "" && prevIndex !== x.index) send({ type: "propresenter", action: "section", slide: sec.slide, presentation: s.presentation || "", song: s.name, section: sec.name });
    padsFollowSection(x);
    if (sec.pad === -2) { if (engine.voices().length) engine.stop(); }
    else if (sec.pad >= 0) {
      var playing = engine.playingIndexes(), type = sec.transition === "inherit" ? t.transition.type : sec.transition, seconds = sec.transitionSeconds != null && sec.transition !== "inherit" ? sec.transitionSeconds : t.transition.seconds;
      if (playing.indexOf(sec.pad) < 0) {
        var fade = type === "swell" ? clamp(seconds, .3, 20) : type === "cut" ? .05 : 0;
        PP.setSelectedPad(sec.pad, false); engine.playPad(sec.pad, null, { fade: fade });
      }
    }
    var mo = project().midiOut || {};
    if (prevIndex !== x.index && (mo.noteOnSection !== false || mo.lightsSections)) {
      var msgs = [];
      if (mo.noteOnSection !== false) { var ch = clamp((mo.generalChannel || 2) - 1, 0, 15); msgs.push({ data: [0x90 | ch, 60 + x.index, 100], at: 0 }, { data: [0x80 | ch, 60 + x.index, 0], at: 120 }); }
      if (mo.lightsSections) { var lch = clamp((mo.lightsChannel || 1) - 1, 0, 15); msgs.push({ data: [0x90 | lch, 60 + x.index, 100], at: 0 }, { data: [0x80 | lch, 60 + x.index, 0], at: 120 }); }
      send({ type: "midiOut", messages: msgs });
    }
  }
  function onEvent(id, inMs) {
    var mo = project().midiOut || {}, at = Math.max(0, inMs - (mo.offsetMs || 0));
    if (id.indexOf("hit:") === 0 && mo.lightsHits !== false) {
      var ch = clamp((mo.lightsChannel || 1) - 1, 0, 15), note = clamp(mo.lightsNote == null ? 48 : mo.lightsNote, 0, 127);
      send({ type: "midiOut", messages: [{ data: [0x90 | ch, note, 127], at: at }, { data: [0x80 | ch, note, 0], at: at + 100 }] });
      setTimeout(function () { flashHit(); }, at);
    } else if (id.indexOf("dh:") === 0 && mo.lightsDrums !== false) {   // a drum hit (kick, snare, hi-hat, crash) as its own note on the lights channel
      var part = id.split(":")[1], lc = clamp((mo.lightsChannel || 1) - 1, 0, 15), dn = drumNote(mo, part);
      send({ type: "midiOut", messages: [{ data: [0x90 | lc, dn, part === "crash" ? 127 : 110], at: at }, { data: [0x80 | lc, dn, 0], at: at + 60 }] });
      if (part === "crash") setTimeout(function () { flashHit(); }, at);
    }
  }
  function flashHit() { var el = $("#trHitLight"); if (!el) return; el.classList.add("on"); setTimeout(function () { el.classList.remove("on"); }, 120); }
  function setTracksMode(on) {
    var p = project(); p.tracksMode = !!on; PP.persistSoon();
    document.body.classList.toggle("tracks-mode", p.tracksMode);
    if (!p.tracksMode && state.playing) pause();
    if (song()) pushAll(song());
    if (window.PPActions) window.PPActions.modeChanged();
    render(); sendDisplay();
    PP.setStatus(p.tracksMode ? "Tracks ON: buttons and knobs use the Tracks layout, pads follow the song" : "Tracks OFF: pads use the setlist song key");
  }

  // ------------------------------------------------------------- songs: load / import / uploads
  F.onSong(function (s) {
    pendingJump = null;
    if (segue.running && s && deck && deck.songId === s.id) {
      // segue: the new song is already playing on the other deck
      segue.running = false; loadedSongId = s.id;
      state.playing = true; state.pos = 0; state.countIn = 0; state.loop = -1; state.section = -1; state.ended = false; state.flowIndex = 0;
      var mo0 = project().midiOut || {};
      if (mo0.pcOnSong !== false) { var ch0 = clamp((mo0.generalChannel || 2) - 1, 0, 15), prog0 = s.midiProgram != null ? s.midiProgram : project().songIndex; if (prog0 >= 0) send({ type: "midiOut", messages: [{ data: [0xC0 | ch0, clamp(prog0, 0, 127)], at: 0 }] }); }
      pushAll(s); applyDirectOuts(); onTransport(); render(); sendDisplay();
      PP.setStatus("▶ " + s.name + " (segue)");
      return;
    }
    if (state.playing) { post({ cmd: "pause" }); state.playing = false; }
    state.pos = 0; state.section = -1; state.loop = -1;
    var t = s && data(s), mo = project().midiOut || {};
    if (s && mo.pcOnSong !== false) { var ch = clamp((mo.generalChannel || 2) - 1, 0, 15), prog = s.midiProgram != null ? s.midiProgram : project().songIndex; if (prog >= 0) send({ type: "midiOut", messages: [{ data: [0xC0 | ch, clamp(prog, 0, 127)], at: 0 }] }); }
    if (s && t.stems.length && project().tracksMode) loadSong(s).catch(function (e) { PP.setStatus("Could not load the tracks: " + e.message); });
    else if (!s || !t.stems.length) { loadedSongId = null; post({ cmd: "clear" }); }
    render(); sendDisplay();
  });
  function findSongByName(name) {
    var want = slug(name); if (!want) return null;
    var best = null, score = 0;
    project().songs.forEach(function (s) { var sl = slug(s.name), sc = sl === want ? 3 : (sl.indexOf(want) >= 0 || want.indexOf(sl) >= 0) && sl.length > 3 ? 2 : 0; if (sc > score) { score = sc; best = s; } });
    return best;
  }
  function newSong(name) { var p = project(); var s = { id: PP.id(), name: name || "Song " + (p.songs.length + 1), key: "C", bpm: 72, pad: -1, notes: "" }; data(s); p.songs.push(s); PP.persistSoon(); return s; }
  // Combining stems (a big song on a Pi with little memory): the stems of one kind - drums, bass, keys, guitars,
  // vocals, the rest - are summed into one track each; click and guide stay on their own (they go to the in-ears).
  var GROUP_NAMES = { drums: "Drums (combined)", bass: "Bass (combined)", keys: "Keys & synths (combined)", guitar: "Guitars (combined)", vocals: "Vocals (combined)", music: "Other (combined)" };
  async function decodeSum(list, progress) {
    var acc = null, rate = 0;
    for (var i = 0; i < list.length; i++) {
      if (progress) progress("Decoding " + list[i].name.replace(/\.[^.]+$/, "") + "…");
      var b = await decodeFile(list[i]), n = b.length; rate = b.sampleRate;
      if (!acc) acc = { L: new Float32Array(n), R: new Float32Array(n), n: n };
      if (n > acc.n) { var L2 = new Float32Array(n), R2 = new Float32Array(n); L2.set(acc.L); R2.set(acc.R); acc = { L: L2, R: R2, n: n }; }
      var l = b.getChannelData(0), r = b.numberOfChannels > 1 ? b.getChannelData(1) : l;
      for (var k = 0; k < n; k++) { acc.L[k] += l[k]; acc.R[k] += r[k]; }
    }
    var out = engine.ctx.createBuffer(2, acc.n, rate); out.copyToChannel(acc.L, 0); out.copyToChannel(acc.R, 1);
    return out;
  }
  async function addCombinedStem(s, role, list, progress) {
    var t = data(s), buffer = await decodeSum(list, progress), pcm = toPcm(buffer), id = PP.id();
    await putStem(id, pcm);
    var rec = { id: id, name: GROUP_NAMES[role] || "Combined", role: role, gain: 1, pan: 0, mute: false, solo: false, bus: "music", length: pcm.length, overview: overview(buffer, 960),
      parts: list.map(function (f) { return f.name.replace(/\.[^.]+$/, ""); }), files: list.map(function (f) { return f._mediaPath || null; }).filter(Boolean) };
    t.stems.push(rec);
    t.duration = Math.max(t.duration, buffer.duration);
    refreshOverview(t); PP.persistSoon();
    return { stem: rec, buffer: buffer };
  }
  async function importFilesIntoSong(s, files, opts) {
    opts = opts || {}; var buffers = [], ok = 0;
    if (opts.combine) {   // one track per kind (click and guide on their own)
      var groups = {}, singles = [];
      files.forEach(function (f) { var r = f._role || guessRole(f.name.replace(/\.[^.]+$/, "")); if (r === "click" || r === "guide") singles.push(f); else (groups[r] = groups[r] || []).push(f); });
      Object.keys(groups).forEach(function (r) { if (groups[r].length === 1) singles.push(groups[r][0]); });
      var gn = Object.keys(groups).filter(function (r) { return groups[r].length > 1; });
      for (var g = 0; g < gn.length; g++) {
        try { buffers.push(await addCombinedStem(s, gn[g], groups[gn[g]], function (m) { PP.setStatus(m + " (group " + (g + 1) + "/" + gn.length + ")"); })); ok++; }
        catch (error) { console.warn(error); PP.setStatus("Could not combine the " + gn[g] + " tracks"); }
      }
      files = singles;
    }
    for (var i = 0; i < files.length; i++) {
      try { var r = await addStemFile(s, files[i], function (m) { PP.setStatus(m + " (" + (i + 1) + "/" + files.length + ")"); }); buffers.push(r); ok++; }
      catch (error) { PP.setStatus("Could not decode " + files[i].name); }
    }
    if (ok && opts.analyze !== false) { try { await analyzeSong(s, buffers, PP.setStatus, { sections: opts.sections }); } catch (error) { console.warn(error); } }
    buffers.length = 0;
    if (song() && song().id === s.id) { loadedSongId = null; if (project().tracksMode) await loadSong(s); }
    var t = data(s); PP.setStatus(ok + " track" + (ok === 1 ? "" : "s") + " added to " + s.name + (t.analysis ? " · " + Math.round(t.grid.bpm) + " BPM · " + keyName(t.originalKey) + (t.originalMode === "minor" ? "m" : "") : ""));
    PP.persistNow(); render(); sendDisplay();
  }
  async function fileFromMedia(path) { var blob = await (await fetch(MEDIA + "/file?path=" + encodeURIComponent(path))).blob(); var f = new File([blob], path.split("/").pop(), { type: blob.type || "audio/*" }); f._mediaPath = path; return f; }
  // the original file goes to /data/pad-pedal/library on the driver (a copy when it came from a USB stick
  // or an upload, the bytes when it came from a file picker), so backups are complete and stems survive a new card
  function keepInLibrary(s, file, rec) {
    if (!driverOn()) return;
    var p = file._mediaPath
      ? fetch(MEDIA + "/library/copy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ song: s.id, path: file._mediaPath }) })
      : fetch(MEDIA + "/library?song=" + encodeURIComponent(s.id) + "&name=" + encodeURIComponent(file.name), { method: "PUT", body: file });
    p.then(function (r) { return r.json(); }).then(function (j) { if (j && j.path) { rec.file = j.path; PP.persistSoon(); } }).catch(function (e) { console.warn("library", e); });
  }
  function dropFromLibrary(st) { if (st && st.file && driverOn()) fetch(MEDIA + "/library/remove", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: st.file }) }).catch(function () {}); }
  F.on("uploaded", async function (m) {
    if (m.kind === "charts") { if (m.chart) await chartUploaded(m.chart, m.song); return; }
    if (m.kind === "sounds") { PP.setStatus("Sound uploaded: " + m.name + " (find it in Import Sound → Uploaded over Wi-Fi)"); return; }
    var s = (m.song && (findSongByName(m.song) || newSong(m.song))) || song() || newSong();
    PP.setStatus("Upload received: " + m.name + " → " + s.name);
    try { await importFilesIntoSong(s, [await fileFromMedia(m.path)], { analyze: true }); } catch (error) { PP.setStatus("Could not import " + m.name + ": " + error.message); }
  });

  // ------------------------------------------------------------- charts & lyrics
  var charts = [];
  async function refreshCharts() { try { var r = await fetch(MEDIA + "/charts", { cache: "no-store" }); if (r.ok) charts = (await r.json()).charts || []; } catch (_) { charts = []; } }
  async function chartInfo(id) { try { var r = await fetch(MEDIA + "/charts/" + id + "/chart.json", { cache: "no-store" }); return r.ok ? await r.json() : null; } catch (_) { return null; } }
  async function chartUploaded(chart, songName) {
    await refreshCharts();
    var s = (songName && (findSongByName(songName) || newSong(songName))) || findSongByName(chart.name) || song() || newSong(chart.name);
    await applyChart(s, chart);
    PP.setStatus("Chart \"" + chart.name + "\" → " + s.name);
  }
  async function applyChart(s, chart) {
    var t = data(s); s.chart = { id: chart.id, name: chart.name, pageCount: chart.pageCount || 1 };
    if (chart.key && !t.originalKey && t.keyShift === 0) { s.key = chart.key; t.chartKey = chart.key; }
    if (chart.bpm && !t.analysis) { s.bpm = chart.bpm; t.grid.bpm = chart.bpm; }
    if (chart.time && /^(\d+)\/\d+$/.test(chart.time)) t.grid.bpb = clamp(Number(chart.time.split("/")[0]), 2, 12);
    if (chart.sections && chart.sections.length) {
      if (!t.sections.length || t.sections.every(function (x) { return !x.lyrics; })) {
        var g = grid(s), totalBars = t.duration ? Math.max(1, timeToBar(s, t.duration).bar) : chart.sections.length * 8, per = Math.max(4, Math.round(totalBars / chart.sections.length / 4) * 4);
        t.sections = chart.sections.map(function (cs, i) { return { id: PP.id(), name: cs.name, bar: 1 + i * per, pad: -1, transition: "inherit", cue: "auto", lyrics: (cs.lines || []).join("\n"), page: cs.page || 0 }; });
      } else {
        // keep the timing, add lyrics/pages to sections with matching names
        chart.sections.forEach(function (cs) { var m = t.sections.filter(function (x) { return slug(x.name) === slug(cs.name) && !x.lyrics; })[0]; if (m) { m.lyrics = (cs.lines || []).join("\n"); m.page = cs.page || 0; } });
      }
    }
    PP.persistSoon(); render(); sendDisplay();
  }
  function lyricsPages(sec, perPage) {
    var lines = (sec && sec.lyrics ? sec.lyrics.split("\n") : []).map(function (l) { return l.trim(); }).filter(Boolean), pages = [];
    for (var i = 0; i < lines.length; i += perPage) pages.push(lines.slice(i, i + perPage));
    return pages;
  }
  function lyricsState() {
    var s = song(); if (!s) return { lines: [], page: 0, pages: 0, next: [], section: "" };
    var t = data(s), x = sectionAt(s, Math.max(0, state.pos)), per = clamp(t.lyricsLines || 4, 1, 12);
    if (!x) return { lines: [], page: 0, pages: 0, next: [], section: "" };
    var pages = lyricsPages(x.sec, per), page = 0;
    if (pages.length) { var frac = clamp((state.pos - x.start) / Math.max(.1, x.end - x.start), 0, .999); page = state.lyricsManual != null ? clamp(state.lyricsManual, 0, pages.length - 1) : Math.floor(frac * pages.length); }
    var secs = sectionsOf(s), nxt = page < pages.length - 1 ? pages[page + 1] : (x.index + 1 < secs.length ? lyricsPages(secs[x.index + 1].sec, per)[0] || [] : []);
    return { lines: pages[page] || [], page: page, pages: pages.length, next: nxt, section: x.sec.name, nextSection: x.index + 1 < secs.length ? secs[x.index + 1].sec.name : "" };
  }
  function lyricsStep(delta, opts) { var ls = lyricsState(), stay = opts && opts.stay && state.playing; if (!ls.pages) { if (stay) return; if (delta > 0) nextSection(); else prevSection(); return; } var p = ls.page + delta; if (p >= ls.pages) { if (!stay) nextSection(); return; } if (p < 0) { if (!stay) prevSection(); return; } state.lyricsManual = p; sendDisplay(); renderPosition(); }

  // ------------------------------------------------------------- display state (satellites)
  var displayTimer = 0, lastDisplayAt = 0;
  function throttleDisplay() { var now = performance.now(); if (now - lastDisplayAt > 240) sendDisplay(); }
  function sendDisplay() {
    clearTimeout(displayTimer);
    displayTimer = setTimeout(function () {
      lastDisplayAt = performance.now();
      var p = project(), s = song(), t = s && data(s), secs = s ? sectionsOf(s) : [], x = s ? sectionAt(s, Math.max(0, state.pos)) : null, g = s ? grid(s) : null, ls = lyricsState(), proj = p.projector || {};
      var bar = s ? timeToBar(s, state.pos) : { bar: 1, beat: 1, frac: 0 };
      var msg = {
        type: "display", t: Date.now(),
        song: s ? { name: s.name, key: s.key, bpm: Math.round(s.bpm), index: p.songIndex, count: p.songs.length, chart: s.chart || null, hasTracks: !!t.stems.length } : null,
        songs: p.songs.map(function (q) { return { id: q.id, name: q.name, key: q.key, chart: q.chart ? q.chart.id : null, hasTracks: !!(q.tracks && q.tracks.stems && q.tracks.stems.length) }; }),
        tracksMode: !!p.tracksMode, playing: state.playing, pos: Math.round(state.pos * 100) / 100, duration: t ? t.duration : 0, countIn: state.countIn, loop: state.loop,
        bpm: s ? Math.round(s.bpm) : Math.round(p.tempo.bpm), key: PP.playKeyFor(PP.currentPad()), bar: bar.bar, beat: bar.beat, bpb: g ? g.bpb : 4, speed: t ? t.tempoPercent / 100 : 1,
        beatFrac: g ? Math.max(0, Math.min(.999, (bar.frac * g.bpb) % 1)) : 0, tab: window.PPShell ? window.PPShell.currentTab() : "pads",
        section: x ? { index: x.index, name: x.sec.name, start: x.start, end: x.end, page: x.sec.page || 0, note: x.sec.note || "", color: window.PPColors ? window.PPColors.section(x.sec.name) : null } : null,
        sections: secs.map(function (q) { return { color: window.PPColors ? window.PPColors.section(q.sec.name) : null, type: window.PPColors ? window.PPColors.typeOf(q.sec.name) : null, note: q.sec.note || "", name: q.sec.name, start: Math.round(q.start * 100) / 100, end: Math.round(q.end * 100) / 100, page: q.sec.page || 0, pad: q.sec.pad, bar: q.sec.bar }; }),
        // the flow (live arrangement) and what the lights need: beat grid, detected hits, the next section
        flow: s && flowActive(s) ? { index: state.flowIndex || 0, entries: flowEntries(s).map(function (q) { return q.index; }) } : null,
        next: (function () { if (!s) return null; var fl = flowActive(s) ? flowEntries(s) : secs, i = flowActive(s) ? (state.flowIndex || 0) + 1 : (x ? x.index + 1 : 0); return fl[i] ? { name: fl[i].sec.name, start: Math.round(fl[i].start * 100) / 100, index: fl[i].index } : null; })(),
        songId: s ? s.id : null,
        lyrics: ls, chart: s && s.chart ? { id: s.chart.id, name: s.chart.name, page: (x && x.sec.page) || 1, pageCount: s.chart.pageCount || 1 } : null,
        projector: { fontSize: proj.fontSize || 7, blank: !!proj.blank, showNext: proj.showNext !== false, align: proj.align || "center", theme: proj.theme || "dark", showSection: proj.showSection !== false },
        pads: p.pads.map(function (pad, i) { return { name: pad.name, playing: engine.playingIndexes().indexOf(i) > -1, selected: i === PP.selected(), level: PP.padLevelOf ? PP.padLevelOf(pad) : 72 }; }),
        mini: miniState(p, t),
        performance: p.performance, frozen: !!engine.frozen, click: t ? !!t.click.on : true, cues: t ? !!t.cues.on : true, textures: (p.textures || []).map(function (c) { return { on: !!c.enabled, name: window.PPTextures ? window.PPTextures.byId(c.texture).name : c.texture }; })
      };
      var heavyKey = s ? s.id + "|" + t.duration + "|" + (g ? g.bars.length + ":" + g.bars[0] + ":" + g.bars[g.bars.length - 1] : 0) + "|" + (t.hits ? t.hits.length : 0) + "|" + JSON.stringify(t.tempoMap || []) + "|" + secs.length : "none";
      if (heavyKey !== lastHeavyKey) {  // the beat grid and the detected hits (for the lights) only when they change
        lastHeavyKey = heavyKey;
        msg.grid = g ? { bpm: Math.round((s.bpm || 0) * 10) / 10, bpb: g.bpb, bars: g.bars.slice(0, 600).map(function (b) { return Math.round(b * 1000) / 1000; }), barBeats: g.barBeats ? g.barBeats.slice(0, 600) : [] } : null;
        msg.hits = t && t.hits ? t.hits.slice(0, 400).map(function (h) { return Math.round(h * 1000) / 1000; }) : [];
      }
      send(msg);
      if (window.PPSatellite) window.PPSatellite.local(msg);
    }, 20);
  }
  var lastHeavyKey = null;
  F.on("hello", function () { lastHeavyKey = null; sendDisplay(); });
  // what the small touch screen's Tracks and Instrument tabs show: the stems (level, mute), the levels, the instrument
  function miniState(p, t) {
    var I = window.PPInstrument, ins = null;
    if (I) {
      var st = I.state();
      ins = { kind: st.kind, kinds: I.kinds().map(function (k) { return [k[0], k[1]]; }), board: I.boardName(), patch: st.patch ? st.patch.name : "", tuner: !!st.tuner, levelDb: st.levelDb,
        pedals: I.pedalNames().slice(0, 18), knobs: I.miniKnobs ? I.miniKnobs() : [], playAny: I.playAnyOn ? I.playAnyOn() : false };
      if (I.lockInfo) { var lk = I.lockInfo(); ins.boardLocked = lk.board || null; ins.patchLocked = lk.patch || null; }   // ("Part of Central Pedals · $50 a year" when a plan ended)
    }
    return { stems: t ? t.stems.map(function (q, i) { return { i: i, name: q.name, gain: Math.round((q.gain == null ? 1 : q.gain) * 1000) / 1000, pan: Math.round((Number(q.pan) || 0) * 100) / 100, mute: !!q.mute, role: q.role }; }) : [],
      levels: { tracks: Math.round(levels.tracks * 1000) / 1000, click: Math.round(levels.click * 1000) / 1000 }, volume: p.performance ? p.performance.volume : 1,
      tempoPercent: t ? t.tempoPercent : 100, instrument: ins,
      routing: window.PPSettings && window.PPSettings.routingSummary ? window.PPSettings.routingSummary() : null,
      input: I ? (function () { var c = I.config(); return { gain: c.input.gain || 0, channel: c.input.channel || "L", device: c.input.device || "auto" }; })() : null };
  }
  // a change anywhere (a pedal switched on the Instrument tab, a fader…) reaches the small screen too - at most ~6 a second
  var persistSoon0 = PP.persistSoon, miniAt = 0, miniTimer = 0;
  PP.persistSoon = function () { var r = persistSoon0.apply(this, arguments); var now = performance.now(); if (now - miniAt > 160) { miniAt = now; sendDisplay(); } else if (!miniTimer) miniTimer = setTimeout(function () { miniTimer = 0; miniAt = performance.now(); sendDisplay(); }, 170); return r; };

  // ------------------------------------------------------------- levels (knobs)
  var levels = { tracks: .85, click: .85, cue: .9, pads: 1 };
  function applyLevels() {
    if (!engine.ctx) return; var now = engine.ctx.currentTime;
    PP.smoothParam(engine.tracksBus.gain, Math.pow(levels.tracks, 1.6) * 1.1, now);
    PP.smoothParam(engine.clickBus.gain, Math.pow(levels.click, 1.6) * 1.2, now);
  }
  function setLevel(which, v) { levels[which] = clamp(v, 0, 1); applyLevels(); if (which === "cue") post({ cmd: "set", cueLevel: Math.pow(levels.cue, 1.2) }); renderTransport(); }
  function balance(v) { v = clamp(v, 0, 1); levels.pads = v < .5 ? 1 : 1 - (v - .5) * 2; levels.tracks = v > .5 ? 1 : v * 2; applyLevels(); if (engine.ctx) PP.smoothParam(engine.master.gain, Math.pow(project().performance.volume, 1.6) * 1.1 * levels.pads, engine.ctx.currentTime); }
  function setStem(stemId, field, value) {
    var s = song(); if (!s) return; var st = data(s).stems.filter(function (q) { return q.id === stemId; })[0]; if (!st) return;
    st[field] = value; var m = { cmd: "stem", id: stemId }; m[field] = value; post(m); PP.persistSoon();
  }

  // ------------------------------------------------------------- UI: Tracks tab
  var tl = { drag: null };
  function render() {
    renderRehearse();
    var s = song(), t = s && data(s), p = project();
    var use = $("#trUseTracks"); if (use) { use.classList.toggle("on", !!p.tracksMode); use.querySelector("b").textContent = p.tracksMode ? "ON" : "OFF"; }
    var name = $("#trSongName"); if (!name) return;
    name.textContent = s ? (p.songIndex + 1) + ". " + s.name : (p.songs.length ? "No song selected" : "No songs yet");
    $("#trSongMeta").textContent = s ? keyName(s.key) + (t.originalKey && t.keyShift ? " (" + (t.keyShift > 0 ? "+" : "") + t.keyShift + ")" : "") + " · " + Math.round(s.bpm) + " BPM" + (t.tempoPercent !== 100 ? " (" + t.tempoPercent + "%)" : "") + " · " + meterText(t) + " · " + (t.stems.length ? t.stems.length + " track" + (t.stems.length === 1 ? "" : "s") + " · " + fmtTime(t.duration) : "no tracks") + (s.chart ? " · chart ✓" : "") : "Add a song with + Song, then add its tracks";
    renderStems(); renderSections(); renderTransport(); renderPosition(); drawTimeline();
    var sel = $("#trSongSelect"); if (sel) { sel.innerHTML = '<option value="-1">— choose a song —</option>' + p.songs.map(function (q, i) { return '<option value="' + i + '"' + (i === p.songIndex ? " selected" : "") + ">" + (i + 1) + ". " + esc(q.name) + (q.tracks && q.tracks.stems && q.tracks.stems.length ? " ♫" : "") + "</option>"; }).join(""); }
  }
  // pan as people read it: L 30 / C / R 30 (percent of the way to one side)
  function panText(v) { v = Number(v) || 0; var n = Math.round(Math.abs(v) * 100); return n < 2 ? "C" : (v < 0 ? "L " : "R ") + n; }
  function dbText(g) { return g > 0 ? (20 * Math.log10(g)).toFixed(1) + " dB" : "−∞"; }
  function stripHtml(st, anySolo, direct, chans) {
    return '<div class="stem role-' + esc(st.role || "music") + (st.mute ? " muted" : "") + (st.solo ? " solo" : "") + (anySolo && !st.solo ? " dim" : "") + (st.bus === "click" ? " clickbus" : "") + (st.missing ? " missing" : "") + '" data-stem="' + st.id + '">' +
      '<div class="stem-name" title="' + esc(st.name) + '">' + esc(st.name) + "</div>" +
      '<div class="stem-fwrap"><input type="range" class="stem-fader" orient="vertical" min="0" max="1.41" step=".01" value="' + st.gain + '" aria-label="' + esc(st.name) + ' level" title="Level (double-tap: 0 dB)"><div class="stem-meter"><i></i></div></div>' +
      '<small class="stem-db">' + dbText(st.gain) + '</small>' +
      '<label class="stem-panbox" title="Pan: left / right (double-tap or hold: centre)"><span>PAN</span><input type="range" class="stem-pan" min="-1" max="1" step=".02" value="' + (st.pan || 0) + '" aria-label="' + esc(st.name) + ' pan"><b class="stem-panv">' + panText(st.pan) + "</b></label>" +
      '<div class="stem-btns"><button data-sf="mute" class="' + (st.mute ? "on" : "") + '" title="Mute">M</button><button data-sf="solo" class="' + (st.solo ? "on" : "") + '" title="Solo">S</button></div>' +
      (direct ? '<select class="stem-out" title="Direct output for this track (a USB interface output), or in the tracks mix"><option value="0"' + (!st.out ? " selected" : "") + '>in mix</option>' + chans.map(function (n, i) { return '<option value="' + (i + 1) + '"' + (st.out === i + 1 ? " selected" : "") + ">→ " + esc(String(n).replace(/^\d+ · /, "").slice(0, 14)) + "</option>"; }).join("") + "</select>" : "") +
      '<small>' + (st.bus === "click" ? "→ click out" : st.out > 0 ? "→ out " + st.out : esc(st.role)) + "</small></div>";
  }
  function busStrip(key, name, note) {
    var v = levels[key], g = Math.pow(v, 1.6) * (key === "click" ? 1.2 : 1.1);
    return '<div class="stem bus" data-bus="' + key + '"><div class="stem-name">' + name + '</div><div class="stem-fwrap"><input type="range" class="bus-fader" orient="vertical" min="0" max="1" step=".01" value="' + v + '" aria-label="' + name + ' level"></div><small class="stem-db">' + Math.round(v * 100) + '%</small><small>' + note + "</small></div>";
  }
  function renderStems() {
    var s = song(), t = s && data(s), roots = [$("#trStems"), $("#mixStrips")].filter(Boolean); if (!roots.length) return;
    var html;
    if (!t || !t.stems.length) html = '<p class="muted">No tracks in this song. <button class="link" data-tr="edit">Add stems or a song file</button></p>';
    else {
      var anySolo = t.stems.some(function (q) { return q.solo; }), direct = directOutsAvailable(), chans = direct ? outputChannels() : [];
      html = t.stems.map(function (st) { return stripHtml(st, anySolo, direct, chans); }).join("");
    }
    roots.forEach(function (root) {
      root.innerHTML = html + (root.id === "mixStrips" || (root.id === "trStems" && t && t.stems.length) ? '<div class="mix-sep"></div>' + busStrip("tracks", "TRACKS", "out 1") + busStrip("click", "CLICK", "out 3") + busStrip("cue", "CUES", "voice") : "");
    });
    var mt = $("#mixTitle"); if (mt) mt.textContent = s ? s.name + " · " + (t.stems.length) + " track" + (t.stems.length === 1 ? "" : "s") : "No song";
    if (window.PPScenes) window.PPScenes.renderMixerBar();
    drawMeters();
  }
  function bindStrips(root) {
    root.addEventListener("input", function (e) {
      var bus = e.target.closest("[data-bus]"); if (bus && e.target.classList.contains("bus-fader")) { setLevel(bus.dataset.bus, Number(e.target.value)); bus.querySelector(".stem-db").textContent = Math.round(Number(e.target.value) * 100) + "%"; return; }
      var row = e.target.closest("[data-stem]"); if (!row) return;
      if (e.target.classList.contains("stem-fader")) { var g = Number(e.target.value); setStem(row.dataset.stem, "gain", g); var db = row.querySelector(".stem-db"); if (db) db.textContent = dbText(g); syncOtherStrip(row.dataset.stem, root); }
      else if (e.target.classList.contains("stem-pan")) { setStem(row.dataset.stem, "pan", Number(e.target.value)); var pv = row.querySelector(".stem-panv"); if (pv) pv.textContent = panText(e.target.value); syncOtherStrip(row.dataset.stem, root); }
    });
    root.addEventListener("change", function (e) { var row = e.target.closest("[data-stem]"); if (!row || !e.target.classList.contains("stem-out")) return; var st = tdata().stems.filter(function (q) { return q.id === row.dataset.stem; })[0]; if (!st) return; st.out = Number(e.target.value) || 0; PP.persistSoon(); applyDirectOuts(); renderStems(); PP.setStatus(st.out ? st.name + " → output " + st.out + " (direct)" : st.name + " back in the tracks mix"); });
    root.addEventListener("dblclick", function (e) { var row = e.target.closest("[data-stem]"); if (!row) return; if (e.target.classList.contains("stem-pan")) { centrePan(row, e.target); } else if (e.target.classList.contains("stem-fader")) { e.target.value = 1; setStem(row.dataset.stem, "gain", 1); var db = row.querySelector(".stem-db"); if (db) db.textContent = "0.0 dB"; } syncOtherStrip(row.dataset.stem, root); });
    // hold the pan (touch screens have no double-click to speak of): back to the centre
    var hold = null;
    root.addEventListener("pointerdown", function (e) {
      if (!e.target.classList || !e.target.classList.contains("stem-pan")) return;
      var row = e.target.closest("[data-stem]"), x0 = e.clientX, el = e.target, v0 = el.value;
      clearTimeout(hold && hold.t);
      hold = { x0: x0, t: setTimeout(function () { if (hold && Math.abs(Number(el.value) - Number(v0)) < 0.05) centrePan(row, el); hold = null; }, 600) };
    });
    root.addEventListener("pointermove", function (e) { if (hold && Math.abs(e.clientX - hold.x0) > 8) { clearTimeout(hold.t); hold = null; } });
    ["pointerup", "pointercancel"].forEach(function (ev) { root.addEventListener(ev, function () { if (hold) { clearTimeout(hold.t); hold = null; } }); });
    function centrePan(row, el) { if (!row) return; el.value = 0; setStem(row.dataset.stem, "pan", 0); var pv = row.querySelector(".stem-panv"); if (pv) pv.textContent = "C"; syncOtherStrip(row.dataset.stem, root); }
    root.addEventListener("click", function (e) { var b = e.target.closest("[data-sf]"), row = e.target.closest("[data-stem]"); if (!b || !row) return; var st = tdata().stems.filter(function (q) { return q.id === row.dataset.stem; })[0]; if (!st) return; setStem(st.id, b.dataset.sf, !st[b.dataset.sf]); renderStems(); });
  }
  function syncOtherStrip(id, from) {  // the small strip on the Tracks tab and the big mixer show the same values
    var st = tdata().stems.filter(function (q) { return q.id === id; })[0]; if (!st) return;
    [$("#trStems"), $("#mixStrips")].forEach(function (root) { if (!root || root === from) return; var row = root.querySelector('[data-stem="' + id + '"]'); if (!row) return; row.querySelector(".stem-fader").value = st.gain; row.querySelector(".stem-pan").value = st.pan || 0; var pv = row.querySelector(".stem-panv"); if (pv) pv.textContent = panText(st.pan); row.querySelector(".stem-db").textContent = dbText(st.gain); });
  }
  function renderSections() {
    var root = $("#trSections"), s = song(); if (!root) return;
    var secs = s ? sectionsOf(s) : [], cur = state.section;
    if (!secs.length) { root.innerHTML = '<p class="muted">' + (s && data(s).stems.length ? '<button class="link" data-tr="autoSections">Create sections automatically</button> or mark them in the song editor.' : "Sections appear here once the song has tracks.") + "</p>"; return; }
    root.innerHTML = secs.map(function (x) {
      var padTxt = x.sec.pad === -2 ? "pads stop" : x.sec.pad >= 0 ? "pad " + (x.sec.pad + 1) : "";
      return '<button class="sec' + (x.index === cur ? " current" : "") + (state.loop === x.index ? " looping" : "") + (pendingJump && Math.abs(pendingJump.time - x.start) < .01 ? " pending" : "") + '" style="--secc:' + (window.PPColors ? window.PPColors.section(x.sec.name) : "") + '" data-sec="' + x.index + '"><b>' + esc(x.sec.name) + "</b><small>bar " + x.sec.bar + (padTxt ? " · " + padTxt : "") + "</small></button>";
    }).join("");
    renderFlow();
    var cs = root.querySelector(".sec.current"); if (cs && cs.scrollIntoView) { try { cs.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" }); } catch (_) { } }
  }
  function renderTransport() {
    var s = song(), t = s && data(s), play = $("#trPlay"); if (!play) return;
    play.classList.toggle("on", state.playing); play.querySelector("b").textContent = state.countIn ? String(state.countIn) : state.playing ? "PAUSE" : "PLAY";
    $("#trLoop").classList.toggle("on", state.loop >= 0);
    $("#trClick").classList.toggle("on", !!(t && t.click.on)); $("#trCues").classList.toggle("on", !!(t && t.cues.on));
    $("#trCountIn").querySelector("b").textContent = t ? (t.countIn ? t.countIn + (t.countIn === 1 ? " bar" : " bars") : "off") : "—";
    $("#trKeyVal").textContent = s ? keyName(s.key) : "—"; $("#trTempoVal").innerHTML = "<small>TEMPO</small><b>" + (t ? t.tempoPercent + "%" : "—") + "</b>";
    var lk = $("#trLink"); if (lk) { lk.classList.toggle("on", !!(project().link && project().link.enabled)); lk.querySelector("small").textContent = linkStatus.peers ? linkStatus.peers + " peer" + (linkStatus.peers === 1 ? "" : "s") : "LINK"; }
    var lv = $("#trLevels"); if (lv) lv.innerHTML = [["tracks", "Tracks"], ["click", "Click"], ["cue", "Cues"]].map(function (k) { return '<label>' + k[1] + '<span class="control-line"><input type="range" min="0" max="1" step=".01" data-trlevel="' + k[0] + '" value="' + levels[k[0]] + '"><output>' + Math.round(levels[k[0]] * 100) + "%</output></span></label>"; }).join("");
  }
  function renderPosition() {
    var s = song(), t = s && data(s), el = $("#trPos"); if (!el) return;
    if (!t) { el.textContent = "0:00"; return; }
    var bar = timeToBar(s, state.pos);
    el.textContent = fmtTime(state.pos) + " / " + fmtTime(t.duration) + "  ·  bar " + bar.bar + "." + bar.beat;
    var ls = lyricsState(), ly = $("#trLyricsNow"); if (ly) ly.innerHTML = ls.lines.length ? ls.lines.map(esc).join("<br>") + (ls.pages > 1 ? '<small> ' + (ls.page + 1) + "/" + ls.pages + "</small>" : "") : '<span class="muted">' + (ls.section ? "No lyrics for " + esc(ls.section) + "." : "Lyrics show here while the song plays - add them in the song editor (✎ Song editor → Lyrics) or with a chord chart.") + "</span>";
    drawTimeline();
  }
  var tlCanvas = null;
  function rrect(ctx, x, y, w, h, r) { ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2))); else ctx.rect(x, y, w, h); }
  function cssVar(n, d) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim() || d; }
  function drawTimeline() {
    var c = $("#trTimeline"), s = song(), t = s && data(s); if (!c) return;
    var g = PP.graphGeometry(c), ctx = g.ctx, W = g.width, H = g.height, F = '"Archivo", system-ui, sans-serif'; ctx.clearRect(0, 0, W, H);
    var bg = ctx.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, "rgba(255,255,255,.025)"); bg.addColorStop(1, "rgba(0,0,0,.25)"); ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    if (!t || !t.duration) { ctx.fillStyle = "rgba(236,231,221,.45)"; ctx.font = "500 13px " + F; ctx.textAlign = "center"; ctx.fillText(s ? "No tracks yet" : "No song", W / 2, H / 2 + 4); ctx.textAlign = "left"; return; }
    var dur = t.duration, x = function (tm) { return tm / dur * W; }, top = 20, bot = H - 10;
    var sig = t.stems.map(function (q) { return q.id + q.role + (q.mute ? 1 : 0) + (q.gain == null ? 1 : Math.round(q.gain * 20)); }).join("|");
    if ((t.overviewMix !== 2 || t._ovSig !== sig) && t.stems.length) { refreshOverview(t); t._ovSig = sig; }
    var secs = sectionsOf(s), C = window.PPColors, col = function (q) { return C ? C.section(q.sec.name) : "#5a7896"; };
    // sections: a soft tint (stronger on the one playing) and a rounded chip with the name
    secs.forEach(function (q, i) {
      var x1 = x(q.start), w = Math.max(1, x(q.end) - x1), cur = i === state.section;
      ctx.fillStyle = col(q); ctx.globalAlpha = cur ? 0.13 : 0.06; ctx.fillRect(x1, top, w - 1, H - top); ctx.globalAlpha = cur ? 1 : 0.82;
      rrect(ctx, x1 + 1, 3, w - 3, 14, 4); ctx.fill(); ctx.globalAlpha = 1;
      if (w > 30) { ctx.save(); ctx.beginPath(); ctx.rect(x1 + 1, 0, w - 6, 18); ctx.clip(); ctx.fillStyle = "rgba(10,11,13,.88)"; ctx.font = "600 10.5px " + F; ctx.fillText(q.sec.name, x1 + 7, 13.5); ctx.restore(); }
    });
    // bars: hairlines, stronger every 4
    var gr = grid(s);
    if (gr) { var every = gr.bars.length > 200 ? 4 : 1; for (var b = 0; b < gr.bars.length; b += every) { var bx = Math.round(x(gr.bars[b])) + 0.5; if (bx > W) break; ctx.fillStyle = b % 4 === 0 ? "rgba(236,231,221,.10)" : "rgba(236,231,221,.04)"; ctx.fillRect(bx, top, 1, H - top); } }
    // the waveform: a smooth mirrored envelope in each section's colour, lit where it has played
    var ov = t.overview || [], n = ov.length, mid = (top + bot) / 2, amp = (bot - top) / 2, playedX = x(state.pos), waveC = cssVar("--wave", "#ece7dd");
    if (n) {
      var env = function () { ctx.beginPath(); ctx.moveTo(0, mid); for (var i = 0; i < n; i++) ctx.lineTo(i / (n - 1 || 1) * W, mid - Math.max(0.5, ov[i] * amp * 0.95)); for (var j = n - 1; j >= 0; j--) ctx.lineTo(j / (n - 1 || 1) * W, mid + Math.max(0.5, ov[j] * amp * 0.95)); ctx.closePath(); };
      var paint = function (x1, x2, color) { ctx.save(); ctx.beginPath(); ctx.rect(x1, 0, x2 - x1, H); ctx.clip(); var gg = ctx.createLinearGradient(0, mid - amp, 0, mid + amp); gg.addColorStop(0, color); gg.addColorStop(0.5, color + "99"); gg.addColorStop(1, color); env(); ctx.fillStyle = gg; ctx.fill(); ctx.restore(); };
      var hex = function (cl) { return /^#[0-9a-f]{6}$/i.test(cl) ? cl : "#ece7dd"; };
      if (secs.length) { if (secs[0].start > 0) paint(0, x(secs[0].start), hex(waveC)); secs.forEach(function (q) { paint(x(q.start), x(q.end), hex(col(q))); }); } else paint(0, W, hex(waveC));
      // not played yet: dimmed
      ctx.fillStyle = "rgba(14,16,19,.5)"; ctx.fillRect(playedX, top, W - playedX, bot - top);
      ctx.fillStyle = "rgba(236,231,221,.14)"; ctx.fillRect(0, Math.round(mid), W, 1);
    }
    // hits: gold diamonds along the bottom
    var hitC = cssVar("--hit", "#f5cf72"); ctx.fillStyle = hitC; t.hits.forEach(function (h) { var hx = x(h); ctx.beginPath(); ctx.moveTo(hx, H - 8); ctx.lineTo(hx + 3.5, H - 4.5); ctx.lineTo(hx, H - 1); ctx.lineTo(hx - 3.5, H - 4.5); ctx.closePath(); ctx.fill(); });
    // the section on repeat, and A / B
    var acc = cssVar("--accent", "#e2c27e");
    if (state.loop >= 0 && secs[state.loop]) { var q2 = secs[state.loop]; ctx.strokeStyle = acc; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); rrect(ctx, x(q2.start) + 1, 1, x(q2.end) - x(q2.start) - 2, H - 2, 6); ctx.stroke(); ctx.setLineDash([]); }
    if (ab.on && ab.a != null && ab.b != null) { ctx.fillStyle = "rgba(245,207,114,.12)"; ctx.fillRect(x(ab.a), 0, x(ab.b) - x(ab.a), H); }
    [["A", ab.a], ["B", ab.b]].forEach(function (m) { if (m[1] == null) return; var mx = x(m[1]); ctx.fillStyle = hitC; ctx.fillRect(mx - 1, 0, 2, H); rrect(ctx, mx - 7, H - 16, 14, 14, 3); ctx.fill(); ctx.fillStyle = "#1a1408"; ctx.font = "700 10px " + F; ctx.textAlign = "center"; ctx.fillText(m[0], mx, H - 5); ctx.textAlign = "left"; });
    // the playhead: a line with a glow and a head
    var px = x(state.pos), ph = cssVar("--playhead", "#ffffff");
    ctx.save(); ctx.shadowColor = "rgba(255,255,255,.7)"; ctx.shadowBlur = 8; ctx.fillStyle = ph; ctx.fillRect(px - 1, 0, 2, H); ctx.beginPath(); ctx.moveTo(px - 6, 0); ctx.lineTo(px + 6, 0); ctx.lineTo(px, 7); ctx.closePath(); ctx.fill(); ctx.restore();
    if (pendingJump) { var jx = x(pendingJump.time); ctx.fillStyle = hitC; ctx.setLineDash([3, 3]); ctx.fillRect(jx - 1, 0, 2, H); ctx.setLineDash([]); }
  }
  function timelinePointer(e) {
    var c = $("#trTimeline"), s = song(); if (!s || !data(s).duration) return;
    var r = c.getBoundingClientRect(), ratio = clamp((e.clientX - r.left) / r.width, 0, 1), tm = ratio * data(s).duration;
    if (e.type === "pointerdown") { tl.drag = true; c.setPointerCapture(e.pointerId); tl.start = performance.now(); }
    if (!tl.drag) return;
    if (e.type === "pointerup" || e.type === "pointercancel") { tl.drag = false; var snap = $("#trSnap") && $("#trSnap").classList.contains("on"); if (snap) { var g = grid(s); tm = g.bars.reduce(function (best, b) { return Math.abs(b - tm) < Math.abs(best - tm) ? b : best; }, tm); } seek(tm); return; }
    state.pos = tm; renderPosition();
  }

  // ------------------------------------------------------------- UI: song editor dialog
  function openEditor() {
    var s = song(); if (!s) { s = newSong(); F.loadSong(project().songs.length - 1); }
    renderEditor(); $("#songDialog").showModal();
  }
  function cueOptions(sel) {
    var names = Object.keys(cueSet).filter(function (k) { return !/^\d+$/.test(k); }).sort();
    return '<option value="auto"' + (sel === "auto" ? " selected" : "") + '>Auto (from the name)</option><option value="none"' + (sel === "none" ? " selected" : "") + ">No cue</option>" + names.map(function (n) { return '<option value="' + n + '"' + (sel === n ? " selected" : "") + ">" + n.replace(/-/g, " ") + "</option>"; }).join("") + '<option value="say:"' + (sel && sel.indexOf("say:") === 0 ? " selected" : "") + ">Say custom text…</option>";
  }
  function padOptions(sel) { var o = '<option value="-1"' + (sel === -1 ? " selected" : "") + '>keep pad</option><option value="-2"' + (sel === -2 ? " selected" : "") + ">stop pads</option>"; project().pads.forEach(function (pad, i) { o += '<option value="' + i + '"' + (sel === i ? " selected" : "") + ">" + (i + 1) + ". " + esc(pad.name) + "</option>"; }); return o; }
  function renderEditor() {
    if (window.PPScenes) setTimeout(function () { window.PPScenes.renderEditor(); }, 0);
    var s = song(), t = data(s), d = $("#songDialog"); if (!d || !s) return;
    $("#seName").value = s.name; $("#seKey").innerHTML = KEYS.map(function (k) { return '<option value="' + k + '"' + (k === s.key ? " selected" : "") + ">" + keyName(k) + "</option>"; }).join("");
    $("#seOrigKey").innerHTML = '<option value="">unknown</option>' + KEYS.map(function (k) { return '<option value="' + k + '"' + (k === t.originalKey ? " selected" : "") + ">" + keyName(k) + "</option>"; }).join("");
    renderTempoMap(s, t); renderFlowEditor(s, t);
    $("#seBpm").value = Math.round(t.grid.bpm * 10) / 10; $("#seFirst").value = Math.round((t.grid.first || 0) * 1000) / 1000; $("#seBpb").value = t.grid.bpb || 4; $("#seGridMode").value = t.grid.mode === "detected" ? "detected" : "fitted";
    clickOptions(); $("#seCountIn").value = t.countIn; $("#seClickSound").value = t.click.sound; $("#seClickSub").value = t.click.sub; $("#seClickLevel").value = t.click.level; $("#seCueLevel").value = t.cues.level; $("#seCueLead").value = t.cues.leadBars; $("#seCountVoice").checked = !!t.cues.countVoice; $("#seClickStems").checked = t.click.stems !== false;
    var fl = follow(t); $("#seSongPad").innerHTML = '<option value="-1">the selected pad</option>' + project().pads.map(function (pd, i) { return '<option value="' + i + '"' + (s.pad === i ? " selected" : "") + ">" + (i + 1) + " · " + esc(pd.name) + "</option>"; }).join(""); $("#seFollowStart").checked = fl.start; $("#seFollowStop").checked = fl.stop; $("#seFollowSwell").checked = fl.swell;
    $("#seTransition").value = t.transition.type; $("#seTransitionSec").value = t.transition.seconds; $("#seJump").value = t.jump; $("#seLyricsLines").value = t.lyricsLines; $("#seAutoHits").checked = !!t.autoHits; $("#sePresentation").value = s.presentation || ""; $("#seAfter").value = afterMode(t); $("#seGap").value = t.gap; $("#seOverlap").value = t.overlap; $("#seGap").parentNode.hidden = afterMode(t) !== "play"; $("#seOverlap").parentNode.hidden = afterMode(t) !== "segue"; $("#seProgram").value = s.midiProgram == null ? "" : s.midiProgram;
    renderGuesses(s, t);
    $("#seAnalysis").textContent = t.analysis ? "Detected: " + Math.round(t.analysis.bpm * 10) / 10 + " BPM · " + keyName(t.analysis.key) + " " + t.analysis.mode + " (" + Math.round(t.analysis.keyConfidence * 100) + "% sure) · grid " + (t.analysis.grid && t.analysis.grid.steady ? "steady (±" + t.analysis.grid.residualMs + " ms)" : "varies, following the drums") + " · " + t.hits.length + " big hits" : "Not analyzed yet.";
    $("#seStems").innerHTML = t.stems.length ? t.stems.map(function (st) { return '<div class="se-stem" data-stem="' + st.id + '"><input data-sef="name" value="' + esc(st.name) + '"><select data-sef="role">' + ["music", "drums", "bass", "keys", "guitar", "vocals", "guide", "click"].map(function (r) { return '<option' + (r === st.role ? " selected" : "") + ">" + r + "</option>"; }).join("") + '</select><select data-sef="bus"><option value="music"' + (st.bus !== "click" ? " selected" : "") + '>main out</option><option value="click"' + (st.bus === "click" ? " selected" : "") + '>click out</option></select><button data-sef="del" class="danger">✕</button></div>'; }).join("") : '<p class="muted">No tracks yet.</p>';
    var secs = t.sections.slice().sort(function (a, b) { return a.bar - b.bar; });
    $("#seSections").innerHTML = secs.length ? secs.map(function (sec) {
      return '<div class="se-sec" data-secid="' + sec.id + '"><div class="se-sec-head"><input data-secf="name" value="' + esc(sec.name) + '" aria-label="Section name"><label>bar <input data-secf="bar" type="number" min="1" step="1" value="' + sec.bar + '"></label><label class="se-note" title="Shown on the stage display and in Central Control (e.g. drums out, key change, all in)">note <input data-secf="note" value="' + esc(sec.note || "") + '" placeholder="drums out, build…"></label><label>pad <select data-secf="pad">' + padOptions(sec.pad) + '</select></label><label title="How loud the pads are in this section (auto: from the name - verse softer, chorus full)">pad level <select data-secf="padLevel">' + ['', 0, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110].map(function (v) { return '<option value="' + v + '"' + (String(sec.padLevel == null ? "" : sec.padLevel) === String(v) ? " selected" : "") + ">" + (v === "" ? "auto (" + Math.round(sectionSwell(Object.assign({}, sec, { padLevel: null })) * 100) + "%)" : v + "%") + "</option>"; }).join("") + '</select></label><label>in <select data-secf="transition"><option value="inherit"' + (sec.transition === "inherit" ? " selected" : "") + '>song default</option><option value="swell"' + (sec.transition === "swell" ? " selected" : "") + '>swell</option><option value="crossfade"' + (sec.transition === "crossfade" ? " selected" : "") + '>crossfade</option><option value="cut"' + (sec.transition === "cut" ? " selected" : "") + '>cut</option></select></label><label>cue <select data-secf="cue">' + cueOptions(sec.cue) + '</select></label>' + (sec.cue && sec.cue.indexOf("say:") === 0 ? '<input data-secf="cueText" value="' + esc(sec.cue.slice(4)) + '" placeholder="words to say">' : "") + '<label>page <input data-secf="page" type="number" min="0" step="1" value="' + (sec.page || 0) + '" title="chart page (0 = auto)"></label><label>scene <select data-secf="scene"><option value="">—</option>' + (s.scenes || []).map(function (sc) { return '<option value="' + sc.id + '"' + (sec.scene === sc.id ? " selected" : "") + ">" + esc(sc.name) + "</option>"; }).join("") + '</select></label><label title="ProPresenter: slide number to show when this section starts (or next)">slide <input data-secf="slide" value="' + esc(sec.slide == null ? "" : String(sec.slide)) + '" placeholder="—" style="width:56px"></label><button data-secf="go" title="Jump here">▶</button><button data-secf="here" title="Set the start to the playhead">⌖</button><button data-secf="del" class="danger">✕</button></div><textarea data-secf="lyrics" rows="2" placeholder="Lyrics for this section (one line per line)">' + esc(sec.lyrics || "") + "</textarea></div>";
    }).join("") : '<p class="muted">No sections. Add them, create them automatically, or import a chord chart.</p>';
    $("#seChart").innerHTML = '<option value="">— none —</option>' + charts.map(function (c) { return '<option value="' + c.id + '"' + (s.chart && s.chart.id === c.id ? " selected" : "") + ">" + esc(c.name) + " (" + c.pageCount + " p)</option>"; }).join("");
    $("#seHits").textContent = t.hits.length + " hit" + (t.hits.length === 1 ? "" : "s") + (t.autoHits ? " (automatic)" : " (yours)");
  }
  function editorField(e) {
    var s = song(); if (!s) return; var t = data(s), el = e.target, f = el.dataset.se;
    if (!f) return;
    if (f === "name") { s.name = el.value || s.name; }
    else if (f === "key") { s.key = el.value; if (t.originalKey) { var diff = ((PP.noteIndex(s.key) - PP.noteIndex(t.originalKey)) % 12 + 12) % 12; if (diff > 6) diff -= 12; t.keyShift = diff; post({ cmd: "set", pitch: Math.pow(2, t.keyShift / 12) }); } }
    else if (f === "origKey") { t.originalKey = el.value || null; if (t.originalKey) { var d2 = ((PP.noteIndex(s.key) - PP.noteIndex(t.originalKey)) % 12 + 12) % 12; if (d2 > 6) d2 -= 12; t.keyShift = d2; } else t.keyShift = 0; post({ cmd: "set", pitch: Math.pow(2, t.keyShift / 12) }); }
    else if (f === "bpm") { t.grid.bpm = clamp(Number(el.value) || 72, 20, 300); t.grid.mode = "fitted"; s.bpm = Math.round(t.grid.bpm * t.tempoPercent / 100 * 10) / 10; }
    else if (f === "first") { t.grid.first = Math.max(0, Number(el.value) || 0); t.grid.mode = "fitted"; }
    else if (f === "bpb") { t.grid.bpb = clamp(Number(el.value) || 4, 2, 12); }
    else if (f === "gridMode") { t.grid.mode = el.value; }
    else if (f === "countIn") t.countIn = clamp(Number(el.value) || 0, 0, 4);
    else if (f === "clickSound") t.click.sound = el.value; else if (f === "clickSub") t.click.sub = Number(el.value); else if (f === "clickLevel") t.click.level = Number(el.value); else if (f === "clickStems") t.click.stems = el.checked;
    else if (f === "cueLevel") t.cues.level = Number(el.value); else if (f === "cueLead") t.cues.leadBars = Number(el.value); else if (f === "countVoice") t.cues.countVoice = el.checked;
    else if (f === "transition") t.transition.type = el.value; else if (f === "transitionSec") t.transition.seconds = clamp(Number(el.value) || 2, .2, 20);
    else if (f === "jump") t.jump = el.value; else if (f === "lyricsLines") t.lyricsLines = clamp(Number(el.value) || 4, 1, 12); else if (f === "autoHits") { t.autoHits = el.checked; if (t.autoHits && t.analysis) t.hits = t.analysis.hits.slice(); }
    else if (f === "presentation") s.presentation = el.value.trim(); else if (f === "after") { t.after = el.value; t.autoNext = el.value === "play"; $("#seGap").parentNode.hidden = el.value !== "play"; $("#seOverlap").parentNode.hidden = el.value !== "segue"; } else if (f === "gap") t.gap = clamp(Number(el.value) || 0, 0, 30); else if (f === "overlap") t.overlap = clamp(Number(el.value) || 0, 0, 30); else if (f === "program") s.midiProgram = el.value === "" ? null : clamp(Number(el.value), 0, 127);
    else if (f === "songPad") s.pad = Number(el.value);
    else if (f === "followStart" || f === "followStop" || f === "followSwell") { t.padFollow = t.padFollow || {}; t.padFollow[f.slice(6).toLowerCase()] = el.checked; }
    else if (f === "chart") { var c = charts.filter(function (q) { return q.id === el.value; })[0]; if (c) chartInfo(c.id).then(function (info) { if (info) applyChart(s, info); }); else s.chart = null; }
    gridCache.key = null;
    if (song() === s) pushAll(s);
    PP.persistSoon(); render(); sendDisplay();
    if (f === "name") renderEditor();
  }
  function editorSection(e) {
    var s = song(); if (!s) return; var t = data(s), row = e.target.closest("[data-secid]"); if (!row) return;
    var sec = t.sections.filter(function (q) { return q.id === row.dataset.secid; })[0], f = e.target.dataset.secf; if (!sec || !f) return;
    if (e.type === "click") {
      if (f === "del") { t.sections = t.sections.filter(function (q) { return q !== sec; }); }
      else if (f === "go") { var idx = sectionsOf(s).map(function (q) { return q.sec.id; }).indexOf(sec.id); goSection(idx, { immediate: true }); return; }
      else if (f === "here") { sec.bar = timeToBar(s, state.pos).bar; }
      else return;
    } else {
      if (f === "scene") { sec.scene = e.target.value; PP.persistSoon(); return; }
      if (f === "slide") { var sv = e.target.value.trim(); sec.slide = sv === "" ? null : (/^next$/i.test(sv) ? "next" : Math.max(1, Math.round(Number(sv)) || 1)); PP.persistSoon(); return; }
      if (f === "name") sec.name = e.target.value; else if (f === "bar") sec.bar = Math.max(1, Math.round(Number(e.target.value) || 1)); else if (f === "pad") sec.pad = Number(e.target.value); else if (f === "note") sec.note = e.target.value.slice(0, 80); else if (f === "padLevel") sec.padLevel = e.target.value === "" ? null : Number(e.target.value);
      else if (f === "transition") sec.transition = e.target.value; else if (f === "cue") { sec.cue = e.target.value; } else if (f === "cueText") sec.cue = "say:" + e.target.value; else if (f === "page") sec.page = Math.max(0, Math.round(Number(e.target.value) || 0)); else if (f === "lyrics") sec.lyrics = e.target.value;
      if (f === "lyrics" || f === "name" || f === "cueText") { PP.persistSoon(); if (f !== "lyrics") pushCues(s); sendDisplay(); return; }
    }
    gridCache.key = null; PP.persistSoon(); pushAll(s); render(); sendDisplay();
    if (e.type === "click" || f === "cue") renderEditor();
  }
  async function editorStem(e) {
    var s = song(); if (!s) return; var t = data(s), row = e.target.closest("[data-stem]"); if (!row) return;
    var st = t.stems.filter(function (q) { return q.id === row.dataset.stem; })[0], f = e.target.dataset.sef; if (!st || !f) return;
    if (f === "del") { if (!confirm("Remove the track \"" + st.name + "\" from this song?")) return; t.stems = t.stems.filter(function (q) { return q !== st; }); await delStem(st.id); dropFromLibrary(st); loadedSongId = null; if (project().tracksMode) await loadSong(s); PP.persistNow(); renderEditor(); render(); return; }
    if (f === "name") st.name = e.target.value; else if (f === "role") { st.role = e.target.value; setStem(st.id, "role", st.role); } else if (f === "bus") { st.bus = e.target.value; setStem(st.id, "bus", st.bus); }
    PP.persistSoon(); render();
  }
  async function tapFirstBeat() {
    var s = song(); if (!s) return; var t = data(s);
    // the playhead is on a downbeat right now: move the grid so a bar starts here
    var per = 60 / t.grid.bpm, bar = per * (t.grid.bpb || 4), first = state.pos; while (first - bar >= -0.02) first -= bar;
    t.grid.first = Math.max(0, first); t.grid.mode = "fitted"; gridCache.key = null; pushAll(s); PP.persistSoon(); renderEditor(); render();
    PP.setStatus("Bar 1 set to " + fmtTime(state.pos) + " (" + state.pos.toFixed(2) + " s)");
  }
  function meterText(t) { var segs = tempoSegments(t), m = segs.map(function (g) { return g.bpb + "/" + (g.bpb === 6 || g.bpb === 9 || g.bpb === 12 ? "8" : "4"); }); var out = [m[0]]; for (var i = 1; i < m.length; i++) if (m[i] !== out[out.length - 1]) out.push(m[i]); return out.join(" → ") + (segs.length > 1 && segs.some(function (g, i) { return i > 0 && Math.abs(g.bpm - segs[0].bpm) > 0.5 || g.ritTo; }) ? " · tempo changes" : ""); }
  // the flow in the song editor
  function renderFlowEditor(s, t) {
    var root = $("#seFlow"); if (!root) return;
    var secs = sectionsOf(s), byId = {}; secs.forEach(function (x) { byId[x.sec.id] = x; });
    var ids = (t.flow || []).filter(function (id) { return byId[id]; });
    $("#seFlowOn").checked = !!t.flowOn;
    root.innerHTML = ids.length ? ids.map(function (id, i) { return '<span class="fl-item" data-fi="' + i + '">' + esc(byId[id].sec.name) + '<button data-fe="up" title="Earlier">▲</button><button data-fe="down" title="Later">▼</button><button data-fe="del" title="Remove">✕</button></span>'; }).join("") : '<p class="muted small">' + (secs.length ? "Song order (" + secs.map(function (x) { return x.sec.name; }).join(" · ") + "). Add sections below to build an arrangement, e.g. an extra chorus." : "Mark sections first.") + "</p>";
    $("#seFlowAdd").innerHTML = '<option value="">+ Add a section to the flow…</option>' + secs.map(function (x) { return '<option value="' + esc(x.sec.id) + '">' + esc(x.sec.name) + " (bar " + x.sec.bar + ")</option>"; }).join("");
  }
  function flowEditorEdit(e) {
    var s = song(), t = s && data(s); if (!t) return;
    var b = e.target.closest("[data-fe]"), item = e.target.closest("[data-fi]"); if (!b || !item) return;
    var i = Number(item.dataset.fi), f = b.dataset.fe; t.flow = (t.flow || []).slice();
    if (f === "del") t.flow.splice(i, 1); else if (f === "up" && i > 0) { var a = t.flow[i - 1]; t.flow[i - 1] = t.flow[i]; t.flow[i] = a; } else if (f === "down" && i < t.flow.length - 1) { var c = t.flow[i + 1]; t.flow[i + 1] = t.flow[i]; t.flow[i] = c; }
    if (!t.flow.length) t.flowOn = false;
    PP.persistSoon(); renderFlowEditor(s, t); flowRelocate(s, state.flowIndex); render();
  }
  // tempo & meter changes (the tempo map) in the song editor
  function renderTempoMap(s, t) {
    var el = $("#seTempoMap"); if (!el) return;
    var map = (t.tempoMap || []).slice().sort(function (a, b) { return a.bar - b.bar; });
    el.innerHTML = map.length ? map.map(function (m, i) {
      return '<div class="tm-row" data-tm-row="' + i + '"><label>From bar<input type="number" min="1" max="999" step="1" data-tm="bar" value="' + (m.bar || 1) + '"></label>' +
        '<label>BPM<input type="number" min="20" max="300" step="0.1" data-tm="bpm" value="' + (m.bpm || t.grid.bpm) + '"></label>' +
        '<label>Beats per bar<select data-tm="bpb">' + [2, 3, 4, 5, 6, 7, 9, 12].map(function (n) { return '<option value="' + n + '"' + ((m.bpb || t.grid.bpb) === n ? " selected" : "") + ">" + n + "/" + (n === 6 || n === 9 || n === 12 ? "8" : "4") + "</option>"; }).join("") + "</select></label>" +
        '<label>Slow to<input type="number" min="0" max="300" step="1" data-tm="ritTo" value="' + (m.ritTo || "") + '" placeholder="— BPM"></label><label>over<input type="number" min="0" max="64" step="1" data-tm="ritBars" value="' + (m.ritBars || "") + '" placeholder="bars"></label>' +
        '<button data-tm="del" title="Remove this change">✕</button></div>';
    }).join("") : '<p class="muted small">No changes - the whole song is ' + Math.round(t.grid.bpm) + " BPM in " + (t.grid.bpb || 4) + "/4.</p>";
  }
  function tempoMapEdit(e) {
    var s = song(), t = s && data(s); if (!t) return;
    var el = e.target, row = el.closest("[data-tm-row]"), i = row ? Number(row.dataset.tmRow) : -1, f = el.dataset.tm; if (!f) return;
    t.tempoMap = (t.tempoMap || []).slice().sort(function (a, b) { return a.bar - b.bar; });
    if (f === "del") { t.tempoMap.splice(i, 1); }
    else if (t.tempoMap[i]) {
      var m = t.tempoMap[i], v = Number(el.value);
      if (f === "bar") m.bar = clamp(Math.round(v) || 1, 1, 999); else if (f === "bpm") m.bpm = clamp(v || t.grid.bpm, 20, 300); else if (f === "bpb") m.bpb = clamp(Math.round(v) || 4, 1, 12);
      else if (f === "ritTo") m.ritTo = v > 0 ? clamp(v, 20, 300) : 0; else if (f === "ritBars") m.ritBars = clamp(Math.round(v) || 0, 0, 64);
      if (m.ritTo && !m.ritBars) m.ritBars = 2;
    }
    if (f === "del" || e.type === "change") { PP.persistSoon(); gridCache.key = null; pushAll(s); renderTempoMap(s, t); renderEditor(); render(); }
  }
  function tempoMapAdd() {
    var s = song(), t = s && data(s); if (!t) return;
    var last = (t.tempoMap || []).reduce(function (m, x) { return Math.max(m, x.bar); }, 0), cur = timeToBar(s, state.pos).bar;
    (t.tempoMap = t.tempoMap || []).push({ bar: Math.max(cur, last + 1, 2), bpm: t.grid.bpm, bpb: t.grid.bpb || 4, ritBars: 0, ritTo: 0 });
    PP.persistSoon(); gridCache.key = null; pushAll(s); renderTempoMap(s, t); render();
  }
  // "Is this right?": the runner-up tempo and key guesses from the analysis, one tap to use one of them
  function renderGuesses(s, t) {
    var el = $("#seGuesses"); if (!el) return;
    var a = t.analysis; if (!a) { el.innerHTML = ""; return; }
    var cur = Math.round(t.grid.bpm * 10) / 10, out = [];
    var tempos = [];
    function near(b) { return tempos.some(function (x) { return Math.abs(x - b) < 1.5; }); }
    [cur / 2, cur * 2].forEach(function (b) { b = Math.round(b); if (b >= 40 && b <= 240) tempos.push(b); });  // half / double time first: the usual mistakes
    (a.tempoCandidates || []).forEach(function (c) { if (!near(c.bpm) && Math.abs(c.bpm - cur) > 1.5) tempos.push(c.bpm); });
    tempos = tempos.filter(function (b) { return Math.abs(b - cur) > 1.5; }).slice(0, 5);
    if (tempos.length) out.push('<span class="muted">Not the right tempo?</span>' + tempos.map(function (b) { return '<button class="chip" data-guess-bpm="' + b + '" title="Re-fit the beat grid at this tempo">' + b + (Math.abs(b - cur / 2) < 1.5 ? " (half time)" : Math.abs(b - cur * 2) < 1.5 ? " (double time)" : "") + "</button>"; }).join(""));
    var keys = (a.keyCandidates || []).filter(function (k) { return !(k.key === (t.originalKey || a.key) && k.mode === (t.originalMode || a.mode)); }).slice(0, 3);
    if (keys.length) out.push('<span class="muted">Not the right key?</span>' + keys.map(function (k) { return '<button class="chip" data-guess-key="' + k.key + '" data-guess-mode="' + k.mode + '" title="Use this as the key the tracks were recorded in">' + keyName(k.key) + " " + k.mode + "</button>"; }).join(""));
    el.innerHTML = out.length ? out.map(function (r) { return '<div class="se-row se-guess">' + r + "</div>"; }).join("") : "";
  }
  async function useGuess(bpm, key, mode) {
    var s = song(), t = s && data(s); if (!t) return;
    if (bpm) {
      $("#seAnalysis").textContent = "Re-fitting…";
      try { await analyzeSong(s, null, function (m) { $("#seAnalysis").textContent = m; }, { bpm: bpm }); } catch (error) { PP.setStatus("Could not re-fit: " + error.message); }
      PP.setStatus("Tempo set to " + bpm + " BPM; beat grid, sections and click re-fitted.");
    } else if (key) {
      // the original key changes but the song keeps playing in the key it is set to, so the pitch shift is recomputed
      t.originalKey = key; t.originalMode = mode; if (t.analysis) { t.analysis.key = key; t.analysis.mode = mode; }
      if (t.keyShift === 0) s.key = key; else { var d = ((PP.noteIndex(s.key) - PP.noteIndex(key)) % 12 + 12) % 12; if (d > 6) d -= 12; t.keyShift = d; post({ cmd: "set", pitch: Math.pow(2, t.keyShift / 12) }); }
      PP.setStatus("The tracks are in " + keyName(key) + " " + mode + " now.");
    }
    PP.persistSoon(); renderEditor(); renderTransport();
  }
  async function reanalyze() { var s = song(); if (!s) return; $("#seAnalysis").textContent = "Analyzing…"; try { await analyzeSong(s, null, function (m) { $("#seAnalysis").textContent = m; }); } catch (error) { PP.setStatus("Analysis failed: " + error.message); } gridCache.key = null; pushAll(s); renderEditor(); render(); }

  // ------------------------------------------------------------- wire up
  function wire() {
    var root = $("#tabTracks"); if (!root) return;
    $("#trUseTracks").addEventListener("click", function () { setTracksMode(!project().tracksMode); });
    $("#trPlay").addEventListener("click", togglePlay); $("#trStop").addEventListener("click", function () { stop(false); });
    $("#trStartOver").addEventListener("click", startOver); $("#trLoop").addEventListener("click", toggleLoop);
    $("#trPrevSec").addEventListener("click", prevSection); $("#trNextSec").addEventListener("click", nextSection); $("#trRestartSec").addEventListener("click", restartSection);
    $("#trKeyDown").addEventListener("click", function () { shiftKey(-1); }); $("#trKeyUp").addEventListener("click", function () { shiftKey(1); });
    $("#trTempoDown").addEventListener("click", function () { setTempoPercent((tdata() ? tdata().tempoPercent : 100) - 2); }); $("#trTempoUp").addEventListener("click", function () { setTempoPercent((tdata() ? tdata().tempoPercent : 100) + 2); });
    $("#trTempoVal").addEventListener("click", function () { setTempoPercent(100); });
    $("#trPrevSong").addEventListener("click", function () { F.stepSong(-1); }); $("#trNextSong").addEventListener("click", function () { F.stepSong(1); });
    $("#trCountIn").addEventListener("click", function () { var t = tdata(); if (!t) return; t.countIn = (t.countIn + 1) % 3; PP.persistSoon(); renderTransport(); });
    $("#trClick").addEventListener("click", function () { var t = tdata(); if (!t) return; t.click.on = !t.click.on; pushAll(song()); PP.persistSoon(); renderTransport(); });
    $("#trCues").addEventListener("click", function () { var t = tdata(); if (!t) return; t.cues.on = !t.cues.on; pushAll(song()); PP.persistSoon(); renderTransport(); });
    $("#trLink").addEventListener("click", function () { var p = project(); p.link = p.link || {}; p.link.enabled = !p.link.enabled; PP.persistSoon(); send({ type: "link", enabled: p.link.enabled, bpm: song() ? song().bpm : p.tempo.bpm, playing: state.playing }); renderTransport(); });
    $("#trSnap").addEventListener("click", function (e) { e.currentTarget.classList.toggle("on"); });
    $("#trEdit").addEventListener("click", openEditor);
    $("#trSongSelect").addEventListener("change", function (e) { F.loadSong(Number(e.target.value)); });
    $("#trNewSong").addEventListener("click", function (e) { if (window.PPSources) { e.stopImmediatePropagation(); window.PPSources.open(); return; } });
    $("#trNewSong").addEventListener("click", async function () { var name = await PP.ask("Song name", { value: "New song", ok: "Add song" }); if (name === null) return; newSong(name.trim() || "New song"); F.loadSong(project().songs.length - 1); openEditor(); });
    $("#trSetlist").addEventListener("click", function () { $("#setlistButton").click(); });
    $("#trSections").addEventListener("click", function (e) { var b = e.target.closest("[data-sec]"); if (!b) return; if (queueArmed) { queueArmed = false; queueSection(Number(b.dataset.sec)); return; } if (holdFired) { holdFired = false; return; } goSection(Number(b.dataset.sec)); });
    var holdTimer = null, holdFired = false;  // hold a section ~ half a second: play it next
    $("#trSections").addEventListener("pointerdown", function (e) { var b = e.target.closest("[data-sec]"); if (!b) return; clearTimeout(holdTimer); holdFired = false; holdTimer = setTimeout(function () { holdFired = true; queueSection(Number(b.dataset.sec)); }, 550); });
    ["pointerup", "pointerleave", "pointercancel"].forEach(function (ev) { $("#trSections").addEventListener(ev, function () { clearTimeout(holdTimer); }); });
    $("#trFlow").addEventListener("click", function (e) {
      var b = e.target.closest("[data-fl],[data-fl-i]"); if (!b) return;
      if (b.dataset.fl === "toggle") setFlowOn(!flowActive(song()));
      else if (b.dataset.fl === "repeat") flowRepeat(); else if (b.dataset.fl === "skip") flowSkip();
      else if (b.dataset.fl === "queue") { queueArmed = !queueArmed; renderFlow(); PP.setStatus(queueArmed ? "Tap the section that should play next" : ""); }
      else if (b.dataset.flI != null) { var i = Number(b.dataset.flI), list = flowEntries(song()); if (list[i]) { state.flowIndex = i; goSection(list[i].index); armFlow(song()); renderFlow(); } }
    });
    $("#trSections").addEventListener("contextmenu", function (e) { var b = e.target.closest("[data-sec]"); if (b) { e.preventDefault(); var i = Number(b.dataset.sec); setLoop(state.loop === i ? -1 : i); } });
    var pressTimer = null;
    $("#trSections").addEventListener("pointerdown", function (e) { var b = e.target.closest("[data-sec]"); if (!b) return; pressTimer = setTimeout(function () { pressTimer = null; var i = Number(b.dataset.sec); setLoop(state.loop === i ? -1 : i); if (navigator.vibrate) navigator.vibrate(20); }, 650); });
    ["pointerup", "pointercancel", "pointerleave"].forEach(function (t) { $("#trSections").addEventListener(t, function () { clearTimeout(pressTimer); }); });
    root.addEventListener("click", function (e) { var b = e.target.closest("[data-tr]"); if (!b) return; if (b.dataset.tr === "edit") openEditor(); if (b.dataset.tr === "autoSections") { autoSections(song()); pushAll(song()); render(); } });
    [$("#trStems"), $("#mixStrips")].filter(Boolean).forEach(function (root) { bindStrips(root); });
    if ($("#trMixer")) $("#trMixer").addEventListener("click", openMixer);
    var lastChanKey = null; F.on("systemStatus", function (m) { var k = m && m.audio && m.audio.channels ? m.audio.channels.join("|") : ""; if (k !== lastChanKey) { lastChanKey = k; setTimeout(function () { applyDirectOuts(); renderStems(); }, 0); } });
    var c = $("#trTimeline"); ["pointerdown", "pointermove", "pointerup", "pointercancel"].forEach(function (t) { c.addEventListener(t, timelinePointer); });
    root.addEventListener("input", function (e) { if (e.target.dataset.trlevel) { setLevel(e.target.dataset.trlevel, Number(e.target.value)); e.target.parentNode.querySelector("output").textContent = Math.round(Number(e.target.value) * 100) + "%"; } });
    // editor dialog
    var d = $("#songDialog");
    d.addEventListener("change", function (e) { if (e.target.dataset.se) editorField(e); else if (e.target.dataset.secf) editorSection(e); else if (e.target.dataset.sef) editorStem(e); });
    d.addEventListener("input", function (e) { if (e.target.dataset.secf === "lyrics" || e.target.dataset.secf === "name" || e.target.dataset.secf === "note") editorSection(e); });
    d.addEventListener("click", function (e) { if (e.target.dataset.secf) editorSection(e); else if (e.target.dataset.sef === "del") editorStem(e); });
    $("#seAddSection").addEventListener("click", function () { var s = song(), t = data(s); t.sections.push({ id: PP.id(), name: "Section " + (t.sections.length + 1), bar: timeToBar(s, state.pos).bar, pad: -1, transition: "inherit", cue: "auto", lyrics: "", page: 0 }); gridCache.key = null; pushAll(s); PP.persistSoon(); renderEditor(); render(); });
    $("#seAutoSections").addEventListener("click", function () { autoSections(song()); pushAll(song()); renderEditor(); render(); });
    $("#seClearSections").addEventListener("click", function () { if (confirm("Remove all sections?")) { data(song()).sections = []; pushAll(song()); PP.persistSoon(); renderEditor(); render(); } });
    $("#seAnalyze").addEventListener("click", reanalyze);
    $("#seTempoMap").addEventListener("change", tempoMapEdit); $("#seTempoMap").addEventListener("click", function (e) { if (e.target.dataset.tm === "del") tempoMapEdit(e); });
    $("#seTempoAdd").addEventListener("click", tempoMapAdd);
    $("#seFlow").addEventListener("click", flowEditorEdit);
    $("#seFlowAdd").addEventListener("change", function () { var s = song(), t = s && data(s); if (!t || !this.value) return; if (!t.flow || !t.flow.length) t.flow = sectionsOf(s).map(function (x) { return x.sec.id; }); t.flow.push(this.value); this.value = ""; PP.persistSoon(); renderFlowEditor(s, t); flowRelocate(s, state.flowIndex); render(); });
    $("#seFlowReset").addEventListener("click", function () { flowReset(); var s = song(); if (s) renderFlowEditor(s, data(s)); render(); });
    $("#seFlowOn").addEventListener("change", function () { setFlowOn(this.checked); var s = song(); if (s) renderFlowEditor(s, data(s)); });
    $("#seGuesses").addEventListener("click", function (e) { var b = e.target.closest("button"); if (!b) return; if (b.dataset.guessBpm) useGuess(Number(b.dataset.guessBpm)); else if (b.dataset.guessKey) useGuess(0, b.dataset.guessKey, b.dataset.guessMode); }); $("#seTapFirst").addEventListener("click", tapFirstBeat);
    $("#seNudgeBack").addEventListener("click", function () { var t = tdata(); t.grid.first = Math.max(0, (t.grid.first || 0) - .01); t.grid.mode = "fitted"; gridCache.key = null; pushAll(song()); renderEditor(); });
    $("#seNudgeFwd").addEventListener("click", function () { var t = tdata(); t.grid.first = (t.grid.first || 0) + .01; t.grid.mode = "fitted"; gridCache.key = null; pushAll(song()); renderEditor(); });
    $("#seStemFiles").addEventListener("change", async function (e) { var files = Array.from(e.target.files || []); e.target.value = ""; if (!files.length) return; $("#songDialog").close(); await importFilesIntoSong(song(), files); openEditor(); });
    $("#seAddStems").addEventListener("click", function () { if (driverOn()) { $("#songDialog").close(); F.openUsb(async function (paths) { var files = []; for (var i = 0; i < paths.length; i++) { if (/\.(wav|mp3|flac|ogg|oga|m4a|aac|aif|aiff|opus)$/i.test(paths[i])) files.push(await fileFromMedia(paths[i])); } if (files.length) await importFilesIntoSong(song(), files); openEditor(); }); } else $("#seStemFiles").click(); });
    $("#seAddFile").addEventListener("click", function () { $("#seStemFiles").click(); });
    $("#seHitClear").addEventListener("click", function () { var t = tdata(); t.hits = []; t.autoHits = false; pushEvents(song()); PP.persistSoon(); renderEditor(); drawTimeline(); });
    $("#seHitAdd").addEventListener("click", function () { var t = tdata(); t.hits.push(Math.round(state.pos * 1000) / 1000); t.hits.sort(function (a, b) { return a - b; }); t.autoHits = false; pushEvents(song()); PP.persistSoon(); renderEditor(); drawTimeline(); });
    $("#seChartUpload").addEventListener("click", function () { $("#chartFile").click(); });
    $("#chartFile").addEventListener("change", async function (e) { var file = e.target.files[0]; e.target.value = ""; if (!file) return; await uploadChart(file); });
    $("#seChartText").addEventListener("click", async function () { var text = await PP.ask("Paste the chord chart or lyrics (section names like [Chorus] on their own line; chords above the words or in [brackets]):", { multiline: true, ok: "Use this chart", placeholder: "[Verse 1]\nG        D\nAmazing grace how sweet the sound\n\n[Chorus]\n..." }); if (!text || !text.trim()) return; await textChart(song().name, text); });
    $("#seDeleteSong").addEventListener("click", async function () { var s = song(); if (!s || !confirm("Delete \"" + s.name + "\" and its tracks?")) return; var t = data(s); for (var i = 0; i < t.stems.length; i++) { await delStem(t.stems[i].id); dropFromLibrary(t.stems[i]); } var p = project(); p.songs = p.songs.filter(function (q) { return q !== s; }); p.songIndex = Math.min(p.songIndex, p.songs.length - 1); $("#songDialog").close(); F.loadSong(p.songIndex); PP.persistNow(); });
    $("#seCueTest").addEventListener("click", function () { say("chorus"); });
    $("#seCueRecord").addEventListener("click", openCueDialog);
    $("#cueRecBtn").addEventListener("click", cueRecordToggle); $("#cuePlayBtn").addEventListener("click", function () { cuePlayBuffer(rec.buffer); }); $("#cueSaveBtn").addEventListener("click", cueSave);
    $("#cueWord").addEventListener("input", function () { $("#cueSaveBtn").disabled = !(rec.buffer && cueWordId(this.value)); });
    $("#cueCustomList").addEventListener("click", async function (e) { var b = e.target.closest("button"); if (!b) return; if (b.dataset.cuePlay) { delete cueBuffers[b.dataset.cuePlay]; say(b.dataset.cuePlay); } else if (b.dataset.cueDel) cueDelete(b.dataset.cueDel); });
    document.addEventListener("keydown", function (e) {
      if ((e.target.matches && e.target.matches("input,select,textarea")) || e.repeat || e.ctrlKey || e.metaKey) return;
      if (!project().tracksMode || !$("#tabTracks") || $("#tabTracks").classList.contains("hidden")) return;
      var k = e.key;
      if (k === " ") { e.preventDefault(); togglePlay(); } else if (k === "ArrowRight") { e.preventDefault(); nextSection(); } else if (k === "ArrowLeft") { e.preventDefault(); prevSection(); } else if (k.toLowerCase() === "r") { e.preventDefault(); toggleLoop(); } else if (k === "Home") { e.preventDefault(); startOver(); } else if (k === "+" || k === "=") { shiftKey(1); } else if (k === "-" || k === "_") { shiftKey(-1); }
    });
    window.addEventListener("resize", drawTimeline);
    document.body.classList.toggle("tracks-mode", !!project().tracksMode);
  }
  async function uploadChart(file) {
    if (!driverOn()) { if (/\.(txt|cho|chopro|crd|pro|lrc)$/i.test(file.name)) { await textChart(file.name.replace(/\.[^.]+$/, ""), await file.text()); return; } PP.setStatus("PDF charts are processed on the Central Pedal itself (or upload them over Wi-Fi)."); return; }
    PP.setStatus("Uploading " + file.name + "…");
    try { var r = await fetch(MEDIA + "/upload?kind=charts&name=" + encodeURIComponent(file.name) + "&song=" + encodeURIComponent(song() ? song().name : ""), { method: "PUT", body: file }); var j = await r.json(); if (j.chart) { await refreshCharts(); await applyChart(song(), j.chart); renderEditor(); PP.setStatus("Chart added: " + j.chart.name); } else PP.setStatus(j.error || "Chart upload failed"); } catch (error) { PP.setStatus("Chart upload failed: " + error.message); }
  }
  async function textChart(name, text) {
    if (driverOn()) { try { var r = await fetch(MEDIA + "/chart/text", { method: "POST", body: JSON.stringify({ name: name, text: text }) }); var j = await r.json(); if (j.id) { await refreshCharts(); await applyChart(song(), j); renderEditor(); return; } } catch (_) { } }
    // no driver: parse the sections and lyrics here (no page images)
    var secs = [], cur = null;
    text.split("\n").forEach(function (line) { var m = line.match(/^\s*[\[\(]?\s*(intro|verse|pre[- ]?chorus|chorus|bridge|tag|outro|ending|interlude|instrumental|turnaround|vamp|refrain|hook)\s*([0-9]+|[a-d])?\s*[\]\)]?\s*:?\s*$/i); if (m) { cur = { name: m[1].replace(/\b\w/g, function (c) { return c.toUpperCase(); }) + (m[2] ? " " + m[2].toUpperCase() : ""), lines: [] }; secs.push(cur); return; } var clean = line.replace(/\[[^\]]*\]/g, "").trim(); if (!clean) return; var toks = clean.split(/\s+/), chordy = toks.filter(function (t) { return /^[A-G](#|b)?(m|maj|min|dim|aug|sus|add)?[0-9]*(\/[A-G](#|b)?)?$/.test(t); }).length; if (chordy / toks.length >= .7) return; if (!cur) { cur = { name: "Verse 1", lines: [] }; secs.push(cur); } cur.lines.push(clean); });
    await applyChart(song(), { id: null, name: name, pageCount: 1, sections: secs, key: null, bpm: null });
    renderEditor();
  }

  // ------------------------------------------------------------- link + status from the driver
  var linkStatus = { peers: 0 };
  F.on("linkStatus", function (m) { linkStatus = m; renderTransport(); });
  F.on("linkTransport", function (m) { if (project().link && project().link.enabled && isActive()) { if (m.playing && !state.playing) play({ countIn: false }); else if (!m.playing && state.playing) pause(); } });
  F.on("hello", function () { loadCueList().then(function () { preloadCountVoice(); }); refreshCharts().then(render); if (project().link && project().link.enabled) send({ type: "link", enabled: true, bpm: song() ? song().bpm : project().tempo.bpm, playing: state.playing }); sendDisplay(); });

  // public
  window.PPTracks = { addClickSet: addClickSet, clickSets: clickSets,
    state: state, song: song, data: data, grid: grid, pushAll: pushAll, beatsInBar: beatsInBar, flowEntries: flowEntries, flowActive: flowActive, setFlowOn: setFlowOn, queueSection: queueSection, flowRepeat: flowRepeat, flowSkip: flowSkip, flowReset: flowReset, armQueue: function () { queueArmed = !queueArmed; renderFlow(); }, sectionsOf: sectionsOf, sectionAt: sectionAt, timeToBar: timeToBar, barStart: barStart,
    play: play, pause: pause, stop: stop, togglePlay: togglePlay, seek: seek, goSection: goSection, nextSection: nextSection, prevSection: prevSection, restartSection: restartSection, startOver: startOver,
    toggleLoop: toggleLoop, setLoop: setLoop, shiftKey: shiftKey, setTempoPercent: setTempoPercent, setTracksMode: setTracksMode, isPlaying: function () { return state.playing; }, isActive: isActive,
    setLevel: setLevel, levels: levels, balance: balance, lyricsStep: lyricsStep, lyricsState: lyricsState, say: say, importFilesIntoSong: importFilesIntoSong, newSong: newSong, openEditor: openEditor,
    sendDisplay: sendDisplay, render: render, setStem: setStem, toggleClick: function () { var t = tdata(); if (t) { t.click.on = !t.click.on; pushAll(song()); PP.persistSoon(); renderTransport(); } }, toggleCues: function () { var t = tdata(); if (t) { t.cues.on = !t.cues.on; pushAll(song()); PP.persistSoon(); renderTransport(); } },
    cycleCountIn: function () { var t = tdata(); if (t) { t.countIn = (t.countIn + 1) % 3; PP.persistSoon(); renderTransport(); } }, stepSongAndPlay: stepSongAndPlay, uploadChart: uploadChart, refreshCharts: refreshCharts, charts: function () { return charts; }, applyLevels: applyLevels,
    findSongByName: findSongByName, fileFromMedia: fileFromMedia, workerJob: workerJob, mixdown: mixdown, getStem: getStem, forgetStem: function (id) { stemMemory.delete(id); }, dropStem: delStem, setOut: setOut, outLevel: function () { return outLevel; }, putStem: putStem, getStemLocal: getStemLocal, decodeFile: decodeFile, toPcm: toPcm, decodeSum: decodeSum, driverOn: function () { return driverOn(); }, analyzeSong: analyzeSong, applyChart: applyChart, renderEditor: renderEditor, keyName: keyName, fmtTime: fmtTime, pendingJump: function () { return pendingJump; },
    hubSong: hubSong, cueIdFor: cueIdFor, cueBuffer: cueBuffer, loadCueList: loadCueList, drumNote: drumNote, DRUMS: DRUMS, netDecks: function () { return decks; }, netNames: function () { return deck && deck.netNames || []; }, netPans: function () { return deck && deck.netPans || []; }, ensureWorklet: ensureWorklet, NET_SLOTS: NET_SLOTS,
    abSet: abSet, abToggle: abToggle, abClear: abClear, nudgeTempo: nudgeTempo, applyMix: applyMix, captureMix: captureMix, openMixer: openMixer, renderStems: renderStems, startSegue: startSegue, preloadNext: preloadNext, segueState: function () { return { loading: segue.loading, running: segue.running, deck: deck ? deck.n : -1, other: otherDeck() ? otherDeck().songId : null }; }, meters: function () { return meters; }, afterMode: afterMode, currentSection: function () { return state.section; }
  };
  engine.hooks.push(function () { applyLevels(); });
  wire();
  render();
  setTimeout(function () { if (song() && data(song()).stems.length && project().tracksMode) loadSong(song()).catch(function () { }); sendDisplay(); }, 800);
})();
