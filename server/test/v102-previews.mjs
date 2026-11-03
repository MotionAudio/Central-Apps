// 10.2: listen before you download or buy - the website's 30-second previews:
//   * /v1/libraries passes each library's previews on (from the published index, with their addresses; the built-in list
//     names the ones a build makes) - only real preview files, no other addresses;
//   * a Central Tracks song: GET /v1/tracks/:id/preview.mp3 cuts the loudest 30 seconds of its mix once and keeps it
//     (a second listen gets the same file; a new mix makes a new one); the track list says where it is;
//   * a hymn: its preview is the one the build made (on the release), not cut again;
//   * community uploads: a loop without a demo clip gets its preview from the loop, an instrument from samples named by
//     note gets one from its samples, a demo clip is cut to 30 seconds; the community list says where each is;
//   * the pages (Playwright): the plan cards' "Hear it", the Downloads page's Listen folds, the Central Tracks table.
// Makes its own database and drops it at the end.
//   node test/v102-previews.mjs postgres://postgres@127.0.0.1:55432/postgres [port]
import { spawn, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const admin = process.argv[2] || "postgres://postgres@127.0.0.1:55432/postgres", port = Number(process.argv[3] || 19120);
const S = Date.now(), dbName = "ma_v102_" + S, db = admin.replace(/\/[^/]*$/, "/" + dbName);
const pg = (await import("pg")).default;
async function sql(text) { const c = new pg.Client({ connectionString: admin }); await c.connect(); try { await c.query(text); } finally { await c.end(); } }
await sql("CREATE DATABASE " + dbName);
const files = fs.mkdtempSync(path.join(os.tmpdir(), "ma-v102-"));
const base = "http://127.0.0.1:" + port;
Object.assign(process.env, { DATABASE_URL: db, LOCAL_STORAGE_DIR: files, PUBLIC_URL: base, STRIPE_SECRET_KEY: "", RESEND_API_KEY: "" });

// a stand-in for the "libraries" release: its index with previews
const INDEX = { format: 1, libraries: [{ id: "central-pads-library", plan: "pads", title: "Central Pads Library", version: "1.2", file: "central-pads-library-1.2.zip", size: 1000, sha256: "e".repeat(64),
  url: "https://cdn.example/central-pads-library-1.2.zip", contents: { pads: ["Warm"] },
  previews: [{ kind: "pad", name: "Warm", file: "preview--central-pads--pad--warm.mp3", url: "https://cdn.example/preview--central-pads--pad--warm.mp3", seconds: 30 },
    { kind: "loops", name: "Ambient loops", set: "ambient", file: "preview--central-pads--loops--ambient-loops.mp3", url: "https://cdn.example/preview--central-pads--loops--ambient-loops.mp3" },
    { kind: "pad", name: "Sneaky", file: "../../secret.mp3", url: "https://cdn.example/x.mp3" }, { kind: "virus", name: "No", file: "preview--x--virus--no.mp3" },
    { kind: "pad", name: "Bad address", file: "preview--central-pads--pad--bad.mp3", url: "javascript:alert(1)" }] }] };
const rel = http.createServer((req, res) => { if (req.url === "/libraries-index.json") { res.setHeader("Content-Type", "application/json"); return res.end(JSON.stringify(INDEX)); } res.statusCode = 404; res.end(); });
await new Promise((r) => rel.listen(0, "127.0.0.1", r));
const relBase = "http://127.0.0.1:" + rel.address().port;

const srv = spawn(process.execPath, [path.join(here, "..", "src", "index.js")], { env: Object.assign({}, process.env, { PORT: String(port), LIBRARIES_BASE_URL: relBase, HYMNS: "off", REMINDERS: "off", CC_UPDATE_API: "http://127.0.0.1:9" }), stdio: ["ignore", "pipe", "pipe"] });
let log = ""; srv.stdout.on("data", (d) => { log += d; }); srv.stderr.on("data", (d) => { log += d; });
for (let i = 0; i < 150 && !/Motion Audio server on/.test(log); i++) await new Promise((r) => setTimeout(r, 100));

let fails = 0;
const ok = (c, m, d) => { console.log((c ? "  ✓ " : "  ✗ ") + m + (c || d === undefined ? "" : "   -- " + JSON.stringify(d).slice(0, 900))); if (!c) fails++; };
const j = async (method, p, body, tok) => { const r = await fetch(base + "/v1" + p, { method, headers: { "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); let o = {}; try { o = await r.json(); } catch (_) { } o._status = r.status; return o; };
function wav(seconds, freqAt, rate = 44100) {
  const n = Math.round(seconds * rate), b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVE", 8); b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  let ph = 0; for (let i = 0; i < n; i++) { const [f, a] = freqAt(i / rate); ph += 2 * Math.PI * f / rate; b.writeInt16LE(Math.round(Math.sin(ph) * 20000 * a), 44 + i * 2); }
  return b;
}
const seconds = (file) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim());

let browser = null;
try {
  if (!/Motion Audio server on/.test(log)) console.log(log.slice(-2000));
  const { q, one, pool } = await import("../src/db.js");
  const { makeToken } = await import("../src/auth.js");
  const { writeZip } = await import("../src/zipfile.js");

  console.log("the sound libraries' previews:");
  let r = await j("GET", "/libraries");
  const lib = (r.libraries || []).find((l) => l.id === "central-pads-library");
  ok(r.source === "index" && lib && lib.previews.length === 3 && lib.previews[0].url === "https://cdn.example/preview--central-pads--pad--warm.mp3" && lib.previews[1].set === "ambient" && !lib.previews[0].expected,
    "/v1/libraries passes the published previews on, with their addresses", lib && lib.previews);
  ok(lib.previews[2].url === relBase + "/preview--central-pads--pad--bad.mp3", "...one with an odd address plays from next to the index instead", lib.previews[2]);
  ok(!JSON.stringify(lib.previews).includes("secret") && !JSON.stringify(lib.previews).includes("virus") && !JSON.stringify(lib.previews).includes("javascript"),
    "...only real preview files (no odd names, kinds or addresses)");
  const { config } = await import("../src/config.js"), L = await import("../src/libraries.js");
  config.librariesBaseUrl = "http://127.0.0.1:9/none"; L.forgetCache();   // (this process: nothing published - the built-in list)
  const bl = await L.libraries();
  const keys = bl.libraries.find((l) => l.id === "central-keys-library");
  ok(bl.source === "built-in" && keys.previews.length > 20 && keys.previews.every((p) => p.expected && p.url.startsWith("http://127.0.0.1:9/none/preview--central-keys--")) && keys.previews.some((p) => p.kind === "sound" && p.preset),
    "the built-in list names the previews a build makes (marked expected), at LIBRARIES_BASE_URL", keys.previews.slice(0, 2));

  console.log("Central Tracks:");
  const pub = await one("INSERT INTO users (email,name,pass_hash,email_confirmed) VALUES ('pub@v102.test','Pub','x',TRUE) RETURNING *");
  fs.mkdirSync(path.join(files, "u" + pub.id), { recursive: true });
  // a 2-minute song: quiet, a loud chorus from 60 to 95 s, quiet again
  fs.writeFileSync(path.join(files, "u" + pub.id, "mix.wav"), wav(120, (t) => [220, t > 60 && t < 95 ? 1 : 0.12]));
  const t = await one("INSERT INTO tracks (publisher_id,title,artist,kind,song_key,bpm,stars,price_cents,grade_report,rights_ok,status) VALUES ($1,'Loud Chorus','Pub','Multitrack','D',72,4,1999,'[]',TRUE,'live') RETURNING *", [pub.id]);
  await q("INSERT INTO track_files (track_id,name,role,storage_key,is_mix) VALUES ($1,'Mix','',$2,TRUE)", [t.id, "u" + pub.id + "/mix.wav"]);
  r = await j("GET", "/tracks");
  ok(r.tracks.find((x) => x.id === String(t.id)).preview === "/v1/tracks/" + t.id + "/preview.mp3", "the track list says where each track's 30 seconds are");
  let res = await fetch(base + "/v1/tracks/" + t.id + "/preview.mp3", { redirect: "manual" });
  const loc1 = res.headers.get("location");
  ok(res.status === 302 && /\/local-files\/previews\/track-\d+-/.test(loc1 || ""), "anyone can listen: a song's preview is cut and kept (a 302 to it)", { status: res.status, loc1 });
  const got = await fetch(new URL(loc1, base)); const mp3 = Buffer.from(await got.arrayBuffer()), mf = path.join(files, "check.mp3"); fs.writeFileSync(mf, mp3);
  ok(got.ok && /audio\/mpeg/.test(got.headers.get("content-type") || "") && Math.abs(seconds(mf) - 30) < 0.5, "...a 30-second MP3", { type: got.headers.get("content-type"), s: seconds(mf) });
  const P = await import("../src/previews.js");
  const kept = await one("SELECT * FROM previews WHERE owner=$1", ["track:" + t.id]);
  ok(kept && kept.source === "u" + pub.id + "/mix.wav", "...made from the mix, and kept");
  res = await fetch(base + "/v1/tracks/" + t.id + "/preview.mp3", { redirect: "manual" });
  ok(res.status === 302 && (await one("SELECT storage_key FROM previews WHERE owner=$1", ["track:" + t.id])).storage_key === kept.storage_key, "a second listen gets the same preview (not cut again)");
  fs.writeFileSync(path.join(files, "u" + pub.id, "mix2.wav"), wav(60, () => [330, 0.5]));
  await q("UPDATE track_files SET storage_key=$2 WHERE track_id=$1 AND is_mix", [t.id, "u" + pub.id + "/mix2.wav"]);
  await fetch(base + "/v1/tracks/" + t.id + "/preview.mp3", { redirect: "manual" });
  const k2 = await one("SELECT * FROM previews WHERE owner=$1", ["track:" + t.id]);
  ok(k2.storage_key !== kept.storage_key && k2.source.endsWith("mix2.wav") && !fs.existsSync(path.join(files, kept.storage_key)), "a new mix makes a new preview (the old one is removed)");
  ok((await fetch(base + "/v1/tracks/999999/preview.mp3", { redirect: "manual" })).status === 404, "a track that isn't there: 404");
  // a hymn (hymns.js keeps the preview the build made)
  const H = await import("../src/hymns.js");
  const hymnIndex = { hymns: [{ id: "test-hymn", title: "Test Hymn", key: "G", bpm: 72, stems: [{ name: "Drums.mp3", role: "drums", url: "https://rel.example/test-hymn--Drums.mp3" }],
    song: { name: "song.json", url: "https://rel.example/test-hymn--song.json" }, mix: { name: "mix.mp3", url: "https://rel.example/test-hymn--mix.mp3" }, preview: { name: "preview.mp3", url: "https://rel.example/test-hymn--test-hymn-preview.mp3" } }] };
  await H.sync(async () => ({ ok: true, json: async () => hymnIndex }));
  const ht = await one("SELECT id FROM tracks WHERE grade_report @> $1::jsonb", [JSON.stringify([{ hymn: "test-hymn" }])]);
  res = await fetch(base + "/v1/tracks/" + ht.id + "/preview.mp3", { redirect: "manual" });
  ok(res.status === 302 && res.headers.get("location") === "https://rel.example/test-hymn--test-hymn-preview.mp3", "a hymn's preview is the one the build picked (not cut again)", res.headers.get("location"));
  ok(!(await one("SELECT 1 FROM track_files WHERE track_id=$1 AND storage_key LIKE '%preview%'", [ht.id])), "...and it's never one of the files people get when they add the hymn");

  console.log("community uploads:");
  const ana = await one("INSERT INTO users (email,name,pass_hash,email_confirmed) VALUES ('ana@v102.test','Ana','x',TRUE) RETURNING *"), tok = makeToken(ana.id, true);
  const put = async (u, data) => (await fetch(u, { method: "PUT", body: data })).status;
  const send = async (meta, list) => {
    const it = await j("POST", "/creator/items", meta, tok); if (!it.item) return it;
    for (const f of list) { const u = await j("POST", "/creator/items/" + it.item.id + "/upload", { role: f.role, name: f.name, size: f.data.length }, tok); if (!u.url) return u; await put(u.url, f.data); }
    return Object.assign(await j("POST", "/creator/items/" + it.item.id + "/submit", {}, tok), { id: it.item.id });
  };
  r = await send({ kind: "loop", title: "Bare Loop", bpm: 90, bars: 2, key: "C", rights: true }, [{ role: "source", name: "bare.wav", data: wav(5.3, (x) => [200, x % 0.66 < 0.1 ? 1 : 0.2]) }]);
  ok(r._status === 200 && r.item.checks.some((c) => /Preview: 30 seconds made from the files/.test(c.text)) && /^http/.test(r.item.preview || ""), "a loop without a demo clip: its preview is made from the loop", r);
  if (r.item && r.item.preview) { const pf = path.join(files, "loop.mp3"); fs.writeFileSync(pf, Buffer.from(await (await fetch(r.item.preview)).arrayBuffer())); ok(Math.abs(seconds(pf) - 30) < 0.5, "...30 seconds of it (the loop goes round)", seconds(pf)); }
  const notes = writeZip(["C3", "C4", "G4", "C5"].map((n, i) => ({ name: "Bells/" + n + ".wav", data: wav(1.2, (x) => [[130.8, 261.6, 392, 523.3][i], Math.exp(-3 * x)]) })));
  r = await send({ kind: "instrument", pack: "keys", title: "Bare Bells", rights: true }, [{ role: "source", name: "bells.zip", data: notes }]);
  ok(r._status === 200 && r.item.checks.some((c) => /Preview: 30 seconds made from the files/.test(c.text)), "an instrument from samples named by note, no demo clip: its preview plays the samples", r.error || r.item && r.item.checks);
  r = await send({ kind: "loop", title: "With Demo", bpm: 90, bars: 2, key: "C", rights: true }, [{ role: "source", name: "w.wav", data: wav(5.3, () => [300, 0.5]) }, { role: "demo", name: "demo.wav", data: wav(70, (x) => [300, x > 30 && x < 62 ? 1 : 0.15]) }]);
  ok(r._status === 200 && r.item.checks.some((c) => /Preview: 30 seconds from the demo clip/.test(c.text)), "a demo clip is cut to its best 30 seconds for the preview", r.error || r.item && r.item.checks);
  const wid = r.id;
  await q("UPDATE community_items SET status='live', stars=3 WHERE id=$1", [wid]);
  r = await j("GET", "/community");
  const live = (r.items || []).find((x) => x.id === wid);
  ok(live && /^http/.test(live.preview || "") && live.preview !== live.demo, "the community list says where each item's preview is (the apps' Listen buttons)", live);

  console.log("the pages:");
  try { browser = await createRequire(import.meta.url)("playwright").chromium.launch(); } catch (e) { console.log("  (no Playwright: the page checks are skipped) " + e.message); }
  if (browser) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }), errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    await page.route("https://cdn.example/**", (route) => route.fulfill({ status: 200, contentType: "audio/wav", body: wav(2, () => [330, 0.4]) }));
    await page.goto(base + "/pricing/");   // (10.3: the store has its own page)
    await page.waitForFunction(() => document.querySelectorAll("#planCards .plan-listen [data-pv]").length > 0, null, { timeout: 10000 });
    ok(await page.evaluate(() => /Hear it/.test(document.querySelector("#planCards .plan-listen").textContent)), "the plan cards: Hear it, with a few of the plan's previews");
    await page.click("#planCards .plan-listen [data-pv]");
    await page.waitForFunction(() => window.PPPreview.playing() !== "", null, { timeout: 6000 });
    ok(true, "...a Listen button plays the preview");
    await page.evaluate(() => PPPreview.stop());
    // (10.3) the Central Pads page: the picked pads play their previews
    await page.goto(base + "/sounds/pads/");
    await page.waitForFunction(() => !!document.querySelector('[data-plan-items="pads"] .item [data-pv]'), null, { timeout: 10000 }).catch(() => null);
    ok(await page.evaluate(() => !!document.querySelector('[data-plan-items="pads"] .item [data-pv]')), "the Central Pads page: its pads have a 30-second preview");
    await page.goto(base + "/#downloads");
    await page.waitForFunction(() => document.querySelector('.lib-card[data-lib="central-pads-library"] .pv-list'), null, { timeout: 10000 }).catch(() => null);
    ok(await page.evaluate(() => !!document.querySelector('.lib-card[data-lib="central-pads-library"] .pv-list [data-pv]')), "the Downloads page: each library's Listen fold");
    await page.goto(base + "/#tracks");
    await page.waitForFunction((id) => document.querySelector('#tbody [data-pv="/v1/tracks/' + id + '/preview.mp3"]'), String(t.id), { timeout: 10000 }).catch(() => null);
    ok(await page.evaluate((id) => !!document.querySelector('#tbody [data-pv="/v1/tracks/' + id + '/preview.mp3"]'), String(t.id)), "Central Tracks: every track has a Listen button (songs too)");
    ok(!errs.length, "no page errors", errs);
  }
  await pool.end().catch(() => { });
} catch (e) { ok(false, "stopped: " + (e && e.stack || e)); }
finally {
  if (browser) await browser.close().catch(() => { });
  srv.kill(); rel.close();
  await new Promise((r) => setTimeout(r, 300));
  await sql("DROP DATABASE IF EXISTS " + dbName + " WITH (FORCE)").catch(() => { });
  fs.rmSync(files, { recursive: true, force: true });
}
console.log(fails ? "\n" + fails + " FAILED" : "\nall passed");
process.exit(fails ? 1 : 0);
