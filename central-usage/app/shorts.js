/* Central Control - Shorts (10.2), on the main admin's computer: the good parts of each service recording made into
 * vertical videos with captions (shorts/ in the main process does the work). Here: the recordings, how far the current
 * job is, the shorts of the chosen recording, and for each short: play, trim, captions, title and description, approve,
 * delete, make another from any moment, download, copy the caption, post to YouTube / Facebook / Instagram / TikTok.
 * While the service records it also notes each song and section as it starts, so the worship shorts land on choruses. */
(function () {
  "use strict";
  var CU = window.CentralUsage || null, API = window.CU && window.CU.shorts;
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function fmt(sec) { sec = Math.max(0, Math.round(Number(sec) || 0)); var h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, s = sec % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0"); }
  function fmt1(sec) { var s = Number(sec) || 0, m = Math.floor(s / 60); return m + ":" + (s - m * 60).toFixed(1).padStart(4, "0"); }
  function fileUrl(p) { var s = String(p || "").replace(/\\/g, "/"); if (!/^\//.test(s)) s = "/" + s; return "file://" + s.split("/").map(encodeURIComponent).join("/").replace(/%3A/g, ":"); }
  function day(t) { if (!t) return ""; var d = new Date(t); return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) + " · " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); }
  var PLAT = [["youtube", "YouTube Shorts"], ["facebook", "Facebook Reels"], ["instagram", "Instagram Reels"], ["tiktok", "TikTok"]];

  var S = { status: null, recs: [], sel: null, data: null, base: "", open: null, social: null, msg: "", err: "", busy: false, filter: "all" };
  var root = null;
  function acct() { var L = window.PPLicense, st = L && L.state && L.state(); return { server: L && L.server ? L.server() : "", token: st && st.account ? st.account.token : "" }; }
  function toast(t, bad) { S.msg = bad ? "" : t; S.err = bad ? t : ""; paintNote(); clearTimeout(toast.t); toast.t = setTimeout(function () { S.msg = S.err = ""; paintNote(); }, 6000); }

  // ---------------------------------------------------------------- data
  async function refresh(keepOpen) {
    if (!API) return;
    try { S.status = await API.status(); S.recs = await API.recordings(); } catch (e) { S.err = e.message; }
    if (!S.sel && S.recs.length) S.sel = (S.recs.find(function (r) { return r.shorts; }) || S.recs[0]).id;
    if (S.sel && !S.recs.some(function (r) { return r.id === S.sel; })) S.sel = S.recs[0] ? S.recs[0].id : null;
    await loadShorts(keepOpen);
  }
  async function loadShorts(keepOpen) {
    S.data = null; S.base = "";
    if (S.sel) { try { var r = await API.list(S.sel); S.data = r.data; S.base = r.base; } catch (e) { S.err = e.message; } }
    if (!keepOpen) S.open = null; else if (S.open && S.data && !S.data.shorts.some(function (x) { return x.id === S.open; })) S.open = null;
    render();
  }
  function short(id) { return S.data && S.data.shorts.find(function (x) { return x.id === id; }); }
  function rec() { return S.recs.find(function (r) { return r.id === S.sel; }); }
  function busyFor(id) { var j = S.status && S.status.job; return j && j.id === id ? j : null; }

  // ---------------------------------------------------------------- the page
  function render() {
    root = root || $("#shortsRoot"); if (!root) return;
    if (!API) { root.innerHTML = '<div class="sh-empty card"><h3>Shorts</h3><p class="muted">Shorts are made in the Central Control app on a computer.</p></div>'; return; }
    var st = S.status || {};
    if (st.isMain === false) { root.innerHTML = '<div class="sh-empty card"><h3>Shorts are made on the main admin\'s computer</h3><p class="muted">That computer records the service and has the speech and AI models. Open Shorts there.</p></div>'; return; }
    var r = rec(), d = S.data, j = st.job;
    root.innerHTML =
      '<div class="sh-top"><div><h2>Shorts</h2><p class="muted small">The good parts of each service - sermon and worship - made into vertical videos with captions. Look them over, then post them.</p></div>' +
      '<div class="row"><button data-sh="accounts">Accounts</button><button data-sh="settings">Settings</button><button data-sh="folder">Open the folder</button></div></div>' +
      '<div class="sh-note" aria-live="polite"></div>' +
      (j ? '<div class="sh-job card"><div class="row"><b>' + esc(j.mode === "make" ? "Making shorts" : j.mode === "add" ? "Making a new short" : "Making a short again") + "</b><span class=\"muted small\">" + esc(j.text || "") + '</span><button class="small" data-sh="cancel" style="margin-left:auto">Stop</button></div><div class="sh-bar"><i style="width:' + Math.round((j.pct || 0) * 100) + '%"></i></div></div>' : "") +
      (!st.speech ? '<p class="sh-hint small">The speech model isn\'t on this computer yet, so shorts get no captions and are picked by sound alone. Download it under Settings → Lyrics (listening).</p>' : "") +
      '<div class="sh-main"><aside class="sh-recs"><h3>Recordings</h3>' + recsHtml() + "</aside>" +
      '<section class="sh-list">' + (r ? listHtml(r, d) : '<div class="sh-empty"><p class="muted">No service recordings yet. Record a service (Online mix → Record, and the camera recording in Video), then come back here.</p></div>') + "</section></div>" +
      (S.open && short(S.open) ? editorHtml(short(S.open)) : "");
    paintNote(); wire();
    if (S.open && short(S.open)) wireEditor(short(S.open));
  }
  function paintNote() { var n = root && $(".sh-note", root); if (n) n.innerHTML = S.err ? '<span class="bad">' + esc(S.err) + "</span>" : S.msg ? esc(S.msg) : ""; }
  function recsHtml() {
    if (!S.recs.length) return '<p class="muted small">None yet.</p>';
    return '<ul class="sh-reclist">' + S.recs.map(function (r) {
      var j = busyFor(r.id), q = S.status && S.status.queued.some(function (x) { return x.id === r.id; });
      return '<li class="' + (r.id === S.sel ? "on" : "") + '" data-rec="' + esc(r.id) + '"><b>' + esc(r.name) + '</b><span class="muted small">' + esc(day(r.when)) + (r.seconds ? " · " + fmt(r.seconds) : "") + "</span>" +
        '<span class="sh-tags">' + (r.video ? '<span class="sh-tag">camera</span>' : '<span class="sh-tag dim">sound only</span>') + (r.markers ? '<span class="sh-tag">songs marked</span>' : "") + (r.shorts ? '<span class="sh-tag good">' + r.shorts + " short" + (r.shorts > 1 ? "s" : "") + "</span>" : "") + (j ? '<span class="sh-tag warn">working…</span>' : q ? '<span class="sh-tag warn">waiting</span>' : "") + "</span></li>";
    }).join("") + "</ul>";
  }
  function listHtml(r, d) {
    var j = busyFor(r.id);
    var head = '<div class="sh-listhead"><div><h3>' + esc(r.name) + '</h3><span class="muted small">' + esc(day(r.when)) + (r.seconds ? " · " + fmt(r.seconds) : "") + (d && d.finished ? " · shorts made " + esc(day(d.finished)) : "") + "</span></div>" +
      '<div class="row">' + (d ? '<select data-sh="filter" aria-label="Show"><option value="all"' + (S.filter === "all" ? " selected" : "") + '>All</option><option value="new"' + (S.filter === "new" ? " selected" : "") + '>To look at</option><option value="approved"' + (S.filter === "approved" ? " selected" : "") + '>Approved</option><option value="posted"' + (S.filter === "posted" ? " selected" : "") + ">Posted</option></select>" : "") +
      '<button class="primary" data-sh="make"' + (j ? " disabled" : "") + ">" + (d ? "Make them again" : "Make shorts") + "</button></div></div>";
    if (d && d.note) head += '<p class="sh-hint small">' + esc(d.note) + "</p>";
    if (!d) return head + '<div class="sh-empty"><p class="muted">No shorts from this recording yet. <b>Make shorts</b> finds the best moments of the sermon and the worship and makes ' + esc((S.status && S.status.settings.count) || 5) + " of them, " + esc(S.status ? S.status.settings.minLen + "–" + S.status.settings.maxLen : "30–60") + " seconds each. It runs in the background; the service isn't affected.</p></div>";
    var list = d.shorts.filter(function (s) { return S.filter === "all" || s.status === S.filter; });
    if (!list.length) return head + '<div class="sh-empty"><p class="muted">' + (d.shorts.length ? "None here with that filter." : j ? "Working on them…" : "Nothing good enough was found in this recording.") + "</p></div>";
    return head + '<div class="sh-grid">' + list.map(function (s) {
      return '<button class="sh-card" data-open="' + esc(s.id) + '"><span class="sh-thumb">' + (s.thumb ? '<img alt="" src="' + fileUrl(S.base + "/" + s.thumb) + "?v=" + (s.rendered || 0) + '">' : "") + '<span class="sh-len">' + fmt(s.seconds || (s.end - s.start)) + "</span>" +
        '<span class="sh-kind ' + s.kind + '">' + (s.kind === "worship" ? "Worship" : "Sermon") + "</span></span>" +
        '<span class="sh-ctitle">' + esc(s.title || "Untitled") + '</span><span class="sh-cmeta"><span class="sh-st ' + esc(s.status) + '">' + ({ new: "To look at", approved: "Approved", posted: "Posted" }[s.status] || esc(s.status)) + '</span><span class="muted small">' + esc(fmt(s.start)) + " in</span></span></button>";
    }).join("") + "</div>";
  }

  // ---------------------------------------------------------------- one short
  function editorHtml(s) {
    var soc = S.social && S.social.platforms, last = function (p) { return (s.posts || []).filter(function (x) { return x.platform === p && x.ok; }).pop(); };
    var span = 30, from = Math.max(0, s.start - span), to = s.end + span;
    return '<div class="sh-ed" role="dialog" aria-label="Short"><div class="sh-edbox">' +
      '<div class="sh-edhead"><b>' + esc(s.kind === "worship" ? "Worship" + (s.song ? " · " + s.song : "") : "Sermon") + '</b><span class="muted small">' + esc(s.why || "") + '</span><button class="sh-x" data-ed="close" aria-label="Close">✕</button></div>' +
      '<div class="sh-edbody"><div class="sh-player"><video controls playsinline preload="metadata" src="' + fileUrl(S.base + "/" + s.file) + "?v=" + (s.rendered || 0) + '"></video>' +
      '<div class="row"><button data-ed="another" title="A new short that starts at the moment the video is at now">Make another from here</button><button data-ed="download">Download</button><button data-ed="copy">Copy caption</button></div></div>' +
      '<div class="sh-fields">' +
      '<label>Title<input data-f="title" maxlength="100" value="' + esc(s.title || "") + '"></label>' +
      '<label>Description<textarea data-f="description" rows="3" maxlength="2000">' + esc(s.description || "") + "</textarea></label>" +
      '<label>Hashtags<input data-f="hashtags" value="' + esc((s.hashtags || []).join(" ")) + '" placeholder="#church #sermon"></label>' +
      '<div class="sh-trim"><div class="row"><b>Trim</b><span class="muted small" data-trimtext>' + fmt1(s.start) + " – " + fmt1(s.end) + " (" + (s.end - s.start).toFixed(1) + ' s)</span></div>' +
      '<div class="sh-tl" data-from="' + from + '" data-to="' + to + '"><div class="sh-tlsel"></div><span class="sh-h a" data-h="a" tabindex="0" role="slider" aria-label="Start"></span><span class="sh-h b" data-h="b" tabindex="0" role="slider" aria-label="End"></span></div>' +
      '<div class="row small"><button class="small" data-nudge="a:-1">Start −1 s</button><button class="small" data-nudge="a:1">Start +1 s</button><span style="flex:1"></span><button class="small" data-nudge="b:-1">End −1 s</button><button class="small" data-nudge="b:1">End +1 s</button></div></div>' +
      '<label>Captions' + (s.words && s.words.length ? "" : ' <span class="muted small">(no words for this one)</span>') + '<textarea data-f="captions" rows="4"' + (s.words && s.words.length ? "" : " disabled") + ">" + esc((s.words || []).map(function (w) { return w.text; }).join(" ")) + "</textarea></label>" +
      '<label class="toggle"><input type="checkbox" data-f="showcaps"' + (s.captions === false ? "" : " checked") + "> Show the captions on the video</label>" +
      '<div class="row"><button class="primary" data-ed="save">Save</button><button data-ed="approve">' + (s.status === "approved" || s.status === "posted" ? "Approved ✓" : "Approve") + '</button><span style="flex:1"></span><button class="danger" data-ed="delete">Delete</button></div>' +
      '<div class="sh-post"><b>Post</b><div class="sh-plats">' + PLAT.map(function (p) {
        var x = soc && soc[p[0]], done = last(p[0]), why = !soc ? "Sign in to your Motion Audio account to post." : !x.available ? "Not switched on yet - Download and post by hand for now." : !x.connected ? (x.why || "Connect it under Accounts first.") : "";
        return '<div class="sh-plat"><button data-post="' + p[0] + '"' + (why || s.status === "new" ? " disabled" : "") + ' title="' + esc(why || (s.status === "new" ? "Approve it first" : "Post to " + (x.account || p[1]))) + '">' + esc(p[1]) + "</button>" + (done ? '<span class="small good">' + (done.url ? '<a href="#" data-url="' + esc(done.url) + '">posted</a>' : esc(done.note || "posted")) + "</span>" : why ? '<span class="small muted">' + esc(x && x.available && !x.connected ? "not connected" : !soc ? "" : "off") + "</span>" : "") + "</div>";
      }).join("") + "</div>" + (s.status === "new" ? '<p class="muted small">Approve it to post it.</p>' : "") +
      ((s.posts || []).length ? '<ul class="sh-hist small">' + s.posts.slice().reverse().map(function (x) { return "<li>" + esc(day(x.at)) + " · " + esc((PLAT.find(function (p) { return p[0] === x.platform; }) || [0, x.platform])[1]) + " · " + (x.ok ? (x.url ? '<a href="#" data-url="' + esc(x.url) + '">open</a>' : esc(x.note || "sent")) : '<span class="bad">' + esc(x.error || "failed") + "</span>") + "</li>"; }).join("") + "</ul>" : "") +
      "</div></div></div></div></div>";
  }
  function wireEditor(s) {
    var ed = $(".sh-ed", root); if (!ed) return;
    var tl = $(".sh-tl", ed), from = Number(tl.dataset.from), to = Number(tl.dataset.to), cur = { a: s.start, b: s.end }, changed = { trim: false, caps: false };
    function paintTl() { var w = to - from; $(".sh-tlsel", tl).style.left = ((cur.a - from) / w * 100) + "%"; $(".sh-tlsel", tl).style.width = ((cur.b - cur.a) / w * 100) + "%"; $(".sh-h.a", tl).style.left = ((cur.a - from) / w * 100) + "%"; $(".sh-h.b", tl).style.left = ((cur.b - from) / w * 100) + "%"; $("[data-trimtext]", ed).textContent = fmt1(cur.a) + " – " + fmt1(cur.b) + " (" + (cur.b - cur.a).toFixed(1) + " s)" + (changed.trim ? " · Save makes it again" : ""); }
    function setH(h, t) { t = Math.round(t * 10) / 10; if (h === "a") cur.a = Math.max(from, Math.min(cur.b - 3, t)); else cur.b = Math.min(to, Math.max(cur.a + 3, t)); changed.trim = true; paintTl(); }
    paintTl();
    $$(".sh-h", tl).forEach(function (hEl) {
      hEl.addEventListener("pointerdown", function (e) { e.preventDefault(); hEl.setPointerCapture(e.pointerId); var box = tl.getBoundingClientRect(); function mv(ev) { setH(hEl.dataset.h, from + (ev.clientX - box.left) / box.width * (to - from)); } function up() { hEl.removeEventListener("pointermove", mv); hEl.removeEventListener("pointerup", up); } hEl.addEventListener("pointermove", mv); hEl.addEventListener("pointerup", up); });
      hEl.addEventListener("keydown", function (e) { if (e.key === "ArrowLeft" || e.key === "ArrowRight") { e.preventDefault(); setH(hEl.dataset.h, cur[hEl.dataset.h] + (e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? 0.1 : 1)); } });
    });
    $$("[data-nudge]", ed).forEach(function (b) { b.onclick = function () { var p = b.dataset.nudge.split(":"); setH(p[0], cur[p[0]] + Number(p[1])); }; });
    var caps = $('[data-f="captions"]', ed); if (caps) caps.addEventListener("input", function () { changed.caps = true; });
    var showc = $('[data-f="showcaps"]', ed);
    ed.addEventListener("click", function (e) { if (e.target === ed) close(); });
    function close() { S.open = null; render(); }
    function patch() {
      var p = { title: $('[data-f="title"]', ed).value, description: $('[data-f="description"]', ed).value, hashtags: $('[data-f="hashtags"]', ed).value.split(/[\s,]+/).filter(Boolean) };
      if (changed.trim) { p.start = cur.a; p.end = cur.b; }
      if (changed.caps && caps) p.captionsText = caps.value;
      if (showc && showc.checked !== (s.captions !== false)) p.captions = showc.checked;
      return p;
    }
    $$("[data-ed]", ed).forEach(function (b) {
      b.onclick = async function () {
        var a = b.dataset.ed;
        try {
          if (a === "close") return close();
          if (a === "save") { var p = patch(), again = p.start != null || p.captionsText != null || p.captions != null; await API.update(S.sel, s.id, p); toast(again ? "Saved. Making it again with your changes…" : "Saved."); await refresh(true); return; }
          if (a === "approve") { await API.update(S.sel, s.id, Object.assign(patch(), { status: s.status === "approved" ? "new" : "approved" })); await refresh(true); return; }
          if (a === "delete") { if (!(await confirmBox("Delete this short? Its video file goes too."))) return; await API.remove(S.sel, s.id); S.open = null; toast("Deleted."); await refresh(); return; }
          if (a === "download") { var r = await API.download(S.sel, s.id); if (r && r.saved) toast("Saved to " + r.saved); return; }
          if (a === "copy") { var text = [s.title, s.description, (s.hashtags || []).join(" ")].filter(Boolean).join("\n\n"); try { await navigator.clipboard.writeText(text); } catch (_) { var t = document.createElement("textarea"); t.value = text; document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove(); } toast("The title, description and hashtags are copied."); return; }
          if (a === "another") { var v = $("video", ed), at = s.start + (v ? v.currentTime || 0 : 0); await API.add(S.sel, at); toast("Making a new short from " + fmt(at) + " in the recording…"); await refresh(true); return; }
        } catch (err) { toast(err.message || String(err), true); }
      };
    });
    $$("[data-post]", ed).forEach(function (b) {
      b.onclick = async function () {
        var p = b.dataset.post, label = (PLAT.find(function (x) { return x[0] === p; }) || [0, p])[1];
        b.disabled = true; b.textContent = "Posting…";
        try { var r = await API.post(S.sel, s.id, p, acct()); toast(r.note || ("Posted to " + label + ".")); }
        catch (err) { toast(label + ": " + (err.message || err), true); }
        await refresh(true);
      };
    });
    $$("[data-url]", ed).forEach(function (a) { a.onclick = function (e) { e.preventDefault(); API.openUrl(a.dataset.url); }; });
    document.addEventListener("keydown", function esc(e) { if (e.key === "Escape" && S.open) { document.removeEventListener("keydown", esc); close(); } });
  }
  function confirmBox(text) {
    return new Promise(function (resolve) {
      var d = document.createElement("dialog"); d.className = "ask"; d.innerHTML = "<p>" + esc(text) + '</p><div class="row"><button data-a="no">Cancel</button><button class="danger" data-a="yes">Delete</button></div>';
      document.body.appendChild(d); d.showModal(); d.addEventListener("click", function (e) { var a = e.target.dataset && e.target.dataset.a; if (a) { d.close(); d.remove(); resolve(a === "yes"); } });
    });
  }

  // ---------------------------------------------------------------- settings
  function settingsDialog() {
    var s = S.status.settings, c = s.captions || {};
    var d = document.createElement("dialog"); d.className = "sh-dlg";
    var pct = Math.round((s.sermonShare != null ? s.sermonShare : 0.6) * 100);
    d.innerHTML = '<form method="dialog"><h2>Shorts settings</h2>' +
      '<section><h3>When</h3><label class="toggle"><input type="checkbox" name="auto"' + (s.auto ? " checked" : "") + '> Make shorts by themselves after each service recording</label>' +
      '<label class="sh-inline">Only for recordings longer than <input type="number" name="minRecording" min="0" max="240" value="' + s.minRecording + '" style="width:70px"> minutes</label></section>' +
      '<section><h3>How many and how long</h3><div class="sh-grid2"><label>Shorts per service<input type="number" name="count" min="1" max="20" value="' + s.count + '"></label>' +
      '<label>Shortest (seconds)<input type="number" name="minLen" min="10" max="170" value="' + s.minLen + '"></label><label>Longest (seconds)<input type="number" name="maxLen" min="15" max="180" value="' + s.maxLen + '"></label></div>' +
      '<div class="sh-mixbox"><span class="small">The mix</span><label class="sh-mix"><span>Sermon</span><input type="range" name="sermonShare" min="0" max="100" step="5" value="' + pct + '" aria-label="Sermon or worship"><span>Worship</span></label><span class="muted small" data-mix>' + pct + "% sermon · " + (100 - pct) + "% worship</span></div>" +
      '<label class="toggle"><input type="checkbox" name="useAI"' + (s.useAI !== false ? " checked" : "") + '> Let the AI model read the sermon to help pick (on this computer; nothing is sent anywhere)</label></section>' +
      '<section><h3>Picture</h3><label>Framing<select name="framing">' + [["auto", "Follow the speaker when there's movement, else the wide shot"], ["follow", "Always follow the speaker"], ["blur", "The wide shot over a blurred copy"], ["center", "The middle of the picture"]].map(function (o) { return '<option value="' + o[0] + '"' + (s.framing === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select></label>" +
      '<div class="sh-grid2"><label>Background (sound-only shorts)<input type="color" name="background" value="' + esc(s.background) + '"></label><label>Waveform<input type="color" name="accent" value="' + esc(s.accent) + '"></label></div></section>' +
      '<section><h3>Captions</h3><label class="toggle"><input type="checkbox" name="c_on"' + (c.on !== false ? " checked" : "") + "> Captions on the video</label>" +
      '<div class="sh-grid2"><label>Size<input type="range" name="c_size" min="2.5" max="8" step="0.1" value="' + c.size + '"></label><label>Words on a line<input type="number" name="c_words" min="1" max="8" value="' + c.words + '"></label>' +
      '<label>Words<input type="color" name="c_color" value="' + esc(c.color) + '"></label><label>The word being said<input type="color" name="c_highlight" value="' + esc(c.highlight) + '"></label>' +
      '<label>Outline<input type="color" name="c_outline" value="' + esc(c.outline) + '"></label><label>Where<select name="c_position">' + ["top", "middle", "bottom"].map(function (p) { return '<option value="' + p + '"' + (c.position === p ? " selected" : "") + ">" + p[0].toUpperCase() + p.slice(1) + "</option>"; }).join("") + "</select></label></div>" +
      '<label class="toggle"><input type="checkbox" name="c_upper"' + (c.upper ? " checked" : "") + '> CAPITAL LETTERS</label><label class="toggle"><input type="checkbox" name="c_box"' + (c.box ? " checked" : "") + "> A box behind the words</label>" +
      '<div class="sh-capprev" data-prev><span>You are <i>loved</i> more</span></div></section>' +
      '<section><h3>Logo, intro and outro</h3>' + fileRow("logo", "Logo", s.logo) + '<div class="sh-grid2"><label>Corner<select name="logoCorner">' + [["top-right", "Top right"], ["top-left", "Top left"], ["bottom-right", "Bottom right"], ["bottom-left", "Bottom left"]].map(function (o) { return '<option value="' + o[0] + '"' + (s.logoCorner === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + '</select></label><label>Size (% of the width)<input type="number" name="logoSize" min="5" max="40" value="' + s.logoSize + '"></label></div>' +
      fileRow("intro", "Intro (a picture or a short video)", s.intro) + fileRow("outro", "Outro", s.outro) + "</section>" +
      '<section><h3>Posting</h3><label>YouTube<select name="privacy"><option value="public"' + (s.privacy === "public" ? " selected" : "") + '>Public</option><option value="unlisted"' + (s.privacy === "unlisted" ? " selected" : "") + '>Unlisted</option><option value="private"' + (s.privacy === "private" ? " selected" : "") + '>Private</option></select></label>' +
      '<label>Hashtags on every short<input name="hashtags" value="' + esc(s.hashtags || "") + '" placeholder="#church #worship"></label>' +
      '<label class="toggle"><input type="checkbox" name="tiktokDirect"' + (s.tiktokDirect ? " checked" : "") + "> TikTok: post straight away (only once Motion Audio's TikTok app is approved; otherwise shorts go to the TikTok inbox to finish)</label></section>" +
      '<div class="row"><button type="button" data-a="reset">Back to the usual settings</button><span style="flex:1"></span><button value="cancel">Cancel</button><button class="primary" value="save">Save</button></div></form>';
    document.body.appendChild(d); d.showModal();
    var f = $("form", d);
    function prev() { var p = $("[data-prev]", d), sz = Number(f.c_size.value); p.style.setProperty("--c", f.c_color.value); p.style.setProperty("--h", f.c_highlight.value); p.style.setProperty("--o", f.c_outline.value); p.style.fontSize = Math.round(sz * 5) + "px"; p.style.textTransform = f.c_upper.checked ? "uppercase" : "none"; p.classList.toggle("box", f.c_box.checked); p.style.alignItems = { top: "flex-start", middle: "center", bottom: "flex-end" }[f.c_position.value]; $("[data-mix]", d).textContent = f.sermonShare.value + "% sermon · " + (100 - f.sermonShare.value) + "% worship"; }
    f.addEventListener("input", prev); prev();
    $$("[data-pick]", d).forEach(function (b) { b.onclick = async function () { var p = await API.pickFile(b.dataset.pick); if (p) { f[b.dataset.pick].value = p; $('[data-shown="' + b.dataset.pick + '"]', d).textContent = p.split(/[\\/]/).pop(); } }; });
    $$("[data-clear]", d).forEach(function (b) { b.onclick = function () { f[b.dataset.clear].value = ""; $('[data-shown="' + b.dataset.clear + '"]', d).textContent = "none"; }; });
    $('[data-a="reset"]', d).onclick = async function () { S.status.settings = await API.resetSettings(); d.close(); d.remove(); toast("Back to the usual settings."); refresh(true); };
    d.addEventListener("close", async function () {
      if (d.returnValue === "save") {
        var p = { auto: f.auto.checked, minRecording: Number(f.minRecording.value), count: Number(f.count.value), minLen: Number(f.minLen.value), maxLen: Number(f.maxLen.value), sermonShare: Number(f.sermonShare.value) / 100, useAI: f.useAI.checked, framing: f.framing.value, background: f.background.value, accent: f.accent.value,
          captions: { on: f.c_on.checked, size: Number(f.c_size.value), words: Number(f.c_words.value), color: f.c_color.value, highlight: f.c_highlight.value, outline: f.c_outline.value, position: f.c_position.value, upper: f.c_upper.checked, box: f.c_box.checked },
          logo: f.logo.value, logoCorner: f.logoCorner.value, logoSize: Number(f.logoSize.value), intro: f.intro.value, outro: f.outro.value, privacy: f.privacy.value, hashtags: f.hashtags.value, tiktokDirect: f.tiktokDirect.checked };
        try { S.status.settings = await API.settings(p); toast("Saved. New shorts use these settings."); } catch (e) { toast(e.message, true); }
        render();
      }
      d.remove();
    });
  }
  function fileRow(name, label, val) { return '<div class="sh-file"><span>' + esc(label) + '</span><b data-shown="' + name + '">' + esc(val ? String(val).split(/[\\/]/).pop() : "none") + '</b><input type="hidden" name="' + name + '" value="' + esc(val || "") + '"><button type="button" class="small" data-pick="' + name + '">Choose…</button><button type="button" class="small" data-clear="' + name + '">Remove</button></div>'; }

  // ---------------------------------------------------------------- accounts
  async function accountsDialog() {
    var d = document.createElement("dialog"); d.className = "sh-dlg"; document.body.appendChild(d);
    async function paint() {
      var a = acct(), soc = a.token ? await API.social(a) : { error: "Sign in to your Motion Audio account first (Settings → Packages & key → Account). The connections belong to your church's account." };
      S.social = soc && soc.platforms ? soc : null;
      d.innerHTML = "<h2>Accounts</h2><p class=\"muted small\">Connect the church's accounts once; every short can then be posted with one click. You sign in on each platform's own page - Central Control never sees your passwords.</p>" +
        (soc.error ? '<p class="bad">' + esc(soc.error) + "</p>" : '<div class="sh-accts">' + PLAT.map(function (p) {
          var x = soc.platforms[p[0]], k = p[0] === "facebook" || p[0] === "instagram" ? "meta" : p[0];
          return '<div class="sh-acct"><b>' + esc(p[1]) + "</b><span class=\"small " + (x.connected ? "good" : "muted") + '">' + esc(!x.available ? "Not switched on yet - Motion Audio still has to add this platform's app keys. Until then use Download and Copy caption." : x.connected ? "Connected: " + (x.account || "") : x.why || "Not connected") + "</span>" +
            (x.available ? (x.connected ? '<button class="small" data-dis="' + k + '">Disconnect</button>' : '<button class="small primary" data-con="' + k + '">Connect' + (k === "meta" ? " Facebook and Instagram" : "") + "</button>") : "") + "</div>";
        }).join("") + "</div><p class=\"muted small\">Facebook and Instagram share one sign-in: the Facebook Page, and the Instagram professional account linked to it.</p>") +
        '<div class="row"><button data-a="refresh">Check again</button><span style="flex:1"></span><button data-a="close">Close</button></div>';
      $$("[data-con]", d).forEach(function (b) { b.onclick = async function () { try { await API.connect(b.dataset.con, acct()); toast("Finish signing in in your browser, then press Check again."); } catch (e) { toast(e.message, true); } }; });
      $$("[data-dis]", d).forEach(function (b) { b.onclick = async function () { await API.disconnect(b.dataset.dis, acct()).catch(function (e) { toast(e.message, true); }); paint(); }; });
      $('[data-a="refresh"]', d).onclick = paint; $('[data-a="close"]', d).onclick = function () { d.close(); d.remove(); render(); };
    }
    d.showModal(); d.innerHTML = '<p class="muted">Checking…</p>'; await paint();
  }

  // ---------------------------------------------------------------- wiring
  function wire() {
    $$("[data-rec]", root).forEach(function (li) { li.onclick = function () { S.sel = li.dataset.rec; S.filter = "all"; loadShorts(); }; });
    $$("[data-open]", root).forEach(function (b) { b.onclick = async function () { S.open = b.dataset.open; render(); if (!S.social) { var a = acct(); if (a.token) { var soc = await API.social(a); S.social = soc && soc.platforms ? soc : null; if (S.open) render(); } } }; });
    $$("[data-sh]", root).forEach(function (b) {
      var a = b.dataset.sh;
      if (a === "filter") { b.onchange = function () { S.filter = b.value; render(); }; return; }
      b.onclick = async function () {
        try {
          if (a === "make") { if (S.data && !(await confirmText("Make the shorts of this recording again? The ones you haven't posted are replaced."))) return; S.status = await API.make(S.sel); if (S.status && S.status.error) toast(S.status.error, true); render(); }
          if (a === "cancel") { S.status = await API.cancel(); render(); }
          if (a === "folder") API.reveal(S.sel);
          if (a === "settings") settingsDialog();
          if (a === "accounts") accountsDialog();
        } catch (e) { toast(e.message || String(e), true); }
      };
    });
  }
  function confirmText(text) {
    return new Promise(function (resolve) {
      var d = document.createElement("dialog"); d.className = "ask"; d.innerHTML = "<p>" + esc(text) + '</p><div class="row"><button data-a="no">Cancel</button><button class="primary" data-a="yes">Make them again</button></div>';
      document.body.appendChild(d); d.showModal(); d.addEventListener("click", function (e) { var a = e.target.dataset && e.target.dataset.a; if (a) { d.close(); d.remove(); resolve(a === "yes"); } });
    });
  }

  // ---------------------------------------------------------------- events from the main process
  if (API) API.on(function (m) {
    if (m.type === "progress") { S.status = S.status || {}; S.status.job = m.job; var bar = root && $(".sh-job", root); if (bar && document.contains(bar)) { $(".sh-bar i", bar).style.width = Math.round((m.job.pct || 0) * 100) + "%"; $(".sh-job .muted", root).textContent = m.job.text || ""; } else if (isShown()) render(); return; }
    if (m.type === "status") { S.status = m.status; if (isShown()) refresh(true); return; }
    if (m.type === "short" && m.recording === S.sel && isShown() && !S.open) { loadShorts(true); return; }
    if (m.type === "error") { toast(m.error, true); if (isShown()) refresh(true); return; }
    if (m.type === "done" && isShown()) { if (!m.cancelled) toast(m.mode === "make" ? "The shorts are ready to look at." : "Done."); refresh(true); }
  });
  function isShown() { var v = $("#view-shorts"); return !!(v && v.classList.contains("active")) || !!(window.CUShortsHarness); }

  // the song markers: while this computer records the service, each song / section change is noted
  var lastMark = "";
  setInterval(function () {
    if (!API || !CU || !CU.state) return;
    var d = CU.state.display || null, song = d && d.song ? (typeof d.song === "string" ? d.song : ((d.songs || [])[d.song.index] || {}).name || d.song.name || "") : "", sec = d && d.section ? d.section.name : "", playing = !!(d && (d.playing || !d.tracksMode));
    var key = song + "|" + sec + "|" + playing; if (key === lastMark) return; lastMark = key;
    API.mark({ song: song || null, section: sec || null, playing: playing && !!song });
  }, 1000);

  if (CU && CU.on) CU.on("tab", function (name) { if (name === "shorts") refresh(true); });
  window.CUShorts = { refresh: refresh, render: render, state: function () { return S; } };
  if (window.CUShortsHarness) refresh();
})();
