/* Central Control - the Instrument tab: the Central Pedal's Instrument page (guitar, bass and keys through
 * real pedals and sounds) running on this computer. The page lives in a frame (instrument.html, with the
 * Central Pedal's own files); its audio runs in the instrument host the app starts (services.js): the
 * Central Pedal's own host on Linux, or the built-in rig (cu-rig) on Windows / macOS - for that one this
 * tab also passes the MIDI keyboards through (Web MIDI), since the rig has no MIDI of its own. */
(function () {
  "use strict";
  var CU = window.CentralUsage, NAT = window.CU && window.CU.inst; if (!CU) return;
  var frame = document.getElementById("instFrame"), loaded = false;
  function post(m) { if (frame && frame.contentWindow) frame.contentWindow.postMessage({ cu: "inst", msg: m }, "*"); }
  window.addEventListener("message", function (e) {
    var d = e.data; if (!d || d.cu !== "inst-out") return;
    if (NAT) NAT.send(d.msg); else post({ type: "instrumentStatus", available: false, error: "The instrument plays in the Central Control app (not in a browser).", inputs: [], midiInputs: [], keysCatalog: [] });
  });
  // MIDI keyboards for the built-in rig: the app hears them (Web MIDI) and passes the notes on
  var midi = null, midiWant = "auto", rig = false;
  function midiNames() { var out = []; if (midi) midi.inputs.forEach(function (i) { out.push(i.name); }); return out; }
  function onMidi(e) { var d = e.data; if (!d || d.length < 2 || !rig) return; var st = d[0] & 0xF0; if (st !== 0x80 && st !== 0x90 && st !== 0xB0 && st !== 0xE0) return; if (midiWant !== "auto" && e.target && e.target.name !== midiWant) return; NAT.send({ type: "instrument", action: "midi", data: [d[0], d[1], d.length > 2 ? d[2] : 0] }); }
  function hookMidi() { if (!midi) return; midi.inputs.forEach(function (i) { i.onmidimessage = onMidi; }); }
  function startMidi() {
    if (midi || !navigator.requestMIDIAccess) return;
    navigator.requestMIDIAccess().then(function (a) { midi = a; hookMidi(); a.onstatechange = function () { hookMidi(); if (NAT) NAT.send({ type: "instrument", action: "status" }); }; if (NAT) NAT.send({ type: "instrument", action: "status" }); }).catch(function () { });
  }
  if (NAT) NAT.on(function (m) {
    if (m && m.type === "instrumentStatus") { rig = m.engine === "cu-rig"; if (rig) { startMidi(); m.midiInputs = midiNames(); } }
    post(m);
  });
  window.addEventListener("message", function (e) { var d = e.data; if (d && d.cu === "inst-out" && d.msg && d.msg.action === "keys" && d.msg.keys && d.msg.keys.midi) midiWant = d.msg.keys.midi; });
  // (10.8) the pop-up keyboard (⌘K, shared/daw/keys-popup.js) plays the keys sound here - in Central Usage (Central Control
  // keeps ⌘K for its search): the patch the page last picked, its name from the host's list of sounds
  var keysNow = { patch: null, kind: "off", catalog: [] };
  window.addEventListener("message", function (e) { var d = e.data; if (d && d.cu === "inst-out" && d.msg && d.msg.action === "keys" && d.msg.keys) keysNow.patch = d.msg.keys.patch || keysNow.patch; });
  if (NAT) NAT.on(function (m) { if (m && m.type === "instrumentStatus") { keysNow.kind = m.kind || keysNow.kind; if (m.keysCatalog && m.keysCatalog.length) keysNow.catalog = m.keysCatalog; } });
  if (window.CKeys && NAT && CU.edition && CU.edition() === "usage") {
    var sendNote = function (n, on, v) { if (!loaded) { loaded = true; NAT.start(); if (frame && !frame.src) frame.src = frame.dataset.src; } NAT.send({ type: "instrument", action: "note", on: on, note: n, velocity: on ? v : 0 }); if (window.CKeys) window.CKeys.light(n, on); };
    window.CKeys.target({
      id: "instrument", priority: 15,
      available: function () { return CU.prefs && CU.prefs.tab === "instrument"; },
      name: function () { var p = keysNow.patch; if (p && typeof p === "object" && p.name) return p.name; var hit = keysNow.catalog.filter(function (x) { return x && p && (x.id === p || x.file === p || x.name === p || x.id === p.id); })[0]; return hit ? hit.name : keysNow.kind === "keys" ? "the keys sound" : "the Instrument tab"; },
      noteOn: function (n, v) { sendNote(n, true, v); },
      noteOff: function (n) { sendNote(n, false, 0); },
      sustain: function (on) { NAT.send({ type: "instrument", action: "midi", data: [0xB0, 64, on ? 127 : 0] }); },
      hint: function () { return CU.prefs && (CU.prefs.tab === "instrument" || CU.prefs.tab === "studio") ? "" : "Open the Instrument tab or the Studio and the keys play there."; }
    });
  }
  // the sound plans (Central Keys, Plugins, Instrument, Pedals): which are active, for the locks in the frame
  function postPlans() { var L = window.PPLicense; post({ type: "plans", on: !!(L && L.on && L.on()), plans: L && L.plans ? L.plans() : {}, keeps: L && L.keepsList ? L.keepsList() : {} }); }
  window.addEventListener("pp-plans", postPlans);
  // the sound libraries installed on this computer (Settings → Packages → Libraries): their presets and boards, for the frame
  function postLibraries() { var L = window.CU && window.CU.libraries; if (L && L.list) L.list().then(function (r) { post({ type: "libraries", libraries: (r && r.installed) || [] }); }).catch(function () { }); }
  window.addEventListener("pp-libraries", postLibraries);
  // (10.4) the song's tempo (the Central Pedal's BPM), for the delays on the board that follow it
  var lastBpm = 0; setInterval(function () { var d = CU.state && CU.state.display, b = d && +d.bpm || 0; if (loaded && b > 0 && b !== lastBpm) { lastBpm = b; post({ type: "tempo", bpm: b }); } }, 1000);
  if (frame) frame.addEventListener("load", function () { setTimeout(postPlans, 0); setTimeout(postLibraries, 0); lastBpm = 0; });
  CU.on("tab", function (t) {
    if (t !== "instrument" || !frame) return;
    if (!loaded) { loaded = true; if (NAT) NAT.start(); frame.src = frame.dataset.src; }
    else { postPlans(); post({ type: "shown" }); }
  });
})();
