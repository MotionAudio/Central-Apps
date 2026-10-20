/* Pad Pedal - live graphics for every effect, output meters and spectrum.
 * Everything drawn here is computed from the real audio objects: filter curves
 * come from the browser's own biquad maths (getFrequencyResponse), meters and
 * scopes from AnalyserNodes on the actual output, the compressor dot from the
 * signal entering that pad's compressor. */
(function () {
  "use strict";
  var PP = window.PP;
  if (!PP) return;
  var engine = PP.engine, clamp = PP.clamp;
  var lastFrame = 0, grHistory = new Float32Array(300), grPos = 0;
  var peakHold = { L: -60, R: -60 }, clipState = 0; // 0 ok, 1 hot (limiter working hard), 2 clipped
  var gctx = null, apPool = [];

  function css(name, fallback) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback; }
  function colors() { return { accent: css("--accent", "#e2c27e"), blue: css("--blue", "#8db5de"), text: css("--text", "#ece7dd"), muted: css("--muted", "#9aa1ab"), grid: "rgba(151,184,209,.16)", label: "rgba(185,210,230,.7)", danger: css("--danger", "#ff7878") }; }
  function graphCtx() { if (!gctx) { try { gctx = new OfflineAudioContext(1, 128, 48000); } catch (_) { gctx = null; } } return gctx; }
  function liveVoice() { var p = PP.currentPad(); if (p.isInput) return engine.inputVoice; return engine.voices().filter(function (v) { return v.pad.id === p.id; })[0] || null; }
  function voicePhase(voice, rate) { if (!voice || !engine.ctx) return (performance.now() / 1000 * rate) % 1; return (((engine.ctx.currentTime - voice.startedAt) * rate) % 1 + 1) % 1; }
  function wave(shape, ph) { ph = ((ph % 1) + 1) % 1; if (shape === "triangle") return ph < .25 ? ph * 4 : ph < .75 ? 2 - ph * 4 : ph * 4 - 4; if (shape === "square") return ph < .5 ? 1 : -1; if (shape === "sawtooth") return ph < .5 ? ph * 2 : ph * 2 - 2; return Math.sin(ph * 2 * Math.PI); }
  function fmtHz(f) { return f >= 1000 ? (f / 1000).toFixed(f >= 10000 ? 0 : 1) + "k" : Math.round(f) + ""; }
  function text(ctx, str, x, y, color, align, font) { ctx.fillStyle = color; ctx.font = font || "11px system-ui"; ctx.textAlign = align || "left"; ctx.fillText(str, x, y); ctx.textAlign = "left"; }
  function line(ctx, pts, color, width, dash) { ctx.beginPath(); pts.forEach(function (p, i) { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }); ctx.strokeStyle = color; ctx.lineWidth = width || 2; ctx.setLineDash(dash || []); ctx.stroke(); ctx.setLineDash([]); }
  function offLabel(ctx, w, h, on, c) { if (!on) text(ctx, "OFF", w - 12, 18, c.muted, "right", "bold 11px system-ui"); }
  function freqAxis(ctx, w, h, xFor, c) { ctx.strokeStyle = c.grid; ctx.lineWidth = 1; [50, 100, 200, 500, 1000, 2000, 5000, 10000].forEach(function (f) { var x = xFor(f); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); text(ctx, fmtHz(f), x + 2, h - 5, c.label); }); }
  function logX(w, lo, hi) { return function (f) { return 8 + Math.log(f / lo) / Math.log(hi / lo) * (w - 16); }; }
  function dbY(h, top, bottom) { return function (db) { return 8 + (top - clamp(db, bottom, top)) / (top - bottom) * (h - 26); }; }
  function rmsDb(analyser) { if (!analyser) return -90; var buf = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(buf); var sum = 0, peak = 0; for (var i = 0; i < buf.length; i++) { sum += buf[i] * buf[i]; peak = Math.max(peak, Math.abs(buf[i])); } return { rms: 10 * Math.log10(sum / buf.length + 1e-12), peak: 20 * Math.log10(peak + 1e-12), peakLin: peak }; }

  var drawers = {
    // Compressor: static curve (what the settings do) + live dot (where the signal is now)
    compCurve: function (ctx, w, h, fx, c) {
      var s = PP.compSettings(fx.compressor), on = fx.compressor.enabled, pad = 30;
      var X = function (db) { return pad + (db + 60) / 60 * (w - pad - 10); }, Y = function (db) { return 10 + (0 - clamp(db, -60, 0)) / 60 * (h - 36); };
      ctx.strokeStyle = c.grid; ctx.lineWidth = 1;
      for (var db = -60; db <= 0; db += 12) { ctx.beginPath(); ctx.moveTo(X(db), Y(0)); ctx.lineTo(X(db), Y(-60)); ctx.moveTo(X(-60), Y(db)); ctx.lineTo(X(0), Y(db)); ctx.stroke(); text(ctx, db, X(db) - 6, h - 12, c.label); text(ctx, db, 4, Y(db) + 4, c.label); }
      line(ctx, [[X(-60), Y(-60)], [X(0), Y(0)]], c.muted, 1, [4, 4]);
      var pts = []; for (var x = -60; x <= 0; x += .5) pts.push([X(x), Y(on ? PP.compOutDb(s, x) : x)]);
      line(ctx, pts, on ? c.accent : c.muted, 2.6);
      if (on) { ctx.strokeStyle = "rgba(255,207,102,.55)"; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(X(s.threshold), Y(0)); ctx.lineTo(X(s.threshold), Y(-60)); ctx.stroke(); ctx.setLineDash([]); text(ctx, "threshold", X(s.threshold) + 4, 40, "#ffcf66"); }
      var v = liveVoice();
      if (v && on) { var lvl = rmsDb(v.compMeter).rms; if (lvl > -60) { var out = PP.compOutDb(s, lvl); ctx.beginPath(); ctx.arc(X(lvl), Y(out), 6, 0, Math.PI * 2); ctx.fillStyle = "#fff"; ctx.fill(); ctx.strokeStyle = c.accent; ctx.lineWidth = 2; ctx.stroke(); } }
      text(ctx, (PP.COMP_TYPES[s.type] || {}).label + (on ? "  ·  " + s.ratio.toFixed(1) + ":1  ·  " + Math.round(s.attack) + " / " + Math.round(s.release) + " ms  ·  mix " + Math.round(s.mix) + "%" : ""), pad + 4, 22, c.text, "left", "bold 11px system-ui");
      text(ctx, "in (dB) →", w - 12, h - 26, c.muted, "right");
    },
    compHistory: function (ctx, w, h, fx, c) {
      var Y = function (db) { return 8 + db / 24 * (h - 30); };
      ctx.strokeStyle = c.grid; [0, 6, 12, 18, 24].forEach(function (db) { ctx.beginPath(); ctx.moveTo(0, Y(db)); ctx.lineTo(w, Y(db)); ctx.stroke(); text(ctx, "-" + db, 4, Y(db) + 11, c.label); });
      ctx.beginPath(); ctx.moveTo(w, Y(0));
      for (var i = 0; i < grHistory.length; i++) { var idx = (grPos + i) % grHistory.length; ctx.lineTo(i / (grHistory.length - 1) * w, Y(Math.min(24, grHistory[idx]))); }
      ctx.lineTo(w, Y(0)); ctx.closePath(); ctx.fillStyle = "rgba(255,120,120,.28)"; ctx.fill(); ctx.strokeStyle = c.danger; ctx.lineWidth = 1.5; ctx.stroke();
      text(ctx, "gain reduction (last 10 s)", w - 8, h - 8, c.muted, "right");
    },
    drive: function (ctx, w, h, fx, c) {
      var d = fx.drive, amt = clamp(d.amount, 0, 100), curve = PP.shaperCurve(d.type, amt), pre = d.type === "lofi" ? 1 : 1 + amt / 25, post = d.type === "lofi" ? 1 : 1 / (1 + amt / 30), mix = clamp(d.mix, 0, 100) / 100;
      var X = function (v) { return w / 2 + v * (w / 2 - 14); }, Y = function (v) { return h / 2 - v * (h / 2 - 14); };
      ctx.strokeStyle = c.grid; ctx.beginPath(); ctx.moveTo(X(-1), Y(0)); ctx.lineTo(X(1), Y(0)); ctx.moveTo(X(0), Y(-1)); ctx.lineTo(X(0), Y(1)); ctx.stroke();
      line(ctx, [[X(-1), Y(-1)], [X(1), Y(1)]], c.muted, 1, [4, 4]);
      var pts = []; for (var i = 0; i <= 200; i++) { var x = i / 100 - 1, xi = clamp(x * pre, -1, 1), k = Math.round((xi + 1) / 2 * (curve.length - 1)), y = curve[k] * post; pts.push([X(x), Y(d.enabled ? y * mix + x * (1 - mix) : x)]); }
      line(ctx, pts, d.enabled ? c.accent : c.muted, 2.6);
      text(ctx, d.type.toUpperCase() + "  ·  input → output", 10, 18, c.text, "left", "bold 11px system-ui"); offLabel(ctx, w, h, d.enabled, c);
    },
    filter: function (ctx, w, h, fx, c) {
      var f = fx.filter, X = logX(w, 20, 20000), Y = dbY(h, 24, -36), freqs = PP.logFreqs(w, 20, 20000), rate = PP.syncedRate(f.rate, f.sync), v = liveVoice();
      freqAxis(ctx, w, h, X, c);
      [0, -12, -24].forEach(function (db) { ctx.strokeStyle = c.grid; ctx.beginPath(); ctx.moveTo(0, Y(db)); ctx.lineTo(w, Y(db)); ctx.stroke(); text(ctx, db + " dB", 4, Y(db) - 3, c.label); });
      function curve(detune) { var r = PP.biquadDb([{ type: f.type, freq: clamp(f.freq, 40, 18000), q: clamp(f.q, .3, 20), detune: detune }], freqs); return Array.prototype.map.call(freqs, function (fr, i) { return [X(fr), Y(r[i])]; }); }
      var span = clamp(f.depth, 0, 100) / 100 * 2400;
      if (f.enabled && span > 0) { line(ctx, curve(-span), c.muted, 1, [3, 4]); line(ctx, curve(span), c.muted, 1, [3, 4]); }
      line(ctx, curve(f.enabled ? span * wave(f.wave, voicePhase(v, rate)) : 0), f.enabled ? c.accent : c.muted, 2.6);
      text(ctx, f.type + " · sweep " + (f.sync && f.sync !== "off" ? f.sync + " note" : rate.toFixed(2) + " Hz"), 10, 18, c.text, "left", "bold 11px system-ui"); offLabel(ctx, w, h, f.enabled, c);
    },
    phaser: function (ctx, w, h, fx, c) {
      var p = fx.phaser, g = graphCtx(); if (!g) return;
      var X = logX(w, 20, 20000), Y = dbY(h, 6, -30), freqs = PP.logFreqs(w, 20, 20000), n = freqs.length, stages = Number(p.stages) || 6, v = liveVoice();
      var detune = p.enabled ? clamp(p.depth, 0, 100) / 100 * 1800 * Math.sin(voicePhase(v, PP.syncedRate(p.rate, p.sync)) * 2 * Math.PI) : 0;
      var phase = new Float32Array(n), mag = new Float32Array(n), ph = new Float32Array(n);
      [1, 1.5, 2.2, 3.3, 5, 7.4, 11, 16].slice(0, stages).forEach(function (mult, i) { var ap = apPool[i] || (apPool[i] = g.createBiquadFilter()); ap.type = "allpass"; ap.frequency.value = 320 * mult; ap.Q.value = .6; ap.detune.value = detune; ap.getFrequencyResponse(freqs, mag, ph); for (var k = 0; k < n; k++) phase[k] += ph[k]; });
      var m = clamp(p.mix, 0, 100) / 100, dry = p.enabled ? 1 - m * .5 : 1, wet = p.enabled ? m : 0;
      freqAxis(ctx, w, h, X, c);
      var pts = []; for (var k = 0; k < n; k++) { var re = dry + wet * Math.cos(phase[k]), im = wet * Math.sin(phase[k]); pts.push([X(freqs[k]), Y(20 * Math.log10(Math.sqrt(re * re + im * im) + 1e-6))]); }
      line(ctx, pts, p.enabled ? c.accent : c.muted, 2.4);
      text(ctx, stages + "-stage · notches move with the sweep", 10, 18, c.text, "left", "bold 11px system-ui"); offLabel(ctx, w, h, p.enabled, c);
    },
    chorus: function (ctx, w, h, fx, c) {
      var ch = fx.chorus, v = liveVoice(), center = clamp(ch.frequency, 2, 35), depth = clamp(ch.depth, 0, 16), max = 52;
      var Y = function (ms) { return h - 20 - ms / max * (h - 34); };
      ctx.strokeStyle = c.grid; [0, 10, 20, 30, 40, 50].forEach(function (ms) { ctx.beginPath(); ctx.moveTo(0, Y(ms)); ctx.lineTo(w, Y(ms)); ctx.stroke(); text(ctx, ms + " ms", 4, Y(ms) - 2, c.label); });
      var secs = 4, pts = []; for (var i = 0; i <= 200; i++) { var t = i / 200 * secs; pts.push([40 + i / 200 * (w - 50), Y(center + (ch.enabled ? depth * Math.sin(t * ch.rate * 2 * Math.PI) : 0))]); }
      line(ctx, pts, ch.enabled ? c.accent : c.muted, 2.4);
      var ph = voicePhase(v, ch.rate), px = 40 + ((ph / ch.rate) % secs) / secs * (w - 50);
      if (v && ch.enabled) { ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(px, Y(center + depth * Math.sin(ph * 2 * Math.PI)), 5, 0, Math.PI * 2); ctx.fill(); }
      text(ctx, "delay time over 4 s · mix " + Math.round(ch.mix) + "%", 10, 18, c.text, "left", "bold 11px system-ui"); offLabel(ctx, w, h, ch.enabled, c);
    },
    tremolo: function (ctx, w, h, fx, c) {
      var t = fx.tremolo, rate = PP.syncedRate(t.rate, t.sync), d = clamp(t.depth, 0, 100) / 100, beats = 4, secs = beats * 60 / PP.tempoBpm(), pan = t.mode === "autopan", v = liveVoice();
      var Y = pan ? function (val) { return h / 2 - val * (h / 2 - 22); } : function (val) { return h - 18 - val * (h - 40); };
      ctx.strokeStyle = c.grid; for (var b = 0; b <= beats; b++) { var bx = 10 + b / beats * (w - 20); ctx.beginPath(); ctx.moveTo(bx, 24); ctx.lineTo(bx, h - 14); ctx.stroke(); if (b < beats) text(ctx, "beat " + (b + 1), bx + 3, h - 3, c.label); }
      if (pan) { text(ctx, "L", 4, 34, c.label); text(ctx, "R", 4, h - 20, c.label); }
      var pts = []; for (var i = 0; i <= 300; i++) { var tt = i / 300 * secs, wv = wave(t.wave, tt * rate); pts.push([10 + i / 300 * (w - 20), Y(!t.enabled ? (pan ? 0 : 1) : pan ? -wv * d : 1 - d / 2 + wv * d / 2)]); }
      line(ctx, pts, t.enabled ? c.accent : c.muted, 2.4);
      text(ctx, (pan ? "Auto-pan" : "Tremolo") + " · " + (t.sync && t.sync !== "off" ? t.sync + " at " + Math.round(PP.tempoBpm()) + " BPM" : rate.toFixed(2) + " Hz"), 10, 18, c.text, "left", "bold 11px system-ui"); offLabel(ctx, w, h, t.enabled, c);
    },
    // Stereo scope (goniometer) of the real output: vertical line = mono, wide cloud = stereo
    width: function (ctx, w, h, fx, c) {
      var size = Math.min(w, h) - 16, cx = w / 2, cy = h / 2;
      ctx.strokeStyle = c.grid; ctx.beginPath(); ctx.arc(cx, cy, size / 2, 0, Math.PI * 2); ctx.moveTo(cx, cy - size / 2); ctx.lineTo(cx, cy + size / 2); ctx.moveTo(cx - size / 2, cy); ctx.lineTo(cx + size / 2, cy); ctx.stroke();
      text(ctx, "L", cx - size / 2 * .72 - 8, cy - size / 2 * .72, c.label); text(ctx, "R", cx + size / 2 * .72 + 2, cy - size / 2 * .72, c.label);
      if (!engine.postL) { text(ctx, "Play a pad to see the stereo image", cx, cy + 4, c.muted, "center"); return; }
      var n = engine.postL.fftSize, L = new Float32Array(n), R = new Float32Array(n); engine.postL.getFloatTimeDomainData(L); engine.postR.getFloatTimeDomainData(R);
      var peak = 1e-4, corr = 0, eL = 0, eR = 0; for (var i = 0; i < n; i++) { peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])); corr += L[i] * R[i]; eL += L[i] * L[i]; eR += R[i] * R[i]; }
      var scale = size / 2 / Math.max(peak, .05) * .9; ctx.fillStyle = c.accent;
      for (var k = 0; k < n; k += 2) { var side = (L[k] - R[k]) / Math.SQRT2, mid = (L[k] + R[k]) / Math.SQRT2; ctx.fillRect(cx + side * scale, cy - mid * scale, 1.5, 1.5); }
      var cr = corr / Math.sqrt(eL * eR + 1e-12); text(ctx, peak < .002 ? "silent" : "correlation " + cr.toFixed(2) + (cr < 0 ? " (phase problem!)" : ""), 8, h - 6, cr < 0 ? c.danger : c.muted);
    },
    delay: function (ctx, w, h, fx, c) {
      var d = fx.delay, bpm = d.sync ? PP.tempoBpm() : clamp(d.bpm, 40, 240), dt = 60 / bpm * Number(d.division || .5), fb = clamp(d.feedback, 0, 88) / 100, send = clamp(d.send, 0, 100) / 100, pp = d.type === "pingpong";
      var span = Math.max(2, Math.min(8, dt * 10)), X = function (t) { return 12 + t / span * (w - 24); }, base = pp ? h / 2 : h - 18, H = pp ? h / 2 - 26 : h - 44;
      ctx.strokeStyle = c.grid; for (var s = 0; s <= span; s += .5) { ctx.beginPath(); ctx.moveTo(X(s), 24); ctx.lineTo(X(s), h - 12); ctx.stroke(); if (s % 1 === 0) text(ctx, s + " s", X(s) + 2, h - 2, c.label); }
      ctx.fillStyle = c.text; ctx.fillRect(X(0) - 2, base - H, 4, H);
      for (var n = 1; n * dt <= span && n < 60; n++) { var amp = send * Math.pow(pp ? Math.max(fb, .01) : fb, n - 1), left = !pp || n % 2 === 1, hh = Math.max(1, amp * H); ctx.fillStyle = d.enabled ? (left ? c.accent : c.blue) : c.muted; if (pp) ctx.fillRect(X(n * dt) - 2, left ? base - hh : base, 4, hh); else ctx.fillRect(X(n * dt) - 2, base - hh, 4, hh); if (amp < .01) break; }
      if (pp) { text(ctx, "L", 4, base - 8, c.accent); text(ctx, "R", 4, base + 16, c.blue); }
      text(ctx, (d.sync ? "synced " : "") + Math.round(dt * 1000) + " ms (" + Math.round(bpm) + " BPM)" + (pp ? " · ping-pong" : ""), 10, 18, c.text, "left", "bold 11px system-ui"); offLabel(ctx, w, h, d.enabled, c);
    },
    // Reverb: the real impulse response's energy over time, after pre-delay
    reverb: function (ctx, w, h, fx, c) {
      var r = fx.reverb, ac = engine.context(), ir = engine.impulse(r.type, r.decay), sr = ir.sampleRate, data = ir.getChannelData(0), pre = clamp(r.predelay, 0, 250) / 1000, total = pre + ir.duration;
      var X = function (t) { return 34 + t / total * (w - 44); }, Y = dbY(h, 0, -60);
      ctx.strokeStyle = c.grid; [0, -20, -40, -60].forEach(function (db) { ctx.beginPath(); ctx.moveTo(30, Y(db)); ctx.lineTo(w, Y(db)); ctx.stroke(); text(ctx, db, 4, Y(db) + 4, c.label); });
      for (var s = 0; s <= total; s += total > 6 ? 2 : 1) text(ctx, s + " s", X(s) + 2, h - 4, c.label);
      var bins = Math.floor(w / 2), per = Math.max(1, Math.floor(data.length / bins)), pts = [[X(0), Y(-60)], [X(pre), Y(-60)]], max = 1e-9, env = [];
      for (var b = 0; b < bins; b++) { var sum = 0; for (var i = b * per; i < Math.min(data.length, (b + 1) * per); i++) sum += data[i] * data[i]; env.push(Math.sqrt(sum / per)); max = Math.max(max, env[b]); }
      env.forEach(function (e, b) { pts.push([X(pre + b * per / sr), Y(20 * Math.log10(e / max + 1e-9))]); });
      pts.push([X(total), Y(-60)]);
      ctx.beginPath(); pts.forEach(function (p, i) { if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }); ctx.closePath(); ctx.fillStyle = r.enabled ? "rgba(93,230,176,.22)" : "rgba(155,178,201,.15)"; ctx.fill();
      line(ctx, pts.slice(1, -1), r.enabled ? c.accent : c.muted, 1.6);
      if (r.enabled && r.shimmer > 0) text(ctx, "✦ shimmer " + Math.round(r.shimmer) + "% (octave-up feedback)", w - 10, 36, "#ffcf66", "right");
      text(ctx, r.type + " · " + r.decay.toFixed(1) + " s decay · pre-delay " + Math.round(pre * 1000) + " ms · " + fmtHz(r.lowCut) + "–" + fmtHz(r.highCut) + " Hz", 34, 18, c.text, "left", "bold 11px system-ui"); offLabel(ctx, w, h, r.enabled, c);
    },
    lfo: function (ctx, w, h, fx, c) {
      var l = fx.lfo, v = liveVoice(), secs = Math.max(2, Math.min(20, 4 / Math.max(.05, l.rate))), d = clamp(l.depth, 0, 100) / 100 * clamp(l.amount, 0, 100) / 100;
      var Y = function (val) { return h / 2 - val * (h / 2 - 24); };
      ctx.strokeStyle = c.grid; ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();
      var pts = []; for (var i = 0; i <= 300; i++) pts.push([10 + i / 300 * (w - 20), Y(l.enabled ? wave(l.wave, i / 300 * secs * l.rate) * d : 0)]);
      line(ctx, pts, l.enabled ? c.accent : c.muted, 2.4);
      if (v && l.enabled) { var ph = voicePhase(v, l.rate), x = 10 + ((ph / l.rate) % secs) / secs * (w - 20); ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(x, Y(wave(l.wave, ph) * d), 5, 0, Math.PI * 2); ctx.fill(); }
      text(ctx, "→ " + l.target + " · " + l.rate.toFixed(2) + " Hz over " + secs.toFixed(1) + " s", 10, 18, c.text, "left", "bold 11px system-ui"); offLabel(ctx, w, h, l.enabled, c);
    },
    texture: function (ctx, w, h, fx, c) {
      var t = fx.texture, X = logX(w, 20, 20000), Y = dbY(h, 6, -36), freqs = PP.logFreqs(w, 20, 20000);
      freqAxis(ctx, w, h, X, c);
      var r = PP.biquadDb([{ type: "highpass", freq: clamp(t.highPass, 20, 4000), q: .7 }, { type: "lowpass", freq: clamp(t.lowPass, 500, 20000), q: .7 }], freqs);
      line(ctx, Array.prototype.map.call(freqs, function (f, i) { return [X(f), Y(r[i])]; }), t.enabled ? c.accent : c.muted, 2.4);
      text(ctx, t.type + " texture band · volume " + Math.round(t.volume) + "%", 10, 18, c.text, "left", "bold 11px system-ui"); offLabel(ctx, w, h, t.enabled, c);
    }
  };

  function drawPanel(name) {
    var fx = PP.currentPad().effects, c = colors();
    document.querySelectorAll("#panel-" + name + " canvas[data-graph]").forEach(function (canvas) {
      var draw = drawers[canvas.dataset.graph]; if (!draw || !canvas.offsetWidth) return;
      var g = PP.graphGeometry(canvas); g.ctx.clearRect(0, 0, g.width, g.height);
      try { draw(g.ctx, g.width, g.height, fx, c); } catch (error) { if (window.console) console.warn("graph " + canvas.dataset.graph, error); }
    });
  }
  function sampleGainReduction() {
    var v = liveVoice(), gr = v && v.pad.effects.compressor.enabled ? Math.max(0, -(v.comp.reduction || 0)) : 0;
    grHistory[grPos] = gr; grPos = (grPos + 1) % grHistory.length;
  }
  function drawSpectrumBox() {
    var canvas = document.getElementById("spectrum"); if (!canvas || !canvas.offsetWidth) return;
    var g = PP.graphGeometry(canvas), ctx = g.ctx, w = g.width, h = g.height, c = colors(), X = logX(w, 20, 20000);
    ctx.clearRect(0, 0, w, h); freqAxis(ctx, w, h, X, c);
    if (engine.spectrum) PP.drawSpectrum(ctx, w, h, X, function (db) { return h - clamp((db + 100) / 90, 0, 1) * h; });
  }
  function dbPct(db) { return clamp((db + 60) / 60, 0, 1) * 100; }
  function updateMeters() {
    var meters = [["vuL", "pkL", "L"], ["vuR", "pkR", "R"], ["pfVuL", "pfPkL", "L"], ["pfVuR", "pfPkR", "R"]];
    if (!engine.postL) return;
    var L = rmsDb(engine.postL), R = rmsDb(engine.postR), pre = Math.max(rmsDb(engine.preL).peakLin, rmsDb(engine.preR).peakLin), post = Math.max(L.peakLin, R.peakLin);
    var now = { L: L, R: R };
    ["L", "R"].forEach(function (ch) { peakHold[ch] = Math.max(now[ch].peak, peakHold[ch] - .6); });
    meters.forEach(function (m) { var bar = document.getElementById(m[0]), pk = document.getElementById(m[1]); if (!bar) return; bar.style.width = (100 - dbPct(now[m[2]].rms + 3)) + "%"; if (pk) pk.style.left = dbPct(peakHold[m[2]]) + "%"; });
    if (post >= .985) clipState = 2; else if (pre >= 1 && clipState < 1) clipState = 1;
    document.querySelectorAll(".clip").forEach(function (el) { el.classList.toggle("hot", clipState === 1); el.classList.toggle("over", clipState === 2); el.textContent = clipState === 2 ? "CLIP" : clipState === 1 ? "HOT" : "OK"; el.title = clipState === 2 ? "Output hit 0 dB. Turn the Volume knob down, then tap to reset." : clipState === 1 ? "The limiter is working hard. Lower Volume or pad levels, then tap to reset." : "Output level is safe"; });
  }
  document.addEventListener("click", function (e) { if (e.target.closest && e.target.closest(".clip")) clipState = 0; });

  function frame(t) {
    requestAnimationFrame(frame);
    if (t - lastFrame < 33) return;
    lastFrame = t;
    sampleGainReduction(); updateMeters();
    if (PP.isPerforming()) return;
    var active = document.querySelector(".panel.active"), name = active ? active.id.replace("panel-", "") : "";
    if (name === "eq" && engine.voices().length && window.PP.redrawEq) window.PP.redrawEq();
    if (name) drawPanel(name);
    drawSpectrumBox();
  }
  function refresh() {
    var desc = document.getElementById("compDesc"), type = PP.currentPad().effects.compressor.type;
    if (desc) desc.textContent = (PP.COMP_TYPES[type] || PP.COMP_TYPES.VCA).desc;
    var active = document.querySelector(".panel.active"); if (active) drawPanel(active.id.replace("panel-", ""));
  }
  document.addEventListener("input", function (e) { if (e.target.dataset && e.target.dataset.path) refresh(); });
  document.addEventListener("change", function (e) { if (e.target.dataset && e.target.dataset.path) refresh(); });
  document.getElementById("tabs").addEventListener("click", function () { setTimeout(refresh, 0); });

  window.PPGraphics = { refresh: refresh, drawers: drawers, drawPanel: drawPanel, clipState: function () { return clipState; } };
  refresh();
  requestAnimationFrame(frame);
})();
