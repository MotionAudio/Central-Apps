#!/usr/bin/env node
/**
 * 10.0 Setlists in the app (Central Pedal, Central Pedal Control, Central Control's player window - the same page):
 * the Setlist dialog has Load setlist · Create new · Add songs. Create new names it and picks the team from the
 * church's Central Services people (on the account); Add songs sends you to the website on that setlist and the songs
 * added there download into it by themselves; Load setlist lists the church's setlists and opens one, using the songs
 * this device already has. A stand-in for the Motion Audio website answers /v1/... here.
 *   node test-setlists.mjs
 */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import assert from "node:assert/strict";

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cp-setlists-"));
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

// ---- a stand-in for the Motion Audio website
const calls = [], setlists = { 8: { id: "8", name: "Wednesday", team: [], songs: [{ trackId: "55", title: "Amazing Grace", key: "G", bpm: 72, kind: "Multitrack" }], updatedAt: new Date().toISOString() } };
const PEOPLE = [{ email: "kim@grace.test", name: "Kim Keys", role: "Keys", team: "Band A" }, { email: "dan@grace.test", name: "Dan Drums", role: "Drums", team: "Band A" }];
let nextId = 7;
const out = (s) => ({ id: s.id, name: s.name, count: s.songs.length, team: s.team, updatedAt: s.updatedAt, titles: s.songs.slice(0, 6).map((x) => x.title) });
const site = http.createServer(async (req, res) => {
  const send = (code, body, type) => { res.writeHead(code, { "Content-Type": type || "application/json", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Authorization", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" }); res.end(type ? body : JSON.stringify(body)); };
  if (req.method === "OPTIONS") return send(204, "", "text/plain");
  let body = ""; for await (const c of req) body += c; const j = body ? JSON.parse(body) : {};
  const u = new URL(req.url, "http://x"), p = u.pathname;
  calls.push({ method: req.method, path: p + u.search, body: j, auth: req.headers.authorization });
  if (p === "/files/grace.wav") return send(200, wav(2, 22050, 196), "audio/wav");
  if (req.headers.authorization !== "Bearer tok-100") return send(401, { error: "Sign in to Central Tracks" });
  if (p === "/v1/me") return send(200, { email: "lead@grace.test", subscribed: true });
  if (p === "/v1/tracks") return send(200, { tracks: [] });
  if (p === "/v1/setlists" && req.method === "GET") return send(200, { setlists: Object.values(setlists).map(out), church: "Grace 100", teamMax: 2 });
  if (p === "/v1/setlists/people") { const q = (u.searchParams.get("q") || "").toLowerCase(); return send(200, { people: PEOPLE.filter((x) => (x.name + x.email).toLowerCase().includes(q)), max: 2, total: 2, church: "Grace 100", why: "" }); }
  if (p === "/v1/setlists" && req.method === "POST") { const s = { id: String(nextId++), name: j.name, team: (j.team || []).map((t) => ({ email: t.email, name: t.name, role: t.role })), songs: [], serviceAt: j.serviceAt, updatedAt: new Date().toISOString() }; setlists[s.id] = s; return send(200, { setlist: s }); }
  let m = p.match(/^\/v1\/setlists\/(\d+)$/);
  if (m && req.method === "GET") return setlists[m[1]] ? send(200, { setlist: setlists[m[1]] }) : send(404, { error: "That setlist isn't here any more." });
  if (m && req.method === "POST") { const s = setlists[m[1]]; if (j.songs) { const have = new Set(j.songs.filter((x) => x.trackId).map((x) => x.trackId)); s.songs = j.songs.concat(s.songs.filter((x) => x.fromWeb && !have.has(x.trackId) && !(j.removed || []).includes(x.trackId))); } return send(200, { setlist: s }); }
  m = p.match(/^\/v1\/tracks\/(\d+)\/add$/);
  if (m) return send(200, { kind: "Multitrack", files: [{ name: "Grace Click.wav", url: "http://127.0.0.1:" + site.address().port + "/files/grace.wav" }] });
  send(404, { error: "no " + p });
});
await new Promise((r) => site.listen(0, "127.0.0.1", r));
const SITE = "http://127.0.0.1:" + site.address().port;

