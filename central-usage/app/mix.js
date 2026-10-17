/* Central Usage - the Mix tab (admin): the Central Control's tracks, each on its own channel, mixed here.
 * Faders, pan, mute, high-pass, 3-band EQ, compressor per track; out of the audio interface summed (main
 * L/R) or each track on its own output (Settings on this tab). Listen on this computer, record the service,
 * and a live waveform of what is going out. */
(function () {
  "use strict";
  var CU = window.CentralUsage, M = window.CUMixer, X = window.CUMix, IE = window.CUInEar; if (!CU || !M || !X) return;
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function db(v) { return v <= -90 ? "-∞" : (v > 0 ? "+" : "") + Number(v).toFixed(1); }
  var sel = CU.store.get("mxSel", -1), showAll = CU.store.get("mxAll", false), dragging = null, structKey = "", wave = [], rec = null;
  function visible() { return CU.prefs.tab === "mix"; }
  function S() { return X.state; }
  function live() { return X.live(); }
  function active(x) { return x.src.kind === "in" || (x.src.kind === "pi" && live()[x.src.key]); }
  function stripInputs() { var s = S(); if (!s) return []; var out = []; s.inputs.forEach(function (x, i) { if (x.src.kind === "none") return; if (!showAll && (x.group !== "tracks" || !active(x))) return; out.push(i); }); return out; }
  function outNames() { var st = X.kind === "local" ? (X.hostStatus && X.hostStatus.engine && X.hostStatus.engine.status) : (X.info && X.info.status); var n = st && st.playbackNames || []; return n; }
  function outOptions(cur, none) { var names = outNames(), h = '<option value="-1"' + (cur < 0 ? " selected" : "") + ">" + (none || "—") + "</option>"; for (var o = 0; o < Math.max(names.length, cur + 1); o++) h += '<option value="' + o + '"' + (o === cur ? " selected" : "") + ">Out " + (o + 1) + (names[o] ? " · " + esc(names[o].replace(/^.*:/, "")) : "") + "</option>"; return h; }
  function srcLabel(x) { if (x.src.kind === "pi") return "Central Control" + (live()[x.src.key] ? "" : " (not in this song)"); if (x.src.kind === "in") return "Interface in " + (x.src.ch + 1); return "—"; }
  var timers = {};
  function send(key, op) { var t = timers[key]; if (t && Date.now() - t.at < 35) { clearTimeout(t.id); t.id = setTimeout(function () { t.at = Date.now(); X.op(op); }, 35); return; } timers[key] = { at: Date.now() }; X.op(op); }

  // ------------------------------------------------------------------ listening on this computer + recording
  var listen = { player: null, tap: null, sink: CU.store.get("listenSink", "") };
  X.on("audio", function (pcm, frames, ch, rate) { if (listen.player) listen.player.push(pcm, frames, ch, rate); });
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
    var piLine = X.kind === "local" ? (pi.state === "receiving" ? "Central Control audio: " + (X.pi.length) + " channels · " + pi.kbps + " kbit/s" + (pi.lost ? " · " + pi.lost + " packets lost" : "") : (hs.cfg && hs.cfg.piAudio && hs.cfg.piAudio.transport === "interface") ? "Central Control audio: through the interface inputs" : "Central Control audio: " + esc(pi.state || "off") + (pi.error ? " - " + esc(pi.error) : "") + ' <button data-mx-go="io">I/O</button>') : "";
    var listenTaps = '<option value="main"' + (listen.tap === "main" ? " selected" : "") + ">Main mix</option>" + s.mixes.map(function (q, k) { return '<option value="' + k + '"' + (listen.tap === k ? " selected" : "") + ">Mix " + (k + 1) + " · " + esc(q.owner || q.name) + "</option>"; }).join("");
    var recSt = hs.recorder || {};
    return '<div class="card mx-head"><div class="mx-line"><b>' + link + '</b><span class="muted small">' + piLine + "</span></div>" +
      '<div class="mx-row"><div class="mx-grp"><b>Tracks out</b><label class="toggle"><input type="radio" name="mxOut" value="sum"' + (s.trackOut !== "direct" ? " checked" : "") + '> Summed (L / R)</label><label class="toggle"><input type="radio" name="mxOut" value="direct"' + (s.trackOut === "direct" ? " checked" : "") + "> Each track on its own output</label>" +
      (s.trackOut === "direct" ? '<label>starting at <select data-mx-main="directFirst">' + outOptions(s.directFirst).replace('<option value="-1"', '<option value="-1" disabled') + "</select></label>" : '<label>L <select data-mx-main="outL">' + outOptions(m.outL) + '</select></label><label>R <select data-mx-main="outR">' + outOptions(m.outR) + "</select></label>") + "</div>" +
      '<div class="mx-grp mx-mainf"><b>Main</b><input type="range" min="0" max="1" step="0.001" data-mx-main="level" value="' + M.dbToFader(m.level) + '"><span class="mx-mdb">' + db(m.level) + '</span><button data-mx-main="mute" class="' + (m.mute ? "danger on" : "") + '">' + (m.mute ? "Muted" : "Mute") + "</button></div></div>" +
      '<div class="mx-row"><div class="mx-grp"><b>Listen here</b><select data-mx-listen="tap">' + listenTaps + '</select><button data-mx-listen="go" class="' + (listen.tap != null ? "on" : "") + '">' + (listen.tap != null ? "■ Stop" : "🎧 Listen") + '</button><select data-mx-listen="sink"><option value="">This computer\'s output</option></select></div>' +
      (X.kind === "local" ? '<div class="mx-grp"><b>Record the service</b><button data-mx-rec="go" class="' + (recSt.recording ? "rec" : "") + '">' + (recSt.recording ? "■ Stop · " + fmtT(recSt.seconds) : "● Record") + '</button><button data-mx-rec="folder">Recordings</button><span class="muted small">' + (recSt.saved ? "saved " + esc(String(recSt.saved).split("/").pop()) : recSt.file && !recSt.recording ? esc(String(recSt.file).split("/").pop()) : "") + "</span></div>" : '<div class="mx-grp muted small">Recording happens on the audio host.</div>') +
      '<div class="mx-grp"><label class="toggle"><input type="checkbox" data-mx-all' + (showAll ? " checked" : "") + "> Show every channel (band too)</label>" + (X.kind === "local" ? '<button data-mx-file="export">Save mixer…</button><button data-mx-file="import">Open mixer…</button>' : "") + "</div></div></div>" +
      '<canvas class="mx-wave" id="mxWave" title="What goes out (main mix), last minute"></canvas>';
  }
  function fmtT(s) { s = s || 0; var h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60; return (h ? h + ":" : "") + (h && m < 10 ? "0" : "") + m + ":" + (x < 10 ? "0" : "") + x; }
  function strip(i) {
    var x = S().inputs[i], direct = S().trackOut === "direct" || x.direct >= 0;
    return '<div class="mx-strip' + (i === sel ? " sel" : "") + (active(x) ? "" : " idle") + '" data-i="' + i + '"' + (x.color ? ' style="--c:' + esc(x.color) + '"' : "") + '>' +
      '<div class="mx-name" title="' + esc(srcLabel(x)) + '">' + esc(x.name || "Input " + (i + 1)) + '</div><div class="mx-src">' + esc(srcLabel(x)) + "</div>" +
      '<div class="mx-body"><div class="mx-meter"><i></i><b></b></div><input type="range" class="mx-fader" min="0" max="1" step="0.001" data-mx="fader" value="' + M.dbToFader(x.fader) + '"></div>' +
      '<div class="mx-db">' + db(x.fader) + '</div><input type="range" class="mx-pan" min="-1" max="1" step="0.05" data-mx="pan" value="' + x.pan + '" title="Pan">' +
      '<div class="mx-btns"><button data-mx="mute" class="' + (x.mute ? "on danger" : "") + '">M</button><button data-mx="eq" class="' + (x.eq.on || x.hpf ? "on" : "") + '" title="High-pass and EQ">EQ</button><button data-mx="comp" class="' + (x.comp.on ? "on" : "") + '" title="Compressor">C</button></div>' +
      (direct ? '<select data-mx="direct" title="Its own output">' + outOptions(x.direct, S().trackOut === "direct" ? "auto" : "—") + "</select>" : "") + "</div>";
  }
  function slider(label, key, min, max, step, v, fmt) { return '<label class="mx-sl"><span>' + label + '</span><input type="range" min="' + min + '" max="' + max + '" step="' + step + '" data-mxd="' + key + '" value="' + v + '"><output>' + fmt(v) + "</output></label>"; }
  function detail() {
    if (sel < 0 || !S().inputs[sel]) return '<p class="muted">Click a channel\'s name for its high-pass, EQ and compressor.</p>';
    var x = S().inputs[sel], e = x.eq, c = x.comp, hz = function (v) { return v >= 1000 ? (v / 1000).toFixed(v >= 10000 ? 0 : 1) + " kHz" : Math.round(v) + " Hz"; }, dbs = function (v) { return (v > 0 ? "+" : "") + Number(v).toFixed(1) + " dB"; };
    return '<div class="mx-dhead"><input data-mxd="name" value="' + esc(x.name) + '" placeholder="Name"><input type="color" data-mxd="color" value="' + esc(x.color || "#5de6b0") + '" title="Colour"><select data-mxd="group"><option value="tracks"' + (x.group === "tracks" ? " selected" : "") + '>Tracks (Mix tab)</option><option value="band"' + (x.group !== "tracks" ? " selected" : "") + '>Band / mic</option></select><label class="toggle"><input type="checkbox" data-mxd="show"' + (x.show !== false ? " checked" : "") + '> Shown to the in-ear users</label><span class="muted small">' + esc(srcLabel(x)) + '</span><button data-mxd="close">Close</button></div>' +
      '<div class="mx-dgrid"><div class="mx-dcol"><h4>Input</h4>' + slider("Trim", "trim", -24, 24, 0.5, x.trim, dbs) + '<label class="toggle"><input type="checkbox" data-mxd="phase"' + (x.phase ? " checked" : "") + "> Polarity flip</label>" + slider("High-pass", "hpf", 0, 400, 5, x.hpf, function (v) { return v > 0 ? Math.round(v) + " Hz" : "off"; }) + "</div>" +
      '<div class="mx-dcol"><h4><label class="toggle"><input type="checkbox" data-mxd="eq.on"' + (e.on ? " checked" : "") + '> EQ</label></h4><canvas class="mx-curve" id="mxCurve"></canvas>' +
      slider("Low", "eq.lg", -18, 18, 0.5, e.lg, dbs) + slider("Low freq", "eq.lf", 20, 1000, 5, e.lf, hz) + slider("Mid", "eq.mg", -18, 18, 0.5, e.mg, dbs) + slider("Mid freq", "eq.mf", 100, 12000, 10, e.mf, hz) + slider("Mid width (Q)", "eq.mq", 0.2, 8, 0.1, e.mq, function (v) { return Number(v).toFixed(1); }) + slider("High", "eq.hg", -18, 18, 0.5, e.hg, dbs) + slider("High freq", "eq.hf", 1000, 20000, 100, e.hf, hz) + '<button data-mxd="eqflat">Flat</button></div>' +
      '<div class="mx-dcol"><h4><label class="toggle"><input type="checkbox" data-mxd="comp.on"' + (c.on ? " checked" : "") + '> Compressor</label></h4><div class="mx-gr"><i></i><span>gain reduction</span></div>' +
      slider("Threshold", "comp.thr", -60, 0, 0.5, c.thr, dbs) + slider("Ratio", "comp.ratio", 1, 20, 0.5, c.ratio, function (v) { return Number(v).toFixed(1) + ":1"; }) + slider("Attack", "comp.att", 0.1, 200, 0.1, c.att, function (v) { return Number(v).toFixed(1) + " ms"; }) + slider("Release", "comp.rel", 5, 2000, 5, c.rel, function (v) { return Math.round(v) + " ms"; }) + slider("Make-up", "comp.makeup", 0, 24, 0.5, c.makeup, dbs) + "</div></div>";
  }
  function render(force) {
    var root = $("#mixRoot"); if (!root || !visible()) return;
    if (!(CU.isAdmin ? CU.isAdmin() : CU.mode() === "admin" || CU.mode() === "main")) { root.innerHTML = '<div class="card"><p>The Mix tab is on admin computers.</p></div>'; return; }
    var s = S();
    if (!s) { root.innerHTML = '<div class="card mx-empty"><h3>Mix</h3><p>' + esc(X.error || "Connecting to the mixer…") + '</p><p class="muted">One admin computer is the audio host: it gets the Central Control\'s tracks and makes the mixes. Set it up on the I/O tab.</p><button data-mx-go="io">Open I/O</button></div>'; structKey = ""; return; }
    var list = stripInputs(), key = JSON.stringify([list, s.trackOut, list.map(function (i) { return s.inputs[i].name + s.inputs[i].color + active(s.inputs[i]); }), sel, outNames().length, X.kind]);
    if (!force && key === structKey && root.querySelector(".mx-strips")) { update(); return; }
    structKey = key;
    root.innerHTML = head() + '<div class="mx-strips">' + (list.length ? list.map(strip).join("") : '<p class="muted mx-none">No tracks yet. When the Central Control sends its audio (I/O tab), every track appears here on its own channel. With the audio interface, name the inputs on the In-ears tab and set them to "Tracks".</p>') + "</div>" + '<div class="card mx-detail" id="mxDetail">' + detail() + "</div>";
    fillSinks(); drawCurve();
  }
  function fillSinks() {
    var sinkSel = $('[data-mx-listen="sink"]'); if (!sinkSel || !navigator.mediaDevices) return;
    navigator.mediaDevices.enumerateDevices().then(function (list) { list.filter(function (d) { return d.kind === "audiooutput" && d.deviceId !== "default"; }).forEach(function (d) { var o = document.createElement("option"); o.value = d.deviceId; o.textContent = d.label || "Output " + d.deviceId.slice(0, 6); if (d.deviceId === listen.sink) o.selected = true; sinkSel.appendChild(o); }); }).catch(function () { });
  }
  function update() {   // values only, after an op (not the control in your hand)
    var s = S(); if (!s) return;
    document.querySelectorAll("#mixRoot .mx-strip").forEach(function (el) {
      var x = s.inputs[Number(el.dataset.i)]; if (!x) return;
      var f = el.querySelector('[data-mx="fader"]'); if (f && f !== dragging) { f.value = M.dbToFader(x.fader); el.querySelector(".mx-db").textContent = db(x.fader); }
      var p = el.querySelector('[data-mx="pan"]'); if (p && p !== dragging) p.value = x.pan;
      var mb = el.querySelector('[data-mx="mute"]'); mb.classList.toggle("on", x.mute); mb.classList.toggle("danger", x.mute);
      el.querySelector('[data-mx="eq"]').classList.toggle("on", !!(x.eq.on || x.hpf)); el.querySelector('[data-mx="comp"]').classList.toggle("on", x.comp.on);
      var d = el.querySelector('[data-mx="direct"]'); if (d && d !== document.activeElement) d.value = String(x.direct);
    });
    var lv = $('[data-mx-main="level"]'); if (lv && lv !== dragging) { lv.value = M.dbToFader(s.main.level); $(".mx-mdb").textContent = db(s.main.level); }
    var mu = $('[data-mx-main="mute"]'); if (mu) { mu.textContent = s.main.mute ? "Muted" : "Mute"; mu.classList.toggle("danger", s.main.mute); mu.classList.toggle("on", s.main.mute); }
    var det = $("#mxDetail"); if (det && sel >= 0 && !det.contains(document.activeElement) && !dragging) { det.innerHTML = detail(); drawCurve(); }
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
    g.strokeStyle = x.eq.on || x.hpf ? "#5de6b0" : "#567"; g.lineWidth = 2; g.beginPath();
    for (var k = 0; k <= W; k += 2) { var f = 20 * Math.pow(1000, k / W), d = 0; if (x.hpf > 0) d += bqMag(0, x.hpf, 0, 0.707, f, 48000); if (x.eq.on) { d += bqMag(1, x.eq.lf, x.eq.lg, 0.707, f, 48000) + bqMag(2, x.eq.mf, x.eq.mg, x.eq.mq, f, 48000) + bqMag(3, x.eq.hf, x.eq.hg, 0.707, f, 48000); } var y = H / 2 - d / 24 * (H / 2); if (k) g.lineTo(k, y); else g.moveTo(k, y); }
    g.stroke();
  }
  function bar(v) { var d = v > 0 ? 20 * Math.log10(v) : -90; return Math.max(0, Math.min(100, (d + 60) / 60 * 100)); }
  X.on("meters", function (m) {
    var mx = Math.max(m.main ? m.main[0] : 0, m.main ? m.main[1] : 0); wave.push(mx); if (wave.length > 1200) wave.shift();
    if (!visible()) return;
    document.querySelectorAll("#mixRoot .mx-strip").forEach(function (el) { var i = Number(el.dataset.i), v = m.in ? m.in[i] || 0 : 0, gr = m.gr ? m.gr[i] || 0 : 0; el.querySelector(".mx-meter i").style.height = bar(v) + "%"; el.querySelector(".mx-meter b").style.height = Math.min(100, gr / 20 * 100) + "%"; });
    var g = $(".mx-gr i"); if (g && sel >= 0 && m.gr) g.style.width = Math.min(100, (m.gr[sel] || 0) / 20 * 100) + "%";
    drawWave();
  });
  function drawWave() {
    var cv = $("#mxWave"); if (!cv) return; var dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight; if (!W) return;
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    var g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    var n = X.kind === "local" ? 1200 : 600, step = W / n, mid = H / 2; g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--accent") || "#5de6b0";
    for (var k = 0; k < wave.length; k++) { var v = Math.min(1, wave[wave.length - 1 - k] || 0), h = Math.max(1, v * (H - 4)); g.fillRect(W - (k + 1) * step, mid - h / 2, Math.max(1, step - 0.3), h); }
  }

  // ------------------------------------------------------------------ events
  var root = $("#mixRoot");
  root.addEventListener("pointerdown", function (e) { if (e.target.type === "range") dragging = e.target; });
  document.addEventListener("pointerup", function () { if (dragging) { dragging = null; } });
  root.addEventListener("input", function (e) {
    var t = e.target, s = S(); if (!s) return;
    var strip = t.closest(".mx-strip"), i = strip ? Number(strip.dataset.i) : sel;
    if (t.dataset.mx === "fader") { var d = Math.round(M.faderToDb(Number(t.value)) * 10) / 10; strip.querySelector(".mx-db").textContent = db(d); send("f" + i, { op: "input", i: i, patch: { fader: d } }); }
    else if (t.dataset.mx === "pan") send("p" + i, { op: "input", i: i, patch: { pan: Number(t.value) } });
    else if (t.dataset.mxMain === "level") { var d2 = Math.round(M.faderToDb(Number(t.value)) * 10) / 10; $(".mx-mdb").textContent = db(d2); send("main", { op: "main", patch: { level: d2 } }); }
    else if (t.dataset.mxd && t.type === "range") {
      var k = t.dataset.mxd, v = Number(t.value), out = t.parentNode.querySelector("output"), patch = {};
      if (k.indexOf(".") > 0) { var p = k.split("."); patch[p[0]] = {}; patch[p[0]][p[1]] = v; } else patch[k] = v;
      if (out) out.textContent = k === "hpf" ? (v > 0 ? Math.round(v) + " Hz" : "off") : /f$/.test(k) ? (v >= 1000 ? (v / 1000).toFixed(1) + " kHz" : Math.round(v) + " Hz") : k === "eq.mq" ? v.toFixed(1) : k === "comp.ratio" ? v.toFixed(1) + ":1" : /att|rel/.test(k) ? v + " ms" : (v > 0 ? "+" : "") + v.toFixed(1) + " dB";
      send("d" + sel + k, { op: "input", i: sel, patch: patch });
      if (k.indexOf("comp") < 0 && k !== "trim") { var x = s.inputs[sel]; if (k === "hpf") x.hpf = v; else if (k.indexOf("eq.") === 0) x.eq[k.slice(3)] = v; drawCurve(); }
    }
  });
  root.addEventListener("change", function (e) {
    var t = e.target, s = S(); if (!s) return; var strip = t.closest(".mx-strip");
    if (t.name === "mxOut") { X.op({ op: "trackOut", value: t.value, first: s.directFirst || 0 }); return; }
    if (t.dataset.mxMain === "outL" || t.dataset.mxMain === "outR") { var pp = {}; pp[t.dataset.mxMain] = Number(t.value); X.op({ op: "main", patch: pp }); return; }
    if (t.dataset.mxMain === "directFirst") { X.op({ op: "trackOut", value: "direct", first: Number(t.value) }); return; }
    if (t.dataset.mx === "direct" && strip) { X.op({ op: "input", i: Number(strip.dataset.i), patch: { direct: Number(t.value) } }); return; }
    if (t.dataset.mxListen === "sink") { window.CUListen.setSink(t.value); return; }
    if (t.dataset.mxListen === "tap") { if (listen.tap != null) startListen(t.value === "main" ? "main" : Number(t.value)); return; }
    if (t.hasAttribute("data-mx-all")) { showAll = t.checked; CU.store.set("mxAll", showAll); render(true); return; }
    if (t.dataset.mxd && t.type !== "range") {
      var k = t.dataset.mxd, patch = {};
      if (k === "eq.on" || k === "comp.on") { patch[k.split(".")[0]] = { on: t.checked }; }
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
    if (b.classList.contains("mx-name") || b.dataset.mx === "eq" || b.dataset.mx === "comp") { sel = sel === i && b.classList.contains("mx-name") ? -1 : i; CU.store.set("mxSel", sel); render(true); return; }
    if (b.dataset.mx === "mute") { X.op({ op: "input", i: i, patch: { mute: !s.inputs[i].mute } }); return; }
    if (b.dataset.mxMain === "mute") { X.op({ op: "main", patch: { mute: !s.main.mute } }); return; }
    if (b.dataset.mxd === "close") { sel = -1; CU.store.set("mxSel", sel); render(true); return; }
    if (b.dataset.mxd === "eqflat") { X.op({ op: "input", i: sel, patch: { hpf: 0, eq: { on: false, lg: 0, mg: 0, hg: 0, lf: 100, mf: 1000, mq: 1, hf: 8000 } } }); return; }
    if (b.dataset.mxListen === "go") { if (listen.tap != null) { stopListen(); render(true); } else { var tv = $('[data-mx-listen="tap"]').value; startListen(tv === "main" ? "main" : Number(tv)); } return; }
    if (b.dataset.mxRec === "go" && window.CU && window.CU.mixer) { var on = !((X.hostStatus || {}).recorder || {}).recording; window.CU.mixer.record({ on: on, tap: 0 }); return; }
    if (b.dataset.mxRec === "folder" && window.CU && window.CU.mixer) { window.CU.mixer.openRecordings(); return; }
    if (b.dataset.mxFile === "export") { window.CU.mixer.exportFile(); return; }
    if (b.dataset.mxFile === "import") { window.CU.mixer.importFile().catch(function (err) { alert(err.message); }); return; }
  });
  X.on("state", function () { render(true); });
  X.on("op", function (op) { if (!visible()) return; if (op.op === "input" && op.patch && (op.patch.name != null || op.patch.group || op.patch.src || op.patch.color != null || op.patch.direct != null)) render(); else if (op.op === "trackOut") render(true); else update(); });
  X.on("pi", function () { render(); });
  var lastRec = null;
  X.on("status", function (st) { if (!visible()) return; var r = st && st.recorder ? JSON.stringify([st.recorder.recording, st.recorder.saved]) : null; if (r !== lastRec) { lastRec = r; render(true); } });
  setInterval(function () { var b = $('[data-mx-rec="go"]'); var r = X.hostStatus && X.hostStatus.recorder; if (b && r && r.recording) { r.seconds = (r.seconds || 0) + 1; b.textContent = "■ Stop · " + fmtT(r.seconds); } }, 1000);
  CU.on("tab", function (t) { if (t === "mix") setTimeout(function () { render(true); }, 0); });
  window.CUMixTab = { render: render };
})();
