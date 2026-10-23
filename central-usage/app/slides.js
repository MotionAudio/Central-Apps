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
  var st = Object.assign({ items: [], outputs: { screen: { on: false, displayId: null }, pi: { on: false }, ndi: { on: false, name: "" } }, lyricsBg: null, lyrics: { size: 7, color: "#ffffff", align: "center", showSection: false } }, CU.store.get("slides", {}));
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
    var bg = s.bgPath ? (VIDEO.test(s.bgPath) ? '<video class="sl-bg" src="' + fileUrl(s.bgPath) + '" muted autoplay loop playsinline></video>' : '<img class="sl-bg" src="' + fileUrl(s.bgPath) + '">') : "";
    return bg + '<div class="sl-text" style="font-size:' + (Number(s.size) || 7) + unit + ";color:" + esc(s.color || "#fff") + ";text-align:" + esc(s.align || "center") + '">' + (s.title ? "<small>" + esc(s.title) + "</small>" : "") + esc(s.text || "") + "</div>";
  }
  function slideFor(it) {
    if (!it) return { kind: "none" };
    if (it.kind === "text") return { kind: "text", text: it.text || "", title: it.title || "", size: it.size || st.lyrics.size, color: it.color || st.lyrics.color, align: it.align || st.lyrics.align, bgPath: it.bg || null, fade: it.fade == null ? 0.45 : it.fade };
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
      if (slide.bgPath) msg.bgFile = await upload(slide.bgPath);
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
  // the lyrics, as the Central Pedal moves through the song
  function lyricsSlide() {
    var d = CU.state.display, ls = d && d.lyrics || {}, lines = ls.lines || [];
    return { kind: "lyrics", text: lines.join("\n"), title: st.lyrics.showSection ? (ls.section || (d && d.section ? d.section.name : "")) : "", size: st.lyrics.size, color: st.lyrics.color, align: st.lyrics.align, bgPath: st.lyricsBg, fade: 0.3 };
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
    el.innerHTML = '<div class="sl-screen">' + slideHtml(s) + "</div>" +
      (it.kind === "text" ? '<label>Title (small, above)<input data-sli="title" value="' + esc(it.title || "") + '"></label><label>Text<textarea data-sli="text" rows="4">' + esc(it.text || "") + "</textarea></label>" +
        '<div class="row"><label>Size <input type="range" min="3" max="14" step="0.5" data-sli="size" value="' + (it.size || st.lyrics.size) + '"></label><label>Colour <input type="color" data-sli="color" value="' + esc(it.color || st.lyrics.color) + '"></label><label>Align <select data-sli="align">' + ["center", "left", "right"].map(function (a) { return '<option' + ((it.align || st.lyrics.align) === a ? " selected" : "") + ">" + a + "</option>"; }).join("") + '</select></label><label>Background <select data-sli="bg"><option value="">none</option>' + st.items.filter(function (x) { return x.kind !== "text"; }).map(function (x) { return '<option value="' + esc(x.path) + '"' + (x.path === it.bg ? " selected" : "") + ">" + esc(x.name) + "</option>"; }).join("") + "</select></label></div>"
        : '<div class="row"><label>Fit <select data-sli="fit"><option value="contain"' + (it.fit !== "cover" ? " selected" : "") + '>Whole picture</option><option value="cover"' + (it.fit === "cover" ? " selected" : "") + ">Fill the screen</option></select></label>" + (it.kind === "video" ? '<label class="toggle"><input type="checkbox" data-sli="loop"' + (it.loop !== false ? " checked" : "") + '> Loop</label><label class="toggle"><input type="checkbox" data-sli="sound"' + (it.muted === false ? " checked" : "") + "> Sound</label>" : "") + "</div>") +
      '<div class="row"><label>Fade (s) <input type="number" min="0" max="5" step="0.1" data-sli="fade" value="' + (it.fade == null ? 0.45 : it.fade) + '" style="width:70px"></label><button class="primary" data-sl-go="' + it.id + '">▶ Go live</button></div>';
  }
  function renderLive() { var el = $("#slLive"); if (!el) return; el.innerHTML = '<div class="sl-screen live">' + slideHtml(live.slide) + '</div><p class="muted small">' + (live.id === "lyrics" ? "Lyrics (following the Central Pedal)" : live.id ? esc((item(live.id) || {}).name || "Text slide") : live.slide && live.slide.kind === "black" ? "Black" : "Nothing yet") + "</p>"; }
  function renderLook() {
    var el = $("#slLook"); if (!el) return; var l = st.lyrics;
    el.innerHTML = '<h3>Lyrics look</h3><div class="row"><label>Size <input type="range" min="3" max="14" step="0.5" data-sll="size" value="' + l.size + '"></label><label>Colour <input type="color" data-sll="color" value="' + esc(l.color) + '"></label><label>Align <select data-sll="align">' + ["center", "left", "right"].map(function (a) { return '<option' + (l.align === a ? " selected" : "") + ">" + a + "</option>"; }).join("") + '</select></label><label class="toggle"><input type="checkbox" data-sll="showSection"' + (l.showSection ? " checked" : "") + '> Section name</label><label>Background <select data-sll="bg"><option value="">none (black)</option>' + st.items.filter(function (x) { return x.kind !== "text"; }).map(function (x) { return '<option value="' + esc(x.path) + '"' + (x.path === st.lyricsBg ? " selected" : "") + ">" + esc(x.name) + "</option>"; }).join("") + "</select></label></div>";
  }
  function render() {
    var root = $("#slidesRoot"); if (!root || !visible()) return;
    if (!root.querySelector("#slHead")) root.innerHTML = '<div class="card" id="slHead"></div><div class="sl-grid"><div class="card sl-listcard"><div class="row"><button data-sl="add" class="primary">+ Pictures / videos</button><button data-sl="text">+ Text slide</button></div><div class="sl-list" id="slList"></div></div><div class="card"><h3>Preview</h3><div id="slPreview"></div></div><div class="card"><h3>Live</h3><div id="slLive"></div></div></div><div class="card" id="slLook"></div>' + (NAT ? "" : '<p class="muted">Second screen and NDI work in the Central Control app.</p>');
    renderHead(); renderList(); renderPreview(); renderLive(); renderLook();
  }
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
    if (t.dataset.sli && it) { var k = t.dataset.sli, v = t.type === "checkbox" ? t.checked : t.type === "range" || t.type === "number" ? Number(t.value) : t.value; if (k === "sound") it.muted = !v; else it[k] = v; save(); if (e.type === "change" || k === "text" || k === "title") { var scr = $("#slPreview .sl-screen"); if (scr) scr.innerHTML = slideHtml(slideFor(it)); } if (e.type === "change" && k !== "text" && k !== "title") renderPreview(); if (live.id === it.id) show(slideFor(it), it.id); if (k === "title" || k === "text") { var nm = document.querySelector('.sl-item[data-id="' + it.id + '"] .sl-tht > span'); if (nm) nm.textContent = ((it.title ? it.title + " · " : "") + (it.text || "Text")).slice(0, 80); } return; }
    if (t.dataset.sll) { var kk = t.dataset.sll; if (kk === "bg") st.lyricsBg = t.value || null; else st.lyrics[kk] = t.type === "checkbox" ? t.checked : t.type === "range" ? Number(t.value) : t.value; save(); pushLyrics(true); return; }
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
  window.CUSlides = { show: show, goLive: goLive, black: black, setLyricsLive: setLyricsLive, state: function () { return st; }, live: function () { return live; }, slideFor: slideFor, outputsText: outputsText, render: render };
})();
