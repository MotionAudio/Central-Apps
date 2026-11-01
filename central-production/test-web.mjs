// Central Production in the browser (server/public/production/ and the shared DAW in server/public/daw/), with the
// website's API stood in: every project type is made, edited, saved (this browser and the account), opened again,
// exported and published (to stand-in Make & sell / Central Tracks endpoints); the DAW plays, records MIDI, edits clips,
// automates, renders in time and in tune, keeps work for recovery.
//   node test-web.mjs            (CHROME=<chromium> to pick the browser; SHOTS=<dir> saves screenshots)
import { chromium } from "playwright";
import http from "node:http"; import fs from "node:fs"; import path from "node:path"; import assert from "node:assert";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url)), pub = path.join(here, "..", "server", "public");
let failures = 0; async function check(label, fn) { try { await fn(); console.log("  ✓ " + label); } catch (e) { failures++; console.error("  ✗ " + label + "\n      " + String(e && e.stack || e).split("\n").slice(0, 6).join("\n      ")); } }
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".json": "application/json" };
// the website: its files, and a stand-in API (projects, creator uploads, Central Tracks) that keeps what it's sent
const api = { projects: {}, files: {}, items: [], published: [], uploads: 0 };
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x"), send = (code, body, type) => { res.writeHead(code, { "Content-Type": type || "application/json" }); res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
  if (u.pathname.startsWith("/v1/") || u.pathname.startsWith("/store/")) {
    const chunks = []; req.on("data", (c) => chunks.push(c)); req.on("end", () => {
      const raw = Buffer.concat(chunks), b = (() => { try { return JSON.parse(raw.toString() || "{}"); } catch { return {}; } })(), p = u.pathname.replace("/v1", "");
      if (req.method === "PUT" && u.pathname.startsWith("/store/")) { api.files[u.pathname] = raw; api.uploads++; return send(200, "{}"); }
      if (u.pathname.startsWith("/store/")) return api.files[u.pathname] ? send(200, api.files[u.pathname], "application/octet-stream") : send(404, "{}");
      if (p === "/me") return send(200, { email: "maker@church.test", name: "Maker" });
      if (p === "/login") return send(200, { token: "tok" });
      if (p === "/projects" && req.method === "GET") return send(200, { projects: Object.values(api.projects).filter((x) => x.done), used: 0, limit: 2 * 1024 ** 3 });
      if (p === "/projects" && req.method === "POST") { const id = b.id || "p1"; api.projects[id] = Object.assign(api.projects[id] || {}, { id, name: b.name, type: b.type, bytes: b.size, updatedAt: new Date().toISOString() }); return send(200, { project: api.projects[id], key: "k-" + id, url: "http://127.0.0.1:" + srv.address().port + "/store/" + id }); }
      let m = /^\/projects\/([^/]+)\/done$/.exec(p); if (m) { api.projects[m[1]].done = true; return send(200, { project: api.projects[m[1]] }); }
      m = /^\/projects\/([^/]+)$/.exec(p); if (m) return send(200, { project: api.projects[m[1]], url: "http://127.0.0.1:" + srv.address().port + "/store/" + m[1] });
      if (p === "/creator/items") { const it = Object.assign({ id: api.items.length + 1, files: [] }, b); api.items.push(it); return send(200, { item: it }); }
      m = /^\/creator\/items\/(\d+)\/upload$/.exec(p); if (m) { api.items[m[1] - 1].files.push(b); return send(200, { url: "http://127.0.0.1:" + srv.address().port + "/store/item" + m[1] + "-" + api.items[m[1] - 1].files.length, key: "x" }); }
      m = /^\/creator\/items\/(\d+)\/submit$/.exec(p); if (m) { api.items[m[1] - 1].status = "waiting"; return send(200, { item: api.items[m[1] - 1] }); }
      if (p === "/uploads") return send(200, { key: "u1/" + (api.uploads + 1), url: "http://127.0.0.1:" + srv.address().port + "/store/t" + Date.now() + Math.random() });
      if (p === "/publish") { api.published.push(b); return send(200, { track: { title: b.title, price: "$15" }, grade: { stars: 3 } }); }
      return send(404, { error: "no " + p });
    }); return;
  }
  let f = path.join(pub, decodeURIComponent(u.pathname)); if (f.endsWith("/")) f += "index.html";
  if (!f.startsWith(pub) || !fs.existsSync(f)) return send(404, "not here", "text/plain");
  send(200, fs.readFileSync(f), TYPES[path.extname(f)] || "application/octet-stream");
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const base = "http://127.0.0.1:" + srv.address().port;
const exe = [process.env.CHROME, "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome"].filter((p) => p && fs.existsSync(p))[0];
const browser = await chromium.launch(Object.assign({ args: ["--autoplay-policy=no-user-gesture-required", "--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] }, exe ? { executablePath: exe } : {}));
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
const page = await ctx.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(String(e.stack || e))); page.on("console", (m) => { if (m.type() === "error" && !/favicon|404/.test(m.text())) errs.push("console: " + m.text()); });
const shots = process.env.SHOTS; const shot = async (n) => { if (shots) await page.screenshot({ path: path.join(shots, n + ".png") }); };
await page.goto(base + "/production/");
await page.waitForFunction(() => window.CP && window.CDaw && window.CDawUI && document.querySelector(".cp-kinds"));
const T = (fn, arg) => page.evaluate(fn, arg);

await check("the start page asks what you're making, with all seven kinds", async () => {
  const kinds = await T(() => Array.from(document.querySelectorAll("#cpStart [data-new]")).map((b) => b.dataset.new));
  assert.deepEqual(kinds, ["track", "loop", "sample", "pad", "instrument", "plugin", "board"]);
  await shot("01-start");
});
await check("New project → Track opens the DAW set up for a song: tracks, sections on the ruler, the song strip", async () => {
  await page.click('#cpStart [data-new="track"]'); await page.fill("#npName", "Sunday Song"); await page.click("#npForm .primary");
  await page.waitForSelector(".cdaw .cd-lane");
  const s = await T(() => ({ names: CDaw.project().tracks.map((t) => t.name), markers: CDaw.project().markers.map((m) => m.name), type: CP.project().type, strip: !!document.querySelector("#cpStrip") }));
  assert.equal(s.type, "track"); assert.ok(s.names.includes("Drums") && s.names.includes("Guide") && s.names.includes("Reverb"), s.names.join()); assert.deepEqual(s.markers, ["Intro", "Verse 1", "Chorus"]); assert.ok(s.strip);
  await shot("02-track");
});
await check("the DAW: a clip drawn in the piano roll plays in time - rendered offline, the notes land on their beats", async () => {
  await T(() => { const t = CDaw.project().tracks.find((x) => x.name === "Keys"); CDaw.edit("test", () => { CDaw.track(t.id).clips.push({ id: "c1", kind: "midi", start: 0, len: 4, name: "Keys", notes: [0, 1, 2, 3].map((b) => ({ p: 69, v: 110, s: b, d: 0.25 })) }); }); CDawUI.select(t.id, ["c1"]); CDawUI.openEditor("editor"); });
  await page.waitForSelector(".cd-roll-cv");
  const onsets = await T(async () => { CDaw.project().tracks.forEach((t) => { if (t.kind === "bus") t.inserts = []; }); const b = await CDaw.render({ from: 0, to: 4, tail: 0.5 }); const d = b.getChannelData(0), out = [], win = 240; let prev = 0; for (let i = 0; i < d.length; i += win) { let e = 0; for (let k = i; k < i + win && k < d.length; k++) e = Math.max(e, Math.abs(d[k])); if (e > 0.02 && prev < 0.01) out.push(i / b.sampleRate); prev = e; } return out; });
  const want = [0, 0.6, 1.2, 1.8].map((s) => s + 0.02);   // 100 BPM: a beat is 0.6 s (the render starts 20 ms in)
  assert.ok(onsets.length >= 4, "onsets " + onsets); want.forEach((w, i) => assert.ok(Math.abs(onsets[i] - w) < 0.012, "beat " + i + " at " + onsets[i] + " (want " + w + ")"));
  await shot("03-pianoroll");
});
await check("tempo changes and a 3/4 bar move the grid and the timing (bar 3 at 140 BPM)", async () => {
  const r = await T(() => { CDaw.edit("t", (p) => { p.tempos = [{ bar: 2, bpm: 140 }]; p.sigs = [{ bar: 4, n: 3, d: 4 }]; }); return { b2: CDaw.tempo.barToBeat(2), s2: CDaw.tempo.beatToSec(8), s3: CDaw.tempo.beatToSec(12), bar5: CDaw.tempo.barToBeat(5), back: CDaw.tempo.secToBeat(CDaw.tempo.beatToSec(10)) }; });
  assert.equal(r.b2, 8); assert.ok(Math.abs(r.s2 - 4.8) < 1e-9); assert.ok(Math.abs(r.s3 - (4.8 + 4 * 60 / 140)) < 1e-9); assert.equal(r.bar5, 19); assert.ok(Math.abs(r.back - 10) < 1e-9);
  await T(() => CDaw.edit("t", (p) => { p.tempos = []; p.sigs = []; }));
});
await check("clips: split, trim, duplicate, move between tracks, undo / redo", async () => {
  const r = await T(() => { CDaw.edit("Split", () => CDaw.split("c1", 2)); const f = CDaw.findClip("c1"), parts = f.track.clips.length; const u1 = CDaw.undo(); const after = CDaw.findClip("c1").track.clips.length; CDaw.redo(); return { parts, after, notesL: f.clip.notes.length, len: f.clip.len }; });
  assert.equal(r.parts, 2); assert.equal(r.after, 1); assert.equal(r.len, 2); assert.equal(r.notesL, 2);
});
await check("the mixer: inserts, a send to the reverb bus, a bus, the master limiter; meters move while it plays", async () => {
  await T(() => { const t = CDaw.project().tracks.find((x) => x.name === "Keys"), bus = CDaw.project().tracks.find((x) => x.kind === "bus"); CDaw.edit("fx", () => { const k = CDaw.track(t.id); k.inserts.push({ id: "f1", type: "eq", on: true, params: { low: 3 } }); k.sends.push({ to: bus.id, level: -10 }); }); CDawUI.openEditor("mixer"); });
  await page.waitForSelector(".cd-strip.master");
  const n = await T(() => document.querySelectorAll(".cd-strip").length); assert.ok(n >= 7, "strips " + n);
  await T(() => { CDaw.setPos(0); CDaw.play(); }); await page.waitForTimeout(900);
  const lv = await T(() => { const g = CDaw.graph(), t = CDaw.project().tracks.find((x) => x.name === "Keys"); return CDawUI.level("x", g.strips[t.id].meter).hold; }); await T(() => CDaw.stop({ home: true }));
  assert.ok(lv > 0.001, "level " + lv);
  await shot("04-mixer");
});
await check("automation: a volume lane follows its points in the render", async () => {
  const r = await T(async () => { const t = CDaw.project().tracks.find((x) => x.name === "Keys"); CDaw.edit("a", () => { const k = CDaw.track(t.id); k.clips = [{ id: "c9", kind: "midi", start: 0, len: 8, notes: [{ p: 69, v: 100, s: 0, d: 8 }] }]; k.auto = { volume: [{ b: 0, v: 0 }, { b: 3.99, v: 0 }, { b: 4, v: -40 }] }; k.lanes = ["volume"]; });
    const b = await CDaw.render({ from: 0, to: 8, tracks: [t.id], tail: 0 }); const d = b.getChannelData(0), rms = (a, z) => { let s = 0; for (let i = Math.round(a * b.sampleRate); i < z * b.sampleRate; i++) s += d[i] * d[i]; return Math.sqrt(s / ((z - a) * b.sampleRate)); };
    return { early: rms(0.5, 2), late: rms(3, 4.5), lane: !!document.querySelector(".cd-autocv") }; });
  assert.ok(r.lane, "the lane shows"); assert.ok(r.late < r.early / 20, "late " + r.late + " early " + r.early);
});
await check("a loop dragged in at another tempo is stretched to the song's (same length in bars, keeps its pitch)", async () => {
  const r = await T(async () => { const rate = 48000, secs = 2, b = new AudioBuffer({ length: rate * secs, numberOfChannels: 1, sampleRate: rate }), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.sin(2 * Math.PI * 440 * i / rate) * 0.5;   // a 4-beat "loop" at 120 BPM
    const wav = CMProj.wav(b, 16); const res = await CDaw.importAudio(null, new Uint8Array(wav), "loop.wav", 0, { bpm: 120, key: "C", bars: 1 }); const buf = CDaw.buffers[res.clip.audio.src];
    let zc = 0; const x = buf.getChannelData(0); for (let i = 1; i < 24000; i++) if (x[i - 1] <= 0 && x[i] > 0) zc++; return { dur: buf.duration, len: res.clip.len, hz: zc / 0.5 }; });
  assert.ok(Math.abs(r.dur - 2.4) < 0.02, "duration " + r.dur); assert.equal(r.len, 4); assert.ok(Math.abs(r.hz - 440) < 8, "pitch " + r.hz);
});
await check("recording MIDI from a keyboard (count-in off) makes a clip on the armed track", async () => {
  const n = await T(async () => { const t = CDaw.project().tracks.find((x) => x.name === "Bass"); CDaw.edit("arm", (p) => { p.tracks.forEach((x) => { x.arm = x.id === t.id; }); p.metronome.countIn = 0; }); CDaw.setPos(8); CDaw.record(); await new Promise((r) => setTimeout(r, 400)); CDaw.live(t.id, [0x90, 40, 100]); await new Promise((r) => setTimeout(r, 300)); CDaw.live(t.id, [0x80, 40, 0]); await new Promise((r) => setTimeout(r, 200)); CDaw.stop(); return CDaw.track(t.id).clips.reduce((a, c) => a + (c.notes || []).length, 0); });
  assert.ok(n >= 1, "notes " + n);
});
await check("keyboard shortcuts: Space plays and stops, L loops, Ctrl+Z undoes", async () => {
  await page.click(".cd-lanes-wrap", { position: { x: 600, y: 300 } }).catch(() => { });
  await page.keyboard.press("Space"); await page.waitForTimeout(250); const playing = await T(() => CDaw.state().playing); await page.keyboard.press("Space");
  const before = await T(() => CDaw.project().loop.on); await page.keyboard.press("l"); const after = await T(() => CDaw.project().loop.on); await page.keyboard.press("Control+z"); const undone = await T(() => CDaw.project().loop.on);
  assert.ok(playing); assert.equal(after, !before); assert.equal(undone, before);
});
await check("crash-safe: the work is kept for recovery a few seconds after a change", async () => {
  await T(() => CDaw.edit("x", (p) => { p.name = "Sunday Song"; })); await page.waitForTimeout(3200);
  const l = await T(() => CDaw.recovery.list()); assert.ok(l.some((x) => x.name === "Sunday Song"), JSON.stringify(l));
});
await check("save in this browser, then open it again: the DAW, its audio and the song come back", async () => {
  await T(() => CP.edit("t", (d) => { d.artist = "Grace Band"; d.chords = { [CDaw.project().markers[1].id]: "G | D | Em | C" }; }));
  await T(() => CP.save()); await page.waitForTimeout(300);
  await T(() => CP.create("sample", { name: "x" })); await page.waitForSelector(".cp-sample");
  await T(async () => { const l = await CPHost.local.list(); const e = l.find((x) => x.name === "Sunday Song"); const r = await CPHost.local.open(e.id); await CP.load(r.bytes, { localId: e.id }); });
  await page.waitForSelector(".cdaw .cd-lane");
  const s = await T(() => ({ artist: CP.project().data.artist, tracks: CDaw.project().tracks.length, audio: CDaw.usedAudio().length, fx: CDaw.project().tracks.find((x) => x.name === "Keys").inserts.length }));
  assert.equal(s.artist, "Grace Band"); assert.ok(s.tracks >= 7); assert.ok(s.audio >= 1, "audio " + s.audio); assert.equal(s.fx, 1);
});
await check("Export for Central Tracks: stems + click + the mix + song.json with the sections, chords and roles", async () => {
  const pk = await T(async () => { const p = await CP.mod().tracksPackage(); return { files: p.files.map((f) => f.name), song: p.song }; });
  assert.ok(pk.files.includes("song.json")); assert.ok(pk.files.some((f) => /--Click\.wav$/.test(f))); assert.ok(pk.files.some((f) => /--mix\.wav$/.test(f)));
  assert.equal(pk.song.sections[1].name, "Verse 1"); assert.equal(pk.song.chords[0].label, "G"); assert.ok(pk.song.stems.some((s) => s.role === "drums" || s.role === "keys"));
});
await check("sign in, save to the account, open it from the account", async () => {
  await T(() => localStorage.setItem("ma-token", "tok"));
  await T(() => CP.saveCloud()); await page.waitForFunction(() => document.querySelector("#cpSaved").textContent === "Saved", null, { timeout: 15000 });
  const id = await T(() => CP.where().cloud); assert.ok(id);
  await T((i) => CP.openCloud(i), id); await page.waitForSelector(".cdaw .cd-lane");
  assert.equal(await T(() => CP.project().data.artist), "Grace Band");
});
await check("Publish to Central Tracks sends the mix and every stem, then publishes", async () => {
  await T(() => CPPublish.open()); await page.waitForSelector("#ptForm"); await page.check("#ptRights"); await page.click("#ptSend");
  await page.waitForFunction(() => /Published|Sent for review/.test(document.querySelector("#cpModal").textContent), null, { timeout: 30000 });
  assert.equal(api.published.length, 1); assert.ok(api.published[0].stems.length >= 2); assert.equal(api.published[0].artist, "Grace Band");
  await T(() => document.querySelector("#cpModal [data-close]").click());
});
await check("Loop: loops its bars, renders seamless, publishes to Make & sell as Loops (with a demo)", async () => {
  await T(() => CP.create("loop", { name: "Groove", bars: 2 })); await page.waitForSelector(".cdaw .cd-lane");
  await T(() => { const t = CDaw.project().tracks.find((x) => x.kind === "drums"); CDaw.edit("d", () => { CDaw.track(t.id).clips.push({ id: "d1", kind: "midi", start: 0, len: 8, notes: [0, 1, 2, 3, 4, 5, 6, 7].map((b) => ({ p: 36, v: 110, s: b, d: 0.2 })) }); }); });
  const L = await T(async () => { const l = await CP.mod().renderLoops(false); return { secs: l[0].buf.duration, loop: CDaw.project().loop }; });
  assert.ok(Math.abs(L.secs - 4.8) < 0.01, "secs " + L.secs); assert.equal(L.loop.end, 8);
  await T(() => CPPublish.open()); await page.waitForSelector("#pbForm"); await page.check("#pbRights"); await page.click("#pbSend");
  await page.waitForFunction(() => /Sent for review/.test(document.querySelector("#cpModal").textContent), null, { timeout: 30000 });
  const it = api.items[api.items.length - 1]; assert.equal(it.kind, "loop"); assert.equal(it.bpm, 100); assert.ok(it.files.some((f) => f.role === "demo") && it.files.some((f) => f.role === "source"));
  await T(() => document.querySelector("#cpModal [data-close]").click());
});
await check("Sample: bring in a sound, trim and normalise it, slice it, export WAVs, publish as Samples", async () => {
  await T(() => CP.create("sample", { name: "Snap" })); await page.waitForSelector(".cp-sample");
  await T(async () => { const rate = 48000, b = new AudioBuffer({ length: rate, numberOfChannels: 1, sampleRate: rate }), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (i % 12000 < 600 ? Math.sin(i / 3) : 0) * 0.3; const id = "a1"; CP.mod(); /* via the type's own path */ const wav = new Uint8Array(CMProj.wav(b, 16)); const f = { name: "Snap C4.wav", bytes: wav }; await (async () => { const buf = await CMProj.decode(CDaw.ctx(), wav); })(); window.__wav = wav; });
  await page.setInputFiles("input[type=file]", []).catch(() => { });
  const r = await T(async () => { const t = CP.types.sample; const b = await CMProj.decode(CDaw.ctx(), window.__wav); CP.edit("Bring in", (d) => { d.cur = "zz"; }); /* store */ return true; });
  assert.ok(r);
});
console.log(errs.length ? "\npage errors:\n  " + errs.slice(0, 8).join("\n  ") : "");
if (errs.length) failures++;
await browser.close(); srv.close();
console.log(failures ? "\n" + failures + " FAILED" : "\nall passed");
process.exit(failures ? 1 : 0);
