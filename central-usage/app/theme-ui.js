/* Central Control / Central Usage - Settings → Colours. Our Studio look stays the default. Pick a preset to start
 * from, change any colour you like (every change shows straight away, the whole app is the preview) and press
 * "Back to our colours" to undo it all. Saved on this computer; the Instrument page follows along. */
(function () {
  "use strict";
  var CU = window.CentralUsage, T = window.CCTheme; if (!CU || !T) return;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  // [css variable, what it is] - grouped the way people think about the screen
  var GROUPS = [
    ["Background and panels", [["bg", "Background"], ["bg2", "Darkest background (tabs, wells)"], ["top1", "Top bar"], ["panel", "Panels and cards"], ["panel2", "Buttons"], ["panel3", "Buttons when you point at them"], ["well", "Boxes you type in"]]],
    ["Text and lines", [["text", "Text"], ["muted", "Small text"], ["dim", "Faint text"], ["line", "Lines and borders"], ["line2", "Lines you point at"]]],
    ["Highlights", [["accent", "Accent (on, selected, play)"], ["accentHi", "Accent, brighter"], ["accentText", "Text on the accent"], ["blue", "Second accent"], ["chord", "Chords on the chart"]]],
    ["Status", [["ok", "OK / connected"], ["good", "Good"], ["warn", "Careful"], ["bad", "Problem"], ["danger", "Stop / delete"], ["live", "Live / on air"]]],
    ["Meters", [["meterLow", "Meters: normal"], ["meterMid", "Meters: loud"], ["meterHigh", "Meters: too loud"]]]
  ];
  var KEYS = []; GROUPS.forEach(function (g) { g[1].forEach(function (k) { KEYS.push(k[0]); }); });
  function saved() { var c = CU.store.get("colors", null); return c && typeof c === "object" ? c : { preset: "studio", custom: {} }; }
  function defaults() { var c = saved(), p = T.PRESETS.filter(function (x) { return x.id === c.preset; })[0] || T.PRESETS[0]; return T.derive(p.base, "control"); }
  function current() { return Object.assign({}, defaults(), saved().custom || {}); }
  function isDefault() { var c = saved(); return (c.preset || "studio") === "studio" && !Object.keys(c.custom || {}).length; }
  // the Instrument page (a frame with the Central Pedal's own colour names)
  var PEDAL = { bg: "bg", panel: "panel", panel2: "panel2", line: "line", text: "text", muted: "muted", accent: "accent", accentText: "accentText", blue: "blue", danger: "danger", well: "field" };
  function toFrame(vars) {
    var f = document.getElementById("instFrame"); var doc = null; try { doc = f && f.contentDocument; } catch (_) { doc = null; } if (!doc || !doc.documentElement) return;
    var out = {}; Object.keys(PEDAL).forEach(function (k) { if (vars[k]) out[PEDAL[k]] = vars[k]; });
    if (isDefault()) T.clear(Object.keys(out), doc.documentElement); else T.apply(out, doc.documentElement);
  }
  function apply() {
    var vars = current();
    if (isDefault()) T.clear(KEYS); else T.apply(vars);
    document.documentElement.style.colorScheme = T.isLight(vars.bg) ? "light" : "dark";
    toFrame(vars);
  }
  function save(c) { CU.store.set("colors", c); apply(); }
  function card() {
    var c = saved(), vars = current();
    return '<section class="card cl-card"><h3>Colours</h3><p class="muted">Start from a look, then change any colour you like. Everything changes as you go, so the app itself is the preview.</p>' +
      '<div class="cl-presets">' + T.PRESETS.map(function (p) { var d = T.derive(p.base, "control"); return '<button class="cl-chip' + (c.preset === p.id && !Object.keys(c.custom || {}).length ? " on" : "") + '" data-cl-preset="' + p.id + '" style="--c1:' + d.bg + ";--c2:" + d.panel + ";--c3:" + d.accent + ";--c4:" + d.blue + '"><i></i>' + esc(p.name) + "</button>"; }).join("") + "</div>" +
      '<div class="cl-sample" aria-hidden="true"><span class="cl-s-panel"><b>Sample</b> <span class="muted">small text</span></span><button>Button</button><button class="primary">Play</button><span class="cl-s-meter"><i></i></span><span class="cl-s-chord">G</span></div>' +
      GROUPS.map(function (g) { return "<h4>" + esc(g[0]) + '</h4><div class="cl-grid">' + g[1].map(function (k) { return '<label class="cl-one' + (c.custom && c.custom[k[0]] ? " changed" : "") + '"><input type="color" data-cl="' + k[0] + '" value="' + esc(T.hex(vars[k[0]]) || "#000000") + '"><span>' + esc(k[1]) + "</span></label>"; }).join("") + "</div>"; }).join("") +
      '<div class="row"><button data-cl-reset' + (isDefault() ? " disabled" : "") + '>Back to our colours</button></div></section>';
  }
  function rerender() { if (window.CUSettings) window.CUSettings.render(); }
  document.addEventListener("input", function (e) {
    var k = e.target && e.target.dataset && e.target.dataset.cl; if (!k) return;
    var c = saved(); c.custom = c.custom || {}; c.custom[k] = e.target.value; save(c);
    var l = e.target.closest(".cl-one"); if (l) l.classList.add("changed");
    var r = document.querySelector("[data-cl-reset]"); if (r) r.disabled = false;
  });
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-cl-preset],[data-cl-reset]"); if (!b) return;
    if (b.hasAttribute("data-cl-reset")) { if (!confirm("Put every colour back to our Studio look?")) return; save({ preset: "studio", custom: {} }); }
    else save({ preset: b.dataset.clPreset, custom: {} });
    rerender();
  });
  var frame = document.getElementById("instFrame"); if (frame) frame.addEventListener("load", function () { toFrame(current()); });
  apply();
  window.CUColors = { card: card, apply: apply, current: current, KEYS: KEYS, reset: function () { save({ preset: "studio", custom: {} }); }, set: function (k, v) { var c = saved(); c.custom = c.custom || {}; c.custom[k] = v; save(c); }, preset: function (id) { save({ preset: id, custom: {} }); } };
})();
