/* Central Usage - Studio: the engine behind the Studio tab (studio-ui.js draws it).
 *
 * A project: tempo, key, time signature, tracks (instrument, drums or audio), scenes, clips, and the timeline.
 *   Grid (session): every track has a column of clip slots, every row is a scene. A clip loops from the moment it's
 *     launched, on the next bar (or beat - "Launch on"). A scene launches a whole row.
 *   Timeline (arrangement): clips laid out in bars. A track playing a grid clip leaves the timeline until "Back to
 *     timeline".
 * Playback runs here in Web Audio, every note timed to the sample (scheduled a little ahead). What you play live on a
 * MIDI keyboard goes to cu-studio (studio.js) when the app has it - a native player with ~3 ms of delay - or plays here.
 * The mixer: every track has gate, EQ, compressor, reverb and delay (the same effects as the Central Pedal's 9.8 tracks:
 * js/fx-dsp.js; the better ones with Central Plugins), pan, volume, mute and solo; the master has a safety limiter.
 * Exports render the timeline offline (faster than real time) to a WAV mix, or one WAV per track.
 *
 *   CUStudio.project() / newProject(opts) / load(json) / edit(label, fn) / undo() / redo()
 *   CUStudio.play() / stop() / record() / setPos(beat) / launch(trackId, slot) / launchScene(i) / stopTrack(id) / stopAll()
 *   CUStudio.live(trackId, [status, d1, d2], time)   a note from a keyboard (also what the MIDI routing calls)
 *   CUStudio.bounce({ tracks, from, to }) -> Promise<AudioBuffer>; CUStudio.wav(buffer, bits) -> ArrayBuffer
 *   CUStudio.save() / open(id) / list() / remove(id)
 *   CUStudio.on(event, fn): "change" (project edited), "transport", "clip" (grid states), "meters", "record", "monitor"
 */
