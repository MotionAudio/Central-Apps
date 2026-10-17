/* Central Usage - records the service on the audio host.
 *   Every input of the audio interface / Dante (up to 128), the Central Control's tracks as they arrive over the
 *   network, and a stereo program (the main mix, or any mix) for the sermon podcast: one WAV per source, 48 kHz,
 *   24 bit, in a folder per recording - "2026-10-17 10.30 - Sunday morning" - under the recordings folder.
 *   The engine (cu-mixer) writes the files on its own thread: the audio thread only copies into a lock-free ring,
 *   so a slow disk never glitches the sound. After the stop the program also becomes an MP3 (the bundled ffmpeg).
 *   A recording cut short (a crash, a power cut) keeps its ".recording" marker; the next start (and the app's
 *   start) repairs its WAV headers with "cu-mixer --repair" and makes the MP3 it is missing.
 * API (main process): start({ name, program: "main" | mix index | false, inputs: "all" | "used" | [channels] }),
 * stop(), state(), on("state", (state, event) => ...) - events: starting, started, stopping, stopped, error,
 * mp3, repaired, tick. In the page: window.CU.recorder (preload.js). */
"use strict";
const EventEmitter = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const MARKER = ".recording";
const LOW_SPACE = 10e9;   // warn under 10 GB free
const NETCH = 40;
function clean(s, max) { return String(s == null ? "" : s).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/\s+/g, " ").trim().replace(/^[.\s-]+|[.\s]+$/g, "").slice(0, max || 60); }
function pad(n) { return String(n).padStart(2, "0"); }
function stamp(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + "." + pad(d.getMinutes()); }

