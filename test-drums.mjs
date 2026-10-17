// Drum transcription (analysis-worker drumsOf) on a synthetic kit with a known groove - run with node.
import fs from "node:fs"; import path from "node:path"; import vm from "node:vm"; import assert from "node:assert"; import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const sb = { window: {}, Math, Float32Array, Int16Array, Int8Array, Uint8Array, Array, JSON, console }; sb.globalThis = sb; vm.createContext(sb);
vm.runInContext(fs.readFileSync(path.join(here, "js/analysis-worker.js"), "utf8"), sb);
let reply = null; const scope = { postMessage: (m) => { reply = m; } }; vm.createContext(Object.assign(scope, { Math, Float32Array, Int16Array, Int8Array, Uint8Array, Array, JSON, console }));
vm.runInContext("(" + sb.window.PP_ANALYSIS_WORKER.toString() + ")()", scope);
const run = (cmd, mono, rate, opts) => { reply = null; scope.onmessage({ data: { cmd, id: 1, mono, rate, opts } }); if (reply.error) throw new Error(reply.error); return reply.result; };

const rate = 44100, bpm = 120, beat = 60 / bpm, bars = 4, first = 0.5, len = Math.ceil((first + bars * 4 * beat + 2) * rate), x = new Float32Array(len);
let seed = 7; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff * 2 - 1; };
function add(at, fn, dur) { const s = Math.round(at * rate); for (let i = 0; i < dur * rate && s + i < len; i++) x[s + i] += fn(i / rate); }
const kick = (t) => 0.9 * Math.sin(2 * Math.PI * (45 * t + (65 / 18) * (1 - Math.exp(-18 * t)))) * Math.exp(-t / 0.12);
const snare = (t) => (0.5 * rnd() * Math.exp(-t / 0.09) + 0.4 * Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t / 0.07));
let hp = 0, last = 0; const hiss = (decay, amp, a = 0.6) => (t) => { const n = rnd(); hp = a * (hp + n - last); last = n; return amp * hp * Math.exp(-t / decay); };   // high-passed noise (cymbals)
const want = { kick: [], snare: [], hat: [], crash: [] };
for (let b = 0; b < bars; b++) for (let q = 0; q < 8; q++) {
  const bt = b * 4 + q / 2, t = first + bt * beat;
  if (q === 0 && b === 2) { add(t, hiss(0.9, 0.6, 0.7), 2); want.crash.push(bt); } else { add(t, hiss(0.035, 0.3), 0.15); want.hat.push(bt); }
  if (q === 0 || q === 4) { add(t, kick, 0.4); want.kick.push(bt); }
  if (q === 2 || q === 6) { add(t, snare, 0.3); want.snare.push(bt); }
}
let failures = 0; function check(label, fn) { try { fn(); console.log("  ✓ " + label); } catch (e) { failures++; console.error("  ✗ " + label + "\n      " + e.message); } }
const got = run("drums", x, rate, { grid: { period: beat, first } });
function score(v) { const g = new Set(got[v]), w = new Set(want[v]); let hit = 0; w.forEach((b) => { if (g.has(b)) hit++; }); const extra = [...g].filter((b) => !w.has(b)).length; return { recall: hit / w.size, extra, got: got[v], want: want[v] }; }
check("kicks found on 1 and 3 of every bar", () => { const s = score("kick"); assert.ok(s.recall === 1 && s.extra <= 1, JSON.stringify(s)); });
check("snares found on 2 and 4", () => { const s = score("snare"); assert.ok(s.recall >= 0.85 && s.extra <= 2, JSON.stringify(s)); });
check("hi-hats on the eighths (all of those away from the snare and the crash ring, no false hits)", () => { const s = score("hat"), off = want.hat.filter((b) => !want.snare.includes(b) && !want.crash.some((c) => b > c && b < c + 4)); assert.ok(off.every((b) => got.hat.includes(b)) && s.extra <= 3, JSON.stringify(s)); });
check("the crash is told apart from the hats", () => { assert.ok(got.crash.includes(8), JSON.stringify(got.crash)); });
console.log(failures ? "\n" + failures + " CHECK(S) FAILED" : "\nALL DRUM CHECKS PASSED"); process.exit(failures ? 1 : 0);
