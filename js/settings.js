/* Central Pedal - the Settings tab: appearance (colour presets, size), the
 * audio engine (sample rate, latency), the output routing matrix (four mono
 * buses -> any output channel), and the sub-navigation of the settings groups.
 * The Pi-only sections (Wi-Fi, screens, OS audio, MIDI out...) are rendered by shell.js. */
(function () {
  "use strict";
  var PP = window.PP, F = window.PPFeatures; if (!PP || !F) return;
  var engine = PP.engine, esc = PP.escapeHtml;
  function $(s) { return document.querySelector(s); }
  function project() { return PP.project(); }
  function bridge() { return window.__pedalBridge; }
  function connected() { return !!(bridge() && bridge().connected); }
  function send(m) { return bridge() && bridge().send ? bridge().send(m) : false; }

  // ------------------------------------------------------------- appearance
  var PRESETS = [
    { name: "Studio", theme: { bg: "#111317", panel: "#1a1d22", text: "#ece7dd", accent: "#e2c27e", blue: "#8db5de", line: "#343a44" } },
    { name: "Midnight", theme: { bg: "#08111d", panel: "#101e31", text: "#ecf7ff", accent: "#5de6b0", blue: "#75adff", line: "#294966" } },
    { name: "Worship warm", theme: { bg: "#140f0c", panel: "#241a14", text: "#fff4e8", accent: "#ffb45c", blue: "#f08a6a", line: "#4a3326" } },
    { name: "Stage black", theme: { bg: "#000000", panel: "#0d0d0d", text: "#f2f2f2", accent: "#ff4d6d", blue: "#8aa4ff", line: "#2a2a2a" } },
    { name: "Forest", theme: { bg: "#07140f", panel: "#0f2419", text: "#eafff3", accent: "#8df0a8", blue: "#7ed0ff", line: "#214433" } },
    { name: "Royal", theme: { bg: "#0e0a1f", panel: "#1a1333", text: "#f3ecff", accent: "#d7a8ff", blue: "#8fb5ff", line: "#3b2d63" } },
    { name: "Daylight", theme: { bg: "#f2f5f8", panel: "#ffffff", text: "#102033", accent: "#0f9d72", blue: "#2f6fe0", line: "#c9d6e3" } },
    { name: "High contrast", theme: { bg: "#000000", panel: "#101010", text: "#ffffff", accent: "#ffee00", blue: "#00e5ff", line: "#666666" } }
  ];
  function renderPresets() {
    var root = $("#themePresets"); if (!root) return;
    var t = project().theme || {};
    root.innerHTML = PRESETS.map(function (p, i) {
      var same = Object.keys(p.theme).every(function (k) { return (t[k] || "").toLowerCase() === p.theme[k]; });
      return '<button class="theme-chip' + (same ? " on" : "") + '" data-preset="' + i + '" style="--c1:' + p.theme.bg + ';--c2:' + p.theme.panel + ';--c3:' + p.theme.accent + ';--c4:' + p.theme.blue + '"><i></i>' + esc(p.name) + "</button>";
    }).join("");
    var scale = $("#uiScale"); if (scale) scale.value = String(project().ui && project().ui.scale || 1);
  }
  function applyScale() { var s = project().ui && project().ui.scale || 1; document.documentElement.style.fontSize = (14 * s) + "px"; document.documentElement.style.setProperty("--ui-scale", String(s)); }

  // ------------------------------------------------------------- audio engine
  function renderAudio() {
    var a = project().audio || (project().audio = { sampleRate: 0, latency: "interactive" });
    var rate = $("#audioRate"), lat = $("#audioLatency"), info = $("#audioInfo");
    if (rate) rate.value = String(a.sampleRate || 0); if (lat) lat.value = a.latency || "interactive";
    if (info) { var c = engine.ctx; info.textContent = c ? "Running at " + c.sampleRate + " Hz · output latency " + Math.round(((c.baseLatency || 0) + (c.outputLatency || 0)) * 1000) + " ms · " + (c.destination.maxChannelCount || 2) + " output channels" : "Audio engine not started yet (press a pad or Start Pad Sound)."; }
  }

  // ------------------------------------------------------------- routing matrix
  var BUSES = [["tracks", "Tracks", "the song's tracks, mixed"], ["pad", "Pads", "pads + textures + audio input"], ["click", "Click + cue voice", "metronome and spoken cues (in-ears)"], ["instrument", "Instrument", "guitar / keys (native chain on the Pi)"]];
  function channelNames() {
    var st = F.systemStatus && F.systemStatus(), list = st && st.audio && st.audio.channels;
    // the Central Pedal lists its real outputs (1-2 the headphone jack, 3-4 the DAC board when one is fitted, a USB
    // interface from 5): only those are offered. Elsewhere, this device's channels (at least 4 to plan for the pedal).
    var n = list && list.length ? list.length : Math.max(engine.ctx ? (engine.ctx.destination.maxChannelCount || 2) : 2, 4);
    var out = []; for (var i = 1; i <= n; i++) out.push(list && list[i - 1] ? i + " · " + list[i - 1] : "Output " + i);
    return out;
  }
  // each bus goes to one output (mono) or a pair (stereo); several buses can share an output (they're mixed there).
  // Presets: 4 mono (1 tracks · 2 pads · 3 click · 4 instrument) or 2 stereo (tracks + pads on 1-2, click + instrument on 3-4).
  var PRESET_ROUTES = {
    mono4: { tracks: { ch: 1, st: false }, pad: { ch: 2, st: false }, click: { ch: 3, st: false }, instrument: { ch: 4, st: false } },
    stereo2: { tracks: { ch: 1, st: true }, pad: { ch: 1, st: true }, click: { ch: 3, st: true }, instrument: { ch: 3, st: true } },
    all12: { tracks: { ch: 1, st: true }, pad: { ch: 1, st: true }, click: { ch: 1, st: true }, instrument: { ch: 1, st: true } }
  };
  // the outputs really there: the Pi's list (jack 2, DAC board 2, USB interface…), else this device's channel count
  function realOutputs() {
    var st = F.systemStatus && F.systemStatus(), list = st && st.audio && st.audio.channels;
    if (list && list.length) return list.length;
    return engine.ctx ? (engine.ctx.destination.maxChannelCount || 2) : 2;
  }
  function onPi() { var st = F.systemStatus && F.systemStatus(); return !!(st && st.audio && st.audio.channels && st.audio.channels.length); }
  function routeOptions(n) {   // [{v: "3" | "1s", ch, st, label}]: Off, every output, every stereo pair
    var names = channelNames(), out = [{ v: "0", ch: 0, st: false, label: "Off" }];
    for (var c = 1; c <= n; c++) out.push({ v: String(c), ch: c, st: false, label: names[c - 1] });
    for (var p = 1; p < n; p += 2) out.push({ v: p + "s", ch: p, st: true, label: p + "–" + (p + 1) + " stereo" + pairName(names, p) });
    return out;
  }
  function pairName(names, p) { var a = (names[p - 1] || "").replace(/^\d+ · /, "").replace(/ (L|left)$/i, ""), b = (names[p] || "").replace(/^\d+ · /, "").replace(/ (R|right)$/i, ""); return a && a === b ? " · " + a : ""; }
  function busValue(b) { return !b || !b.ch ? "0" : b.ch + (b.st ? "s" : ""); }
  function busOut(b) { if (!b || !b.ch) return "Off"; var names = channelNames(); return b.st ? b.ch + "–" + (b.ch + 1) + " stereo" + pairName(names, b.ch) : names[b.ch - 1] || "Output " + b.ch; }
  function presetOf(r) { var hit = Object.keys(PRESET_ROUTES).filter(function (k) { var p = PRESET_ROUTES[k]; return BUSES.every(function (b) { var x = r.buses[b[0]] || {}; return (x.ch || 0) === p[b[0]].ch && !!x.st === p[b[0]].st; }); })[0]; return hit || "custom"; }
  function sharing(r, bus) {   // the other buses on (part of) the same outputs
    var me = r.buses[bus]; if (!me || !me.ch) return [];
    var mine = me.st ? [me.ch, me.ch + 1] : [me.ch];
    return BUSES.filter(function (b) { if (b[0] === bus) return false; var o = r.buses[b[0]]; if (!o || !o.ch) return false; var theirs = o.st ? [o.ch, o.ch + 1] : [o.ch]; return theirs.some(function (c) { return mine.indexOf(c) >= 0; }); }).map(function (b) { return b[1]; });
  }
  function renderRouting(into) {
    var root = into || $("#routingMatrix"); if (!root) return;
    var r = project().routing, n = channelNames().length, opts = routeOptions(n), live = engine.routing || {}, pre = presetOf(r), avail = realOutputs(), st = F.systemStatus && F.systemStatus();
    root.innerHTML = '<div class="rt-mode"><span class="muted">Quick set-ups:</span>' +
      '<button class="' + (pre === "mono4" ? "on" : "") + '" data-rtpreset="mono4" title="1 tracks · 2 pads · 3 click + voice · 4 instrument">4 mono outputs</button>' +
      '<button class="' + (pre === "stereo2" ? "on" : "") + '" data-rtpreset="stereo2" title="Tracks + pads on 1–2 · click + instrument on 3–4">2 stereo outputs</button>' +
      '<button class="' + (pre === "all12" ? "on" : "") + '" data-rtpreset="all12" title="Tracks, pads, click and instrument together on 1–2 (the headphone jack)">Everything on 1–2</button>' +
      (pre === "custom" ? '<span class="rt-custom">Your own</span>' : "") + "</div>" +
      '<table class="rt-table"><thead><tr><th>Bus</th><th>Goes to</th><th>Now</th></tr></thead><tbody>' +
      BUSES.map(function (b) {
        var bus = r.buses[b[0]] || { ch: 0 }, shared = sharing(r, b[0]), now = b[0] === "instrument" ? (connected() ? (bus.ch > 0 ? busOut(bus) : "off") : "on the Pi only") : (live.buses && live.buses[b[0]] ? (live.buses[b[0]] === "off" ? "off" : live.buses[b[0]]) : "—");
        var missing = bus.ch > 0 && bus.ch > avail && !(b[0] === "instrument" && !connected()) && !(b[0] === "click" && live.mode === "stereo2" && (r.clickFallback || "mix") !== "mix");
        if (missing) now = "1–2 · " + (bus.st ? bus.ch + "–" + (bus.ch + 1) + " aren't" : bus.ch + " isn't") + " connected";
        var cur = busValue(bus), has = opts.some(function (o) { return o.v === cur; });
        return '<tr><td><b>' + b[1] + '</b><br><small>' + b[2] + '</small></td><td><select data-rt="' + b[0] + '">' + (has ? "" : '<option value="' + cur + '" selected>' + esc(busOut(bus)) + " (not connected)</option>") +
          '<optgroup label="One output (mono)">' + opts.filter(function (o) { return !o.st; }).map(function (o) { return '<option value="' + o.v + '"' + (o.v === cur ? " selected" : "") + ">" + esc(o.label) + "</option>"; }).join("") + "</optgroup>" +
          (n >= 2 ? '<optgroup label="A pair (stereo)">' + opts.filter(function (o) { return o.st; }).map(function (o) { return '<option value="' + o.v + '"' + (o.v === cur ? " selected" : "") + ">" + esc(o.label) + "</option>"; }).join("") + "</optgroup>" : "") +
          "</select>" + (shared.length ? '<br><small class="rt-shared">mixed with ' + esc(shared.join(" and ")) + "</small>" : "") + "</td><td>" + esc(now) + "</td></tr>";
      }).join("") + looperRow(r, opts, n, live, avail) + "</tbody></table>" +
      '<p class="muted">' + (avail <= 2 ? (onPi() ? "Right now this Central Pedal only has its headphone jack (outputs 1–2), so everything plays there. " : "This device has 2 outputs, so everything plays on 1–2. ") + "Anything set to an output that isn't there is played on 1–2 instead. With a DAC board, 3–4 are its outputs; a USB audio interface adds 5 and up." : "1–2 are the headphone jack (left, right) and 3–4 the DAC board. A USB audio interface adds its outputs from 5 up as soon as it's plugged in. Parts sent to the same output are mixed together, and anything set to an output that isn't there plays on 1–2.") + "</p>" +
      (onPi() ? '<label class="toggle rt-dac"><input type="checkbox" data-rtdac' + (st && st.i2sDac !== false ? " checked" : "") + "> A DAC board is fitted (outputs 3–4) <small class=\"muted\">- a DAC board can't be found by itself; leave this off when there's none, so nothing is sent to it</small></label>" : "");
  }
  // the looper (LOOPER tab): on the instrument's output, or one of its own
  function looperRow(r, opts, n, live, avail) {
    var bus = r.buses.looper || { follow: true }, follow = bus.follow !== false, cur = follow ? "f" : busValue(bus), ins = r.buses.instrument || { ch: 0 };
    var eff = follow ? ins : bus, now = live.buses && live.buses.looper ? (live.buses.looper === "off" ? "off" : live.buses.looper) : (eff.ch > 0 ? busOut(eff) : "off");
    if (eff.ch > 0 && eff.ch > avail) now = "1–2 · " + (eff.st ? eff.ch + "–" + (eff.ch + 1) + " aren't" : eff.ch + " isn't") + " connected";
    return '<tr><td><b>Looper</b><br><small>the loop pedal (LOOPER tab)</small></td><td><select data-rt="looper"><option value="f"' + (follow ? " selected" : "") + ">Same as Instrument (" + esc(busOut(ins)) + ")</option>" +
      '<optgroup label="One output (mono)">' + opts.filter(function (o) { return !o.st; }).map(function (o) { return '<option value="' + o.v + '"' + (o.v === cur ? " selected" : "") + ">" + esc(o.label) + "</option>"; }).join("") + "</optgroup>" +
      (n >= 2 ? '<optgroup label="A pair (stereo)">' + opts.filter(function (o) { return o.st; }).map(function (o) { return '<option value="' + o.v + '"' + (o.v === cur ? " selected" : "") + ">" + esc(o.label) + "</option>"; }).join("") + "</optgroup>" : "") +
      "</select></td><td>" + esc(now) + "</td></tr>";
  }
  function setBus(bus, v) {
    var r = project().routing, s = String(v || "0");
    if (bus === "looper") { r.buses.looper = s === "f" ? { follow: true } : { ch: parseInt(s, 10) || 0, st: /s$/.test(s), follow: false }; return; }
    r.buses[bus] = { ch: parseInt(s, 10) || 0, st: /s$/.test(s) }; r.mode = presetOf(r);
  }
  function applyRouting() { var r = project().routing; engine.routeOutput(); PP.persistSoon(); renderRouting(); if (window.PPIO) window.PPIO.render(); send({ type: "routing", routing: r }); }   // (the Pi links the native instrument chain to its output)
  function onRouting(e) {
    var el = e.target, r = project().routing;
    if (el.dataset && el.dataset.rtpreset) { var p = PRESET_ROUTES[el.dataset.rtpreset]; BUSES.forEach(function (b) { r.buses[b[0]] = { ch: p[b[0]].ch, st: p[b[0]].st }; }); r.mode = el.dataset.rtpreset; }
    else if (el.dataset && el.dataset.rt) setBus(el.dataset.rt, el.value);
    else return;
    applyRouting();
  }
  document.addEventListener("click", function (e) { var b = e.target.closest && e.target.closest("[data-rtpreset]"); if (b) onRouting({ target: b }); });
  document.addEventListener("change", function (e) {   // the DAC board (outputs 3-4): the outputs are made again at once
    var el = e.target; if (!el || !el.hasAttribute || !el.hasAttribute("data-rtdac")) return;
    send({ type: "system", action: "dac", value: el.checked ? "on" : "off" });
    PP.setStatus(el.checked ? "DAC board on - setting up outputs 3–4 now…" : "DAC board off - everything goes to the headphone jack (1–2) now…");
  });
  F.on("audioReapplied", function (m) { PP.setStatus(m.ok ? "Outputs ready." : "Couldn't set up the outputs: " + (m.message || "")); renderRouting(); });

  // a USB audio interface plugged in (or out) while the pedal is on: the outputs are made again by themselves - at once
  // when nothing plays, else as soon as the music stops (the sound engine starts again with the new outputs)
  var devWait = null;
  function playingNow() { var T = window.PPTracks; return !!((T && T.isPlaying && T.isPlaying()) || (engine.voices && engine.voices().length)); }
  function reapplyNow() { if (devWait) { clearInterval(devWait); devWait = null; } PP.setStatus("Setting up the outputs…"); send({ type: "system", action: "reapplyAudio" }); }
  F.on("audioDevicesChanged", function (m) {
    var bar = document.getElementById("audioDevBar");
    if (m.settled || !m.message) { if (bar) bar.remove(); return; }
    if (!connected() || !onPi()) return;
    if (!playingNow()) { if (bar) bar.remove(); reapplyNow(); return; }
    if (!bar) { bar = document.createElement("div"); bar.id = "audioDevBar"; bar.className = "audio-dev-bar"; document.body.appendChild(bar); }
    bar.innerHTML = "<span>" + esc(m.message.replace(/restart the screens to use (its|them)[^.]*\.?/i, "it's used as soon as the music stops.")) + '</span><button class="primary" data-adb="now">Use it now</button><button data-adb="later">Later</button>';
    bar.onclick = function (e) { var b = e.target.closest("[data-adb]"); if (!b) return; if (b.dataset.adb === "now") reapplyNow(); else if (devWait) { clearInterval(devWait); devWait = null; } bar.remove(); };
    if (!devWait) devWait = setInterval(function () { if (!playingNow()) { var b = document.getElementById("audioDevBar"); if (b) b.remove(); reapplyNow(); } }, 1500);
  });
  F.on("audioReapplied", function (m) {   // the sound engine starts again on the new outputs (its channel count is fixed when it starts)
    if (!m.ok || !m.reload || playingNow()) return;
    PP.persistNow(); setTimeout(function () { location.reload(); }, 300);
  });

  // the small touch screen's Settings: step a bus through Off, every output, every stereo pair
  function stepBus(bus, delta) {
    var r = project().routing; if (!BUSES.some(function (b) { return b[0] === bus; })) return false;
    var opts = routeOptions(channelNames().length), i = opts.map(function (o) { return o.v; }).indexOf(busValue(r.buses[bus]));
    var o = opts[((i < 0 ? 0 : i) + (delta < 0 ? -1 : 1) + opts.length) % opts.length];
    setBus(bus, o.v); applyRouting(); return true;
  }
  function routingSummary() { var r = project().routing; return { mode: presetOf(r), buses: BUSES.map(function (b) { var x = r.buses[b[0]] || {}; return { id: b[0], name: b[1], ch: x.ch || 0, st: !!x.st, out: busOut(x), shared: sharing(r, b[0]) }; }) }; }

  // ------------------------------------------------------------- sub-navigation
  // Settings is one group at a time (10.0.1): a list down the left, the group's cards on the right in tidy columns. (The
  // old "All" page put every card on one wall with big gaps and small text.) Each card's data-st says its group.
  var GROUPS = [["audio", "Sound", ["audio"]], ["look", "Appearance", ["look"]], ["setups", "Saved setups", ["setups"]], ["screens", "Screens & touch", ["screens"]],
    ["midi", "MIDI, tempo & Stream Deck", ["midi"]], ["network", "Wi-Fi & devices", ["network"]], ["packages", "Packages & key", ["packages", "license", "libraries"]],
    ["software", "Updates & backup", ["software"]], ["system", "System", ["system"]]];
  var group = "audio";
  try { var g0 = localStorage.getItem("pad-pedal-st-group"); if (g0 && GROUPS.some(function (g) { return g[0] === g0; })) group = g0; } catch (_) { }
  function groupOf(st) { var hit = GROUPS.filter(function (g) { return g[2].indexOf(st) >= 0; })[0]; return hit ? hit[0] : "system"; }
  function renderNav() {
    var nav = $("#stNav"); if (!nav) return;
    var cards = document.querySelectorAll("#systemDialog > section, #sysExtra > section"), has = {};
    cards.forEach(function (sec) { var g = groupOf(sec.dataset.st || ""); has[g] = true; sec.classList.toggle("hidden", g !== group); });
    if (!has[group] && cards.length) { group = "audio"; cards.forEach(function (sec) { sec.classList.toggle("hidden", groupOf(sec.dataset.st || "") !== group); }); }
    // a group with a wide card (the routing table, updates…): every card full width, one under the other - a wide card
    // in the middle of two columns leaves an empty half beside the card before it
    var grid = $("#systemDialog"), wide = false;
    cards.forEach(function (sec) { if (!sec.classList.contains("hidden") && sec.classList.contains("wide")) wide = true; });
    if (grid) grid.classList.toggle("one-col", wide);
    nav.innerHTML = GROUPS.filter(function (g) { return has[g[0]] || !cards.length; }).map(function (g) { return '<button class="st-chip' + (group === g[0] ? " on" : "") + '" data-st-group="' + g[0] + '">' + g[1] + "</button>"; }).join("");
  }

  // ------------------------------------------------------------- backup / restore / software update (USB stick)
  var MEDIA = "http://127.0.0.1:8766", bk = { mode: null, drives: [], busy: false };
  function fmtSize(n) { return n > 1073741824 ? (n / 1073741824).toFixed(2) + " GB" : n > 1048576 ? Math.round(n / 1048576) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB"; }
  async function bkDrives() { try { var r = await (await fetch(MEDIA + "/roots", { cache: "no-store" })).json(); return (r.dirs || []).filter(function (d) { return !/Wi-Fi|uploads|library/i.test(d.name); }); } catch (_) { return []; } }
  async function bkShow(mode) {
    var list = $("#bkList"); if (!list) return;
    bk.mode = mode;
    if (!connected()) { list.innerHTML = '<p class="muted">Backups work on the Central Pedal itself (the files live on its /data partition).</p>'; return; }
    list.innerHTML = '<p class="muted">Looking at the USB stick…</p>';
    if (mode === "backup") {
      var drives = await bkDrives();
      list.innerHTML = drives.length ? '<p class="muted">Back up to:</p>' + drives.map(function (d) { return '<button data-bk-to="' + esc(d.path) + '">💾 ' + esc(d.name) + "</button>"; }).join(" ") : '<p class="muted">No USB stick or SD card found. Plug one in and press Look again.</p>';
      return;
    }
    try {
      var r = await (await fetch(MEDIA + (mode === "restore" ? "/backups" : "/updates"), { cache: "no-store" })).json(), rows = [];
      (r.drives || []).forEach(function (d) { (d.files || []).forEach(function (f) { rows.push('<button data-bk-' + mode + '="' + esc(f.path) + '"><b>' + esc(f.name) + "</b><small>" + esc(d.drive) + " · " + fmtSize(f.size) + " · " + esc(f.date) + "</small></button>"); }); });
      list.innerHTML = rows.length ? '<p class="muted">' + (mode === "restore" ? "Restore which backup? Songs, tracks, charts, sounds and settings on this Central Pedal are replaced by the backup's." : "Install which version? The app and driver are replaced; your songs and settings stay.") + "</p>" + rows.join("")
        : '<p class="muted">' + (mode === "restore" ? "No central-control-backup-*.zip on the USB stick." : "No central-control-source zip on the USB stick (put the zip in its top folder or in a \"Central Control\" folder).") + "</p>";
    } catch (e) { list.innerHTML = '<p class="muted">Could not read the USB stick: ' + esc(e.message) + "</p>"; }
  }
  async function bkRun(url, body, label) {
    if (bk.busy) return null; bk.busy = true; PP.setStatus(label + "…");
    try { var r = await fetch(MEDIA + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }), j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || r.status); return j; }
    catch (e) { PP.setStatus(label + " failed: " + e.message); $("#bkList").innerHTML = '<p class="muted">' + esc(label + " failed: " + e.message) + "</p>"; return null; }
    finally { bk.busy = false; }
  }
  async function bkBackupTo(path) {
    PP.persistNow(); PP.mirrorNow();
    $("#bkList").innerHTML = '<p class="muted">Backing up… this takes a while with many tracks (the stick is slow). Don\'t unplug it.</p>';
    var j = await bkRun("/backup", { path: path }, "Backup");
    if (j) { $("#bkList").innerHTML = '<p class="muted">✓ Backup written: <b>' + esc(j.file.split("/").pop()) + "</b> (" + fmtSize(j.size) + "). Safe to unplug after a few seconds.</p>"; PP.setStatus("Backup written to the USB stick."); }
  }
  async function bkRestoreFrom(path) {
    if (!confirm("Restore " + path.split("/").pop() + "?\n\nThe songs, tracks, charts, sounds and settings on this Central Pedal are replaced by the backup. The screen restarts afterwards.")) return;
    $("#bkList").innerHTML = '<p class="muted">Restoring…</p>';
    var j = await bkRun("/restore", { file: path }, "Restore");
    if (!j) return;
    try {
      var r = await fetch(MEDIA + "/project", { cache: "no-store" }), proj = r.ok ? await r.json() : null;
      if (proj && Array.isArray(proj.pads)) localStorage.setItem("pad-pedal-seamless-v3", JSON.stringify(proj));
      // the decoded tracks come back from the library as songs are opened; drop the old decoded copies
      if (window.indexedDB) await new Promise(function (res) { var q = indexedDB.deleteDatabase("pad-pedal-tracks-v1"); q.onsuccess = q.onerror = q.onblocked = res; });
    } catch (_) {}
    PP.setStatus("Restored " + j.files + " files - restarting the screen…");
    setTimeout(function () { location.reload(); }, 800);
  }
  async function bkUpdateFrom(path) {
    if (!confirm("Install " + path.split("/").pop() + "?\n\nThe app and the driver are replaced (your songs and settings stay). The screen restarts when it is done.")) return;
    $("#bkList").innerHTML = '<p class="muted">Installing… the screen restarts by itself when the driver is back.</p>';
    PP.persistNow(); PP.mirrorNow();
    var j = await bkRun("/update", { file: path }, "Update");
    if (j && j.ok) { PP.setStatus("Updated: " + (j.message || "") + " - restarting…"); setTimeout(function () { location.reload(); }, 6000); }
  }

  function render() { renderPresets(); renderAudio(); renderRouting(); renderNav(); if (window.PPColors) window.PPColors.render(); if (bk.mode) bkShow(bk.mode); }
  function wire() {
    var root = $("#tabSettings"); if (!root) return;
    root.addEventListener("click", function (e) {
      var b = e.target.closest("[data-preset],[data-rt-test],[data-st-group],#audioApply,#bkBackup,#bkRestore,#bkUpdate,#bkRefresh,[data-bk-to],[data-bk-restore],[data-bk-update]"); if (!b) return;
      if (b.id === "bkBackup") bkShow("backup"); else if (b.id === "bkRestore") bkShow("restore"); else if (b.id === "bkUpdate") bkShow("update"); else if (b.id === "bkRefresh") bkShow(bk.mode || "backup");
      else if (b.dataset.bkTo) bkBackupTo(b.dataset.bkTo); else if (b.dataset.bkRestore) bkRestoreFrom(b.dataset.bkRestore); else if (b.dataset.bkUpdate) bkUpdateFrom(b.dataset.bkUpdate);
      else if (b.dataset.preset != null) {   // a preset sets every screen colour (the ones it doesn't name come from the ones it does)
        var pt = PRESETS[Number(b.dataset.preset)].theme;
        project().theme = window.CCTheme ? Object.assign(window.CCTheme.derive(pt, "pedal"), pt) : Object.assign(project().theme || {}, pt);
        PP.applyTheme(); PP.persistSoon(); renderPresets(); if (window.PPColors) { window.PPColors.render(); window.PPColors.apply(); }
      }
      else if (b.dataset.rtTest) engine.testBus(b.dataset.rtTest);
      else if (b.dataset.stGroup) { group = b.dataset.stGroup; try { localStorage.setItem("pad-pedal-st-group", group); } catch (_) { } renderNav(); var t = $("#tabSettings"); if (t && t.scrollIntoView) t.scrollTop = 0; window.scrollTo(0, 0); }
      else if (b.id === "audioApply") { PP.persistNow(); PP.setStatus("Restarting the audio engine…"); setTimeout(function () { location.reload(); }, 150); }
    });
    root.addEventListener("change", function (e) {
      var el = e.target;
      if (el.id === "audioRate") { project().audio.sampleRate = Number(el.value) || 0; PP.persistSoon(); }
      else if (el.id === "audioLatency") { project().audio.latency = el.value; PP.persistSoon(); }
      else if (el.id === "uiScale") { project().ui = project().ui || {}; project().ui.scale = Number(el.value) || 1; applyScale(); PP.persistSoon(); }
      else if (el.name === "rtMode" || el.dataset.rt) onRouting(e);
    });
    document.addEventListener("pp-routing", function () { if (window.PPShell && window.PPShell.currentTab() === "settings") renderRouting(); });
    F.on("systemStatus", function () { if (window.PPShell && window.PPShell.currentTab() === "settings") { renderRouting(); renderNav(); } });
  }
  wire(); applyScale();
  F.on("update", function (m) { if (m.state === "failed") PP.setStatus("Update failed: " + (m.message || "")); });
  function showGroup(g) {   // open Settings at a group (a card's data-st works too: "network", "libraries"…)
    var hit = GROUPS.filter(function (x) { return x[0] === g; })[0] || GROUPS.filter(function (x) { return x[2].indexOf(g) >= 0; })[0];
    if (!hit) return false;
    group = hit[0]; try { localStorage.setItem("pad-pedal-st-group", group); } catch (_) { }
    if (window.PPShell && window.PPShell.currentTab && window.PPShell.currentTab() !== "settings") window.PPShell.showTab("settings");
    renderNav(); return true;
  }
  window.PPSettings = { showGroup: showGroup, stepBus: stepBus, routingSummary: routingSummary, render: render, applyScale: applyScale, presets: PRESETS, renderRouting: renderRouting, onRouting: onRouting, channelNames: channelNames, backup: bkShow };
})();
