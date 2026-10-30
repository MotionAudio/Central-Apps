/* Central Usage - the Studio tab: write and record parts with MIDI keyboards, pads and Launchpads, like Logic or
 * Ableton. The engine is studio-engine.js; this draws it: the top bar (song, transport, tempo, click, loop), the Grid
 * (clips and scenes) or the Timeline, and underneath the clip editor (piano roll / drum steps / audio), the track's
 * sound (layers, split, velocity), its effects, the mixer and the MIDI devices. */
(function () {
  "use strict";
  var CU = window.CentralUsage, S = window.CUStudio, SND = window.CUStudioSounds, MIDI = window.CUMidiIn;
  var root = document.getElementById("view-studio"); if (!S || !root) return;
  function $(s, r) { return (r || root).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || root).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function clamp(v, a, b) { v = Number(v); return isFinite(v) ? Math.max(a, Math.min(b, v)) : a; }
  var NOTE = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  function noteName(n) { return NOTE[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1); }
  function parseNote(s) { var m = /^([A-Ga-g])(#|b)?(-?\d)$/.exec(String(s).trim()); if (!m) return null; var b = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1].toLowerCase()] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0); return clamp((Number(m[3]) + 1) * 12 + b, 0, 127); }
  var DRUMS = [[49, "Crash"], [51, "Ride"], [46, "Open hat"], [42, "Closed hat"], [44, "Pedal hat"], [50, "High tom"], [47, "Mid tom"], [45, "Low tom"], [43, "Floor tom"], [39, "Clap"], [37, "Rim"], [40, "Snare 2"], [38, "Snare"], [36, "Kick"]];
  var ui = { view: store("view", "grid"), tab: store("tab", "clip"), sel: null, clip: null, slot: null, zoom: store("zoom", 28), prZoom: 64, prTop: 84, computerKeys: false, msg: "", msgT: 0, browserCat: "all", browserQ: "", layer: 0, rec: false, built: false };
  function store(k, d) { try { var v = localStorage.getItem("cu-studio-" + k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } }
  function keep(k, v) { try { localStorage.setItem("cu-studio-" + k, JSON.stringify(v)); } catch (_) { } }
  function P() { return S.project(); }
  function selTrack() { var p = P(), t = S.track(ui.sel); if (!t) { t = p.tracks[0] || null; ui.sel = t && t.id; } return t; }
  function say(m) { ui.msg = m; clearTimeout(ui.msgT); ui.msgT = setTimeout(function () { ui.msg = ""; var e = $("#stMsg"); if (e) e.textContent = ""; }, 5000); var e = $("#stMsg"); if (e) e.textContent = m; }
  S.on("message", say);

  // ------------------------------------------------------------- the frame
  function build() {
    if (ui.built) return; ui.built = true;
    root.innerHTML =
      '<div class="st-top">' +
        '<div class="st-group st-song"><input id="stName" class="st-name" aria-label="Song name"><button id="stMenu" aria-haspopup="true">Song ▾</button><span id="stSaved" class="muted small"></span></div>' +
        '<div class="st-group st-transport"><button id="stHome" title="Back to the start">⏮</button><button id="stPlay" class="st-play" title="Play (space)">▶</button><button id="stStop" title="Stop">■</button><button id="stRec" class="st-rec" title="Record (R)">●</button><span id="stPos" class="st-pos">1.1</span></div>' +
        '<div class="st-group"><label>Tempo <input id="stBpm" type="number" min="30" max="300" step="1"></label><button id="stTap">Tap</button><select id="stSig" aria-label="Time signature"><option value="4/4">4/4</option><option value="3/4">3/4</option><option value="6/8">6/8</option><option value="2/4">2/4</option></select><label>Key <select id="stKey"></select></label><button id="stFromSong" title="Use the tempo and key of the song on the Central Pedal">From the song</button></div>' +
        '<div class="st-group"><button id="stClick" class="st-toggle">Click</button><select id="stCount" aria-label="Count-in"><option value="0">No count-in</option><option value="1">Count in 1 bar</option><option value="2">Count in 2 bars</option></select><button id="stLoop" class="st-toggle">Loop</button><button id="stOverdub" class="st-toggle" title="Record over what is already in the clip, instead of replacing it">Overdub</button></div>' +
        '<div class="st-group"><label>Snap <select id="stQ"><option value="1/4">1/4</option><option value="1/8">1/8</option><option value="1/16">1/16</option><option value="1/32">1/32</option><option value="1/8T">1/8 triplet</option><option value="1/16T">1/16 triplet</option><option value="off">Off</option></select></label><label>Clips start <select id="stLaunchQ"><option value="0">at once</option><option value="1">on the beat</option><option value="4">on the next bar</option><option value="8">every 2 bars</option></select></label></div>' +
        '<div class="st-group"><button id="stUndo" title="Undo (Ctrl+Z)">↶</button><button id="stRedo" title="Redo (Ctrl+Shift+Z)">↷</button></div>' +
        '<div class="st-group st-views"><button data-view="grid">Grid</button><button data-view="timeline">Timeline</button></div>' +
        '<div class="st-group st-status"><span id="stLat" class="muted small"></span><span id="stMsg" class="st-msg"></span></div>' +
      '</div>' +
      '<div id="stArea" class="st-area"></div>' +
      '<div class="st-detail"><div class="st-dtabs"><button data-dtab="clip">Clip</button><button data-dtab="sound">Sound</button><button data-dtab="fx">Effects</button><button data-dtab="mixer">Mixer</button><button data-dtab="devices">MIDI devices</button><span class="st-dtrack" id="stDTrack"></span><label class="toggle st-ck" title="Play the selected track with your computer keys: A W S E D F T G Y H U J K (Z / X: octave)"><input type="checkbox" id="stCompKeys"> Computer keys</label></div><div id="stDetail" class="st-dbody"></div></div>' +
      '<div id="stPop" class="st-pop" hidden></div>';
    $("#stKey").innerHTML = S.KEYS.map(function (k) { return '<option value="' + k + '">' + k + "</option>"; }).join("") + S.KEYS.map(function (k) { return '<option value="' + k + 'm">' + k + " minor</option>"; }).join("");
    wire();
  }

  // ------------------------------------------------------------- the top bar
  function drawTop() {
    var p = P(), st = S.state();
    if (document.activeElement !== $("#stName")) $("#stName").value = p.name;
    if (document.activeElement !== $("#stBpm")) $("#stBpm").value = Math.round(p.bpm * 10) / 10;
    $("#stSig").value = p.sig.join("/"); $("#stKey").value = p.key; $("#stCount").value = String(p.metronome.countIn || 0); $("#stQ").value = p.quantize; $("#stLaunchQ").value = String(p.launchQ);
    $("#stClick").classList.toggle("on", !!p.metronome.on); $("#stLoop").classList.toggle("on", !!p.loop.on); $("#stOverdub").classList.toggle("on", !!p.overdub);
    $("#stPlay").classList.toggle("on", st.playing); $("#stPlay").textContent = st.playing ? "❚❚" : "▶"; $("#stRec").classList.toggle("on", st.recording);
    $("#stUndo").disabled = !S.canUndo(); $("#stUndo").title = S.canUndo() ? "Undo: " + S.canUndo() : "Nothing to undo"; $("#stRedo").disabled = !S.canRedo(); $("#stRedo").title = S.canRedo() ? "Redo: " + S.canRedo() : "Nothing to redo";
    $$("[data-view]").forEach(function (b) { b.classList.toggle("on", b.dataset.view === ui.view); });
    $$("[data-dtab]").forEach(function (b) { b.classList.toggle("on", b.dataset.dtab === ui.tab); });
    $("#stSaved").textContent = S.isDirty() ? "not saved" : p.savedAt ? "saved" : "";
    var d = CU && CU.state && CU.state.display; $("#stFromSong").disabled = !(d && d.song);
    var m = S.monitor(), lat = S.latency();
    $("#stLat").textContent = m.ok && p.lowLatency ? "Playing live: low delay (" + (m.latencyMs || 3) + " ms)" : lat ? "Playing live: " + Math.round(lat.total * 1000) + " ms" : "";
    $("#stLat").title = m.ok ? "What you play goes through the low-delay player on this computer; recorded parts play here with their effects." : m.error ? m.error : "What you play is heard through this page. The Central Usage app plays it with less delay.";
    var t = selTrack(); $("#stDTrack").innerHTML = t ? '<i style="background:' + esc(t.color) + '"></i>' + esc(t.name) : "";
  }
  function posText(beat) { var bpb = S.beatsPerBar(), b = Math.max(0, beat), bar = Math.floor(b / bpb) + 1, bt = Math.floor(b % bpb) + 1, six = Math.floor((b % 1) * 4) + 1; return bar + "." + bt + "." + six; }
  var taps = [];
  function tap() { var n = performance.now(); taps = taps.filter(function (t) { return n - t < 2500; }); taps.push(n); if (taps.length >= 3) { var d = (taps[taps.length - 1] - taps[0]) / (taps.length - 1); S.edit("Tempo", function (p) { p.bpm = Math.round(60000 / d); }); } }

  // ------------------------------------------------------------- the grid
  function slotHtml(t, i, gs) {
    var p = P(), cid = t.slots[i], c = cid && p.clips[cid], g = gs[t.id] || {}, playing = g.playing === i, queued = g.queued === i, recording = g.recording === i;
    var cls = "st-slot" + (c ? " has" : "") + (playing ? " playing" : "") + (queued ? " queued" : "") + (recording ? " recording" : "") + (ui.clip === cid && cid ? " sel" : "") + (ui.slot && ui.slot.track === t.id && ui.slot.slot === i ? " cursor" : "");
    if (!c) return '<div class="' + cls + '" data-slot="' + i + '" data-track="' + t.id + '">' + (t.arm ? '<button class="st-slot-rec" data-recslot="' + i + '" data-track="' + t.id + '" title="Record a clip here">●</button>' : t.kind !== "audio" ? '<span class="st-slot-add">+</span>' : "") + "</div>";
    return '<div class="' + cls + '" data-slot="' + i + '" data-track="' + t.id + '" style="--cc:' + esc(c.color || t.color) + '"><button class="st-launch" data-launch="' + i + '" data-track="' + t.id + '" title="Play this clip">' + (playing ? "▶" : "▷") + '</button><span class="st-cname">' + esc(c.name || (c.kind === "audio" ? "Audio" : "Clip")) + '</span><span class="st-clen">' + Math.round(c.len / S.beatsPerBar() * 10) / 10 + ' bars</span><i class="st-prog" data-prog="' + t.id + '"></i></div>';
  }
  function drawGrid() {
    var p = P(), gs = S.gridState(), area = $("#stArea");
    var cols = "repeat(" + p.tracks.length + ", minmax(140px, 1fr)) 110px";
    var h = '<div class="st-grid" style="grid-template-columns:' + cols + '">';
    p.tracks.forEach(function (t) { h += headHtml(t, "col"); });
    h += '<div class="st-gh st-addtrack"><button id="stAddTrack">+ Track</button></div>';
    p.scenes.forEach(function (sc, i) {
      p.tracks.forEach(function (t) { h += slotHtml(t, i, gs); });
      h += '<div class="st-scene"><button data-scene="' + i + '" title="Play this row">▶ ' + esc(sc.name || "Scene " + (i + 1)) + "</button></div>";
    });
    p.tracks.forEach(function (t) { var g = gs[t.id] || {}; h += '<div class="st-gfoot"><button data-stoptrack="' + t.id + '"' + (g.playing == null && g.queued == null ? " disabled" : "") + ">■ Stop</button></div>"; });
    h += '<div class="st-gfoot"><button id="stStopAll">■ Stop all</button><button id="stAddScene" title="Add a row">+ Row</button></div></div>';
    area.innerHTML = h; area.className = "st-area grid";
  }
  function headHtml(t, kind) {
    var icon = t.kind === "audio" ? "🎙" : t.kind === "drums" ? "🥁" : "🎹", sel = ui.sel === t.id;
    return '<div class="st-gh st-head' + (sel ? " sel" : "") + (kind === "row" ? " row" : "") + '" data-head="' + t.id + '" style="--tc:' + esc(t.color) + '"><i class="st-tcol"></i><span class="st-ticon" aria-hidden="true">' + icon + '</span><input class="st-tname" data-tname="' + t.id + '" value="' + esc(t.name) + '" aria-label="Track name">' +
      '<span class="st-tbtns"><button class="st-arm' + (t.arm ? " on" : "") + '" data-arm="' + t.id + '" title="Arm for recording">●</button><button class="st-m' + (t.mute ? " on" : "") + '" data-mute="' + t.id + '" title="Mute">M</button><button class="st-s' + (t.solo ? " on" : "") + '" data-solo="' + t.id + '" title="Solo">S</button><button class="st-more" data-tmenu="' + t.id + '" title="More">⋯</button></span></div>';
  }

  // ------------------------------------------------------------- the timeline
  function drawTimeline() {
    var p = P(), area = $("#stArea"), bpb = S.beatsPerBar(), z = ui.zoom, bars = Math.max(16, Math.ceil((S.arrangementEnd() + bpb * 4) / bpb)), w = bars * bpb * z;
    var h = '<div class="st-tl"><div class="st-tl-heads"><div class="st-ruler-pad"><button id="stAddTrack">+ Track</button><label class="small">Zoom <input id="stZoom" type="range" min="8" max="90" value="' + z + '"></label></div>';
    p.tracks.forEach(function (t) { h += headHtml(t, "row"); });
    h += '</div><div class="st-tl-body" id="stTlBody"><div class="st-ruler" id="stRuler" style="width:' + w + 'px">';
    for (var b = 0; b < bars; b++) h += '<span class="st-bar" style="left:' + b * bpb * z + 'px">' + (b + 1) + "</span>";
    if (p.loop.on) h += '<i class="st-loopbrace" style="left:' + p.loop.start * z + "px;width:" + (p.loop.end - p.loop.start) * z + 'px"></i>';
    h += "</div>";
    p.tracks.forEach(function (t) {
      h += '<div class="st-lane' + (ui.sel === t.id ? " sel" : "") + '" data-lane="' + t.id + '" style="width:' + w + "px;--bw:" + bpb * z + 'px">';
      p.arrangement.filter(function (it) { return it.track === t.id; }).forEach(function (it) {
        var c = p.clips[it.clip]; if (!c) return;
        h += '<div class="st-item' + (ui.clip === it.clip ? " sel" : "") + (c.kind === "audio" ? " audio" : "") + '" data-item="' + it.id + '" style="left:' + it.start * z + "px;width:" + Math.max(6, it.len * z) + "px;--cc:" + esc(c.color || t.color) + '"><span>' + esc(c.name || "Clip") + "</span>" + itemPreview(c, it, z) + '<i class="st-resize" data-resize="' + it.id + '"></i></div>';
      });
      h += "</div>";
    });
    h += '<i class="st-playhead" id="stPlayhead"></i></div></div>';
    var sx = $("#stTlBody") ? $("#stTlBody").scrollLeft : 0;
    area.innerHTML = h; area.className = "st-area timeline"; $("#stTlBody").scrollLeft = sx;
  }
  function itemPreview(c, it, z) {
    if (c.kind === "audio") return '<canvas class="st-wave" data-wave="' + esc(c.id) + '" width="' + Math.min(4000, Math.max(6, Math.round(it.len * z))) + '" height="34"></canvas>';
    if (!c.notes.length) return "";
    var lo = 127, hi = 0; c.notes.forEach(function (n) { lo = Math.min(lo, n.p); hi = Math.max(hi, n.p); }); var span = Math.max(1, hi - lo), out = "", L = c.len > 0 ? c.len : it.len;
    for (var rep = 0; rep * L < it.len && rep < 64; rep++) { c.notes.forEach(function (n) { var x = (rep * L + n.s - (it.offset || 0)); if (x < 0 || x >= it.len) return; out += '<i class="st-mini" style="left:' + x * z + "px;width:" + Math.max(2, n.d * z) + "px;top:" + (4 + (1 - (n.p - lo) / span) * 26) + 'px"></i>'; }); if (!it.loop && !c.loopOnTimeline) break; }
    return out;
  }
  function drawWaves() {
    $$("canvas[data-wave]").forEach(function (cv) {
      var c = P().clips[cv.dataset.wave], buf = c && c.audio && S.buffers[c.audio.id]; if (!buf) return;
      var g = cv.getContext("2d"), d = buf.getChannelData(0), w = cv.width, h = cv.height, it = null;
      P().arrangement.forEach(function (x) { if (x.clip === c.id) it = x; }); var secs = it ? it.len * 60 / P().bpm : buf.duration, per = Math.max(1, Math.floor(secs * buf.sampleRate / w));
      g.clearRect(0, 0, w, h); g.fillStyle = "rgba(0,0,0,.55)";
      for (var x = 0; x < w; x++) { var o = x * per, m = 0; for (var i = 0; i < per && o + i < d.length; i += 4) { var v = Math.abs(d[o + i]); if (v > m) m = v; } var y = m * h / 2; g.fillRect(x, h / 2 - y, 1, Math.max(1, y * 2)); }
    });
  }

  // ------------------------------------------------------------- the detail panel
  function drawDetail() {
    var body = $("#stDetail"); if (!body) return;
    var t = selTrack();
    if (ui.tab === "clip") body.innerHTML = clipPanel(t);
    else if (ui.tab === "sound") body.innerHTML = t ? soundPanel(t) : "";
    else if (ui.tab === "fx") body.innerHTML = t ? fxPanel(t) : "";
    else if (ui.tab === "mixer") body.innerHTML = mixerPanel();
    else body.innerHTML = devicesPanel();
    if (ui.tab === "clip") afterClip();
  }
  // ---- the clip editor
  function curClip() { var c = ui.clip && P().clips[ui.clip]; return c || null; }
  function clipPanel(t) {
    var c = curClip();
    if (!c) return '<div class="st-empty"><p><b>No clip picked.</b> Click a clip on the grid or the timeline to edit it.</p><p class="muted">To make one, arm a track (●), press ● on an empty slot and play. Or double-click an empty slot, or an empty spot on the timeline, for a blank clip you can draw notes in.</p></div>';
    var p = P(), owner = trackOfClip(c.id) || t, bpb = S.beatsPerBar();
    var bar = '<div class="st-ctools"><input class="st-cname-in" id="stClipName" value="' + esc(c.name) + '" placeholder="Clip name"><label>Length <select id="stClipLen">' + [1, 2, 4, 8, 16, 32].map(function (b) { return '<option value="' + b * bpb + '"' + (Math.abs(c.len - b * bpb) < 0.01 ? " selected" : "") + ">" + b + (b === 1 ? " bar" : " bars") + "</option>"; }).join("") + (([1, 2, 4, 8, 16, 32].some(function (b) { return Math.abs(c.len - b * bpb) < 0.01; })) ? "" : '<option selected value="' + c.len + '">' + Math.round(c.len / bpb * 100) / 100 + " bars</option>") + "</select></label>" +
      (c.kind === "midi" ? '<button id="stQuant" title="Move the notes to the snap grid">Quantize</button><select id="stQStr" aria-label="Quantize strength"><option value="1">100%</option><option value="0.75">75%</option><option value="0.5">50%</option></select><button id="stDouble" title="Make the clip twice as long, the notes copied">×2</button><label>New notes <select id="stVel"><option value="70">soft</option><option value="100" selected>medium</option><option value="122">hard</option></select></label><button id="stTranspose" data-dir="1" title="Every note a semitone up">♯</button><button id="stTranspose2" data-dir="-1" title="Every note a semitone down">♭</button>' : "") +
      '<button id="stToTl" title="Put this clip on the timeline where the playhead is">On the timeline</button><button id="stDelClip" class="danger">Delete clip</button></div>';
    if (c.kind === "audio") { var buf = c.audio && S.buffers[c.audio.id]; return bar + '<div class="st-audioinfo"><p><b>Audio clip</b> · ' + (buf ? (Math.round(buf.duration * 10) / 10) + " s · " + buf.numberOfChannels + (buf.numberOfChannels > 1 ? " channels" : " channel") : "the audio is missing") + '</p><p class="muted">Move or trim it on the timeline. Audio plays at the speed it was recorded: change the tempo before you record, not after.</p></div>'; }
    return bar + (owner && owner.kind === "drums" ? drumEditor(c) : pianoRoll(c));
  }
  function afterClip() {   // the piano roll opens on the notes (or around middle C)
    var c = curClip(), pr = $(".st-pr"); if (!c || !pr || pr.dataset.scrolled === c.id) return; pr.dataset.scrolled = c.id;
    var mid = c.notes.length ? c.notes.reduce(function (a, n) { return a + n.p; }, 0) / c.notes.length : 60;
    pr.scrollTop = Math.max(0, (ui.prTop - mid) * 14 - pr.clientHeight / 2);
  }
  function trackOfClip(cid) { var p = P(), hit = null; p.tracks.forEach(function (t) { Object.keys(t.slots).forEach(function (k) { if (t.slots[k] === cid) hit = t; }); }); if (!hit) p.arrangement.forEach(function (it) { if (it.clip === cid) hit = S.track(it.track); }); return hit; }
  function gridStep() { var q = S.Q[P().quantize]; return q || 0.25; }
  function pianoRoll(c) {
    var z = ui.prZoom, rows = 60, top = ui.prTop, w = Math.max(c.len * z, 200), rowH = 14, h = '<div class="st-pr"><div class="st-pr-keys">';
    for (var r = 0; r < rows; r++) { var n = top - r, blk = [1, 3, 6, 8, 10].indexOf(n % 12) >= 0; h += '<div class="st-key' + (blk ? " blk" : "") + '" data-key="' + n + '">' + (n % 12 === 0 ? noteName(n) : "") + "</div>"; }
    h += '</div><div class="st-pr-scroll" id="stPrScroll"><div class="st-pr-grid" id="stPrGrid" style="width:' + w + "px;height:" + rows * rowH + "px;--z:" + z + "px;--bz:" + z * S.beatsPerBar() + "px;--sz:" + Math.max(4, z * gridStep()) + 'px">';
    for (var k = 0; k < rows; k++) { var nn = top - k; if ([1, 3, 6, 8, 10].indexOf(nn % 12) >= 0) h += '<i class="st-prrow" style="top:' + k * rowH + 'px"></i>'; }
    c.notes.forEach(function (n, i) { var rr = top - n.p; if (rr < 0 || rr >= rows) return; h += '<div class="st-note' + (ui.selNote === i ? " sel" : "") + '" data-note="' + i + '" style="left:' + n.s * z + "px;width:" + Math.max(3, n.d * z - 1) + "px;top:" + rr * rowH + "px;opacity:" + (0.45 + n.v / 127 * 0.55) + '"><i class="st-nres" data-nres="' + i + '"></i></div>'; });
    h += '<i class="st-prhead" id="stPrHead"></i></div><div class="st-vel" id="stVelLane" style="width:' + w + 'px">';
    c.notes.forEach(function (n, i) { h += '<i class="st-velbar" data-vel="' + i + '" style="left:' + n.s * z + "px;height:" + Math.round(n.v / 127 * 100) + '%" title="Velocity ' + n.v + '"></i>'; });
    h += '</div></div><div class="st-pr-side"><button data-prz="1.4" title="Zoom in">+</button><button data-prz="0.7" title="Zoom out">−</button><button data-prv="12" title="Up an octave">▲</button><button data-prv="-12" title="Down an octave">▼</button></div></div><p class="muted small st-hint">Click to add a note and drag to move it. Drag its right edge to make it longer, and double-click to remove it. The bars underneath set how hard each note plays.</p>';
    return h;
  }
  function drumEditor(c) {
    var step = gridStep(), n = Math.round(c.len / step), used = {}; c.notes.forEach(function (x) { used[x.p] = 1; });
    var rows = DRUMS.slice(); Object.keys(used).forEach(function (p) { p = Number(p); if (!rows.some(function (r) { return r[0] === p; })) rows.push([p, noteName(p)]); });
    var h = '<div class="st-drums" style="--steps:' + n + '">';
    rows.forEach(function (r) {
      h += '<div class="st-drow"><button class="st-dname" data-dkey="' + r[0] + '" title="Hear it">' + esc(r[1]) + "</button>";
      for (var i = 0; i < n; i++) { var at = i * step, hit = c.notes.filter(function (x) { return x.p === r[0] && Math.abs(x.s - at) < step / 2; })[0], beatStart = Math.abs(at % 1) < 1e-6, barStart = Math.abs(at % S.beatsPerBar()) < 1e-6; h += '<button class="st-step' + (hit ? " on" : "") + (hit && hit.v > 110 ? " acc" : "") + (beatStart ? " beat" : "") + (barStart ? " barst" : "") + '" data-step="' + i + '" data-dn="' + r[0] + '" title="' + esc(r[1]) + " · step " + (i + 1) + (hit ? " · velocity " + hit.v : "") + '"></button>'; }
      h += "</div>";
    });
    return h + '</div><p class="muted small st-hint">Click a step to add or remove a hit, and right-click a hit to make it louder. Change Snap for 1/8 or 1/32 steps.</p>';
  }
  // ---- the track's sound: layers (split, layer, velocity zones)
  function soundPanel(t) {
    if (t.kind === "audio") return '<div class="st-sound"><p><b>Audio track</b> · records your microphone or instrument input.</p><label>Input <select id="stAudioIn"><option value="">The computer\'s default input</option></select></label><p class="muted small">Arm it (●) and press record. If you hear yourself late, use headphones and turn off monitoring in your computer\'s sound settings. The recording lines up with the click either way.</p></div>';
    var L = t.layers, h = '<div class="st-sound"><div class="st-layers">';
    L.forEach(function (l, i) {
      var s = SND.byId(l.sound), lk = s && SND.locked(s);
      h += '<div class="st-layer' + (ui.layer === i ? " on" : "") + '" data-layer="' + i + '"><b>' + (L.length > 1 ? "Layer " + (i + 1) + ": " : "") + esc(s ? s.name : l.name || "Missing sound") + "</b>" + (lk ? ' <span class="st-lock">🔒 ' + esc(SND.lockText(s)) + " - playing a built-in sound until then</span>" : "") +
        '<div class="row"><label>Keys <input class="st-nin" data-lf="lo" value="' + noteName(l.lo == null ? 0 : l.lo) + '"> to <input class="st-nin" data-lf="hi" value="' + noteName(l.hi == null ? 127 : l.hi) + '"></label><label>Velocity <input type="number" min="1" max="127" data-lf="velLo" value="' + (l.velLo || 1) + '"> to <input type="number" min="1" max="127" data-lf="velHi" value="' + (l.velHi || 127) + '"></label>' +
        '<label>Octave <input type="number" min="-4" max="4" data-lf="octave" value="' + (l.octave || 0) + '"></label><label>Semitones <input type="number" min="-24" max="24" data-lf="transpose" value="' + (l.transpose || 0) + '"></label>' +
        '<label>Volume <input type="range" min="0" max="1.5" step="0.01" data-lf="volume" value="' + (l.volume == null ? 1 : l.volume) + '"></label><label>Pan <input type="range" min="-1" max="1" step="0.05" data-lf="pan" value="' + (l.pan || 0) + '"></label>' + (L.length > 1 ? '<button data-dellayer="' + i + '">Remove layer</button>' : "") + "</div></div>";
    });
    h += '</div><div class="row st-layerbtns">' + (L.length < 4 ? '<button id="stAddLayer" title="Another sound on the same keys">+ Layer a sound</button><button id="stSplit" title="Two sounds: one below a key, one above">Split the keyboard</button><button id="stVelSplit" title="A soft sound and a hard one">Split by how hard</button>' : "") +
      '<label>Plays from <select id="stTInput"><option value="any">Any device (when this track is picked)</option>' + MIDI.inputs().map(function (d) { return '<option value="' + esc(d.name) + '"' + (t.input === d.name ? " selected" : "") + ">" + esc(d.name) + " (always)</option>"; }).join("") + "</select></label>" +
      '<label>Live <select id="stTMon"><option value="auto"' + (t.monitor !== "page" ? " selected" : "") + '>low delay (effects on playback)</option><option value="page"' + (t.monitor === "page" ? " selected" : "") + ">with the track's effects</option></select></label></div>" + browser(t) + "</div>";
    return h;
  }
  function browser(t) {
    var all = SND.list().filter(function (s) { return t.kind === "drums" ? s.drums || s.category === "Drums" : !s.drums; }), cats = {};
    all.forEach(function (s) { cats[s.category] = 1; });
    var q = ui.browserQ.toLowerCase(), list = all.filter(function (s) { return (ui.browserCat === "all" || s.category === ui.browserCat) && (!q || (s.name + " " + s.bankName).toLowerCase().indexOf(q) >= 0); });
    var cur = (t.layers[ui.layer] || {}).sound;
    return '<div class="st-browser"><div class="row"><b>Pick a sound for ' + (t.layers.length > 1 ? "layer " + (ui.layer + 1) : "this track") + '</b><input id="stBrQ" placeholder="Search sounds" value="' + esc(ui.browserQ) + '"><span class="muted small">' + list.length + " sounds</span></div><div class=\"st-cats\">" +
      ["all"].concat(SND.CAT_ORDER.filter(function (c) { return cats[c]; })).map(function (c) { return '<button class="st-chip' + (ui.browserCat === c ? " on" : "") + '" data-cat="' + esc(c) + '">' + esc(c === "all" ? "All" : c) + "</button>"; }).join("") + '</div><div class="st-blist">' +
      list.slice(0, 400).map(function (s) { var lk = SND.locked(s); return '<button class="st-snd' + (s.id === cur ? " on" : "") + (lk ? " locked" : "") + '" data-snd="' + esc(s.id) + '" title="' + esc(lk ? SND.lockText(s) : s.bankName) + '">' + (lk ? "🔒 " : "") + esc(s.name) + "<small>" + esc(lk ? SND.lockText(s) : s.bankName) + "</small></button>"; }).join("") + (list.length > 400 ? '<p class="muted small">Showing 400 - search to find more.</p>' : "") + "</div></div>";
  }
  // ---- effects
  function fxPanel(t) {
    var fx = t.fx, pro = S.pro(), lk = function (on) { return on ? "" : " disabled"; }, row = function (label, path, min, max, step, unit, needPro) { var v = get(fx, path); return '<label class="st-fxr' + (needPro && !pro ? " locked" : "") + '"><span>' + esc(label) + '</span><input type="range" min="' + min + '" max="' + max + '" step="' + step + '" data-fx="' + path + '" value="' + v + '"' + lk(!needPro || pro) + '><em>' + fmt(v, unit) + "</em></label>"; };
    var tog = function (label, path) { return '<label class="toggle"><input type="checkbox" data-fx="' + path + '"' + (get(fx, path) ? " checked" : "") + "> " + esc(label) + "</label>"; };
    var h = '<div class="st-fx"><div class="row"><label class="toggle"><input type="checkbox" data-fx="on"' + (fx.on ? " checked" : "") + '> <b>Effects on</b></label><label>Preset <select id="stFxPreset"><option value="">-</option>' + S.PRESETS.map(function (p) { var l = p.pro && !pro; return '<option value="' + esc(p.name) + '"' + (fx.preset === p.name ? " selected" : "") + (l ? " disabled" : "") + ">" + (l ? "🔒 " : "") + esc(p.name) + "</option>"; }).join("") + "</select></label>" +
      (pro ? "" : '<span class="st-lock">🔒 ' + esc(window.PPPedals && window.PPPedals.lockText ? window.PPPedals.lockText("plugins") : "Central Plugins") + ": more EQ bands, every compressor and gate control, hall / plate / cathedral reverbs, dotted and ping-pong delays.</span>") + "</div><div class=\"st-fxcols\">";
    h += '<section><h4>' + tog("Gate", "gate.on") + "</h4>" + row("Threshold", "gate.threshold", -80, 0, 1, "dB") + (pro ? '<label class="toggle"><input type="checkbox" data-fxmode="gate"' + (fx.gate.mode === "full" ? " checked" : "") + "> Every control</label>" + row("Range", "gate.range", -80, 0, 1, "dB", true) + row("Hold", "gate.hold", 0, 500, 5, "ms", true) + row("Release", "gate.release", 5, 2000, 5, "ms", true) : "") + "</section>";
    h += '<section><h4>' + tog("EQ", "eq.on") + "</h4>" + row("Low cut", "eq.lowCut", 0, 400, 5, "Hz") + row("Low", "eq.low", -12, 12, 0.5, "dB") + row("Mid", "eq.mid", -12, 12, 0.5, "dB") + row("Mid freq", "eq.midFreq", 200, 6000, 10, "Hz") + row("High", "eq.high", -12, 12, 0.5, "dB") +
      row("Band 1 freq", "eq.bands.0.freq", 40, 16000, 10, "Hz", true) + row("Band 1 gain", "eq.bands.0.gain", -15, 15, 0.5, "dB", true) + row("Band 2 freq", "eq.bands.1.freq", 40, 16000, 10, "Hz", true) + row("Band 2 gain", "eq.bands.1.gain", -15, 15, 0.5, "dB", true) + row("High cut", "eq.highCut", 2000, 20000, 100, "Hz", true) + "</section>";
    h += '<section><h4>' + tog("Compressor", "comp.on") + "</h4>" + (fx.comp.mode === "full" && pro ? row("Threshold", "comp.threshold", -60, 0, 1, "dB", true) + row("Ratio", "comp.ratio", 1, 20, 0.1, ":1", true) + row("Attack", "comp.attack", 0.1, 300, 0.1, "ms", true) + row("Release", "comp.release", 10, 3000, 10, "ms", true) + row("Make-up", "comp.makeup", -12, 24, 0.5, "dB", true) : row("Amount", "comp.amount", 0, 100, 1, "%")) + (pro ? '<label class="toggle"><input type="checkbox" data-fxmode="comp"' + (fx.comp.mode === "full" ? " checked" : "") + "> Every control</label>" : "") + "</section>";
    h += '<section><h4>' + tog("Reverb", "reverb.on") + '</h4><label>Type <select data-fxsel="reverb.type">' + [["room", "Room", 0], ["hall", "Hall", 1], ["plate", "Plate", 1], ["cathedral", "Cathedral", 1]].map(function (o) { return '<option value="' + o[0] + '"' + (fx.reverb.type === o[0] ? " selected" : "") + (o[2] && !pro ? " disabled" : "") + ">" + (o[2] && !pro ? "🔒 " : "") + o[1] + "</option>"; }).join("") + "</select></label>" + row("Amount", "reverb.send", 0, 100, 1, "%") + row("Size", "reverb.size", -50, 50, 1, "", true) + "</section>";
    h += '<section><h4>' + tog("Delay", "delay.on") + '</h4><label>Time <select data-fxsel="delay.time">' + [["1/4", "1/4", 0], ["1/8", "1/8", 0], ["1/2", "1/2", 1], ["1/16", "1/16", 1], ["1/4.", "dotted 1/4", 1], ["1/8.", "dotted 1/8", 1]].map(function (o) { return '<option value="' + o[0] + '"' + (fx.delay.time === o[0] ? " selected" : "") + (o[2] && !pro ? " disabled" : "") + ">" + (o[2] && !pro ? "🔒 " : "") + o[1] + "</option>"; }).join("") + "</select></label>" + row("Amount", "delay.send", 0, 100, 1, "%") + row("Repeats", "delay.feedback", 0, pro ? 90 : 60, 1, "%") + (pro ? '<label class="toggle"><input type="checkbox" data-fx="delay.pingpong"' + (fx.delay.pingpong ? " checked" : "") + "> Ping-pong</label>" : "") + row("Tone", "delay.tone", 800, 16000, 100, "Hz", true) + "</section>";
    return h + "</div></div>";
  }
  function get(o, path) { path.split(".").forEach(function (k) { o = o == null ? undefined : o[k]; }); return o; }
  function setP(o, path, v) { var ks = path.split("."); for (var i = 0; i < ks.length - 1; i++) { if (o[ks[i]] == null) o[ks[i]] = /^\d+$/.test(ks[i + 1]) ? [] : {}; o = o[ks[i]]; } o[ks[ks.length - 1]] = v; }
  function fmt(v, unit) { v = Number(v); if (unit === "Hz") return v >= 1000 ? (v / 1000).toFixed(1) + " kHz" : Math.round(v) + " Hz"; if (unit === "dB") return (v > 0 ? "+" : "") + Math.round(v * 10) / 10 + " dB"; if (unit === "%") return Math.round(v) + "%"; if (unit === "ms") return Math.round(v) + " ms"; if (unit === ":1") return Math.round(v * 10) / 10 + ":1"; return String(Math.round(v)); }
  // ---- mixer
  function mixerPanel() {
    var p = P(), h = '<div class="st-mixer">';
    p.tracks.forEach(function (t) {
      h += '<div class="st-strip' + (ui.sel === t.id ? " sel" : "") + '" data-strip="' + t.id + '" style="--tc:' + esc(t.color) + '"><b title="' + esc(t.name) + '">' + esc(t.name) + '</b><button class="st-fxchip' + (t.fx.on ? " on" : "") + '" data-fxtrack="' + t.id + '">FX' + (t.fx.on && t.fx.preset ? " · " + esc(t.fx.preset) : "") + '</button><label>Pan<input type="range" min="-1" max="1" step="0.05" data-mix="pan" data-track="' + t.id + '" value="' + t.pan + '"></label>' +
        '<div class="st-fadewrap"><input type="range" class="st-fader" min="0" max="1.4" step="0.01" data-mix="volume" data-track="' + t.id + '" value="' + t.volume + '" aria-label="Volume"><i class="st-meter"><i data-meter="' + t.id + '"></i></i></div><span class="small">' + dbText(t.volume) + '</span><span class="st-tbtns"><button class="st-m' + (t.mute ? " on" : "") + '" data-mute="' + t.id + '">M</button><button class="st-s' + (t.solo ? " on" : "") + '" data-solo="' + t.id + '">S</button></span></div>';
    });
    return h + '<div class="st-strip master"><b>Master</b><span class="muted small">limiter at -1 dB</span><div class="st-fadewrap"><i class="st-meter big"><i data-meter="master"></i></i></div><label class="small">Click <input type="range" min="0" max="1" step="0.05" id="stClickLvl" value="' + P().metronome.level + '"></label></div></div>';
  }
  function dbText(g) { return g <= 0.0001 ? "-∞" : (g >= 1 ? "+" : "") + (Math.round(20 * Math.log10(g) * 10) / 10) + " dB"; }
  // ---- MIDI devices (up to 4 at once)
  var devCfg = store("devices", {});
  function devMode(name) { return devCfg[name] || (MIDI.isLaunchpad(name) ? "grid" : "selected"); }
  function activeDevices() { return MIDI.inputs().filter(function (d) { return devMode(d.name) !== "off"; }).slice(0, 4).map(function (d) { return d.name; }); }
  function devicesPanel() {
    var ins = MIDI.inputs(), act = activeDevices(), p = P();
    if (!ins.length) return '<div class="st-devs"><p><b>No MIDI devices found.</b> Plug in a USB keyboard, pad controller or Launchpad - it shows up here by itself.</p><p class="muted">No keyboard with you? Tick <b>Computer keys</b> above and play with A W S E D F T G Y H U J K.</p></div>';
    return '<div class="st-devs"><p class="muted">Up to four devices play at once. A keyboard plays the track you\'ve picked, or always the same track; a Launchpad can play the grid.</p>' + ins.map(function (d) {
      var m = devMode(d.name), on = act.indexOf(d.name) >= 0;
      return '<div class="st-dev' + (on ? " on" : "") + '"><b>' + esc(d.name) + "</b>" + (d.launchpad ? ' <span class="muted small">Launchpad</span>' : "") + '<select data-dev="' + esc(d.name) + '"><option value="selected"' + (m === "selected" ? " selected" : "") + ">Plays the picked track</option>" + p.tracks.filter(function (t) { return t.kind !== "audio"; }).map(function (t) { return '<option value="track:' + t.id + '"' + (m === "track:" + t.id ? " selected" : "") + ">Always plays " + esc(t.name) + "</option>"; }).join("") + (d.launchpad ? '<option value="grid"' + (m === "grid" ? " selected" : "") + ">Plays the grid (clips and scenes)</option>" : "") + '<option value="off"' + (m === "off" ? " selected" : "") + ">Off</option></select>" + (m !== "off" && !on ? '<span class="st-lock">Four devices are already playing - turn one off first.</span>' : "") + "</div>";
    }).join("") + '<p class="muted small">Start / Stop from a device (MIDI start and stop) plays and stops the Studio.</p></div>';
  }

  // ------------------------------------------------------------- drawing everything
  var drawT = 0;
  function draw() { if (!root.classList.contains("active")) return; build(); drawTop(); if (ui.view === "grid") drawGrid(); else { drawTimeline(); drawWaves(); } drawDetail(); }
  function drawSoon() { cancelAnimationFrame(drawT); drawT = requestAnimationFrame(draw); }
  S.on("change", drawSoon); S.on("transport", function () { if (root.classList.contains("active")) { drawTop(); if (ui.view === "grid") drawGrid(); } lightPads(); });
  S.on("clip", function () { if (root.classList.contains("active") && ui.view === "grid") drawGrid(); lightPads(); });
  S.on("monitor", function () { if (root.classList.contains("active")) drawTop(); });
  S.on("saved", function () { if (root.classList.contains("active")) drawTop(); });
  SND.onChange(function () { if (root.classList.contains("active") && ui.tab === "sound") drawDetail(); });
  S.on("meters", function (m) { Object.keys(m).forEach(function (id) { var e = root.querySelector('[data-meter="' + id + '"]'); if (e) e.style.height = Math.min(100, Math.round(Math.sqrt(m[id]) * 100)) + "%"; }); });
  function frame() {
    requestAnimationFrame(frame); if (!root.classList.contains("active")) return;
    var st = S.state(), pos = $("#stPos"); if (pos) pos.textContent = (st.countingIn ? "count-in " : "") + posText(st.pos);
    var ph = $("#stPlayhead"); if (ph) ph.style.left = Math.max(0, st.pos) * ui.zoom + "px";
    $$("[data-prog]").forEach(function (e) { var f = S.clipProgress(e.dataset.prog); e.style.width = f == null ? "0" : Math.round(f * 100) + "%"; });
    var prh = $("#stPrHead"), c = curClip(); if (prh && c) { var tr = trackOfClip(c.id), g = tr && S.gridState()[tr.id], f = tr && g && g.playing != null && tr.slots[g.playing] === c.id ? S.clipProgress(tr.id) : null; prh.style.display = f == null ? "none" : "block"; if (f != null) prh.style.left = f * c.len * ui.prZoom + "px"; }
  }
  requestAnimationFrame(frame);

  // ------------------------------------------------------------- actions
  function addTrack(kind) {
    S.edit("Add track", function (p) { var n = p.tracks.filter(function (t) { return t.kind === kind; }).length + 1, t = S.newTrack(kind, (kind === "audio" ? "Audio " : kind === "drums" ? "Drums " : "Keys ") + n); t.color = S.COLORS[p.tracks.length % S.COLORS.length]; p.tracks.push(t); ui.sel = t.id; });
  }
  function newEmptyClip(t, slot, atBeat) {
    if (!t || t.kind === "audio") return;
    var bpb = S.beatsPerBar();
    S.edit("New clip", function (p) { var c = S.newClip("midi", bpb); c.name = t.name + " " + (Object.keys(p.clips).length + 1); p.clips[c.id] = c; if (atBeat != null) p.arrangement.push({ id: S.uid("a"), track: t.id, clip: c.id, start: atBeat, len: bpb, offset: 0 }); else t.slots[slot] = c.id; ui.clip = c.id; });
    ui.tab = "clip"; keep("tab", ui.tab);
  }
  function popMenu(anchor, items) {   // [[label, fn, disabled?]]
    var pop = $("#stPop"), r = anchor.getBoundingClientRect(), rr = root.getBoundingClientRect();
    pop.innerHTML = items.map(function (it, i) { return it ? '<button data-pi="' + i + '"' + (it[2] ? " disabled" : "") + ">" + esc(it[0]) + "</button>" : "<hr>"; }).join("");
    pop.hidden = false; pop.style.left = Math.max(4, Math.min(r.left - rr.left, rr.width - 240)) + "px"; pop.style.top = (r.bottom - rr.top + 4) + "px";
    pop.onclick = function (e) { var b = e.target.closest("[data-pi]"); if (!b) return; pop.hidden = true; var it = items[Number(b.dataset.pi)]; if (it) it[1](); };
  }
  function songMenu(b) {
    popMenu(b, [["New song", function () { if (S.isDirty() && !confirm("Start a new song? What isn't saved here will be lost.")) return; var d = CU && CU.state && CU.state.display, s = d && d.song; S.fresh({ bpm: (d && d.bpm) || (s && s.bpm) || 100, key: s && s.key ? String(s.key).replace(/m$/, "") : "C" }); ui.clip = null; ui.sel = null; draw(); }],
      ["Open…", openDialog], ["Save", function () { S.save().then(function () { say("Saved."); }).catch(function (e) { say("Couldn't save: " + (e.message || e)); }); }], null,
      ["Export the mix (WAV)", function () { say("Exporting…"); S.exportMix().then(function (r) { say(r ? "Exported" + (r === "downloads" ? " to your downloads." : ": " + r) : "Export cancelled."); }).catch(function (e) { say(e.message || String(e)); }); }],
      ["Export stems (a WAV per track)", function () { say("Exporting stems…"); S.exportStems().then(function (r) { say(r ? "Stems exported" + (r === "downloads" ? " to your downloads." : ": " + r) : "Export cancelled."); }).catch(function (e) { say(e.message || String(e)); }); }], null,
      ["Put the grid's rows on the timeline", function () { S.scenesToTimeline(); ui.view = "timeline"; keep("view", ui.view); draw(); }],
      ["Low-delay playing: " + (P().lowLatency ? "on" : "off"), function () { S.edit("Low-delay playing", function (p) { p.lowLatency = !p.lowLatency; }); }]]);
  }
  function openDialog() {
    S.list().then(function (list) {
      var pop = $("#stPop"); pop.hidden = false; pop.style.left = "20px"; pop.style.top = "50px";
      pop.innerHTML = '<div class="st-open"><b>Your songs</b>' + (list.length ? list.map(function (x) { return '<div class="row"><button data-open="' + esc(x.id) + '">' + esc(x.name) + '</button><span class="muted small">' + (x.bpm ? x.bpm + " BPM · " : "") + (x.key || "") + (x.savedAt ? " · " + new Date(x.savedAt).toLocaleString() : "") + '</span><button data-delproj="' + esc(x.id) + '" title="Delete">✕</button></div>'; }).join("") : '<p class="muted">Nothing saved yet.</p>') + '<button data-closepop="1">Close</button></div>';
      pop.onclick = function (e) {
        var o = e.target.closest("[data-open]"), d = e.target.closest("[data-delproj]");
        if (e.target.closest("[data-closepop]")) pop.hidden = true;
        if (o) { if (S.isDirty() && !confirm("Open another song? What isn't saved here will be lost.")) return; pop.hidden = true; S.open(o.dataset.open).then(function () { ui.clip = null; ui.sel = null; draw(); say("Opened."); }).catch(function (er) { say(er.message || String(er)); }); }
        if (d && confirm("Delete this song for good?")) S.remove(d.dataset.delproj).then(openDialog);
      };
    });
  }
  function trackMenu(b, t) {
    popMenu(b, [["Duplicate", function () { S.edit("Duplicate track", function (p) { var c = JSON.parse(JSON.stringify(t)); c.id = S.uid("t"); c.name = t.name + " copy"; c.slots = {}; c.arm = false; Object.keys(t.slots).forEach(function (k) { var cl = JSON.parse(JSON.stringify(p.clips[t.slots[k]])); cl.id = S.uid("c"); p.clips[cl.id] = cl; c.slots[k] = cl.id; }); p.tracks.splice(p.tracks.indexOf(S.track(t.id)) + 1, 0, c); }); }],
      ["Move left / up", function () { S.edit("Move track", function (p) { var i = p.tracks.findIndex(function (x) { return x.id === t.id; }); if (i > 0) p.tracks.splice(i - 1, 0, p.tracks.splice(i, 1)[0]); }); }],
      ["Move right / down", function () { S.edit("Move track", function (p) { var i = p.tracks.findIndex(function (x) { return x.id === t.id; }); if (i < p.tracks.length - 1) p.tracks.splice(i + 1, 0, p.tracks.splice(i, 1)[0]); }); }],
      ["Colour", function () { S.edit("Colour", function () { var tt = S.track(t.id); tt.color = S.COLORS[(S.COLORS.indexOf(tt.color) + 1) % S.COLORS.length]; }); }],
      ["Back to the timeline", function () { S.backToTimeline(t.id); }], null,
      ["Delete track", function () { if (!confirm("Delete " + t.name + " and its clips?")) return; S.edit("Delete track", function (p) { p.tracks = p.tracks.filter(function (x) { return x.id !== t.id; }); p.arrangement = p.arrangement.filter(function (it) { return it.track !== t.id; }); }); }]]);
  }

  // ------------------------------------------------------------- wiring
  function editTrack(id, label, fn) { S.edit(label, function () { var t = S.track(id); if (t) fn(t); }); }
  function wire() {
    root.addEventListener("click", function (e) {
      var b = e.target.closest("button, [data-slot], [data-head]"); if (!b) { if (!e.target.closest("#stPop")) $("#stPop").hidden = true; return; }
      if (!b.closest("#stPop")) $("#stPop").hidden = true;
      var d = b.dataset, p = P();
      if (b.id === "stPlay") { var st = S.state(); if (st.playing) S.stop(); else S.play(); return; }
      if (b.id === "stStop") { S.stop({ home: !S.state().playing }); return; }
      if (b.id === "stHome") { S.setPos(0); return; }
      if (b.id === "stRec") { S.record(ui.view === "grid" && ui.slot ? { slot: ui.slot.slot, track: ui.slot.track } : {}); return; }
      if (b.id === "stTap") return tap();
      if (b.id === "stFromSong") { var dd = CU && CU.state && CU.state.display, s = dd && dd.song; if (!s) return; S.edit("Tempo and key from the song", function (pp) { pp.bpm = clamp(dd.bpm || s.bpm || pp.bpm, 30, 300); if (s.key) pp.key = String(s.key); }); say("Tempo " + P().bpm + " · key " + P().key + " - from " + s.name + "."); return; }
      if (b.id === "stClick") { S.edit("Click", function (pp) { pp.metronome.on = !pp.metronome.on; }); return; }
      if (b.id === "stLoop") { S.edit("Loop", function (pp) { pp.loop.on = !pp.loop.on; if (pp.loop.end <= pp.loop.start) pp.loop.end = pp.loop.start + 4 * S.beatsPerBar(); }); return; }
      if (b.id === "stOverdub") { S.edit("Overdub", function (pp) { pp.overdub = !pp.overdub; }); return; }
      if (b.id === "stUndo") { var u = S.undo(); if (u) say("Undone: " + u); return; }
      if (b.id === "stRedo") { var r = S.redo(); if (r) say("Redone: " + r); return; }
      if (b.id === "stMenu") return songMenu(b);
      if (d.view) { ui.view = d.view; keep("view", ui.view); draw(); return; }
      if (d.dtab) { ui.tab = d.dtab; keep("tab", ui.tab); drawTop(); drawDetail(); return; }
      if (b.id === "stAddTrack") return popMenu(b, [["Instrument track (a keyboard sound)", function () { addTrack("instrument"); }], ["Drum track", function () { addTrack("drums"); }], ["Audio track (record a microphone or instrument)", function () { addTrack("audio"); }]]);
      if (b.id === "stAddScene") { S.edit("Add row", function (pp) { pp.scenes.push({ id: S.uid("s"), name: "" }); }); return; }
      if (b.id === "stStopAll") { S.stopAll(); return; }
      if (d.scene != null) { S.launchScene(Number(d.scene)); return; }
      if (d.stoptrack) { S.stopTrack(d.stoptrack); return; }
      if (d.arm) { editTrack(d.arm, "Arm", function (t) { t.arm = !t.arm; }); return; }
      if (d.mute) { editTrack(d.mute, "Mute", function (t) { t.mute = !t.mute; }); return; }
      if (d.solo) { editTrack(d.solo, "Solo", function (t) { t.solo = !t.solo; }); return; }
      if (d.tmenu) { var tm = S.track(d.tmenu); if (tm) trackMenu(b, tm); return; }
      if (d.recslot != null) { ui.sel = d.track; ui.slot = { track: d.track, slot: Number(d.recslot) }; S.record({ slot: Number(d.recslot), track: d.track }); return; }
      if (d.launch != null) { ui.sel = d.track; var tt = S.track(d.track); ui.clip = tt && tt.slots[d.launch]; S.launch(d.track, Number(d.launch)); drawDetail(); return; }
      if (d.slot != null && d.track) { ui.sel = d.track; ui.slot = { track: d.track, slot: Number(d.slot) }; var t2 = S.track(d.track); ui.clip = t2 && t2.slots[d.slot] || null; drawTop(); drawGrid(); drawDetail(); return; }
      if (d.head) { if (e.target.closest("input")) { ui.sel = d.head; drawTop(); return; } ui.sel = d.head; draw(); return; }
      // clip editor
      if (b.id === "stQuant") { var c = curClip(); if (c) S.edit("Quantize", function () { S.quantizeNotes(curClip().notes, P().quantize, Number($("#stQStr").value)); }); return; }
      if (b.id === "stDouble") { S.edit("Double the clip", function () { var c2 = curClip(); var add = c2.notes.map(function (n) { return Object.assign({}, n, { s: n.s + c2.len }); }); c2.notes = c2.notes.concat(add); c2.len *= 2; }); return; }
      if (b.id === "stTranspose" || b.id === "stTranspose2") { var dir = Number(d.dir); S.edit("Transpose", function () { curClip().notes.forEach(function (n) { n.p = clamp(n.p + dir, 0, 127); }); }); return; }
      if (b.id === "stToTl") { var cc = curClip(), own = cc && trackOfClip(cc.id); if (!cc || !own) return; var at = Math.floor(S.position() / S.beatsPerBar()) * S.beatsPerBar(); S.edit("Clip on the timeline", function (pp) { var cp = JSON.parse(JSON.stringify(cc)); cp.id = S.uid("c"); pp.clips[cp.id] = cp; pp.arrangement.push({ id: S.uid("a"), track: own.id, clip: cp.id, start: at, len: cp.len, offset: 0 }); }); say("Put on the timeline at bar " + (at / S.beatsPerBar() + 1) + "."); return; }
      if (b.id === "stDelClip") { var dc = curClip(); if (!dc) return; S.edit("Delete clip", function (pp) { pp.tracks.forEach(function (t) { Object.keys(t.slots).forEach(function (k) { if (t.slots[k] === dc.id) delete t.slots[k]; }); }); pp.arrangement = pp.arrangement.filter(function (it) { return it.clip !== dc.id; }); delete pp.clips[dc.id]; }); ui.clip = null; return; }
      if (d.prz) { ui.prZoom = clamp(ui.prZoom * Number(d.prz), 16, 240); drawDetail(); return; }
      if (d.prv) { ui.prTop = clamp(ui.prTop + Number(d.prv), 59, 127); drawDetail(); return; }
      if (d.step != null) { var dn = Number(d.dn), stp = gridStep(), at2 = Number(d.step) * stp; S.edit("Drum step", function () { var c3 = curClip(), i = c3.notes.findIndex(function (n) { return n.p === dn && Math.abs(n.s - at2) < stp / 2; }); if (i >= 0) c3.notes.splice(i, 1); else c3.notes.push({ p: dn, s: at2, d: stp, v: Number(($("#stVel") || {}).value) || 100 }); }); audition(dn); return; }
      if (d.dkey) { audition(Number(d.dkey)); return; }
      if (d.key) { audition(Number(d.key)); return; }
      // sound
      if (d.snd) { var t3 = selTrack(), s3 = SND.byId(d.snd); if (!t3 || !s3) return; if (SND.locked(s3)) { say("🔒 " + s3.name + ": " + SND.lockText(s3) + ". Add the plan in Settings → Packages."); return; } var li = Math.min(ui.layer, t3.layers.length - 1); editTrack(t3.id, "Sound", function (t) { var l = t.layers[li]; l.sound = s3.id; l.name = s3.name; l.file = s3.file; l.bank = s3.bank; l.prog = s3.prog; l.tier = s3.tier; if (t.layers.length === 1 && !/\d$/.test(t.name) && t.name === "Keys") t.name = s3.name.slice(0, 24); }); setTimeout(function () { audition(t3.kind === "drums" ? 38 : 60); }, 120); return; }
      if (d.cat) { ui.browserCat = d.cat; drawDetail(); return; }
      if (d.layer != null && !e.target.closest("input,select,button")) { ui.layer = Number(d.layer); drawDetail(); return; }
      if (b.id === "stAddLayer") { editTrack(selTrack().id, "Add layer", function (t) { t.layers.push(Object.assign({}, t.layers[0], { volume: 0.7 })); ui.layer = t.layers.length - 1; }); return; }
      if (b.id === "stSplit") { var at4 = parseNote(prompt("Split at which key? (below it: the first sound, from it up: the second)", "C4") || ""); if (at4 == null) return; editTrack(selTrack().id, "Split", function (t) { var a = t.layers[0]; a.hi = at4 - 1; a.lo = 0; t.layers.push(Object.assign({}, a, { lo: at4, hi: 127, sound: "builtin:lead", name: "Bright Lead" })); ui.layer = t.layers.length - 1; }); return; }
      if (b.id === "stVelSplit") { editTrack(selTrack().id, "Velocity split", function (t) { var a = t.layers[0]; a.velLo = 1; a.velHi = 89; t.layers.push(Object.assign({}, a, { velLo: 90, velHi: 127 })); ui.layer = t.layers.length - 1; }); say("Played softly: layer 1. Hard (velocity 90 and up): layer 2 - pick its sound below."); return; }
      if (d.dellayer != null) { editTrack(selTrack().id, "Remove layer", function (t) { t.layers.splice(Number(d.dellayer), 1); ui.layer = 0; }); return; }
      if (d.fxtrack) { ui.sel = d.fxtrack; ui.tab = "fx"; keep("tab", ui.tab); draw(); return; }
    });
    root.addEventListener("dblclick", function (e) {
      var slot = e.target.closest("[data-slot]"); if (slot && !slot.classList.contains("has")) { var t = S.track(slot.dataset.track); newEmptyClip(t, Number(slot.dataset.slot)); return; }
      var lane = e.target.closest("[data-lane]"); if (lane && !e.target.closest("[data-item]")) { var t2 = S.track(lane.dataset.lane), x = e.clientX - lane.getBoundingClientRect().left, bpb = S.beatsPerBar(); newEmptyClip(t2, null, Math.floor(x / ui.zoom / bpb) * bpb); return; }
      var note = e.target.closest("[data-note]"); if (note) { var i = Number(note.dataset.note); S.edit("Remove note", function () { curClip().notes.splice(i, 1); }); ui.selNote = null; return; }
    });
    root.addEventListener("contextmenu", function (e) {
      var st = e.target.closest("[data-step]"); if (st && st.classList.contains("on")) { e.preventDefault(); var dn = Number(st.dataset.dn), at = Number(st.dataset.step) * gridStep(); S.edit("Accent", function () { var n = curClip().notes.filter(function (x) { return x.p === dn && Math.abs(x.s - at) < gridStep() / 2; })[0]; if (n) n.v = n.v > 110 ? 96 : 125; }); }
    });
    root.addEventListener("change", function (e) {
      var el = e.target, d = el.dataset, p = P();
      if (el.id === "stName") { S.edit("Rename", function (pp) { pp.name = el.value.trim() || "New song"; }); return; }
      if (el.id === "stBpm") { S.edit("Tempo", function (pp) { pp.bpm = clamp(el.value, 30, 300); }); return; }
      if (el.id === "stSig") { S.edit("Time signature", function (pp) { pp.sig = el.value.split("/").map(Number); }); return; }
      if (el.id === "stKey") { S.edit("Key", function (pp) { pp.key = el.value; }); return; }
      if (el.id === "stCount") { S.edit("Count-in", function (pp) { pp.metronome.countIn = Number(el.value); }); return; }
      if (el.id === "stQ") { S.edit("Snap", function (pp) { pp.quantize = el.value; }); return; }
      if (el.id === "stLaunchQ") { S.edit("Clips start", function (pp) { pp.launchQ = Number(el.value); }); return; }
      if (d.tname) { editTrack(d.tname, "Rename track", function (t) { t.name = el.value.trim() || t.name; }); return; }
      if (el.id === "stClipName") { S.edit("Rename clip", function () { curClip().name = el.value; }); return; }
      if (el.id === "stClipLen") { S.edit("Clip length", function () { var c = curClip(); c.len = Number(el.value); p.arrangement.forEach(function (it) { if (it.clip === c.id && !it.loop) it.len = c.len; }); }); return; }
      if (d.lf) { var li = Number(el.closest("[data-layer]").dataset.layer), f = d.lf, v = f === "lo" || f === "hi" ? parseNote(el.value) : Number(el.value); if (v == null) { say("Keys are written like C4 or F#3."); drawDetail(); return; } editTrack(selTrack().id, "Layer", function (t) { t.layers[li][f] = v; }); return; }
      if (el.id === "stTInput") { editTrack(selTrack().id, "Input", function (t) { t.input = el.value; }); return; }
      if (el.id === "stTMon") { editTrack(selTrack().id, "Live", function (t) { t.monitor = el.value; }); return; }
      if (el.id === "stAudioIn") { editTrack(selTrack().id, "Input", function (t) { t.inputDevice = el.value; }); return; }
      if (el.id === "stFxPreset") { editTrack(selTrack().id, "Preset", function (t) { t.fx = S.applyPreset(t.fx, el.value); }); return; }
      if (d.fx) { var val = el.type === "checkbox" ? el.checked : Number(el.value); editTrack(selTrack().id, "Effects", function (t) { setP(t.fx, d.fx, val); if (d.fx !== "on" && val) t.fx.on = true; t.fx.preset = ""; }); return; }
      if (d.fxsel) { editTrack(selTrack().id, "Effects", function (t) { setP(t.fx, d.fxsel, el.value); }); return; }
      if (d.fxmode) { editTrack(selTrack().id, "Effects", function (t) { t.fx[d.fxmode].mode = el.checked ? "full" : "basic"; }); return; }
      if (d.mix) { editTrack(d.track, d.mix === "pan" ? "Pan" : "Volume", function (t) { t[d.mix] = Number(el.value); }); return; }
      if (el.id === "stClickLvl") { S.edit("Click level", function (pp) { pp.metronome.level = Number(el.value); }); return; }
      if (d.dev) { devCfg[d.dev] = el.value; keep("devices", devCfg); setupDevices(); drawDetail(); return; }
      if (el.id === "stCompKeys") { ui.computerKeys = el.checked; return; }
    });
    root.addEventListener("input", function (e) {
      var el = e.target;
      if (el.id === "stBrQ") { ui.browserQ = el.value; var pos = el.selectionStart; drawDetail(); var n = $("#stBrQ"); if (n) { n.focus(); n.setSelectionRange(pos, pos); } return; }
      if (el.id === "stZoom") { ui.zoom = Number(el.value); keep("zoom", ui.zoom); drawTimeline(); drawWaves(); return; }
      if (el.dataset.mix) { var t = S.track(el.dataset.track); if (t) { t[el.dataset.mix] = Number(el.value); var s = S.graph() && S.graph().strips[t.id]; if (s) { if (el.dataset.mix === "pan") s.pan.pan.value = t.pan; else s.fader.gain.value = t.volume; } } return; }   // (live while dragging; the change event makes the undo step)
      if (el.dataset.fx && el.type === "range") { var em = el.parentNode.querySelector("em"); if (em) em.textContent = el.value; }
    });
    root.addEventListener("pointerdown", onPointer);
    // the browser's Electron menu / keyboard
    document.addEventListener("keydown", onKey); document.addEventListener("keyup", onKeyUp);
    // a file dropped on a timeline lane or an audio track becomes an audio clip there
    root.addEventListener("dragover", function (e) { if (e.dataTransfer && Array.prototype.some.call(e.dataTransfer.items || [], function (i) { return i.kind === "file"; })) e.preventDefault(); });
    root.addEventListener("drop", function (e) {
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (!f) return; e.preventDefault();
      var lane = e.target.closest("[data-lane]"), t = lane ? S.track(lane.dataset.lane) : selTrack(); if (!t || t.kind !== "audio") { say("Drop audio files on an audio track's lane on the timeline."); return; }
      var at = lane ? Math.max(0, Math.floor((e.clientX - lane.getBoundingClientRect().left) / ui.zoom)) : 0;
      f.arrayBuffer().then(function (ab) { return S.importAudio(t.id, ab, f.name.replace(/\.[^.]+$/, ""), at); }).then(function () { say("Added " + f.name + "."); }).catch(function () { say("That file couldn't be read as audio."); });
    });
  }
  // ---- dragging: timeline items (move / resize), the ruler (position / loop), piano-roll notes, velocity bars
  function onPointer(e) {
    if (e.button !== 0) return;
    var p = P(), z = ui.zoom, bpb = S.beatsPerBar(), snap = gridStep(), snapTl = Math.max(snap, bpb / 4);
    var ruler = e.target.closest("#stRuler");
    if (ruler) { var rx = ruler.getBoundingClientRect().left, b0 = Math.max(0, (e.clientX - rx) / z); if (e.shiftKey || e.altKey) { var a = Math.round(b0 / bpb) * bpb; dragLoop(ruler, rx, a); } else S.setPos(Math.round(b0 / snapTl) * snapTl); return; }
    var res = e.target.closest("[data-resize]");
    var item = e.target.closest("[data-item]");
    if (item) {
      var it = p.arrangement.filter(function (x) { return x.id === item.dataset.item; })[0]; if (!it) return;
      ui.clip = it.clip; ui.sel = it.track; e.preventDefault();
      var sx = e.clientX, sy = e.clientY, st0 = it.start, len0 = it.len, moved = false, lanes = $$("[data-lane]"), before = JSON.stringify(p);
      var mv = function (ev) {
        var db = (ev.clientX - sx) / z;
        if (res) { it.len = Math.max(snapTl, Math.round((len0 + db) / snapTl) * snapTl); var c = p.clips[it.clip]; if (c && c.kind === "midi" && it.len > c.len) it.loop = true; }
        else { it.start = Math.max(0, Math.round((st0 + db) / snapTl) * snapTl); var lane = lanes.filter(function (l) { var r = l.getBoundingClientRect(); return ev.clientY >= r.top && ev.clientY < r.bottom; })[0]; if (lane) { var nt = S.track(lane.dataset.lane), ct = p.clips[it.clip]; if (nt && ct && (ct.kind === "audio") === (nt.kind === "audio")) it.track = nt.id; } }
        moved = moved || Math.abs(ev.clientX - sx) > 3 || Math.abs(ev.clientY - sy) > 3;
        item.style.left = it.start * z + "px"; item.style.width = Math.max(6, it.len * z) + "px";
      };
      var up = function () { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); if (moved) { var now = JSON.stringify(p), after = JSON.parse(now); S.load && restoreThenEdit(before, after, res ? "Resize clip" : "Move clip"); } else { drawTop(); drawTimeline(); drawWaves(); drawDetail(); } };
      window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up); return;
    }
    var grid = e.target.closest("#stPrGrid");
    if (grid) { pianoPointer(e, grid); return; }
    var vel = e.target.closest("#stVelLane");
    if (vel) { velPointer(e, vel); return; }
  }
  // a drag changed the project in place: make it one undo step
  function restoreThenEdit(beforeJson, after, label) {
    var p = P(), cur = JSON.parse(beforeJson);
    Object.keys(p).forEach(function (k) { p[k] = cur[k]; });
    S.edit(label, function (pp) { Object.keys(after).forEach(function (k) { pp[k] = after[k]; }); });
  }
  function dragLoop(ruler, rx, a) {
    var p = P(), z = ui.zoom, bpb = S.beatsPerBar(), before = JSON.stringify(p);
    var mv = function (ev) { var b = Math.max(0, Math.round((ev.clientX - rx) / z / bpb) * bpb); p.loop.start = Math.min(a, b); p.loop.end = Math.max(a, b) || a + bpb; p.loop.on = true; drawTimeline(); };
    var up = function () { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); if (p.loop.end - p.loop.start < bpb) p.loop.end = p.loop.start + bpb; restoreThenEdit(before, JSON.parse(JSON.stringify(p)), "Loop"); };
    window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
  }
  function pianoPointer(e, grid) {
    var c = curClip(); if (!c) return; e.preventDefault();
    var z = ui.prZoom, rowH = 14, r = grid.getBoundingClientRect(), snap = gridStep() || 0.25, p = P(), before = JSON.stringify(p);
    var x = e.clientX - r.left, y = e.clientY - r.top, pitch = ui.prTop - Math.floor(y / rowH), beat = x / z;
    var noteEl = e.target.closest("[data-note]"), resize = e.target.closest("[data-nres]"), idx, n;
    if (noteEl) { idx = Number(noteEl.dataset.note); n = c.notes[idx]; }
    else { if (beat >= c.len) return; n = { p: clamp(pitch, 0, 127), s: Math.floor(beat / snap) * snap, d: snap, v: Number(($("#stVel") || {}).value) || 100 }; c.notes.push(n); idx = c.notes.length - 1; audition(n.p); }
    ui.selNote = idx;
    var s0 = n.s, p0 = n.p, d0 = n.d, sx = e.clientX, sy = e.clientY, moved = !noteEl;
    var mv = function (ev) {
      var db = (ev.clientX - sx) / z, dp = -Math.round((ev.clientY - sy) / rowH);
      if (resize) n.d = Math.max(snap / 2, Math.round((d0 + db) / snap) * snap || snap);
      else { n.s = clamp(Math.round((s0 + db) / snap) * snap, 0, c.len - snap / 2); var np = clamp(p0 + dp, 0, 127); if (np !== n.p) { n.p = np; audition(np, 0.15); } }
      moved = true; var el = grid.querySelector('[data-note="' + idx + '"]'); if (el) { el.style.left = n.s * z + "px"; el.style.width = Math.max(3, n.d * z - 1) + "px"; el.style.top = (ui.prTop - n.p) * rowH + "px"; }
    };
    var up = function () { window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); if (moved) restoreThenEdit(before, JSON.parse(JSON.stringify(p)), noteEl ? (resize ? "Note length" : "Move note") : "Add note"); else $$("#stPrGrid .st-note").forEach(function (el) { el.classList.toggle("sel", Number(el.dataset.note) === idx); }); };   // (just picked: no redraw, so a double-click still lands on the same note)
    window.addEventListener("pointermove", mv); window.addEventListener("pointerup", up);
  }
  function velPointer(e, lane) {
    var c = curClip(); if (!c) return; var r = lane.getBoundingClientRect(), z = ui.prZoom, p = P(), before = JSON.stringify(p), touched = false;
    var set = function (ev) { var x = (ev.clientX - r.left) / z, v = clamp(Math.round((1 - (ev.clientY - r.top) / r.height) * 127), 1, 127); c.notes.forEach(function (n, i) { if (Math.abs(n.s - x) < Math.max(0.12, 6 / z)) { n.v = v; touched = true; var b = lane.querySelector('[data-vel="' + i + '"]'); if (b) b.style.height = Math.round(v / 127 * 100) + "%"; } }); };
    set(e); var up = function () { window.removeEventListener("pointermove", set); window.removeEventListener("pointerup", up); if (touched) restoreThenEdit(before, JSON.parse(JSON.stringify(p)), "Velocity"); };
    window.addEventListener("pointermove", set); window.addEventListener("pointerup", up);
  }
  // hear a note on the picked track (the piano roll's keys, drum names, new notes)
  function audition(n, dur) {
    var t = selTrack(); if (!t || t.kind === "audio") return; S.ctx();
    var c = curClip(), own = c && trackOfClip(c.id); if (own) t = own;
    S.live(t.id, [0x90, n, 100]); setTimeout(function () { S.live(t.id, [0x80, n, 0]); }, (dur || 0.3) * 1000);
  }

  // ------------------------------------------------------------- the keyboard: space, R, Ctrl+Z, computer keys
  var KEYMAP = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15 }, kbOct = 4, kbDown = {};
  function onKey(e) {
    if (!root.classList.contains("active")) return;
    if (e.target.matches && e.target.matches("input:not([type=range]):not([type=checkbox]), select, textarea")) return;
    var k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === "z") { e.preventDefault(); var r = e.shiftKey ? S.redo() : S.undo(); if (r) say((e.shiftKey ? "Redone: " : "Undone: ") + r); return; }
    if ((e.ctrlKey || e.metaKey) && k === "s") { e.preventDefault(); S.save().then(function () { say("Saved."); }); return; }
    if (ui.computerKeys && KEYMAP[k] != null && !e.repeat && !e.ctrlKey && !e.metaKey) { var t = selTrack(); if (t) { var n = (kbOct + 1) * 12 + KEYMAP[k]; kbDown[k] = n; S.live(t.id, [0x90, n, 100], performance.now()); } e.preventDefault(); return; }
    if (ui.computerKeys && (k === "z" || k === "x")) { kbOct = clamp(kbOct + (k === "x" ? 1 : -1), 0, 8); say("Computer keys: octave " + kbOct); return; }
    if (k === " ") { e.preventDefault(); var st = S.state(); if (st.playing) S.stop(); else S.play(); return; }
    if (k === "r" && !ui.computerKeys) { S.record(ui.view === "grid" && ui.slot ? { slot: ui.slot.slot, track: ui.slot.track } : {}); return; }
    if ((k === "delete" || k === "backspace") && ui.selNote != null && curClip()) { var i = ui.selNote; S.edit("Remove note", function () { curClip().notes.splice(i, 1); }); ui.selNote = null; return; }
    if ((k === "delete" || k === "backspace") && ui.view === "timeline" && ui.clip) { var cid = ui.clip; S.edit("Remove from timeline", function (p) { p.arrangement = p.arrangement.filter(function (it) { return it.clip !== cid; }); }); ui.clip = null; return; }
  }
  function onKeyUp(e) { var k = e.key.toLowerCase(); if (kbDown[k] != null) { var t = selTrack(); if (t) S.live(t.id, [0x80, kbDown[k], 0], performance.now()); delete kbDown[k]; } }

  // ------------------------------------------------------------- MIDI devices: keyboards to tracks, a Launchpad to the grid
  var lp = { off: { x: 0, y: 0 }, names: [] };
  function setupDevices() {
    lp.names = MIDI.inputs().filter(function (d) { return d.launchpad && devMode(d.name) === "grid" && activeDevices().indexOf(d.name) >= 0; }).map(function (d) { return d.name; });
    lp.names.forEach(function (n) { var L = MIDI.launchpad(n); L.programmer(); }); lightPads();
  }
  function lightPads() {
    if (!lp.names.length) return;
    var p = P(), gs = S.gridState();
    lp.names.forEach(function (n) {
      var L = MIDI.launchpad(n);
      for (var row = 0; row < 8; row++) for (var col = 0; col < 8; col++) {
        var t = p.tracks[col + lp.off.x], si = row + lp.off.y, note = (8 - row) * 10 + col + 1, g = t && gs[t.id] || {}, has = t && t.slots[si];
        if (!t || si >= p.scenes.length) { L.light(note, 0); continue; }
        if (g.recording === si) L.pulse(note, 5); else if (g.playing === si) L.pulse(note, 21); else if (g.queued === si) L.flash(note, 21); else if (has) L.light(note, 9); else L.light(note, t.arm ? 7 : 0);
      }
      for (var r = 0; r < 8; r++) L.lightCC((8 - r) * 10 + 9, r + lp.off.y < p.scenes.length ? 45 : 0);
    });
  }
  function onMidi(m) {
    var name = m.device.name, mode = devMode(name), act = activeDevices(), st = m.data[0];
    if (act.indexOf(name) < 0) return;
    if (st === 0xFA) { S.play(); return; } if (st === 0xFC) { S.stop(); return; }
    if (mode === "grid") {
      var p = P(), s = st & 0xF0, d1 = m.data[1], v = m.data[2] || 0;
      if (s === 0x90 && v > 0) { var row = 8 - Math.floor(d1 / 10), col = (d1 % 10) - 1; if (row >= 0 && row < 8 && col >= 0 && col < 8) { var t = p.tracks[col + lp.off.x], si = row + lp.off.y; if (!t || si >= p.scenes.length) return; if (t.slots[si]) S.launch(t.id, si); else if (t.arm) S.record({ slot: si, track: t.id }); else S.stopTrack(t.id); } }
      else if (s === 0xB0 && v > 0) { if (d1 % 10 === 9) { var sr = 8 - Math.floor(d1 / 10) + lp.off.y; if (sr < p.scenes.length) S.launchScene(sr); } else if (d1 === 91) lp.off.y = Math.max(0, lp.off.y - 1); else if (d1 === 92) lp.off.y++; else if (d1 === 93) lp.off.x = Math.max(0, lp.off.x - 1); else if (d1 === 94) lp.off.x++; lightPads(); }
      return;
    }
    var p2 = P(), targets = p2.tracks.filter(function (t) { return t.input === name && t.kind !== "audio"; });
    if (!targets.length) { if (mode.indexOf("track:") === 0) { var tt = S.track(mode.slice(6)); if (tt) targets = [tt]; } else { var sel = selTrack(); if (sel && sel.kind !== "audio" && (sel.input === "any" || !sel.input)) targets = [sel]; } }
    targets.forEach(function (t) { S.live(t.id, m.data, m.time); });
  }
  MIDI.on(onMidi);
  MIDI.onDevices(function () { setupDevices(); if (root.classList.contains("active") && (ui.tab === "devices" || ui.tab === "sound")) drawDetail(); });

  // ------------------------------------------------------------- the tab
  if (CU) CU.on("tab", function (t) {
    if (t !== "studio") return;
    build(); S.ctx(); SND.refresh(); MIDI.start().then(setupDevices); S.startMonitor();
    if (!ui.sel) ui.sel = (P().tracks[0] || {}).id;
    setTimeout(draw, 0);   // (the tab's view is made visible right after this event)
  });
  window.CUStudioUI = { draw: draw, ui: ui, audition: audition, devMode: devMode, activeDevices: activeDevices, setupDevices: setupDevices, lightPads: lightPads, lp: lp, posText: posText, parseNote: parseNote, noteName: noteName };
})();
