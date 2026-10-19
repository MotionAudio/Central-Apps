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
  var st = { step: "songs", target: null, find: "", library: null, tab: "own", pco: { configured: null, org: "", types: [], type: null, plans: [], plan: null, items: [], sel: {}, audio: true, top: true, busy: false, log: "" }, pack: null, packBusy: false };
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
  async function filesToSong(s, files, wantKey, opts) {
    var list = [];
    for (var i = 0; i < files.length; i++) { var f = await T.fileFromMedia(files[i].path); f._role = files[i].role; list.push(f); }
    if (list.length) await T.importFilesIntoSong(s, list, { analyze: true, combine: !!(opts && opts.combine) });
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
  // memory: a song this big would crowd a Raspberry Pi (it holds every track of the song, and of the next one)
  function tooBig(pk) { return !!(pk && pk.deviceMB && pk.memMB > pk.deviceMB * 0.22); }
  // sections from the pack's Ableton locators / MIDI markers (their times), on the song's bars
  function markersToSections(s, markers, bpb) {
    var t = T.data(s); if (!markers || !markers.length) return 0;
    if (bpb >= 2 && bpb <= 12) t.grid.bpb = bpb;
    var seen = {}, out = [];
    markers.forEach(function (m) {
      var bar = m.time != null && t.duration ? T.timeToBar(s, m.time).bar : Math.floor((m.beat || 0) / (t.grid.bpb || 4)) + 1;
      bar = Math.max(1, Math.round(bar)); if (seen[bar]) return; seen[bar] = 1;
      var old = (t.sections || []).filter(function (x) { return norm(x.name) === norm(m.name); })[0];
      out.push({ id: PP.id(), name: m.name, bar: bar, pad: -1, transition: "inherit", cue: "auto", lyrics: old ? old.lyrics : "", page: old ? old.page || 0 : 0 });
    });
    out.sort(function (a, b) { return a.bar - b.bar; });
    if (out.length && out[0].bar > 1) out.unshift({ id: PP.id(), name: "Intro", bar: 1, pad: -1, transition: "inherit", cue: "auto", lyrics: "", page: 0 });
    t.sections = out; t.fromSequence = false; t.sectionsFrom = "pack";
    return out.length;
  }
  // a whole pack into a song: the stems (or groups of them), the chart, the exact tempo and the sections
  async function importPackInfo(pk, o, log) {
    o = o || {};
    var title = (o.title || pk.title || "Song").trim(), key = o.key != null ? o.key : pk.key, bpm = o.bpm != null ? o.bpm : pk.bpm;
    var chosen = pk.stems.filter(function (e) { return e.keep != null ? e.keep : e.use; }); if (!chosen.length) throw new Error("no tracks chosen");
    log("Unpacking " + chosen.length + " tracks…");
    var s = songFor(title), t = T.data(s);
    if (key) s.key = key; if (bpm) { s.bpm = bpm; t.grid.bpm = bpm; }
    var r = await postJ("/pack/import", { path: pk.path, song: s.id, members: chosen.map(function (e) { return e.member; }).concat(pk.charts.map(function (c) { return c.member; })) });
    var roleOf = {}; chosen.forEach(function (e) { roleOf[e.member] = e.role; });
    if (r.chartInfos && r.chartInfos.length) await T.applyChart(s, r.chartInfos[0]);
    log((o.combine ? "Combining and analysing " : "Decoding and analysing ") + r.files.length + " tracks (tempo, key, beats)…");
    await filesToSong(s, r.files.map(function (f) { return { path: f.path, role: roleOf[f.member] || f.role }; }), key || null, { combine: !!o.combine });
    // the pack's own tempo is exact (its Ableton set / MIDI file / name): the beat grid is fitted to it
    if (bpm && t.analysis && Math.abs((t.grid.bpm || 0) - bpm) > 0.05) { try { await T.analyzeSong(s, null, PP.setStatus, { bpm: bpm }); } catch (e) { console.warn(e); } }
    var n = markersToSections(s, pk.markers, pk.bpb);
    T.pushAll && T.pushAll(s);
    return { song: s, title: title, tracks: r.files.length, chart: !!(r.chartInfos && r.chartInfos.length), sections: n };
  }
  async function packImport() {
    var pk = st.pack; if (!pk || pk.error || st.packBusy) return;
    var title = ($("#packTitle").value || pk.title || "Song").trim(), key = $("#packKey").value, bpm = Number($("#packBpm").value) || 0;
    if (!pk.stems.some(function (e) { return e.keep; })) return;
    st.packBusy = true; render();
    try {
      var res = await importPackInfo(pk, { title: title, key: key, bpm: bpm, combine: !!pk.combine }, function (m) { pk.log = m; render(); });
      var p = PP.project(); F.loadSong(p.songs.indexOf(res.song)); PP.persistNow(); T.render();
      pk.log = "✓ " + title + ": " + res.tracks + " tracks" + (pk.combine ? " (combined by kind)" : "") + (res.chart ? " + chart" : "") + (res.sections ? " · " + res.sections + " sections from " + (pk.markersFrom || "the pack") : " · open the song editor to check the sections") + ".";
      PP.setStatus("Imported " + title);
    } catch (e) { pk.log = "Could not import: " + e.message; }
    st.packBusy = false; render();
  }
  // several songs at once: a folder of song folders / zips (a MultiTracks.com or Loop Community library on a stick)
  function manyPick() {
    if (!connected()) return;
    F.openUsb(async function (picked) {
      var path = picked.folder || (picked.files && picked.files[0]); if (!path) return;
      st.packBusy = true; st.many = null; st.pack = null; render();
      try { st.many = await postJ("/pack/scanMany", { path: path }); st.many.songs.forEach(function (x) { x.keep = true; x.combine = !!(st.many.deviceMB && x.memMB > st.many.deviceMB * 0.22); }); }
      catch (e) { st.many = { error: e.message, songs: [] }; }
      st.packBusy = false; render();
    }, { kind: "pack" });
  }
  async function manyImport() {
    var mn = st.many; if (!mn || st.packBusy) return;
    var list = mn.songs.filter(function (x) { return x.keep; }); if (!list.length) return;
    st.packBusy = true; mn.done = 0; mn.log = ""; render();
    for (var i = 0; i < list.length; i++) {
      var x = list[i];
      try {
        var pk = await postJ("/pack/scan", { path: x.path });
        var res = await importPackInfo(pk, { combine: x.combine }, function (m) { mn.log = (i + 1) + "/" + list.length + " · " + (x.title || "") + ": " + m; render(); });
        x.result = "✓ " + res.tracks + " tracks" + (res.sections ? " · " + res.sections + " sections" : "") + (res.chart ? " · chart" : "");
      } catch (e) { x.result = "✗ " + e.message; }
      mn.done = i + 1; render();
    }
    mn.log = "✓ " + list.filter(function (x) { return /^✓/.test(x.result || ""); }).length + " of " + list.length + " songs imported.";
    PP.persistNow(); T.render(); st.packBusy = false; render();
  }
  function renderPack(prime) {
    if (!connected()) return '<p class="muted">Pack import runs on the Central Pedal (it unpacks the stems onto its card).</p>';
    var pk = st.pack, mn = st.many, head = (prime ? '<p>A <b>Prime track</b> from <b>Loop Community</b>: in your Loop Community account, open My Multitracks and download the song\'s <b>WAV stems</b> (songs kept inside the Prime app itself stay in that app). Put the zip (or the unzipped folder) on a USB stick or send it with the Upload page, then choose it here.</p>' : '<p>A <b>multitrack</b> from <b>MultiTracks.com</b> (your purchases → download the stems or the Ableton set) or any zip / folder of stems. Put it on a USB stick or send it with the Upload page, then choose it here.</p>') + '<p class="muted small">The song\'s name, key and tempo come from the file names; the click and the guide go to the in-ear output; the sections come from the pack\'s Ableton set or MIDI file when it has one; a chart in the pack becomes the song\'s chart; the full mix is left out when there are stems.</p>' +
      '<div class="row"><button class="primary" data-a="pack-pick"' + (st.packBusy ? " disabled" : "") + '>📦 One song: a zip or folder…</button><button data-a="many-pick"' + (st.packBusy ? " disabled" : "") + ">📚 Several songs: a folder of them…</button></div>";
    if (mn) return head + renderMany(mn);
    if (st.packBusy && !pk) return head + '<p class="muted">Reading the pack…</p>';
    if (!pk) return head;
    if (pk.error) return head + '<p class="muted">' + esc(pk.error) + "</p>";
    var big = tooBig(pk); if (pk.combine == null) pk.combine = big;
    var info = (pk.markers && pk.markers.length ? '<p class="small">✓ ' + pk.markers.length + " sections from " + esc(pk.markersFrom || "the pack") + ": " + pk.markers.slice(0, 12).map(function (m) { return esc(m.name); }).join(" · ") + (pk.markers.length > 12 ? " …" : "") + "</p>" : "") +
      (pk.deviceMB ? '<p class="small ' + (big ? "warn" : "muted") + '">About ' + pk.memMB + " MB in the player (this Central Pedal has " + Math.round(pk.deviceMB / 1024 * 10) / 10 + " GB)" + (big ? " - a lot for a Pi: combine the tracks by kind." : ".") + "</p>" : "") +
      '<label class="toggle"><input type="checkbox" id="packCombine"' + (pk.combine ? " checked" : "") + "> Combine the tracks by kind (drums, bass, keys, guitars, vocals, the rest - click and guide stay on their own) - less memory, fewer faders</label>";
    return head + '<div class="form"><label>Song<input id="packTitle" value="' + esc(pk.title || "") + '"></label><label>Key<select id="packKey">' + keyOpts(pk.key) + '</select></label><label>BPM<input id="packBpm" type="number" min="30" max="300" step="0.1" value="' + (pk.bpm || "") + '" placeholder="detected"></label><span class="muted">' + esc(pk.vendor || "Folder / zip") + " · " + pk.stems.length + " audio file" + (pk.stems.length === 1 ? "" : "s") + (pk.charts.length ? " · " + pk.charts.length + " chart" : "") + "</span></div>" +
      '<div class="add-list">' + pk.stems.map(function (e, i) { return '<div class="add-row' + (e.keep ? "" : " off") + '"><input type="checkbox" data-stem-i="' + i + '"' + (e.keep ? " checked" : "") + '><span><b>' + esc(e.name) + "</b><small>" + (e.fullMix ? "full mix - normally left out" : Math.round(e.size / 1048576 * 10) / 10 + " MB") + '</small></span><select data-role-i="' + i + '">' + ROLES.map(function (r) { return '<option value="' + r[0] + '"' + (r[0] === e.role ? " selected" : "") + ">" + r[1] + "</option>"; }).join("") + "</select></div>"; }).join("") + "</div>" +
      info + '<div class="row"><button class="primary" data-a="pack-import"' + (st.packBusy ? " disabled" : "") + ">Import as a song</button></div><p class=\"add-progress\">" + esc(pk.log || "") + "</p>";
  }
  function renderMany(mn) {
    if (mn.error) return '<p class="muted">' + esc(mn.error) + "</p>";
    if (!mn.songs.length) return '<p class="muted">No songs with audio were found in that folder.</p>';
    var n = mn.songs.filter(function (x) { return x.keep; }).length;
    return '<div class="add-list">' + mn.songs.map(function (x, i) {
      return '<div class="add-row' + (x.keep ? "" : " off") + '"><input type="checkbox" data-many-i="' + i + '"' + (x.keep ? " checked" : "") + '><span><b>' + esc(x.title) + "</b><small>" + [x.key ? "Key " + x.key.replace("#", "♯") : "", x.bpm ? x.bpm + " BPM" : "", x.stems + " tracks", x.markers ? x.markers + " sections" : "", x.charts ? "chart" : "", x.vendor || ""].filter(Boolean).map(esc).join(" · ") + (x.result ? " · <b>" + esc(x.result) + "</b>" : "") + "</small></span>" +
        '<label class="toggle small" title="Combine the tracks by kind (less memory)"><input type="checkbox" data-many-c="' + i + '"' + (x.combine ? " checked" : "") + "> combine</label></div>";
    }).join("") + '</div><div class="row"><button class="primary" data-a="many-import"' + (st.packBusy || !n ? " disabled" : "") + ">Import " + n + " song" + (n === 1 ? "" : "s") + '</button><button data-a="many-back"' + (st.packBusy ? " disabled" : "") + ">Back</button></div><p class=\"add-progress\">" + esc(mn.log || "") + "</p>";
  }

  // ------------------------------------------------------------- own files
  function renderOwn() {
    return '<p>A new song from your own <b>MP3 or WAV</b> files: one mixed file, or a set of stems (click, guide, drums, bass, keys…). Tempo, key, beats, sections and big hits are found automatically.</p><p class="muted small">Your own files stay on your devices. They are never shared to Central Tracks. To sell a track to other teams, publish it on the Motion Audio website.</p><div class="form"><label>Song name<input id="ownName" placeholder="Song name"></label><button class="primary" data-a="own-create">Create and add tracks…</button></div>';
  }

  // ------------------------------------------------------------- Add song: 1. your songs  2. four ways to bring the tracks in
  function songsHere() { return PP.project().songs || []; }
  function targetSong() { var t = st.target; if (!t || t === "new") return null; return songsHere().filter(function (x) { return x.id === t; })[0] || null; }
  function renderSongs() {
    var here = songsHere(), q = st.find.trim().toLowerCase(), ids = {};
    here.forEach(function (x) { ids[x.id] = 1; });
    var lib = (st.library || []).filter(function (x) { return !ids[x.id]; });
    function row(x, inLib) {
      var t = !inLib && T.data(x), n = inLib ? x.stems || 0 : t.stems.length;
      return '<button type="button" class="as-song" data-song="' + esc(x.id) + '"' + (inLib ? ' data-lib="1"' : "") + ' data-name="' + esc(String(x.name || "").toLowerCase()) + '"><b>' + esc(x.name || "Song") + "</b><small>" +
        esc([x.key || "", x.bpm ? Math.round(x.bpm) + " BPM" : "", n ? n + " track" + (n === 1 ? "" : "s") : "no tracks yet", inLib ? "in your song library" : "in this setlist"].filter(Boolean).join(" · ")) + "</small></button>";
    }
    var match = function (x) { return !q || String(x.name || "").toLowerCase().indexOf(q) >= 0; };
    return '<div class="as-head"><button type="button" class="primary as-new" data-a="song-new">＋ New song</button><input id="asFind" placeholder="Find one of your songs" value="' + esc(st.find) + '"></div>' +
      '<p class="muted small">Pick a song to add tracks to it, or start a new one.</p>' +
      '<div class="as-list">' + here.filter(match).map(function (x) { return row(x, false); }).join("") +
      (lib.filter(match).length ? '<h4 class="muted small">Song library (other setlists, other devices)</h4>' + lib.filter(match).map(function (x) { return row(x, true); }).join("") : "") +
      (!here.length && !lib.length ? '<p class="muted">No songs yet - press <b>＋ New song</b>.</p>' : "") + "</div>";
  }
  var WAYS = [
    ["own", "🎚", "Your own stems", "WAV or MP3 files - one per instrument (click, guide, drums, bass, keys…). Each becomes a track; tempo, key and sections are found."],
    ["split", "✂", "The whole song, split", "One WAV or MP3 of the finished song, vocals and all. The stem splitter separates vocals, drums, bass and the rest."],
    ["pack", "📦", "MultiTracks.com or Prime", "The Ableton set / stems you downloaded from MultiTracks.com or Loop Community (Prime) - sections and tempo come with it."],
    ["central", "☁", "Central Tracks", "The Motion Audio library: search it, add any track with Unlimited, or buy just the ones you need."]];
  function renderChoose() {
    var s = targetSong(), isNew = st.target === "new";
    var head = '<div class="as-head"><button type="button" class="ghost" data-a="as-back">‹ Your songs</button>' +
      (isNew ? '<label class="as-name">New song <input id="asName" placeholder="Song name" value="' + esc(st.newName || "") + '"></label>' : '<h3>Add tracks to <b>' + esc(s ? s.name : "the song") + "</b></h3>") + "</div>";
    return head + '<div class="as-ways">' + WAYS.map(function (w, i) {
      return '<button type="button" class="as-way" data-way="' + w[0] + '"><span class="as-n">' + (i + 1) + '</span><span class="as-i">' + w[1] + "</span><b>" + esc(w[2]) + "</b><small>" + esc(w[3]) + "</small></button>";
    }).join("") + "</div>" +
      (s && T.data(s).stems.length ? '<p class="muted small">' + T.data(s).stems.length + " tracks already - new ones are added next to them.</p>" : "") +
      (s ? '<p class="muted small">MultiTracks.com / Prime and Central Tracks bring their song with its own name, key and sections (a song of the same name is updated).</p>' : "") +
      ((!isNew && s) ? "" : '<p class="muted small">Or: <button type="button" class="linkish" data-way="pco">the songs of a Planning Center service plan</button> · <button type="button" class="linkish" data-a="song-plain">just the song, no tracks</button> (the pads follow its key)</p>') +
      '<input type="file" id="asFiles" accept="audio/*,.wav,.mp3,.flac,.m4a,.aif,.aiff" multiple hidden><input type="file" id="asOne" accept="audio/*,.wav,.mp3,.flac,.m4a,.aif,.aiff" hidden>';
  }
  async function loadLibrary() {
    if (!connected()) { st.library = []; return; }
    try { var j = await (await fetch(MEDIA + "/sync/songs", { cache: "no-store" })).json(); st.library = (j.songs || []).filter(function (x) { return x.here; }); } catch (_) { st.library = []; }
    if (st.step === "songs") render();
  }
  // the song the tracks go into: the one picked (from the library: into this setlist first), or a new one
  async function ensureTarget() {
    if (st.target === "new") {
      var name = (($("#asName") && $("#asName").value) || st.newName || "").trim() || "New song";
      var s = T.newSong(name); st.target = s.id; st.newName = "";
    } else if (!targetSong()) {
      var lib = null;
      try { var r = await fetch(MEDIA + "/sync/song/" + encodeURIComponent(st.target), { cache: "no-store" }); if (r.ok) lib = await r.json(); } catch (_) { }
      if (!lib || lib.id !== st.target || typeof lib.name !== "string") throw new Error("that song isn't on this device any more");
      PP.project().songs.push(lib); PP.persistSoon(); F.renderSetlist && F.renderSetlist();
    }
    var p = PP.project(), i = p.songs.findIndex(function (x) { return x.id === st.target; });
    if (i >= 0 && p.songIndex !== i) F.loadSong(i);
    return p.songs[i];
  }
  async function way(w) {
    if (w === "pack" || w === "central" || w === "pco") {
      st.tab = w; st.step = "tab"; render();
      if (w === "pco" && st.pco.configured === null && connected()) pcoStatus().then(render);
      return;
    }
    if (st.target === "new") st.newName = ($("#asName") && $("#asName").value) || "";
    var input = $(w === "own" ? "#asFiles" : "#asOne"); if (!input) return;
    input.onchange = async function () {
      var files = Array.from(input.files || []); input.value = ""; if (!files.length) return;
      try {
        var s = await ensureTarget();
        if (w === "own") {
          $("#addDialog").close(); PP.setStatus("Adding " + files.length + " track" + (files.length === 1 ? "" : "s") + " to " + s.name + "…");
          await T.importFilesIntoSong(s, files, { analyze: true });
        } else {
          $("#addDialog").close();
          window.PPStemSplit.open({ songId: s.id }); window.PPStemSplit.pick(files[0]);   // (the stems go into this song, whatever the splitter's own setting)
        }
      } catch (error) { PP.setStatus("Could not add it: " + error.message); }
    };
    input.click();
  }

  // ------------------------------------------------------------- dialog
  function render() {
    var body = $("#addBody"); if (!body) return;
    var tabs = $("#addTabs"); if (tabs) tabs.classList.toggle("hidden", st.step !== "tab");
    var back = $("#addBack"); if (back) back.classList.toggle("hidden", st.step !== "tab");
    var sub = $("#addSub"); if (sub) sub.textContent = st.step === "songs" ? "Your songs - pick one, or start a new one." : st.step === "choose" ? "Four ways to bring the tracks in." : "";
    if (st.step === "songs" || st.step === "choose") { var y0 = body.scrollTop; body.innerHTML = st.step === "songs" ? renderSongs() : renderChoose(); body.scrollTop = y0; if (st.step === "songs") { var f = $("#asFind"); if (f && st.focusFind) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); } } return; }
    document.querySelectorAll("#addTabs [data-src]").forEach(function (b) { b.classList.toggle("on", b.dataset.src === st.tab); });
    var y = body.scrollTop;
    body.innerHTML = st.tab === "pco" ? renderPco() : st.tab === "pack" ? renderPack(false) : st.tab === "prime" ? renderPack(true) : st.tab === "central" ? (window.PPCentralTracks ? window.PPCentralTracks.render() : '<p class="muted">Central Tracks is not available in this build.</p>') : renderOwn();
    body.scrollTop = y;
  }
  async function open(tab) {
    if (tab) { st.tab = tab; st.step = "tab"; } else { st.step = "songs"; st.target = null; st.find = ""; st.library = null; loadLibrary(); }
    $("#addDialog").showModal(); render();
    if (st.tab === "pco" && st.pco.configured !== true && connected()) { await pcoStatus(); render(); }
  }
  function wire() {
    if ($("#addBack")) $("#addBack").addEventListener("click", function () { st.step = st.target ? "choose" : "songs"; render(); });
    $("#addTabs").addEventListener("click", function (e) { var b = e.target.closest("[data-src]"); if (!b) return; st.tab = b.dataset.src; render(); if (st.tab === "pco" && st.pco.configured === null && connected()) pcoStatus().then(render); });
    $("#addBody").addEventListener("input", function (e) { if (e.target.id === "asFind") { st.find = e.target.value; st.focusFind = true; render(); st.focusFind = false; } });
    $("#addBody").addEventListener("click", function (e) {
      var sg = e.target.closest("[data-song]"); if (sg) { st.target = sg.dataset.song; st.step = "choose"; render(); return; }
      var wy = e.target.closest("[data-way]"); if (wy) { way(wy.dataset.way); return; }
      var b = e.target.closest("[data-a],[data-plan]"); if (!b) return;
      if (b.dataset.a === "song-new") { st.target = "new"; st.newName = ""; st.step = "choose"; render(); var n = $("#asName"); if (n) n.focus(); return; }
      if (b.dataset.a === "as-back") { st.step = "songs"; st.target = null; render(); return; }
      if (b.dataset.a === "song-plain") { var name = (($("#asName") && $("#asName").value) || "").trim() || "New song"; T.newSong(name); F.loadSong(PP.project().songs.length - 1); $("#addDialog").close(); PP.setStatus("\u201c" + name + "\u201d added - pads follow its key"); return; }
      if (b.dataset.plan) { pcoItems(b.dataset.plan); return; }
      var a = b.dataset.a;
      if (a === "pco-connect") pcoConnect(); else if (a === "pco-import") pcoImport();
      else if (a === "pco-forget") { if (confirm("Disconnect Planning Center? The token is removed from this Central Pedal.")) postJ("/pco/forget").then(function () { st.pco = { configured: false, org: "", types: [], type: null, plans: [], plan: null, items: [], sel: {}, audio: true, top: true, busy: false, log: "" }; render(); }); }
      else if (a === "pack-pick") { st.many = null; packPick(); } else if (a === "pack-import") packImport();
      else if (a === "many-pick") manyPick(); else if (a === "many-import") manyImport(); else if (a === "many-back") { st.many = null; render(); }
      else if (a === "own-create") { var name = ($("#ownName").value || "").trim() || "New song"; T.newSong(name); F.loadSong(PP.project().songs.length - 1); $("#addDialog").close(); T.openEditor(); }
    });
    $("#addBody").addEventListener("change", function (e) {
      var el = e.target;
      if (el.id === "pcoType") { st.pco.type = el.value; pcoPlans(); }
      else if (el.dataset.item) { st.pco.sel[el.dataset.item] = el.checked; render(); }
      else if (el.id === "pcoAudio") st.pco.audio = el.checked; else if (el.id === "pcoTop") st.pco.top = el.checked;
      else if (el.dataset.stemI != null && st.pack) { st.pack.stems[Number(el.dataset.stemI)].keep = el.checked; render(); }
      else if (el.dataset.roleI != null && st.pack) st.pack.stems[Number(el.dataset.roleI)].role = el.value;
      else if (el.id === "packCombine" && st.pack) st.pack.combine = el.checked;
      else if (el.dataset.manyI != null && st.many) { st.many.songs[Number(el.dataset.manyI)].keep = el.checked; render(); }
      else if (el.dataset.manyC != null && st.many) st.many.songs[Number(el.dataset.manyC)].combine = el.checked;
    });
  }
  wire();
  window.PPSources = { open: open, state: st, way: way, ensureTarget: ensureTarget, pcoImport: pcoImport, pcoStatus: pcoStatus, packImport: packImport, manyPick: manyPick, manyImport: manyImport, importPackInfo: importPackInfo, render: render };
})();
