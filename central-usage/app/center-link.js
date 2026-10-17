/* Central Control - the link to the center: the MAIN ADMIN's computer. Roles, pairing, the Devices tab, locks,
 * services and the in-ear audio host all go through it, so a team works with no Central Pedal at all.
 * Songs, charts, lyrics and tracks still come from the Central Pedal (app.js keeps that connection); the center
 * says where the Central Pedal is once it has paired, and this computer connects to it by itself.
 *
 * Finding the center:
 *   the main admin                     itself (127.0.0.1)
 *   opened in a phone's browser        from the main admin (http://<main admin>:8095/cu/) - that computer
 *   everyone else                      the address typed in (Settings), then "here is the center" heard on the
 *                                      network (UDP 8097), then what the Central Pedal says (/api/info → center) */
(function () {
  "use strict";
  var CU = window.CentralUsage, NAT = window.CU; if (!CU) return;
  var ROUTED = { cuRole: 1, service: 1 };              // these go to the center only
  var BOTH = { audioHost: 1 };                         // these go to both (phones opened from the Central Pedal find the audio host there)
  var sock = null, target = null, retry = 0, pinger = 0, finding = false, rtt = null, lastView = null, pedalTried = "";
  var fromCenter = CU.web && location.port && location.port !== "8080";   // this page came from the main admin's computer

  function connected() { return !!(sock && sock.readyState === 1); }
  function send(m) { if (connected()) { sock.send(JSON.stringify(m)); return true; } return false; }

  // every module keeps calling CU.send; roles and services go to the center instead of the Central Pedal
  var piSend = CU.send;
  CU.send = function (m) {
    if (m && ROUTED[m.type]) return send(m);
    if (m && BOTH[m.type]) { var a = send(m), b = piSend(m); return a || b; }
    return piSend(m);
  };

  async function find() {
    if (CU.role() === "main" && NAT && NAT.center) {
      try { var st = await NAT.center.status(); if (st && st.on && st.port) return { host: "127.0.0.1", port: st.port, name: "this computer" }; } catch (_) { }
      return null;
    }
    if (CU.role() === "main" && !CU.store.get("centerHost", "")) return null;   // (a main admin in a plain browser: only with a center address typed in - tests)
    if (fromCenter) return { host: location.hostname, port: Number(location.port), name: "" };
    var typed = CU.store.get("centerHost", "");
    if (typed) { var hp = String(typed).split(":"); return { host: hp[0], port: Number(hp[1]) || 8095, name: "" }; }
    if (NAT && NAT.center) {
      try {
        var heard = await NAT.center.heard(), known = CU.store.get("centerName", "");
        if (heard && heard.length) { heard.sort(function (a, b) { return (b.name === known) - (a.name === known) || b.at - a.at; }); return heard[0]; }
      } catch (_) { }
    }
    // the Central Pedal knows where the center is (it paired with it)
    if (CU.state.connected) {
      try { var j = await (await fetch(CU.api("/info"), { cache: "no-store" })).json(); if (j && j.center && j.center.address) return { host: j.center.address, port: j.center.port || 8095, name: j.center.name || "" }; } catch (_) { }
    }
    return null;
  }
  async function connect() {
    clearTimeout(retry); if (finding || connected()) return; finding = true;
    var t = null; try { t = await find(); } catch (_) { }
    finding = false;
    if (!t) { retry = setTimeout(connect, 2500); return; }
    open(t);
  }
  function open(t) {
    target = t;
    try { sock = new WebSocket("ws://" + t.host + ":" + t.port); } catch (_) { sock = null; retry = setTimeout(connect, 2500); return; }
    var s = sock;
    s.onopen = function () {
      if (s !== sock) return;
      if (CU.prefs.code) send({ type: "auth", code: CU.prefs.code });
      clearInterval(pinger); pinger = setInterval(ping, 2000); ping();
      CU.fire("center", true);
    };
    s.onmessage = function (e) {
      if (s !== sock) return;
      var m; try { m = JSON.parse(e.data); } catch (_) { return; }
      if (m.type === "centerPong") { var now = performance.now(), r = now - (m.t || now); rtt = rtt == null ? r : rtt * 0.7 + r * 0.3; return; }
      if (m.type === "auth") return;                   // (the center's answer to the pairing PIN; roles.js does the pairing)
      if (m.type === "cuRoles") onView(m);
      m.fromCenter = true; CU.onMessage(m);
    };
    s.onclose = function () {
      if (s !== sock) return;
      sock = null; clearInterval(pinger); rtt = null; CU.fire("center", false);
      retry = setTimeout(connect, 2000);
    };
    s.onerror = function () { };
  }
  function ping() { send({ type: "ping", t: performance.now() }); }
  function reconnect() { clearTimeout(retry); if (sock) { var s = sock; sock = null; try { s.close(); } catch (_) { } clearInterval(pinger); CU.fire("center", false); } connect(); }

  // the center says where the Central Pedal is: connect to it (songs, charts, lyrics, tracks) with the pairing PIN
  // the track player: the main admin's player window, or the Central Pedal the main admin made the track player.
  // When the main admin gives the job to another pedal, every Central Control moves over to it by itself.
  var following = "";
  function onView(v) {
    lastView = v;
    if (v.centerName && CU.role() !== "main") CU.store.set("centerName", v.centerName);
    var p = v.pedal; if (!p || !p.online) return;
    var addr = p.address || (p.addresses || [])[0]; if (!addr) return;
    var key = p.id + "@" + addr + ":" + (p.wsPort || 8081);
    var there = CU.state.connected && following === key;
    if (there) return;
    if (pedalTried === key && Date.now() - (onView.at || 0) < 15000) return;   // (it is trying already)
    pedalTried = key; onView.at = Date.now(); following = key;
    if (CU.state.connected && window.CURoles) window.CURoles.toast("The tracks now come from " + (p.local ? "the main admin's player" : p.name) + ".");
    CU.connect(addr);
  }
  CU.on("connected", function (on) { if (!on) pedalTried = ""; if (on && !connected()) connect(); if (!on && lastView) setTimeout(function () { if (!CU.state.connected && lastView) { following = ""; onView(lastView); } }, 3000); });
  CU.on("role", function () { if (CU.role() === "main" && target && target.host !== "127.0.0.1") reconnect(); else if (!connected()) connect(); });
  var localStatus = null;   // the center on this computer (main admin): its addresses, for phones and tablets
  if (NAT && NAT.center && NAT.center.on) NAT.center.on(function (st) { localStatus = st; if (CU.role() === "main" && st && st.on && !connected()) connect(); });
  if (NAT && NAT.center) NAT.center.status().then(function (st) { localStatus = st; }).catch(function () { });

  // Settings: the main admin's address, when it is not found by itself (another network segment, a VPN…)
  function setAddress(a) { a = String(a || "").trim(); CU.store.set("centerHost", a); reconnect(); }

  window.CUCenter = {
    connected: connected, send: send, reconnect: reconnect, setAddress: setAddress,
    address: function () { return CU.store.get("centerHost", ""); },
    local: function () { return localStatus; },
    phoneUrls: function () { var st = localStatus; return st && st.on ? (st.addresses || []).map(function (a) { return "http://" + a + ":" + st.port + "/cu/"; }) : []; },
    target: function () { return target; }, player: function () { return lastView && lastView.pedal; }, rtt: function () { return rtt == null ? null : Math.round(rtt); }, view: function () { return lastView; }
  };
  setTimeout(connect, 50);
})();
