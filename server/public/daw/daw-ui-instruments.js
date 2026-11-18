/* The DAW's own instruments (10.8): bring in an instrument from anywhere and play it on a track.
 *
 *   SoundFonts (.sf2 / .sf3): added to the sounds (in the apps it's also installed on this computer as one of your own
 *     sounds, so Central Control, Central Usage and the low-delay player have it too); the track plays its first preset.
 *   SFZ (.sfz with its samples, or the folder they're in) and Decent Sampler (.dspreset with its samples): read into a
 *     sampler layer - the samples go into the project, so it opens the same anywhere, and nothing is lost converting it.
 *   Samples (WAV, FLAC, AIFF, OGG, MP3) dropped on an instrument track: named by note ("Piano C4.wav", "Vln_A#3"), they
 *     spread across the keyboard; one sample on its own plays across every key from its note (or C4). Dropped on a drums
 *     track, each sample becomes a pad of the kit on its General MIDI note (a kick on C1, a snare on D1, hats on F#1 and
 *     A#1…, guessed from its name; anything else on the next free key) - add more by dropping more.
 * The track that's dropped on plays it; dropped anywhere else, a new track does.
 *
 *   CDawUI.addInstrument({ sfz: [entry], dspreset: [entry], samples: [entry], banks: [entry], all: [entry] }, trackId) -> Promise
 *     an entry: { file (a File), path } or { name, bytes, path }
 *   CDawUI.sfz(text) / CDawUI.dspreset(text)   the regions in them (tests)
 *   CDawUI.drumNote(name)  CDawUI.noteFromName(name) */
