/* The DAW - the engine shared by Central Production (the full app) and the Studio in Central Usage (the same code, a
 * smaller layout). daw-ui*.js draws it; this file plays, records, mixes and renders.
 *
 * Time is in beats (quarter notes) from the song's start. The tempo map (tempo changes and time-signature changes, both
 * at bar lines) turns beats into seconds. Everything that sounds is scheduled on the AudioContext's clock a little ahead
 * (a 25 ms timer looking 150 ms ahead), so each note, clip and click lands on its exact sample.
 *
 * A project (v2):
 *   { v: 2, id, name, bpm, key, sig: [4, 4], tempos: [{ bar, bpm }], sigs: [{ bar, n, d }], markers: [{ id, beat, name }],
 *     loop: { on, start, end }, punch: { on, start, end }, metronome: { on, level, countIn (bars) }, snap, recordOffsetMs,
 *     tracks: [Track], master: { volume, inserts: [Fx] } }
 *   Track: { id, name, kind: audio | instrument | drums | bus, color, volume (dB), pan, mute, solo, arm, monitor (auto|in|off),
 *     input (audio: "1", "2", "1+2"; MIDI: "any" or a device), output ("master" | a bus id), sends: [{ to, level (dB), pre }],
 *     inserts: [Fx], layers (instrument sounds, see daw-sounds.js), clips: [Clip], auto: { param: [{ b, v }] }, lanes: [param] }
 *   Clip: { id, kind: audio | midi, start, len (beats), name, color, mute,
 *     audio: { src, offset (s), gain (dB), fadeIn, fadeOut (s), loop, warp: { from (bpm), orig, semis } }, takes: [{ id, src, name }],
 *     notes: [{ p, v, s, d }] (MIDI: beats from the clip's start), loopLen (beats: a MIDI clip repeats its first loopLen beats) }
 *   Fx: { id, type, on, params: {} }   (types in FX below; "cmfx" = a plugin made in Central Production's builder;
 *       "native" = a VST3 / CLAP plugin on this computer: { plugin: {format, id, path, name, vendor}, v } - see "native
 *       plugins" below: heard live through the rig while monitoring, and in playback / exports from the frozen track)
 *   Track.frozen: { src, sig, len, at, latency } - the track played through its native plugins (CDaw.native.freeze)
 * Automation params: "volume", "pan", "send:<busId>", "fx:<fxId>:<param>".
 *
 *   CDaw.project() / fresh(opts) / load(project, buffers) / edit(label, fn) / undo() / redo() / canUndo() / canRedo()
 *   CDaw.play(opts) / stop() / toggle() / record() / setPos(beat) / position() / state()
 *   CDaw.live(trackId, [status, d1, d2])     a MIDI message from a keyboard
 *   CDaw.render({ from, to, tracks }) -> Promise<AudioBuffer>;  CDaw.stems() -> Promise<[{ track, buffer }]>
 *   CDaw.buffers (audio by id) / addAudio(buffer, name) / importAudio(trackId, bytes, name, atBeat, opts) / usedAudio()
 *   CDaw.tempo: beatToSec, secToBeat, barToBeat, beatToBar, bpmAt, sigAt
 *   CDaw.on(event, fn): change, transport, record, meters (per frame, from the UI), message, saved, monitor
 *   CDaw.recovery: list() / restore(id) / forget(id)   work kept every few seconds, for after a crash
 */
