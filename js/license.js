/* Central Pedal / Central Pedal Control / Central Control / Central Usage - the license key and the first-open setup.
 * When an app first opens: 1. the internet (Wi-Fi on the Central Pedal), 2. the production's name, 3. the license key
 * (P = Central Pedal and Central Pedal Control, A = Central Control for admins, U = Central Usage for users), 4. the
 * account (admins can all share one account; each user has their own). The key works on one device at a time: it is
 * checked on the Motion Audio website when it is entered (so it can't be used on another device too), again whenever
 * the app opens online, and at least every 30 days (it keeps working 30 days without internet).
 * Settings → License → Release key frees it for another device (the website can release it too, for a lost device).
 * The same file runs in both apps (Central Control / Usage get a copy in app/shared/ - prepare-shared.sh).
 * Licensing is on when SERVER is set (the website's address) and REQUIRED is true. */
(function () {
  "use strict";
  var SERVER = "";          // the Motion Audio website, e.g. "https://motion-audio.onrender.com" (empty: licensing is off)
  var REQUIRED = true;      // (with a SERVER: the apps need a key)
  var o = window.PP_LICENSE_CONFIG || {};   // (tests, or a build that points somewhere else)
  if (o.server != null) SERVER = o.server;
  if (o.required != null) REQUIRED = o.required;
  var LS = "cc-license", DEV = "cc-device-id";
  var KIND_OF = { pedal: "P", "pedal-control": "P", control: "A", usage: "U" };
  var NAME_OF = { pedal: "Central Pedal", "pedal-control": "Central Pedal Control", control: "Central Control", usage: "Central Usage" };
  var KIND_NAME = { P: "P key (Central Pedal / Central Pedal Control)", A: "A key (Central Control - admins)", U: "U key (Central Usage - users)" };
  var DAY = 864e5;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function load() { try { return JSON.parse(localStorage.getItem(LS) || "null"); } catch (_) { return null; } }
  function save(s) { try { if (s) localStorage.setItem(LS, JSON.stringify(s)); else localStorage.removeItem(LS); } catch (_) { } if (opts && opts.persist) try { opts.persist(s); } catch (_) { } }   // (persist: the Central Pedal keeps a copy with its driver)
  function deviceId() {
    var d = null; try { d = localStorage.getItem(DEV); } catch (_) { }
    var u = (location.search.match(/[?&]cudev=([A-Za-z0-9-]{8,80})/) || [])[1];   // (the phone app's own id: Central Usage comes from the main admin's address)
    if (u && u !== d) { d = u; try { localStorage.setItem(DEV, d); } catch (_) { } }
    var b = window.__pedalBridge, hw = (opts && opts.deviceId) || (b && b.info && b.info.deviceId);   // (the computer's own id from the driver: the same after a reinstall)
    if (!d && hw && /^[A-Za-z0-9-]{8,80}$/.test(hw)) { d = hw; try { localStorage.setItem(DEV, d); } catch (_) { } }
    if (!d || !/^[A-Za-z0-9-]{8,80}$/.test(d)) {
      var a = new Uint8Array(12); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach(function (_, i) { a[i] = Math.random() * 256; });
      d = "dev-" + Array.from(a).map(function (x) { return ("0" + x.toString(16)).slice(-2); }).join("");
      try { localStorage.setItem(DEV, d); } catch (_) { }
    }
    return d;
  }
  function pretty(k) { var c = String(k || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 24); return c.replace(/(.{4})(?=.)/g, "$1-"); }
  function base() { return String(SERVER || "").replace(/\/+$/, ""); }
  function on() { return !!(base() && REQUIRED); }
  async function call(path, body, token) {
    var h = { "Content-Type": "application/json" }; if (token) h.Authorization = "Bearer " + token;
    var ctl = window.AbortController ? new AbortController() : null, t = ctl ? setTimeout(function () { ctl.abort(); }, 12000) : 0;
    try {
      var r = await fetch(base() + "/v1" + path, { method: body === undefined ? "GET" : "POST", headers: h, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store", signal: ctl ? ctl.signal : undefined });
      var j = await r.json().catch(function () { return {}; });
      if (!r.ok) { var e = new Error(j.error || ("The website answered " + r.status)); e.status = r.status; throw e; }
      return j;
    } finally { clearTimeout(t); }
  }
  async function online() {   // (15 s: the website may be waking up)
    try { var ctl = window.AbortController ? new AbortController() : null, t = ctl ? setTimeout(function () { ctl.abort(); }, 15000) : 0; var r = await fetch(base() + "/health", { cache: "no-store", signal: ctl ? ctl.signal : undefined }); clearTimeout(t); return r.ok; }
    catch (_) { return false; }
  }

  // ------------------------------------------------------------- state
  var app = null, opts = {}, st = load(), ui = { step: 0, msg: "", busy: false, net: null, signup: false }, el = null, ready = false, waiters = [];
  function licensed() { return !!(st && st.key && st.okAt && st.app && KIND_OF[st.app] === KIND_OF[app] && !st.blocked); }
  function complete() { return licensed() && !!(st.account && st.account.email); }   // (the key and the account)
  function daysLeft() { return st && st.okAt ? Math.max(0, Math.ceil(((st.recheckDays || 30) * DAY - (Date.now() - st.okAt)) / DAY)) : 0; }

  // the check when the app opens (and every 6 hours): it keeps working offline for 30 days after the last good check
  async function recheck() {
    if (!on() || !st || !st.key) return;
    try {
      var r = await call("/license/check", { key: st.key, device: deviceId() });
      if (r.ok) { st.okAt = Date.now(); st.church = r.church || st.church; st.recheckDays = r.recheckDays || 30; st.blocked = null; save(st); }
      else { st.blocked = r.reason === "elsewhere" ? "This key is now used on “" + (r.device || "another device") + "”. Enter another key, or release it there." : r.reason === "released" ? "This key was released (on the website or another device). Enter it again, or another key." : "This key no longer works. Enter another key."; save(st); }
    } catch (e) {
      if (st.okAt && Date.now() - st.okAt > (st.recheckDays || 30) * DAY) { st.blocked = "Connect to the internet so this device can check its key (it hasn't been checked for " + (st.recheckDays || 30) + " days)."; save(st); }
    }
    if (!complete()) open();
    else if (el) close();
  }

  // ------------------------------------------------------------- the setup screen
  var STEPS = ["Internet", "Production", "License key", "Account"];
  function css() {
    if (document.getElementById("licCss")) return;
    var s = document.createElement("style"); s.id = "licCss";
    s.textContent = "dialog#licWiz{position:fixed;inset:0;width:100%;height:100%;max-width:none;max-height:none;margin:0;border:0;z-index:2147483000;background:var(--bg,#08111d);color:var(--text,#ecf7ff);display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto;font:15px/1.45 system-ui,sans-serif;box-sizing:border-box}" +
      "dialog#licWiz::backdrop{background:var(--bg,#08111d)}" +
      "#licWiz .lw{width:min(560px,100%);background:var(--panel,#101e31);border:1px solid var(--line,#294966);border-radius:16px;padding:20px;display:grid;gap:12px}" +
      "#licWiz h2{margin:0;font-size:21px}#licWiz .lw-steps{display:flex;gap:6px;flex-wrap:wrap}#licWiz .lw-steps span{font-size:12px;padding:3px 8px;border-radius:99px;border:1px solid var(--line,#294966);color:var(--muted,#8fa7bf)}" +
      "#licWiz .lw-steps span.on{background:var(--accent,#5de6b0);color:#04131f;border-color:transparent}#licWiz .lw-steps span.done{color:var(--accent,#5de6b0)}" +
      "#licWiz label{display:grid;gap:4px;font-size:14px;color:var(--muted,#8fa7bf)}#licWiz input,#licWiz select{font:inherit;padding:10px;border-radius:10px;border:1px solid var(--line,#294966);background:#071321;color:inherit}" +
      "#licWiz input.lw-key{font:600 20px/1.2 ui-monospace,monospace;letter-spacing:.06em;text-transform:uppercase}#licWiz .row{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}" +
      "#licWiz button{font:inherit;padding:10px 16px;border-radius:10px;border:1px solid var(--line,#294966);background:#13253b;color:inherit;cursor:pointer}#licWiz button.primary{background:var(--accent,#5de6b0);color:#04131f;border-color:transparent;font-weight:600}" +
      "#licWiz button:disabled{opacity:.5}#licWiz .muted{color:var(--muted,#8fa7bf);font-size:13px}#licWiz .bad{color:#ff8a8a}#licWiz .ok{color:var(--accent,#5de6b0)}#licWiz .wifi-list{display:grid;gap:6px;max-height:220px;overflow:auto}" +
      "#licWiz .wifi-list button{text-align:left}#licWiz section{border:0;padding:0}#licWiz .tabs{display:flex;gap:6px}#licWiz .tabs button.on{border-color:var(--accent,#5de6b0)}";
    document.head.appendChild(s);
  }
  function wifiPanel() {   // the Central Pedal's own Wi-Fi list (js/touch-wifi.js does the connecting)
    if (app !== "pedal" || !window.PPTouchWifi || !(window.__pedalBridge && window.__pedalBridge.connected)) return '<p class="muted">Connect this ' + (app === "usage" || app === "pedal-control" ? "device" : "computer") + " to Wi-Fi (or a cable) in its own settings, then press Try again.</p>";
    return window.PPTouchWifi.wifiHtml(null, ui.wifi || null) || "";
  }
  function html() {
    var s = ui.step, kind = KIND_OF[app], head = '<h2>' + esc(NAME_OF[app] || "Central") + (st && st.blocked && s === 2 ? " - enter a key" : " - let's set it up") + "</h2>" +
      '<div class="lw-steps">' + STEPS.map(function (n, i) { return '<span class="' + (i === s ? "on" : i < s ? "done" : "") + '">' + (i < s ? "✓ " : (i + 1) + ". ") + n + "</span>"; }).join("") + "</div>";
    var body = "", btns = "";
    if (s === 0) {
      body = ui.net === true ? '<p class="ok">✓ Connected to the internet.</p>' : ui.net === false ? (navigator.onLine === false ? '<p class="bad">Not connected to the internet yet.</p>' + wifiPanel()
        : '<p class="bad">Can’t reach the Motion Audio website.</p><p class="muted">Check that this ' + (app === "pedal" ? "pedal" : "device") + ' is on the internet. If it is, the website may be busy: try again in a minute.</p>' + (app === "pedal" ? wifiPanel() : "")) : "<p>Checking the internet…</p>";
      btns = (ui.net === false ? '<button data-lw="retry">Try again</button>' : "") + '<button class="primary" data-lw="next"' + (ui.net === true ? "" : " disabled") + ">Next</button>";
    } else if (s === 1) {
      body = '<label>Your church or production’s name<input id="lwProd" value="' + esc((st && st.production) || opts.production || "") + '" placeholder="Grace Church" autocomplete="organization"></label>' +
        '<p class="muted">It names this setup on this ' + (app === "pedal" ? "pedal" : "device") + ". Your keys and your people are on your church's account on the Motion Audio website.</p>";
      btns = '<button data-lw="back">Back</button><button class="primary" data-lw="prod">Next</button>';
    } else if (s === 2) {
      body = (st && st.blocked ? '<p class="bad">' + esc(st.blocked) + "</p>" : "") +
        '<label><span>License key - it starts with <b>' + kind + "</b> · " + esc({ P: "Central Pedal / Central Pedal Control", A: "Central Control (admins)", U: "Central Usage (users)" }[kind]) + '</span><input id="lwKey" class="lw-key" maxlength="29" value="' + esc(pretty(ui.key || (st && st.key) || opts.presetKey || "")) + '" placeholder="' + kind + 'XXX-XXXX-XXXX-XXXX" autocomplete="off" spellcheck="false"></label>' +
        '<label>This device’s name (so you know it on the website)<input id="lwDev" value="' + esc(ui.devName || (st && st.deviceName) || opts.deviceName || NAME_OF[app]) + '"></label>' +
        '<p class="muted">The key is in the email from your church and on your church’s page on the website. ' + (kind === "A" || app === "pedal" ? "It works on one device at a time" : "It works on two devices (for example the church’s and your own) with the same account and the same settings") + '; Settings → License → Release key frees a device for another.</p>';
      btns = '<button data-lw="back">Back</button><button class="primary" data-lw="key"' + (ui.busy ? " disabled" : "") + ">" + (ui.busy ? "Checking…" : "Use this key") + "</button>";
    } else if (s === 3) {
      var su = ui.signup;
      body = '<p>' + (st && st.church ? "Key ✓ · <b>" + esc(st.church) + "</b>. " : "Key ✓. ") + (kind === "U" ? "Sign in with <b>your own</b> account (each user has their own)." : "Sign in with your church’s admin account (all admins can share one), or your own.") + "</p>" +
        '<div class="tabs"><button data-lw="in" class="' + (su ? "" : "on") + '">Sign in</button><button data-lw="up" class="' + (su ? "on" : "") + '">Make an account</button></div>' +
        (su ? '<label>Name<input id="lwName" autocomplete="name"></label>' : "") +
        '<label>Email<input id="lwEmail" type="email" autocomplete="username" value="' + esc(ui.email || "") + '"></label><label>Password' + (su ? " (8+ characters)" : "") + '<input id="lwPass" type="password" autocomplete="' + (su ? "new-password" : "current-password") + '"></label>';
      btns = '<button class="primary" data-lw="acct"' + (ui.busy ? " disabled" : "") + ">" + (ui.busy ? "One moment…" : su ? "Make account" : "Sign in") + "</button>";
    }
    return '<div class="lw">' + head + body + (ui.msg ? '<p class="' + (/^✓/.test(ui.msg) ? "ok" : "bad") + '">' + esc(ui.msg) + "</p>" : "") + '<div class="row">' + btns + "</div></div>";
  }
  function draw() { if (!el) return; var a = document.activeElement, keep = a && el.contains(a) && a.tagName === "INPUT" ? a.id : null, val = keep ? a.value : null; el.innerHTML = html(); if (keep && document.getElementById(keep)) { var n = document.getElementById(keep); n.value = val; n.focus(); } }
  function open() {
    if (!on()) return;
    css();
    if (!el) {   // (a modal dialog: on top of everything, nothing behind it can be touched)
      el = document.createElement("dialog"); el.id = "licWiz"; document.body.appendChild(el); wire();
      el.addEventListener("cancel", function (e) { e.preventDefault(); });   // (Escape doesn't skip it)
      el.addEventListener("close", function () { var me = el; setTimeout(function () { if (me && me === el && !complete()) { try { me.showModal(); } catch (_) { } } }, 0); });   // (nor a second Escape, or Android's back)
    }
    if (!el.open) { try { el.showModal(); } catch (_) { el.setAttribute("open", ""); } }
    if (licensed() && !(st.account && st.account.email)) ui.step = 3;   // (key done, the account not yet)
    else if (st && st.blocked) ui.step = 0;
    draw();
    if (ui.step === 0) checkNet();
  }
  function close() { if (el) { try { el.close(); } catch (_) { } el.remove(); el = null; } markReady(); }
  function markReady() { if (ready) return; ready = true; waiters.splice(0).forEach(function (f) { try { f(); } catch (_) { } }); }
  async function checkNet() {
    ui.net = null; draw();
    var ok = await online(); ui.net = ok; ui.msg = ""; draw();
    if (!ok && app === "pedal" && window.PPFeatures) window.PPFeatures.sendToDriver({ type: "system", action: "wifi" });   // (the Wi-Fi list)
    if (ok && ui.step === 0) { ui.step = st && st.production ? 2 : 1; draw(); }   // already online (Wi-Fi or a cable): the Wi-Fi step is skipped
  }
  async function useKey() {
    var key = (document.getElementById("lwKey") || {}).value || "", dn = ((document.getElementById("lwDev") || {}).value || "").trim();
    ui.key = key; ui.devName = dn;
    var c = key.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (c.length < 12 || c.length > 24) { ui.msg = "A key has 16 letters and digits."; return draw(); }
    if (c.length === 16 && c[0] !== KIND_OF[app]) { ui.msg = "That's " + (KIND_NAME[c[0]] ? "a " + KIND_NAME[c[0]] : "not a key for this app") + ". " + NAME_OF[app] + " needs a key that starts with " + KIND_OF[app] + "."; return draw(); }
    ui.busy = true; ui.msg = ""; draw();
    try {
      var r = await call("/license/activate", { key: key, device: deviceId(), deviceName: dn || NAME_OF[app], app: app, production: st && st.production });
      st = Object.assign(st || {}, { key: r.key, kind: r.kind, app: app, church: r.church || "", okAt: Date.now(), recheckDays: r.recheckDays || 30, deviceName: dn || NAME_OF[app], blocked: null });
      save(st); ui.step = 3; ui.msg = "";
      if (r.account && r.account.email && !ui.email) ui.email = r.account.email;   // (the key was given to this person: their email is filled in)
      if (st.account && st.account.token) { await link(st.account.token).catch(function () { }); }
    } catch (e) { ui.msg = e.name === "AbortError" ? "The website didn't answer. Check the internet and try again." : e.message; }
    ui.busy = false; draw();
    if (ui.step === 3 && st.account && st.account.email) finish();
  }
  async function link(token) { var r = await call("/license/link", { key: st.key, device: deviceId() }, token); if (r.church) st.church = r.church; return r; }
  async function account() {
    var email = ((document.getElementById("lwEmail") || {}).value || "").trim(), pw = (document.getElementById("lwPass") || {}).value || "", name = ((document.getElementById("lwName") || {}).value || "").trim();
    ui.email = email;
    if (!email || !pw) { ui.msg = "Enter your email and password."; return draw(); }
    ui.busy = true; ui.msg = ""; draw();
    try {
      var r = await call(ui.signup ? "/signup" : "/login", ui.signup ? { email: email, password: pw, name: name } : { email: email, password: pw });
      await link(r.token);
      st.account = { email: email, token: r.token }; save(st);
      shareToken(r.token); setTimeout(pullAll, 0);   // (this account's settings come down now)
      ui.busy = false; finish();
    } catch (e) { ui.busy = false; ui.msg = e.message; draw(); }
  }
  function shareToken(token) {   // the same account signs in to Central Tracks in Central Pedal / Central Pedal Control
    if (app !== "pedal" && app !== "pedal-control") return;
    try { var c = JSON.parse(localStorage.getItem("central-tracks") || "{}"); if (!c.server) c.server = base(); if (c.server === base()) c.token = token; localStorage.setItem("central-tracks", JSON.stringify(c)); } catch (_) { }
  }
  function finish() { ui.msg = ""; close(); if (opts.onReady) try { opts.onReady(st); } catch (_) { } }
  function wire() {
    el.addEventListener("click", function (e) {
      var b = e.target.closest("[data-lw]"); if (!b) return; var a = b.dataset.lw;
      if (a === "retry") checkNet();
      else if (a === "next") { ui.step = 1; draw(); }
      else if (a === "back") { ui.step = Math.max(0, ui.step - 1); ui.msg = ""; draw(); }
      else if (a === "prod") { var p = ((document.getElementById("lwProd") || {}).value || "").trim(); if (!p) { ui.msg = "Give it a name."; return draw(); } st = Object.assign(st || {}, { production: p }); save(st); if (opts.onProduction) try { opts.onProduction(p); } catch (_) { } ui.step = 2; ui.msg = ""; draw(); }
      else if (a === "key") useKey();
      else if (a === "in" || a === "up") { ui.signup = a === "up"; ui.msg = ""; draw(); }
      else if (a === "acct") account();
    });
    el.addEventListener("keydown", function (e) { if (e.key === "Enter") { var b = el.querySelector("button.primary"); if (b && !b.disabled) { e.preventDefault(); b.click(); } } });
    el.addEventListener("input", function (e) { if (e.target.id === "lwKey") { var p0 = e.target.selectionStart, before = e.target.value; e.target.value = pretty(before); if (p0 === before.length) e.target.selectionStart = e.target.selectionEnd = e.target.value.length; } });
  }

  // ------------------------------------------------------------- Settings → License
  function settingsHtml(cls) {
    if (!on()) return "";
    var s = st || {};
    return '<section class="' + (cls || "") + '" data-st="license" id="licSettings"><h3>License</h3>' +
      (licensed() ? "<p>✓ " + esc(NAME_OF[app]) + " · " + esc(KIND_NAME[s.kind] || "") + "</p>" +
        '<p class="muted">Key <code>' + esc(s.key ? s.key.slice(0, 4) + "-••••-••••-" + s.key.slice(-4) : "") + "</code>" + (s.church ? " · " + esc(s.church) : "") + (s.production ? " · " + esc(s.production) : "") +
        " · this device: " + esc(s.deviceName || "") + " · checked " + new Date(s.okAt).toLocaleDateString() + " (works offline " + daysLeft() + " more days)" + (s.account && s.account.email ? " · account " + esc(s.account.email) : "") + "</p>" +
        '<div class="row"><button data-lic="release">Release key</button>' + (s.account && s.account.email ? '<button data-lic="signout">Sign out of the account</button>' : '<button data-lic="account">Sign in</button>') + "</div>" +
        '<p class="muted">Release key frees it for another device; this one asks for a key again. For a lost or broken device, release its key on the website (your church’s page).</p>'
        : '<p class="bad">No key on this device.</p><button data-lic="enter">Enter a key</button>') + "</section>";
  }
  async function release() {
    if (!st || !st.key) return;
    if (!confirm("Release this key? " + NAME_OF[app] + " on this device stops until a key is entered again, and the key can be used on another device.")) return;
    try { await call("/license/release", { key: st.key, device: deviceId() }); }
    catch (e) { if (!confirm("The website couldn't be reached (" + e.message + "). Release it here anyway? Then release it on the website too.")) return; }
    var keep = { production: st.production, account: st.account }; st = keep; save(st);   // (released: this device keeps its name and its account)
    ui.step = 2; ui.key = ""; ui.msg = "✓ Released. Enter a key to use " + NAME_OF[app] + " here again."; open();
    if (opts.onChange) try { opts.onChange(); } catch (_) { }
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-lic]"); if (!b) return;
    var a = b.dataset.lic;
    if (a === "release") release();
    else if (a === "enter") { ui.step = 0; open(); }
    else if (a === "account") { ui.step = 3; open(); }
    else if (a === "signout") { if (st) { delete st.account; save(st); } if (opts.onChange) opts.onChange(); }
  });

  // ------------------------------------------------------------- settings that follow the account
  // An app registers what to keep in step (get: its preferences now; apply: preferences from the account). The newest
  // change wins: a change here goes up a few seconds later, and every few minutes (and when the window comes back) the
  // account's copy comes down - so the church's device and the one at home, signed in to the same account, match.
  var syncs = {}, SYNC_LS = "central-license-sync";
  function syncStamps() { try { return JSON.parse(localStorage.getItem(SYNC_LS) || "{}"); } catch (_) { return {}; } }
  function setStamp(name, t) { var m = syncStamps(); m[name] = t; try { localStorage.setItem(SYNC_LS, JSON.stringify(m)); } catch (_) { } }
  function token() { return st && st.account && st.account.token; }
  function syncSettings(name, o) { syncs[name] = { get: o.get, apply: o.apply, timer: 0, dirty: false }; pull(name); }
  async function pull(name) {
    var s = syncs[name]; if (!s || !on() || !token() || s.dirty) return;
    try {
      var r = await call("/settings/" + encodeURIComponent(name), undefined, token()), mine = syncStamps()[name] || 0;
      if (r.data && r.updated > mine) { setStamp(name, r.updated); try { s.apply(r.data); } catch (_) { } }
      else if (mine > (r.updated || 0) || !r.data) push(name);   // (changed here while offline; or the account has none yet)
    } catch (e) { if (e.status === 401 && st && st.account) { /* signed out on the website: the wizard asks again at the next check */ } }
  }
  async function push(name) {
    var s = syncs[name]; if (!s || !on() || !token()) return;
    var t = Date.now(), data; try { data = s.get(); } catch (_) { return; } if (!data) return;
    setStamp(name, t);
    try { await call("/settings/" + encodeURIComponent(name), { data: data, updated: t }, token()); s.dirty = false; } catch (_) { s.dirty = false; }
  }
  function settingsChanged(name) {
    var s = syncs[name]; if (!s) return;
    s.dirty = true; setStamp(name, Date.now()); clearTimeout(s.timer); s.timer = setTimeout(function () { push(name); }, 3000);
  }
  function pullAll() { Object.keys(syncs).forEach(pull); }
  setInterval(pullAll, 3 * 60e3);
  window.addEventListener("focus", function () { setTimeout(pullAll, 500); });

  // ------------------------------------------------------------- start
  function init(o2) {
    opts = o2 || {}; app = opts.app; st = load();
    if (!st && opts.saved && opts.saved.key) { st = opts.saved; try { localStorage.setItem(LS, JSON.stringify(st)); } catch (_) { } }   // (this browser forgot it: the Central Pedal's driver kept a copy)
    if (!KIND_OF[app] || !on()) { markReady(); return; }   // (the player window inside Central Control; licensing off)
    if (st && st.app && KIND_OF[st.app] !== KIND_OF[app]) st = { production: st.production };   // (a key for another app)
    if (complete()) { markReady(); recheck(); }
    else open();
    setInterval(recheck, 6 * 3600e3);
    if (window.PPFeatures) { window.PPFeatures.on("systemStatus", function (m) { if (m.wifi) { ui.wifi = m.wifi; if (el && ui.step === 0) draw(); } }); window.PPFeatures.on("wifiResult", function (m) { if (el && ui.step === 0 && m.ok) setTimeout(checkNet, 2500); }); }
  }
  // the driver's hello came late (a Central Pedal still starting): the key on its card, its id, its saved copy
  function update(o2) {
    Object.keys(o2 || {}).forEach(function (k) { if (o2[k] != null && o2[k] !== "") opts[k] = o2[k]; });
    if (!st || !st.key) { if (o2 && o2.saved && o2.saved.key) { st = o2.saved; try { localStorage.setItem(LS, JSON.stringify(st)); } catch (_) { } if (complete()) { close(); recheck(); return; } } }
    if (el) draw();
  }
  window.PPLicense = { init: init, update: update, complete: function () { return complete(); }, on: on, licensed: licensed, state: function () { return st; }, server: base, settingsHtml: settingsHtml, release: release, recheck: recheck, open: open,
    whenReady: function (f) { if (ready) f(); else waiters.push(f); }, deviceId: deviceId, pretty: pretty, app: function () { return app; },
    syncSettings: syncSettings, settingsChanged: settingsChanged, syncNow: pullAll };
})();
