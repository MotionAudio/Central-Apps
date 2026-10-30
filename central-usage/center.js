/* Central Control - the center: it runs on the MAIN ADMIN's computer and holds what the whole team shares:
 * who is paired (one 4-digit pairing PIN), every device's role and jobs, their connection health, the
 * service lock, and the services (run order + who is on when). Every other Central Control, every phone /
 * tablet and the Central Pedal (the Raspberry Pi) pair with it. It works with no Central Pedal at all;
 * when one is paired, the center tells every device where it is (songs, charts, lyrics and tracks still
 * come from the Central Pedal) and hands it the services for its stage display.
 *
 *   ws://<main admin>:8095            the same messages the Central Pedal used to answer:
 *                                     {type:"cuRole", action: hello|join|set|forget|assign|rename|remove|jobs|approve|health|myJobs|setPair|lock}
 *                                     {type:"service", action: get|save|start|next|prev|goto|stop}
 *   http://<main admin>:8095/cu/      Central Control for phones and tablets (User 1 / User 2)
 *   http://<main admin>:8095/api/service   the run order + countdown (stage displays)
 *   UDP broadcast on 8097             "here is the center" every 2 s, so devices find it by themselves
 *   talkback (binary "TKA1" mic frames after {type:"talk", on:true, to:"main"|"group"}): everyone talks to the main
 *     admin's headphones; the main admin talks to the Band or the Production group (each device is in one - the
 *     Devices tab). Relayed as "TKC1" + u8 id length + talker id + the TKA1 frame.
 *
 * Runs inside the Electron app (main.js starts it when this computer is the main admin) or on its own:
 *   node center.js --port 8095 --data <folder>      (tests) */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const os = require("node:os");
const dgram = require("node:dgram");
const crypto = require("node:crypto");
const { WebSocketServer } = require("ws");

const ROLES = ["main", "admin", "user1", "user2", "pedal"];
const ADMIN_TIER = ["main", "admin"];
// (10.0) what an admin computer does: any of seven jobs, or general (all of them). Several computers can have the
// same job; the center says which one runs it (jobRunner) - the others show it but don't send anything out.
const JOBS = ["general", "lyrics", "lights", "cameras", "inears", "tracks", "stream", "slides"];
const WORK = JOBS.slice(1);
const OLD_JOBS = { lighting: ["lights"], production: ["cameras"], mix: ["tracks", "stream"], slides: ["slides", "lyrics"], inears: ["inears"] };   // (before 10.0)
function normJobs(list, v) {
  if (!Array.isArray(list) || !list.length || list.includes("general")) return ["general"];
  const out = [];
  for (const j of list) for (const k of (v === 2 ? (WORK.includes(j) ? [j] : []) : (OLD_JOBS[j] || (WORK.includes(j) ? [j] : [])))) if (!out.includes(k)) out.push(k);
  out.sort((a, b) => WORK.indexOf(a) - WORK.indexOf(b));
  return !out.length || out.length === WORK.length ? ["general"] : out;
}
// what each Central Pedal does (the main admin picks it on the Devices tab):
//   player      plays the tracks, sends the charts and lyrics - one at a time; every Central Control follows it
//   controller  a foot controller: its buttons start / stop, change song and section on the player
//   instrument  only its own instrument rig (boards, pedals, keys sounds) - no tracks
//   standby     keeps the song library, does not play (e.g. the main admin's player window when a pedal plays)
const PEDAL_JOBS = ["player", "controller", "instrument", "backup", "standby"];
const PLAYER_GONE_MS = 1500;   // the track player's heartbeat (every 0.5 s) stopped this long: a backup may take over
const TALK_GROUPS = ["band", "production"];
const SERVICE_ROLES = ["lighting", "production", "slides", "lyrics", "mix", "inears", "band"];
const SERVICE_KINDS = ["song", "prayer", "welcome", "announcements", "offering", "sermon", "communion", "video", "other"];
const BEACON_PORT = 8097;
const MAX_SERVICES = 4;

function salted(secret, salt) { return crypto.createHash("sha256").update(String(salt) + ":" + String(secret)).digest("hex"); }
function clean(s, n) { return String(s == null ? "" : s).replace(/[\u0000-\u001f]/g, "").trim().slice(0, n || 40); }
function idOf(s) { return String(s || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 48); }
function four(v) { return /^\d{4}$/.test(String(v || "").trim()); }
function addresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === "IPv4" && !a.internal) out.push(a.address);
  return out;
}

class Center {
  constructor(opts) {
    this.opts = Object.assign({ port: 8095, dataDir: os.tmpdir(), appDir: path.join(__dirname, "app"), name: os.hostname(), beacon: true, loopbackMainOnly: true }, opts || {});
    this.file = path.join(this.opts.dataDir, "center.json");
    let j = {}; try { j = JSON.parse(fs.readFileSync(this.file, "utf8")); } catch (_) { }
    this.main = j.main || null;                     // { id, name, tokenSalt, tokenHash, pinSalt, pinHash }
    this.pair = four(j.pair) ? String(j.pair) : ""; // the pairing PIN (every device joins with it)
    this.devices = j.devices || {};                 // id -> { name, role, jobs, jobsV, jobsAt, paired, lastSeen, wantsAdmin, pedal }
    this.jobRunner = Object.assign({}, j.jobRunner || {});   // job -> the device id that runs it (when several have it)
    this.lock = { all: !!(j.lock && j.lock.all), devices: Object.assign({}, (j.lock && j.lock.devices) || {}) };
    this.services = Array.isArray(j.services) ? j.services.map((s) => this.cleanService(s)).slice(0, MAX_SERVICES) : [];
    this.run = j.run || null;
    // the main admin's player window: while a Central Pedal plays, it is the backup player (follows silently, takes over)
    this.backup = Object.assign({ localIsBackup: true }, j.backup || {});
    // 10.0: where the tracks run. "computer": the main admin's player window keeps the songs and plays them, and the
    // Central Pedals control it - while the window is closed, a pedal plays (and hands back when nothing plays).
    // "pedal": a Central Pedal plays, as before 10.0.
    this.tracksHost = j.tracksHost === "pedal" ? "pedal" : "computer";
    // the church's hub: its id stays the same when the hub moves to the other main admin's computer (hubsync.js); gen goes
    // up each time, so an old hub that comes back after a takeover hears a newer one and steps down
    this.hubKey = /^[0-9a-f]{16,64}$/.test(j.hubKey || "") ? j.hubKey : crypto.randomBytes(12).toString("hex");
    this.gen = Math.max(1, Number(j.gen) || 1);
    this.standby = j.standby && j.standby.id && j.standby.secretHash ? j.standby : null;   // the other main admin's computer, kept in sync: { id, secretSalt, secretHash, since }
    this.lastMsg = {};
    this.clients = new Map();                       // ws -> { id, auth, main, ip }
    this.health = {};                               // id -> {..., at}
    this.fails = {};
    this.pushAt = 0;
    this.listeners = [];
  }
  on(fn) { this.listeners.push(fn); }
  emit(ev) { for (const fn of this.listeners) { try { fn(ev); } catch (_) { } } }
  save() {
    try { fs.mkdirSync(this.opts.dataDir, { recursive: true }); const tmp = this.file + ".part"; fs.writeFileSync(tmp, JSON.stringify({ main: this.main, pair: this.pair, devices: this.devices, lock: this.lock, services: this.services, run: this.run, backup: this.backup, hubKey: this.hubKey, gen: this.gen, standby: this.standby, jobRunner: this.jobRunner, tracksHost: this.tracksHost })); fs.renameSync(tmp, this.file); } catch (_) { }
  }

