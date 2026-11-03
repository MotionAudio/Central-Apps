/* Central Production - the app on a Mac, Windows or Linux computer: the same page as the website's /production/ (bundled
 * in src/, so it works offline), with what only a computer can do:
 *   projects as .cmproj files on disk (File → Save, a list of recent ones; double-clicking a .cmproj opens it here),
 *   the sound libraries of your sound plans installed here (Settings → Sound plans, the same as the other apps), and the
 *   computer's SoundFonts, the low-delay player (cu-studio) for what you play on a MIDI keyboard,
 *   "Install into my apps": what you made goes straight into Central Control and Central Usage on this computer too,
 *   updates by itself from the releases, like the other apps.
 * The page talks to the Motion Audio website (the address in Settings → Website) for signing in, account projects and
 * publishing. */
"use strict";
const { app, BrowserWindow, Menu, shell, ipcMain, dialog, net } = require("electron");
const path = require("node:path"), fs = require("node:fs"), os = require("node:os"), crypto = require("node:crypto");
const { Updater } = require("./updater");
const { Libraries } = require("./libraries");

if (!app.commandLine.hasSwitch("user-data-dir")) app.setPath("userData", path.join(app.getPath("appData"), "Central Production"));
app.setName("Central Production");
const SRC = app.isPackaged ? path.join(process.resourcesPath, "app-src") : path.join(__dirname, "src");
const RES = app.isPackaged ? process.resourcesPath : __dirname;
const userData = () => app.getPath("userData");
let win = null, updater = null, pending = null;

// ---- settings: the website's address (empty: not set yet - the default packages work, nothing online)
const cfgFile = () => path.join(userData(), "production.json");
function cfg() { try { return JSON.parse(fs.readFileSync(cfgFile(), "utf8")); } catch (_) { return {}; } }
function setCfg(c) { fs.mkdirSync(userData(), { recursive: true }); fs.writeFileSync(cfgFile(), JSON.stringify(Object.assign(cfg(), c), null, 1)); }
function defaultServer() { try { const m = /var SERVER = "([^"]*)"/.exec(fs.readFileSync(path.join(SRC, "production", "shared", "license.js"), "utf8")); return m ? m[1] : ""; } catch (_) { return ""; } }
function server() { const c = cfg(); return String(c.server != null ? c.server : defaultServer()).replace(/\/+$/, ""); }
ipcMain.on("cp-server", (e) => { e.returnValue = server(); });
ipcMain.on("cp-version", (e) => { e.returnValue = app.getVersion(); });
ipcMain.handle("cp-set-server", (_e, v) => { setCfg({ server: String(v || "").trim() }); return server(); });