const driver = spawn("python3", [path.join(here, "pedal-driver.py"), "--simulate", tmp, "--app-root", here], { stdio: ["ignore", "pipe", "pipe"] });
let dlog = ""; driver.stderr.on("data", (d) => { dlog += d; }); driver.stdout.on("data", (d) => { dlog += d; });
process.on("exit", () => { try { driver.kill("SIGKILL"); } catch (_) { } });
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(1));
process.on("uncaughtException", (e) => { console.error(e); process.exit(1); });
process.on("unhandledRejection", (e) => { console.error(e); process.exit(1); });
for (let i = 0; i < 100; i++) { try { await fetch("http://127.0.0.1:8766/app/"); break; } catch (_) { await wait(200); } }

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const errors = [];
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript((s) => { try { if (!localStorage.getItem("central-tracks")) localStorage.setItem("central-tracks", JSON.stringify({ server: s, token: "tok-100" })); } catch (_) { } }, SITE);
await page.goto("http://127.0.0.1:8766/app/");
await page.waitForFunction(() => window.PPSetlists && window.PPTracks && window.__pedalBridge && window.__pedalBridge.connected, null, { timeout: 25000 });
await page.evaluate(() => { const d = document.getElementById("licenseWall") || document.querySelector(".license-wall"); if (d) d.remove(); });
const P = (fn, a) => page.evaluate(fn, a);

