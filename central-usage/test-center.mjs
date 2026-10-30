// The center (center.js) on its own: the main admin registers from this computer, devices pair with the PIN,
// roles / approval / locks / jobs / health / services / the audio host / the Central Pedal pairing as "pedal".
//   node test-center.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const { Center } = require("./center.js");
const WebSocket = require("ws");

let fails = 0;
const ok = (c, msg, d) => { console.log((c ? "ok   " : "FAIL ") + msg + (c || d === undefined ? "" : "  -- " + JSON.stringify(d).slice(0, 600))); if (!c) fails++; };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "center-"));
const center = new Center({ port: 0, dataDir: dir, beacon: false });
await center.start();
const port = center.port;
ok(port > 0, "center listens (" + port + ")");

function client(host) {
  return new Promise((resolve) => {
    const ws = new WebSocket("ws://" + (host || "127.0.0.1") + ":" + port), q = [], waiters = [];
    ws.on("message", (raw, isBin) => { const m = isBin ? { type: "__bin", buf: Buffer.from(raw) } : JSON.parse(String(raw)); const i = waiters.findIndex((w) => w.f(m)); if (i >= 0) { const w = waiters.splice(i, 1)[0]; w.r(m); } else q.push(m); });
    ws.on("open", () => resolve({
      ws, q,
      send: (m) => ws.send(JSON.stringify(m)),
      wait: (f, ms) => new Promise((r) => { const i = q.findIndex(f); if (i >= 0) return r(q.splice(i, 1)[0]); const w = { f, r }; waiters.push(w); setTimeout(() => { const j = waiters.indexOf(w); if (j >= 0) { waiters.splice(j, 1); r(null); } }, ms || 2000); }),
      last: (type) => { for (let i = q.length - 1; i >= 0; i--) if (q[i].type === type) return q[i]; return null; },
      close: () => ws.close()
    }));
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TOKEN = "t".repeat(32);

// the main admin
const main = await client();
main.send({ type: "cuRole", action: "hello", id: "dMain", name: "Sound desk", role: "main", token: TOKEN, pin: "4321", pair: "0915" });
let v = await main.wait((m) => m.type === "cuRoles" && m.youAreMain);
ok(v && v.youAreMain && v.pairPin === "0915", "main admin registers from this computer, pairing PIN 0915");
ok(v && v.pedal === null, "no Central Pedal yet - works without one");

// a device with the wrong PIN, then the right one
const u = await client();
u.send({ type: "cuRole", action: "join", id: "dUser", name: "Keys", role: "user1", pair: "1111" });
let r = await u.wait((m) => m.type === "cuRoleReply" && m.action === "join");
ok(r && !r.ok, "wrong pairing PIN refused");
u.send({ type: "cuRole", action: "join", id: "dUser", name: "Keys", role: "user1", pair: "0915" });
r = await u.wait((m) => m.type === "cuRoleReply" && m.action === "join");
ok(r && r.ok && r.role === "user1" && r.code === "0915", "pairs as User 1 with the PIN");
v = await main.wait((m) => m.type === "cuRoles" && (m.devices || []).some((d) => d.id === "dUser"));
ok(!!v, "the main admin sees the new device");
ok(!!(await u.wait((m) => m.type === "services")), "a paired device gets the services");

// admin without the role PIN -> asks; the main admin approves
const a = await client();
a.send({ type: "cuRole", action: "join", id: "dAdmin", name: "Lights", role: "admin", pair: "0915" });
r = await a.wait((m) => m.type === "cuRoleReply" && m.action === "join");
ok(r && r.ok && r.pending && r.role === "user1", "admin without the role PIN starts as User 1 and asks");
main.send({ type: "cuRole", action: "approve", id: "dMain", target: "dAdmin", allow: true });
const as = await a.wait((m) => m.type === "cuRoleAssigned");
ok(as && as.role === "admin", "the main admin approves: Admin");
main.send({ type: "cuRole", action: "jobs", id: "dMain", target: "dAdmin", jobs: ["lighting"] });
const aj = await a.wait((m) => m.type === "cuRoleAssigned" && m.jobs);
ok(aj && aj.jobs[0] === "lights", "jobs reach the admin (an older computer's \"lighting\" is the Lights job)");

// (10.0) jobs: an admin computer picks its own; two computers with the same job - the center says which one runs it
main.send({ type: "cuRole", action: "myJobs", id: "dMain", jobs: ["general"], jobsV: 2 });
await main.wait((m) => m.type === "cuRoleReply" && m.action === "myJobs");
a.send({ type: "cuRole", action: "myJobs", id: "dAdmin", jobs: ["lights", "slides", "lyrics"], jobsV: 2 });
let rj = await a.wait((m) => m.type === "cuRoleReply" && m.action === "myJobs");
ok(rj && rj.ok && rj.jobs.join() === "lyrics,lights,slides", "an admin picks its own jobs (Lights, Slides, Lyrics): " + JSON.stringify(rj));
let rv = await a.wait((m) => m.type === "cuRoles" && m.runners && m.runners.lights && m.runners.lights.id === "dAdmin");
ok(rv && rv.runners.lights.id === "dAdmin" && rv.runners.cameras && rv.runners.cameras.id === "dMain" && !rv.runners.lights.ask,
  "...it runs them; the main admin (doing everything) runs the rest - cameras, in-ears, tracks, the stream");
const a2 = await client();
a2.send({ type: "cuRole", action: "join", id: "dAdmin2", name: "Booth", role: "admin", pair: "0915", pin: "4321", jobs: ["lights"], jobsV: 2, jobsAt: Date.now() });
await a2.wait((m) => m.type === "cuRoleReply" && m.action === "join");
rv = await a2.wait((m) => m.type === "cuRoles" && m.runners && m.runners.lights && m.runners.lights.others.length === 1);
ok(rv && rv.runners.lights.ask && rv.runners.lights.id === "dAdmin" && rv.runners.lights.others[0].id === "dAdmin2", "a second computer picks Lights at its setup: both are asked which one runs it (Lights PC until then)");
a2.send({ type: "cuRole", action: "runJob", id: "dAdmin2", job: "lights", target: "dAdmin2" });
rj = await a2.wait((m) => m.type === "cuRoleReply" && m.action === "runJob");
rv = await a.wait((m) => m.type === "cuRoles" && m.runners && m.runners.lights && m.runners.lights.id === "dAdmin2");
ok(rj && rj.ok && rv && !rv.runners.lights.ask && rv.runners.lights.others[0].id === "dAdmin", "...Booth says it runs them: everyone hears, nobody is asked again");
a2.send({ type: "cuRole", action: "runJob", id: "dAdmin2", job: "cameras", target: "dAdmin2" });
rj = await a2.wait((m) => m.type === "cuRoleReply" && m.action === "runJob");
ok(rj && !rj.ok, "...a computer can't take a job it doesn't have");
a2.close(); await sleep(200);
rv = await a.wait((m) => m.type === "cuRoles" && m.runners && m.runners.lights && m.runners.lights.id === "dAdmin");
ok(!!rv, "Booth goes off: the Lights PC runs the lights again by itself");
// an older pick doesn't undo a newer one: the main admin set the jobs while the computer was off
a.send({ type: "cuRole", action: "hello", id: "dAdmin", name: "Lights PC", role: "admin", code: "0915", jobs: ["cameras"], jobsV: 2, jobsAt: 1000 });
await sleep(300);
ok(center.jobsOf("dAdmin").join() === "lyrics,lights,slides", "a computer coming back with an older pick keeps the newer one");

// Central Usage (the musicians' app): it can't be an admin; the Devices tab says which app a device runs
const mu = await client();
mu.send({ type: "cuRole", action: "join", id: "dUsage", name: "Bass iPad", role: "admin", pair: "0915", edition: "usage" });
r = await mu.wait((m) => m.type === "cuRoleReply" && m.action === "join");
ok(r && r.ok && r.role === "user1" && !r.pending, "Central Usage asking to be an admin pairs as User 1 (no admin request)");
main.send({ type: "cuRole", action: "assign", id: "dMain", target: "dUsage", role: "admin" });
r = await main.wait((m) => m.type === "cuRoleReply" && m.action === "assign");
ok(r && !r.ok && /Central Usage/.test(r.error), "the main admin can't make a Central Usage device an admin (it says why)");
v = await main.wait((m) => m.type === "cuRoles" && (m.devices || []).some((d) => d.id === "dUsage" && d.edition === "usage"));
ok(!!v, "the Devices tab knows the device runs Central Usage");
mu.close();

// talkback: users are in the Band, admins in Production; the main admin talks to a group, everyone else to the main admin
v = await main.wait((m) => m.type === "cuRoles" && (m.devices || []).some((d) => d.id === "dUser" && d.talkGroup === "band") && (m.devices || []).some((d) => d.id === "dAdmin" && d.talkGroup === "production"));
ok(!!v, "talk groups: users start in the Band, admins in Production");
const mic = Buffer.concat([Buffer.from("TKA1", "latin1"), Buffer.from([1, 0]), Buffer.from([4, 0]), Buffer.from([0x80, 0xbb, 0, 0]), Buffer.alloc(8, 7)]);
main.send({ type: "talk", on: true, to: "group", group: "production", devices: ["dAdmin", "dUser"], name: "Sound desk", seq: 1 });
r = await main.wait((m) => m.type === "talkReply" && m.seq === 1);
ok(r && r.ok && r.receivers === 1, "Production talk reaches the production devices only (" + (r && r.receivers) + ")");
ok(!!(await a.wait((m) => m.type === "talkFrom" && m.on && m.group === "production")), "...the admin is told who is talking");
main.ws.send(mic);
const gotMic = await a.wait((m) => m.type === "__bin");
ok(gotMic && gotMic.buf.toString("latin1", 0, 4) === "TKC1" && gotMic.buf.subarray(5 + gotMic.buf[4]).equals(mic), "...and gets the mic frames");
main.send({ type: "talk", on: false, seq: 2 }); await a.wait((m) => m.type === "talkFrom" && !m.on);
u.q.length = 0;
a.send({ type: "talk", on: true, to: "group", group: "band", devices: ["dUser"], seq: 3 });
r = await a.wait((m) => m.type === "talkReply" && m.seq === 3);
ok(r && !r.ok, "only the main admin talks to a group");
a.send({ type: "talk", on: true, to: "main", name: "Lights", seq: 4 });
r = await a.wait((m) => m.type === "talkReply" && m.seq === 4);
ok(r && r.ok && r.receivers === 1, "the lighting admin's talkback goes to the main admin");
a.ws.send(mic);
const gm = await main.wait((m) => m.type === "__bin");
ok(gm && gm.buf.subarray(5, 5 + gm.buf[4]).toString() === "dAdmin", "...it arrives at the main admin, from the lighting admin");
ok(!u.q.some((m) => m.type === "__bin"), "...and nobody else hears it");
a.send({ type: "talk", on: false, seq: 5 });
main.send({ type: "cuRole", action: "talkGroup", id: "dMain", target: "dUser", group: "production" });
v = await main.wait((m) => m.type === "cuRoles" && (m.devices || []).some((d) => d.id === "dUser" && d.talkGroup === "production"));
ok(!!v, "the main admin moves a device to Production");
main.send({ type: "cuRole", action: "talkGroup", id: "dMain", target: "dUser", group: "band" });

// a second "main admin" from another address is refused (only the computer the center runs on)
const other = new Center({ port: 0, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), "center-")), beacon: false });
await other.start();
const fake = { readyState: 1, sent: [], send(x) { this.sent.push(JSON.parse(x)); } };
const rr = other.handle(fake, { id: null, auth: false, main: false, ip: "10.0.0.9", loopback: false }, { action: "hello", id: "dX", role: "main", token: TOKEN });
ok(rr && !rr.ok, "the main admin can only register on the center's own computer");
await other.stop();

