/* Shorts (10.3) - learning what each church likes, on the main admin's computer.
 *
 * Every review action is a lesson: approved as it was, trimmed (how far the start and end moved), captions corrected,
 * captions turned off, title rewritten, deleted (with a reason: boring, cut off mid-thought, wrong moment, audio bad),
 * posted - and later how a posted short did (views, how long people watched, likes, shares). From those it keeps:
 *   - a small scoring model over the signals the picker already measures (the words, the voice's energy, the room
 *     answering, the AI's rating, the kind of song section, the length...). It is a logistic model held near the starting
 *     weights (defaults.json, tuned on free-to-use recordings): from day one it picks like the starting model, and each
 *     week's lessons pull it toward the church. Older lessons count less (half after 26 weeks).
 *   - the church's preferred length, how much lead-in and run-out it adds when it trims, its caption habits, which kind
 *     (sermon or worship) it keeps more, and the titles it wrote (examples for the AI's next titles).
 * The data stays on the church's computers (shorts-learning.json; it moves with the hub to the second main admin's
 * computer, hubsync.js). "Reset learning" starts again from the starting weights.
 *
 *   const L = load(file); L.record(event); L.score(cand) -> 0..1; L.prefs(settings); L.describe(); L.reset(); */
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const DEFAULTS = JSON.parse(fs.readFileSync(path.join(__dirname, "defaults.json"), "utf8"));
const FEATURES = DEFAULTS.features;          // the order of the weights
const HALF_LIFE_WEEKS = 26, PRIOR = 1.0, MAX_EVENTS = 2000;
const REASONS = { boring: "boring", cutoff: "cut off mid-thought", wrong: "wrong moment", audio: "audio bad" };

/* a candidate (pick.js) or a short (worker.js keeps its .features) -> the feature vector */
function features(c, settings) {
  if (c.features && c.features.length === FEATURES.length) return c.features;
  const p = c.parts || {}, w = c.kind === "worship" ? 1 : 0, len = (c.end - c.start) || 0;
  const mid = settings && settings.targetLen || 45;
  const v = {
    bias: 1, worship: w, rule: (c.rule != null ? c.rule : c.score || 0.5) - 0.5,
    ai: c.ai != null ? c.ai - 0.5 : 0, hasAI: c.ai != null ? 1 : 0,
    text: w ? 0 : (p.text || 0) - 0.4, energy: (p.energy || 0) - 0.5, response: p.response || 0, pause: w ? 0 : (p.pause || 0) - 0.5,
    strong: p.strong || 0, you: p.you || 0, contrast: p.contrast || 0, story: p.story || 0, question: p.question || 0, scripture: p.scripture || 0, admin: p.admin || 0, punchy: p.punchy || 0, weakStart: p.weakStart || 0,
    peak: w ? (p.peak || 0) - 0.5 : 0, late: w ? (p.late || 0) - 0.5 : 0, room: w ? p.room || 0 : 0,
    chorus: p.chorus || 0, bridge: p.bridge || 0, lastChorus: p.lastChorus || 0, tag: p.tag || 0,
    point: p.point || 0, bigIdea: p.bigIdea || 0, action: p.action || 0, explain: p.explain || 0, payoff: p.payoff || 0, firstLift: p.firstLift || 0, build: p.build || 0, spontaneous: p.spontaneous || 0,
    lenDev: Math.min(2, Math.abs(len - mid) / 20)
  };
  return FEATURES.map((k) => Number.isFinite(v[k]) ? v[k] : 0);
}
const sig = (z) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
const dot = (w, x) => { let s = 0; for (let i = 0; i < w.length; i++) s += w[i] * x[i]; return s; };

