/* Central Pedal Control - the Central Pedal app on a Mac: build the setlist, import tracks (MultiTracks.com / Loop
 * Community downloads, your own WAVs), set up the pads, the controls, the instrument and the look anywhere - then
 * ⇪ Upload it all to the Central Pedal (the Raspberry Pi), or ⇩ Download what is on it.
 * It runs the same app and driver as the Pi (simulated board, no GPIO), started here on 127.0.0.1, with its songs
 * in this Mac's settings folder. The driver runs as an editor (CC_PEDAL_CONTROL=1): it never pairs with the main
 * admin as a pedal and never updates itself - this app updates as a whole. */
const { app, BrowserWindow, Menu, session, dialog, shell, ipcMain, systemPreferences } = require("electron");
const { Updater } = require("./updater");
const { spawn, spawnSync } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const net = require("node:net");

if (!app.commandLine.hasSwitch("user-data-dir")) app.setPath("userData", path.join(app.getPath("appData"), "Central Pedal Control"));
app.setName("Central Pedal Control");
const APP_ROOT = app.isPackaged ? path.join(process.resourcesPath, "app") : path.join(__dirname, "src");
const DATA_DIR = path.join(app.getPath("userData"), "data");
const PORT = 8766, EXE = process.platform === "win32" ? ".exe" : "";
const RES = app.isPackaged ? process.resourcesPath : __dirname;
let win = null, driver = null, driverLog = "";

function python() { for (const p of ["python3", "python"]) { try { if (spawnSync(p, ["--version"]).status === 0) return p; } catch (_) { } } return null; }
function bundledDriver() { const f = path.join(RES, app.isPackaged ? "driver" : "driver-dist", "pedal-driver", "pedal-driver" + EXE); return fs.existsSync(f) ? f : null; }
function portOpen(port) { return new Promise((resolve) => { const s = net.connect(port, "127.0.0.1"); s.once("connect", () => { s.destroy(); resolve(true); }); s.once("error", () => resolve(false)); setTimeout(() => { s.destroy(); resolve(false); }, 800); }); }
async function waitFor(port, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await portOpen(port)) return true; await new Promise((r) => setTimeout(r, 200)); } return false; }
async function driverIsOurs() { try { const r = await fetch("http://127.0.0.1:" + PORT + "/api/whoami", { signal: AbortSignal.timeout(1500) }); return r.ok && (await r.json()).pedalControl === true; } catch (_) { return false; } }

async function startDriver() {
  if (await portOpen(PORT)) {
    if (await driverIsOurs()) return true;
    await dialog.showMessageBox({ type: "warning", title: "Central Pedal Control", message: "Central Control's player window is open on this Mac.", detail: "They share the same place on this computer. Close the player window (Central Control → Devices → Stop) and open Central Pedal Control again." });
    return false;
  }
  const bundled = bundledDriver(), py = bundled ? null : python();
  if (!bundled && !py) { dialog.showErrorBox("Something is missing", "This copy of Central Pedal Control has no driver - download it again from the download page."); return false; }
  if (process.platform === "darwin") { try { await systemPreferences.askForMediaAccess("microphone"); } catch (_) { } }   // (the tuner and the instrument hear the interface)
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const log = fs.openSync(path.join(app.getPath("userData"), "driver.log"), "w");
  const args = ["--simulate", DATA_DIR, "--app-root", APP_ROOT], env = Object.assign({}, process.env, { CC_PEDAL_CONTROL: "1" });
  delete env.ELECTRON_RUN_AS_NODE;
  driver = bundled ? spawn(bundled, args, { stdio: ["ignore", log, log], env, windowsHide: true }) : spawn(py, [path.join(APP_ROOT, "pedal-driver.py")].concat(args), { stdio: ["ignore", log, log], env });
  driver.on("exit", (code) => { driver = null; if (win && code) win.setTitle("Central Pedal Control (driver stopped)"); });
  const ok = await waitFor(PORT, 25000);
  if (!ok) { try { driverLog = fs.readFileSync(path.join(app.getPath("userData"), "driver.log"), "utf8").slice(-1500); } catch (_) { } }
  return ok;
}

