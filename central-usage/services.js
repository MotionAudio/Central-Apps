/* Central Control - the services of the desktop app (main process):
 *   this computer's settings (Admin or User, its name, audio host or not, codes)          cu.json
 *   the audio host: engine (cu-mixer), the server for users / admins / phones, the Central Pedal's audio
 *     over the network, multitrack recording (recorder.js), talkback (talk.js), listening on this computer
 *   slides & lyrics outputs: a second screen, NDI (cu-ndi + an off-screen window)
 *   the Instrument tab's audio host (the Central Pedal's instrument host, run here)
 *   the lights' optional local AI model (llama.cpp's llama-server + a small downloaded model) */
"use strict";
const { BrowserWindow, ipcMain, screen, dialog, shell } = require("electron");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const https = require("node:https");
const http = require("node:http");
const { Engine } = require("./engine");
const { Host } = require("./host");
const { PiAudio } = require("./piaudio");
const { Recorder } = require("./recorder");
const { StreamOut } = require("./streamout");
const { Talk, isDesk } = require("./talk");
const { findFfmpeg } = require("./video-service");
const { Center, BEACON_PORT, salted } = require("./center");
const hubsync = require("./hubsync");
const { Libraries } = require("./libraries");
const dgram = require("node:dgram");

function which(cmd) {
  try {
    if (process.platform === "win32") { const r = spawnSync("where", [cmd], { encoding: "utf8", windowsHide: true }); return r.status === 0 ? (r.stdout.split(/\r?\n/)[0] || "").trim() || null : null; }
    return spawnSync("sh", ["-c", "command -v " + cmd], { encoding: "utf8" }).stdout.trim() || null;
  } catch (_) { return null; }
}
const EXE = process.platform === "win32" ? ".exe" : "";
function code4() { return String(1000 + Math.floor(Math.random() * 9000)); }

