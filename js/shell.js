/* Central Pedal - the shell: the top tabs (LIVE / Pad / Tracks / Instrument /
 * Configure / Learn / I/O / Settings), cursor show/hide, and the Settings sections that
 * talk to the Pi (Wi-Fi, OS audio, 3.5" screen, MIDI out, Link, projector, companion devices + QR). */
(function () {
  "use strict";
  var PP = window.PP, F = window.PPFeatures; if (!PP || !F) return;
  var engine = PP.engine, esc = PP.escapeHtml, clamp = PP.clamp;
  function $(s) { return document.querySelector(s); }
  function project() { return PP.project(); }
  function bridge() { return window.__pedalBridge; }
  function connected() { return !!(bridge() && bridge().connected); }
  function send(m) { return bridge() && bridge().send ? bridge().send(m) : false; }

  // ------------------------------------------------------------- tabs
  var current = "pads", performBefore = null;
  function showTab(name) {
    if (["live", "pads", "tracks", "instrument", "configure", "learn", "io", "settings"].indexOf(name) < 0) name = "live";
    if (window.PPLive && window.PPLive.locked() && name !== "live") { window.PPLive.lockedNotice(); name = "live"; }   // service lock: the LIVE screen only
    if (current === "instrument" && name !== "instrument" && window.PPInstrument) window.PPInstrument.hide();
    if (current === "pads" && name !== "pads") performBefore = PP.isPerforming();
    current = name;
    document.querySelectorAll("[data-tab]").forEach(function (b) { b.classList.toggle("active", b.dataset.tab === name); });
    document.body.classList.toggle("tab-pads", name === "pads"); document.body.dataset.tab = name;
    [["tabLive", "live"], ["tabTracks", "tracks"], ["tabInstrument", "instrument"], ["tabConfigure", "configure"], ["tabLearn", "learn"], ["tabIO", "io"], ["tabSettings", "settings"]].forEach(function (t) { var el = $("#" + t[0]); if (el) el.classList.toggle("hidden", name !== t[1]); });
    if (name === "pads") { document.querySelector("main.app").classList.remove("hidden"); if (performBefore != null) PP.setPerformMode(performBefore); else PP.setPerformMode(PP.isPerforming()); }
    else { document.querySelector("main.app").classList.add("hidden"); $("#perform").classList.add("hidden"); document.body.classList.remove("performing"); }
    if (name === "tracks" && window.PPTracks) window.PPTracks.render();
    if (window.PPLive) window.PPLive.shown(name === "live");
    if ((name === "configure" || name === "learn") && window.PPConfigure) window.PPConfigure.render();
    if (name === "instrument" && window.PPInstrument) window.PPInstrument.show();
    if (name === "io" && window.PPIO) { window.PPIO.render(); send({ type: "system", action: "status" }); send({ type: "netAudio", action: "status" }); }
    if (name === "settings") { enumerateOutputs().then(renderSystemExtras); if (window.PPSettings) window.PPSettings.render(); send({ type: "system", action: "status" }); send({ type: "system", action: "wifi" }); }
    try { localStorage.setItem("pad-pedal-tab", name); } catch (_) { }
    if (window.PPTracks) window.PPTracks.sendDisplay();
  }
  document.querySelectorAll("[data-tab]").forEach(function (b) { b.addEventListener("click", function () { showTab(b.dataset.tab); }); });
  document.addEventListener("keydown", function (e) { if (e.target.matches && e.target.matches("input,select,textarea")) return; var m = { F1: "pads", F2: "tracks", F3: "instrument", F4: "configure", F5: "learn", F6: "settings", F7: "io", F8: "live" }[e.key]; if (m) { e.preventDefault(); showTab(m); } });

  // ------------------------------------------------------------- cursor
  var status = null;
  var pointer = false;
  function cursorMode() { var d = (status && status.displays) || project().display || {}; return d.cursor || "auto"; }
  function setPointer(on) { pointer = !!on; var mode = cursorMode(); document.body.classList.toggle("no-cursor", mode === "never" || (mode === "auto" && connected() && !pointer)); }
  document.addEventListener("pointermove", function (e) { if (!connected() && e.pointerType === "mouse" && document.body.classList.contains("no-cursor")) document.body.classList.remove("no-cursor"); });
  F.on("hello", function (m) { setPointer(!!m.mouse); renderSystemExtras(); });
  F.on("devices", function (m) { setPointer(!!m.mouse); });

  // ------------------------------------------------------------- system extras
  var wifi = null, outputs = [];
  F.on("systemStatus", function (m) { status = m; if (m.wifi) wifi = m.wifi; renderSystemExtras(); });
  async function enumerateOutputs() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    try { var list = await navigator.mediaDevices.enumerateDevices(); outputs = list.filter(function (d) { return d.kind === "audiooutput"; }); } catch (_) { outputs = []; }
  }
  function renderSystemExtras() {
    var root = $("#sysExtra"); if (!root) return;
    var p = project(), r = p.routing || (p.routing = {}), mo = p.midiOut || (p.midiOut = {}), pr = p.projector || (p.projector = {}), lk = p.link || (p.link = {});
    var addr = (status && status.addresses) || (bridge() && bridge().info && bridge().info.addresses) || [], code = (status && status.code) || (bridge() && bridge().info && bridge().info.code) || "";
    var host = (status && status.hostname) || (bridge() && bridge().info && bridge().info.hostname) || "padpedal", lanPort = (status && status.lanPort) || (bridge() && bridge().info && bridge().info.lanPort) || 8080, url = "http://" + (addr[0] || host + ".local") + ":" + lanPort + "/";
    var routing = engine.routing || {}, displays = (status && status.displays) || p.display || {};
    root.innerHTML =
      '<section data-st="network"><h3>Companion devices (chord charts on phones, tablets, laptops)</h3>' + (connected() ? '<p>On the same Wi-Fi, open <b>' + esc(url) + '</b>' + (addr.length > 1 ? " (or " + addr.slice(1).map(esc).join(", ") + ")" : "") + ' and enter the pairing code <b class="code">' + esc(code) + '</b> to control it from there. Charts, lyrics, setlist and the current section follow along automatically.</p><div id="sysQr" class="qr"></div><p class="muted">Charts: <b>' + esc(url) + '</b> · Projector lyrics: <b>' + esc(url + "lyrics") + '</b> · Remote: <b>' + esc(url + "remote") + '</b> · Stage display for the band: <b>' + esc(url + "stage") + '</b> · Send songs, stems and charts from any device: <b>' + esc(url + "upload") + "</b>.</p>" : '<p class="muted">Available on the Central Pedal itself.</p>') + "</section>" +
      '<section data-st="audio"><h3>Output device</h3>' + (connected() ? '<p class="muted">On the Central Pedal the OS combines every sound card into one multi-channel output (headphone jack, I2S DAC board, USB interfaces). ' + (status && status.audio && status.audio.channels ? status.audio.channels.length + " channels: " + status.audio.channels.map(function (c, i) { return (i + 1) + " " + esc(c); }).join(" · ") : "") + '</p><label class="toggle"><input type="checkbox" data-sys="osHdmi"' + (status && status.audio && status.audio.hdmi ? " checked" : "") + '> Include HDMI audio as extra channels</label><label class="toggle"><input type="checkbox" data-sys="osUsbFirst"' + (status && status.audio && status.audio.usbFirst ? " checked" : "") + '> USB interface channels first (before the jack and the DAC)</label><p class="muted">Card order changes take effect after a restart of the screens (Settings → Screens → Apply) or a reboot.</p>' : '<label>Browser output device<select data-sys="main"><option value="auto"' + (r.mainDevice ? "" : " selected") + '>System default</option>' + outputs.map(function (d) { return '<option value="' + esc(d.deviceId) + '"' + (r.mainDevice === d.deviceId ? " selected" : "") + ">" + esc(d.label || d.deviceId) + "</option>"; }).join("") + "</select></label>" +
        '<label>Click + voice cues on a 2-channel device<select data-sys="clickFallback"><option value="off"' + (r.clickFallback === "off" ? " selected" : "") + '>Nowhere (silent)</option><option value="mix"' + (r.clickFallback === "mix" ? " selected" : "") + '>In the main mix (rehearsal)</option><option value="split"' + (r.clickFallback === "split" ? " selected" : "") + '>Left = music (mono), right = click</option><option value="device"' + (r.clickFallback === "device" ? " selected" : "") + '>Another output device…</option></select></label>' +
        (r.clickFallback === "device" ? '<label>Click device<select data-sys="clickDevice">' + outputs.map(function (d) { return '<option value="' + esc(d.deviceId) + '"' + (r.clickDevice === d.deviceId ? " selected" : "") + ">" + esc(d.label || d.deviceId) + "</option>"; }).join("") + "</select></label>" : "")) +
      '<p class="muted">Now: ' + (routing.mode === "stereo2" ? "2-channel device - tracks and pads share outputs 1-2, click " + (routing.buses && routing.buses.click !== "off" ? "via " + routing.buses.click : "off") : (routing.wanted === "stereo" ? "stereo pairs" : "four mono outputs") + " on a " + routing.channels + "-channel device") + (status && status.soundCards ? " · sound cards: " + status.soundCards.map(function (c) { return esc(c.replace(/\s+/g, " ").slice(0, 40)); }).join(" | ") : "") + "</p></section>" +
      '<section data-st="midi"><h3>MIDI out</h3><label>Lights channel<input type="number" min="1" max="16" data-sys="lightsChannel" value="' + (mo.lightsChannel || 1) + '"></label><label>Lights "hit" note<input type="number" min="0" max="127" data-sys="lightsNote" value="' + (mo.lightsNote == null ? 48 : mo.lightsNote) + '"></label><label class="toggle"><input type="checkbox" data-sys="lightsHits"' + (mo.lightsHits !== false ? " checked" : "") + "> Send big hits to the lights channel</label><label class=\"toggle\"><input type=\"checkbox\" data-sys=\"lightsSections\"" + (mo.lightsSections ? " checked" : "") + "> Also send section changes (notes 60+) on the lights channel</label>" +
        '<label class="toggle"><input type="checkbox" data-sys="lightsDrums"' + (mo.lightsDrums !== false ? " checked" : "") + '> Send the drum hits (from split songs) as their own notes on the lights channel</label><div class="row">' +
        [["kick", "Kick"], ["snare", "Snare"], ["hat", "Hi-hat"], ["crash", "Crash"]].map(function (d) { var n = window.PPTracks && window.PPTracks.drumNote ? window.PPTracks.drumNote(mo, d[0]) : ""; return '<label><span><input type="checkbox" data-sys="drumPart:' + d[0] + '"' + (!(mo.drumParts && mo.drumParts[d[0]] === false) ? " checked" : "") + "> " + d[1] + ' note</span><input type="number" min="0" max="59" data-sys="drumNote:' + d[0] + '" value="' + n + '" style="width:70px"></label>'; }).join("") + "</div>" +
      '<label>General channel<input type="number" min="1" max="16" data-sys="generalChannel" value="' + (mo.generalChannel || 2) + '"></label><label class="toggle"><input type="checkbox" data-sys="pcOnSong"' + (mo.pcOnSong !== false ? " checked" : "") + "> Program change when a song loads</label><label class=\"toggle\"><input type=\"checkbox\" data-sys=\"noteOnSection\"" + (mo.noteOnSection !== false ? " checked" : "") + "> Note (60 + section) when a section starts</label><label class=\"toggle\"><input type=\"checkbox\" data-sys=\"clockOut\"" + (mo.clockOut !== false ? " checked" : "") + '> MIDI clock + start / stop while tracks play</label><label>Timing offset (ms, + = later)<input type="number" min="-200" max="200" data-sys="offsetMs" value="' + (mo.offsetMs || 0) + '"></label>' +
      '<p class="muted">' + (status && status.midiPorts && status.midiPorts.outputs && status.midiPorts.outputs.length ? "Sending to: " + status.midiPorts.outputs.map(esc).join(", ") : "No MIDI output device found (plug a USB MIDI interface into the Pi).") + "</p></section>" +
      '<section data-st="midi"><h3>Ableton Link</h3><label class="toggle"><input type="checkbox" data-sys="linkEnabled"' + (lk.enabled ? " checked" : "") + "> Share tempo and play / stop with Link apps on this Wi-Fi</label><p class=\"muted\">" + (status && status.link ? (status.link.available ? (status.link.peers ? status.link.peers + " Link peer(s) connected" : "No Link peers yet") : "Link is not installed on this system") : "Available on the Central Pedal itself") + "</p></section>" +
      '<section data-st="screens"><h3>Projector (HDMI 2) and lyrics</h3><label>Lyrics size<input type="range" min="3" max="14" step=".5" data-sys="fontSize" value="' + (pr.fontSize || 7) + '"></label><label class="toggle"><input type="checkbox" data-sys="showNext"' + (pr.showNext !== false ? " checked" : "") + "> Preview the next lines</label><label class=\"toggle\"><input type=\"checkbox\" data-sys=\"showSection\"" + (pr.showSection !== false ? " checked" : "") + "> Show the section name</label><label class=\"toggle\"><input type=\"checkbox\" data-sys=\"blank\"" + (pr.blank ? " checked" : "") + '> Blank the projector</label><label>Theme<select data-sys="theme"><option value="dark"' + (pr.theme !== "light" ? " selected" : "") + '>White on black</option><option value="light"' + (pr.theme === "light" ? " selected" : "") + ">Black on white</option></select></label></section>" +
      screensHtml(displays) +
      (window.PPTouchWifi ? window.PPTouchWifi.touchHtml(status) : "") +
      (window.PPTouchWifi ? window.PPTouchWifi.wifiHtml(status, wifi) : "") +
      (window.PPStreamDeck ? window.PPStreamDeck.settingsHtml() : "") +
      (window.PPBackup ? window.PPBackup.settingsHtml() : "");
    if (connected() && window.qrcode) { try { var q = window.qrcode(0, "M"); q.addData(url + (code ? "?code=" + code : "")); q.make(); $("#sysQr").innerHTML = q.createSvgTag({ cellSize: 3, margin: 2 }); } catch (_) { } }
  }
  // Settings → Screens: what each HDMI screen shows, its resolution, zoom and edge margin. The screen session on the
  // Central Pedal watches these and redoes the layout within a few seconds (resolution / margin: in place, sound
  // keeps playing; what a screen shows or the zoom: the windows restart).
  function screensHtml(displays) {
    var sc = (status && status.screens) || null, outs = sc && sc.outputs || [];
    function opts(list, cur) { return list.map(function (o) { return '<option value="' + o[0] + '"' + (String(cur) === String(o[0]) ? " selected" : "") + ">" + o[1] + "</option>"; }).join(""); }
    function screen(n) {
      var role = "hdmi" + n, o = outs.filter(function (x) { return x.role === role; })[0], mode = displays["mode" + n] || "auto", inset = Number(displays["inset" + n]) || 0;
      var modes = o ? o.modes : [], list = [["auto", "Automatic" + (o && o.preferred ? " - " + o.preferred + " (the screen's own)" : " (the screen's own)")]].concat(modes.map(function (m) { return [m, m.replace("x", " × ") + (o.preferred === m ? " (native)" : "")]; }));
      if (mode !== "auto" && modes.indexOf(mode) < 0) list.push([mode, mode + " (not offered by this screen)"]);
      var tk = (status && status.touchKind) || "off", big = tk === "hdmi" || tk === "dsi";
      var shows = n === 1 ? (tk === "spi" ? [["touch", "Copy of the touch screen (default)"], ["app", "Central Pedal app"]] : [["app", "Central Pedal app (default)"], ["touch", "Copy of the touch screen"]]).concat([["lyrics", "Lyrics"], ["charts", "Chord charts"], ["stage", "Stage display (section · next · beat · countdown)"], ["slides", "Slides from Central Control"]])
                          : [["lyrics", "Lyrics (default)"], ["charts", "Chord charts"], ["stage", "Stage display for the band (section · next · beat · countdown)"], ["slides", "Slides & lyrics from Central Control (pictures, video)"], ["touch", "Copy of the touch screen"], ["app", "Central Pedal app"], ["off", "Nothing"]];
      var cur = displays["hdmi" + n] || (n === 1 ? (tk === "spi" ? "touch" : "app") : "lyrics"); if (cur === "mini") cur = "touch";
      if (n === 1 && big) return '<div class="scr-card"><h4>' + (tk === "dsi" ? "Touch screen (ribbon cable)" : "HDMI 1 - the touch screen") + (o ? ' <small>' + esc(o.name) + (o.current ? " · " + esc(o.current) : "") + "</small>" : "") + '</h4><p class="muted small">Shows the Central Pedal app (you work on it by touch).' + (tk === "dsi" ? " The HDMI port is the second screen." : "") + "</p>" +
        '<label>Resolution<select data-sys="mode1">' + opts(list, mode) + "</select></label></div>";
      return '<div class="scr-card"><h4>' + (n === 2 && big ? (tk === "dsi" ? "HDMI" : "HDMI 2") : "HDMI " + n) + (o ? ' <small>' + esc(o.name) + (o.current ? " · " + esc(o.current) : "") + "</small>" : ' <small>' + (sc ? "not connected" : "") + "</small>") + "</h4>" +
        '<label>Shows<select data-sys="hdmi' + n + '">' + opts(shows, cur) + "</select></label>" +
        '<label>Resolution<select data-sys="mode' + n + '">' + opts(list, mode) + "</select></label>" +
        '<label>Edges cut off? Pull the picture in <output>' + inset + ' px</output><input type="range" min="0" max="120" step="4" data-sys="inset' + n + '" value="' + inset + '"></label></div>';
    }
    var any = outs.some(function (x) { return x.connected; });
    return '<section data-st="screens" class="wide"><h3>Screens</h3>' +
      (connected() && sc && !any ? '<p class="warn-line">No screen answered on HDMI. Check the cable is in the micro-HDMI port next to the power socket (HDMI 1) and that the monitor is on its HDMI input - the picture comes up by itself within a few seconds.</p>' : "") +
      '<div class="scr-grid">' + screen(1) + screen(2) + "</div>" +
      '<div class="row"><label>Zoom (size of everything on the HDMI screens)<select data-sys="scale">' + opts([["auto", "Automatic (100 %, 150 % / 200 % on 1440p / 4K)"], ["1", "100 %"], ["1.25", "125 %"], ["1.5", "150 %"], ["1.75", "175 %"], ["2", "200 %"], ["0.8", "80 % (fit more)"]], displays.scale || "auto") + "</select></label>" +
      '<label>Mouse cursor<select data-sys="cursor">' + opts([["auto", "Show when a mouse is plugged in (default)"], ["always", "Always show"], ["never", "Never show (touch only)"]], displays.cursor || "auto") + "</select></label></div>" +
      '<p class="muted">Resolution and edge changes apply in a few seconds without stopping the sound. Changing what a screen shows, or the zoom, restarts the screens (stop the music first). A blurry picture usually means the resolution is not the screen\'s native one - choose Automatic or the "(native)" size.</p>' +
      '<button data-sys="applyScreens"' + (connected() ? "" : " disabled") + ">Restart the screens</button></section>";
  }
  function busyPlaying() { var T = window.PPTracks; return !!((T && T.isPlaying && T.isPlaying()) || (PP.engine && PP.engine.voices && PP.engine.voices().length)); }
  function onSys(e) {
    var el = e.target, f = el.dataset.sys; if (!f) return;
    var p = project(), r = p.routing, mo = p.midiOut, pr = p.projector, lk = p.link;
    if (f === "main") { r.mainDevice = el.value === "auto" ? null : el.value; engine.routeOutput(); }
    else if (f === "clickFallback") { r.clickFallback = el.value; engine.routeOutput(); renderSystemExtras(); }
    else if (f === "clickDevice") { r.clickDevice = el.value; engine.routeOutput(); }
    else if (f === "osHdmi" || f === "osUsbFirst") { send({ type: "system", action: "audio", hdmi: $('[data-sys="osHdmi"]').checked, usbFirst: $('[data-sys="osUsbFirst"]').checked }); }
    else if (["lightsChannel", "lightsNote", "generalChannel", "offsetMs"].indexOf(f) > -1) mo[f] = Number(el.value);
    else if (["lightsHits", "lightsSections", "lightsDrums", "pcOnSong", "noteOnSection", "clockOut"].indexOf(f) > -1) mo[f] = el.checked;
    else if (/^drumNote:/.test(f)) { mo.drumNotes = mo.drumNotes || {}; mo.drumNotes[f.split(":")[1]] = Math.max(0, Math.min(59, Number(el.value) || 0)); }   // (60 and up are the section notes)
    else if (/^drumPart:/.test(f)) { mo.drumParts = mo.drumParts || {}; mo.drumParts[f.split(":")[1]] = el.checked; }
    else if (f === "linkEnabled") { lk.enabled = el.checked; send({ type: "link", enabled: lk.enabled, bpm: p.tempo.bpm, playing: !!(window.PPTracks && window.PPTracks.isPlaying()) }); }
    else if (/^(hdmi[12]|cursor|mode[12]|scale|inset[12])$/.test(f)) {
      if (/^inset/.test(f) && e.type === "input") { var out = el.parentElement.querySelector("output"); if (out) out.textContent = el.value + " px"; return; }
      var val = /^inset/.test(f) ? Number(el.value) : el.value, one = {}; one[f] = val;
      if (/^(hdmi[12]|cursor)$/.test(f)) { p.display = p.display || {}; p.display[f] = val; }
      if (status) { status.displays = status.displays || {}; status.displays[f] = val; }
      send({ type: "system", action: "displays", config: one }); if (f === "cursor") setPointer(pointer);
      if (/^(hdmi|scale)/.test(f)) PP.setStatus("The screens restart in a moment…"); else if (/^mode/.test(f)) PP.setStatus("Changing the resolution…");
    }
    else if (f === "screenType") { send({ type: "system", action: "screenType", value: el.value }); }
    else if (f === "fontSize") pr.fontSize = Number(el.value); else if (["showNext", "showSection", "blank"].indexOf(f) > -1) pr[f] = el.checked; else if (f === "theme") pr.theme = el.value;
    if (/^(lightsHits|lightsDrums|drumPart:)/.test(f) && window.PPTracks && window.PPTracks.song()) window.PPTracks.pushAll(window.PPTracks.song());   // (the hits to send)
    PP.persistSoon(); if (window.PPTracks) window.PPTracks.sendDisplay(); if (window.PPActions) window.PPActions.sendLeds();
  }
  function onSysClick(e) {
    var b = e.target.closest("[data-sys],[data-wifi]"); if (!b) return;
    if (b.dataset.wifi) { var ssid = b.dataset.wifi; PP.ask("Password for " + ssid + " (leave empty if it has none)", { password: true, ok: "Connect" }).then(function (pw) { if (pw === null) return; send({ type: "system", action: "wifi", ssid: ssid, password: pw }); PP.setStatus("Connecting to " + ssid + "…"); }); return; }
    if (b.dataset.sys === "wifiScan") { send({ type: "system", action: "wifi" }); PP.setStatus("Scanning Wi-Fi…"); }
    if (b.dataset.sys === "applyScreens") { if (busyPlaying() && !confirm("Something is playing - restarting the screens stops the sound for a few seconds. Restart them now?")) return; send({ type: "system", action: "restartSession" }); PP.setStatus("Restarting the screens…"); return; }
    if (b.dataset.sys === "calibrate") { send({ type: "hardware", action: "calibrateTouch" }); PP.setStatus("Touch the two crosses on the small screen"); return; }
    if (b.dataset.sys === "screen") { if (!confirm((status && status.screen35 ? "Turn the 3.5-inch screen off" : "Turn the 3.5-inch screen on") + "? Central Pedal will restart.")) return; send({ type: "system", action: "screen", value: status && status.screen35 ? "off" : "on" }); }
  }
  function wire() {
    var d = $("#systemDialog"); if (!d) return;
    d.addEventListener("change", onSys); d.addEventListener("click", onSysClick);
    d.addEventListener("input", function (e) { if (/^inset/.test(e.target.dataset.sys || "")) onSys(e); });
    $("#systemButton").addEventListener("click", function () { showTab("settings"); });
    var pfSys = $("#pfSystem"); if (pfSys) pfSys.addEventListener("click", function () { showTab("settings"); });
  }
  wire(); renderSystemExtras();
  var start = "live"; try { start = localStorage.getItem("pad-pedal-tab") || "live"; } catch (_) { }
  var h = location.hash.replace("#", ""); if (h === "perform") start = "pads";
  else if (h === "resume") { var saved = null; try { saved = localStorage.getItem("pad-pedal-tab"); } catch (_) { } start = saved || "live"; }   // the screens at boot: where you left off (first start: LIVE)
  else if (["live", "pads", "tracks", "instrument", "configure", "learn", "io", "settings"].indexOf(h) > -1) start = h;
  if (window.PPLive && window.PPLive.locked()) start = "live";
  showTab(start);
  setPointer(false);
  window.PPShell = { showTab: showTab, setPointer: setPointer, renderSystemExtras: renderSystemExtras, currentTab: function () { return current; }, onSys: onSys, onSysClick: onSysClick, screensHtml: screensHtml, enumerateOutputs: enumerateOutputs };
})();
