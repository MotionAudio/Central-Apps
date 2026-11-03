// Shorts (10.3): social media - the posting schedule and queue (spread, catch-up, retry, post now / skip), the description
// with the link to the whole service, and the full-length worship and sermon videos (the cuts, the chapters, posting them
// with their playlist and thumbnail). The platforms and the website are stand-ins; ffmpeg is real.
//   node central-usage/test-shorts-social.mjs [ffmpeg]
import { spawnSync, spawn } from "node:child_process";
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import http from "node:http"; import assert from "node:assert";
import { createRequire } from "node:module"; import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url)), require = createRequire(import.meta.url);
const FFARG = process.argv[2] || process.env.CU_FFMPEG || "ffmpeg";
const FF = FFARG.includes("/") || FFARG.includes("\\") ? path.resolve(FFARG) : FFARG;   // (a relative path made absolute: the shorts worker runs in another folder)
let failures = 0; async function check(label, fn) { try { await fn(); console.log("  ✓ " + label); } catch (e) { failures++; console.error("  ✗ " + label + "\n      " + String(e && e.stack || e).split("\n").slice(0, 5).join("\n      ")); } }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cu-social-"));

// ---------------------------------------------------------------- the stand-ins: the platforms and the website
const seen = []; let fbFails = 1, ytUploads = 0;
const fake = http.createServer((req, res) => {
  const b = []; req.on("data", (c) => b.push(c)); req.on("end", () => {
    const u = new URL(req.url, "http://x"), body = Buffer.concat(b), J = (o, st) => { res.writeHead(st || 200, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
    const rec = { m: req.method, p: u.pathname, q: Object.fromEntries(u.searchParams), auth: req.headers.authorization || "", body: body.length < 20000 ? body.toString() : "<" + body.length + " bytes>" }; seen.push(rec);
    // the website: a token for each platform
    if (u.pathname.startsWith("/v1/social/")) { const k = u.pathname.split("/")[3]; if (req.headers.authorization !== "Bearer site-token") return J({ error: "Sign in" }, 401); return J(k === "meta" ? { accessToken: "page-token", pageId: "page1", igUserId: "ig1", account: "Grace Church" } : { accessToken: k + "-token", account: "Grace Church" }); }
    // YouTube
    if (u.pathname === "/yt/v3/liveBroadcasts") return J({ items: [{ id: "OLDLIVE", snippet: { title: "Last week", actualStartTime: new Date(Date.now() - 8 * 864e5).toISOString() } }, { id: "LIVE123", snippet: { title: "Sunday live", actualStartTime: new Date(Date.now() - 3600e3).toISOString() } }] });
    if (u.pathname === "/yt/upload") { res.writeHead(200, { Location: "http://127.0.0.1:" + fake.address().port + "/yt/session" }); return res.end(); }
    if (u.pathname === "/yt/session") return J({ id: "vid" + ++ytUploads });
    if (u.pathname === "/yt/thumb") return J({ items: [{}] });
    if (u.pathname === "/yt/v3/playlists" && req.method === "GET") return J({ items: [{ id: "PLsermonsxxxxxx", snippet: { title: "Sermons" } }] });
    if (u.pathname === "/yt/v3/playlists") return J({ id: "PLnewxxxxxxxxxx" });
    if (u.pathname === "/yt/v3/playlistItems") return J({ id: "pi1" });
    // Facebook / Instagram reels and videos
    if (u.pathname === "/graph/page1/video_reels" && u.searchParams.get("upload_phase") !== "finish") { if (fbFails-- > 0) return J({ error: { message: "Temporary problem, try again" } }, 500); return J({ video_id: "fbv1", upload_url: "http://127.0.0.1:" + fake.address().port + "/rupload/fbv1" }); }
    if (u.pathname.startsWith("/rupload/")) return J({ success: true });
    if (u.pathname === "/graph/page1/video_reels") return J({ success: true });
    if (u.pathname === "/graph/ig1/media") return J({ id: "igc1", uri: "http://127.0.0.1:" + fake.address().port + "/rupload/igc1" });
    if (u.pathname === "/graph/igc1") return J({ status_code: "FINISHED" });
    if (u.pathname === "/graph/ig1/media_publish") return J({ id: "igm1" });
    if (u.pathname === "/graph/igm1") return J({ permalink: "https://www.instagram.com/reel/x/" });
    if (u.pathname === "/graph/page1/videos") return J({ id: "fbfull1" });
    J({ error: "not here: " + u.pathname }, 404);
  });
});
await new Promise((r) => fake.listen(0, "127.0.0.1", r));
const BASE = "http://127.0.0.1:" + fake.address().port;
process.env.CU_SOCIAL_TEST_BASE = BASE;
const SCH = require("./shorts/schedule.js"), FULL = require("./shorts/full.js"), P = require("./shorts/pick.js"), POST = require("./shorts/post.js");

console.log("Social media: the schedule");
const day = (y, m, d, h, mi) => new Date(y, m - 1, d, h || 0, mi || 0).getTime();
const MON = day(2026, 11, 2, 8, 0);   // Monday 2 November 2026, 8:00
await check("one a day at 11:00 from Monday: three approved shorts go out Monday, Tuesday and Wednesday at 11:00, each platform a few minutes after the last", () => {
  const sch = { start: "2026-11-02", times: [{ days: [0, 1, 2, 3, 4, 5, 6], time: "11:00" }], gapHours: 3, spreadMinutes: 10, platforms: { youtube: { on: true }, instagram: { on: true }, facebook: { on: false }, tiktok: { on: false } } };
  let q = []; for (const id of ["a", "b", "c"]) q = SCH.enqueue(q, { ref: "r#" + id, recording: "r", shortId: id }, sch, MON);
  const yt = q.filter((x) => x.platform === "youtube").map((x) => x.dueAt), ig = q.filter((x) => x.platform === "instagram").map((x) => x.dueAt);
  assert.deepEqual(yt, [day(2026, 11, 2, 11), day(2026, 11, 3, 11), day(2026, 11, 4, 11)]);
  assert.deepEqual(ig, [day(2026, 11, 2, 11, 10), day(2026, 11, 3, 11, 10), day(2026, 11, 4, 11, 10)]);
  assert.equal(q.filter((x) => x.platform === "facebook").length, 0, "a platform that's off gets nothing");
  q = SCH.enqueue(q, { ref: "r#a", recording: "r", shortId: "a" }, sch, MON); assert.equal(q.length, 6, "approving the same short again doesn't post it twice");
});
await check("specific days and times, per platform: TikTok only Friday at 18:00; the start date is honoured", () => {
  const sch = { start: "2026-11-04", times: [{ days: [1, 3, 5], time: "09:00" }, { days: [1, 3, 5], time: "18:30" }], gapHours: 2, spreadMinutes: 0, platforms: { youtube: { on: true }, instagram: { on: false }, facebook: { on: false }, tiktok: { on: true, times: [{ days: [5], time: "18:00" }] } } };
  const s = SCH.slots(sch, "youtube", MON, 4); assert.deepEqual(s, [day(2026, 11, 4, 9), day(2026, 11, 4, 18, 30), day(2026, 11, 6, 9), day(2026, 11, 6, 18, 30)]);
  assert.deepEqual(SCH.slots(sch, "tiktok", MON, 2), [day(2026, 11, 6, 18), day(2026, 11, 13, 18)]);
});
await check("never two on one platform closer than the gap", () => {
  const sch = { times: [{ days: [0, 1, 2, 3, 4, 5, 6], time: "09:00" }, { days: [0, 1, 2, 3, 4, 5, 6], time: "10:00" }], gapHours: 3, platforms: { youtube: { on: true }, instagram: { on: false }, facebook: { on: false }, tiktok: { on: false } } };
  let q = []; for (const id of ["a", "b"]) q = SCH.enqueue(q, { ref: "r#" + id }, sch, MON);
  assert.equal(q[1].dueAt - q[0].dueAt >= 3 * 3600e3, true, new Date(q[0].dueAt) + " / " + new Date(q[1].dueAt));
});
await check("the computer was off for three days: it catches up one post per platform at a time, spaced by the gap", () => {
  const sch = { start: "2026-11-02", times: [{ days: [0, 1, 2, 3, 4, 5, 6], time: "11:00" }], gapHours: 3, spreadMinutes: 10, platforms: { youtube: { on: true }, instagram: { on: true }, facebook: { on: false }, tiktok: { on: false } } };
  let q = []; for (const id of ["a", "b", "c"]) q = SCH.enqueue(q, { ref: "r#" + id }, sch, MON);
  const back = day(2026, 11, 5, 8);   // Thursday morning
  let d = SCH.due(q, sch, back); assert.equal(d.length, 2); assert.deepEqual(d.map((x) => x.platform).sort(), ["instagram", "youtube"]);
  d.forEach((x) => SCH.posted(x, { id: "p" }, back));
  assert.equal(SCH.due(q, sch, back + 60e3).length, 0, "not straight after");
  assert.equal(SCH.due(q, sch, back + 3 * 3600e3 + 1).length, 2, "the next ones after the gap");
});
await check("a failure is tried again after 5 min, 30 min, 2 h and 6 h, then waits for Try again; Post now and Skip", () => {
  const q = { platform: "youtube", status: "queued", dueAt: MON, tries: 0 };
  SCH.failed(q, "boom", MON); assert.equal(q.nextTry, MON + 5 * 60e3);
  SCH.failed(q, "boom", MON); assert.equal(q.nextTry, MON + 30 * 60e3);
  SCH.failed(q, "boom", MON); SCH.failed(q, "boom", MON); assert.equal(q.nextTry, MON + 360 * 60e3);
  SCH.failed(q, "boom", MON); assert.equal(q.nextTry, null); assert.equal(q.status, "failed");
  assert.equal(SCH.due([q], {}, MON + 999e6).length, 0, "after the last try it waits");
  SCH.retry(q, MON); assert.equal(q.status, "queued"); assert.equal(SCH.due([q], {}, MON).length, 1);
  const r = { platform: "tiktok", status: "queued", dueAt: MON + 864e5 }; SCH.postNow(r, MON); assert.equal(SCH.due([r], {}, MON + 1).length, 1);
  SCH.skip(r); assert.equal(SCH.due([r], {}, MON + 864e5 * 2).length, 0);
});
await check("the description: the church's template, the link to the whole service, the church's links; an empty link leaves no dangling line", () => {
  const v = { description: "From Sunday's message.", hashtags: "#church #grace", link: "https://www.youtube.com/watch?v=LIVE123", links: "gracechurch.org", title: "t" };
  assert.equal(SCH.describe(null, v), "From Sunday's message.\n\nWatch the whole service: https://www.youtube.com/watch?v=LIVE123\n\ngracechurch.org\n\n#church #grace");
  assert.equal(SCH.describe(null, Object.assign({}, v, { link: "", links: "" })), "From Sunday's message.\n\n#church #grace");
  assert.equal(SCH.describe("{title} | {church}\n{link}", { title: "Grace", church: "Grace Church", link: "L" }), "Grace | Grace Church\nL");
});
await check("the link to the whole service: the live stream that started closest to the service", async () => {
  const near = await POST.liveLink("yt-token", Date.now() - 2 * 3600e3); assert.equal(near.url, "https://www.youtube.com/watch?v=LIVE123");
  const old = await POST.liveLink("yt-token", Date.now() - 8 * 864e5); assert.equal(old.url, "https://www.youtube.com/watch?v=OLDLIVE");
});

// ---------------------------------------------------------------- the full videos
console.log("Social media: the full worship and sermon videos");
const SR = 16000, SONG1 = [0, 90], PRAYER = [90, 130], SONG2 = [130, 230], GAP = [230, 250];
const SCRIPT = ["Good morning, open your Bibles to Romans chapter eight.", "First, God is for us and not against us.", "Paul says in verse thirty one that if God is for us nothing can stand against us.", "That means your past does not get the last word.",
  "I remember when my father taught me to ride a bike.", "He let go and I fell, and I thought he had left me.", "That's when I saw him running right beside me.", "And that's what God does for you.",
  "Second, nothing can separate us from his love.", "Not death, not life, not anything you have done.", "The word here in the Greek means to cut apart.", "Nothing can cut you off from him.",
  "Finally, we are more than conquerors.", "So this week I want you to live like someone who is loved.", "Will you take that step today?", "Let's pray."];
// words: each sermon sentence takes ~6-9 s; the sermon is repeated to last ~6 minutes
const sermonWords = []; { let t = 255; for (let rep = 0; rep < 3; rep++) for (const s of SCRIPT) { for (const w of s.split(" ")) { const d = 0.3 + (w.length % 4) * 0.04; sermonWords.push({ text: w, start: +t.toFixed(3), end: +(t + d).toFixed(3) }); t += d + 0.1; } t += 1.2; } }
const TOTAL = Math.ceil(sermonWords[sermonWords.length - 1].end + 8);
{
  const n = TOTAL * SR, pcm = new Int16Array(n); let seed = 3; const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff * 2 - 1; };
  const voiced = new Uint8Array(n); sermonWords.forEach((w) => { for (let i = Math.floor(w.start * SR); i < Math.floor(w.end * SR) && i < n; i++) voiced[i] = 1; });
  for (let i = 0; i < n; i++) {
    const t = i / SR; let v = rnd() * 0.002;
    const inSong = (t >= SONG1[0] && t < SONG1[1]) || (t >= SONG2[0] && t < SONG2[1]);
    if (inSong) { const ch = [[220, 277, 330], [196, 247, 294]][Math.floor(t / 8) % 2]; v = ch.reduce((s, f) => s + Math.sin(2 * Math.PI * f * t), 0) * 0.1; }
    else if (t >= PRAYER[0] && t < PRAYER[1] || voiced[i]) { const on = t < PRAYER[1] ? (Math.floor(t * 3) % 4 !== 3 ? 1 : 0) : 1; v = on * (Math.sin(2 * Math.PI * 130 * t) * 0.5 + Math.sin(4 * Math.PI * 130 * t) * 0.3) * 0.3 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 4.5 * t)); }
    pcm[i] = Math.round(Math.max(-1, Math.min(1, v)) * 32767);
  }
  const buf = Buffer.alloc(44 + n * 2); buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVEfmt ", 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  Buffer.from(pcm.buffer).copy(buf, 44);
  fs.mkdirSync(path.join(tmp, "rec", "2026-11-01 10.30 - Sunday"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "rec", "2026-11-01 10.30 - Sunday", "Stream mix.wav"), buf); fs.writeFileSync(path.join(tmp, "words.json"), JSON.stringify(sermonWords));
}
const recDir = path.join(tmp, "rec", "2026-11-01 10.30 - Sunday"), A = require("./shorts/audio.js");
let feats = null, reg = null, cut = null;
await check("the cuts: the worship set is both songs with the prayer between them, the sermon from its first sentence to its last", async () => {
  feats = await A.analyze(FF, path.join(recDir, "Stream mix.wav"), {});
  reg = P.regions(feats, [{ t: 0, song: "Amazing Grace", section: "Verse 1" }, { t: 45, song: "Amazing Grace", section: "Chorus" }, { t: 90, song: "Amazing Grace", playing: false }, { t: 130, song: "Be Thou My Vision", section: "Verse 1" }, { t: 180, song: "Be Thou My Vision", section: "Bridge" }, { t: 230, song: "Be Thou My Vision", playing: false }]);
  cut = FULL.cuts(reg, feats, P.sentences(sermonWords), { minSermon: 120, minSet: 60 });
  assert.ok(cut.worship && cut.worship.start <= 1 && cut.worship.end >= 229 && cut.worship.end <= 242, JSON.stringify(cut.worship));
  assert.deepEqual(cut.worship.songs.map((s) => s.name), ["Amazing Grace", "Be Thou My Vision"]); assert.ok(Math.abs(cut.worship.songs[1].at - 130) < 3);
  assert.ok(cut.sermon && Math.abs(cut.sermon.start - 254) < 1.5 && Math.abs(cut.sermon.end - (sermonWords[sermonWords.length - 1].end + 1.5)) < 0.5, JSON.stringify([cut.sermon.start, cut.sermon.end]));
});
await check("the sermon's chapters are its main points (first, second, finally, the call to action), from 0:00, in a description YouTube reads", () => {
  const ch = cut.sermon.chapters; assert.ok(ch.length >= 3, JSON.stringify(ch)); assert.equal(ch[0].at, 0);
  assert.ok(ch.some((c) => /^First, God is for us/.test(c.title))); assert.ok(ch.some((c) => /^Second, nothing can separate/.test(c.title)));
  for (let i = 1; i < ch.length; i++) assert.ok(ch[i].at - ch[i - 1].at >= 10);
  const d = FULL.sermonDescription(cut.sermon, { speaker: "Pastor Ann", scripture: "Romans 8", link: "https://www.youtube.com/watch?v=LIVE123", hashtags: "#sermon" });
  assert.match(d, /^Pastor Ann · Romans 8/); assert.match(d, /\n0:00 First, God is for us/); assert.match(d, /The whole service: https:\/\/www\.youtube\.com\/watch\?v=LIVE123/);
  assert.match(FULL.worshipDescription(cut.worship, {}), /Songs:\n0:00 Amazing Grace\n2:1\d Be Thou My Vision/);
  assert.equal(FULL.title("{sermon} - {speaker}", { sermon: "More than conquerors", speaker: "" }), "More than conquerors");
});
await check("the key moments: the main points, the call to action, the scripture explained and the story's payoff are found", () => {
  const st = P.structure(P.sentences(sermonWords)), has = (k) => st.roles.some((r) => r[k]);
  assert.ok(has("point") && has("action") && has("explain") && has("payoff"), JSON.stringify(st.roles.slice(0, 16)));
  const cs = P.sermonCandidates(P.sentences(sermonWords), feats, { minLen: 15, maxLen: 40 });
  const withPayoff = cs.filter((c) => c.key.includes("payoff")), without = cs.filter((c) => !c.key.length);
  assert.ok(withPayoff.length && without.length && Math.max(...withPayoff.map((c) => c.score)) > Math.max(...without.map((c) => c.score)), "a story's payoff outranks a plain passage");
});

