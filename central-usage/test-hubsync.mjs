// The second main admin's computer kept in sync with the hub (hubsync.js + center.js), with two real centers:
// the hub marks an admin computer "in sync", the copy (songs, tracks, mixer, lighting, PINs, paired devices) follows
// every change, wrong secrets and paths are refused, then Take over: planned (the old hub hands over and becomes the
// in-sync computer) and rescue (the hub is gone). Every device stays paired with the new hub.
//   node test-hubsync.mjs
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
const require = createRequire(import.meta.url);
const { Center, salted } = require("./center.js");
const hubsync = require("./hubsync.js");
const WebSocket = require("ws");

let fails = 0;
const ok = (c, msg, d) => { console.log((c ? "ok   " : "FAIL ") + msg + (c || d === undefined ? "" : "  -- " + JSON.stringify(d).slice(0, 300))); if (!c) fails++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), "hubsync-" + n + "-"));
const write = (dir, rel, text) => { const f = path.join(dir, ...rel.split("/")); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const read = (dir, rel) => { try { return fs.readFileSync(path.join(dir, ...rel.split("/")), "utf8"); } catch (_) { return null; } };

let handedOver = null;
function hub(dataDir) {   // a center with the hub side of hubsync, as services.js wires it
  const c = new Center({ port: 0, dataDir, beacon: false,
    mirror: (req, res, cc) => hubsync.serveMirror(req, res, { dataDir, check: (s) => cc.checkMirror(s), before: () => cc.save(), info: () => ({ hub: cc.hubKey, gen: cc.gen, name: cc.mainName() }), handover: (s) => { handedOver = s; } }) });
  return c;
}
function client(port) {
  return new Promise((resolve) => {
    const ws = new WebSocket("ws://127.0.0.1:" + port), q = [], waiters = [];
    ws.on("message", (raw, isBin) => { if (isBin) return; const m = JSON.parse(String(raw)); const i = waiters.findIndex((w) => w.f(m)); if (i >= 0) { const w = waiters.splice(i, 1)[0]; w.r(m); } else q.push(m); });
    ws.on("open", () => resolve({
      send: (m) => ws.send(JSON.stringify(m)),
      wait: (f, ms) => new Promise((r) => { const i = q.findIndex(f); if (i >= 0) return r(q.splice(i, 1)[0]); const w = { f, r }; waiters.push(w); setTimeout(() => { const j = waiters.indexOf(w); if (j >= 0) { waiters.splice(j, 1); r(null); } }, ms || 3000); }),
      close: () => ws.close()
    }));
  });
}
const get = (port, p, secret) => new Promise((resolve) => { http.get({ host: "127.0.0.1", port, path: p, headers: secret ? { "x-mirror": secret } : {} }, (res) => { let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => resolve({ status: res.statusCode, body: b })); }).on("error", () => resolve({ status: 0 })); });

// ---------------------------------------------------------------- the hub (computer A) with its devices
const A = tmp("A"), B = tmp("B"), TOKEN_A = "a".repeat(32), TOKEN_B = "b".repeat(32);
const hubA = hub(A); await hubA.start();
const main = await client(hubA.port);
main.send({ type: "cuRole", action: "hello", id: "dA", name: "Sound desk", role: "main", token: TOKEN_A, pin: "4321", pair: "0915", edition: "control" });
ok(!!(await main.wait((m) => m.type === "cuRoles" && m.youAreMain)), "the hub: the main admin's computer runs the center (pairing PIN 0915, role PIN 4321)");
const phone = await client(hubA.port);
phone.send({ type: "cuRole", action: "join", id: "dPhone", name: "Bass phone", role: "user1", pair: "0915" });
ok((await phone.wait((m) => m.type === "cuRoleReply" && m.action === "join")).ok, "a musician's phone pairs with the hub");
const bWs = await client(hubA.port);
bWs.send({ type: "cuRole", action: "join", id: "dB", name: "Ben's laptop", role: "admin", pair: "0915", pin: "4321", edition: "control" });
ok((await bWs.wait((m) => m.type === "cuRoleReply" && m.action === "join")).role === "admin", "the second main admin's laptop pairs as an admin (Central Control)");
// the hub's files: songs and tracks, the mixer, the window's lighting and slides
write(A, "player/songs/way-maker/song.json", '{"title":"Way Maker"}');
write(A, "player/songs/way-maker/stems/drums.wav", "RIFF-drums-" + "x".repeat(200000));
write(A, "mixer.json", '{"mixes":["Keys","Bass"]}');
write(A, "hub-state.json", JSON.stringify({ store: { "cu-rig": '{"fixtures":12}', "cu-slides": '["Welcome"]' }, pin: "4321", pair: "0915", userCode: "1111", adminCode: "2222", name: "Sound desk" }));
write(A, "player/driver.log", "noise");

