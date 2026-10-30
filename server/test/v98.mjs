// 9.8: the sound libraries on the website - GET /v1/libraries (no sign-in) from the published libraries-index.json at
// LIBRARIES_BASE_URL, or the built-in list when it isn't there (ready: false, no sha256), and the Downloads page's
// "Sound libraries" section (what's in each, its size, Download, "Needs Central Keys ($70 a year)...", and for someone
// signed in which ones their plans open). Makes its own database and drops it at the end.
//   node test/v98.mjs postgres://postgres@127.0.0.1:55432/postgres [port]      (the page part needs Playwright)
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const admin = process.argv[2] || "postgres://postgres@127.0.0.1:55432/postgres", port = Number(process.argv[3] || 18998);
const S = Date.now(), dbName = "ma_v98_" + S, db = admin.replace(/\/[^/]*$/, "/" + dbName);
const pg = (await import("pg")).default;
async function sql(text) { const c = new pg.Client({ connectionString: admin }); await c.connect(); try { await c.query(text); } finally { await c.end(); } }
await sql("CREATE DATABASE " + dbName);

let fails = 0;
const ok = (c, m, d) => { console.log((c ? "  ✓ " : "  ✗ ") + m + (c || d === undefined ? "" : "   -- " + JSON.stringify(d).slice(0, 700))); if (!c) fails++; };

// ---- a stand-in for the GitHub release / R2 bucket: libraries-index.json
const sha = (c) => c.repeat(64);
const INDEX = { format: 1, libraries: [
  { id: "central-keys-library", plan: "keys", title: "Central Keys Library", version: "1.0", summary: "Pianos, organs and mallets.", file: "central-keys-library-1.0.zip", size: 151234567, sha256: sha("a"),
    url: "https://cdn.example.test/central-keys-library-1.0.zip", contents: { sounds: [{ name: "Central Keys Pianos", presets: ["Upright Piano", "FM Piano"], license: "CC0 1.0" }], presets: ["Upright Ballad"], boards: [], irs: [] }, credits: ["VCSL - CC0 1.0"] },
  { id: "central-instrument-library", plan: "instrument", title: "Central Instrument Library", version: "1.0", file: "central-instrument-library-1.0.zip", size: 104000000, sha256: sha("b"), url: "http://insecure.example.test/x.zip",
    contents: { sounds: [{ name: "Central Instrument Harps", presets: ["Folk Harp"] }], presets: ["Worship Harp"] } },
  { id: "central-plugins-library", plan: "plugins", title: "Central Plugins Library", version: "1.0", file: "central-plugins-library-1.0.zip", size: 48000, sha256: sha("c"), contents: { boards: ["Plugins: Dotted-Eighth Lead"] } },
  { id: "central-pedals-library", plan: "pedals", title: "Central Pedals Library", version: "1.1", file: "central-pedals-library-1.1.zip", size: 120000, sha256: sha("d"), contents: { boards: ["Pedals: Edge Delay 1x12"], irs: ["Central 1x12 Open Back"] } },
  { id: "Bad ID!", plan: "keys", title: "nope" },
  { id: "central-nothing", plan: "vip", title: "not a plan" },
] };
let indexHits = 0;
const cdn = http.createServer((req, res) => {
  if (req.url === "/libs/libraries-index.json") { indexHits++; res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify(INDEX)); }
  res.writeHead(404); res.end("no");
});
await new Promise((r) => cdn.listen(0, "127.0.0.1", r));
const CDN = "http://127.0.0.1:" + cdn.address().port + "/libs";

