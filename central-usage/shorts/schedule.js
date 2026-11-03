/* Shorts (10.3) - the posting queue and its schedule (plain logic, tested on its own; index.js runs it).
 *
 * When a short is approved it goes into the queue once per platform it's set to go to, each at that platform's next free
 * time: the church's posting times ("one a day at 11:00", or "Mon, Wed, Fri at 9:00 and 18:00"), from the start date,
 * never two on one platform closer than the gap, and the platforms spread a few minutes apart so they don't all go at
 * once. Each item can be posted now, skipped or tried again. A post that fails is tried again after 5 minutes, 30
 * minutes, 2 hours and 6 hours, then waits for someone to look at it.
 *
 * The main admin's computer does the posting (the video files are there). If it's off at a posting time, the items that
 * came due post when it next comes on, one per platform at a time and spaced by the gap, so a weekend away doesn't
 * become ten posts in a minute.
 *
 * schedule: { auto: true (approved shorts go in the queue), start: "YYYY-MM-DD" | "", gapHours: 3, spreadMinutes: 10,
 *             times: [{ days: [0..6] (Sunday 0), time: "11:00" }], platforms: { youtube: { on, times?: [...] }, ... } } */
"use strict";

const PLATFORMS = ["youtube", "instagram", "facebook", "tiktok"];
const DEFAULT = { auto: true, start: "", gapHours: 3, spreadMinutes: 10, times: [{ days: [0, 1, 2, 3, 4, 5, 6], time: "11:00" }], platforms: { youtube: { on: true }, instagram: { on: true }, facebook: { on: true }, tiktok: { on: false } } };
const RETRY_MIN = [5, 30, 120, 360];

function norm(s) {
  s = Object.assign({}, DEFAULT, s || {});
  const times = (t) => (Array.isArray(t) ? t : []).map((x) => ({ days: (Array.isArray(x.days) ? x.days : []).map(Number).filter((d) => d >= 0 && d <= 6), time: /^([01]?\d|2[0-3]):[0-5]\d$/.test(String(x.time || "")) ? String(x.time).padStart(5, "0") : "11:00" })).filter((x) => x.days.length).slice(0, 20);
  s.times = times(s.times); if (!s.times.length) s.times = DEFAULT.times.slice();
  s.gapHours = Math.max(0, Math.min(168, Number(s.gapHours) || 0)); s.spreadMinutes = Math.max(0, Math.min(240, Number(s.spreadMinutes) || 0));
  const pl = {}; for (const p of PLATFORMS) { const x = (s.platforms || {})[p] || DEFAULT.platforms[p]; pl[p] = { on: !!x.on, times: x.times && times(x.times).length ? times(x.times) : null }; }
  s.platforms = pl; s.start = /^\d{4}-\d{2}-\d{2}$/.test(String(s.start || "")) ? s.start : "";
  return s;
}
/* the posting times of a platform from `after` on (local time), the first `n` of them */
function slots(sch, platform, after, n) {
  const s = norm(sch), times = (s.platforms[platform] && s.platforms[platform].times) || s.times, out = [];
  const offset = Math.max(0, PLATFORMS.indexOf(platform)) * s.spreadMinutes * 60e3;
  let from = after; if (s.start) { const [y, m, d] = s.start.split("-").map(Number), st = new Date(y, m - 1, d).getTime(); if (st > from) from = st; }
  const day0 = new Date(from); day0.setHours(0, 0, 0, 0);
  for (let k = 0; k < 400 && out.length < n; k++) {
    const day = new Date(day0.getFullYear(), day0.getMonth(), day0.getDate() + k), list = [];
    for (const t of times) if (t.days.includes(day.getDay())) { const [h, mi] = t.time.split(":").map(Number); list.push(new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, mi).getTime() + offset); }
    list.sort((a, b) => a - b).forEach((t) => { if (t > after && t >= from && out.length < n) out.push(t); });
  }
  return out;
}
/* the next free time on a platform: a posting time at least the gap away from everything already there */
function nextFree(sch, platform, queue, now) {
  const s = norm(sch), gap = s.gapHours * 3600e3, taken = queue.filter((q) => q.platform === platform && (q.status === "queued" || q.status === "posted" || q.status === "posting" || q.status === "failed")).map((q) => q.status === "posted" ? q.postedAt || q.dueAt : q.dueAt);
  for (const t of slots(s, platform, now, 200)) if (taken.every((x) => Math.abs(x - t) >= Math.max(gap, 60e3))) return t;
  return null;
}
/* an approved short (or full video) into the queue: one item per platform it goes to */
function enqueue(queue, item, sch, now, only) {
  const s = norm(sch), out = [];
  for (const p of only || PLATFORMS) {
    if (!s.platforms[p] || !s.platforms[p].on) continue;
    if (item.kinds && !item.kinds.includes(p)) continue;
    if (queue.some((q) => q.ref === item.ref && q.platform === p && q.status !== "skipped")) continue;
    const at = nextFree(s, p, queue.concat(out), now); if (at == null) continue;
    out.push({ id: "q" + now.toString(36) + Math.random().toString(36).slice(2, 6), ref: item.ref, recording: item.recording, shortId: item.shortId, full: item.full || null, title: item.title, platform: p, dueAt: at, status: "queued", tries: 0, created: now });
  }
  return queue.concat(out);
}
/* what to post now: due items, at most one per platform, and not within the gap of that platform's last post (so a
 * computer that was off catches up gently) */
