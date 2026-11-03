/* Shorts - picking the good parts of a service recording (no Electron, no ffmpeg: plain logic, tested on its own).
 *
 *   regions(features, markers)         where the music is, where someone talks, where it's quiet; the songs (from the
 *                                      song markers the app writes while it records, or from long stretches of music)
 *                                      and the sermon (the longest stretch of talking)
 *   sentences(words)                   the transcript's words (with times) cut into sentences
 *   sermonCandidates(sents, features)  every run of whole sentences that fits the length range, with a score from the
 *                                      words (a strong, self-contained, quotable line) and the sound (energy, a pause
 *                                      after it, applause / "amen" / laughter right after)
 *   worshipCandidates(songs, features) the peaks of each song: its choruses, its bridge, its last chorus, the loudest
 *                                      stretch - starting and ending where the music breathes
 *   select(cands, settings)            the best ones that don't overlap, in the sermon / worship mix asked for
 *
 * Times are seconds from the start of the recording. features: { hop: 0.1, rms: dB per hop, flat: spectral flatness 0..1,
 * zcr: zero crossings per sample, dur } (audio.js makes them). */
"use strict";

const DEFAULTS = { count: 5, minLen: 30, maxLen: 60, sermonShare: 0.6, minGap: 4, perSong: 2 };

// ------------------------------------------------------------------ the sound, in 1-second windows
function windows(f) {
  const per = Math.max(1, Math.round(1 / f.hop)), n = Math.floor(f.rms.length / per), out = [];
  for (let w = 0; w < n; w++) {
    let sum = 0, sq = 0, fl = 0, low = 0, max = -200;
    for (let i = w * per; i < (w + 1) * per; i++) { const v = f.rms[i]; sum += v; sq += v * v; fl += f.flat[i]; if (v > max) max = v; }
    const mean = sum / per, std = Math.sqrt(Math.max(0, sq / per - mean * mean));
    for (let i = w * per; i < (w + 1) * per; i++) if (f.rms[i] < max - 12) low++;
    out.push({ t: w, mean, std, flat: fl / per, dips: low / per, max });
  }
  return out;
}
function percentile(arr, p) { if (!arr.length) return -100; const s = Array.from(arr).sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))]; }
function median(arr) { return percentile(arr, 0.5); }

/* music / speech / quiet per second, smoothed: music holds its level (small spread, few dips), speech comes in
 * syllables and phrases (a big spread, dips between words), quiet is near the noise floor */
function classify(f) {
  const w = windows(f); if (!w.length) return [];
  const floor = percentile(w.map((x) => x.mean), 0.05), loud = percentile(w.map((x) => x.mean), 0.9);
  const quietBelow = floor + Math.max(6, (loud - floor) * 0.25);
  const raw = w.map((x) => x.mean < quietBelow ? "quiet" : (x.std >= 4.5 || x.dips >= 0.25) ? "speech" : "music");
  // a vote over 15 seconds: a held note in a sermon or a gap in a song doesn't flip it
  const R = 7, out = raw.map((_, i) => { const c = { quiet: 0, speech: 0, music: 0 }; for (let k = Math.max(0, i - R); k <= Math.min(raw.length - 1, i + R); k++) c[raw[k]]++; return c.music >= c.speech && c.music >= c.quiet ? "music" : c.speech >= c.quiet ? "speech" : "quiet"; });
  const regs = [];
  out.forEach((k, i) => { const last = regs[regs.length - 1]; if (last && last.kind === k) last.end = i + 1; else regs.push({ kind: k, start: i, end: i + 1 }); });
  return regs;
}

/* the songs and the sermon. markers: [{ t, song, section, playing }] - the app writes one whenever the song or its
 * section changes during the recording (seconds from the recording's start) */