module.exports = function services(app, getWin) {
  const userData = app.getPath("userData");
  const nativeDir = app.isPackaged ? path.join(process.resourcesPath, "native") : path.join(__dirname, "native");
  const binDir = app.isPackaged ? nativeDir : path.join(__dirname, "native", "build");
  const send = (ch, ...a) => { const w = getWin(); if (w && !w.isDestroyed()) w.webContents.send(ch, ...a); };
  const soundsDir = app.isPackaged ? path.join(process.resourcesPath, "sounds") : path.join(__dirname, "native", "sounds");
  for (const b of ["cu-mixer", "cu-ndi", "cu-rig"]) { const f = path.join(binDir, b + EXE); try { fs.accessSync(f, fs.constants.X_OK); } catch (_) { try { fs.chmodSync(f, 0o755); } catch (__) { } } }   // (in case a copy lost the executable bit)

  // ------------------------------------------------------------------ this computer's settings
  const cfgFile = path.join(userData, "cu.json");
  let cfg = { mode: null, name: os.hostname().replace(/\.local$/, ""), host: { enabled: false, port: 8092, userCode: code4(), adminCode: code4() }, piAudio: { transport: "off", latency: 60 }, analysis: "pi", recordDir: path.join(app.getPath("music") || os.homedir(), "Central Usage Recordings") };
  try { const saved = JSON.parse(fs.readFileSync(cfgFile, "utf8")); cfg = Object.assign(cfg, saved, { host: Object.assign(cfg.host, saved.host || {}), piAudio: Object.assign(cfg.piAudio, saved.piAudio || {}) }); } catch (_) { }
  function saveCfg() { try { fs.mkdirSync(userData, { recursive: true }); fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 1)); } catch (_) { } }
  if (process.env.CU_MODE) cfg.mode = process.env.CU_MODE;   // tests
  if (process.env.CU_ROLE) cfg.role = process.env.CU_ROLE;
  if (!cfg.role && cfg.mode) cfg.role = cfg.mode === "admin" ? "admin" : "user1";   // set up before roles existed
  // the main admin's secrets: a token that proves it is the main admin to the Central Pedal, the 4-digit PIN
  // others need to move between the user and admin side, and the pairing code new computers join with
  function mainKeys() { if (!cfg.mainKeys || !cfg.mainKeys.token) cfg.mainKeys = { token: require("node:crypto").randomBytes(24).toString("hex"), pin: code4(), pair: code4() }; return cfg.mainKeys; }
  if (cfg.role === "main") mainKeys();

  // ------------------------------------------------------------------ the audio host
  const engine = new Engine({ dir: userData, bin: path.join(binDir, "cu-mixer" + EXE) });
  const talk = new Talk({ engine });
  const recorder = new Recorder({ engine, bin: path.join(binDir, "cu-mixer" + EXE), ffmpeg: () => findFfmpeg(binDir), dir: () => cfg.recordDir });
  const streamOut = new StreamOut({ engine, ffmpeg: () => findFfmpeg(binDir), dir: userData });   // the stream mix: a virtual sound device, going live with a still picture
  const host = new Host({ engine, talk, recorder, appDir: path.join(__dirname, "app"), cfg: () => ({ name: cfg.name, userCode: cfg.host.userCode, adminCode: cfg.host.adminCode }), extra: () => { const s = streamOut.status(); return { streamOut: { live: s.live, virtual: s.virtual.on && s.virtual.state === "on", destinations: s.destinations.map((d) => ({ label: d.label, status: d.status })) } }; } });
  const pi = new PiAudio(engine, 0), pi2 = new PiAudio(engine, 2);   // the track player, and one more pedal (the instrument rig) on its own channels
  let piTarget = { address: "", code: "", extra: null };
  function hostStatus() { return { cfg, engine: engine.info(), server: host.status(), pi: pi.status(), pi2: Object.assign(pi2.status(), { pedal: piTarget.extra && piTarget.extra.name || null }), recorder: recorder.state() }; }
  function applyHost() {
    const on = (cfg.mode === "admin" || cfg.mode === "main") && cfg.host.enabled;
    if (on) { engine.start(); if (!host.server || host.port !== cfg.host.port) host.start(cfg.host.port); }
    else { if (host.server) host.stop(); engine.stop(); }
    engine.setLatency(cfg.piAudio.latency || (cfg.piAudio.transport === "wifi" ? 120 : 50)); engine.setAnalysis(cfg.analysis);
    const net = on && (cfg.piAudio.transport === "ethernet" || cfg.piAudio.transport === "wifi");
    pi.configure({ enabled: net, address: piTarget.address, code: piTarget.code, name: cfg.name });
    const ex = piTarget.extra; pi2.configure({ enabled: !!(net && cfg.piAudio.extraPedal !== false && ex && ex.address && ex.address !== piTarget.address), address: ex ? ex.address : "", code: ex ? ex.code || piTarget.code : "", name: cfg.name, prefix: ex ? ex.name || "Pedal 2" : "" });
    send("host-status", hostStatus());
  }
  engine.on("status", () => send("host-status", hostStatus()));
  engine.on("op", (op, who) => send("mixer-op", op, who && who.role));
  engine.on("state", (st) => send("mixer-state", st));
  engine.on("pi", (p) => send("mixer-pi", p.names));
  engine.on("meters", (m) => send("mixer-meters", m));
  pi.on("status", () => send("host-status", hostStatus())); pi2.on("status", () => send("host-status", hostStatus()));
  host.onClients = () => send("host-status", hostStatus());

  // ------------------------------------------------------------------ the center (only on the main admin's computer)
  // Every device pairs with the main admin, not with the Central Pedal: roles, devices, health, locks and services live here,
  // so the team works with no Central Pedal at all. The Central Pedal pairs with it too (songs, charts, lyrics, tracks).
  const centerPort = Number(process.env.CU_CENTER_PORT) || 8095;
  let center = null;
  function centerStatus() { return center ? Object.assign({ on: true }, center.status()) : { on: false, port: centerPort }; }
  async function applyCenter() {
    const want = cfg.role === "main";
    if (want && !center) {
      center = new Center({ port: centerPort, dataDir: userData, appDir: path.join(__dirname, "app"), name: cfg.name || os.hostname(), beacon: !process.env.CU_NO_BEACON,
        mirror: (req, res, c) => hubsync.serveMirror(req, res, { dataDir: userData, check: (sec) => c.checkMirror(sec), before: () => c.save(),
          info: () => ({ hub: c.hubKey, gen: c.gen, name: c.mainName() }), handover: (sec, from) => stepDown("handover", { secret: sec, hub: c.hubKey, hubName: (c.devices[c.standby && c.standby.id] || {}).name || "", host: from && from.host, port: from && from.port }) }) });
      center.on((ev) => { if (ev.type === "status" || ev.type === "error") send("center-status", centerStatus()); });
      await center.start();
    } else if (!want) {   // no longer the main admin: its list goes (another computer can become the main admin)
      if (center) { const c = center; center = null; await c.stop(); }
      try { player.stop(); } catch (_) { }
      if (cfg.role !== undefined) { try { fs.unlinkSync(path.join(userData, "center.json")); } catch (_) { } }
    }
    send("center-status", centerStatus());
  }
  // centers heard on this network (the UDP "here is the center" every 2 s)
  const heard = new Map();
  try {
    const ear = dgram.createSocket({ type: "udp4", reuseAddr: true });
    ear.on("error", () => { });
    ear.on("message", (buf, rinfo) => { try { const j = JSON.parse(String(buf)); if (j.app === "central-control-center" && j.port && center && j.hub && j.hub === center.hubKey && Number(j.gen) > center.gen) stepDown("newer", { by: String(j.name || "").slice(0, 40) });
        if (j.app === "central-control-center" && j.port) heard.set(rinfo.address + ":" + j.port, { host: rinfo.address, port: Number(j.port), name: String(j.name || "").slice(0, 40), hub: String(j.hub || ""), gen: Number(j.gen) || 0, at: Date.now() }); } catch (_) { } });
    ear.bind(BEACON_PORT, () => { try { ear.setBroadcast(true); } catch (_) { } });
  } catch (_) { }
  ipcMain.handle("center-status", () => centerStatus());

  // ------------------------------------------------------------------ the hub and the second main admin's computer (hubsync.js)
  // the hub's window sends what of it belongs to the church (lighting, slides, timecode); the in-sync computer copies it
  const hubStateFile = path.join(userData, "hub-state.json"), importFile = path.join(userData, "hub-state-import.json"), standbyDir = path.join(userData, "standby");
  let lastHubState = "";
  ipcMain.on("hub-state", (_e, store) => {
    if (cfg.role !== "main" || !store || typeof store !== "object") return;
    const keep = {}; for (const k of hubsync.HUB_KEYS) if (typeof store[k] === "string" && store[k].length < 8e6) keep[k] = store[k];
    const mk = cfg.mainKeys || {}, body = JSON.stringify({ store: keep, pin: mk.pin, pair: mk.pair, userCode: cfg.host.userCode, adminCode: cfg.host.adminCode, name: cfg.name });
    if (body === lastHubState) return; lastHubState = body;
    try { fs.writeFileSync(hubStateFile + ".part", body); fs.renameSync(hubStateFile + ".part", hubStateFile); } catch (_) { }
  });
  // after a takeover: the window puts the hub's lighting, slides and timecode in place before anything reads them
  ipcMain.on("hub-state-import", (e) => { let j = null; try { j = JSON.parse(fs.readFileSync(importFile, "utf8")); fs.unlinkSync(importFile); } catch (_) { } e.returnValue = j; });
  // the in-sync computer: { secret, hub, hubName, port, host } in cfg.standby; a copy every minute
  const sync = { busy: false, at: null, ok: null, error: null, files: 0, bytes: 0, host: null };
  function hubAddress() {
    const sb = cfg.standby; if (!sb) return null;
    const fresh = [...heard.values()].filter((h) => h.hub === sb.hub && Date.now() - h.at < 8000).sort((a, b) => b.gen - a.gen)[0];
    return fresh ? { host: fresh.host, port: fresh.port } : sb.host ? { host: sb.host, port: sb.port || centerPort } : null;
  }
  function standbyStatus() {
    const last = hubsync.lastSync(standbyDir);
    return { on: !!cfg.standby, hubName: cfg.standby ? cfg.standby.hubName || "" : "", busy: sync.busy, at: sync.at || (last && last.at) || null, ok: sync.ok, error: sync.error,
      files: sync.files || (last && last.files) || 0, bytes: sync.bytes || (last && last.bytes) || 0,
      hubOnline: !!(cfg.standby && ([...heard.values()].some((h) => h.hub === cfg.standby.hub && Date.now() - h.at < 8000) || (sync.ok && sync.at && Date.now() - sync.at < 150000))),   // (heard, or copied from it lately)
      copy: !!(last && fs.existsSync(path.join(standbyDir, "center.json"))) };
  }
  async function syncNow() {
    if (!cfg.standby || cfg.role === "main" || sync.busy) return standbyStatus();
    const a = hubAddress(); if (!a) { sync.ok = false; sync.error = "Can't find the hub on this network."; send("standby-status", standbyStatus()); return standbyStatus(); }
    sync.busy = true; send("standby-status", standbyStatus());
    try {
      const r = await hubsync.syncFrom({ host: a.host, port: a.port, secret: cfg.standby.secret, dest: standbyDir });
      Object.assign(sync, { at: r.at, ok: true, error: null, files: r.files, bytes: r.bytes });
      if (cfg.standby.host !== a.host || (r.info && r.info.name && r.info.name !== cfg.standby.hubName)) { cfg.standby.host = a.host; cfg.standby.port = a.port; if (r.info && r.info.name) cfg.standby.hubName = r.info.name; saveCfg(); }
    } catch (e) { sync.ok = false; sync.error = /403/.test(e.message) || /not the in-sync/.test(e.message) ? "The hub no longer keeps this computer in sync." : e.message; }
    sync.busy = false; send("standby-status", standbyStatus());
    return standbyStatus();
  }
  setInterval(() => { syncNow().catch(() => { }); }, Number(process.env.CU_SYNC_MS) || 60000).unref();
  ipcMain.handle("standby-status", () => standbyStatus());
  ipcMain.handle("standby-sync", () => syncNow());
  ipcMain.handle("standby-set", (_e, m) => {   // from the center, through this computer's window: { type: "standbyAssigned" | "standbyCleared", secret, hub, hubName, port }
    m = m || {};
    if (m.type === "standbyAssigned" && /^[0-9a-f]{32,128}$/.test(String(m.secret || "")) && cfg.role !== "main") {
      const host = /^[A-Za-z0-9.:-]{1,64}$/.test(String(m.host || "")) ? String(m.host) : null;
      cfg.standby = { secret: String(m.secret), hub: String(m.hub || ""), hubName: String(m.hubName || "").slice(0, 40), port: Number(m.port) || centerPort, host, since: Date.now() };
      saveCfg(); setTimeout(() => syncNow().catch(() => { }), 500);
    } else if (m.type === "standbyCleared" && cfg.standby && (!m.hub || m.hub === cfg.standby.hub)) {
      delete cfg.standby; saveCfg(); try { fs.rmSync(standbyDir, { recursive: true, force: true }); } catch (_) { }
    }
    send("standby-status", standbyStatus()); return standbyStatus();
  });
  // Take over as the hub: { pin, deviceId, force } -> { ok } | { needForce, at } | { ok: false, error }
  ipcMain.handle("hub-takeover", async (_e, o) => {
    o = o || {};
    if (!cfg.standby) return { ok: false, error: "This computer isn't kept in sync with the hub." };
    const pin = hubsync.pinOk(standbyDir, o.pin, salted);
    if (pin === null) return { ok: false, error: "There's no copy of the hub on this computer yet. Wait for the first sync (it runs every minute)." };
    if (!pin) return { ok: false, error: "That isn't the main admin's role PIN." };
    let planned = false;
    if (hubAddress()) {   // the hub on: one last copy, then it hands over
      while (sync.busy) await new Promise((r) => setTimeout(r, 200));
      const st = await syncNow();
      if (st.ok && st.at && Date.now() - st.at < 30000) {
        try { const a = hubAddress(); await hubsync.handover({ host: a.host, port: a.port, secret: cfg.standby.secret, myPort: centerPort }); planned = true; }
        catch (e) { if (!o.force) return { needForce: true, at: st.at, error: "The hub didn't hand over (" + e.message + ")." }; }
      } else if (!o.force) return { needForce: true, at: st.at };
    } else if (!o.force) return { needForce: true, at: standbyStatus().at };
    const r = hubsync.promote({ userData, dest: standbyDir, deviceId: String(o.deviceId || ""), name: cfg.name, token: mainKeys().token, planned, salted });
    const hs = r.hubState || {};
    if (/^\d{4}$/.test(String(hs.pin || ""))) cfg.mainKeys.pin = String(hs.pin);
    if (/^\d{4}$/.test(String(hs.pair || ""))) cfg.mainKeys.pair = String(hs.pair);
    if (hs.userCode) cfg.host.userCode = hs.userCode; if (hs.adminCode) cfg.host.adminCode = hs.adminCode;
    cfg.role = "main"; cfg.mode = "admin"; delete cfg.standby; saveCfg();
    try { fs.writeFileSync(importFile, JSON.stringify(hs.store || {})); } catch (_) { }
    try { fs.rmSync(standbyDir, { recursive: true, force: true }); } catch (_) { }
    restart();
    return { ok: true, planned };
  });
  // this computer stops being the hub: handed over (it keeps itself in sync with the new hub), or a newer hub of this
  // church is on the network (it took over while this computer was off)
  let steppingDown = false;
  function stepDown(why, o) {
    if (steppingDown || cfg.role !== "main") return; steppingDown = true;
    o = o || {};
    cfg.role = "admin"; cfg.mode = "admin";
    if (why === "handover" && o.secret) cfg.standby = { secret: o.secret, hub: o.hub, hubName: o.hubName || "", port: o.port || centerPort, host: o.host || null, since: Date.now() };
    saveCfg();
    send("hub-changed", { why, by: o.by || o.hubName || "" });
    setTimeout(() => restart(), 1500);
  }
  function restart() {   // (the window, the center and the player start again in their new place)
    if (process.env.CU_NO_RELAUNCH) { steppingDown = false; applyHost(); applyCenter(); send("hub-restart"); return; }
    const exe = require("./updater").Updater.debExec(process.execPath); setTimeout(() => { app.relaunch(process.env.APPIMAGE ? { execPath: process.env.APPIMAGE } : exe && exe !== process.execPath ? { execPath: exe } : undefined); app.exit(0); }, 400);
  }
  ipcMain.handle("center-heard", () => [...heard.values()].filter((h) => Date.now() - h.at < 8000));
  ipcMain.handle("center-probe", (_e, host, port) => new Promise((resolve) => {
    const req = http.get({ host: String(host), port: Number(port) || 8095, path: "/api/center", timeout: 1500 }, (res) => { let b = ""; res.setEncoding("utf8"); res.on("data", (c) => { b += c; if (b.length > 8192) req.destroy(); }); res.on("end", () => { try { const j = JSON.parse(b); resolve(j && j.app === "central-control-center" ? Object.assign(j, { host: String(host) }) : null); } catch (_) { resolve(null); } }); });
    req.on("timeout", () => { req.destroy(); resolve(null); }); req.on("error", () => resolve(null));
  }));

  // ------------------------------------------------------------------ the player window (player.js): the Central Pedal app built in,
  // for the main admin's computer to run the tracks, charts and lyrics when no Central Pedal plays them
  const player = require("./player").setup({ app, ipcMain, getMainWin: getWin, center: { isMain: () => cfg.role === "main", port: () => centerPort, pin: () => (cfg.role === "main" && cfg.mainKeys ? cfg.mainKeys.pair : "") } });

  ipcMain.handle("cu-config", () => cfg);
  ipcMain.handle("cu-config-set", (_e, patch) => {
    patch = patch || {};
    ["mode", "name", "analysis", "recordDir"].forEach((k) => { if (k in patch) cfg[k] = patch[k]; });
    if ("role" in patch) {
      cfg.role = ["main", "admin", "user1", "user2"].includes(patch.role) ? patch.role : null;
      cfg.mode = cfg.role ? (cfg.role === "main" || cfg.role === "admin" ? "admin" : "user") : null;
      if (cfg.role === "main") mainKeys(); else if (!cfg.role) delete cfg.mainKeys;
    }
    if (cfg.role === "main" && patch.newPin) mainKeys().pin = /^\d{4}$/.test(String(patch.newPin)) ? String(patch.newPin) : code4();
    if (cfg.role === "main" && patch.newPair) mainKeys().pair = /^\d{4}$/.test(String(patch.newPair)) ? String(patch.newPair) : code4();
    if (Array.isArray(patch.jobs)) cfg.jobs = patch.jobs.filter((j) => ["general", "lighting", "production", "mix", "inears", "slides"].includes(j));
    if (patch.host) Object.assign(cfg.host, patch.host);
    if (patch.newUserCode) cfg.host.userCode = code4(); if (patch.newAdminCode) cfg.host.adminCode = code4();
    if (patch.piAudio) Object.assign(cfg.piAudio, patch.piAudio);
    saveCfg(); applyHost(); if ("role" in patch) applyCenter(); return cfg;
  });
  ipcMain.handle("host-status", () => hostStatus());
  ipcMain.handle("pi-target", (_e, t) => { piTarget = Object.assign(piTarget, t || {}); applyHost(); return pi.status(); });
  ipcMain.handle("mixer-get", () => ({ state: engine.state, pi: engine.pi.names, info: engine.info() }));
  ipcMain.handle("mixer-op", (_e, op) => engine.apply(op, { role: "host" }));
  ipcMain.handle("mixer-replace", (_e, st) => { engine.replaceState(st); return true; });
  const listeners = new Map();
  ipcMain.handle("mixer-listen", (_e, tap, on) => {
    const old = listeners.get(tap); if (old) { engine.tap(tap, old, false); listeners.delete(tap); }
    if (on) { const fn = (pcm, frames) => send("listen-audio", tap, frames, pcm); listeners.set(tap, fn); engine.tap(tap, fn, true); }
    return [...listeners.keys()];
  });
  // ---- recording (recorder.js): window.CU.recorder in the page; also the admins on other computers (host.js)
  recorder.on("state", (st, ev) => { send("rec-event", st, ev); host.admins({ type: "recState", state: st, event: ev }); if (ev !== "tick") send("host-status", hostStatus()); });
  const recErr = (e) => ({ error: e.message, state: recorder.state() });
  ipcMain.handle("rec-start", async (_e, opts) => { try { return { state: await recorder.start(opts || {}) }; } catch (e) { return recErr(e); } });
  ipcMain.handle("rec-stop", async () => { try { return { state: await recorder.stop() }; } catch (e) { return recErr(e); } });
  ipcMain.handle("rec-state", () => recorder.state());
  ipcMain.handle("rec-choose-dir", async () => {
    const r = await dialog.showOpenDialog(getWin(), { title: "Folder for the recordings", defaultPath: cfg.recordDir, properties: ["openDirectory", "createDirectory"] });
    if (r.canceled || !r.filePaths[0]) return recorder.state();
    cfg.recordDir = r.filePaths[0]; saveCfg(); send("host-status", hostStatus()); return recorder.state();
  });
  ipcMain.handle("rec-open", (_e, which) => { const st = recorder.state(), p = which === "last" && st.last && st.last.folder ? st.last.folder : which === "current" && st.folder ? st.folder : cfg.recordDir; fs.mkdirSync(p, { recursive: true }); shell.openPath(p); return true; });
  // the older record call (Mix tab of earlier versions, tests): { on, tap: 0 main | 1..64 mix } -> the multitrack recorder
  ipcMain.handle("mixer-record", async (_e, opt) => {
    opt = opt || {};
    try {
      if (!opt.on) { const st = await recorder.stop(); return Object.assign({}, st, { saved: st.last && st.last.program }); }
      const tap = Number(opt.tap) || 0; return await recorder.start({ name: opt.label || "", program: tap ? tap - 1 : "main" });
    } catch (e) { return recErr(e); }
  });
  ipcMain.handle("open-recordings", () => { fs.mkdirSync(cfg.recordDir, { recursive: true }); shell.openPath(cfg.recordDir); return true; });
  // ---- the stream mix out of this computer (streamout.js) and the delay's tempo
  streamOut.on("status", (s) => send("stream-out", s));
  ipcMain.handle("stream-out", (_e, a) => {
    a = a || {};
    if (a.action === "virtual") return streamOut.setVirtual(!!a.on);
    if (a.action === "live") return streamOut.setLive(a.id || "all", !!a.on);
    if (a.action === "config") return streamOut.config(a.patch);
    if (a.action === "picture") { const r = dialog.showOpenDialogSync(getWin(), { title: "A picture for the stream (your logo)", properties: ["openFile"], filters: [{ name: "Pictures", extensions: ["png", "jpg", "jpeg"] }] }); return streamOut.config({ picture: r && r[0] ? r[0] : a.clear ? "" : streamOut.cfg.picture }); }
    return streamOut.status();
  });
  ipcMain.handle("mixer-tempo", (_e, bpm) => engine.setTempo(bpm));

  // ---- talkback (talk.js): this computer's own talk (as the audio host) goes straight in; the users' talkback
  // to the desk plays here when this computer is the desk (the main admin, or an admin with the Mix job)
  const localDesk = () => isDesk(cfg.role, cfg.jobs);
  host.localDesk = localDesk;
  const hostOn = () => (cfg.mode === "admin" || cfg.mode === "main") && cfg.host.enabled && !!engine.proc;
  talk.on("talkers", (list) => send("talk-event", { talkers: list }));
  talk.on("desk", (d) => { if (d.key !== "local" && localDesk()) send("talk-desk-audio", d.frames, d.rate, d.pcm, d.name); });
  ipcMain.handle("talk-start", (_e, o) => {
    if (!hostOn()) return { ok: false, error: "This computer is not the audio host." };
    const r = talk.start("local", o || {}, { role: cfg.role === "main" || cfg.role === "admin" ? "admin" : "user", name: (o && o.name) || cfg.name || "Sound desk" });
    if (r.ok && r.talker.kind === "desk") r.receivers = host.deskCount(null) - (localDesk() ? 1 : 0);
    return r;
  });
  ipcMain.handle("talk-stop", () => talk.stop("local"));
  ipcMain.on("talk-audio", (_e, buf) => { if (buf) talk.audio("local", Buffer.from(buf.buffer ? Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength) : buf)); });
  ipcMain.handle("talk-state", () => ({ talkers: talk.list(), host: hostOn(), desk: localDesk() }));
  ipcMain.handle("mixer-export", async () => { const r = await dialog.showSaveDialog(getWin(), { defaultPath: "mixer.json", filters: [{ name: "Central Control mixer", extensions: ["json"] }] }); if (r.canceled || !r.filePath) return null; fs.writeFileSync(r.filePath, JSON.stringify({ format: "central-usage-mixer", version: 1, state: engine.state }, null, 1)); return r.filePath; });
  ipcMain.handle("mixer-import", async () => { const r = await dialog.showOpenDialog(getWin(), { properties: ["openFile"], filters: [{ name: "Central Control mixer", extensions: ["json"] }] }); if (r.canceled || !r.filePaths[0]) return null; const j = JSON.parse(fs.readFileSync(r.filePaths[0], "utf8")); if (j.format !== "central-usage-mixer") throw new Error("not a Central Control mixer file"); engine.replaceState(j.state); return true; });

  // ------------------------------------------------------------------ slides & lyrics outputs
  const outputs = { screen: null, ndi: null, ndiProc: null, ndiStatus: null, last: null };
  function outputPage(win) { win.loadFile(path.join(__dirname, "app", "output.html")); win.webContents.on("did-finish-load", () => { if (outputs.last) win.webContents.send("slide", outputs.last); }); }
  ipcMain.handle("screens", () => screen.getAllDisplays().map((d, i) => ({ id: d.id, label: d.label || "Screen " + (i + 1), size: d.size, bounds: d.bounds, primary: d.id === screen.getPrimaryDisplay().id })));
  ipcMain.handle("output-screen", (_e, opt) => {
    opt = opt || {};
    if (!opt.on) { if (outputs.screen && !outputs.screen.isDestroyed()) outputs.screen.close(); outputs.screen = null; return { on: false }; }
    const d = screen.getAllDisplays().find((x) => x.id === opt.displayId) || screen.getAllDisplays().find((x) => x.id !== screen.getPrimaryDisplay().id) || screen.getPrimaryDisplay();
    if (!outputs.screen || outputs.screen.isDestroyed()) {
      outputs.screen = new BrowserWindow({ x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height, frame: false, fullscreen: true, backgroundColor: "#000000", title: "Central Control output", autoHideMenuBar: true, skipTaskbar: true, webPreferences: { preload: path.join(__dirname, "preload-output.js"), contextIsolation: true, sandbox: false } });
      outputPage(outputs.screen); outputs.screen.on("closed", () => { outputs.screen = null; send("outputs", { screen: false }); });
    } else { outputs.screen.setFullScreen(false); outputs.screen.setBounds(d.bounds); outputs.screen.setFullScreen(true); }
    return { on: true, display: d.id };
  });
  function ndiStop() { if (outputs.ndiProc) { try { const h = Buffer.alloc(5); h[0] = 81; outputs.ndiProc.stdin.write(h); outputs.ndiProc.kill(); } catch (_) { } } outputs.ndiProc = null; if (outputs.ndi && !outputs.ndi.isDestroyed()) outputs.ndi.close(); outputs.ndi = null; }
  ipcMain.handle("output-ndi", (_e, opt) => {
    opt = opt || {}; ndiStop();
    if (!opt.on) { outputs.ndiStatus = { on: false }; return outputs.ndiStatus; }
    const bin = path.join(binDir, "cu-ndi" + EXE); if (!fs.existsSync(bin)) return (outputs.ndiStatus = { on: false, error: "The NDI sender (cu-ndi) is missing from this installation." });
    const w = Number(opt.width) || 1920, h = Number(opt.height) || 1080, fps = Number(opt.fps) || 30;
    const proc = spawn(bin, [opt.name || "Central Control " + (cfg.name || "")], { stdio: ["pipe", "pipe", "ignore"] }); outputs.ndiProc = proc; outputs.ndiStatus = { on: true, starting: true };
    proc.stdin.on("error", () => { });
    proc.stdout.on("data", (b) => { String(b).split("\n").filter(Boolean).forEach((line) => { try { const m = JSON.parse(line); if (m.ev === "status") outputs.ndiStatus = m.ok ? { on: true, name: m.name } : { on: false, error: m.error }; else if (m.ev === "stats") outputs.ndiStatus.receivers = m.receivers; send("outputs", { ndi: outputs.ndiStatus }); } catch (_) { } }); });
    proc.on("exit", () => { if (outputs.ndiProc === proc) { outputs.ndiProc = null; if (outputs.ndi && !outputs.ndi.isDestroyed()) outputs.ndi.close(); outputs.ndi = null; if (outputs.ndiStatus && outputs.ndiStatus.on) outputs.ndiStatus = { on: false, error: outputs.ndiStatus.error || "the NDI sender stopped" }; send("outputs", { ndi: outputs.ndiStatus }); } });
    const win = outputs.ndi = new BrowserWindow({ width: w, height: h, show: false, frame: false, backgroundColor: "#000000", webPreferences: { offscreen: true, preload: path.join(__dirname, "preload-output.js"), contextIsolation: true, sandbox: false } });
    win.webContents.setFrameRate(fps); outputPage(win);
    win.webContents.on("paint", (_ev, _dirty, image) => {
      if (!outputs.ndiProc || !outputs.ndiProc.stdin.writable || outputs.ndiProc.stdin.writableLength > 32 << 20) return;
      const size = image.getSize(), bmp = image.toBitmap(), hd = Buffer.alloc(13);   // BGRA
      hd[0] = 86; hd.writeUInt32LE(8 + bmp.length, 1); hd.writeUInt16LE(size.width, 5); hd.writeUInt16LE(size.height, 7); hd.writeUInt16LE(fps, 9); hd.writeUInt16LE(0, 11);
      outputs.ndiProc.stdin.write(Buffer.concat([hd, bmp]));
    });
    return outputs.ndiStatus;
  });
  ipcMain.handle("outputs-status", () => ({ screen: !!(outputs.screen && !outputs.screen.isDestroyed()), ndi: outputs.ndiStatus || { on: false } }));
  ipcMain.on("slide", (_e, slide) => { outputs.last = slide; [outputs.screen, outputs.ndi].forEach((w) => { if (w && !w.isDestroyed()) w.webContents.send("slide", slide); }); });
  ipcMain.handle("slides-open", async () => { const r = await dialog.showOpenDialog(getWin(), { title: "Add pictures or videos", properties: ["openFile", "multiSelections"], filters: [{ name: "Pictures and videos", extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "mp4", "webm", "mov", "m4v", "ogv"] }] }); if (r.canceled) return []; return r.filePaths.map((f) => ({ path: f, name: path.basename(f), size: fs.statSync(f).size })); });
  ipcMain.handle("read-file", (_e, f) => { try { return fs.readFileSync(f); } catch (_) { return null; } });

  // ------------------------------------------------------------------ the Instrument tab (runs the Central Pedal's instrument host here)
  let inst = null, instBuf = "", instKind = "", instAlt = "", instLastApply = null, instRestarts = [], instStopping = false;
  // Linux with PipeWire has two engines: the Central Pedal's own (real LV2 pedals) and the built-in rig (which also
  // plays the musician's own VST3 / CLAP / LV2 plugins). The page offers the other one; the choice is remembered.
  const enginePref = () => path.join(userData, "instrument", "engine.json");
  const engineWanted = () => { try { return JSON.parse(fs.readFileSync(enginePref(), "utf8")).engine || ""; } catch (_) { return ""; } };
  function instStart() {
    if (inst) return true;
    // Linux with PipeWire: the Central Pedal's own instrument host (real LV2 / LADSPA pedals, FluidSynth);
    // Windows, macOS (or Linux without PipeWire): the built-in rig cu-rig (built-in effects, SoundFont keys)
    const py = process.platform === "linux" && which("python3"), script = path.join(nativeDir, "cu-instrument.py");
    const rigBin = path.join(binDir, "cu-rig" + EXE), map = [path.join(nativeDir, "rig-map.json"), path.join(binDir, "rig-map.json")].filter((f) => fs.existsSync(f))[0];
    let cmd, args;
    const pedalOk = !!(py && which("pw-cli") && fs.existsSync(script)), rigOk = fs.existsSync(rigBin);
    if (pedalOk && process.env.CU_RIG !== "1" && !(engineWanted() === "rig" && rigOk)) { cmd = py; args = [script, path.join(userData, "instrument")]; instKind = "pedal"; }
    else if (rigOk) { instKind = "rig"; cmd = rigBin; args = ["--data", path.join(userData, "instrument"), "--sounds", soundsDir].concat(map ? ["--map", map] : []).concat(process.env.CU_RIG_BACKEND ? ["--backend", process.env.CU_RIG_BACKEND] : []); }
    else { send("inst-msg", { type: "instrumentStatus", available: false, error: "The instrument engine is missing from this installation.", inputs: [], midiInputs: [], keysCatalog: [] }); return false; }
    try { fs.mkdirSync(path.join(userData, "instrument", "sounds", "sf2"), { recursive: true }); fs.mkdirSync(path.join(userData, "instrument", "sounds", "ir"), { recursive: true }); } catch (_) { }
    instAlt = pedalOk && rigOk ? (instKind === "pedal" ? "rig" : "pedal") : "";
    inst = spawn(cmd, args, { stdio: ["pipe", "pipe", "ignore"], windowsHide: true }); instBuf = "";
    inst.stdout.on("data", (b) => { instBuf += b; let i; while ((i = instBuf.indexOf("\n")) >= 0) { const line = instBuf.slice(0, i); instBuf = instBuf.slice(i + 1); try { const m = JSON.parse(line); if (m && m.type === "instrumentStatus" && instAlt) m.engineAlt = instAlt; if (m && m.type === "instrumentStatus") libs.applyTiers(m); send("inst-msg", m); } catch (_) { } } });
    const me = inst;
    inst.stdin.on("error", () => { }); inst.on("error", () => { if (inst === me) inst = null; });
    inst.on("exit", (code, sig) => {
      if (inst === me) inst = null;
      if (instStopping || (code === 0 && !sig)) return;
      // it stopped by itself (a plugin crashed it): start it again with the same board, at most three times a minute
      // (a plugin that crashed it while loading is paused by the engine, so it can't do it twice)
      instRestarts = instRestarts.filter((t) => Date.now() - t < 60000);
      if (instRestarts.length >= 3) { send("inst-msg", { type: "instrumentStatus", available: true, running: false, error: "The instrument engine stopped three times in a minute, so it is off for now. Remove the plugin that is doing it, then change anything to start it again.", inputs: [], midiInputs: [], keysCatalog: [] }); instRestarts = []; return; }
      instRestarts.push(Date.now()); send("inst-msg", { type: "instrumentNotice", text: "The instrument engine stopped unexpectedly. Starting it again…" });
      setTimeout(() => { if (inst) return; instStart(); if (inst && instLastApply) inst.stdin.write(JSON.stringify(instLastApply) + "\n"); }, 800);
    });
    return true;
  }
  ipcMain.handle("inst-start", () => instStart());
  ipcMain.on("inst-send", (_e, msg) => {
    if (msg && msg.action === "engine") {   // switch engines (Linux): remember, stop this one, start the other
      try { fs.mkdirSync(path.dirname(enginePref()), { recursive: true }); fs.writeFileSync(enginePref(), JSON.stringify({ engine: msg.engine === "rig" ? "rig" : "pedal" })); } catch (_) { }
      const restart = () => { instStart(); if (inst) inst.stdin.write(JSON.stringify({ type: "instrument", action: "status" }) + "\n"); };
      if (inst) { const old = inst; instStopping = true; old.once("exit", () => { instStopping = false; restart(); }); try { old.stdin.end(); } catch (_) { } setTimeout(() => { try { old.kill(); } catch (_) { } }, 2500); } else restart();
      return;
    }
    if (msg && msg.action === "apply") instLastApply = msg;
    if (instStart() && inst) inst.stdin.write(JSON.stringify(msg) + "\n");
  });
  ipcMain.handle("inst-stop", () => { if (inst) { instStopping = true; inst.once("exit", () => { instStopping = false; }); try { inst.stdin.end(); setTimeout(() => { if (inst) inst.kill(); }, 1500); } catch (_) { } } return true; });

  // ------------------------------------------------------------------ the sound libraries (Settings → Packages → Libraries)
  // installed into the instrument's own sound folders; each keeps its plan (libraries.js)
  const libs = new Libraries({ dir: userData, send: (m) => { if (inst) try { inst.stdin.write(JSON.stringify(m) + "\n"); } catch (_) { } } });
  const libOut = (r) => ({ ok: true, installed: libs.listing(), record: r && r.id ? { id: r.id, version: r.version, counts: r.counts } : undefined });
  const libErr = (e) => ({ ok: false, error: e.message || String(e), installed: libs.listing() });
  ipcMain.handle("lib-list", () => ({ ok: true, installed: libs.listing(), progress: libs.progress }));
  ipcMain.handle("lib-install", async (_e, a) => {
    a = a || {};
    try { return libOut(await libs.installUrl(String(a.url || ""), String(a.sha256 || ""), String(a.id || "library"), Number(a.size) || 0, (p) => send("lib-progress", { id: a.id, done: p.done, total: p.total, state: p.state }))); } catch (e) { return libErr(e); }
  });
  ipcMain.handle("lib-install-file", async (_e, a) => {
    const r = await dialog.showOpenDialog(getWin(), { title: "A sound library (.zip from the Downloads page)", properties: ["openFile"], filters: [{ name: "Sound library", extensions: ["zip"] }] });
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true, installed: libs.listing() };
    const sha = a && a.byFile && a.byFile[path.basename(r.filePaths[0])];   // (a file named as a listed library: checked against its sha256 too)
    try { return libOut(libs.installFile(r.filePaths[0], sha || null, "file")); } catch (e) { return libErr(e); }
  });
  ipcMain.handle("lib-remove", (_e, id) => { try { libs.remove(String(id || "")); return libOut(null); } catch (e) { return libErr(e); } });

  // ------------------------------------------------------------------ the lights' local AI model (optional)
  const ai = { dir: path.join(userData, "models"), proc: null, port: 8093, download: null, ready: false, error: null };
  const MODEL = { name: "Qwen2.5 0.5B Instruct (Q4_K_M, about 400 MB)", file: "qwen2.5-0.5b-instruct-q4_k_m.gguf", url: "https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf" };
  function aiServer() { return which("llama-server") || (fs.existsSync(path.join(ai.dir, "llama-server")) ? path.join(ai.dir, "llama-server") : null); }
  function aiStatus() { const f = path.join(ai.dir, MODEL.file); return { model: MODEL.name, downloaded: fs.existsSync(f), server: aiServer(), running: !!ai.proc, ready: ai.ready, download: ai.download, error: ai.error }; }
  function get(url, depth) { return new Promise((resolve, reject) => { const lib = url.startsWith("https:") ? https : http; lib.get(url, { headers: { "User-Agent": "central-usage" } }, (res) => { if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && (depth || 0) < 6) { res.resume(); return resolve(get(new URL(res.headers.location, url).toString(), (depth || 0) + 1)); } if (res.statusCode !== 200) { res.resume(); return reject(new Error("HTTP " + res.statusCode)); } resolve(res); }).on("error", reject); }); }
  ipcMain.handle("ai-status", () => aiStatus());
  ipcMain.handle("ai-download", async () => {
    if (ai.download && ai.download.active) return aiStatus();
    fs.mkdirSync(ai.dir, { recursive: true }); const dest = path.join(ai.dir, MODEL.file), part = dest + ".part";
    ai.download = { active: true, got: 0, total: 0 }; ai.error = null;
    try {
      const res = await get(MODEL.url); ai.download.total = Number(res.headers["content-length"]) || 0;
      await new Promise((resolve, reject) => { const out = fs.createWriteStream(part); res.on("data", (c) => { ai.download.got += c.length; if (ai.download.got % (8 << 20) < c.length) send("ai-status", aiStatus()); }); res.pipe(out); out.on("finish", resolve); res.on("error", reject); out.on("error", reject); });
      fs.renameSync(part, dest); ai.download = { active: false, done: true };
    } catch (e) { ai.download = { active: false }; ai.error = "Download failed: " + e.message; try { fs.unlinkSync(part); } catch (_) { } }
    send("ai-status", aiStatus()); return aiStatus();
  });
  ipcMain.handle("ai-remove", () => { try { fs.unlinkSync(path.join(ai.dir, MODEL.file)); } catch (_) { } if (ai.proc) ai.proc.kill(); return aiStatus(); });
  function aiStart() {
    return new Promise((resolve) => {
      if (ai.proc && ai.ready) return resolve(true);
      const bin = aiServer(), model = path.join(ai.dir, MODEL.file);
      if (!bin) { ai.error = "llama-server (llama.cpp) is not installed on this computer."; return resolve(false); }
      if (!fs.existsSync(model)) { ai.error = "The model is not downloaded yet."; return resolve(false); }
      if (!ai.proc) { ai.ready = false; ai.proc = spawn(bin, ["-m", model, "--port", String(ai.port), "--host", "127.0.0.1", "-c", "4096"], { stdio: "ignore" }); ai.proc.on("exit", () => { ai.proc = null; ai.ready = false; }); }
      let tries = 0; const t = setInterval(() => { http.get("http://127.0.0.1:" + ai.port + "/health", (res) => { res.resume(); if (res.statusCode === 200) { clearInterval(t); ai.ready = true; resolve(true); } }).on("error", () => { }); if (++tries > 120) { clearInterval(t); ai.error = "The model did not start."; resolve(false); } }, 500);
    });
  }
  ipcMain.handle("ai-ask", async (_e, system, user) => {
    if (!(await aiStart())) return { error: ai.error };
    const body = JSON.stringify({ messages: [{ role: "system", content: system }, { role: "user", content: user }], temperature: 0.2, max_tokens: 1200 });
    return new Promise((resolve) => {
      const req = http.request({ host: "127.0.0.1", port: ai.port, path: "/v1/chat/completions", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } }, (res) => { let s = ""; res.on("data", (c) => { s += c; }); res.on("end", () => { try { const j = JSON.parse(s); resolve({ text: j.choices[0].message.content }); } catch (e) { resolve({ error: "bad answer from the model" }); } }); });
      req.on("error", (e) => resolve({ error: e.message })); req.setTimeout(60000, () => { req.destroy(); resolve({ error: "the model took too long" }); }); req.end(body);
    });
  });

  return {
    start() { applyHost(); applyCenter(); setTimeout(() => { try { recorder.repairAll(); } catch (_) { } }, 3000); },   // (a recording a crash cut short: its files repaired)
    // the stream mix for the Video tab on this computer: true when this computer is the audio host (its engine's tap)
    streamTap(fn, on) { if (!engine.wanted && on) return false; engine.tap(65, fn, !!on); return true; },
    stop() { try { center && center.stop(); } catch (_) { } try { streamOut.stop(); } catch (_) { } try { recorder.stop().catch(() => { }); } catch (_) { } talk.close(); host.stop(); engine.stop(); pi.close(); ndiStop(); if (inst) inst.kill(); if (ai.proc) ai.proc.kill(); if (outputs.screen && !outputs.screen.isDestroyed()) outputs.screen.close(); },
    cfg: () => cfg
  };
};
