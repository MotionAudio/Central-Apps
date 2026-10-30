// The smart Auto lighting (app/lights-auto.js) without a window: the audio analysis on synthetic songs (a slow,
// quiet pad and drum grooves), the feel (Intimate / Mid / Upbeat) of songs and sections, the looks for every light
// in the example rig, the cues each feel allows, and the live layer.
//   node test-lights-auto.mjs
import { createRequire } from "node:module"; import assert from "node:assert";
import { pad, drums, songOverview, rng } from "./lights-synth.mjs";
const require = createRequire(import.meta.url), A = require("./app/lights-auto.js");
let failures = 0; async function check(label, fn) { try { await fn(); console.log("  ✓ " + label); } catch (e) { failures++; console.error("  ✗ " + label + "\n      " + String(e && e.message || e).split("\n").slice(0, 6).join("\n      ")); } }

// the example rig of lights.js (defaultRig), as kinds: what the engine sees for each light
const RIG = [["Front L", "front", "par"], ["Front R", "front", "par"], ["Back 1", "back", "par"], ["Back 2", "back", "par"], ["Back 3", "back", "par"], ["Back 4", "back", "par"],
  ["Mover L", "beam", "mover"], ["Mover R", "beam", "mover"], ["Blinder", "fx", "blinder"], ["House", "house", "par"], ["Hazer", "haze", "haze"], ["Bar L", "back", "bar"], ["Bar R", "back", "bar"], ["Strobe", "fx", "strobe"]]
  .map(([name, group, kind]) => ({ name, group, kind }));
const lit = (look, f) => { const p = A.partFor(look, f.group, f.kind); return !!(p && p.dim > 0); };

const rate = 22050, padAudio = A.analyseAudio(pad(60, rate), rate), drumAudio = A.analyseAudio(drums(30, 128, rate), rate);
console.log("The music, from the audio:");
await check("a 128 BPM groove: tempo 128 (±2), its 8th-note onsets, and it's percussive", () => {
  assert.ok(Math.abs(drumAudio.bpm - 128) <= 2, "bpm " + drumAudio.bpm);
  assert.ok(drumAudio.onsets.length >= 100 && drumAudio.onsets.length <= 140, "onsets " + drumAudio.onsets.length);
  assert.equal(drumAudio.percussive, true);
});
await check("other tempos: 92 and 150 BPM grooves read right (±2.5)", () => {
  for (const bpm of [92, 150]) { const a = A.analyseAudio(drums(30, bpm, rate, 7), rate); assert.ok(Math.abs(a.bpm - bpm) <= 2.5, bpm + " read as " + a.bpm); }
});
await check("a slow, quiet pad: no beat, no onsets from its swells or its notes beating, quiet", () => {
  assert.equal(padAudio.bpm, null); assert.ok(padAudio.onsets.length <= 3, "onsets " + padAudio.onsets.length); assert.equal(padAudio.percussive, false);
  assert.ok(padAudio.loudness < drumAudio.loudness - 8, padAudio.loudness + " vs " + drumAudio.loudness);
});