function due(queue, sch, now) {
  const s = norm(sch), gap = Math.min(s.gapHours * 3600e3, 6 * 3600e3), pick = {};
  for (const q of queue.slice().sort((a, b) => a.dueAt - b.dueAt)) {
    if (q.status !== "queued" && !(q.status === "failed" && q.nextTry && q.nextTry <= now)) continue;
    if ((q.status === "queued" ? q.dueAt : q.nextTry) > now || pick[q.platform]) continue;
    const last = Math.max(0, ...queue.filter((x) => x.platform === q.platform && x.status === "posted").map((x) => x.postedAt || 0));
    if (q.status === "queued" && !q.now && last && now - last < gap) continue;
    pick[q.platform] = q;
  }
  return Object.values(pick);
}
function posted(q, result, now) { return Object.assign(q, { status: "posted", postedAt: now, result, error: null, nextTry: null }); }
function failed(q, error, now) {
  q.tries = (q.tries || 0) + 1; q.error = String(error || "it didn't work").slice(0, 300); q.status = "failed";
  q.nextTry = q.tries <= RETRY_MIN.length ? now + RETRY_MIN[q.tries - 1] * 60e3 : null;   // (after the last try: it waits for "Try again")
  return q;
}
function postNow(q, now) { return Object.assign(q, { status: "queued", dueAt: now, now: true, nextTry: null }); }
function skip(q) { return Object.assign(q, { status: "skipped" }); }
function retry(q, now) { return Object.assign(q, { status: "queued", dueAt: now, now: true, tries: 0, nextTry: null, error: null }); }

/* the post's description: the church's template with the short's words, its hashtags, the link to the full service and
 * the church's own links. {title} {description} {hashtags} {link} {links} {church} {date} */
const TEMPLATE = "{description}\n\nWatch the whole service: {link}\n\n{links}\n\n{hashtags}";
function describe(tpl, v) {
  const t = String(tpl || TEMPLATE);
  let out = t.replace(/\{(title|description|hashtags|link|links|church|date|speaker|scripture)\}/g, (_, k) => String(v[k] == null ? "" : v[k]).trim());
  // a line whose only content was an empty placeholder goes (no "Watch the whole service: " with nothing after it)
  const used = t.split("\n").map((line) => ({ line, empty: /\{(link|links|hashtags|description|speaker|scripture)\}/.test(line) && !line.replace(/\{(title|description|hashtags|link|links|church|date|speaker|scripture)\}/g, (_, k) => String(v[k] == null ? "" : v[k]).trim()).replace(/^[^:]*:\s*$/, "").trim() }));
  out = t.split("\n").map((line, i) => used[i].empty ? null : line.replace(/\{(title|description|hashtags|link|links|church|date|speaker|scripture)\}/g, (_, k) => String(v[k] == null ? "" : v[k]).trim())).filter((x) => x !== null).join("\n");
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

module.exports = { PLATFORMS, DEFAULT, RETRY_MIN, TEMPLATE, norm, slots, nextFree, enqueue, due, posted, failed, postNow, skip, retry, describe };
