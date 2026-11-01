// 30-second previews (10.2): what people hear before they download or buy. The sound libraries' previews are made when
// the libraries are built (tools/make-previews.py) and listed with them (libraries.js); this file makes the rest, on the
// website, with ffmpeg (in the server's image - grade.js uses it too):
//   a Central Tracks song (Pad, Multitrack, Prime)     the loudest 30 seconds of its mix (usually the chorus)
//   a Central Tracks Sound, Board or Click             its demo clip, cut to its best 30 seconds
//   a hymn                                             the preview the build made (hymns.js keeps its address)
//   a community upload (sample, loop, pad, instrument)  the creator's demo clip cut to 30 seconds; with no demo clip,
//                                                      made from the files themselves: loops back to back, a pad
//                                                      through a few keys, a zip of note samples played up and down
// Each is made once and kept (the previews table: owner "track:<id>" or "community:<id>", its storage key) - the first
// listen after a change may take a few seconds. With no ffmpeg (a test machine), the demo clip or mix plays as it is.
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { q, one } from "./db.js";
import * as store from "./storage.js";
import { listZip, readEntry } from "./zipfile.js";

export const SECONDS = 30;
const SR = 44100;

function hasFfmpeg() {
  return new Promise((resolve) => execFile("ffmpeg", ["-version"], { timeout: 5000 }, (err) => resolve(!err)));
}
let ffmpegOk = null;
export async function ffmpegHere() { if (ffmpegOk === null) ffmpegOk = await hasFfmpeg(); return ffmpegOk; }

// a file -> Float32Array stereo interleaved, 44.1 kHz
export function decode(file) {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", ["-v", "error", "-i", file, "-map", "0:a:0", "-f", "f32le", "-ac", "2", "-ar", String(SR), "-"]);
    const parts = []; let err = "";
    p.stdout.on("data", (b) => parts.push(b));
    p.stderr.on("data", (b) => { err += b; });
    p.on("error", reject);
    p.on("close", (code) => {
      if (code !== 0) return reject(new Error((err || "ffmpeg stopped").trim().split("\n").pop()));
      const buf = Buffer.concat(parts);
      resolve(new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 8) * 2));
    });
  });
}
// Float32Array stereo interleaved -> MP3 (128 kb/s), as a Buffer
export function encode(pcm) {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", ["-v", "error", "-f", "f32le", "-ac", "2", "-ar", String(SR), "-i", "-", "-codec:a", "libmp3lame", "-b:a", "128k", "-f", "mp3", "-"]);
    const parts = []; let err = "";
    p.stdout.on("data", (b) => parts.push(b));
    p.stderr.on("data", (b) => { err += b; });
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(Buffer.concat(parts)) : reject(new Error((err || "ffmpeg stopped").trim().split("\n").pop()))));
    p.stdin.on("error", () => { });
    p.stdin.end(Buffer.from(pcm.buffer, pcm.byteOffset, pcm.length * 4));
  });
}

