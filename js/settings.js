/* Central Control - the Settings tab: appearance (colour presets, size), the
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
  var BUSES = [["tracks", "Tracks", "songs / stems (mono sum)"], ["pad", "Pads", "pads + textures + audio input"], ["click", "Click + MD voice", "metronome and spoken cues (in-ears)"], ["instrument", "Instrument", "guitar / keys (native chain on the Pi)"]];
  function channelNames() {
    var st = F.systemStatus && F.systemStatus(), list = st && st.audio && st.audio.channels;
    var n = Math.max(engine.ctx ? (engine.ctx.destination.maxChannelCount || 2) : 2, list ? list.length : 0, 4);
    var out = []; for (var i = 1; i <= n; i++) out.push(list && list[i - 1] ? i + " · " + list[i - 1] : "Output " + i);
    return out;
  }
  function renderRouting(into) {
    var root = into || $("#routingMatrix"); if (!root) return;
    var r = project().routing, names = channelNames(), live = engine.routing || {}, stereo = r.mode === "stereo";
    root.innerHTML = '<div class="rt-mode"><label class="toggle"><input type="radio" name="rtMode" value="mono4"' + (!stereo ? " checked" : "") + "> Four mono outputs (recommended)</label><label class=\"toggle\"><input type=\"radio\" name=\"rtMode\" value=\"stereo\"" + (stereo ? " checked" : "") + "> Stereo pairs (each bus on two outputs)</label></div>" +
      '<table class="rt-table"><thead><tr><th>Bus</th><th>Output' + (stereo ? "s" : "") + "</th><th>Now</th><th></th></tr></thead><tbody>" +
      BUSES.map(function (b) {
        var ch = r.buses[b[0]] ? r.buses[b[0]].ch : 0, now = b[0] === "instrument" ? (connected() ? (ch > 0 ? "channel " + ch + (stereo ? "-" + (ch + 1) : "") : "off") : "on the Pi only") : (live.buses && live.buses[b[0]] ? (live.buses[b[0]] === "off" ? "off" : "channel " + live.buses[b[0]]) : "—");
        return '<tr><td><b>' + b[1] + '</b><br><small>' + b[2] + '</small></td><td><select data-rt="' + b[0] + '"><option value="0"' + (ch === 0 ? " selected" : "") + ">Off</option>" + names.map(function (n, i) { var c = i + 1; if (stereo && c + 1 > names.length) return ""; return '<option value="' + c + '"' + (ch === c ? " selected" : "") + ">" + esc(stereo ? c + "-" + (c + 1) + " · " + n.replace(/^\d+ · /, "") : n) + "</option>"; }).join("") + "</select></td><td><small>" + esc(now) + "</small></td><td>" + (b[0] === "instrument" ? "" : '<button data-rt-test="' + b[0] + '" title="Half a second of tone on this bus">♪ Test</button>') + "</td></tr>";
      }).join("") + "</tbody></table>" +
      '<p class="muted">' + (live.mode === "stereo2" ? "This device only has 2 outputs: tracks and pads share them; the click uses the fallback chosen under Output device. On the Central Control the jack + DAC (+ USB interface) give 4 or more." : "Default cables: 1 = headphone jack left (tracks), 2 = jack right (pads), 3 = DAC left (click + voice to the in-ear mix), 4 = DAC right (instrument). A USB interface adds channels 5 and up.") + "</p>";
  }
  function onRouting(e) {
    var el = e.target, r = project().routing;
    if (el.name === "rtMode") { r.mode = el.value; }
    else if (el.dataset.rt) { r.buses[el.dataset.rt] = { ch: Number(el.value) || 0 }; }
    else return;
    engine.routeOutput(); PP.persistSoon(); renderRouting(); if (window.PPIO) window.PPIO.render();
    send({ type: "routing", routing: r }); // the Pi links the native instrument chain to its channel
  }

  // ------------------------------------------------------------- sub-navigation
  var GROUPS = [["all", "All"], ["look", "Appearance"], ["setups", "Saved setups"], ["audio", "Audio"], ["midi", "MIDI & tempo"], ["screens", "Screens"], ["network", "Wi-Fi & devices"], ["system", "System"]];
  var group = "all";
  function renderNav() {
    var nav = $("#stNav"); if (!nav) return;
    nav.innerHTML = GROUPS.map(function (g) { return '<button class="st-chip' + (group === g[0] ? " on" : "") + '" data-st-group="' + g[0] + '">' + g[1] + "</button>"; }).join("");
    document.querySelectorAll("#systemDialog > section, #sysExtra > section").forEach(function (sec) { sec.classList.toggle("hidden", group !== "all" && sec.dataset.st !== group); });
  }

  // ------------------------------------------------------------- backup / restore / software update (USB stick)
  var MEDIA = "http://127.0.0.1:8766", bk = { mode: null, drives: [], busy: false };
  function fmtSize(n) { return n > 1073741824 ? (n / 1073741824).toFixed(2) + " GB" : n > 1048576 ? Math.round(n / 1048576) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB"; }
  async function bkDrives() { try { var r = await (await fetch(MEDIA + "/roots", { cache: "no-store" })).json(); return (r.dirs || []).filter(function (d) { return !/Wi-Fi|uploads|library/i.test(d.name); }); } catch (_) { return []; } }
  async function bkShow(mode) {
    var list = $("#bkList"); if (!list) return;
    bk.mode = mode;
    if (!connected()) { list.innerHTML = '<p class="muted">Backups work on the Central Control itself (the files live on its /data partition).</p>'; return; }
    list.innerHTML = '<p class="muted">Looking at the USB stick…</p>';
    if (mode === "backup") {
      var drives = await bkDrives();
      list.innerHTML = drives.length ? '<p class="muted">Back up to:</p>' + drives.map(function (d) { return '<button data-bk-to="' + esc(d.path) + '">💾 ' + esc(d.name) + "</button>"; }).join(" ") : '<p class="muted">No USB stick or SD card found. Plug one in and press Look again.</p>';
      return;
    }
    try {
      var r = await (await fetch(MEDIA + (mode === "restore" ? "/backups" : "/updates"), { cache: "no-store" })).json(), rows = [];
      (r.drives || []).forEach(function (d) { (d.files || []).forEach(function (f) { rows.push('<button data-bk-' + mode + '="' + esc(f.path) + '"><b>' + esc(f.name) + "</b><small>" + esc(d.drive) + " · " + fmtSize(f.size) + " · " + esc(f.date) + "</small></button>"); }); });
      list.innerHTML = rows.length ? '<p class="muted">' + (mode === "restore" ? "Restore which backup? Songs, tracks, charts, sounds and settings on this Central Control are replaced by the backup's." : "Install which version? The app and driver are replaced; your songs and settings stay.") + "</p>" + rows.join("")
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
    if (!confirm("Restore " + path.split("/").pop() + "?\n\nThe songs, tracks, charts, sounds and settings on this Central Control are replaced by the backup. The screen restarts afterwards.")) return;
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
      else if (b.dataset.preset != null) { Object.assign(project().theme, PRESETS[Number(b.dataset.preset)].theme); PP.applyTheme(); PP.persistSoon(); renderPresets(); if (window.PPColors) window.PPColors.render(); }
      else if (b.dataset.rtTest) engine.testBus(b.dataset.rtTest);
      else if (b.dataset.stGroup) { group = b.dataset.stGroup; renderNav(); }
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
  window.PPSettings = { render: render, presets: PRESETS, renderRouting: renderRouting, onRouting: onRouting, channelNames: channelNames, backup: bkShow };
})();