// locks
main.send({ type: "cuRole", action: "lock", id: "dMain", target: "all", on: true });
v = await u.wait((m) => m.type === "cuRoles" && m.lockAll && m.you && m.you.locked);
ok(!!v, "service lock reaches every device");
main.send({ type: "cuRole", action: "lock", id: "dMain", target: "all", on: false });
await u.wait((m) => m.type === "cuRoles" && !m.lockAll);

// health
u.send({ type: "cuRole", action: "health", id: "dUser", health: { rtt: 12, cpu: 30 } });
await sleep(600);
main.send({ type: "cuRole", action: "myJobs", id: "dMain", jobs: ["general"] });
v = await main.wait((m) => m.type === "cuRoles" && (m.devices || []).some((d) => d.id === "dUser" && d.health && d.health.rtt === 12));
ok(!!v, "health reports show on the main admin");

// services: only the main admin edits; everyone gets them
u.send({ type: "service", action: "save", services: [] });
r = await u.wait((m) => m.type === "serviceReply");
ok(r && !r.ok, "a user cannot change the services");
main.send({ type: "service", action: "save", services: [{ id: "sv1", name: "Sunday", day: 0, time: "09:00", items: [{ id: "i1", title: "Welcome", kind: "welcome", minutes: 3, roles: ["slides"] }] }] });
let st = await u.wait((m) => m.type === "services" && m.services.length === 1);
ok(st && st.services[0].name === "Sunday", "services saved and sent to every device");
main.send({ type: "service", action: "start", service: "sv1" });
st = await u.wait((m) => m.type === "services" && m.run);
ok(st && st.run.item === 0, "service runs");
const http = await (await fetch("http://127.0.0.1:" + port + "/api/service")).json();
ok(http.run && http.services.length === 1, "/api/service for stage displays");

