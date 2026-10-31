/* Central Pedal - restarting by itself (10.0.1). Most settings take effect at once. The few that truly need the Pi to
 * start again (a new touch screen's driver, safe mode on / off) restart it by themselves: they wait until nothing is
 * playing, show a short countdown with Cancel, then restart - nobody has to pull the plug or find a button.
 *   PPAutoRestart.ask("the new touch screen")   PPAutoRestart.cancel() */
(function () {
  "use strict";
  var PP = window.PP; if (!PP) return;
  function bridge() { return window.__pedalBridge; }
  function send(m) { return bridge() && bridge().send ? bridge().send(m) : false; }
  function playing() { var T = window.PPTracks, e = PP.engine; return !!((T && T.isPlaying && T.isPlaying()) || (e && e.voices && e.voices().length)); }
  var dlg = null, timer = null, left = 0, why = "";
  function make() {
    if (dlg) return dlg;
    dlg = document.createElement("dialog"); dlg.id = "autoRestart"; dlg.className = "upd-ask";
    dlg.addEventListener("click", function (e) { var b = e.target.closest("[data-ar]"); if (!b) return; if (b.dataset.ar === "now") go(); else cancel(); });
    dlg.addEventListener("cancel", function (e) { e.preventDefault(); cancel(); });
    document.body.appendChild(dlg);
    return dlg;
  }
  function paint() {
    var wait = playing();
    dlg.innerHTML = "<h2>Restarting the pedal</h2><p>To finish setting up " + PP.escapeHtml(why) + ", the pedal starts again" +
      (wait ? " as soon as the music stops." : " in <b>" + left + " s</b>. It takes about a minute; your songs and settings stay.") + "</p>" +
      '<div class="row"><button class="primary" data-ar="now"' + (wait ? " disabled" : "") + '>Restart now</button><button data-ar="cancel">Cancel</button></div>';
  }
  function go() { stop(); if (dlg && dlg.open) dlg.close(); PP.persistNow(); PP.setStatus("Restarting…"); send({ type: "system", action: "reboot" }); }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }
  function cancel() { stop(); if (dlg && dlg.open) dlg.close(); PP.setStatus("Restart cancelled - it happens the next time the pedal starts."); }
  function ask(reason) {
    if (!bridge() || !bridge().connected) return false;
    why = reason || "that change"; left = 10; make(); paint(); if (!dlg.open) dlg.showModal();
    stop();
    timer = setInterval(function () {
      if (playing()) { left = 10; return paint(); }   // (never mid-song: it waits, then counts down)
      left--; if (left <= 0) return go();
      paint();
    }, 1000);
    return true;
  }
  window.PPAutoRestart = { ask: ask, cancel: cancel, active: function () { return !!timer; } };
})();