(function () {
  "use strict";
  var SND = window.CUStudioSounds, NAT = window.CU && window.CU.studio;
  // ------------------------------------------------------------- small things
  var bus = {};
  function on(ev, fn) { (bus[ev] = bus[ev] || []).push(fn); return function () { var a = bus[ev] || [], i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }; }
  function fire(ev, a) { (bus[ev] || []).slice().forEach(function (fn) { try { fn(a); } catch (e) { console.warn("daw", ev, e); } }); }
  function uid(p) { return (p || "x") + Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 7); }
  function clamp(v, a, b) { v = Number(v); return isFinite(v) ? Math.max(a, Math.min(b, v)) : a; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function dbToGain(db) { return db <= -96 ? 0 : Math.pow(10, db / 20); }
  var COLORS = ["#E2C27E", "#8DB5DE", "#E58A7B", "#9BCB86", "#C79BE0", "#E8A65A", "#6FC8C1", "#D98FB3", "#B8C26A", "#7FA7E8"];
  var KEYS = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
  var SNAP = { "bar": 0, "1/2": 2, "1/4": 1, "1/8": 0.5, "1/16": 0.25, "1/32": 0.125, "1/8T": 1 / 3, "1/16T": 1 / 6, "off": 0 };
  function pro() { var P = window.PPPedals; return !P || !P.has ? true : !!P.has("plugins"); }

  // ------------------------------------------------------------- the effects (inserts)
  // each: { name, pro (the full version needs Central Plugins), params: [[key, label, min, max, default, unit, proOnly]], make(ctx) -> unit }
  // a unit: { input, output, set(params, now), param(key) -> AudioParam|null, dispose() }
  function G(c, v) { var g = c.createGain(); g.gain.value = v == null ? 1 : v; return g; }
  function irBuffer(c, secs, damp, seed) {
    var n = Math.round(c.sampleRate * secs), b = c.createBuffer(2, n, c.sampleRate), s = seed || 12345;
    for (var ch = 0; ch < 2; ch++) { var d = b.getChannelData(ch), lp = 0; for (var i = 0; i < n; i++) { s = (s * 1103515245 + 12345 + ch * 7) & 0x7fffffff; var w = s / 0x7fffffff * 2 - 1; lp += (w - lp) * (1 - damp * i / n); d[i] = lp * Math.pow(1 - i / n, 2.4) * (i < c.sampleRate * 0.004 ? i / (c.sampleRate * 0.004) : 1); } }
    return b;
  }
  function wet(c, unit, mixKey) {   // a dry / wet blend around a block
    unit.dry = G(c, 1); unit.wetG = G(c, 0.3); unit.input.connect(unit.dry).connect(unit.output);
    unit.mix = function (m, now) { unit.dry.gain.setTargetAtTime(Math.cos(m * Math.PI / 2), now, 0.02); unit.wetG.gain.setTargetAtTime(Math.sin(m * Math.PI / 2), now, 0.02); };
    unit.mixKey = mixKey;
  }
  var FX = {
    eq: { name: "EQ", params: [["low", "Low", -15, 15, 0, "dB"], ["mid", "Mid", -15, 15, 0, "dB"], ["midFreq", "Mid freq", 200, 5000, 1000, "Hz"], ["high", "High", -15, 15, 0, "dB"], ["hpf", "Low cut", 20, 400, 20, "Hz", true], ["mid2", "Mid 2", -15, 15, 0, "dB", true], ["mid2Freq", "Mid 2 freq", 800, 12000, 3500, "Hz", true], ["lpf", "High cut", 2000, 20000, 20000, "Hz", true]],
      make: function (c) { var u = { input: G(c), output: G(c) }, hp = c.createBiquadFilter(), lo = c.createBiquadFilter(), m1 = c.createBiquadFilter(), m2 = c.createBiquadFilter(), hi = c.createBiquadFilter(), lp = c.createBiquadFilter();
        hp.type = "highpass"; lo.type = "lowshelf"; lo.frequency.value = 120; m1.type = "peaking"; m1.Q.value = 0.9; m2.type = "peaking"; m2.Q.value = 1.1; hi.type = "highshelf"; hi.frequency.value = 8000; lp.type = "lowpass";
        var map = { hpf: hp.frequency, low: lo.gain, mid: m1.gain, midFreq: m1.frequency, mid2: m2.gain, mid2Freq: m2.frequency, high: hi.gain, lpf: lp.frequency };
        // only the bands that do something are in the path (a flat band costs as much as a working one): rewired when that changes
        var bands = [[hp, "hpf", function (p) { return p.hpf > 20.5; }], [lo, "low", function (p) { return Math.abs(p.low) > 0.05; }], [m1, "mid", function (p) { return Math.abs(p.mid) > 0.05; }], [m2, "mid2", function (p) { return Math.abs(p.mid2) > 0.05; }], [hi, "high", function (p) { return Math.abs(p.high) > 0.05; }], [lp, "lpf", function (p) { return p.lpf < 19900; }]], on = null, forced = {};
        function wire(p) {
          var want = bands.map(function (b) { return !!(forced[b[1]] || b[2](p)); }), key = want.join();
          if (key === on) return; on = key;
          [u.input].concat(bands.map(function (b) { return b[0]; })).forEach(function (n) { try { n.disconnect(); } catch (_) { } });
          var last = u.input; bands.forEach(function (b, i) { if (want[i]) { last.connect(b[0]); last = b[0]; } }); last.connect(u.output);
        }
        var lastP = { hpf: 20, low: 0, mid: 0, mid2: 0, high: 0, lpf: 20000 }; wire(lastP);
        u.set = function (p, now) { lastP = p; Object.keys(map).forEach(function (k) { if (p[k] != null) map[k].setTargetAtTime(p[k], now, 0.015); }); wire(p); };
        u.param = function (k) { if (!map[k]) return null; var b = { midFreq: "mid", mid2Freq: "mid2" }[k] || k; if (!forced[b]) { forced[b] = 1; wire(lastP); } return map[k]; }; return u; } },
    comp: { name: "Compressor", params: [["threshold", "Threshold", -60, 0, -18, "dB"], ["ratio", "Ratio", 1, 20, 3, ":1"], ["attack", "Attack", 0.1, 100, 10, "ms", true], ["release", "Release", 10, 1000, 150, "ms", true], ["knee", "Knee", 0, 30, 6, "dB", true], ["makeup", "Makeup", 0, 24, 0, "dB"]],
      make: function (c) { var u = { input: G(c), output: G(c) }, k = c.createDynamicsCompressor(), mk = G(c); u.input.connect(k).connect(mk).connect(u.output); u.node = k;
        u.set = function (p, now) { k.threshold.setTargetAtTime(p.threshold, now, 0.02); k.ratio.setTargetAtTime(p.ratio, now, 0.02); k.attack.setTargetAtTime(p.attack / 1000, now, 0.02); k.release.setTargetAtTime(p.release / 1000, now, 0.02); k.knee.setTargetAtTime(p.knee, now, 0.02); mk.gain.setTargetAtTime(dbToGain(p.makeup), now, 0.02); };
        u.param = function (key) { return { threshold: k.threshold, ratio: k.ratio, makeup: mk.gain }[key] || null; }; return u; } },
    gate: { name: "Gate", pro: true, params: [["threshold", "Threshold", -80, 0, -45, "dB"], ["range", "Range", -80, 0, -60, "dB"], ["release", "Release", 10, 1000, 120, "ms"]],
      make: function (c) { var u = { input: G(c), output: G(c) }, g;
        try { g = new AudioWorkletNode(c, "cdaw-gate", { outputChannelCount: [2] }); u.input.connect(g).connect(u.output); } catch (_) { u.input.connect(u.output); }
        u.set = function (p) { if (g) g.port.postMessage(p); }; u.param = function () { return null; }; return u; } },
    reverb: { name: "Reverb", params: [["type", "Room", 0, 3, 0, "", false, ["Room", "Hall", "Plate", "Cathedral"]], ["mix", "Mix", 0, 1, 0.25, ""], ["predelay", "Pre-delay", 0, 120, 10, "ms", true], ["tone", "Tone", 1000, 16000, 7000, "Hz", true]],
      make: function (c) { var u = { input: G(c), output: G(c) }, pre = c.createDelay(0.2), conv = c.createConvolver(), tone = c.createBiquadFilter(); tone.type = "lowpass"; wet(c, u, "mix");
        u.input.connect(pre).connect(conv).connect(tone).connect(u.wetG).connect(u.output); var t = -1;
        u.set = function (p, now) { var ty = Math.round(p.type); if (ty !== t) { t = ty; conv.buffer = irBuffer(c, [1.2, 2.8, 2.0, 5.5][ty] || 1.2, [0.3, 0.45, 0.1, 0.5][ty] || 0.3, 99 + ty); } pre.delayTime.setTargetAtTime(p.predelay / 1000, now, 0.02); tone.frequency.setTargetAtTime(p.tone, now, 0.02); u.mix(p.mix, now); };
        u.param = function (k) { return { tone: tone.frequency, mix: u.wetG.gain }[k] || null; }; return u; } },
    delay: { name: "Delay", params: [["time", "Time", 0, 7, 2, "", false, ["1/16", "1/8T", "1/8", "1/8.", "1/4", "1/4.", "1/2", "1 bar"]], ["feedback", "Feedback", 0, 0.92, 0.3, ""], ["mix", "Mix", 0, 1, 0.2, ""], ["tone", "Tone", 800, 16000, 5000, "Hz", true], ["pingpong", "Ping-pong", 0, 1, 0, "", true, ["Off", "On"]]],
      make: function (c) { var u = { input: G(c), output: G(c) }, dl = c.createDelay(4), dr = c.createDelay(4), fb = G(c, 0.3), tone = c.createBiquadFilter(), merge = c.createChannelMerger(2), cross = G(c, 0), straight = G(c, 1); tone.type = "lowpass"; wet(c, u, "mix");
        u.input.connect(dl); dl.connect(tone).connect(fb).connect(dl); dl.connect(merge, 0, 0); dl.connect(straight).connect(merge, 0, 1); dl.connect(cross).connect(dr); dr.connect(merge, 0, 1); merge.connect(u.wetG).connect(u.output);
        u.set = function (p, now, bpm) { var beats = [0.25, 1 / 3, 0.5, 0.75, 1, 1.5, 2, 4][Math.round(p.time)] || 0.5, s = Math.min(3.9, beats * 60 / (bpm || 100)); dl.delayTime.setTargetAtTime(s, now, 0.05); dr.delayTime.setTargetAtTime(s, now, 0.05); fb.gain.setTargetAtTime(p.feedback, now, 0.02); tone.frequency.setTargetAtTime(p.tone, now, 0.02); var pp = p.pingpong >= 0.5; cross.gain.setTargetAtTime(pp ? 1 : 0, now, 0.02); straight.gain.setTargetAtTime(pp ? 0 : 1, now, 0.02); u.mix(p.mix, now); };
        u.param = function (k) { return { feedback: fb.gain, mix: u.wetG.gain, tone: tone.frequency }[k] || null; }; return u; } },
    chorus: { name: "Chorus", pro: true, params: [["rate", "Rate", 0.05, 5, 0.8, "Hz"], ["depth", "Depth", 0, 1, 0.5, ""], ["mix", "Mix", 0, 1, 0.5, ""]],
      make: function (c) { var u = { input: G(c), output: G(c) }, d1 = c.createDelay(0.05), d2 = c.createDelay(0.05), lfo = c.createOscillator(), lg1 = G(c, 0.002), lg2 = G(c, -0.002), m = c.createChannelMerger(2); wet(c, u, "mix");
        d1.delayTime.value = 0.012; d2.delayTime.value = 0.015; lfo.connect(lg1).connect(d1.delayTime); lfo.connect(lg2).connect(d2.delayTime); lfo.start();
        u.input.connect(d1).connect(m, 0, 0); u.input.connect(d2).connect(m, 0, 1); m.connect(u.wetG).connect(u.output);
        u.set = function (p, now) { lfo.frequency.setTargetAtTime(p.rate, now, 0.05); lg1.gain.setTargetAtTime(0.004 * p.depth, now, 0.05); lg2.gain.setTargetAtTime(-0.004 * p.depth, now, 0.05); u.mix(p.mix, now); };
        u.param = function (k) { return { rate: lfo.frequency, mix: u.wetG.gain }[k] || null; }; u.dispose = function () { try { lfo.stop(); } catch (_) { } }; return u; } },
    drive: { name: "Drive", pro: true, params: [["drive", "Drive", 0, 1, 0.3, ""], ["tone", "Tone", 500, 12000, 4000, "Hz"], ["level", "Level", -24, 6, -3, "dB"]],
      make: function (c) { var u = { input: G(c), output: G(c) }, sh = c.createWaveShaper(), tone = c.createBiquadFilter(), lvl = G(c); tone.type = "lowpass"; sh.oversample = "4x"; u.input.connect(sh).connect(tone).connect(lvl).connect(u.output); var last = -1;
        u.set = function (p, now) { if (p.drive !== last) { last = p.drive; var k = 1 + p.drive * 60, n = 2048, cv = new Float32Array(n); for (var i = 0; i < n; i++) { var x = i / (n - 1) * 2 - 1; cv[i] = Math.tanh(k * x) / Math.tanh(k); } sh.curve = cv; } tone.frequency.setTargetAtTime(p.tone, now, 0.02); lvl.gain.setTargetAtTime(dbToGain(p.level), now, 0.02); };
        u.param = function (k) { return { tone: tone.frequency, level: lvl.gain }[k] || null; }; return u; } },
    filter: { name: "Filter", pro: true, params: [["mode", "Type", 0, 2, 0, "", false, ["Low-pass", "High-pass", "Band-pass"]], ["freq", "Frequency", 40, 18000, 2000, "Hz"], ["res", "Resonance", 0.1, 18, 0.8, ""], ["lfo", "Sweep rate", 0, 8, 0, "Hz"], ["lfoDepth", "Sweep depth", 0, 1, 0.5, ""]],
      make: function (c) { var u = { input: G(c), output: G(c) }, f = c.createBiquadFilter(), lfo = c.createOscillator(), lg = G(c, 0); lfo.connect(lg).connect(f.detune); lfo.start(); u.input.connect(f).connect(u.output);
        u.set = function (p, now) { f.type = ["lowpass", "highpass", "bandpass"][Math.round(p.mode)] || "lowpass"; f.frequency.setTargetAtTime(p.freq, now, 0.02); f.Q.setTargetAtTime(p.res, now, 0.02); lfo.frequency.setTargetAtTime(Math.max(0.001, p.lfo), now, 0.05); lg.gain.setTargetAtTime(p.lfo > 0 ? p.lfoDepth * 2400 : 0, now, 0.05); };
        u.param = function (k) { return { freq: f.frequency, res: f.Q }[k] || null; }; u.dispose = function () { try { lfo.stop(); } catch (_) { } }; return u; } },
    limiter: { name: "Limiter", pro: true, params: [["ceiling", "Ceiling", -12, 0, -1, "dB"], ["gain", "Input gain", 0, 18, 0, "dB"]],
      make: function (c) { var u = { input: G(c), output: G(c) }, ig = G(c), k = c.createDynamicsCompressor(), out = G(c); k.knee.value = 0; k.ratio.value = 20; k.attack.value = 0.001; k.release.value = 0.08; u.input.connect(ig).connect(k).connect(out).connect(u.output); u.node = k;
        u.set = function (p, now) { k.threshold.setTargetAtTime(p.ceiling - 0.5, now, 0.02); ig.gain.setTargetAtTime(dbToGain(p.gain), now, 0.02); }; u.param = function () { return null; }; return u; } },
    cmfx: { name: "Plugin", params: [], make: function (c, fx) {   // a Central FX plugin (the plugin builder's .cmfx.json, played by window.CMFx)
      var u = { input: G(c), output: G(c) }, api = null, last = {};
      try { if (window.CMFx && fx && fx.plugin) api = window.CMFx.create(c, fx.plugin, { values: fxPlay(fx) || {}, onError: function (e) { console.warn("Central FX: " + e); } }); } catch (e) { console.warn("Central FX", e); }
      if (api && api.node) { u.input.connect(api.node); api.node.connect(u.output); (c.__cdawPending = c.__cdawPending || []).push(api.ready); } else u.input.connect(u.output);
      u.api = api;
      // (10.3) a "tempo" knob follows the song's tempo unless the insert's "Sync to song tempo" is off
      var tq = ((fx && fx.plugin && fx.plugin.params) || []).filter(function (q) { return (q.id === "tempo" || q.id === "bpm" || String(q.unit || "").toUpperCase() === "BPM"); })[0];
      u.set = function (p, now, bpm) { if (!api) return; p = Object.assign({}, p || {}); if (tq && fx.syncTempo !== false && bpm > 0) p[tq.id] = clamp(bpm, tq.min != null ? +tq.min : 20, tq.max != null ? +tq.max : 300); Object.keys(p).forEach(function (k) { if (last[k] !== p[k]) { last[k] = p[k]; api.setParam(k, p[k]); } }); };
      u.param = function () { return null; }; u.dispose = function () { if (api) api.dispose(); }; return u; } }
  };
  // an effect's description: the built-in ones from FX; a Central FX plugin's knobs come from its own file
  function fxDef(fx) {
    var t = typeof fx === "string" ? fx : fx && fx.type, def = FX[t];
    if (t === "native" && fx && typeof fx !== "string") return { name: (fx.plugin && fx.plugin.name) || "Native plugin", native: true, make: def.make, params: (fx.plist || []).map(function (q) { return [String(q.id), q.name || "Parameter " + q.id, 0, 1, q.value != null ? +q.value : 0.5, ""]; }) };
    if (t !== "cmfx" || !fx || typeof fx === "string") return def;
    var pl = fx.plugin || {};
    return { name: pl.name || "Plugin", plugin: true, make: def.make, params: (pl.params || []).map(function (q) { var lo = q.min != null ? +q.min : 0, hi = q.max != null ? +q.max : 1; return [q.id, q.name || q.id, lo, hi, q.default != null ? +q.default : lo, q.unit || "", false, q.choices || null]; }) };
  }
  FX.native = { name: "Native plugin", params: [], make: function (c, fx) { var u = { input: G(c), output: G(c) }; u.input.connect(u.output); u.set = function () { if (c === ctx && fx) liveKnob(fx.id); }; u.param = function () { return null; }; return u; } };   // (live it passes the sound: see "native plugins")
  function fxDefaults(fx) { var d = {}, def = fxDef(fx); (def ? def.params : []).forEach(function (p) { d[p[0]] = p[4]; }); return d; }
  // the params as they play: without Central Plugins the full-version knobs stay at their defaults (and pro effects pass through)
  function fxPlay(fx) { var def = fxDef(fx); if (!def) return null; var p = Object.assign(fxDefaults(fx), fx.params || {}); if (!pro()) def.params.forEach(function (q) { if (q[6]) p[q[0]] = q[4]; }); return p; }
  function fxUsable(fx) { var def = FX[fx.type]; return !!def && fx.on !== false && !(def.pro && !pro()); }
  var GATE_SRC = "class G extends AudioWorkletProcessor{constructor(){super();this.p={threshold:-45,range:-60,release:120};this.e=0;this.g=1;this.port.onmessage=e=>{Object.assign(this.p,e.data)}}process(i,o){const a=i[0],b=o[0];if(!a||!a.length)return true;const th=Math.pow(10,this.p.threshold/20),fl=Math.pow(10,this.p.range/20),rel=Math.exp(-1/(sampleRate*this.p.release/1000)),att=Math.exp(-1/(sampleRate*0.001));for(let n=0;n<a[0].length;n++){let x=0;for(let c=0;c<a.length;c++)x=Math.max(x,Math.abs(a[c][n]));this.e=x>this.e?x:this.e*0.9995;const t=this.e>th?1:fl;this.g=t>this.g?t+(this.g-t)*att:t+(this.g-t)*rel;for(let c=0;c<b.length;c++)b[c][n]=(a[c]||a[0])[n]*this.g}return true}}registerProcessor('cdaw-gate',G);" +
    "class R extends AudioWorkletProcessor{constructor(){super();this.on=false;this.port.onmessage=e=>{this.on=!!e.data.on}}process(i){const a=i[0];if(this.on&&a&&a.length){this.port.postMessage({t:currentTime,ch:a.map(x=>x.slice(0))})}return true}}registerProcessor('cdaw-rec',R);" +
    "class P extends AudioWorkletProcessor{constructor(o){super();const p=o.processorOptions||{};this.c=p.chunk|0;this.skip=p.skip|0;this.total=p.total|0;this.f=0;this.b=null;this.bs=0;this.k=o.numberOfInputs|0}process(ins){for(let i=0;i<128;i++){const fr=this.f+i;if(fr<this.skip||fr>=this.total)continue;const x=fr-this.skip,j=x%this.c;if(j===0){this.b=[];for(let k=0;k<this.k;k++)this.b.push(new Float32Array(this.c*2));this.bs=x}for(let k=0;k<this.k;k++){const a=ins[k]||[],L=a[0],R=a[1]||a[0],o=this.b[k];o[2*j]=L?L[i]:0;o[2*j+1]=R?R[i]:0}if(j===this.c-1||fr===this.total-1){this.port.postMessage({s:this.bs,n:j+1,d:this.b},this.b.map(z=>z.buffer));this.b=null}}this.f+=128;return true}}registerProcessor('cdaw-tap',P);";
  function worklets(c) { if (!c.audioWorklet) return Promise.resolve(false); if (!c.__cdaw) c.__cdaw = c.audioWorklet.addModule("data:text/javascript;charset=utf-8," + encodeURIComponent(GATE_SRC)).then(function () { return true; }).catch(function () { return false; }); return c.__cdaw; }

  // ------------------------------------------------------------- the project
  function newTrack(kind, name, sound) {
    var t = { id: uid("t"), name: name || { audio: "Audio", drums: "Drums", bus: "Bus" }[kind] || "Keys", kind: kind || "instrument", color: COLORS[0], volume: 0, pan: 0, mute: false, solo: false, arm: false, monitor: "auto",
      input: kind === "audio" ? "1" : "any", output: "master", sends: [], inserts: [], clips: [], auto: {}, lanes: [], height: 64 };
    if (kind === "instrument" || kind === "drums") t.layers = [{ sound: sound || (kind === "drums" ? "builtin:kit" : "builtin:keys"), lo: 0, hi: 127, velLo: 1, velHi: 127, octave: 0, transpose: 0, volume: 1, pan: 0 }];
    if (kind === "bus") { t.input = null; t.inserts = [{ id: uid("f"), type: "reverb", on: true, params: { type: 1, mix: 1 } }]; }
    return t;
  }
  function newProject(o) {
    o = o || {};
    var p = { v: 2, id: o.id || uid("p"), name: o.name || "New song", bpm: clamp(o.bpm || 100, 30, 300), key: o.key || "C", sig: [4, 4], tempos: [], sigs: [], markers: [],
      loop: { on: false, start: 0, end: 16 }, punch: { on: false, start: 4, end: 8 }, metronome: { on: true, level: 0.6, countIn: 1 }, snap: "1/16", recordOffsetMs: 0, overdub: false,
      tracks: [], master: { volume: 0, inserts: [{ id: uid("f"), type: "limiter", on: true, params: { ceiling: -1, gain: 0 } }] }, createdAt: Date.now(), savedAt: 0 };
    var defs = o.tracks || [["instrument", "Keys", "builtin:keys"], ["drums", "Drums", "builtin:kit"], ["instrument", "Bass", "builtin:bass"], ["audio", "Vocals", null]];
    defs.forEach(function (d, i) { var t = newTrack(d[0], d[1], d[2]); t.color = COLORS[i % COLORS.length]; p.tracks.push(t); });
    if (o.reverbBus !== false) { var rb = newTrack("bus", "Reverb"); rb.color = "#6E7680"; p.tracks.push(rb); }
    return p;
  }
  // a project from the Studio before 10.2 (clips in a map, an arrangement list, faders 0..2)
  function migrate(p) {
    if (!p || p.v === 2) return p;
    var out = newProject({ name: p.name, bpm: p.bpm, key: p.key, tracks: [], reverbBus: false }); out.id = p.id || out.id; out.sig = p.sig || [4, 4]; if (p.loop) out.loop = clone(p.loop);
    if (p.metronome) out.metronome = { on: !!p.metronome.on, level: p.metronome.level || 0.6, countIn: p.metronome.countIn || 0 };
    (p.tracks || []).forEach(function (t0) {
      var t = newTrack(t0.kind, t0.name); t.id = t0.id; t.color = t0.color || t.color; t.volume = t0.volume > 0 ? Math.round(20 * Math.log10(t0.volume / 0.8) * 10) / 10 : -96; t.pan = t0.pan || 0; t.mute = !!t0.mute; t.solo = !!t0.solo;
      if (t0.layers) t.layers = clone(t0.layers); t.input = t0.kind === "audio" ? "1" : (t0.input || "any");
      (p.arrangement || []).filter(function (it) { return it.track === t0.id; }).forEach(function (it) {
        var c = (p.clips || {})[it.clip]; if (!c) return;
        var cl = { id: uid("c"), kind: c.kind === "audio" ? "audio" : "midi", start: it.start, len: it.len, name: c.name || "" };
        if (cl.kind === "audio" && c.audio) cl.audio = { src: c.audio.id, offset: (c.audio.offset || 0), gain: 0, fadeIn: 0.005, fadeOut: 0.01 };
        else { cl.notes = clone(c.notes || []); cl.loopLen = c.len; }
        t.clips.push(cl);
      });
      out.tracks.push(t);
    });
    return out;
  }
  var proj = newProject(), undoStack = [], redoStack = [], dirty = false;
  function project() { return proj; }
  function track(id) { return proj.tracks.filter(function (t) { return t.id === id; })[0] || null; }
  function findClip(id) { for (var i = 0; i < proj.tracks.length; i++) { var t = proj.tracks[i]; for (var k = 0; k < t.clips.length; k++) if (t.clips[k].id === id) return { track: t, clip: t.clips[k] }; } return null; }
  function edit(label, fn, opts) {
    undoStack.push({ label: label, json: JSON.stringify(proj) }); if (undoStack.length > 200) undoStack.shift(); redoStack = [];
    var r = fn(proj); dirty = true; changed(opts && opts.what || label); return r;
  }
  // a quick change that shouldn't fill the undo list on every step (a fader being dragged): one undo for the whole drag
  var liveEdit = null;
  function nudge(label, fn) {
    if (!liveEdit || liveEdit.label !== label) { liveEdit = { label: label }; undoStack.push({ label: label, json: JSON.stringify(proj) }); redoStack = []; }
    clearTimeout(liveEdit.t); liveEdit.t = setTimeout(function () { liveEdit = null; }, 800);
    fn(proj); dirty = true; changed("nudge");
  }
  function changed(what) { syncGraph(); if (T.playing && what !== "nudge" && what !== "select") reschedule(); fire("change", what || "all"); autosaveSoon(); }
  function undo() { var u = undoStack.pop(); if (!u) return null; redoStack.push({ label: u.label, json: JSON.stringify(proj) }); proj = JSON.parse(u.json); dirty = true; changed("undo"); return u.label; }
  function redo() { var r = redoStack.pop(); if (!r) return null; undoStack.push({ label: r.label, json: JSON.stringify(proj) }); proj = JSON.parse(r.json); dirty = true; changed("redo"); return r.label; }

  // ------------------------------------------------------------- the tempo map
  function bpb(sig) { return sig[0] * 4 / sig[1]; }
  function sigList() { return [{ bar: 0, n: proj.sig[0], d: proj.sig[1] }].concat((proj.sigs || []).filter(function (s) { return s.bar > 0; }).sort(function (a, b) { return a.bar - b.bar; })); }
  function barToBeat(bar) { var l = sigList(), beat = 0; for (var i = 0; i < l.length; i++) { var next = i + 1 < l.length ? l[i + 1].bar : Infinity, upto = Math.min(bar, next); if (upto > l[i].bar) beat += (upto - l[i].bar) * bpb([l[i].n, l[i].d]); if (bar <= next) break; } return beat; }
  function beatToBar(beat) {   // -> { bar (0-based), beat (0-based within the bar), sig }
    var l = sigList(), at = 0;
    for (var i = 0; i < l.length; i++) { var per = bpb([l[i].n, l[i].d]), next = i + 1 < l.length ? l[i + 1].bar : Infinity, span = (next - l[i].bar) * per; if (beat < at + span || next === Infinity) { var into = beat - at, b = Math.floor(into / per + 1e-9); return { bar: l[i].bar + b, beat: into - b * per, sig: [l[i].n, l[i].d], per: per }; } at += span; }
    return { bar: 0, beat: 0, sig: proj.sig, per: bpb(proj.sig) };
  }
  function tempoList() { return [{ beat: 0, bpm: proj.bpm }].concat((proj.tempos || []).filter(function (t) { return t.bar > 0; }).map(function (t) { return { beat: barToBeat(t.bar), bpm: clamp(t.bpm, 20, 400) }; }).sort(function (a, b) { return a.beat - b.beat; })); }
  function beatToSec(beat) { var l = tempoList(), s = 0; for (var i = 0; i < l.length; i++) { var end = i + 1 < l.length ? l[i + 1].beat : Infinity; if (beat <= end) return s + (beat - l[i].beat) * 60 / l[i].bpm; s += (end - l[i].beat) * 60 / l[i].bpm; } return s; }
  function secToBeat(sec) { var l = tempoList(), s = 0; for (var i = 0; i < l.length; i++) { var end = i + 1 < l.length ? l[i + 1].beat : Infinity, span = (end - l[i].beat) * 60 / l[i].bpm; if (sec <= s + span || end === Infinity) return l[i].beat + (sec - s) * l[i].bpm / 60; s += span; } return 0; }
  function bpmAt(beat) { var l = tempoList(), b = proj.bpm; l.forEach(function (t) { if (t.beat <= beat + 1e-9) b = t.bpm; }); return b; }
  function snapBeat(b, grid) { var g = typeof grid === "number" ? grid : grid === "bar" ? 0 : SNAP[grid || proj.snap]; if (grid === "bar" || (!grid && proj.snap === "bar")) { var bb = beatToBar(b); return barToBeat(bb.bar + (bb.beat > bb.per / 2 ? 1 : 0)); } return g ? Math.round(b / g) * g : b; }

  // ------------------------------------------------------------- the mixer graph
  var ctx = null, rt = null, buffers = {};
  function Strip(c, master) { this.c = c; this.input = G(c); this.fader = G(c, 1); this.pan = c.createStereoPanner(); this.mute = G(c, 1); this.meter = c instanceof (window.OfflineAudioContext || Object) ? G(c) : c.createAnalyser(); if (this.meter.fftSize) this.meter.fftSize = 1024; /* (no meters in an export) */ this.preOut = G(c); this.chain = []; this.chainSig = ""; this.sends = {}; this.input.connect(this.preOut); this.preOut.connect(this.fader); this.fader.connect(this.pan).connect(this.mute); this.mute.connect(this.meter); this.out = null; }
  Strip.prototype.route = function (dest) { if (this.out === dest) return; try { this.mute.disconnect(); } catch (_) { } this.mute.connect(this.meter); if (dest) this.mute.connect(dest); this.out = dest; };
  Strip.prototype.setInserts = function (list, bpm, now, ctxObj) {
    var self = this, use = (list || []).filter(fxUsable), sig = use.map(function (f) { return f.id + f.type + (f.type === "cmfx" ? JSON.stringify(f.plugin || {}).length : ""); }).join("|");
    if (sig !== this.chainSig) {   // the chain changed: build it again (a 10 ms crossfade so nothing clicks)
      var old = this.chain, oldIn = this.input; this.chainSig = sig;
      try { this.input.disconnect(); } catch (_) { }
      var last = this.input; this.chain = use.map(function (f) { var u = FX[f.type].make(self.c, f); u.id = f.id; last.connect(u.input); last = u.output; return u; });
      last.connect(this.preOut);
      setTimeout(function () { old.forEach(function (u) { try { u.output.disconnect(); } catch (_) { } if (u.dispose) u.dispose(); }); }, 200);
    }
    this.chain.forEach(function (u) { var f = use.filter(function (x) { return x.id === u.id; })[0]; if (f && u.set) u.set(fxPlay(f), now, bpm); });
  };
  function Graph(c, offline) {
    this.c = c; this.offline = offline; this.strips = {}; this.insts = {}; this.instSig = {}; this.auto = false;
    this.master = new Strip(c); this.master.route(c.destination);
    this.click = G(c, 0.6); this.click.connect(c.destination);
  }
  Graph.prototype.sync = function (p) {
    var self = this, now = this.c.currentTime, ids = {}, anySolo = p.tracks.some(function (t) { return t.solo && t.kind !== "bus"; });
    p.tracks.forEach(function (t) { ids[t.id] = 1; if (!self.strips[t.id]) self.strips[t.id] = new Strip(self.c); });
    p.tracks.forEach(function (t) {
      var s = self.strips[t.id], dest = t.output && t.output !== "master" && self.strips[t.output] && t.output !== t.id ? self.strips[t.output].input : self.master.input;
      s.route(dest);
      var aut = self.auto && t.auto || {};
      if (!(aut.volume && aut.volume.length)) s.fader.gain.setTargetAtTime(dbToGain(t.volume), now, 0.012);
      if (!(aut.pan && aut.pan.length)) s.pan.pan.setTargetAtTime(clamp(t.pan, -1, 1), now, 0.012);
      var muted = t.mute || (anySolo && t.kind !== "bus" && !t.solo); s.mute.gain.setTargetAtTime(muted ? 0 : 1, now, 0.006);
      s.setInserts(t.inserts, p.bpm, now);
      // sends: post-fader (or pre) to the buses
      var want = {}; (t.sends || []).forEach(function (sd) { var b = self.strips[sd.to]; if (!b || sd.to === t.id) return; want[sd.to] = 1; var g = s.sends[sd.to]; if (!g || g.pre !== !!sd.pre) { if (g) try { g.node.disconnect(); } catch (_) { } var n = G(self.c, 0); (sd.pre ? s.preOut : s.mute).connect(n); n.connect(b.input); g = s.sends[sd.to] = { node: n, pre: !!sd.pre }; } if (!(aut["send:" + sd.to] && aut["send:" + sd.to].length)) g.node.gain.setTargetAtTime(dbToGain(sd.level), now, 0.012); });
      Object.keys(s.sends).forEach(function (k) { if (!want[k]) { try { s.sends[k].node.disconnect(); } catch (_) { } delete s.sends[k]; } });
      if (t.layers && t.kind !== "audio" && t.kind !== "bus") { var sig = JSON.stringify(t.layers); if (self.instSig[t.id] !== sig) { if (self.insts[t.id]) self.insts[t.id].allOff(now, true); self.insts[t.id] = SND.instrument(self.c, t.layers); self.instSig[t.id] = sig; } }
    });
    Object.keys(this.strips).forEach(function (id) { if (!ids[id]) { self.strips[id].route(null); if (self.insts[id]) self.insts[id].allOff(now, true); delete self.strips[id]; delete self.insts[id]; delete self.instSig[id]; } });
    this.master.fader.gain.setTargetAtTime(dbToGain(p.master.volume || 0), now, 0.012);
    this.master.setInserts(p.master.inserts, p.bpm, now);
    this.click.gain.setTargetAtTime(p.metronome.level == null ? 0.6 : p.metronome.level, now, 0.01);
    return Promise.all(Object.keys(this.insts).map(function (id) { return self.insts[id].ready; }));
  };
  // automation: a param of a track -> its AudioParam in this graph, and the value scale
  Graph.prototype.autoTarget = function (t, key) {
    var s = this.strips[t.id]; if (!s) return null;
    if (key === "volume") return { param: s.fader.gain, val: function (v) { return dbToGain(v); } };
    if (key === "pan") return { param: s.pan.pan, val: function (v) { return clamp(v, -1, 1); } };
    if (key.indexOf("send:") === 0) { var sd = s.sends[key.slice(5)]; return sd ? { param: sd.node.gain, val: function (v) { return dbToGain(v); } } : null; }
    if (key.indexOf("fx:") === 0) { var parts = key.split(":"), u = s.chain.filter(function (x) { return x.id === parts[1]; })[0], prm = u && u.param && u.param(parts[2]); if (!prm) return null; var isDb = /makeup|level/.test(parts[2]); return { param: prm, val: function (v) { return isDb ? dbToGain(v) : v; } }; }
    return null;
  };
  // ------------------------------------------------------------- the audio device (Settings → Audio), kept on this computer
  // { input, output: device ids ("" = the system's), rate, buffer (frames), channels (how many inputs to open),
  //   loopbackMs: the measured round trip (output → cable → input) that recordings are lined up by, or null }
  var AUDIO_KEY = "cdaw-audio";
  function audioSettings() {
    var a = {}; try { a = JSON.parse(localStorage.getItem(AUDIO_KEY) || "{}") || {}; } catch (_) { }
    if (a.input == null) try { a.input = localStorage.getItem("cdaw-input-device") || ""; } catch (_) { }
    return Object.assign({ input: "", output: "", rate: 48000, buffer: 256, channels: 2, loopbackMs: null }, a);
  }
  function setAudio(patch) {
    var old = audioSettings(), a = Object.assign({}, old, patch || {});
    a.rate = [44100, 48000, 88200, 96000].indexOf(+a.rate) >= 0 ? +a.rate : 48000; a.buffer = clamp(Math.round(+a.buffer) || 256, 32, 4096); a.channels = clamp(Math.round(+a.channels) || 2, 1, 32);
    var devChanged = a.input !== old.input || a.output !== old.output || a.rate !== old.rate || a.buffer !== old.buffer;
    if (devChanged && !(patch && "loopbackMs" in patch)) a.loopbackMs = null;   // (a new route: the old measurement no longer holds)
    try { localStorage.setItem(AUDIO_KEY, JSON.stringify(a)); } catch (_) { }
    if (a.input !== old.input || a.channels !== old.channels) closeInput();
    if (ctx && (a.rate !== old.rate || a.buffer !== old.buffer)) restartCtx();
    else if (ctx && a.output !== old.output) applyOutput();
    fire("audio", a); return a;
  }
  function applyOutput() {
    var a = audioSettings(); if (!ctx || !ctx.setSinkId) return Promise.resolve(false);
    return ctx.setSinkId(a.output || "").then(function () { return true; }).catch(function () { fire("message", "That output isn't connected: playing through the computer's default one."); return false; });
  }
  function restartCtx() {   // a new sample rate or buffer size: a new audio context (the project and its audio stay)
    if (T.playing) stop(); closeInput(); var old = ctx; ctx = null; rt = null;
    try { old.close(); } catch (_) { }
    ensureCtx(); fire("transport", state());
  }
  function closeInput() {
    if (rec.stream) { try { rec.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (_) { } rec.stream = null; }
    if (mon.src) { try { mon.src.disconnect(); } catch (_) { } Object.keys(mon.conns).forEach(function (id) { try { mon.conns[id].g.disconnect(); } catch (_) { } }); }
    mon.src = null; mon.split = null; mon.conns = {}; rec.chs = 0;
    if (ctx) setTimeout(syncInputMonitor, 0);
  }
  function devices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return Promise.resolve({ inputs: [], outputs: [], names: false });
    return navigator.mediaDevices.enumerateDevices().then(function (l) {
      var pick = function (k) { return l.filter(function (d) { return d.kind === k && d.deviceId !== "default" && d.deviceId !== "communications"; }).map(function (d, i) { return { id: d.deviceId, name: d.label || (k === "audioinput" ? "Input " : "Output ") + (i + 1) }; }); };
      return { inputs: pick("audioinput"), outputs: pick("audiooutput"), names: l.some(function (d) { return !!d.label; }), canPickOutput: !!(window.AudioContext && AudioContext.prototype.setSinkId) };
    });
  }
  // the input channels a track can record from: each one alone (mono) and each pair (stereo)
  function inputChoices(n) {
    n = n || rec.chs || audioSettings().channels || 2; var out = [];
    for (var i = 1; i <= n; i++) out.push({ id: String(i), name: "Input " + i + " (mono)" });
    for (var j = 1; j + 1 <= n; j += 2) out.push({ id: j + "+" + (j + 1), name: "Inputs " + j + " + " + (j + 1) + " (stereo)" });
    return out;
  }
  function chansOf(spec) { var m = /^(\d+)(?:\+(\d+))?$/.exec(String(spec || "1")); if (!m) return [0]; return m[2] ? [+m[1] - 1, +m[2] - 1] : [+m[1] - 1]; }
  // what the input is doing: its channels and its delay, the output's delay, and the measured round trip if there is one
  function inputInfo() {
    var a = audioSettings(), l = latency();
    return inputStream().then(function (st) {
      var tr = st.getAudioTracks()[0], set = tr && tr.getSettings ? tr.getSettings() : {};
      return { device: tr ? tr.label : "", channels: rec.chs || set.channelCount || 2, rate: ctx ? ctx.sampleRate : a.rate, inputMs: Math.round((set.latency || 0) * 10000) / 10, outputMs: Math.round(l.total * 10000) / 10,
        bufferMs: Math.round(a.buffer / (ctx ? ctx.sampleRate : a.rate) * 10000) / 10, measuredMs: a.loopbackMs, usedMs: Math.round(compensation() * 10000) / 10 };
    });
  }
  function compensation() { var a = audioSettings(), l = latency(); return a.loopbackMs != null ? a.loopbackMs / 1000 : l.total + (rec.inLat || 0); }
  // Loopback: six clicks out, listened for on the input (a cable from an output to an input, or a mic by a speaker).
  // The time from each click to where it comes back is the round trip recordings are moved back by.
  function measureLatency(opts) {
    opts = opts || {}; var c = ensureCtx(); if (!c) return Promise.reject(new Error("no audio here")); if (c.state === "suspended") c.resume();
    return Promise.all([inputStream(), worklets(c)]).then(function (r) {
      if (!r[1]) throw new Error("this browser can't measure it");
      var src = c.createMediaStreamSource(r[0]), node = new AudioWorkletNode(c, "cdaw-rec", { numberOfInputs: 1, numberOfOutputs: 0, channelCount: Math.max(1, rec.chs || 2), channelCountMode: "explicit" }), chunks = [], t0 = null;
      node.port.onmessage = function (e) { if (t0 == null) t0 = e.data.t; chunks.push(e.data.ch); };
      src.connect(node); node.port.postMessage({ on: true });
      var out = G(c, opts.level || 0.5), start = c.currentTime + 0.4, times = [], gap = 0.4; out.connect(c.destination);
      for (var i = 0; i < 6; i++) { var t = start + i * gap, o = c.createOscillator(), e = G(c, 0); times.push(t); o.frequency.value = 2000; o.connect(e).connect(out); e.gain.setValueAtTime(1, t); e.gain.setValueAtTime(0, t + 0.003); o.start(t); o.stop(t + 0.01); }
      return new Promise(function (res) { setTimeout(res, (0.4 + 6 * gap + 0.5) * 1000); }).then(function () {
        node.port.postMessage({ on: false }); try { src.disconnect(); out.disconnect(); } catch (_) { }
        var ms = findDelay(times, chunks, t0, c.sampleRate);
        if (ms == null) throw new Error("No clicks came back. Connect an output of your interface to an input with a cable (or hold a mic by a speaker), turn it up, and try again.");
        if (opts.save !== false) setAudio({ loopbackMs: ms });
        return ms;
      });
    });
  }
  function findDelay(times, chunks, t0, rate) {
    if (!chunks.length || t0 == null) return null;
    var n = chunks.reduce(function (a, ch) { return a + ch[0].length; }, 0), x = new Float32Array(n), o = 0, peak = 0;
    chunks.forEach(function (ch) { for (var k = 0; k < ch[0].length; k++) { var v = 0; for (var c2 = 0; c2 < ch.length; c2++) v = Math.max(v, Math.abs(ch[c2][k])); x[o + k] = v; if (v > peak) peak = v; } o += ch[0].length; });
    if (peak < 0.01) return null;
    var thr = Math.max(0.01, peak * 0.35), ds = [];
    times.forEach(function (t) { var i0 = Math.max(0, Math.round((t - t0) * rate)), lim = Math.min(n, i0 + Math.round(0.35 * rate)); for (var i = i0; i < lim; i++) if (x[i] > thr) { ds.push((i - i0) / rate * 1000); break; } });
    if (ds.length < 4) return null;
    ds.sort(function (a, b) { return a - b; }); var med = ds[ds.length >> 1], good = ds.filter(function (d) { return Math.abs(d - med) < 1.5; });
    return good.length >= 4 ? Math.round(med * 10) / 10 : null;
  }
  function ensureCtx() {
    if (ctx) return ctx;
    var C = window.AudioContext || window.webkitAudioContext; if (!C) return null;
    var a = audioSettings();
    try { ctx = new C({ latencyHint: a.buffer / a.rate, sampleRate: a.rate }); } catch (_) { try { ctx = new C({ latencyHint: "interactive", sampleRate: 48000 }); } catch (__) { ctx = new C({ latencyHint: "interactive" }); } }
    if (a.output) applyOutput();
    rt = new Graph(ctx, false); worklets(ctx).then(function () { rt.strips && Object.keys(rt.strips).forEach(function (id) { rt.strips[id].chainSig = "x"; }); syncGraph(); });
    syncGraph(); return ctx;
  }
  function syncGraph() { if (rt) rt.sync(proj).catch(function () { }); }
  function latency() { if (!ctx) return { base: 0, output: 0, total: 0 }; var b = ctx.baseLatency || 0, o = ctx.outputLatency || 0; return { base: b, output: o, total: b + o }; }

  // ------------------------------------------------------------- what sounds when
  function clipSrc(cl) { var a = cl.audio || {}; if (cl.takes && cl.takes.length && cl.take) { var tk = cl.takes.filter(function (x) { return x.id === cl.take; })[0]; if (tk) return tk.src; } return a.src; }
  // the fades a clip plays with: its own, or longer where it overlaps its neighbour (a crossfade)
  function fadesOf(t, cl) {
    var fi = (cl.audio && cl.audio.fadeIn) || 0.004, fo = (cl.audio && cl.audio.fadeOut) || 0.006, s = beatToSec(cl.start), e = beatToSec(cl.start + cl.len);
    t.clips.forEach(function (o) { if (o === cl || o.kind !== "audio" || o.mute) return; var os = beatToSec(o.start), oe = beatToSec(o.start + o.len); if (os < s && oe > s) fi = Math.max(fi, Math.min(oe, e) - s); if (os > s && os < e && oe > e) fo = Math.max(fo, e - os); });
    return { fadeIn: fi, fadeOut: fo, xIn: fi > ((cl.audio && cl.audio.fadeIn) || 0.004) + 1e-3, xOut: fo > ((cl.audio && cl.audio.fadeOut) || 0.006) + 1e-3 };
  }
  // schedule everything in [a, b) (beats). sink: { graph, time(beat) -> ctx time, started: {}, sources: [], notes: [], from }
  function schedule(sink, a, b) {
    var p = proj, g = sink.graph, anySolo = p.tracks.some(function (t) { return t.solo && t.kind !== "bus"; });
    p.tracks.forEach(function (t) {
      var strip = g.strips[t.id]; if (!strip || t.kind === "bus") return;
      (sink.graph === rt && NL.S && NL.S.ids.indexOf(t.id) >= 0 ? [] : clipsFor(t)).forEach(function (cl) {
        if (cl.mute || cl.start >= b || cl.start + cl.len <= a) return;
        if (cl.kind === "audio") {
          var key = cl.id + "@" + sink.pass; if (sink.started[key]) return;
          var buf = buffers[clipSrc(cl)]; if (!buf) return;
          var startsHere = cl.start >= a && cl.start < b, spans = sink.first && cl.start < a && cl.start + cl.len > a;
          if (!startsHere && !spans) return;
          var from = Math.max(cl.start, a); sink.started[key] = 1;
          var when = sink.time(from), clipEnd = sink.time(cl.start + cl.len), dur = clipEnd - when, into = beatToSec(from) - beatToSec(cl.start), off = (cl.audio.offset || 0), f = fadesOf(t, cl);
          if (dur <= 0.002) return;
          var src = g.c.createBufferSource(), gn = g.c.createGain(), level = dbToGain(cl.audio.gain || 0); src.buffer = buf;
          if (cl.audio.loop && buf.duration - off > 0.01) { src.loop = true; src.loopStart = off; src.loopEnd = buf.duration; }
          src.connect(gn).connect(strip.input);
          var startAt = Math.max(when, g.c.currentTime), skip = startAt - when, pos = off + into + skip; if (src.loop && pos >= buf.duration) pos = off + ((pos - off) % (buf.duration - off));
          var t0 = startAt, total = beatToSec(cl.start + cl.len) - beatToSec(cl.start), elapsed = into + skip;
          gn.gain.setValueAtTime(0, t0);
          var fin = Math.max(0, f.fadeIn - elapsed); if (fin > 0) { if (f.xIn) gn.gain.setValueCurveAtTime(curve(level, true), t0, fin); else gn.gain.linearRampToValueAtTime(level, t0 + fin); } else gn.gain.linearRampToValueAtTime(level, t0 + 0.003);
          var foStart = t0 + (total - elapsed) - f.fadeOut; if (foStart > t0 + fin) { gn.gain.setValueAtTime(level, foStart); if (f.xOut) gn.gain.setValueCurveAtTime(curve(level, false), foStart, f.fadeOut); else gn.gain.linearRampToValueAtTime(0, foStart + f.fadeOut); }
          try { src.start(t0, Math.max(0, pos), src.loop ? undefined : Math.max(0.001, total - elapsed + 0.01)); if (src.loop) src.stop(t0 + total - elapsed + 0.01); } catch (e) { return; }
          sink.sources.push({ src: src, g: gn, track: t.id }); src.onended = function () { var i = sink.sources.findIndex(function (x) { return x.src === src; }); if (i >= 0) sink.sources.splice(i, 1); };
        } else {
          var inst = g.insts[t.id]; if (!inst) return;
          var L = cl.loopLen && cl.loopLen > 0 ? cl.loopLen : cl.len, reps = Math.ceil(cl.len / L);
          for (var r = 0; r < reps; r++) (cl.notes || []).forEach(function (n) {
            if (n.s >= L) return; var at = cl.start + r * L + n.s; if (at < a || at >= b || at >= cl.start + cl.len) return;
            var end = Math.min(at + n.d, cl.start + cl.len), wOn = sink.time(at), wOff = sink.time(end);
            var voice = inst.noteOn(strip.input, n.p, n.v, wOn); sink.notes.push({ voice: voice, inst: inst, on: wOn, off: wOff, track: t.id }); inst.noteOff(voice, wOff);
          });
        }
      });
    });
    // automation points ahead
    if (g.auto) p.tracks.forEach(function (t) { Object.keys(t.auto || {}).forEach(function (k) { var list = t.auto[k]; if (!list || !list.length) return; var tg = g.autoTarget(t, k); if (!tg) return; list.forEach(function (pt) { if (pt.b >= a && pt.b < b) try { tg.param.linearRampToValueAtTime(tg.val(pt.v), sink.time(pt.b)); } catch (_) { } }); }); });
    // the click (and the count-in)
    if ((p.metronome.on && !sink.offline) || sink.countIn) {
      for (var beat = Math.ceil(a - 1e-9); beat < b; beat++) {
        var inCount = sink.countIn && beat < sink.countEnd; if (!p.metronome.on && !inCount) continue; if (sink.offline) continue;
        var bb = beatToBar(beat < 0 ? beat + 1000 * bpb(p.sig) : beat); click(g, sink.time(beat), Math.abs(bb.beat) < 1e-6);
      }
    }
  }
  function curve(level, up) { var n = 32, c = new Float32Array(n); for (var i = 0; i < n; i++) { var x = i / (n - 1); c[i] = level * (up ? Math.sin(x * Math.PI / 2) : Math.cos(x * Math.PI / 2)); } return c; }
  function autoStart(g, beat, when) {
    proj.tracks.forEach(function (t) { Object.keys(t.auto || {}).forEach(function (k) { var list = t.auto[k]; if (!list || !list.length) return; var tg = g.autoTarget(t, k); if (!tg) return; try { tg.param.cancelScheduledValues(when); tg.param.setValueAtTime(tg.val(autoAt(list, beat)), when); } catch (_) { } }); });
  }
  function autoAt(list, beat) { if (!list || !list.length) return null; if (beat <= list[0].b) return list[0].v; for (var i = 1; i < list.length; i++) if (beat <= list[i].b) { var x = list[i - 1], z = list[i], k = z.b > x.b ? (beat - x.b) / (z.b - x.b) : 1; return x.v + (z.v - x.v) * k; } return list[list.length - 1].v; }
  var clickBufs = null;
  function click(g, at, down) {
    var c = g.c; if (!clickBufs || clickBufs.c !== c) { clickBufs = { c: c }; [["hi", 1760], ["lo", 1175]].forEach(function (x) { var n = Math.round(c.sampleRate * 0.03), b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0); for (var i = 0; i < n; i++) d[i] = Math.sin(2 * Math.PI * x[1] * i / c.sampleRate) * Math.exp(-i / (c.sampleRate * 0.005)) * 0.8; clickBufs[x[0]] = b; }); }
    var s = c.createBufferSource(); s.buffer = down ? clickBufs.hi : clickBufs.lo; s.connect(g.click); try { s.start(Math.max(at, c.currentTime)); } catch (_) { }
  }

  // ------------------------------------------------------------- transport
  var T = { playing: false, recording: false, pos: 0, t0: 0, b0: 0, cursor: 0, timer: 0, pass: 0, sink: null, wraps: [] };
  function songTime(beat) { return T.t0 + beatToSec(beat) - beatToSec(T.b0); }
  function beatAtTime(time) { return secToBeat(beatToSec(T.b0) + (time - T.t0)); }
  function position() { if (!T.playing || !ctx) return T.pos; var b = beatAtTime(ctx.currentTime - latency().total); return T.countEnd != null && b < T.countEnd ? b : b; }
  function newSink(from, first) { return { graph: rt, time: songTime, started: {}, sources: [], notes: [], pass: T.pass, from: from, first: first }; }
  function play(opts) {
    opts = opts || {}; var c = ensureCtx(); if (!c) return false;
    if (c.state === "suspended") c.resume();
    if (T.playing || T.waiting) return true;
    var start = opts.from != null ? opts.from : T.pos, bars = opts.countIn != null ? opts.countIn : (opts.record ? proj.metronome.countIn || 0 : 0);
    if (!opts._live && liveTracks().length) {   // (10.3) the plugins' first sound first, so every track starts together
      var LS = liveStart(start, {});
      if (LS) { T.waiting = true; fire("transport", state()); LS.first.then(function () { if (!T.waiting || NL.S !== LS) return; T.waiting = false; play(Object.assign({}, opts, { _live: LS })); }); return true; }
    }
    T.countBeats = bars > 0 ? bars * beatToBar(start).per : 0; T.countEnd = start;
    T.t0 = c.currentTime + 0.08; T.b0 = start - T.countBeats;
    if (T.countBeats) { T.t0 = c.currentTime + 0.08 + T.countBeats * 60 / bpmAt(start); T.b0 = start; T.countFrom = c.currentTime + 0.08; }
    if (opts._live) { var r0 = opts._live.rate; T.t0 = Math.round(T.t0 * r0) / r0; liveBegin(opts._live, T.t0); }
    T.cursor = start; T.playing = true; T.pass++; T.wraps = []; rt.auto = true; syncGraph();
    T.sink = newSink(start, true); autoStart(rt, start, T.t0);
    if (T.countBeats) { for (var k = 0; k < T.countBeats; k++) click(rt, T.countFrom + k * 60 / bpmAt(start), k % beatToBar(start).per === 0); }
    clearInterval(T.timer); T.timer = setInterval(tick, 25); tick();
    fire("transport", state()); return true;
  }
  function silence(sink, at) {
    if (!sink) return;
    sink.sources.forEach(function (x) { try { x.g.gain.cancelScheduledValues(at); x.g.gain.setTargetAtTime(0, at, 0.004); x.src.stop(at + 0.03); } catch (_) { } }); sink.sources = [];
    sink.notes.forEach(function (n) { if (n.on > at + 0.002) n.voice.parts.forEach(function (p) { p.kill(at); }); else if (n.off > at) n.inst.noteOff(n.voice, at); }); sink.notes = [];
  }
  function stop(opts) {
    var now = ctx ? ctx.currentTime : 0;
    if (T.waiting) { T.waiting = false; liveStop(); fire("transport", state()); }
    liveStop(now);
    if (!T.playing) { if (opts && opts.home) { T.pos = 0; fire("transport", state()); } return; }
    var pos = Math.max(0, position()); if (T.recording) finishRecording(pos);
    T.playing = false; clearInterval(T.timer); silence(T.sink, now); T.sink = null; rt.auto = false;
    Object.keys(rt.strips).forEach(function (id) { var s = rt.strips[id]; try { s.fader.gain.cancelScheduledValues(now); s.pan.pan.cancelScheduledValues(now); } catch (_) { } }); syncGraph();
    T.pos = opts && opts.home ? 0 : opts && opts.back ? T.startedAt || 0 : pos;
    fire("transport", state());
  }
  function toggle() { if (T.playing) stop(); else { T.startedAt = T.pos; play(); } }
  function setPos(beat) { var was = T.playing; if (was) { var rec = T.recording; stop(); T.pos = Math.max(0, beat); if (!rec) play(); } else { T.pos = Math.max(0, beat); fire("transport", state()); } }
  // an edit while it plays: everything ahead is scheduled again from where it is now (sounds already playing fade out in 4 ms)
  function reschedule() { if (!T.playing || T.recording) return; var now = ctx.currentTime, pos = beatAtTime(now + 0.03);
    if (NL.S || liveTracks().length) { var sw = now + NL.ahead, lp = beatAtTime(sw); liveStop(sw); var S2 = liveStart(lp, { t0: sw, carryOn: true }); if (S2) liveBegin(S2, sw); }   /* (10.3: the live tracks carry on from a moment ahead) */ silence(T.sink, now + 0.02); T.pass++; T.sink = newSink(pos, true); T.cursor = pos; autoStart(rt, pos, now + 0.03); tick(); }
  function state() { return { waiting: !!T.waiting, playing: T.playing, recording: T.recording, pos: position(), bpm: bpmAt(position()), countingIn: T.playing && T.countBeats > 0 && ctx && ctx.currentTime < T.t0 }; }
  function tick() {
    if (!T.playing || !ctx) return;
    var ahead = ctx.currentTime + 0.15, to = beatAtTime(ahead), from = T.cursor, L = proj.loop;
    if (L.on && L.end > L.start) {
      while (to > L.end && from < L.end) {
        schedule(T.sink, from, L.end); var tEnd = songTime(L.end);
        T.wraps.push(tEnd); T.t0 = tEnd; T.b0 = L.start; from = L.start; T.pass++; var old = T.sink; T.sink = newSink(L.start, true); T.sink.sources = old.sources; T.sink.notes = old.notes;
        autoStart(rt, L.start, tEnd); to = beatAtTime(ahead);
      }
    }
    if (to > from) { schedule(T.sink, from, to); T.sink.first = false; }
    T.cursor = to;
    if (T.recording && proj.punch.on && !proj.loop.on && to > proj.punch.end + 1) finishRecording(proj.punch.end);
    T.sink.notes = T.sink.notes.filter(function (n) { return n.off > ctx.currentTime - 0.5; });
  }

  // ------------------------------------------------------------- recording
  var rec = { midi: {}, held: {}, nodes: [], stream: null };
  function armed() { return proj.tracks.filter(function (t) { return t.arm && t.kind !== "bus"; }); }
  function record() {
    if (T.recording) { stop(); return; }
    var c = ensureCtx(); if (!c) return;
    var tracks = armed(); if (!tracks.length) { fire("message", "Arm a track first (its ● button), then record."); return; }
    var from = proj.punch.on ? Math.min(T.pos, proj.punch.start) : T.pos;
    if (proj.punch.on && T.pos > proj.punch.start) from = Math.max(0, proj.punch.start - beatToBar(proj.punch.start).per);
    T.recording = true; rec.from = proj.punch.on ? proj.punch.start : (proj.loop.on ? Math.max(T.pos, proj.loop.start) : T.pos); rec.midi = {}; rec.held = {};
    T.startedAt = from;
    var audio = tracks.filter(function (t) { return t.kind === "audio"; });
    (audio.length ? startAudio(audio) : Promise.resolve()).then(function () { if (!T.recording) return; play({ from: from, record: true }); fire("record", { on: true }); })
      .catch(function (e) { T.recording = false; fire("message", "The input couldn't be opened: " + (e && e.message || e)); fire("record", { on: false }); });
  }
  function inputStream() {
    if (rec.stream && rec.stream.active) return Promise.resolve(rec.stream);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return Promise.reject(new Error("recording isn't available here"));
    var a = audioSettings(), dev = a.input;
    var want = function (exact) { return { audio: Object.assign({ echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: a.channels }, sampleRate: { ideal: a.rate }, latency: { ideal: 0.003 } }, dev && exact ? { deviceId: { exact: dev } } : {}) }; };
    return navigator.mediaDevices.getUserMedia(want(true)).catch(function (e) { if (!dev || e.name !== "OverconstrainedError" && e.name !== "NotFoundError") throw e; fire("message", "The chosen input isn't connected: using the computer's default one."); return navigator.mediaDevices.getUserMedia(want(false)); })
      .then(function (s) { rec.stream = s; var tr = s.getAudioTracks()[0], st = tr && tr.getSettings ? tr.getSettings() : {}; rec.chs = Math.max(1, Math.min(32, st.channelCount || a.channels || 2)); return s; });
  }
  function startAudio(tracks) {
    return Promise.all([inputStream(), worklets(ctx)]).then(function (r) {
      var stream = r[0]; if (!r[1]) throw new Error("this browser can't record here");
      rec.inLat = 0; try { var st = stream.getAudioTracks()[0].getSettings(); rec.inLat = st.latency || 0; } catch (_) { }
      var src = ctx.createMediaStreamSource(stream), node = new AudioWorkletNode(ctx, "cdaw-rec", { numberOfInputs: 1, numberOfOutputs: 0, channelCount: Math.max(1, rec.chs || 2), channelCountMode: "explicit", channelInterpretation: "discrete" });
      src.connect(node); var r2 = { node: node, src: src, chunks: [], t0: null, tracks: tracks };
      node.port.onmessage = function (e) { if (r2.t0 == null) r2.t0 = e.data.t; r2.chunks.push(e.data.ch); };
      node.port.postMessage({ on: true }); rec.nodes = [r2];
    });
  }
  function finishRecording(endBeat) {
    if (!T.recording) return;
    T.recording = false; var comp = compensation() + (proj.recordOffsetMs || 0) / 1000, wraps = T.wraps.slice(), loopOn = proj.loop.on && proj.loop.end > proj.loop.start;
    var punchA = proj.punch.on ? proj.punch.start : rec.from, punchB = proj.punch.on ? proj.punch.end : endBeat;
    var midiIds = Object.keys(rec.midi).filter(function (id) { return rec.midi[id].length; });
    var audioDone = [];
    rec.nodes.forEach(function (r) {
      try { r.node.port.postMessage({ on: false }); r.src.disconnect(); } catch (_) { }
      if (!r.chunks.length || r.t0 == null) return;
      var chs = r.chunks[0].length, n = r.chunks.reduce(function (a, c) { return a + c[0].length; }, 0), all = []; for (var ch = 0; ch < Math.min(32, chs); ch++) all.push(new Float32Array(n));
      var o = 0; r.chunks.forEach(function (c) { all.forEach(function (d, ch) { d.set(c[ch] || c[0], o); }); o += c[0].length; });
      audioDone.push({ r: r, data: all, t0: r.t0 - comp });
    });
    rec.nodes = [];
    if (!midiIds.length && !audioDone.length) { fire("record", { on: false }); return; }
    edit("Record", function (p) {
      // MIDI: notes in beats; with the loop on, every pass goes into the same clip (overdub)
      midiIds.forEach(function (id) {
        var t = track(id); if (!t) return;
        var notes = rec.midi[id].map(function (n) { return { p: n.p, v: n.v, s: n.on, d: Math.max(0.05, (n.off != null ? n.off : n.onEnd || n.on + 0.5) - n.on) }; }).filter(function (n) { return n.s >= punchA - 0.25 && n.s < punchB; });
        if (!notes.length) return;
        var a = loopOn ? proj.loop.start : Math.floor(beatToBar(Math.min.apply(null, notes.map(function (n) { return n.s; }))).bar), startBeat = loopOn ? a : barToBeat(a), endB = loopOn ? proj.loop.end : barToBeat(beatToBar(Math.max.apply(null, notes.map(function (n) { return n.s + n.d; }))).bar + 1);
        var existing = t.clips.filter(function (c) { return c.kind === "midi" && c.start <= startBeat + 0.01 && c.start + c.len >= endB - 0.01; })[0];
        if (existing && (loopOn || p.overdub)) notes.forEach(function (n) { n.s -= existing.start; existing.notes.push(n); });
        else { if (!p.overdub) t.clips = t.clips.filter(function (c) { return !(c.kind === "midi" && c.start >= startBeat && c.start + c.len <= endB); }); var cl = { id: uid("c"), kind: "midi", start: startBeat, len: endB - startBeat, name: t.name, notes: notes.map(function (n) { n.s -= startBeat; return n; }) }; t.clips.push(cl); }
      });
      // audio: placed where it was heard (latency compensated); with the loop on, each pass is a take of one clip
      audioDone.forEach(function (d) {
        var rate = ctx.sampleRate;
        d.r.tracks.forEach(function (tid) {
          var t = track(tid.id || tid); if (!t) return;
          var segs = [];
          if (loopOn && wraps.length) {
            var la = beatToSec(proj.loop.start), lb = beatToSec(proj.loop.end), passSec = lb - la;
            wraps.forEach(function (w, i) { var startT = w - passSec; segs.push({ t: startT, len: passSec, beat: proj.loop.start, name: "Take " + (i + 1) }); });
            var lastStart = wraps[wraps.length - 1]; segs.push({ t: lastStart, len: Math.min(passSec, beatToSec(endBeat) - la), beat: proj.loop.start, name: "Take " + (wraps.length + 1) });
          } else segs.push({ t: songStartTime(punchA), len: beatToSec(punchB) - beatToSec(punchA), beat: punchA, name: "Take 1" });
          var takes = [];
          segs.forEach(function (sg) {
            var i0 = Math.round((sg.t - d.t0) * rate), n = Math.round(sg.len * rate); if (n < rate * 0.05) return;
            var pick = chansOf(t.input).map(function (ch) { return d.data[ch] || d.data[0]; });   // (the track's own input channel, or its stereo pair)
            var buf = new AudioBuffer({ numberOfChannels: pick.length, length: n, sampleRate: rate });
            pick.forEach(function (arr, ch) { var out = buf.getChannelData(ch); for (var k = 0; k < n; k++) out[k] = arr[i0 + k] || 0; });
            var aid = uid("au"); buffers[aid] = buf; takes.push({ id: uid("k"), src: aid, name: sg.name, beat: sg.beat, len: sg.len });
          });
          if (!takes.length) return;
          var first = takes[0], len = secToBeat(beatToSec(first.beat) + first.len) - first.beat;
          // what was there in the recorded range is cut away (punch: just the punched part)
          cutRange(t, first.beat, first.beat + len);
          var cl = { id: uid("c"), kind: "audio", start: first.beat, len: len, name: t.name, audio: { src: takes[takes.length - 1].src, offset: 0, gain: 0, fadeIn: 0.004, fadeOut: 0.008 } };
          if (takes.length > 1) { cl.takes = takes.map(function (k) { return { id: k.id, src: k.src, name: k.name }; }); cl.take = cl.takes[cl.takes.length - 1].id; }
          t.clips.push(cl);
        });
      });
    }, { what: "record" });
    fire("record", { on: false });
  }
  function songStartTime(beat) { return T.t0 + beatToSec(beat) - beatToSec(T.b0); }
  // cut [a, b) out of a track's clips (splitting the ones that cross it)
  function cutRange(t, a, b) {
    var keep = [];
    t.clips.forEach(function (c) {
      var ce = c.start + c.len; if (ce <= a || c.start >= b) { keep.push(c); return; }
      if (c.start < a) { var l = clone(c); l.len = a - c.start; keep.push(l); }
      if (ce > b) { var r = clone(c); r.id = uid("c"); r.start = b; r.len = ce - b; if (r.kind === "audio") r.audio.offset = (r.audio.offset || 0) + beatToSec(b) - beatToSec(c.start); else { var sh = b - c.start; r.notes = (r.notes || []).map(function (n) { return Object.assign({}, n, { s: n.s - sh }); }).filter(function (n) { return n.s >= 0; }); } keep.push(r); }
    });
    t.clips = keep;
  }

  // ------------------------------------------------------------- playing live (MIDI keyboards, the computer keys)
  var live = { held: {}, sustain: {}, sustained: {} }, monitor = { ok: false, tracks: {}, latencyMs: null, error: null, started: false };
  function liveMidi(trackId, data, perfMs) {
    var t = track(trackId); if (!t || t.kind === "audio" || t.kind === "bus") return;
    var c = ensureCtx(); if (c.state === "suspended") c.resume();
    var st = data[0] & 0xF0, n = data[1], v = data[2] || 0, inst = rt.insts[t.id], strip = rt.strips[t.id], k = t.id + ":" + n;
    var native = monitor.ok && monitor.tracks[t.id] && NAT && NAT.monitor;
    if (native) NAT.monitor.send({ action: "midi", track: t.id, data: [data[0], n, v] });
    if (st === 0x90 && v > 0) {
      if (!native && inst) { if (live.held[k]) inst.noteOff(live.held[k], 0); live.held[k] = inst.noteOn(strip.input, n, v, 0); }
      if (T.recording && t.arm) { var b = position(); if (proj.loop.on && b >= proj.loop.end) b = proj.loop.start + ((b - proj.loop.start) % (proj.loop.end - proj.loop.start)); (rec.midi[t.id] = rec.midi[t.id] || []).push({ p: n, v: v, on: b }); rec.held[k] = rec.midi[t.id][rec.midi[t.id].length - 1]; }
    } else if (st === 0x80 || (st === 0x90 && v === 0)) {
      if (live.sustain[t.id]) { (live.sustained[t.id] = live.sustained[t.id] || []).push(k); }
      else if (live.held[k] && inst) { inst.noteOff(live.held[k], 0); delete live.held[k]; }
      if (rec.held[k]) { rec.held[k].off = position(); delete rec.held[k]; }
    } else if (st === 0xB0 && n === 64) {
      live.sustain[t.id] = v >= 64;
      if (!live.sustain[t.id]) { (live.sustained[t.id] || []).forEach(function (k2) { if (live.held[k2] && inst) { inst.noteOff(live.held[k2], 0); delete live.held[k2]; } }); live.sustained[t.id] = []; }
    }
  }
  function nativeTracks() { var out = []; monitor.tracks = {}; proj.tracks.forEach(function (t) { if (!t.layers || t.kind === "audio" || t.kind === "bus") return; var ls = SND.nativeLayers && SND.nativeLayers(t.layers); if (!ls) return; out.push({ id: t.id, volume: dbToGain(t.volume), pan: t.pan, mute: t.mute, layers: ls }); monitor.tracks[t.id] = 1; }); return out; }
  var monSig = "";
  function syncMonitor() { if (!NAT || !NAT.monitor || !monitor.started) return; var tr = nativeTracks(), sig = JSON.stringify(tr); if (sig !== monSig) { monSig = sig; NAT.monitor.send({ action: "tracks", tracks: tr }); } }
  function startMonitor() {
    if (!NAT || !NAT.monitor || monitor.started) return Promise.resolve(monitor);
    monitor.started = true;
    NAT.monitor.on(function (m) { if (m && m.type === "studioMonitor") { monitor.ok = !!m.ok; monitor.latencyMs = m.latencyMs; monitor.error = m.error || null; if (m.stopped) { monitor.started = false; monSig = ""; } fire("monitor", monitor); } });
    return NAT.monitor.start().then(function (r) { if (!r || !r.ok) { monitor.started = false; monitor.error = r && r.error; } else { monSig = ""; syncMonitor(); } fire("monitor", monitor); return monitor; });
  }
  on("change", syncMonitor);
  // hearing an audio track's input while it's armed (or monitor "in")
  var mon = { src: null, split: null, conns: {} };
  function syncInputMonitor() {
    var want = proj.tracks.filter(function (t) { return t.kind === "audio" && (t.monitor === "in" || (t.monitor === "auto" && t.arm)); });
    var viaRig = NH.host && NH.host.monitor ? want.filter(function (t) { return natives(t).length; })[0] || null : null;   // (one track at a time through the rig)
    if (NH.host && NH.host.monitor) { var mk = viaRig ? viaRig.id + ":" + viaRig.input + ":" + natives(viaRig).map(function (f) { return nativeSlot(f) + (f.plugin.key || f.plugin.id); }).join(",") : ""; if (mk !== NH.monKey) { NH.monKey = mk; NH.host.monitor(viaRig ? { track: viaRig.id, input: viaRig.input || "1", plugins: natives(viaRig).map(function (f) { return Object.assign(nativeJob(f), { slot: ("dm" + String(f.id).replace(/[^A-Za-z0-9]/g, "")).slice(0, 12), stateFrom: nativeSlot(f) }); }) } : null); } }
    if (viaRig) want = want.filter(function (t) { return t !== viaRig; });
    if (!want.length) { Object.keys(mon.conns).forEach(function (id) { try { mon.conns[id].g.disconnect(); } catch (_) { } }); mon.conns = {}; return; }
    ensureCtx(); inputStream().then(function (s) {
      var nch = Math.max(2, rec.chs || 2);
      if (!mon.src || mon.src.mediaStream !== s) { mon.src = ctx.createMediaStreamSource(s); mon.src.channelCount = nch; mon.src.channelInterpretation = "discrete"; mon.split = ctx.createChannelSplitter(nch); mon.src.connect(mon.split); mon.conns = {}; }
      var ids = {}; want.forEach(function (t) { ids[t.id] = 1; var strip = rt.strips[t.id], c0 = mon.conns[t.id]; if (!strip || (c0 && c0.input === t.input)) return; if (c0) try { c0.g.disconnect(); } catch (_) { }
        var g = G(ctx, 1), m = ctx.createChannelMerger(2), ch = chansOf(t.input).map(function (c2) { return Math.min(c2, nch - 1); }); mon.split.connect(m, ch[0], 0); mon.split.connect(m, ch[1] != null ? ch[1] : ch[0], 1); m.connect(g).connect(strip.input); mon.conns[t.id] = { g: g, input: t.input }; });
      Object.keys(mon.conns).forEach(function (id) { if (!ids[id]) { try { mon.conns[id].g.disconnect(); } catch (_) { } delete mon.conns[id]; } });
    }).catch(function () { });
  }
  on("change", function (w) { if (w !== "nudge") syncInputMonitor(); });

  // ------------------------------------------------------------- native plugins (10.2): VST3 / CLAP on a track, through the rig
  // A browser engine can't run a VST3 or CLAP plugin, so the app's rig (cu-rig, the plugin host the pedal boards use) does:
  //   live     while an armed audio track with native plugins is monitored, its input plays through them in the rig
  //            (you hear it from the rig, with its own low delay); what's recorded is the dry input.
  //   offline  "Freeze": the track (its clips through its instrument) is rendered dry, played through its native plugins
  //            in the rig (cu-rig --process, their latency taken off) and the result plays instead, through the rest of
  //            the track's chain. Bounces and exports freeze what's changed first. A change to the clips, the plugins or
  //            the tempo (or closing a plugin's window: f.v) means it's frozen again.
  // Native plugins come first on the track, before its other effects. NH.host (set by the app):
  //   { list(scan) -> Promise [{format,id,path,name,vendor}], process(job) -> Promise {ok, data, frames, latency, error},
  //     monitor({track, input, plugins} | null), editor(slot, plugins, open) }
  var NH = { host: null, busy: {}, monKey: null };
  function natives(t) { return (t && t.inserts || []).filter(function (f) { return f.type === "native" && f.on !== false && f.plugin; }); }
  function nativeSlot(f) { return ("dw" + String(f.id).replace(/[^A-Za-z0-9]/g, "")).slice(0, 12); }
  function nativeJob(f) { return { slot: nativeSlot(f), format: f.plugin.format, id: f.plugin.id, path: f.plugin.path, name: f.plugin.name || "" }; }
  function strHash(str) { var h = 5381; for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
  function freezeSig(t) {
    var n = natives(t); if (!n.length) return "";
    var x = clone(t); ["volume", "pan", "mute", "solo", "arm", "monitor", "sends", "auto", "lanes", "height", "color", "name", "frozen", "output", "inserts"].forEach(function (k) { delete x[k]; });
    return strHash(JSON.stringify([x, n.map(function (f) { return [f.id, f.plugin.format, f.plugin.id, f.plugin.path, f.v || 0, knobList(f)]; }), proj.bpm, proj.tempos || [], proj.sigs || []]));
  }
  function frozenOK(t) { return !!(t && t.frozen && t.frozen.sig && buffers[t.frozen.src] && t.frozen.sig === freezeSig(t)); }
  function clipsFor(t) { return frozenOK(t) ? [{ id: "fz" + t.id, kind: "audio", start: 0, len: t.frozen.len, audio: { src: t.frozen.src, offset: 0, gain: 0, fadeIn: 0, fadeOut: 0.01 } }] : t.clips; }
  function trackEnd(t) { var e = 0; t.clips.forEach(function (c) { if (!c.mute) e = Math.max(e, c.start + c.len); }); return e; }
  function freeze(id, opts) {
    opts = opts || {}; var t = track(id); if (!t) return Promise.reject(new Error("no such track"));
    var n = natives(t); if (!n.length) { if (t.frozen) edit("Unfreeze", function () { track(id).frozen = null; }); return Promise.resolve(null); }
    if (!NH.host) return Promise.reject(new Error("VST3 and CLAP plugins play in the Central Production and Central Usage apps on a computer."));
    if (NH.busy[id] && !opts.temp) return NH.busy[id];
    var sig = freezeSig(t), rate = ensureCtx() ? ctx.sampleRate : 48000, to = trackEnd(t) + 2 * beatsPerBarAt(trackEnd(t)), name = t.name;
    if (!opts.temp) { fire("message", "Freezing " + name + " through " + n.map(function (f) { return f.plugin.name; }).join(", ") + "…"); fire("freeze", { track: id, busy: true }); }
    var job = renderRaw({ from: 0, to: to, tracks: [id], dry: id, exact: true, rate: rate }).then(function (buf) {
      var L = buf.getChannelData(0), R = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L, N = buf.length, data = new Float32Array(N * 2);
      for (var i = 0; i < N; i++) { data[2 * i] = L[i]; data[2 * i + 1] = R[i]; }
      return NH.host.process({ rate: rate, frames: N, data: data, tail: 0, plugins: n.map(function (f) { return Object.assign(nativeJob(f), { params: knobList(f) }); }) });
    }).then(function (r) {
      if (!r || !r.ok) throw new Error(r && r.error || "the plugins didn't play");
      var d = new Float32Array(r.data.buffer ? r.data.buffer.slice(r.data.byteOffset || 0, (r.data.byteOffset || 0) + r.data.byteLength) : r.data), M = Math.min(r.frames, d.length >> 1), out = new AudioBuffer({ numberOfChannels: 2, length: Math.max(1, M), sampleRate: rate }), oL = out.getChannelData(0), oR = out.getChannelData(1);
      for (var i = 0; i < M; i++) { oL[i] = d[2 * i]; oR[i] = d[2 * i + 1]; }
      var src = addAudio(out);
      if (opts.temp) return { src: src, len: secToBeat(M / rate), latency: r.latency || 0 };   // (an export: used once, the track stays live)
      edit("Freeze " + name, function () { var x = track(id); if (x) x.frozen = { src: src, sig: sig, len: secToBeat(M / rate), at: Date.now(), latency: r.latency || 0 }; });
      fire("message", name + " is frozen" + (r.latency ? " (its plugins' delay of " + Math.round(r.latency / rate * 10000) / 10 + " ms is taken off)" : "") + ".");
      return track(id) && track(id).frozen;
    });
    var done = function () { if (!opts.temp) { delete NH.busy[id]; fire("freeze", { track: id, busy: false }); } };   // (cleared before it resolves: "frozen" straight after)
    job = job.then(function (v) { done(); return v; }, function (e) { done(); fire("message", "Couldn't " + (opts.temp ? "play " + name + " through its plugins" : "freeze " + name) + ": " + (e && e.message || e)); throw e; });
    if (!opts.temp) NH.busy[id] = job;
    return job;
  }
  function beatsPerBarAt(b) { try { return beatToBar(b).per || 4; } catch (_) { return 4; } }
  function unfreeze(id) { var t = track(id); if (t && t.frozen) edit("Unfreeze", function () { track(id).frozen = null; }); }
  function nativeState(t) { var n = natives(t); return !n.length ? "none" : NH.busy[t.id] ? "freezing" : frozenOK(t) ? "frozen" : t.frozen ? "stale" : "unfrozen"; }

  // ------------------------------------------------------------- native plugins, live (10.3)
  // In the apps every track with VST3 / CLAP plugins plays through them while the song plays: no freezing. What a track
  // will play is known ahead, so its dry sound (clips through its instrument) is rendered a little ahead of the playhead
  // (an OfflineAudioContext for each window of the song, tapped a chunk at a time by an AudioWorklet and paused so it
  // keeps about NL.ahead seconds in front), streamed through the track's plugins in the rig (cu-rig.c: "the DAW's
  // native plugins, live") and scheduled at its song time less the chain's reported latency. So every track lines up
  // with the others, and nothing else in the mix is held back. Automation of a plugin's parameters goes with the audio,
  // at its frame; a knob turned (here or in the plugin's window) is heard about NL.ahead later. A loop or a seek starts
  // new windows; a start or a seek resets the plugins (what a delay line still held is played out), an edit while it
  // plays carries on without. Freezing a track still saves CPU: a frozen track plays its frozen sound instead.
  var NL = { ahead: 0.6, chunk: 8192, win: 12, S: null, idx: {}, next: 0, chains: {}, knobs: {}, n: 0, stats: { late: 0, chunks: 0, worstMs: 0, batches: 0 } };
  function liveHost() { return NH.host && NH.host.stream ? NH.host.stream : null; }
  function liveTracks() { return liveHost() && ctx ? proj.tracks.filter(function (t) { return t.kind !== "bus" && natives(t).length && !frozenOK(t); }) : []; }
  function liveIdx(id) { if (NL.idx[id] == null) NL.idx[id] = NL.next++ % 64; return NL.idx[id]; }
  function chainSig(t) { return JSON.stringify(natives(t).map(function (f) { return [f.id, f.plugin.format, f.plugin.id, f.plugin.path]; })) + "@" + (ctx ? ctx.sampleRate : 0); }
  function knobList(f) { var p = f.params || {}; return Object.keys(p).filter(function (k) { return /^\d+$/.test(k); }).sort().map(function (k) { return [+k, +p[k]]; }); }
  function liveChains(tracks) {
    var H = liveHost();
    Object.keys(NL.idx).forEach(function (id) { var t = track(id), i = NL.idx[id]; if (NL.chains[i] && !(t && natives(t).length)) { H.drop(i); delete NL.chains[i]; } });   // (no plugins any more)
    return Promise.all(tracks.map(function (t) {
      var i = liveIdx(t.id), sig = chainSig(t); if (NL.chains[i] && NL.chains[i].sig === sig) return NL.chains[i].p;
      var c = NL.chains[i] = { sig: sig, lat: 0 };
      natives(t).forEach(function (f) { knobList(f).forEach(function (kv) { NL.knobs[f.id + ":" + kv[0]] = kv[1]; }); });
      c.p = H.chain(i, ctx.sampleRate, natives(t).map(function (f) { return Object.assign(nativeJob(f), { params: knobList(f) }); })).then(function (r) {
        c.lat = r && r.latency || 0; if (r && r.errors && r.errors.length) fire("message", "A plugin didn't load: " + r.errors[0]); return r; });
      return c.p;
    }));
  }
  // a knob turned in the panel: to the plugin now (an automated parameter follows its lane instead)
  function liveKnob(fxId) {
    var H = liveHost(); if (!H) return; var t = null, k = -1;
    proj.tracks.some(function (x) { var n = natives(x); for (var i = 0; i < n.length; i++) if (n[i].id === fxId) { t = x; k = i; return true; } return false; });
    if (!t || NL.idx[t.id] == null || !NL.chains[NL.idx[t.id]]) return;
    knobList(natives(t)[k]).forEach(function (kv) { var key = fxId + ":" + kv[0], lane = t.auto && t.auto["fx:" + fxId + ":" + kv[0]]; if ((lane && lane.length) || NL.knobs[key] === kv[1]) return; NL.knobs[key] = kv[1]; H.param(NL.idx[t.id], k, kv[0], kv[1]); });
  }
  function liveStart(fromBeat, opts) {   // a session from fromBeat: S.first resolves when its first sound is in
    opts = opts || {}; var tracks = liveTracks(); if (!tracks.length) return null;
    var S = { from: fromBeat, cur: fromBeat, t0: null, rate: ctx.sampleRate, ids: tracks.map(function (t) { return t.id; }), sigs: tracks.map(chainSig).join("|"), srcs: [], pending: [], dead: false, base: 0, got: 0, reset: !opts.carryOn, autoLast: {}, done: false };
    S.idx = S.ids.map(liveIdx); S.t0want = opts.t0;
    var ok; S.first = new Promise(function (r) { ok = r; }); S.firstOK = function () { if (ok) { var o = ok; ok = null; o(); } }; setTimeout(S.firstOK, 4000);
    NL.S = S; NL.stats.sessions = (NL.stats.sessions || 0) + 1;
    liveChains(tracks).then(function () { if (!S.dead) return liveFeed(S); }).catch(function (e) { fire("message", "The plugins couldn't play live: " + (e && e.message || e)); S.firstOK(); });
    return S;
  }
  function liveBegin(S, t0) {   // the transport has started: when the session's first frame is heard
    S.t0 = Math.round(t0 * S.rate) / S.rate; var p = S.pending; S.pending = [];
    p.forEach(function (x) { liveOut(S, x[0], x[1], x[2], x[3]); });
  }
  function liveStop(at) {   // its sound ends at `at` (now when not given)
    var S = NL.S; if (!S) return; S.dead = true; NL.S = null; S.firstOK();
    var t = Math.max(at != null ? at : 0, ctx ? ctx.currentTime : 0);
    S.srcs.forEach(function (x) { try { x.src.stop(t); } catch (_) { } });
  }
  function liveFeed(S) {
    if (S.dead || S.done) { S.firstOK(); return Promise.resolve(); }
    var L = proj.loop, loop = L.on && L.end > L.start, a = S.cur, endB = secToBeat(beatToSec(Math.max(songEnd(), a)) + 4), lim = loop && a < L.end - 1e-9 ? L.end : endB;
    if (a >= lim - 1e-9) { S.done = true; S.firstOK(); return Promise.resolve(); }
    var b = Math.min(lim, secToBeat(beatToSec(a) + NL.win));
    return liveWindow(S, a, b).then(function () {
      if (loop && a < L.end - 1e-9 && b >= L.end - 1e-9) S.cur = L.start; else { S.cur = b; if (b >= endB - 1e-9) S.done = true; }
      return liveFeed(S);
    });
  }
  // one window [a, b) of the song: the live tracks' dry sound, offline, a chunk at a time, kept just ahead of the playhead
  function liveWindow(S, a, b) {
    var rate = S.rate, secA = beatToSec(a), secB = beatToSec(b), pre = Math.min(1, secA), preF = Math.round(pre * rate), frames = Math.round((secB - secA) * rate), base = S.base, from = secToBeat(secA - pre);
    S.base += frames; if (frames <= 0) return Promise.resolve();
    var keep = proj, p2 = clone(proj);
    p2.tracks = p2.tracks.filter(function (t) { return S.ids.indexOf(t.id) >= 0; });
    p2.tracks.forEach(function (t) { t.inserts = []; t.volume = 0; t.pan = 0; t.sends = []; t.auto = {}; t.output = "master"; t.frozen = null; t.mute = false; t.solo = false; });
    p2.master = { volume: 0, inserts: [] }; p2.metronome = Object.assign({}, p2.metronome, { on: false });
    var oc = new OfflineAudioContext(1, preF + frames, rate), g = new Graph(oc, true), tw = performance.now();
    return worklets(oc).then(function () { return g.sync(p2); }).then(function () {
      if (S.dead) return;
      var tap = new AudioWorkletNode(oc, "cdaw-tap", { numberOfInputs: S.ids.length, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 2, channelCountMode: "explicit", processorOptions: { chunk: NL.chunk, skip: preF, total: preF + frames } });
      S.ids.forEach(function (id, k) { var st = g.strips[id]; if (!st) return; try { st.input.disconnect(); } catch (_) { } st.input.connect(tap, 0, k); });
      tap.connect(oc.destination);
      NL.stats.setupMs = Math.max(NL.stats.setupMs || 0, performance.now() - tw);
      tap.port.onmessage = function (e) { if (!S.dead) liveChunk(S, base + e.data.s, e.data.n, e.data.d, secA, base); };
      var sink = { graph: g, time: function (x) { return beatToSec(x) - beatToSec(from); }, started: {}, sources: [], notes: [], pass: 1, from: from, first: true, offline: true }, acts = {};
      function at(sec, fn, hold) { var q = Math.round(sec * rate / 128) * 128; if (q <= 0 || q >= preF + frames) { if (fn) fn(); return; } var x = acts[q] = acts[q] || { fns: [], hold: null }; if (fn) x.fns.push(fn); if (hold != null) x.hold = hold; }
      function sched(x, y) { proj = p2; try { schedule(sink, x, y); } catch (e2) { console.warn("live", e2); } proj = keep; }
      sched(from, Math.min(b, from + 2)); sink.first = false;
      for (var x = from + 2; x < b; x += 2) (function (x) { at(sink.time(x) - 0.3, function () { sched(x, Math.min(b, x + 2)); }); })(x);
      for (var f = preF + NL.chunk; f < preF + frames; f += NL.chunk) at(f / rate, null, base + f - preF);
      Object.keys(acts).forEach(function (q) {
        oc.suspend(q / rate).then(function () {
          if (S.dead) return; acts[q].fns.forEach(function (fn) { fn(); });
          (acts[q].hold != null ? liveHold(S, acts[q].hold) : Promise.resolve(true)).then(function (go) { if (go) oc.resume(); });
        });
      });
      return oc.startRendering().catch(function () { });
    });
  }
  function liveHold(S, sf) {   // wait until stream frame sf is no more than about NL.ahead from being heard
    return new Promise(function (res) {
      (function chk() { if (S.dead) return res(false); var t0 = S.t0 != null ? S.t0 : ctx.currentTime + 0.15; if (t0 + sf / S.rate - ctx.currentTime < NL.ahead * 1.5 + 0.2) res(true); else setTimeout(chk, 25); })();
    });
  }
  function liveAuto(S, t, sf, n, secA, sfA) {   // [[frame in the chunk, plugin, parameter, value]] - the lanes of the track's plugins
    var out = [], aut = t && t.auto || {};
    natives(t).forEach(function (f, k) {
      Object.keys(aut).forEach(function (key) {
        var m = /^fx:([^:]+):(\d+)$/.exec(key); if (!m || m[1] !== f.id || !aut[key] || !aut[key].length) return;
        var pts = aut[key].slice().sort(function (x, y) { return x.b - y.b; }), lk = t.id + key;
        for (var o = 0; o < n; o += 256) { var v = autoAt(pts, secToBeat(secA + (sf + o - sfA) / S.rate)); if (S.autoLast[lk] == null || Math.abs(S.autoLast[lk] - v) > 1e-4) { out.push([o, k, +m[2], v]); S.autoLast[lk] = v; } }
      });
    });
    return out.sort(function (x, y) { return x[0] - y[0]; });
  }
  function liveChunk(S, sf, n, data, secA, sfA) {
    var H = liveHost(), streams = [];
    S.ids.forEach(function (id, k) {
      var d = data[k]; if (!d) return; var st = { s: S.idx[k], d: n < NL.chunk ? d.subarray(0, n * 2) : d };
      if (S.reset) st.reset = true;
      var au = liveAuto(S, track(id), sf, n, secA, sfA); if (au.length) st.a = au;
      streams.push(st);
    });
    S.reset = false; NL.stats.batches++; var tq = performance.now();
    return H.process({ frames: n, streams: streams }).then(function (r) {
      var rt = performance.now() - tq; NL.stats.rtMax = Math.max(NL.stats.rtMax || 0, rt); NL.stats.rtSum = (NL.stats.rtSum || 0) + rt;
      if (!r || S.dead) return;
      r.streams.forEach(function (x) { var k = S.idx.indexOf(x.s); if (k >= 0) liveOut(S, S.ids[k], sf, x.d, x.lat || 0); });
      S.got += n; if (S.got >= Math.min(NL.ahead * S.rate * 0.75, S.base)) S.firstOK();
    });
  }
  function liveOut(S, tid, sf, u8, lat) {   // a processed chunk, at its song time less the chain's latency
    if (S.t0 == null) { S.pending.push([tid, sf, u8, lat]); return; }
    var f = u8.byteOffset % 4 ? new Float32Array(u8.slice().buffer) : new Float32Array(u8.buffer, u8.byteOffset, u8.byteLength >> 2), n = f.length >> 1, start = sf - lat, skip = start < 0 ? -start : 0;
    var strip = rt && rt.strips[tid]; if (n - skip <= 0 || !strip) return;
    var b = ctx.createBuffer(2, n - skip, S.rate), L = b.getChannelData(0), R = b.getChannelData(1);
    for (var i = skip; i < n; i++) { L[i - skip] = f[2 * i]; R[i - skip] = f[2 * i + 1]; }
    var when = S.t0 + (start + skip) / S.rate, now = ctx.currentTime, src = ctx.createBufferSource(); src.buffer = b; src.connect(strip.input); src.onended = function () { try { src.disconnect(); } catch (_) { } };
    NL.stats.chunks++; var pt = NL.stats.per = NL.stats.per || {}; pt[tid] = (pt[tid] || 0) + 1;
    if (when < now + 0.003) { var late = now + 0.005 - when; NL.stats.late++; NL.stats.worstMs = Math.max(NL.stats.worstMs, late * 1000);
      if (NL.ahead < 3 && !S.grew) { S.grew = true; NL.ahead = Math.min(3, NL.ahead + 0.3); fire("message", "This computer is busy: the plugins now play " + Math.round(NL.ahead * 1000) + " ms ahead."); }   /* (a slow or busy computer: more in hand from now on) */ if (late >= b.duration) return; src.start(now + 0.005, late); }
    else src.start(when);
    S.srcs = S.srcs.filter(function (x) { return x.end > now - 0.2; }); S.srcs.push({ src: src, end: when + b.duration });
  }
  function liveParams(tid, fid) {   // a plugin's parameters (normalized), for its knobs and automation lanes
    var t = track(tid), f = t && natives(t).filter(function (x) { return x.id === fid; })[0], H = liveHost(); if (!f || !H) return Promise.resolve([]);
    ensureCtx(); return liveChains([t]).then(function () { return H.params(nativeSlot(f)); }).then(function (l) {
      var list = (l || []).map(function (q) { return { id: q.id, name: q.name, value: q.value }; }).slice(0, 24);
      nudge("Plugin parameters", function () { var x = track(tid), y = x && x.inserts.filter(function (q) { return q.id === fid; })[0]; if (y) y.plist = list; }); return list;
    });
  }
  function liveWindowOpen(tid, fid) {   // the plugin's own window, on the instance that plays the track
    var t = track(tid), f = t && natives(t).filter(function (x) { return x.id === fid; })[0]; if (!f || !NH.host) return Promise.resolve({ ok: false });
    ensureCtx(); return (liveHost() ? liveChains([t]) : Promise.resolve()).then(function () { return NH.host.editor(nativeSlot(f), liveHost() ? [] : natives(t).map(nativeJob), true); });
  }
  on("change", function (w) { if (w === "nudge" || !T.playing || !NL.S) return; var l = liveTracks(); if (l.map(function (t) { return t.id; }).join() !== NL.S.ids.join() || l.map(chainSig).join("|") !== NL.S.sigs) reschedule(); });

  // ------------------------------------------------------------- audio in
  function addAudio(buf, id) { id = id || uid("au"); buffers[id] = buf; return id; }
  function decode(bytes) { var c = ensureCtx(); var b = bytes instanceof ArrayBuffer ? bytes : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); return window.CMProj ? window.CMProj.decode(c, new Uint8Array(b)) : c.decodeAudioData(b); }
  // a file onto a track at a beat. opts.bpm / opts.key: it's a loop - stretched to the song's tempo and moved to its key
  function importAudio(trackId, bytes, name, atBeat, opts) {
    opts = opts || {};
    return decode(bytes).then(function (buf) {
      var orig = addAudio(buf), src = orig, warp = null;
      if (opts.bpm && window.CDawStretch) { var semis = keyShift(opts.key, proj.key); warp = { from: opts.bpm, key: opts.key || null, orig: orig, semis: semis, at: bpmAt(atBeat || 0) }; var st = window.CDawStretch.stretch(buf, opts.bpm / bpmAt(atBeat || 0), semis); src = addAudio(st); buf = st; }
      return edit("Add " + (name || "audio"), function () {
        var t = track(trackId); if (!t || t.kind !== "audio") { t = newTrack("audio", (name || "Audio").replace(/\.[^.]+$/, "").slice(0, 24)); t.color = COLORS[proj.tracks.length % COLORS.length]; insertTrack(t); }
        var start = atBeat || 0, len = secToBeat(beatToSec(start) + buf.duration) - start;
        if (opts.bars && opts.bpm) len = opts.bars * beatToBar(start).per;
        var cl = { id: uid("c"), kind: "audio", start: start, len: len, name: (name || "Audio").replace(/\.[^.]+$/, ""), audio: { src: src, offset: 0, gain: 0, fadeIn: 0.004, fadeOut: 0.008, loop: !!opts.bpm, warp: warp } };
        t.clips.push(cl); return { track: t, clip: cl };
      });
    });
  }
  function keyShift(from, to) { if (!from || !to) return 0; var a = KEYS.indexOf(String(from).replace(/m$/, "").replace("D#", "Eb").replace("G#", "Ab").replace("A#", "Bb").replace("Db", "C#").replace("Gb", "F#")), b = KEYS.indexOf(String(to).replace(/m$/, "")); if (a < 0 || b < 0) return 0; var d = ((b - a) % 12 + 12) % 12; return d > 6 ? d - 12 : d; }
  // after a tempo or key change: loops stretched again from their original
  function rewarp() {
    var jobs = 0;
    proj.tracks.forEach(function (t) { t.clips.forEach(function (c) { var w = c.audio && c.audio.warp; if (!w || !buffers[w.orig]) return; var want = bpmAt(c.start), semis = w.key ? keyShift(w.key, proj.key) : (w.semis || 0); if (Math.abs(want - w.at) < 0.01 && semis === (w.semis || 0)) return; var st = window.CDawStretch.stretch(buffers[w.orig], w.from / want, semis); c.audio.src = addAudio(st); w.at = want; w.semis = semis; jobs++; }); });
    return jobs;
  }
  function insertTrack(t) { var i = proj.tracks.findIndex(function (x) { return x.kind === "bus"; }); if (i < 0) proj.tracks.push(t); else proj.tracks.splice(i, 0, t); }
  function usedAudio() { var used = {}; proj.tracks.forEach(function (t) { if (t.frozen && t.frozen.src) used[t.frozen.src] = 1; t.clips.forEach(function (c) { if (c.kind !== "audio") return; if (c.audio && c.audio.src) used[c.audio.src] = 1; (c.takes || []).forEach(function (k) { used[k.src] = 1; }); if (c.audio && c.audio.warp && c.audio.warp.orig) used[c.audio.warp.orig] = 1; }); }); return Object.keys(used).filter(function (id) { return buffers[id]; }); }

  // ------------------------------------------------------------- render (exports, faster than real time)
  function songEnd() { var e = 0; proj.tracks.forEach(function (t) { t.clips.forEach(function (c) { if (!c.mute) e = Math.max(e, c.start + c.len); }); }); return e; }
  function render(o) {
    o = o || {};
    if (o.raw) return renderRaw(o);
    var stale = proj.tracks.filter(function (t) { return natives(t).length && !frozenOK(t) && (!o.tracks || o.tracks.indexOf(t.id) >= 0); });
    if (stale.length && !NH.host) fire("message", "VST3 / CLAP plugins aren't in this mix: they play in the apps on a computer.");
    if (!stale.length || !NH.host) return renderRaw(o);
    var temp = {};
    return stale.reduce(function (p, t) { return p.then(function () { return freeze(t.id, { temp: true }).then(function (fz) { if (fz) temp[t.id] = fz; }); }); }, Promise.resolve()).then(function () { return renderRaw(Object.assign({}, o, { temp: temp })); });
  }
  function renderRaw(o) {
    o = o || {}; var from = o.from || 0, to = o.to != null ? o.to : songEnd(); if (!(to > from)) return Promise.reject(new Error("There's nothing on the timeline yet: record or put clips on it first."));
    var rate = o.rate || 48000, tail = o.tail == null ? 3 : o.tail, secs = beatToSec(to) - beatToSec(from) + tail, oc = new OfflineAudioContext(2, Math.ceil(secs * rate), rate);
    var keep = proj; proj = clone(proj);
    if (o.tracks) proj.tracks.forEach(function (t) { if (t.kind === "bus") return; t.solo = o.tracks.indexOf(t.id) >= 0; if (t.solo) t.mute = false; });
    if (o.temp) proj.tracks.forEach(function (t) { if (o.temp[t.id]) { t.frozen = Object.assign({}, o.temp[t.id]); t.frozen.sig = freezeSig(t); } });
    if (o.dry) { proj.tracks.forEach(function (t) { if (t.id !== o.dry) return; t.inserts = []; t.volume = 0; t.pan = 0; t.sends = []; t.auto = {}; t.output = "master"; t.frozen = null; t.mute = false; t.solo = true; }); proj.master = { volume: 0, inserts: [] }; }
    proj.metronome = Object.assign({}, proj.metronome, { on: false });
    var g = new Graph(oc, true); g.auto = true; var p2 = proj;
    return worklets(oc).then(function () { return g.sync(p2); }).then(function () { return Promise.all(oc.__cdawPending || []); }).then(function () {   // (Central FX plugins load before it renders)
      var t0 = 0.02, sink = { graph: g, time: function (b) { return t0 + beatToSec(b) - beatToSec(from); }, started: {}, sources: [], notes: [], pass: 1, from: from, first: true, offline: true };
      // scheduled a few seconds at a time (the render pauses to take the next part): everything up front would keep every
      // note of the song in the graph from the start, and an export of a busy song would get slower and slower
      autoStart(g, from, t0); var CH = 2, end = to + 1e-6, seen = {};
      schedule(sink, from, Math.min(end, from + CH)); sink.first = false;
      for (var b = from + CH; b < end; b += CH) (function (a) {
        var at = Math.floor((sink.time(a) - 0.3) * rate / 128) * 128 / rate;
        if (at <= 0.05 || seen[at]) { schedule(sink, a, Math.min(end, a + CH)); return; }
        seen[at] = 1;
        oc.suspend(at).then(function () { var k = proj; proj = p2; try { schedule(sink, a, Math.min(end, a + CH)); } catch (e) { console.warn("render", e); } proj = k; oc.resume(); });
      })(b);
      proj = keep; return oc.startRendering();
    }).catch(function (e) { proj = keep; throw e; }).then(function (buf) {
      if (o.tail === 0 || o.exact) { var n = Math.round((beatToSec(to) - beatToSec(from)) * rate), out = new AudioBuffer({ numberOfChannels: 2, length: n, sampleRate: rate }); for (var ch = 0; ch < 2; ch++) out.copyToChannel(buf.getChannelData(ch).subarray(Math.round(0.02 * rate), Math.round(0.02 * rate) + n), ch); return out; }
      return buf;
    });
  }
  function stems(o) { o = o || {}; var list = proj.tracks.filter(function (t) { return t.kind !== "bus" && t.clips.some(function (c) { return !c.mute; }); }), out = []; return list.reduce(function (pr, t) { return pr.then(function () { return render(Object.assign({}, o, { tracks: [t.id] })).then(function (b) { out.push({ track: t, buffer: b }); }); }); }, Promise.resolve()).then(function () { return out; }); }

  // ------------------------------------------------------------- loading, saving, recovery
  function load(p, bufs) {
    stop({ home: true }); p = migrate(p);
    Object.assign(buffers, bufs || {});
    proj = p; proj.tracks.forEach(function (t) { t.clips = t.clips || []; t.sends = t.sends || []; t.inserts = t.inserts || []; t.auto = t.auto || {}; t.lanes = t.lanes || []; });
    proj.master = proj.master || { volume: 0, inserts: [] }; proj.tempos = proj.tempos || []; proj.sigs = proj.sigs || []; proj.markers = proj.markers || []; proj.punch = proj.punch || { on: false, start: 4, end: 8 };
    undoStack = []; redoStack = []; dirty = false; changed("load"); fire("transport", state());
  }
  function fresh(o) { load(newProject(o)); }
  function markSaved() { dirty = false; proj.savedAt = Date.now(); recovery.forget(proj.id); fire("saved", proj); fire("change", "saved"); }
  var recovery = (function () {
    var DB = null;
    function db() { if (DB) return DB; DB = new Promise(function (res, rej) { var r = indexedDB.open("cdaw-recovery", 1); r.onupgradeneeded = function () { r.result.createObjectStore("work"); r.result.createObjectStore("audio"); }; r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); return DB; }
    function tx(store, mode, fn) { return db().then(function (d) { return new Promise(function (res, rej) { var t = d.transaction(store, mode), r = fn(t.objectStore(store)); t.oncomplete = function () { res(r && r.result); }; t.onerror = function () { rej(t.error); }; }); }); }
    var savedAudio = {};
    return {
      keep: function () {
        if (!window.indexedDB) return Promise.resolve();
        var p = proj, ids = usedAudio().filter(function (id) { return !savedAudio[id]; });
        return Promise.all(ids.map(function (id) { var b = buffers[id], ch = []; for (var c = 0; c < b.numberOfChannels; c++) ch.push(b.getChannelData(c)); return tx("audio", "readwrite", function (st) { return st.put({ rate: b.sampleRate, ch: ch }, p.id + "/" + id); }).then(function () { savedAudio[id] = 1; }); }))
          .then(function () { return tx("work", "readwrite", function (st) { return st.put({ id: p.id, name: p.name, at: Date.now(), host: recovery.host || "", json: JSON.stringify(p) }, p.id); }); }).catch(function () { });
      },
      list: function () { if (!window.indexedDB) return Promise.resolve([]); return tx("work", "readonly", function (st) { return st.getAll(); }).then(function (a) { return (a || []).map(function (x) { return { id: x.id, name: x.name, at: x.at, host: x.host }; }).sort(function (a2, b2) { return b2.at - a2.at; }); }).catch(function () { return []; }); },
      restore: function (id) {
        return tx("work", "readonly", function (st) { return st.get(id); }).then(function (w) {
          if (!w) throw new Error("That work isn't there any more.");
          var p = JSON.parse(w.json), need = []; p.tracks.forEach(function (t) { if (t.frozen && t.frozen.src) need.push(t.frozen.src); t.clips.forEach(function (c) { if (c.audio) { need.push(c.audio.src); if (c.audio.warp) need.push(c.audio.warp.orig); } (c.takes || []).forEach(function (k) { need.push(k.src); }); }); });
          var bufs = {}, c = ensureCtx();
          return Promise.all(need.map(function (aid) { return tx("audio", "readonly", function (st) { return st.get(id + "/" + aid); }).then(function (x) { if (!x) return; var b = c.createBuffer(x.ch.length, x.ch[0].length, x.rate); x.ch.forEach(function (d, i) { b.copyToChannel(d, i); }); bufs[aid] = b; savedAudio[aid] = 1; }); }))
            .then(function () { load(p, bufs); dirty = true; fire("change", "recovered"); return p; });
        });
      },
      forget: function (id) { if (!window.indexedDB) return Promise.resolve(); return tx("work", "readwrite", function (st) { return st.delete(id); }).catch(function () { }); },
      host: ""
    };
  })();
  var autosaveT = 0;
  function autosaveSoon() { if (!dirty) return; clearTimeout(autosaveT); autosaveT = setTimeout(function () { if (!T.recording) recovery.keep(); }, 2500); }
  window.addEventListener("pagehide", function () { if (dirty) recovery.keep(); });

  // ------------------------------------------------------------- helpers for the UI
  function quantize(notes, grid, strength) { var g = typeof grid === "number" ? grid : SNAP[grid] || 0.25, k = strength == null ? 1 : strength; if (!g) return notes; notes.forEach(function (n) { var q = Math.round(n.s / g) * g; n.s = Math.max(0, n.s + (q - n.s) * k); if (k >= 1) n.d = Math.max(g / 2, Math.round(n.d / g) * g || g); }); return notes; }
  function humanize(notes, timingBeats, vel) { notes.forEach(function (n) { n.s = Math.max(0, n.s + (Math.random() * 2 - 1) * timingBeats); n.v = clamp(Math.round(n.v + (Math.random() * 2 - 1) * vel), 1, 127); }); return notes; }
  function split(clipId, beat) {
    var f = findClip(clipId); if (!f || beat <= f.clip.start + 0.01 || beat >= f.clip.start + f.clip.len - 0.01) return null;
    var c = f.clip, r = clone(c); r.id = uid("c"); r.start = beat; r.len = c.start + c.len - beat; c.len = beat - c.start;
    if (c.kind === "audio") { r.audio.offset = (c.audio.offset || 0) + beatToSec(beat) - beatToSec(c.start); c.audio.fadeOut = 0.008; r.audio.fadeIn = 0.004; }
    else { var sh = beat - c.start, L = c.loopLen && c.loopLen > 0 ? c.loopLen : null; if (L) { var all = []; for (var k = 0; k * L < c.len + r.len; k++) (c.notes || []).forEach(function (n) { if (n.s < L) all.push(Object.assign({}, n, { s: n.s + k * L })); }); c.notes = all.filter(function (n) { return n.s < c.len; }); r.notes = all.filter(function (n) { return n.s >= sh; }).map(function (n) { return Object.assign({}, n, { s: n.s - sh }); }); delete c.loopLen; delete r.loopLen; } else { r.notes = (c.notes || []).filter(function (n) { return n.s >= sh; }).map(function (n) { return Object.assign({}, n, { s: n.s - sh }); }); c.notes = (c.notes || []).filter(function (n) { return n.s < sh; }).map(function (n) { return Object.assign({}, n, { d: Math.min(n.d, sh - n.s) }); }); } }
    f.track.clips.push(r); return r;
  }

  window.CDaw = {
    on: on, fire: fire, project: project, track: track, findClip: findClip, newProject: newProject, newTrack: newTrack, insertTrack: insertTrack, edit: edit, nudge: nudge, undo: undo, redo: redo, migrate: migrate,
    canUndo: function () { return undoStack.length ? undoStack[undoStack.length - 1].label : null; }, canRedo: function () { return redoStack.length ? redoStack[redoStack.length - 1].label : null; },
    isDirty: function () { return dirty; }, markSaved: markSaved, load: load, fresh: fresh,
    play: play, stop: stop, toggle: toggle, setPos: setPos, position: position, state: state, record: record, live: liveMidi, startMonitor: startMonitor, monitor: function () { return monitor; },
    render: render, stems: stems, songEnd: songEnd, buffers: buffers, addAudio: addAudio, decode: decode, importAudio: importAudio, usedAudio: usedAudio, rewarp: rewarp, keyShift: keyShift,
    split: split, cutRange: cutRange, quantize: quantize, humanize: humanize, snapBeat: snapBeat, autoAt: autoAt, clipSrc: clipSrc,
    tempo: { beatToSec: beatToSec, secToBeat: secToBeat, barToBeat: barToBeat, beatToBar: beatToBar, bpmAt: bpmAt, bpb: function (b) { return beatToBar(b || 0).per; } },
    FX: FX, fxDef: fxDef, fxDefaults: fxDefaults, pro: pro, ctx: ensureCtx, graph: function () { return rt; }, latency: latency, recovery: recovery,
    liveFx: { stats: function () { return NL.stats; }, session: function () { return NL.S; }, tracks: liveTracks, params: liveParams, openWindow: liveWindowOpen, ahead: function (v) { if (v != null) NL.ahead = Math.max(0.15, Math.min(2, +v)); return NL.ahead; }, chains: function () { return NL.chains; } },
    native: { setHost: function (h) { NH.host = h || null; NH.monKey = null; NL.chains = {}; syncInputMonitor(); }, host: function () { return NH.host; }, list: natives, slot: nativeSlot, freeze: freeze, unfreeze: unfreeze, state: nativeState, frozen: frozenOK, sig: freezeSig },
    audio: { settings: audioSettings, set: setAudio, devices: devices, info: inputInfo, measure: measureLatency, choices: inputChoices, channelsOf: chansOf, findDelay: findDelay, compensation: compensation }, uid: uid, COLORS: COLORS, KEYS: KEYS, SNAP: SNAP, dbToGain: dbToGain, clamp: clamp, clone: clone
  };
})();
