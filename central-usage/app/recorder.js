/* Central Control - the recording control: Start / Stop, the time, the free disk space (a warning under 10 GB), where
 * it goes and what was saved. On the Online mix tab and in the I/O tab's "Listening & recording" card: any element with
 * data-rec-slot gets the control (data-rec-folder adds the folder row). The audio host records (recorder.js in
 * the main process: every input, the Central Pedal's tracks and the stereo program, then the program's MP3); an
 * admin on another computer starts / stops it over the link to the audio host.
 * window.CURecUI: fill(root), state(), start(name), stop(). The API for other features: window.CU.recorder. */
(function () {
  "use strict";
  var CU = window.CentralUsage, NAT = window.CU, X = window.CUMix; if (!CU) return;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function base(p) { return String(p || "").split(/[\\/]/).pop(); }
  function fmtT(s) { s = Math.max(0, Math.floor(s || 0)); var h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60; return (h ? h + ":" + (m < 10 ? "0" : "") : "") + m + ":" + (x < 10 ? "0" : "") + x; }
  function gb(b) { return b == null ? "" : b >= 1e12 ? (b / 1e12).toFixed(1) + " TB" : b >= 1e9 ? Math.round(b / 1e9) + " GB" : Math.round(b / 1e6) + " MB"; }
  var st = null, at = 0, busy = false, err = "", seq = 0, waits = {};
  function local() { return !!(X && X.kind === "local" && NAT && NAT.recorder); }
  function remote() { return !!(X && X.kind === "remote" && X.link && X.link()); }
  function admin() { return CU.isAdmin ? CU.isAdmin() : CU.mode() === "admin"; }
  function setState(s) { if (s) { st = s; at = Date.now(); } paint(); }
  if (NAT && NAT.recorder) NAT.recorder.on(function (s) { if (local()) setState(s); });
  if (X) {
    X.on("recState", function (s, m) { if (!remote()) return; if (m && m.seq && waits[m.seq]) { waits[m.seq](m); delete waits[m.seq]; } setState(s); });
    X.on("state", function () { refresh(); });
  }
  function refresh() { if (local()) NAT.recorder.state().then(setState).catch(function () { }); else if (!remote()) { st = null; paint(); } }
  function ask(action, name) {   // the audio host's recorder: here (IPC) or over the link
    if (local()) return (action === "start" ? NAT.recorder.start({ name: name }) : NAT.recorder.stop()).then(function (r) { return { state: r.state, error: r.error }; });
    if (!remote()) return Promise.resolve({ error: "Recording happens on the audio host." });
    return new Promise(function (resolve) { var s = ++seq; waits[s] = function (m) { resolve({ state: m.state, error: m.error }); }; X.link().send({ type: "recorder", action: action, name: name, seq: s }); setTimeout(function () { if (waits[s]) { delete waits[s]; resolve({ error: "The audio host did not answer." }); } }, 20000); });
  }
  async function start(name) {
    if (busy) return; busy = true; err = ""; paint();
    var r = await ask("start", name != null ? name : CU.store.get("recName", "")); busy = false;
    if (r.error) err = r.error; setState(r.state); return r;
  }
  async function stop() {
    if (busy) return; busy = true; err = ""; paint(); var r = await ask("stop"); busy = false;
    if (r.error) err = r.error; else { CU.store.set("recName", ""); document.querySelectorAll('[data-rec="name"]').forEach(function (o) { o.value = ""; }); }   // (next service: a new name)
    setState(r.state); return r;
  }
  function seconds() { if (!st) return 0; return st.recording ? (st.seconds || 0) + (Date.now() - at) / 1000 : st.seconds || 0; }

  // ------------------------------------------------------------------ the control
  function control(withFolder) {
    return '<div class="rec-ctl"><button data-rec="go" class="rec-btn"></button><span class="rec-time"></span>' +
      '<input data-rec="name" class="rec-name" placeholder="Service name (optional)" value="' + esc(CU.store.get("recName", "")) + '" maxlength="60">' +
      '<span class="rec-free muted small"></span>' + (local() ? '<button data-rec="open" title="Open the recordings folder">Recordings</button>' : "") + "</div>" +
      (withFolder && local() ? '<div class="rec-folder muted small">Folder: <span class="rec-dir"></span> <button data-rec="dir" class="mini">Change…</button></div>' : "") +
      '<div class="rec-msg small"></div>';
  }
  function fill(root) {
    (root || document).querySelectorAll("[data-rec-slot]").forEach(function (slot) {
      if (!admin()) { slot.innerHTML = ""; return; }
      if (!local() && !remote()) { slot.innerHTML = '<span class="muted small">Recording happens on the audio host.</span>'; return; }
      slot.innerHTML = control(slot.hasAttribute("data-rec-folder"));
    });
    if (!st) refresh(); paint();
  }
  function paint() {
    var s = st || {}, on = !!s.recording, t = seconds();
    document.querySelectorAll(".rec-ctl").forEach(function (c) {
      var b = c.querySelector('[data-rec="go"]'); if (!b) return;
      b.classList.toggle("rec", on); b.disabled = busy || !!s.starting || !!s.stopping;
      b.textContent = s.starting ? "Starting…" : s.stopping ? "Saving…" : on ? "■ Stop" : "● Record";
      c.querySelector(".rec-time").textContent = on ? fmtT(t) : "";
      var free = c.querySelector(".rec-free"); free.textContent = s.free != null ? gb(s.free) + " free" + (s.lowSpace ? " - under 10 GB!" : "") : ""; free.classList.toggle("warn", !!s.lowSpace);
      var nm = c.querySelector('[data-rec="name"]'); if (nm && document.activeElement !== nm) nm.disabled = on;
    });
    var msg = err ? '<span class="bad">' + esc(err) + "</span>" : s.error ? '<span class="bad">' + esc(s.error) + "</span>" : "";
    if (!msg && on) msg = '<span class="muted">' + (s.tracks || 0) + " tracks → " + esc(base(s.folder)) + (s.dropped ? ' · <span class="warn">' + (s.dropped / 48000).toFixed(2) + " s of audio lost (the disk was too slow)</span>" : "") + "</span>";
    if (!msg && s.last && s.last.folder) {
      var mp3 = s.mp3 ? (s.mp3.state === "making" ? " · making the MP3…" : s.mp3.state === "done" ? " · MP3 ✓" : s.mp3.state === "error" ? ' · <span class="warn">' + esc(s.mp3.error) + "</span>" : "") : "";
      msg = '<span class="muted">Saved ' + fmtT(s.last.seconds) + " · " + (s.last.files || []).length + " files in " + esc(base(s.last.folder)) + mp3 + "</span>" + (local() ? ' <button data-rec="last" class="mini">Open</button>' : "");
    }
    document.querySelectorAll(".rec-msg").forEach(function (el) { el.innerHTML = msg; });
    document.querySelectorAll(".rec-dir").forEach(function (el) { el.textContent = s.root || ((CU.config() || {}).recordDir) || ""; });
  }
  setInterval(function () { if (st && st.recording) paint(); }, 500);
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-rec]"); if (!b || b.tagName === "INPUT") return;
    var a = b.dataset.rec;
    if (a === "go") { if (st && st.recording) stop(); else { var nm = b.closest(".rec-ctl").querySelector('[data-rec="name"]'); start(nm ? nm.value.trim() : ""); } }
    else if (a === "open" && NAT && NAT.recorder) NAT.recorder.open("root");
    else if (a === "last" && NAT && NAT.recorder) NAT.recorder.open("last");
    else if (a === "dir" && NAT && NAT.recorder) NAT.recorder.chooseDir().then(setState);
  });
  document.addEventListener("input", function (e) { var t = e.target; if (t.dataset && t.dataset.rec === "name") { CU.store.set("recName", t.value); document.querySelectorAll('[data-rec="name"]').forEach(function (o) { if (o !== t) o.value = t.value; }); } });
  window.CURecUI = { fill: fill, state: function () { return st; }, start: start, stop: stop, refresh: refresh };
})();
