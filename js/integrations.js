/* Central Pedal - outside connections: ProPresenter (slides follow the sections) and software updates
 * (a daily look at the release page; installing is always your tap, and never while anything is playing). */
(function () {
  "use strict";
  var PP = window.PP, F = window.PPFeatures; if (!PP || !F) return;
  var esc = PP.escapeHtml;
  function $(s) { return document.querySelector(s); }
  function bridge() { return window.__pedalBridge; }
  function connected() { return !!(bridge() && bridge().connected); }
  function send(m) { return bridge() && bridge().send ? bridge().send(m) : false; }
  function project() { return PP.project(); }

  // ------------------------------------------------------------- ProPresenter
  var pp = { enabled: false, host: "", port: 1025, openSong: true, ok: null, error: null, version: null };
  function renderPP() {
    if (!$("#ppOn")) return;
    $("#ppOn").checked = !!pp.enabled; $("#ppHost").value = pp.host || ""; $("#ppPort").value = pp.port || 1025; $("#ppOpenSong").checked = pp.openSong !== false;
    $("#ppState").textContent = !connected() ? "ProPresenter control runs on the Central Pedal." : !pp.enabled ? "Off." : pp.ok === true ? "Connected" + (pp.version ? " · " + pp.version : "") + "." : pp.ok === false ? "Not reachable: " + (pp.error || "") : "Not tested yet.";
  }
  F.on("propresenterStatus", function (m) { Object.assign(pp, m); renderPP(); });
  F.on("hello", function () { send({ type: "propresenter", action: "status" }); upSend("status"); });
  document.addEventListener("click", function (e) {
    if (e.target.id === "ppTest") { send({ type: "propresenter", action: "config", config: { enabled: $("#ppOn").checked, host: $("#ppHost").value.trim(), port: Number($("#ppPort").value) || 1025, openSong: $("#ppOpenSong").checked } }); $("#ppState").textContent = "Testing…"; }
  });
  F.onSong(function (s) { if (s && pp.enabled) send({ type: "propresenter", action: "song", song: s.name, presentation: s.presentation || s.name }); });

  // ------------------------------------------------------------- updates
  // On the Pi the driver looks for central-control-source.zip; in the PC app (Electron) the app updates its own package.
  var DESK = window.CCDesktop && window.CCDesktop.updates;
  function upSend(action, cfg) {
    if (!DESK) return send({ type: "updates", action: action, config: cfg });
    var p = action === "config" ? DESK.config(cfg) : action === "check" ? DESK.check() : action === "install" ? DESK.install() : DESK.status();
    p.then(function (r) { if (r && r.current) { var d = up.dismissed && up.latest === r.latest; Object.assign(up, r); up.dismissed = d; } else if (r && r.ok === false) up.error = r.error; up.busy = false; renderUpd(); });
  }
  if (DESK) DESK.on(function (r) { Object.assign(up, r); renderUpd(); });
  var up = { current: null, available: false, latest: null, busy: false, error: null, repo: "", auto: true };
  function busyPlaying() { var T = window.PPTracks; return !!((T && T.isPlaying()) || (PP.engine && PP.engine.voices && PP.engine.voices().length)); }
  function renderUpd() {
    if ($("#updRepo") && document.activeElement !== $("#updRepo")) $("#updRepo").value = up.repo || "";
    if ($("#updAuto")) $("#updAuto").checked = up.auto !== false;
    if ($("#updAutoInstall")) $("#updAutoInstall").checked = up.autoInstall !== false;
    var info = $("#updInfo"); if (info) info.textContent = "This Central Pedal: version " + (up.current || "?") + (up.lastCheck ? " · last checked " + new Date(up.lastCheck * 1000).toLocaleString() : "") + ".";
    var st = $("#updState");
    if (st) {
      st.textContent = up.busy ? (up.phaseText ? up.phaseText : up.installing || up.progress ? (up.progress && up.progress < 1 ? "Downloading… " + Math.round(up.progress * 100) + "%" : "Downloading and installing - the app restarts by itself in a minute or two…") : "Looking for a new version…") : up.error ? (DESK ? String(up.error) : plainError(up.error)) : up.available ? "Version " + up.latest + " is available." + (up.notes ? " " + up.notes.split("\n")[0].slice(0, 160) : "") : up.latest ? "Up to date (version " + up.latest + " is the newest)." : "";
      st.classList.toggle("warn", !!up.error && !up.busy);
      var again = $("#updAgain");
      if (up.error && !up.busy) { if (!again) { again = document.createElement("button"); again.id = "updAgain"; again.textContent = "Try again"; st.insertAdjacentElement("afterend", again); } again.classList.remove("hidden"); }
      else if (again) again.classList.add("hidden");
    }
    var ib = $("#updInstall"); if (ib) { ib.classList.toggle("hidden", !up.available); ib.disabled = !!up.busy; }
    autoStart();
    askIfNew();
    var b = banner(); b.classList.toggle("hidden", !(up.available && !up.dismissed && !(askEl && askEl.open)));
    b.innerHTML = '<b>Update ' + esc(up.latest || "") + ' is ready</b><span>' + (busyPlaying() ? "Install it after the service (stop the pads and tracks first)." : "Installs in about a minute; your songs and settings stay.") + '</span><button class="primary" data-upd="install"' + (up.busy || busyPlaying() ? " disabled" : "") + '>' + (up.busy ? "Installing…" : "Install") + '</button><button data-upd="later">Later</button>';
  }
  // a newer version installs by itself after a 10-second notice ("Not now" skips that version until the app opens
  // again): when the app opens, or later when it's found (the pedal looks every few hours) - but only once nothing has
  // played for a minute, never in the middle of a song.
  var autoDecided = false, autoFor = null, autoTimer = null, autoLeft = 0, lastPlaying = 0;
  function autoStart() {
    if (busyPlaying()) lastPlaying = Date.now();
    if (autoDecided || autoTimer || !up.current) return;
    if (/[?&]player=1/.test(location.search) || (!DESK && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname))) { autoDecided = true; return; }   // only the pedal's own screen (or this computer's app) installs
    if (!up.available || up.busy || up.auto === false || up.autoInstall === false || up.dismissed || autoFor === up.latest) return;
    if (busyPlaying() || Date.now() - lastPlaying < 60000) return;   // (waits for a quiet minute, then it goes)
    autoFor = up.latest;
    makeAsk(); asked = up.latest; autoLeft = 10;
    function paint() {
      askEl.innerHTML = '<h2>Updating Central Pedal</h2><p><b>Version ' + esc(up.latest || "") + '</b> installs in ' + autoLeft + ' s, then the app restarts (this one is ' + esc(up.current || "?") + ').</p>' +
        '<p class="muted small">Your songs, setlists and settings stay. Turn this off in Settings → Software updates.</p>' +
        '<div class="row"><button class="primary" data-ask="yes">Update now</button><button data-ask="no">Not now</button></div>';
    }
    paint(); if (!askEl.open) askEl.showModal();
    autoTimer = setInterval(function () {
      if (!askEl.open) { stopAuto(); return; }   // "Not now" / Escape
      if (busyPlaying()) { stopAuto(); askEl.close(); asked = null; renderUpd(); return; }   // something started playing: ask instead
      autoLeft--; if (autoLeft > 0) return paint();
      stopAuto(); askEl.close(); install(true);
    }, 1000);
  }
  // the update's error in words a person can act on (the full text stays in the pedal's log)
  function plainError(e) {
    e = String(e || "");
    if (/name resolution|getaddrinfo|resolve|no internet|network is unreachable|timed out|timeout|urlopen|connection/i.test(e)) return "Couldn't reach the update server - check the pedal is on the internet (Settings → Wi-Fi), then Try again.";
    if (/checksum|damaged/i.test(e)) return "The download came in damaged - nothing was changed. Try again.";
    if (/no central-control-source/i.test(e)) return "That version has no update for the pedal yet. Try again later.";
    if (/space|no space left/i.test(e)) return "The pedal is out of space for the update. Remove some songs or tracks, then Try again.";
    if (/sudo|permission|not allowed/i.test(e)) return "The pedal couldn't install the update (" + e.slice(0, 120) + "). Try again; if it keeps failing, use Install from a USB stick.";
    return "The update didn't install: " + e.slice(0, 200) + " - Try again.";
  }
  function stopAuto() { if (autoTimer) { clearInterval(autoTimer); autoTimer = null; } }
  // "Update available - update now?" Yes installs, No asks again the next time the app opens
  var askEl = null, asked = null;
  function makeAsk() {
    if (askEl) return;
    askEl = document.createElement("dialog"); askEl.id = "updAsk"; askEl.className = "upd-ask"; document.body.appendChild(askEl);
    askEl.addEventListener("click", function (e) { var b = e.target.closest("[data-ask]"); if (!b) return; stopAuto(); if (b.dataset.ask === "yes") { askEl.close(); install(true); } else { askEl.close(); up.dismissed = true; renderUpd(); } });
    askEl.addEventListener("cancel", function () { stopAuto(); up.dismissed = true; setTimeout(renderUpd, 0); });
  }
  function askIfNew() {
    if (autoTimer) return;
    if (!up.available || up.busy || up.auto === false || up.dismissed || asked === up.latest) { if (askEl && askEl.open) paintAsk(); return; }
    asked = up.latest;
    makeAsk();
    paintAsk(); if (!askEl.open) askEl.showModal();
  }
  function paintAsk() {
    var playing = busyPlaying();
    askEl.innerHTML = '<h2>Update available</h2><p><b>Central Pedal ' + esc(up.latest || "") + '</b> is ready (this one is ' + esc(up.current || "?") + ').</p>' +
      (up.notes ? '<p class="muted small">' + esc(up.notes.replace(/[#*]/g, "").split("\n").filter(Boolean).slice(0, 3).join(" · ").slice(0, 260)) + "</p>" : "") +
      "<p>" + (playing ? "Stop the pads and tracks first - updates never install while something plays." : "Want to update now? It takes about a minute; your songs and settings stay.") + "</p>" +
      '<div class="row"><button class="primary" data-ask="yes"' + (playing ? " disabled" : "") + '>Yes, update</button><button data-ask="no">No</button></div>';
  }
  function updCfg() { return { repo: $("#updRepo").value.trim(), auto: $("#updAuto").checked, autoInstall: $("#updAutoInstall") ? $("#updAutoInstall").checked : true }; }
  var bannerEl = null;
  function banner() { if (!bannerEl) { bannerEl = document.createElement("div"); bannerEl.className = "upd-banner hidden"; bannerEl.id = "updBanner"; document.body.appendChild(bannerEl); } return bannerEl; }
  function install(already) {
    if (busyPlaying()) { PP.setStatus("Stop the pads and tracks first - updates never install while something plays."); return; }
    if (already !== true && !confirm("Install Central Pedal " + up.latest + " now? The app restarts; songs and settings are kept.")) return;
    up.busy = true; up.installing = true; up.error = null; renderUpd(); upSend("install"); PP.setStatus("Downloading the update…");
  }
  F.on("updateStatus", function (m) { if (DESK) return; var dismissed = up.dismissed && up.latest === m.latest; Object.assign(up, m); up.dismissed = dismissed; if (!m.busy) up.installing = false; renderUpd(); });
  F.on("update", function (m) {
    if (m.state === "done") PP.setStatus("Update installed - restarting…");
    else if (m.state === "failed") { up.busy = false; up.installing = false; up.error = m.message || "update failed"; renderUpd(); PP.setStatus(plainError(up.error)); }
  });
  document.addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    if (b.id === "updCheck") { up.error = null; upSend("config", updCfg()); upSend("check"); up.busy = true; renderUpd(); }
    else if (b.id === "updAgain") { up.error = null; if (up.available) install(true); else { upSend("check"); up.busy = true; renderUpd(); } }
    else if (b.id === "updInstall" || b.dataset.upd === "install") install();
    else if (b.dataset.upd === "later") { up.dismissed = true; renderUpd(); }
  });
  document.addEventListener("change", function (e) { if (e.target.id === "updAuto" || e.target.id === "updAutoInstall" || e.target.id === "updRepo") upSend("config", updCfg()); });
  setInterval(function () { if (up.available) renderUpd(); }, 3000);
  // the app just opened: the Central Pedal (Pi) looks for a newer release now; on a PC the app itself already does
  var openedSent = false;
  function opened() { if (openedSent || DESK) return; var b = window.__pedalBridge; if (!b || !b.connected) return; openedSent = true; send({ type: "updates", action: "opened" }); }
  F.on("hello", function () { setTimeout(opened, 1500); });
  setTimeout(opened, 3000);   // the Install button wakes up once the music stops

  window.PPIntegrations = { propresenter: function () { return pp; }, updates: function () { return up; }, install: install };
  setTimeout(function () { renderPP(); renderUpd(); if (DESK) upSend("status"); }, 400);
})();