function server(p, base) {
  const srv = spawn(process.execPath, [path.join(here, "..", "src", "index.js")], { env: Object.assign({}, process.env, { DATABASE_URL: db, PORT: String(p), STRIPE_SECRET_KEY: "", RESEND_API_KEY: "",
    PUBLIC_URL: "http://127.0.0.1:" + p, REMINDERS: "off", LIBRARIES_BASE_URL: base, LOCAL_STORAGE_DIR: path.join(here, ".v98-files-" + S) }), stdio: ["ignore", "pipe", "pipe"] });
  srv.log = ""; srv.stdout.on("data", (d) => { srv.log += d; }); srv.stderr.on("data", (d) => { srv.log += d; });
  return srv;
}
async function up(srv) { for (let i = 0; i < 150 && !/Motion Audio server on/.test(srv.log); i++) await new Promise((r) => setTimeout(r, 100)); }
const get = async (p, pth) => { const r = await fetch("http://127.0.0.1:" + p + "/v1" + pth); return Object.assign(await r.json(), { _status: r.status, _cache: r.headers.get("cache-control") }); };

const s1 = server(port, CDN + "/");   // (a trailing slash is fine)
let s2 = null, browser;
try {
  await up(s1);
  s2 = server(port + 1, "http://127.0.0.1:1/nothing-here");   // (after the first: one at a time sets up the database)
  await up(s2);
  if (!/Motion Audio server on/.test(s2.log)) console.log(s2.log.slice(-1500));
  console.log("GET /v1/libraries:");
  const r = await get(port, "/libraries");
  const k = r.libraries && r.libraries.find((x) => x.id === "central-keys-library");
  ok(r._status === 200 && r.source === "index" && r.libraries.length === 4, "from the published libraries-index.json: the four libraries (entries that aren't one are left out)", r.libraries && r.libraries.map((x) => x.id));
  ok(k && k.plan === "keys" && k.title === "Central Keys Library" && k.version === "1.0" && k.size === 151234567 && k.sha256 === sha("a") && k.url === "https://cdn.example.test/central-keys-library-1.0.zip" && k.ready === true,
    "each with id, plan, title, version, size, sha256, url", k);
  ok(k && k.contents.sounds[0].presets.join() === "Upright Piano,FM Piano" && k.contents.presets[0] === "Upright Ballad" && k.planName === "Central Keys" && k.planCents === 7000, "and what's inside, with its plan's name and price ($70)", k && k.contents);
  const ins = r.libraries.find((x) => x.id === "central-instrument-library");
  ok(ins && ins.url === CDN + "/central-instrument-library-1.0.zip", "a download address that isn't https is replaced by LIBRARIES_BASE_URL + its file", ins && ins.url);
  ok(r.plans && r.plans.pedals.cents === 7000 && r.plans.plugins.cents === 14000 && r.plans.pads.cents === 4000 && /max-age/.test(r._cache || ""), "the plans' prices come along; the answer can be cached a little", r.plans);
  const hits = indexHits; await get(port, "/libraries"); await get(port, "/libraries");
  ok(indexHits === hits, "the index is read again only every few minutes (cached)", { before: hits, after: indexHits });
  const b = await get(port + 1, "/libraries");
  const bk = b.libraries && b.libraries.find((x) => x.id === "central-keys-library");
  ok(b.source === "built-in" && b.libraries.length === 5 && b.libraries.some((l) => l.id === "central-pads-library" && l.plan === "pads" && l.contents.pads.length >= 12) && bk && bk.ready === false && bk.sha256 === null && bk.approximate === true && /^http:\/\/127\.0\.0\.1:1\/nothing-here\/central-keys-library-\d+\.\d+\.zip$/.test(bk.url),
    "no index (not published yet, or unreachable): the built-in list - not ready, no sha256, an estimated size, at LIBRARIES_BASE_URL", bk);
  ok(bk && bk.contents.sounds.length >= 3 && bk.contents.sounds[0].presets.includes("Upright Piano") && b.libraries.find((x) => x.id === "central-pedals-library").contents.irs.length >= 14,
    "the built-in list still says what's in each (sounds with their presets, boards, IRs)", bk && bk.contents);
  const plans = (await get(port, "/config")).plans || {};
  ok(plans.keys && plans.keys.cents === 7000 && plans.instrument.cents === 10000 && plans.pads.cents === 4000, "the plans and prices are unchanged", plans);

  // ---- the Downloads page
  let pw; try { pw = createRequire(import.meta.url)("playwright"); } catch (_) { pw = null; }
  if (!pw) console.log("  - (no Playwright: the page isn't checked)");
  else {
    console.log("\nThe Downloads page:");
    browser = await pw.chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = []; page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://127.0.0.1:" + port + "/#downloads");
    await page.waitForSelector("#libraries", { timeout: 8000 }).catch(() => {});
    const cards = await page.$$eval(".lib-card", (els) => els.map((e) => ({ id: e.dataset.lib, text: e.textContent.replace(/\s+/g, " "), href: (e.querySelector("a.btn") || {}).href || "" })));
    const ck = cards.find((c) => c.id === "central-keys-library") || {};
    ok(cards.length === 4, "a Sound libraries section with the four libraries", cards.map((c) => c.id));
    ok(/Version 1\.0 · 151 MB/.test(ck.text) && /Upright Piano · FM Piano/.test(ck.text) && /Upright Ballad/.test(ck.text), "each card: version, size and what's in it", ck.text);
    ok(/Needs Central Keys \(\$70 a year\) - your package key comes by email and is on your Account page/.test(ck.text), "\"Needs Central Keys ($70 a year) - your package key comes by email and is on your Account page\"", ck.text);
    ok(ck.href === "https://cdn.example.test/central-keys-library-1.0.zip" && /Download Central Keys Library/.test(ck.text), "a Download button straight to the zip (anyone can download it)", ck.href);
    ok(!/Your Central Keys plan opens/.test(ck.text) && !/Not in your plans yet/.test(ck.text), "signed out: nothing about your plans");
    const signedIn = await page.evaluate(async () => {
      const libs = await (await fetch("/v1/libraries")).json(), d = document.createElement("div");
      d.innerHTML = librariesHtml(libs, { packages: [{ planIds: ["keys", "pedals"] }] });
      return [...d.querySelectorAll(".lib-card")].map((e) => ({ id: e.dataset.lib, text: e.textContent.replace(/\s+/g, " ") }));
    });
    const opens = signedIn.filter((c) => /Your Central \w+ plan opens this library/.test(c.text)).map((c) => c.id).sort();
    const notYet = signedIn.filter((c) => /Not in your plans yet/.test(c.text)).map((c) => c.id).sort();
    ok(opens.join() === "central-keys-library,central-pedals-library" && notYet.join() === "central-instrument-library,central-plugins-library", "signed in: which libraries your plans open, and a link to get the others", { opens, notYet });
    const page2 = await browser.newPage();
    await page2.goto("http://127.0.0.1:" + (port + 1) + "/#downloads");
    await page2.waitForSelector("#libraries", { timeout: 8000 }).catch(() => {});
    const t2 = await page2.$$eval(".lib-card", (els) => els.map((e) => ({ text: e.textContent.replace(/\s+/g, " "), btn: !!e.querySelector("a.btn") })));
    ok(t2.length === 5 && t2.every((c) => !c.btn && /Coming soon/.test(c.text)) && /about \d+ MB/.test(t2[0].text), "not published yet: the cards say what's coming (an estimated size), no Download button", t2.map((c) => c.text.slice(0, 80)));
    ok(!errors.length, "no page errors", errors);
  }
} catch (e) {
  ok(false, "the test ran to the end", String(e && e.stack || e));
} finally {
  if (browser) await browser.close();
  s1.kill(); if (s2) s2.kill(); cdn.close();
  await new Promise((r) => setTimeout(r, 400));
  fs.rmSync(path.join(here, ".v98-files-" + S), { recursive: true, force: true });
  try { await sql("DROP DATABASE IF EXISTS " + dbName + " WITH (FORCE)"); } catch (e) { console.log("  (couldn't drop " + dbName + ": " + e.message + ")"); }
}
console.log(fails ? "\n" + fails + " FAILED" : "\nALL 9.8 LIBRARY CHECKS PASSED");
process.exit(fails ? 1 : 0);
