/* Central Usage - updates: the main process looks once a day; this shows "Update ready" and installs on a tap. */
(function () {
  "use strict";
  var UP = window.CU && window.CU.updates;
  function $(s) { return document.querySelector(s); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var st = { current: "", available: false }, dismissed = null;
  function render() {
    var d = $("#updDialog"); if (!d) return;
    $("#updInfo").textContent = "Central Usage " + (st.current || "") + (st.lastCheck ? " · last checked " + new Date(st.lastCheck * 1000).toLocaleString() : "") + (st.kind === "appimage" ? " · AppImage" : st.kind === "deb" ? " · installed package" : "");
    if (document.activeElement !== $("#updRepo")) $("#updRepo").value = st.repo || ""; $("#updAuto").checked = st.auto !== false;
    $("#updState").textContent = st.busy ? "Downloading… " + Math.round((st.progress || 0) * 100) + "%" : st.error || (st.available ? "Version " + st.latest + " is ready." + (st.notes ? " " + st.notes.split("\n")[0].slice(0, 200) : "") : st.latest ? "Up to date." : "");
    $("#updInstall").hidden = !st.available; $("#updInstall").disabled = !!st.busy;
    var b = $("#updBanner"); if (!b) return;
    b.hidden = !(st.available && dismissed !== st.latest);
    b.innerHTML = "<b>Central Usage " + esc(st.latest || "") + ' is ready</b><button class="primary" data-u="install"' + (st.busy ? " disabled" : "") + ">" + (st.busy ? "Installing…" : "Install & restart") + '</button><button data-u="later">Later</button>';
  }
  async function install() {
    if (!confirm("Install Central Usage " + st.latest + " now? Central Usage restarts (the lights blackout for a few seconds).")) return;
    st.busy = true; render(); var r = await UP.install(); if (r && !r.ok) { st.error = r.error; st.busy = false; render(); } else if (r && r.result === "opened") alert("The installer opened - finish there, then start Central Usage again.");
  }
  function open() { var d = $("#updDialog"); if (!d) return; if (!d.open) d.showModal(); UP && UP.status().then(function (s) { st = s; render(); }); }
  if (UP) {
    UP.on(function (s) { st = s; render(); });
    UP.status().then(function (s) { st = s; render(); });
    document.addEventListener("click", async function (e) {
      var b = e.target.closest("button"); if (!b) return;
      if (b.id === "updCheck") { await UP.config({ repo: $("#updRepo").value.trim(), auto: $("#updAuto").checked }); st.busy = true; render(); st = await UP.check(); render(); }
      else if (b.id === "updInstall" || b.dataset.u === "install") install();
      else if (b.dataset.u === "later") { dismissed = st.latest; render(); }
      else if (b.id === "updClose") $("#updDialog").close();
    });
    document.addEventListener("change", function (e) { if (e.target.id === "updRepo" || e.target.id === "updAuto") UP.config({ repo: $("#updRepo").value.trim(), auto: $("#updAuto").checked }).then(function (s) { st = s; render(); }); });
  }
  window.CUUpdates = { open: open, state: function () { return st; } };
})();
