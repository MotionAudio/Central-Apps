// The Video tab end to end: a temporary copy of Central Control with the integration steps of docs/VIDEO-INTEGRATION.md
// applied, run in Electron with a fake camera; a test-pattern "IP camera" through ffmpeg; the multiview, preview,
// cut and fade; the lyrics lower third and the slides; the Main window; streaming to a local RTMP and a local SRT
// server at once; recording; the stream's audio helper; a phone camera from Chromium over HTTPS; NDI's absence.
//   (cd native/video && make) && xvfb-run -a node test-video.mjs          ports: 1934x / 1844x (set VIDEO_TEST_BASE)
import { _electron as electron, chromium } from "playwright";
import { spawn, spawnSync } from "node:child_process"; import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import assert from "node:assert";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const BASE = Number(process.env.VIDEO_TEST_BASE || 19340);
let failures = 0; async function check(label, fn) { try { await fn(); console.log("  ✓ " + label); } catch (e) { failures++; console.error("  ✗ " + label + "\n      " + String(e && e.message || e).split("\n").slice(0, 6).join("\n      ")); } }
const until = async (fn, ms = 10000, step = 150) => { const t0 = Date.now(); let last; while (Date.now() - t0 < ms) { try { last = await fn(); if (last) return last; } catch (_) { } await new Promise((r) => setTimeout(r, step)); } return last; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FF = process.env.CU_FFMPEG || "ffmpeg";

// ---- the app, with the integration steps applied
const app0 = fs.mkdtempSync(path.join(os.tmpdir(), "cu-video-app-"));
for (const f of fs.readdirSync(here)) if (!["node_modules", "dist", "release"].includes(f)) fs.cpSync(path.join(here, f), path.join(app0, f), { recursive: true });
fs.symlinkSync(path.join(here, "node_modules"), path.join(app0, "node_modules"), "dir");
spawnSync("make", ["-C", path.join(app0, "native", "video")], { stdio: "ignore" });
function patch(file, from, to) { const p = path.join(app0, file); let s = fs.readFileSync(p, "utf8"); if (s.includes(to)) return; if (!s.includes(from)) throw new Error("integration: can't find in " + file + ": " + from.slice(0, 60)); fs.writeFileSync(p, s.replace(from, to)); }
// (the app is wired for the Video tab now - the steps below only run on a copy that isn't)
const wired = fs.readFileSync(path.join(app0, "main.js"), "utf8").includes('require("./video-service")');
if (!wired) {
patch("main.js", 'const svc = require("./services")(app, () => win);', 'const svc = require("./services")(app, () => win);\nconst { screen } = require("electron");\nconst videoSvc = require("./video-service").setup({ ipcMain, getWin: () => win, userData: app.getPath("userData"), app, screen, BrowserWindow, binDir: app.isPackaged ? path.join(process.resourcesPath, "native") : path.join(__dirname, "native", "build") });');
patch("main.js", 'win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });', 'win.webContents.setWindowOpenHandler((details) => { const v = videoSvc.windowOpen(details); if (v) return v; shell.openExternal(details.url); return { action: "deny" }; });');
fs.appendFileSync(path.join(app0, "preload.js"), '\nrequire("./preload-video")();\n');
}
const idx = path.join(app0, "app", "index.html"); let html = fs.readFileSync(idx, "utf8");
if (!html.includes('data-tab="video"')) {
  html = html.replace('<button class="tab" data-tab="slides">Slides</button>', '<button class="tab" data-tab="slides">Slides</button><button class="tab" data-tab="video">Video</button>')
    .replace('  <section class="view" id="view-io">', '  <section class="view" id="view-video"><div id="videoRoot" class="pad-view"></div></section>\n  <section class="view" id="view-io">')
    .replace('<link rel="stylesheet" href="inear.css">', '<link rel="stylesheet" href="inear.css">\n  <link rel="stylesheet" href="video.css">')
    .replace('  <script src="io.js"></script>', '  <script src="video.js"></script>\n  <script src="io.js"></script>');
  fs.writeFileSync(idx, html);
}
{ const p = path.join(app0, "app", "app.js"); let s = fs.readFileSync(p, "utf8"); s = s.replace(/admin: \["lights", "mix", "inears", "lyrics", "slides",/g, 'admin: ["lights", "mix", "inears", "lyrics", "slides", "video",').replace(/main: \["lights", "mix", "inears", "lyrics", "slides",/g, 'main: ["lights", "mix", "inears", "lyrics", "slides", "video",'); fs.writeFileSync(p, s); }

// ---- local streaming servers (RTMP and SRT listeners) and a recording folder
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cu-video-"));
const rtmpOut = path.join(tmp, "rtmp.flv"), srtOut = path.join(tmp, "srt.ts"), recDir = path.join(tmp, "rec");
const servers = [];
function listen(args) { const p = spawn(FF, ["-hide_banner", "-loglevel", "error", "-y"].concat(args), { stdio: ["ignore", "ignore", "pipe"] }); let e = ""; p.stderr.on("data", (b) => { e += b; }); p.errText = () => e; servers.push(p); return p; }
const rtmpSrv = listen(["-listen", "1", "-timeout", "60", "-i", "rtmp://127.0.0.1:" + (BASE + 5) + "/live/key123", "-c", "copy", "-f", "flv", rtmpOut]);
const srtSrv = listen(["-i", "srt://127.0.0.1:" + (BASE + 6) + "?mode=listener&latency=50000", "-c", "copy", "-f", "mpegts", srtOut]);

// ---- Central Control
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "cu-video-ud-"));
fs.writeFileSync(path.join(userData, "cu.json"), JSON.stringify({ mode: "admin", role: "admin", jobsPicked: true, name: "Video desk" }));
fs.writeFileSync(path.join(userData, "video.json"), JSON.stringify({ record: { dir: recDir }, stream: { preset: "720p30", bitrate: 2500, encoder: "auto" } }));
const exe = [process.env.ELECTRON_PATH, path.join(here, "node_modules", "electron", "dist", "electron")].filter((p) => p && fs.existsSync(p))[0];
// (9.5: Central Control needs a key - with no website yet, its default A key)
async function passKey(p, key) {
  await p.waitForFunction(() => window.PPLicense && PPLicense.app && PPLicense.app(), null, { timeout: 15000 }).catch(() => { });
  if (!(await p.evaluate(() => !!document.getElementById("licWiz")))) return;
  await p.evaluate((k) => { localStorage.setItem("cc-license", JSON.stringify({ key: k, kind: k[0], app: k[0] === "U" ? "usage" : "control", okAt: Date.now(), production: "Test church", isDefault: true })); }, key);
  await p.reload(); await p.waitForFunction(() => window.PPLicense && PPLicense.app && PPLicense.app(), null, { timeout: 15000 });
}
const app = await electron.launch({ executablePath: exe, args: [path.join(app0, "main.js"), "--no-sandbox", "--user-data-dir=" + userData, "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"],
  env: Object.assign({}, process.env, { CU_FFMPEG: FF, CU_VIDEO_PHONE_PORT: String(BASE + 3), CC_UPDATE_API: "http://127.0.0.1:9/none", CU_MODE: "admin", CU_ROLE: "admin" }) });
const cu = await app.firstWindow(); const errs = []; cu.on("pageerror", (e) => errs.push(String(e))); cu.on("console", (m) => { if (m.type() === "error" && !/favicon|ERR_CONNECTION|Failed to load resource|WebSocket/.test(m.text())) errs.push("console: " + m.text()); });
await passKey(cu, "ADEF-AULT-KEY0-2026");
await cu.waitForFunction(() => window.CentralUsage && window.CUVideo && window.CUVideoTab);
await cu.evaluate(() => { const p = document.getElementById("modePick"); if (p) p.remove(); CentralUsage.showTab("video"); });
const ready = await until(() => cu.evaluate(() => CUVideoTab.state.ready || CUVideoTab.state.error), 15000);
if (ready !== true) console.log("debug:", await cu.evaluate(() => ({ tab: CentralUsage.prefs.tab, role: CentralUsage.role && CentralUsage.role(), mode: CentralUsage.mode(), starting: CUVideoTab.state.starting, err: CUVideoTab.state.error, html: document.getElementById("videoRoot").innerHTML.slice(0, 300) })));

console.log("The Video tab:");
await check("it opens with the GPU compositor ready (WebGL2)", async () => { assert.equal(ready, true, String(ready)); });
await check("the encoders are found (x264 at least)", async () => { const e = await cu.evaluate(() => CUVideo.encoders()); assert.ok(e.list.includes("libx264"), JSON.stringify(e)); });

console.log("Sources:");
await cu.evaluate((b) => CUVideo.config({ sources: [{ kind: "test", name: "Bars", url: "test:testsrc2", mv: true }, { kind: "test", name: "Clock", url: "test:testsrc", mv: true }, { kind: "capture", name: "Webcam", deviceId: "", mv: true }, { kind: "ip", name: "Dead camera", url: "rtsp://127.0.0.1:" + (b + 9) + "/none", mv: true }] }).then((c) => { CUVideoTab.state.cfg = c; }), BASE);
await cu.evaluate(() => { CUVideoTab.setPreview(null); CUVideoTab.start(); });
await cu.evaluate(() => { CUVideoTab.state.view = "switch"; document.querySelector('[data-vview="switch"]').click(); });
const ids = await cu.evaluate(() => CUVideoTab.state.cfg.sources.map((s) => s.id));
await check("a test-pattern 'IP camera' (ffmpeg) reaches the multiview at low resolution", async () => {
  const st = await until(() => cu.evaluate((id) => { const s = CUVideoTab.state.status[id]; return s && s.state === "live" && s.level === "lo" ? s : null; }, ids[0]), 15000);
  assert.ok(st && st.width === 384, JSON.stringify(st));
  assert.ok(await until(() => cu.evaluate((id) => { const t = CUVideoTab.G.tex.get(id); return t && t.at > 0 && performance.now() - t.at < 1000; }, ids[0]), 5000));
});
await check("the fake USB camera opens through the page (getUserMedia)", async () => { assert.ok(await until(() => cu.evaluate((id) => { const t = CUVideoTab.G.tex.get(id); return t && t.at > 0; }, ids[2]), 10000)); });
await check("a camera that is not there says so (and is retried)", async () => { const st = await until(() => cu.evaluate((id) => { const s = CUVideoTab.state.status[id]; return s && s.error ? s : null; }, ids[3]), 15000); assert.ok(st && st.error, JSON.stringify(st)); });
await check("the multiview draws the tiles with their names", async () => {
  const px = await until(() => cu.evaluate(() => { const cv = document.querySelector(".vd-mv"); if (!cv || !cv._layout) return null; const d = cv.getContext("2d").getImageData(Math.floor(cv._layout.tw / 2), Math.floor(cv._layout.th / 3), 1, 1).data; return d[0] + d[1] + d[2] > 60 ? [d[0], d[1], d[2], cv._layout.items.length] : null; }), 8000);
  assert.ok(px && px[3] === 5, JSON.stringify(px));   // 4 cameras + Slides
});

console.log("Switching:");
await check("click = preview: the camera comes in full quality (hi) and shows green", async () => {
  await cu.evaluate((id) => { CUVideoTab.state.bus = "both"; CUVideoTab.setPreview(id); }, ids[0]);
  const st = await until(() => cu.evaluate((id) => { const s = CUVideoTab.state.status[id]; return s && s.state === "live" && s.level === "hi" ? s : null; }, ids[0]), 15000);
  assert.ok(st && st.width === 1280, JSON.stringify(st));
});
await check("CUT puts it on both programs (tally red)", async () => {
  await cu.evaluate(() => CUVideoTab.cut("both"));
  const o = await cu.evaluate(() => ({ m: CUVideoTab.state.out.main.pgm, s: CUVideoTab.state.out.stream.pgm }));
  assert.deepEqual(o, { m: ids[0], s: ids[0] });
});
await check("AUTO fades to the preview over the transition time, then swaps", async () => {
  await cu.evaluate((id) => { CUVideoTab.state.bus = "main"; CUVideoTab.setPreview(id); CUVideoTab.auto("main"); }, ids[1]);
  const mid = await until(() => cu.evaluate(() => { const t = CUVideoTab.state.out.main.trans; return t && t.p > 0.05 && t.p < 0.95 ? t.p : null; }), 3000, 30);
  assert.ok(mid, "no transition seen");
  const done = await until(() => cu.evaluate(() => !CUVideoTab.state.out.main.trans && CUVideoTab.state.out.main.pgm), 4000);
  assert.equal(done, ids[1]);
  assert.equal(await cu.evaluate(() => CUVideoTab.state.out.main.pvw), ids[0]);
});
// read a pixel of an output (top-left origin) - the outputs' framebuffers keep the picture's top at row 0
const outPixel = (which, fx, fy) => cu.evaluate(([w, x, y]) => { const G = CUVideoTab.G, gl = G.gl, f = G.fb[w]; gl.bindFramebuffer(gl.FRAMEBUFFER, f.fbo); const d = new Uint8Array(4); gl.readPixels(Math.floor(f.w * x), Math.floor(f.h * y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, d); return Array.from(d); }, [which, fx, fy]);
await check("the stream output shows the camera (not black)", async () => {
  const p = await until(async () => { const a = await outPixel("stream", 0.3, 0.3); return a[0] + a[1] + a[2] > 60 ? a : null; }, 5000);
  assert.ok(p, "black");
});

console.log("Lyrics and slides:");
await cu.evaluate(() => CentralUsage.onMessage({ type: "display", song: { index: 0, name: "Grace" }, lyrics: { lines: ["Amazing grace how sweet the sound", "That saved a wretch like me"], next: [], section: "Verse 1" } }));
await check("LYRICS fades in a lower third on the stream (band + white text)", async () => {
  await cu.evaluate(() => { CUVideoTab.state.out.stream.lyrics = true; CUVideoTab.state.cfg.lyrics.fade = 0.2; });
  await sleep(900);
  const band = await cu.evaluate(() => { const G = CUVideoTab.G, gl = G.gl, f = G.fb.stream; gl.bindFramebuffer(gl.FRAMEBUFFER, f.fbo); const y0 = Math.floor(f.h * 0.78), y1 = Math.floor(f.h * 0.92), d = new Uint8Array(f.w * (y1 - y0) * 4); gl.readPixels(0, y0, f.w, y1 - y0, gl.RGBA, gl.UNSIGNED_BYTE, d); let white = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 235 && d[i + 1] > 235 && d[i + 2] > 235) white++; return white; });
  assert.ok(band > 500, "white text pixels: " + band);
});
await check("...and not on Main (lyrics are per output)", async () => {
  const st = await cu.evaluate(() => ({ s: CUVideoTab.state.out.stream.lyricsA, m: CUVideoTab.state.out.main.lyricsA }));
  assert.ok(st.s === 1 && st.m === 0, JSON.stringify(st));
});
await check("the Slides tab's picture comes in (rendered off screen) and goes full screen on Main", async () => {
  await cu.evaluate(() => { window.CU.slides.show({ kind: "text", text: "WELCOME", color: "#ff0000", size: 20, background: "#ff0000" }); const o = CUVideoTab.state.out.main; o.slides = "full"; CUVideoTab.setPreview(o.pvw); });
  const sid = await cu.evaluate(() => CUVideoTab.state.init.slidesId);
  assert.ok(await until(() => cu.evaluate((id) => { const t = CUVideoTab.G.tex.get(id); return t && t.at > 0; }, sid), 10000), "no slide frames");
  const p = await until(async () => { const a = await outPixel("main", 0.5, 0.5); return a[0] > 180 && a[1] < 80 ? a : null; }, 15000);
  assert.ok(p, "main is not the red slide: " + JSON.stringify(await outPixel("main", 0.5, 0.5)));
  await cu.evaluate(() => { CUVideoTab.state.out.main.slides = "off"; });
});

console.log("The Main window:");
await check("SCREEN opens the Main output full screen in its own window and draws into it", async () => {
  await cu.evaluate(() => CUVideoTab.mainOpen(true));
  const w2 = await until(() => app.windows().find((w) => w !== cu), 5000); assert.ok(w2, "no window");
  const px = await until(() => cu.evaluate(() => { const w = window.open("", "cu-video-main"); const c = w && w.document.querySelector("canvas"); if (!c || !c.width) return null; const d = c.getContext("2d").getImageData(Math.floor(c.width * 0.5), Math.floor(c.height * 0.5), 1, 1).data; return d[0] + d[1] + d[2] > 60 ? Array.from(d) : null; }), 15000);
  assert.ok(px, "the window's canvas is black");
  await cu.evaluate(() => CUVideoTab.mainOpen(false));
});

console.log("Phones:");
const phoneInfo = await cu.evaluate(() => CUVideo.phones(true));
await check("the phone start page (http) offers the certificate and the camera page", async () => {
  const r = await fetch("http://127.0.0.1:" + phoneInfo.httpPort + "/"); const t = await r.text(); assert.ok(t.includes("/ca.crt") && t.includes("https://"), t.slice(0, 200));
  const c = await fetch("http://127.0.0.1:" + phoneInfo.httpPort + "/ca.crt"); assert.ok((await c.text()).includes("BEGIN CERTIFICATE"));
});
const browser = await chromium.launch({ executablePath: process.env.CHROME || "/opt/pw-browsers/chromium", args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
const phoneCtx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 800 } });
const phone = await phoneCtx.newPage(); phone.on("pageerror", (e) => errs.push("phone: " + e));
await phone.goto("https://127.0.0.1:" + phoneInfo.port + "/?name=Balcony&code=" + phoneInfo.code);
await phone.click("#start");
let phoneCodec = "";
await check("a phone joins with the camera code and appears as a camera", async () => {
  const s = await until(() => cu.evaluate(() => CUVideoTab.state.cfg.sources.find((x) => x.kind === "phone" && x.name === "Phone: Balcony")), 10000);
  assert.ok(s, "no phone source");
  phoneCodec = await phone.evaluate(() => document.getElementById("msg").textContent);
  assert.ok(await until(() => cu.evaluate((id) => { const t = CUVideoTab.G.tex.get(id); return t && t.at > 0 && performance.now() - t.at < 4000; }, s.id), 15000), "no frames from the phone (" + phoneCodec + ", seen " + await cu.evaluate((id) => CUVideoTab.seen[id], s.id) + ")");
});
await check("the phone shows ON AIR when it is on a program", async () => {
  const id = await cu.evaluate(() => CUVideoTab.state.cfg.sources.find((x) => x.kind === "phone").id);
  await cu.evaluate((i) => { CUVideoTab.state.bus = "stream"; CUVideoTab.setPreview(i); CUVideoTab.cut("stream"); }, id);
  assert.ok(await until(() => phone.evaluate(() => document.getElementById("tally").textContent === "ON AIR"), 5000));
  await cu.evaluate(() => { CUVideoTab.cut("stream"); });   // the camera back on the stream
});
await check("a wrong camera code is refused", async () => {
  const p2 = await phoneCtx.newPage(); await p2.goto("https://127.0.0.1:" + phoneInfo.port + "/?name=Intruder&code=0000"); await p2.click("#start");
  assert.ok(await until(() => p2.evaluate(() => /Wrong camera code/.test(document.getElementById("msg").textContent)), 6000)); await p2.close();
});
await phone.close();   // less load on this machine for the streaming checks

