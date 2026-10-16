/* Pad Pedal - two texture channels with 100 built-in textures.
 * Textures are generated (noise, rendered impulse/grain/bell buffers, tonal
 * drones, one-bar rhythmic loops), so nothing needs samples. Tonal textures
 * follow the current key, rhythmic ones follow the tempo. Both channels mix
 * into the main output (engine.texturesBus), under the pads. */
(function () {
  "use strict";
  var PP = window.PP; if (!PP) return;
  var engine = PP.engine, clamp = PP.clamp, KEYS = PP.KEYS;

  function noteHz(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }
  function rootMidi(base) { var key = PP.playKeyFor(PP.currentPad()), n = PP.noteIndex(key); return base + n; }

  // id, name, category, family, params
  var L = [], cat;
  function T(id, name, family, params) { L.push({ id: id, name: name, cat: cat, family: family, p: params }); }
  cat = "Rain & water";
  T("rain-soft", "Soft Rain", "crackle", { density: 60, decay: 14, hp: 1500, lp: 9000, q: .6, bed: .25, bedColor: "white", bedLp: 6000 });
  T("rain-steady", "Steady Rain", "crackle", { density: 160, decay: 12, hp: 1200, lp: 10000, q: .5, bed: .4, bedColor: "white", bedLp: 7000 });
  T("rain-heavy", "Heavy Rain", "crackle", { density: 400, decay: 10, hp: 700, lp: 12000, q: .5, bed: .6, bedColor: "white", bedLp: 9000 });
  T("rain-window", "Rain on Window", "crackle", { density: 90, decay: 22, hp: 2500, lp: 12000, q: 1.2, bed: .15, bedColor: "pink", bedLp: 4000 });
  T("storm-far", "Distant Storm", "noise", { color: "brown", type: "lowpass", freq: 260, q: .8, lfoRate: .05, lfoDepth: 160, ampRate: .03, ampDepth: .5 });
  T("drizzle", "Drizzle", "crackle", { density: 35, decay: 18, hp: 2500, lp: 9000, q: .7, bed: .12, bedColor: "white", bedLp: 5000 });
  T("rain-trees", "Rain in Trees", "crackle", { density: 220, decay: 25, hp: 600, lp: 5000, q: .7, bed: .5, bedColor: "pink", bedLp: 3500 });
  T("ocean", "Ocean Waves", "noise", { color: "pink", type: "lowpass", freq: 900, q: .7, lfoRate: .08, lfoDepth: 700, ampRate: .08, ampDepth: .8 });
  T("shore", "Gentle Shore", "noise", { color: "pink", type: "bandpass", freq: 1200, q: .5, lfoRate: .11, lfoDepth: 600, ampRate: .11, ampDepth: .7 });
  T("creek", "Creek", "crackle", { density: 500, decay: 6, hp: 900, lp: 8000, q: .4, bed: .7, bedColor: "white", bedLp: 5500 });
  T("drops", "Water Drops", "drops", { density: 1.2, decay: 420, degrees: [0, 4, 7, 11, 14], base: 84, octaves: 1, partial2: .4, keyFollow: true });
  T("cave-drips", "Cave Drips", "drops", { density: .5, decay: 900, degrees: [0, 7, 12], base: 72, octaves: 1, partial2: .2, keyFollow: true, verbish: true });
  T("deep-water", "Deep Water", "noise", { color: "brown", type: "lowpass", freq: 180, q: 1.4, lfoRate: .04, lfoDepth: 90, ampRate: .05, ampDepth: .4 });
  T("spring", "Bubbling Spring", "crackle", { density: 120, decay: 30, hp: 300, lp: 2500, q: 2.5, bed: .2, bedColor: "pink", bedLp: 2000 });
  cat = "Wind & air";
  T("wind-soft", "Soft Wind", "noise", { color: "pink", type: "bandpass", freq: 500, q: 1.2, lfoRate: .13, lfoDepth: 350, ampRate: .09, ampDepth: .6 });
  T("wind-mountain", "Mountain Wind", "noise", { color: "pink", type: "bandpass", freq: 320, q: .9, lfoRate: .07, lfoDepth: 240, ampRate: .05, ampDepth: .7 });
  T("wind-desert", "Desert Wind", "noise", { color: "white", type: "bandpass", freq: 1400, q: 2, lfoRate: .19, lfoDepth: 900, ampRate: .12, ampDepth: .5 });
  T("breeze", "Cold Breeze", "noise", { color: "white", type: "highpass", freq: 3000, q: .7, lfoRate: .21, lfoDepth: 1500, ampRate: .15, ampDepth: .6 });
  T("grass", "Wind in Grass", "noise", { color: "white", type: "bandpass", freq: 4200, q: 1.5, lfoRate: .3, lfoDepth: 1800, ampRate: .2, ampDepth: .7 });
  T("howl", "Howling Wind", "noise", { color: "pink", type: "bandpass", freq: 700, q: 6, lfoRate: .17, lfoDepth: 500, ampRate: .1, ampDepth: .8 });
  T("breath", "Breath", "noise", { color: "pink", type: "bandpass", freq: 900, q: 1.1, lfoRate: 0, lfoDepth: 0, ampRate: .22, ampDepth: .95 });
  T("breathing-slow", "Slow Breathing", "noise", { color: "pink", type: "lowpass", freq: 1300, q: .6, lfoRate: 0, lfoDepth: 0, ampRate: .1, ampDepth: .95 });
  T("warm-air", "Warm Air", "noise", { color: "brown", type: "lowpass", freq: 600, q: .5, lfoRate: .05, lfoDepth: 200, ampRate: .04, ampDepth: .3 });
  T("cold-air", "Cold Air", "noise", { color: "white", type: "highpass", freq: 6000, q: .5, lfoRate: .09, lfoDepth: 2000, ampRate: .07, ampDepth: .4 });
  T("room-tone", "Room Tone", "noise", { color: "brown", type: "lowpass", freq: 400, q: .4, lfoRate: 0, lfoDepth: 0, ampRate: 0, ampDepth: 0 });
  T("chapel-air", "Chapel Air", "noise", { color: "pink", type: "lowpass", freq: 2200, q: .3, lfoRate: .03, lfoDepth: 400, ampRate: .02, ampDepth: .2 });
  T("hall-noise", "Hall Noise", "noise", { color: "pink", type: "lowpass", freq: 3200, q: .3, lfoRate: .02, lfoDepth: 500, ampRate: .03, ampDepth: .15 });
  cat = "Tape, vinyl & radio";
  T("vinyl", "Vinyl Crackle", "crackle", { density: 18, decay: 4, hp: 1800, lp: 9000, q: .7, bed: .08, bedColor: "pink", bedLp: 3000 });
  T("old-record", "Old Record", "crackle", { density: 45, decay: 6, hp: 1000, lp: 6000, q: .7, bed: .25, bedColor: "pink", bedLp: 2200, rumble: true });
  T("tape-hiss", "Tape Hiss", "noise", { color: "white", type: "highpass", freq: 2500, q: .4, lfoRate: 0, lfoDepth: 0, ampRate: .4, ampDepth: .08 });
  T("warm-tape", "Warm Tape", "noise", { color: "pink", type: "lowpass", freq: 3800, q: .5, lfoRate: .5, lfoDepth: 120, ampRate: .3, ampDepth: .1 });
  T("dusty", "Dusty Tape", "crackle", { density: 8, decay: 10, hp: 900, lp: 5000, q: .8, bed: .3, bedColor: "pink", bedLp: 2600 });
  T("cassette-hum", "Cassette Hum", "hum", { freq: 60, harmonics: [1, 2, 3, 5], gains: [.5, .2, .1, .05], noise: .2, noiseLp: 2000 });
  T("radio-static", "Radio Static", "static", { rate: 6, min: 30, max: 300, lp: 5000, hp: 400, bits: 8 });
  T("shortwave", "Shortwave", "static", { rate: 2, min: 200, max: 1800, lp: 2600, hp: 300, bits: 6, whistle: true });
  cat = "Fire";
  T("campfire", "Campfire", "crackle", { density: 30, decay: 40, hp: 400, lp: 4000, q: 1.5, bed: .4, bedColor: "brown", bedLp: 500 });
  T("candle", "Candle", "noise", { color: "pink", type: "bandpass", freq: 1500, q: 2.5, lfoRate: 1.3, lfoDepth: 500, ampRate: .9, ampDepth: .4 });
  T("fireplace", "Fireplace", "crackle", { density: 55, decay: 60, hp: 250, lp: 3000, q: 1.3, bed: .5, bedColor: "brown", bedLp: 350 });
  T("embers", "Embers", "crackle", { density: 6, decay: 90, hp: 600, lp: 2500, q: 2, bed: .2, bedColor: "brown", bedLp: 250 });
  cat = "Drones (follow the key)";
  T("organ-air", "Organ Air", "drone", { partials: [[0, .3, 0], [12, .22, 3], [19, .14, -3], [24, .1, 2]], wave: "sine", lp: 3000, motion: .08, keyFollow: true, base: 48 });
  T("choir-air", "Choir Air", "drone", { partials: [[0, .22, -6], [0, .22, 6], [7, .16, 0], [12, .12, 4]], wave: "sawtooth", lp: 1600, motion: .15, keyFollow: true, base: 48, formants: [[650, 7], [1100, 8]] });
  T("low-drone", "Low Drone", "drone", { partials: [[0, .4, 0], [0, .3, -5], [7, .12, 0]], wave: "triangle", lp: 900, motion: .1, keyFollow: true, base: 36 });
  T("sub-drone", "Sub Drone", "drone", { partials: [[0, .6, 0], [12, .15, 0]], wave: "sine", lp: 400, motion: .05, keyFollow: true, base: 24 });
  T("fifth-drone", "Fifth Drone", "drone", { partials: [[0, .3, -4], [7, .3, 4], [12, .15, 0], [19, .1, 0]], wave: "triangle", lp: 2200, motion: .12, keyFollow: true, base: 48 });
  T("octave-drone", "Octave Drone", "drone", { partials: [[0, .3, 0], [12, .3, 2], [24, .2, -2], [36, .08, 0]], wave: "sine", lp: 5000, motion: .06, keyFollow: true, base: 36 });
  T("string-air", "String Air", "drone", { partials: [[0, .14, -8], [0, .14, 8], [12, .12, -5], [12, .12, 5], [19, .08, 0]], wave: "sawtooth", lp: 1800, motion: .2, keyFollow: true, base: 48 });
  T("bowed-glass", "Bowed Glass", "drone", { partials: [[0, .25, 0], [19, .18, 1], [28, .12, -1], [31, .08, 0]], wave: "sine", lp: 7000, motion: .25, keyFollow: true, base: 60 });
  T("hum-drone", "Hum Drone", "drone", { partials: [[0, .35, 0], [0, .25, -12], [0, .25, 12]], wave: "triangle", lp: 700, motion: .3, keyFollow: true, base: 36 });
  T("dark-drone", "Dark Drone", "drone", { partials: [[0, .35, 0], [3, .12, 0], [7, .18, 0], [12, .1, 0]], wave: "sawtooth", lp: 500, motion: .12, keyFollow: true, base: 36 });
  T("bright-drone", "Bright Drone", "drone", { partials: [[0, .2, 0], [12, .2, 0], [19, .16, 0], [24, .14, 0], [28, .1, 0], [31, .08, 0]], wave: "sine", lp: 9000, motion: .15, keyFollow: true, base: 48 });
  T("sine-bed", "Sine Bed", "drone", { partials: [[0, .4, 0], [7, .2, 0]], wave: "sine", lp: 2000, motion: .04, keyFollow: true, base: 48 });
  T("tape-drone", "Tape Drone", "drone", { partials: [[0, .3, -14], [0, .3, 10], [12, .12, -20]], wave: "triangle", lp: 1500, motion: .5, keyFollow: true, base: 48 });
  T("reed-drone", "Reed Drone", "drone", { partials: [[0, .2, -3], [0, .2, 3], [12, .1, 0]], wave: "square", lp: 1200, motion: .1, keyFollow: true, base: 48 });
  T("glass-drone", "Glass Drone", "drone", { partials: [[0, .25, 0], [24, .18, 3], [36, .1, -3], [43, .06, 0]], wave: "sine", lp: 12000, motion: .2, keyFollow: true, base: 60 });
  cat = "Shimmer & grains (follow the key)";
  T("shimmer-dust", "Shimmer Dust", "grains", { density: 30, grain: 90, intervals: [0, 4, 7, 11, 12, 16, 19], base: 84, octaves: 2, keyFollow: true });
  T("sparkles", "Sparkles", "grains", { density: 18, grain: 40, intervals: [0, 7, 12, 19, 24], base: 96, octaves: 1, keyFollow: true });
  T("star-dust", "Star Dust", "grains", { density: 50, grain: 160, intervals: [0, 2, 4, 7, 9, 12], base: 84, octaves: 2, keyFollow: true });
  T("crystal-grains", "Crystal Grains", "grains", { density: 24, grain: 60, intervals: [0, 4, 7, 12], base: 96, octaves: 1, keyFollow: true });
  T("glitter", "Glitter", "grains", { density: 80, grain: 25, intervals: [0, 7, 12, 14, 19, 24], base: 96, octaves: 2, keyFollow: true });
  T("halo", "Halo", "grains", { density: 40, grain: 320, intervals: [0, 7, 12], base: 72, octaves: 2, keyFollow: true });
  T("angel-dust", "Angel Dust", "grains", { density: 60, grain: 220, intervals: [0, 4, 7, 12, 16, 19, 24], base: 84, octaves: 1, keyFollow: true });
  T("ice", "Ice Crystals", "grains", { density: 14, grain: 30, intervals: [0, 3, 7, 10, 12], base: 96, octaves: 2, keyFollow: true });
  T("harmonic-cloud", "Harmonic Cloud", "grains", { density: 70, grain: 400, intervals: [0, 12, 19, 24, 28, 31, 34], base: 48, octaves: 1, keyFollow: true });
  T("high-shimmer", "High Shimmer", "grains", { density: 45, grain: 120, intervals: [0, 7, 12], base: 108, octaves: 1, keyFollow: true });
  T("choir-grains", "Choir Grains", "grains", { density: 35, grain: 500, intervals: [0, 4, 7, 12], base: 60, octaves: 1, keyFollow: true, soft: true });
  T("bell-grains", "Bell Grains", "grains", { density: 10, grain: 700, intervals: [0, 7, 12, 19], base: 84, octaves: 1, keyFollow: true, partial2: .5 });
  cat = "Bells & drops (follow the key)";
  T("chimes", "Wind Chimes", "drops", { density: 2.2, decay: 1400, degrees: [0, 2, 4, 7, 9, 12, 14], base: 84, octaves: 1, partial2: .35, keyFollow: true });
  T("glass-bells", "Glass Bells", "drops", { density: .8, decay: 2200, degrees: [0, 4, 7, 12], base: 84, octaves: 1, partial2: .5, keyFollow: true });
  T("music-box", "Music Box", "drops", { density: 3, decay: 900, degrees: [0, 2, 4, 5, 7, 9, 11, 12], base: 84, octaves: 1, partial2: .6, keyFollow: true, pattern: true });
  T("kalimba", "Kalimba Drops", "drops", { density: 1.6, decay: 600, degrees: [0, 2, 4, 7, 9], base: 72, octaves: 1, partial2: .25, keyFollow: true });
  T("harp-drops", "Harp Drops", "drops", { density: 2.6, decay: 1100, degrees: [0, 2, 4, 7, 9, 11], base: 72, octaves: 2, partial2: .3, keyFollow: true });
  T("tubular", "Tubular Bells", "drops", { density: .25, decay: 4000, degrees: [0, 7, 12], base: 60, octaves: 0, partial2: .7, keyFollow: true });
  T("tiny-bells", "Tiny Bells", "drops", { density: 5, decay: 300, degrees: [0, 4, 7, 12], base: 96, octaves: 1, partial2: .4, keyFollow: true });
  T("celesta", "Celesta Drops", "drops", { density: 1.4, decay: 1300, degrees: [0, 2, 4, 7, 9, 12], base: 84, octaves: 1, partial2: .2, keyFollow: true });
  T("piano-dust", "Piano Dust", "drops", { density: 1, decay: 2600, degrees: [0, 4, 7, 11, 14], base: 60, octaves: 1, partial2: .15, keyFollow: true, soft: true });
  T("marimba", "Marimba Drops", "drops", { density: 2, decay: 350, degrees: [0, 2, 4, 7, 9], base: 60, octaves: 1, partial2: .3, keyFollow: true });
  cat = "Rhythmic (follow the tempo)";
  T("heartbeat", "Heartbeat", "pulse", { kind: "thump", pattern: [1, 0, 0, 0, .6, 0, 0, 0], division: 8, freq: 55, decay: 140 });
  T("slow-pulse", "Slow Pulse", "pulse", { kind: "noise", pattern: [1, 0, 0, 0], division: 4, decay: 220, lp: 1200 });
  T("eighth-pulse", "Eighth Pulse", "pulse", { kind: "noise", pattern: [1, .5, .7, .5, .9, .5, .7, .5], division: 8, decay: 90, lp: 2500 });
  T("shaker", "Sixteenth Shaker", "pulse", { kind: "noise", pattern: [.9, .3, .6, .3, .9, .3, .6, .3, .9, .3, .6, .3, .9, .3, .6, .4], division: 16, decay: 45, hp: 4000 });
  T("breathing-pulse", "Breathing Pulse", "pulse", { kind: "noise", pattern: [1, 0, 0, 0, 0, 0, 0, 0], division: 8, decay: 900, lp: 1500, soft: true });
  T("tremolo-noise", "Tremolo Noise", "pulse", { kind: "noise", pattern: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], division: 16, decay: 70, lp: 3000 });
  T("pulsing-drone", "Pulsing Drone", "pulse", { kind: "tone", pattern: [1, .6, .8, .6], division: 4, decay: 400, interval: 0, base: 36, keyFollow: true });
  T("ticking", "Ticking", "pulse", { kind: "tick", pattern: [1, 0, .7, 0, 1, 0, .7, 0], division: 8, decay: 12, hp: 2000 });
  T("train", "Train", "pulse", { kind: "noise", pattern: [1, .4, .8, .4, 1, .4, .8, .4, 1, .4, .8, .4, 1, .4, .8, .4], division: 16, decay: 60, lp: 1800 });
  T("pump", "Pump", "pulse", { kind: "thump", pattern: [1, 0, 1, 0], division: 4, freq: 80, decay: 200 });
  cat = "Static & electric";
  T("static", "Static", "static", { rate: 10, min: 10, max: 80, lp: 8000, hp: 200, bits: 10 });
  T("glitch-dust", "Glitch Dust", "static", { rate: 4, min: 5, max: 40, lp: 9000, hp: 900, bits: 5 });
  T("digital-rain", "Digital Rain", "static", { rate: 25, min: 3, max: 12, lp: 12000, hp: 2000, bits: 6 });
  T("bit-crackle", "Bit Crackle", "static", { rate: 14, min: 2, max: 20, lp: 6000, hp: 500, bits: 4 });
  T("geiger", "Geiger", "crackle", { density: 9, decay: 3, hp: 2500, lp: 9000, q: .7, bed: 0, bedColor: "white", bedLp: 4000 });
  T("sparks", "Sparks", "crackle", { density: 14, decay: 8, hp: 3500, lp: 14000, q: 1, bed: .05, bedColor: "white", bedLp: 8000 });
  T("electric-hum", "Electric Hum", "hum", { freq: 50, harmonics: [1, 2, 3, 4, 6], gains: [.4, .25, .15, .1, .05], noise: .08, noiseLp: 1200 });
  T("neon", "Neon Buzz", "hum", { freq: 120, harmonics: [1, 2, 3, 5, 7], gains: [.3, .2, .15, .1, .08], noise: .25, noiseLp: 4000 });
  cat = "Places & nature";
  T("crowd", "Crowd Murmur", "noise", { color: "pink", type: "bandpass", freq: 700, q: 1.2, lfoRate: .6, lfoDepth: 300, ampRate: .35, ampDepth: .35 });
  T("voices-far", "Distant Voices", "noise", { color: "pink", type: "bandpass", freq: 1000, q: 3, lfoRate: 1.1, lfoDepth: 400, ampRate: .8, ampDepth: .5 });
  T("city", "City Hum", "noise", { color: "brown", type: "lowpass", freq: 500, q: .7, lfoRate: .15, lfoDepth: 150, ampRate: .1, ampDepth: .25 });
  T("traffic", "Far Traffic", "noise", { color: "brown", type: "lowpass", freq: 350, q: .9, lfoRate: .2, lfoDepth: 200, ampRate: .25, ampDepth: .5 });
  T("insects", "Night Insects", "crackle", { density: 240, decay: 5, hp: 5000, lp: 12000, q: 3, bed: .1, bedColor: "white", bedLp: 9000 });
  T("crickets", "Crickets", "pulse", { kind: "chirp", pattern: [1, 1, 1, 0, 1, 1, 1, 0], division: 8, decay: 30, hp: 4500, fixedBpm: 160 });
  T("birds-far", "Birds Far", "drops", { density: .9, decay: 120, degrees: [0, 2, 4, 5, 7], base: 96, octaves: 1, partial2: .1, keyFollow: false, chirp: true });
  T("forest-night", "Forest Night", "noise", { color: "pink", type: "bandpass", freq: 2200, q: 1.5, lfoRate: .25, lfoDepth: 900, ampRate: .15, ampDepth: .5 });
  T("thunder", "Thunder Roll", "noise", { color: "brown", type: "lowpass", freq: 120, q: 2, lfoRate: .07, lfoDepth: 80, ampRate: .06, ampDepth: .9 });
  T("deep-space", "Deep Space", "noise", { color: "brown", type: "lowpass", freq: 150, q: .5, lfoRate: .02, lfoDepth: 60, ampRate: .015, ampDepth: .5 });
  T("engine-room", "Engine Room", "hum", { freq: 42, harmonics: [1, 2, 3, 4, 5, 6], gains: [.4, .3, .2, .15, .1, .08], noise: .3, noiseLp: 700 });
  T("cathedral-echo", "Cathedral Echo", "noise", { color: "pink", type: "lowpass", freq: 1800, q: .4, lfoRate: .04, lfoDepth: 600, ampRate: .05, ampDepth: .4 });
  var LIBRARY = L, BY_ID = {};
  LIBRARY.forEach(function (t) { BY_ID[t.id] = t; });

  // ---------------------------------------------------------------- buffers
  var noiseCache = {};
  function noiseBuffer(ctx, color) {
    var key = color + ctx.sampleRate;
    if (noiseCache[key]) return noiseCache[key];
    var len = ctx.sampleRate * 8, buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch), b0 = 0, b1 = 0, b2 = 0, last = 0;
      for (var i = 0; i < len; i++) {
        var w = Math.random() * 2 - 1;
        if (color === "white") d[i] = w * .5;
        else if (color === "pink") { b0 = .99765 * b0 + w * .099046; b1 = .963 * b1 + w * .2965164; b2 = .57 * b2 + w * 1.0526913; d[i] = (b0 + b1 + b2 + w * .1848) * .11; }
        else { last = (last + .02 * w) / 1.02; d[i] = last * 3.5; }
      }
    }
    noiseCache[key] = buf;
    return buf;
  }
  function renderBuffer(ctx, seconds, fill) {
    var len = Math.floor(ctx.sampleRate * seconds), buf = ctx.createBuffer(2, len, ctx.sampleRate);
    fill(buf.getChannelData(0), buf.getChannelData(1), ctx.sampleRate, len);
    return buf;
  }
  function burst(d, start, lenSamples, amp, decaySamples, tone) {
    for (var i = 0; i < lenSamples && start + i < d.length; i++) {
      var env = Math.exp(-i / decaySamples), v = (Math.random() * 2 - 1) * env * amp;
      if (tone) v += Math.sin(i * tone) * env * amp * .5;
      d[start + i] += v;
    }
  }
  function ping(d, start, rate, freq, decayMs, amp, partial2, soft) {
    var len = Math.min(d.length - start, Math.floor(rate * decayMs / 1000 * 2.2)), w1 = 2 * Math.PI * freq / rate, w2 = w1 * (partial2 ? 2.76 : 2);
    for (var i = 0; i < len; i++) {
      var t = i / rate, env = Math.exp(-i / (rate * decayMs / 1000)), a = soft ? Math.min(1, i / (rate * .02)) : 1;
      d[start + i] += amp * env * a * (Math.sin(w1 * i) + (partial2 || 0) * Math.sin(w2 * i) * Math.exp(-i / (rate * decayMs / 2500)));
    }
  }

  // ---------------------------------------------------------------- families
  function makeNoise(ctx, p, out) {
    var src = ctx.createBufferSource(); src.buffer = noiseBuffer(ctx, p.color); src.loop = true;
    var f = ctx.createBiquadFilter(); f.type = p.type; f.frequency.value = p.freq; f.Q.value = p.q;
    var amp = ctx.createGain(); amp.gain.value = 1 - (p.ampDepth || 0) * .5;
    src.connect(f).connect(amp).connect(out);
    var nodes = [src];
    if (p.lfoRate) { var lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = p.lfoRate; lg.gain.value = p.lfoDepth; lfo.connect(lg).connect(f.frequency); lfo.start(); nodes.push(lfo); }
    if (p.ampRate) { var alfo = ctx.createOscillator(), ag = ctx.createGain(); alfo.frequency.value = p.ampRate; ag.gain.value = (p.ampDepth || 0) * .5; alfo.connect(ag).connect(amp.gain); alfo.start(); nodes.push(alfo); }
    src.start();
    return { nodes: nodes };
  }
  function makeCrackle(ctx, p, out) {
    var buf = renderBuffer(ctx, 8, function (l, r, rate, len) {
      var count = Math.floor(p.density * 8);
      for (var k = 0; k < count; k++) {
        var pos = Math.floor(Math.random() * len), a = Math.pow(Math.random(), 2) * .9 + .05, dec = rate * p.decay / 1000;
        var tone = p.q > 1.5 ? 2 * Math.PI * (p.hp * (1 + Math.random())) / rate : 0;
        burst(Math.random() < .5 ? l : r, pos, Math.floor(dec * 5) + 4, a, dec, tone);
      }
    });
    var src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    var hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = p.hp; hp.Q.value = p.q;
    var lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = p.lp;
    src.connect(hp).connect(lp).connect(out); src.start();
    var nodes = [src];
    if (p.bed) { var bed = ctx.createBufferSource(); bed.buffer = noiseBuffer(ctx, p.bedColor || "pink"); bed.loop = true; var bl = ctx.createBiquadFilter(); bl.type = "lowpass"; bl.frequency.value = p.bedLp; var bg = ctx.createGain(); bg.gain.value = p.bed * .6; bed.connect(bl).connect(bg).connect(out); bed.start(); nodes.push(bed); }
    if (p.rumble) { var rb = ctx.createBufferSource(); rb.buffer = noiseBuffer(ctx, "brown"); rb.loop = true; var rl = ctx.createBiquadFilter(); rl.type = "lowpass"; rl.frequency.value = 120; var rg = ctx.createGain(); rg.gain.value = .5; rb.connect(rl).connect(rg).connect(out); rb.start(); nodes.push(rb); }
    return { nodes: nodes };
  }
  function makeDrops(ctx, p, out, root) {
    function build() {
      return renderBuffer(ctx, 10, function (l, r, rate, len) {
        var count = Math.max(1, Math.floor(p.density * 10)), base = p.keyFollow ? root : p.base, seq = 0;
        for (var k = 0; k < count; k++) {
          var pos = p.pattern ? Math.floor(seq++ * rate * 60 / 92 / 2) % len : Math.floor(Math.random() * len);
          var deg = p.degrees[Math.floor(Math.random() * p.degrees.length)], oct = Math.floor(Math.random() * (p.octaves + 1)) * 12;
          var freq = noteHz(base + deg + oct) * (p.chirp ? (1 + Math.random() * .5) : 1), amp = .25 + Math.random() * .35;
          ping(Math.random() < .5 ? l : r, pos, rate, freq, p.decay * (p.chirp ? .3 : 1), amp * .35, p.partial2, p.soft);
          if (p.verbish) ping(Math.random() < .5 ? r : l, pos + Math.floor(rate * .08), rate, freq, p.decay * 1.6, amp * .12, p.partial2, true);
        }
      });
    }
    var src = ctx.createBufferSource(); src.buffer = build(); src.loop = true; src.connect(out); src.start();
    var state = { nodes: [src] };
    state.setRoot = function (newRoot) { if (!p.keyFollow || newRoot === root) return; root = newRoot; var next = ctx.createBufferSource(); next.buffer = build(); next.loop = true; next.connect(out); next.start(); var old = state.nodes[0]; state.nodes[0] = next; try { old.stop(ctx.currentTime + .05); } catch (_) { } };
    return state;
  }
  function makeGrains(ctx, p, out, root) {
    function build() {
      return renderBuffer(ctx, 8, function (l, r, rate, len) {
        var count = Math.floor(p.density * 8), base = p.keyFollow ? root : p.base, g = Math.floor(rate * p.grain / 1000);
        for (var k = 0; k < count; k++) {
          var pos = Math.floor(Math.random() * (len - g)), iv = p.intervals[Math.floor(Math.random() * p.intervals.length)], oct = Math.floor(Math.random() * (p.octaves + 1)) * 12;
          var freq = noteHz(base + iv + oct), w = 2 * Math.PI * freq / rate, amp = (.15 + Math.random() * .25) * (p.soft ? .7 : 1), pan = Math.random();
          for (var i = 0; i < g; i++) { var env = .5 - .5 * Math.cos(2 * Math.PI * i / g), v = Math.sin(w * i) * env * amp + (p.partial2 ? Math.sin(w * 2.01 * i) * env * amp * p.partial2 : 0); l[pos + i] += v * (1 - pan); r[pos + i] += v * pan; }
        }
      });
    }
    var src = ctx.createBufferSource(); src.buffer = build(); src.loop = true; src.connect(out); src.start();
    var state = { nodes: [src] };
    state.setRoot = function (newRoot) { if (!p.keyFollow || newRoot === root) return; root = newRoot; var next = ctx.createBufferSource(); next.buffer = build(); next.loop = true; next.connect(out); next.start(); var old = state.nodes[0]; state.nodes[0] = next; try { old.stop(ctx.currentTime + .05); } catch (_) { } };
    return state;
  }
  function makeDrone(ctx, p, out, root) {
    var lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = p.lp; lp.Q.value = .7;
    var sum = ctx.createGain(); sum.gain.value = .8;
    var nodes = [], oscs = [], base = p.keyFollow ? root : p.base;
    p.partials.forEach(function (pt) {
      var o = ctx.createOscillator(), g = ctx.createGain(); o.type = p.wave; o.frequency.value = noteHz(base + pt[0]); o.detune.value = pt[2]; g.gain.value = pt[1]; o.connect(g).connect(sum); o.start(); nodes.push(o); oscs.push({ o: o, iv: pt[0] });
    });
    if (p.formants) { p.formants.forEach(function (f) { var bp = ctx.createBiquadFilter(); bp.type = "peaking"; bp.frequency.value = f[0]; bp.Q.value = 4; bp.gain.value = f[1]; sum.connect(bp).connect(lp); }); }
    else sum.connect(lp);
    lp.connect(out);
    var lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = p.motion; lg.gain.value = p.lp * .25; lfo.connect(lg).connect(lp.frequency); lfo.start(); nodes.push(lfo);
    var state = { nodes: nodes };
    state.setRoot = function (newRoot) { if (!p.keyFollow) return; base = newRoot; var now = ctx.currentTime; oscs.forEach(function (x) { x.o.frequency.setTargetAtTime(noteHz(base + x.iv), now, .4); }); };
    return state;
  }
  function makePulse(ctx, p, out, root, bpm) {
    var state = { nodes: [] }, current = null;
    function build(tempo) {
      var beats = 4, bar = 60 / tempo * beats, steps = p.pattern.length, stepLen = bar * beats / steps / beats;
      var buf = renderBuffer(ctx, bar, function (l, r, rate, len) {
        for (var s = 0; s < steps; s++) {
          var v = p.pattern[s]; if (!v) continue;
          var pos = Math.floor(s * stepLen * rate), dec = rate * p.decay / 1000;
          if (p.kind === "noise" || p.kind === "tick" || p.kind === "chirp") { burst(l, pos, Math.floor(dec * 5) + 8, v * .5, dec, p.kind === "chirp" ? 2 * Math.PI * 4500 / rate : 0); burst(r, pos, Math.floor(dec * 5) + 8, v * .5, dec, p.kind === "chirp" ? 2 * Math.PI * 4800 / rate : 0); }
          else if (p.kind === "thump") { ping(l, pos, rate, p.freq, p.decay, v * .9, 0, false); ping(r, pos, rate, p.freq, p.decay, v * .9, 0, false); }
          else if (p.kind === "tone") { var f = noteHz((p.keyFollow ? root : p.base) + (p.interval || 0)); ping(l, pos, rate, f, p.decay, v * .5, .3, true); ping(r, pos, rate, f * 1.002, p.decay, v * .5, .3, true); }
        }
      });
      return buf;
    }
    var chain = ctx.createGain();
    if (p.lp) { var lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = p.lp; chain.connect(lp).connect(out); }
    else if (p.hp) { var hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = p.hp; chain.connect(hp).connect(out); }
    else chain.connect(out);
    function start(tempo) {
      var src = ctx.createBufferSource(); src.buffer = build(tempo); src.loop = true; src.connect(chain);
      var now = ctx.currentTime, barLen = src.buffer.duration;
      src.start(now, PP.tracksBeatPhase ? (PP.tracksBeatPhase(barLen) || 0) : 0);
      if (current) { try { current.stop(now + .02); } catch (_) { } }
      current = src; state.nodes = [src];
    }
    start(p.fixedBpm || bpm);
    state.setTempo = function (t) { if (!p.fixedBpm) start(t); };
    state.setRoot = function (newRoot) { if (p.keyFollow) { root = newRoot; start(p.fixedBpm || PP.tempoBpm()); } };
    return state;
  }
  function makeStatic(ctx, p, out) {
    var buf = renderBuffer(ctx, 8, function (l, r, rate, len) {
      var count = Math.floor(p.rate * 8), q = Math.pow(2, p.bits - 1);
      for (var k = 0; k < count; k++) {
        var pos = Math.floor(Math.random() * len), n = Math.floor(rate * (p.min + Math.random() * (p.max - p.min)) / 1000), amp = .2 + Math.random() * .4, hold = 0;
        for (var i = 0; i < n && pos + i < len; i++) { if (i % 3 === 0) hold = Math.round((Math.random() * 2 - 1) * q) / q; l[pos + i] += hold * amp; r[pos + i] += hold * amp * (Math.random() < .5 ? 1 : -1); }
      }
    });
    var src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    var hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = p.hp; var lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = p.lp;
    src.connect(hp).connect(lp).connect(out); src.start();
    var nodes = [src];
    if (p.whistle) { var o = ctx.createOscillator(), g = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain(); o.frequency.value = 1800; g.gain.value = .04; lfo.frequency.value = .13; lg.gain.value = 900; lfo.connect(lg).connect(o.frequency); o.connect(g).connect(out); o.start(); lfo.start(); nodes.push(o, lfo); }
    return { nodes: nodes };
  }
  function makeHum(ctx, p, out) {
    var nodes = [];
    p.harmonics.forEach(function (h, i) { var o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = p.freq * h; g.gain.value = p.gains[i] * .5; o.connect(g).connect(out); o.start(); nodes.push(o); });
    if (p.noise) { var n = ctx.createBufferSource(); n.buffer = noiseBuffer(ctx, "pink"); n.loop = true; var lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = p.noiseLp; var g2 = ctx.createGain(); g2.gain.value = p.noise; n.connect(lp).connect(g2).connect(out); n.start(); nodes.push(n); }
    return { nodes: nodes };
  }
  var FAMILIES = { noise: makeNoise, crackle: makeCrackle, drops: makeDrops, grains: makeGrains, drone: makeDrone, pulse: makePulse, static: makeStatic, hum: makeHum };

  // ---------------------------------------------------------------- channels
  function defaultChannel(i) { return { enabled: false, texture: i === 0 ? "rain-soft" : "shimmer-dust", level: 35, highPass: 40, lowPass: 16000, keyFollow: true }; }
  function channels() {
    var p = PP.project();
    if (!Array.isArray(p.textures) || p.textures.length !== 2) p.textures = [defaultChannel(0), defaultChannel(1)];
    p.textures.forEach(function (c, i) { var d = defaultChannel(i); Object.keys(d).forEach(function (k) { if (c[k] === undefined) c[k] = d[k]; }); if (!BY_ID[c.texture]) c.texture = d.texture; });
    return p.textures;
  }
  var live = [null, null], lastRoot = null, lastBpm = null;

  function build(eng) {
    var c = eng && eng.ctx ? eng.ctx : (eng || engine.ctx);
    live.forEach(function (_, i) { live[i] = { input: c.createGain(), hp: c.createBiquadFilter(), lp: c.createBiquadFilter(), gain: c.createGain(), src: null, id: null }; var ch = live[i]; ch.hp.type = "highpass"; ch.lp.type = "lowpass"; ch.gain.gain.value = 0; ch.input.connect(ch.hp).connect(ch.lp).connect(ch.gain).connect(engine.texturesBus); });
    apply();
  }
  engine.hooks.push(build);

  function stopSource(ch) { if (!ch.src) return; var now = engine.ctx.currentTime; ch.src.nodes.forEach(function (n) { try { n.stop(now + .3); } catch (_) { } }); ch.src = null; ch.id = null; }
  function apply() {
    if (!engine.ctx) return;
    var chans = channels(), now = engine.ctx.currentTime, root = rootMidi(0), bpm = PP.tempoBpm();
    chans.forEach(function (c, i) {
      var ch = live[i]; if (!ch) return;
      var def = BY_ID[c.texture];
      if (!c.enabled) { ch.gain.gain.setTargetAtTime(0, now, .4); if (ch.src) setTimeout(function () { if (!channels()[i].enabled) stopSource(ch); }, 1500); return; }
      if (!ch.src || ch.id !== c.texture) {
        stopSource(ch);
        var base = def.p.base || 48, r = base + PP.noteIndex(PP.playKeyFor(PP.currentPad()));
        ch.src = FAMILIES[def.family](engine.ctx, def.p, ch.input, r, bpm); ch.id = c.texture; ch.root = r;
      }
      ch.hp.frequency.setTargetAtTime(clamp(c.highPass, 20, 2000), now, .05); ch.lp.frequency.setTargetAtTime(clamp(c.lowPass, 500, 20000), now, .05);
      ch.gain.gain.setTargetAtTime(Math.pow(clamp(c.level, 0, 100) / 100, 1.5) * .9, now, .25);
    });
    lastRoot = root; lastBpm = bpm;
  }
  function followKey() {
    if (!engine.ctx) return;
    channels().forEach(function (c, i) { var ch = live[i]; if (!ch || !ch.src || !ch.src.setRoot || !c.keyFollow) return; var def = BY_ID[c.texture], r = (def.p.base || 48) + PP.noteIndex(PP.playKeyFor(PP.currentPad())); if (r !== ch.root) { ch.root = r; ch.src.setRoot(r); } });
  }
  function followTempo() {
    if (!engine.ctx) return; var bpm = PP.tempoBpm(); if (bpm === lastBpm) return; lastBpm = bpm;
    live.forEach(function (ch) { if (ch && ch.src && ch.src.setTempo) ch.src.setTempo(bpm); });
  }
  function toggle(i) { var c = channels()[i]; c.enabled = !c.enabled; if (c.enabled) engine.ensure().then(apply); else apply(); PP.persistSoon(); render(); PP.setStatus("Texture " + (i + 1) + (c.enabled ? ": " + BY_ID[c.texture].name : " off")); }
  function setLevel(i, v) { channels()[i].level = Math.round(clamp(v, 0, 1) * 100); apply(); PP.persistSoon(); render(); }

  // ---------------------------------------------------------------- UI
  function options(selected) {
    var html = "", current = null;
    LIBRARY.forEach(function (t) { if (t.cat !== current) { if (current) html += "</optgroup>"; current = t.cat; html += '<optgroup label="' + t.cat + '">'; } html += '<option value="' + t.id + '"' + (t.id === selected ? " selected" : "") + ">" + t.name + "</option>"; });
    return html + "</optgroup>";
  }
  function render() {
    var root = document.querySelector("#textureChannels"); if (!root) return;
    root.innerHTML = channels().map(function (c, i) {
      return '<div class="tex-row' + (c.enabled ? " on" : "") + '" data-tex="' + i + '"><div class="row spread"><label class="toggle"><input type="checkbox" data-tfield="enabled"' + (c.enabled ? " checked" : "") + "> <b>Texture " + (i + 1) + "</b></label>" +
        '<label class="toggle" title="Tonal textures move with the key"><input type="checkbox" data-tfield="keyFollow"' + (c.keyFollow ? " checked" : "") + "> key</label></div>" +
        '<select data-tfield="texture">' + options(c.texture) + "</select>" +
        '<label>Level <span class="control-line"><input type="range" min="0" max="100" data-tfield="level" value="' + c.level + '"><output>' + c.level + "%</output></span></label>" +
        '<label>Low cut <span class="control-line"><input type="range" min="20" max="2000" step="5" data-tfield="highPass" value="' + c.highPass + '"><output>' + c.highPass + " Hz</output></span></label>" +
        '<label>High cut <span class="control-line"><input type="range" min="500" max="20000" step="50" data-tfield="lowPass" value="' + c.lowPass + '"><output>' + (c.lowPass >= 1000 ? (c.lowPass / 1000).toFixed(1) + " kHz" : c.lowPass + " Hz") + "</output></span></label></div>";
    }).join("");
    [0, 1].forEach(function (i) { var b = document.querySelector("#pfTex" + (i + 1)); if (b) { b.classList.toggle("on", !!channels()[i].enabled); b.querySelector("small").textContent = BY_ID[channels()[i].texture].name; } });
  }
  document.addEventListener("input", function (e) {
    var el = e.target, row = el.closest && el.closest("[data-tex]"); if (!row || !el.dataset.tfield) return;
    var c = channels()[Number(row.dataset.tex)], f = el.dataset.tfield;
    c[f] = el.type === "checkbox" ? el.checked : el.tagName === "SELECT" ? el.value : Number(el.value);
    if (f === "enabled" && c.enabled) engine.ensure().then(apply); else apply();
    PP.persistSoon();
    if (el.type === "range") { var out = el.parentNode.querySelector("output"); if (out) out.textContent = f === "level" ? c.level + "%" : f === "lowPass" ? (c.lowPass >= 1000 ? (c.lowPass / 1000).toFixed(1) + " kHz" : c.lowPass + " Hz") : c.highPass + " Hz"; row.classList.toggle("on", !!c.enabled); }
    else render();
  });
  [0, 1].forEach(function (i) { var b = document.querySelector("#pfTex" + (i + 1)); if (b) b.addEventListener("click", function () { toggle(i); }); });
  setInterval(function () { followKey(); followTempo(); }, 400);
  render();

  window.PPTextures = { LIBRARY: LIBRARY, channels: channels, apply: apply, toggle: toggle, setLevel: setLevel, render: render, byId: function (id) { return BY_ID[id]; } };
})();