function regions(f, markers) {
  const regs = classify(f), dur = f.dur || f.rms.length * f.hop;
  let songs = [];
  const ms = (markers || []).filter((m) => m && typeof m.t === "number").sort((a, b) => a.t - b.t);
  if (ms.some((m) => m.song && m.playing !== false)) {
    for (let i = 0; i < ms.length; i++) {
      const m = ms[i], end = i + 1 < ms.length ? ms[i + 1].t : dur;
      if (!m.song || m.playing === false) continue;
      let s = songs[songs.length - 1];
      if (!s || s.name !== m.song || m.t - s.end > 20) { s = { name: m.song, start: m.t, end, sections: [] }; songs.push(s); }
      s.end = end;
      if (m.section) { const last = s.sections[s.sections.length - 1]; if (last && last.name === m.section && last.end >= m.t - 0.5) last.end = end; else s.sections.push({ name: m.section, start: m.t, end }); }
    }
  } else {
    // no markers (a recording made without the tracks running): long stretches of music are the songs
    const music = regs.filter((r) => r.kind === "music").map((r) => ({ start: r.start, end: r.end }));
    const merged = []; music.forEach((r) => { const l = merged[merged.length - 1]; if (l && r.start - l.end <= 20) l.end = r.end; else merged.push(Object.assign({}, r)); });
    songs = merged.filter((r) => r.end - r.start >= 75).map((r, i) => ({ name: "Song " + (i + 1), start: r.start, end: r.end, sections: [] }));
  }
  // the sermon: talking outside the songs; the longest stretch (gaps under 30 s joined), at least 2 minutes
  const inSong = (t) => songs.some((s) => t >= s.start && t < s.end);
  const talk = regs.filter((r) => r.kind === "speech").map((r) => ({ start: r.start, end: r.end })).filter((r) => !inSong((r.start + r.end) / 2));
  const joined = []; talk.forEach((r) => { const l = joined[joined.length - 1]; if (l && r.start - l.end <= 30 && !songs.some((s) => s.start >= l.end && s.start < r.start)) l.end = r.end; else joined.push(Object.assign({}, r)); });
  joined.sort((a, b) => (b.end - b.start) - (a.end - a.start));
  const sermon = joined[0] && joined[0].end - joined[0].start >= 120 ? joined[0] : null;
  return { regions: regs, songs, sermon, talk: joined };
}

