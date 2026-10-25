#!/usr/bin/env node
/* Central Pedal - track effects maths (js/fx-dsp.js): EQ, gate, compressor, reverb, delay, the plan locks, speed.
 *   node test-fx-dsp.mjs */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const here = path.dirname(fileURLToPath(import.meta.url));
const w = {};
new Function("window", fs.readFileSync(path.join(here, "js/fx-dsp.js"), "utf8"))(w);
const core = w.PP_FX_CORE(), rate = 48000;
let failures = 0;
function check(label, fn) { try { fn(); console.log("  ✓ " + label); } catch (e) { failures++; console.error("  ✗ " + label + "\n      " + e.message); } }
function tone(f, sec, amp) { const n = Math.round(rate * sec), a = new Int16Array(n); for (let i = 0; i < n; i++) a[i] = Math.round(Math.sin(2 * Math.PI * f * i / rate) * amp * 32767); return a; }
function rms(a, from = 0) { let s = 0; for (let i = from; i < a.length; i++) s += (a[i] / 32768) ** 2; return Math.sqrt(s / (a.length - from)); }
function gainDb(fx, f, amp = 0.25, pro = false) { const x = tone(f, 1, amp), p = core.plan(fx, pro, 72), r = core.processStem(x, null, x.length, rate, p); return 20 * Math.log10(rms(r.L, 9600) / rms(x, 9600)); }
const near = (v, want, tol, what) => assert.ok(Math.abs(v - want) <= tol, what + ": " + v.toFixed(2) + " dB, wanted " + want + " ± " + tol);

console.log("Track effects (DSP)");
check("EQ low +6 dB lifts 60 Hz by ~6 dB", () => near(gainDb({ on: true, eq: { on: true, low: 6 } }, 60), 6, 0.6, "low shelf"));
check("EQ high -6 dB cuts 14 kHz by ~6 dB", () => near(gainDb({ on: true, eq: { on: true, high: -6 } }, 14000), -6, 0.6, "high shelf"));
check("EQ mid +6 dB at 1 kHz", () => near(gainDb({ on: true, eq: { on: true, mid: 6, midFreq: 1000 } }, 1000), 6, 0.3, "peak"));
check("EQ low cut 200 Hz takes 100 Hz down", () => assert.ok(gainDb({ on: true, eq: { on: true, lowCut: 200 } }, 100) < -9));
check("EQ leaves 1 kHz alone with only a low cut", () => near(gainDb({ on: true, eq: { on: true, lowCut: 80 } }, 1000), 0, 0.3, "flat"));
check("compressor turns a loud track down", () => assert.ok(gainDb({ on: true, comp: { on: true, amount: 80 } }, 1000, 0.9) < -3));
check("compressor leaves a quiet track (nearly) as it is", () => assert.ok(gainDb({ on: true, comp: { on: true, amount: 80 } }, 1000, 0.01) > 0));
check("gate silences what is under the threshold", () => assert.ok(gainDb({ on: true, gate: { on: true, threshold: -40 } }, 1000, 0.001) < -40));
check("gate lets loud parts through", () => near(gainDb({ on: true, gate: { on: true, threshold: -40 } }, 1000, 0.3), 0, 0.5, "open gate"));
check("reverb adds a tail and makes a mono track stereo", () => {
  const n = rate, x = new Int16Array(n); for (let i = 0; i < 2400; i++) x[i] = Math.round(Math.sin(i / 7) * 16000);
  const r = core.processStem(x, null, n, rate, core.plan({ on: true, reverb: { on: true, send: 60, type: "room" } }, false, 72));
  assert.ok(r.R, "stereo"); assert.ok(rms(r.L, 12000) > 1e-4, "tail");
  let diff = 0; for (let i = 12000; i < n; i++) diff += Math.abs(r.L[i] - r.R[i]); assert.ok(diff > 0, "wide");
});
check("delay repeats on the beat (1/4 at 120 bpm = 0.5 s)", () => {
  const n = rate * 2, x = new Int16Array(n); x[0] = 20000;
  const p = core.plan({ on: true, delay: { on: true, send: 100, time: "1/4", feedback: 0 } }, false, 120), r = core.processStem(x, null, n, rate, p);
  assert.equal(p.delay.seconds, 0.5); assert.ok(Math.abs(r.L[rate / 2]) > 1000, "a repeat at 0.5 s");
});
check("without Central Plugins the better ones fall back to the basics", () => {
  const fx = { on: true, eq: { on: true, highCut: 8000, bands: [{ on: true, gain: 6, freq: 300 }] }, comp: { on: true, mode: "full", threshold: -40, ratio: 20 }, reverb: { on: true, send: 30, type: "cathedral" }, delay: { on: true, send: 30, time: "1/8.", pingpong: true } };
  const basic = core.plan(fx, false, 72), pro = core.plan(fx, true, 72);
  assert.equal(basic.eq.length, 0, "no parametric bands / high cut"); assert.equal(pro.eq.length, 2);
  assert.equal(basic.reverb.type, "room"); assert.equal(pro.reverb.type, "cathedral");
  assert.equal(basic.delay.pingpong, false); assert.equal(pro.delay.pingpong, true);
  assert.equal(basic.delay.seconds, 60 / 72); assert.equal(pro.delay.seconds, 60 / 72 * 0.75);
  assert.notEqual(basic.comp.ratio, 20); assert.equal(pro.comp.ratio, 20);
});
check("effects off = nothing to do", () => { assert.equal(core.plan({ on: false, eq: { on: true, low: 6 } }, true, 72), null); assert.equal(core.plan({ on: true }, true, 72), null); });
check("a 60 s stereo track with every basic effect renders in under 6 s here (a Pi 4 is ~4x slower)", () => {
  const n = rate * 60, L = new Int16Array(n), R = new Int16Array(n); for (let i = 0; i < n; i++) { L[i] = (Math.random() - .5) * 8000; R[i] = (Math.random() - .5) * 8000; }
  const p = core.plan({ on: true, gate: { on: true, threshold: -50 }, eq: { on: true, lowCut: 80, low: 2, mid: -3, high: 3 }, comp: { on: true, amount: 40 }, reverb: { on: true, send: 20, type: "room" }, delay: { on: true, send: 15, time: "1/8" } }, false, 72);
  const t0 = Date.now(); core.processStem(L, R, n, rate, p); const ms = Date.now() - t0;
  console.log("      (" + ms + " ms for 60 s of stereo)"); assert.ok(ms < 6000);
});
if (failures) { console.error(failures + " failed"); process.exit(1); }
console.log("all passed");
