/* Make & sell (10.1): upload samples, loops, pads, instruments, pedal boards and plugins; see them through review;
 * downloads, earnings and payouts. The website's API: /v1/creator/... (server/src/creators.js). */
(function () {
  "use strict";
  var M = window.Maker, main = document.getElementById("main"), tabs = document.getElementById("tabs"), who = document.getElementById("who");
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function money(v) { return "$" + Number(v || 0).toFixed(2); }
  function starsRo(n) { return n ? '<span class="stars ro" title="' + n + ' of 5 stars">' + "★★★★★".slice(0, n) + '<span style="color:#4A515C">' + "★★★★★".slice(n) + "</span></span>" : ""; }
  var STATUS = { uploading: "Not sent yet", waiting: "Waiting for review", live: "Live", rejected: "Needs changes", pulled: "Taken down", removed: "Removed" };
  var BLURB = { sample: "One-shot samples or a multisample, played as a sound in Central Keys or Central Instrument.", instrument: "A playable instrument (SoundFont, SFZ or WAVs by note).", loop: "Loops in time, for Central Pads.", pad: "A pad in every key: 12 loops, C to B.", board: "A pedal board preset, for Central Pedals.", plugin: "An audio plugin, for Central Plugins (checked and reviewed)." };
  var S = { me: null, kinds: null, tab: "upload", kind: "loop", data: null, msg: "" };
  try { var h = location.hash.slice(1); if (["upload", "items", "earnings"].indexOf(h) >= 0) S.tab = h; } catch (_) { }

  function start() {
    if (!M.signedIn()) return signedOut();
    Promise.all([M.api("GET", "/me"), M.api("GET", "/creator/kinds"), M.api("GET", "/creator")]).then(function (r) {
      S.me = r[0]; S.kinds = r[1]; S.data = r[2];
      who.innerHTML = esc(S.me.name || S.me.email) + ' · <a href="/#account">Account</a>';
      tabs.hidden = false; draw();
    }).catch(function (e) { if (e.status === 401) return signedOut(); main.innerHTML = '<div class="card"><p class="err">' + esc(e.message) + "</p></div>"; });
  }
  function signedOut() {
    who.innerHTML = "";
    main.innerHTML = '<div class="card center"><h2>Make sounds for Motion Audio</h2>' +
      '<p class="muted" style="margin:0">Samples, loops, pads, instruments, pedal boards and plugins you make go into the sound plans (Central Keys, Instrument, Pads, Pedals and Plugins). Every musician with the plan can use them, and each month you get a share of the plan\'s money for every download.</p>' +
      '<p class="muted small" style="margin:0">Any Motion Audio account can make and upload. We check everything before it goes out.</p>' +
      '<div class="row"><button class="primary" id="signIn">Sign in or make an account</button><a class="btn" href="/studio/">Try the browser studio</a></div></div>';
    $("#signIn").onclick = function () { M.signIn("/create/"); };
  }
  function setTab(t) { S.tab = t; S.msg = ""; try { history.replaceState(null, "", "#" + t); } catch (_) { } draw(); }
  tabs.addEventListener("click", function (e) { var b = e.target.closest("[data-tab]"); if (b) setTab(b.dataset.tab); });
  function draw() {
    $$("[data-tab]", tabs).forEach(function (b) { b.classList.toggle("on", b.dataset.tab === S.tab); });
    if (S.tab === "upload") drawUpload(); else if (S.tab === "items") drawItems(); else drawEarnings();
  }
  function refresh() { return M.api("GET", "/creator").then(function (d) { S.data = d; }); }

  // ------------------------------------------------------------- upload
  function kindOf(id) { return S.kinds.kinds.filter(function (k) { return k.id === id; })[0]; }
  function keyOptions(sel) { return '<option value="">Any key</option>' + S.kinds.keys.map(function (k) { return '<option' + (k === sel ? " selected" : "") + ">" + k + "</option>"; }).join(""); }
  function drawUpload() {
    var k = kindOf(S.kind), plugin = k.id === "plugin", noDemo = plugin || k.id === "board";
    main.innerHTML =
      '<div class="card"><h2>What are you uploading?</h2><div class="kinds">' + S.kinds.kinds.map(function (x) { return '<button class="kind' + (x.id === S.kind ? " on" : "") + '" data-kind="' + x.id + '"><b>' + esc(x.name) + "</b><span>" + esc(BLURB[x.id] || "") + "</span></button>"; }).join("") + "</div></div>" +
      '<form class="card" id="upForm" novalidate><h2>' + esc(k.name) + '</h2>' +
        '<div class="grid2"><label>Name<input id="fTitle" maxlength="80" required placeholder="' + ({ loop: "Ambient Swells 72", pad: "Morning Pad", board: "Shimmer Lead", plugin: "Shimmer Verb" }[k.id] || "Felt Upright") + '"></label>' +
        (k.packs.length > 1 ? '<label>Sound plan<select id="fPack">' + k.packs.map(function (p) { return '<option value="' + p.id + '">' + esc(p.name) + "</option>"; }).join("") + "</select></label>" : '<label>Sound plan<input value="' + esc(k.packs[0].name) + '" disabled></label>') + "</div>" +
        '<label>About it <span class="small">(what it is, how to use it)</span><textarea id="fDesc" rows="2" maxlength="1000"></textarea></label>' +
        '<div class="grid3"><label>Tags <span class="small">(commas)</span><input id="fTags" placeholder="ambient, worship, warm"></label>' +
        (/loop|pad|sample|instrument/.test(k.id) ? '<label>Key<select id="fKey">' + keyOptions("") + "</select></label>" : "") +
        (k.id === "loop" ? '<label>Tempo (BPM)<input id="fBpm" type="number" min="30" max="300" step="0.01"></label><label>Bars<input id="fBars" type="number" min="1" max="64"></label>' : "") + "</div>" +
        (plugin ? '<div class="grid2">' + Object.keys(S.kinds.platforms).map(function (p) { return '<label>' + esc(S.kinds.platforms[p]) + ' <span class="small">(zip with the plugin bundle)</span><input type="file" accept=".zip" data-platform="' + p + '"></label>'; }).join("") + "</div>" +
          '<p class="muted small" style="margin:0">One zip per platform you support, each with one plugin bundle: VST3 or CLAP (and AU on Mac, LV2 on Linux and the Central Pedal). No installers or scripts. Every plugin is checked automatically, then reviewed by Motion Audio before anyone can download it, and on musicians\' devices it runs walled off, only when they switch on "Allow community plugins".</p>'
          : '<label>' + esc(k.name) + ' <span class="small">(' + esc(k.what) + ")</span><input type=\"file\" id=\"fSrc\"" + (k.id === "loop" ? " multiple accept=\".wav,.zip\"" : k.id === "board" ? " accept=\".json\"" : k.id === "pad" ? " accept=\".zip\"" : " accept=\".sf2,.zip\"") + "></label>") +
        (noDemo ? "" : '<label>Demo clip <span class="small">(MP3 or WAV, up to 2 minutes: what people hear before they download, and what the reviewer listens to)</span><input type="file" id="fDemo" accept=".mp3,.wav,audio/*"></label>') +
        '<label class="check"><input type="checkbox" id="fRights"><span>I made this, or I have the rights to share and sell it. It doesn\'t contain anyone else\'s recordings or code without permission.</span></label>' +
        '<p class="muted small" style="margin:0">After review it goes into ' + esc(k.packs.map(function (p) { return p.name; }).join(" or ")) + '. Each month ' + Math.round((S.data.shares[k.packs[0].id] || S.kinds.share) * 100) + '% of the plan\'s money is shared among creators by downloads × stars (the reviewer\'s grade, 1-5).</p>' +
        '<div class="progress" id="prog" hidden><i></i></div><div class="row"><button class="primary" id="fSend">Send for review</button><span class="muted small" id="fState"></span></div><div class="err" id="fErr"></div></form>';
    $$("[data-kind]").forEach(function (b) { b.onclick = function () { S.kind = b.dataset.kind; drawUpload(); }; });
    $("#upForm").onsubmit = function (e) { e.preventDefault(); sendForm(k); };
  }
  function sendForm(k) {
    var err = $("#fErr"), state = $("#fState"), prog = $("#prog"), btn = $("#fSend"); err.textContent = "";
    var files = [];
    if (k.id === "plugin") $$("[data-platform]").forEach(function (i) { if (i.files[0]) files.push({ role: "source", platform: i.dataset.platform, name: i.files[0].name, blob: i.files[0] }); });
    else Array.prototype.forEach.call(($("#fSrc") || {}).files || [], function (f) { files.push({ role: "source", name: f.name, blob: f }); });
    if (!files.length) { err.textContent = k.id === "plugin" ? "Add the plugin zip for at least one platform." : "Choose the file to upload: " + k.what + "."; return; }
    var demo = $("#fDemo"); if (demo && demo.files[0]) files.push({ role: "demo", name: demo.files[0].name, blob: demo.files[0] });
    else if (demo) { err.textContent = "Add a short demo clip (MP3 or WAV)."; return; }
    var meta = { kind: k.id, pack: $("#fPack") ? $("#fPack").value : k.packs[0].id, title: $("#fTitle").value.trim(), description: $("#fDesc").value, tags: $("#fTags").value,
      key: $("#fKey") ? $("#fKey").value : "", bpm: $("#fBpm") ? +$("#fBpm").value || 0 : 0, bars: $("#fBars") ? +$("#fBars").value || 0 : 0, rights: $("#fRights").checked };
    if (!meta.title) { err.textContent = "Give it a name."; return; }
    if (!meta.rights) { err.textContent = "Confirm that you made it, or have the rights to share and sell it."; return; }
    btn.disabled = true; prog.hidden = false;
    M.send(meta, files, function (p, what) { $("i", prog).style.width = Math.round(p * 100) + "%"; state.textContent = what; })
      .then(function () { return refresh(); }).then(function () { S.msg = "Sent. “" + meta.title + "” is waiting for review: we'll email you when it's live."; setTab("items"); })
      .catch(function (e) { btn.disabled = false; prog.hidden = true; state.textContent = ""; err.textContent = e.message + (e.itemId ? "\nIt's saved under My items: fix it there and send it again." : ""); if (e.itemId) refresh(); });
  }

  // ------------------------------------------------------------- my items
  function drawItems() {
    var items = S.data.items;
    main.innerHTML = (S.msg ? '<div class="card"><p class="okmsg" style="margin:0">' + esc(S.msg) + "</p></div>" : "") +
      '<div class="card"><h2>My items</h2>' + (items.length ? items.map(itemHtml).join("") : '<p class="muted" style="margin:0">Nothing yet. <a href="#upload" data-go="upload">Upload something</a> or make it in the <a href="/studio/">browser studio</a>.</p>') + "</div>";
    $$("[data-go]").forEach(function (a) { a.onclick = function (e) { e.preventDefault(); setTab(a.dataset.go); }; });
    $$("[data-remove]").forEach(function (b) { b.onclick = function () { if (!confirm("Remove this item? It comes out of the sound plan and off the devices it was installed on.")) return; M.api("POST", "/creator/items/" + b.dataset.remove + "/remove", {}).then(refresh).then(drawItems).catch(function (e) { alert(e.message); }); }; });
    $$("[data-resend]").forEach(function (f) { f.onsubmit = function (e) { e.preventDefault(); resend(f); }; });
  }
  function itemHtml(it) {
    var fix = it.status === "rejected" || it.status === "uploading";
    var src = it.kind === "plugin" ? Object.keys(S.kinds.platforms).map(function (p) { return '<label>' + esc(S.kinds.platforms[p]) + '<input type="file" accept=".zip" data-platform="' + p + '"></label>'; }).join("") : '<label>New file' + (it.kind === "loop" ? "s" : "") + '<input type="file" data-src' + (it.kind === "loop" ? " multiple" : "") + "></label>";
    return '<div class="item"><h3>' + esc(it.title) + ' <span class="st ' + it.status + '">' + esc(STATUS[it.status] || it.status) + "</span> " + starsRo(it.status === "live" ? it.stars : 0) + "</h3>" +
      '<div class="meta"><span>' + esc(it.kindName) + "</span><span>" + esc(it.packName) + "</span>" + (it.key ? "<span>Key " + esc(it.key) + "</span>" : "") + (it.bpm ? "<span>" + it.bpm + " BPM</span>" : "") + "<span>" + it.downloads + " download" + (it.downloads === 1 ? "" : "s") + "</span>" + (it.madeInStudio ? "<span>Made in the studio</span>" : "") + "</div>" +
      (it.kind === "plugin" && it.status === "live" ? '<span class="label-plugin">' + esc(it.label) + "</span>" : "") +
      (it.reason ? '<p class="err" style="margin:0">' + (it.status === "rejected" ? "The reviewer said: " : "") + esc(it.reason) + "</p>" : "") +
      (it.checks && it.checks.length && it.status !== "live" ? '<ul class="checks">' + it.checks.map(function (c) { return '<li class="' + (c.ok ? "" : "bad") + '">' + esc(c.text) + "</li>"; }).join("") + "</ul>" : "") +
      (it.demo ? '<audio controls preload="none" src="' + esc(it.demo) + '"></audio>' : "") +
      (fix ? '<form class="grid2" data-resend="' + it.id + '" data-kind="' + it.kind + '">' + src + (it.kind === "plugin" || it.kind === "board" ? "" : '<label>New demo clip <span class="small">(optional)</span><input type="file" data-demo accept=".mp3,.wav,audio/*"></label>') + '<div class="row"><button class="primary">Send again</button><span class="err" data-err></span></div></form>' : "") +
      '<div class="row"><button class="small no" data-remove="' + it.id + '">Remove</button></div></div>';
  }
  function resend(f) {
    var files = [], err = $("[data-err]", f), btn = $("button", f);
    $$("[data-platform]", f).forEach(function (i) { if (i.files[0]) files.push({ role: "source", platform: i.dataset.platform, name: i.files[0].name, blob: i.files[0] }); });
    var s = $("[data-src]", f); if (s) Array.prototype.forEach.call(s.files, function (x) { files.push({ role: "source", name: x.name, blob: x }); });
    var d = $("[data-demo]", f); if (d && d.files[0]) files.push({ role: "demo", name: d.files[0].name, blob: d.files[0] });
    btn.disabled = true; err.textContent = "Sending…";
    M.resend(f.dataset.resend, files).then(refresh).then(function () { S.msg = "Sent again: it's waiting for review."; drawItems(); })
      .catch(function (e) { btn.disabled = false; err.textContent = e.message; });
  }

  // ------------------------------------------------------------- earnings
  function drawEarnings() {
    var d = S.data, packs = {}; d.thisMonth.forEach(function (r) { packs[r.pack] = r; });
    var names = { keys: "Central Keys", instrument: "Central Instrument", plugins: "Central Plugins", pedals: "Central Pedals", pads: "Central Pads" };
    main.innerHTML =
      '<div class="card"><h2>Earnings</h2><div class="grid3">' +
        '<div class="stat"><span class="muted">Owed to you</span><span class="big">' + money(d.unpaid) + '</span><span class="muted small">Paid on the 1st of each month once it\'s ' + money(d.minPayout) + " or more</span></div>" +
        '<div class="stat"><span class="muted">Paid so far</span><span class="big">' + money(d.paid) + "</span></div>" +
        '<div class="stat"><span class="muted">Downloads this month</span><span class="big">' + d.thisMonth.reduce(function (a, r) { return a + r.downloads; }, 0) + '</span><span class="muted small">' + esc(d.month) + "</span></div></div>" +
        (d.payoutsReady ? '<p class="okmsg" style="margin:0">Payouts are set up. <a href="#" id="payEdit">Change your payout details</a></p>' : '<div class="row"><button class="primary" id="paySetup">Set up payouts</button><span class="muted small">Your bank details go to Stripe, our payments company. Motion Audio never sees them.</span></div>') +
      "</div>" +
      '<div class="card"><h3>This month, so far</h3><div class="scroll"><table><thead><tr><th>Sound plan</th><th>Creators\' share</th><th>Your downloads</th><th>Downloads × stars</th></tr></thead><tbody>' +
        Object.keys(names).map(function (p) { var r = packs[p] || { downloads: 0, weight: 0 }; return "<tr><td>" + names[p] + "</td><td>" + Math.round((d.shares[p] || 0) * 100) + "%</td><td>" + r.downloads + "</td><td>" + r.weight + "</td></tr>"; }).join("") +
      '</tbody></table></div><p class="muted small" style="margin:0">How it works: each month the creators\' share of a sound plan\'s money (a yearly plan counts 1/12 a month) is split by downloads × stars. A download counts once per person per item per month. Motion Audio\'s own sounds count in the total too.</p></div>' +
      '<div class="card"><h3>Statements</h3>' + (d.statements.length ? '<div class="scroll"><table><thead><tr><th>Month</th><th>Sound plan</th><th>Plan money</th><th>Creators\' share</th><th>Your downloads</th><th>Your weight</th><th>Everyone\'s weight</th><th>You earned</th><th></th></tr></thead><tbody>' +
        d.statements.map(function (s) { return "<tr><td>" + esc(s.month) + "</td><td>" + esc(s.packName) + "</td><td>" + money(s.income) + "</td><td>" + Math.round(s.share * 100) + "% = " + money(s.pot) + "</td><td>" + s.downloads + "</td><td>" + s.weight + "</td><td>" + s.totalWeight + "</td><td><b>" + money(s.earned) + "</b></td><td>" + (s.paid ? '<span class="st live">Paid</span>' : '<span class="st waiting">Owed</span>') + "</td></tr>"; }).join("") +
        "</tbody></table></div>" : '<p class="muted" style="margin:0">Your first statement comes at the start of next month.</p>') + "</div>";
    var go = function (e) { if (e) e.preventDefault(); M.api("POST", "/connect").then(function (r) { location.href = r.url; }).catch(function (x) { alert(x.message); }); };
    if ($("#paySetup")) $("#paySetup").onclick = go; if ($("#payEdit")) $("#payEdit").onclick = go;
  }
  start();
})();
