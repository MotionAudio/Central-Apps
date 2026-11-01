/* Central Control (10.2) - the band's screen (the confidence monitor): how it looks. Used by the screen itself
 * (confidence.html, full screen on a monitor facing the stage, or in a tablet's browser) and by the preview on the
 * Lyrics tab, so both show exactly the same.
 *
 *   the song · the section ............................ clock · song 2:31 left · next: Sermon in 4:10
 *   [the booth's message, flashing]
 *   the lines being sung now                                  (default yellow)
 *   G   D   Em   C                                            (the section's chords, if on)
 *   Chorus ▸ the next lines                                    (default white)
 *   lower third: Pastor Dan · Grace that finds us
 *
 * state: { song, section, lines[], next[], nextSection, chords[], left, playing, key, bpm, nextItem: {title, in}, lowerThird }
 * look:  { cur, next, bg, font, size, nextLines, chords, section, clock, songLeft, countdown, messages, caps, align } */
(function (root) {
  "use strict";
  var DEFAULTS = { cur: "#FFD60A", next: "#FFFFFF", bg: "#000000", font: "Inter", size: 9, nextLines: 2, chords: true, section: true, clock: true, songLeft: true, countdown: true, messages: true, caps: false, align: "left" };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function fmt(sec) { sec = Math.max(0, Math.round(sec || 0)); var m = Math.floor(sec / 60), s = sec % 60; return m + ":" + (s < 10 ? "0" : "") + s; }
  function look(o) { var out = {}, k; for (k in DEFAULTS) out[k] = DEFAULTS[k]; if (o) for (k in o) if (o[k] != null && DEFAULTS[k] !== undefined) out[k] = o[k]; return out; }
  var CSS = ".cfv{position:relative;height:100%;width:100%;box-sizing:border-box;display:flex;flex-direction:column;padding:3% 4%;overflow:hidden;color:#fff;--u:1vh}" +
    ".cfv-top{display:flex;gap:2em;align-items:baseline;font-size:calc(var(--u)*3.4);opacity:.75;font-weight:600;white-space:nowrap}.cfv-top .sp{flex:1}.cfv-top b{font-weight:800}" +
    ".cfv-msg{margin:1.2% 0;padding:.35em .6em;border-radius:.3em;background:#E5484D;color:#fff;font-weight:800;font-size:calc(var(--u)*6);text-align:center}.cfv-msg.flash{animation:cfvf 1s steps(1) infinite}@keyframes cfvf{50%{background:#7a1d20}}" +
    ".cfv-main{flex:1;display:flex;flex-direction:column;justify-content:center;min-height:0}.cfv-cur{font-weight:800;line-height:1.15;font-size:calc(var(--u)*var(--sz))}.cfv-cur div{margin:.06em 0}" +
    ".cfv-ch{margin:.5em 0 .2em;font-weight:800;font-size:calc(var(--u)*var(--sz)*.55);color:#7FD1FF;letter-spacing:.04em;word-spacing:.6em}" +
    ".cfv-next{margin-top:.6em;font-weight:650;line-height:1.2;font-size:calc(var(--u)*var(--sz)*.62);opacity:.92}.cfv-next .sec{font-size:.55em;letter-spacing:.12em;text-transform:uppercase;opacity:.7;display:block;margin-bottom:.2em}" +
    ".cfv-lt{font-size:calc(var(--u)*3.2);opacity:.8;border-top:1px solid rgba(255,255,255,.2);padding-top:.4em}.cfv-empty{opacity:.5;font-size:calc(var(--u)*5)}.cfv.caps .cfv-cur,.cfv.caps .cfv-next{text-transform:uppercase}";
  function html(st, lk, msg, now) {
    st = st || {}; lk = look(lk); now = now || Date.now();
    var top = [];
    if (st.song) top.push("<b>" + esc(st.song) + "</b>" + (lk.section && st.section ? " · " + esc(st.section) : ""));
    else if (lk.section && st.section) top.push("<b>" + esc(st.section) + "</b>");
    top.push('<span class="sp"></span>');
    if (lk.clock) top.push(new Date(now).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
    if (lk.songLeft && st.left != null && st.song) top.push("song " + fmt(st.left) + " left");
    if (lk.countdown && st.nextItem && st.nextItem.title) top.push("next: " + esc(st.nextItem.title) + (st.nextItem.in != null ? " in " + fmt(st.nextItem.in) : ""));
    var lines = st.lines || [], next = (st.next || []).slice(0, Math.max(0, Number(lk.nextLines) || 0));
    var body = lines.length ? '<div class="cfv-cur" style="color:' + esc(lk.cur) + '">' + lines.map(function (l) { return "<div>" + esc(l) + "</div>"; }).join("") + "</div>" : '<div class="cfv-empty">' + (st.song ? (st.section ? esc(st.section) + " · no words" : "Waiting for the song…") : "Waiting for the lyrics computer…") + "</div>";
    if (lk.chords && st.chords && st.chords.length) body += '<div class="cfv-ch">' + st.chords.map(esc).join("  ") + "</div>";
    if (next.length) body += '<div class="cfv-next" style="color:' + esc(lk.next) + '">' + (lk.section && st.nextSection && st.nextSection !== st.section ? '<span class="sec">' + esc(st.nextSection) + "</span>" : "") + next.map(esc).join("<br>") + "</div>";
    var m = lk.messages && msg && msg.text && (!msg.until || msg.until > now) ? '<div class="cfv-msg' + (msg.flash !== false ? " flash" : "") + '">' + esc(msg.text) + "</div>" : "";
    return '<div class="cfv' + (lk.caps ? " caps" : "") + '" style="background:' + esc(lk.bg) + ";font-family:" + esc(lk.font) + ",Inter,system-ui,sans-serif;text-align:" + esc(lk.align) + ";--sz:" + (Number(lk.size) || 9) + '">' +
      '<div class="cfv-top">' + top.join("") + "</div>" + m + '<div class="cfv-main">' + body + "</div>" + (st.lowerThird ? '<div class="cfv-lt">Lower third: ' + esc(st.lowerThird) + "</div>" : "") + "</div>";
  }
  // draw into an element (u: the height unit - 1vh full screen, or a preview box's height / 100)
  function render(el, st, lk, msg) {
    if (!el) return;
    if (!document.getElementById("cfv-css")) { var s = document.createElement("style"); s.id = "cfv-css"; s.textContent = CSS; document.head.appendChild(s); }
    var h = html(st, lk, msg);
    if (el.__cfv !== h) { el.__cfv = h; el.innerHTML = h; }
    var box = el.firstChild; if (box && el.dataset.preview) box.style.setProperty("--u", (el.clientHeight / 100) + "px");
  }
  root.CUConfView = { DEFAULTS: DEFAULTS, look: look, html: html, render: render, fmt: fmt, CSS: CSS };
})(typeof window !== "undefined" ? window : this);
