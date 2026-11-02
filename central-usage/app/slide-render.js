/* Central Control - draws a designed slide (the Slides tab's designer) onto a canvas. The same code draws the editor,
 * the thumbnails, Preview and Live, the output window, the NDI / stream page, the picture sent to the Central Pedal and
 * the PDF / picture export - so what the operator sees is what the room sees.
 *
 *   deck  { id, name, kind, size: { w, h }, theme, loop: { on, seconds }, transition: { type, dur }, runItem, scriptures: [], slides: [] }
 *   slide { id, kind: "design" | "lower", name, bg: { type, color, color2, angle, media, fit, dim, bgId }, els: [], transition?, advance?, notes }
 *   el    { id, type: "text" | "image" | "video" | "shape", x, y, w, h, rot, opacity, hidden, locked, in: { type, dur, delay },
 *           text: { value, role, font, size, weight, italic, color, align, valign, lineHeight, letter, upper, fit, outline: { color, width }, shadow: { color, blur, x, y } },
 *           media, fit, loop, muted,
 *           shape: { kind: "rect" | "round" | "ellipse" | "line" | "triangle", fill, stroke, strokeW, radius } }
 * A text box's style is its theme's style for its role (title / body / ref / lower / sub) with the box's own changes on
 * top, so changing the theme restyles every box that wasn't changed by hand.
 * Lyric backgrounds: a background { type: "lyricbg", bgId } is drawn by window.CUBackgrounds.draw(id, ctx, w, h, t) when
 * the lyric backgrounds are installed (Lyrics page); otherwise a soft gradient stands in. */
