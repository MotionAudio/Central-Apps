/* Central Control - the pictures (and small videos) in designed slides.
 * Each file is kept once, by its sha-256, in this computer's IndexedDB ("cu-slide-media"); a deck only names it
 * ("media:<sha>"). Decks are shared through the hub (center.js "slides"), and a computer that doesn't have a picture
 * yet asks the hub for it. A big video stays where it is on disk and is named by its path ("path:/..."): that one only
 * plays on the computer that added it.
 *   CUSlideMedia.put(blob, name) -> Promise<id>        CUSlideMedia.addPath(path, name) -> id
 *   CUSlideMedia.drawable(id, kind) -> <img>/<video> or null (loading; onReady(fn) is told when it's there)
 *   CUSlideMedia.url(id) -> Promise<url>                CUSlideMedia.dataUrl(id) -> Promise<data: url> (for the output window)
 *   CUSlideMedia.share(ids) / fetchMissing(ids)        (the hub: center-link.js's socket) */
(function () {
  "use strict";
  var DB = null, mem = {}, urls = {}, els = {}, readyFns = [], askedHub = {};
  var MAX_STORE = 60 * 1024 * 1024;   // a video bigger than this stays on disk (named by its path)
  function fileUrl(p) { return /^(https?|file|data|blob):/.test(p) ? p : "file://" + encodeURI(p).replace(/#/g, "%23").replace(/\?/g, "%3F"); }
  function db() {
    if (DB) return DB;
    DB = new Promise(function (resolve) {
      try {
        var r = indexedDB.open("cu-slide-media", 1);
        r.onupgradeneeded = function () { r.result.createObjectStore("media", { keyPath: "id" }); };
        r.onsuccess = function () { resolve(r.result); }; r.onerror = function () { resolve(null); };
      } catch (_) { resolve(null); }
    });
    return DB;
  }
  function tx(mode, fn) { return db().then(function (d) { if (!d) return null; return new Promise(function (res) { var t = d.transaction("media", mode), s = t.objectStore("media"), out = fn(s); t.oncomplete = function () { res(out && out.result !== undefined ? out.result : null); }; t.onerror = function () { res(null); }; }); }); }
  async function sha(buf) { var h = await crypto.subtle.digest("SHA-256", buf); return Array.prototype.map.call(new Uint8Array(h), function (b) { return ("0" + b.toString(16)).slice(-2); }).join(""); }
  // a picture larger than the screen is made screen-sized (2560 px across at most) so decks stay light
  async function shrink(blob) {
    if (!/^image\/(png|jpeg|webp|bmp)/.test(blob.type) || typeof createImageBitmap !== "function") return blob;
    try {
      var bm = await createImageBitmap(blob), max = 2560; if (bm.width <= max && bm.height <= max) return blob;
      var k = max / Math.max(bm.width, bm.height), c = document.createElement("canvas"); c.width = Math.round(bm.width * k); c.height = Math.round(bm.height * k);
      c.getContext("2d").drawImage(bm, 0, 0, c.width, c.height);
      return await new Promise(function (res) { c.toBlob(function (b) { res(b || blob); }, blob.type === "image/png" ? "image/png" : "image/jpeg", 0.9); });
    } catch (_) { return blob; }
  }
  async function put(blob, name) {
    blob = await shrink(blob);
    var buf = await blob.arrayBuffer(), id = "media:" + await sha(buf), rec = { id: id, mime: blob.type || "application/octet-stream", name: name || "", size: buf.byteLength, at: Date.now(), blob: new Blob([buf], { type: blob.type }) };
    mem[id] = rec; await tx("readwrite", function (s) { return s.put(rec); });
    return id;
  }
  function addPath(path, name) { var id = "path:" + path; mem[id] = { id: id, path: path, name: name || path.split(/[\\/]/).pop() }; return id; }
  async function rec(id) {
    if (!id) return null; if (mem[id]) return mem[id];
    if (/^path:/.test(id)) return (mem[id] = { id: id, path: id.slice(5) });
    var r = await tx("readonly", function (s) { return s.get(id); }); if (r) mem[id] = r; return r;
  }
  async function url(id) {
    if (urls[id]) return urls[id];
    var r = await rec(id); if (!r) { fetchMissing([id]); return null; }
    urls[id] = r.path ? fileUrl(r.path) : URL.createObjectURL(r.blob); return urls[id];
  }
  async function dataUrl(id) {
    var r = await rec(id); if (!r) return null; if (r.path) return fileUrl(r.path);
    return await new Promise(function (res) { var fr = new FileReader(); fr.onload = function () { res(fr.result); }; fr.onerror = function () { res(null); }; fr.readAsDataURL(r.blob); });
  }
  function isVideo(r, kind) { return kind === "video" || (r && /^video\//.test(r.mime || "")) || (r && r.path && /\.(mp4|webm|mov|m4v|ogv)$/i.test(r.path)); }
  // something the renderer can draw now; null while it loads (the page is told when it's ready)
  function drawable(id, kind) {
    if (!id) return null; var e = els[id];
    if (e) return e.ready ? e.el : null;
    e = els[id] = { ready: false, el: null };
    url(id).then(function (u) {
      if (!u) { delete els[id]; return; }
      var r = mem[id], v = isVideo(r, kind);
      var el = v ? document.createElement("video") : new Image();
      if (v) { el.muted = true; el.loop = true; el.playsInline = true; el.autoplay = true; el.preload = "auto"; el.addEventListener("loadeddata", function () { e.ready = true; e.el = el; el.play().catch(function () { }); fire(); }, { once: true }); }
      else el.onload = function () { e.ready = true; e.el = el; fire(); };
      el.onerror = function () { delete els[id]; };
      el.src = u;
    });
    return null;
  }
  function fire() { readyFns.forEach(function (f) { try { f(); } catch (_) { } }); }
  function onReady(fn) { readyFns.push(fn); }
  function name(id) { var r = mem[id]; return r ? (r.name || (r.path ? r.path.split(/[\\/]/).pop() : "")) : ""; }

  // ---- the hub: share our files, fetch the ones we lack
  function hub() { return window.CUCenter && window.CUCenter.connected && window.CUCenter.connected() ? window.CUCenter : null; }
  var shared = {};
  async function share(ids) {
    var H = hub(); if (!H) return;
    for (var i = 0; i < ids.length; i++) {
      var id = ids[i]; if (!/^media:/.test(id) || shared[id]) continue;
      var r = await rec(id); if (!r || !r.blob || r.size > 25 * 1024 * 1024) continue;
      var b64 = await new Promise(function (res) { var fr = new FileReader(); fr.onload = function () { res(String(fr.result).split(",")[1] || ""); }; fr.readAsDataURL(r.blob); });
      H.send({ type: "slides", action: "mediaPut", id: id, mime: r.mime, name: r.name, data: b64 }); shared[id] = true;
    }
  }
  function fetchMissing(ids) {
    var H = hub(); if (!H) return;
    ids.forEach(function (id) { if (!/^media:/.test(id) || mem[id] || askedHub[id]) return; askedHub[id] = Date.now(); rec(id).then(function (r) { if (!r) H.send({ type: "slides", action: "mediaGet", id: id }); }); });
  }
  async function fromHub(m) {   // { type: "slidesMedia", id, mime, name, data }
    if (!m || !m.id || !m.data) return;
    var bin = atob(m.data), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    var blob = new Blob([u], { type: m.mime || "application/octet-stream" }), id = "media:" + await sha(u.buffer);
    if (id !== m.id) return;   // (not what we asked for)
    var r = { id: id, mime: blob.type, name: m.name || "", size: u.length, at: Date.now(), blob: blob };
    mem[id] = r; await tx("readwrite", function (s) { return s.put(r); }); delete els[id]; delete urls[id]; shared[id] = true; fire();
  }

  window.CUSlideMedia = { put: put, addPath: addPath, url: url, dataUrl: dataUrl, drawable: drawable, onReady: onReady, name: name, share: share, fetchMissing: fetchMissing, fromHub: fromHub, MAX_STORE: MAX_STORE, fileUrl: fileUrl };
})();
