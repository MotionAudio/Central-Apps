/* Shorts - posting a short straight from this computer to the church's YouTube, Facebook, Instagram and TikTok.
 * The website hands over a fresh access token for the church's connected account (server/src/social.js keeps the
 * platforms' app secrets); the video goes from here to the platform, not through the website.
 *   post(platform, { token, file, title, description, hashtags, privacy, pageId, igUserId }) -> { id, url, note }
 * (tests: CU_SOCIAL_TEST_BASE points every platform at a stand-in server) */
"use strict";
const fs = require("node:fs");

const T = process.env.CU_SOCIAL_TEST_BASE ? process.env.CU_SOCIAL_TEST_BASE.replace(/\/+$/, "") : null;
const U = {
  ytUpload: T ? T + "/yt/upload" : "https://www.googleapis.com/upload/youtube/v3/videos",
  graph: T ? T + "/graph" : "https://graph.facebook.com/v21.0",
  tiktok: T ? T + "/tiktok" : "https://open.tiktokapis.com"
};
function oops(platform, r, j, fallback) {
  const m = j && (j.error && (j.error.message || j.error.error_user_msg || (typeof j.error === "string" ? j.error : "") || j.error.code) || j.message);
  return new Error(platform + ": " + (m || fallback || ("it answered " + r.status)));
}
async function json(r) { try { return await r.json(); } catch (_) { return {}; } }
function caption(o) { return [o.description || "", (o.hashtags || []).join(" ")].filter(Boolean).join("\n\n").trim(); }

