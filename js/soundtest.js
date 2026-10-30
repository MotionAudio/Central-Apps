/* Central Pedal - Settings → Audio: "Test sound" and "Audio input" (9.9.1).
 *
 * Test sound: a tone on each output channel (past the buses and the routing), a tone straight on each sound card
 * (from the Pi itself, not through the app), and "Check where the sound goes" - the driver says what the app plays
 * into and fixes what it can (the default output, a stream stuck on HDMI, a muted jack).
 * Audio input: which device and which of its inputs the pads' Audio input uses (a USB interface's input 1, 2 or both).
 */
(function () {
  "use strict";
  var PP = window.PP, F = window.PPFeatures; if (!PP || !F) return;
  var esc = PP.escapeHtml;
  function bridge() { return window.__pedalBridge; }
  function connected() { return !!(bridge() && bridge().connected); }
  function send(m) { return bridge() && bridge().send ? bridge().send(m) : false; }
  function project() { return PP.project(); }

  var check = null, cards = [], cardsBusy = false, playing = 0, inputs = [];

  function channels() {
    var st = F.systemStatus ? F.systemStatus() : null, list = st && st.audio && st.audio.channels;
    if (list && list.length) return list;
    var n = PP.engine && PP.engine.ctx ? Math.max(2, PP.engine.ctx.destination.maxChannelCount || 2) : 2, out = [];
    for (var i = 1; i <= Math.min(n, 8); i++) out.push(i === 1 ? "Left" : i === 2 ? "Right" : "Output " + i);
    return out;
  }

  function checkHtml() {
    if (!check) return "";
    var lines = [];
    var cardsTxt = (check.planned || []).map(function (c) { return esc(c.desc || c.name) + " (" + c.channels + ")"; }).join(" + ");
    lines.push("<li>The app plays into: <b>" + (check.appStreams && check.appStreams.length ? esc(check.appStreams.map(function (s) { return s.sinkName === "padpedal_out" ? "the combined output" : s.sinkName || "?"; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(", ")) : "nothing right now (start a pad, then check again)") + "</b></li>");
    lines.push("<li>The combined output: " + (cardsTxt ? cardsTxt : "<b>no sound cards</b>") + (check.default ? " · default output: " + esc(check.default === "padpedal_out" ? "the combined output" : check.default) : "") + "</li>");
    if (check.jack) lines.push("<li>Headphone jack: " + (check.jack.muted ? "<b>was muted</b>" : "on") + (check.jack.text ? ", level " + esc(check.jack.text) : "") + "</li>");
    (check.found || []).forEach(function (f) { lines.push('<li class="warn-line">' + esc(f) + "</li>"); });
    (check.fixed || []).forEach(function (f) { lines.push("<li>✓ " + esc(f) + "</li>"); });
    if (check.ok) lines.push("<li>✓ Everything looks right. Still nothing? Try the sound cards below - if they're silent too, it's the headphones, the cable or the socket.</li>");
    return '<ul class="st-check">' + lines.join("") + "</ul>";
  }

  function html() {
    var chs = channels(), on = connected();
    var src = project().inputSource || {};
    return '<section data-st="audio" id="soundTest"><h3>Test sound</h3>' +
      '<p class="muted">Play a short tone on each output. If you hear these but not a pad, it\'s the routing above. If you don\'t hear these either, try the sound cards straight from the Pi.</p>' +
      '<div class="row st-tones">' + chs.map(function (name, i) { return '<button data-stt="ch" data-ch="' + (i + 1) + '"' + (playing === i + 1 ? ' class="on"' : "") + ">▶ " + (i + 1) + " · " + esc(name) + "</button>"; }).join("") + "</div>" +
      (on ? '<div class="row"><button data-stt="check">Check where the sound goes</button><button data-stt="cards"' + (cardsBusy ? " disabled" : "") + ">" + (cardsBusy ? "Playing…" : "Play on each sound card") + "</button></div>" + checkHtml() +
        (cards.length ? '<ul class="st-check">' + cards.map(function (c) { return "<li>" + (c.busy ? "▶ " : c.ok ? "✓ " : "✗ ") + esc(c.desc) + (c.ok === false ? " - " + esc(c.error || "didn't play") : "") + "</li>"; }).join("") + "</ul>" : "") : "") +
      "</section>" +
      '<section data-st="audio" id="audioInputSec"><h3>Audio input</h3><p class="muted">Where the pads\' Audio input (and a looper set to the audio input) listens. A USB audio interface\'s inputs show here once it\'s plugged in. The guitar / keys input is set on the Instrument tab.</p>' +
      '<label>Device<select data-stt="inDev"><option value="">The default input</option>' + inputs.map(function (d) { return '<option value="' + esc(d.deviceId) + '"' + (src.deviceId === d.deviceId ? " selected" : "") + ">" + esc(d.label || "Input " + d.deviceId.slice(0, 6)) + "</option>"; }).join("") + "</select></label>" +
      '<label>Which input<select data-stt="inCh">' + [["", "Both (1 + 2)"], ["1", "Input 1 (left)"], ["2", "Input 2 (right)"]].map(function (o) { return '<option value="' + o[0] + '"' + ((src.channel || "") === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join("") + "</select></label></section>";
  }

  function rerender() {
    var a = document.getElementById("soundTest"), b = document.getElementById("audioInputSec"); if (!a) return;
    var tmp = document.createElement("div"); tmp.innerHTML = html();
    a.replaceWith(tmp.children[0]); if (b) b.replaceWith(tmp.children[0]);
  }

  async function listInputs() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    try { inputs = (await navigator.mediaDevices.enumerateDevices()).filter(function (d) { return d.kind === "audioinput" && d.deviceId && d.deviceId !== "default" && d.deviceId !== "communications"; }); } catch (_) { inputs = []; }
  }

  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-stt]"); if (!b || b.tagName === "SELECT") return;
    var what = b.dataset.stt;
    if (what === "ch") { var ch = Number(b.dataset.ch) || 1; if (PP.engine && PP.engine.testChannel) { PP.engine.testChannel(ch); playing = ch; rerender(); setTimeout(function () { if (playing === ch) { playing = 0; rerender(); } }, 900); } }
    else if (what === "check") { check = { found: [], fixed: [], planned: [], appStreams: [] }; send({ type: "system", action: "audioCheck" }); }
    else if (what === "cards") { cards = []; cardsBusy = true; rerender(); send({ type: "system", action: "audioCardTest" }); }
  });
  document.addEventListener("change", function (e) {
    var el = e.target; if (!el.dataset || !el.dataset.stt) return;
    var p = project(), src = p.inputSource || (p.inputSource = {});
    if (el.dataset.stt === "inDev") src.deviceId = el.value || null;
    else if (el.dataset.stt === "inCh") src.channel = el.value || null;
    else return;
    PP.persistSoon && PP.persistSoon();
    if (PP.engine && PP.engine.inputVoice && PP.engine.setInput) { PP.engine.setInput(false).then(function () { return PP.engine.setInput(true); }); }   // (the Audio input on: switch over now)
  });
  F.on("audioCheck", function (m) { check = m; rerender(); });
  F.on("audioCardTest", function (m) {
    if (m.done) { cardsBusy = false; if (!m.count) cards = [{ desc: "No sound cards found", ok: false, error: "" }]; rerender(); return; }
    var c = cards.filter(function (x) { return x.sink === m.sink; })[0]; if (!c) { c = { sink: m.sink }; cards.push(c); }
    c.desc = m.desc; c.busy = !!m.busy; c.ok = m.busy ? null : !!m.ok; c.error = m.error; rerender();
  });
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) navigator.mediaDevices.addEventListener("devicechange", function () { listInputs().then(rerender); });
  listInputs();

  window.PPSoundTest = { html: html, refresh: function () { listInputs().then(rerender); } };
})();
