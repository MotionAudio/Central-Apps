/* The DAW - time-stretch and pitch-shift for audio (loops brought in at the song's tempo and key).
 * WSOLA: overlap-add of short windows, each nudged to the spot that lines up best with what's already written, so the
 * sound keeps its pitch while it gets longer or shorter. Pitch = stretch by the interval, then resample back.
 *   CDawStretch.stretch(audioBuffer, ratio, semitones) -> AudioBuffer   (ratio 2 = twice as long)
 * Offline (not in the audio thread): a 4-bar loop takes a few tens of milliseconds. */
(function () {
  "use strict";
  function wsola(x, ratio, rate) {
    var N = Math.round(rate * 0.046), hop = Math.round(N / 2), tol = Math.round(rate * 0.012), outLen = Math.round(x.length * ratio) + N, y = new Float32Array(outLen), wsum = new Float32Array(outLen), win = new Float32Array(N);
    for (var i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
    var prev = 0;   // where the last window was read from
    for (var out = 0; out < outLen - N; out += hop) {
      var nominal = Math.round(out / ratio), best = nominal;
      if (out > 0) {   // find the read point near the nominal one that continues best from the previous window's next hop
        var ref = prev + hop, bestC = -Infinity;
        for (var d = -tol; d <= tol; d += 2) {
          var s = nominal + d; if (s < 0 || s + N >= x.length) continue; var c = 0;
          for (var k = 0; k < N; k += 4) c += x[s + k] * (x[ref + k] || 0);
          if (c > bestC) { bestC = c; best = s; }
        }
      }
      if (best < 0) best = 0; if (best + N >= x.length) best = Math.max(0, x.length - N - 1);
      for (var j = 0; j < N; j++) { y[out + j] += (x[best + j] || 0) * win[j]; wsum[out + j] += win[j]; }
      prev = best;
    }
    var len = Math.round(x.length * ratio), r = new Float32Array(len);
    for (var m = 0; m < len; m++) r[m] = wsum[m] > 1e-3 ? y[m] / wsum[m] : y[m];
    return r;
  }
  function resample(x, factor) {   // factor > 1: fewer samples (higher pitch when played at the same rate)
    var n = Math.floor(x.length / factor), y = new Float32Array(n);
    for (var i = 0; i < n; i++) { var p = i * factor, a = Math.floor(p), f = p - a; y[i] = (x[a] || 0) * (1 - f) + (x[a + 1] || 0) * f; }
    return y;
  }
  function stretch(buf, ratio, semis) {
    ratio = ratio || 1; semis = semis || 0;
    var shift = Math.pow(2, semis / 12), rate = buf.sampleRate, chans = [];
    if (Math.abs(ratio - 1) < 1e-4 && !semis) return buf;
    for (var c = 0; c < buf.numberOfChannels; c++) { var s = wsola(buf.getChannelData(c), ratio * shift, rate); chans.push(semis ? resample(s, shift) : s); }
    var len = Math.max(1, Math.min.apply(null, chans.map(function (a) { return a.length; }))), out = new AudioBuffer({ numberOfChannels: chans.length, length: len, sampleRate: rate });
    chans.forEach(function (a, i) { out.copyToChannel(a.subarray(0, len), i); });
    return out;
  }
  window.CDawStretch = { stretch: stretch };
})();
