/* Shorts - the work itself, in a process of its own at low priority (the service keeps running smoothly): read the
 * recording, find the songs and the sermon, write down the sermon's words, pick the good parts, and make each short.
 *
 * Started by index.js (or a test) with one job file: node worker.js <job.json>. Messages back (process.send, or lines
 * on stdout when there's no parent): { type: "progress", step, pct, text } · { type: "short", short } · { type: "done", file }
 * · { type: "error", error }
 *
 * job: { mode: "make" | "render" | "add", out (the shorts folder), audio, video, markers, settings, ffmpeg, fonts,
 *        asr: { dir, model, language } | null, aiPort | null, church, fakeWords (tests: a transcript file), id / at (render / add) } */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const A = require("./audio");
const P = require("./pick");
const R = require("./render");
const AI = require("./ai");

const job = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
try { require("node:os").setPriority(19); } catch (_) { }
const say = (m) => { if (process.send) process.send(m); else process.stdout.write(JSON.stringify(m) + "\n"); };
const step = (stepName, pct, text) => say({ type: "progress", step: stepName, pct: Math.max(0, Math.min(1, pct)), text });
const bin = job.ffmpeg;
const dataFile = path.join(job.out, "shorts.json");
function load() { try { return JSON.parse(fs.readFileSync(dataFile, "utf8")); } catch (_) { return null; } }
function save(d) { fs.mkdirSync(job.out, { recursive: true }); fs.writeFileSync(dataFile + ".tmp", JSON.stringify(d, null, 1)); fs.renameSync(dataFile + ".tmp", dataFile); }

// ------------------------------------------------------------------ the speech model (the one Lyrics uses)
let asrPipe = null;
async function transcribe(file, start, dur, onPct) {
  if (job.fakeWords) { const all = JSON.parse(fs.readFileSync(job.fakeWords, "utf8")); return all.filter((w) => w.start >= start && w.end <= start + dur + 0.5); }
  if (!job.asr) return [];
  if (!asrPipe) {
    const { pipeline, env } = await import("@huggingface/transformers");
    env.cacheDir = job.asr.dir; env.allowRemoteModels = false; env.allowLocalModels = true; env.localModelPath = job.asr.dir;
    asrPipe = await pipeline("automatic-speech-recognition", job.asr.model, { dtype: { encoder_model: "fp32", decoder_model_merged: "q8" } });
  }
  const words = [], PIECE = 600;   // ten minutes at a time
  for (let t = 0; t < dur; t += PIECE) {
    const len = Math.min(PIECE + 5, dur - t), pcm = await A.pcm(bin, file, start + t, len);
    const opts = { return_timestamps: "word", chunk_length_s: 30, stride_length_s: 5, task: "transcribe" }; if (job.asr.language) opts.language = job.asr.language;
    const r = await asrPipe(pcm, opts);
    for (const c of r.chunks || []) {
      const text = String(c.text || "").trim(); if (!text) continue;
      const a = start + t + ((c.timestamp && c.timestamp[0]) || 0), b = start + t + ((c.timestamp && (c.timestamp[1] != null ? c.timestamp[1] : c.timestamp[0])) || 0);
      if (t > 0 && a < start + t + 2.5 && words.length && a <= words[words.length - 1].end) continue;   // (the overlap between pieces)
      words.push({ text, start: Math.round(a * 1000) / 1000, end: Math.round(Math.max(a, b) * 1000) / 1000 });
    }
    if (onPct) onPct(Math.min(1, (t + PIECE) / dur));
  }
  return words;
}