// ---------------------------------------------------------------- keep B in sync
const phoneAsk = await client(hubA.port);
phoneAsk.send({ type: "cuRole", action: "hello", id: "dPhone", name: "Bass phone", role: "user1", code: "0915" });
await sleep(150);
phoneAsk.send({ type: "cuRole", action: "standby", id: "dPhone", target: "dPhone", on: true });
ok(!(await phoneAsk.wait((m) => m.type === "cuRoleReply" && m.action === "standby")).ok, "only the main admin marks a computer in sync");
main.send({ type: "cuRole", action: "standby", id: "dA", target: "dPhone", on: true });
ok(/Only an admin computer/.test((await main.wait((m) => m.type === "cuRoleReply" && m.action === "standby")).error), "a phone (a user) can't be the in-sync computer");
main.send({ type: "cuRole", action: "standby", id: "dA", target: "dB", on: true });
const asg = await bWs.wait((m) => m.type === "standbyAssigned");
ok(asg && /^[0-9a-f]{48}$/.test(asg.secret) && asg.hub === hubA.hubKey && asg.hubName === "Sound desk", "the main admin keeps Ben's laptop in sync: it gets its secret");
const vs = await main.wait((m) => m.type === "cuRoles" && m.standby && m.standby.id === "dB");
ok(vs && vs.standby.name === "Ben's laptop", "the hub's Devices tab shows the in-sync computer");
const SECRET = asg.secret, dest = path.join(B, "standby");

ok((await get(hubA.port, "/api/mirror/manifest", "f".repeat(48))).status === 403 && (await get(hubA.port, "/api/mirror/manifest")).status === 403, "without the right secret the hub shares nothing");
ok((await get(hubA.port, "/api/mirror/file?p=" + encodeURIComponent("../../etc/passwd"), SECRET)).status === 400 && (await get(hubA.port, "/api/mirror/file?p=cu.json", SECRET)).status === 400, "only the hub's shared files (no ../, not this computer's own settings)");
let s1 = await hubsync.syncFrom({ host: "127.0.0.1", port: hubA.port, secret: SECRET, dest });
ok(s1.got === 5 && read(dest, "player/songs/way-maker/stems/drums.wav").length === 200011 && read(dest, "mixer.json") && JSON.parse(read(dest, "center.json")).devices.dPhone && !read(dest, "player/driver.log"),
  "the first copy: songs and tracks, mixer, lighting and slides, the paired devices (not the logs)", s1);
let s2 = await hubsync.syncFrom({ host: "127.0.0.1", port: hubA.port, secret: SECRET, dest });
ok(s2.got <= 1 && s2.removed === 0, "a minute later nothing changed: nothing copied (center.json at most)", s2);
write(A, "player/songs/goodness/song.json", '{"title":"Goodness of God"}');
fs.rmSync(path.join(A, "player/songs/way-maker/stems/drums.wav"));
let s3 = await hubsync.syncFrom({ host: "127.0.0.1", port: hubA.port, secret: SECRET, dest });
ok(read(dest, "player/songs/goodness/song.json") && !read(dest, "player/songs/way-maker/stems/drums.wav") && s3.removed === 1, "a new song is copied, a deleted track goes from the copy too", s3);
write(A, "player/songs/way-maker/stems/drums.wav", "RIFF-drums-v2");
await hubsync.syncFrom({ host: "127.0.0.1", port: hubA.port, secret: SECRET, dest });

// ---------------------------------------------------------------- take over, planned (the hub is on)
ok(hubsync.pinOk(dest, "1111", salted) === false && hubsync.pinOk(dest, "4321", salted) === true, "Take over checks the main admin's role PIN against the copy (works with the hub off too)");
await hubsync.handover({ host: "127.0.0.1", port: hubA.port, secret: SECRET });
await sleep(400);
ok(handedOver === SECRET, "the hub is asked to hand over (with the in-sync computer's secret, so it can follow the new hub)");
write(B, "player/old-mine.txt", "B's own old player folder");
const pr = hubsync.promote({ userData: B, dest, deviceId: "dB", name: "Ben's laptop", token: TOKEN_B, planned: true, salted });
const cj = JSON.parse(read(B, "center.json"));
ok(cj.main.id === "dB" && cj.devices.dA.role === "admin" && cj.devices.dB.role === "main" && cj.gen === hubA.gen + 1 && cj.hubKey === hubA.hubKey && cj.standby.id === "dA" && cj.pair === "0915",
  "the copy becomes Ben's hub: Ben is the main admin, the old hub an admin, same church, next generation, the old hub kept in sync", { main: cj.main.id, gen: cj.gen, standby: cj.standby });
