/* Central Control - the desktop app (Electron main process). A real application
 * window: no browser chrome, its own menu, launcher entry and installer.
 * It finds the Central Pedal (Raspberry Pi) on the Wi-Fi, gives the page Web MIDI
 * (Lightkey / consoles / USB MIDI) and drives DMX itself (USB-DMX, Art-Net, sACN).
 * services.js: Admin / User mode, the audio host (mixer engine, in-ears, recording), slides outputs
 * (second screen, NDI), the Instrument tab's audio and the lights' optional AI model. */
const { app, BrowserWindow, Menu, ipcMain, shell, session, dialog } = require("electron");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const dns = require("node:dns");

let win = null;

// errors in this (main) process go to the page, which reports them to the Motion Audio website with its own
// (the support email hears about each new kind); they're kept until the page has loaded
const mainErrors = [];
function flushMainErrors() {
  const w = BrowserWindow.getAllWindows().find((x) => !x.isDestroyed() && !x.webContents.isLoading()); if (!w) return;
  while (mainErrors.length) { const x = mainErrors.shift(); w.webContents.executeJavaScript("window.CCReportError && window.CCReportError(" + JSON.stringify(x.message) + "," + JSON.stringify(x.stack) + ",'main')").catch(() => { }); }
}
function mainError(kind, e) { console.error(kind, e); if (mainErrors.length < 20) mainErrors.push({ message: kind + ": " + ((e && e.message) || String(e)), stack: (e && e.stack) || "" }); flushMainErrors(); }
process.on("uncaughtException", (e) => mainError("Crash (main process)", e));
process.on("unhandledRejection", (e) => mainError("Unhandled (main process)", e));
app.on("browser-window-created", (_e, w) => w.webContents.on("did-finish-load", () => setTimeout(flushMainErrors, 3000)));
// Two apps from this code: Central Control (the main admin and admins: lights, slides, lyrics, cameras, in-ears,
// tracks, mixing) and Central Usage (musicians - User 1 / User 2: the chord chart, the instrument, the lyrics, their
// in-ear mix). package.json's "edition" says which ("usage" is set by usage-builder.js when it packs Central Usage).
const EDITION = (() => { try { return require("./package.json").edition === "usage" ? "usage" : "control"; } catch (_) { return "control"; } })();
const APP_NAME = EDITION === "usage" ? "Central Usage" : "Central Control";
process.env.CU_APP_NAME = APP_NAME;   // (the name other gear sees: the audio engine, Art-Net, network audio)
// Central Control keeps the settings folder it always had ("Central Usage", from before the 8.2 rename); Central Usage has its own
if (!app.commandLine.hasSwitch("user-data-dir")) app.setPath("userData", path.join(app.getPath("appData"), EDITION === "usage" ? "Central Usage (musicians)" : "Central Usage"));
app.setName(APP_NAME);

function createWindow() {
  win = new BrowserWindow({
    width: 1180, height: 780, minWidth: 720, minHeight: 480, title: APP_NAME, backgroundColor: "#111317", icon: path.join(__dirname, "build", EDITION === "usage" ? "icon-usage.png" : "icon.png"), autoHideMenuBar: false,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: false, spellcheck: false, additionalArguments: ["--cu-edition=" + EDITION] }
  });
  win.loadFile(path.join(__dirname, "app", "index.html"));
  win.on("closed", () => { win = null; });
  // the Video tab opens its Main output window itself (same renderer, so it can draw into it); other links open in the browser
  win.webContents.setWindowOpenHandler((details) => { const v = videoSvc && videoSvc.windowOpen(details); if (v) return v; shell.openExternal(details.url); return { action: "deny" }; });
}