// the audio host: admins register, users find it (and get the in-ear code)
u.send({ type: "audioHost", action: "register", port: 8092 });
r = await u.wait((m) => m.type === "refused");
ok(!!r, "a user cannot be the audio host");
a.send({ type: "audioHost", action: "register", port: 8092, name: "Lights", userCode: "5555", adminCode: "6666" });
const ah = await u.wait((m) => m.type === "audioHost" && m.host);
ok(ah && ah.host.port === 8092, "the audio host is found through the center");
v = await u.wait((m) => m.type === "cuRoles" && m.hostCodes);
ok(v && v.hostCodes.user === "5555" && !v.hostCodes.admin, "users get only the in-ear code");

// the Central Pedal pairs as "pedal"
const pd = await client();
pd.send({ type: "cuRole", action: "hello", id: "pedal-1", role: "pedal", name: "padpedal", code: "0915", pedal: { addresses: ["127.0.0.1"], port: 8080, wsPort: 8081, app: "8.3.0" } });
v = await pd.wait((m) => m.type === "cuRoles" && m.you && m.you.role === "pedal");
ok(!!v, "a Central Pedal knowing the pairing PIN is let in as the pedal");
pd.send({ type: "cuRole", action: "join", id: "pedal-1", role: "pedal", name: "padpedal", pair: "0915", pedal: { addresses: ["127.0.0.1"], port: 8080, wsPort: 8081, app: "8.3.0" } });
r = await pd.wait((m) => m.type === "cuRoleReply" && m.action === "join");
ok(r && r.ok && r.role === "pedal", "the Central Pedal pairs with the PIN");
ok(!!(await pd.wait((m) => m.type === "services" && m.run)), "the Central Pedal gets the running service");
let pr = await pd.wait((m) => m.type === "pedalRole" && m.job === "player");
ok(pr && pr.youPlay, "the first Central Pedal (here: the main admin's own player window) is the track player");
// a Central Pedal on the network is added: 10.0 - the main admin's window keeps the songs and plays them, the pedal controls it
const fake2 = { readyState: 1, send() { } };
const r2 = center.handle(fake2, { id: null, auth: false, main: false, ip: "10.0.0.5", loopback: false }, { action: "join", id: "pedal-2", role: "pedal", name: "Stage pedal", pair: "0915", pedal: { port: 8080, wsPort: 8081 } });
ok(r2 && r2.ok && center.tracksHost === "computer" && center.devices["pedal-2"].pedalJob === "controller" && center.devices["pedal-1"].pedalJob === "player", "an added pedal controls the tracks: the main admin's window keeps playing them (where the tracks run: this computer)");
// picking the pedal as the track player says the tracks run on the pedal: it takes over, the window becomes the backup player
main.q.length = 0; main.send({ type: "cuRole", action: "pedalJob", id: "dMain", target: "pedal-2", job: "player" });
await main.wait((m) => m.type === "cuRoleReply" && m.action === "pedalJob");
ok(center.tracksHost === "pedal" && center.devices["pedal-2"].pedalJob === "player" && center.devices["pedal-1"].pedalJob === "backup", "the main admin picks the pedal as the player: it takes over the tracks; the window becomes the backup player");
pd.q.length = 0; pr = await pd.wait((m) => m.type === "pedalRole" && m.job === "backup");
ok(pr && pr.player && pr.player.address === "10.0.0.5" && pr.peers.some((x) => x.id === "pedal-2"), "the window hears who plays now (and links its songs to it)");
v = await main.wait((m) => m.type === "cuRoles" && (m.pedals || []).length === 2 && m.pedals.some((x) => x.id === "pedal-2" && x.job === "player"));
ok(v && v.pedals[0].id === "pedal-2" && v.pedals[0].job === "player", "the main admin sees both pedals, the player first", v && v.pedals);
pd.q.length = 0; main.send({ type: "cuRole", action: "pedalJob", id: "dMain", target: "pedal-1", job: "player" });
pr = await pd.wait((m) => m.type === "pedalRole" && m.job === "player");
ok(pr && center.devices["pedal-2"].pedalJob === "controller", "one click: the window plays again, the stage pedal becomes a foot controller");
main.q.length = 0; main.send({ type: "cuRole", action: "pedalJob", id: "dMain", target: "pedal-2", job: "instrument" });
await main.wait((m) => m.type === "cuRoleReply" && m.action === "pedalJob");
ok(center.devices["pedal-2"].pedalJob === "instrument" && center.playerId() === "pedal-1", "a pedal can be just an instrument rig");
u.send({ type: "cuRole", action: "pedalJob", id: "dUser", target: "pedal-2", job: "player" });
r = await u.wait((m) => m.type === "cuRoleReply" && m.action === "pedalJob");
ok(r && !r.ok, "only the main admin gives pedals their jobs");
// the backup player: the stage pedal plays, the window follows; it takes over only when the stage pedal's heartbeat stopped
main.q.length = 0; main.send({ type: "cuRole", action: "pedalJob", id: "dMain", target: "pedal-2", job: "player" });
await main.wait((m) => m.type === "cuRoleReply" && m.action === "pedalJob");
ok(center.devices["pedal-1"].pedalJob === "backup", "with the stage pedal playing, the window is the backup again");
center.clients.set(fake2, { id: "pedal-2", auth: true, ip: "10.0.0.5" }); center.lastMsg["pedal-2"] = Date.now();
pd.q.length = 0; pd.send({ type: "cuRole", action: "takeover", id: "pedal-1" });
r = await pd.wait((m) => m.type === "cuRoleReply" && m.action === "takeover");
ok(r && !r.ok && r.playerAlive && center.playerId() === "pedal-2", "the stage pedal's heartbeat is still there: the backup stays silent (it only lost its own Wi-Fi)");
center.lastMsg["pedal-2"] = Date.now() - 5000;
pd.q.length = 0; pd.send({ type: "cuRole", action: "takeover", id: "pedal-1" });
r = await pd.wait((m) => m.type === "cuRoleReply" && m.action === "takeover");
ok(r && r.ok && center.playerId() === "pedal-1" && center.devices["pedal-2"].pedalJob === "standby", "heartbeat gone mid-song: the backup takes over and is the track player; the stage pedal goes to standby");
center.clients.delete(fake2);
main.q.length = 0; main.send({ type: "cuRole", action: "backupLocal", id: "dMain", on: false });
r = await main.wait((m) => m.type === "cuRoleReply" && m.action === "backupLocal");
ok(r && r.ok && center.backup.localIsBackup === false, "the main admin can turn the backup player off (the window then only keeps the library)");
main.send({ type: "cuRole", action: "backupLocal", id: "dMain", on: true }); await main.wait((m) => m.type === "cuRoleReply" && m.action === "backupLocal");
main.q.length = 0; main.send({ type: "cuRole", action: "pedalJob", id: "dMain", target: "pedal-2", job: "instrument" });
await main.wait((m) => m.type === "cuRoleReply" && m.action === "pedalJob");
v = await u.wait((m) => m.type === "cuRoles" && m.pedal && m.pedal.online);
ok(v && v.pedal.wsPort === 8081 && v.pedal.address, "every device is told where the Central Pedal is");
pd.send({ type: "cuRole", action: "health", id: "pedal-1", health: { tempC: 51, song: "Way Maker" } });
await sleep(600);
main.send({ type: "cuRole", action: "myJobs", id: "dMain", jobs: ["general"] });
v = await main.wait((m) => m.type === "cuRoles" && m.pedalHealth && m.pedalHealth.tempC === 51);
ok(!!v, "the pedal's health shows on the main admin");
main.send({ type: "cuRole", action: "assign", id: "dMain", target: "pedal-1", role: "admin" });
r = await main.wait((m) => m.type === "cuRoleReply" && m.action === "assign");
ok(r && !r.ok, "the Central Pedal cannot be given another role");

