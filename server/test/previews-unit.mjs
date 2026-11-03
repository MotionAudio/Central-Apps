// 10.2: the website's 30-second previews (src/previews.js) without a database - the cutting and the making:
// a long mix gives its loudest 30 seconds, a short loop repeats to 30, a pad goes through its keys, samples named by note
// play up and down, and every preview is a 30-second MP3 at one loudness.   node test/previews-unit.mjs
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://nobody@127.0.0.1:1/none";   // (not used: nothing here touches the database)
const P = await import("../src/previews.js");
let fails = 0;
const ok = (c, m, d) => { console.log((c ? "  ✓ " : "  ✗ ") + m + (c || d === undefined ? "" : "   -- " + JSON.stringify(d).slice(0, 400))); if (!c) fails++; };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ma-prev-"));
function wav(file, seconds, freqAt, rate = 44100) {   // freqAt(t) -> [frequency, level]
  const n = Math.round(seconds * rate), b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVE", 8); b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  let ph = 0;
  for (let i = 0; i < n; i++) { const [f, a] = freqAt(i / rate); ph += 2 * Math.PI * f / rate; b.writeInt16LE(Math.round(Math.sin(ph) * 20000 * a), 44 + i * 2); }
  fs.writeFileSync(file, b); return file;
}
async function info(buf) {
  const f = path.join(dir, "out-" + Math.random().toString(36).slice(2) + ".mp3"); fs.writeFileSync(f, buf);
  const pcm = await P.decode(f), n = pcm.length / 2, secs = n / 44100;
  let peak = 0, sum = 0, cnt = 0; for (let i = 0; i < pcm.length; i++) { const a = Math.abs(pcm[i]); peak = Math.max(peak, a); if (a > 1e-4) { sum += a * a; cnt++; } }
  return { secs, peak, rmsDb: 20 * Math.log10(Math.sqrt(sum / Math.max(1, cnt))), mp3: buf.slice(0, 3).toString("latin1") === "ID3" || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0), pcm };
}

try {
  ok(await P.ffmpegHere(), "ffmpeg is here (the server's image has it)");
  // a 3-minute "song": quiet verse, loud chorus from 100 s to 140 s, quiet outro
  const song = wav(path.join(dir, "song.wav"), 180, (t) => [220 + 50 * Math.sin(t), t > 100 && t < 140 ? 1 : 0.15]);
  const pcm = await P.decode(song);
  const st = P.loudestStart(pcm) / 44100;
  ok(st >= 98 && st <= 112, "a song's loudest 30 seconds are found (the chorus, 100-140 s): starts at " + st + " s", st);
  let i1 = await info(await P.fromRecording(song));
  ok(i1.mp3 && Math.abs(i1.secs - 30) < 0.3, "a song's preview is a 30-second MP3", i1.secs);
  ok(i1.peak < 0.99 && i1.rmsDb > -20 && i1.rmsDb < -12, "...at one loudness (about -16 dBFS RMS), its peaks under full scale", { peak: i1.peak, rms: i1.rmsDb });
  // a 4-second loop repeats to 30 s
  const loop = wav(path.join(dir, "loop.wav"), 4, (t) => [330, t % 1 < 0.5 ? 1 : 0.3]);
  i1 = await info(await P.fromRecording(loop, { loop: true }));
  ok(Math.abs(i1.secs - 30) < 0.3 && i1.pcm.subarray(20 * 44100 * 2, 21 * 44100 * 2).some((v) => Math.abs(v) > 0.05), "a short loop repeats to fill the 30 seconds", i1.secs);
  const one = wav(path.join(dir, "hit.wav"), 2, () => [440, 1]);
  i1 = await info(await P.fromRecording(one));
  ok(i1.secs < 3, "a one-shot sample stays as long as it is (it isn't padded with silence)", i1.secs);
  // loops back to back
  const loops = [wav(path.join(dir, "a.wav"), 3, () => [200, 1]), wav(path.join(dir, "b.wav"), 3, () => [400, 1])].map((p) => ({ name: path.basename(p), path: p }));
  i1 = await info(await P.fromItemFiles("loop", loops));
  ok(Math.abs(i1.secs - 30) < 0.3, "community loops: back to back, 30 seconds", i1.secs);
  // a pad: 12 keys
  const KEYS = ["C", "Cs", "D", "Ds", "E", "F", "Fs", "G", "Gs", "A", "As", "B"];
  const pad = KEYS.map((k, i) => { const p = wav(path.join(dir, k + ".wav"), 4, () => [130.8 * Math.pow(2, i / 12), 0.7]); return { name: k.replace("s", "#") + ".wav", path: p }; });
  i1 = await info(await P.fromItemFiles("pad", pad));
  ok(Math.abs(i1.secs - 30) < 0.3, "a community pad: its loops through a few keys, 30 seconds", i1.secs);
  // samples named by note
  const notes = ["C3", "C4", "G4", "C5"].map((n, i) => { const f = [130.8, 261.6, 392, 523.3][i]; const p = wav(path.join(dir, "Piano " + n + ".wav"), 1.5, (t) => [f, Math.exp(-2 * t)]); return { name: "Piano " + n + ".wav", path: p }; });
  ok(P.noteOf("Piano C4.wav") === 60 && P.noteOf("F#3.wav") === 54 && P.noteOf("Bb2 soft.wav") === 46 && P.noteOf("loop.wav") === null, "note names in sample file names (C4 = 60, F#3, Bb2; none in loop.wav)");
  i1 = await info(await P.fromItemFiles("instrument", notes));
  ok(Math.abs(i1.secs - 30) < 0.3 && i1.pcm.subarray(25 * 44100 * 2, 26 * 44100 * 2).some((v) => Math.abs(v) > 0.02), "a community instrument from samples named by note: played up and down and in chords, 30 seconds", i1.secs);
  ok((await P.fromItemFiles("instrument", [{ name: "bank.sf2", path: one }])) === null, "...but a SoundFont alone can't be played here: no preview (its demo clip is asked for)");
} catch (e) { ok(false, "stopped: " + (e && e.stack || e)); }
fs.rmSync(dir, { recursive: true, force: true });
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
