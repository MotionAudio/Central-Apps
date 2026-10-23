/* Central Control - where the stream mix goes besides an output pair (the audio host's main process):
 *
 *   virtual   Linux: a virtual sound device "Central Control Stream" (a PipeWire / PulseAudio null sink, and a
 *             microphone made from its monitor), so OBS, Zoom or a browser on this computer can pick the stream mix
 *             as a microphone. Windows / macOS can't get a sound device from an app without a driver: when
 *             VB-CABLE or BlackHole is installed, the Mix tab plays the stream mix into it (the page does that).
 *   online    the stream mix goes live on its own - YouTube, Facebook or any RTMP(S) server - with a still
 *             picture (the church's logo, or a plain dark frame): one ffmpeg per destination, so one can fail or
 *             reconnect without the others. (With cameras, the Video tab streams instead and takes the stream
 *             mix as its sound: video-service.js, audio source "the stream mix".)
 *   Settings in stream.json (the stream keys stay on this computer, never in the shared mixer state).
 * API: new StreamOut({ engine, ffmpeg, dir }) .status() .config(patch) .setVirtual(on) .setLive(id | "all", on)
 *      .on("status", fn) .stop()                                                                                */
"use strict";
const { spawn, spawnSync } = require("node:child_process");
const EventEmitter = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const M = require("./app/mixer-model");

const SINK = "central_control_stream", SOURCE = "central_control_stream_mic";
const KINDS = { youtube: { label: "YouTube", url: "rtmp://a.rtmp.youtube.com/live2" }, facebook: { label: "Facebook", url: "rtmps://live-api-s.facebook.com:443/rtmp" }, rtmp: { label: "RTMP / RTMPS", url: "" }, file: { label: "File (test)", url: "" } };

function which(cmd) { try { const r = process.platform === "win32" ? spawnSync("where", [cmd], { encoding: "utf8" }) : spawnSync("sh", ["-c", "command -v " + cmd], { encoding: "utf8" }); return (r.stdout || "").split(/\r?\n/)[0].trim() || null; } catch (_) { return null; } }

