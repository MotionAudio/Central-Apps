/* Pad Pedal - Configure tab (what every button / knob / slider / pedal does, per
 * mode) and Learn tab (which pin or USB / MIDI control each input is). The
 * hardware map (hardware.json on the Pi) comes from the driver; a copy is kept
 * in the project so a PC can show and edit it too. */
(function () {
  "use strict";
  var PP = window.PP, F = window.PPFeatures, A = window.PPActions; if (!PP || !F || !A) return;
  var esc = PP.escapeHtml;
  function $(s) { return document.querySelector(s); }
  function project() { return PP.project(); }
  function bridge() { return window.__pedalBridge; }
  function connected() { return !!(bridge() && bridge().connected); }
  function send(m) { return bridge() && bridge().send ? bridge().send(m) : false; }

  var SCREEN_PINS = [7, 8, 9, 10, 11, 17, 24, 25], I2S_PINS = [18, 19, 21];
  var DEFAULT_INPUTS = [
    { id: "b1", name: "Button 1", kind: "button", gpio: 4 }, { id: "b2", name: "Button 2", kind: "button", gpio: 5 }, { id: "b3", name: "Button 3", kind: "button", gpio: 6 }, { id: "b4", name: "Button 4", kind: "button", gpio: 12 },
    { id: "b5", name: "Button 5", kind: "button", gpio: 13 }, { id: "b6", name: "Button 6", kind: "button", gpio: 14 }, { id: "b7", name: "Button 7", kind: "button", gpio: 15 }, { id: "b8", name: "Button 8", kind: "button", gpio: 16 },
    { id: "b9", name: "Button 9", kind: "button", gpio: 22 }, { id: "b10", name: "Button 10", kind: "button", gpio: 23 }, { id: "b11", name: "Button 11", kind: "button", gpio: 26 }, { id: "b12", name: "Button 12", kind: "button", gpio: 27 },
    { id: "k1", name: "Knob 1", kind: "knob", adc: { address: "0x48", channel: 0 } }, { id: "k2", name: "Knob 2", kind: "knob", adc: { address: "0x48", channel: 1 } }, { id: "k3", name: "Knob 3", kind: "knob", adc: { address: "0x48", channel: 2 } }, { id: "k4", name: "Knob 4", kind: "knob", adc: { address: "0x48", channel: 3 } },
    { id: "k5", name: "Knob 5", kind: "knob", adc: { address: "0x49", channel: 0 } }, { id: "k6", name: "Knob 6", kind: "knob", adc: { address: "0x49", channel: 1 } }, { id: "s1", name: "Slider 1", kind: "slider", adc: { address: "0x49", channel: 2 } }, { id: "s2", name: "Slider 2", kind: "slider", adc: { address: "0x49", channel: 3 } },
    { id: "exp", name: "Expression pedal", kind: "expression", adc: { address: "0x4a", channel: 0 }, auto_calibrate: true },
    { id: "enc", name: "Encoder", kind: "encoder", gpio_a: 10, gpio_b: 9, gpio_button: 11 }
  ];
  var BCM_TO_PIN = { 2: 3, 3: 5, 4: 7, 14: 8, 15: 10, 17: 11, 18: 12, 27: 13, 22: 15, 23: 16, 24: 18, 10: 19, 9: 21, 25: 22, 11: 23, 8: 24, 7: 26, 0: 27, 1: 28, 5: 29, 6: 31, 12: 32, 13: 33, 19: 35, 16: 36, 26: 37, 20: 38, 21: 40 };
  var hello = null, devices = { mouse: false, keyboard: false, usb: [] }, learning = null, midiLearn = null;

  function inputs() {
    var p = project();
    if (!Array.isArray(p.inputs) || !p.inputs.length) p.inputs = JSON.parse(JSON.stringify(DEFAULT_INPUTS));
    return p.inputs;
  }
  function byId(id) { return inputs().filter(function (i) { return i.id === id; })[0] || null; }
  function wiringText(i) {
    if (i.usb) return "USB " + (i.usb.name || "") + " · " + (i.usb.codeName || ("key " + i.usb.code) || ("axis " + i.usb.abs));
    if (i.midi) return "MIDI " + i.midi.type.toUpperCase() + " " + i.midi.number + (i.midi.channel ? " ch" + i.midi.channel : "");
    if (i.kind === "encoder") return i.gpio_a != null ? "GPIO " + i.gpio_a + " / " + i.gpio_b + (i.gpio_button != null ? " · push GPIO " + i.gpio_button : "") : "not wired";
    if (i.gpio != null) return "GPIO " + i.gpio + " (pin " + (BCM_TO_PIN[i.gpio] || "?") + ")";
    if (i.adc) return "ADS1115 " + i.adc.address + " · A" + i.adc.channel;
    return "not wired";
  }
  function saveInputs() {
    var list = inputs(); PP.persistSoon();
    send({ type: "inputs", inputs: list.map(function (i) { var o = {}; Object.keys(i).forEach(function (k) { if (k !== "active" && k !== "midi") o[k] = i[k]; }); return o; }), save: true });
  }

  // ---------------------------------------------------------------- Configure
  function argControl(entry, action) {
    var a = A.ACTIONS[action]; if (!a || !a.arg) return "";
    var args = entry.args || {};
    if (a.arg === "pad") return '<select data-cf="arg-index">' + project().pads.map(function (pad, i) { return '<option value="' + i + '"' + (Number(args.index) === i ? " selected" : "") + ">" + (i + 1) + ". " + esc(pad.name) + "</option>"; }).join("") + "</select>";
    if (a.arg === "pedal") { var list = window.PPInstrument ? window.PPInstrument.pedalNames() : []; return '<select data-cf="arg-index">' + (list.length ? list : [{ index: 0, name: "pedal 1" }, { index: 1, name: "pedal 2" }, { index: 2, name: "pedal 3" }, { index: 3, name: "pedal 4" }, { index: 4, name: "pedal 5" }, { index: 5, name: "pedal 6" }, { index: 6, name: "pedal 7" }, { index: 7, name: "pedal 8" }]).map(function (it) { return '<option value="' + it.index + '"' + (Number(args.index) === it.index ? " selected" : "") + ">" + (it.index + 1) + ". " + esc(it.name) + "</option>"; }).join("") + "</select>"; }
    if (a.arg === "song") return '<input data-cf="arg-index" type="number" min="1" max="99" value="' + ((Number(args.index) || 0) + 1) + '" title="song number">';
    if (a.arg === "section") return '<input data-cf="arg-index" type="number" min="1" max="40" value="' + ((Number(args.index) || 0) + 1) + '" title="section number">';
    if (a.arg === "scene") return '<input data-cf="arg-index" type="number" min="1" max="32" value="' + ((Number(args.index) || 0) + 1) + '" title="scene number (in the song)">';
    if (a.arg === "layer") return '<input data-cf="arg-index" type="number" min="1" max="8" value="' + ((Number(args.index) || 0) + 1) + '" title="layer number">';
    if (a.arg === "stem") return '<input data-cf="arg-index" type="number" min="1" max="24" value="' + ((Number(args.index) || 0) + 1) + '" title="stem number">';
    if (a.arg === "tab") return '<select data-cf="arg-tab">' + ["pads", "tracks", "instrument", "configure", "learn", "settings"].map(function (t) { return '<option value="' + t + '"' + (args.tab === t ? " selected" : "") + ">" + t + "</option>"; }).join("") + "</select>";
    if (a.arg === "cue") return '<input data-cf="arg-cue" value="' + esc(args.cue || "chorus") + '" placeholder="cue id">';
    return "";
  }
  function actionSelect(field, kind, selected) {
    var groups = {}; A.list(kind).forEach(function (a) { (groups[a.group] = groups[a.group] || []).push(a); });
    return '<select data-cf="' + field + '">' + Object.keys(groups).map(function (g) { return '<optgroup label="' + g + '">' + groups[g].map(function (a) { return '<option value="' + a.id + '"' + (a.id === selected ? " selected" : "") + ">" + esc(a.label) + "</option>"; }).join("") + "</optgroup>"; }).join("") + "</select>";
  }
  function renderConfigure() {
    var root = $("#cfRows"); if (!root) return;
    var map = A.mapping(), list = inputs();
    root.innerHTML = list.map(function (i) {
      var e = map[i.id] || (map[i.id] = { action: "none" }), kind = i.kind === "button" ? "trigger" : i.kind === "encoder" ? "step" : "continuous";
      var html = '<div class="cf-row" data-input-id="' + i.id + '" data-input="' + i.id + '"><div class="cf-id"><i class="dot' + (i.active === false ? " off" : "") + '"></i><input data-cf="name" value="' + esc(i.name) + '"><small>' + esc(wiringText(i)) + "</small></div>";
      html += '<div class="cf-act">' + actionSelect("action", kind, e.action) + argControl(e, e.action) + "</div>";
      if (i.kind === "button") html += '<div class="cf-hold"><small>hold</small>' + actionSelect("hold", "trigger", e.hold ? e.hold.action : "none") + (e.hold ? argControl(e.hold, e.hold.action).replace('data-cf="arg-', 'data-cf="holdarg-') : "") + "</div>";
      else if (i.kind === "encoder") html += '<div class="cf-hold"><small>press</small>' + actionSelect("press", "trigger", e.press ? e.press.action : "none") + '<small>hold</small>' + actionSelect("hold", "trigger", e.hold ? e.hold.action : "none") + "</div>";
      else html += '<div class="cf-hold"><label class="toggle"><input type="checkbox" data-cf="invert"' + (i.invert ? " checked" : "") + "> invert</label></div>";
      return html + "</div>";
    }).join("");
  }
  function onConfigure(e) {
    var row = e.target.closest("[data-input]"), f = e.target.dataset.cf; if (!row || !f) return;
    var id = row.dataset.input, map = A.mapping(), entry = map[id] || (map[id] = { action: "none" }), spec = byId(id);
    if (f === "name") { if (spec) { spec.name = e.target.value; saveInputs(); } return; }
    if (f === "invert") { if (spec) { spec.invert = e.target.checked; saveInputs(); } return; }
    if (f === "action") { entry.action = e.target.value; entry.args = {}; if (A.ACTIONS[entry.action] && A.ACTIONS[entry.action].arg === "pad") entry.args.index = 0; }
    else if (f === "hold") { if (e.target.value === "none") delete entry.hold; else entry.hold = { action: e.target.value, args: {} }; }
    else if (f === "press") { if (e.target.value === "none") delete entry.press; else entry.press = { action: e.target.value, args: {} }; }
    else if (f.indexOf("arg-") === 0) { entry.args = entry.args || {}; var k = f.slice(4); entry.args[k] = k === "index" ? (A.ACTIONS[entry.action].arg === "pad" ? Number(e.target.value) : Number(e.target.value) - 1) : e.target.value; }
    else if (f.indexOf("holdarg-") === 0) { entry.hold = entry.hold || { action: "none" }; entry.hold.args = entry.hold.args || {}; var k2 = f.slice(8); entry.hold.args[k2] = k2 === "index" ? (A.ACTIONS[entry.hold.action].arg === "pad" ? Number(e.target.value) : Number(e.target.value) - 1) : e.target.value; }
    PP.persistSoon(); A.modeChanged(); renderConfigure();
  }

  // ---------------------------------------------------------------- Learn
  function renderLearn() {
    var root = $("#lnBoard"); if (!root) return;
    var list = inputs(), reserved = hello ? hello.reservedPins || [] : [];
    $("#lnStatus").textContent = connected() ? "Control board connected" + (hello && hello.screen35 ? " · 3.5-inch screen on (GPIO " + SCREEN_PINS.join(", ") + " reserved)" : "") + (hello && hello.soundCards && hello.soundCards.some(function (c) { return /hifiberry/i.test(c); }) ? " · I2S DAC found" : "") : "Not connected to the Central Pedal (learning works on the Central Pedal itself).";
    root.innerHTML = list.filter(function (i) { return !i.usb && !i.midi; }).map(function (i) {
      var lrn = learning && learning.target === i.id;
      return '<div class="ln-row' + (lrn ? " learning" : "") + '" data-input-id="' + i.id + '" data-learn="' + i.id + '"><i class="dot' + (i.active === false ? " off" : "") + '"></i><b>' + esc(i.name) + '</b><small>' + esc(wiringText(i)) + (i.gpio != null && reserved.indexOf(i.gpio) > -1 ? " · pin taken by the screen / DAC" : "") + '</small><button data-ln="learn"' + (!connected() ? " disabled" : "") + ">" + (lrn ? "Press / turn it now… (cancel)" : "Learn") + "</button></div>";
    }).join("");
    var usb = $("#lnUsb");
    usb.innerHTML = (devices.usb.length ? "<p class=\"muted\">Plugged in: " + devices.usb.map(function (d) { return esc(d.name) + (d.pedal ? " (pedal)" : d.keyboard ? " (keyboard)" : d.mouse ? " (mouse)" : ""); }).join(", ") + "</p>" : '<p class="muted">' + (connected() ? "No USB pedals or controllers found. Plug one into the Pi." : "Shows USB devices when connected to the Central Pedal.") + "</p>") +
      list.filter(function (i) { return i.usb || i.midi; }).map(function (i) {
        var lrn = learning && learning.target === i.id, ml = midiLearn && midiLearn.target === i.id;
        return '<div class="ln-row' + (lrn || ml ? " learning" : "") + '" data-input-id="' + i.id + '" data-learn="' + i.id + '"><i class="dot"></i><input data-ln="name" value="' + esc(i.name) + '"><small>' + esc(wiringText(i)) + '</small><button data-ln="' + (i.midi ? "midilearn" : "learn") + '">' + (lrn || ml ? "Press it now… (cancel)" : "Learn") + '</button><button data-ln="del" class="danger">✕</button></div>';
      }).join("");
    $("#lnMouse").textContent = devices.mouse ? "Mouse connected: the cursor is shown." : "No mouse: the cursor is hidden (touch).";
    drawHeader();
  }
  function drawHeader() {
    var el = $("#lnDiagram"); if (!el) return;
    var roles = {}; [1, 17].forEach(function (p) { roles[p] = ["v33", "3.3 V"]; }); [2, 4].forEach(function (p) { roles[p] = ["v5", "5 V"]; }); [6, 9, 14, 20, 25, 30, 34, 39].forEach(function (p) { roles[p] = ["gnd", "GND"]; });
    roles[3] = ["i2c", "SDA → ADS1115 + MCP23017 + …"]; roles[5] = ["i2c", "SCL → ADS1115 + MCP23017 + …"];
    inputs().forEach(function (i) { if (i.gpio != null && BCM_TO_PIN[i.gpio]) roles[BCM_TO_PIN[i.gpio]] = ["sw", i.name]; if (i.kind === "encoder" && i.gpio_a != null) { roles[BCM_TO_PIN[i.gpio_a]] = ["enc", i.name + " A"]; roles[BCM_TO_PIN[i.gpio_b]] = ["enc", i.name + " B"]; if (i.gpio_button != null) roles[BCM_TO_PIN[i.gpio_button]] = ["enc", i.name + " push"]; } });
    I2S_PINS.forEach(function (g) { roles[BCM_TO_PIN[g]] = roles[BCM_TO_PIN[g]] || ["dac", { 18: "DAC BCK", 19: "DAC LCK", 21: "DAC DIN" }[g]]; });
    var screenOn = hello ? hello.screen35 : true;
    SCREEN_PINS.forEach(function (g) { var p = BCM_TO_PIN[g]; if (!roles[p] || roles[p][0] === "enc") roles[p] = [screenOn ? "scr" : "free", screenOn ? "3.5\" screen" : (roles[p] ? roles[p][1] : "spare")]; });
    var row = 22, svg = '<svg viewBox="0 0 560 ' + (20 * row + 30) + '" class="hdr-mini">';
    function name(p) { var bcm = Object.keys(BCM_TO_PIN).filter(function (k) { return BCM_TO_PIN[k] === p; })[0]; return bcm != null ? "GPIO " + bcm : ({ 1: "3V3", 17: "3V3", 2: "5V", 4: "5V" })[p] || "GND"; }
    for (var r = 0; r < 20; r++) {
      [[2 * r + 1, 250, "l"], [2 * r + 2, 290, "r"]].forEach(function (c) {
        var p = c[0], cx = c[1], y = 20 + r * row, role = roles[p] || ["free", "spare"];
        svg += '<circle class="pin ' + role[0] + '" cx="' + cx + '" cy="' + y + '" r="8"/><text class="pnum" x="' + cx + '" y="' + (y + 3) + '" text-anchor="middle">' + p + "</text>";
        svg += c[2] === "l" ? '<text class="plab" x="' + (cx - 14) + '" y="' + (y + 4) + '" text-anchor="end">' + esc(role[1]) + ' <tspan class="gpn">' + name(p) + "</tspan></text>" : '<text class="plab" x="' + (cx + 14) + '" y="' + (y + 4) + '"><tspan class="gpn">' + name(p) + "</tspan> " + esc(role[1]) + "</text>";
      });
    }
    el.innerHTML = svg + "</svg>";
  }
  function startLearn(id, kind) {
    if (learning && learning.target === id) { learning = null; send({ type: "learnCancel" }); renderLearn(); return; }
    var spec = byId(id); if (!spec) return;
    learning = { target: id, kind: kind || (spec.usb ? "button" : spec.kind) };
    send({ type: "learn", target: id, kind: learning.kind, allowKeyboard: !!(spec.usb && spec.usb.keyboardOk) });
    PP.setStatus("Learning " + spec.name + ": press it (or turn it) now");
    renderLearn();
    setTimeout(function () { if (learning && learning.target === id) { learning = null; send({ type: "learnCancel" }); renderLearn(); PP.setStatus("Learning timed out"); } }, 30000);
  }
  F.on("learned", function (m) {
    var spec = byId(m.target); learning = null;
    if (!spec) { renderLearn(); return; }
    var old = { gpio: spec.gpio, adc: spec.adc, usb: spec.usb, gpio_a: spec.gpio_a, gpio_b: spec.gpio_b, gpio_button: spec.gpio_button };
    delete spec.gpio; delete spec.adc; delete spec.usb;
    if (m.input.gpio != null) { if (spec.kind === "encoder") spec.gpio_button = m.input.gpio; else spec.gpio = m.input.gpio; }
    if (m.input.adc) spec.adc = m.input.adc;
    if (m.input.usb) spec.usb = m.input.usb;
    if (m.alreadyUsedBy) { var other = byId(m.alreadyUsedBy); if (other) { delete other.gpio; delete other.adc; if (old.gpio != null) other.gpio = old.gpio; if (old.adc) other.adc = old.adc; PP.setStatus(spec.name + " learned (swapped with " + other.name + ")"); } }
    else PP.setStatus(spec.name + " learned: " + wiringText(spec));
    saveInputs(); renderLearn(); renderConfigure();
  });
  F.on("learning", function () { renderLearn(); });
  F.on("hello", function (m) {
    hello = m;
    if (Array.isArray(m.inputs) && m.inputs.length) { project().inputs = m.inputs.map(function (i) { var o = {}; Object.keys(i).forEach(function (k) { if (k !== "needs_free") o[k] = i[k]; }); return o; }); keepMidiInputs(); PP.persistSoon(); }
    renderLearn(); renderConfigure();
  });
  function keepMidiInputs() { var saved = (project().midiInputs || []); project().inputs = inputs().filter(function (i) { return !i.midi; }).concat(saved); }
  F.on("devices", function (m) { devices = m; renderLearn(); if (window.PPShell) window.PPShell.setPointer(!!m.mouse); });
  async function addUsb(kind) {
    var name = await PP.ask(kind === "button" ? "Name for the new button (e.g. Next section)" : "Name for the new USB knob / pedal", kind === "button" ? "USB pedal " + (inputs().filter(function (i) { return i.usb; }).length + 1) : "USB knob");
    if (name === null) return;
    var id = "u" + Date.now().toString(36), spec = { id: id, name: name || id, kind: kind, usb: { vendor: 0, product: 0, name: "", code: 0 } };
    inputs().push(spec); A.mapping()[id] = { action: "none" };
    PP.persistSoon(); renderLearn(); startLearn(id, kind);
  }
  async function addMidi(kind) {
    var name = await PP.ask(kind === "button" ? "Name for the new MIDI button" : "Name for the new MIDI knob / pedal", kind === "button" ? "MIDI button" : "MIDI knob");
    if (name === null) return;
    var id = "m" + Date.now().toString(36), spec = { id: id, name: name || id, kind: kind, midi: { type: kind === "button" ? "note" : "cc", number: 0, channel: 0 } };
    inputs().push(spec); project().midiInputs = (project().midiInputs || []).concat([spec]); A.mapping()[id] = { action: "none" };
    PP.persistSoon(); renderLearn(); startMidiLearn(id);
  }
  function startMidiLearn(id) { if (midiLearn && midiLearn.target === id) { midiLearn = null; renderLearn(); return; } midiLearn = { target: id }; PP.setStatus("Press / move the MIDI control now"); renderLearn(); }
  function midiLearnMessage(d) {
    if (!midiLearn) return false;
    var spec = byId(midiLearn.target), type = d[0] & 0xF0, ch = (d[0] & 0x0F) + 1; if (!spec) { midiLearn = null; return false; }
    if (type === 0x90 && d[2] > 0) spec.midi = { type: "note", number: d[1], channel: ch };
    else if (type === 0xB0) spec.midi = { type: "cc", number: d[1], channel: ch };
    else if (type === 0xC0) spec.midi = { type: "pc", number: d[1], channel: ch };
    else return true;
    midiLearn = null; project().midiInputs = inputs().filter(function (i) { return i.midi; }); PP.persistSoon(); PP.setStatus(spec.name + " learned: " + wiringText(spec)); renderLearn(); renderConfigure();
    return true;
  }
  function wire() {
    if (!$("#cfRows")) return;
    $("#cfRows").addEventListener("change", onConfigure);
    $("#cfReset").addEventListener("click", function () { if (!confirm("Put every button, knob and slider back to the default layout?")) return; project().mapping.all = A.defaults(); PP.persistSoon(); A.modeChanged(); renderConfigure(); });
    $("#lnBoard").addEventListener("click", function (e) { var b = e.target.closest("[data-ln]"), row = e.target.closest("[data-learn]"); if (b && row && b.dataset.ln === "learn") startLearn(row.dataset.learn); });
    $("#lnUsb").addEventListener("click", function (e) {
      var b = e.target.closest("[data-ln]"), row = e.target.closest("[data-learn]"); if (!b || !row) return;
      var id = row.dataset.learn, spec = byId(id);
      if (b.dataset.ln === "learn") startLearn(id, spec.kind);
      else if (b.dataset.ln === "midilearn") startMidiLearn(id);
      else if (b.dataset.ln === "del") { project().inputs = inputs().filter(function (i) { return i.id !== id; }); project().midiInputs = inputs().filter(function (i) { return i.midi; }); delete A.mapping()[id]; saveInputs(); renderLearn(); renderConfigure(); }
    });
    $("#lnUsb").addEventListener("change", function (e) { var row = e.target.closest("[data-learn]"); if (row && e.target.dataset.ln === "name") { var spec = byId(row.dataset.learn); if (spec) { spec.name = e.target.value; saveInputs(); renderConfigure(); } } });
    $("#lnAddUsbButton").addEventListener("click", function () { addUsb("button"); });
    $("#lnAddUsbKnob").addEventListener("click", function () { addUsb("knob"); });
    $("#lnAddMidiButton").addEventListener("click", function () { addMidi("button"); });
    $("#lnAddMidiKnob").addEventListener("click", function () { addMidi("knob"); });
    $("#lnResetBoard").addEventListener("click", function () { if (!confirm("Put the board inputs back to the default pins?")) return; project().inputs = JSON.parse(JSON.stringify(DEFAULT_INPUTS)).concat(inputs().filter(function (i) { return i.usb || i.midi; })); saveInputs(); renderLearn(); renderConfigure(); });
    keepMidiInputs();
  }
  wire(); renderConfigure(); renderLearn();
  window.PPConfigure = { inputs: inputs, render: function () { renderConfigure(); renderLearn(); }, midiLearn: midiLearnMessage, devices: function () { return devices; }, hello: function () { return hello; }, DEFAULT_INPUTS: DEFAULT_INPUTS, BCM_TO_PIN: BCM_TO_PIN };
})();
