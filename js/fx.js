/* Central Pedal - effects on every track, every pad, the tracks bus and the pads bus.
 *
 *   Tracks (stems): gate, EQ, compressor, reverb, delay - rendered once into a processed copy of the track
 *     (js/fx-dsp.js, in a Web Worker) that the player plays instead of the original. Kept in this browser's track
 *     store, so a song with effects loads as fast as one without; the Pi does no extra work while the song plays.
 *   Pads: their own chain (js/app.js) - this adds the quick FX panel (EQ, compressor, reverb, delay, presets).
 *   The tracks bus and the pads bus: one live chain each (EQ, compressor, reverb, delay), only built when turned on.
 *
 * The basic version of each effect is free. Central Plugins opens the better ones: four parametric EQ bands and a
 * high cut, every compressor and gate control, hall / plate / cathedral reverbs, dotted and ping-pong delays with
 * darker repeats, and the "pro" presets.
 * Tracks still play without pads and pads without tracks: nothing here ties one to the other.
 */
(function () {
  "use strict";
  var PP = window.PP; if (!PP || !window.PP_FX_CORE) return;
  var core = window.PP_FX_CORE(), engine = PP.engine;
  function esc(s) { return PP.escapeHtml(String(s == null ? "" : s)); }
  function clamp(v, a, b) { v = Number(v); return isFinite(v) ? Math.max(a, Math.min(b, v)) : a; }
  function project() { return PP.project(); }

  // ------------------------------------------------------------- the plan
  function pro() { var P = window.PPPedals; return !P || !P.has ? true : !!P.has("plugins"); }
  function lockText() { var P = window.PPPedals; return P && P.lockText ? P.lockText("plugins") : "Needs Central Plugins"; }
  var LOCK = "🔒 ";

  // ------------------------------------------------------------- settings
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
    Object.keys(over).forEach(function (k) {
      var v = over[k];
      if (Array.isArray(v)) base[k] = v.map(function (x, i) { return x && typeof x === "object" ? merge(Object.assign({}, (base[k] || [])[i] || {}), x) : x; });
      else if (v && typeof v === "object" && base[k] && typeof base[k] === "object") base[k] = merge(base[k], v);
      else base[k] = v;
    });
    return base;
  }
  function fxOf(holder) { holder.fx = merge(defaultFx(), holder.fx || {}); return holder.fx; }
  function busFx(bus) { var p = project(); p.busFx = p.busFx || {}; var h = p.busFx[bus] = p.busFx[bus] || {}; return merge(defaultFx(), h); }
  function setBusFx(bus, fx) { var p = project(); p.busFx = p.busFx || {}; p.busFx[bus] = fx; }

  // presets: [name, settings, pro?]. "Clean" turns everything back to flat.
  function P(name, s, isPro) { return { name: name, s: s, pro: !!isPro }; }
  var STEM_PRESETS = [
    P("Clean", {}),
    P("Vocal stem", { eq: { on: true, lowCut: 90, mid: -2, midFreq: 350, high: 2.5 }, comp: { on: true, amount: 45 }, reverb: { on: true, type: "room", send: 14 }, delay: { on: true, time: "1/8", send: 8, feedback: 20 } }),
    P("Drums stem", { eq: { on: true, lowCut: 30, low: 2, mid: -3, midFreq: 400, high: 2 }, comp: { on: true, amount: 50 } }),
    P("Bass stem", { eq: { on: true, lowCut: 35, low: 2, mid: -2, midFreq: 250 }, comp: { on: true, amount: 55 } }),
    P("Keys stem", { eq: { on: true, lowCut: 80, mid: -1.5, midFreq: 500 }, comp: { on: true, amount: 25 }, reverb: { on: true, type: "room", send: 10 } }),
    P("Guitar stem", { eq: { on: true, lowCut: 100, mid: 1.5, midFreq: 2500 }, comp: { on: true, amount: 30 }, delay: { on: true, time: "1/8", send: 8, feedback: 20 } }),
    P("Lead vocal · plate", { eq: { on: true, lowCut: 100, mid: 0, high: 2, highCut: 18000, bands: [{ on: true, freq: 300, gain: -3, q: 1.2 }, { on: true, freq: 3200, gain: 2, q: 1 }] }, comp: { on: true, mode: "full", threshold: -20, ratio: 4, attack: 5, release: 120, makeup: 4 }, reverb: { on: true, type: "plate", send: 18 }, delay: { on: true, time: "1/8.", send: 10, feedback: 25, pingpong: true, tone: 5000 } }, true),
    P("Choir / BVs · hall", { eq: { on: true, lowCut: 140, high: 1.5, bands: [{ on: true, freq: 450, gain: -2.5, q: 1 }] }, comp: { on: true, mode: "full", threshold: -22, ratio: 3, attack: 15, release: 200, makeup: 3 }, reverb: { on: true, type: "hall", send: 26 } }, true),
    P("Drums · punch", { gate: { on: true, mode: "full", threshold: -38, range: -30, attack: 0.5, hold: 30, release: 90 }, eq: { on: true, lowCut: 30, low: 3, bands: [{ on: true, freq: 380, gain: -4, q: 1.4 }, { on: true, freq: 4500, gain: 2.5, q: 0.9 }] }, comp: { on: true, mode: "full", threshold: -18, ratio: 4, attack: 30, release: 100, makeup: 3 } }, true),
    P("Bass · tight DI", { gate: { on: true, mode: "full", threshold: -50, range: -40, hold: 60, release: 150 }, eq: { on: true, lowCut: 30, highCut: 9000, bands: [{ on: true, freq: 80, gain: 2, q: 1 }, { on: true, freq: 800, gain: 1.5, q: 1.2 }] }, comp: { on: true, mode: "full", threshold: -24, ratio: 5, attack: 8, release: 140, makeup: 4 } }, true),
    P("Ambient guitar", { eq: { on: true, lowCut: 120, highCut: 12000 }, delay: { on: true, time: "1/4.", send: 30, feedback: 45, pingpong: true, tone: 4000 }, reverb: { on: true, type: "hall", send: 30, size: 30 } }, true),
    P("Cathedral keys", { eq: { on: true, lowCut: 70 }, comp: { on: true, amount: 20 }, reverb: { on: true, type: "cathedral", send: 30, size: 20 } }, true)
  ];
  var BUS_PRESETS = [
    P("Clean", {}),
    P("Gentle glue", { comp: { on: true, amount: 25 } }),
    P("Warmer", { eq: { on: true, low: 1.5, high: -1.5 } }),
    P("Brighter", { eq: { on: true, lowCut: 40, high: 2 } }),
    P("Room", { reverb: { on: true, type: "room", send: 12 } }),
    P("Mix bus · polish", { eq: { on: true, lowCut: 30, high: 1.5, highCut: 19000, bands: [{ on: true, freq: 300, gain: -1.5, q: 0.8 }] }, comp: { on: true, mode: "full", threshold: -16, ratio: 2, attack: 30, release: 200, makeup: 2 } }, true),
    P("Big hall", { reverb: { on: true, type: "hall", send: 18, size: 20 } }, true)
  ];
  var PAD_PRESETS = [
    P("Clean pad", { eq: { on: true, lowCut: 40, low: 0, mid: 0, high: 0 }, comp: { on: false }, reverb: { on: true, type: "room", send: 18 }, delay: { on: false } }),
    P("Warm pad", { eq: { on: true, lowCut: 50, low: 2, mid: -1, high: -3 }, comp: { on: false }, reverb: { on: true, type: "hall", send: 35 }, delay: { on: false } }),
    P("Bright pad", { eq: { on: true, lowCut: 90, low: -1, mid: 0, high: 3 }, comp: { on: false }, reverb: { on: true, type: "hall", send: 30 }, delay: { on: false } }),
    P("Cathedral shimmer", { eq: { on: true, lowCut: 80, high: 1 }, reverb: { on: true, type: "cathedral", send: 45, size: 30, shimmer: 35 }, delay: { on: false } }, true),
    P("Wide ambient", { eq: { on: true, lowCut: 70 }, reverb: { on: true, type: "hall", send: 38 }, delay: { on: true, time: "1/4.", send: 22, feedback: 40, pingpong: true, tone: 4500 }, width: 170 }, true),
    P("Tape warmth", { eq: { on: true, lowCut: 45, low: 2, high: -4 }, comp: { on: true, amount: 30 }, reverb: { on: true, type: "plate", send: 25 }, drive: 25 }, true)
  ];
  function presetsFor(kind) { return kind === "stem" ? STEM_PRESETS : kind === "pad" ? PAD_PRESETS : BUS_PRESETS; }
  function applyPreset(fx, preset) {
    var base = defaultFx(), keepOn = true;
    var out = merge(base, JSON.parse(JSON.stringify(preset.s)));
    out.on = keepOn; out.preset = preset.name;
    if (preset.s.shimmer != null) out.reverb.shimmer = preset.s.shimmer;
    if (preset.s.width != null) out.width = preset.s.width;
    if (preset.s.drive != null) out.drive = preset.s.drive;
    return out;
  }

  // ------------------------------------------------------------- pads: the quick panel <-> the pad's own chain
  var DIV_VALUE = { "1/2": "2", "1/4": "1", "1/8": ".5", "1/16": ".25", "1/4.": "1.5", "1/8.": ".75" };
  function divName(v) { var k = Object.keys(DIV_VALUE).filter(function (n) { return Number(DIV_VALUE[n]) === Number(v); })[0]; return k || "1/8"; }
  function padToFx(pad) {
    var e = pad.effects || {}, b = (e.eq && e.eq.bands) || [], c = e.compressor || {}, r = e.reverb || {}, d = e.delay || {};
    var fx = defaultFx(); fx.on = true;
    fx.eq = { on: e.eq ? e.eq.enabled !== false : true, lowCut: b[0] && b[0].enabled ? b[0].freq : 0, low: b[1] ? b[1].gain || 0 : 0, mid: b[3] ? b[3].gain || 0 : 0, midFreq: b[3] ? b[3].freq : 1300, high: b[4] ? b[4].gain || 0 : 0,
      highCut: b[5] && b[5].enabled ? b[5].freq : 20000, bands: [{ on: !!(b[2] && b[2].enabled && Math.abs(b[2].gain || 0) > 0.05), freq: b[2] ? b[2].freq : 430, gain: b[2] ? b[2].gain || 0 : 0, q: b[2] ? b[2].q : 1.1 }] };
    fx.comp = { on: !!c.enabled, amount: c.amount == null ? 35 : c.amount, mode: c.quick === "full" ? "full" : "basic", threshold: c.threshold, ratio: c.ratio, attack: c.attack, release: c.release, makeup: c.makeup || 0, knee: c.knee };
    fx.reverb = { on: !!r.enabled, type: r.type || "hall", send: r.wet == null ? 30 : r.wet, size: Math.round(((r.decay || 4.2) - 4.5) / 3.5 * 50) };
    fx.delay = { on: !!d.enabled, time: divName(d.division), send: d.send == null ? 25 : d.send, feedback: d.feedback == null ? 30 : d.feedback, pingpong: d.type === "pingpong", tone: d.tone || 6000 };
    fx.preset = pad.fxPreset || "";
    return fx;
  }
  function fxToPad(fx, pad, extra) {
    var e = pad.effects, b = e.eq.bands, isPro = pro();
    e.eq.enabled = !!fx.eq.on;
    if (b[0]) { b[0].enabled = fx.eq.lowCut > 25; if (fx.eq.lowCut > 25) b[0].freq = clamp(fx.eq.lowCut, 20, 400); }
    if (b[1]) { b[1].enabled = true; b[1].gain = clamp(fx.eq.low, -12, 12); }
    if (b[3]) { b[3].enabled = true; b[3].gain = clamp(fx.eq.mid, -12, 12); if (isPro) b[3].freq = clamp(fx.eq.midFreq, 200, 8000); }
    if (b[4]) { b[4].enabled = true; b[4].gain = clamp(fx.eq.high, -12, 12); }
    if (isPro) {
      if (b[5]) { b[5].enabled = fx.eq.highCut < 19500; b[5].freq = clamp(fx.eq.highCut, 2000, 20000); }
      var pb = fx.eq.bands && fx.eq.bands[0]; if (b[2] && pb) { b[2].enabled = !!pb.on; b[2].type = "peaking"; b[2].freq = clamp(pb.freq, 40, 16000); b[2].gain = clamp(pb.gain, -12, 12); b[2].q = clamp(pb.q, 0.3, 6); }
    }
    var c = e.compressor; c.enabled = !!fx.comp.on; c.amount = fx.comp.amount; c.quick = isPro && fx.comp.mode === "full" ? "full" : "basic";
    var cp = core.compParams(fx.comp, isPro); if (cp) { c.threshold = Math.round(cp.threshold); c.ratio = Math.round(cp.ratio * 10) / 10; c.attack = cp.attack; c.release = cp.release; c.makeup = Math.round(cp.makeup * 10) / 10; c.knee = cp.knee; }
    var r = e.reverb, okType = isPro || fx.reverb.type === "room" || fx.reverb.type === "hall" || fx.reverb.type === r.type;
    r.enabled = !!fx.reverb.on; r.wet = clamp(fx.reverb.send, 0, 100); if (okType) r.type = fx.reverb.type;
    if (isPro) r.decay = Math.round(clamp(4.5 + fx.reverb.size / 50 * 3.5, 1, 8) * 10) / 10;
    if (fx.reverb.shimmer != null && isPro) r.shimmer = fx.reverb.shimmer;
    var d = e.delay, okTime = isPro || fx.delay.time === "1/4" || fx.delay.time === "1/8";
    d.enabled = !!fx.delay.on; d.send = clamp(fx.delay.send, 0, 100); d.feedback = clamp(fx.delay.feedback, 0, isPro ? 90 : 60); d.sync = true;
    if (okTime) d.division = DIV_VALUE[fx.delay.time] || ".5";
    if (isPro) { d.type = fx.delay.pingpong ? "pingpong" : "regular"; d.tone = clamp(fx.delay.tone, 800, 16000); }
    if (extra && isPro) {
      if (extra.width != null) { e.width.enabled = true; e.width.width = extra.width; }
      if (extra.drive != null) { e.drive.enabled = true; e.drive.type = "tape"; e.drive.amount = extra.drive; }
    }
    pad.fxPreset = fx.preset || "";
  }

  // ------------------------------------------------------------- tracks: render, keep, swap into the player
  var T = function () { return window.PPTracks; };
  var worker = null, jobs = {}, jobN = 0, chain = Promise.resolve(), busy = {};
  function ensureWorker() {
    if (worker) return worker;
    var src = "self.PP_FX_CORE=" + window.PP_FX_CORE.toString() + ";(" + window.PP_FX_DSP.toString() + ")();";
    try { worker = new Worker("data:text/javascript;charset=utf-8," + encodeURIComponent(src)); } catch (error) { console.warn("effects worker unavailable", error); return null; }
    worker.onmessage = function (e) { var j = jobs[e.data.id]; if (!j) return; if (e.data.progress != null) { j.progress(e.data.progress); return; } delete jobs[e.data.id]; if (e.data.error) j.reject(new Error(e.data.error)); else j.resolve(e.data.result); };
    return worker;
  }
  function hash(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
  function songBpm(s) { return (s && s.bpm) || (project().tempo && project().tempo.bpm) || 72; }
  function stemPlan(s, st) { return st.fx && st.fx.on ? core.plan(fxOf(st), pro(), songBpm(s)) : null; }
  function keyFor(st, plan, rate) { return "fx:" + st.id + ":" + hash(JSON.stringify(plan) + "|" + rate); }
  var stats = { renders: 0, ms: 0, seconds: 0 };
  function render(s, st, rec, plan, key) {
    if (busy[key]) return busy[key];
    busy[key] = chain = chain.then(function () {
      var w = ensureWorker(); if (!w) return null;
      var id = ++jobN, L = rec.L.slice(0), R = rec.R ? rec.R.slice(0) : null, transfer = [L]; if (R) transfer.push(R);
      PP.setStatus("Effects on " + st.name + "…");
      return new Promise(function (resolve, reject) {
        jobs[id] = { resolve: resolve, reject: reject, progress: function (f) { PP.setStatus("Effects on " + st.name + ": " + Math.round(f * 100) + "%"); } };
        w.postMessage({ id: id, L: L, R: R, length: rec.length, rate: rec.rate || 48000, plan: plan }, transfer);
      }).then(async function (out) {
        stats.renders++; stats.ms += out.ms; stats.seconds += rec.length / (rec.rate || 48000);
        var done = { L: out.L, R: out.R, length: rec.length, rate: rec.rate || out.rate };
        if (T() && T().putStem) await T().putStem(key, done);
        if (st.fxKey && st.fxKey !== key && T() && T().dropStem) { try { await T().dropStem(st.fxKey); } catch (_) { } }
        st.fxKey = key; PP.persistSoon();
        // the effects may have changed again while this one rendered: only the newest one goes to the player
        var now = stemPlan(s, st); if (now && keyFor(st, now, rec.rate || 48000) === key) toPlayer(s, st, done, true);
        PP.setStatus("Effects on " + st.name + ": ready");
        return done;
      });
    }).catch(function (error) { console.warn("track effects failed", error); PP.setStatus("Effects on " + st.name + " failed: " + (error && error.message || error)); return null; })
      .then(function (r) { delete busy[key]; return r; });
    return busy[key];
  }
  function toPlayer(s, st, rec, isFx) {
    var decks = T() && T().netDecks ? T().netDecks() || [] : [];
    decks.forEach(function (d) {
      if (!d || !d.node || d.songId !== s.id) return;
      var L = new Int16Array(rec.L.slice(0)), R = rec.R ? new Int16Array(rec.R.slice(0)) : null, tr = [L.buffer]; if (R) tr.push(R.buffer);
      d.node.port.postMessage({ cmd: "stemfx", id: st.id, L: L, R: R, fx: !!isFx }, tr);
    });
  }
  // the player asks while loading a song (js/tracks.js stemsFor): the rendered copy if there is one, else null
  // (and it starts rendering, then swaps it in)
  async function stemFor(s, st, rec) {
    var plan = stemPlan(s, st); if (!plan || !rec) return null;
    var key = keyFor(st, plan, rec.rate || 48000), hit = T() && T().getStemLocal ? await T().getStemLocal(key) : null;
    if (hit) return hit;
    render(s, st, rec, plan, key);
    return null;
  }
  var timers = {};
  function stemChanged(s, st) {   // after an edit: render (a moment later, so dragging a slider renders once)
    clearTimeout(timers[st.id]);
    timers[st.id] = setTimeout(async function () {
      var rec = T() && T().getStem ? await T().getStem(st.id) : null; if (!rec) return;
      var plan = stemPlan(s, st);
      if (!plan) { toPlayer(s, st, rec, false); return; }   // effects off: the plain track back
      var key = keyFor(st, plan, rec.rate || 48000), hit = T().getStemLocal ? await T().getStemLocal(key) : null;
      if (hit) { st.fxKey = key; toPlayer(s, st, hit, true); PP.persistSoon(); } else render(s, st, rec, plan, key);
    }, 650);
  }

  // ------------------------------------------------------------- the tracks bus and the pads bus (live)
  var buses = {};
  function busPoints(bus) {   // where the chain goes: [from, to]
    if (!engine.ctx) return null;
    return bus === "tracks" ? [engine.tracksBus, engine.tracksLimiter] : [engine.tone, engine.mainMix];
  }
  function BusChain(c) {
    function G(v) { var g = c.createGain(); g.gain.value = v == null ? 1 : v; return g; }
    this.input = G(); this.eq = []; var last = this.input;
    for (var i = 0; i < 7; i++) { var f = c.createBiquadFilter(); f.type = "peaking"; f.gain.value = 0; last.connect(f); last = f; this.eq.push(f); }
    this.comp = c.createDynamicsCompressor(); this.makeup = G(); this.output = G();
    this.compIn = G(1); this.compBypass = G(0);
    last.connect(this.compIn).connect(this.comp).connect(this.makeup).connect(this.output); last.connect(this.compBypass).connect(this.output);
    this.revSend = G(0); this.conv = c.createConvolver(); this.revOut = G(1); last.connect(this.revSend).connect(this.conv).connect(this.revOut).connect(this.output);
    this.dlySend = G(0); this.dly = c.createDelay(3); this.dlyTone = c.createBiquadFilter(); this.dlyTone.type = "lowpass"; this.dlyFb = G(0);
    last.connect(this.dlySend).connect(this.dly); this.dly.connect(this.dlyTone).connect(this.dlyFb).connect(this.dly); this.dly.connect(this.output);
    this.revType = null;
  }
  function busApply(bus) {
    var pts = busPoints(bus); if (!pts || !pts[0] || !pts[1]) return;
    var fx = busFx(bus), plan = fx.on ? core.plan(fx, pro(), songBpm(PP.activeSong && PP.activeSong())) : null, b = buses[bus], c = engine.ctx, now = c.currentTime;
    if (!plan) {   // off: straight through, and the chain is taken out (no CPU)
      if (b && b.inserted) { try { pts[0].disconnect(b.input); } catch (_) { } try { b.output.disconnect(); } catch (_) { } try { pts[0].connect(pts[1]); } catch (_) { } b.inserted = false; }
      return;
    }
    if (!b) b = buses[bus] = new BusChain(c);
    if (!b.inserted) { try { pts[0].disconnect(pts[1]); } catch (_) { } pts[0].connect(b.input); b.output.connect(pts[1]); b.inserted = true; }
    var bands = plan.eq || [];
    b.eq.forEach(function (f, i) { var q = bands[i]; if (q) { f.type = q[0]; f.frequency.setTargetAtTime(q[1], now, 0.02); f.gain.setTargetAtTime(q[2] || 0, now, 0.02); f.Q.setTargetAtTime(q[3] || 0.707, now, 0.02); } else { f.type = "peaking"; f.gain.setTargetAtTime(0, now, 0.02); } });
    var cp = plan.comp;
    b.compIn.gain.setTargetAtTime(cp ? 1 : 0, now, 0.02); b.compBypass.gain.setTargetAtTime(cp ? 0 : 1, now, 0.02);
    if (cp) { b.comp.threshold.value = cp.threshold; b.comp.ratio.value = cp.ratio; b.comp.knee.value = cp.knee; b.comp.attack.value = cp.attack / 1000; b.comp.release.value = cp.release / 1000; b.makeup.gain.setTargetAtTime(Math.pow(10, cp.makeup / 20), now, 0.02); }
    var rv = plan.reverb;
    if (rv && b.revType !== rv.type && engine.impulse) { try { b.conv.buffer = engine.impulse(rv.type, { room: 1.4, hall: 3.2, plate: 2.2, cathedral: 5.5 }[rv.type] || 2); b.revType = rv.type; } catch (_) { } }
    b.revSend.gain.setTargetAtTime(rv ? rv.send * 0.7 : 0, now, 0.03);
    var dl = plan.delay;
    b.dlySend.gain.setTargetAtTime(dl ? dl.send : 0, now, 0.03);
    if (dl) { b.dly.delayTime.setTargetAtTime(dl.seconds, now, 0.05); b.dlyFb.gain.setTargetAtTime(dl.feedback, now, 0.03); b.dlyTone.frequency.setTargetAtTime(dl.tone, now, 0.03); } else b.dlyFb.gain.setTargetAtTime(0, now, 0.03);
  }
  function busesApply() { if (engine.ctx) { busApply("tracks"); busApply("pads"); } }
  if (engine.hooks) engine.hooks.push(function () { setTimeout(busesApply, 0); });
  if (engine.ctx) busesApply();

  // ------------------------------------------------------------- the panel
  var target = null;   // {kind: "stem"|"pad"|"bus", name, fx, song, stem, pad, bus}
  function dialog() {
    var d = document.getElementById("fxDialog"); if (d) return d;
    d = document.createElement("dialog"); d.id = "fxDialog"; d.className = "fx-dialog";
    document.body.appendChild(d);
    d.addEventListener("input", onInput); d.addEventListener("change", onInput); d.addEventListener("click", onClick);
    return d;
  }
  function row(label, path, min, max, step, unit, opts) {
    opts = opts || {}; var v = get(path), locked = opts.pro && !pro();
    return '<label class="fx-row' + (locked ? " locked" : "") + '"><span>' + (locked ? LOCK : "") + esc(label) + '</span><input type="range" data-fx="' + path + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + esc(v) + '"' + (locked ? " disabled" : "") + '><output>' + esc(fmt(v, unit)) + "</output></label>";
  }
  function fmt(v, unit) { v = Number(v); if (unit === "Hz") return v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + " kHz" : Math.round(v) + " Hz"; if (unit === "dB") return (v > 0 ? "+" : "") + (Math.round(v * 10) / 10) + " dB"; if (unit === "%") return Math.round(v) + "%"; if (unit === "ms") return (Math.round(v * 10) / 10) + " ms"; if (unit === ":1") return (Math.round(v * 10) / 10) + ":1"; return String(v); }
  function toggle(label, path) { return '<label class="fx-toggle"><input type="checkbox" data-fx="' + path + '"' + (get(path) ? " checked" : "") + "><span>" + esc(label) + "</span></label>"; }
  function select(label, path, options) {   // options: [[value, name, pro?]]
    var cur = get(path);
    return '<label class="fx-row"><span>' + esc(label) + '</span><select data-fx="' + path + '">' + options.map(function (o) { var lk = o[2] && !pro(); return '<option value="' + esc(o[0]) + '"' + (String(cur) === String(o[0]) ? " selected" : "") + (lk && String(cur) !== String(o[0]) ? " disabled" : "") + ">" + (lk ? LOCK : "") + esc(o[1]) + "</option>"; }).join("") + "</select></label>";
  }
  function get(path) { var o = target.fx; path.split(".").forEach(function (k) { o = o == null ? undefined : o[k]; }); return o; }
  function set(path, v) { var o = target.fx, ks = path.split("."); for (var i = 0; i < ks.length - 1; i++) { if (o[ks[i]] == null) o[ks[i]] = /^\d+$/.test(ks[i + 1]) ? [] : {}; o = o[ks[i]]; } o[ks[ks.length - 1]] = v; }
  function proNote() { return pro() ? "" : '<p class="fx-lock">' + LOCK + esc(lockText()) + ": more EQ bands, every compressor and gate control, hall / plate / cathedral reverbs, dotted and ping-pong delays and the pro presets.</p>"; }
  function draw() {
    var d = dialog(), fx = target.fx, isPro = pro(), kind = target.kind, presets = presetsFor(kind);
    var fullComp = fx.comp.mode === "full" && isPro, fullGate = fx.gate.mode === "full" && isPro;
    d.innerHTML = '<div class="fx-head"><div><small>' + (kind === "stem" ? "Track effects" : kind === "pad" ? "Pad effects" : "Bus effects") + "</small><h3>" + esc(target.name) + "</h3></div>" +
      '<label class="fx-power"><input type="checkbox" data-fx="on"' + (fx.on ? " checked" : "") + '><span>' + (fx.on ? "On" : "Off") + "</span></label>" +
      '<button class="fx-close" data-fx-close aria-label="Close">✕</button></div>' +
      '<div class="fx-presets">' + presets.map(function (p) { var lk = p.pro && !isPro; return '<button data-fx-preset="' + esc(p.name) + '" class="' + (fx.preset === p.name ? "on" : "") + (lk ? " locked" : "") + '"' + (lk ? ' title="' + esc(lockText()) + '"' : "") + ">" + (lk ? LOCK : "") + esc(p.name) + "</button>"; }).join("") + "</div>" +
      '<div class="fx-body' + (fx.on ? "" : " off") + '">' +
      (kind === "stem" ? '<section><header>' + toggle("Gate", "gate.on") + (isPro ? '<label class="fx-mode"><input type="checkbox" data-fx-full="gate"' + (fullGate ? " checked" : "") + '> every control</label>' : "") + "</header>" +
        row("Threshold", "gate.threshold", -80, 0, 1, "dB") +
        (fullGate ? row("Range", "gate.range", -80, 0, 1, "dB", { pro: true }) + row("Attack", "gate.attack", 0.1, 50, 0.1, "ms", { pro: true }) + row("Hold", "gate.hold", 0, 500, 5, "ms", { pro: true }) + row("Release", "gate.release", 5, 2000, 5, "ms", { pro: true }) : "") + "</section>" : "") +
      '<section><header>' + toggle("EQ", "eq.on") + "</header>" +
        row("Low cut", "eq.lowCut", 0, 400, 5, "Hz") + row("Low", "eq.low", -12, 12, 0.5, "dB") + row("Mid", "eq.mid", -12, 12, 0.5, "dB") +
        row("Mid frequency", "eq.midFreq", 200, 8000, 10, "Hz", { pro: kind === "pad" }) + row("High", "eq.high", -12, 12, 0.5, "dB") +
        row("High cut", "eq.highCut", 2000, 20000, 100, "Hz", { pro: true }) +
        (fx.eq.bands || []).slice(0, kind === "pad" ? 1 : 2).map(function (b, i) { return '<div class="fx-band">' + (isPro ? toggle("Band " + (i + 1), "eq.bands." + i + ".on") : '<span class="fx-lockline">' + LOCK + "Band " + (i + 1) + "</span>") + row("Frequency", "eq.bands." + i + ".freq", 40, 16000, 10, "Hz", { pro: true }) + row("Gain", "eq.bands." + i + ".gain", -12, 12, 0.5, "dB", { pro: true }) + row("Width (Q)", "eq.bands." + i + ".q", 0.3, 6, 0.1, "", { pro: true }) + "</div>"; }).join("") + "</section>" +
      '<section><header>' + toggle("Compressor", "comp.on") + (isPro ? '<label class="fx-mode"><input type="checkbox" data-fx-full="comp"' + (fullComp ? " checked" : "") + '> every control</label>' : "") + "</header>" +
        (fullComp ? row("Threshold", "comp.threshold", -60, 0, 1, "dB", { pro: true }) + row("Ratio", "comp.ratio", 1, 20, 0.1, ":1", { pro: true }) + row("Attack", "comp.attack", 0.1, 300, 0.1, "ms", { pro: true }) + row("Release", "comp.release", 10, 3000, 10, "ms", { pro: true }) + row("Make-up", "comp.makeup", -12, 24, 0.5, "dB", { pro: true })
          : row("Amount", "comp.amount", 0, 100, 1, "%")) + "</section>" +
      '<section><header>' + toggle("Reverb", "reverb.on") + "</header>" +
        select("Type", "reverb.type", [["room", "Room"], ["hall", "Hall", kind !== "pad"], ["plate", "Plate", true], ["cathedral", "Cathedral", true]]) +
        row(kind === "pad" ? "Wet" : "Send", "reverb.send", 0, 100, 1, "%") + row("Size", "reverb.size", -50, 50, 1, "", { pro: true }) + "</section>" +
      '<section><header>' + toggle("Delay", "delay.on") + "</header>" +
        select("Time (follows the tempo)", "delay.time", [["1/4", "1/4"], ["1/8", "1/8"], ["1/4.", "1/4 dotted", true], ["1/8.", "1/8 dotted", true], ["1/2", "1/2", true], ["1/16", "1/16", true]]) +
        row("Send", "delay.send", 0, 100, 1, "%") + row("Repeats", "delay.feedback", 0, isPro ? 90 : 60, 1, "%") +
        (isPro ? toggle("Ping-pong", "delay.pingpong") : '<span class="fx-lockline">' + LOCK + "Ping-pong</span>") + row("Repeat tone", "delay.tone", 800, 16000, 100, "Hz", { pro: true }) + "</section>" +
      "</div>" + proNote() +
      '<p class="muted small fx-foot">' + (kind === "stem" ? "Made once into a processed copy of the track (a few seconds; the Pi does no extra work while it plays). The tracks still play on their own, with or without pads." : kind === "pad" ? 'The pad\'s own chain. <button class="link" data-fx-full-editor>Full pad editor…</button>' : "On every " + (target.bus === "tracks" ? "track of every song" : "pad") + ", live.") + "</p>";
  }
  function open(t) { target = t; draw(); var d = dialog(); if (!d.open) { try { d.showModal(); } catch (_) { d.setAttribute("open", ""); } } }
  function commit(rerender) {
    var fx = target.fx;
    if (target.kind === "stem") { target.stem.fx = fx; PP.persistSoon(); stemChanged(target.song, target.stem); }
    else if (target.kind === "pad") { fxToPad(fx, target.pad, target.extra); target.extra = null; PP.persistSoon(); try { engine.update(target.pad); } catch (_) { } }
    else { setBusFx(target.bus, fx); PP.persistSoon(); busApply(target.bus); }
    decorate();
    if (rerender) draw();
  }
  function onInput(e) {
    var el = e.target; if (!target) return;
    if (el.dataset.fxFull) { set(el.dataset.fxFull + ".mode", el.checked ? "full" : "basic"); commit(true); return; }
    var path = el.dataset.fx; if (!path) return;
    var v = el.type === "checkbox" ? el.checked : el.tagName === "SELECT" ? el.value : Number(el.value);
    set(path, v); if (path !== "on") { target.fx.preset = ""; if (!target.fx.on && e.type === "change") set("on", true); }
    var out = el.parentNode && el.parentNode.querySelector("output"); if (out) { var r = el.closest(".fx-row"); out.textContent = fmt(v, /Hz/.test(out.textContent) ? "Hz" : /dB/.test(out.textContent) ? "dB" : /%/.test(out.textContent) ? "%" : /ms/.test(out.textContent) ? "ms" : /:1/.test(out.textContent) ? ":1" : ""); }
    commit(e.type === "change" && (el.type === "checkbox" || el.tagName === "SELECT"));
  }
  function onClick(e) {
    if (e.target.closest("[data-fx-close]")) { dialog().close(); return; }
    if (e.target.closest("[data-fx-full-editor]")) { var i = target.padIndex; dialog().close(); var tab = document.querySelector('[data-tab="pads"]'); if (tab) tab.click(); try { if (PP.setPerformMode) PP.setPerformMode(false); PP.setSelectedPad(i); } catch (_) { } var eqp = document.querySelector('[data-panel="eq"]'); if (eqp) eqp.click(); return; }
    var pb = e.target.closest("[data-fx-preset]"); if (!pb) return;
    var p = presetsFor(target.kind).filter(function (q) { return q.name === pb.dataset.fxPreset; })[0]; if (!p) return;
    if (p.pro && !pro()) { PP.setStatus(p.name + ": " + lockText()); return; }
    target.fx = applyPreset(target.fx, p); if (target.kind === "pad") target.extra = { width: p.s.width, drive: p.s.drive };
    commit(true);
  }

  // ------------------------------------------------------------- opening it: FX on every track strip, pad and bus
  function stemTarget(id) { var s = PP.activeSong && PP.activeSong(); if (!s || !T()) return null; var st = (T().data(s).stems || []).filter(function (q) { return q.id === id; })[0]; return st ? { kind: "stem", name: st.name, song: s, stem: st, fx: fxOf(st) } : null; }
  function padTarget(i) { var pad = project().pads[i]; return pad ? { kind: "pad", name: "Pad " + (i + 1) + " · " + pad.name, pad: pad, padIndex: i, fx: padToFx(pad) } : null; }
  function busTarget(bus) { return { kind: "bus", bus: bus, name: bus === "tracks" ? "Tracks bus (all tracks)" : "Pads bus (all pads)", fx: busFx(bus) }; }
  function openFor(el) {
    var t = el.dataset.fxStem ? stemTarget(el.dataset.fxStem) : el.dataset.fxPad != null ? padTarget(Number(el.dataset.fxPad)) : el.dataset.fxBus ? busTarget(el.dataset.fxBus) : null;
    if (t) open(t);
  }
  // capture: before the pad's own pointerdown plays it, and before the strip's own handlers
  ["pointerdown", "mousedown", "touchstart"].forEach(function (type) {
    document.addEventListener(type, function (e) { var el = e.target.closest && e.target.closest("[data-fx-stem],[data-fx-pad],[data-fx-bus]"); if (el) { e.stopPropagation(); } }, true);
  });
  document.addEventListener("click", function (e) {
    var el = e.target.closest && e.target.closest("[data-fx-stem],[data-fx-pad],[data-fx-bus]"); if (!el) return;
    e.preventDefault(); e.stopPropagation(); openFor(el);
  }, true);
  document.addEventListener("keydown", function (e) { if ((e.key === "Enter" || e.key === " ") && e.target.matches && e.target.matches(".fx-chip")) { e.preventDefault(); e.stopPropagation(); openFor(e.target); } }, true);

  function padFxOn(pad) { var e = pad.effects || {}; return !!pad.fxPreset || !!(e.compressor && e.compressor.enabled) || !!(e.delay && e.delay.enabled); }   // (every pad has its reverb on: that alone is not lit)
  var decorating = false;
  function decorate() {
    if (decorating) return; decorating = true;
    try {
      var s = PP.activeSong && PP.activeSong(), stems = s && T() ? T().data(s).stems || [] : [];
      document.querySelectorAll("#trStems [data-stem], #mixStrips [data-stem]").forEach(function (row) {
        var st = stems.filter(function (q) { return q.id === row.dataset.stem; })[0], on = !!(st && st.fx && st.fx.on), b = row.querySelector(".fx-btn");
        if (!b) { b = document.createElement("button"); b.className = "fx-btn"; b.dataset.fxStem = row.dataset.stem; b.textContent = "FX"; b.title = "Effects on this track: gate, EQ, compressor, reverb, delay"; (row.querySelector(".stem-btns") || row).appendChild(b); }
        if (b.classList.contains("on") !== on) b.classList.toggle("on", on);
      });
      document.querySelectorAll('#trStems [data-bus="tracks"], #mixStrips [data-bus="tracks"]').forEach(function (row) {
        var on = !!busFx("tracks").on, b = row.querySelector(".fx-btn");
        if (!b) { b = document.createElement("button"); b.className = "fx-btn"; b.dataset.fxBus = "tracks"; b.textContent = "FX"; b.title = "Effects on the whole tracks bus"; row.appendChild(b); }
        if (b.classList.contains("on") !== on) b.classList.toggle("on", on);
      });
      var pads = project().pads || [];
      document.querySelectorAll("#pfPads [data-pf-pad], #padList [data-pad]").forEach(function (el) {
        var i = Number(el.dataset.pfPad != null ? el.dataset.pfPad : el.dataset.pad), pad = pads[i]; if (!pad) return;
        var on = padFxOn(pad), chip = el.querySelector(".fx-chip");
        if (!chip) { chip = document.createElement("span"); chip.className = "fx-chip"; chip.setAttribute("role", "button"); chip.tabIndex = 0; chip.dataset.fxPad = String(i); chip.textContent = "FX"; chip.title = "Effects on this pad"; el.appendChild(chip); }
        if (chip.classList.contains("on") !== on) chip.classList.toggle("on", on);
      });
      // FX for all pads: in the perform view's side column (under the textures), and under the editor's pad list
      [[".pf-side", ".pf-tex"], ["#padList", null]].forEach(function (w) {
        var host = document.querySelector(w[0]); if (!host) return;
        var bar = w[1] ? host.querySelector(".fx-busbar") : (host.nextElementSibling && host.nextElementSibling.classList.contains("fx-busbar") ? host.nextElementSibling : null);
        if (bar) { bar.querySelector(".fx-btn").classList.toggle("on", !!busFx("pads").on); return; }
        bar = document.createElement("div"); bar.className = "fx-busbar";
        bar.innerHTML = '<button class="fx-btn' + (busFx("pads").on ? " on" : "") + '" data-fx-bus="pads" title="Effects on every pad">FX · all pads</button>';
        var after = w[1] ? host.querySelector(w[1]) : host;
        if (after && after.parentNode) after.parentNode.insertBefore(bar, after.nextSibling); else host.appendChild(bar);
      });
    } finally { decorating = false; }
  }
  var observer = new MutationObserver(function () { if (!decorating) decorate(); });
  function watch() { ["#trStems", "#mixStrips", "#pfPads", "#padList"].forEach(function (sel) { var el = document.querySelector(sel); if (el && !el.__fxWatched) { el.__fxWatched = true; observer.observe(el, { childList: true }); } }); decorate(); }
  watch();
  document.addEventListener("pp-stems", function () { watch(); busesApply(); });

  window.PPFx = { stemFor: stemFor, open: open, openStem: function (id) { var t = stemTarget(id); if (t) open(t); return !!t; }, openPad: function (i) { var t = padTarget(i); if (t) open(t); return !!t; }, openBus: function (b) { open(busTarget(b)); },
    defaults: defaultFx, presets: { stem: STEM_PRESETS, pad: PAD_PRESETS, bus: BUS_PRESETS }, plan: function (s, st) { return stemPlan(s, st); }, busFx: busFx, setBusFx: function (b, fx) { setBusFx(b, fx); busApply(b); }, busChain: function (b) { return buses[b] || null; },
    padToFx: padToFx, fxToPad: fxToPad, stats: function () { return stats; }, pending: function () { return Object.keys(busy).length; }, decorate: decorate, isPro: pro, applyPreset: applyPreset };
})();
