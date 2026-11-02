/* Central Control - Lighting: the room around the stage (Room & seats on the 3D stage's bar).
 *  Draw the room's outline from above (or start from a usual shape), set the ceiling and a balcony, say how many
 *  seats there are: they're laid out in rows facing the stage, with aisles, and drawn in 3D. "Light on the seats"
 *  colours each seat by roughly how much light reaches it from the lights as they are now (a scene, a cue, a
 *  rehearsal), with a heat map and a few plain words. A floor plan, a sketch or a photo can go underneath to trace,
 *  with its scale set from one distance you know. The maths is in lights-room-math.js. */
(function () {
  "use strict";
  var L3 = window.CULights3D, X = L3 && L3.ext, RM = window.CURoomMath; if (!X || !RM) return;
  var T = X.T, L = X.L, esc = X.esc;
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function st() { return X.stage(); }
  function hall() { return st().hall; }
  var panel = X.panel("lx3dRoom"), layout = { seats: [], placed: 0, asked: 0 }, seatMesh = null, backMesh = null, levels = null, lastLight = 0, sumText = "", mode = "edit", sel = -1, pend = [], heat = false, lightOn = true;
  var badge = document.createElement("div"); badge.className = "lx3d-seatsum"; badge.hidden = true; X.ui.appendChild(badge);
  try { var pref = JSON.parse(localStorage.getItem("cu-lx3d-room") || "{}"); heat = !!pref.heat; lightOn = pref.light !== false; } catch (_) { }
  function keepPref() { try { localStorage.setItem("cu-lx3d-room", JSON.stringify({ heat: heat, light: lightOn })); } catch (_) { } }

  function newHall(tpl) {
    var t = RM.template(tpl || "rect", st()), h0 = hall() || {};
    return { outline: t.outline, bulges: t.bulges, curved: t.curved, template: tpl || "rect", ceiling: h0.ceiling || 8, balcony: h0.balcony || { on: false, depth: 6, height: 4 }, seats: h0.seats || { count: 300, sections: 3, aisle: 1.2, seatW: 0.55, rowD: 0.95, gap: 2, rows: 0 } };
  }
  function changed() { X.remember(true); L.saveRig(); X.rebuildRoom(); X.frame(); render(); }

  // ------------------------------------------------------------------ 3D: floor, walls, balcony, seats
  var M = {
    floor: new T.MeshStandardMaterial({ color: 0x0f1013, roughness: 0.9, metalness: 0.05, side: T.DoubleSide }),
    wall: new T.MeshStandardMaterial({ color: 0x15171c, roughness: 0.95, transparent: true, opacity: 0.38, depthWrite: false, side: T.DoubleSide }),
    balcony: new T.MeshStandardMaterial({ color: 0x1b1d22, roughness: 0.85 }),
    seat: new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }),
    rail: new T.MeshBasicMaterial({ color: 0xe2c27e, transparent: true, opacity: 0.35 })
  };
  X.roomHooks.push(function (group, s) {
    seatMesh = backMesh = null; levels = null;
    var h = s.hall; if (!h || !h.outline || h.outline.length < 3) { layout = { seats: [], placed: 0, asked: 0 }; badge.hidden = true; return; }
    var poly = RM.outline(h), ceil = clamp(h.ceiling || 8, 3, 30), b = RM.bounds(poly);
    var shape = new T.Shape(); poly.forEach(function (p, i) { if (i) shape.lineTo(p[0], -p[1]); else shape.moveTo(p[0], -p[1]); }); shape.closePath();
    var fl = new T.Mesh(new T.ShapeGeometry(shape), M.floor); fl.rotation.x = -Math.PI / 2; fl.position.y = -0.002; group.add(fl);
    for (var i = 0; i < poly.length; i++) {
      var a = poly[i], c = poly[(i + 1) % poly.length], len = Math.hypot(c[0] - a[0], c[1] - a[1]); if (len < 0.05) continue;
      var w = new T.Mesh(new T.PlaneGeometry(len, ceil), M.wall); w.position.set((a[0] + c[0]) / 2, ceil / 2, (a[1] + c[1]) / 2); w.rotation.y = -Math.atan2(c[1] - a[1], c[0] - a[0]); group.add(w);
    }
    if (h.balcony && h.balcony.on) {
      var bd = clamp(h.balcony.depth || 6, 2, (b.z1 - b.z0) * 0.6), bh = clamp(h.balcony.height || 4, 2, ceil - 1.5), bz0 = b.z1 - bd;
      var slab = new T.Mesh(new T.BoxGeometry(b.x1 - b.x0, 0.3, bd), M.balcony); slab.position.set((b.x0 + b.x1) / 2, bh - 0.15, bz0 + bd / 2); group.add(slab);
      var rail = new T.Mesh(new T.BoxGeometry(b.x1 - b.x0, 0.9, 0.05), M.rail); rail.position.set((b.x0 + b.x1) / 2, bh + 0.45, bz0); group.add(rail);
    }
    layout = RM.layoutSeats(h, s);
    var n = layout.seats.length; if (!n) return;
    var seatG = new T.BoxGeometry(0.48, 0.45, 0.46), backG = new T.BoxGeometry(0.48, 0.5, 0.06);
    seatMesh = new T.InstancedMesh(seatG, M.seat, n); backMesh = new T.InstancedMesh(backG, M.seat, n);
    var m4 = new T.Matrix4(), q = new T.Quaternion(), up = new T.Vector3(0, 1, 0), one = new T.Vector3(1, 1, 1), p = new T.Vector3(), off = new T.Vector3();
    layout.seats.forEach(function (st2, k) {
      q.setFromAxisAngle(up, st2.yaw); p.set(st2.x, (st2.y || 0) + 0.225, st2.z); m4.compose(p, q, one); seatMesh.setMatrixAt(k, m4);
      off.set(0, 0.47, -0.22).applyQuaternion(q); p.set(st2.x + off.x, (st2.y || 0) + off.y, st2.z + off.z); m4.compose(p, q, one); backMesh.setMatrixAt(k, m4);
    });
    var col = new T.Color(0x24272e); for (var j = 0; j < n; j++) { seatMesh.setColorAt(j, col); backMesh.setColorAt(j, col); }
    group.add(seatMesh); group.add(backMesh);
    lastLight = 0;
  });
  // the light on the seats: worked out a few times a second from the lights as they are now
  var cA = new T.Color(), RAMP = [[0, [0.05, 0.08, 0.35]], [0.08, [0.1, 0.4, 0.9]], [0.2, [0.1, 0.8, 0.4]], [0.45, [0.95, 0.85, 0.15]], [0.8, [1, 0.3, 0.1]]];
  function ramp(v) { for (var i = RAMP.length - 1; i >= 0; i--) if (v >= RAMP[i][0]) { var a = RAMP[i], b = RAMP[Math.min(RAMP.length - 1, i + 1)], t = b === a ? 0 : clamp((v - a[0]) / (b[0] - a[0]), 0, 1); return [a[1][0] + (b[1][0] - a[1][0]) * t, a[1][1] + (b[1][1] - a[1][1]) * t, a[1][2] + (b[1][2] - a[1][2]) * t]; } return RAMP[0][1]; }
  X.frameHooks.push(function (now) {
    if (!seatMesh || now - lastLight < Math.max(125, layout.seats.length / 8)) return;   // (fewer times a second for a big room) lastLight = now;
    var seats = layout.seats, n = seats.length;
    levels = RM.lightOnSeats(seats, X.emitList, st());
    for (var i = 0; i < n; i++) {
      var r = levels[i * 3], g = levels[i * 3 + 1], b = levels[i * 3 + 2];
      if (!lightOn) cA.setRGB(0.14, 0.15, 0.18);
      else if (heat) { var c = ramp(RM.lum(levels, i)); cA.setRGB(c[0], c[1], c[2]); }
      else cA.setRGB(clamp(0.1 + r * 1.3, 0, 1.4), clamp(0.105 + g * 1.3, 0, 1.4), clamp(0.12 + b * 1.3, 0, 1.4));
      seatMesh.setColorAt(i, cA); backMesh.setColorAt(i, cA);
    }
    seatMesh.instanceColor.needsUpdate = true; backMesh.instanceColor.needsUpdate = true;
    var s = RM.summary(seats, levels); sumText = s.text; badge.hidden = !lightOn || !n; badge.textContent = (heat ? "Heat map · " : "") + n + " seats · " + s.text;
    var out = panel.querySelector("#lxRoomSum"); if (out) out.textContent = s.text;
  });

  // ------------------------------------------------------------------ the panel: the plan (from above), the room, the seats
  function scaleOf(view) { return view; }
  var V = { x0: 0, z0: 0, k: 20, W: 420, H: 300 };   // the plan's view: metres -> pixels
  function fitView() {
    var h = hall(), pts = (h ? RM.outline(h) : []).slice(), s = st(), tr = s.trace;
    pts.push([-s.width / 2, -s.depth - 0.6], [s.width / 2, 2]);
    if (tr && tr.img && tr.w) { pts.push([tr.x0, tr.z0], [tr.x0 + tr.w * tr.mpp, tr.z0 + tr.h * tr.mpp]); }
    var b = RM.bounds(pts), pad = 1.5, w = b.x1 - b.x0 + pad * 2, d = b.z1 - b.z0 + pad * 2;
    V.k = Math.min(V.W / w, V.H / d); V.x0 = b.x0 - pad - (V.W / V.k - w) / 2; V.z0 = b.z0 - pad - (V.H / V.k - d) / 2;
  }
  function px(x) { return (x - V.x0) * V.k; } function pz(z) { return (z - V.z0) * V.k; }
  function mx(p) { return p / V.k + V.x0; } function mz(p) { return p / V.k + V.z0; }
  function stagePath() {
    var s = st(), W = s.width, D = s.depth, d = "M" + px(-W / 2) + " " + pz(-D) + " L" + px(W / 2) + " " + pz(-D) + " L" + px(W / 2) + " " + pz(0);
    if (s.shape === "thrust") { var tw = s.thrustW || W * 0.4, td = s.thrustD || 2.5; d += " L" + px(tw / 2) + " " + pz(0) + " L" + px(tw / 2) + " " + pz(td) + " L" + px(-tw / 2) + " " + pz(td) + " L" + px(-tw / 2) + " " + pz(0); }
    else if (s.shape === "round") { var ad = s.apronD || W * 0.22; d += " Q" + px(W / 2) + " " + pz(ad * 1.3) + " " + px(0) + " " + pz(ad) + " Q" + px(-W / 2) + " " + pz(ad * 1.3) + " " + px(-W / 2) + " " + pz(0); }
    return d + " L" + px(-W / 2) + " " + pz(0) + " Z";
  }
  function planSvg() {
    fitView(); var h = hall(), s = st(), tr = s.trace, o = "";
    o += '<svg class="lx-plan" viewBox="0 0 ' + V.W + " " + V.H + '" width="' + V.W + '" height="' + V.H + '" data-mode="' + mode + '">';
    o += '<rect width="' + V.W + '" height="' + V.H + '" fill="#0b0c0f"/>';
    if (tr && tr.img && tr.on !== false) o += '<image href="' + tr.img + '" x="' + px(tr.x0) + '" y="' + pz(tr.z0) + '" width="' + tr.w * tr.mpp * V.k + '" height="' + tr.h * tr.mpp * V.k + '" opacity="' + (tr.opacity == null ? 0.5 : tr.opacity) + '" preserveAspectRatio="none" data-trace="1"/>';
    var g = X.units() === "ft" ? 0.3048 * 5 : 1; for (var gx = Math.ceil(V.x0 / g) * g; gx < mx(V.W); gx += g) o += '<line x1="' + px(gx) + '" y1="0" x2="' + px(gx) + '" y2="' + V.H + '" stroke="#ffffff" stroke-opacity="0.04"/>';
    for (var gz = Math.ceil(V.z0 / g) * g; gz < mz(V.H); gz += g) o += '<line x1="0" y1="' + pz(gz) + '" x2="' + V.W + '" y2="' + pz(gz) + '" stroke="#ffffff" stroke-opacity="0.04"/>';
    if (h && h.outline && h.outline.length >= 3) {
      var poly = RM.outline(h); o += '<polygon points="' + poly.map(function (p) { return px(p[0]) + "," + pz(p[1]); }).join(" ") + '" fill="#1a1d24" fill-opacity="0.55" stroke="#9aa4b4" stroke-width="2"/>';
      layout.seats.forEach(function (p, k) { if (k % (layout.seats.length > 1500 ? 3 : 1)) return; o += '<rect x="' + (px(p.x) - 1.5) + '" y="' + (pz(p.z) - 1.5) + '" width="3" height="3" fill="' + (p.bal ? "#7a8fb0" : "#59606e") + '"/>'; });
      if (mode === "edit") h.outline.forEach(function (p, i) {
        var q = h.outline[(i + 1) % h.outline.length];
        o += '<circle class="lx-mid" cx="' + px((p[0] + q[0]) / 2) + '" cy="' + pz((p[1] + q[1]) / 2) + '" r="5" data-mid="' + i + '"><title>Add a corner here</title></circle>';
      });
      if (mode === "edit") h.outline.forEach(function (p, i) { o += '<circle class="lx-corner' + (i === sel ? " sel" : "") + '" cx="' + px(p[0]) + '" cy="' + pz(p[1]) + '" r="7" data-corner="' + i + '"/>'; });
    }
    o += '<path d="' + stagePath() + '" fill="#2a2f3a" stroke="#e2c27e" stroke-width="1.5"/><text x="' + px(0) + '" y="' + pz(-s.depth / 2) + '" fill="#e2c27e" font-size="11" text-anchor="middle">Stage</text>';
    if (pend.length) o += '<polyline points="' + pend.map(function (p) { return px(p[0]) + "," + pz(p[1]); }).join(" ") + '" fill="none" stroke="#e2c27e" stroke-dasharray="4 3" stroke-width="2"/>' + pend.map(function (p) { return '<circle cx="' + px(p[0]) + '" cy="' + pz(p[1]) + '" r="4" fill="#e2c27e"/>'; }).join("");
    return o + "</svg>";
  }
  var HINT = { edit: "Drag a corner to move it, click a + to add a corner. Pick a corner to curve the wall after it or remove it.", draw: "Click each corner of the room in turn, then Done.", scale: "Click the two ends of something you know the length of.", stage: "Click the stage's front-left corner, its front-right corner, then a point on its back edge.", move: "Drag the picture to line it up with the stage." };
  function render() {
    if (panel.hidden) return;
    var h = hall(), s = st(), u = X.units(), tr = s.trace, sc = h && h.seats || {};
    if (!h) { panel.innerHTML = '<div class="lx3d-ph"><b>Room &amp; seats</b><button class="mini" data-rm="close" aria-label="Close">✕</button></div><p class="muted small">Draw the room around the stage, then say how many seats there are. Start from the shape closest to yours:</p><div class="lx3d-aims">' + tplButtons() + "</div>"; return; }
    var fitMsg = layout.asked ? (layout.placed >= layout.asked ? "All " + layout.placed + " seats fit (" + layout.rows + " rows" + (layout.balconyRows ? " + " + layout.balconyRows + " in the balcony" : "") + ")." : "Only " + layout.placed + " of " + layout.asked + " seats fit. Make the room bigger, the rows closer, or add a balcony.") : "";
    panel.innerHTML = '<div class="lx3d-ph"><b>Room &amp; seats</b><button class="mini" data-rm="close" aria-label="Close">✕</button></div>' +
      '<div class="lx-planwrap">' + planSvg() + '</div><p class="muted small" id="lxPlanHint">' + esc(HINT[mode] || "") + "</p>" +
      '<div class="lx3d-aims">' + (mode === "edit" ? '<button data-rm="draw">Draw the room</button>' : '<button data-rm="done" class="primary">Done</button>') + tplButtons() + "</div>" +
      (sel >= 0 && mode === "edit" ? '<div class="lx3d-row"><label>Curve the wall after corner ' + (sel + 1) + '<input type="range" min="-0.3" max="0.3" step="0.02" data-rf="bulge" value="' + ((h.bulges || [])[sel] || 0) + '"></label><button class="mini" data-rm="del-corner"' + (h.outline.length <= 3 ? " disabled" : "") + ">Remove this corner</button></div>" : "") +
      '<details class="lx3d-trace"' + (tr ? " open" : "") + '><summary>Trace a floor plan or photo</summary><div class="lx3d-row"><button data-rm="trace-open">' + (tr ? "Another picture…" : "Pick a picture…") + '</button><input type="file" accept="image/*" data-rm-file hidden>' +
      (tr ? '<label class="toggle"><input type="checkbox" data-rf="trace-on"' + (tr.on !== false ? " checked" : "") + '> Show it</label><label>Fade<input type="range" min="0.05" max="1" step="0.05" data-rf="trace-op" value="' + (tr.opacity == null ? 0.5 : tr.opacity) + '"></label></div><div class="lx3d-aims"><button data-rm="scale">Set the scale</button><button data-rm="trace-stage">Trace the stage</button><button data-rm="draw">Trace the walls</button><button data-rm="move">Move the picture</button><button data-rm="trace-del">Remove it</button></div>' + (tr.mpp ? '<p class="muted small">Scale: 100 px = ' + X.toU(tr.mpp * 100, 1) + " " + u + "</p>" : "") : "</div>") +
      '<div class="lx3d-row" id="lxScaleAsk" hidden><label>That distance is (' + u + ')<input type="number" step="0.1" min="0.1" data-rf="scale-d"></label><button class="mini" data-rm="scale-ok">Use it</button></div></details>' +
      '<div class="lx3d-row"><label>Ceiling (' + u + ")" + X.num('rf="ceiling"', h.ceiling || 8, { min: 3 }) + '</label><label class="toggle"><input type="checkbox" data-rf="bal-on"' + (h.balcony && h.balcony.on ? " checked" : "") + "> A balcony</label>" +
      (h.balcony && h.balcony.on ? "<label>Balcony depth (" + u + ")" + X.num('rf="bal-depth"', h.balcony.depth || 6, { min: 2 }) + "</label><label>Balcony height (" + u + ")" + X.num('rf="bal-height"', h.balcony.height || 4, { min: 2 }) + "</label>" : "") + "</div>" +
      '<b class="small">Seats</b><div class="lx3d-row"><label>How many seats<input type="number" min="0" max="20000" step="10" data-rf="count" value="' + (sc.count || 0) + '"></label><label title="0: as many as it takes">Rows (0 = as needed)<input type="number" min="0" max="200" data-rf="rows" value="' + (sc.rows || 0) + '"></label><label>Sections<input type="number" min="1" max="8" data-rf="sections" value="' + (sc.sections || 3) + '"></label></div>' +
      '<div class="lx3d-row"><label>Aisles (' + u + ")" + X.num('rf="aisle"', sc.aisle == null ? 1.2 : sc.aisle) + "</label><label>Seat width (" + u + ")" + X.num('rf="seatW"', sc.seatW || 0.55, { step: u === "ft" ? 0.1 : 0.05 }) + "</label><label>Row to row (" + u + ")" + X.num('rf="rowD"', sc.rowD || 0.95, { step: u === "ft" ? 0.1 : 0.05 }) + "</label><label>Gap at the stage (" + u + ")" + X.num('rf="gap"', sc.gap == null ? 2 : sc.gap) + "</label></div>" +
      '<div class="lx3d-row"><label>Rows<select data-rf="curved"><option value="auto"' + (sc.curved == null ? " selected" : "") + '>Usual for this shape</option><option value="1"' + (sc.curved === true ? " selected" : "") + '>Curved round the stage</option><option value="0"' + (sc.curved === false ? " selected" : "") + ">Straight</option></select></label></div>" +
      '<p class="small ' + (layout.placed < layout.asked ? "lx-warn" : "muted") + '" id="lxRoomFit">' + esc(fitMsg) + "</p>" +
      '<b class="small">Light on the seats</b><div class="lx3d-row"><label class="toggle"><input type="checkbox" data-rf="light"' + (lightOn ? " checked" : "") + '> Show it on the seats</label><label class="toggle"><input type="checkbox" data-rf="heat"' + (heat ? " checked" : "") + '> As a heat map</label></div><p class="small" id="lxRoomSum">' + esc(sumText) + "</p>" +
      '<div class="lx3d-row"><button data-rm="remove" class="danger">Remove the room</button></div>';
  }
  function tplButtons() { return [["rect", "Rectangle"], ["fan", "Fan"], ["rounded", "Rounded back"], ["wide", "Wide and shallow"]].map(function (t) { return '<button data-rm="tpl" data-tpl="' + t[0] + '">' + t[1] + "</button>"; }).join(""); }
  function open(on) {
    panel.hidden = on == null ? !panel.hidden : !on;
    if (!panel.hidden) { X.closeOthers("room"); X.roomy(); render(); }
  }
  X.selectHooks.push(function (keep) { if (keep !== "room" && !panel.hidden && keep !== undefined) { panel.hidden = true; } });
  X.barButton("room", "Room & seats", "Draw the room, the seats and see the light on them", function () { open(); });

  // ------------------------------------------------------------------ plan clicks and drags
  function planPoint(e) { var svg = panel.querySelector(".lx-plan"); if (!svg) return null; var r = svg.getBoundingClientRect(); return [mx((e.clientX - r.left) * V.W / r.width), mz((e.clientY - r.top) * V.H / r.height)]; }
  var pdrag = null;
  panel.addEventListener("pointerdown", function (e) {
    var svg = e.target.closest(".lx-plan"); if (!svg) return; var p = planPoint(e), h = hall(); if (!p) return;
    var c = e.target.getAttribute("data-corner"), m = e.target.getAttribute("data-mid");
    if (mode === "edit" && c != null) { sel = Number(c); X.remember(true); pdrag = { kind: "corner", i: sel }; svg.setPointerCapture(e.pointerId); render(); return; }
    if (mode === "edit" && m != null) { X.remember(true); var i = Number(m), a = h.outline[i], b = h.outline[(i + 1) % h.outline.length]; h.outline.splice(i + 1, 0, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]); (h.bulges = h.bulges || []).splice(i + 1, 0, 0); sel = i + 1; L.saveRig(); X.rebuildRoom(); X.frame(); render(); return; }
    if (mode === "draw" || mode === "stage" || mode === "scale") { pend.push([X.snapV(p[0]), X.snapV(p[1])]); afterClick(); return; }
    if (mode === "move" && st().trace) { pdrag = { kind: "trace", from: [st().trace.x0, st().trace.z0], start: p }; svg.setPointerCapture(e.pointerId); }
  });
  panel.addEventListener("pointermove", function (e) {
    if (!pdrag) return; var p = planPoint(e); if (!p) return; var h = hall();
    if (pdrag.kind === "corner") { h.outline[pdrag.i] = [X.snapV(p[0]), X.snapV(p[1])]; var svg = panel.querySelector(".lx-plan"); var k0 = V.k, x0 = V.x0, z0 = V.z0; svg.outerHTML = planSvg(); V.k = k0; V.x0 = x0; V.z0 = z0; }
    else if (pdrag.kind === "trace") { var t = st().trace; t.x0 = pdrag.from[0] + p[0] - pdrag.start[0]; t.z0 = pdrag.from[1] + p[1] - pdrag.start[1]; var svg2 = panel.querySelector(".lx-plan"); svg2.outerHTML = planSvg(); }
  });
  panel.addEventListener("pointerup", function () { if (!pdrag) return; pdrag = null; L.saveRig(); X.rebuildRoom(); X.frame(); render(); });
  function afterClick() {
    var s = st();
    if (mode === "stage" && pend.length === 3) {   // front-left, front-right, a point on the back edge: the stage's size, and the picture moved so the stage sits where it is in the room
      var fl = pend[0], fr = pend[1], bk = pend[2], W = Math.hypot(fr[0] - fl[0], fr[1] - fl[1]), dx = (fr[0] - fl[0]) / W, dz = (fr[1] - fl[1]) / W, D = Math.abs((bk[0] - fl[0]) * dz - (bk[1] - fl[1]) * dx);
      X.remember(true); s.width = Math.round(W * 4) / 4; s.depth = Math.round(D * 4) / 4;
      var cx = (fl[0] + fr[0]) / 2, cz = (fl[1] + fr[1]) / 2; if (s.trace) { s.trace.x0 -= cx; s.trace.z0 -= cz; }
      if (hall()) hall().outline = hall().outline.map(function (p) { return [p[0] - cx, p[1] - cz]; });
      pend = []; mode = "edit"; L.saveRig(); X.rebuildRoom(); X.rebuildFixtures(); X.frame(); render(); return;
    }
    if (mode === "scale" && pend.length === 2) { var ask = panel.querySelector("#lxScaleAsk"); if (ask) { ask.hidden = false; var inp = ask.querySelector("input"); if (inp) inp.focus(); } }
    var svg = panel.querySelector(".lx-plan"); if (svg) { var k0 = V.k, x0 = V.x0, z0 = V.z0; svg.outerHTML = planSvg(); V.k = k0; V.x0 = x0; V.z0 = z0; }
  }
  panel.addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b || !b.dataset.rm) return; var a = b.dataset.rm, h = hall(), s = st();
    if (a === "close") { panel.hidden = true; return; }
    if (a === "tpl") { X.remember(true); var nh = newHall(b.dataset.tpl); if (h) { nh.ceiling = h.ceiling; nh.balcony = h.balcony; nh.seats = h.seats; } s.hall = nh; sel = -1; mode = "edit"; changed(); return; }
    if (a === "draw") { mode = "draw"; pend = []; render(); return; }
    if (a === "done") {
      if (mode === "draw" && pend.length >= 3) { X.remember(true); if (!s.hall) s.hall = newHall("rect"); s.hall.outline = pend.slice(); s.hall.bulges = pend.map(function () { return 0; }); s.hall.template = "drawn"; }
      mode = "edit"; pend = []; changed(); return;
    }
    if (a === "del-corner" && h && h.outline.length > 3 && sel >= 0) { X.remember(true); h.outline.splice(sel, 1); (h.bulges || []).splice(sel, 1); sel = -1; changed(); return; }
    if (a === "remove") { if (!confirm("Remove the room and its seats? (The stage and the lights stay.)")) return; X.remember(true); delete s.hall; changed(); return; }
    if (a === "trace-open") { panel.querySelector("[data-rm-file]").click(); return; }
    if (a === "scale") { mode = "scale"; pend = []; render(); return; }
    if (a === "scale-ok") { var d = X.fromU(panel.querySelector('[data-rf="scale-d"]').value); if (pend.length === 2 && d > 0 && s.trace) { var pxLen = Math.hypot(pend[1][0] - pend[0][0], pend[1][1] - pend[0][1]) / s.trace.mpp; X.remember(true); var old = s.trace.mpp; s.trace.mpp = d / Math.max(1e-6, pxLen); s.trace.x0 = pend[0][0] - (pend[0][0] - s.trace.x0) * s.trace.mpp / old; s.trace.z0 = pend[0][1] - (pend[0][1] - s.trace.z0) * s.trace.mpp / old; } pend = []; mode = "edit"; L.saveRig(); render(); return; }
    if (a === "trace-stage") { mode = "stage"; pend = []; render(); return; }
    if (a === "move") { mode = "move"; render(); return; }
    if (a === "trace-del") { X.remember(true); delete s.trace; mode = "edit"; L.saveRig(); render(); return; }
  });
  panel.addEventListener("change", function (e) {
    if (!e.target.hasAttribute("data-rm-file")) return; var f = e.target.files && e.target.files[0]; if (!f) return;
    loadTrace(f).then(render).catch(function (err) { alert("Could not open that picture: " + err.message); });
  });
  // a picture to trace: made smaller (it's kept with the stage), first shown 20 m (about 65 ft) wide until the scale is set
  function loadTrace(file) {
    return new Promise(function (res, rej) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
        var s = st(), mpp = 20 / c.width; X.remember(true);
        s.trace = { img: c.toDataURL("image/jpeg", 0.8), w: c.width, h: c.height, mpp: mpp, x0: -c.width * mpp / 2, z0: -s.depth - 1, opacity: 0.5, on: true };
        if (!s.hall) s.hall = newHall("rect");
        L.saveRig(); res();
      };
      img.onerror = function () { rej(new Error("not a picture")); }; img.src = url;
    });
  }
  panel.addEventListener("input", function (e) {
    var k = e.target.dataset.rf; if (!k) return; var h = hall(), s = st(), v = e.target.value; if (!h && k !== "light" && k !== "heat") return;
    if (k === "light") { lightOn = e.target.checked; keepPref(); lastLight = 0; X.frame(); return; }
    if (k === "heat") { heat = e.target.checked; keepPref(); lastLight = 0; X.frame(); return; }
    if (k === "trace-on") { s.trace.on = e.target.checked; L.saveRig(); render(); return; }
    if (k === "trace-op") { s.trace.opacity = Number(v); var im = panel.querySelector("[data-trace]"); if (im) im.setAttribute("opacity", v); L.saveRig(); return; }
    if (k === "scale-d") return;
    X.remember();
    if (k === "bulge") { h.bulges = h.bulges || h.outline.map(function () { return 0; }); h.bulges[sel] = Number(v); }
    else if (k === "ceiling") h.ceiling = X.fromU(v);
    else if (k === "bal-on") { h.balcony = Object.assign({ depth: 6, height: 4 }, h.balcony, { on: e.target.checked }); }
    else if (k === "bal-depth" || k === "bal-height") { h.balcony[k.slice(4)] = X.fromU(v); }
    else { h.seats = h.seats || {}; if (k === "curved") { if (v === "auto") delete h.seats.curved; else h.seats.curved = v === "1"; } else if (k === "count" || k === "rows" || k === "sections") h.seats[k] = Math.max(0, Math.round(Number(v) || 0)); else h.seats[k] = X.fromU(v); }
    L.saveRig(); X.rebuildRoom(); X.frame();
    var structural = k === "bal-on" || k === "curved"; if (structural) render(); else updateFit();
  });
  function updateFit() {
    var el = panel.querySelector("#lxRoomFit"); if (!el) return;
    el.textContent = layout.asked ? (layout.placed >= layout.asked ? "All " + layout.placed + " seats fit (" + layout.rows + " rows" + (layout.balconyRows ? " + " + layout.balconyRows + " in the balcony" : "") + ")." : "Only " + layout.placed + " of " + layout.asked + " seats fit. Make the room bigger, the rows closer, or add a balcony.") : "";
    el.className = "small " + (layout.placed < layout.asked ? "lx-warn" : "muted");
    var svg = panel.querySelector(".lx-plan"); if (svg) svg.outerHTML = planSvg();
  }
  X.roomPanel = { open: open, render: render, newHall: newHall, loadTrace: loadTrace };
  window.CULightsRoom = { layout: function () { return layout; }, levels: function () { return levels; }, summary: function () { return levels ? RM.summary(layout.seats, levels) : null; }, open: open, newHall: newHall, setHeat: function (on) { heat = !!on; lastLight = 0; }, setLight: function (on) { lightOn = !!on; lastLight = 0; }, loadTrace: loadTrace, mode: function (m) { if (m) { mode = m; pend = []; render(); } return mode; }, planClick: function (x, z) { pend.push([x, z]); afterClick(); }, pending: function () { return pend.slice(); } };
})();
