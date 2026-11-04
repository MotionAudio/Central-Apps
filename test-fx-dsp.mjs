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
check("(10.4) every note value: dotted 1/8 at 120 bpm = 0.375 s, 1/8 triplet, 1/32, a whole note (Central Plugins); without it only 1/4 and 1/8", () => {
  const pl = (time, pro, extra) => core.plan({ on: true, delay: Object.assign({ on: true, send: 100, time, feedback: 0 }, extra || {}) }, pro, 120).delay.seconds;
  assert.equal(pl("1/8.", true), 0.375); assert.ok(Math.abs(pl("1/8T", true) - 1 / 6) < 1e-9); assert.equal(pl("1/32", true), 0.0625); assert.equal(pl("1/1", true), 2);
  assert.equal(pl("1/8.", false), 0.5, "basic: a quarter instead");
});
check("(10.4) a delay not synced plays its own time in ms (Central Plugins); a saved one with no sync setting stays synced", () => {
  const pl = (dl, pro) => core.plan({ on: true, delay: Object.assign({ on: true, send: 100, feedback: 0 }, dl) }, pro, 120).delay.seconds;
  assert.equal(pl({ time: "1/8", sync: false, ms: 300 }, true), 0.3);
  assert.equal(pl({ time: "1/8", sync: false, ms: 300 }, false), 0.25, "basic: synced");
  assert.equal(pl({ time: "1/8" }, true), 0.25, "no sync setting: synced");
  const n = rate, x = new Int16Array(n); x[0] = 16000; const p = core.plan({ on: true, delay: { on: true, send: 100, time: "1/4", sync: false, ms: 300, feedback: 0 } }, true, 120), r = core.processStem(x, null, n, rate, p);
  assert.ok(Math.abs(r.L[Math.round(rate * 0.3)]) > 1000, "a repeat at 0.3 s");
});
// (10.4) the note table every app uses (js/pedals.js): pedals, Central FX plugins
const PED = (await import("node:module")).createRequire(import.meta.url)(path.join(here, "js/pedals.js")), TP = PED.tempo;
check("(10.4) note lengths: 1/8 at 120 = 250 ms, dotted 1/8 = 375 ms, 1/4 triplet = 333 ms, 14 note values", () => {
  assert.equal(TP.ms("1/8", 120), 250); assert.equal(TP.ms("1/8.", 120), 375); assert.ok(Math.abs(TP.ms("1/4T", 120) - 1000 / 3) < 1e-9); assert.equal(TP.NOTES.length, 14);
});
check("(10.4) delay pedals synced: ms knobs (both sides of a stereo delay), seconds knobs, a BPM with its note list, Calf's subdivide, a fixed-note pedal's BPM", () => {
  assert.deepEqual(TP.pedalValues("gxdelay", "1/8.", 120), { timt_l: 375, timt_r: 375 });
  assert.deepEqual(TP.pedalValues("invada-delay", "1/4", 120), { delay1: 0.5 });
  assert.deepEqual(TP.pedalValues("digdelay", "1/8T", 90), { BPM: 90, NOTES: 8, SYNC: 0 });
  assert.deepEqual(TP.pedalValues("digdelay", "1/1", 72), { BPM: 36, NOTES: 1, SYNC: 0 }, "a whole note: a half at half the BPM");
  assert.deepEqual(TP.pedalValues("calfvdelay", "1/4T", 100), { bpm: 100, subdiv: 3, time_l: 2, time_r: 2 });
  assert.deepEqual(TP.pedalValues("ma-dotted-delay", "1/4", 120, () => ({ min: 50, max: 200 })), { bpm: 90 }, "its dotted eighth at 90 = a quarter at 120");
  assert.deepEqual(TP.pedalValues("ma-analog-delay", "1/1", 60, () => ({ min: 20, max: 600 })), { time: 600 }, "held to the knob's range");
  assert.equal(TP.pedalValues("booster", "1/8", 120), null, "not a delay");
  const missing = PED.pedals.filter((p) => p.category === "delay" && !TP.pedal(p)).map((p) => p.id).sort();
  assert.deepEqual(missing, ["gx-tape-st", "mbdelay", "mbecho", "mda-delay", "mda-dubdelay", "swh-delayorama", "swh-tape", "tap-echo", "zyn-echo"], "the delays without a time knob the app can set reliably");
});
check("(10.4) Central FX delays: the time knob found (flagged or by name), on a note; the tempo knob on by default; off keeps the knob", () => {
  const coll = (id) => JSON.parse(fs.readFileSync(path.join(here, "production/plugin-collection", id + ".cmfx.json"), "utf8"));
  ["simple-delay", "tape-echo", "ping-pong-delay"].forEach((id) => assert.equal((TP.pluginTime(coll(id)) || {}).id, "time", id));
  assert.equal(TP.pluginTime(coll("dotted-eighth")), null); assert.equal(TP.pluginTempo(coll("dotted-eighth")).id, "bpm");
  assert.deepEqual(TP.pluginValues(coll("simple-delay"), { time: 900 }, { syncNote: "1/8" }, 120), { time: 250 });
  assert.deepEqual(TP.pluginValues(coll("simple-delay"), { time: 900 }, {}, 120), { time: 900 });
  assert.equal(TP.pluginValues(coll("dotted-eighth"), {}, {}, 96).bpm, 96); assert.equal(TP.pluginValues(coll("dotted-eighth"), { bpm: 72 }, { syncTempo: false }, 96).bpm, 72);
});
// (10.4) Central Control: the shared delay's notes and a channel insert's knobs at the song's tempo (central-usage/app/mixer-model.js)
const MM = (await import("node:module")).createRequire(import.meta.url)(path.join(here, "central-usage/app/mixer-model.js"));
check("(10.4) Central Control: the shared delay on every note value; a channel insert's time knob on a note and its tempo knob", () => {
  assert.equal(MM.delayMs({ sync: "1/16d", bpm: 120 }), 187.5); assert.equal(MM.delayMs({ sync: "1/1", bpm: 120 }), 2000); assert.equal(MM.delayMs({ sync: "ms", ms: 420, bpm: 120 }), 420);
  const sd = JSON.parse(fs.readFileSync(path.join(here, "production/plugin-collection/simple-delay.cmfx.json"), "utf8")), de = JSON.parse(fs.readFileSync(path.join(here, "production/plugin-collection/dotted-eighth.cmfx.json"), "utf8"));
  assert.deepEqual(MM.insertValues({ values: { time: 900 }, syncNote: "1/8." }, sd, 100), { time: 450 });
  assert.equal(MM.insertValues({ values: {} }, de, 84).bpm, 84);
  const s = MM.create(); MM.apply(s, { op: "inserts", i: 0, list: [{ id: "simple-delay", values: { time: 500 }, syncNote: "1/4T" }, { id: "dotted-eighth", values: {}, syncTempo: false }] }, { role: "admin" });
  assert.equal(s.inputs[0].ins[0].syncNote, "1/4T"); assert.equal(s.inputs[0].ins[1].syncTempo, false);
});
check("a 60 s stereo track with every basic effect renders in under 6 s here (a Pi 4 is ~4x slower)", () => {
  const n = rate * 60, L = new Int16Array(n), R = new Int16Array(n); for (let i = 0; i < n; i++) { L[i] = (Math.random() - .5) * 8000; R[i] = (Math.random() - .5) * 8000; }
  const p = core.plan({ on: true, gate: { on: true, threshold: -50 }, eq: { on: true, lowCut: 80, low: 2, mid: -3, high: 3 }, comp: { on: true, amount: 40 }, reverb: { on: true, send: 20, type: "room" }, delay: { on: true, send: 15, time: "1/8" } }, false, 72);
  const t0 = Date.now(); core.processStem(L, R, n, rate, p); const ms = Date.now() - t0;
  console.log("      (" + ms + " ms for 60 s of stereo)"); assert.ok(ms < 6000);
});
if (failures) { console.error(failures + " failed"); process.exit(1); }
console.log("all passed");
