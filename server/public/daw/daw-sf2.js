/* Central Usage - Studio: reading SoundFont banks (.sf2, and .sf3 with Ogg samples) in the page.
 *
 * window.CUSf2.open(reader) -> bank: reader(offset, length) -> Promise<Uint8Array> reads part of the file, so a 200 MB
 * piano only loads the headers here; a sound's samples are read when it's picked (bank.samples(regions)).
 *   bank.presets              [{ name, bank, prog, index }]
 *   bank.regions(presetIndex) [{ lo, hi, vlo, vhi, sample, root, tune (cents), atten (dB), pan (-1..1),
 *                                attack, hold, decay, sustain (0..1), release (s), loop (0 / 1 / 3), excl, cutoff (Hz) }]
 *   bank.sampleInfo(i)        { start, end, loopStart, loopEnd, rate, pitch, correction, ogg }
 *   bank.buffer(ctx, i)       Promise<AudioBuffer> of sample i (cached per context)
 */
(function () {
  "use strict";
  var GEN = { startAddrsOffset: 0, endAddrsOffset: 1, startloopAddrsOffset: 2, endloopAddrsOffset: 3, initialFilterFc: 8, pan: 17,
    attackVolEnv: 34, holdVolEnv: 35, decayVolEnv: 36, sustainVolEnv: 37, releaseVolEnv: 38, instrument: 41, keyRange: 43, velRange: 44,
    initialAttenuation: 48, coarseTune: 51, fineTune: 52, sampleID: 53, sampleModes: 54, scaleTuning: 56, exclusiveClass: 57, overridingRootKey: 58 };
  // gens added at the preset level to the instrument's (the rest are instrument-only)
  var ADDITIVE = [8, 17, 34, 35, 36, 37, 38, 48, 51, 52, 56];
  function str(u8, o, n) { var s = ""; for (var i = 0; i < n; i++) { var c = u8[o + i]; if (!c) break; s += String.fromCharCode(c); } return s.trim(); }

  async function open(reader) {
    var head = await reader(0, 12), dv = new DataView(head.buffer, head.byteOffset, head.byteLength);
    if (str(head, 0, 4) !== "RIFF" || str(head, 8, 4) !== "sfbk") throw new Error("not a SoundFont bank");
    var size = dv.getUint32(4, true) + 8, pos = 12, smpl = null, pdta = null;
    while (pos + 12 <= size && !(smpl && pdta)) {
      var h = await reader(pos, 12); if (h.length < 8) break;
      var hv = new DataView(h.buffer, h.byteOffset, h.byteLength), id = str(h, 0, 4), len = hv.getUint32(4, true);
      if (id === "LIST") {
        var type = str(h, 8, 4);
        if (type === "sdta") {   // find smpl inside
          var p = pos + 12, end = pos + 8 + len;
          while (p + 8 <= end) { var c = await reader(p, 8), cv = new DataView(c.buffer, c.byteOffset, 8), clen = cv.getUint32(4, true); if (str(c, 0, 4) === "smpl") { smpl = { offset: p + 8, length: clen }; break; } p += 8 + clen + (clen & 1); }
        } else if (type === "pdta") pdta = await reader(pos + 12, len - 4);
      }
      pos += 8 + len + (len & 1);
    }
    if (!pdta) throw new Error("this SoundFont has no presets");
    var chunks = {}, q = 0, pv = new DataView(pdta.buffer, pdta.byteOffset, pdta.byteLength);
    while (q + 8 <= pdta.length) { var cid = str(pdta, q, 4), cl = pv.getUint32(q + 4, true); chunks[cid] = { o: q + 8, n: cl }; q += 8 + cl + (cl & 1); }
    function recs(id, size, fn) { var c = chunks[id]; if (!c) return []; var out = []; for (var o = c.o; o + size <= c.o + c.n; o += size) out.push(fn(o)); return out; }
    var u16 = function (o) { return pv.getUint16(o, true); }, u32 = function (o) { return pv.getUint32(o, true); }, i16 = function (o) { return pv.getInt16(o, true); };
    var phdr = recs("phdr", 38, function (o) { return { name: str(pdta, o, 20), prog: u16(o + 20), bank: u16(o + 22), bag: u16(o + 24) }; });
    var pbag = recs("pbag", 4, function (o) { return u16(o); }), ibag = recs("ibag", 4, function (o) { return u16(o); });
    var gen = function (o) { return { op: u16(o), amt: i16(o + 2), lo: pdta[o + 2], hi: pdta[o + 3] }; };
    var pgen = recs("pgen", 4, gen), igen = recs("igen", 4, gen);
    var inst = recs("inst", 22, function (o) { return { name: str(pdta, o, 20), bag: u16(o + 20) }; });
    var shdr = recs("shdr", 46, function (o) { return { name: str(pdta, o, 20), start: u32(o + 20), end: u32(o + 24), loopStart: u32(o + 28), loopEnd: u32(o + 32), rate: u32(o + 36), pitch: pdta[o + 40], correction: pv.getInt8(o + 41), type: u16(o + 44) }; });

    function zones(bags, gens, from, to) {   // [{ gens: {op: gen}, global }]
      var out = [];
      for (var b = from; b < to; b++) { var z = {}; for (var g = bags[b]; g < bags[b + 1]; g++) z[gens[g].op] = gens[g]; out.push(z); }
      return out;
    }
    function instZones(ii) {
      var I = inst[ii]; if (!I || !inst[ii + 1]) return [];
      var zs = zones(ibag, igen, I.bag, inst[ii + 1].bag), glob = zs.length && zs[0][GEN.sampleID] == null ? zs.shift() : {};
      return zs.filter(function (z) { return z[GEN.sampleID] != null; }).map(function (z) { var m = Object.assign({}, glob, z); return m; });
    }
    function v(z, op, d) { return z[op] != null ? z[op].amt : d; }
    function tc(z, p, op) { var a = v(z, op, -12000) + (p[op] ? p[op].amt : 0); return a <= -12000 ? 0.001 : Math.pow(2, a / 1200); }
    function regions(pi) {
      var P = phdr[pi]; if (!P || !phdr[pi + 1]) return [];
      var pz = zones(pbag, pgen, P.bag, phdr[pi + 1].bag), pglob = pz.length && pz[0][GEN.instrument] == null ? pz.shift() : {}, out = [];
      pz.forEach(function (z0) {
        if (z0[GEN.instrument] == null) return;
        var p = Object.assign({}, pglob, z0), pk = p[GEN.keyRange], pvr = p[GEN.velRange];
        instZones(z0[GEN.instrument].amt & 0xffff).forEach(function (z) {
          var kr = z[GEN.keyRange], vr = z[GEN.velRange];
          var lo = Math.max(kr ? kr.lo : 0, pk ? pk.lo : 0), hi = Math.min(kr ? kr.hi : 127, pk ? pk.hi : 127), vlo = Math.max(vr ? vr.lo : 0, pvr ? pvr.lo : 0), vhi = Math.min(vr ? vr.hi : 127, pvr ? pvr.hi : 127);
          if (lo > hi || vlo > vhi) return;
          var si = z[GEN.sampleID].amt & 0xffff, s = shdr[si]; if (!s) return;
          var add = function (op, d) { return v(z, op, d) + (ADDITIVE.indexOf(op) >= 0 && p[op] ? p[op].amt : 0); };
          var rootGen = v(z, GEN.overridingRootKey, -1), root = rootGen >= 0 ? rootGen : s.pitch;
          var fc = add(GEN.initialFilterFc, 13500);
          out.push({ lo: lo, hi: hi, vlo: vlo, vhi: vhi, sample: si, root: root,
            tune: add(GEN.coarseTune, 0) * 100 + add(GEN.fineTune, 0) + s.correction, scale: add(GEN.scaleTuning, 100),
            atten: Math.max(0, add(GEN.initialAttenuation, 0)) * 0.04,   // (cB, with the usual 0.4 factor: dB = cB / 10 * 0.4)
            pan: Math.max(-1, Math.min(1, add(GEN.pan, 0) / 500)),
            attack: tc(z, p, 34), hold: tc(z, p, 35), decay: tc(z, p, 36), release: Math.max(0.01, Math.min(8, tc(z, p, 38))),
            sustain: Math.pow(10, -Math.max(0, Math.min(1440, add(GEN.sustainVolEnv, 0))) / 200),
            loop: v(z, GEN.sampleModes, 0) & 3, excl: v(z, GEN.exclusiveClass, 0), cutoff: fc >= 13500 ? 0 : 8.176 * Math.pow(2, fc / 1200),
            startOfs: v(z, 0, 0) + v(z, 4, 0) * 32768, endOfs: v(z, 1, 0) + v(z, 12, 0) * 32768, loopStartOfs: v(z, 2, 0) + v(z, 45, 0) * 32768, loopEndOfs: v(z, 3, 0) + v(z, 50, 0) * 32768 });
        });
      });
      return out;
    }
    var presets = phdr.slice(0, -1).map(function (p, i) { return { name: p.name, bank: p.bank, prog: p.prog, index: i }; });
    var cache = new WeakMap();
    function sampleInfo(i) { var s = shdr[i]; return s ? { start: s.start, end: s.end, loopStart: s.loopStart, loopEnd: s.loopEnd, rate: s.rate, pitch: s.pitch, correction: s.correction, ogg: !!(s.type & 0x10) } : null; }
    function buffer(ctx, i) {
      var m = cache.get(ctx); if (!m) { m = {}; cache.set(ctx, m); }
      if (m[i]) return m[i];
      var s = shdr[i]; if (!s || !smpl) return Promise.reject(new Error("no sample " + i));
      m[i] = (async function () {
        if (s.type & 0x10) {   // sf3: the sample is an Ogg file
          var ogg = await reader(smpl.offset + s.start, s.end - s.start);
          return await ctx.decodeAudioData(ogg.buffer.slice(ogg.byteOffset, ogg.byteOffset + ogg.byteLength));
        }
        var n = Math.max(1, s.end - s.start), raw = await reader(smpl.offset + s.start * 2, n * 2), dv2 = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
        var count = Math.floor(raw.byteLength / 2), ab = ctx.createBuffer(1, Math.max(1, count), Math.max(3000, Math.min(384000, s.rate || 44100))), ch = ab.getChannelData(0);
        for (var k = 0; k < count; k++) ch[k] = dv2.getInt16(k * 2, true) / 32768;
        return ab;
      })();
      return m[i];
    }
    return { presets: presets, regions: regions, sampleInfo: sampleInfo, buffer: buffer, presetIndex: function (bank, prog) { var p = presets.filter(function (x) { return x.bank === bank && x.prog === prog; })[0]; return p ? p.index : -1; } };
  }
  function fromBytes(u8) { return function (o, n) { return Promise.resolve(u8.subarray(Math.min(o, u8.length), Math.min(o + n, u8.length))); }; }
  window.CUSf2 = { open: open, fromBytes: fromBytes, GEN: GEN };
})();
