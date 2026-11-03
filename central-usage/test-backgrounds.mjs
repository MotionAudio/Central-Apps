// The lyric backgrounds (app/backgrounds.js): every one draws, none is blank, motion ones move and stills don't,
// they all look different from each other, and drawing is quick enough for an output at 30 fps.
//   node test-backgrounds.mjs
import { existsSync as require_fs_exists } from "node:fs";   // (a local browser path only when it exists; CI uses Playwright's own)
import { chromium } from "playwright";
import { createRequire } from "node:module"; import path from "node:path"; import assert from "node:assert"; import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url)), require = createRequire(import.meta.url);
let failures = 0; async function check(label, fn) { try { await fn(); console.log("  ✓ " + label); } catch (e) { failures++; console.error("  ✗ " + label + "\n      " + String(e && e.message || e).split("\n").slice(0, 6).join("\n      ")); } }

const B = require("./app/backgrounds.js");
await check("the list: at least 40, motion and stills, unique ids and names, plain names", () => {
  assert.ok(B.list.length >= 40, "count " + B.list.length);
  assert.equal(new Set(B.list.map((b) => b.id)).size, B.list.length); assert.equal(new Set(B.list.map((b) => b.name)).size, B.list.length);
  assert.ok(B.list.filter((b) => b.kind === "motion").length >= 25 && B.list.filter((b) => b.kind === "still").length >= 10);
  assert.ok(B.isBg("bg:royal") && !B.isBg("/home/x.png") && B.idOf("bg:royal") === "royal" && B.nameOf("bg:royal") === "Royal");
});