console.log("\nThe feel:");
await check("the pad is Intimate, the 128 BPM groove is Upbeat (from the audio alone)", () => {
  assert.equal(A.analyse(padAudio).style, "intimate"); assert.equal(A.analyse(drumAudio).style, "upbeat");
});
await check("from what the Central Pedal sends: a 68 BPM ballad with no drums is Intimate; 132 BPM with kick and snare hits is Upbeat; 100 BPM with a steady kick is Mid", () => {
  const ballad = songOverview([{ name: "Verse 1", len: 40, lvl: 0.25 }, { name: "Chorus", len: 40, lvl: 0.4 }]);
  assert.equal(A.analyse(Object.assign({ bpm: 68, key: "D" }, ballad)).style, "intimate");
  const up = songOverview([{ name: "Verse", len: 30, lvl: 0.5 }, { name: "Chorus", len: 30, lvl: 0.85 }]), beat = 60 / 132, kick = [], snare = [];
  for (let t = 0; t < 60; t += beat) { kick.push(t); snare.push(t + beat); t += beat; }
  assert.equal(A.analyse(Object.assign({ bpm: 132, key: "E", drumHits: { kick, snare, hat: [], crash: [] } }, up)).style, "upbeat");
  const midK = []; for (let t = 0; t < 60; t += 0.6) midK.push(t);
  assert.equal(A.analyse(Object.assign({ bpm: 100, key: "G", drumHits: { kick: midK, snare: [], hat: [], crash: [] } }, songOverview([{ name: "Verse", len: 30, lvl: 0.4 }, { name: "Chorus", len: 30, lvl: 0.6 }]))).style, "mid");
});
const worship = Object.assign({ bpm: 74, key: "Bb" }, songOverview([{ name: "Intro", len: 12, lvl: 0.15 }, { name: "Verse 1", len: 30, lvl: 0.3 }, { name: "Pre-Chorus", len: 14, lvl: 0.35, to: 0.65 }, { name: "Chorus", len: 28, lvl: 0.8 }, { name: "Bridge", len: 26, lvl: 0.55 }, { name: "Breakdown", len: 14, lvl: 0.18 }, { name: "Chorus", len: 28, lvl: 0.9 }, { name: "Outro", len: 12, lvl: 0.2 }]));
const anthem = Object.assign({ bpm: 128, key: "A", drumHits: { kick: [], snare: [], hat: [], crash: [] } }, songOverview([{ name: "Intro", len: 8, lvl: 0.4 }, { name: "Verse 1", len: 22, lvl: 0.55 }, { name: "Pre-Chorus", len: 8, lvl: 0.55, to: 0.8 }, { name: "Chorus", len: 22, lvl: 0.95 }, { name: "Breakdown", len: 8, lvl: 0.3 }, { name: "Chorus", len: 22, lvl: 1 }, { name: "Outro", len: 8, lvl: 0.5 }]));
for (let t = 0; t < anthem.duration; t += 60 / 128) anthem.drumHits.kick.push(Math.round(t * 1000) / 1000);
for (let t = 60 / 128; t < anthem.duration; t += 120 / 128) anthem.drumHits.snare.push(Math.round(t * 1000) / 1000);
anthem.drumHits.crash = [38, 60, 68.5]; anthem.hits = [30.2, 45.9, 60.1, 76.4]; worship.hits = [44.1, 50, 70.3, 84, 120.5];
const wa = A.analyse(worship), aa = A.analyse(anthem);
await check("each section's energy and trend: the chorus is the loudest, the breakdown the quietest, the pre-chorus builds", () => {
  const by = (a, n) => a.sections.find((s) => s.name === n);
  assert.ok(by(wa, "Chorus").energy >= 0.85 && by(wa, "Breakdown").energy <= 0.25, JSON.stringify(wa.sections.map((s) => [s.name, s.energy])));
  assert.equal(by(wa, "Pre-Chorus").trend, "build"); assert.equal(by(aa, "Pre-Chorus").trend, "build");
});
await check("sections lean with their energy but never two steps from their song: an intimate song's chorus is Mid at most, an upbeat song's breakdown Mid at least", () => {
  assert.equal(wa.style, "intimate"); assert.equal(aa.style, "upbeat");
  assert.ok(wa.sections.every((s) => s.style !== "upbeat"), JSON.stringify(wa.sections.map((s) => [s.name, s.style])));
  assert.ok(aa.sections.every((s) => s.style !== "intimate"), JSON.stringify(aa.sections.map((s) => [s.name, s.style])));
  assert.equal(aa.sections.find((s) => s.name === "Chorus").style, "upbeat");
  assert.equal(wa.sections.find((s) => s.name === "Breakdown").style, "intimate");
});
await check("the feel can be set for the song and for one section (the rest follow)", () => {
  const set = A.analyse(worship, { song: "upbeat", sections: { "84": "intimate" } });
  assert.equal(set.style, "upbeat"); assert.equal(set.detected, "intimate"); assert.equal(set.overridden, true);
  const ch = set.sections.find((s) => Math.abs(s.start - 84) < 1e-6); assert.equal(ch.style, "intimate"); assert.equal(ch.overridden, true);
});
await check("the same song always gets the same show; songs in different keys get different colours", () => {
  assert.deepEqual(JSON.stringify(A.buildLooks(A.analyse(anthem))), JSON.stringify(A.buildLooks(A.analyse(anthem))));
  const g = A.paletteFor(A.parseKey("G"), "mid"), d = A.paletteFor(A.parseKey("D"), "mid"), em = A.paletteFor(A.parseKey("Em"), "mid");
  assert.notEqual(g.main, d.main); assert.notEqual(g.main, em.main);
});

