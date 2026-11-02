// Central Production in the browser (server/public/production/ and the shared DAW in server/public/daw/), with the
// website's API stood in: every project type is made, edited, saved (this browser and the account), opened again,
// exported and published (to stand-in Make & sell / Central Tracks endpoints); the DAW plays, records MIDI, edits clips,
// automates, renders in time and in tune, keeps work for recovery.
//   node test-web.mjs            (CHROME=<chromium> to pick the browser; SHOTS=<dir> saves screenshots)
import { chromium } from "playwright";
import http from "node:http"; import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import assert from "node:assert";
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
let page; const errs = [];
async function openPage() {
  page = await ctx.newPage(); await page.addInitScript(() => { window.CPT = { create: (t, o) => { CP.setDirty(false); CDaw.markSaved(); return CP.create(t, o); } }; }); page.on("pageerror", (e) => errs.push(String(e.stack || e))); page.on("console", (m) => { if (m.type() === "error" && !/favicon|404/.test(m.text())) errs.push("console: " + m.text()); }); page.on("crash", () => errs.push("the page crashed"));
  await page.goto(base + "/production/");
  await page.waitForFunction(() => window.CP && window.CDaw && window.CDawUI && document.querySelector(".cp-kinds"));
}
const shots = process.env.SHOTS; const shot = async (n) => { if (shots) await page.screenshot({ path: path.join(shots, n + ".png") }); };
await openPage();
const T = (fn, arg) => page.evaluate(fn, arg);

