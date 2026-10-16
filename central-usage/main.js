/* Central Usage - the desktop app (Electron main process). A real application
 * window: no browser chrome, its own menu, launcher entry and installer.
 * It finds the Central Control (Raspberry Pi) on the Wi-Fi, gives the page Web MIDI
 * (Lightkey / consoles / USB MIDI) and drives DMX itself (USB-DMX, Art-Net, sACN). */
const { app, BrowserWindow, Menu, ipcMain, shell, session, dialog } = require("electron");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const dns = require("node:dns");

let win = null;
app.setName("Central Usage");

function createWindow() {
  win = new BrowserWindow({
    width: 1180, height: 780, minWidth: 720, minHeight: 480, title: "Central Usage", backgroundColor: "#08111d", icon: path.join(__dirname, "build", "icon.png"), autoHideMenuBar: false,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: false, spellcheck: false }
  });
  win.loadFile(path.join(__dirname, "app", "index.html"));
  win.on("closed", () => { win = null; });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
}

// Web MIDI (and the microphone, for a future tuner) are allowed without a prompt - this is our own page
function allowPermissions() {
  const ok = (p) => ["midi", "midiSysex", "media", "notifications", "fullscreen"].includes(p);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(ok(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => ok(permission));
}

function menu() {
  const send = (name, arg) => { if (win) win.webContents.send("menu", name, arg); };
  const template = [
    { label: "File", submenu: [
      { label: "Connect to a Central Control…", accelerator: "CmdOrCtrl+K", click: () => send("connect") },
      { label: "Find Central Controls on this network", accelerator: "CmdOrCtrl+F", click: () => send("discover") },
      { label: "Enter pairing code…", click: () => send("code") },
      { type: "separator" },
      { label: "Full screen", accelerator: "F11", click: () => { if (win) win.setFullScreen(!win.isFullScreen()); } },
      { type: "separator" }, { role: "quit", label: "Quit Central Usage" } ] },
    { label: "View", submenu: [
      { label: "Chord chart", accelerator: "F1", click: () => send("tab", "chart") }, { label: "Lyrics", accelerator: "F2", click: () => send("tab", "lyrics") }, { label: "Lighting", accelerator: "F3", click: () => send("tab", "lights") },
      { type: "separator" }, { label: "Bigger text", accelerator: "CmdOrCtrl+=", click: () => send("font", 1) }, { label: "Smaller text", accelerator: "CmdOrCtrl+-", click: () => send("font", -1) },
      { type: "separator" }, { role: "reload" }, { role: "toggleDevTools", label: "Developer tools" } ] },
    { label: "Help", submenu: [
      { label: "How it works", click: () => dialog.showMessageBox(win, { type: "info", title: "Central Usage", message: "Central Usage shows what the Central Control is doing.", detail: "1. Put this computer on the same Wi-Fi as the Central Control.\n2. File → Find (or type padpedal.local) and connect.\n3. Chord chart: pick your instrument - guitar with capo and shapes, B♭ / E♭ / F horns, Nashville numbers; it follows the song and the section.\n4. Lyrics: words only, big.\n5. Lighting: pick the MIDI output that your lighting software or console listens to (Lightkey: a MIDI port in MIDI mode). The Pi's hits, section notes and clock arrive over Wi-Fi, lined up with the tracks, and go out that port.\n\nControlling the Pi (jump to a section, play / pause) needs the 4-digit pairing code shown in its Settings." }) },
      { label: "Check for updates…", click: () => send("updates") },
      { label: "About", click: () => dialog.showMessageBox(win, { type: "info", title: "About", message: "Central Usage " + app.getVersion(), detail: "Companion app for Central Control. Electron " + process.versions.electron + " · Chromium " + process.versions.chrome }) } ] }
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
ipcMain.handle("save-file", async (_e, name, text) => { const r = await dialog.showSaveDialog(win, { defaultPath: name, filters: [{ name: "Central Usage rig", extensions: ["json"] }] }); if (r.canceled || !r.filePath) return null; require("node:fs").writeFileSync(r.filePath, text); return r.filePath; });
ipcMain.handle("open-file", async () => { const r = await dialog.showOpenDialog(win, { properties: ["openFile"], filters: [{ name: "Central Usage rig", extensions: ["json"] }] }); if (r.canceled || !r.filePaths[0]) return null; return require("node:fs").readFileSync(r.filePaths[0], "utf8"); });
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
  try { const r = await updater.install(() => updateEvent()); updateEvent(); if (r === "restart") { app.relaunch(process.env.APPIMAGE ? { execPath: process.env.APPIMAGE } : undefined); app.exit(0); } return { ok: true, result: r }; }
  catch (e) { updater.error = e.message; updateEvent(); return { ok: false, error: e.message }; }
});

app.on("before-quit", () => { try { dmx.blackout(); } catch (_) { } });
ipcMain.handle("version", () => ({ app: app.getVersion(), electron: process.versions.electron }));

app.whenReady().then(() => {
  updater = new Updater({ product: "central-usage", current: app.getVersion(), dir: app.getPath("userData") });
  setTimeout(async function loop() { try { if (updater.due()) { await updater.check(); updateEvent(); } } catch (_) { } setTimeout(loop, 3600 * 1000); }, 60 * 1000);
  try { if (JSON.parse(fs.readFileSync(remoteFile(), "utf8")).on) startRemote(); } catch (_) { }
  allowPermissions(); menu(); createWindow(); app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); }); });
app.on("window-all-closed", () => { app.quit(); });
