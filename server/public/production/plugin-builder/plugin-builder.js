/* Central Production - the plugin builder (10.2; docs/PLUGIN-BUILDER.md).
 * Build an effect by dragging blocks onto a canvas and wiring them together, or by writing code - or both. What you
 * make is a Central FX plugin (.cmfx.json) that plays the same in every app: the Central Pedal, Central Usage,
 * Central Control, the website's studio and Central Production.
 *
 *   var b = CPPluginBuilder.mount(element, plugin, { onChange(plugin), onTest(plugin) -> true if the host plays it })
 *   b.getPlugin() -> the plugin as it is now;  b.unmount()
 *   CPPluginBuilder.blank(name) -> a new plugin (sound in -> sound out);  CPPluginBuilder.presets() -> the examples
 * Needs cmfx.js (window.CMFx) on the page first; presets.js adds the examples. Styles: plugin-builder.css.
 * Colours come from the app's own variables (--bg, --panel, --line, --accent...) with fallbacks. */
(function () {
  "use strict";
  var NAMES = {
    input: ["Sound in", "Where the sound comes into your plugin."],
    output: ["Sound out", "Whatever you wire here is what your plugin plays."],
    gain: ["Volume", "Turns the sound up or down."],
    mix: ["Blend", "Mixes two sounds: the dry one and the wet one."],
    filter: ["Filter", "Keeps some frequencies and takes others away: lowpass, highpass, bandpass, notch, shelves, peak."],
    eq: ["EQ band", "Lifts or cuts one range of frequencies."],
    delay: ["Delay", "Repeats the sound. Feedback sets how many repeats; tone makes them darker."],
    reverb: ["Reverb", "Puts the sound in a room, from small to huge."],
    chorus: ["Chorus / flanger", "Thickens the sound with a moving copy of itself."],
    phaser: ["Phaser", "A sweeping, swirling sound."],
    drive: ["Drive", "Warm saturation up to fuzz: soft, hard, tube, fuzz or fold."],
    bitcrush: ["Bitcrush", "Fewer bits and a lower sample rate, for lo-fi grit."],
    compressor: ["Compressor", "Evens out the level. Wire something into key to make it listen to that instead."],
    limiter: ["Limiter", "Never lets the sound go over the ceiling."],
    gate: ["Gate", "Quiets the sound when it drops under the threshold."],
    tremolo: ["Tremolo / auto-pan", "Pulses the volume, or moves the sound left and right."],
    pitch: ["Pitch shift", "Moves the sound up or down in semitones."],
    lfo: ["LFO", "A slow wave that moves other blocks' knobs. Wire its out into a knob's input."],
    envelope: ["Envelope follower", "Follows how loud the sound is, to move other knobs (an auto-wah, a ducker)."],
    math: ["Maths", "Adds, multiplies, maps or smooths signals and numbers."],
    param: ["Knob", "Sends one of your plugin's knobs into the wiring."],
    code: ["Code", "Your own code, for anything the other blocks can't do."],
    stereo: ["Stereo", "Width, pan, mono or swap left and right."],
    crossover: ["Band split", "One band of a 3-way split (low, mid or high); the three add back up to the original."],
    transient: ["Transient shaper", "More or less attack and sustain, at any level."],
    rotary: ["Rotary speaker", "The spinning organ speaker: horn and drum, slow or fast."],
  };
  var GROUPS = [["In and out", ["input", "output"]], ["Tone", ["filter", "eq"]], ["Space", ["delay", "reverb"]], ["Movement", ["chorus", "phaser", "tremolo", "pitch", "rotary"]],
    ["Grit", ["drive", "bitcrush"]], ["Dynamics", ["compressor", "limiter", "gate", "transient"]], ["Mixing", ["gain", "mix", "stereo", "crossover"]], ["Control", ["lfo", "envelope", "math", "param"]], ["Code", ["code"]]];
  var PORTS = { freq: ["Frequency", "Hz", 1], q: ["Width (Q)", "", 1], gain: ["Gain", "dB"], mix: ["Mix", "%"], time: ["Time", "ms", 1], feedback: ["Feedback", "%"], tone: ["Tone", "Hz", 1],
    size: ["Size", "%"], damp: ["Damping", "%"], predelay: ["Pre-delay", "ms"], width: ["Width", ""], rate: ["Speed", "Hz", 1], depth: ["Depth", "%"], drive: ["Drive", "dB"], level: ["Level", "dB"],
    bits: ["Bits", ""], threshold: ["Threshold", "dB"], ratio: ["Ratio", ":1"], attack: ["Attack", "ms", 1], release: ["Release", "ms", 1], knee: ["Knee", "dB"], makeup: ["Make-up", "dB"],
    ceiling: ["Ceiling", "dB"], range: ["Range", "dB"], hold: ["Hold", "ms"], stereo: ["Stereo spread", "°"], semitones: ["Semitones", "st"], fine: ["Fine", "cents"],
    from: ["From", ""], to: ["To", ""], phase: ["Phase", "°"], sensitivity: ["Sensitivity", "dB"], a: ["A", ""], b: ["B", ""], lo: ["Low", ""], hi: ["High", ""],
    inLo: ["In low", ""], inHi: ["In high", ""], outLo: ["Out low", ""], outHi: ["Out high", ""], pan: ["Pan", ""], c1: ["c1", ""], c2: ["c2", ""], c3: ["c3", ""], c4: ["c4", ""],
    in: ["Sound", ""], key: ["Key (listen to)", ""], dry: ["Dry", ""], wet: ["Wet", ""],
    mod: ["Motion", ""], schpf: ["Side-chain low cut", "Hz", 1], low: ["Low / mid split", "Hz", 1], high: ["Mid / high split", "Hz", 1], speed: ["Speed (slow / fast)", ""], sustain: ["Sustain", "%"] };
  var PERCENT = { mix: 1, feedback: 1, size: 1, damp: 1, depth: 1 };
  // (10.4) the note values a delay can sync to (PPPedals.tempo.NOTES where the page has it): [id, name, beats]
  var SYNC_NOTES = [["1/1", "Whole", 4], ["1/2.", "Dotted half", 3], ["1/2", "Half", 2], ["1/2T", "Half triplet", 4 / 3], ["1/4.", "Dotted quarter", 1.5], ["1/4", "Quarter", 1], ["1/4T", "Quarter triplet", 2 / 3],
    ["1/8.", "Dotted eighth", 0.75], ["1/8", "Eighth", 0.5], ["1/8T", "Eighth triplet", 1 / 3], ["1/16.", "Dotted sixteenth", 0.375], ["1/16", "Sixteenth", 0.25], ["1/16T", "Sixteenth triplet", 1 / 6], ["1/32", "Thirty-second", 0.125]];
  var NUMPROPS = { filter: [["slope", "Slope", [12, 24], "dB per octave"]], eq: [], delay: [["maxTime", "Longest time", [100, 10000], "ms"]], phaser: [["stages", "Stages", [2, 12], ""]], pitch: [["window", "Smoothness", [10, 200], "ms"]], drive: [["oversample", "Oversampling (1, 2 or 4)", [1, 4], "x"]], limiter: [["lookahead", "Look-ahead", [0, 10], "ms"]] };
  var NUMDEF = { slope: 12, maxTime: 2000, stages: 4, window: 50, oversample: 2, lookahead: 0 };
  var CHOICE_NAMES = { lowpass: "Lowpass", highpass: "Highpass", bandpass: "Bandpass", notch: "Notch", peak: "Peak", lowshelf: "Low shelf", highshelf: "High shelf", allpass: "Allpass",
    linear: "Straight", equal: "Equal power", normal: "Normal", pingpong: "Ping-pong", chorus: "Chorus", flanger: "Flanger", soft: "Soft", hard: "Hard", tube: "Tube", fuzz: "Fuzz", fold: "Fold",
    tremolo: "Tremolo", autopan: "Auto-pan", sine: "Sine", triangle: "Triangle", saw: "Saw up", ramp: "Saw down", square: "Square", random: "Random", mono: "Mono", swap: "Swap",
    add: "a + b", subtract: "a − b", multiply: "a × b", divide: "a ÷ b", min: "smaller", max: "bigger", abs: "|a|", negate: "−a", clamp: "keep a between low and high", map: "map a from in to out",
    db2gain: "dB to volume", gain2db: "volume to dB", sin: "sin(a)", tanh: "tanh(a)", value: "a as it is", smooth: "smooth a over b ms" };
  var CODE_WORDS = /^(if|else|loop|array|delay)$/, CODE_NAMES = /^(inL|inR|outL|outR|srate|c[1-4]|pi|blocksize)$/,
    CODE_FUNCS = /^(sin|cos|tan|tanh|exp|log|log10|log2|sqrt|abs|floor|ceil|round|sign|atan|atan2|pow|min|max|clamp|mix|fmod|db2gain|gain2db|rand|noise|len|read|write)$/;
  var HELP = [
    ["Sections", "@init runs once at the start. @block runs before every block of samples. @sample runs for every sample (the default)."],
    ["Sound", "inL, inR: the sound coming in. outL, outR: what you send out (they start as the input). srate: samples per second."],
    ["Your knobs", "Every knob is a name you can read, by its id (e.g. mix). c1 to c4: the code block's control inputs."],
    ["Maths", "+ - * / % ^, == != < > <= >=, && || !, c ? a : b. sin cos tan tanh exp log log10 log2 sqrt abs floor ceil round sign atan atan2 pow min max clamp(x, lo, hi) mix(a, b, t) fmod db2gain gain2db rand() noise()"],
    ["Memory", "Variables appear when you first use them and keep their value. array buf[1024] (buf[i] wraps around), delay echo[2000] (up to 2000 ms): echo.write(x), echo.read(ms). len(buf)."],
    ["Control", "if (x > 0) { ... } else { ... }   loop (8) { ... } runs at most 4096 times. There are no while or for loops, so code can't get stuck."],
    ["Safety", "No files, no internet, no system calls. Code that does too much work for each sample is switched off and the sound passes through."]];

  function el(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k]; if (v == null || v === false) return;
      if (k === "class") e.className = v; else if (k === "text") e.textContent = v; else if (k === "html") e.innerHTML = v;
      else if (k.slice(0, 2) === "on") e.addEventListener(k.slice(2), v); else e.setAttribute(k, v === true ? "" : v);
    });
    (kids || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function fmt(v, unit) {
    if (unit === "%") return Math.round(v * 100) + "%";
    if (unit === "Hz" && Math.abs(v) >= 1000) return (v / 1000).toFixed(Math.abs(v) >= 10000 ? 1 : 2).replace(/\.?0+$/, "") + " kHz";
    var a = Math.abs(v), s = a >= 1000 ? (v / 1000).toFixed(a >= 10000 ? 1 : 2).replace(/\.?0+$/, "") + "k" : a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2);
    return s + (unit && unit !== "%" ? " " + unit : "");
  }
  function blank(name) {
    return { format: "central-fx", version: 1, name: name || "My plugin", author: "", params: [{ id: "mix", name: "Mix", min: 0, max: 1, default: 1 }],
      graph: { blocks: [{ id: "in", type: "input", x: 60, y: 140 }, { id: "out", type: "output", x: 520, y: 140 }], wires: [{ from: "in.out", to: "out.in" }] } };
  }
  function presets() { return (window.CPPluginPresets || []).map(clone); }
  function types() { try { return window.CMFx ? window.CMFx.types() : []; } catch (_) { return []; } }

  /* ---------------------------------------------------------------- test sounds (made here, nothing to download) */
  function testSound(ctx, kind) {
    var sr = ctx.sampleRate, secs = kind === "drums" ? 4.8 : 4, n = Math.round(sr * secs), b = ctx.createBuffer(2, n, sr), L = b.getChannelData(0), R = b.getChannelData(1), s = 1;
    function rnd() { s = (s * 1103515245 + 12345) >>> 0; return s / 2147483648 - 1; }
    var i, t;
    if (kind === "guitar") {
      var notes = [48, 55, 60, 64, 67, 64, 60, 55, 45, 52, 57, 60, 64, 60, 57, 52];
      notes.forEach(function (m, k) {
        var f = 440 * Math.pow(2, (m - 69) / 12), p = Math.max(2, Math.round(sr / f)), buf = new Float32Array(p), start = Math.round(k * n / notes.length), end = Math.min(n, start + Math.round(sr * 1.4));
        for (var q = 0; q < p; q++) buf[q] = rnd() * 0.5; var idx = 0;
        for (var j = start; j < end; j++) { var nx = (idx + 1) % p, v = buf[idx]; buf[idx] = (v + buf[nx]) * 0.4985; idx = nx; L[j] += v * 0.7; R[j] += v * 0.6; }
      });
    } else if (kind === "drums") {
      var beat = 60 / 100;
      for (var k = 0; k < 16; k++) {
        var at = Math.round(k * beat * 0.5 * sr);
        if (k % 4 === 0) for (i = 0; i < sr * 0.35 && at + i < n; i++) { t = i / sr; var f = 50 + 120 * Math.exp(-t * 30); L[at + i] += Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 9) * 0.9; }
        if (k % 4 === 2) for (i = 0; i < sr * 0.25 && at + i < n; i++) { t = i / sr; var v2 = (rnd() * 0.6 + Math.sin(2 * Math.PI * 190 * t) * 0.4) * Math.exp(-t * 18) * 0.7; L[at + i] += v2; }
        for (i = 0; i < sr * 0.06 && at + i < n; i++) { t = i / sr; L[at + i] += (rnd() - (i ? rnd() * 0.5 : 0)) * Math.exp(-t * 70) * 0.18; }
      }
      for (i = 0; i < n; i++) R[i] = L[i];
    } else if (kind === "voice") {
      var mel = [57, 60, 62, 64, 62, 60, 57, 55], ph = 0, form = [[700, 110, 1], [1220, 120, 0.5], [2600, 160, 0.25]], st = form.map(function () { return [0, 0]; });
      for (i = 0; i < n; i++) {
        t = i / sr; var note = mel[Math.floor(t / secs * mel.length)], f0 = 440 * Math.pow(2, (note - 69) / 12) * (1 + 0.006 * Math.sin(2 * Math.PI * 5.2 * t));
        ph += f0 / sr; ph -= Math.floor(ph); var src = (ph * 2 - 1) * 0.5 + rnd() * 0.02, y = 0;
        form.forEach(function (fo, q) { var w = 2 * Math.PI * fo[0] / sr, r = Math.exp(-Math.PI * fo[1] / sr), a1 = 2 * r * Math.cos(w), a2 = -r * r, z = st[q], o = src * (1 - r) + a1 * z[0] + a2 * z[1]; z[1] = z[0]; z[0] = o; y += o * fo[2]; });
        var env = Math.min(1, (t % (secs / mel.length)) * 20) * 0.9; L[i] = R[i] = y * env * 0.6;
      }
    } else if (kind === "keys") {
      var chords = [[60, 64, 67, 71], [57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 65]];
      chords.forEach(function (c, k) {
        var start = Math.round(k * n / 4);
        c.forEach(function (m) { var f = 440 * Math.pow(2, (m - 69) / 12); for (var j = 0; j < n / 4 && start + j < n; j++) { t = j / sr; var v = (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t) * Math.exp(-t * 3)) * Math.exp(-t * 1.2) * 0.12; L[start + j] += v; R[start + j] += v; } });
      });
    } else {
      var b0 = 0, b1 = 0, b2 = 0;
      for (i = 0; i < n; i++) { var wv = rnd(); b0 = 0.99765 * b0 + wv * 0.099; b1 = 0.963 * b1 + wv * 0.2965; b2 = 0.57 * b2 + wv * 1.0526; L[i] = (b0 + b1 + b2 + wv * 0.1848) * 0.08; R[i] = L[i]; }
    }
    return b;
  }

  /* ---------------------------------------------------------------- the builder */
  function mount(host, plugin, opts) {
    opts = opts || {};
    var P = normal(plugin && typeof plugin === "object" ? clone(plugin) : blank()), sel = null, tab = "blocks", codeTarget = null;
    var undo = [], redo = [], last = JSON.stringify(P), changeT = 0, liveT = 0, checkT = 0, dead = false;
    var T = {}; types().forEach(function (t) { T[t.type] = t; });
    var root = el("div", { class: "cpb", tabindex: "-1" });
    host.innerHTML = ""; host.appendChild(root);

    function normal(p) {
      p.format = "central-fx"; p.version = 1; p.name = p.name || "My plugin"; p.params = Array.isArray(p.params) ? p.params : [];
      p.graph = p.graph && typeof p.graph === "object" ? p.graph : {}; p.graph.blocks = Array.isArray(p.graph.blocks) ? p.graph.blocks : []; p.graph.wires = Array.isArray(p.graph.wires) ? p.graph.wires : [];
      p.graph.blocks.forEach(function (b, i) { b.props = b.props || {}; if (b.x == null) b.x = 60 + (i % 5) * 180; if (b.y == null) b.y = 60 + Math.floor(i / 5) * 160; });
      return p;
    }
    function block(id) { return P.graph.blocks.filter(function (b) { return b.id === id; })[0]; }
    function cardHeight(b) { var t = T[b.type]; return 44 + (t ? t.ports.length : 1) * 22 + (blockSummaryLen(b) ? 16 : 0); }
    function blockSummaryLen(b) { var t = T[b.type]; return t && (Object.keys(t.choices || {}).length || b.type === "param" || b.type === "code"); }
    function overlaps() {
      var bs = P.graph.blocks;
      for (var i = 0; i < bs.length; i++) for (var j = i + 1; j < bs.length; j++) {
        var a = bs[i], c = bs[j]; if (Math.abs(a.x - c.x) < 176 && (a.y < c.y ? c.y - a.y < cardHeight(a) + 6 : a.y - c.y < cardHeight(c) + 6)) return true;
      }
      return false;
    }
    /* lay the blocks out left to right in wiring order: each column holds the blocks the same number of wires in */
    function tidy() {
      var bs = P.graph.blocks, depth = {}, changed = true, guard = 0;
      bs.forEach(function (b) { depth[b.id] = 0; });
      while (changed && guard++ < 80) { changed = false; P.graph.wires.forEach(function (w) { var f = wireParts(w.from)[0], t = wireParts(w.to)[0]; if (depth[f] != null && depth[t] != null && depth[t] < depth[f] + 1) { depth[t] = depth[f] + 1; changed = true; } }); }
      var outs = bs.filter(function (b) { return b.type === "output"; }), maxD = 0; bs.forEach(function (b) { maxD = Math.max(maxD, depth[b.id]); }); outs.forEach(function (b) { depth[b.id] = maxD; });
      var cols = {}; bs.forEach(function (b) { (cols[depth[b.id]] = cols[depth[b.id]] || []).push(b); });
      Object.keys(cols).forEach(function (k) { var y = 40; cols[k].forEach(function (b) { b.x = 40 + (+k) * 205; b.y = y; y += cardHeight(b) + 26; }); });
    }
    function wireParts(s) { var i = s.indexOf("."); return i < 0 ? [s, ""] : [s.slice(0, i), s.slice(i + 1)]; }
    function newId(type) { var base = type === "param" ? "knob" : type, i = 1; while (block(base + i)) i++; return base + i; }
    function commit(label) {
      var now = JSON.stringify(P); if (now === last) return;
      undo.push(last); if (undo.length > 200) undo.shift(); redo = []; last = now;
      clearTimeout(changeT); changeT = setTimeout(function () { if (opts.onChange) opts.onChange(getPlugin()); }, 150);
      scheduleCheck(); scheduleLive(); void label;
    }
    function restore(json) { P = normal(JSON.parse(json)); if (overlaps()) tidy(); last = JSON.stringify(P); sel = null; render(); scheduleCheck(); scheduleLive(); if (opts.onChange) opts.onChange(getPlugin()); }
    function getPlugin() { var p = clone(P); return p; }

    /* ---- the frame */
    var bar = el("div", { class: "cpb-bar" }), main = el("div", { class: "cpb-main" }), foot = el("div", { class: "cpb-foot" });
    var status = el("div", { class: "cpb-status", role: "status", "aria-live": "polite" });
    root.appendChild(bar); root.appendChild(status); root.appendChild(main); root.appendChild(foot);

    function renderBar() {
      bar.innerHTML = "";
      var name = el("input", { class: "cpb-name", value: P.name, "aria-label": "Plugin name", maxlength: "60", oninput: function () { P.name = name.value; }, onchange: function () { commit("name"); } });
      var pre = el("select", { class: "cpb-presets", "aria-label": "Start from an example", onchange: function () {
        var i = +pre.value; pre.value = ""; if (!(i >= 0)) return; var p = presets()[i]; if (!p) return;
        if (P.graph.blocks.length > 2 && !window.confirm("Start from \"" + p.name + "\"? What you have now is replaced (Undo brings it back).")) return;
        undo.push(last); redo = []; restore(JSON.stringify(normal(p)));
      } }, [el("option", { value: "", text: "Examples…" })].concat(presets().map(function (p, i) { return el("option", { value: String(i), text: p.name }); })));
      var file = el("input", { type: "file", accept: ".json,.cmfx.json,application/json", hidden: true, onchange: function () {
        var f = file.files && file.files[0]; if (!f) return; var r = new FileReader();
        r.onload = function () { try { var p = JSON.parse(r.result); if (p.format !== "central-fx") throw new Error("this isn't a Central FX plugin file"); undo.push(last); redo = []; restore(JSON.stringify(normal(p))); } catch (e) { say(e.message, true); } };
        r.readAsText(f); file.value = "";
      } });
      var tabs = el("div", { class: "cpb-tabs", role: "tablist" }, [["blocks", "Blocks"], ["code", "Code"], ["knobs", "Knobs"]].map(function (t) {
        return el("button", { type: "button", role: "tab", "aria-selected": tab === t[0] ? "true" : "false", class: tab === t[0] ? "on" : "", text: t[1], onclick: function () { tab = t[0]; render(); } });
      }));
      bar.appendChild(name); bar.appendChild(tabs); bar.appendChild(pre);
      bar.appendChild(el("button", { type: "button", text: "New", title: "Start a new plugin", onclick: function () { if (!window.confirm("Start a new, empty plugin? (Undo brings this one back.)")) return; undo.push(last); redo = []; restore(JSON.stringify(blank())); } }));
      bar.appendChild(el("button", { type: "button", text: "Open…", title: "Open a .cmfx.json file", onclick: function () { file.click(); } }));
      bar.appendChild(el("button", { type: "button", text: "Save a copy", title: "Download this plugin as a .cmfx.json file", onclick: saveFile }));
      if (tab === "blocks" && P.graph.blocks.length > 1) bar.appendChild(el("button", { type: "button", text: "Tidy up", title: "Line the blocks up in wiring order", onclick: function () { tidy(); commit("tidy"); render(); } }));
      bar.appendChild(el("button", { type: "button", class: "cpb-undo", text: "Undo", disabled: !undo.length, onclick: doUndo }));
      bar.appendChild(el("button", { type: "button", class: "cpb-redo", text: "Redo", disabled: !redo.length, onclick: doRedo }));
      bar.appendChild(file);
    }
    function doUndo() { if (!undo.length) return; redo.push(last); restore(undo.pop()); }
    function doRedo() { if (!redo.length) return; undo.push(last); restore(redo.pop()); }
    function saveFile() {
      var blob = new Blob([JSON.stringify(getPlugin(), null, 2)], { type: "application/json" }), a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = (P.name || "plugin").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-").toLowerCase() + ".cmfx.json";
      document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    }
    function say(text, bad) { status.textContent = text; status.className = "cpb-status" + (bad ? " bad" : " good"); }

    /* ---- checking: the core itself says what's wrong */
    var lastError = "";
    function scheduleCheck() { clearTimeout(checkT); checkT = setTimeout(runCheck, 120); }
    function runCheck() {
      if (dead) return;
      if (!window.CMFx) { say("The plugin player (cmfx.js) isn't loaded on this page.", true); return; }
      var r = window.CMFx.check(P);
      lastError = r.ok ? "" : r.error;
      say(r.ok ? "Ready: " + P.graph.blocks.length + " block" + (P.graph.blocks.length === 1 ? "" : "s") + ", " + P.params.length + " knob" + (P.params.length === 1 ? "" : "s") + (P.graph.blocks.length ? "" : ", all code") + "." : r.error, !r.ok);
      if (tab === "code") markCodeError();
    }

    /* ---- the Blocks tab */
    var canvasWrap, canvas, svg, tempPath, inspector;
    function renderBlocks() {
      var palette = el("div", { class: "cpb-palette", "aria-label": "Blocks" });
      GROUPS.forEach(function (g) {
        palette.appendChild(el("div", { class: "cpb-group", text: g[0] }));
        g[1].forEach(function (type) {
          if (!T[type]) return;
          var item = el("button", { type: "button", class: "cpb-item", draggable: "true", title: NAMES[type][1], text: NAMES[type][0], onclick: function () { addBlock(type); } });
          item.addEventListener("dragstart", function (e) { e.dataTransfer.setData("text/cmfx-block", type); e.dataTransfer.effectAllowed = "copy"; });
          palette.appendChild(item);
        });
      });
      canvasWrap = el("div", { class: "cpb-canvas-wrap" });
      canvas = el("div", { class: "cpb-canvas" });
      svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("class", "cpb-wires");
      canvas.appendChild(svg); canvasWrap.appendChild(canvas);
      canvasWrap.addEventListener("dragover", function (e) { if (Array.prototype.indexOf.call(e.dataTransfer.types, "text/cmfx-block") >= 0) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } });
      canvasWrap.addEventListener("drop", function (e) {
        var type = e.dataTransfer.getData("text/cmfx-block"); if (!type) return; e.preventDefault();
        var r = canvas.getBoundingClientRect(); addBlock(type, e.clientX - r.left - 70, e.clientY - r.top - 18);
      });
      canvasWrap.addEventListener("pointerdown", function (e) { if (e.target === canvas || e.target === svg || e.target === canvasWrap) { sel = null; renderInspector(); markSelection(); } });
      P.graph.blocks.forEach(function (b) { canvas.appendChild(blockCard(b)); });
      if (!P.graph.blocks.length) canvas.appendChild(el("div", { class: "cpb-empty", text: P.code ? "This plugin is all code: see the Code tab. Drag a block here to start wiring instead." : "Drag blocks here from the left, then wire Sound in to Sound out through them." }));
      inspector = el("div", { class: "cpb-inspector" });
      main.appendChild(palette); main.appendChild(canvasWrap); main.appendChild(inspector);
      requestAnimationFrame(function () { drawWires(); markSelection(); });
      renderInspector();
    }
    function addBlock(type, x, y) {
      var id = newId(type), b = { id: id, type: type, x: 0, y: 0, props: {} };
      if (x == null) { var r = canvasWrap.getBoundingClientRect(); x = canvasWrap.scrollLeft + r.width / 2 - 70 + (P.graph.blocks.length % 4) * 14; y = canvasWrap.scrollTop + r.height / 2 - 40 + (P.graph.blocks.length % 4) * 14; }
      b.x = Math.max(4, Math.round(x)); b.y = Math.max(4, Math.round(y));
      if (type === "param") { if (!P.params.length) P.params.push({ id: "amount", name: "Amount", min: 0, max: 1, default: 0.5 }); b.props.param = P.params[0].id; }
      if (type === "code") b.props.code = "// " + NAMES.code[1] + "\noutL = inL\noutR = inR\n";
      P.graph.blocks.push(b); sel = { kind: "block", id: id }; commit("add"); render();
    }
    function portLabel(name) { return (PORTS[name] || [name])[0]; }
    function blockCard(b) {
      var t = T[b.type], card = el("div", { class: "cpb-block cpb-t-" + b.type, "data-id": b.id, style: "left:" + b.x + "px;top:" + b.y + "px" });
      if (!t) { card.appendChild(el("div", { class: "cpb-head", text: b.type + " (unknown)" })); return card; }
      var head = el("div", { class: "cpb-head" }, [el("span", { class: "cpb-title", text: NAMES[b.type] ? NAMES[b.type][0] : b.type }), el("span", { class: "cpb-id", text: b.id })]);
      if (t.out) head.appendChild(el("span", { class: "cpb-port cpb-out", "data-block": b.id, "data-port": "out", title: "Drag from here to an input" }));
      card.appendChild(head);
      var summary = blockSummary(b); if (summary) card.appendChild(el("div", { class: "cpb-sum", text: summary }));
      t.ports.forEach(function (p) {
        var wired = P.graph.wires.some(function (w) { var to = wireParts(w.to); return to[0] === b.id && (to[1] || "in") === p.name; });
        var bound = !p.audio && b.props[p.name] && typeof b.props[p.name] === "object";
        if (!p.audio && !wired && !bound && t.ports.length > 4 && ["from", "to", "lo", "hi", "inLo", "inHi", "outLo", "outHi", "c2", "c3", "c4", "phase"].indexOf(p.name) >= 0) {
          card.appendChild(el("div", { class: "cpb-row cpb-quiet" }, [el("span", { class: "cpb-port cpb-in cpb-ctl", "data-block": b.id, "data-port": p.name, title: portLabel(p.name) }), el("span", { text: portLabel(p.name) })]));
          return;
        }
        card.appendChild(el("div", { class: "cpb-row" + (p.audio ? " cpb-audio" : "") }, [
          el("span", { class: "cpb-port cpb-in" + (p.audio ? "" : " cpb-ctl"), "data-block": b.id, "data-port": p.name, title: p.audio ? "Sound in" : "Wire a signal here to move this knob" }),
          el("span", { text: portLabel(p.name) }),
          !p.audio ? el("span", { class: "cpb-val", text: wired ? "wired" : bound ? "⟲ " + b.props[p.name].param : fmt(propValue(b, p), (PORTS[p.name] || [])[1]) }) : null]));
      });
      head.addEventListener("pointerdown", function (e) { if (e.target.classList.contains("cpb-port")) return; startMove(e, b, card); });
      card.addEventListener("pointerdown", function (e) { if (e.target.classList.contains("cpb-port")) return; if (!sel || sel.kind !== "block" || sel.id !== b.id) { sel = { kind: "block", id: b.id }; renderInspector(); markSelection(); } });
      card.addEventListener("dblclick", function () { if (b.type === "code") { codeTarget = b.id; tab = "code"; render(); } });
      card.querySelectorAll(".cpb-port").forEach(function (pe) { pe.addEventListener("pointerdown", function (e) { startWire(e, pe); }); });
      return card;
    }
    function blockSummary(b) {
      var t = T[b.type], c = t && t.choices || {}, parts = [];
      Object.keys(c).forEach(function (k) { var v = b.props[k] || c[k][0]; parts.push(CHOICE_NAMES[v] || v); });
      if (b.type === "param") parts.push("knob: " + (b.props.param || "?"));
      if (b.type === "code") { var lines = String(b.props.code || P.code || "").split("\n").filter(function (l) { return l.trim() && !/^\s*\/\//.test(l); }).length; parts.push(lines + " line" + (lines === 1 ? "" : "s") + " of code"); }
      return parts.join(" · ");
    }
    function propValue(b, p) { var v = b.props[p.name]; return typeof v === "number" ? v : p.default; }
    function startMove(e, b, card) {
      e.preventDefault(); sel = { kind: "block", id: b.id }; renderInspector(); markSelection();
      var sx = e.clientX, sy = e.clientY, ox = b.x, oy = b.y, moved = false;
      function mv(ev) { b.x = Math.max(0, Math.round(ox + ev.clientX - sx)); b.y = Math.max(0, Math.round(oy + ev.clientY - sy)); card.style.left = b.x + "px"; card.style.top = b.y + "px"; moved = true; drawWires(); }
      function up() { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); if (moved) commit("move"); }
      window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
    }
    function portXY(pe) { var r = pe.getBoundingClientRect(), c = canvas.getBoundingClientRect(); return [r.left - c.left + r.width / 2, r.top - c.top + r.height / 2]; }
    function curve(a, b) { var dx = Math.max(40, Math.abs(b[0] - a[0]) * 0.5); return "M" + a[0] + "," + a[1] + " C" + (a[0] + dx) + "," + a[1] + " " + (b[0] - dx) + "," + b[1] + " " + b[0] + "," + b[1]; }
    function findPort(id, port, out) { return canvas.querySelector(".cpb-port" + (out ? ".cpb-out" : ".cpb-in") + '[data-block="' + cssEsc(id) + '"]' + (out ? "" : '[data-port="' + cssEsc(port) + '"]')); }
    function cssEsc(s) { return String(s).replace(/["\\]/g, "\\$&"); }
    function drawWires() {
      if (!svg) return;
      var w = Math.max(canvas.scrollWidth, 1600), h = Math.max(canvas.scrollHeight, 900); svg.setAttribute("width", w); svg.setAttribute("height", h);
      svg.innerHTML = "";
      P.graph.wires.forEach(function (wi, i) {
        var f = wireParts(wi.from), t = wireParts(wi.to), a = findPort(f[0], "out", true), b = findPort(t[0], t[1] || "in", false); if (!a || !b) return;
        var tb = block(t[0]), ctl = tb && T[tb.type] && T[tb.type].ports.some(function (p) { return p.name === (t[1] || "in") && !p.audio; });
        var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", curve(portXY(a), portXY(b))); path.setAttribute("class", "cpb-wire" + (ctl ? " cpb-wire-ctl" : "") + (sel && sel.kind === "wire" && sel.i === i ? " sel" : ""));
        path.addEventListener("pointerdown", function (e) { e.stopPropagation(); sel = { kind: "wire", i: i }; renderInspector(); markSelection(); drawWires(); });
        svg.appendChild(path);
      });
      tempPath = null;
    }
    function startWire(e, pe) {
      e.preventDefault(); e.stopPropagation();
      var isOut = pe.classList.contains("cpb-out"), from = isOut ? pe : null, start = portXY(pe);
      if (!isOut) {   /* dragging from an input: pick up the wire that's there (to move or drop it) */
        var bid = pe.getAttribute("data-block"), port = pe.getAttribute("data-port"), idx = -1;
        P.graph.wires.forEach(function (w, i) { var t = wireParts(w.to); if (t[0] === bid && (t[1] || "in") === port) idx = i; });
        if (idx < 0) return;
        var src = wireParts(P.graph.wires[idx].from)[0]; P.graph.wires.splice(idx, 1); from = findPort(src, "out", true); if (!from) return; start = portXY(from); drawWires();
      }
      var path = document.createElementNS("http://www.w3.org/2000/svg", "path"); path.setAttribute("class", "cpb-wire cpb-wire-temp"); svg.appendChild(path);
      function mv(ev) { var c = canvas.getBoundingClientRect(); path.setAttribute("d", curve(start, [ev.clientX - c.left, ev.clientY - c.top])); }
      function up(ev) {
        window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); path.remove();
        var target = document.elementFromPoint(ev.clientX, ev.clientY);
        if (target && target.classList.contains("cpb-in")) connect(from.getAttribute("data-block"), target.getAttribute("data-block"), target.getAttribute("data-port"));
        else { commit("unwire"); render(); }
      }
      window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
    }
    function reaches(a, b) {   /* is there a path of wires from a to b? */
      var seen = {}, stack = [a];
      while (stack.length) { var x = stack.pop(); if (x === b) return true; if (seen[x]) continue; seen[x] = 1; P.graph.wires.forEach(function (w) { if (wireParts(w.from)[0] === x) stack.push(wireParts(w.to)[0]); }); }
      return false;
    }
    function connect(fromId, toId, port) {
      if (fromId === toId) { say("A block can't be wired into itself. For repeats, use a Delay's feedback.", true); render(); return; }
      if (reaches(toId, fromId)) { say("That wire would make a loop. For repeats or feedback, use a Delay's feedback knob.", true); render(); return; }
      var to = toId + "." + port, dup = P.graph.wires.some(function (w) { return wireParts(w.from)[0] === fromId && w.to === to; });
      if (!dup) {
        var tb = block(toId), isCtl = tb && T[tb.type] && T[tb.type].ports.some(function (p) { return p.name === port && !p.audio; });
        if (isCtl) P.graph.wires = P.graph.wires.filter(function (w) { return w.to !== to; });   /* (a knob input takes one wire) */
        P.graph.wires.push({ from: fromId + ".out", to: to });
      }
      commit("wire"); render();
    }
    function markSelection() {
      if (!canvas) return;
      canvas.querySelectorAll(".cpb-block").forEach(function (c) { c.classList.toggle("sel", !!sel && sel.kind === "block" && c.getAttribute("data-id") === sel.id); });
    }
    function removeSelected() {
      if (!sel) return;
      if (sel.kind === "block") { var id = sel.id; P.graph.blocks = P.graph.blocks.filter(function (b) { return b.id !== id; }); P.graph.wires = P.graph.wires.filter(function (w) { return wireParts(w.from)[0] !== id && wireParts(w.to)[0] !== id; }); }
      else if (sel.kind === "wire") P.graph.wires.splice(sel.i, 1);
      sel = null; commit("remove"); render();
    }

    /* ---- the inspector: the selected block's settings */
    function renderInspector() {
      if (!inspector) return; inspector.innerHTML = "";
      if (!sel) {
        inspector.appendChild(el("h3", { text: "Your plugin" }));
        inspector.appendChild(el("label", {}, ["Made by", el("input", { value: P.author || "", maxlength: "60", oninput: function (e) { P.author = e.target.value; }, onchange: function () { commit("author"); } })]));
        inspector.appendChild(el("label", {}, ["What it's for", el("textarea", { rows: "3", maxlength: "300", text: P.description || "", oninput: function (e) { P.description = e.target.value; }, onchange: function () { commit("description"); } })]));
        inspector.appendChild(el("p", { class: "cpb-hint", text: "Click a block to change it. Drag from a block's right dot to another block's left dot to wire them. Select something and press Delete to remove it." }));
        return;
      }
      if (sel.kind === "wire") {
        var w = P.graph.wires[sel.i]; if (!w) { sel = null; return renderInspector(); }
        inspector.appendChild(el("h3", { text: "Wire" }));
        inspector.appendChild(el("p", { text: "From " + wireParts(w.from)[0] + " to " + wireParts(w.to)[0] + "'s " + portLabel(wireParts(w.to)[1] || "in") + "." }));
        inspector.appendChild(el("button", { type: "button", class: "cpb-danger", text: "Remove this wire", onclick: removeSelected }));
        return;
      }
      var b = block(sel.id); if (!b) { sel = null; return renderInspector(); }
      var t = T[b.type];
      inspector.appendChild(el("h3", { text: (NAMES[b.type] || [b.type])[0] }));
      inspector.appendChild(el("p", { class: "cpb-hint", text: (NAMES[b.type] || ["", ""])[1] }));
      var idIn = el("input", { value: b.id, maxlength: "31", "aria-label": "Block name", onchange: function () {
        var v = idIn.value.trim().replace(/[\s."]+/g, "_"); if (!v || v === b.id) { idIn.value = b.id; return; }
        if (block(v)) { say("Another block is already called " + v + ".", true); idIn.value = b.id; return; }
        var old = b.id; b.id = v; P.graph.wires.forEach(function (w) { var f = wireParts(w.from), to = wireParts(w.to); if (f[0] === old) w.from = v + (f[1] ? "." + f[1] : ""); if (to[0] === old) w.to = v + (to[1] ? "." + to[1] : ""); });
        sel.id = v; commit("rename"); render();
      } });
      inspector.appendChild(el("label", {}, ["Name", idIn]));
      if (!t) return;
      Object.keys(t.choices || {}).forEach(function (k) {
        var s = el("select", { onchange: function () { b.props[k] = s.value; commit("choice"); render(); } }, t.choices[k].map(function (v) { return el("option", { value: v, text: CHOICE_NAMES[v] || v, selected: (b.props[k] || t.choices[k][0]) === v }); }));
        inspector.appendChild(el("label", {}, [k === "op" ? "Does" : k[0].toUpperCase() + k.slice(1), s]));
      });
      (NUMPROPS[b.type] || []).forEach(function (np) {
        var v = b.props[np[0]] != null ? b.props[np[0]] : NUMDEF[np[0]], inp;
        if (np[0] === "slope") inp = el("select", { onchange: function () { b.props.slope = +inp.value; commit("slope"); render(); } }, [12, 24].map(function (x) { return el("option", { value: String(x), text: x + " dB per octave", selected: +v === x }); }));
        else inp = el("input", { type: "number", min: String(np[2][0]), max: String(np[2][1]), value: String(v), onchange: function () { var x = Math.max(np[2][0], Math.min(np[2][1], +inp.value || NUMDEF[np[0]])); b.props[np[0]] = x; commit("num"); render(); } });
        inspector.appendChild(el("label", {}, [np[1] + (np[3] && np[0] !== "slope" ? " (" + np[3] + ")" : ""), inp]));
      });
      if (b.type === "param") {
        var ps = el("select", { onchange: function () { if (ps.value === "+") { var id = addKnob(); b.props.param = id; } else b.props.param = ps.value; commit("knob"); render(); } },
          P.params.map(function (q) { return el("option", { value: q.id, text: q.name + " (" + q.id + ")", selected: b.props.param === q.id }); }).concat([el("option", { value: "+", text: "A new knob…" })]));
        inspector.appendChild(el("label", {}, ["Sends the knob", ps]));
      }
      if (b.type === "delay") {   // (10.4) a delay on a note value: the plugin gets a Tempo knob, which the apps set to the song's tempo
        var TN = (window.PPPedals && window.PPPedals.tempo && window.PPPedals.tempo.NOTES) || SYNC_NOTES;
        var syn = el("select", { onchange: function () { syncDelay(b, syn.value); commit("sync"); render(); } }, [el("option", { value: "", text: "Off (its own time)", selected: !b.props.sync })].concat(TN.map(function (n) { return el("option", { value: n[0], text: n[1], selected: b.props.sync === n[0] }); })));
        inspector.appendChild(el("label", {}, ["Sync to tempo", syn]));
        if (b.props.sync) inspector.appendChild(el("p", { class: "cpb-hint", text: (TN.filter(function (n) { return n[0] === b.props.sync; })[0] || ["", b.props.sync])[1] + " repeats at the plugin's Tempo knob. The apps turn that knob to the song's tempo, so the repeats stay in time." }));
      }
      if (b.type === "code") inspector.appendChild(el("button", { type: "button", text: "Edit the code", onclick: function () { codeTarget = b.id; tab = "code"; render(); } }));
      t.ports.forEach(function (p) { if (!p.audio) inspector.appendChild(portControl(b, p)); });
      var feeds = t.ports.filter(function (p) { return p.audio; }).map(function (p) {
        var from = P.graph.wires.filter(function (w) { var to = wireParts(w.to); return to[0] === b.id && (to[1] || "in") === p.name; }).map(function (w) { return wireParts(w.from)[0]; });
        return portLabel(p.name) + ": " + (from.length ? from.join(" + ") : "nothing yet");
      });
      if (feeds.length) inspector.appendChild(el("p", { class: "cpb-hint", text: feeds.join(" · ") }));
      inspector.appendChild(el("button", { type: "button", class: "cpb-danger", text: "Remove this block", onclick: removeSelected }));
    }
    // (10.4) "Sync to tempo" on a delay: a knob block for the plugin's Tempo knob and a Maths block (note length × 60000 / BPM)
    // wired into the delay's time, so it plays the same everywhere a Central FX plugin plays. Off takes them out again.
    function syncDelay(b, note) {
      var TN = (window.PPPedals && window.PPPedals.tempo && window.PPPedals.tempo.NOTES) || SYNC_NOTES, beats = (TN.filter(function (n) { return n[0] === note; })[0] || [])[2];
      var old = b.props.syncBlocks || [], isTempo = function (q) { return q.id === "tempo" || q.id === "bpm" || String(q.unit || "").toUpperCase() === "BPM"; };
      P.graph.blocks = P.graph.blocks.filter(function (x) { return old.indexOf(x.id) < 0; });
      P.graph.wires = P.graph.wires.filter(function (w) { return old.indexOf(wireParts(w.from)[0]) < 0 && old.indexOf(wireParts(w.to)[0]) < 0; });
      delete b.props.sync; delete b.props.syncBlocks;
      if (!note || !beats) {   // off: a Tempo knob we added goes when nothing else uses it
        P.params.filter(function (q) { return q.auto && isTempo(q); }).forEach(function (q) { var used = P.graph.blocks.some(function (x) { return (x.type === "param" && x.props.param === q.id) || Object.keys(x.props).some(function (k) { return x.props[k] && x.props[k].param === q.id; }); }); if (!used) P.params.splice(P.params.indexOf(q), 1); });
        return;
      }
      var tq = P.params.filter(isTempo)[0];
      if (!tq) { if (P.params.length >= 32) { say("A plugin can have up to 32 knobs: take one out to sync the delay.", true); return; } var tid = "bpm", k = 2; while (P.params.some(function (q) { return q.id === tid; })) tid = "bpm" + k++; tq = { id: tid, name: "Tempo", min: 40, max: 240, default: 120, unit: "BPM", auto: true }; P.params.push(tq); }
      var base = b.id.slice(0, 22), ids = [base + "_tempo", base + "_note"]; ids = ids.map(function (id) { var x = id, n = 2; while (block(x)) x = id + n++; return x; });
      P.graph.wires = P.graph.wires.filter(function (w) { var to = wireParts(w.to); return !(to[0] === b.id && to[1] === "time"); }); delete b.props.time;
      P.graph.blocks.push({ id: ids[0], type: "param", x: (b.x || 0) - 200, y: (b.y || 0) - 150, props: { param: tq.id } });
      P.graph.blocks.push({ id: ids[1], type: "math", x: (b.x || 0) - 200, y: (b.y || 0) - 60, props: { op: "divide", a: Math.round(beats * 60000 * 1000) / 1000 } });
      P.graph.wires.push({ from: ids[0] + ".out", to: ids[1] + ".b" }, { from: ids[1] + ".out", to: b.id + ".time" });
      b.props.sync = note; b.props.syncBlocks = ids; b.props.maxTime = Math.min(10000, Math.max(b.props.maxTime || 2000, Math.ceil(beats * 60000 / (tq.min > 0 ? tq.min : 40))));
    }
    function addKnob(from) {
      var base = from ? from.name : "knob", id = base, i = 2; while (P.params.some(function (q) { return q.id === id; })) id = base + i++;
      var q = from ? { id: id, name: portLabel(from.name), min: from.min, max: from.max, default: from.value, unit: (PORTS[from.name] || [])[1] === "%" ? "" : (PORTS[from.name] || [])[1] || "" } : { id: id, name: "Knob", min: 0, max: 1, default: 0.5 };
      if (from && (PORTS[from.name] || [])[2] && q.min > 0) q.curve = "log";
      if (P.params.length >= 32) { say("A plugin can have up to 32 knobs.", true); return P.params[0] && P.params[0].id; }
      P.params.push(q); return id;
    }
    function portControl(b, p) {
      var meta = PORTS[p.name] || [p.name, ""], unit = b.type === "transient" && p.name === "attack" ? "%" : meta[1], logScale = meta[2] && p.min > 0, wrap = el("div", { class: "cpb-ctl-row" });
      var wired = P.graph.wires.filter(function (w) { var to = wireParts(w.to); return to[0] === b.id && to[1] === p.name; })[0];
      wrap.appendChild(el("div", { class: "cpb-ctl-name", text: meta[0] }));
      if (wired) {
        wrap.appendChild(el("div", { class: "cpb-hint", text: "Moved by " + wireParts(wired.from)[0] + "." }));
        wrap.appendChild(el("button", { type: "button", class: "cpb-small", text: "Unwire", onclick: function () { P.graph.wires = P.graph.wires.filter(function (w) { return w !== wired; }); commit("unwire"); render(); } }));
        return wrap;
      }
      var bound = b.props[p.name] && typeof b.props[p.name] === "object" ? b.props[p.name].param : "";
      var lo = Math.max(p.min, -1e6), hi = Math.min(p.max, 1e6);
      if (lo <= -1e6 || hi >= 1e6) { lo = -10; hi = 10; }
      var toS = function (v) { return logScale ? Math.log(v / lo) / Math.log(hi / lo) : (v - lo) / (hi - lo); }, fromS = function (s) { return logScale ? lo * Math.pow(hi / lo, s) : lo + s * (hi - lo); };
      var v = propValue(b, p), shown = el("span", { class: "cpb-val", text: fmt(v, unit) });
      var slider = el("input", { type: "range", min: "0", max: "1000", value: String(Math.round(toS(v) * 1000)), disabled: !!bound, "aria-label": meta[0], oninput: function () { var x = fromS(+slider.value / 1000); x = Math.abs(x) >= 100 ? Math.round(x) : Math.round(x * 1000) / 1000; b.props[p.name] = x; shown.textContent = fmt(x, unit); scheduleLive(); }, onchange: function () { commit("knob"); render(); } });
      var knob = el("select", { class: "cpb-small", "aria-label": meta[0] + " follows", onchange: function () {
        if (knob.value === "") delete b.props[p.name]; else if (knob.value === "+") b.props[p.name] = { param: addKnob({ name: p.name, min: lo, max: hi, value: v }) }; else b.props[p.name] = { param: knob.value };
        commit("bind"); render();
      } }, [el("option", { value: "", text: "Set here", selected: !bound })].concat(P.params.map(function (q) { return el("option", { value: q.id, text: "Knob: " + q.name, selected: bound === q.id }); })).concat([el("option", { value: "+", text: "Make it a knob…" })]));
      wrap.appendChild(el("div", { class: "cpb-ctl-line" }, [slider, bound ? el("span", { class: "cpb-val", text: "⟲ " + bound }) : shown]));
      wrap.appendChild(knob);
      return wrap;
    }

    /* ---- the Code tab */
    var editor, ta, pre, gutter, errBox;
    function codeOwner() { var b = codeTarget && block(codeTarget); return b && b.type === "code" ? b : null; }
    function codeText() { var b = codeOwner(); return b ? String(b.props.code || "") : String(P.code || ""); }
    function setCode(s) { var b = codeOwner(); if (b) b.props.code = s; else P.code = s; }
    function renderCode() {
      var wrap = el("div", { class: "cpb-code" }), owners = P.graph.blocks.filter(function (b) { return b.type === "code"; });
      var pick = el("select", { "aria-label": "Which code", onchange: function () { codeTarget = pick.value || null; render(); } },
        [el("option", { value: "", text: P.graph.blocks.length ? "The plugin's own code (used by code blocks that have none)" : "The whole plugin (there are no blocks)", selected: !codeOwner() })]
          .concat(owners.map(function (b) { return el("option", { value: b.id, text: "Code block " + b.id, selected: codeOwner() === b }); })));
      wrap.appendChild(el("div", { class: "cpb-code-top" }, [pick, P.graph.blocks.length && !codeOwner() ? el("span", { class: "cpb-hint", text: "With blocks, put a Code block in the wiring to use code." }) : null,
        !P.graph.blocks.length ? null : el("button", { type: "button", class: "cpb-small", text: "Make the whole plugin code", title: "Remove the blocks and play only this code", onclick: function () {
          if (!window.confirm("Remove every block and make this plugin only code?")) return;
          if (!P.code) P.code = "// Your plugin as code\n@sample\noutL = inL\noutR = inR\n"; P.graph.blocks = []; P.graph.wires = []; codeTarget = null; commit("all code"); render();
        } })]));
      editor = el("div", { class: "cpb-editor" });
      gutter = el("div", { class: "cpb-gutter", "aria-hidden": "true" });
      pre = el("pre", { class: "cpb-hl", "aria-hidden": "true" });
      ta = el("textarea", { class: "cpb-ta", spellcheck: "false", autocapitalize: "off", autocomplete: "off", "aria-label": "Code", wrap: "off" });
      ta.value = codeText();
      ta.addEventListener("input", function () { setCode(ta.value); paintCode(); clearTimeout(changeT); changeT = setTimeout(function () { commit("code"); }, 400); });
      ta.addEventListener("scroll", function () { pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft; gutter.scrollTop = ta.scrollTop; });
      ta.addEventListener("keydown", function (e) {
        if (e.key === "Tab") { e.preventDefault(); var s = ta.selectionStart; ta.setRangeText("  ", s, ta.selectionEnd, "end"); ta.dispatchEvent(new Event("input")); }
      });
      editor.appendChild(gutter); editor.appendChild(pre); editor.appendChild(ta);
      errBox = el("div", { class: "cpb-code-err", role: "status" });
      wrap.appendChild(editor); wrap.appendChild(errBox);
      var help = el("details", { class: "cpb-help" }, [el("summary", { text: "How the code works" })].concat(HELP.map(function (h) { return el("p", {}, [el("b", { text: h[0] + ": " }), h[1]]); })));
      wrap.appendChild(help);
      main.appendChild(wrap); paintCode();
    }
    function paintCode() {
      var src = ta.value, ids = {}, out = "", re = /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|(@\w+)|(\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+)|([A-Za-z_]\w*)|([^\w\s]+)|(\s+)/g, m;
      P.params.forEach(function (q) { ids[q.id] = 1; });
      while ((m = re.exec(src))) {
        var tok = esc(m[0]);
        if (m[1]) out += '<span class="c">' + tok + "</span>"; else if (m[2]) out += '<span class="s">' + tok + "</span>"; else if (m[3]) out += '<span class="n">' + tok + "</span>";
        else if (m[4]) out += CODE_WORDS.test(m[4]) ? '<span class="k">' + tok + "</span>" : CODE_NAMES.test(m[4]) ? '<span class="b">' + tok + "</span>" : CODE_FUNCS.test(m[4]) ? '<span class="f">' + tok + "</span>" : ids[m[4]] ? '<span class="p">' + tok + "</span>" : tok;
        else out += tok;
      }
      pre.innerHTML = out + "\n";
      var lines = src.split("\n").length, g = ""; for (var i = 1; i <= lines; i++) g += '<div data-line="' + i + '">' + i + "</div>"; gutter.innerHTML = g;
      clearTimeout(checkT); checkT = setTimeout(function () { runCheck(); markCodeError(); }, 250);
    }
    function markCodeError() {
      if (!errBox || !gutter) return;
      var err = "";
      if (window.CMFx) { var r = window.CMFx.checkCode(ta.value); err = r.ok ? "" : r.error; if (!err && lastError && /line \d+/.test(lastError)) err = lastError.replace(/^[^:]*: (line \d+)/, "$1"); }
      var line = (/line (\d+)/.exec(err) || [])[1];
      gutter.querySelectorAll("div").forEach(function (d) { d.classList.toggle("bad", d.getAttribute("data-line") === line); });
      errBox.textContent = err ? err : "No mistakes found.";
      errBox.className = "cpb-code-err" + (err ? " bad" : "");
    }

    /* ---- the Knobs tab */
    function renderKnobs() {
      var wrap = el("div", { class: "cpb-knobs" });
      wrap.appendChild(el("p", { class: "cpb-hint", text: "Knobs are what people turn when they use your plugin. Link a block's setting to a knob in its settings, or read a knob by its id in code." }));
      var table = el("table", { class: "cpb-ktable" }, [el("tr", {}, ["Name", "Id (for code)", "Lowest", "Highest", "Starts at", "Unit", "Log scale", ""].map(function (h) { return el("th", { text: h }); }))]);
      P.params.forEach(function (q, i) {
        function cell(key, type, w) {
          var inp = el("input", { type: type || "text", value: q[key] == null ? "" : String(q[key]), style: w ? "width:" + w : null, onchange: function () {
            var v = type === "number" ? +inp.value : inp.value.trim();
            if (key === "id") { if (!/^[A-Za-z_]\w{0,30}$/.test(v)) { say("A knob's id is letters, numbers and _ (no spaces), starting with a letter.", true); inp.value = q.id; return; } if (P.params.some(function (o) { return o !== q && o.id === v; })) { say("Another knob already has the id " + v + ".", true); inp.value = q.id; return; } renameKnob(q.id, v); }
            q[key] = v; if (key === "min" || key === "max") { if (!(q.max > q.min)) say("Highest must be bigger than lowest.", true); q.default = Math.max(q.min, Math.min(q.max, q.default)); }
            commit("knob"); render();
          } });
          return el("td", {}, [inp]);
        }
        table.appendChild(el("tr", {}, [cell("name"), cell("id", "text", "110px"), cell("min", "number", "80px"), cell("max", "number", "80px"), cell("default", "number", "80px"), cell("unit", "text", "60px"),
          el("td", {}, [el("input", { type: "checkbox", checked: q.curve === "log", title: "For frequencies and times", onchange: function (e) { if (e.target.checked) q.curve = "log"; else delete q.curve; commit("curve"); render(); } })]),
          el("td", {}, [el("button", { type: "button", class: "cpb-small cpb-danger", text: "Remove", onclick: function () {
            var used = JSON.stringify(P.graph).indexOf('"' + q.id + '"') >= 0; if (used && !window.confirm("Blocks use the knob " + q.name + ". Remove it anyway? They go back to their own values.")) return;
            P.params.splice(i, 1); unbindKnob(q.id); commit("remove knob"); render();
          } })])]));
      });
      wrap.appendChild(table);
      wrap.appendChild(el("button", { type: "button", text: "Add a knob", disabled: P.params.length >= 32, onclick: function () { addKnob(); commit("add knob"); render(); } }));
      main.appendChild(wrap);
    }
    function renameKnob(a, b) { P.graph.blocks.forEach(function (bl) { Object.keys(bl.props).forEach(function (k) { var v = bl.props[k]; if (v && typeof v === "object" && v.param === a) v.param = b; if (bl.type === "param" && k === "param" && v === a) bl.props.param = b; }); }); }
    function unbindKnob(a) { P.graph.blocks.forEach(function (bl) { Object.keys(bl.props).forEach(function (k) { var v = bl.props[k]; if (v && typeof v === "object" && v.param === a) delete bl.props[k]; }); if (bl.type === "param" && bl.props.param === a) bl.props.param = P.params[0] ? P.params[0].id : ""; }); }

    /* ---- the foot: the plugin's panel (its knobs) and the live test */
    var ctx = null, src = null, live = null, liveSig = "", meter = null, raf = 0, playing = false, panelVals = {}, mic = null, bypass = false, outGain = null, an = null;
    function renderFoot() {
      foot.innerHTML = "";
      var panel = el("div", { class: "cpb-panel", "aria-label": "Your plugin's knobs" });
      if (!P.params.length) panel.appendChild(el("span", { class: "cpb-hint", text: "No knobs yet: add them in the Knobs tab." }));
      P.params.forEach(function (q) {
        var v = panelVals[q.id] != null ? panelVals[q.id] : q.default, logS = q.curve === "log" && q.min > 0;
        var toS = function (x) { return logS ? Math.log(x / q.min) / Math.log(q.max / q.min) : (x - q.min) / (q.max - q.min || 1); }, fromS = function (s) { return logS ? q.min * Math.pow(q.max / q.min, s) : q.min + s * (q.max - q.min); };
        var shown = el("span", { class: "cpb-val", text: fmt(v, q.unit) });
        var r = el("input", { type: "range", min: "0", max: "1000", value: String(Math.round(toS(v) * 1000)), "aria-label": q.name, oninput: function () { var x = fromS(+r.value / 1000); panelVals[q.id] = x; shown.textContent = fmt(x, q.unit); if (live) live.setParam(q.id, x); } });
        panel.appendChild(el("label", { class: "cpb-knob" }, [el("span", { text: q.name }), r, shown]));
      });
      var srcSel = el("select", { "aria-label": "Test sound", onchange: function () { if (playing) { stopTest(); startTest(); } } },
        [["guitar", "Guitar"], ["drums", "Drums"], ["voice", "Voice"], ["keys", "Keys"], ["noise", "Noise"], ["mic", "Your microphone"]].map(function (s) { return el("option", { value: s[0], text: s[1] }); }));
      srcSel.className = "cpb-src";
      var play = el("button", { type: "button", class: "cpb-play" + (playing ? " on" : ""), text: playing ? "Stop" : "Try it", onclick: function () {
        if (opts.onTest && !playing) { var handled = opts.onTest(getPlugin()); if (handled === true) return; }
        if (playing) stopTest(); else startTest();
      } });
      var by = el("label", { class: "cpb-bypass" }, [el("input", { type: "checkbox", checked: bypass, onchange: function (e) { bypass = e.target.checked; if (playing) wireTest(); } }), "Hear it without the plugin"]);
      meter = el("div", { class: "cpb-meter", "aria-hidden": "true" }, [el("i")]);
      foot.appendChild(panel);
      foot.appendChild(el("div", { class: "cpb-test" }, [srcSel, play, by, meter]));
      foot.__src = srcSel;
    }
    function scheduleLive() { if (!playing) return; clearTimeout(liveT); liveT = setTimeout(rebuildLive, 300); }
    function rebuildLive() {
      if (!playing || !ctx || !window.CMFx) return;
      var sig = JSON.stringify(P); if (live && sig === liveSig) return;
      var r = window.CMFx.check(P); if (!r.ok) return;   /* (keep playing the last plugin that worked) */
      var old = live; liveSig = sig;
      live = window.CMFx.create(ctx, P, { values: panelVals, onError: function (e) { say("It can't play: " + e, true); }, onStatus: function (s) { if (s) say(s, true); } });
      live.ready.then(function () { if (!playing) { live.dispose(); return; } wireTest(); if (old) setTimeout(function () { old.dispose(); }, 60); });
    }
    function wireTest() {
      if (!src || !live) return;
      try { src.disconnect(); } catch (_) { }
      src.connect(bypass ? outGain : live.node); if (!bypass) live.node.connect(outGain);
    }
    function startTest() {
      if (!window.CMFx) { say("The plugin player (cmfx.js) isn't loaded on this page.", true); return; }
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === "suspended") ctx.resume();
      playing = true; outGain = ctx.createGain(); outGain.gain.value = 0.8; an = ctx.createAnalyser(); an.fftSize = 1024; outGain.connect(an); an.connect(ctx.destination);
      var kind = foot.__src ? foot.__src.value : "guitar";
      var go = function (node) { src = node; live = null; liveSig = ""; rebuildLive(); if (src.start) src.start(); tickMeter(); renderFoot(); foot.__src.value = kind; };
      if (kind === "mic") {
        navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }).then(function (stream) { mic = stream; go(ctx.createMediaStreamSource(stream)); })
          .catch(function () { playing = false; say("The microphone isn't available (it may need your permission).", true); renderFoot(); });
      } else { var s = ctx.createBufferSource(); s.buffer = testSound(ctx, kind); s.loop = true; go(s); }
    }
    function stopTest() {
      playing = false; cancelAnimationFrame(raf);
      try { if (src && src.stop) src.stop(); } catch (_) { } try { if (src) src.disconnect(); } catch (_) { }
      if (mic) { mic.getTracks().forEach(function (t) { t.stop(); }); mic = null; }
      if (live) { live.dispose(); live = null; } liveSig = "";
      if (outGain) { try { outGain.disconnect(); } catch (_) { } }
      src = null; renderFoot(); runCheck();
    }
    function tickMeter() {
      if (!playing || !an) return; var d = new Float32Array(an.fftSize); an.getFloatTimeDomainData(d); var e = 0; for (var i = 0; i < d.length; i++) e += d[i] * d[i];
      var db = 20 * Math.log10(Math.sqrt(e / d.length) + 1e-9), w = Math.max(0, Math.min(100, (db + 60) / 60 * 100));
      if (meter && meter.firstChild) meter.firstChild.style.width = w + "%";
      raf = requestAnimationFrame(tickMeter);
    }

    /* ---- drawing it all */
    function render() {
      if (dead) return;
      renderBar(); main.innerHTML = ""; canvas = svg = inspector = null; main.className = "cpb-main cpb-tab-" + tab;
      if (tab === "blocks") renderBlocks(); else if (tab === "code") renderCode(); else renderKnobs();
      renderFoot();
    }
    function onKey(e) {
      if (dead || !root.contains(document.activeElement) && document.activeElement !== document.body) return;
      var typing = /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || "");
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !typing) { e.preventDefault(); if (e.shiftKey) doRedo(); else doUndo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y" && !typing) { e.preventDefault(); doRedo(); }
      else if ((e.key === "Delete" || e.key === "Backspace") && !typing && tab === "blocks" && sel) { e.preventDefault(); removeSelected(); }
    }
    if (overlaps()) { tidy(); last = JSON.stringify(P); }
    document.addEventListener("keydown", onKey);
    var ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(function () { drawWires(); }) : null; if (ro) ro.observe(root);
    render(); runCheck();
    return {
      getPlugin: getPlugin,
      setPlugin: function (p) { undo.push(last); redo = []; restore(JSON.stringify(normal(clone(p)))); },
      unmount: function () { dead = true; stopTest(); document.removeEventListener("keydown", onKey); if (ro) ro.disconnect(); if (ctx && ctx.close) ctx.close(); host.innerHTML = ""; }
    };
  }

  window.CPPluginBuilder = { mount: mount, blank: blank, presets: presets, names: NAMES };
})();