// ---------------------------------------------------------------- shaping the 30 seconds
const frames = (pcm) => pcm.length / 2;
function slice(pcm, a, n) { return pcm.subarray(a * 2, Math.min(pcm.length, (a + n) * 2)); }
// where the loudest 30 seconds start (a second at a time; the very start and end count a little less - the chorus wins)
export function loudestStart(pcm, seconds = SECONDS) {
  const n = frames(pcm), win = seconds * SR;
  if (n <= win) return 0;
  const secs = Math.floor(n / SR), rms = new Float64Array(secs);
  for (let s = 0; s < secs; s++) { let sum = 0; for (let i = s * SR * 2; i < (s + 1) * SR * 2; i++) sum += pcm[i] * pcm[i]; rms[s] = sum; }
  let best = 0, bestV = -1, cur = 0;
  for (let s = 0; s < seconds && s < secs; s++) cur += rms[s];
  for (let s = 0; s + seconds <= secs; s++) {
    const edge = s < secs * 0.08 || s + seconds > secs * 0.97 ? 0.85 : 1;
    if (cur * edge > bestV) { bestV = cur * edge; best = s; }
    cur += (rms[s + seconds] || 0) - rms[s];
  }
  return best * SR;
}
function concat(list) { const out = new Float32Array(list.reduce((a, b) => a + b.length, 0)); let o = 0; for (const x of list) { out.set(x, o); o += x.length; } return out; }
// one after another, each crossfading (equal power) into the next over xf frames
export function crossfadeJoin(parts, xf) {
  let out = parts[0] ? Float32Array.from(parts[0]) : new Float32Array(0);
  for (const p of parts.slice(1)) {
    const f = Math.min(xf, frames(out), frames(p)), o = frames(out) - f;
    const next = new Float32Array(out.length + p.length - f * 2);
    next.set(out.subarray(0, o * 2));
    for (let i = 0; i < f; i++) {
      const t = i / f, a = Math.cos(t * Math.PI / 2), b = Math.sin(t * Math.PI / 2);
      next[(o + i) * 2] = out[(o + i) * 2] * a + p[i * 2] * b;
      next[(o + i) * 2 + 1] = out[(o + i) * 2 + 1] * a + p[i * 2 + 1] * b;
    }
    next.set(p.subarray(f * 2), (o + f) * 2);
    out = next;
  }
  return out;
}
function tile(pcm, n) { if (!pcm.length) return new Float32Array(n * 2); const out = new Float32Array(n * 2); for (let o = 0; o < out.length; o += pcm.length) out.set(pcm.subarray(0, Math.min(pcm.length, out.length - o)), o); return out; }
// 30 seconds at most, faded in and out, at one loudness (RMS about -16 dBFS, peaks under -1 dBFS by a soft knee)
export function finish(pcm) {
  const n = Math.min(frames(pcm), SECONDS * SR), x = Float32Array.from(pcm.subarray(0, n * 2));
  const fi = Math.min(n, Math.round(0.03 * SR)), fo = Math.min(n, Math.round(2.5 * SR));
  for (let i = 0; i < fi; i++) { x[i * 2] *= i / fi; x[i * 2 + 1] *= i / fi; }
  for (let i = 0; i < fo; i++) { const g = Math.pow(i / fo, 1.5), k = n - 1 - i; x[k * 2] *= g; x[k * 2 + 1] *= g; }
  let sum = 0, cnt = 0; for (let i = 0; i < x.length; i++) if (Math.abs(x[i]) > 1e-4) { sum += x[i] * x[i]; cnt++; }
  const rms = cnt ? Math.sqrt(sum / cnt) : 0;
  if (rms > 1e-6) { const g = Math.pow(10, -16 / 20) / rms; for (let i = 0; i < x.length; i++) x[i] *= g; }
  let peak = 0; for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  if (peak > 1.78) { const g = 1.78 / peak; for (let i = 0; i < x.length; i++) x[i] *= g; }
  const knee = 0.6, ceil = 0.89;
  for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > knee) x[i] = Math.sign(x[i]) * (knee + (ceil - knee) * Math.tanh((a - knee) / (ceil - knee))); }
  return x;
}

// a recording (a mix, a demo clip): its best 30 seconds; loop: a short one repeats to fill them
export async function fromRecording(file, opts = {}) {
  const pcm = await decode(file);
  if (!pcm.length) throw new Error("no audio in it");
  if (frames(pcm) <= SECONDS * SR) return encode(finish(opts.loop ? tile(pcm, SECONDS * SR) : pcm));
  return encode(finish(slice(pcm, loudestStart(pcm), SECONDS * SR)));
}