/* the lessons -> weighted examples { x, y 0/1, w } */
function examples(events, now) {
  const out = [], posted = events.filter((e) => e.type === "stats" && e.views != null);
  const medViews = median(posted.map((e) => e.views)), medRet = median(posted.map((e) => e.retention).filter((x) => x != null));
  const age = (t) => Math.pow(0.5, Math.max(0, (now - t) / (7 * 864e5)) / HALF_LIFE_WEEKS);
  // the last word on each short counts (approved, then deleted: deleted)
  const last = {};
  for (const e of events) if (e.x && ["approve", "delete", "post"].includes(e.type)) { const k = e.shortId; if (!last[k] || e.type === "post" || last[k].type !== "post") last[k] = e; }
  for (const e of Object.values(last)) {
    let y = 1, w = 1;
    if (e.type === "post") w = 1.5;
    else if (e.type === "approve") w = e.edited ? 0.7 : 1;
    else { y = 0; w = { boring: 1.3, wrong: 1.3, cutoff: 0.5, audio: 0.2 }[e.reason] || 1; }
    out.push({ x: e.x, y, w: w * age(e.at) });
  }
  // how posted shorts did (once a few have numbers): better than the church's usual -> more like it
  if (posted.length >= 3) {
    const best = {}; for (const e of posted) if (!best[e.shortId] || e.at > best[e.shortId].at) best[e.shortId] = e;
    for (const e of Object.values(best)) {
      if (!e.x) continue;
      const v = medViews > 0 ? Math.log((e.views + 1) / (medViews + 1)) / Math.log(4) : 0, r = e.retention != null && medRet > 0 ? (e.retention - medRet) / Math.max(0.15, medRet) : 0;
      const perf = Math.max(-1, Math.min(1, 0.5 * v + 0.5 * r + (e.shares > 0 ? 0.1 : 0)));
      if (Math.abs(perf) < 0.1) continue;
      out.push({ x: e.x, y: perf > 0 ? 1 : 0, w: Math.abs(perf) * 1.5 * age(e.at) });
    }
  }
  return out;
}
/* MAP logistic regression: the starting weights are the prior (a church with no lessons keeps them) */
function fit(ex, prior, opts) {
  const w = prior.slice(); if (!ex.length) return w;
  const lam = (opts && opts.prior) || PRIOR, rate = 0.3, n = ex.reduce((s, e) => s + e.w, 0);
  for (let it = 0; it < 300; it++) {
    const g = w.map((wi, i) => lam * (wi - prior[i]));
    for (const e of ex) { const err = sig(dot(w, e.x)) - e.y; for (let i = 0; i < w.length; i++) g[i] += e.w * err * e.x[i]; }
    for (let i = 0; i < w.length; i++) w[i] -= rate * g[i] / (lam + n);
  }
  return w;
}
function median(a) { a = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y); return a.length ? a[Math.floor((a.length - 1) / 2)] : 0; }
function mean(a, prior, strength) { let s = prior * strength, n = strength; for (const [v, w] of a) { s += v * w; n += w; } return s / n; }

