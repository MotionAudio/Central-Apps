/* Central Pedal / Central Pedal Control - "Central Tracks": the Motion Audio community track library.
 * Lives as a tab in "Add songs". Search the library; a Central Tracks subscriber ($77/month) adds any track to
 * this device's storage; everyone else buys the track first. Added tracks become songs like any other import
 * (stems decoded, tempo / key / beats analysed, then copied to the pedals as usual).
 * Server API: docs/CENTRAL-TRACKS-API.md. With no server set, the tab shows a preview of the library. */
(function () {
  "use strict";
  var PP = window.PP, F = window.PPFeatures, T = window.PPTracks; if (!PP || !F || !T) return;
  var esc = PP.escapeHtml, LS = "central-tracks";
  var PREVIEW = [
    { id: "p1", title: "Goodness of God - Ambient Pad", artist: "Hannah R.", kind: "Pad", key: "A", bpm: 63, price: 6.99 },
    { id: "p2", title: "Build My Life - Full Stems", artist: "North Room Music", kind: "Multitrack", key: "G", bpm: 68, price: 24.99 },
    { id: "p3", title: "Holy Forever - Prime Track", artist: "Motion Audio", kind: "Prime", key: "C", bpm: 72, price: 14.99 },
    { id: "p4", title: "Firm Foundation - Click & Guide", artist: "J. Alvarez", kind: "Multitrack", key: "B", bpm: 73, price: 19.99 },
    { id: "p5", title: "Warm Swell Pad (all 12 keys)", artist: "Motion Audio", kind: "Pad", key: "", bpm: 0, price: 9.99 },
    { id: "p6", title: "Same God - Full Stems", artist: "North Room Music", kind: "Multitrack", key: "D", bpm: 76, price: 24.99 }
  ];
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

  // a track the server hands over (files with download URLs) becomes a song on this device
  async function intoSong(t, files) {
    st.log = "Downloading " + files.length + " file" + (files.length === 1 ? "" : "s") + "…"; rerender();
    var got = [];
    for (var i = 0; i < files.length; i++) {
      var f = files[i], r = await fetch(f.url); if (!r.ok) throw new Error("download failed (" + r.status + ")");
      var file = new File([await r.blob()], f.name || ("track-" + (i + 1) + ".wav"));
      if (f.role) file._role = f.role; got.push(file);
      st.log = "Downloaded " + (i + 1) + "/" + files.length; rerender();
    }
    var s = T.findSongByName(t.title) || T.newSong(t.title), d = T.data(s);
    if (t.key) s.key = t.key; if (t.bpm) { s.bpm = t.bpm; d.grid.bpm = t.bpm; }
    st.log = "Analysing (tempo, key, beats)…"; rerender();
    await T.importFilesIntoSong(s, got, { analyze: true });
    if (t.key) s.key = t.key;   // the publisher's key wins over the detected one
    var p = PP.project(); F.loadSong(p.songs.indexOf(s)); PP.persistNow(); T.render(); T.pushAll && T.pushAll(s);
    t.owned = true; st.log = "✓ " + t.title + " is in storage (" + got.length + " track" + (got.length === 1 ? "" : "s") + ").";
    PP.setStatus("Added " + t.title + " from Central Tracks");
  }

  async function addTrack(id) {
    var t = (st.tracks || []).filter(function (x) { return String(x.id) === String(id); })[0]; if (!t || st.busy) return;
    if (preview()) { st.log = "This is a preview of the library. Set the Central Tracks server (below) and sign in to add tracks."; rerender(); return; }
    if (!cfg().token) { st.signIn = true; st.log = "Sign in to add tracks."; rerender(); return; }
    st.busy = true; st.checkout = null; rerender();
    try { var j = await api("POST", "/tracks/" + encodeURIComponent(id) + "/add"); await intoSong(t, j.files || []); }
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
      if (j.files) await intoSong(t, j.files); else { st.checkout = { id: id, title: t.title, price: t.price, url: j.checkoutUrl }; try { window.open(j.checkoutUrl, "_blank"); } catch (e) {} }
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
    var search = '<div class="form"><label>Search<input id="ctQ" type="search" value="' + esc(st.q) + '" placeholder="Song, artist or key"></label><label>Type<select id="ctKind">' + ["", "Pad", "Multitrack", "Prime"].map(function (k) { return '<option value="' + k + '"' + (k === st.kind ? " selected" : "") + ">" + (k || "All types") + "</option>"; }).join("") + '</select></label><button data-ct="search"' + (st.busy ? " disabled" : "") + ">Search</button></div>";
    var rows = (st.tracks || []).length ? '<div class="add-list">' + st.tracks.map(function (t) {
      var act = t.owned ? '<button data-ct-add="' + esc(String(t.id)) + '"' + (st.busy ? " disabled" : "") + ">Add to storage</button>"
        : sub || preview() ? '<button class="primary" data-ct-add="' + esc(String(t.id)) + '"' + (st.busy ? " disabled" : "") + ">Add to storage</button>"
        : '<button class="primary" data-ct-buy="' + esc(String(t.id)) + '"' + (st.busy ? " disabled" : "") + ">Buy " + money(t.price) + "</button>";
      return '<div class="add-row"><span class="tag">' + esc(t.kind || "") + "</span><span><b>" + esc(t.title) + "</b><small>" + [t.artist, t.key ? "Key " + String(t.key).replace("#", "♯") : "", t.bpm ? t.bpm + " BPM" : "", money(t.price)].filter(Boolean).map(esc).join(" · ") + "</small></span>" + act + "</div>";
    }).join("") + "</div>" : '<p class="muted">No tracks match that search.</p>';
    var co = st.checkout ? '<div class="add-plan"><p class="small">Finish buying <b>' + esc(st.checkout.title) + "</b> (" + money(st.checkout.price) + ") on the Motion Audio site" + (st.checkout.url ? ': <span style="user-select:all">' + esc(st.checkout.url) + "</span>" : "") + ' - on a Central Pedal open that link on your phone. Then:</p><button class="primary" data-ct-add="' + esc(String(st.checkout.id)) + '">I\'ve paid - add it</button></div>' : "";
    var server = '<details' + (preview() ? " open" : "") + '><summary class="small">Central Tracks server</summary><div class="form"><label>Server address<input id="ctServer" value="' + esc(c.server || "") + '" placeholder="https://tracks.example.com"></label><button data-ct="server">Save</button></div></details>';
    return '<p>The Motion Audio community library: pads, multitracks and Prime tracks published by other worship teams. Subscribers add any track; otherwise buy the ones you need. Added tracks land in this device\'s song library and copy to your pedals.</p><p class="muted small">Tracks you import yourself are never added to this library. Only tracks published on the Motion Audio website are listed here.</p>' +
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
  window.PPCentralTracks = { render: render, refresh: refresh, state: st };
})();