// ---------------------------------------------------------------- the whole thing through the main process
console.log("Social media: approve, queue, post (the main process)");
const handlers = {}, ipcMain = { handle: (k, f) => { handlers[k] = f; }, on: (k, f) => { handlers[k] = f; } }, call = (k, ...a) => handlers[k]({}, ...a);
const userData = path.join(tmp, "user"); fs.mkdirSync(userData, { recursive: true });
const app = { getPath: (k) => k === "userData" ? userData : tmp };
const svc = { isMain: () => true, recordDir: () => path.join(tmp, "rec"), churchName: () => "Grace Church", on() { }, recorder: { on() { } } };
process.env.CU_SHORTS_TICK = "300";
const idx = require("./shorts/index.js").setup({ ipcMain, app, getWin: () => null, svc, videoDir: () => path.join(tmp, "nothing"), ffmpeg: () => FF, shell: { openPath() { }, openExternal() { } }, dialog: {} });
const wait = async (f, ms) => { const t0 = Date.now(); while (Date.now() - t0 < (ms || 20000)) { const v = await f(); if (v) return v; await new Promise((r) => setTimeout(r, 150)); } throw new Error("timed out"); };
const RID = recDir;
await check("making the shorts and the full videos of a recording (worship and sermon switched on)", async () => {
  await call("shorts-settings", { count: 2, minLen: 15, maxLen: 30, sermonShare: 0.5, useAI: false, learn: false, full: { height: 720, minSermonMinutes: 2, minWorshipMinutes: 1, speaker: "Pastor Ann", scripture: "Romans 8", worship: { on: true, privacy: "unlisted", playlist: "Worship" }, sermon: { on: true, privacy: "public", playlist: "Sermons", platforms: { youtube: true, facebook: true } } },
    schedule: { start: "", times: [{ days: [0, 1, 2, 3, 4, 5, 6], time: "11:00" }], gapHours: 3, spreadMinutes: 10, platforms: { youtube: { on: true }, instagram: { on: true }, facebook: { on: true }, tiktok: { on: false } } }, linkMode: "live", links: "gracechurch.org" });
  // (the markers and the words the recording would have)
  fs.writeFileSync(path.join(recDir, "markers.json"), JSON.stringify({ started: Date.now() - 3600e3, marks: [{ at: Date.now() - 3600e3, song: "Amazing Grace", section: "Verse 1", playing: true }, { at: Date.now() - 3600e3 + 45e3, song: "Amazing Grace", section: "Chorus", playing: true }, { at: Date.now() - 3600e3 + 90e3, song: null, playing: false }, { at: Date.now() - 3600e3 + 130e3, song: "Be Thou My Vision", section: "Verse 1", playing: true }, { at: Date.now() - 3600e3 + 230e3, song: null, playing: false }] }));
  process.env.CU_SHORTS_FAKE_WORDS = path.join(tmp, "words.json");
  const recs = await call("shorts-recordings"); assert.equal(recs.length, 1);
  await call("shorts-make", RID);
  const d = await wait(async () => { const r = await call("shorts-list", RID); return r.data && r.data.finished && r.data; }, 900000);
  assert.equal(d.shorts.length, 2); assert.ok(d.full && d.full.worship && d.full.sermon, JSON.stringify(Object.keys(d.full || {})) + " " + d.fullNote);
  for (const k of ["worship", "sermon"]) { assert.ok(fs.existsSync(path.join(recDir, "..", "Shorts", "2026-11-01 10.30 - Sunday", d.full[k].file))); assert.ok(fs.existsSync(path.join(recDir, "..", "Shorts", "2026-11-01 10.30 - Sunday", d.full[k].thumb))); }
  const pr = spawnSync(FF, ["-hide_banner", "-i", path.join(recDir, "..", "Shorts", "2026-11-01 10.30 - Sunday", d.full.sermon.file)], { encoding: "utf8" }).stderr; assert.match(pr, /1280x720/);
  assert.match(d.full.sermon.description, /Pastor Ann · Romans 8/); assert.match(d.full.worship.description, /Amazing Grace/);
});
await check("approving a short puts it in the queue for each platform that's on; nothing posts until the website sign-in is there", async () => {
  const d = (await call("shorts-list", RID)).data, s = d.shorts[0];
  await call("shorts-update", RID, s.id, { status: "approved" });
  const q = await call("shorts-queue"); const mine = q.items.filter((x) => x.shortId === s.id);
  assert.deepEqual(mine.map((x) => x.platform).sort(), ["facebook", "instagram", "youtube"]); assert.ok(mine.every((x) => x.status === "queued" && x.dueAt > Date.now()));
  assert.equal(q.signedIn, false);
});
await check("Post now: it posts, with the description's link to the live stream; a failure on Facebook is tried again later", async () => {
  await call("shorts-account", { server: BASE, token: "site-token" });
  const q = (await call("shorts-queue")).items; for (const x of q.filter((x) => x.status === "queued")) await call("shorts-queue-action", x.id, "now");
  const done = await wait(async () => { const it = (await call("shorts-queue")).items; return it.filter((x) => x.shortId).every((x) => x.status === "posted" || x.status === "failed") && it; });
  const yt = done.find((x) => x.platform === "youtube" && x.shortId), fb = done.find((x) => x.platform === "facebook" && x.shortId), ig = done.find((x) => x.platform === "instagram");
  assert.equal(yt.status, "posted"); assert.equal(ig.status, "posted");
  assert.equal(fb.status, "failed"); assert.match(fb.error, /Temporary problem/); assert.ok(fb.nextTry > Date.now() + 4 * 60e3, "tried again in 5 minutes");
  const meta = seen.filter((x) => x.p === "/yt/upload").pop(); const snip = JSON.parse(meta.body).snippet;
  assert.match(snip.description, /Watch the whole service: https:\/\/www\.youtube\.com\/watch\?v=LIVE123/); assert.match(snip.description, /gracechurch\.org/);
  const short = (await call("shorts-list", RID)).data.shorts[0]; assert.equal(short.status, "posted"); assert.ok(short.posts.some((p) => p.platform === "youtube" && p.ok));
  await call("shorts-queue-action", fb.id, "retry");
  await wait(async () => (await call("shorts-queue")).items.find((x) => x.id === fb.id).status === "posted");
});
await check("approving the full sermon video: YouTube (public, the Sermons playlist, its thumbnail) and Facebook (it's on for the sermon); the worship video only to YouTube, unlisted", async () => {
  await call("shorts-full-update", RID, "sermon", { status: "approved" }); await call("shorts-full-update", RID, "worship", { status: "approved" });
  const items = (await call("shorts-queue")).items.filter((x) => x.full);
  assert.deepEqual(items.filter((x) => x.full === "sermon").map((x) => x.platform).sort(), ["facebook", "youtube"]); assert.deepEqual(items.filter((x) => x.full === "worship").map((x) => x.platform), ["youtube"]);
  const before = seen.length; for (const x of items) await call("shorts-queue-action", x.id, "now");
  await wait(async () => (await call("shorts-queue")).items.filter((x) => x.full).every((x) => x.status === "posted"), 60000);
  const ups = seen.slice(before).filter((x) => x.p === "/yt/upload").map((x) => JSON.parse(x.body));
  const sermon = ups.find((u) => /Pastor Ann/.test(u.snippet.description)), worship = ups.find((u) => /Amazing Grace/.test(u.snippet.description));
  assert.equal(sermon.status.privacyStatus, "public"); assert.equal(worship.status.privacyStatus, "unlisted"); assert.ok(!/#Shorts/.test(sermon.snippet.description));
  assert.ok(seen.slice(before).some((x) => x.p === "/yt/thumb"), "the thumbnail"); assert.ok(seen.slice(before).some((x) => x.p === "/yt/v3/playlistItems" && /PLsermonsxxxxxx/.test(x.body)), "into the Sermons playlist");
  assert.ok(seen.slice(before).some((x) => x.p === "/yt/v3/playlists" && x.m === "POST"), "the Worship playlist is made");
  assert.ok(seen.slice(before).some((x) => x.p === "/graph/page1/videos"), "the sermon on the Facebook Page");
});
await check("Skip and Later on a queued item", async () => {
  const d = (await call("shorts-list", RID)).data, s = d.shorts[1];
  await call("shorts-update", RID, s.id, { status: "approved" });
  const it = (await call("shorts-queue")).items.filter((x) => x.shortId === s.id), yt = it.find((x) => x.platform === "youtube");
  await call("shorts-queue-action", yt.id, "later"); const moved = (await call("shorts-queue")).items.find((x) => x.id === yt.id); assert.ok(moved.dueAt > yt.dueAt);
  await call("shorts-queue-action", yt.id, "skip"); assert.equal((await call("shorts-queue")).items.find((x) => x.id === yt.id).status, "skipped");
  await call("shorts-update", RID, s.id, { status: "new" }); assert.equal((await call("shorts-queue")).items.filter((x) => x.shortId === s.id && x.status === "queued").length, 0, "un-approving takes it out of the queue");
});
idx.stop(); fake.close();
if (!failures) fs.rmSync(tmp, { recursive: true, force: true }); else console.log("  (kept " + tmp + ")");
console.log(failures ? "\n" + failures + " FAILED" : "\nall passed");
process.exit(failures ? 1 : 0);