// ------------------------------------------------------------------ the words
const END = /[.?!…]["'”’)]*$/;
function sentences(words, opts) {
  const o = Object.assign({ gap: 0.7, maxLen: 22 }, opts || {}), out = [];
  let cur = [];
  const flush = () => { if (!cur.length) return; out.push({ start: cur[0].start, end: cur[cur.length - 1].end, text: cur.map((w) => w.text).join(" ").replace(/\s+([,.?!;:])/g, "$1").trim(), words: cur }); cur = []; };
  (words || []).forEach((w, i) => {
    if (!w || !String(w.text || "").trim()) return;
    const prev = cur[cur.length - 1];
    if (prev && (w.start - prev.end > o.gap || w.start - cur[0].start > o.maxLen)) flush();
    cur.push({ text: String(w.text).trim(), start: Number(w.start), end: Number(w.end) });
    if (END.test(w.text)) flush();
    if (i === words.length - 1) flush();
  });
  flush();
  return out;
}

/* how strong a stretch of words is on its own (0..1). Plain signals a person would use too: it doesn't start in the
 * middle of a thought ("and", "so", "he said"), it ends on a full stop, it speaks to the listener, it's quotable
 * (short punchy sentences, a contrast, a promise), a story's payoff ("that's when", "and God"), and not a list of
 * announcements */
const WEAK_START = /^(and|but|so|or|because|which|that|then|also|this|these|those|it|he|she|they|him|her|them|there|well|um|uh|like|ok|okay|right)\b/i;
const STRONG = /\b(god|jesus|christ|lord|grace|love|hope|faith|mercy|forgive\w*|free(dom)?|never|always|every|nothing|everything|remember|listen|today|you are|you were|your life|he is|he will|he has|will not|cannot|can't|don't have to|the truth|the gospel|promise|chosen|loved|known|enough|fear|peace|joy|heaven|prayer|pray)\b/gi;
const CONTRAST = /\b(not .{2,40} but|instead of|isn't about|it's not|the question is|here's the thing|what if|the point is)\b/i;
const PAYOFF = /\b(that's when|and that's|in that moment|that day|and god|he looked at|she looked at|i'll never forget|i realized|it hit me)\b/i;
const YOU = /\b(you|your|you're|yourself)\b/gi;
const ADMIN = /\b(announcement|sign up|signup|parking|nursery|website|app|bulletin|next week|wednesday|offering|giving|potluck|ushers?|registration)\b/gi;
function textScore(text, sents) {
  const t = String(text || "").trim(); if (!t) return 0;
  const words = t.split(/\s+/).length;
  let s = 0.35;
  if (WEAK_START.test(t)) s -= 0.18;
  if (END.test(t)) s += 0.08;
  s += Math.min(0.2, ((t.match(STRONG) || []).length) * 0.04);
  s += Math.min(0.12, ((t.match(YOU) || []).length) * 0.02);
  if (CONTRAST.test(t)) s += 0.1;
  if (PAYOFF.test(t)) s += 0.1;
  if (/\?/.test(t)) s += 0.04;
  s -= Math.min(0.4, ((t.match(ADMIN) || []).length) * 0.12);
  if (sents && sents.length) { const short = sents.filter((x) => x.text.split(/\s+/).length <= 12).length; s += Math.min(0.1, short * 0.03); }   // punchy lines
  if (words < 40) s -= 0.15;   // too thin to stand alone
  return Math.max(0, Math.min(1, s));
}

/* (10.3) the same signals one by one (0..1), for the learning (learn.js): which of them a church's picks lean on */
function textParts(text, sents) {
  const t = String(text || "").trim(), words = t ? t.split(/\s+/).length : 0, per = Math.max(1, words / 100);
  const short = sents && sents.length ? sents.filter((x) => x.text.split(/\s+/).length <= 12).length / sents.length : 0;
  const first = sents && sents.length ? sents[0].text : t;
  return {
    strong: Math.min(1, ((t.match(STRONG) || []).length) / (6 * per)), you: Math.min(1, ((t.match(YOU) || []).length) / (8 * per)),
    contrast: CONTRAST.test(t) ? 1 : 0, story: PAYOFF.test(t) || /\b(i was|i remember|years ago|one day|there was a|my (father|mother|dad|mom|wife|husband|son|daughter|friend))\b/i.test(t) ? 1 : 0,
    question: /\?/.test(t) ? 1 : 0, scripture: /\b(verse|chapter|scripture|it is written|the bible|says the lord|genesis|exodus|psalms?|proverbs|isaiah|matthew|mark|luke|john|romans|corinthians|galatians|ephesians|hebrews|revelation)\b/i.test(t) ? 1 : 0,
    admin: Math.min(1, ((t.match(ADMIN) || []).length) / 2), punchy: short, weakStart: WEAK_START.test(first) ? 1 : 0
  };
}

// ------------------------------------------------------------------ the sound of a moment
function at(f, t) { return Math.max(0, Math.min(f.rms.length - 1, Math.round(t / f.hop))); }
function meanDb(f, a, b) { const i = at(f, a), j = Math.max(i + 1, at(f, b)); let s = 0; for (let k = i; k < j; k++) s += f.rms[k]; return s / (j - i); }
/* applause / a room answering ("amen", laughter): loud, noisy (flat spectrum, lots of zero crossings), for a second or more */
function response(f, a, b) {
  const i = at(f, a), j = at(f, b); let run = 0, best = 0;
  const floor = f.floor != null ? f.floor : percentile(f.rms, 0.1);
  for (let k = i; k < j; k++) { const noisy = f.flat[k] > 0.35 && f.rms[k] > floor + 15 && (f.zcr ? f.zcr[k] > 0.12 : true); run = noisy ? run + 1 : 0; if (run > best) best = run; }
  return Math.min(1, (best * f.hop) / 2.5);
}
function pauseAfter(f, t) { const i = at(f, t), j = at(f, t + 1.2), base = meanDb(f, t - 3, t); let q = 0; for (let k = i; k < j; k++) if (f.rms[k] < base - 10) q++; return Math.min(1, q / Math.max(1, j - i) * 1.5); }
function audioScore(f, start, end, ref) {
  const energy = Math.max(0, Math.min(1, (meanDb(f, start, end) - ref + 6) / 12));   // livelier than the sermon's usual
  return { energy, response: response(f, end, end + 5), pause: pauseAfter(f, end) };
}

function sermonCandidates(sents, f, settings) {
  const o = Object.assign({}, DEFAULTS, settings || {}), out = [];
  const ref = f ? median(Array.from(f.rms).filter((v) => v > -70)) : 0;
  for (let i = 0; i < sents.length; i++) {
    if (WEAK_START.test(sents[i].text) && i > 0 && sents[i].start - sents[i - 1].end < 1.2) continue;   // starts mid-thought
    for (let j = i; j < sents.length; j++) {
      const start = sents[i].start, end = sents[j].end, len = end - start;
      if (j > i && sents[j].start - sents[j - 1].end > 6) break;   // a long silence: something else happened
      if (len > o.maxLen) break;
      if (len < o.minLen) continue;
      const part = sents.slice(i, j + 1), text = part.map((x) => x.text).join(" ");
      const ts = textScore(text, part), as = f ? audioScore(f, start, end, ref) : { energy: 0.5, response: 0, pause: 0.5 };
      const score = ts * 0.6 + as.energy * 0.15 + as.response * 0.15 + as.pause * 0.1;
      out.push({ kind: "sermon", start: round(start), end: round(end), text, words: [].concat(...part.map((x) => x.words)), score, rule: score, parts: Object.assign({ text: ts, energy: as.energy, response: as.response, pause: as.pause }, textParts(text, part)) });
    }
  }
  return out;
}

/* the quietest point near t (where the music breathes: between phrases), within ±r seconds */
function breath(f, t, r) {
  const i = at(f, t - r), j = at(f, t + r); let best = at(f, t), bv = Infinity;
  for (let k = i; k <= j; k++) { let v = 0; for (let m = -2; m <= 2; m++) v += f.rms[Math.max(0, Math.min(f.rms.length - 1, k + m))]; v += Math.abs(k - at(f, t)) * 0.08; if (v < bv) { bv = v; best = k; } }
  return round(best * f.hop);
}
function worshipCandidates(songs, f, settings) {
  const o = Object.assign({}, DEFAULTS, settings || {}), out = [];
  const target = Math.min(o.maxLen, Math.max(o.minLen, o.targetLen || (o.minLen + o.maxLen) / 2));   // (10.3: the church's preferred length, once learned)
  (songs || []).forEach((s, si) => {
    const songDb = meanDb(f, s.start, s.end), starts = [];
    if (s.sections && s.sections.length) {
      s.sections.forEach((sec, k) => {
        const n = String(sec.name || "").toLowerCase(), last = !s.sections.slice(k + 1).some((x) => /chorus/i.test(x.name));
        if (/chorus|bridge|tag|refrain|vamp/.test(n)) starts.push({ t: sec.start, bonus: /bridge/.test(n) ? 0.12 : /chorus/.test(n) && last ? 0.18 : /tag|vamp/.test(n) ? 0.1 : 0.05, label: sec.name });
      });
    }
    if (!starts.length) for (let t = s.start + 10; t + o.minLen <= s.end; t += 8) starts.push({ t, bonus: 0, label: "" });
    starts.forEach((st) => {
      let a = Math.max(s.start, st.t - 1.5), b = Math.min(s.end, a + target);
      if (b - a < o.minLen) { a = Math.max(s.start, b - target); }
      if (b - a < o.minLen) return;
      a = Math.max(s.start, breath(f, a, 2)); b = Math.min(s.end, breath(f, b, 3));
      if (b - a < o.minLen) b = Math.min(s.end, a + o.minLen);
      if (b - a > o.maxLen) b = a + o.maxLen;
      if (b - a < o.minLen - 0.5) return;
      const peak = Math.max(0, Math.min(1, (meanDb(f, a, b) - songDb + 3) / 6));   // louder than the song's usual
      const late = (a - s.start) / Math.max(1, s.end - s.start);   // later in the song builds more
      const room = response(f, a, b) * 0.5;   // the room singing along / clapping
      const score = 0.3 + peak * 0.35 + late * 0.15 + st.bonus + room * 0.1;
      const lab = String(st.label || "").toLowerCase();
      out.push({ kind: "worship", song: s.name, songIndex: si, label: st.label, start: round(a), end: round(b), text: "", score: Math.min(1, score), rule: Math.min(1, score), parts: { peak, late, bonus: st.bonus, room, chorus: /chorus|refrain/.test(lab) ? 1 : 0, bridge: /bridge/.test(lab) ? 1 : 0, lastChorus: st.bonus >= 0.18 ? 1 : 0, tag: /tag|vamp/.test(lab) ? 1 : 0 } });
    });
  });
  return out;
}

function overlaps(a, b, gap) { return a.start < b.end + gap && b.start < a.end + gap; }
function select(cands, settings) {
  const o = Object.assign({}, DEFAULTS, settings || {});
  const count = Math.max(0, Math.round(o.count));
  const pools = { sermon: cands.filter((c) => c.kind === "sermon").sort((a, b) => b.score - a.score), worship: cands.filter((c) => c.kind === "worship").sort((a, b) => b.score - a.score) };
  let wantS = Math.round(count * Math.max(0, Math.min(1, o.sermonShare))), wantW = count - wantS;
  const chosen = [], perSong = {};
  const take = (pool, n) => {
    let got = 0;
    for (const c of pool) {
      if (got >= n) break;
      if (chosen.some((x) => overlaps(x, c, o.minGap))) continue;
      if (c.kind === "worship" && (perSong[c.songIndex] || 0) >= o.perSong) continue;
      chosen.push(c); got++; if (c.kind === "worship") perSong[c.songIndex] = (perSong[c.songIndex] || 0) + 1;
    }
    return got;
  };
  const gotS = take(pools.sermon, wantS), gotW = take(pools.worship, wantW);
  // not enough of one kind: fill from the other
  if (gotS < wantS) take(pools.worship, wantS - gotS);
  if (gotW < wantW) take(pools.sermon, wantW - gotW);
  return chosen.sort((a, b) => a.start - b.start);
}

/* the stretch of words for a clip (for its captions): the words inside it */
function wordsIn(words, start, end) { return (words || []).filter((w) => w.start >= start - 0.05 && w.end <= end + 0.3); }
/* a clip that starts where the operator pressed "make another from here": whole sentences from that point */
function fromHere(sents, t, settings) {
  const o = Object.assign({}, DEFAULTS, settings || {});
  const i = sents.findIndex((s) => s.end > t); if (i < 0) return null;
  let j = i; while (j + 1 < sents.length && sents[j + 1].end - sents[i].start <= o.maxLen && (sents[j].end - sents[i].start < (o.minLen + o.maxLen) / 2)) j++;
  return { start: sents[i].start, end: sents[j].end };
}
function round(x) { return Math.round(x * 100) / 100; }

module.exports = { DEFAULTS, windows, classify, regions, sentences, textScore, textParts, response, audioScore, sermonCandidates, worshipCandidates, select, wordsIn, fromHere, breath, overlaps, median, percentile };