// Web MIDI, the microphone (tuner) and choosing a speaker are allowed without a prompt - this is our own page
function allowPermissions() {
  const ok = (p) => ["midi", "midiSysex", "media", "notifications", "fullscreen", "speaker-selection", "audioCapture"].includes(p);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(ok(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => ok(permission) || permission === "hid");
  // an Elgato Stream Deck (WebHID, Controls tab) is the app's to use, without asking
  session.defaultSession.on("select-hid-device", (event, details, callback) => { event.preventDefault(); const d = details.deviceList.find((x) => x.vendorId === 0x0fd9); callback(d ? d.deviceId : ""); });
  session.defaultSession.setDevicePermissionHandler((details) => details.deviceType === "hid" && details.device && details.device.vendorId === 0x0fd9);
}

function menu() {
  const send = (name, arg) => { if (win) win.webContents.send("menu", name, arg); };
  const template = [
    { label: "File", submenu: [
      { label: "Connect to a Central Pedal…", accelerator: "CmdOrCtrl+K", click: () => send("connect") },
      { label: "Find Central Pedals on this network", accelerator: "CmdOrCtrl+F", click: () => send("discover") },
      { label: "Enter pairing code…", click: () => send("code") },
      { type: "separator" },
      { label: "Full screen", accelerator: "F11", click: () => { if (win) win.setFullScreen(!win.isFullScreen()); } },
      { type: "separator" }, { role: "quit", label: "Quit " + APP_NAME } ] },
    { label: "View", submenu: [
      { label: "Chord chart", accelerator: "F1", click: () => send("tab", "chart") }, { label: "Lyrics", accelerator: "F2", click: () => send("tab", "lyrics") }, { label: "Lighting", accelerator: "F3", click: () => send("tab", "lights") },
      { label: "Mix", accelerator: "F4", click: () => send("tab", "mix") }, { label: "In-ears", accelerator: "F5", click: () => send("tab", "inears") }, { label: "Slides", accelerator: "F6", click: () => send("tab", "slides") },
      { label: "Instrument", accelerator: "F7", click: () => send("tab", "instrument") }, { label: "I/O", accelerator: "F8", click: () => send("tab", "io") }, { label: "Settings", accelerator: "F9", click: () => send("tab", "settings") },
      { type: "separator" }, { label: "Bigger text", accelerator: "CmdOrCtrl+=", click: () => send("font", 1) }, { label: "Smaller text", accelerator: "CmdOrCtrl+-", click: () => send("font", -1) },
      { type: "separator" }, { role: "reload" }, { role: "toggleDevTools", label: "Developer tools" } ] },
    { label: "Help", submenu: [
      { label: "How it works", click: () => dialog.showMessageBox(win, { type: "info", title: "Central Control", message: "How the computers work together", detail: "1. Set up the main admin first, usually the computer at the sound desk. It gets the inputs and outputs, a 4-digit pairing PIN and its own role PIN. Keep Central Control open on it during the service.\n2. On every other computer, phone and tablet, pick Admin, User 1 or User 2 and type the pairing PIN. It finds the main admin on the network by itself.\n3. The tracks, charts and lyrics come from the main admin's player window (Devices tab → Open the player) or from Central Pedals paired with the same PIN. The Devices tab shows what each one does.\n4. One admin computer is the audio host. It gets the tracks, mixes them, makes the in-ear mixes and records the service.\n5. Only the track player starts, stops and skips the tracks. Everything else follows it." }) },
      { label: "Check for updates…", click: () => send("updates") },
      { label: "Contact technical support…", click: () => win && win.webContents.executeJavaScript("!!(window.PPLicense && PPLicense.on() && (PPLicense.support(), true))").then((ok) => { if (!ok) dialog.showMessageBox(win, { type: "info", title: "Technical support", message: "Technical support opens here once the Motion Audio website is online.", detail: "Until then, use the contact on the download page." }); }).catch(() => { }) },
      { label: "About", click: () => dialog.showMessageBox(win, { type: "info", title: "About", message: APP_NAME + " " + app.getVersion(), detail: (EDITION === "usage" ? "For musicians: the chord chart, your instrument, the lyrics and your in-ear mix." : "For the main admin and admins: lights, slides, lyrics, cameras, in-ears, tracks and mixing.") + " Part of Central Pedal. Electron " + process.versions.electron + " · Chromium " + process.versions.chrome }) } ] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- discovery: every /24 of this computer's interfaces, GET http://ip:8080/api/info, plus padpedal.local
function probe(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.get({ host, port, path: "/api/info", timeout: timeoutMs }, (res) => {
      let body = ""; res.setEncoding("utf8"); res.on("data", (c) => { body += c; if (body.length > 4096) req.destroy(); });
      res.on("end", () => { try { const j = JSON.parse(body); resolve(j && (j.hostname || j.wsPort) ? { host, hostname: j.hostname || host, version: j.version, wsPort: j.wsPort || 8081, code: !!j.code } : null); } catch (_) { resolve(null); } });
    });
    req.on("timeout", () => { req.destroy(); resolve(null); }); req.on("error", () => resolve(null));
  });
}
async function discover() {
  const found = [], seen = new Set();
  const add = (r) => { if (r && !seen.has(r.host)) { seen.add(r.host); found.push(r); } };
  await new Promise((r) => dns.lookup("padpedal.local", { family: 4 }, (err, addr) => { if (!err && addr) probe(addr, 8080, 1500).then((res) => { if (res) add(Object.assign(res, { host: "padpedal.local", ip: addr })); r(); }); else r(); }));
  const nets = os.networkInterfaces(), bases = new Set();
  for (const list of Object.values(nets)) for (const n of list || []) if (n.family === "IPv4" && !n.internal && n.netmask === "255.255.255.0") bases.add(n.address.split(".").slice(0, 3).join("."));
  for (const base of bases) {
    const ips = []; for (let i = 1; i < 255; i++) ips.push(base + "." + i);
    for (let i = 0; i < ips.length; i += 48) await Promise.all(ips.slice(i, i + 48).map((ip) => probe(ip, 8080, 700).then(add)));
  }
  return found;
}
ipcMain.handle("discover", discover);
// ---- DMX output
const dmx = require("./dmx");
ipcMain.handle("dmx-ports", () => dmx.listPorts());
ipcMain.handle("dmx-configure", (_e, cfg) => dmx.configure(cfg));
ipcMain.handle("dmx-status", () => dmx.status());
ipcMain.handle("dmx-blackout", () => { dmx.blackout(); return true; });
ipcMain.on("dmx-frame", (_e, frame) => dmx.sendFrame(frame));
// rig files (fixtures + looks) to share between computers
ipcMain.handle("save-file", async (_e, name, text) => { const r = await dialog.showSaveDialog(win, { defaultPath: name, filters: [{ name: "Central Control rig", extensions: ["json"] }] }); if (r.canceled || !r.filePath) return null; require("node:fs").writeFileSync(r.filePath, text); return r.filePath; });
ipcMain.handle("open-file", async () => { const r = await dialog.showOpenDialog(win, { properties: ["openFile"], filters: [{ name: "Central Control rig", extensions: ["json"] }] }); if (r.canceled || !r.filePaths[0]) return null; return require("node:fs").readFileSync(r.filePaths[0], "utf8"); });
// ---- fixture library: QLC+ fixture definitions on this computer (if QLC+ is installed) and files you pick
const fs = require("node:fs");
const FIXTURE_DIRS = ["/usr/share/qlcplus/fixtures", "/usr/local/share/qlcplus/fixtures", path.join(os.homedir(), ".qlcplus", "fixtures"), path.join(os.homedir(), ".local", "share", "qlcplus", "fixtures")];
let scanned = new Set();
function walk(dir, out, depth) {
  if (depth > 4 || out.length > 20000) return;
  let list = []; try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
  for (const d of list) { const full = path.join(dir, d.name); if (d.isDirectory()) walk(full, out, depth + 1); else if (/\.qxf$/i.test(d.name)) out.push(full); }
}
ipcMain.handle("fixtures-scan", () => {
  const files = []; FIXTURE_DIRS.forEach((d) => walk(d, files, 0)); scanned = new Set(files);
  return files.map((f) => { const base = path.basename(f, ".qxf"), maker = path.basename(path.dirname(f)), model = base.replace(new RegExp("^" + maker.replace(/[^\w]/g, ".") + "[-_ ]?", "i"), "").replace(/[-_]+/g, " "); return { path: f, maker: maker.replace(/[-_]+/g, " "), model: model || base }; });
});
ipcMain.handle("fixtures-read", (_e, file) => { if (!scanned.has(file)) return null; try { return fs.readFileSync(file, "utf8"); } catch (_) { return null; } });
ipcMain.handle("fixtures-open", async () => {
  const r = await dialog.showOpenDialog(win, { title: "Import fixture definitions", properties: ["openFile", "multiSelections"], filters: [{ name: "Fixture definitions (QLC+ .qxf, Open Fixture Library .json)", extensions: ["qxf", "json"] }] });
  if (r.canceled) return [];
  return r.filePaths.slice(0, 200).map((f) => { try { return { name: path.basename(f), text: fs.readFileSync(f, "utf8").slice(0, 2 * 1024 * 1024) }; } catch (_) { return null; } }).filter(Boolean);
});

// ---- phone remote for the lights: a small page on this computer, opened from a phone on the same Wi-Fi
const remote = { server: null, port: 8091, pin: "", state: { looks: [] }, fails: 0, lockUntil: 0 };
const remoteFile = () => path.join(app.getPath("userData"), "remote.json");
try { Object.assign(remote, JSON.parse(fs.readFileSync(remoteFile(), "utf8"))); } catch (_) { }
if (!/^\d{4}$/.test(remote.pin || "")) remote.pin = String(1000 + Math.floor(Math.random() * 9000));
function remoteUrls() { const out = []; for (const list of Object.values(os.networkInterfaces())) for (const n of list || []) if (n.family === "IPv4" && !n.internal) out.push("http://" + n.address + ":" + remote.port + "/"); return out; }
function remoteStatus() { return { enabled: !!remote.server, port: remote.port, pin: remote.pin, urls: remote.server ? remoteUrls() : [] }; }
function stopRemote() { if (remote.server) { try { remote.server.close(); } catch (_) { } remote.server = null; } }
function startRemote() {
  stopRemote();
  const page = fs.readFileSync(path.join(__dirname, "app", "remote.html"), "utf8");
  remote.server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x"), send = (code, body, type) => { res.writeHead(code, { "Content-Type": type || "application/json", "Cache-Control": "no-store" }); res.end(typeof body === "string" ? body : JSON.stringify(body)); };
    if (u.pathname === "/" || u.pathname === "/index.html") return send(200, page, "text/html; charset=utf-8");
    if (!u.pathname.startsWith("/api/")) return send(404, { error: "not found" });
    if (Date.now() < remote.lockUntil) return send(429, { error: "too many wrong codes - wait a minute" });
    if ((u.searchParams.get("pin") || req.headers["x-pin"]) !== remote.pin) { if (++remote.fails >= 8) { remote.lockUntil = Date.now() + 60000; remote.fails = 0; } return send(403, { error: "wrong code" }); }
    remote.fails = 0;
    if (u.pathname === "/api/state") return send(200, remote.state);
    if (u.pathname === "/api/cmd" && req.method === "POST") {
      let body = ""; req.on("data", (c) => { body += c; if (body.length > 4096) req.destroy(); });
      req.on("end", () => { let cmd = null; try { cmd = JSON.parse(body); } catch (_) { } if (!cmd || typeof cmd.cmd !== "string") return send(400, { error: "bad command" }); if (win) win.webContents.send("remote-cmd", cmd); send(200, { ok: true }); });
      return;
    }
    send(404, { error: "not found" });
  });
  remote.server.on("error", () => { remote.server = null; });
  remote.server.listen(remote.port, "0.0.0.0");
}
ipcMain.handle("remote-config", (_e, cfg) => {
  if (cfg && cfg.port) remote.port = Math.max(1024, Math.min(65535, Number(cfg.port) || 8091));
  if (cfg && cfg.newPin) remote.pin = String(1000 + Math.floor(Math.random() * 9000));
  if (cfg && "enabled" in cfg) { if (cfg.enabled) startRemote(); else stopRemote(); }
  try { fs.writeFileSync(remoteFile(), JSON.stringify({ port: remote.port, pin: remote.pin, on: !!(cfg && cfg.enabled) })); } catch (_) { }
  return remoteStatus();
});
ipcMain.handle("remote-status", () => remoteStatus());
ipcMain.on("remote-state", (_e, st) => { remote.state = st; });

