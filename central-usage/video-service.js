/* Central Usage - the Video tab's main-process side.
 *
 *   sources     IP / SRT / RTMP / RTSP cameras and media files: one ffmpeg each, decoding to small frames for the
 *               multiview ("lo") or full frames when on air or in preview ("hi"); NDI cameras: cu-video ndi-recv;
 *               phones: an HTTPS page here sends the phone's camera (H.264 via WebCodecs, or JPEG);
 *               slides: the Slides tab's output page rendered off screen.   USB / HDMI capture devices are opened by
 *               the page itself (getUserMedia).
 *   the page    composites everything on the GPU (WebGL) and draws the Main output into a full-screen window on the
 *               chosen display; it sends the Stream output back here as I420 frames.
 *   stream      one encoder (ffmpeg; NVENC / QSV / VideoToolbox / AMF / VAAPI when there, x264 otherwise) makes an
 *               MPEG-TS stream; each destination (YouTube, Facebook, any RTMP(S) / SRT) and the recording is a light
 *               copy of it, so one can fail, stop or reconnect without touching the others.
 *   audio       the stream's sound: cu-video audio (two device + channel-pair sources, one chosen, gain, delay).
 *   NDI out     "Central Usage Stream" / "Central Usage Main" for OBS / vMix / Streamlabs on this computer.
 *
 * Media between here and the page: a WebSocket on 127.0.0.1 (random port + token). Control: ipcMain "video-*". */
"use strict";
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const https = require("node:https");
const crypto = require("node:crypto");
const { WebSocketServer } = require("ws");
const cert = require("./video-cert");

const SLIDES_ID = 0xfffe;
const PRESETS = { "720p30": [1280, 720, 30, 4500], "1080p30": [1920, 1080, 30, 6000], "1080p60": [1920, 1080, 60, 9000], "720p60": [1280, 720, 60, 6000] };
const DEST_KINDS = {
  youtube: { label: "YouTube", url: "rtmp://a.rtmp.youtube.com/live2" },
  facebook: { label: "Facebook", url: "rtmps://live-api-s.facebook.com:443/rtmp" },
  rtmp: { label: "RTMP / RTMPS", url: "" },
  srt: { label: "SRT", url: "" }
};

function which(cmd) {
  try {
    const r = process.platform === "win32" ? spawnSync("where", [cmd], { encoding: "utf8" }) : spawnSync("sh", ["-c", "command -v " + cmd], { encoding: "utf8" });
    return (r.stdout || "").split(/\r?\n/)[0].trim() || null;
  } catch (_) { return null; }
}
const exe = (n) => n + (process.platform === "win32" ? ".exe" : "");
// where ffmpeg is: CU_FFMPEG, the one bundled next to the native helpers, or the system's (the recorder's MP3 uses it too)
function findFfmpeg(binDir) { return [process.env.CU_FFMPEG, path.join(binDir, exe("ffmpeg")), path.join(binDir, "video", exe("ffmpeg"))].find((p) => p && fs.existsSync(p)) || which("ffmpeg"); }
module.exports.findFfmpeg = findFfmpeg;
function lines(stream, fn) { let buf = ""; stream.on("data", (b) => { buf += b; let i; while ((i = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, i).replace(/\r$/, ""); buf = buf.slice(i + 1); fn(l); } if (buf.length > 65536) buf = ""; }); }
// framed reader: u8 type, u32 length, payload
function frames(stream, fn) {
  let chunks = [], have = 0;
  stream.on("data", (b) => {
    chunks.push(b); have += b.length;
    if (have < 5) return;
    let buf = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, have), i = 0;
    while (have - i >= 5) { const n = buf.readUInt32LE(i + 1); if (have - i < 5 + n) break; fn(String.fromCharCode(buf[i]), buf.subarray(i + 5, i + 5 + n)); i += 5 + n; }
    buf = buf.subarray(i); chunks = buf.length ? [buf] : []; have = buf.length;
  });
}

