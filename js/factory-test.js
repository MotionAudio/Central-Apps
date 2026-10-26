/* Central Pedal - the factory test (a card built by hand: build-image.sh, FACTORY=1).
 * The first start opens this on HDMI 1, full window, for a keyboard and a mouse: every footswitch (its LED blinks),
 * every knob / slider / expression pedal (min and max), the encoder, the small touch screen (a test pattern on it and
 * its 4 corners; calibrate; pick a different touch screen - the pedal restarts and comes back here), the outputs
 * (a tone on Tracks, Pads, Click; a chord on the Instrument output), the instrument input (a meter), MIDI, Wi-Fi,
 * temperature and power, storage and the sound banks. Save report writes factory-report.json; Finish says to unplug:
 * the next start is the customer's first start (their phone: "Central Pedal Setup"). Footswitches and screen taps don't
 * run app actions while it is open. Driver side: pedal-driver.py Factory. */
(function () {
  "use strict";
  var PP = window.PP, F = window.PPFeatures; if (!PP || !F) return;
  var esc = PP.escapeHtml;
  var st = null, info = null, results = {}, seen = {}, analog = {}, enc = {}, dlg = null, timer = 0, meter = null, saved = null, busy = "";
  var OUTS = [["tracks", "Tracks", "a 440 Hz tone"], ["pad", "Pads", "a 330 Hz tone"], ["click", "Click (in-ears)", "an 880 Hz tone"], ["instrument", "Instrument", "a C major chord (Keys)"]];
  function send(m) { return F.sendToDriver(m); }
  function active() { return !!(dlg && dlg.open); }
  function inputs() { return (st && st.inputs) || (info && info.inputs) || []; }
  function kindOf(i) { return i.kind || (i.adc ? "knob" : "button"); }
  function mark(key, status, auto) { var r = results[key] || {}; if (auto && r.status && !r.auto) return; results[key] = { status: status, auto: !!auto }; schedule(); }
  function schedule() { clearTimeout(timer); timer = setTimeout(render, 60); }
  function cToF(c) { return Math.round(c * 9 / 5 + 32); }

  // ------------------------------------------------------------- driver messages
  F.on("hello", function (m) {
    info = m; var f = m.factory || {};
    if (m.pedalControl || !f.on) { if (dlg && dlg.open && !f.on) dlg.close(); return; }
    open();
  });
  F.on("factory", function (m) { if (st) { st.corners = m.corners || []; st.pattern = m.pattern; st.finished = m.finished; } if ((m.corners || []).length >= 4) mark("screen", "pass", true); schedule(); });
  F.on("factoryStatus", function (m) {
    st = m;
    if (m.wifi && m.wifi.networks > 0) mark("wifi", "pass", true);
    var h = m.health || {};
    if (h.tempC != null) mark("health", h.tempC < 80 && !h.underVoltage && !(h.diskFreeMB != null && h.diskFreeMB < 1024) ? "pass" : "fail", true);
    mark("sounds", (m.banks || []).length ? "pass" : "fail", true);
    if ((m.corners || []).length >= 4) mark("screen", "pass", true);
    schedule();
  });
  F.on("factoryReport", function (m) { saved = m.report; busy = ""; PP.setStatus("Report saved: factory-report.json"); schedule(); });
  F.on("factoryScreen", function (m) { busy = m.ok ? "Restarting with " + (m.name || "the new screen") + " - the test comes back by itself." : ""; if (!m.ok) PP.setStatus(m.error || "The screen wasn't set."); schedule(); });
  F.on("touchCalibrated", function (m) { PP.setStatus(m && m.saved === false ? "Touch calibration not saved - the one from before is back" : "Touch calibrated"); });
  F.on("control", function (m) {
    if (!active()) return;
    var spec = inputs().filter(function (i) { return i.id === m.id; })[0], k = spec ? kindOf(spec) : "button";
    if (k === "encoder") {
      var e = enc[m.id] = enc[m.id] || {};
      if (m.delta > 0) e.cw = true; else if (m.delta < 0) e.ccw = true; else if (m.event === "press") e.press = true;
      if (e.cw && e.ccw && e.press) mark("in:" + m.id, "pass", true);
    } else if (typeof m.value === "number") {
      var a = analog[m.id] = analog[m.id] || { min: 1, max: 0, v: 0 };
      a.v = m.value; a.min = Math.min(a.min, m.value); a.max = Math.max(a.max, m.value);
      if (a.min < 0.03 && a.max > 0.97) mark("in:" + m.id, "pass", true);
      var bar = dlg && dlg.querySelector('[data-bar="' + m.id + '"]'); if (bar) { bar.style.width = Math.round(a.v * 100) + "%"; var t = dlg.querySelector('[data-range="' + m.id + '"]'); if (t) t.textContent = a.max - a.min > 0.02 ? Math.round(a.min * 100) + "–" + Math.round(a.max * 100) + "%" : "not moved yet"; }
      return;   // (no redraw for every value: the bar moves by itself; reaching both ends marks it)
    } else if (m.event === "press" || m.event === "down") {
      seen[m.id] = true; mark("in:" + m.id, "pass", true);
      var follows = (st && st.ledFollows) || {};
      Object.keys(follows).forEach(function (led) { if (follows[led] === m.id) send({ type: "factory", action: "led", id: led, seconds: 1.5 }); });
    }
    schedule();
  });

  // ------------------------------------------------------------- the page
  function open() {
    if (!dlg) {
      dlg = document.createElement("dialog"); dlg.id = "factoryTest"; dlg.className = "ft";
      dlg.addEventListener("cancel", function (e) { e.preventDefault(); });   // (it stays until Finish)
      dlg.addEventListener("click", click); dlg.addEventListener("change", change);
      document.body.appendChild(dlg);
    }
    if (!dlg.open) dlg.showModal();
    send({ type: "factory", action: "status" }); send({ type: "system", action: "status" });
    setTimeout(function () { send({ type: "factory", action: "scan" }); }, 1500);
    clearInterval(open.t); open.t = setInterval(function () { if (active()) send({ type: "factory", action: "status" }); }, 10000);
    render();
  }
  function badge(key) { var r = results[key] || {}; return '<span class="ft-badge ' + (r.status || "todo") + '">' + ({ pass: "✓ Pass", fail: "✗ Fail", skip: "– Not fitted" }[r.status] || "To test") + "</span>"; }
  function pf(key, skip) { return '<span class="ft-pf"><button data-ft-mark="' + esc(key) + '" data-v="pass">Pass</button><button data-ft-mark="' + esc(key) + '" data-v="fail">Fail</button>' + (skip ? '<button data-ft-mark="' + esc(key) + '" data-v="skip">Not fitted</button>' : "") + "</span>"; }
  function row(key, title, detail, extra, skip) { return '<div class="ft-row" data-key="' + esc(key) + '"><div class="ft-what"><b>' + esc(title) + "</b>" + (detail ? '<span class="ft-detail">' + detail + "</span>" : "") + "</div>" + (extra || "") + badge(key) + pf(key, skip) + "</div>"; }
  function counts() { var keys = allKeys(), n = { pass: 0, fail: 0, todo: 0 }; keys.forEach(function (k) { var s = (results[k] || {}).status; if (s === "pass" || s === "skip") n.pass++; else if (s === "fail") n.fail++; else n.todo++; }); n.total = keys.length; return n; }
  function allKeys() { return inputs().map(function (i) { return "in:" + i.id; }).concat(["screen"], OUTS.map(function (o) { return "out:" + o[0]; }), ["input", "midi", "wifi", "health", "sounds"]); }

  function render() {
    if (!dlg || !dlg.open) return;
    var f = (st || {}), h = f.health || {}, ins = inputs(), n = counts(), focus = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.ftFocus : null;
    if (f.finished) {
      dlg.innerHTML = '<div class="ft-done"><h1>Factory test finished</h1><p>' + n.pass + " of " + n.total + " passed" + (n.fail ? ", <b class=\"bad\">" + n.fail + " failed</b>" : "") + '. The report is saved on the pedal.</p>' +
        '<h2>Now unplug the pedal.</h2><p>The next time it starts is the customer\'s first start: it forgets the Wi-Fi used here, keeps the touch screen (' + esc(f.touchScreenName || "") + '), and asks for the church Wi-Fi on their phone ("Central Pedal Setup").</p>' +
        '<div class="ft-actions"><button class="primary" data-ft="poweroff">Power off now</button><button data-ft="reopen">Back to the test</button></div></div>';
      return;
    }
    var sw = ins.filter(function (i) { return kindOf(i) === "button"; }), an = ins.filter(function (i) { return /knob|slider|expression/.test(kindOf(i)); }), en = ins.filter(function (i) { return kindOf(i) === "encoder"; });
    var screens = (f.touchScreens && f.touchScreens.screens) || [], groups = (f.touchScreens && f.touchScreens.groups) || [];
    var portsIn = (f.midiPorts && f.midiPorts.inputs) || [], portsOut = (f.midiPorts && f.midiPorts.outputs) || [];
    dlg.innerHTML =
      '<header class="ft-head"><div><h1>Factory test</h1><p>Central Pedal ' + esc(f.version || (info && info.appVersion) || "") + ' · test each part, then <b>Save report</b> and <b>Finish</b>. Unplugging it afterwards makes the next start the customer\'s.</p></div>' +
      '<div class="ft-sum"><b>' + n.pass + "</b> / " + n.total + " passed" + (n.fail ? ' · <b class="bad">' + n.fail + " failed</b>" : "") + "</div></header>" +
      '<div class="ft-grid">' +
      '<section><h2>Footswitches</h2><p class="muted">Press each one: it turns green here' + ((f.leds || []).length ? " and its LED blinks" : "") + ".</p>" +
        '<div class="ft-sw">' + sw.map(function (i) { var r = results["in:" + i.id] || {}; return '<button class="ft-key ' + (r.status || "") + '" data-ft-mark="in:' + esc(i.id) + '" data-v="' + (r.status === "pass" ? "fail" : "pass") + '" title="Click to mark it by hand">' + esc(i.name || i.id) + "</button>"; }).join("") + "</div></section>" +
      '<section><h2>Knobs, sliders and the expression pedal</h2><p class="muted">Turn each one all the way down and all the way up.</p>' +
        an.map(function (i) { var a = analog[i.id] || { v: 0, min: 1, max: 0 }; return row("in:" + i.id, i.name || i.id, '<span class="ft-meter"><i data-bar="' + esc(i.id) + '" style="width:' + Math.round(a.v * 100) + '%"></i></span><span class="muted small" data-range="' + esc(i.id) + '">' + (a.max - a.min > 0.02 ? Math.round(a.min * 100) + "–" + Math.round(a.max * 100) + "%" : "not moved yet") + "</span>", "", i.optional); }).join("") +
        en.map(function (i) { var e = enc[i.id] || {}; return row("in:" + i.id, i.name || i.id, "Turn right " + (e.cw ? "✓" : "…") + " · left " + (e.ccw ? "✓" : "…") + " · press " + (e.press ? "✓" : "…"), "", i.optional); }).join("") + "</section>" +
      '<section><h2>The small touch screen</h2>' +
        row("screen", f.touchScreenName || "Touch screen", (f.miniScreen ? "Its picture is on" : f.touchScreen === "off" ? "No small screen picked" : "<span class=\"bad\">No picture from it yet</span>") + " · touch " + (f.miniTouch ? esc(f.miniTouch) : "<span class=\"bad\">not found</span>") + " · corners " + ((f.corners || []).length) + " / 4", "") +
        '<div class="ft-actions"><button data-ft="pattern">' + (f.pattern ? "Hide the test pattern" : "Show the test pattern on it") + '</button><button data-ft="calibrate">Calibrate the touch</button></div>' +
        '<label class="ft-pick">A different touch screen <select data-ft-focus="screen" id="ftScreen">' + groups.map(function (g) { return '<optgroup label="' + esc(g.name) + '">' + screens.filter(function (s) { return s.kind === g.id; }).map(function (s) { return '<option value="' + esc(s.id) + '"' + (s.id === f.touchScreen ? " selected" : "") + ">" + esc(s.name) + "</option>"; }).join("") + "</optgroup>"; }).join("") + '<option value="off"' + (f.touchScreen === "off" ? " selected" : "") + '>No small touch screen</option></select></label>' +
        '<div class="ft-actions"><button data-ft="screen">Use this screen and restart</button><span class="muted small">' + esc(busy || "The pedal restarts and comes back into this test.") + "</span></div></section>" +
      '<section><h2>Outputs</h2><p class="muted">Plug headphones into each output in turn. Play it, then Pass or Fail.</p>' +
        OUTS.map(function (o) { return row("out:" + o[0], o[1], esc(o[2]), '<button data-ft-play="' + o[0] + '">▶ Play</button>'); }).join("") +
        ((f.soundCards || []).length ? '<p class="muted small">Sound cards: ' + f.soundCards.map(function (c) { return esc(c.name || c.id || c); }).join(" · ") + "</p>" : "") + "</section>" +
      '<section><h2>Instrument input</h2>' + row("input", "Play the guitar or keys plugged into the input", '<span class="ft-meter big"><i id="ftIn"></i></span><span class="muted small" id="ftInDb">' + (meter ? "listening" : "press Listen") + "</span>", '<button data-ft="listen">' + (meter ? "■ Stop" : "Listen") + "</button>") + "</section>" +
      '<section><h2>MIDI, Wi-Fi and health</h2>' +
        row("midi", "MIDI devices", portsIn.length || portsOut.length ? esc(portsIn.concat(portsOut.map(function (p) { return p + " (out)"; })).join(" · ")) : "None plugged in (plug in a MIDI device to test it, or mark it Not fitted)", "", true) +
        row("wifi", "Wi-Fi radio", f.wifi ? (f.wifi.available === false ? '<span class="bad">' + esc(f.wifi.error || "not available") + "</span>" : f.wifi.networks + " network" + (f.wifi.networks === 1 ? "" : "s") + " seen") : "Looking…", '<button data-ft="scan">Scan again</button>') +
        row("health", "Temperature, power and storage", (h.tempC != null ? cToF(h.tempC) + " °F (" + Math.round(h.tempC) + " °C)" : "temperature –") + " · power " + (h.underVoltage ? '<b class="bad">under-voltage now</b>' : h.underVoltageSinceBoot ? '<b class="bad">dipped since start</b>' : "OK") + " · " + (h.diskFreeMB != null ? (h.diskFreeMB / 1024).toFixed(1) + " GB free" : "storage –")) +
        row("sounds", "Sound banks", (f.banks || []).length ? f.banks.length + " installed" : '<span class="bad">none found</span>') + "</section>" +
      "</div>" +
      '<footer class="ft-foot"><span class="muted">' + (saved ? "Report saved " + esc(saved.saved) : "Not saved yet") + '</span><span class="ft-actions"><button data-ft="restart">Restart (stays in the test)</button><button data-ft="save">Save report</button><button class="primary" data-ft="finish">Finish</button></span></footer>';
    if (focus) { var el = dlg.querySelector('[data-ft-focus="' + focus + '"]'); if (el) el.focus(); }
  }

  // ------------------------------------------------------------- actions
  function playOut(bus) {
    if (bus === "instrument") {
      var I = window.PPInstrument, before = I && I.kind ? I.kind() : null;
      if (I && before !== "keys") I.setKind("keys");
      setTimeout(function () { [60, 64, 67].forEach(function (n) { send({ type: "instrument", action: "note", on: true, note: n, velocity: 100 }); }); }, 700);
      setTimeout(function () { [60, 64, 67].forEach(function (n) { send({ type: "instrument", action: "note", on: false, note: n, velocity: 0 }); }); if (I && before && before !== "keys") I.setKind(before); }, 2300);
      return;
    }
    if (PP.engine && PP.engine.testBus) PP.engine.testBus(bus);
  }
  async function listen() {
    if (meter) { meter.stop(); meter = null; render(); return; }
    try {
      var stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      var ctx = new (window.AudioContext || window.webkitAudioContext)(), an = ctx.createAnalyser(); an.fftSize = 2048; ctx.createMediaStreamSource(stream).connect(an);
      var data = new Float32Array(an.fftSize), raf = 0, peak = -90;
      var tick = function () { an.getFloatTimeDomainData(data); var m = 0; for (var i = 0; i < data.length; i++) m = Math.max(m, Math.abs(data[i])); var db = m > 0 ? 20 * Math.log10(m) : -90; peak = Math.max(db, peak - 0.6);
        var bar = document.getElementById("ftIn"), t = document.getElementById("ftInDb"); if (bar) bar.style.width = Math.max(0, Math.min(100, (peak + 60) / 60 * 100)) + "%"; if (t) t.textContent = peak.toFixed(0) + " dBFS";
        if (db > -30) mark("input", "pass", true); raf = requestAnimationFrame(tick); };
      meter = { stop: function () { cancelAnimationFrame(raf); stream.getTracks().forEach(function (x) { x.stop(); }); ctx.close(); } };
      render(); tick();
    } catch (e) { PP.setStatus("The input can't be opened: " + e.message); }
  }
  function report() { var out = {}; allKeys().forEach(function (k) { out[k] = (results[k] || {}).status || "untested"; }); out._analog = analog; return out; }
  function click(e) {
    var b = e.target.closest("button"); if (!b) return;
    if (b.dataset.ftMark) { results[b.dataset.ftMark] = { status: b.dataset.v, auto: false }; render(); return; }
    if (b.dataset.ftPlay) { playOut(b.dataset.ftPlay); return; }
    var a = b.dataset.ft;
    if (a === "pattern") send({ type: "factory", action: "pattern", on: !(st && st.pattern) });
    else if (a === "calibrate") { send({ type: "hardware", action: "calibrateTouch" }); PP.setStatus("Touch the five crosses on the small screen, then tap the dot and SAVE"); }
    else if (a === "screen") { var v = (dlg.querySelector("#ftScreen") || {}).value || "off"; if (!confirm("Use this touch screen? The pedal restarts and comes back into this test.")) return; busy = "Setting up the screen…"; send({ type: "factory", action: "screen", value: v, restart: true }); render(); }
    else if (a === "listen") listen();
    else if (a === "scan") { send({ type: "factory", action: "scan" }); }
    else if (a === "save") { busy = "Saving…"; send({ type: "factory", action: "report", results: report() }); }
    else if (a === "finish") { var n = counts(); if (n.todo && !confirm(n.todo + " part" + (n.todo === 1 ? " isn't" : "s aren't") + " tested yet. Finish anyway?")) return; send({ type: "factory", action: "report", results: report() }); send({ type: "factory", action: "finish" }); if (st) st.finished = true; if (meter) { meter.stop(); meter = null; } render(); }
    else if (a === "reopen") { if (st) st.finished = false; render(); }
    else if (a === "restart") { if (confirm("Restart the pedal? It comes back into this test.")) send({ type: "factory", action: "restart" }); }
    else if (a === "poweroff") { send({ type: "system", action: "shutdown" }); dlg.innerHTML = '<div class="ft-done"><h1>Powering off…</h1><p>When the green light stops, unplug it. The next start is the customer\'s.</p></div>'; }
  }
  function change() { }

  // ------------------------------------------------------------- look
  var css = document.createElement("style");
  css.textContent = [
    "dialog.ft{position:fixed;inset:0;width:100vw;height:100vh;max-width:none;max-height:none;margin:0;padding:0;border:0;background:#111317;color:#ECE7DD;overflow:auto;font-size:15px}",
    "dialog.ft::backdrop{background:#111317}",
    ".ft-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-end;padding:18px 24px 10px;border-bottom:1px solid #343A44;position:sticky;top:0;background:#111317;z-index:1}",
    ".ft-head h1{margin:0;font-size:24px}.ft-head p{margin:4px 0 0;color:#9AA1AB}.ft-sum{font-size:18px;white-space:nowrap}",
    ".ft-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,520px),1fr));gap:14px;padding:14px 24px 90px;align-items:start}",
    ".ft section{background:#1A1D22;border:1px solid #343A44;border-radius:12px;padding:14px 16px}.ft h2{margin:0 0 6px;font-size:17px}",
    ".ft-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto auto;gap:8px 10px;align-items:center;padding:8px 0;border-top:1px solid #262a31}",
    ".ft-what{display:grid;gap:3px;min-width:0}.ft-detail{color:#9AA1AB;font-size:13px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}",
    ".ft-badge{font-size:12px;font-weight:700;padding:3px 9px;border-radius:999px;background:#23272E;color:#9AA1AB;white-space:nowrap}.ft-badge.pass{background:rgba(34,128,92,.25);color:#7FD1A8}.ft-badge.fail{background:rgba(200,70,63,.25);color:#F2A07B}.ft-badge.skip{color:#ECE7DD}",
    ".ft-pf{display:inline-flex;gap:4px}.ft button{font:inherit;font-size:13px;padding:6px 11px;border-radius:8px;border:1px solid #343A44;background:#23272E;color:#ECE7DD;cursor:pointer}",
    ".ft button:focus-visible,.ft select:focus-visible{outline:2px solid #E2C27E;outline-offset:2px}.ft button.primary{background:#E2C27E;color:#1A1408;border-color:#E2C27E;font-weight:700}",
    ".ft-sw{display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px}.ft-key{padding:14px 8px!important;font-size:14px!important}.ft-key.pass{background:#22805c!important;border-color:#22805c!important}.ft-key.fail{background:#60222e!important}",
    ".ft-meter{display:inline-block;width:180px;height:10px;border-radius:5px;background:#0C0E11;overflow:hidden;vertical-align:middle}.ft-meter.big{width:240px;height:14px}.ft-meter i{display:block;height:100%;width:0;background:linear-gradient(90deg,#3FBF78,#F5CF72 85%,#EF4B4B)}",
    ".ft-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-top:8px}.ft-pick{display:grid;gap:6px;margin-top:10px;color:#9AA1AB}.ft select{font:inherit;padding:8px;border-radius:8px;background:#0C0E11;color:#ECE7DD;border:1px solid #343A44;max-width:100%}",
    ".ft-foot{position:fixed;left:0;right:0;bottom:0;display:flex;justify-content:space-between;align-items:center;gap:12px;padding:12px 24px;background:#1A1D22;border-top:1px solid #343A44}.ft-foot .ft-actions{margin:0}",
    ".ft .muted{color:#9AA1AB}.ft .small{font-size:12px}.ft .bad{color:#F2A07B}",
    ".ft-done{max-width:640px;margin:12vh auto;padding:0 24px;display:grid;gap:10px}.ft-done h1{font-size:30px;margin:0}.ft-done h2{font-size:20px;margin:16px 0 0}.ft-done p{color:#C9C3B8;line-height:1.5}"
  ].join("\n");
  document.head.appendChild(css);

  window.PPFactory = { active: active, open: open, results: function () { return results; }, status: function () { return st; } };
})();
