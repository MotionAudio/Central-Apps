/* Central Control - the main admin's Service tab: up to 4 services (e.g. Sunday 9:00, Sunday 11:00, Wednesday, Youth),
 * each with its weekday and time, the roles it uses, and a run order of items (songs from the Central Pedal's setlist,
 * prayer, announcements, sermon…) with minutes and the roles each item uses. Start / Back / Next / Stop run it;
 * every computer then counts down to its own next part (countdown.js). Kept on the main admin's computer (the center),
 * so services run with or without a Central Pedal; a paired Central Pedal gets them for its stage display. */
(function () {
  "use strict";
  var CU = window.CentralUsage; if (!CU) return;
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var ROLE_LABEL = { lighting: "Lighting", production: "Cameras", slides: "Slides", lyrics: "Lyrics", mix: "Mix", inears: "In-ears", band: "Band" };
  var KIND_LABEL = { song: "Song", prayer: "Prayer", welcome: "Welcome", announcements: "Announcements", offering: "Offering", sermon: "Sermon", communion: "Communion", video: "Video", other: "Other" };
  var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var ALL = ["lighting", "production", "slides", "lyrics", "mix", "inears", "band"];
  var DEFAULT_ROLES = { song: ALL, prayer: ["lighting", "production", "mix"], welcome: ["lighting", "production", "slides", "mix"], announcements: ["production", "slides", "mix"], offering: ["lighting", "slides", "mix", "band"], sermon: ["production", "slides", "mix"], communion: ["lighting", "slides", "mix", "band"], video: ["production", "slides", "mix"], other: ["mix"] };
  var DEFAULT_MIN = { song: 5, prayer: 3, welcome: 3, announcements: 5, offering: 4, sermon: 35, communion: 8, video: 3, other: 5 };
  var S = { services: [], run: null, offset: 0, max: 4 }, sel = CU.store.get("svcSel", ""), saveT = 0, saved = "";
  function uid(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function item(kind, title) { return { id: uid("it"), title: title || KIND_LABEL[kind], kind: kind, minutes: DEFAULT_MIN[kind], roles: DEFAULT_ROLES[kind].slice(), song: "", note: "" }; }
  function cur() { return S.services.filter(function (x) { return x.id === sel; })[0] || S.services[0] || null; }
  function visible() { return CU.prefs.tab === "service"; }
  function fmt(sec) { sec = Math.round(sec); var neg = sec < 0; sec = Math.abs(sec); var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; return (neg ? "-" : "") + (h ? h + ":" + ("0" + m).slice(-2) : m) + ":" + ("0" + s).slice(-2); }
  function songs() { var d = CU.state.display; return (d && d.songs) || []; }

  // ------------------------------------------------------------- state from the center
  CU.on("message", function (m) {
    if (m.type === "services") {
      S.services = m.services || []; S.run = m.run || null; S.max = m.max || 4; S.offset = (m.now || Date.now()) - Date.now();
      if (!saveT) render(); CU.fire("services", S);
    } else if (m.type === "serviceReply" && !m.ok) alert(m.error || "Not done.");
  });
  function ask() { CU.send({ type: "service", action: "get" }); }
  CU.on("center", function (on) { if (on) setTimeout(ask, 800); });
  CU.on("role", function () { setTimeout(ask, 300); });

  function saveSoon() { clearTimeout(saveT); saved = "saving…"; paintSaved(); saveT = setTimeout(function () { saveT = 0; CU.send({ type: "service", action: "save", services: S.services }); saved = "✓ saved"; paintSaved(); }, 700); }
  function paintSaved() { var el = $("#svSaved"); if (el) el.textContent = saved; }

  // ------------------------------------------------------------- the tab
  function render() {
    var root = $("#serviceRoot"); if (!root || !visible()) return;
    var a = document.activeElement; if (root.contains(a) && /INPUT|SELECT|TEXTAREA/.test(a.tagName) && a.type !== "checkbox") return;
    var sv = cur(); if (sv) sel = sv.id;
    var run = S.run, rsv = run && S.services.filter(function (x) { return x.id === run.service; })[0];
    var h = '<div class="sv">';
    // run panel
    h += '<div class="sv-run card">' + (rsv ? (function () {
      var it = rsv.items[run.item] || {}, left = it.minutes * 60 - ((Date.now() + S.offset) - run.itemStart) / 1000, nx = rsv.items[run.item + 1];
      return '<div class="sv-now"><small>NOW · ' + esc(rsv.name) + " · " + (run.item + 1) + " of " + rsv.items.length + '</small><b>' + esc(it.title) + '</b><span class="sv-left' + (left < 0 ? " over" : "") + '" id="svLeft">' + fmt(left) + "</span>" + (nx ? '<small>Next: ' + esc(nx.title) + "</small>" : "<small>Last item</small>") + "</div>" +
        '<div class="row"><button data-sv="prev">◀ Back</button><button class="primary" data-sv="next">Next ▶</button><button class="danger" data-sv="stop">Stop the service</button></div>';
    })() : '<div class="row"><b>Run a service</b>' + (S.services.length ? '<select id="svStartPick">' + S.services.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === sel ? " selected" : "") + ">" + esc(x.name) + "</option>"; }).join("") + '</select><button class="primary" data-sv="start">▶ Start now</button>' : '<span class="muted">Add a service first.</span>') + '<span class="muted small">Every computer counts down to its own part; Next moves everyone on.</span></div>') + "</div>";
    // services list
    h += '<div class="sv-list">' + S.services.map(function (x) { var mins = x.items.reduce(function (t, i) { return t + i.minutes; }, 0); return '<button class="sv-pick' + (x.id === sel ? " on" : "") + '" data-sv-pick="' + esc(x.id) + '"><b>' + esc(x.name) + "</b><small>" + DAYS[x.day] + " " + esc(x.time) + " · " + x.items.length + " items · " + Math.round(mins) + " min</small></button>"; }).join("") +
      (S.services.length < S.max ? '<button class="sv-pick add" data-sv="add">+ Service <small>' + S.services.length + " of " + S.max + "</small></button>" : "") + '<span class="muted small" id="svSaved">' + esc(saved) + "</span></div>";
    if (window.CUCenter && !window.CUCenter.connected()) h += '<p class="warn">The center on this computer is not running - the services are kept there.</p>';
    if (!songs().length) h += '<p class="muted small">No Central Pedal connected: songs can still be typed in as items; its setlist shows up here when it is on.</p>';
    if (sv) {
      var start = 0;
      h += '<div class="sv-edit card"><div class="row sv-head"><label>Name <input data-svf="name" value="' + esc(sv.name) + '"></label><label>Day <select data-svf="day">' + DAYS.map(function (d, i) { return '<option value="' + i + '"' + (sv.day === i ? " selected" : "") + ">" + d + "</option>"; }).join("") + '</select></label><label>Time <input type="time" data-svf="time" value="' + esc(sv.time) + '"></label>' +
        '<label class="toggle" title="The audio host records every input and a stereo mix while this service runs"><input type="checkbox" data-svf="record"' + (sv.record ? " checked" : "") + "> Record it</label><button class=\"danger\" data-sv=\"del\">Delete service</button></div>" +
        '<div class="sv-roles"><span class="muted small">Roles used in this service:</span>' + ALL.map(function (r) { return '<label class="toggle"><input type="checkbox" data-svrole="' + r + '"' + (sv.roles.indexOf(r) >= 0 ? " checked" : "") + "> " + ROLE_LABEL[r] + "</label>"; }).join("") + "</div>" +
        '<table class="sv-items"><colgroup><col style="width:64px"><col><col style="width:132px"><col style="width:80px"><col style="width:34%"><col style="width:104px"></colgroup><thead><tr><th>Starts</th><th>Item</th><th>Kind</th><th>Min</th><th>Roles</th><th></th></tr></thead><tbody>' +
        sv.items.map(function (it, i) {
          var row = '<tr data-i="' + i + '"' + (S.run && S.run.service === sv.id && S.run.item === i ? ' class="live"' : "") + '><td class="muted small">+' + fmt(start * 60) + "</td>" +
            '<td><input data-itf="title" value="' + esc(it.title) + '">' + (it.kind === "song" ? '<select data-itf="song"><option value="">- song from the setlist -</option>' + songs().map(function (q) { var v = q.id || q.name; return '<option value="' + esc(v) + '"' + (it.song === v ? " selected" : "") + ">" + esc(q.name) + "</option>"; }).join("") + "</select>" : "") + "</td>" +
            '<td><select data-itf="kind">' + Object.keys(KIND_LABEL).map(function (k) { return '<option value="' + k + '"' + (it.kind === k ? " selected" : "") + ">" + KIND_LABEL[k] + "</option>"; }).join("") + "</select></td>" +
            '<td><input type="number" min="0" max="240" step="0.5" data-itf="minutes" value="' + it.minutes + '" style="width:64px"></td>' +
            '<td><div class="sv-iroles">' + sv.roles.map(function (r) { return '<label title="' + ROLE_LABEL[r] + '"><input type="checkbox" data-itrole="' + r + '"' + (it.roles.indexOf(r) >= 0 ? " checked" : "") + ">" + ROLE_LABEL[r] + "</label>"; }).join("") + "</div></td>" +
            '<td class="sv-iacts"><button class="mini" data-it="up" title="Earlier">↑</button><button class="mini" data-it="down" title="Later">↓</button><button class="mini" data-it="del" title="Remove">✕</button></td></tr>';
          start += it.minutes; return row;
        }).join("") + '</tbody></table><div class="row sv-adds"><span class="muted small">Add:</span>' + Object.keys(KIND_LABEL).map(function (k) { return '<button data-add="' + k + '">+ ' + KIND_LABEL[k] + "</button>"; }).join("") + '<span class="spacer"></span><b>' + Math.round(start) + " min</b> <span class=\"muted small\">ends about " + endTime(sv, start) + "</span></div></div>";
    }
    root.innerHTML = h + "</div>";
  }
  function endTime(sv, mins) { var p = sv.time.split(":").map(Number), t = p[0] * 60 + p[1] + mins; return Math.floor(t / 60) % 24 + ":" + ("0" + Math.round(t % 60)).slice(-2); }
  setInterval(function () { if (!visible() || !S.run) return; var rsv = S.services.filter(function (x) { return x.id === S.run.service; })[0], it = rsv && rsv.items[S.run.item], el = $("#svLeft"); if (!it || !el) return; var left = it.minutes * 60 - ((Date.now() + S.offset) - S.run.itemStart) / 1000; el.textContent = fmt(left); el.classList.toggle("over", left < 0); }, 500);

  // ------------------------------------------------------------- editing
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("#serviceRoot button"); if (!b) return;
    var sv = cur();
    if (b.dataset.svPick) { sel = b.dataset.svPick; CU.store.set("svcSel", sel); render(); return; }
    var a = b.dataset.sv;
    if (a === "add") { if (S.services.length >= S.max) return; var n = { id: uid("sv"), name: ["Sunday morning", "Sunday second service", "Wednesday night", "Youth"][S.services.length] || "Service", day: S.services.length === 2 ? 3 : 0, time: ["09:00", "11:00", "19:00", "18:30"][S.services.length] || "09:00", roles: ALL.slice(), record: false,
      items: [item("welcome"), item("song", "Song 1"), item("song", "Song 2"), item("song", "Song 3"), item("announcements"), item("sermon"), item("song", "Response song"), item("prayer", "Prayer & dismissal")] };
      S.services.push(n); sel = n.id; CU.store.set("svcSel", sel); saveSoon(); render(); return; }
    if (a === "del" && sv) { if (!confirm("Delete \"" + sv.name + "\"?")) return; S.services = S.services.filter(function (x) { return x !== sv; }); sel = ""; saveSoon(); render(); return; }
    if (a === "start") { var pick = $("#svStartPick"); CU.send({ type: "service", action: "start", service: pick ? pick.value : sel }); return; }
    if (a === "next" || a === "prev" || a === "stop") { if (a === "stop" && !confirm("Stop the service for everyone?")) return; CU.send({ type: "service", action: a }); return; }
    if (b.dataset.add && sv) { var it = item(b.dataset.add); it.roles = it.roles.filter(function (r) { return sv.roles.indexOf(r) >= 0; }); sv.items.push(it); saveSoon(); render(); return; }
    var row = b.closest("tr[data-i]"); if (!row || !sv) return; var i = Number(row.dataset.i);
    if (b.dataset.it === "del") sv.items.splice(i, 1);
    else if (b.dataset.it === "up" && i > 0) sv.items.splice(i - 1, 0, sv.items.splice(i, 1)[0]);
    else if (b.dataset.it === "down" && i < sv.items.length - 1) sv.items.splice(i + 1, 0, sv.items.splice(i, 1)[0]);
    saveSoon(); render();
  });
  function onEdit(e) {
    var t = e.target; if (!t.closest || !t.closest("#serviceRoot")) return; var sv = cur(); if (!sv) return;
    if (t.dataset.svf) { var k = t.dataset.svf; sv[k] = k === "day" ? Number(t.value) : k === "record" ? t.checked : t.value; saveSoon(); if (e.type === "change") render(); return; }
    if (t.dataset.svrole) { var r = t.dataset.svrole; if (t.checked) { if (sv.roles.indexOf(r) < 0) sv.roles.push(r); } else { sv.roles = sv.roles.filter(function (x) { return x !== r; }); sv.items.forEach(function (it) { it.roles = it.roles.filter(function (x) { return x !== r; }); }); } saveSoon(); render(); return; }
    var row = t.closest("tr[data-i]"); if (!row) return; var it = sv.items[Number(row.dataset.i)]; if (!it) return;
    if (t.dataset.itf) {
      var f = t.dataset.itf;
      if (f === "minutes") it.minutes = Math.max(0, Math.min(240, Number(t.value) || 0));
      else if (f === "kind") { it.kind = t.value; if (it.title === "" || Object.keys(KIND_LABEL).some(function (k) { return KIND_LABEL[k] === it.title; })) it.title = KIND_LABEL[it.kind]; it.roles = DEFAULT_ROLES[it.kind].filter(function (r) { return sv.roles.indexOf(r) >= 0; }); }
      else if (f === "song") { it.song = t.value; var q = songs().filter(function (x) { return (x.id || x.name) === t.value; })[0]; if (q) it.title = q.name; }
      else it[f] = t.value;
      saveSoon(); if (e.type === "change") render(); return;
    }
    if (t.dataset.itrole) { var rr = t.dataset.itrole; if (t.checked) { if (it.roles.indexOf(rr) < 0) it.roles.push(rr); } else it.roles = it.roles.filter(function (x) { return x !== rr; }); saveSoon(); }
  }
  document.addEventListener("input", function (e) { if (e.target.dataset && (e.target.dataset.svf === "name" || e.target.dataset.itf === "title" || e.target.dataset.itf === "minutes")) onEdit(e); });
  document.addEventListener("change", onEdit);
  CU.on("tab", function (t) { if (t === "service") { ask(); render(); } });
  window.CUServices = { state: function () { return S; }, ROLE_LABEL: ROLE_LABEL, KIND_LABEL: KIND_LABEL, DAYS: DAYS, render: render, fmt: fmt };
})();
