/* Central Control / Central Usage - the Controls tab: MIDI footswitches, pedals, knobs and sliders, keys on this
 * computer's keyboard and a Stream Deck can do anything in the app.
 *   Your controls   "Add new control": what kind it is (button, knob, slider), its name, then press / turn / slide it
 *                   (the Learn window is shared with the Central Pedal: shared/control-surface.js)
 *   What they do    every control gets a job from the list below (buttons: on press, and on hold)
 * Saved on this computer (they belong to the hardware plugged into it), and in Settings → Back up these controls. */
(function () {
  "use strict";
  var CU = window.CentralUsage, S = window.CCSurface; if (!CU || !S) return;
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // ------------------------------------------------------------- storage (this computer)
  var KEY = "controls", data = CU.store.get(KEY, null);
  if (!data || typeof data !== "object") data = {};
  if (!Array.isArray(data.inputs)) data.inputs = [];
  if (!data.mapping || typeof data.mapping !== "object") data.mapping = {};
  var saveTimer = 0;
  function persist() { clearTimeout(saveTimer); saveTimer = setTimeout(function () { CU.store.set(KEY, data); }, 250); }
  function persistNow() { clearTimeout(saveTimer); CU.store.set(KEY, data); }

  // ------------------------------------------------------------- what a control can do
  var ACTIONS = {}, TAB_LABEL = { devices: "Devices", service: "Service", chart: "Chord chart", instrument: "Instrument", lights: "Lighting", mix: "Online mix", inears: "In-ears", lyrics: "Lyrics", slides: "Slides", video: "Video", io: "I/O", controls: "Controls", settings: "Settings" };
  function def(id, label, group, kind, run, extra) { ACTIONS[id] = Object.assign({ id: id, label: label, group: group, kind: kind, run: run }, extra || {}); }
  function admin() { return CU.mode() === "admin"; }
  function tabs() { var r = CU.role(); return r && CU.tabsFor ? CU.tabsFor(r) : Object.keys(TAB_LABEL); }
  function stepTab(d) { var t = tabs(), i = t.indexOf(CU.prefs.tab); CU.showTab(t[((i < 0 ? 0 : i) + d + t.length) % t.length]); }
  function L() { return window.CULights; }
  function lightsCmd(c) { if (L() && L().remoteCommand) L().remoteCommand(c); }
  function lightsState() { try { return L() && L().remoteState ? L().remoteState() : null; } catch (_) { return null; } }
  function mix() { return window.CUMix && window.CUMix.state; }
  function mixOp(o) { if (window.CUMix) window.CUMix.op(o); }
  function toDb(v) { return v <= 0.002 ? -90 : Math.round((v * 70 - 60) * 10) / 10; }   // 0..1 -> -60..+10 dB (0 dB at 6/7 of the way)
  function slides() { return window.CUSlides; }
  function stepSlide(d) {
    var X = slides(); if (!X) return; var st = X.state(), items = (st && st.items) || []; if (!items.length) return;
    var live = X.live() || {}, i = items.map(function (x) { return x.id; }).indexOf(live.id);
    var n = i < 0 ? (d > 0 ? 0 : items.length - 1) : clamp(i + d, 0, items.length - 1);
    X.goLive(items[n].id);
  }
  function inst() { var f = document.getElementById("instFrame"); try { return f && f.contentWindow && f.contentWindow.PPInstrument; } catch (_) { return null; } }
  function chartSize(d) { var el = document.getElementById(CU.prefs.tab === "lyrics" ? "lyricsSize" : "fontSize"); if (!el) return; el.value = Number(el.value) + d * 2; el.dispatchEvent(new Event("input", { bubbles: true })); }
  function scrollView(d) { var v = document.querySelector(".view.active"); if (!v) return; var el = v.querySelector(".pad-view, .chart, #chart, #lyrics") || v; (el.scrollHeight > el.clientHeight ? el : v).scrollBy({ top: d * Math.round(window.innerHeight * 0.5), behavior: "smooth" }); }

  def("none", "— nothing —", "General", "trigger", function () { });
  // tabs
  def("tab", "Tabs: show a tab (pick which)", "Tabs", "trigger", function (a) { CU.showTab((a && a.tab) || tabs()[0]); }, { arg: "tab", led: function (a) { return CU.prefs.tab === ((a && a.tab) || "") ? "on" : "off"; } });
  def("tabNext", "Tabs: next tab", "Tabs", "trigger", function () { stepTab(1); });
  def("tabPrev", "Tabs: previous tab", "Tabs", "trigger", function () { stepTab(-1); });
  def("scrollDown", "Screen: scroll down", "Screen", "trigger", function () { scrollView(1); });
  def("scrollUp", "Screen: scroll up", "Screen", "trigger", function () { scrollView(-1); });
  def("scroll", "Screen: scroll (knob)", "Screen", "continuous", function (a, v) { var vw = document.querySelector(".view.active"); if (!vw) return; var el = vw.querySelector(".pad-view") || vw; el.scrollTop = Math.round(v * Math.max(0, el.scrollHeight - el.clientHeight)); });
  def("textBigger", "Chart / lyrics: bigger text", "Screen", "trigger", function () { chartSize(1); });
  def("textSmaller", "Chart / lyrics: smaller text", "Screen", "trigger", function () { chartSize(-1); });
  // lyrics (they move on the Central Pedal)
  def("lyricsNext", "Lyrics: next page", "Lyrics", "trigger", function () { CU.action("lyricsNext"); });
  def("lyricsPrev", "Lyrics: previous page", "Lyrics", "trigger", function () { CU.action("lyricsPrev"); });
  // slides (admins)
  def("slideNext", "Slides: next slide", "Slides", "trigger", function () { stepSlide(1); }, { admin: true });
  def("slidePrev", "Slides: previous slide", "Slides", "trigger", function () { stepSlide(-1); }, { admin: true });
  def("slideBlack", "Slides: black screen", "Slides", "trigger", function () { if (slides()) slides().black(); }, { admin: true, led: function () { var l = slides() && slides().live(); return l && l.slide && l.slide.kind === "black" ? "on" : "off"; } });
  def("slideLyrics", "Slides: show the lyrics", "Slides", "trigger", function () { if (slides() && slides().setLyricsLive) slides().setLyricsLive(true); }, { admin: true });
  // lights (admins)
  def("lightsBlackout", "Lights: blackout on / off", "Lights", "trigger", function () { lightsCmd({ cmd: "blackout" }); }, { admin: true, led: function () { var s = lightsState(); return s && s.blackout ? "on" : "off"; } });
  def("lightsFlash", "Lights: flash", "Lights", "trigger", function () { lightsCmd({ cmd: "flash" }); }, { admin: true });
  def("lightsStrobe", "Lights: strobe while held", "Lights", "trigger", function () { lightsCmd({ cmd: "strobe", on: true }); }, { admin: true, release: function () { lightsCmd({ cmd: "strobe", on: false }); } });
  def("lightsFollow", "Lights: back to following the song", "Lights", "trigger", function () { lightsCmd({ cmd: "follow" }); }, { admin: true, led: function () { var s = lightsState(); return s && !s.manual ? "on" : "off"; } });
  def("lightsLook", "Lights: look N (from the Show tab)", "Lights", "trigger", function (a) { var s = lightsState(), l = s && s.looks[Number(a && a.index) || 0]; if (l) lightsCmd({ cmd: "look", id: l.id }); }, { admin: true, arg: "number", led: function (a) { var s = lightsState(), l = s && s.looks[Number(a && a.index) || 0]; return l && l.live ? "on" : "off"; } });
  def("lightsMaster", "Lights: master level", "Lights", "continuous", function (a, v) { lightsCmd({ cmd: "fader", id: "master", value: v }); }, { admin: true });
  // mix (admins, when this computer has the mixer)
  def("mixMainLevel", "Online mix: tracks mix level", "Online mix", "continuous", function (a, v) { mixOp({ op: "main", patch: { level: toDb(v) } }); }, { admin: true });
  def("mixMainMute", "Online mix: mute the tracks mix", "Online mix", "trigger", function () { var s = mix(); mixOp({ op: "main", patch: { mute: !(s && s.main && s.main.mute) } }); }, { admin: true, led: function () { var s = mix(); return s && s.main && s.main.mute ? "on" : "off"; } });
  def("mixChannelLevel", "Online mix: channel N level", "Online mix", "continuous", function (a, v) { mixOp({ op: "input", i: Number(a && a.index) || 0, patch: { fader: toDb(v) } }); }, { admin: true, arg: "number" });
  def("mixChannelMute", "Online mix: mute channel N", "Online mix", "trigger", function (a) { var i = Number(a && a.index) || 0, s = mix(), inp = s && s.inputs && s.inputs[i]; mixOp({ op: "input", i: i, patch: { mute: !(inp && inp.mute) } }); }, { admin: true, arg: "number", led: function (a) { var s = mix(), inp = s && s.inputs && s.inputs[Number(a && a.index) || 0]; return inp && inp.mute ? "on" : "off"; } });
  // talkback
  def("talkHold", "Talkback: talk while held", "Talkback", "trigger", function () { if (window.CUTalk) window.CUTalk.on(); }, { release: function () { if (window.CUTalk) window.CUTalk.off(); }, led: function () { var t = window.CUTalk && window.CUTalk.state(); return t && t.on ? "on" : "off"; } });
  def("talkToggle", "Talkback: on / off", "Talkback", "trigger", function () { var T = window.CUTalk; if (!T) return; if (T.state().on) T.off(); else T.on(); }, { led: function () { var t = window.CUTalk && window.CUTalk.state(); return t && t.on ? "on" : "off"; } });
  // video (admins)
  def("videoCut", "Video: cut to the preview", "Video", "trigger", function () { if (window.CUVideoTab) window.CUVideoTab.cut(); }, { admin: true });
  def("videoAuto", "Video: fade to the preview", "Video", "trigger", function () { if (window.CUVideoTab) window.CUVideoTab.auto(); }, { admin: true });
  def("recordToggle", "Recording: start / stop", "Video", "trigger", function () { var R = window.CURecUI; if (!R) return; var st = R.state(); if (st && st.recording) R.stop(); else R.start(); }, { admin: true, led: function () { var st = window.CURecUI && window.CURecUI.state(); return st && st.recording ? "on" : "off"; } });
  // the instrument (Central Usage)
  def("instBoardNext", "Instrument: next board", "Instrument", "trigger", function () { var I = inst(); if (I && I.stepBoard) I.stepBoard(1); });
  def("instBoardPrev", "Instrument: previous board", "Instrument", "trigger", function () { var I = inst(); if (I && I.stepBoard) I.stepBoard(-1); });
  def("instPatchNext", "Instrument: next keys sound", "Instrument", "trigger", function () { var I = inst(); if (I && I.stepPatch) I.stepPatch(1); });
  def("instPatchPrev", "Instrument: previous keys sound", "Instrument", "trigger", function () { var I = inst(); if (I && I.stepPatch) I.stepPatch(-1); });
  def("instPedal", "Instrument: pedal N on / off", "Instrument", "trigger", function (a) { var I = inst(); if (I && I.togglePedal) I.togglePedal(Number(a && a.index) || 0); }, { arg: "number", led: function (a) { var I = inst(); try { return I && I.pedalOn && I.pedalOn(Number(a && a.index) || 0) ? "on" : "off"; } catch (_) { return "off"; } } });
  def("instTuner", "Instrument: tuner on / off", "Instrument", "trigger", function () { var I = inst(); if (I && I.toggleTuner) I.toggleTuner(); }, { led: function () { var I = inst(); try { return I && I.tunerOn && I.tunerOn() ? "on" : "off"; } catch (_) { return "off"; } } });
  def("instPlayAny", "Instrument: play any sound on / off", "Instrument", "trigger", function () { var I = inst(); if (I && I.togglePlayAny) I.togglePlayAny(); });
  def("instExpression", "Instrument: expression (wah / volume pedal)", "Instrument", "continuous", function (a, v) { var I = inst(); if (I && I.expression) I.expression(v); });
  def("instKnob", "Instrument: the selected pedal's knob N", "Instrument", "continuous", function (a, v) { var I = inst(); if (I && I.setKnob) I.setKnob(Number(a && a.index) || 0, v); }, { arg: "number" });

  function list(kind) {
    var adm = admin();
    return Object.keys(ACTIONS).map(function (k) { return ACTIONS[k]; }).filter(function (a) { return (!kind || a.kind === kind || a.id === "none") && (adm || !a.admin); });
  }

  // ------------------------------------------------------------- running
  function inputs() { return data.inputs; }
  function byId(id) { return inputs().filter(function (i) { return i.id === id; })[0] || null; }
  function mapping() { return data.mapping; }
  function entryFor(id) { return mapping()[id] || null; }
  function run(name, args, info) {
    var a = ACTIONS[name]; if (!a) return false;
    try { a.run(args || {}, info && info.value != null ? info.value : 0, info || {}); } catch (error) { console.warn("control failed", name, error); }
    ledsSoon(); return true;
  }
  function onControl(m) {
    var e = entryFor(m.id); if (!e) return;
    if (m.event === "press") { var a = ACTIONS[e.action]; if (a && a.kind === "trigger") run(e.action, e.args); }
    else if (m.event === "hold") { if (e.hold) run(e.hold.action, e.hold.args); }
    else if (m.event === "release") { var r = ACTIONS[e.action]; if (r && r.release) { try { r.release(e.args || {}); } catch (_) { } } ledsSoon(); }
    else if (typeof m.value === "number") { var c = ACTIONS[e.action]; if (c && c.kind === "continuous") run(e.action, e.args, { value: clamp(m.value, 0, 1) }); }
    flash(m.id);
  }
  var flashT = {};
  function flash(id) { var el = document.querySelector('[data-ctl-row="' + id + '"]'); if (!el) return; el.classList.add("live"); clearTimeout(flashT[id]); flashT[id] = setTimeout(function () { el.classList.remove("live"); }, 300); }
  var holdT = {}, keysDown = {};
  function press(spec, ev) {
    if (ev === "press") { clearTimeout(holdT[spec.id]); holdT[spec.id] = setTimeout(function () { delete holdT[spec.id]; onControl({ id: spec.id, event: "hold" }); }, 600); }
    else if (ev === "release") { clearTimeout(holdT[spec.id]); delete holdT[spec.id]; }
  }
  function hit(spec, r) {
    if (r.event === "tap") { onControl({ id: spec.id, event: "press" }); setTimeout(function () { onControl({ id: spec.id, event: "release" }); }, 80); return; }
    if (r.event) { if (spec.kind === "button") press(spec, r.event); onControl({ id: spec.id, event: r.event }); return; }
    if (typeof r.value === "number") onControl({ id: spec.id, value: spec.invert ? 1 - r.value : r.value });
  }
  function midiIn(d, port) {
    if (S.feedMidi(d, port)) return;
    var e = S.parse(d, port); if (!e) return;
    inputs().forEach(function (spec) { if (!spec.midi) return; var r = S.match(spec, e); if (r) hit(spec, r); });
    if (window.CUStudio && window.CUStudio.midiIn) { try { window.CUStudio.midiIn(d, port); } catch (_) { } }
  }
  S.midi.subscribe(midiIn);
  S.midi.start().then(function () { render(); });
  S.midi.onPorts(function () { if (visible()) render(); });
  function keyEvent(e, down) {
    if (e.repeat || S.learning() || S.typing(e)) return;
    var any = false;
    inputs().forEach(function (spec) {
      if (!spec.key) return; var r = S.matchKey(spec, e, down); if (!r) return;
      if (!down && !keysDown[spec.id]) return;
      if (down) keysDown[spec.id] = 1; else delete keysDown[spec.id];
      hit(spec, r); any = true;
    });
    if (any) { e.preventDefault(); e.stopPropagation(); }
  }
  document.addEventListener("keydown", function (e) { keyEvent(e, true); }, true);
  document.addEventListener("keyup", function (e) { keyEvent(e, false); }, true);

  // ------------------------------------------------------------- lights on the controllers (and the Stream Deck's keys)
  function ledStates() { var m = mapping(), out = {}; Object.keys(m).forEach(function (id) { var e = m[id], a = ACTIONS[e.action]; try { out[id] = a && a.led ? a.led(e.args || {}) : "off"; } catch (_) { out[id] = "off"; } }); return out; }
  var ledTimer = 0;
  function leds() { var st = ledStates(); inputs().forEach(function (spec) { if (spec.midi && spec.kind === "button" && spec.ledOff !== true) S.feedback(spec, st[spec.id] === "on" || st[spec.id] === "blink", spec.id); }); }
  function ledsSoon() { clearTimeout(ledTimer); ledTimer = setTimeout(leds, 40); }
  setInterval(leds, 1000);

  // ------------------------------------------------------------- the Controls tab
  function visible() { return CU.prefs.tab === "controls"; }
  var KIND_NAME = { button: "Button", knob: "Knob", slider: "Slider" };
  function countOf(kind) { return inputs().filter(function (i) { return i.kind === kind && !i.streamdeck; }).length + 1; }
  function defaultName(kind) { return kind === "knob" ? "Knob " + countOf("knob") : kind === "slider" ? "Slider " + countOf("slider") : "Footswitch " + countOf("button"); }
  function argControl(id, e, which) {
    var a = ACTIONS[e.action]; if (!a || !a.arg) return "";
    var args = e.args || {}, f = (which || "") + "arg";
    if (a.arg === "tab") return '<select data-ctl="' + f + '-tab" data-id="' + id + '">' + tabs().map(function (t) { return '<option value="' + t + '"' + (args.tab === t ? " selected" : "") + ">" + esc(TAB_LABEL[t] || t) + "</option>"; }).join("") + "</select>";
    return '<input type="number" min="1" max="128" data-ctl="' + f + '-index" data-id="' + id + '" value="' + ((Number(args.index) || 0) + 1) + '" title="which one (number)">';
  }
  function actionSelect(id, field, kind, cur) {
    var groups = {}; list(kind).forEach(function (a) { (groups[a.group] = groups[a.group] || []).push(a); });
    return '<select data-ctl="' + field + '" data-id="' + id + '">' + Object.keys(groups).map(function (g) { return '<optgroup label="' + esc(g) + '">' + groups[g].map(function (a) { return '<option value="' + a.id + '"' + (a.id === cur ? " selected" : "") + ">" + esc(a.label) + "</option>"; }).join("") + "</optgroup>"; }).join("") + "</select>";
  }
  function render() {
    var root = $("#controlsRoot"); if (!root || !visible()) return;
    var mine = inputs().filter(function (i) { return !i.streamdeck; }), ports = S.midi.inputs();
    var rows = mine.map(function (i) {
      var e = mapping()[i.id] || (mapping()[i.id] = { action: "none" }), kind = i.kind === "button" ? "trigger" : "continuous";
      return '<div class="ctl-row" data-ctl-row="' + i.id + '"><div class="ctl-id"><i class="ctl-dot"></i><input data-ctl="name" data-id="' + i.id + '" value="' + esc(i.name) + '" aria-label="Name"><small>' + esc(KIND_NAME[i.kind] || "") + " · " + esc(S.describe(i)) + "</small></div>" +
        '<div class="ctl-act"><label>' + (i.kind === "button" ? "Press" : "Moves") + actionSelect(i.id, "action", kind, e.action) + "</label>" + argControl(i.id, e, "") +
        (i.kind === "button" ? '<label>Hold' + actionSelect(i.id, "hold", "trigger", e.hold ? e.hold.action : "none") + "</label>" + (e.hold ? argControl(i.id, e.hold, "hold") : "") : '<label class="toggle"><input type="checkbox" data-ctl="invert" data-id="' + i.id + '"' + (i.invert ? " checked" : "") + "> Backwards</label>") + "</div>" +
        '<div class="ctl-btns"><button data-ctl="relearn" data-id="' + i.id + '">Learn again</button><button data-ctl="del" data-id="' + i.id + '" title="Remove">✕</button></div></div>';
    }).join("");
    root.innerHTML = '<div class="ctl-wrap"><section class="card"><h3>Your controls</h3>' +
      '<p class="muted">Use footswitches, expression pedals, knobs and sliders on a MIDI controller, or keys on this computer\'s keyboard. Add one, say what kind it is and give it a name, then press, turn or slide it when asked. After that, pick what it does.</p>' +
      '<p class="small muted">' + (S.midi.available() ? (ports.length ? "MIDI devices here: " + ports.map(function (p) { return esc(S.shortPort(p.name).replace(/(^|\s)\S/g, function (c) { return c.toUpperCase(); })); }).join(", ") : "No MIDI devices plugged in yet. Keys on the keyboard still work.") : "MIDI isn't available here. Keys on the keyboard still work.") + "</p>" +
      '<div class="row"><button class="primary" data-ctl="add">+ Add new control</button></div>' +
      (rows ? '<div class="ctl-list">' + rows + "</div>" : '<p class="muted">Nothing learned yet.</p>') + "</section>" +
      (window.PPStreamDeck ? window.PPStreamDeck.settingsHtml() : "") +
      '<section class="card"><h3>Back up these controls</h3><p class="muted">They\'re saved on this computer. Save a copy to move them to another computer, or to keep them safe.</p><div class="row"><button data-ctl="export">Save a copy…</button><button data-ctl="import">Bring a copy back…</button></div></section></div>';
  }
  async function addControl() {
    var r = await S.learn({ keys: true, defaultName: defaultName, title: "Add a control" });
    if (!r) return;
    var id = (r.spec.key ? "k" : "m") + Date.now().toString(36);
    var spec = Object.assign({ id: id, name: r.name || defaultName(r.kind), kind: r.kind }, r.spec.key ? { key: r.spec.key } : { midi: r.spec.midi });
    inputs().push(spec); mapping()[id] = { action: "none" }; persist(); render();
  }
  async function relearn(id) {
    var spec = byId(id); if (!spec) return;
    var r = await S.learn({ kind: spec.kind, name: spec.name, keys: true });
    if (!r) return;
    delete spec.midi; delete spec.key; if (r.spec.key) spec.key = r.spec.key; else spec.midi = r.spec.midi; spec.name = r.name || spec.name;
    S.resetLeds(); persist(); render();
  }
  function setArg(entry, k, v) { entry.args = entry.args || {}; entry.args[k] = k === "index" ? Math.max(0, (Number(v) || 1) - 1) : v; }
  function onChange(e) {
    var t = e.target, f = t.dataset.ctl, id = t.dataset.id; if (!f || !id) return;
    var spec = byId(id), m = mapping(), entry = m[id] || (m[id] = { action: "none" });
    if (f === "name") { if (spec) spec.name = t.value.trim() || spec.name; }
    else if (f === "invert") { if (spec) spec.invert = t.checked; }
    else if (f === "action") { m[id] = { action: t.value }; if (entry.hold) m[id].hold = entry.hold; if (ACTIONS[t.value] && ACTIONS[t.value].arg === "tab") m[id].args = { tab: tabs()[0] }; }
    else if (f === "hold") { if (t.value === "none") delete entry.hold; else entry.hold = { action: t.value }; }
    else if (f.indexOf("arg-") === 0) setArg(entry, f.slice(4), t.value);
    else if (f.indexOf("holdarg-") === 0 && entry.hold) setArg(entry.hold, f.slice(8), t.value);
    persist(); ledsSoon(); if (f !== "name") render();
  }
  async function onClick(e) {
    var b = e.target.closest && e.target.closest("button[data-ctl]"); if (!b) return;
    var a = b.dataset.ctl, id = b.dataset.id;
    if (a === "add") addControl();
    else if (a === "relearn") relearn(id);
    else if (a === "del") { var sp = byId(id); if (sp && !confirm("Remove \"" + sp.name + "\"?")) return; data.inputs = inputs().filter(function (i) { return i.id !== id; }); delete mapping()[id]; persist(); render(); }
    else if (a === "export") exportCopy();
    else if (a === "import") importCopy();
  }
  function exportCopy() {
    var blob = new Blob([JSON.stringify({ kind: "central-controls", version: 1, app: CU.appName, controls: data }, null, 2)], { type: "application/json" });
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = (CU.appName || "Central").replace(/\s+/g, "-") + "-controls.json"; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function importCopy() {
    var inp = document.createElement("input"); inp.type = "file"; inp.accept = ".json,application/json";
    inp.onchange = function () {
      var f = inp.files && inp.files[0]; if (!f) return;
      f.text().then(function (txt) {
        var j = null; try { j = JSON.parse(txt); } catch (_) { }
        if (!j || j.kind !== "central-controls" || !j.controls || !Array.isArray(j.controls.inputs)) { alert("That file isn't a copy of the controls."); return; }
        if (!confirm("Replace the controls on this computer with the ones in the copy?")) return;
        setData(j.controls);
      });
    };
    inp.click();
  }
  function setData(d) { data = { inputs: Array.isArray(d.inputs) ? d.inputs : [], mapping: d.mapping && typeof d.mapping === "object" ? d.mapping : {}, streamDeck: d.streamDeck }; persistNow(); S.resetLeds(); render(); if (window.PPStreamDeck) window.PPStreamDeck.redraw(true); }

  // ------------------------------------------------------------- the Stream Deck (js/streamdeck.js, with this app as its host)
  var SD_DEFAULTS = [["tabPrev", null, "Tab", "◀"], ["tabNext", null, "Tab", "▶"], ["lyricsPrev", null, "Lyrics", "⇡"], ["lyricsNext", null, "Lyrics", "⇣"], ["slidePrev", null, "Slide", "◀"],
    ["slideNext", null, "Slide", "▶"], ["slideBlack", null, "Black", "▢"], ["lightsBlackout", null, "Blackout", "●"], ["lightsFlash", null, "Flash", "✦"], ["lightsFollow", null, "Follow", "♪"],
    ["talkHold", null, "Talk", "🎙"], ["videoCut", null, "Cut", "✂"], ["videoAuto", null, "Fade", "⇄"], ["recordToggle", null, "Record", "⏺"], ["mixMainMute", null, "Mute", "M"]];
  var USER_DEFAULTS = [["lyricsPrev", null, "Lyrics", "⇡"], ["lyricsNext", null, "Lyrics", "⇣"], ["instBoardPrev", null, "Board", "◀"], ["instBoardNext", null, "Board", "▶"], ["instTuner", null, "Tuner", "♪"], ["talkHold", null, "Talk", "🎙"]];
  window.CCHost = {
    store: function () { return data; }, persist: persist, status: function (t) { if (window.CURoles && window.CURoles.toast) window.CURoles.toast(t); }, ask: function (q, o) { return CU.askText ? CU.askText(q, (o && o.value) || "") : Promise.resolve(prompt(q, (o && o.value) || "")); },
    esc: esc, actions: function () { return API; }, inputs: function () { return data.inputs; },
    rerender: function () { if (visible()) render(); }, changed: function () { ledsSoon(); },
    get defaults() { return admin() ? SD_DEFAULTS : USER_DEFAULTS; },
    label: function () { return null; },
    sectionAttrs: "", sectionClass: "card", note: "Each key does anything from the list (press, and hold). Give a key \"Stream Deck: next page\" to use more pages."
  };
  var API = { ACTIONS: ACTIONS, list: list, run: run, onControl: onControl, mapping: mapping, entryFor: entryFor, modeChanged: ledsSoon, sendLeds: ledsSoon, inputs: inputs, setData: setData, data: function () { return data; }, render: render, midiIn: midiIn };
  window.CUControls = API;

  var root = $("#controlsRoot");
  if (root) { root.addEventListener("change", onChange); root.addEventListener("click", onClick); }
  CU.on("tab", function (t) { if (t === "controls") render(); ledsSoon(); });
  CU.on("mode", function () { if (visible()) render(); });
})();