console.log("\nThe looks, for every light in the rig:");
const barBeatAt = (bpm) => (t) => { const b = t / (60 / bpm); return { bar: Math.floor(b / 4) + 1, beat: (b % 4) + 1 }; };
const wb = A.buildLooks(wa), ab = A.buildLooks(aa);
const wc = A.cues(wa, wb, worship, barBeatAt(74)), ac = A.cues(aa, ab, anthem, barBeatAt(128));
const usedLooks = (built, cues) => cues.map((c) => built.looks[c.look]).filter(Boolean);
await check("an upbeat song uses every light: front, washes, movers, pixel bars, blinder, house, haze and the strobe (on its big hits)", () => {
  const looks = usedLooks(ab, ac), dark = RIG.filter((f) => !looks.some((l) => lit(l, f))).map((f) => f.name);
  assert.deepEqual(dark, []);
});
await check("an intimate song uses every light but the strobe, which never fires: no strobe in any look, no white hits, no kicks", () => {
  const looks = usedLooks(wb, wc), dark = RIG.filter((f) => !looks.some((l) => lit(l, f))).map((f) => f.name);
  assert.deepEqual(dark, ["Strobe"]);
  assert.ok(wc.filter((c) => c.kind === "flash").every((c) => c.look === wb.flash.swell), JSON.stringify(wc.filter((c) => c.kind === "flash").map((c) => c.look)));
  assert.ok(!wc.some((c) => c.drum));
});
await check("faces stay lit: the front lights are at least half up in every section of both songs", () => {
  for (const b of [wb, ab]) for (const s of b.sections) { const l = b.looks[s.look]; assert.ok(l.g.front.dim >= 0.5, l.name + " front " + l.g.front.dim); }
});
await check("intimate: warm, slow fades (4+ beats), movers drift slowly over the stage; upbeat: quick fades, movers move out over the room in the chorus, bars chase, washes swap two colours", () => {
  for (const s of wb.sections) { const l = wb.looks[s.look]; if (l.style !== "intimate") continue; assert.ok(l.fade >= 4, l.name + " fade " + l.fade); assert.ok(l.k.mover.tilt <= 0.35 && l.k.mover.speed >= 8, l.name + " movers"); assert.equal(l.k.strobe.dim, 0); }
  const ch = ab.looks[ab.sections[3].look]; assert.equal(ch.style, "upbeat");
  assert.ok(ch.fade <= 1); assert.ok(["ballyhoo", "circle"].includes(ch.k.mover.fx) && ch.k.mover.tilt >= 0.5); assert.equal(ch.k.bar.fx, "chase"); assert.equal(ch.g.back.fx, "alternate"); assert.ok(ch.g.back.color2);
});
await check("the hits each feel allows: intimate = a warm swell at most every 16 beats; upbeat = white hits, crashes hit, kicks bump the colour only in big sections", () => {
  const sw = wc.filter((c) => c.look === wb.flash.swell).map((c) => (c.bar - 1) * 4 + c.beat);
  for (let i = 1; i < sw.length; i++) assert.ok(sw[i] - sw[i - 1] >= 16, "swells too close " + sw);
  assert.ok(ac.some((c) => c.look === ab.flash.hit && c.label === "Hit")); assert.ok(ac.some((c) => c.drum === "crash"));
  const kicks = ac.filter((c) => c.drum === "kick"); assert.ok(kicks.length > 20);
  const quiet = aa.sections.find((s) => s.name === "Breakdown"); assert.ok(!kicks.some((c) => { const t = ((c.bar - 1) * 4 + c.beat - 1) * 60 / 128; return t >= quiet.start && t < quiet.end; }), "kicks in the breakdown");
  assert.equal(ab.looks[ab.flash.hit].k.strobe.dim, 1); assert.ok(!ab.looks[ab.flash.soft].k.strobe);
});

