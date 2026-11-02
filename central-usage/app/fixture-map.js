/* Central Control - what each channel of a real light gets (10.2). The lighting engine (lights.js write()) works out
 * a light's colour, level, strobe and position; this turns that into the DMX value for each channel of the light's
 * profile, using what the profile says about the channel (its "cv" values from the fixture library):
 *   - a shutter: its "open" value when it isn't strobing (a real moving head is dark with its shutter at 0), the
 *     strobe rate spread over the profile's own slow → fast range
 *   - a colour wheel: the slot nearest the colour asked for, or the open slot for white
 *   - gobo, prism, frost, iris: open / out unless the scene programmed them (lights-programmer.js)
 *   - cyan / magenta / yellow mixing, zoom, focus, colour temperature, dimmer fine
 *   - anything else: the channel's resting value
 * A generic profile (no values) keeps the engine's own value, so the built-in fixture types behave as before. */
(function (global) {
  "use strict";
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function hexRgb(h) { var m = /^#?([0-9a-f]{6})$/i.exec(String(h || "")); if (!m) return [1, 1, 1]; var n = parseInt(m[1], 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }
  function nearestSlot(slots, r, g, b) {
    var mx = Math.max(r, g, b, 1e-6), R = r / mx, G = g / mx, B = b / mx, best = null, bd = 1e9;
    for (var i = 0; i < slots.length; i++) { var c = hexRgb(slots[i][1]), cm = Math.max(c[0], c[1], c[2], 1e-6), d = Math.pow(R - c[0] / cm, 2) + Math.pow(G - c[1] / cm, 2) + Math.pow(B - c[2] / cm, 2); if (d < bd) { bd = d; best = slots[i]; } }
    return best;
  }
  var EXTRA_TYPES = { zoom: 1, focus: 1, iris: 1, gobo: 1, goborot: 1, prism: 1, prismrot: 1, frost: 1, ctemp: 1, wheel: 1 };
  // one channel: the engine's value v (0-255) for the job type, the light's state src (0-1 values), the profile p
  function channel(f, p, i, type, src, v) {
    var e = p && p.src, info = e && e.cv ? e.cv[i] : null;
    var x = global.CULightsProg && EXTRA_TYPES[type] ? global.CULightsProg.extras(f.id) : null;
    if (x && x[type] != null) {
      if (type === "wheel" && typeof x.wheel === "number") return clamp(Math.round(x.wheel), 0, 255);
      if (type === "gobo" || type === "prism") return clamp(Math.round(x[type]), 0, 255);   // (a dmx value: a slot, or the prism's "in")
      return clamp(Math.round(x[type] * 255), 0, 255);
    }
    switch (type) {
      case "strobe":
        if (!info) return v;
        if (!(src.strobe > 0)) return info.o != null ? info.o : 0;
        if (info.s) { var rate = clamp((src.strobe * 255 - 10) / 245, 0, 1); return Math.round(info.s[0] + rate * (info.s[1] - info.s[0])); }
        return v;
      case "wheel":
        if (!info) return v;
        var mx = Math.max(src.r, src.g, src.b), mn = Math.min(src.r, src.g, src.b);
        if (info.sl && info.sl.length && mx > 0.02 && (mn / mx < 0.82 || info.o == null)) { var s = nearestSlot(info.sl, src.r, src.g, src.b); if (s) return s[0]; }
        return info.o != null ? info.o : 0;
      case "gobo": case "prism": case "frost": case "iris": return info && info.o != null ? info.o : 0;
      case "goborot": case "prismrot": return info && info.d != null ? info.d : 0;
      case "zoom": return 128;
      case "focus": return info && info.d != null ? info.d : 128;
      case "ctemp": return info && info.d != null ? info.d : 0;
      case "c": return Math.round(clamp(1 - src.r, 0, 1) * 255);
      case "m": return Math.round(clamp(1 - src.g, 0, 1) * 255);
      case "y": return Math.round(clamp(1 - src.b, 0, 1) * 255);
      case "dimf": return Math.round(clamp(src.dim, 0, 1) * 65535) & 255;
      case "zero": return info && info.d != null ? info.d : v;
      default: return info && info.d != null && v === 0 && /^(speed|fan)$/.test(type) ? info.d : v;
    }
  }
  // the light's colour channels: CMY lights mix by taking colour away, so they need the colour without the dimmer
  function needsCmy(p) { return p && p.ch && p.ch.indexOf("c") >= 0; }
  global.CUFixtureMap = { channel: channel, nearestSlot: nearestSlot, needsCmy: needsCmy, hexRgb: hexRgb };
})(window);
