// 10.2: Central Production projects in the account - a project's .cmproj goes straight to storage through a signed link,
// becomes the project's file only when it's there, a new version replaces the old (and its file), each account has a
// storage limit, nobody else can see or open it, and delete removes it. Makes its own database and drops it at the end.
//   node test/v102-projects.mjs postgres://postgres@127.0.0.1:55432/postgres [port]
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const admin = process.argv[2] || "postgres://postgres@127.0.0.1:55432/postgres", port = Number(process.argv[3] || 19102);
const S = Date.now(), dbName = "ma_v102_" + S, db = admin.replace(/\/[^/]*$/, "/" + dbName), files = fs.mkdtempSync(path.join(os.tmpdir(), "v102-files-"));
const pg = (await import("pg")).default;
async function sql(text) { const c = new pg.Client({ connectionString: admin }); await c.connect(); try { await c.query(text); } finally { await c.end(); } }
await sql("CREATE DATABASE " + dbName);
process.env.DATABASE_URL = db;
let fails = 0;
const ok = (c, m, d) => { console.log((c ? "  ✓ " : "  ✗ ") + m + (c || d === undefined ? "" : "   -- " + JSON.stringify(d).slice(0, 700))); if (!c) fails++; };
const base = "http://127.0.0.1:" + port;
const srv = spawn(process.execPath, [path.join(here, "..", "src", "index.js")], { env: Object.assign({}, process.env, { DATABASE_URL: db, PORT: String(port), STRIPE_SECRET_KEY: "", RESEND_API_KEY: "", PUBLIC_URL: base, REMINDERS: "off", HYMNS: "off", LOCAL_STORAGE_DIR: files, PROJECT_STORAGE_MB: "50" }), stdio: ["ignore", "pipe", "pipe"] });
let log = ""; srv.stdout.on("data", (d) => { log += d; }); srv.stderr.on("data", (d) => { log += d; });
for (let i = 0; i < 150 && !/Motion Audio server on/.test(log); i++) await new Promise((r) => setTimeout(r, 100));
const j = async (method, p, body, tok) => { const r = await fetch(base + "/v1" + p, { method, headers: { "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); return Object.assign(await r.json().catch(() => ({})), { _status: r.status }); };
const put = (url, bytes) => fetch(url, { method: "PUT", body: bytes, headers: { "Content-Type": "application/zip" } });
try {
  if (!/Motion Audio server on/.test(log)) console.log(log.slice(-1500));
  const { one } = await import("../src/db.js");
  const { makeToken } = await import("../src/auth.js");
  const user = async (who) => { const u = await one("INSERT INTO users (email,name,pass_hash,email_confirmed) VALUES ($1,$2,'x',TRUE) RETURNING *", [who + "@prod102.test", who]); return { u, tok: makeToken(u.id, true) }; };
  const ann = await user("ann"), bob = await user("bob");
  const v1 = Buffer.alloc(3000, 1), v2 = Buffer.alloc(5000, 2);

  let r = await j("GET", "/projects", null, null);
  ok(r._status === 401, "signed out: no projects");
  r = await j("POST", "/projects", { name: "Sunday Song", type: "track", size: v1.length }, ann.tok);
  ok(r.project && r.url && r.key, "a new project: an upload link", r);
  const id = r.project.id;
  let list = await j("GET", "/projects", null, ann.tok);
  ok(list.projects.length === 0, "not listed until its file is there");
  let done = await j("POST", "/projects/" + id + "/done", { key: r.key }, ann.tok);
  ok(done._status === 400, "done before the upload: refused (it isn't there)", done);
  ok((await put(r.url, v1)).ok, "the .cmproj goes straight to storage");
  done = await j("POST", "/projects/" + id + "/done", { key: r.key }, ann.tok);
  ok(done.project && done.project.version === 1 && done.project.bytes === v1.length, "...then it's the project's file (version 1)", done);
  list = await j("GET", "/projects", null, ann.tok);
  ok(list.projects.length === 1 && list.projects[0].name === "Sunday Song" && list.projects[0].type === "track" && list.used === v1.length && list.limit === 50 * 1048576, "listed, with the space used and the limit", list);
  let got = await j("GET", "/projects/" + id, null, ann.tok);
  ok(got.url && Buffer.from(await (await fetch(got.url)).arrayBuffer()).equals(v1), "opened: the same bytes come back");
  // a new version
  r = await j("POST", "/projects", { id, name: "Sunday Song (final)", type: "track", size: v2.length }, ann.tok);
  await put(r.url, v2); done = await j("POST", "/projects/" + id + "/done", { key: r.key }, ann.tok);
  got = await j("GET", "/projects/" + id, null, ann.tok);
  ok(done.project.version === 2 && got.project.name === "Sunday Song (final)" && Buffer.from(await (await fetch(got.url)).arrayBuffer()).equals(v2), "a new version replaces it (version 2, the new name)", got.project);
  const left = fs.readdirSync(path.join(files, "projects", "u" + ann.u.id, id));
  ok(left.length === 1, "...and the old file is removed", left);
  // someone else
  ok((await j("GET", "/projects/" + id, null, bob.tok))._status === 404 && (await j("GET", "/projects", null, bob.tok)).projects.length === 0, "another account can't see or open it");
  ok((await j("POST", "/projects", { id, name: "x", type: "track", size: 10 }, bob.tok)).project.id !== id, "...and can't write over it (it gets a project of its own)");
  // the limit
  r = await j("POST", "/projects", { name: "Huge", type: "loop", size: 60 * 1048576 }, ann.tok);
  ok(r._status === 400 || r._status === 413, "over the account's space: refused, saying how much is left", r);
  ok(/MB of project space left/.test(r.error || ""), "...in plain words", r.error);
  ok((await j("POST", "/projects", { name: "x", type: "song", size: 10 }, ann.tok))._status === 400, "an unknown project type: refused");
  // delete
  ok((await j("POST", "/projects/" + id + "/delete", null, ann.tok)).ok, "delete");
  ok((await j("GET", "/projects/" + id, null, ann.tok))._status === 404 && !fs.existsSync(path.join(files, "projects", "u" + ann.u.id, id, left[0])), "...it's gone, and so is its file");
  // the plugin's own platform: a Central Production plugin publishes as one file for every system
  const it = await j("POST", "/creator/items", { kind: "plugin", title: "My Echo", rights: true }, ann.tok);
  const up = await j("POST", "/creator/items/" + it.item.id + "/upload", { role: "source", platform: "any", name: "my-echo.cmfx.json", size: 100, type: "application/json" }, ann.tok);
  await put(up.url, Buffer.from(JSON.stringify({ format: "central-fx", version: 1, name: "My Echo", params: [], graph: { blocks: [{ id: "b1", type: "delay" }], wires: [] } })));
  const sub = await j("POST", "/creator/items/" + it.item.id + "/submit", {}, ann.tok);
  ok(sub.item && sub.item.status === "waiting", "a Central Production plugin (.cmfx.json, every system) goes in for review", sub);
} catch (e) { console.log(e); fails++; }
finally {
  srv.kill();
  await new Promise((r) => setTimeout(r, 300));
  const { pool } = await import("../src/db.js").catch(() => ({}));
  if (pool) await pool.end().catch(() => {});
  await sql("DROP DATABASE IF EXISTS " + dbName + " WITH (FORCE)").catch((e) => console.log("drop:", e.message));
  fs.rmSync(files, { recursive: true, force: true });
}
console.log(fails ? "\n" + fails + " CHECK(S) FAILED" : "\nALL PROJECT (CENTRAL PRODUCTION) CHECKS PASSED");
process.exit(fails ? 1 : 0);
