// (11.0) The main board rev B's 18 little label screens - one above every footswitch, click-knob and fader - say what
// that control does right now: the job it's set to (Configure tab), the pad / song / loop it points at, and its level.
// This page works the words out and sends them to the driver, which draws them (pedal-driver.py LabelScreens).
// Sent when the page connects, whenever a job / name changes (checked every second), and the moment a control moves.
(function () {
  "use strict";
  var F = window.PPFeatures, A = window.PPActions, PP = window.PP;
  if (!F || !A || !PP) return;
  function send(m) { var b = window.__pedalBridge; if (b && b.connected && b.send) b.send(m); }
  function hello() { return window.PPConfigure && window.PPConfigure.hello ? window.PPConfigure.hello() : null; }
  function screens() { var h = hello(); return h && Array.isArray(h.labelScreens) ? h.labelScreens : []; }

  // short words for the big line (the full labels are sentences)
  var SHORT = {
    none: "—", playAll: "Play", stopAll: "Stop", playSelected: "Play pad", layer: "Layer pad", pad: "Pad", nextSection: "Next part", prevSection: "Prev part",
    restartSection: "Restart part", repeatSection: "Repeat part", nextSong: "Next song", prevSong: "Prev song", nextSongPlay: "Next + play", loadSong: "Song",
    tap: "Tap tempo", freeze: "Freeze", toggleClick: "Click", toggleCues: "Cues", countIn: "Count-in", tuner: "Tuner", panic: "Panic",
    selectNextPad: "Next pad", selectPrevPad: "Prev pad", keyUp: "Key +", keyDown: "Key −", volume: "Volume", tone: "Tone", reverb: "Reverb", fade: "Fade",
    expression: "Swell", morphPos: "Morph", padLevel: "Pad level", padVolume: "Pad vol", tracksLevel: "Tracks", clickLevel: "Click lvl", cueLevel: "Cue voice",
    balance: "Pads⇄Tracks", tempoPercent: "Tempo", stemLevel: "Stem", stemPan: "Stem pan", texture1Level: "Texture 1", texture2Level: "Texture 2",
    instrumentLevel: "Instrument", instrumentExpression: "Inst. swell", playAnyDry: "Dry blend", inputGain: "Input gain", looperPedal: "Looper",
    looperRec: "Loop rec", looperTrackStop: "Loop stop", looperTrackUndo: "Loop undo", looperTrackRedo: "Loop redo", looperTrackClear: "Loop clear",
    looperTrackMute: "Loop mute", stepSection: "Parts", playPauseAll: "Play / pause", performEdit: "Edit", keyStep: "Key", scene: "Scene", recallScene: "Scene"
  };
  function shortName(id) {
    if (SHORT[id]) return SHORT[id];
    var a = A.ACTIONS[id]; if (!a) return id;
    var t = String(a.label || id).split(/[:(–-]/)[0].trim();
    return t.length > 16 ? t.slice(0, 15) + "…" : t;
  }
  function detail(e) {   // what the job points at: the pad's / song's / loop's name
    var a = A.ACTIONS[e.action], args = e.args || {}; if (!a || !a.arg) return "";
    try {
      var p = PP.project();
      if (a.arg === "pad") { var pad = p.pads[Number(args.index) || 0]; return pad ? pad.name : ""; }
      if (a.arg === "song") { var s = p.songs[Number(args.index) || 0]; return s ? s.name : "Song " + ((Number(args.index) || 0) + 1); }
      if (a.arg === "loop") return "Loop " + ((Number(args.index) || 0) + 1);
      if (a.arg === "stem") { var T = window.PPTracks, song = T && T.song(); var st = song && T.data(song).stems[Number(args.index) || 0]; return st ? st.name : "Stem " + ((Number(args.index) || 0) + 1); }
      if (a.arg === "tab") return A.TAB_NAMES && A.TAB_NAMES[args.tab] ? A.TAB_NAMES[args.tab] : String(args.tab || "");
      if (a.arg === "scene" && window.PPScenes) { var sc = window.PPScenes.scenes()[Number(args.index) || 0]; return sc ? sc.name : ""; }
    } catch (_) { }
    return "";
  }
  var values = {};   // control id -> last level 0..1 (faders from the driver, knobs from the actions)
  function item(id) {
    var spec = inputs().filter(function (i) { return i.id === id; })[0] || { name: id };
    var e = A.entryFor(id), a = e && A.ACTIONS[e.action];
    var top = String(spec.name || id).replace(/^Footswitch /, "FS ").replace(/\(expression [AB]\)/, "").replace(/ knob /, " ").trim();
    if (!e || !a || e.action === "none") return { top: top, bottom: "—" };
    var what = detail(e), bottom = shortName(e.action);
    if (what) bottom = (a.arg === "pad" || a.arg === "song" || a.arg === "scene") ? what : bottom + " " + what;
    if (e.hold && e.hold.action && e.hold.action !== "none") top = top + " · hold: " + shortName(e.hold.action);
    var out = { top: top.slice(0, 40), bottom: bottom.slice(0, 40) };
    if (a.kind === "continuous") { var v = values[id]; if (v == null && A.encoderValue) v = A.encoderValue(id); if (typeof v === "number") out.value = Math.round(v * 1000) / 1000; }
    else if (a.led) { try { var led = a.led(e.args || {}); if (led === "on") out.bottom = "● " + out.bottom; } catch (_) { } }
    return out;
  }
  function inputs() { return (window.PPConfigure && window.PPConfigure.inputs && window.PPConfigure.inputs()) || []; }

  var sent = {}, timer = null;
  function push(all) {
    var ids = screens(); if (!ids.length) return 0;
    var items = {}, n = 0;
    ids.forEach(function (id) {
      var it; try { it = item(id); } catch (error) { it = { top: id, bottom: "?" }; }
      var sig = JSON.stringify(it);
      if (all || sent[id] !== sig) { sent[id] = sig; items[id] = it; n++; }
    });
    if (n) send({ type: "labels", items: items });
    return n;
  }
  function soon(ms) { clearTimeout(timer); timer = setTimeout(function () { try { push(false); } catch (error) { console.warn("label screens", error); } }, ms || 80); }
  function touched(id, m) {   // a control moved / was pressed (actions.js): its level, then the words again (a toggle may have flipped)
    if (typeof m.value === "number") values[id] = m.value;
    else if (typeof m.delta === "number" && A.encoderValue && typeof A.encoderValue(id) === "number") values[id] = A.encoderValue(id);
    soon(60);
  }
  F.on("hello", function () { sent = {}; setTimeout(function () { push(true); }, 600); });
  F.on("boardChanged", function () { sent = {}; setTimeout(function () { push(true); }, 800); });
  setInterval(function () { try { push(false); } catch (error) { console.warn("label screens", error); } }, 1000);
  window.PPLabels = { push: push, touched: touched, item: item, shortName: shortName };
})();
