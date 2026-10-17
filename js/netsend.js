/* Central Control - audio to Central Usage over the network (Ethernet or Wi-Fi).
 *
 * When a Central Usage computer subscribes (and I/O → Network audio is Ethernet or Wi-Fi), every channel
 * goes to the driver as binary packets and the driver passes them on:
 *   each track (stem) on its own channel, raw - Central Usage mixes them (the Pi's faders don't apply)
 *   Click + cues · Pads L/R · Tracks mix L/R (what the Pi plays, after its faders)
 * The driver adds the instrument (captured from the Pi's output). 1024 frames per packet, 16 bit.
 * Packet: "CCA1", u8 source (0), u8 channels, u16 frames, u32 seq, f64 ms, then int16 interleaved. */
(function () {
  "use strict";
  var PP = window.PP, F = window.PPFeatures; if (!PP || !F) return;
  var engine = PP.engine, FRAMES = 1024;
  var st = { status: null, on: false, nodes: [], taps: [], node: null, seq: 0, names: [], rate: 0, packets: 0, dropped: 0, loaded: null, building: false };
  function bridge() { return window.__pedalBridge; }

  // the capture worklet: interleaves the channels into int16 blocks of 1024 frames (halved for the Wi-Fi saver)
  function workletSource() {
    class NetSend extends AudioWorkletProcessor {
      constructor(o) {
        super(); var p = o.processorOptions || {};
        this.ch = p.channels || 2; this.dec = p.decimate || 1; this.frames = p.frames || 1024;
        this.buf = new Int16Array(this.frames * this.ch); this.n = 0; this.live = true;
        this.port.onmessage = (e) => { if (e.data === "stop") this.live = false; };
      }
      process(inputs) {
        if (!this.live) return false;
        var inp = inputs[0]; if (!inp || !inp.length) return true;
        var len = inp[0].length, ch = this.ch, dec = this.dec, buf = this.buf;
        for (var i = 0; i < len; i += dec) {
          var o = this.n * ch;
          for (var c = 0; c < ch; c++) {
            var a = inp[c]; var x = a ? (dec === 2 ? (a[i] + a[i + 1]) * 0.5 : a[i]) : 0;
            buf[o + c] = x <= -1 ? -32767 : x >= 1 ? 32767 : x * 32767;
          }
          if (++this.n === this.frames) { this.port.postMessage(buf.buffer, [buf.buffer]); buf = this.buf = new Int16Array(this.frames * ch); this.n = 0; }
        }
        return true;
      }
    }
    registerProcessor("pp-netsend", NetSend);
  }
  function ensureModule() {
    if (st.loaded) return st.loaded;
    var src = "(" + workletSource.toString() + ")();";
    st.loaded = engine.ensure().then(function (c) { return c.audioWorklet.addModule("data:text/javascript;charset=utf-8," + encodeURIComponent(src)); });
    st.loaded.catch(function () { st.loaded = null; });
    return st.loaded;
  }

  function wanted() { var s = st.status; return !!(s && s.sending && s.config && (s.config.mode === "ethernet" || s.config.mode === "wifi")); }
  function teardown() {
    if (st.node) { try { st.node.port.postMessage("stop"); st.node.disconnect(); } catch (_) { } st.node = null; }
    st.taps.forEach(function (t) { try { t.from.disconnect(t.to); } catch (_) { } }); st.taps = [];
    st.nodes.forEach(function (n) { try { n.disconnect(); } catch (_) { } }); st.nodes = [];
    var T = window.PPTracks; if (T && T.netDecks) T.netDecks().forEach(function (d) { try { d.node.port.postMessage({ cmd: "net", on: false }); } catch (_) { } });
  }
  function tap(from, to, out, inp) { if (out == null) from.connect(to); else from.connect(to, out, inp || 0); st.taps.push({ from: from, to: to }); }
  async function build() {
    teardown();
    if (!wanted()) { st.on = false; return; }
    if (st.building) return; st.building = true;
    try {
      await ensureModule();
      var T = window.PPTracks; if (T && T.ensureWorklet && T.song && T.song() && T.data(T.song()).stems.length) { try { await T.ensureWorklet(); } catch (_) { } }
      teardown();
      var c = engine.ctx; if (!c || !wanted()) return;
      var decks = T && T.netDecks ? T.netDecks() : [], names = T && T.netNames ? T.netNames().slice(0, T.NET_SLOTS || 24) : [];
      if (!decks.length) names = [];
      var S = names.length, all = names.concat(["Click + cues", "Pads L", "Pads R", "Tracks mix L", "Tracks mix R"]), C = all.length;
      var saver = st.status.config.quality === "saver", dec = saver ? 2 : 1;
      var merger = c.createChannelMerger(C); st.nodes.push(merger);
      if (S) {
        var split = c.createChannelSplitter(T.NET_SLOTS || 24); st.nodes.push(split);
        decks.forEach(function (d) { tap(d.node, split, 3, 0); d.node.port.postMessage({ cmd: "net", on: true }); });
        for (var i = 0; i < S; i++) split.connect(merger, i, i);
      }
      var mono = c.createGain(); mono.channelCount = 1; mono.channelCountMode = "explicit"; mono.channelInterpretation = "speakers"; st.nodes.push(mono);
      if (engine.clickBus) tap(engine.clickBus, mono); mono.connect(merger, 0, S);
      var ps = c.createChannelSplitter(2), ts = c.createChannelSplitter(2); st.nodes.push(ps, ts);
      if (engine.outGain) tap(engine.outGain, ps); ps.connect(merger, 0, S + 1); ps.connect(merger, 1, S + 2);
      if (engine.tracksOut) tap(engine.tracksOut, ts); ts.connect(merger, 0, S + 3); ts.connect(merger, 1, S + 4);
      var node = new AudioWorkletNode(c, "pp-netsend", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: C, channelCountMode: "explicit", channelInterpretation: "discrete", processorOptions: { channels: C, decimate: dec, frames: FRAMES } });
      merger.connect(node);
      var sink = c.createGain(); sink.gain.value = 0; node.connect(sink); sink.connect(c.destination); st.nodes.push(sink);   // keeps the node pulled
      node.port.onmessage = function (e) { sendBlock(e.data, C); };
      st.node = node; st.names = all; st.rate = c.sampleRate / dec; st.on = true;
      bridge() && bridge().send({ type: "netAudio", action: "info", channels: all, rate: st.rate, stems: S });
    } finally { st.building = false; }
  }
  function sendBlock(ab, C) {
    var b = bridge(); if (!b || !b.socket || b.socket.readyState !== 1) return;
    if (b.socket.bufferedAmount > 512 * 1024) { st.dropped++; return; }   // the driver isn't keeping up: drop, don't lag
    var payload = new Uint8Array(ab), packet = new ArrayBuffer(20 + payload.length), v = new DataView(packet);
    v.setUint8(0, 67); v.setUint8(1, 67); v.setUint8(2, 65); v.setUint8(3, 49);   // "CCA1"
    v.setUint8(4, 0); v.setUint8(5, C); v.setUint16(6, FRAMES, true); v.setUint32(8, (++st.seq) >>> 0, true); v.setFloat64(12, performance.now(), true);
    new Uint8Array(packet, 20).set(payload);
    try { b.socket.send(packet); st.packets++; } catch (_) { }
  }
  var rebuildTimer = 0;
  function rebuildSoon() { clearTimeout(rebuildTimer); rebuildTimer = setTimeout(build, 150); }

  F.on("netAudio", function (m) { var was = wanted(), prevQ = st.status && st.status.config && st.status.config.quality; st.status = m; if (wanted() !== was || (wanted() && prevQ !== m.config.quality)) rebuildSoon(); if (window.PPIO) window.PPIO.onNetAudio(m); });
  F.on("hello", function () { var b = bridge(); if (b) b.send({ type: "netAudio", action: "status" }); });
  document.addEventListener("pp-routing", function () { if (st.on || wanted()) rebuildSoon(); });   // routing re-wires the buses
  document.addEventListener("pp-stems", function () { if (st.on || wanted()) rebuildSoon(); });

  function configure(cfg) { var b = bridge(); if (!b || !b.connected) { PP.setStatus("Network audio is set on the Central Control (the driver isn't connected)."); return false; } return b.send({ type: "netAudio", action: "config", config: cfg }); }
  window.PPNetSend = { configure: configure, status: function () { return st.status; }, sending: function () { return st.on; }, channels: function () { return st.names.slice(); }, stats: function () { return { packets: st.packets, dropped: st.dropped, rate: st.rate }; }, rebuild: build };
})();
