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
    { id: "clean", name: "Clean white", bg: { type: "color", color: "#f6f4ef" }, title: { font: "Archivo", size: 96, weight: 800, color: "#1b1b1b", shadow: { blur: 0, y: 0 } }, body: { font: "Inter", size: 60, weight: 600, color: "#222222", shadow: { blur: 0, y: 0 } }, ref: { font: "Inter", size: 34, weight: 600, color: "#7a6f5f", upper: true, letter: 4, shadow: { blur: 0, y: 0 } }, lower: { box: "#ffffff", boxOpacity: 0.92, accent: "#c08a3e" }, sub: { font: "Inter", size: 34, weight: 500, color: "#555555", shadow: { blur: 0, y: 0 } } },
    { id: "night", name: "Night", bg: { type: "gradient", color: "#05060a", color2: "#1b1033", angle: 160 }, title: { font: "Archivo", size: 100, weight: 900, color: "#ffffff" }, body: { font: "Inter", size: 62, weight: 600, color: "#f1ecff" }, ref: { font: "Inter", size: 36, weight: 500, color: "#b9a7ff", upper: true, letter: 5 }, lower: { box: "#120b24", boxOpacity: 0.85, accent: "#a78bfa" }, sub: { font: "Inter", size: 34, weight: 500, color: "#d6ccff" } },
    { id: "sunrise", name: "Sunrise", bg: { type: "gradient", color: "#ff9a5a", color2: "#7a2e5c", angle: 200 }, title: { font: "Archivo", size: 96, weight: 800, color: "#ffffff" }, body: { font: "Inter", size: 60, weight: 700, color: "#ffffff" }, ref: { font: "Inter", size: 36, weight: 600, color: "#fff1e0", upper: true, letter: 4 }, lower: { box: "#3a1630", boxOpacity: 0.8, accent: "#ffb27a" }, sub: { font: "Inter", size: 34, weight: 500, color: "#ffe6d4" } },
    { id: "scripture", name: "Scripture", bg: { type: "gradient", color: "#1a1712", color2: "#3b3022", angle: 120 }, title: { font: "Georgia", size: 90, weight: 700, color: "#fff8ea" }, body: { font: "Georgia", size: 58, weight: 400, color: "#fff8ea", lineHeight: 1.4, align: "left" }, ref: { font: "Inter", size: 34, weight: 600, color: "#e8c98f", upper: true, letter: 5 }, lower: { box: "#1a1712", boxOpacity: 0.88, accent: "#e8c98f" }, sub: { font: "Georgia", size: 34, weight: 400, color: "#f1e2c4", italic: true } },
    { id: "bold", name: "Bold", bg: { type: "color", color: "#111111" }, title: { font: "Impact", size: 120, weight: 400, color: "#ffffff", upper: true, letter: 2 }, body: { font: "Archivo", size: 66, weight: 800, color: "#ffffff" }, ref: { font: "Archivo", size: 38, weight: 700, color: "#ffd23f", upper: true, letter: 3 }, lower: { box: "#ffd23f", boxOpacity: 1, accent: "#111111", text: "#111111" }, sub: { font: "Archivo", size: 36, weight: 700, color: "#333333" } },
    { id: "ocean", name: "Ocean", bg: { type: "gradient", color: "#03303f", color2: "#0b7a8f", angle: 180 }, title: { font: "Archivo", size: 96, weight: 800, color: "#ffffff" }, body: { font: "Inter", size: 60, weight: 600, color: "#e9fbff" }, ref: { font: "Inter", size: 36, weight: 600, color: "#9be7f2", upper: true, letter: 4 }, lower: { box: "#03303f", boxOpacity: 0.85, accent: "#5ad1e0" }, sub: { font: "Inter", size: 34, weight: 500, color: "#c9f3f8" } },
    { id: "plain", name: "Plain black", bg: { type: "color", color: "#000000" }, title: { font: "Inter", size: 90, weight: 800, color: "#ffffff" }, body: { font: "Inter", size: 60, weight: 700, color: "#ffffff" }, ref: { font: "Inter", size: 34, weight: 600, color: "#bbbbbb", upper: true, letter: 4 }, lower: { box: "#000000", boxOpacity: 0.75, accent: "#ffffff" }, sub: { font: "Inter", size: 34, weight: 500, color: "#dddddd" } }
  ];
  var userThemes = [];   // the church's own themes (the designer saves them in the deck store)
  // (10.2) Central Utility's seasonal looks (backgrounds-seasons.js sets window.CUSeasonThemes): the free themes' shape,
  // a moving seasonal background, and lower thirds in the same colours. tier "utility" - the designer offers them with that plan.
  function seasonThemes() {
    return (root.CUSeasonThemes || []).map(function (s) {
      return { id: s.id, name: s.name, tier: s.tier, season: s.season, bg: s.bg, title: s.title, body: s.body,
        ref: Object.assign({ upper: true, letter: 4 }, s.ref), lower: Object.assign({ boxOpacity: 0.82 }, s.lower), sub: { font: "Inter", size: 34, weight: 500, color: s.body.color, shadow: s.body.shadow } };
    });
  }
  function themes() { return THEMES.concat(seasonThemes(), userThemes); }
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
  // (10.3) a shape, an entrance, and a QR code's place (a white square marked placeholder: "qr" - the church drops its
  // own QR picture on it). The words inside say what goes there; they're placeholders too.
  function shapeEl(x, y, w, h, shape, inn) { return { id: uid(), type: "shape", x: x, y: y, w: w, h: h, rot: 0, opacity: 1, shape: Object.assign({ kind: "rect", fill: "", stroke: "", strokeW: 0 }, shape), in: inn || { type: "none", dur: 0.5, delay: 0 } }; }
  function rise() { return { type: "rise", dur: 0.5, delay: 0 }; }
  function qrBox(d, x, y, size, label) {
    var out = [shapeEl(x, y, size, size, { kind: "round", fill: "#ffffff", radius: Math.round(size * 0.06) }), shapeEl(x + size * 0.12, y + size * 0.12, size * 0.76, size * 0.76, { kind: "round", fill: "", stroke: "#c8c8c8", strokeW: 4, radius: 8 }),
      textEl(d, "sub", "Your QR code", { x: x, y: y + size * 0.42, w: size, h: size * 0.16, text: { color: "#555555", size: Math.max(14, Math.round(size * 0.09)), weight: 700, shadow: { blur: 0, y: 0 } } })];
    out.forEach(function (e) { e.placeholder = "qr"; });
    if (label) out.push(textEl(d, "ref", label, { x: x - size * 0.3, y: y + size + 16, w: size * 1.6, h: 48 }));
    return out;
  }
  var U = "utility";
  // slide templates: what "+ Slide" offers
  var TEMPLATES = [
    { id: "title", name: "Title", make: function (d) { return [textEl(d, "title", "Title", { y: d.size.h * 0.32, h: d.size.h * 0.24 }), textEl(d, "sub", "A line under it", { y: d.size.h * 0.58, h: d.size.h * 0.12 })]; } },
    { id: "text", name: "Words", make: function (d) { return [textEl(d, "body", "Type here", { y: d.size.h * 0.18, h: d.size.h * 0.64 })]; } },
    { id: "titletext", name: "Title and words", make: function (d) { return [textEl(d, "title", "Heading", { y: d.size.h * 0.08, h: d.size.h * 0.18 }), textEl(d, "body", "Your points go here", { y: d.size.h * 0.3, h: d.size.h * 0.6, text: { align: "left" } })]; } },
    { id: "verse", name: "Scripture", make: function (d) { return [textEl(d, "body", "Verse text", { x: d.size.w * 0.1, w: d.size.w * 0.8, y: d.size.h * 0.14, h: d.size.h * 0.62 }), textEl(d, "ref", "Book 1:1", { x: d.size.w * 0.1, w: d.size.w * 0.8, y: d.size.h * 0.8, h: d.size.h * 0.08 })]; } },
    { id: "announce", name: "Announcement", make: function (d) { return [textEl(d, "ref", "This week", { y: d.size.h * 0.16, h: d.size.h * 0.08 }), textEl(d, "title", "Event name", { y: d.size.h * 0.28, h: d.size.h * 0.22 }), textEl(d, "sub", "Day · time · place", { y: d.size.h * 0.56, h: d.size.h * 0.1 })]; } },
    { id: "welcome", name: "Welcome", make: function (d) { return [textEl(d, "title", "Welcome", { y: d.size.h * 0.34, h: d.size.h * 0.22 }), textEl(d, "sub", "We're glad you're here", { y: d.size.h * 0.58, h: d.size.h * 0.1 })]; } },
    { id: "offering", name: "Offering", make: function (d) { return [textEl(d, "title", "Giving", { y: d.size.h * 0.3, h: d.size.h * 0.2 }), textEl(d, "sub", "Give online, text, or in the box at the back", { y: d.size.h * 0.54, h: d.size.h * 0.12 })]; } },
    { id: "blank", name: "Blank", make: function () { return []; } },
    // (10.2) Central Utility's graphics: countdowns, lower-third styles and overlays for the stream ({countdown} in a text
    // box counts down to the slide's countdown: { seconds } from when it goes up, or { at: "10:30" } a clock time)
    { id: "u-count", name: "Countdown: starting soon", group: "Countdowns", tier: "utility", countdown: { seconds: 300 }, make: function (d) { return [textEl(d, "ref", "We're starting in", { y: d.size.h * 0.3, h: d.size.h * 0.08 }), textEl(d, "title", "{countdown}", { y: d.size.h * 0.4, h: d.size.h * 0.26, text: { size: 220, weight: 900 } }), textEl(d, "sub", "Grab a seat - we're glad you're here", { y: d.size.h * 0.7, h: d.size.h * 0.08 })]; } },
    { id: "u-count-ring", name: "Countdown: ring", group: "Countdowns", tier: "utility", countdown: { seconds: 300 }, make: function (d) { var W = d.size.w, H = d.size.h, r = H * 0.26; return [{ id: uid(), type: "shape", x: W / 2 - r, y: H * 0.46 - r, w: r * 2, h: r * 2, rot: 0, opacity: 1, shape: { kind: "ellipse", fill: "", stroke: "@lowerAccent", strokeW: 14 }, in: { type: "none", dur: 0.5, delay: 0 } }, textEl(d, "title", "{countdown}", { y: H * 0.36, h: H * 0.2, text: { size: 170, weight: 900 } }), textEl(d, "ref", "Service starts soon", { y: H * 0.82, h: H * 0.07 })]; } },
    { id: "u-count-clock", name: "Countdown: to a time", group: "Countdowns", tier: "utility", countdown: { at: "10:30" }, make: function (d) { return [textEl(d, "title", "{countdown}", { y: d.size.h * 0.32, h: d.size.h * 0.26, text: { size: 200, weight: 900 } }), textEl(d, "sub", "until the service starts at {at}", { y: d.size.h * 0.6, h: d.size.h * 0.08 })]; } },
    { id: "u-count-corner", name: "Countdown: in the corner", group: "Countdowns", tier: "utility", countdown: { seconds: 300 }, bg: { type: "none" }, make: function (d) { var W = d.size.w, H = d.size.h; return [{ id: uid(), type: "shape", x: W * 0.8, y: H * 0.06, w: W * 0.15, h: H * 0.1, rot: 0, opacity: 1, shape: { kind: "round", fill: "@lowerBox", stroke: "", strokeW: 0, radius: 16 }, in: { type: "fade", dur: 0.4, delay: 0 } }, textEl(d, "lower", "{countdown}", { x: W * 0.8, y: H * 0.065, w: W * 0.15, h: H * 0.09, text: { size: 56, weight: 800, shadow: { blur: 0, y: 0 } } })]; } },
    { id: "u-lower-pill", name: "Lower third: centred pill", group: "Lower thirds", tier: "utility", bg: { type: "none" }, make: function (d) { var W = d.size.w, H = d.size.h; return [{ id: uid(), type: "shape", x: W * 0.25, y: H * 0.8, w: W * 0.5, h: H * 0.11, rot: 0, opacity: 1, shape: { kind: "round", fill: "@lowerBox", stroke: "@lowerAccent", strokeW: 4, radius: 200 }, in: { type: "zoom", dur: 0.45, delay: 0 } }, textEl(d, "lower", "Name · Title", { x: W * 0.27, y: H * 0.81, w: W * 0.46, h: H * 0.09, text: { size: 48, weight: 700, shadow: { blur: 0, y: 0 } } })]; } },
    { id: "u-lower-line", name: "Lower third: line", group: "Lower thirds", tier: "utility", bg: { type: "none" }, make: function (d) { var W = d.size.w, H = d.size.h; return [textEl(d, "lower", "Name", { x: W * 0.06, y: H * 0.76, w: W * 0.6, h: H * 0.08, text: { size: 58, weight: 800, align: "left", shadow: { blur: 12, color: "rgba(0,0,0,.7)" } } }), { id: uid(), type: "shape", x: W * 0.06, y: H * 0.85, w: W * 0.22, h: 8, rot: 0, opacity: 1, shape: { kind: "rect", fill: "@lowerAccent", stroke: "", strokeW: 0 }, in: { type: "slide", dur: 0.5, delay: 0.1 } }, textEl(d, "sub", "Title", { x: W * 0.06, y: H * 0.865, w: W * 0.6, h: H * 0.06, text: { align: "left", shadow: { blur: 10, color: "rgba(0,0,0,.7)" } } })]; } },
    { id: "u-lower-verse", name: "Lower third: scripture", group: "Lower thirds", tier: "utility", bg: { type: "none" }, make: function (d) { var W = d.size.w, H = d.size.h; return [{ id: uid(), type: "shape", x: 0, y: H * 0.72, w: W, h: H * 0.2, rot: 0, opacity: 1, shape: { kind: "rect", fill: "@lowerBox", stroke: "", strokeW: 0 }, in: { type: "fade", dur: 0.5, delay: 0 } }, textEl(d, "lower", "For God so loved the world…", { x: W * 0.08, y: H * 0.735, w: W * 0.84, h: H * 0.11, text: { size: 46, weight: 600, shadow: { blur: 0, y: 0 } } }), textEl(d, "ref", "John 3:16", { x: W * 0.08, y: H * 0.85, w: W * 0.84, h: H * 0.05, text: { size: 30 } })]; } },
    { id: "u-lower-song", name: "Lower third: song credit", group: "Lower thirds", tier: "utility", bg: { type: "none" }, make: function (d) { var W = d.size.w, H = d.size.h; return [{ id: uid(), type: "shape", x: W * 0.62, y: H * 0.84, w: W * 0.34, h: H * 0.09, rot: 0, opacity: 1, shape: { kind: "round", fill: "@lowerBox", stroke: "", strokeW: 0, radius: 12 }, in: { type: "slide", dur: 0.45, delay: 0 } }, textEl(d, "lower", "Song title", { x: W * 0.64, y: H * 0.845, w: W * 0.3, h: H * 0.045, text: { size: 34, weight: 800, align: "right", shadow: { blur: 0, y: 0 } } }), textEl(d, "sub", "Writers · CCLI #", { x: W * 0.64, y: H * 0.885, w: W * 0.3, h: H * 0.04, text: { size: 24, align: "right", shadow: { blur: 0, y: 0 } } })]; } },
    { id: "u-ov-live", name: "Overlay: live", group: "Overlays", tier: "utility", bg: { type: "none" }, make: function (d) { var W = d.size.w, H = d.size.h; return [{ id: uid(), type: "shape", x: W * 0.86, y: H * 0.05, w: W * 0.1, h: H * 0.06, rot: 0, opacity: 1, shape: { kind: "round", fill: "#d62839", stroke: "", strokeW: 0, radius: 10 }, in: { type: "fade", dur: 0.4, delay: 0 } }, textEl(d, "lower", "● LIVE", { x: W * 0.86, y: H * 0.05, w: W * 0.1, h: H * 0.06, text: { size: 34, weight: 900, color: "#ffffff", shadow: { blur: 0, y: 0 }, letter: 2 } })]; } },
    { id: "u-ov-welcome", name: "Overlay: welcome banner", group: "Overlays", tier: "utility", bg: { type: "none" }, make: function (d) { var W = d.size.w, H = d.size.h; return [{ id: uid(), type: "shape", x: 0, y: H * 0.9, w: W, h: H * 0.1, rot: 0, opacity: 1, shape: { kind: "rect", fill: "@lowerBox", stroke: "", strokeW: 0 }, in: { type: "slide", dur: 0.5, delay: 0 } }, { id: uid(), type: "shape", x: 0, y: H * 0.9, w: W, h: 6, rot: 0, opacity: 1, shape: { kind: "rect", fill: "@lowerAccent", stroke: "", strokeW: 0 }, in: { type: "slide", dur: 0.5, delay: 0 } }, textEl(d, "lower", "Welcome! Say hi in the chat and tell us where you're watching from", { x: W * 0.04, y: H * 0.91, w: W * 0.92, h: H * 0.08, text: { size: 38, weight: 600, shadow: { blur: 0, y: 0 } } })]; } },
    { id: "u-ov-prayer", name: "Overlay: prayer", group: "Overlays", tier: "utility", bg: { type: "none" }, make: function (d) { var W = d.size.w, H = d.size.h; return [{ id: uid(), type: "shape", x: W * 0.04, y: H * 0.05, w: W * 0.3, h: H * 0.11, rot: 0, opacity: 1, shape: { kind: "round", fill: "@lowerBox", stroke: "", strokeW: 0, radius: 14 }, in: { type: "fade", dur: 0.5, delay: 0 } }, textEl(d, "lower", "Want prayer?", { x: W * 0.055, y: H * 0.055, w: W * 0.28, h: H * 0.05, text: { size: 36, weight: 800, align: "left", shadow: { blur: 0, y: 0 } } }), textEl(d, "sub", "Text PRAY to 555-0100", { x: W * 0.055, y: H * 0.105, w: W * 0.28, h: H * 0.045, text: { size: 26, align: "left", shadow: { blur: 0, y: 0 } } })]; } },
    { id: "u-ov-social", name: "Overlay: find us online", group: "Overlays", tier: "utility", bg: { type: "none" }, make: function (d) { var W = d.size.w, H = d.size.h; return [{ id: uid(), type: "shape", x: W * 0.04, y: H * 0.86, w: W * 0.26, h: H * 0.08, rot: 0, opacity: 1, shape: { kind: "round", fill: "@lowerBox", stroke: "", strokeW: 0, radius: 200 }, in: { type: "slide", dur: 0.45, delay: 0 } }, textEl(d, "lower", "@yourchurch", { x: W * 0.06, y: H * 0.865, w: W * 0.22, h: H * 0.07, text: { size: 38, weight: 700, shadow: { blur: 0, y: 0 } } })]; } },
    // (10.3) more Central Utility slides: announcements, sermon, scripture, giving, welcome, baptism / communion / prayer,
    // kids, and more countdowns, lower thirds and stream overlays. A QR square is a place for the church's own QR picture.
    { id: "u-ann-event", name: "Announcement: event", group: "Announcements", tier: U, make: function (d) { var W = d.size.w, H = d.size.h; return [shapeEl(W * 0.08, H * 0.2, 10, H * 0.5, { fill: "@lowerAccent" }, rise()), textEl(d, "ref", "Coming up", { x: W * 0.11, y: H * 0.2, w: W * 0.7, h: H * 0.07, text: { align: "left" } }), textEl(d, "title", "Event name", { x: W * 0.11, y: H * 0.28, w: W * 0.8, h: H * 0.2, text: { align: "left" } }), textEl(d, "sub", "Saturday 14 June · 10am · The church hall", { x: W * 0.11, y: H * 0.5, w: W * 0.8, h: H * 0.08, text: { align: "left", size: 44 } }), textEl(d, "body", "One line about it - who it's for and what to bring.", { x: W * 0.11, y: H * 0.6, w: W * 0.72, h: H * 0.1, text: { align: "left", size: 36, weight: 500 } })]; } },
    { id: "u-ann-when", name: "Announcement: when and where", group: "Announcements", tier: U, make: function (d) { var W = d.size.w, H = d.size.h, out = [textEl(d, "title", "Event name", { y: H * 0.14, h: H * 0.2 })]; [["When", "Saturday 14 June"], ["Time", "10am - 1pm"], ["Where", "The church hall"]].forEach(function (c, i) { var x = W * (0.07 + i * 0.29); out.push(textEl(d, "ref", c[0], { x: x, y: H * 0.46, w: W * 0.28, h: H * 0.07 }), textEl(d, "sub", c[1], { x: x, y: H * 0.54, w: W * 0.28, h: H * 0.1, text: { size: 46, weight: 700 } })); if (i) out.push(shapeEl(x - W * 0.005, H * 0.46, 4, H * 0.18, { fill: "@lowerAccent" })); }); return out; } },
    { id: "u-ann-signup", name: "Announcement: sign up (QR)", group: "Announcements", tier: U, notes: "Drop your own QR picture on the white square, then delete the square.", make: function (d) { var W = d.size.w, H = d.size.h; return [textEl(d, "ref", "Sign up", { x: W * 0.08, y: H * 0.24, w: W * 0.5, h: H * 0.07, text: { align: "left" } }), textEl(d, "title", "Event name", { x: W * 0.08, y: H * 0.32, w: W * 0.52, h: H * 0.2, text: { align: "left" } }), textEl(d, "sub", "Scan the code, or go to yourchurch.org/signup", { x: W * 0.08, y: H * 0.54, w: W * 0.5, h: H * 0.12, text: { align: "left", size: 40 } })].concat(qrBox(d, W * 0.66, H * 0.22, H * 0.44, "Scan to sign up")); } },
    { id: "u-ann-week", name: "Announcement: this week", group: "Announcements", tier: U, make: function (d) { var W = d.size.w, H = d.size.h, out = [textEl(d, "title", "This week", { x: W * 0.1, y: H * 0.1, w: W * 0.8, h: H * 0.16, text: { align: "left" } })]; [["Wed", "Midweek prayer · 7pm"], ["Fri", "Youth night · 6:30pm"], ["Sun", "Baptisms after the service"]].forEach(function (r, i) { var y = H * (0.34 + i * 0.17); out.push(textEl(d, "ref", r[0], { x: W * 0.1, y: y, w: W * 0.12, h: H * 0.1, text: { align: "left", size: 44 } }), textEl(d, "sub", r[1], { x: W * 0.24, y: y, w: W * 0.66, h: H * 0.1, text: { align: "left", size: 52, weight: 700 } }), shapeEl(W * 0.1, y + H * 0.125, W * 0.8, 3, { fill: "@lowerAccent" })); }); return out; } },
    { id: "u-ser-series", name: "Sermon: series title", group: "Sermon", tier: U, make: function (d) { var H = d.size.h; return [textEl(d, "ref", "A sermon series", { y: H * 0.24, h: H * 0.07 }), textEl(d, "title", "Series title", { y: H * 0.32, h: H * 0.28, text: { size: 140, weight: 900 } }), textEl(d, "sub", "Week 1 · Speaker name", { y: H * 0.64, h: H * 0.08 })]; } },
    { id: "u-ser-split", name: "Sermon: series, split", group: "Sermon", tier: U, make: function (d) { var W = d.size.w, H = d.size.h; return [shapeEl(0, 0, W * 0.46, H, { fill: "@lowerBox" }, { type: "slide", dur: 0.6, delay: 0 }), shapeEl(W * 0.46, 0, 8, H, { fill: "@lowerAccent" }, { type: "slide", dur: 0.6, delay: 0 }), textEl(d, "ref", "Series", { x: W * 0.06, y: H * 0.3, w: W * 0.36, h: H * 0.07, text: { align: "left" } }), textEl(d, "title", "Series title", { x: W * 0.06, y: H * 0.38, w: W * 0.36, h: H * 0.3, text: { align: "left", size: 110 } }), textEl(d, "sub", "Week 1", { x: W * 0.06, y: H * 0.7, w: W * 0.36, h: H * 0.07, text: { align: "left" } })]; } },
    { id: "u-ser-point", name: "Sermon: point", group: "Sermon", tier: U, make: function (d) { var W = d.size.w, H = d.size.h; return [textEl(d, "ref", "Point 1", { x: W * 0.1, y: H * 0.3, w: W * 0.4, h: H * 0.07, text: { align: "left" } }), shapeEl(W * 0.1, H * 0.39, W * 0.06, 8, { fill: "@lowerAccent" }, rise()), textEl(d, "title", "The main thing, said in one line", { x: W * 0.1, y: H * 0.43, w: W * 0.8, h: H * 0.28, text: { align: "left", size: 96 } })]; } },
    { id: "u-ser-blank", name: "Sermon: fill in the blank", group: "Sermon", tier: U, notes: "The answer rises in a moment after the slide goes up. For a reveal on a click instead, duplicate the slide and delete the answer from the first copy.", make: function (d) { var H = d.size.h; return [textEl(d, "body", "God's ________ never fails.", { y: H * 0.3, h: H * 0.2, text: { size: 84, weight: 700 } }), textEl(d, "ref", "love", { y: H * 0.54, h: H * 0.14, text: { size: 96, weight: 900, upper: false, letter: 0 } })].map(function (e, i) { if (i) e.in = { type: "rise", dur: 0.6, delay: 1.5 }; return e; }); } },
    { id: "u-ser-quote", name: "Sermon: big quote", group: "Sermon", tier: U, make: function (d) { var W = d.size.w, H = d.size.h; return [textEl(d, "ref", "“", { y: H * 0.08, h: H * 0.26, text: { size: 300, upper: false, letter: 0, font: "Georgia" } }), textEl(d, "body", "A line worth remembering goes here.", { x: W * 0.12, y: H * 0.34, w: W * 0.76, h: H * 0.32, text: { size: 66, italic: true } }), textEl(d, "sub", "- Who said it", { y: H * 0.7, h: H * 0.08 })]; } },
    { id: "u-ser-points", name: "Sermon: three points", group: "Sermon", tier: U, make: function (d) { var W = d.size.w, H = d.size.h; return [textEl(d, "title", "Three things", { x: W * 0.1, y: H * 0.1, w: W * 0.8, h: H * 0.16, text: { align: "left" } }), shapeEl(W * 0.1, H * 0.27, W * 0.08, 8, { fill: "@lowerAccent" }), textEl(d, "body", "1. The first point\n2. The second point\n3. The third point", { x: W * 0.1, y: H * 0.33, w: W * 0.8, h: H * 0.5, text: { align: "left", size: 62 } })]; } },
    { id: "u-scr-big", name: "Scripture: big reference", group: "Scripture", tier: U, make: function (d) { var W = d.size.w, H = d.size.h; return [textEl(d, "ref", "John 3:16", { y: H * 0.12, h: H * 0.08, text: { size: 50 } }), textEl(d, "body", "Verse text", { x: W * 0.1, y: H * 0.24, w: W * 0.8, h: H * 0.52, text: { size: 66 } }), shapeEl(W * 0.45, H * 0.82, W * 0.1, 6, { fill: "@lowerAccent" })]; } },
    { id: "u-scr-side", name: "Scripture: with a side bar", group: "Scripture", tier: U, make: function (d) { var W = d.size.w, H = d.size.h; return [shapeEl(W * 0.08, H * 0.18, 10, H * 0.62, { fill: "@lowerAccent" }, rise()), textEl(d, "body", "Verse text", { x: W * 0.11, y: H * 0.18, w: W * 0.78, h: H * 0.5, text: { align: "left", size: 62 } }), textEl(d, "ref", "Psalm 46:10", { x: W * 0.11, y: H * 0.72, w: W * 0.6, h: H * 0.08, text: { align: "left" } })]; } },
    { id: "u-scr-band", name: "Scripture: on a band", group: "Scripture", tier: U, make: function (d) { var W = d.size.w, H = d.size.h; return [shapeEl(0, H * 0.28, W, H * 0.44, { fill: "@lowerBox" }, { type: "fade", dur: 0.5, delay: 0 }), textEl(d, "body", "Verse text", { x: W * 0.1, y: H * 0.31, w: W * 0.8, h: H * 0.28, text: { size: 58 } }), textEl(d, "ref", "Book 1:1", { x: W * 0.1, y: H * 0.61, w: W * 0.8, h: H * 0.07 })]; } },
    { id: "u-scr-reading", name: "Scripture: the reading", group: "Scripture", tier: U, make: function (d) { var H = d.size.h; return [textEl(d, "ref", "Today's reading", { y: H * 0.28, h: H * 0.07 }), textEl(d, "title", "Psalm 23", { y: H * 0.36, h: H * 0.22, text: { size: 130 } }), textEl(d, "sub", "Page 512 in the church Bible", { y: H * 0.6, h: H * 0.08 })]; } },
    { id: "u-give-qr", name: "Giving: QR code", group: "Giving", tier: U, notes: "Drop your own QR picture on the white square, then delete the square.", make: function (d) { var W = d.size.w, H = d.size.h; return [textEl(d, "title", "Giving", { x: W * 0.08, y: H * 0.2, w: W * 0.5, h: H * 0.2, text: { align: "left" } }), textEl(d, "sub", "Thank you for giving to the work here.", { x: W * 0.08, y: H * 0.42, w: W * 0.52, h: H * 0.08, text: { align: "left", size: 40 } }), textEl(d, "body", "Online: yourchurch.org/give\nText: GIVE to 555-0100\nOr the box at the back", { x: W * 0.08, y: H * 0.53, w: W * 0.52, h: H * 0.28, text: { align: "left", size: 42, weight: 500 } })].concat(qrBox(d, W * 0.66, H * 0.22, H * 0.44, "Scan to give")); } },
    { id: "u-give-ways", name: "Giving: three ways", group: "Giving", tier: U, make: function (d) { var W = d.size.w, H = d.size.h, out = [textEl(d, "title", "Ways to give", { y: H * 0.1, h: H * 0.18 })]; [["Online", "yourchurch.org/give"], ["Text", "GIVE to 555-0100"], ["In person", "The box at the back"]].forEach(function (c, i) { var x = W * (0.06 + i * 0.3); out.push(shapeEl(x, H * 0.36, W * 0.28, H * 0.36, { kind: "round", fill: "@lowerBox", radius: 28 }, { type: "rise", dur: 0.5, delay: i * 0.12 }), textEl(d, "ref", c[0], { x: x, y: H * 0.42, w: W * 0.28, h: H * 0.08 }), textEl(d, "lower", c[1], { x: x + W * 0.02, y: H * 0.52, w: W * 0.24, h: H * 0.12, text: { size: 40, weight: 700, shadow: { blur: 0, y: 0 } } })); }); return out; } },
    { id: "u-give-thanks", name: "Giving: thank you", group: "Giving", tier: U, make: function (d) { var W = d.size.w, H = d.size.h; return [textEl(d, "title", "Thank you", { y: H * 0.3, h: H * 0.2 }), textEl(d, "body", "Your giving keeps the doors open, the lights on and the work going.", { x: W * 0.15, y: H * 0.52, w: W * 0.7, h: H * 0.16, text: { size: 48, weight: 500 } })]; } },
    { id: "u-wel-loop", name: "Welcome: with a countdown", group: "Welcome", tier: U, countdown: { seconds: 600 }, make: function (d) { var W = d.size.w, H = d.size.h; return [textEl(d, "title", "Welcome", { y: H * 0.3, h: H * 0.22 }), textEl(d, "sub", "We're glad you're here", { y: H * 0.54, h: H * 0.08 }), shapeEl(W * 0.79, H * 0.83, W * 0.16, H * 0.1, { kind: "round", fill: "@lowerBox", radius: 16 }), textEl(d, "ref", "Starting in", { x: W * 0.79, y: H * 0.775, w: W * 0.16, h: H * 0.05, text: { size: 26 } }), textEl(d, "lower", "{countdown}", { x: W * 0.79, y: H * 0.835, w: W * 0.16, h: H * 0.09, text: { size: 54, weight: 800, shadow: { blur: 0, y: 0 } } })]; } },
    { id: "u-wel-new", name: "Welcome: new here? (QR)", group: "Welcome", tier: U, notes: "Drop your own QR picture on the white square, then delete the square.", make: function (d) { var W = d.size.w, H = d.size.h; return [textEl(d, "title", "New here?", { x: W * 0.08, y: H * 0.26, w: W * 0.52, h: H * 0.2, text: { align: "left" } }), textEl(d, "sub", "We'd love to meet you. Scan the code and say hi.", { x: W * 0.08, y: H * 0.48, w: W * 0.5, h: H * 0.14, text: { align: "left", size: 42 } })].concat(qrBox(d, W * 0.66, H * 0.22, H * 0.44, "Scan to connect")); } },
    { id: "u-wel-info", name: "Welcome: coffee and wi-fi", group: "Welcome", tier: U, make: function (d) { var W = d.size.w, H = d.size.h, out = [textEl(d, "title", "Make yourself at home", { y: H * 0.1, h: H * 0.18 })]; [["Coffee", "In the foyer, before and after"], ["Wi-Fi", "Network: Guest\nPassword: welcome"]].forEach(function (c, i) { var x = W * (0.1 + i * 0.42); out.push(shapeEl(x, H * 0.36, W * 0.38, H * 0.38, { kind: "round", fill: "@lowerBox", radius: 28 }), textEl(d, "ref", c[0], { x: x, y: H * 0.42, w: W * 0.38, h: H * 0.08 }), textEl(d, "lower", c[1], { x: x + W * 0.02, y: H * 0.52, w: W * 0.34, h: H * 0.16, text: { size: 42, weight: 700, shadow: { blur: 0, y: 0 } } })); }); return out; } },
    { id: "u-mo-baptism", name: "Baptism: name", group: "Baptism, communion, prayer", tier: U, make: function (d) { var W = d.size.w, H = d.size.h; return [textEl(d, "ref", "Baptism", { y: H * 0.22, h: H * 0.07 }), textEl(d, "title", "Name", { y: H * 0.3, h: H * 0.22, text: { size: 130 } }), textEl(d, "sub", "Sunday 14 June", { y: H * 0.54, h: H * 0.07 }), textEl(d, "body", "If anyone is in Christ, he is a new creation.", { x: W * 0.15, y: H * 0.68, w: W * 0.7, h: H * 0.08, text: { size: 38, italic: true, weight: 500 } }), textEl(d, "ref", "2 Corinthians 5:17", { y: H * 0.77, h: H * 0.05, text: { size: 26 } })]; } },
    { id: "u-mo-communion", name: "Communion: the words", group: "Baptism, communion, prayer", tier: U, make: function (d) { var W = d.size.w, H = d.size.h; return [textEl(d, "ref", "Communion", { y: H * 0.18, h: H * 0.07 }), textEl(d, "body", "This is my body which is given for you. Do this in memory of me.", { x: W * 0.12, y: H * 0.3, w: W * 0.76, h: H * 0.36, text: { size: 70 } }), textEl(d, "ref", "Luke 22:19", { y: H * 0.7, h: H * 0.07 })]; } },
    { id: "u-mo-prayer", name: "Prayer: let's pray", group: "Baptism, communion, prayer", tier: U, make: function (d) { var W = d.size.w, H = d.size.h; return [textEl(d, "title", "Let's pray", { y: H * 0.14, h: H * 0.2 }), shapeEl(W * 0.46, H * 0.36, W * 0.08, 6, { fill: "@lowerAccent" }), textEl(d, "body", "For our church family\nFor those who are unwell\nFor our town", { x: W * 0.2, y: H * 0.42, w: W * 0.6, h: H * 0.4, text: { size: 54 } })]; } },
    { id: "u-mo-prayerqr", name: "Prayer: requests (QR)", group: "Baptism, communion, prayer", tier: U, notes: "Drop your own QR picture on the white square, then delete the square.", make: function (d) { var W = d.size.w, H = d.size.h; return [textEl(d, "title", "Need prayer?", { x: W * 0.08, y: H * 0.26, w: W * 0.52, h: H * 0.2, text: { align: "left" } }), textEl(d, "sub", "Our prayer team would love to pray with you. Scan to send a request - it stays private.", { x: W * 0.08, y: H * 0.48, w: W * 0.5, h: H * 0.18, text: { align: "left", size: 40 } })].concat(qrBox(d, W * 0.66, H * 0.22, H * 0.44, "Scan to ask for prayer")); } },
    { id: "u-kids-welcome", name: "Kids: welcome", group: "Kids", tier: U, bg: { type: "lyricbg", bgId: "s-kids-rainbow", dim: 0 }, make: function (d) { var H = d.size.h; return [textEl(d, "title", "Welcome, kids!", { y: H * 0.12, h: H * 0.2, text: { size: 140, weight: 900, color: "#14305a", shadow: { blur: 0, y: 0 } } }), textEl(d, "sub", "Grab a friend and find a seat", { y: H * 0.33, h: H * 0.08, text: { size: 52, weight: 700, color: "#14305a", shadow: { blur: 0, y: 0 } } })]; } },
    { id: "u-kids-verse", name: "Kids: memory verse", group: "Kids", tier: U, bg: { type: "lyricbg", bgId: "s-kids-hills", dim: 0 }, make: function (d) { var W = d.size.w, H = d.size.h; return [shapeEl(W * 0.14, H * 0.08, W * 0.72, H * 0.5, { kind: "round", fill: "#ffffff", radius: 48 }, { type: "zoom", dur: 0.5, delay: 0 }), textEl(d, "ref", "Memory verse", { x: W * 0.14, y: H * 0.13, w: W * 0.72, h: H * 0.07, text: { color: "#e03a3a", size: 40, shadow: { blur: 0, y: 0 } } }), textEl(d, "body", "Be kind to one another.", { x: W * 0.18, y: H * 0.22, w: W * 0.64, h: H * 0.22, text: { color: "#14305a", size: 84, weight: 900, shadow: { blur: 0, y: 0 } } }), textEl(d, "ref", "Ephesians 4:32", { x: W * 0.14, y: H * 0.46, w: W * 0.72, h: H * 0.07, text: { color: "#2a7a2a", size: 36, shadow: { blur: 0, y: 0 } } })]; } },
    { id: "u-kids-count", name: "Kids: blast-off countdown", group: "Kids", tier: U, countdown: { seconds: 300 }, bg: { type: "lyricbg", bgId: "s-kids-space", dim: 0 }, make: function (d) { var H = d.size.h; return [textEl(d, "ref", "Blast off in", { y: H * 0.26, h: H * 0.09, text: { color: "#ffd04a", size: 60 } }), textEl(d, "title", "{countdown}", { y: H * 0.36, h: H * 0.28, text: { size: 240, weight: 900, color: "#ffffff" } })]; } },
    { id: "u-kids-story", name: "Kids: today's story", group: "Kids", tier: U, bg: { type: "lyricbg", bgId: "s-kids-sea", dim: 0.1 }, make: function (d) { var H = d.size.h; return [textEl(d, "ref", "Today's story", { y: H * 0.24, h: H * 0.08, text: { color: "#ffe04a", size: 48 } }), textEl(d, "title", "Jonah and the big fish", { y: H * 0.33, h: H * 0.24, text: { size: 120, weight: 900, color: "#ffffff" } }), textEl(d, "sub", "Jonah 1-3", { y: H * 0.6, h: H * 0.08, text: { color: "#ffffff", size: 44 } })]; } },
    { id: "u-kids-checkin", name: "Kids: check-in (QR)", group: "Kids", tier: U, bg: { type: "lyricbg", bgId: "s-kids-confetti", dim: 0 }, notes: "Drop your own QR picture on the white square, then delete the square.", make: function (d) { var W = d.size.w, H = d.size.h; return [textEl(d, "title", "Kids check-in", { x: W * 0.08, y: H * 0.26, w: W * 0.54, h: H * 0.2, text: { align: "left", color: "#ffffff", size: 110, weight: 900 } }), textEl(d, "sub", "Scan to check your kids in. Pick-up is at the kids' room door.", { x: W * 0.08, y: H * 0.48, w: W * 0.5, h: H * 0.16, text: { align: "left", color: "#ffffff", size: 42 } })].concat(qrBox(d, W * 0.66, H * 0.22, H * 0.44, "Scan to check in")); } },
    { id: "u-count-big", name: "Countdown: big and plain", group: "Countdowns", tier: U, countdown: { seconds: 300 }, make: function (d) { var H = d.size.h; return [textEl(d, "title", "{countdown}", { y: H * 0.28, h: H * 0.44, text: { size: 320, weight: 900 } })]; } },
    { id: "u-count-bar", name: "Countdown: welcome with a bar", group: "Countdowns", tier: U, countdown: { seconds: 300 }, make: function (d) { var W = d.size.w, H = d.size.h; return [textEl(d, "title", "Welcome", { y: H * 0.3, h: H * 0.22 }), shapeEl(0, H * 0.86, W, H * 0.14, { fill: "@lowerBox" }), shapeEl(0, H * 0.86, W, 6, { fill: "@lowerAccent" }), textEl(d, "lower", "Starting in {countdown}", { y: H * 0.875, h: H * 0.11, text: { size: 56, weight: 800, shadow: { blur: 0, y: 0 } } })]; } },
    { id: "u-lower-card", name: "Lower third: speaker card", group: "Lower thirds", tier: U, bg: { type: "none" }, make: function (d) { var W = d.size.w, H = d.size.h, sq = H * 0.14; return [shapeEl(W * 0.05, H * 0.76, W * 0.4, sq, { kind: "round", fill: "@lowerBox", radius: 14 }, { type: "slide", dur: 0.45, delay: 0 }), shapeEl(W * 0.05, H * 0.76, sq, sq, { kind: "round", fill: "@lowerAccent", radius: 14 }, { type: "slide", dur: 0.45, delay: 0 }), textEl(d, "lower", "AB", { x: W * 0.05, y: H * 0.76, w: sq, h: sq, text: { size: 56, weight: 900, color: "#ffffff", shadow: { blur: 0, y: 0 } } }), textEl(d, "lower", "Name", { x: W * 0.05 + sq + W * 0.015, y: H * 0.775, w: W * 0.3, h: H * 0.06, text: { size: 46, weight: 800, align: "left", shadow: { blur: 0, y: 0 } } }), textEl(d, "sub", "Title", { x: W * 0.05 + sq + W * 0.015, y: H * 0.835, w: W * 0.3, h: H * 0.05, text: { size: 30, align: "left", shadow: { blur: 0, y: 0 } } })]; } },
    { id: "u-lower-block", name: "Lower third: solid block", group: "Lower thirds", tier: U, bg: { type: "none" }, make: function (d) { var W = d.size.w, H = d.size.h; return [shapeEl(W * 0.06, H * 0.74, W * 0.32, H * 0.09, { fill: "@lowerAccent" }, { type: "slide", dur: 0.4, delay: 0 }), textEl(d, "lower", "Name", { x: W * 0.075, y: H * 0.745, w: W * 0.3, h: H * 0.08, text: { size: 52, weight: 900, align: "left", color: "#111111", shadow: { blur: 0, y: 0 } } }), shapeEl(W * 0.06, H * 0.83, W * 0.26, H * 0.065, { fill: "@lowerBox" }, { type: "slide", dur: 0.4, delay: 0.12 }), textEl(d, "lower", "Title", { x: W * 0.075, y: H * 0.835, w: W * 0.24, h: H * 0.055, text: { size: 30, weight: 600, align: "left", shadow: { blur: 0, y: 0 } } })]; } },
    { id: "u-lower-point", name: "Lower third: sermon point", group: "Lower thirds", tier: U, bg: { type: "none" }, make: function (d) { var W = d.size.w, H = d.size.h; return [shapeEl(0, H * 0.8, W, H * 0.12, { fill: "@lowerBox" }, { type: "fade", dur: 0.4, delay: 0 }), shapeEl(0, H * 0.8, W * 0.012, H * 0.12, { fill: "@lowerAccent" }), textEl(d, "ref", "Point 1", { x: W * 0.035, y: H * 0.82, w: W * 0.14, h: H * 0.08, text: { align: "left", size: 30 } }), textEl(d, "lower", "The main thing, said in one line", { x: W * 0.18, y: H * 0.815, w: W * 0.78, h: H * 0.09, text: { size: 46, weight: 700, align: "left", shadow: { blur: 0, y: 0 } } })]; } },
    { id: "u-lower-two", name: "Lower third: two names", group: "Lower thirds", tier: U, bg: { type: "none" }, make: function (d) { var W = d.size.w, H = d.size.h, out = []; [[W * 0.05, "left"], [W * 0.63, "right"]].forEach(function (c, i) { out.push(shapeEl(c[0], H * 0.8, W * 0.32, H * 0.11, { kind: "round", fill: "@lowerBox", radius: 12 }, { type: "rise", dur: 0.45, delay: i * 0.15 }), textEl(d, "lower", i ? "Second name" : "First name", { x: c[0] + W * 0.015, y: H * 0.81, w: W * 0.29, h: H * 0.055, text: { size: 40, weight: 800, align: c[1], shadow: { blur: 0, y: 0 } } }), textEl(d, "sub", "Title", { x: c[0] + W * 0.015, y: H * 0.86, w: W * 0.29, h: H * 0.04, text: { size: 26, align: c[1], shadow: { blur: 0, y: 0 } } })); }); return out; } },
    { id: "u-ov-give", name: "Overlay: give online (QR)", group: "Overlays", tier: U, bg: { type: "none" }, notes: "Drop your own QR picture on the white square, then delete the square.", make: function (d) { var W = d.size.w, H = d.size.h, q = H * 0.2; return [shapeEl(W * 0.8, H * 0.56, W * 0.16, H * 0.38, { kind: "round", fill: "@lowerBox", radius: 18 }, { type: "fade", dur: 0.4, delay: 0 })].concat(qrBox(d, W * 0.88 - q / 2, H * 0.59, q, null), [textEl(d, "lower", "Give online", { x: W * 0.8, y: H * 0.81, w: W * 0.16, h: H * 0.05, text: { size: 32, weight: 800, shadow: { blur: 0, y: 0 } } }), textEl(d, "sub", "yourchurch.org/give", { x: W * 0.8, y: H * 0.86, w: W * 0.16, h: H * 0.04, text: { size: 22, shadow: { blur: 0, y: 0 } } })]); } },
    { id: "u-ov-next", name: "Overlay: up next", group: "Overlays", tier: U, bg: { type: "none" }, make: function (d) { var W = d.size.w, H = d.size.h; return [shapeEl(W * 0.04, H * 0.05, W * 0.28, H * 0.075, { kind: "round", fill: "@lowerBox", radius: 200 }, { type: "slide", dur: 0.45, delay: 0 }), textEl(d, "ref", "Up next", { x: W * 0.055, y: H * 0.055, w: W * 0.09, h: H * 0.065, text: { size: 24, align: "left" } }), textEl(d, "lower", "The sermon", { x: W * 0.14, y: H * 0.055, w: W * 0.17, h: H * 0.065, text: { size: 34, weight: 800, align: "left", shadow: { blur: 0, y: 0 } } })]; } },
    { id: "u-ov-notes", name: "Overlay: sermon notes link", group: "Overlays", tier: U, bg: { type: "none" }, make: function (d) { var W = d.size.w, H = d.size.h; return [shapeEl(W * 0.56, H * 0.87, W * 0.4, H * 0.075, { kind: "round", fill: "@lowerBox", radius: 200 }, { type: "slide", dur: 0.45, delay: 0 }), textEl(d, "lower", "Sermon notes: yourchurch.org/notes", { x: W * 0.57, y: H * 0.875, w: W * 0.38, h: H * 0.065, text: { size: 32, weight: 700, shadow: { blur: 0, y: 0 } } })]; } },
    { id: "u-ov-soon", name: "Overlay: starting soon", group: "Overlays", tier: U, countdown: { seconds: 300 }, bg: { type: "none" }, make: function (d) { var W = d.size.w, H = d.size.h; return [shapeEl(0, H * 0.9, W, H * 0.1, { fill: "@lowerBox" }, { type: "slide", dur: 0.5, delay: 0 }), shapeEl(0, H * 0.9, W, 5, { fill: "@lowerAccent" }), textEl(d, "lower", "Starting soon · {countdown}", { x: W * 0.04, y: H * 0.91, w: W * 0.92, h: H * 0.08, text: { size: 40, weight: 800, shadow: { blur: 0, y: 0 } } })]; } },
    { id: "u-ov-bug", name: "Overlay: church name in the corner", group: "Overlays", tier: U, bg: { type: "none" }, make: function (d) { var W = d.size.w, H = d.size.h, e = textEl(d, "lower", "Your Church", { x: W * 0.72, y: H * 0.04, w: W * 0.25, h: H * 0.06, text: { size: 34, weight: 800, align: "right", letter: 2, shadow: { blur: 8, color: "rgba(0,0,0,.6)" } } }); e.opacity = 0.75; return [e]; } }
  ];
  function newSlide(deck, tpl) {
    var t = TEMPLATES.filter(function (x) { return x.id === tpl; })[0] || TEMPLATES[1];
    var s = { id: uid(), kind: t.bg && t.bg.type === "none" ? "lower" : "design", name: t.tier ? t.name.replace(/^[^:]+: /, "") : "", bg: t.bg ? Object.assign({}, t.bg) : { type: "theme" }, els: t.make(deck), advance: null, notes: t.notes || "" };
    if (t.countdown) s.countdown = Object.assign({}, t.countdown);
    return s;
  }
  // (10.2) what a countdown shows now: { seconds } counts from when the slide went up (t), { at: "HH:MM" } to that clock time
  function countdownLeft(cd, t, now) {
    if (!cd) return null;
    if (cd.at) { var m = /^(\d{1,2}):(\d{2})/.exec(cd.at); if (!m) return 0; var d = new Date(now || Date.now()), at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), +m[1], +m[2], 0); return Math.max(0, (at - d) / 1000); }
    return Math.max(0, (Number(cd.seconds) || 0) - (t || 0));
  }
  function clockText(sec) { sec = Math.ceil(sec); var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; return (h ? h + ":" + (m < 10 ? "0" : "") : "") + m + ":" + (s < 10 ? "0" : "") + s; }
  function fillTokens(v, slide, opts) {
    if (typeof v !== "string" || v.indexOf("{") < 0) return v;
    var cd = slide.countdown, left = countdownLeft(cd, opts.time, opts.now);
    return v.replace(/\{countdown\}/g, cd ? (left <= 0 && cd.done ? cd.done : clockText(left)) : "0:00").replace(/\{at\}/g, cd && cd.at ? cd.at : "");
  }
  // a lower third for the stream: name / title, or a scripture reference, on nothing (transparent)
  function newLower(deck, line1, line2) {
    var W = deck.size.w, H = deck.size.h;
    return { id: uid(), kind: "lower", name: "Lower third", bg: { type: "none" }, advance: null, notes: "",
      els: [
        { id: uid(), type: "shape", x: W * 0.06, y: H * 0.74, w: W * 0.5, h: H * 0.16, rot: 0, opacity: 1, shape: { kind: "round", fill: "@lowerBox", stroke: "", strokeW: 0, radius: 14 }, in: { type: "slide", dur: 0.45, delay: 0 } },
        { id: uid(), type: "shape", x: W * 0.06, y: H * 0.74, w: W * 0.008, h: H * 0.16, rot: 0, opacity: 1, shape: { kind: "rect", fill: "@lowerAccent", stroke: "", strokeW: 0, radius: 0 }, in: { type: "slide", dur: 0.45, delay: 0 } },
        { id: uid(), type: "text", x: W * 0.085, y: H * 0.752, w: W * 0.46, h: H * 0.07, rot: 0, opacity: 1, text: { value: line1 || "Name", role: "lower", font: null, size: 50, weight: 800, align: "left", valign: "middle", shadow: { blur: 0, y: 0 } }, in: { type: "slide", dur: 0.45, delay: 0.08 } },
        { id: uid(), type: "text", x: W * 0.085, y: H * 0.822, w: W * 0.46, h: H * 0.055, rot: 0, opacity: 1, text: { value: line2 || "Title", role: "sub", align: "left", valign: "middle", shadow: { blur: 0, y: 0 } }, in: { type: "slide", dur: 0.45, delay: 0.14 } }
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
      if (el.type === "text") { var tv = el.text && el.text.value, fv = fillTokens(tv, slide, opts); drawText(ctx, fv === tv ? el : Object.assign({}, el, { text: Object.assign({}, el.text, { value: fv }) }), th); }
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
    if (slide.countdown) return true;   // (10.2) a countdown ticks
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
    newDeck: newDeck, newSlide: newSlide, newLower: newLower, countdownLeft: countdownLeft, clockText: clockText, textEl: textEl, isTransparent: isTransparent, animated: animated, mediaIds: mediaIds, hit: hit, uid: uid, gradient: gradient };
})(typeof window !== "undefined" ? window : globalThis);
