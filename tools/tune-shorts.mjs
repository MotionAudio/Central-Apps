// Tunes the starting weights of the shorts picker (central-usage/shorts/defaults.json) on free-to-use recordings
// (docs/SHORTS.md lists them and their licences). The recordings and their transcripts are not kept in the repository:
// only the passages' times, their features and the ratings (tools/shorts-tuning/ratings.json) and the fitted weights.
//
//   1. node tools/tune-shorts.mjs passages <corpus out folder> > passages.json
//        each recording's candidate moments (30-60 s, whole sentences): the starting model's top ones and a spread of
//        others, without overlaps - to be rated 1-5 by a person reading them (the corpus folder holds the transcripts
//        and sound features the shorts worker would have; see docs/SHORTS.md)
//   2. node tools/tune-shorts.mjs fit <corpus out folder> tools/shorts-tuning/ratings.json [--write]
//        fits the weights (held near the hand-set ones), reports leave-one-recording-out how the picks change, and with
//        --write saves them to defaults.json
import fs from "node:fs"; import path from "node:path"; import { createRequire } from "node:module"; import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url)), require = createRequire(import.meta.url);
const P = require("../central-usage/shorts/pick.js"), LEARN = require("../central-usage/shorts/learn.js");
const [cmd, dir, ratingsFile, flag] = process.argv.slice(2), PRIOR = Number(process.env.TUNE_PRIOR || 0.3);

function load(name) { const j = JSON.parse(fs.readFileSync(path.join(dir, name + ".json"), "utf8")); j.f = { hop: j.hop, dur: j.dur, floor: j.floor, rms: Float32Array.from(j.rms), flat: Float32Array.from(j.flat), zcr: Float32Array.from(j.zcr) }; return j; }
const names = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, "")).sort();
function cands(rec) {
  const S = Object.assign({}, P.DEFAULTS, { minLen: 30, maxLen: 60 });
  const cs = P.sermonCandidates(P.sentences(rec.words), rec.f, S);
  for (const c of cs) { c.features = LEARN.features(c, S); c.base = LEARN.baseScore(c, S); }
  return cs;
}
function spread(cs, n, seed) {
  // the best by the starting model, then evenly through the rest of the sermon, never overlapping
  const out = [], take = (c) => { if (out.length < n && !out.some((x) => P.overlaps(x, c, 2))) out.push(c); };
  cs.slice().sort((a, b) => b.base - a.base).slice(0, 40).forEach((c, i) => { if (i % 3 === 0) take(c); });
  const byTime = cs.slice().sort((a, b) => a.start - b.start), step = Math.max(1, Math.floor(byTime.length / (n * 2)));
  for (let i = seed % step; i < byTime.length; i += step) take(byTime[i]);
  return out.sort((a, b) => a.start - b.start);
}

if (cmd === "passages") {
  const out = [];
  for (const n of names) { const rec = load(n); if (!rec.words.length) continue; for (const c of spread(cands(rec), 8, 1)) out.push({ rec: n, start: c.start, end: c.end, base: Math.round(c.base * 1000) / 1000, key: c.key, text: c.text }); }
  process.stdout.write(JSON.stringify(out, null, 1));
} else if (cmd === "fit") {
  const R = JSON.parse(fs.readFileSync(ratingsFile, "utf8")).ratings;
  const recs = {}; for (const n of names) recs[n] = load(n);
  // each rated passage: its candidate (same start / end) and its features
  const rated = [];
  for (const r of R) {
    const rec = recs[r.rec]; if (!rec) continue;
    rec.cands = rec.cands || cands(rec);
    const c = rec.cands.find((x) => Math.abs(x.start - r.start) < 0.05 && Math.abs(x.end - r.end) < 0.05); if (!c) { console.error("not found", r.rec, r.start); continue; }
    rated.push({ rec: r.rec, rating: r.rating, c });
  }
  const ex = (list) => list.filter((x) => x.rating !== 3).map((x) => ({ x: x.c.features, y: x.rating >= 4 ? 1 : 0, w: Math.abs(x.rating - 3) / 2 }));
  const prior = LEARN.DEFAULTS.weights, sig = (z) => 1 / (1 + Math.exp(-z)), score = (w, x) => sig(w.reduce((s, wi, i) => s + wi * x[i], 0));
  // how good the top picks are: the mean rating of each recording's best 3 (by the model), and how often a 4-5 is first
  function evalOn(w, list) {
    const by = {}; list.forEach((x) => { (by[x.rec] = by[x.rec] || []).push(x); });
    let top3 = 0, first = 0, n = 0;
    for (const xs of Object.values(by)) { const s = xs.slice().sort((a, b) => score(w, b.c.features) - score(w, a.c.features)); top3 += s.slice(0, 3).reduce((a, x) => a + x.rating, 0) / Math.min(3, s.length); first += s[0].rating >= 4 ? 1 : 0; n++; }
    return { top3: top3 / n, firstGood: first / n };
  }
  const before = evalOn(prior, rated);
  // leave one recording out: fit on the others, judge the held-out one
  let lo = { top3: 0, firstGood: 0 }, k = 0;
  for (const n of Object.keys(recs)) { const test = rated.filter((x) => x.rec === n); if (!test.length) continue; const w = LEARN.fit(ex(rated.filter((x) => x.rec !== n)), prior, { prior: PRIOR }); const e = evalOn(w, test); lo.top3 += e.top3; lo.firstGood += e.firstGood; k++; }
  lo = { top3: lo.top3 / k, firstGood: lo.firstGood / k };
  const wAll = LEARN.fit(ex(rated), prior, { prior: PRIOR });
  const random = rated.reduce((a, x) => a + x.rating, 0) / rated.length;
  const moved = LEARN.FEATURES.map((f, i) => [f, Math.round((wAll[i] - prior[i]) * 100) / 100]).filter((x) => Math.abs(x[1]) >= 0.15).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const report = { passages: rated.length, recordings: k, meanRating: Math.round(random * 100) / 100, before: { top3: +before.top3.toFixed(2), firstGood: +before.firstGood.toFixed(2) }, afterLeaveOneOut: { top3: +lo.top3.toFixed(2), firstGood: +lo.firstGood.toFixed(2) }, moved };
  console.log(JSON.stringify(report, null, 1));
  if (flag === "--write") {
    const file = path.join(here, "..", "central-usage", "shorts", "defaults.json"), d = JSON.parse(fs.readFileSync(file, "utf8"));
    d.weights = wAll.map((x) => Math.round(x * 1000) / 1000); d.tuned = { at: new Date().toISOString().slice(0, 10), passages: rated.length, recordings: k, before: report.before, afterLeaveOneOut: report.afterLeaveOneOut, meanRating: report.meanRating };
    fs.writeFileSync(file, JSON.stringify(d, null, 1) + "\n"); console.log("written", file);
  }
} else { console.error("usage: tune-shorts.mjs passages <dir> | fit <dir> <ratings.json> [--write]"); process.exit(2); }
