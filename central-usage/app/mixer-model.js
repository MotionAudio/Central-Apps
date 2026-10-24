/* Central Control - the mixer model, shared by the audio host (main process), the admin and user screens and
 * the phone page. One reducer: every change is an "op"; the host applies it, passes it to the engine and
 * sends the same op to everyone, who apply it to their copy.
 *
 *  inputs[128]  name, source (Central Pedal channel by name / interface input / none), group (tracks | band),
 *               trim, polarity, high-pass, gate, EQ (4 bands), compressor, fader, pan, mute, direct output,
 *               shown to users, FX sends (reverb, delay: post fader)
 *  fx           the two shared FX: a reverb and a delay (its time from the song's tempo, or in ms); each returns
 *               into the main mix at "ret", into each in-ear mix at its rRev / rDly, into the stream mix too
 *  stream       the live stream mix: its own level / pan / on per channel (sends), level, mute, compressor
 *               ("glue"), FX returns, an output pair, and where else it goes (virtual device, online, recorded)
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
  function defaultEq() { return { on: false, lf: 100, lg: 0, mf: 1000, mg: 0, mq: 1, m2f: 3000, m2g: 0, m2q: 1, hf: 8000, hg: 0 }; }
  function defaultComp() { return { on: false, thr: -18, ratio: 3, att: 10, rel: 120, makeup: 0 }; }
  function defaultGate() { return { on: false, thr: -45, range: -40, att: 0.5, hold: 50, rel: 150 }; }
  function defaultInput(i) { return { name: "", src: { kind: "none" }, group: "band", color: "", trim: 0, phase: false, hpf: 0, gate: defaultGate(), eq: defaultEq(), comp: defaultComp(), fx: { rev: -90, dly: -90 }, fader: 0, mute: false, pan: 0, direct: -1, directPre: false, show: true }; }
  function defaultMix(m) { return { name: "Mix " + (m + 1), owner: null, ownerId: null, wired: false, local: true, outL: -1, outR: -1, stereo: true, level: 0, mute: false, reserved: false, rRev: -90, rDly: -90, sends: {} }; }
  function defaultFx() { return { rev: { on: true, decay: 2.2, pre: 20, damp: 0.5, lowcut: 150, width: 1, ret: 0 }, dly: { on: true, sync: "1/4", ms: 375, bpm: 0, fb: 0.3, hicut: 6000, lowcut: 150, ping: false, ret: 0 } }; }
  function defaultStream() { return { name: "Stream mix", level: 0, mute: false, outL: -1, outR: -1, comp: { on: true, thr: -18, ratio: 3, att: 10, rel: 150, makeup: 3 }, rRev: 0, rDly: 0, sends: {}, record: true }; }   // (where it goes online and the virtual device are the audio host's own settings: stream.json, with the stream keys)
  // the delay's time: from the song's tempo (a note value) or in ms
  var NOTE_BEATS = { "1/2": 2, "1/4d": 1.5, "1/4": 1, "1/4t": 2 / 3, "1/8d": 0.75, "1/8": 0.5, "1/8t": 1 / 3, "1/16": 0.25 };
  function delayMs(d) { d = d || {}; var beats = NOTE_BEATS[d.sync], bpm = Number(d.bpm) || 0; var ms = beats && bpm >= 30 ? 60000 / bpm * beats : Number(d.ms) || 375; return Math.max(1, Math.min(2900, Math.round(ms * 10) / 10)); }
  // starting points for a channel (the sound desk can change everything after)
  var PRESETS = [
    { id: "vocal", name: "Lead vocal", patch: { hpf: 100, gate: { on: false }, eq: { on: true, lf: 200, lg: -2, mf: 400, mg: -2, mq: 1.2, m2f: 3500, m2g: 2.5, m2q: 1, hf: 10000, hg: 2 }, comp: { on: true, thr: -20, ratio: 3.5, att: 5, rel: 120, makeup: 4 }, fx: { rev: -12, dly: -20 } } },
    { id: "bgv", name: "Backing vocal", patch: { hpf: 140, gate: { on: false }, eq: { on: true, lf: 200, lg: -3, mf: 500, mg: -2, mq: 1, m2f: 4000, m2g: 1.5, m2q: 1, hf: 10000, hg: 1 }, comp: { on: true, thr: -22, ratio: 4, att: 5, rel: 150, makeup: 4 }, fx: { rev: -10, dly: -90 } } },
    { id: "speech", name: "Pastor / speech", patch: { hpf: 120, gate: { on: true, thr: -50, range: -15, att: 1, hold: 200, rel: 300 }, eq: { on: true, lf: 150, lg: -2, mf: 300, mg: -2, mq: 1, m2f: 3000, m2g: 2, m2q: 1, hf: 9000, hg: 1 }, comp: { on: true, thr: -24, ratio: 3, att: 8, rel: 200, makeup: 5 }, fx: { rev: -90, dly: -90 } } },
    { id: "acoustic", name: "Acoustic guitar", patch: { hpf: 90, gate: { on: false }, eq: { on: true, lf: 120, lg: -2, mf: 250, mg: -3, mq: 1.4, m2f: 2500, m2g: 1.5, m2q: 1, hf: 10000, hg: 2.5 }, comp: { on: true, thr: -18, ratio: 2.5, att: 15, rel: 150, makeup: 2 }, fx: { rev: -16, dly: -90 } } },
    { id: "electric", name: "Electric guitar", patch: { hpf: 90, gate: { on: false }, eq: { on: true, lf: 120, lg: -1, mf: 400, mg: -2, mq: 1, m2f: 2000, m2g: 1, m2q: 1, hf: 8000, hg: 0 }, comp: { on: false }, fx: { rev: -18, dly: -16 } } },
    { id: "keys", name: "Keys / pads", patch: { hpf: 60, gate: { on: false }, eq: { on: true, lf: 150, lg: -1, mf: 350, mg: -2, mq: 1, m2f: 3000, m2g: 0, m2q: 1, hf: 10000, hg: 1 }, comp: { on: false }, fx: { rev: -18, dly: -90 } } },
    { id: "bass", name: "Bass", patch: { hpf: 35, gate: { on: false }, eq: { on: true, lf: 80, lg: 2, mf: 250, mg: -3, mq: 1.2, m2f: 800, m2g: 1, m2q: 1.5, hf: 5000, hg: -2 }, comp: { on: true, thr: -20, ratio: 4, att: 20, rel: 150, makeup: 3 }, fx: { rev: -90, dly: -90 } } },
    { id: "kick", name: "Kick", patch: { hpf: 30, gate: { on: true, thr: -35, range: -40, att: 0.3, hold: 60, rel: 120 }, eq: { on: true, lf: 60, lg: 4, mf: 350, mg: -6, mq: 1.5, m2f: 3500, m2g: 3, m2q: 1.2, hf: 10000, hg: 0 }, comp: { on: true, thr: -16, ratio: 4, att: 10, rel: 100, makeup: 2 }, fx: { rev: -90, dly: -90 } } },
    { id: "snare", name: "Snare", patch: { hpf: 80, gate: { on: true, thr: -30, range: -30, att: 0.3, hold: 40, rel: 150 }, eq: { on: true, lf: 200, lg: 2, mf: 800, mg: -2, mq: 1.2, m2f: 5000, m2g: 3, m2q: 1, hf: 10000, hg: 1 }, comp: { on: true, thr: -18, ratio: 3.5, att: 5, rel: 120, makeup: 2 }, fx: { rev: -14, dly: -90 } } },
    { id: "toms", name: "Toms", patch: { hpf: 60, gate: { on: true, thr: -32, range: -35, att: 0.3, hold: 80, rel: 250 }, eq: { on: true, lf: 100, lg: 3, mf: 400, mg: -5, mq: 1.4, m2f: 4000, m2g: 2, m2q: 1, hf: 10000, hg: 0 }, comp: { on: false }, fx: { rev: -16, dly: -90 } } },
    { id: "overheads", name: "Overheads", patch: { hpf: 200, gate: { on: false }, eq: { on: true, lf: 300, lg: -2, mf: 1000, mg: -1, mq: 1, m2f: 6000, m2g: 0, m2q: 1, hf: 12000, hg: 2 }, comp: { on: false }, fx: { rev: -20, dly: -90 } } },
    { id: "tracks", name: "Tracks (from the pedal)", patch: { hpf: 0, gate: { on: false }, eq: { on: false }, comp: { on: false }, fx: { rev: -90, dly: -90 } } },
    { id: "flat", name: "Flat (everything off)", patch: { hpf: 0, gate: { on: false }, eq: { on: false, lg: 0, mg: 0, m2g: 0, hg: 0 }, comp: { on: false }, fx: { rev: -90, dly: -90 } } }
  ];
  function create() {
    var s = { version: 2, inputs: [], main: { level: 0, mute: false, outL: -1, outR: -1 }, trackOut: "sum", directFirst: 0, mixes: [], fx: defaultFx(), stream: defaultStream(), device: { capture: "", playback: "", buffer: 256, backend: "auto", exclusive: false } };
    for (var i = 0; i < MAXIN; i++) s.inputs.push(defaultInput(i));
    for (var m = 0; m < MAXMIX; m++) s.mixes.push(defaultMix(m));
    return s;
  }
  function normalize(s) {   // a saved state from an older version / a file: fill in what is missing
    var d = create(); if (!s || typeof s !== "object") return d;
    s.inputs = Array.isArray(s.inputs) ? s.inputs : []; s.mixes = Array.isArray(s.mixes) ? s.mixes : [];
    for (var i = 0; i < MAXIN; i++) { var x = s.inputs[i] = Object.assign(defaultInput(i), s.inputs[i] || {}); x.eq = Object.assign(defaultEq(), x.eq || {}); x.comp = Object.assign(defaultComp(), x.comp || {}); x.gate = Object.assign(defaultGate(), x.gate || {}); x.fx = Object.assign({ rev: -90, dly: -90 }, x.fx || {}); if (!x.src || !x.src.kind) x.src = { kind: "none" }; }
    var dfx = defaultFx(); s.fx = s.fx && typeof s.fx === "object" ? s.fx : {}; s.fx.rev = Object.assign(dfx.rev, s.fx.rev || {}); s.fx.dly = Object.assign(dfx.dly, s.fx.dly || {});
    var dst = defaultStream(), st0 = s.stream && typeof s.stream === "object" ? s.stream : {};
    s.stream = Object.assign(dst, st0); s.stream.comp = Object.assign(defaultStream().comp, st0.comp || {}); if (!s.stream.sends || typeof s.stream.sends !== "object") s.stream.sends = {};
    s.version = 2;
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
  var EQ_KEYS = { on: "b", lf: [20, 1000], lg: [-18, 18], mf: [100, 12000], mg: [-18, 18], mq: [0.2, 8], m2f: [200, 16000], m2g: [-18, 18], m2q: [0.2, 8], hf: [1000, 20000], hg: [-18, 18] };
  var COMP_KEYS = { on: "b", thr: [-60, 0], ratio: [1, 20], att: [0.1, 200], rel: [5, 2000], makeup: [0, 24] };
  var GATE_KEYS = { on: "b", thr: [-80, 0], range: [-90, 0], att: [0.05, 50], hold: [0, 2000], rel: [5, 4000] };
  var SENDFX_KEYS = { rev: [-90, 10], dly: [-90, 10] };
  var REV_KEYS = { on: "b", decay: [0.2, 12], pre: [0, 200], damp: [0, 1], lowcut: [20, 1000], width: [0, 1], ret: [-90, 10] };
  var DLY_KEYS = { on: "b", sync: "s", ms: [1, 2900], bpm: [0, 400], fb: [0, 0.95], hicut: [500, 20000], lowcut: [20, 1000], ping: "b", ret: [-90, 10] };
  var STREAM_KEYS = { name: "s", level: [-90, 10], mute: "b", outL: [-1, MAXOUT - 1], outR: [-1, MAXOUT - 1], rRev: [-90, 10], rDly: [-90, 10], record: "b" };
  var MIX_KEYS = { name: "s", wired: "b", local: "b", outL: [-1, MAXOUT - 1], outR: [-1, MAXOUT - 1], stereo: "b", level: [-90, 10], mute: "b", reserved: "b", rRev: [-90, 10], rDly: [-90, 10] };
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
      if (p.gate) ch = put(x.gate, GATE_KEYS, p.gate) || ch;
      if (p.fx) ch = put(x.fx, SENDFX_KEYS, p.fx) || ch;
      if (p.src && typeof p.src === "object") { var src = p.src.kind === "pi" ? { kind: "pi", key: String(p.src.key || "").toLowerCase().slice(0, 40) } : p.src.kind === "in" ? { kind: "in", ch: clamp(p.src.ch, 0, MAXIN - 1) | 0 } : { kind: "none" }; if (JSON.stringify(src) !== JSON.stringify(x.src)) { x.src = src; ch = true; } }
      return ch;
    }
    if (op.op === "main") { if (!admin) return false; return put(s.main, { level: [-90, 10], mute: "b", outL: [-1, MAXOUT - 1], outR: [-1, MAXOUT - 1] }, op.patch); }
    if (op.op === "fx") {   // the shared reverb / delay
      if (!admin) return false; var fp = op.patch || {}, fc = false;
      if (fp.rev) fc = put(s.fx.rev, REV_KEYS, fp.rev) || fc;
      if (fp.dly) { if (fp.dly.sync != null && fp.dly.sync !== "ms" && !NOTE_BEATS[fp.dly.sync]) return fc; fc = put(s.fx.dly, DLY_KEYS, fp.dly) || fc; }
      return fc;
    }
    if (op.op === "stream") { if (!admin) return false; var sp = op.patch || {}, sc = put(s.stream, STREAM_KEYS, sp); if (sp.comp) sc = put(s.stream.comp, COMP_KEYS, sp.comp) || sc; return sc; }
    if (op.op === "streamSend") {   // a channel's level / pan / on in the stream mix
      if (!admin) return false; var si = op.i | 0; if (si < 0 || si >= MAXIN) return false;
      var scur = s.stream.sends[si] || { level: -90, pan: 0, on: true }, snx = Object.assign({}, scur);
      put(snx, { level: [-90, 10], pan: [-1, 1], on: "b" }, op.patch);
      if (JSON.stringify(snx) === JSON.stringify(scur) && s.stream.sends[si]) return false;
      if (snx.level <= -90 && snx.pan === 0 && snx.on) delete s.stream.sends[si]; else s.stream.sends[si] = snx;
      return true;
    }
    if (op.op === "streamCopy") {   // the stream mix starts from the main mix: every channel's fader, pan and mute
      if (!admin) return false; var sends = {};
      s.inputs.forEach(function (x, k) { if (!x.src || x.src.kind === "none" || x.fader <= -90) return; sends[k] = { level: x.fader, pan: x.pan, on: !x.mute }; });
      s.stream.sends = sends; return true;
    }
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
      if (!admin) { if (!owns) return false; patch = { level: patch.level, mute: patch.mute, name: patch.name, stereo: patch.stereo, rRev: patch.rRev, rDly: patch.rDly }; Object.keys(patch).forEach(function (k) { if (patch[k] === undefined) delete patch[k]; }); }   // where it goes is the sound desk's choice (stereo / mono and the reverb / delay in your own ears are yours)
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
    return { inputs: inputs, mixes: s.mixes.map(function (q, m) { var mine = q.ownerId && q.ownerId === id; return { m: m, name: q.name, owner: q.owner, mine: !!mine, free: !q.ownerId && !q.reserved, wired: q.wired, local: q.local, outL: q.wired ? q.outL : -1, outR: q.wired ? q.outR : -1, level: mine ? q.level : undefined, mute: mine ? q.mute : undefined, stereo: q.stereo, hasOutput: q.wired && (q.outL >= 0 || q.outR >= 0), sends: mine ? q.sends : undefined, rRev: mine ? q.rRev : undefined, rDly: mine ? q.rDly : undefined }; }) };
  }
  function dbToLin(db) { return db <= -90 ? 0 : Math.pow(10, db / 20); }
  function linToDb(v) { return v <= 0.00003 ? -90 : 20 * Math.log10(v); }
  // fader position (0..1) <-> dB: a console-like curve, 0 dB at 75 %
  function faderToDb(p) { p = clamp(p, 0, 1); if (p <= 0) return -90; if (p >= 0.75) return (p - 0.75) / 0.25 * 10; var x = p / 0.75; return -60 * Math.pow(1 - x, 1.6); }
  function dbToFader(db) { if (db <= -90) return 0; if (db >= 0) return 0.75 + clamp(db, 0, 10) / 10 * 0.25; var x = 1 - Math.pow(Math.min(1, -db / 60), 1 / 1.6); return x * 0.75; }
  return { MAXIN: MAXIN, MAXMIX: MAXMIX, MAXOUT: MAXOUT, STREAMTAP: MAXMIX + 1, PRESETS: PRESETS, NOTE_BEATS: NOTE_BEATS, delayMs: delayMs, defaultFx: defaultFx, defaultStream: defaultStream, create: create, normalize: normalize, apply: apply, visibleTo: visibleTo, activeInputs: activeInputs, forUser: forUser, defaultInput: defaultInput, dbToLin: dbToLin, linToDb: linToDb, faderToDb: faderToDb, dbToFader: dbToFader };
});
