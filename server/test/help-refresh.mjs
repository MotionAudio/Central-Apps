// When a release rewrites a built-in help guide, the site's copy follows, unless staff edited it on the site.
//   node test/help-refresh.mjs [postgres url]
import assert from "node:assert/strict";
import fs from "node:fs";
process.env.DATABASE_URL = process.argv[2] || process.env.DATABASE_URL || "postgres://postgres@127.0.0.1:55432/ma";
const { q, one, migrate, pool } = await import("../src/db.js");
const list = JSON.parse(fs.readFileSync(new URL("../src/help-articles.json", import.meta.url), "utf8")).articles;
let failed = 0;
const check = async (name, fn) => { try { await fn(); console.log("  ✓ " + name); } catch (e) { failed++; console.log("  ✗ " + name + ": " + e.message); } };
const fresh = async () => (await import("../src/helpdesk.js?" + Math.random())).seedArticles();

try {
  await migrate();
  await q("DELETE FROM help_articles"); await q("DELETE FROM site_settings WHERE name='help-seeded'");
  await fresh();
  const [a, b, c] = list;
  await check("the built-in guides go in once, with a fingerprint each", async () => {
    const n = await one("SELECT count(*)::int AS n FROM help_articles"), s = await one("SELECT data FROM site_settings WHERE name='help-seeded'");
    assert.equal(n.n, list.length); assert.equal(Object.keys(s.data.hashes).length, list.length);
  });
  // an older release's words: one guide untouched since, one edited by staff, one deleted by staff
  await q("UPDATE help_articles SET title='Old words', body='[]' WHERE slug=$1", [a.slug]);
  await q("UPDATE help_articles SET title='Our own words', updated_by='staff@motion.test' WHERE slug=$1", [b.slug]);
  await q("DELETE FROM help_articles WHERE slug=$1", [c.slug]);
  await q("UPDATE site_settings SET data = jsonb_set(jsonb_set(jsonb_set(data, $1, '\"old\"'), $2, '\"old\"'), $3, '\"old\"') WHERE name='help-seeded'",
    ["{hashes," + a.slug + "}", "{hashes," + b.slug + "}", "{hashes," + c.slug + "}"]);
  await fresh();
  await check("a guide nobody edited on the site takes the new words", async () => {
    const r = await one("SELECT title, body FROM help_articles WHERE slug=$1", [a.slug]);
    assert.equal(r.title, a.title); assert.ok(r.body.length > 0);
  });
  await check("a guide staff edited stays as they left it", async () => {
    const r = await one("SELECT title FROM help_articles WHERE slug=$1", [b.slug]); assert.equal(r.title, "Our own words");
  });
  await check("a guide staff deleted stays deleted", async () => {
    assert.equal(await one("SELECT 1 FROM help_articles WHERE slug=$1", [c.slug]), null);
  });
  await check("the fingerprints are brought up to date, so it happens once", async () => {
    const s = await one("SELECT data FROM site_settings WHERE name='help-seeded'");
    assert.notEqual(s.data.hashes[a.slug], "old"); assert.notEqual(s.data.hashes[b.slug], "old");
  });
} catch (e) { failed++; console.log("  ✗ crashed: " + e.message); }
// leave the guides as a fresh server would find them, for the tests that run after this one
await q("DELETE FROM help_articles").catch(() => {}); await q("DELETE FROM site_settings WHERE name='help-seeded'").catch(() => {});
await pool.end();
console.log(failed ? "\n" + failed + " FAILED" : "\nall passed");
process.exit(failed ? 1 : 0);
