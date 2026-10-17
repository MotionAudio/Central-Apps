/* Central Control - timecode that follows the Central Pedal's song, for show software, consoles and
 * video servers:
 *  - MTC (MIDI Time Code) quarter frames on the MIDI output chosen above (+ a full-frame message on every jump)
 *  - LTC (SMPTE linear timecode) as audio on any sound output of this computer (a jack into the console)
 * Time = start offset + the song position (optionally hour = song number), at 24, 25 or 30 fps (non-drop). */
(function () {
  "use strict";
  var CU = window.CentralUsage; if (!CU) return;
  function $(s) { return document.querySelector(s); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  var KEY = "cu-timecode", cfg = { mtc: false, ltc: false, fps: 30, offset: "01:00:00:00", hourPerSong: false, ltcDevice: "", ltcLevel: 0.5 };
  try { Object.assign(cfg, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch (_) { }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (_) { } }
  function L() { return window.CULights; }

  function parseTc(t) { var p = String(t || "").split(/[:;.]/).map(Number); while (p.length < 4) p.unshift(0); return ((p[0] * 60 + p[1]) * 60 + p[2]) * cfg.fps + (p[3] || 0); }
  function fmt(frames) { frames = Math.max(0, Math.floor(frames)); var f = frames % cfg.fps, s = Math.floor(frames / cfg.fps), h = Math.floor(s / 3600) % 24, m = Math.floor(s / 60) % 60; s %= 60; return [h, m, s, f].map(function (n) { return String(n).padStart(2, "0"); }).join(":"); }
  var songIndex = 0;
  function framesNow() {
    var l = L(); if (!l) return 0;
    var base = parseTc(cfg.offset); if (cfg.hourPerSong) base = (songIndex + 1) * 3600 * cfg.fps + (base % (3600 * cfg.fps));
    return base + l.posNow() * cfg.fps;
  }
  function playing() { var l = L(); return !!(l && l.song.playing); }

  // ---- MTC
  var mtc = { running: false, seq: 0, frames: 0, nextAt: 0, timer: 0 };
  function rateCode() { return cfg.fps === 24 ? 0 : cfg.fps === 25 ? 1 : 3; }
  function fullFrame(frames) {
    var f = Math.floor(frames), fr = f % cfg.fps, s = Math.floor(f / cfg.fps), h = Math.floor(s / 3600) % 24, m = Math.floor(s / 60) % 60; s %= 60;
    if (CU.midiSysex) CU.midiSysex([0xF0, 0x7F, 0x7F, 0x01, 0x01, (rateCode() << 5) | h, m, s, fr, 0xF7]);
  }
  function qfData(k, frames) {
    var f = Math.floor(frames), fr = f % cfg.fps, s = Math.floor(f / cfg.fps), h = Math.floor(s / 3600) % 24, m = Math.floor(s / 60) % 60; s %= 60;
    var v = [fr & 15, fr >> 4, s & 15, s >> 4, m & 15, m >> 4, h & 15, (h >> 4) | (rateCode() << 1)][k];
    return [0xF1, (k << 4) | (v & 15)];
  }
  function mtcTick() {
    if (!cfg.mtc || !playing()) { mtc.running = false; return; }
    var now = performance.now(), qf = 1000 / (cfg.fps * 4), want = framesNow();
    if (!mtc.running || Math.abs((mtc.frames + mtc.seq / 4) - want) > 3) { mtc.running = true; mtc.seq = 0; mtc.frames = Math.round(want); mtc.nextAt = now; fullFrame(mtc.frames); }
    while (mtc.nextAt < now + 60) {
      CU.midiSend(qfData(mtc.seq, mtc.frames), mtc.nextAt);
      mtc.seq++; if (mtc.seq === 8) { mtc.seq = 0; mtc.frames += 2; }
      mtc.nextAt += qf;
    }
  }
  setInterval(mtcTick, 20);

  // ---- LTC (an AudioWorklet writes the biphase-mark signal)
  var LTC = function () {
    class Ltc extends AudioWorkletProcessor {
      constructor() { super(); this.fps = 30; this.frame = 0; this.bits = null; this.bit = 0; this.pos = 0; this.level = -1; this.amp = 0.5; this.running = false; this.port.onmessage = (e) => { var m = e.data; if (m.fps) this.fps = m.fps; if (m.amp != null) this.amp = m.amp; if (m.frame != null) { this.frame = Math.floor(m.frame); this.bits = null; this.bit = 0; this.pos = 0; } if (m.running != null) this.running = m.running; }; }
      makeBits(frames) {
        var fps = this.fps, f = frames % fps, s = Math.floor(frames / fps), h = Math.floor(s / 3600) % 24, m = Math.floor(s / 60) % 60, b = new Uint8Array(80); s %= 60;
        function put(v, at, n) { for (var i = 0; i < n; i++) b[at + i] = (v >> i) & 1; }
        put(f % 10, 0, 4); put(Math.floor(f / 10), 8, 2); put(s % 10, 16, 4); put(Math.floor(s / 10), 24, 3); put(m % 10, 32, 4); put(Math.floor(m / 10), 40, 3); put(h % 10, 48, 4); put(Math.floor(h / 10), 56, 2);
        [0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1].forEach(function (v, i) { b[64 + i] = v; });
        var zeros = 0; for (var i = 0; i < 80; i++) if (!b[i]) zeros++;
        var pc = fps === 25 ? 59 : 27; if (zeros % 2) b[pc] = 1;   // polarity correction: an even number of zeros
        return b;
      }
      process(inputs, outputs) {
        var out = outputs[0][0], n = out.length, spb = sampleRate / (this.fps * 80);
        if (!this.running) { out.fill(0); for (var c = 1; c < outputs[0].length; c++) outputs[0][c].fill(0); return true; }
        for (var i = 0; i < n; i++) {
          if (!this.bits) { this.bits = this.makeBits(this.frame); this.bit = 0; this.pos = 0; this.level = -this.level; }
          var half = this.pos >= spb / 2;
          if (half && !this.flipped && this.bits[this.bit]) { this.level = -this.level; this.flipped = true; }
          out[i] = this.level * this.amp;
          this.pos++;
          if (this.pos >= spb) { this.pos -= spb; this.bit++; this.flipped = false; if (this.bit >= 80) { this.frame++; this.bits = null; } else this.level = -this.level; }
        }
        for (var c2 = 1; c2 < outputs[0].length; c2++) outputs[0][c2].set(out);
        return true;
      }
    }
    registerProcessor("cu-ltc", Ltc);
  };
  var ltc = { ctx: null, node: null, ready: null, last: 0, running: false };
  async function ltcEnsure() {
    if (ltc.ready) return ltc.ready;
    ltc.ready = (async function () {
      ltc.ctx = new AudioContext({ latencyHint: "interactive" });
      await ltc.ctx.audioWorklet.addModule("data:text/javascript;charset=utf-8," + encodeURIComponent("(" + LTC.toString() + ")();"));
      ltc.node = new AudioWorkletNode(ltc.ctx, "cu-ltc", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
      ltc.node.connect(ltc.ctx.destination);
      if (cfg.ltcDevice && ltc.ctx.setSinkId) { try { await ltc.ctx.setSinkId(cfg.ltcDevice); } catch (_) { } }
      return ltc.node;
    })();
    return ltc.ready;
  }
  async function ltcTick() {
    var want = cfg.ltc && playing();
    if (!want) { if (ltc.node && ltc.running) { ltc.node.port.postMessage({ running: false }); ltc.running = false; } return; }
    await ltcEnsure(); if (ltc.ctx.state !== "running") ltc.ctx.resume();
    var fr = framesNow(), now = performance.now(), expected = ltc.last + (now - ltc.lastAt) / 1000 * cfg.fps;
    if (!ltc.running || Math.abs(expected - fr) > 2) { ltc.node.port.postMessage({ fps: cfg.fps, amp: cfg.ltcLevel, frame: fr, running: true }); ltc.running = true; ltc.last = fr; ltc.lastAt = now; }
    else { ltc.last = expected; ltc.lastAt = now; }
  }
  setInterval(ltcTick, 100);

  // ---- UI (Lighting → Output)
  async function render() {
    var el = $("#lxTimecode"); if (!el) return;
    var outs = []; try { outs = (await navigator.mediaDevices.enumerateDevices()).filter(function (d) { return d.kind === "audiooutput"; }); } catch (_) { }
    el.innerHTML = '<div class="row"><label class="toggle"><input type="checkbox" data-tc="mtc"' + (cfg.mtc ? " checked" : "") + '> MTC on the MIDI output</label><label class="toggle"><input type="checkbox" data-tc="ltc"' + (cfg.ltc ? " checked" : "") + '> LTC audio</label><label>Frames<select data-tc="fps">' + [24, 25, 30].map(function (f) { return '<option value="' + f + '"' + (cfg.fps === f ? " selected" : "") + ">" + f + " fps</option>"; }).join("") + '</select></label><label>Start at<input data-tc="offset" value="' + cfg.offset + '" style="width:110px" placeholder="01:00:00:00"></label><label class="toggle"><input type="checkbox" data-tc="hourPerSong"' + (cfg.hourPerSong ? " checked" : "") + '> Hour = song number</label></div>' +
      '<div class="row"><label>LTC goes out of<select data-tc="ltcDevice"><option value="">Default sound output</option>' + outs.filter(function (d) { return d.deviceId !== "default"; }).map(function (d) { return '<option value="' + d.deviceId + '"' + (cfg.ltcDevice === d.deviceId ? " selected" : "") + ">" + (d.label || "Output " + d.deviceId.slice(0, 6)) + "</option>"; }).join("") + '</select></label><label>LTC level <input type="range" min="0.05" max="1" step="0.05" data-tc="ltcLevel" value="' + cfg.ltcLevel + '"></label><span class="lx-tc" id="lxTcNow">--:--:--:--</span></div>' +
      '<p class="muted small">Runs while the Central Pedal plays a song. Plug the LTC output into the console / video server timecode input (use a separate output from the band\'s audio).</p>';
  }
  document.addEventListener("change", async function (e) {
    var k = e.target.dataset && e.target.dataset.tc; if (!k) return;
    cfg[k] = e.target.type === "checkbox" ? e.target.checked : k === "fps" ? Number(e.target.value) : k === "ltcLevel" ? Number(e.target.value) : e.target.value;
    save(); mtc.running = false; ltc.running = false;
    if (k === "ltcDevice" && ltc.ctx && ltc.ctx.setSinkId) { try { await ltc.ctx.setSinkId(cfg.ltcDevice || ""); } catch (_) { } }
    if (k === "ltcLevel" && ltc.node) ltc.node.port.postMessage({ amp: cfg.ltcLevel });
  });
  setInterval(function () { var el = $("#lxTcNow"); if (el) el.textContent = playing() ? fmt(framesNow()) : "stopped"; }, 100);
  window.CUTimecode = { render: render, config: function () { return cfg; }, framesNow: framesNow, fmt: fmt, qfData: qfData, setSong: function (i) { songIndex = i || 0; } };
})();
