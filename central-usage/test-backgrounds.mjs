// The lyric backgrounds (app/backgrounds.js): every one draws, none is blank, motion ones move and stills don't,
// they all look different from each other, and drawing is quick enough for an output at 30 fps.
//   node test-backgrounds.mjs
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

const browser = await chromium.launch({ executablePath: process.env.CHROME || "/opt/pw-browsers/chromium" });
const page = await browser.newPage();
await page.goto("file://" + path.join(here, "app", "output.html"));
await page.addScriptTag({ path: path.join(here, "app", "backgrounds.js") });
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
  for (const b of CUBackgrounds.list) { if (b.kind !== "motion") continue; const t0 = performance.now(); for (let k = 0; k < 3; k++) CUBackgrounds.draw(b.id, bg, 960, 540, 20 + k / 30); const ms = (performance.now() - t0) / 3; if (ms > 30) slow.push(b.id + " " + ms.toFixed(1) + " ms"); }
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
  assert.deepEqual(close, []);
});
await check("quick enough: each motion background draws a 960 x 540 frame in under 30 ms here", () => assert.deepEqual(r.slow, []));
await browser.close();
console.log(failures ? "\n" + failures + " FAILED" : "\nall passed"); process.exit(failures ? 1 : 0);