class StreamOut extends EventEmitter {
  constructor(opts) {
    super();
    this.engine = opts.engine; this.ffmpeg = opts.ffmpeg || (() => which("ffmpeg")); this.file = path.join(opts.dir, "stream.json");
    this.cfg = { virtual: false, picture: "", destinations: [] };
    try { Object.assign(this.cfg, JSON.parse(fs.readFileSync(this.file, "utf8"))); } catch (_) { }
    if (!Array.isArray(this.cfg.destinations)) this.cfg.destinations = [];
    this.virt = { proc: null, modules: [], state: "off", error: null };
    this.live = new Map();   // destination id -> { proc, status, error, bytes, kbps, retries, retry, since }
    this.tapFn = (pcm) => this.pcm(pcm);
    this.tapped = false;
    if (this.cfg.virtual && process.platform === "linux") setTimeout(() => this.setVirtual(true), 1500);
  }
  save() { try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.cfg, null, 1)); } catch (_) { } }
  // ---------------------------------------------------------------- the stream mix's audio (the engine's tap 65)
  needTap() { return !!this.virt.proc || [...this.live.values()].some((r) => r.proc); }
  syncTap() { const want = this.needTap(); if (want !== this.tapped) { this.tapped = want; this.engine.tap(M.STREAMTAP, this.tapFn, want); } }
  pcm(buf) {   // int16 stereo 48 kHz, 20 ms at a time
    const v = this.virt.proc; if (v && v.stdin.writable && v.stdin.writableLength < 1 << 18) v.stdin.write(buf);
    for (const r of this.live.values()) if (r.proc && r.proc.stdin.writable && r.proc.stdin.writableLength < 1 << 20) r.proc.stdin.write(buf);
  }
  // ---------------------------------------------------------------- the virtual sound device (Linux)
  pactl(args) { const r = spawnSync("pactl", args, { encoding: "utf8", timeout: 8000 }); return { ok: r.status === 0, out: (r.stdout || "").trim(), err: (r.stderr || r.error && r.error.message || "").trim() }; }
  cleanupModules() {   // ours from an earlier run (a crash) first
    const l = this.pactl(["list", "short", "modules"]); if (!l.ok) return;
    l.out.split("\n").forEach((line) => { if (line.indexOf(SINK) >= 0) { const id = line.split(/\s+/)[0]; if (/^\d+$/.test(id)) this.pactl(["unload-module", id]); } });
  }
  setVirtual(on) {
    this.cfg.virtual = !!on; this.save();
    if (!on) { this.stopVirtual(); this.emitStatus(); return this.status(); }
    if (process.platform !== "linux") { this.virt.state = "page"; this.virt.error = null; this.emitStatus(); return this.status(); }   // (the Mix tab plays it into VB-CABLE / BlackHole)
    if (this.virt.proc) return this.status();
    if (!which("pactl") || !which("pacat")) { this.virt.state = "error"; this.virt.error = "Needs PipeWire (or PulseAudio) and its tools: sudo apt install pulseaudio-utils"; this.emitStatus(); return this.status(); }
    this.cleanupModules();
    const a = this.pactl(["load-module", "module-null-sink", "sink_name=" + SINK, "rate=48000", "channels=2", "sink_properties=device.description=Central-Control-Stream"]);
    if (!a.ok) { this.virt.state = "error"; this.virt.error = "Could not make the virtual device: " + (a.err || "pactl failed"); this.emitStatus(); return this.status(); }
    this.virt.modules = [a.out];
    const b = this.pactl(["load-module", "module-remap-source", "master=" + SINK + ".monitor", "source_name=" + SOURCE, "source_properties=device.description=Central-Control-Stream"]);
    if (b.ok) this.virt.modules.push(b.out);
    const p = spawn("pacat", ["--playback", "--device=" + SINK, "--format=s16le", "--rate=48000", "--channels=2", "--latency-msec=40", "--client-name=Central Control", "--stream-name=Stream mix"], { stdio: ["pipe", "ignore", "pipe"] });
    let err = ""; p.stderr.on("data", (d) => { err = (err + d).slice(-300); }); p.stdin.on("error", () => { });
    p.on("exit", () => { if (this.virt.proc !== p) return; this.virt.proc = null; this.virt.state = this.cfg.virtual ? "error" : "off"; this.virt.error = this.cfg.virtual ? (err.trim() || "the virtual device stopped") : null; this.syncTap(); this.emitStatus(); });
    this.virt.proc = p; this.virt.state = "on"; this.virt.error = null; this.syncTap(); this.emitStatus();
    return this.status();
  }
  stopVirtual() {
    const p = this.virt.proc; this.virt.proc = null; if (p) { try { p.kill(); } catch (_) { } }
    if (process.platform === "linux" && this.virt.modules.length && which("pactl")) { this.virt.modules.slice().reverse().forEach((id) => { if (/^\d+$/.test(id)) this.pactl(["unload-module", id]); }); }
    this.virt.modules = []; this.virt.state = "off"; this.virt.error = null; this.syncTap();
  }
  // ---------------------------------------------------------------- going live with a still picture
  destUrl(d) {
    if (d.kind === "file") return String(d.url || "").trim();
    const k = String(d.key || "").trim(), base = String(d.url || (KINDS[d.kind] || {}).url || "").trim().replace(/\/+$/, "");
    return k ? base + "/" + k : base;
  }
  args(url) {
    const pic = this.cfg.picture && fs.existsSync(this.cfg.picture) ? this.cfg.picture : null;
    const video = pic ? ["-re", "-loop", "1", "-framerate", "30", "-i", pic] : ["-re", "-f", "lavfi", "-i", "color=c=0x111317:s=1280x720:r=30"];
    const vf = pic ? ["-vf", "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0x111317,format=yuv420p"] : ["-pix_fmt", "yuv420p"];
    const out = /\.(mp4|mkv|flv|ts)$/i.test(url) && !/^\w+:\/\//.test(url) ? ["-f", url.toLowerCase().endsWith(".ts") ? "mpegts" : url.toLowerCase().endsWith(".flv") ? "flv" : url.toLowerCase().endsWith(".mkv") ? "matroska" : "mp4", "-y", url] : ["-f", "flv", "-flvflags", "no_duration_filesize", url];
    return ["-hide_banner", "-loglevel", "error", "-nostats", "-progress", "pipe:2", "-stats_period", "1"].concat(video,
      ["-thread_queue_size", "512", "-f", "s16le", "-ar", "48000", "-ac", "2", "-i", "pipe:0", "-map", "0:v", "-map", "1:a"], vf,
      ["-c:v", "libx264", "-preset", "veryfast", "-tune", "stillimage", "-b:v", "800k", "-maxrate", "800k", "-bufsize", "1600k", "-g", "60", "-keyint_min", "60", "-r", "30",
        "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2"], out);
  }
  startLive(id) {
    const d = this.cfg.destinations.find((x) => x.id === id); if (!d) return;
    const bin = this.ffmpeg(); if (!bin) { this.live.set(id, { proc: null, status: "error", error: "ffmpeg is missing from this installation." }); this.emitStatus(); return; }
    const url = this.destUrl(d); if (!url || (d.kind !== "file" && !d.key && d.kind !== "rtmp")) { this.live.set(id, { proc: null, status: "error", error: "No stream key yet." }); this.emitStatus(); return; }
    const old = this.live.get(id) || {};
    const p = spawn(bin, this.args(url), { stdio: ["pipe", "ignore", "pipe"], windowsHide: true });
    const r = { proc: p, status: "connecting", error: null, bytes: 0, kbps: 0, retries: old.retries || 0, since: Date.now() }; this.live.set(id, r);
    p.stdin.on("error", () => { });
    let buf = "", tail = "";
    p.stderr.on("data", (b) => {
      buf += b; let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); const m = /^(\w+)=(.*)$/.exec(l);
        if (!m) { tail = (tail + l + "\n").slice(-400); continue; }
        if (m[1] === "total_size") { const n = Number(m[2]) || 0; if (n > r.bytes) { if (r.status !== "live") { r.status = "live"; r.retries = 0; } r.kbps = Math.round((n - r.bytes) * 8 / 1000); r.bytes = n; } }
        if (m[1] === "progress") this.emitStatus();
      }
    });
    p.on("exit", (code) => {
      if (this.live.get(id) !== r) return;
      r.proc = null; this.syncTap();
      if (d.on) { r.status = "reconnecting"; r.error = (tail.trim().split("\n").pop() || "disconnected (" + code + ")").slice(0, 200); r.retries++; r.retry = setTimeout(() => { if (this.live.get(id) === r && d.on) this.startLive(id); }, Math.min(15000, 2000 * r.retries)); }
      else { r.status = "off"; }
      this.emitStatus();
    });
    this.syncTap(); this.emitStatus();
  }
  stopLive(id) { const r = this.live.get(id); if (!r) return; clearTimeout(r.retry); const p = r.proc; r.proc = null; r.status = "off"; if (p) { try { p.stdin.end(); } catch (_) { } setTimeout(() => { try { p.kill(); } catch (_) { } }, 2500); } this.live.delete(id); this.syncTap(); }
  setLive(id, on) {
    const list = id === "all" ? this.cfg.destinations : this.cfg.destinations.filter((d) => d.id === id);
    list.forEach((d) => { d.on = !!on; if (on) { if (!(this.live.get(d.id) || {}).proc) this.startLive(d.id); } else this.stopLive(d.id); });
    this.save(); this.emitStatus(); return this.status();
  }
  // ---------------------------------------------------------------- settings / status
  config(patch) {
    patch = patch || {};
    if (patch.picture != null) this.cfg.picture = String(patch.picture);
    if (Array.isArray(patch.destinations)) {
      const keep = new Set();
      this.cfg.destinations = patch.destinations.slice(0, 8).map((d) => { const id = d.id || "s" + crypto.randomBytes(3).toString("hex"); keep.add(id); const was = this.cfg.destinations.find((x) => x.id === id) || {}; return { id, kind: KINDS[d.kind] ? d.kind : "rtmp", name: String(d.name || "").slice(0, 40), url: String(d.url || "").slice(0, 400), key: d.key != null ? String(d.key).slice(0, 200) : was.key || "", on: !!was.on }; });
      for (const id of [...this.live.keys()]) if (!keep.has(id)) this.stopLive(id);
    }
    this.save(); this.emitStatus(); return this.status();
  }
  status() {
    const dests = this.cfg.destinations.map((d) => { const r = this.live.get(d.id) || {}; return { id: d.id, kind: d.kind, label: d.name || (KINDS[d.kind] || {}).label || d.kind, url: d.kind === "rtmp" || d.kind === "file" ? d.url : "", hasKey: !!d.key, on: !!d.on, status: d.on ? r.status || "starting" : "off", error: r.error || null, kbps: r.kbps || 0, retries: r.retries || 0 }; });
    return { platform: process.platform, virtual: { on: !!this.cfg.virtual, state: this.virt.state, error: this.virt.error, name: "Central Control Stream" },
      picture: this.cfg.picture, destinations: dests, kinds: Object.fromEntries(Object.entries(KINDS).map(([k, v]) => [k, v.label])),
      live: dests.some((d) => d.status === "live"), ffmpeg: !!this.ffmpeg() };
  }
  emitStatus() { clearTimeout(this.emitT); this.emitT = setTimeout(() => this.emit("status", this.status()), 120); }
  stop() { for (const id of [...this.live.keys()]) this.stopLive(id); this.stopVirtual(); }
}
module.exports = { StreamOut, KINDS };
