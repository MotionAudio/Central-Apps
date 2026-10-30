/* Central Pedal - what the small 3.5" screen asks the app for: the lists it shows (keys sounds, boards, what a
 * button / knob / slider can do, the controls and what each does now) and what a pick there changes. The driver
 * draws the screen; it sends {miniRequest}, {miniPick} and {miniPackage}, and this answers with {miniList} and
 * {miniResult}. Also the setlist (move, take out, add from the library), the scenes and every track's / pad's effects. Everything goes through the same project as the big screen, so both stay in step. */
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
  // effects (js/fx.js): which tracks / pads have them, one target's effects, its presets
  function FX() { return window.PPFx && window.PPFx.mini; }
  function scenes() {
    var S = window.PPScenes; if (!S) return { items: [] };
    return { items: S.scenes().map(function (sc, i) { return { id: i, label: sc.name || "Scene " + (i + 1), sub: S.describe ? S.describe(sc) : "" }; }), current: S.activeIndex() };
  }
  function instrument() { var ins = I(), pa = ins && ins.playAny ? ins.playAny() : null; return { mode: pa ? pa.mode || "auto" : "", dry: pa ? pa.dry || 0 : 0 }; }

  // one list for the small screen (null: not one this page answers). Never throws: a part that fails is answered
  // empty, with the reason, so the screen never waits for an answer that isn't coming.
  function build(what, kind) {
    var m = { type: "miniList", what: what };
    try { if (!fill(m, what, kind)) return null; }
    catch (error) {
      console.warn("small screen: " + what + " failed", error);
      m.error = String((error && error.message) || error).slice(0, 120);
      if (what === "fx" || what === "fxPresets") { m.kind = String(kind || ""); if (what === "fx") m.state = null; else m.items = []; }
      else { if (what === "fxTargets") m.kind = kind === "pads" ? "pads" : "tracks"; m.items = []; }
    }
    return m;
  }
  function answer(what, kind) { var m = build(what, kind); if (m) send(m); }
  function fill(m, what, kind) {
    if (what === "controls") m.items = controls();
    else if (what === "actions") { m.kind = kind || "trigger"; m.items = actions(m.kind); }
    else if (what === "patches") Object.assign(m, patches());
    else if (what === "boards") Object.assign(m, boards());
    else if (what === "instrument") Object.assign(m, instrument());
    else if (what === "scenes") Object.assign(m, scenes());
    else if (what === "fxTargets" && FX()) { m.kind = kind === "pads" ? "pads" : "tracks"; m.items = FX().targets(m.kind); }
    else if (what === "fx" && FX()) { m.kind = String(kind || ""); m.state = FX().state(m.kind); }
    else if (what === "fxPresets" && FX()) { m.kind = String(kind || ""); Object.assign(m, FX().presets(m.kind) || { items: [] }); }
    else if (/^fx/.test(what) && !FX()) throw new Error("the effects are still starting");
    else return false;
    return true;
  }

  // The small screen draws from the driver's copy of these lists, so they're sent when this page connects and
  // whenever they change (checked every 1.5 s; the long lists every 6 s) - the screen never waits for an answer.
  var pushed = {}, pushTick = 0;
  function pushLists(all) {
    var b = window.__pedalBridge; if (!b || !b.connected) return 0;
    var keys = [["fxTargets", "tracks"], ["fxTargets", "pads"], ["scenes"], ["instrument"]];
    if (all || pushTick % 4 === 0) keys = keys.concat([["controls"], ["patches"], ["boards"], ["actions", "trigger"], ["actions", "continuous"]]);
    var lists = {}, n = 0;
    function add(key, m) { var sig = JSON.stringify(m); if (all || pushed[key] !== sig) { pushed[key] = sig; lists[key] = m; n++; } }
    keys.forEach(function (k) {
      var m = build(k[0], k[1]); if (!m) return;
      delete m.type; delete m.what;
      if (k[0] === "fxTargets") (m.items || []).forEach(function (it) {   // (and each track's / pad's / bus's own effects)
        var f = build("fx", it.id); if (!f) return; delete f.type; delete f.what; add("fx:" + it.id, f);
      });
      add(k[0] + (m.kind ? ":" + m.kind : ""), m);
    });
    if (n) send({ type: "miniPush", lists: lists });
    return n;
  }
  F.on("hello", function () { pushed = {}; setTimeout(function () { pushLists(true); }, 300); });
  setInterval(function () { pushTick++; try { pushLists(false); } catch (error) { console.warn("small screen lists", error); } }, 1500);
  window.PPMiniBridge = { push: pushLists, build: build };
  F.on("miniRequest", function (m) { answer(m.what, m.kind); });

  // the small screen's effects rows: an amount (a fader), an effect on / off, the reverb type / delay time (next).
  // Hidden actions - not in the lists of what a button can do.
  var fxTimer = {};
  function fxAnswer(id) {   // (a fader sends ~40 a second: the new state goes back at most every 120 ms)
    if (fxTimer[id]) return;
    fxTimer[id] = setTimeout(function () { delete fxTimer[id]; answer("fx", id); answer("fxTargets", /^(pad|bus:pads)/.test(id) ? "pads" : "tracks"); }, 120);
  }
  function fxRun(id, op) {
    if (!FX()) return;
    var r = FX().apply(String(id || ""), op);
    if (typeof r === "string") send({ type: "miniResult", text: r });
    fxAnswer(String(id || ""));
  }
  A.ACTIONS.fxValue = { id: "fxValue", label: "Effects: an amount (small screen)", group: "Effects", kind: "continuous", hidden: true, run: function (a, v) { if (a && a.target && a.path) fxRun(a.target, { path: String(a.path), v: Number(v) || 0 }); } };
  A.ACTIONS.fxToggle = { id: "fxToggle", label: "Effects: on / off (small screen)", group: "Effects", kind: "trigger", hidden: true, run: function (a) { if (a && a.target && a.path) fxRun(a.target, { toggle: String(a.path) }); } };
  A.ACTIONS.fxCycle = { id: "fxCycle", label: "Effects: next reverb type / delay time (small screen)", group: "Effects", kind: "trigger", hidden: true, run: function (a) { if (a && a.target && a.path) fxRun(a.target, { cycle: String(a.path) }); } };

  // the setlist from the small screen: move a song up / down, take one out (of this setlist only), add one from the library
  function setlistMove(i, d) {
    var p = PP.project(), songs = p.songs, j = i + (d < 0 ? -1 : 1); if (!songs[i] || j < 0 || j >= songs.length) return;
    var cur = songs[p.songIndex]; songs.splice(j, 0, songs.splice(i, 1)[0]); p.songIndex = cur ? songs.indexOf(cur) : p.songIndex;
    PP.persistSoon(); F.renderSetlist(); F.renderPerformExtras();
  }
  function setlistRemove(i) {
    var p = PP.project(), songs = p.songs, cur = songs[p.songIndex]; if (!songs[i]) return;
    var nm = songs[i].name; songs.splice(i, 1);
    p.songIndex = cur && songs.indexOf(cur) >= 0 ? songs.indexOf(cur) : Math.min(p.songIndex, songs.length - 1);
    PP.persistSoon(); F.renderSetlist(); F.renderPerformExtras();
    send({ type: "miniResult", text: "\"" + nm + "\" is out of the setlist (it stays in the song library)" });
  }

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
    } else if (m.what === "fxPresets" && m.target) {
      fxRun(m.target, { preset: String(m.id || "") });
    } else if (m.what === "scenes" && window.PPScenes) {
      window.PPScenes.recallIndex(Number(m.id) || 0); answer("scenes");
    } else if (m.what === "library" && m.id) {
      if (window.PPSync && window.PPSync.addSong) window.PPSync.addSong(String(m.id));
      else send({ type: "miniResult", text: "Add songs in the app (♫ Setlist → Song library)." });
    } else if (m.what === "setlists" && m.id) {   // (10.0: Load setlist on the small screen)
      if (window.PPSync && window.PPSync.openSetlist) window.PPSync.openSetlist(String(m.id)).then(function () { send({ type: "miniResult", text: "Opened \"" + PP.project().name + "\"" }); if (window.PPTracks && window.PPTracks.sendDisplay) window.PPTracks.sendDisplay(); });
    } else if (m.what === "setlistMove") {
      setlistMove(Number(m.id), Number(m.target) || 1);
    } else if (m.what === "setlistRemove") {
      setlistRemove(Number(m.id));
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