  // ----------------------------------------------------------------------------- the server
  start() {
    return new Promise((resolve) => {
      this.http = http.createServer((req, res) => this.serve(req, res));
      this.wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20, perMessageDeflate: false });
      this.http.on("upgrade", (req, sock, head) => this.wss.handleUpgrade(req, sock, head, (ws) => this.connection(ws, req)));
      this.http.on("error", (e) => { this.error = e.message; this.emit({ type: "error", error: e.message }); resolve(false); });
      this.http.listen(this.opts.port, "0.0.0.0", () => { this.port = this.http.address().port; this.startBeacon(); this.emit({ type: "status" }); resolve(true); });
      this.timer = setInterval(() => this.tick(), 5000);
    });
  }
  stop() {
    clearInterval(this.timer); clearInterval(this.beaconTimer);
    try { this.beacon && this.beacon.close(); } catch (_) { }
    for (const ws of this.clients.keys()) { try { ws.terminate(); } catch (_) { } }
    try { this.wss && this.wss.close(); } catch (_) { }
    return new Promise((r) => (this.http ? this.http.close(() => r()) : r()));
  }
  startBeacon() {
    if (!this.opts.beacon) return;
    try {
      this.beacon = dgram.createSocket({ type: "udp4", reuseAddr: true });
      this.beacon.on("error", () => { });
      this.beacon.bind(0, () => {
        try { this.beacon.setBroadcast(true); } catch (_) { }
        const send = () => { const m = Buffer.from(JSON.stringify({ app: "central-control-center", name: this.mainName(), port: this.port, v: 1, hub: this.hubKey, gen: this.gen })); try { this.beacon.send(m, BEACON_PORT, "255.255.255.255"); } catch (_) { } };
        send(); this.beaconTimer = setInterval(send, 2000);
      });
    } catch (_) { }
  }
  mainName() { return (this.main && this.main.name) || this.opts.name; }
  checkMirror(secret) { return !!(this.standby && secret && salted(secret, this.standby.secretSalt) === this.standby.secretHash); }
  standbyView() {
    const sb = this.standby; if (!sb) return null;
    const d = this.devices[sb.id] || {}, h = this.health[sb.id] || {};
    return { id: sb.id, name: d.name || "Central Control", online: this.online(sb.id), since: sb.since || null, syncAt: h.syncAt || null, syncOk: h.syncOk !== false, syncError: h.syncError || null };
  }
  status() {
    return { running: !!this.port, port: this.port, addresses: addresses(), pair: this.pair, error: this.error || null,
      devices: Object.keys(this.devices).length, online: [...this.clients.values()].filter((c) => c.id).length, pedal: this.pedalInfo() };
  }

  serve(req, res) {
    const url = new URL(req.url, "http://x"), p = decodeURIComponent(url.pathname);
    const send = (code, body, type) => { res.writeHead(code, { "Content-Type": type || "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" }); res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
    if (p === "/api/service") return send(200, this.serviceState());
    if (p.startsWith("/api/mirror/") && this.opts.mirror) return this.opts.mirror(req, res, this);   // (hubsync.js: the in-sync computer)
    if (p === "/api/center") return send(200, { app: "central-control-center", name: this.mainName(), port: this.port, pedal: this.pedalInfo() });
    if (p === "/" ) { res.writeHead(302, { Location: "/cu/" }); return res.end(); }
    if (p === "/cu/manifest.webmanifest") return send(200, { name: "Central Usage", short_name: "Central Usage", start_url: "/cu/", scope: "/cu/", display: "standalone", background_color: "#111317", theme_color: "#111317", icons: [{ src: "icon.png", sizes: "512x512", type: "image/png" }] }, "application/manifest+json");
    if (p === "/cu/icon.png") { try { var bd = path.join(this.opts.appDir, "..", "build"); return send(200, fs.readFileSync(fs.existsSync(path.join(bd, "icon-usage.png")) ? path.join(bd, "icon-usage.png") : path.join(bd, "icon.png")), "image/png"); } catch (_) { return send(404, "no icon", "text/plain"); } }
    if (p === "/cu" ) { res.writeHead(302, { Location: "/cu/" }); return res.end(); }
    if (p.startsWith("/cu/")) {
      let rel = p.slice(4) || "index.html"; if (rel.endsWith("/")) rel += "index.html";
      const base = path.resolve(this.opts.appDir), file = path.resolve(base, rel);
      if (!file.startsWith(base + path.sep)) return send(403, "no", "text/plain");
      fs.readFile(file, (err, data) => {
        if (err) return send(404, "not found", "text/plain");
        const ext = path.extname(file).toLowerCase(), types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".json": "application/json", ".ttf": "font/ttf" };
        res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream", "Cache-Control": "no-cache" }); res.end(data);
      });
      return;
    }
    send(404, { error: "not found" });
  }

  connection(ws, req) {
    const ip = String(req.socket.remoteAddress || "").replace(/^::ffff:/, "");
    const info = { id: null, auth: false, main: false, ip, loopback: ip === "127.0.0.1" || ip === "::1" };
    this.clients.set(ws, info);
    ws.on("message", (raw, isBinary) => {
      if (isBinary) { this.talkAudio(ws, info, raw); return; }
      let m; try { m = JSON.parse(String(raw)); } catch (_) { return; }
      let reply = null;
      if (info.id) this.lastMsg[info.id] = Date.now();
      try {
        if (m.type === "auth") { info.auth = !!this.pair && String(m.code || "").trim() === this.pair; reply = { type: "auth", ok: info.auth, for: "center" }; }
        else if (m.type === "ping") reply = { type: "centerPong", t: m.t, serverT: Date.now() };
        else if (m.type === "cuRole") reply = this.handle(ws, info, m);
        else if (m.type === "service") reply = this.handleService(ws, info, m);
        else if (m.type === "audioHost") reply = this.handleAudioHost(ws, info, m);
        else if (m.type === "talk") reply = this.handleTalk(ws, info, m);
      } catch (e) { reply = { type: "cuRoleReply", ok: false, action: m.action, error: "center: " + e.message }; }
      if (reply) this.sendTo(ws, reply);
    });
    ws.on("close", () => { if (info.talk) this.talkEnd(ws, info); if (this.audioHost && this.audioHost.ws === ws) { this.audioHost = null; this.broadcastAudioHost(); } if (info.id && this.devices[info.id]) { this.devices[info.id].lastSeen = Date.now(); this.save(); } this.clients.delete(ws); this.push(); });
    ws.on("error", () => { });
  }
  sendTo(ws, m) { try { if (ws.readyState === 1) ws.send(JSON.stringify(m)); } catch (_) { } }
  socketsOf(id) { const out = []; for (const [ws, c] of this.clients) if (c.id === id) out.push(ws); return out; }
  online(id) { return this.socketsOf(id).length > 0; }
  isMain(info) { return !!(this.main && info.main && info.id === this.main.id); }
  isLocked(id) { if (this.main && id === this.main.id) return false; return !!(this.lock.all || this.lock.devices[id]); }

  // ----------------------------------------------------------------------------- views
  // ---- Central Pedals: which one plays (the main admin's player window unless a pedal is added), what the others do
  pedalIds() { return Object.keys(this.devices).filter((k) => this.devices[k].role === "pedal"); }
  playerId() { return this.pedalIds().find((k) => this.devices[k].pedalJob === "player") || null; }
  // where a pedal is, as seen by the device asking (the main admin's own player window: 127.0.0.1 there, its network address elsewhere)
  pedalAddress(id, forInfo) {
    const d = this.devices[id] || {}, p = d.pedal || {};
    if (p.local) return forInfo && forInfo.loopback ? "127.0.0.1" : (addresses()[0] || "127.0.0.1");
    return p.address || (p.addresses || [])[0] || null;
  }
  pedalView(id, forInfo) {
    const d = this.devices[id]; if (!d) return null; const p = d.pedal || {};
    let h = this.health[id] || null; if (h && Date.now() - h.at > 20000) h = null;
    return { id, name: d.name, job: d.pedalJob || "controller", local: !!p.local, online: this.online(id), address: this.pedalAddress(id, forInfo), addresses: p.addresses || [], port: p.port || 8080, wsPort: p.wsPort || 8081, app: p.app || null, lastSeen: d.lastSeen || 0, health: h };
  }
  pedalInfo(forInfo) { const id = this.playerId(); return id ? this.pedalView(id, forInfo) : null; }
  // a pedal that just paired gets a job: the first one plays; a pedal added while the main admin's window plays takes over
  // (the window keeps the library); any other one is a foot controller until the main admin says otherwise
  firstJob(id) {
    const d = this.devices[id]; if (!d || d.pedalJob) return;
    const cur = this.playerId();
    if (this.tracksHost === "computer" && cur && cur !== id && (this.devices[cur].pedal || {}).local && this.online(cur)) d.pedalJob = "controller";   // (10.0: the computer keeps playing; the pedal controls it)
    else if (!cur) d.pedalJob = "player";
    else if (!(d.pedal || {}).local && (this.devices[cur].pedal || {}).local) { this.devices[cur].pedalJob = this.backup.localIsBackup ? "backup" : "standby"; d.pedalJob = "player"; }
    else d.pedalJob = "controller";
  }
  setPedalJob(id, job) {
    const d = this.devices[id]; if (!d || d.role !== "pedal" || !PEDAL_JOBS.includes(job)) return false;
    const was = d.pedalJob;
    if (job === "player") for (const k of this.pedalIds()) if (k !== id && this.devices[k].pedalJob === "player") this.devices[k].pedalJob = (this.devices[k].pedal || {}).local ? (this.backup.localIsBackup ? "backup" : "standby") : "controller";
    d.pedalJob = job;
    if (was === "player" && job !== "player") {   // nobody plays now: the main admin's own player window takes over again
      const local = this.pedalIds().find((k) => k !== id && (this.devices[k].pedal || {}).local);
      if (local) this.devices[local].pedalJob = "player";
    }
    return true;
  }
  // every pedal hears what it does, where the player is, and the other pedals (their song libraries stay the same)
  tellPedals() {
    const ids = this.pedalIds(), player = this.playerId();
    for (const [ws, c] of this.clients) {
      if (!c.id || !this.devices[c.id] || this.devices[c.id].role !== "pedal") continue;
      const me = this.devices[c.id];
      this.sendTo(ws, { type: "pedalRole", from: "center", job: me.pedalJob || "controller", center: this.mainName(),
        player: player && player !== c.id ? this.pedalView(player, c) : null, youPlay: player === c.id,
        peers: ids.filter((k) => k !== c.id).map((k) => { const v = this.pedalView(k, c); return { id: k, name: v.name, address: v.address, port: v.port, local: v.local, online: v.online }; }) });
    }
  }
  deviceView(id) {
    const d = this.devices[id] || {}; let h = this.health[id] || null; if (h && Date.now() - h.at > 20000) h = null;
    return { id, name: d.name || "", role: d.role || null, jobs: normJobs(d.jobs, d.jobsV), jobsAt: d.jobsAt || 0, paired: !!d.paired, online: this.online(id), lastSeen: d.lastSeen || 0,
      claimsMain: !!d.claimsMain, locked: this.isLocked(id), wantsAdmin: !!d.wantsAdmin, health: h, talkGroup: this.talkGroup(id), edition: d.edition || null };
  }
  // the main admin's talkback groups: users are in the Band, admins in Production, unless the main admin moved them
  talkGroup(id) { const d = this.devices[id] || {}; return TALK_GROUPS.includes(d.talkGroup) ? d.talkGroup : (d.role === "user1" || d.role === "user2" ? "band" : "production"); }
  claimants() {
    const out = []; if (this.main) out.push({ id: this.main.id, name: this.main.name || "", registered: true, online: this.online(this.main.id) });
    for (const [k, d] of Object.entries(this.devices)) if (d.claimsMain && (!this.main || k !== this.main.id)) out.push({ id: k, name: d.name || "", registered: false, online: this.online(k) });
    return out;
  }
  viewFor(info) {
    const mains = this.claimants(), you = info.id ? this.deviceView(info.id) : null;
    const v = { type: "cuRoles", from: "center", hasMain: !!this.main, mainName: this.main ? this.main.name || "" : "", conflict: mains.length > 1 ? mains : [], you,
      youAreMain: this.isMain(info), lockAll: !!this.lock.all, pedal: this.pedalInfo(info), centerName: this.mainName(), audioHost: this.publicAudioHost() };
    const codes = (this.audioHost && this.audioHost.codes) || null, myRole = info.id && this.devices[info.id] ? this.devices[info.id].role : null;
    if (codes && ADMIN_TIER.includes(myRole)) v.hostCodes = { admin: codes.adminCode, user: codes.userCode };
    if (ADMIN_TIER.includes(myRole) || v.youAreMain) v.runners = this.runners();
    else if (codes && (myRole === "user1" || myRole === "user2")) v.hostCodes = { user: codes.userCode };
    if (v.youAreMain) {
      v.devices = Object.keys(this.devices).filter((k) => k !== info.id).map((k) => this.deviceView(k)).sort((a, b) => (b.online - a.online) || a.name.localeCompare(b.name));
      v.pairPin = this.pair; v.pedalHealth = (this.pedalInfo() && this.health[this.pedalInfo().id]) || null;
      v.pedals = this.pedalIds().map((k) => this.pedalView(k, info)).sort((a, b) => (a.job !== "player") - (b.job !== "player") || (b.online - a.online) || a.name.localeCompare(b.name));
      v.pedalJobs = PEDAL_JOBS; v.backupLocal = !!this.backup.localIsBackup; v.tracksHost = this.tracksHost;
      v.standby = this.standbyView();
    }
    if (this.standby && info.id === this.standby.id) v.youAreStandby = true;
    return v;
  }
  push() { for (const [ws, info] of this.clients) if (info.id) this.sendTo(ws, this.viewFor(info)); this.tellPedals(); this.emit({ type: "status" }); }
  // (10.0) the jobs: a computer's own pick (at setup, or in Settings), or the main admin's. The newer one wins.
  setJobs(d, list, at, v) { d.jobs = normJobs(list, v === 2 ? 2 : undefined); d.jobsV = 2; d.jobsAt = Number(at) || Date.now(); }
  jobsOf(id) { const d = this.devices[id] || {}; return normJobs(d.jobs, d.jobsV); }
  // who runs each job now: of the admin computers that are on, the ones that picked it (else the ones doing everything);
  // the one picked to run it, else the main admin, else the one that picked it first. ask: two or more picked it and nobody has
  // said which one runs it yet - each of them shows the question.
  runners() {
    const mainId = this.main ? this.main.id : null, out = {};
    const online = Object.keys(this.devices).filter((k) => ADMIN_TIER.includes(this.devices[k].role) && this.online(k));
    const nm = (k) => (this.devices[k] && this.devices[k].name) || "";
    for (const job of WORK) {
      const picked = [], all = [];
      for (const k of online) { const js = this.jobsOf(k); if (js.includes(job)) picked.push(k); else if (js.includes("general")) all.push(k); }
      const at = (k) => (this.devices[k] && this.devices[k].jobsAt) || 0;   // (the one that had it first keeps it: a computer joining later never takes over by itself)
      const pool = (picked.length ? picked : all).sort((a, b) => ((b === mainId) - (a === mainId)) || at(a) - at(b) || nm(a).localeCompare(nm(b)));
      if (!pool.length) continue;
      const chosen = this.jobRunner[job], runner = pool.includes(chosen) ? chosen : pool[0];
      out[job] = { id: runner, name: nm(runner), others: pool.filter((k) => k !== runner).map((k) => ({ id: k, name: nm(k) })), ask: picked.length > 1 && !picked.includes(chosen) };
    }
    return out;
  }
  pushMainSoon() { const now = Date.now(); if (now - this.pushAt < 500) return; this.pushAt = now; for (const [ws, info] of this.clients) if (this.isMain(info)) this.sendTo(ws, this.viewFor(info)); }
  // 10.0 "computer": the player window plays while it's open; while it's closed a Central Pedal plays; the window
  // takes the tracks back once that pedal isn't playing. Returns true when it changed who plays.
  autoHost() {
    if (this.tracksHost !== "computer") return false;
    const ids = this.pedalIds(), local = ids.find((k) => (this.devices[k].pedal || {}).local), cur = this.playerId();
    const busy = (k) => { const h = this.health[k]; return !!(h && h.playing && Date.now() - h.at < 20000); };
    if (local && this.online(local)) {
      if (cur === local || (cur && this.online(cur) && busy(cur))) return false;
      this.setPedalJob(local, "player");
      return true;
    }
    if (cur && cur !== local && this.online(cur)) return false;
    const pick = ids.filter((k) => k !== local && this.online(k)).sort((a, b) => (this.devices[b].lastSeen || 0) - (this.devices[a].lastSeen || 0))[0];
    if (!pick || pick === cur) return false;
    this.setPedalJob(pick, "player");
    return true;
  }
  tick() {
    if (this.autoHost()) { this.save(); this.push(); }
    this.pushMainSoon();
    const now = Date.now();
    for (const [ws, c] of this.clients) if (c.talk && now - c.talk.last > 6000) this.talkEnd(ws, c);   // (a computer that went quiet mid-talk)
  }
  locked(id) { const c = this.fails[id]; return !!(c && c[1] > Date.now()); }
  wrong(id) { const c = this.fails[id] || (this.fails[id] = [0, 0]); c[0]++; if (c[0] >= 5) { c[0] = 0; c[1] = Date.now() + 60000; } }
  setPair(pin) {
    pin = String(pin || "").trim(); if (!four(pin)) return { ok: false, error: "The PIN is 4 digits." };
    if (this.main && this.main.pinHash && salted(pin, this.main.pinSalt) === this.main.pinHash) return { ok: false, error: "Use a different PIN from the main admin's role PIN." };
    const changed = pin !== this.pair; this.pair = pin; this.save();
    if (changed) for (const [ws, c] of this.clients) this.sendTo(ws, c.auth || c.id ? { type: "pairCodeChanged", code: pin, for: "center" } : { type: "pairReady", for: "center" });
    return { ok: true, code: pin, changed };
  }

  // ----------------------------------------------------------------------------- roles (as the Central Pedal did it)
  handle(ws, info, m) {
    const action = m.action, id = idOf(m.id || info.id), name = clean(m.name), now = Date.now();
    const R = (extra) => Object.assign({ type: "cuRoleReply", action }, extra);
    if (!id) return R({ ok: false, error: "This device has no id." });
    const claim = ROLES.includes(m.role) ? m.role : null;
    const edition = m.edition === "usage" || m.edition === "control" ? m.edition : null;   // Central Usage (musicians) or Central Control (admins)

    if (action === "hello" || action === "join") {
      if (action === "join") {
        if (this.locked(id)) return R({ ok: false, error: "Too many wrong PINs - wait a minute." });
        if (!this.pair) return R({ ok: false, error: "The main admin has not picked its pairing PIN yet." });
        if (String(m.pair || m.code || "").trim() !== this.pair) { this.wrong(id); return R({ ok: false, error: "That pairing PIN is not right. It is the 4 digits the main admin picked (main admin → Settings → This computer)." }); }
        info.id = id; info.auth = true;
        const d = this.devices[id] || (this.devices[id] = {});
        let want = ["admin", "user1", "user2", "pedal"].includes(claim) ? claim : "user1", pending = false;
        if (edition === "usage" && want === "admin") want = "user1";   // (Central Usage is for musicians: User 1 / User 2)
        if (edition) d.edition = edition;
        if (want === "admin" && this.main && d.role !== "admin") {
          const pinOk = this.main.pinHash && salted(String(m.pin || "").trim(), this.main.pinSalt) === this.main.pinHash;
          if (!pinOk) { want = "user1"; pending = true; }
        }
        Object.assign(d, { name: name || d.name || (want === "pedal" ? "Central Pedal" : "Central Control"), role: want, paired: true, lastSeen: now });
        if (Array.isArray(m.jobs) && (want === "admin" || d.wantsAdmin || pending) && (Number(m.jobsAt) || 0) > (d.jobsAt || 0)) this.setJobs(d, m.jobs, m.jobsAt, m.jobsV);
        if (pending) d.wantsAdmin = true; else delete d.wantsAdmin;
        delete d.claimsMain; delete this.fails[id];
        if (want === "pedal") { d.pedal = this.pedalFields(m, info); this.firstJob(id); }
        this.save(); this.push(); this.welcome(ws);
        return R({ ok: true, role: d.role, pending, code: this.pair, center: this.mainName() });
      }
      // hello: who this device is (a paired device on its way back, or the main admin itself)
      if (claim === "main") {
        const token = String(m.token || "");
        if (!this.main) {
          if (token.length < 16) return R({ ok: false, error: "missing token" });
          if (this.opts.loopbackMainOnly && !info.loopback) return R({ ok: false, error: "The main admin is the computer the center runs on." });
          this.main = { id, name: name || "Main admin", tokenSalt: crypto.randomBytes(8).toString("hex") };
          this.main.tokenHash = salted(token, this.main.tokenSalt);
        }
        if (this.main.id === id && salted(token, this.main.tokenSalt) === this.main.tokenHash) {
          info.id = id; info.main = true; info.auth = true; this.main.name = name || this.main.name;
          if (four(m.pin)) { this.main.pinSalt = crypto.randomBytes(8).toString("hex"); this.main.pinHash = salted(String(m.pin), this.main.pinSalt); }
          if (four(m.pair) && !this.pair && String(m.pair) !== String(m.pin)) {   // the main admin's pairing PIN (set once; Settings changes it with setPair)
            this.pair = String(m.pair);
            for (const [w2, c2] of this.clients) if (!c2.id) this.sendTo(w2, { type: "pairReady", for: "center" });   // pedals waiting to pair try again
          }
          const d = this.devices[id] || (this.devices[id] = {});
          Object.assign(d, { name: this.main.name, role: "main", paired: true, lastSeen: now }); delete d.claimsMain;
          if (Array.isArray(m.jobs) && (Number(m.jobsAt) || 0) > (d.jobsAt || 0)) this.setJobs(d, m.jobs, m.jobsAt, m.jobsV);
        } else {
          info.id = id; const d = this.devices[id] || (this.devices[id] = {});
          Object.assign(d, { name: name || d.name || "Central Control", role: "admin", claimsMain: true, lastSeen: now });
        }
        this.save(); this.push(); this.welcome(ws); return null;
      }
      const d = this.devices[id];
      const codeOk = this.pair && String(m.code || "").trim() === this.pair;
      if (!d || !d.paired) {
        if (!codeOk) return R({ ok: false, needPair: true, error: "Pair this device first: type the main admin's pairing PIN." });
        // knows the PIN (e.g. from an older pairing with the Central Pedal): it joins as what it says, users only
        const nd = this.devices[id] = { name: name || "Central Control", role: claim === "pedal" ? "pedal" : ["user1", "user2"].includes(claim) ? claim : "user1", paired: true, lastSeen: now };
        if (claim === "admin" && this.main) nd.wantsAdmin = true; else if (claim === "admin") nd.role = "admin";
      }
      info.id = id; info.auth = true;
      const dd = this.devices[id];
      if (this.pair && m.code && String(m.code).trim() !== this.pair) this.sendTo(ws, { type: "pairCodeChanged", code: this.pair, for: "center" });   // paired before the main admin changed the PIN
      if (!this.main && ["admin", "user1", "user2"].includes(claim)) dd.role = claim;   // no main admin yet: every device chooses
      if (dd.role === "main" && (!this.main || this.main.id !== id)) dd.role = "admin";
      if (claim === "pedal" || dd.role === "pedal") { dd.role = "pedal"; dd.pedal = this.pedalFields(m, info); this.firstJob(id); }
      delete dd.claimsMain; dd.name = name || dd.name || "Central Control"; dd.lastSeen = now;
      if (Array.isArray(m.jobs) && ADMIN_TIER.includes(dd.role) && (Number(m.jobsAt) || 0) > (dd.jobsAt || 0)) this.setJobs(dd, m.jobs, m.jobsAt, m.jobsV);
      if (edition) { dd.edition = edition; if (edition === "usage" && (dd.role === "admin" || dd.role === "main")) { dd.role = "user1"; delete dd.wantsAdmin; } }
      this.save(); this.push(); this.welcome(ws); return null;
    }

    if (!info.id || id !== info.id) return R({ ok: false, error: "Say hello first." });
    const d = this.devices[id]; if (!d) return R({ ok: false, error: "This device is not known yet." });
    const main = this.isMain(info), mainName = this.main ? this.main.name : "";

    if (action === "health") {
      const h = {}; let n = 0;
      for (const [k, v] of Object.entries(m.health || {})) { if (n >= 20) break; if (typeof v === "number" || typeof v === "boolean" || (typeof v === "string" && v.length < 60)) { h[String(k).slice(0, 20)] = v; n++; } }
      h.at = now; this.health[id] = h; this.pushMainSoon(); return null;
    }
    if (action === "set") {
      const want = m.role;
      if (!["admin", "user1", "user2"].includes(want)) return R({ ok: false, error: "Pick Admin, User 1 or User 2." });
      const have = d.role;
      if (have === "main") return R({ ok: false, error: "The main admin stays the main admin. To give it up use Forget role." });
      const same = (["user1", "user2"].includes(have) && ["user1", "user2"].includes(want)) || have === want;
      if (!same && this.main) {
        if (want === "admin" && m.ask) { d.wantsAdmin = true; this.save(); this.push(); return R({ ok: true, role: have, pending: true }); }
        if (this.locked(id)) return R({ ok: false, error: "Too many wrong PINs - wait a minute." });
        if (!this.main.pinHash || salted(String(m.pin || "").trim(), this.main.pinSalt) !== this.main.pinHash) { this.wrong(id); return R({ ok: false, error: "Wrong PIN. The main admin's role PIN is in its Settings." }); }
      }
      d.role = want; delete d.claimsMain; delete d.wantsAdmin; delete this.fails[id]; this.save(); this.push(); return R({ ok: true, role: want });
    }
    if (action === "forget") {
      if (this.main && this.main.id === id) {
        if (salted(String(m.token || ""), this.main.tokenSalt) !== this.main.tokenHash) return R({ ok: false, error: "Only the main admin itself can give up the role." });
        this.main = null; info.main = false;
      }
      delete this.devices[id]; this.save(); this.push(); return R({ ok: true });
    }
    if (action === "myJobs") {
      if (!main && !ADMIN_TIER.includes(d.role)) return R({ ok: false, error: "Jobs are for the main admin's and the admins' computers." });
      this.setJobs(d, m.jobs, Date.now(), m.jobsV);
      this.save(); this.push(); return R({ ok: true, jobs: d.jobs, jobsAt: d.jobsAt });
    }
    if (action === "runJob") {   // (10.0) two computers have the same job: which one runs it
      const job = String(m.job || ""), target = idOf(m.target || id), t = this.devices[target];
      if (!WORK.includes(job)) return R({ ok: false, error: "No such job." });
      if (!t || !ADMIN_TIER.includes(t.role)) return R({ ok: false, error: "That computer isn't on the admin side." });
      const mine = this.jobsOf(id), theirs = this.jobsOf(target);
      if (!main && !(mine.includes(job) || mine.includes("general"))) return R({ ok: false, error: "Only the main admin, or a computer with that job, picks who runs it." });
      if (!(theirs.includes(job) || theirs.includes("general"))) return R({ ok: false, error: (t.name || "That computer") + " doesn't have that job." });
      this.jobRunner[job] = target; this.save(); this.push(); return R({ ok: true, job, runner: target });
    }
    if (action === "standby") {   // keep the other main admin's computer in sync (one at a time)
      if (!main) return R({ ok: false, error: "Only the main admin." });
      const target = idOf(m.target), on = m.on !== false, td = this.devices[target];
      const tell = (msg) => { for (const tw of this.socketsOf(target)) this.sendTo(tw, Object.assign({ from: "center", hub: this.hubKey }, msg)); };
      if (!on) {
        if (this.standby && this.standby.id === target) { this.standby = null; tell({ type: "standbyCleared" }); }
        this.save(); this.push(); return R({ ok: true });
      }
      if (!td || td.role !== "admin") return R({ ok: false, error: "Only an admin computer can be kept in sync. Make it an admin first." });
      if (td.edition !== "control") return R({ ok: false, error: "That device isn't running Central Control on a computer, so it can't keep a copy." });
      if (!this.online(target)) return R({ ok: false, error: td.name + " isn't on right now. Open Central Control on it, then try again." });
      if (this.standby && this.standby.id !== target) { const prev = this.standby.id; this.standby = null; for (const tw of this.socketsOf(prev)) this.sendTo(tw, { type: "standbyCleared", from: "center", hub: this.hubKey }); }
      const secret = crypto.randomBytes(24).toString("hex"), secretSalt = crypto.randomBytes(8).toString("hex");
      this.standby = { id: target, secretSalt, secretHash: salted(secret, secretSalt), since: now };
      tell({ type: "standbyAssigned", secret, hubName: this.mainName(), port: this.port });
      this.save(); this.push(); return R({ ok: true });
    }
    if (action === "setPair") { if (!main) return R({ ok: false, error: "Only the main admin." }); const r = this.setPair(m.pair); if (!r.ok) return R(r); this.push(); return R({ ok: true, pair: r.code }); }
    if (action === "lock") {
      if (!main) return R({ ok: false, error: "Only the main admin locks." });
      const on = !!m.on, target = idOf(m.target || "all") || "all";
      if (target === "all") { this.lock.all = on; if (!on) this.lock.devices = {}; }
      else if (this.devices[target]) { if (on) this.lock.devices[target] = true; else delete this.lock.devices[target]; }
      else return R({ ok: false, error: "No such device." });
      this.save(); this.push(); return R({ ok: true });
    }
    if (action === "talkGroup") {
      if (!main) return R({ ok: false, error: "Only the main admin puts devices in the Band or Production." });
      const t = this.devices[idOf(m.target)]; if (!t || !TALK_GROUPS.includes(m.group)) return R({ ok: false, error: "No such device, or no such group." });
      t.talkGroup = m.group; this.save(); this.push(); return R({ ok: true });
    }
    // the backup player lost the track player mid-song: it plays now (only if the player is really gone - its
    // heartbeat stopped - so a backup that just lost its own Wi-Fi doesn't start a second copy)
    if (action === "takeover") {
      const me = this.devices[id], cur = this.playerId();
      if (!me || me.role !== "pedal" || me.pedalJob !== "backup") return R({ ok: false, error: "Only a backup player takes over." });
      const gone = !cur || cur === id || !this.online(cur) || Date.now() - (this.lastMsg[cur] || 0) > PLAYER_GONE_MS;
      if (!gone) return R({ ok: false, error: "The track player is still there.", playerAlive: true });
      this.setPedalJob(id, "player");
      if (cur && cur !== id && this.devices[cur]) this.devices[cur].pedalJob = "standby";
      this.save(); this.push(); this.emit({ type: "takeover", id, from: cur });
      return R({ ok: true });
    }
    if (action === "backupLocal") {
      if (!main) return R({ ok: false, error: "Only the main admin sets the backup player." });
      this.backup.localIsBackup = !!m.on;
      const local = this.pedalIds().find((k) => (this.devices[k].pedal || {}).local), cur = this.playerId();
      if (local && cur && cur !== local) this.devices[local].pedalJob = m.on ? "backup" : "standby";
      this.save(); this.push(); return R({ ok: true });
    }
    if (action === "pedalJob") {
      if (!main) return R({ ok: false, error: "Only the main admin gives the Central Pedals their jobs." });
      const tg = idOf(m.target);
      if (!this.setPedalJob(tg, m.job)) return R({ ok: false, error: "No such Central Pedal, or no such job." });
      if (m.job === "player") this.tracksHost = ((this.devices[tg] || {}).pedal || {}).local ? "computer" : "pedal";   // (picking who plays says where the tracks run)
      this.save(); this.push(); return R({ ok: true });
    }
    if (action === "tracksHost") {   // 10.0: "computer" (the player window plays, the pedals control it) or "pedal"
      if (!main) return R({ ok: false, error: "Only the main admin decides where the tracks run." });
      if (!["computer", "pedal"].includes(m.mode)) return R({ ok: false, error: "computer or pedal" });
      this.tracksHost = m.mode;
      if (m.mode === "pedal") { const cur = this.playerId(); if (cur && ((this.devices[cur] || {}).pedal || {}).local) { const p = this.pedalIds().find((k) => !((this.devices[k].pedal || {}).local) && this.online(k)); if (p) this.setPedalJob(p, "player"); } }
      this.autoHost(); this.save(); this.push(); return R({ ok: true, mode: this.tracksHost });
    }
    if (["assign", "rename", "remove", "jobs", "approve"].includes(action)) {
      if (!main) return R({ ok: false, error: "Only the main admin changes other devices." });
      const target = idOf(m.target), t = this.devices[target];
      if (!t || target === id) return R({ ok: false, error: "No such device." });
      const tell = (msg) => { for (const tw of this.socketsOf(target)) this.sendTo(tw, Object.assign({ type: "cuRoleAssigned", by: mainName }, msg)); };
      if (action === "approve") { const want = m.allow ? "admin" : "user1"; t.role = want; delete t.wantsAdmin; tell({ role: want, approved: !!m.allow }); }
      else if (action === "assign") {
        if (t.role === "pedal") return R({ ok: false, error: "A Central Pedal stays a pedal - give it a job (track player, foot controller, instrument rig) instead." });
        if (!["admin", "user1", "user2"].includes(m.role)) return R({ ok: false, error: "Pick Admin, User 1 or User 2." });
        if (m.role === "admin" && t.edition === "usage") return R({ ok: false, error: "That device runs Central Usage (for musicians: User 1 / User 2). For an admin, install Central Control on it." });
        t.role = m.role; delete t.claimsMain; delete t.wantsAdmin; tell({ role: m.role });
        if (m.role !== "admin" && this.standby && this.standby.id === target) { this.standby = null; for (const tw of this.socketsOf(target)) this.sendTo(tw, { type: "standbyCleared", from: "center", hub: this.hubKey }); }   // (only an admin computer keeps the copy)
      }
      else if (action === "jobs") { this.setJobs(t, m.jobs, Date.now(), m.jobsV); tell({ role: t.role, jobsAt: t.jobsAt, jobs: t.jobs }); }
      else if (action === "rename") { t.name = clean(m.newName) || t.name; tell({ name: t.name, role: t.role }); }
      else { if (t.role === "pedal" && t.pedalJob === "player") this.setPedalJob(target, "standby"); if (this.standby && this.standby.id === target) { this.standby = null; for (const tw of this.socketsOf(target)) this.sendTo(tw, { type: "standbyCleared", from: "center", hub: this.hubKey }); } delete this.devices[target]; tell({ role: null, removed: true }); }
      this.save(); this.push(); return R({ ok: true });
    }
    return R({ ok: false, error: "Unknown action." });
  }
  welcome(ws) { this.sendTo(ws, this.serviceState()); this.sendTo(ws, { type: "audioHost", from: "center", host: this.publicAudioHost() }); }
  pedalFields(m, info) {
    const p = m.pedal || {};
    return { address: info.ip && !info.loopback ? info.ip : (p.address || info.ip), local: !!info.loopback, addresses: (p.addresses || []).slice(0, 8).map(String), port: Number(p.port) || 8080, wsPort: Number(p.wsPort) || 8081, app: clean(p.app, 20) };
  }

  // ----------------------------------------------------------------------------- talkback
  // to:"main" - any device talks to the main admin's headphones; to:"group" - only the main admin, to the devices of
  // the Band or Production it names (the ones without an in-ear mix of their own - the others hear it in their mix)
  handleTalk(ws, info, m) {
    const R = (extra) => Object.assign({ type: "talkReply", seq: m.seq }, extra);
    if (!info.id || !this.devices[info.id]) return R({ ok: false, error: "Pair with the main admin first." });
    if (!m.on) { this.talkEnd(ws, info); return R({ ok: true, on: false }); }
    const name = clean(m.name) || this.devices[info.id].name || "Someone";
    let to = [], group = null;
    if (m.to === "group") {
      if (!this.isMain(info)) return R({ ok: false, error: "Only the main admin talks to the Band or Production." });
      group = TALK_GROUPS.includes(m.group) ? m.group : null; if (!group) return R({ ok: false, error: "Band or Production?" });
      const want = new Set((Array.isArray(m.devices) ? m.devices : []).map(idOf));
      to = Object.keys(this.devices).filter((k) => want.has(k) && k !== info.id && this.devices[k].role !== "pedal" && this.talkGroup(k) === group);
    } else {
      if (!this.main) return R({ ok: false, error: "There is no main admin yet." });
      if (this.isMain(info)) return R({ ok: false, error: "That is you." });
      to = [this.main.id];
    }
    if (info.talk) this.talkEnd(ws, info, true);
    info.talk = { to, group, name, kind: m.to === "group" ? "group" : "main", since: Date.now(), last: Date.now() };
    const online = to.filter((k) => this.online(k));
    const note = { type: "talkFrom", on: true, id: info.id, name, group, kind: info.talk.kind };
    for (const k of online) for (const w of this.socketsOf(k)) this.sendTo(w, note);
    return R({ ok: true, on: true, receivers: online.length });
  }
  talkAudio(ws, info, raw) {
    const t = info.talk; if (!t) return;
    const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    if (buf.length < 12 || buf.length > 8192 || buf.toString("latin1", 0, 4) !== "TKA1") return;
    t.last = Date.now();
    const id = Buffer.from(String(info.id).slice(0, 48), "latin1"), out = Buffer.concat([Buffer.from("TKC1", "latin1"), Buffer.from([id.length]), id, buf]);
    for (const k of t.to) for (const w of this.socketsOf(k)) { try { if (w.readyState === 1 && w.bufferedAmount < 1 << 18) w.send(out, { binary: true }); } catch (_) { } }
  }
  talkEnd(ws, info, quiet) {
    const t = info.talk; if (!t) return; info.talk = null;
    if (quiet) return;
    const note = { type: "talkFrom", on: false, id: info.id, name: t.name, group: t.group, kind: t.kind };
    for (const k of t.to) for (const w of this.socketsOf(k)) this.sendTo(w, note);
  }

  // ----------------------------------------------------------------------------- the audio host (in-ears): one computer makes the mixes, every other one finds it here
  publicAudioHost() { const h = this.audioHost; return h ? { name: h.name, address: h.address, port: h.port, since: h.since } : null; }
  broadcastAudioHost() { const m = { type: "audioHost", from: "center", host: this.publicAudioHost() }; for (const [ws, c] of this.clients) if (c.id || c.auth) this.sendTo(ws, m); this.push(); }
  handleAudioHost(ws, info, m) {
    if (!(info.id || info.auth)) return { type: "auth", ok: false, for: "audioHost" };
    const role = info.id && this.devices[info.id] ? this.devices[info.id].role : null;
    if (!ADMIN_TIER.includes(role)) return { type: "refused", for: "audioHost", error: "Only an admin can do that - ask the main admin." };
    if (m.action === "register") {
      const address = clean(m.address, 64) || (info.loopback ? (addresses()[0] || info.ip) : info.ip);
      const codes = {}; for (const k of ["userCode", "adminCode"]) if (m[k]) codes[k] = clean(m[k], 12);
      this.audioHost = { name: clean(m.name) || "Central Control", address, port: Number(m.port) || 8092, since: Date.now(), ws, codes };
    } else if (m.action === "unregister" && this.audioHost && this.audioHost.ws === ws) this.audioHost = null;
    this.broadcastAudioHost(); return null;
  }

  // ----------------------------------------------------------------------------- services
  cleanService(sv) {
    sv = sv && typeof sv === "object" ? sv : {};
    const roles = Array.isArray(sv.roles) ? sv.roles.filter((r) => SERVICE_ROLES.includes(r)) : SERVICE_ROLES.slice();
    const out = { id: idOf(sv.id) || "sv" + crypto.randomBytes(4).toString("hex"), name: clean(sv.name) || "Service", day: Math.max(0, Math.min(6, parseInt(sv.day, 10) || 0)),
      time: /^\d{1,2}:\d{2}$/.test(String(sv.time || "")) ? String(sv.time) : "09:00", roles, record: !!sv.record, items: [] };
    for (const it of (Array.isArray(sv.items) ? sv.items : []).slice(0, 80)) {
      if (!it || typeof it !== "object") continue;
      let mins = Number(it.minutes); if (!isFinite(mins)) mins = 5; mins = Math.max(0, Math.min(240, mins));
      out.items.push({ id: idOf(it.id) || "it" + crypto.randomBytes(4).toString("hex"), title: clean(it.title, 60) || "Item", kind: SERVICE_KINDS.includes(it.kind) ? it.kind : "other",
        minutes: Math.round(mins * 100) / 100, roles: (it.roles || []).filter((r) => SERVICE_ROLES.includes(r) && roles.includes(r)), song: clean(it.song, 64), note: clean(it.note, 120) });
    }
    return out;
  }
  serviceState() { return { type: "services", from: "center", services: this.services, run: this.run, now: Date.now(), roles: SERVICE_ROLES, kinds: SERVICE_KINDS, max: MAX_SERVICES }; }
  broadcastServices() { const st = this.serviceState(); for (const [ws, c] of this.clients) if (c.id || c.auth) this.sendTo(ws, st); this.emit({ type: "services", state: st }); }
  handleService(ws, info, m) {
    const R = (extra) => Object.assign({ type: "serviceReply", action: m.action }, extra);
    if (!(info.id || info.auth)) return { type: "auth", ok: false, for: "center" };
    if (m.action === "get") return this.serviceState();
    if (!this.isMain(info)) return R({ ok: false, error: "Only the main admin plans and runs services." });
    const now = Date.now();
    if (m.action === "save") {
      const list = (Array.isArray(m.services) ? m.services : []).map((s) => this.cleanService(s));
      if (list.length > MAX_SERVICES) return R({ ok: false, error: "Up to " + MAX_SERVICES + " services." });
      this.services = list; if (this.run && !list.some((s) => s.id === this.run.service)) this.run = null;
    } else if (m.action === "start") {
      const sv = this.services.find((s) => s.id === m.service); if (!sv || !sv.items.length) return R({ ok: false, error: "Pick a service with items in it." });
      this.run = { service: sv.id, item: 0, itemStart: now, startedAt: now };
    } else if (["next", "prev", "goto"].includes(m.action)) {
      if (!this.run) return R({ ok: false, error: "No service is running." });
      const sv = this.services.find((s) => s.id === this.run.service), n = sv ? sv.items.length : 0;
      const i = m.action === "goto" ? parseInt(m.item, 10) || 0 : this.run.item + (m.action === "next" ? 1 : -1);
      if (i >= n) this.run = null; else { this.run.item = Math.max(0, i); this.run.itemStart = now; }
    } else if (m.action === "stop") this.run = null;
    else return R({ ok: false, error: "Unknown action." });
    this.save(); this.broadcastServices(); return R({ ok: true });
  }
}

module.exports = { Center, BEACON_PORT, PEDAL_JOBS, TALK_GROUPS, salted };

// on its own: node center.js --port 8095 --data <folder> [--app <folder>] [--no-beacon]
if (require.main === module) {
  const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
  const c = new Center({ port: Number(arg("--port", 8095)), dataDir: arg("--data", path.join(os.homedir(), ".central-control-center")), appDir: arg("--app", path.join(__dirname, "app")), beacon: !process.argv.includes("--no-beacon") });
  c.start().then((ok) => { console.log(ok ? "center listening on " + c.port : "center could not start: " + c.error); if (!ok) process.exit(1); });
  process.on("SIGTERM", () => c.stop().then(() => process.exit(0)));
}