module.exports.setup = function setup({ ipcMain, getWin, userData, binDir, app, screen, BrowserWindow }) {
  // the outputs are drawn by the page: keep it running at full speed when the window is minimised or covered
  // (setup() runs before the app is ready, when these switches still apply)
  if (app && app.commandLine && !app.isReady()) { app.commandLine.appendSwitch("disable-renderer-backgrounding"); app.commandLine.appendSwitch("disable-backgrounding-occluded-windows"); app.commandLine.appendSwitch("disable-background-timer-throttling"); }
  const send = (ev) => { const w = getWin(); if (w && !w.isDestroyed()) w.webContents.send("video-event", ev); };
  const appDir = path.join(__dirname, "app");
  const cfgFile = path.join(userData, "video.json");
  const defaults = {
    sources: [], multiview: { grid: "auto", page: 0, loSize: [384, 216], loFps: 10 },
    main: { displayId: null, ndi: false },
    stream: { preset: "1080p30", bitrate: 6000, encoder: "auto", audioBitrate: 160, ndi: false },
    destinations: [], record: { dir: path.join((app && app.getPath ? app.getPath("videos") : null) || os.homedir(), "Central Usage") },
    audio: { sources: [{ device: "", l: 0, r: 1, gain: 0, on: true }, { device: "", l: 0, r: 1, gain: 0, on: true }], use: 0, delay: 0 },
    lyrics: { font: "Inter", size: 5.5, color: "#ffffff", box: "bar", boxColor: "#000000", boxOpacity: 0.55, shadow: true, position: "bottom", lines: 2, upper: false, fade: 0.4 },
    transition: { type: "fade", ms: 600 },
    phones: { port: 8443, httpPort: 8442, code: String(1000 + Math.floor(Math.random() * 9000)) }
  };
  let cfg = JSON.parse(JSON.stringify(defaults));
  try { const saved = JSON.parse(fs.readFileSync(cfgFile, "utf8")); for (const k of Object.keys(saved)) cfg[k] = (defaults[k] && typeof defaults[k] === "object" && !Array.isArray(defaults[k])) ? Object.assign({}, defaults[k], saved[k]) : saved[k]; } catch (_) { }
  if (process.env.CU_VIDEO_PHONE_PORT) { cfg.phones.port = Number(process.env.CU_VIDEO_PHONE_PORT); cfg.phones.httpPort = cfg.phones.port - 1; }
  const save = () => { try { fs.mkdirSync(userData, { recursive: true }); fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 1)); } catch (_) { } };

  // ------------------------------------------------------------------ the programs
  const ffmpeg = () => findFfmpeg(binDir);
  const cuVideo = () => [process.env.CU_VIDEO_BIN, path.join(binDir, exe("cu-video"))].find((p) => p && fs.existsSync(p)) || null;
  for (const f of [path.join(binDir, "cu-video")]) { try { fs.accessSync(f, fs.constants.X_OK); } catch (_) { try { fs.chmodSync(f, 0o755); } catch (__) { } } }

  // ------------------------------------------------------------------ the media socket to the page
  const token = crypto.randomBytes(16).toString("hex");
  let page = null, port = 0;
  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0, maxPayload: 64 << 20, perMessageDeflate: false });
  wss.on("listening", () => { port = wss.address().port; });
  wss.on("connection", (ws, req) => {
    if (!String(req.url || "").includes("t=" + token)) return ws.close();
    if (page) { try { page.close(); } catch (_) { } }
    page = ws; ws.binaryType = "nodebuffer";
    ws.on("message", (data, isBinary) => { if (isBinary) fromPage(data); });
    ws.on("close", () => { if (page === ws) page = null; });
  });
  // a frame for the page: dropped when the page is behind (the multiview shows the newest, never a queue)
  // frames for the page: only the newest of each source waits (an older one is replaced and moves to the back of the
  // line), and they go out in turn as the socket drains - a slow page drops frames evenly, and a still picture (a
  // slide) is never stuck behind a busy camera. Phone chunks (a video stream that must not have holes) go straight out.
  const pending = new Map();
  const LOW = 6 << 20;
  function flush() {
    if (!page || page.readyState !== 1) { pending.clear(); return; }
    for (const [id, msg] of pending) { if (page.bufferedAmount > LOW) break; pending.delete(id); page.send(msg, { binary: true }); }
  }
  function toPage(kind, header, body, important) {
    if (!page || page.readyState !== 1) return false;
    const msg = Buffer.concat([Buffer.from([kind]), header, body || Buffer.alloc(0)]);
    if (kind !== 1 || important) { page.send(msg, { binary: true }); return true; }
    const id = header.readUInt16LE(0); pending.delete(id); pending.set(id, msg); flush();
    return true;
  }
  setInterval(flush, 8).unref();
  const frameHeader = (id, w, h, fmt) => { const b = Buffer.alloc(8); b.writeUInt16LE(id, 0); b.writeUInt16LE(w, 2); b.writeUInt16LE(h, 4); b[6] = fmt; return b; };

  // ------------------------------------------------------------------ IP cameras, media files, test pattern (ffmpeg)
  const procs = new Map();   // source id -> { proc, level, w, h, status, retry }
  const status = new Map();  // source id -> { state, error, width, height, level }
  function setStatus(id, st) { const old = status.get(id) || {}; const n = Object.assign({}, old, st); status.set(id, n); send({ type: "source", id, status: n }); }
  function srcById(id) { return cfg.sources.find((s) => s.id === id); }
  function hiSize() { const p = PRESETS[cfg.stream.preset] || PRESETS["1080p30"]; return [p[0], p[1], p[2]]; }
  function ffInputArgs(s, level) {
    const u = String((level === "lo" && s.loUrl) || s.url || "").trim();
    if (s.kind === "test" || /^test:/i.test(u)) return ["-re", "-f", "lavfi", "-i", (u.replace(/^test:/i, "") || "testsrc2") + "=size=1280x720:rate=30"];
    if (s.kind === "file") return ["-re", "-stream_loop", "-1", "-i", u];
    const a = ["-fflags", "nobuffer", "-flags", "low_delay", "-probesize", "2000000", "-analyzeduration", "1500000"];
    if (/^rtsps?:/i.test(u)) a.push("-rtsp_transport", s.rtspUdp ? "udp" : "tcp", "-timeout", "5000000");
    else if (/^(rtmps?|srt|https?):/i.test(u)) a.push("-rw_timeout", "6000000");
    return a.concat(["-i", u]);
  }
  function startFf(s, level) {
    const bin = ffmpeg(); if (!bin) { setStatus(s.id, { state: "error", error: "ffmpeg is missing from this installation." }); return; }
    const [lw, lh] = cfg.multiview.loSize || [384, 216], [hw, hh, hfps] = hiSize();
    const w = level === "hi" ? hw : lw, h = level === "hi" ? hh : lh, fps = level === "hi" ? hfps : (cfg.multiview.loFps || 10);
    const vf = "fps=" + fps + ",scale=" + w + ":" + h + ":force_original_aspect_ratio=decrease:flags=" + (level === "hi" ? "bicubic" : "fast_bilinear") + ",pad=" + w + ":" + h + ":(ow-iw)/2:(oh-ih)/2,format=yuv420p";
    const args = ["-hide_banner", "-loglevel", "error", "-nostdin"].concat(ffInputArgs(s, level), ["-an", "-sn", "-dn", "-vf", vf, "-f", "rawvideo", "pipe:1"]);
    const proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const rec = { proc, level, w, h, err: "", got: 0 }; procs.set(s.id, rec);
    setStatus(s.id, { state: "connecting", level, error: null });
    const size = w * h * 3 / 2; let acc = [], have = 0;
    proc.stdout.on("data", (b) => {
      acc.push(b); have += b.length;
      if (have < size) return;
      let buf = Buffer.concat(acc, have), i = 0;
      while (have - i >= size) {
        const fr = buf.subarray(i, i + size); i += size;
        if (have - i < size) {   // only the newest frame of a burst goes to the page
          if (!rec.got++) setStatus(s.id, { state: "live", width: w, height: h, level });
          toPage(1, frameHeader(s.id, w, h, 0), fr);
        }
      }
      const rest = buf.subarray(i); acc = rest.length ? [Buffer.from(rest)] : []; have = rest.length;
    });
    proc.stderr.on("data", (b) => { rec.err = (rec.err + b).slice(-600); });
    proc.on("exit", (code) => {
      if (procs.get(s.id) !== rec) return;
      procs.delete(s.id);
      const msg = (rec.err.trim().split("\n").pop() || "stopped (" + code + ")").slice(0, 200);
      setStatus(s.id, { state: "offline", error: msg });
      const still = srcById(s.id), want = wants.get(s.id);
      if (still && want && want !== "off") rec.retry = setTimeout(() => { if (!procs.has(s.id) && wants.get(s.id) && wants.get(s.id) !== "off") startFf(still, wants.get(s.id)); }, 3000);
    });
  }
  function stopFf(id) { const r = procs.get(id); if (!r) return; procs.delete(id); clearTimeout(r.retry); try { r.proc.kill(); } catch (_) { } }

  // ------------------------------------------------------------------ NDI in
  let ndi = null, ndiSources = [], ndiError = null;
  const ndiOpen = new Map();   // source id -> level
  function ndiStart() {
    if (ndi) return ndi;
    const bin = cuVideo(); if (!bin) { ndiError = "cu-video is missing from this installation."; send({ type: "ndi", error: ndiError, sources: [] }); return null; }
    const proc = spawn(bin, ["ndi-recv"], { stdio: ["pipe", "pipe", "ignore"], windowsHide: true }); ndi = proc; proc.stdin.on("error", () => { });
    frames(proc.stdout, (t, p) => {
      if (t === "F") { const id = p.readUInt16LE(0); const st = status.get(id); if (!st || st.state !== "live") setStatus(id, { state: "live", width: p.readUInt16LE(2), height: p.readUInt16LE(4), level: ndiOpen.get(id) }); toPage(1, p.subarray(0, 8), p.subarray(8)); return; }
      if (t !== "J") return;
      let m; try { m = JSON.parse(p.toString("utf8")); } catch (_) { return; }
      if (m.ev === "ready") { ndiError = m.ok ? null : m.error; send({ type: "ndi", error: ndiError, sources: ndiSources }); }
      else if (m.ev === "sources") { ndiSources = m.list || []; send({ type: "ndi", error: null, sources: ndiSources }); }
      else if (m.ev === "rx") { if (m.ok === false) setStatus(m.id, { state: "offline", error: m.error }); else if (m.ok) setStatus(m.id, { state: "connecting", level: m.hi ? "hi" : "lo" }); }
    });
    proc.on("exit", () => { if (ndi === proc) { ndi = null; ndiOpen.clear(); } });
    return proc;
  }
  const ndiCmd = (o) => { const p = ndiStart(); if (p && p.stdin.writable) p.stdin.write(JSON.stringify(o) + "\n"); };

  // ------------------------------------------------------------------ what the page needs: source id -> off / lo / hi
  const wants = new Map();
  function want(map) {
    for (const s of cfg.sources) {
      const lv = map[s.id] || "off"; wants.set(s.id, lv);
      if (s.kind === "ip" || s.kind === "file" || s.kind === "test") {
        const r = procs.get(s.id);
        if (lv === "off") { if (r) { stopFf(s.id); setStatus(s.id, { state: "idle" }); } }
        else if (!r || r.level !== lv) { if (r) stopFf(s.id); startFf(s, lv); }
      } else if (s.kind === "ndi") {
        const cur = ndiOpen.get(s.id);
        if (lv === "off") { if (cur) { ndiCmd({ cmd: "close", id: s.id }); ndiOpen.delete(s.id); setStatus(s.id, { state: "idle" }); } }
        else if (cur !== lv) { ndiOpen.set(s.id, lv); ndiCmd({ cmd: "open", id: s.id, name: s.ndiName || s.name, bw: lv, fps: lv === "lo" ? (cfg.multiview.loFps || 10) : 0 }); }
      }
    }
    for (const id of [...procs.keys()]) if (!srcById(id)) stopFf(id);
    for (const id of [...ndiOpen.keys()]) if (!srcById(id)) { ndiCmd({ cmd: "close", id }); ndiOpen.delete(id); }
  }

  // ------------------------------------------------------------------ slides (the Slides tab's output, off screen)
  const slides = { win: null, last: null, size: [1920, 1080], fps: 30 };
  ipcMain.on("slide", (_e, s) => { slides.last = s; if (slides.win && !slides.win.isDestroyed()) slides.win.webContents.send("slide", s); });
  function slidesOn(on) {
    if (!on) { if (slides.win && !slides.win.isDestroyed()) slides.win.close(); slides.win = null; return; }
    if (slides.win && !slides.win.isDestroyed()) return;
    const [w, h] = hiSize();
    const win = slides.win = new BrowserWindow({ width: w, height: h, show: false, frame: false, backgroundColor: "#000000", webPreferences: { offscreen: true, backgroundThrottling: false, preload: path.join(__dirname, "preload-output.js"), contextIsolation: true, sandbox: false } });
    win.webContents.setFrameRate(30);
    const keep = setInterval(() => { if (win.isDestroyed()) return clearInterval(keep); win.webContents.invalidate(); }, 1000);   // a still slide is sent again now and then
    win.loadFile(path.join(appDir, "output.html"));
    win.webContents.on("did-finish-load", () => { if (slides.last) win.webContents.send("slide", slides.last); });
    win.webContents.on("paint", (_ev, _dirty, image) => {
      const sz = image.getSize(), bmp = image.toBitmap();   // BGRA
      slides.paints = (slides.paints || 0) + 1;
      if (toPage(1, frameHeader(SLIDES_ID, sz.width, sz.height, 1), bmp)) slides.sent = (slides.sent || 0) + 1;
    });
    win.on("closed", () => { if (slides.win === win) slides.win = null; });
  }

  // ------------------------------------------------------------------ phones as cameras (HTTPS + WSS)
  const phones = new Map();   // ws -> { id, name, sourceId }
  let phoneSrv = null, phoneHttp = null, tls = null, phoneErr = null;
  function phoneSourceFor(name) {
    let s = cfg.sources.find((x) => x.kind === "phone" && x.name.toLowerCase() === ("phone: " + name).toLowerCase());
    if (!s) { s = { id: nextId(), kind: "phone", name: "Phone: " + name, mv: true }; cfg.sources.push(s); save(); send({ type: "config", cfg: pub() }); }
    return s;
  }
  function phonePages(req, res) {
    const u = new URL(req.url, "https://x");
    if (u.pathname === "/ca.crt") { res.writeHead(200, { "Content-Type": "application/x-x509-ca-cert", "Content-Disposition": "attachment; filename=CentralUsage-CA.crt" }); return res.end(tls.ca); }
    if (u.pathname === "/" || u.pathname === "/camera") { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }); return res.end(fs.readFileSync(path.join(appDir, "camera.html"))); }
    res.writeHead(404); res.end("not found");
  }
  function phonesStart() {
    if (phoneSrv) return;
    try { tls = cert.ensure(path.join(userData, "video-tls")); } catch (e) { phoneErr = "certificate: " + e.message; return; }
    phoneSrv = https.createServer({ key: tls.key, cert: tls.cert }, phonePages);
    const pw = new WebSocketServer({ server: phoneSrv, path: "/cam", maxPayload: 8 << 20, perMessageDeflate: false });
    pw.on("connection", (ws) => {
      const info = { id: null, name: "", sourceId: null, frames: 0 }; phones.set(ws, info);
      ws.on("message", (data, isBinary) => {
        if (!isBinary) {
          let m; try { m = JSON.parse(String(data)); } catch (_) { return; }
          if (m.type === "hello") {
            if (String(m.code || "") !== String(cfg.phones.code)) { ws.send(JSON.stringify({ type: "refused", error: "Wrong camera code - it is on the Video tab (Phones)." })); return ws.close(); }
            info.name = String(m.name || "Phone").slice(0, 30).trim() || "Phone"; const s = phoneSourceFor(info.name); info.sourceId = s.id;
            for (const [other, oi] of phones) if (other !== ws && oi.sourceId === s.id) { try { other.close(); } catch (_) { } }
            ws.send(JSON.stringify({ type: "welcome", source: s.name }));
            setStatus(s.id, { state: "connecting", codec: m.codec, width: m.width, height: m.height });
            toPage(2, Buffer.from(JSON.stringify({ id: s.id, codec: m.codec, width: m.width, height: m.height })), null, true);
            sendPhones();
          }
          return;
        }
        if (info.sourceId == null) return;
        // [u8 type 0 key / 1 delta / 2 jpeg][f64 timestamp us][data]
        const hd = Buffer.alloc(2); hd.writeUInt16LE(info.sourceId, 0);
        if (!info.frames++) setStatus(info.sourceId, { state: "live" });
        toPage(3, hd, data, data[0] === 0);
      });
      ws.on("close", () => { phones.delete(ws); if (info.sourceId != null) setStatus(info.sourceId, { state: "offline", error: "the phone left" }); sendPhones(); });
    });
    phoneSrv.on("error", (e) => { phoneErr = e.code === "EADDRINUSE" ? "port " + cfg.phones.port + " is in use" : e.message; send({ type: "phones", info: phoneInfo() }); });
    phoneSrv.listen(cfg.phones.port, "0.0.0.0");
    // plain HTTP: the first page a phone opens - install the certificate, then go to the camera page
    phoneHttp = http.createServer((req, res) => {
      const u = new URL(req.url, "http://x");
      if (u.pathname === "/ca.crt") { res.writeHead(200, { "Content-Type": "application/x-x509-ca-cert", "Content-Disposition": "attachment; filename=CentralUsage-CA.crt" }); return res.end(tls.ca); }
      const host = (req.headers.host || "").split(":")[0];
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Central Usage camera</title><body style="font:17px/1.5 system-ui;background:#08111d;color:#ecf7ff;padding:20px;max-width:560px;margin:auto">' +
        "<h2>Use this phone as a camera</h2><p>Phones only share the camera with a secure page. Once per phone:</p><ol>" +
        '<li><a style="color:#5de6b0" href="/ca.crt">Download the certificate</a>.<br><small>iPhone / iPad: Settings → <b>Profile Downloaded</b> → Install. Then Settings → General → About → <b>Certificate Trust Settings</b> → turn on "Central Usage local CA". Android: open the file, or Settings → Security → Install a certificate → CA certificate.</small></li>' +
        '<li><a style="color:#5de6b0" href="https://' + host + ":" + cfg.phones.port + '/">Open the camera page</a></li></ol>' +
        '<p style="color:#9bb2c9;font-size:14px">Skipping step 1 also works on most phones: on the warning page choose "Show details → visit this website" (Safari) or "Advanced → Proceed" (Chrome).</p></body>');
    });
    phoneHttp.on("error", () => { });
    phoneHttp.listen(cfg.phones.httpPort, "0.0.0.0");
  }
  function phonesStop() { for (const ws of phones.keys()) { try { ws.close(); } catch (_) { } } if (phoneSrv) { phoneSrv.close(); phoneSrv = null; } if (phoneHttp) { phoneHttp.close(); phoneHttp = null; } }
  function phoneInfo() {
    const addrs = cert.addresses().filter((a) => a !== "127.0.0.1");
    return { on: !!phoneSrv, error: phoneErr, code: cfg.phones.code, port: cfg.phones.port, httpPort: cfg.phones.httpPort,
      start: addrs.map((a) => "http://" + a + ":" + cfg.phones.httpPort + "/"), camera: addrs.map((a) => "https://" + a + ":" + cfg.phones.port + "/"),
      connected: [...phones.values()].filter((p) => p.sourceId != null).map((p) => ({ name: p.name, sourceId: p.sourceId })) };
  }
  function sendPhones() { send({ type: "phones", info: phoneInfo() }); }

  // ------------------------------------------------------------------ the stream's audio
  let audio = null, audioStatus = null, audioDevices = [], audioBackend = "";
  let audioSink = null;   // the encoder's audio pipe
  function audioStart() {
    if (audio) return audio;
    const bin = cuVideo(); if (!bin) return null;
    const proc = spawn(bin, ["audio"], { stdio: ["pipe", "pipe", "ignore"], windowsHide: true }); audio = proc; proc.stdin.on("error", () => { });
    frames(proc.stdout, (t, p) => {
      if (t === "A") { if (audioSink && audioSink.writable && audioSink.writableLength < 1 << 20) audioSink.write(p); return; }
      if (t !== "J") return;
      let m; try { m = JSON.parse(p.toString("utf8")); } catch (_) { return; }
      if (m.ev === "meters") send({ type: "audioMeters", peak: m.peak, live: m.live });
      else if (m.ev === "devices") { audioDevices = m.devices || []; audioBackend = m.backend; send({ type: "audioDevices", devices: audioDevices, backend: audioBackend }); }
      else if (m.ev === "status") { audioStatus = m; send({ type: "audioStatus", status: m }); }
      else if (m.ev === "ready") { audioBackend = m.backend; audioCmd({ cmd: "list" }); audioApply(); }
    });
    proc.on("exit", () => { if (audio === proc) audio = null; });
    return proc;
  }
  const audioCmd = (o) => { const p = audioStart(); if (p && p.stdin.writable) p.stdin.write(JSON.stringify(o) + "\n"); };
  function audioApply() {
    const a = cfg.audio;
    a.sources.forEach((s, i) => audioCmd({ cmd: "source", slot: i, device: s.device || "", l: s.l | 0, r: s.r | 0, gain: Number(s.gain) || 0, on: s.on === false ? 0 : 1 }));
    audioCmd({ cmd: "use", slot: a.use === 1 ? 1 : 0 }); audioCmd({ cmd: "delay", ms: a.delay | 0 });
  }

  // ------------------------------------------------------------------ hardware encoders
  let encoders = null;
  function probeEncoders() {
    if (encoders) return encoders;
    const bin = ffmpeg(); if (!bin) return (encoders = { list: [], best: null });
    const cands = process.platform === "darwin" ? ["h264_videotoolbox"] : process.platform === "win32" ? ["h264_nvenc", "h264_qsv", "h264_amf"] : ["h264_nvenc", "h264_vaapi", "h264_qsv"];
    const list = [];
    for (const c of cands.concat(["libx264", "libopenh264"])) {
      const pre = c === "h264_vaapi" ? ["-vaapi_device", "/dev/dri/renderD128"] : [];
      const vf = c === "h264_vaapi" ? ["-vf", "format=nv12,hwupload"] : [];
      const r = spawnSync(bin, ["-hide_banner", "-loglevel", "error"].concat(pre, ["-f", "lavfi", "-i", "color=black:s=320x180:r=30", "-frames:v", "3"], vf, ["-c:v", c, "-f", "null", "-"]), { timeout: 8000, windowsHide: true });
      if (r.status === 0) list.push(c);
    }
    return (encoders = { list, best: list[0] || null });
  }
  function encoderArgs(enc, br, fps) {
    const g = String(fps * 2), b = br + "k", common = ["-b:v", b, "-maxrate", b, "-bufsize", (br * 2) + "k", "-g", g];
    switch (enc) {
      case "h264_nvenc": return ["-c:v", enc, "-preset", "p4", "-tune", "ll", "-rc", "cbr", "-forced-idr", "1"].concat(common);
      case "h264_qsv": return ["-c:v", enc, "-preset", "veryfast", "-look_ahead", "0"].concat(common);
      case "h264_amf": return ["-c:v", enc, "-usage", "lowlatency", "-rc", "cbr"].concat(common);
      case "h264_videotoolbox": return ["-c:v", enc, "-realtime", "1", "-allow_sw", "1", "-profile:v", "high"].concat(common);
      case "h264_vaapi": return ["-c:v", enc, "-rc_mode", "CBR"].concat(common);
      case "libopenh264": return ["-c:v", enc, "-allow_skip_frames", "1"].concat(common);
      default: return ["-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency", "-profile:v", "high", "-x264-params", "repeat-headers=1:scenecut=0", "-keyint_min", g].concat(common);
    }
  }

  // ------------------------------------------------------------------ the encoder and its copies (destinations, recording)
  const enc = { proc: null, w: 0, h: 0, fps: 30, encoder: null, stats: {}, started: 0, error: null };
  const relays = new Map();   // destination id or "record" -> { proc, bytes, status, error, retry, file }
  function encoderNeeded() { return cfg.destinations.some((d) => d.on) || relays.has("record"); }
  function encStart() {
    if (enc.proc) return true;
    const bin = ffmpeg(); if (!bin) { enc.error = "ffmpeg is missing from this installation."; sendStream(); return false; }
    const [w, h, fps] = hiSize(), br = Number(cfg.stream.bitrate) || PRESETS[cfg.stream.preset][3];
    const want = cfg.stream.encoder && cfg.stream.encoder !== "auto" ? cfg.stream.encoder : null, e = probeEncoders();
    const encoder = want && e.list.includes(want) ? want : e.best;
    if (!encoder) { enc.error = "No H.264 encoder in this ffmpeg."; sendStream(); return false; }
    const useAudio = !!cuVideo();
    const args = ["-hide_banner", "-loglevel", "error", "-nostats", "-progress", "pipe:2", "-stats_period", "1",
      "-thread_queue_size", "64", "-f", "rawvideo", "-pix_fmt", "yuv420p", "-s", w + "x" + h, "-framerate", String(fps), "-use_wallclock_as_timestamps", "1", "-i", "pipe:0"];
    if (useAudio) args.push("-thread_queue_size", "256", "-f", "s16le", "-ar", "48000", "-ac", "2", "-use_wallclock_as_timestamps", "1", "-i", "pipe:3");
    else args.push("-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo");
    if (encoder === "h264_vaapi") args.unshift("-vaapi_device", "/dev/dri/renderD128");
    args.push("-map", "0:v", "-map", "1:a", "-fps_mode", "cfr", "-r", String(fps));
    if (encoder === "h264_vaapi") args.push("-vf", "format=nv12,hwupload"); else args.push("-pix_fmt", "yuv420p");
    args.push(...encoderArgs(encoder, br, fps));
    args.push("-af", "aresample=async=1000:first_pts=0", "-c:a", "aac", "-b:a", (cfg.stream.audioBitrate || 160) + "k", "-ar", "48000", "-ac", "2");
    args.push("-f", "mpegts", "-mpegts_flags", "+resend_headers", "-flush_packets", "1", "pipe:1");
    const proc = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe", "pipe"], windowsHide: true });
    Object.assign(enc, { proc, w, h, fps, encoder, stats: {}, started: Date.now(), error: null });
    proc.stdin.on("error", () => { }); if (proc.stdio[3]) proc.stdio[3].on("error", () => { });
    if (useAudio) { audioStart(); audioSink = proc.stdio[3]; }
    proc.stdout.on("data", (b) => { for (const r of relays.values()) if (r.proc && r.proc.stdin.writable && r.proc.stdin.writableLength < 8 << 20) r.proc.stdin.write(b); });
    let errTail = "";
    lines(proc.stderr, (l) => { const m = /^(\w+)=(.*)$/.exec(l); if (m) { enc.stats[m[1]] = m[2].trim(); if (m[1] === "progress") sendStream(); } else errTail = (errTail + l + "\n").slice(-500); });
    proc.on("exit", (code) => {
      if (enc.proc !== proc) return;
      enc.proc = null; audioSink = null; enc.error = code ? (errTail.trim().split("\n").pop() || "the encoder stopped (" + code + ")") : null;
      for (const id of [...relays.keys()]) relayStop(id, id !== "record");
      sendStream();
    });
    sendStream(); return true;
  }
  function encStop() { const p = enc.proc; enc.proc = null; audioSink = null; if (p) { try { p.stdin.end(); } catch (_) { } setTimeout(() => { try { p.kill(); } catch (_) { } }, 1500); } sendStream(); }
  function destUrl(d) {
    const k = String(d.key || "").trim(), base = String(d.url || (DEST_KINDS[d.kind] || {}).url || "").trim().replace(/\/+$/, "");
    if (d.kind === "srt") return base;
    return k ? base + "/" + k : base;
  }
  function relayStart(id) {
    const bin = ffmpeg(); if (!bin || !enc.proc) return;
    let out, file = null;
    if (id === "record") {
      fs.mkdirSync(cfg.record.dir, { recursive: true });
      const t = new Date(), p2 = (n) => String(n).padStart(2, "0");
      file = path.join(cfg.record.dir, "Stream " + t.getFullYear() + "-" + p2(t.getMonth() + 1) + "-" + p2(t.getDate()) + " " + p2(t.getHours()) + "." + p2(t.getMinutes()) + "." + p2(t.getSeconds()) + ".mp4");
      out = ["-bsf:a", "aac_adtstoasc", "-f", "mp4", "-movflags", "+frag_keyframe+empty_moov+default_base_moof", file];
    } else {
      const d = cfg.destinations.find((x) => x.id === id); if (!d) return;
      const url = destUrl(d); if (!url) { relays.set(id, { proc: null, status: "error", error: "No address" }); sendStream(); return; }
      out = /^srt:/i.test(url) ? ["-f", "mpegts", url] : ["-bsf:a", "aac_adtstoasc", "-f", "flv", "-flvflags", "no_duration_filesize", url];
    }
    const args = ["-hide_banner", "-loglevel", "error", "-nostats", "-progress", "pipe:2", "-stats_period", "1", "-fflags", "+genpts+discardcorrupt", "-f", "mpegts", "-i", "pipe:0", "-map", "0", "-c", "copy"].concat(out);
    const proc = spawn(bin, args, { stdio: ["pipe", "ignore", "pipe"], windowsHide: true });
    const old = relays.get(id) || {};
    const r = { proc, bytes: 0, status: "connecting", error: null, file: file || old.file, since: Date.now(), retries: old.retries || 0, kbps: 0 }; relays.set(id, r);
    proc.stdin.on("error", () => { });
    let errTail = "";
    lines(proc.stderr, (l) => {
      const m = /^(\w+)=(.*)$/.exec(l);
      if (!m) { errTail = (errTail + l + "\n").slice(-400); return; }
      if (m[1] === "total_size") { const n = Number(m[2]) || 0; if (n > r.bytes) { if (r.status !== "live") { r.status = "live"; r.retries = 0; } r.kbps = Math.round((n - r.bytes) * 8 / 1000); r.bytes = n; } }
      if (m[1] === "progress") sendStream();
    });
    proc.on("exit", (code) => {
      if (relays.get(id) !== r) return;
      r.proc = null; r.status = "error"; r.error = (errTail.trim().split("\n").pop() || "disconnected (" + code + ")").slice(0, 200);
      const d = cfg.destinations.find((x) => x.id === id);
      if (id !== "record" && d && d.on && enc.proc) { r.retries++; r.status = "reconnecting"; r.retry = setTimeout(() => { if (relays.get(id) === r && enc.proc) relayStart(id); }, Math.min(15000, 2000 * r.retries)); }
      else if (id === "record") relays.delete(id);
      sendStream();
    });
    sendStream();
  }
  function relayStop(id, keep) { const r = relays.get(id); if (!r) return; clearTimeout(r.retry); if (r.proc) { try { r.proc.stdin.end(); } catch (_) { } const p = r.proc; setTimeout(() => { try { p.kill(); } catch (_) { } }, 2500); } r.proc = null; if (!keep) relays.delete(id); else { r.status = "stopped"; } }
  function syncRelays() {
    if (encoderNeeded()) { if (!enc.proc && !encStart()) return; }
    for (const d of cfg.destinations) { const r = relays.get(d.id); if (d.on && (!r || (!r.proc && r.status !== "reconnecting"))) relayStart(d.id); if (!d.on && r) relayStop(d.id); }
    for (const id of [...relays.keys()]) if (id !== "record" && !cfg.destinations.find((d) => d.id === id)) relayStop(id);
    if (!encoderNeeded() && enc.proc) encStop();
    sendStream();
  }
  function streamStatus() {
    return { encoder: enc.proc ? { on: true, codec: enc.encoder, width: enc.w, height: enc.h, fps: Number(enc.stats.fps) || 0, speed: enc.stats.speed || "", drop: Number(enc.stats.drop_frames) || 0, since: enc.started } : { on: false, error: enc.error },
      destinations: cfg.destinations.map((d) => { const r = relays.get(d.id) || {}; return { id: d.id, on: !!d.on, status: d.on ? (r.status || "starting") : "off", error: r.error || null, kbps: r.kbps || 0, retries: r.retries || 0 }; }),
      record: relays.has("record") ? { on: true, file: relays.get("record").file, bytes: relays.get("record").bytes } : { on: false, dir: cfg.record.dir },
      ndi: { stream: ndiOut.stream.status, main: ndiOut.main.status } };
  }
  let sendT = 0; function sendStream() { const now = Date.now(); if (now - sendT < 250) { clearTimeout(sendStream.t); sendStream.t = setTimeout(sendStream, 260); return; } sendT = now; send({ type: "stream", status: streamStatus() }); }

  // ------------------------------------------------------------------ NDI out (for OBS / vMix / Streamlabs on this computer)
  const ndiOut = { stream: { proc: null, status: { on: false } }, main: { proc: null, status: { on: false } } };
  function ndiOutSet(which, on) {
    const o = ndiOut[which]; if (!o) return;
    if (!on) { if (o.proc) { try { const q = Buffer.alloc(5); q[0] = 81; o.proc.stdin.write(q); o.proc.kill(); } catch (_) { } } o.proc = null; o.status = { on: false }; sendStream(); return; }
    if (o.proc) return;
    const bin = cuVideo(); if (!bin) { o.status = { on: false, error: "cu-video is missing" }; sendStream(); return; }
    const proc = spawn(bin, ["ndi-send", which === "stream" ? "Central Usage Stream" : "Central Usage Main"], { stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
    o.proc = proc; o.status = { on: true, starting: true }; proc.stdin.on("error", () => { });
    frames(proc.stdout, (t, p) => { if (t !== "J") return; try { const m = JSON.parse(p.toString("utf8")); if (m.ev === "status") o.status = m.ok ? { on: true, name: m.name } : { on: false, error: m.error }; else if (m.ev === "stats") o.status.receivers = m.receivers; sendStream(); } catch (_) { } });
    proc.on("exit", () => { if (o.proc === proc) { o.proc = null; if (o.status.on) o.status = { on: false, error: o.status.error || "stopped" }; sendStream(); } });
  }
  function ndiSend(which, w, h, fps, fmt, data) {
    const o = ndiOut[which]; if (!o || !o.proc || !o.proc.stdin.writable || o.proc.stdin.writableLength > 16 << 20) return;
    const hd = Buffer.alloc(13); hd[0] = 86; hd.writeUInt32LE(8 + data.length, 1); hd.writeUInt16LE(w, 5); hd.writeUInt16LE(h, 7); hd.writeUInt16LE(fps, 9); hd[11] = fmt; hd[12] = 0;
    o.proc.stdin.write(Buffer.concat([hd, data]));
  }

  // ------------------------------------------------------------------ frames from the page: 10 = the stream output, 11 = the main output (I420)
  let streamFrames = 0;
  function fromPage(buf) {
    const kind = buf[0], w = buf.readUInt16LE(1), h = buf.readUInt16LE(3), fps = buf.readUInt16LE(5), data = buf.subarray(8);
    if (data.length !== w * h * 3 / 2) return;
    if (kind === 10) {
      streamFrames++;
      if (enc.proc && enc.proc.stdin.writable && w === enc.w && h === enc.h && enc.proc.stdin.writableLength < 3 * data.length) enc.proc.stdin.write(data);
      ndiSend("stream", w, h, fps, 0, data);
    } else if (kind === 11) ndiSend("main", w, h, fps, 0, data);
  }

  // ------------------------------------------------------------------ the Main output window (opened by the page with window.open, so it can draw into it)
  function display(id) { const all = screen.getAllDisplays(); return all.find((d) => d.id === id) || all.find((d) => d.id !== screen.getPrimaryDisplay().id) || screen.getPrimaryDisplay(); }
  function windowOpen(details) {
    if (!details || details.frameName !== "cu-video-main") return null;
    const d = display(cfg.main.displayId);
    return { action: "allow", overrideBrowserWindowOptions: { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height, frame: false, fullscreen: true, backgroundColor: "#000000", title: "Central Usage - Main", autoHideMenuBar: true, skipTaskbar: false, webPreferences: { backgroundThrottling: false } } };
  }

  // ------------------------------------------------------------------ ipc
  let idSeq = 1; function nextId() { let id; do { id = (idSeq++ % 60000) + 1; } while (cfg.sources.some((s) => s.id === id) || id === SLIDES_ID); return id; }
  for (const s of cfg.sources) idSeq = Math.max(idSeq, (s.id || 0) + 1);
  function pub() { return JSON.parse(JSON.stringify(cfg)); }
  ipcMain.handle("video-init", async () => {
    const w = getWin(); if (w && !w.isDestroyed()) w.webContents.setBackgroundThrottling(false);   // the outputs keep running when the window is minimised
    await new Promise((r) => { if (port) r(); else wss.once("listening", r); });
    return { port, token, cfg: pub(), ffmpeg: ffmpeg(), cuVideo: cuVideo(), platform: process.platform, presets: PRESETS, destKinds: DEST_KINDS, slidesId: SLIDES_ID, status: Object.fromEntries(status) };
  });
  ipcMain.handle("video-encoders", () => probeEncoders());
  ipcMain.handle("video-config", (_e, patch) => {
    patch = patch || {};
    for (const k of ["multiview", "main", "stream", "record", "lyrics", "transition", "phones"]) if (patch[k]) cfg[k] = Object.assign({}, cfg[k], patch[k]);
    if (patch.audio) { cfg.audio = Object.assign({}, cfg.audio, patch.audio); if (audio) audioApply(); }
    if (patch.sources) { cfg.sources = patch.sources.map((s) => Object.assign({}, s, { id: s.id || nextId() })); for (const s of cfg.sources) if (procs.has(s.id) && wants.get(s.id)) { stopFf(s.id); startFf(s, wants.get(s.id)); } }
    if (patch.destinations) { cfg.destinations = patch.destinations.map((d) => Object.assign({ on: false }, d, { id: d.id || "d" + crypto.randomBytes(3).toString("hex") })); syncRelays(); }
    if (patch.stream && (patch.stream.preset || patch.stream.encoder || patch.stream.bitrate) && enc.proc) { encStop(); setTimeout(syncRelays, 1800); }
    save(); return pub();
  });
  ipcMain.handle("video-want", (_e, map) => { want(map || {}); return true; });
  ipcMain.handle("video-screens", () => screen.getAllDisplays().map((d, i) => ({ id: d.id, label: d.label || "Screen " + (i + 1), size: d.size, bounds: d.bounds, primary: d.id === screen.getPrimaryDisplay().id })));
  ipcMain.handle("video-ndi-find", () => { ndiStart(); return { error: ndiError, sources: ndiSources }; });
  ipcMain.handle("video-ndi-extra", (_e, ips) => { ndiCmd({ cmd: "extraIps", ips: String(ips || "") }); return true; });
  ipcMain.handle("video-audio", (_e, cmd) => { if (cmd && cmd.cmd === "list") { audioCmd({ cmd: "list" }); return { devices: audioDevices, backend: audioBackend, status: audioStatus }; } audioStart(); return { devices: audioDevices, backend: audioBackend, status: audioStatus }; });
  ipcMain.handle("video-dest", (_e, id, on) => { const d = cfg.destinations.find((x) => x.id === id); if (d) { d.on = !!on; save(); syncRelays(); } return streamStatus(); });
  ipcMain.handle("video-stream-all", (_e, on) => { cfg.destinations.forEach((d) => { d.on = !!on; }); save(); syncRelays(); return streamStatus(); });
  ipcMain.handle("video-record", (_e, on) => { if (on) { if (!enc.proc && !encStart()) return streamStatus(); if (!relays.has("record")) relayStart("record"); } else { relayStop("record"); syncRelays(); } return streamStatus(); });
  ipcMain.handle("video-ndi-out", (_e, which, on) => { ndiOutSet(which, on); cfg[which === "main" ? "main" : "stream"].ndi = !!on; save(); return streamStatus(); });
  ipcMain.handle("video-status", () => streamStatus());
  // tally to the phones: a red ON AIR light on the one that is live
  ipcMain.on("video-tally", (_e, map) => { for (const [ws, p] of phones) { if (p.sourceId == null) continue; const t = (map || {})[p.sourceId] || {}; const k = (t.on ? 1 : 0) + (t.pvw ? 2 : 0); if (p.tally !== k) { p.tally = k; try { ws.send(JSON.stringify({ type: "tally", on: !!t.on, pvw: !!t.pvw })); } catch (_) { } } } });
  ipcMain.handle("video-slides", (_e, on) => { slidesOn(!!on); return true; });
  ipcMain.handle("video-phones", (_e, on) => { if (on === true || on === false) { cfg.phones.on = on; save(); } if (on === true) phonesStart(); else if (on === false) phonesStop(); else if (on === "newcode") { cfg.phones.code = String(1000 + Math.floor(Math.random() * 9000)); save(); } return phoneInfo(); });
  ipcMain.handle("video-open-recordings", () => { fs.mkdirSync(cfg.record.dir, { recursive: true }); require("electron").shell.openPath(cfg.record.dir); return true; });
  ipcMain.handle("video-stats", () => ({ slidesPaints: slides.paints || 0, slidesSent: slides.sent || 0, pending: pending.size, streamFrames, page: !!page, procs: [...procs.keys()], ndi: [...ndiOpen.keys()], phones: phones.size }));

  function stop() {
    for (const id of [...procs.keys()]) stopFf(id);
    if (ndi) { try { ndi.stdin.write('{"cmd":"quit"}\n'); ndi.kill(); } catch (_) { } }
    if (audio) { try { audio.stdin.write('{"cmd":"quit"}\n'); audio.kill(); } catch (_) { } }
    for (const id of [...relays.keys()]) relayStop(id);
    encStop(); ndiOutSet("stream", false); ndiOutSet("main", false); slidesOn(false); phonesStop();
    try { wss.close(); } catch (_) { }
  }
  if (app && app.on) app.on("will-quit", stop);
  if (cfg.phones.on) phonesStart();
  return { windowOpen, stop, status: streamStatus };
};
