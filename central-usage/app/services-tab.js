/* Central Control - the main admin's Service tab, in two parts:
 *
 *   Run sheets          up to 12 (Sunday 9:00, Sunday 11:00, Wednesday, a special service on one date…), each with its
 *                       weekday and time or one date, how long it should run, the countdown before it, who's on, and its
 *                       items: songs from the track player's setlist, welcome, prayer, the sermon… each with minutes, who
 *                       leads it, a note, the roles it uses and the cues it fires on every computer (the song, lyrics on
 *                       or off, a lighting look, a slide, a camera, a stream scene, a lower third). "New run sheet" asks
 *                       a few questions and makes one (runsheet-gen.js, runsheet-wizard.js); drag the items to reorder,
 *                       save one as a template, print it. Start / Back / Next / Stop run it: every computer fires its
 *                       own cues (runsheet-cues.js) and counts down to its next part (countdown.js), and the run panel
 *                       says whether the service is running long or short. The booth's messages go to the band's
 *                       screen (the confidence monitor).
 *   Pre-service check   precheck.js: every device, key, output, input, light, camera, screen, the stream, disk space,
 *                       Wi-Fi, batteries, the songs and the clocks - green, amber or red, with what to do.
 *
 * Kept on the main admin's computer (the center), so services run with or without a Central Pedal; a paired Central
 * Pedal gets them for its stage display. */
