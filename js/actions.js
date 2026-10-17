/* Pad Pedal - actions: one list of everything a button, knob, slider, pedal,
 * encoder, USB pedal, MIDI controller, companion device or the 3.5" screen can
 * do. The Configure tab maps every input to one of these - one layout for
 * everything. Also computes the button LED states for the driver. */
(function () {
  "use strict";
  var PP = window.PP, F = window.PPFeatures; if (!PP || !F) return;
  var engine = PP.engine, clamp = PP.clamp;
  function project() { return PP.project(); }
  function T() { return window.PPTracks; }
  function X() { return window.PPTextures; }

  var ACTIONS = {};
  function def(id, label, group, kind, run, extra) { ACTIONS[id] = Object.assign({ id: id, label: label, group: group, kind: kind, run: run }, extra || {}); }
  // ---- triggers (buttons, pedals, MIDI notes, companion buttons)
  def("none", "— nothing —", "General", "trigger", function () { });
  function hasTracks() { var t = T(); if (!t) return false; var s = t.song(); return !!(s && t.data(s).stems && t.data(s).stems.length); }
  function anythingPlaying() { return (T() && T().isPlaying()) || engine.voices().length > 0; }
  def("playAll", "Play all: tracks (pads follow) - or the song's pad when there are no tracks", "Transport", "trigger", function () {
    if (hasTracks()) { if (!T().isPlaying()) T().play(); } else if (!engine.voices().length) PP.toggleSelected();
  }, { led: function () { return anythingPlaying() ? "on" : "off"; } });
  def("playPauseAll", "Play / pause all", "Transport", "trigger", function () {
    if (hasTracks()) T().togglePlay(); else PP.toggleSelected();
  }, { led: function () { return anythingPlaying() ? "on" : "off"; } });
  def("stopAll", "Stop all: tracks, pads (fade) and the looper", "Transport", "trigger", function () {
    if (T() && T().isPlaying()) T().stop(false); engine.stop(); var L2 = window.PPLooper; if (L2 && L2.state().state !== "empty") L2.stop();
  });
  def("nextSongStop", "Skip to the next song (stops what's playing)", "Transport", "trigger", function () { if (T() && T().isPlaying()) T().stop(false); F.stepSong(1); });
  def("prevSongStop", "Back to the previous song (stops what's playing)", "Transport", "trigger", function () { if (T() && T().isPlaying()) T().stop(false); F.stepSong(-1); });
  def("pad", "Play pad", "Pads", "trigger", function (a) { PP.triggerPad(Number(a && a.index) || 0); }, { arg: "pad", led: function (a) { var i = Number(a && a.index) || 0; return engine.playingIndexes().indexOf(i) > -1 ? "on" : i === PP.selected() && !engine.voices().length ? "blink" : "off"; } });
  def("padLayer", "Layer pad (stack)", "Pads", "trigger", function (a) { PP.triggerPad(Number(a && a.index) || 0, { layer: true }); }, { arg: "pad", led: function (a) { return engine.playingIndexes().indexOf(Number(a && a.index) || 0) > -1 ? "on" : "off"; } });
  def("padHold", "Pad while held", "Pads", "trigger", function (a) { var i = Number(a && a.index) || 0; if (engine.playingIndexes().indexOf(i) < 0) PP.triggerPad(i, { layer: engine.voices().length > 0 }); }, { arg: "pad", release: function (a) { var i = Number(a && a.index) || 0; if (engine.voiceFor(i)) engine.playPad(i, null, { layer: true }); }, led: function (a) { return engine.playingIndexes().indexOf(Number(a && a.index) || 0) > -1 ? "on" : "off"; } });
  def("playSelected", "Play / fade the selected pad", "Pads", "trigger", function () { PP.toggleSelected(); }, { led: function () { return engine.voices().length ? "on" : "off"; } });
  def("selectNextPad", "Select next pad (no sound)", "Pads", "trigger", function () { PP.setSelectedPad((PP.selected() + 1) % PP.PAD_COUNT, false); });
  def("selectPrevPad", "Select previous pad (no sound)", "Pads", "trigger", function () { PP.setSelectedPad((PP.selected() + PP.PAD_COUNT - 1) % PP.PAD_COUNT, false); });
  def("stop", "Stop pads (fade)", "Pads", "trigger", function () { engine.stop(); }, { led: function () { return engine.voices().length ? "on" : "off"; } });
  def("panic", "Cut everything (panic)", "Pads", "trigger", function () { engine.panic(); });
  def("freeze", "Freeze on / off", "Pads", "trigger", function () { F.toggleFreeze(); }, { led: function () { return engine.frozen ? "on" : "off"; } });
  def("freezeHold", "Freeze while held", "Pads", "trigger", function () { if (!engine.frozen) F.toggleFreeze(); }, { release: function () { if (engine.frozen) F.toggleFreeze(); }, led: function () { return engine.frozen ? "on" : "off"; } });
  def("layer", "Layer mode on / off", "Pads", "trigger", function () { F.toggleLayerMode(); }, { led: function () { return project().performance.layerMode ? "on" : "off"; } });
  def("morph", "Morph (pick A, B)", "Pads", "trigger", function () { F.morphButton(); }, { led: function () { return engine.morph ? "on" : "off"; } });
  def("tap", "Tap tempo", "Tempo", "trigger", function () { F.tap(); }, { led: function () { return "beat"; } });
  def("keyUp", "Key up", "Key", "trigger", function () { if (T() && T().isActive()) T().shiftKey(1); else PP.changeKey(1); });
  def("keyDown", "Key down", "Key", "trigger", function () { if (T() && T().isActive()) T().shiftKey(-1); else PP.changeKey(-1); });
  def("nextSong", "Next song", "Setlist", "trigger", function () { F.stepSong(1); });
  def("prevSong", "Previous song", "Setlist", "trigger", function () { F.stepSong(-1); });
  def("nextSongPlay", "Next song and play its tracks", "Setlist", "trigger", function () { if (T()) T().stepSongAndPlay(1); else F.stepSong(1); });
  def("loadSong", "Load song N", "Setlist", "trigger", function (a) { F.loadSong(Number(a && a.index) || 0); }, { arg: "song" });
  def("playPause", "Tracks: play / pause", "Tracks", "trigger", function () { if (T()) T().togglePlay(); }, { led: function () { return T() && T().isPlaying() ? "on" : "off"; } });
  def("playTracks", "Tracks: play (with count-in)", "Tracks", "trigger", function () { if (T()) T().play(); }, { led: function () { return T() && T().isPlaying() ? "on" : "off"; } });
  def("stopTracks", "Tracks: stop", "Tracks", "trigger", function () { if (T()) T().stop(false); });
  def("startOver", "Tracks: start over", "Tracks", "trigger", function () { if (T()) T().startOver(); });
  def("nextSection", "Tracks: next section", "Tracks", "trigger", function () { if (T()) T().nextSection(); });
  def("prevSection", "Tracks: previous section", "Tracks", "trigger", function () { if (T()) T().prevSection(); });
  def("restartSection", "Tracks: restart this section", "Tracks", "trigger", function () { if (T()) T().restartSection(); });
  def("repeatSection", "Tracks: repeat this section on / off", "Tracks", "trigger", function () { if (T()) T().toggleLoop(); }, { led: function () { return T() && T().state.loop >= 0 ? "on" : "off"; } });
  def("goSection", "Tracks: go to section N", "Tracks", "trigger", function (a) { if (T()) T().goSection(Number(a && a.index) || 0); }, { arg: "section" });
  def("queueSection", "Flow: play section N next", "Tracks", "trigger", function (a) { if (T()) T().queueSection(Number(a && a.index) || 0); }, { arg: "section" });
  def("flowRepeat", "Flow: this section once more", "Tracks", "trigger", function () { if (T()) T().flowRepeat(); });
  def("flowSkip", "Flow: skip the next section", "Tracks", "trigger", function () { if (T()) T().flowSkip(); });
  def("flowToggle", "Flow: follow the arrangement on / off", "Tracks", "trigger", function () { if (T()) T().setFlowOn(!T().flowActive(T().song())); }, { led: function () { return T() && T().flowActive(T().song()) ? "on" : "off"; } });
  def("queueArm", "Flow: then press a section button = play it next", "Tracks", "trigger", function () { if (T()) T().armQueue(); });
  def("toggleTracks", "Tracks mode on / off", "Tracks", "trigger", function () { if (T()) T().setTracksMode(!project().tracksMode); }, { led: function () { return project().tracksMode ? "on" : "off"; } });
  def("toggleClick", "Click on / off", "Tracks", "trigger", function () { if (T()) T().toggleClick(); }, { led: function () { var s = T() && T().song(); return s && T().data(s).click.on ? "on" : "off"; } });
  def("toggleCues", "Voice cues on / off", "Tracks", "trigger", function () { if (T()) T().toggleCues(); }, { led: function () { var s = T() && T().song(); return s && T().data(s).cues.on ? "on" : "off"; } });
  def("countIn", "Count-in: off / 1 bar / 2 bars", "Tracks", "trigger", function () { if (T()) T().cycleCountIn(); });
  def("tempoReset", "Tracks: tempo back to 100%", "Tracks", "trigger", function () { if (T()) T().setTempoPercent(100); });
  // from Central Usage the lyrics page only inside the section while tracks play: moving the tracks is the Central Control's job
  def("lyricsNext", "Lyrics: next page", "Screens", "trigger", function (a, v, info) { if (T()) T().lyricsStep(1, { stay: info && info.from === "central-usage" }); });
  def("lyricsPrev", "Lyrics: previous page", "Screens", "trigger", function (a, v, info) { if (T()) T().lyricsStep(-1, { stay: info && info.from === "central-usage" }); });
  def("projectorBlank", "Projector: blank on / off", "Screens", "trigger", function () { var p = project(); p.projector = p.projector || {}; p.projector.blank = !p.projector.blank; PP.persistSoon(); if (T()) T().sendDisplay(); }, { led: function () { return project().projector && project().projector.blank ? "on" : "off"; } });
  def("texture1", "Texture 1 on / off", "Textures", "trigger", function () { if (X()) X().toggle(0); }, { led: function () { return X() && X().channels()[0].enabled ? "on" : "off"; } });
  def("texture2", "Texture 2 on / off", "Textures", "trigger", function () { if (X()) X().toggle(1); }, { led: function () { return X() && X().channels()[1].enabled ? "on" : "off"; } });
  def("performEdit", "Switch Perform / Edit screen", "Screens", "trigger", function () { PP.setPerformMode(!PP.isPerforming()); });
  def("tab", "Show tab (Pad / Tracks / Instrument / …)", "Screens", "trigger", function (a) { if (window.PPShell) window.PPShell.showTab((a && a.tab) || "pads"); }, { arg: "tab" });
  def("sayCue", "Say a cue word now", "Tracks", "trigger", function (a) { if (T()) T().say((a && a.cue) || "chorus"); }, { arg: "cue" });
  // ---- continuous (knobs, sliders, expression, MIDI CC)
  def("volume", "Master volume", "Pads", "continuous", function (a, v) { PP.setPerformance("volume", v); });
  def("tone", "Tone (darker ↔ brighter)", "Pads", "continuous", function (a, v) { PP.setPerformance("tone", v); });
  def("reverb", "Reverb amount", "Pads", "continuous", function (a, v) { PP.setPerformance("reverb", v); });
  def("fade", "Fade time", "Pads", "continuous", function (a, v) { PP.setPerformance("fade", v); });
  def("expression", "Expression / swell", "Pads", "continuous", function (a, v) { PP.setExpression(v); });
  def("morphPos", "Morph position (A ↔ B)", "Pads", "continuous", function (a, v) { if (engine.morph) { project().performance.morph = v; engine.setMorph(v); F.renderPerformExtras(); } });
  def("padLevel", "Selected pad's own level", "Pads", "continuous", function (a, v) { var p = PP.currentPad(); p.level = Math.round(v * 100); engine.update(p); PP.persistSoon(); PP.loadForm(); });
  def("tracksLevel", "Tracks level", "Tracks", "continuous", function (a, v) { if (T()) T().setLevel("tracks", v); });
  def("clickLevel", "Click level", "Tracks", "continuous", function (a, v) { if (T()) T().setLevel("click", v); });
  def("cueLevel", "Cue voice level", "Tracks", "continuous", function (a, v) { if (T()) T().setLevel("cue", v); });
  def("balance", "Pads ↔ Tracks balance", "Tracks", "continuous", function (a, v) { if (T()) T().balance(v); });
  def("tempoPercent", "Tracks tempo (50–150 %)", "Tracks", "continuous", function (a, v) { if (T()) T().setTempoPercent(50 + v * 100); });
  def("stemLevel", "Stem N level", "Tracks", "continuous", function (a, v) { var s = T() && T().song(); if (!s) return; var st = T().data(s).stems[Number(a && a.index) || 0]; if (st) { T().setStem(st.id, "gain", v * 1.3); T().render(); } }, { arg: "stem" });
  def("texture1Level", "Texture 1 level", "Textures", "continuous", function (a, v) { if (X()) X().setLevel(0, v); });
  def("texture2Level", "Texture 2 level", "Textures", "continuous", function (a, v) { if (X()) X().setLevel(1, v); });
  // ---- instrument (the pedalboard / keys on the Instrument tab)
  function I() { return window.PPInstrument; }
  def("pedalToggle", "Instrument: pedal N on / off", "Instrument", "trigger", function (a) { if (I()) I().togglePedal(Number(a && a.index) || 0); }, { arg: "pedal", led: function (a) { var list = I() ? I().pedalNames() : [], it = list[Number(a && a.index) || 0]; return it ? (it.on ? "on" : "off") : "off"; } });
  def("pedalHold", "Instrument: pedal N while held", "Instrument", "trigger", function (a) { var list = I() ? I().pedalNames() : [], it = list[Number(a && a.index) || 0]; if (it && !it.on) I().togglePedal(Number(a && a.index) || 0); }, { arg: "pedal", release: function (a) { var list = I() ? I().pedalNames() : [], it = list[Number(a && a.index) || 0]; if (it && it.on) I().togglePedal(Number(a && a.index) || 0); }, led: function (a) { var list = I() ? I().pedalNames() : [], it = list[Number(a && a.index) || 0]; return it && it.on ? "on" : "off"; } });
  def("boardNext", "Instrument: next board preset", "Instrument", "trigger", function () { if (I()) I().stepBoard(1); });
  def("boardPrev", "Instrument: previous board preset", "Instrument", "trigger", function () { if (I()) I().stepBoard(-1); });
  def("patchNext", "Keys: next sound", "Instrument", "trigger", function () { if (I()) I().stepPatch(1); });
  def("patchPrev", "Keys: previous sound", "Instrument", "trigger", function () { if (I()) I().stepPatch(-1); });
  def("tuner", "Instrument: tuner on / off", "Instrument", "trigger", function () { if (I()) I().tunerToggle(); }, { led: function () { return I() && I().state().tuner ? "on" : "off"; } });
  def("instrumentKind", "Instrument: switch electric / acoustic / bass / keys / off", "Instrument", "trigger", function () { if (!I()) return; var order = ["electric", "acoustic", "bass", "keys", "off"], k = I().state().kind; I().setKind(order[(order.indexOf(k) + 1) % order.length]); });
  def("instrumentAuto", "Instrument: Auto set-up", "Instrument", "trigger", function () { if (I()) I().autoSetup(); });
  def("instrumentExpression", "Instrument: expression (wah / volume pedal)", "Instrument", "continuous", function (a, v) { if (I()) I().expression(v); });
  def("instrumentLevel", "Instrument: output level", "Instrument", "continuous", function (a, v) { if (!I()) return; var s = I().state(); s.levelDb = Math.round((-30 + v * 42) * 2) / 2; PP.persistSoon(); if (window.__pedalBridge && window.__pedalBridge.send) window.__pedalBridge.send({ type: "instrument", action: "level", levelDb: s.levelDb }); });
  def("stepPedal", "Encoder: next / previous board preset", "Instrument", "step", function (a, d) { if (I()) I().stepBoard(d); });
  def("stepPatch", "Encoder: next / previous keys sound", "Instrument", "step", function (a, d) { if (I()) I().stepPatch(d); });
  // ---- looper (Instrument)
  function L() { return window.PPLooper; }
  def("looperMain", "Looper: record / play / overdub", "Looper", "trigger", function () { if (L()) L().main(); }, { led: function () { var st = L() ? L().state().state : "empty"; return st === "recording" || st === "dubbing" ? "blink" : st === "playing" ? "on" : st === "armed" ? "beat" : "off"; } });
  def("looperStop", "Looper: stop / play", "Looper", "trigger", function () { if (!L()) return; var st = L().state().state; if (st === "stopped") L().play(); else L().stop(); }, { led: function () { return L() && L().state().state === "stopped" ? "on" : "off"; } });
  def("looperUndo", "Looper: undo the last overdub", "Looper", "trigger", function () { if (L()) L().undo(); });
  def("looperClear", "Looper: clear", "Looper", "trigger", function () { if (L()) L().clear(); });
  def("looperLevel", "Looper: level", "Looper", "continuous", function (a, v) { if (L()) L().setLevel(v * 1.2); });
  // ---- scenes (per song: pad layers, track mix, instrument) and the mixer
  function S() { return window.PPScenes; }
  def("sceneNext", "Scene: next scene of this song", "Scenes", "trigger", function () { if (S()) S().step(1); });
  def("scenePrev", "Scene: previous scene of this song", "Scenes", "trigger", function () { if (S()) S().step(-1); });
  def("sceneN", "Scene: recall scene N", "Scenes", "trigger", function (a) { if (S()) S().recallIndex(Number(a && a.index) || 0); }, { arg: "scene", led: function (a) { return S() && S().activeIndex() === (Number(a && a.index) || 0) ? "on" : "off"; } });
  def("abA", "Rehearse: set loop point A here", "Rehearse", "trigger", function () { if (T()) T().abSet("a"); });
  def("abB", "Rehearse: set loop point B here (starts the A–B loop)", "Rehearse", "trigger", function () { if (T()) T().abSet("b"); });
  def("abLoop", "Rehearse: A–B loop on / off", "Rehearse", "trigger", function () { if (T()) T().abToggle(); }, { led: function () { return T() && T().state.loop === -2 ? "on" : "off"; } });
  def("abClear", "Rehearse: clear A and B", "Rehearse", "trigger", function () { if (T()) T().abClear(); });
  def("slower", "Rehearse: 5% slower (same pitch)", "Rehearse", "trigger", function () { if (T()) T().nudgeTempo(-5); });
  def("faster", "Rehearse: 5% faster (same pitch)", "Rehearse", "trigger", function () { if (T()) T().nudgeTempo(5); });
  def("showMixer", "Show the mixer", "Tracks", "trigger", function () { if (T()) T().openMixer(); });
  def("segueNow", "Setlist: go into the next song now (segue)", "Setlist", "trigger", function () { if (T()) { T().preloadNext(); setTimeout(function () { if (!T().startSegue()) T().stepSongAndPlay(1); }, 200); } });
  def("padLayerLevel", "Pad layer N level", "Pads", "continuous", function (a, v) { var ls = engine.layerState(), l = ls[Number(a && a.index) || 0]; if (l) engine.setLayerLevel(l.pad, v * 1.2); }, { arg: "layer" });
  def("keysLayerLevel", "Keys: layer N volume", "Instrument", "continuous", function (a, v) { var I2 = window.PPInstrument; if (!I2) return; var ls = I2.layers(), l = ls[Number(a && a.index) || 0]; if (l) { l.volume = v; window.__pedalBridge && window.__pedalBridge.send({ type: "instrument", action: "keys", keys: I2.hostConfig().keys }); PP.persistSoon(); } }, { arg: "layer" });
  def("keysLayerToggle", "Keys: layer N on / off", "Instrument", "trigger", function (a) { var I2 = window.PPInstrument; if (!I2) return; var l = I2.layers()[Number(a && a.index) || 0]; if (l) { l.on = l.on === false; window.__pedalBridge && window.__pedalBridge.send({ type: "instrument", action: "keys", keys: I2.hostConfig().keys }); PP.persistSoon(); if (window.PPShell && window.PPShell.currentTab() === "instrument") I2.render(); } }, { arg: "layer", led: function (a) { var I2 = window.PPInstrument, l = I2 && I2.layers()[Number(a && a.index) || 0]; return l && l.on !== false ? "on" : "off"; } });
  // ---- touch select: the knob changes whatever setting was last tapped on the screen (touch-select.js)
  function TS() { return window.PPTouchSelect; }
  def("touchSelect", "Touch select: tap a setting on the screen, this knob changes it", "Touch select", "continuous", function (a, v, info) { if (TS() && info && info.id) TS().knob(info.id, v); });
  def("touchSelectStep", "Encoder: touch select (tap a setting, turn to change it)", "Touch select", "step", function (a, d, info) { if (TS() && info && info.id) TS().step(info.id, d); });
  def("touchSelectRelease", "Touch select: let go of the tapped setting", "Touch select", "trigger", function () { if (TS()) TS().release(); });
  // ---- steps (encoder turns)
  def("stepKey", "Encoder: change key", "Key", "step", function (a, d) { if (T() && T().isActive()) T().shiftKey(d); else PP.changeKey(d); });
  def("stepSong", "Encoder: change song", "Setlist", "step", function (a, d) { F.stepSong(d); });
  def("stepSection", "Encoder: change section", "Tracks", "step", function (a, d) { if (T()) { if (d > 0) T().nextSection(); else T().prevSection(); } });
  def("stepPad", "Encoder: select pad", "Pads", "step", function (a, d) { PP.setSelectedPad((PP.selected() + d + PP.PAD_COUNT) % PP.PAD_COUNT, false); });
  def("stepVolume", "Encoder: master volume", "Pads", "step", function (a, d) { PP.setPerformance("volume", project().performance.volume + d * .03); });

  // ---- default mapping: ONE layout for everything (12 buttons, 6 knobs, 2 sliders, expression, encoder).
  // Pads follow the tracks when a song has tracks, so there is no separate pad / tracks layout any more.
  function defaults() {
    var m = {};
    m.b1 = { action: "playAll" }; m.b2 = { action: "stopAll", hold: { action: "panic" } };
    m.b3 = { action: "prevSection" }; m.b4 = { action: "nextSection" };
    m.b5 = { action: "repeatSection" }; m.b6 = { action: "restartSection", hold: { action: "startOver" } };
    m.b7 = { action: "prevSong" }; m.b8 = { action: "nextSong", hold: { action: "nextSongPlay" } };
    m.b9 = { action: "keyDown" }; m.b10 = { action: "keyUp" };
    m.b11 = { action: "tap", hold: { action: "freeze" } }; m.b12 = { action: "playSelected", hold: { action: "layer" } };
    m.k1 = { action: "volume" }; m.k2 = { action: "tracksLevel" }; m.k3 = { action: "clickLevel" };
    m.k4 = { action: "reverb" }; m.k5 = { action: "tone" }; m.k6 = { action: "instrumentLevel" };
    m.s1 = { action: "expression" }; m.s2 = { action: "balance" }; m.exp = { action: "expression" };
    m.enc = { action: "stepSection", press: { action: "playPauseAll" }, hold: { action: "performEdit" } };
    return m;
  }
  function mapping() {
    var p = project(); p.mapping = p.mapping || {};
    if (!p.mapping.all) {
      p.mapping.all = defaults();
      // keep what was set up for added USB / MIDI controls in the old pad / tracks layouts
      ["tracks", "pad"].forEach(function (old) { var m = p.mapping[old]; if (!m) return; Object.keys(m).forEach(function (id) { if (/^[um]/.test(id) && !p.mapping.all[id]) p.mapping.all[id] = m[id]; }); });
    }
    return p.mapping.all;
  }
  function mode() { return "all"; }
  function entryFor(id) { return mapping()[id] || null; }

  // ---- running
  var held = {};
  function run(name, args, info) {
    var a = ACTIONS[name]; if (!a) return false;
    try { a.run(args || {}, info && info.value != null ? info.value : (info && info.delta) || 0, info || {}); } catch (error) { console.warn("action failed", name, error); }
    sendLedsSoon();
    return true;
  }
  function onControl(m) {
    var e = entryFor(m.id); if (!e) return;
    if (m.event === "press") { held[m.id] = { fired: false }; if (ACTIONS[e.action] && ACTIONS[e.action].kind === "trigger") run(e.action, e.args); else if (e.press) run(e.press.action, e.press.args); }
    else if (m.event === "hold") { if (e.hold) { held[m.id] = { fired: true }; run(e.hold.action, e.hold.args); } }
    else if (m.event === "release") { var a = ACTIONS[e.action]; if (a && a.release) { try { a.release(e.args || {}); } catch (_) { } } delete held[m.id]; sendLedsSoon(); }
    else if (typeof m.value === "number") { var c = ACTIONS[e.action]; if (c && c.kind === "continuous") run(e.action, e.args, { value: clamp(m.value, 0, 1), id: m.id }); }
    else if (typeof m.delta === "number") { var s = ACTIONS[e.action]; if (s && s.kind === "step") run(e.action, e.args, { delta: m.delta < 0 ? -1 : 1, id: m.id }); }
    flash(m.id);
  }
  var flashTimers = {};
  function flash(id) { var el = document.querySelector('[data-input-id="' + id + '"]'); if (!el) return; el.classList.add("live"); clearTimeout(flashTimers[id]); flashTimers[id] = setTimeout(function () { el.classList.remove("live"); }, 350); }

  // ---- MIDI-learned inputs: {midi:{type:"note"|"cc"|"pc", number, channel}}
  function midiInput(d) {
    if (window.PPConfigure && window.PPConfigure.midiLearn(d)) return true;
    var inputs = (window.PPConfigure && window.PPConfigure.inputs()) || [];
    var st = d[0], type = st & 0xF0, ch = (st & 0x0F) + 1, handled = false;
    inputs.forEach(function (spec) {
      var mi = spec.midi; if (!mi || (mi.channel && mi.channel !== ch)) return;
      if (mi.type === "note" && (type === 0x90 || type === 0x80) && d[1] === mi.number) { var on = type === 0x90 && d[2] > 0; onControl({ id: spec.id, event: on ? "press" : "release" }); handled = true; }
      else if (mi.type === "cc" && type === 0xB0 && d[1] === mi.number) { if (spec.kind === "button") { onControl({ id: spec.id, event: d[2] >= 64 ? "press" : "release" }); } else onControl({ id: spec.id, value: d[2] / 127 }); handled = true; }
      else if (mi.type === "pc" && type === 0xC0 && d[1] === mi.number) { onControl({ id: spec.id, event: "press" }); setTimeout(function () { onControl({ id: spec.id, event: "release" }); }, 80); handled = true; }
    });
    return handled;
  }

  // ---- LEDs
  var ledTimer = 0, lastLeds = "";
  function ledStates() {
    var m = mapping(), states = {};
    Object.keys(m).forEach(function (id) { var e = m[id], a = ACTIONS[e.action]; states[id] = a && a.led ? a.led(e.args || {}) : "off"; });
    return states;
  }
  function sendLeds() {
    var b = window.__pedalBridge; if (!b || !b.connected) return;
    var states = ledStates(), s = JSON.stringify(states) + project().tempo.bpm;
    if (s === lastLeds) return; lastLeds = s;
    b.send({ type: "leds", states: states, bpm: project().tempo.bpm });
  }
  function sendLedsSoon() { clearTimeout(ledTimer); ledTimer = setTimeout(sendLeds, 40); }
  setInterval(sendLeds, 1000);
  function modeChanged() { lastLeds = ""; sendLedsSoon(); if (window.PPConfigure) window.PPConfigure.render(); }

  function list(kind) { return Object.keys(ACTIONS).map(function (k) { return ACTIONS[k]; }).filter(function (a) { return !kind || a.kind === kind || a.id === "none"; }); }
  window.PPActions = { ACTIONS: ACTIONS, list: list, run: run, onControl: onControl, midiInput: midiInput, mapping: mapping, defaults: defaults, mode: mode, sendLeds: sendLedsSoon, modeChanged: modeChanged, entryFor: entryFor };
})();
