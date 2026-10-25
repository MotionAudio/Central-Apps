#!/usr/bin/env node
/**
 * A set: Central Pedal Control keeps everything; the pedal holds one set at a time.
 * A Central Pedal (the real driver, simulated pins) with its app, and an editor with no driver of its own (like the
 * iPad app). Set A goes over and the pedal switches to it by itself; set B replaces it - the track both use isn't sent
 * again, what only A had is removed, pedals / plugins / sounds installed on the pedal stay. An upload that stops half
 * way changes nothing on the pedal and carries on when Upload is pressed again. Edits made on the pedal are flagged.
 *   node test-sets.mjs
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import assert from "node:assert/strict";

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cp-sets-"));
let failures = 0;
async function check(label, fn) { try { await fn(); console.log("  ✓ " + label); } catch (e) { failures++; console.error("  ✗ " + label + "\n      " + String(e && e.message ? e.message.split("\n").slice(0, 8).join("\n      ") : e)); } }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 10000, every = 150) { const t0 = Date.now(); for (;;) { try { const v = await fn(); if (v) return v; } catch (_) { } if (Date.now() - t0 > ms) throw new Error("timed out waiting"); await wait(every); } }
function wav(seconds, rate, freq) {
  const n = Math.floor(seconds * rate), buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8); buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) { const t = i / rate; buf.writeInt16LE(Math.round(0.3 * Math.sin(2 * Math.PI * freq * t) * 20000), 44 + i * 2); }
  return buf;
}
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch (_) { return null; } };
const libFiles = () => { const out = []; const root = path.join(tmp, "library"); if (!fs.existsSync(root)) return out; for (const d of fs.readdirSync(root)) for (const f of fs.readdirSync(path.join(root, d))) out.push(path.join(root, d, f)); return out; };

// what the pedal has of its own: a plugin's impulse response, a sound library installed there, a free sound
fs.mkdirSync(path.join(tmp, "sounds", "ir"), { recursive: true }); fs.writeFileSync(path.join(tmp, "sounds", "ir", "My Cab.wav"), wav(0.1, 22050, 100));
fs.mkdirSync(path.join(tmp, "sounds", "sf2"), { recursive: true }); fs.writeFileSync(path.join(tmp, "sounds", "sf2", "Central Keys - Upright.sf2"), Buffer.from("library bank"));
fs.writeFileSync(path.join(tmp, "sounds", "sf2", "tiers.txt"), "Central Keys|keys|CC0|central-keys\n");

const driver = spawn("python3", [path.join(here, "pedal-driver.py"), "--simulate", tmp, "--app-root", here], { stdio: ["ignore", "pipe", "pipe"] });
let dlog = ""; driver.stderr.on("data", (d) => { dlog += d; }); driver.stdout.on("data", (d) => { dlog += d; });
process.on("exit", () => { try { driver.kill("SIGKILL"); } catch (_) { } });   // (never leave the simulated pedal running)
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(1));
process.on("uncaughtException", (e) => { console.error(e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error(e); process.exit(1); });
for (let i = 0; i < 100; i++) { try { await fetch("http://127.0.0.1:8766/app/"); await fetch("http://127.0.0.1:8080/api/info"); break; } catch (_) { await wait(200); } }

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const errors = [];
const pi = await browser.newPage({ viewport: { width: 1280, height: 800 } });
pi.on("pageerror", (e) => errors.push("pi: " + e.message));
await pi.goto("http://127.0.0.1:8766/app/");
await pi.waitForFunction(() => window.PPTransfer && window.__pedalBridge && window.__pedalBridge.connected, null, { timeout: 20000 });
await pi.evaluate(() => window.__pedalBridge.send({ type: "pairCode", pin: "4321" }));
await wait(800);
const P = (fn, a) => pi.evaluate(fn, a);
async function piReady() { await pi.waitForFunction(() => window.PPTracks && window.PP && window.PPTransfer && window.__pedalBridge && window.__pedalBridge.connected, null, { timeout: 25000 }); }

const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.route(/127\.0\.0\.1:8766\//, (r) => r.abort());
await ctx.addInitScript(() => {
  window.CP_CONTROL = true;
  const WS = window.WebSocket;
  window.WebSocket = function (url, p) { if (/127\.0\.0\.1:876[56]/.test(url)) return new WS("ws://127.0.0.1:9/"); return new WS(url, p); };
  window.WebSocket.prototype = WS.prototype; window.WebSocket.OPEN = 1; window.WebSocket.CLOSED = 3;
});
const ed = await ctx.newPage();
ed.on("pageerror", (e) => errors.push("editor: " + e.message));
await ed.goto("file://" + path.join(here, "index.html"));
await ed.waitForFunction(() => window.PPTransfer && window.PPTracks && window.PP);
const E = (fn, a) => ed.evaluate(fn, a);

const songsOnPi = () => P(() => PP.project().songs.map((s) => s.name));
let reloaded = null;   // (the pedal's page reloads once it switched: wait for that from before the upload starts)
function expectReload() { reloaded = pi.waitForEvent("load", { timeout: 40000 }); reloaded.catch(() => { }); return reloaded; }
async function switched() { await reloaded; await piReady(); }
async function uploadSet() {   // what Upload → Send the set does
  expectReload();
  await E(async () => { const pl = await PPTransfer.prepareSet("127.0.0.1:8080", "4321", ["controls"]); window.__plan = { send: pl.send.map((x) => x.kind + ":" + (x.ref.name || x.ref.sampleId)), toSend: pl.toSend, fits: pl.fits, reused: pl.reused }; await PPTransfer.sendSet(pl); });
  return E(() => window.__plan);
}

console.log("Set A → the pedal:");
await check("the editor makes set A: two songs with a track each and a pad with its own sound", async () => {
  await E(async (b) => {
    const mk = (b64, n) => new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], n, { type: "audio/wav" });
    PP.project().songs = []; PP.project().name = "Set A";
    const s1 = PPTracks.newSong("Shared Song"); await PPTracks.importFilesIntoSong(s1, [mk(b.one, "Keys.wav")]);
    const s2 = PPTracks.newSong("Only In A"); await PPTracks.importFilesIntoSong(s2, [mk(b.two, "Bass.wav")]);
    const id = PP.id(); await PP.storeBlob(id, mk(b.pad, "Pad.wav")); PP.project().library.push({ id: id, name: "My Pad", rootKey: "C", type: "audio/wav" }); PP.project().pads[0].sampleId = id; PP.project().pads[0].name = "Pad A";
    window.__padA = id; PP.persistNow();
  }, { one: wav(3, 22050, 220).toString("base64"), two: wav(2, 22050, 110).toString("base64"), pad: wav(1, 22050, 330).toString("base64") });
  assert.deepEqual(await E(() => PP.project().songs.map((s) => s.name)), ["Shared Song", "Only In A"]);
});
await check("the Upload dialog offers 'Upload this set' first (songs, pads and instrument always go with it)", async () => {
  await E(() => PPTransfer.open("up"));
  const r = await E(() => { const d = document.getElementById("cpTransferDialog"); return { set: d.querySelector("[data-cpmode=set]").checked, songs: d.querySelector('[data-part="songs"]').disabled && d.querySelector('[data-part="songs"]').checked, modeRow: d.querySelector("[data-cp=songModeRow]").classList.contains("hidden") }; });
  assert.deepEqual(r, { set: true, songs: true, modeRow: true });
  await E(() => document.getElementById("cpTransferDialog").close());
});
let planA;
await check("Send the set: 2 tracks and the pad sound go; the pedal switches to set A by itself (nothing playing)", async () => {
  planA = await uploadSet();
  assert.equal(planA.fits, true); assert.equal(planA.send.filter((x) => x.startsWith("stem:")).length, 2); assert.equal(planA.send.filter((x) => x.startsWith("sample:")).length, 1);
  await switched();
  assert.deepEqual(await songsOnPi(), ["Shared Song", "Only In A"]);
  const cur = readJson(path.join(tmp, "current-set.json"));
  assert.equal(cur.name, "Set A"); assert.equal(cur.songs, 2); assert.equal(libFiles().length, 2, libFiles().join(", "));
});
await check("...the tracks are in the pedal's library and decode; the pad plays its own sound", async () => {
  const r = await P(async () => { const p = PP.project(), out = []; for (const s of p.songs) { const st = s.tracks.stems[0]; const rec = await PPTracks.getStem(st.id); out.push(!!(st.file && rec && rec.length > 1000)); } const blob = await PP.getBlob(p.pads[0].sampleId); return { ok: out, pad: p.pads[0].name, blob: !!blob }; });
  assert.deepEqual(r, { ok: [true, true], pad: "Pad A", blob: true });
});
await check("the pedal shows the set it holds (top bar and setlist) and in its hello", async () => {
  const t = await until(() => P(() => { const c = document.getElementById("loadedSetChip"); return c && !c.classList.contains("hidden") && c.textContent; }), 15000)
    .catch(async (e) => { throw new Error(e.message + " - page: " + JSON.stringify(await P(() => ({ chip: (document.getElementById("loadedSetChip") || {}).outerHTML || null, ls: PPTransfer.loadedSet(), hello: window.__pedalBridge.info && window.__pedalBridge.info.loadedSet })))); });
  assert.match(t, /Set from/);
  const r = await (await fetch("http://127.0.0.1:8766/pedal/loaded-set")).json();
  assert.equal(r.set.name, "Set A"); assert.equal(r.set.changed, false);
});

console.log("\nSet B replaces it:");
await check("set B: the shared song stays, 'Only In A' goes, a new song with its own track and a new pad sound", async () => {
  await E(async (b) => {
    const mk = (b64, n) => new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], n, { type: "audio/wav" });
    const p = PP.project(); p.name = "Set B"; p.songs = p.songs.filter((s) => s.name === "Shared Song");
    const s3 = PPTracks.newSong("New In B"); await PPTracks.importFilesIntoSong(s3, [mk(b.three, "Drums.wav")]);
    const id = PP.id(); await PP.storeBlob(id, mk(b.pad, "PadB.wav")); p.library.push({ id: id, name: "Pad B", rootKey: "C", type: "audio/wav" }); p.pads[0].sampleId = id; p.pads[0].name = "Pad B";
    PP.persistNow();
  }, { three: wav(2.5, 22050, 440).toString("base64"), pad: wav(1, 22050, 550).toString("base64") });
});
const before = libFiles();
await check("only the new track and the new pad sound are sent (the shared track is on the pedal already)", async () => {
  const plan = await uploadSet();
  assert.deepEqual(plan.send.filter((x) => x.startsWith("stem:")), ["stem:Drums.wav"]); assert.ok(plan.reused > 0);
  await switched();
  assert.deepEqual(await songsOnPi(), ["Shared Song", "New In B"]);
});
await check("...set A's track that B doesn't use is gone; the shared one is the same file; pedals, plugins and installed sounds stay", async () => {
  const now = libFiles();
  assert.equal(now.length, 2, now.join(", "));
  const shared = before.filter((f) => /Keys/.test(f))[0]; assert.ok(now.includes(shared), "the shared track kept its place");
  assert.ok(!now.some((f) => /Bass/.test(f)), "set A's own track removed");
  assert.ok(fs.existsSync(path.join(tmp, "sounds", "ir", "My Cab.wav")), "a plugin's IR stays");
  assert.ok(fs.existsSync(path.join(tmp, "sounds", "sf2", "Central Keys - Upright.sf2")), "a library installed on the pedal stays");
  assert.equal(readJson(path.join(tmp, "current-set.json")).name, "Set B");
});
await check("...and set A's pad sound is dropped from the pedal's store, B's is there", async () => {
  const r = await P(async (a) => ({ a: !!(await PP.getBlob(a)), b: !!(await PP.getBlob(PP.project().pads[0].sampleId)), lib: PP.project().library.map((x) => x.name) }), await E(() => window.__padA));
  assert.deepEqual(r, { a: false, b: true, lib: ["Pad B"] });
});

console.log("\nAn upload that stops half way:");
const bigB64 = wav(30, 44100, 330).toString("base64");   // (~2.6 MB: more than one piece when the pieces are small)
await check("set C: its track starts going, the Wi-Fi 'drops' after the first piece - the pedal keeps set B as it is", async () => {
  await E(async (b) => { const mk = (b64, n) => new File([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], n, { type: "audio/wav" }); const p = PP.project(); p.name = "Set C"; const s = PPTracks.newSong("Long Song"); await PPTracks.importFilesIntoSong(s, [mk(b, "Long.wav")]); PP.persistNow(); }, bigB64);
  const err = await E(async () => {
    const pl = await PPTransfer.prepareSet("127.0.0.1:8080", "4321", []);
    const realFetch = window.fetch; let pieces = 0;
    window.fetch = function (u, o) {   // (pieces of 1 MB; the second piece of the long track never arrives)
      if (/\/api\/pedal\/chunk/.test(String(u)) && /Long/.test(String(u))) { if (++pieces > 1) return Promise.resolve(new Response(JSON.stringify({ error: "the Wi-Fi dropped" }), { status: 400 })); o = Object.assign({}, o, { body: o.body.slice(0, 1 << 20) }); }
      return realFetch(u, o);
    };
    try { await PPTransfer.sendSet(pl); return null; } catch (e) { return e.message; } finally { window.fetch = realFetch; }
  }).catch((e) => "THREW " + e.message);
  assert.ok(err, "the upload stopped");
  assert.deepEqual(await songsOnPi(), ["Shared Song", "New In B"]);
  assert.equal(readJson(path.join(tmp, "current-set.json")).name, "Set B");
  assert.ok(!libFiles().some((f) => /Long/.test(f)), "nothing of set C in the library yet");
});
await check("a package sent without all of its files is refused (nothing changes)", async () => {
  const b = await (await fetch("http://127.0.0.1:8080/api/pedal/begin", { method: "POST", body: JSON.stringify({ code: "4321", mode: "set", from: "Test" }) })).json();
  const r = await fetch("http://127.0.0.1:8080/api/pedal/commit?token=" + b.token, { method: "POST", body: JSON.stringify({ mode: "set", set: { name: "Broken" }, songs: [], stems: [{ fid: "st-x", sha: "0".repeat(64), name: "x.wav" }], samples: [], banks: [] }) });
  assert.equal(r.status, 409); const j = await r.json(); assert.deepEqual(j.missing, ["st-x"]);
  assert.equal(readJson(path.join(tmp, "current-set.json")).name, "Set B");
});
await check("Upload again: it carries on where it stopped (what arrived isn't sent again) and the pedal switches to set C", async () => {
  expectReload();
  const r = await E(async () => { const pl = await PPTransfer.prepareSet("127.0.0.1:8080", "4321", []); const got = Object.assign({}, pl.begin.received); await PPTransfer.sendSet(pl); return { got: got, toSend: pl.toSend, total: pl.send.reduce((a, x) => a + x.ref.size, 0) }; });
  assert.ok(Object.values(r.got).some((n) => n >= 1 << 20), "a piece was there already: " + JSON.stringify(r.got));
  assert.ok(r.toSend < r.total, "less to send than the files' size");
  await switched();
  assert.deepEqual(await songsOnPi(), ["Shared Song", "New In B", "Long Song"]);
  const ok = await P(async () => { const s = PP.project().songs.filter((x) => x.name === "Long Song")[0], rec = await PPTracks.getStem(s.tracks.stems[0].id); return rec && rec.length > 100000; });
  assert.ok(ok, "the long track decodes on the pedal");
});

console.log("\nA set that doesn't fit, sounds, and edits made on the pedal:");
await check("a set bigger than the pedal's free space: the review says so and Send is off", async () => {
  const r = await E(async () => {
    await PPTransfer.open("up"); const pl = await PPTransfer.prepareSet("127.0.0.1:8080", "4321", []);
    pl.begin.free = 50e6; pl.toSend = 5e9; PPTransfer.review(pl);
    const box = document.querySelector(".cp-review"), send = box.querySelector('[data-cp="send"]');
    let err = null; try { await PPTransfer.sendSet(pl); } catch (e) { err = e.message; }
    document.getElementById("cpTransferDialog").close();
    return { text: box.textContent, disabled: send.disabled, err };
  });
  assert.match(r.text, /doesn't fit/); assert.equal(r.disabled, true); assert.match(String(r.err), /doesn't fit/);
});
await check("keys sounds: a set's own bank goes into the pedal's sounds with its plan; one the pedal has is found by name; one it lacks is listed", async () => {
  const bank = Buffer.from("RIFF fake soundfont bytes for the test"), sha = crypto.createHash("sha256").update(bank).digest("hex");
  const b = await (await fetch("http://127.0.0.1:8080/api/pedal/begin", { method: "POST", body: JSON.stringify({ code: "4321", mode: "set", from: "Test Mac" }) })).json();
  const up = await fetch(`http://127.0.0.1:8080/api/pedal/chunk?token=${b.token}&id=bk-1&offset=0&total=${bank.length}&kind=bank&name=${encodeURIComponent("Central Instrument - Strings.sf2")}&sha=${sha}`, { method: "POST", body: bank });
  assert.equal(up.status, 200);
  const pkg = { mode: "set", set: { name: "Set D" }, parts: [], settings: {}, songs: [], stems: [], samples: [],
    banks: [{ fid: "bk-1", name: "Central Instrument - Strings.sf2", path: "/Users/me/sounds/Central Instrument - Strings.sf2", size: bank.length, sha: sha, tier: "instrument" }],
    bankRefs: ["/Users/me/sounds/Central Instrument - Strings.sf2", "/Users/me/sounds/Nowhere.sf2"] };
  expectReload();
  const c = await fetch("http://127.0.0.1:8080/api/pedal/commit?token=" + b.token, { method: "POST", body: JSON.stringify(pkg) });
  assert.equal(c.status, 200);
  await switched();
  const placed = path.join(tmp, "sounds", "sf2", "Central Instrument - Strings.sf2");
  assert.ok(fs.existsSync(placed), "the bank is in the pedal's sounds");
  assert.match(fs.readFileSync(path.join(tmp, "sounds", "sf2", "tiers.txt"), "utf8"), /^Central Instrument\|instrument\|/m, "its plan still opens it");
  const cur = readJson(path.join(tmp, "current-set.json"));
  assert.equal(cur.name, "Set D"); assert.deepEqual(cur.missing, ["Nowhere.sf2"]);
  assert.ok(fs.existsSync(path.join(tmp, "sounds", "sf2", "Central Keys - Upright.sf2")), "the installed library stays");
});
await check("an edit made on the pedal is flagged; the next upload warns and offers to bring it back first; a Download clears it", async () => {
  await P(() => { window.CP_SET_GRACE = 0; return PPTransfer.checkEdits(); });
  await until(() => P(() => PPTransfer.loadedSet() && PPTransfer.loadedSet().digest));
  await P(async () => { PP.project().songs.push({ id: "edit1", name: "Added On The Pedal", key: "G", bpm: 90 }); PP.persistNow(); await PPTransfer.checkEdits(); });
  const ls = await until(async () => { const j = await (await fetch("http://127.0.0.1:8766/pedal/loaded-set")).json(); return j.set && j.set.changed ? j.set : null; });
  assert.equal(ls.changed, true);
  const warn = await E(async () => { await PPTransfer.open("up"); await PPTransfer.prepareSet("127.0.0.1:8080", "4321", []); const t = document.querySelector(".cp-review").textContent; const btn = !!document.querySelector('.cp-review [data-cp="bringback"]'); document.getElementById("cpTransferDialog").close(); return { t, btn }; });
  assert.match(warn.t, /changed on the pedal/); assert.ok(warn.btn);
  const nav = E(() => PPTransfer.download("127.0.0.1:8080", "4321", ["songs", "pads"], "replace").catch((e) => "ERR " + e.message));
  await ed.waitForEvent("load", { timeout: 30000 });
  const err = await Promise.race([nav, wait(100).then(() => null)]); assert.ok(!err || !/^ERR/.test(err), String(err));
  await ed.waitForFunction(() => window.PPTransfer && window.PP);
  assert.ok((await E(() => PP.project().songs.map((s) => s.name))).includes("Added On The Pedal"), "the edit came back to the editor");
  await P(() => PPTransfer.checkEdits());
  const after = await until(async () => { const j = await (await fetch("http://127.0.0.1:8766/pedal/loaded-set")).json(); return j.set && !j.set.changed && !j.set.rebase ? j.set : null; });
  assert.equal(after.changed, false);
});
await check("no page errors", () => assert.deepEqual(errors, []));

await browser.close();
driver.kill();
if (failures) console.log("\n--- driver log tail ---\n" + dlog.split("\n").slice(-30).join("\n"));
console.log(failures ? `\n${failures} CHECK(S) FAILED` : "\nALL SET CHECKS PASSED");
process.exit(failures ? 1 : 0);
