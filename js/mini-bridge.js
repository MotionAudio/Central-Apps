/* Central Pedal - what the small 3.5" screen asks the app for: the lists it shows (keys sounds, boards, what a
 * button / knob / slider can do, the controls and what each does now) and what a pick there changes. The driver
 * draws the screen; it sends {miniRequest}, {miniPick} and {miniPackage}, and this answers with {miniList} and
 * {miniResult}. Everything goes through the same project as the big screen, so both stay in step. */
(function () {
  "use strict";
  var PP = window.PP, F = window.PPFeatures, A = window.PPActions; if (!PP || !F || !A) return;
  function send(m) { var b = window.__pedalBridge; return b && b.send ? b.send(m) : false; }
  function I() { return window.PPInstrument; }
  function PED() { return window.PPPedals; }
  function locked(tier) { var P = PED(); return tier && P && P.has && !P.has(tier) ? (P.lockText ? P.lockText(tier) : "needs a plan") : null; }

  var KIND_OF = { button: "trigger", knob: "continuous", slider: "continuous", expression: "continuous" };
  var NAMES = { b: "Button ", k: "Knob ", s: "Slider " };
  // the controls on the pedal (12 buttons, 6 knobs, 2 sliders, the expression pedal) and what each does now
  function controls() {
    var p = PP.project(), map = A.mapping(), list = Array.isArray(p.inputs) && p.inputs.length ? p.inputs : null;
    if (!list) list = Object.keys(map).filter(function (id) { return /^(b|k|s)\d+$|^exp$/.test(id); }).map(function (id) { var m = /^([bks])(\d+)$/.exec(id); return { id: id, name: m ? NAMES[m[1]] + m[2] : "Expression pedal", kind: m ? { b: "button", k: "knob", s: "slider" }[m[1]] : "expression" }; });
    return list.filter(function (i) { return KIND_OF[i.kind] && !i.streamdeck; }).map(function (i) {
      var e = map[i.id] || { action: "none" }, a = A.ACTIONS[e.action];
      return { id: i.id, name: i.name || i.id, kind: KIND_OF[i.kind], action: e.action || "none", label: a ? a.label + argText(a, e.args) : "— nothing —" };
    });
  }
  function argText(a, args) {   // ("Play pad 3", "Show tab settings")
    if (!a.arg || !args) return "";
    if (a.arg === "tab") return args.tab ? " " + args.tab : "";
    return typeof args.index === "number" ? " " + (args.index + 1) : "";
  }
  function actions(kind) { return A.list(kind || "trigger").map(function (a) { return { id: a.id, label: a.label, sub: a.group }; }); }
  function patches() {
    var ins = I(), cat = ins && ins.catalog ? ins.catalog() : null, st = ins ? ins.state() : {};
    return { items: ((cat && cat.keys) || []).map(function (q) { return { id: q.id, label: q.name, sub: q.bankName || "", locked: locked(q.tier) }; }), current: st.patch ? st.patch.id : null };
  }
  function boards() {
    var ins = I(), P = PED(); if (!ins || !P) return { items: [] };
    var k = ins.kind(), c = ins.config(), all = (P.boards || []).concat(c.custom || []).filter(function (b) { return b.kind === k; });
    return { items: all.map(function (b) { var lk = P.boardLocked && P.boardLocked(b); return { id: b.id, label: b.name, sub: b.custom ? "yours" : "", locked: lk ? P.lockText(P.missing(b.plans || P.boardPlans(b))) : null }; }), current: (c.boards || {})[k] || null };
  }
  function instrument() { var ins = I(), pa = ins && ins.playAny ? ins.playAny() : null; return { mode: pa ? pa.mode || "auto" : "", dry: pa ? pa.dry || 0 : 0 }; }

  function answer(what, kind) {
    var m = { type: "miniList", what: what };
    if (what === "controls") m.items = controls();
    else if (what === "actions") { m.kind = kind || "trigger"; m.items = actions(m.kind); }
    else if (what === "patches") Object.assign(m, patches());
    else if (what === "boards") Object.assign(m, boards());
    else if (what === "instrument") Object.assign(m, instrument());
    else return;
    send(m);
  }
  F.on("miniRequest", function (m) { answer(m.what, m.kind); });

  F.on("miniPick", function (m) {
    var ins = I();
    if (m.what === "actions" && m.target && A.ACTIONS[m.id]) {
      var map = A.mapping(), e = map[m.target] || (map[m.target] = { action: "none" });
      e.action = m.id; e.args = A.ACTIONS[m.id].arg === "pad" ? { index: 0 } : A.ACTIONS[m.id].arg === "tab" ? { tab: "pads" } : {};
      PP.persistSoon(); A.modeChanged(); PP.setStatus("Small screen: " + m.target + " → " + A.ACTIONS[m.id].label);
      answer("controls");
    } else if (m.what === "patches" && ins) {
      var p = ((ins.catalog() || {}).keys || []).filter(function (q) { return q.id === m.id; })[0]; if (!p || locked(p.tier)) return;
      var c = ins.config(); c.keys.patch = { id: p.id, file: p.file, bank: p.bank, prog: p.prog, name: p.name }; ins.layers(c)[0].patch = c.keys.patch;
      send({ type: "instrument", action: "keys", keys: ins.hostConfig().keys }); PP.persistSoon(); PP.setStatus("Sound: " + p.name); if (ins.render) ins.render();
    } else if (m.what === "boards" && ins) {
      var k = ins.kind(); if (k === "off") return;
      ins.loadBoard(k, m.id); ins.apply("board"); PP.persistSoon(); if (ins.render) ins.render();
    } else if (m.what === "playAnyMode" && ins && ins.stepPlayAnyMode) {
      ins.stepPlayAnyMode(1); answer("instrument");
    }
    if (window.PPTracks && window.PPTracks.sendDisplay) window.PPTracks.sendDisplay();
  });

  // a package key typed on the small screen: added the same way as Settings → Packages → Add a package
  F.on("miniPackage", async function (m) {
    var L = window.PPLicense; if (!L || !L.addPackage) { send({ type: "miniResult", text: "Add the package in the app (Settings → Packages)." }); return; }
    var key = String(m.key || "").toUpperCase();
    try { await L.addPackage(key); } catch (_) { }
    var ok = (L.packages() || []).some(function (p) { return p.key === key; });
    send({ type: "miniResult", text: ok ? "Package added: " + key : "That key didn't work - check it, or add it in the app (Settings → Packages)." });
  });
})();
