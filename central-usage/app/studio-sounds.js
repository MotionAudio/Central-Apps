/* Central Usage - Studio: the sounds a track can play.
 *
 *   Built in (always there, free): Simple Keys, Warm Pad, Synth Bass, Bright Lead, Basic Kit - made with oscillators,
 *     so the Studio works on a computer with no sound banks yet.
 *   SoundFont banks: every .sf2 / .sf3 on this computer (the free starter sounds, the sound libraries of Central Keys and
 *     Central Instrument, the musician's own) - from the app (studio.js), or added in the page (tests).
 * A sound's plan is the same as everywhere else (js/pedals.js soundTier): free, keys, instrument. A locked sound shows
 * its plan and can't be picked; a project saved with one keeps it and plays the built-in sound closest to it.
 *
 *   CUStudioSounds.list()              every sound [{ id, name, bankName, category, tier, file, bank, prog, builtin, drums }]
 *   CUStudioSounds.refresh()           ask the app for the banks again
 *   CUStudioSounds.locked(sound)       true when its plan isn't active
 *   CUStudioSounds.instrument(ctx, layers) -> Instrument { ready, noteOn(dest, note, vel, when) -> voice, noteOff(voice, when), allOff(when) }
 *   CUStudioSounds.addBank(name, bytes, tier)   a bank from memory (tests, a dropped file)
 */