// ------------------------------------------------------------------ making the shorts
function shortName(i) { return "Short " + String(i).padStart(2, "0"); }
async function cropFor(src, clip, settings) {
  if (!src.video || settings.framing === "blur" || settings.framing === "center") return null;
  const vw = src.video.w || 1920, vh = src.video.h || 1080;
  if (vw / vh <= 9 / 16 + 0.01) return null;
  const mv = await A.motion(bin, src.video.file, Math.max(0, clip.start - (src.video.lag || 0)), clip.end - clip.start, 4);
  return A.cropPath(mv, clip.end - clip.start, (vh * 9 / 16) / vw);
}
async function makeOne(d, sh, onPct) {
  const src = d.source, base = path.join(job.out, sh.file.replace(/\.mp4$/, ""));
  const work = path.join(job.out, ".work", sh.id); fs.rmSync(work, { recursive: true, force: true });
  const crop = await cropFor(src, sh, d.settings);
  const r = await R.render({ bin, out: base + ".mp4", work, start: sh.start, end: sh.end, video: src.video, audio: src.audio, words: sh.captions === false ? [] : sh.words, settings: d.settings, fonts: job.fonts, path: crop, progress: onPct });
  await R.thumb(bin, r.file, base + ".jpg", Math.min(3, (sh.end - sh.start) / 3));
  fs.rmSync(work, { recursive: true, force: true });
  sh.seconds = Math.round(r.seconds * 10) / 10; sh.framing = crop ? "follow" : src.video ? "blur" : "audio"; sh.rendered = Date.now(); sh.thumb = sh.file.replace(/\.mp4$/, ".jpg"); sh.srt = fs.existsSync(base + ".srt") ? sh.file.replace(/\.mp4$/, ".srt") : null;
  return sh;
}

