/* Central Pedal Control - what the pop-up keyboard plays (10.8; keys-popup.js, ⌘K / Ctrl+K):
 *   on the Instrument tab, its keys sound (the same note messages its own on-screen keys send to the instrument host),
 *   on the Pad tab, the selected pad in the key you press (it holds, as the pad keyboard always has - Stop ends it).
 * Only in the app on a computer (Central Pedal Control); the pedal's own screen keeps its buttons. */
(function () {
  "use strict";
  var K = window.CKeys; if (!K || !window.CCDesktop) return;
  function tab() { return window.PPShell && window.PPShell.currentTab ? window.PPShell.currentTab() : ""; }
  function bridge() { return window.__pedalBridge; }
  function send(m) { var b = bridge(); return b && b.send ? b.send(m) : false; }
  K.target({
    id: "pedal-instrument", priority: 15,
    available: function () { return tab() === "instrument" && !!(bridge() && bridge().connected); },
    name: function () { var I = window.PPInstrument, c = I && I.config ? I.config() : null, p = c && c.keys && c.keys.patch; return p && p.name ? p.name : "the keys sound"; },
    noteOn: function (n, v) { send({ type: "instrument", action: "note", on: true, note: n, velocity: v }); },
    noteOff: function (n) { send({ type: "instrument", action: "note", on: false, note: n, velocity: 0 }); },
    sustain: function (on) { send({ type: "instrument", action: "midi", data: [0xB0, 64, on ? 127 : 0] }); },
    hint: function () { var t = tab(); return t === "instrument" ? "The pedal's sound engine isn't running yet - give it a moment." : "Open the Instrument tab (Piano & keys) or the Pad tab and the keys play there."; }
  });
  K.target({
    id: "pedal-pads", priority: 14,
    available: function () { return tab() === "pads" && !!(window.PP && window.PP.engine); },
    name: function () { var P = window.PP, p = P && P.currentPad ? P.currentPad() : null; return (p && p.name ? p.name : "the selected pad") + " · the key you press (Stop ends it)"; },
    noteOn: function (n) { var P = window.PP; if (!P || !P.engine) return; P.engine.playPad(P.selected(), P.KEYS[n % 12]); },
    noteOff: function () { }
  });
  // the Pad tab's ⌨ Keyboard button opens this keyboard too
  document.addEventListener("click", function (e) { var b = e.target.closest && e.target.closest("#keyboardButton"); if (!b) return; e.preventDefault(); e.stopImmediatePropagation(); K.open(); }, true);
})();
