/* Central Control - Lighting: screens and projectors on the 3D stage.
 *  "+ Screen" adds an LED wall, a TV or a projection screen; "+ Projector" adds a projector aimed at a projection
 *  screen or the back wall, with its beam through the haze. Each one shows, live, what a real output shows (the
 *  Video tab's Main or Stream, the Slides & lyrics screen, the Central Pedal's HDMI 1 or 2): change what's on that
 *  output (a camera, the slides, the lyrics on their background) and it changes here too. The pictures come from
 *  screen-feed.js. Screens and projectors are kept with the stage (and in the rig file). */
(function () {
  "use strict";
  var L3 = window.CULights3D, X = L3 && L3.ext, F = window.CUScreenFeed; if (!X || !F) return;
  var T = X.T, L = X.L, esc = X.esc, CU = window.CentralUsage;
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function st() { return X.stage(); }
  var D2R = Math.PI / 180, group = new T.Group(); X.scene.add(group);
  var objs = {}, key = "", texs = {}, wanted = {}, selId = null, panel = X.panel("lx3dScreenPanel");
  var KINDS = [["led", "LED wall"], ["tv", "TV"], ["projection", "Projection screen"]], ASPECTS = [["16:9", 16 / 9], ["4:3", 4 / 3], ["21:9", 21 / 9], ["1:1", 1]];
  function screens() { var s = st(); if (!Array.isArray(s.screens)) s.screens = []; return s.screens; }
  function projectors() { var s = st(); if (!Array.isArray(s.projectors)) s.projectors = []; return s.projectors; }
  function byId(id) { return screens().filter(function (x) { return x.id === id; })[0] || projectors().filter(function (x) { return x.id === id; })[0] || null; }
  function isProj(o) { return projectors().indexOf(o) >= 0; }
  // (the one screen of 10.1, on the back wall, becomes an LED wall here)
  (function migrate() { var s = st(); if (s.screen && s.screen.on && !(s.screens && s.screens.length)) { s.screens = [{ id: X.uid(), name: "Back wall screen", kind: "led", w: s.screen.w || s.width * 0.5, aspect: "16:9", x: s.screen.x || 0, y: s.screen.y != null ? s.screen.y : Math.max(0, s.deck) + 2.2, z: -s.depth - 0.5, yaw: 0, link: "slides" }]; s.screen.on = false; L.saveRig(); X.rebuildRoom(); } })();
  function heightOf(o) { var a = (ASPECTS.filter(function (x) { return x[0] === o.aspect; })[0] || ASPECTS[0])[1]; return o.aspect === "custom" ? (o.h || o.w * 9 / 16) : o.w / a; }
  function projFor(scr) { return projectors().filter(function (p) { return p.target === scr.id; })[0] || null; }
  function linkOf(o) { if (o.kind === "projection") { var p = projFor(o); return p ? p.link : null; } return o.link; }

  // ------------------------------------------------------------------ the pictures (one texture per output, shared)
  function tex(link) {
    var t = texs[link]; if (t) return t;
    var c = F.canvas(link); t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; t.userData.ver = -1; t.userData.link = link; texs[link] = t; return t;
  }
  function syncWants() {
    var need = {};
    screens().forEach(function (s) { var l = linkOf(s); if (l) need[l] = 1; });
    projectors().forEach(function (p) { if (p.link) need[p.link] = 1; });
    Object.keys(need).forEach(function (l) { if (!wanted[l]) { wanted[l] = 1; F.want(l, true); } });
    Object.keys(wanted).forEach(function (l) { if (!need[l]) { delete wanted[l]; F.want(l, false); } });
  }
  var avgC = document.createElement("canvas"); avgC.width = avgC.height = 4; var avgG = avgC.getContext("2d", { willReadFrequently: true });
  function avgColour(c) { avgG.drawImage(c, 0, 0, 4, 4); var d = avgG.getImageData(0, 0, 4, 4).data, r = 0, g = 0, b = 0; for (var i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; } return [r / 16 / 255, g / 16 / 255, b / 16 / 255]; }

  // ------------------------------------------------------------------ building them in 3D
  var MB = { frame: new T.MeshStandardMaterial({ color: 0x050608, roughness: 0.55, metalness: 0.2 }), body: new T.MeshStandardMaterial({ color: 0x23262d, roughness: 0.5, metalness: 0.35 }), dark: new T.MeshBasicMaterial({ color: 0x1b1c1f }), sel: new T.MeshBasicMaterial({ color: 0xe2c27e, wireframe: true, transparent: true, opacity: 0.85 }) };
  function faceMat(link, k) { if (!link) return MB.dark; var m = new T.MeshBasicMaterial({ map: tex(link), toneMapped: false }); m.color.setScalar(k == null ? 1 : k); return m; }
  function keystone(geo, k) {   // a projector tilted at a screen: the picture's top is wider or narrower (k -0.3 .. 0.3)
    var uv = geo.attributes.uv; if (!k) return geo;
    for (var i = 0; i < uv.count; i++) { var u = uv.getX(i), v = uv.getY(i), s = 1 + k * (v - 0.5) * 2; uv.setX(i, 0.5 + (u - 0.5) * s); }
    uv.needsUpdate = true; return geo;
  }
  function clear() { while (group.children.length) { var c = group.children.pop(); c.traverse(function (o) { if (o.geometry) o.geometry.dispose(); if (o.material && o.material.map === undefined && o.material !== MB.frame && o.material !== MB.body && o.material !== MB.dark && o.material !== MB.sel && o.material.dispose) o.material.dispose(); }); } objs = {}; X.pickables = X.pickables.filter(function (p) { return p.owner !== "screens"; }); }
  function screenCentre(s) { var h = heightOf(s); return new T.Vector3(s.x || 0, (s.y || 0) + h / 2, s.z || 0); }
  function wallRect(p) { var w = clamp(p.wallW || 4, 0.5, 20), h = w * 9 / 16; return { x: p.wallX != null ? p.wallX : p.x || 0, y: p.wallY != null ? p.wallY : Math.max(0, st().deck) + 1.6 + h / 2, z: -st().depth - 0.585, w: w, h: h }; }
  function build() {
    clear(); syncWants();
    screens().forEach(function (s) {
      var g = new T.Group(), w = clamp(s.w || 4, 0.3, 40), h = heightOf(s), link = linkOf(s), p = s.kind === "projection" ? projFor(s) : null;
      var fr = s.kind === "tv" ? 0.04 : s.kind === "led" ? 0.06 : 0.1, depth = s.kind === "tv" ? 0.06 : s.kind === "led" ? 0.12 : 0.03;
      var frame = new T.Mesh(new T.BoxGeometry(w + fr * 2, h + fr * 2, depth), s.kind === "projection" ? new T.MeshStandardMaterial({ color: 0x0d0e10, roughness: 0.8 }) : MB.frame); frame.position.z = -depth / 2 - 0.005; g.add(frame);
      var faceGeo = new T.PlaneGeometry(w, h); if (p) keystone(faceGeo, p.keystone || 0);
      var face = new T.Mesh(faceGeo, s.kind === "projection" ? (link ? faceMat(link, 0.25 + 0.75 * clamp(p.bright == null ? 0.8 : p.bright, 0, 1)) : new T.MeshStandardMaterial({ color: 0xb8bcc4, roughness: 0.95 })) : faceMat(link, s.kind === "led" ? 1 : 0.92));
      g.add(face);
      if (s.kind === "tv" && (s.y || 0) < 1.3) { var stand = new T.Mesh(new T.BoxGeometry(0.06, Math.max(0.05, s.y || 0.8), 0.06), MB.body); stand.position.set(0, -h / 2 - (s.y || 0.8) / 2, -0.05); g.add(stand); }
      var sel = new T.Mesh(new T.BoxGeometry(w + 0.3, h + 0.3, 0.3), MB.sel); sel.visible = s.id === selId; g.add(sel);
      g.position.copy(screenCentre(s)); g.rotation.y = (s.yaw || 0) * D2R;
      g.userData.ext = extFor(s); group.add(g); X.pickables.push({ obj: g, owner: "screens" }); objs[s.id] = { g: g, face: face, sel: sel, link: link };
    });
    projectors().forEach(function (p) {
      var g = new T.Group(), body = new T.Mesh(new T.BoxGeometry(0.42, 0.18, 0.36), MB.body), lens = new T.Mesh(new T.CircleGeometry(0.05, 16), new T.MeshBasicMaterial({ color: 0xffffff }));
      g.add(body); g.position.set(p.x || 0, p.y || 5, p.z || 4);
      var sel = new T.Mesh(new T.BoxGeometry(0.6, 0.35, 0.55), MB.sel); sel.visible = p.id === selId; g.add(sel);
      // where it shines: a projection screen's corners, or a picture on the back wall
      var corners = null, scr = p.target && p.target !== "wall" ? screens().filter(function (s) { return s.id === p.target; })[0] : null, wallFace = null;
      if (scr) { var c = screenCentre(scr), w2 = (scr.w || 4) / 2, h2 = heightOf(scr) / 2, yaw = (scr.yaw || 0) * D2R, ax = new T.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)); corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(function (q) { return c.clone().addScaledVector(ax, q[0] * w2).add(new T.Vector3(0, q[1] * h2, 0)); }); }
      else if (p.target === "wall") {
        var wr = wallRect(p); corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(function (q) { return new T.Vector3(wr.x + q[0] * wr.w / 2, wr.y + q[1] * wr.h / 2, wr.z); });
        if (p.link) { var wg = keystone(new T.PlaneGeometry(wr.w, wr.h), p.keystone || 0); wallFace = new T.Mesh(wg, new T.MeshBasicMaterial({ map: tex(p.link), toneMapped: false, transparent: true, opacity: 0.35 + 0.6 * clamp(p.bright == null ? 0.8 : p.bright, 0, 1), blending: T.AdditiveBlending, depthWrite: false })); wallFace.position.set(wr.x, wr.y, wr.z); group.add(wallFace); }
      }
      var beam = null;
      if (corners) {
        var o = g.position.clone(), pos = []; for (var i = 0; i < 4; i++) { var a = corners[i], b = corners[(i + 1) % 4]; pos.push(o.x, o.y, o.z, a.x, a.y, a.z, b.x, b.y, b.z); }
        var bg = new T.BufferGeometry(); bg.setAttribute("position", new T.Float32BufferAttribute(pos, 3)); bg.computeVertexNormals();
        beam = new T.Mesh(bg, new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.05, blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide, toneMapped: false })); beam.frustumCulled = false; group.add(beam);
        var mid = corners.reduce(function (s2, v) { return s2.add(v); }, new T.Vector3()).multiplyScalar(0.25); g.lookAt(mid);
      }
      lens.position.set(0, 0, 0.181); g.add(lens);
      g.userData.ext = extFor(p); group.add(g); X.pickables.push({ obj: g, owner: "screens" }); objs[p.id] = { g: g, sel: sel, beam: beam, wallFace: wallFace, link: p.link, proj: p };
    });
  }
  function paintSel() { Object.keys(objs).forEach(function (id) { if (objs[id].sel) objs[id].sel.visible = id === selId; }); }
  function extFor(o) {
    return {
      select: function () { selId = o.id; paintSel(); openPanel(); X.frame(); },
      y: function () { return isProj(o) ? (o.y || 5) : 0; },
      from: function () { return { x: o.x || 0, z: o.z || 0 }; },
      drag: function (dx, dz, from) { if (!dragged) { X.remember(true); dragged = true; } o.x = X.snapV(from.x + dx); o.z = X.snapV(from.z + dz); key = ""; renderValues(); },
      end: function () { dragged = false; L.saveRig(); key = ""; }
    };
  }
  var dragged = false;
  X.frameHooks.push(function () {
    var k = JSON.stringify([screens(), projectors(), st().depth, st().deck, st().width]); if (k !== key) { key = k; build(); }
    var haze = X.hazeNow == null ? 0.5 : X.hazeNow;
    Object.keys(texs).forEach(function (l) { var t = texs[l], c = t.image; if (c.ver !== t.userData.ver) { t.userData.ver = c.ver; t.needsUpdate = true; t.userData.avg = avgColour(c); } });
    Object.keys(objs).forEach(function (id) {
      var o = objs[id]; if (!o.beam) return; var p = o.proj, avg = (p.link && texs[p.link] && texs[p.link].userData.avg) || [0.2, 0.2, 0.2], k = clamp(p.bright == null ? 0.8 : p.bright, 0, 1);
      o.beam.material.color.setRGB(0.3 + avg[0], 0.3 + avg[1], 0.3 + avg[2]); o.beam.material.opacity = p.link ? k * (0.02 + 0.12 * haze) : 0;
    });
  });

  // ------------------------------------------------------------------ adding, the panel
  function addScreen(kind) {
    var s = st(), D = s.depth, deck = Math.max(0, s.deck), n = screens().length; X.remember(true);
    var o = { id: X.uid(), name: kind === "tv" ? "TV " + (n + 1) : kind === "projection" ? "Projection screen " + (n + 1) : n ? "Screen " + (n + 1) : "LED wall", kind: kind || "led", w: kind === "tv" ? 1.45 : Math.min(6, Math.round(s.width * 0.5 * 2) / 2), aspect: "16:9", x: n ? (n % 2 ? 1 : -1) * Math.min(s.width / 2 + 1.5, 8) : 0, y: kind === "tv" ? 1.5 : deck + 1.8, z: n ? -D * 0.2 : -D - 0.5, yaw: n ? (n % 2 ? -25 : 25) : 0, link: n ? "slides" : "slides" };
    screens().push(o); L.saveRig(); key = ""; selId = o.id; X.frame(); openPanel(); return o;
  }
  function addProjector() {
    var s = st(), D = s.depth; X.remember(true);
    var target = screens().filter(function (x) { return x.kind === "projection" && !projFor(x); })[0];
    var o = { id: X.uid(), name: "Projector " + (projectors().length + 1), x: target ? target.x || 0 : 0, y: Math.max(4.5, ((s.trusses || [])[0] || {}).h || 5), z: Math.min(6, Math.max(3, (s.room || 14) * 0.3)), target: target ? target.id : "wall", link: target ? "slides" : "main", bright: 0.8, keystone: 0, wallW: Math.min(6, s.width * 0.5) };
    projectors().push(o); L.saveRig(); key = ""; selId = o.id; X.frame(); openPanel(); return o;
  }
  function linkOptions(sel, none) { return (none ? '<option value=""' + (!sel ? " selected" : "") + ">" + esc(none) + "</option>" : "") + F.links().filter(function (l) { return l.id !== "none"; }).map(function (l) { return '<option value="' + l.id + '"' + (l.id === sel ? " selected" : "") + ">" + esc(l.name) + "</option>"; }).join("") + '<option value="none"' + (sel === "none" ? " selected" : "") + ">Nothing (off)</option>"; }
  function openPanel() {
    var o = selId && byId(selId); X.closeOthers("screen"); if (!o) { panel.hidden = true; return; }
    panel.hidden = false; X.roomy(); var u = X.units(), num = X.num;
    if (isProj(o)) {
      var tgts = screens().filter(function (s) { return s.kind === "projection"; });
      panel.innerHTML = '<div class="lx3d-ph"><b>' + esc(o.name) + '</b><span class="muted small">projector</span><button class="mini" data-sc="close" aria-label="Close">✕</button></div>' +
        '<label>Name<input data-sp="name" value="' + esc(o.name) + '"></label>' +
        '<div class="lx3d-row"><label>Shines on<select data-sp="target">' + tgts.map(function (s) { return '<option value="' + s.id + '"' + (o.target === s.id ? " selected" : "") + ">" + esc(s.name) + "</option>"; }).join("") + '<option value="wall"' + (o.target === "wall" ? " selected" : "") + '>The back wall</option></select></label><label>Shows<select data-sp="link">' + linkOptions(o.link) + "</select></label></div>" +
        (tgts.length ? "" : '<p class="muted small">Add a projection screen to aim it at one (+ Screen, then set Kind to Projection screen).</p>') +
        '<div class="lx3d-row"><label>Brightness<input type="range" min="0.1" max="1" step="0.05" data-sp="bright" value="' + (o.bright == null ? 0.8 : o.bright) + '"></label><label title="Make the picture\'s top narrower or wider, as a tilted projector does">Keystone<input type="range" min="-0.3" max="0.3" step="0.02" data-sp="keystone" value="' + (o.keystone || 0) + '"></label></div>' +
        (o.target === "wall" ? '<div class="lx3d-row"><label>Picture width (' + u + ")" + num('sp="wallW"', o.wallW || 4, { min: 0.5 }) + "</label></div>" : "") +
        '<div class="lx3d-row"><label>Across (' + u + ")" + num('sp="x"', o.x || 0) + '</label><label>From the front edge (' + u + ")" + num('sp="z"', -(o.z || 0)) + '</label><label>Height (' + u + ")" + num('sp="y"', o.y || 5, { min: 0 }) + "</label></div>" +
        '<p class="muted small" id="lxScrNote">' + esc(noteFor(o.link)) + '</p><div class="lx3d-row"><button data-sc="del" class="danger">Remove</button></div>';
    } else {
      var p = o.kind === "projection" ? projFor(o) : null;
      panel.innerHTML = '<div class="lx3d-ph"><b>' + esc(o.name) + '</b><span class="muted small">' + esc((KINDS.filter(function (k) { return k[0] === o.kind; })[0] || KINDS[0])[1]) + '</span><button class="mini" data-sc="close" aria-label="Close">✕</button></div>' +
        '<label>Name<input data-sp="name" value="' + esc(o.name) + '"></label>' +
        '<div class="lx3d-row"><label>Kind<select data-sp="kind">' + KINDS.map(function (k) { return '<option value="' + k[0] + '"' + (o.kind === k[0] ? " selected" : "") + ">" + k[1] + "</option>"; }).join("") + "</select></label>" +
        (o.kind === "projection" ? '<span class="muted small">' + (p ? "Lit by " + esc(p.name) + ": it shows what the projector shows." : "No projector shines on it yet: + Projector.") + "</span>" : '<label>Shows<select data-sp="link">' + linkOptions(o.link) + "</select></label>") + "</div>" +
        '<div class="lx3d-row"><label>Width (' + u + ")" + num('sp="w"', o.w || 4, { min: 0.3 }) + '</label><label>Shape<select data-sp="aspect">' + ASPECTS.map(function (a) { return '<option value="' + a[0] + '"' + ((o.aspect || "16:9") === a[0] ? " selected" : "") + ">" + a[0] + "</option>"; }).join("") + '<option value="custom"' + (o.aspect === "custom" ? " selected" : "") + ">Any height</option></select></label>" + (o.aspect === "custom" ? "<label>Height (" + u + ")" + num('sp="h"', heightOf(o), { min: 0.2 }) + "</label>" : "") + "</div>" +
        '<div class="lx3d-row"><label>Across (' + u + ")" + num('sp="x"', o.x || 0) + '</label><label>From the front edge (' + u + ")" + num('sp="z"', -(o.z || 0)) + '</label><label>Bottom edge (' + u + ")" + num('sp="y"', o.y || 0, { min: 0 }) + '</label><label>Turn (°)<input type="number" step="5" data-sp="yaw" value="' + (o.yaw || 0) + '"></label></div>' +
        '<div class="lx3d-aims"><button data-sc="at-back">On the back wall</button><button data-sc="at-left">Stage left side</button><button data-sc="at-right">Stage right side</button><button data-sc="at-foh">Facing the stage (a confidence monitor)</button></div>' +
        '<p class="muted small" id="lxScrNote">' + esc(noteFor(linkOf(o))) + '</p><div class="lx3d-row"><button data-sc="del" class="danger">Remove</button></div>';
    }
  }
  function noteFor(link) {
    if (!link) return "Nothing to show yet.";
    if (link === "main" || link === "stream") return "Shows the Video tab's " + (link === "main" ? "Main" : "Stream") + " output: switch cameras, the slides or the lyrics there.";
    if (link === "slides") return "Shows the Slides & lyrics output: the lyrics on their background (Lyrics → Background) or the slide that's live.";
    if (link === "pi1" || link === "pi2") return "Shows the Central Pedal's HDMI " + link.slice(2) + ".";
    return "Off.";
  }
  function renderValues() { var o = selId && byId(selId); if (!o || panel.hidden) return; ["x", "y", "z"].forEach(function (k) { var i = panel.querySelector('[data-sp="' + k + '"]'); if (i && document.activeElement !== i) i.value = X.toU(k === "z" ? -(o.z || 0) : o[k] || 0); }); }
  panel.addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b || !b.dataset.sc) return; var a = b.dataset.sc, o = selId && byId(selId), s = st(); if (a === "close") { selId = null; paintSel(); panel.hidden = true; return; } if (!o) return;
    X.remember(true);
    if (a === "del") { var list = isProj(o) ? projectors() : screens(); list.splice(list.indexOf(o), 1); if (!isProj(o)) projectors().forEach(function (p) { if (p.target === o.id) p.target = "wall"; }); selId = null; panel.hidden = true; }
    else if (a === "at-back") { o.x = 0; o.z = -s.depth - 0.5; o.yaw = 0; o.y = Math.max(0, s.deck) + 1.8; }
    else if (a === "at-left" || a === "at-right") { var sd = a === "at-left" ? 1 : -1; o.x = sd * (s.width / 2 + 1.2); o.z = -s.depth * 0.25; o.yaw = -sd * 25; }
    else if (a === "at-foh") { o.x = 0; o.z = Math.min(8, (s.room || 14) * 0.5); o.yaw = 180; o.y = 2.2; }
    L.saveRig(); key = ""; X.frame(); if (!panel.hidden) openPanel();
  });
  panel.addEventListener("input", function (e) {
    var k = e.target.dataset.sp, o = selId && byId(selId); if (!k || !o) return; var v = e.target.value; X.remember();
    if (k === "name") { o.name = v; L.saveRig(); return; }
    if (k === "kind" || k === "aspect" || k === "target" || k === "link") { o[k] = v; L.saveRig(); key = ""; X.frame(); openPanel(); return; }
    if (k === "bright" || k === "keystone") o[k] = Number(v);
    else if (k === "yaw") o.yaw = Number(v) || 0;
    else if (k === "z") o.z = -X.fromU(v);
    else o[k] = X.fromU(v);
    L.saveRig(); key = ""; X.frame();
  });
  X.selectHooks.push(function (keep) { if (keep !== "screen") { if (!panel.hidden) panel.hidden = true; if (selId) { selId = null; paintSel(); } } });
  X.barButton("screen", "+ Screen", "Add an LED wall, a TV or a projection screen: it shows what that output shows, live", function () { addScreen("led"); });
  X.barButton("projector", "+ Projector", "Add a projector aimed at a projection screen or the back wall", function () { addProjector(); });

  // ------------------------------------------------------------------ Stream Deck / MIDI: blank every screen, then bring them back
  function blankAll(on) {
    var S = window.CUSlides, V = window.CUVideoTab, now = S && S.blank ? S.blank(on) : !!on;
    if (V && V.ready && V.ready()) V.ftb("both", now); return now;
  }
  (function controlJobs() {
    var C = window.CUControls; if (!C || !C.ACTIONS) return setTimeout(controlJobs, 400);
    if (!C.ACTIONS.screensBlank) C.ACTIONS.screensBlank = { id: "screensBlank", label: "Screens: blank them all / bring them back", group: "Screens", kind: "trigger", admin: true, run: function () { blankAll(); }, led: function () { return window.CUSlides && window.CUSlides.blanked && window.CUSlides.blanked() ? "on" : "off"; } };
  })();

  window.CULightsScreens = { addScreen: addScreen, addProjector: addProjector, list: function () { return { screens: screens(), projectors: projectors() }; }, count: function () { return Object.keys(objs).length; }, select: function (id) { selId = id; paintSel(); openPanel(); X.frame(); },
    centre: function (id) { var o = byId(id); if (!o) return null; if (isProj(o)) { var w = o.target === "wall" ? wallRect(o) : null; if (w) return { x: w.x, y: w.y, z: w.z + 0.02 }; var s = screens().filter(function (x) { return x.id === o.target; })[0]; o = s || o; } var c = screenCentre(o); var yaw = (o.yaw || 0) * D2R; return { x: c.x + Math.sin(yaw) * 0.02, y: c.y, z: c.z + Math.cos(yaw) * 0.02 }; },
    sample: function (id) { var c = this.centre(id); return c ? X.sample(c.x, c.y, c.z) : Promise.resolve(null); }, blankAll: blankAll, feedOf: function (id) { var o = byId(id); return o ? (isProj(o) ? o.link : linkOf(o)) : null; } };
})();
