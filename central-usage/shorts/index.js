/* Shorts (10.2) - the service in Central Control's main process, on the main admin's computer only:
 *   - while the service records, it notes when each song and section starts (markers.json in the recording's folder)
 *   - after a recording ends (if "Make shorts after each service" is on) it queues the recording; one job runs at a
 *     time in worker.js (a process of its own at low priority) and reports how far it got
 *   - the review screen (app/shorts.js) lists the recordings and their shorts, trims, edits captions and titles, makes
 *     another from any moment, deletes, downloads and posts (post.js, with a token from the website)
 * The shorts of a recording go in "<recordings folder>/Shorts/<the recording's name>/": shorts.json, the MP4s, a picture
 * and an SRT each. */
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { fork } = require("node:child_process");
const P = require("./pick");
const R = require("./render");
const C = require("./captions");
const POST = require("./post");
const LEARN = require("./learn");
const STATS = require("./analytics");
const SCH = require("./schedule");

const FULL_DEFAULTS = { speaker: "", scripture: "", links: "", hashtags: "", ccli: "", when: "slot",
  worship: { on: false, title: "Worship - {date}", privacy: "unlisted", playlist: "Worship", platforms: { youtube: true, facebook: false }, auto: false },
  sermon: { on: false, title: "{sermon} - {speaker}", privacy: "public", playlist: "Sermons", platforms: { youtube: true, facebook: false }, auto: false } };
const SETTINGS = Object.assign({ auto: true, useAI: true, learn: true, schedule: SCH.DEFAULT, template: SCH.TEMPLATE, linkMode: "live", linkUrl: "", links: "", full: FULL_DEFAULTS, minRecording: 10, privacy: "public", hashtags: "", tiktokDirect: false }, P.DEFAULTS, R.DEFAULTS, { captions: Object.assign({}, C.STYLE) });
const MODELS = { accurate: "onnx-community/whisper-small_timestamped", fast: "onnx-community/whisper-base_timestamped" };

