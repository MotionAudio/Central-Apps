/* Central Usage - the Instrument tab: the Central Control's Instrument page (guitar, bass and keys through
 * real pedals and sounds) running on this computer. The page lives in a frame (instrument.html, with the
 * Central Control's own files); its audio runs in the instrument host the app starts (services.js). */
(function () {
  "use strict";
  var CU = window.CentralUsage, NAT = window.CU && window.CU.inst; if (!CU) return;
  var frame = document.getElementById("instFrame"), loaded = false;
  function post(m) { if (frame && frame.contentWindow) frame.contentWindow.postMessage({ cu: "inst", msg: m }, "*"); }
  window.addEventListener("message", function (e) {
    var d = e.data; if (!d || d.cu !== "inst-out") return;
    if (NAT) NAT.send(d.msg); else post({ type: "instrumentStatus", available: false, error: "The instrument plays in the Central Usage app (not in a browser).", inputs: [], midiInputs: [], keysCatalog: [] });
  });
  if (NAT) NAT.on(function (m) { post(m); });
  CU.on("tab", function (t) {
    if (t !== "instrument" || !frame) return;
    if (!loaded) { loaded = true; if (NAT) NAT.start(); frame.src = frame.dataset.src; }
    else post({ type: "shown" });
  });
})();
