// 10.0: the Central Tracks hymns on the website - the published hymns-index.json (HYMNS_BASE_URL) becomes one Central
// Tracks multitrack per hymn, published by the Motion Audio account: listed in the store, a non-subscriber is sent to
// buy it, a Central Tracks Unlimited subscriber adds it and gets the stems and the song file (straight from where CI put
// them), and a second sync updates rather than duplicates. Makes its own database and drops it at the end.
//   node test/v100-hymns.mjs postgres://postgres@127.0.0.1:55432/postgres [port]
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const admin = process.argv[2] || "postgres://postgres@127.0.0.1:55432/postgres", port = Number(process.argv[3] || 19010);
const S = Date.now(), dbName = "ma_v100h_" + S, db = admin.replace(/\/[^/]*$/, "/" + dbName);
const pg = (await import("pg")).default;
async function sql(text, params) { const c = new pg.Client({ connectionString: text.startsWith("CREATE DATABASE") || text.startsWith("DROP DATABASE") ? admin : db }); await c.connect(); try { return (await c.query(text, params)).rows; } finally { await c.end(); } }
await sql("CREATE DATABASE " + dbName);

let fails = 0;
const ok = (c, m, d) => { console.log((c ? "  ✓ " : "  ✗ ") + m + (c || d === undefined ? "" : "   -- " + JSON.stringify(d).slice(0, 700))); if (!c) fails++; };

const F = (id, name, role) => ({ name, role, file: id + "--" + name, url: "https://cdn.example.test/" + id + "--" + name });
const hymn = (id, title) => ({ id, title, artist: "Motion Audio", kind: "Multitrack", key: "G", bpm: 72, meter: 3, words: "John Newton (1779)", music: "NEW BRITAIN (1829)",
  stems: [F(id, "Drums.mp3", "drums"), F(id, "Bass.mp3", "bass"), F(id, "Keys.mp3", "keys"), Object.assign(F(id, "Click.mp3", "click"), { mute: true })],
  song: F(id, "song.json", "song"), mix: F(id, id + "-mix.mp3"), preview: F(id, id + "-preview.mp3") });
let INDEX = { format: 1, hymns: [hymn("amazing-grace", "Amazing Grace"), hymn("doxology", "Doxology"), { id: "Bad Id", stems: [] }, Object.assign(hymn("insecure", "Insecure"), { stems: [{ name: "x.mp3", url: "http://plain.example.test/x.mp3" }] })] };
const cdn = http.createServer((req, res) => {
  if (req.url === "/hymns/hymns-index.json") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify(INDEX)); }
  res.writeHead(404); res.end("no");
});
await new Promise((r) => cdn.listen(0, "127.0.0.1", r));
const CDN = "http://127.0.0.1:" + cdn.address().port + "/hymns";

function server(p) {
  const srv = spawn(process.execPath, [path.join(here, "..", "src", "index.js")], { env: Object.assign({}, process.env, { DATABASE_URL: db, PORT: String(p), STRIPE_SECRET_KEY: "", RESEND_API_KEY: "",
    PUBLIC_URL: "http://127.0.0.1:" + p, REMINDERS: "off", HYMNS_BASE_URL: CDN, LOCAL_STORAGE_DIR: path.join(here, ".v100h-files-" + S) }), stdio: ["ignore", "pipe", "pipe"] });
  srv.log = ""; srv.stdout.on("data", (d) => { srv.log += d; }); srv.stderr.on("data", (d) => { srv.log += d; });
  return srv;
}
async function up(srv) { for (let i = 0; i < 150 && !/Motion Audio server on/.test(srv.log); i++) await new Promise((r) => setTimeout(r, 100)); }
const api = async (pth, opt) => { const r = await fetch("http://127.0.0.1:" + port + "/v1" + pth, opt); let j = {}; try { j = await r.json(); } catch (_) { } return Object.assign(j, { _status: r.status }); };

