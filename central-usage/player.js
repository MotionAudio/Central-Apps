/* Central Control - the player window (main admin only): the Central Pedal app, built into Central Control, so the
 * main admin's computer runs the tracks, chord charts and lyrics when no Central Pedal (Raspberry Pi) plays them.
 * It is the same app and driver the Pi runs (simulated board: no GPIO), started here on 127.0.0.1:8766, with its
 * songs in this computer's settings folder (player/). It pairs with the center on this computer by itself (the main
 * admin's pairing PIN), so the Devices tab lists it as "Player window"; every Central Control follows it while it is
 * the track player.
 *   packaged: resources/player (the app) + resources/driver/pedal-driver/pedal-driver[.exe] (no Python needed)
 *   from the source tree: ../ (the repository) with python3 */
"use strict";
const { BrowserWindow, dialog, shell, session } = require("electron");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const PORT = 8766, EXE = process.platform === "win32" ? ".exe" : "";

function setup({ app, ipcMain, getMainWin, center }) {
  const RES = app.isPackaged ? process.resourcesPath : __dirname;
  const APP_ROOT = app.isPackaged ? path.join(process.resourcesPath, "player") : path.resolve(__dirname, "..");
  const DATA = path.join(app.getPath("userData"), "player");
  const LOG = path.join(app.getPath("userData"), "player-driver.log");
  let driver = null, win = null, starting = null, lastError = "";

  function bundled() {
    const f = app.isPackaged ? path.join(RES, "driver", "pedal-driver", "pedal-driver" + EXE) : path.join(__dirname, "driver-dist", "pedal-driver", "pedal-driver" + EXE);
    return fs.existsSync(f) ? f : null;
  }
  function python() { for (const p of ["python3", "python"]) { try { if (spawnSync(p, ["--version"]).status === 0) return p; } catch (_) { } } return null; }
  function available() { return fs.existsSync(path.join(APP_ROOT, "pedal-driver.py")) && fs.existsSync(path.join(APP_ROOT, "index.html")) && !!(bundled() || python()); }
  function portOpen(port) { return new Promise((resolve) => { const s = net.connect(port, "127.0.0.1"); s.once("connect", () => { s.destroy(); resolve(true); }); s.once("error", () => resolve(false)); setTimeout(() => { s.destroy(); resolve(false); }, 800); }); }
  async function waitFor(port, ms) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await portOpen(port)) return true; await new Promise((r) => setTimeout(r, 250)); } return false; }
  // the instrument rig and its sounds come with Central Control (the same helpers the Instrument tab uses)
  function rigEnv() {
    const env = {}, native = app.isPackaged ? path.join(RES, "native") : path.join(__dirname, "native", "build"), sounds = app.isPackaged ? path.join(RES, "sounds") : path.join(__dirname, "native", "sounds");
    if (fs.existsSync(path.join(native, "cu-rig" + EXE))) env.CC_RIG_BIN = path.join(native, "cu-rig" + EXE);
    if (fs.existsSync(path.join(native, "rig-map.json"))) env.CC_RIG_MAP = path.join(native, "rig-map.json");
    if (fs.existsSync(sounds)) env.CC_RIG_SOUNDS = sounds;
    return env;
  }
  async function startDriver(pin) {
    if (driver && driver.exitCode == null) return true;
    if (await portOpen(PORT)) return true;   // (one is running already)
    const exe = bundled(), py = exe ? null : python();
    if (!exe && !py) { lastError = "The player needs Python 3 on this computer (sudo apt install python3 python3-websockets python3-pil)."; return false; }
    fs.mkdirSync(DATA, { recursive: true });
    const log = fs.openSync(LOG, "w");
    const env = Object.assign({}, process.env, rigEnv(), { CC_CENTER: "127.0.0.1:" + center.port(), CC_PLAYER: "1" });
    if (/^\d{4}$/.test(String(pin || ""))) env.CC_PAIR_PIN = String(pin);
    delete env.ELECTRON_RUN_AS_NODE;
    const args = ["--simulate", DATA, "--app-root", APP_ROOT];
    driver = exe ? spawn(exe, args, { stdio: ["ignore", log, log], env, windowsHide: true }) : spawn(py, [path.join(APP_ROOT, "pedal-driver.py")].concat(args), { stdio: ["ignore", log, log], env, windowsHide: true });
    driver.on("exit", (code) => { driver = null; if (win && !win.isDestroyed()) win.setTitle("Central Pedal player - stopped" + (code ? " (" + code + ")" : "")); send(); });
    const ok = await waitFor(PORT, 25000);
    if (!ok) { try { lastError = "The player did not start: " + fs.readFileSync(LOG, "utf8").slice(-600); } catch (_) { lastError = "The player did not start."; } }
    return ok;
  }
  function stopDriver() { if (driver) { try { driver.kill(); } catch (_) { } driver = null; } }
  function send() { const w = getMainWin(); if (w && !w.isDestroyed()) w.webContents.send("player-status", status()); }
  function status() { return { available: available(), running: !!(driver && driver.exitCode == null), window: !!(win && !win.isDestroyed()), error: lastError || null }; }

  async function open(pin) {
    if (win && !win.isDestroyed()) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); return { ok: true, already: true }; }
    if (!available()) return { ok: false, error: "The player is not part of this copy of Central Control - reinstall it from the download page." };
    if (starting) return starting;
    starting = (async () => {
      lastError = "";
      const ok = await startDriver(pin);
      if (!ok) { send(); return { ok: false, error: lastError }; }
      const ses = session.fromPartition("persist:player");
      const allow = (p) => ["media", "midi", "midiSysex", "fullscreen", "clipboard-read", "clipboard-sanitized-write"].includes(p);
      ses.setPermissionRequestHandler((_wc, p, cb) => cb(allow(p))); ses.setPermissionCheckHandler((_wc, p) => allow(p) || p === "hid");
      // an Elgato Stream Deck (WebHID) on this computer works the player's keys, without asking
      if (!ses.__hid) { ses.__hid = true; ses.on("select-hid-device", (event, details, callback) => { event.preventDefault(); const d = details.deviceList.find((x) => x.vendorId === 0x0fd9); callback(d ? d.deviceId : ""); }); ses.setDevicePermissionHandler((d) => d.deviceType === "hid" && d.device && d.device.vendorId === 0x0fd9); }
      win = new BrowserWindow({
        width: 1280, height: 800, minWidth: 900, minHeight: 600, title: "Central Pedal player", backgroundColor: "#111317", autoHideMenuBar: true,
        icon: path.join(__dirname, "build", "icon.png"),
        webPreferences: { partition: "persist:player", contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, backgroundThrottling: false }
      });
      win.loadURL("http://127.0.0.1:" + PORT + "/app/?player=1#resume");   // (player=1: Central Control's own key covers it - no license setup here)
      win.webContents.on("did-finish-load", () => { if (win) win.webContents.insertCSS("body.no-cursor, body.no-cursor * { cursor: auto !important; }").catch(() => { }); });   // (a computer: the pointer always shows)
      win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
      win.on("close", (e) => {
        if (app.__quitting) return;
        const r = dialog.showMessageBoxSync(win, { type: "question", buttons: ["Keep playing (hide the window)", "Stop the player", "Cancel"], defaultId: 0, cancelId: 2, title: "Central Pedal player",
          message: "Close the player?", detail: "The player plays the tracks and sends the charts and lyrics to everyone. Hide its window and it keeps going; stop it and the tracks stop." });
        if (r === 0) { e.preventDefault(); win.hide(); send(); }
        else if (r === 2) e.preventDefault();
      });
      win.on("closed", () => { win = null; stopDriver(); send(); });
      send();
      return { ok: true };
    })();
    try { return await starting; } finally { starting = null; }
  }

  ipcMain.handle("player-open", (_e) => center.isMain() ? open(center.pin()) : { ok: false, error: "Only the main admin's computer runs the player." });
  ipcMain.handle("player-status", () => status());
  ipcMain.handle("player-stop", () => { if (win && !win.isDestroyed()) { app.__quitting = true; win.close(); app.__quitting = false; } stopDriver(); send(); return status(); });
  app.on("before-quit", () => { app.__quitting = true; stopDriver(); });
  return { open, status, stop: stopDriver };
}

module.exports = { setup, PORT };