// note names in sample file names (C4.wav, F#3, Bb2, "Piano A0 mf.wav") -> MIDI note
const NOTE = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
export function noteOf(name) {
  const m = /(?:^|[^a-z])([a-g])(#|s|b)?(-?\d)(?![\d])/i.exec(path.basename(String(name), path.extname(String(name))));
  if (!m) return null;
  const acc = m[2] ? (m[2] === "b" ? -1 : 1) : 0;
  return (Number(m[3]) + 1) * 12 + NOTE[m[1].toLowerCase()] + acc;
}
const PAD_KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
function keyOf(name) {
  const b = path.basename(String(name), path.extname(String(name))).toLowerCase().replace(/sharp$/, "#").replace(/s$/, "#");
  const i = PAD_KEYS.findIndex((k) => k.toLowerCase() === b || k.toLowerCase().replace("#", "s") === b);
  return i;
}
// resample a stereo buffer by a ratio (a sample played a few semitones up or down)
function pitch(pcm, ratio, maxFrames) {
  const n = Math.min(maxFrames, Math.floor(frames(pcm) / ratio)), out = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const p = i * ratio, k = Math.floor(p), t = p - k, k2 = Math.min(k + 1, frames(pcm) - 1);
    out[i * 2] = pcm[k * 2] * (1 - t) + pcm[k2 * 2] * t; out[i * 2 + 1] = pcm[k * 2 + 1] * (1 - t) + pcm[k2 * 2 + 1] * t;
  }
  return out;
}
function mixAt(out, x, at, gain) { for (let i = 0; i < x.length && at * 2 + i < out.length; i++) out[at * 2 + i] += x[i] * gain; }

// a community item's files (already on disk) -> a preview, or null when nothing in them can be played without a synth
//   loop: the loops back to back; pad: its loops through a few keys (D A B G C G); sample / instrument (a zip of WAVs
//   named by note): an arpeggio up and down and a few chords from the nearest samples
export async function fromItemFiles(kind, files) {
  const audio = files.filter((f) => /\.(wav|mp3|flac|aif|aiff|ogg|m4a)$/i.test(f.name));
  if (!audio.length) return null;
  if (kind === "loop") {
    const share = SECONDS * SR / Math.min(audio.length, 10), parts = [];
    for (const f of audio.slice(0, 10)) { const x = await decode(f.path); if (!x.length) continue; const reps = Math.max(1, Math.round(share / frames(x))); parts.push(tile(x, reps * frames(x) > share * 1.5 ? Math.round(share) : reps * frames(x))); }
    if (!parts.length) return null;
    let out = crossfadeJoin(parts, Math.round(0.02 * SR));
    while (frames(out) < SECONDS * SR) out = crossfadeJoin([out, ...parts], Math.round(0.02 * SR));
    return encode(finish(out));
  }
  if (kind === "pad") {
    const byKey = {}; for (const f of audio) { const k = keyOf(f.name); if (k >= 0) byKey[k] = f; }
    const order = ["D", "A", "B", "G", "C", "G"].map((k) => PAD_KEYS.indexOf(k));
    const have = Object.keys(byKey).map(Number);
    if (!have.length) return fromRecording(audio[0].path, { loop: true });
    const xf = Math.round(1.5 * SR), seg = Math.round((SECONDS + 5 * 1.5) / 6 * SR), cache = {}, parts = [];
    for (const k of order) { const use = byKey[k] ? k : have[0]; if (!cache[use]) cache[use] = await decode(byKey[use].path); parts.push(tile(cache[use], seg)); }
    return encode(finish(crossfadeJoin(parts, xf)));
  }
  // samples by note: an arpeggio up through D major and back, then chords
  const notes = []; for (const f of audio) { const n = noteOf(f.name); if (n != null) notes.push({ n, f }); }
  if (!notes.length) return null;
  notes.sort((a, b) => a.n - b.n);
  const lo = notes[0].n, hi = notes[notes.length - 1].n, mid = Math.round((lo + hi) / 2), cache = new Map();
  const near = async (n) => { let best = notes[0]; for (const x of notes) if (Math.abs(x.n - n) < Math.abs(best.n - n)) best = x; if (!cache.has(best.f.path)) cache.set(best.f.path, await decode(best.f.path)); return { pcm: cache.get(best.f.path), root: best.n }; };
  const out = new Float32Array(SECONDS * SR * 2), beat = 60 / 84 * SR;
  const scale = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16];
  const base = Math.max(lo, Math.min(hi - 16, mid - 8)), d = base + ((2 - base) % 12 + 12) % 12;   // (from the D nearest the middle of its range)
  let t = 0;
  const line = scale.concat(scale.slice(0, -1).reverse());
  for (const s of line) { const { pcm, root } = await near(d + s); mixAt(out, pitch(pcm, Math.pow(2, (d + s - root) / 12), Math.round(beat * 2)), Math.round(t), 0.5); t += beat / 2; }
  const chords = [[2, 6, 9], [9, 13, 16], [11, 14, 18], [7, 11, 14]];
  for (let c = 0; t < SECONDS * SR - beat; c++) {
    for (const s of chords[c % 4]) { const n = d - 2 + s, { pcm, root } = await near(n); mixAt(out, pitch(pcm, Math.pow(2, (n - root) / 12), Math.round(beat * 4)), Math.round(t), 0.35); }
    t += beat * 4;
  }
  return encode(finish(out));
}

