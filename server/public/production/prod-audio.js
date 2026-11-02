/* Central Production - sound helpers every project type uses: MP3 (LAME, vendor/lame.min.js), a seamless loop out of a
 * render, a short demo clip, normalising, fades, and drawing a waveform. */
(function () {
  "use strict";
  function chans(b) { var a = []; for (var c = 0; c < b.numberOfChannels; c++) a.push(b.getChannelData(c)); return a; }
  function make(nc, n, rate) { return new AudioBuffer({ numberOfChannels: Math.max(1, nc), length: Math.max(1, n), sampleRate: rate }); }
  function mp3(buf, kbps) {
    if (!window.lamejs) throw new Error("The MP3 encoder didn't load.");
    var nc = Math.min(2, buf.numberOfChannels), enc = new lamejs.Mp3Encoder(nc, buf.sampleRate, kbps || 256), out = [], block = 1152;
    var L = buf.getChannelData(0), R = nc > 1 ? buf.getChannelData(1) : null, l16 = new Int16Array(block), r16 = new Int16Array(block);
    for (var i = 0; i < L.length; i += block) {
      var n = Math.min(block, L.length - i);
      for (var k = 0; k < n; k++) { l16[k] = Math.max(-32768, Math.min(32767, L[i + k] * 32767)); if (R) r16[k] = Math.max(-32768, Math.min(32767, R[i + k] * 32767)); }
      var d = R ? enc.encodeBuffer(l16.subarray(0, n), r16.subarray(0, n)) : enc.encodeBuffer(l16.subarray(0, n)); if (d.length) out.push(new Uint8Array(d));
    }
    var f = enc.flush(); if (f.length) out.push(new Uint8Array(f));
    var total = out.reduce(function (a, b) { return a + b.length; }, 0), res = new Uint8Array(total), p = 0; out.forEach(function (b) { res.set(b, p); p += b.length; });
    return res;
  }
  // a render that starts `startSec` in, as exactly `seconds` long, with the tail (reverb, delay) wrapped round to the start
  function asLoop(buf, seconds, startSec) {
    var rate = buf.sampleRate, start = Math.round((startSec || 0) * rate), n = Math.round(seconds * rate), out = make(buf.numberOfChannels, n, rate);
    for (var c = 0; c < buf.numberOfChannels; c++) {
      var src = buf.getChannelData(c), dst = out.getChannelData(c);
      for (var i = 0; i < n; i++) dst[i] = src[start + i] || 0;
      for (var j = start + n, k = 0; j < src.length; j++, k++) dst[k % n] += src[j];
      for (var m = 0; m < n; m++) dst[m] = Math.max(-1, Math.min(1, dst[m]));
    }
    return out;
  }
  function repeat(buf, seconds) { var n = Math.round(seconds * buf.sampleRate), out = make(buf.numberOfChannels, n, buf.sampleRate); for (var c = 0; c < buf.numberOfChannels; c++) { var s = buf.getChannelData(c), d = out.getChannelData(c); for (var i = 0; i < n; i++) d[i] = s[i % s.length]; } return out; }
  function slice(buf, a, b) { a = Math.max(0, Math.floor(a)); b = Math.min(buf.length, Math.floor(b)); var out = make(buf.numberOfChannels, b - a, buf.sampleRate); for (var c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).subarray(a, b), c); return out; }
  function peak(buf) { var p = 0; chans(buf).forEach(function (d) { for (var i = 0; i < d.length; i++) { var x = Math.abs(d[i]); if (x > p) p = x; } }); return p; }
  function gain(buf, g) { var out = make(buf.numberOfChannels, buf.length, buf.sampleRate); for (var c = 0; c < buf.numberOfChannels; c++) { var s = buf.getChannelData(c), d = out.getChannelData(c); for (var i = 0; i < s.length; i++) d[i] = s[i] * g; } return out; }
  function normalize(buf, db) { var p = peak(buf); return p > 0 ? gain(buf, Math.pow(10, (db == null ? -1 : db) / 20) / p) : buf; }
  function fade(buf, inSec, outSec) {
    var out = gain(buf, 1), ni = Math.round((inSec || 0) * buf.sampleRate), no = Math.round((outSec || 0) * buf.sampleRate);
    for (var c = 0; c < out.numberOfChannels; c++) { var d = out.getChannelData(c); for (var i = 0; i < ni && i < d.length; i++) d[i] *= i / ni; for (var j = 0; j < no && j < d.length; j++) d[d.length - 1 - j] *= j / no; }
    return out;
  }
  // a demo clip people hear before they download (and the reviewer listens to): up to `max` seconds, faded out
  function demo(buf, max) { max = max || 30; var b = buf.duration > max ? slice(buf, 0, max * buf.sampleRate) : buf; return fade(b, 0.01, Math.min(2, b.duration / 6)); }
  function wavBlob(buf, bits) { return new Blob([window.CMProj.wav(buf, bits || 24)], { type: "audio/wav" }); }
  // a waveform on a canvas (min / max per pixel), optionally just [a, b) of the buffer in frames
  function draw(canvas, buf, opts) {
    opts = opts || {}; var dpr = window.devicePixelRatio || 1, w = canvas.clientWidth || 600, h = canvas.clientHeight || 120;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    var g = canvas.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    if (!buf) return;
    var a = opts.from || 0, b = opts.to || buf.length, per = (b - a) / w, mid = h / 2, d = buf.getChannelData(0), d2 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : null;
    g.fillStyle = opts.color || "#E2C27E";
    for (var x = 0; x < w; x++) {
      var s = Math.floor(a + x * per), e = Math.max(s + 1, Math.floor(a + (x + 1) * per)), lo = 0, hi = 0;
      for (var i = s; i < e && i < d.length; i += Math.max(1, Math.floor((e - s) / 64))) { var v = d2 ? (d[i] + d2[i]) / 2 : d[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
      g.fillRect(x, mid - hi * mid * 0.95, 1, Math.max(1, (hi - lo) * mid * 0.95));
    }
  }
  // play a buffer now (one at a time); returns { stop }
  var playing = null;
  function audition(ctx, buf, opts) {
    stopAudition(); opts = opts || {};
    var src = ctx.createBufferSource(); src.buffer = buf; if (opts.loop) { src.loop = true; if (opts.loopStart != null) { src.loopStart = opts.loopStart; src.loopEnd = opts.loopEnd; } }
    if (opts.rate) src.playbackRate.value = opts.rate;
    src.connect(ctx.destination); src.start(0, opts.offset || 0); playing = src; src.onended = function () { if (playing === src) playing = null; if (opts.onEnd) opts.onEnd(); };
    return { stop: stopAudition, src: src };
  }
  function stopAudition() { if (playing) { try { playing.stop(); } catch (_) { } playing = null; } }
  window.CPAudio = { mp3: mp3, asLoop: asLoop, repeat: repeat, slice: slice, peak: peak, gain: gain, normalize: normalize, fade: fade, demo: demo, wavBlob: wavBlob, draw: draw, audition: audition, stopAudition: stopAudition, make: make };
})();
