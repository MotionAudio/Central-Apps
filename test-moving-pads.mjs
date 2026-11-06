#!/usr/bin/env node
/**
 * (10.3) Central Pads Extra's moving pads in the pad pedal, in real headless Chromium: the pedal app (index.html, served
 * on 127.0.0.1 as on the Central Pedal) with the driver's library routes stood in (/libraries/pads, /libraries/loops
 * with a moving pad - a bed per key and its gate - and /libraries/loop with the bed's WAV).
 *   * the moving pad is in the Voice list under Central Pads, "(moving)";
 *   * it plays: the bed in the song's key at its own pitch, through a gate that's one bar long at the tempo;
 *   * what comes out pulses (loud on the gate's open steps, near silent on its closed ones);
 *   * a new tempo: the gate follows.
 *   node test-moving-pads.mjs
 */
import "./test-reap.mjs";
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path"; import fs from "node:fs"; import http from "node:http"; import assert from "node:assert/strict";

const here = path.dirname(fileURLToPath(import.meta.url));
let failures = 0;
async function check(label, fn) { try { await Promise.race([fn(), new Promise((_, no) => setTimeout(() => no(new Error("no answer after 45 s")), 45000))]); console.log("  ✓ " + label); } catch (e) { failures++; console.error("  ✗ " + label + "\n      " + String(e && e.message || e).split("\n").slice(0, 8).join("\n      ")); } }

// a 4-second bed: a steady chord (so any pulsing comes from the gate)
function wav(seconds, freq) {
  const rate = 22050, n = Math.round(seconds * rate), buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write("WAVEfmt ", 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(n * 4, 40);
  for (let i = 0; i < n; i++) { const v = Math.round(9000 * (Math.sin(2 * Math.PI * freq * i / rate) + 0.5 * Math.sin(2 * Math.PI * freq * 1.5 * i / rate))); buf.writeInt16LE(v, 44 + i * 4); buf.writeInt16LE(v, 46 + i * 4); }
  return buf;
}
const KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"], GATE = "9000900090009000";
const LOOPS = { loops: [{ id: "central-pads-extra/pulse/Heartbeat", name: "Heartbeat", group: null, set: "pulse", library: "central-pads-extra", tier: "pads",
  files: KEYS.map((k) => ({ file: "pulse/heartbeat-" + k.replace("#", "s") + ".wav", key: k, seconds: 4, gate: GATE })) }] };
const asked = [];

const root = here, TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
const site = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, "http://x").pathname), f = path.join(root, path.normalize(u).replace(/^([/\\])+/, ""));
  if (!f.startsWith(root) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(f).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store" }); fs.createReadStream(f).pipe(res);
});
await new Promise((ok) => site.listen(0, "127.0.0.1", ok));

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage();
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
await page.addInitScript(() => {   // (no driver: the app's socket goes nowhere; Central Pedal Control's key is the default one)
  const Real = window.WebSocket; window.WebSocket = function (url, p) { return new Real(/:876[56]/.test(String(url)) ? "ws://127.0.0.1:1/" : url, p); }; window.WebSocket.prototype = Real.prototype;
  try { localStorage.setItem("cc-license", JSON.stringify({ key: "PDEF-AULT-KEY0-2026", kind: "P", app: "pedal-control", okAt: Date.now(), production: "Test church", isDefault: true })); } catch (_) { }
  try { localStorage.setItem("cc-packages", JSON.stringify([{ key: "SDEF-AULT-KEY0-2026", okAt: Date.now(), plans: { pads: "2099-12-31T00:00:00.000Z" } }])); } catch (_) { }   // (the website checks plans now: this pedal has Central Pads)
});
await page.route(/^https?:\/\/(127\.0\.0\.1|localhost):876[56]\//, (r) => {
  const u = new URL(r.request().url()); asked.push(u.pathname + u.search);
  const cors = { "Access-Control-Allow-Origin": "*" };
  if (u.pathname === "/libraries/pads") return r.fulfill({ status: 200, headers: cors, contentType: "application/json", body: JSON.stringify({ pads: [] }) });
  if (u.pathname === "/libraries/loops") return r.fulfill({ status: 200, headers: cors, contentType: "application/json", body: JSON.stringify(LOOPS) });
  if (u.pathname === "/libraries/loop") return r.fulfill({ status: 200, headers: cors, contentType: "audio/wav", body: wav(4, 196) });
  return r.abort("connectionrefused");
});
await page.route(/motionaudio\.org/, (r) => r.abort("connectionrefused"));   // (the test never depends on the live website)
await page.goto("http://127.0.0.1:" + site.address().port + "/index.html");
await page.waitForFunction(() => window.__test && window.PP && window.PPShell, null, { timeout: 15000 });
await page.evaluate(() => { if (window.__pedalBridge) window.__pedalBridge.connect = function () { }; PPShell.showTab("pads"); });
const ID = "cpad:central-pads-extra/~Heartbeat";

