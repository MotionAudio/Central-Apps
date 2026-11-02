/* Central Control - the Slides tab (admin): decks of designed slides, Scripture in seconds, and the lyrics, for the screens.
 *
 *   Show     pick a deck, click a slide to preview it, double-click (or Go live) to show it; Next / Previous, arrow keys;
 *            a deck can play by itself (an announcement loop). Preview and Live sit side by side.
 *   Design   a slide designer: text boxes, pictures, videos, shapes, a background; themes (master styles), layers,
 *            alignment guides and snapping, entrances, transitions, lower thirds for the stream. Import pictures, PDFs
 *            and PowerPoint (.pptx); export a deck as a PDF or pictures.
 *   Scripture type "John 3:16" or some words: slides (and a lower third) in seconds, from the bundled public-domain
 *            Bibles (scripture.js).
 * Outputs (any or all): this computer's second screen, the Central Pedal's HDMI 2 (set to "Slides" there), NDI on the
 * network, and the Video tab (Main / Stream: full screen or over the camera). "Lyrics follow the Central Pedal" puts the
 * current lyrics up by themselves.
 * Decks belong to the church: the hub (center.js "slides") shares them with every admin computer; a deck can be tied to an
 * item of a service's run sheet (deck.runItem), and comes up by itself when the service reaches it. */
