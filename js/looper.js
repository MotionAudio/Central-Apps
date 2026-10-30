/* Central Pedal - the loop pedal (LOOPER tab, the 3.5" screen's LOOPER tab, a strip on the Instrument tab).
 *
 * Three loops. Each one records the instrument (the native chain's "Central Pedal loop" virtual microphone on the Pi),
 * the audio input, or both, and plays back on the Looper bus (the instrument's output unless routed elsewhere in
 * Settings → Output routing). Each loop: record / overdub / play / stop / undo / redo / clear, level, pan, reverse,
 * half speed, mute.
 *
 * In time: while the tracks play, a loop is N bars long and starts on the next bar line. With nothing playing the
 * first loop is free (tap to start, tap to close) - or, with a count-in, N bars at the set's tempo after one bar of
 * clicks. The first loop sets the length: the next ones close on a whole number of its lengths and stay in step.
 *
 * One footswitch does it all ("Looper pedal"): tap record → play → overdub → play…; a double tap stops every loop;
 * holding it clears the loop. Everything is recorded and played in one AudioWorklet; nothing runs while the loops
 * are empty. The tracks and pads never stop because of the looper.
 */
(function () {
  "use strict";
  var PP = window.PP; if (!PP) return;
  var clamp = PP.clamp, esc = PP.escapeHtml;
  function $(s, r) { return (r || document).querySelector(s); }
  function project() { return PP.project(); }
  function bridge() { return window.__pedalBridge; }
  function send(m) { return bridge() && bridge().send ? bridge().send(m) : false; }
  function T() { return window.PPTracks; }
  var N = 3;

  // ------------------------------------------------------------------ the worklet (runs in the audio thread)
  var WORKLET = function () {
    var SR = sampleRate, MAXF = Math.round(SR * 120), NT = 3;
    function mod(a, n) { return ((a % n) + n) % n; }
    function Loop() {
      this.L = null; this.R = null; this.cap = 0; this.len = 0; this.state = "empty"; this.ph = 0; this.wp = 0; this.want = 0; this.at = 0;
      this.uL = null; this.uR = null; this.rL = null; this.rR = null; this.gl = 0.9; this.gr = 0.9; this.mute = false; this.rev = false; this.half = false; this.src = 0; this.off = 0;
    }
    class Looper extends AudioWorkletProcessor {
      constructor() {
        super(); this.t = []; for (var i = 0; i < NT; i++) this.t.push(new Loop());
        this.mlen = 0; this.G = 0; this.comp = 0; this.level = 1; this.click = null; this.rep = ""; this.posAt = 0;
        this.port.onmessage = this.onMessage.bind(this);
      }
      grow(k, need) {
        if (k.cap >= need) return;
        var cap = Math.min(MAXF, Math.max(need, k.cap ? k.cap * 2 : Math.round(SR * 8))), L = new Float32Array(cap), R = new Float32Array(cap);
        if (k.L) { L.set(k.L.subarray(0, Math.min(k.cap, cap))); R.set(k.R.subarray(0, Math.min(k.cap, cap))); }
        k.L = L; k.R = R; k.cap = cap;
      }
      others(k) { for (var i = 0; i < NT; i++) { var o = this.t[i]; if (o !== k && o.len && (o.state === "playing" || o.state === "dubbing")) return true; } return false; }
      content(k) { for (var i = 0; i < NT; i++) { var o = this.t[i]; if (o !== k && o.len) return true; } return false; }
      align(k) {   // where a loop starts again so it is in step with the others (or, alone, from its top)
        if (this.others(k)) k.ph = mod(currentFrame - this.G - k.off, k.len); else { this.G = currentFrame - k.off; k.ph = 0; }
      }
      finish(k, frameEnd) {
        k.len = Math.max(1, k.wp); k.want = 0; k.state = "playing"; k.ph = 0;
        if (!this.mlen || !this.content(k)) { this.mlen = k.len; this.G = frameEnd; k.off = 0; } else k.off = mod(frameEnd - this.G, k.len);
      }
      copy(k) { return [k.L.slice(0, k.len), k.R.slice(0, k.len)]; }
      onMessage(e) {
        var m = e.data, k = typeof m.t === "number" ? this.t[m.t] : null, i;
        if (m.cmd === "rec" && k) {
          k.state = "armed"; k.want = Math.min(MAXF, Math.max(0, Math.round(m.len || 0))); k.at = Math.round(m.at || 0); k.wp = 0; k.len = 0;
          k.uL = k.uR = k.rL = k.rR = null; this.grow(k, k.want || Math.round(SR * 8));
          if (m.click) this.click = { from: Math.round(m.click.from), to: Math.round(m.click.to), every: Math.max(1, Math.round(m.click.every)), bpb: m.click.bpb || 4 };
        } else if (m.cmd === "close" && k) {
          if (k.state === "recording" && !k.want) {
            if (this.mlen && this.content(k)) {   // in step with the first loop: a whole number of its lengths
              var target = Math.max(1, Math.round(k.wp / this.mlen)) * this.mlen;
              if (target <= k.wp) { k.wp = target; this.finish(k, currentFrame); } else k.want = target;
            } else this.finish(k, currentFrame);
          } else if (k.state === "armed") { k.state = k.len ? "stopped" : "empty"; this.click = null; }
        } else if (m.cmd === "dub" && k) {
          if (k.len && (k.state === "playing" || k.state === "stopped")) { var c = this.copy(k); k.uL = c[0]; k.uR = c[1]; k.rL = k.rR = null; if (k.state === "stopped") this.align(k); k.state = "dubbing"; }
        } else if (m.cmd === "play" && k) {
          if (k.len && (k.state === "stopped" || k.state === "dubbing")) { if (k.state === "stopped") this.align(k); k.state = "playing"; }
        } else if (m.cmd === "stop" && k) {
          if (k.state === "recording") { if (k.wp > 64) { this.finish(k, currentFrame); k.state = "stopped"; } else { k.state = "empty"; k.wp = 0; } }
          else if (k.state === "armed") { k.state = k.len ? "stopped" : "empty"; this.click = null; }
          else if (k.len) k.state = "stopped";
        } else if (m.cmd === "undo" && k) {
          if (k.uL) { var cu = this.copy(k); k.rL = cu[0]; k.rR = cu[1]; k.L.set(k.uL); k.R.set(k.uR); k.uL = k.uR = null; if (k.state === "dubbing") k.state = "playing"; }
        } else if (m.cmd === "cancelDub" && k) {   // (the first tap of a double tap had started an overdub)
          if (k.state === "dubbing" && k.uL) { k.L.set(k.uL); k.R.set(k.uR); k.uL = k.uR = null; k.state = "playing"; }
        } else if (m.cmd === "redo" && k) {
          if (k.rL) { var cr = this.copy(k); k.uL = cr[0]; k.uR = cr[1]; k.L.set(k.rL); k.R.set(k.rR); k.rL = k.rR = null; }
        } else if (m.cmd === "clear" && k) {
          k.state = "empty"; k.len = 0; k.wp = 0; k.ph = 0; k.want = 0; k.uL = k.uR = k.rL = k.rR = null; k.L = k.R = null; k.cap = 0;
          if (!this.content(null)) { this.mlen = 0; this.click = null; }
        } else if (m.cmd === "set" && k) {
          if (m.gl != null) { k.gl = m.gl; k.gr = m.gr; } if (m.mute != null) k.mute = !!m.mute; if (m.rev != null) k.rev = !!m.rev; if (m.half != null) k.half = !!m.half; if (m.src != null) k.src = m.src;
        } else if (m.cmd === "all") {
          if (m.what === "stop") for (i = 0; i < NT; i++) { var s = this.t[i]; if (s.state === "recording" || s.state === "armed") { this.onMessage({ data: { cmd: "stop", t: i } }); } else if (s.len) s.state = "stopped"; }
          else if (m.what === "play") { var any = false; for (i = 0; i < NT; i++) if (this.t[i].len && (this.t[i].state === "playing" || this.t[i].state === "dubbing")) any = true;
            if (!any) this.G = currentFrame; for (i = 0; i < NT; i++) { var p = this.t[i]; if (p.len && p.state === "stopped") { p.ph = mod(currentFrame - this.G - p.off, p.len); p.state = "playing"; } } }
          else if (m.what === "clear") { for (i = 0; i < NT; i++) this.onMessage({ data: { cmd: "clear", t: i } }); }
        } else if (m.cmd === "comp") this.comp = Math.max(0, Math.round(m.frames || 0));
        else if (m.cmd === "level") this.level = m.level;
        this.report(true);
      }
      report(force) {
        var key = this.mlen + "|", i, k;
        for (i = 0; i < NT; i++) { k = this.t[i]; key += k.state + ":" + k.len + ":" + (k.uL ? 1 : 0) + (k.rL ? 1 : 0) + ";"; }
        if (force || key !== this.rep) {
          this.rep = key; var list = [];
          for (i = 0; i < NT; i++) { k = this.t[i]; list.push({ s: k.state, len: k.len, u: !!k.uL, r: !!k.rL }); }
          this.port.postMessage({ type: "state", tracks: list, mlen: this.mlen, frame: currentFrame });
        }
      }
      process(inputs, outputs) {
        var out = outputs[0], oL = out[0], oR = out[1] || out[0], n = oL.length, f0 = currentFrame, i, ti, active = false;
        for (ti = 0; ti < NT; ti++) if (this.t[ti].state !== "empty" && this.t[ti].state !== "stopped") active = true;
        if (!active && !this.click) return true;   // (nothing recorded or playing: no work at all)
        var a0 = inputs[0] || [], a1 = inputs[1] || [], iL0 = a0[0], iR0 = a0[1] || a0[0], iL1 = a1[0], iR1 = a1[1] || a1[0], two = oR !== oL;
        for (ti = 0; ti < NT; ti++) {
          var k = this.t[ti]; if (k.state === "empty" || k.state === "stopped") continue;
          var useA = k.src !== 1, useB = k.src !== 0;
          for (i = 0; i < n; i++) {
            var frame = f0 + i, a = (useA && iL0 ? iL0[i] : 0) + (useB && iL1 ? iL1[i] : 0), b = (useA && iR0 ? iR0[i] : 0) + (useB && iR1 ? iR1[i] : 0);
            if (k.state === "armed") { if (frame < k.at) continue; k.state = "recording"; k.wp = 0; }
            if (k.state === "recording") {
              if (k.wp >= k.cap) this.grow(k, k.wp + 1);
              if (k.wp < k.cap) { k.L[k.wp] = a; k.R[k.wp] = b; k.wp++; }
              if ((k.want && k.wp >= k.want) || k.wp >= MAXF) this.finish(k, frame + 1);
              continue;
            }
            if (k.state !== "playing" && k.state !== "dubbing") break;
            var len = k.len, dir = k.rev ? -1 : 1, rp = k.ph + this.comp * dir;   // (read ahead by the round trip so the loop sits on the beat)
            rp -= Math.floor(rp / len) * len;
            var i0 = rp | 0, fr = rp - i0, i1 = i0 + 1 >= len ? 0 : i0 + 1;
            if (!k.mute) {
              var sl = k.L[i0] + (k.L[i1] - k.L[i0]) * fr, sr = k.R[i0] + (k.R[i1] - k.R[i0]) * fr;
              oL[i] += sl * k.gl * this.level; if (two) oR[i] += sr * k.gr * this.level;
            }
            if (k.state === "dubbing") { var wi = k.ph | 0, h = k.half ? 0.5 : 1; k.L[wi] += a * h; k.R[wi] += b * h; }
            k.ph += dir * (k.half ? 0.5 : 1); if (k.ph >= len) k.ph -= len; else if (k.ph < 0) k.ph += len;
          }
        }
        var c = this.click;
        if (c) {   // the count-in: one bar of clicks before the first loop
          for (i = 0; i < n; i++) {
            var fr2 = f0 + i; if (fr2 < c.from || fr2 >= c.to) continue;
            var into = (fr2 - c.from) % c.every, tt = into / SR; if (tt > 0.04) continue;
            var accent = Math.floor((fr2 - c.from) / c.every) % c.bpb === 0, v = Math.sin(6.2832 * (accent ? 2000 : 1400) * tt) * Math.exp(-tt * 110) * 0.45;
            oL[i] += v; if (two) oR[i] += v;
          }
          if (f0 + n >= c.to) this.click = null;
        }
        this.report(false);
        if (f0 - this.posAt >= SR / 10) {   // where each loop is, ~10 times a second (for the rings)
          this.posAt = f0; var p = [];
          for (ti = 0; ti < NT; ti++) { var q = this.t[ti]; p.push(q.state === "recording" ? -1 - q.wp / Math.max(1, q.want || this.mlen || SR * 8) : q.len && (q.state === "playing" || q.state === "dubbing") ? q.ph / q.len : -0); }
          this.port.postMessage({ type: "pos", p: p, rec: this.t.map(function (q) { return q.state === "recording" ? q.wp : 0; }) });
        }
        return true;
      }
    }
    registerProcessor("pp-looper3", Looper);
  };

  // ------------------------------------------------------------------ settings (saved with the setup)
  var SRC = { inst: 0, input: 1, both: 2 };
  var SRC_NAMES = { inst: "Instrument", input: "Audio input", both: "Both" };
  function cfg() {
    var p = project();
    if (!p.looper || typeof p.looper !== "object") p.looper = {};
    var c = p.looper;
    if (!c.mode) c.mode = c.sync === false ? "free" : "auto";
    if (!(c.bars > 0)) c.bars = 4;
    if (c.level == null) c.level = 0.9;
    if (typeof c.countIn !== "boolean") c.countIn = false;
    if (!(c.sel >= 0 && c.sel < N)) c.sel = 0;
    if (!Array.isArray(c.tracks)) c.tracks = [];
    for (var i = 0; i < N; i++) if (!c.tracks[i] || c.tracks[i].src == null || c.tracks[i].level == null) c.tracks[i] = Object.assign({ level: 0.9, pan: 0, mute: false, rev: false, half: false, src: "inst" }, c.tracks[i] || {});
    return c;
  }
  // ("In time with the song" off in older setups, or a test turning it off)
  function mode() { var c = cfg(); return c.sync === false ? "free" : c.mode; }

  // ------------------------------------------------------------------ the engine
  var node = null, gain = null, srcInst = null, srcInput = null, instStream = null, inputStream = null, ready = null, armedFlag = false;
  var st = { tracks: [], mlen: 0 }, pos = [0, 0, 0], meta = [{}, {}, {}];
  for (var z = 0; z < N; z++) st.tracks.push({ s: "empty", len: 0, u: false, r: false });
  async function ensure() {
    if (ready) return ready;
    ready = (async function () {
      var engine = PP.engine, ctx = await engine.ensure();
      var code = "(" + WORKLET.toString() + ")();";
      await ctx.audioWorklet.addModule("data:text/javascript;charset=utf-8," + encodeURIComponent(code));
      node = new AudioWorkletNode(ctx, "pp-looper3", { numberOfInputs: 2, numberOfOutputs: 1, outputChannelCount: [2] });
      gain = ctx.createGain(); gain.gain.value = 1; node.connect(gain);
      engine.loopOut = gain; engine.routeOutput();
      node.port.onmessage = onWorklet;
      node.port.postMessage({ cmd: "level", level: 1 });
      var lat = cfg().latencyMs != null ? cfg().latencyMs / 1000 : (ctx.baseLatency || 0.005) + (ctx.outputLatency || 0.01) + 0.008;
      node.port.postMessage({ cmd: "comp", frames: lat * ctx.sampleRate });
      for (var i = 0; i < N; i++) pushTrack(i);
      return node;
    })();
    ready.catch(function (e) { console.warn("looper failed", e); ready = null; });
    return ready;
  }
  var lastStateKey = "";
  function onWorklet(e) {
    var m = e.data;
    if (m.type === "state") {
      st = m;
      var key = m.tracks.map(function (t) { return t.s + t.len + t.u + t.r; }).join("|");
      m.tracks.forEach(function (t, i) { if (t.s === "empty") meta[i] = {}; });
      if (key !== lastStateKey) { lastStateKey = key; render(); if (window.PPActions) window.PPActions.sendLeds(); displaySoon(); }
      if (!anyContent() && armedFlag && !holdArm) disarmLater(); else clearTimeout(disarmTimer);
    } else if (m.type === "pos") { pos = m.p; paintRings(); }
  }
  function anyContent() { return st.tracks.some(function (t) { return t.s !== "empty"; }); }
  function anyPlaying() { return st.tracks.some(function (t) { return t.s === "playing" || t.s === "dubbing" || t.s === "recording" || t.s === "armed"; }); }
  // a loop's length in bars: set when it was recorded in time (song or count-in), else a whole number of the first loop's
  function barsOf(len) {
    if (!len || !st.mlen) return null;
    var j = st.tracks.findIndex(function (t, k) { return t.len === st.mlen && meta[k].bars; });
    return j < 0 ? null : Math.max(1, Math.round(len / st.mlen)) * meta[j].bars;
  }
  function pushTrack(i) {
    if (!node) return; var t = cfg().tracks[i], lv = clamp(t.level, 0, 1.4), p = clamp(t.pan, -1, 1);
    node.port.postMessage({ cmd: "set", t: i, gl: lv * (p > 0 ? 1 - p : 1), gr: lv * (p < 0 ? 1 + p : 1), mute: !!t.mute, rev: !!t.rev, half: !!t.half, src: SRC[t.src] != null ? SRC[t.src] : 0 });
  }

  // the inputs: the Pi's "Central Pedal loop" virtual microphone (the instrument) and the audio input
  function isLoopDev(d) { return /central (control|pedal) loop|padpedal-loop/i.test(d.label || ""); }
  async function findLoopDevice() {
    var devs = await navigator.mediaDevices.enumerateDevices(), dev = devs.filter(function (d) { return d.kind === "audioinput" && isLoopDev(d); })[0];
    if (!dev && !devs.some(function (d) { return d.kind === "audioinput" && d.label; })) {   // (labels show after a first permission)
      var tmp = await navigator.mediaDevices.getUserMedia({ audio: true }); tmp.getTracks().forEach(function (t) { t.stop(); });
      devs = await navigator.mediaDevices.enumerateDevices(); dev = devs.filter(function (d) { return d.kind === "audioinput" && isLoopDev(d); })[0];
    }
    return dev || null;
  }
  async function connectInst() {
    if (srcInst) return true;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return false;
    try {
      var dev = await findLoopDevice(); if (!dev) return false;
      instStream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: dev.deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 } });
      srcInst = PP.engine.ctx.createMediaStreamSource(instStream); srcInst.connect(node, 0, 0);
      return true;
    } catch (e) { console.warn("looper instrument input", e); return false; }
  }
  async function connectInput() {   // the audio input: the one the Pad tab's AUDIO INPUT uses, else this device's default input
    if (srcInput) return true;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return false;
    try {
      var engine = PP.engine, stream = engine.inputStream;
      if (!stream) {
        var devs = await navigator.mediaDevices.enumerateDevices(), dev = devs.filter(function (d) { return d.kind === "audioinput" && !isLoopDev(d) && d.deviceId !== "default"; })[0];
        inputStream = stream = await navigator.mediaDevices.getUserMedia({ audio: Object.assign({ echoCancellation: false, noiseSuppression: false, autoGainControl: false }, dev && /^(127\.0\.0\.1|localhost)$/.test(location.hostname) ? { deviceId: dev.deviceId } : {}) });
      }
      srcInput = engine.ctx.createMediaStreamSource(stream); srcInput.connect(node, 0, 1);
      return true;
    } catch (e) { console.warn("looper audio input", e); return false; }
  }
  function needs(i) { var s = cfg().tracks[i].src; return { inst: s !== "input", input: s !== "inst" }; }
  async function arm(on) {
    armedFlag = on !== false;
    send({ type: "instrument", action: "looper", on: armedFlag });
    if (!armedFlag) {
      [instStream, inputStream].forEach(function (s) { if (s) s.getTracks().forEach(function (t) { t.stop(); }); });
      instStream = inputStream = null;
      [srcInst, srcInput].forEach(function (s) { if (s) { try { s.disconnect(); } catch (_) { } } });
      srcInst = srcInput = null; instFallback = false; render(); return true;
    }
    await ensure();
    var ok = false, tries = onPi() ? 12 : 1; for (var i = 0; i < tries && !ok; i++) { ok = await connectInst(); if (!ok && i < tries - 1) await new Promise(function (r) { setTimeout(r, 500); }); }
    render(); return ok;
  }
  // get the inputs a loop records from ready (the instrument's tap on the Pi; the audio input)
  async function ready4(i) {
    await ensure();
    var w = needs(i), ok = false;
    if (w.inst) {
      if (!armedFlag || !srcInst) ok = await arm(true) || ok; else ok = true;
      if (!srcInst && !instFallback && await connectInput()) { srcInput.connect(node, 0, 0); instFallback = true; ok = true; PP.setStatus("Looper: no instrument input here - the loops record the audio input"); }   // (a computer: Central Pedal Control)
      else if (instFallback) ok = true;
    }
    if (w.input) ok = (await connectInput()) || ok;
    if (!ok && !srcInst && !srcInput) PP.setStatus("Looper: no input - " + (w.inst ? "the instrument's loop input did not appear (Instrument on, on the Central Pedal)" : "no audio input on this device") + ".");
    return ok || !!srcInst || !!srcInput;
  }
  var disarmTimer = 0, holdArm = false, instFallback = false;
  function onPi() { var F = window.PPFeatures, s = F && F.systemStatus && F.systemStatus(); return !!(s && s.audio && s.audio.channels && s.audio.channels.length); }
  function disarmLater() { clearTimeout(disarmTimer); disarmTimer = setTimeout(function () { if (!anyContent() && armedFlag) arm(false); }, 30000); }   // (the Pi's loop tap stops when the loops have been empty for a while)
  // a node to record from instead (tests, or a computer without the Pi)
  async function useNode(n, input) { await ensure(); if (input) { if (srcInput) { try { srcInput.disconnect(); } catch (_) { } } srcInput = n; n.connect(node, 0, 1); } else { if (srcInst) { try { srcInst.disconnect(); } catch (_) { } } srcInst = n; n.connect(node, 0, 0); } armedFlag = true; holdArm = true; render(); }

  // ------------------------------------------------------------------ timing: when a loop starts and how long it is
  function songTiming() {   // the next bar line of the song that is playing, and N bars of it
    var t = T(), s = t && t.song(); if (!(t && t.isPlaying && t.isPlaying() && s)) return null;
    var ctx = PP.engine.ctx, now = ctx.currentTime, rate = ctx.sampleRate, c = cfg();
    var bpb = t.beatsInBar ? t.beatsInBar(s) || 4 : 4, speed = ((t.data(s) || {}).tempoPercent || 100) / 100, barSec = 60 / Math.max(30, s.bpm || 120) * bpb / speed;
    var st0 = t.state, bar = t.timeToBar(s, st0.pos), next = t.barStart(s, bar.bar + (bar.beat > 1 || (st0.pos - t.barStart(s, bar.bar)) > 0.05 ? 1 : 0));
    var wait = Math.max(0.02, (next - st0.pos) / speed);
    return { at: Math.round((now + wait) * rate), len: Math.round(barSec * clamp(c.bars, 1, 16) * rate), bars: clamp(c.bars, 1, 16) };
  }
  // pure maths (tested): what a recording press does, given the set-up and what is running
  function plan(o) {
    // o: {mode, bars, countIn, bpm, bpb, now (s), rate, master (frames, 0 = none), song: {at, len, bars} | null}
    var bars = clamp(o.bars || 4, 1, 16), barSec = 60 / Math.max(30, o.bpm || 120) * (o.bpb || 4), r = o.rate;
    if (o.mode !== "free" && o.song) return { at: o.song.at, len: o.song.len, bars: o.song.bars, how: "song" };
    if (o.master) return { at: Math.round((o.now + 0.01) * r), len: 0, quant: true, how: "follow" };   // (closes on a whole number of the first loop)
    if (o.mode === "free" || (o.mode === "auto" && !o.countIn)) return { at: Math.round((o.now + 0.01) * r), len: 0, how: "free" };
    var lead = o.countIn ? barSec : 0.02, at = Math.round((o.now + lead) * r);
    return { at: at, len: Math.round(barSec * bars * r), bars: bars, how: o.countIn ? "countin" : "tempo",
      click: o.countIn ? { from: Math.round((o.now + 0.02) * r), to: at, every: Math.round(60 / Math.max(30, o.bpm || 120) * r), bpb: o.bpb || 4 } : null };
  }
  function timing() {
    var c = cfg(), ctx = PP.engine.ctx, t = T(), s = t && t.song(), bpm = s ? s.bpm : (project().tempo || {}).bpm || 120, bpb = s && t.beatsInBar ? t.beatsInBar(s) || 4 : 4;
    var o = { mode: mode(), bars: c.bars, countIn: c.countIn, bpm: bpm, bpb: bpb, now: ctx.currentTime, rate: ctx.sampleRate, master: anyContentBut(-1) ? st.mlen : 0, song: mode() === "free" ? null : songTiming() };
    if (o.song && o.master) o.master = 0;   // (while the song plays, a new loop is N bars from the next bar line)
    return plan(o);
  }
  function anyContentBut(i) { return st.tracks.some(function (t, j) { return j !== i && t.len; }); }

  // ------------------------------------------------------------------ the controls
  function idx(i) { return i == null || i < 0 || !(i < N) ? cfg().sel : i | 0; }
  function stateOf(i) { return (st.tracks[idx(i)] || {}).s || "empty"; }
  async function record(i) {
    var c = cfg(); i = idx(i);
    if (!(await ready4(i))) return stateOf(i);
    var tm = timing(); meta[i] = { bars: tm.bars || null };
    node.port.postMessage({ cmd: "rec", t: i, at: tm.at, len: tm.len, click: tm.click || null });
    say(i, tm.how === "song" ? "recording " + tm.bars + " bar" + (tm.bars === 1 ? "" : "s") + " from the next bar" : tm.how === "countin" ? "count-in, then " + tm.bars + " bars" : tm.how === "tempo" ? "recording " + tm.bars + " bars" : tm.how === "follow" ? "recording - tap to close (in step with loop " + (firstLoop() + 1) + ")" : "recording - tap again to close the loop");
    return "armed";
  }
  function firstLoop() { var i = st.tracks.findIndex(function (t) { return t.len && t.len === st.mlen; }); return i < 0 ? 0 : i; }
  function say(i, text) { PP.setStatus("Loop " + (i + 1) + ": " + text); }
  function post(cmd, i, extra) { if (node) node.port.postMessage(Object.assign({ cmd: cmd, t: i }, extra || {})); }
  async function main(i) {  // record → play → overdub → play …
    i = idx(i);
    if (cfg().enabled === false) { PP.setStatus("The looper is off (LOOPER tab → Looper on)."); return stateOf(i); }
    var s = stateOf(i);
    if (s === "empty") return record(i);
    await ensure();
    if (s === "armed") { post("close", i); say(i, "cancelled"); }
    else if (s === "recording") post("close", i);
    else if (s === "playing") { if (needs(i).input) await connectInput(); post("dub", i); say(i, "overdub"); }
    else if (s === "dubbing" || s === "stopped") { post("play", i); say(i, "playing"); }
    return s;
  }
  function stop(i) { i = idx(i); post("stop", i); say(i, "stopped"); }
  function play(i) { i = idx(i); post("play", i); }
  function stopPlay(i) { i = idx(i); if (stateOf(i) === "stopped") play(i); else stop(i); }
  function undo(i) { i = idx(i); post("undo", i); say(i, "last overdub undone"); }
  function redo(i) { i = idx(i); post("redo", i); say(i, "overdub back"); }
  function clear(i) { i = idx(i); post("clear", i); meta[i] = {}; say(i, "cleared"); }
  function stopAll() { if (node) node.port.postMessage({ cmd: "all", what: "stop" }); PP.setStatus("Looper: every loop stopped"); }
  function playAll() { if (node) node.port.postMessage({ cmd: "all", what: "play" }); PP.setStatus("Looper: playing"); }
  function clearAll() { if (node) node.port.postMessage({ cmd: "all", what: "clear" }); meta = [{}, {}, {}]; PP.setStatus("Looper: all loops cleared"); }
  function select(i) { var c = cfg(); c.sel = clamp(i | 0, 0, N - 1); PP.persistSoon(); render(); displaySoon(); }
  function selectStep(d) { select((cfg().sel + (d < 0 ? N - 1 : 1)) % N); }
  function setTrack(i, k, v) { i = idx(i); var t = cfg().tracks[i]; t[k] = v; pushTrack(i); PP.persistSoon(); render(); displaySoon(); }
  function toggleTrack(i, k) { i = idx(i); setTrack(i, k, !cfg().tracks[i][k]); return cfg().tracks[i][k]; }
  function setLevel(v, i) { if (i == null) { cfg().level = clamp(v, 0, 1.4); for (var j = 0; j < N; j++) { cfg().tracks[j].level = cfg().level; pushTrack(j); } PP.persistSoon(); paintLevels(); displaySoon(); return; } setTrack(i, "level", clamp(v, 0, 1.4)); }
  function setPan(v, i) { setTrack(i, "pan", clamp(v, -1, 1)); }
  function stepSource(i) { i = idx(i); var order = ["inst", "input", "both"], s = cfg().tracks[i].src; setTrack(i, "src", order[(order.indexOf(s) + 1) % order.length]); }
  function setMode(m) { var c = cfg(); delete c.sync; c.mode = m === "free" || m === "song" ? m : "auto"; PP.persistSoon(); render(); displaySoon(); }
  function stepMode() { var order = ["auto", "song", "free"]; setMode(order[(order.indexOf(mode()) + 1) % order.length]); }
  function setBars(b) { cfg().bars = clamp(b | 0, 1, 16); PP.persistSoon(); render(); displaySoon(); }
  function stepBars(d) { var list = [1, 2, 4, 8, 16], i = list.indexOf(cfg().bars); setBars(list[clamp((i < 0 ? 2 : i) + (d < 0 ? -1 : 1), 0, list.length - 1)]); }
  function cycleBars() { var list = [1, 2, 4, 8, 16], i = list.indexOf(cfg().bars); setBars(list[((i < 0 ? 2 : i) + 1) % list.length]); }
  function toggleCountIn() { var c = cfg(); c.countIn = !c.countIn; PP.persistSoon(); render(); displaySoon(); }

  // the one-footswitch pedal: tap = record / play / overdub; double tap = stop every loop; hold = clear the loop
  var pedalLast = { at: 0, prev: "", i: 0 }, holdTimer = 0, DOUBLE_MS = 420, HOLD_MS = 1000;
  function pedalPress(info) {
    var i = cfg().sel, now = Date.now(), prev = stateOf(i);
    clearTimeout(holdTimer);
    if (now - pedalLast.at < DOUBLE_MS && pedalLast.i === i) {   // the second tap of a double tap
      var first = pedalLast; pedalLast = { at: 0, prev: "", i: i };
      Promise.resolve(first.busy).then(function () {   // (after what the first tap did has reached the looper)
        if (first.prev === "playing") post("cancelDub", i);   // (the first tap had started an overdub: take it back)
        if (first.prev === "empty" || first.prev === "armed") clear(i);
        stopAll();
      });
      return "stopAll";
    }
    pedalLast = { at: now, prev: prev, i: i };
    if (!(info && info.from)) holdTimer = setTimeout(function () { var b = pedalLast.busy; pedalLast.at = 0; Promise.resolve(b).then(function () { clear(i); }); }, HOLD_MS);   // (a footswitch: held down)
    pedalLast.busy = main(i).catch(function () { }); return "main";
  }
  function pedalRelease() { clearTimeout(holdTimer); }

  // ------------------------------------------------------------------ what other screens get (3.5" screen, HDMI copy)
  function summary() {
    var c = cfg(), ctx = PP.engine.ctx, rate = ctx ? ctx.sampleRate : 48000;
    return { on: c.enabled !== false, sel: c.sel, mode: mode(), bars: c.bars, countIn: !!c.countIn, playing: anyPlaying(),
      tracks: st.tracks.map(function (t, i) { var k = c.tracks[i], f = pos[i] || 0, b = meta[i].bars || barsOf(t.len); return { s: t.s, secs: Math.round(t.len / rate * 10) / 10, f: Math.round((f < 0 ? -f - 1 : f) * 1000) / 1000, rec: f < 0, bars: b || null, bar: b && t.len ? Math.min(b, Math.floor((f < 0 ? 0 : f) * b) + 1) : null, undo: !!t.u, redo: !!t.r, level: k.level, pan: k.pan, mute: !!k.mute, rev: !!k.rev, half: !!k.half, src: k.src }; }) };
  }
  var dispTimer = 0;
  function displaySoon() { clearTimeout(dispTimer); dispTimer = setTimeout(function () { if (T() && T().sendDisplay) T().sendDisplay(); }, 30); }
  // while loops play, the 3.5" screen's rings move (4 times a second; the tracks already send more when they play)
  setInterval(function () { if (!node || !anyPlaying()) return; if (T() && T().isPlaying && T().isPlaying()) return; displaySoon(); }, 250);

  // ------------------------------------------------------------------ the LOOPER tab
  var LABEL = { empty: "REC", armed: "WAIT…", recording: "● REC", playing: "▶ PLAY", dubbing: "● DUB", stopped: "■ STOP" };
  var NEXT = { empty: "record", armed: "cancel", recording: "close the loop", playing: "overdub", dubbing: "play", stopped: "play" };
  var MODES = [["auto", "Auto", "in time with the song when it plays, free when not"], ["song", "Tempo", "always N bars at the tempo"], ["free", "Free", "tap to start, tap to close"]];
  function ring(i, f, cls) {
    var r = 46, C = 2 * Math.PI * r;
    return '<svg class="lp-ring" viewBox="0 0 110 110" aria-hidden="true"><circle cx="55" cy="55" r="' + r + '" class="lp-ring-bg"/><circle cx="55" cy="55" r="' + r + '" class="lp-ring-fg ' + cls + '" data-lpring="' + i + '" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + (C * (1 - (f || 0))).toFixed(1) + '"/></svg>';
  }
  function trackCard(i) {
    var c = cfg(), k = c.tracks[i], t = st.tracks[i] || { s: "empty" }, sm = summary().tracks[i], sel = c.sel === i;
    var sub = t.s === "empty" ? "empty" : (sm.bars ? sm.bars + " bar" + (sm.bars === 1 ? "" : "s") : sm.secs + " s") + (t.s === "armed" ? " · waiting for the bar" : "");
    return '<div class="lp-track st-' + t.s + (sel ? " sel" : "") + (k.mute ? " muted" : "") + '" data-lptrack="' + i + '">' +
      '<div class="lp-head"><button class="lp-num" data-lp="select" data-i="' + i + '" title="The main switch works this loop">LOOP ' + (i + 1) + (sel ? " ●" : "") + '</button><span class="lp-sub" data-lpsub="' + i + '">' + esc(sub) + "</span></div>" +
      '<div class="lp-ringbox">' + ring(i, sm.f, "st-" + t.s) + '<button class="lp-big" data-lp="main" data-i="' + i + '"><b>' + LABEL[t.s] + "</b><small>" + esc(NEXT[t.s]) + '</small><em data-lpbar="' + i + '">' + (sm.bar ? "bar " + sm.bar + " / " + sm.bars : "") + "</em></button></div>" +
      '<div class="lp-row"><button data-lp="stopPlay" data-i="' + i + '"' + (t.len ? "" : " disabled") + ">" + (t.s === "stopped" ? "▶ PLAY" : "■ STOP") + '</button><button data-lp="undo" data-i="' + i + '"' + (t.u ? "" : " disabled") + '>UNDO</button><button data-lp="redo" data-i="' + i + '"' + (t.r ? "" : " disabled") + '>REDO</button><button data-lp="clear" data-i="' + i + '"' + (t.s === "empty" ? " disabled" : "") + ">CLEAR</button></div>" +
      '<div class="lp-row"><button class="tg' + (k.mute ? " on" : "") + '" data-lp="mute" data-i="' + i + '">MUTE</button><button class="tg' + (k.rev ? " on" : "") + '" data-lp="rev" data-i="' + i + '">REVERSE</button><button class="tg' + (k.half ? " on" : "") + '" data-lp="half" data-i="' + i + '">½ SPEED</button></div>' +
      '<label class="lp-slider">Level<input type="range" data-lplevel="' + i + '" min="0" max="140" value="' + Math.round(k.level * 100) + '"><output>' + Math.round(k.level * 100) + "</output></label>" +
      '<label class="lp-slider">Pan<input type="range" data-lppan="' + i + '" min="-100" max="100" value="' + Math.round(k.pan * 100) + '"><output>' + panText(k.pan) + "</output></label>" +
      '<label class="lp-src">Records<select data-lpsrc="' + i + '">' + Object.keys(SRC_NAMES).map(function (s) { return '<option value="' + s + '"' + (k.src === s ? " selected" : "") + ">" + SRC_NAMES[s] + "</option>"; }).join("") + "</select></label></div>";
  }
  function panText(p) { var n = Math.round(Math.abs(p) * 100); return n < 2 ? "C" : (p < 0 ? "L " : "R ") + n; }
  function tabHtml() {
    var c = cfg();
    if (c.enabled === false) return '<div class="lp-off"><h2>Looper</h2><p class="muted">The looper is off.</p><label class="toggle"><input type="checkbox" data-lpset="enabled"> Looper on</label></div>';
    var m = mode();
    return '<div class="lp-top"><h2>Looper</h2>' +
      '<div class="lp-modes">' + MODES.map(function (x) { return '<button class="' + (m === x[0] ? "on" : "") + '" data-lpmode="' + x[0] + '" title="' + esc(x[2]) + '">' + x[1] + "</button>"; }).join("") + "</div>" +
      '<label class="lp-bars">Length<select data-lpset="bars">' + [1, 2, 4, 8, 16].map(function (b) { return '<option value="' + b + '"' + (c.bars === b ? " selected" : "") + ">" + b + " bar" + (b === 1 ? "" : "s") + "</option>"; }).join("") + "</select></label>" +
      '<label class="toggle"><input type="checkbox" data-lpset="countIn"' + (c.countIn ? " checked" : "") + "> Count-in (one bar of clicks)</label>" +
      '<label class="toggle lp-onoff"><input type="checkbox" data-lpset="enabled" checked> Looper on</label></div>' +
      '<p class="muted small lp-help">' + esc(MODES.filter(function (x) { return x[0] === m; })[0][2]) + ". The first loop sets the length; the others close on a whole number of it and stay in step. The tracks and pads keep playing.</p>" +
      '<div class="lp-tracks">' + [0, 1, 2].map(trackCard).join("") + "</div>" +
      '<div class="lp-all"><button class="lp-allbtn" data-lp="playAll">▶ PLAY ALL</button><button class="lp-allbtn" data-lp="stopAll">■ STOP ALL</button><button class="lp-allbtn danger" data-lp="clearAll">CLEAR ALL</button></div>' +
      '<p class="muted small">One footswitch can run it like a looper pedal: Configure → "Looper pedal" (tap: record / play / overdub · double tap: stop all · hold: clear). Each loop also has its own actions, and knobs / sliders can set each loop\'s level. The loops play on the Looper output (Settings → Output routing; the instrument\'s output unless you pick another).</p>';
  }
  function renderTab() { var root = $("#looperRoot"); if (root) root.innerHTML = tabHtml(); }
  // the strip on the Instrument tab: the main switch of the selected loop, and the way to the LOOPER tab
  function html() {
    var c = cfg(), i = c.sel, t = st.tracks[i] || { s: "empty" };
    if (c.enabled === false) return '<section class="looper off" id="looperBox"><div class="row spread"><h3>Looper <small class="muted">off</small></h3><button data-lp="goTab">LOOPER tab ›</button></div></section>';
    return '<section class="looper" id="looperBox"><div class="row spread"><h3>Looper <small class="muted">' + (st.tracks.every(function (x) { return x.s === "empty"; }) ? "all three loops are empty" : st.tracks.map(function (x, j) { return "loop " + (j + 1) + ": " + (x.s === "empty" ? "empty" : x.s); }).join(" · ")) + '</small></h3><button data-lp="goTab">LOOPER tab ›</button></div>' +
      '<div class="lp-btns"><button class="pf-btn lp-main st-' + t.s + '" id="lpMain" data-lp="main" data-i="' + i + '"><small>LOOP ' + (i + 1) + " · REC / PLAY / DUB</small><b>" + LABEL[t.s] + '</b></button><button class="pf-btn" data-lp="stopAll"><small>EVERY LOOP</small><b>STOP</b></button><button class="pf-btn" data-lp="undo" data-i="' + i + '"' + (t.u ? "" : " disabled") + '><small>LAST DUB</small><b>UNDO</b></button><button class="pf-btn" data-lp="clear" data-i="' + i + '"><small>LOOP ' + (i + 1) + "</small><b>CLEAR</b></button></div></section>";
  }
  function render() {
    var box = $("#looperBox"); if (box) { var d = document.createElement("div"); d.innerHTML = html(); box.replaceWith(d.firstChild); }
    var root = $("#looperRoot"); if (root && !root.closest(".hidden") && !dragging) renderTab();
  }
  function paintRings() {   // just the rings and bar counts (no redraw), ~10 times a second while something plays
    var sm = summary();
    sm.tracks.forEach(function (t, i) {
      var el = document.querySelector('[data-lpring="' + i + '"]'); if (el) { var C = Number(el.getAttribute("stroke-dasharray")); el.setAttribute("stroke-dashoffset", (C * (1 - t.f)).toFixed(1)); }
      var b = document.querySelector('[data-lpbar="' + i + '"]'); if (b) b.textContent = t.bar ? "bar " + t.bar + " / " + t.bars : t.rec ? Math.round(t.f * 100) + "%" : "";
    });
  }
  function paintLevels() { cfg().tracks.forEach(function (k, i) { var r = document.querySelector('[data-lplevel="' + i + '"]'); if (r) { r.value = Math.round(k.level * 100); r.parentNode.querySelector("output").textContent = r.value; } }); }
  var dragging = false;
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-lp],[data-lpmode]"); if (!b) return;
    if (!b.closest("#looperRoot,#looperBox")) return;
    if (b.dataset.lpmode) { setMode(b.dataset.lpmode); return; }
    var i = b.dataset.i != null ? Number(b.dataset.i) : null, a = b.dataset.lp;
    if (a === "goTab") { if (window.PPShell) window.PPShell.showTab("looper"); return; }
    if (a === "main") main(i); else if (a === "select") select(i); else if (a === "stopPlay") stopPlay(i); else if (a === "undo") undo(i); else if (a === "redo") redo(i); else if (a === "clear") clear(i);
    else if (a === "mute" || a === "rev" || a === "half") toggleTrack(i, a);
    else if (a === "playAll") playAll(); else if (a === "stopAll") stopAll(); else if (a === "clearAll") clearAll();
  });
  document.addEventListener("change", function (e) {
    var el = e.target; if (!el.closest || !el.closest("#looperRoot,#looperBox")) return; var c = cfg();
    if (el.dataset.lpset === "enabled") { c.enabled = el.checked; PP.persistSoon(); if (!c.enabled) { clearAll(); if (armedFlag) arm(false); } render(); renderTab(); return; }
    if (el.dataset.lpset === "bars") setBars(Number(el.value));
    else if (el.dataset.lpset === "countIn") { c.countIn = el.checked; PP.persistSoon(); displaySoon(); }
    else if (el.dataset.lpsrc != null) setTrack(Number(el.dataset.lpsrc), "src", el.value);
  });
  document.addEventListener("input", function (e) {
    var el = e.target; if (!el.dataset) return;
    if (el.dataset.lplevel != null) { dragging = true; var i = Number(el.dataset.lplevel), t = cfg().tracks[i]; t.level = Number(el.value) / 100; pushTrack(i); PP.persistSoon(); el.parentNode.querySelector("output").textContent = el.value; }
    else if (el.dataset.lppan != null) { dragging = true; var j = Number(el.dataset.lppan), k = cfg().tracks[j]; k.pan = Number(el.value) / 100; pushTrack(j); PP.persistSoon(); el.parentNode.querySelector("output").textContent = panText(k.pan); }
  });
  document.addEventListener("pointerup", function () { if (dragging) { dragging = false; displaySoon(); } });

  // old single-loop API (actions, tests): loop 1
  function applyConfig() { cfg(); for (var i = 0; i < N; i++) pushTrack(i); render(); displaySoon(); }
  function state() { var t = st.tracks[0] || {}; return { state: t.s || "empty", len: t.len || 0, undo: !!t.u, redo: !!t.r }; }
  window.PPLooper = {
    html: html, render: render, renderTab: renderTab, main: function (i) { return main(i == null ? 0 : i); }, stop: function (i) { stop(i == null ? 0 : i); }, play: function (i) { play(i == null ? 0 : i); },
    undo: function (i) { undo(i == null ? 0 : i); }, redo: function (i) { redo(i == null ? 0 : i); }, clear: function (i) { clear(i == null ? 0 : i); }, stopPlay: stopPlay,
    track: function (i) { return main(i); }, trackStop: stop, trackStopPlay: stopPlay, trackUndo: undo, trackRedo: redo, trackClear: clear, toggle: toggleTrack, setPan: setPan, stepSource: stepSource,
    stopAll: stopAll, playAll: playAll, clearAll: clearAll, select: select, selectStep: selectStep, selected: function () { return cfg().sel; },
    setMode: setMode, stepMode: stepMode, mode: mode, setBars: setBars, stepBars: stepBars, cycleBars: cycleBars, toggleCountIn: toggleCountIn,
    pedalPress: pedalPress, pedalRelease: pedalRelease, plan: plan, summary: summary, stateOf: function (i) { return stateOf(i); }, tracks: function () { return st.tracks; },
    arm: arm, armed: function () { return armedFlag; }, applyConfig: applyConfig, state: state, useNode: useNode, setLevel: setLevel, config: cfg, anyPlaying: anyPlaying, LABEL: LABEL
  };
})();
