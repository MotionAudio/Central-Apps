/* Central Control - offline audio analysis (runs in a Web Worker, loaded from a data: URL).
 * Tempo + beat grid + downbeats (spectral-flux onsets, autocorrelation tempo
 * with a log-normal prior, dynamic-programming beat tracking as in Ellis 2007),
 * musical key (chromagram against Krumhansl-Kessler profiles), and "big hits"
 * (strong onsets with bass) for the lighting MIDI output. Also used to detect
 * the root key of imported pad sounds. Also: chord recognition on the beat grid
 * (beat-synchronous chroma, chord templates, Viterbi smoothing, key prior) and
 * transcription of a stem to notes (monophonic YIN pitch tracking, or an
 * approximate polyphonic salience tracker), quantized to the grid. */
window.PP_ANALYSIS_WORKER = function () {
  var MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  var MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  var KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

  function fft(re, im) {
    var n = re.length, i, j, k, m;
    for (i = 1, j = 0; i < n; i++) {
      for (k = n >> 1; j >= k; k >>= 1) j -= k;
      j += k;
      if (i < j) { var t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (m = 2; m <= n; m <<= 1) {
      var half = m >> 1, ang = -2 * Math.PI / m, wr = Math.cos(ang), wi = Math.sin(ang);
      for (i = 0; i < n; i += m) {
        var cr = 1, ci = 0;
        for (j = 0; j < half; j++) {
          var a = i + j, b = a + half, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
          var nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
        }
      }
    }
  }

  function resample(mono, rate, target) {
    if (rate === target) return mono;
    var ratio = rate / target, n = Math.floor(mono.length / ratio), out = new Float32Array(n), box = Math.max(1, Math.round(ratio));
    for (var i = 0; i < n; i++) {
      var c = i * ratio, s = Math.floor(c), sum = 0, cnt = 0;
      for (var k = 0; k < box; k++) { var idx = s + k; if (idx < mono.length) { sum += mono[idx]; cnt++; } }
      out[i] = cnt ? sum / cnt : 0;
    }
    return out;
  }

  function hann(n) { var w = new Float32Array(n); for (var i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n); return w; }

  // ---- onset strength envelope (spectral flux) + bass flux, at `hop` frames/sec
  function onsets(x, rate, frame, hop) {
    var w = hann(frame), re = new Float32Array(frame), im = new Float32Array(frame), bins = frame >> 1;
    var prev = new Float32Array(bins), nFrames = Math.max(1, Math.floor((x.length - frame) / hop)), flux = new Float32Array(nFrames), bass = new Float32Array(nFrames), energy = new Float32Array(nFrames);
    var maxBin = Math.min(bins, Math.floor(5000 / (rate / frame))), bassBin = Math.max(2, Math.floor(160 / (rate / frame)));
    for (var f = 0; f < nFrames; f++) {
      var off = f * hop, e = 0;
      for (var i = 0; i < frame; i++) { var v = x[off + i] * w[i]; re[i] = v; im[i] = 0; e += v * v; }
      fft(re, im);
      var sum = 0, bsum = 0;
      for (var k = 1; k < maxBin; k++) {
        var mag = Math.log(1 + 12 * Math.sqrt(re[k] * re[k] + im[k] * im[k]) / frame), d = mag - prev[k];
        if (d > 0) { sum += d; if (k < bassBin) bsum += d; }
        prev[k] = mag;
      }
      flux[f] = sum; bass[f] = bsum; energy[f] = Math.sqrt(e / frame);
    }
    // smooth + remove the local mean so the envelope sits around zero
    var sm = smooth(flux, 2), out = new Float32Array(nFrames), win = Math.round(rate / hop * 0.6);
    for (var t = 0; t < nFrames; t++) {
      var a = Math.max(0, t - win), b = Math.min(nFrames - 1, t + win), m = 0;
      for (var u = a; u <= b; u++) m += sm[u];
      out[t] = Math.max(0, sm[t] - m / (b - a + 1));
    }
    var mx = 0; for (var q = 0; q < nFrames; q++) if (out[q] > mx) mx = out[q];
    if (mx > 0) for (var q2 = 0; q2 < nFrames; q2++) out[q2] /= mx;
    return { env: out, raw: sm, bass: smooth(bass, 2), energy: energy };
  }

  function smooth(a, r) {
    var out = new Float32Array(a.length);
    for (var i = 0; i < a.length; i++) { var s = 0, c = 0; for (var k = -r; k <= r; k++) { var j = i + k; if (j >= 0 && j < a.length) { s += a[j]; c++; } } out[i] = s / c; }
    return out;
  }

  function tempo(env, fps, lo, hi, prefer) {
    var minLag = Math.floor(fps * 60 / hi), maxLag = Math.ceil(fps * 60 / lo), n = env.length, acf = new Float32Array(maxLag + 1), best = -1, bestLag = 0;
    var mean = 0; for (var i = 0; i < n; i++) mean += env[i]; mean /= n;
    for (var lag = minLag; lag <= maxLag; lag++) {
      var s = 0, c = 0;
      for (var t = lag; t < n; t++) { s += (env[t] - mean) * (env[t - lag] - mean); c++; }
      var bpm = fps * 60 / lag, prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / prefer) / 0.9, 2));
      acf[lag] = (c ? s / c : 0) * prior;
      if (acf[lag] > best) { best = acf[lag]; bestLag = lag; }
    }
    // refine the peak with a parabola, then fix octave errors against the usual song range
    var lagF = bestLag;
    if (bestLag > minLag && bestLag < maxLag) { var y0 = acf[bestLag - 1], y1 = acf[bestLag], y2 = acf[bestLag + 1], den = y0 - 2 * y1 + y2; if (den) lagF = bestLag + 0.5 * (y0 - y2) / den; }
    var bpm = fps * 60 / lagF;
    function at(l) { l = Math.round(l); return l >= minLag && l <= maxLag ? acf[l] : -1; }
    if (bpm < 70 && at(lagF / 2) > 0.45 * best) bpm *= 2;
    else if (bpm > 165 && at(lagF * 2) > 0.45 * best) bpm /= 2;
    return { bpm: bpm, strength: best };
  }

  // dynamic-programming beat tracker (Ellis 2007)
  function trackBeats(env, fps, bpm, tightness) {
    var period = fps * 60 / bpm, n = env.length, score = new Float32Array(n), back = new Int32Array(n), lo = Math.round(period / 2), hi = Math.round(period * 2);
    var alpha = tightness || 300, i, t;
    for (t = 0; t < n; t++) {
      var best = -Infinity, bestPrev = -1;
      for (i = Math.max(0, t - hi); i <= t - lo; i++) {
        var pen = -alpha * Math.pow(Math.log((t - i) / period), 2), s = score[i] + pen;
        if (s > best) { best = s; bestPrev = i; }
      }
      score[t] = env[t] * 100 + (bestPrev >= 0 ? best : 0);
      back[t] = bestPrev;
    }
    var end = n - 1, bestEnd = -Infinity;
    for (t = Math.max(0, n - Math.round(period * 1.5)); t < n; t++) if (score[t] > bestEnd) { bestEnd = score[t]; end = t; }
    var beats = [];
    for (t = end; t >= 0; t = back[t]) { beats.push(t); if (back[t] < 0) break; }
    beats.reverse();
    return beats;
  }

  function fitGrid(beatTimes) {
    var n = beatTimes.length; if (n < 3) return null;
    var sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (var i = 0; i < n; i++) { sx += i; sy += beatTimes[i]; sxx += i * i; sxy += i * beatTimes[i]; }
    var slope = (n * sxy - sx * sy) / (n * sxx - sx * sx), inter = (sy - slope * sx) / n, res = 0;
    for (var k = 0; k < n; k++) { var d = beatTimes[k] - (inter + slope * k); res += d * d; }
    return { period: slope, first: inter, residual: Math.sqrt(res / n) };
  }

  function downbeatPhase(env, bass, beats, bpb) {
    var best = -1, phase = 0;
    for (var p = 0; p < bpb; p++) {
      var s = 0, c = 0;
      for (var i = p; i < beats.length; i += bpb) { var t = beats[i]; s += env[t] + 1.6 * bass[t] + 0.3 * (i > 0 ? Math.max(0, env[t] - env[beats[i - 1]]) : 0); c++; }
      s = c ? s / c : 0;
      if (s > best) { best = s; phase = p; }
    }
    return phase;
  }

  function chroma(x, rate) {
    var frame = 4096, hop = 2048, w = hann(frame), re = new Float32Array(frame), im = new Float32Array(frame), acc = new Float64Array(12), nFrames = Math.floor((x.length - frame) / hop);
    if (nFrames < 1) return acc;
    var step = Math.max(1, Math.floor(nFrames / 300));
    for (var f = 0; f < nFrames; f += step) {
      var off = f * hop;
      for (var i = 0; i < frame; i++) { re[i] = x[off + i] * w[i]; im[i] = 0; }
      fft(re, im);
      for (var k = 2; k < frame / 2; k++) {
        var freq = k * rate / frame; if (freq < 55 || freq > 2600) continue;
        var mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]), pc = ((Math.round(12 * Math.log2(freq / 440)) % 12) + 9 + 24) % 12;
        acc[pc] += Math.log(1 + 8 * mag / frame) * (freq < 300 ? 1.3 : 1);
      }
    }
    return acc;
  }

  function detectKey(ch) {
    var best = -2, second = -2, key = 0, mode = "major", mean = 0, i;
    for (i = 0; i < 12; i++) mean += ch[i]; mean /= 12;
    var dev = 0; for (i = 0; i < 12; i++) dev += (ch[i] - mean) * (ch[i] - mean); dev = Math.sqrt(dev) || 1;
    function corr(prof, rot) { var pm = 0, k; for (k = 0; k < 12; k++) pm += prof[k]; pm /= 12; var pd = 0, s = 0; for (k = 0; k < 12; k++) { var pv = prof[k] - pm; pd += pv * pv; s += pv * (ch[(k + rot) % 12] - mean); } return s / (Math.sqrt(pd) * dev); }
    for (i = 0; i < 12; i++) {
      var cm = corr(MAJOR, i), cn = corr(MINOR, i);
      if (cm > best) { second = best; best = cm; key = i; mode = "major"; } else if (cm > second) second = cm;
      if (cn > best) { second = best; best = cn; key = i; mode = "minor"; } else if (cn > second) second = cn;
    }
    return { key: KEYS[key], mode: mode, confidence: Math.max(0, Math.min(1, (best - second) * 3)), correlation: best };
  }

  function findHits(env, bass, fps, beatFrames) {
    var n = env.length, vals = Array.from(env).sort(function (a, b) { return a - b; }), thr = Math.max(0.55, vals[Math.floor(n * 0.985)] || 0.5);
    var bvals = Array.from(bass).sort(function (a, b) { return a - b; }), bthr = bvals[Math.floor(n * 0.9)] || 0;
    var minGap = beatFrames * 0.9, hits = [], last = -1e9;
    for (var t = 1; t < n - 1; t++) {
      if (env[t] >= thr && env[t] >= env[t - 1] && env[t] >= env[t + 1] && bass[t] >= bthr && t - last >= minGap) { hits.push(t); last = t; }
    }
    return hits;
  }


  // ---------------------------------------------------------------- tempo / key candidates (for the "is this right?" UI)
  function tempoCandidates(env, fps, lo, hi, prefer) {
    var minLag = Math.floor(fps * 60 / hi), maxLag = Math.ceil(fps * 60 / lo), n = env.length, mean = 0, i;
    for (i = 0; i < n; i++) mean += env[i]; mean /= n;
    var acf = new Float32Array(maxLag + 1), peaks = [];
    for (var lag = minLag; lag <= maxLag; lag++) { var s = 0, c = 0; for (var t = lag; t < n; t++) { s += (env[t] - mean) * (env[t - lag] - mean); c++; } acf[lag] = c ? s / c : 0; }
    for (lag = minLag + 1; lag < maxLag; lag++) if (acf[lag] > acf[lag - 1] && acf[lag] >= acf[lag + 1] && acf[lag] > 0) peaks.push({ lag: lag, v: acf[lag] * Math.exp(-0.5 * Math.pow(Math.log2(fps * 60 / lag / prefer) / 1.1, 2)) });
    peaks.sort(function (a, b) { return b.v - a.v; });
    var top = peaks.slice(0, 6), mx = top.length ? top[0].v : 1;
    return top.map(function (p) { return { bpm: Math.round(fps * 60 / p.lag * 10) / 10, score: Math.round(p.v / mx * 100) / 100 }; });
  }
  function keyCandidates(ch) {
    var out = [], mean = 0, i; for (i = 0; i < 12; i++) mean += ch[i]; mean /= 12;
    var dev = 0; for (i = 0; i < 12; i++) dev += (ch[i] - mean) * (ch[i] - mean); dev = Math.sqrt(dev) || 1;
    function corr(prof, rot) { var pm = 0, k; for (k = 0; k < 12; k++) pm += prof[k]; pm /= 12; var pd = 0, s = 0; for (k = 0; k < 12; k++) { var pv = prof[k] - pm; pd += pv * pv; s += pv * (ch[(k + rot) % 12] - mean); } return s / (Math.sqrt(pd) * dev); }
    for (i = 0; i < 12; i++) { out.push({ key: KEYS[i], mode: "major", score: corr(MAJOR, i) }); out.push({ key: KEYS[i], mode: "minor", score: corr(MINOR, i) }); }
    out.sort(function (a, b) { return b.score - a.score; });
    return out.slice(0, 4).map(function (k) { return { key: k.key, mode: k.mode, score: Math.round(k.score * 100) / 100 }; });
  }

  // ---------------------------------------------------------------- chords
  var CHORD_TYPES = [
    ["", [0, 4, 7], [1, .9, .8]], ["m", [0, 3, 7], [1, .9, .8]], ["7", [0, 4, 7, 10], [1, .8, .7, .7]], ["maj7", [0, 4, 7, 11], [1, .8, .7, .6]],
    ["m7", [0, 3, 7, 10], [1, .8, .7, .7]], ["sus4", [0, 5, 7], [1, .9, .8]], ["sus2", [0, 2, 7], [1, .8, .8]], ["dim", [0, 3, 6], [1, .9, .9]], ["add9", [0, 4, 7, 2], [1, .8, .7, .5]]
  ];
  function chordTemplates() {
    var out = [];
    for (var root = 0; root < 12; root++) CHORD_TYPES.forEach(function (ct) {
      var v = new Float32Array(12); ct[1].forEach(function (iv, i) { v[(root + iv) % 12] = ct[2][i]; });
      var norm = 0; for (var k = 0; k < 12; k++) norm += v[k] * v[k]; norm = Math.sqrt(norm) || 1; for (k = 0; k < 12; k++) v[k] /= norm;
      out.push({ root: root, type: ct[0], v: v, size: ct[1].length });
    });
    out.push({ root: -1, type: "N", v: null, size: 0 });
    return out;
  }
  // frame chroma (log-frequency, harmonically weighted) + a bass chroma (55-220 Hz)
  function chromaFrames(x, rate, frame, hop) {
    var w = hann(frame), re = new Float32Array(frame), im = new Float32Array(frame), nFrames = Math.max(1, Math.floor((x.length - frame) / hop));
    var binPc = new Int16Array(frame >> 1), binW = new Float32Array(frame >> 1), binBass = new Uint8Array(frame >> 1);
    for (var k = 1; k < frame >> 1; k++) {
      var freq = k * rate / frame; if (freq < 50 || freq > 3000) { binPc[k] = -1; continue; }
      var midi = 69 + 12 * Math.log2(freq / 440), nearest = Math.round(midi), dist = Math.abs(midi - nearest);
      binPc[k] = ((nearest % 12) + 12) % 12; binW[k] = Math.max(0, 1 - dist * 2.2) * (freq < 250 ? 1.25 : freq > 1500 ? 0.6 : 1); binBass[k] = freq < 230 ? 1 : 0;
    }
    var frames = [], bass = [], energy = [];
    for (var f = 0; f < nFrames; f++) {
      var off = f * hop, e = 0;
      for (var i = 0; i < frame; i++) { var v = x[off + i] * w[i]; re[i] = v; im[i] = 0; e += v * v; }
      fft(re, im);
      var c = new Float32Array(12), b = new Float32Array(12);
      for (k = 1; k < frame >> 1; k++) { if (binPc[k] < 0) continue; var mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]) / frame, lm = Math.log(1 + 30 * mag) * binW[k]; c[binPc[k]] += lm; if (binBass[k]) b[binPc[k]] += lm; }
      frames.push(c); bass.push(b); energy.push(Math.sqrt(e / frame));
    }
    return { frames: frames, bass: bass, energy: energy, fps: rate / hop, frame: frame, hop: hop };
  }
  function keyScale(keyIndex, mode) { var iv = mode === "minor" ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11], set = {}; iv.forEach(function (i) { set[(keyIndex + i) % 12] = 1; }); return set; }
  function chordsOf(mono, rate, opts) {
    opts = opts || {};
    var R = 11025, x = resample(mono, rate, R), cf = chromaFrames(x, R, 4096, 1024), fps = cf.fps;
    // the bass track on its own (when the song has one) names the bass note far better than the mix does
    var bassOwn = false;
    if (opts.bass && opts.bass.length) { var bx = resample(opts.bass, opts.bassRate || rate, R), bf = chromaFrames(bx, R, 4096, 1024); if (bf.frames.length) { cf.bass = cf.frames.map(function (_, i) { return bf.frames[Math.min(i, bf.frames.length - 1)]; }); bassOwn = true; } }
    var beats = opts.beats && opts.beats.length > 2 ? opts.beats.slice() : null;
    var duration = mono.length / rate;
    if (!beats) { var per = 60 / (opts.bpm || 100); beats = []; for (var t = 0; t < duration; t += per) beats.push(t); }
    // beat-synchronous chroma (half-beat resolution would double the states; beats are enough for charts)
    var segs = [];
    for (var i = 0; i < beats.length; i++) {
      var a = Math.max(0, Math.floor(beats[i] * fps)), b = Math.min(cf.frames.length, Math.max(a + 1, Math.floor((i + 1 < beats.length ? beats[i + 1] : duration) * fps)));
      var c = new Float32Array(12), bs = new Float32Array(12), e = 0, n = 0;
      for (var f = a; f < b; f++) { for (var k = 0; k < 12; k++) { c[k] += cf.frames[f][k]; bs[k] += cf.bass[f][k]; } e += cf.energy[f]; n++; }
      if (n) { for (k = 0; k < 12; k++) { c[k] /= n; bs[k] /= n; } e /= n; }
      var norm = 0; for (k = 0; k < 12; k++) norm += c[k] * c[k]; norm = Math.sqrt(norm) || 1; for (k = 0; k < 12; k++) c[k] /= norm;
      segs.push({ start: beats[i], end: i + 1 < beats.length ? beats[i + 1] : duration, c: c, bass: bs, energy: e });
    }
    var templates = chordTemplates(), S = templates.length, T = segs.length;
    var keyIdx = opts.key ? KEYS.indexOf(opts.key) : -1, scale = keyIdx >= 0 ? keyScale(keyIdx, opts.mode || "major") : null;
    var maxE = 0; segs.forEach(function (sg) { if (sg.energy > maxE) maxE = sg.energy; });
    // emissions
    var emit = new Float32Array(T * S);
    for (var ti = 0; ti < T; ti++) {
      var sg = segs[ti], silent = sg.energy < maxE * 0.02;
      var bmax = 0, bpc = -1; for (k = 0; k < 12; k++) if (sg.bass[k] > bmax) { bmax = sg.bass[k]; bpc = k; }
      for (var si = 0; si < S; si++) {
        var tp = templates[si], score;
        if (tp.root < 0) score = silent ? 0.9 : 0.25;
        else {
          score = 0; for (k = 0; k < 12; k++) score += sg.c[k] * tp.v[k];
          if (bpc === tp.root) score += bassOwn ? 0.14 : 0.08; else if (bpc >= 0 && !(tp.v[bpc] > 0)) score -= bassOwn ? 0.09 : 0.05;
          if (scale) { var inKey = tp.type === "" || tp.type === "m" || tp.type === "7" || tp.type === "sus4" || tp.type === "sus2" ? scale[tp.root] : scale[tp.root]; score += inKey ? 0.07 : -0.06; }
          if (tp.size > 3) score -= 0.05; // prefer simple triads unless the 7th is really there
          if (tp.type === "sus2" || tp.type === "add9" || tp.type === "dim") score -= 0.02;
          if (silent) score *= 0.5;
        }
        emit[ti * S + si] = score;
      }
    }
    // Viterbi: staying is cheap, changing costs; changes on downbeats cost less
    var stay = 0.0, change = opts.changeCost != null ? opts.changeCost : 0.16, bpb = opts.beatsPerBar || 4, phase = opts.phase || 0;
    var delta = new Float32Array(T * S), back = new Int16Array(T * S);
    for (si = 0; si < S; si++) delta[si] = emit[si];
    for (ti = 1; ti < T; ti++) {
      var downbeat = ((ti - phase) % bpb + bpb) % bpb === 0, cost = downbeat ? change * 0.45 : change;
      var bestPrev = 0, bestVal = -1e9;
      for (si = 0; si < S; si++) if (delta[(ti - 1) * S + si] > bestVal) { bestVal = delta[(ti - 1) * S + si]; bestPrev = si; }
      for (si = 0; si < S; si++) {
        var same = delta[(ti - 1) * S + si] + stay, other = bestVal - cost;
        if (same >= other) { delta[ti * S + si] = same + emit[ti * S + si]; back[ti * S + si] = si; }
        else { delta[ti * S + si] = other + emit[ti * S + si]; back[ti * S + si] = bestPrev; }
      }
    }
    var path = new Int16Array(T), bi = 0, bv = -1e9;
    for (si = 0; si < S; si++) if (delta[(T - 1) * S + si] > bv) { bv = delta[(T - 1) * S + si]; bi = si; }
    for (ti = T - 1; ti >= 0; ti--) { path[ti] = bi; bi = back[ti * S + bi]; }
    // merge into chord segments with bar / beat positions
    var out = [], cur = null;
    for (ti = 0; ti < T; ti++) {
      var tpl = templates[path[ti]], label = tpl.root < 0 ? "N" : KEYS[tpl.root] + tpl.type;
      var sgm = segs[ti], bmax2 = 0, bpc2 = -1; for (k = 0; k < 12; k++) if (sgm.bass[k] > bmax2) { bmax2 = sgm.bass[k]; bpc2 = k; }
      var barNo = Math.floor((ti - phase) / bpb) + 1, beatNo = ((ti - phase) % bpb + bpb) % bpb + 1;
      if (cur && cur.label === label) { cur.end = sgm.end; cur.beats++; cur.bassVotes[bpc2] = (cur.bassVotes[bpc2] || 0) + 1; cur.conf += emit[ti * S + path[ti]]; }
      else { cur = { label: label, root: tpl.root, type: tpl.type, start: sgm.start, end: sgm.end, bar: barNo, beat: beatNo, beats: 1, bassVotes: {}, conf: emit[ti * S + path[ti]] }; cur.bassVotes[bpc2] = 1; out.push(cur); }
    }
    out.forEach(function (sgm2) {
      var votes = sgm2.bassVotes, top = -1, topN = 0; Object.keys(votes).forEach(function (pc) { if (votes[pc] > topN) { topN = votes[pc]; top = Number(pc); } });
      if (sgm2.root >= 0 && top >= 0 && top !== sgm2.root && topN >= Math.max(2, sgm2.beats * 0.7)) { var tpl2 = templates.filter(function (q) { return q.root === sgm2.root && q.type === sgm2.type; })[0]; if (tpl2 && tpl2.v[top] > 0) sgm2.bass = KEYS[top]; }
      sgm2.conf = Math.round(Math.max(0, Math.min(1, sgm2.conf / sgm2.beats)) * 100) / 100; delete sgm2.bassVotes;
      sgm2.start = Math.round(sgm2.start * 1000) / 1000; sgm2.end = Math.round(sgm2.end * 1000) / 1000;
    });
    return { chords: out, beats: beats.length, beatsPerBar: bpb, phase: phase };
  }

  // ---------------------------------------------------------------- transcription
  function yinFrame(buf, off, n, rate, fmin, fmax) {
    var maxLag = Math.min(n >> 1, Math.floor(rate / fmin)), minLag = Math.max(2, Math.floor(rate / fmax)), d = new Float32Array(maxLag + 1), cm = new Float32Array(maxLag + 1), run = 0;
    for (var tau = 1; tau <= maxLag; tau++) { var s = 0; for (var i = 0; i < n - maxLag; i++) { var dv = buf[off + i] - buf[off + i + tau]; s += dv * dv; } d[tau] = s; run += s; cm[tau] = run ? s * tau / run : 1; }
    var tauBest = -1;
    for (tau = minLag; tau <= maxLag; tau++) if (cm[tau] < 0.15) { while (tau + 1 <= maxLag && cm[tau + 1] < cm[tau]) tau++; tauBest = tau; break; }
    if (tauBest < 0) { var mn = 1; for (tau = minLag; tau <= maxLag; tau++) if (cm[tau] < mn) { mn = cm[tau]; tauBest = tau; } if (mn > 0.5) return null; }
    var t0 = tauBest, y0 = cm[t0 - 1] || cm[t0], y1 = cm[t0], y2 = cm[t0 + 1] || cm[t0], den = y0 - 2 * y1 + y2, tf = den ? t0 + 0.5 * (y0 - y2) / den : t0;
    return { f0: rate / tf, aper: cm[tauBest] };
  }
  function median(arr) { var a = arr.slice().sort(function (x, y) { return x - y; }); return a.length ? a[a.length >> 1] : 0; }
  function transcribeMono(x, R, frame, hop, opts) {
    var n = Math.max(0, Math.floor((x.length - frame) / hop)), pitch = new Float32Array(n), conf = new Float32Array(n), rms = new Float32Array(n), fmin = opts.fmin || 55, fmax = opts.fmax || 1400;
    for (var f = 0; f < n; f++) {
      var off = f * hop, e = 0; for (var i = 0; i < frame; i++) e += x[off + i] * x[off + i]; rms[f] = Math.sqrt(e / frame);
      var y = rms[f] > 1e-4 ? yinFrame(x, off, frame, R, fmin, fmax) : null;
      if (y) { pitch[f] = 69 + 12 * Math.log2(y.f0 / 440); conf[f] = 1 - y.aper; } else { pitch[f] = 0; conf[f] = 0; }
    }
    var mx = 0; for (f = 0; f < n; f++) if (rms[f] > mx) mx = rms[f];
    var floor = mx * 0.04;
    // median-smooth the pitch track and decide voicing
    var sm = new Float32Array(n), voiced = new Uint8Array(n);
    for (f = 0; f < n; f++) { var win = []; for (var k = -2; k <= 2; k++) { var j = f + k; if (j >= 0 && j < n && pitch[j] > 0) win.push(pitch[j]); } sm[f] = win.length ? median(win) : 0; voiced[f] = rms[f] > floor && conf[f] > 0.6 && sm[f] > 0 ? 1 : 0; }
    // segment notes: pitch continuity (< 0.6 semitone) and energy re-attacks
    var notes = [], cur = null;
    for (f = 0; f < n; f++) {
      var attack = f > 2 && rms[f] > rms[f - 3] * 1.9 && rms[f] > floor * 2;
      if (voiced[f]) {
        if (cur && (Math.abs(sm[f] - cur.p) > 0.6 || attack)) { cur.end = f; notes.push(cur); cur = null; }
        if (!cur) cur = { start: f, p: sm[f], ps: [sm[f]], peak: rms[f] }; else { cur.ps.push(sm[f]); cur.p = median(cur.ps.slice(-8)); if (rms[f] > cur.peak) cur.peak = rms[f]; }
      } else if (cur) { var gap = 0; while (f + gap < n && !voiced[f + gap] && gap < 4) gap++; if (gap >= 3 || f + gap >= n) { cur.end = f; notes.push(cur); cur = null; } }
    }
    if (cur) { cur.end = n; notes.push(cur); }
    return notes.filter(function (nt) { return (nt.end - nt.start) * hop / R >= 0.045; }).map(function (nt) { return { midi: Math.round(median(nt.ps)), t0: (nt.start * hop + frame * 0.35) / R, t1: (nt.end * hop + frame * 0.35) / R, vel: Math.round(Math.min(127, 40 + 87 * Math.sqrt(nt.peak / mx))) }; });
  }
  // approximate polyphonic: spectral peaks -> harmonic salience per candidate pitch, iterative
  // pick-and-subtract (the picked note's harmonics leave the peak list), per-pitch tracking
  function transcribePoly(x, R, frame, hop, opts) {
    frame = 4096; hop = 512;
    var n = Math.max(0, Math.floor((x.length - frame) / hop)), w = hann(frame), re = new Float32Array(frame), im = new Float32Array(frame), lo = opts.low || 36, hi = opts.high || 96, nP = hi - lo + 1;
    var rms = new Float32Array(n), roll = [], f0s = [];
    for (var p = 0; p < nP; p++) f0s.push(440 * Math.pow(2, (lo + p - 69) / 12));
    for (var f = 0; f < n; f++) {
      var off = f * hop, e = 0; for (var i = 0; i < frame; i++) { var v = x[off + i] * w[i]; re[i] = v; im[i] = 0; e += v * v; } rms[f] = Math.sqrt(e / frame);
      fft(re, im);
      var mag = new Float32Array(frame >> 1), k; for (k = 1; k < frame >> 1; k++) mag[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]) / frame;
      var peaks = [], pmax = 0; // interpolated spectral peaks between 50 Hz and 5 kHz
      for (k = 2; k < frame >> 1 - 1; k++) { var fr = k * R / frame; if (fr < 50 || fr > 5000) continue; if (mag[k] > mag[k - 1] && mag[k] >= mag[k + 1] && mag[k] > 1e-5) { var y0 = mag[k - 1], y1 = mag[k], y2 = mag[k + 1], den = y0 - 2 * y1 + y2, d = den ? 0.5 * (y0 - y2) / den : 0; peaks.push({ f: (k + d) * R / frame, m: y1 }); if (y1 > pmax) pmax = y1; } }
      peaks = peaks.filter(function (pk) { return pk.m > pmax * 0.01; });
      var picked = [];
      for (var it = 0; it < 6 && peaks.length; it++) {
        var best = -1, bv = 0, bestUsed = null;
        for (p = 0; p < nP; p++) {
          var s = 0, used = [], f0 = f0s[p];
          for (var h = 1; h <= 8; h++) { var target = f0 * h, tol = target * 0.03, bm = 0, bi = -1; for (var q = 0; q < peaks.length; q++) { if (Math.abs(peaks[q].f - target) <= tol && peaks[q].m > bm) { bm = peaks[q].m; bi = q; } } if (bi >= 0) { s += bm / Math.pow(h, 0.8); used.push(bi); } if (h === 1 && bi < 0) { s = 0; break; } }
          if (s > bv) { bv = s; best = p; bestUsed = used; }
        }
        if (best < 0 || bv < 2e-4 || (picked.length && bv < picked[0].s * 0.07)) break;
        picked.push({ p: best, s: bv });
        // take the picked note's expected harmonic series out of the peaks (1/h roll-off from its fundamental);
        // whatever is left can still belong to another note an octave or a fifth up
        var m1 = peaks[bestUsed[0]].m, fb = f0s[best];
        bestUsed.forEach(function (q) { var h = Math.max(1, Math.round(peaks[q].f / fb)); peaks[q].m = Math.max(0, peaks[q].m - m1 * 0.85 / h); });
        peaks = peaks.filter(function (pk) { return pk.m > pmax * 0.01; });
      }
      roll.push(picked);
    }
    var mx = 0; for (f = 0; f < n; f++) if (rms[f] > mx) mx = rms[f];
    var notes = [], open = {};
    for (f = 0; f < n; f++) {
      var here = {}; roll[f].forEach(function (pk) { here[pk.p] = pk.s; });
      Object.keys(open).forEach(function (pk) { var o = open[pk]; if (here[pk] != null) { o.last = f; o.miss = 0; if (here[pk] > o.s) o.s = here[pk]; } else if (++o.miss > 4) { o.end = o.last + 1; if ((o.end - o.start) * hop / R >= 0.08) notes.push(o); delete open[pk]; } });
      Object.keys(here).forEach(function (pk) { if (!open[pk] && rms[f] > mx * 0.05) open[pk] = { p: Number(pk), start: f, last: f, miss: 0, s: here[pk] }; });
    }
    Object.keys(open).forEach(function (pk) { var o = open[pk]; o.end = o.last + 1; if ((o.end - o.start) * hop / R >= 0.08) notes.push(o); });
    var smax = 0; notes.forEach(function (nt) { if (nt.s > smax) smax = nt.s; });
    notes = notes.filter(function (nt) { return nt.s > smax * 0.06; });
    notes.sort(function (a, b) { return a.start - b.start || a.p - b.p; });
    return notes.map(function (nt) { return { midi: lo + nt.p, t0: (nt.start * hop + frame / 2) / R, t1: (nt.end * hop + frame / 2) / R, vel: Math.round(Math.min(127, 50 + 70 * Math.sqrt(nt.s / (smax || 1)))) }; });
  }
  function quantizeNotes(notes, grid, bpb, div) {
    var period = grid.period, first = grid.first, q = 1 / (div || 4), out = [];
    notes.forEach(function (nt) {
      var b0 = (nt.t0 - first) / period, b1 = (nt.t1 - first) / period, s = Math.round(b0 / q) * q, e = Math.round(b1 / q) * q;
      if (e <= s) e = s + q;
      out.push({ midi: nt.midi, start: Math.round(s * 1000) / 1000, dur: Math.round((e - s) * 1000) / 1000, vel: nt.vel, t0: Math.round(nt.t0 * 1000) / 1000, t1: Math.round(nt.t1 * 1000) / 1000 });
    });
    // merge identical overlapping notes created by quantization
    out.sort(function (a, b) { return a.start - b.start || a.midi - b.midi; });
    var merged = [];
    out.forEach(function (nt) { var last = merged[merged.length - 1]; if (last && last.midi === nt.midi && nt.start < last.start + last.dur - 1e-6) { last.dur = Math.max(last.dur, nt.start + nt.dur - last.start); } else merged.push(nt); });
    return merged;
  }
  function transcribe(mono, rate, opts) {
    opts = opts || {};
    var R = 22050, x = resample(mono, rate, R), frame = 2048, hop = 256;
    var mode = opts.mode || "auto";
    if (mode === "auto") { // guess: many simultaneous strong peaks -> polyphonic
      var probe = transcribePoly(x.subarray(0, Math.min(x.length, R * 20)), R, frame, hop, opts), multi = 0, cnt = 0;
      for (var t = 0.05; t < 20; t += 0.1) { var c = probe.filter(function (nt) { return nt.t0 <= t && nt.t1 > t; }).length; if (c) { cnt++; if (c > 1) multi++; } }
      mode = cnt && multi / cnt > 0.35 ? "poly" : "mono";
    }
    var raw = mode === "poly" ? transcribePoly(x, R, frame, hop, opts) : transcribeMono(x, R, frame, hop, opts);
    var grid = opts.grid && opts.grid.period ? opts.grid : { period: 60 / (opts.bpm || 100), first: 0 };
    var notes = quantizeNotes(raw, grid, opts.beatsPerBar || 4, opts.division || 4);
    var lowest = 127, highest = 0; notes.forEach(function (nt) { if (nt.midi < lowest) lowest = nt.midi; if (nt.midi > highest) highest = nt.midi; });
    return { mode: mode, notes: notes, lowest: notes.length ? lowest : 60, highest: notes.length ? highest : 72, grid: grid, beatsPerBar: opts.beatsPerBar || 4 };
  }

  // ---------------------------------------------------------------- drums: kick / snare / hi-hat / crash from a drum track
  // band-wise spectral flux (low 35-150 Hz, mid 150-2000, noise 2-6 kHz, top 7-16 kHz), peaks picked against a moving
  // median; each hit is named by which bands jumped, quantized to the beat grid (16ths).
  function drumsOf(mono, rate, opts) {
    opts = opts || {};
    var R = 22050, x = resample(mono, rate, R), frame = 1024, hop = 256, fps = R / hop, w = hann(frame), re = new Float32Array(frame), im = new Float32Array(frame);
    var nF = Math.max(1, Math.floor((x.length - frame) / hop)), BANDS = [[35, 150], [150, 2000], [2000, 6000], [7000, 16000]], nb = BANDS.length;
    var binBand = new Int8Array(frame >> 1); for (var k = 1; k < frame >> 1; k++) { var f = k * R / frame; binBand[k] = -1; for (var b = 0; b < nb; b++) if (f >= BANDS[b][0] && f < BANDS[b][1]) binBand[k] = b; }
    var prev = new Float32Array(frame >> 1), flux = [], lev = [];
    for (b = 0; b < nb; b++) { flux.push(new Float32Array(nF)); lev.push(new Float32Array(nF)); }
    for (var fi = 0; fi < nF; fi++) {
      var off = fi * hop; for (var i = 0; i < frame; i++) { re[i] = x[off + i] * w[i]; im[i] = 0; } fft(re, im);
      for (k = 1; k < frame >> 1; k++) { var bb = binBand[k], mag = Math.log(1 + 100 * Math.sqrt(re[k] * re[k] + im[k] * im[k]) / frame); if (bb >= 0) { var d = mag - prev[k]; if (d > 0) flux[bb][fi] += d; lev[bb][fi] += mag; } prev[k] = mag; }
    }
    function peaks(arr, sens, minGap) {
      var out = [], win = Math.round(fps * 0.4), mx = 0; for (var i2 = 0; i2 < arr.length; i2++) if (arr[i2] > mx) mx = arr[i2];
      if (!mx) return out;
      for (i2 = 2; i2 < arr.length - 2; i2++) {
        if (!(arr[i2] >= arr[i2 - 1] && arr[i2] >= arr[i2 + 1] && arr[i2] > arr[i2 - 2])) continue;
        var a = Math.max(0, i2 - win), z = Math.min(arr.length, i2 + win), loc = []; for (var j = a; j < z; j += 2) loc.push(arr[j]); loc.sort(function (p, q) { return p - q; });
        var thr = loc[loc.length >> 1] * 1.5 + mx * sens;
        if (arr[i2] > thr && (!out.length || i2 - out[out.length - 1] >= minGap)) out.push(i2);
      }
      return out;
    }
    // every hit once (the sum of the bands, each scaled to its own loud hits), then named by which bands jumped
    function p95(arr) { var pk = []; for (var i4 = 1; i4 < arr.length - 1; i4++) if (arr[i4] > arr[i4 - 1] && arr[i4] >= arr[i4 + 1]) pk.push(arr[i4]); pk.sort(function (p, q2) { return p - q2; }); return pk.length ? pk[Math.floor(pk.length * 0.95)] || pk[pk.length - 1] : 1; }
    var scale = flux.map(p95), sum = new Float32Array(nF);
    for (fi = 0; fi < nF; fi++) for (b = 0; b < nb; b++) sum[fi] += flux[b][fi] / (scale[b] || 1);
    var hitsAt = peaks(sum, 0.1, Math.round(fps * 0.05));
    var grid = opts.grid && opts.grid.period ? opts.grid : { period: 60 / (opts.bpm || 100), first: 0 }, q = 0.25;
    function beat(fr) { return Math.round(((fr * hop) / R - grid.first) / grid.period / q) * q; }
    var out = { kick: [], snare: [], hat: [], crash: [] }, maxTop = 0;
    hitsAt.forEach(function (fr) { if (lev[3][fr + 1] > maxTop) maxTop = lev[3][fr + 1]; });
    hitsAt.forEach(function (fr) {
      var v = []; for (b = 0; b < nb; b++) { var m2 = 0; for (var j = Math.max(0, fr - 1); j <= Math.min(nF - 1, fr + 2); j++) m2 = Math.max(m2, flux[b][j]); v.push(m2 / (scale[b] || 1)); }
      var low = v[0], mid = v[1], noise = v[2], top = v[3], at = beat(fr), isSnare = mid >= 0.45 && noise >= 0.35 && mid >= low * 1.0 && mid >= top * 0.5;
      if (low >= 0.45 && low >= mid * 0.85) out.kick.push(at);
      if (isSnare) out.snare.push(at);
      if (top >= 0.3 && (!isSnare || top > noise * 1.35)) {
        var sustain = 0, n2 = 0; for (j = fr + Math.round(fps * 0.2); j < Math.min(nF, fr + Math.round(fps * 0.5)); j++) { sustain += lev[3][j]; n2++; }
        sustain = n2 ? sustain / n2 : 0;
        (sustain > lev[3][Math.min(nF - 1, fr + 1)] * 0.55 && top >= 0.6 ? out.crash : out.hat).push(at);
      }
    });
    Object.keys(out).forEach(function (v) { var seen = {}; out[v] = out[v].filter(function (b2) { if (b2 < 0 || seen[b2]) return false; seen[b2] = 1; return true; }).sort(function (p, q2) { return p - q2; }); });
    return out;
  }

  function analyze(mono, rate, opts) {
    opts = opts || {};
    var R = 11025, x = resample(mono, rate, R), frame = 512, hop = 128, fps = R / hop;
    var on = onsets(x, R, frame, hop), env = on.env;
    var tp = opts.bpm ? { bpm: opts.bpm, strength: 1 } : tempo(env, fps, opts.minBpm || 50, opts.maxBpm || 220, opts.preferBpm || 115);
    var beatFrames = trackBeats(env, fps, tp.bpm, 300);
    var beatTimes = beatFrames.map(function (f) { return (f * hop + frame / 2) / R; });
    var fit = fitGrid(beatTimes), bpb = opts.beatsPerBar || 4;
    var phase = downbeatPhase(env, on.bass, beatFrames, bpb);
    var bpm = fit ? 60 / fit.period : tp.bpm;
    // the first downbeat on the fitted grid, kept in the beat list so the first bar isn't lost
    var firstDown = fit ? fit.first + fit.period * phase : (beatTimes[phase] || 0);
    while (fit && firstDown - fit.period * bpb >= -0.02) firstDown -= fit.period * bpb;
    var ch = chroma(x, R), key = detectKey(ch);
    var tcands = opts.bpm ? [] : tempoCandidates(env, fps, opts.minBpm || 50, opts.maxBpm || 220, opts.preferBpm || 115);
    var hits = findHits(env, on.bass, fps, fps * 60 / bpm).map(function (f) { return (f * hop + frame / 2) / R; });
    var overview = []; var per = Math.max(1, Math.floor(on.energy.length / 600));
    for (var i = 0; i < on.energy.length; i += per) { var m = 0; for (var k = i; k < Math.min(on.energy.length, i + per); k++) if (on.energy[k] > m) m = on.energy[k]; overview.push(Math.round(m * 1000) / 1000); }
    return {
      bpm: Math.round(bpm * 100) / 100, bpmRaw: Math.round(tp.bpm * 100) / 100, tempoStrength: tp.strength,
      beats: beatTimes.map(function (t) { return Math.round(t * 10000) / 10000; }), phase: phase, beatsPerBar: bpb,
      grid: fit ? { period: fit.period, first: Math.max(0, firstDown), residualMs: Math.round(fit.residual * 1000), steady: fit.residual < 0.02 } : null,
      key: key.key, mode: key.mode, keyConfidence: Math.round(key.confidence * 100) / 100, chroma: Array.from(ch), keyCandidates: keyCandidates(ch), tempoCandidates: tcands,
      hits: hits.map(function (t) { return Math.round(t * 1000) / 1000; }), overview: overview, duration: mono.length / rate
    };
  }

  function keyOnly(mono, rate) {
    var x = resample(mono, rate, 11025), ch = chroma(x, 11025), k = detectKey(ch);
    return { key: k.key, mode: k.mode, keyConfidence: Math.round(k.confidence * 100) / 100, chroma: Array.from(ch) };
  }

  onmessage = function (e) {
    var m = e.data;
    try {
      if (m.cmd === "analyze") postMessage({ id: m.id, result: analyze(m.mono, m.rate, m.opts) });
      else if (m.cmd === "key") postMessage({ id: m.id, result: keyOnly(m.mono, m.rate) });
      else if (m.cmd === "chords") postMessage({ id: m.id, result: chordsOf(m.mono, m.rate, m.opts) });
      else if (m.cmd === "transcribe") postMessage({ id: m.id, result: transcribe(m.mono, m.rate, m.opts) });
      else if (m.cmd === "drums") postMessage({ id: m.id, result: drumsOf(m.mono, m.rate, m.opts) });
    } catch (error) { postMessage({ id: m.id, error: String(error && error.message || error) }); }
  };
};
