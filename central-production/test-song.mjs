// Central Production 10.6 - the whole-song tools, in the browser (server/public/daw/daw-song.js, daw-control.js and the
// Track project's strip): rearranging sections with their music, the key and tempo of the whole song, click and guide
// tracks, the Central Pedal pack (read back by the pedal's own scanner, sources.py), loudness and the Central Tracks
// grade, and MIDI / foot controls.
//   node test-song.mjs            (CHROME=<chromium> to pick the browser; SHOTS=<dir> saves screenshots)
import { chromium } from "playwright";
import http from "node:http"; import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import assert from "node:assert";
import { execFileSync } from "node:child_process"; import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.join(here, ".."), pub = path.join(root, "server", "public");
let failures = 0; async function check(label, fn) { try { await fn(); console.log("  ✓ " + label); } catch (e) { failures++; console.error("  ✗ " + label + "\n      " + String(e && e.stack || e).split("\n").slice(0, 6).join("\n      ")); } }
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".json": "application/json", ".wav": "audio/wav" };
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x"), send = (code, body, type) => { res.writeHead(code, { "Content-Type": type || "application/json" }); res.end(body); };
  if (u.pathname.startsWith("/v1/")) return send(u.pathname === "/v1/me" ? 401 : 404, "{}");
  let f = path.join(pub, decodeURIComponent(u.pathname)); if (f.endsWith("/")) f += "index.html";
  if (!f.startsWith(pub) || !fs.existsSync(f)) return send(404, "not here", "text/plain");
  send(200, fs.readFileSync(f), TYPES[path.extname(f)] || "application/octet-stream");
});
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
const base = "http://127.0.0.1:" + srv.address().port;
const exe = [process.env.CHROME, "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome"].filter((p) => p && fs.existsSync(p))[0];
const browser = await chromium.launch(Object.assign({ args: ["--autoplay-policy=no-user-gesture-required"] }, exe ? { executablePath: exe } : {}));
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
const errs = [], page = await ctx.newPage();
await page.addInitScript(() => { window.CPT = { create: (t, o) => { CP.setDirty(false); CDaw.markSaved(); return CP.create(t, o); } }; });
page.on("pageerror", (e) => errs.push(String(e.stack || e))); page.on("console", (m) => { if (m.type() === "error" && !/favicon|404|401/.test(m.text())) errs.push("console: " + m.text()); });
await page.goto(base + "/production/");
await page.waitForFunction(() => window.CP && window.CDaw && window.CDawUI && document.querySelector(".cp-kinds"));
const shots = process.env.SHOTS; const shot = async (n) => { if (shots) await page.screenshot({ path: path.join(shots, n + ".png") }); };
const T = (fn, arg) => page.evaluate(fn, arg);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cp-song-"));

