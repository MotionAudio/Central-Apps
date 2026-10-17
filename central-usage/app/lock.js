/* Central Control - locks.
 *  Service lock: the main admin locks every computer (or chosen ones) from its Devices tab before the service.
 *    Locked: the I/O tab, Settings (except this computer's name and role), Lighting → Fixtures / Output,
 *    Video → Sources / Stream / Audio / Phones. Everything used during the service keeps working.
 *    Only the main admin unlocks it; the main admin's own computer is never locked.
 *  Manual lock: anyone (User 1, User 2, an admin, the main admin) locks their own computer so nothing they set
 *    can change - the mix, the chart, the part, the layout. Tabs can still be looked at and pages scrolled.
 *    Hold the lock button for 2 seconds to unlock. */
(function () {
  "use strict";
  var CU = window.CentralUsage; if (!CU) return;
  function $(s, r) { return (r || document).querySelector(s); }
  var svc = false, manual = !!CU.store.get("manualLock", false), holdT = 0, warnAt = 0, unlockedAt = 0;
  function toast(t) { if (window.CURoles && window.CURoles.toast) window.CURoles.toast(t); }

  function hiddenTabs() { return svc ? ["io"] : []; }
  function apply() {
    document.body.classList.toggle("svc-locked", svc);
    document.body.classList.toggle("man-locked", manual);
    if (CU.applyMode && CU.role()) CU.applyMode();
    if (svc) {
      if (window.CULights && window.CULights.view && ["fixtures", "output"].indexOf(window.CULights.view()) >= 0) window.CULights.showSub("show");
      var vv = document.querySelector('[data-vview].on'); if (vv && ["sources", "stream", "audio", "phones"].indexOf(vv.dataset.vview) >= 0) { var sw = document.querySelector('[data-vview="switch"]'); if (sw) sw.click(); }
    }
    paintBtn();
  }
  function paintBtn() {
    var b = $("#mlBtn"); if (!b) return;
    b.textContent = manual ? "🔒" : "🔓"; b.classList.toggle("on", manual);
    b.title = manual ? "Manual lock is on - hold for 2 seconds to unlock" : "Manual lock: nothing on this computer changes until you hold this for 2 seconds";
  }
  function setManual(on) { manual = !!on; CU.store.set("manualLock", manual); apply(); toast(manual ? "Locked - nothing here changes. Hold 🔒 for 2 seconds to unlock." : "Unlocked."); }

  // the service lock comes with the role view from the center (the main admin)
  CU.on("message", function (m) {
    if (m.type !== "cuRoles") return;
    var on = !!(m.you && m.you.locked) && CU.role() !== "main";
    if (on !== svc) { svc = on; apply(); toast(on ? "🔒 Locked for the service by the main admin." : "The main admin unlocked this computer."); }
  });

  // the manual lock button: tap to lock; hold 2 s to unlock
  var btn = $("#mlBtn");
  if (btn) {
    btn.addEventListener("pointerdown", function () {
      if (!manual) return;
      btn.classList.add("holding"); clearTimeout(holdT);
      holdT = setTimeout(function () { btn.classList.remove("holding"); unlockedAt = performance.now(); setManual(false); }, 2000);
    });
    ["pointerup", "pointerleave", "pointercancel"].forEach(function (ev) { btn.addEventListener(ev, function () { clearTimeout(holdT); btn.classList.remove("holding"); }); });
    btn.addEventListener("click", function () { if (performance.now() - unlockedAt < 1500) return; if (!manual) setManual(true); else if (performance.now() - warnAt > 1500) { warnAt = performance.now(); toast("Hold 🔒 for 2 seconds to unlock."); } });
  }
  // while it is on, nothing that changes a setting gets the event
  var INTERACTIVE = "input, select, textarea, button, a, label, canvas, [contenteditable], [draggable=true], [role=button], .tab-like, svg";
  function allowed(t) { return !t || !t.closest || !!t.closest("#tabs, #mlBtn, [data-ml-ok], .role-toast, #modePick, #updAsk, #cdChip, .cd-pop"); }
  function block(e) {
    if (!manual) return;
    var t = e.target;
    if (allowed(t)) return;
    if (e.type === "keydown") { if (["Tab", "PageUp", "PageDown", "ArrowUp", "ArrowDown", "Home", "End"].indexOf(e.key) >= 0 && !(t.closest && t.closest("input, select, textarea"))) return; }
    else if (!(t.closest && t.closest(INTERACTIVE))) return;   // plain text and empty space: scrolling still works
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    if (e.type === "pointerdown" && performance.now() - warnAt > 2500) { warnAt = performance.now(); toast("🔒 Manual lock is on - hold the lock for 2 seconds to unlock."); }
  }
  ["pointerdown", "mousedown", "click", "dblclick", "input", "change", "keydown"].forEach(function (ev) { document.addEventListener(ev, block, { capture: true, passive: false }); });

  window.CULock = { hiddenTabs: hiddenTabs, service: function () { return svc; }, manual: function () { return manual; }, setManual: setManual };
  apply();
})();
