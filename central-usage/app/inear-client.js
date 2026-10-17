/* Central Control - in-ear client: the connection to the audio host (users, remote admins, phones) and the
 * player for a mix that comes back over Wi-Fi. Runs in the app and in a phone's browser.
 *   CUInEar.link({ url, role, code, id, name, hello: { more fields for the hello } })
 *       -> { op(op), listen(tap, on, opt), send(json), sendBinary(buf), close(), on(event, fn) }
 *       events: welcome(state, info) · view(state) · op(op) · state(state) · meters(m) · refused(error) · status(text) · audio(frames, ch, rate, int16)
 *               talking(names) · talkers(list) · talkAck(m) · talkAudio(int16, frames, rate) · recState(state, m)
 *   CUInEar.talkFrame(int16, rate) -> ArrayBuffer   the talkback mic's frame ("TKA1", the in-ear frame's layout, mono)
 *   CUInEar.player({ latency, sinkId }) -> { start(), stop(), push(int16, frames, ch, rate), setSink(id), setLatency(ms), stats() }
 * The player keeps a small buffer (Wi-Fi jitter) and speeds up / slows down by a hair to stay on it. */
(function (root) {
  "use strict";
  // ---- the ring buffer + resampler, used in the AudioWorklet and (phones over http) in a ScriptProcessor
  function Core() {
    var N = 1 << 17, L = new Float32Array(N), R = new Float32Array(N), w = 0, r = 0, primed = false, srcRate = 48000, target = 4800, level = 0, under = 0, gain = 1;
    return {
      push: function (pcm, frames, ch, rate) {
        if (rate !== srcRate) { srcRate = rate; primed = false; w = r = 0; }
        for (var f = 0; f < frames; f++) { var i = (w + f) & (N - 1); if (ch === 1) { L[i] = R[i] = pcm[f] / 32768; } else { L[i] = pcm[f * 2] / 32768; R[i] = pcm[f * 2 + 1] / 32768; } }
        w += frames;
      },
      setTarget: function (ms) { target = Math.max(240, ms * srcRate / 1000); },
      pull: function (outL, outR, n, outRate) {
        var have = w - r;
        if (!primed) { if (have >= target) { r = w - target; primed = true; level = target; } else { for (var k = 0; k < n; k++) { outL[k] = 0; if (outR) outR[k] = 0; } return; } }
        have = w - r; level = level * 0.99 + have * 0.01;
        var step0 = srcRate / outRate, adj = Math.max(-0.01, Math.min(0.01, (level - target) / target * 0.004)), step = step0 * (1 + adj);
        if (have < n * step + 2) { under++; primed = false; for (var z = 0; z < n; z++) { outL[z] = 0; if (outR) outR[z] = 0; } return; }
        if (have > N / 2) r = w - target;
        for (var i2 = 0; i2 < n; i2++) { var i0 = Math.floor(r), fr = r - i0, a = i0 & (N - 1), b = (i0 + 1) & (N - 1); outL[i2] = (L[a] + (L[b] - L[a]) * fr) * gain; if (outR) outR[i2] = (R[a] + (R[b] - R[a]) * fr) * gain; r += step; }
      },
      setGain: function (g) { gain = g; },
      stats: function () { return { bufferMs: Math.round((w - r) / srcRate * 1000), targetMs: Math.round(target / srcRate * 1000), underruns: under, rate: srcRate }; }
    };
  }
  var workletSrc = "(" + function (CoreSrc) {
    var Core = eval("(" + CoreSrc + ")");
    class InEar extends AudioWorkletProcessor {
      constructor() { super(); this.core = Core(); this.port.onmessage = (e) => { var m = e.data; if (m.pcm) this.core.push(m.pcm, m.frames, m.ch, m.rate); else if (m.target) this.core.setTarget(m.target); else if (m.gain != null) this.core.setGain(m.gain); else if (m.stats) this.port.postMessage(this.core.stats()); }; }
      process(inputs, outputs) { var o = outputs[0]; this.core.pull(o[0], o[1] || null, o[0].length, sampleRate); return true; }
    }
    registerProcessor("cu-inear", InEar);
  }.toString() + ")(" + JSON.stringify(Core.toString()) + ");";

  function player(opt) {
    opt = opt || {};
    var ctx = null, node = null, sp = null, core = null, latency = opt.latency || 80, sinkId = opt.sinkId || "", lastStats = {}, statTimer = 0;
    async function start() {
      if (ctx) return;
      ctx = new (root.AudioContext || root.webkitAudioContext)({ latencyHint: "interactive" });
      if (sinkId && ctx.setSinkId) { try { await ctx.setSinkId(sinkId); } catch (_) { } }
      if (ctx.audioWorklet && root.isSecureContext !== false) {
        try {
          var url = "data:text/javascript;charset=utf-8," + encodeURIComponent(workletSrc);   // (file:// pages can't load worklets from blob: URLs)
          await ctx.audioWorklet.addModule(url);
          node = new AudioWorkletNode(ctx, "cu-inear", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
          node.connect(ctx.destination); node.port.postMessage({ target: latency });
          node.port.onmessage = function (e) { lastStats = e.data; };
          statTimer = setInterval(function () { if (node) node.port.postMessage({ stats: 1 }); }, 500);
        } catch (_) { node = null; }
      }
      if (!node) {   // phones on plain http: no AudioWorklet there
        core = Core(); core.setTarget(latency + 60);
        sp = ctx.createScriptProcessor(2048, 0, 2);
        sp.onaudioprocess = function (e) { core.pull(e.outputBuffer.getChannelData(0), e.outputBuffer.getChannelData(1), e.outputBuffer.length, ctx.sampleRate); };
        sp.connect(ctx.destination);
      }
      if (ctx.state !== "running") { try { await ctx.resume(); } catch (_) { } }
    }
    function stop() { clearInterval(statTimer); try { if (node) node.disconnect(); if (sp) sp.disconnect(); if (ctx) ctx.close(); } catch (_) { } ctx = node = sp = core = null; }
    function push(pcm, frames, ch, rate) { if (node) node.port.postMessage({ pcm: pcm, frames: frames, ch: ch, rate: rate }, [pcm.buffer]); else if (core) core.push(pcm, frames, ch, rate); }
    return {
      start: start, stop: stop, push: push,
      running: function () { return !!ctx; },
      setSink: async function (id) { sinkId = id || ""; if (ctx && ctx.setSinkId) { try { await ctx.setSinkId(sinkId); } catch (_) { } } },
      setLatency: function (ms) { latency = ms; if (node) node.port.postMessage({ target: ms }); else if (core) core.setTarget(ms + 60); },
      setGain: function (g) { if (node) node.port.postMessage({ gain: g }); else if (core) core.setGain(g); },
      stats: function () { var s = core ? core.stats() : lastStats; s = Object.assign({}, s); if (ctx) s.outputMs = Math.round(((ctx.baseLatency || 0) + (ctx.outputLatency || 0)) * 1000); return s; },
      context: function () { return ctx; }
    };
  }
  function parseAudio(buf) {   // "IEA1", u8 tap, u8 channels, u16 frames, u32 rate, int16
    var v = new DataView(buf); if (buf.byteLength < 12 || v.getUint8(0) !== 73 || v.getUint8(1) !== 69 || v.getUint8(2) !== 65) return null;
    var tap = v.getUint8(4), ch = v.getUint8(5), frames = v.getUint16(6, true), rate = v.getUint32(8, true);
    return { tap: tap, ch: ch, frames: frames, rate: rate, pcm: new Int16Array(buf.slice(12, 12 + frames * ch * 2)) };
  }
  function talkFrame(pcm, rate) {   // "TKA1", u8 channels (1), u8 0, u16 frames, u32 rate, int16
    var buf = new ArrayBuffer(12 + pcm.length * 2), v = new DataView(buf);
    v.setUint8(0, 84); v.setUint8(1, 75); v.setUint8(2, 65); v.setUint8(3, 49); v.setUint8(4, 1); v.setUint16(6, pcm.length, true); v.setUint32(8, rate || 48000, true);
    new Int16Array(buf, 12).set(pcm); return buf;
  }
  function parseTalk(buf) { var v = new DataView(buf); if (buf.byteLength < 12 || v.getUint8(0) !== 84 || v.getUint8(1) !== 75 || v.getUint8(2) !== 65) return null; var frames = v.getUint16(6, true); return { frames: frames, rate: v.getUint32(8, true), pcm: new Int16Array(buf.slice(12, 12 + frames * 2)) }; }
  function link(opt) {
    var handlers = {}, ws = null, closed = false, retry = 0, welcomed = false;
    function emit(ev) { var args = Array.prototype.slice.call(arguments, 1); (handlers[ev] || []).forEach(function (fn) { try { fn.apply(null, args); } catch (e) { console.warn(e); } }); }
    function open() {
      emit("status", "connecting");
      try { ws = new WebSocket(opt.url); } catch (e) { emit("status", "error: " + e.message); return later(); }
      ws.binaryType = "arraybuffer";
      ws.onopen = function () { retry = 0; var h = { type: "hello", role: opt.role, code: opt.code, id: opt.id, name: opt.name }, more = typeof opt.hello === "function" ? opt.hello() : opt.hello; if (more) Object.keys(more).forEach(function (k) { h[k] = more[k]; }); ws.send(JSON.stringify(h)); };
      ws.onmessage = function (e) {
        if (typeof e.data !== "string") { var a = parseAudio(e.data); if (a) emit("audio", a.pcm, a.frames, a.ch, a.rate, a.tap); else { var t = parseTalk(e.data); if (t) emit("talkAudio", t.pcm, t.frames, t.rate); } return; }
        var m; try { m = JSON.parse(e.data); } catch (_) { return; }
        if (m.type === "welcome") { welcomed = true; emit("status", "connected"); emit("welcome", m.state, m); (opt.relisten || []).forEach(function (l) { send({ type: "listen", tap: l.tap, on: true, rate: l.rate, mono: l.mono }); }); }
        else if (m.type === "view") emit("view", m.state);
        else if (m.type === "op") emit("op", m.op, m.by);
        else if (m.type === "state") emit("state", m.state);
        else if (m.type === "pi") emit("pi", m.names);
        else if (m.type === "meters") emit("meters", m);
        else if (m.type === "talking") emit("talking", m.names || []);
        else if (m.type === "talkers") emit("talkers", m.talkers || []);
        else if (m.type === "talkAck") emit("talkAck", m);
        else if (m.type === "recState") emit("recState", m.state, m);
        else if (m.type === "refused") { emit("refused", m.error, m); if (!welcomed) { closed = true; try { ws.close(); } catch (_) { } emit("status", "refused"); } }
      };
      ws.onclose = function () { ws = null; if (!closed) { emit("status", "lost - reconnecting"); welcomed = false; later(); } };
    }
    function later() { if (closed) return; retry = Math.min(retry + 1, 6); setTimeout(function () { if (!closed && !ws) open(); }, 500 * retry); }
    function send(o) { if (ws && ws.readyState === 1) { ws.send(JSON.stringify(o)); return true; } return false; }
    open();
    return {
      on: function (ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); return this; },
      op: function (op) { return send({ type: "op", op: op }); },
      listen: function (tap, on, o) { o = o || {}; opt.relisten = (opt.relisten || []).filter(function (l) { return l.tap !== tap; }); if (on) opt.relisten.push({ tap: tap, rate: o.rate, mono: o.mono }); return send({ type: "listen", tap: tap, on: !!on, rate: o.rate, mono: o.mono }); },
      send: send,
      sendBinary: function (buf) { if (ws && ws.readyState === 1 && welcomed && ws.bufferedAmount < 64 * 1024) { ws.send(buf); return true; } return false; },
      close: function () { closed = true; if (ws) try { ws.close(); } catch (_) { } },
      connected: function () { return !!(ws && ws.readyState === 1 && welcomed); }
    };
  }
  function deviceId() { try { var id = localStorage.getItem("cu-device-id"); if (!id) { id = "d" + Math.random().toString(36).slice(2, 12); localStorage.setItem("cu-device-id", id); } return id; } catch (_) { return "d" + Math.random().toString(36).slice(2, 12); } }
  root.CUInEar = { link: link, player: player, parseAudio: parseAudio, talkFrame: talkFrame, parseTalk: parseTalk, deviceId: deviceId, Core: Core };
})(typeof window !== "undefined" ? window : this);