// a song: Intro (bars 1-4), Verse 1 (5-12), Chorus (13-16) at 100 BPM in C. Keys play one note a bar (60 + the bar, so
// every bar can be told apart); drums a kick each bar; "Vocals" is audio: a 60 ms 1 kHz beep on every beat.
await T(() => CPT.create("track", { name: "Song Tools" })); await page.waitForSelector(".cdaw .cd-tname");
await T(() => {
  const P = CDaw.project(), keys = P.tracks.find((t) => t.name === "Keys"), drums = P.tracks.find((t) => t.kind === "drums"), voc = P.tracks.find((t) => t.name === "Vocals");
  const rate = 48000, secs = 64 * 0.6 + 0.5, b = new AudioBuffer({ numberOfChannels: 2, length: Math.round(secs * rate), sampleRate: rate });
  for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let k = 0; k < 64; k++) { const at = Math.round(k * 0.6 * rate); for (let i = 0; i < 0.06 * rate; i++) d[at + i] = 0.5 * Math.sin(2 * Math.PI * 1000 * i / rate) * Math.min(1, i / 48, (0.06 * rate - i) / 48); } }
  const src = CDaw.addAudio(b);
  CDaw.edit("song", (q) => {
    q.bpm = 100; q.key = "C"; q.tempos = []; q.sigs = [];
    CDaw.track(keys.id).clips = [{ id: "k1", kind: "midi", start: 0, len: 64, name: "Keys", notes: Array.from({ length: 16 }, (_, k) => ({ p: 60 + k, v: 100, s: k * 4, d: 1 })) }];
    CDaw.track(drums.id).clips = [{ id: "d1", kind: "midi", start: 0, len: 64, name: "Drums", notes: Array.from({ length: 16 }, (_, k) => ({ p: 36, v: 110, s: k * 4, d: 0.25 })) }];
    CDaw.track(voc.id).clips = [{ id: "v1", kind: "audio", start: 0, len: 64, name: "Beeps", audio: { src, offset: 0, gain: 0, fadeIn: 0, fadeOut: 0 } }];
    q.markers = [{ id: "mI", beat: 0, name: "Intro" }, { id: "mV", beat: 16, name: "Verse 1" }, { id: "mC", beat: 48, name: "Chorus" }];
  });
});
// where each beep starts (ms), in a render made with tail: 0 (no 20 ms lead)
const ONSETS = "function onsets(d){const out=[];let armed=true;for(let i=0;i<d.length;i+=48){let e=0;for(let k=i;k<i+48;k++)e=Math.max(e,Math.abs(d[k]||0));if(armed&&e>0.1){out.push(Math.round(i/48));armed=false;}else if(e<0.02)armed=true;}return out;}";
const notesAt = () => T(() => { const k = CDaw.project().tracks.find((t) => t.name === "Keys"), out = {}; k.clips.forEach((c) => c.notes.forEach((n) => { out[c.start + n.s] = n.p; })); return out; });

