/* Central Pedal - colours of everything: a standard colour for each kind of section (the same on the
 * waveform, the section buttons, the stage display and Central Control), a colour per pad, and every
 * screen colour - all changeable in Settings → Appearance → Colours of everything. */
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
  }

  function render() {
    var root = document.querySelector("#colorsAll"); if (!root) return;
    function input(attr, key, value, label) { return '<label class="clr"><input type="color" ' + attr + '="' + key + '" value="' + esc(value) + '"><span>' + esc(label) + "</span></label>"; }
    root.innerHTML =
      '<h4>Screen</h4><div class="clr-grid">' + SCREEN.map(function (s) { return input("data-clr-screen", s[0], screen(s[0]), s[1]); }).join("") + "</div>" +
      '<h4>Sections <small>(waveform, section buttons, stage display, Central Control)</small></h4><div class="clr-grid">' + SECTIONS.map(function (s) { return input("data-clr-sec", s[0], store().sections[s[0]] || s[3], s[1]); }).join("") + "</div>" +
      '<h4>Pads</h4><div class="clr-grid">' + project().pads.map(function (pd, i) { return input("data-clr-pad", String(i), padColor(i), (i + 1) + " · " + pd.name); }).join("") + "</div>" +
      '<div class="row"><button data-clr-reset="sections">Standard section colours</button><button data-clr-reset="pads">Standard pad colours</button></div>';
  }
  function changed() { applyVars(); PP.persistSoon(); if (window.PPTracks) { window.PPTracks.render(); window.PPTracks.sendDisplay(); } if (PP.renderPerform) PP.renderPerform(); }
  document.addEventListener("input", function (e) {
    var el = e.target;
    if (el.dataset.clrScreen) { project().theme = project().theme || {}; project().theme[el.dataset.clrScreen] = el.value; PP.applyTheme(); changed(); }
    else if (el.dataset.clrSec) { store().sections[el.dataset.clrSec] = el.value; changed(); }
    else if (el.dataset.clrPad) { store().pads[Number(el.dataset.clrPad)] = el.value; changed(); }
  });
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-clr-reset]"); if (!b) return;
    if (b.dataset.clrReset === "sections") store().sections = {}; else store().pads = [];
    changed(); render();
  });
  window.PPColors = { SECTIONS: SECTIONS, typeOf: typeOf, section: sectionColor, pad: padColor, sectionTable: sectionTable, apply: applyVars, render: render };
  setTimeout(function () { applyVars(); render(); }, 0);
})();
