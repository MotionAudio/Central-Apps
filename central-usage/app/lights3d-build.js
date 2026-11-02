/* Central Control - Lighting: build my stage, quickly.
 *  Build my stage (on the 3D stage's bar):
 *   - Questions: the stage's size and shape, risers, stairs, screens, the room and its seats, and how many lights
 *     hang where. It builds the lot (stage, room, seats, trusses, lights with their DMX addresses); then drag to adjust.
 *   - Templates: a small church, a medium church with a choir, a large stage with an LED wall, a gym, a church that
 *     sets up each week.
 *   - Props: a drum kit, keys, amps, mic stands, a pulpit, choir risers, a baptistry, the band's spots, a cross, stairs.
 *   - A patch from a file: a CSV (name, type, universe, address, position…) or a QLC+ workspace (.qxw).
 *   - Saved stages, a stage file to take to another computer, and sending it to the church's other computers.
 *  Tracing a floor plan is under Room & seats (lights3d-room.js). */
(function () {
  "use strict";
  var L3 = window.CULights3D, X = L3 && L3.ext, RM = window.CURoomMath; if (!X) return;
  var T = X.T, L = X.L, esc = X.esc, CU = window.CentralUsage;
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function st() { return X.stage(); }
  var panel = X.panel("lx3dBuild"), tab = "wizard", importRows = null, importMsg = "";

  // ------------------------------------------------------------------ props: simple shapes, enough to recognise
  var PROPS = [["drums", "Drum kit"], ["keys", "Keys"], ["amp", "Guitar / bass amp"], ["mic", "Mic stand"], ["pulpit", "Pulpit"], ["choir", "Choir risers"], ["baptistry", "Baptistry"], ["spot", "A band spot (floor mark)"], ["cross", "Cross"], ["stairs", "Stairs"], ["piano", "Grand piano"], ["monitor", "Floor monitor"]];
  var pg = new T.Group(); X.scene.add(pg); var propKey = "";
  var PM = { dark: new T.MeshStandardMaterial({ color: 0x1c1e23, roughness: 0.6, metalness: 0.3 }), metal: new T.MeshStandardMaterial({ color: 0x9aa1ab, metalness: 0.8, roughness: 0.3 }), wood: new T.MeshStandardMaterial({ color: 0x5a3d26, roughness: 0.7 }), shell: new T.MeshStandardMaterial({ color: 0x7a1f24, roughness: 0.4, metalness: 0.3 }), white: new T.MeshStandardMaterial({ color: 0xd8dde6, roughness: 0.6 }), water: new T.MeshStandardMaterial({ color: 0x2b6f9a, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.8 }), mark: new T.MeshBasicMaterial({ color: 0xe2c27e }), sel: new T.MeshBasicMaterial({ color: 0xe2c27e, wireframe: true }) };
  function box(g, w, h, d, m, x, y, z) { var b = new T.Mesh(new T.BoxGeometry(w, h, d), m); b.position.set(x || 0, (y || 0) + h / 2, z || 0); g.add(b); return b; }
  function cyl(g, r, h, m, x, y, z, rot) { var c = new T.Mesh(new T.CylinderGeometry(r, r, h, 18), m); c.position.set(x || 0, (y || 0) + (rot ? 0 : h / 2), z || 0); if (rot) c.rotation.x = Math.PI / 2; g.add(c); return c; }
  function propMesh(p) {
    var g = new T.Group(), k = p.kind;
    if (k === "drums") { cyl(g, 0.28, 0.5, PM.shell, 0, 0.28, 0.25, true); cyl(g, 0.18, 0.2, PM.shell, -0.35, 0.45, 0); cyl(g, 0.16, 0.2, PM.shell, 0.3, 0.6, 0); cyl(g, 0.2, 0.35, PM.shell, 0.5, 0, -0.15); cyl(g, 0.17, 0.15, PM.metal, -0.35, 0, 0.35); [-0.6, 0.6].forEach(function (x) { cyl(g, 0.01, 1.1, PM.metal, x, 0, -0.2); var cy = new T.Mesh(new T.CylinderGeometry(0.22, 0.22, 0.01, 20), PM.metal); cy.position.set(x, 1.1, -0.2); g.add(cy); }); box(g, 0.35, 0.5, 0.35, PM.dark, 0, 0, -0.55); }
    else if (k === "keys") { box(g, 1.3, 0.06, 0.35, PM.dark, 0, 0.9, 0); box(g, 1.25, 0.02, 0.15, PM.white, 0, 0.96, 0.08); [-0.5, 0.5].forEach(function (x) { box(g, 0.04, 0.9, 0.3, PM.metal, x, 0, 0); }); }
    else if (k === "amp") { box(g, 0.6, 0.55, 0.3, PM.dark, 0, 0, 0); box(g, 0.5, 0.35, 0.01, new T.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 1 }), 0, 0.05, 0.155); }
    else if (k === "mic") { cyl(g, 0.12, 0.02, PM.dark); cyl(g, 0.012, 1.5, PM.metal); cyl(g, 0.025, 0.12, PM.dark, 0, 1.5, 0); }
    else if (k === "pulpit") { var t = box(g, 0.7, 1.15, 0.5, PM.wood, 0, 0, 0); var top = box(g, 0.8, 0.05, 0.6, PM.wood, 0, 1.15, 0); top.rotation.x = -0.2; void t; }
    else if (k === "choir") { var w = p.w || 6; for (var i = 0; i < (p.rows || 3); i++) box(g, w, 0.2 * (i + 1), 0.9, PM.dark, 0, 0, -i * 0.9); }
    else if (k === "baptistry") { box(g, 2.4, 1.1, 1.6, PM.white, 0, 0, 0); var wt = new T.Mesh(new T.PlaneGeometry(2.2, 1.4), PM.water); wt.rotation.x = -Math.PI / 2; wt.position.y = 1.0; g.add(wt); }
    else if (k === "spot") { var m = new T.Mesh(new T.RingGeometry(0.22, 0.28, 24), PM.mark); m.rotation.x = -Math.PI / 2; m.position.y = 0.01; g.add(m); }
    else if (k === "cross") { var h = p.h || 3; box(g, 0.2, h, 0.15, PM.wood, 0, 0, 0); box(g, h * 0.55, 0.2, 0.15, PM.wood, 0, h * 0.62, 0); }
    else if (k === "stairs") { var sw = p.w || 1.8, deck = Math.max(0.1, st().deck), steps = Math.max(1, Math.round(deck / 0.18)); for (var s = 0; s < steps; s++) box(g, sw, deck * (steps - s) / steps, 0.3, PM.dark, 0, 0, s * 0.3 + 0.15); g.userData.ground = true; }
    else if (k === "piano") { box(g, 1.5, 0.3, 1.9, PM.dark, 0, 0.7, 0); [[-0.6, 0.7], [0.6, 0.7], [0, -0.8]].forEach(function (q) { box(g, 0.08, 0.7, 0.08, PM.dark, q[0], 0, q[1]); }); }
    else if (k === "monitor") { var mm = box(g, 0.55, 0.3, 0.4, PM.dark, 0, 0, 0); mm.rotation.x = -0.5; }
    var bb = new T.Box3().setFromObject(g), size = bb.getSize(new T.Vector3()), sel = new T.Mesh(new T.BoxGeometry(size.x + 0.1, size.y + 0.1, size.z + 0.1), PM.sel); sel.position.copy(bb.getCenter(new T.Vector3())); sel.visible = false; g.add(sel); g.userData.sel = sel;
    return g;
  }
  var propSel = null, propDragged = false;
  function props() { var s = st(); if (!Array.isArray(s.props)) s.props = []; return s.props; }
  function buildProps() {
    while (pg.children.length) pg.remove(pg.children[pg.children.length - 1]);
    X.pickables = X.pickables.filter(function (p) { return p.owner !== "props"; });
    props().forEach(function (p) {
      var g = propMesh(p), y = p.kind === "stairs" ? 0 : X.surfaceAt(p.x || 0, p.z || 0);
      g.position.set(p.x || 0, y, p.kind === "stairs" ? Math.max(0, p.z || 0) : p.z || 0); g.rotation.y = (p.yaw || 0) * Math.PI / 180;
      g.userData.sel.visible = p.id === propSel;
      g.userData.ext = { select: function () { propSel = p.id; buildProps(); openProp(p); }, y: function () { return 0; }, from: function () { return { x: p.x || 0, z: p.z || 0 }; },
        drag: function (dx, dz, from) { if (!propDragged) { X.remember(true); propDragged = true; } p.x = X.snapV(from.x + dx); p.z = X.snapV(from.z + dz); propKey = ""; }, end: function () { propDragged = false; L.saveRig(); } };
      pg.add(g); X.pickables.push({ obj: g, owner: "props" });
    });
  }
  X.frameHooks.push(function () { var k = JSON.stringify([props(), st().deck, st().width, st().depth, st().risers, propSel]); if (k !== propKey) { propKey = k; buildProps(); } });
  function addProp(kind, at) {
    var s = st(), D = s.depth, p = Object.assign({ id: X.uid(), kind: kind, x: 0, z: -D * 0.5, yaw: 0 }, at || {});
    if (!at) { if (kind === "drums") p.z = -D * 0.72; else if (kind === "pulpit") p.z = -0.9; else if (kind === "cross") { p.z = -D + 0.3; } else if (kind === "choir") { p.z = -D + 2.2; p.w = Math.min(s.width - 1, 8); p.rows = 3; } else if (kind === "stairs") { p.z = 0; p.x = 0; } else if (kind === "baptistry") { p.x = s.width / 2 - 1.6; p.z = -D + 1; } else if (kind === "keys") { p.x = -s.width * 0.3; p.z = -D * 0.55; } else if (kind === "amp") { p.x = s.width * 0.3; p.z = -D * 0.7; } else if (kind === "mic") { p.z = -1.5; } else if (kind === "piano") { p.x = -s.width * 0.32; p.z = -D * 0.45; p.yaw = 30; } else if (kind === "monitor") { p.z = -0.6; p.yaw = 180; } }
    props().push(p); return p;
  }
  var propPanel = X.panel("lx3dProp");
  function openProp(p) {
    X.closeOthers("prop"); propPanel.hidden = false; var name = (PROPS.filter(function (q) { return q[0] === p.kind; })[0] || ["", "Prop"])[1], u = X.units();
    propPanel.innerHTML = '<div class="lx3d-ph"><b>' + esc(name) + '</b><button class="mini" data-pp="close" aria-label="Close">✕</button></div><div class="lx3d-row"><label>Across (' + u + ")" + X.num('pf2="x"', p.x || 0) + '</label><label>From the front edge (' + u + ")" + X.num('pf2="z"', -(p.z || 0)) + '</label><label>Turn (°)<input type="number" step="15" data-pf2="yaw" value="' + (p.yaw || 0) + '"></label></div>' +
      (p.kind === "choir" ? '<div class="lx3d-row"><label>Width (' + u + ")" + X.num('pf2="w"', p.w || 6) + '</label><label>Rows<input type="number" min="1" max="8" data-pf2="rows" value="' + (p.rows || 3) + '"></label></div>' : "") +
      '<div class="lx3d-row"><button data-pp="copy">Copy</button><button data-pp="del" class="danger">Remove</button></div>';
    propPanel.oninput = function (e) { var k = e.target.dataset.pf2; if (!k) return; X.remember(); var v = e.target.value; if (k === "z") p.z = -X.fromU(v); else if (k === "yaw" || k === "rows") p[k] = Number(v) || 0; else p[k] = X.fromU(v); L.saveRig(); propKey = ""; X.frame(); };
    propPanel.onclick = function (e) { var b = e.target.closest("button"); if (!b) return; var a = b.dataset.pp; if (a === "close") { propPanel.hidden = true; propSel = null; propKey = ""; return; } X.remember(true); if (a === "del") { props().splice(props().indexOf(p), 1); propPanel.hidden = true; propSel = null; } else if (a === "copy") { var c = addProp(p.kind, Object.assign({}, p, { id: X.uid(), x: (p.x || 0) + 1 })); propSel = c.id; openProp(c); } L.saveRig(); propKey = ""; X.frame(); };
  }
  X.selectHooks.push(function (keep) { if (keep !== "prop") { propPanel.hidden = true; if (propSel) { propSel = null; propKey = ""; } } if (keep !== "build" && keep !== undefined) panel.hidden = true; });

  // ------------------------------------------------------------------ the questions, and building from the answers
  var DEF = { width: 10, depth: 6, deck: 0.6, shape: "rect", risers: { drums: true, keys: false, choir: false }, choirRows: 3, stairs: true, back: "led", room: "rect", seats: 300, balcony: false,
    lights: { front: 6, mid: 0, back: 4, moversEach: 1, house: 6, sides: 0, uplights: 4, blinders: 1, haze: true } };
  var answers = JSON.parse(JSON.stringify(DEF));
  function profileFor(kind) { return { par: "rgbwd5", mover: "mhmini9", house: "dimmer", blinder: "blinder2", haze: "hazer2", wash: "rgbwauvds8" }[kind] || "rgbwd5"; }
  // answers -> a stage, a room, trusses, props, screens and lights (with DMX addresses one after another)
  function build(a, keepLights) {
    var s0 = st(), s = L.defaultStage(), W = clamp(a.width, 2, 40), D = clamp(a.depth, 1, 25), deck = clamp(a.deck, 0, 2), fixtures = keepLights ? L.rig().fixtures.slice() : [];
    s.width = W; s.depth = D; s.deck = deck; s.room = Math.max(10, Math.round(Math.sqrt(Math.max(50, a.seats)) * 1.15 + 6));
    s.shape = a.shape === "thrust" ? "thrust" : a.shape === "round" || a.shape === "inround" ? "round" : "rect";
    if (s0.trace) s.trace = s0.trace;
    var hh = Math.max(4.5, deck + 4.5);
    s.trusses = [{ id: "front", name: "Front truss", d: -Math.max(2, Math.round(s.room * 0.18 * 4) / 4), h: hh + 0.5, width: W + 1 }];
    if (a.lights.mid > 0) s.trusses.push({ id: "mid", name: "Mid truss", d: Math.round(D * 0.45 * 4) / 4, h: hh, width: W });
    if (a.lights.back > 0 || a.lights.moversEach > 0) s.trusses.push({ id: "back", name: "Back truss", d: Math.round((D - 0.6) * 4) / 4, h: hh, width: W });
    if (a.lights.sides > 0) { s.trusses.push({ id: "sideL", name: "Side truss left", d: D / 2, x: -W / 2 - 0.8, h: hh - 0.5, width: D + 1, yaw: 90 }); s.trusses.push({ id: "sideR", name: "Side truss right", d: D / 2, x: W / 2 + 0.8, h: hh - 0.5, width: D + 1, yaw: 90 }); }
    s.risers = [];
    if (a.risers.drums) s.risers.push({ name: "Drum riser", x: 0, z: Math.round(D * 0.72 * 4) / 4, w: 2.4, d: 2.4, h: 0.4 });
    if (a.risers.keys) s.risers.push({ name: "Keys riser", x: -W * 0.3, z: Math.round(D * 0.6 * 4) / 4, w: 2.4, d: 1.8, h: 0.2 });
    s.props = [];
    s.screens = []; s.projectors = [];
    var tpl = a.room === "fan" || a.shape === "inround" ? "fan" : a.room || "rect", t = RM ? RM.template(tpl, s) : null;
    if (t) s.hall = { outline: t.outline, bulges: t.bulges, curved: t.curved, template: tpl, ceiling: Math.max(hh + 2, 7), balcony: { on: !!a.balcony, depth: 6, height: 4 }, seats: { count: Math.max(0, a.seats | 0), sections: a.seats > 400 ? 4 : 3, aisle: 1.2, seatW: 0.55, rowD: 0.95, gap: 2 } };
    L.rig().stage = s;
    // props
    if (a.risers.drums) addProp("drums");
    if (a.risers.keys) addProp("keys");
    if (a.risers.choir) addProp("choir", { x: 0, z: -D + 1.6, w: Math.min(W - 1, 8), rows: clamp(a.choirRows | 0, 1, 6) });
    if (a.stairs) addProp("stairs", { x: s.shape === "thrust" ? (s.thrustW || W * 0.4) / 2 + 1 : W / 2 - 1.2, z: 0 });
    // screens
    var sy = deck + 1.8;
    if (a.back === "led") s.screens.push({ id: X.uid(), name: "LED wall", kind: "led", w: Math.min(W * 0.6, 8), aspect: "16:9", x: 0, y: sy, z: -D - 0.5, yaw: 0, link: "slides" });
    else if (a.back === "projection") { var ps = { id: X.uid(), name: "Projection screen", kind: "projection", w: Math.min(W * 0.5, 6), aspect: "16:9", x: 0, y: sy, z: -D - 0.5, yaw: 0, link: "slides" }; s.screens.push(ps); s.projectors.push({ id: X.uid(), name: "Projector", x: 0, y: hh + 0.3, z: Math.min(8, s.room * 0.4), target: ps.id, link: "slides", bright: 0.8, keystone: 0 }); }
    else if (a.back === "sides") [-1, 1].forEach(function (sd, i) { s.screens.push({ id: X.uid(), name: "Side screen " + (i ? "right" : "left"), kind: "led", w: 3.5, aspect: "16:9", x: sd * (W / 2 + 1.6), y: deck + 2, z: -D * 0.2, yaw: -sd * 20, link: "slides" }); });
    else if (a.back === "cyc") s.screens.push({ id: X.uid(), name: "Backdrop", kind: "projection", w: W, aspect: "custom", h: 4, x: 0, y: deck, z: -D - 0.55, yaw: 0, link: "slides" });
    // lights: each position gets its count, spread along its truss
    var made = [], uni = 1, addr = 1;
    function nextAt(n) { if (addr + n - 1 > 512) { uni++; addr = 1; } var at = { universe: uni, address: addr }; addr += n; return at; }
    if (keepLights) fixtures.forEach(function (f) { var e = (f.address || 1) + 16; if ((f.universe || 1) > uni || ((f.universe || 1) === uni && e > addr)) { uni = f.universe || 1; addr = e; } });
    function add(name, kind, group, mount, pos, aim) {
      var prof = profileFor(kind), p = L.profiles[prof] || { ch: ["dim"] }, at = nextAt(p.ch.length), f = { id: X.uid(), name: name, profile: prof, group: group, universe: at.universe, address: at.address, mount: mount, pos: pos, aim: aim || {} };
      f.x = clamp(pos.x / W + 0.5, 0, 1); fixtures.push(f); made.push(f); return f;
    }
    function onTruss(id, n, name, kind, group, aimAt) {
      var t2 = s.trusses.filter(function (q) { return q.id === id; })[0]; if (!t2 || n <= 0) return;
      var w = (t2.width || W) * 0.85;
      for (var i = 0; i < n; i++) { var al = n === 1 ? 0 : -w / 2 + i * w / (n - 1), p2 = X.trussPoint(t2, al), pos = { x: p2.x, y: t2.h - 0.35, z: p2.z }; add(name + " " + (i + 1), kind, group, id, pos, kind === "mover" ? { yaw: 0, pitch: 0, hang: "down" } : L.aimAt(pos, aimAt(pos))); }
    }
    var L2 = a.lights;
    onTruss("front", L2.front, "Front", "par", "front", function (p) { return { x: p.x * 0.6, y: deck + 1.6, z: -D * 0.35 }; });
    onTruss("mid", L2.mid, "Mid", "par", "front", function (p) { return { x: p.x * 0.8, y: deck, z: -D * 0.3 }; });
    onTruss("back", L2.back, "Back", "par", "back", function (p) { return { x: p.x * 0.8, y: deck + 1.2, z: -D * 0.2 }; });
    if (L2.moversEach > 0) { var bt = s.trusses.filter(function (q) { return q.id === "back"; })[0]; [-1, 1].forEach(function (sd) { for (var i = 0; i < L2.moversEach; i++) { var al = sd * ((bt.width || W) * 0.45 - i * 0.9), p3 = X.trussPoint(bt, al); add("Mover " + (sd < 0 ? "L" : "R") + (L2.moversEach > 1 ? " " + (i + 1) : ""), "mover", "beam", bt.id, { x: p3.x, y: bt.h - 0.35, z: p3.z }, { yaw: 0, pitch: 0, hang: "down" }); } }); }
    if (L2.sides > 0) { onTruss("sideL", L2.sides, "Side L", "par", "front", function () { return { x: 0, y: deck + 1.5, z: -D / 2 }; }); onTruss("sideR", L2.sides, "Side R", "par", "front", function () { return { x: 0, y: deck + 1.5, z: -D / 2 }; }); }
    for (var u2 = 0; u2 < (L2.uplights | 0); u2++) { var ux = (L2.uplights === 1 ? 0 : -W * 0.42 + u2 * W * 0.84 / (L2.uplights - 1)), up = { x: ux, y: deck, z: -D + 0.4 }; add("Uplight " + (u2 + 1), "par", "back", "floor", up, { yaw: 180, pitch: -70 }); }
    var hz = (s.hall && s.hall.ceiling || 7) - 0.4, hn = L2.house | 0, cols = Math.max(1, Math.round(Math.sqrt(hn * 1.5))), rows = Math.max(1, Math.ceil(hn / cols)), hb = RM && s.hall ? RM.bounds(RM.outline(s.hall)) : { x0: -W / 2 - 4, x1: W / 2 + 4, z1: s.room };
    for (var k = 0; k < hn; k++) { var c = k % cols, r = Math.floor(k / cols), hx = hb.x0 + (hb.x1 - hb.x0) * (c + 0.5) / cols, hzz = 2 + (hb.z1 - 3) * (r + 0.5) / rows; add("House " + (k + 1), "house", "house", "house", { x: hx * 0.85, y: hz, z: hzz }, { yaw: 0, pitch: 90 }); }
    for (var bl = 0; bl < (L2.blinders | 0); bl++) { var ft = s.trusses[s.trusses.length - 1], bx = (L2.blinders === 1 ? 0 : -W * 0.3 + bl * W * 0.6 / (L2.blinders - 1)), bp = { x: bx, y: ft.h - 0.35, z: -ft.d }; add("Blinder " + (bl + 1), "blinder", "fx", ft.id, bp, L.aimAt(bp, { x: bx, y: 1.2, z: 6 })); }
    if (L2.haze) add("Hazer", "haze", "haze", "floor", { x: -W / 2 + 0.8, y: deck, z: -D + 0.6 }, { yaw: 0, pitch: 0 });
    var rig = L.rig(); rig.fixtures.length = 0; Array.prototype.push.apply(rig.fixtures, fixtures);
    L.saveRig(); X.rebuildRoom(); X.rebuildFixtures(); if (L.renderAll) L.renderAll(); if (L.dirty) L.dirty(); X.view("corner"); X.frame();
    return { lights: made.length, universes: uni };
  }
  // the usual churches, as answers to the questions
  var TEMPLATES = [
    ["small", "Small church", "A 6 × 4 m (20 × 13 ft) platform, a pulpit, 120 seats, a projection screen, a few lights.", { width: 6, depth: 4, deck: 0.45, shape: "rect", risers: { drums: false, keys: false, choir: false }, stairs: true, back: "projection", room: "rect", seats: 120, balcony: false, lights: { front: 4, mid: 0, back: 2, moversEach: 0, house: 4, sides: 0, uplights: 2, blinders: 0, haze: false } }, ["pulpit", "cross"]],
    ["medium", "Medium church with a choir", "A 10 × 6 m stage, choir risers, a drum riser, 450 seats, two side screens.", { width: 10, depth: 6.5, deck: 0.6, shape: "rect", risers: { drums: true, keys: true, choir: true }, choirRows: 3, stairs: true, back: "sides", room: "fan", seats: 450, balcony: false, lights: { front: 8, mid: 4, back: 6, moversEach: 1, house: 8, sides: 0, uplights: 6, blinders: 1, haze: true } }, ["pulpit", "baptistry"]],
    ["large", "Large stage with an LED wall", "A 16 × 9 m thrust stage, an LED wall, 1500 seats with a balcony, moving heads and side trusses.", { width: 16, depth: 9, deck: 1, shape: "thrust", risers: { drums: true, keys: true, choir: false }, stairs: true, back: "led", room: "fan", seats: 1500, balcony: true, lights: { front: 12, mid: 8, back: 10, moversEach: 3, house: 16, sides: 3, uplights: 10, blinders: 2, haze: true } }, ["amp", "amp", "mic", "mic", "mic"]],
    ["gym", "Gym or multipurpose room", "A low 8 × 5 m stage at one end of a wide, flat room, 300 chairs, a screen on each side.", { width: 8, depth: 5, deck: 0.4, shape: "rect", risers: { drums: true, keys: false, choir: false }, stairs: true, back: "sides", room: "wide", seats: 300, balcony: false, lights: { front: 6, mid: 0, back: 4, moversEach: 1, house: 6, sides: 0, uplights: 4, blinders: 0, haze: false } }, ["mic", "monitor"]],
    ["portable", "Set up each week (portable)", "Stands instead of trusses: a 7 × 4 m stage deck, 200 chairs, a projection screen, a few lights on stands.", { width: 7, depth: 4, deck: 0.4, shape: "rect", risers: { drums: false, keys: false, choir: false }, stairs: true, back: "projection", room: "rect", seats: 200, balcony: false, lights: { front: 4, mid: 0, back: 0, moversEach: 0, house: 0, sides: 2, uplights: 4, blinders: 0, haze: false } }, ["mic", "monitor", "keys"]]
  ];
  function useTemplate(id) {
    var t = TEMPLATES.filter(function (x) { return x[0] === id; })[0]; if (!t) return null;
    X.remember(true); answers = JSON.parse(JSON.stringify(t[3])); var r = build(answers, false);
    t[4].forEach(function (k) { addProp(k); }); L.saveRig(); X.frame(); return r;
  }

  // ------------------------------------------------------------------ a patch from a file
  function parseCsv(text) {
    var rows = [], row = [], cur = "", q = false, sep = /;/.test(text.split("\n")[0]) && !/,/.test(text.split("\n")[0]) ? ";" : /\t/.test(text.split("\n")[0]) ? "\t" : ",";
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) { if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; continue; }
      if (ch === '"') q = true; else if (ch === sep) { row.push(cur); cur = ""; } else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cur); cur = ""; if (row.some(function (c) { return c.trim(); })) rows.push(row); row = []; } else cur += ch;
    }
    row.push(cur); if (row.some(function (c) { return c.trim(); })) rows.push(row);
    return rows;
  }
  function norm(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
  // the best fixture profile for "Chauvet SlimPAR Pro H USB (12ch)": the built-in ones, then your library (the fixture files you imported)
  function matchProfile(text) {
    var q = norm(text), words = q.split(" ").filter(function (w) { return w.length > 1; }), best = null, bestScore = 0, chN = (/(\d+)\s*(ch|channel)/i.exec(text) || [])[1];
    var cands = Object.keys(L.profiles).map(function (id) { return { id: id, name: L.profiles[id].name, ch: L.profiles[id].ch }; }).concat((L.rig().library || []).map(function (e) { return { id: e.id, name: e.name, ch: e.ch, lib: true }; }));
    cands.forEach(function (c) {
      var n = norm(c.name), score = 0; words.forEach(function (w) { if (n.indexOf(w) >= 0) score += w.length > 3 ? 2 : 1; });
      if (chN && c.ch && c.ch.length === Number(chN)) score += 2; if (c.lib) score += 0.5; if (score > bestScore) { bestScore = score; best = c; }
    });
    if (best && bestScore >= 2) return { id: best.id, name: best.name, sure: bestScore >= 4 };
    // a guess from the words
    var g = /mover|moving|spot|beam|wash.*head|head/.test(q) ? "mhmini9" : /strobe/.test(q) ? "strobe2" : /blinder/.test(q) ? "blinder2" : /haz|fog/.test(q) ? "hazer2" : /bar|batten|strip/.test(q) ? "bar8rgb" : /dimmer|fresnel|leko|ellipsoidal|source four|conventional|par ?64|house/.test(q) ? "dimmer" : "rgbwd5";
    return { id: g, name: L.profiles[g] ? L.profiles[g].name : g, sure: false, guessed: true };
  }
  function col(hdr, names) { for (var i = 0; i < hdr.length; i++) { var h = norm(hdr[i]); if (names.some(function (n) { return h === n || h.indexOf(n) === 0; })) return i; } return -1; }
  function readPatch(text, fileName) {
    if (/\.qxw$/i.test(fileName || "") || /<Workspace|<Fixture>/.test(text)) {   // QLC+ workspace
      var doc = new DOMParser().parseFromString(text, "text/xml"), out = [];
      Array.prototype.forEach.call(doc.getElementsByTagName("Fixture"), function (f) {
        var g = function (t) { var e = f.getElementsByTagName(t)[0]; return e ? e.textContent : ""; };
        if (!g("Address")) return; out.push({ name: g("Name") || g("Model"), type: (g("Manufacturer") + " " + g("Model") + " " + g("Mode")).trim(), universe: (Number(g("Universe")) || 0) + 1, address: (Number(g("Address")) || 0) + 1, position: "" });
      });
      return out;
    }
    var rows = parseCsv(text); if (rows.length < 2) return [];
    var hdr = rows[0], iName = col(hdr, ["name", "label", "fixture name", "channel", "unit"]), iType = col(hdr, ["type", "profile", "fixture type", "model", "instrument", "fixture"]), iMaker = col(hdr, ["manufacturer", "maker", "brand", "make"]), iMode = col(hdr, ["mode", "personality"]),
      iUni = col(hdr, ["universe", "univ", "uni"]), iAddr = col(hdr, ["address", "dmx", "start", "addr"]), iPos = col(hdr, ["position", "location", "hang", "mount", "truss", "pipe"]), iGroup = col(hdr, ["group", "purpose", "use"]), iX = col(hdr, ["x", "across"]), iZ = col(hdr, ["z", "depth"]), iY = col(hdr, ["y", "height"]);
    if (iAddr < 0) return [];
    return rows.slice(1).map(function (r) {
      var addrRaw = String(r[iAddr] || "").trim(), uni = iUni >= 0 ? Number(r[iUni]) || 1 : 1, addr = Number(addrRaw);
      var m = /^(\d+)\s*[\/.:-]\s*(\d+)$/.exec(addrRaw); if (m) { uni = Number(m[1]); addr = Number(m[2]); }   // "2/101" or "2.101"
      if (!addr && addrRaw) addr = NaN;
      return { name: iName >= 0 ? r[iName] : "", type: [iMaker >= 0 ? r[iMaker] : "", iType >= 0 ? r[iType] : "", iMode >= 0 ? r[iMode] : ""].join(" ").trim(), universe: uni, address: addr, position: iPos >= 0 ? r[iPos] : "", group: iGroup >= 0 ? r[iGroup] : "", x: iX >= 0 ? Number(r[iX]) : null, y: iY >= 0 ? Number(r[iY]) : null, z: iZ >= 0 ? Number(r[iZ]) : null };
    }).filter(function (r) { return r.name || r.type || r.address; });
  }
  var GROUPS_BY_WORD = [[/house|audience|aud /, "house"], [/back|rear|upstage|cyc/, "back"], [/front|foh|key|face/, "front"], [/mover|moving|spot|beam|head/, "beam"], [/strobe|blind|fx|effect/, "fx"], [/haz|fog/, "haze"]];
  function mountFor(pos) {
    var p = norm(pos), s = st(); if (!p) return null;
    var t = (s.trusses || []).filter(function (x) { var n = norm(x.name); return n === p || p.indexOf(n) >= 0 || n.indexOf(p) >= 0; })[0]; if (t) return t.id;
    if (/house|ceiling|audience/.test(p)) return "house"; if (/floor|deck|stand|boom|tree/.test(p)) return "floor"; if (/wall/.test(p)) return "wall"; if (/balcony/.test(p)) return "balcony";
    if (/front|foh/.test(p)) { var f = (s.trusses || []).filter(function (x) { return x.d < 0; })[0]; if (f) return f.id; }
    if (/back|rear|upstage/.test(p)) { var b = (s.trusses || []).slice().sort(function (a, c) { return c.d - a.d; })[0]; if (b) return b.id; }
    if (/mid|middle|over/.test(p)) { var md = (s.trusses || []).filter(function (x) { return x.d > 0; })[0]; if (md) return md.id; }
    return null;
  }
  function previewPatch(list) {
    var used = {}; L.rig().fixtures.forEach(function (f) { var n = (L.profileOf(f).ch || []).length || 1; for (var i = 0; i < n; i++) used[(f.universe || 1) + ":" + ((f.address || 1) + i)] = f.name; });
    return list.map(function (r) {
      var prof = matchProfile(r.type || r.name), p = L.profiles[prof.id] || ((L.rig().library || []).filter(function (e) { return e.id === prof.id; })[0]) || { ch: ["dim"] }, n = p.ch.length, clash = null, bad = !(r.address >= 1 && r.address + n - 1 <= 512);
      if (!bad) for (var i = 0; i < n; i++) { var k = r.universe + ":" + (r.address + i); if (used[k]) { clash = used[k]; break; } }
      var grp = r.group ? norm(r.group) : "", g = ["front", "back", "beam", "house", "fx", "haze"].indexOf(grp) >= 0 ? grp : null;
      if (!g && /^mh/.test(prof.id)) g = "beam"; if (!g && /^(strobe|blinder)/.test(prof.id)) g = "fx"; if (!g && /^(hazer|fog)/.test(prof.id)) g = "haze";
      if (!g) { var hay = norm(r.group + " " + r.position + " " + r.name + " " + r.type); GROUPS_BY_WORD.some(function (w) { if (w[0].test(hay)) { g = w[1]; return true; } return false; }); }
      if (!g) g = /mh|mover/.test(prof.id) ? "beam" : prof.id === "dimmer" ? "house" : "front";
      return Object.assign({}, r, { profile: prof.id, profileName: prof.name, sure: prof.sure, guessed: prof.guessed, channels: n, bad: bad, clash: clash, group: g, mount: mountFor(r.position) });
    });
  }
  function importPatch(rows, replace) {
    X.remember(true); var rig = L.rig(), s = st(), W = s.width, added = [];
    if (replace) rig.fixtures.length = 0;
    var byMount = {};
    rows.filter(function (r) { return !r.bad; }).forEach(function (r, i) {
      var f = { id: X.uid(), name: r.name || r.profileName + " " + (i + 1), profile: r.profile, group: r.group, universe: r.universe, address: r.address };
      if (r.mount) f.mount = r.mount;
      if (r.x != null && !isNaN(r.x)) { f.pos = { x: X.fromU(r.x), y: r.y != null && !isNaN(r.y) ? X.fromU(r.y) : 0, z: r.z != null && !isNaN(r.z) ? -X.fromU(r.z) : 0 }; f.mount = f.mount || "floor"; }
      (byMount[f.mount || f.group] = byMount[f.mount || f.group] || []).push(f); rig.fixtures.push(f); added.push(f);
    });
    // lights without a position: spread across their truss (or their group's usual place)
    Object.keys(byMount).forEach(function (k) {
      var list = byMount[k].filter(function (f) { return !f.pos; }), n = list.length; if (!n) return;
      list.forEach(function (f, i) { f.x = n === 1 ? 0.5 : 0.12 + 0.76 * i / (n - 1); L.placeFixture(f, i, n); var t = L.trussById(f.mount); if (t) { var p = X.trussPoint(t, (f.x - 0.5) * (t.width || W) * 0.9); f.pos.x = p.x; f.pos.z = p.z; } });
    });
    L.saveRig(); X.rebuildFixtures(); if (L.renderAll) L.renderAll(); if (L.dirty) L.dirty(); X.frame();
    return added.length;
  }

  // ------------------------------------------------------------------ saved stages, stage files, sharing
  function stageFile(name) { var r = L.rig(); return { format: "central-stage", version: 1, name: name || "My stage", saved: new Date().toISOString(), units: X.units(), stage: r.stage, fixtures: r.fixtures, library: r.library || [] }; }
  function useStageFile(j) {
    if (!j || j.format !== "central-stage" || !j.stage) throw new Error("That isn't a Central Control stage file.");
    X.remember(true); var r = L.rig(); r.stage = Object.assign(L.defaultStage(), j.stage); if (Array.isArray(j.fixtures)) { r.fixtures.length = 0; Array.prototype.push.apply(r.fixtures, j.fixtures); }
    (j.library || []).forEach(function (e) { if (!(r.library || []).some(function (x) { return x.id === e.id; })) (r.library = r.library || []).push(e); });
    L.saveRig(); X.rebuildRoom(); X.rebuildFixtures(); if (L.renderAll) L.renderAll(); if (L.dirty) L.dirty(); X.frame();
  }
  function saved() { var r = L.rig(); if (!Array.isArray(r.savedStages)) r.savedStages = []; return r.savedStages; }
  function saveAs(name) { var list = saved(), f = stageFile(name), i = list.map(function (x) { return x.name; }).indexOf(f.name); if (i >= 0) list[i] = f; else list.push(f); L.saveRig(); return f; }
  function exportFile() {
    var text = JSON.stringify(stageFile((saved()[0] || {}).name || "My stage"));
    if (window.CU && window.CU.saveFile) window.CU.saveFile("stage.cmstage.json", text); else { var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "application/json" })); a.download = "stage.cmstage.json"; a.click(); }
  }
  function shareWithChurch() {
    var C = window.CUCenter; if (!C || !C.connected()) return "Not connected to the main admin's computer, so it can't be sent. Export a stage file instead.";
    C.send({ type: "stageShare", stage: stageFile("Stage from " + ((CU && CU.config && CU.config().name) || "another computer")) }); return "Sent to the church's other computers. Each one is asked before it's used.";
  }
  var offered = null;
  if (CU) CU.on("message", function (m) {
    if (m.type !== "stageShare" || !m.stage) return; offered = m.stage;
    var bar = document.getElementById("lxStageOffer"); if (!bar) { bar = document.createElement("div"); bar.id = "lxStageOffer"; bar.className = "lx-run-banner row"; var host = document.getElementById("lx3d"); if (host && host.parentNode) host.parentNode.insertBefore(bar, host); }
    bar.hidden = false; bar.innerHTML = "<span><b>A stage was sent to this computer</b> (" + esc(m.stage.name || "stage") + ", " + ((m.stage.fixtures || []).length) + ' lights).</span><button class="primary" data-offer="use">Use it</button><button data-offer="no">Not now</button>';
    bar.onclick = function (e) { var b = e.target.closest("button"); if (!b) return; if (b.dataset.offer === "use" && offered) { try { saveAs("Before the shared stage"); useStageFile(offered); } catch (err) { alert(err.message); } } bar.hidden = true; offered = null; };
  });

  // ------------------------------------------------------------------ the panel
  function u() { return X.units(); }
  function render() {
    if (panel.hidden) return; var a = answers, uu = u(), l = a.lights;
    var tabs = [["wizard", "Questions"], ["templates", "Start from a template"], ["props", "Props"], ["patch", "Import a patch"], ["save", "Save & share"]];
    var h = '<div class="lx3d-ph"><b>Build my stage</b><button class="mini" data-bd="close" aria-label="Close">✕</button></div><div class="lx3d-views lx-btabs" role="tablist">' + tabs.map(function (t) { return '<button data-btab="' + t[0] + '" class="' + (tab === t[0] ? "on" : "") + '">' + t[1] + "</button>"; }).join("") + "</div>";
    if (tab === "wizard") {
      var n = function (k, v, min) { return '<input type="number" min="' + (min || 0) + '" max="200" data-bq="' + k + '" value="' + v + '">'; };
      h += '<ol class="lx-wiz">' +
        '<li><b>The stage</b><div class="lx3d-row"><label>Width (' + uu + ")" + X.num('bq="width"', a.width, { min: 2 }) + "</label><label>Depth (" + uu + ")" + X.num('bq="depth"', a.depth, { min: 1 }) + "</label><label>Height (" + uu + ')<input type="number" step="' + (uu === "ft" ? 0.25 : 0.05) + '" min="0" data-bq="deck" value="' + X.toU(a.deck) + '"></label><label>Shape<select data-bq="shape">' + [["rect", "Rectangle"], ["thrust", "Thrust"], ["round", "Round front"], ["inround", "In the round (basic)"]].map(function (o) { return '<option value="' + o[0] + '"' + (a.shape === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select></label></div></li>" +
        '<li><b>On the stage</b><div class="lx3d-row"><label class="toggle"><input type="checkbox" data-bq="r-drums"' + (a.risers.drums ? " checked" : "") + '> A drum riser</label><label class="toggle"><input type="checkbox" data-bq="r-keys"' + (a.risers.keys ? " checked" : "") + '> A keys riser</label><label class="toggle"><input type="checkbox" data-bq="r-choir"' + (a.risers.choir ? " checked" : "") + "> Choir risers</label>" + (a.risers.choir ? "<label>Rows " + n("choirRows", a.choirRows, 1) + "</label>" : "") + '<label class="toggle"><input type="checkbox" data-bq="stairs"' + (a.stairs ? " checked" : "") + "> Stairs</label></div></li>" +
        '<li><b>Behind the band</b><div class="lx3d-row"><label>Screens<select data-bq="back">' + [["none", "Nothing"], ["led", "An LED wall"], ["projection", "A projection screen and projector"], ["sides", "A screen on each side"], ["cyc", "A backdrop to light"]].map(function (o) { return '<option value="' + o[0] + '"' + (a.back === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select></label></div></li>" +
        '<li><b>The room</b><div class="lx3d-row"><label>Shape<select data-bq="room">' + [["rect", "Rectangle"], ["fan", "Fan"], ["rounded", "Rounded back"], ["wide", "Wide and shallow"]].map(function (o) { return '<option value="' + o[0] + '"' + (a.room === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + '</select></label><label>Seats<input type="number" min="0" max="20000" step="10" data-bq="seats" value="' + a.seats + '"></label><label class="toggle"><input type="checkbox" data-bq="balcony"' + (a.balcony ? " checked" : "") + "> A balcony</label></div><p class=\"muted small\">You can draw its real shape afterwards (Room &amp; seats).</p></li>" +
        '<li><b>The lights: how many where</b><div class="lx-wizl"><label>Front truss ' + n("l-front", l.front) + "</label><label>Over the stage " + n("l-mid", l.mid) + "</label><label>Back truss " + n("l-back", l.back) + "</label><label>Moving heads each side " + n("l-moversEach", l.moversEach) + "</label><label>Side trusses, each side " + n("l-sides", l.sides) + "</label><label>Uplights behind the band " + n("l-uplights", l.uplights) + "</label><label>House lights " + n("l-house", l.house) + "</label><label>Blinders " + n("l-blinders", l.blinders) + '</label><label class="toggle"><input type="checkbox" data-bq="l-haze"' + (l.haze ? " checked" : "") + "> A hazer</label></div></li></ol>" +
        '<div class="lx3d-row"><button class="primary" data-bd="build">Build it</button><label class="toggle"><input type="checkbox" data-bq="keep"' + (a.keep ? " checked" : "") + '> Keep the lights I have (add these)</label></div><p class="muted small" id="lxBuildMsg">This replaces the stage and the room. Undo (↶) brings back what you had.</p>';
    } else if (tab === "templates") {
      h += '<div class="lx-tpls">' + TEMPLATES.map(function (t) { return '<div class="lx-tpl"><b>' + esc(t[1]) + '</b><p class="muted small">' + esc(t[2]) + '</p><button data-bd="tpl" data-tpl="' + t[0] + '">Use this</button></div>'; }).join("") + "</div>";
    } else if (tab === "props") {
      h += '<p class="muted small">Click one to put it on the stage, then drag it where it goes.</p><div class="lx3d-aims">' + PROPS.map(function (p) { return '<button data-bd="prop" data-prop="' + p[0] + '">' + p[1] + "</button>"; }).join("") + "</div>" + (props().length ? '<p class="muted small">' + props().length + " on the stage.</p>" : "");
    } else if (tab === "patch") {
      h += '<p class="muted small">A spreadsheet saved as CSV with a row per light: its name, type (maker and model), universe, address, and where it hangs. Or a QLC+ workspace (.qxw). Addresses like 2/101 work too.</p><div class="lx3d-row"><button data-bd="patch-open">Pick a file…</button><input type="file" accept=".csv,.txt,.tsv,.qxw,text/csv" data-bd-file hidden><button data-bd="patch-sample">A sample CSV</button></div>';
      if (importRows) {
        var bad = importRows.filter(function (r) { return r.bad; }).length, clash = importRows.filter(function (r) { return r.clash; }).length, guess = importRows.filter(function (r) { return r.guessed; }).length;
        h += '<div class="lx-patch"><table class="lx3d-trusses"><thead><tr><th>Name</th><th>Type</th><th>Fixture</th><th>Univ</th><th>Addr</th><th>Hangs</th><th>Group</th></tr></thead><tbody>' + importRows.slice(0, 200).map(function (r) { return '<tr class="' + (r.bad ? "lx-bad" : r.clash ? "lx-clash" : "") + '"><td>' + esc(r.name) + "</td><td>" + esc(r.type) + "</td><td>" + esc(r.profileName) + (r.guessed ? ' <span class="muted">(guess)</span>' : "") + "</td><td>" + r.universe + "</td><td>" + (isNaN(r.address) ? "?" : r.address) + "</td><td>" + esc(r.mount || r.position || "") + "</td><td>" + esc(r.group) + "</td></tr>"; }).join("") + "</tbody></table></div>" +
          '<p class="small">' + importRows.length + " lights" + (bad ? " · " + bad + " with an address that doesn't work (left out)" : "") + (clash ? " · " + clash + " overlap lights you have" : "") + (guess ? " · " + guess + " fixture types guessed (check them in Fixtures)" : "") + '</p><div class="lx3d-row"><button class="primary" data-bd="patch-add">Add them to my lights</button><button data-bd="patch-replace">Replace my lights with them</button></div>';
      }
      if (importMsg) h += '<p class="small" id="lxPatchMsg">' + esc(importMsg) + "</p>";
    } else if (tab === "save") {
      h += '<div class="lx3d-row"><label>Name<input data-bq="saveName" value="' + esc(answers.saveName || "Our stage") + '"></label><button class="primary" data-bd="save">Save this stage</button></div>' +
        (saved().length ? '<table class="lx3d-trusses"><tbody>' + saved().map(function (s, i) { return "<tr><td>" + esc(s.name) + '</td><td class="muted small">' + esc(String(s.saved || "").slice(0, 10)) + " · " + (s.fixtures || []).length + ' lights</td><td><button class="mini" data-bd="load" data-i="' + i + '">Use it</button><button class="mini" data-bd="del" data-i="' + i + '">✕</button></td></tr>'; }).join("") + "</tbody></table>" : '<p class="muted small">No saved stages yet.</p>') +
        '<div class="lx3d-row"><button data-bd="export">Export a stage file…</button><button data-bd="import">Open a stage file…</button><input type="file" accept=".json,.cmstage" data-bd-stage hidden><button data-bd="share">Send to the church\'s other computers</button></div><p class="muted small" id="lxShareMsg"></p>';
    }
    panel.innerHTML = h;
  }
  function open(on) { panel.hidden = on == null ? !panel.hidden : !on; if (!panel.hidden) { X.closeOthers("build"); X.roomy(); render(); } }
  X.barButton("build", "Build my stage", "Answer a few questions, start from a template, add props or bring in your patch", function () { open(); });
  panel.addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    if (b.dataset.btab) { tab = b.dataset.btab; render(); return; }
    var a = b.dataset.bd; if (!a) return;
    if (a === "close") { panel.hidden = true; return; }
    if (a === "build") { var keep = !!answers.keep; if (!keep && L.rig().fixtures.length && !confirm("Replace the stage, the room and the " + L.rig().fixtures.length + " lights you have? (Undo brings them back.)")) return; X.remember(true); var r = build(answers, keep); var m = panel.querySelector("#lxBuildMsg"); if (m) m.textContent = "Built: " + r.lights + " lights" + (r.universes > 1 ? " on " + r.universes + " universes" : "") + ". Drag anything to adjust it."; return; }
    if (a === "tpl") { if (L.rig().fixtures.length && !confirm("Start from this template? It replaces the stage and the lights (Undo brings them back).")) return; useTemplate(b.dataset.tpl); render(); return; }
    if (a === "prop") { X.remember(true); var p = addProp(b.dataset.prop); L.saveRig(); propKey = ""; X.frame(); render(); void p; return; }
    if (a === "patch-open") { panel.querySelector("[data-bd-file]").click(); return; }
    if (a === "patch-sample") { var csv = "Name,Type,Universe,Address,Position,Group\nFront 1,Chauvet SlimPAR Pro H,1,1,Front truss,front\nFront 2,Chauvet SlimPAR Pro H,1,13,Front truss,front\nWash L,Moving head wash RGBW 14ch,1,25,Back truss,beam\nHouse 1,Dimmer,2/1,House,house\n"; var aa = document.createElement("a"); aa.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); aa.download = "lights-patch-sample.csv"; aa.click(); return; }
    if (a === "patch-add" || a === "patch-replace") { if (!importRows) return; if (a === "patch-replace" && L.rig().fixtures.length && !confirm("Replace your " + L.rig().fixtures.length + " lights with these " + importRows.length + "?")) return; var n2 = importPatch(importRows, a === "patch-replace"); importMsg = "Added " + n2 + " lights. Their places on the 3D stage are a first guess: drag them where they hang."; importRows = null; render(); return; }
    if (a === "save") { saveAs(answers.saveName || "Our stage"); render(); return; }
    if (a === "load") { var s = saved()[Number(b.dataset.i)]; if (s && confirm("Use the saved stage \"" + s.name + "\"? (Undo brings back what you have now.)")) useStageFile(s); render(); return; }
    if (a === "del") { saved().splice(Number(b.dataset.i), 1); L.saveRig(); render(); return; }
    if (a === "export") { exportFile(); return; }
    if (a === "import") { panel.querySelector("[data-bd-stage]").click(); return; }
    if (a === "share") { var msg = shareWithChurch(), el = panel.querySelector("#lxShareMsg"); if (el) el.textContent = msg; return; }
  });
  panel.addEventListener("change", function (e) {
    var t = e.target, f = t.files && t.files[0]; if (!f) return;
    f.text().then(function (text) {
      if (t.hasAttribute("data-bd-file")) { var list = readPatch(text, f.name); importRows = list.length ? previewPatch(list) : null; importMsg = list.length ? "" : "No lights found: the file needs at least an address column."; render(); }
      else if (t.hasAttribute("data-bd-stage")) { try { useStageFile(JSON.parse(text)); } catch (err) { alert(err.message); } render(); }
    });
  });
  panel.addEventListener("input", function (e) {
    var k = e.target.dataset.bq; if (!k) return; var t = e.target, v = t.type === "checkbox" ? t.checked : t.value, a = answers;
    if (k === "width" || k === "depth" || k === "deck") a[k] = X.fromU(v);
    else if (k === "seats" || k === "choirRows") a[k] = Math.max(0, Number(v) || 0);
    else if (k.indexOf("r-") === 0) { a.risers[k.slice(2)] = v; render(); }
    else if (k.indexOf("l-") === 0) a.lights[k.slice(2)] = t.type === "checkbox" ? v : Math.max(0, Math.round(Number(v) || 0));
    else a[k] = v;
  });
  window.CULightsBuild = { build: function (a, keep) { answers = Object.assign(JSON.parse(JSON.stringify(DEF)), a || {}); answers.lights = Object.assign({}, DEF.lights, (a || {}).lights || {}); answers.risers = Object.assign({}, DEF.risers, (a || {}).risers || {}); X.remember(true); return build(answers, keep); },
    templates: TEMPLATES.map(function (t) { return { id: t[0], name: t[1] }; }), useTemplate: useTemplate, addProp: function (k, at) { var p = addProp(k, at); L.saveRig(); propKey = ""; X.frame(); return p; }, props: props,
    readPatch: readPatch, previewPatch: previewPatch, importPatch: importPatch, matchProfile: matchProfile, stageFile: stageFile, useStageFile: useStageFile, saveAs: saveAs, saved: saved, share: shareWithChurch, open: open, answers: function () { return answers; } };
})();
