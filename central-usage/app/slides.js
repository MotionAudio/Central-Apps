/* Central Control - the Slides tab (admin): pictures, videos and text slides, and the lyrics, for the screens.
 * Outputs (any or all): this computer's second screen, the Central Pedal's HDMI 2 (set to "Slides" there),
 * and NDI on the network (for a video mixer / streaming computer). Click a slide to preview it, double-click
 * (or Go live) to show it. "Lyrics follow the Central Pedal" puts the current lyrics up by themselves. */
(function () {
  "use strict";
  var CU = window.CentralUsage, NAT = window.CU && window.CU.slides; if (!CU) return;
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function uid() { return Math.random().toString(36).slice(2, 9); }
  function fileUrl(p) { return /^(https?|file|data):/.test(p) ? p : "file://" + encodeURI(p).replace(/#/g, "%23").replace(/\?/g, "%3F"); }
  var VIDEO = /\.(mp4|webm|mov|m4v|ogv)$/i;
  var BG = window.CUBackgrounds;
  var st = Object.assign({ items: [], outputs: { screen: { on: false, displayId: null }, pi: { on: false }, ndi: { on: false, name: "" } }, lyricsBg: null, songBg: {}, bgFade: 1, lyrics: { size: 7, color: "#ffffff", align: "center", showSection: false } }, CU.store.get("slides", {}));
  if (!st.songBg || typeof st.songBg !== "object") st.songBg = {}; if (st.bgFade == null) st.bgFade = 1;
  var live = { id: null, slide: null }, previewId = null, outStatus = { screen: false, ndi: { on: false } }, screens = [], uploaded = {}, lyricsLive = false, lastLyricsKey = null;
  function save() { CU.store.set("slides", st); }
  function visible() { return CU.prefs.tab === "slides"; }
  function item(id) { return st.items.filter(function (x) { return x.id === id; })[0] || null; }

  // ---------------------------------------------------------------- what a slide looks like (preview boxes use cqh like the output uses vh)
  function slideHtml(s, unit) {
    unit = unit || "cqh";
    if (!s || s.kind === "none" || s.kind === "black") return "";
    if (s.kind === "image") return '<img src="' + fileUrl(s.path) + '" style="object-fit:' + (s.fit === "cover" ? "cover" : "contain") + '">';
    if (s.kind === "video") return '<video src="' + fileUrl(s.path) + '" muted autoplay loop playsinline style="object-fit:' + (s.fit === "cover" ? "cover" : "contain") + '"></video>';
    return bgHtml(s.bgPath) + '<div class="sl-text" style="font-size:' + (Number(s.size) || 7) + unit + ";color:" + esc(s.color || "#fff") + ";text-align:" + esc(s.align || "center") + '">' + (s.title ? "<small>" + esc(s.title) + "</small>" : "") + esc(s.text || "") + "</div>";
  }
  // a background in a preview box: a picture, a video, or one of ours (a canvas, started by setHtml)
  function bgHtml(p) {
    if (!p) return "";
    if (BG && BG.isBg(p)) return '<div class="sl-bg sl-bgc" data-bg="' + esc(BG.idOf(p)) + '"></div>';
    return VIDEO.test(p) ? '<video class="sl-bg" src="' + fileUrl(p) + '" muted autoplay loop playsinline></video>' : '<img class="sl-bg" src="' + fileUrl(p) + '">';
  }
  function setHtml(el, html) {
    if (!el) return; (el._bgs || []).forEach(function (m) { m.stop(); }); el._bgs = [];
    el.innerHTML = html;
    if (BG) el.querySelectorAll("[data-bg]").forEach(function (d) { var m = BG.mount(d, d.dataset.bg, { scale: 0.5, fps: 24 }); if (m) el._bgs.push(m); });
  }
  function bgName(p) { if (!p) return "None (black)"; if (BG && BG.isBg(p)) return BG.nameOf(p) || "Background"; var it = st.items.filter(function (x) { return x.path === p; })[0]; return it ? it.name : String(p).split(/[\\/]/).pop(); }
  // the choices for a Background list: ours, then your pictures and videos
  function bgOptions(sel, noneLabel) {
    var o = '<option value="">' + esc(noneLabel || "none") + "</option>";
    if (BG) {
      var groups = {}; BG.list.forEach(function (b) { var g = b.group + (b.kind === "still" ? " (still)" : ""); (groups[g] = groups[g] || []).push(b); });
      Object.keys(groups).forEach(function (g) { o += '<optgroup label="' + esc(g) + '">' + groups[g].map(function (b) { var v = "bg:" + b.id; return '<option value="' + v + '"' + (v === sel ? " selected" : "") + ">" + esc(b.name) + "</option>"; }).join("") + "</optgroup>"; });
    }
    var mine = st.items.filter(function (x) { return x.kind !== "text"; });
    if (mine.length) o += '<optgroup label="Your pictures and videos">' + mine.map(function (x) { return '<option value="' + esc(x.path) + '"' + (x.path === sel ? " selected" : "") + ">" + esc(x.name) + "</option>"; }).join("") + "</optgroup>";
    return o;
  }
  // which background the lyrics use now: this part's, then this song's, then the one for everything
  function songKey() { var d = CU.state.display, sg = d && d.song; return sg ? String(typeof sg === "string" ? sg : sg.name || sg.title || "") : ""; }
  function secName() { var d = CU.state.display, ls = d && d.lyrics || {}; return ls.section || (d && d.section ? d.section.name : "") || ""; }
  function bgFor(song, sec) {
    var sb = st.songBg[song == null ? songKey() : song]; sec = sec == null ? secName() : sec;
    if (sb && sb.sections && sec && sb.sections[sec] !== undefined) return sb.sections[sec];
    if (sb && sb.all !== undefined) return sb.all;
    return st.lyricsBg;
  }
  function setBg(scope, value) {   // scope: "all" | "song" | "section"; value null = black, undefined = use the one above it
    var k = songKey(), sec = secName();
    if (scope === "all") st.lyricsBg = value || null;
    else if (scope === "song" && k) { st.songBg[k] = st.songBg[k] || { sections: {} }; if (value === undefined) delete st.songBg[k].all; else st.songBg[k].all = value; }
    else if (scope === "section" && k && sec) { st.songBg[k] = st.songBg[k] || { sections: {} }; st.songBg[k].sections = st.songBg[k].sections || {}; if (value === undefined) delete st.songBg[k].sections[sec]; else st.songBg[k].sections[sec] = value; }
    save(); pushLyrics(true); renderBgPicker(); renderLook(); CU.fire("lyricsBg", bgFor());
  }
  function slideFor(it) {
    if (!it) return { kind: "none" };
    if (it.kind === "text") return { kind: "text", text: it.text || "", title: it.title || "", size: it.size || st.lyrics.size, color: it.color || st.lyrics.color, align: it.align || st.lyrics.align, bgPath: it.bg || null, bgFade: st.bgFade, fade: it.fade == null ? 0.45 : it.fade };
    return { kind: it.kind, path: it.path, name: it.name, fit: it.fit || "contain", loop: it.loop !== false, muted: it.muted !== false, fade: it.fade == null ? 0.45 : it.fade };
  }
  // ---------------------------------------------------------------- going live (to every output that is on)
  async function toPi(slide) {
    if (!st.outputs.pi.on || !CU.state.connected) return;
    var code = CU.prefs.code; if (!code) { CU.askCode(); return; }
    var msg = { type: "slide", code: code, kind: slide.kind, fit: slide.fit, loop: slide.loop, muted: slide.muted, text: slide.text, title: slide.title, size: slide.size, color: slide.color, align: slide.align };
    async function upload(path) {   // a picture / video goes to the Pi once (then it's only named)
      var name = path.split(/[\\/]/).pop().replace(/[^\w.\- ]+/g, "_");
      if (!uploaded[path] && NAT) {
        var data = await NAT.readFile(path); var r = await fetch(CU.api("/slides?code=" + encodeURIComponent(code) + "&name=" + encodeURIComponent(name)), { method: "POST", body: data }); var j = await r.json(); if (!r.ok) throw new Error(j.error || r.status); uploaded[path] = j.file;
      }
      return uploaded[path] || name;
    }
    try {
      if ((slide.kind === "image" || slide.kind === "video") && slide.path) msg.file = await upload(slide.path);
      if (slide.bgPath && !(BG && BG.isBg(slide.bgPath))) msg.bgFile = await upload(slide.bgPath);   // (ours are drawn here, not files)
    } catch (e) { setInfo("Could not send it to the Central Pedal: " + e.message); return; }
    CU.send(msg);
  }
  function show(slide, id) {
    live = { id: id || null, slide: slide };
    if (NAT) NAT.show(slide);
    toPi(slide);
    renderLive(); markList();
  }
  function goLive(id) { var it = item(id); if (!it) return; lyricsLive = false; syncLyricsBox(); show(slideFor(it), id); }
  function black() { lyricsLive = false; syncLyricsBox(); show({ kind: "black" }, null); }
  // blank the screens (Stream Deck / MIDI): black on every output, then back to what was up
  var blanked = null;
  function blank(on) {
    if (on == null) on = !blanked;
    if (on && !blanked) { blanked = { live: live, lyrics: lyricsLive }; lyricsLive = false; syncLyricsBox(); show({ kind: "black", fade: 0.6 }, null); }
    else if (!on && blanked) { var b = blanked; blanked = null; if (b.lyrics) setLyricsLive(true); else if (b.live && b.live.slide) show(b.live.slide, b.live.id); else show({ kind: "black" }, null); }
    renderLive(); CU.fire("screensBlank", !!blanked); return !!blanked;
  }
  // the lyrics, as the Central Pedal moves through the song
  function lyricsSlide() {
    var d = CU.state.display, ls = d && d.lyrics || {}, lines = ls.lines || [];
    return { kind: "lyrics", text: lines.join("\n"), title: st.lyrics.showSection ? (ls.section || (d && d.section ? d.section.name : "")) : "", size: st.lyrics.size, color: st.lyrics.color, align: st.lyrics.align, bgPath: bgFor(), bgFade: st.bgFade, fade: 0.3 };
  }
  function pushLyrics(force) {
    if (!lyricsLive) return; var s = lyricsSlide(), key = JSON.stringify(s);
    if (!force && key === lastLyricsKey) return; lastLyricsKey = key; show(s, "lyrics");
  }
  function setLyricsLive(on) { lyricsLive = !!on; lastLyricsKey = null; if (on) pushLyrics(true); syncLyricsBox(); renderHead(); }
  function syncLyricsBox() { var b = $("#lyricsLive"); if (b) b.checked = lyricsLive; var i = $("#lyricsOutInfo"); if (i) i.textContent = outputsText(); }
  function outputsText() { var o = []; if (outStatus.screen) o.push("second screen"); if (st.outputs.pi.on) o.push("Central Pedal HDMI 2"); if (outStatus.ndi && outStatus.ndi.on) o.push("NDI"); return o.length ? "→ " + o.join(" · ") : "no output is on (Slides tab)"; }
  CU.on("message", function (m) { if (m.type === "display") pushLyrics(false); });

  // ---------------------------------------------------------------- rendering
  var infoText = "";
  function setInfo(t) { infoText = t; var el = $("#slInfo"); if (el) el.textContent = t; }
  function renderHead() {
    var el = $("#slHead"); if (!el) return; var o = st.outputs;
    el.innerHTML = '<div class="sl-outs"><b>Outputs</b>' +
      '<label class="toggle"><input type="checkbox" data-sl-out="screen"' + (outStatus.screen ? " checked" : "") + (NAT ? "" : " disabled") + '> Second screen</label><select data-sl="display">' + screens.map(function (d) { return '<option value="' + d.id + '"' + (String(d.id) === String(o.screen.displayId) ? " selected" : "") + ">" + esc(d.label) + " · " + d.size.width + "×" + d.size.height + (d.primary ? " (this one)" : "") + "</option>"; }).join("") + "</select>" +
      '<label class="toggle" title="Set the Central Pedal\'s HDMI 2 to show Slides (its I/O tab)"><input type="checkbox" data-sl-out="pi"' + (o.pi.on ? " checked" : "") + "> Central Pedal HDMI 2</label>" +
      '<label class="toggle"><input type="checkbox" data-sl-out="ndi"' + (outStatus.ndi && outStatus.ndi.on ? " checked" : "") + (NAT ? "" : " disabled") + '> NDI</label><span class="muted small">' + esc(outStatus.ndi && outStatus.ndi.error ? "⚠ " + outStatus.ndi.error : outStatus.ndi && outStatus.ndi.on ? "on the network as \"" + (outStatus.ndi.name || "Central Control") + "\"" + (outStatus.ndi.receivers ? " · " + outStatus.ndi.receivers + " watching" : "") : "") + "</span></div>" +
      '<div class="sl-ctl"><button data-sl="black" class="danger">Black</button><label class="toggle sl-lyr"><input type="checkbox" data-sl="lyrics"' + (lyricsLive ? " checked" : "") + '> Lyrics follow the Central Pedal</label><span class="muted small" id="slInfo">' + esc(infoText) + "</span></div>";
  }
  function thumb(it) { return it.kind === "text" ? '<div class="sl-th sl-tht"><span>' + esc((it.title ? it.title + " · " : "") + (it.text || "Text")).slice(0, 80) + "</span></div>" : '<div class="sl-th">' + (it.kind === "video" ? '<video src="' + fileUrl(it.path) + '#t=1" muted preload="metadata"></video><b class="sl-vid">▶</b>' : '<img src="' + fileUrl(it.path) + '" loading="lazy">') + "</div>"; }
  function renderList() {
    var el = $("#slList"); if (!el) return;
    el.innerHTML = st.items.length ? st.items.map(function (it, k) { return '<div class="sl-item" data-id="' + it.id + '" draggable="true">' + thumb(it) + '<span class="sl-nm">' + (k + 1) + ". " + esc(it.kind === "text" ? (it.title || "Text slide") : it.name) + '</span><span class="sl-ib"><button data-sl-go="' + it.id + '" title="Go live">▶</button><button data-sl-del="' + it.id + '" title="Remove">✕</button></span></div>'; }).join("") : '<p class="muted">Add pictures, videos or a text slide.</p>';
    markList();
  }
  function markList() { document.querySelectorAll(".sl-item").forEach(function (el) { el.classList.toggle("live", el.dataset.id === live.id); el.classList.toggle("sel", el.dataset.id === previewId); }); }
  function renderPreview() {
    var el = $("#slPreview"); if (!el) return; var it = item(previewId);
    if (!it) { el.innerHTML = '<div class="sl-screen"></div><p class="muted">Click a slide to see it here.</p>'; return; }
    var s = slideFor(it);
    setHtml(el, '<div class="sl-screen">' + slideHtml(s) + "</div>" +
      (it.kind === "text" ? '<label>Title (small, above)<input data-sli="title" value="' + esc(it.title || "") + '"></label><label>Text<textarea data-sli="text" rows="4">' + esc(it.text || "") + "</textarea></label>" +
        '<div class="row"><label>Size <input type="range" min="3" max="14" step="0.5" data-sli="size" value="' + (it.size || st.lyrics.size) + '"></label><label>Colour <input type="color" data-sli="color" value="' + esc(it.color || st.lyrics.color) + '"></label><label>Align <select data-sli="align">' + ["center", "left", "right"].map(function (a) { return '<option' + ((it.align || st.lyrics.align) === a ? " selected" : "") + ">" + a + "</option>"; }).join("") + '</select></label><label>Background <select data-sli="bg">' + bgOptions(it.bg || "") + "</select></label></div>"
        : '<div class="row"><label>Fit <select data-sli="fit"><option value="contain"' + (it.fit !== "cover" ? " selected" : "") + '>Whole picture</option><option value="cover"' + (it.fit === "cover" ? " selected" : "") + ">Fill the screen</option></select></label>" + (it.kind === "video" ? '<label class="toggle"><input type="checkbox" data-sli="loop"' + (it.loop !== false ? " checked" : "") + '> Loop</label><label class="toggle"><input type="checkbox" data-sli="sound"' + (it.muted === false ? " checked" : "") + "> Sound</label>" : "") + "</div>") +
      '<div class="row"><label>Fade (s) <input type="number" min="0" max="5" step="0.1" data-sli="fade" value="' + (it.fade == null ? 0.45 : it.fade) + '" style="width:70px"></label><button class="primary" data-sl-go="' + it.id + '">▶ Go live</button></div>');
  }
  function renderLive() { var el = $("#slLive"); if (!el) return; setHtml(el, '<div class="sl-screen live">' + slideHtml(live.slide) + '</div><p class="muted small">' + (live.id === "lyrics" ? "Lyrics (following the Central Pedal)" : live.id ? esc((item(live.id) || {}).name || "Text slide") : live.slide && live.slide.kind === "black" ? (blanked ? "Screens blanked" : "Black") : "Nothing yet") + "</p>"); }
  function renderLook() {
    var el = $("#slLook"); if (!el) return; var l = st.lyrics;
    el.innerHTML = '<h3>Lyrics look</h3><div class="row"><label>Size <input type="range" min="3" max="14" step="0.5" data-sll="size" value="' + l.size + '"></label><label>Colour <input type="color" data-sll="color" value="' + esc(l.color) + '"></label><label>Align <select data-sll="align">' + ["center", "left", "right"].map(function (a) { return '<option' + (l.align === a ? " selected" : "") + ">" + a + "</option>"; }).join("") + '</select></label><label class="toggle"><input type="checkbox" data-sll="showSection"' + (l.showSection ? " checked" : "") + '> Section name</label><label>Background <select data-sll="bg">' + bgOptions(st.lyricsBg || "", "none (black)") + "</select></label></div>" +
      '<p class="muted small">More backgrounds, one for a single song or one part of a song, and your own pictures: the Lyrics tab → Background.</p>';
  }
  function render() {
    var root = $("#slidesRoot"); if (!root || !visible()) return;
    if (!root.querySelector("#slHead")) root.innerHTML = '<div class="card" id="slHead"></div><div class="sl-grid"><div class="card sl-listcard"><div class="row"><button data-sl="add" class="primary">+ Pictures / videos</button><button data-sl="text">+ Text slide</button></div><div class="sl-list" id="slList"></div></div><div class="card"><h3>Preview</h3><div id="slPreview"></div></div><div class="card"><h3>Live</h3><div id="slLive"></div></div></div><div class="card" id="slLook"></div>' + (NAT ? "" : '<p class="muted">Second screen and NDI work in the Central Control app.</p>');
    renderHead(); renderList(); renderPreview(); renderLive(); renderLook();
  }
  // ---------------------------------------------------------------- the Lyrics tab's Background picker
  // ours (moving and still), your pictures and videos, or black; for everything, this song, or this part of it
  var bgPick = { scope: "all", filter: "all", open: false }, thumbs = {};
  function thumbOf(id) { return thumbs[id] || (thumbs[id] = BG ? BG.thumb(id, 192, 108, 14) : ""); }
  function scopeVal(scope) {
    var k = songKey(), sec = secName(), sb = st.songBg[k];
    if (scope === "section") return sb && sb.sections && sec && sb.sections[sec] !== undefined ? sb.sections[sec] : undefined;
    if (scope === "song") return sb && sb.all !== undefined ? sb.all : undefined;
    return st.lyricsBg || null;
  }
  function renderBgPicker() {
    var el = document.getElementById("lyricsBgPanel"); if (!el || el.hidden) return;
    var k = songKey(), sec = secName(), v = scopeVal(bgPick.scope), shown = v === undefined ? bgFor() : v;
    var scopes = [["all", "Every song"], ["song", k ? "This song: " + k : "This song (no song yet)"], ["section", sec ? "This part: " + sec : "This part (no part yet)"]];
    var tiles = [];
    if (bgPick.filter !== "yours") tiles.push({ v: null, name: "None (black)", img: "" });
    if (BG && bgPick.filter !== "yours") BG.list.forEach(function (b) { if (bgPick.filter === "motion" && b.kind !== "motion") return; if (bgPick.filter === "still" && b.kind !== "still") return; tiles.push({ v: "bg:" + b.id, name: b.name, img: thumbOf(b.id), motion: b.kind === "motion" }); });
    if (bgPick.filter === "all" || bgPick.filter === "yours") st.items.filter(function (x) { return x.kind !== "text"; }).forEach(function (x) { tiles.push({ v: x.path, name: x.name, file: x }); });
    el.innerHTML = '<div class="row spread"><b>Lyrics background</b><button class="mini" data-lb="close" aria-label="Close">✕</button></div>' +
      '<div class="lb-top"><div class="lb-prev"><div class="sl-screen">' + slideHtml(Object.assign(lyricsSlide(), { bgPath: shown })) + '</div><p class="muted small">' + esc(lyricsLive ? "On the outputs now: " + outputsText().replace(/^→ /, "") : "Not on the outputs (tick Lyrics to the outputs)") + "</p></div>" +
      '<div class="lb-side"><div class="lb-scopes" role="radiogroup" aria-label="Use it for">' + scopes.map(function (s) { var dis = (s[0] === "song" && !k) || (s[0] === "section" && (!k || !sec)); return '<label class="toggle"><input type="radio" name="lbScope" data-lbs="' + s[0] + '"' + (bgPick.scope === s[0] ? " checked" : "") + (dis ? " disabled" : "") + "> " + esc(s[1]) + "</label>"; }).join("") + "</div>" +
      '<p class="muted small">' + (bgPick.scope === "all" ? "Now: " + esc(bgName(st.lyricsBg)) : v === undefined ? "Uses the one above: " + esc(bgName(bgFor())) : "Now: " + esc(bgName(v)) + ' <button class="mini" data-lb="inherit">Use the one above</button>') + "</p>" +
      '<label>Crossfade (s) <input type="range" min="0" max="5" step="0.25" data-lb-fade value="' + st.bgFade + '"><output>' + st.bgFade + "</output></label>" +
      '<div class="lb-filter" role="group" aria-label="Show">' + [["all", "All"], ["motion", "Moving"], ["still", "Still"], ["yours", "Yours"]].map(function (f) { return '<button data-lbf="' + f[0] + '" class="' + (bgPick.filter === f[0] ? "on" : "") + '">' + f[1] + "</button>"; }).join("") + "</div></div></div>" +
      '<div class="lb-grid">' + tiles.map(function (t) { var sel = (t.v || null) === (shown || null); return '<button class="lb-tile' + (sel ? " sel" : "") + '" data-lbv="' + esc(t.v == null ? "" : t.v) + '" title="' + esc(t.name) + '">' + (t.img ? '<img src="' + t.img + '" alt="">' : t.file ? (t.file.kind === "video" ? '<video src="' + fileUrl(t.file.path) + '#t=1" muted preload="metadata"></video>' : '<img src="' + fileUrl(t.file.path) + '" alt="" loading="lazy">') : '<span class="lb-black"></span>') + '<span class="lb-nm">' + esc(t.name) + (t.motion ? " ·  moving" : "") + "</span></button>"; }).join("") +
      '<button class="lb-tile lb-add" data-lb="add"><span class="lb-black">+</span><span class="lb-nm">Add a picture or video</span></button></div>';
    var pv = el.querySelector(".lb-prev .sl-screen"); if (pv) { var html = pv.innerHTML; setHtml(pv, html); }
  }
  function openBgPicker(on) {
    var el = document.getElementById("lyricsBgPanel"); if (!el) return;
    el.hidden = on == null ? !el.hidden : !on;
    if (el.hidden) { (el.querySelectorAll(".sl-screen") || []).forEach(function (s) { setHtml(s, ""); }); return; }
    renderBgPicker();
  }
  (function () {
    var view = document.getElementById("view-lyrics"); if (!view || document.getElementById("lyricsBgPanel")) return;
    var out = view.querySelector(".lyr-out"), btn = document.createElement("button"); btn.id = "lyricsBgBtn"; btn.textContent = "Background…"; btn.title = "The picture behind the lyrics on the screens";
    if (out) out.insertBefore(btn, out.firstChild); else view.querySelector(".bar").appendChild(btn);
    var panel = document.createElement("div"); panel.id = "lyricsBgPanel"; panel.className = "card lyr-bg admin-only"; panel.hidden = true;
    var lyr = document.getElementById("lyrics"); view.insertBefore(panel, lyr);
    btn.addEventListener("click", function () { openBgPicker(); });
    panel.addEventListener("click", async function (e) {
      var b = e.target.closest("button"); if (!b) return;
      if (b.dataset.lb === "close") openBgPicker(false);
      else if (b.dataset.lb === "inherit") setBg(bgPick.scope, undefined);
      else if (b.dataset.lb === "add") { if (!NAT) return alert("Adding pictures and videos works in the Central Control app."); var files = await NAT.open(); var last = null; files.forEach(function (f) { last = { id: uid(), kind: VIDEO.test(f.name) ? "video" : "image", path: f.path, name: f.name, size: f.size, fit: "cover" }; st.items.push(last); }); save(); if (last) setBg(bgPick.scope, last.path); else renderBgPicker(); }
      else if (b.dataset.lbf) { bgPick.filter = b.dataset.lbf; renderBgPicker(); }
      else if (b.dataset.lbv != null) setBg(bgPick.scope, b.dataset.lbv || null);
    });
    panel.addEventListener("change", function (e) { if (e.target.dataset.lbs) { bgPick.scope = e.target.dataset.lbs; renderBgPicker(); } });
    panel.addEventListener("input", function (e) { if (e.target.hasAttribute("data-lb-fade")) { st.bgFade = Number(e.target.value) || 0; e.target.nextElementSibling.textContent = st.bgFade; save(); } });
  })();
  var lastBgKey = "";
  CU.on("message", function (m) { if (m.type !== "display") return; var key = songKey() + "|" + secName(); if (key !== lastBgKey) { lastBgKey = key; CU.fire("lyricsBg", bgFor()); renderBgPicker(); } });
  // ---------------------------------------------------------------- events
  var root = $("#slidesRoot");
  root.addEventListener("click", async function (e) {
    var b = e.target.closest("button,.sl-item"); if (!b) return;
    if (b.dataset.slGo) { goLive(b.dataset.slGo); return; }
    if (b.dataset.slDel) { st.items = st.items.filter(function (x) { return x.id !== b.dataset.slDel; }); if (previewId === b.dataset.slDel) previewId = null; save(); renderList(); renderPreview(); renderLook(); return; }
    if (b.classList.contains("sl-item")) { previewId = b.dataset.id; markList(); renderPreview(); return; }
    var a = b.dataset.sl;
    if (a === "add") { if (!NAT) return alert("Adding files works in the Central Control app."); var files = await NAT.open(); files.forEach(function (f) { st.items.push({ id: uid(), kind: VIDEO.test(f.name) ? "video" : "image", path: f.path, name: f.name, size: f.size, fit: "contain" }); }); save(); renderList(); renderLook(); }
    else if (a === "text") { var it = { id: uid(), kind: "text", title: "", text: "Welcome" }; st.items.push(it); previewId = it.id; save(); renderList(); renderPreview(); }
    else if (a === "black") black();
  });
  root.addEventListener("dblclick", function (e) { var el = e.target.closest(".sl-item"); if (el) goLive(el.dataset.id); });
  root.addEventListener("dragstart", function (e) { var el = e.target.closest(".sl-item"); if (el) e.dataTransfer.setData("text/plain", el.dataset.id); });
  root.addEventListener("dragover", function (e) { if (e.target.closest(".sl-item")) e.preventDefault(); });
  root.addEventListener("drop", function (e) { var el = e.target.closest(".sl-item"); if (!el) return; e.preventDefault(); var from = e.dataTransfer.getData("text/plain"), a = st.items.findIndex(function (x) { return x.id === from; }), b = st.items.findIndex(function (x) { return x.id === el.dataset.id; }); if (a < 0 || b < 0 || a === b) return; var moved = st.items.splice(a, 1)[0]; st.items.splice(b, 0, moved); save(); renderList(); });
  function onField(e) {
    var t = e.target, it = item(previewId);
    if (t.dataset.sli && it) { var k = t.dataset.sli, v = t.type === "checkbox" ? t.checked : t.type === "range" || t.type === "number" ? Number(t.value) : t.value; if (k === "sound") it.muted = !v; else it[k] = v; save(); if (e.type === "change" || k === "text" || k === "title") { var scr = $("#slPreview .sl-screen"); if (scr) setHtml(scr, slideHtml(slideFor(it))); } if (e.type === "change" && k !== "text" && k !== "title") renderPreview(); if (live.id === it.id) show(slideFor(it), it.id); if (k === "title" || k === "text") { var nm = document.querySelector('.sl-item[data-id="' + it.id + '"] .sl-tht > span'); if (nm) nm.textContent = ((it.title ? it.title + " · " : "") + (it.text || "Text")).slice(0, 80); } return; }
    if (t.dataset.sll) { var kk = t.dataset.sll; if (kk === "bg") { setBg("all", t.value || null); return; } else st.lyrics[kk] = t.type === "checkbox" ? t.checked : t.type === "range" ? Number(t.value) : t.value; save(); pushLyrics(true); return; }
  }
  root.addEventListener("input", onField);
  root.addEventListener("change", async function (e) {
    var t = e.target; onField(e);
    if (t.dataset.sl === "lyrics") setLyricsLive(t.checked);
    else if (t.dataset.sl === "display") { st.outputs.screen.displayId = Number(t.value); save(); if (outStatus.screen && NAT) await NAT.outputScreen({ on: true, displayId: st.outputs.screen.displayId }); }
    else if (t.dataset.slOut === "screen" && NAT) { var r = await NAT.outputScreen({ on: t.checked, displayId: st.outputs.screen.displayId }); outStatus.screen = r.on; st.outputs.screen.on = r.on; save(); if (r.on && live.slide) NAT.show(live.slide); renderHead(); syncLyricsBox(); }
    else if (t.dataset.slOut === "pi") { st.outputs.pi.on = t.checked; save(); if (t.checked && live.slide) toPi(live.slide); renderHead(); syncLyricsBox(); }
    else if (t.dataset.slOut === "ndi" && NAT) { outStatus.ndi = await NAT.outputNdi({ on: t.checked, name: st.outputs.ndi.name || "" }); st.outputs.ndi.on = !!outStatus.ndi.on; save(); setTimeout(function () { if (live.slide) NAT.show(live.slide); }, 800); renderHead(); syncLyricsBox(); }
  });
  var lyrBox = $("#lyricsLive"); if (lyrBox) lyrBox.addEventListener("change", function () { setLyricsLive(lyrBox.checked); });
  if (NAT) {
    NAT.onOutputs(function (o) { if ("screen" in o) outStatus.screen = o.screen; if (o.ndi) outStatus.ndi = o.ndi; if (visible()) renderHead(); syncLyricsBox(); });
    NAT.screens().then(function (list) { screens = list || []; if (st.outputs.screen.displayId == null) { var other = screens.filter(function (d) { return !d.primary; })[0]; st.outputs.screen.displayId = other ? other.id : screens[0] && screens[0].id; } if (visible()) renderHead(); });
    NAT.outputs().then(function (o) { outStatus.screen = o.screen; outStatus.ndi = o.ndi; });
    // the outputs that were on come back on when the app starts
    setTimeout(function () { if (CU.mode() !== "admin") return; if (st.outputs.screen.on) NAT.outputScreen({ on: true, displayId: st.outputs.screen.displayId }).then(function (r) { outStatus.screen = r.on; }); if (st.outputs.ndi.on) NAT.outputNdi({ on: true, name: st.outputs.ndi.name }).then(function (r) { outStatus.ndi = r; }); }, 1500);
  }
  CU.on("tab", function (t) { if (t === "slides") setTimeout(render, 0); if (t === "lyrics") syncLyricsBox(); });
  window.CUSlides = { show: show, goLive: goLive, black: black, setLyricsLive: setLyricsLive, state: function () { return st; }, live: function () { return live; }, slideFor: slideFor, outputsText: outputsText, render: render,
    // (10.2) backgrounds and the screens on the 3D stage
    bgFor: bgFor, setBg: setBg, lyricsSlide: lyricsSlide, lyricsLive: function () { return lyricsLive; }, blank: blank, blanked: function () { return !!blanked; }, openBgPicker: openBgPicker, piOn: function () { return !!st.outputs.pi.on; } };
})();
