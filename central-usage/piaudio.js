/* Central Usage - the Central Control's audio over the network (audio host only): connects to the Pi's
 * companion socket on the address of the chosen connection (its Ethernet or its Wi-Fi address), subscribes
 * with the pairing code and feeds every packet to the engine. Packets: "CCA1", u8 source, u8 channels,
 * u16 frames, u32 seq, f64 ms, int16 interleaved. */
"use strict";
const EventEmitter = require("node:events");
let WebSocket = null; try { WebSocket = require("ws"); } catch (_) { }

class PiAudio extends EventEmitter {
  constructor(engine) {
    super(); this.engine = engine; this.cfg = { address: "", code: "", name: "Central Usage", enabled: false };
    this.ws = null; this.timer = null; this.st = { state: "off", error: null, packets: 0, bytes: 0, lost: 0, sources: {}, since: 0 }; this.lastSeq = {};
  }
  configure(cfg) {
    const before = JSON.stringify(this.cfg); Object.assign(this.cfg, cfg || {});
    if (JSON.stringify(this.cfg) !== before || !this.ws) { this.close(); if (this.cfg.enabled && this.cfg.address) this.open(); else this.set("off", null); }
    return this.status();
  }
  set(state, error) { this.st.state = state; this.st.error = error; this.emit("status", this.status()); }
  status() { const dt = Math.max(1, (Date.now() - this.st.since) / 1000); return Object.assign({}, this.st, { address: this.cfg.address, kbps: this.st.since ? Math.round(this.st.bytes * 8 / dt / 1000) : 0 }); }
  close() { clearTimeout(this.timer); if (this.ws) { try { this.ws.removeAllListeners(); this.ws.terminate(); } catch (_) { } } this.ws = null; }
  open() {
    if (!WebSocket) { this.set("error", "network audio needs the 'ws' module"); return; }
    this.set("connecting", null);
    let ws; try { ws = new WebSocket("ws://" + this.cfg.address + ":8081", { perMessageDeflate: false }); } catch (e) { this.set("error", e.message); return this.retry(); }
    this.ws = ws; ws.binaryType = "nodebuffer";
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "client", app: "central-usage", mode: "admin", name: this.cfg.name + " (audio host)" }));
      ws.send(JSON.stringify({ type: "auth", code: this.cfg.code }));
      ws.send(JSON.stringify({ type: "audioSubscribe", code: this.cfg.code, sources: [0, 1], name: this.cfg.name }));
      this.st.packets = 0; this.st.bytes = 0; this.st.lost = 0; this.st.since = Date.now(); this.lastSeq = {};
    });
    ws.on("message", (data, isBinary) => {
      if (isBinary) return this.packet(data);
      let m; try { m = JSON.parse(data.toString()); } catch (_) { return; }
      if (m.type === "audioSubscribed") { if (m.ok) { this.set("receiving", null); if (m.sources) this.stream(m.sources); } else this.set("refused", m.error || "refused"); }
      else if (m.type === "audioStream") this.stream(m.sources);
      else if (m.type === "auth" && m.ok === false) this.set("refused", "The pairing code was refused (Central Control → Settings shows it).");
    });
    ws.on("close", () => { if (this.ws === ws) { this.ws = null; if (this.st.state !== "refused") this.set("lost", "connection lost - retrying"); this.retry(); } });
    ws.on("error", (e) => { if (this.st.state === "connecting") this.st.error = e.message; });
  }
  retry() { clearTimeout(this.timer); this.timer = setTimeout(() => { if (this.cfg.enabled && !this.ws) this.open(); }, 3000); }
  stream(sources) { this.st.sources = sources || {}; this.engine.setPiStream(this.st.sources); this.emit("status", this.status()); }
  packet(buf) {
    if (buf.length < 20 || buf[0] !== 67 || buf[1] !== 67 || buf[2] !== 65 || buf[3] !== 49) return;
    const src = buf[4], ch = buf[5], frames = buf.readUInt16LE(6), seq = buf.readUInt32LE(8);
    if (buf.length < 20 + frames * ch * 2) return;
    const last = this.lastSeq[src]; if (last != null && seq > last + 1) this.st.lost += seq - last - 1; this.lastSeq[src] = seq;
    this.st.packets++; this.st.bytes += buf.length;
    this.engine.netAudio(src, ch, frames, buf.subarray(20, 20 + frames * ch * 2));
  }
}
module.exports = { PiAudio };
