/* Central Pedal - practice mixes. One stereo file per song for each musician: their part louder (or alone, or
 * left out), the click and the guide or not, slower to learn it (the pitch stays), in another key, a count-in.
 * They are made here from the song's tracks and kept on the Central Pedal - the band opens
 * http://<pedal>.local:8080/practice/ on their phones - or put on a USB stick, downloaded, or (Central Pedal
 * Control) copied into a folder on the Mac. Every setting is in the dialog (Tracks → 🎧 Practice mixes) and is
 * kept with the project; the mixes themselves (the list) can be renamed, added, changed or removed. */
(function () {
  "use strict";
  var PP = window.PP; if (!PP) return;
  var esc = PP.escapeHtml, MEDIA = "http://127.0.0.1:8766";
  function T() { return window.PPTracks; }
  function project() { return PP.project(); }
  function $(s, r) { return (r || document).querySelector(s); }
  function driverOn() { return !!(T() && T().driverOn()); }

  var ROLES = ["click", "guide", "drums", "bass", "keys", "guitar", "vocals", "music"];
  var ROLE_LABEL = { click: "Click", guide: "Guide", drums: "Drums", bass: "Bass", keys: "Keys", guitar: "Guitars", vocals: "Vocals", music: "Other" };
  var LEVELS = [["solo", "Solo"], ["+9", "+9 dB"], ["+6", "+6 dB"], ["+3", "+3 dB"], ["0", "Normal"], ["-3", "−3 dB"], ["-6", "−6 dB"], ["-12", "−12 dB"], ["-20", "−20 dB"], ["off", "Off"]];
  var CUE_ROLES = { click: 1, guide: 1 };

  function levels(o) { var l = {}; ROLES.forEach(function (r) { l[r] = "0"; }); Object.keys(o || {}).forEach(function (k) { l[k] = o[k]; }); return l; }
  function defaultMixes() {
    return [
      { id: PP.id(), name: "Full band", on: true, levels: levels() },
      { id: PP.id(), name: "Drums", on: true, levels: levels({ drums: "+6" }) },
      { id: PP.id(), name: "Bass", on: true, levels: levels({ bass: "+6" }) },
      { id: PP.id(), name: "Keys", on: true, levels: levels({ keys: "+6" }) },
      { id: PP.id(), name: "Guitars", on: true, levels: levels({ guitar: "+6" }) },
      { id: PP.id(), name: "Vocals", on: true, levels: levels({ vocals: "+6" }) },
      { id: PP.id(), name: "Listening (no click)", on: false, levels: levels({ click: "off", guide: "off" }) }
    ];
  }
  var DEFAULTS = {
    songs: "setlist", picked: [], tempoMode: "song", tempo: 100, keyMode: "song", key: 0,
    clickSource: "auto", clickSound: "wood", clickSub: "song", clickAccent: true, clickDb: 0, split: "off", countIn: 1, songMix: true,
    level: "normalize", peakDb: -1, fadeMs: 1500, trimEnd: true,
    format: "wav16", kbps: 192, rate: "song", names: "{n}. {song} ({mix})", folder: "", playlist: true,
    dest: "pedal", share: "open", title: ""
  };
  function cfg() {
    var p = project(), c = p.practice || (p.practice = {});
    Object.keys(DEFAULTS).forEach(function (k) { if (c[k] == null) c[k] = Array.isArray(DEFAULTS[k]) ? [] : DEFAULTS[k]; });
    if (!Array.isArray(c.mixes) || !c.mixes.length) c.mixes = defaultMixes();
    c.mixes.forEach(function (m) { if (!m.id) m.id = PP.id(); m.levels = levels(m.levels); if (m.on == null) m.on = true; if (!m.name) m.name = "Mix"; });
    c.tempo = Math.max(50, Math.min(150, Number(c.tempo) || 100));
    c.key = Math.max(-6, Math.min(6, Math.round(Number(c.key) || 0)));
    c.countIn = Math.max(0, Math.min(4, Math.round(Number(c.countIn) || 0)));
    return c;
  }

  // ------------------------------------------------------------------ DSP (plain JS, no audio device needed)
  function dB(v) { return Math.pow(10, v / 20); }
  function roleGain(mix, role, anySolo) {
    var v = mix.levels[role] == null ? "0" : String(mix.levels[role]);
    if (v === "off") return 0;
    if (anySolo && !CUE_ROLES[role] && v !== "solo") return 0;
    return v === "solo" ? 1 : dB(Number(v) || 0);
  }
  function hann(n) { var w = new Float32Array(n); for (var i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n); return w; }
  var tick = function () { return new Promise(function (r) { setTimeout(r, 0); }); };

  // WSOLA: where each frame is read from, so the song gets longer (f > 1) or shorter without its pitch changing.
  // Worked out once per song (on the whole band), then the same frames are used for every mix.
  var WN = 2048, WH = 1024;
  async function stretchPlan(mono, f, cancelled) {
    var inLen = mono.length, outLen = Math.round(inLen * f), Ha = WH / f, tol = 256, half = WN / 2, pos = [], prev = -1;
    for (var k = 0; k * WH < outLen; k++) {
      var nom = Math.round(k * Ha), p = nom;
      if (prev >= 0) {
        var tgt = prev + WH;
        if (tgt + half < inLen) {
          var lo = Math.max(0, nom - tol), hi = Math.min(inLen - half - 1, nom + tol), best = nom, bestC = -Infinity, d, j, c, e;
          for (d = lo; d <= hi; d += 8) { c = 0; e = 1e-9; for (j = 0; j < half; j += 8) { var b = mono[d + j]; c += mono[tgt + j] * b; e += b * b; } c /= Math.sqrt(e); if (c > bestC) { bestC = c; best = d; } }
          var lo2 = Math.max(lo, best - 8), hi2 = Math.min(hi, best + 8); bestC = -Infinity;
          for (d = lo2; d <= hi2; d++) { c = 0; e = 1e-9; for (j = 0; j < half; j += 2) { var b2 = mono[d + j]; c += mono[tgt + j] * b2; e += b2 * b2; } c /= Math.sqrt(e); if (c > bestC) { bestC = c; p = d; } }
        }
      }
      pos.push(p); prev = p;
      if (k % 400 === 399) { await tick(); if (cancelled && cancelled()) throw new Error("cancelled"); }
    }
    return { pos: pos, outLen: outLen };
  }
  function applyPlan(ch, plan, win) {
    var inLen = ch.length, out = new Float32Array(plan.outLen + WN), ws = new Float32Array(plan.outLen + WN);
    for (var k = 0; k < plan.pos.length; k++) {
      var op = k * WH, p = plan.pos[k];
      for (var j = 0; j < WN; j++) { var i = p + j, w = win[j]; if (i < inLen) out[op + j] += ch[i] * w; ws[op + j] += w; }
    }
    var r = new Float32Array(plan.outLen);
    for (var n = 0; n < plan.outLen; n++) r[n] = ws[n] > 1e-3 ? out[n] / ws[n] : out[n];
    return r;
  }
  // read `ch` `q` times faster (q > 1: higher and shorter), 4-point Hermite
  function resample(ch, q) {
    if (Math.abs(q - 1) < 1e-7) return ch;
    var n = Math.floor(ch.length / q), out = new Float32Array(n), last = ch.length - 1;
    for (var i = 0; i < n; i++) {
      var x = i * q, k = Math.floor(x), t = x - k;
      var y0 = ch[k > 0 ? k - 1 : 0], y1 = ch[k], y2 = ch[k + 1 <= last ? k + 1 : last], y3 = ch[k + 2 <= last ? k + 2 : last];
      var c1 = 0.5 * (y2 - y0), c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3, c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
      out[i] = ((c3 * t + c2) * t + c1) * t + y1;
    }
    return out;
  }
  // a click sound (the song's level and sound are settings)
  var clickCache = {};
  function clickSound(kind, accent, rate) {
    var key = kind + accent + rate; if (clickCache[key]) return clickCache[key];
    var len = Math.round(rate * (kind === "beep" ? 0.07 : 0.045)), b = new Float32Array(len), seed = 1;
    var fq = kind === "beep" ? (accent ? 1320 : 880) : kind === "stick" ? 0 : (accent ? 1750 : 1150), tau = kind === "beep" ? 0.03 : kind === "stick" ? 0.006 : 0.012, prevN = 0;
    for (var i = 0; i < len; i++) {
      var t = i / rate, env = Math.exp(-t / tau), v;
      if (kind === "stick") { seed = (seed * 16807) % 2147483647; var nz = seed / 1073741823.5 - 1; v = (nz - prevN); prevN = nz; v *= accent ? 0.9 : 0.6; }
      else v = Math.sin(2 * Math.PI * fq * t) * (accent ? 0.85 : 0.6) + (kind === "wood" ? Math.sin(2 * Math.PI * fq * 2.7 * t) * 0.15 : 0);
      b[i] = v * env * Math.min(1, i / (rate * 0.0005));
    }
    return (clickCache[key] = b);
  }
  function addClick(L, R, at, buf, gain) {
    var s = Math.round(at); for (var i = 0; i < buf.length; i++) { var k = s + i; if (k < 0) continue; if (k >= L.length) break; L[k] += buf[i] * gain; if (R && R !== L) R[k] += buf[i] * gain; }
  }
  function encodeWav(L, R, rate, bits) {
    var ch = R ? 2 : 1, bps = bits === 24 ? 3 : 2, n = L.length, size = 44 + n * ch * bps, buf = new ArrayBuffer(size), v = new DataView(buf), u8 = new Uint8Array(buf);
    function str(o, s) { for (var i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); }
    str(0, "RIFF"); v.setUint32(4, size - 8, true); str(8, "WAVE"); str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * ch * bps, true); v.setUint16(32, ch * bps, true); v.setUint16(34, bps * 8, true); str(36, "data"); v.setUint32(40, n * ch * bps, true);
    var o = 44, chans = R ? [L, R] : [L];
    for (var i = 0; i < n; i++) for (var c = 0; c < ch; c++) {
      var x = chans[c][i];
      if (bps === 2) { var s = Math.round(x * 32767 + (Math.random() - Math.random())); s = s < -32768 ? -32768 : s > 32767 ? 32767 : s; v.setInt16(o, s, true); o += 2; }
      else { var s3 = Math.round(x * 8388607); s3 = s3 < -8388608 ? -8388608 : s3 > 8388607 ? 8388607 : s3; u8[o] = s3 & 255; u8[o + 1] = (s3 >> 8) & 255; u8[o + 2] = (s3 >> 16) & 255; o += 3; }
    }
    return buf;
  }

  // ------------------------------------------------------------------ one song
  async function loadStems(s) {
    var t = T().data(s), list = [], rate = 0, len = 0;
    for (var i = 0; i < t.stems.length; i++) {
      var st = t.stems[i], rec = await T().getStem(st.id); if (!rec) continue;
      rate = rate || rec.rate || 48000;
      list.push({ st: st, role: st.role || "music", L: new Int16Array(rec.L), R: rec.R ? new Int16Array(rec.R) : null });
      len = Math.max(len, rec.length || new Int16Array(rec.L).length);
    }
    return { rate: rate || 48000, len: len, stems: list };
  }
  function songSettings(c, s, mix) {
    var t = T().data(s), tempo = mix.tempo > 0 ? mix.tempo : (c.tempoMode === "song" ? t.tempoPercent || 100 : c.tempo), key = mix.key != null && mix.key !== "" ? Number(mix.key) : (c.keyMode === "song" ? t.keyShift || 0 : c.key);
    return { speed: Math.max(0.5, Math.min(1.5, tempo / 100)), semis: Math.max(-12, Math.min(12, key || 0)), tempo: Math.round(tempo) };
  }
  // the whole band (song faders) summed to mono: what the time-stretch lines its frames up on
  function monoOf(src, c) {
    var m = new Float32Array(src.len);
    src.stems.forEach(function (x) { if (CUE_ROLES[x.role]) return; var g = (c.songMix ? (x.st.mute ? 0 : x.st.gain == null ? 1 : x.st.gain) : 1) / 32768 / (x.R ? 2 : 1); if (!g) return; var L = x.L, R = x.R; for (var i = 0; i < L.length; i++) m[i] += (R ? L[i] + R[i] : L[i]) * g; });
    return m;
  }
  async function renderMix(s, src, mix, c, plans, cancelled) {
    var t = T().data(s), set = songSettings(c, s, mix), r = Math.pow(2, set.semis / 12), outRate = c.rate === "song" ? src.rate : Number(c.rate) || src.rate;
    var anySolo = ROLES.some(function (k) { return !CUE_ROLES[k] && mix.levels[k] === "solo"; }), split = c.split !== "off";
    var mL = new Float32Array(src.len), mR = new Float32Array(src.len), cL = split ? new Float32Array(src.len) : mL, cR = split ? new Float32Array(src.len) : mR, hasClickStem = false;
    src.stems.forEach(function (x) {
      var cue = CUE_ROLES[x.role] || x.st.bus === "click", role = x.st.bus === "click" ? "click" : x.role;
      if (role === "click") { hasClickStem = true; if (c.clickSource === "generated") return; }
      var g = roleGain(mix, role, anySolo) * (c.songMix ? (x.st.mute ? 0 : x.st.gain == null ? 1 : x.st.gain) : 1) * (role === "click" ? dB(c.clickDb) : 1); if (!g) return;
      var pan = c.songMix ? Math.max(-1, Math.min(1, x.st.pan || 0)) : 0, gl = g * Math.min(1, 1 - pan) / 32768, gr = g * Math.min(1, 1 + pan) / 32768;
      var oL = cue ? cL : mL, oR = cue ? cR : mR, L = x.L, R = x.R || x.L;
      for (var i = 0; i < L.length; i++) { oL[i] += L[i] * gl; oR[i] += R[i] * gr; }
    });
    await tick(); if (cancelled()) throw new Error("cancelled");
    // tempo and key: stretch by r / speed (WSOLA), then read r faster (and convert the sample rate)
    var f = r / set.speed, q = r * src.rate / outRate, chans = split ? [mL, mR, cL, cR] : [mL, mR];
    if (Math.abs(f - 1) > 1e-4) {
      var pk = f.toFixed(5), plan = plans[pk];
      if (!plan) { plan = plans[pk] = await stretchPlan(plans.mono || (plans.mono = monoOf(src, c)), f, cancelled); }
      var win = hann(WN); chans = chans.map(function (ch) { return applyPlan(ch, plan, win); });
    }
    mL = mR = cL = cR = null;   // (only the stretched copies from here: half the memory)
    chans = chans.map(function (ch) { return resample(ch, q); });
    await tick(); if (cancelled()) throw new Error("cancelled");
    var n = chans[0].length, beat = 60 / ((t.grid && t.grid.bpm) || s.bpm || 72), g0 = T().grid(s), pre = 0;
    // count-in: bars of click before bar 1 (at the practice tempo)
    var bar1 = g0 && g0.bars && g0.bars.length ? g0.bars[0] : 0, bpb = g0 ? g0.bpb || 4 : 4, cbeat = g0 && g0.times && g0.times.length > 1 ? (g0.times[1] - g0.times[0]) : beat;
    var clickG = roleGain(mix, "click", false) * dB(c.clickDb);
    if (c.countIn > 0 && clickG > 0) { var need = c.countIn * bpb * cbeat - bar1; pre = Math.max(0, need) / set.speed; }
    var preN = Math.round(pre * outRate), total = n + preN;
    var oL = new Float32Array(total), oR = new Float32Array(total), xL = split ? new Float32Array(total) : oL, xR = split ? new Float32Array(total) : oR;
    oL.set(chans[0], preN); oR.set(chans[1], preN); if (split) { xL.set(chans[2], preN); xR.set(chans[3], preN); }
    chans = null;
    var useGen = clickG > 0 && (c.clickSource === "generated" || (c.clickSource === "auto" && !hasClickStem)), sub = c.clickSub === "song" ? (t.click && t.click.sub) || 1 : Number(c.clickSub) || 1, snd = c.clickSound === "song" ? (t.click && t.click.sound === "beep" ? "beep" : "wood") : c.clickSound;
    function clickAt(songTime, accent, gain) { addClick(xL, xR, preN + songTime / set.speed * outRate, clickSound(snd, accent && c.clickAccent, outRate), gain); }
    if (clickG > 0 && c.countIn > 0) { for (var k = 1; k <= c.countIn * bpb; k++) { var tm = bar1 - k * cbeat; clickAt(tm, (c.countIn * bpb - k) % bpb === 0, clickG); } }
    if (useGen && g0 && g0.times) {
      var songLen = src.len / src.rate;
      for (var b = 0; b < g0.times.length; b++) {
        var tb = g0.times[b]; if (tb > songLen) break; if (tb < bar1 - 1e-3 && c.countIn > 0) continue;
        clickAt(tb, !!g0.down[b], clickG);
        var nx = b + 1 < g0.times.length ? g0.times[b + 1] : tb + cbeat; for (var sb = 1; sb < sub; sb++) clickAt(tb + (nx - tb) * sb / sub, false, clickG * 0.45);
      }
    }
    // the click and the guide in one ear, the band (in mono) in the other
    if (split) {
      var clickLeft = c.split === "clickLeft";
      for (var i = 0; i < total; i++) { var band = (oL[i] + oR[i]) * 0.5, cue = (xL[i] + xR[i]) * 0.5; if (clickLeft) { oL[i] = cue; oR[i] = band; } else { oL[i] = band; oR[i] = cue; } }
      xL = xR = null;
    }
    // trim what's silent at the end, fade out, level
    var end = total;
    if (c.trimEnd) { var th = dB(-60); while (end > preN + outRate && Math.abs(oL[end - 1]) < th && Math.abs(oR[end - 1]) < th) end--; end = Math.min(total, end + Math.round(outRate * 0.5)); }
    var fade = Math.min(end, Math.round(Math.max(0, c.fadeMs) / 1000 * outRate));
    for (var fi = 0; fi < fade; fi++) { var gf = fi / fade; oL[end - 1 - fi] *= gf; oR[end - 1 - fi] *= gf; }
    var peak = 0; for (var pi = 0; pi < end; pi++) { var a = Math.abs(oL[pi]), bb = Math.abs(oR[pi]); if (a > peak) peak = a; if (bb > peak) peak = bb; }
    var target = dB(Math.min(0, c.peakDb)), scale = peak > 0 ? (c.level === "normalize" ? target / peak : Math.min(1, target / peak)) : 1;
    if (scale !== 1) for (var si = 0; si < end; si++) { oL[si] *= scale; oR[si] *= scale; }
    return { L: end < total ? oL.subarray(0, end) : oL, R: end < total ? oR.subarray(0, end) : oR, rate: outRate, seconds: end / outRate, tempo: set.tempo, semis: set.semis, peak: peak * scale };
  }

  // ------------------------------------------------------------------ making them
  var job = null;
  function songsToMake(c) {
    var p = project(), withTracks = p.songs.filter(function (s) { return T().data(s).stems.length; });
    if (c.songs === "current") { var s = PP.activeSong(); return s && T().data(s).stems.length ? [s] : []; }
    if (c.songs === "pick") return withTracks.filter(function (s) { return c.picked.indexOf(s.id) >= 0; });
    return withTracks;
  }
  function fileName(c, i, s, mix, r) {
    var t = T().data(s), name = (c.names || DEFAULTS.names).replace(/\{n\}/g, (i + 1 < 10 ? "0" : "") + (i + 1)).replace(/\{song\}/g, s.name || "Song").replace(/\{mix\}/g, mix.name)
      .replace(/\{key\}/g, keyAfter(s.key, r.semis)).replace(/\{bpm\}/g, Math.round(((t.grid && t.grid.bpm) || s.bpm || 0) * r.tempo / 100)).replace(/\{tempo\}/g, r.tempo + "%");
    return name.replace(/[\/\\:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 110) || "Practice";
  }
  var NOTES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
  function keyAfter(key, semis) {
    var m = /^([A-G])([#b♯♭]?)(.*)$/.exec(String(key || "")); if (!m) return key || "";
    var i = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]] + (m[2] === "#" || m[2] === "♯" ? 1 : m[2] === "b" || m[2] === "♭" ? -1 : 0);
    return NOTES[((i + (semis || 0)) % 12 + 24) % 12] + m[3];
  }
  function folderName(c) { return (c.folder || "").trim() || "Practice " + new Date().toISOString().slice(0, 10); }
  function dest(c) {
    if (c.dest === "folder" && !(window.CCDesktop && window.CCDesktop.pickFolder)) return driverOn() ? "pedal" : "download";
    if ((c.dest === "pedal" || c.dest === "usb" || c.dest === "folder") && !driverOn()) return "download";
    return c.dest;
  }
  async function save(c, where, folder, name, wav, bits) {
    var fmt = c.format === "mp3" ? "mp3" : "wav";
    if (where === "download") {
      var file = new File([wav], name + ".wav", { type: "audio/wav" });
      if (shareFiles() && job) job.share.push(file); else download(file.name, file);   // (an iPad: shared / saved to Files at the end, with one tap)
      return { name: name + ".wav", note: fmt === "mp3" ? "WAV (MP3s are made on a Central Pedal or a computer)" : "" };
    }
    var r = await fetch(MEDIA + "/practice/file?folder=" + encodeURIComponent(folder) + "&name=" + encodeURIComponent(name + ".wav") + "&format=" + fmt + "&kbps=" + (c.kbps || 192) + "&usb=" + (where === "usb" ? 1 : 0), { method: "PUT", body: wav });
    var j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || "saving failed");
    return j;
  }
  function shareFiles() { try { return "ontouchend" in document && !driverOn() && !!(navigator.canShare && navigator.canShare({ files: [new File([""], "a.wav", { type: "audio/wav" })] })); } catch (_) { return false; } }
  function download(name, blob) { var a = document.createElement("a"), u = URL.createObjectURL(blob); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 30000); }

  async function make() {
    if (job && job.running) return;
    var c = cfg(), songs = songsToMake(c), mixes = c.mixes.filter(function (m) { return m.on; }), where = dest(c), folder = folderName(c);
    if (!songs.length) return say("No songs with tracks to make mixes of.", true);
    if (!mixes.length) return say("Turn on at least one mix.", true);
    if (T().isPlaying()) return say("Stop the song first - making mixes takes all of the computer for a while.", true);
    if (where === "download" && shareFiles() && songs.length * mixes.length > 8) return say("On an iPad make up to 8 files at a time (they are kept in memory until you save them) - pick fewer songs or mixes.", true);
    var pickDir = null;
    if (where === "folder") { try { pickDir = await window.CCDesktop.pickFolder(); } catch (_) { } if (!pickDir) return say("No folder picked.", true); }
    job = { running: true, cancel: false, done: 0, total: songs.length * mixes.length, files: [], notes: [], errors: [], share: [], folder: folder, where: where, started: Date.now() };
    var cancelled = function () { return job.cancel; }, lists = {};
    renderProgress();
    if (driverOn()) { try { await fetch(MEDIA + "/practice/config", { method: "POST", body: JSON.stringify(shareCfg(c)) }); } catch (_) { } }
    try {
      for (var si = 0; si < songs.length; si++) {
        var s = songs[si]; job.song = s.name; job.mix = "loading the tracks"; renderProgress();
        var src = await loadStems(s); if (!src.stems.length) { job.errors.push(s.name + ": its tracks aren't on this computer"); job.done += mixes.length; continue; }
        var plans = {};
        for (var mi = 0; mi < mixes.length; mi++) {
          if (job.cancel) throw new Error("cancelled");
          var mix = mixes[mi]; job.mix = mix.name; renderProgress(); await tick();
          try {
            var r = await renderMix(s, src, mix, c, plans, cancelled), name = fileName(c, Math.max(0, project().songs.indexOf(s)), s, mix, r);
            var wav = encodeWav(r.L, r.R, r.rate, c.format === "wav24" ? 24 : 16); r = null;
            var saved = await save(c, where, folder, name, wav); wav = null;
            job.files.push(saved.name); if (saved.note) job.notes.push(saved.note); if (saved.usbError) job.notes.push(saved.usbError);
            (lists[mix.name] = lists[mix.name] || []).push(saved.name);
          } catch (error) { if (String(error.message) === "cancelled") throw error; job.errors.push(s.name + " - " + mix.name + ": " + error.message); }
          job.done++; renderProgress();
        }
        src = plans = null;
      }
      if (c.playlist && where !== "download") {
        for (var mn in lists) { try { await savePlaylist(where, folder, (mn + " (playlist)").replace(/[\/\\:*?"<>|]+/g, "-"), "#EXTM3U\n" + lists[mn].join("\n") + "\n"); } catch (_) { } }
      }
      if (where === "folder") { var cp = await (await fetch(MEDIA + "/practice/copy", { method: "POST", body: JSON.stringify({ folder: folder, dest: pickDir }) })).json(); if (cp.error) job.errors.push(cp.error); else job.copied = cp.path; }
      job.finished = true;
    } catch (error) { job.errors.push(String(error.message) === "cancelled" ? "Stopped." : error.message); }
    job.running = false; renderProgress(); refreshList();
    var secs = Math.round((Date.now() - job.started) / 1000);
    say((job.files.length ? "✓ " + job.files.length + " practice mix" + (job.files.length === 1 ? "" : "es") + " made in " + (secs >= 60 ? Math.floor(secs / 60) + " min " : "") + (secs % 60) + " s" : "No mixes made") + (job.errors.length ? " · " + job.errors.length + " problem(s)" : ""), !!job.errors.length);
  }
  // the playlist: a text file next to the mixes (names only, so it works on a phone, a stick or a folder)
  async function savePlaylist(where, folder, name, text) {
    var r = await fetch(MEDIA + "/practice/file?folder=" + encodeURIComponent(folder) + "&name=" + encodeURIComponent(name + ".m3u") + "&format=m3u&usb=" + (where === "usb" ? 1 : 0), { method: "PUT", body: text });
    return r.json();
  }

  // ------------------------------------------------------------------ the dialog
  var dlg = null, listCache = null, caps = null;
  function say(m, bad) { var el = dlg && $("#pmMsg", dlg); if (el) { el.textContent = m; el.className = "pm-msg" + (bad ? " bad" : ""); } PP.setStatus(m); }
  function opt(v, label, cur) { return '<option value="' + esc(String(v)) + '"' + (String(cur) === String(v) ? " selected" : "") + ">" + esc(label) + "</option>"; }
  function sel(key, cur, opts, title) { return '<select data-pm="' + key + '"' + (title ? ' title="' + esc(title) + '"' : "") + ">" + opts.map(function (o) { return opt(o[0], o[1], cur); }).join("") + "</select>"; }
  function num(key, v, min, max, step) { return '<input type="number" data-pm="' + key + '" value="' + esc(String(v)) + '" min="' + min + '" max="' + max + '" step="' + (step || 1) + '">'; }
  function chk(key, v, label) { return '<label class="toggle"><input type="checkbox" data-pm="' + key + '"' + (v ? " checked" : "") + "> " + label + "</label>"; }
  function host() { return (caps && caps.hostname ? caps.hostname : "central-pedal") + ".local:" + ((caps && caps.lanPort) || 8080); }

  function html() {
    var c = cfg(), p = project(), withTracks = p.songs.filter(function (s) { return T().data(s).stems.length; }), mixes = c.mixes, on = mixes.filter(function (m) { return m.on; }).length, songs = songsToMake(c).length;
    var isMac = !!(window.CCDesktop && window.CCDesktop.pickFolder);
    var h = '<form method="dialog" class="pm"><header><h2>🎧 Practice mixes</h2><button value="close" class="ghost" aria-label="Close">✕</button></header>' +
      '<p class="muted small">A file of each song for each musician - their part up, the click and the guide or not, slower to learn it (the pitch stays) or in another key. ' + (driverOn() && !isMac ? "Kept on this Central Pedal: the band opens <b>http://" + esc(host()) + "/practice/</b> on their phones." : "") + "</p>";
    // songs
    h += '<section><h3>Songs</h3><label>Which songs' + sel("songs", c.songs, [["setlist", "Every song with tracks (" + withTracks.length + ")"], ["current", "Just this song"], ["pick", "The ones I tick"]]) + "</label>";
    if (c.songs === "pick") h += '<div class="pm-songs">' + withTracks.map(function (s) { return '<label class="toggle"><input type="checkbox" data-pm-song="' + esc(s.id) + '"' + (c.picked.indexOf(s.id) >= 0 ? " checked" : "") + "> " + esc(s.name) + "</label>"; }).join("") + "</div>";
    h += "</section>";
    // the mixes
    h += '<section><h3>The mixes</h3><div class="pm-scroll"><table class="pm-mixes"><thead><tr><th></th><th>Name</th>' + ROLES.map(function (r) { return "<th>" + ROLE_LABEL[r] + "</th>"; }).join("") + '<th title="Blank: the tempo below">Tempo %</th><th title="Blank: the key below">Key ±</th><th></th></tr></thead><tbody>';
    mixes.forEach(function (m, i) {
      h += '<tr data-mix="' + i + '"><td><input type="checkbox" data-mx="on"' + (m.on ? " checked" : "") + ' title="Make this mix"></td><td><input data-mx="name" value="' + esc(m.name) + '" maxlength="40"></td>' +
        ROLES.map(function (r) { return '<td><select data-mx="lv" data-role="' + r + '">' + LEVELS.map(function (l) { return opt(l[0], l[1], m.levels[r]); }).join("") + "</select></td>"; }).join("") +
        '<td><input type="number" data-mx="tempo" min="50" max="150" value="' + (m.tempo > 0 ? m.tempo : "") + '" placeholder="-"></td><td><input type="number" data-mx="key" min="-6" max="6" value="' + (m.key != null && m.key !== "" ? m.key : "") + '" placeholder="-"></td>' +
        '<td><button type="button" class="ghost" data-mx="del" title="Remove this mix">✕</button></td></tr>';
    });
    h += '</tbody></table></div><div class="row"><button type="button" data-pm-act="add">+ Add a mix</button><button type="button" class="ghost" data-pm-act="reset">Back to the usual mixes</button></div></section>';
    // sound
    h += '<section><h3>Sound</h3><div class="pm-grid">' +
      "<label>Tempo" + sel("tempoMode", c.tempoMode, [["song", "As set on each song"], ["custom", "Custom"]]) + "</label>" +
      (c.tempoMode === "custom" ? "<label>Tempo %" + num("tempo", c.tempo, 50, 150) + "</label>" : "") +
      "<label>Key" + sel("keyMode", c.keyMode, [["song", "As set on each song"], ["custom", "Custom"]]) + "</label>" +
      (c.keyMode === "custom" ? "<label>Semitones" + num("key", c.key, -6, 6) + "</label>" : "") +
      "<label>Click from" + sel("clickSource", c.clickSource, [["auto", "The click track, or made from the beat grid"], ["stems", "Only the song's click track"], ["generated", "Always made from the beat grid"]]) + "</label>" +
      "<label>Click sound" + sel("clickSound", c.clickSound, [["song", "As on the song"], ["wood", "Wood block"], ["beep", "Beep"], ["stick", "Sticks"]]) + "</label>" +
      "<label>Click subdivision" + sel("clickSub", c.clickSub, [["song", "As on the song"], ["1", "Quarter notes"], ["2", "Eighths"], ["3", "Triplets"], ["4", "Sixteenths"]]) + "</label>" +
      "<label>Click level (dB)" + num("clickDb", c.clickDb, -30, 12) + "</label>" +
      "<label>Count-in (bars)" + num("countIn", c.countIn, 0, 4) + "</label>" +
      "<label>Click in one ear" + sel("split", c.split, [["off", "No - normal stereo"], ["clickLeft", "Click + guide left, band right"], ["clickRight", "Band left, click + guide right"]]) + "</label>" +
      "<label>Level" + sel("level", c.level, [["normalize", "Make each file as loud as the peak below"], ["asis", "As mixed (only turned down if it would clip)"]]) + "</label>" +
      "<label>Peak (dBFS)" + num("peakDb", c.peakDb, -20, 0, 0.5) + "</label>" +
      "<label>Fade out at the end (ms)" + num("fadeMs", c.fadeMs, 0, 10000, 100) + "</label></div>" +
      chk("clickAccent", c.clickAccent, "Accent the first beat of each bar") + chk("songMix", c.songMix, "Start from each song's own faders, pans and mutes") + chk("trimEnd", c.trimEnd, "Cut the silence at the end") + "</section>";
    // files
    h += '<section><h3>Files</h3><div class="pm-grid">' +
      "<label>Format" + sel("format", c.format, [["wav16", "WAV 16-bit"], ["wav24", "WAV 24-bit"], ["mp3", "MP3" + (caps && !caps.ffmpeg ? " (needs ffmpeg - WAV for now)" : "")]]) + "</label>" +
      (c.format === "mp3" ? "<label>MP3 quality" + sel("kbps", c.kbps, [["128", "128 kbps"], ["192", "192 kbps"], ["256", "256 kbps"], ["320", "320 kbps"]]) + "</label>" : "") +
      "<label>Sample rate" + sel("rate", c.rate, [["song", "As the tracks"], ["44100", "44.1 kHz"], ["48000", "48 kHz"]]) + "</label>" +
      '<label>File names <input data-pm="names" value="' + esc(c.names) + '" title="{n} {song} {mix} {key} {bpm} {tempo}"></label>' +
      '<label>Folder <input data-pm="folder" value="' + esc(c.folder) + '" placeholder="' + esc(folderName({ folder: "" })) + '"></label></div>' +
      '<p class="muted small">In names: {n} the song number, {song}, {mix}, {key}, {bpm}, {tempo}.</p>' + chk("playlist", c.playlist, "A playlist for each mix (all the songs in order)") + "</section>";
    // where
    var dests = [["pedal", driverOn() ? (isMac ? "Keep them in Central Pedal Control" : "Keep them on this Central Pedal (phones)") : "Keep them here"], ["usb", "Keep them here and copy onto a USB stick"], ["download", "Download them"]];
    if (isMac) dests.push(["folder", "A folder on this Mac…"]);
    if (!driverOn()) dests = [["download", shareFiles() ? "Save to Files or share them (a button at the end)" : "Download them"]];
    h += '<section><h3>Where they go</h3><div class="pm-grid"><label>Save to' + sel("dest", driverOn() ? c.dest : "download", dests) + "</label>" +
      (!isMac ? "<label>Phones can open them" + sel("share", c.share, [["open", "Anyone on the church network"], ["code", "With a practice code"], ["off", "No (not shared)"]]) + "</label>" +
        (c.share === "code" ? '<label title="4-12 letters or numbers - give it to the band (it is not the pairing PIN)">Practice code <input data-pm="code" value="' + esc(c.code || (caps && caps.code) || "") + '" maxlength="12" pattern="[A-Za-z0-9]{4,12}"></label>' : "") +
        '<label>Page title <input data-pm="title" value="' + esc(c.title) + '" placeholder="Practice mixes"></label>' : "") + "</div>" +
      (driverOn() ? "" : '<p class="muted small">MP3s, the phones\' page and USB sticks need a Central Pedal or Central Pedal Control on a Mac; here they are WAV files.</p>') + "</section>";
    h += '<section><h3>Made so far</h3><div id="pmList" class="pm-list">' + listHtml() + "</div></section>";
    h += '<div class="pm-progress hidden" id="pmProgress"></div><p id="pmMsg" class="pm-msg"></p>' +
      '<footer><button type="button" class="primary" data-pm-act="make"' + (songs * on ? "" : " disabled") + '>Make ' + (songs * on) + " file" + (songs * on === 1 ? "" : "s") + " (" + songs + " song" + (songs === 1 ? "" : "s") + " × " + on + " mix" + (on === 1 ? "" : "es") + ')</button><button type="button" class="ghost hidden" data-pm-act="stop">Stop</button><button value="close">Close</button></footer></form>';
    return h;
  }
  function listHtml() {
    if (!driverOn()) return '<p class="muted small">(Downloads go to this computer\'s Downloads folder.)</p>';
    if (!listCache) return '<p class="muted small">…</p>';
    if (!listCache.length) return '<p class="muted small">None yet.</p>';
    var isMac = !!(window.CCDesktop && window.CCDesktop.pickFolder);
    return listCache.map(function (e) {
      return '<details><summary><b>' + esc(e.folder) + "</b> · " + e.files.length + " files · " + (e.size / 1048576).toFixed(0) + ' MB <span class="row-tools"><button type="button" data-pm-folder="' + esc(e.folder) + '" data-pm-do="usb">USB</button>' +
        (isMac ? '<button type="button" data-pm-folder="' + esc(e.folder) + '" data-pm-do="copy">Copy to…</button>' : "") + '<button type="button" class="ghost" data-pm-folder="' + esc(e.folder) + '" data-pm-do="del">Delete</button></span></summary><ul>' +
        e.files.map(function (f) { return '<li><a href="' + MEDIA + "/practice/file?folder=" + encodeURIComponent(e.folder) + "&name=" + encodeURIComponent(f.name) + '" target="_blank" rel="noopener">' + esc(f.name) + "</a> " + (f.size / 1048576).toFixed(1) + " MB</li>"; }).join("") + "</ul></details>";
    }).join("");
  }
  async function refreshList() {
    if (!driverOn()) return;
    try { var j = await (await fetch(MEDIA + "/practice/list", { cache: "no-store" })).json(); listCache = j.folders || []; caps = j.caps || caps; } catch (_) { listCache = []; }
    var el = dlg && $("#pmList", dlg); if (el) el.innerHTML = listHtml();
  }
  function renderProgress() {
    if (!dlg) return; var el = $("#pmProgress", dlg); if (!el || !job) return;
    el.classList.remove("hidden");
    var pct = job.total ? Math.round(job.done / job.total * 100) : 0;
    el.innerHTML = '<div class="pm-bar"><i style="width:' + pct + '%"></i></div><p>' + (job.running ? "Making " + (job.done + 1) + " of " + job.total + ": <b>" + esc(job.song || "") + "</b> - " + esc(job.mix || "") : (job.finished ? "Done: " : "") + job.files.length + " file(s)" + (job.copied ? " → " + esc(job.copied) : job.where === "usb" ? " (and on the USB stick)" : "")) + "</p>" +
      (job.notes.length ? '<p class="muted small">' + esc(job.notes.filter(function (v, i, a) { return a.indexOf(v) === i; }).join(" · ")) + "</p>" : "") + (job.errors.length ? '<p class="bad small">' + esc(job.errors.slice(-4).join(" · ")) + "</p>" : "") +
      (!job.running && job.share && job.share.length ? '<p><button type="button" class="primary" data-pm-act="share">Save / share the ' + job.share.length + " file" + (job.share.length === 1 ? "" : "s") + "…</button></p>" : "");
    var stop = $('[data-pm-act="stop"]', dlg), mk = $('[data-pm-act="make"]', dlg); if (stop) stop.classList.toggle("hidden", !job.running); if (mk) mk.disabled = !!job.running || /Make 0 /.test(mk.textContent);
  }
  function open() {
    if (!dlg) { dlg = document.createElement("dialog"); dlg.id = "pmDialog"; dlg.className = "pm-dialog"; document.body.appendChild(dlg); wire(); }
    draw(); if (!dlg.open) dlg.showModal(); refreshList();
    if (driverOn() && !caps) fetch(MEDIA + "/practice/caps").then(function (r) { return r.json(); }).then(function (j) { caps = j; draw(); }).catch(function () { });
  }
  function draw() { if (!dlg) return; var y = dlg.querySelector("form") ? dlg.querySelector("form").scrollTop : 0; dlg.innerHTML = html(); var f = dlg.querySelector("form"); if (f) f.scrollTop = y; renderProgress(); }
  function wire() {
    dlg.addEventListener("keydown", function (e) { if (e.key === "Enter" && e.target.tagName === "INPUT") e.preventDefault(); });   // (Enter would close the dialog)
    dlg.addEventListener("change", function (e) {
      var t = e.target, c = cfg();
      if (t.dataset.pm) { var k = t.dataset.pm; c[k] = t.type === "checkbox" ? t.checked : t.type === "number" ? Number(t.value) : t.value; cfg(); PP.persistSoon(); if (/^(songs|tempoMode|keyMode|format|dest)$/.test(k)) draw(); else if (k === "share" || k === "title" || k === "code") { pushShare(); if (k === "share") draw(); } return; }
      if (t.dataset.pmSong) { var id = t.dataset.pmSong, i = c.picked.indexOf(id); if (t.checked && i < 0) c.picked.push(id); if (!t.checked && i >= 0) c.picked.splice(i, 1); PP.persistSoon(); draw(); return; }
      var row = t.closest("[data-mix]"); if (!row || !t.dataset.mx) return; var m = c.mixes[Number(row.dataset.mix)]; if (!m) return;
      if (t.dataset.mx === "on") { m.on = t.checked; draw(); }
      else if (t.dataset.mx === "name") m.name = t.value.trim() || "Mix";
      else if (t.dataset.mx === "lv") m.levels[t.dataset.role] = t.value;
      else if (t.dataset.mx === "tempo") m.tempo = t.value === "" ? null : Math.max(50, Math.min(150, Number(t.value)));
      else if (t.dataset.mx === "key") m.key = t.value === "" ? null : Math.max(-6, Math.min(6, Math.round(Number(t.value))));
      PP.persistSoon();
    });
    dlg.addEventListener("click", async function (e) {
      var b = e.target.closest("button"); if (!b) return; var c = cfg();
      if (b.dataset.mx === "del") { var row = b.closest("[data-mix]"); c.mixes.splice(Number(row.dataset.mix), 1); if (!c.mixes.length) c.mixes = defaultMixes(); PP.persistSoon(); draw(); return; }
      var act = b.dataset.pmAct;
      if (act === "add") { c.mixes.push({ id: PP.id(), name: "Mix " + (c.mixes.length + 1), on: true, levels: levels() }); PP.persistSoon(); draw(); return; }
      if (act === "reset") { c.mixes = defaultMixes(); PP.persistSoon(); draw(); return; }
      if (act === "make") { make(); return; }
      if (act === "stop") { if (job) job.cancel = true; return; }
      if (act === "share" && job && job.share.length) { navigator.share({ files: job.share, title: job.folder }).then(function () { say("✓ Shared"); }).catch(function (e) { if (e && e.name !== "AbortError") say(e.message, true); }); return; }
      var f = b.dataset.pmFolder, d = b.dataset.pmDo; if (!f || !d) return;
      try {
        if (d === "del") { if (!confirm("Delete the practice mixes in “" + f + "”?")) return; await fetch(MEDIA + "/practice/delete", { method: "POST", body: JSON.stringify({ folder: f }) }); }
        else if (d === "usb") { var j = await (await fetch(MEDIA + "/practice/usb", { method: "POST", body: JSON.stringify({ folder: f }) })).json(); say(j.usb ? "Copied onto the USB stick: " + j.usb : j.usbError || "No USB stick", !j.usb); }
        else if (d === "copy") { var to = await window.CCDesktop.pickFolder(); if (!to) return; var k = await (await fetch(MEDIA + "/practice/copy", { method: "POST", body: JSON.stringify({ folder: f, dest: to }) })).json(); say(k.path ? "Copied to " + k.path : k.error, !k.path); }
      } catch (error) { say(error.message, true); }
      refreshList();
    });
  }
  var shareTimer = 0;
  function shareCfg(c) { var o = { share: c.share, title: c.title }; if (/^[A-Za-z0-9]{4,12}$/.test(c.code || "")) o.code = c.code; return o; }
  function pushShare() { clearTimeout(shareTimer); shareTimer = setTimeout(function () { if (driverOn()) { fetch(MEDIA + "/practice/config", { method: "POST", body: JSON.stringify(shareCfg(cfg())) }).then(function (r) { return r.json(); }).then(function (j) { caps = j; }).catch(function () { }); } }, 400); }

  // the Tracks tab's button
  function addButton() {
    var mixer = $("#trMixer"); if (!mixer || $("#trPractice")) return;
    var b = document.createElement("button"); b.id = "trPractice"; b.title = "A file of each song for each musician: their part up, click, slower, another key"; b.textContent = "🎧 Practice mixes";
    b.addEventListener("click", open); mixer.insertAdjacentElement("afterend", b);
  }
  addButton(); document.addEventListener("DOMContentLoaded", addButton);

  window.PPPractice = { open: open, cfg: cfg, make: make, job: function () { return job; }, renderMix: renderMix, loadStems: loadStems, stretchPlan: stretchPlan, applyPlan: applyPlan, resample: resample, encodeWav: encodeWav, hann: hann, defaultMixes: defaultMixes, songsToMake: songsToMake, fileName: fileName };
})();
