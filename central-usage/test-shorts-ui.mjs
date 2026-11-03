// Shorts (10.2): the review screen (app/shorts.js) in a browser, against a stand-in for the main process - the recordings,
// the shorts as cards, one short opened: play, title, trim, captions, approve, post, make another from here, delete;
// the settings and the accounts; the progress of a job; another computer than the main admin's.
//   node central-usage/test-shorts-ui.mjs [ffmpeg]
import { existsSync as require_fs_exists } from "node:fs";   // (a local browser path only when it exists; CI uses Playwright's own)
import { chromium } from "playwright";
import { spawnSync } from "node:child_process";
import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import assert from "node:assert"; import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url)), FF = process.argv[2] || process.env.CU_FFMPEG || "ffmpeg";
let failures = 0; async function check(label, fn) { try { await fn(); console.log("  ✓ " + label); } catch (e) { failures++; console.error("  ✗ " + label + "\n      " + String(e && e.message || e).split("\n").slice(0, 6).join("\n      ")); } }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cu-shorts-ui-")), dir = path.join(tmp, "Shorts", "2026-11-01 10.30 - Sunday");
fs.mkdirSync(dir, { recursive: true });
for (const n of ["short-01", "short-02"]) {
  const r = spawnSync(FF, ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=270x480:r=15:d=4", "-f", "lavfi", "-i", "sine=f=440:d=4", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", path.join(dir, n + ".mp4")]);
  if (r.status !== 0) { console.error("ffmpeg: " + r.stderr); process.exit(1); }
  spawnSync(FF, ["-hide_banner", "-loglevel", "error", "-y", "-i", path.join(dir, n + ".mp4"), "-frames:v", "1", path.join(dir, n + ".jpg")]);
}
const words = "You are loved more than you know grace is not earned".split(" ").map((t, i) => ({ text: t, start: 600 + i * 0.4, end: 600 + i * 0.4 + 0.35 }));
const data = { version: 1, recording: "2026-11-01 10.30 - Sunday", created: Date.now() - 3600e3, finished: Date.now() - 3000e3, settings: {}, hasWords: true, shorts: [
  { id: "sA", n: 1, kind: "sermon", start: 600, end: 640, seconds: 40, score: 0.8, why: "the AI rated it 9/10, the room responded", title: "You are loved more than you know", description: "From Sunday's message.", hashtags: ["#sermon"], words, status: "new", posts: [], file: "short-01.mp4", thumb: "short-01.jpg", rendered: 1 },
  { id: "sB", n: 2, kind: "worship", song: "Amazing Grace", label: "Chorus", start: 120, end: 155, seconds: 35, score: 0.7, why: "the chorus", title: "Amazing Grace (chorus) - live", description: "Worship.", hashtags: [], words: [], status: "new", posts: [], file: "short-02.mp4", thumb: "short-02.jpg", rendered: 1 }
] };
const recs = [
  { id: "/rec/2026-11-01 10.30 - Sunday", name: "2026-11-01 10.30 - Sunday", when: Date.now() - 7200e3, seconds: 5400, audio: "/rec/a/Stream mix.wav", video: "/v/Stream.mp4", markers: true, dir, shorts: 2 },
  { id: "/rec/2026-10-25 10.30 - Sunday", name: "2026-10-25 10.30 - Sunday", when: Date.now() - 8 * 864e5, seconds: 5000, audio: "/rec/b/Program.wav", video: null, markers: false, dir: path.join(tmp, "Shorts", "x"), shorts: 0 }
];
const settings = { auto: true, useAI: true, minRecording: 10, count: 5, minLen: 30, maxLen: 60, sermonShare: 0.6, framing: "auto", background: "#16181d", accent: "#ffd23f", logo: "", logoCorner: "top-right", logoSize: 16, intro: "", outro: "", privacy: "public", hashtags: "", tiktokDirect: false, captions: { on: true, font: "Archivo SemiBold", size: 4.6, color: "#ffffff", highlight: "#ffd23f", outline: "#000000", position: "bottom", upper: false, words: 4, box: false } };
// the stand-in for window.CU.shorts (the main process); every call is recorded
const harness = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${path.join(here, "app", "style.css")}"><link rel="stylesheet" href="${path.join(here, "app", "shorts.css")}"></head>
<body><section class="view active" id="view-shorts"><div id="shortsRoot" class="pad-view"></div></section><script>
window.CUShortsHarness = true; window.calls = []; window.__isMain = true;
const D = ${JSON.stringify({ data, recs, settings, dir })}; let fn = null;
const call = (n, a) => { window.calls.push([n].concat(a)); };
window.PPLicense = { server: () => "https://example.test", state: () => ({ account: { token: "tok-1" } }) };
window.CU = { shorts: {
  status: async () => (call("status", []), { isMain: window.__isMain, settings: D.settings, job: window.__job || null, queued: [], speech: true, ai: true, ffmpeg: true, folder: "/rec/Shorts" }),
  recordings: async () => (call("recordings", []), D.recs),
  list: async (id) => (call("list", [id]), { recording: D.recs.find((r) => r.id === id), data: id === D.recs[0].id ? D.data : null, base: id === D.recs[0].id ? D.dir : "" }),
  settings: async (p) => (call("settings", [p]), Object.assign(D.settings, p)), resetSettings: async () => D.settings,
  make: async (id) => (call("make", [id]), { isMain: true, settings: D.settings, job: { id, mode: "make", step: "start", pct: 0, text: "Starting" }, queued: [] }),
  cancel: async () => (call("cancel", []), { isMain: true, settings: D.settings, job: null, queued: [] }),
  update: async (id, sid, p) => { call("update", [id, sid, p]); const s = D.data.shorts.find((x) => x.id === sid); Object.assign(s, p.status ? { status: p.status } : {}, p.title ? { title: p.title } : {}, p.start != null ? { start: p.start, end: p.end } : {}); return s; },
  remove: async (id, sid) => { call("remove", [id, sid]); D.data.shorts = D.data.shorts.filter((x) => x.id !== sid); return { ok: true }; },
  add: async (id, at) => (call("add", [id, at]), { isMain: true, settings: D.settings, job: null, queued: [] }),
  reveal: async (id) => call("reveal", [id]), download: async (id, sid) => (call("download", [id, sid]), { saved: "/home/me/Downloads/short.mp4" }), pickFile: async (k) => (call("pickFile", [k]), "/pics/logo.png"),
  social: async (a) => (call("social", [a]), { platforms: { youtube: { available: true, connected: true, account: "Grace Church" }, facebook: { available: true, connected: false }, instagram: { available: true, connected: false }, tiktok: { available: false, connected: false } } }),
  connect: async (p, a) => (call("connect", [p, a]), { opened: true }), disconnect: async (p, a) => (call("disconnect", [p, a]), { ok: true }),
  post: async (id, sid, p, a) => { call("post", [id, sid, p, a]); const s = D.data.shorts.find((x) => x.id === sid); const e = { platform: p, at: Date.now(), ok: true, id: "yt1", url: "https://www.youtube.com/shorts/yt1" }; s.posts.push(e); s.status = "posted"; return e; },
  history: async () => [], openUrl: async (u) => call("openUrl", [u]), mark: (d) => call("mark", [d]), on: (f) => { fn = f; }
} };
window.__emit = (m) => fn && fn(m);
</script><script src="${path.join(here, "app", "shorts.js")}"></script></body></html>`;
fs.writeFileSync(path.join(tmp, "harness.html"), harness);

const b = await chromium.launch({ executablePath: [process.env.CHROME, "/opt/pw-browsers/chromium"].find((p) => p && require_fs_exists(p)), args: ["--autoplay-policy=no-user-gesture-required", "--allow-file-access-from-files"] });
const page = await b.newPage({ viewport: { width: 1280, height: 900 } }); const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
await page.goto("file://" + path.join(tmp, "harness.html")); await page.waitForSelector(".sh-card");
const calls = async (name) => (await page.evaluate(() => window.calls)).filter((c) => c[0] === name);

await check("the recordings: newest first, with camera / songs marked / how many shorts", async () => {
  const items = await page.$$eval(".sh-reclist li", (l) => l.map((e) => e.textContent)); assert.equal(items.length, 2);
  assert.match(items[0], /Sunday.*camera.*songs marked.*2 shorts/s); assert.match(items[1], /sound only/);
});
await check("the shorts as tall cards with their title, kind and length", async () => {
  const cards = await page.$$eval(".sh-card", (l) => l.map((e) => e.textContent)); assert.equal(cards.length, 2);
  assert.match(cards[0], /Sermon/); assert.match(cards[0], /You are loved/); assert.match(cards[0], /0:40/); assert.match(cards[1], /Worship/);
  const img = await page.$eval(".sh-card img", (i) => i.naturalWidth); assert.ok(img > 0, "the picture loads");
});
await check("the filter: none approved yet", async () => { await page.selectOption('[data-sh="filter"]', "approved"); assert.match(await page.textContent(".sh-list"), /None here/); await page.selectOption('[data-sh="filter"]', "all"); });
await check("a recording without shorts offers Make shorts, which starts the job and shows its progress", async () => {
  await page.click(".sh-reclist li:nth-child(2)"); await page.waitForFunction(() => /No shorts from this recording yet/.test(document.querySelector(".sh-list").textContent));
  await page.click('[data-sh="make"]'); await page.waitForSelector(".sh-job"); assert.equal((await calls("make"))[0][1], "/rec/2026-10-25 10.30 - Sunday");
  await page.evaluate(() => window.__emit({ type: "progress", job: { id: "/rec/2026-10-25 10.30 - Sunday", mode: "make", step: "words", pct: 0.42, text: "Writing down the sermon's words" } }));
  await page.waitForFunction(() => /Writing down/.test(document.querySelector(".sh-job").textContent)); const w = await page.$eval(".sh-bar i", (i) => i.style.width); assert.equal(w, "42%");
  await page.click('[data-sh="cancel"]'); assert.equal((await calls("cancel")).length, 1);
  await page.click(".sh-reclist li:nth-child(1)"); await page.waitForSelector(".sh-card");
});
if (process.env.SHORTS_SHOTS) await page.screenshot({ path: path.join(process.env.SHORTS_SHOTS, "shorts-list.png") });
await check("opening a short: the video, its title, why it was picked; posting waits for Approve", async () => {
  await page.click('.sh-card[data-open="sA"]'); await page.waitForSelector(".sh-ed video");
  if (process.env.SHORTS_SHOTS) { await page.waitForTimeout(500); await page.screenshot({ path: path.join(process.env.SHORTS_SHOTS, "shorts-editor.png") }); }
  assert.match(await page.$eval(".sh-ed video", (v) => v.src), /short-01\.mp4/); assert.match(await page.textContent(".sh-edhead"), /AI rated it 9\/10/);
  await page.waitForFunction(() => document.querySelector('[data-post="youtube"]'));
  assert.ok(await page.$eval('[data-post="youtube"]', (x) => x.disabled), "not before it's approved"); assert.match(await page.textContent(".sh-post"), /Approve it to post it/);
  assert.match(await page.$eval('[data-post="tiktok"]', (x) => x.title), /Not switched on yet/);
});
await check("Save sends the new title; nudging the start trims it and makes it again", async () => {
  await page.fill('[data-f="title"]', "Loved more than you know"); await page.click('[data-nudge="a:1"]'); await page.click('[data-nudge="a:1"]');
  assert.match(await page.textContent("[data-trimtext]"), /10:02\.0 – 10:40\.0 \(38\.0 s\)/);
  await page.click('[data-ed="save"]'); await page.waitForFunction(() => window.calls.some((c) => c[0] === "update"));
  const u = (await calls("update")).pop()[3]; assert.equal(u.title, "Loved more than you know"); assert.equal(u.start, 602); assert.equal(u.end, 640);
  await page.waitForFunction(() => /Making it again/.test(document.querySelector(".sh-note").textContent));
});
await check("dragging the end handle with the keyboard, and editing the captions", async () => {
  await page.focus(".sh-h.b"); await page.keyboard.press("ArrowLeft"); await page.keyboard.press("ArrowLeft");
  assert.match(await page.textContent("[data-trimtext]"), /– 10:38\.0/);
  await page.fill('[data-f="captions"]', "You are LOVED more than you know grace is not earned");
  await page.click('[data-ed="save"]'); const u = (await calls("update")).pop()[3]; assert.equal(u.captionsText, "You are LOVED more than you know grace is not earned"); assert.equal(u.end, 638);
});
await check("Approve, then post to YouTube: the church's account, the link afterwards; Facebook needs connecting first", async () => {
  await page.click('[data-ed="approve"]'); await page.waitForFunction(() => window.calls.some((c) => c[0] === "update" && c[3].status === "approved"));
  await page.waitForFunction(() => document.querySelector('[data-post="youtube"]') && !document.querySelector('[data-post="youtube"]').disabled);
  assert.ok(await page.$eval('[data-post="facebook"]', (x) => x.disabled)); assert.match(await page.$eval('[data-post="facebook"]', (x) => x.title), /Connect it/);
  await page.click('[data-post="youtube"]'); await page.waitForFunction(() => window.calls.some((c) => c[0] === "post"));
  const p = (await calls("post")).pop(); assert.equal(p[3], "youtube"); assert.deepEqual(p[4], { server: "https://example.test", token: "tok-1" });
  await page.waitForFunction(() => /open/.test((document.querySelector(".sh-hist") || {}).textContent || "")); await page.click(".sh-hist a"); assert.equal((await calls("openUrl")).pop()[1], "https://www.youtube.com/shorts/yt1");
});
await check("Copy caption, Download, and Make another from here (at the video's moment)", async () => {
  await page.click('[data-ed="download"]'); assert.equal((await calls("download")).length, 1);
  await page.evaluate(() => { const v = document.querySelector(".sh-ed video"); try { v.currentTime = 1.5; } catch (_) { } });
  await page.waitForFunction(() => document.querySelector(".sh-ed video").currentTime > 1, null, { timeout: 5000 }).catch(() => { });
  await page.click('[data-ed="another"]'); const a = (await calls("add")).pop(); assert.equal(a[1], recs[0].id); assert.ok(a[2] >= 602 && a[2] <= 605, "at " + a[2]);
});
await check("Delete asks first, then the card is gone", async () => {
  await page.click('[data-ed="delete"]'); await page.click('dialog.ask [data-a="yes"]'); await page.waitForFunction(() => document.querySelectorAll(".sh-card").length === 1);
  assert.equal((await calls("remove")).pop()[2], "sA");
});
await check("Settings: how many, how long, the mix, the captions' look (with a preview), saved together", async () => {
  await page.click('[data-sh="settings"]'); await page.waitForSelector("dialog.sh-dlg");
  await page.fill('dialog.sh-dlg [name="count"]', "7"); await page.fill('dialog.sh-dlg [name="maxLen"]', "45");
  await page.$eval('dialog.sh-dlg [name="sermonShare"]', (r) => { r.value = "40"; r.dispatchEvent(new Event("input", { bubbles: true })); }); assert.match(await page.textContent("[data-mix]"), /40% sermon · 60% worship/);
  await page.$eval('dialog.sh-dlg [name="c_highlight"]', (r) => { r.value = "#ff3366"; r.dispatchEvent(new Event("input", { bubbles: true })); }); await page.selectOption('dialog.sh-dlg [name="c_position"]', "top");
  assert.equal(await page.$eval("[data-prev]", (p) => p.style.getPropertyValue("--h")), "#ff3366");
  if (process.env.SHORTS_SHOTS) await page.screenshot({ path: path.join(process.env.SHORTS_SHOTS, "shorts-settings.png") });
  await page.click('dialog.sh-dlg [data-pick="logo"]'); await page.waitForFunction(() => /logo\.png/.test(document.querySelector('[data-shown="logo"]').textContent));
  await page.click('dialog.sh-dlg button[value="save"]'); await page.waitForFunction(() => window.calls.some((c) => c[0] === "settings"));
  const s = (await calls("settings")).pop()[1]; assert.equal(s.count, 7); assert.equal(s.maxLen, 45); assert.equal(s.sermonShare, 0.4); assert.equal(s.captions.highlight, "#ff3366"); assert.equal(s.captions.position, "top"); assert.equal(s.logo, "/pics/logo.png");
});
await check("Accounts: YouTube connected, Facebook / Instagram to connect (one sign-in), TikTok not switched on yet", async () => {
  await page.click('[data-sh="accounts"]'); await page.waitForFunction(() => /Connected: Grace Church/.test((document.querySelector("dialog.sh-dlg") || {}).textContent || ""));
  const t = await page.textContent("dialog.sh-dlg"); assert.match(t, /TikTok\s*Not switched on yet/); assert.equal(await page.$$eval("dialog.sh-dlg [data-con]", (l) => l.length), 2);
  await page.click('dialog.sh-dlg [data-con="meta"]'); assert.equal((await calls("connect")).pop()[1], "meta");
  await page.click('dialog.sh-dlg [data-a="close"]');
});
await check("on another computer than the main admin's it says where shorts are made", async () => {
  await page.evaluate(async () => { window.__isMain = false; await window.CUShorts.refresh(); }); assert.match(await page.textContent("#shortsRoot"), /made on the main admin's computer/);
});
await check("the tab is the main admin's only, and the page has no errors", async () => {
  const appJs = fs.readFileSync(path.join(here, "app", "app.js"), "utf8"), m = /var MODES = \{ main: (\[[^\]]+\]), admin: (\[[^\]]+\])/.exec(appJs);
  assert.ok(JSON.parse(m[1]).includes("shorts") && !JSON.parse(m[2]).includes("shorts"));
  const html = fs.readFileSync(path.join(here, "app", "index.html"), "utf8"); assert.match(html, /data-tab="shorts"/); assert.match(html, /id="view-shorts"/); assert.match(html, /src="shorts\.js"/);
  assert.deepEqual(errs, []);
});
await b.close();
if (!failures) fs.rmSync(tmp, { recursive: true, force: true }); else console.log("  (kept " + tmp + ")");
console.log(failures ? "\n" + failures + " FAILED" : "\nall passed"); process.exit(failures ? 1 : 0);
