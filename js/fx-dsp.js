/* Central Pedal - track effects, rendered offline (runs in a Web Worker, loaded from a data: URL).
 *
 * A track (stem) with effects on is processed once, here, into a new copy that the player then plays instead of the
 * original. Nothing runs on the audio thread while the song plays, so a Pi 4 can have effects on every track: the
 * key / tempo shifter, the direct outs and the send to Central Control all get the processed track for free.
 *
 *   gate -> EQ (low cut, low, mid, high; Central Plugins: four parametric bands + high cut) -> compressor
 *        -> + reverb (room; Central Plugins: hall, plate, cathedral) + delay (1/4, 1/8; Central Plugins: dotted,
 *          1/2, 1/16, ping-pong, darker repeats)
 *
 * window.PP_FX_CORE() returns the plain functions (the tests use them directly); window.PP_FX_DSP is the worker.
 */
window.PP_FX_CORE = function () {
  function dbToGain(db) { return Math.pow(10, db / 20); }
  function clamp(v, a, b) { v = Number(v); return isFinite(v) ? Math.max(a, Math.min(b, v)) : a; }

  // RBJ cookbook biquad -> {b0,b1,b2,a1,a2}
  function coeffs(type, freq, gainDb, q, rate) {
    var w = 2 * Math.PI * clamp(freq, 10, rate * 0.45) / rate, cos = Math.cos(w), sin = Math.sin(w), Q = clamp(q || 0.707, 0.1, 18), alpha = sin / (2 * Q), A = Math.pow(10, (gainDb || 0) / 40), b0, b1, b2, a0, a1, a2;
    if (type === "highpass") { b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = b0; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha; }
    else if (type === "lowpass") { b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = b0; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha; }
    else if (type === "lowshelf" || type === "highshelf") {
      var sq = 2 * Math.sqrt(A) * (sin / 2 * Math.SQRT2);   // shelf slope S = 1
      if (type === "lowshelf") { b0 = A * ((A + 1) - (A - 1) * cos + sq); b1 = 2 * A * ((A - 1) - (A + 1) * cos); b2 = A * ((A + 1) - (A - 1) * cos - sq); a0 = (A + 1) + (A - 1) * cos + sq; a1 = -2 * ((A - 1) + (A + 1) * cos); a2 = (A + 1) + (A - 1) * cos - sq; }
      else { b0 = A * ((A + 1) + (A - 1) * cos + sq); b1 = -2 * A * ((A - 1) + (A + 1) * cos); b2 = A * ((A + 1) + (A - 1) * cos - sq); a0 = (A + 1) - (A - 1) * cos + sq; a1 = 2 * ((A - 1) - (A + 1) * cos); a2 = (A + 1) - (A - 1) * cos - sq; }
    } else { b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A; }   // peaking
    return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
  }

  // the EQ bands an effect setting asks for (flat ones are left out: they cost nothing)
  function eqBands(eq, pro) {
    var out = [];
    if (!eq || !eq.on) return out;
    if (eq.lowCut > 25) out.push(["highpass", eq.lowCut, 0, 0.707]);
    if (Math.abs(eq.low || 0) > 0.05) out.push(["lowshelf", eq.lowFreq || 120, eq.low, 0.707]);
    if (Math.abs(eq.mid || 0) > 0.05) out.push(["peaking", eq.midFreq || 1000, eq.mid, eq.midQ || 0.9]);
    if (Math.abs(eq.high || 0) > 0.05) out.push(["highshelf", eq.highFreq || 6000, eq.high, 0.707]);
    if (pro) {
      (eq.bands || []).forEach(function (b) { if (b && b.on && Math.abs(b.gain || 0) > 0.05) out.push(["peaking", b.freq || 1000, b.gain, b.q || 1]); });
      if (eq.highCut && eq.highCut < 19000) out.push(["lowpass", eq.highCut, 0, 0.707]);
    }
    return out;
  }

  // the compressor's settings: basic = one "amount" knob, Central Plugins = every control
  function compParams(c, pro) {
    if (!c || !c.on) return null;
    if (pro && c.mode === "full") {
      var th = clamp(c.threshold, -60, 0), ra = clamp(c.ratio, 1, 20);
      return { threshold: th, ratio: ra, knee: clamp(c.knee == null ? 6 : c.knee, 0, 24), attack: clamp(c.attack == null ? 10 : c.attack, 0.1, 300), release: clamp(c.release == null ? 150 : c.release, 10, 3000), makeup: clamp(c.makeup || 0, -12, 24) };
    }
    var a = clamp(c.amount == null ? 40 : c.amount, 0, 100), t = -6 - 0.24 * a, r = 1.5 + a * 0.035;
    return { threshold: t, ratio: r, knee: 6, attack: 10, release: 150, makeup: -t * (1 - 1 / r) * 0.5 };
  }
  function gateParams(g, pro) {
    if (!g || !g.on) return null;
    var p = { threshold: clamp(g.threshold == null ? -45 : g.threshold, -80, 0), range: -80, attack: 1, hold: 40, release: 120 };
    if (pro && g.mode === "full") { p.range = clamp(g.range == null ? -80 : g.range, -80, 0); p.attack = clamp(g.attack == null ? 1 : g.attack, 0.1, 50); p.hold = clamp(g.hold == null ? 40 : g.hold, 0, 500); p.release = clamp(g.release == null ? 120 : g.release, 5, 2000); }
    return p;
  }
  var REVERBS = {   // [comb count, feedback, damping, pre-delay ms, brightness]
    room: [4, 0.74, 0.35, 8, 1], hall: [8, 0.84, 0.3, 24, 1], plate: [8, 0.8, 0.12, 6, 1.15], cathedral: [8, 0.9, 0.38, 40, 0.9]
  };
  var PRO_REVERBS = { hall: 1, plate: 1, cathedral: 1 };
  function reverbParams(rv, pro) {
    if (!rv || !rv.on || !(rv.send > 0)) return null;
    var type = REVERBS[rv.type] && (pro || !PRO_REVERBS[rv.type]) ? rv.type : "room", d = REVERBS[type];
    return { type: type, combs: d[0], feedback: Math.min(0.97, d[1] + (pro ? clamp(rv.size == null ? 0 : rv.size, -50, 50) / 50 * 0.06 : 0)), damp: d[2], pre: d[3], bright: d[4], send: clamp(rv.send, 0, 100) / 100 };
  }
  var DIVS = { "1/4": 1, "1/8": 0.5, "1/2": 2, "1/16": 0.25, "1/4.": 1.5, "1/8.": 0.75 }, BASIC_DIVS = { "1/4": 1, "1/8": 1 };
  function delayParams(dl, pro, bpm) {
    if (!dl || !dl.on || !(dl.send > 0)) return null;
    var div = DIVS[dl.time] && (pro || BASIC_DIVS[dl.time]) ? dl.time : "1/4", beat = 60 / clamp(bpm || 72, 30, 300);
    return { seconds: Math.min(2.5, beat * DIVS[div]), feedback: clamp(dl.feedback == null ? 30 : dl.feedback, 0, pro ? 90 : 60) / 100, send: clamp(dl.send, 0, 100) / 100,
      pingpong: !!(pro && dl.pingpong), tone: pro && dl.tone ? clamp(dl.tone, 800, 16000) : 9000 };
  }

  // everything a stem's effects will do (what the worker runs; also what the cache key is made of)
  function plan(fx, pro, bpm) {
    if (!fx || !fx.on) return null;
    var p = { gate: gateParams(fx.gate, pro), eq: eqBands(fx.eq, pro), comp: compParams(fx.comp, pro), reverb: reverbParams(fx.reverb, pro), delay: delayParams(fx.delay, pro, bpm), out: dbToGain(clamp(fx.trim || 0, -24, 12)) };
    if (!p.gate && !p.eq.length && !p.comp && !p.reverb && !p.delay && p.out === 1) return null;
    return p;
  }

  // process: L, R Int16Array (R may be null = mono); returns {L, R} Int16Array (R null when the result is mono)
  function processStem(L, R, n, rate, p, progress) {
    var stereoOut = !!R || !!(p.reverb || (p.delay && p.delay.pingpong)), outL = new Int16Array(n), outR = stereoOut ? new Int16Array(n) : null;
    var k = 1 / 32768, i, j;
    // EQ state per band per channel (transposed direct form II)
    var bands = p.eq.map(function (b) { var c = coeffs(b[0], b[1], b[2], b[3], rate); return { c: c, z1L: 0, z2L: 0, z1R: 0, z2R: 0 }; }), nb = bands.length;
    // gate
    var g = p.gate, gThr = g ? dbToGain(g.threshold) : 0, gFloor = g ? dbToGain(g.range) : 1, gAtt = g ? 1 - Math.exp(-1 / (rate * g.attack / 1000)) : 0, gRel = g ? 1 - Math.exp(-1 / (rate * g.release / 1000)) : 0, gHold = g ? Math.round(rate * g.hold / 1000) : 0, gEnv = 0, gGain = g ? gFloor : 1, gHeld = 0;
    var envA = 1 - Math.exp(-1 / (rate * 0.0005)), envR = 1 - Math.exp(-1 / (rate * 0.05));
    // compressor
    var c = p.comp, cAtt = c ? Math.exp(-16 / (rate * c.attack / 1000)) : 0, cRel = c ? Math.exp(-16 / (rate * c.release / 1000)) : 0, cPk = 0, cCount = 0, cStep = 0, cEnvDb = 0, cMake = c ? dbToGain(c.makeup) : 1, cg = cMake, cKnee = c ? c.knee : 0;
    // reverb: one comb bank on the mono sum, two allpass chains (one per side) for width
    var rv = p.reverb, combs = [], apL = [], apR = [], preBuf = null, preLen = 0, preIdx = 0;
    if (rv) {
      var sc = rate / 44100, CL = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].slice(0, rv.combs), AL = [556, 441, 341, 225], AR = [579, 464, 364, 248];
      combs = CL.map(function (len) { len = Math.round(len * sc * (rv.type === "cathedral" ? 1.35 : rv.type === "room" ? 0.8 : 1)); return { buf: new Float32Array(len), len: len, idx: 0, store: 0 }; });
      apL = AL.map(function (len) { len = Math.round(len * sc); return { buf: new Float32Array(len), len: len, idx: 0 }; });
      apR = AR.map(function (len) { len = Math.round(len * sc); return { buf: new Float32Array(len), len: len, idx: 0 }; });
      preLen = Math.max(1, Math.round(rate * rv.pre / 1000)); preBuf = new Float32Array(preLen);
    }
    var rvGain = rv ? rv.send * 0.06 * rv.bright / Math.sqrt(rv.combs / 4) : 0, damp = rv ? rv.damp : 0, fb = rv ? rv.feedback : 0, nComb = combs.length;
    // delay
    var dl = p.delay, dLen = dl ? Math.max(1, Math.round(dl.seconds * rate)) : 0, dBufL = dl ? new Float32Array(dLen) : null, dBufR = dl ? new Float32Array(dLen) : null, dIdx = 0, dToneA = dl ? 1 - Math.exp(-2 * Math.PI * dl.tone / rate) : 0, dLpL = 0, dLpR = 0;
    var out = p.out, step = 1 << 21;
    for (i = 0; i < n; i++) {
      var xl = L[i] * k, xr = R ? R[i] * k : xl;
      if (g) {   // gate: opens fast above the threshold, holds, then closes to the floor
        var lv = xl < 0 ? -xl : xl, lr = xr < 0 ? -xr : xr; if (lr > lv) lv = lr;
        gEnv += (lv > gEnv ? envA : envR) * (lv - gEnv);
        if (gEnv > gThr) { gHeld = gHold; gGain += gAtt * (1 - gGain); } else if (gHeld > 0) { gHeld--; } else { gGain += gRel * (gFloor - gGain); }
        xl *= gGain; xr *= gGain;
      }
      for (j = 0; j < nb; j++) {
        var b = bands[j], cc = b.c, yl = cc.b0 * xl + b.z1L; b.z1L = cc.b1 * xl - cc.a1 * yl + b.z2L; b.z2L = cc.b2 * xl - cc.a2 * yl; xl = yl;
        if (R) { var yr = cc.b0 * xr + b.z1R; b.z1R = cc.b1 * xr - cc.a1 * yr + b.z2R; b.z2R = cc.b2 * xr - cc.a2 * yr; xr = yr; } else xr = xl;
      }
      if (c) {   // feed-forward compressor, soft knee, on the louder side (both sides get the same gain); the gain is
        // worked out every 16 samples and glided in between (a third of a millisecond - the log/pow is the slow part)
        var pk = xl < 0 ? -xl : xl, pr = xr < 0 ? -xr : xr; if (pr > pk) pk = pr; if (pk > cPk) cPk = pk;
        if (--cCount <= 0) {
          var inDb = cPk > 1e-6 ? 20 * Math.log10(cPk) : -120, over = inDb - c.threshold, red;
          if (2 * over < -cKnee) red = 0; else if (2 * Math.abs(over) <= cKnee) red = (1 / c.ratio - 1) * (over + cKnee / 2) * (over + cKnee / 2) / (2 * cKnee || 1); else red = (1 / c.ratio - 1) * over;
          cEnvDb = red < cEnvDb ? cAtt * cEnvDb + (1 - cAtt) * red : cRel * cEnvDb + (1 - cRel) * red;
          cStep = (Math.pow(10, cEnvDb / 20) * cMake - cg) / 16; cCount = 16; cPk = 0;
        }
        cg += cStep; xl *= cg; xr *= cg;
      }
      var ol = xl, or = xr;
      if (rv) {
        var mono = (xl + xr) * 0.5 * rvGain, pd = preBuf[preIdx]; preBuf[preIdx] = mono; preIdx = preIdx + 1 === preLen ? 0 : preIdx + 1;
        var sum = 0;
        for (j = 0; j < nComb; j++) { var cb = combs[j], o = cb.buf[cb.idx]; cb.store = o * (1 - damp) + cb.store * damp; cb.buf[cb.idx] = pd + cb.store * fb; cb.idx = cb.idx + 1 === cb.len ? 0 : cb.idx + 1; sum += o; }
        var wl = sum, wr = sum;
        for (j = 0; j < 4; j++) { var a = apL[j], bo = a.buf[a.idx]; a.buf[a.idx] = wl + bo * 0.5; a.idx = a.idx + 1 === a.len ? 0 : a.idx + 1; wl = bo - wl; var a2 = apR[j], bo2 = a2.buf[a2.idx]; a2.buf[a2.idx] = wr + bo2 * 0.5; a2.idx = a2.idx + 1 === a2.len ? 0 : a2.idx + 1; wr = bo2 - wr; }
        ol += wl; or += wr;
      }
      if (dl) {   // tempo delay; ping-pong bounces the repeats left - right
        var dL = dBufL[dIdx], dR = dBufR[dIdx], inD = (xl + xr) * 0.5 * dl.send;
        dLpL += dToneA * (dL - dLpL); dLpR += dToneA * (dR - dLpR);
        if (dl.pingpong) { dBufL[dIdx] = inD + dLpR * dl.feedback; dBufR[dIdx] = dLpL * dl.feedback; ol += dL; or += dR; }
        else { dBufL[dIdx] = inD + dLpL * dl.feedback; ol += dL; or += dL; }
        dIdx = dIdx + 1 === dLen ? 0 : dIdx + 1;
      }
      ol *= out; or *= out;
      var sl = ol * 32767; outL[i] = sl > 32767 ? 32767 : sl < -32768 ? -32768 : sl;
      if (outR) { var sr = or * 32767; outR[i] = sr > 32767 ? 32767 : sr < -32768 ? -32768 : sr; }
      if (progress && (i & (step - 1)) === 0 && i) progress(i / n);
    }
    return { L: outL, R: outR };
  }
  return { coeffs: coeffs, eqBands: eqBands, compParams: compParams, gateParams: gateParams, reverbParams: reverbParams, delayParams: delayParams, plan: plan, processStem: processStem, REVERBS: REVERBS, DIVS: DIVS };
};

window.PP_FX_DSP = function () {
  var core = null;
  self.onmessage = function (e) {
    var m = e.data;
    try {
      if (!core) core = self.PP_FX_CORE();
      var L = new Int16Array(m.L), R = m.R ? new Int16Array(m.R) : null, t0 = Date.now();
      var r = core.processStem(L, R, m.length, m.rate, m.plan, function (f) { self.postMessage({ id: m.id, progress: f }); });
      var transfer = [r.L.buffer]; if (r.R) transfer.push(r.R.buffer);
      self.postMessage({ id: m.id, result: { L: r.L.buffer, R: r.R ? r.R.buffer : null, length: m.length, rate: m.rate, ms: Date.now() - t0 } }, transfer);
    } catch (error) { self.postMessage({ id: m.id, error: String(error && error.message || error) }); }
  };
};