// 10.0 "where the tracks run: this computer": the window plays; closed, a pedal plays; open again, it takes them back
// once that pedal isn't playing
main.q.length = 0; main.send({ type: "cuRole", action: "tracksHost", id: "dMain", mode: "computer" });
r = await main.wait((m) => m.type === "cuRoleReply" && m.action === "tracksHost");
center.setPedalJob("pedal-2", "controller");
ok(r && r.ok && center.tracksHost === "computer" && center.playerId() === "pedal-1", "the main admin says the tracks run on this computer: the window plays");
const winWs = [...center.clients].find(([, c]) => c.id === "pedal-1");
center.clients.delete(winWs[0]); center.clients.set(fake2, { id: "pedal-2", auth: true, ip: "10.0.0.5" });
ok(center.autoHost() && center.playerId() === "pedal-2", "the player window is closed: the stage pedal plays the tracks");
center.clients.set(winWs[0], winWs[1]);
center.health["pedal-2"] = { playing: true, at: Date.now() };
ok(!center.autoHost() && center.playerId() === "pedal-2", "the window is back mid-song: the pedal keeps playing");
center.health["pedal-2"] = { playing: false, at: Date.now() };
ok(center.autoHost() && center.playerId() === "pedal-1" && center.devices["pedal-2"].pedalJob === "controller", "...and once nothing plays, the window takes the tracks back; the pedal controls them again");
r = center.handle(fake2, { id: "pedal-2", auth: true, ip: "10.0.0.5" }, { action: "tracksHost", id: "pedal-2", mode: "pedal" });
ok(r && !r.ok && center.tracksHost === "computer", "only the main admin decides where the tracks run");
center.clients.delete(fake2);
center.setPedalJob("pedal-2", "instrument");

