/* Central Production - Sample: record or bring in a sound, then trim, normalise, fade, reverse and slice it. It exports
 * as WAV / MP3 (or a WAV per slice), installs as a playable sound (a SoundFont) and publishes to Make & sell as Samples.
 * Every edit makes a new version of the sound in memory, so Undo steps back through them. */
(function () {
  "use strict";
  var A = window.CPAudio, Z = window.CMProj, H = window.CPHost, S = window.CDaw, SM = window.CPSampler;
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) { return window.CP.esc(s); }
  var bufs = {}, ui = { el: null, sel: null, view: null, drag: null, rec: null, playing: null, loop: false };
  function ctx() { return S.ctx(); }
  function D() { return window.CP.project().data; }
  function cur() { return bufs[D().cur] || null; }
  function NOTE(n) { return ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"][n % 12] + (Math.floor(n / 12) - 1); }
  function put(buf, label) {   // a new version of the sound (Undo goes back to the one before)
    var id = window.CP.uid("a"); bufs[id] = buf;
    window.CP.edit(label, function (d) { d.cur = id; if (!d.name) d.name = window.CP.project().name; d.slices = (label === "Slice" || label === "Clear slices") ? d.slices : []; });
    ui.sel = null; ui.view = null; draw();
  }
  function selFrames() { var b = cur(); if (!b) return null; var s = ui.sel; return s && s[1] - s[0] > 32 ? [Math.max(0, Math.min(s[0], s[1])), Math.min(b.length, Math.max(s[0], s[1]))] : null; }

  function mount(el) {
    ui.el = el;
    el.innerHTML = '<div class="cp-ed cp-sample">' +
      '<div class="cp-tools"><div class="cp-group"><button id="smRec" class="cp-rec">● Record</button><select id="smIn" aria-label="Input"></select><button id="smImport">Bring in a file…</button></div>' +
      '<div class="cp-group"><button id="smPlay">▶ Play</button><button id="smStop">■</button><label class="toggle"><input type="checkbox" id="smLoop"> Loop</label></div>' +
      '<div class="cp-group"><button id="smTrim" title="Keep only the selection">Trim</button><button id="smCut" title="Remove the selection">Delete</button><button id="smNorm" title="Make the loudest point -1 dB">Normalise</button><button id="smFadeIn">Fade in</button><button id="smFadeOut">Fade out</button><button id="smRev">Reverse</button><button id="smLouder">+3 dB</button><button id="smQuieter">−3 dB</button></div>' +
      '<div class="cp-group"><button id="smZoom">Zoom to selection</button><button id="smAll">Show all</button></div></div>' +
      '<div class="cp-wave-wrap" id="smDrop"><canvas id="smWave" class="cp-wave"></canvas><div class="cp-wave-empty" id="smEmpty">Record something, or drop an audio file here (WAV, MP3, AIFF, FLAC).</div></div>' +
      '<div class="cp-info" id="smInfo"></div>' +
      '<div class="cp-tools"><div class="cp-group"><b>Slices</b><label>Into <select id="smN"><option>2</option><option>4</option><option selected>8</option><option>16</option><option>32</option></select> equal parts</label><button id="smSliceN">Slice</button><button id="smSliceHits" title="A slice at each hit (drums, plucks)">Slice at each hit</button><button id="smSliceSel" title="A slice where the selection starts">Add a slice here</button><button id="smClear">Clear slices</button></div>' +
      '<div class="cp-group"><b>Plays as</b><label>Root note <select id="smRoot"></select></label></div></div>' +
      '<div class="cp-slices" id="smSlices"></div></div>';
    var rs = $("#smRoot", el); for (var n = 24; n <= 96; n++) rs.innerHTML += '<option value="' + n + '">' + NOTE(n) + "</option>";
    wire(el); inputs(); draw();
  }
  function inputs() {
    var sel = $("#smIn", ui.el); if (!sel || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    navigator.mediaDevices.enumerateDevices().then(function (ds) { var ins = ds.filter(function (d) { return d.kind === "audioinput"; }); sel.innerHTML = ins.length ? ins.map(function (d, i) { return '<option value="' + esc(d.deviceId) + '">' + esc(d.label || "Input " + (i + 1)) + "</option>"; }).join("") : "<option value=''>Default input</option>"; }).catch(function () { });
  }
  function wire(el) {
    $("#smImport", el).onclick = function () { H.pickFiles(null, false).then(function (fs) { if (fs[0]) bring(fs[0]); }); };
    var drop = $("#smDrop", el);
    drop.ondragover = function (e) { e.preventDefault(); drop.classList.add("over"); }; drop.ondragleave = function () { drop.classList.remove("over"); };
    drop.ondrop = function (e) { e.preventDefault(); drop.classList.remove("over"); var f = e.dataTransfer.files[0]; if (f) f.arrayBuffer().then(function (b) { bring({ name: f.name, bytes: new Uint8Array(b) }); }); };
    $("#smRec", el).onclick = record;
    $("#smPlay", el).onclick = function () { play(); }; $("#smStop", el).onclick = function () { A.stopAudition(); ui.playing = null; };
    $("#smLoop", el).onchange = function () { ui.loop = this.checked; };
    function op(label, fn) { return function () { var b = cur(); if (!b) return window.CP.toast("Record or bring in a sound first.", "bad"); var r = fn(b, selFrames()); if (r) put(r, label); }; }
    $("#smTrim", el).onclick = op("Trim", function (b, s) { if (!s) { window.CP.toast("Select the part to keep first (drag on the waveform).", "bad"); return null; } return A.slice(b, s[0], s[1]); });
    $("#smCut", el).onclick = op("Delete", function (b, s) { if (!s) { window.CP.toast("Select the part to remove first.", "bad"); return null; } var a = A.slice(b, 0, s[0]), z = A.slice(b, s[1], b.length), out = A.make(b.numberOfChannels, a.length + z.length, b.sampleRate); for (var c = 0; c < b.numberOfChannels; c++) { out.getChannelData(c).set(a.getChannelData(c), 0); out.getChannelData(c).set(z.getChannelData(c), a.length); } return out; });
    $("#smNorm", el).onclick = op("Normalise", function (b) { return A.normalize(b, -1); });
    $("#smFadeIn", el).onclick = op("Fade in", function (b, s) { return region(b, s, function (part) { return A.fade(part, part.duration, 0); }, function (bb) { return A.fade(bb, Math.min(0.5, bb.duration / 4), 0); }); });
    $("#smFadeOut", el).onclick = op("Fade out", function (b, s) { return region(b, s, function (part) { return A.fade(part, 0, part.duration); }, function (bb) { return A.fade(bb, 0, Math.min(1.5, bb.duration / 3)); }); });
    $("#smRev", el).onclick = op("Reverse", function (b, s) { return region(b, s, rev, rev); });
    $("#smLouder", el).onclick = op("Louder", function (b, s) { return region(b, s, function (p) { return A.gain(p, 1.4125); }, function (p) { return A.gain(p, 1.4125); }); });
    $("#smQuieter", el).onclick = op("Quieter", function (b, s) { return region(b, s, function (p) { return A.gain(p, 0.7079); }, function (p) { return A.gain(p, 0.7079); }); });
    $("#smZoom", el).onclick = function () { var s = selFrames(); if (s) { ui.view = s; draw(); } };
    $("#smAll", el).onclick = function () { ui.view = null; draw(); };
    $("#smSliceN", el).onclick = function () { var b = cur(); if (!b) return; var n = +$("#smN", el).value; window.CP.edit("Slice", function (d) { d.slices = []; for (var i = 1; i < n; i++) d.slices.push(Math.round(b.length * i / n)); }); draw(); };
    $("#smSliceHits", el).onclick = function () { var b = cur(); if (!b) return; var hits = onsets(b); window.CP.edit("Slice", function (d) { d.slices = hits; }); draw(); window.CP.toast(hits.length ? hits.length + 1 + " slices." : "No clear hits found: try equal parts.", hits.length ? "" : "bad"); };
    $("#smSliceSel", el).onclick = function () { var s = ui.sel; if (!s) return window.CP.toast("Click on the waveform where the slice should start.", "bad"); window.CP.edit("Slice", function (d) { d.slices = (d.slices || []).concat([Math.round(Math.min(s[0], s[1]))]).sort(function (a, b) { return a - b; }); }); draw(); };
    $("#smClear", el).onclick = function () { window.CP.edit("Clear slices", function (d) { d.slices = []; }); draw(); };
    $("#smRoot", el).onchange = function () { var v = +this.value; window.CP.edit("Root note", function (d) { d.root = v; }); };
    var cv = $("#smWave", el);
    function frameAt(e) { var b = cur(), r = cv.getBoundingClientRect(), v = ui.view || [0, b.length]; return Math.round(v[0] + (e.clientX - r.left) / r.width * (v[1] - v[0])); }
    cv.onpointerdown = function (e) { if (!cur()) return; var f = frameAt(e); ui.sel = [f, f]; ui.drag = true; cv.setPointerCapture(e.pointerId); draw(); };
    cv.onpointermove = function (e) { if (!ui.drag) return; ui.sel[1] = frameAt(e); draw(); };
    cv.onpointerup = function () { ui.drag = false; draw(); };
    $("#smSlices", el).onclick = function (e) { var b = e.target.closest("[data-sl]"); if (b) { var sl = slices()[+b.dataset.sl]; A.audition(ctx(), A.slice(cur(), sl[0], sl[1])); } };
  }
  function region(b, s, fnPart, fnAll) {
    if (!s) return fnAll(b);
    var part = fnPart(A.slice(b, s[0], s[1])), out = A.gain(b, 1);
    for (var c = 0; c < b.numberOfChannels; c++) out.getChannelData(c).set(part.getChannelData(c), s[0]);
    return out;
  }
  function rev(b) { var o = A.gain(b, 1); for (var c = 0; c < o.numberOfChannels; c++) o.getChannelData(c).reverse(); return o; }
  // hits: where the level jumps (10 ms windows, a rise of 2.5x over the last 50 ms, at least 80 ms apart)
  function onsets(b) {
    var d = b.getChannelData(0), win = Math.round(b.sampleRate * 0.01), e = [], out = [];
    for (var i = 0; i < d.length; i += win) { var s = 0; for (var k = i; k < i + win && k < d.length; k++) s += d[k] * d[k]; e.push(Math.sqrt(s / win)); }
    var peak = Math.max.apply(null, e.concat([1e-9]));
    for (var j = 5; j < e.length; j++) { var past = (e[j - 1] + e[j - 2] + e[j - 3] + e[j - 4] + e[j - 5]) / 5; if (e[j] > peak * 0.08 && e[j] > past * 2.5 && (!out.length || j * win - out[out.length - 1] > b.sampleRate * 0.08)) out.push(j * win); }
    return out.filter(function (x) { return x > b.sampleRate * 0.02; }).slice(0, 127);
  }
  function slices() { var b = cur(); if (!b) return []; var pts = [0].concat((D().slices || []).filter(function (x) { return x > 0 && x < b.length; })).concat([b.length]); var out = []; for (var i = 0; i < pts.length - 1; i++) if (pts[i + 1] - pts[i] > 64) out.push([pts[i], pts[i + 1]]); return out; }
  function bring(f) {
    return Z.decode(ctx(), f.bytes).then(function (b) {
      put(b, "Bring in " + f.name);
      if (b.__meta && b.__meta.root != null) window.CP.edit("Root note", function (d) { d.root = b.__meta.root; });
      else { var n = SM.noteFromName(f.name); if (n != null) window.CP.edit("Root note", function (d) { d.root = n; }); }
      draw(); window.CP.toast("Brought in " + f.name + ".");
    }).catch(function () { window.CP.toast("That file isn't audio this computer can read.", "bad"); });
  }
  function record() {
    var btn = $("#smRec", ui.el);
    if (ui.rec) { ui.rec.stop(); return; }
    if (!navigator.mediaDevices || !window.MediaRecorder) return window.CP.toast("Recording isn't available here.", "bad");
    var dev = $("#smIn", ui.el).value;
    navigator.mediaDevices.getUserMedia({ audio: Object.assign({ echoCancellation: false, noiseSuppression: false, autoGainControl: false }, dev ? { deviceId: { exact: dev } } : {}) }).then(function (stream) {
      inputs();
      var rec = new MediaRecorder(stream), chunks = [];
      rec.ondataavailable = function (e) { if (e.data.size) chunks.push(e.data); };
      rec.onstop = function () {
        stream.getTracks().forEach(function (t) { t.stop(); }); ui.rec = null; btn.classList.remove("on"); btn.textContent = "● Record";
        new Blob(chunks).arrayBuffer().then(function (ab) { return ctx().decodeAudioData(ab); }).then(function (b) { put(b, "Record"); window.CP.toast("Recorded " + b.duration.toFixed(1) + " s."); }).catch(function () { window.CP.toast("The recording couldn't be read.", "bad"); });
      };
      rec.start(); ui.rec = rec; btn.classList.add("on"); btn.textContent = "■ Stop recording";
    }).catch(function (e) { window.CP.toast("The input couldn't be opened: " + (e.message || e), "bad"); });
  }
  function play() {
    var b = cur(); if (!b) return;
    var s = selFrames(); if (s) A.audition(ctx(), A.slice(b, s[0], s[1]), { loop: ui.loop }); else A.audition(ctx(), b, { loop: ui.loop });
  }
  function draw() {
    if (!ui.el) return;
    var b = cur(), cv = $("#smWave", ui.el); $("#smEmpty", ui.el).hidden = !!b;
    A.draw(cv, b, ui.view ? { from: ui.view[0], to: ui.view[1] } : {});
    if (b) {
      var g = cv.getContext("2d"), w = cv.clientWidth, h = cv.clientHeight, v = ui.view || [0, b.length], x = function (f) { return (f - v[0]) / (v[1] - v[0]) * w; };
      if (ui.sel) { g.fillStyle = "rgba(226,194,126,.18)"; var a = x(Math.min(ui.sel[0], ui.sel[1])), z = x(Math.max(ui.sel[0], ui.sel[1])); g.fillRect(a, 0, Math.max(1, z - a), h); g.fillStyle = "#F0D9A4"; g.fillRect(a, 0, 1, h); }
      g.fillStyle = "#8DB5DE"; (D().slices || []).forEach(function (f) { g.fillRect(x(f), 0, 1.5, h); });
    }
    var s = selFrames(), info = $("#smInfo", ui.el);
    info.textContent = b ? b.duration.toFixed(2) + " s · " + (b.numberOfChannels > 1 ? "stereo" : "mono") + " · " + b.sampleRate + " Hz · loudest " + (20 * Math.log10(Math.max(1e-6, A.peak(b)))).toFixed(1) + " dB" + (s ? " · selected " + ((s[1] - s[0]) / b.sampleRate).toFixed(2) + " s" : "") : "";
    $("#smRoot", ui.el).value = String(D().root == null ? 60 : D().root);
    var sl = slices();
    $("#smSlices", ui.el).innerHTML = sl.length > 1 ? sl.map(function (x, i) { return '<button data-sl="' + i + '" title="Play slice ' + (i + 1) + '">' + (i + 1) + '<span class="muted small">' + NOTE(36 + i) + "</span></button>"; }).join("") + '<span class="muted small">Each slice plays on its own key from C2 up when it\'s installed or published.</span>' : "";
  }

  // what it becomes: one zone (the root note across the keyboard) or a zone per slice, one key each from C2 up
  function instrument() {
    var b = cur(); if (!b) throw new Error("Record or bring in a sound first.");
    var d = D(), sl = slices(), name = window.CP.project().name, buffers = {}, zones = [];
    if (sl.length > 1) sl.forEach(function (x, i) { var id = "slice" + (i + 1); buffers[id] = A.slice(b, x[0], x[1]); zones.push({ sample: id, root: 36 + i, lo: 36 + i, hi: 36 + i, vlo: 1, vhi: 127 }); });
    else { buffers.sample = b; zones.push({ sample: "sample", root: d.root == null ? 60 : d.root, lo: 0, hi: 127, vlo: 1, vhi: 127, loop: b.__meta && b.__meta.loop ? { on: true, start: b.__meta.loop[0], end: b.__meta.loop[1] } : null }); }
    return { inst: { name: name, zones: zones, env: { attack: 0.002, decay: 0.2, sustain: 1, release: 0.25 } }, buffers: buffers };
  }
  function wavFiles() {
    var b = cur(); if (!b) throw new Error("Record or bring in a sound first.");
    var d = D(), sl = slices(), base = Z.slug(window.CP.project().name, "sample");
    if (sl.length > 1) return sl.map(function (x, i) { return { name: base + "-" + String(i + 1).padStart(2, "0") + "-" + NOTE(36 + i).replace("#", "s") + ".wav", data: new Uint8Array(Z.wav(A.slice(b, x[0], x[1]), 24, { root: 36 + i })) }; });
    return [{ name: base + "-" + NOTE(d.root == null ? 60 : d.root).replace("#", "s") + ".wav", data: new Uint8Array(Z.wav(b, 24, { root: d.root == null ? 60 : d.root })) }];
  }
  window.CP.type({
    id: "sample", name: "Sample", blurb: "Record or bring in a sound, then trim, fade and slice it",
    long: "Record from your audio interface or bring in a file, then trim, normalise, fade, reverse and slice it. It plays as a sound in the other apps (each slice on its own key) and publishes to Make & sell as Samples.",
    create: function () { bufs = {}; return { cur: null, slices: [], root: 60 }; },
    load: function (project, files) {
      bufs = {}; var d = project.data || {}; if (!d.cur || !files["audio/" + d.cur + ".wav"]) return null;
      return Z.decode(ctx(), files["audio/" + d.cur + ".wav"]).then(function (b) { bufs[d.cur] = b; });
    },
    mount: mount, unmount: function () { A.stopAudition(); if (ui.rec) ui.rec.stop(); ui.el = null; },
    changed: function () { draw(); },
    collect: function (project) { var f = {}, b = cur(); if (b) f["audio/" + project.data.cur + ".wav"] = new Uint8Array(Z.wav(b, 24, { root: project.data.root })); return { data: project.data, files: f }; },
    exports: [["Export (WAV)", function () { return H.exportFiles(window.CP.project().name, wavFiles()); }, "24-bit WAV, or one per slice"],
      ["Export (MP3)", function () { var b = cur(); if (!b) throw new Error("Record or bring in a sound first."); return H.exportFiles(window.CP.project().name, [{ name: Z.slug(window.CP.project().name) + ".mp3", data: A.mp3(b, 256) }]); }, "256 kbps"],
      ["Export as an instrument (SF2)", function () { var x = instrument(); return H.exportFiles(window.CP.project().name, [{ name: Z.slug(window.CP.project().name) + ".sf2", data: SM.sf2(x.inst, x.buffers) }]); }, "A SoundFont any sampler opens"]],
    publish: { store: "make", kind: "sample", build: function () { var files = wavFiles(), b = cur(); return { zip: Z.zip(files), zipName: Z.slug(window.CP.project().name) + ".zip", demo: A.demo(b, 30) }; } },
    install: function () { var x = instrument(); return { sf2: SM.sf2(x.inst, x.buffers) }; },
    instrument: instrument, buffer: cur
  });
})();
