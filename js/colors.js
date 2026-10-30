/* Central Pedal - colours of everything: a standard colour for each kind of section (the same on the
 * waveform, the section buttons, the stage display and Central Control), a colour per pad, a colour per kind of
 * track, and every screen colour - all changeable in Settings → Appearance → Colours of everything, with
 * "Back to our colours" for all of it. The 3.5" screen follows the screen colours (unless that's switched off). */
(function () {
  "use strict";
  var PP = window.PP; if (!PP) return;
  function project() { return PP.project(); }
  var esc = PP.escapeHtml;

  // the standard section colour set (worship song forms)
  var SECTIONS = [
    ["intro", "Intro", /intro|count/i, "#6f8cff"],
    ["verse", "Verse", /verse/i, "#3fcf8e"],
    ["prechorus", "Pre-chorus / build", /pre[- ]?chorus|build|lift|channel/i, "#e7c53c"],
    ["chorus", "Chorus", /chorus|refrain|hook/i, "#ff6b4a"],
    ["bridge", "Bridge", /bridge/i, "#a57bff"],
    ["tag", "Tag / vamp", /tag|vamp|spontaneous/i, "#ff5fa8"],
    ["instrumental", "Instrumental / interlude", /instrumental|interlude|solo|turn ?around|break(?!down)/i, "#33c4e0"],
    ["breakdown", "Breakdown / quiet", /breakdown|drop|quiet|a ?cappella/i, "#7b8a9c"],
    ["outro", "Outro / ending", /outro|ending|end\b|coda/i, "#4f6bd1"],
    ["other", "Anything else", /.*/, "#5a7896"]
  ];
  var PAD_DEFAULTS = ["#e2c27e", "#7fb0e0", "#c4a3ec", "#ef9f62", "#ec7f8c", "#5fcac0", "#d8c25a", "#93a2ef"];   // (9.1.3: jewel tones for the graphite look)
  // screen colours: [css variable, label, default]
  var SCREEN = [
    ["bg", "Background", "#111317"], ["panel", "Panels", "#1a1d22"], ["panel2", "Buttons", "#23272e"], ["line", "Lines / borders", "#343a44"],
    ["text", "Text", "#ece7dd"], ["muted", "Small text", "#9aa1ab"], ["accent", "Accent (on / play)", "#e2c27e"], ["accentText", "Text on the accent", "#1a1408"],
    ["blue", "Second accent", "#8db5de"], ["danger", "Stop / warning", "#ef6b63"], ["field", "Boxes you type in", "#0e1013"],
    ["meterMid", "Meters: loud", "#f5cf72"], ["wave", "Waveform", "#ece7dd"], ["playhead", "Playhead", "#ffffff"], ["hit", "Hits on the timeline", "#f5cf72"]
  ];

  // tracks: the colour on top of each track's strip, by what it is
  var TRACKS = [["drums", "Drums", "#ff8a5c"], ["bass", "Bass", "#b98cff"], ["keys", "Keys", "#5cc8ff"], ["guitar", "Guitars", "#ffd15c"], ["vocals", "Vocals", "#ff6fae"], ["click", "Click and guide", "#9aa7b8"], ["music", "Everything else", ""]];
  var DEFAULT_THEME = { bg: "#111317", panel: "#1A1D22", text: "#ECE7DD", accent: "#E2C27E", blue: "#8DB5DE", line: "#343A44" };
  function store() { var p = project(); p.colors = p.colors || {}; p.colors.sections = p.colors.sections || {}; p.colors.pads = p.colors.pads || []; return p.colors; }
  function typeOf(name) { for (var i = 0; i < SECTIONS.length; i++) if (SECTIONS[i][2].test(name || "")) return SECTIONS[i][0]; return "other"; }
  function sectionColor(name) { var t = typeOf(name), c = store().sections[t]; if (c) return c; for (var i = 0; i < SECTIONS.length; i++) if (SECTIONS[i][0] === t) return SECTIONS[i][3]; return "#5a7896"; }
  function padColor(i) { return store().pads[i] || PAD_DEFAULTS[i % PAD_DEFAULTS.length]; }
  function screen(k) { var th = project().theme || {}; if (th[k]) return th[k]; for (var i = 0; i < SCREEN.length; i++) if (SCREEN[i][0] === k) return SCREEN[i][2]; return null; }
  function sectionTable() { var out = {}; SECTIONS.forEach(function (s) { out[s[0]] = store().sections[s[0]] || s[3]; }); return out; }
  function applyVars() {
    var root = document.documentElement.style;
    SECTIONS.forEach(function (s) { root.setProperty("--sec-" + s[0], store().sections[s[0]] || s[3]); });
    for (var i = 0; i < 8; i++) root.setProperty("--pad" + (i + 1), padColor(i));
    var tr = store().tracks || {};
    TRACKS.forEach(function (t) { if (tr[t[0]]) root.setProperty("--trk-" + t[0], tr[t[0]]); else root.removeProperty("--trk-" + t[0]); });
    sendMini();
  }
  // the 3.5" screen (the driver draws it): the same background, panels, text and accent
  var miniSent = "";
  function sendMini() {
    var b = window.__pedalBridge; if (!b || !b.connected || !b.send) return;
    var c = store(), on = c.mini !== false, th = project().theme || {};
    var custom = on && Object.keys(th).some(function (k) { var d = DEFAULT_THEME[k]; return d ? String(th[k]).toLowerCase() !== d.toLowerCase() : !!th[k]; });
    var colors = custom ? { bg: screen("bg"), bar: screen("panel"), text: screen("text"), muted: screen("muted"), accent: screen("accent"), on: screen("accent"), ontext: screen("accentText"), line: screen("line"), btn: screen("panel2"), warn: screen("danger"), idle: screen("panel2") } : null;
    var key = JSON.stringify(colors); if (key === miniSent) return; miniSent = key;
    b.send({ type: "miniTheme", colors: colors });
  }
  function resetAll() {
    var p = project(), root = document.documentElement.style;
    SCREEN.forEach(function (s) { root.removeProperty("--" + s[0]); });
    p.theme = JSON.parse(JSON.stringify(DEFAULT_THEME));
    var c = store(); c.sections = {}; c.pads = []; c.tracks = {};
    PP.applyTheme(); changed(); render();
    if (window.PPSettings && window.PPSettings.render) window.PPSettings.render();
  }

  function render() {
    var root = document.querySelector("#colorsAll"); if (!root) return;
    function input(attr, key, value, label) { return '<label class="clr"><input type="color" ' + attr + '="' + key + '" value="' + esc(value) + '"><span>' + esc(label) + "</span></label>"; }
    root.innerHTML =
      '<h4>Screen</h4><div class="clr-grid">' + SCREEN.map(function (s) { return input("data-clr-screen", s[0], screen(s[0]), s[1]); }).join("") + "</div>" +
      '<h4>Sections <small>(waveform, section buttons, stage display, Central Control)</small></h4><div class="clr-grid">' + SECTIONS.map(function (s) { return input("data-clr-sec", s[0], store().sections[s[0]] || s[3], s[1]); }).join("") + "</div>" +
      '<h4>Pads</h4><div class="clr-grid">' + project().pads.map(function (pd, i) { return input("data-clr-pad", String(i), padColor(i), (i + 1) + " · " + pd.name); }).join("") + "</div>" +
      '<h4>Tracks <small>(the colour on top of each track, by what it is)</small></h4><div class="clr-grid">' + TRACKS.map(function (t) { return input("data-clr-trk", t[0], (store().tracks || {})[t[0]] || t[2] || screen("accent"), t[1]); }).join("") + "</div>" +
      '<label class="toggle"><input type="checkbox" data-clr-mini' + (store().mini !== false ? " checked" : "") + '> The 3.5" screen uses these colours too</label>' +
      '<div class="row"><button data-clr-reset="sections">Standard section colours</button><button data-clr-reset="pads">Standard pad colours</button><button data-clr-reset="tracks">Standard track colours</button><button data-clr-reset="all">Back to our colours (everything)</button></div>';
  }
  function changed() { applyVars(); PP.persistSoon(); if (window.PPTracks) { window.PPTracks.render(); window.PPTracks.sendDisplay(); } if (PP.renderPerform) PP.renderPerform(); }
  document.addEventListener("input", function (e) {
    var el = e.target;
    if (el.dataset.clrScreen) { project().theme = project().theme || {}; project().theme[el.dataset.clrScreen] = el.value; PP.applyTheme(); changed(); }
    else if (el.dataset.clrSec) { store().sections[el.dataset.clrSec] = el.value; changed(); }
    else if (el.dataset.clrPad) { store().pads[Number(el.dataset.clrPad)] = el.value; changed(); }
    else if (el.dataset.clrTrk) { store().tracks = store().tracks || {}; store().tracks[el.dataset.clrTrk] = el.value; changed(); }
  });
  document.addEventListener("change", function (e) { if (e.target && e.target.hasAttribute && e.target.hasAttribute("data-clr-mini")) { store().mini = e.target.checked; miniSent = ""; changed(); } });
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-clr-reset]"); if (!b) return;
    if (b.dataset.clrReset === "all") { if (!confirm("Put every colour back to our Studio look?")) return; resetAll(); return; }
    if (b.dataset.clrReset === "sections") store().sections = {}; else if (b.dataset.clrReset === "tracks") store().tracks = {}; else store().pads = [];
    changed(); render();
  });
  if (window.PPFeatures) window.PPFeatures.on("hello", function () { miniSent = ""; setTimeout(sendMini, 300); });
  window.PPColors = { SECTIONS: SECTIONS, TRACKS: TRACKS, typeOf: typeOf, section: sectionColor, pad: padColor, sectionTable: sectionTable, apply: applyVars, render: render, resetAll: resetAll, sendMini: sendMini, DEFAULT_THEME: DEFAULT_THEME };
  setTimeout(function () { applyVars(); render(); }, 0);
})();
