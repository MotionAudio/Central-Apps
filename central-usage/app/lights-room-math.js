/* Central Control - the room drawn under Room & seats: its outline, the seats laid out in it, and roughly how much
 * light lands on each seat. No drawing here, so it runs in node for the tests too.
 * Units are metres, seen from above: x across (0 = the middle of the stage), z from the stage's front edge out into
 * the room (positive) and upstage (negative).
 *   outline(hall)                       the room's corners, with curved walls broken into short pieces
 *   template(name, stage)               { outline, bulges } for "rect" | "fan" | "rounded" | "wide"
 *   layoutSeats(hall, stage)            { seats: [{ x, y, z, yaw, row, sec, bal }], placed, asked, rows, balconyRows }
 *   lightOnSeats(seats, emitters, st)   Float32Array of r, g, b per seat (about 0 = dark, 1 = well lit)
 *   summary(seats, levels)              plain numbers and words: most seats dim / lit, how even, the darkest part */
(function (root) {
  "use strict";
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // ------------------------------------------------------------------ the outline
  function centroid(pts) { var x = 0, z = 0; pts.forEach(function (p) { x += p[0]; z += p[1]; }); return [x / pts.length, z / pts.length]; }
  // each wall can bow out (bulge > 0) or in (< 0): bulge = how far the middle moves, as a share of the wall's length
  function outline(hall) {
    var pts = (hall && hall.outline) || [], bul = (hall && hall.bulges) || [], out = []; if (pts.length < 3) return pts.slice();
    var c = centroid(pts);
    for (var i = 0; i < pts.length; i++) {
      var a = pts[i], b = pts[(i + 1) % pts.length], k = Number(bul[i]) || 0; out.push(a);
      if (!k) continue;
      var mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2, dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz) || 1, nx = -dz / len, nz = dx / len;
      if ((mx - c[0]) * nx + (mz - c[1]) * nz < 0) { nx = -nx; nz = -nz; }   // (outward)
      var cx = mx + nx * k * len * 2, cz = mz + nz * k * len * 2;   // quadratic curve's control point
      for (var s = 1; s < 10; s++) { var t = s / 10, u = 1 - t; out.push([u * u * a[0] + 2 * u * t * cx + t * t * b[0], u * u * a[1] + 2 * u * t * cz + t * t * b[1]]); }
    }
    return out;
  }
  function inside(poly, x, z) {
    var c = false; for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) { var a = poly[i], b = poly[j]; if (((a[1] > z) !== (b[1] > z)) && (x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1] + 1e-12) + a[0])) c = !c; }
    return c;
  }
  function edgeDist(poly, x, z) {
    var best = 1e9; for (var i = 0; i < poly.length; i++) {
      var a = poly[i], b = poly[(i + 1) % poly.length], dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1e-9, t = clamp(((x - a[0]) * dx + (z - a[1]) * dz) / l2, 0, 1);
      best = Math.min(best, Math.hypot(x - (a[0] + dx * t), z - (a[1] + dz * t)));
    } return best;
  }
  function bounds(poly) { var b = { x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9 }; poly.forEach(function (p) { b.x0 = Math.min(b.x0, p[0]); b.x1 = Math.max(b.x1, p[0]); b.z0 = Math.min(b.z0, p[1]); b.z1 = Math.max(b.z1, p[1]); }); return b; }
  function area(poly) { var a = 0; for (var i = 0; i < poly.length; i++) { var p = poly[i], q = poly[(i + 1) % poly.length]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a) / 2; }

  // the room's usual shapes, sized from the stage
  function template(name, st) {
    var W = (st && st.width) || 10, D = (st && st.depth) || 6, R = Math.max(8, (st && st.room) || 14), back = -D - 0.6, hw = W / 2 + 4;
    if (name === "fan") return { outline: [[-W / 2 - 2, back], [W / 2 + 2, back], [W / 2 + 2, 0.5], [W / 2 + 2 + R * 0.55, R], [-W / 2 - 2 - R * 0.55, R], [-W / 2 - 2, 0.5]], bulges: [0, 0, 0, 0.08, 0, 0], curved: true };
    if (name === "rounded") return { outline: [[-hw, back], [hw, back], [hw, R * 0.55], [-hw, R * 0.55]], bulges: [0, 0, 0.22, 0], curved: true };
    if (name === "wide") return { outline: [[-W - 4, back], [W + 4, back], [W + 4, R * 0.6], [-W - 4, R * 0.6]], bulges: [0, 0, 0, 0], curved: false };
    return { outline: [[-hw, back], [hw, back], [hw, R], [-hw, R]], bulges: [0, 0, 0, 0], curved: false };
  }

  // ------------------------------------------------------------------ the seats
  function stageFront(st) { if (!st) return 0; if (st.shape === "thrust") return clamp(st.thrustD || 2.5, 0.5, 12); if (st.shape === "round") return clamp(st.apronD || (st.width || 10) * 0.22, 0.5, 10); return 0; }
  function layoutSeats(hall, st) {
    var S = Object.assign({ count: 300, rows: 0, sections: 3, aisle: 1.2, seatW: 0.55, rowD: 0.95, gap: 2, wall: 0.6 }, (hall && hall.seats) || {});
    var poly = outline(hall), out = { seats: [], placed: 0, asked: Math.max(0, Math.round(S.count) || 0), rows: 0, balconyRows: 0 };
    if (poly.length < 3 || !out.asked) return out;
    var b = bounds(poly), curved = S.curved != null ? !!S.curved : !!(hall && hall.curved), front = stageFront(st) + Math.max(0.5, S.gap), F = { x: 0, z: -((st && st.depth) || 6) * 0.35 };
    var bal = hall.balcony && hall.balcony.on ? hall.balcony : null, balZ = bal ? b.z1 - clamp(bal.depth || 6, 2, (b.z1 - front) * 0.8) : 1e9;
    var nSec = clamp(Math.round(S.sections) || 1, 1, 8), aisle = Math.max(0, S.aisle), seatW = clamp(S.seatW, 0.4, 1), rowD = clamp(S.rowD, 0.7, 2), wall = Math.max(0.3, S.wall);
    // the aisles: S-1 lines splitting the room's width into sections (straight rows: across; curved rows: by angle)
    var refR = front - F.z + 6, refZ = front + 6;
    function lateral(x, z) { return curved ? Math.atan2(x - F.x, z - F.z) * refR : x; }
    var uMin = 1e9, uMax = -1e9;
    for (var xx = b.x0; xx <= b.x1; xx += 0.25) { var zz = curved ? F.z + Math.sqrt(Math.max(0, refR * refR - xx * xx)) : refZ; if (inside(poly, xx, zz) && edgeDist(poly, xx, zz) >= wall) { var uu = lateral(xx, zz); uMin = Math.min(uMin, uu); uMax = Math.max(uMax, uu); } }
    var aisles = []; for (var j = 1; j < nSec; j++) aisles.push(uMin + (uMax - uMin) * j / nSec);
    function secOf(u) { var s = 0; aisles.forEach(function (a) { if (u > a) s++; }); return s; }
    function okSpot(x, z, minZ, maxZ) {
      if (z < minZ || z > maxZ) return false;
      if (!inside(poly, x, z) || edgeDist(poly, x, z) < wall) return false;
      var u = lateral(x, z); for (var k = 0; k < aisles.length; k++) if (Math.abs(u - aisles[k]) < aisle / 2 + seatW * 0.3) return false;
      return true;
    }
    function rowSpots(i, y0, minZ, maxZ) {
      var list = [];
      if (curved) {
        var r = front - F.z + i * rowD, step = seatW / r;
        for (var th = -Math.PI / 2 + step; th <= Math.PI / 2 - step; th += step) { var x = F.x + r * Math.sin(th), z = F.z + r * Math.cos(th); if (okSpot(x, z, minZ, maxZ)) list.push({ x: x, z: z, yaw: Math.atan2(F.x - x, F.z - z) }); }
      } else {
        var z2 = minZ + i * rowD; for (var x2 = b.x0 + seatW / 2; x2 <= b.x1; x2 += seatW) if (okSpot(x2, z2, minZ, maxZ)) list.push({ x: x2, z: z2, yaw: Math.PI });
      }
      list.forEach(function (p) { p.y = y0; });
      return list;
    }
    // fill from the front, row by row; the last row fills from the middle out
    function fill(minZ, maxZ, y0, rise, balcony, rowLimit) {
      var empty = 0, rows = 0;
      for (var i = 0; i < 400 && out.placed < out.asked; i++) {
        if (rowLimit && rows >= rowLimit) break;
        var y = y0 + (rise ? rows * rise : 0), spots = rowSpots(curved ? i + (balcony ? Math.round((minZ - front) / rowD) : 0) : i, y, minZ, maxZ);
        if (!curved && minZ + i * rowD > maxZ) break;
        if (curved && spots.length === 0 && F.z + (front - F.z + i * rowD) * 0.2 > maxZ) break;
        if (!spots.length) { if (out.placed && ++empty > 6) break; continue; }
        empty = 0; rows++;
        var need = out.asked - out.placed;
        if (spots.length > need) spots = spots.map(function (p) { return [Math.abs(lateral(p.x, p.z)), p]; }).sort(function (a, c) { return a[0] - c[0]; }).slice(0, need).map(function (q) { return q[1]; });
        spots.forEach(function (p) { out.seats.push({ x: p.x, y: p.y, z: p.z, yaw: p.yaw, row: rows, sec: secOf(lateral(p.x, p.z)), bal: !!balcony }); });
        out.placed += spots.length;
      }
      return rows;
    }
    out.rows = fill(front, b.z1, 0, 0, false, S.rows > 0 ? S.rows : 0);
    if (bal && out.placed < out.asked) out.balconyRows = fill(balZ + 0.6, b.z1, clamp(bal.height || 3.5, 2, 12), 0.35, true, 0);
    return out;
  }

  // ------------------------------------------------------------------ the light on each seat
  // each light: { x, y, z (the lens), dx, dy, dz (where it points), spread (degrees), r, g, b, k (0..1), surf, t }
  function smooth(a, b, v) { var t = clamp((v - a) / (b - a || 1e-9), 0, 1); return t * t * (3 - 2 * t); }
  function lightOnSeats(seats, emits, st) {
    var n = seats.length, out = new Float32Array(n * 3), deck = st ? Math.max(0, st.deck || 0) : 0, D = st ? st.depth || 6 : 6;
    var spill = [];
    emits.forEach(function (e) {   // light landing on the stage bounces a little into the room
      if (e.surf !== "deck" && !(e.surf === "floor" && e.z + e.dz * e.t < 0.5)) return;
      var px = e.x + e.dx * e.t, pz = e.z + e.dz * e.t; if (pz > 1 || pz < -D - 0.6) return;
      spill.push({ x: px, y: deck, z: pz, k: e.k * 0.5, r: e.r, g: e.g, b: e.b });
    });
    var pre = emits.map(function (e) { var half = clamp(e.spread || 20, 2, 170) / 2 * Math.PI / 180, l = Math.hypot(e.dx, e.dy, e.dz) || 1; return { e: e, ux: e.dx / l, uy: e.dy / l, uz: e.dz / l, inner: Math.cos(half * 0.75), outer: Math.cos(Math.min(Math.PI / 2 - 0.01, half * 1.5)) }; });
    for (var i = 0; i < n; i++) {
      var s = seats[i], px = s.x, py = (s.y || 0) + 1.1, pz = s.z, r = 0, g = 0, b = 0;
      for (var k = 0; k < pre.length; k++) {
        var p = pre[k], e = p.e, vx = px - e.x, vy = py - e.y, vz = pz - e.z, d2 = vx * vx + vy * vy + vz * vz, d = Math.sqrt(d2) || 1e-6;
        var c = (vx * p.ux + vy * p.uy + vz * p.uz) / d; if (c <= p.outer) continue;
        var f = smooth(p.outer, p.inner, c) * e.k * 12 / Math.max(4, d2);
        r += e.r * f; g += e.g * f; b += e.b * f;
      }
      for (var q = 0; q < spill.length; q++) { var sp = spill[q], dd = (px - sp.x) * (px - sp.x) + (py - sp.y) * (py - sp.y) + (pz - sp.z) * (pz - sp.z), ff = sp.k * 1.2 / Math.max(9, dd); r += sp.r * ff; g += sp.g * ff; b += sp.b * ff; }
      out[i * 3] = r; out[i * 3 + 1] = g; out[i * 3 + 2] = b;
    }
    return out;
  }
  function lum(levels, i) { return 0.3 * levels[i * 3] + 0.59 * levels[i * 3 + 1] + 0.11 * levels[i * 3 + 2]; }
  function summary(seats, levels) {
    var n = seats.length; if (!n) return { seats: 0, text: "No seats yet." };
    var sum = 0, sq = 0, cats = { dark: 0, dim: 0, lit: 0, bright: 0 }, x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    seats.forEach(function (s) { x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); z0 = Math.min(z0, s.z); z1 = Math.max(z1, s.z); });
    var zones = {}, zn = function (s) { var cx = x1 - x0 < 1e-6 ? 1 : Math.min(2, Math.floor((s.x - x0) / (x1 - x0 + 1e-6) * 3)), cz = z1 - z0 < 1e-6 ? 0 : Math.min(2, Math.floor((s.z - z0) / (z1 - z0 + 1e-6) * 3)); return ["front", "middle", "back"][cz] + " " + ["left", "centre", "right"][cx]; };
    for (var i = 0; i < n; i++) {
      var l = lum(levels, i); sum += l; sq += l * l;
      cats[l < 0.04 ? "dark" : l < 0.15 ? "dim" : l < 0.5 ? "lit" : "bright"]++;
      var z = zn(seats[i]); (zones[z] = zones[z] || { sum: 0, n: 0 }); zones[z].sum += l; zones[z].n++;
    }
    var avg = sum / n, sd = Math.sqrt(Math.max(0, sq / n - avg * avg)), cv = avg > 1e-6 ? sd / avg : 0;
    var most = Object.keys(cats).sort(function (a, b) { return cats[b] - cats[a]; })[0];
    var zl = Object.keys(zones).map(function (k) { return { name: k.replace("middle centre", "middle"), avg: zones[k].sum / zones[k].n }; }).sort(function (a, b) { return a.avg - b.avg; });
    var even = avg < 0.04 ? "dark everywhere" : cv < 0.35 ? "even" : cv < 0.7 ? "a little uneven" : "uneven";
    var text = "Most seats: " + most + " · " + even + (avg >= 0.04 && zl.length > 1 && zl[0].avg < avg * 0.6 ? " · darkest at the " + zl[0].name : "");
    return { seats: n, avg: avg, cv: cv, most: most, counts: cats, even: even, darkest: zl[0] && zl[0].name, brightest: zl[zl.length - 1] && zl[zl.length - 1].name, zones: zl, text: text };
  }

  var api = { outline: outline, template: template, layoutSeats: layoutSeats, lightOnSeats: lightOnSeats, summary: summary, inside: inside, bounds: bounds, area: area, lum: lum, stageFront: stageFront };
  root.CURoomMath = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : this);
