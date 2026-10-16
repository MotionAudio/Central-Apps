/* Pad Pedal companion pages - shared: live connection to the Pad Pedal,
 * the pairing code, and small helpers. Served by the Pad Pedal itself at
 * http://<pad-pedal>:8080/ for phones, tablets, laptops and the projector. */
(function () {
  "use strict";
  var host = location.hostname || "padpedal.local";
  var params = new URLSearchParams(location.search);
  var state = { display: null, connected: false, hostname: "", authed: false, wsPort: 8081 };
  var listeners = [], socket = null, retry = 1500, pingTimer = 0;
  var code = params.get("code") || "";
  try { if (code) localStorage.setItem("pp-code", code); else code = localStorage.getItem("pp-code") || ""; } catch (_) { }

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]; }); }
  function keyName(k) { return String(k || "").replace("#", "♯"); }
  function fmtTime(t) { t = Math.max(0, t || 0); var m = Math.floor(t / 60), s = Math.floor(t % 60); return m + ":" + (s < 10 ? "0" : "") + s; }
  function notify() { listeners.forEach(function (fn) { try { fn(state); } catch (e) { console.warn(e); } }); }

  function connect() {
    try { socket = new WebSocket("ws://" + host + ":" + state.wsPort); } catch (_) { setTimeout(connect, retry); return; }
    socket.onopen = function () { state.connected = true; if (code) socket.send(JSON.stringify({ type: "auth", code: code })); notify(); clearInterval(pingTimer); pingTimer = setInterval(function () { try { socket.send(JSON.stringify({ type: "ping" })); } catch (_) { } }, 20000); };
    socket.onmessage = function (e) {
      var m; try { m = JSON.parse(e.data); } catch (_) { return; }
      if (m.type === "display") { state.display = m; notify(); }
      else if (m.type === "hello") { state.hostname = m.hostname || ""; notify(); }
      else if (m.type === "auth") { state.authed = !!m.ok; if (!m.ok && code) { try { localStorage.removeItem("pp-code"); } catch (_) { } code = ""; } notify(); }
    };
    socket.onclose = function () { state.connected = false; state.authed = false; notify(); clearInterval(pingTimer); setTimeout(connect, retry); };
  }
  function action(name, args) {
    if (!state.authed) { if (!askCode()) return false; }
    if (!socket || socket.readyState !== 1) return false;
    socket.send(JSON.stringify({ type: "action", name: name, args: args || {}, code: code }));
    return true;
  }
  function askCode() {
    var entered = prompt("Enter the 4-digit pairing code shown on the Central Control under Settings → Companion devices:", "");
    if (!entered) return false;
    code = entered.trim(); try { localStorage.setItem("pp-code", code); } catch (_) { }
    if (socket && socket.readyState === 1) socket.send(JSON.stringify({ type: "auth", code: code }));
    state.authed = true; // optimistic; the reply corrects it
    return true;
  }
  fetch("http://" + host + ":" + (location.port || 8080) + "/api/info", { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (j) { if (j.wsPort) state.wsPort = j.wsPort; state.hostname = j.hostname || state.hostname; connect(); }).catch(function () { connect(); });

  window.PPCompanion = { state: state, on: function (fn) { listeners.push(fn); if (state.display) fn(state); }, action: action, askCode: askCode, esc: esc, keyName: keyName, fmtTime: fmtTime, api: function (p) { return "http://" + host + ":" + (location.port || 8080) + "/api" + p; }, hasCode: function () { return !!code; } };
})();
