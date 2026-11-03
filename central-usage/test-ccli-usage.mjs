// The CCLI report's stream and print columns (10.2): while the live stream is on air (the Video tab going live, or the
// Stream mix) each song shown is noted once as streamed - the one already up when it starts too; Print chart on the
// Chord chart tab prints the chart as shown (or saves a PDF) and notes the song as printed.
//   node central-usage/test-ccli-usage.mjs
import { existsSync as require_fs_exists } from "node:fs";   // (a local browser path only when it exists; CI uses Playwright's own)
import "../test-reap.mjs";
import { chromium } from "playwright";
import path from "node:path"; import assert from "node:assert"; import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
let failures = 0;
async function check(label, fn) { try { await fn(); console.log("  ✓ " + label); } catch (e) { failures++; console.error("  ✗ " + label + "\n      " + String(e && e.stack || e).split("\n").slice(0, 5).join("\n      ")); } }

const b = await chromium.launch({ executablePath: [process.env.CHROME, "/opt/pw-browsers/chromium"].find((p) => p && require_fs_exists(p)) });
const page = await (await b.newContext({ viewport: { width: 1300, height: 900 } })).newPage(); const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));
await page.addInitScript(() => {
  localStorage.setItem("cu-mode", JSON.stringify("admin")); localStorage.setItem("cu-role", JSON.stringify("main"));
  try { localStorage.setItem("cc-license", JSON.stringify({ key: "ADEF-AULT-KEY0-2026", kind: "A", app: "control", okAt: Date.now(), production: "Test", isDefault: true })); } catch (_) { }
  window.print = function () { (window.top.__printed = (window.top.__printed || 0) + 1); };   // (no print dialog in a test)
  Object.defineProperty(window, "__noPrintDialog", { value: true });
});
await page.goto("file://" + path.join(here, "app", "index.html"));
await page.waitForFunction(() => window.CentralUsage && window.PPCcli && window.CUCcliUsage);
const song = (name, ccli, i) => ({ name, ccli, author: "John Newton", copyright: "Public domain", index: i });
const display = (s, playing, extra) => page.evaluate(([s, playing, extra]) => CentralUsage.onMessage(Object.assign({ type: "display", song: s, songs: [s], playing, songId: "s" + s.index }, extra || {})), [s, playing, extra || null]);
const queue = () => page.evaluate(() => PPCcli.queue().map((q) => q.kind + ":" + q.title));
await page.evaluate(() => { try { localStorage.removeItem("pp-ccli-queue"); } catch (_) { } });

await check("the stream going on air (the Video tab says so) notes the song that's up as streamed; a song shown while live is noted too; off air, nothing", async () => {
  await display(song("Amazing Grace", "22025", 0), true);
  assert.deepEqual((await queue()).filter((q) => /^stream/.test(q)), [], "not streaming yet");
  await page.evaluate(() => { const V = window.CUVideoTab = window.CUVideoTab || {}; window.__air = true; V.streaming = () => window.__air; CentralUsage.fire("videoStreaming", true); });
  await display(song("How Great Thou Art", "14181", 1), true);
  await page.evaluate(() => { window.__air = false; CentralUsage.fire("videoStreaming", false); });
  await display(song("Be Thou My Vision", "30639", 2), true);
  const q = (await queue()).filter((x) => /^stream/.test(x));
  assert.deepEqual(q, ["stream:Amazing Grace", "stream:How Great Thou Art"], JSON.stringify(q));
});
await check("Print chart: the chart as shown with its title and copyright line, to the printer (or a PDF), noted as printed", async () => {
  await page.evaluate(() => { document.querySelector('[data-tab="chart"]').hidden = false; document.querySelector('[data-tab="chart"]').click(); });
  const s = song("Amazing Grace", "22025", 0);
  await display(s, false, { sheet: { id: "s0", name: "Amazing Grace", key: "G", chartText: "{title: Amazing Grace}\n{key: G}\n[Verse 1]\n[G]Amazing grace how [C]sweet the [G]sound" } });
  await page.waitForFunction(() => document.querySelector("#chart .csec, #chart .chord, #chart pre") || !document.querySelector("#chart .empty"), null, { timeout: 5000 });
  await page.evaluate(() => document.querySelector("#printChart").click());   // (the Chord chart tab is the musicians' - Central Usage; the page here is admin)
  await page.waitForFunction(() => window.__printed >= 1, null, { timeout: 5000 });
  const r = await page.evaluate(() => { const f = [...document.querySelectorAll("iframe")].pop(), d = f && f.contentDocument; return { title: d && d.querySelector("h1") && d.querySelector("h1").textContent, chart: d && d.querySelector(".chart") && d.querySelector(".chart").textContent, foot: d && d.querySelector(".foot") && d.querySelector(".foot").textContent }; });
  assert.equal(r.title, "Amazing Grace"); assert.match(r.chart || "", /Amazing\s+grace/); assert.match(r.foot || "", /22025|Newton/);
  assert.ok((await queue()).includes("print:Amazing Grace"), JSON.stringify(await queue()));
});
await check("no page errors", () => assert.deepEqual(errs, []));
await b.close();
console.log(failures ? "\n" + failures + " FAILED" : "\nall passed"); process.exit(failures ? 1 : 0);
