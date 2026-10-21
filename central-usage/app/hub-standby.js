/* Central Control - the hub and the second main admin's computer (hubsync.js in the app):
 *   on the hub: what of its window belongs to the church (the lighting rig and cues, slides, timecode) goes to the app,
 *     which the in-sync computer copies with the rest;
 *   on the in-sync computer: the center's "keep in sync" reaches the app; Settings shows how the copy is doing and
 *     has Take over as the hub (with the main admin's role PIN). */
(function () {
  "use strict";
  var CU = window.CentralUsage, NAT = window.CU; if (!CU || !NAT || !NAT.standby) return;
  var HUB_KEYS = ["cu-rig", "cu-lxLook", "cu-lxSong", "cu-slides", "cu-sendClock", "cu-offsetMs", "cu-timecode"];
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function ago(ms) { if (!ms) return "not yet"; var s = Math.round((Date.now() - ms) / 1000); return s < 60 ? "just now" : s < 3600 ? Math.round(s / 60) + " min ago" : s < 86400 ? Math.round(s / 3600) + " h ago" : new Date(ms).toLocaleString(); }
  function size(b) { return b > 1e9 ? (b / 1e9).toFixed(1) + " GB" : b > 1e6 ? Math.round(b / 1e6) + " MB" : Math.round((b || 0) / 1e3) + " KB"; }
  var st = { on: false };

  // ---- the hub: hand the church's lighting, slides and timecode to the app (every 10 s, when something changed)
  setInterval(function () {
    if (CU.role() !== "main") return;
    var o = {}; HUB_KEYS.forEach(function (k) { try { var v = localStorage.getItem(k); if (v != null) o[k] = v; } catch (_) { } });
    NAT.hubState(o);
  }, 10000);

  // ---- the center marks this computer "in sync" (or not)
  CU.on("message", function (m) {
    if (!m || (m.type !== "standbyAssigned" && m.type !== "standbyCleared") || m.from !== "center") return;
    var t = window.CUCenter && window.CUCenter.target(); if (t && t.host) m = Object.assign({}, m, { host: t.host, port: t.port });   // (where this window reached the hub: for networks without discovery)
    NAT.standby.set(m).then(function (s) { st = s; paint(); });
  });
  NAT.standby.on(function (s) { st = s; paint(); });
  NAT.standby.status().then(function (s) { st = s; });
  // the hub was handed over (or a newer hub took over while this computer was off): say so after the restart
  NAT.standby.onHubChanged(function (m) {
    var msg = m.why === "handover" ? (m.by || "The other main admin's computer") + " is the hub now. This computer is an admin computer and keeps itself in sync with it."
      : (m.by || "Another computer") + " took over as the hub while this computer was off. This computer is an admin computer now.";
    try { localStorage.setItem("cu-hubNotice", JSON.stringify(msg)); } catch (_) { }
    if (window.CURoles) window.CURoles.toast(msg);
  });
  NAT.standby.onRestart(function () { location.reload(); });
  try { var note = JSON.parse(localStorage.getItem("cu-hubNotice") || "null"); if (note) { localStorage.removeItem("cu-hubNotice"); setTimeout(function () { if (window.CURoles) window.CURoles.toast(note); else alert(note); }, 1500); } } catch (_) { }

  // ---- Settings: the in-sync computer's card
  function card() {
    if (!st.on || CU.role() === "main") return "";
    var good = st.ok !== false && st.at;
    return '<section class="card hs-card"><h3>Second main admin: kept in sync</h3>' +
      '<p class="muted">This computer keeps a copy of everything on the hub (<b>' + esc(st.hubName || "the main admin's computer") + '</b>): the songs and tracks, lighting, slides, the mixer, cameras, paired devices and the PINs. It copies what changed every minute.</p>' +
      '<table class="io-t"><tr><td>Last copy</td><td>' + (st.busy ? "copying now…" : good ? "✓ " + esc(ago(st.at)) : '<span class="warn">' + esc(st.error || "not yet") + "</span>") + "</td></tr>" +
      "<tr><td>Copy</td><td>" + (st.files ? st.files + " files, " + size(st.bytes) : "-") + "</td></tr>" +
      "<tr><td>The hub</td><td>" + (st.hubOnline ? "on this network" : '<span class="warn">not seen on this network</span>') + "</td></tr></table>" +
      '<div class="row"><button data-hs="sync"' + (st.busy ? " disabled" : "") + '>Copy now</button><button class="primary" data-hs="takeover"' + (st.copy ? "" : " disabled") + ">Take over as the hub</button></div>" +
      '<p class="muted small">Take over: this computer becomes the hub, with the main admin\'s role PIN. Every phone, tablet, computer and pedal stays paired. If the hub is on, it becomes an admin computer and keeps itself in sync with this one. If it\'s off or broken, the last copy is used.</p></section>';
  }
  function paint() { if (window.CUSettings && CU.prefs.tab === "settings") window.CUSettings.render(); }
  async function takeover() {
    var pin = await CU.askText("The main admin's role PIN (4 digits, in the hub's Settings):", "");
    if (!pin) return;
    var id = window.CURoles ? window.CURoles.devId() : "";
    var r = await NAT.standby.takeover({ pin: pin.trim(), deviceId: id });
    if (r && r.needForce) {
      var when = r.at ? new Date(r.at).toLocaleString() : "the last copy";
      if (!confirm((r.error ? r.error + "\n\n" : "The hub isn't on this network.\n\n") + "Take over with the copy from " + when + "? Anything changed on the hub since then stays on that computer.")) return;
      r = await NAT.standby.takeover({ pin: pin.trim(), deviceId: id, force: true });
    }
    if (!r || !r.ok) return alert((r && r.error) || "Couldn't take over.");
    try { localStorage.setItem("cu-hubNotice", JSON.stringify("This computer is the hub now." + (r.planned ? " The old hub is an admin computer and keeps itself in sync with this one." : ""))); } catch (_) { }
    if (window.CURoles) window.CURoles.toast("This computer is the hub now. Central Control restarts…");
  }
  document.addEventListener("click", async function (e) {
    var b = e.target.closest && e.target.closest("#settingsRoot [data-hs]"); if (!b) return;
    if (b.dataset.hs === "sync") { b.disabled = true; st = await NAT.standby.sync(); paint(); }
    else if (b.dataset.hs === "takeover") takeover();
  });
  // ---- every computer reports how its copy is doing (the hub's Devices tab shows it)
  window.CUHubStandby = { card: card, health: function () { return st.on ? { syncAt: st.at || 0, syncOk: st.ok !== false, syncError: st.error ? String(st.error).slice(0, 58) : "" } : null; } };
})();
