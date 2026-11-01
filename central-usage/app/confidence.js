/* Central Control (10.2) - the confidence monitor: the band's screen, on the computer that runs the lyrics.
 *
 * The Lyrics tab shows two outputs:
 *   House lyrics          what the room sees (the lyrics screens - unchanged)
 *   Confidence monitor    what the band sees: the lines being sung now in one colour (yellow) and the next lines in
 *                         another (white), with the section, the chords, a clock, the song's time left, a countdown
 *                         to the next run sheet item, the lower third, and the booth's messages flashing.
 * The confidence monitor is its own output: a full-screen window on any screen of this computer (HDMI 1, HDMI 2…),
 * NDI (for a video switcher or another computer), and a link any browser on the church Wi-Fi can open (a tablet on
 * a mic stand) - the center passes what this computer shows to it.
 * How it looks is set in Settings on this computer (Settings → Confidence monitor): every colour, the font, size, how
 * many next lines, and each part on or off. */
(function () {
  "use strict";
  var CU = window.CentralUsage, NAT = window.CU, V = window.CUConfView; if (!CU || !V) return;
  var C = window.PPChords;
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var look = V.look(CU.store.get("confLook", null));
  var msg = null, lastSent = "", lastSentAt = 0, out = { screen: false, ndi: { on: false }, display: null }, screens = [];
  var open = CU.store.get("confOpen", true);

  // ------------------------------------------------------------- what the band's screen shows now
  function norm(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
  var chordCache = { text: null, parsed: null };
  function chordsOf(section) {
    var text = window.CentralUsageChartText ? window.CentralUsageChartText() : ""; if (!text || !C || !section) return [];
    if (chordCache.text !== text) { chordCache.text = text; try { chordCache.parsed = C.parseChart(text); } catch (_) { chordCache.parsed = null; } }
    var p = chordCache.parsed; if (!p) return [];
    var sec = p.sections.filter(function (q) { return norm(q.name) === norm(section); })[0] || p.sections.filter(function (q) { return norm(q.name).replace(/\d+$/, "") === norm(section).replace(/\d+$/, ""); })[0]; if (!sec) return [];
    var d = CU.state.display || {}, shift = 0, flats = false;
    if (p.key && d.key && C.noteIndex) { var a = C.noteIndex(p.key), b = C.noteIndex(d.key); if (a >= 0 && b >= 0) shift = (b - a + 12) % 12; flats = C.keyPrefersFlats ? C.keyPrefersFlats(d.key) : false; }
    var list = []; sec.lines.forEach(function (ln) { (ln.tokens || []).forEach(function (t) { if (t.c) { var c = shift ? C.transpose(t.c, shift, flats) : t.c; if (list[list.length - 1] !== c) list.push(c); } }); });
    return list.slice(0, 16);
  }
  function runInfo() {
    var S = window.CUServices && window.CUServices.state(); if (!S) return {};
    var t = Date.now() + (S.offset || 0);
    if (S.run) {
      var sv = S.services.filter(function (x) { return x.id === S.run.service; })[0]; if (!sv) return {};
      var it = sv.items[S.run.item] || {}, nx = sv.items[S.run.item + 1], left = (Number(it.minutes) || 0) * 60 - (t - S.run.itemStart) / 1000;
      return { nextItem: nx ? { title: nx.title, in: Math.max(0, left) } : null, lowerThird: (it.cues && it.cues.lowerThird) || "" };
    }
    var best = null; (S.services || []).forEach(function (sv) { var at = window.CUCountdown ? window.CUCountdown.nextStart(sv, t) : 0; if (at > t && at - t < 3600000 && (!best || at < best.at)) best = { sv: sv, at: at }; });
    return best ? { nextItem: { title: best.sv.name + " starts", in: (best.at - t) / 1000 } } : {};
  }
  function state() {
    var d = CU.state.display || {}, ls = d.lyrics || {}, ri = runInfo(), sec = ls.section || (d.section && d.section.name) || "";
    return { song: d.song ? d.song.name : "", section: sec, lines: ls.lines || [], next: ls.next || [], nextSection: ls.nextSection || (d.next && d.next.name) || "",
      chords: look.chords ? chordsOf(sec) : [], left: d.song && d.duration ? Math.max(0, d.duration - (d.pos || 0)) : null, playing: !!d.playing, key: d.key || "", bpm: d.bpm || null,
      nextItem: ri.nextItem || null, lowerThird: ri.lowerThird || "", look: look, at: Date.now() };
  }
  // this computer runs the lyrics: it's the one the band's screens follow
  function runsLyrics() { var r = CU.role(); if (r !== "admin" && r !== "main") return false; var j = CU.jobs(); if (j[0] !== "general" && j.indexOf("lyrics") < 0) return false; return CU.runs("lyrics") !== false; }
  function push(force) {
    var st = state(), key = JSON.stringify(Object.assign({}, st, { at: 0, left: st.left != null ? Math.round(st.left / 5) : null, nextItem: st.nextItem ? { title: st.nextItem.title, in: Math.round(st.nextItem.in / 10) } : null }));
    paintPreview(st);
    if (!runsLyrics()) return;
    if (!force && key === lastSent && Date.now() - lastSentAt < 5000) return;
    lastSent = key; lastSentAt = Date.now();
    CU.send({ type: "confidence", action: "state", state: st });
    if (NAT && NAT.confidence) NAT.confidence.show({ state: st });
  }
  CU.on("message", function (m) {
    if (m.type === "display") setTimeout(push, 0);
    else if (m.type === "confidenceMessage") { msg = m.message; if (NAT && NAT.confidence) NAT.confidence.show({ message: msg }); paintPreview(); paintPanel(); }
    else if (m.type === "confidence" && m.message !== undefined) { msg = m.message; paintPreview(); }
  });
  CU.on("services", function () { push(true); });
  CU.on("runners", function () { push(true); });
  CU.on("center", function (on) { if (on) { CU.send({ type: "confidence", action: "watch" }); setTimeout(function () { push(true); }, 500); } });
  setInterval(function () { push(false); var o = $("#confLookPreview"); if (o && !o.__cfv) paintCardPreview(); }, 1000);

  // ------------------------------------------------------------- the Lyrics tab: house lyrics, then the confidence monitor
  function ensurePanel() {
    var view = $("#view-lyrics"); if (!view || $("#confPanel")) return $("#confPanel");
    var lyr = $("#lyrics"); if (!lyr) return null;
    var hh = document.createElement("div"); hh.className = "lyr-head admin-only"; hh.innerHTML = '<b>House lyrics</b> <span class="muted small">what the room sees</span>';
    lyr.parentNode.insertBefore(hh, lyr);
    var p = document.createElement("section"); p.id = "confPanel"; p.className = "conf-panel admin-only"; lyr.parentNode.insertBefore(p, lyr.nextSibling);
    return p;
  }
  function tabletUrl() {
    var urls = window.CUCenter && window.CUCenter.phoneUrls ? window.CUCenter.phoneUrls() : [];
    if (urls.length) return urls[0].replace(/\/cu\/$/, "/cu/confidence.html");
    var t = window.CUCenter && window.CUCenter.target && window.CUCenter.target();
    return t && t.host && t.host !== "127.0.0.1" ? "http://" + t.host + ":" + t.port + "/cu/confidence.html" : "";
  }
  function status() {
    var bits = []; if (out.screen) bits.push("on " + (screenName(out.display) || "a screen")); if (out.ndi && out.ndi.on) bits.push("NDI");
    return { on: !!(out.screen || (out.ndi && out.ndi.on)), text: bits.length ? "Showing " + bits.join(" and ") : runsLyrics() ? "Not on a screen here (a tablet can open the link)" : "This computer doesn't run the lyrics" };
  }
  function screenName(id) { var s = screens.filter(function (x) { return x.id === id; })[0]; return s ? s.label + (s.size ? " (" + s.size.width + "×" + s.size.height + ")" : "") : ""; }
  function paintPanel() {
    var p = ensurePanel(); if (!p) return;
    var a = document.activeElement; if (p.contains(a) && a.tagName === "INPUT") return;
    var url = tabletUrl(), runs = runsLyrics(), app = !!(NAT && NAT.confidence);
    p.innerHTML = '<div class="conf-bar"><b>Confidence monitor</b> <span class="muted small">what the band sees</span><span class="spacer"></span>' +
      (app ? '<label>Screen <select id="confScreen">' + screens.map(function (s) { return '<option value="' + s.id + '"' + ((out.display || CU.store.get("confDisplay", null)) === s.id ? " selected" : "") + ">" + esc(s.label) + (s.primary ? " (this one)" : "") + "</option>"; }).join("") + "</select></label>" +
        '<button data-cf="screen" class="' + (out.screen ? "on" : "") + '">' + (out.screen ? "On the screen ✓" : "Show on the screen") + "</button>" +
        '<label class="toggle" title="Send the band\'s screen over the network as NDI (a video switcher or another computer can take it)"><input type="checkbox" data-cf="ndi"' + (out.ndi && out.ndi.on ? " checked" : "") + "> NDI</label>" : "") +
      '<button data-cf="settings" title="Colours, font, size and what it shows">Look…</button><button class="mini" data-cf="fold">' + (open ? "Hide" : "Show") + "</button></div>" +
      (open ? '<div class="conf-body"><div class="conf-preview" id="confPreview" data-preview="1"></div><div class="conf-side">' +
        (url ? '<p class="small">On a tablet on stage, open<br><b class="conf-url">' + esc(url) + "</b></p>" : '<p class="muted small">A tablet on the church Wi-Fi can show it too, once the main admin\'s computer is on.</p>') +
        (!runs ? '<p class="warn small">Another computer runs the lyrics, so the band\'s screens follow that one.</p>' : "") +
        (out.ndi && out.ndi.error ? '<p class="warn small">NDI: ' + esc(out.ndi.error) + "</p>" : "") +
        '<div class="conf-msgs"><span class="muted small">Message to the band:</span>' + ["One more chorus", "Wrap it up", "Two minutes", "Watch me"].map(function (t) { return '<button class="mini" data-cfm="' + esc(t) + '">' + esc(t) + "</button>"; }).join("") +
        '<input id="confMsgText" placeholder="Type a message…" maxlength="120"><button class="mini" data-cf="msgSend">Send</button><button class="mini" data-cf="msgClear">Clear</button>' +
        (msg && msg.text ? '<p class="small">Showing: “' + esc(msg.text) + "”</p>" : "") + "</div></div></div>" : "");
    paintPreview();
  }
  function paintPreview(st) { var el = $("#confPreview"); if (el) V.render(el, st || state(), look, msg); }
  document.addEventListener("click", async function (e) {
    var b = e.target.closest && e.target.closest("#confPanel button"); if (!b) return;
    var k = b.dataset.cf;
    if (b.dataset.cfm) { CU.send({ type: "confidence", action: "message", text: b.dataset.cfm, seconds: 30 }); return; }
    if (k === "fold") { open = !open; CU.store.set("confOpen", open); paintPanel(); return; }
    if (k === "settings") { CU.store.set("stGroupWant", "confidence"); if (window.CentralUsage) document.querySelector('[data-tab="settings"]').click(); setTimeout(function () { var c = document.getElementById("confCard"); if (c) c.scrollIntoView({ block: "start" }); }, 200); return; }
    if (k === "msgSend") { var t = $("#confMsgText"); if (t && t.value.trim()) { CU.send({ type: "confidence", action: "message", text: t.value.trim(), seconds: 45 }); t.value = ""; } return; }
    if (k === "msgClear") { CU.send({ type: "confidence", action: "clear" }); return; }
    if (k === "screen" && NAT && NAT.confidence) {
      var sel = $("#confScreen"), id = sel ? Number(sel.value) : null; if (id) CU.store.set("confDisplay", id);
      var r = await NAT.confidence.screen({ on: !out.screen, displayId: id }); out.screen = !!(r && r.on); out.display = r && r.display || null; push(true); paintPanel();
    }
  });
  document.addEventListener("change", async function (e) {
    var t = e.target;
    if (t.dataset && t.dataset.cf === "ndi" && NAT && NAT.confidence) { out.ndi = await NAT.confidence.ndi({ on: t.checked, name: "Band's screen · " + ((CU.config() || {}).name || "Central Control") }) || { on: false }; push(true); paintPanel(); return; }
    if (t.id === "confScreen" && out.screen && NAT && NAT.confidence) { var r = await NAT.confidence.screen({ on: true, displayId: Number(t.value) }); out.display = r && r.display || null; CU.store.set("confDisplay", Number(t.value)); }
    if (t.dataset && t.dataset.cfl) onLook(t);
  });
  document.addEventListener("input", function (e) { var t = e.target; if (t.dataset && t.dataset.cfl && (t.type === "range" || t.type === "color")) onLook(t); });
  document.addEventListener("keydown", function (e) { if (e.target && e.target.id === "confMsgText" && e.key === "Enter") { var b = $('#confPanel [data-cf="msgSend"]'); if (b) b.click(); } });

  // ------------------------------------------------------------- Settings → Confidence monitor (this computer)
  function onLook(t) {
    var k = t.dataset.cfl, v = t.type === "checkbox" ? t.checked : t.type === "range" || t.type === "number" ? Number(t.value) : t.value;
    if (k === "reset") return;
    look[k] = v; CU.store.set("confLook", look); push(true);
    var o = $("#confLookPreview"); if (o) V.render(o, state(), look, msg || { text: look.messages ? "One more chorus" : "", flash: false });
  }
  function card() {
    if (CU.mode() !== "admin" || CU.edition() === "usage") return "";
    var L = look, chk = function (k, label) { return '<label class="toggle"><input type="checkbox" data-cfl="' + k + '"' + (L[k] ? " checked" : "") + "> " + label + "</label>"; };
    return '<section class="card" id="confCard"><h3>Confidence monitor (the band\'s screen)</h3><p class="muted small">How the band\'s screen looks when this computer runs the lyrics.</p>' +
      '<div class="conf-look-prev" id="confLookPreview" data-preview="1"></div>' +
      '<div class="row"><label>Now <input type="color" data-cfl="cur" value="' + esc(L.cur) + '"></label><label>Next <input type="color" data-cfl="next" value="' + esc(L.next) + '"></label><label>Background <input type="color" data-cfl="bg" value="' + esc(L.bg) + '"></label>' +
      '<label>Font <select data-cfl="font">' + ["Inter", "Archivo", "Arial", "Georgia", "Verdana", "system-ui"].map(function (f) { return "<option" + (L.font === f ? " selected" : "") + ">" + f + "</option>"; }).join("") + "</select></label></div>" +
      '<div class="row"><label>Size <input type="range" min="4" max="16" step="0.5" data-cfl="size" value="' + L.size + '"></label><label>Next lines <select data-cfl="nextLines">' + [0, 1, 2, 3, 4].map(function (n) { return "<option" + (Number(L.nextLines) === n ? " selected" : "") + ">" + n + "</option>"; }).join("") + "</select></label>" +
      '<label>Align <select data-cfl="align">' + ["left", "center"].map(function (a) { return "<option" + (L.align === a ? " selected" : "") + ">" + a + "</option>"; }).join("") + "</select></label></div>" +
      '<div class="row">' + chk("chords", "Chords") + chk("section", "Section name") + chk("clock", "Clock") + chk("songLeft", "Song time left") + chk("countdown", "Countdown to the next item") + chk("messages", "Messages from the booth") + chk("caps", "ALL CAPS") + "</div>" +
      '<div class="row"><button data-cfl-reset>Back to yellow and white</button></div></section>';
  }
  document.addEventListener("click", function (e) { var b = e.target.closest && e.target.closest("[data-cfl-reset]"); if (!b) return; look = V.look(null); CU.store.set("confLook", look); push(true); if (window.CUSettings) { var r = document.getElementById("settingsRoot"); if (r) r.__h = ""; window.CUSettings.render(); } setTimeout(paintCardPreview, 50); });
  function paintCardPreview() { var o = $("#confLookPreview"); if (o) V.render(o, state(), look, { text: look.messages ? "One more chorus" : "", flash: false }); }

  // ------------------------------------------------------------- outputs
  async function refreshOutputs() {
    if (!NAT || !NAT.confidence) return;
    try { screens = await NAT.slides.screens(); } catch (_) { screens = []; }
    try { var s = await NAT.confidence.status(); out.screen = !!s.screen; out.display = s.display || null; out.ndi = s.ndi || { on: false }; } catch (_) { }
    paintPanel();
  }
  if (NAT && NAT.confidence && NAT.confidence.onStatus) NAT.confidence.onStatus(function (s) { if (s.screen !== undefined) out.screen = s.screen; if (s.ndi) out.ndi = s.ndi; paintPanel(); });
  CU.on("tab", function (t) { if (t === "lyrics") { refreshOutputs(); paintPanel(); } if (t === "settings") setTimeout(paintCardPreview, 60); });
  CU.on("role", function () { paintPanel(); });
  CU.on("jobs", function () { paintPanel(); });
  setTimeout(function () { refreshOutputs(); paintPanel(); }, 300);
  window.CUConfidence = { state: state, look: function () { return look; }, setLook: function (o) { look = V.look(Object.assign({}, look, o)); CU.store.set("confLook", look); push(true); }, card: card, status: status, push: push, preview: paintPreview, outputs: function () { return out; }, tabletUrl: tabletUrl };
})();