function setup({ ipcMain, app, getWin, svc, videoDir, ffmpeg, shell, dialog }) {
  const userData = app.getPath("userData");
  const cfgFile = path.join(userData, "shorts.json"), histFile = path.join(userData, "shorts-posted.json");
  // (10.3) what the church's reviews teach (stays on this computer; moves with the hub to the other main admin's)
  const learnFile = path.join(userData, "shorts-learning.json"), L = LEARN.load(learnFile);
  const lesson = (type, s, extra) => { if (settings.learn === false || !s) return; L.record(Object.assign({ type, shortId: s.id, kind: s.kind, x: s.features || null, len: Math.round((s.end - s.start) * 10) / 10 }, extra || {})); };
  let settings = JSON.parse(JSON.stringify(SETTINGS));
  try { const s = JSON.parse(fs.readFileSync(cfgFile, "utf8")); settings = Object.assign(settings, s, { captions: Object.assign({}, SETTINGS.captions, s.captions || {}) }); } catch (_) { }
  const saveSettings = () => { try { fs.mkdirSync(userData, { recursive: true }); fs.writeFileSync(cfgFile, JSON.stringify(settings, null, 1)); } catch (_) { } };
  const send = (m) => { const w = getWin(); if (w && !w.isDestroyed()) w.webContents.send("shorts-event", m); };
  const isMain = () => !!(svc && svc.isMain && svc.isMain());
  const recordDir = () => (svc && svc.recordDir && svc.recordDir()) || path.join(os.homedir(), "Central Usage Recordings");
  const shortsRoot = () => path.join(recordDir(), "Shorts");
  const fonts = path.join(__dirname, "fonts");   // (inside the app's archive is fine: the worker copies them next to each short's captions)

  // ---------------------------------------------------------------- the song markers while recording
  let marks = null;   // { folder, started, list }
  function markersFile(folder) { return path.join(folder, "markers.json"); }
  if (svc && svc.recorder) svc.recorder.on("state", (st, ev) => {
    if (ev === "started" && st.folder) { marks = { folder: st.folder, started: st.started || Date.now(), list: [] }; writeMarks(); }
    if (ev === "stopped") {
      const done = marks; marks = null;
      const last = st.last; if (!last || !last.folder) return;
      if (done && done.list.length) { done.list.push({ at: Date.now(), song: null, playing: false }); writeMarks(done); }
      if (settings.auto && isMain() && (last.seconds || 0) >= (Number(settings.minRecording) || 10) * 60) setTimeout(() => queue({ mode: "make", id: last.folder, auto: true }), 90e3);   // (after the MP3 and the camera recording have finished)
    }
  });
  function writeMarks(m) { m = m || marks; if (!m) return; try { fs.writeFileSync(markersFile(m.folder), JSON.stringify({ started: m.started, marks: m.list })); } catch (_) { } }
  ipcMain.on("shorts-mark", (_e, d) => {
    if (!marks || !d) return; const last = marks.list[marks.list.length - 1];
    const m = { at: Date.now(), song: d.song ? String(d.song).slice(0, 120) : null, section: d.section ? String(d.section).slice(0, 60) : null, playing: d.playing !== false };
    if (last && last.song === m.song && last.section === m.section && last.playing === m.playing) return;
    marks.list.push(m); writeMarks();
  });

  // ---------------------------------------------------------------- the recordings
  const pad = (n) => String(n).padStart(2, "0");
  function whenFromName(name) { const m = /(\d{4})-(\d{2})-(\d{2})[ _](\d{2})[.:](\d{2})(?:[.:](\d{2}))?/.exec(name); return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)).getTime() : 0; }
  function videos() { const d = videoDir && videoDir(); try { return fs.readdirSync(d).filter((f) => /\.(mp4|mov|mkv)$/i.test(f) && !/\.part\./.test(f)).map((f) => { const file = path.join(d, f), st = fs.statSync(file); return { file, name: f.replace(/\.\w+$/, ""), when: whenFromName(f) || st.birthtimeMs || st.mtimeMs, end: st.mtimeMs, bytes: st.size }; }); } catch (_) { return []; } }
  function list() {
    const out = [], vids = videos(), used = new Set(), root = recordDir();
    let dirs = []; try { dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== "Shorts").map((d) => path.join(root, d.name)); } catch (_) { }
    for (const folder of dirs) {
      const audio = ["Stream mix.wav", "Program.wav", "Stream mix.mp3", "Program.mp3"].map((f) => path.join(folder, f)).find((f) => fs.existsSync(f));
      if (!audio) continue;
      let m = null; try { m = JSON.parse(fs.readFileSync(markersFile(folder), "utf8")); } catch (_) { }
      const name = path.basename(folder), when = (m && m.started) || whenFromName(name) || fs.statSync(folder).mtimeMs;
      let secs = 0; try { const sz = fs.statSync(audio).size; secs = /\.wav$/i.test(audio) ? Math.round(sz / (48000 * 3 * 2)) : Math.round(sz / 16000); } catch (_) { }
      // the camera recording made during it: started within 20 minutes of it, or overlapping it
      const v = vids.filter((x) => !used.has(x.file) && (Math.abs(x.when - when) < 20 * 60e3 || (x.when < when + secs * 1000 && x.end > when))).sort((a, b) => Math.abs(a.when - when) - Math.abs(b.when - when))[0];
      if (v) used.add(v.file);
      out.push({ id: folder, name, when, seconds: secs, audio, video: v ? v.file : null, markers: !!(m && m.marks && m.marks.length) });
    }
    for (const v of vids) if (!used.has(v.file)) out.push({ id: v.file, name: v.name, when: v.when, seconds: Math.round((v.end - v.when) / 1000), audio: null, video: v.file, markers: false });
    out.forEach((r) => { r.dir = path.join(shortsRoot(), safe(r.name)); const d = readShorts(r.dir); r.shorts = d ? d.shorts.filter((s) => s.status !== "deleted").length : 0; r.made = d ? d.finished || d.created : null; r.note = d ? d.note : null; });
    return out.sort((a, b) => b.when - a.when).slice(0, 60);
  }
  function safe(n) { return String(n).replace(/[\\/:*?"<>|]+/g, "-").trim().slice(0, 80) || "Recording"; }
  function readShorts(dir) { try { return JSON.parse(fs.readFileSync(path.join(dir, "shorts.json"), "utf8")); } catch (_) { return null; } }
  function writeShorts(dir, d) { fs.writeFileSync(path.join(dir, "shorts.json.tmp"), JSON.stringify(d, null, 1)); fs.renameSync(path.join(dir, "shorts.json.tmp"), path.join(dir, "shorts.json")); }
  function find(id) { const r = list().find((x) => x.id === id); if (!r) throw new Error("That recording isn't in the recordings folder any more."); return r; }

  // ---------------------------------------------------------------- the queue (one job at a time)
  const jobs = []; let running = null, lastProgress = null;
  function asrInfo() {
    let cfg = { model: "accurate", language: "" }; try { cfg = Object.assign(cfg, JSON.parse(fs.readFileSync(path.join(userData, "asr.json"), "utf8"))); } catch (_) { }
    const id = MODELS[cfg.model] || MODELS.accurate, dir = path.join(userData, "speech-models");
    try { if (fs.readdirSync(path.join(dir, ...id.split("/"), "onnx")).some((f) => /decoder_model_merged/.test(f))) return { dir, model: id, language: cfg.language || "" }; } catch (_) { }
    return null;
  }
  function queue(j) {
    if (!isMain() && !process.env.CU_SHORTS_ANY) return { error: "Shorts are made on the main admin's computer." };
    if (j.mode === "make" && (running && running.id === j.id && running.mode === "make" || jobs.some((x) => x.id === j.id && x.mode === "make"))) return status();
    jobs.push(j); next(); return status();
  }
  async function next() {
    if (running || !jobs.length) return;
    const j = jobs.shift(); running = Object.assign({ started: Date.now(), step: "start", pct: 0, text: "Starting" }, j); lastProgress = null; send({ type: "status", status: status() });
    try {
      const r = find(j.id); fs.mkdirSync(r.dir, { recursive: true });
      const bin = ffmpeg(); if (!bin) throw new Error("ffmpeg is missing from this installation.");
      let aiPort = null;
      if (j.mode !== "render" && settings.useAI !== false && svc && svc.ai) { running.text = "Starting the AI model"; send({ type: "progress", job: running }); aiPort = await svc.ai.ensure().catch(() => null); }
      let markers = []; if (r.audio) { try { const m = JSON.parse(fs.readFileSync(markersFile(path.dirname(r.audio)), "utf8")); markers = (m.marks || []).map((x) => ({ t: (x.at - m.started) / 1000, song: x.song, section: x.section, playing: x.playing })); } catch (_) { } }
      const church = (svc && svc.churchName && svc.churchName()) || "";
      const jobFile = path.join(r.dir, ".job.json");
      fs.writeFileSync(jobFile, JSON.stringify({ mode: j.mode, id: j.shortId, at: j.at, out: r.dir, audio: r.audio, video: r.video, markers, settings, ffmpeg: bin, fonts, asr: asrInfo(), aiPort, church, recordingName: r.name, recordedAt: r.when, only: j.only || null, fakeWords: process.env.CU_SHORTS_FAKE_WORDS || undefined, learningFile: settings.learn !== false ? learnFile : null }));
      await new Promise((resolve) => {
        const p = fork(path.join(__dirname, "worker.js"), [jobFile], { env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: "1" }), stdio: ["ignore", "ignore", "pipe", "ipc"] });
        running.proc = p; let err = ""; p.stderr.on("data", (b) => { err = (err + b).slice(-2000); });
        p.on("message", (m) => {
          if (m.type === "progress") { Object.assign(running, { step: m.step, pct: m.pct, text: m.text }); const now = Date.now(); if (!lastProgress || now - lastProgress > 400 || m.pct >= 1) { lastProgress = now; send({ type: "progress", job: pub(running) }); } }
          else if (m.type === "short") send({ type: "short", recording: j.id, short: m.short });
          else if (m.type === "error") running.error = m.error;
        });
        p.on("exit", (code) => { if (code && !running.error && !running.cancelled) running.error = (err.trim().split("\n").pop() || "The shorts helper stopped (" + code + ")").slice(0, 300); resolve(); });
      });
      try { fs.unlinkSync(jobFile); } catch (_) { }
      if (running.error && !running.cancelled) throw new Error(running.error);
      if (!running.cancelled && (j.mode === "make" || j.mode === "full")) { const d = readShorts(r.dir); for (const k of ["worship", "sermon"]) { const it = d && d.full && d.full[k]; if (it && it.status === "new" && settings.full[k].auto) { it.status = "approved"; writeShorts(r.dir, d); const only = ["youtube", "facebook"].filter((p) => settings.full[k].platforms[p]); toQueue({ ref: j.id + "#full-" + k, recording: j.id, full: k, title: it.title, kinds: only }, only); } } }
      send({ type: "done", recording: j.id, mode: j.mode, cancelled: !!running.cancelled });
    } catch (e) { send({ type: "error", recording: j.id, error: String(e && e.message || e) }); }
    running = null; send({ type: "status", status: status() }); setTimeout(next, 100);
  }
  const pub = (r) => r ? { id: r.id, mode: r.mode, step: r.step, pct: r.pct, text: r.text, started: r.started, auto: !!r.auto } : null;
  function status() { return { isMain: isMain(), settings, job: pub(running), queued: jobs.map((j) => ({ id: j.id, mode: j.mode })), speech: !!asrInfo(), ai: !!(svc && svc.ai && svc.ai.available && svc.ai.available()), ffmpeg: !!ffmpeg(), folder: shortsRoot() }; }

  // ---------------------------------------------------------------- the review screen's calls
  ipcMain.handle("shorts-status", () => status());
  ipcMain.handle("shorts-recordings", () => list());
  ipcMain.handle("shorts-settings", (_e, patch) => {
    patch = patch || {};
    const num = (k, lo, hi) => { if (patch[k] != null && isFinite(patch[k])) settings[k] = Math.max(lo, Math.min(hi, Number(patch[k]))); };
    num("count", 1, 20); num("minLen", 10, 170); num("maxLen", 15, 180); num("sermonShare", 0, 1); num("minRecording", 0, 240); num("introSeconds", 1, 10); num("outroSeconds", 1, 10); num("logoSize", 5, 40); num("logoOpacity", 0.1, 1);
    if (settings.maxLen < settings.minLen + 5) settings.maxLen = settings.minLen + 5;
    for (const k of ["auto", "useAI", "learn", "tiktokDirect"]) if (typeof patch[k] === "boolean") settings[k] = patch[k];
    for (const k of ["framing", "background", "accent", "logo", "logoCorner", "intro", "outro", "privacy", "hashtags"]) if (typeof patch[k] === "string") settings[k] = patch[k].slice(0, 500);
    if (patch.captions && typeof patch.captions === "object") { const c = patch.captions; settings.captions = Object.assign({}, settings.captions, { on: c.on != null ? !!c.on : settings.captions.on, font: c.font ? String(c.font).slice(0, 60) : settings.captions.font, size: c.size != null ? Math.max(2, Math.min(9, Number(c.size) || 4.6)) : settings.captions.size, color: /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : settings.captions.color, highlight: /^#[0-9a-f]{6}$/i.test(c.highlight) ? c.highlight : settings.captions.highlight, outline: /^#[0-9a-f]{6}$/i.test(c.outline) ? c.outline : settings.captions.outline, position: ["top", "middle", "bottom"].includes(c.position) ? c.position : settings.captions.position, upper: c.upper != null ? !!c.upper : settings.captions.upper, box: c.box != null ? !!c.box : settings.captions.box, words: c.words != null ? Math.max(1, Math.min(8, Math.round(c.words))) : settings.captions.words }); }
    // (10.3) social media: the posting schedule, the description, the link to the whole service, the full videos
    if (patch.schedule && typeof patch.schedule === "object") settings.schedule = SCH.norm(Object.assign({}, settings.schedule, patch.schedule));
    if (typeof patch.template === "string") settings.template = patch.template.slice(0, 2000);
    if (["live", "sermon", "custom", "none"].includes(patch.linkMode)) settings.linkMode = patch.linkMode;
    if (typeof patch.linkUrl === "string") settings.linkUrl = /^https:\/\//.test(patch.linkUrl.trim()) ? patch.linkUrl.trim().slice(0, 300) : "";
    if (typeof patch.links === "string") settings.links = patch.links.slice(0, 1000);
    if (patch.full && typeof patch.full === "object") settings.full = fullNorm(Object.assign({}, settings.full, patch.full, { worship: Object.assign({}, (settings.full || {}).worship, patch.full.worship), sermon: Object.assign({}, (settings.full || {}).sermon, patch.full.sermon) }));
    saveSettings(); send({ type: "status", status: status() }); return settings;
  });
  function fullNorm(f) {
    f = Object.assign({}, FULL_DEFAULTS, f || {}); const str = (x, n) => String(x == null ? "" : x).slice(0, n);
    for (const k of ["speaker", "scripture", "links", "hashtags", "ccli"]) f[k] = str(f[k], 1000);
    f.when = f.when === "now" ? "now" : "slot"; f.height = Number(f.height) === 720 ? 720 : 1080; f.minSermonMinutes = Math.max(1, Math.min(90, Number(f.minSermonMinutes) || 5)); f.minWorshipMinutes = Math.max(1, Math.min(90, Number(f.minWorshipMinutes) || 2));
    for (const k of ["worship", "sermon"]) { const x = Object.assign({}, FULL_DEFAULTS[k], f[k] || {}); f[k] = { on: !!x.on, auto: !!x.auto, title: str(x.title, 120) || FULL_DEFAULTS[k].title, privacy: ["public", "unlisted", "private"].includes(x.privacy) ? x.privacy : "unlisted", playlist: str(x.playlist, 150), platforms: { youtube: !!(x.platforms || {}).youtube, facebook: !!(x.platforms || {}).facebook } }; }
    return f;
  }
  settings.schedule = SCH.norm(settings.schedule); settings.full = fullNorm(settings.full);
  ipcMain.handle("shorts-settings-reset", () => { settings = JSON.parse(JSON.stringify(SETTINGS)); saveSettings(); return settings; });
  ipcMain.handle("shorts-make", (_e, id) => queue({ mode: "make", id }));
  ipcMain.handle("shorts-cancel", () => { jobs.length = 0; if (running && running.proc) { running.cancelled = true; try { running.proc.kill(); } catch (_) { } } return status(); });
  ipcMain.handle("shorts-list", (_e, id) => { const r = find(id), d = readShorts(r.dir); return { recording: r, data: d, base: r.dir }; });
  ipcMain.handle("shorts-update", (_e, id, shortId, patch) => {
    const r = find(id), d = readShorts(r.dir); if (!d) throw new Error("No shorts for that recording yet.");
    const s = d.shorts.find((x) => x.id === shortId); if (!s) throw new Error("That short isn't in the list any more.");
    patch = patch || {}; let again = false;
    if (typeof patch.title === "string" && patch.title.trim() && patch.title.trim() !== String(s.title || "").trim()) { lesson("title", s, { before: s.title, title: patch.title.trim().slice(0, 100) }); s.edited = true; }
    if (typeof patch.title === "string") s.title = patch.title.slice(0, 100);
    if (typeof patch.description === "string") s.description = patch.description.slice(0, 2000);
    if (Array.isArray(patch.hashtags)) s.hashtags = patch.hashtags.map((h) => "#" + String(h).replace(/^#/, "").replace(/\s+/g, "")).filter((h) => h.length > 1).slice(0, 10);
    if (["new", "approved"].includes(patch.status)) s.status = patch.status;
    if (patch.start != null || patch.end != null) {
      const a = patch.start != null ? Number(patch.start) : s.start, b = patch.end != null ? Number(patch.end) : s.end;
      if (!(b - a >= 3)) throw new Error("A short needs at least 3 seconds.");
      if (b - a > 180) throw new Error("A short can be at most 3 minutes.");
      let all = []; try { all = JSON.parse(fs.readFileSync(path.join(r.dir, "transcript.json"), "utf8")).words || []; } catch (_) { }
      const keep = (s.kind === "worship" ? s.words : all.length ? all : s.words) || [];
      const was = { start: s.start, end: s.end };
      s.start = Math.round(a * 100) / 100; s.end = Math.round(b * 100) / 100; s.words = P.wordsIn(keep, s.start, s.end); again = true;
      if (Math.abs(s.start - was.start) >= 0.2 || Math.abs(s.end - was.end) >= 0.2) { lesson("trim", s, { dStart: Math.round((s.start - was.start) * 10) / 10, dEnd: Math.round((s.end - was.end) * 10) / 10 }); s.edited = true; }
    }
    if (typeof patch.captionsText === "string") {
      const before = (s.words || []).map((w) => w.text), after = patch.captionsText.trim().split(/\s+/).filter(Boolean);
      let changed = Math.abs(before.length - after.length); for (let i = 0; i < Math.min(before.length, after.length); i++) if (before[i] !== after[i]) changed++;
      const letters = after.join("").replace(/[^A-Za-z]/g, ""), upper = letters.length > 8 && letters === letters.toUpperCase() && before.join("") !== before.join("").toUpperCase();
      if (changed) { lesson("captions", s, { changed, upper }); s.edited = true; }
      s.words = C.retext(s.words, patch.captionsText); again = true;
    }
    if (typeof patch.captions === "boolean") { lesson(patch.captions ? "captions-on" : "captions-off", s); s.captions = patch.captions ? undefined : false; again = true; }
    if (patch.status === "approved") lesson("approve", s, { edited: !!s.edited });
    if (patch.status === "approved" && settings.schedule.auto) toQueue({ ref: id + "#" + s.id, recording: id, shortId: s.id, title: s.title });
    if (patch.status === "new" || again) unqueue(id + "#" + s.id);
    if (again) s.status = s.status === "approved" ? "new" : s.status;   // (changed: look at it again)
    writeShorts(r.dir, d);
    if (again) queue({ mode: "render", id, shortId });
    return s;
  });
  ipcMain.handle("shorts-delete", (_e, id, shortId, reason) => {
    const r = find(id), d = readShorts(r.dir); if (!d) return null; const s = d.shorts.find((x) => x.id === shortId); if (!s) return null;
    if (s.status !== "posted") lesson("delete", s, { reason: LEARN.REASONS[reason] ? reason : null });
    for (const f of [s.file, s.thumb, s.srt]) if (f) { try { fs.unlinkSync(path.join(r.dir, f)); } catch (_) { } }
    d.shorts = d.shorts.filter((x) => x.id !== shortId); writeShorts(r.dir, d); return { ok: true };
  });
  ipcMain.handle("shorts-add", (_e, id, at) => queue({ mode: "add", id, at: Number(at) || 0 }));
  ipcMain.handle("shorts-reveal", (_e, id) => { const p = id ? find(id).dir : shortsRoot(); fs.mkdirSync(p, { recursive: true }); shell.openPath(p); return true; });
  ipcMain.handle("shorts-download", async (_e, id, shortId) => {
    const r = find(id), d = readShorts(r.dir), s = d && d.shorts.find((x) => x.id === shortId); if (!s) throw new Error("That short isn't in the list any more.");
    const name = (s.title || "Short").replace(/[\\/:*?"<>|]+/g, "").slice(0, 60).trim() + ".mp4";
    const res = await dialog.showSaveDialog(getWin(), { title: "Save the short", defaultPath: path.join(app.getPath("downloads") || os.homedir(), name), filters: [{ name: "Video", extensions: ["mp4"] }] });
    if (res.canceled || !res.filePath) return { saved: null };
    fs.copyFileSync(path.join(r.dir, s.file), res.filePath); return { saved: res.filePath };
  });
  ipcMain.handle("shorts-pick-file", async (_e, kind) => {
    const pics = ["png", "jpg", "jpeg", "webp"], vids = ["mp4", "mov", "webm"];
    const res = await dialog.showOpenDialog(getWin(), { title: kind === "logo" ? "Pick the church's logo (a PNG with a see-through background looks best)" : "Pick a picture or a short video", properties: ["openFile"], filters: [{ name: kind === "logo" ? "Pictures" : "Pictures and videos", extensions: kind === "logo" ? pics : pics.concat(vids) }] });
    return res.canceled ? null : res.filePaths[0] || null;
  });

  // ---------------------------------------------------------------- posting (the website keeps the connections)
  async function site(acct, method, p, body) {
    if (!acct || !acct.server || !acct.token) throw new Error("Sign in to your Motion Audio account first (Settings → Packages & key → Account).");
    const r = await fetch(acct.server.replace(/\/+$/, "") + "/v1" + p, { method, headers: { "Content-Type": "application/json", Authorization: "Bearer " + acct.token }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "The website answered " + r.status); return j;
  }
  ipcMain.handle("shorts-social", async (_e, acct) => { try { return await site(acct, "GET", "/social/status"); } catch (e) { return { error: e.message }; } });
  ipcMain.handle("shorts-connect", async (_e, platform, acct) => { const j = await site(acct, "POST", "/social/" + platform + "/start", {}); shell.openExternal(j.url); return { opened: true }; });
  ipcMain.handle("shorts-disconnect", async (_e, platform, acct) => site(acct, "POST", "/social/" + platform + "/disconnect", {}));
  ipcMain.handle("shorts-post", async (_e, id, shortId, platform, acct) => {
    const r = find(id), d = readShorts(r.dir), s = d && d.shorts.find((x) => x.id === shortId); if (!s) throw new Error("That short isn't in the list any more.");
    if (acct && acct.token && !(account && account.token)) account = { server: acct.server, token: acct.token };
    const tok = await site(acct, "POST", "/social/" + (platform === "facebook" || platform === "instagram" ? "meta" : platform) + "/token", {});
    const tags = s.hashtags && s.hashtags.length ? s.hashtags : String(settings.hashtags || "").split(/[\s,]+/).filter(Boolean).map((h) => "#" + h.replace(/^#/, ""));
    let res, entry;
    try { res = await POST.post(platform, { token: tok.accessToken, pageId: tok.pageId, igUserId: tok.igUserId, file: path.join(r.dir, s.file), title: s.title, description: SCH.describe(settings.template, { title: s.title, description: s.description, hashtags: tags.join(" "), link: await serviceLink(r, d).catch(() => ""), links: settings.links, church: (svc && svc.churchName && svc.churchName()) || "", date: new Date(r.when).toLocaleDateString() }), hashtags: [], privacy: settings.privacy, direct: settings.tiktokDirect }); entry = { platform, at: Date.now(), ok: true, id: res.id, url: res.url, note: res.note || "", account: tok.account || "" }; }
    catch (e) { entry = { platform, at: Date.now(), ok: false, error: String(e.message || e).slice(0, 300) }; }
    const now = readShorts(r.dir), sh = now.shorts.find((x) => x.id === shortId); sh.posts = (sh.posts || []).concat([entry]); if (entry.ok) sh.status = "posted"; writeShorts(r.dir, now);
    if (entry.ok && !(s.posts || []).some((x) => x.ok)) lesson("post", s, { title: s.title, platform });
    let hist = []; try { hist = JSON.parse(fs.readFileSync(histFile, "utf8")); } catch (_) { }
    hist.unshift(Object.assign({ title: s.title, recording: r.name, file: path.join(r.dir, s.file) }, entry)); try { fs.writeFileSync(histFile, JSON.stringify(hist.slice(0, 500), null, 1)); } catch (_) { }
    if (!entry.ok) throw new Error(entry.error);
    return entry;
  });
  // ---------------------------------------------------------------- the posting queue (10.3; schedule.js)
  // Approved shorts (and approved full videos) wait here for their platform's next posting time. This computer posts
  // them; one that was off at a posting time catches up when it next comes on. The page hands over the church's website
  // sign-in (account) so the queue can ask the website for each platform's token.
  const queueFile = path.join(userData, "shorts-queue.json");
  let Q = []; try { Q = JSON.parse(fs.readFileSync(queueFile, "utf8")).items || []; } catch (_) { }
  let account = null, posting = false;
  const saveQ = () => { try { fs.writeFileSync(queueFile + ".tmp", JSON.stringify({ items: Q.slice(-1000) }, null, 1)); fs.renameSync(queueFile + ".tmp", queueFile); } catch (_) { } send({ type: "queue" }); };
  function toQueue(item, only) { Q = SCH.enqueue(Q, item, settings.schedule, Date.now(), only); if (settings.full.when === "now" && item.full) Q.filter((q) => q.ref === item.ref && q.status === "queued").forEach((q) => SCH.postNow(q, Date.now())); saveQ(); }
  function unqueue(ref) { const before = Q.length; Q = Q.filter((q) => !(q.ref === ref && q.status === "queued")); if (Q.length !== before) saveQ(); }
  const linkCache = {};
  async function serviceLink(r, d) {
    const mode = settings.linkMode;
    if (mode === "none") return "";
    if (mode === "custom") return settings.linkUrl || "";
    if (mode === "sermon") { const p = d && d.full && d.full.sermon && (d.full.sermon.posts || []).find((x) => x.ok && x.platform === "youtube" && x.url); if (p) return p.url; }
    if (linkCache[r.id]) return linkCache[r.id];
    try { const tok = await site(account, "POST", "/social/youtube/token", {}); const l = await POST.liveLink(tok.accessToken, r.when); if (l) return (linkCache[r.id] = l.url); } catch (_) { }
    return settings.linkUrl || "";
  }
  async function postItem(q) {
    const r = list().find((x) => x.id === q.recording), d = r && readShorts(r.dir);
    if (!r || !d) throw new Error("The recording isn't in the recordings folder any more.");
    const item = q.full ? d.full && d.full[q.full] : d.shorts.find((x) => x.id === q.shortId);
    if (!item) throw new Error("It isn't in the list any more.");
    const tok = await site(account, "POST", "/social/" + (q.platform === "facebook" || q.platform === "instagram" ? "meta" : q.platform) + "/token", {});
    const link = await serviceLink(r, d), file = path.join(r.dir, item.file);
    let res;
    if (q.full) {
      const o = settings.full[q.full] || {}, desc = item.description + (link && q.full === "worship" && !item.description.includes(link) ? "\n\nThe whole service: " + link : "");
      res = q.platform === "facebook" ? await POST.facebookVideo({ token: tok.accessToken, pageId: tok.pageId, file, title: item.title, description: desc })
        : await POST.youtubeVideo({ token: tok.accessToken, file, title: item.title, description: desc, privacy: o.privacy, playlist: o.playlist, thumbnail: item.thumb ? path.join(r.dir, item.thumb) : null, hashtags: String(settings.full.hashtags || "").split(/[\s,]+/).filter(Boolean) });
    } else {
      const tags = item.hashtags && item.hashtags.length ? item.hashtags : String(settings.hashtags || "").split(/[\s,]+/).filter(Boolean).map((h) => "#" + h.replace(/^#/, ""));
      const description = SCH.describe(settings.template, { title: item.title, description: item.description, hashtags: tags.join(" "), link, links: settings.links, church: (svc && svc.churchName && svc.churchName()) || "", date: new Date(r.when).toLocaleDateString() });
      res = await POST.post(q.platform, { token: tok.accessToken, pageId: tok.pageId, igUserId: tok.igUserId, file, title: item.title, description, hashtags: [], privacy: settings.privacy, direct: settings.tiktokDirect });
    }
    const entry = { platform: q.platform, at: Date.now(), ok: true, id: res.id, url: res.url, note: res.note || "", account: tok.account || "", queued: q.id };
    const now = readShorts(r.dir), it = q.full ? now.full[q.full] : now.shorts.find((x) => x.id === q.shortId);
    it.posts = (it.posts || []).concat([entry]); it.status = "posted"; writeShorts(r.dir, now);
    if (!q.full && !(item.posts || []).some((x) => x.ok)) lesson("post", item, { title: item.title, platform: q.platform });
    let hist = []; try { hist = JSON.parse(fs.readFileSync(histFile, "utf8")); } catch (_) { }
    hist.unshift(Object.assign({ title: item.title, recording: r.name, file }, entry)); try { fs.writeFileSync(histFile, JSON.stringify(hist.slice(0, 500), null, 1)); } catch (_) { }
    return res;
  }
  async function tick() {
    if (posting || !account || !account.token || !isMain()) return; posting = true;
    try {
      for (const q of SCH.due(Q, settings.schedule, Date.now())) {
        q.status = "posting"; saveQ();
        try { const res = await postItem(q); SCH.posted(q, { id: res.id, url: res.url, note: res.note || "" }, Date.now()); }
        catch (e) { SCH.failed(q, e.message || e, Date.now()); }
        saveQ();
      }
    } finally { posting = false; }
  }
  Q.forEach((q) => { if (q.status === "posting") q.status = "queued"; });   // (cut off by a restart: try it again)
  const ticker = setInterval(() => { tick().catch(() => { }); }, process.env.CU_SHORTS_TICK ? Number(process.env.CU_SHORTS_TICK) : 60e3);
  ipcMain.handle("shorts-account", (_e, acct) => { const had = !!(account && account.token); account = acct && acct.token ? { server: String(acct.server || ""), token: String(acct.token) } : null; if (!had && account) setTimeout(() => tick().catch(() => { }), 3000); return true; });
  ipcMain.handle("shorts-queue", () => { const titles = {}; for (const r of list()) { const d = readShorts(r.dir); if (!d) continue; d.shorts.forEach((s) => { titles[r.id + "#" + s.id] = { title: s.title, thumb: s.thumb ? path.join(r.dir, s.thumb) : null }; }); for (const k of ["worship", "sermon"]) if (d.full && d.full[k]) titles[r.id + "#full-" + k] = { title: d.full[k].title, thumb: d.full[k].thumb ? path.join(r.dir, d.full[k].thumb) : null }; } return { items: Q.slice().sort((a, b) => (a.status === "posted") - (b.status === "posted") || a.dueAt - b.dueAt).map((q) => Object.assign({}, q, titles[q.ref] || {})), schedule: settings.schedule, signedIn: !!(account && account.token) }; });
  ipcMain.handle("shorts-queue-action", async (_e, id, action) => {
    const q = Q.find((x) => x.id === id); if (!q) throw new Error("That post isn't in the queue any more.");
    const now = Date.now();
    if (action === "now") SCH.postNow(q, now); else if (action === "skip") SCH.skip(q); else if (action === "retry") SCH.retry(q, now);
    else if (action === "remove") Q = Q.filter((x) => x.id !== id);
    else if (action === "later") { const at = SCH.nextFree(settings.schedule, q.platform, Q.filter((x) => x.id !== id), Math.max(now, q.dueAt) + 60e3); if (at) Object.assign(q, { dueAt: at, now: false, status: "queued" }); }
    saveQ(); if (action === "now" || action === "retry") setTimeout(() => tick().catch(() => { }), 200);
    return true;
  });
  // the full videos: edit, approve (into the queue), make again
  ipcMain.handle("shorts-full-update", (_e, id, kind, patch) => {
    const r = find(id), d = readShorts(r.dir), it = d && d.full && d.full[kind]; if (!it) throw new Error("That video isn't made yet.");
    patch = patch || {};
    if (typeof patch.title === "string") { it.title = patch.title.slice(0, 100); it.edited = true; }
    if (typeof patch.description === "string") { it.description = patch.description.slice(0, 4900); it.edited = true; }
    if (patch.status === "approved" || patch.status === "new") it.status = patch.status;
    writeShorts(r.dir, d);
    const plats = settings.full[kind].platforms, only = ["youtube", "facebook"].filter((p) => plats[p]);
    if (patch.status === "approved") toQueue({ ref: id + "#full-" + kind, recording: id, full: kind, title: it.title, kinds: only }, only);
    if (patch.status === "new") unqueue(id + "#full-" + kind);
    return it;
  });
  ipcMain.handle("shorts-full-make", (_e, id, only) => queue({ mode: "full", id, only: only || null }));

  // ---------------------------------------------------------------- how the posted shorts did (10.3)
  // For each short posted in the last 45 days, at most every 6 hours: the platform's numbers, kept on the short and taught
  // to the model (views against the church's usual, the share of the short people watched).
  let statsBusy = false;
  async function refreshStats(acct, force) {
    if (statsBusy) return { busy: true }; statsBusy = true;
    const out = { checked: 0, updated: 0, errors: [] };
    try {
      const todo = {};
      for (const r of list()) {
        const d = readShorts(r.dir); if (!d) continue;
        for (const s of d.shorts) for (const p of s.posts || []) {
          if (!p.ok || !p.id || !STATS.READERS[p.platform] || Date.now() - p.at > 45 * 864e5) continue;
          if (!force && p.statsAt && Date.now() - p.statsAt < 6 * 3600e3) continue;
          (todo[p.platform] = todo[p.platform] || []).push({ dir: r.dir, sid: s.id, pid: p.id });
        }
      }
      for (const [platform, items] of Object.entries(todo)) {
        let tok; try { tok = await site(acct, "POST", "/social/" + (platform === "youtube" ? "youtube" : "meta") + "/token", {}); } catch (e) { out.errors.push(platform + ": " + e.message); continue; }
        let got; try { got = await STATS.stats(platform, { token: tok.accessToken, ids: items.map((x) => x.pid), igUserId: tok.igUserId }); } catch (e) { out.errors.push(platform + ": " + (e.status === 403 ? "connect it again to allow reading its numbers (Shorts → Accounts)" : e.message)); continue; }
        out.checked += items.length;
        const byDir = {}; for (const it of items) (byDir[it.dir] = byDir[it.dir] || []).push(it);
        for (const [dir, its] of Object.entries(byDir)) {
          const d = readShorts(dir); if (!d) continue;
          for (const it of its) {
            const s = d.shorts.find((x) => x.id === it.sid), p = s && (s.posts || []).find((x) => x.platform === platform && x.id === it.pid), st = got[it.pid];
            if (!p || !st) continue;
            p.stats = st; p.statsAt = Date.now(); out.updated++;
            const len = (s.seconds || (s.end - s.start)) || 1;
            lesson("stats", s, { platform, views: st.views, retention: st.avgSeconds != null ? Math.max(0, Math.min(1.5, st.avgSeconds / len)) : null, likes: st.likes, shares: st.shares });
          }
          writeShorts(dir, d);
        }
      }
    } finally { statsBusy = false; }
    return out;
  }
  ipcMain.handle("shorts-stats", (_e, acct, force) => refreshStats(acct, !!force));
  ipcMain.handle("shorts-learned", () => Object.assign(L.describe(), { on: settings.learn !== false }));
  ipcMain.handle("shorts-learned-reset", () => { L.reset(); return Object.assign(L.describe(), { on: settings.learn !== false }); });
  ipcMain.handle("shorts-history", () => { try { return JSON.parse(fs.readFileSync(histFile, "utf8")); } catch (_) { return []; } });
  ipcMain.handle("shorts-open-url", (_e, url) => { if (/^https:\/\//.test(String(url))) shell.openExternal(url); return true; });

  return { status, list, queue, learning: L, refreshStats, tick, queueItems: () => Q, stop: () => { clearInterval(ticker); jobs.length = 0; if (running && running.proc) { try { running.proc.kill(); } catch (_) { } } } };
}

module.exports = { setup, SETTINGS };
