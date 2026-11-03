/* Central Control - lyric backgrounds, made here (no downloads, nobody else's pictures).
 * Each background is drawn on a 2D canvas from the time alone, so the same moment looks the same on every screen,
 * in the Slides preview, on the output and on the 3D stage, and a crossfade never makes a motion background jump.
 *   CUBackgrounds.list                    [{ id, name, kind: "motion" | "still", group }]
 *   CUBackgrounds.draw(id, ctx, w, h, t)  draw one frame (t in seconds)
 *   CUBackgrounds.mount(el, id, opt)      a canvas filling el, animated, with set(id, fadeSeconds) and stop()
 *   CUBackgrounds.isBg(path)              true for "bg:<id>" (how a slide names one of these)
 * Works in a browser page and in node (draw only needs a 2D context). */
(function (root) {
  "use strict";
  var TAU = Math.PI * 2;
  function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { var a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function rgb(h) { h = h.replace("#", ""); var n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function rgba(c, a) { var v = typeof c === "string" ? rgb(c) : c; return "rgba(" + v[0] + "," + v[1] + "," + v[2] + "," + a + ")"; }
  function lerp(a, b, k) { return a + (b - a) * k; }
  function mixc(a, b, k) { return [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)]; }
  function fill(g, w, h, c) { g.fillStyle = c; g.fillRect(0, 0, w, h); }
  // a few things are slow to make: kept per size and seed
  var cache = {};
  function made(key, fn) { return cache[key] || (cache[key] = fn()); }
  function canvasOf(w, h) {
    if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(w, h);
    if (typeof document !== "undefined") { var c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
    return null;
  }

  // ------------------------------------------------------------------ the kinds of picture
  // big soft colour blobs drifting over a dark base (the "mesh gradient" look)
  function flow(p) {
    return function (g, w, h, t, r) {
      fill(g, w, h, p.base);
      g.globalCompositeOperation = "lighter";
      p.cols.forEach(function (c, i) {
        var sp = 0.05 + 0.025 * i, ph = i * 1.9 + (p.ph || 0);
        var x = w * (0.5 + 0.38 * Math.sin(t * sp + ph)), y = h * (0.5 + 0.34 * Math.cos(t * sp * 0.8 + ph * 1.3)), rad = Math.max(w, h) * (0.45 + 0.12 * Math.sin(t * 0.07 + i));
        var gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, rgba(c, p.a || 0.55)); gr.addColorStop(1, rgba(c, 0)); g.fillStyle = gr; g.fillRect(0, 0, w, h);
      });
      g.globalCompositeOperation = "source-over";
    };
  }
  // light leaks: wide warm streaks sliding slowly across
  function leaks(p) {
    return function (g, w, h, t) {
      fill(g, w, h, p.base);
      g.globalCompositeOperation = "lighter";
      p.cols.forEach(function (c, i) {
        var x = w * (((t * (0.012 + i * 0.006) + i * 0.37) % 1.6) - 0.3), ang = -0.5 + i * 0.35, len = Math.max(w, h) * 1.6;
        g.save(); g.translate(x, h * (0.3 + 0.2 * Math.sin(t * 0.05 + i))); g.rotate(ang);
        var gr = g.createLinearGradient(-w * 0.18, 0, w * 0.18, 0); gr.addColorStop(0, rgba(c, 0)); gr.addColorStop(0.5, rgba(c, 0.42 + 0.15 * Math.sin(t * 0.3 + i * 2))); gr.addColorStop(1, rgba(c, 0));
        g.fillStyle = gr; g.fillRect(-w * 0.18, -len / 2, w * 0.36, len); g.restore();
      });
      g.globalCompositeOperation = "source-over";
      vignette(g, w, h, 0.55);
    };
  }
  // small points: dust rising, snow falling, fireflies wandering
  function motes(p) {
    return function (g, w, h, t, r) {
      fill(g, w, h, p.base); if (p.glow) glowAt(g, w, h, p.glow);
      var n = p.n || 90, rr = rng(r);
      g.globalCompositeOperation = "lighter";
      for (var i = 0; i < n; i++) {
        var sx = rr(), sy = rr(), sz = 0.4 + rr() * 1.6, sp = (0.01 + rr() * 0.03) * (p.speed || 1), ph = rr() * TAU, c = p.cols[i % p.cols.length], x, y;
        if (p.dir === "down") { x = (sx + 0.03 * Math.sin(t * 0.4 + ph)) * w; y = (((sy + t * sp) % 1.1) - 0.05) * h; }
        else if (p.dir === "wander") { x = (sx + 0.06 * Math.sin(t * 0.13 + ph)) * w; y = (sy + 0.05 * Math.cos(t * 0.11 + ph * 1.7)) * h; }
        else { x = (sx + 0.02 * Math.sin(t * 0.3 + ph)) * w; y = (1.05 - ((sy + t * sp) % 1.1)) * h; }
        var a = p.dir === "wander" ? Math.max(0, Math.sin(t * (0.5 + sx) + ph)) : 0.55 + 0.45 * Math.sin(t * 0.9 + ph), s = sz * Math.max(w, h) / 900 * (p.size || 1);
        var gr = g.createRadialGradient(x, y, 0, x, y, s * 4); gr.addColorStop(0, rgba(c, 0.9 * a)); gr.addColorStop(1, rgba(c, 0)); g.fillStyle = gr; g.fillRect(x - s * 4, y - s * 4, s * 8, s * 8);
      }
      g.globalCompositeOperation = "source-over";
    };
  }
  // out-of-focus circles drifting
  function bokeh(p) {
    return function (g, w, h, t, r) {
      fill(g, w, h, p.base); var rr = rng(r), n = p.n || 26;
      g.globalCompositeOperation = "lighter";
      for (var i = 0; i < n; i++) {
        var sx = rr(), sy = rr(), sz = 0.03 + rr() * 0.08, ph = rr() * TAU, c = p.cols[i % p.cols.length];
        var x = (sx + 0.05 * Math.sin(t * 0.05 + ph)) * w, y = (sy + 0.04 * Math.cos(t * 0.04 + ph)) * h, rad = sz * Math.max(w, h), a = 0.12 + 0.12 * Math.sin(t * 0.25 + ph);
        var gr = g.createRadialGradient(x, y, rad * 0.6, x, y, rad); gr.addColorStop(0, rgba(c, a)); gr.addColorStop(0.85, rgba(c, a * 1.4)); gr.addColorStop(1, rgba(c, 0));
        g.fillStyle = gr; g.beginPath(); g.arc(x, y, rad, 0, TAU); g.fill();
      }
      g.globalCompositeOperation = "source-over"; vignette(g, w, h, 0.5);
    };
  }
  // soft value noise as a small tile, drawn big and moving in layers (clouds, smoke)
  function noiseTile(seed, n) {
    return made("noise" + seed + ":" + n, function () {
      var c = canvasOf(n, n); if (!c) return null; var g = c.getContext("2d"), img = g.createImageData(n, n), rr = rng(seed), grid = [], G = 8;
      for (var i = 0; i < (G + 1) * (G + 1); i++) grid.push(rr());
      function at(x, y) { return grid[(y % G) * (G + 1) + (x % G)]; }
      for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) {
        var fx = x / n * G, fy = y / n * G, ix = Math.floor(fx), iy = Math.floor(fy), ux = fx - ix, uy = fy - iy; ux = ux * ux * (3 - 2 * ux); uy = uy * uy * (3 - 2 * uy);
        var v = lerp(lerp(at(ix, iy), at(ix + 1, iy), ux), lerp(at(ix, iy + 1), at(ix + 1, iy + 1), ux), uy), k = (y * n + x) * 4;
        img.data[k] = img.data[k + 1] = img.data[k + 2] = 255; img.data[k + 3] = Math.round(Math.pow(v, 1.6) * 255);
      }
      g.putImageData(img, 0, 0); return c;
    });
  }
  function clouds(p) {
    return function (g, w, h, t, r) {
      var gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, p.top); gr.addColorStop(1, p.bottom); g.fillStyle = gr; g.fillRect(0, 0, w, h);
      var tile = noiseTile(r, 96); if (!tile) return;
      [[1.4, 0.006, 0.5], [0.8, 0.011, 0.35], [0.5, 0.017, 0.25]].forEach(function (L, i) {
        var size = Math.max(w, h) * L[0], ox = -((t * L[1] * w) % size), c = p.cols[i % p.cols.length];
        g.save(); g.globalAlpha = L[2] * (p.a || 1);
        for (var x = ox; x < w; x += size) for (var y = -size * 0.2 + i * h * 0.1; y < h; y += size) g.drawImage(tile, x, y, size, size);
        g.restore(); void c;
      });
      if (p.tint) { g.save(); g.globalCompositeOperation = "multiply"; fill(g, w, h, p.tint); g.restore(); }
      vignette(g, w, h, 0.4);
    };
  }
  // aurora: wavy ribbons of colour
  function aurora(p) {
    return function (g, w, h, t) {
      fill(g, w, h, p.base); g.globalCompositeOperation = "lighter";
      p.cols.forEach(function (c, i) {
        var y0 = h * (0.3 + i * 0.13);
        for (var k = 0; k < 3; k++) {
          g.beginPath(); g.moveTo(0, h);
          for (var x = 0; x <= w; x += w / 48) { var u = x / w; g.lineTo(x, y0 + h * 0.08 * Math.sin(u * 5 + t * 0.12 * (i + 1) + k) + h * 0.05 * Math.sin(u * 11 - t * 0.07 + i)); }
          g.lineTo(w, h); g.closePath();
          var gr = g.createLinearGradient(0, y0 - h * 0.25, 0, y0 + h * 0.3); gr.addColorStop(0, rgba(c, 0)); gr.addColorStop(0.45, rgba(c, 0.16)); gr.addColorStop(1, rgba(c, 0)); g.fillStyle = gr; g.fill();
        }
      });
      g.globalCompositeOperation = "source-over"; stars(g, w, h, t, 7, 60, 0.5);
    };
  }
  // water: light caustics from a few crossing waves, worked out on a small picture and drawn big
  function water(p) {
    var lo = rgb(p.deep), hi = rgb(p.light);
    return function (g, w, h, t, r) {
      var W = 128, H = 72, c = made("water" + r, function () { return canvasOf(W, H); }); if (!c) { fill(g, w, h, p.deep); return; }
      var cg = c.getContext("2d"), img = cg.createImageData(W, H), d = img.data;
      for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
        var u = x / W * 6, v = y / H * 3.4, s = Math.sin(u * 1.3 + t * 0.6) + Math.sin(v * 2.1 - t * 0.45) + Math.sin((u + v) * 1.1 + t * 0.35) + Math.sin(Math.hypot(u - 3, v - 1.7) * 2.2 - t * 0.8);
        var k = Math.pow(Math.max(0, 1 - Math.abs(s) * 0.55), 3) * (p.bright || 0.8), cc = mixc(lo, hi, k), i = (y * W + x) * 4;
        d[i] = cc[0]; d[i + 1] = cc[1]; d[i + 2] = cc[2]; d[i + 3] = 255;
      }
      cg.putImageData(img, 0, 0); g.imageSmoothingEnabled = true; g.drawImage(c, 0, 0, w, h); vignette(g, w, h, 0.45);
    };
  }
  function stars(g, w, h, t, seed, n, a) {
    var rr = rng(seed);
    for (var i = 0; i < n; i++) { var x = rr() * w, y = rr() * h, s = (0.4 + rr() * 1.4) * Math.max(w, h) / 1400, tw = 0.5 + 0.5 * Math.sin(t * (0.6 + rr() * 1.5) + rr() * TAU); g.fillStyle = "rgba(255,255,255," + (a * tw).toFixed(3) + ")"; g.fillRect(x, y, s * 2, s * 2); }
  }
  function starfield(p) {
    return function (g, w, h, t, r) {
      fill(g, w, h, p.base); glowAt(g, w, h, "#1a2a4a", 0.5 + 0.2 * Math.sin(t * 0.05), 0.5, 0.6); if (p.nebula) { g.globalCompositeOperation = "lighter"; flow({ base: "rgba(0,0,0,0)", cols: p.nebula, a: 0.22 })(g, w, h, t, r); g.globalCompositeOperation = "source-over"; }
      var rr = rng(r);
      for (var i = 0; i < 220; i++) {
        var z = 0.2 + rr() * 0.8, x = ((rr() + t * 0.01 * z) % 1) * w, y = rr() * h, s = z * Math.max(w, h) / 450, tw = 0.6 + 0.4 * Math.sin(t * (0.5 + rr() * 2) + i);
        g.fillStyle = "rgba(255,255,255," + (z * tw).toFixed(3) + ")"; g.beginPath(); g.arc(x, y, s, 0, TAU); g.fill();
      }
    };
  }
  // quiet geometry: hexagons, drifting lines, low-poly shimmer, rings
  function hexes(p) {
    return function (g, w, h, t) {
      fill(g, w, h, p.base); var s = Math.max(w, h) / 14, hh = s * Math.sqrt(3) / 2;
      g.lineWidth = Math.max(1, s / 40);
      for (var row = -1; row < h / hh + 1; row++) for (var col = -1; col < w / (s * 1.5) + 1; col++) {
        var cx = col * s * 1.5, cy = row * hh * 2 + (col % 2 ? hh : 0), k = 0.5 + 0.5 * Math.sin(t * 0.4 + cx * 0.004 + cy * 0.006);
        g.strokeStyle = rgba(p.line, 0.08 + 0.22 * k); g.beginPath();
        for (var i = 0; i < 6; i++) { var a = i * TAU / 6; g[i ? "lineTo" : "moveTo"](cx + s * 0.92 * Math.cos(a), cy + s * 0.92 * Math.sin(a)); }
        g.closePath(); g.stroke(); if (k > 0.93) { g.fillStyle = rgba(p.line, (k - 0.93) * 2); g.fill(); }
      }
      vignette(g, w, h, 0.6);
    };
  }
  function lines(p) {
    return function (g, w, h, t) {
      fill(g, w, h, p.base); g.lineWidth = Math.max(1, w / 900);
      for (var i = -20; i < 40; i++) { var x = (i * w / 20 + t * w * 0.01) % (w * 2) - w * 0.5, k = 0.5 + 0.5 * Math.sin(i * 1.7 + t * 0.3); g.strokeStyle = rgba(p.line, 0.05 + 0.15 * k); g.beginPath(); g.moveTo(x, 0); g.lineTo(x + h * 0.6, h); g.stroke(); }
      glowAt(g, w, h, p.glow || p.line); vignette(g, w, h, 0.5);
    };
  }
  function triangles(p) {
    return function (g, w, h, t, r) {
      var cols = Math.ceil(w / (w / 12)) + 1, rows = 8, cw = w / 12, ch = h / (rows - 1), rr = rng(r), pts = [];
      for (var y = 0; y < rows; y++) for (var x = 0; x < cols + 1; x++) pts.push([x * cw + (rr() - 0.5) * cw * 0.6 - (y % 2) * cw / 2, y * ch + (rr() - 0.5) * ch * 0.5]);
      var A = rgb(p.a), B = rgb(p.b);
      for (var y2 = 0; y2 < rows - 1; y2++) for (var x2 = 0; x2 < cols; x2++) {
        var i0 = y2 * (cols + 1) + x2, i1 = i0 + 1, i2 = i0 + cols + 1, i3 = i2 + 1;
        [[i0, i1, i2], [i1, i3, i2]].forEach(function (tri, k) {
          var cx = (pts[tri[0]][0] + pts[tri[1]][0] + pts[tri[2]][0]) / 3, cy = (pts[tri[0]][1] + pts[tri[1]][1] + pts[tri[2]][1]) / 3;
          var m = 0.5 + 0.5 * Math.sin(t * 0.25 + cx * 0.003 + cy * 0.004 + k), c = mixc(A, B, cy / h * 0.7 + m * 0.3);
          g.fillStyle = "rgb(" + (c[0] | 0) + "," + (c[1] | 0) + "," + (c[2] | 0) + ")"; g.beginPath(); g.moveTo(pts[tri[0]][0], pts[tri[0]][1]); g.lineTo(pts[tri[1]][0], pts[tri[1]][1]); g.lineTo(pts[tri[2]][0], pts[tri[2]][1]); g.closePath(); g.fill();
        });
      }
      vignette(g, w, h, 0.5);
    };
  }
  function rings(p) {
    return function (g, w, h, t) {
      fill(g, w, h, p.base); var cx = w / 2, cy = h * 0.55, M = Math.hypot(w, h) * 0.6; g.lineWidth = Math.max(1, w / 500);
      for (var i = 0; i < 14; i++) { var rad = ((i / 14 + t * 0.02) % 1) * M, a = Math.sin((rad / M) * Math.PI) * 0.3; g.strokeStyle = rgba(p.line, a); g.beginPath(); g.arc(cx, cy, rad, 0, TAU); g.stroke(); }
      glowAt(g, w, h, p.line, cx / w, cy / h, 0.35);
    };
  }
  function waves(p) {
    return function (g, w, h, t) {
      var gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, p.top); gr.addColorStop(1, p.bottom); g.fillStyle = gr; g.fillRect(0, 0, w, h);
      p.cols.forEach(function (c, i) {
        var y0 = h * (0.55 + i * 0.09); g.beginPath(); g.moveTo(0, h);
        for (var x = 0; x <= w; x += w / 60) g.lineTo(x, y0 + h * 0.035 * Math.sin(x / w * (4 + i) + t * (0.25 + i * 0.07)) + h * 0.02 * Math.sin(x / w * 9 - t * 0.2 + i));
        g.lineTo(w, h); g.closePath(); g.fillStyle = rgba(c, 0.35 + i * 0.12); g.fill();
      });
    };
  }
  function silk(p) {
    return function (g, w, h, t) {
      fill(g, w, h, p.base); g.globalCompositeOperation = "lighter"; g.lineWidth = Math.max(1, w / 700);
      for (var i = 0; i < 46; i++) {
        var k = i / 46, c = mixc(rgb(p.a), rgb(p.b), k); g.strokeStyle = "rgba(" + (c[0] | 0) + "," + (c[1] | 0) + "," + (c[2] | 0) + ",0.18)"; g.beginPath();
        for (var x = 0; x <= w; x += w / 40) { var u = x / w, y = h * (0.5 + 0.22 * Math.sin(u * 3 + t * 0.12 + k * 1.5) * Math.cos(u * 1.3 - t * 0.08 + k * 2) + (k - 0.5) * 0.25); g[x ? "lineTo" : "moveTo"](x, y); }
        g.stroke();
      }
      g.globalCompositeOperation = "source-over"; vignette(g, w, h, 0.55);
    };
  }
  // rays: soft beams from above
  function rays(p) {
    return function (g, w, h, t) {
      var gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, p.top); gr.addColorStop(1, p.bottom); g.fillStyle = gr; g.fillRect(0, 0, w, h);
      var ox = w * (0.5 + 0.08 * Math.sin(t * 0.05)); g.globalCompositeOperation = "lighter";
      for (var i = 0; i < 9; i++) {
        var a = -0.6 + i * 0.15 + 0.03 * Math.sin(t * 0.2 + i * 1.3), len = h * 1.6, wd = w * (0.04 + 0.03 * Math.sin(i * 2.3)), k = 0.08 + 0.07 * Math.sin(t * 0.3 + i);
        g.save(); g.translate(ox, -h * 0.1); g.rotate(a);
        var lg = g.createLinearGradient(0, 0, 0, len); lg.addColorStop(0, rgba(p.ray, k * 2)); lg.addColorStop(1, rgba(p.ray, 0)); g.fillStyle = lg;
        g.beginPath(); g.moveTo(-wd * 0.2, 0); g.lineTo(wd * 0.2, 0); g.lineTo(wd, len); g.lineTo(-wd, len); g.closePath(); g.fill(); g.restore();
      }
      g.globalCompositeOperation = "source-over"; motes({ base: "rgba(0,0,0,0)", cols: [p.ray], n: 40, speed: 0.4, size: 0.7 })(g, w, h, t, 99);
    };
  }
  function crossGlow(p) {
    return function (g, w, h, t) {
      flow({ base: p.base, cols: p.cols, a: 0.35 })(g, w, h, t, 5);
      var cx = w / 2, cy = h * 0.46, s = Math.min(w, h) * 0.5, k = 0.75 + 0.25 * Math.sin(t * 0.4);
      glowAt(g, w, h, p.glow, 0.5, 0.46, 0.5 * k);
      g.fillStyle = rgba(p.glow, 0.22 + 0.08 * k); g.fillRect(cx - s * 0.035, cy - s * 0.5, s * 0.07, s); g.fillRect(cx - s * 0.28, cy - s * 0.25, s * 0.56, s * 0.07);
    };
  }
  // stills
  function solid(c) { return function (g, w, h) { fill(g, w, h, c); }; }
  function linear(a, b, ang) { return function (g, w, h) { var dx = Math.cos(ang || Math.PI / 2), dy = Math.sin(ang || Math.PI / 2), gr = g.createLinearGradient(w / 2 - dx * w / 2, h / 2 - dy * h / 2, w / 2 + dx * w / 2, h / 2 + dy * h / 2); gr.addColorStop(0, a); gr.addColorStop(1, b); g.fillStyle = gr; g.fillRect(0, 0, w, h); }; }
  function spot(base, c) { return function (g, w, h) { fill(g, w, h, base); glowAt(g, w, h, c, 0.5, 0.42, 0.7); vignette(g, w, h, 0.7); }; }
  function grain(base, amt, weave, seed) {
    return function (g, w, h, t, r) {
      fill(g, w, h, base);
      var tile = made("grain" + seed + ":" + weave, function () {
        var n = 128, c = canvasOf(n, n); if (!c) return null; var cg = c.getContext("2d"), img = cg.createImageData(n, n), rr = rng(seed);
        for (var i = 0; i < n * n; i++) { var x = i % n, y = (i / n) | 0, v = (rr() - 0.5) * 255 * amt; if (weave) v += (Math.sin(x * 1.6) + Math.sin(y * 1.6)) * 18 * amt; var k = v > 0 ? 255 : 0; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = k; img.data[i * 4 + 3] = Math.min(255, Math.abs(v)); }
        cg.putImageData(img, 0, 0); return c;
      });
      if (tile) { var pat = g.createPattern(tile, "repeat"); g.fillStyle = pat; g.fillRect(0, 0, w, h); }
      vignette(g, w, h, 0.5);
    };
  }
  function marble(base, vein) {
    return function (g, w, h, t, r) {
      fill(g, w, h, base); var rr = rng(r); g.lineCap = "round";
      for (var i = 0; i < 14; i++) {
        var x = rr() * w, y = rr() * h, a = rr() * TAU, wid = (0.5 + rr() * 2.5) * w / 900; g.strokeStyle = rgba(vein, 0.08 + rr() * 0.12); g.lineWidth = wid; g.beginPath(); g.moveTo(x, y);
        for (var s = 0; s < 30; s++) { a += (rr() - 0.5) * 0.6; x += Math.cos(a) * w / 40; y += Math.sin(a) * h / 40; g.lineTo(x, y); }
        g.stroke();
      }
      vignette(g, w, h, 0.35);
    };
  }
  function wash(cols) {
    return function (g, w, h, t, r) {
      fill(g, w, h, "#f2ede4"); var rr = rng(r);
      for (var i = 0; i < 26; i++) { var c = cols[i % cols.length], x = rr() * w, y = rr() * h, rad = (0.15 + rr() * 0.3) * Math.max(w, h), gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, rgba(c, 0.18)); gr.addColorStop(0.7, rgba(c, 0.08)); gr.addColorStop(1, rgba(c, 0)); g.fillStyle = gr; g.fillRect(0, 0, w, h); }
      g.save(); g.globalCompositeOperation = "multiply"; fill(g, w, h, "rgba(40,30,20,0.35)"); g.restore();
    };
  }
  function glowAt(g, w, h, c, fx, fy, size) {
    var x = w * (fx == null ? 0.5 : fx), y = h * (fy == null ? 0.5 : fy), rad = Math.max(w, h) * (size || 0.45), gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, rgba(c, 0.35)); gr.addColorStop(1, rgba(c, 0)); g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }
  function vignette(g, w, h, k) {
    var gr = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.hypot(w, h) * 0.6); gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(1, "rgba(0,0,0," + k + ")"); g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }

  // ------------------------------------------------------------------ the list
  var M = "motion", S = "still";
  var DEFS = [
    ["morning-glow", "Morning glow", M, "Gradients", flow({ base: "#1a0f0a", cols: ["#ff9a5a", "#ffcf7a", "#ff6f6f"] })],
    ["deep-ocean", "Deep ocean", M, "Gradients", flow({ base: "#030a14", cols: ["#0e4d7a", "#0a7d8c", "#1b2f6b"] })],
    ["royal", "Royal", M, "Gradients", flow({ base: "#0b0618", cols: ["#5b2bb5", "#2a3ab8", "#8a2c9e"] })],
    ["ember", "Ember", M, "Gradients", flow({ base: "#0d0402", cols: ["#b8320f", "#e36a12", "#6e1206"] })],
    ["forest", "Forest", M, "Gradients", flow({ base: "#020a07", cols: ["#1c6b4a", "#0f5c62", "#4a7a24"] })],
    ["sunset-haze", "Sunset haze", M, "Gradients", flow({ base: "#120614", cols: ["#ff5f8f", "#ff9b4a", "#7b3fd1"], ph: 1.2 })],
    ["leaks-warm", "Light leaks, warm", M, "Light", leaks({ base: "#0c0806", cols: ["#ff8a3d", "#ffd27a", "#ff5c5c"] })],
    ["leaks-cool", "Light leaks, cool", M, "Light", leaks({ base: "#05080e", cols: ["#4fa3ff", "#8af0ff", "#a07bff"] })],
    ["rays", "Rays of light", M, "Light", rays({ top: "#1b2433", bottom: "#05070b", ray: "#fff4d8" })],
    ["rays-dusk", "Rays at dusk", M, "Light", rays({ top: "#3a1f1a", bottom: "#0b0606", ray: "#ffb070" })],
    ["cross-glow", "Cross in the light", M, "Light", crossGlow({ base: "#07070b", cols: ["#3a2a6b", "#1d3b6e"], glow: "#fff1cf" })],
    ["dust-gold", "Rising dust", M, "Particles", motes({ base: "#0b0805", cols: ["#ffcf7a", "#ffe9b0"], glow: "#4a2f12", n: 110 })],
    ["snowfall", "Snowfall", M, "Particles", motes({ base: "#0a1220", cols: ["#ffffff", "#dfe9ff"], dir: "down", n: 140, glow: "#1f3456" })],
    ["fireflies", "Fireflies", M, "Particles", motes({ base: "#040806", cols: ["#d7ff7a", "#ffe066"], dir: "wander", n: 70, size: 1.4, glow: "#102016" })],
    ["bokeh-gold", "Bokeh, gold", M, "Bokeh", bokeh({ base: "#0a0704", cols: ["#ffc35a", "#ff9a3a", "#fff0c0"] })],
    ["bokeh-blue", "Bokeh, blue", M, "Bokeh", bokeh({ base: "#03060d", cols: ["#4f8bff", "#7ad8ff", "#9b8cff"] })],
    ["bokeh-colour", "Bokeh, colours", M, "Bokeh", bokeh({ base: "#050507", cols: ["#ff6b6b", "#ffd166", "#06d6a0", "#4cc9f0", "#b388ff"], n: 34 })],
    ["clouds-soft", "Soft clouds", M, "Sky", clouds({ top: "#6c9bd2", bottom: "#d8e6f5", cols: ["#ffffff"], a: 1.1 })],
    ["clouds-storm", "Storm clouds", M, "Sky", clouds({ top: "#1c2026", bottom: "#3a414b", cols: ["#9aa3ad"], a: 0.9 })],
    ["clouds-gold", "Golden clouds", M, "Sky", clouds({ top: "#f2a65a", bottom: "#5a2a3a", cols: ["#fff0d0"], a: 0.9, tint: "#ffd9a0" })],
    ["aurora-green", "Aurora, green", M, "Sky", aurora({ base: "#020610", cols: ["#2affb0", "#1ec8ff", "#3dff6e"] })],
    ["aurora-violet", "Aurora, violet", M, "Sky", aurora({ base: "#05030f", cols: ["#b05cff", "#ff5cc8", "#5c7cff"] })],
    ["starfield", "Starfield", M, "Sky", starfield({ base: "#020308" })],
    ["galaxy", "Galaxy", M, "Sky", starfield({ base: "#03020a", nebula: ["#4b2a8a", "#1f4f8a", "#8a2a6b"] })],
    ["water-still", "Still water", M, "Water", water({ deep: "#04172e", light: "#5fb4ff", bright: 0.7 })],
    ["water-pool", "Pool light", M, "Water", water({ deep: "#04363d", light: "#aefcff", bright: 0.9 })],
    ["waves", "Waves", M, "Water", waves({ top: "#0c1a2e", bottom: "#030812", cols: ["#1b4b7a", "#2a6aa0", "#3f8fc8"] })],
    ["hexagons", "Hexagons", M, "Shapes", hexes({ base: "#06080d", line: "#7aa8ff" })],
    ["lines", "Lines", M, "Shapes", lines({ base: "#08080a", line: "#ffffff", glow: "#3a4a7a" })],
    ["low-poly", "Low poly", M, "Shapes", triangles({ a: "#1b2a4a", b: "#5b3a7a" })],
    ["rings", "Rings", M, "Shapes", rings({ base: "#06060a", line: "#ffd9a0" })],
    ["silk", "Silk", M, "Shapes", silk({ base: "#050408", a: "#ff7ab8", b: "#7ab8ff" })],
    ["black", "Black", S, "Colours", solid("#000000")],
    ["charcoal", "Charcoal", S, "Colours", solid("#1c1d21")],
    ["navy", "Navy", S, "Colours", solid("#0c1a33")],
    ["deep-purple", "Deep purple", S, "Colours", solid("#24103d")],
    ["warm-grey", "Warm grey", S, "Colours", solid("#3a3430")],
    ["sunrise", "Sunrise", S, "Gradients", linear("#ffb36b", "#4a1f4f")],
    ["ocean", "Ocean", S, "Gradients", linear("#1f6fa8", "#04121f")],
    ["dusk", "Dusk", S, "Gradients", linear("#3b2a6b", "#ff8a5c", -Math.PI / 2)],
    ["emerald", "Emerald", S, "Gradients", linear("#0d5c46", "#02120d", Math.PI / 3)],
    ["spotlight", "Spotlight", S, "Light", spot("#050505", "#ffffff")],
    ["linen", "Linen", S, "Textures", grain("#2c2824", 0.35, true, 11)],
    ["paper", "Paper", S, "Textures", grain("#e9e3d6", 0.25, false, 12)],
    ["marble", "Marble", S, "Textures", marble("#e8e6e1", "#5a5a60")],
    ["watercolour", "Watercolour", S, "Textures", wash(["#6aa7d8", "#d88aa7", "#a7d86a"])],
    // (10.3) fifteen more - the free set stays a sampler; Central Utility has the full church year
    ["teal-dawn", "Teal dawn", M, "Gradients", flow({ base: "#03100f", cols: ["#1aa0a0", "#4ad0c0", "#2a6aa0"] })],
    ["rose-gold", "Rose gold", M, "Gradients", flow({ base: "#140a0a", cols: ["#e8907a", "#f0c0a0", "#b05a6a"], ph: 0.7 })],
    ["leaks-rose", "Light leaks, rose", M, "Light", leaks({ base: "#0c0608", cols: ["#ff7aa0", "#ffc0a0", "#c05aff"] })],
    ["rays-blue", "Rays, morning blue", M, "Light", rays({ top: "#2a4a6a", bottom: "#0a1420", ray: "#e0f0ff" })],
    ["embers", "Embers", M, "Particles", motes({ base: "#0a0302", cols: ["#ff7a2a", "#ffb04a"], glow: "#3a0e04", n: 120 })],
    ["bokeh-white", "Bokeh, warm white", M, "Bokeh", bokeh({ base: "#0c0a0c", cols: ["#fff4e0", "#ffe0b0", "#ffffff"] })],
    ["clouds-pastel", "Pastel clouds", M, "Sky", clouds({ top: "#b8a0e0", bottom: "#ffd8c8", cols: ["#ffffff"], a: 1.0 })],
    ["aurora-teal", "Aurora, teal", M, "Sky", aurora({ base: "#020a0c", cols: ["#2affd8", "#2a8aff", "#8affb0"] })],
    ["water-sunlit", "Sunlit water", M, "Water", water({ deep: "#0a2438", light: "#ffd89a", bright: 0.75 })],
    ["waves-sunset", "Sunset waves", M, "Water", waves({ top: "#3a1a3a", bottom: "#0a0410", cols: ["#8a2a4a", "#c8503a", "#f0903a"] })],
    ["hexagons-gold", "Hexagons, gold", M, "Shapes", hexes({ base: "#0a0806", line: "#ffcf7a" })],
    ["silk-gold", "Silk, gold", M, "Shapes", silk({ base: "#070504", a: "#ffcf7a", b: "#ff8a5a" })],
    ["forest-green", "Forest green", S, "Colours", solid("#0e2a1e")],
    ["twilight", "Twilight", S, "Gradients", linear("#1a2a5a", "#7a3a6a")],
    ["spotlight-warm", "Warm spotlight", S, "Light", spot("#0a0604", "#ffd8a0")]
  ];
  var BY = {}, LIST = DEFS.map(function (d) { var e = { id: d[0], name: d[1], kind: d[2], group: d[3] }; BY[d[0]] = { e: e, fn: d[4], seed: hash(d[0]) }; return e; });

  function draw(id, g, w, h, t) {
    var b = BY[id] || BY.black; g.save(); try { b.fn(g, w, h, t || 0, b.seed); } finally { g.restore(); }
  }
  function isBg(p) { return typeof p === "string" && p.indexOf("bg:") === 0; }
  function idOf(p) { return isBg(p) ? p.slice(3) : null; }
  function nameOf(p) { var id = idOf(p); return id && BY[id] ? BY[id].e.name : null; }
  function isMotion(id) { var b = BY[id]; return !!(b && b.e.kind === "motion"); }

  // a canvas that fills el and keeps drawing: set(id) crossfades to another background
  function mount(el, id, opt) {
    opt = opt || {}; if (typeof document === "undefined") return null;
    var c = document.createElement("canvas"); c.className = opt.className || "cu-bg"; c.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block";
    el.insertBefore(c, el.firstChild);
    var g = c.getContext("2d", { alpha: false }), cur = id, prev = null, fadeFrom = 0, fadeLen = 0, raf = 0, stopped = false, lastT = -1, scale = opt.scale || 0.5, fps = opt.fps || 30, lastPaint = 0;
    var tmp = null;
    function size() { var r = el.getBoundingClientRect(), w = Math.max(32, Math.round((r.width || 640) * scale)), h = Math.max(18, Math.round((r.height || 360) * scale)); if (c.width !== w || c.height !== h) { c.width = w; c.height = h; lastT = -1; } }
    function paint(now) {
      if (stopped) return; raf = requestAnimationFrame(paint);
      if (now - lastPaint < 1000 / fps - 2) return; lastPaint = now;
      size(); var t = now / 1000, fading = prev && now - fadeFrom < fadeLen * 1000;
      if (!fading && prev) prev = null;
      if (!fading && !isMotion(cur) && lastT >= 0) return;   // a still is drawn once
      lastT = t;
      if (fading) {
        if (!tmp) tmp = document.createElement("canvas"); tmp.width = c.width; tmp.height = c.height;
        draw(prev, g, c.width, c.height, t); var tg = tmp.getContext("2d"); draw(cur, tg, c.width, c.height, t);
        g.globalAlpha = Math.min(1, (now - fadeFrom) / (fadeLen * 1000)); g.drawImage(tmp, 0, 0); g.globalAlpha = 1;
      } else draw(cur, g, c.width, c.height, t);
    }
    raf = requestAnimationFrame(paint);
    return {
      canvas: c,
      set: function (nid, fade) { if (nid === cur) return; prev = fade ? cur : null; cur = nid; fadeFrom = performance.now(); fadeLen = fade || 0; lastT = -1; },
      id: function () { return cur; },
      stop: function () { stopped = true; cancelAnimationFrame(raf); if (c.parentNode) c.parentNode.removeChild(c); }
    };
  }
  // a thumbnail (a data URL), for the picker
  function thumb(id, w, h, t) {
    var c = canvasOf(w || 160, h || 90); if (!c) return ""; draw(id, c.getContext("2d"), c.width, c.height, t == null ? 12 : t);
    if (c.toDataURL) return c.toDataURL("image/jpeg", 0.8);
    return "";
  }

  // (10.2) more backgrounds from another file (Central Utility's seasonal set, backgrounds-seasons.js): each def is
  // { id, name, kind, group, season?, tags?, tier?, fn(g, w, h, t, seed) }. A tier ("utility") says which plan uses it.
  function register(defs) {
    (defs || []).forEach(function (d) {
      if (!d || !d.id || BY[d.id] || typeof d.fn !== "function") return;
      var e = { id: d.id, name: d.name, kind: d.kind === S ? S : M, group: d.group || "More" };
      if (d.season) e.season = d.season; if (d.tags) e.tags = d.tags.slice(); if (d.tier) e.tier = d.tier;
      BY[d.id] = { e: e, fn: d.fn, seed: hash(d.id) }; LIST.push(e);
    });
  }
  // usable here: no tier, or this device has its plan (PPLicense)
  function allowed(id) { var b = BY[id]; if (!b || !b.e.tier) return true; var L = root.PPLicense; return !!(L && L.hasPlan && L.hasPlan(b.e.tier)); }
  var api = { list: LIST, draw: draw, mount: mount, thumb: thumb, isBg: isBg, idOf: idOf, nameOf: nameOf, isMotion: isMotion, has: function (id) { return !!BY[id]; },
    register: register, allowed: allowed, entry: function (id) { return BY[id] ? BY[id].e : null; },
    _kit: { TAU: TAU, hash: hash, rng: rng, rgb: rgb, rgba: rgba, lerp: lerp, mixc: mixc, fill: fill, made: made, canvasOf: canvasOf, noiseTile: noiseTile, glowAt: glowAt, vignette: vignette, stars: stars } };
  root.CUBackgrounds = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : this);