function load(file) {
  let d = null; try { d = JSON.parse(fs.readFileSync(file, "utf8")); } catch (_) { }
  if (!d || d.version !== 1 || d.featureSet !== DEFAULTS.featureSet) d = { version: 1, featureSet: DEFAULTS.featureSet, events: [], resetAt: null };
  let cache = null;
  const save = () => { try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file + ".tmp", JSON.stringify(d)); fs.renameSync(file + ".tmp", file); } catch (_) { } };
  function model() {
    if (cache) return cache;
    const now = Date.now(), ev = d.events, ex = examples(ev, now);
    const weights = fit(ex, DEFAULTS.weights);
    // the habits
    const kept = ev.filter((e) => (e.type === "approve" || e.type === "post") && e.len), age = (t) => Math.pow(0.5, Math.max(0, (now - t) / (7 * 864e5)) / HALF_LIFE_WEEKS);
    const trims = ev.filter((e) => e.type === "trim");
    const pad = (k, which) => mean(trims.filter((e) => e.kind === k).map((e) => [Math.max(-8, Math.min(8, e[which])), age(e.at)]), 0, 3);
    const cutoffs = ev.filter((e) => e.type === "delete" && e.reason === "cutoff").length;
    const recent = ev.filter((e) => e.type === "approve" || e.type === "post" || e.type === "delete").slice(-12);
    const capsOff = ev.filter((e) => e.type === "captions-off").slice(-12), capsOn = ev.filter((e) => e.type === "captions-on").slice(-12);
    const capEdits = ev.filter((e) => e.type === "captions").slice(-10);
    const upperEdits = capEdits.filter((e) => e.upper).length;
    const kindRate = (k) => { const a = ev.filter((e) => e.kind === k && (e.type === "approve" || e.type === "post")).length, x = ev.filter((e) => e.kind === k && e.type === "delete").length; return { kept: a, deleted: x, rate: (a + 1) / (a + x + 2) }; };
    const titles = ev.filter((e) => (e.type === "title" || e.type === "post") && e.title).slice(-6).map((e) => ({ before: e.before || null, title: e.title, kind: e.kind }));
    cache = {
      weights, lessons: ex.length, events: ev.length,
      length: { sermon: kept.filter((e) => e.kind === "sermon").length >= 3 ? mean(kept.filter((e) => e.kind === "sermon").map((e) => [e.len, age(e.at)]), 45, 3) : null, worship: kept.filter((e) => e.kind === "worship").length >= 3 ? mean(kept.filter((e) => e.kind === "worship").map((e) => [e.len, age(e.at)]), 40, 3) : null },
      pad: { sermon: { start: pad("sermon", "dStart"), end: pad("sermon", "dEnd") + Math.min(3, cutoffs * 0.5) }, worship: { start: pad("worship", "dStart"), end: pad("worship", "dEnd") } },
      trims: trims.length, cutoffs,
      captions: { off: capsOff.length >= 3 && capsOff.length > capsOn.length * 2 && recent.length >= 4, upper: capEdits.length >= 3 && upperEdits >= capEdits.length * 0.6, fixes: capEdits.length ? Math.round(capEdits.reduce((s, e) => s + (e.changed || 0), 0) / capEdits.length) : 0 },
      kinds: { sermon: kindRate("sermon"), worship: kindRate("worship") },
      reasons: Object.keys(REASONS).reduce((o, k) => (o[k] = ev.filter((e) => e.type === "delete" && e.reason === k).length, o), {}),
      titles,
      audioBad: ev.filter((e) => e.type === "delete" && e.reason === "audio").length
    };
    return cache;
  }
  const api = {
    file, data: () => d, features, REASONS,
    record(e) {
      if (!e || !e.type) return;
      d.events.push(Object.assign({ at: Date.now() }, e));
      if (d.events.length > MAX_EVENTS) d.events = d.events.slice(-MAX_EVENTS);
      cache = null; save();
    },
    model,
    /* 0..1: how much this church would want this moment */
    score(c, settings) { return sig(dot(model().weights, features(c, settings))); },
    /* the picker's settings with what was learned folded in (only where there's enough to go on) */
    prefs(settings) {
      const m = model(), s = Object.assign({}, settings), out = { pad: m.pad, captionsOff: m.captions.off, upper: m.captions.upper };
      const lens = [m.length.sermon, m.length.worship].filter((x) => x != null);
      if (lens.length) s.targetLen = Math.max(s.minLen, Math.min(s.maxLen, lens.reduce((a, b) => a + b, 0) / lens.length));
      const ks = m.kinds.sermon, kw = m.kinds.worship;
      if (ks.kept + ks.deleted >= 4 && kw.kept + kw.deleted >= 4 && s.sermonShare > 0 && s.sermonShare < 1) s.sermonShare = Math.max(0.1, Math.min(0.9, s.sermonShare + 0.4 * (ks.rate - kw.rate)));
      if (m.captions.upper && s.captions) s.captions = Object.assign({}, s.captions, { upper: true });
      return Object.assign(out, { settings: s });
    },
    /* examples for the AI's titles: the titles this church wrote or posted */
    titleExamples() { return model().titles; },
    /* what it has learned, in plain words */
    describe() {
      const m = model(), out = [];
      if (!d.events.length) return { lessons: 0, lines: ["Nothing yet. Every short you approve, trim, fix, delete or post teaches it what your church likes."] };
      const fmtS = (x) => Math.round(x) + " seconds";
      if (m.length.sermon != null) out.push("Sermon shorts you keep run about " + fmtS(m.length.sermon) + ".");
      if (m.length.worship != null) out.push("Worship shorts you keep run about " + fmtS(m.length.worship) + ".");
      const pd = (x, k) => Math.abs(x) >= 0.5 ? (x < 0 ? "starts " + Math.abs(x).toFixed(1) + " s earlier" : "starts " + x.toFixed(1) + " s later") : null;
      const pe = (x) => Math.abs(x) >= 0.5 ? (x > 0 ? "ends " + x.toFixed(1) + " s later" : "ends " + Math.abs(x).toFixed(1) + " s earlier") : null;
      for (const k of ["sermon", "worship"]) { const a = [pd(m.pad[k].start), pe(m.pad[k].end)].filter(Boolean); if (a.length) out.push("When you trim a " + k + " short, it usually " + a.join(" and ") + ": new ones are cut that way."); }
      const ks = m.kinds.sermon, kw = m.kinds.worship;
      if (ks.kept + ks.deleted >= 4 && kw.kept + kw.deleted >= 4) { const diff = ks.rate - kw.rate; out.push(Math.abs(diff) < 0.1 ? "You keep sermon and worship shorts about equally." : "You keep more " + (diff > 0 ? "sermon" : "worship") + " shorts than " + (diff > 0 ? "worship" : "sermon") + " ones, so it makes a few more of those."); }
      // the signals that moved most from the starting weights
      const moved = FEATURES.map((k, i) => [k, m.weights[i] - DEFAULTS.weights[i]]).filter((x) => DEFAULTS.labels[x[0]] && Math.abs(x[1]) >= 0.25).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 4);
      for (const [k, dv] of moved) out.push((dv > 0 ? "Likes " : "Doesn't care for ") + DEFAULTS.labels[k] + ".");
      if (m.captions.off) out.push("You usually turn the captions off, so new shorts are made without them.");
      else if (m.captions.upper) out.push("You put captions in capital letters, so new shorts use capitals.");
      if (m.captions.fixes >= 3) out.push("You correct about " + m.captions.fixes + " caption words per short; the Accurate speech model (Settings → Lyrics) makes fewer mistakes.");
      if (m.reasons.cutoff >= 2) out.push("Shorts were deleted for ending mid-thought " + m.reasons.cutoff + " times, so new ones run a little longer at the end.");
      if (m.audioBad >= 2) out.push("Shorts were deleted for bad audio " + m.audioBad + " times: check the stream mix that's recorded.");
      if (m.titles.length) out.push("Its titles now follow yours, e.g. \"" + m.titles[m.titles.length - 1].title + "\".");
      if (!out.length) out.push("It has " + m.lessons + " lesson" + (m.lessons === 1 ? "" : "s") + " so far; a few more and it starts to show what your church likes.");
      return { lessons: m.lessons, events: m.events, lines: out };
    },
    reset() { d = { version: 1, featureSet: DEFAULTS.featureSet, events: [], resetAt: Date.now() }; cache = null; save(); },
    /* the learning file from the other main admin's computer (newest lessons win, no duplicates) */
    merge(other) { if (!other || !Array.isArray(other.events)) return; const seen = new Set(d.events.map((e) => e.at + ":" + e.type + ":" + e.shortId)); for (const e of other.events) if (!seen.has(e.at + ":" + e.type + ":" + e.shortId) && (!d.resetAt || e.at > d.resetAt)) d.events.push(e); d.events.sort((a, b) => a.at - b.at); cache = null; save(); }
  };
  return api;
}

/* the starting model's score (no lessons) */
function baseScore(c, settings) { return sig(dot(DEFAULTS.weights, features(c, settings))); }

module.exports = { load, features, baseScore, fit, examples, DEFAULTS, FEATURES, REASONS };