class Recorder extends EventEmitter {
  /* opts: engine, bin (cu-mixer, for --repair), ffmpeg: () => path | null, dir: () => the recordings folder */
  constructor(opts) {
    super();
    this.engine = opts.engine; this.bin = opts.bin; this.ffmpeg = opts.ffmpeg || (() => null); this.dir = opts.dir;
    this.st = { recording: false, starting: false, stopping: false, error: null, name: "", folder: null, started: 0, frames: 0, dropped: 0, tracks: 0, files: [], last: null, mp3: null, free: null };
    this.waiters = []; this.timer = null; this.mp3Proc = null;
    this.engine.on("rec", (e) => this.onRec(e));
    this.engine.on("meters", (m) => { if (this.st.recording && m.rec) { this.st.frames = m.rec.frames; this.st.dropped = m.rec.dropped; } });
    this.engine.on("exit", () => this.onEngineGone());
  }
  root() { return this.dir(); }
  // ---------------------------------------------------------------- state
  freeSpace() {
    let p = this.st.folder || this.root();
    while (p && !fs.existsSync(p)) { const up = path.dirname(p); if (up === p) break; p = up; }
    try { const s = fs.statfsSync(p); return s.bavail * s.bsize; } catch (_) { return null; }
  }
  state() {
    const s = this.st, free = this.freeSpace();
    return { recording: s.recording, starting: s.starting, stopping: s.stopping, error: s.error, name: s.name, folder: s.folder, root: this.root(), started: s.started,
      seconds: s.recording ? (s.frames ? Math.floor(s.frames / (s.rate || 48000)) : Math.floor((Date.now() - s.started) / 1000)) : s.last ? s.last.seconds : 0,
      dropped: s.dropped, tracks: s.tracks, files: s.files.map((f) => f.file), free, lowSpace: free != null && free < LOW_SPACE, last: s.last, mp3: s.mp3 };
  }
  emitState(ev) { this.emit("state", this.state(), ev); }
  // ---------------------------------------------------------------- the engine's answers
  waitRec(test, ms) {
    return new Promise((resolve, reject) => {
      const w = { test, resolve }; this.waiters.push(w);
      setTimeout(() => { const i = this.waiters.indexOf(w); if (i >= 0) { this.waiters.splice(i, 1); reject(new Error("the audio engine did not answer")); } }, ms);
    });
  }
  onRec(e) {
    const w = this.waiters.find((x) => x.test(e)); if (w) { this.waiters.splice(this.waiters.indexOf(w), 1); w.resolve(e); return; }
    if (e.state === "error" && this.st.recording) { this.st.error = e.error; this.emitState("error"); }
    else if (e.state === "stopped" && this.st.recording && !this.st.stopping) { this.finish(e); }   // (stopped by itself)
  }
  onEngineGone() {
    if (!this.st.recording && !this.st.starting) return;
    const folder = this.st.folder; this.st.recording = false; this.st.starting = false; this.st.stopping = false; this.engine.recording = false;
    this.st.error = "The audio engine stopped - the recording was cut short there (its files are repaired).";
    clearInterval(this.timer);
    setTimeout(() => { if (folder) this.repairFolder(folder); this.st.last = this.summary(folder, null); this.emitState("error"); }, 300);
  }
  // ---------------------------------------------------------------- what is recorded
  tracks(opts) {
    const st = this.engine.status || {}, n = Number(st.inputs) || 0, names = st.captureNames || [], inputs = (this.engine.state && this.engine.state.inputs) || [], out = [];
    const want = Array.isArray(opts.inputs) ? opts.inputs.map(Number).filter((k) => k >= 0 && k < n) : null;
    for (let k = 0; k < n; k++) {
      const used = inputs.filter((x) => x.src && x.src.kind === "in" && x.src.ch === k);
      if (want ? want.indexOf(k) < 0 : opts.inputs === "used" && !used.length) continue;
      const label = used.map((x) => x.name).filter(Boolean)[0] || String(names[k] || "").replace(/^.*:/, "");
      out.push({ kind: "in", ch: k, file: "In " + pad(k + 1) + (label ? " - " + clean(label, 40) : "") + ".wav" });
    }
    if (opts.tracks !== false) (this.engine.pi.names || []).filter((x) => x.source < 4).forEach((x, i) => out.push({ kind: "net", ch: x.source * NETCH + x.ch, file: "Track " + pad(i + 1) + " - " + (clean(x.name, 40) || "ch " + (x.ch + 1)) + ".wav" }));
    const prog = opts.program == null || opts.program === "main" ? 0 : opts.program === false ? -1 : Number(opts.program) + 1;
    if (prog >= 0 && prog <= 64) out.push({ kind: "prog", ch: prog, file: "Program.wav" });
    const seen = {}; out.forEach((t) => { let f = t.file, k = 2; while (seen[f.toLowerCase()]) f = t.file.replace(/\.wav$/, " (" + k++ + ").wav"); seen[f.toLowerCase()] = 1; t.file = f; });
    return out;
  }
  // ---------------------------------------------------------------- start / stop
  async start(opts) {
    opts = opts || {};
    if (this.st.recording || this.st.starting) throw new Error("Already recording.");
    if (this.st.stopping) throw new Error("The last recording is still closing - try again in a moment.");
    if (!this.engine.proc || !this.engine.status) throw new Error("The audio engine isn't running - only the audio host records (I/O tab).");
    const root = this.root(); fs.mkdirSync(root, { recursive: true });
    this.repairAll();
    const name = clean(opts.name, 60), base = stamp(new Date()) + (name ? " - " + name : "");
    let folder = path.join(root, base), k = 2; while (fs.existsSync(folder)) folder = path.join(root, base + " (" + k++ + ")");
    const tracks = this.tracks(opts); if (!tracks.length) throw new Error("Nothing to record.");
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, MARKER), JSON.stringify({ started: new Date().toISOString(), name, files: tracks.map((t) => t.file) }, null, 1));
    const free = this.freeSpace();
    Object.assign(this.st, { starting: true, error: null, name, folder, started: Date.now(), frames: 0, dropped: 0, tracks: tracks.length, files: tracks, mp3: null });
    this.emitState("starting");
    const answer = this.waitRec((e) => e.state === "recording" || e.state === "error", 8000);
    this.engine.cmd({ cmd: "rec", on: 1, dir: folder, files: tracks.map((t) => t.file).join("|"), ins: tracks.filter((t) => t.kind === "in").map((t) => t.ch), net: tracks.filter((t) => t.kind === "net").map((t) => t.ch), prog: (tracks.find((t) => t.kind === "prog") || { ch: -1 }).ch });
    let e; try { e = await answer; } catch (err) { e = { state: "error", error: err.message }; }
    this.st.starting = false;
    if (e.state !== "recording") {
      this.st.error = "Could not start recording: " + (e.error || "unknown error"); this.st.folder = null;
      try { fs.rmSync(folder, { recursive: true, force: true }); } catch (_) { }
      this.emitState("error"); throw new Error(this.st.error);
    }
    this.st.recording = true; this.st.started = Date.now(); this.st.rate = e.rate || 48000; this.engine.recording = true;
    if (free != null && free < LOW_SPACE) this.st.error = null;   // (the low-space warning is in the state: lowSpace)
    clearInterval(this.timer); this.timer = setInterval(() => this.emitState("tick"), 5000);
    this.emitState("started"); return this.state();
  }
  async stop() {
    if (!this.st.recording) { if (this.st.stopping) await new Promise((r) => this.once("state", r)); return this.state(); }
    this.st.stopping = true; this.emitState("stopping");
    const answer = this.waitRec((e) => e.state === "stopped" || e.state === "idle", 20000);
    this.engine.cmd({ cmd: "rec", on: 0 });
    let e = null; try { e = await answer; } catch (err) { this.st.error = "The recording did not close properly (" + err.message + ") - its files are repaired."; }
    this.finish(e);
    return this.state();
  }
  finish(e) {
    const folder = this.st.folder;
    clearInterval(this.timer); this.st.recording = false; this.st.stopping = false; this.engine.recording = false;
    if (e && e.error) this.st.error = e.error;
    if (!e) this.repairFolder(folder); else { try { fs.unlinkSync(path.join(folder, MARKER)); } catch (_) { } }
    this.st.last = this.summary(folder, e);
    this.emitState("stopped");
    this.makeMp3(folder, this.st.name);
  }
  summary(folder, e) {
    if (!folder) return null;
    let files = []; try { files = fs.readdirSync(folder).filter((f) => /\.(wav|mp3)$/i.test(f)).map((f) => ({ file: f, bytes: fs.statSync(path.join(folder, f)).size })); } catch (_) { }
    const prog = path.join(folder, "Program.wav");
    return { folder, files, program: fs.existsSync(prog) ? prog : null, seconds: e && e.frames ? Math.round(e.frames / (e.rate || 48000)) : Math.round((Date.now() - this.st.started) / 1000), dropped: e ? e.dropped || 0 : null };
  }
  // ---------------------------------------------------------------- the podcast MP3 (after the stop, in the background)
  makeMp3(folder, title) {
    const wav = folder && path.join(folder, "Program.wav"), mp3 = folder && path.join(folder, "Program.mp3");
    if (!wav || !fs.existsSync(wav) || fs.existsSync(mp3)) return;
    const bin = this.ffmpeg(); if (!bin) { this.st.mp3 = { state: "error", error: "ffmpeg is missing - the MP3 was not made (the WAV is there)." }; this.emitState("mp3"); return; }
    this.st.mp3 = { state: "making", file: mp3 }; this.emitState("mp3");
    const args = ["-hide_banner", "-loglevel", "error", "-y", "-i", wav, "-codec:a", "libmp3lame", "-b:a", "128k", "-metadata", "title=" + (title || path.basename(folder)), mp3 + ".part.mp3"];
    let err = ""; const p = this.mp3Proc = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    p.stderr.on("data", (b) => { err += b; if (err.length > 4000) err = err.slice(-4000); });
    p.on("error", (x) => { err = x.message; });
    p.on("close", (code) => {
      this.mp3Proc = null;
      if (code === 0) { try { fs.renameSync(mp3 + ".part.mp3", mp3); } catch (x) { code = 1; err = x.message; } }
      else { try { fs.unlinkSync(mp3 + ".part.mp3"); } catch (_) { } }
      this.st.mp3 = code === 0 ? { state: "done", file: mp3 } : { state: "error", error: "The MP3 could not be made: " + (err.trim().split("\n").pop() || "ffmpeg failed") };
      if (this.st.last && this.st.last.folder === folder) this.st.last = this.summary(folder, { frames: this.st.last.seconds * 48000, dropped: this.st.last.dropped });
      this.emitState("mp3");
    });
  }
  // ---------------------------------------------------------------- crash repair
  repairFolder(folder) {
    let files = []; try { files = fs.readdirSync(folder).filter((f) => /\.wav$/i.test(f)).map((f) => path.join(folder, f)); } catch (_) { return null; }
    let res = null;
    if (files.length && this.bin && fs.existsSync(this.bin)) { try { const r = spawnSync(this.bin, ["--repair"], { input: files.join("\n") + "\n", encoding: "utf8", windowsHide: true, timeout: 30000 }); res = JSON.parse(r.stdout || "null"); } catch (_) { } }   // (the paths on stdin: UTF-8 on every system)
    try { fs.unlinkSync(path.join(folder, MARKER)); } catch (_) { }
    return res;
  }
  repairAll() {   // recordings left unfinished (a crash): headers fixed, the marker gone, the MP3 made
    const root = this.root(), done = []; let list = [];
    try { list = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch (_) { return done; }
    for (const d of list) {
      const folder = path.join(root, d.name);
      if (folder === this.st.folder && (this.st.recording || this.st.starting)) continue;
      if (!fs.existsSync(path.join(folder, MARKER))) continue;
      const r = this.repairFolder(folder); done.push({ folder, files: r && r.files ? r.files.length : 0 });
      if (!this.mp3Proc) this.makeMp3(folder, d.name);
    }
    if (done.length) { this.repaired = done; this.emitState("repaired"); }
    return done;
  }
}
module.exports = { Recorder, MARKER };