(function () {
  "use strict";
  var D = window.CDaw, UI = window.CDawUI, SND = window.CUStudioSounds; if (!D || !UI) return;
  var U = UI.U;
  var NOTES = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  function nameOf(e) { return (e && (e.name || (e.file && e.file.name) || e.path)) || ""; }
  function bytesOf(e) { return e.bytes ? Promise.resolve(e.bytes instanceof Uint8Array ? e.bytes : new Uint8Array(e.bytes)) : e.file.arrayBuffer().then(function (b) { return new Uint8Array(b); }); }
  function textOf(e) { return bytesOf(e).then(function (b) { return new TextDecoder().decode(b); }); }
  function base(n) { return String(n || "").replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, ""); }
  function clampN(v, a, b) { v = Math.round(+v); return isFinite(v) ? Math.max(a, Math.min(b, v)) : a; }

  // "C4", "c#3", "Db2", "A-1", "Fs3" → MIDI (C4 = 60); a bare number 0-127 too ("060")
  function noteFromName(n) {
    var s = base(n), m = /(?:^|[^a-z])([a-g])(#|b|s|♯|♭)?(-?\d)(?![0-9])/i.exec(s);
    if (m) { var v = NOTES[m[1].toLowerCase()] + (m[2] === "#" || m[2] === "s" || m[2] === "♯" ? 1 : m[2] === "b" || m[2] === "♭" ? -1 : 0) + (+m[3] + 1) * 12; if (v >= 0 && v <= 127) return v; }
    var k = /(?:^|[^0-9])(\d{2,3})(?:[^0-9]|$)/.exec(s); if (k && +k[1] >= 12 && +k[1] <= 115 && !/bpm|hz|khz|bit/i.test(s)) return +k[1];
    return null;
  }
  function sfzNote(v) { if (v == null || v === "") return null; if (/^-?\d+$/.test(String(v).trim())) return clampN(v, 0, 127); var m = /^([a-g])(#|b)?(-?\d)$/i.exec(String(v).trim()); if (!m) return null; return clampN(NOTES[m[1].toLowerCase()] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0) + (+m[3] + 1) * 12, 0, 127); }
  // the General MIDI drum note for a sample, from its name; null: the next free key
  var DRUMS = [[/kick|bd\b|bass ?drum|\bkik\b/i, 36], [/snare|\bsd\b|\bsn\b/i, 38], [/rim|side ?stick|stick/i, 37], [/clap|\bcp\b/i, 39], [/(open|\boh\b).*h(i|-)?h?at|o-?hh|open ?hat/i, 46], [/pedal ?hat|foot ?hat|\bph\b/i, 44],
    [/h(i|-)?h?at|\bhh\b|\bch\b|closed/i, 42], [/crash/i, 49], [/ride/i, 51], [/china/i, 52], [/splash/i, 55], [/floor ?tom|low ?tom|tom ?(3|4|low)/i, 41], [/mid ?tom|tom ?2/i, 45], [/(hi|high|rack) ?tom|tom ?1|\btom\b/i, 48],
    [/tamb/i, 54], [/cowbell/i, 56], [/shak|maraca/i, 70], [/conga/i, 63], [/bongo/i, 60], [/cabasa/i, 69], [/triangle/i, 81], [/wood ?block|block/i, 76], [/snap|finger/i, 39], [/cajon/i, 36], [/perc/i, 64]];
  function drumNote(n) { var s = base(n); for (var i = 0; i < DRUMS.length; i++) if (DRUMS[i][0].test(s)) return DRUMS[i][1]; return null; }

  // ------------------------------------------------------------- SFZ
  // the opcodes that matter for playing it; round robins play their first sample, release triggers and keyswitched
  // articulations other than the default are left out
  function sfz(text, defines) {
    defines = defines || {};
    text = String(text).replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
    var out = [], scope = { control: {}, global: {}, master: {}, group: {} }, cur = null, head = null, swDefault = null;
    text.replace(/#define\s+(\$\w+)\s+(\S+)/g, function (_, k, v) { defines[k] = v; return ""; });
    text = text.replace(/#define[^\n]*/g, " ").replace(/\$\w+/g, function (k) { return defines[k] != null ? defines[k] : k; });
    function flush() { if (head === "region" && cur) out.push(Object.assign({}, scope.global, scope.master, scope.group, cur)); cur = null; }
    var tokens = text.match(/<\w+>|[\w$]+=(?:(?!\s+[\w$]+=|\s*<\w+>).)*/g) || [];
    tokens.forEach(function (tok) {
      var h = /^<(\w+)>$/.exec(tok);
      if (h) { flush(); head = h[1].toLowerCase(); if (head === "region") cur = {}; else if (scope[head]) { scope[head] = head === "control" ? scope.control : {}; if (head === "global") { scope.master = {}; scope.group = {}; } if (head === "master") scope.group = {}; } return; }
      var eq = tok.indexOf("="), k = tok.slice(0, eq).trim().toLowerCase(), v = tok.slice(eq + 1).trim();
      if (head === "region" && cur) cur[k] = v; else if (scope[head]) scope[head][k] = v;
      if (k === "sw_default") swDefault = sfzNote(v);
    });
    flush();
    var dp = (scope.control.default_path || "").replace(/\\/g, "/"), noteOfs = +(scope.control.note_offset || 0), octOfs = +(scope.control.octave_offset || 0);
    return out.filter(function (r) { return r.sample && (!r.trigger || r.trigger === "attack" || r.trigger === "first") && (!r.seq_position || +r.seq_position === 1) && (r.sw_last == null || swDefault == null || sfzNote(r.sw_last) === swDefault) && !/^\*/.test(r.sample); }).map(function (r) {
      var key = sfzNote(r.key), lo = key != null ? key : sfzNote(r.lokey), hi = key != null ? key : sfzNote(r.hikey), root = sfzNote(r.pitch_keycenter);
      var shift = noteOfs + octOfs * 12;
      if (lo == null) lo = 0; if (hi == null) hi = 127; if (root == null) root = key != null ? key : lo === hi ? lo : 60;
      var loop = /loop_continuous|loop_sustain/.test(r.loop_mode || "") ? { on: true, start: +(r.loop_start || r.loopstart || 0), end: +(r.loop_end || r.loopend || 0) } : null;
      return { sample: (dp + r.sample).replace(/\\/g, "/"), lo: clampN(lo + shift, 0, 127), hi: clampN(hi + shift, 0, 127), root: clampN(root + shift - (+(r.transpose || 0)), 0, 127), vlo: clampN(r.lovel || 1, 1, 127), vhi: clampN(r.hivel || 127, 1, 127),
        tune: +(r.tune || 0) || 0, gain: Math.pow(10, (+(r.volume || 0) || 0) / 20), pan: Math.max(-1, Math.min(1, (+(r.pan || 0) || 0) / 100)), offset: +(r.offset || 0) || 0, loop: loop,
        oneshot: r.loop_mode === "one_shot", group: +(r.group || 0) && r.off_by ? +r.group : 0, fixed: r.pitch_keytrack != null && +r.pitch_keytrack === 0,
        env: { attack: +(r.ampeg_attack || 0.002) || 0.002, hold: +(r.ampeg_hold || 0) || 0, decay: +(r.ampeg_decay || 0.4) || 0.4, sustain: r.ampeg_sustain != null ? Math.max(0, Math.min(1, +r.ampeg_sustain / 100)) : 1, release: Math.max(0.005, +(r.ampeg_release || 0.25) || 0.25) } };
    });
  }

  // ------------------------------------------------------------- Decent Sampler (.dspreset: XML)
  function num(v, d) { v = parseFloat(v); return isFinite(v) ? v : d; }
  function dsVol(v) { if (v == null || v === "") return 1; var s = String(v).trim(); if (/db$/i.test(s)) return Math.pow(10, num(s, 0) / 20); return num(s, 1); }
  function dspreset(text) {
    var doc = new DOMParser().parseFromString(String(text), "application/xml"); if (doc.querySelector("parsererror")) throw new Error("That Decent Sampler file can't be read.");
    var out = [], groupsEl = doc.querySelector("groups"), gEnv = envOf(groupsEl, {});
    function envOf(el, d) { if (!el) return d; return { attack: num(el.getAttribute("attack"), d.attack != null ? d.attack : 0.002), decay: num(el.getAttribute("decay"), d.decay != null ? d.decay : 0.4), sustain: num(el.getAttribute("sustain"), d.sustain != null ? d.sustain : 1), release: num(el.getAttribute("release"), d.release != null ? d.release : 0.25) }; }
    Array.prototype.forEach.call(doc.querySelectorAll("group"), function (g) {
      if (/^false$/i.test(g.getAttribute("enabled") || "")) return;
      var env = envOf(g, gEnv), gVol = dsVol(g.getAttribute("volume")), gTune = num(g.getAttribute("tuning"), 0), gTrig = g.getAttribute("trigger") || "";
      Array.prototype.forEach.call(g.querySelectorAll("sample"), function (sm) {
        var trig = sm.getAttribute("trigger") || gTrig; if (/release/i.test(trig)) return;
        var seq = sm.getAttribute("seqPosition") || g.getAttribute("seqPosition"); if (seq && +seq > 1) return;
        var root = num(sm.getAttribute("rootNote"), 60), lo = num(sm.getAttribute("loNote"), root), hi = num(sm.getAttribute("hiNote"), root), ls = sm.getAttribute("loopStart"), le = sm.getAttribute("loopEnd");
        out.push({ sample: String(sm.getAttribute("path") || "").replace(/\\/g, "/"), root: clampN(root, 0, 127), lo: clampN(lo, 0, 127), hi: clampN(hi, 0, 127), vlo: clampN(num(sm.getAttribute("loVel"), 1), 1, 127), vhi: clampN(num(sm.getAttribute("hiVel"), 127), 1, 127),
          tune: (num(sm.getAttribute("tuning"), 0) + gTune) * 100, gain: dsVol(sm.getAttribute("volume")) * gVol, offset: num(sm.getAttribute("start"), 0),
          loop: ls != null && le != null && !/^false$/i.test(sm.getAttribute("loopEnabled") || "true") ? { on: true, start: num(ls, 0), end: num(le, 0) } : null, env: envOf(sm, env) });
      });
    });
    return out;
  }

  // ------------------------------------------------------------- putting it on a track
  function findSample(want, entries, from) {
    // a sample named in an instrument file: by its path next to the file, then by its name alone (case doesn't matter)
    var w = String(want).replace(/^\.\//, "").toLowerCase(), dir = String(from || "").replace(/[^/]*$/, "").toLowerCase(), full = norm(dir + w);
    function norm(p) { var a = []; p.split("/").forEach(function (x) { if (x === "..") a.pop(); else if (x && x !== ".") a.push(x); }); return a.join("/"); }
    var byPath = entries.filter(function (e) { return norm(String(e.path || nameOf(e)).toLowerCase()) === full; })[0];
    if (byPath) return byPath;
    var bn = w.replace(/^.*\//, ""); return entries.filter(function (e) { return nameOf(e).toLowerCase() === bn || String(e.path || "").toLowerCase().replace(/^.*\//, "") === bn; })[0] || null;
  }
  // a FLAC's own sample rate (WAVs keep theirs when they're read; anything the browser decodes comes at the computer's
  // rate, so loop points and start offsets, counted in the file's frames, are scaled to match)
  function flacRate(b) { return b.length > 21 && b[0] === 0x66 && b[1] === 0x4C && b[2] === 0x61 && b[3] === 0x43 ? ((b[18] << 12) | (b[19] << 4) | (b[20] >> 4)) : 0; }
  function decodeAll(list) {   // [entry] -> { ids: { path: audioId }, scale: { path: frames factor }, bad: [names] }
    var ids = {}, scale = {}, bad = [];
    return list.reduce(function (p, e) { return p.then(function () { var k = e.path || nameOf(e), fr = 0; if (ids[k]) return; return bytesOf(e).then(function (b) { fr = flacRate(b); return D.decode(b); }).then(function (buf) { ids[k] = D.addAudio(buf); scale[k] = fr ? buf.sampleRate / fr : 1; }).catch(function () { bad.push(nameOf(e)); }); }); }, Promise.resolve()).then(function () { return { ids: ids, scale: scale, bad: bad }; });
  }
  function targetFor(trackId, drums, name) {
    var t = trackId && D.track(trackId);
    if (t && t.kind !== "audio" && t.kind !== "bus" && (!drums || t.kind === "drums" || !t.clips.length)) return { id: t.id, fresh: false };
    return { id: null, fresh: true, kind: drums ? "drums" : "instrument", name: String(name || (drums ? "Kit" : "Sampler")).slice(0, 24) };
  }
  function putLayer(target, layer, label, opts) {
    opts = opts || {};
    return D.edit(label, function (p) {
      var t = target.id && D.track(target.id);
      if (!t) { t = D.newTrack(target.kind, target.name); t.color = D.COLORS[p.tracks.length % D.COLORS.length]; D.insertTrack(t); }
      var keep = (t.layers || [])[0] || {};
      layer = Object.assign({ lo: 0, hi: 127, velLo: 1, velHi: 127, octave: 0, transpose: 0, volume: keep.volume == null ? 1 : keep.volume, pan: keep.pan || 0 }, layer);
      if (opts.add && keep.sound === "sampler") { keep.zones = (keep.zones || []).concat(layer.zones); if (layer.kit) keep.kit = true; }
      else t.layers = [layer].concat((t.layers || []).slice(1));
      U.sel = t.id; return t;
    });
  }
  function zonesFrom(regions, dec, entries, from) {
    var zones = [], missing = [];
    regions.forEach(function (r) {
      var e = findSample(r.sample, entries, from), k = e && (e.path || nameOf(e)), id = k && dec.ids[k], f = (k && dec.scale[k]) || 1;
      if (!id) { if (missing.indexOf(r.sample) < 0) missing.push(r.sample); return; }
      var z = Object.assign({}, r, { src: id, name: base(r.sample) }); delete z.sample;
      if (f !== 1) { if (z.loop) z.loop = { on: z.loop.on, start: Math.round(z.loop.start * f), end: Math.round(z.loop.end * f) }; if (z.offset) z.offset = Math.round(z.offset * f); }
      zones.push(z);
    });
    return { zones: zones, missing: missing };
  }
  function fromFile(kind, f, all, trackId) {
    return textOf(f).then(function (text) {
      var regs = kind === "sfz" ? sfz(text) : dspreset(text), name = base(nameOf(f));
      if (!regs.length) throw new Error(nameOf(f) + " has no samples in it.");
      var want = []; regs.forEach(function (r) { var e = findSample(r.sample, all, f.path || nameOf(f)); if (e && want.indexOf(e) < 0) want.push(e); });
      if (!want.length) throw new Error("The samples for " + nameOf(f) + " weren't there. Drop the whole folder the instrument is in (the file and its samples together).");
      UI.say("Bringing in " + name + " (" + want.length + " sample" + (want.length > 1 ? "s" : "") + ")…");
      return decodeAll(want).then(function (dec) {
        var z = zonesFrom(regs, dec, all, f.path || nameOf(f)); if (!z.zones.length) throw new Error("None of " + name + "'s samples could be read.");
        var drums = z.zones.every(function (x) { return x.lo === x.hi; }) && z.zones.length > 2 && /drum|kit|perc/i.test(name);
        var t = putLayer(targetFor(trackId, drums, name), { sound: "sampler", name: name, zones: z.zones, kit: drums || undefined }, "Instrument: " + name);
        UI.say("“" + t.name + "” plays " + name + " (" + z.zones.length + " sample zones)" + (z.missing.length + dec.bad.length ? " · " + (z.missing.length + dec.bad.length) + " sample" + (z.missing.length + dec.bad.length > 1 ? "s" : "") + " missing" : "") + ".");
        audition(t.id, drums ? 36 : 60);
      });
    });
  }
  function fromSamples(samples, trackId) {
    var t0 = trackId && D.track(trackId), drums = !!(t0 && t0.kind === "drums") || (samples.length > 1 && samples.some(function (s) { return drumNote(nameOf(s)) != null; }) && samples.every(function (s) { return noteFromName(nameOf(s)) == null; }));
    return decodeAll(samples).then(function (dec) {
      var got = samples.filter(function (s) { return dec.ids[s.path || nameOf(s)]; }); if (!got.length) throw new Error("Those files aren't audio this computer can read.");
      var target = targetFor(trackId, drums, drums ? "Kit" : base(nameOf(got[0]))), cur = target.id && D.track(target.id), layer0 = cur && cur.layers && cur.layers[0], adding = !!(layer0 && layer0.sound === "sampler" && (drums ? layer0.kit : true) && !target.fresh);
      var zones = [];
      if (drums) {
        var used = {}; ((adding && layer0.zones) || []).forEach(function (z) { used[z.lo] = 1; });
        got.forEach(function (s) {
          var n = drumNote(nameOf(s)); if (n == null || used[n]) { n = 60; while (used[n] && n < 100) n++; if (used[n]) { n = 35; while (used[n] && n < 127) n++; } }
          used[n] = 1; zones.push({ src: dec.ids[s.path || nameOf(s)], name: base(nameOf(s)), root: n, lo: n, hi: n, vlo: 1, vhi: 127, oneshot: true, group: n === 42 || n === 44 || n === 46 ? 1 : 0 });
        });
      } else {
        var named = got.map(function (s) { return { s: s, n: noteFromName(nameOf(s)) }; });
        if (named.length === 1) zones.push({ src: dec.ids[named[0].s.path || nameOf(named[0].s)], name: base(nameOf(named[0].s)), root: named[0].n == null ? 60 : named[0].n, lo: 0, hi: 127, vlo: 1, vhi: 127 });
        else {
          var k = 48; named.forEach(function (x) { if (x.n == null) x.n = k++; });
          named.sort(function (a, b) { return a.n - b.n; });
          named.forEach(function (x, i) { var lo = i ? Math.floor((named[i - 1].n + x.n) / 2) + 1 : 0, hi = i < named.length - 1 ? Math.floor((x.n + named[i + 1].n) / 2) : 127; zones.push({ src: dec.ids[x.s.path || nameOf(x.s)], name: base(nameOf(x.s)), root: x.n, lo: Math.min(lo, x.n), hi: Math.max(hi, x.n), vlo: 1, vhi: 127 }); });
          adding = false;   // (a new spread replaces what was there)
        }
        if (named.length === 1) adding = false;
      }
      var name = drums ? (adding ? layer0.name : "Kit") : base(nameOf(got[0]));
      var t = putLayer(target, { sound: "sampler", name: name, zones: zones, kit: drums || undefined, env: drums ? { attack: 0.001, decay: 0.3, sustain: 1, release: 0.05 } : undefined }, drums ? "Kit: " + zones.map(function (z) { return z.name; }).join(", ") : "Sampler: " + name, { add: adding && drums });
      UI.say(drums ? "Added to the kit on “" + t.name + "”: " + zones.map(function (z) { return z.name + " on " + noteName(z.lo); }).join(", ") + "." : "“" + t.name + "” plays " + (zones.length > 1 ? zones.length + " samples across the keyboard" : name + " across the keyboard from " + noteName(zones[0].root)) + ".");
      audition(t.id, drums ? zones[0].lo : zones[0].root);
    });
  }
  function noteName(n) { return ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][n % 12] + (Math.floor(n / 12) - 1); }
  function audition(id, n) { setTimeout(function () { D.live(id, [0x90, n, 96]); setTimeout(function () { D.live(id, [0x80, n, 0]); }, 450); }, 120); }
  // a SoundFont: into the sounds now, and (in the apps) installed on this computer so every app has it
  function fromBank(b, trackId) {
    if (!SND || !SND.addBank) return Promise.reject(new Error("SoundFonts can't be added here."));
    var name = base(nameOf(b));
    return bytesOf(b).then(function (bytes) {
      return SND.addBank(name, bytes, null).then(function () {
        var s = SND.list().filter(function (x) { return x.file === "mem:" + name; })[0]; if (!s) throw new Error(nameOf(b) + " has no sounds in it.");
        var t = putLayer(targetFor(trackId, s.drums, s.name), { sound: s.id }, "Sound: " + s.name);
        UI.say("“" + t.name + "” plays " + s.name + " from " + nameOf(b) + "."); audition(t.id, s.drums ? 36 : 60);
        keepBank(name, bytes);
      });
    });
  }
  function keepBank(name, bytes) {
    var L = window.CU && window.CU.libraries, P = window.CPDesktop, Z = window.CMProj; if (!Z || (!(L && L.installBytes) && !(P && P.installPersonal))) return;
    var id = ("my-sound-" + Z.slug(name, "sound")).slice(0, 52), file = "sounds/" + name.replace(/[^\w .()-]+/g, "").slice(0, 60) + ".sf2";
    var man = { format: 1, id: id, plan: "free", personal: true, version: "1." + Math.floor(Date.now() / 1000), title: name, summary: "A SoundFont you added in the studio", items: [{ kind: "sound", file: file, name: name, license: "Yours" }] };
    var zip = Z.zip([{ name: "manifest.json", data: JSON.stringify(man, null, 1) }, { name: file, data: bytes }]);
    (L && L.installBytes ? L.installBytes(id + ".zip", zip) : P.installPersonal(zip, id + ".zip")).then(function (r) { if (r && r.ok !== false && SND.refresh) SND.refresh(); }).catch(function () { });
  }
  UI.addInstrument = function (spec, trackId) {
    spec = spec || {}; var all = spec.all || [].concat(spec.sfz || [], spec.dspreset || [], spec.samples || [], spec.banks || []);
    var sfzs = (spec.sfz || []).filter(function (e) { return /\.sfz$/i.test(nameOf(e)); }), dss = (spec.dspreset || all.filter(function (e) { return /\.dspreset$/i.test(nameOf(e)); }));
    if (sfzs.length) return fromFile("sfz", sfzs[0], all, trackId);
    if (dss.length) return fromFile("ds", dss[0], all, trackId);
    if (spec.banks && spec.banks.length) return spec.banks.reduce(function (p, b) { return p.then(function () { return fromBank(b, trackId); }); }, Promise.resolve());
    if (spec.samples && spec.samples.length) return fromSamples(spec.samples, trackId);
    return Promise.resolve();
  };
  // (10.8) an external synth's sound onto a new audio track: its input, armed alone, the punch over its part, and record
  UI.recordExternal = function (id) {
    var t = D.track(id); if (!t || !t.clips.length) return;
    var first = Math.min.apply(null, t.clips.map(function (c) { return c.start; })), last = Math.max.apply(null, t.clips.map(function (c) { return c.start + c.len; })), input = (t.ext && t.ext.audio) || "1+2";
    D.edit("Record " + t.name + "'s sound", function (p) {
      p.tracks.forEach(function (x) { x.arm = false; });
      var a = D.newTrack("audio", (t.name + " (audio)").slice(0, 28)), i = p.tracks.findIndex(function (x) { return x.id === id; });
      a.input = input; a.arm = true; a.monitor = "off"; a.color = t.color; p.tracks.splice(i + 1, 0, a);
      p.punch = { on: true, start: first, end: last }; p.loop.on = false; U.sel = a.id;
    });
    D.setPos(Math.max(0, first - D.tempo.bpb(first)));
    UI.say("Recording “" + t.name + "”: it plays its part and records what comes back on input " + input + ". Press Stop when it's done.");
    D.record();
  };
  // (10.8) the Sound panel's extra parts: an external synth's settings, and any instrument track's MIDI effects
  UI.externalPanel = function (t) {
    var M = window.CUMidiIn, outs = M ? M.outputs() : [], e = t.ext || {}, ins = D.audio && D.audio.choices ? D.audio.choices(32) : [];
    return '<div class="cd-ext"><div class="cd-line"><b>External MIDI instrument</b><span class="cd-dim">Its notes go out to a hardware synth (or your keyboard\'s own sounds); its sound comes back in on your interface.</span></div>' +
      '<div class="cd-line"><label class="cd-f">MIDI out <select data-ext="port"><option value="">' + (outs.length ? "Pick one" : "No MIDI outputs - plug the synth in") + "</option>" + outs.map(function (o) { return '<option' + (o.name === e.port ? " selected" : "") + ">" + UI.esc(o.name) + "</option>"; }).join("") + (e.port && !outs.some(function (o) { return o.name === e.port; }) ? '<option selected value="' + UI.esc(e.port) + '">' + UI.esc(e.port) + " (not plugged in)</option>" : "") + "</select></label>" +
      '<label class="cd-f">Channel <select data-ext="channel">' + Array.apply(null, Array(16)).map(function (_, i) { return "<option" + (i + 1 === (e.channel || 1) ? " selected" : "") + ">" + (i + 1) + "</option>"; }).join("") + "</select></label>" +
      '<label class="cd-f">Program <input type="number" min="0" max="127" placeholder="-" value="' + (e.program == null ? "" : e.program) + '" data-ext="program" style="width:58px" title="Sent when the song starts (leave it empty to leave the synth on its own sound)"></label>' +
      '<label class="cd-f">Its sound comes in on <select data-ext="audio">' + (ins.length ? ins : [{ id: "1+2", name: "Inputs 1+2" }, { id: "1", name: "Input 1" }]).map(function (c) { return '<option value="' + UI.esc(c.id) + '"' + (c.id === (e.audio || "1+2") ? " selected" : "") + ">" + UI.esc(c.name) + "</option>"; }).join("") + "</select></label>" +
      '<label class="cd-f">Timing <input type="number" min="-200" max="200" step="1" value="' + (e.offsetMs || 0) + '" data-ext="offsetMs" style="width:64px" title="ms: earlier (−) for a synth that answers slowly, later (+) if it plays ahead"> ms</label></div>' +
      '<div class="cd-line"><span class="cd-dim">Hear it through this track with its <b>I</b> button (on by default). Exports don\'t have its sound until you record it: ⋯ → Record its sound to an audio track.</span></div></div>';
  };
  UI.externalWire = function (body, t) {
    UI.$$("[data-ext]", body).forEach(function (inp) { inp.onchange = function () { var k = inp.dataset.ext, v = inp.value; D.edit("External synth", function () { var x = D.track(t.id); x.ext = Object.assign({}, x.ext || {}); x.ext[k] = k === "channel" ? +v : k === "offsetMs" ? +v || 0 : k === "program" ? (v === "" ? null : Math.max(0, Math.min(127, +v | 0))) : v; }); }; });
    if (window.CUMidiIn && window.CUMidiIn.outputs().length === 0) window.CUMidiIn.start().then(function () { if (window.CUMidiIn.outputs().length && UI.openEditor) UI.openEditor("sound"); }).catch(function () { });
  };
  var MFX = window.CDawMidiFx;
  UI.midiFxPanel = function (t) {
    if (!MFX) return "";
    var list = t.midifx || [], T = MFX.TYPES;
    function sel(i, k, opts, cur) { return '<select data-mfx="' + i + ":" + k + '">' + opts.map(function (o) { var v = Array.isArray(o) ? o[0] : o, l = Array.isArray(o) ? o[1] : o; return '<option value="' + UI.esc(v) + '"' + (String(v) === String(cur) ? " selected" : "") + ">" + UI.esc(l) + "</option>"; }).join("") + "</select>"; }
    return '<div class="cd-mfx"><div class="cd-line"><b>MIDI effects</b><span class="cd-dim">What happens to the notes before the sound: the same on what you play and on the clips (they keep the notes you played).</span></div>' +
      list.map(function (f, i) {
        var p = Object.assign({}, (T[f.type] || {}).params, f.params), h = '<div class="cd-line cd-mfxrow"><label class="cd-f"><input type="checkbox" data-mfx="' + i + ':on"' + (f.on !== false ? " checked" : "") + "><b>" + UI.esc((T[f.type] || {}).name || f.type) + "</b></label>";
        if (f.type === "scale") h += '<label class="cd-f">Key ' + sel(i, "key", [["song", "The song's (" + D.project().key + ")"]].concat(["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]), p.key) + '</label><label class="cd-f">Scale ' + sel(i, "scale", Object.keys(MFX.SCALES), p.scale) + "</label>";
        if (f.type === "chord") h += '<label class="cd-f">Chord ' + sel(i, "shape", Object.keys(MFX.SHAPES).concat(["custom"]), p.shape) + '</label><label class="cd-f" title="Semitones from the note, like 4 7 11">Own <input data-mfx="' + i + ':custom" value="' + UI.esc(p.custom || "") + '" placeholder="4 7" style="width:76px"></label><label class="cd-f"><input type="checkbox" data-mfx="' + i + ':diatonic"' + (p.diatonic ? " checked" : "") + "> The key's own chord</label>";
        if (f.type === "arp") h += '<label class="cd-f">Play ' + sel(i, "mode", [["up", "Up"], ["down", "Down"], ["updown", "Up and down"], ["played", "As played"], ["random", "Random"]], p.mode) + '</label><label class="cd-f">Rate ' + sel(i, "rate", MFX.RATES.map(function (r) { return r[0]; }), p.rate) + '</label><label class="cd-f">Octaves ' + sel(i, "octaves", [1, 2, 3, 4], p.octaves) + '</label><label class="cd-f">Gate <input type="range" min="0.05" max="1" step="0.05" value="' + p.gate + '" data-mfx="' + i + ':gate"></label>';
        return h + '<button class="ghost" data-mfxdel="' + i + '" title="Take it off">✕</button></div>';
      }).join("") +
      '<div class="cd-line"><button data-mfxadd="scale">+ Scale</button><button data-mfxadd="chord">+ Chord</button><button data-mfxadd="arp">+ Arpeggiator</button></div></div>';
  };
  UI.midiFxWire = function (body, t) {
    UI.$$("[data-mfx]", body).forEach(function (inp) { inp.onchange = function () { var a = inp.dataset.mfx.split(":"), i = +a[0], k = a[1], v = inp.type === "checkbox" ? inp.checked : inp.type === "range" || k === "octaves" ? +inp.value : inp.value;
      D.edit("MIDI effect", function () { var f = D.track(t.id).midifx[i]; if (!f) return; if (k === "on") f.on = v; else { f.params = Object.assign({}, f.params); f.params[k] = v; } }); }; });
    UI.$$("[data-mfxdel]", body).forEach(function (b) { b.onclick = function () { D.edit("Take off a MIDI effect", function () { D.track(t.id).midifx.splice(+b.dataset.mfxdel, 1); }); }; });
    UI.$$("[data-mfxadd]", body).forEach(function (b) { b.onclick = function () { var ty = b.dataset.mfxadd; D.edit("Add a MIDI effect", function () { var x = D.track(t.id); x.midifx = (x.midifx || []).concat([{ id: D.uid("m"), type: ty, on: true, params: Object.assign({}, MFX.TYPES[ty].params) }]); }); }; });
  };
  UI.sfz = sfz; UI.dspreset = dspreset; UI.drumNote = drumNote; UI.noteFromName = noteFromName;
})();
