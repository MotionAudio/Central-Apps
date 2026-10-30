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
    if (T() && T().isPlaying()) T().stop(false); engine.stop(); var L2 = window.PPLooper; if (L2 && L2.anyPlaying && L2.anyPlaying()) L2.stopAll();
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
  // from Central Control the lyrics page only inside the section while tracks play: moving the tracks is the Central Pedal's job
  def("lyricsNext", "Lyrics: next page", "Screens", "trigger", function (a, v, info) { if (T()) T().lyricsStep(1, { stay: info && info.from === "central-usage" }); });
  def("lyricsPrev", "Lyrics: previous page", "Screens", "trigger", function (a, v, info) { if (T()) T().lyricsStep(-1, { stay: info && info.from === "central-usage" }); });
  def("projectorBlank", "Projector: blank on / off", "Screens", "trigger", function () { var p = project(); p.projector = p.projector || {}; p.projector.blank = !p.projector.blank; PP.persistSoon(); if (T()) T().sendDisplay(); }, { led: function () { return project().projector && project().projector.blank ? "on" : "off"; } });
  def("texture1", "Texture 1 on / off", "Textures", "trigger", function () { if (X()) X().toggle(0); }, { led: function () { return X() && X().channels()[0].enabled ? "on" : "off"; } });
  def("texture2", "Texture 2 on / off", "Textures", "trigger", function () { if (X()) X().toggle(1); }, { led: function () { return X() && X().channels()[1].enabled ? "on" : "off"; } });
  def("performEdit", "Switch Perform / Edit screen", "Screens", "trigger", function () { PP.setPerformMode(!PP.isPerforming()); });
  def("tab", "Tabs: show a tab (pick which)", "Tabs", "trigger", function (a) { showTab((a && a.tab) || "pads"); }, { arg: "tab", led: function (a) { return curTab() === ((a && a.tab) || "pads") ? "on" : "off"; } });
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
  // pan: a knob / slider 0..1 = left..right (the middle is the centre); args.pan (-1..1) says it exactly (the small screens' CENTRE)
  def("stemPan", "Stem N pan (left / right)", "Tracks", "continuous", function (a, v) { var s = T() && T().song(); if (!s) return; var st = T().data(s).stems[Number(a && a.index) || 0]; if (!st) return; var p = a && a.pan != null ? Number(a.pan) : v * 2 - 1; p = Math.max(-1, Math.min(1, Math.abs(p) < 0.02 ? 0 : p)); T().setStem(st.id, "pan", Math.round(p * 100) / 100); T().renderStems(); }, { arg: "stem" });
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
  // play any sound: the guitar / bass / acoustic plays the chosen keys sound (notes) or a guitar synth (chords)
  def("playAnyToggle", "Play any sound on / off", "Instrument", "trigger", function () { if (I() && I().togglePlayAny) I().togglePlayAny(); }, { led: function () { return I() && I().playAnyOn && I().playAnyOn() ? "on" : "off"; } });
  def("playAnyMode", "Play any sound: Auto / Notes / Synth (next)", "Instrument", "trigger", function () { if (I() && I().stepPlayAnyMode) I().stepPlayAnyMode(1); });
  def("playAnyDry", "Play any sound: dry guitar blend", "Instrument", "continuous", function (a, v) { if (I() && I().setPlayAny) I().setPlayAny({ dry: v }); });
  // the small touch screen: pick the instrument by name, an EQ / compressor knob (0-1), a track's mute
  def("instrumentKindSet", "Instrument: pick electric / acoustic / bass / keys / off", "Instrument", "trigger", function (a) { var k = String(a && a.kind || ""); if (I() && /^(electric|acoustic|bass|keys|off)$/.test(k)) I().setKind(k); }, { hidden: true });
  def("pedalKnob", "Instrument: a pedal's knob", "Instrument", "continuous", function (a, v) { if (I() && a && a.uid && a.sym) I().setKnob(String(a.uid), String(a.sym), v); }, { hidden: true });
  def("busOutput", "Output routing: a bus to the next / previous output", "Audio", "trigger", function (a) { if (window.PPSettings && a) window.PPSettings.stepBus(String(a.bus || ""), Number(a.delta) || 1); }, { hidden: true });
  def("inputGain", "Instrument: input gain", "Instrument", "continuous", function (a, v) { if (I()) I().setInput("gain", -20 + v * 60); }, { hidden: true });
  def("inputChannel", "Instrument: input channel L / R", "Instrument", "trigger", function (a) { if (I()) I().setInput("channel", a && a.channel === "R" ? "R" : "L"); }, { hidden: true });
  def("hdmiShow", "Screens: what HDMI 1 / 2 shows (next / previous)", "Screens", "trigger", function (a) {
    var n = Number(a && a.n) === 2 ? 2 : 1, opts = n === 1 ? ["app", "touch", "lyrics", "charts", "stage", "slides"] : ["lyrics", "slides", "stage", "charts", "touch", "app", "off"];
    var st = F.systemStatus() || {}, d = st.displays || {}, cur = d["hdmi" + n] === "mini" ? "touch" : d["hdmi" + n] || opts[0], i = Math.max(0, opts.indexOf(cur)), cfg = {};
    cfg["hdmi" + n] = opts[(i + (Number(a && a.delta) < 0 ? -1 : 1) + opts.length) % opts.length];
    if (window.__pedalBridge && window.__pedalBridge.send) { window.__pedalBridge.send({ type: "system", action: "displays", config: cfg }); window.__pedalBridge.send({ type: "system", action: "status" }); }
  }, { hidden: true });
  def("stemMute", "Tracks: stem N mute on / off", "Tracks", "trigger", function (a) { var s = T() && T().song(); if (!s) return; var st = T().data(s).stems[Number(a && a.index) || 0]; if (st) { T().setStem(st.id, "mute", !st.mute); T().render(); } }, { arg: "stem" });
  def("instrumentLevel", "Instrument: output level", "Instrument", "continuous", function (a, v) { if (!I()) return; var s = I().state(); s.levelDb = Math.round((-30 + v * 42) * 2) / 2; PP.persistSoon(); sendInstrumentLevel(); });
  def("stepPedal", "Encoder: next / previous board preset", "Instrument", "step", function (a, d) { if (I()) I().stepBoard(d); });
  def("stepPatch", "Encoder: next / previous keys sound", "Instrument", "step", function (a, d) { if (I()) I().stepPatch(d); });
  // ---- the looper (LOOPER tab): three loops. "Loop N" picks one, or "the selected loop" (the main switch's)
  function L() { return window.PPLooper; }
  function li(a) { var n = Number(a && a.index); return isFinite(n) && n >= 0 && n < 3 ? n : -1; }
  function ledOf(st) { return st === "recording" || st === "dubbing" ? "blink" : st === "playing" ? "on" : st === "armed" ? "beat" : "off"; }
  function loopFlag(a, k) { var c = L() && L().config(), i = li(a) < 0 && c ? c.sel : li(a); return c && c.tracks[i] && c.tracks[i][k] ? "on" : "off"; }
  def("looperPedal", "Looper pedal: tap record / play / overdub · double tap stop all · hold clear", "Looper", "trigger", function (a, v, info) { if (L()) L().pedalPress(info); }, { release: function () { if (L()) L().pedalRelease(); }, led: function () { return L() ? ledOf(L().stateOf(-1)) : "off"; } });
  def("looperRec", "Looper: loop N record / play / overdub", "Looper", "trigger", function (a) { if (L()) L().track(li(a)); }, { arg: "loop", led: function (a) { return L() ? ledOf(L().stateOf(li(a))) : "off"; } });
  def("looperTrackStop", "Looper: loop N stop / play", "Looper", "trigger", function (a) { if (L()) L().trackStopPlay(li(a)); }, { arg: "loop", led: function (a) { return L() && L().stateOf(li(a)) === "stopped" ? "on" : "off"; } });
  def("looperTrackUndo", "Looper: loop N undo", "Looper", "trigger", function (a) { if (L()) L().trackUndo(li(a)); }, { arg: "loop" });
  def("looperTrackRedo", "Looper: loop N redo", "Looper", "trigger", function (a) { if (L()) L().trackRedo(li(a)); }, { arg: "loop" });
  def("looperTrackClear", "Looper: loop N clear", "Looper", "trigger", function (a) { if (L()) L().trackClear(li(a)); }, { arg: "loop" });
  def("looperTrackMute", "Looper: loop N mute on / off", "Looper", "trigger", function (a) { if (L()) L().toggle(li(a), "mute"); }, { arg: "loop", led: function (a) { return loopFlag(a, "mute"); } });
  def("looperTrackReverse", "Looper: loop N reverse on / off", "Looper", "trigger", function (a) { if (L()) L().toggle(li(a), "rev"); }, { arg: "loop", led: function (a) { return loopFlag(a, "rev"); } });
  def("looperTrackHalf", "Looper: loop N half speed on / off", "Looper", "trigger", function (a) { if (L()) L().toggle(li(a), "half"); }, { arg: "loop", led: function (a) { return loopFlag(a, "half"); } });
  def("looperTrackSource", "Looper: loop N records instrument / audio input / both (next)", "Looper", "trigger", function (a) { if (L()) L().stepSource(li(a)); }, { arg: "loop" });
  def("looperTrackLevel", "Looper: loop N level", "Looper", "continuous", function (a, v) { if (L()) L().setLevel(v * 1.2, li(a) < 0 ? L().selected() : li(a)); }, { arg: "loop" });
  def("looperTrackPan", "Looper: loop N pan (left / right)", "Looper", "continuous", function (a, v) { if (L()) L().setPan(a && a.pan != null ? Number(a.pan) : v * 2 - 1, li(a) < 0 ? L().selected() : li(a)); }, { arg: "loop" });
  def("looperSelect", "Looper: the main switch works loop N", "Looper", "trigger", function (a) { if (L()) L().select(li(a) < 0 ? 0 : li(a)); }, { arg: "loop", led: function (a) { return L() && L().selected() === (li(a) < 0 ? 0 : li(a)) ? "on" : "off"; } });
  def("looperSelectNext", "Looper: the main switch works the next loop", "Looper", "trigger", function () { if (L()) L().selectStep(1); });
  def("looperPlayAll", "Looper: play every loop", "Looper", "trigger", function () { if (L()) L().playAll(); }, { led: function () { return L() && L().anyPlaying() ? "on" : "off"; } });
  def("looperStopAll", "Looper: stop every loop", "Looper", "trigger", function () { if (L()) L().stopAll(); });
  def("looperClearAll", "Looper: clear every loop", "Looper", "trigger", function () { if (L()) L().clearAll(); });
  def("looperMode", "Looper: timing Auto / Tempo / Free (next)", "Looper", "trigger", function () { if (L()) L().stepMode(); });
  def("looperBars", "Looper: loop length 1 / 2 / 4 / 8 / 16 bars (next)", "Looper", "trigger", function () { if (L()) L().cycleBars(); });
  def("looperCountIn", "Looper: count-in on / off", "Looper", "trigger", function () { if (L()) L().toggleCountIn(); }, { led: function () { return L() && L().config().countIn ? "on" : "off"; } });
  def("stepLoop", "Encoder: pick the loop the main switch works", "Looper", "step", function (a, d) { if (L()) L().selectStep(d); });
  // (the first looper's actions: loop 1)
  def("looperMain", "Looper: loop 1 record / play / overdub", "Looper", "trigger", function () { if (L()) L().main(0); }, { led: function () { return L() ? ledOf(L().state().state) : "off"; } });
  def("looperStop", "Looper: loop 1 stop / play", "Looper", "trigger", function () { if (L()) L().trackStopPlay(0); }, { led: function () { return L() && L().state().state === "stopped" ? "on" : "off"; } });
  def("looperUndo", "Looper: loop 1 undo the last overdub", "Looper", "trigger", function () { if (L()) L().undo(0); });
  def("looperClear", "Looper: loop 1 clear", "Looper", "trigger", function () { if (L()) L().clear(0); });
  def("looperLevel", "Looper: level of every loop", "Looper", "continuous", function (a, v) { if (L()) L().setLevel(v * 1.2); });
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

  // ---- tabs: next / previous, or straight to one (the top row: LIVE · PAD · TRACKS · INSTRUMENT · … · SETTINGS)
  var TAB_NAMES = { live: "LIVE", pads: "Pad", tracks: "Tracks", instrument: "Instrument", looper: "Looper", configure: "Configure", learn: "Learn", io: "I/O", settings: "Settings" };
  function curTab() { return window.PPShell ? window.PPShell.currentTab() : "pads"; }
  function showTab(t) { if (window.PPShell) window.PPShell.showTab(t); }
  function tabOrder() { var list = Array.prototype.map.call(document.querySelectorAll(".nav-tab[data-tab]"), function (b) { return b.getClientRects().length ? b.dataset.tab : null; }).filter(Boolean); return list.length ? list : Object.keys(TAB_NAMES); }
  function stepTab(d) { var o = tabOrder(), i = o.indexOf(curTab()); showTab(o[((i < 0 ? 0 : i) + (d < 0 ? -1 : 1) + o.length) % o.length]); }
  def("tabNext", "Tabs: next tab", "Tabs", "trigger", function () { stepTab(1); });
  def("tabPrev", "Tabs: previous tab", "Tabs", "trigger", function () { stepTab(-1); });
  ["pads", "tracks", "instrument", "looper", "settings", "live"].forEach(function (t) {
    def("tab" + t.charAt(0).toUpperCase() + t.slice(1), "Tabs: show " + TAB_NAMES[t], "Tabs", "trigger", function () { showTab(t); }, { led: function () { return curTab() === t ? "on" : "off"; } });
  });
  def("stepTab", "Encoder: change tab", "Tabs", "step", function (a, d) { stepTab(d); });
  def("tabKnob", "Knob: pick a tab (turn through them)", "Tabs", "continuous", function (a, v) { var o = tabOrder(), t = o[Math.min(o.length - 1, Math.floor(v * o.length))]; if (t && t !== curTab()) showTab(t); });

  // ---- move around the screen without touching it (screen-nav.js): a ring shows what's highlighted
  function N() { return window.PPNav; }
  def("navUp", "Screen: move up", "Move around the screen", "trigger", function () { if (N()) N().move("up"); });
  def("navDown", "Screen: move down", "Move around the screen", "trigger", function () { if (N()) N().move("down"); });
  def("navLeft", "Screen: move left (on a slider or list: one down)", "Move around the screen", "trigger", function () { if (N()) N().move("left"); });
  def("navRight", "Screen: move right (on a slider or list: one up)", "Move around the screen", "trigger", function () { if (N()) N().move("right"); });
  def("navOk", "Screen: OK (press what's highlighted)", "Move around the screen", "trigger", function () { if (N()) N().ok(); });
  def("navBack", "Screen: back (close what's open)", "Move around the screen", "trigger", function () { if (N()) N().back(); });
  def("navNext", "Screen: next control (in reading order)", "Move around the screen", "trigger", function () { if (N()) N().step(1); });
  def("navPrev", "Screen: previous control", "Move around the screen", "trigger", function () { if (N()) N().step(-1); });
  def("navScrollDown", "Screen: scroll down", "Move around the screen", "trigger", function () { if (N()) N().scrollBy(1); });
  def("navScrollUp", "Screen: scroll up", "Move around the screen", "trigger", function () { if (N()) N().scrollBy(-1); });
  def("navScroll", "Knob: scroll the screen (top ↔ bottom)", "Move around the screen", "continuous", function (a, v) { if (N()) N().scrollTo(v); });
  def("navValue", "Knob: change the highlighted slider / list", "Move around the screen", "continuous", function (a, v) { if (N()) N().setValue(v); });
  def("stepFocus", "Encoder: move the highlight (next / previous)", "Move around the screen", "step", function (a, d) { if (N()) N().step(d); });
  def("stepScroll", "Encoder: scroll the screen", "Move around the screen", "step", function (a, d) { if (N()) N().scrollBy(d * 0.4); });
  def("stepValue", "Encoder: change the highlighted slider / list", "Move around the screen", "step", function (a, d) { var el = N() && N().current(); if (el && (el.matches("input[type=range], input[type=number]") || el.tagName === "SELECT")) N().nudge(el, d); });

  // ---- each bus: a level and a mute. Tracks, pads (+ textures and the audio input), click + MD voice, instrument.
  // (Mutes last until they're turned off or the app restarts - they're never saved, so a pedal never starts silent.)
  var BUS_NAMES = { tracks: "Tracks", pad: "Pads", click: "Click + MD voice", instrument: "Instrument" };
  var mutes = {}, clickHeld = null;
  function busLevel(bus) {
    if (bus === "tracks") return T() ? T().levels.tracks : 0.85;
    if (bus === "click") return clickHeld != null ? clickHeld : T() ? T().levels.click : 0.85;
    if (bus === "pad") return project().performance.volume;
    if (bus === "instrument") { var lv = I() ? Number(I().state().levelDb) || 0 : 0; return (lv + 30) / 42; }
    return 0;
  }
  function sendInstrumentLevel() { var s = I() && I().state(); if (s && window.__pedalBridge && window.__pedalBridge.send) window.__pedalBridge.send({ type: "instrument", action: "level", levelDb: mutes.instrument ? -90 : s.levelDb || 0 }); }
  function applyMute(bus) {
    var on = !!mutes[bus], c = engine.ctx, now = c ? c.currentTime : 0;
    if (bus === "tracks" && c && engine.tracksOut) PP.smoothParam(engine.tracksOut.gain, on ? 0 : 1, now);
    else if (bus === "pad" && c && engine.outGain) PP.smoothParam(engine.outGain.gain, on ? 0 : 1, now);
    else if (bus === "click" && T()) { if (on) { if (clickHeld == null) clickHeld = T().levels.click; T().setLevel("click", 0); } else if (clickHeld != null) { var back = clickHeld; clickHeld = null; T().setLevel("click", back); } }
    else if (bus === "instrument") sendInstrumentLevel();
  }
  function setBusLevel(bus, v) {
    v = clamp(Number(v) || 0, 0, 1);
    if (bus === "tracks") { if (T()) T().setLevel("tracks", v); }
    else if (bus === "click") { if (clickHeld != null) clickHeld = v; else if (T()) T().setLevel("click", v); }
    else if (bus === "pad") PP.setPerformance("volume", v);
    else if (bus === "instrument" && I()) { var s = I().state(); s.levelDb = Math.round((-30 + v * 42) * 2) / 2; PP.persistSoon(); sendInstrumentLevel(); }
  }
  function toggleMute(bus) { if (!BUS_NAMES[bus]) return; mutes[bus] = !mutes[bus]; applyMute(bus); if (PP.setStatus) PP.setStatus(BUS_NAMES[bus] + (mutes[bus] ? " muted" : " back on")); }
  engine.hooks = engine.hooks || []; engine.hooks.push(function () { Object.keys(mutes).forEach(function (b) { if (mutes[b]) setTimeout(function () { applyMute(b); }, 0); }); });   // (a restarted audio engine keeps the mutes)
  def("busLevel", "Bus level (pick the bus)", "Bus levels & mutes", "continuous", function (a, v) { setBusLevel(String(a && a.bus || "tracks"), v); }, { arg: "bus" });
  def("busMute", "Bus mute on / off (pick the bus)", "Bus levels & mutes", "trigger", function (a) { toggleMute(String(a && a.bus || "tracks")); }, { arg: "bus", led: function (a) { return mutes[String(a && a.bus || "tracks")] ? "on" : "off"; } });
  Object.keys(BUS_NAMES).forEach(function (b) {
    var id = b === "pad" ? "Pads" : b.charAt(0).toUpperCase() + b.slice(1);
    def("level" + id, BUS_NAMES[b] + ": level", "Bus levels & mutes", "continuous", function (a, v) { setBusLevel(b, v); });
    def("mute" + id, BUS_NAMES[b] + ": mute on / off", "Bus levels & mutes", "trigger", function () { toggleMute(b); }, { led: function () { return mutes[b] ? "on" : "off"; } });
  });

  // ---- each pad's own volume (the pad's Level - the same as its slider on the Pad screen and the 3.5" screen)
  def("padVolume", "Pad N volume", "Pads", "continuous", function (a, v) { if (PP.setPadLevel) PP.setPadLevel(Number(a && a.index) || 0, v * 100); }, { arg: "pad" });

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
    if (window.PPPedalJob && window.PPPedalJob.intercept(a, args, info)) { sendLedsSoon(); return true; }   // a foot controller / instrument rig (pedal-job.js)
    try { a.run(args || {}, info && info.value != null ? info.value : (info && info.delta) || 0, info || {}); } catch (error) { console.warn("action failed", name, error); }
    sendLedsSoon();
    if (window.PPTracks && window.PPTracks.sendDisplay) window.PPTracks.sendDisplay();   // (the small screen and the copies show the change)
    return true;
  }
  // (through the exported run, so what wraps it - the service lock, Safe Stop - sees footswitches, MIDI and Stream Deck too)
  function runX(name, args, info) { return window.PPActions && window.PPActions.run !== run ? window.PPActions.run(name, args, info) : run(name, args, info); }
  function onControl(m) {
    var e = entryFor(m.id); if (!e) return;
    if (m.event === "press") { held[m.id] = { fired: false }; if (ACTIONS[e.action] && ACTIONS[e.action].kind === "trigger") runX(e.action, e.args); else if (e.press) runX(e.press.action, e.press.args); }
    else if (m.event === "hold") { if (e.hold) { held[m.id] = { fired: true }; runX(e.hold.action, e.hold.args); } }
    else if (m.event === "release") { var a = ACTIONS[e.action]; if (a && a.release) { try { a.release(e.args || {}); } catch (_) { } } delete held[m.id]; sendLedsSoon(); }
    else if (typeof m.value === "number") { var c = ACTIONS[e.action]; if (c && c.kind === "continuous") runX(e.action, e.args, { value: clamp(m.value, 0, 1), id: m.id }); }
    else if (typeof m.delta === "number") { var s = ACTIONS[e.action]; if (s && s.kind === "step") runX(e.action, e.args, { delta: m.delta < 0 ? -1 : 1, id: m.id }); }
    flash(m.id);
  }
  var flashTimers = {};
  function flash(id) { var el = document.querySelector('[data-input-id="' + id + '"]'); if (!el) return; el.classList.add("live"); clearTimeout(flashTimers[id]); flashTimers[id] = setTimeout(function () { el.classList.remove("live"); }, 350); }

  // ---- controls the app learned itself (control-surface.js): MIDI ({midi: {msg, number, channel, port, lo, hi}}, older
  // ones {type, number, channel}) and computer keys ({key: {code, ctrl, shift, alt, meta}})
  function learnedInputs() { return ((window.PPConfigure && window.PPConfigure.inputs()) || []).filter(function (i) { return i.midi || i.key; }); }
  function hit(spec, r) {
    if (!r) return false;
    if (r.event === "tap") { onControl({ id: spec.id, event: "press" }); setTimeout(function () { onControl({ id: spec.id, event: "release" }); }, 80); }
    else if (r.event) onControl({ id: spec.id, event: r.event });
    else if (typeof r.value === "number") onControl({ id: spec.id, value: spec.invert ? 1 - r.value : r.value });
    return true;
  }
  var holdTimers = {};
  function pressWithHold(spec, ev) {   // a learned button: press / hold / release like the footswitches
    if (ev === "press") { clearTimeout(holdTimers[spec.id]); holdTimers[spec.id] = setTimeout(function () { delete holdTimers[spec.id]; onControl({ id: spec.id, event: "hold" }); }, 600); }
    else if (ev === "release") { clearTimeout(holdTimers[spec.id]); delete holdTimers[spec.id]; }
  }
  function midiInput(d, port) {
    var S = window.CCSurface;
    if (window.PPConfigure && window.PPConfigure.midiLearn(d, port)) return true;
    if (!S) return false;
    var e = S.parse(d, port), handled = false; if (!e) return false;
    learnedInputs().forEach(function (spec) {
      if (!spec.midi) return;
      var r = S.match(spec, e); if (!r) return;
      if (spec.kind === "button" && r.event && r.event !== "tap") pressWithHold(spec, r.event);
      handled = hit(spec, r) || handled;
    });
    return handled;
  }
  var keysDown = {};
  function keyInput(e, down) {
    var S = window.CCSurface; if (!S || e.repeat || S.learning() || S.typing(e)) return false;
    var handled = false;
    learnedInputs().forEach(function (spec) {
      if (!spec.key) return;
      var r = S.matchKey(spec, e, down); if (!r) return;
      if (!down && !keysDown[spec.id]) return;
      if (down) keysDown[spec.id] = true; else delete keysDown[spec.id];
      pressWithHold(spec, r.event); hit(spec, r); handled = true;
    });
    if (handled) { e.preventDefault(); e.stopPropagation(); }
    return handled;
  }
  if (typeof document !== "undefined") {
    document.addEventListener("keydown", function (e) { keyInput(e, true); }, true);
    document.addEventListener("keyup", function (e) { keyInput(e, false); }, true);
  }

  // ---- LEDs
  var ledTimer = 0, lastLeds = "";
  function ledStates() {
    var m = mapping(), states = {};
    Object.keys(m).forEach(function (id) { var e = m[id], a = ACTIONS[e.action]; states[id] = a && a.led ? a.led(e.args || {}) : "off"; });
    return states;
  }
  function midiLeds(states) {   // a learned MIDI button's light follows what it does (on / blinking = on)
    var S = window.CCSurface; if (!S) return;
    learnedInputs().forEach(function (spec) { if (spec.midi && spec.kind === "button" && spec.ledOff !== true) S.feedback(spec, states[spec.id] === "on" || states[spec.id] === "blink", spec.id); });
  }
  function sendLeds() {
    var states0 = null;
    try { states0 = ledStates(); midiLeds(states0); } catch (_) { }
    var b = window.__pedalBridge; if (!b || !b.connected) return;
    var states = states0 || ledStates(), s = JSON.stringify(states) + project().tempo.bpm;
    if (s === lastLeds) return; lastLeds = s;
    b.send({ type: "leds", states: states, bpm: project().tempo.bpm });
  }
  function sendLedsSoon() { clearTimeout(ledTimer); ledTimer = setTimeout(sendLeds, 40); }
  setInterval(sendLeds, 1000);
  function modeChanged() { lastLeds = ""; sendLedsSoon(); if (window.PPConfigure) window.PPConfigure.render(); }

  function list(kind) { return Object.keys(ACTIONS).map(function (k) { return ACTIONS[k]; }).filter(function (a) { return !a.hidden && (!kind || a.kind === kind || a.id === "none"); }); }   // (hidden: the small screen's own)
  window.PPActions = { ACTIONS: ACTIONS, list: list, muted: function (b) { return !!mutes[b]; }, busLevel: busLevel, setBusLevel: setBusLevel, toggleMute: toggleMute, TAB_NAMES: TAB_NAMES, run: run, onControl: onControl, midiInput: midiInput, keyInput: keyInput, mapping: mapping, defaults: defaults, mode: mode, sendLeds: sendLedsSoon, modeChanged: modeChanged, entryFor: entryFor };
})();