// ---- updates: look once a day, install only when asked
const { Updater } = require("./updater");
let updater = null;
function updateEvent() { if (win && updater) win.webContents.send("update", updater.status()); }
ipcMain.handle("update-status", () => updater.status());
ipcMain.handle("update-config", (_e, cfg) => updater.save(cfg));
ipcMain.handle("update-check", async () => { const st = await updater.check(); updateEvent(); return st; });
ipcMain.handle("update-install", async () => {
  try { const r = await updater.install(() => updateEvent()); updateEvent(); if (r === "restart") { app.relaunch(process.env.APPIMAGE ? { execPath: process.env.APPIMAGE } : updater.relaunchExec ? { execPath: updater.relaunchExec } : undefined); app.exit(0); } else if (r === "quit") app.exit(0); return { ok: true, result: r }; }
  catch (e) { updater.error = e.message; updateEvent(); return { ok: false, error: e.message }; }
});

const svc = require("./services")(app, () => win);
// the Video tab: cameras in, Main / Stream out, streaming, NDI, stream audio
const videoSvc = require("./video-service").setup({
  ipcMain, getWin: () => win, userData: app.getPath("userData"), app, screen: require("electron").screen, BrowserWindow,
  mixTap: (fn, on) => svc.streamTap(fn, on),   // the stream mix as the stream's sound, when this computer is the audio host
  binDir: app.isPackaged ? path.join(process.resourcesPath, "native") : path.join(__dirname, "native", "build")
});
if (process.platform === "darwin") app.whenReady().then(() => { try { require("electron").systemPreferences.askForMediaAccess("camera"); } catch (_) { } });
require("./asr").setupAsr({ ipcMain, app, getWin: () => win });
require("./studio").setup({ ipcMain, app, getWin: () => win, binDir: app.isPackaged ? path.join(process.resourcesPath, "native") : path.join(__dirname, "native", "build"),   // the Studio tab: sounds, projects, the low-delay player
  soundsDir: app.isPackaged ? path.join(process.resourcesPath, "sounds") : path.join(__dirname, "native", "sounds") });   // lyrics from a vocal track (speech model on this computer)
