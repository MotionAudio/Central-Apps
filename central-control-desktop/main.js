/* Central Control - the desktop app for a PC (Electron main process). One real
 * application window, no browser chrome. It starts the same driver the Raspberry
 * Pi runs (in simulation mode: no GPIO, but uploads, charts, companion pages on
 * port 8080 and the instrument host all work) and shows the app from it. */
const { app, BrowserWindow, Menu, session, dialog, shell, ipcMain, systemPreferences } = require("electron");
const { Updater } = require("./updater");
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const net = require("node:net");

app.setName("Central Control");
const APP_ROOT = app.isPackaged ? path.join(process.resourcesPath, "app") : path.join(__dirname, "src");
const DATA_DIR = path.join(app.getPath("userData"), "data");
const PORT = 8766;
let win = null, driver = null, driverLog = "";
require("./asr").setupAsr({ ipcMain, app, getWin: () => win });   // lyrics from a vocal track (speech model on this PC)

function python() { for (const p of ["python3", "python"]) { if (spawnSync(p, ["--version"]).status === 0) return p; } return null; }
const EXE = process.platform === "win32" ? ".exe" : "";
const RES = app.isPackaged ? process.resourcesPath : __dirname;
// Windows / macOS: the driver comes bundled (no Python needed); Linux: the system's python3 runs pedal-driver.py
function bundledDriver() { const f = path.join(RES, app.isPackaged ? "driver" : "driver-dist", "pedal-driver", "pedal-driver" + EXE); return fs.existsSync(f) ? f : null; }
// the built-in instrument rig (Windows / macOS; Linux uses PipeWire when it is there)
function rigEnv() {
  const native = path.join(RES, "native"), env = {};
  if (fs.existsSync(path.join(native, "cu-rig" + EXE))) env.CC_RIG_BIN = path.join(native, "cu-rig" + EXE);
  if (fs.existsSync(path.join(native, "rig-map.json"))) env.CC_RIG_MAP = path.join(native, "rig-map.json");
  if (fs.existsSync(path.join(RES, "sounds"))) env.CC_RIG_SOUNDS = path.join(RES, "sounds");
  return env;
}
function portOpen(port) { return new Promise((resolve) => { const s = net.connect(port, "127.0.0.1"); s.once("connect", () => { s.destroy(); resolve(true); }); s.once("error", () => resolve(false)); }); }
async function waitFor(port, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await portOpen(port)) return true; await new Promise((r) => setTimeout(r, 200)); } return false; }

async function startDriver() {
  if (await portOpen(PORT)) return true;  // one is running already (another window, or started by hand)
  const bundled = bundledDriver(), py = bundled ? null : python();
  if (!bundled && !py) { dialog.showErrorBox("Python 3 is needed", "Central Control runs its driver with Python 3 (sudo apt install python3 python3-websockets python3-gpiozero python3-pil python3-evdev)."); return false; }
  if (process.platform === "darwin") { try { await systemPreferences.askForMediaAccess("microphone"); } catch (_) { } }   // the instrument rig and the tuner hear the interface
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const log = fs.openSync(path.join(app.getPath("userData"), "driver.log"), "w");
  const args = ["--simulate", DATA_DIR, "--app-root", APP_ROOT], env = Object.assign({}, process.env, rigEnv());
  driver = bundled ? spawn(bundled, args, { stdio: ["ignore", log, log], env, windowsHide: true }) : spawn(py, [path.join(APP_ROOT, "pedal-driver.py")].concat(args), { stdio: ["ignore", log, log], env, detached: false });
  driver.on("exit", (code) => { driver = null; if (win && code) win.webContents.executeJavaScript('document.title="Central Control (driver stopped)"').catch(() => {}); });
  const ok = await waitFor(PORT, 20000);
  if (!ok) { try { driverLog = fs.readFileSync(path.join(app.getPath("userData"), "driver.log"), "utf8").slice(-1500); } catch (_) {} }
  return ok;
}

function createWindow(url) {
  win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 900, minHeight: 600, title: "Central Control", backgroundColor: "#08111d", icon: path.join(__dirname, "build", "icon.png"), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, backgroundThrottling: false }
  });
  win.loadURL(url);
  win.on("closed", () => { win = null; });
  win.webContents.setWindowOpenHandler(({ url: u }) => { shell.openExternal(u); return { action: "deny" }; });
}