// ---- files straight to and from storage (signed links; the app sends them itself)
ipcMain.handle("cp-put", async (_e, url, data, type) => { if (!/^https?:\/\//.test(url)) throw new Error("not a web address"); const r = await net.fetch(url, { method: "PUT", body: Buffer.from(data), headers: { "Content-Type": type || "application/octet-stream" } }); if (!r.ok) throw new Error("The upload didn't go through (" + r.status + "). Try again."); return true; });
ipcMain.handle("cp-get", async (_e, url) => { if (!/^https?:\/\//.test(url)) throw new Error("not a web address"); const r = await net.fetch(url); if (!r.ok) throw new Error("The download didn't come (" + r.status + ")."); return Buffer.from(await r.arrayBuffer()); });
ipcMain.handle("cp-open-external", (_e, url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); });

// ---- projects on disk: <Documents>/Central Production/<name>.cmproj by default, any file you pick; a list of recent ones
const recentFile = () => path.join(userData(), "recent.json");
function recent() { try { return JSON.parse(fs.readFileSync(recentFile(), "utf8")).filter((e) => e && e.path && fs.existsSync(e.path)); } catch (_) { return []; } }
function remember(e) { const l = recent().filter((x) => x.id !== e.id && x.path !== e.path); l.unshift(e); fs.mkdirSync(userData(), { recursive: true }); fs.writeFileSync(recentFile(), JSON.stringify(l.slice(0, 40), null, 1)); }
const safe = (s) => String(s || "Untitled").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "").trim().slice(0, 100) || "Untitled";
function projectsDir() { const d = path.join(app.getPath("documents"), "Central Production"); fs.mkdirSync(d, { recursive: true }); return d; }
function writeAtomic(f, bytes) { const tmp = f + ".saving"; fs.writeFileSync(tmp, Buffer.from(bytes)); fs.renameSync(tmp, f); }
ipcMain.handle("cp-recent", () => recent());
ipcMain.handle("cp-save-project", (_e, entry, bytes) => {
  let f = entry.path && fs.existsSync(path.dirname(entry.path)) ? entry.path : null;
  if (!f) { const known = recent().find((x) => x.id === entry.id); f = known ? known.path : null; }
  if (!f) { f = path.join(projectsDir(), safe(entry.name) + ".cmproj"); let n = 2; while (fs.existsSync(f)) f = path.join(projectsDir(), safe(entry.name) + " " + n++ + ".cmproj"); }
  writeAtomic(f, bytes); const e = { id: entry.id, name: entry.name, type: entry.type, savedAt: Date.now(), path: f }; remember(e); return e;
});
ipcMain.handle("cp-open-recent", (_e, id) => { const e = recent().find((x) => x.id === id); if (!e) throw new Error("That project isn't on this computer any more."); return { entry: e, bytes: fs.readFileSync(e.path) }; });
ipcMain.handle("cp-forget-recent", (_e, id) => { fs.writeFileSync(recentFile(), JSON.stringify(recent().filter((x) => x.id !== id), null, 1)); return true; });
ipcMain.handle("cp-save-as", async (_e, name, bytes) => { const r = await dialog.showSaveDialog(win, { defaultPath: path.join(projectsDir(), safe(name)), filters: [{ name: "Central Production project", extensions: ["cmproj"] }] }); if (r.canceled || !r.filePath) return null; writeAtomic(r.filePath, bytes); return { path: r.filePath }; });
ipcMain.handle("cp-open-file", async () => { const r = await dialog.showOpenDialog(win, { defaultPath: projectsDir(), properties: ["openFile"], filters: [{ name: "Central Production project", extensions: ["cmproj", "zip"] }] }); if (r.canceled || !r.filePaths[0]) return null; return { path: r.filePaths[0], bytes: fs.readFileSync(r.filePaths[0]) }; });
ipcMain.handle("cp-export", async (_e, folder, files) => {
  if (files.length === 1) { const ext = path.extname(files[0].name).slice(1) || "wav"; const r = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath("music") || os.homedir(), files[0].name), filters: [{ name: ext.toUpperCase(), extensions: [ext] }] }); if (r.canceled || !r.filePath) return null; fs.writeFileSync(r.filePath, Buffer.from(files[0].data)); return r.filePath; }
  const r = await dialog.showOpenDialog(win, { title: "Pick a folder", defaultPath: app.getPath("music") || os.homedir(), properties: ["openDirectory", "createDirectory"] }); if (r.canceled || !r.filePaths[0]) return null;
  const dir = path.join(r.filePaths[0], safe(folder)); for (const f of files) { const out = path.join(dir, f.name.split("/").map(safe).join(path.sep)); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, Buffer.from(f.data)); } return dir;
});
ipcMain.handle("cp-pending-file", () => { const p = pending; pending = null; return p; });
function openCmproj(f) { try { const msg = { path: f, bytes: fs.readFileSync(f) }; if (win && !win.webContents.isLoading()) win.webContents.send("cp-open-file", msg); else pending = msg; } catch (_) { } }
const fileArg = (argv) => argv.slice(1).find((a) => /\.cmproj$/i.test(a) && fs.existsSync(a));

