/* Central Control - the main admin's Devices tab: every device paired with the main admin (this computer is the
 * center), its role and jobs, and how its connection is doing (round trip to the main admin and to the Central Pedal,
 * in-ear buffer and dropouts, CPU, battery, version),
 * with Change role / Jobs / Lock / Rename / Remove next to each one; computers asking to be an admin; the service
 * lock for everyone; and the main admin's own job.
 * Every computer (any role) reports its numbers to the center every few seconds - that is what this tab shows.
 * The Central Pedal is listed at the top (it pairs with the center too); without one everything here still works. */
(function () {
  "use strict";
  var CU = window.CentralUsage, NAT = window.CU; if (!CU) return;
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var R = function () { return window.CURoles; };
  var battery = null, openJobs = null;
  if (navigator.getBattery) navigator.getBattery().then(function (b) { battery = b; }).catch(function () { });

  // ------------------------------------------------------------- every computer: report how it is doing
  async function report() {
    var C = window.CUCenter; if (!(C ? C.connected() : CU.state.connected) || !CU.role()) return;
    var h = { rtt: C && C.rtt() != null ? C.rtt() : (CU.state.rtt != null ? Math.round(CU.state.rtt) : null), pedalRtt: CU.state.connected && CU.state.rtt != null ? Math.round(CU.state.rtt) : null, tab: CU.prefs.tab || "", web: !!CU.web, manual: !!(window.CULock && window.CULock.manual()) };
    try { if (NAT && NAT.health) { var x = await NAT.health(); h.cpu = x.cpu; h.memFree = x.memFree; h.platform = x.platform; h.app = x.app; } } catch (_) { }
    if (battery) { h.battery = Math.round(battery.level * 100); h.charging = !!battery.charging; }
    var ie = window.CUInEarStats && window.CUInEarStats(); if (ie) { h.ieBuf = ie.bufferMs; h.ieDrops = ie.underruns; }
    if (navigator.connection && navigator.connection.effectiveType) h.net = navigator.connection.effectiveType;
    var R0 = R(); CU.send({ type: "cuRole", action: "health", id: R0 ? R0.devId() : undefined, health: h });
  }
  setInterval(report, 5000); CU.on("center", function (on) { if (on) setTimeout(report, 1500); });

  // ------------------------------------------------------------- the main admin's Devices tab
  function visible() { return CU.prefs.tab === "devices"; }
  function ago(ms) { if (!ms) return "never"; var s = Math.round((Date.now() - ms) / 1000); return s < 60 ? "just now" : s < 3600 ? Math.round(s / 60) + " min ago" : s < 86400 ? Math.round(s / 3600) + " h ago" : Math.round(s / 86400) + " days ago"; }
  // one word for how a connection is doing: good / fair / poor / offline
  function grade(d) {
    if (!d.online) return ["off", "offline"];
    var h = d.health || {};
    if (!d.health) return ["warn", "no report"];
    if ((h.rtt != null && h.rtt > 150) || (h.ieDrops > 20) || (h.cpu != null && h.cpu > 90) || (h.battery != null && h.battery < 15 && !h.charging)) return ["bad", "poor"];
    if ((h.rtt != null && h.rtt > 60) || (h.ieDrops > 3) || (h.cpu != null && h.cpu > 70) || (h.battery != null && h.battery < 30 && !h.charging)) return ["warn", "fair"];
    return ["good", "good"];
  }
  function healthText(h) {
    if (!h) return '<span class="muted">-</span>';
    var out = [];
    if (h.rtt != null) out.push('<span title="round trip to the main admin">' + h.rtt + " ms</span>");
    if (h.pedalRtt != null) out.push('<span title="round trip to the Central Pedal">pedal ' + h.pedalRtt + " ms</span>");
    if (h.ieBuf != null) out.push('<span title="in-ear buffer / dropouts">in-ear ' + h.ieBuf + " ms" + (h.ieDrops ? " · " + h.ieDrops + " drops" : "") + "</span>");
    if (h.cpu != null) out.push("CPU " + h.cpu + "%");
    if (h.battery != null) out.push((h.charging ? "⚡" : "🔋") + h.battery + "%");
    if (h.net) out.push(esc(h.net));
    if (h.app) out.push("v" + esc(h.app));
    if (h.manual) out.push("🔒 manual");
    return out.join(" · ");
  }
  function roleSel(d) { return '<select data-dv-role="' + esc(d.id) + '">' + ["admin", "user1", "user2"].map(function (x) { return '<option value="' + x + '"' + (d.role === x ? " selected" : "") + ">" + CU.roleName(x) + "</option>"; }).join("") + "</select>"; }
  function jobsBox(id, jobs, mine) {
    return '<div class="dv-jobs">' + Object.keys(CU.jobNames).map(function (x) { var on = (jobs || ["general"]).indexOf(x) >= 0; return '<label class="toggle"><input type="checkbox" data-dv-job="' + x + '" data-id="' + esc(id) + '"' + (mine ? " data-mine" : "") + (on ? " checked" : "") + "> " + esc(CU.jobNames[x]) + "</label>"; }).join("") + "</div>";
  }
  // ------------------------------------------------------------- the track player and the Central Pedals
  var PJ = { player: ["Track player", "plays the tracks, sends the charts and lyrics"], controller: ["Foot controller", "its buttons drive the track player"], instrument: ["Instrument rig", "only its own instrument"], standby: ["Standby", "keeps the songs, does not play"] };
  var playerMsg = "";
  function fahrenheit(c) { return Math.round(c * 9 / 5 + 32); }
  function pedalsCard(v) {
    var pedals = v.pedals || [], pin = v.pairPin || ((R() && R().keys()) || {}).pair || "", local = pedals.filter(function (p) { return p.local; })[0], canOpen = !!(NAT && NAT.player);
    var play = pedals.filter(function (p) { return p.job === "player"; })[0];
    var h = '<div class="card dv-pedals"><div class="dv-ph"><h3>Tracks, charts &amp; lyrics</h3><span class="dv-now">' + (play ? "Playing from <b>" + esc(play.local ? "this computer (player window)" : play.name) + "</b> " + (play.online ? '<span class="dv-ok">● online</span>' : '<span class="warn">● offline</span>') : '<span class="warn">No track player yet</span>') + "</span>" +
      (canOpen ? '<button class="' + (local && local.online ? "" : "primary") + '" data-dv="openPlayer">' + (local && local.online ? "Show the player window" : "▶ Open the player on this computer") + "</button>" : "") + "</div>";
    if (playerMsg) h += '<p class="small ' + (/^✓/.test(playerMsg) ? "muted" : "warn") + '">' + playerMsg + "</p>";
    if (!pedals.length) h += '<p class="muted small">Open the player here and this computer runs the tracks, charts and lyrics. Or add a Central Pedal: on its screen type the pairing PIN <b class="io-code">' + esc(pin) + "</b> - it takes over the tracks, and you pick what each pedal does.</p>";
    else {
      h += '<table class="dv-table dv-ptable"><thead><tr><th></th><th>Central Pedal</th><th>Job</th><th>Status</th><th></th></tr></thead><tbody>' + pedals.map(function (p) {
        var hl = p.health || {}, st = [];
        if (p.online) { if (p.app) st.push("v" + esc(p.app)); if (hl.tempC != null) st.push(fahrenheit(hl.tempC) + " °F"); if (hl.load != null) st.push("load " + hl.load + "%"); if (hl.song && p.job === "player") st.push("♪ " + esc(hl.song)); }
        return '<tr class="' + (p.online ? "" : "off") + (p.job === "player" ? " dv-playing" : "") + '"><td><span class="dv-dot ' + (p.online ? "good" : "off") + '"></span></td>' +
          "<td><b>" + esc(p.local ? "Player window" : p.name) + "</b>" + (p.local ? ' <span class="dv-tag">this computer</span>' : ' <span class="muted small">' + esc(p.address || "") + "</span>") + "</td>" +
          '<td><select data-dv-pjob="' + esc(p.id) + '">' + (v.pedalJobs || Object.keys(PJ)).map(function (j) { return '<option value="' + j + '"' + (p.job === j ? " selected" : "") + ">" + PJ[j][0] + "</option>"; }).join("") + '</select><div class="muted small">' + esc((PJ[p.job] || PJ.controller)[1]) + "</div></td>" +
          '<td class="small">' + (p.online ? '<span class="dv-ok">online</span> ' + st.join(" · ") : '<span class="muted">offline · ' + ago(p.lastSeen) + "</span>") + "</td>" +
          '<td class="dv-acts"><button data-dv="rename" data-id="' + esc(p.id) + '">Rename</button><button class="danger" data-dv="remove" data-id="' + esc(p.id) + '">Unpair</button></td></tr>';
      }).join("") + "</tbody></table>";
      h += '<p class="muted small">One track player at a time - every Central Control and phone follows it, and changes over by itself when you pick another. Foot controllers drive the track player; instrument rigs only play their own instrument. Songs, tracks, charts and setlists are copied to every pedal. Add another Central Pedal with the pairing PIN <b>' + esc(pin) + "</b>.</p>";
    }
    return h + "</div>";
  }
  async function openPlayer() {
    playerMsg = "Opening the player…"; render();
    var r = null; try { r = await NAT.player.open(); } catch (e) { r = { ok: false, error: e.message }; }
    if (r && r.ok) playerMsg = "✓ " + (r.already ? "The player window is open." : "The player is starting - it pairs with this computer by itself.");
    else if (r && r.missing) playerMsg = 'The Central Pedal app is not installed on this computer. <button class="linkish" data-dv="getPlayer">Download it</button> or <button class="linkish" data-dv="findPlayer">show where it is…</button>';
    else playerMsg = esc((r && r.error) || "The player did not start.");
    render(); setTimeout(function () { if (/^✓/.test(playerMsg)) { playerMsg = ""; render(); } }, 8000);
  }
  function render() {
    var root = $("#devicesRoot"); if (!root || !visible()) return;
    if (root.contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement.tagName) && document.activeElement.type !== "checkbox" && !document.activeElement.dataset.dvPjob) return;
    var v = (R() && R().view()) || {}, list = (v.devices || []).filter(function (d) { return d.role !== "pedal"; }), on = list.filter(function (d) { return d.online; });
    var wants = list.filter(function (d) { return d.wantsAdmin; });
    var me = v.you || {};
    var h = '<div class="dv">';
    h += '<div class="dv-top"><div class="dv-sum"><b>' + on.length + "</b> of " + list.length + " device" + (list.length === 1 ? "" : "s") + " online</div>" +
      '<button class="dv-lockall' + (v.lockAll ? " on" : "") + '" data-dv="lockAll">' + (v.lockAll ? "🔒 Locked for the service - unlock" : "🔓 Lock everyone for the service") + "</button></div>";
    h += pedalsCard(v);
    if (window.CUCenter && !window.CUCenter.connected()) h += '<p class="warn">The center on this computer is not running - restart Central Control (is another program using port 8095?).</p>';
    if (wants.length) h += '<div class="dv-asks">' + wants.map(function (d) { return '<div class="dv-ask"><b>' + esc(d.name) + "</b> wants to be an admin <button class=\"primary\" data-dv=\"allow\" data-id=\"" + esc(d.id) + '">Allow</button><button data-dv="deny" data-id="' + esc(d.id) + '">Keep as ' + esc(CU.roleName(d.role)) + "</button></div>"; }).join("") + "</div>";
    h += '<div class="dv-me card"><h3>This computer (main admin)</h3><p class="muted small">Your own job: everything (production manager), or only what you run - e.g. lighting when someone else has the cameras.</p>' + jobsBox("me", me.jobs || CU.jobs(), true) + "</div>";
    h += '<table class="dv-table"><thead><tr><th></th><th>Device</th><th>Role</th><th>Connection</th><th>Last seen</th><th></th></tr></thead><tbody>' +
      (list.length ? list.map(function (d) {
        var g = grade(d);
        return '<tr class="' + (d.online ? "" : "off") + '"><td><span class="dv-dot ' + g[0] + '" title="' + g[1] + '"></span></td>' +
          "<td><b>" + esc(d.name) + "</b>" + (d.claimsMain ? ' <span class="warn small">says it is the main admin</span>' : "") + (d.locked ? ' <span class="dv-tag">🔒 locked</span>' : "") + (d.health && d.health.web ? ' <span class="dv-tag">browser</span>' : "") + "</td>" +
          "<td>" + roleSel(d) + (d.role === "admin" ? ' <button class="mini" data-dv="jobs" data-id="' + esc(d.id) + '">' + esc((R() ? R().jobText(d.jobs) : "") || "Jobs") + " ▾</button>" + (openJobs === d.id ? jobsBox(d.id, d.jobs) : "") : "") + "</td>" +
          '<td class="dv-health"><b class="dv-g ' + g[0] + '">' + g[1] + "</b> " + healthText(d.online ? d.health : null) + "</td>" +
          '<td class="muted small">' + (d.online ? "now" : ago(d.lastSeen)) + "</td>" +
          '<td class="dv-acts"><button data-dv="apply" data-id="' + esc(d.id) + '">Change role</button><button data-dv="' + (d.locked ? "unlock" : "lock") + '" data-id="' + esc(d.id) + '">' + (d.locked ? "Unlock" : "Lock") + '</button><button data-dv="rename" data-id="' + esc(d.id) + '">Rename</button><button class="danger" data-dv="remove" data-id="' + esc(d.id) + '">Remove</button></td></tr>';
      }).join("") : '<tr><td colspan="6" class="muted">No other devices yet. On each one choose Admin, User 1 or User 2 and type the pairing PIN <b>' + esc(v.pairPin || ((R() && R().keys()) || {}).pair || "") + "</b>.</td></tr>") + "</tbody></table>";
    h += '<p class="muted small">Connection: good / fair / poor from the round trip to this computer, the in-ear buffer, the CPU and the battery. Lock keeps the I/O tab, settings and set-up pages closed on that device during the service (it can still do its job). Each person can also lock their own device (🔓 at the top).</p></div>';
    root.innerHTML = h;
  }
  var pendingRole = {};
  document.addEventListener("change", async function (e) {
    var t = e.target; if (!t.closest || !t.closest("#devicesRoot")) return;
    if (t.dataset.dvRole) { pendingRole[t.dataset.dvRole] = t.value; return; }
    if (t.dataset.dvPjob) { var rj = await R().request("pedalJob", { target: t.dataset.dvPjob, job: t.value }); if (!rj.ok) alert(rj.error || "Not changed."); render(); return; }
    if (t.dataset.dvJob) {
      var box = t.closest(".dv-jobs"), picked = [];
      if (t.dataset.dvJob === "general" && t.checked) box.querySelectorAll("[data-dv-job]").forEach(function (x) { x.checked = x.dataset.dvJob === "general"; });
      else if (t.checked) { var g = box.querySelector('[data-dv-job="general"]'); if (g) g.checked = false; }
      box.querySelectorAll("[data-dv-job]").forEach(function (x) { if (x.checked) picked.push(x.dataset.dvJob); });
      var r = t.hasAttribute("data-mine") ? await R().request("myJobs", { jobs: picked }) : await R().request("jobs", { target: t.dataset.id, jobs: picked });
      if (!r.ok) alert(r.error || "Not changed.");
      else if (t.hasAttribute("data-mine")) await CU.setJobs(r.jobs || picked);
    }
  });
  document.addEventListener("click", async function (e) {
    var b = e.target.closest && e.target.closest("#devicesRoot [data-dv]"); if (!b || !R()) return;
    var a = b.dataset.dv, id = b.dataset.id, v = R().view() || {}, r = null;
    if (a === "lockAll") r = await R().request("lock", { target: "all", on: !v.lockAll });
    else if (a === "lock" || a === "unlock") r = await R().request("lock", { target: id, on: a === "lock" });
    else if (a === "allow" || a === "deny") r = await R().request("approve", { target: id, allow: a === "allow" });
    else if (a === "apply") { var want = pendingRole[id] || (b.closest("tr").querySelector("[data-dv-role]") || {}).value; if (want) r = await R().request("assign", { target: id, role: want }); delete pendingRole[id]; }
    else if (a === "jobs") { openJobs = openJobs === id ? null : id; render(); return; }
    else if (a === "openPlayer") { openPlayer(); return; }
    else if (a === "getPlayer") { NAT.player.download(); return; }
    else if (a === "findPlayer") { var f = await NAT.player.choose(); if (f) openPlayer(); return; }
    else if (a === "rename") { var nm = await CU.askText("Name:", ""); if (nm) r = await R().request("rename", { target: id, newName: nm.trim() }); }
    else if (a === "remove") { if (confirm("Remove this device? It goes back to its first-launch setup (a Central Pedal plays on its own until it is paired again).")) r = await R().request("remove", { target: id }); }
    if (r && !r.ok) alert(r.error || "Not changed.");
    render();
  });
  CU.on("message", function (m) { if (m.type === "cuRoles" && visible()) render(); });
  CU.on("tab", function (t) { if (t === "devices") render(); });
  CU.on("connected", function () { if (visible()) render(); });
  CU.on("center", function () { if (visible()) render(); });
  window.CUDevices = { render: render, report: report, grade: grade };
})();
