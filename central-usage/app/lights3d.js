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
  var ok = false, renderer = null, scene, camera, roomGroup, fixGroup, fixtures = {}, roomKey = "", fixKey = "", selected = null, showNames = false;
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

  // ------------------------------------------------------------- materials and textures
  function canvasTex(w, h, draw) { var c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h); var t = new T.CanvasTexture(c); t.colorSpace = T.SRGBColorSpace; return t; }
  var poolTex = canvasTex(128, 128, function (g, w, h) { var gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.35, "rgba(255,255,255,.55)"); gr.addColorStop(0.75, "rgba(255,255,255,.12)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  var glowTex = canvasTex(64, 64, function (g, w, h) { var gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.25, "rgba(255,255,255,.6)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  var boardsTex = canvasTex(512, 512, function (g, w, h) { g.fillStyle = "#17191e"; g.fillRect(0, 0, w, h); for (var y = 0; y < h; y += 32) { g.fillStyle = "rgba(255,255,255," + (0.012 + ((y / 32) % 3) * 0.006) + ")"; g.fillRect(0, y, w, 31); g.fillStyle = "rgba(0,0,0,.35)"; g.fillRect(0, y + 31, w, 1); } });
  boardsTex.wrapS = boardsTex.wrapT = T.RepeatWrapping;
  var M = {
    floor: new T.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.95 }),
    deck: new T.MeshStandardMaterial({ color: 0xffffff, map: boardsTex, roughness: 0.8 }),
    deckSide: new T.MeshStandardMaterial({ color: 0x0f1114, roughness: 0.9 }),
    wall: new T.MeshStandardMaterial({ color: 0x0a0b0e, roughness: 1 }),
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
  function buildRoom() {
    var st = stage(), k = JSON.stringify(st); if (k === roomKey) return; roomKey = k;
    while (roomGroup.children.length) { var c = roomGroup.children.pop(); if (c.geometry && c.geometry !== planeGeo) c.geometry.dispose(); }
    var W = st.width, D = st.depth, deck = Math.max(0, st.deck), R = Math.max(4, st.room || 14), roomW = W + 10;
    var floor = new T.Mesh(new T.PlaneGeometry(roomW, D + R + 3), M.floor); floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, (R - D - 3) / 2 + 0); roomGroup.add(floor);
    if (deck > 0.001) { var box = new T.Mesh(new T.BoxGeometry(W, deck, D), [M.deckSide, M.deckSide, M.deck, M.deckSide, M.deckSide, M.deckSide]); box.position.set(0, deck / 2, -D / 2); M.deck.map.repeat.set(W / 4, D / 4); roomGroup.add(box); }
    else { var top = new T.Mesh(new T.PlaneGeometry(W, D), M.deck); top.rotation.x = -Math.PI / 2; top.position.set(0, 0.002, -D / 2); roomGroup.add(top); }
    var edge = new T.Mesh(new T.BoxGeometry(W, 0.012, 0.03), lip); edge.position.set(0, deck + 0.006, 0); roomGroup.add(edge);
    var wall = new T.Mesh(new T.PlaneGeometry(roomW, 9), M.wall); wall.position.set(0, 4.5, -D - 0.6); roomGroup.add(wall);
    // the audience: rows of seats
    var cols = Math.max(4, Math.floor((W + 2) / 0.6)), rows = Math.max(1, Math.floor((R - 3) / 1.0)), seat = new T.BoxGeometry(0.46, 0.45, 0.46);
    var inst = new T.InstancedMesh(seat, M.seat, cols * rows), m4 = new T.Matrix4(), n = 0;
    for (var r = 0; r < rows; r++) for (var c2 = 0; c2 < cols; c2++) { if (Math.abs(c2 - (cols - 1) / 2) < 0.8) continue; m4.makeTranslation((c2 - (cols - 1) / 2) * 0.6, 0.225, 2.6 + r * 1.0); inst.setMatrixAt(n++, m4); }
    inst.count = n; roomGroup.add(inst);
    (st.trusses || []).forEach(function (t) { roomGroup.add(trussMesh(t)); });
  }
  function trussMesh(t) {   // a 30 cm box truss: four chords and the zig-zag braces
    var g = new T.Group(), w = Math.max(1, t.width || 8), s = 0.3, chord = new T.CylinderGeometry(0.024, 0.024, w, 8); chord.rotateZ(Math.PI / 2);
    [[-1, -1], [-1, 1], [1, -1], [1, 1]].forEach(function (q) { var m = new T.Mesh(chord, M.truss); m.position.set(0, q[0] * s / 2, q[1] * s / 2); g.add(m); });
    var pts = [], steps = Math.round(w / 0.5);
    for (var i = 0; i < steps; i++) { var x0 = -w / 2 + i * w / steps, x1 = x0 + w / steps; pts.push(x0, -s / 2, s / 2, x1, s / 2, s / 2, x0, -s / 2, -s / 2, x1, s / 2, -s / 2, x0, s / 2, -s / 2, x1, s / 2, s / 2, x0, -s / 2, -s / 2, x1, -s / 2, s / 2); }
    var lg = new T.BufferGeometry(); lg.setAttribute("position", new T.Float32BufferAttribute(pts, 3));
    g.add(new T.LineSegments(lg, new T.LineBasicMaterial({ color: 0x8a919b, transparent: true, opacity: 0.7 })));
    g.position.set(0, t.h, -t.d); return g;
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
      if (tDeck > 0 && Math.abs(hx) <= W / 2 && hz <= 0 && hz >= -D) { best = tDeck; surf = "deck"; }
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
    var rig = L.rig(), live = L.live, haze = hazeLevel(), beamK = 0.26 + 0.6 * haze;
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
    placeCamera(); renderer.render(scene, camera); drawLabels();
  }

  // ------------------------------------------------------------- the camera: turn, slide, zoom; views
  var cam = Object.assign({ yaw: 0.6, pitch: 0.42, dist: 12, tx: 0, ty: 1.8, tz: -3 }, store.cam || {});
  var big = !!store.big; function applyBig() { var m = host.closest(".lx-showmain"); if (m) m.classList.toggle("lx-big", big); var b = ui.querySelector("[data-big3]"); if (b) { b.textContent = big ? "Smaller" : "Bigger"; b.setAttribute("aria-pressed", String(big)); } }
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
  function roomy() { if (!big && host.clientHeight < 430) { big = true; applyBig(); keep(); lastW = 0; } }
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
  canvas.addEventListener("pointerdown", function (e) {
    canvas.setPointerCapture(e.pointerId);
    var id = e.button === 0 && !e.shiftKey ? pickAt(e) : null;
    if (id) {
      if (selected !== id) { selected = id; paintSelection(); roomy(); var sp0 = $("#lx3dStage"); if (sp0) sp0.hidden = true; renderPanel(); }
      var f = fixtureById(id), p = onPlane(e, f.pos.y);
      drag = { mode: "fixture", f: f, start: p, from: Object.assign({}, f.pos), moved: false, x: e.clientX, y: e.clientY };
    } else drag = { mode: e.button === 2 || e.shiftKey ? "slide" : "turn", x: e.clientX, y: e.clientY, cam: Object.assign({}, cam), moved: false };
  });
  canvas.addEventListener("pointermove", function (e) {
    if (!drag) { var h2 = pickAt(e); if (h2 !== hover) { hover = h2; canvas.style.cursor = h2 ? "grab" : "default"; frame(); } return; }
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    if (drag.mode === "turn") { cam.yaw = drag.cam.yaw - dx * 0.006; cam.pitch = clamp(drag.cam.pitch + dy * 0.005, 0.02, 1.55); }
    else if (drag.mode === "slide") { var s = cam.dist * 0.0016, cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw); cam.tx = drag.cam.tx - (dx * cy) * s; cam.tz = drag.cam.tz + (dx * sy) * s; cam.ty = clamp(drag.cam.ty + dy * s, 0, 8); }
    else if (drag.mode === "fixture" && drag.start && drag.moved) {
      var f = drag.f, p = onPlane(e, drag.from.y); if (!p) return; canvas.style.cursor = "grabbing";
      var st = stage(), nx = Math.round((drag.from.x + p.x - drag.start.x) * 20) / 20, nz = Math.round((drag.from.z + p.z - drag.start.z) * 20) / 20, t = L.trussById(f.mount);
      f.pos.x = clamp(nx, -(t ? (t.width || st.width) : st.width + 8) / 2, (t ? (t.width || st.width) : st.width + 8) / 2);
      if (!t) f.pos.z = clamp(nz, -st.depth - 0.3, Math.max(4, st.room || 14) - 0.5);
      if (!t && f.mount !== "house") f.pos.y = surfaceAt(f.pos.x, f.pos.z);
      f.x = clamp(f.pos.x / st.width + 0.5, 0, 1);   // (the flat plot, if 3D isn't available)
      place(fixtures[f.id]); renderPanelValues();
    }
    frame();
  });
  canvas.addEventListener("pointerup", function () {
    if (drag && drag.mode === "fixture" && drag.moved) L.saveRig();
    else if (drag && !drag.moved && drag.mode !== "fixture") { selected = null; paintSelection(); renderPanel(); }
    if (drag && (drag.mode === "turn" || drag.mode === "slide")) keep();
    drag = null; canvas.style.cursor = hover ? "grab" : "default"; frame();
  });
  canvas.addEventListener("wheel", function (e) { e.preventDefault(); cam.dist = clamp(cam.dist * Math.pow(1.0015, e.deltaY), 2.5, 80); keep(); frame(); }, { passive: false });
  function surfaceAt(x, z) { var st = stage(); return Math.abs(x) <= st.width / 2 && z <= 0 && z >= -st.depth ? Math.max(0, st.deck) : 0; }
  function fixtureById(id) { return L.rig().fixtures.filter(function (f) { return f.id === id; })[0] || null; }
  function paintSelection() { Object.keys(fixtures).forEach(function (id) { fixtures[id].sel.visible = id === selected; }); }

  // ------------------------------------------------------------- the overlay: views, names, stage, the light's panel
  ui.innerHTML = '<div class="lx3d-bar"><div class="lx3d-views" role="group" aria-label="View">' +
    [["audience", "Audience"], ["corner", "Corner"], ["top", "Top"], ["side", "Side"]].map(function (v) { return '<button data-v3="' + v[0] + '">' + v[1] + "</button>"; }).join("") + '</div>' +
    '<label class="toggle lx3d-names"><input type="checkbox" data-n3' + (showNames ? " checked" : "") + '> Names</label><button data-stage3>Stage &amp; trusses</button><button data-big3 aria-pressed="false">Bigger</button></div>' +
    '<div class="lx3d-panel" id="lx3dPanel" hidden></div><div class="lx3d-stage" id="lx3dStage" hidden></div>' +
    '<p class="lx3d-hint">Drag to turn · right-drag to slide · wheel to zoom · click a light to place it</p>';
  ui.addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    if (b.dataset.v3) view(b.dataset.v3);
    else if (b.hasAttribute("data-big3")) { big = !big; applyBig(); keep(); lastW = 0; frame(); }
    else if (b.hasAttribute("data-stage3")) { var sp = $("#lx3dStage"); sp.hidden = !sp.hidden; if (!sp.hidden) { roomy(); selected = null; paintSelection(); renderPanel(); renderStage(); } }
    else if (b.dataset.p3) panelAction(b.dataset.p3);
    else if (b.dataset.s3) stageAction(b.dataset.s3, b);
  });
  ui.addEventListener("change", function (e) { if (e.target.hasAttribute("data-n3")) { showNames = e.target.checked; keep(); frame(); } });
  ui.addEventListener("input", function (e) { var el = e.target; if (el.dataset.pf) panelField(el); else if (el.dataset.sf) stageField(el); });
  ["pointerdown", "wheel"].forEach(function (ev) { ui.addEventListener(ev, function (e) { if (e.target.closest(".lx3d-panel,.lx3d-stage,.lx3d-bar")) e.stopPropagation(); }, { passive: true }); });

  function mountOptions(f) {
    var st = stage(); return [["floor", "On the floor (stage or room)"]].concat((st.trusses || []).map(function (t) { return [t.id, "On the " + t.name]; })).concat([["house", "Over the audience"]])
      .map(function (o) { return '<option value="' + esc(o[0]) + '"' + (f.mount === o[0] ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("");
  }
  function renderPanel() {
    var el = $("#lx3dPanel"); if (!el) return; var f = selected && fixtureById(selected);
    if (!f) { el.hidden = true; return; }
    var kind = L.kindOf(f), aim = f.aim || {}, t = L.trussById(f.mount), g = (L.groups.filter(function (x) { return x[0] === f.group; })[0] || ["", f.group])[1];
    el.hidden = false;
    el.innerHTML = '<div class="lx3d-ph"><b>' + esc(f.name) + '</b><span class="muted small">' + esc(g) + " · " + esc({ mover: "moving head", bar: L.cellsOf(f) + "-cell bar", strobe: "strobe", blinder: "blinder", haze: "hazer", par: "light" }[kind] || kind) + '</span><button class="mini" data-p3="close" title="Close" aria-label="Close">✕</button></div>' +
      '<label>Hangs<select data-pf="mount">' + mountOptions(f) + "</select></label>" +
      '<div class="lx3d-row"><label>Across (m)<input type="number" step="0.05" data-pf="x" value="' + f.pos.x + '"></label>' +
      (t ? "" : '<label>From the front edge (m)<input type="number" step="0.05" data-pf="z" value="' + (-f.pos.z).toFixed(2) + '" title="Positive: upstage. Negative: out over the audience."></label>') +
      (t ? "" : '<label>Height (m)<input type="number" step="0.05" min="0" max="12" data-pf="y" value="' + f.pos.y.toFixed(2) + '"></label>') + "</div>" +
      (kind === "mover" ? '<div class="lx3d-row"><label>Mounted<select data-pf="hang"><option value="down"' + ((aim.hang || "down") === "down" ? " selected" : "") + '>Hung (head down)</option><option value="up"' + (aim.hang === "up" ? " selected" : "") + '>Standing (head up)</option></select></label><label>Turns to<select data-pf="yaw0"><option value="0"' + (!aim.yaw ? " selected" : "") + ">Face the audience</option><option value=\"180\"" + (aim.yaw === 180 ? " selected" : "") + '>Face upstage</option></select></label></div><div class="lx3d-row"><label>Pan range (°)<input type="number" min="90" max="720" step="10" data-pf="panRange" value="' + (f.panRange || 540) + '"></label><label>Tilt range (°)<input type="number" min="90" max="360" step="10" data-pf="tiltRange" value="' + (f.tiltRange || 270) + '"></label></div><p class="muted small">Where it points comes from the presets (pan and tilt).</p>' :
        kind === "haze" ? "" :
        '<div class="lx3d-row"><label>Points (°)<input type="range" min="-180" max="180" step="1" data-pf="yaw" value="' + (aim.yaw || 0) + '"><output>' + dirName(aim.yaw || 0) + '</output></label><label>Tilt down (°)<input type="range" min="-90" max="90" step="1" data-pf="pitch" value="' + (aim.pitch || 0) + '"><output>' + (aim.pitch || 0) + "°</output></label></div>" +
        '<div class="lx3d-aims"><button data-p3="aim-stage">At the stage</button><button data-p3="aim-audience">At the audience</button><button data-p3="aim-down">Straight down</button><button data-p3="aim-up">Straight up</button><button data-p3="aim-wall">Back wall</button></div>' +
        (kind === "bar" || kind === "strobe" || kind === "blinder" ? '<label class="toggle"><input type="checkbox" data-pf="roll"' + (f.roll ? " checked" : "") + "> Stood on end (vertical)</label>" : "")) +
      '<div class="lx3d-row"><button data-p3="find">Find</button><button data-p3="restore" title="Back to where this group usually goes">Put back</button></div>';
  }
  function dirName(y) { y = ((y % 360) + 540) % 360 - 180; var a = Math.abs(y); return a < 23 ? "the audience" : a > 157 ? "upstage" : a < 68 ? (y > 0 ? "audience, stage left" : "audience, stage right") : a <= 112 ? (y > 0 ? "stage left" : "stage right") : (y > 0 ? "upstage left" : "upstage right"); }
  function renderPanelValues() { var el = $("#lx3dPanel"), f = selected && fixtureById(selected); if (!el || !f) return; ["x", "y", "z"].forEach(function (k) { var i = el.querySelector('[data-pf="' + k + '"]'); if (i && document.activeElement !== i) i.value = k === "z" ? (-f.pos.z).toFixed(2) : Number(f.pos[k]).toFixed(2); }); }
  function panelField(el) {
    var f = selected && fixtureById(selected); if (!f) return; var k = el.dataset.pf, v = el.type === "checkbox" ? el.checked : el.value, st = stage();
    f.aim = f.aim || {};
    if (k === "mount") { f.mount = v; var t = L.trussById(v); if (t) { f.pos.y = t.h - 0.35; f.pos.z = -t.d; } else if (v === "house") { f.pos.y = Math.max(5, (st.trusses[0] || {}).h || 5.5) + 0.5; f.pos.z = Math.max(2, f.pos.z); } else f.pos.y = surfaceAt(f.pos.x, f.pos.z); if (L.kindOf(f) === "mover") f.aim.hang = v === "floor" ? "up" : "down"; fixKey = ""; renderPanel(); }
    else if (k === "x") f.pos.x = Number(v) || 0;
    else if (k === "z") { f.pos.z = -(Number(v) || 0); if (f.mount === "floor") f.pos.y = surfaceAt(f.pos.x, f.pos.z); }
    else if (k === "y") f.pos.y = clamp(Number(v) || 0, 0, 12);
    else if (k === "hang") { f.aim.hang = v; fixKey = ""; }
    else if (k === "yaw0") f.aim.yaw = Number(v);
    else if (k === "panRange" || k === "tiltRange") f[k] = clamp(Number(v) || (k === "panRange" ? 540 : 270), 90, 720);
    else if (k === "yaw" || k === "pitch") { f.aim[k] = Number(v); var out = el.parentNode.querySelector("output"); if (out) out.textContent = k === "yaw" ? dirName(Number(v)) : v + "°"; }
    else if (k === "roll") f.roll = v ? 90 : 0;
    f.x = clamp(f.pos.x / st.width + 0.5, 0, 1);
    L.saveRig(); frame();
  }
  function panelAction(a) {
    var f = selected && fixtureById(selected); if (a === "close") { selected = null; paintSelection(); renderPanel(); frame(); return; } if (!f) return;
    var st = stage(), p = f.pos, deck = Math.max(0, st.deck);
    var targets = { "aim-stage": { x: p.x * 0.5, y: deck + 1.4, z: -st.depth * 0.4 }, "aim-audience": { x: p.x * 0.6, y: 1.2, z: 4 }, "aim-wall": { x: p.x, y: 3, z: -st.depth - 0.6 } };
    if (targets[a]) f.aim = Object.assign(f.aim || {}, L.aimAt(p, targets[a]));
    else if (a === "aim-down") f.aim = Object.assign(f.aim || {}, { pitch: 90 });
    else if (a === "aim-up") f.aim = Object.assign(f.aim || {}, { pitch: -90 });
    else if (a === "find") { L.identify(f.id); return; }
    else if (a === "restore") { delete f.mount; delete f.pos; L.placeFixture(f, 0, 1); f.pos.x = (f.x != null ? (f.x - 0.5) * st.width * 0.9 : 0); fixKey = ""; }
    L.saveRig(); renderPanel(); frame();
  }
  function renderStage() {
    var el = $("#lx3dStage"), st = stage();
    el.innerHTML = '<div class="lx3d-ph"><b>Stage &amp; trusses</b><button class="mini" data-s3="close" title="Close" aria-label="Close">✕</button></div>' +
      '<div class="lx3d-row"><label>Stage width (m)<input type="number" min="2" max="40" step="0.5" data-sf="width" value="' + st.width + '"></label><label>Stage depth (m)<input type="number" min="1" max="25" step="0.5" data-sf="depth" value="' + st.depth + '"></label></div>' +
      '<div class="lx3d-row"><label>Stage height (m)<input type="number" min="0" max="2" step="0.05" data-sf="deck" value="' + st.deck + '"></label><label>Room in front (m)<input type="number" min="4" max="60" step="1" data-sf="room" value="' + (st.room || 14) + '"></label></div>' +
      '<table class="lx3d-trusses"><thead><tr><th>Truss</th><th title="From the stage\'s front edge. Negative: out over the audience.">From the front (m)</th><th>Height (m)</th><th>Width (m)</th><th></th></tr></thead><tbody>' +
      (st.trusses || []).map(function (t, i) { return '<tr data-ti="' + i + '"><td><input data-sf="t-name" value="' + esc(t.name) + '"></td><td><input type="number" step="0.25" data-sf="t-d" value="' + t.d + '"></td><td><input type="number" min="1" max="15" step="0.25" data-sf="t-h" value="' + t.h + '"></td><td><input type="number" min="1" max="40" step="0.5" data-sf="t-width" value="' + (t.width || st.width) + '"></td><td><button class="mini" data-s3="t-del" title="Remove this truss" aria-label="Remove this truss">✕</button></td></tr>'; }).join("") + "</tbody></table>" +
      '<div class="lx3d-row"><button data-s3="t-add">+ Truss</button><button data-s3="reset">Standard stage</button></div><p class="muted small">Lights on a truss move with it.</p>';
  }
  function stageField(el) {
    var st = stage(), k = el.dataset.sf, v = el.value;
    if (k.indexOf("t-") === 0) {
      var t = st.trusses[Number(el.closest("[data-ti]").dataset.ti)], f2 = k.slice(2); if (!t) return;
      t[f2] = f2 === "name" ? v : Number(v) || 0;
      L.rig().fixtures.forEach(function (f) { if (f.mount === t.id) { f.pos.y = t.h - 0.35; f.pos.z = -t.d; } });
    } else st[k] = Number(v) || 0;
    L.rig().fixtures.forEach(function (f) { if (f.mount === "floor") f.pos.y = surfaceAt(f.pos.x, f.pos.z); });
    L.saveRig(); roomKey = ""; frame();
  }
  function stageAction(a, b) {
    var st = stage();
    if (a === "close") { $("#lx3dStage").hidden = true; return; }
    if (a === "t-add") { var last = st.trusses[st.trusses.length - 1]; st.trusses.push({ id: "t" + Math.random().toString(36).slice(2, 7), name: "Truss " + (st.trusses.length + 1), d: last ? Math.round((last.d + 1.5) * 4) / 4 : 2, h: last ? last.h : 5, width: st.width }); }
    else if (a === "t-del") { var i = Number(b.closest("[data-ti]").dataset.ti), t = st.trusses[i], used = L.rig().fixtures.filter(function (f) { return f.mount === t.id; }); if (used.length && !confirm(used.length + " light" + (used.length === 1 ? " hangs" : "s hang") + " on the " + t.name + ". Remove it? They go to the floor.")) return; used.forEach(function (f) { f.mount = "floor"; f.pos.y = surfaceAt(f.pos.x, f.pos.z); }); st.trusses.splice(i, 1); fixKey = ""; }
    else if (a === "reset") { if (!confirm("Go back to a standard 10 × 6 m stage with three trusses? Lights on trusses that go away move to the floor.")) return; var keepT = L.defaultStage(); L.rig().stage = keepT; L.rig().fixtures.forEach(function (f) { var t = L.trussById(f.mount); if (t) { f.pos.y = t.h - 0.35; f.pos.z = -t.d; } else if (f.mount !== "house") { f.mount = "floor"; f.pos.y = surfaceAt(f.pos.x, f.pos.z); } }); fixKey = ""; }
    L.saveRig(); roomKey = ""; renderStage(); renderPanel(); frame();
  }

  // ------------------------------------------------------------- start
  applyBig();
  if (window.ResizeObserver) new ResizeObserver(function () { if (L.isShowing()) frame(); }).observe(host);
  window.CULights3D = { active: function () { return ok; }, frame: frame, rebuild: function () { fixKey = ""; roomKey = ""; if (L.isShowing()) frame(); }, view: view, select: function (id) { selected = id; paintSelection(); if (id) roomy(); renderPanel(); frame(); }, big: function () { return big; },
    selected: function () { return selected; }, count: function () { return Object.keys(fixtures).length; }, emitters: function (id) { var o = fixtures[id]; return o ? o.emitters.length : 0; }, camera: function () { return cam; } };
})();
