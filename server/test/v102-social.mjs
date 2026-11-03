// 10.2: a church's YouTube / Meta / TikTok connections for posting shorts - off until the app keys are set; sign-in
// through the platform's own page (a stand-in here); the tokens kept encrypted on the church; a fresh token handed to
// Central Control (refreshed when old); someone in another church can't use them; disconnect.
// Then Central Control's posting (central-usage/shorts/post.js) against stand-ins of the four platforms' upload APIs.
// Makes its own database and drops it at the end.
//   node test/v102-social.mjs postgres://postgres@127.0.0.1:55432/postgres [port]
import { spawn } from "node:child_process";
import http from "node:http"; import fs from "node:fs"; import os from "node:os";
import path from "node:path"; import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const admin = process.argv[2] || "postgres://postgres@127.0.0.1:55432/postgres", port = Number(process.argv[3] || 19210);
const S = Date.now(), dbName = "ma_v102_" + S, db = admin.replace(/\/[^/]*$/, "/" + dbName);
const pg = (await import("pg")).default;
async function sql(text) { const c = new pg.Client({ connectionString: admin }); await c.connect(); try { await c.query(text); } finally { await c.end(); } }
await sql("CREATE DATABASE " + dbName);
let fails = 0;
const ok = (c, m, d) => { console.log((c ? "  ✓ " : "  ✗ ") + m + (c || d === undefined ? "" : "   -- " + JSON.stringify(d).slice(0, 600))); if (!c) fails++; };