(function (root) {
  "use strict";
  var FONTS = ["Inter", "Archivo", "Georgia", "Times New Roman", "Palatino Linotype", "Arial", "Helvetica", "Verdana", "Trebuchet MS", "Tahoma", "Gill Sans", "Futura", "Courier New", "Impact", "system-ui", "serif", "sans-serif"];
  var BASE_TEXT = { value: "", role: "body", font: "Inter", size: 64, weight: 700, italic: false, color: "#ffffff", align: "center", valign: "middle", lineHeight: 1.25, letter: 0, upper: false, fit: "shrink", outline: { color: "#000000", width: 0 }, shadow: { color: "rgba(0,0,0,0.6)", blur: 16, x: 0, y: 3 } };
  // master styles: a theme sets the background and each text role's look
  var THEMES = [
    { id: "classic", name: "Classic", bg: { type: "gradient", color: "#0f1a2b", color2: "#1d3557", angle: 135 }, title: { font: "Archivo", size: 96, weight: 800, color: "#ffffff" }, body: { font: "Inter", size: 60, weight: 600, color: "#ffffff" }, ref: { font: "Inter", size: 36, weight: 500, color: "#c9d6ea", upper: true, letter: 4 }, lower: { box: "#0f1a2b", boxOpacity: 0.85, accent: "#4f8cff" }, sub: { font: "Inter", size: 34, weight: 500, color: "#c9d6ea" } },
    { id: "clean", name: "Clean white", bg: { type: "color", color: "#f6f4ef" }, title: { font: "Archivo", size: 96, weight: 800, color: "#1b1b1b", shadow: { blur: 0 } }, body: { font: "Inter", size: 60, weight: 600, color: "#222222", shadow: { blur: 0 } }, ref: { font: "Inter", size: 34, weight: 600, color: "#7a6f5f", upper: true, letter: 4, shadow: { blur: 0 } }, lower: { box: "#ffffff", boxOpacity: 0.92, accent: "#c08a3e" }, sub: { font: "Inter", size: 34, weight: 500, color: "#555555", shadow: { blur: 0 } } },
    { id: "night", name: "Night", bg: { type: "gradient", color: "#05060a", color2: "#1b1033", angle: 160 }, title: { font: "Archivo", size: 100, weight: 900, color: "#ffffff" }, body: { font: "Inter", size: 62, weight: 600, color: "#f1ecff" }, ref: { font: "Inter", size: 36, weight: 500, color: "#b9a7ff", upper: true, letter: 5 }, lower: { box: "#120b24", boxOpacity: 0.85, accent: "#a78bfa" }, sub: { font: "Inter", size: 34, weight: 500, color: "#d6ccff" } },
    { id: "sunrise", name: "Sunrise", bg: { type: "gradient", color: "#ff9a5a", color2: "#7a2e5c", angle: 200 }, title: { font: "Archivo", size: 96, weight: 800, color: "#ffffff" }, body: { font: "Inter", size: 60, weight: 700, color: "#ffffff" }, ref: { font: "Inter", size: 36, weight: 600, color: "#fff1e0", upper: true, letter: 4 }, lower: { box: "#3a1630", boxOpacity: 0.8, accent: "#ffb27a" }, sub: { font: "Inter", size: 34, weight: 500, color: "#ffe6d4" } },
    { id: "scripture", name: "Scripture", bg: { type: "gradient", color: "#1a1712", color2: "#3b3022", angle: 120 }, title: { font: "Georgia", size: 90, weight: 700, color: "#fff8ea" }, body: { font: "Georgia", size: 58, weight: 400, color: "#fff8ea", lineHeight: 1.4, align: "left" }, ref: { font: "Inter", size: 34, weight: 600, color: "#e8c98f", upper: true, letter: 5 }, lower: { box: "#1a1712", boxOpacity: 0.88, accent: "#e8c98f" }, sub: { font: "Georgia", size: 34, weight: 400, color: "#f1e2c4", italic: true } },
    { id: "bold", name: "Bold", bg: { type: "color", color: "#111111" }, title: { font: "Impact", size: 120, weight: 400, color: "#ffffff", upper: true, letter: 2 }, body: { font: "Archivo", size: 66, weight: 800, color: "#ffffff" }, ref: { font: "Archivo", size: 38, weight: 700, color: "#ffd23f", upper: true, letter: 3 }, lower: { box: "#ffd23f", boxOpacity: 1, accent: "#111111", text: "#111111" }, sub: { font: "Archivo", size: 36, weight: 700, color: "#333333" } },
    { id: "ocean", name: "Ocean", bg: { type: "gradient", color: "#03303f", color2: "#0b7a8f", angle: 180 }, title: { font: "Archivo", size: 96, weight: 800, color: "#ffffff" }, body: { font: "Inter", size: 60, weight: 600, color: "#e9fbff" }, ref: { font: "Inter", size: 36, weight: 600, color: "#9be7f2", upper: true, letter: 4 }, lower: { box: "#03303f", boxOpacity: 0.85, accent: "#5ad1e0" }, sub: { font: "Inter", size: 34, weight: 500, color: "#c9f3f8" } },
    { id: "plain", name: "Plain black", bg: { type: "color", color: "#000000" }, title: { font: "Inter", size: 90, weight: 800, color: "#ffffff" }, body: { font: "Inter", size: 60, weight: 700, color: "#ffffff" }, ref: { font: "Inter", size: 34, weight: 600, color: "#bbbbbb", upper: true, letter: 4 }, lower: { box: "#000000", boxOpacity: 0.75, accent: "#ffffff" }, sub: { font: "Inter", size: 34, weight: 500, color: "#dddddd" } }
  ];
  var userThemes = [];   // the church's own themes (the designer saves them in the deck store)
  function themes() { return THEMES.concat(userThemes); }
  function setUserThemes(list) { userThemes = Array.isArray(list) ? list : []; }
  function theme(id) { return themes().filter(function (t) { return t.id === id; })[0] || THEMES[0]; }
  function merge(a, b) { var o = Object.assign({}, a); for (var k in b) { if (b[k] == null) continue; if (b[k] && typeof b[k] === "object" && !Array.isArray(b[k]) && a[k] && typeof a[k] === "object") o[k] = Object.assign({}, a[k], b[k]); else o[k] = b[k]; } return o; }
  // a text box's look: base, then the theme's role, then the box's own
  function textStyle(el, th) {
    var t = el.text || {}, role = t.role || "body", r = th[role] || th.body || {};
    var s = merge(merge(BASE_TEXT, r), t);
    if (role === "lower" && th.lower && th.lower.text && !t.color) s.color = th.lower.text;
    return s;
  }

  function uid() { return Math.random().toString(36).slice(2, 10); }
  function newDeck(opt) {
    opt = opt || {};
    return { id: uid(), name: opt.name || "New deck", kind: opt.kind || "custom", size: opt.size || { w: 1920, h: 1080 }, theme: opt.theme || "classic", loop: { on: false, seconds: 8 }, transition: { type: "fade", dur: 0.5 }, runItem: opt.runItem || null, scriptures: [], slides: [], updatedAt: Date.now() };
  }
  function textEl(deck, role, value, box) {
    var W = deck.size.w, H = deck.size.h; box = box || {};
    return { id: uid(), type: "text", x: box.x != null ? box.x : W * 0.08, y: box.y != null ? box.y : H * 0.3, w: box.w != null ? box.w : W * 0.84, h: box.h != null ? box.h : H * 0.4, rot: 0, opacity: 1, text: Object.assign({ value: value || "", role: role }, box.text || {}), in: { type: "none", dur: 0.5, delay: 0 } };
  }
  // slide templates: what "+ Slide" offers
  var TEMPLATES = [
    { id: "title", name: "Title", make: function (d) { return [textEl(d, "title", "Title", { y: d.size.h * 0.32, h: d.size.h * 0.24 }), textEl(d, "sub", "A line under it", { y: d.size.h * 0.58, h: d.size.h * 0.12 })]; } },
    { id: "text", name: "Words", make: function (d) { return [textEl(d, "body", "Type here", { y: d.size.h * 0.18, h: d.size.h * 0.64 })]; } },
    { id: "titletext", name: "Title and words", make: function (d) { return [textEl(d, "title", "Heading", { y: d.size.h * 0.08, h: d.size.h * 0.18 }), textEl(d, "body", "Your points go here", { y: d.size.h * 0.3, h: d.size.h * 0.6, text: { align: "left" } })]; } },
    { id: "verse", name: "Scripture", make: function (d) { return [textEl(d, "body", "Verse text", { x: d.size.w * 0.1, w: d.size.w * 0.8, y: d.size.h * 0.14, h: d.size.h * 0.62 }), textEl(d, "ref", "Book 1:1", { x: d.size.w * 0.1, w: d.size.w * 0.8, y: d.size.h * 0.8, h: d.size.h * 0.08 })]; } },
    { id: "announce", name: "Announcement", make: function (d) { return [textEl(d, "ref", "This week", { y: d.size.h * 0.16, h: d.size.h * 0.08 }), textEl(d, "title", "Event name", { y: d.size.h * 0.28, h: d.size.h * 0.22 }), textEl(d, "sub", "Day · time · place", { y: d.size.h * 0.56, h: d.size.h * 0.1 })]; } },
    { id: "welcome", name: "Welcome", make: function (d) { return [textEl(d, "title", "Welcome", { y: d.size.h * 0.34, h: d.size.h * 0.22 }), textEl(d, "sub", "We're glad you're here", { y: d.size.h * 0.58, h: d.size.h * 0.1 })]; } },
    { id: "offering", name: "Offering", make: function (d) { return [textEl(d, "title", "Giving", { y: d.size.h * 0.3, h: d.size.h * 0.2 }), textEl(d, "sub", "Give online, text, or in the box at the back", { y: d.size.h * 0.54, h: d.size.h * 0.12 })]; } },
    { id: "blank", name: "Blank", make: function () { return []; } }
  ];
  function newSlide(deck, tpl) {
    var t = TEMPLATES.filter(function (x) { return x.id === tpl; })[0] || TEMPLATES[1];
    return { id: uid(), kind: "design", name: "", bg: { type: "theme" }, els: t.make(deck), advance: null, notes: "" };
  }
  // a lower third for the stream: name / title, or a scripture reference, on nothing (transparent)
  function newLower(deck, line1, line2) {
    var W = deck.size.w, H = deck.size.h;
    return { id: uid(), kind: "lower", name: "Lower third", bg: { type: "none" }, advance: null, notes: "",
      els: [
        { id: uid(), type: "shape", x: W * 0.06, y: H * 0.74, w: W * 0.5, h: H * 0.16, rot: 0, opacity: 1, shape: { kind: "round", fill: "@lowerBox", stroke: "", strokeW: 0, radius: 14 }, in: { type: "slide", dur: 0.45, delay: 0 } },
        { id: uid(), type: "shape", x: W * 0.06, y: H * 0.74, w: W * 0.008, h: H * 0.16, rot: 0, opacity: 1, shape: { kind: "rect", fill: "@lowerAccent", stroke: "", strokeW: 0, radius: 0 }, in: { type: "slide", dur: 0.45, delay: 0 } },
        { id: uid(), type: "text", x: W * 0.085, y: H * 0.752, w: W * 0.46, h: H * 0.07, rot: 0, opacity: 1, text: { value: line1 || "Name", role: "lower", font: null, size: 50, weight: 800, align: "left", valign: "middle", shadow: { blur: 0 } }, in: { type: "slide", dur: 0.45, delay: 0.08 } },
        { id: uid(), type: "text", x: W * 0.085, y: H * 0.822, w: W * 0.46, h: H * 0.055, rot: 0, opacity: 1, text: { value: line2 || "Title", role: "sub", align: "left", valign: "middle", shadow: { blur: 0 } }, in: { type: "slide", dur: 0.45, delay: 0.14 } }
      ] };
  }
  function isTransparent(slide) { return !!slide && (slide.bg && slide.bg.type === "none"); }

  // ---------------------------------------------------------------- text layout
  var measureCtx = null;
  function mctx() { if (!measureCtx) { var c = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(8, 8) : document.createElement("canvas"); measureCtx = c.getContext("2d"); } return measureCtx; }
  function fontStr(s, size) { return (s.italic ? "italic " : "") + (s.weight || 400) + " " + Math.max(1, size) + 'px "' + (s.font || "Inter") + '", Inter, system-ui, sans-serif'; }
  function wrap(ctx, text, maxW, letter) {
    var lines = [];
    String(text).split("\n").forEach(function (para) {
      var words = para.split(/(\s+)/), line = "";
      for (var i = 0; i < words.length; i++) {
        var w = words[i]; if (!w) continue;
        var test = line + w;
        if (line && /\S/.test(w) && width(ctx, test.replace(/\s+$/, ""), letter) > maxW) {
          lines.push(line.replace(/\s+$/, "")); line = /\s/.test(w) ? "" : w;
          while (width(ctx, line, letter) > maxW && line.length > 1) {   // one word longer than the box: break it
            var k = line.length - 1; while (k > 1 && width(ctx, line.slice(0, k), letter) > maxW) k--;
            lines.push(line.slice(0, k)); line = line.slice(k);
          }
        } else line = test;
      }
      lines.push(line.replace(/\s+$/, ""));
    });
    return lines;
  }
  function width(ctx, s, letter) { return ctx.measureText(s).width + (letter ? letter * Math.max(0, s.length - 1) : 0); }
  // the lines and the size a text box draws at (a box set to "shrink" gets smaller until the words fit)
  function layoutText(el, th, ctx) {
    ctx = ctx || mctx(); var s = textStyle(el, th), value = s.upper ? String(s.value || "").toUpperCase() : String(s.value || "");
    var pad = 0, maxW = Math.max(10, el.w - pad * 2), maxH = Math.max(10, el.h), size = s.size, lines, lh;
    for (var guard = 0; guard < 40; guard++) {
      ctx.font = fontStr(s, size); lines = wrap(ctx, value, maxW, s.letter); lh = size * (s.lineHeight || 1.25);
      if (s.fit !== "shrink" || lines.length * lh <= maxH || size <= 12) break;
      size = Math.max(12, Math.floor(size * 0.92));
    }
    return { style: s, size: size, lines: lines, lineH: lh, height: lines.length * lh };
  }

  // ---------------------------------------------------------------- drawing
  function resolveColor(c, th) {
    if (c === "@lowerBox") return (th.lower && th.lower.box) || "#000";
    if (c === "@lowerAccent") return (th.lower && th.lower.accent) || "#fff";
    return c;
  }
  function easeOut(x) { return 1 - Math.pow(1 - Math.max(0, Math.min(1, x)), 3); }
  // an element's entrance: alpha, offset and scale at time t (seconds since the slide went up)
  function entrance(el, t) {
    var a = el.in || {}; if (!a.type || a.type === "none" || t == null) return { a: 1, dx: 0, dy: 0, k: 1 };
    var p = easeOut((t - (a.delay || 0)) / Math.max(0.05, a.dur || 0.5));
    if (a.type === "fade") return { a: p, dx: 0, dy: 0, k: 1 };
    if (a.type === "slide") return { a: p, dx: (1 - p) * -60, dy: 0, k: 1 };
    if (a.type === "rise") return { a: p, dx: 0, dy: (1 - p) * 40, k: 1 };
    if (a.type === "zoom") return { a: p, dx: 0, dy: 0, k: 0.85 + 0.15 * p };
    return { a: 1, dx: 0, dy: 0, k: 1 };
  }
  function drawMedia(ctx, img, x, y, w, h, fit) {
    var sw = img.videoWidth || img.naturalWidth || img.width, sh = img.videoHeight || img.naturalHeight || img.height; if (!sw || !sh) return false;
    if (fit === "fill") { ctx.drawImage(img, x, y, w, h); return true; }
    var k = fit === "cover" ? Math.max(w / sw, h / sh) : Math.min(w / sw, h / sh), dw = sw * k, dh = sh * k;
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh); ctx.restore(); return true;
  }
  function gradient(ctx, W, H, c1, c2, angle) {
    var a = ((angle == null ? 135 : angle) - 90) * Math.PI / 180, r = Math.sqrt(W * W + H * H) / 2, cx = W / 2, cy = H / 2;
    var g = ctx.createLinearGradient(cx - Math.cos(a) * r, cy - Math.sin(a) * r, cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    g.addColorStop(0, c1 || "#000"); g.addColorStop(1, c2 || c1 || "#000"); return g;
  }
  function drawBg(ctx, bg, th, W, H, opts) {
    bg = bg && bg.type && bg.type !== "theme" ? bg : th.bg || { type: "color", color: "#000" };
    if (bg.type === "none") return;
    if (bg.type === "color") { ctx.fillStyle = bg.color || "#000"; ctx.fillRect(0, 0, W, H); }
    else if (bg.type === "gradient") { ctx.fillStyle = gradient(ctx, W, H, bg.color, bg.color2, bg.angle); ctx.fillRect(0, 0, W, H); }
    else if (bg.type === "lyricbg") {
      var B = root.CUBackgrounds, ok = false;
      if (B && typeof B.draw === "function") { try { if (typeof B.has === "function") B.draw(bg.bgId, ctx, W, H, (opts.clock || 0)); else B.draw(ctx, bg.bgId, W, H, (opts.clock || 0)); ok = true; } catch (_) { } }   // (backgrounds.js: draw(id, ctx, w, h, t))
      if (!ok) { ctx.fillStyle = gradient(ctx, W, H, "#141e30", "#243b55", 135); ctx.fillRect(0, 0, W, H); }
    } else if (bg.type === "image" || bg.type === "video") {
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
      var m = opts.media && opts.media(bg.media, bg.type); if (m) drawMedia(ctx, m, 0, 0, W, H, bg.fit || "cover");
    }
    if (bg.dim) { ctx.fillStyle = "rgba(0,0,0," + Math.max(0, Math.min(0.9, bg.dim)) + ")"; ctx.fillRect(0, 0, W, H); }
  }
  function roundRect(ctx, x, y, w, h, r) { r = Math.max(0, Math.min(r, w / 2, h / 2)); ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  function drawShape(ctx, el, th) {
    var s = el.shape || {}, x = el.x, y = el.y, w = el.w, h = el.h, fill = resolveColor(s.fill, th), stroke = resolveColor(s.stroke, th);
    ctx.beginPath();
    if (s.kind === "ellipse") ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
    else if (s.kind === "round") roundRect(ctx, x, y, w, h, s.radius == null ? 24 : s.radius);
    else if (s.kind === "triangle") { ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath(); }
    else if (s.kind === "line") { ctx.moveTo(x, y + h / 2); ctx.lineTo(x + w, y + h / 2); }
    else ctx.rect(x, y, w, h);
    if (s.kind !== "line" && fill) {
      ctx.save(); var lo = th.lower || {};
      if (s.fill === "@lowerBox" && lo.boxOpacity != null) ctx.globalAlpha *= lo.boxOpacity;
      ctx.fillStyle = fill; ctx.fill(); ctx.restore();
    }
    if (stroke && (s.strokeW || s.kind === "line")) { ctx.lineWidth = s.strokeW || 6; ctx.strokeStyle = stroke || "#fff"; ctx.stroke(); }
  }
  function drawText(ctx, el, th) {
    var L = layoutText(el, th, ctx), s = L.style;
    ctx.font = fontStr(s, L.size); ctx.textBaseline = "alphabetic";
    var top = s.valign === "top" ? el.y : s.valign === "bottom" ? el.y + el.h - L.height : el.y + (el.h - L.height) / 2;
    var asc = L.size * 0.8 + (L.lineH - L.size) / 2;
    if ("letterSpacing" in ctx) { try { ctx.letterSpacing = (s.letter || 0) + "px"; } catch (_) { } }
    L.lines.forEach(function (line, i) {
      var lw = width(ctx, line, s.letter), x = s.align === "left" ? el.x : s.align === "right" ? el.x + el.w - lw : el.x + (el.w - lw) / 2, y = top + i * L.lineH + asc;
      ctx.save();
      var sh = s.shadow || {};
      if (sh.blur || sh.x || sh.y) { ctx.shadowColor = sh.color || "rgba(0,0,0,.6)"; ctx.shadowBlur = sh.blur || 0; ctx.shadowOffsetX = sh.x || 0; ctx.shadowOffsetY = sh.y || 0; }
      var ol = s.outline || {};
      if (ol.width > 0) { ctx.lineJoin = "round"; ctx.lineWidth = ol.width * 2; ctx.strokeStyle = ol.color || "#000"; ctx.strokeText(line, x, y); ctx.shadowColor = "transparent"; }
      ctx.fillStyle = s.color || "#fff"; ctx.fillText(line, x, y);
      ctx.restore();
    });
    if ("letterSpacing" in ctx) { try { ctx.letterSpacing = "0px"; } catch (_) { } }
  }
  /* render(ctx, slide, deck, opts): draws at the canvas's size (the deck's size scaled to it).
   *   opts.time    seconds since the slide went up (entrances); null = finished
   *   opts.clock   seconds, for moving backgrounds
   *   opts.media   (id, kind) -> an <img> / <video> / ImageBitmap ready to draw, or null
   *   opts.clear   clear first (true for transparent slides) */
  function render(ctx, slide, deck, opts) {
    opts = opts || {}; deck = deck || { size: { w: 1920, h: 1080 }, theme: "classic" };
    var cw = ctx.canvas.width, ch = ctx.canvas.height, W = deck.size.w, H = deck.size.h, th = typeof deck.theme === "object" ? deck.theme : theme(deck.theme);
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cw, ch);
    if (!slide) { if (!opts.transparent) { ctx.fillStyle = "#000"; ctx.fillRect(0, 0, cw, ch); } ctx.restore(); return; }
    ctx.scale(cw / W, ch / H);
    drawBg(ctx, slide.bg, th, W, H, opts);
    (slide.els || []).forEach(function (el) {
      if (el.hidden) return;
      var e = entrance(el, opts.time); if (e.a <= 0) return;
      ctx.save(); ctx.globalAlpha = (el.opacity == null ? 1 : el.opacity) * e.a;
      var cx = el.x + el.w / 2, cy = el.y + el.h / 2;
      ctx.translate(cx + e.dx, cy + e.dy); if (el.rot) ctx.rotate(el.rot * Math.PI / 180); if (e.k !== 1) ctx.scale(e.k, e.k); ctx.translate(-cx, -cy);
      if (el.type === "text") drawText(ctx, el, th);
      else if (el.type === "shape") drawShape(ctx, el, th);
      else if (el.type === "image" || el.type === "video") {
        var m = opts.media && opts.media(el.media, el.type);
        if (m) drawMedia(ctx, m, el.x, el.y, el.w, el.h, el.fit || "contain");
        else if (opts.placeholders) { ctx.fillStyle = "rgba(255,255,255,.08)"; ctx.fillRect(el.x, el.y, el.w, el.h); ctx.strokeStyle = "rgba(255,255,255,.3)"; ctx.lineWidth = 3; ctx.strokeRect(el.x, el.y, el.w, el.h); }
      }
      ctx.restore();
    });
    ctx.restore();
  }
  // does it move (so a page has to keep drawing it)? a video, a moving background, or an entrance still running
  function animated(slide, t) {
    if (!slide) return false;
    if (slide.bg && (slide.bg.type === "video" || slide.bg.type === "lyricbg")) return true;
    return (slide.els || []).some(function (el) { return !el.hidden && (el.type === "video" || (el.in && el.in.type && el.in.type !== "none" && (t == null || t < (el.in.delay || 0) + (el.in.dur || 0.5) + 0.05))); });
  }
  function mediaIds(slide) { var ids = []; if (!slide) return ids; if (slide.bg && slide.bg.media) ids.push(slide.bg.media); (slide.els || []).forEach(function (e) { if (e.media) ids.push(e.media); }); return ids; }
  // which element is under a point (deck coordinates), top first
  function hit(slide, x, y) {
    var els = (slide && slide.els) || [];
    for (var i = els.length - 1; i >= 0; i--) { var e = els[i]; if (e.hidden) continue; if (x >= Math.min(e.x, e.x + e.w) && x <= Math.max(e.x, e.x + e.w) && y >= Math.min(e.y, e.y + e.h) && y <= Math.max(e.y, e.y + e.h)) return e; }
    return null;
  }

  root.CUSlideRender = { render: render, layoutText: layoutText, textStyle: textStyle, themes: themes, theme: theme, setUserThemes: setUserThemes, THEMES: THEMES, TEMPLATES: TEMPLATES, FONTS: FONTS,
    newDeck: newDeck, newSlide: newSlide, newLower: newLower, textEl: textEl, isTransparent: isTransparent, animated: animated, mediaIds: mediaIds, hit: hit, uid: uid, gradient: gradient };
})(typeof window !== "undefined" ? window : globalThis);
