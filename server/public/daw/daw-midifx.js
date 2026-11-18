/* The DAW's MIDI effects (10.8): what an instrument track does to its notes before they reach its sound - the same on
 * what you play and on what's in its clips (clips keep the notes you played; the effects play on top, so you can change
 * them later), in the order they're listed:
 *   Scale        every note moves to the nearest one in a scale (the song's key, or one you pick)
 *   Chord        every note becomes a chord: a shape (major, minor, power, sus, 7th, add9, octaves or your own
 *                intervals), or the chord the key gives that note (diatonic)
 *   Arpeggiator  held notes play one at a time: up, down, up and down, as played or random, at a note value, over 1-4
 *                octaves, with a gate (how long each note is). It follows the song's grid while it plays; stopped,
 *                it runs on its own at the song's tempo.
 *
 *   CDawMidiFx.transform(notes, fx, { key }) -> notes   notes: [{ p, v, s, d }] in beats from the song's start (a clip's
 *                                                        notes, placed)
 *   CDawMidiFx.map(note, fx, { key }) -> [notes]         what one note played live becomes (scale and chord; no arp)
 *   CDawMidiFx.hasArp(fx) / arp(fx)                      the first switched-on arpeggiator
 *   CDawMidiFx.Live(opts)   a live arpeggiator: { press(n, v), release(n), stop() }; opts: { fx, rate(): beats per step,
 *                           now(): ctx time, beatAt(t)?: beats (the song's grid while it plays), secPerBeat(),
 *                           noteOn(p, v, when) -> voice, noteOff(voice, when) }
 *   CDawMidiFx.TYPES, RATES, SHAPES, SCALES */