console.log("\nThe live layer:");
await check("intimate: no beat pulse, the level is followed slowly and gently; upbeat: a bump on every beat, the level followed quickly", () => {
  const run = (style, beatFrac, level, frames) => { const ctx = { style, energy: 0.6, trend: "steady", level, beatFrac, playing: true, dt: 0.025, state: { level: 0 } }; let m; for (let i = 0; i < frames; i++) { m = A.liveMod(ctx); } m.followed = ctx.state.level; return m; };
  const i0 = run("intimate", 0, 1, 1), i5 = run("intimate", 0.5, 1, 1); assert.equal(i0.back, i5.back);
  const u0 = run("upbeat", 0, 1, 1), u5 = run("upbeat", 0.5, 1, 1); assert.ok(u0.back > u5.back * 1.15, u0.back + " vs " + u5.back);
  // the music jumps up: 0.1 s later the upbeat lights have mostly followed, the intimate ones hardly
  const iSlow = run("intimate", 0.5, 1, 4), uFast = run("upbeat", 0.5, 1, 4); assert.ok(uFast.followed > 0.5 && iSlow.followed < 0.1, uFast.followed + " vs " + iSlow.followed);
  assert.ok(run("intimate", 0.5, 0, 200).back >= 0.8, "intimate never drops far");
});
await check("a build rises through its section; faces barely move with the music", () => {
  const at = (p) => A.liveMod({ style: "upbeat", trend: "build", progress: p, level: null, beatFrac: 0.5, playing: true, state: {} });
  assert.ok(at(1).back > at(0).back * 1.4 && at(1).mover > at(0).mover * 1.4, at(0).back + " -> " + at(1).back); assert.equal(at(0.5).front, 1);
  const f = A.liveMod({ style: "upbeat", level: 0, beatFrac: 0.5, playing: true, dt: 1, state: {} }); assert.ok(f.front >= 0.85, "front " + f.front);
});
await check("from live audio: intimate sections never flash on onsets; mid gets a soft hit; upbeat a white one when it's big", () => {
  assert.equal(A.onsetFlash("intimate", 1), null); assert.equal(A.onsetFlash("mid", 1), "soft"); assert.equal(A.onsetFlash("upbeat", 0.9), "hit"); assert.equal(A.onsetFlash("upbeat", 0.3), "soft");
});

