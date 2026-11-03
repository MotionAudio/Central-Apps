// The Slides tab (10.2): the designer (decks, text, styling, reordering, undo, going live, what the output draws), lower
// thirds (transparent), import / export helpers, the hub sharing decks between computers, and Scripture in seconds
// (references, the bundled Bibles, splitting into slides, search).
//   node central-usage/test-slides.mjs
import { existsSync as require_fs_exists } from "node:fs";   // (a local browser path only when it exists; CI uses Playwright's own)
import { chromium } from "playwright";
import { spawn } from "node:child_process"; import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import assert from "node:assert";
import { createRequire } from "node:module"; import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url)), require = createRequire(import.meta.url);
let failures = 0;
async function check(label, fn) { try { await fn(); console.log("  ✓ " + label); } catch (e) { failures++; console.error("  ✗ " + label + "\n      " + String(e && e.stack || e).split("\n").slice(0, 4).join("\n      ")); } }

// ---------------------------------------------------------------- Scripture (Node: the same file the app loads)
console.log("Scripture in seconds:");
const S = require("./app/scripture.js");
const refs = (q) => S.parse(q).refs.map((r) => [S.BOOKS[r.book], r.c1, r.v1, r.c2, r.v2]);
await check("references: books by name, abbreviation, number word and Spanish name; verses, ranges, across chapters, lists, whole chapters", () => {
  assert.deepEqual(refs("John 3:16"), [["John", 3, 16, 3, 16]]);
  assert.deepEqual(refs("Ps 23:1-4"), [["Psalms", 23, 1, 23, 4]]);
  assert.deepEqual(refs("Romans 8:28-30"), [["Romans", 8, 28, 8, 30]]);
  assert.deepEqual(refs("1 Cor 13"), [["1 Corinthians", 13, 1, 13, 999]]);
  assert.deepEqual(refs("Jn 3:16-4:2"), [["John", 3, 16, 4, 2]]);
  assert.deepEqual(refs("I John 4:8"), [["1 John", 4, 8, 4, 8]]);
  assert.deepEqual(refs("First Corinthians 13:4-7"), [["1 Corinthians", 13, 4, 13, 7]]);
  assert.deepEqual(refs("Isaiah 40:31"), [["Isaiah", 40, 31, 40, 31]], "Isaiah isn't 1 saiah");
  assert.deepEqual(refs("Jude 3"), [["Jude", 1, 3, 1, 3]], "a one-chapter book: the number is the verse");
  assert.deepEqual(refs("John 3:16, 18; 4:1"), [["John", 3, 16, 3, 16], ["John", 3, 18, 3, 18], ["John", 4, 1, 4, 1]]);
  assert.deepEqual(refs("Rom 8:28, 31-39"), [["Romans", 8, 28, 8, 28], ["Romans", 8, 31, 8, 39]]);
  assert.deepEqual(refs("Juan 3:16"), [["John", 3, 16, 3, 16]]);
  assert.deepEqual(refs("Song 2:1"), [["Song of Solomon", 2, 1, 2, 1]]);
  assert.deepEqual(refs("Phil 4:13"), [["Philippians", 4, 13, 4, 13]]);
  assert.deepEqual(refs("Gen 1-2"), [["Genesis", 1, 1, 2, 999]]);
  assert.ok(S.parse("xyz 1:2").errors.length && !S.parse("xyz 1:2").refs.length, "not a book");
});
await check("the four bundled Bibles: John 3:16 in each, the right words; the Spanish one names its books in Spanish", async () => {
  const k = await S.lookup("John 3:16", "kjv"); assert.equal(k.label, "John 3:16"); assert.match(k.verses[0].text, /^For God so loved the world, that he gave his only begotten Son/);
  const w = await S.lookup("John 3:16", "web"); assert.match(w.verses[0].text, /one and only Son/);
  const a = await S.lookup("John 3:16", "asv"); assert.match(a.verses[0].text, /believeth on him/);
  const r = await S.lookup("Juan 3:16", "rv1909"); assert.equal(r.label, "Juan 3:16"); assert.match(r.verses[0].text, /^Porque de tal manera amó Dios al mundo/);
  for (const t of ["kjv", "web", "asv", "rv1909"]) { const b = await S.load(t); assert.equal(b.books.length, 66); assert.equal(b.books[18].length, 150, t + " has 150 psalms"); assert.equal(b.license, "Public domain"); }
});
await check("a passage splits into slides: whole verses together, a long verse over two, labels per slide; a reference that isn't there says so", async () => {
  const p = await S.lookup("1 Cor 13", "web"); const parts = S.split(p, { maxChars: 260 });
  assert.equal(p.verses.length, 13); assert.ok(parts.length >= 4 && parts.length <= 13, parts.length + " slides");
  assert.ok(parts.every((x) => x.text.length <= 300), "each slide fits"); assert.match(parts[0].label, /^1 Corinthians 13:1/); assert.match(parts[0].text, /^¹ /, "verse numbers");
  const long = S.split({ label: "x", translation: "KJV", verses: [{ b: 16, c: 8, v: 9, text: (await S.lookup("Esther 8:9", "kjv")).verses[0].text }] }, { maxChars: 200 });
  assert.ok(long.length >= 2, "Esther 8:9 (the longest verse) goes over several slides");
  await assert.rejects(S.lookup("John 99:1", "kjv"), /There's no John 99:1/);
});
await check("search: verses with all the words, in Bible order; a licensed translation can be added as a provider", async () => {
  const h = await S.search("love one another", "web", 10); assert.ok(h.length >= 3); assert.equal(h[0].label, "John 13:34");
  S.registerProvider({ id: "demo", name: "Demo licensed", short: "DEMO", lookup: async (rs) => rs.map((r) => ({ b: r.book, c: r.c1, v: r.v1, text: "licensed text" })) });
  assert.ok(S.translations().some((t) => t.id === "demo")); const d = await S.lookup("John 1:1", "demo"); assert.equal(d.verses[0].text, "licensed text"); assert.equal(d.translation, "DEMO");
});

// ---------------------------------------------------------------- the hub: decks shared between computers (center.js)
console.log("Decks through the hub:");
const ctrDir = fs.mkdtempSync(path.join(os.tmpdir(), "cu-slides-center-"));
const ctr = spawn(process.execPath, [path.join(here, "center.js"), "--port", "8199", "--data", ctrDir, "--no-beacon"], { stdio: ["ignore", "pipe", "pipe"] });
await new Promise((r) => setTimeout(r, 900));
const WS = require("ws");
function client() {
  return new Promise((res) => {
    const ws = new WS("ws://127.0.0.1:8199"), q = [], waiters = [];
    ws.on("message", (b) => { const m = JSON.parse(String(b)); const w = waiters.findIndex((x) => x.f(m)); if (w >= 0) waiters.splice(w, 1)[0].r(m); else q.push(m); });
    ws.on("open", () => res({ ws, send: (m) => ws.send(JSON.stringify(m)), wait: (f, ms) => new Promise((r, j) => { const i = q.findIndex(f); if (i >= 0) return r(q.splice(i, 1)[0]); waiters.push({ f, r }); setTimeout(() => j(new Error("timeout")), ms || 3000); }) }));
  });
}
await check("one computer puts a deck and a picture; another gets the deck pushed to it, and the picture on asking; a delete is remembered", async () => {
  const a = await client(), b = await client();
  a.send({ type: "cuRole", action: "hello", id: "dMain", name: "Sound desk", role: "main", token: "t".repeat(32), pin: "4321", pair: "0915" }); await a.wait((m) => m.type === "cuRoles" && m.youAreMain);
  b.send({ type: "cuRole", action: "join", id: "dUser", name: "Keys", role: "user1", pair: "0915" }); await b.wait((m) => m.type === "cuRoleReply" && m.action === "join");
  b.send({ type: "slides", action: "put", deck: { id: "deck-user", name: "x", slides: [] } }); assert.ok(!(await b.wait((m) => m.type === "slidesReply" && m.action === "put")).ok, "a musician's computer can't change decks");
  const deck = { id: "deck-test1", name: "Sunday", slides: [{ id: "s1", kind: "design", els: [], bg: { type: "image", media: "" } }], updatedAt: Date.now() };
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const id = "media:" + (await import("node:crypto")).createHash("sha256").update(png).digest("hex"); deck.slides[0].bg.media = id;
  a.send({ type: "slides", action: "mediaPut", id, mime: "image/png", name: "dot.png", data: png.toString("base64") }); const mr = await a.wait((m) => m.type === "slidesReply" && m.action === "mediaPut"); assert.ok(mr.ok, JSON.stringify(mr));
  a.send({ type: "slides", action: "put", deck }); assert.ok((await a.wait((m) => m.type === "slidesReply" && m.action === "put")).ok);
  const pushed = await b.wait((m) => m.type === "slidesDecks" && m.decks && m.decks.some((d) => d.id === "deck-test1")); assert.equal(pushed.decks[0].name, "Sunday");
  b.send({ type: "slides", action: "mediaGet", id }); const got = await b.wait((m) => m.type === "slidesMedia"); assert.equal(Buffer.from(got.data, "base64").length, png.length);
  a.send({ type: "slides", action: "put", deck: Object.assign({}, deck, { name: "Old", updatedAt: deck.updatedAt - 1000 }) }); assert.ok((await a.wait((m) => m.type === "slidesReply" && m.action === "put")).older, "an older copy doesn't win");
  a.send({ type: "slides", action: "del", id: "deck-test1" }); await a.wait((m) => m.type === "slidesReply" && m.action === "del");
  b.send({ type: "slides", action: "get" }); const full = await b.wait((m) => m.type === "slidesDecks" && m.full); assert.ok(!full.decks.some((d) => d.id === "deck-test1") && full.removed["deck-test1"]);
  a.send({ type: "slides", action: "mediaPut", id, mime: "image/png", data: Buffer.from("not it").toString("base64") }); assert.ok(!(await a.wait((m) => m.type === "slidesReply" && m.action === "mediaPut")).ok, "a file that doesn't match its id is refused");
  a.ws.close(); b.ws.close();
  await new Promise((r) => setTimeout(r, 500)); assert.ok(fs.existsSync(path.join(ctrDir, "slides.json")) && fs.existsSync(path.join(ctrDir, "slides-media", id.slice(6))));
});
ctr.kill();

// ---------------------------------------------------------------- the designer and the output, in the app's page
console.log("The Slides tab:");
const b = await chromium.launch({ executablePath: [process.env.CHROME, "/opt/pw-browsers/chromium"].find((p) => p && require_fs_exists(p)), args: ["--autoplay-policy=no-user-gesture-required", "--allow-file-access-from-files"] });
const ctx = await b.newContext({ viewport: { width: 1500, height: 1000 } });
const page = await ctx.newPage(); const errs = [];
page.on("pageerror", (e) => errs.push(String(e))); page.on("console", (m) => { if (m.type() === "error" && !/favicon|ERR_|net::|Failed to load resource|WebSocket/.test(m.text())) errs.push("console: " + m.text()); });
await page.addInitScript(() => { localStorage.setItem("cu-mode", JSON.stringify("admin")); localStorage.setItem("cu-role", JSON.stringify("main")); try { localStorage.setItem("cc-license", JSON.stringify({ key: "ADEF-AULT-KEY0-2026", kind: "A", app: "control", okAt: Date.now(), production: "Test" })); } catch (_) { } });
await page.goto("file://" + path.join(here, "app", "index.html")); await page.waitForFunction(() => window.CentralUsage && window.CUSlides && window.CUSlideRender && window.CUScripture);
await page.evaluate(() => { const t = document.querySelector('[data-tab="slides"]'); t.hidden = false; t.click(); });
await page.waitForSelector("#slHead");
const shown = []; await page.exposeFunction("__shown", (m) => shown.push(m)); await page.evaluate(() => CUSlides.onShow((m) => window.__shown(JSON.parse(JSON.stringify(m)))));

await check("a new announcements deck starts with a slide; the deck list and the slide strip show it", async () => {
  await page.selectOption('[data-sl="newDeck"]', "announcements");
  await page.waitForSelector(".sl-dk.on"); assert.match(await page.textContent(".sl-dk.on"), /Announcements/);
  assert.equal(await page.locator(".sl-tile").count(), 1);
});
await check("Design: + Text adds a box; the inspector styles it (words, size, colour, font); the canvas draws that colour", async () => {
  await page.click('[data-sl-mode="design"]'); await page.waitForSelector("#slEdCanvas");
  await page.click('[data-ed="text"]'); await page.waitForSelector(".sl-sel");
  await page.fill('[data-f="text.value"]', "HELLO CHURCH"); await page.dispatchEvent('[data-f="text.value"]', "change");
  await page.fill('[data-f="text.size"]', "140"); await page.dispatchEvent('[data-f="text.size"]', "change");
  await page.evaluate(() => { const c = document.querySelector('[data-f="text.color"]'); c.value = "#ff0000"; c.dispatchEvent(new Event("input", { bubbles: true })); c.dispatchEvent(new Event("change", { bubbles: true })); });
  await page.selectOption('[data-f="text.font"]', "Georgia");
  const d = await page.evaluate(() => CUSlides.deck()); const t = d.slides[0].els[d.slides[0].els.length - 1];
  assert.equal(t.text.value, "HELLO CHURCH"); assert.equal(t.text.size, 140); assert.equal(t.text.color, "#ff0000"); assert.equal(t.text.font, "Georgia");
  const red = await page.evaluate(() => { const c = document.getElementById("slEdCanvas"), x = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 0; i < x.length; i += 4) if (x[i] > 200 && x[i + 1] < 60 && x[i + 2] < 60) n++; return n; });
  assert.ok(red > 200, "red text pixels on the editor canvas: " + red);
});
await check("drag a box with the mouse; it snaps to the slide's centre and shows a guide; undo puts it back", async () => {
  const before = await page.evaluate(() => { const d = CUSlides.deck(), s = d.slides[0], e = s.els[s.els.length - 1]; return { x: e.x, y: e.y, w: e.w, h: e.h, id: e.id }; });
  await page.evaluate((id) => { const s = CUSlides.deck().slides[0], e = s.els.find((x) => x.id === id); e.w = 600; e.x = 100; CUSlides.select([id]); }, before.id);
  await page.evaluate(() => CUSlides.render());
  const ov = await page.locator("#slOv").boundingBox(), k = ov.width / 1920;
  const sx = ov.x + (100 + 300) * k, sy = ov.y + (before.y + before.h / 2) * k;
  await page.mouse.move(sx, sy); await page.mouse.down(); await page.mouse.move(sx + 200 * k, sy + 3, { steps: 4 }); await page.mouse.move(sx + (960 - 400) * k + 2 * k, sy, { steps: 6 });
  assert.ok(await page.locator(".sl-guide.v").count() >= 1, "a guide while it snaps");
  await page.mouse.up();
  const after = await page.evaluate((id) => CUSlides.deck().slides[0].els.find((x) => x.id === id), before.id);
  assert.equal(after.x + after.w / 2, 960, "centred by the snap: " + (after.x + after.w / 2));
  await page.evaluate(() => CUSlides.undo()); const undone = await page.evaluate((id) => CUSlides.deck().slides[0].els.find((x) => x.id === id), before.id);
  assert.equal(undone.x, 100, "undo");
});
await check("+ Slide adds a second (a Title); reorder moves it first; delete key removes a selected box", async () => {
  await page.selectOption('[data-sl="addSlide"]', "title");
  let d = await page.evaluate(() => CUSlides.deck()); assert.equal(d.slides.length, 2);
  const [s1, s2] = d.slides.map((s) => s.id); await page.evaluate(([a, b]) => CUSlides.moveSlide(b, a), [s1, s2]);
  d = await page.evaluate(() => CUSlides.deck()); assert.equal(d.slides[0].id, s2, "moved first");
  await page.evaluate((id) => CUSlides.preview(id), s2); const n0 = (await page.evaluate(() => CUSlides.deck().slides[0].els.length));
  const id0 = await page.evaluate(() => CUSlides.deck().slides[0].els[0].id); await page.evaluate((id) => CUSlides.select([id]), id0);
  await page.locator("body").press("Delete"); assert.equal(await page.evaluate(() => CUSlides.deck().slides[0].els.length), n0 - 1);
});
await check("themes restyle boxes nobody changed by hand; a box keeps its own colour", async () => {
  const d = await page.evaluate(() => CUSlides.deck()); const s = d.slides[1];
  await page.evaluate((id) => CUSlides.preview(id), s.id); await page.selectOption('[data-deck-f="theme"]', "clean");
  const looks = await page.evaluate((sid) => { const d = CUSlides.deck(), s = d.slides.find((x) => x.id === sid), th = CUSlideRender.theme(d.theme); return s.els.filter((e) => e.type === "text").map((e) => CUSlideRender.textStyle(e, th).color); }, s.id);
  assert.ok(looks.includes("#ff0000"), "own colour kept"); assert.ok(looks.some((c) => c === "#222222" || c === "#1b1b1b"), "theme colour applied: " + looks);
});
await check("Show: Go live sends the slide (design, its deck size and theme); the output page draws it; Next goes to the next slide", async () => {
  await page.click('[data-sl-mode="show"]'); await page.waitForSelector("#slPrevCanvas");
  const d = await page.evaluate(() => CUSlides.deck());
  await page.evaluate((id) => CUSlides.goLive(id), d.slides[1].id); await page.waitForFunction(() => CUSlides.live().slide && CUSlides.live().slide.kind === "design");
  const msg = shown[shown.length - 1]; assert.equal(msg.kind, "design"); assert.equal(msg.design.id, d.slides[1].id); assert.equal(msg.deck.size.w, 1920); assert.ok(msg.deck.theme && msg.deck.theme.id === "clean");
  await page.waitForSelector("#slLiveCanvas"); assert.match(await page.textContent("#slLiveName"), /This week|HELLO CHURCH/);
  const out = await ctx.newPage(); await out.setViewportSize({ width: 960, height: 540 }); await out.goto("file://" + path.join(here, "app", "output.html")); await out.waitForFunction(() => window.showSlide && window.CUSlideRender);
  await out.evaluate((m) => window.showSlide(m), msg); await out.waitForTimeout(900);
  const px = await out.evaluate(() => { const c = document.querySelector(".layer.on canvas"); if (!c) return null; const x = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let red = 0, light = 0; for (let i = 0; i < x.length; i += 4) { if (x[i] > 200 && x[i + 1] < 60 && x[i + 2] < 60) red++; if (x[i] > 230 && x[i + 1] > 225 && x[i + 2] > 215) light++; } return { red, light, w: c.width }; });
  assert.ok(px && px.red > 100, "the output draws the red words: " + JSON.stringify(px)); assert.ok(px.light > px.w * 50, "on the clean theme's light background");
  await out.close();
  await page.evaluate(() => CUSlides.next()); await page.waitForFunction((id) => CUSlides.live().id && CUSlides.live().id !== id, d.slides[1].id).catch(() => { });
  // (slide 2 was the last: next stays, unless the deck loops) - make it loop and go again
  await page.check('[data-sl="loop"]'); await page.evaluate(() => CUSlides.next()); await page.waitForFunction((id) => CUSlides.live().id === id, d.slides[0].id);
});
await check("a lower third is see-through: the output marks it transparent and draws nothing at the top of the screen", async () => {
  const d = await page.evaluate(() => CUSlides.deck());
  await page.click('[data-sl-mode="design"]'); await page.selectOption('[data-sl="addSlide"]', "lower");
  const lower = await page.evaluate(() => { const d = CUSlides.deck(); return d.slides.find((s) => s.kind === "lower"); }); assert.ok(lower);
  await page.evaluate((id) => CUSlides.goLive(id), lower.id); await page.waitForFunction(() => CUSlides.live().slide && CUSlides.live().slide.transparent === true);
  const msg = shown[shown.length - 1]; assert.equal(msg.transparent, true);
  const out = await ctx.newPage(); await out.setViewportSize({ width: 960, height: 540 }); await out.goto("file://" + path.join(here, "app", "output.html")); await out.waitForFunction(() => window.showSlide);
  await out.evaluate((m) => window.showSlide(m), msg); await out.waitForTimeout(1200);
  const r = await out.evaluate(() => { const c = document.querySelector(".layer.on canvas"), g = c.getContext("2d"); const top = g.getImageData(0, 0, c.width, Math.round(c.height * 0.5)).data, bot = g.getImageData(0, Math.round(c.height * 0.76), c.width, Math.round(c.height * 0.1)).data; let topA = 0, botA = 0; for (let i = 3; i < top.length; i += 4) topA += top[i]; for (let i = 3; i < bot.length; i += 4) botA += bot[i]; return { topA, botA, see: document.body.classList.contains("see-through") }; });
  assert.equal(r.topA, 0, "nothing drawn above the lower third"); assert.ok(r.botA > 0, "the bar is drawn"); assert.ok(r.see, "the page is see-through");
  await out.close();
});
await check("Scripture in seconds: Romans 8:28-30 becomes slides and a lower third in a Scripture deck, and goes live", async () => {
  await page.click('[data-sl-mode="show"]'); await page.waitForSelector("#slScrRef");
  await page.fill("#slScrRef", "Romans 8:28-30"); await page.press("#slScrRef", "Enter");
  await page.waitForSelector(".sl-scr-part"); assert.match(await page.textContent(".sl-scr-h"), /Romans 8:28-30 \(KJV\)/);
  await page.click('[data-sl="scrShow"]'); await page.waitForFunction(() => CUSlides.live().slide && CUSlides.live().slide.kind === "design" && /Romans/.test(CUSlides.deck(CUSlides.live().deckId).name));
  const d = await page.evaluate(() => CUSlides.deck(CUSlides.live().deckId));
  assert.equal(d.kind, "scripture"); assert.ok(d.slides.some((s) => s.kind === "lower"), "a lower third"); assert.match(JSON.stringify(d.slides[0].els), /all things work together for good/);
  await page.fill("#slScrRef", "love one another"); await page.press("#slScrRef", "Enter"); await page.waitForSelector(".sl-hit"); assert.match(await page.textContent(".sl-hit"), /John 13:34/);
});
await check("readings saved to a deck are one click away; the API makes a scripture deck from a reference (for the run sheet)", async () => {
  await page.fill("#slReadAdd", "Psalm 23"); await page.click('[data-sl="readAdd"]'); await page.waitForSelector('[data-read="Psalm 23"]');
  await page.click('[data-read="Psalm 23"]'); await page.waitForFunction(() => /Psalms 23/.test(document.querySelector(".sl-scr-h") && document.querySelector(".sl-scr-h").textContent));
  const id = await page.evaluate(async () => (await CUSlides.scripture("John 1:1-5", { translation: "web" })).id); const d = await page.evaluate((i) => CUSlides.deck(i), id); assert.match(d.name, /John 1:1-5 \(WEB\)/);
});
await check("the run sheet: a deck tied to an item comes up when the service reaches it; a reading in an item's note is ready in the Scripture box", async () => {
  const id = await page.evaluate(() => { const d = CUSlides.decks().find((x) => x.kind === "announcements"); d.runItem = "it1"; return d.id; });
  await page.evaluate(() => { const other = CUSlides.decks().find((x) => x.kind === "scripture"); CUSlides.state().activeDeck = other.id; CUSlides.render(); });
  const svc = (item) => ({ type: "services", from: "center", fromCenter: true, services: [{ id: "sv1", name: "Sunday", day: 0, time: "09:00", roles: ["slides"], record: false, items: [{ id: "it1", title: "Welcome", kind: "welcome", minutes: 5, roles: [], song: "", note: "" }, { id: "it2", title: "Reading", kind: "sermon", minutes: 5, roles: [], song: "", note: "Psalm 46:1" }] }], run: { service: "sv1", item, itemStart: Date.now(), startedAt: Date.now() }, now: Date.now(), roles: ["lighting", "production", "slides", "lyrics", "mix", "inears", "band"], kinds: ["song", "welcome", "sermon", "other"], max: 4 });
  await page.evaluate((m) => CentralUsage.onMessage(m), svc(0)); await page.waitForFunction((i) => CUSlides.state().activeDeck === i, id);
  await page.evaluate((m) => CentralUsage.onMessage(m), svc(1)); await page.waitForFunction(() => /Psalms 46:1/.test((document.querySelector(".sl-scr-h") || {}).textContent || ""));
  assert.equal(await page.inputValue("#slScrRef"), "Psalm 46:1");
});
await check("export: a deck makes a real PDF (one page a slide) and a zip of pictures; a .pptx's words and picture come in", async () => {
  const r = await page.evaluate(async () => {
    const d = CUSlides.deck(), pages = [];
    for (const s of d.slides.slice(0, 2)) { const b = await CUSlides.toBlob(d, s, 320, 180, "image/jpeg"); pages.push({ w: 320, h: 180, jpg: new Uint8Array(await b.arrayBuffer()) }); }
    const pdf = CUSlides._pdf(pages, 320, 180), head = new TextDecoder().decode(pdf.slice(0, 8)), tail = new TextDecoder().decode(pdf.slice(-6));
    const zip = await CUSlides._zip([{ name: "a.png", data: new Uint8Array([1, 2, 3]) }]).arrayBuffer(); const back = await CUSlides._unzip(zip); const a = await back.read("a.png");
    // a tiny .pptx made here: one slide with a title and a body
    const enc = (s) => new TextEncoder().encode(s);
    const files = [
      { name: "ppt/presentation.xml", data: enc('<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/></p:presentation>') },
      { name: "ppt/_rels/presentation.xml.rels", data: enc('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Target="slides/slide1.xml"/></Relationships>') },
      { name: "ppt/slides/slide1.xml", data: enc('<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="609600" y="304800"/><a:ext cx="10972800" cy="1143000"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:rPr sz="4400"/><a:t>Easter Sunday</a:t></a:r></a:p></p:txBody></p:sp><p:sp><p:spPr><a:xfrm><a:off x="609600" y="1600200"/><a:ext cx="10972800" cy="4525963"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>Services at 9 and 11</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>') }
    ];
    const px = await CUSlides._importPptx(new File([await CUSlides._zip(files).arrayBuffer()], "t.pptx"), d);
    return { head, tail, len: pdf.length, pages: (new TextDecoder().decode(pdf).match(/\/Type \/Page\b/g) || []).length, a: Array.from(a), pptx: px.map((s) => s.els.map((e) => e.text && e.text.value)) };
  });
  assert.equal(r.head.slice(0, 5), "%PDF-"); assert.match(r.tail, /%%EOF/); assert.equal(r.pages, 2);
  assert.deepEqual(r.a, [1, 2, 3], "zip round trip");
  assert.deepEqual(r.pptx, [["Easter Sunday", "Services at 9 and 11"]]);
});
await check("decks and their slides stay after a reload (this computer's copy)", async () => {
  const n = await page.evaluate(() => CUSlides.decks().length); await page.reload(); await page.waitForFunction(() => window.CUSlides);
  assert.equal(await page.evaluate(() => CUSlides.decks().length), n);
});
await check("no errors on the page", () => { assert.deepEqual(errs, []); });
await b.close();
fs.rmSync(ctrDir, { recursive: true, force: true });
console.log(failures ? "\n" + failures + " FAILED" : "\nall passed");
process.exit(failures ? 1 : 0);
