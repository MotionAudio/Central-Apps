/* Central Production - Ctrl+P / ⌘P search everything (10.2, docs/DESIGN-SYSTEM.md; Ctrl+K until 10.8): start any kind of
 * project, the File menu's actions, the DAW's (play, record, add a track, the mixer…), Settings' pages, and the sounds in
 * the browser. The box itself is shared with Central Control and Central Usage (../daw/command-palette.js).
 * (10.8) Ctrl+K / ⌘K is the pop-up keyboard (../daw/keys-popup.js): it plays the DAW's selected instrument track (the DAW
 * registers itself), the Instrument you're building, or the Sample (across the keys, or a slice a key). */
(function () {
  "use strict";
  var CP = window.CP, K = window.CmdK; if (!CP || !K) return;
  function open() { return !!CP.project(); }
  function daw() { return window.CDawUI && document.querySelector(".cdaw") ? document.querySelector(".cdaw") : null; }
  function fileItem(i) { var b = document.getElementById("cpFile"); if (!b) return; b.click(); setTimeout(function () { var m = document.querySelector('#cpMenu [data-i="' + i + '"]'); if (m) m.click(); }, 0); }
  function dawAction(a) { var b = document.querySelector('.cd-top [data-a="' + a + '"]'); if (b) b.click(); }
  // new projects, one per kind
  K.register(function () {
    return Object.keys(CP.types).map(function (id) { var d = CP.types[id]; return { group: "New project", title: "New " + (d.name || id).toLowerCase(), sub: d.blurb || "", keywords: "new create make start " + id, run: function () { CP.create(id); } }; });
  });
  // the File menu
  K.register(function () {
    var a = [
      { group: "File", title: "Open…", keywords: "open file project cmproj", run: function () { fileItem(1); } },
      { group: "File", title: "Open from my account…", keywords: "open cloud account projects", run: function () { fileItem(2); } },
      { group: "File", title: "Settings", sub: "Sound plans, audio, MIDI, updates", keywords: "settings preferences options", run: function () { window.CPSettings.open(); } }
    ];
    if (open()) {
      a.push({ group: "File", title: "Save", keywords: "save", run: function () { CP.save(); } });
      a.push({ group: "File", title: "Save as a file…", keywords: "save as export cmproj", run: function () { CP.saveAsFile(); } });
      a.push({ group: "File", title: "Save to my account", keywords: "save cloud account", run: function () { CP.saveCloud(); } });
      a.push({ group: "File", title: "Publish…", sub: "To Make & sell or Central Tracks", keywords: "publish sell upload share", run: function () { window.CPPublish.open(); } });
      a.push({ group: "File", title: "Install into my apps", sub: "Central Control, Central Usage and this app", keywords: "install library my apps", run: function () { window.CPPublish.install(); } });
      var d = CP.types[CP.project().type] || {};
      (d.exports || []).forEach(function (x, i) { a.push({ group: "Export", title: x[0], keywords: "export download", run: function () { var b = document.querySelector('#cpTypeBar [data-exp="' + i + '"]'); if (b) b.click(); } }); });
    }
    return a;
  });
  // Settings' pages
  K.register(function () {
    return [["audio", "Audio: devices, buffer, latency"], ["midi", "MIDI & sound"], ["packages", "Sound plans"], ["about", "About Central Production"]].map(function (x) { return { group: "Settings", title: x[1], keywords: "settings " + x[0], run: function () { window.CPSettings.open(x[0]); } }; });
  });
  // the DAW, when a project with a timeline is open
  K.register(function () {
    if (!daw()) return [];
    return [["play", "Play / stop", "space transport"], ["rec", "Record", "record arm"], ["home", "Back to the start", "home rewind"], ["loop", "Loop on / off", "loop cycle"], ["click", "Click on / off", "metronome"],
      ["mixer", "Show the mixer", "mixer faders"], ["editor", "Show the editor", "piano roll editor"], ["browser", "Show the sounds browser", "sounds loops files"], ["zfit", "Show the whole song", "zoom fit"]]
      .filter(function (x) { return document.querySelector('.cd-top [data-a="' + x[0] + '"]'); })
      .map(function (x) { return { group: "Studio", title: x[1], keywords: x[2], run: function () { dawAction(x[0]); } }; });
  });
  // (10.8) the pop-up keyboard: the open project's own sound when it has one (Instrument, Sample)
  if (window.CKeys) {
    var typeDef = function () { var p = CP.project(); return p && CP.types[p.type]; };
    window.CKeys.target({
      id: "production-type", priority: 20,
      available: function () { var d = typeDef(); return !!(d && d.play && (!d.playable || d.playable())); },
      name: function () { var d = typeDef(), p = CP.project(); return (p && p.name ? p.name : "") + (d && d.playName ? " · " + d.playName() : ""); },
      noteOn: function (n, v) { var d = typeDef(); if (d && d.play) d.play(n, v); },
      noteOff: function (n) { var d = typeDef(); if (d && d.stop) d.stop(n); },
      hint: function () { var d = typeDef(); return !CP.project() ? "Open or start a project - a Track, Instrument or Sample - and the keys play it." : d && d.id === "sample" ? "Record or bring in a sound first, then the keys play it." : d && d.id === "instrument" ? "Add samples and the keys play them." : ""; }
    });
    K.register(function () { return [{ group: "Actions", title: "Show the keyboard", sub: (/Mac/.test(navigator.platform) ? "⌘K" : "Ctrl+K") + " · play with the mouse or the computer keys", keywords: "keyboard piano keys play notes musical typing midi", run: function () { window.CKeys.open(); } }]; });
  }
  var sb = document.getElementById("cpSearch"); if (sb) { sb.onclick = function () { K.open(); }; sb.title = "Search everything (" + (K.keyLabel ? K.keyLabel().replace(" ", "+") : "Ctrl+P") + ")"; var kb = sb.querySelector("kbd"); if (kb && K.keyLabel) kb.textContent = K.keyLabel(); }
  document.addEventListener("keydown", function (e) { if ((e.ctrlKey || e.metaKey) && e.key === ",") { e.preventDefault(); window.CPSettings.open(); } });
})();