(function () {
  "use strict";
  var SND = window.CUStudioSounds, NAT = window.CU && window.CU.studio, CORE = window.PP_FX_CORE ? window.PP_FX_CORE() : null;
  var bus = {};
  function on(ev, fn) { (bus[ev] = bus[ev] || []).push(fn); return function () { var a = bus[ev] || [], i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); }; }
  function fire(ev, a) { (bus[ev] || []).slice().forEach(function (fn) { try { fn(a); } catch (e) { console.warn("studio", ev, e); } }); }
  function uid(p) { return (p || "x") + Math.random().toString(36).slice(2, 9); }
  function clamp(v, a, b) { v = Number(v); return isFinite(v) ? Math.max(a, Math.min(b, v)) : a; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  var COLORS = ["#E2C27E", "#8DB5DE", "#E58A7B", "#9BCB86", "#C79BE0", "#E8A65A", "#6FC8C1", "#D98FB3"];
  var KEYS = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];

  // ------------------------------------------------------------- the plan (Central Plugins opens the better effects)
  function pro() { var P = window.PPPedals; return !P || !P.has ? true : !!P.has("plugins"); }
  function defaultFx() {
    return { on: false, preset: "", trim: 0,
      gate: { on: false, threshold: -45, mode: "basic", range: -80, attack: 1, hold: 40, release: 120 },
      eq: { on: true, lowCut: 0, low: 0, mid: 0, midFreq: 1000, high: 0, highCut: 20000, bands: [{ on: false, freq: 250, gain: 0, q: 1 }, { on: false, freq: 2500, gain: 0, q: 1 }] },
      comp: { on: false, amount: 35, mode: "basic", threshold: -18, ratio: 3, attack: 10, release: 150, knee: 6, makeup: 0 },
      reverb: { on: false, type: "room", send: 15, size: 0 },
      delay: { on: false, time: "1/8", send: 12, feedback: 25, pingpong: false, tone: 6000 } };
  }
  function merge(base, over) {
    if (!over || typeof over !== "object") return base;
    Object.keys(over).forEach(function (k) { var v = over[k]; if (Array.isArray(v)) base[k] = v.map(function (x, i) { return x && typeof x === "object" ? merge(Object.assign({}, (base[k] || [])[i] || {}), x) : x; }); else if (v && typeof v === "object" && base[k] && typeof base[k] === "object") base[k] = merge(base[k], v); else base[k] = v; });
    return base;
  }
  function P(name, s, isPro) { return { name: name, s: s, pro: !!isPro }; }
  var PRESETS = [
    P("Clean", {}),
    P("Keys", { eq: { on: true, lowCut: 60, mid: -1.5, midFreq: 450 }, comp: { on: true, amount: 25 }, reverb: { on: true, type: "room", send: 14 } }),
    P("Bass", { eq: { on: true, lowCut: 35, low: 2, mid: -2, midFreq: 250 }, comp: { on: true, amount: 50 } }),
    P("Drums", { eq: { on: true, lowCut: 30, low: 2, mid: -3, midFreq: 400, high: 2 }, comp: { on: true, amount: 45 } }),
    P("Pad", { eq: { on: true, lowCut: 80, high: -1 }, reverb: { on: true, type: "room", send: 30 } }),
    P("Lead", { eq: { on: true, lowCut: 120, mid: 1.5, midFreq: 2500 }, comp: { on: true, amount: 30 }, delay: { on: true, time: "1/8", send: 14, feedback: 25 } }),
    P("Vocal", { eq: { on: true, lowCut: 90, mid: -2, midFreq: 350, high: 2.5 }, comp: { on: true, amount: 45 }, reverb: { on: true, type: "room", send: 14 } }),
    P("Grand hall keys", { eq: { on: true, lowCut: 50, bands: [{ on: true, freq: 300, gain: -2, q: 1 }, { on: true, freq: 4000, gain: 1.5, q: 0.8 }] }, comp: { on: true, mode: "full", threshold: -20, ratio: 2.5, attack: 15, release: 180, makeup: 2 }, reverb: { on: true, type: "hall", send: 22, size: 15 } }, true),
    P("Punchy drums", { gate: { on: true, mode: "full", threshold: -40, range: -30, attack: 0.5, hold: 30, release: 90 }, eq: { on: true, lowCut: 30, low: 3, bands: [{ on: true, freq: 380, gain: -4, q: 1.4 }, { on: true, freq: 4500, gain: 2.5, q: 0.9 }] }, comp: { on: true, mode: "full", threshold: -18, ratio: 4, attack: 30, release: 100, makeup: 3 } }, true),
    P("Tight bass", { eq: { on: true, lowCut: 30, highCut: 9000, bands: [{ on: true, freq: 80, gain: 2, q: 1 }, { on: true, freq: 800, gain: 1.5, q: 1.2 }] }, comp: { on: true, mode: "full", threshold: -24, ratio: 5, attack: 8, release: 140, makeup: 4 } }, true),
    P("Ambient lead", { eq: { on: true, lowCut: 140, highCut: 12000 }, delay: { on: true, time: "1/4.", send: 28, feedback: 45, pingpong: true, tone: 4000 }, reverb: { on: true, type: "plate", send: 26 } }, true),
    P("Cathedral pad", { eq: { on: true, lowCut: 80 }, reverb: { on: true, type: "cathedral", send: 40, size: 25 } }, true)
  ];
  function applyPreset(fx, name) {
    var p = PRESETS.filter(function (x) { return x.name === name; })[0]; if (!p) return fx;
    var keep = fx.on; fx = merge(defaultFx(), clone(p.s)); fx.on = name !== "Clean" ? true : keep; fx.preset = name;
    ["gate", "eq", "comp", "reverb", "delay"].forEach(function (k) { if (!p.s[k] && k !== "eq") fx[k].on = false; });
    return fx;
  }

  // ------------------------------------------------------------- the project
  function newTrack(kind, name, sound) {
    var t = { id: uid("t"), name: name || (kind === "audio" ? "Audio" : kind === "drums" ? "Drums" : "Keys"), kind: kind || "instrument", color: COLORS[0],
      layers: kind === "audio" ? [] : [{ sound: sound || (kind === "drums" ? "builtin:kit" : "builtin:keys"), name: "", lo: 0, hi: 127, velLo: 1, velHi: 127, octave: 0, transpose: 0, volume: 1, pan: 0 }],
      input: kind === "audio" ? "in1" : "any", arm: false, monitor: "auto", volume: 0.8, pan: 0, mute: false, solo: false, fx: defaultFx(), slots: {} };
    return t;
  }
  function newProject(o) {
    o = o || {};
    var p = { v: 1, id: uid("p"), name: o.name || "New song", bpm: clamp(o.bpm || 100, 30, 300), key: KEYS.indexOf(o.key) >= 0 ? o.key : "C", sig: [4, 4],
      loop: { on: false, start: 0, end: 16 }, metronome: { on: true, countIn: 0, level: 0.6 }, quantize: "1/16", launchQ: 4, overdub: false, lowLatency: true, recordLen: 0,
      tracks: [], scenes: [], clips: {}, arrangement: [], audioFiles: [], createdAt: Date.now() };
    var defs = o.tracks || [["instrument", "Keys", "builtin:keys"], ["drums", "Drums", "builtin:kit"], ["instrument", "Bass", "builtin:bass"], ["audio", "Audio", null]];
    defs.forEach(function (d, i) { var t = newTrack(d[0], d[1], d[2]); t.color = COLORS[i % COLORS.length]; p.tracks.push(t); });
    for (var s = 0; s < 8; s++) p.scenes.push({ id: uid("s"), name: "" });
    return p;
  }
  function newClip(kind, len) { return { id: uid("c"), kind: kind || "midi", name: "", len: len || 4, notes: [], audio: null, color: null }; }
  var proj = newProject(), undoStack = [], redoStack = [], dirty = false, savedOnce = false;
  function project() { return proj; }
  function track(id) { return proj.tracks.filter(function (t) { return t.id === id; })[0] || null; }
  function clip(id) { return proj.clips[id] || null; }
  function beatsPerBar() { return proj.sig[0] * 4 / proj.sig[1]; }
  function edit(label, fn, opts) {
    undoStack.push({ label: label, json: JSON.stringify(proj) }); if (undoStack.length > 120) undoStack.shift(); redoStack = [];
    var r = fn(proj); dirty = true; changed(opts && opts.what);
    return r;
  }
  function changed(what) { syncGraph(); syncMonitor(); fire("change", what || "all"); autosaveSoon(); }
  function undo() { var u = undoStack.pop(); if (!u) return null; redoStack.push({ label: u.label, json: JSON.stringify(proj) }); proj = JSON.parse(u.json); dirty = true; changed("undo"); return u.label; }
  function redo() { var r = redoStack.pop(); if (!r) return null; undoStack.push({ label: r.label, json: JSON.stringify(proj) }); proj = JSON.parse(r.json); dirty = true; changed("redo"); return r.label; }

  // grid quantize ("1/16" -> beats)
  var Q = { "1/4": 1, "1/8": 0.5, "1/16": 0.25, "1/32": 0.125, "1/8T": 1 / 3, "1/16T": 1 / 6, "off": 0 };
  function quantizeNotes(notes, grid, strength) {
    var g = typeof grid === "number" ? grid : Q[grid] || 0.25, k = strength == null ? 1 : strength; if (!g) return notes;
    notes.forEach(function (n) { var q = Math.round(n.s / g) * g; n.s = Math.max(0, n.s + (q - n.s) * k); if (k >= 1) { var e = Math.max(g, Math.round(n.d / g) * g); n.d = e; } });
    return notes;
  }

  // ------------------------------------------------------------- audio graph
  var ctx = null, rt = null;   // rt: the real-time graph
  var buffers = {};            // audio clips' AudioBuffers by audio id
  var GATE_SRC = "class G extends AudioWorkletProcessor{constructor(){super();this.p={threshold:-45,range:-80,attack:1,hold:40,release:120,on:0};this.env=0;this.g=1;this.h=0;this.port.onmessage=e=>{Object.assign(this.p,e.data)}}process(i,o){const a=i[0],b=o[0];if(!a||!a.length){return true}const p=this.p,sr=sampleRate,thr=Math.pow(10,p.threshold/20),fl=Math.pow(10,p.range/20),at=Math.exp(-1/(sr*Math.max(.0001,p.attack/1000))),rl=Math.exp(-1/(sr*Math.max(.001,p.release/1000))),hs=p.hold/1000*sr;for(let n=0;n<a[0].length;n++){let m=0;for(let c=0;c<a.length;c++){const v=Math.abs(a[c][n]);if(v>m)m=v}this.env=m>this.env?m:this.env*0.9995;let t;if(!p.on){t=1}else if(this.env>thr){t=1;this.h=hs}else if(this.h>0){this.h--;t=1}else t=fl;this.g=t>this.g?t+(this.g-t)*at:t+(this.g-t)*rl;for(let c=0;c<b.length;c++)b[c][n]=(a[c]||a[0])[n]*this.g}return true}}registerProcessor('cu-gate',G);" +
    "class R extends AudioWorkletProcessor{constructor(){super();this.on=false;this.port.onmessage=e=>{this.on=!!e.data.on}}process(i){const a=i[0];if(this.on&&a&&a.length){this.port.postMessage({t:currentTime,ch:a.map(x=>x.slice(0))})}return true}}registerProcessor('cu-rec',R);";
  var workletUrl = null;
  function addWorklets(c) {
    if (!c.audioWorklet) return Promise.resolve(false);
    if (c.__cuWorklets) return c.__cuWorklets;
    if (!workletUrl) workletUrl = "data:text/javascript;charset=utf-8," + encodeURIComponent(GATE_SRC);   // (a blob: URL doesn't load from a file:// page)
    c.__cuWorklets = c.audioWorklet.addModule(workletUrl).then(function () { return true; }).catch(function () { return false; });
    return c.__cuWorklets;
  }
  function impulse(c, type, size) {
    var secs = { room: 1.3, hall: 3.0, plate: 2.1, cathedral: 5.2 }[type] || 1.5; secs *= 1 + (size || 0) / 120;
    var n = Math.round(c.sampleRate * secs), b = c.createBuffer(2, n, c.sampleRate), pre = Math.round(c.sampleRate * ({ room: 0.008, hall: 0.024, plate: 0.004, cathedral: 0.04 }[type] || 0.01)), s = 12345;
    for (var ch = 0; ch < 2; ch++) { var d = b.getChannelData(ch), lp = 0, damp = type === "plate" ? 0.15 : type === "cathedral" ? 0.45 : 0.32; for (var i = pre; i < n; i++) { s = (s * 1103515245 + 12345 + ch * 7) & 0x7fffffff; var w = s / 0x3fffffff - 1; lp = lp + (w - lp) * (1 - damp * (i / n)); d[i] = lp * Math.pow(1 - (i - pre) / (n - pre), type === "room" ? 3.2 : 2.2) * 0.5; } }
    return b;
  }
  // a track's channel: input -> [gate] -> [EQ, compressor, reverb + delay sends] -> pan -> volume -> mute/solo -> meter -> out
  function Strip(c, out, gateOk) {
    function G(v) { var g = c.createGain(); g.gain.value = v == null ? 1 : v; return g; }
    this.c = c; this.input = G(); this.post = G(); this.pan = c.createStereoPanner(); this.fader = G(0.8); this.mute = G(1); this.meter = c.createAnalyser(); this.meter.fftSize = 512;
    this.post.connect(this.pan).connect(this.fader).connect(this.mute); this.mute.connect(this.meter); this.mute.connect(out);
    this.input.connect(this.post); this.chain = null; this.gateOk = gateOk; this.sig = "";
  }
  Strip.prototype.setFx = function (fx, bpm) {
    var c = this.c, plan = fx && fx.on && CORE ? CORE.plan(fx, pro(), bpm) : null, sig = JSON.stringify(plan);
    if (sig === this.sig) return; this.sig = sig;
    var now = c.currentTime;
    if (!plan) { if (this.chain) { try { this.input.disconnect(); } catch (_) { } this.input.connect(this.post); this.chain.dispose(); this.chain = null; } return; }
    var wantGate = !!(plan.gate && this.gateOk);   // (the gate only joins the chain when it's on: it runs for every sample)
    if (this.chain && this.chain.hasGate !== wantGate) { try { this.input.disconnect(); } catch (_) { } this.chain.dispose(); this.chain = null; }
    if (!this.chain) { this.chain = new Chain(c, wantGate); try { this.input.disconnect(); } catch (_) { } this.input.connect(this.chain.input); this.chain.output.connect(this.post); }
    this.chain.apply(plan, now);
  };
  function Chain(c, gateOk) {
    function G(v) { var g = c.createGain(); g.gain.value = v == null ? 1 : v; return g; }
    this.c = c; this.input = G(); this.output = G(); var last = this.input; this.hasGate = !!gateOk;
    if (gateOk) { try { this.gate = new AudioWorkletNode(c, "cu-gate", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] }); last.connect(this.gate); last = this.gate; } catch (_) { this.gate = null; } }
    this.eq = []; for (var i = 0; i < 7; i++) { var f = c.createBiquadFilter(); f.type = "peaking"; f.gain.value = 0; last.connect(f); last = f; this.eq.push(f); }
    this.comp = c.createDynamicsCompressor(); this.makeup = G(); this.compIn = G(1); this.compBypass = G(0);
    last.connect(this.compIn).connect(this.comp).connect(this.makeup).connect(this.output); last.connect(this.compBypass).connect(this.output);
    this.revSend = G(0); this.conv = c.createConvolver(); this.revOut = G(1); last.connect(this.revSend).connect(this.conv).connect(this.revOut).connect(this.output);
    this.dlySend = G(0); this.dlyL = c.createDelay(3); this.dlyR = c.createDelay(3); this.dlyTone = c.createBiquadFilter(); this.dlyTone.type = "lowpass"; this.dlyFb = G(0); this.dlyMerge = c.createChannelMerger(2); this.dlySplitIn = G(1); this.dlyCross = G(0);
    this.dlyStraight = G(1);   // (not ping-pong: the repeats in both sides; ping-pong: left, then right)
    last.connect(this.dlySend).connect(this.dlyL); this.dlyL.connect(this.dlyTone).connect(this.dlyFb).connect(this.dlyL); this.dlyL.connect(this.dlyCross).connect(this.dlyR);
    this.dlyL.connect(this.dlyMerge, 0, 0); this.dlyR.connect(this.dlyMerge, 0, 1); this.dlyL.connect(this.dlyStraight).connect(this.dlyMerge, 0, 1); this.dlyMerge.connect(this.output);
    this.trim = G(1); this.output.disconnect(); this.output.connect(this.trim); var o = this.output; this.output = this.trim; this._pre = o;
    this.revType = null;
  }
  Chain.prototype.apply = function (plan, now) {
    var c = this.c, bands = plan.eq || [];
    if (this.gate) this.gate.port.postMessage(plan.gate ? Object.assign({ on: 1 }, plan.gate) : { on: 0 });
    this.eq.forEach(function (f, i) { var q = bands[i]; if (q) { f.type = q[0]; f.frequency.setTargetAtTime(q[1], now, 0.02); f.gain.setTargetAtTime(q[2] || 0, now, 0.02); f.Q.setTargetAtTime(q[3] || 0.707, now, 0.02); } else { f.type = "peaking"; f.gain.setTargetAtTime(0, now, 0.02); } });
    var cp = plan.comp; this.compIn.gain.setTargetAtTime(cp ? 1 : 0, now, 0.02); this.compBypass.gain.setTargetAtTime(cp ? 0 : 1, now, 0.02);
    if (cp) { this.comp.threshold.value = cp.threshold; this.comp.ratio.value = cp.ratio; this.comp.knee.value = cp.knee; this.comp.attack.value = cp.attack / 1000; this.comp.release.value = cp.release / 1000; this.makeup.gain.setTargetAtTime(Math.pow(10, cp.makeup / 20), now, 0.02); }
    var rv = plan.reverb; if (rv && this.revType !== rv.type + rv.feedback) { this.conv.buffer = impulse(c, rv.type, (rv.feedback - 0.8) * 400); this.revType = rv.type + rv.feedback; }
    this.revSend.gain.setTargetAtTime(rv ? rv.send * 0.7 : 0, now, 0.03);
    var dl = plan.delay; this.dlySend.gain.setTargetAtTime(dl ? dl.send : 0, now, 0.03);
    if (dl) { this.dlyL.delayTime.setTargetAtTime(dl.seconds, now, 0.05); this.dlyR.delayTime.setTargetAtTime(dl.seconds, now, 0.05); this.dlyFb.gain.setTargetAtTime(dl.feedback, now, 0.03); this.dlyTone.frequency.setTargetAtTime(dl.tone, now, 0.03); this.dlyCross.gain.setTargetAtTime(dl.pingpong ? 0.8 : 0, now, 0.03); this.dlyStraight.gain.setTargetAtTime(dl.pingpong ? 0 : 1, now, 0.03); }
    else this.dlyFb.gain.setTargetAtTime(0, now, 0.03);
    this.trim.gain.setTargetAtTime(plan.out || 1, now, 0.02);
  };
  Chain.prototype.dispose = function () { try { this.input.disconnect(); } catch (_) { } try { this.output.disconnect(); } catch (_) { } };

  // one whole graph (the real-time one, or an offline one for an export)
  function Graph(c, gateOk, offline) {
    this.c = c; this.gateOk = gateOk; this.offline = offline;
    this.master = c.createGain(); this.master.gain.value = 1;
    this.limiter = c.createDynamicsCompressor(); this.limiter.threshold.value = -1; this.limiter.knee.value = 0; this.limiter.ratio.value = 20; this.limiter.attack.value = 0.001; this.limiter.release.value = 0.12;
    this.masterMeter = c.createAnalyser(); this.masterMeter.fftSize = 512;
    this.master.connect(this.limiter).connect(c.destination); this.limiter.connect(this.masterMeter);
    this.strips = {}; this.insts = {}; this.instSig = {};
  }
  Graph.prototype.sync = function (p) {
    var self = this, anySolo = p.tracks.some(function (t) { return t.solo; }), ids = {};
    p.tracks.forEach(function (t) {
      ids[t.id] = 1;
      var s = self.strips[t.id] || (self.strips[t.id] = new Strip(self.c, self.master, self.gateOk)), now = self.c.currentTime;
      s.pan.pan.setTargetAtTime(clamp(t.pan, -1, 1), now, 0.01); s.fader.gain.setTargetAtTime(clamp(t.volume, 0, 2), now, 0.01);
      s.mute.gain.setTargetAtTime(t.mute || (anySolo && !t.solo) ? 0 : 1, now, 0.005);
      s.setFx(t.fx, p.bpm);
      if (t.kind !== "audio") { var sig = JSON.stringify(t.layers); if (self.instSig[t.id] !== sig) { if (self.insts[t.id]) self.insts[t.id].allOff(); self.insts[t.id] = SND.instrument(self.c, t.layers); self.instSig[t.id] = sig; } }
    });
    Object.keys(this.strips).forEach(function (id) { if (!ids[id]) { try { self.strips[id].mute.disconnect(); } catch (_) { } delete self.strips[id]; if (self.insts[id]) { self.insts[id].allOff(); delete self.insts[id]; } } });
    return Promise.all(Object.keys(this.insts).map(function (id) { return self.insts[id].ready; }));
  };
  function ensureCtx() {
    if (ctx) return ctx;
    var C = window.AudioContext || window.webkitAudioContext; if (!C) return null;
    try { ctx = new C({ latencyHint: "interactive", sampleRate: 48000 }); } catch (_) { ctx = new C({ latencyHint: "interactive" }); }
    rt = new Graph(ctx, false, false);
    addWorklets(ctx).then(function (ok) { if (ok) { rt.gateOk = true; Object.keys(rt.strips).forEach(function (id) { rt.strips[id].gateOk = true; rt.strips[id].sig = "x"; }); syncGraph(); } });
    rt.click = ctx.createGain(); rt.click.gain.value = 0.6; rt.click.connect(ctx.destination);
    syncGraph();
    return ctx;
  }
  function syncGraph() { if (rt) rt.sync(proj).catch(function () { }); }
  function latency() { if (!ctx) return null; return { base: ctx.baseLatency || 0, output: ctx.outputLatency || 0, total: (ctx.baseLatency || 0) + (ctx.outputLatency || 0) }; }

  // ------------------------------------------------------------- transport + scheduler
  var T = { playing: false, recording: false, t0: 0, b0: 0, cursor: 0, pos: 0, pass: 0, timer: 0, countIn: 0, recStart: 0 };
  var session = {};      // trackId -> { clip, slot, start (transport beat of the clip's beat 0), stopAt } - grid clips playing
  var queued = {};       // trackId -> { slot, clip (or null = stop), at } - launches waiting for the next bar / beat
  var scheduled = [];    // [{ inst, voice, off (ctx time), track }] notes in the air - for Stop
  var audioSrcs = [];    // audio clip sources playing
  function spb() { return 60 / proj.bpm; }
  function beatAt(time) { return T.b0 + (time - T.t0) / spb(); }
  function timeAt(beat) { return T.t0 + (beat - T.b0) * spb(); }
  function position() { if (!T.playing || !ctx) return T.pos; return beatAt(ctx.currentTime - (T.lat || 0)); }
  function nextBoundary(beat, q) { if (!q) return beat; return Math.ceil((beat - 1e-6) / q) * q; }

  function play(opts) {
    opts = opts || {}; var c = ensureCtx(); if (!c) return false;
    if (c.state === "suspended") c.resume();
    if (T.playing) return true;
    var start = opts.from != null ? opts.from : T.pos, ci = opts.countIn != null ? opts.countIn : (T.recording || opts.record ? proj.metronome.countIn || 0 : 0);
    T.countIn = ci * beatsPerBar(); T.countEnd = start;
    T.t0 = c.currentTime + 0.06; T.b0 = start - T.countIn; T.cursor = T.b0; T.playing = true; T.pass++; T.started = {}; T.lat = latency() ? latency().total : 0;
    clearInterval(T.timer); T.timer = setInterval(tick, 25); tick();
    fire("transport", state());
    return true;
  }
  function stop(opts) {
    if (!T.playing) { T.pos = opts && opts.home ? 0 : T.pos; if (opts && opts.home) fire("transport", state()); return; }
    var now = ctx ? ctx.currentTime : 0;
    T.pos = Math.max(0, position()); if (T.recording) finishRecording(); T.playing = false; clearInterval(T.timer);
    scheduled.forEach(function (s) { if (s.at > now + 0.005) { s.voice.parts.forEach(function (p) { p.kill(now); }); } else s.inst.noteOff(s.voice, now); }); scheduled = [];
    audioSrcs.forEach(function (a) { try { a.g.gain.setTargetAtTime(0, now, 0.01); a.src.stop(now + 0.05); } catch (_) { } }); audioSrcs = [];
    session = {}; queued = {}; fire("clip", gridState());
    if (opts && opts.home) T.pos = 0;
    fire("transport", state());
  }
  function setPos(beat) { var was = T.playing; if (was) stop(); T.pos = Math.max(0, beat); if (was) play(); else fire("transport", state()); }
  function state() { return { playing: T.playing, recording: T.recording, pos: position(), bpm: proj.bpm, countingIn: T.playing && T.countIn > 0 && position() < T.countEnd }; }

  function tick() {
    if (!T.playing || !ctx) return;
    var ahead = ctx.currentTime + 0.12, to = beatAt(ahead), from = T.cursor, L = proj.loop;
    if (L.on && L.end > L.start && !T.recordingAudio) {
      while (to > L.end && from < L.end) { scheduleRange(from, L.end); var tEnd = timeAt(L.end); T.t0 = tEnd; T.b0 = L.start; from = L.start; to = beatAt(ahead); T.pass++; T.started = {}; T.countIn = 0; Object.keys(session).forEach(function (id) { var s = session[id]; s.start = s.start - (L.end - L.start); }); }
    }
    if (to > from) scheduleRange(from, to);
    T.cursor = to;
    // record length (fixed bars): stop recording at its end
    if (T.recording && proj.recordLen > 0 && T.recFrom != null && to >= T.recFrom + proj.recordLen * beatsPerBar()) finishRecording();
    scheduled = scheduled.filter(function (s) { return s.off > ctx.currentTime - 0.5; });
  }
  function scheduleRange(a, b) {
    var bpb = beatsPerBar();
    // the click (and the count-in)
    if (proj.metronome.on || (T.countIn > 0 && a < T.countEnd)) {
      for (var beat = Math.ceil(a - 1e-9); beat < b; beat++) {
        var inCount = T.countIn > 0 && beat < T.countEnd;
        if (!proj.metronome.on && !inCount) continue;
        click(timeAt(beat), ((beat % bpb) + bpb) % bpb === 0, inCount);
      }
    }
    // grid launches due in this range
    Object.keys(queued).forEach(function (id) {
      var q = queued[id]; if (q.at >= b) return;
      if (q.clip) session[id] = { clip: q.clip, slot: q.slot, start: q.at, pass: T.pass }; else { stopTrackNotes(id, timeAt(Math.max(a, q.at))); delete session[id]; }
      delete queued[id]; fire("clip", gridState());
    });
    var anySolo = proj.tracks.some(function (t) { return t.solo; });
    proj.tracks.forEach(function (t) {
      var inst = rt.insts[t.id], strip = rt.strips[t.id]; if (!strip) return;
      var s = session[t.id];
      if (s) {   // a grid clip, looping from s.start
        var c = clip(s.clip); if (!c || !(c.len > 0)) return;
        var k0 = Math.floor((a - s.start) / c.len), k1 = Math.floor((b - s.start) / c.len);
        for (var k = Math.max(0, k0); k <= k1; k++) {
          var base = s.start + k * c.len;
          if (c.kind === "audio") { if (base >= a && base < b) playAudio(t, c, timeAt(base), 0, c.len, strip); }
          else if (inst) (c.notes || []).forEach(function (n) { var at = base + n.s; if (at >= a && at < b && n.s < c.len) note(t, inst, strip, n, at); });
        }
        return;
      }
      // the timeline
      proj.arrangement.forEach(function (it) {
        if (it.track !== t.id) return; var c = clip(it.clip); if (!c) return;
        var end = it.start + it.len, ofs = it.offset || 0;
        if (c.kind === "audio") {
          var key = it.id + ":" + T.pass;
          if (!T.started[key] && it.start < b && end > a) { T.started[key] = 1; var st = Math.max(it.start, a); playAudio(t, c, timeAt(st), st - it.start + ofs, end - st, strip); }
          return;
        }
        if (!inst || it.start >= b || end <= a) return;
        var loopLen = c.len > 0 ? c.len : it.len;
        (c.notes || []).forEach(function (n) {
          if (n.s >= loopLen) return;
          for (var at = it.start - ofs + n.s; at < Math.min(b, end); at += loopLen) { if (at >= a && at >= it.start) note(t, inst, strip, n, at, end); if (!it.loop && !c.loopOnTimeline) break; }
        });
      });
    });
  }
  function note(t, inst, strip, n, beat, end) {
    var at = timeAt(beat), dur = Math.max(0.02, Math.min(n.d, end != null ? end - beat : n.d)) * spb();
    var v = inst.noteOn(strip.input, n.p, clamp(n.v || 100, 1, 127), at); if (!v || !v.parts.length) return;
    inst.noteOff(v, at + dur); scheduled.push({ inst: inst, voice: v, at: at, off: at + dur, track: t.id });
  }
  function stopTrackNotes(id, at) { scheduled.forEach(function (s) { if (s.track !== id) return; if (s.at > at) s.voice.parts.forEach(function (p) { p.kill(at); }); else s.inst.noteOff(s.voice, at); }); audioSrcs.forEach(function (a) { if (a.track === id) try { a.src.stop(at + 0.02); } catch (_) { } }); }
  function playAudio(t, c, when, ofsBeats, lenBeats, strip) {
    var buf = c.audio && buffers[c.audio.id]; if (!buf) return;
    var src = ctx.createBufferSource(), g = ctx.createGain(); src.buffer = buf; src.connect(g).connect(strip.input);
    var ofs = Math.max(0, ofsBeats * spb() + (c.audio.offset || 0)), dur = Math.max(0, lenBeats * spb());
    if (ofs >= buf.duration) return;
    var w = Math.max(when, ctx.currentTime); src.start(w, ofs + Math.max(0, w - when), Math.min(dur, buf.duration - ofs));
    audioSrcs.push({ src: src, g: g, track: t.id }); src.onended = function () { audioSrcs = audioSrcs.filter(function (x) { return x.src !== src; }); };
  }
  function click(at, down, count) {
    if (!rt.click || at < ctx.currentTime - 0.01) return;
    var o = ctx.createOscillator(), g = ctx.createGain(); o.type = "square"; o.frequency.value = down ? 1760 : 1175;
    var lv = clamp(proj.metronome.level, 0, 1) * (count ? 1 : 0.8) * 0.35;
    g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(lv, at + 0.001); g.gain.exponentialRampToValueAtTime(0.0005, at + 0.05);
    o.connect(g).connect(rt.click); o.start(at); o.stop(at + 0.06);
  }

  // ------------------------------------------------------------- the grid
  function slotClip(t, slot) { return t.slots[slot] || null; }
  function launch(trackId, slot) {
    var t = track(trackId); if (!t) return;
    var cid = slotClip(t, slot);
    if (!T.playing) {   // nothing playing: start from bar 1 with this clip
      queued = {}; if (cid) session[t.id] = { clip: cid, slot: slot, start: 0, pass: T.pass + 1 }; play({ from: 0 }); fire("clip", gridState()); return;
    }
    var at = nextBoundary(position(), proj.launchQ);
    if (session[t.id] && session[t.id].slot === slot && !queued[t.id]) { fire("clip", gridState()); return; }
    queued[t.id] = { slot: slot, clip: cid, at: at };
    fire("clip", gridState());
  }
  function stopTrack(trackId) { if (!T.playing) { delete session[trackId]; fire("clip", gridState()); return; } queued[trackId] = { slot: null, clip: null, at: nextBoundary(position(), proj.launchQ) }; fire("clip", gridState()); }
  function launchScene(i) {
    proj.tracks.forEach(function (t) { if (t.slots[i]) launch(t.id, i); else if (session[t.id] || queued[t.id]) stopTrack(t.id); });
    if (!T.playing) play({ from: 0 });
  }
  function stopAll() { Object.keys(session).forEach(stopTrack); }
  function backToTimeline(id) { if (id) stopTrack(id); else stopAll(); }
  function gridState() {   // { trackId: { playing: slot, queued: slot|null|"stop" } }
    var out = {}; proj.tracks.forEach(function (t) { out[t.id] = { playing: session[t.id] ? session[t.id].slot : null, queued: queued[t.id] ? (queued[t.id].clip ? queued[t.id].slot : "stop") : null, recording: T.recording && T.recSlot && T.recSlot.track === t.id ? T.recSlot.slot : null }; }); return out;
  }
  function clipProgress(id) { var s = session[id]; if (!s || !T.playing) return null; var c = clip(s.clip); if (!c || !c.len) return null; var p = position() - s.start; return p < 0 ? 0 : (p % c.len) / c.len; }

  // ------------------------------------------------------------- live playing + recording
  var held = {};        // trackId:note -> voice (what's sounding from a keyboard)
  var sustain = {}, sustained = {};
  var takes = {};       // trackId -> [{p, s, d?, v, on (beat)}] notes being recorded
  var monitor = { ok: false, tracks: {}, latencyMs: null, error: null };
  function ctxTimeFor(perfMs) {
    if (!ctx) return 0; if (perfMs == null) return ctx.currentTime;
    var ts = ctx.getOutputTimestamp ? ctx.getOutputTimestamp() : null;
    if (ts && ts.performanceTime) return ts.contextTime + (perfMs - ts.performanceTime) / 1000 + (latency() ? latency().total : 0);
    return ctx.currentTime;
  }
  function live(trackId, data, perfMs) {
    var t = track(trackId); if (!t || t.kind === "audio") return;
    ensureCtx(); if (ctx.state === "suspended") ctx.resume();
    var st = data[0] & 0xF0, n = data[1], v = data[2] || 0, onNative = monitor.ok && proj.lowLatency && monitor.tracks[t.id] && t.monitor !== "page";
    if (onNative && NAT && NAT.monitor) NAT.monitor.send({ action: "midi", track: t.id, data: [data[0], n, v] });
    var inst = rt.insts[t.id], strip = rt.strips[t.id];
    if (st === 0x90 && v > 0) {
      if (!onNative && inst && strip) { var k = t.id + ":" + n; if (held[k]) inst.noteOff(held[k], 0); held[k] = inst.noteOn(strip.input, n, v, 0); }
      capture(t, n, v, perfMs);
    } else if (st === 0x80 || st === 0x90) {
      var key = t.id + ":" + n;
      if (sustain[t.id]) { (sustained[t.id] = sustained[t.id] || []).push(key); }
      else if (held[key] && inst) { inst.noteOff(held[key], 0); delete held[key]; }
      release(t, n, perfMs);
    } else if (st === 0xB0 && n === 64) {
      sustain[t.id] = v >= 64;
      if (!sustain[t.id]) { (sustained[t.id] || []).forEach(function (k2) { if (held[k2] && inst) { inst.noteOff(held[k2], 0); delete held[k2]; } }); sustained[t.id] = []; }
    }
    fire("live", { track: t.id, note: n, on: st === 0x90 && v > 0 });
  }
  function recBeat(perfMs) { var tm = ctxTimeFor(perfMs) - (latency() ? latency().total : 0); return beatAt(tm); }
  function capture(t, n, v, perfMs) {
    if (!T.recording || !t.arm || !T.playing) return;
    var b = recBeat(perfMs); if (b < T.recFrom - 0.25) return;
    (takes[t.id] = takes[t.id] || []).push({ p: n, v: v, on: Math.max(T.recFrom, b) });
  }
  function release(t, n, perfMs) {
    var tk = takes[t.id]; if (!tk) return; var b = recBeat(perfMs);
    for (var i = tk.length - 1; i >= 0; i--) if (tk[i].p === n && tk[i].off == null) { tk[i].off = Math.max(tk[i].on + 0.05, b); break; }
  }
  // record: on the grid (a slot of an armed track) or on the timeline
  function record(opts) {
    opts = opts || {};
    if (T.recording) { finishRecording(); fire("transport", state()); return; }
    var armed = proj.tracks.filter(function (t) { return t.arm; });
    if (!armed.length) { fire("message", "Arm a track first (the ● on its name), then record."); return; }
    T.recording = true; takes = {}; T.recSlot = opts.slot != null ? { track: opts.track || armed[0].id, slot: opts.slot } : null; T.recView = opts.view || "timeline";
    if (!T.playing) { T.recFrom = opts.from != null ? opts.from : (T.recSlot ? 0 : T.pos); play({ from: T.recFrom, record: true }); }
    else T.recFrom = T.recSlot ? nextBoundary(position(), beatsPerBar()) : position();
    if (T.recSlot && T.playing) { var tr = track(T.recSlot.track); if (tr && session[tr.id]) stopTrack(tr.id); }
    startAudioRecording(armed.filter(function (t) { return t.kind === "audio"; }));
    fire("record", { on: true }); fire("transport", state()); fire("clip", gridState());
  }
  function finishRecording() {
    if (!T.recording) return;
    var endBeat = position(), bpb = beatsPerBar(), from = T.recFrom || 0;
    T.recording = false;
    var midi = Object.keys(takes).filter(function (id) { return takes[id].length; });
    var audioDone = stopAudioRecording();
    if (midi.length || audioDone.length) edit("Record", function (p) {
      midi.forEach(function (id) {
        var t = track(id); if (!t) return;
        var notes = takes[id].map(function (n) { return { p: n.p, v: n.v, s: n.on - from, d: Math.max(0.05, (n.off != null ? n.off : endBeat) - n.on) }; }).filter(function (n) { return n.s >= -0.25; });
        notes.forEach(function (n) { n.s = Math.max(0, n.s); });
        var len = Math.max(bpb, Math.ceil((endBeat - from - 0.01) / bpb) * bpb);
        if (T.recSlot && T.recSlot.track === id) {
          var existing = t.slots[T.recSlot.slot] && p.clips[t.slots[T.recSlot.slot]];
          if (existing && p.overdub) { notes.forEach(function (n) { n.s = n.s % existing.len; existing.notes.push(n); }); }
          else { var c = newClip("midi", len); c.notes = notes; c.name = t.name + " " + (Object.keys(t.slots).length + 1); p.clips[c.id] = c; t.slots[T.recSlot.slot] = c.id; }
        } else {
          var over = p.overdub && p.arrangement.filter(function (it) { return it.track === id && it.start <= from + 0.01 && it.start + it.len >= endBeat - 0.01 && p.clips[it.clip] && p.clips[it.clip].kind === "midi"; })[0];
          if (over) { var oc = p.clips[over.clip]; notes.forEach(function (n) { n.s += from - over.start; oc.notes.push(n); }); }
          else { var start = Math.floor(from / bpb) * bpb, shift = from - start, c2 = newClip("midi", len + (shift > 0 ? bpb : 0)); notes.forEach(function (n) { n.s += shift; }); c2.notes = notes; c2.name = t.name; p.clips[c2.id] = c2; p.arrangement.push({ id: uid("a"), track: id, clip: c2.id, start: start, len: c2.len, offset: 0 }); }
        }
      });
      audioDone.forEach(function (r) {
        var c = newClip("audio", r.lenBeats); c.audio = { id: r.audioId, offset: 0 }; c.name = r.name; p.clips[c.id] = c; p.audioFiles.push(r.audioId + ".wav");
        if (T.recSlot && T.recSlot.track === r.track) { var tt = track(r.track); if (tt) tt.slots[T.recSlot.slot] = c.id; }
        else p.arrangement.push({ id: uid("a"), track: r.track, clip: c.id, start: r.startBeat, len: r.lenBeats, offset: 0 });
      });
    });
    takes = {}; T.recSlot = null; fire("record", { on: false }); fire("clip", gridState());
  }

  // audio tracks: the input through an AudioWorklet that hands the samples back
  var mics = {}, recNodes = [];
  function startAudioRecording(tracks) {
    if (!tracks.length || !ctx || !navigator.mediaDevices) return;
    T.recordingAudio = true;
    tracks.forEach(function (t) {
      var r = { track: t.id, chunks: [], t0: null, node: null, src: null };
      recNodes.push(r);
      addWorklets(ctx).then(function (ok) {
        if (!ok) return;
        return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, deviceId: t.inputDevice ? { exact: t.inputDevice } : undefined } }).then(function (stream) {
          if (!T.recording) { stream.getTracks().forEach(function (x) { x.stop(); }); return; }
          r.stream = stream; r.src = ctx.createMediaStreamSource(stream); r.node = new AudioWorkletNode(ctx, "cu-rec", { numberOfOutputs: 1 }); r.silent = ctx.createGain(); r.silent.gain.value = 0; r.node.connect(r.silent).connect(ctx.destination);   // (pulled by the output, so it runs)
          var inLat = (stream.getAudioTracks()[0].getSettings() || {}).latency || 0.01; r.inLat = inLat;
          r.node.port.onmessage = function (e) { if (r.t0 == null) r.t0 = e.data.t; r.chunks.push(e.data.ch); };
          r.src.connect(r.node); r.node.port.postMessage({ on: true });
        });
      }).catch(function (e) { fire("message", "The input couldn't be opened: " + (e && e.message || e)); });
    });
  }
  function stopAudioRecording() {
    T.recordingAudio = false; var out = [];
    recNodes.forEach(function (r) {
      try { r.node && r.node.port.postMessage({ on: false }); r.src && r.src.disconnect(); r.silent && r.silent.disconnect(); r.stream && r.stream.getTracks().forEach(function (x) { x.stop(); }); } catch (_) { }
      if (!r.chunks.length || r.t0 == null) return;
      var chs = r.chunks[0].length, n = r.chunks.reduce(function (a, c) { return a + c[0].length; }, 0), buf = ctx.createBuffer(Math.min(2, chs), n, ctx.sampleRate);
      for (var ch = 0; ch < buf.numberOfChannels; ch++) { var d = buf.getChannelData(ch), o = 0; r.chunks.forEach(function (c) { d.set(c[ch] || c[0], o); o += c[0].length; }); }
      // the moment the first sample was played into the microphone: when it arrived, less the way in and the way out
      var heard = r.t0 - (r.inLat || 0) - (latency() ? latency().total : 0), startBeat = beatAt(heard), trimBeats = Math.max(0, (T.recFrom || 0) - startBeat), trimS = trimBeats * spb();
      var keep = Math.max(1, Math.round((buf.duration - trimS) * buf.sampleRate)), cut = ctx.createBuffer(buf.numberOfChannels, keep, buf.sampleRate);
      for (var c2 = 0; c2 < buf.numberOfChannels; c2++) cut.getChannelData(c2).set(buf.getChannelData(c2).subarray(Math.round(trimS * buf.sampleRate)));
      var id = uid("au"); buffers[id] = cut;
      var t = track(r.track);
      out.push({ track: r.track, audioId: id, startBeat: Math.max(0, startBeat + trimBeats), lenBeats: Math.max(0.25, cut.duration / spb()), name: (t ? t.name : "Audio") + " take" });
    });
    recNodes = [];
    return out;
  }
  // audio from a file (drag and drop) onto a track: becomes a clip on the timeline at a beat
  function importAudio(trackId, arrayBuffer, name, atBeat) {
    var c = ensureCtx();
    return c.decodeAudioData(arrayBuffer.slice(0)).then(function (buf) {
      var id = uid("au"); buffers[id] = buf;
      return edit("Add audio", function (p) { var cl = newClip("audio", buf.duration / spb()); cl.audio = { id: id, offset: 0 }; cl.name = name || "Audio"; p.clips[cl.id] = cl; p.audioFiles.push(id + ".wav"); p.arrangement.push({ id: uid("a"), track: trackId, clip: cl.id, start: atBeat || 0, len: cl.len, offset: 0 }); return cl; });
    });
  }

  // ------------------------------------------------------------- cu-studio (the low-delay player)
  function monitorTracks() {
    var out = []; monitor.tracks = {};
    proj.tracks.forEach(function (t) {
      if (t.kind === "audio") return; var ls = SND.nativeLayers(t.layers); if (!ls) return;
      var anySolo = proj.tracks.some(function (x) { return x.solo; });
      out.push({ id: t.id, volume: clamp(t.volume, 0, 2) * 1.0, pan: t.pan, mute: t.mute || (anySolo && !t.solo), layers: ls }); monitor.tracks[t.id] = 1;
    });
    return out;
  }
  var monSig = "";
  function syncMonitor() {
    if (!NAT || !NAT.monitor || !monitor.started) return;
    var tr = monitorTracks(), sig = JSON.stringify(tr); if (sig === monSig) return; monSig = sig;
    NAT.monitor.send({ action: "tracks", tracks: tr });
  }
  function startMonitor() {
    if (!NAT || !NAT.monitor || monitor.started) return Promise.resolve(monitor);
    monitor.started = true;
    NAT.monitor.on(function (m) { if (m && m.type === "studioMonitor") { monitor.ok = !!m.ok; monitor.latencyMs = m.latencyMs; monitor.error = m.error || null; monitor.device = m.device; if (m.stopped) { monitor.started = false; monSig = ""; } fire("monitor", monitor); } });
    return NAT.monitor.start().then(function (r) { if (!r || !r.ok) { monitor.started = false; monitor.error = r && r.error; fire("monitor", monitor); return monitor; } monSig = ""; syncMonitor(); return monitor; });
  }

  // ------------------------------------------------------------- export (offline, faster than real time)
  function arrangementEnd() { var e = 0; proj.arrangement.forEach(function (it) { e = Math.max(e, it.start + it.len); }); return e; }
  function bounce(o) {
    o = o || {}; var from = o.from || 0, to = o.to || arrangementEnd(); if (!(to > from)) return Promise.reject(new Error("The timeline is empty: put clips on it first."));
    var rate = 48000, tail = 3, secs = (to - from) * spb() + tail, oc = new OfflineAudioContext(2, Math.ceil(secs * rate), rate);
    var p = clone(proj); if (o.tracks) p.tracks.forEach(function (t) { t.solo = o.tracks.indexOf(t.id) >= 0; t.mute = o.tracks.indexOf(t.id) < 0 ? true : t.mute && !o.ignoreMute; });
    return addWorklets(oc).then(function (gateOk) {
      var g = new Graph(oc, gateOk, true);
      return g.sync(p).then(function () {
        var t0 = 0.05, sp = spb(), at = function (b) { return t0 + (b - from) * sp; };
        p.arrangement.forEach(function (it) {
          var t = p.tracks.filter(function (x) { return x.id === it.track; })[0], c = p.clips[it.clip], strip = g.strips[it.track]; if (!t || !c || !strip) return;
          var end = Math.min(it.start + it.len, to);
          if (c.kind === "audio") { var buf = c.audio && buffers[c.audio.id]; if (!buf || end <= from) return; var st = Math.max(it.start, from), src = oc.createBufferSource(); src.buffer = buf; src.connect(strip.input); var ofs = (st - it.start + (it.offset || 0)) * sp + (c.audio.offset || 0); if (ofs < buf.duration) src.start(at(st), ofs, Math.min((end - st) * sp, buf.duration - ofs)); return; }
          var inst = g.insts[it.track], loopLen = c.len > 0 ? c.len : it.len; if (!inst) return;
          (c.notes || []).forEach(function (n) {
            if (n.s >= loopLen) return;
            for (var b = it.start - (it.offset || 0) + n.s; b < end; b += loopLen) {
              if (b >= Math.max(it.start, from)) { var v = inst.noteOn(strip.input, n.p, clamp(n.v || 100, 1, 127), at(b)); inst.noteOff(v, at(b) + Math.max(0.02, Math.min(n.d, end - b)) * sp); }
              if (!it.loop && !c.loopOnTimeline) break;
            }
          });
        });
        return oc.startRendering();
      });
    });
  }
  function wav(buf, bits) {
    bits = bits === 16 ? 16 : 24; var ch = Math.min(2, buf.numberOfChannels), n = buf.length, bps = bits / 8, data = n * ch * bps, ab = new ArrayBuffer(44 + data), v = new DataView(ab);
    function w(o, s) { for (var i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); }
    w(0, "RIFF"); v.setUint32(4, 36 + data, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, buf.sampleRate, true); v.setUint32(28, buf.sampleRate * ch * bps, true); v.setUint16(32, ch * bps, true); v.setUint16(34, bits, true); w(36, "data"); v.setUint32(40, data, true);
    var chans = []; for (var c = 0; c < ch; c++) chans.push(buf.getChannelData(c));
    var o = 44, max = bits === 16 ? 32767 : 8388607;
    for (var i = 0; i < n; i++) for (c = 0; c < ch; c++) { var s = Math.max(-1, Math.min(1, chans[c][i])), q = Math.round(s * max); if (bits === 16) { v.setInt16(o, q, true); o += 2; } else { v.setUint8(o, q & 255); v.setUint8(o + 1, (q >> 8) & 255); v.setUint8(o + 2, (q >> 16) & 255); o += 3; } }
    return ab;
  }
  function exportMix(o) {
    o = o || {};
    return bounce(o).then(function (buf) {
      var file = { name: (proj.name || "Song") + (o.tracks && o.tracks.length === 1 ? " - " + (track(o.tracks[0]) || {}).name : "") + ".wav", data: wav(buf, o.bits) };
      return deliver(proj.name, [file]);
    });
  }
  function exportStems(o) {
    o = o || {}; var list = proj.tracks.filter(function (t) { return proj.arrangement.some(function (it) { return it.track === t.id; }); }), files = [];
    return list.reduce(function (pr, t) { return pr.then(function () { return bounce({ tracks: [t.id], ignoreMute: true }).then(function (b) { files.push({ name: String(files.length + 1).padStart(2, "0") + " " + t.name + ".wav", data: wav(b, o.bits) }); }); }); }, Promise.resolve())
      .then(function () { if (!files.length) throw new Error("The timeline is empty: put clips on it first."); return deliver(proj.name + " stems", files); });
  }
  function deliver(name, files) {
    if (NAT && NAT.exportFiles) return NAT.exportFiles(name, files);
    files.forEach(function (f) { var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([f.data], { type: "audio/wav" })); a.download = f.name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 2000); });
    return Promise.resolve("downloads");
  }
  // the grid's scenes laid out on the timeline, one after another (each as long as its longest clip)
  function scenesToTimeline() {
    return edit("Scenes to timeline", function (p) {
      var at = arrangementEnd(), bpb = beatsPerBar();
      p.scenes.forEach(function (sc, i) {
        var len = 0; p.tracks.forEach(function (t) { var c = t.slots[i] && p.clips[t.slots[i]]; if (c) len = Math.max(len, c.len); }); if (!len) return;
        len = Math.ceil(len / bpb) * bpb;
        p.tracks.forEach(function (t) { var cid = t.slots[i]; if (!cid || !p.clips[cid]) return; var src = p.clips[cid], c = clone(src); c.id = uid("c"); p.clips[c.id] = c; p.arrangement.push({ id: uid("a"), track: t.id, clip: c.id, start: at, len: len, offset: 0, loop: true }); });
        at += len;
      });
    });
  }

  // ------------------------------------------------------------- saving
  var DB = null;
  function idb() { if (DB) return DB; DB = new Promise(function (res, rej) { var r = indexedDB.open("cu-studio", 1); r.onupgradeneeded = function () { r.result.createObjectStore("projects"); r.result.createObjectStore("audio"); }; r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); return DB; }
  function idbDo(store, mode, fn) { return idb().then(function (db) { return new Promise(function (res, rej) { var tx = db.transaction(store, mode), st = tx.objectStore(store), r = fn(st); tx.oncomplete = function () { res(r && r.result); }; tx.onerror = function () { rej(tx.error); }; }); }); }
  function save() {
    proj.savedAt = Date.now(); var used = {}; Object.keys(proj.clips).forEach(function (id) { var c = proj.clips[id]; if (c.audio) used[c.audio.id] = 1; });
    proj.audioFiles = Object.keys(used).map(function (id) { return id + ".wav"; });
    var json = JSON.stringify(proj), audio = {};
    Object.keys(used).forEach(function (id) { if (buffers[id] && !savedAudio[id]) audio[id + ".wav"] = wav(buffers[id], 24); });
    var done = NAT && NAT.save ? NAT.save(proj.id, json, audio) : Promise.all([idbDo("projects", "readwrite", function (st) { return st.put(json, proj.id); })].concat(Object.keys(audio).map(function (n) { return idbDo("audio", "readwrite", function (st) { return st.put(audio[n], proj.id + "/" + n); }); })));
    return done.then(function () { Object.keys(audio).forEach(function (n) { savedAudio[n.replace(/\.wav$/, "")] = 1; }); dirty = false; savedOnce = true; fire("saved", proj); return proj.id; });
  }
  var savedAudio = {}, autosaveT = 0;
  function autosaveSoon() { if (!savedOnce) return; clearTimeout(autosaveT); autosaveT = setTimeout(function () { if (dirty && !T.recording) save().catch(function () { }); }, 4000); }
  function list() {
    if (NAT && NAT.list) return NAT.list();
    return idbDo("projects", "readonly", function (st) { return st.getAll(); }).then(function (all) { return (all || []).map(function (j) { try { var p = JSON.parse(j); return { id: p.id, name: p.name, savedAt: p.savedAt, bpm: p.bpm, key: p.key }; } catch (_) { return null; } }).filter(Boolean).sort(function (a, b) { return (b.savedAt || 0) - (a.savedAt || 0); }); });
  }
  function load(p) {
    if (!p || !Array.isArray(p.tracks)) throw new Error("not a Studio project");
    stop({ home: true }); proj = p; proj.tracks.forEach(function (t) { t.fx = merge(defaultFx(), t.fx || {}); t.slots = t.slots || {}; }); undoStack = []; redoStack = []; dirty = false; savedAudio = {};
    (p.audioFiles || []).forEach(function (f) { savedAudio[f.replace(/\.wav$/, "")] = 1; });
    changed("load"); fire("transport", state()); fire("clip", gridState());
  }
  function open(id) {
    var get = NAT && NAT.load ? NAT.load(id) : idbDo("projects", "readonly", function (st) { return st.get(id); }).then(function (j) { return j ? JSON.parse(j) : null; });
    return get.then(function (p) {
      if (!p) throw new Error("That project wasn't found.");
      var c = ensureCtx();
      return Promise.all((p.audioFiles || []).map(function (f) {
        var aid = f.replace(/\.wav$/, ""); if (buffers[aid]) return null;
        var bytes = NAT && NAT.audio ? NAT.audio(p.id, f) : idbDo("audio", "readonly", function (st) { return st.get(p.id + "/" + f); });
        return bytes.then(function (b) { if (!b) return; var ab = b instanceof ArrayBuffer ? b : b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); return c.decodeAudioData(ab).then(function (buf) { buffers[aid] = buf; }); }).catch(function () { });
      })).then(function () { load(p); savedOnce = true; return p; });
    });
  }
  function remove(id) { return NAT && NAT.remove ? NAT.remove(id) : idbDo("projects", "readwrite", function (st) { return st.delete(id); }); }
  function fresh(o) { load(newProject(o)); savedOnce = false; dirty = false; }

  setInterval(function () { if (!rt || !document.getElementById("view-studio") || !document.getElementById("view-studio").classList.contains("active")) return; var m = {}, b = new Float32Array(512); Object.keys(rt.strips).forEach(function (id) { var a = rt.strips[id].meter; a.getFloatTimeDomainData(b); var pk = 0; for (var i = 0; i < b.length; i++) { var x = Math.abs(b[i]); if (x > pk) pk = x; } m[id] = pk; }); rt.masterMeter.getFloatTimeDomainData(b); var mp = 0; for (var j = 0; j < b.length; j++) mp = Math.max(mp, Math.abs(b[j])); m.master = mp; fire("meters", m); }, 60);

  window.CUStudio = {
    on: on, project: project, track: track, clip: clip, newProject: newProject, newTrack: newTrack, newClip: newClip, edit: edit, undo: undo, redo: redo,
    canUndo: function () { return undoStack.length ? undoStack[undoStack.length - 1].label : null; }, canRedo: function () { return redoStack.length ? redoStack[redoStack.length - 1].label : null; },
    play: play, stop: stop, setPos: setPos, position: position, state: state, record: record, launch: launch, launchScene: launchScene, stopTrack: stopTrack, stopAll: stopAll, backToTimeline: backToTimeline,
    gridState: gridState, clipProgress: clipProgress, live: live, quantizeNotes: quantizeNotes, Q: Q, KEYS: KEYS, COLORS: COLORS, beatsPerBar: beatsPerBar,
    PRESETS: PRESETS, applyPreset: applyPreset, defaultFx: defaultFx, pro: pro, bounce: bounce, wav: wav, exportMix: exportMix, exportStems: exportStems, scenesToTimeline: scenesToTimeline, arrangementEnd: arrangementEnd,
    importAudio: importAudio, buffers: buffers, save: save, open: open, list: list, remove: remove, fresh: fresh, load: load, isDirty: function () { return dirty; },
    ctx: ensureCtx, latency: latency, monitor: function () { return monitor; }, startMonitor: startMonitor, graph: function () { return rt; }, uid: uid
  };
})();
