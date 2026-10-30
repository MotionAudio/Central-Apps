/* Central apps - colours. Our own look stays the default; people can change any colour (Settings → Colours), start
 * from a preset, and go back to the default in one press. Shared by the Central Pedal app and Central Control /
 * Central Usage (copied into central-usage/app/shared by prepare-shared.sh).
 *   CCTheme.PRESETS            the looks to start from: {name, base: {bg, panel, text, accent, blue, line, danger}}
 *   CCTheme.derive(base, out)  the rest of the colours from those few (panels a step lighter, small text between
 *                              the text and the background, text on the accent dark or light, ...)
 *   CCTheme.mix / lighten / darken / readableOn / hex   small colour helpers */
(function (root) {
  "use strict";
  var W = typeof window !== "undefined" ? window : root;
  function hex(c) {
    c = String(c || "").trim();
    var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c); if (!m) return null;
    var h = m[1]; if (h.length === 3) h = h.split("").map(function (x) { return x + x; }).join("");
    return "#" + h.toLowerCase();
  }
  function rgb(c) { var h = hex(c) || "#000000"; return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
  function toHex(a) { return "#" + a.map(function (v) { v = Math.max(0, Math.min(255, Math.round(v))); return (v < 16 ? "0" : "") + v.toString(16); }).join(""); }
  function mix(a, b, t) { var x = rgb(a), y = rgb(b); return toHex([0, 1, 2].map(function (i) { return x[i] + (y[i] - x[i]) * t; })); }
  function lighten(c, t) { return mix(c, "#ffffff", t); }
  function darken(c, t) { return mix(c, "#000000", t); }
  function lum(c) { var a = rgb(c).map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2]; }
  function contrast(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function readableOn(c, dark, light) { dark = dark || "#1a1408"; light = light || "#ffffff"; return contrast(c, dark) >= contrast(c, light) ? dark : light; }
  function isLight(c) { return lum(c) > 0.4; }

  // the default is our own Motion Audio studio look (graphite, brass, warm white)
  var PRESETS = [
    { id: "studio", name: "Studio (our default)", base: { bg: "#111317", panel: "#1a1d22", text: "#ece7dd", accent: "#e2c27e", blue: "#8db5de", line: "#343a44", danger: "#ef6b63" } },
    { id: "midnight", name: "Midnight", base: { bg: "#08111d", panel: "#101e31", text: "#ecf7ff", accent: "#5de6b0", blue: "#75adff", line: "#294966", danger: "#ff6b6b" } },
    { id: "warm", name: "Worship warm", base: { bg: "#140f0c", panel: "#241a14", text: "#fff4e8", accent: "#ffb45c", blue: "#f08a6a", line: "#4a3326", danger: "#ff6b5b" } },
    { id: "stage", name: "Stage black", base: { bg: "#000000", panel: "#0d0d0d", text: "#f2f2f2", accent: "#ff4d6d", blue: "#8aa4ff", line: "#2a2a2a", danger: "#ff4d4d" } },
    { id: "forest", name: "Forest", base: { bg: "#07140f", panel: "#0f2419", text: "#eafff3", accent: "#8df0a8", blue: "#7ed0ff", line: "#214433", danger: "#ff7a6b" } },
    { id: "royal", name: "Royal", base: { bg: "#0e0a1f", panel: "#1a1333", text: "#f3ecff", accent: "#d7a8ff", blue: "#8fb5ff", line: "#3b2d63", danger: "#ff6b8a" } },
    { id: "daylight", name: "Daylight", base: { bg: "#f2f5f8", panel: "#ffffff", text: "#102033", accent: "#0f9d72", blue: "#2f6fe0", line: "#c9d6e3", danger: "#d63b35" } },
    { id: "contrast", name: "High contrast", base: { bg: "#000000", panel: "#101010", text: "#ffffff", accent: "#ffee00", blue: "#00e5ff", line: "#666666", danger: "#ff3b3b" } }
  ];
  // every colour from the few a preset sets; out: "control" (Central Control / Usage names) or "pedal" (the Central Pedal's)
  function derive(base, out) {
    var b = Object.assign({}, PRESETS[0].base, base || {}), light = isLight(b.bg), step = light ? darken : lighten;
    var t = {
      bg: b.bg, bg2: light ? darken(b.bg, 0.04) : darken(b.bg, 0.35), panel: b.panel, panel2: step(b.panel, light ? 0.05 : 0.05), panel3: step(b.panel, light ? 0.1 : 0.1),
      line: b.line, line2: step(b.line, 0.12), text: b.text, muted: mix(b.text, b.bg, 0.4), dim: mix(b.text, b.bg, 0.55),
      accent: b.accent, accentHi: light ? darken(b.accent, 0.12) : lighten(b.accent, 0.3), accentText: readableOn(b.accent), brass: darken(b.accent, 0.12),
      blue: b.blue, danger: b.danger, chord: light ? darken(b.accent, 0.2) : mix(b.accent, "#f5cf72", 0.6), ok: light ? "#1e8e55" : "#6fcf97", well: light ? lighten(b.bg, 0.6) : darken(b.bg, 0.15),
      top1: step(b.bg, light ? 0.02 : 0.04), top2: b.bg, good: light ? "#1e9e4a" : "#2fd15a", warn: light ? "#b57900" : "#f0b429", bad: b.danger, live: light ? "#c8262c" : "#d92f35",
      meterLow: light ? "#2a9d5c" : "#3fbf78", meterMid: light ? "#c99a1a" : "#f5cf72", meterHigh: light ? "#d63b35" : "#ef4b4b"
    };
    if (out === "pedal") return { bg: t.bg, panel: t.panel, panel2: t.panel2, line: t.line, text: t.text, muted: t.muted, accent: t.accent, accentText: t.accentText, blue: t.blue, danger: t.danger, field: t.well, meterMid: t.meterMid, wave: t.text, playhead: light ? "#000000" : "#ffffff", hit: t.chord };
    return t;
  }
  function apply(vars, el) {
    var st = (el || W.document.documentElement).style;
    Object.keys(vars || {}).forEach(function (k) { if (vars[k]) st.setProperty("--" + k, vars[k]); });
  }
  function clear(keys, el) { var st = (el || W.document.documentElement).style; (keys || []).forEach(function (k) { st.removeProperty("--" + k); }); }

  W.CCTheme = { PRESETS: PRESETS, derive: derive, apply: apply, clear: clear, hex: hex, mix: mix, lighten: lighten, darken: darken, readableOn: readableOn, contrast: contrast, isLight: isLight };
  if (typeof module === "object" && module.exports) module.exports = W.CCTheme;
})(this);
