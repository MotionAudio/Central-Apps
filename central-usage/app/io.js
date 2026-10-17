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
    var c = cfg(), admin = CU.mode() === "admin", host = admin && c.host && c.host.enabled, srv = hs && hs.server || {};
    if (!admin) return '<section class="card io-c"><h3>Audio host (in-ears)</h3><table class="io-t"><tr><td>Audio host</td><td>' + (X && X.hostAddress() ? "<b>" + esc(X.hostAddress()) + "</b>" : '<span class="muted">not found yet</span>') + '</td></tr><tr><td>Address</td><td><input data-io="hostAddr" value="' + esc(CU.store.get("hostAddr", "")) + '" placeholder="automatic (through the Central Control)"></td></tr><tr><td>In-ear code</td><td><input data-io="userCode" value="' + esc(CU.store.get("userCode", "")) + '" placeholder="from the sound desk" style="width:110px"></td></tr></table></section>';
    return '<section class="card io-c"><h3>Audio host</h3><label class="toggle io-big"><input type="checkbox" data-io="host"' + (host ? " checked" : "") + (NAT && NAT.mixer ? "" : " disabled") + "> This computer is the audio host</label>" +
      '<p class="muted small">The audio host gets the tracks, runs the mixer and makes up to 48 in-ear mixes. One per church; other admins mix from their own computer, users pick their mix.</p>' +
      (host ? '<table class="io-t"><tr><td>Server</td><td>' + (srv.running ? "port " + srv.port + " · " + (srv.addresses || []).map(esc).join(", ") : '<span class="warn">' + esc(srv.error || "starting…") + "</span>") + "</td></tr>" +
        '<tr><td>In-ear code</td><td><b class="io-code">' + esc(c.host.userCode) + '</b> <button data-io="newUser">New</button></td></tr><tr><td>Admin code</td><td><b class="io-code">' + esc(c.host.adminCode) + '</b> <button data-io="newAdmin">New</button></td></tr>' +
        "<tr><td>Connected</td><td>" + ((srv.clients || []).length ? srv.clients.map(function (k) { return esc(k.name) + " <small>(" + k.role + (k.mix != null ? " · mix " + (k.mix + 1) : "") + ")</small>"; }).join(", ") : '<span class="muted">nobody</span>') + "</td></tr></table>"
        : '<table class="io-t"><tr><td>Audio host</td><td>' + (X && X.hostAddress() ? "<b>" + esc(X.hostAddress()) + "</b>" : '<span class="muted">not found</span>') + '</td></tr><tr><td>Address</td><td><input data-io="hostAddr" value="' + esc(CU.store.get("hostAddr", "")) + '" placeholder="automatic"></td></tr><tr><td>Admin code</td><td><input data-io="adminCode" value="' + esc(CU.store.get("adminCode", "")) + '" placeholder="shown on the audio host" style="width:110px"> <span class="muted small">' + esc(X && X.error || (X && X.connected() ? "✓ connected" : "")) + "</span></td></tr></table>") + "</section>";
  }
  function clients(names) { var out = []; (names || []).forEach(function (n) { var c = n.split(":")[0]; if (out.indexOf(c) < 0) out.push(c); }); return out; }
  function ifaceCard() {
    var c = cfg(); if (CU.mode() !== "admin" || !(c.host && c.host.enabled)) return "";
    var e = hs && hs.engine || {}, st = e.status || {}, d = (X && X.state && X.state.device) || c.device || {}, capC = clients(st.allCapture), playC = clients(st.allPlayback);
    var opts = function (list, cur) { return '<option value="">Every physical input / output</option>' + list.map(function (n) { return '<option' + (n === cur ? " selected" : "") + ">" + esc(n) + "</option>"; }).join("") + (cur && list.indexOf(cur) < 0 ? '<option selected>' + esc(cur) + "</option>" : ""); };
    var S = X && X.state, used = {}, outs = {};
    if (S) {
      S.inputs.forEach(function (x, i) { if (x.src.kind === "in") (used[x.src.ch] = used[x.src.ch] || []).push(x.name || "Input " + (i + 1)); });
      var add = function (o, what) { if (o >= 0) (outs[o] = outs[o] || []).push(what); };
      if (S.trackOut !== "direct") { add(S.main.outL, "Tracks L"); add(S.main.outR, "Tracks R"); }
      S.inputs.forEach(function (x, i) { if (x.direct >= 0) add(x.direct, (x.name || "Input " + (i + 1)) + " (direct)"); });
      S.mixes.forEach(function (q, m) { if (q.mode !== "local") { add(q.outL, "Mix " + (m + 1) + (q.stereo ? " L" : "")); if (q.stereo) add(q.outR, "Mix " + (m + 1) + " R"); } });
    }
    return '<section class="card io-c wide"><h3>Audio interface</h3><table class="io-t"><tr><td>Engine</td><td>' + (e.running && st.backend ? esc(st.backend === "jack" ? "running (PipeWire / JACK)" : "running on its own clock - no interface (Wi-Fi in-ears and recording still work)") + " · " + st.rate + " Hz · " + st.block + " frames · " + st.inputs + " in · " + st.outputs + " out" : '<span class="warn">' + esc(e.error || "not running") + "</span>") + "</td></tr></table>" +
      '<div class="row"><label>Inputs from <select data-io-dev="capture">' + opts(capC, d.capture) + '</select></label><label>Outputs to <select data-io-dev="playback">' + opts(playC, d.playback) + '</select></label><label>Buffer <select data-io-dev="buffer">' + [64, 128, 256, 512, 1024].map(function (b) { return '<option value="' + b + '"' + (Number(d.buffer) === b ? " selected" : "") + ">" + b + " (" + (b / 48).toFixed(1) + " ms)</option>"; }).join("") + '</select></label><label>Engine <select data-io-dev="backend"><option value="auto"' + (d.backend !== "internal" ? " selected" : "") + '>Audio interface (PipeWire / JACK)</option><option value="internal"' + (d.backend === "internal" ? " selected" : "") + ">No interface (network only)</option></select></label></div>" +
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
  async function setCfg(patch) { if (NAT && NAT.config) { var c = await NAT.config.set(patch); CU.setConfig(c); if (hs) hs.cfg = c; } if (X) X.choose(); render(); }
  // the Central Control's address for the audio: its Ethernet or Wi-Fi address (whichever was chosen)
  function piTarget() {
    if (!NAT || !NAT.host) return; var c = cfg(), t = (c.piAudio || {}).transport, ifs = CU.state.interfaces || [];
    var want = ifs.filter(function (i) { return i.kind === t; })[0], addr = t === "ethernet" || t === "wifi" ? (want ? want.address : CU.prefs.host) : "";   // (the Pi refuses with a clear message if that's the wrong connection)
    NAT.host.piTarget({ address: addr || "", code: CU.prefs.code || "" });
  }
  // the audio host tells the Central Control where it is, so every other Central Usage finds it
  function registerHost() { var c = cfg(); if (CU.mode() === "admin" && c.host && c.host.enabled && CU.state.connected && CU.prefs.code) CU.send({ type: "audioHost", action: "register", code: CU.prefs.code, port: c.host.port || 8092, name: c.name || "Central Usage" }); }
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
  });
  root.addEventListener("input", function (e) { var t = e.target; if (t.dataset.io === "latency") { var o = t.parentNode.querySelector("output"); if (o) o.textContent = t.value + " ms"; } });
  root.addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
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
