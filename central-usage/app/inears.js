/* Central Control - the In-ears tab.
 *  Admin: up to 128 channels (the audio interface's / Dante's inputs and the Central Pedal's channels), named
 *         and routed; 64 stereo mixes - who has each, and where each goes: wired (an output pair to an in-ear
 *         transmitter in the rack, "Auto-assign pairs" fills them in) and / or local (back over the network to
 *         the user's device or phone); levels; listen to any mix on this computer.
 *  User:  pick a free mix and set your own levels (inear-ui.js), on this computer's headphones or your pack. */
(function () {
  "use strict";
  var CU = window.CentralUsage, M = window.CUMixer, X = window.CUMix; if (!CU || !M || !X) return;
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function db(v) { return v <= -90 ? "-∞" : (v > 0 ? "+" : "") + Number(v).toFixed(1); }
  function panText(v) { v = Number(v) || 0; var n = Math.round(Math.abs(v) * 100); return n < 2 ? "C" : (v < 0 ? "L " : "R ") + n; }   // L 30 / C / R 30
  var selMix = CU.store.get("iaMix", 0), allCh = false, dragging = null, structKey = "", userUi = null, userKey = "";
  function visible() { return CU.prefs.tab === "inears"; }
  function isAdmin() { var m = CU.mode(); return m === "admin" || m === "main"; }
  function dest(q) { var w = q.wired ? (q.outL >= 0 ? "Out " + (q.outL + 1) + (q.stereo && q.outR >= 0 ? "/" + (q.outR + 1) : "") : "wired · no output") : ""; return w && q.local ? w + " + local" : w || (q.local ? "local" : "nowhere"); }
  function S() { return X.state; }
  function live() { return X.live(); }
  function engineStatus() { return X.kind === "local" ? X.hostStatus && X.hostStatus.engine && X.hostStatus.engine.status : X.info && X.info.status; }
  function inNames() { var st = engineStatus(); return st && st.captureNames || []; }
  function outNames() { var st = engineStatus(); return st && st.playbackNames || []; }
  var timers = {};
  function send(key, op) { var t = timers[key]; if (t && Date.now() - t.at < 35) { clearTimeout(t.id); t.id = setTimeout(function () { t.at = Date.now(); X.op(op); }, 35); return; } timers[key] = { at: Date.now() }; X.op(op); }
  function srcValue(x) { return x.src.kind === "pi" ? "pi:" + x.src.key : x.src.kind === "in" ? "in:" + x.src.ch : "none"; }
  function srcOptions(x) {
    var cur = srcValue(x), names = inNames(), h = '<option value="none"' + (cur === "none" ? " selected" : "") + ">— nothing —</option>", seen = {};
    if (X.pi.length || x.src.kind === "pi") { h += '<optgroup label="Central Pedal (network)">'; X.pi.forEach(function (n) { seen["pi:" + n.key] = 1; h += '<option value="pi:' + esc(n.key) + '"' + (cur === "pi:" + n.key ? " selected" : "") + ">" + esc(n.name) + "</option>"; }); if (x.src.kind === "pi" && !seen[cur]) h += '<option value="' + esc(cur) + '" selected>' + esc(x.name || x.src.key) + " (not in this song)</option>"; h += "</optgroup>"; }
    var n = Math.max(names.length, x.src.kind === "in" ? x.src.ch + 1 : 0);
    if (n) { h += '<optgroup label="Audio interface">'; for (var k = 0; k < n; k++) h += '<option value="in:' + k + '"' + (cur === "in:" + k ? " selected" : "") + ">Input " + (k + 1) + (names[k] ? " · " + esc(names[k].replace(/^.*:/, "")) : "") + "</option>"; h += "</optgroup>"; }
    return h;
  }
  function outOptions(cur) { var names = outNames(), h = '<option value="-1"' + (cur < 0 ? " selected" : "") + ">—</option>"; for (var o = 0; o < Math.max(names.length, cur + 1); o++) h += '<option value="' + o + '"' + (o === cur ? " selected" : "") + ">Out " + (o + 1) + (names[o] ? " · " + esc(names[o].replace(/^.*:/, "")) : "") + "</option>"; return h; }
  function shownInputs() { var s = S(), out = []; s.inputs.forEach(function (x, i) { if (allCh || x.src.kind !== "none" || x.name) out.push(i); }); return out; }
  function routed() { var s = S(), lv = live(), out = []; s.inputs.forEach(function (x, i) { if (x.src.kind !== "none" && (x.src.kind !== "pi" || lv[x.src.key])) out.push(i); }); return out; }

  // ------------------------------------------------------------------ admin
  function infoCard() {
    var hs = X.hostStatus || {}, cfg = hs.cfg || {};
    if (X.kind !== "local") return '<div class="card ia-info"><b>Mixing on the audio host ' + esc(X.hostAddress()) + '</b><span class="muted small">The in-ear code and the phone address are shown on the audio host.</span></div>';
    var srv = hs.server || {}, users = (srv.clients || []).filter(function (c) { return c.role === "user"; });
    return '<div class="card ia-info"><div><b>In-ear code <span class="ia-code">' + esc(cfg.host && cfg.host.userCode) + '</span></b> <button data-ia="newcode">New code</button></div>' +
      '<div class="muted small">Musicians\' Central Usage finds this computer by itself. On a phone, open ' + (srv.addresses || []).map(function (a) { return "<b>http://" + esc(a) + ":" + (srv.port || 8092) + "/</b>"; }).join(" or ") + "</div>" +
      '<div class="muted small">' + (users.length ? users.length + " connected: " + users.map(function (u) { return esc(u.name) + (u.listening.length ? " 🎧" : ""); }).join(", ") : "Nobody connected yet.") + "</div></div>";
  }
  function channelsCard() {
    var s = S(), list = shownInputs();
    return '<div class="card ia-ch"><div class="row spread"><h3>Channels</h3><span class="row"><button data-ia="addch">+ Channel</button><label class="toggle"><input type="checkbox" data-ia="all"' + (allCh ? " checked" : "") + "> All 128</label></span></div>" +
      '<div class="ia-chlist">' + (list.length ? list.map(function (i) { var x = s.inputs[i]; return '<div class="ia-row" data-i="' + i + '"><span class="ia-n">' + (i + 1) + '</span><input data-iac="name" value="' + esc(x.name) + '" placeholder="Name"><select data-iac="src">' + srcOptions(x) + '</select><select data-iac="group" title="Tracks show on the Mix tab"><option value="band"' + (x.group !== "tracks" ? " selected" : "") + '>Band</option><option value="tracks"' + (x.group === "tracks" ? " selected" : "") + '>Tracks</option></select><label class="toggle" title="The in-ear users see this channel"><input type="checkbox" data-iac="show"' + (x.show !== false ? " checked" : "") + '>users</label><div class="ia-meter"><i></i></div></div>'; }).join("") : '<p class="muted">No channels yet. The Central Pedal\'s tracks appear here by themselves when its audio arrives; add the interface\'s inputs (mics, instruments) with + Channel.</p>') + "</div></div>";
  }
  function mixesCard() {
    var s = S();
    var nWired = s.mixes.filter(function (q) { return q.wired; }).length, firstOut = CU.store.get("iaFirstOut", 0);
    return '<div class="card ia-mixes"><div class="row spread"><h3>Mixes</h3><span class="ia-wire"><label title="Mixes 1 to N go to wired in-ear transmitters">Wired mixes <input type="number" min="0" max="' + M.MAXMIX + '" data-ia="wiredCount" value="' + nWired + '"></label><label>from <select data-ia="firstOut">' + outOptions(firstOut).replace('<option value="-1" >—</option>', "") + '</select></label><button data-ia="autowire" title="Give every wired mix the next free output pair">Auto-assign pairs</button></span></div><div class="ia-mgrid">' + s.mixes.map(function (q, m) {
      var outs = dest(q);
      return '<button class="ia-mix' + (m === selMix ? " sel" : "") + (q.ownerId ? " owned" : "") + (q.reserved ? " reserved" : "") + '" data-ia-mix="' + m + '"><b>' + (m + 1) + "</b><span>" + esc(q.owner || q.name) + '</span><small>' + esc(outs) + '</small><i class="ia-mm"></i></button>';
    }).join("") + "</div></div>";
  }
  function mixCard() {
    var s = S(), q = s.mixes[selMix]; if (!q) return "";
    var ins = routed(), listening = window.CUListen && window.CUListen.tap() === selMix;
    return '<div class="card ia-mixed" data-m="' + selMix + '"><div class="ia-mhead"><h3>Mix ' + (selMix + 1) + '</h3><input data-iam="name" value="' + esc(q.name) + '"><span class="ia-owner">' + (q.ownerId ? "🎧 " + esc(q.owner) + ' <button data-ia="release">Free it</button>' : '<span class="muted">free</span>') + '</span><label class="toggle" title="Users can\'t take it"><input type="checkbox" data-iam="reserved"' + (q.reserved ? " checked" : "") + "> Reserved</label></div>" +
      '<div class="row ia-dest"><label class="toggle" title="Out of the interface / Dante to an in-ear transmitter in the rack"><input type="checkbox" data-iam="wired"' + (q.wired ? " checked" : "") + '> <b>Wired</b> <small class="muted">in-ear transmitter</small></label>' +
      (q.wired ? '<label>Out L <select data-iam="outL">' + outOptions(q.outL) + '</select></label><label>Out R <select data-iam="outR">' + outOptions(q.outR) + "</select></label>" : "") +
      '<label class="toggle" title="Back over the network to the user\'s Central Control or phone"><input type="checkbox" data-iam="local"' + (q.local ? " checked" : "") + '> <b>Local</b> <small class="muted">to their device</small></label><label class="toggle"><input type="checkbox" data-iam="stereo"' + (q.stereo ? " checked" : "") + "> Stereo</label></div>" +
      '<div class="ie-master"><b>Level</b><input type="range" min="0" max="1" step="0.001" data-iam="level" value="' + M.dbToFader(q.level) + '"><span class="ia-mdb">' + db(q.level) + '</span><button data-ia="mute" class="' + (q.mute ? "danger on" : "") + '">' + (q.mute ? "Muted" : "Mute") + '</button><button data-ia="listen" class="' + (listening ? "on" : "") + '">' + (listening ? "■ Stop listening" : "🎧 Listen here") + '</button><div class="ie-mm"><i></i><i></i></div></div>' +
      (ins.length ? '<div class="ie-chs">' + ins.map(function (i) { var x = s.inputs[i], sd = q.sends[i] || { level: -90, pan: 0, on: true }; return '<div class="ie-ch" data-i="' + i + '"><span class="ie-name"' + (x.color ? ' style="border-color:' + esc(x.color) + '"' : "") + ">" + esc(x.name || "Input " + (i + 1)) + '</span><div class="ie-meter"><i></i></div><input type="range" min="0" max="1" step="0.001" data-ias="level" value="' + M.dbToFader(sd.level) + '"><span class="ie-db">' + db(sd.level) + "</span>" + (q.stereo !== false ? '<label class="ie-panbox" title="Left / right (double-click or hold: centre)"><span>PAN</span><input type="range" class="ie-pan" min="-1" max="1" step="0.05" data-ias="pan" value="' + (sd.pan || 0) + '" aria-label="Pan"><b class="ie-panv">' + panText(sd.pan) + "</b></label>" : '<span class="ie-panbox ie-mono">mono</span>') + '<label class="toggle"><input type="checkbox" data-ias="on"' + (sd.on !== false ? " checked" : "") + "></label></div>"; }).join("") + "</div>" : '<p class="muted">No channels with a source yet.</p>') +
      '<div class="row"><button data-ia="clear">All sends off</button><button data-ia="copy">Copy this mix to…</button></div></div>';
  }
  function renderAdmin(root, force) {
    var s = S();
    if (!s) { root.innerHTML = '<div class="card"><h3>In-ears</h3><p>' + esc(X.error || "Connecting to the mixer…") + '</p><button data-ia-go="io">Open I/O</button></div>'; structKey = ""; return; }
    var key = JSON.stringify([shownInputs().map(function (i) { return [s.inputs[i].name, srcValue(s.inputs[i]), s.inputs[i].group, s.inputs[i].show]; }), s.mixes.map(function (q) { return [q.name, q.owner, q.wired, q.local, q.outL, q.outR, q.reserved, q.stereo]; }), selMix, allCh, X.pi.length, inNames().length, outNames().length, X.kind, routed()]);
    if (!force && key === structKey && root.querySelector(".ia-grid")) { updateAdmin(); return; }
    structKey = key;
    root.innerHTML = infoCard() + '<div class="ia-grid">' + channelsCard() + mixesCard() + "</div>" + mixCard();
  }
  function updateAdmin() {
    var s = S(), q = s.mixes[selMix]; if (!q) return;
    document.querySelectorAll(".ia-mixed .ie-ch").forEach(function (row) { var i = Number(row.dataset.i), sd = q.sends[i] || { level: -90, pan: 0, on: true }, f = row.querySelector('[data-ias="level"]'), p = row.querySelector('[data-ias="pan"]'); if (f !== dragging) { f.value = M.dbToFader(sd.level); row.querySelector(".ie-db").textContent = db(sd.level); } if (p && p !== dragging) { p.value = sd.pan || 0; var pv = row.querySelector(".ie-panv"); if (pv) pv.textContent = panText(sd.pan); } row.querySelector('[data-ias="on"]').checked = sd.on !== false; });
    var lv = $('[data-iam="level"]'); if (lv && lv !== dragging) { lv.value = M.dbToFader(q.level); $(".ia-mdb").textContent = db(q.level); }
    var mu = $('.ia-mixed [data-ia="mute"]'); if (mu) { mu.textContent = q.mute ? "Muted" : "Mute"; mu.classList.toggle("danger", q.mute); mu.classList.toggle("on", q.mute); }
  }
  function bar(v) { var d = v > 0 ? 20 * Math.log10(v) : -90; return Math.max(0, Math.min(100, (d + 60) / 60 * 100)); }
  X.on("meters", function (m) {
    if (!visible() || !isAdmin()) return;
    document.querySelectorAll(".ia-row").forEach(function (r) { r.querySelector(".ia-meter i").style.width = bar(m.in ? m.in[Number(r.dataset.i)] || 0 : 0) + "%"; });
    document.querySelectorAll(".ia-mixed .ie-ch").forEach(function (r) { r.querySelector(".ie-meter i").style.width = bar(m.in ? m.in[Number(r.dataset.i)] || 0 : 0) + "%"; });
    document.querySelectorAll(".ia-mix").forEach(function (b) { var k = Number(b.dataset.iaMix), v = m.mix ? Math.max(m.mix[k * 2] || 0, m.mix[k * 2 + 1] || 0) : 0; b.querySelector(".ia-mm").style.width = bar(v) + "%"; });
    var mm = document.querySelectorAll(".ia-mixed .ie-mm i"); if (mm.length && m.mix) { mm[0].style.width = bar(m.mix[selMix * 2]) + "%"; mm[1].style.width = bar(m.mix[selMix * 2 + 1]) + "%"; }
  });

  // ------------------------------------------------------------------ user
  function renderUser(root) {
    var addr = X.hostAddress(), code = CU.store.get("userCode", ""), name = (CU.config() || {}).name || "";
    var key = addr + "|" + code + "|" + name;
    if (key === userKey && (userUi || root.querySelector(".ie-setup"))) return;
    if (userUi) { userUi.destroy(); userUi = null; }
    userKey = key;
    if (!addr || !code) {
      root.innerHTML = '<div class="card ie-setup"><h3>My in-ear mix</h3><p class="muted">Your in-ear mix comes from the audio host at the sound desk. ' + (addr ? "Found it: <b>" + esc(addr) + "</b>." : CU.state.connected ? "It isn't on yet, so ask the sound desk to turn it on." : "Connect to the Central Pedal first (top right). The audio host is found through it.") + '</p>' +
        '<label>Your name<input data-iu="name" value="' + esc(name) + '" placeholder="Sarah (vocals)"></label><label>In-ear code<input data-iu="code" value="' + esc(code) + '" inputmode="numeric" placeholder="4 digits from the sound desk"></label>' +
        '<details><summary class="muted small">Audio host address (only if it isn\'t found)</summary><input data-iu="addr" value="' + esc(CU.store.get("hostAddr", "")) + '" placeholder="192.168.1.20:8092"></details><button class="primary" data-iu="go">Continue</button></div>';
      return;
    }
    root.innerHTML = '<div id="iuMount"></div><p class="muted small ie-foot">Audio host ' + esc(addr) + ' · <a href="#" data-iu="change">change name / code</a></p>';
    userUi = window.CUInEarUI.mount($("#iuMount"), { url: "ws://" + addr + "/ws", code: code, name: name || "Someone", id: window.CUInEar.deviceId() });
  }

  function render(force) {
    var root = $("#inearsRoot"); if (!root || !visible()) return;
    if (isAdmin()) { if (userUi) { userUi.destroy(); userUi = null; userKey = ""; } renderAdmin(root, force); }
    else renderUser(root);
  }

  // ------------------------------------------------------------------ events
  var root = $("#inearsRoot");
  // a pan back to the centre: a double-click, or holding it still
  var panHold = null;
  function centrePan(t) { var row = t.closest(".ie-ch"); if (!row) return; t.value = 0; var pv = t.parentNode.querySelector(".ie-panv"); if (pv) pv.textContent = "C"; X.op({ op: "send", m: selMix, i: Number(row.dataset.i), patch: { pan: 0 } }); }
  root.addEventListener("pointerdown", function (e) {
    if (e.target.type === "range") dragging = e.target;
    if (e.target.dataset && e.target.dataset.ias === "pan") { var t = e.target, v0 = t.value; clearTimeout(panHold && panHold.t); panHold = { x0: e.clientX, t: setTimeout(function () { if (panHold && Math.abs(Number(t.value) - Number(v0)) < 0.06) centrePan(t); panHold = null; }, 600) }; }
  });
  root.addEventListener("pointermove", function (e) { if (panHold && Math.abs(e.clientX - panHold.x0) > 8) { clearTimeout(panHold.t); panHold = null; } });
  root.addEventListener("dblclick", function (e) { if (e.target.dataset && e.target.dataset.ias === "pan") centrePan(e.target); });
  document.addEventListener("pointerup", function () { if (panHold) { clearTimeout(panHold.t); panHold = null; } dragging = null; });
  root.addEventListener("input", function (e) {
    var t = e.target, s = S(); if (!s || !isAdmin()) return;
    if (t.dataset.ias === "level") { var row = t.closest(".ie-ch"), i = Number(row.dataset.i), d = Math.round(M.faderToDb(Number(t.value)) * 10) / 10; row.querySelector(".ie-db").textContent = db(d); send("s" + selMix + ":" + i, { op: "send", m: selMix, i: i, patch: { level: d } }); }
    else if (t.dataset.ias === "pan") { var i2 = Number(t.closest(".ie-ch").dataset.i), pv0 = t.parentNode.querySelector(".ie-panv"); if (pv0) pv0.textContent = panText(t.value); send("p" + selMix + ":" + i2, { op: "send", m: selMix, i: i2, patch: { pan: Number(t.value) } }); }
    else if (t.dataset.iam === "level") { var d2 = Math.round(M.faderToDb(Number(t.value)) * 10) / 10; $(".ia-mdb").textContent = db(d2); send("m" + selMix, { op: "mix", m: selMix, patch: { level: d2 } }); }
  });
  root.addEventListener("change", function (e) {
    var t = e.target, s = S();
    if (t.dataset.iu) return;
    if (!s) return;
    var row = t.closest(".ia-row"), i = row ? Number(row.dataset.i) : -1;
    if (t.dataset.ia === "all") { allCh = t.checked; render(true); return; }
    if (t.dataset.ia === "firstOut") { CU.store.set("iaFirstOut", Number(t.value) || 0); return; }
    if (t.dataset.ia === "wiredCount") { X.op({ op: "autoWire", count: Number(t.value) || 0, first: CU.store.get("iaFirstOut", 0) }); return; }
    if (t.dataset.iac === "name") X.op({ op: "input", i: i, patch: { name: t.value } });
    else if (t.dataset.iac === "src") { var v = t.value, src = v === "none" ? { kind: "none" } : v.indexOf("pi:") === 0 ? { kind: "pi", key: v.slice(3) } : { kind: "in", ch: Number(v.slice(3)) }, patch = { src: src }; if (!s.inputs[i].name && src.kind !== "none") patch.name = t.options[t.selectedIndex].textContent.replace(/^Input \d+ · /, "").slice(0, 40); X.op({ op: "input", i: i, patch: patch }); }
    else if (t.dataset.iac === "group") X.op({ op: "input", i: i, patch: { group: t.value } });
    else if (t.dataset.iac === "show") X.op({ op: "input", i: i, patch: { show: t.checked } });
    else if (t.dataset.iam === "name") X.op({ op: "mix", m: selMix, patch: { name: t.value } });
    else if (t.dataset.iam === "reserved" || t.dataset.iam === "stereo" || t.dataset.iam === "wired" || t.dataset.iam === "local") { var pp = {}; pp[t.dataset.iam] = t.checked; X.op({ op: "mix", m: selMix, patch: pp }); }
    else if (t.dataset.iam === "outL" || t.dataset.iam === "outR") { var po = {}; po[t.dataset.iam] = Number(t.value); if (t.dataset.iam === "outL" && s.mixes[selMix].stereo && s.mixes[selMix].outR < 0 && Number(t.value) >= 0) po.outR = Number(t.value) + 1; X.op({ op: "mix", m: selMix, patch: po }); }
    else if (t.dataset.ias === "on") X.op({ op: "send", m: selMix, i: Number(t.closest(".ie-ch").dataset.i), patch: { on: t.checked } });
  });
  root.addEventListener("click", function (e) {
    var b = e.target.closest("button,a"); if (!b) return; var s = S();
    if (b.dataset.iaGo) { CU.showTab(b.dataset.iaGo); return; }
    if (b.dataset.iu === "go") { var nm = $('[data-iu="name"]').value.trim(), cd = $('[data-iu="code"]').value.trim(), ad = $('[data-iu="addr"]').value.trim(); CU.store.set("userCode", cd); CU.store.set("hostAddr", ad); if (nm) { var c = CU.config(); c.name = nm; CU.store.set("name", nm); if (window.CU && window.CU.config) window.CU.config.set({ name: nm }); } userKey = ""; render(); return; }
    if (b.dataset.iu === "change") { e.preventDefault(); CU.store.set("userCode", ""); userKey = ""; if (userUi) { userUi.destroy(); userUi = null; } render(); return; }
    if (!s) return;
    if (b.dataset.iaMix != null) { selMix = Number(b.dataset.iaMix); CU.store.set("iaMix", selMix); render(true); return; }
    var a = b.dataset.ia;
    if (a === "autowire") { X.op({ op: "autoWire", first: CU.store.get("iaFirstOut", 0) }); return; }
    if (a === "addch") { var free = s.inputs.findIndex(function (x) { return x.src.kind === "none" && !x.name; }); if (free < 0) return alert("All 128 channels are in use."); X.op({ op: "input", i: free, patch: { name: "Channel " + (free + 1) } }); setTimeout(function () { var el = document.querySelector('.ia-row[data-i="' + free + '"] [data-iac="name"]'); if (el) { el.focus(); el.select(); } }, 150); }
    else if (a === "release") X.op({ op: "release", m: selMix });
    else if (a === "mute") X.op({ op: "mix", m: selMix, patch: { mute: !s.mixes[selMix].mute } });
    else if (a === "clear") { if (confirm("Turn every send of Mix " + (selMix + 1) + " off?")) X.op({ op: "clearSends", m: selMix }); }
    else if (a === "copy") { CU.askText("Copy Mix " + (selMix + 1) + "'s levels to which mix? (1-" + M.MAXMIX + ")", "").then(function (v) { var to = Number(v) - 1; if (!(to >= 0 && to < M.MAXMIX) || to === selMix) return; X.op({ op: "clearSends", m: to }); var src = s.mixes[selMix].sends; Object.keys(src).forEach(function (i) { X.op({ op: "send", m: to, i: Number(i), patch: src[i] }); }); X.op({ op: "mix", m: to, patch: { level: s.mixes[selMix].level, stereo: s.mixes[selMix].stereo } }); }); }
    else if (a === "listen") { if (window.CUListen.tap() === selMix) window.CUListen.stop(); else window.CUListen.start(selMix); setTimeout(function () { render(true); }, 50); }
    else if (a === "newcode" && window.CU && window.CU.config) window.CU.config.set({ newUserCode: true }).then(function () { render(true); });
  });
  X.on("state", function () { render(true); });
  X.on("op", function (op) { if (!visible() || !isAdmin()) return; if (op.op === "send" && op.m === selMix) updateAdmin(); else if (op.op === "mix" && op.m === selMix && op.patch && Object.keys(op.patch).every(function (k) { return k === "level" || k === "mute"; })) updateAdmin(); else render(); });
  X.on("pi", function () { render(); });
  X.on("status", function () { if (visible() && isAdmin()) render(); });
  CU.on("audioHost", function () { if (visible() && !isAdmin()) render(); });
  CU.on("mode", function () { if (visible()) render(true); });
  CU.on("tab", function (t) { if (t === "inears") setTimeout(function () { render(true); }, 0); });
  window.CUInEarsTab = { render: render };
})();
