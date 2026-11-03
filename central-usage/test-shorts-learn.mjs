// Shorts (10.3): learning what a church likes. Synthetic churches give feedback through the same lessons the review
// screen records; their picks must move the right way, their habits must show in plain words, Reset must start over,
// and a church with no lessons must pick exactly like the starting model.
//   node central-usage/test-shorts-learn.mjs
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import assert from "node:assert";
import { createRequire } from "node:module"; import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url)), require = createRequire(import.meta.url);
const LEARN = require("./shorts/learn.js"), P = require("./shorts/pick.js"), AI = require("./shorts/ai.js");
let failures = 0; async function check(label, fn) { try { await fn(); console.log("  ✓ " + label); } catch (e) { failures++; console.error("  ✗ " + label + "\n      " + String(e && e.stack || e).split("\n").slice(0, 4).join("\n      ")); } }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cu-learn-"));
let seed = 11; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

// candidates like the picker's: a mix of stories, scripture explanations, punchy "you" lines, announcements; worship
// choruses / bridges / last choruses
function sermonCand(i, o) {
  const parts = Object.assign({ text: 0.35 + rnd() * 0.4, energy: rnd(), response: rnd() < 0.2 ? rnd() : 0, pause: rnd(), strong: rnd() * 0.6, you: rnd() * 0.6, contrast: rnd() < 0.3 ? 1 : 0, story: 0, question: rnd() < 0.3 ? 1 : 0, scripture: 0, admin: 0, punchy: rnd() * 0.5, weakStart: 0 }, o || {});
  const rule = parts.text * 0.6 + parts.energy * 0.15 + parts.response * 0.15 + parts.pause * 0.1;
  return { kind: "sermon", start: 600 + i * 70, end: 600 + i * 70 + 35 + rnd() * 20, rule, score: rule, ai: 0.3 + rnd() * 0.5, parts, id: "c" + i };
}
function worshipCand(i, label) {
  const lab = label.toLowerCase(), parts = { peak: rnd(), late: rnd(), room: rnd() * 0.5, bonus: /bridge/.test(lab) ? 0.12 : /last/.test(lab) ? 0.18 : 0.05, chorus: /chorus/.test(lab) ? 1 : 0, bridge: /bridge/.test(lab) ? 1 : 0, lastChorus: /last/.test(lab) ? 1 : 0, tag: 0 };
  const rule = 0.3 + parts.peak * 0.35 + parts.late * 0.15 + parts.bonus + parts.room * 0.05;
  return { kind: "worship", songIndex: i % 4, label, start: i * 100, end: i * 100 + 40, rule, score: rule, parts, id: "w" + i };
}
function service(n) {
  const out = [];
  for (let i = 0; i < n; i++) { const k = i % 4; out.push(sermonCand(i, k === 0 ? { story: 1 } : k === 1 ? { scripture: 1 } : k === 2 ? { admin: rnd() < 0.5 ? 0.5 : 0 } : {})); }
  for (let i = 0; i < 8; i++) out.push(worshipCand(i, ["Chorus", "Bridge", "Last chorus", "Verse"][i % 4]));
  return out;
}
const top = (L, cands, kind, k) => cands.filter((c) => c.kind === kind).map((c) => ({ c, s: L ? L.score(c, {}) : LEARN.baseScore(c, {}) })).sort((a, b) => b.s - a.s).slice(0, k).map((x) => x.c);
const share = (list, f) => list.filter(f).length / Math.max(1, list.length);
// a church reviews a service's shorts: it keeps what it likes, deletes the rest (with a reason), trims, posts
function review(L, cands, likes, opts) {
  const S = {}; opts = opts || {};
  for (const c of top(L, cands, "sermon", 6).concat(top(L, cands, "worship", 3))) {
    const sh = { id: c.id + ":" + rnd().toString(36).slice(2, 7), kind: c.kind, start: c.start, end: c.end, features: LEARN.features(c, S) };
    const base = { shortId: sh.id, kind: sh.kind, x: sh.features, len: sh.end - sh.start };
    if (opts.trim && c.kind === "sermon") { L.record(Object.assign({ type: "trim", dStart: -2, dEnd: 1.5 }, base)); }
    if (likes(c)) { L.record(Object.assign({ type: "approve", edited: !!opts.trim }, base)); if (rnd() < 0.5) L.record(Object.assign({ type: "post", title: "A title" }, base)); }
    else L.record(Object.assign({ type: "delete", reason: rnd() < 0.5 ? "boring" : "wrong" }, base));
  }
}

