/* Central Pedal - the I/O tab: every input and output in one place.
 *   Audio to Central Control (network: Ethernet / Wi-Fi, or cabled through the audio interface)
 *   Audio outputs (the four buses -> output channels, per-track direct outputs)
 *   Audio inputs (instrument input, the audio input pad)
 *   MIDI (ports, notes for the lights)  ·  Screens & video (HDMI 1 / 2)  ·  Control surface  ·  Devices on the network */
(function () {
  "use strict";
  var PP = window.PP, F = window.PPFeatures; if (!PP || !F) return;
  var esc = PP.escapeHtml, engine = PP.engine;
  function $(s) { return document.querySelector(s); }
  function project() { return PP.project(); }
  function bridge() { return window.__pedalBridge; }
  function connected() { return !!(bridge() && bridge().connected); }
  function onTab() { return window.PPShell && window.PPShell.currentTab() === "io"; }
  var net = null;

  function radio(name, value, cur, label, sub) { return '<label class="io-opt' + (value === cur ? " on" : "") + '"><input type="radio" name="' + name + '" value="' + value + '"' + (value === cur ? " checked" : "") + "><span><b>" + label + "</b>" + (sub ? "<small>" + sub + "</small>" : "") + "</span></label>"; }
  function netCard() {
    var s = net || (F.systemStatus() || {}).netAudio || null, cfg = s ? s.config : { mode: "off", quality: "full", instrument: true }, mode = cfg.mode;
    var ifs = (s && s.interfaces) || (F.systemStatus() || {}).interfaces || [], eth = ifs.filter(function (i) { return i.kind === "ethernet"; }), wifi = ifs.filter(function (i) { return i.kind === "wifi"; });
    var addr = function (l) { return l.length ? l.map(function (i) { return esc(i.address) + " <small>(" + esc(i.iface) + ")</small>"; }).join(", ") : '<span class="muted">not connected</span>'; };
    var NS = window.PPNetSend, chans = NS && NS.sending() ? NS.channels() : [], stats = NS ? NS.stats() : { packets: 0, dropped: 0 };
    var listeners = s && s.listeners ? s.listeners : [];
    return '<section class="io-card wide"><h3>Audio to Central Control</h3>' +
      '<p class="muted">Every track on its own channel (Central Control mixes them, makes the in-ear mixes, records the service and lets the lights react), plus click, pads, the tracks mix and the instrument.</p>' +
      '<div class="io-opts">' + radio("ioNet", "off", mode, "Off", "nothing is sent") + radio("ioNet", "ethernet", mode, "Ethernet", "a cable to the network or straight to the computer - best") + radio("ioNet", "wifi", mode, "Wi-Fi", "works anywhere on the Wi-Fi; a little more delay") + radio("ioNet", "interface", mode, "Audio interface", "cables from the outputs here into the other computer's interface") + "</div>" +
      (mode === "ethernet" || mode === "wifi" ? '<div class="row"><label>Quality <select data-io="quality"><option value="full"' + (cfg.quality !== "saver" ? " selected" : "") + '>Full (48 kHz)</option><option value="saver"' + (cfg.quality === "saver" ? " selected" : "") + ">Saver (24 kHz, half the data - busy Wi-Fi)</option></select></label>" +
        '<label class="toggle"><input type="checkbox" data-io="instrument"' + (cfg.instrument !== false ? " checked" : "") + "> Include the instrument</label></div>" : "") +
      '<table class="io-table"><tr><td>Ethernet</td><td>' + addr(eth) + '</td></tr><tr><td>Wi-Fi</td><td>' + addr(wifi) + "</td></tr>" +
      (mode === "ethernet" || mode === "wifi" ? "<tr><td>Listening</td><td>" + (listeners.length ? listeners.map(function (l) { return esc(l.name) + " <small>" + esc(l.address) + (l.dropped ? " · " + l.dropped + " late packets dropped" : "") + "</small>"; }).join("<br>") : '<span class="muted">no Central Control is listening yet - it starts when one connects (Central Control → I/O → From the Central Pedal)</span>') + "</td></tr>" +
        "<tr><td>Sending</td><td>" + (chans.length ? chans.length + " channels: " + chans.map(esc).join(" · ") + ' <small class="muted">· ' + stats.packets + " packets" + (stats.dropped ? " · " + stats.dropped + " dropped" : "") + "</small>" : '<span class="muted">-</span>') + "</td></tr>" : "") +
      (mode === "interface" ? '<tr><td>Cabling</td><td>Give each track its own output in the Tracks mixer (needs a USB interface with more outputs), and route the buses below. Plug those outputs into the Central Control computer\'s interface inputs and pick them there (I/O → Audio inputs).</td></tr>' : "") +
      "</table>" + (connected() ? "" : '<p class="muted">Network audio is set on the Central Pedal itself (the driver is not connected).</p>') + "</section>";
  }
  function outputsCard() {
    var T = window.PPTracks, s = T && T.song(), t = s && T.data(s), direct = (t && t.stems || []).filter(function (st) { return st.out > 0; });
    return '<section class="io-card wide"><h3>Audio outputs</h3><div id="ioRouting" class="routing"></div>' +
      '<p class="muted">Per-track outputs (' + (s ? esc(s.name) : "no song") + "): " + (direct.length ? direct.map(function (st) { return esc(st.name) + " → " + st.out; }).join(" · ") : "none - every track is in the tracks mix") + ' <button data-io-go="tracks">Tracks mixer</button></p></section>';
  }
  function inputsCard() {
    var I = window.PPInstrument, c = I ? I.config() : null, inp = c ? c.input || {} : {}, kind = c ? c.kind : "off";
    var p = project(), padIn = p.input && p.input.enabled;
    return '<section class="io-card"><h3>Audio inputs</h3><table class="io-table">' +
      "<tr><td>Instrument</td><td>" + (kind === "off" ? '<span class="muted">off</span>' : esc(kind === "keys" ? "Keys (USB MIDI keyboard)" : kind + " guitar · input " + (inp.device || "auto") + " " + (inp.channel || "L") + " · gain " + (inp.gain || 0) + " dB")) + ' <button data-io-go="instrument">Instrument</button></td></tr>' +
      "<tr><td>Audio input pad</td><td>" + (padIn ? "on (a mic or line into the pads' effects)" : '<span class="muted">off</span>') + "</td></tr></table></section>";
  }
  function midiCard() {
    var st = F.systemStatus() || {}, ports = st.midiPorts || {}, ins = Array.isArray(ports) ? ports : ports.inputs || [], outs = Array.isArray(ports) ? [] : ports.outputs || [], mo = project().midiOut || {};
    var chk = function (k, label) { return '<label class="toggle"><input type="checkbox" data-sys="' + k + '"' + (mo[k] ? " checked" : "") + "> " + label + "</label>"; };
    return '<section class="io-card"><h3>MIDI</h3><table class="io-table"><tr><td>In</td><td>' + (ins.length ? ins.map(esc).join("<br>") : '<span class="muted">none</span>') + "</td></tr><tr><td>Out</td><td>" + (outs.length ? outs.map(esc).join("<br>") : '<span class="muted">none</span>') + "</td></tr></table>" +
      '<div class="io-checks">' + chk("lightsHits", "Hits as notes (lights)") + chk("lightsSections", "Section notes") + chk("pcOnSong", "Program change per song") + chk("clockOut", "MIDI clock out") + '</div><p class="muted small">These also reach Central Control over the network, lined up with the tracks.</p></section>';
  }
  function screensCard() {
    var st = F.systemStatus() || {}, d = st.displays || project().display || {};
    var opts = function (list, cur) { return list.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === cur ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join(""); };
    var one = [["app", "Central Pedal"], ["mini", "Big 3.5-inch screen"], ["lyrics", "Lyrics"], ["charts", "Chord charts"], ["stage", "Stage display"], ["slides", "Slides from Central Control"]];
    var two = [["lyrics", "Lyrics (projector)"], ["slides", "Slides & lyrics from Central Control"], ["stage", "Stage display"], ["charts", "Chord charts"], ["mini", "Big 3.5-inch screen"], ["app", "Central Pedal"], ["off", "Nothing"]];
    return '<section class="io-card"><h3>Screens &amp; video</h3><label>HDMI 1 shows<select data-sys="hdmi1">' + opts(one, d.hdmi1 || "app") + '</select></label><label>HDMI 2 shows<select data-sys="hdmi2">' + opts(two, d.hdmi2 || "lyrics") + "</select></label>" +
      '<p class="muted small">Changing what a screen shows restarts the screens. Resolution, zoom and edges: Settings → Screens.</p></section>';
  }
  function surfaceCard() {
    var map = window.PPActions && window.PPActions.mapping ? window.PPActions.mapping() : {}, used = Object.keys(map || {}).filter(function (k) { return map[k] && (map[k].action || map[k].press); }).length;
    return '<section class="io-card"><h3>Control surface</h3><p>12 buttons · 6 knobs · 2 sliders · expression pedal · encoder <br><span class="muted">' + used + " controls have a job.</span></p>" +
      '<div class="row"><button data-io-go="configure">Configure</button><button data-io-go="learn">Learn</button></div></section>';
  }
  function devicesCard() {
    var st = F.systemStatus() || {}, cus = st.centralUsage || [], host = st.audioHost;
    return '<section class="io-card"><h3>On the network</h3><table class="io-table"><tr><td>Central Control</td><td>' + (cus.length ? cus.map(function (c) { return esc(c.name) + (c.mode ? " <small>(" + esc(c.mode) + ")</small>" : ""); }).join("<br>") : '<span class="muted">none connected</span>') + "</td></tr>" +
      "<tr><td>Audio host</td><td>" + (host ? esc(host.name) + " <small>" + esc(host.address) + ":" + host.port + "</small>" : '<span class="muted">none - one Central Control admin computer makes the in-ear mixes</span>') + "</td></tr>" +
      "<tr><td>Phones &amp; tablets</td><td>" + (st.companion ? esc(st.companion) : '<span class="muted">-</span>') + ' <small class="muted">charts · lyrics · stage · remote</small></td></tr><tr><td>Pairing code</td><td><b>' + esc(st.code || (bridge() && bridge().info && bridge().info.code) || "-") + "</b></td></tr></table></section>";
  }
  function render() {
    var root = $("#ioRoot"); if (!root) return;
    root.innerHTML = '<div class="io-grid">' + netCard() + outputsCard() + inputsCard() + midiCard() + screensCard() + surfaceCard() + devicesCard() + "</div>";
    if (window.PPSettings) window.PPSettings.renderRouting($("#ioRouting"));
  }
  function wire() {
    var tab = $("#tabIO"); if (!tab) return;
    tab.addEventListener("change", function (e) {
      var el = e.target;
      if (el.name === "ioNet") { if (window.PPNetSend) window.PPNetSend.configure({ mode: el.value }); return; }
      if (el.dataset.io === "quality") { if (window.PPNetSend) window.PPNetSend.configure({ quality: el.value }); return; }
      if (el.dataset.io === "instrument") { if (window.PPNetSend) window.PPNetSend.configure({ instrument: el.checked }); return; }
      if (el.name === "rtMode" || el.dataset.rt) { if (window.PPSettings) window.PPSettings.onRouting(e); return; }
      if (el.dataset.sys && window.PPShell) { window.PPShell.onSys(e); setTimeout(render, 50); }
    });
    tab.addEventListener("click", function (e) {
      var b = e.target.closest("[data-io-go],[data-rt-test]"); if (!b) return;
      if (b.dataset.ioGo && window.PPShell) window.PPShell.showTab(b.dataset.ioGo);
      else if (b.dataset.rtTest) engine.testBus(b.dataset.rtTest);
    });
    F.on("systemStatus", function () { if (onTab()) render(); });
  }
  wire();
  window.PPIO = { render: render, onNetAudio: function (m) { net = m; if (onTab()) render(); } };
})();
