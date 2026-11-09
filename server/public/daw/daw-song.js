/* The DAW - whole-song tools (10.6), used by Central Production's Track projects (and anything else that loads it):
 *
 *   sections         CDawSong.sections() -> [{ id, name, beat, end, color }]   (the markers on the ruler, with where each ends)
 *   rearrange        CDawSong.arrange(order) - the song rebuilt in a new order of sections (a section can repeat): every
 *                    clip, note and automation point in a section goes with it. duplicate(id) / remove(id) / move(id, ±1).
 *   key and tempo    CDawSong.changeKeyTempo(key, bpm, { audio }) - MIDI transposed (not drums), audio re-pitched and
 *                    stretched from its original (drums keep their pitch), everything stays on its beat.
 *   click and guide  CDawSong.clickBuffer(end) / guideBuffer(end) -> AudioBuffer (the guide: Motion Audio's spoken cues,
 *                    "Chorus" a bar before each section); makeClickAndGuide() puts them on their own tracks.
 *   Central Pedal    CDawSong.markersMidi() -> Uint8Array (the sections + tempo as MIDI markers, what the pedal reads);
 *                    pedalPack({ title, artist, roles, chart, song }) -> { name, zip, files, mix, grade }
 *   loudness         CDawSong.loudness(audioBuffer) -> { integrated, shortMax, momentaryMax, truePeak, range } (EBU R128 /
 *                    ITU-R BS.1770-4); grade(audioBuffer) -> { stars, checks } - the Motion Audio website's Central Tracks
 *                    grade, worked out here before an upload; meter() - a live loudness meter on the master.
 * Times are in beats; the renders start 20 ms in (as the DAW's do), so everything here does too. */