// ---------------------------------------------------------------- kept previews
export async function kept(owner) { return one("SELECT * FROM previews WHERE owner=$1", [owner]); }
export async function keep(owner, buf, source) {
  const key = "previews/" + owner.replace(/[^a-z0-9-]+/gi, "-") + "-" + Date.now().toString(36) + ".mp3";
  await store.putFile(key, buf, "audio/mpeg");
  const old = await kept(owner);
  await q("INSERT INTO previews (owner, storage_key, source, made_at) VALUES ($1,$2,$3,now()) ON CONFLICT (owner) DO UPDATE SET storage_key=EXCLUDED.storage_key, source=EXCLUDED.source, made_at=now()", [owner, key, source || ""]);
  if (old && old.storage_key && !/^https:/.test(old.storage_key) && old.storage_key !== key) await store.remove(old.storage_key).catch(() => { });
  return key;
}
export async function keepUrl(owner, url, source) {   // (a preview kept elsewhere - a hymn's, on the release)
  await q("INSERT INTO previews (owner, storage_key, source, made_at) VALUES ($1,$2,$3,now()) ON CONFLICT (owner) DO UPDATE SET storage_key=EXCLUDED.storage_key, source=EXCLUDED.source, made_at=now()", [owner, url, source || url]);
}
export async function forget(owner) {
  const old = await kept(owner);
  await q("DELETE FROM previews WHERE owner=$1", [owner]);
  if (old && old.storage_key && !/^https:/.test(old.storage_key)) await store.remove(old.storage_key).catch(() => { });
}
async function withTemp(key, fn) {
  if (/^https:\/\//.test(key)) {   // (a file kept elsewhere: fetched to a temporary file first)
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "preview-")), file = path.join(dir, "in" + (path.extname(new URL(key).pathname) || ".mp3"));
    try {
      const r = await fetch(key, { redirect: "follow", signal: AbortSignal.timeout(60000) });
      if (!r.ok) throw new Error("the file answered " + r.status);
      fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
      return await fn(file);
    } finally { fs.rm(dir, { recursive: true, force: true }, () => { }); }
  }
  const tmp = await store.fetchToTemp(key);
  try { return await fn(tmp); } finally { fs.rm(path.dirname(tmp), { recursive: true, force: true }, () => { }); }
}
const making = new Map();   // (one cut at a time per owner: two listeners at once wait for the same one)
// the preview's storage key for a recording (made now if it isn't kept yet, or its source changed); null without ffmpeg
export async function forRecording(owner, sourceKey, opts = {}) {
  const k = await kept(owner);
  if (k && (k.source === sourceKey || /^https:/.test(k.storage_key) && k.source === k.storage_key)) return k.storage_key;
  if (!(await ffmpegHere())) return null;
  if (making.has(owner)) return making.get(owner);
  const job = withTemp(sourceKey, async (file) => keep(owner, await fromRecording(file, opts), sourceKey)).finally(() => making.delete(owner));
  making.set(owner, job);
  return job;
}

