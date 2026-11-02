/* Central Control / Central Pedal - pictures coming in (10.2): any common picture made ready for a slide, a lyric
 * background or the Central Pedal's screens. JPEG, PNG, WebP, GIF (an animated GIF stays animated), BMP, AVIF, SVG,
 * TIFF and HEIC / HEIF. What the browser can read it reads here; TIFF and HEIC go through the app's ffmpeg (opts.convert).
 * Phone pictures are turned the way the camera held them (EXIF), and anything bigger than 3840 px on its longest side is
 * made 3840. What comes out is a JPEG (or a PNG when it has see-through parts, or the GIF / WebP untouched when it moves).
 *   CUPictures.prepare({ name, bytes | blob }, { convert?, max? }) -> Promise<{ ok, name, blob, mime, width, height,
 *        animated, video, changed } | { ok: false, error }>
 *   CUPictures.sniff(bytes)  -> "jpeg" | "png" | "gif" | "webp" | "bmp" | "tiff" | "heic" | "avif" | "svg" | "mp4" | "webm" | "mov" | null
 *   CUPictures.byName(list)  -> the list in name order (2 before 10)
 *   CUPictures.ACCEPT        -> for <input type=file accept> and the open dialogs */
(function (root) {
  "use strict";
  var MAX = 3840;
  var ERR = {
    picture: "That file isn't a picture we can read. Try a JPEG or PNG.",
    video: "That video isn't one we can play. Try MP4 (H.264), MOV or WebM.",
    heic: "This computer can't open HEIC pictures here. Open the Central Control app to add it (it converts HEIC), or save the picture as a JPEG first.",
    tiff: "This computer can't open TIFF pictures here. Open the Central Control app to add it (it converts TIFF), or save the picture as a JPEG or PNG first.",
    big: "That picture is too big to open (more than 100 megapixels). Make it smaller and try again."
  };
  var PIC_EXT = ["jpg", "jpeg", "jfif", "png", "webp", "gif", "bmp", "avif", "svg", "tif", "tiff", "heic", "heif"], VIDEO_EXT = ["mp4", "mov", "webm", "m4v"],
    OTHER_VIDEO = /\.(avi|mkv|wmv|flv|mpe?g|3gp|ts|mts|m2ts|vob|ogv|divx)$/i;
  var ACCEPT = PIC_EXT.map(function (e) { return "." + e; }).concat(VIDEO_EXT.map(function (e) { return "." + e; })).join(",") + ",image/*,video/mp4,video/quicktime,video/webm";
  var MIME = { jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", avif: "image/avif", svg: "image/svg+xml", tiff: "image/tiff", heic: "image/heic", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm" };

  function u8(b) { return b instanceof Uint8Array ? b : new Uint8Array(b && b.buffer ? b.buffer.slice(b.byteOffset || 0, (b.byteOffset || 0) + b.byteLength) : b); }
  function ascii(b, at, n) { var s = ""; for (var i = 0; i < n && at + i < b.length; i++) s += String.fromCharCode(b[at + i]); return s; }
  function sniff(bytes) {
    var b = u8(bytes); if (!b || b.length < 4) return null;
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
    if (b[0] === 0x89 && ascii(b, 1, 3) === "PNG") return "png";
    if (ascii(b, 0, 4) === "GIF8") return "gif";
    if (ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "webp";
    if (b[0] === 0x42 && b[1] === 0x4d) return "bmp";
    if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 0x2a)) return "tiff";
    if (ascii(b, 4, 4) === "ftyp") {   // ISO media: a HEIF / AVIF still, or a video
      var brands = ascii(b, 8, 4) + " " + ascii(b, 16, Math.min(64, Math.max(0, (b[0] << 24 | b[1] << 16 | b[2] << 8 | b[3]) - 16)));
      if (/avif|avis/.test(brands)) return "avif";
      if (/heic|heix|heim|heis|hevc|hevx|mif1|msf1/.test(brands)) return "heic";
      if (/qt  /.test(brands)) return "mov";
      return "mp4";
    }
    if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "webm";
    var head = ascii(b, 0, 512).replace(/^﻿/, "").trim().slice(0, 400).toLowerCase();
    if (/^<\?xml[^>]*>\s*(<!--[\s\S]*?-->\s*)*(<!doctype svg[^>]*>\s*)?<svg[\s>]/.test(head) || /^<svg[\s>]/.test(head)) return "svg";
    return null;
  }
  // the EXIF orientation of a JPEG (1 = upright), so an upright one under the size limit can stay untouched
  function jpegOrientation(b) {
    var i = 2; while (i + 4 < b.length && b[i] === 0xff) {
      var m = b[i + 1], len = b[i + 2] << 8 | b[i + 3];
      if (m === 0xe1 && ascii(b, i + 4, 4) === "Exif") {
        var t = i + 10, le = b[t] === 0x49, r16 = function (o) { return le ? b[t + o] | b[t + o + 1] << 8 : b[t + o] << 8 | b[t + o + 1]; }, r32 = function (o) { return le ? (b[t + o] | b[t + o + 1] << 8 | b[t + o + 2] << 16 | b[t + o + 3] << 24) >>> 0 : (b[t + o] << 24 | b[t + o + 1] << 16 | b[t + o + 2] << 8 | b[t + o + 3]) >>> 0; };
        var ifd = r32(4), n = r16(ifd); for (var k = 0; k < n; k++) { var e = ifd + 2 + k * 12; if (r16(e) === 0x0112) return r16(e + 8); }
        return 1;
      }
      if (m === 0xda) break; i += 2 + len;
    }
    return 1;
  }
  function gifFrames(b) {   // counts image descriptors (enough to tell one frame from many)
    var n = 0, i = 13; if (b[10] & 0x80) i += 3 * (1 << ((b[10] & 7) + 1));
    while (i < b.length && n < 3) {
      var c = b[i];
      if (c === 0x2c) { n++; var flags = b[i + 9]; i += 10; if (flags & 0x80) i += 3 * (1 << ((flags & 7) + 1)); i++; while (i < b.length && b[i]) i += b[i] + 1; i++; }
      else if (c === 0x21) { i += 2; while (i < b.length && b[i]) i += b[i] + 1; i++; }
      else break;
    }
    return n;
  }
  function webpAnimated(b) { return ascii(b, 12, 4) === "VP8X" && !!(b[20] & 0x02); }
  function ext(name) { var m = /\.([a-z0-9]+)$/i.exec(name || ""); return m ? m[1].toLowerCase() : ""; }
  function rename(name, e) { var base = String(name || "picture").replace(/\.[a-z0-9]+$/i, ""); return base + "." + e; }
  function canvas(w, h) { if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h); var c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
  function toBlob(c, type, q) { return c.convertToBlob ? c.convertToBlob({ type: type, quality: q }) : new Promise(function (res, rej) { c.toBlob(function (b) { b ? res(b) : rej(new Error("encode")); }, type, q); }); }
  function decodeImg(blob) {   // an <img> (SVG needs one; createImageBitmap can't size an SVG)
    return new Promise(function (res, rej) { var u = URL.createObjectURL(blob), im = new Image(); im.onload = function () { res({ img: im, url: u }); }; im.onerror = function () { URL.revokeObjectURL(u); rej(new Error("decode")); }; im.src = u; });
  }
  async function decode(blob, kind) {
    if (kind === "svg") { var d = await decodeImg(blob); var w = d.img.naturalWidth || 1920, h = d.img.naturalHeight || 1080; return { src: d.img, w: w, h: h, done: function () { URL.revokeObjectURL(d.url); } }; }
    if (typeof createImageBitmap === "function") { var bm = await createImageBitmap(blob, { imageOrientation: "from-image" }); return { src: bm, w: bm.width, h: bm.height, done: function () { if (bm.close) bm.close(); } }; }
    var d2 = await decodeImg(blob); return { src: d2.img, w: d2.img.naturalWidth, h: d2.img.naturalHeight, done: function () { URL.revokeObjectURL(d2.url); } };
  }
  function hasAlpha(g, w, h) {
    var step = Math.max(1, Math.floor(Math.sqrt(w * h / 250000))), d = g.getImageData(0, 0, w, h).data;
    for (var y = 0; y < h; y += step) for (var x = 0; x < w; x += step) if (d[(y * w + x) * 4 + 3] < 250) return true;
    return false;
  }

  async function prepare(input, opts) {
    opts = opts || {}; var max = opts.max || MAX, name = input.name || "picture";
    try {
      var bytes = input.bytes ? u8(input.bytes) : new Uint8Array(await input.blob.arrayBuffer()), kind = sniff(bytes), e = ext(name);
      if (kind === "mp4" || kind === "mov" || kind === "webm" || (!kind && VIDEO_EXT.indexOf(e) >= 0)) {
        if (kind === null || VIDEO_EXT.indexOf(e) >= 0 || /^(mp4|mov|webm)$/.test(kind)) return { ok: true, video: true, name: name, mime: MIME[kind] || (e === "webm" ? "video/webm" : e === "mov" ? "video/quicktime" : "video/mp4"), blob: new Blob([bytes], { type: MIME[kind] || "video/mp4" }) };
      }
      if (OTHER_VIDEO.test(name)) return { ok: false, error: ERR.video };
      if (!kind) return { ok: false, error: ERR.picture };
      // animated GIF / WebP: kept as they are, so they move
      if ((kind === "gif" && gifFrames(bytes) > 1) || (kind === "webp" && webpAnimated(bytes))) {
        var ab = new Blob([bytes], { type: MIME[kind] }), info = null; try { info = await decode(ab, kind); info.done(); } catch (_) { return { ok: false, error: ERR.picture }; }
        return { ok: true, animated: true, name: rename(name, kind === "gif" ? "gif" : "webp"), blob: ab, mime: MIME[kind], width: info.w, height: info.h, changed: false };
      }
      var src = new Blob([bytes], { type: MIME[kind] }), pic = null, converted = false;
      try { pic = await decode(src, kind); } catch (_) { pic = null; }
      if (!pic && (kind === "tiff" || kind === "heic")) {   // the app's ffmpeg turns these into a PNG
        if (typeof opts.convert !== "function") return { ok: false, error: ERR[kind] };
        var out = await opts.convert(bytes, kind, name);
        if (!out || out.error || !out.bytes) return { ok: false, error: (out && out.error) || ERR.picture };
        src = new Blob([u8(out.bytes)], { type: out.mime || "image/png" }); converted = true;
        try { pic = await decode(src, "png"); } catch (_) { return { ok: false, error: ERR.picture }; }
      }
      if (!pic) return { ok: false, error: ERR.picture };
      if (pic.w * pic.h > 100e6) { pic.done(); return { ok: false, error: ERR.big }; }
      var turned = kind === "jpeg" && jpegOrientation(bytes) > 1, k = Math.min(1, max / Math.max(pic.w, pic.h));
      if (!converted && !turned && k === 1 && /^(jpeg|png|webp)$/.test(kind)) {   // already right: keep the file as it is
        var right = kind === "jpeg" ? /^(jpg|jpeg)$/.test(e) : e === kind;   // (a .jfif or a misnamed one gets the right ending)
        pic.done(); return { ok: true, name: right ? name : rename(name, kind === "jpeg" ? "jpg" : kind), blob: src, mime: MIME[kind], width: pic.w, height: pic.h, changed: false };
      }
      var W = Math.max(1, Math.round(pic.w * k)), H = Math.max(1, Math.round(pic.h * k)), c = canvas(W, H), g = c.getContext("2d");
      g.imageSmoothingQuality = "high"; g.drawImage(pic.src, 0, 0, W, H); pic.done();
      var png = kind !== "jpeg" && hasAlpha(g, W, H), blob = await toBlob(c, png ? "image/png" : "image/jpeg", 0.9);
      return { ok: true, name: rename(name, png ? "png" : "jpg"), blob: blob, mime: blob.type || (png ? "image/png" : "image/jpeg"), width: W, height: H, changed: true };
    } catch (err) { return { ok: false, error: ERR.picture }; }
  }
  var coll = typeof Intl !== "undefined" && Intl.Collator ? new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }) : null;
  function byName(list) { return list.slice().sort(function (a, b) { var x = String(a.name || ""), y = String(b.name || ""); return coll ? coll.compare(x, y) : x < y ? -1 : x > y ? 1 : 0; }); }
  function isPictureName(n) { return PIC_EXT.indexOf(ext(n)) >= 0; }
  function isVideoName(n) { return VIDEO_EXT.indexOf(ext(n)) >= 0; }

  function isOtherVideo(n) { return OTHER_VIDEO.test(n || ""); }
  var api = { prepare: prepare, sniff: sniff, byName: byName, jpegOrientation: jpegOrientation, isPictureName: isPictureName, isVideoName: isVideoName, isOtherVideo: isOtherVideo, ACCEPT: ACCEPT, PIC_EXT: PIC_EXT, VIDEO_EXT: VIDEO_EXT, ERR: ERR, MAX: MAX };
  root.CUPictures = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : this);
