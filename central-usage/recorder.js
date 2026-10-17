/* Central Usage - records a mix (the main mix, or any in-ear mix) of the audio host to a WAV file:
 * 48 kHz, 16 bit, stereo. The header is fixed up when the recording stops (and every 10 s, so a crash
 * still leaves a playable file). */
"use strict";
const fs = require("node:fs");
const path = require("node:path");

class Recorder {
  constructor() { this.fd = null; this.file = null; this.bytes = 0; this.started = 0; this.timer = null; }
  header(dataBytes) {
    const h = Buffer.alloc(44);
    h.write("RIFF", 0, "latin1"); h.writeUInt32LE(36 + dataBytes, 4); h.write("WAVE", 8, "latin1"); h.write("fmt ", 12, "latin1");
    h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22); h.writeUInt32LE(48000, 24); h.writeUInt32LE(48000 * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34);
    h.write("data", 36, "latin1"); h.writeUInt32LE(dataBytes, 40);
    return h;
  }
  start(dir, label) {
    this.stop(); fs.mkdirSync(dir, { recursive: true });
    const d = new Date(), pad = (n) => String(n).padStart(2, "0");
    this.file = path.join(dir, "Service " + d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + "." + pad(d.getMinutes()) + (label ? " " + label.replace(/[^\w -]+/g, "") : "") + ".wav");
    this.fd = fs.openSync(this.file, "w"); fs.writeSync(this.fd, this.header(0)); this.bytes = 0; this.started = Date.now();
    this.timer = setInterval(() => this.fix(), 10000);
    return this.status();
  }
  write(pcm) { if (this.fd == null) return; try { fs.writeSync(this.fd, pcm); this.bytes += pcm.length; } catch (_) { } }
  fix() { if (this.fd == null) return; try { fs.writeSync(this.fd, this.header(this.bytes), 0, 44, 0); } catch (_) { } }
  stop() { clearInterval(this.timer); if (this.fd == null) return this.status(); this.fix(); try { fs.closeSync(this.fd); } catch (_) { } this.fd = null; const st = this.status(); st.saved = this.file; return st; }
  status() { return { recording: this.fd != null, file: this.file, seconds: this.fd != null ? Math.round((Date.now() - this.started) / 1000) : Math.round(this.bytes / 192000), bytes: this.bytes }; }
}
module.exports = { Recorder };