function createWindow(url) {
  win = new BrowserWindow({
    width: 1366, height: 860, minWidth: 900, minHeight: 600, title: "Central Pedal Control", backgroundColor: "#08111d", icon: path.join(__dirname, "build", "icon.png"), autoHideMenuBar: true,
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
function run(js) { if (win) win.webContents.executeJavaScript(js).catch(() => { }); }
function menu() {
  const go = (tab) => run("window.PPShell && window.PPShell.showTab(" + JSON.stringify(tab) + ")");
  const isMac = process.platform === "darwin";
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: "appMenu" }] : []),
    { label: "File", submenu: [
      { label: "⇪ Upload to a Central Pedal…", accelerator: "CmdOrCtrl+U", click: () => run("window.PPTransfer && window.PPTransfer.open('up')") },
      { label: "⇩ Download from a Central Pedal…", accelerator: "CmdOrCtrl+D", click: () => run("window.PPTransfer && window.PPTransfer.open('down')") },
      { type: "separator" }, { label: "Open the data folder", click: () => shell.openPath(app.getPath("userData")) },
      ...(isMac ? [] : [{ type: "separator" }, { role: "quit" }]) ] },
    { role: "editMenu" },
    { label: "View", submenu: [
      { label: "LIVE", accelerator: "F8", click: () => go("live") }, { label: "Pad", accelerator: "F1", click: () => go("pads") }, { label: "Tracks", accelerator: "F2", click: () => go("tracks") },
      { label: "Instrument", accelerator: "F3", click: () => go("instrument") }, { label: "Configure", accelerator: "F4", click: () => go("configure") }, { label: "Settings", accelerator: "F6", click: () => go("settings") },
      { type: "separator" }, { role: "togglefullscreen" }, { role: "reload" }, { role: "toggleDevTools", label: "Developer tools" } ] },
    { label: "Help", submenu: [
      { label: "Check for updates…", click: async () => { const st = await updater.check(); updateEvent(); dialog.showMessageBox(win, { type: "info", title: "Updates", message: st.available ? "Central Pedal Control " + st.latest + " is available." : "Central Pedal Control is up to date (" + app.getVersion() + ")." }); } },
      { label: "Download page", click: () => shell.openExternal("https://motionaudio.github.io/Central-Apps/") },
      { label: "About", click: () => dialog.showMessageBox(win, { type: "info", title: "About", message: "Central Pedal Control " + app.getVersion(), detail: "The Central Pedal app on this Mac: make the setlist, import tracks, set up pads, controls and the instrument - then Upload them to the Central Pedal.\nElectron " + process.versions.electron }) } ] }
  ]));
}

let updater = null;
function updateEvent() { if (win && updater) win.webContents.send("update", updater.status()); }
ipcMain.handle("update-status", () => updater.status());
ipcMain.handle("update-config", (_e, cfg) => updater.save(cfg));
ipcMain.handle("update-check", async () => { const st = await updater.check(); updateEvent(); return st; });
ipcMain.handle("update-install", async () => {
  try { const r = await updater.install(() => updateEvent()); updateEvent(); if (r === "restart" || r === "quit") { if (driver) { try { driver.kill(); } catch (_) { } } if (r === "restart") app.relaunch(); app.exit(0); } return { ok: true, result: r }; }
  catch (e) { updater.error = e.message; updateEvent(); return { ok: false, error: e.message }; }
});

const firstInstance = app.requestSingleInstanceLock();
if (!firstInstance) app.quit();
app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
app.whenReady().then(async () => {
  if (!firstInstance) return;
  updater = new Updater({ product: "central-pedal-control", current: app.getVersion(), dir: app.getPath("userData") });
  setTimeout(async function loop(first) { try { if (updater.cfg.auto && (first || updater.due())) { await updater.check(); updateEvent(); } } catch (_) { } setTimeout(loop, 300 * 1000); }, 8000, true);
  allowPermissions(); menu();
  const ok = await startDriver();
  createWindow(ok ? "http://127.0.0.1:" + PORT + "/app/#resume" : "file://" + path.join(APP_ROOT, "index.html") + "#resume");
  if (!ok && driverLog) dialog.showMessageBox(win, { type: "warning", title: "The driver did not start", message: "Importing track packs, charts and the library are off. Editing pads, songs and settings and Upload still work.", detail: driverLog });
});
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => { if (driver) { try { driver.kill(); } catch (_) { } } });