// ---- the sound libraries (the same as Central Control and Central Usage) and what you make, into your apps
let libs = null;
function libsHere() { if (!libs) libs = new Libraries({ dir: userData() }); return libs; }
const libOut = (installed) => ({ ok: true, installed: libsHere().listing(), last: installed && installed.id });
ipcMain.handle("lib-list", () => ({ ok: true, installed: libsHere().listing(), progress: libsHere().progress }));
ipcMain.handle("lib-cmfx", () => libsHere().centralFx());
ipcMain.handle("lib-index", async () => { try { return await libsHere().index(); } catch (e) { return { ok: false, error: e.message, libraries: [] }; } });
ipcMain.handle("lib-install", async (_e, a) => { a = a || {}; try { return libOut(await libsHere().installUrl(String(a.url || ""), String(a.sha256 || ""), String(a.id || "library"), Number(a.size) || 0, (p) => win && win.webContents.send("lib-progress", { id: a.id, done: p.done, total: p.total, state: p.state }))); } catch (e) { return { ok: false, error: e.message, installed: libsHere().listing() }; } });
ipcMain.handle("lib-install-file", async () => { const r = await dialog.showOpenDialog(win, { properties: ["openFile"], filters: [{ name: "Sound library", extensions: ["zip"] }] }); if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true, installed: libsHere().listing() }; try { return libOut(libsHere().installFile(r.filePaths[0], null, "file")); } catch (e) { return { ok: false, error: e.message, installed: libsHere().listing() }; } });
ipcMain.handle("lib-remove", (_e, id) => { try { libsHere().remove(String(id || "")); return libOut(null); } catch (e) { return { ok: false, error: e.message, installed: libsHere().listing() }; } });
ipcMain.handle("lib-community", (_e, a) => { a = a || {}; if (a.set != null) libsHere().setPluginsAllowed(!!a.set); return { ok: true, on: libsHere().pluginsAllowed() }; });
// Install into my apps: this app, Central Control and Central Usage on this computer (the ones that have been opened here)
ipcMain.handle("cp-install-personal", (_e, bytes, name) => {
  const tmp = path.join(os.tmpdir(), "cp-" + crypto.randomBytes(5).toString("hex") + ".zip"); fs.writeFileSync(tmp, Buffer.from(bytes));
  const targets = [["Central Production", userData()], ["Central Control", path.join(app.getPath("appData"), "Central Usage")], ["Central Usage", path.join(app.getPath("appData"), "Central Usage (musicians)")]], apps = [];
  try {
    for (const [label, dir] of targets) { if (label !== "Central Production" && !fs.existsSync(dir)) continue; try { new Libraries({ dir }).installFile(tmp, null, "personal"); apps.push(label); } catch (e) { if (label === "Central Production") throw e; } }
    const keep = path.join(projectsDir(), "For the Central Pedal"); fs.mkdirSync(keep, { recursive: true }); const saved = path.join(keep, safe(name)); fs.copyFileSync(tmp, saved);
    return { ok: true, apps, saved };
  } catch (e) { return { ok: false, error: e.message }; } finally { try { fs.unlinkSync(tmp); } catch (_) { } }
});
ipcMain.handle("cp-save-song", (_e, name, bytes) => { const d = path.join(projectsDir(), "Central Tracks songs"); fs.mkdirSync(d, { recursive: true }); const f = path.join(d, safe(name)); fs.writeFileSync(f, Buffer.from(bytes)); return f; });
// loops of the installed libraries, for the DAW's browser
const loopOk = new Set();
ipcMain.handle("cp-loops", () => { const out = []; for (const r of libsHere().installed()) for (const l of r.loops || []) if (l && l.file) { loopOk.add(path.resolve(l.file)); out.push({ id: r.id + ":" + path.basename(l.file), name: l.name, group: r.personal ? "Made by you" : (r.title || r.id), bpm: l.bpm || 0, key: l.key || "", bars: l.bars || 0, file: l.file }); } return out; });
ipcMain.handle("cp-read-loop", (_e, f) => { const p = path.resolve(String(f || "")); if (!loopOk.has(p)) throw new Error("not a library loop"); return fs.readFileSync(p); });

// ---- sounds on this computer and the low-delay player: the same code as Central Usage's Studio (studio.js)
require("./studio").setup({ ipcMain, app, getWin: () => win, binDir: app.isPackaged ? path.join(RES, "native") : path.join(__dirname, "..", "central-usage", "native", "build"),
  soundsDir: app.isPackaged ? path.join(RES, "sounds") : path.join(__dirname, "..", "central-usage", "native", "sounds") });

