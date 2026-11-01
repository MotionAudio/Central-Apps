/* Central Control - Lighting: the 3D stage (replaces the flat stage plot).
 *  The stage at its real size (Stage & trusses), the trusses, the audience; every light where it hangs or stands,
 *  aimed where it points, with its beam through the haze and its pool of light on the floor. Bars show every cell,
 *  movers turn with their pan and tilt, strobes flash.
 *  Drag empty space to turn around the stage, right-drag (or Shift-drag) to slide, the wheel to zoom. Click a light to
 *  pick it: drag it to move it (along its truss, or across the floor), and set where it hangs and where it points in
 *  the panel. Units are metres: x across (0 = the middle), y up from the room's floor, z from the stage's front edge
 *  upstage (negative) and out over the audience (positive). Uses three.js (vendor/three.min.js). */
(function () {
  "use strict";
  var L = window.CULights, T = window.THREE, host = document.getElementById("lx3d");
  if (!L || !host) return;
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  var D2R = Math.PI / 180;
  var ok = false, renderer = null, scene, camera, roomGroup, fixGroup, fixtures = {}, roomKey = "", fixKey = "", selected = null, multi = [], showNames = false;
  try { var store = JSON.parse(localStorage.getItem("cu-lx3d") || "{}"); showNames = !!store.names; } catch (_) { store = {}; }
  function keep() { try { localStorage.setItem("cu-lx3d", JSON.stringify({ names: showNames, cam: cam, big: big })); } catch (_) { } }

  // ------------------------------------------------------------- set up (or fall back to the flat plot)
  var canvas = document.createElement("canvas"); canvas.className = "lx3d-canvas"; host.appendChild(canvas);
  var ui = document.createElement("div"); ui.className = "lx3d-ui"; host.appendChild(ui);
  var labels = document.createElement("div"); labels.className = "lx3d-labels"; host.appendChild(labels);
  try {
    if (!T) throw new Error("no three.js");
    renderer = new T.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = T.SRGBColorSpace;
    if (T.ACESFilmicToneMapping) { renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.25; }
    ok = true;
  } catch (e) {
    host.hidden = true; var svg = document.getElementById("lxPlot"); if (svg) svg.hidden = false;
    window.CULights3D = { active: function () { return false; }, frame: function () { }, rebuild: function () { }, error: String(e && e.message || e) };
    return;
  }
  var svg0 = document.getElementById("lxPlot"); if (svg0) svg0.hidden = true;
  scene = new T.Scene(); scene.background = new T.Color(0x07080a); scene.fog = new T.Fog(0x07080a, 22, 70);
  camera = new T.PerspectiveCamera(42, 16 / 9, 0.05, 300);
  scene.add(new T.AmbientLight(0x8890a0, 0.55));
  var hemi = new T.HemisphereLight(0xaab4c8, 0x0b0c0f, 0.6); scene.add(hemi);
  var key = new T.DirectionalLight(0xffffff, 0.45); key.position.set(4, 12, 10); scene.add(key);
  roomGroup = new T.Group(); fixGroup = new T.Group(); scene.add(roomGroup); scene.add(fixGroup);
  // (10.2) what the screens and projectors (lights3d-screens.js) and the room and seats (lights3d-room.js) hang on to:
  // they add to the room as it's built, run each frame, can be picked and dragged, and get a button on the bar
  var EXT = { roomHooks: [], frameHooks: [], pickables: [], emitList: [], selectHooks: [] };

  // ------------------------------------------------------------- materials and textures
  function canvasTex(w, h, draw) { var c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h); var t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t; }
  var poolTex = canvasTex(128, 128, function (g, w, h) { var gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.35, "rgba(255,255,255,.55)"); gr.addColorStop(0.75, "rgba(255,255,255,.12)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  var glowTex = canvasTex(64, 64, function (g, w, h) { var gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.25, "rgba(255,255,255,.6)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  var boardsTex = canvasTex(512, 512, function (g, w, h) { g.fillStyle = "#1d2026"; g.fillRect(0, 0, w, h); for (var y = 0; y < h; y += 32) { g.fillStyle = "rgba(255,255,255," + (0.012 + ((y / 32) % 3) * 0.006) + ")"; g.fillRect(0, y, w, 31); g.fillStyle = "rgba(0,0,0,.35)"; g.fillRect(0, y + 31, w, 1); } });
  boardsTex.wrapS = boardsTex.wrapT = T.RepeatWrapping;
  var M = {
    floor: new T.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.82, metalness: 0.15 }),
    deck: new T.MeshStandardMaterial({ color: 0xffffff, map: boardsTex, roughness: 0.8 }),
    deckSide: new T.MeshStandardMaterial({ color: 0x16181d, roughness: 0.85 }),
    wall: new T.MeshStandardMaterial({ color: 0x0a0b0e, roughness: 1, emissive: 0x000000 }),
    riser: new T.MeshStandardMaterial({ color: 0x1a1c21, roughness: 0.75 }),
    screen: new T.MeshBasicMaterial({ color: 0x0d1626 }),
    screenFrame: new T.MeshStandardMaterial({ color: 0x050608, roughness: 0.6 }),
    seat: new T.MeshStandardMaterial({ color: 0x15171c, roughness: 0.9 }),
    truss: new T.MeshStandardMaterial({ color: 0x9aa1ab, metalness: 0.75, roughness: 0.35 }),
    body: new T.MeshStandardMaterial({ color: 0x1d2027, metalness: 0.4, roughness: 0.5 }),
    bodyLight: new T.MeshStandardMaterial({ color: 0x2b3039, metalness: 0.35, roughness: 0.5 }),
    pick: new T.MeshBasicMaterial({ visible: false }),
    sel: new T.MeshBasicMaterial({ color: 0xe2c27e, wireframe: true, transparent: true, opacity: 0.85 })
  };
  var lip = new T.MeshBasicMaterial({ color: 0xe2c27e, transparent: true, opacity: 0.35 });
  // a beam: an open cone, brightest at the light, fading along its length and soft at its edges (added up like light)
  var beamVS = "varying float vA; varying vec3 vN; varying vec3 vV; void main(){ vA = -position.y; vec4 mv = modelViewMatrix * vec4(position,1.0); vV = normalize(-mv.xyz); vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * mv; }";
  var beamFS = "uniform vec3 color; uniform float level; varying float vA; varying vec3 vN; varying vec3 vV; void main(){ float edge = abs(dot(normalize(vN), normalize(vV))); float a = level * pow(1.0 - clamp(vA,0.0,1.0), 1.35) * pow(edge, 1.6); gl_FragColor = vec4(color * a, a); }";
  var coneGeo = new T.ConeGeometry(1, 1, 28, 1, true); coneGeo.translate(0, -0.5, 0);   // (apex at 0, opening along -y, length 1)
  function beamMat() { return new T.ShaderMaterial({ uniforms: { color: { value: new T.Color(1, 1, 1) }, level: { value: 0 } }, vertexShader: beamVS, fragmentShader: beamFS, transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide, fog: false }); }
  function poolMat() { return new T.MeshBasicMaterial({ map: poolTex, color: 0xffffff, transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0, polygonOffset: true, polygonOffsetFactor: -2 }); }
  function glowMat() { return new T.SpriteMaterial({ map: glowTex, color: 0xffffff, transparent: true, depthWrite: false, blending: T.AdditiveBlending, opacity: 0 }); }
  var planeGeo = new T.PlaneGeometry(1, 1);

  // ------------------------------------------------------------- the room: stage deck, floor, back wall, trusses, seats
  function stage() { return L.rig().stage; }
  var screenMesh = null;
  function buildRoom() {
    var st = stage(), k = JSON.stringify(st, function (key, v) { return key === "screens" || key === "projectors" || key === "props" || key === "trace" ? undefined : v; }); if (k === roomKey) return; roomKey = k;
    var hall = !!(st.hall && st.hall.outline && st.hall.outline.length >= 3);   // (10.2) the room drawn in Room & seats: its own floor, walls and seats
    while (roomGroup.children.length) { var c = roomGroup.children.pop(); if (c.geometry && c.geometry !== planeGeo) c.geometry.dispose(); }
    var W = st.width, D = st.depth, deck = Math.max(0, st.deck), R = Math.max(4, st.room || 14), roomW = W + 10;
    if (!hall) { var floor = new T.Mesh(new T.PlaneGeometry(roomW, D + R + 3), M.floor); floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, (R - D - 3) / 2 + 0); roomGroup.add(floor); }
    if (deck > 0.001) { var box = new T.Mesh(new T.BoxGeometry(W, deck, D), [M.deckSide, M.deckSide, M.deck, M.deckSide, M.deckSide, M.deckSide]); box.position.set(0, deck / 2, -D / 2); M.deck.map.repeat.set(W / 4, D / 4); roomGroup.add(box); }
    else { var top = new T.Mesh(new T.PlaneGeometry(W, D), M.deck); top.rotation.x = -Math.PI / 2; top.position.set(0, 0.002, -D / 2); roomGroup.add(top); }
    var shape = st.shape || "rect", hdeck = Math.max(deck, 0.02);
    if (shape === "thrust") { var tw = clamp(st.thrustW || W * 0.4, 1, W), td = clamp(st.thrustD || 2.5, 0.5, 12), tb = new T.Mesh(new T.BoxGeometry(tw, hdeck, td), [M.deckSide, M.deckSide, M.deck, M.deckSide, M.deckSide, M.deckSide]); tb.position.set(0, hdeck / 2, td / 2); roomGroup.add(tb); var te = new T.Mesh(new T.BoxGeometry(tw, 0.012, 0.03), lip); te.position.set(0, hdeck + 0.006, td); roomGroup.add(te); [-1, 1].forEach(function (sd) { var ts = new T.Mesh(new T.BoxGeometry(0.03, 0.012, td), lip); ts.position.set(sd * tw / 2, hdeck + 0.006, td / 2); roomGroup.add(ts); }); [-1, 1].forEach(function (sd) { var fe = new T.Mesh(new T.BoxGeometry((W - tw) / 2, 0.012, 0.03), lip); fe.position.set(sd * (tw / 2 + (W - tw) / 4), deck + 0.006, 0); roomGroup.add(fe); }); }
    else if (shape === "round") { var ad = clamp(st.apronD || W * 0.22, 0.5, 10), ap = new T.Mesh(new T.CylinderGeometry(1, 1, hdeck, 48, 1, false, -Math.PI / 2, Math.PI), [M.deckSide, M.deck, M.deckSide]); ap.scale.set(W / 2, 1, ad); ap.position.set(0, hdeck / 2, 0); roomGroup.add(ap); var ring = new T.Mesh(new T.TorusGeometry(1, 0.012, 4, 48, Math.PI), lip); ring.rotation.set(Math.PI / 2, 0, 0); ring.scale.set(W / 2, ad, 1); ring.position.set(0, hdeck + 0.006, 0); roomGroup.add(ring); }
    if (shape === "rect") { var edge = new T.Mesh(new T.BoxGeometry(W, 0.012, 0.03), lip); edge.position.set(0, deck + 0.006, 0); roomGroup.add(edge); }
    (st.risers || []).forEach(function (r) { var rw = Math.max(0.5, r.w || 2.4), rd = Math.max(0.5, r.d || 2.4), rh = Math.max(0.1, r.h || 0.4), rb = new T.Mesh(new T.BoxGeometry(rw, rh, rd), [M.riser, M.riser, M.deck, M.riser, M.riser, M.riser]); rb.position.set(r.x || 0, deck + rh / 2, -(r.z != null ? r.z : D * 0.7)); roomGroup.add(rb); var re = new T.Mesh(new T.BoxGeometry(rw, 0.01, 0.025), lip); re.position.set(r.x || 0, deck + rh + 0.005, -(r.z != null ? r.z : D * 0.7) + rd / 2); roomGroup.add(re); });
    if (st.screen && st.screen.on) { var sw = clamp(st.screen.w || W * 0.5, 1, 30), sh = clamp(st.screen.h || sw * 9 / 16, 0.5, 15), sy = clamp(st.screen.y != null ? st.screen.y : deck + 2.2, 0, 12) + sh / 2, sx = st.screen.x || 0;
      var fr = new T.Mesh(new T.BoxGeometry(sw + 0.16, sh + 0.16, 0.05), M.screenFrame); fr.position.set(sx, sy, -D - 0.57); roomGroup.add(fr);
      var scr = new T.Mesh(new T.PlaneGeometry(sw, sh), M.screen); scr.position.set(sx, sy, -D - 0.54); roomGroup.add(scr); screenMesh = scr; } else screenMesh = null;
    var wall = new T.Mesh(new T.PlaneGeometry(roomW, 9), M.wall); wall.position.set(0, 4.5, -D - 0.6); roomGroup.add(wall);
    // the audience: rows of seats (or the seats laid out in the room drawn under Room & seats)
    if (!hall) {
      var cols = Math.max(4, Math.floor((W + 2) / 0.6)), rows = Math.max(1, Math.floor((R - 3) / 1.0)), seat = new T.BoxGeometry(0.46, 0.45, 0.46);
      var inst = new T.InstancedMesh(seat, M.seat, cols * rows), m4 = new T.Matrix4(), n = 0;
      for (var r = 0; r < rows; r++) for (var c2 = 0; c2 < cols; c2++) { if (Math.abs(c2 - (cols - 1) / 2) < 0.8) continue; m4.makeTranslation((c2 - (cols - 1) / 2) * 0.6, 0.225, 2.6 + r * 1.0); inst.setMatrixAt(n++, m4); }
      inst.count = n; roomGroup.add(inst);
    }
    (st.trusses || []).forEach(function (t) { roomGroup.add(trussMesh(t)); });
    EXT.roomHooks.forEach(function (fn) { try { fn(roomGroup, st); } catch (e) { console.warn("3D room", e); } });
  }
  // (10.2) a truss or pipe runs across (turn 0) or at any angle (turn 90 = front to back, a side truss); x is its middle
  function trussDir(t) { var a = (t.yaw || 0) * D2R; return { x: Math.cos(a), z: -Math.sin(a) }; }
  function trussPoint(t, along) { var d = trussDir(t); return { x: (t.x || 0) + d.x * along, z: -t.d + d.z * along }; }
  function trussAlong(t, x, z) { var d = trussDir(t); return (x - (t.x || 0)) * d.x + (z + t.d) * d.z; }
  function trussMesh(t) {   // a 30 cm box truss: four chords and the zig-zag braces (a pipe: one tube)
    var g = new T.Group(), w = Math.max(1, t.width || 8), s = 0.3;
    if (t.kind === "pipe") { var pg = new T.CylinderGeometry(0.024, 0.024, w, 10); pg.rotateZ(Math.PI / 2); g.add(new T.Mesh(pg, M.truss)); g.position.set(t.x || 0, t.h, -t.d); g.rotation.y = (t.yaw || 0) * D2R; return g; }
    var chord = new T.CylinderGeometry(0.024, 0.024, w, 8); chord.rotateZ(Math.PI / 2);
    [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(function (q) { var m = new T.Mesh(chord, M.truss); m.position.set(0, q[0] * s / 2, q[1] * s / 2); g.add(m); });
    var pts = [], steps = Math.round(w / 0.5);
    for (var i = 0; i < steps; i++) { var x0 = -w / 2 + i * w / steps, x1 = x0 + w / steps; pts.push(x0, -s / 2, s / 2, x1, s / 2, s / 2, x0, -s / 2, -s / 2, x1, s / 2, -s / 2, x0, s / 2, -s / 2, x1, s / 2, s / 2, x0, -s / 2, -s / 2, x1, -s / 2, s / 2); }
    var lg = new T.BufferGeometry(); lg.setAttribute("position", new T.Float32BufferAttribute(pts, 3));
    g.add(new T.LineSegments(lg, new T.LineBasicMaterial({ color: 0x8a919b, transparent: true, opacity: 0.7 })));
    g.position.set(t.x || 0, t.h, -t.d); g.rotation.y = (t.yaw || 0) * D2R; return g;
  }

  // ------------------------------------------------------------- the lights
  // each light: a body pointing along its own +z (yaw, then pitch); movers: base, yoke (pan) and head (tilt); bars: a
  // row of cells; every emitter (a lens or a bar's cell) gets a lens disc, a glow, a beam and a pool on the floor.
  function emitter(parent, at, radius, spread, kind) {
    var lens = new T.Mesh(new T.CircleGeometry(radius, 20), new T.MeshBasicMaterial({ color: 0x0b0d10 })); lens.position.copy(at); parent.add(lens);
    var glow = new T.Sprite(glowMat()); glow.position.copy(at); glow.position.z += 0.01; glow.scale.setScalar(radius * 6); parent.add(glow);
    var beam = new T.Mesh(coneGeo, beamMat()); beam.frustumCulled = false; scene.add(beam);
    var pool = new T.Mesh(planeGeo, poolMat()); pool.frustumCulled = false; scene.add(pool);
    return { lens: lens, glow: glow, beam: beam, pool: pool, spread: spread, kind: kind, radius: radius };
  }
  function buildFixture(f) {
    var kind = L.kindOf(f), cells = L.cellsOf(f), root = new T.Group(), aim = f.aim || {}, o = { f: f, kind: kind, cells: cells, root: root, emitters: [] };
    root.rotation.order = "YXZ"; root.userData.fixId = f.id;
    var pick;
    if (kind === "mover") {
      var hung = (aim.hang || (f.mount === "floor" ? "up" : "down")) === "down";
      var base = new T.Mesh(new T.BoxGeometry(0.34, 0.12, 0.26), M.body); base.position.y = 0.06; root.add(base);
      var yoke = new T.Group(); yoke.position.y = 0.12; root.add(yoke);
      var armGeo = new T.BoxGeometry(0.04, 0.3, 0.12);
      var a1 = new T.Mesh(armGeo, M.bodyLight); a1.position.set(-0.16, 0.15, 0); yoke.add(a1); var a2 = a1.clone(); a2.position.x = 0.16; yoke.add(a2);
      var head = new T.Group(); head.position.y = 0.22; yoke.add(head);
      var can = new T.Mesh(new T.CylinderGeometry(0.11, 0.13, 0.3, 20), M.body); head.add(can);
      o.emitters.push(emitter(head, new T.Vector3(0, 0.151, 0), 0.095, f.spot ? 7 : 13, "mover"));
      o.emitters[0].lens.rotation.x = -Math.PI / 2; o.emitters[0].glow.position.y = 0.17; o.emitters[0].glow.position.z = 0;
      o.yoke = yoke; o.head = head; o.hung = hung;
      pick = new T.Mesh(new T.BoxGeometry(0.5, 0.6, 0.5), M.pick); pick.position.y = 0.25;
    } else if (kind === "bar") {
      var len = Math.max(0.5, cells * 0.11), bar = new T.Mesh(new T.BoxGeometry(len, 0.09, 0.09), M.body); root.add(bar);
      for (var c = 0; c < cells; c++) o.emitters.push(emitter(root, new T.Vector3(-len / 2 + (c + 0.5) * len / cells, 0, 0.0455), Math.min(0.04, len / cells * 0.38), 11, "cell"));
      if (f.roll) root.userData.roll = f.roll;
      pick = new T.Mesh(new T.BoxGeometry(len + 0.1, 0.25, 0.25), M.pick);
    } else if (kind === "strobe" || kind === "blinder") {
      var wide = kind === "strobe" ? 0.46 : Math.max(0.3, cells * 0.2), body = new T.Mesh(new T.BoxGeometry(wide, kind === "strobe" ? 0.17 : 0.24, 0.14), M.body); root.add(body);
      var n = kind === "strobe" ? Math.max(1, cells) : cells;
      for (var k = 0; k < n; k++) o.emitters.push(emitter(root, new T.Vector3(-wide / 2 + (k + 0.5) * wide / n, 0, 0.0705), kind === "strobe" ? Math.min(0.07, wide / n * 0.42) : 0.085, kind === "strobe" ? 60 : 30, kind));
      pick = new T.Mesh(new T.BoxGeometry(wide + 0.1, 0.35, 0.3), M.pick);
    } else if (kind === "haze") {
      var hz = new T.Mesh(new T.BoxGeometry(0.5, 0.3, 0.32), M.body); hz.position.y = 0.15; root.add(hz);
      var nozzle = new T.Mesh(new T.CylinderGeometry(0.04, 0.04, 0.08, 10), M.bodyLight); nozzle.rotation.x = Math.PI / 2; nozzle.position.set(0, 0.2, 0.19); root.add(nozzle);
      o.hazeCloud = new T.Sprite(new T.SpriteMaterial({ map: glowTex, color: 0x9aa3b0, transparent: true, depthWrite: false, opacity: 0 })); o.hazeCloud.position.set(0, 0.6, 1.4); o.hazeCloud.scale.set(4, 2, 1); root.add(o.hazeCloud);
      pick = new T.Mesh(new T.BoxGeometry(0.6, 0.45, 0.45), M.pick); pick.position.y = 0.2;
    } else {   // par, dimmer, house light
      var par = new T.Mesh(new T.CylinderGeometry(0.12, 0.14, 0.26, 20), M.body); par.rotation.x = Math.PI / 2; root.add(par);
      var ring = new T.Mesh(new T.TorusGeometry(0.125, 0.012, 6, 24), M.bodyLight); ring.position.z = 0.13; root.add(ring);
      var yk = new T.Mesh(new T.TorusGeometry(0.17, 0.012, 6, 20, Math.PI), M.bodyLight); yk.rotation.z = Math.PI; root.add(yk);
      o.emitters.push(emitter(root, new T.Vector3(0, 0, 0.131), 0.105, f.group === "house" ? 32 : f.group === "front" ? 22 : 18, "par"));
      pick = new T.Mesh(new T.BoxGeometry(0.4, 0.4, 0.4), M.pick);
    }
    pick.userData.fixId = f.id; root.add(pick); o.pick = pick;
    var sel = new T.Mesh(new T.BoxGeometry(1, 1, 1), M.sel); sel.visible = false; root.add(sel); o.sel = sel; o.selBox = pick;
    fixGroup.add(root); place(o); return o;
  }
  function place(o) {   // where it is and which way it points
    var f = o.f, p = f.pos || { x: 0, y: 1, z: 0 }, aim = f.aim || { yaw: 0, pitch: 0 };
    o.root.position.set(p.x, p.y, p.z);
    if (o.kind === "mover") { o.root.rotation.set(o.hung ? Math.PI : 0, (aim.yaw || 0) * D2R, 0); o.root.rotation.order = "YXZ"; }
    else { o.root.rotation.set((aim.pitch || 0) * D2R, (aim.yaw || 0) * D2R, (f.roll || 0) * D2R); }
    o.sel.position.copy(o.pick.position); o.sel.scale.copy(o.pick.geometry.parameters ? new T.Vector3(o.pick.geometry.parameters.width, o.pick.geometry.parameters.height, o.pick.geometry.parameters.depth) : new T.Vector3(0.4, 0.4, 0.4));
  }
  function clearFixtures() {
    Object.keys(fixtures).forEach(function (id) { var o = fixtures[id]; o.emitters.forEach(function (e) { scene.remove(e.beam); scene.remove(e.pool); e.beam.material.dispose(); e.pool.material.dispose(); e.glow.material.dispose(); e.lens.material.dispose(); }); fixGroup.remove(o.root); });
    fixtures = {}; labels.innerHTML = "";
  }
  function buildFixtures() {
    var rig = L.rig(), k = JSON.stringify(rig.fixtures.map(function (f) { return [f.id, f.profile, f.channels, f.group, f.name, f.spot, (f.aim || {}).hang]; }));
    if (k === fixKey) { rig.fixtures.forEach(function (f) { if (fixtures[f.id]) place(fixtures[f.id]); }); return; }
    fixKey = k; clearFixtures();
    rig.fixtures.forEach(function (f) { fixtures[f.id] = buildFixture(f); var lb = document.createElement("span"); lb.className = "lx3d-label"; lb.textContent = f.name; lb.dataset.fix = f.id; labels.appendChild(lb); fixtures[f.id].label = lb; });
    if (selected && !fixtures[selected]) selected = null;
    paintSelection();
  }

  // ------------------------------------------------------------- every frame: colours, beams, pools, movers
  var tmpV = new T.Vector3(), tmpQ = new T.Quaternion(), down = new T.Vector3(0, -1, 0), up = new T.Vector3(0, 1, 0), fwd = new T.Vector3(0, 0, 1);
  function colourOf(st, f) { var k = f.group === "haze" ? st.haze : st.dim, R = clamp(st.r + st.w + st.a, 0, 1), G = clamp(st.g + st.w + st.a * 0.55, 0, 1), B = clamp(st.b + st.w + st.uv * 0.6, 0, 1), m = Math.max(R, G, B, 0.001); return { r: R / m, g: G / m, b: B / m, k: clamp(k * Math.min(1, m * 1.4), 0, 1) }; }
  // where a ray from the light lands: the stage deck, the room's floor, or the back wall (or nowhere, pointing up)
  function hit(o3, d) {
    var st = stage(), W = st.width, D = st.depth, deck = Math.max(0, st.deck), best = 40, surf = null;
    if (d.y < -1e-4) {
      var tDeck = (deck - o3.y) / d.y, hx = o3.x + d.x * tDeck, hz = o3.z + d.z * tDeck;
      if (tDeck > 0 && onDeck(hx, hz)) { best = tDeck; surf = "deck"; }
      else { var tF = -o3.y / d.y; if (tF > 0 && tF < best) { best = tF; surf = "floor"; } }
    }
    if (d.z < -1e-4) { var tW = (-D - 0.6 - o3.z) / d.z; if (tW > 0 && tW < best) { best = tW; surf = "wall"; } }
    return { t: best, surf: surf };
  }
  function hazeLevel() {
    var rig = L.rig(), live = L.live, hz = rig.fixtures.filter(function (f) { return f.group === "haze"; });
    if (!hz.length) return 0.55;
    var m = 0; hz.forEach(function (f) { var s = live.fixtureColor[f.id]; if (s) m = Math.max(m, s.haze); }); return m;
  }
  function frame() {
    if (!ok || !L.isShowing()) return;
    resize(); buildRoom(); buildFixtures();
    var rig = L.rig(), live = L.live, haze = hazeLevel(), beamK = 0.26 + 0.6 * haze, emits = EXT.emitList; emits.length = 0; EXT.hazeNow = haze;
    rig.fixtures.forEach(function (f) {
      var o = fixtures[f.id]; if (!o) return;
      var sts = (live.cellColor && live.cellColor[f.id]) || (live.fixtureColor[f.id] ? [live.fixtureColor[f.id]] : null); if (!sts) return;
      if (o.kind === "mover") {
        var st0 = sts[0], panR = (f.panRange || 540) * D2R, tiltR = (f.tiltRange || 270) * D2R;
        o.yoke.rotation.y = (st0.pan - 0.5) * panR; o.head.rotation.x = -(st0.tilt - 0.5) * tiltR * (o.hung ? 1 : -1);
      }
      if (o.hazeCloud) { var hs = live.fixtureColor[f.id]; o.hazeCloud.material.opacity = hs ? hs.haze * 0.35 : 0; }
      o.root.updateMatrixWorld(true);
      o.emitters.forEach(function (e, i) {
        var st = sts[Math.min(i, sts.length - 1)], c = colourOf(st, f), k = c.k;
        e.lens.material.color.setRGB(0.05 + c.r * k, 0.05 + c.g * k, 0.05 + c.b * k);
        e.glow.material.color.setRGB(c.r, c.g, c.b); e.glow.material.opacity = k * 0.9; e.glow.scale.setScalar(e.radius * (4 + 6 * k));
        // the beam: from the lens, along the light's facing
        e.lens.getWorldPosition(tmpV); var origin = tmpV.clone();
        var dir = (o.kind === "mover" ? up.clone() : fwd.clone()).transformDirection(o.kind === "mover" ? o.head.matrixWorld : o.root.matrixWorld).normalize();
        var h = hit(origin, dir), len = Math.min(h.t, 30), half = e.spread / 2 * D2R, r = len * Math.tan(half);
        if (k > 0.004 && f.group !== "haze") emits.push({ x: origin.x, y: origin.y, z: origin.z, dx: dir.x, dy: dir.y, dz: dir.z, spread: f.group === "house" ? Math.max(e.spread, 70) : e.spread, r: c.r, g: c.g, b: c.b, k: k * (e.kind === "cell" ? 0.35 : e.kind === "strobe" ? 0.6 : 1), group: f.group, surf: h.surf, t: h.t });
        var level = k * (e.kind === "strobe" ? 0.35 : e.kind === "cell" ? 0.6 : 1) * beamK;
        e.beam.visible = level > 0.004; e.beam.position.copy(origin); e.beam.quaternion.setFromUnitVectors(down, dir); e.beam.scale.set(Math.max(0.01, r), len, Math.max(0.01, r));
        e.beam.material.uniforms.level.value = level; e.beam.material.uniforms.color.value.setRGB(c.r, c.g, c.b);
        // its pool: where the beam lands (stretched when it lands at a slant)
        var pv = k > 0.01 && h.surf;
        e.pool.visible = !!pv;
        if (pv) {
          var at = origin.clone().addScaledVector(dir, h.t);
          e.pool.material.color.setRGB(c.r, c.g, c.b); e.pool.material.opacity = Math.min(0.9, k * (e.kind === "cell" ? 0.6 : 0.95));
          var rr = Math.max(0.15, h.t * Math.tan(half)) * 2.2;
          if (h.surf === "wall") { e.pool.position.set(at.x, at.y, -stage().depth - 0.59); e.pool.rotation.set(0, 0, 0); e.pool.scale.set(rr, rr / Math.max(0.3, Math.abs(dir.z)), 1); }
          else { e.pool.position.set(at.x, (h.surf === "deck" ? Math.max(0, stage().deck) : 0) + 0.004, at.z); e.pool.rotation.set(-Math.PI / 2, 0, -Math.atan2(dir.x, -dir.z)); e.pool.scale.set(rr, rr / Math.max(0.3, Math.abs(dir.y)), 1); }
        }
      });
    });
    var wr = 0, wg = 0, wb = 0, wn = 0;
    rig.fixtures.forEach(function (f) { if (f.group !== "back" && f.group !== "beam") return; var st = live.fixtureColor[f.id]; if (!st) return; var c = colourOf(st, f); wr += c.r * c.k; wg += c.g * c.k; wb += c.b * c.k; wn++; });
    if (wn) { var wk = 0.03 / Math.max(1, wn * 0.5); M.wall.emissive.setRGB(wr * wk, wg * wk, wb * wk); } else M.wall.emissive.setRGB(0, 0, 0);
    if (screenMesh) { var tnow = performance.now() / 1000; screenMesh.material.color.setRGB(0.05 + 0.02 * Math.sin(tnow * 0.4), 0.09 + 0.02 * Math.sin(tnow * 0.31 + 1), 0.16 + 0.03 * Math.sin(tnow * 0.27 + 2)); }
    placeCamera();
    var nowMs = performance.now(); EXT.frameHooks.forEach(function (fn) { try { fn(nowMs); } catch (e) { console.warn("3D frame", e); } });
    renderer.render(scene, camera); drawLabels();
    if (EXT.afterRender) { var ar = EXT.afterRender; EXT.afterRender = null; ar(); }
  }

  // ------------------------------------------------------------- the camera: turn, slide, zoom; views
  var cam = Object.assign({ yaw: 0.6, pitch: 0.42, dist: 12, tx: 0, ty: 1.8, tz: -3 }, store.cam || {});
  var big = false; function applyBig() { var v = ui.querySelector(".lx3d-sizev"); if (v) v.textContent = (L.rig().stageH || 440) + " px"; }
  function placeCamera() {
    var cp = Math.cos(cam.pitch);
    camera.position.set(cam.tx + cam.dist * Math.sin(cam.yaw) * cp, cam.ty + cam.dist * Math.sin(cam.pitch), cam.tz + cam.dist * Math.cos(cam.yaw) * cp);
    camera.lookAt(cam.tx, cam.ty, cam.tz);
  }
  var VIEWS = {
    audience: function () { var st = stage(); return { yaw: 0, pitch: 0.18, dist: Math.max(12, st.width * 1.25), tx: 0, ty: 2.2, tz: -st.depth / 2 }; },
    corner: function () { var st = stage(); return { yaw: 0.6, pitch: 0.42, dist: Math.max(11, st.width * 1.15), tx: 0, ty: 1.8, tz: -st.depth / 2 }; },
    top: function () { var st = stage(); return { yaw: 0, pitch: 1.5, dist: Math.max(14, st.width * 1.35), tx: 0, ty: 0, tz: -st.depth / 2 + 1 }; },
    side: function () { var st = stage(); return { yaw: Math.PI / 2, pitch: 0.12, dist: Math.max(14, (st.depth + 8) * 1.3), tx: 0, ty: 2.5, tz: -st.depth / 2 + 2 }; }
  };
  // the panels need room: in a small view, picking a light or opening the stage settings makes the view bigger
  function roomy() { if (host.clientHeight < 430 && L.stageSize) { L.stageSize(520); applyBig(); lastW = 0; } }
  function view(name) { Object.assign(cam, VIEWS[name]()); keep(); frame(); }
  var lastW = 0, lastH = 0;
  function resize() {
    var w = host.clientWidth, h = host.clientHeight; if (!w || !h) return;
    if (w !== lastW || h !== lastH) { lastW = w; lastH = h; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); host.classList.toggle("lx3d-narrow", w < 640); }
  }
  function drawLabels() {
    var w = lastW, h = lastH;
    Object.keys(fixtures).forEach(function (id) {
      var o = fixtures[id], lb = o.label; if (!lb) return;
      var show = showNames || id === selected || id === hover; lb.hidden = !show; if (!show) return;
      o.root.getWorldPosition(tmpV); tmpV.y += o.kind === "mover" && !o.hung ? 0.65 : 0.32; tmpV.project(camera);
      if (tmpV.z > 1) { lb.hidden = true; return; }
      lb.style.transform = "translate(" + Math.round((tmpV.x + 1) / 2 * w) + "px," + Math.round((1 - tmpV.y) / 2 * h) + "px) translate(-50%,-100%)";
      lb.classList.toggle("sel", id === selected);
    });
  }

  // ------------------------------------------------------------- picking and dragging
  var ray = new T.Raycaster(), ndc = new T.Vector2(), drag = null, hover = null;
  function pickAt(e) {
    var r = canvas.getBoundingClientRect(); ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera);
    var hits = ray.intersectObjects(Object.keys(fixtures).map(function (id) { return fixtures[id].pick; }), false);
    return hits.length ? hits[0].object.userData.fixId : null;
  }
  function onPlane(e, y) { var r = canvas.getBoundingClientRect(); ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera); var pl = new T.Plane(new T.Vector3(0, 1, 0), -y), out = new T.Vector3(); return ray.ray.intersectPlane(pl, out) ? out : null; }
  canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });
  // (10.2) a screen, a projector or a piece of the room under the pointer: { obj, ext } (ext: select, y, drag, end)
  function pickExt(e) {
    if (!EXT.pickables.length) return null;
    var r = canvas.getBoundingClientRect(); ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera);
    var hits = ray.intersectObjects(EXT.pickables.map(function (p) { return p.obj; }), true); if (!hits.length) return null;
    var o = hits[0].object; while (o && !o.userData.ext) o = o.parent; return o ? o.userData.ext : null;
  }
  canvas.addEventListener("pointerdown", function (e) {
    canvas.setPointerCapture(e.pointerId);
    var id = e.button === 0 && !e.shiftKey ? pickAt(e) : null, ex = !id && e.button === 0 && !e.shiftKey ? pickExt(e) : null;
    if (ex) {
      if (selected) { selected = null; paintSelection(); renderPanel(); }
      var sp1 = $("#lx3dStage"); if (sp1) sp1.hidden = true; roomy(); ex.select();
      var y0 = ex.y ? ex.y() : 0, p0 = onPlane(e, y0); drag = { mode: "ext", ext: ex, y: y0, start: p0, from: ex.from ? ex.from() : null, moved: false, x: e.clientX, y0: e.clientY };
      return;
    }
    if (id) {
      EXT.selectHooks.forEach(function (fn) { fn(null); });
      if (e.ctrlKey || e.metaKey) {   // (10.2) Ctrl / ⌘-click: pick several
        var set = multi.length ? multi.slice() : selected ? [selected] : [], mi = set.indexOf(id);
        if (mi >= 0) set.splice(mi, 1); else set.push(id);
        if (set.length > 1) { selected = null; multi = set; } else { selected = set[0] || null; multi = []; }
        paintSelection(); renderPanel(); frame(); return;
      }
      if (multi.indexOf(id) < 0) multi = [];
      if (selected !== id && !multi.length) { selected = id; paintSelection(); roomy(); var sp0 = $("#lx3dStage"); if (sp0) sp0.hidden = true; renderPanel(); }
      var f = fixtureById(id), p = onPlane(e, f.pos.y);
      drag = { mode: "fixture", f: f, start: p, from: Object.assign({}, f.pos), moved: false, x: e.clientX, y: e.clientY, group: multi.length > 1 ? multi.map(function (m) { var g = fixtureById(m); return g ? { f: g, from: Object.assign({}, g.pos) } : null; }).filter(Boolean) : null };
    } else drag = { mode: e.button === 2 || e.shiftKey ? "slide" : "turn", x: e.clientX, y: e.clientY, cam: Object.assign({}, cam), moved: false };
  });
  canvas.addEventListener("pointermove", function (e) {
    if (!drag) { var h2 = pickAt(e); if (h2 !== hover) { hover = h2; canvas.style.cursor = h2 ? "grab" : "default"; frame(); } if (!h2 && EXT.pickables.length) canvas.style.cursor = pickExt(e) ? "grab" : "default"; return; }
    if (drag.mode === "ext") {
      if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y0) > 3) drag.moved = true;
      var pe = drag.start && onPlane(e, drag.y); if (drag.moved && pe && drag.ext.drag) { canvas.style.cursor = "grabbing"; drag.ext.drag(pe.x - drag.start.x, pe.z - drag.start.z, drag.from); }
      frame(); return;
    }
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    if (drag.mode === "turn") { cam.yaw = drag.cam.yaw - dx * 0.006; cam.pitch = clamp(drag.cam.pitch + dy * 0.005, 0.02, 1.55); }
    else if (drag.mode === "slide") { var s = cam.dist * 0.0016, cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw); cam.tx = drag.cam.tx - (dx * cy) * s; cam.tz = drag.cam.tz + (dx * sy) * s; cam.ty = clamp(drag.cam.ty + dy * s, 0, 8); }
    else if (drag.mode === "fixture" && drag.start && drag.moved) {
      var p = onPlane(e, drag.from.y); if (!p) return; canvas.style.cursor = "grabbing";
      if (!drag.remembered) { drag.remembered = true; remember(); }
      var ddx = p.x - drag.start.x, ddz = p.z - drag.start.z;
      (drag.group || [{ f: drag.f, from: drag.from }]).forEach(function (it) { moveFixtureTo(it.f, it.from.x + ddx, it.from.z + ddz); });
      renderPanelValues();
    }
    frame();
  });
  canvas.addEventListener("pointerup", function () {
    if (drag && drag.mode === "ext") { if (drag.moved && drag.ext.end) drag.ext.end(); drag = null; canvas.style.cursor = "default"; frame(); return; }
    if (drag && drag.mode === "fixture" && drag.moved) L.saveRig();
    else if (drag && !drag.moved && drag.mode !== "fixture") { selected = null; paintSelection(); renderPanel(); EXT.selectHooks.forEach(function (fn) { fn(null); }); }
    if (drag && (drag.mode === "turn" || drag.mode === "slide")) keep();
    drag = null; canvas.style.cursor = hover ? "grab" : "default"; frame();
  });
  canvas.addEventListener("wheel", function (e) { e.preventDefault(); cam.dist = clamp(cam.dist * Math.pow(1.0015, e.deltaY), 2.5, 80); keep(); frame(); }, { passive: false });
  function onDeck(x, z) {   // is this spot on the stage (its main part, a thrust or a round front)?
    var st = stage(), W = st.width, D = st.depth; if (Math.abs(x) <= W / 2 && z <= 0 && z >= -D) return true;
    if (st.shape === "thrust") { var tw = st.thrustW || W * 0.4, td = st.thrustD || 2.5; return Math.abs(x) <= tw / 2 && z > 0 && z <= td; }
    if (st.shape === "round") { var ad = st.apronD || W * 0.22, a = x / (W / 2), b = z / ad; return z > 0 && a * a + b * b <= 1; }
    return false;
  }
  function surfaceAt(x, z) { var st = stage(), deck = Math.max(0, st.deck); if (!onDeck(x, z)) return 0; var top = deck; (st.risers || []).forEach(function (r) { var rz = -(r.z != null ? r.z : st.depth * 0.7); if (Math.abs(x - (r.x || 0)) <= (r.w || 2.4) / 2 && Math.abs(z - rz) <= (r.d || 2.4) / 2) top = Math.max(top, deck + (r.h || 0.4)); }); return top; }
  function fixtureById(id) { return L.rig().fixtures.filter(function (f) { return f.id === id; })[0] || null; }
  function paintSelection() { Object.keys(fixtures).forEach(function (id) { fixtures[id].sel.visible = id === selected || multi.indexOf(id) >= 0; }); }

  // ------------------------------------------------------------- the overlay: views, names, stage, the light's panel
  ui.innerHTML = '<div class="lx3d-bar"><div class="lx3d-views" role="group" aria-label="View">' +
    [["audience", "Audience"], ["corner", "Corner"], ["top", "Top"], ["side", "Side"]].map(function (v) { return '<button data-v3="' + v[0] + '">' + v[1] + "</button>"; }).join("") + '</div>' +
    '<label class="toggle lx3d-names"><input type="checkbox" data-n3' + (showNames ? " checked" : "") + '> Names</label><button data-stage3>Stage &amp; trusses</button><span class="lx3d-views lx3d-ext" role="group" aria-label="Add"></span><span class="lx3d-views" role="group" aria-label="Undo"><button data-undo3 title="Undo (Ctrl+Z)" aria-label="Undo" disabled>↶</button><button data-redo3 title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled>↷</button></span><span class="lx3d-views" role="group" aria-label="Size"><button data-size3="-1" title="Make the 3D stage smaller">−</button><button data-size3="0" title="The 3D stage\'s height (click for the standard size)" class="lx3d-sizev">Size</button><button data-size3="1" title="Make the 3D stage bigger">+</button></span></div>' +
    '<div class="lx3d-panel" id="lx3dPanel" hidden></div><div class="lx3d-stage" id="lx3dStage" hidden></div>' +
    '<p class="lx3d-hint">Drag to turn · right-drag to slide · wheel to zoom · click a light to place it · Ctrl-click to pick several</p>';
  ui.addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    if (b.dataset.v3) view(b.dataset.v3);
    else if (b.dataset.size3 != null) { var d0 = Number(b.dataset.size3), h0 = L.rig().stageH || 440; L.stageSize(d0 === 0 ? 440 : h0 + d0 * 80); applyBig(); lastW = 0; frame(); }
    else if (b.hasAttribute("data-stage3")) { var sp = $("#lx3dStage"); sp.hidden = !sp.hidden; if (!sp.hidden) { roomy(); selected = null; multi = []; paintSelection(); renderPanel(); renderStage(); EXT.selectHooks.forEach(function (fn) { fn("stage"); }); } }
    else if (b.dataset.p3) panelAction(b.dataset.p3, b);
    else if (b.dataset.put3) putAction(b.dataset.put3);
    else if (b.hasAttribute("data-undo3")) undo();
    else if (b.hasAttribute("data-redo3")) redo();
    else if (b.dataset.ext3 && EXT.bar[b.dataset.ext3]) EXT.bar[b.dataset.ext3](b);
    else if (b.dataset.s3) stageAction(b.dataset.s3, b);
  });
  ui.addEventListener("change", function (e) { if (e.target.hasAttribute("data-n3")) { showNames = e.target.checked; keep(); frame(); } });
  ui.addEventListener("input", function (e) { var el = e.target; if (el.dataset.pf) panelField(el); else if (el.dataset.sf) stageField(el); });
  ["pointerdown", "wheel"].forEach(function (ev) { ui.addEventListener(ev, function (e) { if (e.target.closest(".lx3d-panel,.lx3d-stage,.lx3d-bar")) e.stopPropagation(); }, { passive: true }); });

  // ------------------------------------------------------------- (10.2) units, the grid, undo, several lights at once
  // Feet by default (Stage & trusses → Units); everything is kept in metres and only shown in the units picked.
  var FT = 3.28084;
  function units() { return L.rig().units === "m" ? "m" : "ft"; }
  function ul() { return units(); }
  function toU(m, dp) { var v = units() === "ft" ? m * FT : m, k = Math.pow(10, dp == null ? 2 : dp); return Math.round(v * k) / k; }
  function fromU(v) { v = Number(v) || 0; return units() === "ft" ? v / FT : v; }
  function stepU() { return units() === "ft" ? 0.5 : 0.25; }
  function gridStep() { return L.rig().snap === false ? 0.05 : units() === "ft" ? 0.1524 : 0.25; }   // half a foot, or 25 cm
  function snapV(v) { var g = gridStep(); return Math.round(v / g) * g; }
  function uid() { return Math.random().toString(36).slice(2, 9); }
  // undo / redo: the lights' places and the stage, before each change
  var undoStack = [], redoStack = [], lastRem = 0;
  function snapshot() { var r = L.rig(); return JSON.stringify({ fixtures: r.fixtures, stage: r.stage }); }
  function remember(force) {
    var now = performance.now(); if (!force && now - lastRem < 700) { lastRem = now; return; }
    lastRem = now; undoStack.push(snapshot()); if (undoStack.length > 80) undoStack.shift(); redoStack = []; paintUndo();
  }
  function restoreSnap(s) {
    var j = JSON.parse(s), r = L.rig(); r.fixtures.length = 0; Array.prototype.push.apply(r.fixtures, j.fixtures); r.stage = j.stage;
    fixKey = ""; roomKey = ""; L.saveRig(); if (L.renderAll) L.renderAll(); selected = null; multi = []; paintSelection(); renderPanel();
    var sp = $("#lx3dStage"); if (sp && !sp.hidden) renderStage(); EXT.selectHooks.forEach(function (fn) { fn(null); }); if (EXT.changed) EXT.changed(); frame();
  }
  function undo() { if (!undoStack.length) return; redoStack.push(snapshot()); restoreSnap(undoStack.pop()); paintUndo(); }
  function redo() { if (!redoStack.length) return; undoStack.push(snapshot()); restoreSnap(redoStack.pop()); paintUndo(); }
  function paintUndo() { var u = ui.querySelector("[data-undo3]"), r = ui.querySelector("[data-redo3]"); if (u) u.disabled = !undoStack.length; if (r) r.disabled = !redoStack.length; }
  function roomBounds() {
    var st = stage(), h = st.hall;
    if (h && h.outline && h.outline.length >= 3) { var xs = h.outline.map(function (p) { return p[0]; }), zs = h.outline.map(function (p) { return p[1]; }); return { x0: Math.min.apply(null, xs), x1: Math.max.apply(null, xs), z0: Math.min.apply(null, zs), z1: Math.max.apply(null, zs) }; }
    var W = st.width + 10; return { x0: -W / 2, x1: W / 2, z0: -st.depth - 0.6, z1: Math.max(4, st.room || 14) - 0.5 };
  }
  function moveFixtureTo(f, nx, nz) {
    var st = stage(), t = L.trussById(f.mount); nx = snapV(nx); nz = snapV(nz);
    if (t) { var tw0 = (t.width || st.width) / 2, tp = trussPoint(t, clamp(snapV(trussAlong(t, nx, nz)), -tw0, tw0)); f.pos.x = tp.x; f.pos.z = tp.z; f.pos.y = t.h - 0.35; }
    else { var rb = roomBounds(); f.pos.x = clamp(nx, rb.x0, rb.x1); f.pos.z = clamp(nz, -st.depth - 0.5, rb.z1); if (f.mount === "floor") f.pos.y = surfaceAt(f.pos.x, f.pos.z); }
    f.x = clamp(f.pos.x / st.width + 0.5, 0, 1);   // (the flat plot, if 3D isn't available)
    if (fixtures[f.id]) place(fixtures[f.id]);
  }
  // copies: the next free DMX address (after the last light in the universe; the next universe when it's full)
  function chCount(f) { var p = L.profileOf(f); return (p && p.ch && p.ch.length) || 1; }
  function nextAddress(uni, need) {
    var end = 0; L.rig().fixtures.forEach(function (g) { if ((g.universe || 1) === uni) end = Math.max(end, (g.address || 1) + chCount(g) - 1); });
    return end + need <= 512 ? { universe: uni, address: end + 1 } : nextAddress(uni + 1, need);
  }
  function nextName(name, mirror) {
    if (mirror) { if (/\bL\b|Left/.test(name)) return name.replace(/\bL\b/, "R").replace(/Left/, "Right"); if (/\bR\b|Right/.test(name)) return name.replace(/\bR\b/, "L").replace(/Right/, "Left"); }
    var base = String(name).replace(/\s*\d+$/, ""), n = 1, names = {}; L.rig().fixtures.forEach(function (g) { names[g.name] = 1; });
    while (names[base + " " + n]) n++; return base + " " + n;
  }
  function addCopy(src, mirror) {
    var f = JSON.parse(JSON.stringify(src)), at = nextAddress(src.universe || 1, chCount(src));
    f.id = uid(); f.name = nextName(src.name, mirror); f.universe = at.universe; f.address = at.address; f.pos = Object.assign({}, src.pos); f.aim = Object.assign({}, src.aim || {});
    if (mirror) { f.pos.x = -src.pos.x; if (f.aim.yaw) f.aim.yaw = -f.aim.yaw; } else { f.pos.x = src.pos.x + 0.5; }
    L.rig().fixtures.push(f); return f;
  }
  var clip = null;
  function picked() { return (multi.length ? multi : selected ? [selected] : []).map(fixtureById).filter(Boolean); }
  function copyPicked() { clip = picked().map(function (f) { return JSON.parse(JSON.stringify(f)); }); return clip.length; }
  function pastePicked() {
    if (!clip || !clip.length) return 0; remember(true);
    var made = clip.map(function (src) { var f = addCopy(src); moveFixtureTo(f, src.pos.x + 0.5, src.pos.z); return f.id; });
    fixKey = ""; L.saveRig(); if (L.renderAll) L.renderAll(); multi = made.length > 1 ? made : []; selected = made.length === 1 ? made[0] : null; paintSelection(); renderPanel(); frame(); return made.length;
  }
  // "spread N lights evenly along this truss": its lights move to even spacing; copies are added if there are too few
  function spreadOnTruss(t, n, template) {
    n = clamp(Math.round(n) || 0, 1, 64); var st = stage(), w = (t.width || st.width) * 0.9;
    var on = L.rig().fixtures.filter(function (f) { return f.mount === t.id; }).sort(function (a, b) { return trussAlong(t, a.pos.x, a.pos.z) - trussAlong(t, b.pos.x, b.pos.z); });
    var tpl = template || on[0]; if (!tpl) return "Pick a light first: it is copied along the truss.";
    remember(true);
    while (on.length < n) { var c = addCopy(tpl); c.mount = t.id; on.push(c); }
    on.slice(0, n).forEach(function (f, i) { var a = n === 1 ? 0 : -w / 2 + i * w / (n - 1), p = trussPoint(t, a); f.mount = t.id; f.pos = { x: p.x, y: t.h - 0.35, z: p.z }; f.x = clamp(p.x / st.width + 0.5, 0, 1); });
    fixKey = ""; L.saveRig(); if (L.renderAll) L.renderAll(); frame(); return "";
  }
  function alignPicked(how) {
    var list = picked(); if (list.length < 2) return; remember(true);
    if (how === "height") { var y = list[0].pos.y; list.forEach(function (f) { if (!L.trussById(f.mount)) f.pos.y = y; }); }
    else if (how === "row") { var z = list.reduce(function (s, f) { return s + f.pos.z; }, 0) / list.length; list.forEach(function (f) { moveFixtureTo(f, f.pos.x, z); }); }
    else if (how === "space") { list.sort(function (a, b) { return a.pos.x - b.pos.x; }); var x0 = list[0].pos.x, x1 = list[list.length - 1].pos.x; list.forEach(function (f, i) { moveFixtureTo(f, x0 + (x1 - x0) * i / (list.length - 1), f.pos.z); }); }
    else if (how === "mirror") { var made = list.map(function (f) { return addCopy(f, true).id; }); fixKey = ""; multi = list.map(function (f) { return f.id; }).concat(made); }
    list.forEach(function (f) { if (fixtures[f.id]) place(fixtures[f.id]); }); L.saveRig(); if (L.renderAll) L.renderAll(); renderPanel(); frame();
  }
  // which group a light usually belongs to from where it hangs (the auto lights and the AI work by group)
  function suggestGroup(f) {
    var st = stage(), p = f.pos || { x: 0, y: 0, z: 0 }, k = L.kindOf(f), t = L.trussById(f.mount), pitch = (f.aim && f.aim.pitch) || 0;
    if (k === "mover") return "beam"; if (k === "haze") return "haze"; if (k === "strobe" || k === "blinder") return f.group === "fx" || k === "strobe" ? "fx" : f.group;
    var overAud = p.z > 0.6 && p.y > 2.5;
    if (overAud && pitch > 55) return "house";
    if (f.mount === "balcony" || overAud) return "front";
    if (p.z < -st.depth * 0.55 || (t && t.d > st.depth * 0.5)) return "back";
    if (p.z > -0.8) return "front";
    return null;
  }
  // "Put it…": the usual places a light goes in a church
  function placeAt(f, where) {
    var st = stage(), W = st.width, D = st.depth, deck = Math.max(0, st.deck), tr = st.trusses || [], rb = roomBounds(), x = f.pos.x || 0, h = st.hall;
    var overStage = tr.filter(function (t) { return t.d >= 0 && t.d <= D; })[0], overAud = tr.filter(function (t) { return t.d < 0; }).sort(function (a, b) { return a.d - b.d; })[0];   // (the one furthest out)
    if (where === "over-stage") { if (overStage) { f.mount = overStage.id; var a = trussPoint(overStage, clamp(trussAlong(overStage, x, f.pos.z), -(overStage.width || W) / 2, (overStage.width || W) / 2)); f.pos = { x: a.x, y: overStage.h - 0.35, z: a.z }; } else { f.mount = "house"; f.pos = { x: x, y: 6, z: -D / 2 }; } f.aim = L.aimAt(f.pos, { x: f.pos.x * 0.7, y: deck + 1.4, z: -D * 0.4 }); }
    else if (where === "over-aud") { if (overAud) { f.mount = overAud.id; var b = trussPoint(overAud, clamp(x, -(overAud.width || W) / 2, (overAud.width || W) / 2)); f.pos = { x: b.x, y: overAud.h - 0.35, z: b.z }; } else { f.mount = "house"; f.pos = { x: x, y: Math.max(5, (tr[0] || {}).h || 5.5) + 0.5, z: 4 }; } f.aim = L.aimAt(f.pos, { x: f.pos.x * 0.6, y: deck + 1.6, z: -D * 0.35 }); }
    else if (where === "house") { f.mount = "house"; f.pos = { x: x, y: h && h.ceiling ? h.ceiling - 0.3 : 6, z: Math.max(2, f.pos.z > 1 ? f.pos.z : 5) }; f.aim = { yaw: 0, pitch: 90 }; }
    else if (where === "behind") { f.mount = "floor"; f.pos = { x: x, y: deck, z: -D + 0.4 }; f.aim = L.aimAt(f.pos, { x: x * 0.8, y: deck + 2.2, z: 0.5 }); }
    else if (where === "side-l" || where === "side-r") { var sx = (where === "side-l" ? -1 : 1) * (W / 2 + 0.6); f.mount = "floor"; f.pos = { x: sx, y: 0, z: -D / 2 }; f.pos.y = 1.6; f.aim = L.aimAt(f.pos, { x: 0, y: deck + 1.4, z: -D / 2 }); }
    else if (where === "foh") { f.mount = "house"; f.pos = { x: x, y: 4, z: clamp((rb.z1 || 14) * 0.6, 4, 40) }; f.aim = L.aimAt(f.pos, { x: x * 0.5, y: deck + 1.6, z: -D * 0.3 }); }
    else if (where === "balcony" && h && h.balcony && h.balcony.on) { f.mount = "balcony"; f.pos = { x: x, y: (h.balcony.height || 3.5) + 1.1, z: rb.z1 - (h.balcony.depth || 6) }; f.aim = L.aimAt(f.pos, { x: x * 0.5, y: deck + 1.6, z: -D * 0.35 }); }
    else if (where === "wall") { f.mount = "wall"; f.pos = { x: x >= 0 ? rb.x1 - 0.2 : rb.x0 + 0.2, y: 3, z: Math.max(1, f.pos.z) }; f.aim = L.aimAt(f.pos, { x: 0, y: deck + 1.5, z: -D * 0.4 }); }
    else if (where === "floor") { f.mount = "floor"; f.pos.y = surfaceAt(f.pos.x, f.pos.z); }
    if (L.kindOf(f) === "mover") f.aim.hang = f.mount === "floor" ? "up" : "down";
    f.x = clamp(f.pos.x / W + 0.5, 0, 1);
  }

  function mountOptions(f) {
    var st = stage(), h = st.hall;
    return [["floor", "On the floor (stage, behind it or the room)"]].concat((st.trusses || []).map(function (t) { return [t.id, "On the " + t.name]; })).concat([["house", "Hung over the room"], ["wall", "On a wall"]]).concat(h && h.balcony && h.balcony.on ? [["balcony", "On the balcony rail"]] : [])
      .map(function (o) { return '<option value="' + esc(o[0]) + '"' + (f.mount === o[0] ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("");
  }
  function num(attr, m, opt) { opt = opt || {}; return '<input type="number" step="' + (opt.step || stepU()) + '"' + (opt.min != null ? ' min="' + toU(opt.min) + '"' : "") + ' data-' + attr + ' value="' + toU(m) + '">'; }
  function renderPanel() {
    var el = $("#lx3dPanel"); if (!el) return; var f = selected && fixtureById(selected);
    if (!f && multi.length > 1) {   // several lights picked
      el.hidden = false;
      el.innerHTML = '<div class="lx3d-ph"><b>' + multi.length + ' lights picked</b><button class="mini" data-p3="close" title="Close" aria-label="Close">✕</button></div>' +
        '<p class="muted small">Ctrl-click (⌘ on a Mac) to pick more or fewer. Drag one to move them all.</p>' +
        '<div class="lx3d-aims"><button data-p3="al-height">Same height</button><button data-p3="al-row">In a row</button><button data-p3="al-space">Space evenly across</button><button data-p3="al-mirror">Mirror copies to the other side</button></div>' +
        '<div class="lx3d-row"><button data-p3="copy">Copy</button><button data-p3="paste"' + (clip && clip.length ? "" : " disabled") + ">Paste</button></div>";
      return;
    }
    if (!f) { el.hidden = true; return; }
    var kind = L.kindOf(f), aim = f.aim || {}, t = L.trussById(f.mount), g = (L.groups.filter(function (x) { return x[0] === f.group; })[0] || ["", f.group])[1];
    var sug = suggestGroup(f), sugName = sug && sug !== f.group ? (L.groups.filter(function (x) { return x[0] === sug; })[0] || ["", sug])[1] : "";
    el.hidden = false;
    el.innerHTML = '<div class="lx3d-ph"><b>' + esc(f.name) + '</b><span class="muted small">' + esc(g) + " · " + esc({ mover: "moving head", bar: L.cellsOf(f) + "-cell bar", strobe: "strobe", blinder: "blinder", haze: "hazer", par: "light" }[kind] || kind) + '</span><button class="mini" data-p3="close" title="Close" aria-label="Close">✕</button></div>' +
      (sugName ? '<p class="small lx3d-sug">Lights here are usually in the ' + esc(sugName) + ' group. <button class="mini" data-p3="use-group" data-g="' + esc(sug) + '">Use ' + esc(sugName) + "</button></p>" : "") +
      '<label>Hangs<select data-pf="mount">' + mountOptions(f) + "</select></label>" +
      '<div class="lx3d-put" aria-label="Put it">' + [["over-stage", "Over the stage"], ["over-aud", "Over the audience"], ["house", "House light"], ["behind", "Behind the stage"], ["side-l", "Side, left"], ["side-r", "Side, right"], ["foh", "Front of house"], ["wall", "On a wall"]].concat(stage().hall && stage().hall.balcony && stage().hall.balcony.on ? [["balcony", "Balcony rail"]] : []).map(function (p) { return '<button class="mini" data-put3="' + p[0] + '">' + p[1] + "</button>"; }).join("") + "</div>" +
      '<div class="lx3d-row"><label>Across (' + ul() + ")" + num('pf="x"', f.pos.x) + "</label>" +
      (t ? "" : '<label title="Positive: upstage. Negative: out over the audience.">From the front edge (' + ul() + ")" + num('pf="z"', -f.pos.z) + "</label>") +
      (t ? "" : '<label>Height (' + ul() + ")" + num('pf="y"', f.pos.y, { min: 0 }) + "</label>") + "</div>" +
      (kind === "mover" ? '<div class="lx3d-row"><label>Mounted<select data-pf="hang"><option value="down"' + ((aim.hang || "down") === "down" ? " selected" : "") + '>Hung (head down)</option><option value="up"' + (aim.hang === "up" ? " selected" : "") + '>Standing (head up)</option></select></label><label>Turns to<select data-pf="yaw0"><option value="0"' + (!aim.yaw ? " selected" : "") + ">Face the audience</option><option value=\"180\"" + (aim.yaw === 180 ? " selected" : "") + '>Face upstage</option></select></label></div><div class="lx3d-row"><label>Pan range (°)<input type="number" min="90" max="720" step="10" data-pf="panRange" value="' + (f.panRange || 540) + '"></label><label>Tilt range (°)<input type="number" min="90" max="360" step="10" data-pf="tiltRange" value="' + (f.tiltRange || 270) + '"></label></div><p class="muted small">Where it points comes from the presets (pan and tilt).</p>' :
        kind === "haze" ? "" :
        '<div class="lx3d-row"><label>Points (°)<input type="range" min="-180" max="180" step="1" data-pf="yaw" value="' + (aim.yaw || 0) + '"><output>' + dirName(aim.yaw || 0) + '</output></label><label>Tilt down (°)<input type="range" min="-90" max="90" step="1" data-pf="pitch" value="' + (aim.pitch || 0) + '"><output>' + (aim.pitch || 0) + "°</output></label></div>" +
        '<div class="lx3d-aims"><button data-p3="aim-stage">At the stage</button><button data-p3="aim-audience">At the audience</button><button data-p3="aim-down">Straight down</button><button data-p3="aim-up">Straight up</button><button data-p3="aim-wall">Back wall</button></div>' +
        '<details class="lx3d-aimat"><summary>Point at a spot</summary><div class="lx3d-row"><label>Across (' + ul() + ")" + num('pa="x"', 0) + '</label><label>From the front (' + ul() + ")" + num('pa="z"', stage().depth * 0.4) + '</label><label>Height (' + ul() + ")" + num('pa="y"', Math.max(0, stage().deck) + 1.5) + '</label></div><button class="mini" data-p3="aim-at">Point it there</button></details>' +
        (kind === "bar" || kind === "strobe" || kind === "blinder" ? '<label class="toggle"><input type="checkbox" data-pf="roll"' + (f.roll ? " checked" : "") + "> Stood on end (vertical)</label>" : "")) +
      '<div class="lx3d-row"><button data-p3="find">Find</button><button data-p3="restore" title="Back to where this group usually goes">Put back</button><button data-p3="copy" title="Ctrl+C">Copy</button><button data-p3="paste" title="Ctrl+V"' + (clip && clip.length ? "" : " disabled") + '>Paste</button><button data-p3="mirror" title="A copy on the other side">Mirror</button></div>';
  }
  function dirName(y) { y = ((y % 360) + 540) % 360 - 180; var a = Math.abs(y); return a < 23 ? "the audience" : a > 157 ? "upstage" : a < 68 ? (y > 0 ? "audience, stage left" : "audience, stage right") : a <= 112 ? (y > 0 ? "stage left" : "stage right") : (y > 0 ? "upstage left" : "upstage right"); }
  function renderPanelValues() { var el = $("#lx3dPanel"), f = selected && fixtureById(selected); if (!el || !f) return; ["x", "y", "z"].forEach(function (k) { var i = el.querySelector('[data-pf="' + k + '"]'); if (i && document.activeElement !== i) i.value = toU(k === "z" ? -f.pos.z : f.pos[k]); }); }
  function panelField(el) {
    var f = selected && fixtureById(selected); if (!f) return; var k = el.dataset.pf, v = el.type === "checkbox" ? el.checked : el.value, st = stage();
    if (!k) return; remember(); f.aim = f.aim || {};
    if (k === "mount") {
      f.mount = v; var t = L.trussById(v), rb = roomBounds();
      if (t) { var a = trussPoint(t, clamp(trussAlong(t, f.pos.x, f.pos.z), -(t.width || st.width) / 2, (t.width || st.width) / 2)); f.pos = { x: a.x, y: t.h - 0.35, z: a.z }; }
      else if (v === "house") { f.pos.y = Math.max(5, (st.trusses[0] || {}).h || 5.5) + 0.5; f.pos.z = Math.max(2, f.pos.z); }
      else if (v === "wall") { f.pos.x = f.pos.x >= 0 ? rb.x1 - 0.2 : rb.x0 + 0.2; f.pos.y = Math.max(2, f.pos.y); }
      else if (v === "balcony") placeAt(f, "balcony");
      else f.pos.y = surfaceAt(f.pos.x, f.pos.z);
      if (L.kindOf(f) === "mover") f.aim.hang = v === "floor" ? "up" : "down"; fixKey = ""; renderPanel();
    }
    else if (k === "x") { var t2 = L.trussById(f.mount); if (t2) { var p2 = trussPoint(t2, clamp(fromU(v) - (t2.x || 0), -(t2.width || st.width) / 2, (t2.width || st.width) / 2)); f.pos.x = p2.x; f.pos.z = p2.z; } else f.pos.x = fromU(v); }
    else if (k === "z") { f.pos.z = -fromU(v); if (f.mount === "floor") f.pos.y = surfaceAt(f.pos.x, f.pos.z); }
    else if (k === "y") f.pos.y = clamp(fromU(v), 0, 30);
    else if (k === "hang") { f.aim.hang = v; fixKey = ""; }
    else if (k === "yaw0") f.aim.yaw = Number(v);
    else if (k === "panRange" || k === "tiltRange") f[k] = clamp(Number(v) || (k === "panRange" ? 540 : 270), 90, 720);
    else if (k === "yaw" || k === "pitch") { f.aim[k] = Number(v); var out = el.parentNode.querySelector("output"); if (out) out.textContent = k === "yaw" ? dirName(Number(v)) : v + "°"; }
    else if (k === "roll") f.roll = v ? 90 : 0;
    f.x = clamp(f.pos.x / st.width + 0.5, 0, 1);
    L.saveRig(); frame();
  }
  function panelAction(a, b) {
    if (a === "close") { selected = null; multi = []; paintSelection(); renderPanel(); frame(); return; }
    if (a === "copy") { copyPicked(); renderPanel(); return; }
    if (a === "paste") { pastePicked(); return; }
    if (a.indexOf("al-") === 0) { alignPicked(a.slice(3)); return; }
    var f = selected && fixtureById(selected); if (!f) return;
    var st = stage(), p = f.pos, deck = Math.max(0, st.deck);
    remember(true);
    var targets = { "aim-stage": { x: p.x * 0.5, y: deck + 1.4, z: -st.depth * 0.4 }, "aim-audience": { x: p.x * 0.6, y: 1.2, z: 4 }, "aim-wall": { x: p.x, y: 3, z: -st.depth - 0.6 } };
    if (targets[a]) f.aim = Object.assign(f.aim || {}, L.aimAt(p, targets[a]));
    else if (a === "aim-down") f.aim = Object.assign(f.aim || {}, { pitch: 90 });
    else if (a === "aim-up") f.aim = Object.assign(f.aim || {}, { pitch: -90 });
    else if (a === "aim-at") { var pe = $("#lx3dPanel"), q = function (k) { return fromU(pe.querySelector('[data-pa="' + k + '"]').value); }; f.aim = Object.assign(f.aim || {}, L.aimAt(p, { x: q("x"), y: q("y"), z: -q("z") })); }
    else if (a === "find") { L.identify(f.id); return; }
    else if (a === "use-group") { f.group = b.dataset.g; fixKey = ""; if (L.dirty) L.dirty(); if (L.renderAll) L.renderAll(); }
    else if (a === "mirror") { var m = addCopy(f, true); fixKey = ""; selected = m.id; if (L.renderAll) L.renderAll(); }
    else if (a === "restore") { delete f.mount; delete f.pos; L.placeFixture(f, 0, 1); f.pos.x = (f.x != null ? (f.x - 0.5) * st.width * 0.9 : 0); fixKey = ""; }
    L.saveRig(); renderPanel(); frame();
  }
  function putAction(where) { var f = selected && fixtureById(selected); if (!f) return; remember(true); placeAt(f, where); fixKey = ""; L.saveRig(); renderPanel(); frame(); }
  function renderStage() {
    var el = $("#lx3dStage"), st = stage(), u = ul();
    el.innerHTML = '<div class="lx3d-ph"><b>Stage &amp; trusses</b><button class="mini" data-s3="close" title="Close" aria-label="Close">✕</button></div>' +
      '<div class="lx3d-row"><label>Units<select data-sf="units"><option value="ft"' + (u === "ft" ? " selected" : "") + '>Feet</option><option value="m"' + (u === "m" ? " selected" : "") + '>Metres</option></select></label><label class="toggle"><input type="checkbox" data-sf="snap"' + (L.rig().snap === false ? "" : " checked") + "> Snap to a " + (u === "ft" ? "half-foot" : "25 cm") + " grid</label></div>" +
      '<div class="lx3d-row"><label>Stage width (' + u + ")" + num('sf="width"', st.width, { min: 2 }) + '</label><label>Stage depth (' + u + ")" + num('sf="depth"', st.depth, { min: 1 }) + "</label></div>" +
      '<div class="lx3d-row"><label>Stage height (' + u + ')<input type="number" min="0" step="' + (u === "ft" ? 0.25 : 0.05) + '" data-sf="deck" value="' + toU(st.deck) + '"></label><label>Room in front (' + u + ")" + num('sf="room"', st.room || 14, { min: 4 }) + "</label></div>" +
      '<div class="lx3d-row"><label>Shape<select data-sf="shape">' + [["rect", "Rectangle"], ["thrust", "Thrust (a runway out front)"], ["round", "Round front"]].map(function (o) { return '<option value="' + o[0] + '"' + ((st.shape || "rect") === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select></label></div>" + '<div class="lx3d-row">' +
      (st.shape === "thrust" ? '<label>Thrust width (' + u + ")" + num('sf="thrustW"', st.thrustW || Math.round(st.width * 0.4 * 2) / 2) + '</label><label>Thrust length (' + u + ")" + num('sf="thrustD"', st.thrustD || 2.5) + "</label>" : st.shape === "round" ? '<label>Round front depth (' + u + ")" + num('sf="apronD"', st.apronD || Math.round(st.width * 0.22 * 4) / 4) + "</label>" : "") + "</div>" +
      '<b class="small">Risers</b><table class="lx3d-trusses"><thead><tr><th>Riser</th><th title="From stage centre: negative = stage right">Across</th><th title="From the front edge, upstage">Back</th><th>W</th><th>D</th><th>H</th><th></th></tr></thead><tbody>' +
      (st.risers || []).map(function (r, i) { return '<tr data-ri="' + i + '"><td><input data-sf="r-name" value="' + esc(r.name || "Riser") + '"></td><td>' + num('sf="r-x"', r.x || 0) + "</td><td>" + num('sf="r-z"', r.z != null ? r.z : Math.round(st.depth * 0.7 * 4) / 4) + "</td><td>" + num('sf="r-w"', r.w || 2.4) + "</td><td>" + num('sf="r-d"', r.d || 2.4) + "</td><td>" + num('sf="r-h"', r.h || 0.4) + '</td><td><button class="mini" data-s3="r-del" title="Remove this riser" aria-label="Remove this riser">✕</button></td></tr>'; }).join("") + "</tbody></table>" +
      '<div class="lx3d-row"><button data-s3="r-add">+ Riser</button><button data-s3="r-drums">+ Drum riser</button></div>' +
      '<div class="lx3d-row"><label>3D view height (px)<input type="number" min="240" max="900" step="20" data-sf="view-h" value="' + (L.rig().stageH || 440) + '"></label></div>' +
      '<b class="small">Trusses and pipes</b><table class="lx3d-trusses"><thead><tr><th>Name</th><th title="From the stage\'s front edge: negative = out over the audience">From the front</th><th title="Its middle, from the stage centre">Across</th><th>Height</th><th>Length</th><th title="0 = runs across; 90 = front to back (a side truss)">Turn °</th><th>Kind</th><th title="Spread this many lights evenly along it">Spread</th><th></th></tr></thead><tbody>' +
      (st.trusses || []).map(function (t, i) { return '<tr data-ti="' + i + '"><td><input data-sf="t-name" value="' + esc(t.name) + '"></td><td>' + num('sf="t-d"', t.d) + "</td><td>" + num('sf="t-x"', t.x || 0) + "</td><td>" + num('sf="t-h"', t.h, { min: 1 }) + "</td><td>" + num('sf="t-width"', t.width || st.width, { min: 1 }) + '</td><td><input type="number" step="15" data-sf="t-yaw" value="' + (t.yaw || 0) + '"></td><td><select data-sf="t-kind"><option value="truss"' + (t.kind !== "pipe" ? " selected" : "") + '>Truss</option><option value="pipe"' + (t.kind === "pipe" ? " selected" : "") + '>Pipe</option></select></td><td class="lx3d-spread"><input type="number" min="1" max="64" value="' + Math.max(1, L.rig().fixtures.filter(function (f) { return f.mount === t.id; }).length || 4) + '" data-spread-n><button class="mini" data-s3="t-spread" title="Spread this many lights evenly along it (the picked light is copied if more are needed)">Spread</button></td><td><button class="mini" data-s3="t-del" title="Remove it" aria-label="Remove it">✕</button></td></tr>'; }).join("") + "</tbody></table>" +
      '<div class="lx3d-row lx3d-wrap"><button data-s3="t-add" data-tk="stage">+ Truss over the stage</button><button data-s3="t-add" data-tk="aud">+ Truss over the audience</button><button data-s3="t-add" data-tk="up">+ Upstage truss</button><button data-s3="t-add" data-tk="sides">+ Side trusses</button><button data-s3="t-add" data-tk="pipe">+ Pipe</button><button data-s3="reset">Standard stage</button></div><p class="muted small" id="lx3dStageMsg">Lights on a truss move with it. Screens and projectors: + Screen on the bar.</p>';
  }
  function stageField(el) {
    var st = stage(), k = el.dataset.sf, v = el.value; if (!k) return;
    if (k === "units") { L.rig().units = v; L.saveRig(); renderStage(); renderPanel(); if (EXT.changed) EXT.changed(); return; }
    if (k === "snap") { L.rig().snap = el.checked; L.saveRig(); return; }
    remember();
    var lens = { width: 1, depth: 1, deck: 1, room: 1, thrustW: 1, thrustD: 1, apronD: 1 };
    if (k === "shape") { st.shape = v; renderStage(); }
    else if (k === "view-h") { L.stageSize(Number(v) || 440); applyBig(); lastW = 0; frame(); return; }
    else if (k.indexOf("r-") === 0) { var r0 = (st.risers || [])[Number(el.closest("[data-ri]").dataset.ri)], rk = k.slice(2); if (!r0) return; r0[rk] = rk === "name" ? v : fromU(v); }
    else if (k.indexOf("t-") === 0) {
      var t = st.trusses[Number(el.closest("[data-ti]").dataset.ti)], f2 = k.slice(2); if (!t) return;
      var on = L.rig().fixtures.filter(function (f) { return f.mount === t.id; }).map(function (f) { return { f: f, a: trussAlong(t, f.pos.x, f.pos.z) }; });   // (where each light is along it, kept)
      t[f2] = f2 === "name" ? v : f2 === "kind" ? v : f2 === "yaw" ? (Number(v) || 0) : fromU(v);
      on.forEach(function (o) { var p = trussPoint(t, clamp(o.a, -(t.width || st.width) / 2, (t.width || st.width) / 2)); o.f.pos.x = p.x; o.f.pos.z = p.z; o.f.pos.y = t.h - 0.35; });
    } else if (lens[k]) st[k] = fromU(v);
    L.rig().fixtures.forEach(function (f) { if (f.mount === "floor") f.pos.y = surfaceAt(f.pos.x, f.pos.z); });
    L.saveRig(); roomKey = ""; fixKey = ""; frame();
  }
  function stageAction(a, b) {
    var st = stage();
    if (a === "close") { $("#lx3dStage").hidden = true; return; }
    remember(true);
    if (a === "r-add" || a === "r-drums") { st.risers = st.risers || []; st.risers.push(a === "r-drums" ? { name: "Drum riser", x: 0, z: Math.round(st.depth * 0.72 * 4) / 4, w: 2.4, d: 2.4, h: 0.4 } : { name: "Riser " + (st.risers.length + 1), x: st.risers.length % 2 ? 2.5 : -2.5, z: Math.round(st.depth * 0.6 * 4) / 4, w: 2, d: 1.2, h: 0.2 }); }
    else if (a === "r-del") { st.risers.splice(Number(b.closest("[data-ri]").dataset.ri), 1); }
    if (a === "t-add") {
      var tk = b.dataset.tk || "stage", hh = (st.trusses[0] || {}).h || 5.5, add = function (t) { t.id = "t" + uid().slice(0, 5); st.trusses.push(t); };
      if (tk === "stage") add({ name: "Truss " + (st.trusses.length + 1), d: Math.round(st.depth * 0.5 * 4) / 4, h: hh, width: st.width });
      else if (tk === "aud") add({ name: "Audience truss", d: -Math.round((st.room || 14) * 0.35), h: hh + 0.5, width: st.width + 2 });
      else if (tk === "up") add({ name: "Upstage truss", d: Math.round((st.depth - 0.3) * 4) / 4, h: hh, width: st.width });
      else if (tk === "sides") { add({ name: "Side truss left", d: st.depth / 2, x: -st.width / 2 - 0.8, h: hh, width: st.depth + 2, yaw: 90 }); add({ name: "Side truss right", d: st.depth / 2, x: st.width / 2 + 0.8, h: hh, width: st.depth + 2, yaw: 90 }); }
      else if (tk === "pipe") add({ name: "Pipe " + (st.trusses.length + 1), d: Math.round(st.depth * 0.3 * 4) / 4, h: hh - 0.5, width: st.width, kind: "pipe" });
    }
    else if (a === "t-spread") { var t0 = st.trusses[Number(b.closest("[data-ti]").dataset.ti)], n = Number(b.parentNode.querySelector("[data-spread-n]").value) || 1, msg = spreadOnTruss(t0, n, selected ? fixtureById(selected) : null); if (msg) { var m = $("#lx3dStageMsg"); if (m) m.textContent = msg; return; } }
    else if (a === "t-del") { var i = Number(b.closest("[data-ti]").dataset.ti), t = st.trusses[i], used = L.rig().fixtures.filter(function (f) { return f.mount === t.id; }); if (used.length && !confirm(used.length + " light" + (used.length === 1 ? " hangs" : "s hang") + " on the " + t.name + ". Remove it? They go to the floor.")) return; used.forEach(function (f) { f.mount = "floor"; f.pos.y = surfaceAt(f.pos.x, f.pos.z); }); st.trusses.splice(i, 1); fixKey = ""; }
    else if (a === "reset") { if (!confirm("Go back to a standard 33 × 20 ft (10 × 6 m) stage with three trusses? Lights on trusses that go away move to the floor.")) return; var keepT = L.defaultStage(); ["hall", "screens", "projectors", "props", "trace"].forEach(function (k) { if (st[k]) keepT[k] = st[k]; }); L.rig().stage = keepT; L.rig().fixtures.forEach(function (f) { var t2 = L.trussById(f.mount); if (t2) { f.pos.y = t2.h - 0.35; f.pos.z = -t2.d; } else if (f.mount !== "house") { f.mount = "floor"; f.pos.y = surfaceAt(f.pos.x, f.pos.z); } }); fixKey = ""; }
    L.saveRig(); roomKey = ""; renderStage(); renderPanel(); frame();
  }
  // keys on the lights page: undo / redo, copy / paste, arrows nudge the picked lights one grid step
  document.addEventListener("keydown", function (e) {
    if (!L.isShowing() || /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || "") || (e.target && e.target.isContentEditable)) return;
    var mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (mod && k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (mod && (k === "y" || (k === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
    else if (mod && k === "c" && picked().length) { e.preventDefault(); copyPicked(); renderPanel(); }
    else if (mod && k === "v" && clip && clip.length) { e.preventDefault(); pastePicked(); }
    else if (/^arrow/.test(k) && picked().length) {
      e.preventDefault(); remember(); var g = Math.max(gridStep(), 0.05), dx = k === "arrowleft" ? -g : k === "arrowright" ? g : 0, dz = k === "arrowup" ? -g : k === "arrowdown" ? g : 0;
      picked().forEach(function (f) { moveFixtureTo(f, f.pos.x + dx, f.pos.z + dz); }); L.saveRig(); renderPanelValues(); frame();
    }
  });

  // ------------------------------------------------------------- (10.2) what the other 3D modules use
  EXT.bar = {};
  EXT.barButton = function (id, label, title, fn) {   // a button on the bar (screens, the room, the stage builder)
    EXT.bar[id] = fn; var box = ui.querySelector(".lx3d-ext"); if (!box || box.querySelector('[data-ext3="' + id + '"]')) return;
    var b = document.createElement("button"); b.dataset.ext3 = id; b.textContent = label; if (title) b.title = title; box.appendChild(b);
  };
  EXT.panel = function (id) {   // an overlay panel of its own, styled like the light's panel
    var el = document.getElementById(id); if (el) return el;
    el = document.createElement("div"); el.className = "lx3d-panel lx3d-xpanel"; el.id = id; el.hidden = true; ui.appendChild(el);
    ["pointerdown", "wheel"].forEach(function (ev) { el.addEventListener(ev, function (e) { e.stopPropagation(); }, { passive: true }); });
    return el;
  };
  EXT.closeOthers = function (keep) {   // one overlay at a time
    if (keep !== "fixture") { selected = null; multi = []; paintSelection(); renderPanel(); }
    if (keep !== "stage") { var sp = $("#lx3dStage"); if (sp) sp.hidden = true; }
    EXT.selectHooks.forEach(function (fn) { fn(keep); });
  };
  Object.assign(EXT, { T: T, L: L, scene: scene, camera: camera, renderer: renderer, canvas: canvas, ui: ui, host: host, M: M, planeGeo: planeGeo, stage: stage, surfaceAt: surfaceAt, onDeck: onDeck, roomBounds: roomBounds,
    units: units, toU: toU, fromU: fromU, stepU: stepU, snapV: snapV, num: num, esc: esc, uid: uid, remember: remember, frame: frame, roomy: roomy, trussPoint: trussPoint, trussAlong: trussAlong, placeAt: placeAt, suggestGroup: suggestGroup,
    spreadOnTruss: spreadOnTruss, addCopy: addCopy, nextAddress: nextAddress, moveFixtureTo: moveFixtureTo, undo: undo, redo: redo, view: view,
    rebuildRoom: function () { roomKey = ""; }, rebuildFixtures: function () { fixKey = ""; }, renderStagePanel: function () { var sp = $("#lx3dStage"); if (sp && !sp.hidden) renderStage(); } });
  // a pixel of the 3D picture where a point in the room lands (the tests read the screens' pictures this way)
  EXT.sample = function (x, y, z) {
    return new Promise(function (res) {
      EXT.afterRender = function () {
        var v = new T.Vector3(x, y, z).project(camera), gl = renderer.getContext(), w = renderer.domElement.width, h = renderer.domElement.height, px = new Uint8Array(4);
        gl.readPixels(Math.round((v.x + 1) / 2 * w), Math.round((v.y + 1) / 2 * h), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); res(Array.from(px));
      };
      frame();
    });
  };

  // ------------------------------------------------------------- start
  applyBig();
  if (window.ResizeObserver) new ResizeObserver(function () { if (L.isShowing()) frame(); }).observe(host);
  window.CULights3D = { active: function () { return ok; }, frame: frame, rebuild: function () { fixKey = ""; roomKey = ""; if (L.isShowing()) frame(); }, view: view, select: function (id) { selected = id; paintSelection(); if (id) roomy(); renderPanel(); frame(); }, big: function () { return big; },
    selected: function () { return selected; }, sizeLabel: applyBig, count: function () { return Object.keys(fixtures).length; }, emitters: function (id) { var o = fixtures[id]; return o ? o.emitters.length : 0; }, camera: function () { return cam; },
    ext: EXT, picked: function () { return multi.length ? multi.slice() : selected ? [selected] : []; }, pick: function (ids) { ids = ids || []; if (ids.length > 1) { selected = null; multi = ids.slice(); } else { selected = ids[0] || null; multi = []; } paintSelection(); renderPanel(); frame(); } };
})();
