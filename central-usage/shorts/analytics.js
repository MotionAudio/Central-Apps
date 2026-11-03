/* Shorts (10.3) - how the posted shorts did, read back from the platforms (with the church's own connection; the website
 * hands over a token, as for posting):
 *   YouTube    the YouTube Analytics API: views, average view duration, likes, shares (scope yt-analytics.readonly)
 *   Instagram  the media's insights: views, likes, shares, average watch time (instagram_manage_insights)
 *   Facebook   the reel's insights: plays and average watch time (read_insights)
 *   TikTok     not yet: its posts go through the TikTok inbox, which doesn't give the video back to Central Control
 *   stats(platform, { token, ids, igUserId }) -> { [id]: { views, avgSeconds, likes, shares } }
 * (tests: CU_SOCIAL_TEST_BASE points every platform at a stand-in) */
"use strict";
const T = process.env.CU_SOCIAL_TEST_BASE ? process.env.CU_SOCIAL_TEST_BASE.replace(/\/+$/, "") : null;
const U = { yta: T ? T + "/yta/v2/reports" : "https://youtubeanalytics.googleapis.com/v2/reports", graph: T ? T + "/graph" : "https://graph.facebook.com/v21.0" };
async function getJson(url, headers) { const r = await fetch(url, { headers: Object.assign({ Accept: "application/json" }, headers || {}) }); const j = await r.json().catch(() => ({})); if (!r.ok) { const e = new Error((j.error && (j.error.message || j.error)) || "it answered " + r.status); e.status = r.status; throw e; } return j; }
const num = (x) => (Number.isFinite(Number(x)) ? Number(x) : null);

async function youtube(o) {
  const out = {}, ids = o.ids.slice();
  while (ids.length) {
    const part = ids.splice(0, 50), today = new Date().toISOString().slice(0, 10);
    const q = new URLSearchParams({ ids: "channel==MINE", startDate: "2020-01-01", endDate: today, metrics: "views,averageViewDuration,likes,shares", dimensions: "video", filters: "video==" + part.join(",") });
    const j = await getJson(U.yta + "?" + q, { Authorization: "Bearer " + o.token });
    const cols = (j.columnHeaders || []).map((c) => c.name);
    for (const row of j.rows || []) { const g = (n) => row[cols.indexOf(n)]; out[g("video")] = { views: num(g("views")), avgSeconds: num(g("averageViewDuration")), likes: num(g("likes")), shares: num(g("shares")) }; }
    for (const id of part) if (!out[id]) out[id] = { views: 0, avgSeconds: null, likes: 0, shares: 0 };   // (no row yet: nobody watched)
  }
  return out;
}
function insights(j) { const m = {}; for (const d of j.data || []) { const v = d.values && d.values[0] ? d.values[0].value : d.total_value ? d.total_value.value : null; m[d.name] = typeof v === "object" && v ? Object.values(v).reduce((a, b) => a + (Number(b) || 0), 0) : num(v); } return m; }
async function instagram(o) {
  const out = {};
  for (const id of o.ids) {
    try {
      const m = insights(await getJson(U.graph + "/" + id + "/insights?" + new URLSearchParams({ metric: "views,likes,shares,ig_reels_avg_watch_time", access_token: o.token })));
      out[id] = { views: m.views, avgSeconds: m.ig_reels_avg_watch_time != null ? m.ig_reels_avg_watch_time / 1000 : null, likes: m.likes, shares: m.shares };
    } catch (e) { if (e.status === 400) continue; throw e; }   // (a deleted post)
  }
  return out;
}
async function facebook(o) {
  const out = {};
  for (const id of o.ids) {
    try {
      const m = insights(await getJson(U.graph + "/" + id + "/video_insights?" + new URLSearchParams({ metric: "blue_reels_play_count,post_video_avg_time_watched,post_video_social_actions", access_token: o.token })));
      out[id] = { views: m.blue_reels_play_count, avgSeconds: m.post_video_avg_time_watched != null ? m.post_video_avg_time_watched / 1000 : null, likes: null, shares: m.post_video_social_actions != null ? m.post_video_social_actions : null };
    } catch (e) { if (e.status === 400) continue; throw e; }
  }
  return out;
}
const READERS = { youtube, instagram, facebook };
async function stats(platform, o) { const f = READERS[platform]; if (!f || !o.ids || !o.ids.length) return {}; return f(o); }
module.exports = { stats, READERS };
