// Nightly database backup (a Render cron job runs `node src/backup.js`; staff can also press Back up now).
// Every table, row by row, as gzipped JSON lines in the file storage (R2) under backups/YYYY-MM-DD-HHMM.jsonl.gz.
// Backups older than 30 days are deleted (the newest 7 always stay).
// Restore into an EMPTY database (a new Render Postgres, say):  DATABASE_URL=... node src/backup.js restore <key or file>
// It makes the tables (schema.sql), puts every row back in an order that keeps the links between tables, and sets the
// id counters past the highest id.
import zlib from "node:zlib";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { q, pool, migrate } from "./db.js";
import * as store from "./storage.js";

const KEEP_DAYS = 30, KEEP_MIN = 7, PREFIX = "backups/";

async function tablesInOrder() {   // parents before children (by their foreign keys)
  const tables = (await q("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).map((r) => r.tablename);
  const fks = await q(`SELECT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent FROM pg_constraint c
    JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.contype='f' AND n.nspname='public'`);
  const out = [], seen = new Set();
  const visit = (t, path) => { if (seen.has(t) || path.has(t)) return; path.add(t); for (const f of fks) if (f.child === t && f.parent !== t) visit(f.parent, path); seen.add(t); out.push(t); };
  for (const t of tables) visit(t, new Set());
  return out;
}

export async function makeBackup() {
  const tables = await tablesInOrder(), lines = [JSON.stringify({ backup: 1, made: new Date().toISOString(), tables })];
  let rows = 0;
  for (const t of tables) {
    for (const r of await q(`SELECT row_to_json(x) AS j FROM "${t}" x`)) { lines.push(JSON.stringify({ t, r: r.j })); rows++; }
  }
  const gz = zlib.gzipSync(Buffer.from(lines.join("\n") + "\n"));
  const d = new Date(), key = PREFIX + d.toISOString().slice(0, 16).replace(/[T:]/g, (c) => (c === "T" ? "-" : "")) + ".jsonl.gz";
  await store.putFile(key, gz, "application/gzip");
  // keep 30 days (and never fewer than the newest 7)
  const all = (await store.listFiles(PREFIX)).filter((f) => /\.jsonl\.gz$/.test(f.key)).sort((a, b) => (a.key < b.key ? 1 : -1));
  let removed = 0;
  for (const f of all.slice(KEEP_MIN)) if (Date.now() - new Date(f.modified).getTime() > KEEP_DAYS * 864e5) { await store.remove(f.key); removed++; }
  return { key, tables: tables.length, rows, bytes: gz.length, removed };
}
export async function listBackups() {
  return (await store.listFiles(PREFIX)).filter((f) => /\.jsonl\.gz$/.test(f.key)).sort((a, b) => (a.key < b.key ? 1 : -1));
}

export async function restore(from) {
  const buf = fs.existsSync(from) ? fs.readFileSync(from) : await store.readFile(from);
  const lines = zlib.gunzipSync(buf).toString("utf8").split("\n").filter(Boolean);
  const head = JSON.parse(lines[0]);
  if (!head.backup) throw new Error("That isn't a Motion Audio backup.");
  await migrate();
  const used = (await q("SELECT COUNT(*)::int AS n FROM users")).n;
  if (used) throw new Error("This database already has accounts in it. Restore into an empty database.");
  const client = await pool.connect(); let n = 0;
  try {
    await client.query("BEGIN");
    for (const l of lines.slice(1)) { const { t, r } = JSON.parse(l); await client.query(`INSERT INTO "${t}" SELECT * FROM json_populate_record(NULL::"${t}", $1)`, [JSON.stringify(r)]); n++; }
    for (const s of (await client.query(`SELECT c.relname AS tab, a.attname AS col, pg_get_serial_sequence(quote_ident(c.relname), a.attname) AS seq FROM pg_class c
        JOIN pg_attribute a ON a.attrelid=c.oid JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE ns.nspname='public' AND c.relkind='r' AND a.attnum>0 AND pg_get_serial_sequence(quote_ident(c.relname), a.attname) IS NOT NULL`)).rows)
      await client.query(`SELECT setval($1, GREATEST((SELECT COALESCE(MAX("${s.col}"),0) FROM "${s.tab}"), 1))`, [s.seq]);
    await client.query("COMMIT");
  } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
  return { rows: n, made: head.made };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, arg] = process.argv.slice(2);
  (cmd === "restore" ? restore(arg) : makeBackup())
    .then((r) => { console.log(JSON.stringify(r)); return pool.end(); })
    .catch((e) => { console.error("backup:", e.message); process.exit(1); });
}
