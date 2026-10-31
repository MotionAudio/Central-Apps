/* Central Pedal - Settings: the touch screen (by size: small screens on the GPIO pins, HDMI touch screens, ribbon-cable
 * screens - screens.json) and the Wi-Fi (networks, password, hidden networks, the country, forget).
 * The Pi does the work through its root helper (pad-pedal-system screen / wifi); a screen change takes effect after
 * a restart (the button is right there). */
(function () {
  "use strict";
  var PP = window.PP, F = window.PPFeatures; if (!PP || !F) return;
  var esc = PP.escapeHtml;
  function bridge() { return window.__pedalBridge; }
  function connected() { return !!(bridge() && bridge().connected); }
  function send(m) { return F.sendToDriver(m); }
  function rerender() { if (window.PPShell) window.PPShell.renderSystemExtras(); }
  var KIND = { spi: "On the GPIO pins", hdmi: "HDMI touch", dsi: "Ribbon cable (DSI)" };
  var picked = null, tsMsg = "", wfMsg = "", wfBusy = false, lastStatus = null;

  // ------------------------------------------------------------- touch screen
  function screenLabel(s) { return (s.size ? s.size + "\" · " : "") + s.name.replace(/^[\d.]+" ?/, ""); }
  function control() { return document.body.classList.contains("pedal-control"); }   // (Central Pedal Control on a Mac / iPad: no Pi screens or Wi-Fi here)
  function touchHtml(status) {
    lastStatus = status || lastStatus;
    if (control()) return "";
    var st = lastStatus || {}, cat = st.touchScreens || { groups: [], screens: [] }, cur = st.touchScreen || "off", sel = picked || cur;
    if (!connected()) return '<section data-st="screens"><h3>Touch screen</h3><p class="muted">Set on the Central Pedal itself.</p></section>';
    var groups = (cat.groups || []).map(function (g) {
      var list = (cat.screens || []).filter(function (s) { return s.kind === g.id; }).sort(function (a, b) { return (b.size || 0) - (a.size || 0) || a.name.localeCompare(b.name); });
      return '<optgroup label="' + esc(g.name) + '">' + list.map(function (s) { return '<option value="' + esc(s.id) + '"' + (s.id === sel ? " selected" : "") + ">" + esc(screenLabel(s)) + (s.id === cur ? "  ✓ now" : "") + "</option>"; }).join("") + "</optgroup>";
    }).join("");
    var s = (cat.screens || []).filter(function (x) { return x.id === sel; })[0], now = (cat.screens || []).filter(function (x) { return x.id === cur; })[0];
    var info = s ? '<div class="ts-info"><b>' + esc(s.name) + '</b> <span class="ts-kind">' + esc(KIND[s.kind] || "") + (s.res ? " · " + s.res[0] + "×" + s.res[1] : "") + "</span>" +
      (s.also ? '<div class="muted small">' + esc(s.also) + "</div>" : "") +
      '<div class="small">' + (s.driver ? "⬇ Downloads the maker's driver when you apply it (the Central Pedal needs the internet once)." : "✓ Its driver is built into the Central Pedal.") +
      (s.kind === "spi" ? " Central Pedal draws its own remote on it; HDMI 1 keeps the app (Settings → Screens can show a copy)." : " It shows the Central Pedal app; the other HDMI port shows lyrics or chord charts.") + "</div></div>"
      : (sel === "off" ? '<div class="ts-info muted small">No touch screen: HDMI 1 shows the Central Pedal app.</div>' : "");
    var fbs = st.framebuffers || {}, fbNames = Object.keys(fbs).map(function (k) { return k + (fbs[k] ? " (" + fbs[k] + ")" : ""); }).join(", ");
    var spiState = now && now.kind === "spi" && !st.touchScreenPending ? (st.miniScreen ? '<p class="small">✓ The small screen is on: Central Pedal draws its remote on it. ' + (st.miniTouch ? "✓ Its touch panel is found (" + esc(st.miniTouch) + "). Taps land in the wrong place? Calibrate its touch." : '<span class="warn">Its touch panel isn\'t found yet.</span>') + "</p>"
      : '<p class="warn small">The small screen\'s driver didn\'t start (the Pi sees ' + esc(fbNames || "no small screen") + '). Check the board sits on the first 26 pins with nothing shifted, then try the next 3.5" screen in the list (Waveshare 3.5" (A), then (B)) and restart.</p>') : "";
    var pending = st.touchScreenPending, none = !(cat.screens || []).length, has35 = (cat.screens || []).some(function (x) { return x.id === "rpi35-xpt2046"; });
    return '<section data-st="screens" class="ts"><h3>Touch screen</h3>' +
      (none ? '<p class="warn small">The list of screens didn\'t load' + (cat.error ? " (" + esc(cat.error) + ")" : "") + '. Install the newest update (Settings → Software updates), then come back here.</p>' : "") +
      '<p class="muted small">Now: <b>' + esc(now ? now.name : "none") + "</b>" + (pending ? ' <span class="warn">- starts when the pedal restarts</span>' : "") + "</p>" +
      (has35 && sel !== "rpi35-xpt2046" && cur !== "rpi35-xpt2046" ? '<button data-ts="quick35" class="ts-quick">The blue 3.5" screen on the pins (XPT2046 on the back)</button>' : "") +
      spiState +
      '<label>Screen<select data-ts="pick"><option value="off"' + (sel === "off" ? " selected" : "") + ">No touch screen" + (cur === "off" ? "  ✓ now" : "") + "</option>" + groups + "</select></label>" + info +
      '<div class="row"><button class="primary" data-ts="apply"' + (sel === cur && !pending ? " disabled" : "") + ">Use this screen</button>" +
      (pending ? '<button data-ts="restart">Restart now</button>' : "") +
      (now && now.kind === "spi" ? '<button data-ts="calibrate"' + (st.miniScreen ? "" : " disabled") + ">Calibrate its touch</button>" + '<button data-ts="touchTest"' + (st.miniScreen ? "" : " disabled") + ">Test its touch</button>" : "") + "</div>" +
      (tsMsg ? '<p class="small ' + (/^✓/.test(tsMsg) ? "" : "warn") + '">' + esc(tsMsg) + "</p>" : "") +
      '<p class="muted small">Not sure which one? The blue 3.5" board with "XPT2046 Touch Controller" printed on the back is the first one (3.5" RPi Display). Something wrong after the restart? Plug in an HDMI monitor and pick another screen, or "No touch screen".</p></section>';
  }
  F.on("touchScreenResult", function (m) {
    tsMsg = m.ok ? "✓ " + (m.name || "Saved") + (m.restart ? " - the pedal restarts by itself to start it." : ".") : (m.error || "Not changed.");
    if (m.ok) { picked = null; if (lastStatus) { lastStatus.touchScreen = m.screen; lastStatus.touchKind = m.kind; lastStatus.touchScreenPending = !!m.restart; } }
    PP.setStatus(tsMsg); rerender(); send({ type: "system", action: "status" });
    if (m.ok && m.restart && window.PPAutoRestart) window.PPAutoRestart.ask("the " + (m.name || "new touch screen"));   // (its driver loads when the Pi starts)
  });

  // ------------------------------------------------------------- Wi-Fi
  var COUNTRIES = [["US", "United States"], ["CA", "Canada"], ["MX", "Mexico"], ["GB", "United Kingdom"], ["IE", "Ireland"], ["AU", "Australia"], ["NZ", "New Zealand"], ["DE", "Germany"], ["FR", "France"], ["ES", "Spain"], ["IT", "Italy"], ["NL", "Netherlands"], ["BR", "Brazil"], ["ZA", "South Africa"], ["NG", "Nigeria"], ["KE", "Kenya"], ["IN", "India"], ["PH", "Philippines"], ["KR", "South Korea"], ["JP", "Japan"]];
  function bars(sig) { var n = sig >= 75 ? 4 : sig >= 50 ? 3 : sig >= 25 ? 2 : 1; return '<span class="wf-bars" title="' + sig + '%">' + [1, 2, 3, 4].map(function (i) { return '<i class="' + (i <= n ? "on" : "") + '"></i>'; }).join("") + "</span>"; }
  function wifiHtml(status, wifi) {
    if (control()) return "";
    if (!connected()) return '<section data-st="network"><h3>Wi-Fi</h3><p class="muted">Available on the Central Pedal itself.</p></section>';
    var w = wifi || {}, cc = w.country || "US";
    var list = (w.networks || []).map(function (n) {
      return '<button data-wf="net" data-ssid="' + esc(n.ssid) + '" data-open="' + (n.security ? "" : "1") + '"' + (n.active ? ' class="on"' : "") + ">" + bars(n.signal) + " " + esc(n.ssid) + (n.security ? ' <small title="' + esc(n.security) + '">🔒</small>' : ' <small>open</small>') + (n.active ? " <small>✓ connected</small>" : "") + "</button>";
    }).join("");
    return '<section data-st="network" class="wf"><h3>Wi-Fi</h3>' +
      '<p class="' + (w.connected ? "" : "muted") + '">' + (wifi ? (w.connected ? "✓ Connected to <b>" + esc(w.connected) + "</b>" + (w.signal != null ? " (" + w.signal + "%)" : "") : "Not connected to Wi-Fi") + (w.addresses && w.addresses.length ? ' <span class="muted small">· ' + w.addresses.map(esc).join(", ") + "</span>" : "") : "Checking…") + "</p>" +
      (w.error ? '<p class="warn small">' + esc(w.error) + "</p>" : "") +
      (wfMsg ? '<p class="small ' + (/^✓|^Connecting/.test(wfMsg) ? "" : "warn") + '">' + (wfBusy ? "⏳ " : "") + esc(wfMsg) + "</p>" : "") +
      '<div class="wifi-list">' + (list || (wifi ? '<span class="muted small">No networks found yet - Scan again.</span>' : "")) + "</div>" +
      '<div class="row"><button data-wf="scan">Scan again</button><button data-wf="other">Other network…</button>' + (w.connected ? '<button data-wf="forget">Forget this network</button>' : "") +
      '<label class="wf-cc">Country<select data-wf="country">' + COUNTRIES.map(function (c) { return '<option value="' + c[0] + '"' + (c[0] === cc ? " selected" : "") + ">" + c[1] + "</option>"; }).join("") + (COUNTRIES.some(function (c) { return c[0] === cc; }) ? "" : '<option value="' + esc(cc) + '" selected>' + esc(cc) + "</option>") + "</select></label></div>" +
      '<p class="muted small">The Wi-Fi radio follows the country\'s rules - set yours, or some networks (5 GHz channels) stay hidden. A cable in the Ethernet port works too.</p>' +
      phoneHtml(status) + "</section>";
  }
  // phone setup: the pedal's own Wi-Fi "Central Pedal Setup" (it comes on by itself when the pedal has no network)
  function phoneHtml(status) {
    var ps = (status && status.phoneSetup) || phone;
    if (!ps) return "";
    return '<div class="wf-phone"><h4>Set up from a phone</h4>' +
      (ps.on ? '<p>The setup Wi-Fi is on: on a phone, join <b>' + esc(ps.ssid || "Central Pedal Setup") + '</b> - the setup page opens by itself (or go to ' + esc(ps.address || "http://10.42.0.1/") + ').</p><div class="row"><button data-wf="phoneOff">Turn the setup Wi-Fi off</button></div>'
        : '<p class="muted small">The pedal makes its own Wi-Fi, <b>' + esc(ps.ssid || "Central Pedal Setup") + '</b>, for a phone to pick the church Wi-Fi, the touch screen and the code. It comes on by itself when the pedal has no network. While it is on, the pedal is off the church Wi-Fi.</p><div class="row"><button data-wf="phoneOn">Turn the setup Wi-Fi on</button></div>') +
      (ps.error ? '<p class="warn small">' + esc(ps.error) + "</p>" : "") + "</div>";
  }
  var phone = null;
  function phoneDialog() {
    var d = document.getElementById("phoneSetupDialog");
    if (!phone || !phone.on || control()) { if (d && d.open) d.close(); return; }
    if (!d) {
      d = document.createElement("dialog"); d.id = "phoneSetupDialog"; d.className = "pin-dialog";
      document.body.appendChild(d);
      d.addEventListener("click", function (e) { if (e.target.closest("[data-wf=phoneOff]")) d.close(); });
    }
    d.innerHTML = "<h2>Please connect to <b>" + esc(phone.ssid || "Central Pedal Setup") + "</b> on your phone's Wi-Fi</h2><ol><li>The setup page opens by itself (or go to " + esc(phone.address || "http://10.42.0.1/") + ").</li><li>Pick the church Wi-Fi and type its password.</li><li>Type the 4-digit code, then Upload. The pedal connects to the internet by itself.</li></ol>" +
      (phone.error ? '<p class="warn">' + esc(phone.error) + "</p>" : "") +
      '<p class="muted small">Or set the Wi-Fi up here: Not now, then Settings → Wi-Fi.</p><div class="row"><button data-wf="phoneOff">Not now</button></div>';
    if (!d.open) d.showModal();
  }
  F.on("phoneSetup", function (m) { phone = m; phoneDialog(); rerender(); });
  function connect(ssid, pw, hidden) { wfBusy = true; wfMsg = "Connecting to " + ssid + "…"; rerender(); send({ type: "system", action: "wifi", ssid: ssid, password: pw || "", hidden: !!hidden }); PP.setStatus(wfMsg); }
  F.on("wifiResult", function (m) {
    wfBusy = !!m.busy; wfMsg = m.busy ? m.message : (m.ok ? "✓ " : "") + (m.message || (m.ok ? "Done" : "Could not connect."));
    PP.setStatus(wfMsg); rerender();
  });

  // ------------------------------------------------------------- clicks
  document.addEventListener("change", function (e) {
    var t = e.target; if (!t.dataset) return;
    if (t.dataset.ts === "pick") { picked = t.value; tsMsg = ""; rerender(); }
    else if (t.dataset.wf === "country") { send({ type: "system", action: "wifiCountry", value: t.value }); wfMsg = "Setting the Wi-Fi country…"; rerender(); }
  });
  document.addEventListener("click", async function (e) {
    var b = e.target.closest && e.target.closest("[data-ts],[data-wf]"); if (!b || b.tagName === "SELECT") return;
    var a = b.dataset.ts || b.dataset.wf;
    if (b.dataset.ts === "quick35") { picked = "rpi35-xpt2046"; tsMsg = ""; rerender(); return; }
    if (b.dataset.ts === "apply") {
      var id = picked || (lastStatus && lastStatus.touchScreen) || "off";
      tsMsg = "Setting up the screen…"; rerender(); send({ type: "system", action: "touchScreen", value: id });
    } else if (b.dataset.ts === "restart") {
      if (window.PPAutoRestart) window.PPAutoRestart.ask("the new touch screen");
      else { PP.persistNow(); send({ type: "system", action: "reboot" }); PP.setStatus("Restarting…"); }
    } else if (b.dataset.ts === "calibrate") { send({ type: "hardware", action: "calibrateTouch" }); PP.setStatus("Touch the five crosses on the small screen, then tap the dot and SAVE"); }
    else if (b.dataset.ts === "touchTest") { send({ type: "hardware", action: "touchTest" }); PP.setStatus("Touch test on the small screen: dots where you tap, its numbers at the top"); }
    else if (a === "phoneOn") { send({ type: "system", action: "phoneSetup", value: "on" }); PP.setStatus("Turning the setup Wi-Fi on…"); }
    else if (a === "phoneOff") { send({ type: "system", action: "phoneSetup", value: "off" }); if (phone) phone.on = false; phoneDialog(); rerender(); }
    else if (a === "scan") { wfMsg = "Scanning…"; wfBusy = true; rerender(); send({ type: "system", action: "wifi" }); setTimeout(function () { if (wfMsg === "Scanning…") { wfMsg = ""; wfBusy = false; rerender(); } }, 20000); }
    else if (a === "net") {
      var ssid = b.dataset.ssid;
      if (b.dataset.open === "1") return connect(ssid, "");
      var pw = await PP.ask("Password for " + ssid, { password: true, ok: "Connect" }); if (pw === null) return;
      connect(ssid, pw);
    } else if (a === "other") {
      var name = await PP.ask("Network name (exactly as it is, for a hidden network)", { ok: "Next" }); if (!name) return;
      var pw2 = await PP.ask("Password for " + name + " (leave empty if it has none)", { password: true, ok: "Connect" }); if (pw2 === null) return;
      connect(name.trim(), pw2, true);
    } else if (a === "forget") { if (confirm("Forget this Wi-Fi network? The Central Pedal disconnects from it.")) send({ type: "system", action: "wifiForget" }); }
  });
  F.on("systemStatus", function (m) { lastStatus = m; if (m.phoneSetup) { var was = phone && phone.on; phone = m.phoneSetup; if (!!phone.on !== !!was) phoneDialog(); } if (!m.busy && wfMsg === "Scanning…") { wfMsg = ""; wfBusy = false; } });
  window.PPTouchWifi = { touchHtml: touchHtml, wifiHtml: wifiHtml };
})();
