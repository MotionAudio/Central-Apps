/* Central Control - the mixer model, shared by the audio host (main process), the admin and user screens and
 * the phone page. One reducer: every change is an "op"; the host applies it, passes it to the engine and
 * sends the same op to everyone, who apply it to their copy.
 *
 *  inputs[128]  name, source (Central Pedal channel by name / interface input / none), group (tracks | band),
 *               trim, polarity, high-pass, EQ, compressor, fader, pan, mute, direct output, shown to users
 *  main         the tracks mix: level, mute, outputs L / R          trackOut: "sum" (L/R) or "direct" (each track)
 *  mixes[64]    stereo in-ear mixes: name, owner, where it goes - wired (an output pair of the interface / Dante,
 *               to an in-ear transmitter in the rack) and / or local (back over the network to the owner's
 *               device or phone) - outputs, stereo, level, mute, sends { input index: { level dB, pan, on } }
 *  device       the audio host's devices: capture / playback ("A|B" joins several devices, e.g. two Dante
 *               Virtual Soundcards), buffer, backend */
(function (root, factory) { if (typeof module === "object" && module.exports) module.exports = factory(); else root.CUMixer = factory(); })(this, function () {
  "use strict";
  var MAXIN = 128, MAXMIX = 64, MAXOUT = 128;
  function clamp(v, a, b) { v = Number(v); if (!isFinite(v)) v = a; return v < a ? a : v > b ? b : v; }
  function defaultEq() { return { on: false, lf: 100, lg: 0, mf: 1000, mg: 0, mq: 1, hf: 8000, hg: 0 }; }
  function defaultComp() { return { on: false, thr: -18, ratio: 3, att: 10, rel: 120, makeup: 0 }; }
  function defaultInput(i) { return { name: "", src: { kind: "none" }, group: "band", color: "", trim: 0, phase: false, hpf: 0, eq: defaultEq(), comp: defaultComp(), fader: 0, mute: false, pan: 0, direct: -1, directPre: false, show: true }; }
  function defaultMix(m) { return { name: "Mix " + (m + 1), owner: null, ownerId: null, wired: false, local: true, outL: -1, outR: -1, stereo: true, level: 0, mute: false, reserved: false, sends: {} }; }
  function create() {
    var s = { version: 1, inputs: [], main: { level: 0, mute: false, outL: -1, outR: -1 }, trackOut: "sum", directFirst: 0, mixes: [], device: { capture: "", playback: "", buffer: 256, backend: "auto", exclusive: false } };
    for (var i = 0; i < MAXIN; i++) s.inputs.push(defaultInput(i));
    for (var m = 0; m < MAXMIX; m++) s.mixes.push(defaultMix(m));
    return s;
  }
  function normalize(s) {   // a saved state from an older version / a file: fill in what is missing
    var d = create(); if (!s || typeof s !== "object") return d;
    s.inputs = Array.isArray(s.inputs) ? s.inputs : []; s.mixes = Array.isArray(s.mixes) ? s.mixes : [];
    for (var i = 0; i < MAXIN; i++) { var x = s.inputs[i] = Object.assign(defaultInput(i), s.inputs[i] || {}); x.eq = Object.assign(defaultEq(), x.eq || {}); x.comp = Object.assign(defaultComp(), x.comp || {}); if (!x.src || !x.src.kind) x.src = { kind: "none" }; }
    s.inputs.length = MAXIN;
    for (var m = 0; m < MAXMIX; m++) {
      var old = s.mixes[m] || {}, q = s.mixes[m] = Object.assign(defaultMix(m), old);
      if (!q.sends || typeof q.sends !== "object") q.sends = {};
      // older versions: one "mode" per mix - cloud (out of the interface) or local (over Wi-Fi)
      if (old.mode && old.wired == null) { q.wired = old.mode === "cloud"; q.local = old.mode === "local"; }
      delete q.mode; q.wired = !!q.wired; q.local = q.local !== false;
    }
    s.mixes.length = MAXMIX;
    s.main = Object.assign(d.main, s.main || {}); s.device = Object.assign(d.device, s.device || {});
    if (s.trackOut !== "direct") s.trackOut = "sum";
    return s;
  }
  var INPUT_KEYS = { name: "s", group: "s", color: "s", trim: [-24, 24], phase: "b", hpf: [0, 400], fader: [-90, 10], mute: "b", pan: [-1, 1], direct: [-1, MAXOUT - 1], directPre: "b", show: "b" };
  var EQ_KEYS = { on: "b", lf: [20, 1000], lg: [-18, 18], mf: [100, 12000], mg: [-18, 18], mq: [0.2, 8], hf: [1000, 20000], hg: [-18, 18] };
  var COMP_KEYS = { on: "b", thr: [-60, 0], ratio: [1, 20], att: [0.1, 200], rel: [5, 2000], makeup: [0, 24] };
  var MIX_KEYS = { name: "s", wired: "b", local: "b", outL: [-1, MAXOUT - 1], outR: [-1, MAXOUT - 1], stereo: "b", level: [-90, 10], mute: "b", reserved: "b" };
  function put(target, keys, patch) {
    var changed = false;
    Object.keys(patch || {}).forEach(function (k) {
      var t = keys[k]; if (!t) return; var v = patch[k];
      if (t === "s") v = String(v == null ? "" : v).slice(0, 40); else if (t === "L") v = String(v == null ? "" : v).slice(0, 400); else if (t === "b") v = !!v; else v = clamp(v, t[0], t[1]);
      if (k === "group" && v !== "tracks" && v !== "band") return;
      if (target[k] !== v) { target[k] = v; changed = true; }
    });
    return changed;
  }
  /* apply one op. who: { role: "admin" | "user" | "host", id } - a user may only change the mix they own.
   * Returns false when the op is not allowed or changes nothing. */
  function apply(s, op, who) {
    who = who || { role: "host" };
    var admin = who.role === "admin" || who.role === "host";
    if (!op || typeof op !== "object") return false;
    if (op.op === "input") {
      if (!admin) return false; var x = s.inputs[op.i | 0]; if (!x || op.i < 0) return false;
      var p = op.patch || {}, ch = put(x, INPUT_KEYS, p);
      if (p.eq) ch = put(x.eq, EQ_KEYS, p.eq) || ch;
      if (p.comp) ch = put(x.comp, COMP_KEYS, p.comp) || ch;
      if (p.src && typeof p.src === "object") { var src = p.src.kind === "pi" ? { kind: "pi", key: String(p.src.key || "").toLowerCase().slice(0, 40) } : p.src.kind === "in" ? { kind: "in", ch: clamp(p.src.ch, 0, MAXIN - 1) | 0 } : { kind: "none" }; if (JSON.stringify(src) !== JSON.stringify(x.src)) { x.src = src; ch = true; } }
      return ch;
    }
    if (op.op === "main") { if (!admin) return false; return put(s.main, { level: [-90, 10], mute: "b", outL: [-1, MAXOUT - 1], outR: [-1, MAXOUT - 1] }, op.patch); }
    if (op.op === "trackOut") { if (!admin) return false; var v = op.value === "direct" ? "direct" : "sum", f = clamp(op.first == null ? s.directFirst : op.first, 0, MAXOUT - 1) | 0; if (s.trackOut === v && s.directFirst === f) return false; s.trackOut = v; s.directFirst = f; return true; }
    if (op.op === "autoWire") {   // the wired mixes get output pairs one after the other, from output "first"
      if (!admin) return false; var o = clamp(op.first == null ? 0 : op.first, 0, MAXOUT - 1) | 0, ch2 = false;
      if (op.count != null) { var cnt = clamp(op.count, 0, MAXMIX) | 0; s.mixes.forEach(function (q, k) { var w = k < cnt; if (q.wired !== w) { q.wired = w; ch2 = true; } }); }
      s.mixes.forEach(function (q) {
        if (!q.wired) return; var need = q.stereo ? 2 : 1, L = o + need - 1 < MAXOUT ? o : -1, R = q.stereo && L >= 0 ? o + 1 : -1;
        if (q.outL !== L || q.outR !== R) { q.outL = L; q.outR = R; ch2 = true; } if (L >= 0) o += need;
      });
      return ch2;
    }
    if (op.op === "device") { if (!admin) return false; var dp = Object.assign({}, op.patch || {}); ["capture", "playback"].forEach(function (k) { if (dp[k] != null) dp[k] = String(dp[k]).slice(0, 400); }); if (dp.backend != null && ["auto", "internal", "jack", "miniaudio", "null"].indexOf(dp.backend) < 0) return false; return put(s.device, { capture: "L", playback: "L", buffer: [32, 2048], backend: "s", exclusive: "b" }, dp); }
    var mix = s.mixes[op.m | 0]; if ((op.m | 0) !== op.m || !mix) return false;
    var owns = mix.ownerId && who.id && mix.ownerId === who.id;
    if (op.op === "mix") {
      var patch = op.patch || {};
      if (!admin) { if (!owns) return false; patch = { level: patch.level, mute: patch.mute, name: patch.name }; Object.keys(patch).forEach(function (k) { if (patch[k] === undefined) delete patch[k]; }); }   // where it goes is the sound desk's choice
      return put(mix, MIX_KEYS, patch);
    }
    if (op.op === "send") {
      if (!admin && !owns) return false;
      var i = op.i | 0; if (i < 0 || i >= MAXIN) return false;
      if (!admin && !visibleTo(s, i)) return false;
      var cur = mix.sends[i] || { level: -90, pan: 0, on: true }, nx = Object.assign({}, cur);
      put(nx, { level: [-90, 10], pan: [-1, 1], on: "b" }, op.patch);
      if (JSON.stringify(nx) === JSON.stringify(cur) && mix.sends[i]) return false;
      if (nx.level <= -90 && nx.pan === 0 && nx.on) delete mix.sends[i]; else mix.sends[i] = nx;
      return true;
    }
    if (op.op === "claim") {   // a user takes a free mix (or the admin gives one to someone)
      if (mix.ownerId && mix.ownerId !== who.id && !admin) return false;
      if (mix.reserved && !admin) return false;
      var id = admin && op.id ? String(op.id) : who.id; if (!id) return false;
      s.mixes.forEach(function (q) { if (q !== mix && q.ownerId === id) { q.owner = null; q.ownerId = null; } });   // one mix per person
      mix.ownerId = String(id).slice(0, 40); mix.owner = String(op.name || "").slice(0, 40) || "Someone";
      return true;
    }
    if (op.op === "release") { if (!admin && !owns) return false; if (!mix.ownerId) return false; mix.owner = null; mix.ownerId = null; return true; }
    if (op.op === "clearSends") { if (!admin && !owns) return false; mix.sends = {}; return true; }
    return false;
  }
  // which inputs a user sees: shown, with a source, and (Central Pedal channels) present right now
  function visibleTo(s, i, live) { var x = s.inputs[i]; if (!x || x.show === false || !x.src || x.src.kind === "none") return false; if (x.src.kind === "pi" && live && live[x.src.key] == null) return false; return true; }
  function activeInputs(s, live) { var out = []; s.inputs.forEach(function (x, i) { if (x.src && x.src.kind !== "none" && (x.src.kind !== "pi" || !live || live[x.src.key] != null)) out.push(i); }); return out; }
  // what a user's copy holds: the inputs they may see (names only) and every mix's name / owner, their own mix in full
  function forUser(s, id, live) {
    var inputs = []; s.inputs.forEach(function (x, i) { if (visibleTo(s, i, live)) inputs.push({ i: i, name: x.name || "Input " + (i + 1), color: x.color, group: x.group }); });
    return { inputs: inputs, mixes: s.mixes.map(function (q, m) { var mine = q.ownerId && q.ownerId === id; return { m: m, name: q.name, owner: q.owner, mine: !!mine, free: !q.ownerId && !q.reserved, wired: q.wired, local: q.local, outL: q.wired ? q.outL : -1, outR: q.wired ? q.outR : -1, level: mine ? q.level : undefined, mute: mine ? q.mute : undefined, stereo: q.stereo, hasOutput: q.wired && (q.outL >= 0 || q.outR >= 0), sends: mine ? q.sends : undefined }; }) };
  }
  function dbToLin(db) { return db <= -90 ? 0 : Math.pow(10, db / 20); }
  function linToDb(v) { return v <= 0.00003 ? -90 : 20 * Math.log10(v); }
  // fader position (0..1) <-> dB: a console-like curve, 0 dB at 75 %
  function faderToDb(p) { p = clamp(p, 0, 1); if (p <= 0) return -90; if (p >= 0.75) return (p - 0.75) / 0.25 * 10; var x = p / 0.75; return -60 * Math.pow(1 - x, 1.6); }
  function dbToFader(db) { if (db <= -90) return 0; if (db >= 0) return 0.75 + clamp(db, 0, 10) / 10 * 0.25; var x = 1 - Math.pow(Math.min(1, -db / 60), 1 / 1.6); return x * 0.75; }
  return { MAXIN: MAXIN, MAXMIX: MAXMIX, MAXOUT: MAXOUT, create: create, normalize: normalize, apply: apply, visibleTo: visibleTo, activeInputs: activeInputs, forUser: forUser, defaultInput: defaultInput, dbToLin: dbToLin, linToDb: linToDb, faderToDb: faderToDb, dbToFader: dbToFader };
});