try {
  console.log("the Setlist dialog:");
  await check("♫ Setlist has three big buttons: Load setlist, Create new, Add songs", async () => {
    await P(() => document.getElementById("setlistButton").click());
    const labels = await P(() => [...document.querySelectorAll("#setlistDialog #slButtons button")].map((b) => b.textContent));
    assert.deepEqual(labels, ["Load setlist", "Create new", "Add songs"]);
  });

  console.log("Create new:");
  await check("it asks for a name and the day, and finds the team from the church's people", async () => {
    await P(() => document.querySelector('#slButtons [data-slx="create"]').click());
    await page.waitForSelector("#slDialog[open] #slName");
    await page.waitForSelector('#slDialog [data-sl-pick="kim@grace.test"]');
    await page.fill("#slFind", "dan");
    await page.waitForFunction(() => !document.querySelector('[data-sl-pick="kim@grace.test"]') && document.querySelector('[data-sl-pick="dan@grace.test"]'), null, { timeout: 5000 });
    assert.ok(calls.some((c) => c.path.startsWith("/v1/setlists/people?q=dan")), "searched on the account");
  });
  await check("...pick someone (a chip, '1 of 2'), name it, Create: it's on the account and open here", async () => {
    await P(() => document.querySelector('[data-sl-pick="dan@grace.test"]').click());
    const chip = await P(() => [document.querySelector(".sl-chip").textContent, document.querySelector("#slBody").textContent.includes("1 of 2")]);
    assert.ok(/Dan Drums/.test(chip[0]) && chip[1], JSON.stringify(chip));
    await page.fill("#slName", "Sunday Test");
    await P(() => document.querySelector('[data-sl="create"]').click());
    await until(() => P(() => window.PP.project().setlistId === "cl_7"), 8000);
    const p = await P(() => { const p = window.PP.project(); return { name: p.name, cloud: p.setlistCloud, songs: p.songs.length, input: document.getElementById("projectName").value }; });
    const post = calls.find((c) => c.method === "POST" && c.path === "/v1/setlists");
    assert.equal(post.body.name, "Sunday Test"); assert.equal(post.body.team[0].email, "dan@grace.test"); assert.ok(post.body.serviceAt);
    assert.equal(p.name, "Sunday Test"); assert.equal(p.cloud.id, "7"); assert.equal(p.cloud.team[0].name, "Dan Drums"); assert.equal(p.songs, 0); assert.equal(p.input, "Sunday Test");
  });
  await check("...then it goes straight to Add songs: the website on this setlist", async () => {
    const t = await P(() => document.querySelector("#slBody").textContent);
    assert.ok(t.includes(SITE + "/#setlist-7") && /download here by themselves/.test(t), t.slice(0, 300));
    assert.ok(await P(() => !!document.querySelector('[data-sl="web"]')), "an Open the website button on a computer");
  });

  console.log("Add songs:");
  await check("a song added on the website downloads into the setlist by itself (with its tracks)", async () => {
    setlists[7].songs.push({ trackId: "55", title: "Amazing Grace", key: "G", bpm: 72, kind: "Multitrack", fromWeb: true });
    await until(() => P(() => window.PP.project().songs.some((s) => s.ctId === "55" && window.PPTracks.data(s).stems.length > 0)), 60000, 400);
    const s = await P(() => { const s = window.PP.project().songs.find((x) => x.ctId === "55"); return { name: s.name, key: s.key, stems: window.PPTracks.data(s).stems.length }; });
    assert.equal(s.name, "Amazing Grace"); assert.equal(s.key, "G");
    assert.ok(calls.some((c) => c.path === "/v1/tracks/55/add"), "downloaded with the account");
  });
  await check("...and the setlist on the account gets this device's list back (the song, by its Central Tracks id)", async () => {
    await until(() => calls.some((c) => c.method === "POST" && c.path === "/v1/setlists/7" && (c.body.songs || []).some((x) => x.trackId === "55" && x.localId)), 15000, 300);
  });
  await check("the Setlist dialog says it's on the church's account and who plays", async () => {
    const t = await P(() => document.getElementById("slInfo").textContent);
    assert.ok(/church's account/.test(t) && /Dan Drums/.test(t), t);
  });

  console.log("Load setlist:");
  await check("it lists the church's setlists (from any device) and the ones on this device", async () => {
    await P(() => document.querySelector('#slDialog [data-sl-view="load"]').click());
    await page.waitForSelector('[data-sl-cloud="8"]', { timeout: 8000 });
    const t = await P(() => document.querySelector("#slBody").textContent);
    assert.ok(/Grace 100's setlists/.test(t) && /Wednesday/.test(t) && /Sunday Test/.test(t) && /On this device/.test(t), t.slice(0, 400));
    assert.ok(/Amazing Grace/.test(t), "it shows what's in each");
  });
  await check("Open: the setlist comes from the account; a song this device has is used (not downloaded again)", async () => {
    const adds = calls.filter((c) => c.path === "/v1/tracks/55/add").length;
    await P(() => document.querySelector('[data-sl-cloud="8"]').click());
    await until(() => P(() => window.PP.project().setlistId === "cl_8" && window.PP.project().songs.length === 1), 15000);
    const p = await P(() => ({ name: window.PP.project().name, song: window.PP.project().songs[0].name, stems: window.PPTracks.data(window.PP.project().songs[0]).stems.length }));
    assert.equal(p.name, "Wednesday"); assert.equal(p.song, "Amazing Grace"); assert.ok(p.stems > 0);
    assert.equal(calls.filter((c) => c.path === "/v1/tracks/55/add").length, adds, "no second download");
  });
  await check("the earlier setlist opens again from the list", async () => {
    await P(() => window.PPSetlists.open("load"));
    await page.waitForSelector('[data-sl-cloud="7"]', { timeout: 8000 });
    await P(() => document.querySelector('[data-sl-cloud="7"]').click());
    await until(() => P(() => window.PP.project().setlistId === "cl_7" && window.PP.project().songs.some((s) => s.name === "Amazing Grace")), 15000);
  });

  console.log("not signed in:");
  await check("Create new still works, kept on this device; Add songs opens the usual ways to add songs", async () => {
    await P(() => { localStorage.setItem("central-tracks", JSON.stringify({ server: "" })); });
    await P(() => window.PPSetlists.open("create"));
    await page.waitForSelector("#slDialog[open] #slName");
    const t = await P(() => document.querySelector("#slBody").textContent);
    assert.ok(/once you're signed in/.test(t), t.slice(0, 300));
    await page.fill("#slName", "Rehearsal");
    await P(() => document.querySelector('[data-sl="create"]').click());
    await until(() => P(() => window.PP.project().name === "Rehearsal" && /^p_/.test(window.PP.project().setlistId) && !window.PPSetlists.cloud()), 5000);
    await P(() => document.querySelector('#slBody [data-sl="own"]').click());
    await until(() => P(() => document.getElementById("addDialog").open), 5000);
    await P(() => document.getElementById("addDialog").close());
  });
  await check("where the tracks run is said at the top (a computer: it keeps every song)", async () => {
    await P(() => window.PPSetlists.open("load"));
    const t = await P(() => document.getElementById("slWhere").textContent);
    assert.ok(/keeps every song's tracks|keeps the songs and runs the tracks/.test(t), t);
    await P(() => document.getElementById("slDialog").close());
  });
  await check("no page errors", async () => { assert.deepEqual(errors, []); });
} finally {
  await browser.close();
  site.close();
  try { driver.kill("SIGKILL"); } catch (_) { }
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(failures ? "\n" + failures + " CHECK(S) FAILED" : "\nALL APP SETLIST CHECKS PASSED");
if (failures) console.log(dlog.slice(-1500));
process.exit(failures ? 1 : 0);
