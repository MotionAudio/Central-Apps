/* Central Control - the main admin's Devices tab: every device paired with the Central Pedal, its role and jobs,
 * and how its connection is doing (round trip to the pedal, in-ear buffer and dropouts, CPU, battery, version),
 * with Change role / Jobs / Lock / Rename / Remove next to each one; computers asking to be an admin; the service
 * lock for everyone; and the main admin's own job.
 * Every computer (any role) reports its numbers to the pedal every few seconds - that is what this tab shows. */
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
    if (!CU.state.connected || !CU.role()) return;
    var h = { rtt: CU.state.rtt != null ? Math.round(CU.state.rtt) : null, tab: CU.prefs.tab || "", web: !!CU.web, manual: !!(window.CULock && window.CULock.manual()) };
    try { if (NAT && NAT.health) { var x = await NAT.health(); h.cpu = x.cpu; h.memFree = x.memFree; h.platform = x.platform; h.app = x.app; } } catch (_) { }
    if (battery) { h.battery = Math.round(battery.level * 100); h.charging = !!battery.charging; }
    var ie = window.CUInEarStats && window.CUInEarStats(); if (ie) { h.ieBuf = ie.bufferMs; h.ieDrops = ie.underruns; }
    if (navigator.connection && navigator.connection.effectiveType) h.net = navigator.connection.effectiveType;
    var R0 = R(); CU.send({ type: "cuRole", action: "health", id: R0 ? R0.devId() : undefined, health: h });
  }
  setInterval(report, 5000); CU.on("connected", function (on) { if (on) setTimeout(report, 1500); });

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
    if (h.rtt != null) out.push('<span title="round trip to the Central Pedal">' + h.rtt + " ms</span>");
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
  function render() {
    var root = $("#devicesRoot"); if (!root || !visible()) return;
    if (root.contains(document.activeElement) && /INPUT|SELECT/.test(document.activeElement.tagName) && document.activeElement.type !== "checkbox") return;
    var v = (R() && R().view()) || {}, list = v.devices || [], on = list.filter(function (d) { return d.online; }), pd = v.pedal || {};
    var wants = list.filter(function (d) { return d.wantsAdmin; });
    var me = v.you || {};
    var h = '<div class="dv">';
    h += '<div class="dv-top"><div class="dv-sum"><b>' + on.length + "</b> of " + list.length + " device" + (list.length === 1 ? "" : "s") + " online" +
      ' · Central Pedal: ' + (CU.state.connected ? '<span class="dv-ok">connected</span>' + (pd.app ? " v" + esc(pd.app) : "") + (pd.tempC != null ? " · " + pd.tempC + " °C" : "") + (pd.load != null ? " · load " + pd.load + "%" : "") : '<span class="warn">not connected</span>') + "</div>" +
      '<button class="dv-lockall' + (v.lockAll ? " on" : "") + '" data-dv="lockAll">' + (v.lockAll ? "🔒 Locked for the service - unlock" : "🔓 Lock everyone for the service") + "</button></div>";
    if (!CU.state.connected) h += '<p class="warn">Connect to the Central Pedal to see the devices.</p>';
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
      }).join("") : '<tr><td colspan="6" class="muted">No other devices yet. On each one choose Admin, User 1 or User 2 and type the pairing PIN <b>' + esc(v.pairPin || "") + "</b>.</td></tr>") + "</tbody></table>";
    h += '<p class="muted small">Connection: good / fair / poor from the round trip to the pedal, the in-ear buffer, the CPU and the battery. Lock keeps the I/O tab, settings and set-up pages closed on that device during the service (it can still do its job). Each person can also lock their own device (🔓 at the top).</p></div>';
    root.innerHTML = h;
  }
  var pendingRole = {};
  document.addEventListener("change", async function (e) {
    var t = e.target; if (!t.closest || !t.closest("#devicesRoot")) return;
    if (t.dataset.dvRole) { pendingRole[t.dataset.dvRole] = t.value; return; }
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
    else if (a === "rename") { var nm = await CU.askText("Name:", ""); if (nm) r = await R().request("rename", { target: id, newName: nm.trim() }); }
    else if (a === "remove") { if (confirm("Remove this device? It goes back to its first-launch setup.")) r = await R().request("remove", { target: id }); }
    if (r && !r.ok) alert(r.error || "Not changed.");
    render();
  });
  CU.on("message", function (m) { if (m.type === "cuRoles" && visible()) render(); });
  CU.on("tab", function (t) { if (t === "devices") render(); });
  CU.on("connected", function () { if (visible()) render(); });
  window.CUDevices = { render: render, report: report, grade: grade };
})();