// the platforms' stand-in: sign-in, tokens, the account's name, and the upload APIs
const seen = [];
let refreshes = 0;
const fake = http.createServer((req, res) => {
  let b = []; req.on("data", (c) => b.push(c)); req.on("end", () => {
    const u = new URL(req.url, "http://x"), body = Buffer.concat(b).toString(), J = (o, st) => { res.writeHead(st || 200, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
    seen.push(req.method + " " + u.pathname);
    if (u.pathname === "/google/token") { const p = new URLSearchParams(body); if (p.get("grant_type") === "refresh_token") { refreshes++; return J({ access_token: "yt-access-2", expires_in: 3600 }); } return J({ access_token: "yt-access-1", refresh_token: "yt-refresh", expires_in: 1, scope: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/yt-analytics.readonly" }); }
    if (u.pathname === "/google/channels") return J({ items: [{ snippet: { title: "Grace Church" } }] });
    if (u.pathname === "/meta/token") return J({ access_token: u.searchParams.get("grant_type") ? "meta-long" : "meta-short" });
    if (u.pathname === "/meta/graph/me/permissions") return J({ data: [{ permission: "read_insights", status: "granted" }, { permission: "instagram_manage_insights", status: "declined" }] });
    // (10.3) how posted shorts did
    if (u.pathname === "/yta/v2/reports") { seen.push("yta " + u.searchParams.get("filters") + " " + u.searchParams.get("metrics") + " " + req.headers.authorization); return J({ columnHeaders: [{ name: "video" }, { name: "views" }, { name: "averageViewDuration" }, { name: "likes" }, { name: "shares" }], rows: [["ytvidA", 1200, 31, 80, 9]] }); }
    if (u.pathname === "/graph/igm1/insights") return J({ data: [{ name: "views", values: [{ value: 640 }] }, { name: "likes", values: [{ value: 41 }] }, { name: "shares", values: [{ value: 3 }] }, { name: "ig_reels_avg_watch_time", values: [{ value: 14500 }] }] });
    if (u.pathname === "/graph/fbv1/video_insights") return J({ data: [{ name: "blue_reels_play_count", values: [{ value: 300 }] }, { name: "post_video_avg_time_watched", values: [{ value: 9000 }] }, { name: "post_video_social_actions", values: [{ value: { share: 2, comment: 5 } }] }] });
    if (u.pathname === "/graph/gone/insights") return J({ error: { message: "Unsupported get request" } }, 400);
    if (u.pathname === "/meta/graph/me/accounts") return J({ data: [{ id: "page1", name: "Grace Church", access_token: "page-token", instagram_business_account: { id: "ig1", username: "gracechurch" } }] });
    if (u.pathname === "/tiktok/token") return J({ access_token: "tt-access", refresh_token: "tt-refresh", expires_in: 86400, open_id: "o1" });
    if (u.pathname === "/tiktok/api/v2/user/info/") return J({ data: { user: { display_name: "gracechurch" } } });
    // uploads (Central Control -> the platforms)
    if (u.pathname === "/yt/upload") { res.writeHead(200, { Location: "http://127.0.0.1:" + fake.address().port + "/yt/session" }); return res.end(); }
    if (u.pathname === "/yt/session") return J({ id: "ytvid" + b.length });
    if (u.pathname === "/graph/page1/video_reels" && u.searchParams.get("upload_phase") !== "finish") return J({ video_id: "fbv1", upload_url: "http://127.0.0.1:" + fake.address().port + "/rupload/fbv1" });
    if (u.pathname === "/rupload/fbv1" || u.pathname === "/rupload/igc1") return J({ success: true });
    if (u.pathname === "/graph/page1/video_reels") return J({ success: true });
    if (u.pathname === "/graph/ig1/media") return J({ id: "igc1", uri: "http://127.0.0.1:" + fake.address().port + "/rupload/igc1" });
    if (u.pathname === "/graph/igc1") return J({ status_code: "FINISHED" });
    if (u.pathname === "/graph/ig1/media_publish") return J({ id: "igm1" });
    if (u.pathname === "/graph/igm1") return J({ permalink: "https://www.instagram.com/reel/abc/" });
    if (u.pathname === "/tiktok/v2/post/publish/inbox/video/init/") return J({ data: { publish_id: "ttp1", upload_url: "http://127.0.0.1:" + fake.address().port + "/tt/up" }, error: { code: "ok" } });
    if (u.pathname === "/tt/up") { res.writeHead(201); return res.end(); }
    J({ error: "not here: " + u.pathname }, 404);
  });
});
await new Promise((r) => fake.listen(0, "127.0.0.1", r));
const FAKE = "http://127.0.0.1:" + fake.address().port;

const base = "http://127.0.0.1:" + port;
function start(extra) {
  const srv = spawn(process.execPath, [path.join(here, "..", "src", "index.js")], { env: Object.assign({}, process.env, { DATABASE_URL: db, PORT: String(port), PUBLIC_URL: base, STRIPE_SECRET_KEY: "", RESEND_API_KEY: "", TOKEN_SECRET: "test-secret-102", SOCIAL_TEST_BASE: FAKE }, extra || {}) });
  srv.log = ""; srv.stdout.on("data", (d) => { srv.log += d; }); srv.stderr.on("data", (d) => { srv.log += d; });
  return srv;
}
async function up(srv) { for (let i = 0; i < 150 && !/Motion Audio server on/.test(srv.log); i++) await new Promise((r) => setTimeout(r, 100)); if (!/Motion Audio server on/.test(srv.log)) console.log(srv.log.slice(-1500)); }
async function stop(srv) { srv.kill(); await new Promise((r) => srv.on("exit", r)); }
const j = async (method, p, body, tok) => { const r = await fetch(base + "/v1" + p, { method, headers: { "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); const o = await r.json().catch(() => ({})); o._status = r.status; return o; };

let srv = start();
try {
  await up(srv);
  process.env.DATABASE_URL = db; process.env.TOKEN_SECRET = "test-secret-102";
  const { q, one } = await import("../src/db.js");
  const { makeToken } = await import("../src/auth.js");
  const user = async (who) => { const u = await one("INSERT INTO users (email,name,pass_hash,email_confirmed) VALUES ($1,$2,'x',TRUE) RETURNING *", [who + "@grace102.test", who]); return { u, tok: makeToken(u.id, true) }; };
  const lead = await user("lead"), media = await user("media"), other = await user("other");
  const church = await one("INSERT INTO churches (name,owner_id,admin_code,user_code) VALUES ('Grace 102',$1,'A102" + S + "','U102" + S + "') RETURNING *", [lead.u.id]);
  const elsewhere = await one("INSERT INTO churches (name,owner_id,admin_code,user_code) VALUES ('Elsewhere',$1,'B102" + S + "','V102" + S + "') RETURNING *", [other.u.id]);
  await q("INSERT INTO church_members (church_id,user_id,role) VALUES ($1,$2,'owner'),($1,$3,'admin'),($4,$5,'owner')", [church.id, lead.u.id, media.u.id, elsewhere.id, other.u.id]);

  console.log("without the platforms' app keys:");
  let r = await j("GET", "/social/status", null, lead.tok);
  ok(r._status === 200 && !r.platforms.youtube.available && !r.platforms.tiktok.available && !r.platforms.facebook.available, "every platform says it isn't switched on yet", r);
  r = await j("POST", "/social/youtube/start", {}, lead.tok);
  ok(r._status === 503 && /isn't switched on yet/.test(r.error), "Connect says why it can't yet", r);
  r = await j("GET", "/social/status");
  ok(r._status === 401, "the status needs a sign-in", r);
  await stop(srv);

  srv = start({ YOUTUBE_CLIENT_ID: "yt-id", YOUTUBE_CLIENT_SECRET: "yt-secret", META_APP_ID: "meta-id", META_APP_SECRET: "meta-secret", TIKTOK_CLIENT_KEY: "tt-key", TIKTOK_CLIENT_SECRET: "tt-secret" });
  await up(srv);
  console.log("with the app keys:");
  r = await j("GET", "/social/status", null, lead.tok);
  ok(r.platforms.youtube.available && !r.platforms.youtube.connected && r.platforms.tiktok.available, "available, not connected yet", r);
  r = await j("POST", "/social/youtube/start", {}, lead.tok);
  const url = new URL(r.url || "http://x/");
  ok(url.pathname === "/google/auth" && url.searchParams.get("client_id") === "yt-id" && url.searchParams.get("redirect_uri") === base + "/v1/social/youtube/callback" && /youtube\.upload/.test(url.searchParams.get("scope")) && url.searchParams.get("access_type") === "offline" && url.searchParams.get("state"), "Connect opens Google's sign-in, asking to upload videos, with a signed state", r);
  const state = url.searchParams.get("state");
  let res = await fetch(base + "/v1/social/youtube/callback?code=c1&state=" + encodeURIComponent(state.slice(0, -2) + "xx"));
  ok(res.status === 400 && /didn't work/.test(await res.text()), "a callback with a tampered state is refused");
  res = await fetch(base + "/v1/social/tiktok/callback?code=c1&state=" + encodeURIComponent(state));
  ok(res.status === 400, "a state made for YouTube doesn't connect TikTok");
  res = await fetch(base + "/v1/social/youtube/callback?error=access_denied&error_description=You%20said%20no&state=" + encodeURIComponent(state));
  ok(res.status === 400 && /You said no/.test(await res.text()), "saying no on Google's page: Not connected, and why");
  res = await fetch(base + "/v1/social/youtube/callback?code=c1&state=" + encodeURIComponent(state));
  ok(res.status === 200 && /Grace Church/.test(await res.text()), "the sign-in finishes: YouTube is connected to the church's channel");
  const row = await one("SELECT * FROM social_accounts WHERE platform='youtube'");
  ok(row && row.scope === "c:" + church.id && !/yt-refresh|yt-access/.test(row.data_enc) && row.connected_by === "lead@grace102.test", "kept on the church, the tokens encrypted", row && { scope: row.scope });
  r = await j("GET", "/social/status", null, media.tok);
  ok(r.platforms.youtube.connected && r.platforms.youtube.account === "Grace Church", "another admin of the church sees it connected", r.platforms.youtube);
  r = await j("POST", "/social/youtube/token", {}, media.tok);
  ok(r._status === 200 && r.accessToken === "yt-access-2" && refreshes === 1, "the token was old: refreshed with the refresh token and handed over", r);
  r = await j("POST", "/social/youtube/token", {}, media.tok);
  ok(r.accessToken === "yt-access-2" && refreshes === 1, "a fresh one is handed over as it is", r);
  r = await j("POST", "/social/youtube/token", {}, other.tok);
  ok(r._status === 409 && /Connect YouTube first/.test(r.error), "someone in another church can't use it", r);

  r = await j("POST", "/social/instagram/start", {}, lead.tok);
  const ms = new URL(r.url).searchParams.get("state");
  ok(/meta\/auth/.test(r.url) && /instagram_content_publish/.test(decodeURIComponent(r.url)), "Facebook and Instagram share Meta's sign-in", r.url);
  res = await fetch(base + "/v1/social/meta/callback?code=m1&state=" + encodeURIComponent(ms));
  ok(res.status === 200 && /Grace Church · @gracechurch/.test(await res.text()), "Meta connects the Page and its Instagram account");
  r = await j("GET", "/social/status", null, lead.tok);
  ok(r.platforms.facebook.connected && r.platforms.facebook.account === "Grace Church" && r.platforms.instagram.connected && r.platforms.instagram.account === "@gracechurch", "the status: Facebook (the Page) and Instagram (@account)", r.platforms);
  ok(r.platforms.youtube.numbers === true && r.platforms.facebook.numbers === true && r.platforms.instagram.numbers === false, "(10.3) it says which can read back how shorts did (Instagram's insights were declined)", r.platforms);
  r = await j("POST", "/social/facebook/token", {}, lead.tok);
  ok(r.accessToken === "page-token" && r.pageId === "page1" && r.igUserId === "ig1", "the Page's token, the Page and the Instagram account to post to", r);
  r = await j("POST", "/social/tiktok/start", {}, lead.tok);
  ok(new URL(r.url).searchParams.get("client_key") === "tt-key", "TikTok's sign-in takes its client key", r);
  res = await fetch(base + "/v1/social/tiktok/callback?code=t1&state=" + encodeURIComponent(new URL(r.url).searchParams.get("state")));
  ok(res.status === 200, "TikTok connects");

  console.log("posting from Central Control (shorts/post.js):");
  process.env.CU_SOCIAL_TEST_BASE = FAKE;
  const require = createRequire(import.meta.url);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "post-")), file = path.join(tmp, "s.mp4"); fs.writeFileSync(file, Buffer.alloc(2048, 7));
  // (post.js reads its stand-in address when it loads)
  const POST = require(path.join(here, "..", "..", "central-usage", "shorts", "post.js"));
  const o = { file, title: "You are loved", description: "From Sunday.", hashtags: ["#church"] };
  let p = await POST.post("youtube", Object.assign({ token: "yt-access-2" }, o)).catch((e) => ({ error: e.message }));
  ok(p.id && /youtube\.com\/shorts\//.test(p.url) && seen.includes("PUT /yt/session"), "YouTube Shorts: a resumable upload, the link back", p);
  p = await POST.post("facebook", Object.assign({ token: "page-token", pageId: "page1" }, o)).catch((e) => ({ error: e.message }));
  ok(p.id === "fbv1" && /facebook\.com\/reel\/fbv1/.test(p.url), "Facebook Reels: start, upload, finish", p);
  p = await POST.post("instagram", Object.assign({ token: "page-token", igUserId: "ig1" }, o)).catch((e) => ({ error: e.message }));
  ok(p.id === "igm1" && p.url === "https://www.instagram.com/reel/abc/", "Instagram Reels: upload, wait until it's ready, publish, the link", p);
  p = await POST.post("instagram", Object.assign({ token: "page-token", igUserId: null }, o)).catch((e) => ({ error: e.message }));
  ok(/no Instagram professional account/.test(p.error || ""), "Instagram without a linked account says so", p);
  p = await POST.post("tiktok", Object.assign({ token: "tt-access" }, o)).catch((e) => ({ error: e.message }));
  ok(p.id === "ttp1" && /TikTok app's inbox/.test(p.note), "TikTok: into the account's inbox to finish (until the app is approved)", p);
  fs.rmSync(tmp, { recursive: true, force: true });

  console.log("how the posted shorts did (shorts/analytics.js):");
  const ST = require(path.join(here, "..", "..", "central-usage", "shorts", "analytics.js"));
  let st = await ST.stats("youtube", { token: "yt-access-2", ids: ["ytvidA", "ytvidB"] }).catch((e) => ({ error: e.message }));
  ok(st.ytvidA && st.ytvidA.views === 1200 && st.ytvidA.avgSeconds === 31 && st.ytvidA.shares === 9 && st.ytvidB && st.ytvidB.views === 0 && seen.some((x) => x === "yta video==ytvidA,ytvidB views,averageViewDuration,likes,shares Bearer yt-access-2"), "YouTube Analytics: views, average view duration, likes, shares per video (none yet: 0)", st);
  st = await ST.stats("instagram", { token: "page-token", ids: ["igm1", "gone"] }).catch((e) => ({ error: e.message }));
  ok(st.igm1 && st.igm1.views === 640 && st.igm1.avgSeconds === 14.5 && st.igm1.likes === 41 && !st.gone, "Instagram insights: views, likes, shares, average watch time; a deleted post is skipped", st);
  st = await ST.stats("facebook", { token: "page-token", ids: ["fbv1"] }).catch((e) => ({ error: e.message }));
  ok(st.fbv1 && st.fbv1.views === 300 && st.fbv1.avgSeconds === 9 && st.fbv1.shares === 7, "Facebook reel insights: plays, average watch time", st);
  st = await ST.stats("tiktok", { token: "x", ids: ["a"] });
  ok(Object.keys(st).length === 0, "TikTok: nothing to read yet (its posts go through the TikTok inbox)", st);

  r = await j("POST", "/social/youtube/disconnect", {}, lead.tok);
  const left = await one("SELECT count(*)::int AS n FROM social_accounts WHERE platform='youtube'");
  ok(r.ok && left.n === 0, "Disconnect removes the connection");
  await (await import("../src/db.js")).pool.end().catch(() => { });
} catch (e) { fails++; console.log("  ✗ " + (e.stack || e)); }
finally {
  await stop(srv); fake.close();
  await new Promise((r) => setTimeout(r, 300));
  await sql("DROP DATABASE IF EXISTS " + dbName + " WITH (FORCE)").catch(() => { });
}
console.log(fails ? "\n" + fails + " FAILED" : "\nall passed");
process.exit(fails ? 1 : 0);
