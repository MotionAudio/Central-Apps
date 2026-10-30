/* Central Control - updates: the main process looks every time the app opens (and once a day). A new version found
 * when the app opens installs by itself after a 10-second notice ("Not now" skips it) - unless the show is running,
 * or "Install by itself" is off: then it asks "Update now?" - Yes installs, No asks again the next time the app
 * opens. Songs, setlists and settings are in the app's settings folder, which an update never touches. */
(function () {
  "use strict";
  var UP = window.CU && window.CU.updates;
  function $(s) { return document.querySelector(s); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var st = { current: "", available: false }, dismissed = null;
  var waitingForPage = false;
  function render() {
    var d = $("#updDialog");
    if (!d) {   // (the answer can come before the page has its dialogs - this script loads above them): draw once it has
      if (document.readyState === "loading" && !waitingForPage) { waitingForPage = true; document.addEventListener("DOMContentLoaded", function () { waitingForPage = false; render(); }, { once: true }); }
      return;
    }
    $("#updInfo").textContent = "Central Control " + (st.current || "") + (st.lastCheck ? " · last checked " + new Date(st.lastCheck * 1000).toLocaleString() : "") + (st.kind === "appimage" ? " · AppImage" : st.kind === "deb" ? " · installed package" : "");
    if (document.activeElement !== $("#updRepo")) $("#updRepo").value = st.repo || ""; $("#updAuto").checked = st.auto !== false; if ($("#updAutoInstall")) $("#updAutoInstall").checked = st.autoInstall !== false;
    $("#updState").textContent = st.busy ? "Downloading… " + Math.round((st.progress || 0) * 100) + "%" : st.error || (st.available ? "Version " + st.latest + " is ready." + (st.notes ? " " + st.notes.split("\n")[0].slice(0, 200) : "") : st.latest ? "Up to date." : "");
    if (st.beyond && !st.busy && !st.error) $("#updState").textContent = (st.available ? "Version " + st.latest + " is ready. " : "") + "Version " + st.beyond + " is out. This key gets updates through " + (st.limitText || "its version") + "; this version keeps working. Renew the key ($20) on the website for ten more releases.";
    renewNote();
    $("#updInstall").hidden = !st.available; $("#updInstall").disabled = !!st.busy;
    autoStart();
    ask();
    var b = $("#updBanner"); if (!b) return;
    b.hidden = !(st.available && dismissed !== st.latest) || !!($("#updAsk") && $("#updAsk").open);
    b.innerHTML = "<b>Central Control " + esc(st.latest || "") + ' is ready</b><button class="primary" data-u="install"' + (st.busy ? " disabled" : "") + ">" + (st.busy ? "Installing…" : "Install & restart") + '</button><button data-u="later">Later</button>';
  }
  // past the key's updates: said once per new version (the app keeps working; nothing is forced)
  function renewNote() {
    if (!st.beyond || st.available) return;
    var seen = null; try { seen = localStorage.getItem("cu-beyond-seen"); } catch (_) { }
    if (seen === st.beyond) return;
    try { localStorage.setItem("cu-beyond-seen", st.beyond); } catch (_) { }
    var b = document.createElement("div"); b.className = "upd-beyond"; b.setAttribute("role", "status");
    b.style.cssText = "position:fixed;left:16px;right:16px;bottom:16px;max-width:560px;margin:0 auto;z-index:50;background:var(--panel,#1A1D22);border:1px solid var(--line,#343A44);border-radius:12px;padding:12px 14px;display:grid;gap:6px;box-shadow:0 8px 30px rgba(0,0,0,.35)";
    b.innerHTML = "<b>Version " + esc(st.beyond) + " is out</b><span>This key gets updates through " + esc(st.limitText || "its version") + ". This version keeps working as it is. To get " + esc(st.beyond) + ", renew the key ($20) on the website: Account → Your church → Renew.</span><div><button>OK</button></div>";
    b.querySelector("button").onclick = function () { b.remove(); };
    document.body.appendChild(b);
  }
  // installing by itself when the app opens: decided once, on the first answer from the update server
  var openedAt = Date.now(), autoDecided = false, autoTimer = null, autoLeft = 0;
  function playing() {
    var L = window.CULights, V = window.CUVideoTab && window.CUVideoTab.state, st = V && V.stream;
    var live = !!(st && ((st.record && st.record.on) || (st.destinations || []).some(function (d) { return d.status === "live" || d.status === "reconnecting"; })));
    return !!((L && L.song && L.song.playing) || live);   // the show (lights following a song), a live stream or a recording
  }
  function autoStart() {
    if (autoDecided || autoTimer) return;
    if (!st.latest && !st.available) { if (Date.now() - openedAt > 30 * 60 * 1000) autoDecided = true; return; }   // no answer yet (no internet yet)
    autoDecided = true;
    if (!st.available || st.busy || st.auto === false || st.autoInstall === false || playing()) return;
    var d = $("#updAsk"); if (!d) return;
    asked = st.latest; autoLeft = 10;
    function paint() {
      d.innerHTML = "<h2>Updating Central Control</h2><p><b>Version " + esc(st.latest || "") + "</b> installs in " + autoLeft + " s, then the app restarts (this one is " + esc(st.current || "?") + ").</p>" +
        "<p class=\"muted small\">Your songs, setlists and settings stay. Turn this off in Settings → Updates.</p>" +
        '<div class="row"><button class="primary" data-ask="yes">Update now</button><button data-ask="no">Not now</button></div>';
    }
    paint(); if (!d.open) d.showModal();
    autoTimer = setInterval(function () {
      if (!d.open) { clearInterval(autoTimer); autoTimer = null; return; }   // "Not now" / Escape
      if (playing()) { clearInterval(autoTimer); autoTimer = null; d.close(); asked = null; dismissed = null; render(); return; }   // the show started: ask instead
      autoLeft--; if (autoLeft > 0) return paint();
      clearInterval(autoTimer); autoTimer = null; d.close(); install(true);
    }, 1000);
  }
  var asked = null;
  function ask() {
    var d = $("#updAsk"); if (!d) return;
    if (autoTimer) return;
    if (!st.available || st.busy || st.auto === false || dismissed === st.latest || asked === st.latest) return;
    asked = st.latest;
    d.innerHTML = "<h2>Update available</h2><p><b>Central Control " + esc(st.latest || "") + "</b> is ready (this one is " + esc(st.current || "?") + ").</p>" +
      (st.notes ? '<p class="muted small">' + esc(st.notes.replace(/[#*]/g, "").split("\n").filter(Boolean).slice(0, 3).join(" · ").slice(0, 260)) + "</p>" : "") +
      "<p>Want to update now? Central Control restarts (the lights blackout for a few seconds).</p>" +
      '<div class="row"><button class="primary" data-ask="yes">Yes, update</button><button data-ask="no">No</button></div>';
    if (!d.open) d.showModal();
  }
  async function install(already) {
    if (already !== true && !confirm("Install Central Control " + st.latest + " now? Central Control restarts (the lights blackout for a few seconds).")) return;
    st.busy = true; render(); var r = await UP.install(); if (r && !r.ok) { st.error = r.error; st.busy = false; render(); } else if (r && r.result === "opened") alert("The installer opened - finish there, then start Central Control again.");
  }
  function cfgNow() { return { repo: $("#updRepo").value.trim(), auto: $("#updAuto").checked, autoInstall: $("#updAutoInstall") ? $("#updAutoInstall").checked : true }; }
  function open() { var d = $("#updDialog"); if (!d) return; if (!d.open) d.showModal(); UP && UP.status().then(function (s) { st = s; render(); }); }
  function onCancel() { $("#updAsk").addEventListener("cancel", function () { dismissed = st.latest; setTimeout(render, 0); }); }
  if ($("#updAsk")) onCancel(); else document.addEventListener("DOMContentLoaded", function () { if ($("#updAsk")) onCancel(); }, { once: true });
  if (UP) {
    UP.on(function (s) { st = s; render(); });
    UP.status().then(function (s) { st = s; render(); });
    document.addEventListener("click", async function (e) {
      var b = e.target.closest("button"); if (!b) return;
      if (b.id === "updCheck") { autoDecided = true;   // (a look by hand: it asks)
 await UP.config(cfgNow()); st.busy = true; render(); st = await UP.check(); render(); }
      else if (b.id === "updInstall" || b.dataset.u === "install") install();
      else if (b.dataset.u === "later") { dismissed = st.latest; render(); }
      else if (b.id === "updClose") $("#updDialog").close();
      else if (b.dataset.ask === "yes") { if (autoTimer) { clearInterval(autoTimer); autoTimer = null; } $("#updAsk").close(); install(true); }
      else if (b.dataset.ask === "no") { if (autoTimer) { clearInterval(autoTimer); autoTimer = null; } $("#updAsk").close(); dismissed = st.latest; render(); }
    });
    document.addEventListener("change", function (e) { if (e.target.id === "updRepo" || e.target.id === "updAuto" || e.target.id === "updAutoInstall") UP.config(cfgNow()).then(function (s) { st = s; render(); }); });
  }
  window.CUUpdates = { open: open, state: function () { return st; } };
})();