console.log("Shorts: learning from each church");
await check("with no lessons it scores exactly like the starting model", () => {
  const L = LEARN.load(path.join(tmp, "a.json")), cs = service(24);
  for (const c of cs) assert.ok(Math.abs(L.score(c, {}) - LEARN.baseScore(c, {})) < 1e-9);
  assert.match(L.describe().lines[0], /^Nothing yet/);
});
await check("a church that keeps its stories and deletes the rest: after a few weeks its sermon picks are mostly stories", () => {
  const L = LEARN.load(path.join(tmp, "stories.json")), test = service(40);
  const before = share(top(null, test, "sermon", 6), (c) => c.parts.story);
  for (let w = 0; w < 6; w++) review(L, service(24), (c) => c.kind === "worship" || c.parts.story === 1);
  const after = share(top(L, test, "sermon", 6), (c) => c.parts.story);
  console.log("      stories among the top 6 sermon moments: " + Math.round(before * 100) + "% before, " + Math.round(after * 100) + "% after 6 weeks");
  assert.ok(after >= 0.66 && after > before + 0.2, before + " -> " + after);
  assert.ok(L.describe().lines.some((l) => /Likes stories/.test(l)), JSON.stringify(L.describe().lines));
});
await check("a church that keeps bridges and last choruses (not the first chorus): its worship picks follow", () => {
  const L = LEARN.load(path.join(tmp, "bridges.json")), test = service(0).concat([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => worshipCand(i, ["Chorus", "Bridge", "Last chorus"][i % 3])));
  const before = share(top(null, test, "worship", 4), (c) => c.parts.bridge || c.parts.lastChorus);
  for (let w = 0; w < 6; w++) review(L, service(12), (c) => c.kind === "sermon" || c.parts.bridge || c.parts.lastChorus);
  const after = share(top(L, test, "worship", 4), (c) => c.parts.bridge || c.parts.lastChorus);
  console.log("      bridges / last choruses among the top 4 worship moments: " + Math.round(before * 100) + "% before, " + Math.round(after * 100) + "% after");
  assert.ok(after >= before && after >= 0.75, before + " -> " + after);
});
await check("its trims become the new shorts' lead-in and run-out, its kept lengths the target length", () => {
  const L = LEARN.load(path.join(tmp, "trims.json"));
  for (let w = 0; w < 4; w++) review(L, service(16), () => true, { trim: true });
  const p = L.prefs({ minLen: 30, maxLen: 60, sermonShare: 0.6 });
  assert.ok(p.pad.sermon.start < -1 && p.pad.sermon.end > 1, JSON.stringify(p.pad));
  assert.ok(p.settings.targetLen >= 30 && p.settings.targetLen <= 60);
  assert.ok(L.describe().lines.some((l) => /starts .* earlier and ends .* later/.test(l)), JSON.stringify(L.describe().lines));
});
await check("deleted for ending mid-thought: new shorts run longer at the end; bad audio is noted, not learned as taste", () => {
  const L = LEARN.load(path.join(tmp, "cutoff.json"));
  for (const c of service(8).slice(0, 4)) L.record({ type: "delete", reason: "cutoff", shortId: c.id, kind: "sermon", x: LEARN.features(c, {}), len: 40 });
  for (const c of service(8).slice(4, 6)) L.record({ type: "delete", reason: "audio", shortId: c.id, kind: "sermon", x: LEARN.features(c, {}), len: 40 });
  assert.ok(L.prefs({ minLen: 30, maxLen: 60 }).pad.sermon.end >= 1.5);
  const lines = L.describe().lines.join(" "); assert.match(lines, /ending mid-thought 4 times/); assert.match(lines, /bad audio 2 times/);
});
await check("keeps worship, deletes sermons: the mix leans toward worship; captions turned off and in capitals are habits it follows", () => {
  const L = LEARN.load(path.join(tmp, "mix.json"));
  for (let w = 0; w < 3; w++) review(L, service(12), (c) => c.kind === "worship");
  const p = L.prefs({ minLen: 30, maxLen: 60, sermonShare: 0.6, captions: { upper: false } });
  assert.ok(p.settings.sermonShare < 0.45, p.settings.sermonShare);
  for (let i = 0; i < 4; i++) L.record({ type: "captions-off", shortId: "z" + i, kind: "sermon" });
  assert.equal(L.prefs({ minLen: 30, maxLen: 60 }).captionsOff, true);
  const U = LEARN.load(path.join(tmp, "upper.json"));
  for (let i = 0; i < 4; i++) U.record({ type: "captions", shortId: "u" + i, kind: "sermon", changed: 12, upper: true });
  assert.equal(U.prefs({ minLen: 30, maxLen: 60, captions: { upper: false } }).settings.captions.upper, true);
  assert.match(U.describe().lines.join(" "), /capital letters/);
});
await check("how the posted shorts did teaches it too: what people watched beats what they scrolled past", () => {
  const L = LEARN.load(path.join(tmp, "stats.json")), test = service(40);
  // posted shorts with questions held people; the others didn't
  let k = 0;
  for (let w = 0; w < 5; w++) for (const c of service(16).filter((c) => c.kind === "sermon")) {
    const q = c.parts.question === 1, id = "p" + k++, x = LEARN.features(c, {});
    L.record({ type: "post", shortId: id, kind: "sermon", x, len: 40, title: "t" });
    L.record({ type: "stats", shortId: id, kind: "sermon", x, len: 40, views: q ? 900 + k : 80 + k, retention: q ? 0.8 : 0.25, shares: q ? 3 : 0 });
  }
  const before = share(top(null, test, "sermon", 6), (c) => c.parts.question), after = share(top(L, test, "sermon", 6), (c) => c.parts.question);
  console.log("      questions among the top 6: " + Math.round(before * 100) + "% before, " + Math.round(after * 100) + "% after");
  assert.ok(after > before, before + " -> " + after);
});
await check("its rewritten titles become examples for the AI's titles", () => {
  const L = LEARN.load(path.join(tmp, "titles.json"));
  L.record({ type: "title", shortId: "t1", kind: "sermon", before: "From Sunday's message", title: "You don't have to earn it" });
  L.record({ type: "title", shortId: "t2", kind: "sermon", before: "Grace", title: "Grace you can't lose" });
  const fs_ = AI.fewShot(L.titleExamples()); assert.match(fs_, /You don't have to earn it \(instead of: From Sunday's message\)/); assert.match(fs_, /Grace you can't lose/);
  assert.equal(AI.fewShot([]), "");
});
await check("older lessons count less: last year's taste gives way to this month's", () => {
  const L = LEARN.load(path.join(tmp, "drift.json")), test = service(40), year = 365 * 864e5;
  // a year ago: stories; now: scripture explanations
  const realNow = Date.now; Date.now = () => realNow() - year;
  for (let w = 0; w < 6; w++) review(L, service(24), (c) => c.kind === "worship" || c.parts.story === 1);
  Date.now = realNow;
  for (let w = 0; w < 6; w++) review(L, service(24), (c) => c.kind === "worship" || c.parts.scripture === 1);
  const t = top(L, test, "sermon", 6); assert.ok(share(t, (c) => c.parts.scripture) > share(t, (c) => c.parts.story), JSON.stringify(t.map((c) => c.parts.story + "/" + c.parts.scripture)));
});
await check("Reset learning: back to the starting model, and lessons from before a reset don't come back with a sync", () => {
  const f = path.join(tmp, "stories.json"), L = LEARN.load(f), old = JSON.parse(fs.readFileSync(f, "utf8"));
  assert.ok(L.model().lessons > 0);
  L.reset(); const c = service(4)[0];
  assert.ok(Math.abs(L.score(c, {}) - LEARN.baseScore(c, {})) < 1e-9); assert.equal(L.model().lessons, 0);
  L.merge(old); assert.equal(L.model().lessons, 0, "the other computer's copy from before the reset is ignored");
  assert.equal(JSON.parse(fs.readFileSync(f, "utf8")).events.length, 0);
});
await check("the learning file moves with the hub to the second main admin's computer", () => {
  const H = require("./hubsync.js"); assert.ok(H.FILES.includes("shorts-learning.json"));
});
await check("a broken or old learning file starts fresh instead of failing", () => {
  const f = path.join(tmp, "broken.json"); fs.writeFileSync(f, "{not json"); const L = LEARN.load(f); assert.equal(L.model().lessons, 0);
  fs.writeFileSync(f, JSON.stringify({ version: 1, featureSet: 999, events: [{ type: "approve" }] })); assert.equal(LEARN.load(f).model().events, 0);
});
fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures ? "\n" + failures + " FAILED" : "\nall passed");
process.exit(failures ? 1 : 0);