let s1 = server(port);
try {
  await up(s1);
  let tracks = [];
  for (let i = 0; i < 50 && tracks.length < 2; i++) { await new Promise((r) => setTimeout(r, 100)); tracks = (await api("/tracks?kind=Multitrack")).tracks || []; }
  const ag = tracks.find((t) => t.title === "Amazing Grace");
  ok(tracks.length === 2 && ag && ag.artist === "Motion Audio" && ag.kind === "Multitrack" && ag.key === "G" && ag.bpm === 72 && ag.price === 20 && ag.stars === 4,
    "the published hymns become Central Tracks multitracks by Motion Audio, $20 each (entries that aren't a hymn, or whose files aren't https, are left out)", tracks);
  const email = "sub" + S + "@example.test";
  const su = await api("/signup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "correct horse battery", name: "Sub" }) });
  const auth = { Authorization: "Bearer " + su.token, "Content-Type": "application/json" };
  const no = await api("/tracks/" + ag.id + "/add", { method: "POST", headers: auth, body: "{}" });
  ok(no._status === 402 && /#buy-/.test(no.checkoutUrl || ""), "without Central Tracks Unlimited, adding a hymn sends you to buy it", no);
  await sql("UPDATE users SET subscribed=TRUE, email_confirmed=TRUE WHERE email=$1", [email]).catch(() => sql("UPDATE users SET subscribed=TRUE WHERE email=$1", [email]));
  const got = await api("/tracks/" + ag.id + "/add", { method: "POST", headers: auth, body: "{}" });
  const names = (got.files || []).map((f) => f.name + ":" + (f.role || ""));
  ok(got._status === 200 && got.kind === "Multitrack" && names.includes("Drums.mp3:drums") && names.includes("song.json:song") && names.includes("Click.mp3:click") && !names.some((n) => /mix/.test(n)),
    "a subscriber adds it: the stems and the song file (not the mix)", names);
  ok((got.files || []).every((f) => /^https:\/\/cdn\.example\.test\/amazing-grace--/.test(f.url)), "each straight from where CI published it", got.files);
  const mine = await api("/library", { headers: auth });
  ok((mine.tracks || []).some((t) => t.title === "Amazing Grace"), "and it's in their library", mine);
  // a new index: a changed title is updated in place, a new hymn is added, nothing duplicated
  INDEX = { format: 1, hymns: [hymn("amazing-grace", "Amazing Grace (new mix)"), hymn("doxology", "Doxology"), hymn("be-thou-my-vision", "Be Thou My Vision")] };
  s1.kill(); await new Promise((r) => setTimeout(r, 300));
  s1 = server(port); await up(s1);
  for (let i = 0; i < 50 && tracks.length < 3; i++) { await new Promise((r) => setTimeout(r, 100)); tracks = (await api("/tracks?kind=Multitrack")).tracks || []; }
  const ag2 = tracks.find((t) => t.id === ag.id);
  ok(tracks.length === 3 && ag2 && /Amazing Grace \(/.test(ag2.title), "a later index updates the same tracks (the same id) and adds new hymns", tracks.map((t) => t.id + " " + t.title));
  const rows = await sql("SELECT count(*)::int AS n FROM track_files f JOIN tracks t ON t.id=f.track_id WHERE t.id=$1", [Number(ag.id)]);
  ok(rows[0].n === 6, "its files are replaced, not added again (4 stems + song + mix)", rows);
} catch (e) {
  ok(false, "the test ran", e.stack || String(e));
} finally {
  s1.kill(); cdn.close();
  await new Promise((r) => setTimeout(r, 300));
  await sql("DROP DATABASE IF EXISTS " + dbName + " WITH (FORCE)").catch(() => { });
}
if (fails) { console.log(s1.log.slice(-2000)); console.log("\n" + fails + " FAILED"); process.exit(1); }
console.log("\nALL HYMN CHECKS PASSED");
