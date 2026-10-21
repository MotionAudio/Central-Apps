/* Central Control - updates: the main process looks every time the app opens (and once a day); a new version asks
 * "Update now?" - Yes installs, No asks again the next time the app opens. Settings → Updates has the rest. */
(function () {
  "use strict";
  var UP = window.CU && window.CU.updates;
  function $(s) { return document.querySelector(s); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var st = { current: "", available: false }, dismissed = null;
  function render() {
    var d = $("#updDialog"); if (!d) return;
    $("#updInfo").textContent = "Central Control " + (st.current || "") + (st.lastCheck ? " · last checked " + new Date(st.lastCheck * 1000).toLocaleString() : "") + (st.kind === "appimage" ? " · AppImage" : st.kind === "deb" ? " · installed package" : "");
    if (document.activeElement !== $("#updRepo")) $("#updRepo").value = st.repo || ""; $("#updAuto").checked = st.auto !== false;
    $("#updState").textContent = st.busy ? "Downloading… " + Math.round((st.progress || 0) * 100) + "%" : st.error || (st.available ? "Version " + st.latest + " is ready." + (st.notes ? " " + st.notes.split("\n")[0].slice(0, 200) : "") : st.latest ? "Up to date." : "") + (st.upgradeNote ? " " + st.upgradeNote : "");
    $("#updInstall").hidden = !st.available; $("#updInstall").disabled = !!st.busy;
    ask();
    var b = $("#updBanner"); if (!b) return;
    b.hidden = !(st.available && dismissed !== st.latest) || !!($("#updAsk") && $("#updAsk").open);
    b.innerHTML = "<b>Central Control " + esc(st.latest || "") + ' is ready</b><button class="primary" data-u="install"' + (st.busy ? " disabled" : "") + ">" + (st.busy ? "Installing…" : "Install & restart") + '</button><button data-u="later">Later</button>';
  }
  var asked = null;
  function ask() {
    var d = $("#updAsk"); if (!d) return;
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
  function open() { var d = $("#updDialog"); if (!d) return; if (!d.open) d.showModal(); UP && UP.status().then(function (s) { st = s; render(); }); }
  if ($("#updAsk")) $("#updAsk").addEventListener("cancel", function () { dismissed = st.latest; setTimeout(render, 0); });
  if (UP) {
    UP.on(function (s) { st = s; render(); });
    UP.status().then(function (s) { st = s; render(); });
    document.addEventListener("click", async function (e) {
      var b = e.target.closest("button"); if (!b) return;
      if (b.id === "updCheck") { await UP.config({ repo: $("#updRepo").value.trim(), auto: $("#updAuto").checked }); st.busy = true; render(); st = await UP.check(); render(); }
      else if (b.id === "updInstall" || b.dataset.u === "install") install();
      else if (b.dataset.u === "later") { dismissed = st.latest; render(); }
      else if (b.id === "updClose") $("#updDialog").close();
      else if (b.dataset.ask === "yes") { $("#updAsk").close(); install(true); }
      else if (b.dataset.ask === "no") { $("#updAsk").close(); dismissed = st.latest; render(); }
    });
    document.addEventListener("change", function (e) { if (e.target.id === "updRepo" || e.target.id === "updAuto") UP.config({ repo: $("#updRepo").value.trim(), auto: $("#updAuto").checked }).then(function (s) { st = s; render(); }); });
  }
  window.CUUpdates = { open: open, state: function () { return st; } };
})();
