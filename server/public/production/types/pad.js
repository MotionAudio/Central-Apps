/* Central Production - Pad: a pad in all 12 keys, each a seamless loop (the end crossfades into the start, so it holds
 * forever on the pad pedal). The sound comes from the pad synth here (layers, brightness, movement, width, space) or
 * from a sample you bring in (it's pitched to each key). It exports 12 WAVs (C.wav … B.wav), installs as a Central Pads
 * pad and publishes to Make & sell as a Pad. */
(function () {
  "use strict";
  var A = window.CPAudio, Z = window.CMProj, H = window.CPHost, S = window.CDaw;
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) { return window.CP.esc(s); }
  var KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  var CHARACTERS = {
    warm: { name: "Warm", wave: "sawtooth", bright: 0.35, move: 0.3, detune: 9, layers: { sub: 0.3, fifth: 0.5, octave: 0.4, ninth: 0 }, attack: 2.5, space: 0.45, width: 0.6 },
    air: { name: "Air", wave: "triangle", bright: 0.7, move: 0.45, detune: 6, layers: { sub: 0, fifth: 0.4, octave: 0.6, ninth: 0.2 }, attack: 3, space: 0.6, width: 0.9, noise: 0.08 },
    shimmer: { name: "Shimmer", wave: "sawtooth", bright: 0.8, move: 0.6, detune: 12, layers: { sub: 0, fifth: 0.4, octave: 0.7, ninth: 0.3, high: 0.35 }, attack: 3.5, space: 0.75, width: 1 },
    dark: { name: "Dark", wave: "sawtooth", bright: 0.15, move: 0.2, detune: 7, layers: { sub: 0.6, fifth: 0.4, octave: 0.2, ninth: 0 }, attack: 2, space: 0.5, width: 0.5 },
    glass: { name: "Glass", wave: "sine", bright: 0.6, move: 0.25, detune: 3, layers: { sub: 0, fifth: 0.3, octave: 0.6, ninth: 0.25, high: 0.4 }, attack: 1.5, space: 0.55, width: 0.8, bell: 0.3 },
    strings: { name: "Strings", wave: "sawtooth", bright: 0.5, move: 0.5, detune: 14, layers: { sub: 0.15, fifth: 0.45, octave: 0.5, ninth: 0 }, attack: 1.8, space: 0.5, width: 0.85, vibrato: 0.25 },
    organ: { name: "Organ", wave: "square", bright: 0.4, move: 0.15, detune: 2, layers: { sub: 0.5, fifth: 0.35, octave: 0.5, ninth: 0, high: 0.2 }, attack: 0.8, space: 0.35, width: 0.4 }
  };
  var bufs = {}, ui = { el: null, key: 0, cache: {}, sig: "" };
  function D() { return window.CP.project().data; }
  function freq(k, oct) { return 440 * Math.pow(2, (k + 12 * (oct + 1) - 69) / 12); }   // key 0 = C
  // a convolution "room": noise with a decay, made once per render
  function room(c, secs) {
    var n = Math.round(c.sampleRate * secs), b = c.createBuffer(2, n, c.sampleRate), s = 7;
    for (var ch = 0; ch < 2; ch++) { var d = b.getChannelData(ch), lp = 0; for (var i = 0; i < n; i++) { s = (s * 1103515245 + 12345 + ch) & 0x7fffffff; var w = s / 0x7fffffff * 2 - 1; lp += (w - lp) * 0.35; d[i] = lp * Math.pow(1 - i / n, 2.2); } }
    return b;
  }
  // one key of the synth pad, `secs` long plus a crossfade's worth more
  function synthKey(c, out, k, p, secs) {
    var notes = [[0, 1]], L = p.layers || {};
    if (L.sub) notes.push([-12, L.sub]); if (L.fifth) notes.push([7, L.fifth]); if (L.octave) notes.push([12, L.octave]); if (L.ninth) notes.push([14, L.ninth]); if (L.high) notes.push([19, L.high]);
    var octave = k >= 5 ? 2 : 3, master = c.createGain(); master.gain.value = 0;
    var lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 400 + Math.pow(p.bright, 1.6) * 9000; lp.Q.value = 0.6;
    var lfo = c.createOscillator(), lfoG = c.createGain(); lfo.frequency.value = 0.08 + p.move * 0.25; lfoG.gain.value = lp.frequency.value * 0.35 * p.move; lfo.connect(lfoG).connect(lp.frequency); lfo.start(0);
    master.connect(lp);
    var dry = c.createGain(), wet = c.createGain(), conv = c.createConvolver(); conv.buffer = room(c, 3 + p.space * 4); dry.gain.value = 1 - p.space * 0.5; wet.gain.value = p.space * 0.9;
    lp.connect(dry).connect(out); lp.connect(conv).connect(wet).connect(out);
    notes.forEach(function (nt, ni) {
      [-1, 1].forEach(function (side, si) {
        var o = c.createOscillator(), g = c.createGain(), pan = c.createStereoPanner();
        o.type = p.wave; o.frequency.value = freq(k, octave) * Math.pow(2, nt[0] / 12); o.detune.value = side * p.detune * (1 + ni * 0.15);
        if (p.vibrato) { var v = c.createOscillator(), vg = c.createGain(); v.frequency.value = 4.8 + si * 0.3; vg.gain.value = 6 * p.vibrato; v.connect(vg).connect(o.detune); v.start(0); }
        g.gain.value = nt[1] * 0.12 / Math.sqrt(notes.length); pan.pan.value = side * p.width * (0.4 + 0.15 * ni);
        o.connect(g).connect(pan).connect(master); o.start(0);
      });
    });
    if (p.noise) { var nb = c.createBuffer(2, c.sampleRate * 2, c.sampleRate); for (var ch = 0; ch < 2; ch++) { var d = nb.getChannelData(ch); for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; } var ns = c.createBufferSource(); ns.buffer = nb; ns.loop = true; var bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = freq(k, octave + 3); bp.Q.value = 4; var ng = c.createGain(); ng.gain.value = p.noise * 0.3; ns.connect(bp).connect(ng).connect(master); ns.start(0); }
    if (p.bell) { var b2 = c.createOscillator(), bg = c.createGain(); b2.type = "sine"; b2.frequency.value = freq(k, octave + 2) * 2.76; bg.gain.value = p.bell * 0.04; b2.connect(bg).connect(master); b2.start(0); }
    master.gain.setValueAtTime(0, 0); master.gain.linearRampToValueAtTime(1, Math.max(0.05, Math.min(p.attack, secs / 3)));
  }
  function sampleKey(c, out, k, buf, p) {
    var src = c.createBufferSource(); src.buffer = buf; src.loop = true; var root = p.root == null ? 60 : p.root, target = 60 + k - (k >= 6 ? 12 : 0);
    src.playbackRate.value = Math.pow(2, (target - root) / 12);
    var g = c.createGain(), conv = c.createConvolver(), wet = c.createGain(); conv.buffer = room(c, 3 + p.space * 4); wet.gain.value = p.space * 0.8; g.gain.value = 1;
    src.connect(g).connect(out); g.connect(conv).connect(wet).connect(out); src.start(0);
  }
  // render a key and make it seamless: the last `xf` seconds crossfade (equal power) into the start
  function renderKey(k, p) {
    var rate = 48000, secs = p.seconds || 16, xf = Math.min(4, secs / 3), oc = new OfflineAudioContext(2, Math.ceil((secs + xf) * rate), rate), bus = oc.createGain(); bus.gain.value = 0.9; bus.connect(oc.destination);
    if (p.source === "sample") { var b = bufs[p.sample]; if (!b) return Promise.reject(new Error("Bring in a sample first, or switch to the pad synth.")); sampleKey(oc, bus, k, b, p); }
    else synthKey(oc, bus, k, Object.assign({}, CHARACTERS[p.character] || CHARACTERS.warm, p.synth || {}), secs);
    return oc.startRendering().then(function (r) {
      var n = Math.round(secs * rate), x = Math.round(xf * rate), out = A.make(2, n, rate), head = Math.round(Math.min(p.attack || 2, secs / 3) * rate);
      for (var c = 0; c < 2; c++) {
        var s = r.getChannelData(c), d = out.getChannelData(c);
        // the loop is taken after the attack: [head, head + n), with the bit after it crossfaded over its start
        for (var i = 0; i < n; i++) d[i] = s[head + i] || 0;
        for (var j = 0; j < x; j++) { var t = j / x, a = Math.cos(t * Math.PI / 2), z = Math.sin(t * Math.PI / 2); d[j] = d[j] * z + (s[head + n + j] || 0) * a; }
      }
      return A.normalize(out, -3);
    });
  }
  function params() { var d = D(); return Object.assign({ source: d.source, character: d.character, sample: d.sample, root: d.root, seconds: d.seconds, space: d.space == null ? 0.5 : d.space, attack: (CHARACTERS[d.character] || CHARACTERS.warm).attack }, { synth: d.synth || {} }); }
  function keyBuf(k) {
    var sig = JSON.stringify(params()); if (sig !== ui.sig) { ui.cache = {}; ui.sig = sig; }
    if (ui.cache[k]) return Promise.resolve(ui.cache[k]);
    return renderKey(k, params()).then(function (b) { ui.cache[k] = b; return b; });
  }
  function all(progress) {
    var out = {};
    return KEYS.reduce(function (pr, name, k) { return pr.then(function () { if (progress) progress(k); return keyBuf(k).then(function (b) { out[name] = b; }); }); }, Promise.resolve()).then(function () { return out; });
  }

  function mount(el) {
    ui.el = el; var d = D(), ch = CHARACTERS[d.character] || CHARACTERS.warm, sy = Object.assign({}, ch, d.synth || {});
    function slider(id, label, v, min, max, step) { return '<label class="cp-slider">' + esc(label) + '<input type="range" id="' + id + '" min="' + min + '" max="' + max + '" step="' + (step || 0.01) + '" value="' + v + '"><output>' + (+v).toFixed(2) + "</output></label>"; }
    el.innerHTML = '<div class="cp-ed cp-pad"><div class="cp-tools"><div class="cp-seg"><button data-src="synth"' + (d.source !== "sample" ? ' class="on"' : "") + '>The pad synth</button><button data-src="sample"' + (d.source === "sample" ? ' class="on"' : "") + '>From a sample</button></div>' +
      '<label>Each key <select id="pdSecs">' + [8, 12, 16, 24, 32].map(function (s) { return '<option value="' + s + '"' + (s === (d.seconds || 16) ? " selected" : "") + ">" + s + " s loop</option>"; }).join("") + "</select></label></div>" +
      (d.source === "sample" ? '<div class="cp-card"><div class="cp-row"><button id="pdBring">Bring in a sample…</button><span class="muted">' + (bufs[d.sample] ? "A " + bufs[d.sample].duration.toFixed(1) + " s sample, played from " + noteName(d.root == null ? 60 : d.root) : "A long, steady sound works best: a held chord, a choir, strings, a drone.") + '</span><label>Its note <select id="pdRoot"></select></label></div></div>'
        : '<div class="cp-card"><div class="cp-chars">' + Object.keys(CHARACTERS).map(function (k) { return '<button data-ch="' + k + '"' + (k === (d.character || "warm") ? ' class="on"' : "") + ">" + esc(CHARACTERS[k].name) + "</button>"; }).join("") + "</div>" +
          '<div class="cp-sliders">' + slider("pdBright", "Brightness", sy.bright, 0, 1) + slider("pdMove", "Movement", sy.move, 0, 1) + slider("pdDetune", "Thickness", sy.detune, 0, 25, 0.5) + slider("pdWidth", "Width", sy.width, 0, 1) + slider("pdSub", "Low octave", (sy.layers || {}).sub || 0, 0, 1) + slider("pdFifth", "Fifth", (sy.layers || {}).fifth || 0, 0, 1) + slider("pdOct", "High octave", (sy.layers || {}).octave || 0, 0, 1) + slider("pdNinth", "Ninth (sus)", (sy.layers || {}).ninth || 0, 0, 1) + "</div></div>") +
      '<div class="cp-card"><div class="cp-row">' + slider("pdSpace", "Space (reverb)", d.space == null ? 0.5 : d.space, 0, 1) + '</div><b>Hear it in a key</b><div class="cp-keys12" id="pdKeys">' + KEYS.map(function (k, i) { return '<button data-k="' + i + '">' + k + "</button>"; }).join("") + '</div><div class="cp-row"><button id="pdStop">■ Stop</button><span class="muted small" id="pdState">Each key is rendered as a seamless loop: it plays round and round with no gap, like on the pad pedal.</span></div></div></div>';
    if (d.source === "sample") { var rs = $("#pdRoot", el); for (var n = 24; n <= 96; n++) rs.innerHTML += '<option value="' + n + '"' + (n === (d.root == null ? 60 : d.root) ? " selected" : "") + ">" + noteName(n) + "</option>"; rs.onchange = function () { var v = +this.value; window.CP.edit("Sample note", function (x) { x.root = v; }); }; $("#pdBring", el).onclick = bring; }
    $$("[data-src]", el).forEach(function (b) { b.onclick = function () { var v = b.dataset.src; window.CP.edit("Pad source", function (x) { x.source = v; }); mount(el); }; });
    $$("[data-ch]", el).forEach(function (b) { b.onclick = function () { var v = b.dataset.ch; window.CP.edit("Pad character", function (x) { x.character = v; x.synth = {}; }); mount(el); }; });
    $("#pdSecs", el).onchange = function () { var v = +this.value; window.CP.edit("Loop length", function (x) { x.seconds = v; }); };
    function bindSlider(id, fn) { var s = $("#" + id, el); if (!s) return; s.oninput = function () { s.nextElementSibling.textContent = (+s.value).toFixed(2); }; s.onchange = function () { var v = +s.value; window.CP.edit("Pad sound", function (x) { fn(x, v); }); }; }
    function syn(k) { return function (x, v) { x.synth = x.synth || {}; x.synth[k] = v; }; }
    function lay(k) { return function (x, v) { x.synth = x.synth || {}; var base = (CHARACTERS[x.character] || CHARACTERS.warm).layers; x.synth.layers = Object.assign({}, base, x.synth.layers || {}); x.synth.layers[k] = v; }; }
    bindSlider("pdBright", syn("bright")); bindSlider("pdMove", syn("move")); bindSlider("pdDetune", syn("detune")); bindSlider("pdWidth", syn("width"));
    bindSlider("pdSub", lay("sub")); bindSlider("pdFifth", lay("fifth")); bindSlider("pdOct", lay("octave")); bindSlider("pdNinth", lay("ninth")); bindSlider("pdSpace", function (x, v) { x.space = v; });
    $("#pdKeys", el).onclick = function (e) { var b = e.target.closest("[data-k]"); if (!b) return; var k = +b.dataset.k; ui.key = k; $$("[data-k]", el).forEach(function (x) { x.classList.toggle("on", x === b); }); $("#pdState", el).textContent = "Rendering " + KEYS[k] + "…"; keyBuf(k).then(function (buf) { A.audition(S.ctx(), buf, { loop: true }); $("#pdState", el).textContent = "Playing " + KEYS[k] + " (" + buf.duration.toFixed(0) + " s loop)."; }).catch(function (er) { $("#pdState", el).textContent = er.message; }); };
    $("#pdStop", el).onclick = function () { A.stopAudition(); $$("[data-k]", el).forEach(function (x) { x.classList.remove("on"); }); };
  }
  function noteName(n) { return ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][n % 12] + (Math.floor(n / 12) - 1); }
  function bring() { H.pickFiles(null, false).then(function (fs) { if (!fs[0]) return; Z.decode(S.ctx(), fs[0].bytes).then(function (b) { var id = window.CP.uid("a"); bufs[id] = b; var n = window.CPSampler.noteFromName(fs[0].name); window.CP.edit("Pad sample", function (x) { x.sample = id; if (n != null) x.root = n; }); mount(ui.el); }).catch(function () { window.CP.toast("That file isn't audio this computer can read.", "bad"); }); }); }
  function files(set) { return all(function (k) { window.CP.busy("Rendering " + KEYS[k] + " (" + (k + 1) + " of 12)…"); }).then(function (keys) { return KEYS.map(function (k) { return { name: (set || "") + k + ".wav", data: new Uint8Array(Z.wav(keys[k], 24)), key: k, buf: keys[k] }; }); }); }
  window.CP.type({
    id: "pad", name: "Pad", blurb: "A pad in all 12 keys, each a seamless loop",
    long: "Shape a pad with the pad synth (or from a sample) and it renders in all 12 keys, each a seamless loop that holds forever on the pad pedal. It goes into Central Pads in your apps, or to Make & sell as a Pad.",
    create: function () { bufs = {}; ui.cache = {}; return { source: "synth", character: "warm", synth: {}, seconds: 16, space: 0.5, sample: null, root: 60 }; },
    load: function (project, fs) { bufs = {}; ui.cache = {}; var d = project.data || {}; if (d.sample && fs["audio/" + d.sample + ".wav"]) return Z.decode(S.ctx(), fs["audio/" + d.sample + ".wav"]).then(function (b) { bufs[d.sample] = b; }); return null; },
    mount: mount, unmount: function () { A.stopAudition(); ui.el = null; },
    changed: function () { if (ui.el) mount(ui.el); },
    collect: function (project) { var f = {}, d = project.data; if (d.sample && bufs[d.sample]) f["audio/" + d.sample + ".wav"] = new Uint8Array(Z.wav(bufs[d.sample], 24)); return { data: d, files: f }; },
    exports: [["Export the 12 keys (WAV)", function () { return files().then(function (fs) { window.CP.busy("Saving…"); return H.exportFiles(window.CP.project().name, fs.map(function (f) { return { name: f.name, data: f.data }; })); }); }, "C.wav … B.wav, each a seamless loop"],
      ["Export one key (MP3)", function () { return keyBuf(ui.key || 0).then(function (b) { return H.exportFiles(window.CP.project().name, [{ name: Z.slug(window.CP.project().name) + "-" + KEYS[ui.key || 0].replace("#", "s") + ".mp3", data: A.mp3(A.repeat(b, b.duration * 2), 256) }]); }); }, "The key you last played, for sharing"]],
    publish: { store: "make", kind: "pad", build: function () { return files().then(function (fs) { return { zip: Z.zip(fs.map(function (f) { return { name: f.name, data: f.data }; })), zipName: Z.slug(window.CP.project().name) + ".zip", demo: A.demo(A.repeat(fs[0].buf, 30), 30) }; }); } },
    install: function () { return files().then(function (fs) { return { pads: fs }; }); },
    renderKey: function (k) { return keyBuf(k); }
  });
})();