(function () {
  "use strict";
  var D = window.CDaw; if (!D) return;
  var LEAD = 0.02;
  function P() { return D.project(); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

  // ------------------------------------------------------------- sections
  function sections() {
    var m = (P().markers || []).slice().sort(function (a, z) { return a.beat - z.beat; });
    var end = Math.max(D.songEnd(), m.length ? m[m.length - 1].beat + D.tempo.bpb(m[m.length - 1].beat) * 4 : 0);
    return m.map(function (x, i) { return { id: x.id, name: x.name, beat: x.beat, end: i + 1 < m.length ? m[i + 1].beat : end, color: x.color }; });
  }

  // the part of a clip inside [a, b), placed at `dest` (or null)
  function slice(c, a, b, dest) {
    var c0 = c.start, c1 = c.start + c.len, s = Math.max(c0, a), e = Math.min(c1, b);
    if (e - s < 1e-6) return null;
    var r = clone(c); r.id = D.uid("c"); r.start = dest + (s - a); r.len = e - s; delete r.takes;
    if (c.kind === "audio" && r.audio) {
      r.audio.offset = (c.audio.offset || 0) + D.tempo.beatToSec(s) - D.tempo.beatToSec(c0);
      if (r.audio.warp && r.audio.warp.off0 != null) r.audio.warp.off0 = r.audio.warp.off0 + (D.tempo.beatToSec(s) - D.tempo.beatToSec(c0)) * (r.audio.warp.at || 1) / (r.audio.warp.from || r.audio.warp.at || 1);
      if (s > c0 + 1e-6) r.audio.fadeIn = 0.004;
      if (e < c1 - 1e-6) r.audio.fadeOut = 0.008;
    } else {
      var L = c.loopLen && c.loopLen > 0 ? c.loopLen : null, notes = [];
      if (L) { for (var k = 0; k * L < c.len; k++) (c.notes || []).forEach(function (n) { if (n.s < L) notes.push(Object.assign({}, n, { s: n.s + k * L })); }); notes = notes.filter(function (n) { return n.s < c.len; }); }
      else notes = (c.notes || []).map(function (n) { return Object.assign({}, n); });
      var off = s - c0;
      r.notes = notes.filter(function (n) { return n.s >= off - 1e-6 && n.s < off + r.len - 1e-6; }).map(function (n) { return Object.assign(n, { s: n.s - off, d: Math.min(n.d, r.len - (n.s - off)) }); });
      delete r.loopLen;
    }
    return r;
  }
  function autoSlice(list, a, b, dest) {
    if (!list || !list.length) return [];
    var at = function (beat) { return D.autoAt(list, beat); };
    var out = [{ b: dest, v: at(a) }];
    list.forEach(function (pt) { if (pt.b > a + 1e-6 && pt.b < b - 1e-6) out.push({ b: dest + pt.b - a, v: pt.v }); });
    out.push({ b: dest + (b - a) - 1e-3, v: at(b - 1e-3) });
    return out;
  }

  /** order: section ids (repeats allowed). Returns { map: { newMarkerId: sourceMarkerId } }. */
  function arrange(order, label) {
    var p = P();
    if ((p.tempos || []).length || (p.sigs || []).length) throw new Error("Moving sections around needs one tempo and one time signature for the whole song (this one changes).");
    var secs = sections(), by = {}; secs.forEach(function (s) { by[s.id] = s; });
    order = order.filter(function (id) { return by[id]; });
    if (!order.length) throw new Error("There are no sections to arrange.");
    var map = {}, used = {};
    D.edit(label || "Rearrange sections", function (q) {
      var lead = secs[0].beat, songEnd = Math.max(D.songEnd(), secs[secs.length - 1].end);
      var plan = [];   // [from, to, dest]
      var at = 0;
      if (lead > 1e-6) { plan.push([0, lead, 0]); at = lead; }
      var markers = [];
      order.forEach(function (id) {
        var s = by[id], len = s.end - s.beat, mid = used[id] ? D.uid("m") : id;
        used[id] = true; map[mid] = id;
        markers.push(Object.assign({}, (q.markers || []).filter(function (m) { return m.id === id; })[0] || {}, { id: mid, beat: at, name: s.name }));
        plan.push([s.beat, s.end, at]);
        at += len;
      });
      var lastSec = secs[secs.length - 1];
      if (songEnd > lastSec.end + 1e-6 && order.indexOf(lastSec.id) >= 0) plan.push([lastSec.end, songEnd, at]);   // a tail after the last section stays at the end
      q.tracks.forEach(function (t) {
        var clips = [];
        plan.forEach(function (pl) { t.clips.forEach(function (c) { var r = slice(c, pl[0], pl[1], pl[2]); if (r) clips.push(r); }); });
        t.clips = clips;
        var auto = {};
        Object.keys(t.auto || {}).forEach(function (k) {
          var pts = []; plan.forEach(function (pl) { pts = pts.concat(autoSlice(t.auto[k], pl[0], pl[1], pl[2])); });
          auto[k] = pts.sort(function (x, z) { return x.b - z.b; });
        });
        t.auto = auto;
      });
      q.markers = markers;
      if (q.loop && q.loop.end > at) q.loop = { on: q.loop.on, start: 0, end: Math.min(q.loop.end, at) };
    });
    return { map: map };
  }
  function orderNow() { return sections().map(function (s) { return s.id; }); }
  function duplicate(id) { var o = orderNow(), i = o.indexOf(id); if (i < 0) return null; o.splice(i + 1, 0, id); return arrange(o, "Duplicate section"); }
  function remove(id) { var o = orderNow(), i = o.indexOf(id); if (i < 0) return null; o.splice(i, 1); if (!o.length) throw new Error("That's the only section."); return arrange(o, "Delete section"); }
  function move(id, by) { var o = orderNow(), i = o.indexOf(id), j = i + by; if (i < 0 || j < 0 || j >= o.length) return null; o.splice(i, 1); o.splice(j, 0, id); return arrange(o, "Move section"); }

  // ------------------------------------------------------------- key and tempo
  var KEYS = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
  function rootOf(k) { var s = String(k || "C").replace(/m$/, "").replace("D#", "Eb").replace("G#", "Ab").replace("A#", "Bb").replace("Db", "C#").replace("Gb", "F#"); return Math.max(0, KEYS.indexOf(s)); }
  function majorRoot(k) { var r = rootOf(k); return /m$/.test(String(k || "")) ? (r + 3) % 12 : r; }
  function semitones(from, to) { var d = ((majorRoot(to) - majorRoot(from)) % 12 + 12) % 12; return d > 6 ? d - 12 : d; }
  function isDrums(t) { return t.kind === "drums" || /drum|kit|perc|kick|snare|hat|beat|loop/i.test(t.name || ""); }

  function changeKeyTempo(key, bpm, opts) {
    opts = opts || {};
    var p = P(), from = p.key, semis = semitones(from, key), oldBpm = p.bpm;
    bpm = clamp(+bpm || oldBpm, 30, 300);
    var ratio = bpm / oldBpm, audio = opts.audio !== false, notes = 0, clips = 0;
    D.edit("Key and tempo", function (q) {
      q.tracks.forEach(function (t) {
        var drums = isDrums(t);
        t.clips.forEach(function (c) {
          if (c.kind === "midi" && semis && !drums) (c.notes || []).forEach(function (n) { n.p = clamp(n.p + semis, 0, 127); notes++; });
          if (c.kind === "audio" && c.audio && audio) {
            var w = c.audio.warp;
            if (!w) { w = c.audio.warp = { from: D.tempo.bpmAt(c.start), key: drums ? null : from, orig: c.audio.src, semis: 0, at: D.tempo.bpmAt(c.start), off0: c.audio.offset || 0 }; }
            else if (!w.key && !drums && semis) w.want = (w.want != null ? w.want : (w.semis || 0)) + semis;   // (a clip already pitched by hand: from there)
            if (w.off0 == null) w.off0 = (c.audio.offset || 0) * (w.at || w.from) / (w.from || w.at);
            clips++;
          }
        });
      });
      (q.tempos || []).forEach(function (x) { x.bpm = clamp(x.bpm * ratio, 20, 400); });
      q.bpm = Math.round(bpm * 100) / 100;
      q.key = key;
    });
    if (D.rewarp()) D.fire("change", "rewarp");
    return { semis: semis, notes: notes, clips: clips, bpm: P().bpm, key: key };
  }

  // ------------------------------------------------------------- click, guide, markers
  function ctx() { return D.ctx(); }
  function makeBuffer(n, rate) { return new AudioBuffer({ numberOfChannels: 2, length: Math.max(1, n), sampleRate: rate }); }
  function clickBuffer(end, rate) {
    rate = rate || 48000; end = end || Math.ceil(D.songEnd());
    var n = Math.ceil((D.tempo.beatToSec(end) + 3 + LEAD) * rate), b = makeBuffer(n, rate), L = b.getChannelData(0), R = b.getChannelData(1);
    for (var k = 0; k < end; k++) {
      var at = Math.round((LEAD + D.tempo.beatToSec(k)) * rate), down = Math.abs(D.tempo.beatToBar(k).beat) < 1e-6, f = down ? 1600 : 1000;
      for (var i = 0; i < 0.03 * rate && at + i < n; i++) { var v = Math.sin(2 * Math.PI * f * i / rate) * Math.exp(-i / (0.006 * rate)) * 0.8; L[at + i] = v; R[at + i] = v; }
    }
    return b;
  }
  var CUES = ["1", "2", "3", "4", "5", "6", "7", "8", "acoustic", "again", "band-in", "band-out", "big", "breakdown", "bridge-2", "bridge", "build-it", "build", "chorus-2", "chorus", "coda", "count-in-3", "count-in", "double-chorus", "down", "drums-in", "drums-out", "end", "ending", "free-worship", "full-band", "go", "half-time", "hold", "hook", "instrumental", "interlude", "intro", "key-change", "last-time", "loop-off", "loop", "next-song", "one-more-time", "outro", "pads-only", "prayer", "pre-chorus", "quiet", "ready", "refrain", "repeat", "solo", "stop", "tag", "turnaround", "vamp", "verse-1", "verse-2", "verse-3", "verse-4", "verse", "vocals-only"];
  function cueFor(name) {
    var n = String(name || "").toLowerCase().trim().replace(/[_\s]+/g, "-").replace(/-+/g, "-");
    if (n === "prechorus") n = "pre-chorus";
    if (/^v\d$/.test(n)) n = "verse-" + n.slice(1);
    if (CUES.indexOf(n) >= 0) return n;
    var base = n.replace(/[-\d]+$/, "");
    return CUES.indexOf(base) >= 0 ? base : null;
  }
  var cueCache = {};
  function cueBase() { var s = document.querySelector('script[src*="daw-song.js"]'); return s ? s.src.replace(/daw-song\.js.*$/, "cues/") : "../daw/cues/"; }
  function loadCue(name) {
    if (!cueCache[name]) cueCache[name] = fetch(cueBase() + name + ".wav").then(function (r) { if (!r.ok) throw new Error("cue " + name); return r.arrayBuffer(); }).then(function (a) { return ctx().decodeAudioData(a); }).catch(function () { delete cueCache[name]; return null; });
    return cueCache[name];
  }
  /** The spoken guide: each section's name a bar before it starts (and "1 2 3 4" in the bar before the first one, when there's room). */
  function guideBuffer(end, rate) {
    rate = rate || 48000; end = end || Math.ceil(D.songEnd());
    var secs = sections(), jobs = [];
    secs.forEach(function (s, i) {
      var name = cueFor(s.name), per = D.tempo.bpb(s.beat);
      if (name && s.beat >= per - 1e-6) jobs.push({ name: name, beat: s.beat - per });
      if (i === 0 && s.beat >= per - 1e-6 && !name) for (var k = 0; k < Math.min(4, per); k++) jobs.push({ name: String(k + 1), beat: s.beat - per + k });
    });
    var n = Math.ceil((D.tempo.beatToSec(end) + 3 + LEAD) * rate), b = makeBuffer(n, rate);
    return Promise.all(jobs.map(function (j) { return loadCue(j.name); })).then(function (bufs) {
      var L = b.getChannelData(0), R = b.getChannelData(1);
      bufs.forEach(function (cue, i) {
        if (!cue) return;
        var at = Math.round((LEAD + D.tempo.beatToSec(jobs[i].beat)) * rate), src = cue.getChannelData(0), step = cue.sampleRate / rate, len = Math.floor(src.length / step);
        for (var k = 0; k < len && at + k < n; k++) { var x = k * step, a = Math.floor(x), f = x - a, v = ((src[a] || 0) * (1 - f) + (src[a + 1] || 0) * f) * 0.9; L[at + k] += v; R[at + k] += v; }
      });
      b.cues = jobs.length;
      return b;
    });
  }
  /** Click and Guide on their own tracks (made again from the sections each time), so you hear what the band will. */
  function makeClickAndGuide() {
    var end = Math.ceil(D.songEnd() || sections().reduce(function (a, s) { return Math.max(a, s.end); }, 0));
    if (!(end > 0)) return Promise.reject(new Error("Add sections or clips first."));
    return guideBuffer(end).then(function (g) {
      var click = clickBuffer(end), clickId = D.addAudio(trimLead(click)), guideId = D.addAudio(trimLead(g));
      D.edit("Click and guide", function (q) {
        function put(name, src, buf) {
          var t = q.tracks.filter(function (x) { return x.kind === "audio" && x.name === name && x.made; })[0];
          if (!t) { t = D.newTrack("audio", name); t.made = true; t.color = "#6E7680"; D.insertTrack(t); t = q.tracks[q.tracks.indexOf(t)] || t; }
          t.clips = [{ id: D.uid("c"), kind: "audio", start: 0, len: D.tempo.secToBeat(buf.duration), name: name, audio: { src: src, offset: 0, gain: 0, fadeIn: 0, fadeOut: 0.01 } }];
          return t;
        }
        put("Click", clickId, click).volume = -6;
        put("Guide (cues)", guideId, g).volume = -3;
      });
      return { cues: g.cues || 0 };
    });
  }
  function trimLead(b) {   // the DAW plays clips from their start: no 20 ms lead on a clip
    var skip = Math.round(LEAD * b.sampleRate), out = makeBuffer(b.length - skip, b.sampleRate);
    for (var c = 0; c < 2; c++) out.copyToChannel(b.getChannelData(c).subarray(skip), c);
    return out;
  }

  function vlq(n) { var bytes = [n & 0x7f]; while ((n >>= 7)) bytes.unshift((n & 0x7f) | 0x80); return bytes; }
  function markersMidi() {
    var p = P(), ppq = 960, ev = [];
    ev.push({ t: 0, d: [0xFF, 0x51, 3].concat([(6e7 / p.bpm) >> 16 & 255, (6e7 / p.bpm) >> 8 & 255, Math.round(6e7 / p.bpm) & 255]) });
    (p.tempos || []).forEach(function (x) { var us = Math.round(6e7 / x.bpm); ev.push({ t: Math.round(D.tempo.barToBeat(x.bar) * ppq), d: [0xFF, 0x51, 3, us >> 16 & 255, us >> 8 & 255, us & 255] }); });
    ev.push({ t: 0, d: [0xFF, 0x58, 4, p.sig[0], Math.round(Math.log2(p.sig[1])), 24, 8] });
    sections().forEach(function (s) { var txt = Array.from(new TextEncoder().encode(s.name)); ev.push({ t: Math.round(s.beat * ppq), d: [0xFF, 0x06].concat(vlq(txt.length), txt) }); });
    ev.sort(function (a, z) { return a.t - z.t; });
    var body = [], last = 0;
    ev.forEach(function (e) { body = body.concat(vlq(e.t - last), e.d); last = e.t; });
    body = body.concat([0, 0xFF, 0x2F, 0]);
    var head = [0x4D, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, ppq >> 8, ppq & 255], len = body.length;
    return new Uint8Array(head.concat([0x4D, 0x54, 0x72, 0x6B, len >>> 24 & 255, len >> 16 & 255, len >> 8 & 255, len & 255], body));
  }

  // ------------------------------------------------------------- loudness (ITU-R BS.1770-4)
  function kFilters(rate) {
    var f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196, K = Math.tan(Math.PI * f0 / rate), Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416), a0 = 1 + K / Q + K * K;
    var shelf = [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0];
    f0 = 38.13547087602444; Q = 0.5003270373238773; K = Math.tan(Math.PI * f0 / rate); a0 = 1 + K / Q + K * K;
    var hp = [1, -2, 1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0];
    return [shelf, hp];
  }
  function lufsOf(ms) { return ms > 1e-12 ? -0.691 + 10 * Math.log10(ms) : -120; }
  function loudness(buf) {
    var rate = buf.sampleRate, chans = Math.min(2, buf.numberOfChannels), n = buf.length, hop = Math.round(rate * 0.1), fs = kFilters(rate), hops = [];
    var energy = new Float64Array(Math.ceil(n / hop) + 1), peak = 0;
    for (var c = 0; c < chans; c++) {
      var x = buf.getChannelData(c), z = [0, 0, 0, 0];
      for (var i = 0; i < n; i++) {
        var v = x[i], s = fs[0], h = fs[1];
        var y1 = s[0] * v + z[0]; z[0] = s[1] * v - s[3] * y1 + z[1]; z[1] = s[2] * v - s[4] * y1;
        var y2 = h[0] * y1 + z[2]; z[2] = h[1] * y1 - h[3] * y2 + z[3]; z[3] = h[2] * y1 - h[4] * y2;
        energy[(i / hop) | 0] += y2 * y2;
        // true peak: the sample and three points between it and the next (cubic)
        var a = Math.abs(v); if (a > peak) peak = a;
        if (i > 0 && i + 2 < n) { var p0 = x[i - 1], p1 = v, p2 = x[i + 1], p3 = x[i + 2]; for (var k = 1; k < 4; k++) { var t = k / 4, iv = p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0))); if (Math.abs(iv) > peak) peak = Math.abs(iv); } }
      }
    }
    for (var j = 0; j < energy.length; j++) hops.push(energy[j] / hop);
    var blocks = [], shorts = [], mMax = -120, sMax = -120;
    for (var b = 3; b < hops.length; b++) { var m = (hops[b] + hops[b - 1] + hops[b - 2] + hops[b - 3]) / 4; blocks.push(m); mMax = Math.max(mMax, lufsOf(m)); }
    for (var s2 = 29; s2 < hops.length; s2++) { var sum = 0; for (var k2 = 0; k2 < 30; k2++) sum += hops[s2 - k2]; var st = sum / 30; shorts.push(st); sMax = Math.max(sMax, lufsOf(st)); }
    function gated(list, rel) {
      var abs = list.filter(function (e) { return lufsOf(e) > -70; }); if (!abs.length) return { value: -70, kept: [] };
      var mean = abs.reduce(function (a, e) { return a + e; }, 0) / abs.length, thr = lufsOf(mean) - rel, kept = abs.filter(function (e) { return lufsOf(e) > thr; });
      return { value: kept.length ? lufsOf(kept.reduce(function (a, e) { return a + e; }, 0) / kept.length) : -70, kept: kept };
    }
    var I = gated(blocks, 10).value, sg = gated(shorts, 20).kept.map(lufsOf).sort(function (a, z) { return a - z; });
    var lra = sg.length > 10 ? sg[Math.floor((sg.length - 1) * 0.95)] - sg[Math.floor((sg.length - 1) * 0.10)] : 0;
    return { integrated: Math.round(I * 10) / 10, momentaryMax: Math.round(mMax * 10) / 10, shortMax: Math.round(sMax * 10) / 10, truePeak: Math.round((peak > 1e-6 ? 20 * Math.log10(peak) : -120) * 10) / 10, range: Math.round(lra * 10) / 10 };
  }

  /** The website's grade for a Central Tracks upload (server/src/grade.js), on a 24-bit WAV of this buffer. */
  function grade(buf, bits) {
    bits = bits || 24;
    var checks = [], score = 5, rate = buf.sampleRate, chans = buf.numberOfChannels, n = buf.length;
    function add(ok, text, pen) { checks.push({ ok: ok, text: text }); if (!ok) score -= pen; }
    var secs = n / rate; checks.push({ ok: true, text: Math.floor(secs / 60) + ":" + String(Math.round(secs % 60)).padStart(2, "0") + " · " + (chans === 1 ? "mono" : "stereo") });
    add(bits >= 16, "WAV · " + bits + "-bit · lossless", 1);
    add(rate >= 44100, (rate / 1000).toFixed(1) + " kHz sample rate", 1);
    var peak = 0, w = Math.round(0.05 * rate), loud = -200, quiet = 200, clipped = 0;
    for (var c = 0; c < chans; c++) { var x = buf.getChannelData(c); for (var i = 0; i < n; i++) { var a = Math.abs(x[i]); if (a > peak) peak = a; } }
    var hot = 20 * Math.log10(peak || 1e-9) >= -0.1;
    for (var c2 = 0; c2 < chans; c2++) {
      var y = buf.getChannelData(c2);
      for (var s = 0; s + w <= n; s += w) { var e = 0; for (var k = s; k < s + w; k++) { e += y[k] * y[k]; if (hot && Math.abs(y[k]) >= 0.9886) clipped++; } var db = e > 0 ? 10 * Math.log10(e / w) : -200; if (db > loud) loud = db; if (db < quiet) quiet = db; }
    }
    var pct = clipped / Math.max(1, n * chans) * 100;
    add(pct < 0.1, "Clipping " + (pct < 0.01 ? "none" : pct.toFixed(2) + "% of samples"), pct > 1 ? 2 : 1);
    add(loud > -30, "Level " + Math.round(loud) + " dBFS (loud parts)" + (loud <= -30 ? " · too quiet" : ""), 1);
    if (!(loud - quiet >= 20)) checks.push({ ok: true, text: "Sustained throughout · no quiet gaps to check for noise" });
    else add(quiet < -50, "Noise in quiet parts " + (quiet < -150 ? "none" : Math.round(quiet) + " dBFS") + (quiet >= -50 ? " · hiss or hum" : ""), 1);
    var stars = clamp(score, 1, 5);
    return { stars: stars, price: [0, 5, 10, 15, 20, 30][stars], checks: checks };
  }

  // ------------------------------------------------------------- the track pack for Central Pedal (and Central Tracks)
  var ROLE_NAMES = { music: "Music", drums: "Drums", bass: "Bass", keys: "Keys", guitar: "Guitar", vocals: "Vocals" };
  function guessRole(t) { var n = (t.name || "").toLowerCase(); if (t.kind === "drums" || /drum|kit|perc/.test(n)) return "drums"; if (/bass/.test(n)) return "bass"; if (/guide|cue/.test(n)) return "guide"; if (/click|metronome/.test(n)) return "click"; if (/vox|vocal|sing/.test(n)) return "vocals"; if (/guitar|gtr/.test(n)) return "guitar"; if (/key|piano|pad|organ|synth/.test(n)) return "keys"; return "music"; }
  function addInto(dst, src, offset) {
    for (var c = 0; c < dst.numberOfChannels; c++) {
      var d = dst.getChannelData(c), s = src.getChannelData(Math.min(c, src.numberOfChannels - 1)), n = Math.min(d.length - offset, s.length);
      for (var i = 0; i < n; i++) d[i + offset] += s[i];
    }
  }
  function bpmText(b) { return Math.abs(b - Math.round(b)) < 0.05 ? String(Math.round(b)) : b.toFixed(1); }
  function safe(s) { return String(s || "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "").trim(); }
  /** opts: { title, artist, roles: { trackId: role }, chart (text), song (song.json object), guide: true, click: true } */
  function pedalPack(opts) {
    opts = opts || {};
    var p = P(), end = D.songEnd(), Z = window.CMProj;
    if (!(end > 0)) return Promise.reject(new Error("The timeline is empty: record or put clips on it first."));
    var title = safe(opts.title || p.name || "Song"), roles = opts.roles || {}, groups = {}, guideTracks = [], files = [], mix = null;
    return D.stems().then(function (list) {
      list.forEach(function (x) {
        var r = roles[x.track.id] || guessRole(x.track);
        if (x.track.made && /^(Click|Guide \(cues\))$/.test(x.track.name)) return;   // made from the sections: the pack makes its own
        if (r === "click") return;
        if (r === "guide") { guideTracks.push(x.buffer); return; }
        if (!groups[r]) groups[r] = x.buffer; else { var g = groups[r]; if (x.buffer.length > g.length) { var bigger = makeBuffer(x.buffer.length, g.sampleRate); addInto(bigger, g, 0); groups[r] = g = bigger; } addInto(g, x.buffer, 0); }
      });
      return D.render();
    }).then(function (m) {
      mix = m;
      return opts.guide === false ? null : guideBuffer(Math.ceil(end), mix.sampleRate);
    }).then(function (guide) {
      Object.keys(ROLE_NAMES).forEach(function (r) { if (groups[r]) files.push({ name: ROLE_NAMES[r] + ".wav", data: new Uint8Array(Z.wav(groups[r], 24)), role: r }); });
      if (opts.click !== false) files.push({ name: "Click.wav", data: new Uint8Array(Z.wav(clickBuffer(Math.ceil(end), mix.sampleRate), 24)), role: "click" });
      if (guide && (guide.cues || guideTracks.length)) { guideTracks.forEach(function (g) { addInto(guide, g, 0); }); files.push({ name: "Guide.wav", data: new Uint8Array(Z.wav(guide, 24)), role: "guide" }); }
      else if (guideTracks.length) { var gb = guideTracks[0]; for (var i = 1; i < guideTracks.length; i++) addInto(gb, guideTracks[i], 0); files.push({ name: "Guide.wav", data: new Uint8Array(Z.wav(gb, 24)), role: "guide" }); }
      files.push({ name: "Full Mix.wav", data: new Uint8Array(Z.wav(mix, 24)), mix: true });
      if (sections().length) files.push({ name: "Markers.mid", data: markersMidi() });
      if (opts.chart) files.push({ name: "Chart.txt", data: new TextEncoder().encode(opts.chart) });
      if (opts.song) files.push({ name: "song.json", data: new TextEncoder().encode(JSON.stringify(opts.song, null, 1)) });
      var name = title + (opts.artist ? " - " + safe(opts.artist) : "") + " - " + bpmText(p.bpm) + "bpm - " + p.key;
      return { name: name, zip: Z.zip(files.map(function (f) { return { name: f.name, data: f.data }; })), files: files, mix: mix, grade: grade(mix, 24), loudness: loudness(mix) };
    });
  }

  // ------------------------------------------------------------- the live loudness meter (on the master, while it plays)
  var live = null;
  function meter() {
    var g = D.graph && D.graph(); if (!g || !g.master || !g.c) return null;
    if (!live || live.graph !== g) {
      var c = g.c, shelf = c.createBiquadFilter(), hp = c.createBiquadFilter(), an = c.createAnalyser();
      shelf.type = "highshelf"; shelf.frequency.value = 1681.97; shelf.gain.value = 4.0;
      hp.type = "highpass"; hp.frequency.value = 38.14; hp.Q.value = 0.5;
      an.fftSize = 4096;
      g.master.mute.connect(shelf); shelf.connect(hp); hp.connect(an);
      var raw = c.createAnalyser(); raw.fftSize = 2048; g.master.mute.connect(raw);
      live = { graph: g, an: an, raw: raw, buf: new Float32Array(an.fftSize), rbuf: new Float32Array(raw.fftSize), hist: [], blocks: [], peak: 0, last: 0 };
    }
    return live;
  }
  /** Call every frame while it plays: { momentary, shortTerm, integrated, truePeak } in LUFS / dBFS. */
  function meterRead() {
    var m = meter(); if (!m) return null;
    var now = performance.now();
    m.an.getFloatTimeDomainData(m.buf); m.raw.getFloatTimeDomainData(m.rbuf);
    var e = 0; for (var i = 0; i < m.buf.length; i++) e += m.buf[i] * m.buf[i];
    var ms = e / m.buf.length * 2;   // two channels summed (the analyser gives the mono mix: L+R / 2, so x2 in energy for a stereo-identical signal)
    for (var k = 0; k < m.rbuf.length; k++) { var a = Math.abs(m.rbuf[k]); if (a > m.peak) m.peak = a; }
    if (D.state && D.state().playing) {
      if (now - m.last >= 100) { m.last = now; m.hist.push(ms); if (m.hist.length > 30) m.hist.shift(); var mo = (m.hist.slice(-4).reduce(function (a, x) { return a + x; }, 0)) / Math.min(4, m.hist.length); if (lufsOf(mo) > -70) m.blocks.push(mo); }
    }
    var mom = m.hist.length ? m.hist.slice(-4).reduce(function (a, x) { return a + x; }, 0) / Math.min(4, m.hist.length) : 0, st = m.hist.length ? m.hist.reduce(function (a, x) { return a + x; }, 0) / m.hist.length : 0;
    var I = -70; if (m.blocks.length) { var mean = m.blocks.reduce(function (a, x) { return a + x; }, 0) / m.blocks.length, thr = lufsOf(mean) - 10, kept = m.blocks.filter(function (x) { return lufsOf(x) > thr; }); if (kept.length) I = lufsOf(kept.reduce(function (a, x) { return a + x; }, 0) / kept.length); }
    return { momentary: Math.max(-70, lufsOf(mom)), shortTerm: Math.max(-70, lufsOf(st)), integrated: I, truePeak: m.peak > 1e-6 ? 20 * Math.log10(m.peak) : -120 };
  }
  function meterReset() { if (live) { live.hist = []; live.blocks = []; live.peak = 0; } }

  // ------------------------------------------------------------- the DAW's own boxes (CDawUI)
  function keyTempoDialog() {
    var UI = window.CDawUI; if (!UI || !UI.modal) return;
    var p = P(), K = D.KEYS, esc = UI.esc;
    var keys = K.map(function (k) { return k; }).concat(K.map(function (k) { return k + "m"; }));
    UI.modal("Change the key and tempo",
      '<div class="cd-kt"><label>Key<select id="cdkt-key">' + keys.map(function (k) { return "<option" + (k === p.key ? " selected" : "") + ">" + esc(k) + "</option>"; }).join("") + '</select></label>' +
      '<label>Tempo (BPM)<input id="cdkt-bpm" type="number" min="30" max="300" step="0.1" value="' + (Math.round(p.bpm * 10) / 10) + '"></label></div>' +
      '<label class="cd-check"><input type="checkbox" id="cdkt-audio" checked> Audio too: re-pitched and stretched from the original (drums keep their pitch)</label>' +
      '<p class="cd-kt-note" id="cdkt-note"></p>' +
      '<p class="cd-dim">MIDI moves to the new key (not drums), every clip, section and automation point stays on its beat, and it\'s one undo.</p>',
      function (m) {
        var key = m.querySelector("#cdkt-key").value, bpm = +m.querySelector("#cdkt-bpm").value, audio = m.querySelector("#cdkt-audio").checked;
        try {
          var r = changeKeyTempo(key, bpm, { audio: audio });
          UI.say("Now in " + r.key + " at " + (Math.round(r.bpm * 10) / 10) + " BPM" + (r.semis ? " (" + (r.semis > 0 ? "up " : "down ") + Math.abs(r.semis) + " semitone" + (Math.abs(r.semis) === 1 ? "" : "s") + ")" : "") + ": " + r.notes + " notes, " + r.clips + " audio clip" + (r.clips === 1 ? "" : "s") + ".");
        } catch (e) { UI.say(e.message || String(e), true); }
      });
    var m = UI.U.root.querySelector(".cd-modal"), note = m.querySelector("#cdkt-note");
    function show() {
      var s = semitones(p.key, m.querySelector("#cdkt-key").value), b = +m.querySelector("#cdkt-bpm").value || p.bpm, pct = Math.round((b / p.bpm - 1) * 100);
      note.textContent = (s ? (s > 0 ? "Up " : "Down ") + Math.abs(s) + " semitone" + (Math.abs(s) === 1 ? "" : "s") : "Same key") + " · " + (pct ? Math.abs(pct) + "% " + (pct > 0 ? "faster" : "slower") : "same tempo") + ((p.tempos || []).length ? " · the tempo changes in the song move with it" : "");
    }
    m.querySelector("#cdkt-key").onchange = show; m.querySelector("#cdkt-bpm").oninput = show; show();
  }
  /** The ruler's section menu items (daw-ui-arrange.js): the section moves with its music. */
  function sectionMenu(id) {
    var UI = window.CDawUI, secs = sections(), i = secs.findIndex(function (s) { return s.id === id; });
    function go(fn, ok) { return function () { try { if (fn()) UI.say(ok); } catch (e) { UI.say(e.message || String(e), true); } }; }
    return [["Duplicate it with its music", go(function () { return duplicate(id); }, "Duplicated, with everything in it.")],
      ["Move it earlier", go(function () { return move(id, -1); }, "Moved earlier."), i > 0],
      ["Move it later", go(function () { return move(id, 1); }, "Moved later."), i >= 0 && i < secs.length - 1],
      ["Delete it with its music", go(function () { return remove(id); }, "Deleted, and the rest closed up."), secs.length > 1]];
  }

  window.CDawSong = {
    sections: sections, arrange: arrange, duplicate: duplicate, remove: remove, move: move,
    changeKeyTempo: changeKeyTempo, semitones: semitones, isDrums: isDrums,
    clickBuffer: clickBuffer, guideBuffer: guideBuffer, cueFor: cueFor, makeClickAndGuide: makeClickAndGuide, markersMidi: markersMidi,
    loudness: loudness, grade: grade, pedalPack: pedalPack, guessRole: guessRole,
    meter: meterRead, meterReset: meterReset, keyTempoDialog: keyTempoDialog, sectionMenu: sectionMenu
  };
})();