// ---- updates (the same as the other apps)
function updateEvent() { if (win && updater) win.webContents.send("update", updater.status()); }
ipcMain.handle("update-status", () => updater.status());
ipcMain.handle("update-config", (_e, c) => updater.save(c));
ipcMain.handle("update-check", async () => { const st = await updater.check(); updateEvent(); return st; });
ipcMain.handle("update-install", async () => {
  try { const r = await updater.install(() => updateEvent()); updateEvent(); if (r === "restart") { app.relaunch(process.env.APPIMAGE ? { execPath: process.env.APPIMAGE } : updater.relaunchExec ? { execPath: updater.relaunchExec } : undefined); app.exit(0); } else if (r === "quit") app.exit(0); return { ok: true, result: r }; }
  catch (e) { updater.error = e.message; updateEvent(); return { ok: false, error: e.message }; }
});

function createWindow() {
  win = new BrowserWindow({ width: 1440, height: 900, minWidth: 900, minHeight: 600, title: "Central Production", backgroundColor: "#111317", icon: path.join(__dirname, "build", "icon.png"), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: false, spellcheck: false, autoplayPolicy: "no-user-gesture-required" } });
  win.loadFile(path.join(SRC, "production", "index.html"));
  win.on("closed", () => { win = null; });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith("file:")) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  win.webContents.session.setPermissionRequestHandler((_wc, perm, cb) => cb(["media", "midi", "midiSysex"].includes(perm)));   // (the microphone / interface and MIDI keyboards)
  win.on("close", (e) => { if (win.__closing) return; e.preventDefault(); win.webContents.executeJavaScript("!!(window.CP && CP.isDirty())").then((dirty) => { if (!dirty) { win.__closing = true; win.close(); return; } const c = dialog.showMessageBoxSync(win, { type: "question", buttons: ["Save", "Don't save", "Cancel"], defaultId: 0, cancelId: 2, message: "Save your changes before you close?", detail: "Your work is also kept every few seconds, and the app offers it back if it closes unexpectedly." }); if (c === 2) return; if (c === 1) { win.__closing = true; win.close(); return; } win.webContents.executeJavaScript("CP.save()").then(() => { win.__closing = true; win.close(); }); }).catch(() => { win.__closing = true; win.close(); }); });
}
function menu() {
  const isMac = process.platform === "darwin", js = (s) => () => win && win.webContents.executeJavaScript(s).catch(() => { });
  Menu.setApplicationMenu(Menu.buildFromTemplate([...(isMac ? [{ role: "appMenu" }] : []),
    { label: "File", submenu: [{ label: "New project…", accelerator: "CmdOrCtrl+N", click: js("CP.newDialog()") }, { label: "Open…", accelerator: "CmdOrCtrl+O", click: js("CP.load && document.getElementById('cpFile').click()") }, { label: "Save", accelerator: "CmdOrCtrl+S", click: js("CP.save()") }, { label: "Save to my account", accelerator: "CmdOrCtrl+Shift+S", click: js("CP.saveCloud()") }, ...(isMac ? [] : [{ type: "separator" }, { role: "quit" }])] },
    { role: "editMenu" },
    { label: "View", submenu: [{ role: "zoomIn" }, { role: "zoomOut" }, { role: "resetZoom" }, { type: "separator" }, { role: "togglefullscreen" }, { role: "toggleDevTools", label: "Developer tools" }] },
    { label: "Help", submenu: [{ label: "Check for updates…", click: async () => { const st = await updater.check(); updateEvent(); dialog.showMessageBox(win, { type: "info", title: "Updates", message: st.available ? "Central Production " + st.latest + " is ready: Settings → Updates installs it." : st.error ? st.error : "Central Production is up to date (" + app.getVersion() + ")." }); } }] }]));
}

const first = app.requestSingleInstanceLock();
if (!first) app.quit();
app.on("second-instance", (_e, argv) => { const f = fileArg(argv); if (f) openCmproj(f); if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on("open-file", (e, f) => { e.preventDefault(); openCmproj(f); });   // (macOS: a .cmproj double-clicked)
app.whenReady().then(() => {
  if (!first) return;
  updater = new Updater({ product: "central-production", current: app.getVersion(), dir: userData() });
  setTimeout(async function loop(firstTime) { try { if (updater.cfg.auto && (firstTime || updater.due())) { await updater.check(); updateEvent(); } } catch (_) { } setTimeout(loop, 300 * 1000); }, 6000, true);
  const f = fileArg(process.argv); if (f) pending = { path: f, bytes: fs.readFileSync(f) };
  menu(); createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on("window-all-closed", () => app.quit());
