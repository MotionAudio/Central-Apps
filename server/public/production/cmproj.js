/* Central Production - the project file (.cmproj) and the small file tools everything else uses.
 *
 * A .cmproj is a zip: project.json plus the audio it uses (audio/<id>.wav) and anything else the project type keeps
 * (files/...). The desktop app saves it to disk, the website keeps it in the browser, and both save it to the Motion Audio
 * account - so a project made in one opens in the other.
 *   project.json: { format: "central-production", version: 1, id, type, name, createdAt, savedAt, app, data, daw }
 *     type: track | loop | sample | pad | instrument | plugin | board
 *     data: what the type keeps (its editor's own state); daw: the timeline project (tracks and loops), or null
 *
 *   CMProj.zip([{ name, data }]) -> Uint8Array          (stored, no compression: audio doesn't shrink anyway)
 *   CMProj.unzip(bytes) -> { name: Uint8Array }          (stored or deflated entries; deflated needs DecompressionStream)
 *   CMProj.pack(project, files) / CMProj.unpack(bytes) -> Promise<{ project, files }>
 *   CMProj.wav(AudioBuffer|{channels,sampleRate}, bits) -> ArrayBuffer;  CMProj.decode(ctx, bytes) -> Promise<AudioBuffer>
 */
(function () {
  "use strict";
  var CRC = (function () { var t = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { var c = 0xFFFFFFFF; for (var i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function bytes(d) {
    if (d instanceof Uint8Array) return d;
    if (d instanceof ArrayBuffer) return new Uint8Array(d);
    if (ArrayBuffer.isView(d)) return new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
    return new TextEncoder().encode(typeof d === "string" ? d : JSON.stringify(d));
  }
  function zip(files) {
    var parts = [], central = [], off = 0, enc = new TextEncoder();
    files.forEach(function (f) {
      var name = enc.encode(f.name), data = bytes(f.data), crc = crc32(data), h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true); h.setUint16(10, 0, true); h.setUint16(12, 0x21, true);
      h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
      parts.push(new Uint8Array(h.buffer), name, data);
      var c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true); c.setUint16(12, 0, true); c.setUint16(14, 0x21, true);
      c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
      central.push(new Uint8Array(c.buffer), name);
      off += 30 + name.length + data.length;
    });
    var cdSize = central.reduce(function (a, b) { return a + b.length; }, 0), e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cdSize, true); e.setUint32(16, off, true);
    var all = parts.concat(central, [new Uint8Array(e.buffer)]), n = all.reduce(function (a, b) { return a + b.length; }, 0), out = new Uint8Array(n), p = 0;
    all.forEach(function (b) { out.set(b, p); p += b.length; });
    return out;
  }
  function inflate(data) {
    if (typeof DecompressionStream === "undefined") return Promise.reject(new Error("This browser can't open compressed zips. Use a newer browser."));
    var ds = new DecompressionStream("deflate-raw"), w = ds.writable.getWriter(); w.write(data); w.close();
    return new Response(ds.readable).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  function unzip(input) {
    var b = bytes(input), v = new DataView(b.buffer, b.byteOffset, b.byteLength), dec = new TextDecoder(), end = -1;
    for (var i = b.length - 22; i >= Math.max(0, b.length - 66000); i--) if (v.getUint32(i, true) === 0x06054b50) { end = i; break; }
    if (end < 0) return Promise.reject(new Error("That isn't a Central Production project (not a zip)."));
    var count = v.getUint16(end + 10, true), p = v.getUint32(end + 16, true), out = {}, jobs = [];
    for (var k = 0; k < count; k++) {
      if (v.getUint32(p, true) !== 0x02014b50) return Promise.reject(new Error("That project file is damaged."));
      var method = v.getUint16(p + 10, true), csize = v.getUint32(p + 20, true), nlen = v.getUint16(p + 28, true), xlen = v.getUint16(p + 30, true), clen = v.getUint16(p + 32, true), lho = v.getUint32(p + 42, true);
      var name = dec.decode(b.subarray(p + 46, p + 46 + nlen));
      var lnl = v.getUint16(lho + 26, true), lxl = v.getUint16(lho + 28, true), start = lho + 30 + lnl + lxl, data = b.subarray(start, start + csize);
      if (name.indexOf("..") >= 0 || name.charAt(0) === "/") return Promise.reject(new Error("That project file has a strange path in it."));
      if (!/\/$/.test(name)) { if (method === 0) out[name] = data; else if (method === 8) jobs.push((function (n, d) { return inflate(d).then(function (r) { out[n] = r; }); })(name, data)); }
      p += 46 + nlen + xlen + clen;
    }
    return Promise.all(jobs).then(function () { return out; });
  }

  // ---- WAV: write 16 / 24 / 32-bit float, read PCM 8-32 bit and float (what the apps and the website make)
  function chans(buf) { if (buf.getChannelData) { var a = []; for (var c = 0; c < buf.numberOfChannels; c++) a.push(buf.getChannelData(c)); return a; } return buf.channels; }
  function wav(buf, bits, meta) {
    bits = bits === 32 ? 32 : bits === 16 ? 16 : 24;
    var ch = chans(buf), n = ch[0].length, nc = ch.length, rate = buf.sampleRate, bps = bits / 8, extra = meta ? smpl(meta) : null;
    var dataLen = n * nc * bps, size = 44 + dataLen + (extra ? extra.length : 0), ab = new ArrayBuffer(size), v = new DataView(ab);
    function w(o, s) { for (var i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); }
    w(0, "RIFF"); v.setUint32(4, size - 8, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, bits === 32 ? 3 : 1, true); v.setUint16(22, nc, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * nc * bps, true); v.setUint16(32, nc * bps, true); v.setUint16(34, bits, true); w(36, "data"); v.setUint32(40, dataLen, true);
    var o = 44;
    for (var i = 0; i < n; i++) for (var c = 0; c < nc; c++) {
      var x = Math.max(-1, Math.min(1, ch[c][i] || 0));
      if (bits === 32) { v.setFloat32(o, x, true); o += 4; }
      else if (bits === 16) { v.setInt16(o, Math.round(x < 0 ? x * 32768 : x * 32767), true); o += 2; }
      else { var s = Math.round(x < 0 ? x * 8388608 : x * 8388607); v.setUint8(o, s & 255); v.setUint8(o + 1, (s >> 8) & 255); v.setUint8(o + 2, (s >> 16) & 255); o += 3; }
    }
    if (extra) new Uint8Array(ab).set(extra, o);
    return ab;
  }
  // a "smpl" chunk: the root note and the loop points, so a sampler (and our SF2 / SFZ export) knows them
  function smpl(m) {
    var b = new ArrayBuffer(8 + 36 + (m.loop ? 24 : 0)), v = new DataView(b);
    [0x73, 0x6d, 0x70, 0x6c].forEach(function (c, i) { v.setUint8(i, c); }); v.setUint32(4, b.byteLength - 8, true);
    v.setUint32(20, m.root != null ? m.root : 60, true); v.setUint32(36, m.loop ? 1 : 0, true);
    if (m.loop) { v.setUint32(44 + 8, m.loop[0], true); v.setUint32(44 + 12, m.loop[1], true); }
    return new Uint8Array(b);
  }
  function readWav(input) {
    var b = bytes(input), v = new DataView(b.buffer, b.byteOffset, b.byteLength), s = function (o) { return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]); };
    if (s(0) !== "RIFF" || s(8) !== "WAVE") return null;
    var p = 12, fmt = null, data = null, meta = {};
    while (p + 8 <= b.length) {
      var id = s(p), len = v.getUint32(p + 4, true);
      if (id === "fmt ") fmt = { tag: v.getUint16(p + 8, true), ch: v.getUint16(p + 10, true), rate: v.getUint32(p + 12, true), bits: v.getUint16(p + 22, true) };
      else if (id === "data") data = { off: p + 8, len: Math.min(len, b.length - p - 8) };
      else if (id === "smpl" && len >= 36) { meta.root = v.getUint32(p + 8 + 12, true); if (v.getUint32(p + 8 + 28, true) > 0 && len >= 60) meta.loop = [v.getUint32(p + 8 + 44, true), v.getUint32(p + 8 + 48, true)]; }
      p += 8 + len + (len & 1);
    }
    if (!fmt || !data) return null;
    var bps = fmt.bits / 8, n = Math.floor(data.len / (bps * fmt.ch)), out = [];
    for (var c = 0; c < fmt.ch; c++) out.push(new Float32Array(n));
    for (var i = 0, o = data.off; i < n; i++) for (var c2 = 0; c2 < fmt.ch; c2++, o += bps) {
      var x;
      if (fmt.tag === 3) x = bps === 8 ? v.getFloat64(o, true) : v.getFloat32(o, true);
      else if (bps === 1) x = (b[o] - 128) / 128;
      else if (bps === 2) x = v.getInt16(o, true) / 32768;
      else if (bps === 3) { var q = b[o] | (b[o + 1] << 8) | (b[o + 2] << 16); if (q & 0x800000) q |= ~0xFFFFFF; x = q / 8388608; }
      else x = v.getInt32(o, true) / 2147483648;
      out[c2][i] = x;
    }
    return { sampleRate: fmt.rate, channels: out, length: n, meta: meta };
  }
  // any audio file -> an AudioBuffer (WAVs are read here first so their loop points survive; the rest by the browser)
  function decode(ctx, input) {
    var w = readWav(input);
    if (w) { var ab = ctx.createBuffer(w.channels.length, Math.max(1, w.length), w.sampleRate); w.channels.forEach(function (d, i) { ab.copyToChannel(d, i); }); ab.__meta = w.meta; return Promise.resolve(ab); }
    var b = bytes(input), copy = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    return ctx.decodeAudioData(copy);
  }

  // ---- the project
  function pack(project, files) {
    var list = [{ name: "project.json", data: JSON.stringify(project, null, 1) }];
    Object.keys(files || {}).forEach(function (n) { if (files[n]) list.push({ name: n, data: files[n] }); });
    return zip(list);
  }
  function unpack(input) {
    return unzip(input).then(function (all) {
      if (!all["project.json"]) throw new Error("That zip isn't a Central Production project (no project.json).");
      var project; try { project = JSON.parse(new TextDecoder().decode(all["project.json"])); } catch (_) { throw new Error("That project's project.json can't be read."); }
      if (!project || project.format !== "central-production") throw new Error("That isn't a Central Production project.");
      if ((Number(project.version) || 1) > 1) throw new Error("That project was saved by a newer Central Production. Update this one first.");
      delete all["project.json"];
      return { project: project, files: all };
    });
  }
  function slug(s, d) { return String(s || d || "untitled").normalize("NFKD").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase().slice(0, 50) || (d || "untitled"); }
  function download(name, data, type) {
    var a = document.createElement("a"), url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type: type || "application/octet-stream" }));
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 2000);
  }
  window.CMProj = { zip: zip, unzip: unzip, crc32: crc32, bytes: bytes, wav: wav, readWav: readWav, decode: decode, pack: pack, unpack: unpack, slug: slug, download: download };
})();
