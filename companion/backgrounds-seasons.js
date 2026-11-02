/* Central Control - Central Utility's seasonal lyric backgrounds (10.2): scenes for the church year and for every
 * Sunday, drawn here like the free ones (no stock photos, no downloads). Each is built from layers - a sky, the sun or
 * a glow and its rays, hills or water with depth (the near ones move more), a silhouette drawn as a vector path (a cross,
 * the empty tomb, a dove, the Advent wreath, palms, the stable, bread and cup, lilies, flames), then light in the air
 * (bokeh, snow, embers, dust), a fine film grain and a vignette. Motion loops without a seam: everything moves on
 * sines and wraps whose periods divide 120 seconds.
 *   CUSeasons.ORDER                the seasons in the year's order, with their names
 *   CUSeasons.seasonOf(date)       which season a day falls in (Advent from its first Sunday, Easter by the computus…)
 *   CUSeasons.thisSunday(date)     the coming Sunday and its season (the picker's "This Sunday" suggestion)
 *   CUSeasons.easter(year)         Easter Sunday (Western), as a Date
 * They register with CUBackgrounds (backgrounds.js) as tier "utility": every device draws them (the Central Pedal's
 * HDMI 2 too), and the pickers let a church with Central Utility choose them. */
(function (root) {
  "use strict";
  var B = root.CUBackgrounds; if (!B || !B.register || !B._kit) return;
  var K = B._kit, TAU = K.TAU, rng = K.rng, rgba = K.rgba, fill = K.fill, made = K.made, canvasOf = K.canvasOf, vignette = K.vignette;
  var LOOP = 120;   // seconds: every motion repeats exactly after this
  function per(n) { return TAU * n / LOOP; }   // an angular speed that makes n whole cycles per loop
  function wrap(v) { return v - Math.floor(v); }

  // ------------------------------------------------------------------ the church year
  function easter(y) {   // Meeus/Jones/Butcher (Gregorian)
    var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3),
      h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
      month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(y, month - 1, day);
  }
  function day0(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function add(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return day0(x); }
  function nthDow(y, m, dow, n) { var d = new Date(y, m, 1), off = (dow - d.getDay() + 7) % 7; return new Date(y, m, 1 + off + 7 * (n - 1)); }
  function adventStart(y) { var xmas = new Date(y, 11, 25), back = xmas.getDay() || 7; return add(xmas, -back - 21); }   // the 4th Sunday before Christmas
  function seasonOf(date) {
    var d = day0(date || new Date()), y = d.getFullYear(), E = easter(y), t = d.getTime();
    function on(a, b) { return t >= a.getTime() && t <= b.getTime(); }
    if (on(new Date(y, 0, 1), new Date(y, 0, 1)) || on(new Date(y, 11, 31), new Date(y, 11, 31))) return "newyear";
    if (on(add(E, -2), add(E, -2))) return "goodfriday";
    if (on(add(E, -7), add(E, -3))) return "palmsunday";
    if (on(add(E, -46), add(E, -46))) return "ashwednesday";
    if (on(add(E, -45), add(E, -8))) return "lent";
    if (on(add(E, -1), add(E, 6))) return "easter";
    if (on(add(E, 49), add(E, 55))) return "pentecost";
    if (on(nthDow(y, 4, 0, 2), nthDow(y, 4, 0, 2))) return "mothersday";
    if (on(nthDow(y, 5, 0, 3), nthDow(y, 5, 0, 3))) return "fathersday";
    if (on(adventStart(y), new Date(y, 11, 23))) return "advent";   // (before Thanksgiving: Advent Sunday can be its weekend)
    var tg = nthDow(y, 10, 4, 4); if (on(add(tg, -4), add(tg, 3))) return "thanksgiving";
    if (on(new Date(y, 11, 24), new Date(y, 11, 30)) || on(new Date(y, 0, 2), new Date(y, 0, 5))) return "christmas";
    if (on(new Date(y, 0, 6), new Date(y, 0, 12))) return "epiphany";
    return "everyday";
  }
  function thisSunday(date) { var d = day0(date || new Date()), s = add(d, (7 - d.getDay()) % 7); return { date: s, season: seasonOf(s) }; }
  var ORDER = [["advent", "Advent"], ["christmas", "Christmas"], ["epiphany", "Epiphany"], ["newyear", "New Year"], ["ashwednesday", "Ash Wednesday"], ["lent", "Lent"],
    ["palmsunday", "Palm Sunday"], ["goodfriday", "Good Friday"], ["easter", "Easter"], ["pentecost", "Pentecost"], ["communion", "Communion"], ["baptism", "Baptism"],
    ["mothersday", "Mother's Day"], ["fathersday", "Father's Day"], ["thanksgiving", "Thanksgiving"], ["everyday", "Every Sunday"]];
  var SEASON_NAME = {}; ORDER.forEach(function (o) { SEASON_NAME[o[0]] = o[1]; });

  // ------------------------------------------------------------------ layers
  function sky(g, w, h, stops) { var gr = g.createLinearGradient(0, 0, 0, h); stops.forEach(function (s, i) { gr.addColorStop(i / (stops.length - 1), s); }); g.fillStyle = gr; g.fillRect(0, 0, w, h); }
  function sun(g, w, h, x, y, c, size, a) { var r = Math.max(w, h) * size, gr = g.createRadialGradient(x * w, y * h, 0, x * w, y * h, r); gr.addColorStop(0, rgba(c, a)); gr.addColorStop(0.12, rgba(c, a * 0.75)); gr.addColorStop(0.4, rgba(c, a * 0.22)); gr.addColorStop(1, rgba(c, 0)); g.fillStyle = gr; g.fillRect(0, 0, w, h); }
  // soft beams of light from a point, turning slowly and breathing
  function rays(g, w, h, t, x, y, c, n, a, seed) {
    var rr = rng(seed || 3), cx = x * w, cy = y * h, len = Math.hypot(w, h) * 1.1;
    g.save(); g.globalCompositeOperation = "lighter";
    for (var i = 0; i < n; i++) {
      var base = (i / n) * TAU + rr() * 0.2, ang = base + 0.05 * Math.sin(t * per(1) + i * 1.7), wid = 0.03 + rr() * 0.05, al = a * (0.5 + 0.5 * Math.sin(t * per(2 + (i % 3)) + i));
      g.save(); g.translate(cx, cy); g.rotate(ang + Math.PI / 2);
      var gr = g.createLinearGradient(0, 0, 0, len); gr.addColorStop(0, rgba(c, al)); gr.addColorStop(1, rgba(c, 0));
      g.fillStyle = gr; g.beginPath(); g.moveTo(0, 0); g.lineTo(-len * wid, len); g.lineTo(len * wid, len); g.closePath(); g.fill(); g.restore();
    }
    g.restore();
  }
  // rolling hills: a ridge line made of a few sines, filled down; a depth haze over the far ones
  function hills(g, w, h, base, amp, col, seed, unused, haze) {
    var rr = rng(seed), f = [0.6 + rr(), 1.6 + rr() * 2, 4 + rr() * 3], ph = [rr() * TAU, rr() * TAU, rr() * TAU], off = 0;
    g.beginPath(); g.moveTo(0, h);
    for (var x = 0; x <= w + 8; x += Math.max(4, w / 160)) { var u = x / w * TAU; g.lineTo(x, h * base - h * amp * (0.55 * Math.sin(u * f[0] / TAU * 2 + ph[0] + off) + 0.3 * Math.sin(u * f[1] / TAU * 2 + ph[1] + off * 0.6) + 0.15 * Math.sin(u * f[2] / TAU * 2 + ph[2]))); }
    g.lineTo(w, h); g.closePath(); g.fillStyle = col; g.fill();
    if (haze) { var gr = g.createLinearGradient(0, h * (base - amp), 0, h); gr.addColorStop(0, rgba(haze, 0.35)); gr.addColorStop(1, rgba(haze, 0)); g.fillStyle = gr; g.fill(); }
  }
  // a mountain range: a ridge by midpoint displacement (rough like rock), filled with a little light on the upper slopes
  function mountains(g, w, h, base, amp, col, seed, light) {
    var rr = rng(seed), n = 256, y = new Array(n + 1); y[0] = rr(); y[n] = rr();
    for (var step = n, rough = 0.9; step > 1; step /= 2, rough *= 0.52) for (var i = step / 2; i < n; i += step) y[i] = (y[i - step / 2] + y[i + step / 2]) / 2 + (rr() - 0.5) * rough;
    var lo = Math.min.apply(null, y), hi = Math.max.apply(null, y), top = h * (base - amp);
    g.beginPath(); g.moveTo(0, h); for (var j = 0; j <= n; j++) g.lineTo(j / n * w, h * base - h * amp * (y[j] - lo) / (hi - lo || 1)); g.lineTo(w, h); g.closePath();
    g.fillStyle = col; g.fill();
    if (light) { var gr = g.createLinearGradient(0, top, 0, h * base); gr.addColorStop(0, rgba(light, 0.35)); gr.addColorStop(0.5, rgba(light, 0.08)); gr.addColorStop(1, rgba(light, 0)); g.fillStyle = gr; g.fill(); }
  }
  // water with moving highlights
  // water: a gradient, the sky's colour near the horizon, soft swell lines and a glittering path under the sun (sunX)
  function sea(g, w, h, t, top, deep, glint, y0, sunX) {
    var gr = g.createLinearGradient(0, h * y0, 0, h); gr.addColorStop(0, top); gr.addColorStop(1, deep); g.fillStyle = gr; g.fillRect(0, h * y0, w, h * (1 - y0));
    var hz = g.createLinearGradient(0, h * y0, 0, h * (y0 + 0.04)); hz.addColorStop(0, rgba(glint, 0.35)); hz.addColorStop(1, rgba(glint, 0)); g.fillStyle = hz; g.fillRect(0, h * y0, w, h * 0.04);
    g.save(); g.globalCompositeOperation = "lighter";
    var sx = (sunX == null ? 0.5 : sunX) * w, rr = rng(71);
    for (var k = 0; k < 40; k++) {
      var d = k / 40, yy = h * (y0 + (1 - y0) * Math.pow(d, 1.7)), sp = w * (0.02 + 0.16 * d), n = 3 + Math.floor(d * 5);
      for (var j = 0; j < n; j++) {   // short glints, thicker and wider apart nearer the viewer, shimmering
        var ph = rr() * TAU, off = (rr() - 0.5) * 2 * sp + Math.sin(t * per(3 + (j % 3)) + ph) * sp * 0.15, len = w * (0.004 + 0.03 * d) * (0.5 + rr()), al = (0.18 + 0.5 * (1 - Math.abs(off) / (sp + 1))) * (0.5 + 0.5 * Math.sin(t * per(7 + (j % 5)) + ph));
        g.fillStyle = rgba(glint, Math.max(0, al) * (0.35 + 0.65 * (1 - d * 0.5))); g.fillRect(sx + off - len / 2, yy, len, Math.max(1, h * (0.0015 + 0.004 * d)));
      }
      if (k % 3 === 0) { g.strokeStyle = rgba(glint, 0.025 + 0.04 * d); g.lineWidth = Math.max(1, h * 0.0015); g.beginPath(); for (var x = 0; x <= w; x += w / 48) { var y = yy + h * 0.004 * d * Math.sin(x / w * (6 + k * 0.5) + t * per(2 + (k % 3)) + k); if (x) g.lineTo(x, y); else g.moveTo(x, y); } g.stroke(); }
    }
    g.restore();
  }
  // clouds: a strip of soft noise in a colour, two screens wide, feathered top and bottom, drifting and wrapping
  function cloudStrip(w, h, y, hh, c, seed) {
    return made("cs:" + seed + c + y + hh + ":" + w + "x" + h, function () {
      var tile = K.noiseTile(seed, 96), bh = Math.max(2, Math.round(h * hh)), cv = canvasOf(w * 2, bh); if (!tile || !cv) return null; var cg = cv.getContext("2d"), th = Math.max(bh, w * 0.6);
      for (var i = 0; i < 2; i++) cg.drawImage(tile, i * w, (bh - th) / 2, w, th);
      cg.globalCompositeOperation = "source-in"; cg.fillStyle = c; cg.fillRect(0, 0, w * 2, bh);
      cg.globalCompositeOperation = "destination-in"; var gr = cg.createLinearGradient(0, 0, 0, bh);
      gr.addColorStop(0, y <= 0 ? "#000" : "rgba(0,0,0,0)"); gr.addColorStop(0.3, "#000"); gr.addColorStop(0.7, "#000"); gr.addColorStop(1, y + hh >= 1 ? "#000" : "rgba(0,0,0,0)"); cg.fillStyle = gr; cg.fillRect(0, 0, w * 2, bh);
      return cv;
    });
  }
  function cloudBand(g, w, h, t, y, hh, c, a, seed, speed) {
    var s = cloudStrip(w, h, y, hh, c, seed); if (!s) return; var ox = -wrap(t * (speed || 1) / LOOP) * w;
    g.save(); g.globalAlpha = a; g.drawImage(s, ox, h * y); g.restore();
  }
  // out-of-focus lights with a depth: big faint near ones, small bright far ones
  function bokeh(g, w, h, t, cols, n, a, seed) {
    var rr = rng(seed || 9); g.save(); g.globalCompositeOperation = "lighter";
    for (var i = 0; i < n; i++) {
      var depth = rr(), sx = rr(), sy = rr(), ph = rr() * TAU, c = cols[i % cols.length], rad = Math.max(w, h) * (0.012 + 0.07 * depth);
      var x = wrap(sx + depth * 0.04 * Math.sin(t * per(1) + ph) + t * (0.2 + depth) / LOOP * 0) * w, y = (sy + 0.03 * Math.cos(t * per(1) + ph)) * h, al = a * (0.45 + 0.55 * (1 - depth)) * (0.7 + 0.3 * Math.sin(t * per(3) + ph));
      var gr = g.createRadialGradient(x, y, rad * 0.55, x, y, rad); gr.addColorStop(0, rgba(c, al * 0.55)); gr.addColorStop(0.86, rgba(c, al)); gr.addColorStop(1, rgba(c, 0)); g.fillStyle = gr; g.beginPath(); g.arc(x, y, rad, 0, TAU); g.fill();
    }
    g.restore();
  }
  // particles: snow (falls), embers / dust (rise), petals (drift), each wrapping
  function particles(g, w, h, t, kind, cols, n, seed) {
    var rr = rng(seed || 5); g.save(); if (kind !== "snow") g.globalCompositeOperation = "lighter";
    for (var i = 0; i < n; i++) {
      var sx = rr(), sy = rr(), depth = rr(), ph = rr() * TAU, c = cols[i % cols.length], cycles = 1 + Math.floor(depth * 3), s = Math.max(w, h) * (0.0012 + 0.004 * depth);
      var y = kind === "snow" ? wrap(sy + t * cycles / LOOP) : kind === "petals" ? wrap(sy + t * cycles / LOOP) : wrap(sy - t * cycles / LOOP), x = wrap(sx + 0.02 * Math.sin(t * per(2) + ph) + (kind === "petals" ? t / LOOP : 0));
      var al = kind === "snow" ? 0.55 + 0.4 * depth : (0.4 + 0.6 * Math.max(0, Math.sin(t * per(4) + ph))) * (kind === "embers" ? 0.9 : 0.6);
      if (kind === "petals") { g.save(); g.translate(x * w, y * h); g.rotate(t * per(3) + ph); g.fillStyle = rgba(c, al); g.beginPath(); g.ellipse(0, 0, s * 3, s * 1.6, 0, 0, TAU); g.fill(); g.restore(); continue; }
      var R = kind === "snow" ? s * 1.8 : s * 3, gr = g.createRadialGradient(x * w, y * h, 0, x * w, y * h, R); gr.addColorStop(0, rgba(c, al)); gr.addColorStop(kind === "snow" ? 0.5 : 0.2, rgba(c, al * 0.6)); gr.addColorStop(1, rgba(c, 0)); g.fillStyle = gr; g.fillRect(x * w - R, y * h - R, R * 2, R * 2);
    }
    g.restore();
  }
  // fine film grain (a cached tile, shifted each frame) - takes the "computer gradient" look away
  function grainOver(g, w, h, t, amt) {
    var tile = made("sgrain", function () { var n = 160, c = canvasOf(n, n); if (!c) return null; var cg = c.getContext("2d"), img = cg.createImageData(n, n), rr = rng(77); for (var i = 0; i < n * n; i++) { var v = rr() < 0.5 ? 0 : 255; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = Math.round(rr() * 38); } cg.putImageData(img, 0, 0); return c; });
    if (!tile) return; var k = Math.floor(t * 24) % 8; g.save(); g.globalAlpha = amt; g.translate(-(k * 37) % 160, -(k * 61) % 160); g.fillStyle = g.createPattern(tile, "repeat"); g.fillRect(0, 0, w + 160, h + 160); g.restore();
  }

  // ------------------------------------------------------------------ silhouettes (vector paths)
  function cross(g, x, y, hh, c, glow) {
    var bw = hh * 0.075, arm = hh * 0.62, top = y - hh;
    if (glow) { var gr = g.createRadialGradient(x, top + hh * 0.3, 0, x, top + hh * 0.3, hh * 0.9); gr.addColorStop(0, rgba(glow, 0.5)); gr.addColorStop(1, rgba(glow, 0)); g.fillStyle = gr; g.fillRect(x - hh, top - hh * 0.6, hh * 2, hh * 1.8); }
    g.fillStyle = c; g.fillRect(x - bw / 2, top, bw, hh); g.fillRect(x - arm / 2, top + hh * 0.24, arm, bw);
  }
  function threeCrosses(g, x, y, hh, c) { cross(g, x - hh * 0.75, y + hh * 0.06, hh * 0.72, c); cross(g, x + hh * 0.75, y + hh * 0.06, hh * 0.72, c); cross(g, x, y, hh, c); }
  // the garden tomb: a rocky hillside cut with a doorway (light pouring out), the round stone rolled aside, lit from the sun's side
  function tomb(g, x, y, s, rock, dark, light, rim) {
    var rr = rng(17);
    g.fillStyle = rock; g.beginPath(); g.moveTo(x - s * 3.2, y + s * 0.05);
    var pts = [[-2.6, -0.7], [-1.9, -1.15], [-1.1, -1.5], [-0.3, -1.62], [0.5, -1.5], [1.3, -1.2], [2.1, -0.75], [2.9, -0.3], [3.4, 0.05]];
    pts.forEach(function (p) { g.lineTo(x + p[0] * s + (rr() - 0.5) * s * 0.15, y + p[1] * s + (rr() - 0.5) * s * 0.1); }); g.lineTo(x + s * 3.4, y + s * 0.4); g.lineTo(x - s * 3.2, y + s * 0.4); g.closePath(); g.fill();
    g.save(); g.clip();
    if (rim) { var rg = g.createLinearGradient(x + s * 3, y - s * 1.6, x - s * 1, y); rg.addColorStop(0, rgba(rim, 0.35)); rg.addColorStop(1, rgba(rim, 0)); g.fillStyle = rg; g.fillRect(x - s * 3.3, y - s * 1.8, s * 6.8, s * 2.3); }
    // ledges in the rock (inside it)
    g.strokeStyle = rgba("#000000", 0.22); g.lineWidth = s * 0.03; [[-2.2, -0.45, -1.0], [-1.5, -0.95, -0.5], [1.0, -0.8, 1.9]].forEach(function (l) { g.beginPath(); g.moveTo(x + l[0] * s, y + l[1] * s); g.quadraticCurveTo(x + (l[0] + l[2]) / 2 * s, y + (l[1] - 0.06) * s, x + l[2] * s, y + (l[1] + 0.05) * s); g.stroke(); });
    g.restore();
    // the doorway, with light inside
    var dx = x - s * 0.35, dw = s * 0.42, dh = s * 0.85;
    g.fillStyle = dark; g.beginPath(); g.moveTo(dx - dw, y); g.lineTo(dx - dw, y - dh * 0.55); g.quadraticCurveTo(dx - dw, y - dh, dx, y - dh); g.quadraticCurveTo(dx + dw, y - dh, dx + dw, y - dh * 0.55); g.lineTo(dx + dw, y); g.closePath(); g.fill();
    if (light) { g.save(); g.clip(); var gr = g.createRadialGradient(dx, y - dh * 0.3, 0, dx, y - dh * 0.3, dh); gr.addColorStop(0, rgba(light, 0.95)); gr.addColorStop(0.5, rgba(light, 0.4)); gr.addColorStop(1, rgba(light, 0)); g.fillStyle = gr; g.fillRect(dx - dw, y - dh, dw * 2, dh); g.restore();
      g.save(); g.globalCompositeOperation = "lighter"; g.translate(dx, y + s * 0.04); g.scale(1, 0.18); var sp = g.createRadialGradient(0, 0, 0, 0, 0, s * 1.3); sp.addColorStop(0, rgba(light, 0.22)); sp.addColorStop(1, rgba(light, 0)); g.fillStyle = sp; g.fillRect(-s * 1.3, -s * 1.3, s * 2.6, s * 2.6); g.restore(); }
    // the stone, rolled away to the right
    var sx = dx + dw + s * 0.62, sy = y - s * 0.55, sr = s * 0.56;
    var sg = g.createLinearGradient(sx + sr, sy - sr, sx - sr, sy + sr); sg.addColorStop(0, rim ? rgba(rim, 0.28) : rock); sg.addColorStop(0.3, rock); sg.addColorStop(1, dark);
    g.fillStyle = sg; g.beginPath(); g.arc(sx, sy, sr, 0, TAU); g.fill(); g.strokeStyle = rgba("#000000", 0.3); g.lineWidth = s * 0.035; g.beginPath(); g.arc(sx, sy, sr * 0.68, 0, TAU); g.stroke();
  }
  // a camel and its rider (the magi), facing right
  function camel(g, x, y, k, c) {
    g.fillStyle = c; g.strokeStyle = c; g.lineCap = "round";
    g.beginPath(); g.ellipse(x, y - k * 1.15, k * 0.85, k * 0.38, 0, 0, TAU); g.fill();                   // body
    g.beginPath(); g.ellipse(x - k * 0.05, y - k * 1.45, k * 0.42, k * 0.3, 0, Math.PI, TAU); g.fill();  // hump
    g.lineWidth = k * 0.13; [[-0.6, -0.1], [-0.4, 0.05], [0.45, -0.05], [0.65, 0.1]].forEach(function (l) { g.beginPath(); g.moveTo(x + l[0] * k, y - k * 1.0); g.lineTo(x + (l[0] + l[1]) * k, y); g.stroke(); });   // legs
    g.lineWidth = k * 0.2; g.beginPath(); g.moveTo(x + k * 0.7, y - k * 1.2); g.quadraticCurveTo(x + k * 1.25, y - k * 1.1, x + k * 1.2, y - k * 1.85); g.stroke();   // neck
    g.beginPath(); g.ellipse(x + k * 1.32, y - k * 1.9, k * 0.24, k * 0.11, 0.2, 0, TAU); g.fill();     // head
    g.lineWidth = k * 0.05; g.beginPath(); g.moveTo(x - k * 0.82, y - k * 1.2); g.quadraticCurveTo(x - k * 1.0, y - k * 0.9, x - k * 0.95, y - k * 0.7); g.stroke();   // tail
    g.beginPath(); g.moveTo(x - k * 0.3, y - k * 1.5); g.lineTo(x - k * 0.15, y - k * 2.35); g.lineTo(x + k * 0.15, y - k * 2.35); g.lineTo(x + k * 0.3, y - k * 1.5); g.closePath(); g.fill();   // rider's robe
    g.beginPath(); g.arc(x, y - k * 2.5, k * 0.15, 0, TAU); g.fill(); g.beginPath(); g.moveTo(x - k * 0.13, y - k * 2.55); g.lineTo(x, y - k * 2.82); g.lineTo(x + k * 0.13, y - k * 2.55); g.closePath(); g.fill();   // head, crown
  }
  // the descending dove: head down, wings spread up and out, a fanned tail; flap 0..1 lifts the wing tips
  function dove(g, x, y, s, c, flap, glow) {
    var f = flap || 0;
    if (glow) { var gl = g.createRadialGradient(x, y, 0, x, y, s * 1.6); gl.addColorStop(0, rgba(glow, 0.45)); gl.addColorStop(1, rgba(glow, 0)); g.fillStyle = gl; g.fillRect(x - s * 1.6, y - s * 1.6, s * 3.2, s * 3.2); }
    g.fillStyle = c;
    [-1, 1].forEach(function (sd) {   // a wing: leading edge up to the tip, then a scalloped trailing edge of feathers back to the body
      var tipX = x + sd * s * 1.15, tipY = y - s * (0.75 + 0.2 * f);
      g.beginPath(); g.moveTo(x + sd * s * 0.1, y - s * 0.12);
      g.bezierCurveTo(x + sd * s * 0.35, y - s * 0.55, x + sd * s * 0.8, y - s * (0.85 + 0.15 * f), tipX, tipY);
      var n = 6; for (var i = 1; i <= n; i++) { var k = i / n, px = tipX + (x + sd * s * 0.12 - tipX) * k, py = tipY + (y + s * 0.18 - tipY) * Math.pow(k, 0.8), qx = px + sd * s * 0.06 - (x + sd * s * 0.12 - tipX) / n * 0.5, qy = py + s * 0.12; g.quadraticCurveTo(qx, qy, px, py); }
      g.closePath(); g.fill();
    });
    g.beginPath(); g.ellipse(x, y + s * 0.05, s * 0.15, s * 0.38, 0, 0, TAU); g.fill();   // body
    g.beginPath(); g.arc(x, y + s * 0.48, s * 0.12, 0, TAU); g.fill();                     // head
    g.beginPath(); g.moveTo(x - s * 0.035, y + s * 0.58); g.lineTo(x, y + s * 0.68); g.lineTo(x + s * 0.035, y + s * 0.58); g.closePath(); g.fill();   // beak
    g.beginPath(); g.moveTo(x - s * 0.08, y - s * 0.25); for (var j = 0; j <= 5; j++) { var a = Math.PI * (1.25 + j * 0.1), r = s * 0.52; g.quadraticCurveTo(x + Math.cos(a - 0.05) * r * 0.9, y + Math.sin(a - 0.05) * r * 0.95 - s * 0.05, x + Math.cos(a) * r, y + Math.sin(a) * r - s * 0.02); } g.lineTo(x + s * 0.08, y - s * 0.25); g.closePath(); g.fill();   // tail fan
  }
  function flame(g, x, y, s, t, ph, c1, c2) {
    var k = Math.sin(t * per(17) + ph) * 0.12 + Math.sin(t * per(29) + ph * 2) * 0.06;
    var gr = g.createLinearGradient(x, y, x, y - s * 2.2); gr.addColorStop(0, rgba(c1, 0.95)); gr.addColorStop(0.6, rgba(c2, 0.85)); gr.addColorStop(1, rgba(c2, 0));
    g.fillStyle = gr; g.beginPath(); g.moveTo(x - s * 0.4, y); g.bezierCurveTo(x - s * 0.55, y - s * 0.9, x + s * k * 3, y - s * 1.4, x + s * k * 4, y - s * 2.3); g.bezierCurveTo(x + s * 0.2 + s * k * 2, y - s * 1.3, x + s * 0.6, y - s * 0.8, x + s * 0.4, y); g.closePath(); g.fill();
    var gl = g.createRadialGradient(x, y - s * 0.7, 0, x, y - s * 0.7, s * 3); gl.addColorStop(0, rgba(c2, 0.22)); gl.addColorStop(1, rgba(c2, 0)); g.fillStyle = gl; g.fillRect(x - s * 3, y - s * 3.7, s * 6, s * 6);
  }
  function candle(g, x, y, s, wax, lit, t, ph) {
    var gr = g.createLinearGradient(x - s * 0.3, 0, x + s * 0.3, 0); gr.addColorStop(0, rgba(wax, 0.75)); gr.addColorStop(0.5, rgba(wax, 1)); gr.addColorStop(1, rgba(wax, 0.6));
    g.fillStyle = gr; g.fillRect(x - s * 0.3, y - s * 2.2, s * 0.6, s * 2.2);
    if (lit) { g.save(); g.globalCompositeOperation = "lighter"; flame(g, x, y - s * 2.2, s * 0.32, t, ph, "#fff3c4", "#ff9a2e"); g.restore(); }
  }
  function wreath(g, x, y, s, t, lit) {
    var rr = rng(41); g.save();
    for (var i = 0; i < 160; i++) { var a = rr() * TAU, rad = s * (1.6 + rr() * 0.35), px = x + Math.cos(a) * rad, py = y + Math.sin(a) * rad * 0.32; g.fillStyle = rgba(["#1f4d2b", "#2d6b3a", "#173b22"][i % 3], 0.95); g.beginPath(); g.ellipse(px, py, s * 0.16, s * 0.06, a, 0, TAU); g.fill(); }
    for (var b = 0; b < 12; b++) { var ab = b / 12 * TAU, bx = x + Math.cos(ab) * s * 1.75, by = y + Math.sin(ab) * s * 0.56; g.fillStyle = "#a3172d"; g.beginPath(); g.arc(bx, by, s * 0.06, 0, TAU); g.fill(); }
    var cols = ["#5b2a86", "#5b2a86", "#d47fb0", "#5b2a86"], pos = [[-1.15, -0.05], [1.15, -0.05], [-0.45, 0.32], [0.55, 0.3]];
    pos.slice().sort(function (p, q) { return p[1] - q[1]; }).forEach(function (p) { var i = pos.indexOf(p); candle(g, x + p[0] * s, y + p[1] * s, s * 0.32, cols[i], i < lit, t, i * 1.3); });
    candle(g, x, y + s * 0.05, s * 0.36, "#f4f1ea", lit >= 5, t, 9);
    g.restore();
  }
  // a cut palm frond: a curving rib with long thin leaflets swept toward the tip and drooping, each a filled sliver
  function palm(g, x, y, s, c, lean, blur) {
    g.save(); g.translate(x, y); g.rotate(lean || 0); if (blur && "filter" in g) g.filter = "blur(" + Math.round(blur) + "px)";
    function rib(k) { return [s * 0.22 * Math.sin(k * 1.4) * k, -s * 1.35 * k]; }
    g.fillStyle = c; g.strokeStyle = c; g.lineCap = "round"; g.lineWidth = s * 0.018;
    g.beginPath(); for (var a = 0; a <= 1.0001; a += 0.05) { var p = rib(a); if (a) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); } g.stroke();
    var n = 34;
    for (var i = 2; i < n; i++) {
      var k = i / n, p0 = rib(k), p1 = rib(k + 0.02), dx = p1[0] - p0[0], dy = p1[1] - p0[1], dl = Math.hypot(dx, dy) || 1, ux = dx / dl, uy = dy / dl, len = s * (0.55 - 0.42 * k) * (0.85 + 0.15 * Math.sin(i * 2.3));
      [-1, 1].forEach(function (sd) {
        var nx = -uy * sd, ny = ux * sd, sweep = 0.55, ex = p0[0] + (nx * Math.cos(sweep) + ux * Math.sin(sweep)) * len, ey = p0[1] + (ny * Math.cos(sweep) + uy * Math.sin(sweep)) * len + len * 0.28, wd = s * 0.016 * (1 - k * 0.5);
        g.beginPath(); g.moveTo(p0[0] + ux * wd, p0[1] + uy * wd); g.quadraticCurveTo(p0[0] + nx * len * 0.55 + ux * len * 0.3, p0[1] + ny * len * 0.55 + uy * len * 0.3 - len * 0.04, ex, ey);
        g.quadraticCurveTo(p0[0] + nx * len * 0.5 + ux * len * 0.22, p0[1] + ny * len * 0.5 + uy * len * 0.22 + wd * 2, p0[0] - ux * wd, p0[1] - uy * wd); g.closePath(); g.fill();
      });
    }
    g.restore();
  }
  // the frond drawn once into its own canvas, then placed (and swayed) each frame - cheap enough for the Pi
  function frond(g, x, y, s, c, lean, blur) {
    var S2 = Math.round(s), sp = made("frond:" + c + S2 + ":" + (blur || 0), function () { var cv = canvasOf(Math.round(S2 * 1.6), Math.round(S2 * 1.6)); if (cv) palm(cv.getContext("2d"), S2 * 0.8, S2 * 1.5, S2, c, 0, blur); return cv; });
    if (!sp) return; g.save(); g.translate(x, y); g.rotate(lean || 0); g.drawImage(sp, -S2 * 0.8, -S2 * 1.5); g.restore();
  }
  function stable(g, x, y, s, c, warm) {
    if (warm) { var gr = g.createRadialGradient(x, y - s * 0.4, 0, x, y - s * 0.4, s * 1.6); gr.addColorStop(0, rgba(warm, 0.55)); gr.addColorStop(1, rgba(warm, 0)); g.fillStyle = gr; g.fillRect(x - s * 2, y - s * 2, s * 4, s * 2.4); }
    g.fillStyle = c;
    g.beginPath(); g.moveTo(x - s * 1.25, y - s * 0.95); g.lineTo(x, y - s * 1.55); g.lineTo(x + s * 1.25, y - s * 0.95); g.lineTo(x + s * 1.18, y - s * 0.86); g.lineTo(x, y - s * 1.42); g.lineTo(x - s * 1.18, y - s * 0.86); g.closePath(); g.fill();
    g.fillRect(x - s * 1.1, y - s * 0.92, s * 0.08, s * 0.92); g.fillRect(x + s * 1.02, y - s * 0.92, s * 0.08, s * 0.92);
    // Joseph (standing, with a staff), Mary (kneeling), the manger
    g.beginPath(); g.ellipse(x + s * 0.55, y - s * 0.92, s * 0.09, s * 0.1, 0, 0, TAU); g.fill(); g.beginPath(); g.moveTo(x + s * 0.4, y); g.lineTo(x + s * 0.45, y - s * 0.8); g.quadraticCurveTo(x + s * 0.55, y - s * 0.88, x + s * 0.66, y - s * 0.8); g.lineTo(x + s * 0.72, y); g.closePath(); g.fill();
    g.fillRect(x + s * 0.8, y - s * 1.05, s * 0.025, s * 1.05);
    g.beginPath(); g.ellipse(x - s * 0.5, y - s * 0.6, s * 0.085, s * 0.095, 0, 0, TAU); g.fill(); g.beginPath(); g.moveTo(x - s * 0.72, y); g.quadraticCurveTo(x - s * 0.65, y - s * 0.5, x - s * 0.5, y - s * 0.52); g.quadraticCurveTo(x - s * 0.36, y - s * 0.45, x - s * 0.28, y); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(x - s * 0.18, y - s * 0.3); g.lineTo(x + s * 0.22, y - s * 0.3); g.lineTo(x + s * 0.14, y - s * 0.12); g.lineTo(x - s * 0.1, y - s * 0.12); g.closePath(); g.fill(); g.fillRect(x - s * 0.09, y - s * 0.12, s * 0.03, s * 0.12); g.fillRect(x + s * 0.1, y - s * 0.12, s * 0.03, s * 0.12);
    if (warm) { g.save(); g.globalCompositeOperation = "lighter"; var hg = g.createRadialGradient(x + s * 0.02, y - s * 0.36, 0, x + s * 0.02, y - s * 0.36, s * 0.35); hg.addColorStop(0, rgba("#fff1c2", 0.9)); hg.addColorStop(1, rgba("#fff1c2", 0)); g.fillStyle = hg; g.fillRect(x - s * 0.4, y - s * 0.75, s * 0.8, s * 0.8); g.restore(); }
  }
  function star(g, x, y, s, t, c) {
    g.save(); g.globalCompositeOperation = "lighter"; var tw = 0.85 + 0.15 * Math.sin(t * per(6));
    var gr = g.createRadialGradient(x, y, 0, x, y, s * 6); gr.addColorStop(0, rgba(c, 0.6 * tw)); gr.addColorStop(1, rgba(c, 0)); g.fillStyle = gr; g.fillRect(x - s * 6, y - s * 6, s * 12, s * 12);
    g.fillStyle = rgba("#ffffff", 0.95); [[0, 1], [Math.PI / 2, 1], [Math.PI / 4, 0.45], [-Math.PI / 4, 0.45]].forEach(function (a) { g.save(); g.translate(x, y); g.rotate(a[0]); g.beginPath(); g.moveTo(0, -s * 4 * a[1] * tw); g.lineTo(s * 0.18, 0); g.lineTo(0, s * 4 * a[1] * tw * (a[0] === 0 ? 1.8 : 1)); g.lineTo(-s * 0.18, 0); g.closePath(); g.fill(); g.restore(); });
    g.restore();
  }
  function chalice(g, x, y, s, c, rim) {
    g.fillStyle = c; g.beginPath(); g.moveTo(x - s * 0.55, y - s * 1.6); g.quadraticCurveTo(x - s * 0.5, y - s * 0.85, x - s * 0.07, y - s * 0.75); g.lineTo(x - s * 0.06, y - s * 0.2); g.quadraticCurveTo(x - s * 0.45, y - s * 0.12, x - s * 0.5, y); g.lineTo(x + s * 0.5, y); g.quadraticCurveTo(x + s * 0.45, y - s * 0.12, x + s * 0.06, y - s * 0.2); g.lineTo(x + s * 0.07, y - s * 0.75); g.quadraticCurveTo(x + s * 0.5, y - s * 0.85, x + s * 0.55, y - s * 1.6); g.closePath(); g.fill();
    if (rim) { g.strokeStyle = rgba(rim, 0.7); g.lineWidth = s * 0.03; g.beginPath(); g.moveTo(x - s * 0.55, y - s * 1.6); g.lineTo(x + s * 0.55, y - s * 1.6); g.stroke(); }
  }
  function loaf(g, x, y, s, c, line) {
    g.fillStyle = c; g.beginPath(); g.ellipse(x, y - s * 0.32, s * 0.95, s * 0.36, 0, Math.PI, TAU); g.lineTo(x + s * 0.95, y); g.lineTo(x - s * 0.95, y); g.closePath(); g.fill();
    if (line) { g.strokeStyle = rgba(line, 0.5); g.lineWidth = s * 0.04; for (var i = -1; i <= 1; i++) { g.beginPath(); g.moveTo(x + i * s * 0.4 - s * 0.12, y - s * 0.55); g.quadraticCurveTo(x + i * s * 0.4, y - s * 0.4, x + i * s * 0.4 + s * 0.12, y - s * 0.5); g.stroke(); } }
  }
  function lily(g, x, y, s, c, stem, t, ph) {
    var sway = 0.05 * Math.sin(t * per(2) + ph); g.save(); g.translate(x, y); g.rotate(sway);
    g.strokeStyle = stem; g.lineWidth = s * 0.05; g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(s * 0.1, -s * 1.2, s * 0.05, -s * 2.2); g.stroke();
    g.fillStyle = stem; g.beginPath(); g.ellipse(-s * 0.25, -s * 0.9, s * 0.45, s * 0.1, -0.7, 0, TAU); g.fill();
    g.translate(s * 0.05, -s * 2.2); for (var i = 0; i < 6; i++) { g.save(); g.rotate(-Math.PI / 2 + (i - 2.5) * 0.32); var gr = g.createLinearGradient(0, 0, s * 0.85, 0); gr.addColorStop(0, rgba("#dfe8c8", 0.95)); gr.addColorStop(0.35, rgba(c, 1)); gr.addColorStop(1, rgba(c, 0.9)); g.fillStyle = gr; g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(s * 0.4, -s * 0.2, s * 0.85, -s * 0.05 * (i % 2 ? 1 : -1)); g.quadraticCurveTo(s * 0.4, s * 0.16, 0, 0); g.fill(); g.restore(); }
    g.restore();
  }
  function stainedGlass(g, w, h, t, cols, seed) {
    // leaded glass: cells around scattered points, each pane brighter in its middle with a streaky texture, dark lead between
    var c = made("glass" + seed + ":" + w + "x" + h, function () {
      var cw = Math.min(w, 720), ch = Math.round(h * cw / w), cv = canvasOf(cw, ch); if (!cv) return null; var cg = cv.getContext("2d"), rr = rng(seed), pts = [];
      for (var i = 0; i < 64; i++) { var col = K.rgb(cols[i % cols.length]); pts.push([rr() * cw, rr() * ch, col, 0.8 + rr() * 0.4]); }
      var img = cg.createImageData(cw, ch), D = img.data, lead = Math.max(1.5, cw / 300);
      for (var y = 0; y < ch; y++) for (var x = 0; x < cw; x++) {
        var best = 1e18, b2 = 1e18, bp = null; for (var j = 0; j < pts.length; j++) { var p = pts[j], d = (p[0] - x) * (p[0] - x) + (p[1] - y) * (p[1] - y); if (d < best) { b2 = best; best = d; bp = p; } else if (d < b2) b2 = d; }
        var edge = Math.sqrt(b2) - Math.sqrt(best), k = (y * cw + x) * 4;
        if (edge < lead) { var lv = 10 + 14 * Math.max(0, 1 - edge / lead); D[k] = lv; D[k + 1] = lv; D[k + 2] = lv + 3; }
        else { var mid = Math.min(1, edge / (cw * 0.06)), streak = 0.9 + 0.1 * Math.sin(x * 0.11 + y * 0.03 + bp[0]) + 0.06 * Math.sin(y * 0.37 + x * 0.05), m = (0.55 + 0.6 * mid) * streak * bp[3];
          D[k] = Math.min(255, bp[2][0] * m); D[k + 1] = Math.min(255, bp[2][1] * m); D[k + 2] = Math.min(255, bp[2][2] * m); }
        D[k + 3] = 255;
      }
      cg.putImageData(img, 0, 0); return cv;
    });
    if (c) g.drawImage(c, 0, 0, w, h);
    g.save(); g.globalCompositeOperation = "multiply"; var gr = g.createRadialGradient(w * (0.5 + 0.15 * Math.sin(t * per(1))), h * 0.3, 0, w / 2, h / 2, Math.hypot(w, h) * 0.65); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(1, "rgba(60,50,70,1)"); g.fillStyle = gr; g.fillRect(0, 0, w, h); g.restore();
  }
  // a static layer (silhouettes, ridges) drawn once per size
  function once(key, w, h, fn) { var c = made("s:" + key + ":" + w + "x" + h, function () { var cv = canvasOf(w, h); if (cv) fn(cv.getContext("2d"), w, h); return cv; }); return c; }
  function finish(g, w, h, t, v, gr) { vignette(g, w, h, v == null ? 0.55 : v); grainOver(g, w, h, t, gr == null ? 0.6 : gr); }

  // ------------------------------------------------------------------ the scenes
  var SC = {
    // Advent: the wreath, one more candle each week
    adventWreath: function (lit, sky1, sky2, bk) { return function (g, w, h, t) { sky(g, w, h, [sky1, sky2, "#05040a"]); sun(g, w, h, 0.5, 0.62, "#ffb860", 0.2 + 0.08 * lit, 0.1 * lit); bokeh(g, w, h, t, bk, 14 + lit * 6, 0.12 + 0.03 * lit, 11 + lit); var s = Math.min(w, h) * 0.2; wreath(g, w * 0.5, h * 0.72, s, t, lit); particles(g, w, h, t, "dust", ["#ffe2a8"], 40, 3); finish(g, w, h, t, 0.65); }; },
    adventNight: function (g, w, h, t) { sky(g, w, h, ["#0a0924", "#22164a", "#3e2460"]); K.stars(g, w, h, t, 13, 180, 0.85); sun(g, w, h, 0.62, 0.8, "#8a5bd1", 0.4, 0.35); var s = Math.min(w, h); var L = once("adv-hills", w, h, function (cg) { hills(cg, w, h, 0.8, 0.07, "#1c1232", 4, 0, "#6a4a9a"); var x = w * 0.62, y = h * 0.8, k = s * 0.12; cg.fillStyle = "#0c0818"; cg.fillRect(x - k, y - k * 0.8, k * 1.6, k * 0.8); cg.beginPath(); cg.moveTo(x - k * 1.1, y - k * 0.8); cg.lineTo(x - k * 0.2, y - k * 1.3); cg.lineTo(x + k * 0.7, y - k * 0.8); cg.closePath(); cg.fill(); cg.fillRect(x + k * 0.55, y - k * 1.6, k * 0.4, k * 1.6); cg.beginPath(); cg.moveTo(x + k * 0.5, y - k * 1.6); cg.lineTo(x + k * 0.75, y - k * 2.4); cg.lineTo(x + k * 1.0, y - k * 1.6); cg.closePath(); cg.fill(); cg.fillRect(x + k * 0.735, y - k * 2.7, k * 0.03, k * 0.32); cg.fillRect(x + k * 0.68, y - k * 2.6, k * 0.14, k * 0.03); hills(cg, w, h, 0.9, 0.05, "#08061a", 6); }); g.drawImage(L, 0, 0); var x = w * 0.62, y = h * 0.8, k = s * 0.12; [-0.75, -0.45, -0.15].forEach(function (p, i) { var fl = 0.8 + 0.2 * Math.sin(t * per(7) + i * 2); g.fillStyle = rgba("#ffcf7a", 0.85 * fl); g.fillRect(x + p * k, y - k * 0.55, k * 0.13, k * 0.28); }); g.save(); g.globalCompositeOperation = "lighter"; var gl = g.createRadialGradient(x - k * 0.4, y - k * 0.4, 0, x - k * 0.4, y - k * 0.4, k * 1.5); gl.addColorStop(0, rgba("#ffb860", 0.3)); gl.addColorStop(1, rgba("#ffb860", 0)); g.fillStyle = gl; g.fillRect(x - k * 2, y - k * 2, k * 4, k * 3); g.restore(); particles(g, w, h, t, "snow", ["#e8e0ff"], 50, 14); finish(g, w, h, t, 0.6); },
    // Christmas
    bethlehemStar: function (g, w, h, t) { sky(g, w, h, ["#060b24", "#122454", "#2a2f6a"]); K.stars(g, w, h, t, 17, 220, 0.9); var s = Math.min(w, h); rays(g, w, h, t, 0.62, 0.2, "#dfe8ff", 9, 0.07, 4); star(g, w * 0.62, h * 0.2, s * 0.012, t, "#cfe0ff"); var L = once("beth", w, h, function (cg) { hills(cg, w, h, 0.8, 0.08, "#0d1430", 7, 0, "#3a4a8a"); hills(cg, w, h, 0.9, 0.05, "#070a1a", 8); cg.fillStyle = "#070a1a"; [[0.18, 0.06], [0.24, 0.09], [0.31, 0.05]].forEach(function (b) { cg.fillRect(w * b[0], h * (0.82 - b[1]), w * 0.04, h * b[1]); cg.beginPath(); cg.arc(w * (b[0] + 0.02), h * (0.82 - b[1]), w * 0.02, Math.PI, TAU); cg.fill(); }); }); g.drawImage(L, 0, 0); finish(g, w, h, t, 0.5); },
    nativity: function (g, w, h, t) { sky(g, w, h, ["#050a1f", "#13224a", "#2b3d6e"]); K.stars(g, w, h, t, 19, 160, 0.8); var s = Math.min(w, h); star(g, w * 0.5, h * 0.14, s * 0.011, t, "#fff2c8"); rays(g, w, h, t, 0.5, 0.14, "#fff2c8", 7, 0.05, 5); var L = once("nat", w, h, function (cg) { hills(cg, w, h, 0.86, 0.04, "#080b18", 9); stable(cg, w * 0.5, h * 0.86, s * 0.26, "#05060d", "#ffb35a"); }); g.drawImage(L, 0, 0); particles(g, w, h, t, "dust", ["#fff2c8", "#cfe0ff"], 50, 19); finish(g, w, h, t, 0.55); },
    snowyWindow: function (g, w, h, t) { sky(g, w, h, ["#0e1a33", "#1d2f52", "#0a1222"]); var L = once("snowwin", w, h, function (cg) { hills(cg, w, h, 0.86, 0.04, "#d9e3f2", 10, 0, "#9fb5d6"); var x = w * 0.62, y = h * 0.86, s = Math.min(w, h) * 0.22; cg.fillStyle = "#101a2c"; cg.fillRect(x - s, y - s * 0.9, s * 2, s * 0.9); cg.beginPath(); cg.moveTo(x - s * 1.15, y - s * 0.9); cg.lineTo(x, y - s * 1.55); cg.lineTo(x + s * 1.15, y - s * 0.9); cg.closePath(); cg.fill(); cg.fillStyle = "#e9eef6"; cg.beginPath(); cg.moveTo(x - s * 1.18, y - s * 0.9); cg.lineTo(x, y - s * 1.6); cg.lineTo(x + s * 1.18, y - s * 0.9); cg.lineTo(x + s * 1.05, y - s * 0.92); cg.lineTo(x, y - s * 1.45); cg.lineTo(x - s * 1.05, y - s * 0.92); cg.closePath(); cg.fill(); cg.fillRect(x - s * 0.2, y - s * 1.45, s * 0.12, s * 0.35); }); g.drawImage(L, 0, 0); var x = w * 0.62, y = h * 0.86, s = Math.min(w, h) * 0.22; [[-0.6, -0.55], [0.3, -0.55]].forEach(function (p, i) { var fl = 0.85 + 0.15 * Math.sin(t * per(9) + i); var gr = g.createRadialGradient(x + p[0] * s + s * 0.15, y + p[1] * s + s * 0.15, 0, x + p[0] * s + s * 0.15, y + p[1] * s + s * 0.15, s * 0.7); gr.addColorStop(0, rgba("#ffc46b", 0.5 * fl)); gr.addColorStop(1, rgba("#ffc46b", 0)); g.fillStyle = gr; g.fillRect(x + p[0] * s - s * 0.5, y + p[1] * s - s * 0.5, s * 1.3, s * 1.3); g.fillStyle = rgba("#ffd27a", 0.9 * fl); g.fillRect(x + p[0] * s, y + p[1] * s, s * 0.3, s * 0.3); g.fillStyle = "#101a2c"; g.fillRect(x + p[0] * s + s * 0.14, y + p[1] * s, s * 0.02, s * 0.3); g.fillRect(x + p[0] * s, y + p[1] * s + s * 0.14, s * 0.3, s * 0.02); }); particles(g, w, h, t, "snow", ["#ffffff", "#dfe9ff"], 160, 21); finish(g, w, h, t, 0.45); },
    goldRed: function (g, w, h, t) { sky(g, w, h, ["#2a0508", "#5a0c14", "#1a0306"]); bokeh(g, w, h, t, ["#ffcf6a", "#ff9a3a", "#ffe9b0", "#e2333f"], 34, 0.26, 23); particles(g, w, h, t, "dust", ["#ffe2a0"], 50, 7); finish(g, w, h, t, 0.6); },
    christmasTree: function (g, w, h, t) { sky(g, w, h, ["#04120c", "#0a2a1b", "#020805"]); var s = Math.min(w, h), x = w * 0.5; var L = once("tree", w, h, function (cg) { cg.fillStyle = "#03100a"; for (var i = 0; i < 4; i++) { var y0 = h * (0.25 + i * 0.16), ww = s * (0.12 + i * 0.09); cg.beginPath(); cg.moveTo(x, y0 - h * 0.08); cg.lineTo(x + ww, y0 + h * 0.13); cg.lineTo(x - ww, y0 + h * 0.13); cg.closePath(); cg.fill(); } cg.fillRect(x - s * 0.03, h * 0.86, s * 0.06, h * 0.08); }); g.drawImage(L, 0, 0); var rr = rng(31); g.save(); g.globalCompositeOperation = "lighter"; for (var i = 0; i < 60; i++) { var k = rr(), y = h * (0.2 + k * 0.66), half = s * (0.03 + k * 0.38) * (0.2 + 0.8 * rr()) * (rr() < 0.5 ? -1 : 1), c = ["#ffd27a", "#ff6b6b", "#7ad8ff", "#fff3c4"][i % 4], al = 0.5 + 0.5 * Math.sin(t * per(5 + (i % 4)) + i); var gr = g.createRadialGradient(x + half, y, 0, x + half, y, s * 0.02); gr.addColorStop(0, rgba(c, al)); gr.addColorStop(1, rgba(c, 0)); g.fillStyle = gr; g.fillRect(x + half - s * 0.02, y - s * 0.02, s * 0.04, s * 0.04); } g.restore(); star(g, x, h * 0.17, s * 0.008, t, "#fff1c2"); finish(g, w, h, t, 0.6); },
    // Epiphany
    epiphanyStar: function (g, w, h, t) { sky(g, w, h, ["#0a0a26", "#2b1f52", "#a0623a"]); K.stars(g, w, h, t, 29, 120, 0.7); var s = Math.min(w, h); star(g, w * 0.7, h * 0.18, s * 0.012, t, "#ffe6b0"); rays(g, w, h, t, 0.7, 0.18, "#ffe6b0", 8, 0.05, 7); var L = once("epi", w, h, function (cg) { hills(cg, w, h, 0.8, 0.05, "#3a2228", 11, 0, "#a0623a"); hills(cg, w, h, 0.88, 0.04, "#1a0f14", 12); [0.2, 0.3, 0.4].forEach(function (x0, i) { camel(cg, w * x0, h * (0.86 - 0.008 * i), s * (0.045 - i * 0.004), "#1a0f14"); }); }); g.drawImage(L, 0, 0); particles(g, w, h, t, "dust", ["#ffe6b0"], 30, 8); finish(g, w, h, t, 0.55); },
    epiphanyLight: function (g, w, h, t) { sky(g, w, h, ["#1a1640", "#463a86", "#d8b06a"]); sun(g, w, h, 0.5, 0.7, "#fff1cf", 0.6, 0.55); rays(g, w, h, t, 0.5, 0.75, "#fff1cf", 12, 0.05, 8); particles(g, w, h, t, "dust", ["#fff2c8"], 60, 9); finish(g, w, h, t, 0.5); },
    // New Year
    newDawn: function (g, w, h, t) { sky(g, w, h, ["#1e2c4c", "#7a6b9a", "#ffb47a"]); sun(g, w, h, 0.5, 0.74, "#ffe3a8", 0.55, 0.85); rays(g, w, h, t, 0.5, 0.74, "#ffe3a8", 14, 0.045, 10); cloudBand(g, w, h, t, 0.12, 0.38, "#ffd2b0", 0.35, 12, 1); var L = once("dawn", w, h, function (cg) { mountains(cg, w, h, 0.76, 0.16, "#6a5a7a", 13, "#ffd0a0"); mountains(cg, w, h, 0.84, 0.14, "#3a3352", 14, "#ffb47a"); hills(cg, w, h, 0.93, 0.04, "#1e1a2c", 15); }); g.drawImage(L, 0, 0); finish(g, w, h, t, 0.4); },
    newYearSparkle: function (g, w, h, t) { sky(g, w, h, ["#05060f", "#10142e", "#1b1036"]); bokeh(g, w, h, t, ["#ffd27a", "#ffffff", "#c0d4ff"], 40, 0.22, 33); particles(g, w, h, t, "embers", ["#ffe6a8", "#ffffff"], 70, 11); finish(g, w, h, t, 0.6); },
    // Ash Wednesday and Lent
    ashCross: function (g, w, h, t) { sky(g, w, h, ["#2a2a2e", "#46424a", "#1a191c"]); cloudBand(g, w, h, t, 0, 1, "#8a8590", 0.25, 15, 1); var s = Math.min(w, h); var L = once("ash", w, h, function (cg) { cross(cg, w * 0.5, h * 0.72, s * 0.42, rgba("#151418", 0.92)); }); g.drawImage(L, 0, 0); particles(g, w, h, t, "snow", ["#9a959e", "#6e6a72"], 70, 13); finish(g, w, h, t, 0.65, 0.8); },
    lentPurple: function (g, w, h, t) { sky(g, w, h, ["#14081f", "#2e1446", "#0a0410"]); sun(g, w, h, 0.5, 0.4, "#8a5bd1", 0.5, 0.35); cloudBand(g, w, h, t, 0, 1, "#5b2a86", 0.3, 16, 1); finish(g, w, h, t, 0.7); },
    lentDesert: function (g, w, h, t) { sky(g, w, h, ["#3a2440", "#a0705a", "#e0b080"]); sun(g, w, h, 0.66, 0.62, "#ffe0b0", 0.4, 0.6); var L = once("desert", w, h, function (cg) { hills(cg, w, h, 0.76, 0.06, "#8a5a46", 16, 0, "#e0b080"); hills(cg, w, h, 0.84, 0.05, "#5a3a32", 17); hills(cg, w, h, 0.93, 0.04, "#2e1e1e", 18); cross(cg, w * 0.3, h * 0.79, Math.min(w, h) * 0.16, "#2e1e1e"); }); g.drawImage(L, 0, 0); particles(g, w, h, t, "dust", ["#ffe0b0"], 40, 19); finish(g, w, h, t, 0.5); },
    // Palm Sunday
    palmsLight: function (g, w, h, t) { sky(g, w, h, ["#f6e8c0", "#e2c486", "#8a9a5a"]); sun(g, w, h, 0.5, 0.25, "#fffbe8", 0.6, 0.7); rays(g, w, h, t, 0.5, 0.2, "#fffbe8", 12, 0.05, 11); var s = Math.min(w, h); frond(g, w * 0.16, h * 1.08, s * 0.8, "#24401a", 0.5 + 0.03 * Math.sin(t * per(2)), Math.max(1, s * 0.006)); frond(g, w * 0.86, h * 1.1, s * 0.85, "#24401a", -0.55 + 0.03 * Math.sin(t * per(2) + 1), Math.max(1, s * 0.006)); frond(g, w * 0.05, h * 0.8, s * 0.5, "#3a5a2a", 0.95 + 0.02 * Math.sin(t * per(3)), 0); particles(g, w, h, t, "dust", ["#fffbe8"], 40, 12); finish(g, w, h, t, 0.35); },
    palmsRoad: function (g, w, h, t) { sky(g, w, h, ["#8ab8da", "#eadfb6", "#d0b07a"]); sun(g, w, h, 0.5, 0.55, "#fffbe8", 0.4, 0.6); var s = Math.min(w, h); var L = once("road", w, h, function (cg) { mountains(cg, w, h, 0.66, 0.08, "#b8a684", 20); hills(cg, w, h, 0.72, 0.04, "#a89068", 21, 0, "#eadfb6"); cg.fillStyle = "#d8c08e"; cg.beginPath(); cg.moveTo(w * 0.48, h * 0.7); cg.lineTo(w * 0.52, h * 0.7); cg.lineTo(w * 0.85, h); cg.lineTo(w * 0.15, h); cg.closePath(); cg.fill(); var rr = rng(4); for (var i = 0; i < 26; i++) { var k = rr(), y = h * (0.72 + k * 0.26), x = w * (0.5 + (rr() - 0.5) * (0.06 + k * 0.6)); cg.save(); cg.translate(x, y); cg.rotate((rr() - 0.5) * 1.2); palm(cg, 0, 0, s * (0.03 + 0.1 * k), rgba("#3a5a22", 0.85), Math.PI / 2, 0); cg.restore(); } }); g.drawImage(L, 0, 0); for (var j = 0; j < 4; j++) { frond(g, w * (0.04 + j * 0.05), h * (1.06 - j * 0.03), s * (0.75 - j * 0.12), j ? "#2d4a1e" : "#1e3414", 0.35 + j * 0.12 + 0.02 * Math.sin(t * per(2) + j), j ? 0 : Math.max(1, s * 0.006)); frond(g, w * (0.96 - j * 0.05), h * (1.06 - j * 0.03), s * (0.75 - j * 0.12), j ? "#2d4a1e" : "#1e3414", -0.35 - j * 0.12 + 0.02 * Math.sin(t * per(2) + j + 1), j ? 0 : Math.max(1, s * 0.006)); } finish(g, w, h, t, 0.35); },
    // Good Friday
    stormCross: function (g, w, h, t) { sky(g, w, h, ["#0d0f14", "#262b33", "#3a3238"]); cloudBand(g, w, h, t, 0, 0.7, "#4a4f5a", 0.55, 21, 2); var flash = Math.max(0, Math.sin(t * per(3))) > 0.995 ? 0.25 : 0; if (flash) fill(g, w, h, rgba("#c8d4ff", flash)); var s = Math.min(w, h); var L = once("storm", w, h, function (cg) { hills(cg, w, h, 0.84, 0.1, "#050608", 22); threeCrosses(cg, w * 0.5, h * 0.72, s * 0.3, "#050608"); }); g.drawImage(L, 0, 0); finish(g, w, h, t, 0.75, 0.8); },
    goodFridayRed: function (g, w, h, t) { sky(g, w, h, ["#14050a", "#3a0a12", "#0a0204"]); var s = Math.min(w, h); var L = once("gfred", w, h, function (cg) { cross(cg, w * 0.5, h * 0.82, s * 0.5, "#050102", "#8a1a24"); }); cloudBand(g, w, h, t, 0, 0.7, "#5a1018", 0.4, 23, 1); g.drawImage(L, 0, 0); particles(g, w, h, t, "dust", ["#a0303a"], 30, 23); finish(g, w, h, t, 0.75); },
    darkNoon: function (g, w, h, t) { sky(g, w, h, ["#08080c", "#1a1418", "#2a1a18"]); cloudBand(g, w, h, t, 0.2, 0.6, "#3a2a2a", 0.5, 22, 1); var s = Math.min(w, h), cx = w * 0.7, cy = h * 0.26, r = s * 0.11; g.save(); g.globalCompositeOperation = "lighter"; var co = g.createRadialGradient(cx, cy, r * 0.95, cx, cy, r * (2.6 + 0.15 * Math.sin(t * per(2)))); co.addColorStop(0, rgba("#ffe8c8", 0.75)); co.addColorStop(0.15, rgba("#ffb070", 0.3)); co.addColorStop(1, rgba("#ff8040", 0)); g.fillStyle = co; g.fillRect(0, 0, w, h); g.restore(); g.fillStyle = "#050406"; g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill(); var L = once("noon", w, h, function (cg) { hills(cg, w, h, 0.86, 0.12, "#050406", 23); cross(cg, w * 0.5, h * 0.76, s * 0.34, "#050406"); }); g.drawImage(L, 0, 0); finish(g, w, h, t, 0.7, 0.8); },
    // Easter
    emptyTomb: function (g, w, h, t) { sky(g, w, h, ["#3a4a7a", "#e8a07a", "#ffe2a8"]); sun(g, w, h, 0.8, 0.58, "#fff6dc", 0.55, 0.9); rays(g, w, h, t, 0.8, 0.58, "#fff6dc", 14, 0.06, 13); cloudBand(g, w, h, t, 0.05, 0.4, "#ffe0c8", 0.35, 24, 1); var s = Math.min(w, h); var L = once("tomb", w, h, function (cg) { hills(cg, w, h, 0.8, 0.05, "#7a5a5a", 25, 0, "#ffd0a0"); tomb(cg, w * 0.36, h * 0.9, s * 0.2, "#3a2e2e", "#120d0d", "#fff1cf", "#ffd8a0"); hills(cg, w, h, 0.97, 0.03, "#1e1818", 26); }); g.drawImage(L, 0, 0); particles(g, w, h, t, "dust", ["#fff3c4"], 40, 27); finish(g, w, h, t, 0.4); },
    easterSunrise: function (g, w, h, t) { sky(g, w, h, ["#2a3a6a", "#f0a070", "#fff0c0"]); sun(g, w, h, 0.5, 0.74, "#fffbe8", 0.6, 1); rays(g, w, h, t, 0.5, 0.74, "#fffbe8", 14, 0.08, 14); var s = Math.min(w, h); var L = once("easun", w, h, function (cg) { hills(cg, w, h, 0.8, 0.06, "#6a4a5a", 27, 0, "#ffd8b0"); hills(cg, w, h, 0.9, 0.05, "#2a2030", 28); threeCrosses(cg, w * 0.5, h * 0.82, s * 0.2, "#2a2030"); }); g.drawImage(L, 0, 0); particles(g, w, h, t, "dust", ["#fff3c4"], 50, 29); finish(g, w, h, t, 0.35); },
    easterGarden: function (g, w, h, t) { sky(g, w, h, ["#a8d0f0", "#fff3d6", "#d8f0c8"]); sun(g, w, h, 0.8, 0.15, "#ffffff", 0.5, 0.8); var L = once("garden", w, h, function (cg) { hills(cg, w, h, 0.78, 0.05, "#8ab878", 30, 0, "#e8f8d8"); hills(cg, w, h, 0.9, 0.05, "#4a7a3a", 31); }); g.drawImage(L, 0, 0); var s = Math.min(w, h) * 0.18; [0.18, 0.28, 0.72, 0.84].forEach(function (x, i) { lily(g, w * x, h * 1.0, s * (0.9 + (i % 2) * 0.2), "#ffffff", "#3a6a2a", t, i); }); particles(g, w, h, t, "petals", ["#ffffff", "#fff0f4"], 26, 33); finish(g, w, h, t, 0.25, 0.4); },
    easterLilies: function (g, w, h, t) { sky(g, w, h, ["#fdf6e3", "#f0e0b0", "#d8b878"]); sun(g, w, h, 0.5, 0.3, "#ffffff", 0.6, 0.8); var s = Math.min(w, h) * 0.2; [0.3, 0.42, 0.58, 0.7].forEach(function (x, i) { lily(g, w * x, h * 1.02, s * (1 + (i % 2) * 0.15), "#ffffff", "#4a6a2a", t, i * 1.3); }); particles(g, w, h, t, "dust", ["#fff8e0"], 40, 35); finish(g, w, h, t, 0.2, 0.4); },
    easterGold: function (g, w, h, t) { sky(g, w, h, ["#fff6e0", "#ffd98a", "#f0b050"]); rays(g, w, h, t, 0.5, -0.05, "#ffffff", 14, 0.12, 15); var s = Math.min(w, h); var L = once("eagold", w, h, function (cg) { cross(cg, w * 0.5, h * 0.78, s * 0.45, rgba("#ffffff", 0.9), "#ffffff"); }); g.drawImage(L, 0, 0); bokeh(g, w, h, t, ["#ffffff", "#fff0c0"], 24, 0.2, 37); finish(g, w, h, t, 0.2, 0.35); },
    // Pentecost
    pentecostFlames: function (g, w, h, t) { sky(g, w, h, ["#1a0402", "#5a1206", "#2a0602"]); var s = Math.min(w, h) * 0.08; g.save(); g.globalCompositeOperation = "lighter"; for (var i = 0; i < 9; i++) { var x = w * (0.12 + i * 0.095), y = h * (0.78 - 0.05 * Math.sin(i * 1.7)); flame(g, x, y, s * (0.8 + 0.4 * ((i * 7) % 3) / 2), t, i * 2.1, "#ffe08a", "#ff5a1a"); } g.restore(); particles(g, w, h, t, "embers", ["#ffb04a", "#ffe08a"], 90, 39); finish(g, w, h, t, 0.6); },
    pentecostDove: function (g, w, h, t) { sky(g, w, h, ["#2a0806", "#8a2a10", "#ff8a3a"]); rays(g, w, h, t, 0.5, 0.4, "#ffe2b0", 16, 0.06, 16); var s = Math.min(w, h) * 0.24, fl = 0.5 + 0.5 * Math.sin(t * per(12)); dove(g, w * 0.5, h * 0.4 + s * 0.05 * Math.sin(t * per(4)), s, rgba("#fff8ec", 0.96), fl, "#ffe2b0"); particles(g, w, h, t, "embers", ["#ffd08a"], 60, 41); finish(g, w, h, t, 0.5); },
    pentecostWind: function (g, w, h, t) { sky(g, w, h, ["#3a0a08", "#c0401a", "#ffb060"]); g.save(); g.globalCompositeOperation = "lighter"; for (var k = 0; k < 14; k++) { g.strokeStyle = rgba(k % 2 ? "#ffd08a" : "#ff7a3a", 0.12); g.lineWidth = h * 0.012; g.beginPath(); for (var x = 0; x <= w; x += w / 50) { var y = h * (0.2 + k * 0.05) + h * 0.05 * Math.sin(x / w * 6 + t * per(4) + k); if (x) g.lineTo(x, y); else g.moveTo(x, y); } g.stroke(); } g.restore(); finish(g, w, h, t, 0.55); },
    // Communion
    breadCup: function (g, w, h, t) { sky(g, w, h, ["#1a0e08", "#3a2214", "#0a0604"]); var s = Math.min(w, h); candle(g, w * 0.2, h * 0.86, s * 0.05, "#f4ecd8", true, t, 1); candle(g, w * 0.8, h * 0.86, s * 0.05, "#f4ecd8", true, t, 2); sun(g, w, h, 0.5, 0.6, "#ffb860", 0.45, 0.35 + 0.05 * Math.sin(t * per(7))); var L = once("comm", w, h, function (cg) { chalice(cg, w * 0.58, h * 0.86, s * 0.22, "#0a0604", "#ffcf88"); loaf(cg, w * 0.4, h * 0.86, s * 0.16, "#0a0604", "#ffcf88"); }); bokeh(g, w, h, t, ["#ffb860", "#ffd8a0"], 14, 0.12, 31); g.drawImage(L, 0, 0); particles(g, w, h, t, "dust", ["#ffd8a0"], 40, 32); finish(g, w, h, t, 0.65); },
    candlelight: function (g, w, h, t) { sky(g, w, h, ["#0a0604", "#1e1208", "#050302"]); var s = Math.min(w, h); for (var i = 0; i < 7; i++) candle(g, w * (0.2 + i * 0.1), h * (0.9 - (i % 2) * 0.04), s * (0.045 + (i % 3) * 0.01), "#f4ecd8", true, t, i * 1.7); bokeh(g, w, h, t, ["#ffb860", "#ffd8a0"], 22, 0.18, 43); finish(g, w, h, t, 0.6); },
    // Baptism
    baptismWater: function (g, w, h, t) { sky(g, w, h, ["#cfe8ff", "#8ac0e8", "#5a98c8"]); sun(g, w, h, 0.5, 0.12, "#ffffff", 0.5, 0.8); rays(g, w, h, t, 0.5, 0.0, "#ffffff", 12, 0.06, 17); sea(g, w, h, t, "#5a9ac8", "#0a2a4a", "#f0faff", 0.6, 0.5); var s = Math.min(w, h) * 0.16; dove(g, w * 0.5, h * 0.3 + s * 0.05 * Math.sin(t * per(4)), s, rgba("#ffffff", 0.95), 0.5 + 0.5 * Math.sin(t * per(10)), "#ffffff"); finish(g, w, h, t, 0.3, 0.4); },
    riverLight: function (g, w, h, t) { sky(g, w, h, ["#e8f2ff", "#b8d8ea", "#6aa0c0"]); sun(g, w, h, 0.3, 0.3, "#ffffff", 0.45, 0.7); var L = once("river", w, h, function (cg) { hills(cg, w, h, 0.5, 0.1, "#6a8a7a", 34, 0, "#c8e0d8"); hills(cg, w, h, 0.56, 0.06, "#3a5a4a", 35); }); g.drawImage(L, 0, 0); sea(g, w, h, t, "#7ab0cc", "#1a4a6a", "#ffffff", 0.56, 0.3); particles(g, w, h, t, "dust", ["#ffffff"], 40, 45); finish(g, w, h, t, 0.25, 0.4); },
    // Mother's Day / Father's Day
    softFlorals: function (g, w, h, t) { sky(g, w, h, ["#fff0f2", "#f8d0d8", "#f0b8c4"]); bokeh(g, w, h, t, ["#ffffff", "#ffd0dc", "#ffe8c8"], 30, 0.28, 47); particles(g, w, h, t, "petals", ["#ff9ab4", "#ffc8d6", "#ffffff"], 40, 49); finish(g, w, h, t, 0.18, 0.35); },
    warmMeadow: function (g, w, h, t) { sky(g, w, h, ["#ffd8b0", "#f8b8a0", "#c88070"]); sun(g, w, h, 0.3, 0.6, "#fff4dc", 0.5, 0.8); var L = once("meadow", w, h, function (cg) { hills(cg, w, h, 0.76, 0.05, "#c8907a", 36, 0, "#ffd8b0"); hills(cg, w, h, 0.88, 0.05, "#8a5a4a", 37); var rr = rng(3); for (var i = 0; i < 140; i++) { cg.fillStyle = rgba(["#ffffff", "#ffd0dc", "#ffe8a0"][i % 3], 0.8); cg.beginPath(); cg.arc(rr() * w, h * (0.86 + rr() * 0.14), Math.min(w, h) * (0.003 + rr() * 0.004), 0, TAU); cg.fill(); } }); g.drawImage(L, 0, 0); particles(g, w, h, t, "dust", ["#fff4dc"], 40, 51); finish(g, w, h, t, 0.3); },
    fathersOak: function (g, w, h, t) { sky(g, w, h, ["#3a4a5a", "#8a7a6a", "#e0b080"]); sun(g, w, h, 0.72, 0.7, "#ffe0b0", 0.45, 0.8); rays(g, w, h, t, 0.72, 0.7, "#ffe0b0", 10, 0.04, 38); var L = once("oak", w, h, function (cg) { hills(cg, w, h, 0.84, 0.06, "#2a2420", 38); var x = w * 0.3, y = h * 0.86, s = Math.min(w, h) * 0.45, rr = rng(9); cg.fillStyle = "#16120f"; cg.strokeStyle = "#16120f"; cg.lineCap = "round"; cg.beginPath(); cg.moveTo(x - s * 0.07, y); cg.quadraticCurveTo(x - s * 0.05, y - s * 0.3, x - s * 0.03, y - s * 0.45); cg.lineTo(x + s * 0.04, y - s * 0.45); cg.quadraticCurveTo(x + s * 0.06, y - s * 0.3, x + s * 0.1, y); cg.closePath(); cg.fill(); [[-0.5, -0.62], [-0.3, -0.75], [0.05, -0.8], [0.35, -0.72], [0.55, -0.6]].forEach(function (b) { cg.lineWidth = s * 0.03; cg.beginPath(); cg.moveTo(x, y - s * 0.42); cg.quadraticCurveTo(x + b[0] * s * 0.5, y - s * 0.55, x + b[0] * s, y + b[1] * s); cg.stroke(); }); for (var i = 0; i < 260; i++) { var a = rr() * Math.PI, r = Math.sqrt(rr()), px = x + Math.cos(a) * r * s * 0.68, py = y - s * 0.66 - Math.sin(a) * r * s * 0.32 + (rr() - 0.5) * s * 0.12; cg.beginPath(); cg.arc(px, py, s * (0.015 + rr() * 0.035), 0, TAU); cg.fill(); } }); g.drawImage(L, 0, 0); particles(g, w, h, t, "dust", ["#ffe0b0"], 30, 39); finish(g, w, h, t, 0.45); },
    // Thanksgiving
    harvestField: function (g, w, h, t) { sky(g, w, h, ["#3a2a4a", "#c86a3a", "#ffc070"]); sun(g, w, h, 0.62, 0.66, "#ffe0a0", 0.5, 0.9); var L = once("harvest", w, h, function (cg) { hills(cg, w, h, 0.72, 0.04, "#8a4a2a", 40, 0, "#ffc070"); var rr = rng(11); cg.fillStyle = "#c88a3a"; cg.fillRect(0, h * 0.74, w, h * 0.26); cg.strokeStyle = "#6a3a1a"; for (var i = 0; i < 400; i++) { var x = rr() * w, y = h * (0.76 + rr() * 0.24), ln = h * (0.02 + (y / h - 0.76) * 0.2); cg.lineWidth = Math.max(1, ln * 0.06); cg.beginPath(); cg.moveTo(x, y); cg.lineTo(x + ln * 0.15, y - ln); cg.stroke(); } [0.2, 0.32].forEach(function (x0) { var x = w * x0, y = h * 0.8, s = Math.min(w, h) * 0.08; cg.fillStyle = "#5a3416"; cg.beginPath(); cg.moveTo(x - s * 0.5, y); cg.lineTo(x - s * 0.15, y - s * 1.3); cg.lineTo(x + s * 0.15, y - s * 1.3); cg.lineTo(x + s * 0.5, y); cg.closePath(); cg.fill(); }); }); g.drawImage(L, 0, 0); particles(g, w, h, t, "dust", ["#ffe0a0"], 40, 53); finish(g, w, h, t, 0.45); },
    autumnLeaves: function (g, w, h, t) { sky(g, w, h, ["#2a1408", "#6a2a0a", "#c8601a"]); bokeh(g, w, h, t, ["#ffb04a", "#ff7a2a", "#ffd88a"], 26, 0.22, 55); particles(g, w, h, t, "petals", ["#d8501a", "#ffa040", "#a0300a", "#e8b030"], 50, 57); finish(g, w, h, t, 0.5); },
    // Every Sunday
    crossHillDawn: function (g, w, h, t) { sky(g, w, h, ["#1e2a52", "#b07a8a", "#ffd0a0"]); sun(g, w, h, 0.5, 0.7, "#fff0d0", 0.55, 0.9); rays(g, w, h, t, 0.5, 0.7, "#fff0d0", 12, 0.06, 18); cloudBand(g, w, h, t, 0.05, 0.4, "#ffd8c0", 0.3, 42, 1); var s = Math.min(w, h); var L = once("crosshill", w, h, function (cg) { hills(cg, w, h, 0.84, 0.12, "#1a1420", 43); cross(cg, w * 0.5, h * 0.75, s * 0.3, "#1a1420"); }); g.drawImage(L, 0, 0); finish(g, w, h, t, 0.4); },
    openSky: function (g, w, h, t) { sky(g, w, h, ["#3a7ac8", "#8ac0f0", "#e8f4ff"]); cloudBand(g, w, h, t, 0, 1, "#ffffff", 0.75, 44, 1); cloudBand(g, w, h, t, 0.3, 0.7, "#ffffff", 0.5, 45, 2); finish(g, w, h, t, 0.2, 0.35); },
    stainedGlassGlow: function (g, w, h, t) { stainedGlass(g, w, h, t, ["#8a1a2a", "#1a3a8a", "#d8a020", "#2a6a3a", "#5a2a8a", "#c85a1a"], 59); sun(g, w, h, 0.5 + 0.1 * Math.sin(t * per(1)), 0.3, "#fff4d8", 0.45, 0.25); finish(g, w, h, t, 0.55, 0.4); },
    stainedGlassBlue: function (g, w, h, t) { stainedGlass(g, w, h, t, ["#0a2a6a", "#1a4aa0", "#3a7ad8", "#0a1a4a", "#d8a020", "#6a2a8a"], 61); finish(g, w, h, t, 0.6, 0.4); },
    worshipLights: function (g, w, h, t) { sky(g, w, h, ["#05040c", "#0c0a1e", "#03020a"]); g.save(); g.globalCompositeOperation = "lighter"; [["#5a7aff", 0.2], ["#ff4aa0", 0.5], ["#4ad8ff", 0.8]].forEach(function (b, i) { var ang = 0.35 * Math.sin(t * per(2 + i) + i); g.save(); g.translate(w * b[1], h * 1.05); g.rotate(ang); var len = h * 1.4, gr = g.createLinearGradient(0, 0, 0, -len); gr.addColorStop(0, rgba(b[0], 0.45)); gr.addColorStop(1, rgba(b[0], 0)); g.fillStyle = gr; g.beginPath(); g.moveTo(-w * 0.015, 0); g.lineTo(-w * 0.12, -len); g.lineTo(w * 0.12, -len); g.lineTo(w * 0.015, 0); g.closePath(); g.fill(); g.restore(); }); g.restore(); cloudBand(g, w, h, t, 0.3, 0.7, "#8a8ad8", 0.18, 46, 2); var L = once("crowd", w, h, function (cg) { var rr = rng(13); cg.fillStyle = "#020205"; for (var i = 0; i < 60; i++) { var x = rr() * w, y = h * (0.9 + rr() * 0.04), s = Math.min(w, h) * (0.025 + rr() * 0.01); cg.beginPath(); cg.arc(x, y - s, s * 0.55, 0, TAU); cg.fill(); cg.fillRect(x - s * 0.8, y - s * 0.5, s * 1.6, h); if (rr() < 0.25) { cg.save(); cg.translate(x, y - s); cg.rotate(-0.3 + rr() * 0.6); cg.fillRect(-s * 0.12, -s * 2.2, s * 0.24, s * 2); cg.restore(); } } }); g.drawImage(L, 0, 0); finish(g, w, h, t, 0.5); },
    mountainMajesty: function (g, w, h, t) { sky(g, w, h, ["#1a2a4a", "#6a8ab8", "#e8d0b8"]); sun(g, w, h, 0.7, 0.36, "#fff4e0", 0.4, 0.6); rays(g, w, h, t, 0.7, 0.36, "#fff4e0", 10, 0.035, 47); var L = once("mtn", w, h, function (cg) { mountains(cg, w, h, 0.6, 0.24, "#5e6e92", 48, "#dfe8ff"); mountains(cg, w, h, 0.74, 0.24, "#4a5a7a", 49, "#e8d0b8"); mountains(cg, w, h, 0.86, 0.2, "#2a3450", 50, "#c8b8a8"); hills(cg, w, h, 0.96, 0.05, "#121828", 51); }); g.drawImage(L, 0, 0); cloudBand(g, w, h, t, 0.5, 0.25, "#ffffff", 0.3, 47, 1); finish(g, w, h, t, 0.4); },
    stillWaters: function (g, w, h, t) { sky(g, w, h, ["#2a3a6a", "#c8a0b0", "#ffe0c0"]); sun(g, w, h, 0.5, 0.46, "#fff4e0", 0.4, 0.7); var L = once("still", w, h, function (cg) { mountains(cg, w, h, 0.5, 0.14, "#6a6080", 51, "#ffe0c0"); mountains(cg, w, h, 0.5, 0.07, "#2a2a44", 52); }); g.drawImage(L, 0, 0); sea(g, w, h, t, "#c8a0b0", "#1a2040", "#fff4e0", 0.5, 0.5); finish(g, w, h, t, 0.4); },
    cloudsAbove: function (g, w, h, t) { sky(g, w, h, ["#0a1a3a", "#3a5a9a", "#c8d8f0"]); sun(g, w, h, 0.5, 0.0, "#ffffff", 0.6, 0.5); rays(g, w, h, t, 0.5, -0.1, "#ffffff", 12, 0.06, 19); cloudBand(g, w, h, t, 0.55, 0.45, "#ffffff", 0.85, 52, 1); cloudBand(g, w, h, t, 0.7, 0.3, "#e8f0ff", 0.7, 53, 2); finish(g, w, h, t, 0.35, 0.35); },
    oceanDawn: function (g, w, h, t) { sky(g, w, h, ["#1a2a5a", "#d8889a", "#ffd0a0"]); sun(g, w, h, 0.5, 0.55, "#fff0d0", 0.5, 0.9); cloudBand(g, w, h, t, 0.1, 0.3, "#ffc8b0", 0.35, 55, 1); sea(g, w, h, t, "#d8889a", "#0a1a3a", "#fff0d0", 0.56, 0.5); finish(g, w, h, t, 0.4); },
    goldenHour: function (g, w, h, t) { sky(g, w, h, ["#4a2a1a", "#c8742a", "#ffd890"]); sun(g, w, h, 0.4, 0.5, "#fff0c0", 0.6, 0.6); bokeh(g, w, h, t, ["#ffe0a0", "#ffb860"], 28, 0.2, 63); particles(g, w, h, t, "dust", ["#fff0c0"], 60, 65); finish(g, w, h, t, 0.5); },
    nightPrayer: function (g, w, h, t) { sky(g, w, h, ["#02040c", "#0a1430", "#1e3058"]); K.stars(g, w, h, t, 67, 260, 0.85); var s = Math.min(w, h), mx = w * 0.74, my = h * 0.24, mr = s * 0.06; sun(g, w, h, 0.74, 0.24, "#c8d8ff", 0.25, 0.4); g.save(); g.beginPath(); g.arc(mx, my, mr, 0, TAU); g.clip(); g.fillStyle = "#eef2ff"; g.beginPath(); g.rect(mx - mr, my - mr, mr * 2, mr * 2); g.arc(mx + mr * 0.45, my - mr * 0.15, mr * 0.9, 0, TAU); g.fill("evenodd"); g.restore(); cloudBand(g, w, h, t, 0.3, 0.3, "#5a6a9a", 0.25, 56, 1); var L = once("pray", w, h, function (cg) { hills(cg, w, h, 0.84, 0.08, "#03050c", 54); var x = w * 0.3, y = h * 0.8, k = s * 0.16; cg.fillStyle = "#03050c"; cg.beginPath(); cg.ellipse(x + k * 0.12, y - k * 0.86, k * 0.11, k * 0.13, 0, 0, TAU); cg.fill(); cg.beginPath(); cg.moveTo(x - k * 0.45, y + k * 0.02); cg.quadraticCurveTo(x - k * 0.42, y - k * 0.45, x - k * 0.1, y - k * 0.62); cg.quadraticCurveTo(x + k * 0.05, y - k * 0.75, x + k * 0.12, y - k * 0.72); cg.lineTo(x + k * 0.3, y - k * 0.55); cg.lineTo(x + k * 0.35, y - k * 0.6); cg.lineTo(x + k * 0.18, y - k * 0.36); cg.quadraticCurveTo(x + k * 0.15, y - k * 0.1, x + k * 0.3, y + k * 0.02); cg.closePath(); cg.fill(); cg.fillRect(x - k * 0.5, y, k * 0.9, k * 0.3); }); g.drawImage(L, 0, 0); finish(g, w, h, t, 0.55); },
    // stills
    linenLight: function (g, w, h) { sky(g, w, h, ["#f6f1e6", "#ece3d0", "#d8ccb0"]); sun(g, w, h, 0.3, 0.2, "#ffffff", 0.6, 0.6); grainOver(g, w, h, 0, 0.5); vignette(g, w, h, 0.25); },
    parchmentCross: function (g, w, h) { sky(g, w, h, ["#efe2c4", "#e2cfa4", "#c8ae7a"]); var s = Math.min(w, h); cross(g, w * 0.5, h * 0.78, s * 0.5, rgba("#8a6a3a", 0.25)); grainOver(g, w, h, 0, 0.7); vignette(g, w, h, 0.35); },
    royalVelvet: function (g, w, h) { sky(g, w, h, ["#300a26", "#5a1444", "#12040c"]); sun(g, w, h, 0.25, 0.2, "#ff80c8", 0.7, 0.35); for (var i = 0; i < 6; i++) { var fx = w * (0.1 + i * 0.17), fg = g.createLinearGradient(fx - w * 0.08, 0, fx + w * 0.08, 0); fg.addColorStop(0, "rgba(0,0,0,0)"); fg.addColorStop(0.5, "rgba(0,0,0,0.25)"); fg.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = fg; g.fillRect(fx - w * 0.08, 0, w * 0.16, h); } grainOver(g, w, h, 0, 0.6); vignette(g, w, h, 0.7); },
    graceBlue: function (g, w, h) { sky(g, w, h, ["#0a1a3a", "#1a3a6a", "#4a7ab0"]); sun(g, w, h, 0.7, 0.3, "#c8e0ff", 0.6, 0.35); grainOver(g, w, h, 0, 0.5); vignette(g, w, h, 0.5); }
  };

  // ------------------------------------------------------------------ the list
  var M = "motion", S = "still", U = "utility";
  var DEFS = [
    ["s-advent-1", "Advent wreath, first candle", M, "advent", ["candles", "wreath", "purple", "hope"], SC.adventWreath(1, "#0a0c2e", "#1a1a5a", ["#5a6aff", "#8a5bd1"])],
    ["s-advent-2", "Advent wreath, second candle", M, "advent", ["candles", "wreath", "purple", "peace"], SC.adventWreath(2, "#170a30", "#341660", ["#8a5bd1", "#b07aff"])],
    ["s-advent-3", "Advent wreath, third candle (joy)", M, "advent", ["candles", "wreath", "pink", "joy"], SC.adventWreath(3, "#2a0a2a", "#5a1a50", ["#ff7ab8", "#ffcf88"])],
    ["s-advent-4", "Advent wreath, all four", M, "advent", ["candles", "wreath", "purple", "love"], SC.adventWreath(4, "#1a0e1a", "#3a2030", ["#ffcf88", "#ffe9b0", "#8a5bd1"])],
    ["s-advent-night", "Advent night", M, "advent", ["night", "candle", "blue", "waiting"], SC.adventNight],
    ["s-xmas-star", "Star over Bethlehem", M, "christmas", ["star", "hills", "night"], SC.bethlehemStar],
    ["s-xmas-nativity", "The stable", M, "christmas", ["nativity", "manger", "star"], SC.nativity],
    ["s-xmas-window", "Snow and a warm window", M, "christmas", ["snow", "church", "winter"], SC.snowyWindow],
    ["s-xmas-goldred", "Gold and red lights", M, "christmas", ["bokeh", "gold", "red", "lights"], SC.goldRed],
    ["s-xmas-tree", "Christmas tree lights", M, "christmas", ["tree", "lights", "green"], SC.christmasTree],
    ["s-epiphany-star", "The wise men's star", M, "epiphany", ["star", "magi", "camels"], SC.epiphanyStar],
    ["s-epiphany-light", "Light to the nations", M, "epiphany", ["light", "rays", "gold"], SC.epiphanyLight],
    ["s-newyear-dawn", "A new dawn", M, "newyear", ["sunrise", "mountains", "fresh"], SC.newDawn],
    ["s-newyear-sparkle", "New year sparkle", M, "newyear", ["sparkle", "bokeh", "gold"], SC.newYearSparkle],
    ["s-ash-cross", "Ashes", M, "ashwednesday", ["ash", "cross", "grey"], SC.ashCross],
    ["s-lent-purple", "Lent purple", M, "lent", ["purple", "quiet", "reflection"], SC.lentPurple],
    ["s-lent-desert", "Into the wilderness", M, "lent", ["desert", "cross", "wilderness"], SC.lentDesert],
    ["s-palm-light", "Palms in the light", M, "palmsunday", ["palms", "hosanna", "light"], SC.palmsLight],
    ["s-palm-road", "The road to Jerusalem", M, "palmsunday", ["palms", "road", "hosanna"], SC.palmsRoad],
    ["s-gf-storm", "Three crosses, stormy sky", M, "goodfriday", ["crosses", "storm", "calvary"], SC.stormCross],
    ["s-gf-red", "The cross, red", M, "goodfriday", ["cross", "red", "sacrifice"], SC.goodFridayRed],
    ["s-gf-noon", "Darkness at noon", M, "goodfriday", ["cross", "eclipse", "dark"], SC.darkNoon],
    ["s-easter-tomb", "The empty tomb", M, "easter", ["tomb", "sunrise", "risen"], SC.emptyTomb],
    ["s-easter-sunrise", "Easter sunrise", M, "easter", ["sunrise", "crosses", "risen"], SC.easterSunrise],
    ["s-easter-garden", "The garden", M, "easter", ["garden", "lilies", "spring"], SC.easterGarden],
    ["s-easter-lilies", "Easter lilies", M, "easter", ["lilies", "white", "gold"], SC.easterLilies],
    ["s-easter-gold", "He is risen, gold", M, "easter", ["cross", "gold", "white", "glory"], SC.easterGold],
    ["s-pent-flames", "Tongues of fire", M, "pentecost", ["fire", "flames", "red", "spirit"], SC.pentecostFlames],
    ["s-pent-dove", "The dove", M, "pentecost", ["dove", "spirit", "orange"], SC.pentecostDove],
    ["s-pent-wind", "A mighty wind", M, "pentecost", ["wind", "fire", "spirit"], SC.pentecostWind],
    ["s-comm-bread", "Bread and cup", M, "communion", ["bread", "cup", "candles", "table"], SC.breadCup],
    ["s-comm-candles", "Candlelight", M, "communion", ["candles", "warm", "quiet"], SC.candlelight],
    ["s-bapt-water", "Water and the dove", M, "baptism", ["water", "dove", "light"], SC.baptismWater],
    ["s-bapt-river", "The river", M, "baptism", ["river", "water", "light"], SC.riverLight],
    ["s-mom-florals", "Soft florals", M, "mothersday", ["flowers", "pink", "soft"], SC.softFlorals],
    ["s-mom-meadow", "Warm meadow", M, "mothersday", ["meadow", "flowers", "warm"], SC.warmMeadow],
    ["s-dad-oak", "The old oak", M, "fathersday", ["tree", "evening", "strong"], SC.fathersOak],
    ["s-thanks-harvest", "Harvest field", M, "thanksgiving", ["harvest", "wheat", "sunset"], SC.harvestField],
    ["s-thanks-leaves", "Autumn leaves", M, "thanksgiving", ["leaves", "autumn", "orange"], SC.autumnLeaves],
    ["s-every-crosshill", "Cross on a hill at dawn", M, "everyday", ["cross", "hill", "dawn"], SC.crossHillDawn],
    ["s-every-sky", "Open sky", M, "everyday", ["sky", "clouds", "blue"], SC.openSky],
    ["s-every-glass", "Stained glass glow", M, "everyday", ["stained glass", "window", "colour"], SC.stainedGlassGlow],
    ["s-every-glass-blue", "Stained glass, blue", M, "everyday", ["stained glass", "blue"], SC.stainedGlassBlue],
    ["s-every-worship", "Worship lights", M, "everyday", ["concert", "lights", "hands"], SC.worshipLights],
    ["s-every-mountains", "Mountain majesty", M, "everyday", ["mountains", "sky"], SC.mountainMajesty],
    ["s-every-waters", "Still waters", M, "everyday", ["lake", "water", "psalm 23"], SC.stillWaters],
    ["s-every-clouds", "Above the clouds", M, "everyday", ["clouds", "heaven", "light"], SC.cloudsAbove],
    ["s-every-ocean", "Ocean dawn", M, "everyday", ["ocean", "sunrise", "water"], SC.oceanDawn],
    ["s-every-golden", "Golden hour", M, "everyday", ["gold", "warm", "bokeh"], SC.goldenHour],
    ["s-every-night", "Night prayer", M, "everyday", ["night", "stars", "prayer"], SC.nightPrayer],
    ["s-still-linen", "Linen light", S, "everyday", ["light", "cream", "simple"], SC.linenLight],
    ["s-still-parchment", "Parchment cross", S, "everyday", ["parchment", "cross", "scripture"], SC.parchmentCross],
    ["s-still-velvet", "Royal velvet", S, "lent", ["purple", "velvet"], SC.royalVelvet],
    ["s-still-grace", "Grace blue", S, "everyday", ["blue", "calm"], SC.graceBlue]
  ];
  B.register(DEFS.map(function (d) { return { id: d[0], name: d[1], kind: d[2], group: "Seasons: " + SEASON_NAME[d[3]], season: d[3], tags: d[4], tier: U, fn: d[5] }; }));

  // the seasonal slide looks (themes) and lower thirds, in the same colours as their backgrounds (slide-render.js)
  var THEMES = [
    ["u-advent", "Advent", "s-advent-4", "#f4ecff", "#d8c8f0", "#c9a0ff", "#2a1650"], ["u-christmas", "Christmas", "s-xmas-star", "#fff6e0", "#e8eefc", "#ffd27a", "#122454"],
    ["u-christmas-red", "Christmas, red and gold", "s-xmas-goldred", "#fff3d6", "#ffe6c0", "#ffcf6a", "#5a0c14"], ["u-epiphany", "Epiphany", "s-epiphany-light", "#ffffff", "#f6eedc", "#ffe6b0", "#463a86"],
    ["u-newyear", "New Year", "s-newyear-dawn", "#ffffff", "#fff2e6", "#ffd2a0", "#3a3352"], ["u-lent", "Lent", "s-lent-purple", "#efe6f6", "#d8cce6", "#a07ad0", "#2e1446"],
    ["u-palms", "Palm Sunday", "s-palm-light", "#2a3a16", "#3a4a26", "#6a8a3a", "#f2e2b0"], ["u-goodfriday", "Good Friday", "s-gf-storm", "#e8e8ec", "#c8c8d0", "#a03a40", "#14161c"],
    ["u-easter", "Easter", "s-easter-sunrise", "#ffffff", "#fff8ec", "#ffd98a", "#6a4a5a"], ["u-easter-light", "Easter, light", "s-easter-lilies", "#3a2a10", "#4a3a20", "#d8a040", "#fdf6e3"],
    ["u-pentecost", "Pentecost", "s-pent-flames", "#fff0e0", "#ffe0c8", "#ffb04a", "#5a1206"], ["u-communion", "Communion", "s-comm-bread", "#fff2e0", "#f0e0c8", "#ffcf88", "#3a2214"],
    ["u-baptism", "Baptism", "s-bapt-water", "#ffffff", "#f0f8ff", "#8ad0ff", "#0a2a4a"], ["u-mothers", "Mother's Day", "s-mom-florals", "#5a2a3a", "#6a3a4a", "#e07a9a", "#fff0f2"],
    ["u-fathers", "Father's Day", "s-dad-oak", "#fff4e6", "#f0e0d0", "#d8a878", "#2a2420"], ["u-thanks", "Thanksgiving", "s-thanks-harvest", "#fff6e6", "#ffe8cc", "#ffc070", "#6a2a0a"],
    ["u-every-dawn", "Cross at dawn", "s-every-crosshill", "#ffffff", "#fff0e6", "#ffd0a0", "#1a1420"], ["u-every-glass", "Stained glass", "s-every-glass", "#ffffff", "#f6f0e6", "#d8a020", "#0b0a0d"]
  ];
  root.CUSeasonThemes = THEMES.map(function (x) {
    return { id: x[0], name: x[1], tier: U, season: (DEFS.filter(function (d) { return d[0] === x[2]; })[0] || [])[3], bg: { type: "lyricbg", bgId: x[2], dim: 0.25 },
      title: { font: "Archivo", size: 96, weight: 800, color: x[3] }, body: { font: "Inter", size: 60, weight: 600, color: x[4] }, ref: { font: "Inter", size: 40, weight: 600, color: x[5] },
      lower: { box: x[6], accent: x[5], text: x[3] } };
  });
  root.CUSeasons = { ORDER: ORDER, NAMES: SEASON_NAME, seasonOf: seasonOf, thisSunday: thisSunday, easter: easter, adventStart: adventStart, list: function (season) { return B.list.filter(function (b) { return b.season && (!season || b.season === season); }); } };
  if (typeof module !== "undefined" && module.exports) module.exports = root.CUSeasons;
})(typeof window !== "undefined" ? window : this);
