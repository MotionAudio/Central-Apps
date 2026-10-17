/* Central Usage - the link to the mixer, the same for every admin screen:
 *   local   this computer is the audio host: the engine in this app (IPC)
 *   remote  another admin computer is the host: its server (ws://host:8092/ws, admin code)
 * CUMix.state (the mixer model), .pi (the Central Control's channels), .meters, .op(op), .listen(tap, on),
 * .on("state" | "op" | "meters" | "pi" | "status" | "audio", fn), .kind, .connected() */
(function () {
  "use strict";
  var CU = window.CentralUsage, M = window.CUMixer, IE = window.CUInEar, NATIVE = window.CU && window.CU.mixer, HOST = window.CU && window.CU.host;
  if (!CU || !M) return;
  var L = { kind: "none", state: null, pi: [], meters: null, info: null, hostStatus: null, link: null, error: null, remoteAddr: "" }, handlers = {};
  function emit(t, a, b, c, d) { (handlers[t] || []).forEach(function (fn) { try { fn(a, b, c, d); } catch (e) { console.warn("mixlink", t, e); } }); }
  function on(t, fn) { (handlers[t] = handlers[t] || []).push(fn); }
  function isHost() { var c = CU.config(); return (CU.isAdmin ? CU.isAdmin() : CU.mode() === "admin" || CU.mode() === "main") && c && c.host && c.host.enabled && !!NATIVE; }
  function hostAddress() {
    var manual = CU.store.get("hostAddr", ""); if (manual) return manual;
    var h = CU.state.audioHost; return h ? h.address + ":" + (h.port || 8092) : "";
  }
  // ---- local (this computer is the host)
  if (NATIVE) {
    NATIVE.onOp(function (op) { if (L.kind === "local" && L.state) { M.apply(L.state, op, { role: "host" }); emit("op", op); } });
    NATIVE.onState(function (st) { if (L.kind === "local") { L.state = M.normalize(st); emit("state", L.state); } });
    NATIVE.onMeters(function (m) { if (L.kind === "local") { L.meters = m; emit("meters", m); } });
    NATIVE.onPi(function (names) { if (L.kind === "local") { L.pi = names; emit("pi", names); } });
    NATIVE.onAudio(function (tap, frames, pcm) { if (L.kind === "local") emit("audio", new Int16Array(pcm.buffer, pcm.byteOffset, frames * 2), frames, 2, 48000, tap); });
  }
  if (HOST) HOST.on(function (st) { L.hostStatus = st; emit("status", st); if (L.kind === "local" && st.engine) L.info = st.engine; });
  async function useLocal() {
    if (L.link) { L.link.close(); L.link = null; }
    L.kind = "local"; L.error = null;
    try { var r = await NATIVE.get(); L.state = M.normalize(r.state); L.pi = r.pi || []; L.info = r.info; } catch (e) { L.error = e.message; }
    try { L.hostStatus = await HOST.status(); } catch (_) { }
    emit("state", L.state); emit("status", L.hostStatus);
  }
  function useRemote() {
    var addr = hostAddress(), code = CU.store.get("adminCode", "");
    if (L.link && L.remoteAddr === addr + "|" + code) return;
    if (L.link) { L.link.close(); L.link = null; }
    L.kind = "remote"; L.state = null; L.remoteAddr = addr + "|" + code; L.error = null;
    if (!addr) { L.error = "No audio host yet: one admin computer turns on \"This computer is the audio host\" (I/O tab)."; emit("state", null); return; }
    if (!code) { L.error = "Enter the audio host's admin code (I/O tab) to mix from this computer."; emit("state", null); return; }
    var link = L.link = IE.link({ url: "ws://" + addr + "/ws", role: "admin", code: code, id: "admin-" + IE.deviceId(), name: (CU.config() || {}).name || "Admin" });
    link.on("welcome", function (st, m) { L.state = M.normalize(st); L.pi = m.pi || []; L.info = m.engine; L.error = null; emit("state", L.state); });
    link.on("op", function (op) { if (L.state) { M.apply(L.state, op, { role: "host" }); emit("op", op); } });
    link.on("state", function (st) { L.state = M.normalize(st); emit("state", L.state); });
    link.on("meters", function (m) { L.meters = m; emit("meters", m); });
    link.on("pi", function (names) { L.pi = names || []; emit("pi", L.pi); });
    link.on("refused", function (err) { L.error = err; emit("state", L.state); });
    link.on("status", function (s) { L.linkStatus = s; emit("status", L.hostStatus); });
    link.on("audio", function (pcm, frames, ch, rate, tap) { emit("audio", pcm, frames, ch, rate, tap); });
  }
  function useNone() { if (L.link) { L.link.close(); L.link = null; } L.kind = "none"; L.state = null; emit("state", null); }
  function choose() { if (!(CU.isAdmin ? CU.isAdmin() : CU.mode() === "admin" || CU.mode() === "main")) return useNone(); if (isHost()) { if (L.kind !== "local") useLocal(); } else useRemote(); }
  CU.on("mode", choose); CU.on("audioHost", function () { if (L.kind !== "local") choose(); });
  function op(o) {
    if (L.kind === "local") return NATIVE.op(o);
    if (L.kind === "remote" && L.link) return L.link.op(o);
    return false;
  }
  function listen(tap, onOff, opt) {
    if (L.kind === "local") return NATIVE.listen(tap === "main" ? 0 : tap + 1, onOff);
    if (L.kind === "remote" && L.link) return L.link.listen(tap, onOff, opt);
  }
  // the engine's tap numbers: 0 main, 1..48 mixes; the remote link uses "main" or the mix index
  window.CUMix = { on: on, op: op, listen: listen, choose: choose, refresh: function () { L.remoteAddr = ""; choose(); },
    get state() { return L.state; }, get pi() { return L.pi; }, get meters() { return L.meters; }, get kind() { return L.kind; }, get error() { return L.error; }, get hostStatus() { return L.hostStatus; }, get info() { return L.info; },
    connected: function () { return L.kind === "local" ? !!L.state : !!(L.link && L.link.connected()); }, isHost: isHost, hostAddress: hostAddress,
    live: function () { var o = {}; (L.pi || []).forEach(function (n) { o[n.key] = true; }); return o; } };
  setTimeout(choose, 0);
})();
