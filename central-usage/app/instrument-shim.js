/* Central Usage - what the Central Control's Instrument page expects around it (PP, PPFeatures, the driver
 * bridge), here inside the Instrument frame. Messages to the instrument host go to the app (parent window). */
(function () {
  "use strict";
  var KEY = "cu-instrument-project", proj = {};
  try { proj = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (_) { proj = {}; }
  var timer = 0;
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(proj)); } catch (_) { } }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function setStatus(t) { var el = document.getElementById("status"); if (el) { el.textContent = t || ""; clearTimeout(el._t); el._t = setTimeout(function () { el.textContent = ""; }, 6000); } }
  function ask(label, opt) {
    opt = opt || {};
    return new Promise(function (resolve) {
      var d = document.createElement("dialog"); d.className = "pp-ask";
      d.innerHTML = '<form method="dialog"><label>' + esc(label) + '<input name="v" autocomplete="off"></label><div class="row"><button value="cancel" type="button" data-x>Cancel</button><button class="primary" value="ok">' + esc(opt.ok || "OK") + "</button></div></form>";
      document.body.appendChild(d); var inp = d.querySelector("input"); inp.value = opt.value || "";
      d.querySelector("[data-x]").addEventListener("click", function () { d.close("cancel"); });
      d.addEventListener("close", function () { resolve(d.returnValue === "ok" ? inp.value : null); d.remove(); });
      d.showModal(); inp.focus();
    });
  }
  var listeners = {};
  window.PP = { project: function () { return proj; }, setStatus: setStatus, persistSoon: function () { clearTimeout(timer); timer = setTimeout(persist, 400); }, persistNow: persist, escapeHtml: esc, clamp: function (v, a, b) { return v < a ? a : v > b ? b : v; }, ask: ask, engine: null };
  window.PPFeatures = { on: function (t, fn) { (listeners[t] = listeners[t] || []).push(fn); }, emit: function (m) { (listeners[m.type] || []).forEach(function (fn) { try { fn(m); } catch (e) { console.warn(e); } }); }, openUsb: null, systemStatus: function () { return null; } };
  window.PPShell = { currentTab: function () { return "instrument"; } };
  window.__pedalBridge = { connected: true, send: function (m) { parent.postMessage({ cu: "inst-out", msg: m }, "*"); return true; } };
  window.addEventListener("message", function (e) {
    var d = e.data; if (!d || d.cu !== "inst") return; var m = d.msg || {};
    if (m.type === "shown") { if (window.PPInstrument) window.PPInstrument.show(); return; }
    window.PPFeatures.emit(m);
  });
})();