function allowPermissions() {
  const ok = (p) => ["media", "midi", "midiSysex", "notifications", "fullscreen", "clipboard-read", "clipboard-sanitized-write"].includes(p);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(ok(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => ok(permission));
}

function menu() {
  const go = (hash) => { if (win) win.webContents.executeJavaScript("window.PPShell && window.PPShell.showTab(" + JSON.stringify(hash) + ")").catch(() => {}); };
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "File", submenu: [
      { label: "Open the phone / projector pages (port 8080) in a browser", click: () => shell.openExternal("http://127.0.0.1:8080/") },
      { label: "Open the data folder", click: () => shell.openPath(app.getPath("userData")) },
      { type: "separator" }, { label: "Full screen", accelerator: "F11", click: () => { if (win) win.setFullScreen(!win.isFullScreen()); } },
      { type: "separator" }, { role: "quit", label: "Quit Central Control" } ] },
    { label: "View", submenu: [
      { label: "Pad", accelerator: "F1", click: () => go("pads") }, { label: "Tracks", accelerator: "F2", click: () => go("tracks") }, { label: "Instrument", accelerator: "F3", click: () => go("instrument") },
      { label: "Configure", accelerator: "F4", click: () => go("configure") }, { label: "Learn", accelerator: "F5", click: () => go("learn") }, { label: "Settings", accelerator: "F6", click: () => go("settings") },
      { type: "separator" }, { role: "reload" }, { role: "toggleDevTools", label: "Developer tools" } ] },
    { label: "Help", submenu: [
      { label: "About", click: () => dialog.showMessageBox(win, { type: "info", title: "About", message: "Central Control " + app.getVersion() + " (desktop)", detail: "The same app the Raspberry Pi runs, without the control surface: a simulated board (type 'press b1' in the terminal if you start the driver by hand), USB / MIDI pedals, uploads, charts, companion pages on port 8080, and the Instrument tab when PipeWire is running.\nElectron " + process.versions.electron }) } ] }
  ]));
}

// ---- updates of this PC app: looked for once a day, installed only when asked (Settings → Software updates)
let updater = null;
function updateEvent() { if (win && updater) win.webContents.send("update", updater.status()); }
ipcMain.handle("update-status", () => updater.status());
ipcMain.handle("update-config", (_e, cfg) => updater.save(cfg));
ipcMain.handle("update-check", async () => { const st = await updater.check(); updateEvent(); return st; });
ipcMain.handle("update-install", async () => {
  try { const r = await updater.install(() => updateEvent()); updateEvent(); if (r === "restart") { if (driver) { try { driver.kill(); } catch (_) {} } app.relaunch(process.env.APPIMAGE ? { execPath: process.env.APPIMAGE } : undefined); app.exit(0); } else if (r === "quit") { if (driver) { try { driver.kill(); } catch (_) { } } app.exit(0); } return { ok: true, result: r }; }
  catch (e) { updater.error = e.message; updateEvent(); return { ok: false, error: e.message }; }
});

app.whenReady().then(async () => {
  updater = new Updater({ product: "central-control", current: app.getVersion(), dir: app.getPath("userData") });
  setTimeout(async function loop() { try { if (updater.due()) { await updater.check(); updateEvent(); } } catch (_) {} setTimeout(loop, 3600 * 1000); }, 60 * 1000);
  allowPermissions(); menu();
  const ok = await startDriver();
  createWindow(ok ? "http://127.0.0.1:" + PORT + "/app/#resume" : "file://" + path.join(APP_ROOT, "index.html") + "#resume");
  if (!ok) dialog.showMessageBox(win, { type: "warning", title: "Driver did not start", message: "The driver (pedal-driver.py) could not be started, so uploads, charts, companion pages and the Instrument tab are off. The pads and tracks still work.", detail: driverLog || "Check ~/.config/central-control/driver.log and that python3-websockets, python3-gpiozero, python3-pil and python3-evdev are installed." });
});
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => { if (driver) { try { driver.kill(); } catch (_) {} } });
