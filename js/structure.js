/* Central Pedal - finding a song's sections (Intro, Verse, Pre-Chorus, Chorus, Bridge, Instrumental, Tag, Outro)
 * from its tracks. Bar by bar on the beat grid: where the vocals sing (from the vocal stems - the stem splitter
 * makes them), how loud the band is, and the harmony (a chroma of the music, without drums). Changes in those make
 * the section boundaries (on 2- and 4-bar phrases); parts that sound alike are the same kind of section; the one
 * that comes back most and loudest is the chorus, the first other one that comes back is the verse, a short one
 * just before each chorus is the pre-chorus, a sung part heard once after the first chorus is the bridge.
 * Used when a song comes in without sections (a pack with an Ableton set has its own), and from the song editor. */
(function () {
  "use strict";
  var PP = window.PP; if (!PP) return;
  function T() { return window.PPTracks; }
  var VOCAL = { vocals: 1 }, SKIP = { click: 1, guide: 1 }, HARM_SKIP = { click: 1, guide: 1, drums: 1, vocals: 1 };

  // ------------------------------------------------------------------ a small FFT (radix 2, in place)
  function fft(re, im) {
    var n = re.length, i, j = 0, k, len, ang, wr, wi, cr, ci, tr, ti, h;
    for (i = 1; i < n; i++) { var bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { tr = re[i]; re[i] = re[j]; re[j] = tr; tr = im[i]; im[i] = im[j]; im[j] = tr; } }
    for (len = 2; len <= n; len <<= 1) {
      ang = -2 * Math.PI / len; wr = Math.cos(ang); wi = Math.sin(ang); h = len >> 1;
      for (i = 0; i < n; i += len) { cr = 1; ci = 0; for (k = 0; k < h; k++) { var a = i + k, b = a + h; tr = re[b] * cr - im[b] * ci; ti = re[b] * ci + im[b] * cr; re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti; var ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr; } }
    }
  }
  var N = 4096, WIN = (function () { var w = new Float32Array(N); for (var i = 0; i < N; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N); return w; })();
  function chromaAt(x, at, rate, acc) {
    var re = new Float32Array(N), im = new Float32Array(N), i;
    for (i = 0; i < N; i++) re[i] = (x[at + i] || 0) * WIN[i];
    fft(re, im);
    for (i = 2; i < N / 2; i++) {
      var f = i * rate / N; if (f < 55 || f > 2000) continue;
      var pc = Math.round(12 * Math.log2(f / 440) + 9); pc = ((pc % 12) + 12) % 12;
      acc[pc] += Math.sqrt(re[i] * re[i] + im[i] * im[i]);
    }
  }
  function norm(v) { var s = 0, i; for (i = 0; i < v.length; i++) s += v[i] * v[i]; s = Math.sqrt(s) || 1; for (i = 0; i < v.length; i++) v[i] /= s; return v; }
  function cos(a, b) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
  function pct(arr, p) { var a = Array.from(arr).sort(function (x, y) { return x - y; }); return a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))] : 0; }
  var tick = function () { return new Promise(function (r) { setTimeout(r, 0); }); };

  // ------------------------------------------------------------------ bar by bar
  async function features(s) {
    var t = T().data(s), g = T().grid(s); if (!g || !g.bars || g.bars.length < 4) return null;
    var voc = null, harm = null, all = null, rate = 0, len = 0, hasVoc = false;
    for (var i = 0; i < t.stems.length; i++) {
      var st = t.stems[i], role = st.bus === "click" ? "click" : st.role || "music"; if (SKIP[role] || st.mute) continue;
      var rec = await T().getStem(st.id); if (!rec) continue;
      rate = rate || rec.rate || 48000;
      var L = new Int16Array(rec.L), R = rec.R ? new Int16Array(rec.R) : null, n = L.length, gain = (st.gain == null ? 1 : st.gain) / 32768 / (R ? 2 : 1);
      if (!all) { len = n; all = new Float32Array(n); voc = new Float32Array(n); harm = new Float32Array(n); }
      n = Math.min(n, len);
      var isV = VOCAL[role] || /vocal|vox|voice|bgv|lead/i.test(st.name || ""), isH = !HARM_SKIP[role] && !isV;
      if (isV) hasVoc = true;
      for (var k = 0; k < n; k++) { var v = (R ? L[k] + R[k] : L[k]) * gain; all[k] += v; if (isV) voc[k] += v; else if (isH) harm[k] += v; }
      await tick();
    }
    if (!all) return null;
    var dur = len / rate, bars = g.bars.filter(function (b) { return b < dur - 0.5; }), nb = bars.length, out = [];
    var harmHas = false; for (var q = 0; q < harm.length; q += 997) if (harm[q] !== 0) { harmHas = true; break; }
    var src = harmHas ? harm : all;
    for (var b = 0; b < nb; b++) {
      var a = Math.max(0, Math.floor(bars[b] * rate)), e = Math.min(len, Math.floor((b + 1 < nb ? bars[b + 1] : bars[b] + (bars[b] - (bars[b - 1] || 0))) * rate)), sv = 0, se = 0, cnt = 0;
      for (var j = a; j < e; j += 8) { var x = all[j], y = voc[j]; se += x * x; sv += y * y; cnt++; }
      var ch = new Float32Array(12), span = e - a;
      for (var f = 0; f < 3; f++) { var at = a + Math.floor(span * (f + 1) / 4) - N / 2; if (at > 0 && at + N < len) chromaAt(src, at, rate, ch); }
      out.push({ bar: b + 1, t: bars[b], energy: Math.sqrt(se / Math.max(1, cnt)), vocal: Math.sqrt(sv / Math.max(1, cnt)), chroma: norm(ch) });
      if (b % 16 === 15) await tick();
    }
    return { bars: out, hasVocals: hasVoc, bpb: g.bpb || 4 };
  }

  // ------------------------------------------------------------------ boundaries and labels
  function segment(F) {
    var bars = F.bars, nb = bars.length; if (nb < 8) return null;
    var maxE = pct(bars.map(function (b) { return b.energy; }), 0.95) || 1;
    var vThr = F.hasVocals ? Math.max(0.004, 0.22 * pct(bars.map(function (b) { return b.vocal; }), 0.9)) : 0;
    var act = bars.map(function (b) { return F.hasVocals ? b.vocal > vThr : true; });
    // (a bar of breath inside a sung phrase stays sung; one stray sung bar in a gap doesn't)
    var sm = act.map(function (v, i) { var c = 0, n = 0; for (var k = i - 1; k <= i + 1; k++) if (k >= 0 && k < nb) { n++; if (act[k]) c++; } return c * 2 > n; });
    // the harmony of each bar against the song's usual harmony (all chroma look alike before that)
    var avg = new Float32Array(12); bars.forEach(function (b) { for (var w = 0; w < 12; w++) avg[w] += b.chroma[w] / nb; });
    bars.forEach(function (b) { var c = new Float32Array(12); for (var w = 0; w < 12; w++) c[w] = b.chroma[w] - avg[w]; b.cchroma = norm(c); });
    var feat = bars.map(function (b) { var v = Array.from(b.cchroma).map(function (x) { return x * 0.9; }); v.push((b.energy / maxE - 0.5) * 1.2); return norm(v); });
    // novelty: a checkerboard over the self-similarity, 4 bars each side
    var W = 4, nov = new Float32Array(nb);
    for (var c = W; c <= nb - W; c++) { var sum = 0; for (var i = -W; i < W; i++) for (var j = -W; j < W; j++) { var same = (i < 0) === (j < 0); sum += (same ? 1 : -1) * cos(feat[c + i], feat[c + j]); } nov[c] = sum / (4 * W * W); }
    var mean = 0, sd = 0; for (var m = 0; m < nb; m++) mean += nov[m]; mean /= nb; for (m = 0; m < nb; m++) sd += (nov[m] - mean) * (nov[m] - mean); sd = Math.sqrt(sd / nb);
    var cand = {};   // bar index -> strength
    function snap(i, step) { var r = Math.round(i / step) * step; return Math.max(0, Math.min(nb, r)); }
    for (m = 1; m < nb; m++) if (sm[m] !== sm[m - 1]) { var p = snap(m, 2); if (p > 0 && p < nb) cand[p] = Math.max(cand[p] || 0, 3); }
    for (m = 2; m < nb - 2; m++) if (nov[m] > mean + 0.6 * sd && nov[m] >= nov[m - 1] && nov[m] >= nov[m + 1] && nov[m] >= nov[m - 2] && nov[m] >= nov[m + 2]) { var q = snap(m, 4); if (Math.abs(q - m) > 1) q = snap(m, 2); if (q > 0 && q < nb) cand[q] = Math.max(cand[q] || 0, 1 + (nov[m] - mean) / (sd || 1) * 0.3 + (q % 8 === 0 ? 0.5 : 0)); }
    // a clear step in loudness (the band kicks in for a chorus, drops out for a bridge) - over 2 bars each side
    for (m = 2; m <= nb - 2; m++) {
      var before = (bars[m - 2].energy + bars[m - 1].energy) / 2, after = (bars[m].energy + bars[m + 1].energy) / 2, step = Math.abs(after - before) / maxE;
      if (step > 0.15 && m % 2 === 0) cand[m] = Math.max(cand[m] || 0, 1.5 + step);
    }
    var bounds = Object.keys(cand).map(Number).sort(function (a, b) { return a - b; });
    // segments of at least 4 bars: drop the weaker boundary of any pair that is too close
    var changed = true;
    while (changed) {
      changed = false; var list = [0].concat(bounds, [nb]);
      for (var x = 1; x < list.length; x++) if (list[x] - list[x - 1] < 4) {
        var a = list[x - 1], b = list[x], sa = a === 0 ? 99 : cand[a], sb = b === nb ? 99 : cand[b];
        bounds.splice(bounds.indexOf(sa <= sb ? a : b), 1); changed = true; break;
      }
    }
    var cuts = [0].concat(bounds, [nb]), segs = [];
    for (var y = 1; y < cuts.length; y++) {
      var from = cuts[y - 1], to = cuts[y], ch = new Float32Array(12), en = 0, vs = 0;
      for (var z = from; z < to; z++) { for (var w = 0; w < 12; w++) ch[w] += bars[z].cchroma[w]; en += bars[z].energy; if (sm[z]) vs++; }
      segs.push({ from: from, to: to, len: to - from, chroma: norm(ch), energy: en / (to - from) / maxE, sung: vs / (to - from) > 0.5 });
    }
    return segs;
  }
  function label(segs, hasVocals) {
    var n = segs.length, i;
    var medE = pct(segs.map(function (s) { return s.energy; }), 0.5);
    var cand = segs.map(function (s, k) { return hasVocals ? s.sung : !((k === 0 || k === n - 1) && s.energy < 0.7 * medE); });
    // parts that sound alike (harmony + loudness) are the same kind
    var groups = [];
    segs.forEach(function (s, k) {
      if (!cand[k]) { s.group = -1; return; }
      var best = -1, bs = 0.55;
      groups.forEach(function (g, gi) { var sim = cos(g.chroma, s.chroma) - Math.abs(g.energy - s.energy) * 0.35; if (sim > bs) { bs = sim; best = gi; } });
      if (best < 0) { groups.push({ chroma: s.chroma, energy: s.energy, members: [k] }); s.group = groups.length - 1; }
      else { var g = groups[best]; g.members.push(k); g.energy = (g.energy * (g.members.length - 1) + s.energy) / g.members.length; s.group = best; }
    });
    var chorus = -1, cs = -1;
    groups.forEach(function (g, gi) { var sc = g.energy + (g.members.length >= 2 ? 0.25 + 0.05 * g.members.length : 0); if (sc > cs) { cs = sc; chorus = gi; } });
    var firstChorus = chorus >= 0 ? groups[chorus].members[0] : n;
    var verse = -1, vf = n + 1;
    groups.forEach(function (g, gi) { if (gi === chorus) return; var first = g.members[0]; if ((g.members.length >= 2 || first < firstChorus) && first < vf) { vf = first; verse = gi; } });
    var names = [], vn = 0;
    for (i = 0; i < n; i++) {
      var s = segs[i], nm;
      if (s.group < 0) nm = i === 0 ? "Intro" : i === n - 1 ? "Outro" : s.len <= 4 ? "Turnaround" : "Instrumental";
      else if (s.group === chorus) nm = (i === n - 1 || (i === n - 2 && segs[n - 1].group < 0)) && s.len <= 4 && i > firstChorus ? "Tag" : "Chorus";
      else if (s.group === verse) nm = "Verse";
      else if (groups[s.group].members.length >= 2 && groups[s.group].members.every(function (k) { return k + 1 < n && segs[k + 1].group === chorus; })) nm = "Pre-Chorus";
      else if (i > firstChorus && groups[s.group].members.length === 1 && s.len > 4) nm = "Bridge";
      else if (i + 1 < n && segs[i + 1].group === chorus && s.len <= 4) nm = "Pre-Chorus";
      else if (i > firstChorus && groups[s.group].members.length === 1) nm = "Bridge";
      else nm = i < firstChorus ? "Verse" : "Bridge";
      names.push(nm);
    }
    // a pre-chorus is a pre-chorus everywhere it comes back
    var out = [];
    for (i = 0; i < n; i++) {
      if (out.length && out[out.length - 1].name === names[i] && names[i] !== "Verse" && names[i] !== "Chorus") { out[out.length - 1].to = segs[i].to; continue; }
      if (out.length && names[i] === "Verse" && out[out.length - 1].name === "Verse" && segs[i].group === segs[i - 1].group && out[out.length - 1].to - out[out.length - 1].from < 16) { out[out.length - 1].to = segs[i].to; continue; }
      if (out.length && names[i] === "Chorus" && out[out.length - 1].name === "Chorus" && out[out.length - 1].to - out[out.length - 1].from < 8) { out[out.length - 1].to = segs[i].to; continue; }
      out.push({ name: names[i], from: segs[i].from, to: segs[i].to });
    }
    out.forEach(function (o) { if (o.name === "Verse") o.name = "Verse " + (++vn); });
    var bn = out.filter(function (o) { return o.name === "Bridge"; }).length, bi = 0;
    if (bn > 1) out.forEach(function (o) { if (o.name === "Bridge") o.name = "Bridge " + (++bi); });
    return out;
  }

  // the song's sections, found from its tracks; replaces the ones it has unless keep is set
  async function detect(s, opts) {
    opts = opts || {}; var t = T().data(s);
    if (opts.keep && t.sections.length) return t.sections;
    var F = await features(s); if (!F) return null;
    var segs = segment(F); if (!segs || segs.length < 2) return null;
    var parts = label(segs, F.hasVocals);
    t.sections = parts.map(function (p) { return { id: PP.id(), name: p.name, bar: p.from + 1, pad: -1, transition: "inherit", cue: "auto", lyrics: "", page: 0, found: true }; });
    PP.persistSoon();
    return t.sections;
  }
  window.PPStructure = { detect: detect, features: features, segment: segment, label: label, debug: async function (s) { var F = await features(s), sg = segment(F); label(sg, F.hasVocals); return sg.map(function (x) { return x.from + 1 + "-" + x.to + " g" + x.group + (x.sung ? " sung" : "") + " e" + x.energy.toFixed(2); }); } };
})();
