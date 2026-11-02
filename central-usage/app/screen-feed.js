/* Central Control - what each screen shows, as a small live picture (for the screens and projectors on the lights
 * page's 3D stage, lights3d-screens.js).
 *   Main / Stream          the Video tab's two outputs, copied from its compositor (video.js previewTo)
 *   Slides & lyrics        the Slides tab's output (this computer's second screen and NDI): the slide or the lyrics on
 *                          their background, drawn here the way output.html draws them
 *   Central Pedal HDMI 1/2 the lyrics as the Central Pedal shows them (and the slides when it is set to show them)
 * When another computer has the job for that output (cameras, slides), this one asks it through the center for a
 * few small JPEGs a second instead. A rehearsal on the lights page (the songs played here, not on the Central
 * Pedal) steps the lyrics through the song by itself.
 *   CUScreenFeed.links()          [{ id, name }]
 *   CUScreenFeed.want(id, on)     start / stop keeping that picture up to date
 *   CUScreenFeed.canvas(id)       its canvas (16:9); .ver goes up each time it changes; .note says why it's dark
 *   CUScreenFeed.paintSlide(ctx, w, h, slide, t)   draw a slide like output.html (used by the tests too) */
(function () {
  "use strict";
  var CU = window.CentralUsage; if (!CU) return;
  var W = 384, H = 216, FPS = 15;
  var B = null; function bgs() { return B || (B = window.CUBackgrounds || null); }   // (backgrounds.js loads after this file)
  var LINKS = [
    { id: "main", name: "Video: Main", job: "cameras" },
    { id: "stream", name: "Video: Stream", job: "cameras" },
    { id: "slides", name: "Slides & lyrics (second screen, NDI)", job: "slides" },
    { id: "pi1", name: "Central Pedal HDMI 1", job: null },
    { id: "pi2", name: "Central Pedal HDMI 2", job: null },
    { id: "none", name: "Nothing (a blank screen)", job: null }
  ];
  var feeds = {}, timer = 0, remote = {}, wantedByOthers = [];
  function linkOf(id) { return LINKS.filter(function (l) { return l.id === id; })[0] || LINKS[LINKS.length - 1]; }
  function feed(id) {
    var f = feeds[id]; if (f) return f;
    var c = document.createElement("canvas"); c.width = W; c.height = H; c.ver = 0; c.note = ""; c.link = id;
    f = feeds[id] = { id: id, canvas: c, ctx: c.getContext("2d", { alpha: false }), n: 0, mode: "", lastKey: "" };
    f.ctx.fillStyle = "#000"; f.ctx.fillRect(0, 0, W, H); return f;
  }
  function elsewhere(job) { return !!job && CU.runs && CU.runs(job) === false; }   // another computer has this job

  // ------------------------------------------------------------------ drawing a slide (like output.html)
  var media = {};   // pictures and videos used as backgrounds or slides, loaded once
  function fileUrl(p) { return /^(https?|file|data|blob):/.test(p) ? p : "file://" + encodeURI(p).replace(/#/g, "%23").replace(/\?/g, "%3F"); }
  function mediaEl(p) {
    if (media[p]) return media[p];
    var el; if (/\.(mp4|webm|mov|m4v|ogv)$/i.test(p)) { el = document.createElement("video"); el.muted = true; el.loop = true; el.playsInline = true; el.autoplay = true; el.src = fileUrl(p); el.play && el.play().catch(function () { }); }
    else { el = new Image(); el.src = fileUrl(p); }
    media[p] = el; return el;
  }
  function ready(el) { return el && (el.tagName === "VIDEO" ? el.readyState >= 2 : el.complete && el.naturalWidth > 0); }
  function drawFit(g, el, w, h, cover, alpha) {
    var sw = el.videoWidth || el.naturalWidth, sh = el.videoHeight || el.naturalHeight; if (!sw || !sh) return;
    var k = cover ? Math.max(w / sw, h / sh) : Math.min(w / sw, h / sh), dw = sw * k, dh = sh * k;
    g.globalAlpha = alpha == null ? 1 : alpha; g.drawImage(el, (w - dw) / 2, (h - dh) / 2, dw, dh); g.globalAlpha = 1;
  }
  function wrap(g, text, maxW) {
    var out = []; String(text || "").split("\n").forEach(function (para) {
      var words = para.split(/\s+/).filter(Boolean), line = "";
      words.forEach(function (wd) { var t = line ? line + " " + wd : wd; if (g.measureText(t).width > maxW && line) { out.push(line); line = wd; } else line = t; });
      out.push(line);
    }); return out;
  }
  function paintBg(g, w, h, p, t) {
    if (!p) return;
    if (bgs() && B.isBg(p)) { B.draw(B.idOf(p), g, w, h, t); return; }
    var el = mediaEl(p); if (ready(el)) drawFit(g, el, w, h, true, 0.55);
  }
  function paintSlide(g, w, h, s, t) {
    g.fillStyle = "#000"; g.fillRect(0, 0, w, h);
    if (!s || s.kind === "none" || s.kind === "black") return;
    if (s.kind === "image" || s.kind === "video") { var el = mediaEl(s.path); if (ready(el)) drawFit(g, el, w, h, s.fit === "cover"); return; }
    paintBg(g, w, h, s.bgPath, t);
    var size = (Number(s.size) || 7) / 100 * h, lines;
    g.font = "700 " + size + "px Inter, system-ui, sans-serif"; g.textBaseline = "middle"; g.fillStyle = s.color || "#fff";
    lines = wrap(g, s.text || "", w * 0.86);
    var lh = size * 1.25, small = s.title ? h * 0.026 : 0, total = lines.length * lh + (s.title ? small + h * 0.03 : 0), y = (h - total) / 2;
    var align = s.align === "left" ? "left" : s.align === "right" ? "right" : "center", x = align === "left" ? w * 0.07 : align === "right" ? w * 0.93 : w / 2;
    g.textAlign = align; g.shadowColor = "rgba(0,0,0,.6)"; g.shadowBlur = size * 0.3; g.shadowOffsetY = size * 0.05;
    if (s.title) { g.save(); g.font = "600 " + small + "px Inter, system-ui, sans-serif"; g.globalAlpha = 0.5; g.fillText(String(s.title).toUpperCase().split("").join(String.fromCharCode(8202)), x, y + small / 2); g.restore(); y += small + h * 0.03; g.font = "700 " + size + "px Inter, system-ui, sans-serif"; }
    lines.forEach(function (l, i) { g.fillText(l, x, y + lh * (i + 0.5)); });
    g.shadowColor = "transparent"; g.shadowBlur = 0; g.shadowOffsetY = 0;
  }
  function tag(g, text) {   // a quiet note in the corner (only on the 3D stage, never on a real screen)
    if (!text) return; g.save(); g.font = "600 12px Inter, system-ui, sans-serif"; var w = g.measureText(text).width + 14;
    g.fillStyle = "rgba(0,0,0,.6)"; g.fillRect(6, H - 24, w, 18); g.fillStyle = "#e2c27e"; g.textBaseline = "middle"; g.textAlign = "left"; g.fillText(text, 13, H - 15); g.restore();
  }

  // ------------------------------------------------------------------ what each link shows here
  function rehearsing() { var L = window.CULights; return !!(L && L.preview && L.preview() && !(CU.state.display && CU.state.display.playing)); }
  // a rehearsal steps through the song by itself: the sung words near now (from the song's analysis), or the part's name
  function rehearsalSlide() {
    var L = window.CULights, S = window.CUSlides, song = L.song, t = L.posNow(), sec = null;
    (song.sections || []).forEach(function (x) { if (t >= x.start - 0.05) sec = x; });
    var words = (song.words || []).filter(function (w) { var a = w.start != null ? w.start : w.t, b = w.end != null ? w.end : a + 3; return a != null && t >= a - 0.4 && t <= b + 1.2; }).map(function (w) { return String(w.text || "").trim(); });
    var text = words.length ? words.join(" ") : (sec ? sec.name : song.name || "");
    var base = S && S.lyricsSlide ? S.lyricsSlide() : { kind: "lyrics", size: 7, color: "#fff", align: "center" };
    return Object.assign({}, base, { kind: "lyrics", text: text, title: sec && words.length ? sec.name : "", bgPath: S && S.bgFor ? S.bgFor(song.name, sec ? sec.name : "") : base.bgPath });
  }
  function piSlide(which) {
    var S = window.CUSlides, d = CU.state.display, ls = d && d.lyrics || {};
    if (rehearsing() && which === "pi2") return rehearsalSlide();
    if (which === "pi2" && S && S.piOn && S.piOn() && S.live().slide) return S.live().slide;   // HDMI 2 set to Slides
    var look = S && S.lyricsSlide ? S.lyricsSlide() : { kind: "lyrics", size: 7, color: "#fff", align: "center" };
    if (which === "pi1") return Object.assign({}, look, { bgPath: null, text: (ls.lines || []).join("\n"), title: d && d.song ? d.song.name : "" });
    return Object.assign({}, look, { text: (ls.lines || []).join("\n") });
  }
  function slidesSlide() {
    var S = window.CUSlides; if (!S) return null;
    if (rehearsing() && (S.lyricsLive() || !S.live().slide)) return rehearsalSlide();
    return S.live().slide || { kind: "black" };
  }
  function paintFeed(f, t) {
    var l = linkOf(f.id), c = f.canvas, g = f.ctx, note = "";
    if (f.id === "none") { g.fillStyle = "#000"; g.fillRect(0, 0, W, H); c.note = ""; return bump(f, "none"); }
    if (window.CUSlides && window.CUSlides.blanked && window.CUSlides.blanked() && (f.id === "slides" || f.id === "pi2")) { g.fillStyle = "#000"; g.fillRect(0, 0, W, H); tag(g, "Blanked"); c.note = "blanked"; return bump(f, "blank"); }
    if (elsewhere(l.job) && !rehearsing()) {   // made on another computer: its JPEGs
      var r = remote[f.id];
      if (r && r.img && performance.now() - r.at < 4000) { if (r.drawnAt !== r.at) { g.drawImage(r.img, 0, 0, W, H); r.drawnAt = r.at; tag(g, r.note); c.note = r.note || ""; bump(f, "r" + r.at); } return; }
      g.fillStyle = "#000"; g.fillRect(0, 0, W, H); tag(g, "Waiting for the computer with the " + (l.job === "cameras" ? "Cameras" : "Slides") + " job"); c.note = "waiting"; return bump(f, "wait");
    }
    if (f.id === "main" || f.id === "stream") {
      var V = window.CUVideoTab;
      if (!V || !window.CUVideo) { g.fillStyle = "#000"; g.fillRect(0, 0, W, H); tag(g, "Video works in the Central Control app"); c.note = "no video"; return bump(f, "novideo"); }
      if (!V.ready()) { if (!f.started) { f.started = true; V.start(); } g.fillStyle = "#000"; g.fillRect(0, 0, W, H); tag(g, "Starting the Video tab…"); return bump(f, "starting"); }
      if (!f.hooked) { f.hooked = true; V.previewTo(f.id, c, true); }
      note = V.previewNote(f.id); c.note = note;
      if (c._pvAt && c._pvAt !== f.pvAt) { f.pvAt = c._pvAt; if (note) tag(g, note); bump(f, "pv" + c._pvAt); }
      return;
    }
    var s = f.id === "slides" ? slidesSlide() : piSlide(f.id), key = JSON.stringify(s);
    var moving = s && (s.kind === "video" || (s.bgPath && (/\.(mp4|webm|mov|m4v|ogv)$/i.test(s.bgPath) || (bgs() && B.isBg(s.bgPath) && B.isMotion(B.idOf(s.bgPath))))));
    if (!moving && key === f.lastKey && f.n > 2) return;   // nothing changed
    f.lastKey = key; f.n++;
    paintSlide(g, W, H, s, t);
    if (f.id === "pi1" || f.id === "pi2") { if (!CU.state.connected && !rehearsing()) { tag(g, "The Central Pedal isn't connected"); c.note = "offline"; } else c.note = ""; }
    else c.note = "";
    if (rehearsing()) tag(g, "Rehearsal");
    bump(f, key);
  }
  function bump(f) { f.canvas.ver++; }

  // ------------------------------------------------------------------ the timer: only while something wants a picture
  function tick() {
    var t = performance.now() / 1000;
    Object.keys(feeds).forEach(function (id) { var f = feeds[id]; if (f.refs > 0) { try { paintFeed(f, t); } catch (e) { console.warn("screen feed", id, e); } } });
    sendForOthers(t);
  }
  function ensureTimer() { var need = Object.keys(feeds).some(function (id) { return feeds[id].refs > 0; }) || wantedByOthers.length; if (need && !timer) timer = setInterval(tick, 1000 / FPS); else if (!need && timer) { clearInterval(timer); timer = 0; } }
  function want(id, on) {
    var f = feed(id); f.refs = Math.max(0, (f.refs || 0) + (on ? 1 : -1));
    if (!f.refs && f.hooked && window.CUVideoTab) { window.CUVideoTab.previewTo(id, f.canvas, false); f.hooked = false; }
    ensureTimer(); askCenter(); if (on) paintFeed(f, performance.now() / 1000);
    return f.canvas;
  }

  // ------------------------------------------------------------------ through the center: ask for, and send, previews
  var askedKey = "";
  function askCenter() {
    var C = window.CUCenter; if (!C || !C.connected()) return;
    var links = Object.keys(feeds).filter(function (id) { var f = feeds[id]; return f.refs > 0 && elsewhere(linkOf(id).job); }), k = links.join(",");
    if (k === askedKey) return; askedKey = k; C.send({ type: "screenPreviewWant", links: links });
  }
  var jpegCanvas = null, sentAt = {};
  function sendForOthers(t) {
    var C = window.CUCenter; if (!C || !C.connected() || !wantedByOthers.length) return;
    wantedByOthers.forEach(function (id) {
      var l = linkOf(id); if (!l.job || CU.runs(l.job) !== true) return;   // only the computer with the job sends
      var now = performance.now(); if (now - (sentAt[id] || 0) < 250) return; sentAt[id] = now;   // 4 a second
      var f = feed(id); if (!f.refs) { f.refs = 0; f.forOthers = true; }
      paintFeed(f, t);
      if (!jpegCanvas) { jpegCanvas = document.createElement("canvas"); jpegCanvas.width = 320; jpegCanvas.height = 180; }
      jpegCanvas.getContext("2d").drawImage(f.canvas, 0, 0, 320, 180);
      C.send({ type: "screenPreview", link: id, jpeg: jpegCanvas.toDataURL("image/jpeg", 0.6), note: f.canvas.note || "" });
    });
  }
  CU.on("message", function (m) {
    if (m.type === "screenPreviewWanted") {
      wantedByOthers = (m.links || []).filter(function (id) { var l = linkOf(id); return l.job && CU.runs(l.job) === true; });
      Object.keys(feeds).forEach(function (id) { var f = feeds[id]; if (!f.refs && f.hooked && wantedByOthers.indexOf(id) < 0 && window.CUVideoTab) { window.CUVideoTab.previewTo(id, f.canvas, false); f.hooked = false; } });
      ensureTimer();
    }
    else if (m.type === "screenPreview" && feeds[m.link]) {
      var r = remote[m.link] || (remote[m.link] = { img: new Image() }); var img = new Image();
      img.onload = function () { r.img = img; r.at = performance.now(); r.note = m.note ? "From " + (m.from ? "another computer" : "the center") + " · " + m.note : "From another computer"; }; img.src = m.jpeg;
    }
  });
  CU.on("center", function (on) { askedKey = ""; if (on) askCenter(); });

  window.CUScreenFeed = { links: function () { return LINKS.map(function (l) { return { id: l.id, name: l.name }; }); }, want: want, canvas: function (id) { return feed(id).canvas; }, paintSlide: paintSlide, nameOf: function (id) { return linkOf(id).name; }, size: { w: W, h: H }, _tick: tick };
})();