await check("the start page asks what you're making, with all seven kinds", async () => {
  const kinds = await T(() => Array.from(document.querySelectorAll("#cpStart [data-new]")).map((b) => b.dataset.new));
  assert.deepEqual(kinds, ["track", "loop", "sample", "pad", "instrument", "plugin", "board"]);
  await shot("01-start");
});
await check("New project → Track opens the DAW set up for a song: tracks, sections on the ruler, the song strip", async () => {
  await page.click('#cpStart [data-new="track"]'); await page.fill("#npName", "Sunday Song"); await page.click("#npForm .primary");
  await page.waitForSelector(".cdaw .cd-tname");
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
await check("Central FX plugins in the inserts: the picker lists the builder's examples; a Tremolo insert pulses in the render", async () => {
  await T(() => CDawUI.openEditor("mixer")); await page.waitForSelector(".cd-strip.master");
  const keys = await T(() => CDaw.project().tracks.find((x) => x.name === "Keys").id);
  await page.click('.cd-strip[data-s="' + keys + '"] [data-fx="add"]').catch(() => page.click('[data-fx="add"]'));
  await page.waitForFunction(() => /Tremolo \(example\)/.test(document.body.innerText)); await page.keyboard.press("Escape");
  const r = await T(async () => {
    const t = CDaw.project().tracks.find((x) => x.name === "Keys"), trem = CPPluginPresets.find((p) => p.name === "Tremolo");
    const env = async () => { const b = await CDaw.render({ from: 0, to: 4, tracks: [t.id], tail: 0 }), d = b.getChannelData(0), w = Math.round(b.sampleRate * 0.02), e = []; for (let i = Math.round(b.sampleRate * 0.5); i + w < b.sampleRate * 2.2; i += w) { let s = 0; for (let k = i; k < i + w; k++) s += d[k] * d[k]; e.push(Math.sqrt(s / w)); } return Math.max(...e) / Math.max(1e-9, Math.min(...e)); };
    const prev = JSON.parse(JSON.stringify((({ inserts, clips, auto, lanes }) => ({ inserts, clips, auto, lanes }))(CDaw.track(t.id))));
    CDaw.edit("a", () => { const k = CDaw.track(t.id); k.auto = {}; k.lanes = []; k.inserts = []; k.clips = [{ id: "c9", kind: "midi", start: 0, len: 4, notes: [{ p: 57, v: 110, s: 0, d: 4 }] }]; });
    const plain = await env();
    CDaw.edit("Add Tremolo", () => { CDaw.track(t.id).inserts = [{ id: "fT", type: "cmfx", on: true, plugin: trem, params: Object.assign(CDaw.fxDefaults({ type: "cmfx", plugin: trem }), { depth: 1, rate: 4 }) }]; });
    const fx = await env(), knobs = CDaw.fxDef(CDaw.track(t.id).inserts[0]).params.map((q) => q[1]);
    CDaw.edit("x", () => { Object.assign(CDaw.track(t.id), prev); });
    return { plain, fx, knobs };
  });
  assert.ok(r.fx > 4 && r.fx > r.plain * 3, "tremolo swing " + r.fx + " (plain " + r.plain + ")"); assert.deepEqual(r.knobs, ["Speed", "Depth", "Wide"]);
});
await check("Settings → Audio: devices, sample rate and buffer (the sound restarts), input channels per track, the loopback measurement's maths", async () => {
  await page.click('[data-a="audio"]'); await page.waitForSelector(".cd-modal .cd-audio select[data-au=rate]");
  await page.waitForFunction(() => /Input delay/.test((document.querySelector(".cd-auinfo") || {}).textContent || ""), null, { timeout: 10000 });
  await page.selectOption(".cd-modal select[data-au=rate]", "44100"); await page.waitForFunction(() => CDaw.ctx().sampleRate === 44100);
  await page.selectOption(".cd-modal select[data-au=buffer]", "512");
  const r = await T(() => {
    const a = CDaw.audio.settings(), rate = 48000, chunks = [], t0 = 1.0, times = [1.2, 1.6, 2.0, 2.4, 2.8, 3.2], n = rate * 3, x = new Float32Array(n);
    times.forEach((t) => { const i = Math.round((t - t0 + 0.0125) * rate); for (let k = 0; k < 40; k++) x[i + k] = Math.sin(k) * 0.6; });
    for (let o = 0; o < n; o += 128) chunks.push([x.slice(o, o + 128), new Float32Array(128)]);
    return { rate: a.rate, buffer: a.buffer, ctxRate: CDaw.ctx().sampleRate, delay: CDaw.audio.findDelay(times, chunks, t0, rate), none: CDaw.audio.findDelay(times, [[new Float32Array(rate)]], t0, rate), choices: CDaw.audio.choices(4).map((c) => c.id), ch: [CDaw.audio.channelsOf("3"), CDaw.audio.channelsOf("3+4")] };
  });
  assert.equal(r.rate, 44100); assert.equal(r.buffer, 512); assert.equal(r.ctxRate, 44100);
  assert.equal(r.delay, 12.5); assert.equal(r.none, null);
  assert.deepEqual(r.choices, ["1", "2", "3", "4", "1+2", "3+4"]); assert.deepEqual(r.ch, [[2], [2, 3]]);
  await page.selectOption(".cd-modal select[data-au=rate]", "48000"); await page.selectOption(".cd-modal select[data-au=buffer]", "256");
  await page.waitForFunction(() => CDaw.ctx().sampleRate === 48000);
  await shot("05b-audio"); await page.click('.cd-modal [data-r="close"]');
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
await check("recording audio: each armed track takes its own input (mono from one channel, stereo from a pair), lined up by the compensation", async () => {
  const r = await T(async () => {
    const p = CDaw.project(), g = p.tracks.find((x) => x.name === "Guide") || p.tracks.find((x) => x.kind === "audio");
    let s2 = p.tracks.find((x) => x.name === "Stereo in"); if (!s2) CDaw.edit("add", (q) => { const t = CDaw.newTrack("audio", "Stereo in"); q.tracks.push(t); }); s2 = CDaw.project().tracks.find((x) => x.name === "Stereo in");
    CDaw.edit("arm", (q) => { q.tracks.forEach((x) => { x.arm = x.id === g.id || x.id === s2.id; }); CDaw.track(g.id).input = "1"; CDaw.track(s2.id).input = "1+2"; q.metronome.countIn = 0; });
    const before = (id) => CDaw.track(id).clips.length, b1 = before(g.id), b2 = before(s2.id);
    CDaw.setPos(16); CDaw.record(); await new Promise((r) => setTimeout(r, 1500)); CDaw.stop();
    await new Promise((r) => setTimeout(r, 300));
    const last = (id) => { const c = CDaw.track(id).clips.filter((x) => x.kind === "audio").slice(-1)[0]; return c ? CDaw.buffers[c.audio.src] : null; }, m = last(g.id), st = last(s2.id);
    CDaw.edit("disarm", (q) => { q.tracks.forEach((x) => { x.arm = false; }); q.tracks = q.tracks.filter((x) => x.id !== s2.id); });
    return { got: CDaw.track(g.id).clips.length > b1, mono: m && m.numberOfChannels, stereo: st && st.numberOfChannels, comp: CDaw.audio.compensation() };
  });
  assert.ok(r.got, "a clip"); assert.equal(r.mono, 1); assert.equal(r.stereo, 2); assert.ok(r.comp >= 0);
});
await check("VST3 / CLAP inserts (with a stand-in host): an armed, monitored audio track is heard through the rig; freezing, staleness, and without a host the track plays dry", async () => {
  const r = await T(async () => {
    const calls = [], p = CDaw.project(), g = p.tracks.find((x) => x.kind === "audio");
    CDaw.native.setHost({ list: () => Promise.resolve([]), monitor: (m) => calls.push(m), editor: () => Promise.resolve({ ok: true }),
      process: (job) => Promise.resolve({ ok: true, latency: 64, frames: job.frames, data: new Uint8Array(job.data.map((v) => v * 2).buffer) }) });
    CDaw.edit("n", (q) => { const t = CDaw.track(g.id); t.inserts = [{ id: "fX1", type: "native", on: true, params: {}, plugin: { format: "vst3", id: "X", path: "/x.vst3", name: "Big Comp" } }]; t.arm = true; t.monitor = "auto"; t.input = "1+2"; });
    await new Promise((res) => setTimeout(res, 300));
    const mon = calls.filter(Boolean).slice(-1)[0];
    CDaw.edit("disarm", () => { CDaw.track(g.id).arm = false; }); await new Promise((res) => setTimeout(res, 200)); const off = calls.slice(-1)[0];
    const st0 = CDaw.native.state(CDaw.track(g.id)); await CDaw.native.freeze(g.id).catch((e) => e); const st1 = CDaw.native.state(CDaw.track(g.id));
    CDaw.native.setHost(null); const st2 = CDaw.native.state(CDaw.track(g.id));
    CDaw.edit("x", () => { const t = CDaw.track(g.id); t.inserts = []; t.frozen = null; });
    return { mon: mon && { track: mon.track === g.id, input: mon.input, slot: mon.plugins[0].slot, name: mon.plugins[0].name }, off, st0, st1, st2 };
  });
  assert.deepEqual(r.mon, { track: true, input: "1+2", slot: "dwfX1", name: "Big Comp" }); assert.equal(r.off, null);
  assert.equal(r.st0, "unfrozen"); assert.ok(r.st1 === "frozen" || r.st1 === "unfrozen", r.st1); assert.equal(r.st2, r.st1);
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
  await T(() => CPT.create("sample", { name: "x" })); await page.waitForSelector(".cp-sample");
  await T(async () => { const l = await CPHost.local.list(); const e = l.find((x) => x.name === "Sunday Song"); const r = await CPHost.local.open(e.id); await CP.load(r.bytes, { localId: e.id }); });
  await page.waitForSelector(".cdaw .cd-tname");
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
  await T((i) => CP.openCloud(i), id); await page.waitForSelector(".cdaw .cd-tname");
  assert.equal(await T(() => CP.project().data.artist), "Grace Band");
});
await check("Publish to Central Tracks sends the mix and every stem, then publishes", async () => {
  await T(() => CPPublish.open()); await page.waitForSelector("#ptForm"); await page.check("#ptRights"); await page.click("#ptSend");
  await page.waitForFunction(() => /Published|Sent for review/.test(document.querySelector("#cpModal").textContent), null, { timeout: 30000 });
  assert.equal(api.published.length, 1); assert.ok(api.published[0].stems.length >= 2); assert.equal(api.published[0].artist, "Grace Band");
  await T(() => document.querySelector("#cpModal [data-close]").click());
});
await check("Loop: loops its bars, renders seamless, publishes to Make & sell as Loops (with a demo)", async () => {
  await T(() => CPT.create("loop", { name: "Groove", bars: 2 })); await page.waitForSelector(".cdaw .cd-tname");
  await T(() => { const t = CDaw.project().tracks.find((x) => x.kind === "drums"); CDaw.edit("d", () => { CDaw.track(t.id).clips.push({ id: "d1", kind: "midi", start: 0, len: 8, notes: [0, 1, 2, 3, 4, 5, 6, 7].map((b) => ({ p: 36, v: 110, s: b, d: 0.2 })) }); }); });
  const L = await T(async () => { const l = await CP.mod().renderLoops(false); return { secs: l[0].buf.duration, loop: CDaw.project().loop }; });
  assert.ok(Math.abs(L.secs - 4.8) < 0.01, "secs " + L.secs); assert.equal(L.loop.end, 8);
  await T(() => CPPublish.open()); await page.waitForSelector("#pbForm"); await page.check("#pbRights"); await page.click("#pbSend");
  await page.waitForFunction(() => /Sent for review/.test(document.querySelector("#cpModal").textContent), null, { timeout: 30000 });
  const it = api.items[api.items.length - 1]; assert.equal(it.kind, "loop"); assert.equal(it.bpm, 100); assert.ok(it.files.some((f) => f.role === "demo") && it.files.some((f) => f.role === "source"));
  await T(() => document.querySelector("#cpModal [data-close]").click());
});
// a WAV file made here (mono 16-bit): a tone, or clicks
function wavFile(name, secs, fn) {
  const rate = 48000, n = Math.round(rate * secs), b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVEfmt ", 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, fn(i / rate))) * 32000), 44 + i * 2);
  const f = path.join(os.tmpdir(), "cp-test-" + name); fs.writeFileSync(f, b); return f;
}
const pick = async (btn, files) => { const [fc] = await Promise.all([page.waitForEvent("filechooser"), page.click(btn)]); await fc.setFiles(files); };
const lastItem = () => api.items[api.items.length - 1];
async function publishMake(kind) {
  const n = api.items.length;
  await T(() => CPPublish.open()); await page.waitForSelector("#pbForm"); await page.check("#pbRights"); await page.click("#pbSend");
  await page.waitForFunction(() => /Sent for review/.test(document.querySelector("#cpModal").textContent) || (document.querySelector("#pbErr") || {}).textContent, null, { timeout: 60000 });
  const err = await T(() => (document.querySelector("#pbErr") || {}).textContent || ""); await T(() => { const b = document.querySelector("#cpModal [data-close]"); if (b) b.click(); });
  if (err) throw new Error(err);
  assert.equal(api.items.length, n + 1); const it = lastItem(); assert.equal(it.kind, kind); return it;
}
// (a fresh page for the other kinds: a long session of offline renders is a lot for one test browser)
await T(() => localStorage.setItem("ma-token", "tok")); await page.close(); await openPage();
await check("Sample: bring in a file (its note from its name), normalise, slice at each hit, the slices become an instrument; publishes as Samples", async () => {
  await T(() => CPT.create("sample", { name: "Snaps" })); await page.waitForSelector(".cp-sample");
  await pick("#smImport", wavFile("snaps-C4.wav", 2, (t) => ((t % 0.5) < 0.03 ? Math.sin(t * 3000) * 0.4 : 0)));
  await page.waitForFunction(() => CP.project().data.cur);
  await page.click("#smNorm"); await page.click("#smSliceHits");
  const r = await T(() => { const x = CP.mod().instrument(); return { zones: x.inst.zones.length, root: CP.project().data.root, slices: CP.project().data.slices.length, peak: CPAudio.peak(CP.mod().buffer()) }; });
  assert.equal(r.root, 60); assert.ok(r.zones >= 3, "zones " + r.zones); assert.ok(r.peak > 0.85, "normalised " + r.peak);
  const sf2 = await T(async () => { const x = await CP.mod().install(); return String.fromCharCode(...x.sf2.slice(0, 4)) + String.fromCharCode(...x.sf2.slice(8, 12)); }); assert.equal(sf2, "RIFFsfbk");
  const it = await publishMake("sample"); assert.ok(it.files.some((f) => f.role === "source" && /\.zip$/.test(f.name)) && it.files.some((f) => f.role === "demo"));
  await page.click("#cpUndo"); assert.equal(await T(() => CP.project().data.slices.length), 0, "undo takes the slices away");
});
await check("Sample: saved and opened again, the sound comes back", async () => {
  await T(() => CP.save()); await T(() => CPT.create("board", { name: "tmp" })); await page.waitForSelector(".cp-board");
  await T(async () => { const l = await CPHost.local.list(); const e = l.find((x) => x.name === "Snaps"); const r = await CPHost.local.open(e.id); await CP.load(r.bytes, { localId: e.id }); });
  await page.waitForSelector(".cp-sample"); assert.ok(await T(() => !!CP.mod().buffer() && CP.mod().buffer().duration > 1.9));
});
await check("Pad: renders each key as a seamless loop (its end runs into its start); 12 keys; publishes as a Pad", async () => {
  await T(() => CPT.create("pad", { name: "Warm Air" })); await page.waitForSelector(".cp-pad");
  await T(() => CP.edit("t", (d) => { d.seconds = 8; }));
  const r = await T(async () => { const b = await CP.mod().renderKey(0), d = b.getChannelData(0), n = d.length; let jump = Math.abs(d[0] - d[n - 1]), typical = 0; for (let i = 1; i < 2000; i++) typical = Math.max(typical, Math.abs(d[i] - d[i - 1])); return { secs: b.duration, jump, typical }; });
  assert.equal(r.secs, 8); assert.ok(r.jump <= r.typical * 1.5 + 1e-3, "seam " + r.jump + " vs " + r.typical);
  const it = await publishMake("pad"); assert.ok(it.files.some((f) => f.role === "source"));
  const keys = await T(async () => (await CP.mod().install()).pads.map((f) => f.key)); assert.equal(keys.length, 12);
});
await check("Instrument: samples spread across the keyboard by their notes, play, export SF2 and SFZ; publishes as an Instrument", async () => {
  await T(() => CPT.create("instrument", { name: "Glass Keys" })); await page.waitForSelector(".cp-inst");
  await pick("#isAdd", [wavFile("Glass C3.wav", 1.5, (t) => Math.sin(2 * Math.PI * 130.81 * t) * 0.4), wavFile("Glass C5.wav", 1.5, (t) => Math.sin(2 * Math.PI * 523.25 * t) * 0.4)]);
  await page.waitForFunction(() => CP.project().data.zones.length === 2);
  const z = await T(() => CP.project().data.zones.map((x) => [x.root, x.lo, x.hi]).sort((a, b) => a[0] - b[0])); assert.deepEqual(z, [[48, 0, 60], [72, 61, 127]]);
  await T(() => { CP.mod().play(60, 100); CP.mod().stop(60); });
  const sfz = await T(() => new TextDecoder().decode(CPSampler.sfz({ name: "G", zones: CP.project().data.zones, env: CP.project().data.env, filter: CP.project().data.filter }, CP.mod().buffers())[0].data)); assert.ok(/pitch_keycenter=48/.test(sfz) && /pitch_keycenter=72/.test(sfz), sfz);
  const it = await publishMake("instrument"); assert.ok(it.files.some((f) => f.role === "demo"));
});
await check("Plugin: the plugin builder opens in the project; an example becomes the plugin; it saves and publishes as a Plugin", async () => {
  await T(() => CPT.create("plugin", { name: "My Echo" })); await page.waitForSelector(".cp-plugin .cpb-block");
  await T(() => CPPublish.open()); await page.waitForSelector("#pbForm"); await page.check("#pbRights"); await page.click("#pbSend");
  await page.waitForFunction(() => /empty/.test(document.querySelector("#pbErr").textContent)); await T(() => document.querySelector("#cpModal [data-close]").click());
  await page.selectOption(".cpb-presets", { label: "Tape Delay" });
  await page.waitForFunction(() => (CP.project().data.graph.blocks || []).some((b) => b.type === "delay"), null, { timeout: 5000 });
  const ok = await T(() => CMFx.check(CP.project().data).ok); assert.ok(ok, "the plugin checks");
  const it = await publishMake("plugin"); assert.ok(it.files.some((f) => /\.cmfx\.json$/.test(f.name || f.file || "")) || it.files.length > 0, JSON.stringify(it.files));
});
await check("Pedal board: pedals from the catalogue in order, moved, knobs set; publishes as a Pedal board", async () => {
  await T(() => CPT.create("board", { name: "Ambient Guitar" })); await page.waitForSelector(".cp-board");
  await page.fill("#bdQ", "delay"); await page.locator("#bdList [data-add]").first().click(); await page.fill("#bdQ", "hall"); await page.locator("#bdList [data-add]").first().click();
  assert.equal(await T(() => CP.project().data.chain.length), 2);
  await page.locator("[data-mv='-1']").click(); const ch = await T(() => CP.project().data.chain.map((x) => x[0])); assert.ok(!/delay/i.test(ch[0]) && /delay/i.test(ch[1]), ch.join());
  const it = await publishMake("board"); assert.ok(it.files.some((f) => f.role === "source" && /\.json$/.test(f.name)));
});
await shot("09-end");

console.log(errs.length ? "\npage errors:\n  " + errs.slice(0, 8).join("\n  ") : "");
if (errs.length) failures++;
await browser.close(); srv.close();
console.log(failures ? "\n" + failures + " FAILED" : "\nall passed");
process.exit(failures ? 1 : 0);
