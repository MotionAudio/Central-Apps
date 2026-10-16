/* Central Control - outside connections: ProPresenter (slides follow the sections) and software updates
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
    $("#ppState").textContent = !connected() ? "ProPresenter control runs on the Central Control." : !pp.enabled ? "Off." : pp.ok === true ? "Connected" + (pp.version ? " · " + pp.version : "") + "." : pp.ok === false ? "Not reachable: " + (pp.error || "") : "Not tested yet.";
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
    var info = $("#updInfo"); if (info) info.textContent = "This Central Control: version " + (up.current || "?") + (up.lastCheck ? " · last checked " + new Date(up.lastCheck * 1000).toLocaleString() : "") + ".";
    var st = $("#updState"); if (st) st.textContent = up.busy ? "Working…" : up.error ? up.error : up.available ? "Version " + up.latest + " is available." + (up.notes ? " " + up.notes.split("\n")[0].slice(0, 160) : "") : up.latest ? "Up to date." : "";
    var ib = $("#updInstall"); if (ib) { ib.classList.toggle("hidden", !up.available); ib.disabled = !!up.busy; }
    var b = banner(); b.classList.toggle("hidden", !(up.available && !up.dismissed));
    b.innerHTML = '<b>Update ' + esc(up.latest || "") + ' is ready</b><span>' + (busyPlaying() ? "Install it after the service (stop the pads and tracks first)." : "Installs in about a minute; your songs and settings stay.") + '</span><button class="primary" data-upd="install"' + (up.busy || busyPlaying() ? " disabled" : "") + '>' + (up.busy ? "Installing…" : "Install") + '</button><button data-upd="later">Later</button>';
  }
  var bannerEl = null;
  function banner() { if (!bannerEl) { bannerEl = document.createElement("div"); bannerEl.className = "upd-banner hidden"; bannerEl.id = "updBanner"; document.body.appendChild(bannerEl); } return bannerEl; }
  function install() {
    if (busyPlaying()) { PP.setStatus("Stop the pads and tracks first - updates never install while something plays."); return; }
    if (!confirm("Install Central Control " + up.latest + " now? The app restarts; songs and settings are kept.")) return;
    up.busy = true; renderUpd(); upSend("install"); PP.setStatus("Downloading the update…");
  }
  F.on("updateStatus", function (m) { if (DESK) return; var dismissed = up.dismissed && up.latest === m.latest; Object.assign(up, m); up.dismissed = dismissed; renderUpd(); });
  F.on("update", function (m) { if (m.state === "done") PP.setStatus("Update installed - restarting…"); else if (m.state === "failed") PP.setStatus("Update failed: " + (m.message || "")); });
  document.addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    if (b.id === "updCheck") { upSend("config", { repo: $("#updRepo").value.trim(), auto: $("#updAuto").checked }); upSend("check"); up.busy = true; renderUpd(); }
    else if (b.id === "updInstall" || b.dataset.upd === "install") install();
    else if (b.dataset.upd === "later") { up.dismissed = true; renderUpd(); }
  });
  document.addEventListener("change", function (e) { if (e.target.id === "updAuto" || e.target.id === "updRepo") upSend("config", { repo: $("#updRepo").value.trim(), auto: $("#updAuto").checked }); });
  setInterval(function () { if (up.available) renderUpd(); }, 3000);   // the Install button wakes up once the music stops

  window.PPIntegrations = { propresenter: function () { return pp; }, updates: function () { return up; }, install: install };
  setTimeout(function () { renderPP(); renderUpd(); if (DESK) upSend("status"); }, 400);
})();