app.on("before-quit", () => { try { dmx.blackout(); } catch (_) { } try { svc.stop(); } catch (_) { } });
ipcMain.handle("version", () => ({ app: (() => { try { return require("./package.json").version || app.getVersion(); } catch (_) { return app.getVersion(); } })(), electron: process.versions.electron }));   // (package.json: right however the app was started)
// how this computer is doing, for the main admin's Devices tab
let lastCpu = null;
ipcMain.handle("sys-health", () => {
  const os = require("node:os"), cpus = os.cpus(), t = cpus.reduce((a, c) => { const x = c.times; a.idle += x.idle; a.all += x.user + x.nice + x.sys + x.idle + x.irq; return a; }, { idle: 0, all: 0 });
  let cpu = null; if (lastCpu && t.all > lastCpu.all) cpu = Math.round(100 * (1 - (t.idle - lastCpu.idle) / (t.all - lastCpu.all))); lastCpu = t;
  return { app: app.getVersion(), platform: process.platform, cpu, memFree: Math.round(os.freemem() / 1048576), memTotal: Math.round(os.totalmem() / 1048576), uptime: Math.round(os.uptime()) };
});

app.whenReady().then(() => {
  updater = new Updater({ product: EDITION === "usage" ? "CentralUsage" : ["CentralControl", "central-usage"], current: app.getVersion(), dir: app.getPath("userData") });   // (Central Control's files are CentralControl-* since 9.2.1; releases also carry the old central-usage-* names for apps from before)
  // every time the app opens it looks for a newer release (a few seconds after start), then once a day while it runs
  setTimeout(async function loop(first) { try { if (updater.cfg.auto && (first || updater.due())) { await updater.check(); updateEvent(); } } catch (_) { } setTimeout(loop, 300 * 1000); }, 8000, true);
  try { if (JSON.parse(fs.readFileSync(remoteFile(), "utf8")).on) startRemote(); } catch (_) { }
  allowPermissions(); menu(); createWindow(); svc.start(); app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); }); });
app.on("window-all-closed", () => { app.quit(); });
