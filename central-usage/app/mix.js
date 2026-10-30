/* Central Control - the Mix tab (admin): the Central Pedal's tracks, each on its own channel, mixed here.
 * Faders, pan, mute, high-pass, gate, 4-band EQ, compressor and two FX sends (reverb, delay) per channel - with
 * presets (Lead vocal, Kick, ...); out of the audio interface summed (main L/R) or each track on its own output.
 * "Faders: Stream mix" puts the stream mix's own levels on the faders (the live stream's mix: mix-stream.js draws
 * its master, the reverb / delay and where the stream goes). Listen on this computer, record the service
 * (recorder.js fills the record control) and a live waveform of what is going out. The TALK panel above the strips
 * comes from talkback.js. */
(function () {
  "use strict";
  var CU = window.CentralUsage, M = window.CUMixer, X = window.CUMix, IE = window.CUInEar; if (!CU || !M || !X) return;
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function db(v) { return v <= -90 ? "-∞" : (v > 0 ? "+" : "") + Number(v).toFixed(1); }
  var sel = CU.store.get("mxSel", -1), showAll = CU.store.get("mxAll", false), dragging = null, structKey = "", wave = [], rec = null;
  var layer = CU.store.get("mxLayer", "main");   // what the faders move: "main" (the room) or "stream" (the stream mix's own levels)
  // (10.0) a computer that only does the live stream's mix: its faders are the stream's from the start
  function streamOnly() { var j = CU.jobs ? CU.jobs() : ["general"]; return (CU.role() === "admin" || CU.role() === "main") && j.indexOf("stream") >= 0 && j.indexOf("tracks") < 0; }
  if (streamOnly()) layer = "stream";
  CU.on("jobs", function () { if (streamOnly() && layer !== "stream") { layer = "stream"; CU.store.set("mxLayer", layer); } });
  function onStream() { return layer === "stream"; }
  function ss(i) { return (S().stream && S().stream.sends[i]) || { level: -90, pan: 0, on: true }; }
  function fxUsed(x) { return x.fx && (x.fx.rev > -90 || x.fx.dly > -90); }
  function visible() { return CU.prefs.tab === "mix"; }
  function S() { return X.state; }
  function live() { return X.live(); }
  function active(x) { return x.src.kind === "in" || (x.src.kind === "pi" && live()[x.src.key]); }
  function stripInputs() { var s = S(); if (!s) return []; var out = []; s.inputs.forEach(function (x, i) { if (x.src.kind === "none") return; if (!showAll && (x.group !== "tracks" || !active(x))) return; out.push(i); }); return out; }
  function outNames() { var st = X.kind === "local" ? (X.hostStatus && X.hostStatus.engine && X.hostStatus.engine.status) : (X.info && X.info.status); var n = st && st.playbackNames || []; return n; }
  function outOptions(cur, none) { var names = outNames(), h = '<option value="-1"' + (cur < 0 ? " selected" : "") + ">" + (none || "—") + "</option>"; for (var o = 0; o < Math.max(names.length, cur + 1); o++) h += '<option value="' + o + '"' + (o === cur ? " selected" : "") + ">Out " + (o + 1) + (names[o] ? " · " + esc(names[o].replace(/^.*:/, "")) : "") + "</option>"; return h; }
  function srcLabel(x) { if (x.src.kind === "pi") return "Central Pedal" + (live()[x.src.key] ? "" : " (not in this song)"); if (x.src.kind === "in") return "Interface in " + (x.src.ch + 1); return "—"; }
  var timers = {};
  function send(key, op) { var t = timers[key]; if (t && Date.now() - t.at < 35) { clearTimeout(t.id); t.id = setTimeout(function () { t.at = Date.now(); X.op(op); }, 35); return; } timers[key] = { at: Date.now() }; X.op(op); }

  // ------------------------------------------------------------------ listening on this computer + recording
  var listen = { player: null, tap: null, sink: CU.store.get("listenSink", "") };
  X.on("audio", function (pcm, frames, ch, rate, tap) { if (listen.player && (tap == null || listen.tap == null || tap === X.tapNumber(listen.tap))) listen.player.push(pcm, frames, ch, rate); });
  async function startListen(tap) {
    stopListen();
    listen.player = IE.player({ latency: X.kind === "local" ? 50 : 120, sinkId: listen.sink }); await listen.player.start();
    listen.tap = tap; X.listen(tap, true, { rate: 48000 }); render(true);
  }
  function stopListen() { if (listen.tap != null) X.listen(listen.tap, false); listen.tap = null; if (listen.player) { listen.player.stop(); listen.player = null; } }
  window.CUListen = { start: startListen, stop: stopListen, tap: function () { return listen.tap; }, sink: function () { return listen.sink; }, setSink: function (id) { listen.sink = id; CU.store.set("listenSink", id); if (listen.player) listen.player.setSink(id); } };

  // ------------------------------------------------------------------ rendering
  function head() {
    var s = S(), hs = X.hostStatus || {}, pi = hs.pi || {}, m = s.main;
    var link = X.kind === "local" ? "This computer is the audio host" + (hs.engine && hs.engine.status ? " · " + hs.engine.status.backend + " · " + hs.engine.status.rate + " Hz · " + hs.engine.status.block + " frames" : hs.engine && hs.engine.error ? " · ⚠ " + esc(hs.engine.error) : " · starting the engine…") : "Mixing on the audio host " + esc(X.hostAddress());
    var piLine = X.kind === "local" ? (pi.state === "receiving" ? "Central Pedal audio: " + (X.pi.length) + " channels · " + pi.kbps + " kbit/s" + (pi.lost ? " · " + pi.lost + " packets lost" : "") : (hs.cfg && hs.cfg.piAudio && hs.cfg.piAudio.transport === "interface") ? "Central Pedal audio: through the interface inputs" : "Central Pedal audio: " + esc(pi.state || "off") + (pi.error ? " - " + esc(pi.error) : "") + ' <button data-mx-go="io">I/O</button>') : "";
    var listenTaps = '<option value="main"' + (listen.tap === "main" ? " selected" : "") + ">Main mix</option>" + '<option value="stream"' + (listen.tap === "stream" ? " selected" : "") + ">Stream mix</option>" + s.mixes.map(function (q, k) { return '<option value="' + k + '"' + (listen.tap === k ? " selected" : "") + ">Mix " + (k + 1) + " · " + esc(q.owner || q.name) + "</option>"; }).join("");
    return '<div class="card mx-head"><div class="mx-line"><b>' + link + '</b><span class="muted small">' + piLine + "</span></div>" +
      '<div class="mx-row"><div class="mx-grp"><b>Tracks out</b><label class="toggle"><input type="radio" name="mxOut" value="sum"' + (s.trackOut !== "direct" ? " checked" : "") + '> Summed (L / R)</label><label class="toggle"><input type="radio" name="mxOut" value="direct"' + (s.trackOut === "direct" ? " checked" : "") + "> Each track on its own output</label>" +
      (s.trackOut === "direct" ? '<label>starting at <select data-mx-main="directFirst">' + outOptions(s.directFirst).replace('<option value="-1"', '<option value="-1" disabled') + "</select></label>" : '<label>L <select data-mx-main="outL">' + outOptions(m.outL) + '</select></label><label>R <select data-mx-main="outR">' + outOptions(m.outR) + "</select></label>") + "</div>" +
      '<div class="mx-grp mx-mainf"><b>Main</b><input type="range" min="0" max="1" step="0.001" data-mx-main="level" value="' + M.dbToFader(m.level) + '"><span class="mx-mdb">' + db(m.level) + '</span><button data-mx-main="mute" class="' + (m.mute ? "danger on" : "") + '">' + (m.mute ? "Muted" : "Mute") + "</button></div>" +
      '<div class="mx-grp mx-layer" role="group" aria-label="What the faders move"><b>Faders</b><button data-mx-layer="main" class="' + (onStream() ? "" : "on") + '">Main mix</button><button data-mx-layer="stream" class="' + (onStream() ? "on stream" : "") + '" title="The live stream\'s own levels: the room doesn\'t change">Stream mix</button></div></div>' +
      '<div class="mx-row"><div class="mx-grp"><b>Listen here</b><select data-mx-listen="tap">' + listenTaps + '</select><button data-mx-listen="go" class="' + (listen.tap != null ? "on" : "") + '">' + (listen.tap != null ? "■ Stop" : "🎧 Listen") + '</button><select data-mx-listen="sink"><option value="">This computer\'s output</option></select></div>' +
      '<div class="mx-grp mx-rec"><b>Record the service</b><div data-rec-slot></div></div>' +
      '<div class="mx-grp"><label class="toggle"><input type="checkbox" data-mx-all' + (showAll ? " checked" : "") + "> Show every channel (band too)</label>" + (X.kind === "local" ? '<button data-mx-file="export">Save mixer…</button><button data-mx-file="import">Open mixer…</button>' : "") + "</div></div></div>" +
      '<canvas class="mx-wave" id="mxWave" title="What goes out (main mix), last minute"></canvas>';
  }
  function strip(i) {
    var x = S().inputs[i], direct = S().trackOut === "direct" || x.direct >= 0, st = onStream(), sd = ss(i);
    var lvl = st ? sd.level : x.fader, pan = st ? sd.pan : x.pan, muted = st ? sd.on === false : x.mute;
    return '<div class="mx-strip' + (i === sel ? " sel" : "") + (active(x) ? "" : " idle") + (st ? " streaming" : "") + '" data-i="' + i + '"' + (x.color ? ' style="--c:' + esc(x.color) + '"' : "") + '>' +
      '<div class="mx-name" title="' + esc(srcLabel(x)) + '">' + esc(x.name || "Input " + (i + 1)) + '</div><div class="mx-src">' + esc(st ? "Stream mix" : srcLabel(x)) + "</div>" +
      '<div class="mx-body"><div class="mx-meter"><i></i><b></b></div><input type="range" class="mx-fader" min="0" max="1" step="0.001" data-mx="fader" value="' + M.dbToFader(lvl) + '"></div>' +
      '<div class="mx-db">' + db(lvl) + '</div><label class="mx-panbox" title="Pan: left / right (double-click or hold: centre)"><span>PAN</span><input type="range" class="mx-pan" min="-1" max="1" step="0.05" data-mx="pan" value="' + pan + '" aria-label="' + esc(x.name || "Input " + (i + 1)) + ' pan"><b class="mx-panv">' + panText(pan) + '</b></label>' +
      '<div class="mx-btns"><button data-mx="mute" class="' + (muted ? "on danger" : "") + '">M</button><button data-mx="gate" class="' + (x.gate && x.gate.on ? "on" : "") + '" title="Gate">G</button><button data-mx="eq" class="' + (x.eq.on || x.hpf ? "on" : "") + '" title="High-pass and EQ">EQ</button><button data-mx="comp" class="' + (x.comp.on ? "on" : "") + '" title="Compressor">C</button><button data-mx="fx" class="' + (fxUsed(x) ? "on" : "") + '" title="Reverb and delay sends">FX</button></div>' +
      (direct ? '<select data-mx="direct" title="Its own output">' + outOptions(x.direct, S().trackOut === "direct" ? "auto" : "—") + "</select>" : "") + "</div>";
  }
  // pan as people read it: L 30 / C / R 30
  function panText(v) { v = Number(v) || 0; var n = Math.round(Math.abs(v) * 100); return n < 2 ? "C" : (v < 0 ? "L " : "R ") + n; }
  function slider(label, key, min, max, step, v, fmt) { return '<label class="mx-sl"><span>' + label + '</span><input type="range" min="' + min + '" max="' + max + '" step="' + step + '" data-mxd="' + key + '" value="' + v + '"><output>' + fmt(v) + "</output></label>"; }
  function detail() {
    if (sel < 0 || !S().inputs[sel]) return '<p class="muted">Click a channel\'s name for its high-pass, EQ and compressor.</p>';
    var x = S().inputs[sel], e = x.eq, c = x.comp, g = x.gate || {}, fx = x.fx || { rev: -90, dly: -90 }, sd = ss(sel), hz = function (v) { return v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + " kHz" : Math.round(v) + " Hz"; }, dbs = function (v) { return (v > 0 ? "+" : "") + Number(v).toFixed(1) + " dB"; }, ms = function (v) { return (v < 10 ? Number(v).toFixed(1) : Math.round(v)) + " ms"; };
    var fxdb = function (v) { return v <= -90 ? "off" : dbs(v); };
    return '<div class="mx-dhead"><input data-mxd="name" value="' + esc(x.name) + '" placeholder="Name"><input type="color" data-mxd="color" value="' + esc(x.color || "#E2C27E") + '" title="Colour"><select data-mxd="group"><option value="tracks"' + (x.group === "tracks" ? " selected" : "") + '>Tracks (Mix tab)</option><option value="band"' + (x.group !== "tracks" ? " selected" : "") + '>Band / mic</option></select><label class="toggle"><input type="checkbox" data-mxd="show"' + (x.show !== false ? " checked" : "") + '> Shown to the in-ear users</label>' +
      '<label>Start from <select data-mxd="preset"><option value="">a preset…</option>' + (M.PRESETS || []).map(function (p) { return '<option value="' + p.id + '">' + esc(p.name) + "</option>"; }).join("") + '</select></label><span class="muted small">' + esc(srcLabel(x)) + '</span><button data-mxd="close">Close</button></div>' +
      '<div class="mx-dgrid"><div class="mx-dcol"><h4>Input</h4>' + slider("Trim", "trim", -24, 24, 0.5, x.trim, dbs) + '<label class="toggle"><input type="checkbox" data-mxd="phase"' + (x.phase ? " checked" : "") + "> Polarity flip</label>" + slider("High-pass", "hpf", 0, 400, 5, x.hpf, function (v) { return v > 0 ? Math.round(v) + " Hz" : "off"; }) +
      '<h4 class="mx-h4"><label class="toggle"><input type="checkbox" data-mxd="gate.on"' + (g.on ? " checked" : "") + '> Gate</label></h4><div class="mx-gr mx-gt"><i></i><span>closed by</span></div>' +
      slider("Threshold", "gate.thr", -80, 0, 0.5, g.thr, dbs) + slider("Range", "gate.range", -90, 0, 1, g.range, function (v) { return v <= -80 ? "shut" : dbs(v); }) + slider("Attack", "gate.att", 0.05, 50, 0.05, g.att, ms) + slider("Hold", "gate.hold", 0, 2000, 5, g.hold, ms) + slider("Release", "gate.rel", 5, 4000, 5, g.rel, ms) + "</div>" +
      '<div class="mx-dcol"><h4><label class="toggle"><input type="checkbox" data-mxd="eq.on"' + (e.on ? " checked" : "") + '> EQ</label></h4><canvas class="mx-curve" id="mxCurve"></canvas>' +
      slider("Low", "eq.lg", -18, 18, 0.5, e.lg, dbs) + slider("Low freq", "eq.lf", 20, 1000, 5, e.lf, hz) + slider("Low mid", "eq.mg", -18, 18, 0.5, e.mg, dbs) + slider("Low mid freq", "eq.mf", 100, 12000, 10, e.mf, hz) + slider("Low mid Q", "eq.mq", 0.2, 8, 0.1, e.mq, function (v) { return Number(v).toFixed(1); }) +
      slider("High mid", "eq.m2g", -18, 18, 0.5, e.m2g || 0, dbs) + slider("High mid freq", "eq.m2f", 200, 16000, 10, e.m2f || 3000, hz) + slider("High mid Q", "eq.m2q", 0.2, 8, 0.1, e.m2q || 1, function (v) { return Number(v).toFixed(1); }) +
      slider("High", "eq.hg", -18, 18, 0.5, e.hg, dbs) + slider("High freq", "eq.hf", 1000, 20000, 100, e.hf, hz) + '<button data-mxd="eqflat">Flat</button></div>' +
      '<div class="mx-dcol"><h4><label class="toggle"><input type="checkbox" data-mxd="comp.on"' + (c.on ? " checked" : "") + '> Compressor</label></h4><div class="mx-gr"><i></i><span>gain reduction</span></div>' +
      slider("Threshold", "comp.thr", -60, 0, 0.5, c.thr, dbs) + slider("Ratio", "comp.ratio", 1, 20, 0.5, c.ratio, function (v) { return Number(v).toFixed(1) + ":1"; }) + slider("Attack", "comp.att", 0.1, 200, 0.1, c.att, function (v) { return Number(v).toFixed(1) + " ms"; }) + slider("Release", "comp.rel", 5, 2000, 5, c.rel, function (v) { return Math.round(v) + " ms"; }) + slider("Make-up", "comp.makeup", 0, 24, 0.5, c.makeup, dbs) + "</div>" +
      '<div class="mx-dcol"><h4>FX sends <small class="muted">after the fader</small></h4>' + slider("Reverb", "fx.rev", -90, 10, 0.5, fx.rev, fxdb) + slider("Delay", "fx.dly", -90, 10, 0.5, fx.dly, fxdb) +
      '<p class="muted small">The reverb and delay are shared by every channel, like on a sound desk. Set them up under "Reverb & delay" below.</p>' +
      '<h4 class="mx-h4">In the stream mix</h4>' + slider("Level", "ss.level", -90, 10, 0.5, sd.level, fxdb) + slider("Pan", "ss.pan", -1, 1, 0.05, sd.pan, function (v) { v = Number(v); return Math.abs(v) < 0.02 ? "C" : (v < 0 ? "L " : "R ") + Math.round(Math.abs(v) * 100); }) +
      '<label class="toggle"><input type="checkbox" data-mxd="ss.on"' + (sd.on !== false ? " checked" : "") + "> On in the stream</label></div></div>";
  }
  function render(force) {
    var root = $("#mixRoot"); if (!root || !visible()) return;
    if (!(CU.isAdmin ? CU.isAdmin() : CU.mode() === "admin" || CU.mode() === "main")) { root.innerHTML = '<div class="card"><p>The Mix tab is on admin computers.</p></div>'; return; }
    var s = S();
    if (!s) { root.innerHTML = '<div class="card mx-empty"><h3>Mix</h3><p>' + esc(X.error || "Connecting to the mixer…") + '</p><p class="muted">One admin computer is the audio host: it gets the Central Pedal\'s tracks and makes the mixes. Set it up on the I/O tab.</p><button data-mx-go="io">Open I/O</button></div>'; structKey = ""; return; }
    var list = stripInputs(), key = JSON.stringify([list, s.trackOut, list.map(function (i) { return s.inputs[i].name + s.inputs[i].color + active(s.inputs[i]); }), sel, outNames().length, X.kind, layer]);
    if (!force && key === structKey && root.querySelector(".mx-strips")) { update(); return; }
    structKey = key;
    root.innerHTML = head() + '<div class="mx-strips' + (onStream() ? " streaming" : "") + '">' + (list.length ? list.map(strip).join("") : '<p class="muted mx-none">No tracks yet. When the Central Pedal sends its audio (I/O tab), every track appears here on its own channel. With the audio interface, name the inputs on the In-ears tab and set them to "Tracks".</p>') + "</div>" + '<div class="card mx-detail" id="mxDetail">' + detail() + "</div>" + '<div class="mx-extra" id="mxExtra"></div>';
    fillSinks(); drawCurve(); if (window.CURecUI) window.CURecUI.fill(root);
    if (window.CUMixStream) window.CUMixStream.render($("#mxExtra"));
  }
  function fillSinks() {
    var sinkSel = $('[data-mx-listen="sink"]'); if (!sinkSel || !navigator.mediaDevices) return;
    navigator.mediaDevices.enumerateDevices().then(function (list) { list.filter(function (d) { return d.kind === "audiooutput" && d.deviceId !== "default"; }).forEach(function (d) { var o = document.createElement("option"); o.value = d.deviceId; o.textContent = d.label || "Output " + d.deviceId.slice(0, 6); if (d.deviceId === listen.sink) o.selected = true; sinkSel.appendChild(o); }); }).catch(function () { });
  }
  function update() {   // values only, after an op (not the control in your hand)
    var s = S(); if (!s) return;
    document.querySelectorAll("#mixRoot .mx-strip").forEach(function (el) {
      var i = Number(el.dataset.i), x = s.inputs[i]; if (!x) return;
      var sd = ss(i), lvl = onStream() ? sd.level : x.fader, pan = onStream() ? sd.pan : x.pan, muted = onStream() ? sd.on === false : x.mute;
      var f = el.querySelector('[data-mx="fader"]'); if (f && f !== dragging) { f.value = M.dbToFader(lvl); el.querySelector(".mx-db").textContent = db(lvl); }
      var p = el.querySelector('[data-mx="pan"]'); if (p && p !== dragging) { p.value = pan; var pv = el.querySelector(".mx-panv"); if (pv) pv.textContent = panText(pan); }
      var mb = el.querySelector('[data-mx="mute"]'); mb.classList.toggle("on", muted); mb.classList.toggle("danger", muted);
      el.querySelector('[data-mx="eq"]').classList.toggle("on", !!(x.eq.on || x.hpf)); el.querySelector('[data-mx="comp"]').classList.toggle("on", x.comp.on);
      var gb = el.querySelector('[data-mx="gate"]'); if (gb) gb.classList.toggle("on", !!(x.gate && x.gate.on)); var fb = el.querySelector('[data-mx="fx"]'); if (fb) fb.classList.toggle("on", !!fxUsed(x));
      var d = el.querySelector('[data-mx="direct"]'); if (d && d !== document.activeElement) d.value = String(x.direct);
    });
    var lv = $('[data-mx-main="level"]'); if (lv && lv !== dragging) { lv.value = M.dbToFader(s.main.level); $(".mx-mdb").textContent = db(s.main.level); }
    var mu = $('[data-mx-main="mute"]'); if (mu) { mu.textContent = s.main.mute ? "Muted" : "Mute"; mu.classList.toggle("danger", s.main.mute); mu.classList.toggle("on", s.main.mute); }
    var det = $("#mxDetail"); if (det && sel >= 0 && !det.contains(document.activeElement) && !dragging) { det.innerHTML = detail(); drawCurve(); }
    if (window.CUMixStream) window.CUMixStream.update();
  }
  // the EQ's response (the same RBJ filters as the engine)
  function bqMag(type, f0, g, q, f, fs) {
    var A = Math.pow(10, g / 40), w = 2 * Math.PI * f0 / fs, cw = Math.cos(w), sw = Math.sin(w), al = sw / (2 * q), b0, b1, b2, a0, a1, a2;
    if (type === 0) { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2; a0 = 1 + al; a1 = -2 * cw; a2 = 1 - al; }
    else if (type === 1) { var s1 = 2 * Math.sqrt(A) * al; b0 = A * ((A + 1) - (A - 1) * cw + s1); b1 = 2 * A * ((A - 1) - (A + 1) * cw); b2 = A * ((A + 1) - (A - 1) * cw - s1); a0 = (A + 1) + (A - 1) * cw + s1; a1 = -2 * ((A - 1) + (A + 1) * cw); a2 = (A + 1) + (A - 1) * cw - s1; }
    else if (type === 2) { b0 = 1 + al * A; b1 = -2 * cw; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cw; a2 = 1 - al / A; }
    else { var s3 = 2 * Math.sqrt(A) * al; b0 = A * ((A + 1) + (A - 1) * cw + s3); b1 = -2 * A * ((A - 1) + (A + 1) * cw); b2 = A * ((A + 1) + (A - 1) * cw - s3); a0 = (A + 1) - (A - 1) * cw + s3; a1 = 2 * ((A - 1) - (A + 1) * cw); a2 = (A + 1) - (A - 1) * cw - s3; }
    var ww = 2 * Math.PI * f / fs, c1 = Math.cos(ww), s1b = Math.sin(ww), c2 = Math.cos(2 * ww), s2 = Math.sin(2 * ww);
    var nr = b0 + b1 * c1 + b2 * c2, ni = -(b1 * s1b + b2 * s2), dr = a0 + a1 * c1 + a2 * c2, di = -(a1 * s1b + a2 * s2);
    return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
  }
  function drawCurve() {
    var cv = $("#mxCurve"); if (!cv || sel < 0) return; var x = S().inputs[sel], dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight; if (!W) return;
    cv.width = W * dpr; cv.height = H * dpr; var g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    g.strokeStyle = "rgba(255,255,255,.08)"; [100, 1000, 10000].forEach(function (f) { var px = Math.log(f / 20) / Math.log(1000) * W; g.beginPath(); g.moveTo(px, 0); g.lineTo(px, H); g.stroke(); }); g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
    g.strokeStyle = x.eq.on || x.hpf ? "#E2C27E" : "#4A515C"; g.lineWidth = 2; g.beginPath();
    for (var k = 0; k <= W; k += 2) { var f = 20 * Math.pow(1000, k / W), d = 0; if (x.hpf > 0) d += bqMag(0, x.hpf, 0, 0.707, f, 48000); if (x.eq.on) { d += bqMag(1, x.eq.lf, x.eq.lg, 0.707, f, 48000) + bqMag(2, x.eq.mf, x.eq.mg, x.eq.mq, f, 48000) + bqMag(3, x.eq.hf, x.eq.hg, 0.707, f, 48000); if (Math.abs(x.eq.m2g || 0) > 0.01) d += bqMag(2, x.eq.m2f, x.eq.m2g, x.eq.m2q, f, 48000); } var y = H / 2 - d / 24 * (H / 2); if (k) g.lineTo(k, y); else g.moveTo(k, y); }
    g.stroke();
  }
  function bar(v) { var d = v > 0 ? 20 * Math.log10(v) : -90; return Math.max(0, Math.min(100, (d + 60) / 60 * 100)); }
  X.on("meters", function (m) {
    var mx = Math.max(m.main ? m.main[0] : 0, m.main ? m.main[1] : 0); wave.push(mx); if (wave.length > 1200) wave.shift();
    if (!visible()) return;
    document.querySelectorAll("#mixRoot .mx-strip").forEach(function (el) { var i = Number(el.dataset.i), v = m.in ? m.in[i] || 0 : 0, gr = m.gr ? m.gr[i] || 0 : 0; el.querySelector(".mx-meter i").style.height = bar(v) + "%"; el.querySelector(".mx-meter b").style.height = Math.min(100, gr / 20 * 100) + "%"; });
    var g = $(".mx-gr:not(.mx-gt) i"); if (g && sel >= 0 && m.gr) g.style.width = Math.min(100, (m.gr[sel] || 0) / 20 * 100) + "%";
    var gt = $(".mx-gt i"); if (gt && sel >= 0 && m.gate) gt.style.width = Math.min(100, (m.gate[sel] || 0) / 40 * 100) + "%";
    if (window.CUMixStream) window.CUMixStream.meters(m);
    drawWave();
  });
  function drawWave() {
    var cv = $("#mxWave"); if (!cv) return; var dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight; if (!W) return;
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    var g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    var n = X.kind === "local" ? 1200 : 600, step = W / n, mid = H / 2; g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--accent") || "#E2C27E";
    for (var k = 0; k < wave.length; k++) { var v = Math.min(1, wave[wave.length - 1 - k] || 0), h = Math.max(1, v * (H - 4)); g.fillRect(W - (k + 1) * step, mid - h / 2, Math.max(1, step - 0.3), h); }
  }

  // a slider's value as its label shows it
  function fmtKey(k, v) {
    v = Number(v);
    if (k === "hpf") return v > 0 ? Math.round(v) + " Hz" : "off";
    if (/(^|\.)(lf|mf|m2f|hf)$/.test(k)) return v >= 1000 ? (v / 1000).toFixed(1) + " kHz" : Math.round(v) + " Hz";
    if (/q$/.test(k)) return v.toFixed(1);
    if (k === "comp.ratio") return v.toFixed(1) + ":1";
    if (/att|rel|hold/.test(k)) return (v < 10 ? v.toFixed(1) : Math.round(v)) + " ms";
    if (k === "ss.pan") return Math.abs(v) < 0.02 ? "C" : (v < 0 ? "L " : "R ") + Math.round(Math.abs(v) * 100);
    if (k === "gate.range") return v <= -80 ? "shut" : (v > 0 ? "+" : "") + v.toFixed(1) + " dB";
    if (/^fx\.|^ss\.level/.test(k) && v <= -90) return "off";
    return (v > 0 ? "+" : "") + v.toFixed(1) + " dB";
  }
  function tapOf(v) { return v === "main" || v === "stream" ? v : Number(v); }

  // ------------------------------------------------------------------ events
  var root = $("#mixRoot");
  // a pan back to the centre: a double-click, or holding it still
  var panHold = null;
  function centrePan(el) { var strip = el.closest(".mx-strip"); if (!strip) return; var i = Number(strip.dataset.i); el.value = 0; var pv = strip.querySelector(".mx-panv"); if (pv) pv.textContent = "C"; if (onStream()) X.op({ op: "streamSend", i: i, patch: { pan: 0 } }); else X.op({ op: "input", i: i, patch: { pan: 0 } }); }
  root.addEventListener("pointerdown", function (e) {
    if (e.target.type === "range") dragging = e.target;
    if (e.target.dataset && e.target.dataset.mx === "pan") { var el = e.target, v0 = el.value; clearTimeout(panHold && panHold.t); panHold = { x0: e.clientX, t: setTimeout(function () { if (panHold && Math.abs(Number(el.value) - Number(v0)) < 0.06) centrePan(el); panHold = null; }, 600) }; }
  });
  root.addEventListener("pointermove", function (e) { if (panHold && Math.abs(e.clientX - panHold.x0) > 8) { clearTimeout(panHold.t); panHold = null; } });
  root.addEventListener("dblclick", function (e) { if (e.target.dataset && e.target.dataset.mx === "pan") centrePan(e.target); });
  document.addEventListener("pointerup", function () { if (panHold) { clearTimeout(panHold.t); panHold = null; } if (dragging) { dragging = null; } });
  root.addEventListener("input", function (e) {
    var t = e.target, s = S(); if (!s) return;
    var strip = t.closest(".mx-strip"), i = strip ? Number(strip.dataset.i) : sel;
    if (t.dataset.mx === "fader") { var d = Math.round(M.faderToDb(Number(t.value)) * 10) / 10; strip.querySelector(".mx-db").textContent = db(d); if (onStream()) send("sf" + i, { op: "streamSend", i: i, patch: { level: d } }); else send("f" + i, { op: "input", i: i, patch: { fader: d } }); }
    else if (t.dataset.mx === "pan") { var pv = strip.querySelector(".mx-panv"); if (pv) pv.textContent = panText(t.value); if (onStream()) send("sp" + i, { op: "streamSend", i: i, patch: { pan: Number(t.value) } }); else send("p" + i, { op: "input", i: i, patch: { pan: Number(t.value) } }); }
    else if (t.dataset.mxMain === "level") { var d2 = Math.round(M.faderToDb(Number(t.value)) * 10) / 10; $(".mx-mdb").textContent = db(d2); send("main", { op: "main", patch: { level: d2 } }); }
    else if (t.dataset.mxd && t.type === "range") {
      var k = t.dataset.mxd, v = Number(t.value), out = t.parentNode.querySelector("output"), patch = {};
      if (k.indexOf(".") > 0) { var p = k.split("."); patch[p[0]] = {}; patch[p[0]][p[1]] = v; } else patch[k] = v;
      if (out) out.textContent = fmtKey(k, v);
      if (k.indexOf("ss.") === 0) { var sp = {}; sp[k.slice(3)] = v; send("ss" + sel + k, { op: "streamSend", i: sel, patch: sp }); return; }
      send("d" + sel + k, { op: "input", i: sel, patch: patch });
      if (k === "hpf" || k.indexOf("eq.") === 0) { var x = s.inputs[sel]; if (k === "hpf") x.hpf = v; else x.eq[k.slice(3)] = v; drawCurve(); }
    }
  });
  root.addEventListener("change", function (e) {
    var t = e.target, s = S(); if (!s) return; var strip = t.closest(".mx-strip");
    if (t.name === "mxOut") { X.op({ op: "trackOut", value: t.value, first: s.directFirst || 0 }); return; }
    if (t.dataset.mxMain === "outL" || t.dataset.mxMain === "outR") { var pp = {}; pp[t.dataset.mxMain] = Number(t.value); X.op({ op: "main", patch: pp }); return; }
    if (t.dataset.mxMain === "directFirst") { X.op({ op: "trackOut", value: "direct", first: Number(t.value) }); return; }
    if (t.dataset.mx === "direct" && strip) { X.op({ op: "input", i: Number(strip.dataset.i), patch: { direct: Number(t.value) } }); return; }
    if (t.dataset.mxListen === "sink") { window.CUListen.setSink(t.value); return; }
    if (t.dataset.mxListen === "tap") { if (listen.tap != null) startListen(tapOf(t.value)); return; }
    if (t.dataset.mxd === "preset") { var pr = (M.PRESETS || []).find(function (q) { return q.id === t.value; }); if (pr && sel >= 0) X.op({ op: "input", i: sel, patch: JSON.parse(JSON.stringify(pr.patch)) }); t.value = ""; return; }
    if (t.dataset.mxd === "ss.on") { X.op({ op: "streamSend", i: sel, patch: { on: t.checked } }); return; }
    if (t.hasAttribute("data-mx-all")) { showAll = t.checked; CU.store.set("mxAll", showAll); render(true); return; }
    if (t.dataset.mxd && t.type !== "range") {
      var k = t.dataset.mxd, patch = {};
      if (k === "eq.on" || k === "comp.on" || k === "gate.on") { patch[k.split(".")[0]] = { on: t.checked }; }
      else if (k === "phase" || k === "show") patch[k] = t.checked;
      else patch[k] = t.value;
      X.op({ op: "input", i: sel, patch: patch });
    }
  });
  root.addEventListener("click", function (e) {
    var b = e.target.closest("button,.mx-name"); if (!b) return; var s = S();
    if (b.dataset.mxGo) { CU.showTab(b.dataset.mxGo); return; }
    if (!s) return;
    var strip = b.closest(".mx-strip"), i = strip ? Number(strip.dataset.i) : -1;
    if (b.dataset.mxLayer) { layer = b.dataset.mxLayer === "stream" ? "stream" : "main"; CU.store.set("mxLayer", layer); render(true); return; }
    if (b.classList.contains("mx-name") || b.dataset.mx === "eq" || b.dataset.mx === "comp" || b.dataset.mx === "gate" || b.dataset.mx === "fx") { sel = sel === i && b.classList.contains("mx-name") ? -1 : i; CU.store.set("mxSel", sel); render(true); return; }
    if (b.dataset.mx === "mute") { if (onStream()) X.op({ op: "streamSend", i: i, patch: { on: ss(i).on === false } }); else X.op({ op: "input", i: i, patch: { mute: !s.inputs[i].mute } }); return; }
    if (b.dataset.mxMain === "mute") { X.op({ op: "main", patch: { mute: !s.main.mute } }); return; }
    if (b.dataset.mxd === "close") { sel = -1; CU.store.set("mxSel", sel); render(true); return; }
    if (b.dataset.mxd === "eqflat") { X.op({ op: "input", i: sel, patch: { hpf: 0, eq: { on: false, lg: 0, mg: 0, m2g: 0, hg: 0, lf: 100, mf: 1000, mq: 1, m2f: 3000, m2q: 1, hf: 8000 } } }); return; }
    if (b.dataset.mxListen === "go") { if (listen.tap != null) { stopListen(); render(true); } else { startListen(tapOf($('[data-mx-listen="tap"]').value)); } return; }
    if (b.dataset.mxFile === "export") { window.CU.mixer.exportFile(); return; }
    if (b.dataset.mxFile === "import") { window.CU.mixer.importFile().catch(function (err) { alert(err.message); }); return; }
  });
  X.on("state", function () { render(true); });
  X.on("op", function (op) { if (!visible()) return; if (op.op === "input" && op.patch && (op.patch.name != null || op.patch.group || op.patch.src || op.patch.color != null || op.patch.direct != null)) render(); else if (op.op === "trackOut") render(true); else update(); });
  // the delay follows the song's tempo (the Central Pedal's BPM) - the audio host passes it to its engine
  setInterval(function () { var d = CU.state && CU.state.display; if (X.kind === "local" && window.CU && window.CU.mixer && window.CU.mixer.tempo && d && d.bpm) window.CU.mixer.tempo(Number(d.bpm)); }, 1000);
  X.on("pi", function () { render(); });
  CU.on("tab", function (t) { if (t === "mix") setTimeout(function () { render(true); }, 0); });
  window.CUMixTab = { render: render };
})();