async function make() {
  const S = Object.assign({}, P.DEFAULTS, job.settings || {});
  fs.mkdirSync(job.out, { recursive: true });
  step("read", 0, "Reading the recording");
  const src = { audio: null, video: null };
  let vp = null;
  if (job.video) { vp = await A.probe(bin, job.video); if (vp.video) src.video = { file: job.video, w: vp.video.w, h: vp.video.h, lag: 0 }; }
  if (job.audio) src.audio = { file: job.audio, lag: 0 };
  else if (vp && vp.audio) src.audio = { file: job.video, lag: 0 };
  if (!src.audio) throw new Error("This recording has no sound to work from.");
  // the camera recording and the sound recording didn't start at the same moment: line them up by their sound
  if (src.video && src.audio.file !== src.video.file && vp && vp.audio) {
    step("align", 0.02, "Lining the camera recording up with the sound");
    const ea = await A.envelope(bin, src.audio.file, 2), ev = await A.envelope(bin, src.video.file, 2);
    const c = A.align(ea, ev, 2, 900);
    const fa = await A.envelope(bin, src.audio.file, 20), fv = await A.envelope(bin, src.video.file, 20);
    // refine around the coarse answer at 20 steps a second
    let best = c.lag, bc = -Infinity;
    for (let lag = c.lag - 1; lag <= c.lag + 1.0001; lag += 0.05) {
      const L = Math.round(lag * 20); let s = 0, n = 0; const i0 = Math.max(0, L), j0 = i0 - L, len = Math.min(fa.length - i0, fv.length - j0);
      for (let k = 0; k < len; k += 3) { s += fa[i0 + k] * fv[j0 + k]; n++; } const m = n ? s / n : -Infinity; if (m > bc) { bc = m; best = lag; }
    }
    src.video.lag = Math.round(best * 100) / 100; src.alignConfidence = Math.round(c.confidence * 100) / 100;
  }
  step("listen", 0.05, "Listening to the whole service");
  const ap = await A.probe(bin, src.audio.file);
  const f = await A.analyze(bin, src.audio.file, { progress: (t) => step("listen", 0.05 + 0.15 * Math.min(1, t / Math.max(1, ap.duration)), "Listening to the whole service") });
  const reg = P.regions(f, job.markers || []);
  // the words: the sermon (or the longest stretches of talking), then each worship short's own words for its captions
  let words = [];
  const talkParts = reg.sermon ? [reg.sermon] : reg.talk.filter((r) => r.end - r.start >= 60).slice(0, 3);
  const talkTotal = talkParts.reduce((s, r) => s + (r.end - r.start), 0);
  let wordsError = null;
  if ((job.asr || job.fakeWords) && talkParts.length) {
    let doneSec = 0;
    try {
      for (const r of talkParts) {
        const w = await transcribe(src.audio.file, r.start, r.end - r.start, (p) => step("words", 0.2 + 0.45 * Math.min(1, (doneSec + p * (r.end - r.start)) / talkTotal), "Writing down the sermon's words"));
        words = words.concat(w); doneSec += r.end - r.start;
      }
    } catch (e) { wordsError = "The speech model couldn't write down the words (" + String(e && e.message || e).slice(0, 160) + "), so these shorts were picked by their sound and have no captions."; job.asr = null; }
  }
  fs.writeFileSync(path.join(job.out, "transcript.json"), JSON.stringify({ words }, null, 0));
  step("pick", 0.66, "Finding the good parts");
  const sents = P.sentences(words);
  let sermonC = P.sermonCandidates(sents, f, S);
  if (!sents.length && talkParts.length) {
    // no words (the speech model isn't downloaded): stretches of talking that end on a pause, by the sound alone
    sermonC = [];
    for (const r of talkParts) for (let t = r.start; t + S.minLen <= r.end; t += 10) {
      const a = P.breath(f, t, 2), b = P.breath(f, Math.min(r.end, a + (S.minLen + S.maxLen) / 2), 3); if (b - a < S.minLen || b - a > S.maxLen) continue;
      const as = P.audioScore(f, a, b, P.median(Array.from(f.rms)));
      sermonC.push({ kind: "sermon", start: a, end: b, text: "", words: [], score: 0.3 + as.energy * 0.3 + as.response * 0.25 + as.pause * 0.15, parts: as });
    }
  }
  const worshipC = P.worshipCandidates(reg.songs, f, S);
  // the model rates the strongest few dozen sermon passages (the rules picked them, all different from each other)
  if (job.aiPort && sermonC.some((c) => c.text)) {
    const top = []; for (const c of sermonC.slice().sort((a, b) => b.score - a.score)) { if (top.length >= 24) break; if (top.some((x) => Math.min(x.end, c.end) - Math.max(x.start, c.start) > 0.5 * (c.end - c.start))) continue; top.push(c); }
    await AI.rate(job.aiPort, top, (i, n) => step("pick", 0.66 + 0.08 * (i / n), "The AI is reading the best parts (" + i + " of " + n + ")"));
  }
  const picks = P.select(sermonC.concat(worshipC), S);
  // captions for the worship shorts: the sung words
  for (const p of picks) if (p.kind === "worship" && (job.asr || job.fakeWords) && S.captions && S.captions.on !== false) { try { p.words = await transcribe(src.audio.file, p.start, p.end - p.start); p.text = p.words.map((w) => w.text).join(" "); } catch (_) { p.words = []; } }
  const d = { version: 1, recording: job.recordingName || path.basename(job.out), created: Date.now(), settings: S, source: src, songs: reg.songs.map((s) => ({ name: s.name, start: s.start, end: s.end })), sermon: reg.sermon, hasWords: words.length > 0, note: wordsError || (!job.asr && !job.fakeWords ? "The speech model isn't downloaded on this computer (Settings → Lyrics), so these shorts were picked by their sound alone and have no captions." : null), shorts: [] };
  const old = load(); if (old && old.posted) d.posted = old.posted;
  save(d);
  let i = 0;
  for (const p of picks) {
    i++;
    const t = job.aiPort ? (await AI.titles(job.aiPort, p, job.church)) || AI.plainTitle(p, job.church) : AI.plainTitle(p, job.church);
    const sh = { id: "s" + Date.now().toString(36) + i, n: i, kind: p.kind, song: p.song || null, label: p.label || "", start: p.start, end: p.end, score: Math.round(p.score * 100) / 100, why: why(p), title: t.title, description: t.description, hashtags: t.hashtags || [], words: P.wordsIn(p.words || words, p.start, p.end), status: "new", posts: [], file: shortName(i).replace(" ", "-").toLowerCase() + ".mp4" };
    step("make", 0.75 + 0.25 * ((i - 1) / picks.length), "Making short " + i + " of " + picks.length);
    await makeOne(d, sh, (q) => step("make", 0.75 + 0.25 * ((i - 1 + q) / picks.length), "Making short " + i + " of " + picks.length));
    d.shorts.push(sh); save(d); say({ type: "short", short: sh });
  }
  d.finished = Date.now(); save(d);
  step("done", 1, picks.length ? "Made " + picks.length + " short" + (picks.length > 1 ? "s" : "") : "Didn't find anything to make a short from");
}
function why(p) {
  if (p.kind === "worship") return [p.label ? "the " + p.label.toLowerCase() : "a peak of the song", p.parts && p.parts.peak > 0.6 ? "louder than the rest of the song" : "", p.parts && p.parts.room > 0.3 ? "the room joins in" : ""].filter(Boolean).join(", ");
  const x = p.parts || {}, out = [];
  if (p.ai != null) out.push("the AI rated it " + Math.round(1 + p.ai * 9) + "/10");
  if (x.text > 0.6) out.push("a strong, complete thought"); if (x.response > 0.3) out.push("the room responded"); if (x.energy > 0.6) out.push("spoken with energy"); if (x.pause > 0.5) out.push("ends on a pause");
  return out.join(", ") || "a complete thought";
}