(function () {
  "use strict";
  var CU = window.CentralUsage, NAT = window.CU && window.CU.slides, R = window.CUSlideRender, M = window.CUSlideMedia, SC = window.CUScripture; if (!CU || !R) return;
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function uid() { return R.uid(); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function fileUrl(p) { return /^(https?|file|data|blob):/.test(p) ? p : "file://" + encodeURI(p).replace(/#/g, "%23").replace(/\?/g, "%3F"); }
  var VIDEO = /\.(mp4|webm|mov|m4v|ogv)$/i;
  var BG = window.CUBackgrounds;   // (10.2) the lyric backgrounds (backgrounds.js)
  var DECK_KINDS = [["sermon", "Sermon notes"], ["announcements", "Announcements"], ["welcome", "Welcome loop"], ["offering", "Offering"], ["scripture", "Scripture"], ["lower", "Lower thirds"], ["custom", "Other"]];
  var SIZES = [["16:9", 1920, 1080], ["4:3", 1440, 1080], ["16:10", 1920, 1200], ["Ultra-wide 21:9", 2520, 1080], ["Portrait 9:16", 1080, 1920]];
  var TRANS = [["fade", "Fade"], ["slide", "Slide"], ["zoom", "Zoom"], ["cut", "Cut"]];
  var ENTR = [["none", "None"], ["fade", "Fade in"], ["rise", "Rise"], ["slide", "Slide in"], ["zoom", "Zoom in"]];
  var ROLES = [["title", "Title"], ["body", "Words"], ["sub", "Small line"], ["ref", "Reference"], ["lower", "Lower third name"]];

  // ---------------------------------------------------------------- state (this computer's copy; the hub shares it)
  var st = Object.assign({ version: 2, decks: [], activeDeck: null, mode: "show", themes: [], outputs: { screen: { on: false, displayId: null }, pi: { on: false }, ndi: { on: false, name: "" } }, lyricsBg: null, songBg: {}, bgFade: 1, bgFiles: [], lyrics: { size: 7, color: "#ffffff", align: "center", showSection: false },
    scripture: { translation: "kjv", theme: "scripture", maxChars: 260, verseNumbers: true, lower: true } }, CU.store.get("slides", {}));
  if (Array.isArray(st.items)) migrateV1();
  if (!st.songBg || typeof st.songBg !== "object") st.songBg = {}; if (st.bgFade == null) st.bgFade = 1; if (!Array.isArray(st.bgFiles)) st.bgFiles = [];
  st.scripture = Object.assign({ translation: "kjv", theme: "scripture", maxChars: 260, verseNumbers: true, lower: true }, st.scripture || {});
  R.setUserThemes(st.themes);
  var live = { id: null, slide: null, deckId: null }, previewId = null, outStatus = { screen: false, ndi: { on: false } }, screens = [], uploaded = {}, lyricsLive = false, lastLyricsKey = null;
  var sel = [], hist = { undo: [], redo: [] }, snapOn = CU.store.get("slSnap", true), showFns = [], advTimer = 0, pushTimers = {};
  function save() { var o = Object.assign({}, st); delete o.items; CU.store.set("slides", o); }
  function visible() { return CU.prefs.tab === "slides"; }
  function deck(id) { return st.decks.filter(function (d) { return d.id === (id || st.activeDeck); })[0] || null; }
  function slideOf(d, id) { return d ? d.slides.filter(function (s) { return s.id === id; })[0] || null : null; }
  function el(id) { var s = curSlide(); return s ? s.els.filter(function (e) { return e.id === id; })[0] || null : null; }
  function curSlide() { return slideOf(deck(), previewId); }
  function touch(d) { d = d || deck(); if (!d) return; d.updatedAt = Date.now(); save(); pushDeck(d); }
  function migrateV1() {   // (before 10.2: one flat list of pictures, videos and text slides)
    var d = R.newDeck({ name: "My slides", kind: "custom" });
    if (!Array.isArray(st.bgFiles)) st.bgFiles = [];
    st.items.forEach(function (it) { if ((it.kind === "image" || it.kind === "video") && it.path && !st.bgFiles.some(function (x) { return x.path === it.path; })) st.bgFiles.push({ path: it.path, name: it.name || "", kind: it.kind }); });   // (10.2: they stay choices for the lyrics' background)
    st.items.forEach(function (it) {
      var s = { id: it.id || uid(), kind: "design", name: it.name || it.title || "", bg: { type: "theme" }, els: [], advance: null, notes: "" };
      if (it.kind === "image" || it.kind === "video") { var mid = M ? M.addPath(it.path, it.name) : "path:" + it.path; s.bg = { type: "color", color: "#000000" }; s.els.push({ id: uid(), type: it.kind, x: 0, y: 0, w: 1920, h: 1080, rot: 0, opacity: 1, media: mid, fit: it.fit || "contain", loop: it.loop !== false, muted: it.muted !== false, in: { type: "none" } }); }
      else { if (it.title) s.els.push(R.textEl(d, "ref", it.title, { y: 230, h: 80 })); s.els.push(R.textEl(d, "body", it.text || "", { y: 330, h: 500, text: { color: it.color || null, align: it.align || null } })); }
      d.slides.push(s);
    });
    delete st.items; if (d.slides.length) { st.decks.push(d); st.activeDeck = d.id; } save();
  }

  // ---------------------------------------------------------------- undo / redo (per deck, snapshots)
  function snap() { var d = deck(); if (!d) return; var json = JSON.stringify(d), top = hist.undo[hist.undo.length - 1]; if (top && top.id === d.id && top.json === json) return false; hist.undo.push({ id: d.id, json: json }); if (hist.undo.length > 80) hist.undo.shift(); hist.redo = []; return true; }
  function restore(from, to) {
    var h = from.pop(); if (!h) return; var i = st.decks.findIndex(function (x) { return x.id === h.id; }); if (i < 0) return;
    to.push({ id: h.id, json: JSON.stringify(st.decks[i]) }); st.decks[i] = JSON.parse(h.json); st.activeDeck = h.id;
    if (!slideOf(st.decks[i], previewId)) previewId = st.decks[i].slides[0] ? st.decks[i].slides[0].id : null; sel = sel.filter(function (id) { return el(id); });
    touch(st.decks[i]); renderAll();
  }

  // ---------------------------------------------------------------- the hub: decks shared between the church's computers
  function hub() { return window.CUCenter && window.CUCenter.connected && window.CUCenter.connected() && CU.mode() === "admin" ? window.CUCenter : null; }
  function pushDeck(d) {
    clearTimeout(pushTimers[d.id]);
    pushTimers[d.id] = setTimeout(function () { var H = hub(); if (!H) return; H.send({ type: "slides", action: "put", deck: d }); if (M) M.share(allMedia(d)); }, 700);
  }
  function allMedia(d) { var ids = []; d.slides.forEach(function (s) { ids = ids.concat(R.mediaIds(s)); }); return ids.filter(function (x, i) { return ids.indexOf(x) === i; }); }
  function onDecks(m) {
    var changed = false;
    if (m.removed) Object.keys(m.removed).forEach(function (id) { var d = deck(id); if (d && (Number(d.updatedAt) || 0) <= m.removed[id]) { st.decks = st.decks.filter(function (x) { return x.id !== id; }); changed = true; } });
    (m.decks || []).forEach(function (rd) {
      var i = st.decks.findIndex(function (x) { return x.id === rd.id; });
      if (i < 0) { st.decks.push(rd); changed = true; } else if ((Number(rd.updatedAt) || 0) > (Number(st.decks[i].updatedAt) || 0)) { st.decks[i] = rd; changed = true; }
      if (M) M.fetchMissing(allMedia(rd));
    });
    if (m.themes) { st.themes = m.themes; R.setUserThemes(st.themes); changed = true; }
    if (m.full) {   // what this computer has that the hub doesn't (made while apart): send it
      var have = {}; (m.decks || []).forEach(function (x) { have[x.id] = 1; });
      st.decks.forEach(function (d) { if (!have[d.id] && !(m.removed && m.removed[d.id])) pushDeck(d); });
    }
    if (!deck() && st.decks[0]) st.activeDeck = st.decks[0].id;
    if (changed) { save(); if (visible()) renderAll(); }
  }
  CU.on("message", function (m) {
    if (!m) return;
    if (m.type === "display") pushLyrics(false);
    else if (m.type === "slidesDecks") onDecks(m);
    else if (m.type === "slidesMedia" && M) M.fromHub(m);
    else if (m.type === "services") onService(m);
  });
  CU.on("center", function (on) { if (on && hub()) hub().send({ type: "slides", action: "get" }); });
  setTimeout(function () { if (hub()) hub().send({ type: "slides", action: "get" }); }, 2500);
  if (M) M.onReady(function () { if (visible()) { paintAll(); } });

  // ---------------------------------------------------------------- the run sheet: a deck tied to an item comes up by itself
  var lastRunItem = null, services = [];
  function runItems() { var out = []; services.forEach(function (sv) { (sv.items || []).forEach(function (it) { out.push({ id: it.id, label: sv.name + " · " + it.title, item: it }); }); }); return out; }
  function onService(m) {
    services = m.services || services;
    var run = m.run; if (!run) { lastRunItem = null; return; }
    var sv = services.filter(function (s) { return s.id === run.service; })[0], it = sv && sv.items[run.item]; if (!it || it.id === lastRunItem) return; lastRunItem = it.id;
    var d = st.decks.filter(function (x) { return x.runItem === it.id; })[0];
    if (d) { st.activeDeck = d.id; previewId = d.slides[0] ? d.slides[0].id : null; save(); if (visible()) renderAll(); return; }
    if (SC && it.note && SC.parse(it.note).refs.length) { var box = $("#slScrRef"); if (box) { box.value = it.note; scriptureFind(); } }   // a reading in the item's note: ready in the Scripture box
  }

  // ---------------------------------------------------------------- legacy slides (lyrics), and going live
  function slideHtml(s, unit) {
    unit = unit || "cqh";
    if (!s || s.kind === "none" || s.kind === "black" || s.kind === "design") return "";
    return bgHtml(s.bgPath) + '<div class="sl-text" style="font-size:' + (Number(s.size) || 7) + unit + ";color:" + esc(s.color || "#fff") + ";text-align:" + esc(s.align || "center") + '">' + (s.title ? "<small>" + esc(s.title) + "</small>" : "") + esc(s.text || "") + "</div>";
  }
  // (10.2) a background in a preview box: a picture, a video, or one of ours (a canvas, started by setHtml)
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
  function bgName(p) { if (!p) return "None (black)"; if (BG && BG.isBg(p)) return BG.nameOf(p) || "Background"; var it = st.bgFiles.filter(function (x) { return x.path === p; })[0]; return it ? it.name : String(p).split(/[\\/]/).pop(); }
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
    save(); pushLyrics(true); renderBgPicker(); if (visible()) renderLook(); CU.fire("lyricsBg", bgFor());
  }
  // a designed slide as the output gets it: the slide, the deck's size and theme, where each picture is, the transition
  async function designMsg(d, s) {
    var th = R.theme(d.theme), assets = {}, ids = R.mediaIds(s);
    if (M) for (var i = 0; i < ids.length; i++) { var u = await M.dataUrl(ids[i]); if (u) assets[ids[i]] = u; }
    var tr = s.transition && s.transition.type ? s.transition : d.transition || { type: "fade", dur: 0.5 };
    return { kind: "design", design: s, deck: { size: d.size, theme: th }, assets: assets, transition: tr, fade: tr.dur, transparent: R.isTransparent(s), name: s.name || "" };
  }
  // the Central Pedal's HDMI 2 shows pictures and text: a designed slide goes there as a picture of it
  async function toPi(slide, d, s) {
    if (!st.outputs.pi.on || !CU.state.connected) return;
    var code = CU.prefs.code; if (!code) { CU.askCode(); return; }
    var msg = { type: "slide", code: code, kind: slide.kind, fit: slide.fit, loop: slide.loop, muted: slide.muted, text: slide.text, title: slide.title, size: slide.size, color: slide.color, align: slide.align };
    async function upload(name, data) {
      var r = await fetch(CU.api("/slides?code=" + encodeURIComponent(code) + "&name=" + encodeURIComponent(name)), { method: "POST", body: data }); var j = await r.json(); if (!r.ok) throw new Error(j.error || r.status); return j.file;
    }
    try {
      if (slide.kind === "design" && d && s) {
        var key = JSON.stringify([s, d.size, d.theme]); if (!uploaded[key]) { var blob = await toBlob(d, s, 1920, Math.round(1920 * d.size.h / d.size.w), "image/png"); uploaded[key] = await upload("slide-" + s.id + "-" + (Date.now() % 1e6) + ".png", blob); }
        msg = { type: "slide", code: code, kind: "image", fit: "contain", file: uploaded[key] };
      } else if (slide.bgPath && NAT && !(BG && BG.isBg(slide.bgPath))) {
        if (!uploaded[slide.bgPath]) uploaded[slide.bgPath] = await upload(slide.bgPath.split(/[\\/]/).pop().replace(/[^\w.\- ]+/g, "_"), await NAT.readFile(slide.bgPath));
        msg.bgFile = uploaded[slide.bgPath];
      }
    } catch (e) { setInfo("Could not send it to the Central Pedal: " + e.message); return; }
    CU.send(msg);
  }
  function show(slide, id, d, s) {
    live = { id: id || null, slide: slide, deckId: d ? d.id : null };
    if (NAT) NAT.show(slide);
    toPi(slide, d, s);
    showFns.forEach(function (f) { try { f(slide, id); } catch (_) { } });
    paintLive(); markLists(); scheduleAdvance();
  }
  async function goLiveSlide(deckId, slideId) {
    var d = deck(deckId), s = slideOf(d, slideId); if (!s) return;
    lyricsLive = false; syncLyricsBox(); previewId = s.id; st.activeDeck = d.id;
    show(await designMsg(d, s), s.id, d, s);
    if (visible() && st.mode === "show") { markLists(); paintPreview(); }
  }
  function goLive(id) { var d = deck(); if (slideOf(d, id)) return goLiveSlide(d.id, id); }
  function black() { lyricsLive = false; syncLyricsBox(); show({ kind: "black" }, null); }
  // (10.2) blank the screens (Stream Deck / MIDI): black on every output, then back to what was up
  var blanked = null;
  function blank(on) {
    if (on == null) on = !blanked;
    if (on && !blanked) { blanked = { live: live, lyrics: lyricsLive }; lyricsLive = false; syncLyricsBox(); show({ kind: "black", fade: 0.6 }, null); }
    else if (!on && blanked) { var b = blanked; blanked = null; if (b.lyrics) setLyricsLive(true); else if (b.live && b.live.slide) show(b.live.slide, b.live.id); else show({ kind: "black" }, null); }
    paintLive(); CU.fire("screensBlank", !!blanked); return !!blanked;
  }
  function clearLower() { show({ kind: "none", transparent: true }, null); }
  function step(dir) {
    var d = deck(live.deckId) || deck(); if (!d || !d.slides.length) return;
    var i = d.slides.findIndex(function (s) { return s.id === (live.deckId === d.id ? live.id : previewId); });
    var n = i + dir; if (n >= d.slides.length) { if (d.loop && d.loop.on) n = 0; else return; } if (n < 0) n = d.loop && d.loop.on ? d.slides.length - 1 : 0;
    goLiveSlide(d.id, d.slides[n].id);
  }
  // a deck that plays by itself (an announcement loop), or a slide with its own time on screen
  function scheduleAdvance() {
    clearTimeout(advTimer);
    var d = deck(live.deckId), s = d && slideOf(d, live.id); if (!s) return;
    var secs = s.advance > 0 ? s.advance : d.loop && d.loop.on ? d.loop.seconds || 8 : 0; if (!secs) return;
    advTimer = setTimeout(function () { if (live.id === s.id) step(1); }, secs * 1000);
  }
  // the lyrics, as the Central Pedal moves through the song
  function lyricsSlide() {
    var dsp = CU.state.display, ls = dsp && dsp.lyrics || {}, lines = ls.lines || [];
    return { kind: "lyrics", text: lines.join("\n"), title: st.lyrics.showSection ? (ls.section || (dsp && dsp.section ? dsp.section.name : "")) : "", size: st.lyrics.size, color: st.lyrics.color, align: st.lyrics.align, bgPath: bgFor(), bgFade: st.bgFade, fade: 0.3,
      credit: lines.length && dsp && dsp.credit ? dsp.credit : null };   // (10.2: the CCLI copyright line, worked out by the player)
  }
  function pushLyrics(force) {
    if (!lyricsLive) return; var s = lyricsSlide(), key = JSON.stringify(s);
    if (!force && key === lastLyricsKey) return; lastLyricsKey = key; show(s, "lyrics");
    // (10.2) the words went up on the screens: noted for the CCLI report (once per song and day)
    var d = CU.state.display; if (s.text && d && d.song && window.PPCcli && (outStatus.screen || outStatus.ndi && outStatus.ndi.on || st.outputs.pi.on)) window.PPCcli.log({ title: d.song.name, ccli: d.song.ccli, author: d.song.author, copyright: d.song.copyright }, "display", { device: CU.appName });
  }
  function setLyricsLive(on) { lyricsLive = !!on; lastLyricsKey = null; if (on) pushLyrics(true); syncLyricsBox(); renderHead(); }
  function syncLyricsBox() { var b = $("#lyricsLive"); if (b) b.checked = lyricsLive; var i = $("#lyricsOutInfo"); if (i) i.textContent = outputsText(); }
  function outputsText() { var o = []; if (outStatus.screen) o.push("second screen"); if (st.outputs.pi.on) o.push("Central Pedal HDMI 2"); if (outStatus.ndi && outStatus.ndi.on) o.push("NDI"); return o.length ? "→ " + o.join(" · ") : "no output is on (Slides tab)"; }

  // ---------------------------------------------------------------- drawing slides into canvases
  function mediaFor(id, kind) { return M ? M.drawable(id, kind) : null; }
  function paint(canvas, d, s, opts) {
    if (!canvas) return; opts = opts || {};
    var ctx = canvas.getContext("2d"); if (!s) { ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = "#000"; ctx.fillRect(0, 0, canvas.width, canvas.height); return; }
    if (R.isTransparent(s) && !opts.raw) { checker(ctx, canvas.width, canvas.height); var tmp = document.createElement("canvas"); tmp.width = canvas.width; tmp.height = canvas.height; R.render(tmp.getContext("2d"), s, d, Object.assign({ media: mediaFor, transparent: true }, opts)); ctx.drawImage(tmp, 0, 0); return; }
    R.render(ctx, s, d, Object.assign({ media: mediaFor }, opts));
  }
  function checker(ctx, w, h) { var k = Math.max(6, Math.round(w / 40)); ctx.fillStyle = "#2a2d33"; ctx.fillRect(0, 0, w, h); ctx.fillStyle = "#3a3e46"; for (var y = 0; y < h; y += k) for (var x = (y / k) % 2 ? k : 0; x < w; x += 2 * k) ctx.fillRect(x, y, k, k); }
  function sizeCanvas(c, d, cssW) { var dpr = Math.min(2, window.devicePixelRatio || 1), w = Math.max(40, Math.round(cssW * dpr)), h = Math.round(w * d.size.h / d.size.w); if (c.width !== w || c.height !== h) { c.width = w; c.height = h; } }
  function paintThumbs() {   // (each canvas remembers what it last drew, so an unchanged thumbnail isn't drawn again)
    var d = deck(); if (!d) return;
    $$("canvas[data-th]").forEach(function (c) { var s = slideOf(d, c.dataset.th); if (!s) return; sizeCanvas(c, d, c.clientWidth || 160); var key = JSON.stringify(s) + d.theme + c.width + "x" + c.height; if (c._key === key && !R.mediaIds(s).length) return; c._key = key; paint(c, d, s, { placeholders: true }); });
  }
  var loops = {};
  function animate(name, canvas, d, s) {   // Preview / Live keep drawing a slide that moves
    cancelAnimationFrame(loops[name]); var t0 = performance.now();
    (function frame() { if (!canvas.isConnected) return; var t = (performance.now() - t0) / 1000; paint(canvas, d, s, { time: t, clock: t }); if (R.animated(s, t)) loops[name] = requestAnimationFrame(frame); })();
  }
  function paintPreview() { var c = $("#slPrevCanvas"), d = deck(), s = curSlide(); if (!c || !d) return; sizeCanvas(c, d, c.clientWidth || 400); animate("prev", c, d, s); var n = $("#slPrevName"); if (n) n.textContent = s ? (d.slides.indexOf(s) + 1) + ". " + (s.name || slideTitle(s)) : "Click a slide to see it here"; }
  function paintLive() {
    var host = $("#slLiveBox"); if (!host) return; var s = live.slide, n = $("#slLiveName");
    if (s && s.kind === "design") { host.innerHTML = '<canvas id="slLiveCanvas"></canvas>'; var c = $("#slLiveCanvas"), dd = { size: s.deck.size, theme: s.deck.theme }; sizeCanvas(c, dd, host.clientWidth || 400); animate("live", c, dd, s.design); }
    else setHtml(host, '<div class="sl-screen live">' + slideHtml(s) + "</div>");
    if (n) n.textContent = live.id === "lyrics" ? "Lyrics (following the Central Pedal)" : s && s.kind === "design" ? (s.name || slideTitle(s.design)) + (s.transparent ? " · lower third" : "") : s && s.kind === "black" ? "Black" : s && s.kind === "none" ? "Nothing (cleared)" : "Nothing yet";
  }
  function slideTitle(s) { var t = (s.els || []).filter(function (e) { return e.type === "text" && e.text && e.text.value; })[0]; return t ? String(t.text.value).split("\n")[0].slice(0, 40) : s.kind === "lower" ? "Lower third" : (s.els || []).some(function (e) { return e.type === "image"; }) ? "Picture" : (s.els || []).some(function (e) { return e.type === "video"; }) ? "Video" : "Slide"; }
  // a slide as a picture (the Central Pedal, PDF and picture export): waits for its pictures to load first
  async function toBlob(d, s, w, h, type) {
    var ids = R.mediaIds(s), els = {};
    if (M) await Promise.all(ids.map(async function (id) {
      var u = await M.url(id); if (!u) return;
      await new Promise(function (res) {
        var isV = /^path:.*\.(mp4|webm|mov|m4v|ogv)$/i.test(id) || (s.els.concat([{ media: s.bg && s.bg.media, type: s.bg && s.bg.type }]).some(function (e) { return e.media === id && e.type === "video"; }));
        var e = isV ? document.createElement("video") : new Image(); e.onerror = function () { res(); };
        if (isV) { e.muted = true; e.preload = "auto"; e.addEventListener("loadeddata", function () { els[id] = e; res(); }, { once: true }); } else e.onload = function () { els[id] = e; res(); };
        e.src = u; setTimeout(res, 8000);
      });
    }));
    var c = document.createElement("canvas"); c.width = w; c.height = h;
    R.render(c.getContext("2d"), s, d, { media: function (id) { return els[id] || null; }, transparent: R.isTransparent(s) && type === "image/png" });
    return await new Promise(function (res) { c.toBlob(function (b) { res(b); }, type || "image/png", 0.9); });
  }

  // ---------------------------------------------------------------- the page
  var infoText = "";
  function setInfo(t) { infoText = t; var e = $("#slInfo"); if (e) e.textContent = t; }
  function renderHead() {
    var e = $("#slHead"); if (!e) return; var o = st.outputs;
    e.innerHTML = '<div class="sl-outs"><b>Outputs</b>' +
      '<label class="toggle"><input type="checkbox" data-sl-out="screen"' + (outStatus.screen ? " checked" : "") + (NAT ? "" : " disabled") + '> Second screen</label><select data-sl="display">' + screens.map(function (dd) { return '<option value="' + dd.id + '"' + (String(dd.id) === String(o.screen.displayId) ? " selected" : "") + ">" + esc(dd.label) + " · " + dd.size.width + "×" + dd.size.height + (dd.primary ? " (this one)" : "") + "</option>"; }).join("") + "</select>" +
      '<label class="toggle" title="Set the Central Pedal\'s HDMI 2 to show Slides (its I/O tab)"><input type="checkbox" data-sl-out="pi"' + (o.pi.on ? " checked" : "") + "> Central Pedal HDMI 2</label>" +
      '<label class="toggle"><input type="checkbox" data-sl-out="ndi"' + (outStatus.ndi && outStatus.ndi.on ? " checked" : "") + (NAT ? "" : " disabled") + '> NDI</label><span class="muted small">' + esc(outStatus.ndi && outStatus.ndi.error ? "⚠ " + outStatus.ndi.error : outStatus.ndi && outStatus.ndi.on ? "on the network as \"" + (outStatus.ndi.name || "Central Control") + "\"" + (outStatus.ndi.receivers ? " · " + outStatus.ndi.receivers + " watching" : "") : "") + "</span></div>" +
      '<div class="sl-ctl"><div class="sl-seg" role="tablist"><button data-sl-mode="show" class="' + (st.mode === "show" ? "on" : "") + '">Show</button><button data-sl-mode="design" class="' + (st.mode === "design" ? "on" : "") + '">Design</button></div>' +
      '<button data-sl="black" class="danger">Black</button><button data-sl="clearLower" title="Take a lower third off">Clear</button><label class="toggle sl-lyr"><input type="checkbox" data-sl="lyrics"' + (lyricsLive ? " checked" : "") + '> Lyrics follow the Central Pedal</label><span class="muted small" id="slInfo">' + esc(infoText) + "</span></div>";
  }
  function renderDecks() {
    var e = $("#slDecks"); if (!e) return;
    e.innerHTML = '<div class="sl-dk-head"><b>Decks</b><span class="sl-dk-btns"><select data-sl="newDeck" title="New deck"><option value="">+ New deck…</option>' + DECK_KINDS.map(function (k) { return '<option value="' + k[0] + '">' + k[1] + "</option>"; }).join("") + "</select></span></div>" +
      (st.decks.length ? '<div class="sl-dk-list">' + st.decks.map(function (d) { return '<button class="sl-dk' + (d.id === st.activeDeck ? " on" : "") + (d.id === live.deckId ? " live" : "") + '" data-deck="' + d.id + '"><span>' + esc(d.name) + '</span><small>' + d.slides.length + " · " + esc((DECK_KINDS.filter(function (k) { return k[0] === d.kind; })[0] || ["", "Other"])[1]) + (d.runItem ? " · run sheet" : "") + (d.loop && d.loop.on ? " · loops" : "") + "</small></button>"; }).join("") + "</div>" : '<p class="muted small">No decks yet. Make one with + New deck, or type a Bible reference below.</p>');
  }
  function renderStrip() {
    var e = $("#slStrip"); if (!e) return; var d = deck();
    if (!d) { e.innerHTML = ""; return; }
    var where = st.mode;
    e.innerHTML = '<div class="sl-st-head"><b>' + esc(d.name) + '</b><span><select data-sl="addSlide"><option value="">+ Slide…</option>' + R.TEMPLATES.map(function (t) { return '<option value="' + t.id + '">' + esc(t.name) + "</option>"; }).join("") + '<option value="lower">Lower third</option></select>' +
      '<select data-sl="importExport"><option value="">Import / export…</option><option value="pics">Add pictures or videos</option><option value="pdf">Import a PDF</option><option value="pptx">Import PowerPoint (.pptx)</option><option value="exportPdf">Export as PDF</option><option value="exportPng">Export as pictures (.zip)</option></select></span></div>' +
      '<div class="sl-thumbs ' + where + '">' + (d.slides.length ? d.slides.map(function (s, k) {
        return '<div class="sl-tile" data-slide="' + s.id + '" draggable="true"><canvas data-th="' + s.id + '" data-where="' + where + '"></canvas><span class="sl-tn">' + (k + 1) + ". " + esc(s.name || slideTitle(s)) + (s.kind === "lower" ? " · lower third" : "") + (s.advance > 0 ? " · " + s.advance + " s" : "") + '</span><span class="sl-tb"><button data-sl-go="' + s.id + '" title="Go live">▶</button><button data-sl-dup="' + s.id + '" title="Duplicate">⧉</button><button data-sl-del="' + s.id + '" title="Delete">✕</button></span></div>';
      }).join("") : '<p class="muted small">This deck is empty. Add a slide with + Slide.</p>') + "</div>";
    markLists(); requestAnimationFrame(paintThumbs);
  }
  function markLists() {
    $$(".sl-tile").forEach(function (t) { t.classList.toggle("sel", t.dataset.slide === previewId); t.classList.toggle("live", t.dataset.slide === live.id); });
    $$(".sl-dk").forEach(function (t) { t.classList.toggle("live", t.dataset.deck === live.deckId); });
  }
  function renderShow() {
    var e = $("#slMain"); if (!e) return; var d = deck();
    e.innerHTML = '<div class="sl-pl"><div class="card sl-pv"><div class="sl-pl-h"><b>Preview</b><span class="muted small" id="slPrevName"></span></div><div class="sl-cv"><canvas id="slPrevCanvas"></canvas></div>' +
      '<div class="row"><button data-sl="prev" title="Previous (←)">◀</button><button class="primary" data-sl="goPreview">Go live ▶</button><button data-sl="next" title="Next (→ or space)">▶▶</button>' + (d ? '<label class="toggle" title="Play this deck by itself, over and over"><input type="checkbox" data-sl="loop"' + (d.loop && d.loop.on ? " checked" : "") + '> Plays by itself every <input type="number" min="2" max="600" step="1" data-sl="loopSecs" value="' + ((d.loop && d.loop.seconds) || 8) + '" style="width:62px"> s</label>' : "") + "</div></div>" +
      '<div class="card sl-lv"><div class="sl-pl-h"><b>Live</b><span class="muted small" id="slLiveName"></span></div><div class="sl-cv" id="slLiveBox"></div></div></div>' +
      scriptureHtml() + sermonHtml(d) + '<div class="card" id="slLook"></div>';
    paintPreview(); paintLive(); renderLook(); renderSermon();
  }
  function renderLook() {
    var e = $("#slLook"); if (!e) return; var l = st.lyrics;
    e.innerHTML = '<h3>Lyrics look (Lyrics follow the Central Pedal)</h3><div class="row"><label>Size <input type="range" min="3" max="14" step="0.5" data-sll="size" value="' + l.size + '"></label><label>Colour <input type="color" data-sll="color" value="' + esc(l.color) + '"></label><label>Align <select data-sll="align">' + ["center", "left", "right"].map(function (a) { return '<option' + (l.align === a ? " selected" : "") + ">" + a + "</option>"; }).join("") + '</select></label><label class="toggle"><input type="checkbox" data-sll="showSection"' + (l.showSection ? " checked" : "") + '> Section name</label>' + (NAT ? '<button data-sl="lyricsBg">' + (st.lyricsBg ? "Background: " + esc(st.lyricsBg.split(/[\\/]/).pop()) : "Pick a background…") + "</button>" + (st.lyricsBg ? '<button data-sl="lyricsBgOff">No background</button>' : "") : "") + "</div>";
  }

  // ---------------------------------------------------------------- Scripture in seconds
  var found = null;   // { passage, slides } or { hits }
  function scriptureHtml() {
    if (!SC) return "";
    var o = st.scripture;
    return '<div class="card sl-scr"><h3>Scripture</h3><div class="row sl-scr-row"><input id="slScrRef" placeholder="John 3:16 · Ps 23:1-4 · 1 Cor 13 · or words to search" autocomplete="off"><select data-scr="translation">' + SC.translations().map(function (t) { return '<option value="' + t.id + '"' + (t.id === o.translation ? " selected" : "") + ">" + esc(t.short) + " · " + esc(t.name) + "</option>"; }).join("") + '</select><button data-sl="scrFind" class="primary">Find</button></div>' +
      '<div class="row small"><label>Theme <select data-scr="theme">' + R.themes().map(function (t) { return '<option value="' + t.id + '"' + (t.id === o.theme ? " selected" : "") + ">" + esc(t.name) + "</option>"; }).join("") + '</select></label><label>Words per slide <select data-scr="maxChars">' + [[160, "Fewer (big words)"], [260, "Normal"], [380, "More"]].map(function (x) { return '<option value="' + x[0] + '"' + (+o.maxChars === x[0] ? " selected" : "") + ">" + x[1] + "</option>"; }).join("") + '</select></label><label class="toggle"><input type="checkbox" data-scr="verseNumbers"' + (o.verseNumbers ? " checked" : "") + '> Verse numbers</label><label class="toggle"><input type="checkbox" data-scr="lower"' + (o.lower ? " checked" : "") + "> A lower third too</label></div>" +
      '<div id="slScrOut" class="sl-scr-out"><p class="muted small">Bundled, offline: KJV, WEB, ASV and the Reina-Valera 1909 (all public domain).</p></div></div>';
  }
  async function scriptureFind() {
    var box = $("#slScrRef"), out = $("#slScrOut"); if (!box || !out || !SC) return; var q = box.value.trim(); if (!q) return;
    out.innerHTML = '<p class="muted small">Looking…</p>';
    try {
      var p = SC.parse(q);
      if (p.refs.length && !p.errors.length) {
        var passage = await SC.lookup(q, st.scripture.translation), parts = SC.split(passage, { maxChars: +st.scripture.maxChars, verseNumbers: st.scripture.verseNumbers });
        found = { passage: passage, parts: parts };
        out.innerHTML = '<div class="sl-scr-h"><b>' + esc(passage.label) + " (" + esc(passage.translation) + ")</b> · " + passage.verses.length + " verse" + (passage.verses.length > 1 ? "s" : "") + " · " + parts.length + " slide" + (parts.length > 1 ? "s" : "") +
          '</div><div class="sl-scr-parts">' + parts.slice(0, 40).map(function (x, i) { return '<div class="sl-scr-part"><small>' + (i + 1) + ". " + esc(x.label) + "</small>" + esc(x.text) + "</div>"; }).join("") + (parts.length > 40 ? '<p class="muted small">…and ' + (parts.length - 40) + " more</p>" : "") + "</div>" +
          '<div class="row"><button class="primary" data-sl="scrShow">Show now</button><button data-sl="scrNew">Make a deck</button><button data-sl="scrAdd"' + (deck() ? "" : " disabled") + ">Add to " + esc(deck() ? deck().name : "this deck") + '</button><button data-sl="scrKeep" title="Keep it in this deck\'s list of readings">Save to readings</button></div>';
      } else {
        var hits = await SC.search(q, st.scripture.translation, 30); found = { hits: hits };
        out.innerHTML = hits.length ? '<div class="sl-scr-h"><b>' + hits.length + (hits.length >= 30 ? "+" : "") + " verses with \"" + esc(q) + '"</b> · click one</div><div class="sl-scr-hits">' + hits.map(function (h) { return '<button class="sl-hit" data-ref="' + esc(h.label) + '"><b>' + esc(h.label) + "</b> " + esc(h.text.slice(0, 140)) + "</button>"; }).join("") + "</div>" : '<p class="muted small">Nothing found for "' + esc(q) + '". A reference looks like John 3:16 or Romans 8:28-30.</p>';
      }
    } catch (e) { out.innerHTML = '<p class="err small">' + esc(e.message || e) + "</p>"; }
  }
  // the found passage -> slides (and a lower third), styled by the chosen theme
  function scriptureSlides(d) {
    if (!found || !found.parts) return [];
    var out = found.parts.map(function (x) {
      var s = R.newSlide(d, "verse"); s.name = x.label;
      s.els[0].text.value = x.text; s.els[1].text.value = x.label; s.scripture = x.label; return s;
    });
    if (st.scripture.lower) { var lo = R.newLower(d, found.passage.label, found.passage.translation === "RV1909" ? "Reina-Valera 1909" : (SC.translations().filter(function (t) { return t.short === found.passage.translation; })[0] || {}).name || found.passage.translation); lo.name = found.passage.label + " · lower third"; out.push(lo); }
    return out;
  }
  function scriptureDeck() {
    var name = found.passage.label + " (" + found.passage.translation + ")", d = st.decks.filter(function (x) { return x.kind === "scripture" && x.name === name; })[0];
    if (!d) { d = R.newDeck({ name: name, kind: "scripture", theme: st.scripture.theme }); d.slides = scriptureSlides(d); st.decks.unshift(d); }
    st.activeDeck = d.id; touch(d); return d;
  }
  function sermonHtml(d) { return d ? '<div class="card sl-sermon" id="slSermon"></div>' : ""; }
  function renderSermon() {
    var e = $("#slSermon"), d = deck(); if (!e || !d) return; var list = d.scriptures || [];
    e.innerHTML = '<h3>Readings ready for this deck</h3>' + (list.length ? '<div class="sl-chips">' + list.map(function (r, i) { return '<span class="sl-chip"><button data-read="' + esc(r) + '" title="Find it">' + esc(r) + '</button><button data-unread="' + i + '" title="Remove">✕</button></span>'; }).join("") + "</div>" : '<p class="muted small">Add the sermon\'s readings ahead of time; each is one click from the screen.</p>') +
      '<div class="row"><input id="slReadAdd" placeholder="Add a reading, like Romans 8:28"><button data-sl="readAdd">Add</button></div>';
  }

  // ---------------------------------------------------------------- the designer
  function renderDesign() {
    var e = $("#slMain"), d = deck(); if (!e) return;
    if (!d) { e.innerHTML = '<div class="card"><p class="muted">Make a deck first (+ New deck).</p></div>'; return; }
    if (!curSlide() && d.slides[0]) previewId = d.slides[0].id;
    e.innerHTML = '<div class="sl-ed"><div class="card sl-tools" id="slTools"></div><div class="sl-ed-body"><div class="card sl-stagecard"><div class="sl-stage" id="slStage"><canvas id="slEdCanvas"></canvas><div class="sl-ov" id="slOv" tabindex="0"></div></div><p class="muted small">Drag to move · handles resize · double-click words to type · arrow keys nudge (Shift: 10) · Ctrl+Z / Ctrl+Shift+Z · Delete removes</p></div><div class="card sl-insp" id="slInspect"></div></div></div>';
    renderTools(); layoutStage(); paintEditor(); renderInspector();
  }
  function renderTools() {
    var e = $("#slTools"), d = deck(); if (!e || !d) return; var s = curSlide();
    var sizeVal = SIZES.filter(function (z) { return z[1] === d.size.w && z[2] === d.size.h; })[0];
    e.innerHTML = '<div class="sl-tb-row"><button data-ed="text">+ Text</button><button data-ed="media">+ Picture / video</button><select data-ed="shape"><option value="">+ Shape…</option><option value="rect">Rectangle</option><option value="round">Rounded box</option><option value="ellipse">Circle / oval</option><option value="triangle">Triangle</option><option value="line">Line</option></select>' +
      '<span class="sl-sep"></span><button data-ed="front" title="Bring to front">⤒</button><button data-ed="forward" title="Forward">↑</button><button data-ed="backward" title="Backward">↓</button><button data-ed="back" title="Send to back">⤓</button>' +
      '<span class="sl-sep"></span><button data-ed="al" title="Align left">⇤</button><button data-ed="ac" title="Align centre">↔</button><button data-ed="ar" title="Align right">⇥</button><button data-ed="at" title="Align top">⤒︎</button><button data-ed="am" title="Align middle">↕</button><button data-ed="ab" title="Align bottom">⤓︎</button>' +
      '<span class="sl-sep"></span><button data-ed="dup" title="Duplicate (Ctrl+D)">⧉</button><button data-ed="del" title="Delete">🗑</button><button data-ed="undo" title="Undo (Ctrl+Z)"' + (hist.undo.length ? "" : " disabled") + '>↶</button><button data-ed="redo" title="Redo"' + (hist.redo.length ? "" : " disabled") + ">↷</button>" +
      '<label class="toggle"><input type="checkbox" data-ed="snap"' + (snapOn ? " checked" : "") + "> Snap</label></div>" +
      '<div class="sl-tb-row"><label>Theme <select data-deck-f="theme">' + R.themes().map(function (t) { return '<option value="' + t.id + '"' + (t.id === d.theme ? " selected" : "") + ">" + esc(t.name) + "</option>"; }).join("") + '</select></label><button data-ed="themeCopy" title="Make an editable copy of this theme for the church">Edit theme…</button>' +
      '<label>Size <select data-ed="size">' + SIZES.map(function (z) { return '<option value="' + z[1] + "x" + z[2] + '"' + (sizeVal === z ? " selected" : "") + ">" + z[0] + "</option>"; }).join("") + '<option value="custom"' + (sizeVal ? "" : " selected") + '>Custom…</option></select></label>' + (sizeVal ? "" : '<span class="small">' + d.size.w + "×" + d.size.h + "</span>") +
      (s ? '<button data-sl-go="' + s.id + '" class="primary">Go live ▶</button>' : "") + "</div>";
  }
  var view = { k: 1, W: 0, H: 0 };
  function layoutStage() {
    var stg = $("#slStage"), d = deck(); if (!stg || !d) return;
    var par = stg.parentElement, cs = getComputedStyle(par), w = Math.floor(par.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) || 800;
    var maxH = Math.max(240, window.innerHeight * 0.68); if (w * d.size.h / d.size.w > maxH) w = Math.floor(maxH * d.size.w / d.size.h);   // (a tall deck - portrait - fits the window)
    stg.style.width = w + "px"; stg.style.height = Math.round(w * d.size.h / d.size.w) + "px";
    view.k = w / d.size.w; view.W = w; view.H = Math.round(w * d.size.h / d.size.w);
    var c = $("#slEdCanvas"), dpr = Math.min(2, window.devicePixelRatio || 1); c.width = Math.round(view.W * dpr); c.height = Math.round(view.H * dpr); c.style.width = view.W + "px"; c.style.height = view.H + "px";
  }
  function paintEditor() { var c = $("#slEdCanvas"), d = deck(); if (!c || !d) return; paint(c, d, curSlide(), { placeholders: true }); drawOverlay(); }
  function drawOverlay(guides) {
    var ov = $("#slOv"); if (!ov) return; var k = view.k, h = "";
    sel.forEach(function (id) {
      var e = el(id); if (!e) return; var x = Math.min(e.x, e.x + e.w) * k, y = Math.min(e.y, e.y + e.h) * k, w = Math.abs(e.w) * k, hh = Math.abs(e.h) * k;
      h += '<div class="sl-sel' + (e.locked ? " locked" : "") + '" style="left:' + x + "px;top:" + y + "px;width:" + w + "px;height:" + hh + "px;" + (e.rot ? "transform:rotate(" + e.rot + "deg)" : "") + '">' + (sel.length === 1 && !e.locked ? ["nw", "n", "ne", "e", "se", "s", "sw", "w"].map(function (p) { return '<i class="sl-h ' + p + '" data-handle="' + p + '"></i>'; }).join("") : "") + "</div>";
    });
    (guides || []).forEach(function (g) { h += g.v != null ? '<div class="sl-guide v" style="left:' + g.v * k + 'px"></div>' : '<div class="sl-guide h" style="top:' + g.h * k + 'px"></div>'; });
    ov.innerHTML = h + '<textarea class="sl-inline" id="slInline" hidden></textarea>';
  }
  // ---- the inspector: the selected box, or the slide and the deck
  function fld(label, html) { return '<label class="sl-f"><span>' + label + "</span>" + html + "</label>"; }
  function num(k, v, a) { a = a || {}; return '<input type="number" data-f="' + k + '" value="' + (Math.round((v || 0) * 100) / 100) + '"' + (a.min != null ? ' min="' + a.min + '"' : "") + (a.max != null ? ' max="' + a.max + '"' : "") + (a.step ? ' step="' + a.step + '"' : "") + ">"; }
  function opt(list, v) { return list.map(function (o) { return '<option value="' + o[0] + '"' + (String(o[0]) === String(v) ? " selected" : "") + ">" + o[1] + "</option>"; }).join(""); }
  function color(k, v) { return '<input type="color" data-f="' + k + '" value="' + esc(/^#[0-9a-f]{6}$/i.test(v || "") ? v : "#ffffff") + '">'; }
  function renderInspector() {
    var e = $("#slInspect"), d = deck(), s = curSlide(); if (!e || !d) return;
    var one = sel.length === 1 ? el(sel[0]) : null, th = R.theme(d.theme), h = "";
    if (one) {
      h += "<h3>" + ({ text: "Text box", image: "Picture", video: "Video", shape: "Shape" }[one.type]) + "</h3>";
      if (one.type === "text") {
        var ts = R.textStyle(one, th);
        h += '<textarea data-f="text.value" rows="4" class="sl-tv">' + esc(one.text.value || "") + "</textarea>" +
          '<div class="sl-fs">' + fld("Style", '<select data-f="text.role">' + opt(ROLES, one.text.role || "body") + "</select>") + fld("Font", '<select data-f="text.font">' + R.FONTS.map(function (f) { return '<option' + (f === ts.font ? " selected" : "") + ' style="font-family:\'' + f + '\'">' + f + "</option>"; }).join("") + "</select>") +
          fld("Size", num("text.size", ts.size, { min: 8, max: 400 })) + fld("Weight", '<select data-f="text.weight">' + opt([[300, "Light"], [400, "Regular"], [500, "Medium"], [600, "Semibold"], [700, "Bold"], [800, "Extra bold"], [900, "Black"]], ts.weight) + "</select>") +
          fld("Colour", color("text.color", ts.color)) + fld("Align", '<select data-f="text.align">' + opt([["left", "Left"], ["center", "Centre"], ["right", "Right"]], ts.align) + "</select>") +
          fld("Up / down", '<select data-f="text.valign">' + opt([["top", "Top"], ["middle", "Middle"], ["bottom", "Bottom"]], ts.valign) + "</select>") + fld("Line height", num("text.lineHeight", ts.lineHeight, { min: 0.8, max: 3, step: 0.05 })) +
          fld("Letter spacing", num("text.letter", ts.letter, { min: -10, max: 40, step: 0.5 })) + fld("Outline", color("text.outline.color", ts.outline.color) + num("text.outline.width", ts.outline.width, { min: 0, max: 20 })) +
          fld("Shadow", color("text.shadow.color", /^#/.test(ts.shadow.color) ? ts.shadow.color : "#000000") + num("text.shadow.blur", ts.shadow.blur, { min: 0, max: 60 })) + "</div>" +
          '<div class="row small"><label class="toggle"><input type="checkbox" data-f="text.italic"' + (ts.italic ? " checked" : "") + '> Italic</label><label class="toggle"><input type="checkbox" data-f="text.upper"' + (ts.upper ? " checked" : "") + '> CAPITALS</label><label class="toggle"><input type="checkbox" data-f="text.fit"' + (ts.fit === "shrink" ? " checked" : "") + '> Shrink to fit</label><button data-ed="resetText">Back to the theme\'s look</button></div>';
      } else if (one.type === "image" || one.type === "video") {
        h += '<p class="small">' + esc(M ? M.name(one.media) || "" : "") + (/^path:/.test(one.media || "") ? ' <span class="muted">(stays on this computer)</span>' : "") + '</p><div class="sl-fs">' + fld("Fit", '<select data-f="fit">' + opt([["contain", "Whole picture"], ["cover", "Fill the box"], ["fill", "Stretch"]], one.fit || "contain") + "</select>") + "</div>" +
          (one.type === "video" ? '<div class="row small"><label class="toggle"><input type="checkbox" data-f="loop"' + (one.loop !== false ? " checked" : "") + '> Loop</label></div>' : "") + '<button data-ed="replaceMedia">Replace…</button>';
      } else if (one.type === "shape") {
        var sp = one.shape || {};
        h += '<div class="sl-fs">' + fld("Shape", '<select data-f="shape.kind">' + opt([["rect", "Rectangle"], ["round", "Rounded box"], ["ellipse", "Circle / oval"], ["triangle", "Triangle"], ["line", "Line"]], sp.kind) + "</select>") + fld("Fill", color("shape.fill", /^#/.test(sp.fill || "") ? sp.fill : (sp.fill === "@lowerBox" ? th.lower.box : sp.fill === "@lowerAccent" ? th.lower.accent : "#ffffff"))) +
          fld("Line", color("shape.stroke", sp.stroke || "#ffffff") + num("shape.strokeW", sp.strokeW || 0, { min: 0, max: 60 })) + fld("Corners", num("shape.radius", sp.radius == null ? 24 : sp.radius, { min: 0, max: 400 })) + "</div>" + '<label class="toggle small"><input type="checkbox" data-f="shape.noFill"' + (!sp.fill ? " checked" : "") + "> No fill</label>";
      }
      h += '<h4>Position</h4><div class="sl-fs">' + fld("X", num("x", one.x)) + fld("Y", num("y", one.y)) + fld("Width", num("w", one.w, { min: 1 })) + fld("Height", num("h", one.h, { min: 1 })) + fld("Turn (°)", num("rot", one.rot || 0, { min: -180, max: 180 })) + fld("See-through", '<input type="range" min="0" max="1" step="0.05" data-f="opacity" value="' + (one.opacity == null ? 1 : one.opacity) + '">') + "</div>" +
        '<h4>Comes in</h4><div class="sl-fs">' + fld("How", '<select data-f="in.type">' + opt(ENTR, (one.in || {}).type || "none") + "</select>") + fld("Seconds", num("in.dur", (one.in || {}).dur || 0.5, { min: 0.1, max: 5, step: 0.1 })) + fld("After (s)", num("in.delay", (one.in || {}).delay || 0, { min: 0, max: 10, step: 0.1 })) + "</div>" +
        '<div class="row small"><label class="toggle"><input type="checkbox" data-f="locked"' + (one.locked ? " checked" : "") + "> Locked</label></div>";
    } else if (s) {
      var bg = s.bg || { type: "theme" }, lbg = BG ? (typeof BG.list === "function" ? BG.list() : BG.list || []) : [];
      h += "<h3>Slide " + (d.slides.indexOf(s) + 1) + "</h3>" + fld("Name", '<input data-s="name" value="' + esc(s.name || "") + '" placeholder="' + esc(slideTitle(s)) + '">') +
        "<h4>Background</h4>" + fld("Kind", '<select data-s="bg.type">' + opt([["theme", "The theme's"], ["color", "One colour"], ["gradient", "Gradient"], ["image", "Picture"], ["video", "Video"]].concat(lbg.length ? [["lyricbg", "A lyric background"]] : []).concat([["none", "None (see-through, for the stream)"]]), bg.type) + "</select>") +
        (bg.type === "color" ? fld("Colour", '<input type="color" data-s="bg.color" value="' + esc(bg.color || "#000000") + '">') : "") +
        (bg.type === "gradient" ? '<div class="sl-fs">' + fld("From", '<input type="color" data-s="bg.color" value="' + esc(bg.color || "#0f1a2b") + '">') + fld("To", '<input type="color" data-s="bg.color2" value="' + esc(bg.color2 || "#1d3557") + '">') + fld("Angle", '<input type="number" data-s="bg.angle" min="0" max="360" value="' + (bg.angle == null ? 135 : bg.angle) + '">') + "</div>" : "") +
        (bg.type === "image" || bg.type === "video" ? '<button data-ed="bgMedia">' + (bg.media ? "Change: " + esc(M ? M.name(bg.media) : "") : "Pick…") + "</button>" + fld("Fit", '<select data-s="bg.fit">' + opt([["cover", "Fill the screen"], ["contain", "Whole picture"]], bg.fit || "cover") + "</select>") : "") +
        (bg.type === "lyricbg" ? fld("Which", '<select data-s="bg.bgId">' + lbg.map(function (b) { return '<option value="' + esc(b.id) + '"' + (b.id === bg.bgId ? " selected" : "") + ">" + esc(b.name) + "</option>"; }).join("") + "</select>") : "") +
        (bg.type !== "none" ? fld("Darken", '<input type="range" min="0" max="0.8" step="0.05" data-s="bg.dim" value="' + (bg.dim || 0) + '">') : "") +
        "<h4>On screen</h4>" + '<div class="sl-fs">' + fld("Transition in", '<select data-s="transition.type"><option value="">The deck\'s</option>' + opt(TRANS, (s.transition || {}).type || "") + "</select>") + fld("Stays (s)", '<input type="number" min="0" max="3600" step="1" data-s="advance" value="' + (s.advance || 0) + '" title="0: until someone moves on">') + "</div>" +
        fld("Notes (only you see these)", '<textarea data-s="notes" rows="2">' + esc(s.notes || "") + "</textarea>");
    }
    // the deck
    h += '<h3 class="sl-deckh">Deck</h3>' + fld("Name", '<input data-deck-f="name" value="' + esc(d.name) + '">') + '<div class="sl-fs">' + fld("Kind", '<select data-deck-f="kind">' + opt(DECK_KINDS, d.kind) + "</select>") + fld("Transition", '<select data-deck-f="transition.type">' + opt(TRANS, (d.transition || {}).type || "fade") + "</select>") + fld("Seconds", '<input type="number" min="0" max="5" step="0.1" data-deck-f="transition.dur" value="' + ((d.transition || {}).dur == null ? 0.5 : d.transition.dur) + '">') + "</div>" +
      fld("Run sheet item", '<select data-deck-f="runItem"><option value="">Not tied to one</option>' + runItems().map(function (r) { return '<option value="' + esc(r.id) + '"' + (r.id === d.runItem ? " selected" : "") + ">" + esc(r.label) + "</option>"; }).join("") + (d.runItem && !runItems().some(function (r) { return r.id === d.runItem; }) ? '<option value="' + esc(d.runItem) + '" selected>(an item of another service)</option>' : "") + "</select>") +
      '<div class="row small"><button data-ed="deckDup">Duplicate deck</button><button data-ed="deckDel" class="danger">Delete deck</button></div>';
    // layers
    if (s && s.els.length) h += '<h4>Layers</h4><div class="sl-layers">' + s.els.slice().reverse().map(function (x) { return '<div class="sl-layer' + (sel.indexOf(x.id) >= 0 ? " on" : "") + '" data-layer="' + x.id + '"><button data-lay-vis="' + x.id + '" title="Show / hide">' + (x.hidden ? "◌" : "●") + '</button><span>' + esc(x.type === "text" ? (x.text.value || "Text").split("\n")[0].slice(0, 28) : x.type === "shape" ? "Shape" : (M && M.name(x.media)) || x.type) + '</span><button data-lay-lock="' + x.id + '" title="Lock">' + (x.locked ? "🔒" : "🔓") + "</button></div>"; }).join("") + "</div>";
    // the church's own theme (when the deck uses one)
    var ut = st.themes.filter(function (t) { return t.id === d.theme; })[0];
    if (ut) h += '<h4>Theme: ' + esc(ut.name) + '</h4><div class="sl-fs">' + fld("Name", '<input data-th="name" value="' + esc(ut.name) + '">') + fld("Background from", '<input type="color" data-th="bg.color" value="' + esc(ut.bg.color || "#000000") + '">') + fld("to", '<input type="color" data-th="bg.color2" value="' + esc(ut.bg.color2 || ut.bg.color || "#000000") + '">') +
      ["title", "body", "sub", "ref"].map(function (r) { var x = ut[r] || {}; return fld((ROLES.filter(function (q) { return q[0] === r; })[0] || [r, r])[1] + " font", '<select data-th="' + r + '.font">' + R.FONTS.map(function (f) { return "<option" + (f === x.font ? " selected" : "") + ">" + f + "</option>"; }).join("") + "</select>") + fld("colour", '<input type="color" data-th="' + r + '.color" value="' + esc(x.color || "#ffffff") + '">'); }).join("") + "</div>";
    e.innerHTML = h;
  }

  // ---- editing helpers
  function getPath(o, p) { return p.split(".").reduce(function (a, k) { return a == null ? a : a[k]; }, o); }
  function setPath(o, p, v) { var ks = p.split("."), last = ks.pop(), t = ks.reduce(function (a, k) { if (a[k] == null || typeof a[k] !== "object") a[k] = {}; return a[k]; }, o); t[last] = v; }
  function addEl(e) { var s = curSlide(); if (!s) return; snap(); s.els.push(e); sel = [e.id]; touch(); paintEditor(); renderInspector(); renderStrip(); }
  async function pickMedia(accept) {
    if (NAT && accept !== "doc") {
      var files = await NAT.open(); var out = [];
      for (var i = 0; i < files.length; i++) {
        var f = files[i], isV = VIDEO.test(f.name);
        if (isV || !M) out.push({ id: M ? M.addPath(f.path, f.name) : "path:" + f.path, video: isV, name: f.name });
        else { var buf = await NAT.readFile(f.path); var ext = (f.name.split(".").pop() || "").toLowerCase(); out.push({ id: await M.put(new Blob([buf], { type: ext === "svg" ? "image/svg+xml" : "image/" + (ext === "jpg" ? "jpeg" : ext) }), f.name), video: false, name: f.name }); }
      }
      return out;
    }
    return await new Promise(function (resolve) {
      var inp = document.createElement("input"); inp.type = "file"; inp.multiple = true; inp.accept = accept === "doc" ? ".pdf,.pptx" : "image/*,video/*";
      inp.onchange = async function () { var out = []; for (var i = 0; i < inp.files.length; i++) { var f = inp.files[i]; if (accept === "doc") out.push(f); else out.push({ id: await M.put(f, f.name), video: /^video\//.test(f.type), name: f.name }); } resolve(out); };
      inp.click();
    });
  }
  function mediaEl(m, d) { return { id: uid(), type: m.video ? "video" : "image", x: d.size.w * 0.15, y: d.size.h * 0.15, w: d.size.w * 0.7, h: d.size.h * 0.7, rot: 0, opacity: 1, media: m.id, fit: "contain", loop: true, muted: true, in: { type: "none", dur: 0.5, delay: 0 } }; }
  function order(how) {
    var s = curSlide(); if (!s || !sel.length) return; snap();
    sel.forEach(function (id) {
      var i = s.els.findIndex(function (x) { return x.id === id; }); if (i < 0) return; var e = s.els.splice(i, 1)[0];
      var j = how === "front" ? s.els.length : how === "back" ? 0 : how === "forward" ? Math.min(s.els.length, i + 1) : Math.max(0, i - 1); s.els.splice(j, 0, e);
    });
    touch(); paintEditor(); renderInspector();
  }
  function align(how) {
    var d = deck(), s = curSlide(); if (!s || !sel.length) return; snap();
    var es = sel.map(el).filter(Boolean), box = es.length > 1 ? { x: Math.min.apply(null, es.map(function (e) { return e.x; })), y: Math.min.apply(null, es.map(function (e) { return e.y; })), r: Math.max.apply(null, es.map(function (e) { return e.x + e.w; })), b: Math.max.apply(null, es.map(function (e) { return e.y + e.h; })) } : { x: 0, y: 0, r: d.size.w, b: d.size.h };
    es.forEach(function (e) {
      if (how === "al") e.x = box.x; else if (how === "ar") e.x = box.r - e.w; else if (how === "ac") e.x = (box.x + box.r) / 2 - e.w / 2;
      else if (how === "at") e.y = box.y; else if (how === "ab") e.y = box.b - e.h; else if (how === "am") e.y = (box.y + box.b) / 2 - e.h / 2;
    });
    touch(); paintEditor(); renderInspector();
  }
  function dupSel() { var s = curSlide(); if (!s || !sel.length) return; snap(); var add = sel.map(el).filter(Boolean).map(function (e) { var c = clone(e); c.id = uid(); c.x += 30; c.y += 30; return c; }); s.els = s.els.concat(add); sel = add.map(function (e) { return e.id; }); touch(); paintEditor(); renderInspector(); renderStrip(); }
  function delSel() { var s = curSlide(); if (!s || !sel.length) return; snap(); s.els = s.els.filter(function (e) { return sel.indexOf(e.id) < 0; }); sel = []; touch(); paintEditor(); renderInspector(); renderStrip(); }

  // ---- mouse on the stage: select, move, resize, with snapping and guides
  var drag = null;
  function toDeck(ev) { var r = $("#slOv").getBoundingClientRect(); return { x: (ev.clientX - r.left) / view.k, y: (ev.clientY - r.top) / view.k }; }
  function snapTargets(moving) {
    var d = deck(), s = curSlide(), xs = [0, d.size.w / 2, d.size.w], ys = [0, d.size.h / 2, d.size.h];
    s.els.forEach(function (e) { if (moving.indexOf(e.id) >= 0 || e.hidden) return; xs.push(e.x, e.x + e.w / 2, e.x + e.w); ys.push(e.y, e.y + e.h / 2, e.y + e.h); });
    return { xs: xs, ys: ys };
  }
  function snapVal(vals, targets, tol) { var best = null; vals.forEach(function (v, i) { targets.forEach(function (t) { var dd = t - v; if (Math.abs(dd) <= tol && (!best || Math.abs(dd) < Math.abs(best.d))) best = { d: dd, at: t, i: i }; }); }); return best; }
  function onDown(ev) {
    if (ev.target.id === "slInline") return;
    var s = curSlide(); if (!s) return; var p = toDeck(ev), handle = ev.target.dataset && ev.target.dataset.handle;
    if (handle && sel.length === 1) { var e0 = el(sel[0]); drag = { kind: "resize", handle: handle, start: p, orig: clone(e0), id: e0.id, pushed: snap() }; }
    else {
      var hitEl = R.hit(s, p.x, p.y);
      if (!hitEl) { sel = []; drawOverlay(); renderInspector(); drag = null; return; }
      if (ev.shiftKey) { if (sel.indexOf(hitEl.id) >= 0) sel = sel.filter(function (x) { return x !== hitEl.id; }); else sel.push(hitEl.id); }
      else if (sel.indexOf(hitEl.id) < 0) sel = [hitEl.id];
      if (hitEl.locked) { drawOverlay(); renderInspector(); return; }
      drag = { kind: "move", start: p, orig: sel.map(function (id) { return clone(el(id)); }), moved: false, pushed: snap() };
      renderInspector();
    }
    drawOverlay(); $("#slOv").setPointerCapture(ev.pointerId); ev.preventDefault();
  }
  function onMove(ev) {
    if (!drag) return; var p = toDeck(ev), dx = p.x - drag.start.x, dy = p.y - drag.start.y, tol = 8 / view.k, guides = [];
    if (drag.kind === "move") {
      if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 2 / view.k) return; drag.moved = true;
      var o = drag.orig, minX = Math.min.apply(null, o.map(function (e) { return e.x + dx; })), maxX = Math.max.apply(null, o.map(function (e) { return e.x + e.w + dx; })), minY = Math.min.apply(null, o.map(function (e) { return e.y + dy; })), maxY = Math.max.apply(null, o.map(function (e) { return e.y + e.h + dy; }));
      if (snapOn && !ev.altKey) {
        var T = snapTargets(sel), sx = snapVal([minX, (minX + maxX) / 2, maxX], T.xs, tol), sy = snapVal([minY, (minY + maxY) / 2, maxY], T.ys, tol);
        if (sx) { dx += sx.d; guides.push({ v: sx.at }); } if (sy) { dy += sy.d; guides.push({ h: sy.at }); }
      }
      o.forEach(function (oe) { var e = el(oe.id); if (e) { e.x = Math.round(oe.x + dx); e.y = Math.round(oe.y + dy); } });
    } else {
      var e = el(drag.id), q = drag.orig, hdl = drag.handle, x1 = q.x, y1 = q.y, x2 = q.x + q.w, y2 = q.y + q.h;
      if (/w/.test(hdl)) x1 += dx; if (/e/.test(hdl)) x2 += dx; if (/n/.test(hdl)) y1 += dy; if (/s/.test(hdl)) y2 += dy;
      if (snapOn && !ev.altKey) {
        var T2 = snapTargets([drag.id]);
        if (/w/.test(hdl)) { var a = snapVal([x1], T2.xs, tol); if (a) { x1 += a.d; guides.push({ v: a.at }); } } if (/e/.test(hdl)) { var b = snapVal([x2], T2.xs, tol); if (b) { x2 += b.d; guides.push({ v: b.at }); } }
        if (/n/.test(hdl)) { var c = snapVal([y1], T2.ys, tol); if (c) { y1 += c.d; guides.push({ h: c.at }); } } if (/s/.test(hdl)) { var dd = snapVal([y2], T2.ys, tol); if (dd) { y2 += dd.d; guides.push({ h: dd.at }); } }
      }
      if (ev.shiftKey && (e.type === "image" || e.type === "video") && q.w && q.h) { var ratio = q.w / q.h; if (/[ns]/.test(hdl) && !/[ew]/.test(hdl)) x2 = x1 + (y2 - y1) * ratio; else y2 = y1 + (x2 - x1) / ratio; }
      e.x = Math.round(Math.min(x1, x2)); e.y = Math.round(Math.min(y1, y2)); e.w = Math.max(4, Math.round(Math.abs(x2 - x1))); e.h = Math.max(4, Math.round(Math.abs(y2 - y1)));
    }
    var c2 = $("#slEdCanvas"); paint(c2, deck(), curSlide(), { placeholders: true }); drawOverlay(guides);
  }
  function onUp() {
    if (!drag) return; var moved = drag.kind === "resize" || drag.moved; if (!moved && drag.pushed) hist.undo.pop(); drag = null;
    if (moved) { touch(); renderStrip(); renderTools(); } drawOverlay(); renderInspector();
  }
  function inlineEdit(e) {
    var ta = $("#slInline"); if (!ta || !e || e.type !== "text" || e.locked) return;
    var k = view.k, ts = R.textStyle(e, R.theme(deck().theme));
    ta.hidden = false; ta.value = e.text.value || ""; Object.assign(ta.style, { left: e.x * k + "px", top: e.y * k + "px", width: e.w * k + "px", height: e.h * k + "px", fontFamily: ts.font, fontSize: Math.max(10, ts.size * k * 0.9) + "px", textAlign: ts.align, color: ts.color });
    ta.focus(); ta.select();
    var start = e.text.value, pushed = snap();
    ta.oninput = function () { e.text.value = ta.value; var c = $("#slEdCanvas"); paint(c, deck(), curSlide(), { placeholders: true }); };
    ta.onblur = function () { ta.hidden = true; if (e.text.value === start) { if (pushed) hist.undo.pop(); return; } touch(); renderStrip(); renderInspector(); };
    ta.onkeydown = function (k) { if (k.key === "Escape") { e.text.value = start; ta.blur(); paintEditor(); } };
  }

  // ---------------------------------------------------------------- importing and exporting
  async function importDocs() {
    var files = await pickMedia("doc"), d = deck(); if (!files.length) return;
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      try {
        setInfo("Importing " + f.name + "…");
        var slides = /\.pdf$/i.test(f.name) ? await importPdf(f, d) : await importPptx(f, d);
        if (!d) { d = R.newDeck({ name: f.name.replace(/\.[^.]+$/, ""), kind: "custom" }); st.decks.unshift(d); st.activeDeck = d.id; }
        snap(); d.slides = d.slides.concat(slides); previewId = slides[0] ? slides[0].id : previewId; touch(d);
        setInfo("Imported " + slides.length + " slide" + (slides.length === 1 ? "" : "s") + " from " + f.name + ".");
      } catch (e) { setInfo("Couldn't import " + f.name + ": " + (e.message || e)); }
    }
    renderAll();
  }
  function loadScript(src) { return new Promise(function (res, rej) { var s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = function () { rej(new Error("couldn't load " + src)); }; document.head.appendChild(s); }); }
  async function importPdf(file, d) {
    if (!window.pdfjsLib) { await loadScript("vendor/pdfjs/pdf.min.js"); window.pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdfjs/pdf.worker.min.js"; }
    var pdf = await window.pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise, out = [], W = d ? d.size.w : 1920;
    for (var n = 1; n <= Math.min(pdf.numPages, 300); n++) {
      var page = await pdf.getPage(n), vp0 = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale: W / vp0.width }), c = document.createElement("canvas"); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
      var blob = await new Promise(function (r) { c.toBlob(r, "image/jpeg", 0.88); }), id = await M.put(blob, file.name + " p" + n);
      out.push({ id: uid(), kind: "design", name: "Page " + n, bg: { type: "image", media: id, fit: "contain" }, els: [], advance: null, notes: "" });
    }
    return out;
  }
  // a .pptx is a zip of XML: each slide's text boxes and pictures, where they sit (the slide master's styles are not read)
  async function unzip(buf) {
    var u = new Uint8Array(buf), v = new DataView(buf), eocd = -1;
    for (var i = u.length - 22; i >= Math.max(0, u.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error("that isn't a .pptx file");
    var n = v.getUint16(eocd + 10, true), off = v.getUint32(eocd + 16, true), files = {}, dec = new TextDecoder();
    for (var k = 0; k < n; k++) {
      var method = v.getUint16(off + 10, true), csize = v.getUint32(off + 20, true), nlen = v.getUint16(off + 28, true), xlen = v.getUint16(off + 30, true), clen = v.getUint16(off + 32, true), lho = v.getUint32(off + 42, true);
      var name = dec.decode(u.subarray(off + 46, off + 46 + nlen)); files[name] = { method: method, csize: csize, lho: lho }; off += 46 + nlen + xlen + clen;
    }
    async function read(name) {
      var f = files[name]; if (!f) return null; var p = f.lho, start = p + 30 + v.getUint16(p + 26, true) + v.getUint16(p + 28, true), data = u.subarray(start, start + f.csize);
      if (f.method === 0) return data.slice();
      var s = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw")); return new Uint8Array(await new Response(s).arrayBuffer());
    }
    return { names: Object.keys(files), read: read, text: async function (nm) { var b = await read(nm); return b ? dec.decode(b) : null; } };
  }
  async function importPptx(file, d) {
    var z = await unzip(await file.arrayBuffer()), P = new DOMParser(), W = d ? d.size.w : 1920, H = d ? d.size.h : 1080;
    var pres = P.parseFromString(await z.text("ppt/presentation.xml"), "application/xml"), sz = pres.getElementsByTagName("p:sldSz")[0], cx = sz ? +sz.getAttribute("cx") : 12192000, cy = sz ? +sz.getAttribute("cy") : 6858000;
    var rels = P.parseFromString(await z.text("ppt/_rels/presentation.xml.rels"), "application/xml"), relMap = {};
    Array.prototype.forEach.call(rels.getElementsByTagName("Relationship"), function (r) { relMap[r.getAttribute("Id")] = r.getAttribute("Target"); });
    var ids = Array.prototype.map.call(pres.getElementsByTagName("p:sldId"), function (x) { return x.getAttribute("r:id"); }), out = [];
    var kx = W / cx, ky = H / cy, ptPx = W / (cx / 12700);   // EMU -> deck px; a point -> deck px
    for (var i = 0; i < ids.length; i++) {
      var path = "ppt/" + relMap[ids[i]].replace(/^\//, "").replace(/^ppt\//, ""), xml = P.parseFromString(await z.text(path), "application/xml");
      var srels = {}, rp = path.replace(/slides\/(slide\d+\.xml)$/, "slides/_rels/$1.rels"), rx = await z.text(rp);
      if (rx) Array.prototype.forEach.call(P.parseFromString(rx, "application/xml").getElementsByTagName("Relationship"), function (r) { srels[r.getAttribute("Id")] = r.getAttribute("Target"); });
      var s = { id: uid(), kind: "design", name: "Slide " + (i + 1), bg: { type: "color", color: "#ffffff" }, els: [], advance: null, notes: "" };
      var bgClr = xml.querySelector("bg srgbClr"); if (bgClr) s.bg = { type: "color", color: "#" + bgClr.getAttribute("val") };
      var dark = parseInt((s.bg.color || "#ffffff").slice(1), 16), isDark = ((dark >> 16) * 0.3 + ((dark >> 8) & 255) * 0.59 + (dark & 255) * 0.11) < 128;
      var spTree = xml.getElementsByTagName("p:spTree")[0]; if (!spTree) { out.push(s); continue; }
      for (var c = spTree.firstElementChild; c; c = c.nextElementSibling) {
        var off = c.getElementsByTagName("a:off")[0], ext = c.getElementsByTagName("a:ext")[0], ph = c.getElementsByTagName("p:ph")[0];
        var box = off && ext ? { x: +off.getAttribute("x") * kx, y: +off.getAttribute("y") * ky, w: +ext.getAttribute("cx") * kx, h: +ext.getAttribute("cy") * ky } : ph && /title/i.test(ph.getAttribute("type") || "") ? { x: W * 0.06, y: H * 0.05, w: W * 0.88, h: H * 0.2 } : { x: W * 0.06, y: H * 0.28, w: W * 0.88, h: H * 0.62 };
        if (c.localName === "sp") {
          var paras = Array.prototype.map.call(c.getElementsByTagName("a:p"), function (p) { return Array.prototype.map.call(p.getElementsByTagName("a:t"), function (t) { return t.textContent; }).join(""); }).filter(function (t, k, a) { return t || k < a.length - 1; });
          var txt = paras.join("\n").trim(); if (!txt) continue;
          var rpr = c.getElementsByTagName("a:rPr")[0], szAttr = rpr && rpr.getAttribute("sz"), clr = c.querySelector("rPr srgbClr, defRPr srgbClr"), algn = (c.getElementsByTagName("a:pPr")[0] || { getAttribute: function () { return null; } }).getAttribute("algn");
          var title = ph && /title/i.test(ph.getAttribute("type") || "");
          s.els.push({ id: uid(), type: "text", x: box.x, y: box.y, w: box.w, h: box.h, rot: 0, opacity: 1, in: { type: "none" },
            text: { value: txt, role: title ? "title" : "body", size: szAttr ? Math.round(+szAttr / 100 * ptPx) : title ? 88 : 54, color: clr ? "#" + clr.getAttribute("val") : isDark ? "#ffffff" : "#1b1b1b", align: algn === "ctr" ? "center" : algn === "r" ? "right" : "left", valign: title ? "middle" : "top", shadow: { blur: 0 }, weight: title ? 800 : 500 } });
        } else if (c.localName === "pic") {
          var blip = c.getElementsByTagName("a:blip")[0], rid = blip && blip.getAttribute("r:embed"); if (!rid || !srels[rid]) continue;
          var mp = "ppt/" + srels[rid].replace(/^\.\.\//, ""), data = await z.read(mp); if (!data) continue;
          var ext2 = (mp.split(".").pop() || "png").toLowerCase(), mid = await M.put(new Blob([data], { type: "image/" + (ext2 === "jpg" ? "jpeg" : ext2) }), mp.split("/").pop());
          s.els.push({ id: uid(), type: "image", x: box.x, y: box.y, w: box.w, h: box.h, rot: 0, opacity: 1, media: mid, fit: "fill", in: { type: "none" } });
        }
      }
      out.push(s);
    }
    return out;
  }
  // a PDF made by hand: one JPEG per page
  function pdfBytes(pages, wPt, hPt) {
    var enc = new TextEncoder(), parts = [], offs = [], len = 0;
    function add(x) { var b = typeof x === "string" ? enc.encode(x) : x; parts.push(b); len += b.length; }
    function obj(n, body, stream) { offs[n] = len; add(n + " 0 obj\n" + body + "\n"); if (stream) { add("stream\n"); add(stream); add("\nendstream\n"); } add("endobj\n"); }
    add("%PDF-1.4\n%\xC7\xEC\n");
    var nPages = pages.length, kids = []; for (var i = 0; i < nPages; i++) kids.push((3 + i * 3) + " 0 R");
    obj(1, "<< /Type /Catalog /Pages 2 0 R >>"); obj(2, "<< /Type /Pages /Count " + nPages + " /Kids [" + kids.join(" ") + "] >>");
    pages.forEach(function (p, i) {
      var n = 3 + i * 3, cs = "q " + wPt + " 0 0 " + hPt + " 0 0 cm /Im0 Do Q";
      obj(n, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + wPt + " " + hPt + "] /Resources << /XObject << /Im0 " + (n + 2) + " 0 R >> >> /Contents " + (n + 1) + " 0 R >>");
      obj(n + 1, "<< /Length " + cs.length + " >>", enc.encode(cs));
      obj(n + 2, "<< /Type /XObject /Subtype /Image /Width " + p.w + " /Height " + p.h + " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + p.jpg.length + " >>", p.jpg);
    });
    var xref = len, count = 3 + nPages * 3; add("xref\n0 " + count + "\n0000000000 65535 f \n"); for (var k = 1; k < count; k++) add(("0000000000" + offs[k]).slice(-10) + " 00000 n \n");
    add("trailer\n<< /Size " + count + " /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF\n");
    var out = new Uint8Array(len), o = 0; parts.forEach(function (b) { out.set(b, o); o += b.length; }); return out;
  }
  var CRC = (function () { var t = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u) { var c = 0xFFFFFFFF; for (var i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zipBytes(files) {   // stored (no compression): PNGs are compressed already
    var enc = new TextEncoder(), parts = [], cd = [], off = 0;
    files.forEach(function (f) {
      var name = enc.encode(f.name), crc = crc32(f.data), h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint32(14, crc, true); h.setUint32(18, f.data.length, true); h.setUint32(22, f.data.length, true); h.setUint16(26, name.length, true);
      parts.push(new Uint8Array(h.buffer), name, f.data);
      var c = new DataView(new ArrayBuffer(46)); c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint32(16, crc, true); c.setUint32(20, f.data.length, true); c.setUint32(24, f.data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
      cd.push(new Uint8Array(c.buffer), name); off += 30 + name.length + f.data.length;
    });
    var cdLen = cd.reduce(function (a, b) { return a + b.length; }, 0), e = new DataView(new ArrayBuffer(22)); e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cdLen, true); e.setUint32(16, off, true);
    return new Blob(parts.concat(cd, [new Uint8Array(e.buffer)]));
  }
  function download(blob, name) { var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000); }
  async function exportDeck(kind) {
    var d = deck(); if (!d || !d.slides.length) return; setInfo("Exporting " + d.name + "…");
    var W = d.size.w, H = d.size.h, safe = d.name.replace(/[^\w\- ]+/g, "_");
    if (kind === "pdf") {
      var pages = [];
      for (var i = 0; i < d.slides.length; i++) { var b = await toBlob(d, d.slides[i], W, H, "image/jpeg"); pages.push({ w: W, h: H, jpg: new Uint8Array(await b.arrayBuffer()) }); }
      var k = 720 / Math.max(W, H); download(new Blob([pdfBytes(pages, Math.round(W * k), Math.round(H * k))], { type: "application/pdf" }), safe + ".pdf");
    } else {
      var files = [];
      for (var j = 0; j < d.slides.length; j++) { var p = await toBlob(d, d.slides[j], W, H, "image/png"); files.push({ name: safe + " " + ("00" + (j + 1)).slice(-3) + ".png", data: new Uint8Array(await p.arrayBuffer()) }); }
      download(zipBytes(files), safe + ".zip");
    }
    setInfo("Exported " + d.slides.length + " slide" + (d.slides.length === 1 ? "" : "s") + ".");
  }

  // ---------------------------------------------------------------- the page and its events
  function renderAll() {
    var root = $("#slidesRoot"); if (!root || !visible()) return;
    if (!root.querySelector("#slHead")) root.innerHTML = '<div class="card" id="slHead"></div><div class="sl2"><aside class="sl-side"><div class="card" id="slDecks"></div><div class="card" id="slStrip"></div></aside><div class="sl-main" id="slMain"></div></div>' + (NAT ? "" : '<p class="muted small">Second screen and NDI work in the Central Control app.</p>');
    if (!deck() && st.decks[0]) st.activeDeck = st.decks[0].id;
    var d = deck(); if (d && !slideOf(d, previewId)) previewId = d.slides[0] ? d.slides[0].id : null;
    root.dataset.mode = st.mode; renderHead(); renderDecks(); renderStrip();
    if (st.mode === "design") renderDesign(); else renderShow();
  }
  function paintAll() { paintThumbs(); if (st.mode === "design") paintEditor(); else { paintPreview(); paintLive(); } }
  function render() { renderAll(); }
  var root = $("#slidesRoot");
  function newDeck(kind) {
    var name = (DECK_KINDS.filter(function (k) { return k[0] === kind; })[0] || ["", "New deck"])[1], d = R.newDeck({ name: name, kind: kind, theme: kind === "scripture" ? "scripture" : "classic" });
    var first = { sermon: "title", announcements: "announce", welcome: "welcome", offering: "offering", scripture: "verse", lower: null, custom: "title" }[kind];
    if (kind === "lower") d.slides.push(R.newLower(d, "Name", "Title")); else d.slides.push(R.newSlide(d, first || "title"));
    if (kind === "welcome" || kind === "announcements") d.loop = { on: kind === "welcome", seconds: 8 };
    st.decks.unshift(d); st.activeDeck = d.id; previewId = d.slides[0].id; sel = []; touch(d); renderAll();
  }
  root.addEventListener("click", async function (e) {
    var b = e.target.closest("button,.sl-tile,.sl-layer"); if (!b) return;
    var d = deck();
    if (b.dataset.slMode) { st.mode = b.dataset.slMode; save(); sel = []; renderAll(); return; }
    if (b.dataset.slGo) { goLive(b.dataset.slGo); return; }
    if (b.dataset.slDup && d) { snap(); var i = d.slides.findIndex(function (s) { return s.id === b.dataset.slDup; }), c = clone(d.slides[i]); c.id = uid(); c.els.forEach(function (x) { x.id = uid(); }); d.slides.splice(i + 1, 0, c); previewId = c.id; touch(d); renderAll(); return; }
    if (b.dataset.slDel && d) { if (d.slides.length > 1 && !confirm("Delete this slide?")) return; snap(); d.slides = d.slides.filter(function (s) { return s.id !== b.dataset.slDel; }); if (previewId === b.dataset.slDel) previewId = d.slides[0] ? d.slides[0].id : null; touch(d); renderAll(); return; }
    if (b.dataset.deck) { st.activeDeck = b.dataset.deck; var nd = deck(); previewId = nd.slides[0] ? nd.slides[0].id : null; sel = []; save(); renderAll(); return; }
    if (b.classList.contains("sl-tile")) { previewId = b.dataset.slide; sel = []; markLists(); if (st.mode === "design") renderDesign(); else paintPreview(); return; }
    if (b.dataset.layer) { sel = [b.dataset.layer]; drawOverlay(); renderInspector(); return; }
    if (b.dataset.layVis) { var lv = el(b.dataset.layVis); snap(); lv.hidden = !lv.hidden; touch(); paintEditor(); renderInspector(); return; }
    if (b.dataset.layLock) { var ll = el(b.dataset.layLock); ll.locked = !ll.locked; touch(); drawOverlay(); renderInspector(); return; }
    if (b.dataset.read) { var box = $("#slScrRef"); if (box) { box.value = b.dataset.read; scriptureFind(); } return; }
    if (b.dataset.unread != null && d) { d.scriptures.splice(+b.dataset.unread, 1); touch(d); renderSermon(); return; }
    if (b.dataset.ref) { $("#slScrRef").value = b.dataset.ref; scriptureFind(); return; }
    var a = b.dataset.sl, ed = b.dataset.ed;
    if (a === "black") black(); else if (a === "clearLower") clearLower();
    else if (a === "prev") step(-1); else if (a === "next") step(1);
    else if (a === "goPreview") { if (previewId) goLive(previewId); }
    else if (a === "scrFind") scriptureFind();
    else if (a === "scrShow" && found && found.parts) { var sd = scriptureDeck(); previewId = sd.slides[0].id; renderAll(); goLiveSlide(sd.id, sd.slides[0].id); }
    else if (a === "scrNew" && found && found.parts) { var nd2 = scriptureDeck(); previewId = nd2.slides[0].id; renderAll(); }
    else if (a === "scrAdd" && found && found.parts && d) { snap(); var add = scriptureSlides(d); d.slides = d.slides.concat(add); previewId = add[0].id; touch(d); renderAll(); }
    else if (a === "scrKeep" && found && found.passage && d) { d.scriptures = d.scriptures || []; if (d.scriptures.indexOf(found.passage.label) < 0) d.scriptures.push(found.passage.label); touch(d); renderSermon(); }
    else if (a === "readAdd" && d) { var inp = $("#slReadAdd"), v = inp.value.trim(); if (!v) return; if (SC && !SC.parse(v).refs.length) { setInfo("\"" + v + "\" doesn't look like a Bible reference."); return; } d.scriptures = d.scriptures || []; d.scriptures.push(v); touch(d); renderSermon(); }
    else if (a === "lyricsBg" && NAT) { var fs = await NAT.open(); if (fs[0]) { addBgFile(fs[0]); setBg("all", fs[0].path); } }
    else if (a === "lyricsBgOff") setBg("all", null);
    // the designer
    else if (ed === "text" && d) { var t = R.textEl(d, "body", "Type here", { y: d.size.h * 0.35, h: d.size.h * 0.3 }); addEl(t); }
    else if (ed === "media" && d) { var ms = await pickMedia(); ms.forEach(function (m) { addEl(mediaEl(m, d)); }); }
    else if (ed === "replaceMedia") { var one = el(sel[0]); var rm = await pickMedia(); if (rm[0] && one) { snap(); one.media = rm[0].id; one.type = rm[0].video ? "video" : "image"; touch(); paintEditor(); renderInspector(); renderStrip(); } }
    else if (ed === "bgMedia") { var s0 = curSlide(), bm = await pickMedia(); if (bm[0] && s0) { snap(); s0.bg = Object.assign({}, s0.bg, { type: bm[0].video ? "video" : "image", media: bm[0].id, fit: s0.bg.fit || "cover" }); touch(); paintEditor(); renderInspector(); renderStrip(); } }
    else if (["front", "forward", "backward", "back"].indexOf(ed) >= 0) order(ed);
    else if (/^a[lcrtmb]$/.test(ed || "")) align(ed);
    else if (ed === "dup") dupSel(); else if (ed === "del") delSel();
    else if (ed === "undo") restore(hist.undo, hist.redo); else if (ed === "redo") restore(hist.redo, hist.undo);
    else if (ed === "resetText") { var te = el(sel[0]); if (te) { snap(); te.text = { value: te.text.value, role: te.text.role }; touch(); paintEditor(); renderInspector(); } }
    else if (ed === "themeCopy" && d) { var base = R.theme(d.theme), nt = clone(base); nt.id = "church-" + uid(); nt.name = base.name + " (ours)"; if (nt.bg.type !== "gradient") nt.bg = { type: "gradient", color: nt.bg.color || "#000000", color2: nt.bg.color || "#000000", angle: 135 }; st.themes.push(nt); R.setUserThemes(st.themes); d.theme = nt.id; touch(d); pushThemes(); renderDesign(); }
    else if (ed === "deckDup" && d) { var dc = clone(d); dc.id = uid(); dc.name = d.name + " (copy)"; dc.runItem = null; dc.slides.forEach(function (s) { s.id = uid(); }); st.decks.unshift(dc); st.activeDeck = dc.id; touch(dc); renderAll(); }
    else if (ed === "deckDel" && d) { if (!confirm("Delete the deck \"" + d.name + "\" and its " + d.slides.length + " slides? Every computer loses it.")) return; st.decks = st.decks.filter(function (x) { return x !== d; }); st.activeDeck = st.decks[0] ? st.decks[0].id : null; save(); var H = hub(); if (H) H.send({ type: "slides", action: "del", id: d.id }); renderAll(); }
  });
  root.addEventListener("dblclick", function (e) {
    var t = e.target.closest(".sl-tile"); if (t && st.mode === "show") { goLive(t.dataset.slide); return; }
    if (e.target.closest("#slOv") && st.mode === "design") { var s = curSlide(), p = toDeck(e), h = s && R.hit(s, p.x, p.y); if (h) { sel = [h.id]; drawOverlay(); inlineEdit(h); } }
  });
  // drag slides to reorder them
  root.addEventListener("dragstart", function (e) { var t = e.target.closest(".sl-tile"); if (t) e.dataTransfer.setData("text/x-slide", t.dataset.slide); });
  root.addEventListener("dragover", function (e) { if (e.target.closest(".sl-tile")) e.preventDefault(); });
  root.addEventListener("drop", function (e) { var t = e.target.closest(".sl-tile"); if (!t) return; e.preventDefault(); moveSlide(e.dataTransfer.getData("text/x-slide"), t.dataset.slide); });
  function moveSlide(fromId, toId) { var d = deck(); if (!d) return; var a = d.slides.findIndex(function (x) { return x.id === fromId; }), b = d.slides.findIndex(function (x) { return x.id === toId; }); if (a < 0 || b < 0 || a === b) return; snap(); var m = d.slides.splice(a, 1)[0]; d.slides.splice(b, 0, m); touch(d); renderStrip(); }
  root.addEventListener("pointerdown", function (e) { if (e.target.closest("#slOv")) onDown(e); });
  root.addEventListener("pointermove", function (e) { if (drag) onMove(e); });
  root.addEventListener("pointerup", function (e) { if (drag) onUp(e); });
  function pushThemes() { save(); var H = hub(); if (H) H.send({ type: "slides", action: "themes", themes: st.themes }); }
  function onField(e) {
    var t = e.target, d = deck(), s = curSlide(), live1 = e.type === "change";
    if (t.dataset.f && sel.length === 1) {
      var x = el(sel[0]); if (!x) return; var k = t.dataset.f, v = t.type === "checkbox" ? t.checked : t.type === "number" || t.type === "range" ? Number(t.value) : t.value;
      if (k === "text.fit") v = v ? "shrink" : "none";
      if (k === "shape.noFill") { k = "shape.fill"; v = v ? "" : "#ffffff"; }
      setPath(x, k, v);
      d.updatedAt = Date.now(); paintEditor(); if (live1) { touch(); renderStrip(); if (/^(text\.role|shape\.noFill|shape\.kind)$/.test(t.dataset.f)) renderInspector(); }
      return;
    }
    if (t.dataset.s && s) {
      var ks = t.dataset.s, vs = t.type === "number" || t.type === "range" ? Number(t.value) : t.value;
      if (ks === "transition.type") { s.transition = vs ? { type: vs, dur: (d.transition || {}).dur || 0.5 } : null; } else setPath(s, ks, vs);
      paintEditor(); if (live1) { touch(); renderStrip(); if (ks === "bg.type") renderInspector(); } return;
    }
    if (t.dataset.deckF && d) {
      var kd = t.dataset.deckF, vd = t.type === "number" ? Number(t.value) : t.value;
      if (kd === "runItem") vd = vd || null; setPath(d, kd, vd);
      if (live1) { touch(d); if (kd === "theme" || kd === "name" || kd === "kind") { renderDecks(); renderStrip(); if (st.mode === "design") { renderTools(); paintEditor(); renderInspector(); } } }
      return;
    }
    if (t.dataset.th && d) { var ut = st.themes.filter(function (q) { return q.id === d.theme; })[0]; if (!ut) return; setPath(ut, t.dataset.th, t.value); R.setUserThemes(st.themes); paintEditor(); if (live1) { pushThemes(); touch(d); renderStrip(); renderTools(); } return; }
    if (t.dataset.scr) { var kk = t.dataset.scr; st.scripture[kk] = t.type === "checkbox" ? t.checked : t.value; save(); if (found && $("#slScrRef").value.trim()) scriptureFind(); return; }
    if (t.dataset.sll) { var kl = t.dataset.sll; st.lyrics[kl] = t.type === "checkbox" ? t.checked : t.type === "range" ? Number(t.value) : t.value; save(); pushLyrics(true); return; }
  }
  root.addEventListener("input", function (e) { if (e.target.id === "slInline") return; onField(e); });
  // one undo step per field: taken when the field is entered (before any change to it)
  root.addEventListener("focusin", function (e) { var t = e.target; if (t.dataset && (t.dataset.f || t.dataset.s || t.dataset.deckF || t.dataset.th)) snap(); });
  root.addEventListener("keydown", function (e) { if (e.target.id === "slScrRef" && e.key === "Enter") { e.preventDefault(); scriptureFind(); } if (e.target.id === "slReadAdd" && e.key === "Enter") { e.preventDefault(); $('[data-sl="readAdd"]').click(); } });
  root.addEventListener("change", async function (e) {
    var t = e.target; onField(e); var d = deck();
    if (t.dataset.sl === "lyrics") setLyricsLive(t.checked);
    else if (t.dataset.sl === "newDeck" && t.value) newDeck(t.value);
    else if (t.dataset.sl === "addSlide" && t.value && d) { snap(); var s = t.value === "lower" ? R.newLower(d) : R.newSlide(d, t.value), i = d.slides.findIndex(function (x) { return x.id === previewId; }); d.slides.splice(i < 0 ? d.slides.length : i + 1, 0, s); previewId = s.id; sel = []; touch(d); renderAll(); }
    else if (t.dataset.sl === "importExport" && t.value) { var v = t.value; t.value = ""; if (v === "pics") { if (!d) newDeck("custom"); var ms = await pickMedia(), dd = deck(); snap(); ms.forEach(function (m) { var s2 = { id: uid(), kind: "design", name: m.name, bg: { type: "color", color: "#000000" }, els: [Object.assign(mediaEl(m, dd), { x: 0, y: 0, w: dd.size.w, h: dd.size.h })], advance: null, notes: "" }; dd.slides.push(s2); previewId = s2.id; }); touch(dd); renderAll(); } else if (v === "pdf" || v === "pptx") importDocs(); else if (v === "exportPdf") exportDeck("pdf"); else if (v === "exportPng") exportDeck("png"); }
    else if (t.dataset.sl === "loop" && d) { d.loop = Object.assign({ seconds: 8 }, d.loop, { on: t.checked }); touch(d); renderDecks(); if (live.deckId === d.id) scheduleAdvance(); }
    else if (t.dataset.sl === "loopSecs" && d) { d.loop = Object.assign({ on: false }, d.loop, { seconds: clamp(Number(t.value) || 8, 2, 600) }); touch(d); if (live.deckId === d.id) scheduleAdvance(); }
    else if (t.dataset.ed === "shape" && t.value && d) { var kind = t.value; t.value = ""; addEl({ id: uid(), type: "shape", x: d.size.w * 0.3, y: d.size.h * 0.3, w: d.size.w * 0.4, h: kind === "line" ? 20 : d.size.h * 0.3, rot: 0, opacity: 1, shape: { kind: kind, fill: kind === "line" ? "" : "#4f8cff", stroke: kind === "line" ? "#ffffff" : "", strokeW: kind === "line" ? 8 : 0, radius: 24 }, in: { type: "none", dur: 0.5, delay: 0 } }); }
    else if (t.dataset.ed === "snap") { snapOn = t.checked; CU.store.set("slSnap", snapOn); }
    else if (t.dataset.ed === "size" && d) {
      var wh = t.value === "custom" ? (prompt("Width × height in pixels, like 1920x1080", d.size.w + "x" + d.size.h) || "") : t.value, m2 = /^(\d{3,5})\s*[x×]\s*(\d{3,5})$/.exec(wh.trim()); if (!m2) { renderTools(); return; }
      snap(); var nw = +m2[1], nh = +m2[2], kx = nw / d.size.w, ky = nh / d.size.h;
      d.slides.forEach(function (s) { s.els.forEach(function (x) { x.x *= kx; x.w *= kx; x.y *= ky; x.h *= ky; if (x.text && x.text.size) x.text.size = Math.round(x.text.size * Math.min(kx, ky)); }); });
      d.size = { w: nw, h: nh }; touch(d); renderAll();
    }
    else if (t.dataset.sl === "display") { st.outputs.screen.displayId = Number(t.value); save(); if (outStatus.screen && NAT) await NAT.outputScreen({ on: true, displayId: st.outputs.screen.displayId }); }
    else if (t.dataset.slOut === "screen" && NAT) { var r = await NAT.outputScreen({ on: t.checked, displayId: st.outputs.screen.displayId }); outStatus.screen = r.on; st.outputs.screen.on = r.on; save(); if (r.on && live.slide) NAT.show(live.slide); renderHead(); syncLyricsBox(); }
    else if (t.dataset.slOut === "pi") { st.outputs.pi.on = t.checked; save(); if (t.checked && live.slide) { var ld = deck(live.deckId); toPi(live.slide, ld, slideOf(ld, live.id)); } renderHead(); syncLyricsBox(); }
    else if (t.dataset.slOut === "ndi" && NAT) { outStatus.ndi = await NAT.outputNdi({ on: t.checked, name: st.outputs.ndi.name || "" }); st.outputs.ndi.on = !!outStatus.ndi.on; save(); setTimeout(function () { if (live.slide) NAT.show(live.slide); }, 800); renderHead(); syncLyricsBox(); }
  });
  // keys: Show mode moves through the deck; Design mode nudges, deletes, duplicates, undoes
  document.addEventListener("keydown", function (e) {
    if (!visible() || /^(INPUT|TEXTAREA|SELECT)$/.test((e.target && e.target.tagName) || "")) return;
    var mod = e.ctrlKey || e.metaKey;
    if (st.mode === "show") {
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") { e.preventDefault(); step(1); }
      else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); step(-1); }
      else if (e.key === "b" || e.key === "B") black();
      return;
    }
    if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) restore(hist.redo, hist.undo); else restore(hist.undo, hist.redo); return; }
    if (mod && e.key.toLowerCase() === "y") { e.preventDefault(); restore(hist.redo, hist.undo); return; }
    if (!sel.length) return;
    if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); dupSel(); return; }
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); delSel(); return; }
    var dx = e.key === "ArrowLeft" ? -1 : e.key === "ArrowRight" ? 1 : 0, dy = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
    if (dx || dy) { e.preventDefault(); var k = e.shiftKey ? 10 : 1; if (!e.repeat) snap(); sel.forEach(function (id) { var x = el(id); if (x && !x.locked) { x.x += dx * k; x.y += dy * k; } }); deck().updatedAt = Date.now(); paintEditor(); clearTimeout(window.__slNudge); window.__slNudge = setTimeout(function () { touch(); renderStrip(); renderInspector(); }, 400); }
  });
  window.addEventListener("resize", function () { if (!visible()) return; if (st.mode === "design") { layoutStage(); paintEditor(); } else { paintPreview(); paintLive(); } paintThumbs(); });
  var lyrBox = $("#lyricsLive"); if (lyrBox) lyrBox.addEventListener("change", function () { setLyricsLive(lyrBox.checked); });
  if (NAT) {
    NAT.onOutputs(function (o) { if ("screen" in o) outStatus.screen = o.screen; if (o.ndi) outStatus.ndi = o.ndi; if (visible()) renderHead(); syncLyricsBox(); });
    NAT.screens().then(function (list) { screens = list || []; if (st.outputs.screen.displayId == null) { var other = screens.filter(function (x) { return !x.primary; })[0]; st.outputs.screen.displayId = other ? other.id : screens[0] && screens[0].id; } if (visible()) renderHead(); });
    NAT.outputs().then(function (o) { outStatus.screen = o.screen; outStatus.ndi = o.ndi; });
    // the outputs that were on come back on when the app starts
    setTimeout(function () { if (CU.mode() !== "admin") return; if (st.outputs.screen.on) NAT.outputScreen({ on: true, displayId: st.outputs.screen.displayId }).then(function (r) { outStatus.screen = r.on; }); if (st.outputs.ndi.on) NAT.outputNdi({ on: true, name: st.outputs.ndi.name }).then(function (r) { outStatus.ndi = r; }); }, 1500);
  }
  // ---------------------------------------------------------------- (10.2) the Lyrics tab's Background picker
  // ours (moving and still), your pictures and videos, or black; for everything, this song, or this part of it
  function addBgFile(f) { if (!f || !f.path || st.bgFiles.some(function (x) { return x.path === f.path; })) return; st.bgFiles.push({ path: f.path, name: f.name || String(f.path).split(/[\\/]/).pop(), kind: VIDEO.test(f.path) ? "video" : "image" }); save(); }
  var bgPick = { scope: "all", filter: "all" }, thumbs = {};
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
    if (bgPick.filter === "all" || bgPick.filter === "yours") st.bgFiles.forEach(function (x) { tiles.push({ v: x.path, name: x.name, file: x }); });
    el.innerHTML = '<div class="row spread"><b>Lyrics background</b><button class="mini" data-lb="close" aria-label="Close">✕</button></div>' +
      '<div class="lb-top"><div class="lb-prev"><div class="sl-screen">' + slideHtml(Object.assign(lyricsSlide(), { bgPath: shown })) + '</div><p class="muted small">' + esc(lyricsLive ? "On the outputs now: " + outputsText().replace(/^→ /, "") : "Not on the outputs (tick Lyrics to the outputs)") + "</p></div>" +
      '<div class="lb-side"><div class="lb-scopes" role="radiogroup" aria-label="Use it for">' + scopes.map(function (sc) { var dis = (sc[0] === "song" && !k) || (sc[0] === "section" && (!k || !sec)); return '<label class="toggle"><input type="radio" name="lbScope" data-lbs="' + sc[0] + '"' + (bgPick.scope === sc[0] ? " checked" : "") + (dis ? " disabled" : "") + "> " + esc(sc[1]) + "</label>"; }).join("") + "</div>" +
      '<p class="muted small">' + (bgPick.scope === "all" ? "Now: " + esc(bgName(st.lyricsBg)) : v === undefined ? "Uses the one above: " + esc(bgName(bgFor())) : "Now: " + esc(bgName(v)) + ' <button class="mini" data-lb="inherit">Use the one above</button>') + "</p>" +
      '<label>Crossfade (s) <input type="range" min="0" max="5" step="0.25" data-lb-fade value="' + st.bgFade + '"><output>' + st.bgFade + "</output></label>" +
      '<div class="lb-filter" role="group" aria-label="Show">' + [["all", "All"], ["motion", "Moving"], ["still", "Still"], ["yours", "Yours"]].map(function (f) { return '<button data-lbf="' + f[0] + '" class="' + (bgPick.filter === f[0] ? "on" : "") + '">' + f[1] + "</button>"; }).join("") + "</div></div></div>" +
      '<div class="lb-grid">' + tiles.map(function (t) { var sel = (t.v || null) === (shown || null); return '<button class="lb-tile' + (sel ? " sel" : "") + '" data-lbv="' + esc(t.v == null ? "" : t.v) + '" title="' + esc(t.name) + '">' + (t.img ? '<img src="' + t.img + '" alt="">' : t.file ? (t.file.kind === "video" ? '<video src="' + fileUrl(t.file.path) + '" muted></video>' : '<img src="' + fileUrl(t.file.path) + '" alt="">') : '<span class="lb-black"></span>') + (t.motion ? '<span class="lb-mv">moving</span>' : "") + '<span class="lb-nm">' + esc(t.name) + "</span></button>"; }).join("") +
      '<button class="lb-tile lb-add" data-lb="add"><span class="lb-black">+</span><span class="lb-nm">Add a picture or video</span></button></div>';
    var pv = el.querySelector(".lb-prev .sl-screen"); if (pv) { var html = pv.innerHTML; setHtml(pv, html); }
  }
  function openBgPicker(on) {
    var el = document.getElementById("lyricsBgPanel"); if (!el) return;
    el.hidden = on == null ? !el.hidden : !on;
    if (el.hidden) { (el.querySelectorAll(".sl-screen") || []).forEach(function (sc) { setHtml(sc, ""); }); return; }
    renderBgPicker();
  }
  (function () {
    var view = document.getElementById("view-lyrics"); if (!view || document.getElementById("lyricsBgPanel")) return;
    var out = view.querySelector(".lyr-out"), btn = document.createElement("button"); btn.id = "lyricsBgBtn"; btn.textContent = "Background…"; btn.title = "The picture behind the lyrics on the screens";
    if (out) out.insertBefore(btn, out.firstChild); else { var bar = view.querySelector(".bar"); if (bar) bar.appendChild(btn); }
    var panel = document.createElement("div"); panel.id = "lyricsBgPanel"; panel.className = "card lyr-bg admin-only"; panel.hidden = true;
    var lyr = document.getElementById("lyrics"); view.insertBefore(panel, lyr && lyr.parentNode === view ? lyr : null);
    btn.addEventListener("click", function () { openBgPicker(); });
    panel.addEventListener("click", async function (e) {
      var b = e.target.closest("button"); if (!b) return;
      if (b.dataset.lb === "close") openBgPicker(false);
      else if (b.dataset.lb === "inherit") setBg(bgPick.scope, undefined);
      else if (b.dataset.lb === "add") { if (!NAT) return alert("Adding pictures and videos works in the Central Control app."); var files = await NAT.open(); var last = null; (files || []).forEach(function (f) { addBgFile(f); last = f.path; }); if (last) setBg(bgPick.scope, last); else renderBgPicker(); }
      else if (b.dataset.lbf) { bgPick.filter = b.dataset.lbf; renderBgPicker(); }
      else if (b.dataset.lbv != null) setBg(bgPick.scope, b.dataset.lbv || null);
    });
    panel.addEventListener("change", function (e) { if (e.target.dataset.lbs) { bgPick.scope = e.target.dataset.lbs; renderBgPicker(); } });
    panel.addEventListener("input", function (e) { if (e.target.hasAttribute("data-lb-fade")) { st.bgFade = Number(e.target.value) || 0; e.target.nextElementSibling.textContent = st.bgFade; save(); } });
  })();
  var lastBgKey = "";
  CU.on("message", function (m) { if (m.type !== "display") return; var key = songKey() + "|" + secName(); if (key !== lastBgKey) { lastBgKey = key; CU.fire("lyricsBg", bgFor()); renderBgPicker(); } });
  CU.on("tab", function (t) { if (t === "slides") setTimeout(renderAll, 0); if (t === "lyrics") syncLyricsBox(); });

  // ---- for the rest of the app (the run sheet, Stream Deck, the tests)
  async function scripture(ref, opts) {   // a reference -> a scripture deck (made or reused); opts.live puts its first slide up
    opts = opts || {}; var passage = await SC.lookup(ref, opts.translation || st.scripture.translation), parts = SC.split(passage, { maxChars: +st.scripture.maxChars, verseNumbers: st.scripture.verseNumbers });
    found = { passage: passage, parts: parts }; var d = scriptureDeck(); if (opts.live) await goLiveSlide(d.id, d.slides[0].id); if (visible()) renderAll(); return d;
  }
  window.CUSlides = { bgFor: bgFor, setBg: setBg, lyricsSlide: lyricsSlide, lyricsLive: function () { return lyricsLive; }, blank: blank, blanked: function () { return !!blanked; }, openBgPicker: openBgPicker, piOn: function () { return !!st.outputs.pi.on; }, show: show, goLive: goLive, goLiveSlide: goLiveSlide, black: black, clear: clearLower, next: function () { step(1); }, prev: function () { step(-1); }, setLyricsLive: setLyricsLive,
    state: function () { return st; }, live: function () { return live; }, decks: function () { return st.decks; }, deck: deck, outputsText: outputsText, render: render,
    newDeck: newDeck, scripture: scripture, forRunItem: function (id) { return st.decks.filter(function (x) { return x.runItem === id; })[0] || null; },
    onShow: function (fn) { showFns.push(fn); }, designMsg: designMsg, toBlob: toBlob, select: function (ids) { sel = ids.slice(); if (st.mode === "design") { drawOverlay(); renderInspector(); } }, selection: function () { return sel.slice(); },
    preview: function (id) { previewId = id; if (visible()) renderAll(); }, moveSlide: moveSlide, undo: function () { restore(hist.undo, hist.redo); }, redo: function () { restore(hist.redo, hist.undo); },
    _pdf: pdfBytes, _zip: zipBytes, _unzip: unzip, _importPptx: importPptx };
})();
