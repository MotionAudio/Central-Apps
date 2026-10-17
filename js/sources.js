/* Central Pedal - "Add songs": Planning Center Services, track packs (MultiTracks.com,
 * Loop Community, any zip or folder of stems on a USB stick) and your own files.
 * The driver does the downloading / unpacking (sources.py); this builds the songs:
 * key, tempo, meter, the arrangement (sections in service order with their lyrics),
 * the chord chart, and the stems with their roles. */
(function () {
  "use strict";
  var PP = window.PP, F = window.PPFeatures, T = window.PPTracks; if (!PP || !F || !T) return;
  var esc = PP.escapeHtml, MEDIA = "http://127.0.0.1:8766";
  var KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  var ROLES = [["music", "Music"], ["drums", "Drums / loops"], ["bass", "Bass"], ["keys", "Keys / synth / pads"], ["guitar", "Guitar"], ["vocals", "Vocals"], ["click", "Click (in-ear)"], ["guide", "Guide / cues (in-ear)"]];
  var st = { tab: "pco", pco: { configured: null, org: "", types: [], type: null, plans: [], plan: null, items: [], sel: {}, audio: true, top: true, busy: false, log: "" }, pack: null, packBusy: false };
  function $(s) { return document.querySelector(s); }
  function bridge() { return window.__pedalBridge; }
  function connected() { return !!(bridge() && bridge().connected); }
  async function getJ(path) { var r = await fetch(MEDIA + path, { cache: "no-store" }), j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || r.status); return j; }
  async function postJ(path, body) { var r = await fetch(MEDIA + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) }), j = await r.json(); if (!r.ok || j.error) throw new Error(j.error || r.status); return j; }
  function keyOpts(sel) { return '<option value="">?</option>' + KEYS.map(function (k) { return '<option value="' + k + '"' + (k === sel ? " selected" : "") + ">" + k.replace("#", "♯") + "</option>"; }).join(""); }
  function norm(x) { return String(x || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }

  // ------------------------------------------------------------- building a song
  function songFor(title) { return T.findSongByName(title) || T.newSong(title); }
  function arrangeBySequence(s, sequence) {
    // sections in the order they are sung (PCO arrangement sequence), each with its lyrics from the chart
    var t = T.data(s); if (!sequence || !sequence.length) return;
    var byName = {}; (t.sections || []).forEach(function (x) { byName[norm(x.name)] = x; });
    var per = 8, total = t.duration ? Math.max(1, T.timeToBar(s, t.duration).bar) : 0;
    if (total) per = Math.max(2, Math.floor(total / sequence.length));
    t.sections = sequence.map(function (name, i) {
      var src = byName[norm(name)] || byName[norm(name.replace(/\s*\d+$/, ""))] || byName[norm(name + " 1")];
      return { id: PP.id(), name: name, bar: 1 + i * per, pad: -1, transition: "inherit", cue: "auto", lyrics: src ? src.lyrics : "", page: src ? src.page || 0 : 0 };
    });
    t.fromSequence = true;
  }
  function respace(s) {  // once the audio is in, spread sequence sections over its length
    var t = T.data(s); if (!t.fromSequence || !t.duration || !t.sections.length) return;
    var total = Math.max(1, T.timeToBar(s, t.duration).bar), per = Math.max(2, Math.floor(total / t.sections.length));
    t.sections.forEach(function (x, i) { x.bar = 1 + i * per; });
  }
  async function filesToSong(s, files, wantKey) {
    var list = [];
    for (var i = 0; i < files.length; i++) { var f = await T.fileFromMedia(files[i].path); f._role = files[i].role; list.push(f); }
    if (list.length) await T.importFilesIntoSong(s, list, { analyze: true });
    respace(s);
    // the service key wins: when the tracks were recorded in another key they are pitched to it
    var t = T.data(s);
    if (wantKey) {
      s.key = wantKey;
      if (t.originalKey && t.originalKey !== wantKey) { var d = ((KEYS.indexOf(wantKey) - KEYS.indexOf(t.originalKey)) % 12 + 12) % 12; if (d > 6) d -= 12; t.keyShift = d; }
      else t.keyShift = 0;
      PP.persistSoon();
    }
    return t;
  }
  function toTop(songs) {
    var p = PP.project(), ids = songs.map(function (s) { return s.id; });
    p.songs = songs.concat(p.songs.filter(function (s) { return ids.indexOf(s.id) < 0; }));
    PP.persistNow(); F.loadSong(0);
  }

  // ------------------------------------------------------------- Planning Center
  async function pcoStatus() {
    try { var j = await getJ("/pco/status"); st.pco.configured = j.configured; } catch (_) { st.pco.configured = false; }
    if (st.pco.configured && !st.pco.types.length) await pcoTypes();
  }
  async function pcoTypes() {
    try { st.pco.types = (await getJ("/pco/service-types")).serviceTypes || []; if (st.pco.types.length && !st.pco.type) { st.pco.type = st.pco.types[0].id; await pcoPlans(); } }
    catch (e) { st.pco.log = e.message; }
    render();
  }
  async function pcoPlans() {
    st.pco.plans = []; st.pco.plan = null; st.pco.items = []; render();
    try { st.pco.plans = (await getJ("/pco/plans?type=" + encodeURIComponent(st.pco.type))).plans || []; if (st.pco.plans.length) await pcoItems(st.pco.plans[0].id); }
    catch (e) { st.pco.log = e.message; }
    render();
  }
  async function pcoItems(planId) {
    st.pco.plan = planId; st.pco.items = []; st.pco.sel = {}; render();
    try { st.pco.items = (await getJ("/pco/items?type=" + encodeURIComponent(st.pco.type) + "&plan=" + encodeURIComponent(planId))).items || []; st.pco.items.forEach(function (it) { st.pco.sel[it.id] = true; }); }
    catch (e) { st.pco.log = e.message; }
    render();
  }
  async function pcoConnect() {
    var id = $("#pcoApp").value.trim(), sec = $("#pcoSecret").value.trim(); if (!id || !sec) return;
    st.pco.log = "Connecting…"; render();
    try { var j = await postJ("/pco/connect", { appId: id, secret: sec }); st.pco.configured = true; st.pco.org = j.organization; st.pco.log = "Connected to " + j.organization + "."; await pcoTypes(); }
    catch (e) { st.pco.log = e.message; render(); }
  }
  async function pcoImport() {
    var items = st.pco.items.filter(function (it) { return st.pco.sel[it.id]; }); if (!items.length || st.pco.busy) return;
    st.pco.busy = true; var done = [], lines = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i]; lines.push((i + 1) + "/" + items.length + " " + it.title + "…"); st.pco.log = lines.join("\n"); render();
      try {
        var s = songFor(it.title), t = T.data(s);
        if (it.key) s.key = it.key;
        if (it.bpm) { s.bpm = Math.round(it.bpm * 10) / 10; if (!t.analysis) t.grid.bpm = it.bpm; }
        if (it.bpb) t.grid.bpb = it.bpb;
        s.pco = { item: it.id, song: it.songId, arrangement: it.arrangementId, plan: st.pco.plan, ccli: it.ccli, author: it.author };
        var r = await postJ("/pco/import", { item: it, song: s.id, audio: st.pco.audio });
        if (r.chart) await T.applyChart(s, r.chart);
        if (r.sequence && r.sequence.length) arrangeBySequence(s, r.sequence);
        var shiftNote = "";
        if (r.files && r.files.length) { lines[i] = (i + 1) + "/" + items.length + " " + it.title + ": " + r.files.length + " track" + (r.files.length === 1 ? "" : "s") + "…"; st.pco.log = lines.join("\n"); render(); var tt = await filesToSong(s, r.files, it.key); if (tt.keyShift) shiftNote = " (tracks in " + tt.originalKey + ", " + (tt.keyShift > 0 ? "+" : "") + tt.keyShift + ")"; }
        lines[i] = "✓ " + it.title + " - " + (s.key || "?") + shiftNote + (it.bpm ? " · " + Math.round(it.bpm) + " BPM" : "") + (it.meter ? " · " + it.meter : "") + (r.chart ? " · chart" : "") + (r.files && r.files.length ? " · " + r.files.length + " tracks" : "") + (r.sequence && r.sequence.length ? " · " + r.sequence.length + " sections in order" : "");
        done.push(s);
      } catch (e) { lines[i] = "✗ " + it.title + ": " + e.message; }
      st.pco.log = lines.join("\n"); render();
    }
    if (done.length && st.pco.top) toTop(done); else { PP.persistNow(); T.render(); }
    st.pco.busy = false; PP.setStatus("Planning Center: " + done.length + " song" + (done.length === 1 ? "" : "s") + " imported"); render(); T.sendDisplay();
    return done;
  }
  function renderPco() {
    var p = st.pco;
    if (!connected()) return '<p class="muted">Planning Center import runs on the Central Pedal (it needs the Wi-Fi to reach planningcenteronline.com).</p>';
    if (p.configured === null) return '<p class="muted">Checking…</p>';
    if (!p.configured) return '<p>Connect once with a <b>Personal Access Token</b>: on a computer go to <b>api.planningcenteronline.com/oauth/applications</b> → <i>Personal Access Tokens</i> → <i>New</i>, then copy the Application ID and the Secret here. They are kept on this Central Pedal only.</p>' +
      '<div class="form"><label>Application ID<input id="pcoApp" autocomplete="off" spellcheck="false"></label><label>Secret<input id="pcoSecret" type="password" autocomplete="off" spellcheck="false"></label><button class="primary" data-a="pco-connect">Connect</button></div><p class="add-progress">' + esc(p.log) + "</p>";
    var types = p.types.map(function (t) { return '<option value="' + esc(t.id) + '"' + (t.id === p.type ? " selected" : "") + ">" + esc(t.name) + "</option>"; }).join("");
    var plans = p.plans.length ? p.plans.map(function (pl) { return '<button data-plan="' + esc(pl.id) + '" class="' + (pl.id === p.plan ? "on" : "") + '"><b>' + esc(pl.dates || "") + "</b>" + (pl.title ? " · " + esc(pl.title) : "") + "</button>"; }).join("") : '<span class="muted">No upcoming plans.</span>';
    var items = p.items.length ? p.items.map(function (it) {
      return '<label class="add-row' + (p.sel[it.id] ? "" : " off") + '"><input type="checkbox" data-item="' + esc(it.id) + '"' + (p.sel[it.id] ? " checked" : "") + '><span><b>' + esc(it.title) + "</b><small>" + esc([it.author, it.arrangement].filter(Boolean).join(" · ")) + '</small><span class="tags">' + (it.sequence && it.sequence.length ? '<span class="tag">' + esc(it.sequence.join(" · ")) + "</span>" : "") + (it.hasChart ? '<span class="tag">chord chart</span>' : it.hasLyrics ? '<span class="tag">lyrics</span>' : "") + "</span></span><span>" + esc((it.key || "?").replace("#", "♯")) + (it.bpm ? " · " + Math.round(it.bpm) + " BPM" : "") + (it.meter ? " · " + esc(it.meter) : "") + "</span></label>";
    }).join("") : (p.plan ? '<p class="muted">No songs in this plan.</p>' : "");
    return '<div class="form"><label>Service type<select id="pcoType">' + types + '</select></label><span class="muted">Upcoming plans:</span></div><div class="add-plan">' + plans + '</div><div class="add-list">' + items + "</div>" +
      '<div class="row" style="gap:12px;flex-wrap:wrap"><label class="toggle"><input type="checkbox" id="pcoAudio"' + (p.audio ? " checked" : "") + '> Download the arrangement\'s audio attachments (stems)</label><label class="toggle"><input type="checkbox" id="pcoTop"' + (p.top ? " checked" : "") + '> Put them at the top of the setlist, in service order</label><button class="primary" data-a="pco-import"' + (p.busy || !p.items.length ? " disabled" : "") + ">Import " + Object.keys(p.sel).filter(function (k) { return p.sel[k]; }).length + " song(s)</button><button data-a=\"pco-forget\" class=\"link\">Disconnect Planning Center</button></div>" +
      '<p class="add-progress">' + esc(p.log) + "</p>";
  }

  // ------------------------------------------------------------- track packs
  function packPick() {
    if (!connected()) return;
    F.openUsb(async function (picked) {
      var path = picked.folder || (picked.files && picked.files[0]); if (!path) return;
      st.packBusy = true; st.pack = null; render();
      try { st.pack = await postJ("/pack/scan", { path: path }); st.pack.stems.forEach(function (e) { e.keep = e.use; }); }
      catch (e) { st.pack = { error: e.message }; }
      st.packBusy = false; render();
    }, { kind: "pack" });
  }
  async function packImport() {
    var pk = st.pack; if (!pk || pk.error || st.packBusy) return;
    var title = ($("#packTitle").value || pk.title || "Song").trim(), key = $("#packKey").value, bpm = Number($("#packBpm").value) || 0;
    var chosen = pk.stems.filter(function (e) { return e.keep; }); if (!chosen.length) return;
    st.packBusy = true; pk.log = "Unpacking " + chosen.length + " tracks…"; render();
    try {
      var s = songFor(title), t = T.data(s);
      if (key) s.key = key; if (bpm) { s.bpm = bpm; t.grid.bpm = bpm; }
      var r = await postJ("/pack/import", { path: pk.path, song: s.id, members: chosen.map(function (e) { return e.member; }).concat(pk.charts.map(function (c) { return c.member; })) });
      var roleOf = {}; chosen.forEach(function (e) { roleOf[e.member] = e.role; });
      if (r.chartInfos && r.chartInfos.length) await T.applyChart(s, r.chartInfos[0]);
      pk.log = "Decoding and analysing " + r.files.length + " tracks (tempo, key, beats)…"; render();
      await filesToSong(s, r.files.map(function (f) { return { path: f.path, role: roleOf[f.member] || f.role }; }), key || null);
      var p = PP.project(); F.loadSong(p.songs.indexOf(s)); PP.persistNow(); T.render();
      pk.log = "✓ " + title + ": " + r.files.length + " tracks" + (r.chartInfos && r.chartInfos.length ? " + chart" : "") + ". Open the song editor to check the sections.";
      PP.setStatus("Imported " + title);
    } catch (e) { pk.log = "Could not import: " + e.message; }
    st.packBusy = false; render();
  }
  function renderPack() {
    if (!connected()) return '<p class="muted">Pack import runs on the Central Pedal (it unpacks the stems onto its card).</p>';
    var pk = st.pack, head = '<p>Download the song from <b>MultiTracks.com</b> (Playback / "Download stems") or <b>Loop Community</b> (Prime / stem pack), put the <b>zip</b> (or the unzipped folder) on a USB stick or send it with the Upload page, then choose it here. The stems\' roles, the key and the tempo come from the file names; the full mix is left out when there are stems.</p><div class="row"><button class="primary" data-a="pack-pick"' + (st.packBusy ? " disabled" : "") + ">📦 Choose a zip or folder…</button></div>";
    if (st.packBusy && !pk) return head + '<p class="muted">Reading the pack…</p>';
    if (!pk) return head;
    if (pk.error) return head + '<p class="muted">' + esc(pk.error) + "</p>";
    return head + '<div class="form"><label>Song<input id="packTitle" value="' + esc(pk.title || "") + '"></label><label>Key<select id="packKey">' + keyOpts(pk.key) + '</select></label><label>BPM<input id="packBpm" type="number" min="30" max="300" step="0.1" value="' + (pk.bpm || "") + '" placeholder="detected"></label><span class="muted">' + esc(pk.vendor || "Folder / zip") + " · " + pk.stems.length + " audio file" + (pk.stems.length === 1 ? "" : "s") + (pk.charts.length ? " · " + pk.charts.length + " chart" : "") + "</span></div>" +
      '<div class="add-list">' + pk.stems.map(function (e, i) { return '<div class="add-row' + (e.keep ? "" : " off") + '"><input type="checkbox" data-stem-i="' + i + '"' + (e.keep ? " checked" : "") + '><span><b>' + esc(e.name) + "</b><small>" + (e.fullMix ? "full mix - normally left out" : Math.round(e.size / 1048576 * 10) / 10 + " MB") + '</small></span><select data-role-i="' + i + '">' + ROLES.map(function (r) { return '<option value="' + r[0] + '"' + (r[0] === e.role ? " selected" : "") + ">" + r[1] + "</option>"; }).join("") + "</select></div>"; }).join("") + "</div>" +
      '<div class="row"><button class="primary" data-a="pack-import"' + (st.packBusy ? " disabled" : "") + ">Import as a song</button></div><p class=\"add-progress\">" + esc(pk.log || "") + "</p>";
  }

  // ------------------------------------------------------------- own files
  function renderOwn() {
    return '<p>A new song from your own audio: one mixed file, or a set of stems (click, guide, drums, bass, keys…). Tempo, key, beats, sections and big hits are found automatically.</p><div class="form"><label>Song name<input id="ownName" placeholder="Song name"></label><button class="primary" data-a="own-create">Create and add tracks…</button></div>';
  }

  // ------------------------------------------------------------- dialog
  function render() {
    var body = $("#addBody"); if (!body) return;
    document.querySelectorAll("#addTabs [data-src]").forEach(function (b) { b.classList.toggle("on", b.dataset.src === st.tab); });
    var y = body.scrollTop;
    body.innerHTML = st.tab === "pco" ? renderPco() : st.tab === "pack" ? renderPack() : renderOwn();
    body.scrollTop = y;
  }
  async function open(tab) {
    if (tab) st.tab = tab;
    $("#addDialog").showModal(); render();
    if (st.tab === "pco" && st.pco.configured !== true && connected()) { await pcoStatus(); render(); }
  }
  function wire() {
    $("#addTabs").addEventListener("click", function (e) { var b = e.target.closest("[data-src]"); if (!b) return; st.tab = b.dataset.src; render(); if (st.tab === "pco" && st.pco.configured === null && connected()) pcoStatus().then(render); });
    $("#addBody").addEventListener("click", function (e) {
      var b = e.target.closest("[data-a],[data-plan]"); if (!b) return;
      if (b.dataset.plan) { pcoItems(b.dataset.plan); return; }
      var a = b.dataset.a;
      if (a === "pco-connect") pcoConnect(); else if (a === "pco-import") pcoImport();
      else if (a === "pco-forget") { if (confirm("Disconnect Planning Center? The token is removed from this Central Pedal.")) postJ("/pco/forget").then(function () { st.pco = { configured: false, org: "", types: [], type: null, plans: [], plan: null, items: [], sel: {}, audio: true, top: true, busy: false, log: "" }; render(); }); }
      else if (a === "pack-pick") packPick(); else if (a === "pack-import") packImport();
      else if (a === "own-create") { var name = ($("#ownName").value || "").trim() || "New song"; T.newSong(name); F.loadSong(PP.project().songs.length - 1); $("#addDialog").close(); T.openEditor(); }
    });
    $("#addBody").addEventListener("change", function (e) {
      var el = e.target;
      if (el.id === "pcoType") { st.pco.type = el.value; pcoPlans(); }
      else if (el.dataset.item) { st.pco.sel[el.dataset.item] = el.checked; render(); }
      else if (el.id === "pcoAudio") st.pco.audio = el.checked; else if (el.id === "pcoTop") st.pco.top = el.checked;
      else if (el.dataset.stemI != null && st.pack) { st.pack.stems[Number(el.dataset.stemI)].keep = el.checked; render(); }
      else if (el.dataset.roleI != null && st.pack) st.pack.stems[Number(el.dataset.roleI)].role = el.value;
    });
  }
  wire();
  window.PPSources = { open: open, state: st, pcoImport: pcoImport, pcoStatus: pcoStatus, packImport: packImport, render: render };
})();
