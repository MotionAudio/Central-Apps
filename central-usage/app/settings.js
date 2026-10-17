/* Central Usage - Settings: this computer (its name and role - roles.js - and, on the main admin, the People list), the lights' optional AI model,
 * updates and about. (Inputs, outputs and the audio host are on the I/O tab.) */
(function () {
  "use strict";
  var CU = window.CentralUsage, NAT = window.CU; if (!CU) return;
  function $(s, r) { return (r || document).querySelector(s); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var ai = null, version = null;
  function visible() { return CU.prefs.tab === "settings"; }
  function mb(n) { return Math.round((n || 0) / 1048576); }
  function aiCard() {
    if (!NAT || !NAT.ai) return '<section class="card"><h3>Lights: AI model (optional)</h3><p class="muted">Works in the Central Usage app.</p></section>';
    var a = ai || {}, d = a.download || {};
    return '<section class="card"><h3>Lights: AI model (optional)</h3><p class="muted">The Lighting tab\'s "Tell it the show" box understands plain words by itself (colours, levels, the groups and lights, sections, effects, the hits). A small local AI model can also read freer sentences - it runs on this computer, nothing goes to the internet.</p>' +
      '<table class="io-t"><tr><td>Model</td><td>' + esc(a.model || "") + " - " + (a.downloaded ? "✓ downloaded" : d.active ? "downloading… " + mb(d.got) + (d.total ? " / " + mb(d.total) : "") + " MB" : "not downloaded") + "</td></tr>" +
      "<tr><td>llama.cpp</td><td>" + (a.server ? "✓ " + esc(a.server) : 'not found - install <b>llama-server</b> (llama.cpp: your distribution\'s package, or github.com/ggml-org/llama.cpp)') + "</td></tr>" +
      (a.error ? '<tr><td></td><td class="warn">' + esc(a.error) + "</td></tr>" : "") + "</table>" +
      '<div class="row">' + (a.downloaded ? '<button data-st="ai-remove">Remove the model</button>' : '<button data-st="ai-download"' + (d.active ? " disabled" : "") + ">Download the model (about 400 MB)</button>") + '<label class="toggle"><input type="checkbox" data-st="ai-use"' + (CU.store.get("aiUse", true) ? " checked" : "") + "> Use it when it is ready</label></div></section>";
  }
  function mixCard() {   // where the tracks go out of the audio interface (also on the Mix tab)
    var X = window.CUMix, st = X && X.state; if (CU.mode() !== "admin") return "";
    if (!st) return '<section class="card"><h3>Tracks out of the interface</h3><p class="muted">Set when this computer (or another admin) is the audio host - I/O tab.</p></section>';
    return '<section class="card"><h3>Tracks out of the interface</h3><div class="io-opts"><label class="io-opt' + (st.trackOut !== "direct" ? " on" : "") + '"><input type="radio" name="stTrackOut" value="sum"' + (st.trackOut !== "direct" ? " checked" : "") + '><span><b>a) Mixed here, summed</b><small>faders, EQ, compressor on the Mix tab - out on two outputs (L / R)</small></span></label><label class="io-opt' + (st.trackOut === "direct" ? " on" : "") + '"><input type="radio" name="stTrackOut" value="direct"' + (st.trackOut === "direct" ? " checked" : "") + '><span><b>b) Each track on its own output</b><small>to the desk\'s inputs, one per track (from output ' + ((st.directFirst || 0) + 1) + ")</small></span></label></div><p class=\"muted small\">The outputs themselves are picked on the Mix tab.</p></section>";
  }
  function render() {
    var root = $("#settingsRoot"); if (!root || !visible()) return;
    var c = CU.config() || {}, m = CU.mode();
    root.innerHTML = '<div class="io-grid">' +
      (window.CURoles ? window.CURoles.card() : "") +
      mixCard() +
      aiCard() +
      (window.CULyricsListen ? window.CULyricsListen.card() : "") +
      '<section class="card"><h3>Updates</h3><p class="muted">Central Usage looks for a new version once a day and installs it only when you say so.</p><button data-st="updates">Check for updates…</button></section>' +
      '<section class="card"><h3>About</h3><p>Central Usage ' + esc(version && version.app || "") + '</p><p class="muted small">Companion app for Central Control: chord charts, lyrics, lighting (DMX + MIDI), the tracks mixer, in-ear mixes, slides.</p></section></div>';
  }
  var root = $("#settingsRoot");
  root.addEventListener("change", async function (e) {
    var t = e.target;
    if (t.name === "stTrackOut" && window.CUMix) { var st = window.CUMix.state; window.CUMix.op({ op: "trackOut", value: t.value, first: st ? st.directFirst || 0 : 0 }); setTimeout(render, 300); return; }
    if (window.CURoles && await window.CURoles.onSettingsChange(t)) { if (window.CUMix) window.CUMix.choose(); return; }
    if (t.dataset.st === "name") { var nm = t.value.trim(); CU.store.set("name", nm); var c = CU.config(); c.name = nm; if (NAT && NAT.config) CU.setConfig(await NAT.config.set({ name: nm })); else CU.setConfig(c); }
    else if (t.dataset.st === "ai-use") CU.store.set("aiUse", t.checked);
  });
  root.addEventListener("click", async function (e) {
    var b = e.target.closest("button"); if (!b) return;
    if (b.dataset.rl && window.CURoles) { await window.CURoles.onSettingsClick(b); if (window.CUMix) window.CUMix.choose(); return; }
    if (b.dataset.st === "updates" && window.CUUpdates) window.CUUpdates.open();
    else if (b.dataset.st === "ai-download") { NAT.ai.download().then(function (s) { ai = s; render(); }); setTimeout(function () { NAT.ai.status().then(function (s) { ai = s; render(); }); }, 300); }
    else if (b.dataset.st === "ai-remove") { ai = await NAT.ai.remove(); render(); }
  });
  if (NAT && NAT.ai) { NAT.ai.status().then(function (s) { ai = s; }); NAT.ai.on(function (s) { ai = s; if (visible()) render(); }); }
  if (NAT && NAT.version) NAT.version().then(function (v) { version = v; });
  CU.on("tab", function (t) { if (t === "settings") { if (NAT && NAT.ai) NAT.ai.status().then(function (s) { ai = s; render(); }); render(); } });
  CU.on("mode", function () { if (visible()) render(); });
  CU.on("connected", function () { if (visible()) render(); });
  window.CUSettings = { render: render };
})();