async function renderOne() {
  const d = load(); if (!d) throw new Error("The shorts list for this recording is missing.");
  const sh = d.shorts.find((x) => x.id === job.id); if (!sh) throw new Error("That short isn't in the list any more.");
  step("make", 0, "Making " + (sh.title || "the short") + " again");
  await makeOne(d, sh, (q) => step("make", q, "Making " + (sh.title || "the short") + " again"));
  const now = load() || d; const k = now.shorts.findIndex((x) => x.id === sh.id); if (k >= 0) now.shorts[k] = Object.assign(now.shorts[k], { seconds: sh.seconds, framing: sh.framing, rendered: sh.rendered, thumb: sh.thumb, srt: sh.srt });
  save(now); say({ type: "short", short: now.shorts[k] || sh }); step("done", 1, "Done");
}
async function addOne() {
  const d = load(); if (!d) throw new Error("The shorts list for this recording is missing.");
  const S = d.settings, t = Number(job.at) || 0;
  let words = []; try { words = JSON.parse(fs.readFileSync(path.join(job.out, "transcript.json"), "utf8")).words || []; } catch (_) { }
  const song = (d.songs || []).find((s) => t >= s.start && t < s.end);
  let clip = null, kind = "sermon";
  if (!song && words.length) clip = P.fromHere(P.sentences(words), t, S);
  if (!clip) { kind = song ? "worship" : "sermon"; const len = (S.minLen + S.maxLen) / 2; clip = { start: Math.round(t * 100) / 100, end: Math.round((t + len) * 100) / 100 }; }
  const n = d.shorts.reduce((m, x) => Math.max(m, x.n || 0), 0) + 1;
  const clipWords = song && (job.asr || job.fakeWords) ? await transcribe(d.source.audio.file, clip.start, clip.end - clip.start).catch(() => []) : P.wordsIn(words, clip.start, clip.end);
  const p = { kind, song: song ? song.name : null, start: clip.start, end: clip.end, text: clipWords.map((w) => w.text).join(" "), words: clipWords };
  const tt = job.aiPort ? (await AI.titles(job.aiPort, p, job.church)) || AI.plainTitle(p, job.church) : AI.plainTitle(p, job.church);
  const sh = { id: "s" + Date.now().toString(36) + n, n, kind, song: p.song, label: "", start: clip.start, end: clip.end, score: null, why: "made by hand", title: tt.title, description: tt.description, hashtags: tt.hashtags || [], words: clipWords, status: "new", posts: [], file: "short-" + String(n).padStart(2, "0") + ".mp4" };
  step("make", 0, "Making a new short");
  await makeOne(d, sh, (q) => step("make", q, "Making a new short"));
  const now = load() || d; now.shorts.push(sh); now.shorts.sort((a, b) => a.start - b.start); save(now); say({ type: "short", short: sh }); step("done", 1, "Done");
}

(async () => {
  try { if (job.mode === "render") await renderOne(); else if (job.mode === "add") await addOne(); else await make(); say({ type: "done", file: dataFile }); }
  catch (e) { say({ type: "error", error: String(e && e.message || e) }); process.exitCode = 1; }
  finally { if (process.send) setTimeout(() => process.exit(), 50); }
})();
