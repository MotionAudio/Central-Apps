/* hubsync.js - the second main admin's computer stays in sync with the hub, so it can take over at any time.
 *
 * The hub is the main admin's computer: it runs the center (center.js), so it holds the paired devices and the PINs
 * (center.json), the song library and tracks (player/), the mixer (mixer.json), the cameras (video.json) and - from its
 * window - the lighting rig and cues, the slides and the timecode settings (hub-state.json). A church has up to 2 main
 * admins: the hub marks the other main admin's computer "in sync" on its Devices tab, and that computer copies all of it
 * every minute into its own folder (standby/).
 *
 * Take over as the hub (on the in-sync computer, with the main admin's role PIN):
 *   - the hub is on: one last copy, then the hub hands over - it becomes an admin computer and keeps itself in sync
 *     with the new hub (the two have swapped places);
 *   - the hub is off or broken: the last copy is used. When the old hub comes back it hears the new hub (same church,
 *     newer generation, center.js's beacon) and steps down to an admin computer by itself.
 * Every phone, tablet, computer and Central Pedal keeps its pairing (the device list and the pairing PIN move with the
 * hub), and finds the new hub on the network the way it found the old one.
 *
 * The hub side answers under /api/mirror/ on the center's port (center.js hands those requests here); every request
 * carries the in-sync computer's secret (x-mirror), which the center checks against its hash. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");

const FILES = ["center.json", "mixer.json", "video.json", "hub-state.json"];   // the hub's own files that move with it
const DIRS = ["player"];                                                         // ...and its folders (the song library and tracks)
const SKIP = /(\.log|\.part|\.tmp|~)$/i;
// what the hub's window keeps that belongs to the church, not to that computer: the lighting rig and cues, the slides,
// the timecode settings (each person's own preferences, screens and microphone stay on their own computer)
const HUB_KEYS = ["cu-rig", "cu-lxLook", "cu-lxSong", "cu-slides", "cu-sendClock", "cu-offsetMs", "cu-timecode"];

function walk(root, rel, out) {
  let list = []; try { list = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch (_) { return out; }
  for (const d of list) {
    const r = rel ? rel + "/" + d.name : d.name;
    if (d.isDirectory()) walk(root, r, out);
    else if (d.isFile() && !SKIP.test(d.name)) out.push(r);
  }
  return out;
}
// the files the hub shares: [{ p: "player/songs/x.wav", size, mtime }]
function manifest(dataDir) {
  const rels = FILES.filter((f) => fs.existsSync(path.join(dataDir, f)));
  for (const d of DIRS) walk(dataDir, d, rels);
  return rels.map((p) => { const st = fs.statSync(path.join(dataDir, p)); return { p, size: st.size, mtime: Math.floor(st.mtimeMs) }; });
}
// a shared file's place on disk (only the files above; nothing outside them)
function inside(dataDir, rel) {
  rel = String(rel || "").replace(/\\/g, "/");
  if (!rel || rel.startsWith("/") || rel.split("/").some((x) => x === ".." || x === "")) return null;
  if (!FILES.includes(rel) && !DIRS.some((d) => rel.startsWith(d + "/"))) return null;
  return path.join(dataDir, ...rel.split("/"));
}

// ---------------------------------------------------------------- the hub
// serveMirror(req, res, { dataDir, check(secret) -> bool, before() (the center saves first), handover(secret) })
function serveMirror(req, res, o) {
  const url = new URL(req.url, "http://x"), p = url.pathname;
  const send = (code, body) => { res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(body)); };
  const secret = String(req.headers["x-mirror"] || "");
  if (!secret || !o.check(secret)) return send(403, { error: "not the in-sync computer" });
  if (p === "/api/mirror/manifest" && req.method === "GET") {
    try { if (o.before) o.before(); } catch (_) { }
    return send(200, { at: Date.now(), files: manifest(o.dataDir), info: o.info ? o.info() : {} });
  }
  if (p === "/api/mirror/file" && req.method === "GET") {
    const f = inside(o.dataDir, url.searchParams.get("p"));
    if (!f) return send(400, { error: "not a shared file" });
    let st; try { st = fs.statSync(f); } catch (_) { return send(404, { error: "gone" }); }
    res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": st.size, "X-Mtime": String(Math.floor(st.mtimeMs)) });
    const s = fs.createReadStream(f); s.on("error", () => res.destroy()); s.pipe(res);
    return;
  }
  if (p === "/api/mirror/handover" && req.method === "POST") {
    send(200, { ok: true });
    const from = { host: String(req.socket.remoteAddress || "").replace(/^::ffff:/, ""), port: Number(url.searchParams.get("port")) || 0 };   // (the new hub: where to copy from next)
    setTimeout(() => { try { o.handover(secret, from); } catch (e) { console.error("handover:", e.message); } }, 200);   // (after the answer is out)
    return;
  }
  send(404, { error: "not found" });
}

// ---------------------------------------------------------------- the in-sync computer
function request(method, host, port, p, secret, timeout) {
  return new Promise((resolve, reject) => {
    const req = http.request({ method, host, port, path: p, headers: { "x-mirror": secret }, timeout: timeout || 15000 }, resolve);
    req.on("timeout", () => req.destroy(new Error("the hub didn't answer")));
    req.on("error", reject);
    req.end();
  });
}
async function json(method, host, port, p, secret, timeout) {
  const res = await request(method, host, port, p, secret, timeout);
  let b = ""; res.setEncoding("utf8");
  for await (const c of res) { b += c; if (b.length > 50e6) throw new Error("too big"); }
  let j = {}; try { j = JSON.parse(b); } catch (_) { }
  if (res.statusCode !== 200) throw new Error(j.error || "the hub answered " + res.statusCode);
  return j;
}
// one sync: copies what changed on the hub into dest, removes what the hub no longer has. -> { files, bytes, got, removed, info }
async function syncFrom({ host, port, secret, dest }) {
  const m = await json("GET", host, port, "/api/mirror/manifest", secret, 15000);
  const want = new Map(m.files.map((f) => [f.p, f]));
  let got = 0, bytes = 0, removed = 0;
  for (const f of m.files) {
    bytes += f.size;
    const local = path.join(dest, ...f.p.split("/"));
    try { const st = fs.statSync(local); if (st.size === f.size && Math.abs(st.mtimeMs - f.mtime) < 2) continue; } catch (_) { }   // (file times keep about a millisecond)
    fs.mkdirSync(path.dirname(local), { recursive: true });
    const res = await request("GET", host, port, "/api/mirror/file?p=" + encodeURIComponent(f.p), secret, 60000);
    if (res.statusCode === 404) { res.resume(); continue; }   // (deleted on the hub meanwhile)
    if (res.statusCode !== 200) { res.resume(); throw new Error("the hub answered " + res.statusCode + " for " + f.p); }
    const tmp = local + ".part";
    await new Promise((ok, bad) => { const out = fs.createWriteStream(tmp); res.pipe(out); out.on("finish", ok); out.on("error", bad); res.on("error", bad); });
    fs.renameSync(tmp, local);
    const t = new Date(Number(res.headers["x-mtime"]) || f.mtime); fs.utimesSync(local, t, t);
    got++;
  }
  for (const rel of walk(dest, "", [])) if (rel !== ".sync.json" && !want.has(rel)) { try { fs.unlinkSync(path.join(dest, ...rel.split("/"))); removed++; } catch (_) { } }
  const out = { at: Date.now(), files: m.files.length, bytes, got, removed, info: m.info || {} };
  fs.mkdirSync(dest, { recursive: true });
  fs.writeFileSync(path.join(dest, ".sync.json"), JSON.stringify(out));
  return out;
}
function lastSync(dest) { try { return JSON.parse(fs.readFileSync(path.join(dest, ".sync.json"), "utf8")); } catch (_) { return null; } }
async function handover({ host, port, secret, myPort }) { return json("POST", host, port, "/api/mirror/handover" + (myPort ? "?port=" + Number(myPort) : ""), secret, 8000); }

// ---------------------------------------------------------------- taking over
// Is this the main admin's role PIN? (from the copy of the hub's center.json)
function pinOk(dest, pin, salted) {
  let j = {}; try { j = JSON.parse(fs.readFileSync(path.join(dest, "center.json"), "utf8")); } catch (_) { return null; }
  const m = j.main; if (!m || !m.pinHash) return null;
  return salted(String(pin || "").trim(), m.pinSalt) === m.pinHash;
}
// the copy becomes this computer's hub data. -> { hubState, oldMain, gen }
function promote({ userData, dest, deviceId, name, token, planned, salted }) {
  const j = JSON.parse(fs.readFileSync(path.join(dest, "center.json"), "utf8"));
  const old = j.main || null, devices = j.devices || {};
  if (old && old.id !== deviceId) {   // the old hub: an admin computer now (paired already)
    const d = devices[old.id] || (devices[old.id] = {});
    Object.assign(d, { name: old.name || d.name || "Central Control", role: "admin", paired: true, edition: "control" }); delete d.claimsMain; delete d.wantsAdmin;
  }
  const me = devices[deviceId] || (devices[deviceId] = {});
  Object.assign(me, { name: name || me.name || "Main admin", role: "main", paired: true, edition: "control" }); delete me.claimsMain; delete me.wantsAdmin;
  const tokenSalt = crypto.randomBytes(8).toString("hex");
  j.main = { id: deviceId, name: name || "Main admin", tokenSalt, tokenHash: salted(token, tokenSalt), pinSalt: old && old.pinSalt, pinHash: old && old.pinHash };
  j.devices = devices;
  j.gen = (Number(j.gen) || 1) + 1;
  j.standby = planned && old && j.standby && old.id !== deviceId ? { id: old.id, secretSalt: j.standby.secretSalt, secretHash: j.standby.secretHash, since: Date.now() } : null;
  // the files: the copy's take the place of this computer's (its own player folder is kept aside, once)
  for (const f of FILES) {
    if (f === "center.json" || f === "hub-state.json") continue;
    const from = path.join(dest, f); if (fs.existsSync(from)) fs.copyFileSync(from, path.join(userData, f));
  }
  for (const d of DIRS) {
    const from = path.join(dest, d), to = path.join(userData, d), aside = path.join(userData, d + ".before-takeover");
    if (!fs.existsSync(from)) continue;
    fs.rmSync(aside, { recursive: true, force: true });
    if (fs.existsSync(to)) fs.renameSync(to, aside);
    fs.renameSync(from, to);
  }
  fs.writeFileSync(path.join(userData, "center.json"), JSON.stringify(j));
  let hubState = {}; try { hubState = JSON.parse(fs.readFileSync(path.join(dest, "hub-state.json"), "utf8")); } catch (_) { }
  return { hubState, oldMain: old && old.id, gen: j.gen };
}

module.exports = { HUB_KEYS, FILES, DIRS, manifest, serveMirror, syncFrom, lastSync, handover, pinOk, promote };