(function () {
  "use strict";
  var NAT = window.CU && window.CU.studio;
  var banks = [], memBanks = {}, opened = {}, changed = [];
  var CATS = [[/drum|kit|percussion|\bperc\b/i, "Drums"], [/rhodes|wurli|e\.? ?piano|elec.*piano|\bep\b|fm[ _-]?piano|\bdx|tine|clav/i, "Electric pianos"], [/harp|guitar|nylon|banjo|sitar|koto|dulcimer|shamisen/i, "Guitars & harp"], [/grand|concert|steinway|yamaha|piano|upright|honky|salamander|ydp|keys/i, "Pianos"], [/organ|drawbar|hammond|b3|church|pipe|rotary|accordion|harmonica/i, "Organs"], [/\bbass\b|bass ?yr/i, "Bass"], [/brass|trumpet|horn|trombone|sax|tuba|oboe|flute|clarinet|bassoon|recorder|pan ?flute|whistle|ocarina/i, "Brass & winds"], [/pad|choir|voice|vox|aah|ooh|halo|atmos|sweep|warm|bowed|space|dream/i, "Pads & choirs"], [/string|violin|cello|viola|orch|ensemble|pizz/i, "Strings"], [/bell|glock|vibra|marimba|celest|music box|tubular|kalimba|chime|xylo|timpani|steel dr|mallet/i, "Bells & mallets"], [/lead|square|saw|synth|poly|wave/i, "Synths & leads"]];
  var CAT_ORDER = ["Pianos", "Electric pianos", "Organs", "Synths & leads", "Pads & choirs", "Strings", "Bass", "Guitars & harp", "Brass & winds", "Bells & mallets", "Drums", "Other"];
  function categoryOf(name, drums) { if (drums) return "Drums"; for (var i = 0; i < CATS.length; i++) if (CATS[i][0].test(name)) return CATS[i][1]; return "Other"; }

  var BUILTIN = [
    { id: "builtin:keys", name: "Simple Keys", category: "Pianos" }, { id: "builtin:pad", name: "Warm Pad", category: "Pads & choirs" },
    { id: "builtin:bass", name: "Synth Bass", category: "Bass" }, { id: "builtin:lead", name: "Bright Lead", category: "Synths & leads" },
    { id: "builtin:kit", name: "Basic Kit", category: "Drums", drums: true }
  ].map(function (s) { return Object.assign(s, { builtin: true, bankName: "Built in", tier: "free" }); });

  function tierOf(s) {
    if (s.builtin) return "free";
    var P = window.PPPedals;
    if (s.bankTier) return s.bankTier;
    if (s.user) return "free";
    if (s.drums) return "instrument";   // (drum kits: Central Instrument, like the libraries' kits)
    return P && P.soundTier ? P.soundTier(s) : "keys";
  }
  function flatten() {
    var out = BUILTIN.slice();
    banks.concat(Object.keys(memBanks).map(function (k) { return memBanks[k].entry; })).forEach(function (b) {
      (b.presets || []).forEach(function (pr) {
        var nm = pr.name || b.name, drums = pr.bank >= 128;
        var s = { id: b.file + "#" + pr.bank + ":" + pr.prog, file: b.file, bank: pr.bank, prog: pr.prog, name: nm, bankName: b.name + (b.user && !b.tier ? " (yours)" : ""), drums: drums, user: !!b.user && !b.tier, bankTier: b.tier || null };
        s.category = categoryOf(nm + " " + ((b.presets || []).length < 4 ? b.name : ""), drums);
        s.tier = tierOf(s); out.push(s);
      });
    });
    out.sort(function (a, b) { return (a.builtin ? -1 : 0) - (b.builtin ? -1 : 0) || CAT_ORDER.indexOf(a.category) - CAT_ORDER.indexOf(b.category) || a.name.localeCompare(b.name); });
    return out;
  }
  var cache = null;
  function list() { if (!cache) cache = flatten(); return cache; }
  function byId(id) { return list().filter(function (s) { return s.id === id; })[0] || null; }
  function locked(s) { if (!s) return false; var P = window.PPPedals, t = s.tier || tierOf(s); return !!(t && t !== "free" && P && P.has && !P.has(t)); }
  function lockText(s) { var P = window.PPPedals, t = s && (s.tier || tierOf(s)); return P && P.lockText ? P.lockText(t) : "Needs a sound plan"; }
  function refresh() {
    if (!NAT || !NAT.catalog) { cache = null; fire(); return Promise.resolve(list()); }
    return NAT.catalog().then(function (b) { banks = Array.isArray(b) ? b : []; cache = null; fire(); return list(); }).catch(function () { return list(); });
  }
  function fire() { changed.forEach(function (fn) { try { fn(); } catch (_) { } }); }
  function addBank(name, bytes, tier) {
    var file = "mem:" + name, u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    return window.CUSf2.open(window.CUSf2.fromBytes(u8)).then(function (bank) {
      memBanks[file] = { bytes: u8, entry: { file: file, name: name, presets: bank.presets.map(function (p) { return { name: p.name, bank: p.bank, prog: p.prog }; }), tier: tier || null, user: !tier } };
      opened[file] = Promise.resolve(bank); cache = null; fire(); return list();
    });
  }
  function bankFor(file) {
    if (opened[file]) return opened[file];
    var reader = memBanks[file] ? window.CUSf2.fromBytes(memBanks[file].bytes) : NAT && NAT.read ? function (o, n) { return NAT.read(file, o, n).then(function (b) { return b instanceof Uint8Array ? b : new Uint8Array(b); }); } : null;
    if (!reader) return Promise.reject(new Error("can't read " + file + " here"));
    opened[file] = window.CUSf2.open(reader).catch(function (e) { delete opened[file]; throw e; });
    return opened[file];
  }

  // ------------------------------------------------------------- the built-in sounds (oscillators)
  function noiseBuffer(ctx) { if (ctx.__cuNoise) return ctx.__cuNoise; var n = ctx.sampleRate, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0), s = 1; for (var i = 0; i < n; i++) { s = (s * 16807) % 2147483647; d[i] = s / 1073741823.5 - 1; } ctx.__cuNoise = b; return b; }
  function mtof(n) { return 440 * Math.pow(2, (n - 69) / 12); }
  function synthVoice(ctx, kind, note, vel, when, dest) {
    var t = Math.max(when, ctx.currentTime), g = ctx.createGain(), oscs = [], nodes = [g], v = Math.pow(vel / 127, 1.4);
    g.gain.value = 0; g.connect(dest);
    function osc(type, f, det, level, to) { var o = ctx.createOscillator(), og = ctx.createGain(); o.type = type; o.frequency.value = f; o.detune.value = det || 0; og.gain.value = level; o.connect(og).connect(to || g); o.start(t); oscs.push(o); nodes.push(og); return o; }
    var rel = 0.25, peak = 0.3 * v;
    if (kind === "keys") { osc("triangle", mtof(note), 0, 0.6); osc("sine", mtof(note) * 2, 3, 0.25); osc("sine", mtof(note) * 4, -4, 0.06); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + 0.005); g.gain.setTargetAtTime(peak * 0.25, t + 0.01, 0.6); rel = 0.35; }
    else if (kind === "pad") { var f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 1400; f.Q.value = 0.5; f.connect(g); nodes.push(f); osc("sawtooth", mtof(note), -8, 0.22, f); osc("sawtooth", mtof(note), 8, 0.22, f); osc("sine", mtof(note) / 2, 0, 0.2, f); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak * 0.8, t + 0.6); rel = 1.4; }
    else if (kind === "bass") { var fb = ctx.createBiquadFilter(); fb.type = "lowpass"; fb.frequency.setValueAtTime(1800, t); fb.frequency.setTargetAtTime(380, t, 0.08); fb.connect(g); nodes.push(fb); osc("square", mtof(note), 0, 0.3, fb); osc("sine", mtof(note) / 2, 0, 0.6, fb); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak * 1.2, t + 0.004); g.gain.setTargetAtTime(peak * 0.7, t + 0.01, 0.3); rel = 0.12; }
    else { var fl = ctx.createBiquadFilter(); fl.type = "lowpass"; fl.frequency.value = 4200; fl.Q.value = 2; fl.connect(g); nodes.push(fl); osc("sawtooth", mtof(note), 0, 0.3, fl); osc("square", mtof(note), 5, 0.15, fl); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak * 0.8, t + 0.01); rel = 0.2; }
    return { g: g, oscs: oscs, rel: rel, start: t, release: function (w) { var at = Math.max(w, ctx.currentTime); try { g.gain.cancelAndHoldAtTime(at); } catch (_) { g.gain.cancelScheduledValues(at); } g.gain.setTargetAtTime(0, at, rel / 4); oscs.forEach(function (o) { try { o.stop(at + rel * 1.5 + 0.05); } catch (_) { } }); },
      kill: function (w) { var at = Math.max(w || 0, ctx.currentTime); g.gain.cancelScheduledValues(at); g.gain.setValueAtTime(0, at); oscs.forEach(function (o) { try { o.stop(at + 0.01); } catch (_) { } }); } };
  }
  // the Basic Kit: General MIDI drum notes (36 kick, 38/40 snare, 37 rim, 39 clap, 42/44 closed hat, 46 open hat, 49/57 crash, 51/59 ride, toms 41-50)
  function drumVoice(ctx, note, vel, when, dest) {
    var t = Math.max(when, ctx.currentTime), v = Math.pow(vel / 127, 1.2), srcs = [];
    function noise(dur, type, freq, q, level) { var s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), ng = ctx.createGain(); s.buffer = noiseBuffer(ctx); f.type = type; f.frequency.value = freq; f.Q.value = q || 0.7; ng.gain.setValueAtTime(level * v, t); ng.gain.exponentialRampToValueAtTime(0.0005, t + dur); s.connect(f).connect(ng).connect(dest); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02); srcs.push(s); }
    function tone(f0, f1, dur, level, type) { var o = ctx.createOscillator(), og = ctx.createGain(); o.type = type || "sine"; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.6); og.gain.setValueAtTime(level * v, t); og.gain.exponentialRampToValueAtTime(0.0005, t + dur); o.connect(og).connect(dest); o.start(t); o.stop(t + dur + 0.02); srcs.push(o); }
    if (note === 35 || note === 36) { tone(150, 45, 0.45, 0.9); noise(0.02, "highpass", 2000, 0.7, 0.15); }
    else if (note === 38 || note === 40) { tone(220, 160, 0.12, 0.35, "triangle"); noise(0.22, "highpass", 1200, 0.7, 0.5); }
    else if (note === 37) { tone(800, 600, 0.04, 0.4, "square"); }
    else if (note === 39) { [0, 0.012, 0.024].forEach(function (d) { var s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), ng = ctx.createGain(); s.buffer = noiseBuffer(ctx); f.type = "bandpass"; f.frequency.value = 1500; ng.gain.setValueAtTime(0.5 * v, t + d); ng.gain.exponentialRampToValueAtTime(0.001, t + d + 0.08); s.connect(f).connect(ng).connect(dest); s.start(t + d); s.stop(t + d + 0.1); srcs.push(s); }); }
    else if (note === 42 || note === 44) noise(0.06, "highpass", 7000, 0.7, 0.35);
    else if (note === 46) noise(0.35, "highpass", 6500, 0.7, 0.3);
    else if (note === 49 || note === 57 || note === 52 || note === 55) noise(1.4, "highpass", 4500, 0.5, 0.35);
    else if (note === 51 || note === 59 || note === 53) { noise(0.8, "bandpass", 5200, 1.5, 0.25); tone(3100, 3000, 0.6, 0.05, "square"); }
    else if (note >= 41 && note <= 50) { var f = 70 + (note - 41) * 18; tone(f * 1.6, f, 0.35, 0.7); }
    else tone(mtof(note), mtof(note), 0.15, 0.3, "triangle");
    return { start: t, excl: note === 42 || note === 44 || note === 46 ? 1 : 0, release: function () { }, kill: function (w) { var at = Math.max(w || 0, ctx.currentTime); srcs.forEach(function (s) { try { s.stop(at + 0.01); } catch (_) { } }); } };
  }

  // ------------------------------------------------------------- a track's instrument: its layers (split, layer, velocity zones)
  function Instrument(ctx, layers) {
    var self = this; this.ctx = ctx; this.voices = [];
    this.layers = (layers || []).filter(function (l) { return l && l.sound; }).map(function (l) {
      var s = byId(l.sound) || (/^builtin:/.test(l.sound) ? null : { id: l.sound, file: l.file, bank: l.bank || 0, prog: l.prog || 0, name: l.name || "Sound", tier: l.tier || "keys" });
      var lk = s && locked(s);
      if (!s || lk) s = byId(stand_in(l)) || BUILTIN[0];   // a locked (or missing) sound: the built-in one closest to it
      return Object.assign({ lo: 0, hi: 127, velLo: 1, velHi: 127, octave: 0, transpose: 0, volume: 1, pan: 0 }, l, { s: s, standIn: !!lk });
    });
    if (!this.layers.length) this.layers = [{ s: BUILTIN[0], lo: 0, hi: 127, velLo: 1, velHi: 127, octave: 0, transpose: 0, volume: 1, pan: 0 }];
    this.ready = Promise.all(this.layers.map(function (L) {
      if (L.s.builtin) return null;
      return bankFor(L.s.file).then(function (bank) {
        var pi = bank.presetIndex(L.s.bank, L.s.prog); if (pi < 0) pi = 0;
        L.bank = bank; L.regions = bank.regions(pi);
        return Promise.all(L.regions.map(function (r) { return bank.buffer(ctx, r.sample).then(function (b) { r.buf = b; r.info = bank.sampleInfo(r.sample); }).catch(function () { }); }));
      }).catch(function (e) { L.error = String(e && e.message || e); L.s = BUILTIN[0]; });
    })).then(function () { return self; });
  }
  function stand_in(l) { var n = (l.name || "") + " " + (l.category || ""); return /drum|kit|perc/i.test(n) || l.bank >= 128 ? "builtin:kit" : /bass/i.test(n) ? "builtin:bass" : /pad|string|choir|warm/i.test(n) ? "builtin:pad" : /lead|synth|saw/i.test(n) ? "builtin:lead" : "builtin:keys"; }
  Instrument.prototype.noteOn = function (dest, note, vel, when) {
    var ctx = this.ctx, out = [], self = this; when = when || 0;
    this.layers.forEach(function (L) {
      if (note < L.lo || note > L.hi || vel < L.velLo || vel > L.velHi) return;
      var n = note + 12 * (L.octave || 0) + (L.transpose || 0); if (n < 0 || n > 127) return;
      var lg = ctx.createGain(); lg.gain.value = L.volume == null ? 1 : L.volume; var lp = null;
      if (L.pan) { lp = ctx.createStereoPanner(); lp.pan.value = L.pan; lg.connect(lp).connect(dest); } else lg.connect(dest);
      var v;
      if (L.s.builtin) v = L.s.id === "builtin:kit" ? drumVoice(ctx, n, vel, when, lg) : synthVoice(ctx, L.s.id.slice(8), n, vel, when, lg);
      else v = sf2Voice(ctx, L, n, vel, when, lg);
      if (!v) { lg.disconnect(); return; }
      v.layerGain = lg; out.push(v);
      if (v.excl) self.voices.forEach(function (o) { if (o !== v && o.excl === v.excl && o.layer === L) o.kill(v.start); });
      v.layer = L;
    });
    var voice = { parts: out, note: note, start: when };
    this.voices = this.voices.concat(out).slice(-160);
    if (this.voices.length > 150) this.voices.slice(0, 20).forEach(function (o) { o.kill(when); });
    return voice;
  };
  Instrument.prototype.noteOff = function (voice, when) { if (voice) voice.parts.forEach(function (p) { p.release(when || 0); }); };
  Instrument.prototype.allOff = function (when, hard) { var ctx = this.ctx; this.voices.forEach(function (v) { if (hard) v.kill(when || ctx.currentTime); else v.release(when || ctx.currentTime); }); this.voices = []; };
  Instrument.prototype.names = function () { return this.layers.map(function (L) { return L.s.name + (L.standIn ? " (stand-in)" : ""); }); };

  function sf2Voice(ctx, L, note, vel, when, dest) {
    var rs = (L.regions || []).filter(function (r) { return r.buf && note >= r.lo && note <= r.hi && vel >= r.vlo && vel <= r.vhi; });
    if (!rs.length) return null;
    var t = Math.max(when, ctx.currentTime), parts = [], excl = 0;
    rs.forEach(function (r) {
      var src = ctx.createBufferSource(), g = ctx.createGain(), info = r.info || {}, rate = info.rate || r.buf.sampleRate;
      src.buffer = r.buf;
      src.playbackRate.value = Math.pow(2, ((note - r.root) * (r.scale / 100) + r.tune / 100) / 12);
      if ((r.loop === 1 || r.loop === 3) && info.loopEnd > info.loopStart) {
        src.loop = true; src.loopStart = Math.max(0, (info.loopStart - info.start + (r.loopStartOfs || 0)) / rate); src.loopEnd = Math.min(r.buf.duration, (info.loopEnd - info.start + (r.loopEndOfs || 0)) / rate);
      }
      var peak = Math.pow(10, -r.atten / 20) * Math.pow(vel / 127, 1.6) * 0.9;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + Math.max(0.002, r.attack));
      var d0 = t + Math.max(0.002, r.attack) + r.hold; g.gain.setValueAtTime(peak, d0); g.gain.setTargetAtTime(peak * r.sustain, d0, Math.max(0.005, r.decay / 5));
      var node = src;
      if (r.cutoff > 0) { var f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = Math.min(20000, r.cutoff); src.connect(f); node = f; }
      if (r.pan) { var p = ctx.createStereoPanner(); p.pan.value = r.pan; node.connect(p); node = p; }
      node.connect(g).connect(dest);
      src.start(t, Math.max(0, (r.startOfs || 0) / rate));
      if (!src.loop) src.stop(t + r.buf.duration / src.playbackRate.value + 0.05);
      if (r.excl) excl = r.excl;
      parts.push({ src: src, g: g, r: r });
    });
    return { start: t, excl: excl, release: function (w) { var at = Math.max(w, ctx.currentTime); parts.forEach(function (p) { try { p.g.gain.cancelAndHoldAtTime(at); } catch (_) { p.g.gain.cancelScheduledValues(at); } p.g.gain.setTargetAtTime(0, at, Math.max(0.005, p.r.release / 5)); try { p.src.stop(at + p.r.release + 0.1); } catch (_) { } }); },
      kill: function (w) { var at = Math.max(w || 0, ctx.currentTime); parts.forEach(function (p) { p.g.gain.cancelScheduledValues(at); p.g.gain.setTargetAtTime(0, at, 0.004); try { p.src.stop(at + 0.03); } catch (_) { } }); } };
  }
  window.CUStudioSounds = { list: list, byId: byId, locked: locked, lockText: lockText, refresh: refresh, addBank: addBank, BUILTIN: BUILTIN, CAT_ORDER: CAT_ORDER, categoryOf: categoryOf,
    instrument: function (ctx, layers) { return new Instrument(ctx, layers); }, onChange: function (fn) { changed.push(fn); }, standIn: stand_in, nativeLayers: function (layers) {
      // the layers cu-studio can play (SoundFont sounds that aren't locked); null when any layer is built in (then the page plays them)
      var out = []; for (var i = 0; i < (layers || []).length; i++) { var l = layers[i], s = byId(l.sound); if (!s || s.builtin || locked(s) || /^mem:/.test(s.file)) return null; out.push({ file: s.file, bank: s.bank, prog: s.prog, lo: l.lo == null ? 0 : l.lo, hi: l.hi == null ? 127 : l.hi, velLo: l.velLo || 1, velHi: l.velHi || 127, octave: l.octave || 0, transpose: l.transpose || 0, volume: l.volume == null ? 1 : l.volume, pan: l.pan || 0 }); }
      return out.length ? out : null; } };
})();