(function () {
  "use strict";
  var CU = window.CentralUsage; if (!CU) return;
  var G = window.CURunsheetGen;
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var ROLE_LABEL = { lighting: "Lighting", production: "Cameras", slides: "Slides", lyrics: "Lyrics", mix: "Online mix", inears: "In-ears", band: "Band" };
  var KIND_LABEL = { countdown: "Countdown", welcome: "Welcome", song: "Song", announcements: "Announcements", scripture: "Scripture", prayer: "Prayer", offering: "Offering", video: "Video", sermon: "Sermon", communion: "Communion", baptism: "Baptism", closing: "Closing", other: "Other" };
  var CUE_LABEL = { song: "Song", lyrics: "Lyrics", look: "Lights look", slide: "Slide", camera: "Camera", scene: "Stream scene", lowerThird: "Lower third" };
  var DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var ALL = ["lighting", "production", "slides", "lyrics", "mix", "inears", "band"];
  var BOOTH = ["One more chorus", "Wrap it up", "Two minutes", "Go to the bridge", "Repeat the chorus", "Watch me"];
  var S = { services: [], run: null, templates: [], offset: 0, max: 12 }, sel = CU.store.get("svcSel", ""), saveT = 0, saved = "", openCues = {};
  var view = CU.store.get("svView", "sheets");
  function uid(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function item(kind, title) { if (G) { var it = G.item(kind); if (title) it.title = title; return it; } return { id: uid("it"), title: title || KIND_LABEL[kind], kind: kind, minutes: 5, roles: ALL.slice(), song: "", note: "", who: "", cues: {} }; }
  function cur() { return S.services.filter(function (x) { return x.id === sel; })[0] || S.services[0] || null; }
  function visible() { return CU.prefs.tab === "service"; }
  function fmt(sec) { sec = Math.round(sec); var neg = sec < 0; sec = Math.abs(sec); var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; return (neg ? "-" : "") + (h ? h + ":" + ("0" + m).slice(-2) : m) + ":" + ("0" + s).slice(-2); }
  function songs() { var d = CU.state.display; return (d && d.songs) || []; }
  function mins(m) { return (Math.round(m * 10) / 10) + " min"; }
  function whenText(x) { if (x.date) { var d = x.date.split("-").map(Number), dt = new Date(d[0], d[1] - 1, d[2]); return dt.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) + " " + x.time; } return DAYS[x.day] + " " + x.time; }

  // ------------------------------------------------------------- state from the center
  CU.on("message", function (m) {
    if (m.type === "services") {
      S.services = m.services || []; S.run = m.run || null; S.templates = m.templates || []; S.max = m.max || 12; S.offset = (m.now || Date.now()) - Date.now();
      if (!saveT) render(); CU.fire("services", S);
    } else if (m.type === "serviceReply" && !m.ok) toast(m.error || "Not done.");
    else if (m.type === "confidenceMessage" && visible()) paintBooth(m.message);
  });
  function ask() { CU.send({ type: "service", action: "get" }); }
  function toast(t) { if (window.CURoles && window.CURoles.toast) window.CURoles.toast(t); else alert(t); }
  CU.on("center", function (on) { if (on) setTimeout(ask, 800); });
  CU.on("role", function () { setTimeout(ask, 300); });

  function saveSoon() { clearTimeout(saveT); saved = "saving…"; paintSaved(); saveT = setTimeout(function () { saveT = 0; CU.send({ type: "service", action: "save", services: S.services }); saved = "✓ saved"; paintSaved(); }, 700); }
  function paintSaved() { var el = $("#svSaved"); if (el) el.textContent = saved; }

  // ------------------------------------------------------------- timing
  function total(sv) { return sv.items.reduce(function (t, i) { return t + (Number(i.minutes) || 0); }, 0); }
  function preCount(sv) { var n = 0; for (var i = 0; i < sv.items.length && sv.items[i].kind === "countdown"; i++) n += Number(sv.items[i].minutes) || 0; return n; }
  // the running service against its plan: + running long, - running short (seconds)
  function drift(run, sv) {
    var t = Date.now() + S.offset, planned = 0, i;
    for (i = 0; i < run.item; i++) planned += (Number(sv.items[i].minutes) || 0) * 60;
    var it = sv.items[run.item] || {}, left = (Number(it.minutes) || 0) * 60 - (t - run.itemStart) / 1000, rest = 0;
    for (i = run.item + 1; i < sv.items.length; i++) rest += (Number(sv.items[i].minutes) || 0) * 60;
    var projected = (t - run.startedAt) / 1000 + Math.max(0, left) + rest;
    return projected - (planned + (Number(it.minutes) || 0) * 60 + rest);
  }
  function driftText(d) { if (Math.abs(d) < 30) return '<span class="sv-drift ok">On time</span>'; return '<span class="sv-drift ' + (d > 0 ? "long" : "short") + '">Running ' + fmt(Math.abs(d)) + (d > 0 ? " long" : " short") + "</span>"; }
  function clockOf(sv) { if (G) return G.times(sv).map(function (x) { return x.clock; }); var out = [], p = sv.time.split(":").map(Number), t = p[0] * 60 + p[1] - preCount(sv); sv.items.forEach(function (it) { out.push(Math.floor(t / 60) % 24 + ":" + ("0" + Math.floor(t % 60)).slice(-2)); t += it.minutes; }); return out; }
  function endClock(sv) { var p = sv.time.split(":").map(Number), t = p[0] * 60 + p[1] + total(sv) - preCount(sv); return Math.floor(t / 60) % 24 + ":" + ("0" + Math.round(t % 60)).slice(-2); }

  // ------------------------------------------------------------- the tab
  function render() {
    var root = $("#serviceRoot"); if (!root || !visible()) return;
    var a = document.activeElement; if (root.contains(a) && /INPUT|SELECT|TEXTAREA/.test(a.tagName) && a.type !== "checkbox") return;
    if (window.CUPrecheck && view === "check" && root.querySelector(".pc")) { window.CUPrecheck.render($("#svCheck")); paintNav(); return; }
    var h = '<div class="sv"><nav class="sv-nav" role="tablist"><button data-svv="sheets" role="tab">Run sheets</button><button data-svv="check" role="tab">Pre-service check <span class="sv-badge" id="svBadge" hidden></span></button></nav>';
    if (view === "check") h += '<div id="svCheck"></div>';
    else h += sheets();
    root.innerHTML = h + "</div>";
    paintNav();
    if (view === "check" && window.CUPrecheck) window.CUPrecheck.render($("#svCheck"));
  }
  function paintNav() {
    document.querySelectorAll("#serviceRoot [data-svv]").forEach(function (b) { b.classList.toggle("on", b.dataset.svv === view); b.setAttribute("aria-selected", b.dataset.svv === view ? "true" : "false"); });
    var bd = $("#svBadge"), c = window.CUPrecheck && window.CUPrecheck.counts(); if (bd) { var n = c ? (c.bad || 0) + (c.warn || 0) : 0; bd.hidden = !n; bd.textContent = n; bd.className = "sv-badge" + (c && c.bad ? " bad" : ""); }
  }
  function sheets() {
    var sv = cur(); if (sv) sel = sv.id;
    var run = S.run, rsv = run && S.services.filter(function (x) { return x.id === run.service; })[0], h = "";
    // the run panel
    h += '<div class="sv-run card">' + (rsv ? (function () {
      var it = rsv.items[run.item] || {}, left = it.minutes * 60 - ((Date.now() + S.offset) - run.itemStart) / 1000, nx = rsv.items[run.item + 1];
      return '<div class="sv-runtop"><div class="sv-now"><small>Now · ' + esc(rsv.name) + " · " + (run.item + 1) + " of " + rsv.items.length + '</small><b>' + esc(it.title) + "</b>" + (it.who ? '<small>' + esc(it.who) + "</small>" : "") + '</div><span class="sv-left' + (left < 0 ? " over" : "") + '" id="svLeft">' + fmt(left) + '</span><div class="sv-nx">' + (nx ? "<small>Next</small><b>" + esc(nx.title) + "</b><small>" + mins(nx.minutes) + "</small>" : "<small>Last item</small>") + '<span id="svDrift">' + driftText(drift(run, rsv)) + "</span></div></div>" +
        '<div class="row"><button data-sv="prev">◀ Back</button><button class="primary sv-next" data-sv="next">Next ▶</button><button class="danger" data-sv="stop">Stop the service</button></div>' + booth();
    })() : '<div class="row"><b>Run a service</b>' + (S.services.length ? '<select id="svStartPick">' + S.services.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === sel ? " selected" : "") + ">" + esc(x.name) + " · " + esc(whenText(x)) + "</option>"; }).join("") + '</select><button class="primary" data-sv="start">▶ Start now</button>' : '<span class="muted">Make a run sheet first.</span>') + '<span class="muted small">Next and Back move every computer: each one fires its own cues and counts down to its next part.</span></div>' + booth()) + "</div>";
    // the run sheets
    h += '<div class="sv-list">' + S.services.map(function (x) { return '<button class="sv-pick' + (x.id === sel ? " on" : "") + '" data-sv-pick="' + esc(x.id) + '"><b>' + esc(x.name) + "</b><small>" + esc(whenText(x)) + " · " + x.items.length + " items · " + Math.round(total(x) - preCount(x)) + " min</small></button>"; }).join("") +
      (S.services.length < S.max ? '<button class="sv-pick add primary-ish" data-sv="wizard"><b>+ New run sheet</b><small>a few questions, then it makes one</small></button><button class="sv-pick add" data-sv="add"><b>+ Blank</b><small>' + S.services.length + " of " + S.max + "</small></button>" +
        (S.templates.length ? '<label class="sv-tpl">From a template <select id="svFromTpl"><option value="">Pick…</option>' + S.templates.map(function (t) { return '<option value="' + esc(t.id) + '">' + esc(t.name) + "</option>"; }).join("") + "</select></label>" : "") : "") +
      '<span class="muted small" id="svSaved">' + esc(saved) + "</span></div>";
    if (window.CUCenter && !window.CUCenter.connected()) h += '<p class="warn">The center on this computer isn\'t running. The run sheets are kept there.</p>';
    if (!songs().length) h += '<p class="muted small">No track player connected: songs can still be typed in as items. Its setlist shows up here when it\'s on.</p>';
    if (sv) h += editor(sv);
    return h;
  }
  function booth() {
    return '<div class="sv-booth"><span class="muted small">To the band\'s screen:</span>' + BOOTH.map(function (t) { return '<button class="mini" data-booth="' + esc(t) + '">' + esc(t) + "</button>"; }).join("") +
      '<input id="svBoothText" placeholder="Type a message…" maxlength="120"><button class="mini" data-sv="boothSend">Send</button><button class="mini" data-sv="boothClear">Clear</button><span class="small" id="svBoothNow"></span></div>';
  }
  function paintBooth(m) { var el = $("#svBoothNow"); if (el) el.textContent = m && m.text ? "Showing: “" + m.text + "”" : ""; }
  function dl(id, list) { return '<datalist id="' + id + '">' + list.map(function (x) { return '<option value="' + esc(x) + '">'; }).join("") + "</datalist>"; }
  // what the cue boxes suggest: this computer's lighting looks, slides, cameras (and the usual names)
  function suggestions() {
    var L = window.CULights, looks = [], slides = [], cams = [];
    try { looks = ((L && L.show && L.rig && L.rig().looks) || []).map(function (l) { return l.name; }).filter(Boolean); } catch (_) { }
    try { slides = ((window.CUSlides && window.CUSlides.state().items) || []).map(function (x) { return x.kind === "text" ? x.title : x.name; }).filter(Boolean); } catch (_) { }
    try { var V = window.CUVideoTab && window.CUVideoTab.state; cams = ((V && V.cfg && V.cfg.sources) || []).map(function (x) { return x.name; }).filter(Boolean); } catch (_) { }
    return { looks: uniq(looks.concat(["Walk-in", "Stage wash", "Speaker", "Prayer", "Video", "Baptism", "Follow the song"])), slides: uniq(slides.concat(["Countdown", "Welcome", "Announcements", "Offering", "Communion", "Thanks for coming"])), cams: uniq(cams.concat(["Wide", "Pulpit", "Band", "Baptism"])), scenes: ["Countdown", "Worship", "Sermon", "Video", "Closing"] };
  }
  function uniq(a) { var o = []; a.forEach(function (x) { if (o.indexOf(x) < 0) o.push(x); }); return o; }
  function editor(sv) {
    var times = clockOf(sv), sg = suggestions(), fit = G ? G.fit(sv) : { planned: total(sv), over: 0 }, team = sv.team || { leader: "", speaker: "", tech: [] };
    var h = '<div class="sv-edit card">' + dl("svLooks", sg.looks) + dl("svSlides", sg.slides) + dl("svCams", sg.cams) + dl("svScenes", sg.scenes) +
      '<div class="row sv-head"><label>Name <input data-svf="name" value="' + esc(sv.name) + '"></label>' +
      '<label title="Leave empty for every week">Date <input type="date" data-svf="date" value="' + esc(sv.date || "") + '"></label>' +
      (sv.date ? "" : '<label>Every <select data-svf="day">' + DAYS.map(function (d, i) { return '<option value="' + i + '"' + (sv.day === i ? " selected" : "") + ">" + d + "</option>"; }).join("") + "</select></label>") +
      '<label>Starts <input type="time" data-svf="time" value="' + esc(sv.time) + '"></label>' +
      '<label>Runs (min) <input type="number" min="0" max="600" data-svf="length" value="' + (sv.length || "") + '" placeholder="any" style="width:76px"></label>' +
      '<label>Countdown (min) <input type="number" min="0" max="60" data-svf="countdown" value="' + (sv.countdown || 0) + '" style="width:70px"></label>' +
      '<label class="toggle" title="The audio host records every input and a stereo mix while this service runs"><input type="checkbox" data-svf="record"' + (sv.record ? " checked" : "") + "> Record it</label>" +
      '<span class="spacer"></span><button data-sv="tpl" title="Keep this run sheet\'s order and cues to start the next one from">Save as template</button><button data-sv="print">Print</button><button class="danger" data-sv="del">Delete</button></div>' +
      '<div class="row sv-team"><label>Worship leader <input data-svt="leader" value="' + esc(team.leader) + '"></label><label>Speaker <input data-svt="speaker" value="' + esc(team.speaker) + '"></label><label class="grow">Tech team <input data-svt="tech" value="' + esc((team.tech || []).join(", ")) + '" placeholder="names, with commas"></label></div>' +
      '<div class="sv-roles"><span class="muted small">Roles used:</span>' + ALL.map(function (r) { return '<label class="toggle"><input type="checkbox" data-svrole="' + r + '"' + (sv.roles.indexOf(r) >= 0 ? " checked" : "") + "> " + ROLE_LABEL[r] + "</label>"; }).join("") + "</div>" +
      '<table class="sv-items"><colgroup><col style="width:26px"><col style="width:58px"><col><col style="width:132px"><col style="width:70px"><col style="width:120px"><col style="width:30%"><col style="width:112px"></colgroup><thead><tr><th></th><th>Starts</th><th>Item</th><th>Kind</th><th>Min</th><th>Who</th><th>Roles</th><th></th></tr></thead><tbody>';
    sv.items.forEach(function (it, i) {
      var live = S.run && S.run.service === sv.id && S.run.item === i, cues = it.cues || {}, nc = Object.keys(cues).length;
      h += '<tr data-i="' + i + '" draggable="true"' + (live ? ' class="live"' : "") + '><td class="sv-grip" title="Drag to move">⠿</td><td class="sv-clock">' + esc(times[i] || "") + "</td>" +
        '<td><input data-itf="title" value="' + esc(it.title) + '">' + (it.kind === "song" ? '<select data-itf="song"><option value="">- song from the setlist -</option>' + songs().map(function (q) { var v = q.id || q.name; return '<option value="' + esc(v) + '"' + (it.song === v ? " selected" : "") + ">" + esc(q.name) + (q.duration ? " (" + fmt(q.duration) + ")" : "") + "</option>"; }).join("") + "</select>" : "") + "</td>" +
        '<td><select data-itf="kind">' + Object.keys(KIND_LABEL).map(function (k) { return '<option value="' + k + '"' + (it.kind === k ? " selected" : "") + ">" + KIND_LABEL[k] + "</option>"; }).join("") + "</select></td>" +
        '<td><input type="number" min="0" max="240" step="0.5" data-itf="minutes" value="' + it.minutes + '"></td>' +
        '<td><input data-itf="who" value="' + esc(it.who || "") + '" placeholder="who"></td>' +
        '<td><div class="sv-iroles">' + sv.roles.map(function (r) { return '<label title="' + ROLE_LABEL[r] + '"><input type="checkbox" data-itrole="' + r + '"' + (it.roles.indexOf(r) >= 0 ? " checked" : "") + ">" + ROLE_LABEL[r] + "</label>"; }).join("") + "</div></td>" +
        '<td class="sv-iacts"><button class="mini' + (openCues[it.id] ? " on" : "") + '" data-it="cues" title="Cues and note">Cues' + (nc ? " " + nc : "") + '</button><button class="mini" data-it="del" title="Remove">✕</button></td></tr>';
      if (openCues[it.id]) h += '<tr class="sv-cuerow" data-i="' + i + '"><td></td><td colspan="7"><div class="sv-cues">' +
        (it.kind === "song" ? "" : '<label>Song <select data-cue="song"><option value="">-</option>' + songs().map(function (q) { var v = q.id || q.name; return '<option value="' + esc(v) + '"' + (cues.song === v ? " selected" : "") + ">" + esc(q.name) + "</option>"; }).join("") + "</select></label>") +
        '<label>Lyrics <select data-cue="lyrics"><option value="">leave as is</option><option value="on"' + (cues.lyrics === "on" ? " selected" : "") + '>on</option><option value="off"' + (cues.lyrics === "off" ? " selected" : "") + ">off</option></select></label>" +
        '<label>Lights look <input data-cue="look" list="svLooks" value="' + esc(cues.look || "") + '"></label>' +
        '<label>Slide <input data-cue="slide" list="svSlides" value="' + esc(cues.slide || "") + '"></label>' +
        '<label>Camera <input data-cue="camera" list="svCams" value="' + esc(cues.camera || "") + '"></label>' +
        '<label>Stream scene <input data-cue="scene" list="svScenes" value="' + esc(cues.scene || "") + '"></label>' +
        '<label class="wide">Lower third <input data-cue="lowerThird" value="' + esc(cues.lowerThird || "") + '" placeholder="e.g. Pastor Dan · Grace that finds us"></label>' +
        '<label class="wide">Note <input data-itf="note" value="' + esc(it.note || "") + '" placeholder="what the team should know"></label></div></td></tr>';
    });
    var over = fit.over, end = endClock(sv);
    h += '</tbody></table><div class="row sv-adds"><span class="muted small">Add:</span>' + Object.keys(KIND_LABEL).map(function (k) { return '<button data-add="' + k + '">+ ' + KIND_LABEL[k] + "</button>"; }).join("") +
      '<span class="spacer"></span><b>' + Math.round(total(sv) - preCount(sv)) + " min</b> <span class=\"muted small\">ends about " + end + "</span>" +
      (sv.length ? ' <span class="sv-fit ' + (Math.abs(over) < 1 ? "ok" : over > 0 ? "long" : "short") + '">' + (Math.abs(over) < 1 ? "fits " + sv.length + " min" : Math.abs(Math.round(over)) + " min " + (over > 0 ? "over" : "under") + " the " + sv.length) + "</span>" : "") + "</div>" +
      '<p class="muted small">Every computer fires the cues for its own job when the service gets to an item: the lights computer the look, the slides computer the slide, the cameras computer the camera… Lyrics "on" sends the words to the screens; the band\'s screen always has them. <a href="#" data-sv="link">Open the run sheet on a phone</a></p></div>';
    return h;
  }
  function tick() {
    if (!visible() || !S.run || view !== "sheets") return;
    var rsv = S.services.filter(function (x) { return x.id === S.run.service; })[0], it = rsv && rsv.items[S.run.item], el = $("#svLeft"); if (!it || !el) return;
    var left = it.minutes * 60 - ((Date.now() + S.offset) - S.run.itemStart) / 1000; el.textContent = fmt(left); el.classList.toggle("over", left < 0);
    var d = $("#svDrift"); if (d) d.innerHTML = driftText(drift(S.run, rsv));
  }
  setInterval(tick, 500);

  // ------------------------------------------------------------- editing
  function newFromTemplate(id) {
    var t = S.templates.filter(function (x) { return x.id === id; })[0]; if (!t || S.services.length >= S.max) return;
    var n = JSON.parse(JSON.stringify(t)); n.id = uid("sv"); n.name = t.name.replace(/\s*template$/i, "") || "Service"; n.items.forEach(function (it) { it.id = uid("it"); });
    S.services.push(n); sel = n.id; CU.store.set("svcSel", sel); saveSoon(); render();
  }
  function addSheet(sv) { if (S.services.length >= S.max) { toast("Up to " + S.max + " run sheets. Delete an old one first."); return; } S.services.push(sv); sel = sv.id; CU.store.set("svcSel", sel); saveSoon(); render(); }
  function print(sv) {
    var html = G && G.printHtml ? G.printHtml(sv, { songs: songs() }) : "<pre>" + esc(JSON.stringify(sv, null, 1)) + "</pre>";
    var f = document.createElement("iframe"); f.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0"; document.body.appendChild(f);
    f.contentDocument.open(); f.contentDocument.write(html); f.contentDocument.close();
    setTimeout(function () { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (_) { } setTimeout(function () { f.remove(); }, 4000); }, 250);
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("#serviceRoot button, #serviceRoot a[data-sv]"); if (!b) return;
    if (b.tagName === "A") e.preventDefault();
    var sv = cur();
    if (b.dataset.svv) { view = b.dataset.svv; CU.store.set("svView", view); render(); if (view === "check" && window.CUPrecheck) window.CUPrecheck.refresh(); return; }
    if (b.dataset.svPick) { sel = b.dataset.svPick; CU.store.set("svcSel", sel); render(); return; }
    if (b.dataset.booth) { CU.send({ type: "confidence", action: "message", text: b.dataset.booth, seconds: 30 }); paintBooth({ text: b.dataset.booth }); return; }
    var a = b.dataset.sv;
    if (a === "boothSend") { var tx = $("#svBoothText"); if (tx && tx.value.trim()) { CU.send({ type: "confidence", action: "message", text: tx.value.trim(), seconds: 45 }); paintBooth({ text: tx.value.trim() }); tx.value = ""; } return; }
    if (a === "boothClear") { CU.send({ type: "confidence", action: "clear" }); paintBooth(null); return; }
    if (a === "wizard") { if (window.CURunsheetWizard) window.CURunsheetWizard.open({ songs: songs(), templates: S.templates, onDone: addSheet }); return; }
    if (a === "add") {
      if (S.services.length >= S.max) return;
      var n = { id: uid("sv"), name: ["Sunday morning", "Sunday second service", "Wednesday night", "Youth"][S.services.length] || "Service", day: S.services.length === 2 ? 3 : 0, time: ["09:00", "11:00", "19:00", "18:30"][S.services.length] || "09:00", roles: ALL.slice(), record: false, date: "", length: 0, countdown: 0, team: { leader: "", speaker: "", tech: [] },
        items: [item("welcome"), item("song", "Song 1"), item("song", "Song 2"), item("song", "Song 3"), item("announcements"), item("sermon"), item("song", "Response song"), item("prayer", "Prayer & dismissal")] };
      addSheet(n); return;
    }
    if (a === "del" && sv) { if (!confirm("Delete \"" + sv.name + "\"?")) return; S.services = S.services.filter(function (x) { return x !== sv; }); sel = ""; saveSoon(); render(); return; }
    if (a === "tpl" && sv) { var t = JSON.parse(JSON.stringify(sv)); t.id = uid("tp"); t.name = sv.name + " template"; t.date = ""; CU.send({ type: "service", action: "saveTemplate", template: t }); toast("Saved \"" + t.name + "\". Start the next run sheet from it with \"From a template\"."); return; }
    if (a === "print" && sv) { print(sv); return; }
    if (a === "link") { var urls = window.CUCenter && window.CUCenter.phoneUrls ? window.CUCenter.phoneUrls() : []; var u = urls.length ? urls[0].replace(/\/cu\/$/, "/cu/runsheet.html") : null; toast(u ? "On a phone on this Wi-Fi, open " + u : "Phones can open the run sheet once this computer's center is running."); return; }
    if (a === "start") { var pick = $("#svStartPick"); CU.send({ type: "service", action: "start", service: pick ? pick.value : sel }); return; }
    if (a === "next" || a === "prev" || a === "stop") { if (a === "stop" && !confirm("Stop the service for everyone?")) return; CU.send({ type: "service", action: a }); return; }
    if (b.dataset.add && sv) { var it = item(b.dataset.add); it.roles = it.roles.filter(function (r) { return sv.roles.indexOf(r) >= 0; }); sv.items.push(it); saveSoon(); render(); return; }
    var row = b.closest("tr[data-i]"); if (!row || !sv) return; var i = Number(row.dataset.i), iti = sv.items[i];
    if (b.dataset.it === "cues" && iti) { openCues[iti.id] = !openCues[iti.id]; render(); return; }
    if (b.dataset.it === "del") sv.items.splice(i, 1);
    else if (b.dataset.it === "up" && i > 0) sv.items.splice(i - 1, 0, sv.items.splice(i, 1)[0]);
    else if (b.dataset.it === "down" && i < sv.items.length - 1) sv.items.splice(i + 1, 0, sv.items.splice(i, 1)[0]);
    saveSoon(); render();
  });
  function onEdit(e) {
    var t = e.target; if (!t.closest || !t.closest("#serviceRoot")) return;
    if (t.id === "svFromTpl" && e.type === "change") { if (t.value) newFromTemplate(t.value); return; }
    var sv = cur(); if (!sv) return;
    if (t.dataset.svf) {
      var k = t.dataset.svf;
      if (k === "day") sv.day = Number(t.value);
      else if (k === "record") sv.record = t.checked;
      else if (k === "length" || k === "countdown") sv[k] = Math.max(0, Number(t.value) || 0);
      else if (k === "date") { sv.date = t.value || ""; if (sv.date && G) sv.day = G.dayOf(sv.date); }
      else sv[k] = t.value;
      saveSoon(); if (e.type === "change") render(); return;
    }
    if (t.dataset.svt) { sv.team = sv.team || { leader: "", speaker: "", tech: [] }; if (t.dataset.svt === "tech") sv.team.tech = t.value.split(",").map(function (x) { return x.trim(); }).filter(Boolean); else sv.team[t.dataset.svt] = t.value; saveSoon(); return; }
    if (t.dataset.svrole) { var r = t.dataset.svrole; if (t.checked) { if (sv.roles.indexOf(r) < 0) sv.roles.push(r); } else { sv.roles = sv.roles.filter(function (x) { return x !== r; }); sv.items.forEach(function (it) { it.roles = it.roles.filter(function (x) { return x !== r; }); }); } saveSoon(); render(); return; }
    var row = t.closest("tr[data-i]"); if (!row) return; var it = sv.items[Number(row.dataset.i)]; if (!it) return;
    if (t.dataset.cue) { it.cues = it.cues || {}; if (t.value) it.cues[t.dataset.cue] = t.value; else delete it.cues[t.dataset.cue]; saveSoon(); return; }
    if (t.dataset.itf) {
      var f = t.dataset.itf;
      if (f === "minutes") it.minutes = Math.max(0, Math.min(240, Number(t.value) || 0));
      else if (f === "kind") { it.kind = t.value; if (it.title === "" || Object.keys(KIND_LABEL).some(function (k) { return KIND_LABEL[k] === it.title; })) it.title = KIND_LABEL[it.kind]; var base = G && G.KINDS[it.kind]; if (base) { it.roles = base.roles.filter(function (r) { return sv.roles.indexOf(r) >= 0; }); if (!it.cues || !Object.keys(it.cues).length) it.cues = JSON.parse(JSON.stringify(base.cues)); } }
      else if (f === "song") { it.song = t.value; it.cues = it.cues || {}; if (t.value) it.cues.song = t.value; else delete it.cues.song; var q = songs().filter(function (x) { return (x.id || x.name) === t.value; })[0]; if (q) { it.title = q.name; if (q.duration) it.minutes = Math.round(q.duration / 60 * 100) / 100; } }
      else it[f] = t.value;
      saveSoon(); if (e.type === "change") render(); return;
    }
    if (t.dataset.itrole) { var rr = t.dataset.itrole; if (t.checked) { if (it.roles.indexOf(rr) < 0) it.roles.push(rr); } else it.roles = it.roles.filter(function (x) { return x !== rr; }); saveSoon(); }
  }
  document.addEventListener("input", function (e) { var d = e.target.dataset || {}; if (d.svf === "name" || d.itf === "title" || d.itf === "minutes" || d.itf === "who" || d.itf === "note" || d.svt || (d.cue && d.cue !== "lyrics" && d.cue !== "song")) onEdit(e); });
  document.addEventListener("change", onEdit);
  document.addEventListener("keydown", function (e) { if (e.target && e.target.id === "svBoothText" && e.key === "Enter") { var b = $('#serviceRoot [data-sv="boothSend"]'); if (b) b.click(); } });
  // drag the items to reorder them
  var dragFrom = -1;
  document.addEventListener("dragstart", function (e) { var r = e.target.closest && e.target.closest("#serviceRoot .sv-items tbody tr[draggable]"); if (!r) return; dragFrom = Number(r.dataset.i); r.classList.add("dragging"); try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", String(dragFrom)); } catch (_) { } });
  document.addEventListener("dragover", function (e) { var r = e.target.closest && e.target.closest("#serviceRoot .sv-items tbody tr[data-i]"); if (!r || dragFrom < 0) return; e.preventDefault(); document.querySelectorAll("#serviceRoot .sv-items tr.dropat").forEach(function (x) { x.classList.remove("dropat"); }); r.classList.add("dropat"); });
  document.addEventListener("drop", function (e) {
    var r = e.target.closest && e.target.closest("#serviceRoot .sv-items tbody tr[data-i]"), sv = cur(); if (!r || dragFrom < 0 || !sv) return; e.preventDefault();
    var to = Number(r.dataset.i); if (to !== dragFrom) { sv.items.splice(to, 0, sv.items.splice(dragFrom, 1)[0]); saveSoon(); }
    dragFrom = -1; render();
  });
  document.addEventListener("dragend", function () { dragFrom = -1; document.querySelectorAll("#serviceRoot .dragging, #serviceRoot .dropat").forEach(function (x) { x.classList.remove("dragging", "dropat"); }); });
  CU.on("tab", function (t) { if (t === "service") { ask(); render(); } });
  CU.on("precheck", paintNav);
  window.CUServices = { state: function () { return S; }, ROLE_LABEL: ROLE_LABEL, KIND_LABEL: KIND_LABEL, CUE_LABEL: CUE_LABEL, DAYS: DAYS, render: render, fmt: fmt, drift: drift, move: function (from, to) { var sv = cur(); if (!sv) return; sv.items.splice(to, 0, sv.items.splice(from, 1)[0]); saveSoon(); render(); }, addSheet: addSheet, view: function (v) { if (v) { view = v; CU.store.set("svView", v); render(); } return view; } };
})();