console.log("\n10.0 - the beat, the song's shape, the words, the rig, no flicker, safe strobes:");
await check("where the beats fall: the 128 BPM groove's beat grid lines up with its kicks (within 40 ms)", () => {
  const P = 60 / 128, off = drumAudio.beatOffset; assert.ok(off != null, "no grid");
  const d = Math.min(off % P, P - (off % P)); assert.ok(d < 0.04, "offset " + off);   // (the onset detector reads about 30 ms late, the same on every beat)
  assert.ok(drumAudio.gridConfidence > 0.3, "confidence " + drumAudio.gridConfidence);
});
await check("live beat tracking (a band, no timeline): 120 BPM onsets with ±10 ms of human timing give 120 (±2) and the beat lands on them", () => {
  const bt = A.beatTracker(), r = rng(3);
  for (let t = 0.2; t < 12; t += 0.5) { bt.onset(t + (r() - 0.5) * 0.02, 1); if (r() < 0.5) bt.onset(t + 0.25 + (r() - 0.5) * 0.02, 0.4); }
  const s = bt.at(12.2); assert.ok(s && Math.abs(s.bpm - 120) <= 2, JSON.stringify(s));
  assert.ok(s.beatFrac < 0.12 || s.beatFrac > 0.88, "beatFrac " + s.beatFrac);
});
await check("a recording with no section markers is split by its sound: quiet start = Intro, the loud parts = Chorus, never shorter than 8 bars", () => {
  const rec = Object.assign({ bpm: 120, key: "G" }, songOverview([{ name: "a", len: 16, lvl: 0.15 }, { name: "b", len: 32, lvl: 0.35 }, { name: "c", len: 32, lvl: 0.85 }, { name: "d", len: 32, lvl: 0.35 }, { name: "e", len: 32, lvl: 0.9 }, { name: "f", len: 16, lvl: 0.12 }]));
  delete rec.sections; const an = A.analyse(rec);
  assert.equal(an.sectionsFromAudio, true); const types = an.sections.map((s) => s.type);
  assert.equal(types[0], "intro"); assert.equal(types[types.length - 1], "outro"); assert.ok(types.filter((t) => t === "chorus").length >= 2, JSON.stringify(an.sections.map((s) => [s.name, s.start, s.end])));
  assert.ok(an.sections.every((s) => s.end - s.start >= 16 - 0.5), "a short piece");
  assert.ok(!A.analyse(Object.assign({}, padAudio)).sectionsFromAudio, "a 60 s pad isn't split");
});
const shape = Object.assign({ bpm: 132, key: "D", drumHits: { kick: [], snare: [], hat: [], crash: [] } }, songOverview([{ name: "Verse 1", len: 24, lvl: 0.5 }, { name: "Pre", len: 8, lvl: 0.55, to: 0.85 }, { name: "Chorus", len: 24, lvl: 0.9 }, { name: "Verse 2", len: 24, lvl: 0.5 }, { name: "Chorus", len: 24, lvl: 0.9 }, { name: "Bridge", len: 24, lvl: 0.6 }, { name: "Chorus", len: 24, lvl: 0.35 }, { name: "Build", len: 8, lvl: 0.5, to: 0.9 }, { name: "Chorus", len: 24, lvl: 1 }]));
for (let t = 0; t < shape.duration; t += 60 / 132) shape.drumHits.kick.push(Math.round(t * 1000) / 1000);
shape.sections[1].type = "prechorus"; shape.sections[7].type = "prechorus";
const sa = A.analyse(shape), sb = A.buildLooks(sa), sc = A.cues(sa, sb, shape, barBeatAt(132));
await check("the song's shape: each chorus a little bigger, a quiet chorus after the bridge is lit softly, the last one is the peak", () => {
  const ch = sa.sections.filter((s) => s.type === "chorus");
  assert.ok(ch[1].energy > ch[0].energy, ch.map((c) => c.energy)); assert.equal(ch[2].down, true); assert.notEqual(ch[2].style, "upbeat");
  assert.equal(ch[3].peak, true); assert.ok(!ch[0].peak && !ch[1].peak);
  const pk = sb.looks[sb.sections[8].look]; assert.ok(pk.k.mover.tilt >= 0.58 && pk.fade === 0, JSON.stringify(pk.k.mover) + " fade " + pk.fade);
});
await check("...and the breath before the peak: half a beat of dark just before it lands (upbeat, after a build)", () => {
  const dips = sc.filter((c) => c.label === "Dip"); assert.equal(dips.length, 1);
  const t = ((dips[0].bar - 1) * 4 + dips[0].beat - 1) * 60 / 132; assert.ok(Math.abs(sa.sections[8].start - t - 0.5 * 60 / 132) < 0.02, t);
});
await check("the words: a section with sung lines keeps faces a little brighter, an instrumental one lets the colour carry it (faces still half up)", () => {
  const w = Object.assign({}, worship, { words: [{ t: 15, text: "Holy" }, { t: 20, text: "is" }, { t: 60, text: "the Lamb" }, { beat: 0, text: "" }] });
  const an = A.analyse(w), b = A.buildLooks(an), v = an.sections.findIndex((s) => s.name === "Verse 1"), br = an.sections.findIndex((s) => s.name === "Bridge");
  assert.equal(an.sections[v].sung, true); assert.equal(an.sections[br].instrumental, true);
  const lv = b.looks[b.sections[v].look].g.front.dim, lb = b.looks[b.sections[br].look].g.front.dim, plain = A.buildLooks(A.analyse(worship));
  assert.ok(lv > plain.looks[plain.sections[v].look].g.front.dim, "sung " + lv); assert.ok(lb >= 0.5 && lb < plain.looks[plain.sections[br].look].g.front.dim, "instrumental " + lb);
});
await check("every rig: no front lights - the washes carry warm white; no movers or bars - the washes take the movement in the big parts", () => {
  const noFront = A.buildLooks(aa, "x", RIG.filter((f) => f.group !== "front")), chorus = noFront.looks[noFront.sections[3].look];
  assert.ok(chorus.g.back.w > 0 && chorus.g.back.dim >= 0.45, JSON.stringify(chorus.g.back));
  const plainRig = A.buildLooks(aa, "y", RIG.filter((f) => f.kind !== "mover" && f.kind !== "bar")), ch2 = plainRig.looks[plainRig.sections[3].look];
  assert.equal(ch2.g.back.fx, "alternate"); assert.ok(ch2.g.back.color2);
});
await check("safe flashing: never more than 3 flashes a second, whatever the song throws at it - the hit wins over a kick at the same moment", () => {
  const busy = Object.assign({}, anthem, { hits: [] }); for (let t = 31; t < 52; t += 0.1) busy.hits.push(Math.round(t * 100) / 100);
  const bc = A.cues(aa, ab, busy, barBeatAt(128)).filter((c) => c.kind === "flash").map((c) => ({ t: ((c.bar - 1) * 4 + c.beat - 1) * 60 / 128, l: c.label })).sort((x, y) => x.t - y.t);
  for (let i = 1; i < bc.length; i++) assert.ok(bc[i].t - bc[i - 1].t >= 1 / 3 - 1e-6, "too close at " + bc[i].t);
  assert.ok(bc.some((c) => c.l === "Hit"));
  assert.equal(A.safeHz(20), 3); assert.equal(A.safeHz(20, false), 20);
  const st = {}; assert.ok(A.burstAllowed(st, 0)); assert.ok(A.burstAllowed(st, 1500)); assert.ok(!A.burstAllowed(st, 2100), "burst longer than 2 s"); assert.ok(!A.burstAllowed(st, 9000), "rest"); assert.ok(A.burstAllowed(st, 10200));
  const g = {}; assert.ok(A.flashGate(g, 0, "upbeat")); assert.ok(!A.flashGate(g, 200, "upbeat")); assert.ok(A.flashGate(g, 400, "upbeat")); assert.ok(!A.flashGate(g, 800, "mid"));
});
await check("no flicker: a level that jumps up and down every frame moves an intimate song's lights only a little; a steady one doesn't twitch", () => {
  const ctx = { style: "intimate", energy: 0.5, trend: "steady", beatFrac: 0, playing: true, dt: 0.025, state: {} };
  let prev = null, worst = 0;
  for (let i = 0; i < 200; i++) { ctx.level = i % 2; ctx.tau = 0; const m = A.liveMod(ctx); if (prev) worst = Math.max(worst, Math.abs(m.back - prev.back)); prev = m; }
  assert.ok(worst <= 0.6 * 0.025 + 0.011, "moved " + worst);
  const c2 = { style: "upbeat", energy: 0.5, trend: "steady", level: 0.5, beatFrac: 0.5, playing: true, dt: 0.025, state: {} }; let a1 = A.liveMod(c2); c2.level = 0.505; const a2 = A.liveMod(c2); assert.equal(a1.back, a2.back);
});

console.log(failures ? "\n" + failures + " CHECK(S) FAILED" : "\nALL LIGHTS AUTO CHECKS PASSED");
process.exit(failures ? 1 : 0);
