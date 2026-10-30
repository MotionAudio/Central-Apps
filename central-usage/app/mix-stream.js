/* Central Control - the Mix tab, under the channels: "Reverb & delay" (the two shared FX, and how much of each every
 * in-ear mix hears) and "Stream mix" (the live stream's own mix: its master, compressor, outputs, and where it goes -
 * an output pair, a virtual sound device for OBS / Zoom on this computer, live online with a still picture, the Video
 * tab's stream, the service recording). Its channel levels are on the faders with "Faders: Stream mix" (mix.js).
 * window.CUMixStream: render(el), update(), meters(m). */
(function () {
  "use strict";
  var CU = window.CentralUsage, M = window.CUMixer, X = window.CUMix, IE = window.CUInEar, OUT = window.CU && window.CU.streamOut; if (!CU || !M || !X) return;
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function dbs(v) { v = Number(v); return v <= -90 ? "off" : (v > 0 ? "+" : "") + v.toFixed(1) + " dB"; }
  function S() { return X.state; }
  var el = null, out = null, remoteOut = null, editing = false, timers = {};
  function send(key, op) { var t = timers[key]; if (t && Date.now() - t.at < 35) { clearTimeout(t.id); t.id = setTimeout(function () { t.at = Date.now(); X.op(op); }, 35); return; } timers[key] = { at: Date.now() }; X.op(op); }
  function local() { return X.kind === "local" && !!OUT; }
  if (OUT) { OUT.on(function (s) { out = s; paintOut(); }); }
  X.on("state", function () { if (local() && !out) OUT.call({}).then(function (s) { out = s; paintOut(); }).catch(function () { }); });

  // ------------------------------------------------------------------ Windows / macOS: the stream mix into VB-CABLE / BlackHole
  var cable = { player: null, sinkId: "", label: "", want: CU.store.get("streamCable", false), found: null };
  var CABLE_RE = /cable input|vb-audio|blackhole|loopback audio|soundflower/i;
  function findCable() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return Promise.resolve(null);
    return navigator.mediaDevices.enumerateDevices().then(function (list) { var d = list.find(function (x) { return x.kind === "audiooutput" && CABLE_RE.test(x.label || ""); }); cable.found = d ? { id: d.deviceId, label: d.label } : null; return cable.found; }).catch(function () { return null; });
  }
  async function cableOn(on) {
    cable.want = !!on; CU.store.set("streamCable", cable.want);
    if (!on) { if (cable.player) { X.listen("stream", false); cable.player.stop(); cable.player = null; } paintOut(); return; }
    var d = await findCable(); if (!d || cable.player) { paintOut(); return; }
    cable.player = IE.player({ latency: 60, sinkId: d.id }); await cable.player.start(); cable.label = d.label;
    X.listen("stream", true); paintOut();
  }
  X.on("audio", function (pcm, frames, ch, rate, tap) { if (cable.player && tap === M.MAXMIX + 1) cable.player.push(pcm, frames, ch, rate); });

  // ------------------------------------------------------------------ reverb & delay
  function sl(label, key, min, max, step, v, fmt) { return '<label class="mx-sl"><span>' + label + '</span><input type="range" min="' + min + '" max="' + max + '" step="' + step + '" data-fxk="' + key + '" value="' + v + '"><output>' + fmt(v) + "</output></label>"; }
  var F = { s: function (v) { return Number(v).toFixed(1) + " s"; }, ms: function (v) { return Math.round(v) + " ms"; }, pct: function (v) { return Math.round(v * 100) + " %"; }, hz: function (v) { return v >= 1000 ? (v / 1000).toFixed(1) + " kHz" : Math.round(v) + " Hz"; }, db: dbs };
  var NOTES = [["1/4", "Quarter"], ["1/8d", "Dotted eighth"], ["1/8", "Eighth"], ["1/4d", "Dotted quarter"], ["1/4t", "Quarter triplet"], ["1/8t", "Eighth triplet"], ["1/16", "Sixteenth"], ["1/2", "Half"], ["ms", "Free (ms)"]];
  function fxCard() {
    var r = S().fx.rev, d = S().fx.dly, ms = M.delayMs(d), synced = d.sync !== "ms";
    var used = S().mixes.map(function (q, m) { return { q: q, m: m }; }).filter(function (o) { return o.q.ownerId || o.q.wired || Object.keys(o.q.sends).length || o.q.rRev > -90 || o.q.rDly > -90; });
    return '<section class="card mx-fxcard"><div class="mx-fxhead"><h3>Reverb &amp; delay</h3><span class="muted small">Shared by every channel, like on a sound desk. Turn up FX on a channel\'s strip to send it here; the effect comes back into the main mix, the stream mix and any in-ear mix that asks for it.</span></div>' +
      '<div class="mx-dgrid"><div class="mx-dcol"><h4><label class="toggle"><input type="checkbox" data-fxk="rev.on"' + (r.on ? " checked" : "") + '> Reverb</label> <i class="mx-fxm" data-fxm="0"></i></h4>' +
      sl("Decay", "rev.decay", 0.2, 12, 0.1, r.decay, F.s) + sl("Pre-delay", "rev.pre", 0, 200, 1, r.pre, F.ms) + sl("Darker", "rev.damp", 0, 1, 0.01, r.damp, F.pct) + sl("Low cut", "rev.lowcut", 20, 1000, 5, r.lowcut, F.hz) + sl("Width", "rev.width", 0, 1, 0.01, r.width, F.pct) + sl("Return (main)", "rev.ret", -90, 10, 0.5, r.ret, F.db) +
      '<div class="row mx-fxpre"><span class="muted small">Quick:</span><button data-fxq="room">Room</button><button data-fxq="hall">Hall</button><button data-fxq="plate">Plate</button><button data-fxq="worship">Big worship</button></div></div>' +
      '<div class="mx-dcol"><h4><label class="toggle"><input type="checkbox" data-fxk="dly.on"' + (d.on ? " checked" : "") + '> Delay</label> <i class="mx-fxm" data-fxm="1"></i></h4>' +
      '<label class="mx-sl"><span>Time</span><select data-fxk="dly.sync">' + NOTES.map(function (n) { return '<option value="' + n[0] + '"' + (d.sync === n[0] ? " selected" : "") + ">" + n[1] + "</option>"; }).join("") + '</select><output data-fxo="time">' + Math.round(ms) + " ms</output></label>" +
      (synced ? '<p class="muted small mx-tempo">' + (d.bpm ? "From the song: " + Math.round(d.bpm * 10) / 10 + " BPM" : "Follows the song's tempo once the Central Pedal plays one.") + "</p>" : sl("Time", "dly.ms", 1, 2900, 1, d.ms, F.ms)) +
      sl("Repeats", "dly.fb", 0, 0.95, 0.01, d.fb, F.pct) + sl("High cut", "dly.hicut", 500, 20000, 100, d.hicut, F.hz) + sl("Low cut", "dly.lowcut", 20, 1000, 5, d.lowcut, F.hz) +
      '<label class="toggle"><input type="checkbox" data-fxk="dly.ping"' + (d.ping ? " checked" : "") + "> Ping-pong (left, right, left…)</label>" + sl("Return (main)", "dly.ret", -90, 10, 0.5, d.ret, F.db) + "</div>" +
      '<div class="mx-dcol"><h4>In the in-ears</h4>' + (used.length ? '<div class="mx-iefx"><span></span><b>Reverb</b><b>Delay</b>' + used.map(function (o) { return '<span title="' + esc(o.q.name) + '">' + (o.m + 1) + " · " + esc(o.q.owner || o.q.name) + '</span><label><input type="range" min="-90" max="10" step="0.5" data-iefx="rRev" data-m="' + o.m + '" value="' + (o.q.rRev == null ? -90 : o.q.rRev) + '"><output>' + dbs(o.q.rRev == null ? -90 : o.q.rRev) + '</output></label><label><input type="range" min="-90" max="10" step="0.5" data-iefx="rDly" data-m="' + o.m + '" value="' + (o.q.rDly == null ? -90 : o.q.rDly) + '"><output>' + dbs(o.q.rDly == null ? -90 : o.q.rDly) + "</output></label>"; }).join("") + "</div>" : '<p class="muted small">No in-ear mixes in use yet.</p>') +
      '<p class="muted small">Singers often like a little reverb in their own ears; leave the click and the tracks dry.</p></div></div></section>';
  }
  var QUICK = { room: { decay: 0.9, pre: 8, damp: 0.55, lowcut: 200, width: 0.8 }, hall: { decay: 2.4, pre: 25, damp: 0.45, lowcut: 150, width: 1 }, plate: { decay: 1.6, pre: 0, damp: 0.25, lowcut: 180, width: 1 }, worship: { decay: 4.2, pre: 35, damp: 0.4, lowcut: 160, width: 1 } };

  // ------------------------------------------------------------------ the stream mix
  function outOptions(cur) { var st = X.kind === "local" ? (X.hostStatus && X.hostStatus.engine && X.hostStatus.engine.status) : (X.info && X.info.status), names = (st && st.playbackNames) || [], h = '<option value="-1"' + (cur < 0 ? " selected" : "") + ">—</option>"; for (var o = 0; o < Math.max(names.length, cur + 1); o++) h += '<option value="' + o + '"' + (o === cur ? " selected" : "") + ">Out " + (o + 1) + (names[o] ? " · " + esc(names[o].replace(/^.*:/, "")) : "") + "</option>"; return h; }
  function streamCard() {
    var q = S().stream, c = q.comp, n = Object.keys(q.sends).length;
    return '<section class="card mx-stream"><div class="mx-fxhead"><h3>Stream mix <span class="mx-onair" hidden>● ON AIR</span></h3><span class="muted small">A separate mix just for the live stream. Changing it doesn\'t change what the room hears. ' + (n ? n + " channel" + (n === 1 ? "" : "s") + " in it." : "Nothing in it yet.") + "</span>" +
      '<span class="row"><button data-sm="copy" title="Every channel\'s fader, pan and mute from the main mix">Start from the main mix</button><button data-sm="faders" class="' + (CU.store.get("mxLayer", "main") === "stream" ? "on" : "") + '">Levels on the faders</button></span></div>' +
      '<div class="mx-dgrid"><div class="mx-dcol"><h4>Master</h4><div class="mx-smeter"><i data-smm="0"></i><i data-smm="1"></i></div>' +
      sl("Level", "st.level", -90, 10, 0.5, q.level, F.db) + '<label class="toggle"><input type="checkbox" data-smk="mute"' + (q.mute ? " checked" : "") + "> Muted</label>" +
      sl("Reverb", "st.rRev", -90, 10, 0.5, q.rRev, F.db) + sl("Delay", "st.rDly", -90, 10, 0.5, q.rDly, F.db) +
      '<div class="row"><label>L <select data-smk="outL">' + outOptions(q.outL) + '</select></label><label>R <select data-smk="outR">' + outOptions(q.outR) + '</select></label></div><p class="muted small">An output pair of the interface: to a streaming computer, a video switcher or a recorder.</p></div>' +
      '<div class="mx-dcol"><h4><label class="toggle"><input type="checkbox" data-smk="comp.on"' + (c.on ? " checked" : "") + '> Compressor</label> <small class="muted">holds the stream level steady</small></h4><div class="mx-gr mx-sgr"><i></i><span>gain reduction</span></div>' +
      sl("Threshold", "st.comp.thr", -60, 0, 0.5, c.thr, F.db) + sl("Ratio", "st.comp.ratio", 1, 20, 0.5, c.ratio, function (v) { return Number(v).toFixed(1) + ":1"; }) + sl("Attack", "st.comp.att", 0.1, 200, 0.1, c.att, function (v) { return Number(v).toFixed(1) + " ms"; }) + sl("Release", "st.comp.rel", 5, 2000, 5, c.rel, F.ms) + sl("Make-up", "st.comp.makeup", 0, 24, 0.5, c.makeup, F.db) +
      '<p class="muted small">A limiter after it stops the stream from ever getting too loud and distorting.</p><label class="toggle"><input type="checkbox" data-smk="record"' + (q.record !== false ? " checked" : "") + "> Record it with the service (Stream mix.wav and .mp3)</label></div>" +
      '<div class="mx-dcol mx-where" id="mxWhere">' + whereHtml() + "</div></div></section>";
  }
  function chip(st) { var t = { live: "● live", connecting: "connecting…", reconnecting: "reconnecting…", error: "✕", off: "off", starting: "starting…" }[st] || st; return '<span class="mx-chip ' + esc(st) + '">' + esc(t) + "</span>"; }
  function whereHtml() {
    if (!local()) {
      var r = remoteOut;
      return "<h4>Where it goes</h4>" + (r ? (r.virtual ? "<p>Virtual device on the audio host: on</p>" : "") + (r.destinations || []).map(function (d) { return "<p>" + esc(d.label) + " " + chip(d.status) + "</p>"; }).join("") : "") +
        '<p class="muted small">Going live, the virtual microphone and the stream keys are set up on the audio host computer. If this computer has the cameras: Video tab → Audio → <b>Stream mix</b>.</p>';
    }
    var o = out || { virtual: {}, destinations: [], kinds: {} }, v = o.virtual || {}, plat = o.platform || (navigator.platform || "").toLowerCase();
    var linux = plat === "linux" || /linux/i.test(plat);
    var vhtml = linux
      ? '<label class="toggle"><input type="checkbox" data-sm="virtual"' + (v.on ? " checked" : "") + "> <b>Virtual device</b> “Central Control Stream”</label>" + (v.state === "on" ? '<p class="muted small">✓ OBS, Zoom or a browser on this computer can pick “Central Control Stream” as a microphone.</p>' : v.error ? '<p class="warn small">' + esc(v.error) + "</p>" : '<p class="muted small">A microphone called “Central Control Stream” for OBS, Zoom or a browser on this computer.</p>')
      : '<label class="toggle"><input type="checkbox" data-sm="cable"' + (cable.want ? " checked" : "") + "> <b>Into a virtual cable</b></label>" + (cable.player ? '<p class="muted small">✓ Playing into “' + esc(cable.label) + '”: in OBS / Zoom pick its other end as the microphone.</p>' : cable.want && cable.found === null ? '<p class="warn small">No virtual cable found. Install the free <a href="https://vb-audio.com/Cable/" target="_blank" rel="noopener">VB-CABLE</a> (Windows) or <a href="https://existential.audio/blackhole/" target="_blank" rel="noopener">BlackHole</a> (Mac), then tick this again.</p>' : '<p class="muted small">Windows / Mac need a free virtual cable (VB-CABLE, BlackHole) for other apps to hear the stream mix.</p>');
    var kinds = o.kinds || { youtube: "YouTube", facebook: "Facebook", rtmp: "RTMP / RTMPS" };
    var dests = (o.destinations || []).map(function (d) {
      return '<div class="mx-dest" data-did="' + esc(d.id) + '"><select data-dk="kind">' + Object.keys(kinds).filter(function (k) { return k !== "file" || d.kind === "file"; }).map(function (k) { return '<option value="' + k + '"' + (d.kind === k ? " selected" : "") + ">" + esc(kinds[k]) + "</option>"; }).join("") + "</select>" +
        (d.kind === "rtmp" || d.kind === "file" ? '<input data-dk="url" placeholder="rtmp://server/app" value="' + esc(d.url) + '">' : "") +
        '<input data-dk="key" type="password" autocomplete="off" placeholder="' + (d.hasKey ? "stream key saved - type to change" : "stream key") + '">' +
        '<button data-dk="live" class="' + (d.on ? "danger on" : "primary") + '">' + (d.on ? "Stop" : "Go live") + "</button>" + chip(d.status) + '<button data-dk="del" title="Remove" class="mini">✕</button>' + (d.error && d.status !== "live" ? '<span class="warn small">' + esc(d.error) + "</span>" : "") + "</div>";
    }).join("");
    return "<h4>Where it goes</h4>" + vhtml +
      '<h4 class="mx-h4">Live online <small class="muted">sound with a still picture</small></h4>' + (o.ffmpeg === false ? '<p class="warn small">ffmpeg is missing from this installation.</p>' : "") + dests +
      '<div class="row"><button data-sm="addDest">+ Destination</button>' + ((o.destinations || []).length > 1 ? '<button data-sm="liveAll">Go live everywhere</button>' : "") + '<button data-sm="picture">' + (o.picture ? "Picture: " + esc(String(o.picture).split(/[\\/]/).pop()) : "Choose a picture (your logo)…") + "</button>" + (o.picture ? '<button data-sm="noPicture" class="mini">✕</button>' : "") + "</div>" +
      '<p class="muted small">With cameras, use the Video tab instead: Video → Audio → <b>Stream mix</b> puts this mix on its stream (on this computer or another).</p>';
  }
  function paintOut() {
    var w = $("#mxWhere"); if (w && !w.contains(document.activeElement)) w.innerHTML = whereHtml();
    var live = local() ? !!(out && out.live) : !!(remoteOut && remoteOut.live);
    var oa = $(".mx-onair"); if (oa) oa.hidden = !live;
  }

  // ------------------------------------------------------------------ the page
  function render(target) {
    el = target || el; if (!el || !S()) return;
    if (!S().fx || !S().stream) { el.innerHTML = ""; return; }
    el.innerHTML = fxCard() + streamCard(); paintOut();
    if (local() && !out) OUT.call({}).then(function (s) { out = s; paintOut(); }).catch(function () { });
    if (!local() || !(out && out.platform === "linux")) findCable().then(function () { if (cable.want && !cable.player) cableOn(true); else paintOut(); });
  }
  function update() {
    if (!el || !S() || el.contains(document.activeElement) && document.activeElement.type !== "checkbox" || editing) return;
    render();
  }
  function bar(v) { var d = v > 0 ? 20 * Math.log10(v) : -90; return Math.max(0, Math.min(100, (d + 60) / 60 * 100)); }
  function meters(m) {
    if (!el) return;
    if (m.stream) document.querySelectorAll("[data-smm]").forEach(function (i) { i.style.width = bar(m.stream[Number(i.dataset.smm)] || 0) + "%"; });
    var g = $(".mx-sgr i"); if (g && m.streamGr != null) g.style.width = Math.min(100, m.streamGr / 20 * 100) + "%";
    if (m.fx) document.querySelectorAll("[data-fxm]").forEach(function (i) { i.style.setProperty("--v", bar(m.fx[Number(i.dataset.fxm)] || 0) + "%"); });
    if (m.extra && m.extra.streamOut && !local()) { var was = JSON.stringify(remoteOut); remoteOut = m.extra.streamOut; if (was !== JSON.stringify(remoteOut)) paintOut(); }
  }

  // ------------------------------------------------------------------ events
  document.addEventListener("pointerdown", function (e) { if (el && el.contains(e.target) && e.target.type === "range") editing = true; });
  document.addEventListener("pointerup", function () { if (editing) { editing = false; } });
  document.addEventListener("input", function (e) {
    var t = e.target; if (!el || !el.contains(t) || t.type !== "range") return;
    var v = Number(t.value), o = t.parentNode.querySelector("output"), k = t.dataset.fxk;
    if (k) {
      var p = k.split("."), patch = {};
      if (p[0] === "st") { if (p[1] === "comp") { patch.comp = {}; patch.comp[p[2]] = v; } else patch[p[1]] = v; send("st" + k, { op: "stream", patch: patch }); }
      else { patch[p[0]] = {}; patch[p[0]][p[1]] = v; send("fx" + k, { op: "fx", patch: patch }); if (k === "dly.ms") { var to = $('[data-fxo="time"]'); if (to) to.textContent = Math.round(v) + " ms"; } }
      if (o) o.textContent = /decay/.test(k) ? F.s(v) : /pre$|\.ms$|att|rel/.test(k) ? (v < 10 ? v.toFixed(1) : Math.round(v)) + " ms" : /damp|width|fb/.test(k) ? F.pct(v) : /cut/.test(k) ? F.hz(v) : /ratio/.test(k) ? v.toFixed(1) + ":1" : dbs(v);
      return;
    }
    if (t.dataset.iefx) { var mp = {}; mp[t.dataset.iefx] = v; send("ie" + t.dataset.m + t.dataset.iefx, { op: "mix", m: Number(t.dataset.m), patch: mp }); if (o) o.textContent = dbs(v); }
  });
  document.addEventListener("change", function (e) {
    var t = e.target; if (!el || !el.contains(t)) return;
    var k = t.dataset.fxk;
    if (k && t.type === "checkbox") { var p = k.split("."), patch = {}; patch[p[0]] = {}; patch[p[0]][p[1]] = t.checked; X.op({ op: "fx", patch: patch }); return; }
    if (k === "dly.sync") { X.op({ op: "fx", patch: { dly: { sync: t.value } } }); setTimeout(render, 50); return; }
    var sk = t.dataset.smk;
    if (sk === "mute" || sk === "record") { var sp = {}; sp[sk] = t.checked; X.op({ op: "stream", patch: sp }); return; }
    if (sk === "comp.on") { X.op({ op: "stream", patch: { comp: { on: t.checked } } }); return; }
    if (sk === "outL" || sk === "outR") { var po = {}; po[sk] = Number(t.value); if (sk === "outL" && S().stream.outR < 0 && Number(t.value) >= 0) po.outR = Number(t.value) + 1; X.op({ op: "stream", patch: po }); return; }
    if (t.dataset.sm === "virtual" && OUT) { OUT.call({ action: "virtual", on: t.checked }).then(function (s) { out = s; paintOut(); }); return; }
    if (t.dataset.sm === "cable") { cableOn(t.checked); return; }
    var row = t.closest(".mx-dest");
    if (row && OUT && out) {
      var id = row.dataset.did, list = out.destinations.map(function (d) { return { id: d.id, kind: d.kind, url: d.url }; }), cur = list.find(function (d) { return d.id === id; });
      if (!cur) return;
      if (t.dataset.dk === "kind") cur.kind = t.value; else if (t.dataset.dk === "url") cur.url = t.value.trim(); else if (t.dataset.dk === "key") { cur.key = t.value.trim(); t.value = ""; }
      OUT.call({ action: "config", patch: { destinations: list } }).then(function (s) { out = s; paintOut(); });
    }
  });
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("button"); if (!b || !el || !el.contains(b)) return;
    if (b.dataset.fxq) { X.op({ op: "fx", patch: { rev: Object.assign({ on: true }, QUICK[b.dataset.fxq]) } }); setTimeout(render, 50); return; }
    if (b.dataset.sm === "copy") { if (!Object.keys(S().stream.sends).length || confirm("Replace the stream mix's levels with the main mix's?")) X.op({ op: "streamCopy" }); return; }
    if (b.dataset.sm === "faders") { var on = CU.store.get("mxLayer", "main") !== "stream"; var lb = document.querySelector('[data-mx-layer="' + (on ? "stream" : "main") + '"]'); if (lb) lb.click(); return; }
    if (!OUT || !out) return;
    if (b.dataset.sm === "addDest") { var list = out.destinations.map(function (d) { return { id: d.id, kind: d.kind, url: d.url }; }); list.push({ kind: "youtube" }); OUT.call({ action: "config", patch: { destinations: list } }).then(function (s) { out = s; paintOut(); }); return; }
    if (b.dataset.sm === "liveAll") { var any = out.destinations.some(function (d) { return d.on; }); OUT.call({ action: "live", id: "all", on: !any }).then(function (s) { out = s; paintOut(); }); return; }
    if (b.dataset.sm === "picture" || b.dataset.sm === "noPicture") { OUT.call(b.dataset.sm === "picture" ? { action: "picture" } : { action: "config", patch: { picture: "" } }).then(function (s) { out = s; paintOut(); }); return; }
    var row = b.closest(".mx-dest"); if (!row) return; var id = row.dataset.did, d = out.destinations.find(function (x) { return x.id === id; }); if (!d) return;
    if (b.dataset.dk === "live") { OUT.call({ action: "live", id: id, on: !d.on }).then(function (s) { out = s; paintOut(); }); return; }
    if (b.dataset.dk === "del") { if (d.on && !confirm("This destination is live. Stop it and remove it?")) return; OUT.call({ action: "live", id: id, on: false }).then(function () { return OUT.call({ action: "config", patch: { destinations: out.destinations.filter(function (x) { return x.id !== id; }).map(function (x) { return { id: x.id, kind: x.kind, url: x.url }; }) } }); }).then(function (s) { out = s; paintOut(); }); }
  });
  window.CUMixStream = { render: render, update: update, meters: meters, cable: function () { return cable; } };
})();
