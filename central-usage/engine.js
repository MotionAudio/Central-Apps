/* Central Control - the audio host's engine (main process): runs cu-mixer, keeps the mixer state (saved in
 * mixer.json), turns every change into engine commands, maps the Central Pedal's channels (by name, so
 * "Drums" keeps its EQ and fader from song to song) and hands out the taps (Wi-Fi in-ears, listening,
 * recording). */
"use strict";
const { spawn, spawnSync } = require("node:child_process");
const EventEmitter = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const M = require("./app/mixer-model");
const NETCH = 40;   // network channels per source in the engine

function which(cmd) { try { return spawnSync("sh", ["-c", "command -v " + cmd], { encoding: "utf8" }).stdout.trim() || null; } catch (_) { return null; } }

class Engine extends EventEmitter {
  constructor(opts) {
    super();
    this.dir = opts.dir; this.bin = opts.bin; this.file = path.join(this.dir, "mixer.json");
    let saved = null; try { saved = JSON.parse(fs.readFileSync(this.file, "utf8")); } catch (_) { }
    this.state = M.normalize(saved);
    this.proc = null; this.status = null; this.error = null; this.wanted = false; this.restarts = 0;
    this.pi = { sources: {}, names: [], live: {}, liveNames: {} };   // live: key -> engine channel
    this.taps = new Map();                                            // tap id -> Set of listeners (fn(buffer, frames))
    this.buf = Buffer.alloc(0); this.saveTimer = null; this.meters = null;
  }
  // ---------------------------------------------------------------- process
  start() {
    this.wanted = true; if (this.proc) return;
    if (!this.bin || !fs.existsSync(this.bin)) { this.error = "The audio engine (cu-mixer) is missing from this installation."; this.emit("status", this.info()); return; }
    const d = this.state.device, args = ["--name", process.env.CU_APP_NAME || "Central Usage", "--block", String(d.buffer || 256)];
    if (d.capture) args.push("--capture", d.capture); if (d.playback) args.push("--playback", d.playback);
    if (d.backend && d.backend !== "auto") args.push("--backend", d.backend);   // internal | jack | miniaudio | null
    if (d.exclusive) args.push("--exclusive");                                   // WASAPI / Core Audio exclusive mode: lower latency
    const env = Object.assign({}, process.env), pwjack = process.platform === "linux" && (!d.backend || d.backend === "auto" || d.backend === "jack") && which("pw-jack");
    if (pwjack) env.PIPEWIRE_QUANTUM = (d.buffer || 256) + "/48000";
    const cmd = pwjack ? pwjack : this.bin, cargs = pwjack ? [this.bin].concat(args) : args;
    let p; try { p = spawn(cmd, cargs, { env, stdio: ["pipe", "pipe", "ignore"] }); } catch (e) { this.error = e.message; this.emit("status", this.info()); return; }
    this.proc = p; this.status = null; this.error = null; this.buf = Buffer.alloc(0);
    p.stdout.on("data", (chunk) => this.onData(chunk));
    p.stdin.on("error", () => { });
    p.on("exit", (code) => {
      this.proc = null; this.status = null; this.emit("exit", code);
      if (this.wanted) { this.restarts++; this.error = "The audio engine stopped (" + code + ") - restarting"; this.emit("status", this.info()); setTimeout(() => { if (this.wanted && !this.proc) this.start(); }, Math.min(10000, 1000 * this.restarts)); }
    });
  }
  stop() { this.wanted = false; if (this.proc) { try { this.cmd({ cmd: "quit" }); } catch (_) { } const p = this.proc; setTimeout(() => { try { p.kill(); } catch (_) { } }, this.recording ? 4000 : 500); } this.proc = null; this.status = null; this.emit("status", this.info()); }   // (a recording closes its files on quit)
  restart() { const was = this.wanted; this.stop(); if (was) setTimeout(() => this.start(), 700); }
  info() { return { running: !!this.proc, status: this.status, error: this.error, pi: { names: this.pi.names, live: Object.keys(this.pi.live) }, taps: [...this.taps.keys()] }; }
  write(type, payload) { if (!this.proc || !this.proc.stdin.writable) return false; const h = Buffer.alloc(5); h[0] = type.charCodeAt(0); h.writeUInt32LE(payload.length, 1); this.proc.stdin.write(Buffer.concat([h, payload])); return true; }
  cmd(o) { return this.write("J", Buffer.from(JSON.stringify(o))); }
  onData(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    while (this.buf.length >= 5) {
      const n = this.buf.readUInt32LE(1); if (this.buf.length < 5 + n) break;
      const type = String.fromCharCode(this.buf[0]), body = this.buf.subarray(5, 5 + n); this.buf = this.buf.subarray(5 + n);
      if (type === "J") { let e; try { e = JSON.parse(body.toString("utf8")); } catch (_) { continue; } this.onEvent(e); }
      else if (type === "A" && body.length >= 3) { const tap = body[0], frames = body[1] | body[2] << 8, set = this.taps.get(tap); if (set) { const pcm = Buffer.from(body.subarray(3)); set.forEach((fn) => { try { fn(pcm, frames); } catch (_) { } }); } }
    }
  }
  onEvent(e) {
    if (e.ev === "status") { this.status = e; this.restarts = 0; this.pushAll(); this.emit("status", this.info()); }
    else if (e.ev === "meters") { this.meters = e; this.emit("meters", e); }
    else if (e.ev === "error") { this.error = e.error; this.emit("status", this.info()); }
    else if (e.ev === "rec") this.emit("rec", e);   // recording (recorder.js)
  }
  // ---------------------------------------------------------------- state -> engine
  inputCmd(i) {
    const s = this.state, x = s.inputs[i];
    let src = 0, ch = 0;
    if (x.src.kind === "in") { src = 1; ch = x.src.ch; }
    else if (x.src.kind === "pi" && this.pi.live[x.src.key] != null) { src = 2; ch = this.pi.live[x.src.key]; }
    let direct = x.direct, pre = x.directPre ? 1 : 0;
    if (s.trackOut === "direct" && x.group === "tracks" && direct < 0 && src) { const order = this.trackOrder(); const k = order.indexOf(i); if (k >= 0) direct = s.directFirst + k; }
    const e = x.eq, c = x.comp, g = x.gate || {}, fx = x.fx || {};
    return { cmd: "input", i, src, ch, trim: x.trim, phase: x.phase ? 1 : 0, hpf: x.hpf, eq: [e.on ? 1 : 0, e.lf, e.lg, e.mf, e.mg, e.mq, e.hf, e.hg, e.m2f || 3000, e.m2g || 0, e.m2q || 1], comp: [c.on ? 1 : 0, c.thr, c.ratio, c.att, c.rel, c.makeup],
      gate: [g.on ? 1 : 0, g.thr, g.range, g.att, g.hold, g.rel], fx: [fx.rev == null ? -90 : fx.rev, fx.dly == null ? -90 : fx.dly], fader: x.fader, mute: x.mute ? 1 : 0, pan: x.pan, direct, directPre: pre };
  }
  fxCmd() {
    const r = this.state.fx.rev, d = this.state.fx.dly, ms = M.delayMs(d);
    return { cmd: "fx", rev: [r.on ? 1 : 0, r.decay, r.pre, r.damp, r.lowcut, r.width, r.ret], dly: [d.on ? 1 : 0, ms, d.ping ? ms : ms, d.fb, d.hicut, d.lowcut, d.ret, d.ping ? 1 : 0] };
  }
  streamUsed() { const q = this.state.stream; return Object.keys(q.sends).length > 0 || (this.taps.get(M.STREAMTAP) || new Set()).size > 0 || q.outL >= 0 || q.outR >= 0; }
  streamCmd() {
    const q = this.state.stream, c = q.comp, tapped = (this.taps.get(M.STREAMTAP) || new Set()).size > 0;
    return { cmd: "stream", level: q.level, mute: q.mute ? 1 : 0, outL: q.outL, outR: q.outR, tap: tapped ? 1 : 0, used: this.streamUsed() || this.recording ? 1 : 0, comp: [c.on ? 1 : 0, c.thr, c.ratio, c.att, c.rel, c.makeup], rRev: q.rRev, rDly: q.rDly };
  }
  ssendCmd(i) { const sd = this.state.stream.sends[i]; return sd ? { cmd: "ssend", i, level: sd.level, pan: sd.pan, on: sd.on === false ? 0 : 1 } : { cmd: "ssend", i, level: -90, pan: 0, on: 0 }; }
  // the song's tempo (the Central Pedal's BPM): the delay follows it when it is set to a note value
  setTempo(bpm) { bpm = Math.round((Number(bpm) || 0) * 10) / 10; const d = this.state.fx.dly; if (!(bpm >= 30 && bpm <= 400) || Math.abs((d.bpm || 0) - bpm) < 0.05) return false; d.bpm = bpm; this.cmd(this.fxCmd()); this.saveSoon(); this.emit("op", { op: "fx", patch: { dly: { bpm } } }, { role: "host" }); return true; }
  trackOrder() { const s = this.state, out = []; s.inputs.forEach((x, i) => { if (x.group === "tracks" && x.direct < 0 && (x.src.kind === "in" || (x.src.kind === "pi" && this.pi.live[x.src.key] != null))) out.push(i); }); return out; }
  mixCmd(m) {
    const q = this.state.mixes[m], tapped = (this.taps.get(m + 1) || new Set()).size > 0, wired = !!q.wired;
    return { cmd: "mix", m, level: q.level, mute: q.mute ? 1 : 0, outL: wired ? q.outL : -1, outR: wired ? q.outR : -1, stereo: q.stereo ? 1 : 0, tap: tapped ? 1 : 0, used: (Object.keys(q.sends).length || tapped || (wired && (q.outL >= 0 || q.outR >= 0))) ? 1 : 0, rRev: q.rRev == null ? -90 : q.rRev, rDly: q.rDly == null ? -90 : q.rDly };
  }
  mainCmd() { const s = this.state, b = s.main, tapped = (this.taps.get(0) || new Set()).size > 0, direct = s.trackOut === "direct"; return { cmd: "main", level: b.level, mute: b.mute ? 1 : 0, outL: direct ? -1 : b.outL, outR: direct ? -1 : b.outR, stereo: 1, tap: tapped ? 1 : 0, used: 1 }; }
  sendCmd(m, i) { const sd = this.state.mixes[m].sends[i]; return sd ? { cmd: "send", m, i, level: sd.level, pan: sd.pan, on: sd.on === false ? 0 : 1 } : { cmd: "send", m, i, level: -90, pan: 0, on: 0 }; }
  pushNet() { Object.keys(this.pi.sources).filter((k) => Number(k) < 4).forEach((k) => { const src = this.pi.sources[k]; this.cmd({ cmd: "net", src: Number(k), channels: Math.min(NETCH, (src.channels || []).length), rate: src.rate || 48000, latency: this.latency || 60 }); }); }
  pushAll() {
    if (!this.proc) return;
    this.pushNet();
    for (let i = 0; i < M.MAXIN; i++) this.cmd(this.inputCmd(i));
    this.cmd(this.mainCmd());
    for (let m = 0; m < M.MAXMIX; m++) { this.cmd(this.mixCmd(m)); Object.keys(this.state.mixes[m].sends).forEach((i) => this.cmd(this.sendCmd(m, Number(i)))); }
    this.cmd(this.fxCmd()); this.cmd(this.streamCmd()); Object.keys(this.state.stream.sends).forEach((i) => this.cmd(this.ssendCmd(Number(i))));
    this.cmd({ cmd: "analysis", src: this.analysis === "main" ? 1 : 0 });
    this.emit("pushed");   // (talkback sets its slots up again)
  }
  // ---------------------------------------------------------------- ops
  apply(op, who) {
    if (op && op.op === "claim" && !op.id && who && who.id) op = Object.assign({}, op, { id: who.id });   // so every copy gives the mix to the same person
    const before = op.op === "device" ? JSON.stringify(this.state.device) : null;
    if (!M.apply(this.state, op, who)) return false;
    this.sync(op, before);
    this.saveSoon(); this.emit("op", op, who);
    return true;
  }
  sync(op, deviceBefore) {
    if (op.op === "input") { if (op.patch && (op.patch.group || op.patch.direct != null || op.patch.src) && this.state.trackOut === "direct") { for (let i = 0; i < M.MAXIN; i++) this.cmd(this.inputCmd(i)); } else this.cmd(this.inputCmd(op.i)); }
    else if (op.op === "main") this.cmd(this.mainCmd());
    else if (op.op === "trackOut") { for (let i = 0; i < M.MAXIN; i++) this.cmd(this.inputCmd(i)); this.cmd(this.mainCmd()); }
    else if (op.op === "mix" || op.op === "claim" || op.op === "release") this.cmd(this.mixCmd(op.m));
    else if (op.op === "autoWire") { for (let m = 0; m < M.MAXMIX; m++) this.cmd(this.mixCmd(m)); }
    else if (op.op === "send") { this.cmd(this.sendCmd(op.m, op.i)); this.cmd(this.mixCmd(op.m)); }
    else if (op.op === "clearSends") { this.cmd({ cmd: "clearSends", m: op.m }); this.cmd(this.mixCmd(op.m)); }
    else if (op.op === "fx") this.cmd(this.fxCmd());
    else if (op.op === "stream") this.cmd(this.streamCmd());
    else if (op.op === "streamSend") { this.cmd(this.ssendCmd(op.i)); this.cmd(this.streamCmd()); }
    else if (op.op === "streamCopy") { for (let i = 0; i < M.MAXIN; i++) this.cmd(this.ssendCmd(i)); this.cmd(this.streamCmd()); }
    else if (op.op === "device" && JSON.stringify(this.state.device) !== deviceBefore) this.restart();
  }
  saveSoon() { clearTimeout(this.saveTimer); this.saveTimer = setTimeout(() => this.save(), 800); }
  save() { try { fs.mkdirSync(this.dir, { recursive: true }); fs.writeFileSync(this.file + ".tmp", JSON.stringify(this.state)); fs.renameSync(this.file + ".tmp", this.file); } catch (_) { } }
  replaceState(next) { this.state = M.normalize(next); this.save(); this.pushAll(); this.emit("state", this.state); }
  // ---------------------------------------------------------------- the Central Pedal's channels
  setPiStream(sources, base) {   // base 0: the track player (slots 0/1); 2: another pedal (slots 2/3) - each replaces only its own
    base = base || 0; const keep = {}; Object.keys(this.pi.sources || {}).forEach((k) => { const s = Number(k); if (s < base || s > base + 1) keep[s] = this.pi.sources[k]; });
    sources = Object.assign({}, keep, sources || {});
    this.pi.sources = {}; const live = {}, names = [], seen = {};
    Object.keys(sources || {}).forEach((k) => {
      const s = Number(k); if (!(s >= 0 && s < 4)) return; const src = sources[k] || {}; this.pi.sources[s] = { channels: (src.channels || []).slice(0, NETCH), rate: src.rate || 48000 };
      const pans = Array.isArray(src.pans) ? src.pans : [];
      this.pi.sources[s].channels.forEach((name, c) => { let key = String(name || "ch " + (c + 1)).toLowerCase().trim(); if (seen[key]) { let n = 2; while (seen[key + " " + n]) n++; key = key + " " + n; name = name + " " + n; } seen[key] = true; live[key] = s * NETCH + c; names.push({ key, name, source: s, ch: c, pan: Math.max(-1, Math.min(1, Number(pans[c]) || 0)) }); });
    });
    this.pi.live = live; this.pi.names = names;
    // every channel gets an input (found by name; a new name takes the first free input)
    names.forEach((n) => {
      if (this.state.inputs.some((x) => x.src.kind === "pi" && x.src.key === n.key)) return;
      const free = this.state.inputs.findIndex((x) => x.src.kind === "none" && !x.name);
      if (free < 0) return;
      const tracks = n.source === 0 && !/^(tracks mix|pads|click)/i.test(n.name);
      this.apply({ op: "input", i: free, patch: { src: { kind: "pi", key: n.key }, name: n.name, group: tracks || n.source === 1 ? "tracks" : "band", fader: /^tracks mix/i.test(n.name) ? -90 : 0, pan: n.pan || 0, show: true } }, { role: "host" });   // (a track starts at the pan it has on the Central Pedal)
    });
    if (this.proc) { this.pushNet(); for (let i = 0; i < M.MAXIN; i++) this.cmd(this.inputCmd(i)); }
    this.emit("pi", this.pi);
  }
  netAudio(source, channels, frames, pcm) {   // pcm: int16 interleaved (Buffer)
    if (!this.proc) return;
    const h = Buffer.alloc(4); h[0] = source; h[1] = channels; h.writeUInt16LE(frames, 2);
    this.write("N", Buffer.concat([h, pcm]));
  }
  setLatency(ms) { this.latency = Math.max(10, Math.min(500, Number(ms) || 60)); this.pushNet(); }
  setAnalysis(src) { this.analysis = src; this.cmd({ cmd: "analysis", src: src === "main" ? 1 : 0 }); }
  // ---------------------------------------------------------------- taps
  tap(id, fn, on) {
    let set = this.taps.get(id); if (!set) { set = new Set(); this.taps.set(id, set); }
    if (on) set.add(fn); else set.delete(fn);
    if (!set.size) this.taps.delete(id);
    if (id === 0) this.cmd(this.mainCmd()); else if (id >= 1 && id <= M.MAXMIX) this.cmd(this.mixCmd(id - 1)); else if (id === M.STREAMTAP) this.cmd(this.streamCmd());
  }
}
module.exports = { Engine, NETCH };
