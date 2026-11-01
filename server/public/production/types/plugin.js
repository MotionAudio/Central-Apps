/* Central Production - Plugin: an effect you build yourself, with blocks and wires (and code, for people who write it).
 * The builder itself is its own part of the app (plugin-builder/: window.CPPluginBuilder draws it, window.CMFx plays
 * it); this page loads it when it's in this build and keeps the plugin file:
 *   { format: "central-fx", version: 1, name, params: [...], graph: { blocks, wires }, code? }
 * It exports as a .cmfx.json, installs into your apps and publishes to Make & sell as a Plugin for every system. */
(function () {
  "use strict";
  var A = window.CPAudio, Z = window.CMProj, H = window.CPHost, S = window.CDaw;
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return window.CP.esc(s); }
  var ui = { el: null, loading: null, test: null };
  function D() { return window.CP.project().data; }
  // the builder: plugin-builder/manifest.json lists its scripts and styles (or plugin-builder/index.js on its own)
  function base() { var s = document.querySelector('script[src*="types/plugin.js"]'); return s ? s.src.replace(/types\/plugin\.js.*$/, "") : ""; }
  function addScript(src) { return new Promise(function (ok, bad) { var s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = function () { bad(new Error("missing " + src)); }; document.head.appendChild(s); }); }
  function addCss(href) { var l = document.createElement("link"); l.rel = "stylesheet"; l.href = href; document.head.appendChild(l); }
  function loadBuilder() {
    if (window.CPPluginBuilder) return Promise.resolve(true);
    if (ui.loading) return ui.loading;
    var root = base() + "plugin-builder/";
    ui.loading = fetch(root + "manifest.json").then(function (r) { if (!r.ok) throw new Error("no manifest"); return r.json(); })
      .then(function (m) { (m.styles || []).forEach(function (c) { addCss(root + c); }); return (m.scripts || []).reduce(function (p, s) { return p.then(function () { return addScript(root + s); }); }, Promise.resolve()); })
      .catch(function () { return addScript(root + "index.js").catch(function () { }); })
      .then(function () { return !!window.CPPluginBuilder; });
    return ui.loading;
  }
  function blank(name) { return { format: "central-fx", version: 1, name: name || "My effect", params: [], graph: { blocks: [], wires: [] }, code: "" }; }

  function mount(el) {
    ui.el = el;
    el.innerHTML = '<div class="cp-ed cp-plugin"><div class="cp-tools"><div class="cp-group"><b>Try it on</b><select id="pgSrc"><option value="drums">A drum loop</option><option value="chords">Keys chords</option><option value="guitar">A plucked line</option><option value="file">A file of my own…</option></select><button id="pgPlay">▶ Play through it</button><button id="pgStop">■</button><label class="toggle"><input type="checkbox" id="pgBypass"> Bypass</label></div>' +
      '<div class="cp-group"><button id="pgImport">Open a .cmfx.json…</button></div></div><div id="pgHost" class="cp-pg-host"><p class="muted">Loading the plugin builder…</p></div></div>';
    $("#pgPlay", el).onclick = tryIt; $("#pgStop", el).onclick = stopTry;
    $("#pgBypass", el).onchange = function () { if (ui.test) ui.test.bypass(this.checked); };
    $("#pgImport", el).onclick = function () { H.pickFiles(".json,.cmfx.json", false).then(function (fs) { if (!fs[0]) return; try { var j = JSON.parse(new TextDecoder().decode(fs[0].bytes)); if (j.format !== "central-fx") throw new Error(); window.CP.edit("Open plugin", function (d) { Object.keys(d).forEach(function (k) { delete d[k]; }); Object.assign(d, j); }); drawHost(); window.CP.toast("Opened " + fs[0].name + "."); } catch (_) { window.CP.toast("That isn't a Central Production plugin (.cmfx.json).", "bad"); } }); };
    loadBuilder().then(drawHost);
  }
  function drawHost() {
    var host = ui.el && $("#pgHost", ui.el); if (!host) return;
    if (!window.CPPluginBuilder) {
      host.innerHTML = '<div class="cp-card"><h3>The plugin builder isn\'t installed in this build</h3><p class="muted">You can still open, keep and publish a plugin file made elsewhere in Central Production. When the builder is here, this is where you drag blocks (filters, delays, drive, LFOs, knobs) and wire them up, or write the code yourself.</p>' +
        '<pre class="cp-json">' + esc(JSON.stringify(D(), null, 2)) + "</pre></div>";
      return;
    }
    host.innerHTML = "";
    try { window.CPPluginBuilder.mount(host, D(), { onChange: function (plugin) { window.CP.edit("Edit the plugin", function (d) { if (plugin && plugin !== d) { Object.keys(d).forEach(function (k) { delete d[k]; }); Object.assign(d, JSON.parse(JSON.stringify(plugin))); } }); if (ui.test) ui.test.update(D()); } }); }
    catch (e) { host.innerHTML = '<p class="err">The plugin builder couldn\'t open: ' + esc(e.message || e) + "</p>"; }
  }
  // a test sound through the plugin (window.CMFx makes the plugin's sound node)
  function testSource(c, kind) {
    var rate = c.sampleRate, secs = 4, b = c.createBuffer(2, rate * secs, rate), L = b.getChannelData(0), R = b.getChannelData(1), bpm = 100, beat = 60 / bpm;
    function add(at, fn, len) { var s = Math.round(at * rate); for (var i = 0; i < len * rate && s + i < L.length; i++) { var v = fn(i / rate); L[s + i] += v; R[s + i] += v; } }
    if (kind === "drums") for (var k = 0; k < secs / beat; k++) { add(k * beat, function (t) { return Math.sin(2 * Math.PI * (50 + 90 * Math.exp(-t * 30)) * t) * Math.exp(-t * 9) * (k % 2 ? 0.25 : 0.8); }, 0.4); if (k % 2) add(k * beat, function (t) { return (Math.random() * 2 - 1) * Math.exp(-t * 18) * 0.5; }, 0.25); add(k * beat + beat / 2, function (t) { return (Math.random() * 2 - 1) * Math.exp(-t * 60) * 0.2; }, 0.05); }
    else if (kind === "chords") [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]].forEach(function (ch, i) { ch.forEach(function (n) { var f = 440 * Math.pow(2, (n - 69) / 12); add(i, function (t) { return (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t)) * Math.exp(-t * 1.2) * 0.15; }, 1); }); });
    else [64, 67, 71, 74, 76, 74, 71, 67].forEach(function (n, i) { var f = 440 * Math.pow(2, (n - 69) / 12); add(i * 0.5, function (t) { var x = 2 * Math.PI * f * t; return (Math.sin(x) + 0.5 * Math.sin(2 * x) + 0.25 * Math.sin(3 * x)) * Math.exp(-t * 4) * 0.3; }, 0.5); });
    return Promise.resolve(b);
  }
  function tryIt() {
    var c = S.ctx(); if (c.state === "suspended") c.resume(); stopTry();
    if (!window.CMFx || !window.CMFx.create) return window.CP.toast("The plugin's sound engine isn't in this build, so it can't play here yet.", "bad");
    var kind = $("#pgSrc", ui.el).value;
    var src = kind === "file" ? H.pickFiles(null, false).then(function (fs) { if (!fs[0]) throw { canceled: true }; return Z.decode(c, fs[0].bytes); }) : testSource(c, kind);
    src.then(function (buf) {
      var node = window.CMFx.create(c, D()), s = c.createBufferSource(), dry = c.createGain(), wet = c.createGain(); s.buffer = buf; s.loop = true;
      var input = node.input || node, output = node.output || node;
      s.connect(input); output.connect(wet).connect(c.destination); s.connect(dry).connect(c.destination); dry.gain.value = 0;
      s.start();
      ui.test = { stop: function () { try { s.stop(); } catch (_) { } try { output.disconnect(); } catch (_) { } if (node.dispose) node.dispose(); },
        bypass: function (on) { dry.gain.value = on ? 1 : 0; wet.gain.value = on ? 0 : 1; },
        update: function (p) { if (node.update) node.update(p); else if (node.setPlugin) node.setPlugin(p); } };
      if ($("#pgBypass", ui.el).checked) ui.test.bypass(true);
    }).catch(function (e) { if (e && e.canceled) return; window.CP.toast("It couldn't play: " + (e.message || e), "bad"); });
  }
  function stopTry() { if (ui.test) { ui.test.stop(); ui.test = null; } }
  function file() { var d = JSON.parse(JSON.stringify(D())); d.name = window.CP.project().name; return { name: Z.slug(d.name, "plugin") + ".cmfx.json", data: new TextEncoder().encode(JSON.stringify(d, null, 1)), plugin: d }; }
  window.CP.type({
    id: "plugin", name: "Plugin", blurb: "Your own effect: blocks and wires, or code",
    long: "Build an effect from blocks (filters, delays, drive, modulation, knobs) wired together, or write it as code. It runs inside the apps' own sound engine, so it works on every computer and on the pedal, and it publishes to Make & sell as a Plugin.",
    create: function (opts) { return blank(opts.name); },
    load: function () { return loadBuilder(); },
    mount: mount, unmount: function () { stopTry(); if (window.CPPluginBuilder && window.CPPluginBuilder.unmount) try { window.CPPluginBuilder.unmount(); } catch (_) { } ui.el = null; },
    changed: function (label) { if (label === "undo" || label === "redo") drawHost(); },
    collect: function (project) { return { data: project.data, files: {} }; },
    exports: [["Export the plugin (.cmfx.json)", function () { var f = file(); return H.exportFiles(window.CP.project().name, [{ name: f.name, data: f.data }]); }, "Opens in Central Production on any computer"]],
    publish: { store: "make", kind: "plugin", build: function () { var f = file(); var g = f.plugin.graph || {}; if (!(g.blocks && g.blocks.length) && !(f.plugin.code && f.plugin.code.trim())) throw new Error("The plugin is empty: add some blocks (or code) first."); return { fx: f }; } },
    install: function () { return { fx: file() }; }
  });
})();
