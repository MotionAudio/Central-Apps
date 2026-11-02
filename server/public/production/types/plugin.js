/* Central Production - Plugin: an effect you build yourself, with blocks and wires (and code, for people who write it).
 * The builder itself is its own part of the app (plugin-builder/: window.CPPluginBuilder draws it, window.CMFx plays
 * it); this page loads it when it's in this build and keeps the plugin file:
 *   { format: "central-fx", version: 1, name, params: [...], graph: { blocks, wires }, code? }
 * Its own projects show in the DAW's insert picker (window.CDawPlugins, prod-core.js). It exports as a .cmfx.json, installs into your apps and publishes to Make & sell as a Plugin for every system. */
(function () {
  "use strict";
  var A = window.CPAudio, Z = window.CMProj, H = window.CPHost, S = window.CDaw;
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return window.CP.esc(s); }
  var ui = { el: null, test: null, b: null };
  function D() { return window.CP.project().data; }
  // the builder (production/plugin-builder/, copied to the website by tools/build-cmfx.sh): window.CPPluginBuilder draws it,
  // window.CMFx (cmfx/cmfx.js) plays it. Both load with the page; a build without them shows the plugin file instead.
  function loadBuilder() { return Promise.resolve(!!window.CPPluginBuilder); }
  function blank(name) { if (window.CPPluginBuilder) return window.CPPluginBuilder.blank(name || "My effect"); return { format: "central-fx", version: 1, name: name || "My effect", params: [], graph: { blocks: [], wires: [] } }; }

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
    if (ui.b) try { ui.b.unmount(); } catch (_) { }
    try {
      ui.b = window.CPPluginBuilder.mount(host, JSON.parse(JSON.stringify(D())), {
        onChange: function (plugin) {
          if (JSON.stringify(plugin) === JSON.stringify(D())) return;
          window.CP.edit("Edit the plugin", function (d) { Object.keys(d).forEach(function (k) { delete d[k]; }); Object.assign(d, JSON.parse(JSON.stringify(plugin))); });
          if (ui.test) ui.test.update(D());
        }
      });
    } catch (e) { host.innerHTML = '<p class="err">The plugin builder couldn\'t open: ' + esc(e.message || e) + "</p>"; }
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
      var s = c.createBufferSource(), dry = c.createGain(), wet = c.createGain(), fx = null, upd = null; s.buffer = buf; s.loop = true;
      function make(p) { var old = fx; fx = window.CMFx.create(c, p, { onError: function (e) { window.CP.toast("The plugin can't play: " + e, "bad"); } }); s.connect(fx.node); fx.node.connect(wet); if (old) fx.ready.then(function () { try { s.disconnect(old.node); } catch (_) { } old.dispose(); }); }
      make(D()); wet.connect(c.destination); s.connect(dry).connect(c.destination); dry.gain.value = 0;
      s.start();
      ui.test = { stop: function () { clearTimeout(upd); try { s.stop(); } catch (_) { } if (fx) fx.dispose(); },
        bypass: function (on) { dry.gain.value = on ? 1 : 0; wet.gain.value = on ? 0 : 1; },
        update: function (p) { clearTimeout(upd); upd = setTimeout(function () { if (window.CMFx.check(p).ok) make(p); }, 250); } };
      if ($("#pgBypass", ui.el).checked) ui.test.bypass(true);
    }).catch(function (e) { if (e && e.canceled) return; window.CP.toast("It couldn't play: " + (e.message || e), "bad"); });
  }
  function stopTry() { if (ui.test) { ui.test.stop(); ui.test = null; } }
  function file() { var d = JSON.parse(JSON.stringify(D())); d.name = window.CP.project().name; return { name: Z.slug(d.name, "plugin") + ".cmfx.json", data: new TextEncoder().encode(JSON.stringify(d, null, 1)), plugin: d }; }
  // your plugin projects, in the DAW's insert picker (projects kept on this computer or in this browser)
  if (window.CDawPlugins) window.CDawPlugins.add(function () {
    return H.local.list().then(function (list) {
      return Promise.all((list || []).filter(function (e) { return e.type === "plugin"; }).slice(0, 40).map(function (e) {
        return H.local.open(e.id).then(function (r) { return Z.unpack(r.bytes); }).then(function (u) { var pj = u.project; var d = pj && pj.data; if (!d || d.format !== "central-fx") return null; d = JSON.parse(JSON.stringify(d)); d.name = pj.name || d.name; return { name: d.name, from: "mine", plugin: d }; }).catch(function () { return null; });
      }));
    }).then(function (a) { return a.filter(Boolean); });
  });
  window.CP.type({
    id: "plugin", name: "Plugin", blurb: "Your own effect: blocks and wires, or code",
    long: "Build an effect from blocks (filters, delays, drive, modulation, knobs) wired together, or write it as code. It runs inside the apps' own sound engine, so it works on every computer and on the pedal, and it publishes to Make & sell as a Plugin.",
    create: function (opts) { return blank(opts.name); },
    load: function () { return loadBuilder(); },
    mount: mount, unmount: function () { stopTry(); if (ui.b) try { ui.b.unmount(); } catch (_) { } ui.b = null; ui.el = null; },
    changed: function (label) { if (label === "undo" || label === "redo") drawHost(); },
    collect: function (project) { return { data: project.data, files: {} }; },
    exports: [["Export the plugin (.cmfx.json)", function () { var f = file(); return H.exportFiles(window.CP.project().name, [{ name: f.name, data: f.data }]); }, "Opens in Central Production on any computer"]],
    publish: { store: "make", kind: "plugin", build: function () { var f = file(); var g = f.plugin.graph || {}; if (!(g.blocks || []).some(function (b) { return b.type !== "input" && b.type !== "output"; }) && !(f.plugin.code && f.plugin.code.trim())) throw new Error("The plugin is empty: add some blocks (or code) first."); if (window.CMFx) { var r = window.CMFx.check(f.plugin); if (!r.ok) throw new Error("Fix the plugin first: " + r.error); } return { fx: f }; } },
    install: function () { return { fx: file() }; }
  });
})();