(function () {
  "use strict";
  var KEYS = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
  var SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], "harmonic minor": [0, 2, 3, 5, 7, 8, 11], dorian: [0, 2, 3, 5, 7, 9, 10], mixolydian: [0, 2, 4, 5, 7, 9, 10],
    "major pentatonic": [0, 2, 4, 7, 9], "minor pentatonic": [0, 3, 5, 7, 10], blues: [0, 3, 5, 6, 7, 10] };
  var SHAPES = { major: [0, 4, 7], minor: [0, 3, 7], power: [0, 7, 12], octave: [0, 12], "two octaves": [0, 12, 24], sus2: [0, 2, 7], sus4: [0, 5, 7], "major 7th": [0, 4, 7, 11], "minor 7th": [0, 3, 7, 10], "7th": [0, 4, 7, 10], add9: [0, 4, 7, 14], "5th below": [-7, 0] };
  var RATES = [["1/4", 1], ["1/8", 0.5], ["1/8T", 1 / 3], ["1/16", 0.25], ["1/16T", 1 / 6], ["1/32", 0.125], ["1/4.", 1.5], ["1/8.", 0.75]];
  var TYPES = { scale: { name: "Scale", params: { key: "song", scale: "major" } }, chord: { name: "Chord", params: { shape: "major", diatonic: false, custom: "" } },
    arp: { name: "Arpeggiator", params: { mode: "up", rate: "1/16", octaves: 1, gate: 0.8 } } };
  function on(fx) { return (fx || []).filter(function (f) { return f && f.on !== false && TYPES[f.type]; }); }
  function rateOf(r) { for (var i = 0; i < RATES.length; i++) if (RATES[i][0] === r) return RATES[i][1]; return 0.25; }
  function rootOf(key) { var s = String(key || "C").replace(/m$/, ""), alias = { "D#": "Eb", "G#": "Ab", "A#": "Bb", Db: "C#", Gb: "F#" }; s = alias[s] || s; var i = KEYS.indexOf(s); return i < 0 ? 0 : i; }
  function scaleOf(p, songKey) {
    var key = p.key === "song" || !p.key ? songKey : p.key, minorKey = /m$/.test(String(key || "")), name = p.scale === "song" || !p.scale ? (minorKey ? "minor" : "major") : p.scale;
    if (p.key === "song" && p.scale === "major" && minorKey) name = "minor";   // (a minor song: its own scale)
    return { root: rootOf(key), steps: SCALES[name] || SCALES.major };
  }
  function snap(n, sc) {   // to the nearest note of the scale (ties go down)
    var best = n, bd = 99;
    for (var d = 0; d <= 6; d++) { [n - d, n + d].forEach(function (c) { if (bd <= d) return; var pc = ((c - sc.root) % 12 + 12) % 12; if (sc.steps.indexOf(pc) >= 0) { best = c; bd = d; } }); if (bd <= d) break; }
    return best;
  }
  function chordOf(n, p, songKey) {
    if (p.diatonic) {   // the chord the key gives this note: its scale degree, two thirds up
      var sc = scaleOf({ key: "song", scale: "song" }, songKey), m = snap(n, sc), pc = ((m - sc.root) % 12 + 12) % 12, i = sc.steps.indexOf(pc), out = [m];
      [2, 4].forEach(function (k) { var j = i + k, oct = Math.floor(j / sc.steps.length); out.push(m - sc.steps[i] + sc.steps[j % sc.steps.length] + oct * 12); });
      return out;
    }
    var iv = p.shape === "custom" ? String(p.custom || "").split(/[ ,]+/).map(Number).filter(function (x) { return isFinite(x) && Math.abs(x) <= 36; }) : SHAPES[p.shape] || SHAPES.major;
    if (iv.indexOf(0) < 0) iv = [0].concat(iv);
    return iv.map(function (x) { return n + x; });
  }
  function clampNote(n) { return n >= 0 && n <= 127; }
  // one note played live: scale and chord (an arpeggiator plays held notes on its own clock - Live)
  function map(note, fx, o) {
    var list = [note], key = (o && o.key) || "C";
    on(fx).forEach(function (f) {
      if (f.type === "scale") { var sc = scaleOf(Object.assign({}, TYPES.scale.params, f.params), key); list = list.map(function (n) { return snap(n, sc); }); }
      else if (f.type === "chord") { var p = Object.assign({}, TYPES.chord.params, f.params), out = []; list.forEach(function (n) { chordOf(n, p, key).forEach(function (c) { if (out.indexOf(c) < 0) out.push(c); }); }); list = out; }
    });
    return list.filter(clampNote);
  }
  function order(held, mode, octaves, step) {   // the notes an arpeggio walks through, from what's held
    var base = held.slice(), seq = [];
    if (mode === "played") base.sort(function (a, b) { return a.at - b.at; }); else base.sort(function (a, b) { return a.p - b.p; });
    for (var o = 0; o < octaves; o++) base.forEach(function (h) { seq.push({ p: h.p + 12 * o, v: h.v }); });
    if (mode === "down") seq.reverse();
    else if (mode === "updown" && seq.length > 2) seq = seq.concat(seq.slice(1, -1).reverse());
    if (mode === "random") return seq[Math.floor(rnd(step) * seq.length)];
    return seq[step % seq.length];
  }
  function rnd(i) { var x = Math.sin((i + 1) * 12.9898) * 43758.5453; return x - Math.floor(x); }   // (the same "random" every time a clip plays)
  function transform(notes, fx, o) {
    var list = on(fx); if (!list.length) return notes;
    var key = (o && o.key) || "C", out = notes.map(function (n) { return { p: n.p, v: n.v, s: n.s, d: n.d }; });
    list.forEach(function (f) {
      if (f.type === "arp") {
        var p = Object.assign({}, TYPES.arp.params, f.params), r = rateOf(p.rate), oct = Math.max(1, Math.min(4, p.octaves | 0 || 1)), gate = Math.max(0.05, Math.min(1, +p.gate || 0.8));
        if (!out.length) return;
        var from = Math.min.apply(null, out.map(function (n) { return n.s; })), to = Math.max.apply(null, out.map(function (n) { return n.s + n.d; })), res = [], step = 0, wasEmpty = true;
        for (var t = Math.ceil(from / r - 1e-6) * r; t < to - 1e-9; t += r) {
          var held = out.filter(function (n) { return n.s <= t + 1e-6 && n.s + n.d > t + 1e-6; }).map(function (n) { return { p: n.p, v: n.v, at: n.s }; });
          if (!held.length) { wasEmpty = true; continue; }
          if (wasEmpty) { step = 0; wasEmpty = false; }
          var pick = order(held, p.mode, oct, p.mode === "random" ? Math.round(t / r) : step++);
          if (pick && clampNote(pick.p)) res.push({ p: pick.p, v: pick.v, s: t, d: r * gate });
        }
        out = res;
      } else {
        var next = [];
        out.forEach(function (n) { map(n.p, [f], { key: key }).forEach(function (q) { next.push({ p: q, v: n.v, s: n.s, d: n.d }); }); });
        out = next;
      }
    });
    return out;
  }
  function arp(fx) { return on(fx).filter(function (f) { return f.type === "arp"; })[0] || null; }

  // ------------------------------------------------------------- the live arpeggiator
  function Live(o) {
    this.o = o; this.held = []; this.timer = null; this.step = 0; this.next = null; this.playing = [];
  }
  Live.prototype.press = function (p, v) {
    if (this.held.some(function (h) { return h.p === p; })) return;
    var first = !this.held.length; this.held.push({ p: p, v: v, at: performance.now() });
    if (first) { this.step = 0; this.next = null; this.start(); }
  };
  Live.prototype.release = function (p) { this.held = this.held.filter(function (h) { return h.p !== p; }); if (!this.held.length) this.stop(true); };
  Live.prototype.start = function () { var self = this; if (this.timer) return; this.tick(); this.timer = setInterval(function () { self.tick(); }, 10); };
  Live.prototype.stop = function (soft) {
    clearInterval(this.timer); this.timer = null; var o = this.o, now = o.now();
    if (!soft) { this.held = []; this.playing.forEach(function (x) { o.noteOff(x.voice, now); }); this.playing = []; }
  };
  Live.prototype.tick = function () {
    var o = this.o, f = arp(o.fx()); if (!f || !this.held.length) return;
    var p = Object.assign({}, TYPES.arp.params, f.params), r = rateOf(p.rate), spb = o.secPerBeat(), now = o.now(), ahead = now + 0.06, gate = Math.max(0.05, Math.min(1, +p.gate || 0.8));
    if (this.next == null) {   // the first step: on the song's grid while it plays, else right away
      if (o.beatAt) { var b = o.beatAt(now); this.next = b == null ? now : now + (Math.ceil(b / r - 1e-6) * r - b) * spb; } else this.next = now;
    }
    while (this.next < ahead) {
      var pick = order(this.held, p.mode, Math.max(1, Math.min(4, p.octaves | 0 || 1)), this.step++);
      if (pick && pick.p >= 0 && pick.p <= 127) { var at = Math.max(this.next, now), voice = o.noteOn(pick.p, pick.v, at), off = at + r * spb * gate; o.noteOff(voice, off); this.playing.push({ voice: voice, off: off }); }
      this.next += r * spb;
    }
    this.playing = this.playing.filter(function (x) { return x.off > now; });
  };
  window.CDawMidiFx = { transform: transform, map: map, hasArp: function (fx) { return !!arp(fx); }, arp: arp, Live: Live, TYPES: TYPES, RATES: RATES, SHAPES: SHAPES, SCALES: SCALES, rate: rateOf, on: function (fx) { return on(fx).length > 0; } };
})();
