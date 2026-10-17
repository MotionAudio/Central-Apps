/* Central Usage - the I/O tab: every input and output of this computer in one place.
 *   The Central Control (connection, pairing) · its audio (Ethernet / Wi-Fi / the audio interface)
 *   The audio host (this computer or another) · the audio interface (device, buffer, what each input and
 *   output carries) · listening & recording · video outputs · lights (DMX, MIDI) · MIDI devices */
(function () {
  "use strict";
  var CU = window.CentralUsage, X = window.CUMix, NAT = window.CU; if (!CU) return;
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var hs = null, midiNames = null;
  function visible() { return CU.prefs.tab === "io"; }
  function cfg() { return (hs && hs.cfg) || CU.config() || {}; }
  function radio(name, v, cur, label, sub, dis) { return '<label class="io-opt' + (v === cur ? " on" : "") + (dis ? " dis" : "") + '"><input type="radio" name="' + name + '" value="' + v + '"' + (v === cur ? " checked" : "") + (dis ? " disabled" : "") + "><span><b>" + label + "</b>" + (sub ? "<small>" + sub + "</small>" : "") + "</span></label>"; }
  function piCard() {
    var s = CU.state, ifs = s.interfaces || [];
    return '<section class="card io-c"><h3>Central Control</h3><table class="io-t"><tr><td>Connection</td><td>' + (s.connected ? "connected to <b>" + esc(s.hostname || CU.prefs.host) + "</b>" + (s.appVersion ? " · Central Control " + esc(s.appVersion) : "") : '<span class="muted">not connected - type its address (top right) or Find</span>') + "</td></tr>" +
      "<tr><td>Pairing code</td><td>" + (s.authed ? "✓ accepted" : CU.prefs.code ? "checking…" : '<button data-io="code">Enter the code</button> <span class="muted small">(Central Control → Settings)</span>') + "</td></tr>" +
      "<tr><td>Its network</td><td>" + (ifs.length ? ifs.map(function (i) { return (i.kind === "ethernet" ? "Ethernet" : i.kind === "wifi" ? "Wi-Fi" : esc(i.iface)) + " <b>" + esc(i.address) + "</b>"; }).join(" · ") : '<span class="muted">-</span>') + "</td></tr></table></section>";
  }
  function piAudioCard() {
    var c = cfg(), host = CU.mode() === "admin" && c.host && c.host.enabled, t = (c.piAudio || {}).transport || "off", pi = hs && hs.pi || {}, m = X && X.meters, net = m && m.net && m.net[0], piMode = CU.state.netAudio && CU.state.netAudio.mode;
    var ifs = CU.state.interfaces || [], hasEth = ifs.some(function (i) { return i.kind === "ethernet"; }), hasWifi = ifs.some(function (i) { return i.kind === "wifi"; });
    var warn = host && (t === "ethernet" || t === "wifi") && piMode && piMode !== t ? '<p class="warn">The Central Control is set to "' + esc(piMode) + '" - set its I/O tab → Audio to Central Usage to ' + (t === "ethernet" ? "Ethernet" : "Wi-Fi") + ".</p>" : "";
    if (CU.mode() !== "admin") return "";
    if (!host) return '<section class="card io-c"><h3>Audio from the Central Control</h3><p class="muted">Only the audio host gets the Central Control\'s tracks (it mixes them and makes the in-ear mixes). ' + (X && X.hostAddress() ? "The audio host is <b>" + esc(X.hostAddress()) + "</b>." : "No audio host yet - turn it on below on the computer at the sound desk.") + "</p></section>";
    return '<section class="card io-c wide"><h3>Audio from the Central Control</h3><div class="io-opts">' +
      radio("ioPi", "off", t, "Off", "no tracks here") + radio("ioPi", "ethernet", t, "Ethernet", hasEth || !CU.state.connected ? "a cable - the best" : "the Central Control has no Ethernet now") + radio("ioPi", "wifi", t, "Wi-Fi", hasWifi || !CU.state.connected ? "anywhere on the Wi-Fi, a little more delay" : "the Central Control has no Wi-Fi now") + radio("ioPi", "interface", t, "Audio interface", "its outputs cabled into this computer's interface") + "</div>" + warn +
      (t === "ethernet" || t === "wifi" ? '<div class="row"><label>Buffer <input type="range" min="20" max="300" step="10" data-io="latency" value="' + ((c.piAudio || {}).latency || 60) + '"><output>' + ((c.piAudio || {}).latency || 60) + ' ms</output></label><span class="muted small">smaller = less delay; raise it if you hear gaps</span></div>' +
        '<table class="io-t"><tr><td>Status</td><td data-io-live="pi">' + piStatus() + "</td></tr>" + "<tr><td>Channels</td><td>" + (X && X.pi.length ? X.pi.map(function (n) { return esc(n.name); }).join(" · ") : '<span class="muted">none yet - they arrive when the Central Control has a song loaded</span>') + "</td></tr></table>" : "") +
      (t === "interface" ? '<p class="muted">Pick the interface\'s inputs on the In-ears tab (Channels: source "Input n") and set them to "Tracks" to mix them on the Mix tab.</p>' : "") + "</section>";
  }
  function piStatus() {   // the live line (updated in place every 2 s, so the controls around it stay put)
    var pi = hs && hs.pi || {}, m = X && X.meters, net = m && m.net && m.net[0];
    return esc(pi.state || "off") + (pi.error ? ' <span class="warn">' + esc(pi.error) + "</span>" : "") + (pi.state === "receiving" ? " · " + pi.kbps + " kbit/s" + (pi.lost ? " · " + pi.lost + " lost" : "") + (net ? " · buffer " + Math.round(net.ms) + " ms" + (net.under ? " · " + net.under + " gaps" : "") : "") : "") + (pi.address ? ' <span class="muted small">from ' + esc(pi.address) + "</span>" : "");
  }
  function hostCard() {
    var c = cfg(), admin = (CU.isAdmin ? CU.isAdmin() : CU.mode() === "admin" || CU.mode() === "main"), host = admin && c.host && c.host.enabled, srv = hs && hs.server || {};
    if (!admin) return '<section class="card io-c"><h3>Audio host (in-ears)</h3><table class="io-t"><tr><td>Audio host</td><td>' + (X && X.hostAddress() ? "<b>" + esc(X.hostAddress()) + "</b>" : '<span class="muted">not found yet</span>') + '</td></tr><tr><td>Address</td><td><input data-io="hostAddr" value="' + esc(CU.store.get("hostAddr", "")) + '" placeholder="automatic (through the Central Control)"></td></tr><tr><td>In-ear code</td><td><input data-io="userCode" value="' + esc(CU.store.get("userCode", "")) + '" placeholder="from the sound desk" style="width:110px"></td></tr></table></section>';
    return '<section class="card io-c"><h3>Audio host</h3><label class="toggle io-big"><input type="checkbox" data-io="host"' + (host ? " checked" : "") + (NAT && NAT.mixer ? "" : " disabled") + "> This computer is the audio host</label>" +
      '<p class="muted small">The audio host gets the tracks, runs the mixer and makes up to 64 stereo in-ear mixes (wired to transmitters and / or over the network). One per church; other admins mix from their own computer, users pick their mix.</p>' +
      (host ? '<table class="io-t"><tr><td>Server</td><td>' + (srv.running ? "port " + srv.port + " · " + (srv.addresses || []).map(esc).join(", ") : '<span class="warn">' + esc(srv.error || "starting…") + "</span>") + "</td></tr>" +
        '<tr><td>In-ear code</td><td><b class="io-code">' + esc(c.host.userCode) + '</b> <button data-io="newUser">New</button></td></tr><tr><td>Admin code</td><td><b class="io-code">' + esc(c.host.adminCode) + '</b> <button data-io="newAdmin">New</button></td></tr>' +
        "<tr><td>Connected</td><td>" + ((srv.clients || []).length ? srv.clients.map(function (k) { return esc(k.name) + " <small>(" + k.role + (k.mix != null ? " · mix " + (k.mix + 1) : "") + ")</small>"; }).join(", ") : '<span class="muted">nobody</span>') + "</td></tr></table>"
        : '<table class="io-t"><tr><td>Audio host</td><td>' + (X && X.hostAddress() ? "<b>" + esc(X.hostAddress()) + "</b>" : '<span class="muted">not found</span>') + '</td></tr><tr><td>Address</td><td><input data-io="hostAddr" value="' + esc(CU.store.get("hostAddr", "")) + '" placeholder="automatic"></td></tr><tr><td>Admin code</td><td><input data-io="adminCode" value="' + esc(CU.store.get("adminCode", "")) + '" placeholder="shown on the audio host" style="width:110px"> <span class="muted small">' + esc(X && X.error || (X && X.connected() ? "✓ connected" : "")) + "</span></td></tr></table>") + "</section>";
  }
  function clients(names) { var out = []; (names || []).forEach(function (n) { var c = n.split(":")[0]; if (out.indexOf(c) < 0) out.push(c); }); return out; }
  var PLAT = /Windows/.test(navigator.userAgent) ? "win" : /Mac OS X|Macintosh/.test(navigator.userAgent) ? "mac" : "linux";
  function devList(spec) { return String(spec || "").split("|").map(function (x) { return x.trim(); }).filter(Boolean); }
  function backendLabel(st) {
    if (st.backend === "jack") return "PipeWire / JACK";
    if (st.backend === "miniaudio") return st.api === "WASAPI" ? "Windows audio (WASAPI)" : st.api === "Core Audio" ? "Core Audio" : st.api || "system audio";
    if (st.backend === "null") return "test devices";
    return "its own clock - no interface (network in-ears and recording still work)";
  }
  function ifaceCard() {
    var c = cfg(); if (!(CU.isAdmin ? CU.isAdmin() : CU.mode() === "admin" || CU.mode() === "main") || !(c.host && c.host.enabled)) return "";
    var e = hs && hs.engine || {}, st = e.status || {}, d = (X && X.state && X.state.device) || c.device || {};
    // every device this computer has (with its channels), and the ones in use, in order (the first is the clock)
    var avail = function (dir) {
      var a = dir === "capture" ? st.availableCapture : st.availablePlayback;
      if (a && a.length) return a;
      return clients(dir === "capture" ? st.allCapture : st.allPlayback).map(function (n) { var k = (dir === "capture" ? st.allCapture : st.allPlayback).filter(function (x) { return x.split(":")[0] === n; }).length; return { name: n, channels: k, dante: /dante/i.test(n) }; });
    };
    var inUse = function (dir) { return (dir === "capture" ? st.captureDevices : st.playbackDevices) || []; };
    var devCol = function (dir, label) {
      var chosen = devList(d[dir]), av = avail(dir), used = inUse(dir), total = dir === "capture" ? st.inputs : st.outputs;
      var rows = chosen.length ? chosen.map(function (n, k) {
        var u = used.filter(function (x) { return x.name.toLowerCase().indexOf(n.replace(/#\d+$/, "").toLowerCase()) >= 0; })[0];
        return '<div class="io-dev"><b>' + esc(n) + "</b>" + (/dante/i.test(n) ? ' <span class="io-tag">Dante</span>' : "") + (k === 0 ? ' <span class="io-tag" title="The other devices follow this one\'s clock (drift corrected)">clock</span>' : "") +
          '<span class="muted small">' + (u ? (u.open ? u.channels + " ch · " + (dir === "capture" ? "in " : "out ") + (u.first + 1) + "–" + (u.first + u.channels) : "could not open") : "") + '</span>' +
          (k > 0 ? '<button class="mini" data-io-devup="' + dir + ":" + k + '" title="Make it the clock">↑</button>' : "") + '<button class="mini" data-io-devdel="' + dir + ":" + k + '">✕</button></div>';
      }).join("") : '<div class="io-dev muted">' + (st.backend === "jack" ? "Every physical " + (dir === "capture" ? "input" : "output") : "This computer's default device") + "</div>";
      var addable = av.filter(function (x) { return chosen.indexOf(x.name) < 0; });
      return '<div><h4>' + label + ' <small class="muted">' + (total || 0) + " channels</small></h4>" + rows +
        (addable.length ? '<select data-io-devadd="' + dir + '"><option value="">+ Add a device…</option>' + addable.map(function (x) { return '<option value="' + esc(x.name) + '">' + esc(x.name) + (x.channels ? " · " + x.channels + " ch" : "") + (x.dante ? " (Dante)" : "") + "</option>"; }).join("") + "</select>" : "") + "</div>";
    };
    var anyDante = avail("capture").concat(avail("playback")).some(function (x) { return x.dante; }) || /dante/i.test((d.capture || "") + (d.playback || ""));
    var S = X && X.state, used = {}, outs = {};
    if (S) {
      S.inputs.forEach(function (x, i) { if (x.src.kind === "in") (used[x.src.ch] = used[x.src.ch] || []).push(x.name || "Input " + (i + 1)); });
      var add = function (o, what) { if (o >= 0) (outs[o] = outs[o] || []).push(what); };
      if (S.trackOut !== "direct") { add(S.main.outL, "Tracks L"); add(S.main.outR, "Tracks R"); }
      S.inputs.forEach(function (x, i) { if (x.direct >= 0) add(x.direct, (x.name || "Input " + (i + 1)) + " (direct)"); });
      S.mixes.forEach(function (q, m) { if (q.wired) { add(q.outL, "Mix " + (m + 1) + (q.stereo ? " L" : "")); if (q.stereo) add(q.outR, "Mix " + (m + 1) + " R"); } });
    }
    var engines = PLAT === "linux" ? [["auto", "Audio interface (PipeWire / JACK)"], ["miniaudio", "Audio interface (ALSA / PulseAudio)"], ["internal", "No interface (network only)"]]
      : [["auto", PLAT === "win" ? "Audio interface / Dante (Windows audio)" : "Audio interface / Dante (Core Audio)"], ["internal", "No interface (network only)"]];
    var under = e.meters && e.meters.deviceUnder;
    return '<section class="card io-c wide"><h3>Audio interface / Dante</h3><table class="io-t"><tr><td>Engine</td><td>' + (e.running && st.backend ? "running on " + esc(backendLabel(st)) + " · " + st.rate + " Hz · " + st.block + " frames · " + st.inputs + " in · " + st.outputs + " out" + (under ? ' · <span class="warn">' + under + " clock gaps</span>" : "") : '<span class="warn">' + esc(e.error || "not running") + "</span>") + "</td></tr>" +
      (st.deviceError ? '<tr><td></td><td class="warn">' + esc(st.deviceError) + "</td></tr>" : "") + "</table>" +
      '<div class="row"><label>Engine <select data-io-dev="backend">' + engines.map(function (o) { return '<option value="' + o[0] + '"' + ((d.backend || "auto") === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + '</select></label><label>Buffer <select data-io-dev="buffer">' + [64, 128, 256, 512, 1024].map(function (b) { return '<option value="' + b + '"' + (Number(d.buffer) === b ? " selected" : "") + ">" + b + " (" + (b / 48).toFixed(1) + " ms)</option>"; }).join("") + "</select></label>" +
      (PLAT === "win" ? '<label class="toggle" title="WASAPI exclusive mode: lower latency; other programs can\'t use the device meanwhile"><input type="checkbox" data-io-excl' + (d.exclusive ? " checked" : "") + "> Exclusive</label>" : "") + "</div>" +
      '<div class="io-cols">' + devCol("capture", "Inputs from") + devCol("playback", "Outputs to") + "</div>" +
      '<p class="muted small">Several devices join into one set of up to 128 inputs and 128 outputs, one after the other (two 64-channel Dante Virtual Soundcards make 128). The first device is the clock; the others are kept in step automatically.' + (PLAT === "linux" ? " On Linux, PipeWire / JACK already joins every card; Dante works when a Dante card shows up as a normal sound card." : "") + "</p>" +
      (anyDante || PLAT !== "linux" ? '<p class="muted small"><b>Dante:</b> Dante Virtual Soundcard (Audinate, needs its licence) or a Dante PCIe / USB card appears here like any interface - up to 64 × 64 channels each; set the channel count in DVS. Route the channels in Dante Controller. Primary + secondary redundancy is set up in Dante itself and needs nothing here.</p>' : "") +
      '<div class="io-cols"><div><h4>Inputs</h4>' + ((st.captureNames || []).length ? '<table class="io-t">' + st.captureNames.map(function (n, k) { return "<tr><td>In " + (k + 1) + '</td><td><span class="muted small">' + esc(n) + "</span> " + (used[k] ? "→ " + used[k].map(esc).join(", ") : "") + "</td></tr>"; }).join("") + "</table>" : '<p class="muted">none</p>') + "</div>" +
      '<div><h4>Outputs</h4>' + ((st.playbackNames || []).length ? '<table class="io-t">' + st.playbackNames.map(function (n, k) { return "<tr><td>Out " + (k + 1) + '</td><td><span class="muted small">' + esc(n) + "</span> " + (outs[k] ? "← " + outs[k].map(esc).join(", ") : "") + "</td></tr>"; }).join("") + "</table>" : '<p class="muted">none</p>') + "</div></div></section>";
  }
  function listenCard() {
    if (CU.mode() !== "admin") return "";
    var c = cfg(), r = hs && hs.recorder || {};
    return '<section class="card io-c"><h3>Listening &amp; recording</h3><label>Listen on <select data-io="sink"><option value="">This computer\'s output</option></select></label>' + (c.host && c.host.enabled ? '<p class="muted small">Recordings: ' + esc(c.recordDir || "") + " " + (r.recording ? '<b class="warn">● recording</b>' : "") + ' <button data-io="recs">Open</button></p>' : "") + '<p class="muted small">Listen / record from the Mix tab.</p></section>';
  }
  function videoCard() {
    if (CU.mode() !== "admin") return "";
    var S = window.CUSlides; return '<section class="card io-c"><h3>Video (slides &amp; lyrics)</h3><p>' + esc(S ? S.outputsText() : "") + '</p><p class="muted small">Second screen, the Central Control\'s HDMI 2 (set to "Slides" on its I/O tab) and NDI.</p><button data-io-go="slides">Slides</button></section>';
  }
  function lightsCard() {
    if (CU.mode() !== "admin") return "";
    var L = window.CULights, outs = L && L.rig().outputs || [];
    return '<section class="card io-c"><h3>Lights</h3><table class="io-t">' + (outs.length ? outs.map(function (o) { return "<tr><td>Universe " + o.universe + "</td><td>" + (o.mode === "off" ? '<span class="muted">off</span>' : esc(o.mode === "usb" ? "USB-DMX " + (o.path || "") : o.mode === "artnet" ? "Art-Net " + (o.host || "broadcast") : "sACN " + (o.host || "multicast"))) + "</td></tr>"; }).join("") : "<tr><td>DMX</td><td>off</td></tr>") +
      "<tr><td>MIDI out</td><td>" + esc(CU.prefs.midiOut ? (midiNames && midiNames.out[CU.prefs.midiOut]) || "chosen" : "none") + '</td></tr></table><button data-io-go="lights" data-io-lx="output">Lighting → Output</button></section>';
  }
  function midiCard() {
    var ins = midiNames ? Object.values(midiNames.in) : [], outs = midiNames ? Object.values(midiNames.out) : [];
    return '<section class="card io-c"><h3>MIDI devices</h3><table class="io-t"><tr><td>In</td><td>' + (ins.length ? ins.map(esc).join("<br>") : '<span class="muted">none</span>') + "</td></tr><tr><td>Out</td><td>" + (outs.length ? outs.map(esc).join("<br>") : '<span class="muted">none</span>') + "</td></tr></table></section>";
  }
  function instCard() { if (CU.mode() !== "user") return ""; return '<section class="card io-c"><h3>Instrument</h3><p class="muted">Guitar / bass into this computer\'s audio input (an interface), keys on a USB MIDI keyboard. The sound comes out of this computer.</p><button data-io-go="instrument">Instrument</button></section>'; }
  function render() {
    var root = $("#ioRoot"); if (!root || !visible()) return;
    if (root.contains(document.activeElement) && document.activeElement.tagName === "INPUT" && document.activeElement.type !== "checkbox" && document.activeElement.type !== "radio" && document.activeElement.type !== "range") return;
    root.innerHTML = '<div class="io-grid">' + piCard() + piAudioCard() + hostCard() + ifaceCard() + listenCard() + videoCard() + lightsCard() + instCard() + midiCard() + "</div>";
    var sinkSel = $('[data-io="sink"]'); if (sinkSel && navigator.mediaDevices) navigator.mediaDevices.enumerateDevices().then(function (list) { list.filter(function (d) { return d.kind === "audiooutput" && d.deviceId !== "default"; }).forEach(function (d) { var o = document.createElement("option"); o.value = d.deviceId; o.textContent = d.label || "Output " + d.deviceId.slice(0, 6); if (window.CUListen && d.deviceId === window.CUListen.sink()) o.selected = true; sinkSel.appendChild(o); }); }).catch(function () { });
  }
  async function setCfg(patch) { if (NAT && NAT.config) { var c = await NAT.config.set(patch); CU.setConfig(c); if (hs) hs.cfg = c; } if (X) X.choose(); render(); if (patch.newUserCode || patch.newAdminCode) registerHost(); }
  // the Central Control's address for the audio: its Ethernet or Wi-Fi address (whichever was chosen)
  function piTarget() {
    if (!NAT || !NAT.host) return; var c = cfg(), t = (c.piAudio || {}).transport, ifs = CU.state.interfaces || [];
    var want = ifs.filter(function (i) { return i.kind === t; })[0], addr = t === "ethernet" || t === "wifi" ? (want ? want.address : CU.prefs.host) : "";   // (the Pi refuses with a clear message if that's the wrong connection)
    NAT.host.piTarget({ address: addr || "", code: CU.prefs.code || "" });
  }
  // the audio host tells the Central Control where it is, so every other Central Usage finds it
  function registerHost() { var c = cfg(); if ((CU.isAdmin ? CU.isAdmin() : CU.mode() === "admin" || CU.mode() === "main") && c.host && c.host.enabled && CU.state.connected && CU.prefs.code) CU.send({ type: "audioHost", action: "register", code: CU.prefs.code, port: c.host.port || 8092, name: c.name || "Central Usage", userCode: c.host.userCode, adminCode: c.host.adminCode }); }   // the Central Control hands each computer the code for its role
  CU.on("hello", function () { piTarget(); setTimeout(registerHost, 300); });
  CU.on("authed", function () { piTarget(); registerHost(); });
  CU.on("connected", function (on) { if (on) setTimeout(registerHost, 600); });
  var root = $("#ioRoot");
  root.addEventListener("change", async function (e) {
    var t = e.target;
    if (t.name === "ioPi") { await setCfg({ piAudio: { transport: t.value } }); piTarget(); return; }
    if (t.dataset.io === "latency") { await setCfg({ piAudio: { latency: Number(t.value) } }); return; }
    if (t.dataset.io === "host") { await setCfg({ host: { enabled: t.checked } }); piTarget(); registerHost(); if (!t.checked) CU.send({ type: "audioHost", action: "unregister" }); return; }
    if (t.dataset.io === "hostAddr") { CU.store.set("hostAddr", t.value.trim()); if (X) X.refresh(); render(); return; }
    if (t.dataset.io === "adminCode") { CU.store.set("adminCode", t.value.trim()); if (X) X.refresh(); setTimeout(render, 800); return; }
    if (t.dataset.io === "userCode") { CU.store.set("userCode", t.value.trim()); return; }
    if (t.dataset.io === "sink" && window.CUListen) { window.CUListen.setSink(t.value); return; }
    if (t.dataset.ioDev && X) { var p = {}; p[t.dataset.ioDev] = t.dataset.ioDev === "buffer" ? Number(t.value) : t.value; X.op({ op: "device", patch: p }); setTimeout(render, 1500); }
    if (t.dataset.ioDevadd && X && t.value) { var dir = t.dataset.ioDevadd, cur = devList((X.state && X.state.device || {})[dir]); cur.push(t.value); var pa = {}; pa[dir] = cur.join("|"); X.op({ op: "device", patch: pa }); setTimeout(render, 1500); }
    if (t.hasAttribute && t.hasAttribute("data-io-excl") && X) { X.op({ op: "device", patch: { exclusive: t.checked } }); setTimeout(render, 1500); }
  });
  root.addEventListener("input", function (e) { var t = e.target; if (t.dataset.io === "latency") { var o = t.parentNode.querySelector("output"); if (o) o.textContent = t.value + " ms"; } });
  root.addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    if ((b.dataset.ioDevdel || b.dataset.ioDevup) && X) { var parts = (b.dataset.ioDevdel || b.dataset.ioDevup).split(":"), dir = parts[0], k = Number(parts[1]), list = devList((X.state && X.state.device || {})[dir]), it = list.splice(k, 1)[0]; if (b.dataset.ioDevup) list.unshift(it); var pd = {}; pd[dir] = list.join("|"); X.op({ op: "device", patch: pd }); setTimeout(render, 1500); return; }
    if (b.dataset.io === "code") CU.askCode();
    else if (b.dataset.io === "newUser") setCfg({ newUserCode: true });
    else if (b.dataset.io === "newAdmin") setCfg({ newAdminCode: true });
    else if (b.dataset.io === "recs" && NAT && NAT.mixer) NAT.mixer.openRecordings();
    else if (b.dataset.ioGo) { CU.showTab(b.dataset.ioGo); if (b.dataset.ioLx && window.CULights) window.CULights.showSub(b.dataset.ioLx); }
  });
  if (NAT && NAT.host) { NAT.host.status().then(function (s) { hs = s; render(); }); NAT.host.on(function (s) { var before = JSON.stringify([hs && hs.server && hs.server.clients, hs && hs.pi && hs.pi.state, hs && hs.engine && hs.engine.running, hs && hs.cfg]); hs = s; if (visible() && JSON.stringify([s.server && s.server.clients, s.pi && s.pi.state, s.engine && s.engine.running, s.cfg]) !== before) render(); }); }
  if (navigator.requestMIDIAccess) navigator.requestMIDIAccess({ sysex: false }).then(function (a) { function fill() { midiNames = { in: {}, out: {} }; a.inputs.forEach(function (p) { midiNames.in[p.id] = p.name; }); a.outputs.forEach(function (p) { midiNames.out[p.id] = p.name; }); if (visible()) render(); } a.onstatechange = fill; fill(); }).catch(function () { });
  CU.on("tab", function (t) { if (t === "io") render(); });
  CU.on("hello", function () { if (visible()) render(); }); CU.on("authed", function () { if (visible()) render(); }); CU.on("audioHost", function () { if (visible()) render(); }); CU.on("mode", function () { if (visible()) render(); });
  setInterval(function () { if (!visible()) return; var el = document.querySelector('#ioRoot [data-io-live="pi"]'); if (el) el.innerHTML = piStatus(); }, 2000);
  window.CUIO = { render: render, piTarget: piTarget, registerHost: registerHost };
})();
