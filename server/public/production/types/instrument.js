/* Central Production - Instrument: a sampler instrument. Bring in samples (named by their note - "Piano C4.wav" - they
 * spread across the keyboard by themselves), set each one's keys, velocities, tuning and loop points, then the envelope
 * and the filter. Play it with the keyboard on screen, the computer keys or a MIDI keyboard. It exports as a SoundFont
 * (.sf2) or an SFZ, installs as a sound in your apps and publishes to Make & sell as an Instrument. */
(function () {
  "use strict";
  var A = window.CPAudio, Z = window.CMProj, H = window.CPHost, S = window.CDaw, SM = window.CPSampler, MIDI = window.CUMidiIn;
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) { return window.CP.esc(s); }
  var NOTE = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  function nn(n) { return NOTE[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1); }
  var bufs = {}, ui = { el: null, sel: 0, held: {}, octave: 4, midiOff: null, keysOn: false };
  function D() { return window.CP.project().data; }
  function inst() { var d = D(); return { name: window.CP.project().name, zones: d.zones, env: d.env, filter: d.filter, gain: d.gain }; }
  function noteOn(n, v) { if (ui.held[n]) noteOff(n); var c = S.ctx(); if (c.state === "suspended") c.resume(); ui.held[n] = SM.voice(c, c.destination, inst(), bufs, n, v || 100); light(n, true); }
  function noteOff(n) { if (ui.held[n]) { ui.held[n].stop(); delete ui.held[n]; } light(n, false); }
  function light(n, on) { var k = ui.el && ui.el.querySelector('.cp-kb [data-n="' + n + '"]'); if (k) k.classList.toggle("down", on); }
  var KEYMAP = "awsedftgyhujkolp;'";   // a w s e d f t g y h u j k o l p ; '  -> C C# D D# E F F# G G# A A# B C C# D D# E F

  function mount(el) {
    ui.el = el;
    el.innerHTML = '<div class="cp-ed cp-inst"><div class="cp-tools"><div class="cp-group"><button id="isAdd" class="primary">Add samples…</button><button id="isSpread" title="Each sample from halfway to the one below up to halfway to the one above">Spread across the keyboard</button><button id="isSort">Sort by note</button></div>' +
      '<div class="cp-group"><label class="toggle"><input type="checkbox" id="isKeys"> Play with the computer keys</label><span class="muted small" id="isMidi"></span></div></div>' +
      '<div class="cp-kb-wrap"><div class="cp-kb" id="isKb"></div></div>' +
      '<div class="cp-inst-grid"><div class="cp-card"><b>Samples</b><div id="isZones" class="cp-zones"></div></div><div class="cp-card" id="isZone"></div>' +
      '<div class="cp-card"><b>Envelope</b><div class="cp-sliders" id="isEnv"></div><b>Filter</b><div class="cp-sliders" id="isFilter"></div></div></div></div>';
    keyboard(); wire(el); draw();
    if (MIDI) MIDI.start().then(function () { var ins = MIDI.inputs(); $("#isMidi", el).textContent = ins.length ? "MIDI: " + ins.map(function (i) { return i.name; }).join(", ") : "Plug in a MIDI keyboard to play it."; }).catch(function () { });
    if (MIDI) ui.midiOff = MIDI.on(function (m) { var s = m.data[0] & 0xF0, n = m.data[1], v = m.data[2]; if (s === 0x90 && v > 0) noteOn(n, v); else if (s === 0x80 || (s === 0x90 && v === 0)) noteOff(n); });
  }
  function keyboard() {
    var kb = $("#isKb", ui.el), html = "";
    for (var n = 21; n <= 108; n++) { var black = [1, 3, 6, 8, 10].indexOf(n % 12) >= 0; html += '<div class="k ' + (black ? "b" : "w") + '" data-n="' + n + '" title="' + nn(n) + '">' + (n % 12 === 0 ? "<span>" + nn(n) + "</span>" : "") + "</div>"; }
    kb.innerHTML = html;
    kb.onpointerdown = function (e) { var k = e.target.closest("[data-n]"); if (!k) return; var n = +k.dataset.n, r = k.getBoundingClientRect(), v = Math.round(40 + 87 * Math.min(1, (e.clientY - r.top) / r.height)); noteOn(n, v); kb.setPointerCapture(e.pointerId); kb.dataset.down = n; };
    kb.onpointerup = kb.onpointercancel = function () { if (kb.dataset.down) { noteOff(+kb.dataset.down); delete kb.dataset.down; } };
  }
  function wire(el) {
    $("#isAdd", el).onclick = function () { H.pickFiles(null, true).then(add); };
    $("#isSpread", el).onclick = function () { window.CP.edit("Spread across the keyboard", function (d) { SM.spread(d.zones); }); };
    $("#isSort", el).onclick = function () { window.CP.edit("Sort by note", function (d) { d.zones.sort(function (a, b) { return a.root - b.root || (a.vlo || 0) - (b.vlo || 0); }); }); };
    $("#isKeys", el).onchange = function () { ui.keysOn = this.checked; };
    document.addEventListener("keydown", ckDown); document.addEventListener("keyup", ckUp);
  }
  function ckNote(e) { if (!ui.keysOn || e.ctrlKey || e.metaKey || /input|textarea|select/i.test(e.target.tagName)) return null; var i = KEYMAP.indexOf(e.key.toLowerCase()); return i < 0 ? null : (ui.octave + 1) * 12 + i; }
  function ckDown(e) { if (!ui.el) return; if (ui.keysOn && (e.key === "z" || e.key === "x")) { ui.octave = Math.max(0, Math.min(8, ui.octave + (e.key === "z" ? -1 : 1))); window.CP.toast("Octave " + ui.octave); return; } var n = ckNote(e); if (n == null || e.repeat) return; e.preventDefault(); noteOn(n, 100); }
  function ckUp(e) { var n = ckNote(e); if (n != null) noteOff(n); }
  function add(files) {
    if (!files.length) return;
    window.CP.busy("Reading " + files.length + " sample" + (files.length > 1 ? "s" : "") + "…");
    var added = [];
    return files.reduce(function (pr, f) { return pr.then(function () { return Z.decode(S.ctx(), f.bytes).then(function (b) { var id = window.CP.uid("s"); bufs[id] = b; var n = b.__meta && b.__meta.root != null ? b.__meta.root : SM.noteFromName(f.name); added.push({ sample: id, name: f.name.replace(/\.[^.]+$/, ""), root: n == null ? 60 : n, lo: 0, hi: 127, vlo: 1, vhi: 127, tune: 0, gain: 1, loop: b.__meta && b.__meta.loop ? { on: true, start: b.__meta.loop[0], end: b.__meta.loop[1] } : { on: false, start: 0, end: b.length } }); }).catch(function () { window.CP.toast(f.name + " isn't audio this computer can read.", "bad"); }); }); }, Promise.resolve())
      .then(function () {
        window.CP.busy(); if (!added.length) return;
        window.CP.edit("Add samples", function (d) { d.zones = d.zones.concat(added); SM.spread(d.zones); });
        ui.sel = D().zones.length - added.length; draw();
        window.CP.toast(added.length + " sample" + (added.length > 1 ? "s" : "") + " added and spread across the keyboard.");
      });
  }
  function draw() {
    if (!ui.el) return;
    var d = D(), z = d.zones[ui.sel];
    // the keyboard: which keys have a sound (and the selected sample's keys brighter)
    $$(".cp-kb [data-n]", ui.el).forEach(function (k) { var n = +k.dataset.n, has = d.zones.some(function (x) { return n >= x.lo && n <= x.hi; }), mine = z && n >= z.lo && n <= z.hi; k.classList.toggle("has", has); k.classList.toggle("mine", !!mine); k.classList.toggle("root", !!(z && n === z.root)); });
    $("#isZones", ui.el).innerHTML = d.zones.length ? d.zones.map(function (x, i) { return '<button class="cp-zone' + (i === ui.sel ? " on" : "") + '" data-z="' + i + '"><b>' + esc(x.name || x.sample) + '</b><span class="muted small">' + nn(x.root) + " · keys " + nn(x.lo) + "–" + nn(x.hi) + (x.vlo > 1 || x.vhi < 127 ? " · velocity " + x.vlo + "–" + x.vhi : "") + (x.loop && x.loop.on ? " · loops" : "") + "</span></button>"; }).join("")
      : '<p class="muted">No samples yet. Add WAV or other audio files - named with their note (C4, F#3, A0) they find their own place.</p>';
    $$("[data-z]", ui.el).forEach(function (b) { b.onclick = function () { ui.sel = +b.dataset.z; draw(); }; });
    var zp = $("#isZone", ui.el);
    if (!z) zp.innerHTML = '<b>The selected sample</b><p class="muted">Pick a sample on the left.</p>';
    else {
      var b = bufs[z.sample], sel = function (id, v, lo, hi) { var o = ""; for (var n = lo; n <= hi; n++) o += '<option value="' + n + '"' + (n === v ? " selected" : "") + ">" + nn(n) + "</option>"; return '<select id="' + id + '">' + o + "</select>"; };
      zp.innerHTML = '<div class="cp-row"><b>' + esc(z.name || z.sample) + '</b><span class="muted small">' + (b ? b.duration.toFixed(2) + " s" : "missing") + '</span><button id="zPlay">▶</button><button class="ghost" id="zDel">Remove</button></div>' +
        '<canvas class="cp-wave small" id="zWave"></canvas><div class="cp-grid2">' +
        "<label>Its note " + sel("zRoot", z.root, 0, 127) + "</label><label>Tune (cents) <input id=\"zTune\" type=\"number\" min=\"-100\" max=\"100\" value=\"" + (z.tune || 0) + '"></label>' +
        "<label>Lowest key " + sel("zLo", z.lo, 0, 127) + "</label><label>Highest key " + sel("zHi", z.hi, 0, 127) + "</label>" +
        '<label>Softest velocity <input id="zVlo" type="number" min="1" max="127" value="' + (z.vlo || 1) + '"></label><label>Hardest velocity <input id="zVhi" type="number" min="1" max="127" value="' + (z.vhi == null ? 127 : z.vhi) + '"></label>' +
        '<label>Level <input id="zGain" type="range" min="0" max="1.5" step="0.01" value="' + (z.gain == null ? 1 : z.gain) + '"></label><span></span>' +
        '<label class="toggle"><input type="checkbox" id="zLoop"' + (z.loop && z.loop.on ? " checked" : "") + '> Loop while the key is held</label><button id="zFind" title="Pick loop points at quiet zero crossings in the steady part">Find a loop</button>' +
        '<label>Loop start (s) <input id="zLs" type="number" step="0.001" min="0" value="' + (b && z.loop ? (z.loop.start / b.sampleRate).toFixed(3) : 0) + '"></label><label>Loop end (s) <input id="zLe" type="number" step="0.001" min="0" value="' + (b && z.loop ? (z.loop.end / b.sampleRate).toFixed(3) : 0) + '"></label></div>';
      if (b) { A.draw($("#zWave", zp), b); if (z.loop && z.loop.on) { var cv = $("#zWave", zp), g = cv.getContext("2d"), w = cv.clientWidth, h = cv.clientHeight; g.fillStyle = "rgba(141,181,222,.25)"; g.fillRect(z.loop.start / b.length * w, 0, (z.loop.end - z.loop.start) / b.length * w, h); } }
      function setZ(label, fn) { return function () { var el = this; window.CP.edit(label, function (dd) { fn(dd.zones[ui.sel], el); }); }; }
      $("#zRoot", zp).onchange = setZ("Sample note", function (x, e) { x.root = +e.value; });
      $("#zTune", zp).onchange = setZ("Tune", function (x, e) { x.tune = Math.max(-100, Math.min(100, +e.value || 0)); });
      $("#zLo", zp).onchange = setZ("Lowest key", function (x, e) { x.lo = Math.min(+e.value, x.hi); });
      $("#zHi", zp).onchange = setZ("Highest key", function (x, e) { x.hi = Math.max(+e.value, x.lo); });
      $("#zVlo", zp).onchange = setZ("Velocity", function (x, e) { x.vlo = Math.max(1, Math.min(127, +e.value || 1)); });
      $("#zVhi", zp).onchange = setZ("Velocity", function (x, e) { x.vhi = Math.max(1, Math.min(127, +e.value || 127)); });
      $("#zGain", zp).onchange = setZ("Level", function (x, e) { x.gain = +e.value; });
      $("#zLoop", zp).onchange = setZ("Loop", function (x, e) { x.loop = x.loop || { start: 0, end: b ? b.length : 0 }; x.loop.on = e.checked; if (e.checked && b && !(x.loop.end > x.loop.start + 100)) Object.assign(x.loop, findLoop(b)); });
      $("#zLs", zp).onchange = setZ("Loop start", function (x, e) { if (!b) return; x.loop = x.loop || { on: true, end: b.length }; x.loop.start = Math.max(0, Math.min(b.length - 2, Math.round(+e.value * b.sampleRate))); });
      $("#zLe", zp).onchange = setZ("Loop end", function (x, e) { if (!b) return; x.loop = x.loop || { on: true, start: 0 }; x.loop.end = Math.max(x.loop.start + 2, Math.min(b.length, Math.round(+e.value * b.sampleRate))); });
      $("#zFind", zp).onclick = function () { if (!b) return; window.CP.edit("Find a loop", function (dd) { dd.zones[ui.sel].loop = Object.assign({ on: true }, findLoop(b)); }); };
      $("#zPlay", zp).onclick = function () { noteOn(z.root, 100); setTimeout(function () { noteOff(z.root); }, 1500); };
      $("#zDel", zp).onclick = function () { window.CP.edit("Remove sample", function (dd) { dd.zones.splice(ui.sel, 1); }); ui.sel = Math.max(0, ui.sel - 1); };
    }
    function slider(id, label, v, min, max, step, unit) { return '<label class="cp-slider">' + esc(label) + '<input type="range" id="' + id + '" min="' + min + '" max="' + max + '" step="' + step + '" value="' + v + '"><output>' + v + (unit || "") + "</output></label>"; }
    var env = d.env, f = d.filter;
    $("#isEnv", ui.el).innerHTML = slider("eA", "Attack", env.attack, 0.001, 4, 0.001, " s") + slider("eD", "Decay", env.decay, 0.01, 6, 0.01, " s") + slider("eS", "Sustain", env.sustain, 0, 1, 0.01) + slider("eR", "Release", env.release, 0.01, 8, 0.01, " s") + slider("eG", "Level", d.gain == null ? 1 : d.gain, 0, 2, 0.01);
    $("#isFilter", ui.el).innerHTML = '<label class="toggle"><input type="checkbox" id="fOn"' + (f.on ? " checked" : "") + "> On</label>" + slider("fC", "Cutoff", f.cutoff, 60, 20000, 10, " Hz") + slider("fR", "Resonance", f.res, 0.1, 15, 0.1);
    function bind(id, fn) { var s = $("#" + id, ui.el); s.oninput = function () { if (s.nextElementSibling) s.nextElementSibling.textContent = s.value; }; s.onchange = function () { var v = s.type === "checkbox" ? s.checked : +s.value; window.CP.edit("Instrument sound", function (dd) { fn(dd, v); }); }; }
    bind("eA", function (x, v) { x.env.attack = v; }); bind("eD", function (x, v) { x.env.decay = v; }); bind("eS", function (x, v) { x.env.sustain = v; }); bind("eR", function (x, v) { x.env.release = v; }); bind("eG", function (x, v) { x.gain = v; });
    bind("fOn", function (x, v) { x.filter.on = v; }); bind("fC", function (x, v) { x.filter.cutoff = v; }); bind("fR", function (x, v) { x.filter.res = v; });
  }
  // a loop in the steady part: from about 40% to 90% of the sound, each end moved to the nearest upward zero crossing
  function findLoop(b) {
    var d = b.getChannelData(0), n = b.length;
    function zc(at) { for (var i = Math.max(1, at); i < n - 1 && i < at + b.sampleRate * 0.05; i++) if (d[i - 1] <= 0 && d[i] > 0) return i; return at; }
    var s = zc(Math.round(n * 0.4)), e = zc(Math.round(n * 0.9)); if (e <= s + 100) e = n - 1;
    return { start: s, end: e };
  }
  function demo() {
    var d = D(); if (!d.zones.length) return Promise.reject(new Error("Add samples first."));
    var roots = d.zones.map(function (z) { return z.root; }).sort(function (a, b) { return a - b; }), mid = roots[Math.floor(roots.length / 2)] || 60, c = mid - (mid % 12), notes = [];
    [[0, 4, 7], [-3, 0, 4], [-7, -3, 0], [-5, -1, 2]].forEach(function (ch, i) { ch.forEach(function (x, k) { notes.push({ p: c + x, v: 90, s: i * 2.4 + k * 0.03, d: 2.2 }); }); });
    [0, 4, 7, 12, 7, 4, 0].forEach(function (x, i) { notes.push({ p: c + x + 12, v: 80 + (i % 3) * 10, s: 10 + i * 0.35, d: 0.3 }); });
    return SM.render(inst(), bufs, notes, 16).then(function (b) { return A.normalize(b, -1); });
  }
  window.CP.type({
    id: "instrument", name: "Instrument", blurb: "A sampler instrument: samples across keys and velocities",
    long: "Build a playable instrument from samples: each one on its keys and velocities, tuned, looped while the key is held, with an envelope and a filter. It plays in Central Usage, Central Control and on the pedal, and publishes to Make & sell as an Instrument.",
    create: function () { bufs = {}; ui.sel = 0; return { zones: [], env: { attack: 0.005, decay: 0.4, sustain: 0.85, release: 0.5 }, filter: { on: false, cutoff: 8000, res: 0.7 }, gain: 1 }; },
    load: function (project, files) {
      bufs = {}; ui.sel = 0; var d = project.data || {}, c = S.ctx();
      return Promise.all((d.zones || []).map(function (z) { var f = files["audio/" + z.sample + ".wav"]; if (!f || bufs[z.sample]) return null; return Z.decode(c, f).then(function (b) { bufs[z.sample] = b; }).catch(function () { }); }));
    },
    mount: mount,
    unmount: function () { Object.keys(ui.held).forEach(noteOff); if (ui.midiOff) ui.midiOff(); document.removeEventListener("keydown", ckDown); document.removeEventListener("keyup", ckUp); ui.el = null; },
    changed: function () { draw(); },
    collect: function (project) { var f = {}; (project.data.zones || []).forEach(function (z) { if (bufs[z.sample] && !f["audio/" + z.sample + ".wav"]) f["audio/" + z.sample + ".wav"] = new Uint8Array(Z.wav(bufs[z.sample], 24, { root: z.root, loop: z.loop && z.loop.on ? [z.loop.start, z.loop.end] : null })); }); return { data: project.data, files: f }; },
    exports: [["Export as SoundFont (SF2)", function () { return H.exportFiles(window.CP.project().name, [{ name: Z.slug(window.CP.project().name) + ".sf2", data: SM.sf2(inst(), bufs) }]); }, "One file any sampler and the other apps open"],
      ["Export as SFZ", function () { return H.exportFiles(window.CP.project().name + " (SFZ)", SM.sfz(inst(), bufs)); }, "A text file and its WAVs, with the loop points"],
      ["Export a demo (MP3)", function () { return demo().then(function (b) { return H.exportFiles(window.CP.project().name, [{ name: Z.slug(window.CP.project().name) + "-demo.mp3", data: A.mp3(b, 256) }]); }); }, "A few chords and a run, played on it"]],
    publish: { store: "make", kind: "instrument", build: function () { var files = SM.sfz(inst(), bufs); return demo().then(function (b) { return { zip: Z.zip(files), zipName: Z.slug(window.CP.project().name) + ".zip", demo: b }; }); } },
    install: function () { return { sf2: SM.sf2(inst(), bufs) }; },
    play: noteOn, stop: noteOff, buffers: function () { return bufs; }
  });
})();