async function youtube(o) {
  const size = fs.statSync(o.file).size;
  const meta = { snippet: { title: String(o.title || "").slice(0, 100), description: (caption(o) + (/#shorts/i.test(caption(o)) ? "" : "\n\n#Shorts")).trim().slice(0, 4900), tags: (o.hashtags || []).map((h) => h.replace(/^#/, "")).slice(0, 15), categoryId: "22" }, status: { privacyStatus: o.privacy || "public", selfDeclaredMadeForKids: false } };
  const r = await fetch(U.ytUpload + "?uploadType=resumable&part=snippet,status", { method: "POST", headers: { Authorization: "Bearer " + o.token, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "video/mp4", "X-Upload-Content-Length": String(size) }, body: JSON.stringify(meta) });
  if (!r.ok) throw oops("YouTube", r, await json(r));
  const at = r.headers.get("location"); if (!at) throw new Error("YouTube didn't give an upload address.");
  const up = await fetch(at, { method: "PUT", headers: { "Content-Type": "video/mp4", "Content-Length": String(size) }, body: fs.readFileSync(o.file) });
  const j = await json(up); if (!up.ok || !j.id) throw oops("YouTube", up, j, "the upload didn't finish");
  return { id: j.id, url: "https://www.youtube.com/shorts/" + j.id };
}

async function facebook(o) {
  const size = fs.statSync(o.file).size, page = o.pageId;
  let r = await fetch(U.graph + "/" + page + "/video_reels", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ upload_phase: "start", access_token: o.token }) });
  let j = await json(r); if (!r.ok || !j.video_id) throw oops("Facebook", r, j);
  const vid = j.video_id, upUrl = j.upload_url || (U.graph.replace("graph.facebook.com", "rupload.facebook.com/video-upload") + "/" + vid);
  r = await fetch(upUrl, { method: "POST", headers: { Authorization: "OAuth " + o.token, offset: "0", file_size: String(size) }, body: fs.readFileSync(o.file) });
  j = await json(r); if (!r.ok || j.success === false) throw oops("Facebook", r, j, "the upload didn't finish");
  r = await fetch(U.graph + "/" + page + "/video_reels?" + new URLSearchParams({ upload_phase: "finish", video_id: vid, video_state: "PUBLISHED", description: caption(o) || o.title || "", title: o.title || "", access_token: o.token }), { method: "POST" });
  j = await json(r); if (!r.ok || j.success === false) throw oops("Facebook", r, j);
  return { id: vid, url: "https://www.facebook.com/reel/" + vid };
}

async function instagram(o, wait) {
  if (!o.igUserId) throw new Error("Instagram: the Facebook Page has no Instagram professional account linked to it.");
  const size = fs.statSync(o.file).size, cap = [o.title, caption(o)].filter(Boolean).join("\n\n").slice(0, 2200);
  let r = await fetch(U.graph + "/" + o.igUserId + "/media?" + new URLSearchParams({ media_type: "REELS", upload_type: "resumable", caption: cap, share_to_feed: "true", access_token: o.token }), { method: "POST" });
  let j = await json(r); if (!r.ok || !j.id) throw oops("Instagram", r, j);
  const container = j.id, upUrl = j.uri || (U.graph.replace("graph.facebook.com", "rupload.facebook.com/ig-api-upload") + "/" + container);
  r = await fetch(upUrl, { method: "POST", headers: { Authorization: "OAuth " + o.token, offset: "0", file_size: String(size) }, body: fs.readFileSync(o.file) });
  j = await json(r); if (!r.ok || j.success === false) throw oops("Instagram", r, j, "the upload didn't finish");
  // Instagram works the video over before it can go out (usually under a minute)
  for (let i = 0; i < (wait || 60); i++) {
    r = await fetch(U.graph + "/" + container + "?" + new URLSearchParams({ fields: "status_code,status", access_token: o.token })); j = await json(r);
    if (j.status_code === "FINISHED") break;
    if (j.status_code === "ERROR" || j.status_code === "EXPIRED") throw new Error("Instagram couldn't use the video: " + (j.status || j.status_code));
    await new Promise((res) => setTimeout(res, T ? 50 : 5000));
  }
  r = await fetch(U.graph + "/" + o.igUserId + "/media_publish?" + new URLSearchParams({ creation_id: container, access_token: o.token }), { method: "POST" });
  j = await json(r); if (!r.ok || !j.id) throw oops("Instagram", r, j, "it didn't publish");
  let url = null; try { const p = await json(await fetch(U.graph + "/" + j.id + "?" + new URLSearchParams({ fields: "permalink", access_token: o.token }))); url = p.permalink || null; } catch (_) { }
  return { id: j.id, url };
}

/* TikTok: until Motion Audio's app passes TikTok's review, videos land in the account's TikTok inbox, where someone taps
 * Post (TikTok's rule for apps that aren't reviewed yet). After the review, direct posting can be switched on. */
async function tiktok(o) {
  const size = fs.statSync(o.file).size, direct = !!o.direct;
  const body = direct ? { post_info: { title: [o.title, (o.hashtags || []).join(" ")].filter(Boolean).join(" ").slice(0, 2200), privacy_level: o.privacy === "private" ? "SELF_ONLY" : "PUBLIC_TO_EVERYONE" }, source_info: { source: "FILE_UPLOAD", video_size: size, chunk_size: size, total_chunk_count: 1 } } : { source_info: { source: "FILE_UPLOAD", video_size: size, chunk_size: size, total_chunk_count: 1 } };
  let r = await fetch(U.tiktok + (direct ? "/v2/post/publish/video/init/" : "/v2/post/publish/inbox/video/init/"), { method: "POST", headers: { Authorization: "Bearer " + o.token, "Content-Type": "application/json; charset=UTF-8" }, body: JSON.stringify(body) });
  let j = await json(r); if (!r.ok || !j.data || !j.data.upload_url || (j.error && j.error.code && j.error.code !== "ok")) throw oops("TikTok", r, j);
  r = await fetch(j.data.upload_url, { method: "PUT", headers: { "Content-Type": "video/mp4", "Content-Length": String(size), "Content-Range": "bytes 0-" + (size - 1) + "/" + size }, body: fs.readFileSync(o.file) });
  if (!r.ok) throw oops("TikTok", r, await json(r), "the upload didn't finish");
  return { id: j.data.publish_id, url: null, note: direct ? "Posted to TikTok." : "Sent to the TikTok app's inbox: open TikTok and tap Post to finish." };
}

const PLATFORMS = { youtube: { label: "YouTube Shorts", fn: youtube }, facebook: { label: "Facebook Reels", fn: facebook }, instagram: { label: "Instagram Reels", fn: instagram }, tiktok: { label: "TikTok", fn: tiktok } };
async function post(platform, o) { const p = PLATFORMS[platform]; if (!p) throw new Error("Central Control doesn't post to " + platform + "."); if (!fs.existsSync(o.file)) throw new Error("The short's video file is missing."); return p.fn(o); }
module.exports = { post, PLATFORMS, caption };