console.log("Streaming:");
await cu.evaluate((b) => CUVideo.config({ destinations: [{ kind: "rtmp", name: "Local RTMP", url: "rtmp://127.0.0.1:" + (b + 5) + "/live", key: "key123", on: false }, { kind: "srt", name: "Local SRT", url: "srt://127.0.0.1:" + (b + 6) + "?mode=caller&latency=50000", on: false }] }).then((c) => { CUVideoTab.state.cfg = c; }), BASE);
await cu.evaluate(() => CUVideo.config({ audio: { sources: [{ device: "Discard all samples (playback) or generate zero samples (capture)", l: 0, r: 1, gain: 0, on: true }, { device: "", l: 0, r: 1, gain: 0, on: true }], use: 0, delay: 80 } }));
await check("GO LIVE streams to RTMP and SRT at once, each live on its own", async () => {
  await cu.evaluate(() => CUVideo.streamAll(true));
  const st = await until(() => cu.evaluate(() => CUVideo.status().then((s) => s.destinations.every((d) => d.status === "live") ? s : null)), 20000, 500);
  assert.ok(st, JSON.stringify(await cu.evaluate(() => CUVideo.status())));
});
await check("RECORD writes the stream to a file at the same time", async () => { const st = await cu.evaluate(() => CUVideo.record(true)); assert.ok(st.record.on, JSON.stringify(st.record)); });
await check("the stream keeps going with the window minimised (the outputs aren't throttled)", async () => {
  const a = await cu.evaluate(() => CUVideo.stats()); await sleep(2500); const b = await cu.evaluate(() => CUVideo.stats());
  const bw = await app.browserWindow(cu); await bw.evaluate((w) => w.minimize()); await sleep(2500);
  const c = await cu.evaluate(() => CUVideo.stats()); await bw.evaluate((w) => w.restore());
  const shown = b.streamFrames - a.streamFrames, hidden = c.streamFrames - b.streamFrames;
  assert.ok(shown > 0 && hidden >= shown * 0.5, "frames shown " + shown + ", minimised " + hidden);
});
await sleep(3000);
await check("stopping one destination leaves the other live", async () => {
  const id = await cu.evaluate(() => CUVideoTab.state.cfg.destinations[1].id); await cu.evaluate((i) => CUVideo.dest(i, false), id); await sleep(1500);
  const st = await cu.evaluate(() => CUVideo.status()); assert.equal(st.destinations[0].status, "live"); assert.equal(st.destinations[1].status, "off");
});
await cu.evaluate(() => CUVideo.record(false)); await cu.evaluate(() => CUVideo.streamAll(false)); await sleep(3500);
const probe = (f) => { const r = spawnSync(FF.replace(/ffmpeg$/, "ffprobe"), ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height:format=duration", "-of", "json", f], { encoding: "utf8" }); try { return JSON.parse(r.stdout); } catch (_) { return null; } };
await check("the RTMP server got H.264 720p + AAC for several seconds", async () => {
  await until(() => rtmpSrv.exitCode != null, 8000); const j = probe(rtmpOut); assert.ok(j, "no file: " + rtmpSrv.errText());
  const v = j.streams.find((s) => s.codec_type === "video"), a = j.streams.find((s) => s.codec_type === "audio");
  assert.ok(v && v.codec_name === "h264" && v.width === 1280 && v.height === 720 && a && a.codec_name === "aac" && Number(j.format.duration) > 4, JSON.stringify(j));
});
await check("...and the picture in it is the camera with the lyrics (not black)", async () => {
  const png = path.join(tmp, "frame.png"); spawnSync(FF, ["-v", "error", "-y", "-sseof", "-1.5", "-i", rtmpOut, "-frames:v", "1", "-vf", "scale=64:36", "-f", "rawvideo", "-pix_fmt", "rgb24", png]);
  const d = fs.readFileSync(png); let sum = 0; for (const b of d) sum += b; assert.ok(sum / d.length > 30, "mean " + sum / d.length);
});
await check("the SRT listener got the stream too", async () => { srtSrv.kill("SIGINT"); await until(() => srtSrv.exitCode != null, 5000); const j = probe(srtOut); assert.ok(j && j.streams.some((s) => s.codec_name === "h264"), JSON.stringify(j) + srtSrv.errText()); });
await check("the recording is a playable MP4", async () => {
  const files = fs.existsSync(recDir) ? fs.readdirSync(recDir).filter((f) => f.endsWith(".mp4")) : []; assert.ok(files.length, "no recording");
  const j = probe(path.join(recDir, files[0])); assert.ok(j && Number(j.format.duration) > 2 && j.streams.length === 2, JSON.stringify(j));
});

console.log("Stream audio:");
await check("the audio helper opens a source, meters it and reports", async () => {
  const st = await until(() => cu.evaluate(() => CUVideoTab.state.audio.status && CUVideoTab.state.audio.status.sources[0].running ? CUVideoTab.state.audio.status : null), 6000);
  assert.ok(st && st.delay === 80, JSON.stringify(st));
  assert.ok(await cu.evaluate(() => !!CUVideoTab.state.audio.meters));
});

await check("the Stream mix as the stream's sound: the sound desk's mix (here pushed by the page) goes into the stream, delayed by the A/V offset", async () => {
  const before = fs.existsSync(recDir) ? fs.readdirSync(recDir).filter((f) => f.endsWith(".mp4")) : [];
  await cu.evaluate(() => CUVideo.config({ audio: { use: 2, delay: 200 } }).then((c) => { CUVideoTab.state.cfg = c; }));
  await cu.evaluate(() => CUVideo.record(true)); await sleep(1500);   // (silence first: the stream keeps going with nothing from the desk)
  await cu.evaluate(() => new Promise((done) => {   // 3 s of a 440 Hz tone, 20 ms at a time, like the audio host sends it
    let ph = 0, sent = 0; const t0 = performance.now();
    const t = setInterval(() => {   // (whatever the page's timers do: always as much as the time that went by)
      const due = Math.min(144000, Math.floor((performance.now() - t0) * 48)), n = due - sent; if (n <= 0) return;
      const b = new Int16Array(n * 2); for (let f = 0; f < n; f++) { const v = Math.round(0.5 * 32767 * Math.sin(ph)); b[f * 2] = v; b[f * 2 + 1] = v; ph += 2 * Math.PI * 440 / 48000; }
      CUVideo.mixPcm(new Uint8Array(b.buffer)); sent = due; if (sent >= 144000) { clearInterval(t); done(); }
    }, 20);
  }));
  const speed = parseFloat(await cu.evaluate(() => CUVideo.status().then((s) => s.encoder && s.encoder.speed || "0"))) || 0;   // (a busy test machine encodes slower than real time)
  await sleep(1500); await cu.evaluate(() => CUVideo.record(false)); await sleep(2500);
  await cu.evaluate(() => CUVideo.config({ audio: { use: 0, delay: 80 } }).then((c) => { CUVideoTab.state.cfg = c; }));
  const file = (fs.readdirSync(recDir).filter((f) => f.endsWith(".mp4") && before.indexOf(f) < 0))[0]; assert.ok(file, "no new recording");
  const j = probe(path.join(recDir, file)); assert.ok(j && j.streams.some((s) => s.codec_type === "audio") && Number(j.format.duration) > (speed >= 0.95 ? 4 : 2), JSON.stringify(j) + " speed " + speed);
  const vd = spawnSync(FF, ["-hide_banner", "-nostats", "-i", path.join(recDir, file), "-map", "0:a", "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const max = Number((/max_volume: (-?[\d.]+) dB/.exec(vd) || [])[1]); assert.ok(max > -12, "the tone is in the stream: max " + max + " dB");
  // before the tone: silence (nothing from the desk yet - the stream kept going)
  const sd = spawnSync(FF, ["-hide_banner", "-nostats", "-i", path.join(recDir, file), "-map", "0:a", "-af", "silencedetect=n=-30dB:d=0.1", "-f", "null", "-"], { encoding: "utf8" }).stderr;
  const ends = [...sd.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1])), starts = [...sd.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  assert.ok(starts[0] === 0 && ends[0] > 0.1, "silence first: " + sd.match(/silence_(start|end): [\d.]+/g));
  if (speed >= 0.95) {   // 3 s of tone went in: one piece of about 3 s in the stream (not stretched, not chopped up) - when the encoder keeps up
    const toneFrom = ends[0], toneTo = starts.find((s) => s > toneFrom);
    assert.ok(toneTo && toneTo - toneFrom > 2.6 && toneTo - toneFrom < 3.6, "the tone: " + toneFrom + " to " + toneTo + " s (" + sd.match(/silence_(start|end): [\d.]+/g) + ")");
  } else console.log("      (this machine encodes at " + speed + "x: the tone's length isn't checked)");
});

console.log("NDI:");
await check("without the NDI runtime the Sources page says what to install", async () => { const r = await cu.evaluate(() => CUVideo.ndiFind()); const e = r.error || (await until(() => cu.evaluate(() => CUVideoTab.state.ndi.error), 4000)); assert.ok(/NDI/.test(e || ""), JSON.stringify(r)); });
await check("NDI out without the runtime reports it instead of failing silently", async () => { await cu.evaluate(() => CUVideo.ndiOut("stream", true)); const st = await until(() => cu.evaluate(() => CUVideo.status().then((s) => s.ndi.stream.error ? s : null)), 5000); assert.ok(st && /NDI/.test(st.ndi.stream.error), JSON.stringify(st && st.ndi)); await cu.evaluate(() => CUVideo.ndiOut("stream", false)); });

console.log("The pages:");
for (const v of ["sources", "stream", "audio", "overlays", "phones", "switch"]) {
  await check("the " + v + " page renders", async () => { await cu.evaluate((x) => document.querySelector('[data-vview="' + x + '"]').click(), v); await sleep(300); assert.ok(await cu.evaluate(() => document.getElementById("vdBody").textContent.length > 40)); });
}
await cu.setViewportSize({ width: 1280, height: 800 }).catch(() => { });
await cu.screenshot({ path: path.join(process.env.SHOTS || tmp, "video-switcher.png") }).catch(() => { });
await check("no page errors", async () => { assert.deepEqual(errs, []); });
console.log("phone sent: " + phoneCodec);

await phone.close().catch(() => { }); await browser.close(); await app.close().catch(() => { }); servers.forEach((p) => { try { p.kill(); } catch (_) { } });
console.log(failures ? "\n" + failures + " VIDEO CHECK(S) FAILED" : "\nALL VIDEO CHECKS PASSED");
process.exit(failures ? 1 : 0);
