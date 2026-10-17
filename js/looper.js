/* Central Pedal - looper for the guitar / keys (Instrument tab).
 *
 * The native instrument chain on the Pi also feeds a virtual microphone ("Central Pedal loop", made by
 * instrument_host.py when the looper is armed). The app records it here in an AudioWorklet, in time with
 * the song (a loop of 1, 2, 4 or 8 bars that starts on the next bar line) or free (tap to start, tap to
 * close the loop), and plays it back on the instrument output (channel 4 by default).
 * One footswitch does it all: record → play → overdub → play…; Stop, Undo and Clear are actions too.
 */
(function () {
  "use strict";
  var PP = window.PP; if (!PP) return;
  var clamp = PP.clamp, esc = PP.escapeHtml;
  function $(s, r) { return (r || document).querySelector(s); }
  function project() { return PP.project(); }
  function bridge() { return window.__pedalBridge; }
  function send(m) { return bridge() && bridge().send ? bridge().send(m) : false; }
  function T() { return window.PPTracks; }

  var WORKLET = function () {
    var MAX = 48000 * 90;
    class Looper extends AudioWorkletProcessor {
      constructor() {
        super(); this.L = new Float32Array(MAX); this.R = new Float32Array(MAX); this.uL = null; this.uR = null;
        this.state = "empty"; this.pos = 0; this.len = 0; this.startAt = -1; this.want = 0; this.comp = 0; this.level = 1; this.reported = "";
        this.port.onmessage = this.onMessage.bind(this);
      }
      onMessage(e) {
        var m = e.data;
        if (m.cmd === "rec") { this.L.fill(0); this.R.fill(0); this.len = 0; this.pos = 0; this.want = Math.min(MAX, Math.round(m.len || 0)); this.startAt = Math.round(m.at || 0); this.state = "armed"; this.uL = null; }
        else if (m.cmd === "close") { if (this.state === "recording" && !this.want) { this.len = Math.max(1, this.pos); this.pos = 0; this.state = "playing"; } }
        else if (m.cmd === "dub") { if (this.len && (this.state === "playing" || this.state === "stopped")) { this.uL = this.L.slice(0, this.len); this.uR = this.R.slice(0, this.len); this.state = "dubbing"; } }
        else if (m.cmd === "play") { if (this.len) { if (this.state === "stopped") this.pos = 0; this.state = "playing"; } }
        else if (m.cmd === "stop") { if (this.len) this.state = "stopped"; else this.state = "empty"; }
        else if (m.cmd === "undo") { if (this.uL) { this.L.set(this.uL); this.R.set(this.uR); this.uL = null; if (this.state === "dubbing") this.state = "playing"; } }
        else if (m.cmd === "clear") { this.state = "empty"; this.len = 0; this.pos = 0; this.uL = null; }
        else if (m.cmd === "comp") this.comp = Math.max(0, Math.round(m.frames || 0));
        else if (m.cmd === "level") this.level = m.level;
        this.report(true);
      }
      report(force) { var k = this.state + ":" + this.len + ":" + (this.uL ? 1 : 0); if (force || k !== this.reported) { this.reported = k; this.port.postMessage({ type: "state", state: this.state, len: this.len, pos: this.pos, undo: !!this.uL }); } }
      process(inputs, outputs) {
        var inp = inputs[0] || [], iL = inp[0], iR = inp[1] || inp[0], out = outputs[0], oL = out[0], oR = out[1] || out[0], n = oL.length;
        for (var i = 0; i < n; i++) {
          var frame = currentFrame + i, a = iL ? iL[i] : 0, b = iR ? iR[i] : 0, st = this.state;
          if (st === "armed" && frame >= this.startAt) { this.state = st = "recording"; this.pos = 0; }
          if (st === "recording") {
            if (this.pos < MAX) { this.L[this.pos] = a; this.R[this.pos] = b; this.pos++; }
            if ((this.want && this.pos >= this.want) || this.pos >= MAX) { this.len = this.pos; this.pos = 0; this.state = "playing"; }
            oL[i] = 0; if (oR !== oL) oR[i] = 0; continue;
          }
          if ((st === "playing" || st === "dubbing") && this.len) {
            var rp = (this.pos + this.comp) % this.len;   // read ahead by the round-trip latency so the loop sits on the beat
            oL[i] = this.L[rp] * this.level; if (oR !== oL) oR[i] = this.R[rp] * this.level;
            if (st === "dubbing") { this.L[this.pos] += a; this.R[this.pos] += b; }
            this.pos++; if (this.pos >= this.len) this.pos = 0;
          } else { oL[i] = 0; if (oR !== oL) oR[i] = 0; }
        }
        this.report(false);
        return true;
      }
    }
    registerProcessor("pp-looper", Looper);
  };

  var node = null, gain = null, src = null, stream = null, ready = null, armedFlag = false;
  var st = { state: "empty", len: 0, undo: false };
  function cfg() { var p = project(); if (!p.looper) p.looper = { bars: 4, sync: true, level: 0.9, latencyMs: null }; return p.looper; }
  async function ensure() {
    if (ready) return ready;
    ready = (async function () {
      var engine = PP.engine, ctx = await engine.ensure();
      var code = "(" + WORKLET.toString() + ")();";
      await ctx.audioWorklet.addModule("data:text/javascript;charset=utf-8," + encodeURIComponent(code));
      node = new AudioWorkletNode(ctx, "pp-looper", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2] });
      gain = ctx.createGain(); gain.gain.value = 1; node.connect(gain);
      engine.loopOut = gain; engine.routeOutput();
      node.port.onmessage = function (e) { if (e.data.type === "state") { st = e.data; render(); if (window.PPActions) window.PPActions.sendLeds(); } };
      node.port.postMessage({ cmd: "level", level: cfg().level });
      var lat = cfg().latencyMs != null ? cfg().latencyMs / 1000 : (ctx.baseLatency || 0.005) + (ctx.outputLatency || 0.01) + 0.008;
      node.port.postMessage({ cmd: "comp", frames: lat * ctx.sampleRate });
      return node;
    })();
    ready.catch(function (e) { console.warn("looper failed", e); ready = null; });
    return ready;
  }
  // the input: the Pi's "Central Pedal loop" virtual microphone (or, on a computer, whatever input was given)
  async function connectInput() {
    if (src) return true;
    var ctx = PP.engine.ctx;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return false;
    try {
      var devs = await navigator.mediaDevices.enumerateDevices(), dev = devs.filter(function (d) { return d.kind === "audioinput" && /central control loop|padpedal-loop/i.test(d.label); })[0];
      if (!dev) { // labels are only visible after a first permission: ask once, then look again
        var tmp = await navigator.mediaDevices.getUserMedia({ audio: true }); tmp.getTracks().forEach(function (t) { t.stop(); });
        devs = await navigator.mediaDevices.enumerateDevices(); dev = devs.filter(function (d) { return d.kind === "audioinput" && /central control loop|padpedal-loop/i.test(d.label); })[0];
      }
      if (!dev) return false;
      stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: dev.deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 } });
      src = ctx.createMediaStreamSource(stream); src.connect(node);
      return true;
    } catch (e) { console.warn("looper input", e); return false; }
  }
  async function arm(on) {
    armedFlag = on !== false;
    send({ type: "instrument", action: "looper", on: armedFlag });
    if (!armedFlag) { if (stream) stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; if (src) { try { src.disconnect(); } catch (_) { } } src = null; render(); return true; }
    await ensure();
    var ok = false; for (var i = 0; i < 12 && !ok; i++) { ok = await connectInput(); if (!ok) await new Promise(function (r) { setTimeout(r, 500); }); }
    if (!ok) PP.setStatus("Looper: the instrument's loop input did not appear (it works on the Central Pedal with the Instrument on).");
    render(); return ok;
  }
  // a node to record from instead (tests, or a computer without the Pi)
  async function useNode(n) { await ensure(); if (src) { try { src.disconnect(); } catch (_) { } } src = n; n.connect(node); armedFlag = true; render(); }

  // when the recording starts and how long the loop is
  function timing() {
    var c = cfg(), ctx = PP.engine.ctx, t = T(), now = ctx.currentTime, rate = ctx.sampleRate;
    if (!c.sync) return { at: Math.round((now + 0.02) * rate), len: 0 };
    var s = t && t.song(), playing = t && t.isPlaying && t.isPlaying() && s, bpm = s ? s.bpm : project().tempo.bpm, bpb = s && t.beatsInBar ? t.beatsInBar(s) || 4 : 4;
    var barSec = 60 / Math.max(30, bpm) * bpb, wait = 0.02;
    if (playing) {   // the next bar line of the song that is playing
      var st0 = t.state, bar = t.timeToBar(s, st0.pos), next = t.barStart(s, bar.bar + (bar.beat > 1 || (st0.pos - t.barStart(s, bar.bar)) > 0.05 ? 1 : 0)), speed = (t.data(s).tempoPercent || 100) / 100;
      wait = Math.max(0.02, (next - st0.pos) / speed); barSec = barSec;   // bpm already reflects the tempo change
    }
    return { at: Math.round((now + wait) * rate), len: Math.round(barSec * clamp(c.bars, 1, 16) * rate) };
  }
  async function main() {  // record → play → overdub → play …
    if (cfg().enabled === false) { PP.setStatus("The looper is off (Instrument tab → Looper on)."); return st.state; }
    if (!armedFlag) { var ok = await arm(true); if (!ok && !src) return st.state; }
    await ensure();
    if (st.state === "empty") { var tm = timing(); node.port.postMessage({ cmd: "rec", at: tm.at, len: tm.len }); PP.setStatus(cfg().sync ? "Looper: recording " + cfg().bars + " bar" + (cfg().bars === 1 ? "" : "s") + " from the next bar" : "Looper: recording - tap again to close the loop"); }
    else if (st.state === "armed") node.port.postMessage({ cmd: "clear" });
    else if (st.state === "recording") node.port.postMessage({ cmd: "close" });
    else if (st.state === "playing") { node.port.postMessage({ cmd: "dub" }); PP.setStatus("Looper: overdub"); }
    else if (st.state === "dubbing" || st.state === "stopped") { node.port.postMessage({ cmd: "play" }); PP.setStatus("Looper: playing"); }
    return st.state;
  }
  function stop() { if (node) node.port.postMessage({ cmd: "stop" }); PP.setStatus("Looper: stopped"); }
  function play() { if (node) node.port.postMessage({ cmd: "play" }); }
  function undo() { if (node) node.port.postMessage({ cmd: "undo" }); PP.setStatus("Looper: last overdub removed"); }
  function clear() { if (node) node.port.postMessage({ cmd: "clear" }); PP.setStatus("Looper: cleared"); }
  function setLevel(v) { cfg().level = clamp(v, 0, 1.4); if (node) node.port.postMessage({ cmd: "level", level: cfg().level }); PP.persistSoon(); }

  // ---- UI (inside the Instrument tab)
  var LABEL = { empty: "REC", armed: "WAIT…", recording: "● REC", playing: "▶ PLAY", dubbing: "● DUB", stopped: "■ STOP" };
  function html() {
    var c = cfg(), secs = st.len && PP.engine.ctx ? (st.len / PP.engine.ctx.sampleRate).toFixed(1) + " s" : "";
    var onOff = '<label class="toggle lp-onoff"><input type="checkbox" id="lpEnabled"' + (c.enabled !== false ? " checked" : "") + '> Looper on</label>';
    if (c.enabled === false) return '<section class="looper off" id="looperBox"><div class="row spread"><h3>Looper <small class="muted">off</small></h3>' + onOff + '</div><p class="muted small">Turn it on to loop your guitar / keys live: record a phrase, it plays back, play over it (overdub), undo, clear - in time with the song or free.</p></section>';
    return '<section class="looper" id="looperBox"><div class="row spread"><h3>Looper ' + onOff + ' <small class="muted">' + (armedFlag ? "ready · " : "") + esc(st.state === "empty" ? "empty" : st.state + (secs ? " · " + secs : "")) + '</small></h3>' +
      '<div class="se-row"><label class="toggle"><input type="checkbox" id="lpSync"' + (c.sync ? " checked" : "") + '> In time with the song</label><label>Length<select id="lpBars"' + (c.sync ? "" : " disabled") + ">" + [1, 2, 4, 8, 16].map(function (b) { return '<option value="' + b + '"' + (c.bars === b ? " selected" : "") + ">" + b + " bar" + (b === 1 ? "" : "s") + "</option>"; }).join("") + '</select></label><label>Level<span class="control-line"><input type="range" id="lpLevel" min="0" max="140" value="' + Math.round(c.level * 100) + '"><output>' + Math.round(c.level * 100) + "</output></span></label></div></div>" +
      '<div class="lp-btns"><button class="pf-btn lp-main st-' + st.state + '" id="lpMain"><small>REC / PLAY / DUB</small><b>' + LABEL[st.state] + '</b></button><button class="pf-btn" id="lpStop"' + (st.len ? "" : " disabled") + '><small>LOOP</small><b>STOP</b></button><button class="pf-btn" id="lpUndo"' + (st.undo ? "" : " disabled") + '><small>LAST DUB</small><b>UNDO</b></button><button class="pf-btn" id="lpClear"><small>LOOP</small><b>CLEAR</b></button></div>' +
      '<p class="muted small">Footswitches: Configure → "Looper: record / play / overdub", "Looper: stop", "Looper: undo", "Looper: clear". The loop plays on the instrument output.</p></section>';
  }
  function render() { var box = $("#looperBox"); if (box) { var d = document.createElement("div"); d.innerHTML = html(); box.replaceWith(d.firstChild); } }
  document.addEventListener("click", function (e) {
    var b = e.target.closest("#looperBox button"); if (!b) return;
    if (b.id === "lpMain") main(); else if (b.id === "lpStop") stop(); else if (b.id === "lpUndo") undo(); else if (b.id === "lpClear") clear();
  });
  document.addEventListener("change", function (e) {
    var el = e.target; if (!el.closest || !el.closest("#looperBox")) return; var c = cfg();
    if (el.id === "lpEnabled") { c.enabled = el.checked; PP.persistSoon(); if (!c.enabled) { clear(); if (armedFlag) arm(false); } render(); return; }
    if (el.id === "lpSync") { c.sync = el.checked; PP.persistSoon(); render(); } else if (el.id === "lpBars") { c.bars = Number(el.value); PP.persistSoon(); }
  });
  document.addEventListener("input", function (e) { var el = e.target; if (el.id !== "lpLevel") return; setLevel(Number(el.value) / 100); var o = el.parentNode.querySelector("output"); if (o) o.textContent = el.value; });

  window.PPLooper = { html: html, render: render, main: main, stop: stop, play: play, undo: undo, clear: clear, arm: arm, armed: function () { return armedFlag; }, state: function () { return st; }, useNode: useNode, setLevel: setLevel, config: cfg };
})();
