/* Central Services - the church's schedule (the website at /services/, and the app on iPhone, iPad, Mac, Windows, Linux
 * and Android, which carries this same page). Sign in: the account says who you are - a scheduler (the main admin and
 * up to 3 more) makes teams and services and asks people; everyone else sees their requests (accept / decline) and the
 * whole schedule: every worship and production team, each person's name, role, and yes / no / not yet. */
(function () {
  "use strict";
  // the website: the same address this page came from; the apps set window.CS_SERVER (their copy of this page is local)
  // (in the apps the address can be changed: ⚙ App → Website address)
  var APP = !!window.CS_APP, saved = null; try { saved = APP ? localStorage.getItem("cs-server") : null; } catch (_) { }
  var BASE = String(saved || (window.CS_SERVER != null ? window.CS_SERVER : (location.protocol.indexOf("http") === 0 ? location.origin : ""))).replace(/\/+$/, "");
  var DESK = window.CSDesktop && window.CSDesktop.updates;   // (the Mac / Windows / Linux app: updates; phones and tablets update from their store)
  var LS = "cs-token";
  var token = null; try { token = localStorage.getItem(LS); } catch (_) { }
  var st = { me: null, board: null, tab: "mine", msg: "", err: "", busy: false, form: null, editTeam: null, signup: false };
  function $(s) { return document.querySelector(s); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function setToken(t) { token = t; try { if (t) localStorage.setItem(LS, t); else localStorage.removeItem(LS); } catch (_) { } }
  async function api(method, path, body) {
    var h = { "Content-Type": "application/json" }; if (token) h.Authorization = "Bearer " + token;
    var r = await fetch(BASE + "/v1" + path, { method: method, headers: h, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
    var j = await r.json().catch(function () { return {}; });
    if (r.status === 401 && token) { setToken(null); st.me = null; }
    if (!r.ok) { var e = new Error(j.error || "The website answered " + r.status); e.status = r.status; throw e; }
    return j;
  }
  function when(d, short) { var x = new Date(d); return x.toLocaleString(undefined, short ? { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" } : { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" }); }
  var LABEL = { accepted: "✓ Yes", declined: "✗ No", pending: "… Not yet" };

  async function load() {
    if (!BASE && location.protocol.indexOf("http") !== 0) { st.err = "Central Services opens once the Motion Audio website is online. If your church was given its address, enter it under ⚙ App settings."; return draw(); }
    if (!token) { st.me = null; return draw(); }
    try {
      st.me = await api("GET", "/services/me");
      st.board = st.me.church && st.me.hasServices ? await api("GET", "/services/board") : null;
      st.err = "";
      if (st.board && st.me.role !== "scheduler" && ["new"].indexOf(st.tab) >= 0) st.tab = "mine";
      // first load after signing in: the account decides where it opens - the main admin and admins on the whole
      // schedule, users on their own requests
      if (st.board && !st.landed) { st.landed = true; if (st.tab !== "app") st.tab = st.me.churchRole === "user" ? "mine" : "schedule"; }
    } catch (e) { st.err = e.message; }
    draw();
  }

  // ---------------------------------------------------------------- screens
  function signIn() {
    var su = st.signup;
    return '<div class="center card"><h2>Central Services</h2><p class="muted" style="margin:0">Sign in with your Motion Audio account (the one from your church\'s invite).</p>' +
      (su ? '<label>Name<input id="sName" autocomplete="name"></label>' : "") +
      '<label>Email<input id="sEmail" type="email" autocomplete="username" value="' + esc(st.email || "") + '"></label><label>Password' + (su ? " (8+ characters)" : "") + '<input id="sPass" type="password" autocomplete="' + (su ? "new-password" : "current-password") + '"></label>' +
      (su ? '<label>Church code (from your main admin - optional if they added you)<input id="sCode"></label>' : "") +
      '<div class="row"><button class="primary" data-a="' + (su ? "signup" : "login") + '">' + (su ? "Make my account" : "Sign in") + '</button><button data-a="toggle">' + (su ? "I have an account" : "Make an account") + "</button>" + (su ? "" : '<button class="small" data-a="forgot">Forgot password?</button>') + "</div>" +
      (st.note ? '<div class="okmsg">' + esc(st.note) + "</div>" : "") +
      (st.err ? '<div class="err">' + esc(st.err) + "</div>" : "") + (APP ? '<button class="small" data-tab="app">⚙ App settings</button>' + (st.tab === "app" ? appSettings() : "") : "") + "</div>";
  }
  // ⚙ App (the apps only): the website's address, and on a computer the updates
  var up = { current: "", available: false, autoInstall: true };
  function appSettings() {
    return '<div class="card"><h2>App settings</h2><label>Website address<input id="aServer" value="' + esc(BASE) + '" placeholder="https://…"></label>' +
      (DESK ? '<label class="pick"><input type="checkbox" id="aAuto"' + (up.autoInstall !== false ? " checked" : "") + '> Install a new version by itself when the app opens</label>' +
        '<p class="muted small" style="margin:0">Central Services ' + esc(up.current || "") + (up.available ? " · version " + esc(up.latest) + " is ready" : up.latest ? " · up to date" : "") + (up.error ? " · " + esc(up.error) : "") + "</p>" +
        '<div class="row"><button data-a="upcheck">Check for updates</button>' + (up.available ? '<button class="primary" data-a="upinstall">Install ' + esc(up.latest) + "</button>" : "") + "</div>"
        : '<p class="muted small" style="margin:0">Updates come from the App Store / Google Play.</p>') +
      '<div class="row"><button class="primary" data-a="saveapp">Save</button></div></div>';
  }
  function header() {
    var m = st.me, sched = m.role === "scheduler", who = { owner: "Main admin", admin: "Admin", user: "User" }[m.churchRole] || "Team member";
    return '<header><h1>' + esc(m.church || "Central Services") + '</h1><span class="muted small">Central Services</span><div class="who"><span>' + esc(m.name || m.email) + '</span><span class="badge' + (m.churchRole === "owner" || m.churchRole === "admin" ? " adm" : "") + '" data-role="' + esc(m.churchRole || "") + '">' + who + "</span>" + (sched ? '<span class="badge sched">Scheduler</span>' : "") + '<button class="small" data-a="refresh" title="Refresh">↻</button><button class="small" data-a="logout">Sign out</button></div></header>' +
      '<nav>' + [["mine", "My requests"], ["schedule", "Schedule"], ["teams", "Teams"]].concat(sched ? [["new", "+ New service"]] : []).concat(APP ? [["app", "⚙ App"]] : []).map(function (t) { return '<button class="' + (st.tab === t[0] ? "on" : "") + '" data-tab="' + t[0] + '">' + t[1] + "</button>"; }).join("") + "</nav>";
  }
  function mine() {
    var b = st.board, list = [];
    b.services.forEach(function (s) { s.requests.forEach(function (r) { if (r.mine) list.push({ s: s, r: r }); }); });
    var upcoming = list.filter(function (x) { return new Date(x.s.startsAt) > Date.now() - 3 * 3600e3; });
    if (!upcoming.length) return '<div class="card"><h2>My requests</h2><p class="muted" style="margin:0">Nothing asked of you right now.</p></div>';
    return '<div class="card"><h2>My requests</h2>' + upcoming.map(function (x) {
      var t = b.teams.filter(function (t) { return t.id === x.r.teamId; })[0];
      return '<div class="card svc"><div class="row" style="justify-content:space-between"><div><div class="when">' + esc(when(x.s.startsAt)) + "</div><div>" + esc(x.s.title) + ' <span class="muted">· ' + esc(t ? t.name : "") + (x.r.role ? " · " + esc(x.r.role) : "") + "</span></div>" +
        (x.s.notes ? '<div class="muted small">' + esc(x.s.notes) + "</div>" : "") + '</div><span class="st ' + x.r.status + '">' + LABEL[x.r.status] + "</span></div>" +
        '<div class="row"><button class="ok" data-ans="accepted" data-id="' + x.r.id + '">Accept</button><button class="no" data-ans="declined" data-id="' + x.r.id + '">Decline</button><input placeholder="A note (optional)" id="note-' + x.r.id + '" value="' + esc(x.r.note || "") + '" style="flex:1;min-width:160px"></div></div>';
    }).join("") + "</div>";
  }
  function serviceCard(s, sched) {
    var b = st.board, byTeam = {};
    s.requests.forEach(function (r) { (byTeam[r.teamId] = byTeam[r.teamId] || []).push(r); });
    var cols = b.teams.filter(function (t) { return byTeam[t.id]; }).map(function (t) {
      return '<div class="team"><h4><span>' + esc(t.name) + '</span><span class="kind">' + t.kind + "</span></h4>" + byTeam[t.id].map(function (r) {
        return '<div class="p"><span>' + esc(r.name || r.email) + (r.role ? ' <span class="r">· ' + esc(r.role) + "</span>" : "") + (r.note ? ' <span class="r" title="' + esc(r.note) + '">💬</span>' : "") + '</span><span class="st ' + r.status + '">' + LABEL[r.status] +
          (sched ? ' <button class="small" data-unask="' + r.id + '" title="Take off this service">✕</button>' : "") + "</span></div>";
      }).join("") + "</div>";
    }).join("");
    var c = { accepted: 0, declined: 0, pending: 0 }; s.requests.forEach(function (r) { c[r.status]++; });
    return '<div class="card svc"><div class="row" style="justify-content:space-between"><div><div class="when">' + esc(when(s.startsAt)) + "</div><div>" + esc(s.title) + "</div>" + (s.notes ? '<div class="muted small">' + esc(s.notes) + "</div>" : "") + "</div>" +
      '<div class="small muted">' + c.accepted + " yes · " + c.declined + " no · " + c.pending + " not yet</div></div>" +
      (cols ? '<div class="teams">' + cols + "</div>" : '<p class="muted small" style="margin:0">Nobody asked yet.</p>') +
      (sched ? '<div class="row"><button class="small" data-ask="' + s.id + '">Ask more people</button><button class="small no" data-delsvc="' + s.id + '">Delete</button></div>' : "") + "</div>";
  }
  function schedule() {
    var b = st.board, sched = st.me.role === "scheduler", list = b.services.filter(function (s) { return new Date(s.startsAt) > Date.now() - 6 * 3600e3; });
    return '<div class="card"><h2>Schedule</h2>' + (list.length ? list.map(function (s) { return serviceCard(s, sched); }).join("") : '<p class="muted" style="margin:0">No services scheduled yet.' + (sched ? " Make one with + New service." : "") + "</p>") + "</div>";
  }
  function teams() {
    var b = st.board, sched = st.me.role === "scheduler", owner = st.me.churchRole === "owner";
    var group = function (kind, title) {
      var list = b.teams.filter(function (t) { return t.kind === kind; });
      return '<div class="card"><div class="row" style="justify-content:space-between"><h2>' + title + ' <span class="muted small">(' + list.length + " of " + b.limits.teamsPerKind + ")</span></h2>" +
        (sched && list.length < b.limits.teamsPerKind ? '<button class="small" data-newteam="' + kind + '">+ New ' + kind + " team</button>" : "") + "</div>" +
        (list.length ? '<div class="teams">' + list.map(function (t) {
          return '<div class="team"><h4><span>' + esc(t.name) + "</span>" + (sched ? '<span><button class="small" data-renteam="' + t.id + '">Rename</button> <button class="small no" data-delteam="' + t.id + '">✕</button></span>' : "") + "</h4>" +
            (t.members.length ? t.members.map(function (m) { return '<div class="p"><span>' + esc(m.name || m.email) + (m.role ? ' <span class="r">· ' + esc(m.role) + "</span>" : "") + "</span>" + (sched ? '<button class="small" data-rmmem="' + t.id + '" data-email="' + esc(m.email) + '">✕</button>' : "") + "</div>"; }).join("") : '<span class="muted small">Nobody yet.</span>') +
            (sched ? (st.editTeam === t.id ? '<div class="grid2" style="grid-template-columns:1fr"><input placeholder="Name" id="mName"><input placeholder="Email" type="email" id="mEmail"><input placeholder="Role (Bass, Lights…)" id="mRole"><div class="row"><button class="small primary" data-addmem="' + t.id + '">Add</button><button class="small" data-a="cancelmem">Done</button></div></div>'
              : '<button class="small" data-editteam="' + t.id + '">+ Add people</button>') : "") + "</div>";
        }).join("") + "</div>" : '<p class="muted small" style="margin:0">No ' + kind + " teams yet.</p>") + "</div>";
    };
    var people = b.people || [];
    return group("worship", "Worship teams") + group("production", "Production teams") +
      '<div class="card"><h2>Schedulers <span class="muted small">(up to ' + b.limits.schedulers + ")</span></h2><div>" + b.schedulers.map(function (u) { return esc(u.name || u.email); }).join(" · ") + "</div>" +
      (owner ? '<details><summary class="small">Choose the schedulers</summary><div style="display:grid;gap:.2rem;margin-top:.4rem">' + people.map(function (p) { return '<label class="pick"><input type="checkbox" data-schedpick value="' + esc(p.email) + '"' + (b.schedulers.some(function (u) { return u.email === p.email; }) ? " checked" : "") + "> " + esc(p.name || p.email) + ' <span class="muted small">· ' + esc(p.role) + "</span></label>"; }).join("") +
        '<button class="small primary" data-a="saveSched" style="justify-self:start">Save</button></div></details>' : "") + "</div>";
  }
  function newService(forId) {
    var b = st.board, f = st.form || {};
    var svc = forId ? b.services.filter(function (s) { return s.id === forId; })[0] : null;
    var asked = {}; if (svc) svc.requests.forEach(function (r) { asked[r.teamId + "|" + r.email] = true; });
    var pick = b.teams.map(function (t) {
      return '<div class="team"><h4><label class="pick"><input type="checkbox" data-pickteam="' + t.id + '"> ' + esc(t.name) + '</label><span class="kind">' + t.kind + "</span></h4>" + t.members.map(function (m) {
        var k = t.id + "|" + m.email;
        return '<label class="pick"><input type="checkbox" data-pick="' + esc(k) + '"' + (asked[k] ? " checked disabled" : "") + "> " + esc(m.name || m.email) + (m.role ? ' <span class="muted small">· ' + esc(m.role) + "</span>" : "") + "</label>";
      }).join("") + "</div>";
    }).join("");
    return '<div class="card"><h2>' + (svc ? "Ask more people: " + esc(svc.title) + ", " + esc(when(svc.startsAt, true)) : "New service") + "</h2>" +
      (svc ? "" : '<div class="grid2"><label>Name<input id="fTitle" placeholder="Sunday 9:00" value="' + esc(f.title || "") + '"></label><label>Date and time<input id="fWhen" type="datetime-local" value="' + esc(f.when || "") + '"></label></div><label>Notes (optional)<textarea id="fNotes" rows="2">' + esc(f.notes || "") + "</textarea></label>") +
      '<h3>Who to ask</h3>' + (b.teams.length ? '<div class="teams">' + pick + "</div>" : '<p class="muted">Make teams first (Teams).</p>') +
      '<label class="pick"><input type="checkbox" id="fMail" checked> Email them the request</label>' +
      '<div class="row"><button class="primary" data-a="' + (svc ? "askmore" : "create") + '"' + (svc ? ' data-svc="' + svc.id + '"' : "") + ">" + (svc ? "Ask them" : "Schedule it") + "</button>" + (svc ? '<button data-tab="schedule">Cancel</button>' : "") + "</div></div>";
  }
  function draw() {
    var root = $("#root"), a = document.activeElement, keepId = a && a.id && a.tagName !== "BUTTON" ? a.id : null, keepVal = keepId ? a.value : null;
    if (!st.me) { root.innerHTML = signIn(); return; }
    var h = header() + "<main>";
    if (!st.me.church) h += '<div class="card"><h2>Not in a church yet</h2><p style="margin:0">Ask your main admin to add you on the Teams page of the Motion Audio website, or join with your church\'s code when you make your account.</p></div>';
    else if (!st.me.hasServices) h += '<div class="card"><h2>' + esc(st.me.church) + '</h2><p style="margin:0">Your church doesn\'t have Central Services yet. The main admin can add it in the store: $25 for the whole church, free with a church pack.</p></div>';
    if (st.tab === "app") h += appSettings();
    else if (st.board) h += st.tab === "schedule" ? schedule() : st.tab === "teams" ? teams() : st.tab === "new" ? newService() : st.tab.indexOf("ask-") === 0 ? newService(st.tab.slice(4)) : mine();
    h += (st.msg ? '<div class="okmsg">' + esc(st.msg) + "</div>" : "") + (st.err ? '<div class="err">' + esc(st.err) + "</div>" : "") + "</main>";
    root.innerHTML = h;
    if (keepId && document.getElementById(keepId)) { var n = document.getElementById(keepId); n.value = keepVal; try { n.focus(); } catch (_) { } }
  }
  function say(m) { st.msg = m; st.err = ""; setTimeout(function () { if (st.msg === m) { st.msg = ""; draw(); } }, 4000); }

  // ---------------------------------------------------------------- actions
  async function act(fn) { try { st.err = ""; await fn(); } catch (e) { st.err = e.message; } await load(); }
  document.addEventListener("change", function (e) {
    var t = e.target;
    if (t.dataset && t.dataset.pickteam) document.querySelectorAll('[data-pick^="' + t.dataset.pickteam + '|"]').forEach(function (c) { if (!c.disabled) c.checked = t.checked; });
  });
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("button"); if (!b) return;
    var d = b.dataset;
    if (d.tab) { st.tab = d.tab; st.msg = ""; draw(); return; }
    if (d.a === "login" || d.a === "signup") {
      var body = { email: ($("#sEmail") || {}).value, password: ($("#sPass") || {}).value };
      if (d.a === "signup") { body.name = ($("#sName") || {}).value; if (($("#sCode") || {}).value) { body.churchCode = $("#sCode").value; body.churchRole = "user"; } }
      api("POST", d.a === "signup" ? "/signup" : "/login", body).then(function (r) { setToken(r.token); st.err = r.churchError || ""; st.note = ""; load(); }).catch(function (er) { st.err = er.message; draw(); });
      return;
    }
    if (d.a === "toggle") { st.signup = !st.signup; st.err = ""; st.note = ""; draw(); return; }
    if (d.a === "forgot") {   // the website emails a link to set a new password; then sign in here with it
      var em = (($("#sEmail") || {}).value || "").trim(); st.email = em;
      if (!em) { st.err = "Type your account's email first, then press Forgot password?"; st.note = ""; draw(); return; }
      api("POST", "/password/forgot", { email: em }).then(function (r) { st.err = ""; st.note = (r.message || "Check your email.") + " Set the new password with the link, then sign in here."; draw(); })
        .catch(function (er) { st.note = ""; st.err = er.message; draw(); });
      return;
    }
    if (d.a === "logout") { setToken(null); st.me = null; st.board = null; st.tab = "mine"; st.landed = false; st.msg = ""; st.err = ""; st.editTeam = null; st.form = null; draw(); return; }
    if (d.a === "refresh") { load(); return; }
    if (d.a === "saveapp") {
      var addr = (($("#aServer") || {}).value || "").trim().replace(/\/+$/, "");
      if (addr && !/^https?:\/\//.test(addr)) addr = "https://" + addr;
      try { if (addr && addr !== String(window.CS_SERVER || "").replace(/\/+$/, "")) localStorage.setItem("cs-server", addr); else localStorage.removeItem("cs-server"); } catch (_) { }
      if (DESK && $("#aAuto")) DESK.config({ autoInstall: $("#aAuto").checked }).then(function (r) { Object.assign(up, r); });
      if (addr !== BASE) { BASE = addr; setToken(null); st.me = null; st.board = null; }
      st.tab = "mine"; say("✓ Saved"); load(); return;
    }
    if (d.a === "upcheck" && DESK) { autoDecided = true; DESK.check().then(function (r) { Object.assign(up, r); draw(); }); return; }
    if (d.a === "upinstall" && DESK) { installNow(); return; }
    if (d.a === "upnow") { stopAuto(); installNow(); return; }
    if (d.a === "upnot") { stopAuto(); return; }
    if (d.ans) { var note = ($("#note-" + d.id) || {}).value || ""; act(async function () { await api("POST", "/services/requests/" + d.id, { status: d.ans, note: note }); say(d.ans === "accepted" ? "✓ Accepted" : "Declined"); }); return; }
    if (d.newteam) { var nm = prompt("Name of the new " + d.newteam + " team:"); if (nm) act(async function () { await api("POST", "/services/teams", { kind: d.newteam, name: nm }); }); return; }
    if (d.renteam) { var rn = prompt("New name:"); if (rn) act(async function () { await api("POST", "/services/teams/" + d.renteam + "/rename", { name: rn }); }); return; }
    if (d.delteam) { if (confirm("Delete this team? Its requests go too.")) act(async function () { await api("POST", "/services/teams/" + d.delteam + "/remove"); }); return; }
    if (d.editteam) { st.editTeam = d.editteam; draw(); return; }
    if (d.a === "cancelmem") { st.editTeam = null; draw(); return; }
    if (d.addmem) { var m = { name: $("#mName").value, email: $("#mEmail").value, role: $("#mRole").value }; act(async function () { await api("POST", "/services/teams/" + d.addmem + "/members", { members: [m] }); say("✓ Added " + (m.name || m.email)); }); return; }
    if (d.rmmem) { act(async function () { await api("POST", "/services/teams/" + d.rmmem + "/members/remove", { email: d.email }); }); return; }
    if (d.a === "saveSched") { var em = Array.from(document.querySelectorAll("[data-schedpick]:checked")).map(function (c) { return c.value; }); act(async function () { await api("POST", "/services/schedulers", { emails: em }); say("✓ Schedulers saved"); }); return; }
    if (d.a === "create" || d.a === "askmore") {
      var ask = Array.from(document.querySelectorAll("[data-pick]:checked:not(:disabled)")).map(function (c) { var p = c.dataset.pick.split("|"); return { teamId: p[0], email: p.slice(1).join("|") }; }), mail = ($("#fMail") || {}).checked !== false;
      if (d.a === "create") {
        st.form = { title: $("#fTitle").value, when: $("#fWhen").value, notes: $("#fNotes").value };
        if (!st.form.title || !st.form.when) { st.err = "Give it a name, a date and a time."; return draw(); }
        act(async function () { var r = await api("POST", "/services/events", { title: st.form.title, startsAt: new Date(st.form.when).toISOString(), notes: st.form.notes, ask: ask, email: mail }); st.form = null; st.tab = "schedule"; say("✓ Scheduled · " + r.asked + " asked"); });
      } else act(async function () { var r = await api("POST", "/services/events/" + d.svc + "/ask", { ask: ask, email: mail }); st.tab = "schedule"; say("✓ " + r.asked + " more asked"); });
      return;
    }
    if (d.ask) { st.tab = "ask-" + d.ask; draw(); return; }
    if (d.delsvc) { if (confirm("Delete this service and its requests?")) act(async function () { await api("POST", "/services/events/" + d.delsvc + "/remove"); }); return; }
    if (d.unask) { act(async function () { await api("POST", "/services/requests/" + d.unask + "/remove"); }); return; }
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Enter" && e.target.closest && e.target.closest(".center")) { var b = document.querySelector(".center button.primary"); if (b) b.click(); } });
  setInterval(function () { if (st.me && !st.editTeam && st.tab !== "new" && st.tab.indexOf("ask-") !== 0 && !(document.activeElement && document.activeElement.tagName === "INPUT")) load(); }, 60000);
  // updates on a computer: a new version found when the app opens installs by itself after a 10-second notice
  // ("Not now" skips it; ⚙ App turns it off). Everything is on the website, so nothing is lost.
  var autoDecided = false, autoTimer = null, autoLeft = 0, openedAt = Date.now();
  function bar() { var b = $("#csUpd"); if (!b) { b = document.createElement("div"); b.id = "csUpd"; b.className = "card"; b.style.cssText = "position:fixed;left:1rem;right:1rem;bottom:1rem;z-index:9;max-width:520px;margin:0 auto;box-shadow:0 8px 30px rgba(0,0,0,.25)"; document.body.appendChild(b); } return b; }
  function stopAuto() { if (autoTimer) { clearInterval(autoTimer); autoTimer = null; } var b = $("#csUpd"); if (b) b.remove(); }
  function installNow() {
    var b = bar(); b.innerHTML = "<b>Installing Central Services " + esc(up.latest || "") + "…</b><span class=\"muted small\">The app restarts by itself.</span>";
    DESK.install().then(function (r) { if (r && r.ok === false) { b.innerHTML = '<span class="err">Update failed: ' + esc(r.error || "") + '</span><div class="row"><button class="small" data-a="upnot">Close</button></div>'; } });
  }
  function autoStart() {
    if (autoDecided || autoTimer || !up.current) return;
    if (!up.latest && !up.available) { if (Date.now() - openedAt > 30 * 60e3) autoDecided = true; return; }
    autoDecided = true;
    if (!up.available || up.busy || up.auto === false || up.autoInstall === false) return;
    autoLeft = 10;
    function paint() { bar().innerHTML = "<b>Updating Central Services to " + esc(up.latest) + " in " + autoLeft + ' s</b><span class="muted small">The app restarts by itself; your schedule is on the website, nothing is lost.</span><div class="row"><button class="primary small" data-a="upnow">Update now</button><button class="small" data-a="upnot">Not now</button></div>'; }
    paint();
    autoTimer = setInterval(function () { autoLeft--; if (autoLeft > 0) return paint(); clearInterval(autoTimer); autoTimer = null; installNow(); }, 1000);
  }
  if (DESK) {
    DESK.on(function (r) { Object.assign(up, r); autoStart(); if (st.tab === "app") draw(); });
    DESK.status().then(function (r) { Object.assign(up, r); autoStart(); });
  }
  window.CentralServices = { state: function () { return st; }, load: load, updates: function () { return up; } };
  load();
})();