ok(read(B, "player/songs/goodness/song.json") && read(B, "player/songs/way-maker/stems/drums.wav") === "RIFF-drums-v2" && read(B, "mixer.json") && read(B, "player.before-takeover/old-mine.txt"), "the songs, tracks and mixer are in place (Ben's own old player folder is kept aside)");
ok(pr.hubState.store["cu-rig"] === '{"fixtures":12}' && pr.hubState.pin === "4321" && pr.hubState.userCode === "1111", "the lighting, slides, PINs and in-ear codes come along for the window and the settings");
await hubA.stop(); main.close(); phone.close(); phoneAsk.close(); bWs.close();

const hubB = hub(B); await hubB.start();
const mainB = await client(hubB.port);
mainB.send({ type: "cuRole", action: "hello", id: "dB", name: "Ben's laptop", role: "main", token: TOKEN_B, edition: "control" });
const vB = await mainB.wait((m) => m.type === "cuRoles" && m.youAreMain);
ok(vB && vB.pairPin === "0915" && vB.devices.some((d) => d.id === "dPhone") && vB.standby && vB.standby.id === "dA", "Ben's laptop is the hub: same pairing PIN, the same devices, the old hub kept in sync");
const phone2 = await client(hubB.port);
phone2.send({ type: "cuRole", action: "hello", id: "dPhone", name: "Bass phone", role: "user1", code: "0915" });
const pv = await phone2.wait((m) => m.type === "cuRoles");
ok(pv && pv.you && pv.you.role === "user1", "the musician's phone finds the new hub and is still paired (no PIN typed)");
const oldA = await client(hubB.port);
oldA.send({ type: "cuRole", action: "hello", id: "dA", name: "Sound desk", role: "admin", code: "0915", edition: "control" });
const av = await oldA.wait((m) => m.type === "cuRoles");
ok(av && av.you && av.you.role === "admin" && av.youAreStandby, "the old hub comes back as an admin computer, kept in sync");
ok(hubB.checkMirror(SECRET) && (await get(hubB.port, "/api/mirror/manifest", SECRET)).status === 200, "...and copies from Ben's hub with the same secret");
const roleWith = await client(hubB.port);
roleWith.send({ type: "cuRole", action: "join", id: "dNew", name: "Lights", role: "admin", pair: "0915", pin: "4321" });
ok((await roleWith.wait((m) => m.type === "cuRoleReply" && m.action === "join")).role === "admin", "the main admin's role PIN still works on the new hub");
const tooOld = await client(hubB.port);
tooOld.send({ type: "cuRole", action: "hello", id: "dA", name: "Sound desk", role: "main", token: TOKEN_A });
await sleep(200);
ok(!hubB.isMain({ id: "dA", main: true }) && hubB.main.id === "dB", "the old hub can't claim the hub back with its old token");

// ---------------------------------------------------------------- take over, rescue (the hub is gone)
const C = tmp("C");
mainB.send({ type: "cuRole", action: "standby", id: "dB", target: "dA", on: false });
await mainB.wait((m) => m.type === "cuRoleReply" && m.action === "standby");
ok(!hubB.standby && (await get(hubB.port, "/api/mirror/manifest", SECRET)).status === 403, "Stop keeping it in sync: the old secret stops working");
roleWith.send({ type: "cuRole", action: "hello", id: "dNew", name: "Lights", role: "admin", code: "0915", edition: "control" });
await sleep(150);
mainB.send({ type: "cuRole", action: "standby", id: "dB", target: "dNew", on: true });
const asg2 = await roleWith.wait((m) => m.type === "standbyAssigned");
await hubsync.syncFrom({ host: "127.0.0.1", port: hubB.port, secret: asg2.secret, dest: path.join(C, "standby") });
await hubB.stop();   // Ben's laptop breaks
const pr2 = hubsync.promote({ userData: C, dest: path.join(C, "standby"), deviceId: "dNew", name: "Lights", token: "c".repeat(32), planned: false, salted });
const cj2 = JSON.parse(read(C, "center.json"));
ok(cj2.main.id === "dNew" && cj2.devices.dB.role === "admin" && cj2.gen === cj.gen + 1 && cj2.standby === null && cj2.devices.dPhone, "rescue: the last copy becomes the hub; nobody is kept in sync until the main admin picks one", { gen: cj2.gen });
ok(pr2.oldMain === "dB", "...and when Ben's laptop comes back it hears a newer hub of the same church (generation " + cj2.gen + " > " + cj.gen + ") and steps down");

for (const d of [A, B, C]) fs.rmSync(d, { recursive: true, force: true });
console.log(fails ? "\n" + fails + " HUB SYNC CHECK(S) FAILED" : "\nALL HUB SYNC CHECKS PASSED");
process.exit(fails ? 1 : 0);
