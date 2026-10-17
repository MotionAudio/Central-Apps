/* Central Usage - roles: one Main admin, any number of Admins, User 1 and User 2.
 *   Main admin  chosen on its first launch; holds the 4-digit PIN and the pairing code, and a People list
 *               where it gives every other computer its role
 *   Admin       lighting, mix, in-ears, lyrics, slides, I/O
 *   User 1      chart, instrument, lyrics, my in-ear mix, I/O
 *   User 2      lyrics, chart (any instrument), my in-ear mix
 * A user moves between User 1 and User 2 by itself; between the user and admin side it needs the main admin's
 * PIN (or the main admin changes it). The Central Control keeps the list (only hashes of the PIN and codes),
 * so a role holds while the main admin's computer is off. */
(function () {
  "use strict";
  var CU = window.CentralUsage, NAT = window.CU; if (!CU) return;
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var view = null, waiting = {}, notice = "";
  var DESC = {
    main: "Runs everything and gives every other computer its role. There is one.",
    admin: "Lighting · production (cameras) · track mixing · in-ear mixes · slides & lyrics - the jobs the main admin gives it",
    user1: "Chord chart · instrument · lyrics · my in-ear mix",
    user2: "Lyrics · chord chart for my instrument · my in-ear mix"
  };

  function devId() {
    if (window.CUInEar) return window.CUInEar.deviceId();
    try { var id = localStorage.getItem("cu-device-id"); if (!id) { id = "d" + Math.random().toString(36).slice(2, 12); localStorage.setItem("cu-device-id", id); } return id; } catch (_) { return "anon"; }
  }
  function rand(n) { var a = new Uint8Array(n); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach(function (_, i) { a[i] = Math.random() * 256; }); return Array.from(a, function (b) { return ("0" + b.toString(16)).slice(-2); }).join(""); }
  function code4() { return String(1000 + Math.floor(Math.random() * 9000)); }
  // the main admin's secrets: in the app's own settings (cu.json); in a plain browser, in local storage
  function keys() {
    var c = CU.config() || {}; if (c.mainKeys && c.mainKeys.token) return c.mainKeys;
    var k = CU.store.get("mainKeys", null);
    if (!k && CU.role() === "main") { k = { token: rand(24), pin: code4(), pair: code4() }; CU.store.set("mainKeys", k); }
    return k;
  }
  async function setKeys(patch) {
    if (NAT && NAT.config) { CU.setConfig(await NAT.config.set(patch)); }
    else { var k = keys() || {}; if (patch.newPin) k.pin = /^\d{4}$/.test(String(patch.newPin)) ? String(patch.newPin) : code4(); if (patch.newPair) k.pair = /^\d{4}$/.test(String(patch.newPair)) ? String(patch.newPair) : code4(); CU.store.set("mainKeys", k); }
    hello();
  }
  function name() { return (CU.config() || {}).name || CU.store.get("name", "") || "Central Usage"; }

  // ------------------------------------------------------------- talking to the Central Control
  function hello() {
    var r = CU.role(); if (!r || !CU.state.connected) return;
    var m = { type: "cuRole", action: "hello", id: devId(), name: name(), role: r };
    if (r === "main") { var k = keys() || {}; m.token = k.token; m.pin = k.pin; m.pair = k.pair; if (CU.prefs.code) m.code = CU.prefs.code; }
    CU.send(m);
  }
  function request(action, extra) {
    return new Promise(function (resolve) {
      if (!CU.state.connected) return resolve({ ok: false, error: "Not connected to the Central Control - connect first (I/O tab or Find)." });
      var m = Object.assign({ type: "cuRole", action: action, id: devId(), name: name() }, extra || {});
      (waiting[action] = waiting[action] || []).push(resolve);
      setTimeout(function () { var q = waiting[action] || [], i = q.indexOf(resolve); if (i >= 0) { q.splice(i, 1); resolve({ ok: false, error: "The Central Control did not answer." }); } }, 6000);
      CU.send(m);
    });
  }
  CU.on("connected", function (on) { if (on) hello(); });
  CU.on("message", function (m) {
    if (m.type === "cuRoleReply") {
      var q = waiting[m.action]; if (q && q.length) q.shift()(m);
      if (m.action === "hello" && m.needCode && !document.getElementById("modePick")) { notice = m.error || "Type the Central Pedal's pairing PIN."; askPair(); paint(); }
      return;
    }
    if (m.type === "pairCodeChanged") {   // the main admin changed the pairing PIN while this computer was online
      CU.prefs.code = m.code; CU.store.set("code", m.code);
      if (CU.role() === "main") { var k0 = keys() || {}; if (k0.pair !== m.code) setKeys({ newPair: m.code }); }
      return;
    }
    if (m.type === "cuRoles") {
      view = m;
      if (m.youAreMain) {
        var hq = waiting.hello; if (hq && hq.length) hq.shift()({ ok: true });
        var k1 = keys() || {}; if (m.pairPin && k1.pair !== m.pairPin) setKeys({ newPair: m.pairPin });   // the pedal's PIN is the pairing PIN
        if (m.pairPin && CU.prefs.code !== m.pairPin) { CU.prefs.code = m.pairPin; CU.store.set("code", m.pairPin); }
      }
      if (m.hostCodes) {
        if (m.hostCodes.user && m.hostCodes.user !== CU.store.get("userCode", "")) CU.store.set("userCode", m.hostCodes.user);
        if (m.hostCodes.admin && m.hostCodes.admin !== CU.store.get("adminCode", "")) { CU.store.set("adminCode", m.hostCodes.admin); if (window.CUMix && window.CUMix.refresh) window.CUMix.refresh(); }
      }
      // the Central Control's list wins (the main admin may have changed it while this computer was off)
      if (m.you && m.you.jobs && JSON.stringify(m.you.jobs) !== JSON.stringify(CU.jobs())) CU.setJobs(m.you.jobs);
      var mine = CU.role(), theirs = m.you && m.you.role;
      if (theirs && mine !== "main" && theirs !== mine && theirs !== "main") {
        if (mine === "admin" && theirs === "user1" && m.hasMain) notice = "There is a main admin (" + m.mainName + "), so this computer starts as User 1. Ask them, or enter their PIN below.";
        CU.setRole(theirs);
      }
      paint(); return;
    }
    if (m.type === "cuRoleAssigned") {
      if (m.removed) { notice = ""; CU.setRole(null); toast((m.by || "The main admin") + " removed this computer. Choose how it is used."); }
      else {
        if (m.name && NAT && NAT.config) NAT.config.set({ name: m.name }).then(function (c) { CU.setConfig(c); });
        if (m.jobs) { CU.setJobs(m.jobs); toast((m.by || "The main admin") + " set this computer's jobs: " + jobText(m.jobs) + "."); }
        if (m.role && m.role !== CU.role()) { CU.setRole(m.role); toast((m.by || "The main admin") + " made this computer " + CU.roleName(m.role) + "."); }
        else if (m.approved === false) toast((m.by || "The main admin") + " kept this computer as " + CU.roleName(CU.role()) + ".");
      }
      paint();
    }
  });

  async function askPair() {
    var v = await CU.askText("The Central Pedal already has a pairing PIN. Type it - it becomes your pairing PIN:", ""); if (v == null) return; v = v.trim();
    if (!/^\d{4}$/.test(v)) return alert("The PIN is 4 digits.");
    await setKeys({ newPair: v }); CU.prefs.code = v; CU.store.set("code", v); notice = ""; hello();
  }
  function jobText(j) { return (j || ["general"]).map(function (x) { return CU.jobNames[x] || x; }).join(", "); }
  function toast(text) {
    var t = document.createElement("div"); t.className = "role-toast"; t.textContent = text; document.body.appendChild(t);
    setTimeout(function () { t.classList.add("out"); }, 4500); setTimeout(function () { t.remove(); }, 5200);
  }

  // ------------------------------------------------------------- first launch: the setup
  // The main admin is set up first: its name, the inputs and outputs (when it is the sound desk), the 4-digit pairing
  // PIN every other device uses, and its own role PIN (for changing roles). Every other computer picks Admin, User 1
  // or User 2 and types the pairing PIN. (A Central Pedal - the Raspberry Pi - pairs the same way, on its own screen.)
  function firstLaunch() {
    if (document.getElementById("modePick")) return;
    var d = document.createElement("div"); d.id = "modePick"; d.className = "mode-pick";
    var opt = function (r, title, text, small, hide) { return '<button data-rp="' + r + '"' + (hide ? " hidden" : "") + "><b>" + title + "</b><span>" + text + "</span>" + (small ? "<small>" + small + "</small>" : "") + "</button>"; };
    d.innerHTML = '<div class="mode-box"><h2>Set up this computer</h2>' +
      '<div class="rp-step" data-step="1"><label class="rp-name">This computer\'s name <input data-rp="name" value="' + esc(name() === "Central Usage" ? "" : name()) + '" placeholder="Sound desk / Lights / Sarah\'s laptop"></label>' +
      '<div class="mode-opts rp-roles' + (CU.web ? " web" : "") + '">' + opt("main", "Main admin", "Set up first. Picks the pairing PIN and gives every other device its role.", "usually the sound desk", CU.web) +
      opt("admin", "Admin", "Lighting, cameras, mix, in-ears, slides & lyrics - the jobs the main admin gives it.", "", CU.web) +
      opt("user1", "User 1", DESC.user1, "a musician") + opt("user2", "User 2", DESC.user2, "a singer / a tablet on a stand") + "</div></div>" +
      // main admin: inputs and outputs
      '<div class="rp-step" data-step="io" hidden><h3>Inputs and outputs</h3><p class="muted small">Is this computer the sound desk - the one with the audio interface or Dante that makes the in-ear mixes? Pick its inputs and outputs. You can change all of it later on the I/O tab.</p><div class="rp-io" id="rpIo"></div>' +
      '<div class="row"><button class="primary" data-rp="ioNext">Next</button><button data-rp="ioSkip">Not the sound desk - skip</button></div></div>' +
      // main admin: the PINs
      '<div class="rp-step" data-step="pins" hidden><h3>Your PINs</h3>' +
      '<label>Pairing PIN - every other device joins with it <input data-rp="pair" inputmode="numeric" maxlength="4" placeholder="e.g. 0915" autocomplete="off"></label>' +
      '<label>Role PIN - only you; it changes roles (user ↔ admin) <input data-rp="pin" inputmode="numeric" maxlength="4" placeholder="4 digits, not the same" autocomplete="off"></label>' +
      '<p class="muted small">If your Central Pedal already has a pairing PIN, type that one.</p><div class="row"><button class="primary" data-rp="pinsGo">Finish</button><button data-rp="back">Back</button></div></div>' +
      // everyone else: the pairing PIN
      '<div class="rp-step" data-step="join" hidden><h3 data-rp-title></h3><label>Pairing PIN <input data-rp="joinPin" inputmode="numeric" maxlength="4" placeholder="the main admin\'s 4 digits" autocomplete="off"></label>' +
      '<label class="rp-adminpin" hidden>Main admin\'s role PIN <small class="muted">(optional - without it the main admin approves you)</small><input data-rp="rolePin" inputmode="numeric" maxlength="4" autocomplete="off"></label>' +
      '<div class="row"><button class="primary" data-rp="go">Pair</button><button data-rp="back">Back</button><a href="#" data-rp="later">Not now - start as User 1</a></div></div>' +
      '<p class="rp-msg warn"></p><div class="rp-done" hidden></div></div>';
    document.body.appendChild(d);
    var want = null;
    var msg = function (t) { $(".rp-msg", d).textContent = t || ""; };
    var step = function (n) { d.querySelectorAll(".rp-step").forEach(function (x) { x.hidden = x.dataset.step !== String(n); }); msg(""); };
    async function saveName() { var nm = $('[data-rp="name"]', d).value.trim(); if (!nm) return; CU.store.set("name", nm); if (NAT && NAT.config) CU.setConfig(await NAT.config.set({ name: nm })); else { var c = CU.config(); c.name = nm; } }
    async function connectFirst() {
      if (CU.state.connected) return true;
      msg("Looking for the Central Pedal…");
      if (NAT && NAT.discover) { try { var f = await NAT.discover(); if (f && f.length) CU.connect(f[0].host); } catch (_) { } }
      for (var i = 0; i < 30 && !CU.state.connected; i++) await new Promise(function (r) { setTimeout(r, 200); });
      msg(""); return CU.state.connected;
    }
    var four = function (v) { return /^\d{4}$/.test(v); };
    d.addEventListener("click", async function (e) {
      var b = e.target.closest("[data-rp]"); if (!b || b.tagName === "INPUT") return; e.preventDefault();
      var a = b.dataset.rp;
      if (a === "main") {
        want = "main"; await saveName(); step("io");
        if (window.CUIO && window.CUIO.mountSetup) window.CUIO.mountSetup($("#rpIo", d)); else $("#rpIo", d).innerHTML = '<p class="muted">Set the audio interface later on the I/O tab.</p>';
      } else if (a === "admin" || a === "user1" || a === "user2") {
        want = a; await saveName(); step("join");
        $("[data-rp-title]", d).textContent = "Pair as " + CU.roleName(a);
        $(".rp-adminpin", d).hidden = a !== "admin"; $('[data-rp="joinPin"]', d).focus();
      } else if (a === "ioNext" || a === "ioSkip") {
        if (a === "ioSkip" && NAT && NAT.config) { var c0 = CU.config() || {}; if (c0.host && c0.host.enabled) CU.setConfig(await NAT.config.set({ host: { enabled: false } })); }
        step("pins"); $('[data-rp="pair"]', d).focus();
      } else if (a === "back") { want = null; step(1); }
      else if (a === "later") { await saveName(); await CU.setRole("user1"); d.remove(); }
      else if (a === "close") d.remove();
      else if (a === "pinsGo") {
        var pair = $('[data-rp="pair"]', d).value.trim(), pin = $('[data-rp="pin"]', d).value.trim();
        if (!four(pair)) return msg("The pairing PIN is 4 digits.");
        if (!four(pin)) return msg("The role PIN is 4 digits.");
        if (pin === pair) return msg("Use two different PINs: the pairing PIN is shared with everyone, the role PIN is only yours.");
        d.dataset.keep = "1"; await CU.setRole("main");
        await setKeys({ newPair: pair, newPin: pin });
        CU.prefs.code = pair; CU.store.set("code", pair);
        if (await connectFirst()) {
          msg("Pairing with the Central Pedal…");
          waiting.hello = []; view = null;
          var r = await waitFor("hello", 6000);
          if (r && !r.ok && r.needCode && !(view && view.youAreMain)) { r = await waitFor("hello", 2500); }   // (an answer to an earlier try can come first)
          if (!(view && view.youAreMain) && r && !r.ok) { msg(r.error || "The Central Pedal did not accept it."); return; }
        }
        var done = $(".rp-done", d); d.querySelectorAll(".rp-step").forEach(function (x) { x.hidden = true; }); done.hidden = false; msg("");
        done.innerHTML = '<p>This computer is the <b>main admin</b>.</p><table class="io-t"><tr><td>Pairing PIN</td><td><b class="io-code">' + esc(pair) + '</b> <span class="muted small">every other device joins with it</span></td></tr>' +
          '<tr><td>Role PIN</td><td><b class="io-code">' + esc(pin) + '</b> <span class="muted small">only you - changes roles</span></td></tr></table>' +
          (CU.state.connected ? "" : '<p class="warn small">No Central Pedal found yet - it pairs as soon as it is on this network with the same PIN.</p>') +
          '<p class="muted small">Both are in Settings → This computer. The Devices tab shows every device, its role and how its connection is doing.</p><button class="primary" data-rp="close">OK</button>';
        CU.showTab("devices");
      }
      else if (a === "go") {
        var code = $('[data-rp="joinPin"]', d).value.trim(); if (!four(code)) return msg("Type the 4-digit pairing PIN.");
        if (!(await connectFirst())) return msg("The Central Pedal was not found on this network. Check the Wi-Fi, or use \"Not now\" and connect later (I/O tab).");
        msg("Pairing…");
        var extra = { pair: code, code: code, role: want }; var rp = $('[data-rp="rolePin"]', d).value.trim(); if (want === "admin" && rp) extra.pin = rp;
        var r2 = await request("join", extra);
        if (!r2.ok) return msg(r2.error || "Could not pair.");
        if (r2.code) { CU.prefs.code = r2.code; CU.store.set("code", r2.code); CU.send({ type: "auth", code: r2.code }); }
        await CU.setRole(r2.role || "user1"); d.remove();
        toast(r2.pending ? "Paired as User 1 - the main admin is asked to make this computer an admin." : "Paired as " + CU.roleName(r2.role || "user1") + ".");
      }
    });
    d.addEventListener("keydown", function (e) { if (e.key !== "Enter") return; var k = e.target.dataset.rp; if (k === "joinPin" || k === "rolePin") $('[data-rp="go"]', d).click(); if (k === "pair" || k === "pin") $('[data-rp="pinsGo"]', d).click(); });
  }
  // the reply to our own hello (main admin): resolves once the pedal answered (or nothing came - fine)
  function waitFor(action, ms) { return new Promise(function (resolve) { (waiting[action] = waiting[action] || []).push(resolve); hello(); setTimeout(function () { var q = waiting[action] || [], i = q.indexOf(resolve); if (i >= 0) { q.splice(i, 1); resolve(null); } }, ms); }); }

  // ------------------------------------------------------------- Settings: This computer, People
  function roleRadio(r, cur, needsPin) {
    return '<label class="io-opt' + (cur === r ? " on" : "") + '"><input type="radio" name="rlRole" value="' + r + '"' + (cur === r ? " checked" : "") + '><span><b>' + CU.roleName(r) + (needsPin ? ' <small class="muted">PIN</small>' : "") + '</b><small>' + DESC[r] + "</small></span></label>";
  }
  function card() {
    var r = CU.role(), c = CU.config() || {}, k = r === "main" ? keys() || {} : null, v = view || {};
    var h = '<section class="card rl-card"><h3>This computer</h3><label>Name <input data-st="name" value="' + esc(c.name || "") + '" placeholder="Sound desk / Lights / Sarah\'s laptop"></label>' +
      '<p class="rl-now">Role: <b>' + esc(CU.roleName(r)) + "</b>" + (v.hasMain && r !== "main" ? ' <span class="muted small">· main admin: ' + esc(v.mainName) + "</span>" : "") + (!CU.state.connected ? ' <span class="warn small">· not connected to the Central Control</span>' : "") + "</p>";
    if (notice) h += '<p class="warn small">' + esc(notice) + "</p>";
    if (v.conflict && v.conflict.length > 1) h += '<p class="warn">Two computers say they are the main admin: ' + v.conflict.map(function (x) { return "<b>" + esc(x.name) + "</b>" + (x.registered ? " (the one in charge)" : ""); }).join(" and ") + '. On the one that should not be, use <b>Forget role</b> below.</p>';
    if (r === "main") {
      h += '<table class="io-t"><tr><td>Pairing PIN</td><td><b class="io-code">' + esc(k.pair) + '</b> <button data-rl="setPair">Change…</button> <span class="muted small">every device joins with it (the Central Pedal too)</span></td></tr>' +
        '<tr><td>Role PIN</td><td><b class="io-code" data-rl="pinShow">' + esc(k.pin) + '</b> <button data-rl="setPin">Change…</button> <span class="muted small">only you - it moves a computer between user and admin</span></td></tr></table>' +
        '<p class="muted small">Every device, its role, its jobs and its connection are on the <button class="linkish" data-rl="devices">Devices</button> tab.</p>';
    } else if (r === "admin") {
      h += '<p class="small">Jobs: <b>' + esc(jobText(CU.jobs())) + '</b> <span class="muted">(set by the main admin)</span></p>';
      h += '<div class="io-opts">' + roleRadio("admin", r) + roleRadio("user1", r, true) + roleRadio("user2", r, true) + "</div>";
    } else {
      h += '<div class="io-opts">' + roleRadio("user1", r) + roleRadio("user2", r) + (CU.web ? "" : roleRadio("admin", r, !!v.hasMain)) + "</div>";
      if (CU.web) h += '<p class="muted small">On a phone or tablet: User 1 (chart, lyrics, my in-ear mix) or User 2. Lighting, mixing and slides are on a computer with Central Usage.</p>';
    }
    h += '<div class="row"><button data-rl="forget">Forget role…</button><span class="muted small">Back to the first-launch choice. Use it if two computers were set up as the main admin.</span></div></section>';
    return h;
  }
  function people() {
    var list = (view && view.devices) || [];
    var rows = list.map(function (d) {
      var sel = '<select data-rl-role="' + esc(d.id) + '">' + ["admin", "user1", "user2"].map(function (x) { return '<option value="' + x + '"' + (d.role === x ? " selected" : "") + ">" + CU.roleName(x) + "</option>"; }).join("") + "</select>";
      var jb = d.role === "admin" ? '<div class="rl-jobs">' + Object.keys(CU.jobNames).map(function (x) { var on = (d.jobs || ["general"]).indexOf(x) >= 0; return '<label class="toggle"><input type="checkbox" data-rl-job="' + x + '" data-id="' + esc(d.id) + '"' + (on ? " checked" : "") + "> " + esc(CU.jobNames[x]) + "</label>"; }).join("") + "</div>" : "";
      return '<tr><td><span class="dot' + (d.online ? "" : " off") + '"></span> <b>' + esc(d.name) + "</b>" + (d.claimsMain ? ' <span class="warn small">says it is the main admin</span>' : "") + (d.paired ? "" : ' <span class="muted small">(not paired)</span>') + "</td><td>" + sel + jb + '</td><td><button data-rl="rename" data-id="' + esc(d.id) + '">Rename</button> <button data-rl="remove" data-id="' + esc(d.id) + '">Remove</button></td></tr>';
    }).join("");
    return '<section class="card rl-people wide"><h3>People and devices</h3>' + (CU.state.connected ? "" : '<p class="warn small">Connect to the Central Control to see the other computers.</p>') +
      (rows ? '<table class="io-t">' + rows + "</table>" : '<p class="muted">No other computers yet. On each one choose <b>Join</b> and type the pairing code.</p>') + "</section>";
  }
  function paint() { if (window.CUSettings && CU.prefs.tab === "settings") window.CUSettings.render(); chip(); }

  async function onSettingsChange(t) {
    if (t.name === "rlRole") {
      var want = t.value, cur = CU.role(), same = (cur === "user1" || cur === "user2") && (want === "user1" || want === "user2");
      var extra = { role: want };
      if (!same && view && view.hasMain) {
        var pin = await CU.askText(want === "admin" ? "The main admin's role PIN (or leave it empty to ask the main admin):" : "The main admin's role PIN (4 digits):", "");
        if (pin == null) { paint(); return true; } extra.pin = pin.trim(); if (!extra.pin && want === "admin") extra.ask = true;
      }
      if (!CU.state.connected) {
        if (same || !(view && view.hasMain)) { await CU.setRole(want); paint(); return true; }
        alert("Connect to the Central Control first - it checks the PIN."); paint(); return true;
      }
      var r = await request("set", extra);
      if (r.ok && r.pending) toast("Asked the main admin to make this computer an admin.");
      else if (r.ok) { notice = ""; await CU.setRole(r.role); toast("This computer is now " + CU.roleName(r.role) + "."); } else alert(r.error || "Not changed.");
      paint(); return true;
    }
    if (t.dataset.rlJob) {   // ticking General clears the others; ticking a job clears General
      var row = t.closest("tr"), id = t.dataset.id, picked = [];
      if (t.dataset.rlJob === "general" && t.checked) row.querySelectorAll("[data-rl-job]").forEach(function (x) { x.checked = x.dataset.rlJob === "general"; });
      else if (t.checked) { var g = row.querySelector('[data-rl-job="general"]'); if (g) g.checked = false; }
      row.querySelectorAll("[data-rl-job]").forEach(function (x) { if (x.checked) picked.push(x.dataset.rlJob); });
      var rj = await request("jobs", { target: id, jobs: picked }); if (!rj.ok) alert(rj.error || "Not changed."); paint(); return true;
    }
    if (t.dataset.rlRole) { var r2 = await request("assign", { target: t.dataset.rlRole, role: t.value }); if (!r2.ok) alert(r2.error || "Not changed."); paint(); return true; }
    return false;
  }
  async function onSettingsClick(b) {
    var a = b.dataset.rl; if (!a) return false;
    if (a === "setPin") { var p = await CU.askText("New role PIN (4 digits, not the pairing PIN):", ""); if (p != null) { p = p.trim(); if (!/^\d{4}$/.test(p)) alert("The PIN is 4 digits."); else if (p === (keys() || {}).pair) alert("Use a different PIN from the pairing PIN."); else await setKeys({ newPin: p }); } }
    else if (a === "setPair") {
      var np = await CU.askText("New pairing PIN (4 digits). Devices online now switch over by themselves; the others ask for it:", ""); if (np == null) return true; np = np.trim();
      if (!/^\d{4}$/.test(np)) { alert("The PIN is 4 digits."); return true; }
      if (np === (keys() || {}).pin) { alert("Use a different PIN from your role PIN."); return true; }
      var rs = await request("setPair", { pair: np }); if (!rs.ok) { alert(rs.error || "Not changed."); return true; }
      await setKeys({ newPair: np }); CU.prefs.code = np; CU.store.set("code", np); toast("Pairing PIN is now " + np + ".");
    }
    else if (a === "devices") CU.showTab("devices");
    else if (a === "forget") {
      if (!confirm("Forget this computer's role? It goes back to the first-launch choice." + (CU.role() === "main" ? "\n\nThis computer stops being the main admin; another computer can then become it." : ""))) return true;
      var extra = CU.role() === "main" ? { token: (keys() || {}).token } : {};
      if (CU.state.connected) { var r = await request("forget", extra); if (!r.ok) { alert(r.error || "Not changed."); return true; } }
      notice = ""; if (!(NAT && NAT.config)) CU.store.set("mainKeys", null);
      await CU.setRole(null);
    }
    else if (a === "rename") { var nm = await CU.askText("Name:", ""); if (nm) await request("rename", { target: b.dataset.id, newName: nm.trim() }); }
    else if (a === "remove") { if (confirm("Remove this computer? It goes back to the first-launch choice.")) await request("remove", { target: b.dataset.id }); }
    paint(); return true;
  }

  // ------------------------------------------------------------- the User 1 / User 2 switch in the top bar
  function chip() {
    var el = document.getElementById("roleChip"); if (!el) return;
    var r = CU.role();
    if (r === "user1" || r === "user2") el.innerHTML = '<button data-chip="user1" class="' + (r === "user1" ? "on" : "") + '">User 1</button><button data-chip="user2" class="' + (r === "user2" ? "on" : "") + '">User 2</button>';
    else el.innerHTML = r ? '<span class="rl-badge">' + esc(CU.roleName(r)) + "</span>" : "";
  }
  document.addEventListener("click", async function (e) {
    var b = e.target.closest("#roleChip [data-chip]"); if (!b || b.dataset.chip === CU.role()) return;
    if (CU.state.connected) { var r = await request("set", { role: b.dataset.chip }); if (!r.ok) return alert(r.error); }
    await CU.setRole(b.dataset.chip); chip();
  });
  CU.on("role", function () { chip(); hello(); });
  CU.on("ready", function () { if (!CU.role()) firstLaunch(); chip(); });

  window.CURoles = { firstLaunch: firstLaunch, card: card, jobText: jobText, toast: toast, devId: devId, view: function () { return view; }, onSettingsChange: onSettingsChange, onSettingsClick: onSettingsClick, request: request, keys: keys, hello: hello };
  if (!CU.role()) firstLaunch();
  chip();
})();