await check("the moving pad is in the Voice list, under Central Pads, marked (moving)", async () => {
  await page.waitForFunction((id) => !!document.querySelector('#voice option[value="' + id + '"]'), ID, { timeout: 8000 });
  const r = await page.evaluate((id) => { const o = document.querySelector('#voice option[value="' + id + '"]'); return { text: o.textContent, group: o.parentNode.label }; }, ID);
  assert.match(r.text, /Heartbeat \(moving\)/); assert.match(r.group, /^Central Pads/);
});
await check("it plays in the song's key at its own pitch, through a gate one bar long at the tempo (120 BPM: 2 s)", async () => {
  await page.evaluate(() => { const p = PP.project(); p.tempo.bpm = 120; });
  await page.selectOption("#voice", ID);
  await page.evaluate(() => { const T = window.__test, p = T.currentPad(); p.key = "G"; p.loop = true; T.engine.playPad(T.selectedIndex()); });
  const v = await page.waitForFunction(() => { const a = window.__test.engine.active; return a && a.gateSrc && a.moveGain ? { rate: a.rate, gate: a.buffer.__gate, dur: a.gateSrc.buffer.duration, loop: a.gateSrc.loop, voice: a.pad.voice } : null; }, null, { timeout: 8000 }).then((h) => h.jsonValue());
  assert.equal(v.voice, ID); assert.equal(v.rate, 1, "at its own pitch"); assert.equal(v.gate, GATE); assert.ok(v.loop); assert.ok(Math.abs(v.dur - 2) < 0.01, "a bar at 120 BPM: " + v.dur);
  assert.ok(asked.some((a) => a.startsWith("/libraries/loop?") && /file=pulse%2Fheartbeat-G\.wav/.test(a)), "the G bed was asked for: " + asked.join(", "));
});
await check("what comes out pulses: loud on the open steps, near silent between them", async () => {
  const r = await page.evaluate(async () => {
    const a = window.__test.engine.active, ctx = a.ctx, an = ctx.createAnalyser(); an.fftSize = 512; a.moveGain.connect(an);
    const d = new Float32Array(an.fftSize), rms = [];
    for (let i = 0; i < 70; i++) { window.__pulseAt = i; an.getFloatTimeDomainData(d); let s = 0; for (const x of d) s += x * x; rms.push(Math.sqrt(s / d.length)); await new Promise((ok) => setTimeout(ok, 25)); }
    a.moveGain.disconnect(an); return rms;
  });
  const hi = Math.max(...r), lo = Math.min(...r.slice(10));
  assert.ok(hi > 0.02, "it sounds: " + hi.toFixed(4)); assert.ok(lo < hi * 0.15, "it pulses: quietest " + lo.toFixed(4) + " vs loudest " + hi.toFixed(4));
});
if (failures) {   // (what the page was doing, if that check didn't answer)
  const state = await Promise.race([page.evaluate(() => { const a = window.__test.engine.active, c = a && a.ctx; return { step: window.__pulseAt, hidden: document.hidden, ctx: c && c.state, time: c && c.currentTime, active: !!a, open: [...document.querySelectorAll("dialog[open]")].map((d) => d.id) }; }), new Promise((ok) => setTimeout(() => ok("the page itself isn't answering"), 5000))]);
  console.log("      page state: " + JSON.stringify(state));
}
await check("a new tempo: the gate follows (90 BPM: 2.67 s a bar)", async () => {
  const dur = await page.evaluate(() => { PP.project().tempo.bpm = 90; window.__test.engine.refreshAll(); return window.__test.engine.active.gateSrc.buffer.duration; });
  assert.ok(Math.abs(dur - 240 / 90) < 0.01, String(dur));
  await page.evaluate(() => window.__test.engine.stop());
});
await check("no page errors", async () => { assert.deepEqual(errors, []); });

await browser.close(); site.close();
console.log(failures ? `\n${failures} check(s) FAILED` : "\nMoving pads: all passed.");
process.exit(failures ? 1 : 0);
