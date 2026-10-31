/* Central Services - the church's schedule (the website at /services/, and the app on iPhone, iPad, Mac, Windows, Linux
 * and Android, which carries this same page). Sign in: the account says who you are - a scheduler (the main admin and
 * up to 3 more) makes teams and services and asks people; everyone else sees their requests (accept / decline) and the
 * whole schedule: every worship and production team, each person's name, role, and yes / no / not yet.
 * 10.0.1: the church's setlists (made in Central Control / Pedal Control, kept on the church account) show here - on
 * the service they're for (same day) and under Setlists: songs in order with key, tempo and whether it has tracks,
 * and the setlist's team. */
(function () {
  "use strict";
  // the website: the same address this page came from; the apps set window.CS_SERVER (their copy of this page is local)
  // (in the apps the address can be changed: ⚙ App → Website address)
  var APP = !!window.CS_APP, saved = null; try { saved = APP ? localStorage.getItem("cs-server") : null; } catch (_) { }
  var BASE = String(saved || (window.CS_SERVER != null ? window.CS_SERVER : (location.protocol.indexOf("http") === 0 ? location.origin : ""))).replace(/\/+$/, "");
  var DESK = window.CSDesktop && window.CSDesktop.updates;   // (the Mac / Windows / Linux app: updates; phones and tablets update from their store)
  var LS = "cs-token";
  var token = null; try { token = localStorage.getItem(LS); } catch (_) { }
  var st = { me: null, board: null, tab: "mine", msg: "", err: "", busy: false, form: null, editTeam: null, signup: false, two: null, editSongs: null, setlists: null };
  function $(s) { return document.querySelector(s); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function deviceId() { var d = null; try { d = localStorage.getItem("cs-device"); if (!d) { d = "cs-" + Array.from(crypto.getRandomValues(new Uint8Array(12)), function (x) { return ("0" + x.toString(16)).slice(-2); }).join(""); localStorage.setItem("cs-device", d); } } catch (_) { } return d || ""; }
  // what goes wrong on this page is reported to the website (the support email hears about new kinds of errors)
  (function () {
    var sent = {}, n = 0;
    function report(message, stack) {
      var k = String(message).slice(0, 200); if (!message || sent[k] || n >= 10 || !BASE) return; sent[k] = 1; n++;
      try { fetch(BASE + "/v1/errors", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source: "central-services", version: window.CS_VERSION || "", message: String(message).slice(0, 500), stack: String(stack || "").slice(0, 4000), url: APP ? "app" : location.pathname, platform: navigator.userAgent.slice(0, 120) }) }).catch(function () { }); } catch (_) { }
    }
    addEventListener("error", function (e) { report(e.message || "Script error", e.error && e.error.stack); });
    addEventListener("unhandledrejection", function (e) { var x = e.reason || {}; if (x.status) return; report("Unhandled: " + (x.message || String(x)), x.stack); });
    window.CCReportError = report;   // (the computer app's main process reports through here)
  })();
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
      st.setlists = null;
      if (st.board) { try { var sl = await api("GET", "/setlists?full=1"); st.setlists = sl.church ? sl.setlists || [] : []; } catch (_) { st.setlists = []; } }
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
    var su = st.signup, t = st.two;
    if (t) return '<div class="center card"><h2>' + (t.step === "phone" ? "Add your phone" : "Enter the code") + "</h2>" +
      (t.step === "phone" ? '<p class="muted" style="margin:0">You\'re an admin, so signing in on a new device also takes a code sent to your phone.</p><label>Mobile number<input id="tPhone" type="tel" autocomplete="tel" placeholder="555-123-4567"></label><div class="row"><button class="primary" data-a="tphone">Send the code</button><button data-a="tcancel">Cancel</button></div>'
        : '<p class="muted" style="margin:0">We ' + (t.by === "email" ? "emailed" : "texted") + " a 6-digit code to <b>" + esc(t.to) + "</b>" + (t.both ? " and emailed another to you (adding a phone takes both)" : "") + '.</p><label>' + (t.both ? "Code from the text" : "Code") + '<input id="tCode" inputmode="numeric" autocomplete="one-time-code" maxlength="7"></label>' + (t.both ? '<label>Code from the email<input id="tECode" inputmode="numeric" maxlength="7"></label>' : "") + '<div class="row"><button class="primary" data-a="tcode">Sign in</button><button data-a="tagain">Send again</button><button data-a="tcancel">Cancel</button></div>') +
      (st.err ? '<div class="err">' + esc(st.err) + "</div>" : "") + (st.note ? '<div class="okmsg">' + esc(st.note) + "</div>" : "") + "</div>";
    return '<div class="center card"><h2>Central Services</h2><p class="muted" style="margin:0">Sign in with your Motion Audio account (the one from your church\'s invite).</p>' +
      (su ? '<label>Name<input id="sName" autocomplete="name"></label>' : "") +
      '<label>Email<input id="sEmail" type="email" autocomplete="username" value="' + esc(st.email || "") + '"></label><label>Password' + (su ? " (8+ characters)" : "") + '<input id="sPass" type="password" autocomplete="' + (su ? "new-password" : "current-password") + '"></label>' +
      (su ? '<label>Church code (from your main admin - optional if they added you)<input id="sCode"></label>' : "") +
      '<div class="row"><button class="primary" data-a="' + (su ? "signup" : "login") + '">' + (su ? "Make my account" : "Sign in") + '</button><button data-a="toggle">' + (su ? "I have an account" : "Make an account") + "</button>" + (su ? "" : '<button class="small" data-a="forgot">Forgot password?</button>') + "</div>" +
      (st.note ? '<div class="okmsg">' + esc(st.note) + "</div>" : "") +
      '<p class="muted small" style="margin:0">' + (su ? "Making an account means you agree to the " + policy("terms", "Terms") + " and the " + policy("privacy", "Privacy policy") + ". " : "") + '<button class="small" data-a="support">Contact support</button></p>' + (st.tab === "support" ? supportCard() : "") +
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
    var m = st.me, sched = m.role === "scheduler", who = { church: "Church account", owner: "Main admin", admin: "Admin", user: "User" }[m.churchRole] || "Team member";
    return '<header><h1>' + esc(m.church || "Central Services") + '</h1><span class="muted small">Central Services</span><div class="who"><span>' + esc(m.name || m.email) + '</span><span class="badge' + (m.churchRole === "church" || m.churchRole === "owner" || m.churchRole === "admin" ? " adm" : "") + '" data-role="' + esc(m.churchRole || "") + '">' + who + "</span>" + (sched ? '<span class="badge sched">Scheduler</span>' : "") + '<button class="small" data-a="refresh" title="Refresh">↻</button><button class="small" data-a="logout">Sign out</button></div></header>' +
      '<nav>' + [["mine", "My requests"], ["schedule", "Schedule"], ["setlists", "Setlists"], ["away", "Away"], ["teams", "Teams"]].concat(sched ? [["new", "+ New service"]] : []).concat([["account", "Account"]]).concat(APP ? [["app", "⚙ App"]] : []).map(function (t) { return '<button class="' + (st.tab === t[0] ? "on" : "") + '" data-tab="' + t[0] + '">' + t[1] + "</button>"; }).join("") + "</nav>";
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
    var away = awayOn(s.day);
    return '<div class="card svc"><div class="row" style="justify-content:space-between"><div><div class="when">' + esc(when(s.startsAt)) + "</div><div>" + esc(s.title) + "</div>" + (s.notes ? '<div class="muted small">' + esc(s.notes) + "</div>" : "") + "</div>" +
      '<div class="small muted">' + c.accepted + " yes · " + c.declined + " no · " + c.pending + " not yet</div></div>" +
      songsBlock(s, sched) + setlistBlock(setlistFor(s)) +
      (away.length ? '<div class="small muted">Away that day: ' + away.map(function (b) { return esc(b.name || b.email); }).join(", ") + "</div>" : "") +
      (cols ? '<div class="teams">' + cols + "</div>" : '<p class="muted small" style="margin:0">Nobody asked yet.</p>') +
      (sched ? '<div class="row"><button class="small" data-ask="' + s.id + '">Ask more people</button><button class="small no" data-delsvc="' + s.id + '">Delete</button></div>' : "") + "</div>";
  }
  function schedule() {
    var b = st.board, sched = st.me.role === "scheduler", list = b.services.filter(function (s) { return new Date(s.startsAt) > Date.now() - 6 * 3600e3; });
    return '<div class="card"><h2>Schedule</h2>' + (list.length ? list.map(function (s) { return serviceCard(s, sched); }).join("") : '<p class="muted" style="margin:0">No services scheduled yet.' + (sched ? " Make one with + New service." : "") + "</p>") + "</div>";
  }
  // the church's Central Services slots: each person on the teams takes one; taking someone off frees it
  function slotsCard(b) {
    var x = b.slots; if (!x) return "";
    var buyer = st.me.churchRole === "church" || st.me.churchRole === "owner" || st.me.churchRole === "admin", site = BASE ? BASE + "/#account" : "";
    if (x.trial) return '<div class="card slots"><h2>Slots</h2><p class="muted small" style="margin:0">Free trial: as many people as you like until ' + esc(new Date(x.trial).toLocaleDateString()) + ".</p></div>";
    var pct = x.slots ? Math.min(100, Math.round(x.used / x.slots * 100)) : 100, full = x.free <= 0;
    return '<div class="card slots"><div class="row" style="justify-content:space-between;align-items:baseline"><h2>Slots</h2><span class="slots-n"><b>' + x.used + '</b> of ' + x.slots + ' in use</span></div>' +
      '<div class="meterbar' + (full ? " full" : "") + '"><i style="width:' + pct + '%"></i></div>' +
      '<p class="muted small" style="margin:0">' + (full ? "<b>Every slot is in use.</b> " : x.free + " free. ") + "Each person on your teams takes one (the church account doesn't); take someone off a team and theirs is free for the next person." +
      (buyer && site ? ' <a href="' + esc(site) + '" target="_blank" rel="noopener">Add slots on the website</a> ($5 each, once).' : full ? " Ask your main admin for more." : "") + "</p></div>";
  }
  function teams() {
    var b = st.board, sched = st.me.role === "scheduler", owner = st.me.churchRole === "church" || st.me.churchRole === "owner";
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
    return slotsCard(b) + group("worship", "Worship teams") + group("production", "Production teams") +
      '<div class="card"><h2>Schedulers <span class="muted small">(up to ' + b.limits.schedulers + ")</span></h2><div>" + b.schedulers.map(function (u) { return esc(u.name || u.email); }).join(" · ") + "</div>" +
      (owner ? '<details><summary class="small">Choose the schedulers</summary><div style="display:grid;gap:.2rem;margin-top:.4rem">' + people.map(function (p) { return '<label class="pick"><input type="checkbox" data-schedpick value="' + esc(p.email) + '"' + (b.schedulers.some(function (u) { return u.email === p.email; }) ? " checked" : "") + "> " + esc(p.name || p.email) + ' <span class="muted small">· ' + esc({ church: "church account", owner: "main admin" }[p.role] || p.role) + "</span></label>"; }).join("") +
        '<button class="small primary" data-a="saveSched" style="justify-self:start">Save</button></div></details>' : "") + "</div>";
  }
  function newService(forId) {
    var b = st.board, f = st.form || {};
    var svc = forId ? b.services.filter(function (s) { return s.id === forId; })[0] : null;
    var asked = {}; if (svc) svc.requests.forEach(function (r) { asked[r.teamId + "|" + r.email] = true; });
    var dayAway = svc ? awayOn(svc.day) : f.when ? awayOn(String(f.when).slice(0, 10)) : null;
    var pick = b.teams.map(function (t) {
      return '<div class="team"><h4><label class="pick"><input type="checkbox" data-pickteam="' + t.id + '"> ' + esc(t.name) + '</label><span class="kind">' + t.kind + "</span></h4>" + t.members.map(function (m) {
        var k = t.id + "|" + m.email;
        var gone = dayAway && dayAway.some(function (b) { return b.email === m.email; });
        return '<label class="pick"><input type="checkbox" data-pick="' + esc(k) + '"' + (asked[k] ? " checked disabled" : gone ? " disabled" : "") + "> " + esc(m.name || m.email) + (m.role ? ' <span class="muted small">· ' + esc(m.role) + "</span>" : "") + (gone ? ' <span class="st declined">away</span>' : "") + "</label>";
      }).join("") + "</div>";
    }).join("");
    return '<div class="card"><h2>' + (svc ? "Ask more people: " + esc(svc.title) + ", " + esc(when(svc.startsAt, true)) : "New service") + "</h2>" +
      (svc ? "" : '<div class="grid2"><label>Name<input id="fTitle" placeholder="Sunday 9:00" value="' + esc(f.title || "") + '"></label><label>Date and time<input id="fWhen" type="datetime-local" value="' + esc(f.when || "") + '"></label></div><label>Notes (optional)<textarea id="fNotes" rows="2">' + esc(f.notes || "") + "</textarea></label>" +
        '<label>Songs (optional) - one a line: title, key, BPM<textarea id="fSongs" rows="4" placeholder="Way Maker, E, 68&#10;Goodness of God, Ab, 63">' + esc(f.songs || "") + "</textarea></label>" +
        '<div class="row"><button class="small" data-a="checkaway">Who\'s away that day?</button>' + (dayAway ? '<span class="muted small">' + (dayAway.length ? "Away: " + dayAway.map(function (b) { return esc(b.name || b.email); }).join(", ") : "Nobody is away that day.") + "</span>" : "") + "</div>") +
      '<h3>Who to ask</h3>' + (b.teams.length ? '<div class="teams">' + pick + "</div>" : '<p class="muted">Make teams first (Teams).</p>') +
      '<label class="pick"><input type="checkbox" id="fMail" checked> Email them the request</label>' +
      '<div class="row"><button class="primary" data-a="' + (svc ? "askmore" : "create") + '"' + (svc ? ' data-svc="' + svc.id + '"' : "") + ">" + (svc ? "Ask them" : "Schedule it") + "</button>" + (svc ? '<button data-tab="schedule">Cancel</button>' : "") + "</div></div>";
  }
  // ---- songs: the list on each service (schedulers edit it)
  function songsBlock(s, sched) {
    if (st.editSongs === s.id) {
      var rows = (st.songDraft || []).concat([{ title: "", key: "", bpm: "" }]);
      return '<div class="team"><h4><span>Songs</span></h4>' + rows.map(function (x, i) { return '<div class="row songrow"><input placeholder="Title" data-sg="' + i + '" data-f="title" value="' + esc(x.title) + '" style="flex:3;min-width:140px"><input placeholder="Key" data-sg="' + i + '" data-f="key" value="' + esc(x.key) + '" style="flex:1;min-width:60px"><input placeholder="BPM" inputmode="numeric" data-sg="' + i + '" data-f="bpm" value="' + esc(x.bpm || "") + '" style="flex:1;min-width:60px"></div>'; }).join("") +
        '<div class="row"><button class="small primary" data-savesongs="' + s.id + '">Save songs</button><button class="small" data-a="cancelsongs">Cancel</button></div></div>';
    }
    var list = s.songs || [];
    if (!list.length && !sched) return "";
    return '<div class="songs">' + (list.length ? '<b class="small">Songs</b><ol class="small">' + list.map(function (x) { return "<li>" + esc(x.title) + (x.key ? ' <span class="muted">· ' + esc(x.key) + "</span>" : "") + (x.bpm ? ' <span class="muted">· ' + x.bpm + " BPM</span>" : "") + (x.notes ? ' <span class="muted">· ' + esc(x.notes) + "</span>" : "") + "</li>"; }).join("") + "</ol>" : "") +
      (sched ? '<button class="small" data-editsongs="' + s.id + '">' + (list.length ? "Edit songs" : "+ Add songs") + "</button>" : "") + "</div>";
  }
  // ---- setlists (10.0.1): the church's setlists from Central Control / Pedal Control, with their songs and team
  function dayOf(d) { var x = new Date(d); return x.getFullYear() + "-" + ("0" + (x.getMonth() + 1)).slice(-2) + "-" + ("0" + x.getDate()).slice(-2); }
  function setlistFor(s) {   // the setlist for this service: the one set for the same day (the newest if there are more)
    var day = dayOf(s.startsAt);
    return (st.setlists || []).filter(function (x) { return x.serviceAt && dayOf(x.serviceAt) === day; })[0] || null;
  }
  function tracksOf(x) {   // what the song brings: multitracks, a pad, or just the song (no tracks)
    if (!x.trackId && !x.tracks) return { cls: "none", label: "No tracks" };   // (a Central Tracks song, or an app song with its multitracks)
    if (x.kind === "Pad") return { cls: "pad", label: "Pad" };
    return { cls: "yes", label: x.kind === "Prime" ? "Prime tracks" : "Tracks" };
  }
  function setlistSongs(sl) {
    var songs = sl.songs || [];
    if (!songs.length) return '<p class="muted small" style="margin:0">No songs in it yet.</p>';
    return '<ol class="setlist">' + songs.map(function (x) {
      var t = tracksOf(x);
      return '<li><span class="t">' + esc(x.title) + '</span><span class="k" title="Key">' + (x.key ? esc(x.key) : '<span class="muted">-</span>') + '</span><span class="b" title="Tempo">' + (x.bpm ? x.bpm + " BPM" : '<span class="muted">-</span>') + '</span><span class="trk ' + t.cls + '">' + t.label + "</span></li>";
    }).join("") + "</ol>";
  }
  function setlistTeam(sl) {
    var team = sl.team || [];
    return team.length ? '<div class="small"><span class="muted">Team:</span> ' + team.map(function (p) { return esc(p.name || p.email) + (p.role ? ' <span class="muted">(' + esc(p.role) + ")</span>" : ""); }).join(", ") + "</div>" : '<div class="small muted">No team picked for this setlist.</div>';
  }
  function setlistSummary(sl) {
    var songs = sl.songs || [], withTracks = songs.filter(function (x) { return x.trackId || x.tracks; }).length;
    return songs.length + " song" + (songs.length === 1 ? "" : "s") + (songs.length ? " · " + withTracks + " with tracks" : "");
  }
  function setlistBlock(sl) {
    if (!sl) return "";
    return '<div class="setlist-box" data-setlist="' + esc(sl.id) + '"><div class="row" style="justify-content:space-between"><b class="small">Setlist: ' + esc(sl.name) + '</b><span class="muted small">' + setlistSummary(sl) + "</span></div>" + setlistSongs(sl) + setlistTeam(sl) + "</div>";
  }
  function setlistsView() {
    var all = st.setlists || [], now = Date.now() - 12 * 3600e3;
    var coming = all.filter(function (x) { return x.serviceAt && new Date(x.serviceAt) >= now; }).sort(function (a, b) { return new Date(a.serviceAt) - new Date(b.serviceAt); });
    var rest = all.filter(function (x) { return coming.indexOf(x) < 0; });
    var card = function (sl) {
      return '<div class="card svc" data-setlist="' + esc(sl.id) + '"><div class="row" style="justify-content:space-between"><div>' + (sl.serviceAt ? '<div class="when">' + esc(when(sl.serviceAt)) + "</div>" : "") + "<div><b>" + esc(sl.name) + '</b></div></div><span class="muted small">' + setlistSummary(sl) + "</span></div>" + setlistSongs(sl) + setlistTeam(sl) + "</div>";
    };
    if (st.setlists === null) return '<div class="card"><h2>Setlists</h2><p class="muted" style="margin:0">Loading…</p></div>';
    if (!all.length) return '<div class="card"><h2>Setlists</h2><p class="muted" style="margin:0">No setlists yet. Make one in Central Control or Pedal Control (Setlist → Create new): it shows here with its songs, keys, tempos, tracks and team.</p></div>';
    return '<div class="card"><h2>Setlists</h2>' + (coming.length ? coming.map(card).join("") : '<p class="muted small" style="margin:0">None set for an upcoming service.</p>') +
      (rest.length ? '<details' + (coming.length ? "" : " open") + '><summary class="small">' + (coming.length ? "Other setlists" : "All setlists") + " (" + rest.length + ')</summary><div style="display:grid;gap:.65rem;margin-top:.5rem">' + rest.map(card).join("") + "</div></details>" : "") + "</div>";
  }
  function parseSongs(text) {   // "Title, Key, BPM" a line
    return String(text || "").split("\n").map(function (l) { var p = l.split(/\s*[,;|]\s*|\s+-\s+/); return { title: (p[0] || "").trim(), key: (p[1] || "").trim(), bpm: Number((p[2] || "").replace(/[^0-9.]/g, "")) || 0 }; }).filter(function (x) { return x.title; });
  }
  // ---- away: the days people can't serve
  function awayOn(day) { var b = st.board; return day && b && b.blockouts ? b.blockouts.filter(function (x) { return x.from <= day && x.to >= day; }) : []; }
  function fmtDay(d) { var x = new Date(d + "T12:00:00"); return x.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }); }
  function awayView() {
    var b = st.board, sched = st.me.role === "scheduler", mine = (b.blockouts || []).filter(function (x) { return x.mine; }), others = (b.blockouts || []).filter(function (x) { return !x.mine; });
    var people = []; b.teams.forEach(function (t) { t.members.forEach(function (m) { if (!people.some(function (p) { return p.email === m.email; })) people.push(m); }); });
    var range = function (x) { return fmtDay(x.from) + (x.to !== x.from ? " – " + fmtDay(x.to) : ""); };
    return '<div class="card"><h2>Days I\'m away</h2><p class="muted small" style="margin:0">Schedulers see these, and asking a whole team skips you on those days. A request you hadn\'t answered for one of them turns into a no.</p>' +
      (mine.length ? mine.map(function (x) { return '<div class="p"><span><b>' + range(x) + "</b>" + (x.note ? ' <span class="r">· ' + esc(x.note) + "</span>" : "") + '</span><button class="small" data-rmaway="' + x.id + '">Remove</button></div>'; }).join("") : '<span class="muted small">None.</span>') +
      '<div class="grid2"><label>First day<input type="date" id="aFrom"></label><label>Last day<input type="date" id="aTo"></label></div><label>Note (optional)<input id="aNote" placeholder="Vacation, work trip…"></label>' +
      (sched ? '<label>For<select id="aWho"><option value="">Me</option>' + people.map(function (p) { return '<option value="' + esc(p.email) + '">' + esc(p.name || p.email) + "</option>"; }).join("") + "</select></label>" : "") +
      '<div class="row"><button class="primary" data-a="addaway">Add</button></div></div>' +
      '<div class="card"><h2>Who\'s away</h2>' + (others.length ? others.map(function (x) { return '<div class="p"><span><b>' + esc(x.name || x.email) + "</b> " + range(x) + (x.note ? ' <span class="r">· ' + esc(x.note) + "</span>" : "") + "</span>" + (sched ? '<button class="small" data-rmaway="' + x.id + '">✕</button>' : "") + "</div>"; }).join("") : '<span class="muted small">Nobody else.</span>') + "</div>";
  }
  // ---- account: policies, support, delete
  function policy(name, label) { return '<a href="' + esc(BASE) + "/" + name + '" target="_blank" rel="noopener">' + label + "</a>"; }
  function accountCard() {
    var m = st.me || {};
    return '<div class="card"><h2>Account</h2>' + (m.email ? "<div>" + esc(m.name || "") + " <b>" + esc(m.email) + "</b></div>" : "") +
      '<div class="row small">' + policy("privacy", "Privacy policy") + " · " + policy("terms", "Terms") + " · " + policy("refunds", "Refunds") + ' <button class="small" data-a="support">Contact support</button></div>' +
      (m.email ? '<details><summary class="small" style="color:var(--no)">Delete my account</summary><p class="muted small">Removes your name, email and phone, frees your keys and takes you out of your church. It can\'t be undone. The main admin hands that role to someone else first (on the website: Account → People).</p>' +
        '<label>Your password<input type="password" id="delPw" autocomplete="current-password"></label><div class="row"><button class="no" data-a="delacct">Delete my account</button></div></details>' : "") + "</div>";
  }
  function supportCard() {
    var m = st.me || {};
    return '<div class="card"><h2>Contact support</h2><p class="muted small" style="margin:0">Tell us what\'s going on. We answer by email.</p>' +
      '<label>Your email<input type="email" id="spEmail" value="' + esc(m.email || ($("#sEmail") || {}).value || "") + '"></label><label>About<input id="spSubject" placeholder="Schedule, sign-in, keys…"></label><label>What\'s going on?<textarea id="spMsg" rows="4"></textarea></label>' +
      '<div class="row"><button class="primary" data-a="sendsupport">Send</button></div></div>';
  }
  function draw() {
    var root = $("#root"), a = document.activeElement, keepId = a && a.id && a.tagName !== "BUTTON" ? a.id : null, keepVal = keepId ? a.value : null;
    if (!st.me) { root.innerHTML = signIn(); return; }
    var h = header() + "<main>";
    if (!st.me.church) h += '<div class="card"><h2>Not in a church yet</h2><p style="margin:0">Ask your main admin to add you on the Teams page of the Motion Audio website, or join with your church\'s code when you make your account.</p></div>';
    else if (!st.me.hasServices) h += '<div class="card"><h2>' + esc(st.me.church) + '</h2><p style="margin:0">Your church doesn\'t have Central Services yet. A main admin or admin gets it on the Motion Audio website: every pack comes with slots for your team, or add them for $5 a person, once.</p></div>';
    if (st.tab === "app") h += appSettings();
    else if (st.tab === "account" || st.tab === "support") h += accountCard() + (st.tab === "support" ? supportCard() : "");
    else if (st.board) h += st.tab === "schedule" ? schedule() : st.tab === "setlists" ? setlistsView() : st.tab === "teams" ? teams() : st.tab === "away" ? awayView() : st.tab === "new" ? newService() : st.tab.indexOf("ask-") === 0 ? newService(st.tab.slice(4)) : mine();
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
      body.device = deviceId();
      api("POST", d.a === "signup" ? "/signup" : "/login", body).then(function (r) { if (r.step) { st.two = r; st.err = ""; st.note = r.churchError || ""; return draw(); } setToken(r.token); st.err = r.churchError || ""; st.note = ""; load(); }).catch(function (er) { st.err = er.message; draw(); });
      return;
    }
    if (d.a === "tphone") { api("POST", "/login/phone", { ticket: st.two.ticket, phone: ($("#tPhone") || {}).value }).then(function (r) { Object.assign(st.two, r); st.err = ""; draw(); }).catch(function (er) { st.err = er.message; draw(); }); return; }
    if (d.a === "tagain") { api("POST", "/login/resend", { ticket: st.two.ticket }).then(function (r) { Object.assign(st.two, r); st.err = ""; st.note = "A new code is on its way."; draw(); }).catch(function (er) { st.err = er.message; draw(); }); return; }
    if (d.a === "tcode") { api("POST", "/login/code", { ticket: st.two.ticket, code: ($("#tCode") || {}).value, emailCode: ($("#tECode") || {}).value }).then(function (r) { st.two = null; setToken(r.token); st.err = ""; st.note = ""; load(); }).catch(function (er) { st.err = er.message; draw(); }); return; }
    if (d.a === "tcancel") { st.two = null; st.err = ""; st.note = ""; draw(); return; }
    if (d.a === "support") { st.tab = "support"; draw(); var f = $("#spMsg"); if (f) f.focus(); return; }
    if (d.a === "sendsupport") {
      api("POST", "/support", { email: ($("#spEmail") || {}).value, subject: ($("#spSubject") || {}).value, message: ($("#spMsg") || {}).value, app: "Central Services", version: window.CS_VERSION || "", platform: navigator.userAgent.slice(0, 120) })
        .then(function (r) { st.tab = st.me ? "account" : "mine"; if (st.me) say("✓ " + r.message); else { st.note = r.message; st.err = ""; } draw(); }).catch(function (er) { st.err = er.message; draw(); });
      return;
    }
    if (d.a === "delacct") {
      if (!confirm("Delete your Motion Audio account for good?")) return;
      var pw = ($("#delPw") || {}).value || "";
      var go = function (close) { return api("POST", "/account/delete", { password: pw, closeChurch: close }); };
      go(false).catch(function (er) { if (er.status === 409 && /also closes/.test(er.message) && confirm(er.message + " Delete and close it?")) return go(true); throw er; })
        .then(function () { setToken(null); st.me = null; st.board = null; st.tab = "mine"; st.note = "Your account is deleted. A confirmation is in your email."; draw(); })
        .catch(function (er) { st.err = er.message; draw(); });
      return;
    }
    if (d.a === "addaway") {
      var from = ($("#aFrom") || {}).value, to = ($("#aTo") || {}).value || from, who = ($("#aWho") || {}).value || undefined, nt = ($("#aNote") || {}).value;
      if (!from) { st.err = "Pick the first day you're away."; return draw(); }
      act(async function () { var r = await api("POST", "/services/blockouts", { from: from, to: to, note: nt, email: who }); say("✓ Saved" + (r.declined ? " · " + r.declined + " request" + (r.declined > 1 ? "s" : "") + " on those days marked no" : "")); });
      return;
    }
    if (d.rmaway) { act(async function () { await api("POST", "/services/blockouts/" + d.rmaway + "/remove"); }); return; }
    if (d.a === "checkaway") { st.form = { title: ($("#fTitle") || {}).value, when: ($("#fWhen") || {}).value, notes: ($("#fNotes") || {}).value, songs: ($("#fSongs") || {}).value }; if (!st.form.when) { st.err = "Pick the date first."; } else st.err = ""; draw(); return; }
    if (d.editsongs) { var sv = st.board.services.filter(function (x) { return x.id === d.editsongs; })[0]; st.editSongs = d.editsongs; st.songDraft = (sv.songs || []).map(function (x) { return Object.assign({}, x); }); draw(); return; }
    if (d.a === "cancelsongs") { st.editSongs = null; draw(); return; }
    if (d.savesongs) {
      var rows = Array.from(document.querySelectorAll(".songrow")).map(function (row) { var g = function (f) { return (row.querySelector('[data-f="' + f + '"]') || {}).value || ""; }; return { title: g("title").trim(), key: g("key").trim(), bpm: Number(g("bpm")) || 0 }; }).filter(function (x) { return x.title; });
      act(async function () { await api("POST", "/services/events/" + d.savesongs + "/songs", { songs: rows }); st.editSongs = null; say("✓ Songs saved"); });
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
        st.form = { title: $("#fTitle").value, when: $("#fWhen").value, notes: $("#fNotes").value, songs: ($("#fSongs") || {}).value };
        if (!st.form.title || !st.form.when) { st.err = "Give it a name, a date and a time."; return draw(); }
        act(async function () { var r = await api("POST", "/services/events", { title: st.form.title, startsAt: new Date(st.form.when).toISOString(), notes: st.form.notes, songs: parseSongs(st.form.songs), ask: ask, email: mail }); st.form = null; st.tab = "schedule"; say("✓ Scheduled · " + r.asked + " asked" + (r.away && r.away.length ? " · away that day: " + r.away.join(", ") : "")); });
      } else act(async function () { var r = await api("POST", "/services/events/" + d.svc + "/ask", { ask: ask, email: mail }); st.tab = "schedule"; say("✓ " + r.asked + " more asked" + (r.away && r.away.length ? " · away that day: " + r.away.join(", ") : "")); });
      return;
    }
    if (d.ask) { st.tab = "ask-" + d.ask; draw(); return; }
    if (d.delsvc) { if (confirm("Delete this service and its requests?")) act(async function () { await api("POST", "/services/events/" + d.delsvc + "/remove"); }); return; }
    if (d.unask) { act(async function () { await api("POST", "/services/requests/" + d.unask + "/remove"); }); return; }
  });
  document.addEventListener("keydown", function (e) { if (e.key === "Enter" && e.target.closest && e.target.closest(".center")) { var b = document.querySelector(".center button.primary"); if (b) b.click(); } });
  setInterval(function () { if (st.me && !st.editTeam && !st.editSongs && st.tab !== "new" && st.tab !== "away" && st.tab !== "account" && st.tab.indexOf("ask-") !== 0 && !(document.activeElement && document.activeElement.tagName === "INPUT")) load(); }, 60000);
  // updates on a computer: a new version found when the app opens installs by itself after a 10-second notice
  // ("Not now" skips it; ⚙ App turns it off). Everything is on the website, so nothing is lost.
  var autoDecided = false, autoTimer = null, autoLeft = 0, openedAt = Date.now();
  function bar() { var b = $("#csUpd"); if (!b) { b = document.createElement("div"); b.id = "csUpd"; b.className = "card"; b.style.cssText = "position:fixed;left:1rem;right:1rem;bottom:1rem;z-index:9;max-width:520px;margin:0 auto;box-shadow:0 8px 30px rgba(0,0,0,.25)"; document.body.appendChild(b); } return b; }
  function stopAuto() { if (autoTimer) { clearInterval(autoTimer); autoTimer = null; } var b = $("#csUpd"); if (b) b.remove(); }
  function installNow() {
    var b = bar(); b.innerHTML = "<b>Installing Central Services " + esc(up.latest || "") + "…</b><span class=\"muted small\" id=\"csUpdNote\">The app restarts by itself.</span>";
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
    DESK.on(function (r) { Object.assign(up, r); var n = $("#csUpdNote"); if (n && r.busy) n.textContent = r.phaseText || (r.progress ? "Downloading… " + Math.round(r.progress * 100) + "%" : "The app restarts by itself."); autoStart(); if (st.tab === "app") draw(); });
    DESK.status().then(function (r) { Object.assign(up, r); autoStart(); });
  }
  window.CentralServices = { state: function () { return st; }, load: load, updates: function () { return up; }, support: function () { st.tab = "support"; draw(); } };
  load();
})();
