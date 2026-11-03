// Shorts (10.2): picking the good parts, the captions, the crop, and the whole pipeline on a made-up service recording
// (songs, a sermon with its words, applause, a camera recording that started late) - real ffmpeg, a stand-in for the
// speech model (a transcript file) and for the AI model (a small HTTP server answering in its JSON shape).
//   node central-usage/test-shorts.mjs [ffmpeg]
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import http from "node:http"; import assert from "node:assert";
import { createRequire } from "node:module"; import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url)), require = createRequire(import.meta.url);
const P = require("./shorts/pick.js"), C = require("./shorts/captions.js"), R = require("./shorts/render.js"), A = require("./shorts/audio.js"), AI = require("./shorts/ai.js");
const FF = process.argv[2] || process.env.CU_FFMPEG || "ffmpeg";
let failures = 0; const ok = (l) => console.log("  ✓ " + l), bad = (l, e) => { failures++; console.error("  ✗ " + l + (e ? "\n      " + String(e && e.stack || e).split("\n").slice(0, 4).join("\n      ") : "")); };
async function check(label, fn) { try { await fn(); ok(label); } catch (e) { bad(label, e); } }

console.log("Shorts: the rules");
// ---- a sermon's words: sentences of 6-14 words, ~2.6 words a second, a short pause between sentences
const SCRIPT = [
  "Good morning church, it is so good to be together today.", "Before we start, sign up for the potluck on the website and the parking lot is closed next week.", "Turn with me to the gospel of John chapter fifteen.",
  "Jesus says I am the vine and you are the branches.", "And he said that the branches stay connected.", "Here's the thing, you were never meant to carry your life alone.",
  "God is not waiting for you to get it together.", "He is waiting for you to come home.", "You are loved more than you know.", "Grace is not earned, it is received.",
  "I remember the day my father looked at me after the accident.", "I thought he would be angry.", "That's when he said the words I'll never forget.", "Son, nothing you do will ever change how much I love you.",
  "And that's the gospel.", "That's what God says to you today.", "You don't have to earn it, you just have to receive it.", "So let's pray.",
  "Also remember the nursery is open for registration on Wednesday.", "The ushers will now come forward for the offering.", "Next week we continue in John.", "Thank you church, have a great week."
];
function wordsFor(script, t0) {
  const out = []; let t = t0;
  script.forEach((s) => { s.split(" ").forEach((w) => { const d = 0.28 + (w.length % 4) * 0.04; out.push({ text: w, start: Math.round(t * 1000) / 1000, end: Math.round((t + d) * 1000) / 1000 }); t += d + 0.08; }); t += 0.9; });
  return out;
}
await check("sentences: the words are cut on full stops and on pauses", () => {
  const s = P.sentences(wordsFor(SCRIPT.slice(0, 4), 10));
  assert.equal(s.length, 4); assert.match(s[0].text, /^Good morning church/); assert.ok(s[1].start > s[0].end);
});
await check("candidates are whole sentences that fit the length range, and a start mid-thought is skipped", () => {
  const sents = P.sentences(wordsFor(SCRIPT, 0)), cs = P.sermonCandidates(sents, null, { minLen: 15, maxLen: 30 });
  assert.ok(cs.length > 5);
  for (const c of cs) { assert.ok(c.end - c.start >= 15 && c.end - c.start <= 30, "length " + (c.end - c.start)); assert.ok(sents.some((s) => s.start === c.start) && sents.some((s) => s.end === c.end), "starts and ends on sentences"); assert.ok(!/^(And|So|That's what)\b/.test(c.text) || c.start === 0, "doesn't start mid-thought: " + c.text.slice(0, 30)); }
});
await check("the words score: a strong, self-contained passage beats announcements", () => {
  const strong = P.textScore("Here's the thing, you were never meant to carry your life alone. God is not waiting for you to get it together. He is waiting for you to come home. You are loved more than you know.");
  const admin = P.textScore("Before we start, sign up for the potluck on the website and the parking lot is closed next week. Also remember the nursery is open for registration on Wednesday.");
  const weak = P.textScore("And he said that the branches stay connected and then they did.");
  assert.ok(strong > admin + 0.3, strong + " vs " + admin); assert.ok(strong > weak, strong + " vs " + weak);
});
await check("select: the count asked for, never overlapping, the sermon / worship mix, at most two per song", () => {
  const cands = [];
  for (let i = 0; i < 40; i++) cands.push({ kind: "sermon", start: 600 + i * 7, end: 600 + i * 7 + 40, score: Math.random() });
  for (let s = 0; s < 3; s++) for (let i = 0; i < 6; i++) cands.push({ kind: "worship", songIndex: s, start: s * 300 + i * 30, end: s * 300 + i * 30 + 35, score: 0.5 + Math.random() / 2 });
  const out = P.select(cands, { count: 6, sermonShare: 0.5, minGap: 4 });
  assert.equal(out.length, 6);
  for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) assert.ok(!P.overlaps(out[i], out[j], 4), "overlap");
  assert.equal(out.filter((c) => c.kind === "sermon").length, 3);
  const per = {}; out.filter((c) => c.kind === "worship").forEach((c) => { per[c.songIndex] = (per[c.songIndex] || 0) + 1; }); assert.ok(Object.values(per).every((n) => n <= 2));
  const all = P.select(cands, { count: 4, sermonShare: 1 }); assert.ok(all.every((c) => c.kind === "sermon"));
  const none = P.select(cands.filter((c) => c.kind === "worship"), { count: 3, sermonShare: 1 }); assert.equal(none.length, 3, "not enough sermon: worship fills in");
});
await check("make another from here: whole sentences from that moment", () => {
  const sents = P.sentences(wordsFor(SCRIPT, 0)), r = P.fromHere(sents, sents[6].start + 0.5, { minLen: 15, maxLen: 30 });
  assert.equal(r.start, sents[6].start, "from the sentence being said at that moment"); assert.ok(r.end - r.start <= 30 && r.end - r.start >= 10);
});
await check("captions: a few words a line, the word being said lit up, and an SRT", () => {
  const w = wordsFor(["You are loved more than you know.", "Grace is not earned."], 0);
  const ls = C.lines(w, 4); assert.ok(ls.length >= 3 && ls.every((l) => l.words.length <= 4));
  const a = C.ass(w, { highlight: "#ff0000", position: "top", upper: true }, 1080, 1920);
  assert.match(a, /PlayResY: 1920/); assert.match(a, /Style: Cap,Archivo SemiBold,\d+,&H00FFFFFF,&H000000FF/); assert.match(a, /\{\\c&H000000FF\}LOVED/); assert.match(a, /,8,\d+,\d+,\d+,1/);
  assert.equal((a.match(/^Dialogue:/gm) || []).length, w.length);
  assert.match(C.srt(w, 4), /^1\n00:00:00,000 --> /);
  const re = C.retext(w.slice(0, 7), "You are LOVED more than you know."); assert.equal(re[2].text, "LOVED"); assert.equal(re[2].start, w[2].start);
});
await check("the crop follows the speaker in pieces ffmpeg can read, and stays inside the picture", () => {
  const e = R.cropX([{ t: 0, x: 0.3 }, { t: 0.5, x: 0.3 }, { t: 1, x: 0.6 }]);
  assert.match(e, /^max\(0,min\(iw-ow,if\(lt\(t,0\.5\)/);
  const long = []; for (let t = 0; t <= 60; t += 0.5) long.push({ t, x: 0.5 }); assert.ok((R.cropX(long).match(/if\(/g) || []).length <= 72);
  const mv = []; for (let t = 0; t < 20; t += 0.25) mv.push({ t, x: t < 10 ? 0.2 : 0.8, mass: 0.05 });
  const p = A.cropPath(mv, 20, 0.3164); assert.ok(p[2].x < 0.4 && p[p.length - 1].x > 0.6, "moves when the speaker crosses"); assert.ok(p.every((q) => q.x >= 0.158 && q.x <= 0.842));
  assert.equal(A.cropPath(mv.map((m) => Object.assign({}, m, { mass: 0 })), 20, 0.3), null, "no movement: no path");
});
await check("titles without the AI: the strongest line, worship by its song", () => {
  const t = AI.plainTitle({ kind: "sermon", text: "So here we go. You are loved more than you know. Okay." }); assert.equal(t.title, "You are loved more than you know.");
  assert.match(AI.plainTitle({ kind: "worship", song: "Amazing Grace", label: "Chorus" }).title, /^Amazing Grace \(chorus\)/);
});

// ------------------------------------------------------------------ a made-up service, end to end
console.log("Shorts: a whole service");
const ffOk = spawnSync(FF, ["-hide_banner", "-version"]).status === 0;
if (!ffOk) { bad("ffmpeg isn't available (" + FF + ")"); process.exit(1); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cu-shorts-"));
const SR = 16000, MUSIC = 100, GAP = 8, SERMON_START = MUSIC + GAP;
const sermonWords = wordsFor(SCRIPT.concat(SCRIPT.slice(5, 17)), SERMON_START + 2);
const TOTAL = Math.ceil(sermonWords[sermonWords.length - 1].end + 6);
const APPLAUSE = (() => { const w = sermonWords.find((x) => x.text === "gospel." ); return w.end + 0.3; })();
{
  // the sound: a song (held chords: music), a quiet gap, then talking (syllables and pauses: speech) with applause after "And that's the gospel."
  const n = TOTAL * SR, pcm = new Int16Array(n); let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff * 2 - 1; };
  const voiced = new Uint8Array(n); sermonWords.forEach((w) => { for (let i = Math.floor(w.start * SR); i < Math.floor(w.end * SR) && i < n; i++) voiced[i] = 1; });
  for (let i = 0; i < n; i++) {
    const t = i / SR; let v = 0;
    if (t < MUSIC) { const chord = [[220, 277, 330], [196, 247, 294], [175, 220, 262], [247, 311, 370]][Math.floor(t / 10) % 4]; const lift = t > 70 ? 1.6 : t > 40 ? 1.2 : 0.9; v = chord.reduce((s, f) => s + Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t), 0) * 0.09 * lift + rnd() * 0.004; }
    else if (voiced[i]) { const f0 = 120 + 25 * Math.sin(t * 3); const env = 0.5 + 0.5 * Math.sin(2 * Math.PI * 4.5 * t); v = (Math.sin(2 * Math.PI * f0 * t) * 0.5 + Math.sin(4 * Math.PI * f0 * t) * 0.3 + Math.sin(6 * Math.PI * f0 * t) * 0.2) * 0.35 * env + rnd() * 0.01; }
    else v = rnd() * 0.002;
    if (t >= APPLAUSE && t < APPLAUSE + 3) v += rnd() * 0.45;
    pcm[i] = Math.max(-32767, Math.min(32767, Math.round(v * 32767)));
  }
  const buf = Buffer.alloc(44 + n * 2); buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVEfmt ", 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  Buffer.from(pcm.buffer).copy(buf, 44); fs.writeFileSync(path.join(tmp, "Stream mix.wav"), buf);
  fs.writeFileSync(path.join(tmp, "words.json"), JSON.stringify(sermonWords));
  // the camera recording started 3.2 s after the sound recording; a bright "speaker" walks left to right and back
  const v = spawnSync(FF, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=0x303030:s=640x360:r=10:d=" + (TOTAL - 4), "-f", "lavfi", "-i", "color=c=white:s=40x120:r=10:d=" + (TOTAL - 4), "-ss", "3.2", "-i", path.join(tmp, "Stream mix.wav"),
    "-filter_complex", "[0:v][1:v]overlay=x='300+260*sin(t/9)':y=140[v]", "-map", "[v]", "-map", "2:a", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-shortest", path.join(tmp, "camera.mp4")], { encoding: "utf8" });
  if (v.status !== 0) { bad("making the test video: " + v.stderr); process.exit(1); }
}
// the AI model's stand-in: rates passages with "loved" / "gospel" / "grace" high, announcements low; titles from the first words
const llm = http.createServer((req, res) => { let b = ""; req.on("data", (c) => { b += c; }); req.on("end", () => {
  const j = JSON.parse(b), sys = j.messages[0].content, u = j.messages[1].content; llm.calls = (llm.calls || 0) + 1;
  const content = /Rate how well/.test(sys) ? JSON.stringify({ score: /loved|gospel|grace/i.test(u) ? 9 : /potluck|nursery|ushers/i.test(u) ? 1 : 5, line: "You are loved." }) : JSON.stringify({ title: "Test title " + llm.calls, description: "A test description.", hashtags: ["church"] });
  res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content } }] }));
}); });
await new Promise((r) => llm.listen(0, "127.0.0.1", r));
function runWorker(job) {
  const jf = path.join(tmp, "job-" + Date.now() + ".json"); fs.writeFileSync(jf, JSON.stringify(job));
  return new Promise((resolve) => { const p = spawn(process.execPath, [path.join(here, "shorts", "worker.js"), jf], { stdio: ["ignore", "pipe", "pipe"] }); const msgs = []; let out = "", err = ""; p.stdout.on("data", (b) => { out += b; let i; while ((i = out.indexOf("\n")) >= 0) { try { msgs.push(JSON.parse(out.slice(0, i))); } catch (_) { } out = out.slice(i + 1); } }); p.stderr.on("data", (b) => { err += b; }); p.on("close", (code) => resolve({ code, msgs, err })); });
}
const out = path.join(tmp, "Shorts");
const markers = [{ t: 0, song: "Amazing Grace", section: "Verse 1", playing: true }, { t: 40, song: "Amazing Grace", section: "Chorus", playing: true }, { t: 70, song: "Amazing Grace", section: "Bridge", playing: true }, { t: MUSIC, song: "Amazing Grace", playing: false }];
const settings = { count: 3, minLen: 18, maxLen: 26, sermonShare: 0.67, framing: "auto", captions: { on: true, highlight: "#ffd23f", words: 4 }, background: "#202833" };
let data = null, t0 = Date.now();
const res = await runWorker({ mode: "make", out, audio: path.join(tmp, "Stream mix.wav"), video: path.join(tmp, "camera.mp4"), markers, settings, ffmpeg: FF, fonts: path.join(here, "shorts", "fonts"), asr: null, fakeWords: path.join(tmp, "words.json"), aiPort: llm.address().port, church: "Test Church", recordingName: "2026-11-01 10.30 - Sunday" });
await check("the pipeline runs to the end and says how far it got along the way (" + Math.round((Date.now() - t0) / 1000) + " s)", () => {
  assert.equal(res.code, 0, res.err + JSON.stringify(res.msgs.filter((m) => m.type === "error")));
  assert.ok(res.msgs.some((m) => m.type === "progress" && m.step === "listen") && res.msgs.some((m) => m.type === "progress" && m.step === "make") && res.msgs.some((m) => m.type === "done"));
  data = JSON.parse(fs.readFileSync(path.join(out, "shorts.json"), "utf8"));
});
if (data) {
  await check("the camera recording is lined up with the sound (it started 3.2 s later)", () => { assert.ok(Math.abs(data.source.video.lag - 3.2) <= 0.15, "lag " + data.source.video.lag); });
  await check("it found the song (from the markers) and the sermon (the talking)", () => {
    assert.equal(data.songs.length, 1); assert.equal(data.songs[0].name, "Amazing Grace");
    assert.ok(data.sermon && Math.abs(data.sermon.start - SERMON_START) < 12 && data.sermon.end > TOTAL - 20, JSON.stringify(data.sermon));
  });
  await check("three shorts, two from the sermon and one from the song, none overlapping, each in the length range", () => {
    assert.equal(data.shorts.length, 3); assert.equal(data.shorts.filter((s) => s.kind === "sermon").length, 2); assert.equal(data.shorts.filter((s) => s.kind === "worship").length, 1);
    for (const s of data.shorts) assert.ok(s.end - s.start >= 17.5 && s.end - s.start <= 26.01, s.end - s.start);
    const ss = data.shorts.slice().sort((a, b) => a.start - b.start); for (let i = 1; i < ss.length; i++) assert.ok(ss[i].start >= ss[i - 1].end);
  });
  await check("the sermon shorts start and end on whole sentences, and the AI's favourites (not the announcements) won", () => {
    const sents = P.sentences(sermonWords);
    for (const s of data.shorts.filter((x) => x.kind === "sermon")) {
      assert.ok(sents.some((x) => Math.abs(x.start - s.start) < 0.01), "start on a sentence"); assert.ok(sents.some((x) => Math.abs(x.end - s.end) < 0.01), "end on a sentence");
      const text = s.words.map((w) => w.text).join(" "); assert.ok(/loved|gospel|grace/i.test(text), text.slice(0, 80)); assert.ok(!/potluck|nursery|ushers/i.test(text));
      assert.match(s.why, /AI rated it/);
    }
  });
  await check("the worship short is the song's peak (its chorus or bridge), starting where the music breathes", () => {
    const w = data.shorts.find((s) => s.kind === "worship"); assert.ok(w.start >= 38 && w.end <= MUSIC + 0.01, w.start + "-" + w.end); assert.match(w.label, /Chorus|Bridge/);
  });
  await check("each short is a vertical 1080 x 1920 video with sound, a picture for the list, a title and captions", () => {
    for (const s of data.shorts) {
      const f = path.join(out, s.file); assert.ok(fs.existsSync(f), s.file); assert.ok(fs.existsSync(path.join(out, s.thumb)));
      const pr = spawnSync(FF, ["-hide_banner", "-i", f], { encoding: "utf8" }).stderr; assert.match(pr, /1080x1920/); assert.match(pr, /Audio: aac/);
      const d = /Duration: 00:00:(\d+\.\d+)/.exec(pr); assert.ok(d && Math.abs(Number(d[1]) - (s.end - s.start)) < 1.2, "duration " + (d && d[1]));
      assert.match(s.title, /^Test title/); assert.ok(s.description);
      if (s.kind === "sermon") { assert.ok(s.words.length > 20); assert.ok(fs.existsSync(path.join(out, s.srt))); }
    }
  });
  await check("the sermon short follows the speaker (movement in the picture), loudness near -14 LUFS", () => {
    const s = data.shorts.find((x) => x.kind === "sermon"); assert.equal(s.framing, "follow");
    const r = spawnSync(FF, ["-hide_banner", "-i", path.join(out, s.file), "-af", "ebur128", "-f", "null", "-"], { encoding: "utf8" }).stderr; const m = /I:\s+(-?\d+\.\d) LUFS/.exec(r.split("Summary:").pop());
    assert.ok(m && Math.abs(Number(m[1]) + 14) < 2.5, "integrated " + (m && m[1]));
  });
  await check("the captions are burned in (the caption band changes from frame to frame)", () => {
    const s = data.shorts.find((x) => x.kind === "sermon"), f = path.join(out, s.file);
    const grab = (t) => spawnSync(FF, ["-hide_banner", "-loglevel", "error", "-ss", String(t), "-i", f, "-frames:v", "1", "-vf", "crop=1080:300:0:1350,scale=108:30,format=gray", "-f", "rawvideo", "-"], { maxBuffer: 1 << 20 }).stdout;
    const a = grab(2), b = grab(8); let diff = 0; for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i]); assert.ok(a.length === 3240 && diff / a.length > 2, "caption band differs: " + diff / a.length);
    let bright = 0; for (const v of a) if (v > 200) bright++; assert.ok(bright > 20, "white / yellow letters in the band: " + bright);
  });
  // trim + make again; make another from here
  await check("trimming a short and making it again keeps its title and changes its length", async () => {
    const d = JSON.parse(fs.readFileSync(path.join(out, "shorts.json"), "utf8")), s = d.shorts.find((x) => x.kind === "sermon"); s.end = Math.round((s.start + 12) * 100) / 100; s.words = s.words.filter((w) => w.end <= s.end); fs.writeFileSync(path.join(out, "shorts.json"), JSON.stringify(d));
    const r = await runWorker({ mode: "render", id: s.id, out, ffmpeg: FF, fonts: path.join(here, "shorts", "fonts") }); assert.equal(r.code, 0, r.err + JSON.stringify(r.msgs.slice(-2)));
    const now = JSON.parse(fs.readFileSync(path.join(out, "shorts.json"), "utf8")).shorts.find((x) => x.id === s.id); assert.equal(now.title, s.title); assert.ok(Math.abs(now.seconds - 12) < 0.6, now.seconds);
  });
  await check("make another from here: a new short from that moment, on whole sentences", async () => {
    const at = sermonWords.find((w) => w.text === "Grace").start - 0.2;
    const r = await runWorker({ mode: "add", at, out, ffmpeg: FF, fonts: path.join(here, "shorts", "fonts"), asr: null, fakeWords: path.join(tmp, "words.json"), aiPort: null }); assert.equal(r.code, 0, r.err + JSON.stringify(r.msgs.slice(-2)));
    const d = JSON.parse(fs.readFileSync(path.join(out, "shorts.json"), "utf8")); assert.equal(d.shorts.length, 4); const n = d.shorts.find((x) => x.why === "made by hand"); assert.ok(n && /^Grace/.test(n.words[0].text), JSON.stringify(n && n.words.slice(0, 3)));
  });
}
// no camera, no speech model: audio-only shorts with a waveform, picked by the sound alone
await check("without a camera recording or the speech model: audio shorts with a waveform, picked by their sound", async () => {
  const o2 = path.join(tmp, "Shorts-audio");
  const r = await runWorker({ mode: "make", out: o2, audio: path.join(tmp, "Stream mix.wav"), video: null, markers: [], settings: Object.assign({}, settings, { count: 2 }), ffmpeg: FF, fonts: path.join(here, "shorts", "fonts"), asr: null, aiPort: null });
  assert.equal(r.code, 0, r.err + JSON.stringify(r.msgs.slice(-2)));
  const d = JSON.parse(fs.readFileSync(path.join(o2, "shorts.json"), "utf8")); assert.equal(d.shorts.length, 2); assert.ok(d.shorts.every((s) => s.framing === "audio")); assert.match(d.note, /speech model/);
  assert.match(spawnSync(FF, ["-hide_banner", "-i", path.join(o2, d.shorts[0].file)], { encoding: "utf8" }).stderr, /1080x1920/);
});
llm.close();
if (!failures) fs.rmSync(tmp, { recursive: true, force: true }); else console.log("  (files kept in " + tmp + ")");
console.log(failures ? "\n" + failures + " FAILED" : "\nall passed");
process.exit(failures ? 1 : 0);
