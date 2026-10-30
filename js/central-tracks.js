/* Central Pedal / Central Pedal Control - "Central Tracks": the Motion Audio community library.
 * Lives as a tab in "Add songs". Search the library; a Central Tracks Unlimited subscriber ($77/month) adds anything;
 * everyone else buys an item first (priced by its star grade). Kinds:
 *   Pad, Multitrack, Prime - become songs like any other import (stems decoded, tempo / key / beats analysed, copied to the pedals)
 *   Sound - an .sf2, or a zip of .sf2 banks / WAVs named by note: installed as one of your keys & instrument sounds
 *   Board - a pedal board (.json): installed as one of your boards on the Instrument tab
 *   Click - a zip (or two .wav files: accent, beat): a click sound to pick in a song's Click settings
 * Each installs as soon as it's added.
 * Server API: docs/CENTRAL-TRACKS-API.md. With no server set, the tab shows a preview of the library. */
(function () {
  "use strict";
  var PP = window.PP, F = window.PPFeatures, T = window.PPTracks; if (!PP || !F || !T) return;
  var esc = PP.escapeHtml, LS = "central-tracks";
  // (10.0: the preview shows Motion Audio's own hymn multitracks - public-domain hymns in our arrangements, hymns/hymns.json)
  var PREVIEW = [
    { id: "p1", title: "Amazing Grace", artist: "Motion Audio", kind: "Multitrack", key: "G", bpm: 72, price: 20 },
    { id: "p2", title: "Joyful, Joyful, We Adore Thee", artist: "Motion Audio", kind: "Multitrack", key: "G", bpm: 100, price: 20 },
    { id: "p3", title: "Come, Thou Fount of Every Blessing", artist: "Motion Audio", kind: "Multitrack", key: "D", bpm: 84, price: 20 },
    { id: "p4", title: "Be Thou My Vision", artist: "Motion Audio", kind: "Multitrack", key: "D", bpm: 72, price: 20 },
    { id: "p5", title: "Doxology (Praise God, from Whom All Blessings Flow)", artist: "Motion Audio", kind: "Multitrack", key: "G", bpm: 76, price: 20 },
    { id: "p6", title: "Warm Swell Pad (all 12 keys)", artist: "Motion Audio", kind: "Pad", key: "", bpm: 0, price: 9.99 },
    { id: "p7", title: "Felt Upright (sampled)", artist: "Grace Hill Keys", kind: "Sound", key: "", bpm: 0, price: 4.99, stars: 4 },
    { id: "p8", title: "Worship Lead Board (ambient)", artist: "M. Ortiz", kind: "Board", key: "", bpm: 0, price: 1.99, stars: 3 },
    { id: "p9", title: "Rimshot & Shaker Click", artist: "Motion Audio", kind: "Click", key: "", bpm: 0, price: 0.99, stars: 5 }
  ];
  var KINDS = ["Pad", "Multitrack", "Prime", "Sound", "Board", "Click"], SONG_KINDS = { Pad: 1, Multitrack: 1, Prime: 1 };
  var MEDIA = "http://127.0.0.1:8766";
  var st = { q: "", kind: "", tracks: null, me: null, busy: false, log: "", checkout: null, signIn: false, err: "" };

  function cfg() { try { return JSON.parse(localStorage.getItem(LS) || "{}"); } catch (e) { return {}; } }
  function saveCfg(c) { try { localStorage.setItem(LS, JSON.stringify(c)); } catch (e) {} }
  function base() { return String(cfg().server || "").replace(/\/+$/, ""); }
  function preview() { return !base(); }
  function money(n) { return "$" + (Number(n) || 0).toFixed(2); }
  function $(s) { return document.querySelector(s); }
  function rerender() { if (window.PPSources) window.PPSources.render(); }

  async function api(method, path, body) {
    var h = { "Content-Type": "application/json" }, tok = cfg().token; if (tok) h.Authorization = "Bearer " + tok;
    var r = await fetch(base() + "/v1" + path, { method: method, headers: h, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
    var j = {}; try { j = await r.json(); } catch (e) {}
    if (r.status === 402) { var e402 = new Error(j.error || "Purchase needed"); e402.checkoutUrl = j.checkoutUrl; e402.status = 402; throw e402; }
    if (r.status === 401 && path.indexOf("/login") !== 0) { var c = cfg(); delete c.token; saveCfg(c); st.me = null; var e401 = new Error("Sign in to Central Tracks"); e401.status = 401; throw e401; }
    if (!r.ok || j.error) { var er = new Error(j.error || ("Central Tracks server answered " + r.status)); er.status = r.status; throw er; }
    return j;
  }

  async function refresh() {
    st.err = "";
    if (preview()) { st.tracks = filter(PREVIEW); st.me = null; rerender(); return; }
    st.busy = true; rerender();
    try {
      if (cfg().token && !st.me) { try { st.me = await api("GET", "/me"); } catch (e) { st.me = null; } }
      var j = await api("GET", "/tracks?q=" + encodeURIComponent(st.q) + "&kind=" + encodeURIComponent(st.kind));
      st.tracks = j.tracks || [];
    } catch (e) { st.err = "Could not reach Central Tracks: " + e.message; st.tracks = st.tracks || []; }
    st.busy = false; rerender();
  }
  function filter(list) {
    var q = st.q.toLowerCase();
    return list.filter(function (t) { return (!st.kind || t.kind === st.kind) && (t.title + " " + t.artist + " " + t.key).toLowerCase().indexOf(q) >= 0; });
  }

  // A song file that comes with a track (role "song", 10.0 - the Motion Audio hymns): its exact tempo, meter and key, the
  // sections with their lyrics, the chords and the chord chart - so nothing has to be guessed from the audio. Stems it
  // names as muted (the click and guide: the app makes its own) start muted.
  function readSongFile(text) {
    try { var j = JSON.parse(text); return j && j.kind === "central-tracks-song" && Array.isArray(j.sections) ? j : null; } catch (e) { return null; }
  }
  function applySongFile(s, j) {
    var d = T.data(s), bpm = Number(j.bpm) || s.bpm || 72, bpb = Math.max(2, Math.min(12, Math.round(Number(j.bpb) || 4))), beat = 60 / bpm;
    if (j.key) { s.key = j.key; d.originalKey = j.key.replace(/m$/, ""); d.originalMode = /m$/.test(j.key) ? "minor" : "major"; }
    s.bpm = bpm; d.grid = Object.assign(d.grid || {}, { mode: "fitted", bpm: bpm, first: 0, bpb: bpb });
    d.sections = j.sections.filter(function (x) { return x && x.name && x.bar >= 1; }).map(function (x) {
      return { id: PP.id(), name: String(x.name).slice(0, 40), bar: Math.round(x.bar), pad: -1, transition: "inherit", cue: "auto", lyrics: String(x.lyrics || "").slice(0, 4000), page: 0 };
    });
    var at = function (c) { return ((c.bar - 1) * bpb + ((c.beat || 1) - 1)) * beat; };
    var list = (Array.isArray(j.chords) ? j.chords : []).filter(function (c) { return c && c.label && c.bar >= 1; });
    d.chords = list.map(function (c, i) { return { label: String(c.label), bass: c.bass || null, bar: c.bar, beat: c.beat || 1, start: at(c), end: i + 1 < list.length ? at(list[i + 1]) : d.duration || at(c) + bpb * beat }; });
    d.chordsKey = j.key || s.key;
    if (j.chartText) d.chartText = String(j.chartText).slice(0, 60000);
    if (j.credits) s.notes = s.notes || [j.credits.words ? "Words: " + j.credits.words : "", j.credits.music ? "Music: " + j.credits.music : "", j.credits.arrangement || ""].filter(Boolean).join("\n");
  }

  // a track the server hands over (files with download URLs) becomes a song on this device
  async function intoSong(t, files) {
    st.log = "Downloading " + files.length + " file" + (files.length === 1 ? "" : "s") + "…"; rerender();
    var got = [], songFile = null;
    for (var i = 0; i < files.length; i++) {
      var f = files[i], r = await fetch(f.url); if (!r.ok) throw new Error("download failed (" + r.status + ")");
      if (f.role === "song" || /(^|[-_.])song\.json$/i.test(f.name || "")) { songFile = readSongFile(await r.text()); st.log = "Downloaded " + (i + 1) + "/" + files.length; rerender(); continue; }
      var file = new File([await r.blob()], f.name || ("track-" + (i + 1) + ".wav"));
      if (f.role) file._role = f.role; got.push(file);
      st.log = "Downloaded " + (i + 1) + "/" + files.length; rerender();
    }
    if (songFile) {   // (the stems it says start muted)
      var muted = {}; (songFile.stems || []).forEach(function (x) { if (x && x.mute) muted[String(x.name).toLowerCase()] = 1; });
      got.forEach(function (file) { if (muted[file.name.replace(/\.[^.]+$/, "").toLowerCase()]) file._mute = true; });
    }
    var s = T.findSongByName(t.title) || T.newSong(t.title), d = T.data(s);
    if (t.key) s.key = t.key; if (t.bpm) { s.bpm = t.bpm; d.grid.bpm = t.bpm; }
    if (songFile) applySongFile(s, songFile);
    st.log = songFile ? "Adding the tracks…" : "Analysing (tempo, key, beats)…"; rerender();
    await T.importFilesIntoSong(s, got, { analyze: !songFile, sections: songFile ? false : undefined });
    if (songFile) applySongFile(s, songFile);   // (again after the import: its exact grid, sections and chords stay)
    if (t.key) s.key = t.key;   // the publisher's key wins over the detected one
    var p = PP.project(); F.loadSong(p.songs.indexOf(s)); PP.persistNow(); T.render(); T.pushAll && T.pushAll(s);
    t.owned = true; st.log = "✓ " + t.title + " is in storage (" + got.length + " track" + (got.length === 1 ? "" : "s") + ").";
    PP.setStatus("Added " + t.title + " from Central Tracks");
  }

  // ---- Sounds, boards and clicks: installed on add (not songs)
  async function download(files) {
    var got = [];
    for (var i = 0; i < files.length; i++) {
      var f = files[i], r = await fetch(f.url); if (!r.ok) throw new Error("download failed (" + r.status + ")");
      got.push({ name: f.name || ("file-" + (i + 1)), role: f.role || "", blob: await r.blob() });
      st.log = "Downloaded " + (i + 1) + "/" + files.length; rerender();
    }
    return got;
  }
  function ext(n) { return String(n || "").toLowerCase().split(".").pop(); }
  // a small zip reader (stored and deflated entries) for clicks and boards that come zipped
  async function unzip(blob) {
    var buf = new Uint8Array(await blob.arrayBuffer()), dv = new DataView(buf.buffer), out = [], eocd = -1;
    for (var i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error("not a zip file");
    var n = dv.getUint16(eocd + 10, true), p = dv.getUint32(eocd + 16, true);
    for (var k = 0; k < n; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      var method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), size = dv.getUint32(p + 24, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      var name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nl)); p += 46 + nl + xl + cl;
      if (/\/$/.test(name) || size > 64 * 1024 * 1024) continue;
      var start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true), raw = buf.subarray(start, start + csize), data;
      if (method === 0) data = raw;
      else if (method === 8 && typeof DecompressionStream !== "undefined") data = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
      else continue;
      out.push({ name: name.split("/").pop(), blob: new Blob([data]) });
    }
    return out.filter(function (e) { return e.name && !/^[._]/.test(e.name); });
  }
  async function installSound(t, got) {
    var n = 0;
    for (var i = 0; i < got.length; i++) {
      var g = got[i], e = ext(g.name), kind = e === "sf2" || e === "sf3" ? "sf2" : e === "zip" ? "soundzip" : null; if (!kind) continue;
      var name = kind === "sf2" ? g.name : (t.title || "Sound") + ".zip";
      st.log = "Installing " + t.title + "…"; rerender();
      var r = await fetch(MEDIA + "/upload?kind=" + kind + "&name=" + encodeURIComponent(name), { method: "PUT", body: g.blob }), j = await r.json().catch(function () { return {}; });
      if (!r.ok || j.error) throw new Error(j.error || ("the pedal answered " + r.status)); n++;
    }
    if (!n) throw new Error("no .sf2 or .zip in it");
    if (F.sendToDriver) F.sendToDriver({ type: "instrument", action: "status" });
    return "✓ " + t.title + " is in your sounds (Instrument tab → Piano & keys, marked “yours”).";
  }
  async function installBoard(t, got) {
    var I = window.PPInstrument; if (!I || !I.addBoard) throw new Error("the Instrument tab isn't here");
    var files = []; for (var i = 0; i < got.length; i++) files = files.concat(ext(got[i].name) === "zip" ? await unzip(got[i].blob) : [got[i]]);
    var js = files.filter(function (f) { return ext(f.name) === "json"; })[0]; if (!js) throw new Error("no board (.json) in it");
    var b = I.addBoard(JSON.parse(await js.blob.text()), t.title);
    return "✓ " + b.name + " is one of your " + ({ electric: "electric guitar", acoustic: "acoustic", bass: "bass", keys: "keys" }[b.kind] || "") + " boards (Instrument tab → Board).";
  }
  async function installClick(t, got) {
    var files = []; for (var i = 0; i < got.length; i++) files = files.concat(ext(got[i].name) === "zip" ? await unzip(got[i].blob) : [got[i]]);
    var wavs = files.filter(function (f) { return /^(wav|wave|flac|mp3|ogg)$/.test(ext(f.name)); }); if (!wavs.length) throw new Error("no click sounds (.wav) in it");
    var hi = wavs.filter(function (f) { return /accent|hi|high|down|bar|one|1\b/i.test(f.name); })[0] || wavs[0], lo = wavs.filter(function (f) { return f !== hi && /beat|lo|low|click|2\b/i.test(f.name); })[0] || wavs.filter(function (f) { return f !== hi; })[0] || hi;
    var ctx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 1, 48000);
    async function dec(f) { var ab = await ctx.decodeAudioData(await f.blob.arrayBuffer()); var ch = ab.getChannelData(0), out = new Float32Array(ch.length); out.set(ch); if (ab.numberOfChannels > 1) { var c2 = ab.getChannelData(1); for (var k = 0; k < out.length; k++) out[k] = (out[k] + c2[k]) / 2; } return { data: out, rate: ab.sampleRate }; }
    var a = await dec(hi), b = await dec(lo);
    T.addClickSet(t.title, a.data, b.data, a.rate);
    return "✓ " + t.title + " is a click sound: pick it in a song's settings → Click sound.";
  }
  function addLabel(t) { return SONG_KINDS[t.kind] || !t.kind ? "Add to storage" : t.kind === "Sound" ? "Add to my sounds" : t.kind === "Board" ? "Add to my boards" : "Add to my clicks"; }
  async function install(t, files) {
    if (SONG_KINDS[t.kind] || !t.kind) return intoSong(t, files);
    st.log = "Downloading " + t.title + "…"; rerender();
    var got = await download(files);
    st.log = t.kind === "Sound" ? await installSound(t, got) : t.kind === "Board" ? await installBoard(t, got) : t.kind === "Click" ? await installClick(t, got) : "This version doesn't know " + t.kind + " items yet - update Central Pedal.";
    t.owned = true; PP.setStatus("Added " + t.title + " from Central Tracks"); rerender();
  }

  async function addTrack(id) {
    var t = (st.tracks || []).filter(function (x) { return String(x.id) === String(id); })[0]; if (!t || st.busy) return;
    if (preview()) { st.log = "This is a preview of the library. Set the Central Tracks server (below) and sign in to add tracks."; rerender(); return; }
    if (!cfg().token) { st.signIn = true; st.log = "Sign in to add tracks."; rerender(); return; }
    st.busy = true; st.checkout = null; rerender();
    try { var j = await api("POST", "/tracks/" + encodeURIComponent(id) + "/add"); await install(t, j.files || []); }
    catch (e) { if (e.status === 402) { st.checkout = { id: id, title: t.title, price: t.price, url: e.checkoutUrl }; st.log = ""; } else st.log = "Could not add: " + e.message; }
    st.busy = false; rerender();
  }
  async function buyTrack(id) {
    var t = (st.tracks || []).filter(function (x) { return String(x.id) === String(id); })[0]; if (!t || st.busy) return;
    if (preview()) { st.log = "This is a preview of the library. Set the Central Tracks server (below) and sign in to buy tracks."; rerender(); return; }
    if (!cfg().token) { st.signIn = true; st.log = "Sign in to buy tracks."; rerender(); return; }
    st.busy = true; rerender();
    try {
      var j = await api("POST", "/tracks/" + encodeURIComponent(id) + "/purchase");
      if (j.files) await install(t, j.files); else { st.checkout = { id: id, title: t.title, price: t.price, url: j.checkoutUrl }; try { window.open(j.checkoutUrl, "_blank"); } catch (e) {} }
    } catch (e) { st.log = "Could not start the purchase: " + e.message; }
    st.busy = false; rerender();
  }
  async function signIn() {
    var email = ($("#ctEmail").value || "").trim(), pw = $("#ctPass").value || ""; if (!email || !pw) return;
    st.busy = true; rerender();
    try {
      var dev = window.PPLicense && window.PPLicense.deviceId ? window.PPLicense.deviceId() : "";
      var j = await api("POST", "/login", { email: email, password: pw, device: dev });
      if (j.step) { st.two = j; st.log = j.step === "phone" ? "Admin accounts sign in with a code sent to a phone: enter your mobile number." : "Enter the code sent to " + j.to + "."; st.busy = false; rerender(); return; }
      var c = cfg(); c.token = j.token; saveCfg(c); st.signIn = false; st.me = null; st.log = "Signed in.";
    }
    catch (e) { st.log = "Could not sign in: " + e.message; }
    st.busy = false; await refresh();
  }
  // an admin account: the phone (the first time), then the code sent to it
  async function twoStep(a) {
    var t = st.two; if (!t || st.busy) return;
    var phone = (($("#ctPhone") || {}).value || "").trim(), code = (($("#ctCode") || {}).value || "").trim(), ecode = (($("#ctECode") || {}).value || "").trim();   // (read before it redraws)
    st.busy = true; rerender();
    try {
      if (a === "phone") { Object.assign(t, await api("POST", "/login/phone", { ticket: t.ticket, phone: phone })); st.log = "Enter the code sent to " + t.to + "."; }
      else if (a === "again") { Object.assign(t, await api("POST", "/login/resend", { ticket: t.ticket })); st.log = "A new code is on its way."; }
      else { var r = await api("POST", "/login/code", { ticket: t.ticket, code: code, emailCode: ecode || undefined }); var c = cfg(); c.token = r.token; saveCfg(c); st.two = null; st.signIn = false; st.me = null; st.log = "Signed in."; st.busy = false; return refresh(); }
    } catch (e) { st.log = e.message; if (e.status === 410) st.two = null; }
    st.busy = false; rerender();
  }

  function render() {
    if (st.tracks === null) { if (!st.loading) { st.loading = true; setTimeout(function () { refresh().then(function () { st.loading = false; }); }, 0); } return '<p class="muted">Loading Central Tracks…</p>'; }
    var c = cfg(), sub = st.me && st.me.subscribed;
    var acct = preview() ? '<p class="small warn">Preview of the library. Set the Central Tracks server below to search the live library, add and buy tracks.</p>'
      : !c.token ? '<p class="small">Not signed in · <button data-ct="signin-show">Sign in</button> · No account? Make one at Motion Audio.</p>'
      : '<p class="small">' + esc(st.me ? st.me.email : "Signed in") + " · " + (sub ? "<b>Central Tracks subscriber</b> - add anything" : "No subscription - buy tracks one at a time, or subscribe ($77/month) on the Motion Audio site") + ' · <button data-ct="signout">Sign out</button></p>';
    var login = st.two ? (st.two.step === "phone" ? '<div class="form"><label>Mobile number<input id="ctPhone" type="tel" autocomplete="tel"></label><button class="primary" data-ct="two-phone">Send the code</button><button data-ct="two-cancel">Cancel</button></div>'
        : '<div class="form"><label>' + (st.two.both ? "Code from the text" : "Code") + '<input id="ctCode" inputmode="numeric" autocomplete="one-time-code" maxlength="7"></label>' + (st.two.both ? '<label>Code from the email<input id="ctECode" inputmode="numeric" maxlength="7"></label>' : "") + '<button class="primary" data-ct="two-code">Sign in</button><button data-ct="two-again">Send again</button><button data-ct="two-cancel">Cancel</button></div>')
      : st.signIn && !preview() ? '<div class="form"><label>Email<input id="ctEmail" type="email" autocomplete="username"></label><label>Password<input id="ctPass" type="password" autocomplete="current-password"></label><button class="primary" data-ct="signin">Sign in</button></div>' : "";
    var search = '<div class="form"><label>Search<input id="ctQ" type="search" value="' + esc(st.q) + '" placeholder="Song, artist or key"></label><label>Type<select id="ctKind">' + [""].concat(KINDS).map(function (k) { return '<option value="' + k + '"' + (k === st.kind ? " selected" : "") + ">" + (k || "All types") + "</option>"; }).join("") + '</select></label><button data-ct="search"' + (st.busy ? " disabled" : "") + ">Search</button></div>";
    var rows = (st.tracks || []).length ? '<div class="add-list">' + st.tracks.map(function (t) {
      var act = t.owned ? '<button data-ct-add="' + esc(String(t.id)) + '"' + (st.busy ? " disabled" : "") + ">" + addLabel(t) + "</button>"
        : sub || preview() ? '<button class="primary" data-ct-add="' + esc(String(t.id)) + '"' + (st.busy ? " disabled" : "") + ">" + addLabel(t) + "</button>"
        : '<button class="primary" data-ct-buy="' + esc(String(t.id)) + '"' + (st.busy ? " disabled" : "") + ">Buy " + money(t.price) + "</button>";
      return '<div class="add-row"><span class="tag">' + esc(t.kind || "") + "</span><span><b>" + esc(t.title) + "</b><small>" + [t.artist, t.key ? "Key " + String(t.key).replace("#", "♯") : "", t.bpm ? t.bpm + " BPM" : "", t.stars ? t.stars + "-star" : "", money(t.price)].filter(Boolean).map(esc).join(" · ") + "</small></span>" + act + "</div>";
    }).join("") + "</div>" : '<p class="muted">No tracks match that search.</p>';
    var co = st.checkout ? '<div class="add-plan"><p class="small">Finish buying <b>' + esc(st.checkout.title) + "</b> (" + money(st.checkout.price) + ") on the Motion Audio site" + (st.checkout.url ? ': <span style="user-select:all">' + esc(st.checkout.url) + "</span>" : "") + ' - on a Central Pedal open that link on your phone. Then:</p><button class="primary" data-ct-add="' + esc(String(st.checkout.id)) + '">I\'ve paid - add it</button></div>' : "";
    var server = '<details' + (preview() ? " open" : "") + '><summary class="small">Central Tracks server</summary><div class="form"><label>Server address<input id="ctServer" value="' + esc(c.server || "") + '" placeholder="https://tracks.example.com"></label><button data-ct="server">Save</button></div></details>';
    return '<p>The Motion Audio community library: pads, multitracks, Prime tracks, sounds, pedal boards and click sounds published by other worship teams. Central Tracks Unlimited subscribers add anything; otherwise buy the ones you need (priced by their star grade). Sounds, boards and clicks install as soon as they\'re added. Added tracks land in this device\'s song library and copy to your pedals.</p><p class="muted small">Tracks you import yourself are never added to this library. Only tracks published on the Motion Audio website are listed here.</p>' +
      acct + login + search + (st.err ? '<p class="small warn">' + esc(st.err) + "</p>" : "") + rows + co + '<p class="add-progress">' + esc(st.log || "") + "</p>" + server;
  }

  function wire() {
    var body = $("#addBody"); if (!body) return;
    body.addEventListener("click", function (e) {
      var a = e.target.closest("[data-ct-add]"); if (a) { addTrack(a.dataset.ctAdd); return; }
      var b = e.target.closest("[data-ct-buy]"); if (b) { buyTrack(b.dataset.ctBuy); return; }
      var x = e.target.closest("[data-ct]"); if (!x) return;
      var k = x.dataset.ct;
      if (k === "search") { st.q = ($("#ctQ").value || "").trim(); st.kind = $("#ctKind").value; refresh(); }
      else if (k === "signin-show") { st.signIn = true; rerender(); }
      else if (k === "signin") signIn();
      else if (k === "two-phone" || k === "two-code" || k === "two-again") twoStep(k.slice(4));
      else if (k === "two-cancel") { st.two = null; st.log = ""; rerender(); }
      else if (k === "signout") { var c = cfg(); delete c.token; saveCfg(c); st.me = null; st.log = "Signed out."; refresh(); }
      else if (k === "server") { var c2 = cfg(); c2.server = ($("#ctServer").value || "").trim(); delete c2.token; saveCfg(c2); st.me = null; st.tracks = null; st.log = c2.server ? "Server saved. Sign in to add tracks." : ""; rerender(); }
    });
    body.addEventListener("keydown", function (e) { if (e.key === "Enter" && e.target.id === "ctQ") { st.q = e.target.value.trim(); st.kind = $("#ctKind").value; refresh(); } });
  }
  wire();
  window.PPCentralTracks = { render: render, refresh: refresh, state: st, install: install, unzip: unzip, readSongFile: readSongFile, applySongFile: applySongFile };
})();
