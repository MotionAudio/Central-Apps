/* Central Production - the sampler: plays an instrument's zones (samples spread across keys and velocities, with loop
 * points, an envelope and a filter) and writes it out as a SoundFont (.sf2) or an SFZ (a text file + WAVs) - the two
 * formats the other apps and the Make & sell uploads read.
 *
 *   CPSampler.voice(ctx, dest, inst, buffers, note, vel, when) -> { stop(when) }     one note
 *   CPSampler.render(inst, buffers, notes, seconds) -> Promise<AudioBuffer>           offline (demos, the pad's keys)
 *   CPSampler.sf2(inst, buffers) -> Uint8Array;  CPSampler.sfz(inst, buffers) -> [{ name, data }]
 * An instrument: { name, zones: [{ sample, root, lo, hi, vlo, vhi, tune, gain, loop: { on, start, end } (frames) }],
 *   env: { attack, decay, sustain, release } (seconds, sustain 0..1), filter: { on, cutoff (Hz), res (0..20) }, gain }
 */
(function () {
  "use strict";
  function clamp(v, a, b) { v = Number(v); return isFinite(v) ? Math.max(a, Math.min(b, v)) : a; }
  function zoneFor(inst, note, vel) {
    var zs = (inst.zones || []).filter(function (z) { return note >= z.lo && note <= z.hi && vel >= (z.vlo || 1) && vel <= (z.vhi == null ? 127 : z.vhi); });
    if (!zs.length) zs = (inst.zones || []).filter(function (z) { return note >= z.lo && note <= z.hi; });
    if (!zs.length && inst.zones && inst.zones.length) { var best = null; inst.zones.forEach(function (z) { var d = Math.abs(z.root - note); if (!best || d < best.d) best = { z: z, d: d }; }); return best ? [best.z] : []; }
    return zs;
  }
  function voice(ctx, dest, inst, buffers, note, vel, when) {
    when = when || ctx.currentTime; vel = clamp(vel || 100, 1, 127);
    var env = Object.assign({ attack: 0.005, decay: 0.3, sustain: 0.8, release: 0.4 }, inst.env || {}), f = inst.filter || {}, parts = [];
    zoneFor(inst, note, vel).forEach(function (z) {
      var buf = buffers[z.sample]; if (!buf) return;
      var src = ctx.createBufferSource(); src.buffer = buf;
      src.playbackRate.value = Math.pow(2, (note - (z.root == null ? 60 : z.root) + (z.tune || 0) / 100) / 12);
      if (z.loop && z.loop.on && z.loop.end > z.loop.start) { src.loop = true; src.loopStart = z.loop.start / buf.sampleRate; src.loopEnd = z.loop.end / buf.sampleRate; }
      var g = ctx.createGain(), peak = Math.pow(vel / 127, 1.4) * (z.gain == null ? 1 : z.gain) * (inst.gain == null ? 1 : inst.gain), last = src;
      if (f.on) { var lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = clamp(f.cutoff || 8000, 40, 20000); lp.Q.value = clamp(f.res || 0.7, 0.1, 20); last.connect(lp); last = lp; }
      last.connect(g); g.connect(dest);
      g.gain.setValueAtTime(0, when); g.gain.linearRampToValueAtTime(peak, when + Math.max(0.002, env.attack));
      g.gain.setTargetAtTime(peak * clamp(env.sustain, 0, 1), when + Math.max(0.002, env.attack), Math.max(0.01, env.decay) / 3);
      src.start(when);
      parts.push({ src: src, g: g });
    });
    return {
      stop: function (at) {
        at = Math.max(at || ctx.currentTime, when + 0.01);
        parts.forEach(function (p) { try { p.g.gain.cancelScheduledValues(at); p.g.gain.setTargetAtTime(0, at, Math.max(0.01, env.release) / 4); p.src.stop(at + Math.max(0.05, env.release) * 2 + 0.05); } catch (_) { } });
      }
    };
  }
  // notes: [{ p, v, s (seconds), d (seconds) }]
  function render(inst, buffers, notes, seconds, rate) {
    rate = rate || 48000;
    var oc = new OfflineAudioContext(2, Math.ceil(seconds * rate), rate);
    notes.forEach(function (n) { var v = voice(oc, oc.destination, inst, buffers, n.p, n.v || 100, n.s); v.stop(n.s + n.d); });
    return oc.startRendering();
  }

  // ---- the SoundFont: one preset, one instrument, a zone per sample (mono, 16-bit, the way the apps load them)
  function str(s, n) { var b = new Uint8Array(n), t = String(s || "").replace(/[^\x20-\x7e]/g, "").slice(0, n - 1); for (var i = 0; i < t.length; i++) b[i] = t.charCodeAt(i); return b; }
  function cat(list) { var n = list.reduce(function (a, b) { return a + b.length; }, 0), o = new Uint8Array(n), p = 0; list.forEach(function (b) { o.set(b, p); p += b.length; }); return o; }
  function chunk(id, body) { var h = new Uint8Array(8); for (var i = 0; i < 4; i++) h[i] = id.charCodeAt(i); new DataView(h.buffer).setUint32(4, body.length, true); return cat([h, body, body.length & 1 ? new Uint8Array(1) : new Uint8Array(0)]); }
  function list(type, kids) { return chunk("LIST", cat([str(type, 5).subarray(0, 4)].concat(kids))); }
  function mono16(buf) {
    var n = buf.length, out = new Int16Array(n), nc = buf.numberOfChannels;
    for (var i = 0; i < n; i++) { var s = 0; for (var c = 0; c < nc; c++) s += buf.getChannelData(c)[i]; out[i] = Math.max(-32768, Math.min(32767, Math.round(s / nc * 32767))); }
    return out;
  }
  function tc(sec) { return Math.round(1200 * Math.log2(Math.max(0.001, sec))); }   // timecents
  function sf2(inst, buffers) {
    var zones = (inst.zones || []).filter(function (z) { return buffers[z.sample]; });
    if (!zones.length) throw new Error("Add at least one sample first.");
    var smplParts = [], shdr = [], at = 0, used = {}, order = [];
    zones.forEach(function (z) { if (used[z.sample] == null) { used[z.sample] = order.length; order.push(z); } });
    order.forEach(function (z, i) {
      var buf = buffers[z.sample], pcm = mono16(buf), start = at, end = at + pcm.length;
      smplParts.push(new Uint8Array(pcm.buffer), new Uint8Array(92));
      var lp = z.loop && z.loop.on && z.loop.end > z.loop.start && z.loop.end <= pcm.length, h = new Uint8Array(46), v = new DataView(h.buffer);
      h.set(str(z.sample, 20), 0); v.setUint32(20, start, true); v.setUint32(24, end, true); v.setUint32(28, lp ? start + z.loop.start : start, true); v.setUint32(32, lp ? start + z.loop.end : end, true);
      v.setUint32(36, buf.sampleRate, true); v.setUint8(40, (z.root == null ? 60 : z.root) & 127); v.setInt8(41, 0); v.setUint16(44, 1, true);
      shdr.push(h); at = end + 46;
    });
    var eos = new Uint8Array(46); eos.set(str("EOS", 20), 0); shdr.push(eos);
    var env = Object.assign({ attack: 0.005, decay: 0.3, sustain: 0.8, release: 0.4 }, inst.env || {}), f = inst.filter || {};
    function gen(op, a) { var g = new Uint8Array(4), v = new DataView(g.buffer); v.setUint16(0, op, true); if (Array.isArray(a)) { g[2] = a[0]; g[3] = a[1]; } else v.setInt16(2, a, true); return g; }
    var igen = [], ibag = [];
    zones.forEach(function (z) {
      var b = new Uint8Array(4); new DataView(b.buffer).setUint16(0, igen.length, true); ibag.push(b);
      igen.push(gen(43, [z.lo, z.hi]), gen(44, [z.vlo == null ? 0 : z.vlo, z.vhi == null ? 127 : z.vhi]));
      igen.push(gen(34, tc(env.attack)), gen(36, tc(env.decay)), gen(37, Math.round(Math.min(1440, -200 * Math.log10(Math.max(0.0001, env.sustain))))), gen(38, tc(env.release)));
      if (f.on) { igen.push(gen(8, Math.round(1200 * Math.log2(clamp(f.cutoff || 8000, 20, 20000) / 8.176))), gen(9, Math.round(clamp(10 * 20 * Math.log10(Math.max(1, (f.res || 0.7) / 0.707)), 0, 960)))); }
      if (z.tune) igen.push(gen(52, Math.round(z.tune)));
      if (z.gain != null && z.gain < 1) igen.push(gen(48, Math.round(-200 * Math.log10(Math.max(0.01, z.gain)))));
      igen.push(gen(58, (z.root == null ? 60 : z.root) & 127), gen(54, z.loop && z.loop.on ? 1 : 0), gen(53, used[z.sample]));
    });
    var eb = new Uint8Array(4); new DataView(eb.buffer).setUint16(0, igen.length, true); ibag.push(eb);
    var name = inst.name || "Instrument", instr = new Uint8Array(44); instr.set(str(name, 20), 0); instr.set(str("EOI", 20), 22); new DataView(instr.buffer).setUint16(42, zones.length, true);
    var pbag = new Uint8Array(8); new DataView(pbag.buffer).setUint16(4, 1, true);
    var pgen = cat([gen(41, 0), new Uint8Array(4)]);
    var phdr = new Uint8Array(76); phdr.set(str(name, 20), 0); phdr.set(str("EOP", 20), 38); new DataView(phdr.buffer).setUint16(38 + 24, 1, true);
    var info = list("INFO", [chunk("ifil", new Uint8Array([2, 0, 1, 0])), chunk("isng", str("EMU8000", 8)), chunk("INAM", str(name, 64)), chunk("ISFT", str("Central Production", 32))]);
    var sdta = list("sdta", [chunk("smpl", cat(smplParts))]);
    var pdta = list("pdta", [chunk("phdr", phdr), chunk("pbag", pbag), chunk("pmod", new Uint8Array(10)), chunk("pgen", pgen), chunk("inst", instr), chunk("ibag", cat(ibag)), chunk("imod", new Uint8Array(10)), chunk("igen", cat(igen.concat([new Uint8Array(4)]))), chunk("shdr", cat(shdr))]);
    return chunk("RIFF", cat([str("sfbk", 5).subarray(0, 4), info, sdta, pdta]));
  }
  // SFZ: a text file and the samples next to it (the WAVs keep their loop points in a smpl chunk too)
  function sfz(inst, buffers) {
    var env = Object.assign({ attack: 0.005, decay: 0.3, sustain: 0.8, release: 0.4 }, inst.env || {}), f = inst.filter || {}, files = [], seen = {};
    var lines = ["// " + (inst.name || "Instrument") + " - made in Central Production", "<control> default_path=samples/", "<global> ampeg_attack=" + env.attack.toFixed(3) + " ampeg_decay=" + env.decay.toFixed(3) + " ampeg_sustain=" + Math.round(clamp(env.sustain, 0, 1) * 100) + " ampeg_release=" + env.release.toFixed(3) + (f.on ? " fil_type=lpf_2p cutoff=" + Math.round(f.cutoff || 8000) + " resonance=" + (20 * Math.log10(Math.max(1, (f.res || 0.7) / 0.707))).toFixed(1) : "")];
    (inst.zones || []).forEach(function (z) {
      var buf = buffers[z.sample]; if (!buf) return;
      var fn = String(z.sample).replace(/[^\w.\- ]+/g, "_").replace(/\.wav$/i, "") + ".wav";
      if (!seen[fn]) { seen[fn] = 1; files.push({ name: "samples/" + fn, data: new Uint8Array(window.CMProj.wav(buf, 24, { root: z.root, loop: z.loop && z.loop.on ? [z.loop.start, z.loop.end] : null })) }); }
      lines.push("<region> sample=" + fn + " lokey=" + z.lo + " hikey=" + z.hi + " pitch_keycenter=" + (z.root == null ? 60 : z.root) + " lovel=" + (z.vlo || 1) + " hivel=" + (z.vhi == null ? 127 : z.vhi) +
        (z.tune ? " tune=" + Math.round(z.tune) : "") + (z.gain != null && z.gain !== 1 ? " volume=" + (20 * Math.log10(Math.max(0.01, z.gain))).toFixed(1) : "") +
        (z.loop && z.loop.on && z.loop.end > z.loop.start ? " loop_mode=loop_continuous loop_start=" + z.loop.start + " loop_end=" + z.loop.end : " loop_mode=no_loop"));
    });
    if (!files.length) throw new Error("Add at least one sample first.");
    var base = (inst.name || "Instrument").replace(/[^\w.\- ]+/g, "").trim() || "Instrument";
    return [{ name: base + ".sfz", data: new TextEncoder().encode(lines.join("\n") + "\n") }].concat(files);
  }
  // a note name in a file name: "Piano C4.wav", "vln_F#3_mf", "A0" -> a MIDI note, or null
  function noteFromName(s) {
    var m = /(?:^|[^A-Za-z])([A-Ga-g])([#b]|s(?=-?\d))?(-?\d)(?![0-9])/.exec(String(s).replace(/\.[^.]+$/, ""));
    if (!m) { var n = /(?:^|\D)(\d{2,3})(?:\D|$)/.exec(String(s)); return n && +n[1] >= 12 && +n[1] <= 120 ? +n[1] : null; }
    var b = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1].toLowerCase()] + (m[2] === "#" || m[2] === "s" ? 1 : m[2] === "b" ? -1 : 0);
    return clamp((Number(m[3]) + 1) * 12 + b, 0, 127);
  }
  // spread the zones across the keyboard: each from halfway to the one below up to halfway to the one above
  function spread(zones) {
    var z = zones.slice().sort(function (a, b) { return a.root - b.root; });
    z.forEach(function (x, i) { x.lo = i === 0 ? 0 : Math.floor((z[i - 1].root + x.root) / 2) + 1; x.hi = i === z.length - 1 ? 127 : Math.floor((x.root + z[i + 1].root) / 2); });
    return zones;
  }
  window.CPSampler = { voice: voice, render: render, sf2: sf2, sfz: sfz, zoneFor: zoneFor, noteFromName: noteFromName, spread: spread, mono16: mono16 };
})();
