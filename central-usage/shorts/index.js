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

const SETTINGS = Object.assign({ auto: true, useAI: true, minRecording: 10, privacy: "public", hashtags: "", tiktokDirect: false }, P.DEFAULTS, R.DEFAULTS, { captions: Object.assign({}, C.STYLE) });
const MODELS = { accurate: "onnx-community/whisper-small_timestamped", fast: "onnx-community/whisper-base_timestamped" };

function setup({ ipcMain, app, getWin, svc, videoDir, ffmpeg, shell, dialog }) {
  const userData = app.getPath("userData");
  const cfgFile = path.join(userData, "shorts.json"), histFile = path.join(userData, "shorts-posted.json");
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
      fs.writeFileSync(jobFile, JSON.stringify({ mode: j.mode, id: j.shortId, at: j.at, out: r.dir, audio: r.audio, video: r.video, markers, settings, ffmpeg: bin, fonts, asr: asrInfo(), aiPort, church, recordingName: r.name }));
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
    for (const k of ["auto", "useAI", "tiktokDirect"]) if (typeof patch[k] === "boolean") settings[k] = patch[k];
    for (const k of ["framing", "background", "accent", "logo", "logoCorner", "intro", "outro", "privacy", "hashtags"]) if (typeof patch[k] === "string") settings[k] = patch[k].slice(0, 500);
    if (patch.captions && typeof patch.captions === "object") { const c = patch.captions; settings.captions = Object.assign({}, settings.captions, { on: c.on != null ? !!c.on : settings.captions.on, font: c.font ? String(c.font).slice(0, 60) : settings.captions.font, size: c.size != null ? Math.max(2, Math.min(9, Number(c.size) || 4.6)) : settings.captions.size, color: /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : settings.captions.color, highlight: /^#[0-9a-f]{6}$/i.test(c.highlight) ? c.highlight : settings.captions.highlight, outline: /^#[0-9a-f]{6}$/i.test(c.outline) ? c.outline : settings.captions.outline, position: ["top", "middle", "bottom"].includes(c.position) ? c.position : settings.captions.position, upper: c.upper != null ? !!c.upper : settings.captions.upper, box: c.box != null ? !!c.box : settings.captions.box, words: c.words != null ? Math.max(1, Math.min(8, Math.round(c.words))) : settings.captions.words }); }
    saveSettings(); send({ type: "status", status: status() }); return settings;
  });
  ipcMain.handle("shorts-settings-reset", () => { settings = JSON.parse(JSON.stringify(SETTINGS)); saveSettings(); return settings; });
  ipcMain.handle("shorts-make", (_e, id) => queue({ mode: "make", id }));
  ipcMain.handle("shorts-cancel", () => { jobs.length = 0; if (running && running.proc) { running.cancelled = true; try { running.proc.kill(); } catch (_) { } } return status(); });
  ipcMain.handle("shorts-list", (_e, id) => { const r = find(id), d = readShorts(r.dir); return { recording: r, data: d, base: r.dir }; });
  ipcMain.handle("shorts-update", (_e, id, shortId, patch) => {
    const r = find(id), d = readShorts(r.dir); if (!d) throw new Error("No shorts for that recording yet.");
    const s = d.shorts.find((x) => x.id === shortId); if (!s) throw new Error("That short isn't in the list any more.");
    patch = patch || {}; let again = false;
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
      s.start = Math.round(a * 100) / 100; s.end = Math.round(b * 100) / 100; s.words = P.wordsIn(keep, s.start, s.end); again = true;
    }
    if (typeof patch.captionsText === "string") { s.words = C.retext(s.words, patch.captionsText); again = true; }
    if (typeof patch.captions === "boolean") { s.captions = patch.captions ? undefined : false; again = true; }
    if (again) s.status = s.status === "approved" ? "new" : s.status;   // (changed: look at it again)
    writeShorts(r.dir, d);
    if (again) queue({ mode: "render", id, shortId });
    return s;
  });
  ipcMain.handle("shorts-delete", (_e, id, shortId) => {
    const r = find(id), d = readShorts(r.dir); if (!d) return null; const s = d.shorts.find((x) => x.id === shortId); if (!s) return null;
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
    const tok = await site(acct, "POST", "/social/" + (platform === "facebook" || platform === "instagram" ? "meta" : platform) + "/token", {});
    const tags = s.hashtags && s.hashtags.length ? s.hashtags : String(settings.hashtags || "").split(/[\s,]+/).filter(Boolean).map((h) => "#" + h.replace(/^#/, ""));
    let res, entry;
    try { res = await POST.post(platform, { token: tok.accessToken, pageId: tok.pageId, igUserId: tok.igUserId, file: path.join(r.dir, s.file), title: s.title, description: s.description, hashtags: tags, privacy: settings.privacy, direct: settings.tiktokDirect }); entry = { platform, at: Date.now(), ok: true, id: res.id, url: res.url, note: res.note || "", account: tok.account || "" }; }
    catch (e) { entry = { platform, at: Date.now(), ok: false, error: String(e.message || e).slice(0, 300) }; }
    const now = readShorts(r.dir), sh = now.shorts.find((x) => x.id === shortId); sh.posts = (sh.posts || []).concat([entry]); if (entry.ok) sh.status = "posted"; writeShorts(r.dir, now);
    let hist = []; try { hist = JSON.parse(fs.readFileSync(histFile, "utf8")); } catch (_) { }
    hist.unshift(Object.assign({ title: s.title, recording: r.name, file: path.join(r.dir, s.file) }, entry)); try { fs.writeFileSync(histFile, JSON.stringify(hist.slice(0, 500), null, 1)); } catch (_) { }
    if (!entry.ok) throw new Error(entry.error);
    return entry;
  });
  ipcMain.handle("shorts-history", () => { try { return JSON.parse(fs.readFileSync(histFile, "utf8")); } catch (_) { return []; } });
  ipcMain.handle("shorts-open-url", (_e, url) => { if (/^https:\/\//.test(String(url))) shell.openExternal(url); return true; });

  return { status, list, queue, stop: () => { jobs.length = 0; if (running && running.proc) { try { running.proc.kill(); } catch (_) { } } } };
}

module.exports = { setup, SETTINGS };