await check("the scripts load and the toolbar has Key & tempo, Controls and the loudness readout", async () => {
  const s = await T(() => ({ song: !!window.CDawSong, ctl: !!window.CDawControl, kt: !!document.querySelector('.cd-top [data-a="keytempo"]'), c: !!document.querySelector('.cd-top [data-a="controls"]'), l: !!document.querySelector(".cd-top .cd-lufs") }));
  assert.deepEqual(s, { song: true, ctl: true, kt: true, c: true, l: true });
});
await check("sections: Duplicate takes the music with it (the second chorus plays the chorus's notes)", async () => {
  const r = await T(() => { const id = CDawSong.sections().find((s) => s.name === "Chorus").id; CDawSong.duplicate(id); return { names: CDawSong.sections().map((s) => s.name + "@" + s.beat), end: CDaw.songEnd() }; });
  assert.deepEqual(r.names, ["Intro@0", "Verse 1@16", "Chorus@48", "Chorus@64"]); assert.equal(r.end, 80);
  const n = await notesAt(); assert.equal(n[64], 72); assert.equal(n[76], 75); assert.equal(n[48], 72);
});
await check("sections: Move earlier puts the verse first, its notes and its audio (from 9.6 s in the file) with it", async () => {
  await T(() => CDawSong.move("mV", -1));
  const r = await T(() => ({ names: CDawSong.sections().map((s) => s.name + "@" + s.beat), voc: CDaw.project().tracks.find((t) => t.name === "Vocals").clips.map((c) => [c.start, Math.round(c.audio.offset * 1000) / 1000]).sort((a, b) => a[0] - b[0]) }));
  assert.deepEqual(r.names, ["Verse 1@0", "Intro@32", "Chorus@48", "Chorus@64"]);
  const n = await notesAt(); assert.equal(n[0], 64); assert.equal(n[32], 60); assert.equal(n[48], 72);
  assert.deepEqual(r.voc[0], [0, 9.6]); assert.deepEqual(r.voc[1], [32, 0]);
  // it still plays in time: the beeps land on the beats after the move
  const on = await T(async (O) => { const onsets = eval("(" + O + ")"); const t = CDaw.project().tracks.find((x) => x.name === "Vocals"); const b = await CDaw.render({ from: 28, to: 36, tracks: [t.id], tail: 0 }); return onsets(b.getChannelData(0)); }, ONSETS);
  assert.equal(on.length, 8, "beeps " + on); on.forEach((ms, i) => assert.ok(Math.abs(ms - i * 600) < 6, "beep " + i + " at " + ms + " ms"));
});
await check("sections: Delete closes the gap; undo brings it all back; a song with tempo changes is left alone", async () => {
  await T(() => { CDaw.undo(); CDaw.undo(); });
  assert.deepEqual(await T(() => CDawSong.sections().map((s) => s.name + "@" + s.beat)), ["Intro@0", "Verse 1@16", "Chorus@48"]);
  await T(() => CDawSong.remove("mI"));
  const n = await notesAt(); assert.equal(n[0], 64); assert.equal(await T(() => CDaw.songEnd()), 48);
  await T(() => CDaw.undo());
  const err = await T(() => { CDaw.edit("t", (p) => { p.tempos = [{ bar: 2, bpm: 120 }]; }); let m = ""; try { CDawSong.move("mC", -1); } catch (e) { m = e.message; } CDaw.undo(); return m; });
  assert.match(err, /one tempo/);
});
await check("the ruler's section menu has Duplicate / Move / Delete with the music", async () => {
  const items = await T(() => CDawSong.sectionMenu("mV").map((x) => x[0]));
  assert.deepEqual(items, ["Duplicate it with its music", "Move it earlier", "Move it later", "Delete it with its music"]);
});
await check("Key & tempo: C at 100 → D at 120. Keys move up 2, drums stay, the audio is re-pitched and lands on the new beats", async () => {
  const r = await T(() => CDawSong.changeKeyTempo("D", 120));
  assert.equal(r.semis, 2); assert.equal(r.clips, 1);
  const s = await T(() => { const P = CDaw.project(); return { bpm: P.bpm, key: P.key, drums: P.tracks.find((t) => t.kind === "drums").clips[0].notes[0].p, warp: !!P.tracks.find((t) => t.name === "Vocals").clips[0].audio.warp }; });
  assert.deepEqual(s, { bpm: 120, key: "D", drums: 36, warp: true });
  const n = await notesAt(); assert.equal(n[0], 62); assert.equal(n[16], 66);
  const a = await T(async (O) => {
    const onsets = eval("(" + O + ")"), t = CDaw.project().tracks.find((x) => x.name === "Vocals"), b = await CDaw.render({ from: 0, to: 8, tracks: [t.id], tail: 0 }), d = b.getChannelData(0);
    // the pitch in the middle of the second beep: zero crossings over 20 ms
    const s0 = Math.round((0.5 + 0.02) * 48000); let zc = 0; for (let i = s0; i < s0 + 960; i++) if ((d[i] >= 0) !== (d[i + 1] >= 0)) zc++;
    return { on: onsets(d), hz: zc / 2 / 0.02 };
  }, ONSETS);
  assert.ok(a.on.length >= 8, "beeps " + a.on); a.on.slice(0, 8).forEach((ms, i) => assert.ok(Math.abs(ms - i * 500) < 25, "beep " + i + " at " + ms + " ms (want " + i * 500 + ")"));
  assert.ok(Math.abs(a.hz - 1122) < 60, "re-pitched to about 1122 Hz: " + a.hz);
});
await check("Key & tempo from the toolbar: the box changes it back (to C at 100), one undo", async () => {
  await page.click('.cd-top [data-a="keytempo"]'); await page.waitForSelector("#cdkt-key");
  await page.selectOption("#cdkt-key", "C"); await page.fill("#cdkt-bpm", "100");
  assert.match(await page.textContent("#cdkt-note"), /Down 2 semitones · 17% slower/);
  await shot("s1-keytempo");
  await page.click('.cd-modal [data-m="ok"]');
  const s = await T(() => ({ key: CDaw.project().key, bpm: CDaw.project().bpm, undo: CDaw.canUndo() }));
  assert.deepEqual(s, { key: "C", bpm: 100, undo: "Key and tempo" });
  const n = await notesAt(); assert.equal(n[0], 60);
});
await check("Click & guide: their own tracks, the spoken cue a bar before each section", async () => {
  const r = await T(() => CDawSong.makeClickAndGuide());
  assert.ok(r.cues >= 2, "cues " + r.cues);
  const g = await T(async () => {
    const P = CDaw.project(), cl = P.tracks.find((t) => t.name === "Click" && t.made), gd = P.tracks.find((t) => t.name === "Guide (cues)" && t.made);
    const b = await CDaw.render({ from: 0, to: 64, tracks: [gd.id], tail: 0 }), d = b.getChannelData(0);
    function loud(s0, s1) { let e = 0; for (let i = Math.round((0.02 + s0) * 48000); i < Math.round((0.02 + s1) * 48000); i++) e = Math.max(e, Math.abs(d[i] || 0)); return e; }
    return { click: !!cl, guide: !!gd, verseCue: loud(7.2, 8.4), quiet: loud(3, 6.5), chorusCue: loud(26.4, 27.6) };   // Verse 1 at bar 5 (9.6 s): the cue from bar 4 (7.2 s); Chorus at 28.8 s: from 26.4 s
  });
  assert.ok(g.click && g.guide); assert.ok(g.verseCue > 0.05, "the verse cue " + g.verseCue); assert.ok(g.chorusCue > 0.05, "the chorus cue " + g.chorusCue); assert.ok(g.quiet < 0.01, "nothing between: " + g.quiet);
  // made again, not added twice
  await T(() => CDawSong.makeClickAndGuide()); assert.equal(await T(() => CDaw.project().tracks.filter((t) => t.made).length), 2);
});
await check("Markers.mid: the sections and the tempo as MIDI markers", async () => {
  const m = await T(() => Array.from(CDawSong.markersMidi()));
  const b = Buffer.from(m); assert.equal(b.slice(0, 4).toString(), "MThd"); assert.equal(b.readUInt16BE(12), 960);
  const s = b.toString("latin1"); ["Intro", "Verse 1", "Chorus"].forEach((n) => assert.ok(s.includes(n), n));
  assert.ok(b.includes(Buffer.from([0xFF, 0x51, 3, 0x09, 0x27, 0xC0])), "600000 µs a beat (100 BPM)");
});
await check("loudness (BS.1770): a -20 dBFS 1 kHz tone reads -20 LUFS, its true peak -20 dB; the grade marks a quiet, low-rate file down", async () => {
  const r = await T(() => {
    const rate = 48000, b = new AudioBuffer({ numberOfChannels: 2, length: rate * 10, sampleRate: rate }), A = Math.pow(10, -20 / 20);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = A * Math.sin(2 * Math.PI * 1000 * i / rate); }
    const q = new AudioBuffer({ numberOfChannels: 2, length: 22050 * 6, sampleRate: 22050 }); for (let c = 0; c < 2; c++) { const d = q.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = 0.01 * Math.sin(i / 7); }
    return { l: CDawSong.loudness(b), g: CDawSong.grade(b), gq: CDawSong.grade(q) };
  });
  assert.ok(Math.abs(r.l.integrated + 20) < 0.3, "integrated " + r.l.integrated); assert.ok(Math.abs(r.l.truePeak + 20) < 0.2, "true peak " + r.l.truePeak);
  assert.equal(r.g.stars, 5); assert.ok(r.gq.stars <= 3, "the quiet one: " + r.gq.stars); assert.ok(r.gq.checks.some((c) => !c.ok && /kHz/.test(c.text)) && r.gq.checks.some((c) => !c.ok && /quiet/.test(c.text)));
});
await check("Export for Central Pedal: Title - Artist - 100bpm - C.zip, and the pedal's own scanner reads it (title, key, BPM, parts, sections)", async () => {
  await T(() => CP.edit("a", (x) => { x.title = "Grace Song"; x.artist = "Grace Band"; x.chords = { mV: "C | G | Am F" }; }));
  const pk = await T(async () => { const d = CP.project().data, p = await CDawSong.pedalPack({ title: d.title, artist: d.artist, roles: d.roles || {}, chart: "[Verse 1]\n| C | G |" }); let s = ""; const z = p.zip; for (let i = 0; i < z.length; i += 8192) s += String.fromCharCode.apply(null, z.subarray(i, i + 8192)); return { name: p.name, files: p.files.map((f) => f.name), b64: btoa(s), stars: p.grade.stars, lufs: p.loudness.integrated }; });
  assert.equal(pk.name, "Grace Song - Grace Band - 100bpm - C");
  ["Drums.wav", "Keys.wav", "Vocals.wav", "Click.wav", "Guide.wav", "Full Mix.wav", "Markers.mid", "Chart.txt"].forEach((f) => assert.ok(pk.files.includes(f), f + " in " + pk.files));
  const zip = path.join(tmp, pk.name + ".zip"); fs.writeFileSync(zip, Buffer.from(pk.b64, "base64"));
  const out = JSON.parse(execFileSync("python3", ["-c", "import json,sys; sys.path.insert(0, sys.argv[1]); import sources; r = sources.scan_pack(sys.argv[2]); print(json.dumps({'title': r['title'], 'key': r['key'], 'bpm': r['bpm'], 'roles': sorted(e['role'] for e in r['stems'] if e['use']), 'markers': [m.get('name') for m in r['markers']]}))", root, zip]).toString());
  assert.equal(out.title, "Grace Song"); assert.equal(out.key, "C"); assert.equal(out.bpm, 100);
  ["click", "drums", "guide", "keys", "vocals"].forEach((r) => assert.ok(out.roles.includes(r), r + " in " + out.roles));
  assert.deepEqual(out.markers.slice(0, 3), ["Intro", "Verse 1", "Chorus"]);
});
await check("the Track strip: arrangement chips (drag to move), Click & guide, Check the grade; Export for Central Pedal in the export list", async () => {
  await T(() => { document.querySelector("#cpStripT").click(); });
  await page.waitForSelector(".cp-arr-chip");
  assert.deepEqual(await T(() => Array.from(document.querySelectorAll(".cp-arr-chip b")).map((b) => b.textContent)), ["Intro", "Verse 1", "Chorus"]);
  await page.dragAndDrop('.cp-arr-chip[data-sec="mC"]', '.cp-arr-chip[data-sec="mI"]');
  await page.waitForFunction(() => CDawSong.sections()[0].name === "Chorus", null, { timeout: 5000 });
  assert.equal((await notesAt())[0], 72);
  await shot("s2-strip");
  await T(() => { CDaw.undo(); });
  // a duplicated section keeps its chords
  await page.click('.cp-arr-chip[data-sec="mV"] [data-dup]');
  await page.waitForFunction(() => CDawSong.sections().length === 4);
  const ch = await T(() => { const d = CP.project().data, s = CDawSong.sections(); return s.filter((x) => x.name === "Verse 1").map((x) => d.chords[x.id]); });
  assert.deepEqual(ch, ["C | G | Am F", "C | G | Am F"]);
  await T(() => CDaw.undo());
  await page.click("#sgGrade"); await page.waitForSelector("#cpModal .cp-stars", { timeout: 20000 });
  const g = await T(() => ({ stars: document.querySelector("#cpModal .cp-stars").textContent, loud: document.querySelectorAll("#cpModal .cp-loud div").length }));
  assert.equal(g.loud, 4); assert.match(g.stars, /★/);
  await shot("s3-grade");
  await T(() => document.querySelector("#cpModal [data-close]").click());
  const ex = await T(() => CP.mod().exports.map((e) => e[0])); assert.ok(ex.includes("Export for Central Pedal"), ex.join());
  // the web: one zip, named for the pedal
  const dl = page.waitForEvent("download"); T(() => CP.mod().pedalPack()); const d = await dl;
  assert.equal(d.suggestedFilename(), "Grace Song - Grace Band - 100bpm - C.zip");
  await page.waitForSelector("#cpModal .cp-stars", { timeout: 20000 }); await T(() => document.querySelector("#cpModal [data-close]").click());
});
await check("MIDI and foot controls: learn a footswitch (CC 64) for Next section and a pad for Play; they run the DAW and don't play notes", async () => {
  await T(() => { CDawControl.clearAll(); CDaw.stop({ home: true }); CDaw.setPos(0); });
  await page.click('.cd-top [data-a="controls"]'); await page.waitForSelector(".cd-ctls [data-learn]");
  assert.deepEqual(await T(() => [document.querySelectorAll(".cd-ctls .cd-ctl").length, CDawControl.ACTIONS.length]).then((x) => x[0] === x[1] && x[0] >= 12), true);
  await page.click('.cd-ctls [data-learn="next"]');
  assert.match(await page.textContent('.cd-ctls [data-b="next"]'), /Waiting/);
  await T(() => { CUMidiIn.inject("FS-6 Footswitch", [0xB0, 64, 0]); CUMidiIn.inject("FS-6 Footswitch", [0xB0, 64, 127]); });   // (let go first: it learns on the press)
  await page.waitForFunction(() => /CC 64/.test(document.querySelector('.cd-ctls [data-b="next"]').textContent));
  await shot("s4-controls");
  await T(() => document.querySelector('.cd-modal [data-m="ok"]').click());
  await T(() => { CDawControl.learn("play"); }); await T(() => CUMidiIn.inject("Pads", [0x99, 40, 100]));
  const b = await T(() => CDawControl.bindings()); assert.equal(b.next.type, "cc"); assert.equal(b.next.num, 64); assert.equal(b.play.type, "note"); assert.equal(b.play.ch, 9);
  // the footswitch: up past the middle = a press (Verse 1, then Chorus); let go = nothing
  await T(() => { CUMidiIn.inject("FS-6 Footswitch", [0xB0, 64, 0]); CUMidiIn.inject("FS-6 Footswitch", [0xB0, 64, 127]); });
  assert.equal(await T(() => CDaw.position()), 16);
  await T(() => { CUMidiIn.inject("FS-6 Footswitch", [0xB0, 64, 0]); });
  assert.equal(await T(() => CDaw.position()), 16);
  await T(() => { CUMidiIn.inject("FS-6 Footswitch", [0xB0, 64, 127]); });
  assert.equal(await T(() => CDaw.position()), 48);
  // the pad: play, then stop; the note itself isn't played on the selected track
  const live = await T(() => { let n = 0; const keep = CDaw.live; CDaw.live = function () { n++; return keep.apply(this, arguments); }; CUMidiIn.inject("Pads", [0x99, 40, 100]); CUMidiIn.inject("Pads", [0x89, 40, 0]); const playing = CDaw.state().playing; CUMidiIn.inject("Pads", [0x99, 40, 100]); CDaw.live = keep; return { n, playing, after: CDaw.state().playing }; });
  assert.deepEqual(live, { n: 0, playing: true, after: false });
  // a note nothing is set to still plays
  const free = await T(() => { let n = 0; const keep = CDaw.live; CDaw.live = function () { n++; }; CUMidiIn.inject("Keyboard", [0x90, 60, 90]); CDaw.live = keep; return n; });
  assert.ok(free >= 1, "a free note plays");
  // a knob on master volume
  await T(() => { CDawControl.set("master", { type: "cc", ch: 0, num: 7, device: "" }); CUMidiIn.inject("Keyboard", [0xB0, 7, 127]); });
  assert.equal(await T(() => CDaw.project().master.volume), 6);
  await T(() => CDawControl.clearAll());
});
await check("the loudness readout follows the master while it plays", async () => {
  const r = await T(() => new Promise((res) => { CDaw.setPos(48); CDaw.play(); setTimeout(() => { const m = CDawSong.meter(); const txt = document.querySelector(".cd-lufs-s").textContent; CDaw.stop(); res({ m, txt }); }, 2200); }));
  assert.ok(r.m && r.m.momentary > -60, "momentary " + (r.m && r.m.momentary)); assert.match(r.txt, /-?\d+\.\d LUFS/);
});

console.log(errs.length ? "\npage errors:\n  " + errs.slice(0, 8).join("\n  ") : "");
if (errs.length) failures++;
await browser.close(); srv.close(); fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures ? "\n" + failures + " FAILED" : "\nall passed");
process.exit(failures ? 1 : 0);
