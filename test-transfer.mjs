#!/usr/bin/env node
/**
 * Central Pedal Control <-> Central Pedal: Upload and Download.
 * A Central Pedal (the real driver, simulated pins) with its app, and an editor page with no driver of its own
 * (the way the iPad app runs) that uploads a song with its track, a pad and a control to it, the Pi app applying
 * it; then a fresh editor downloading it all back.
 *   node test-transfer.mjs
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import assert from "node:assert/strict";

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cp-transfer-"));
let failures = 0;
async function check(label, fn) { try { await fn(); console.log("  ✓ " + label); } catch (e) { failures++; console.error("  ✗ " + label + "\n      " + String(e && e.message ? e.message.split("\n").slice(0, 8).join("\n      ") : e)); } }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 8000, every = 100) { const t0 = Date.now(); for (;;) { try { const v = await fn(); if (v) return v; } catch (_) { } if (Date.now() - t0 > ms) throw new Error("timed out waiting"); await wait(every); } }

function wav(seconds, rate, freq) {
  const n = Math.floor(seconds * rate), buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8); buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) { const t = i / rate, ph = (t * 2) % 1; buf.writeInt16LE(Math.round((0.3 * Math.sin(2 * Math.PI * freq * t) + (ph < 0.03 ? 0.6 : 0)) * 20000), 44 + i * 2); }
  return buf;
}

const driver = spawn("python3", [path.join(here, "pedal-driver.py"), "--simulate", tmp, "--app-root", here], { stdio: ["ignore", "pipe", "pipe"] });
let dlog = ""; driver.stderr.on("data", (d) => { dlog += d; }); driver.stdout.on("data", (d) => { dlog += d; });
for (let i = 0; i < 100; i++) { try { await fetch("http://127.0.0.1:8766/app/"); await fetch("http://127.0.0.1:8080/api/info"); break; } catch (_) { await wait(200); } }

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const errors = [];
// the Central Pedal's own screen
const pi = await browser.newPage({ viewport: { width: 1280, height: 800 } });
pi.on("pageerror", (e) => errors.push("pi: " + e.message));
await pi.goto("http://127.0.0.1:8766/app/");
await pi.waitForFunction(() => window.PPTransfer && window.__pedalBridge && window.__pedalBridge.connected, null, { timeout: 20000 });
await pi.evaluate(() => window.__pedalBridge.send({ type: "pairCode", pin: "4321" }));
await wait(800);

// an editor with no driver of its own (like the iPad app): its own storage, nothing on 127.0.0.1:8765 / 8766
async function editor() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.route(/127\.0\.0\.1:8766\//, (r) => r.abort());
  await ctx.addInitScript(() => {
    window.CP_CONTROL = true;
    const WS = window.WebSocket;
    window.WebSocket = function (url, p) { if (/127\.0\.0\.1:876[56]/.test(url)) { const fake = new WS("ws://127.0.0.1:9/"); return fake; } return new WS(url, p); };
    window.WebSocket.prototype = WS.prototype; window.WebSocket.OPEN = 1; window.WebSocket.CLOSED = 3;
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push("editor: " + e.message));
  await page.goto("file://" + path.join(here, "index.html"));
  await page.waitForFunction(() => window.PPTransfer && window.PPTracks && window.PP);
  return { ctx, page };
}

console.log("Central Pedal Control → Central Pedal:");
const ed = await editor();
const E = (fn, a) => ed.page.evaluate(fn, a), P = (fn, a) => pi.evaluate(fn, a);
const stemB64 = wav(4, 22050, 220).toString("base64");

await check("the editor (no driver, like the iPad app) shows ⇪ Upload / ⇩ Download; the Central Pedal's own screen does not", async () => {
  assert.ok(await E(() => document.body.classList.contains("pedal-control") && !document.querySelector("#cpTransfer").classList.contains("hidden")));
  assert.ok(await P(() => !document.body.classList.contains("pedal-control") && document.querySelector("#cpTransfer").classList.contains("hidden")));
});
await check("a song made in the editor (its track decoded there), a renamed pad and a remapped footswitch", async () => {
  await E(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), f = new File([bytes], "Keys.wav", { type: "audio/wav" });
    const s = PPTracks.newSong("Upload Song"); PPFeatures.loadSong(PP.project().songs.length - 1); await PPTracks.importFilesIntoSong(s, [f]);
    PP.project().pads[0].name = "Uploaded Pad"; PPActions.mapping().b1 = { action: "tap" }; const ip = PP.project(); PPInstrument.config().kind = "keys"; ip.theme = Object.assign({}, ip.theme || {}, { accent: "#ff4d6d" }); ip.setups = [{ id: "su_editor", name: "Editor Setup", settings: {} }]; ip.practice = { tempo: 80 }; ip.streamDeck = { brightness: 33 }; ip.backup = { mode: "button", timeoutMs: 2500 }; PP.project().netAudio = { mode: "wifi", quality: "saver", instrument: false }; PP.persistNow();
  }, stemB64);
  const st = await E(async () => { const s = PP.project().songs.filter((x) => x.name === "Upload Song")[0], st = s.tracks.stems[0]; return { n: s.tracks.stems.length, file: st.file || null, local: !!(await PPTracks.getStemLocal(st.id)) }; });
  assert.equal(st.n, 1); assert.equal(st.file, null, "no driver: no library file"); assert.ok(st.local, "decoded into the editor's store");
});
await check("a wrong PIN is refused", async () => {
  const err = await E(async () => { try { await PPTransfer.upload("127.0.0.1:8080", "0000", ["pads"], "replace"); return null; } catch (e) { return e.message; } });
  assert.match(String(err), /PIN/);
});
await check("Upload: the song with its track, the pads and the controls go over; the Central Pedal shows what arrived", async () => {
  await E(() => PPTransfer.upload("127.0.0.1:8080", "4321", ["songs", "pads", "controls", "instrument", "setups", "look", "netaudio"], "replace"));
  await until(() => P(() => !!document.querySelector(".cp-arrived") && /Central Pedal Control|iPad|Mac/.test(document.querySelector(".cp-arrived").textContent)), 8000);
  const txt = await P(() => document.querySelector(".cp-arrived").textContent);
  assert.match(txt, /1 songs/); assert.match(txt, /Pads and sounds/); assert.match(txt, /Buttons, knobs/); assert.match(txt, /Network audio/); assert.match(txt, /Instrument/); assert.match(txt, /Saved setups/); assert.match(txt, /Colours/);
});
await check("Apply on the Central Pedal: its setlist is the editor's, the track is in its library (decoded from there), the pad and the footswitch changed", async () => {
  await P(() => document.querySelector('.cp-arrived [data-ar="apply"]').click());
  await pi.waitForEvent("load", { timeout: 20000 });
  await pi.waitForFunction(() => window.PPTracks && window.PP && window.__pedalBridge && window.__pedalBridge.connected, null, { timeout: 20000 });
  const r = await P(() => { const p = PP.project(), s = p.songs.filter((x) => x.name === "Upload Song")[0]; return { songs: p.songs.map((x) => x.name), file: s && s.tracks.stems[0].file, pad: p.pads[0].name, b1: PPActions.mapping().b1 && PPActions.mapping().b1.action }; });
  assert.deepEqual(r.songs, ["Upload Song"]); assert.equal(r.pad, "Uploaded Pad"); assert.equal(r.b1, "tap");
  assert.ok(r.file && r.file.startsWith(tmp) && fs.existsSync(r.file), "in the library: " + r.file);
  const ok = await P(async () => { const s = PP.project().songs.filter((x) => x.name === "Upload Song")[0]; const rec = await PPTracks.getStem(s.tracks.stems[0].id); return rec && rec.length > 1000; });
  assert.ok(ok, "the track decodes from the library");
});
await check("...the instrument, the saved setups, the look, the Stream Deck, the backup player and the practice-mix settings came too (and survive the reload)", async () => {
  const r = await P(() => { const p = PP.project(); return { kind: PPInstrument.config().kind, accent: p.theme && p.theme.accent, setups: (p.setups || []).map((x) => x.name), tempo: p.practice && p.practice.tempo, sd: p.streamDeck && p.streamDeck.brightness, bk: p.backup && p.backup.mode + "/" + p.backup.timeoutMs }; });
  assert.equal(r.kind, "keys"); assert.equal(r.accent, "#ff4d6d"); assert.deepEqual(r.setups, ["Editor Setup"]); assert.equal(r.tempo, 80); assert.equal(r.sd, 33, "Stream Deck settings (controls part) kept after the reload"); assert.equal(r.bk, "button/2500", "backup player settings");
});
await check("...and the network audio set up in the editor (Wi-Fi, saver quality, no instrument) is now the Central Pedal's", async () => {
  const na = await until(() => { try { const j = JSON.parse(fs.readFileSync(path.join(tmp, "netaudio.json"), "utf8")); return j.mode === "wifi" ? j : null; } catch (_) { return null; } }, 5000);
  assert.equal(na.quality, "saver"); assert.equal(na.instrument, false);
});

console.log("\nCentral Pedal → Central Pedal Control (Download):");
const ed2 = await editor();
const E2 = (fn, a) => ed2.page.evaluate(fn, a);
await check("Download into a fresh editor: the Central Pedal packs its songs, pads and controls; the track comes back decoded", async () => {
  await P(() => { PP.project().pads[1].name = "Pi Pad"; PP.persistNow(); });
  const nav = E2(() => PPTransfer.download("127.0.0.1:8080", "4321", ["songs", "pads", "controls"], "replace").catch((e) => "ERR " + e.message));
  await ed2.page.waitForEvent("load", { timeout: 30000 });
  const err = await Promise.race([nav, wait(100).then(() => null)]); assert.ok(!err || !/^ERR/.test(err), String(err));
  await ed2.page.waitForFunction(() => window.PPTracks && window.PP);
  const r = await E2(async () => { const p = PP.project(), s = p.songs.filter((x) => x.name === "Upload Song")[0]; return { songs: p.songs.map((x) => x.name), pad0: p.pads[0].name, pad1: p.pads[1].name, rec: s ? !!(await PPTracks.getStemLocal(s.tracks.stems[0].id)) : false }; });
  assert.deepEqual(r.songs, ["Upload Song"]); assert.equal(r.pad0, "Uploaded Pad"); assert.equal(r.pad1, "Pi Pad"); assert.ok(r.rec, "track decoded into the editor");
});
await check("the token only reaches what the package lists (no other file on the Central Pedal)", async () => {
  const r = await fetch("http://127.0.0.1:8080/api/pedal/begin", { method: "POST", body: JSON.stringify({ code: "4321" }) }); const j = await r.json();
  const f = await fetch("http://127.0.0.1:8080/api/pedal/export-file?token=" + j.token + "&id=" + encodeURIComponent(path.join(tmp, "project.json")));
  assert.equal(f.status, 404);
  const g = await fetch("http://127.0.0.1:8080/api/pedal/export?token=" + j.token); assert.equal(g.status, 403, "an upload token can't read a download");
});
await check("no page errors", () => assert.deepEqual(errors, []));

await browser.close();
driver.kill();
if (failures) console.log("\n--- driver log tail ---\n" + dlog.split("\n").slice(-25).join("\n"));
console.log(failures ? `\n${failures} CHECK(S) FAILED` : "\nALL TRANSFER CHECKS PASSED");
process.exit(failures ? 1 : 0);