const browser = await chromium.launch({ executablePath: [process.env.CHROME, "/opt/pw-browsers/chromium"].find((p) => p && require_fs_exists(p)) });
const page = await browser.newPage();
await page.goto("file://" + path.join(here, "app", "output.html"));
await page.addScriptTag({ path: path.join(here, "app", "backgrounds.js") });
await page.addScriptTag({ path: path.join(here, "app", "backgrounds-seasons.js") });   // (10.2: Central Utility's seasonal set)
const r = await page.evaluate(() => {
  const W = 96, H = 54, c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d", { willReadFrequently: true });
  const shot = (id, t) => { g.clearRect(0, 0, W, H); CUBackgrounds.draw(id, g, W, H, t); return Array.from(g.getImageData(0, 0, W, H).data); };
  const out = {};
  for (const b of CUBackgrounds.list) {
    const a = shot(b.id, 10), z = shot(b.id, 16);
    let sum = 0, sq = 0, diff = 0, n = 0; for (let i = 0; i < a.length; i += 4) { const l = (a[i] + a[i + 1] + a[i + 2]) / 3; sum += l; sq += l * l; diff += Math.abs(a[i] - z[i]) + Math.abs(a[i + 1] - z[i + 1]) + Math.abs(a[i + 2] - z[i + 2]); n++; }
    const mean = sum / n; out[b.id] = { kind: b.kind, mean, sd: Math.sqrt(Math.max(0, sq / n - mean * mean)), move: diff / n / 3, px: a.filter((_, i) => i % 4 !== 3) };
  }
  // speed: one 960 x 540 frame of each motion background (what an output draws at half size)
  const big = document.createElement("canvas"); big.width = 960; big.height = 540; const bg = big.getContext("2d"); const slow = [];
  for (const b of CUBackgrounds.list) { if (b.kind !== "motion") continue; CUBackgrounds.draw(b.id, bg, 960, 540, 19); const t0 = performance.now();   /* (the first frame at a size builds its cached layers) */ for (let k = 0; k < 3; k++) CUBackgrounds.draw(b.id, bg, 960, 540, 20 + k / 30); const ms = (performance.now() - t0) / 3; if (ms > 30) slow.push(b.id + " " + ms.toFixed(1) + " ms"); }
  return { out, slow };
});
await check("every background draws something (not left empty; a solid colour may be flat, the others have shape)", () => {
  const bad = Object.entries(r.out).filter(([id, v]) => v.kind === "motion" ? v.sd < 2 && v.mean < 3 : false).map(([id]) => id);
  assert.deepEqual(bad, []);
  const blank = Object.entries(r.out).filter(([id, v]) => id !== "black" && v.mean < 1).map(([id]) => id); assert.deepEqual(blank, []);
});
await check("motion backgrounds move; stills stay the same", () => {
  const still = Object.entries(r.out).filter(([, v]) => v.kind === "motion" && v.move < 0.3).map(([id, v]) => id + " " + v.move.toFixed(2));
  const moving = Object.entries(r.out).filter(([, v]) => v.kind === "still" && v.move > 0.01).map(([id, v]) => id + " " + v.move.toFixed(2));
  assert.ok(!still.length, "motion that doesn't move: " + still.join(", ")); assert.ok(!moving.length, "stills that move: " + moving.join(", "));
});
await check("they all look different from each other (no two closer than a clear step)", () => {
  const ids = Object.keys(r.out), close = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { const a = r.out[ids[i]].px, b = r.out[ids[j]].px; let d = 0; for (let k = 0; k < a.length; k++) d += Math.abs(a[k] - b[k]); d /= a.length; if (d < 4) close.push(ids[i] + "~" + ids[j] + " " + d.toFixed(1)); }
  assert.deepEqual(close, [], close.join(", "));
});
await check("quick enough: each motion background draws a 960 x 540 frame in under 30 ms here", () => assert.deepEqual(r.slow, [], r.slow.join(", ")));
await check("the Central Pedal's slides page has the same backgrounds (companion/backgrounds.js is a copy of app/backgrounds.js)", async () => {
  const fs = await import("node:fs");
  assert.equal(fs.readFileSync(path.join(here, "..", "companion", "backgrounds.js"), "utf8"), fs.readFileSync(path.join(here, "app", "backgrounds.js"), "utf8"), "copy app/backgrounds.js to companion/ after changing it");
});
// (10.2) Central Utility's seasonal set (backgrounds-seasons.js)
const sea = await page.evaluate(() => {
  const S = window.CUSeasons, B = window.CUBackgrounds, list = S.list(), d = (y, m, dd) => S.seasonOf(new Date(y, m - 1, dd));
  const seam = []; const a = document.createElement("canvas"), b = document.createElement("canvas"); a.width = b.width = 64; a.height = b.height = 36;
  for (const e of list) { B.draw(e.id, a.getContext("2d"), 64, 36, 0); B.draw(e.id, b.getContext("2d"), 64, 36, 120); const x = a.getContext("2d").getImageData(0, 0, 64, 36).data, y = b.getContext("2d").getImageData(0, 0, 64, 36).data; let s = 0; for (let i = 0; i < x.length; i++) s += Math.abs(x[i] - y[i]); if (s / x.length > 0.5) seam.push(e.id); }
  window.PPLicense = { hasPlan: (t) => t === "utility" }; const okWith = B.allowed(list[0].id); window.PPLicense = { hasPlan: () => false }; const okWithout = B.allowed(list[0].id), freeOk = B.allowed("rays");
  return { n: list.length, seasons: [...new Set(list.map((e) => e.season))], tiers: [...new Set(list.map((e) => e.tier))], tagged: list.every((e) => e.tags && e.tags.length), seam, okWith, okWithout, freeOk,
    easter: [2024, 2025, 2026, 2027, 2028].map((y) => S.easter(y).toDateString()), advent: [2025, 2026, 2027].map((y) => S.adventStart(y).toDateString()),
    days: { "2026-11-29": d(2026, 11, 29), "2026-12-25": d(2026, 12, 25), "2027-01-06": d(2027, 1, 6), "2027-02-10": d(2027, 2, 10), "2027-03-21": d(2027, 3, 21), "2027-03-26": d(2027, 3, 26), "2027-03-28": d(2027, 3, 28), "2027-05-09": d(2027, 5, 9), "2027-05-16": d(2027, 5, 16), "2027-06-20": d(2027, 6, 20), "2027-11-25": d(2027, 11, 25), "2027-01-01": d(2027, 1, 1), "2026-08-16": d(2026, 8, 16) },
    sunday: S.thisSunday(new Date(2026, 10, 25)).date.toDateString() + " " + S.thisSunday(new Date(2026, 10, 25)).season,
    themes: (window.CUSeasonThemes || []).length };
});
await check("seasonal: 40-60 Utility backgrounds over every season, each tagged", () => {
  assert.ok(sea.n >= 40 && sea.n <= 60, "count " + sea.n); assert.deepEqual(sea.tiers, ["utility"]); assert.ok(sea.tagged);
  for (const s of ["advent", "christmas", "epiphany", "newyear", "ashwednesday", "lent", "palmsunday", "goodfriday", "easter", "pentecost", "communion", "baptism", "mothersday", "fathersday", "thanksgiving", "everyday"]) assert.ok(sea.seasons.includes(s), "no " + s);
});
await check("seasonal: they loop without a seam (the frame at 0 s and at 120 s match)", () => assert.deepEqual(sea.seam, []));
await check("seasonal: only a device with Central Utility can choose them (the free ones stay open)", () => { assert.equal(sea.okWith, true); assert.equal(sea.okWithout, false); assert.equal(sea.freeOk, true); });
await check("the church calendar: Easter by the computus, Advent from the 4th Sunday before Christmas, the feasts", () => {
  assert.deepEqual(sea.easter, ["Sun Mar 31 2024", "Sun Apr 20 2025", "Sun Apr 05 2026", "Sun Mar 28 2027", "Sun Apr 16 2028"]);
  assert.deepEqual(sea.advent, ["Sun Nov 30 2025", "Sun Nov 29 2026", "Sun Nov 28 2027"]);
  assert.deepEqual(sea.days, { "2026-11-29": "advent", "2026-12-25": "christmas", "2027-01-06": "epiphany", "2027-02-10": "ashwednesday", "2027-03-21": "palmsunday", "2027-03-26": "goodfriday", "2027-03-28": "easter", "2027-05-09": "mothersday", "2027-05-16": "pentecost", "2027-06-20": "fathersday", "2027-11-25": "thanksgiving", "2027-01-01": "newyear", "2026-08-16": "everyday" });
  assert.equal(sea.sunday, "Sun Nov 29 2026 advent");
});
await check("seasonal slide looks: 12-20 themes", () => assert.ok(sea.themes >= 12 && sea.themes <= 20, "themes " + sea.themes));
await check("the Central Pedal has the seasonal set too (companion/backgrounds-seasons.js is a copy)", async () => {
  const fs = await import("node:fs");
  assert.equal(fs.readFileSync(path.join(here, "..", "companion", "backgrounds-seasons.js"), "utf8"), fs.readFileSync(path.join(here, "app", "backgrounds-seasons.js"), "utf8"), "copy app/backgrounds-seasons.js to companion/ after changing it");
});
await browser.close();
console.log(failures ? "\n" + failures + " FAILED" : "\nall passed"); process.exit(failures ? 1 : 0);
