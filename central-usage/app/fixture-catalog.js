/* Central Control - the fixture catalogue (10.2): thousands of real lights from the Open Fixture Library (MIT) and the
 * QLC+ fixture definitions (Apache 2.0), searchable offline, plus the profiles a church makes itself.
 *
 *   CUFixtureCatalog.load()              → the library (unpacked once; a newer one downloaded with "Update the
 *                                          fixture library" wins over the one the app shipped with)
 *   CUFixtureCatalog.search(q, max)      → [{fx, maker, score}] by maker and model ("chauvet slimpar", "mac aura")
 *   CUFixtureCatalog.entry(fx, modeIdx)  → the entry the lights page keeps in its fixture library (rig.library):
 *                                          {id, maker, model, mode, name, ch: [jobs], cv: {channel: values}, mover, …}
 *   CUFixtureCatalog.toOfl(entry) / fromOfl(json)   → a profile as an Open Fixture Library file and back
 * A job is what a channel does for the lighting engine (dim r g b w a uv c m y ctemp strobe pan panf tilt tiltf speed
 * wheel gobo goborot prism prismrot focus zoom iris frost haze fan zero); see tools/make-fixture-library.py. */
(function (global) {
  "use strict";
  var JOBS = [
    ["dim", "Dimmer (brightness)"], ["dimf", "Dimmer fine"], ["r", "Red"], ["g", "Green"], ["b", "Blue"], ["w", "White"], ["a", "Amber"], ["uv", "UV"],
    ["c", "Cyan (colour mixing)"], ["m", "Magenta (colour mixing)"], ["y", "Yellow (colour mixing)"], ["ctemp", "Colour temperature (CTO / CTB)"],
    ["strobe", "Shutter / strobe"], ["pan", "Pan"], ["panf", "Pan fine"], ["tilt", "Tilt"], ["tiltf", "Tilt fine"], ["speed", "Pan/tilt speed"],
    ["wheel", "Colour wheel"], ["gobo", "Gobo wheel"], ["goborot", "Gobo rotation"], ["prism", "Prism"], ["prismrot", "Prism rotation"],
    ["focus", "Focus"], ["zoom", "Zoom"], ["iris", "Iris"], ["frost", "Frost"], ["haze", "Haze / fog output"], ["fan", "Fan (hazer)"], ["zero", "Nothing / leave alone"]];
  var JOB_NAME = {}; JOBS.forEach(function (j) { JOB_NAME[j[0]] = j[1]; });
  var lib = null, loading = null, index = null;

  function b64bytes(s) { var bin = atob(s), out = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
  async function gunzip(bytes) {
    if (typeof DecompressionStream === "undefined") throw new Error("this browser can't unpack the fixture library");
    var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    return await new Response(stream).text();
  }
  function loadScript(src) { return new Promise(function (res, rej) { var s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = function () { rej(new Error("couldn't load " + src)); }; document.head.appendChild(s); }); }
  function prepare(j) {
    if (!j || j.format !== "central-fixtures" || !Array.isArray(j.fixtures)) throw new Error("that isn't a fixture library");
    index = j.fixtures.map(function (f, k) { return { k: k, text: (j.makers[f.m] + " " + f.n).toLowerCase(), maker: j.makers[f.m] }; });
    return j;
  }
  async function load() {
    if (lib) return lib;
    if (loading) return loading;
    loading = (async function () {
      var FX = global.CU && global.CU.fixtures;
      if (FX && FX.library) { try { var t = await FX.library(); if (t) return (lib = prepare(JSON.parse(t))); } catch (_) { } }   // (a newer one downloaded by "Update")
      if (!global.CU_FIXTURE_LIBRARY) await loadScript("fixtures/fixture-library.js");
      var text = await gunzip(b64bytes(global.CU_FIXTURE_LIBRARY.gz));
      return (lib = prepare(JSON.parse(text)));
    })();
    try { return await loading; } finally { loading = null; }
  }
  function search(q, max) {
    if (!lib) return [];
    var words = String(q || "").toLowerCase().split(/\s+/).filter(Boolean), out = [];
    for (var i = 0; i < index.length; i++) {
      var it = index[i], score = 0, ok = true;
      for (var w = 0; w < words.length; w++) { var p = it.text.indexOf(words[w]); if (p < 0) { ok = false; break; } score += p === 0 || it.text.charAt(p - 1) === " " ? 2 : 1; }
      if (ok) out.push({ fx: lib.fixtures[it.k], maker: it.maker, score: score });
    }
    out.sort(function (a, b) { return b.score - a.score || a.maker.localeCompare(b.maker) || a.fx.n.localeCompare(b.fx.n); });
    return out.slice(0, max || 80);
  }
  function slug(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
  function entry(fx, modeIdx) {
    var m = fx.md[modeIdx > 0 && modeIdx < fx.md.length ? modeIdx : 0], ch = m.c.split(" "), maker = lib.makers[fx.m];
    var mover = ch.indexOf("pan") >= 0 || ch.indexOf("tilt") >= 0;
    return { id: "lib:" + (fx.s === "o" ? "ofl" : "qlc") + "-" + slug(maker + "-" + fx.n + "-" + m.n).slice(0, 90), maker: maker, model: fx.n, mode: m.n,
      name: maker + " " + fx.n + " — " + m.n + " (" + ch.length + " ch)", ch: ch, cv: m.v || {}, mover: mover, type: fx.t || "",
      panDeg: fx.p || (mover ? 540 : 0), tiltDeg: fx.i || (mover ? 270 : 0), beam: fx.b || null, watts: fx.w || null,
      source: fx.s === "o" ? "Open Fixture Library" : "QLC+" };
  }
  function describe(e) { return (e.ch || []).map(function (j, i) { return (i + 1) + " " + (JOB_NAME[j] || j); }).join(", "); }

  // ---- a profile as an Open Fixture Library file (export / import of your own profiles)
  var OFL_CAP = { dim: { type: "Intensity" }, dimf: null, r: { type: "ColorIntensity", color: "Red" }, g: { type: "ColorIntensity", color: "Green" }, b: { type: "ColorIntensity", color: "Blue" },
    w: { type: "ColorIntensity", color: "White" }, a: { type: "ColorIntensity", color: "Amber" }, uv: { type: "ColorIntensity", color: "UV" }, c: { type: "ColorIntensity", color: "Cyan" },
    m: { type: "ColorIntensity", color: "Magenta" }, y: { type: "ColorIntensity", color: "Yellow" }, ctemp: { type: "ColorTemperature", colorTemperatureStart: "warm", colorTemperatureEnd: "cold" },
    pan: { type: "Pan", angleStart: "0deg", angleEnd: "540deg" }, panf: null, tilt: { type: "Tilt", angleStart: "0deg", angleEnd: "270deg" }, tiltf: null,
    speed: { type: "PanTiltSpeed", speedStart: "fast", speedEnd: "slow" }, focus: { type: "Focus", distanceStart: "near", distanceEnd: "far" }, zoom: { type: "Zoom", angleStart: "narrow", angleEnd: "wide" },
    iris: { type: "Iris", openPercentStart: "open", openPercentEnd: "closed" }, frost: { type: "Frost", frostIntensityStart: "off", frostIntensityEnd: "high" },
    prismrot: { type: "PrismRotation", speedStart: "slow CW", speedEnd: "fast CW" }, goborot: { type: "WheelSlotRotation", speedStart: "slow CW", speedEnd: "fast CW" },
    haze: { type: "Fog", fogType: "Haze", fogOutputStart: "off", fogOutputEnd: "strong" }, fan: { type: "Generic", comment: "Fan" }, zero: { type: "NoFunction" } };
  function chanName(j, n) { return (JOB_NAME[j] || j).replace(/\s*\(.*\)$/, "") + (n > 1 ? " " + n : ""); }
  function toOfl(e) {
    var avail = {}, seen = {}, names = [], parent = {};
    (e.ch || []).forEach(function (j, i) {
      var n = seen[j] = (seen[j] || 0) + 1, name = chanName(j, n), v = (e.cv || {})[i] || {};
      names.push(name);
      if (j === "panf" || j === "tiltf" || j === "dimf") { var base = chanName(j === "panf" ? "pan" : j === "tiltf" ? "tilt" : "dim", 1); if (avail[base]) { avail[base].fineChannelAliases = (avail[base].fineChannelAliases || []).concat([name]); parent[name] = base; return; } }
      var ch = {};
      if (j === "strobe") {
        var caps = [], o = v.o != null ? v.o : 0, s = v.s || [10, 255], lo = Math.min(s[0], s[1]), hi = Math.max(s[0], s[1]);
        if (v.x != null) caps.push({ dmxRange: [v.x, v.x], type: "ShutterStrobe", shutterEffect: "Closed" });
        caps.push({ dmxRange: [o, o], type: "ShutterStrobe", shutterEffect: "Open" });
        caps.push({ dmxRange: [lo, hi], type: "ShutterStrobe", shutterEffect: "Strobe", speedStart: s[0] <= s[1] ? "slow" : "fast", speedEnd: s[0] <= s[1] ? "fast" : "slow" });
        ch.capabilities = fillGaps(caps);
      } else if (j === "wheel" || j === "gobo" || j === "prism") {
        var cs = [];
        if (v.o != null) cs.push({ dmxRange: [v.o, v.o], type: j === "prism" ? "NoFunction" : "WheelSlot", slotNumber: 1, comment: "Open" });
        (v.sl || []).forEach(function (sl, k) { cs.push({ dmxRange: [sl[0], sl[0]], type: "WheelSlot", slotNumber: k + 2, comment: sl[1] }); });
        if (!cs.length) cs.push({ dmxRange: [0, 255], type: j === "prism" ? "Prism" : "WheelSlot", slotNumber: 1 });
        ch.capabilities = fillGaps(cs);
      } else ch.capability = OFL_CAP[j] || OFL_CAP.zero;
      if (v.d != null) ch.defaultValue = v.d;
      avail[name] = ch;
    });
    return { $schema: "https://raw.githubusercontent.com/OpenLightingProject/open-fixture-library/master/schemas/fixture.json", name: e.model || e.name || "My fixture",
      categories: [e.mover ? "Moving Head" : "Color Changer"], meta: { authors: [e.author || "Central Control"], createDate: new Date().toISOString().slice(0, 10), lastModifyDate: new Date().toISOString().slice(0, 10) },
      manufacturer: { name: e.maker || "My lights" }, availableChannels: avail, modes: [{ name: e.mode || (e.ch.length + "-channel"), channels: names }] };
  }
  function fillGaps(caps) {
    caps = caps.slice().sort(function (a, b) { return a.dmxRange[0] - b.dmxRange[0]; });
    var out = [], at = 0;
    caps.forEach(function (c) { if (c.dmxRange[0] < at) return; if (c.dmxRange[0] > at) out.push({ dmxRange: [at, c.dmxRange[0] - 1], type: "NoFunction" }); out.push(c); at = c.dmxRange[1] + 1; });
    if (at <= 255) out.push({ dmxRange: [at, 255], type: "NoFunction" });
    return out;
  }
  function fromOfl(text, fileName) {   // an OFL file → one entry per mode, with the values (open, strobe range, colour slots)
    var es = global.CUFixtureLib.parseOfl(text, fileName), j = JSON.parse(text), avail = j.availableChannels || {};
    return es.map(function (e, k) {
      var mode = (j.modes || [])[k] || {}, cv = {};
      (mode.channels || []).forEach(function (cname, i) {
        var ch = avail[cname]; if (!ch) return; var caps = ch.capabilities || [], v = {};
        caps.forEach(function (c) {
          var r = c.dmxRange || [0, 255], m = Math.round((r[0] + r[1]) / 2);
          if (c.type === "ShutterStrobe") { if (c.shutterEffect === "Open" && v.o == null) v.o = m; else if (c.shutterEffect === "Closed" && v.x == null) v.x = m; else if (c.shutterEffect === "Strobe" && !v.s) v.s = c.speedStart === "fast" ? [r[1], r[0]] : [r[0], r[1]]; }
          else if (c.type === "WheelSlot" && /^open$/i.test(c.comment || "") && v.o == null) v.o = m;
          else if (c.type === "WheelSlot" && /^#[0-9a-f]{6}$/i.test(c.comment || "")) (v.sl = v.sl || []).push([m, c.comment]);
        });
        if (ch.defaultValue != null) v.d = ch.defaultValue;
        if (Object.keys(v).length) cv[i] = v;
      });
      e.cv = cv; e.id = "lib:mine-" + slug(e.maker + "-" + e.model + "-" + e.mode); e.source = "Imported"; return e;
    });
  }

  global.CUFixtureCatalog = { load: load, search: search, entry: entry, describe: describe, toOfl: toOfl, fromOfl: fromOfl, JOBS: JOBS, JOB_NAME: JOB_NAME,
    loaded: function () { return lib; }, info: function () { return lib ? { built: lib.built, fixtures: lib.fixtures.length, makers: lib.makers.length, modes: lib.fixtures.reduce(function (n, f) { return n + f.md.length; }, 0), sources: lib.sources } : null; },
    reset: function () { lib = null; index = null; } };
})(window);
