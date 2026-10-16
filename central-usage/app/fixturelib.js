/* Central Usage - fixture definitions from the big public libraries, turned into the channel lists the
 * lighting engine uses (dim, r, g, b, w, a, uv, strobe, pan, panf, tilt, tiltf, speed, wheel, gobo, prism,
 * focus, haze, fan, zero). Reads:
 *   - QLC+ fixture files (.qxf, XML) - QLC+ ships thousands in /usr/share/qlcplus/fixtures
 *   - Open Fixture Library files (.json, open-fixture-library.org → a fixture → Download → OFL JSON)
 * One entry per mode ("Chauvet SlimPAR 56 — 7 channel"). Unknown channels become "zero" (held at 0). */
(function (global) {
  "use strict";
  function norm(s) { return String(s || "").toLowerCase(); }
  // a channel described by its name (and QLC+ group / preset, or OFL capability type)
  function typeOf(name, group, preset, byte) {
    var n = norm(name), g = norm(group), p = norm(preset), fine = byte === 1 || /fine|lsb|16.?bit low/.test(n) || /fine$/.test(p);
    if (/^pan/.test(p) || g === "pan" || (/\bpan\b/.test(n) && !/speed|tilt/.test(n))) return fine ? "panf" : "pan";
    if (/^tilt/.test(p) || g === "tilt" || (/\btilt\b/.test(n) && !/speed|pan/.test(n))) return fine ? "tiltf" : "tilt";
    if (fine) return "zero";
    if (/intensityred$|^red$/.test(p) || /^(red|r)\b/.test(n)) return "r";
    if (/intensitygreen$/.test(p) || /^(green|g)\b/.test(n)) return "g";
    if (/intensityblue$/.test(p) || /^(blue|b)\b/.test(n)) return "b";
    if (/intensitywhite$/.test(p) || /^(cool |warm )?white\b|^w\b/.test(n)) return "w";
    if (/intensityamber$/.test(p) || /^amber\b|^a\b/.test(n)) return "a";
    if (/intensityuv$/.test(p) || /\buv\b|ultra ?violet/.test(n)) return "uv";
    if (/intensitymasterdimmer$|intensitydimmer$/.test(p) || /dimmer|master|intensity|brightness/.test(n)) return "dim";
    if (g === "shutter" || /shutterstrobe|strobe/.test(p) || /strobe|shutter/.test(n)) return "strobe";
    if (/speedpantilt|pan.?tilt.?speed|^speed/.test(p) || /p\/?t speed|pan.?tilt speed|movement speed|^speed/.test(n)) return "speed";
    if (g === "gobo" || /gobo/.test(n)) return "gobo";
    if (g === "prism" || /prism/.test(n)) return "prism";
    if (/focus/.test(n) || /beamfocus/.test(p)) return "focus";
    if (/colou?r ?wheel|colou?rmacro|^colou?r$/.test(n) || /colormacro|colorwheel/.test(p) || g === "colour") return "wheel";
    if (/fog|haze|smoke|output|pump/.test(n) && !/fan/.test(n)) return "haze";
    if (/\bfan\b/.test(n)) return "fan";
    if (g === "intensity") return "dim";
    return "zero";
  }
  function finish(maker, model, modes, source) {
    return modes.filter(function (m) { return m.ch.length; }).map(function (m) {
      var mover = m.ch.indexOf("pan") >= 0 || m.ch.indexOf("tilt") >= 0, haze = m.ch.indexOf("haze") >= 0 && m.ch.indexOf("r") < 0 && m.ch.indexOf("dim") < 0;
      return { id: "lib:" + (maker + "-" + model + "-" + m.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 80), maker: maker, model: model, mode: m.name, name: maker + " " + model + " — " + m.name + " (" + m.ch.length + " ch)", ch: m.ch, mover: mover, haze: haze, source: source };
    });
  }
  // ---- QLC+ .qxf
  function parseQxf(text) {
    var doc = new DOMParser().parseFromString(text, "application/xml");
    if (doc.getElementsByTagName("parsererror").length) throw new Error("not a QLC+ fixture file");
    function tag(el, name) { var t = el.getElementsByTagName(name)[0]; return t ? t.textContent.trim() : ""; }
    var root = doc.documentElement, maker = tag(root, "Manufacturer") || "Unknown", model = tag(root, "Model") || "Fixture", chans = {};
    Array.prototype.forEach.call(root.getElementsByTagName("Channel"), function (c) {
      if (c.parentNode !== root) return;   // the <Channel> definitions (mode channels are references)
      var grp = c.getElementsByTagName("Group")[0];
      chans[c.getAttribute("Name")] = typeOf(c.getAttribute("Name"), grp ? grp.textContent : "", c.getAttribute("Preset") || "", grp ? Number(grp.getAttribute("Byte") || 0) : 0);
    });
    var modes = Array.prototype.map.call(root.getElementsByTagName("Mode"), function (m) {
      var list = Array.prototype.filter.call(m.getElementsByTagName("Channel"), function (c) { return c.parentNode === m; }).sort(function (a, b) { return Number(a.getAttribute("Number")) - Number(b.getAttribute("Number")); });
      return { name: m.getAttribute("Name") || "Mode", ch: list.map(function (c) { return chans[c.textContent.trim()] || typeOf(c.textContent.trim(), "", "", 0); }) };
    });
    if (!modes.length) throw new Error("no modes in that QLC+ file");
    return finish(maker, model, modes, "QLC+");
  }
  // ---- Open Fixture Library .json
  function ofLType(name, ch) {
    var cap = ch && (ch.capability || (ch.capabilities && ch.capabilities[0])) || {}, t = norm(cap.type), color = norm(cap.color);
    if (t === "colorintensity") return { red: "r", green: "g", blue: "b", white: "w", "warm white": "w", "cold white": "w", amber: "a", uv: "uv", lime: "zero", cyan: "zero", magenta: "zero", yellow: "zero" }[color] || "zero";
    if (t === "intensity") return "dim";
    if (t === "shutterstrobe" || t === "strobespeed") return "strobe";
    if (t === "pan" || t === "pancontinuous") return "pan";
    if (t === "tilt" || t === "tiltcontinuous") return "tilt";
    if (t === "pantiltspeed") return "speed";
    if (t === "wheelslot" || t === "wheelrotation" || t === "colorpreset") return /gobo/i.test(name) ? "gobo" : "wheel";
    if (t === "prism") return "prism";
    if (t === "focus") return "focus";
    if (t === "fog" || t === "fogoutput") return "haze";
    return typeOf(name, "", "", 0);
  }
  function parseOfl(text, fileName) {
    var j = JSON.parse(text), avail = j.availableChannels || {}, map = {};
    Object.keys(avail).forEach(function (k) { var t = ofLType(k, avail[k]); map[k] = t; (avail[k].fineChannelAliases || []).forEach(function (f) { map[f] = t === "pan" ? "panf" : t === "tilt" ? "tiltf" : "zero"; }); });
    var maker = (j.manufacturer && j.manufacturer.name) || (fileName ? fileName.split(/[\/\\]/).slice(-2, -1)[0] : "") || j.manufacturerKey || "Fixture", model = j.name || "Fixture";
    var modes = (j.modes || []).map(function (m) { return { name: m.name || m.shortName || "Mode", ch: (m.channels || []).map(function (c) { return c == null ? "zero" : typeof c === "string" ? (map[c] || typeOf(c, "", "", 0)) : "zero"; }) }; });
    if (!modes.length) throw new Error("no modes in that fixture file");
    return finish(maker, model, modes, "Open Fixture Library");
  }
  function parse(name, text) {
    if (/\.json$/i.test(name) || /^\s*\{/.test(text)) return parseOfl(text, name);
    return parseQxf(text);
  }
  global.CUFixtureLib = { parse: parse, parseQxf: parseQxf, parseOfl: parseOfl, typeOf: typeOf };
})(window);
