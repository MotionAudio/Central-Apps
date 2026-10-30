/* Central Services - the church's schedule as an app on a Mac, Windows or Linux computer. It shows the same page as
 * the website's /services/ (bundled in src/, so it opens fast), talking to the Motion Audio website: sign in and the
 * account says who you are - a scheduler (the main admin and up to 3 more) or a team member.
 * Updates: it looks every time it opens (and once a day); a new version found when it opens installs by itself after
 * a 10-second notice in the window (⚙ App turns that off). Everything is on the website, so an update loses nothing. */
const { app, BrowserWindow, Menu, shell, ipcMain, dialog } = require("electron");
const { Updater } = require("./updater");
const path = require("node:path");

if (!app.commandLine.hasSwitch("user-data-dir")) app.setPath("userData", path.join(app.getPath("appData"), "Central Services"));
app.setName("Central Services");
const SRC = app.isPackaged ? path.join(process.resourcesPath, "app") : path.join(__dirname, "src");
let win = null, updater = null;

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

function updateEvent() { if (win && updater) win.webContents.send("update", updater.status()); }
ipcMain.handle("update-status", () => updater.status());
ipcMain.handle("update-config", (_e, cfg) => updater.save(cfg));
ipcMain.handle("update-check", async () => { const st = await updater.check(); updateEvent(); return st; });
ipcMain.handle("update-install", async () => {
  try {
    const r = await updater.install(() => updateEvent()); updateEvent();
    if (r === "restart") { app.relaunch(process.env.APPIMAGE ? { execPath: process.env.APPIMAGE } : updater.relaunchExec ? { execPath: updater.relaunchExec } : undefined); app.exit(0); } else if (r === "quit") app.exit(0);
    return { ok: true, result: r };
  } catch (e) { updater.error = e.message; updateEvent(); return { ok: false, error: e.message }; }
});

function createWindow() {
  win = new BrowserWindow({
    width: 1180, height: 820, minWidth: 380, minHeight: 520, title: "Central Services", backgroundColor: "#111317", icon: path.join(__dirname, "build", "icon.png"), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true }
  });
  win.loadFile(path.join(SRC, "index.html"));
  win.on("closed", () => { win = null; });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith("file:")) { e.preventDefault(); shell.openExternal(url); } });
}
function menu() {
  const isMac = process.platform === "darwin";
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: "appMenu" }] : []),
    { label: "File", submenu: [{ label: "Refresh", accelerator: "CmdOrCtrl+R", click: () => win && win.webContents.executeJavaScript("window.CentralServices && CentralServices.load()").catch(() => { }) }, ...(isMac ? [] : [{ type: "separator" }, { role: "quit" }])] },
    { role: "editMenu" },
    { label: "View", submenu: [{ role: "zoomIn" }, { role: "zoomOut" }, { role: "resetZoom" }, { type: "separator" }, { role: "togglefullscreen" }, { role: "toggleDevTools", label: "Developer tools" }] },
    { label: "Help", submenu: [
      { label: "Check for updates…", click: async () => { const st = await updater.check(); updateEvent(); dialog.showMessageBox(win, { type: "info", title: "Updates", message: st.available ? "Central Services " + st.latest + " is available - ⚙ App installs it." : st.error ? st.error : "Central Services is up to date (" + app.getVersion() + ")." }); } },
      { label: "Contact technical support…", click: () => win && win.webContents.executeJavaScript("window.CentralServices && CentralServices.support()").catch(() => { }) },
      { label: "Download page", click: () => (win ? win.webContents.executeJavaScript("window.CS_SERVER || ''") : Promise.resolve("")).catch(() => "").then((s) => shell.openExternal(/^https:\/\//.test(s) ? s.replace(/\/+$/, "") + "/#downloads" : "https://motionaudio.github.io/Central-Apps/")) }] }   // (the website's Downloads page once it's open)
  ]));
}

const firstInstance = app.requestSingleInstanceLock();
if (!firstInstance) app.quit();
app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); } });
app.whenReady().then(() => {
  if (!firstInstance) return;
  updater = new Updater({ product: "central-services", current: app.getVersion(), dir: app.getPath("userData") });
  // every time the app opens it looks for a newer release (a few seconds after start), then once a day while it runs
  setTimeout(async function loop(first) { try { if (updater.cfg.auto && (first || updater.due())) { await updater.check(); updateEvent(); } } catch (_) { } setTimeout(loop, 300 * 1000); }, 5000, true);
  menu(); createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => app.quit());