// ---------------------------------------------------------------- community uploads
const AUDIO_RE = /\.(wav|mp3|flac|aif|aiff|ogg|m4a)$/i;
// an item sent for review: its preview made and kept ("community:<id>") - from the demo clip, or (with none) from its own
// files. { key } when there is one, null when nothing could be made (no ffmpeg; a SoundFont or SFZ with no demo clip).
//   read(storageKey) -> Buffer (creators.js hands its own reader in)
export async function forCommunityItem(item, files, read) {
  if (!(await ffmpegHere())) return null;
  const owner = "community:" + item.id, loop = item.kind === "loop" || item.kind === "pad";
  const demo = files.find((f) => f.role === "demo");
  if (demo) return { key: await withTemp(demo.storage_key, async (file) => keep(owner, await fromRecording(file, { loop }), demo.storage_key)), from: "demo" };
  if (!["loop", "pad", "sample", "instrument"].includes(item.kind)) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "preview-"));
  try {
    const list = [];
    for (const f of files.filter((x) => x.role === "source")) {
      const data = await read(f.storage_key);
      if (/\.zip$/i.test(f.name)) {
        for (const e of listZip(data)) {
          if (e.isDir || e.isLink || !AUDIO_RE.test(e.name) || /(^|\/)__MACOSX\//.test(e.name) || e.size > 200 * 1024 ** 2 || list.length >= 160) continue;
          const p = path.join(dir, String(list.length) + "-" + path.basename(e.name).replace(/[^\w#.-]+/g, "_"));
          fs.writeFileSync(p, readEntry(data, e)); list.push({ name: path.basename(e.name), path: p });
        }
      } else if (AUDIO_RE.test(f.name) && list.length < 160) {
        const p = path.join(dir, String(list.length) + "-" + path.basename(f.name).replace(/[^\w#.-]+/g, "_"));
        fs.writeFileSync(p, data); list.push({ name: f.name, path: p });
      }
    }
    list.sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
    const buf = await fromItemFiles(item.kind, list);
    return buf ? { key: await keep(owner, buf, "files"), from: "files" } : null;
  } finally { fs.rm(dir, { recursive: true, force: true }, () => { }); }
}
// a community item's preview address for the pages and the apps (its kept preview, else its demo clip), or null
export async function communityUrl(itemId, demoKey) {
  const k = await kept("community:" + itemId);
  if (k) return store.downloadUrl(k.storage_key, "preview.mp3");
  return demoKey ? store.downloadUrl(demoKey, "preview.mp3") : null;
}

// ---------------------------------------------------------------- Central Tracks
// GET /v1/tracks/:id/preview.mp3 - anyone can listen before buying: a 302 to the kept preview (made now the first time)
export function routes(api, { wrap, bad }) {
  api.get(["/tracks/:id/preview.mp3", "/tracks/:id/preview"], wrap(async (req, res) => {
    const t = await one("SELECT * FROM tracks WHERE id=$1", [Number(req.params.id) || 0]);
    if (!t || t.status !== "live") throw bad("That track isn't available.", 404);
    const owner = "track:" + t.id, have = await kept(owner);
    let key = have && /^https:/.test(have.storage_key) ? have.storage_key : null;   // (a hymn: the preview the build made)
    if (!key) {
      const src = await one("SELECT * FROM track_files WHERE track_id=$1 AND is_mix ORDER BY id LIMIT 1", [t.id]);
      if (!src) throw bad("This one has nothing to listen to yet.", 404);
      key = (await forRecording(owner, src.storage_key, { loop: t.kind === "Pad" || t.kind === "Click" }).catch(() => null)) || src.storage_key;   // (no ffmpeg, or it can't be cut: the clip as it is)
    }
    res.set("Cache-Control", "public, max-age=300");
    res.redirect(302, await store.downloadUrl(key, "preview.mp3"));
  }));
}