// the pairing PIN changes: online devices (the pedal too) switch over
main.send({ type: "cuRole", action: "setPair", id: "dMain", pair: "2468" });
const pc = await pd.wait((m) => m.type === "pairCodeChanged");
ok(pc && pc.code === "2468", "a new pairing PIN reaches the Central Pedal");
await main.wait((m) => m.type === "cuRoleReply" && m.action === "setPair");
main.send({ type: "cuRole", action: "setPair", id: "dMain", pair: "4321" });
r = await main.wait((m) => m.type === "cuRoleReply" && m.action === "setPair");
ok(r && !r.ok, "the pairing PIN cannot be the role PIN");

// it all comes back after a restart
main.close(); u.close(); a.close(); pd.close();
await center.stop();
const again = new Center({ port: 0, dataDir: dir, beacon: false });
ok(again.pair === "2468" && again.devices.dUser && again.devices["pedal-1"].role === "pedal" && again.services.length === 1, "saved in center.json");
await again.start();
const back = new WebSocket("ws://127.0.0.1:" + again.port);
await new Promise((res) => back.on("open", res));
const got = new Promise((res) => back.on("message", (raw) => { const m = JSON.parse(String(raw)); if (m.type === "cuRoles") res(m); }));
back.send(JSON.stringify({ type: "cuRole", action: "hello", id: "dUser", name: "Keys", role: "user1", code: "2468" }));
v = await Promise.race([got, sleep(2000).then(() => null)]);
ok(v && v.you && v.you.role === "user1", "a paired device comes back without the PIN prompt");
const page = await fetch("http://127.0.0.1:" + again.port + "/cu/");
ok(page.status === 200 && (await page.text()).includes("<html"), "phones open Central Control from the main admin (/cu/)");
back.close(); await again.stop();
fs.rmSync(dir, { recursive: true, force: true });
console.log(fails ? fails + " FAILED" : "all center tests passed");
process.exit(fails ? 1 : 0);
