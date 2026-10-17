// Lyrics heard in a vocal track (asr.js + js/lyrics-ai.js). The listening part downloads the speech model the
// first time (about 500 MB, or set ASR_MODEL=fast); skip it with NO_MODEL=1.
import fs from "node:fs"; import path from "node:path"; import os from "node:os"; import vm from "node:vm"; import assert from "node:assert"; import { execFileSync } from "node:child_process"; import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const shared = fs.existsSync(path.join(here, "app/shared/lyrics-ai.js")) ? path.join(here, "app/shared/lyrics-ai.js") : path.join(here, "../js/lyrics-ai.js");
const sb = { console, Math, JSON, Float32Array, Array, Promise, setTimeout }; sb.globalThis = sb; vm.createContext(sb);
vm.runInContext(fs.readFileSync(shared, "utf8"), sb); const L = sb.PPLyricsAI;
let failures = 0; async function check(label, fn) { try { await fn(); console.log("  ✓ " + label); } catch (e) { failures++; console.error("  ✗ " + label + "\n      " + String(e.message || e).split("\n").slice(0, 8).join("\n      ")); } }

await check("the lyric chart: lines split at breaths, each chord on the word it lands on, chord bars where nobody sings", () => {
  const W = (t, s, e) => ({ text: t, start: s, end: e });
  const words = [W("Amazing", 4, 4.5), W("grace", 4.5, 5), W("how", 5.2, 5.4), W("sweet", 5.4, 5.8), W("the", 5.8, 6), W("sound", 6, 6.8), W("That", 8.2, 8.4), W("saved", 8.4, 8.8), W("a", 8.8, 8.9), W("wretch", 8.9, 9.4), W("like", 9.4, 9.6), W("me", 9.6, 10.4)];
  const chords = [{ start: 0, label: "G" }, { start: 2, label: "C" }, { start: 4, label: "G" }, { start: 5.2, label: "C" }, { start: 8.2, label: "G" }, { start: 9.6, label: "D" }];
  const text = L.chartFromWords(words, { title: "Amazing Grace", key: "G", chords, sections: [{ name: "Intro", start: 0 }, { name: "Verse 1", start: 3.9 }] });
  assert.match(text, /\{title: Amazing Grace\}/); assert.match(text, /\[Intro\]\n\| G \| C \|/);
  assert.match(text, /\[Verse 1\]\n\[G\]Amazing grace \[C\]how sweet the sound\n\[G\]That saved a wretch like \[D\]me/);
});
await check("only where someone sings goes to the model (a quiet vocal track is mostly skipped)", () => {
  const rate = 16000, x = new Float32Array(rate * 30); for (let i = rate * 5; i < rate * 9; i++) x[i] = 0.3 * Math.sin(i / 7); for (let i = rate * 20; i < rate * 21; i++) x[i] = 0.3 * Math.sin(i / 5);
  const parts = L.voiced(x, rate); assert.equal(parts.length, 2); assert.ok(Math.abs(parts[0].start - 4.65) < 0.1 && Math.abs(parts[0].end - 9.35) < 0.1, JSON.stringify(parts));
});
if (process.env.NO_MODEL) { console.log("  (speech model check skipped)"); }
else await check("the speech model hears the words, with their times (synthetic voice)", async () => {
  const { setupAsr } = await import(path.join(here, "asr.js"));
  const handlers = {}, tmp = fs.mkdtempSync(path.join(os.tmpdir(), "asr-"));
  const models = process.env.ASR_MODELS_DIR; // reuse a downloaded model between runs
  setupAsr({ ipcMain: { handle: (n, f) => { handlers[n] = f; } }, app: { getPath: () => models || tmp }, getWin: () => null });
  await handlers["asr-config"](null, { model: process.env.ASR_MODEL || "accurate", language: "english" });
  sb.CU = { asr: { run: (job) => handlers["asr-run"](null, job) } };
  const wav = path.join(tmp, "v.wav"); execFileSync("espeak-ng", ["-s", "140", "-w", wav, "Amazing grace how sweet the sound that saved a wretch like me"]);
  const b = fs.readFileSync(wav), rate = b.readUInt32LE(24), at = b.indexOf("data") + 8, n = (b.length - at) / 2, pad = rate * 3, mono = new Float32Array(n + pad * 2);
  for (let i = 0; i < n; i++) mono[pad + i] = b.readInt16LE(at + i * 2) / 32768;   // 3 s of silence before and after, like a vocal track
  const words = await L.listen(mono, rate, null);
  const text = words.map((w) => w.text.toLowerCase().replace(/[^a-z]/g, "")).join(" ");
  assert.match(text, /amazing grace how sweet the sound/, text); assert.match(text, /wretch like me/, text);
  assert.ok(words[0].start >= 2.5 && words[0].start <= 3.6, "times are in the track's own time: " + words[0].start);
});
console.log(failures ? "\n" + failures + " CHECK(S) FAILED" : "\nALL LYRICS CHECKS PASSED"); process.exit(failures ? 1 : 0);
