// Pictures in (10.2): any common picture as a slide or a background (js/pictures.js, pictures-native.js, the Slides tab).
// JPEG with the phone's EXIF rotation, PNG with see-through, WebP, an animated GIF (kept moving), BMP, AVIF, SVG, TIFF and
// HEIC (converted by the app's ffmpeg), a picture too big (made 3840), plain errors, ten pictures at once in name order,
// a drop onto the slides list and a paste.
//   CU_FFMPEG=<the app's ffmpeg 9.x> node central-usage/test-pictures.mjs      (the test pictures: test-pictures/, made by tools/make-test-pictures.py)
import { chromium } from "playwright";
import fs from "node:fs"; import path from "node:path"; import assert from "node:assert";
import { createRequire } from "node:module"; import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url)), require = createRequire(import.meta.url), pics = path.join(here, "test-pictures");
let failures = 0;
async function check(label, fn) { try { await fn(); console.log("  ✓ " + label); } catch (e) { failures++; console.error("  ✗ " + label + "\n      " + String(e && e.stack || e).split("\n").slice(0, 5).join("\n      ")); } }
const native = require("./pictures-native.js"), { findFfmpeg } = require("./video-service.js");
const ffmpeg = findFfmpeg(path.join(here, "native", "build"));
const shared = path.join(here, "app", "shared", "pictures.js"); fs.mkdirSync(path.dirname(shared), { recursive: true }); fs.copyFileSync(path.join(here, "..", "js", "pictures.js"), shared);

const b = await chromium.launch({ executablePath: process.env.CHROME || "/opt/pw-browsers/chromium" });
const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage(); const errs = [];
page.on("pageerror", (e) => errs.push(String(e))); page.on("console", (m) => { if (m.type() === "error" && !/favicon|ERR_|net::|Failed to load resource|WebSocket/.test(m.text())) errs.push("console: " + m.text()); });
await page.addInitScript(() => { localStorage.setItem("cu-mode", JSON.stringify("admin")); localStorage.setItem("cu-role", JSON.stringify("main")); try { localStorage.setItem("cc-license", JSON.stringify({ key: "ADEF-AULT-KEY0-2026", kind: "A", app: "control", okAt: Date.now(), production: "Test" })); } catch (_) { } });
await page.exposeFunction("__convert", async (b64, kind) => { const r = await native.convert(ffmpeg, Buffer.from(b64, "base64"), kind); return r.error ? { error: r.error } : { b64: Buffer.from(r.bytes).toString("base64"), mime: r.mime }; });
await page.goto("file://" + path.join(here, "app", "index.html")); await page.waitForFunction(() => window.CentralUsage && window.CUSlides && window.CUPictures);
const file = (n) => fs.readFileSync(path.join(pics, n)).toString("base64");
// prepare one in the page: { ok, name, mime, w, h, animated, changed, px (the top-left area's colour), size, error }
const prep = (name, b64, withConvert = true) => page.evaluate(async ([name, b64, withConvert]) => {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const convert = withConvert ? async (u, kind) => { let s = ""; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); const r = await window.__convert(btoa(s), kind); return r.error ? r : { bytes: Uint8Array.from(atob(r.b64), (c) => c.charCodeAt(0)), mime: r.mime }; } : undefined;
  const r = await CUPictures.prepare({ name, bytes }, { convert });
  if (!r.ok) return r;
  let px = null; if (!r.video) { const bm = await createImageBitmap(r.blob), c = new OffscreenCanvas(bm.width, bm.height), g = c.getContext("2d"); g.drawImage(bm, 0, 0); px = Array.from(g.getImageData(Math.floor(bm.width * 0.08), Math.floor(bm.height * 0.08), 1, 1).data); }
  return { ok: true, name: r.name, mime: r.mime, w: r.width, h: r.height, animated: !!r.animated, changed: !!r.changed, video: !!r.video, px, size: r.blob.size };
}, [name, b64, withConvert]);
const near = (px, rgb, tol = 40) => px && Math.abs(px[0] - rgb[0]) < tol && Math.abs(px[1] - rgb[1]) < tol && Math.abs(px[2] - rgb[2]) < tol;

console.log("Pictures in:");
await check("each kind is known by its first bytes (not its name)", async () => {
  const kinds = await page.evaluate((list) => list.map(([n, b64]) => CUPictures.sniff(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))), [["phone-rotated.jpg", file("phone-rotated.jpg")], ["logo.png", file("logo.png")], ["photo.webp", file("photo.webp")], ["moving.gif", file("moving.gif")], ["old.bmp", file("old.bmp")], ["scan.tiff", file("scan.tiff")], ["iphone.heic", file("iphone.heic")], ["new.avif", file("new.avif")], ["drawing.svg", file("drawing.svg")], ["not-a-picture.jpg", file("not-a-picture.jpg")]]);
  assert.deepEqual(kinds, ["jpeg", "png", "webp", "gif", "bmp", "tiff", "heic", "avif", "svg", null]);
});
await check("a phone's JPEG stored sideways (EXIF orientation 6) comes in upright: 400 x 300 with the yellow corner top-left", async () => {
  const r = await prep("phone-rotated.jpg", file("phone-rotated.jpg"));
  assert.ok(r.ok && r.changed, JSON.stringify(r)); assert.deepEqual([r.w, r.h], [400, 300]); assert.ok(near(r.px, [250, 200, 40]), "top-left is yellow " + r.px); assert.match(r.name, /\.jpg$/);
});
await check("PNG with see-through stays a PNG as it is; WebP stays as it is", async () => {
  const p = await prep("logo.png", file("logo.png")); assert.ok(p.ok && !p.changed && p.mime === "image/png" && p.w === 320, JSON.stringify(p));
  const w = await prep("photo.webp", file("photo.webp")); assert.ok(w.ok && !w.changed && w.w === 640 && w.h === 360, JSON.stringify(w));
});
await check("an animated GIF is kept as it is, so it moves as a background", async () => {
  const g = await prep("moving.gif", file("moving.gif")); assert.ok(g.ok && g.animated && !g.changed && g.mime === "image/gif" && g.size === fs.statSync(path.join(pics, "moving.gif")).size, JSON.stringify(g));
});
await check("BMP, AVIF and SVG become a JPEG the screens can show", async () => {
  const bm = await prep("old.bmp", file("old.bmp")); assert.ok(bm.ok && bm.changed && bm.mime === "image/jpeg" && /\.jpg$/.test(bm.name) && bm.w === 80, JSON.stringify(bm));
  const av = await prep("new.avif", file("new.avif")); assert.ok(av.ok && av.w === 300 && av.h === 200 && /^image\/(jpeg|png)$/.test(av.mime), JSON.stringify(av));
  const sv = await prep("drawing.svg", file("drawing.svg")); assert.ok(sv.ok && sv.w === 300 && sv.h === 150 && sv.mime === "image/jpeg", JSON.stringify(sv));
});
await check("TIFF and HEIC are converted by the app's ffmpeg (" + (ffmpeg || "none found") + ")", async () => {
  assert.ok(ffmpeg, "set CU_FFMPEG to the app's ffmpeg (tools/fetch-ffmpeg.sh)");
  const t = await prep("scan.tiff", file("scan.tiff")); assert.ok(t.ok && t.changed && t.w === 500 && t.h === 300 && near(t.px, [250, 200, 40]), JSON.stringify(t));
  const h = await prep("iphone.heic", file("iphone.heic")); assert.ok(h.ok && h.changed && h.w === 600 && h.h === 400 && near(h.px, [250, 200, 40], 60) && /\.jpg$/.test(h.name), "HEIC " + JSON.stringify(h));
});
await check("plain words when it can't: not a picture, an AVI, and TIFF / HEIC where there's no ffmpeg", async () => {
  const n = await prep("not-a-picture.jpg", file("not-a-picture.jpg")); assert.equal(n.error, "That file isn't a picture we can read. Try a JPEG or PNG.");
  const v = await prep("old film.avi", Buffer.from("RIFF0000AVI LIST").toString("base64")); assert.equal(v.error, "That video isn't one we can play. Try MP4 (H.264), MOV or WebM.");
  const t = await prep("scan.tiff", file("scan.tiff"), false); assert.match(t.error, /can't open TIFF pictures here/);
  const h = await prep("iphone.heic", file("iphone.heic"), false); assert.match(h.error, /can't open HEIC pictures here/);
  const mp4 = await prep("clip.mp4", Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 2, 0, 0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34, 0x31]).toString("base64")); assert.ok(mp4.ok && mp4.video, JSON.stringify(mp4));
});
await check("a picture bigger than 3840 px is made 3840 on its longest side", async () => {
  const r = await page.evaluate(async () => {
    const c = new OffscreenCanvas(5000, 2500), g = c.getContext("2d"); g.fillStyle = "#2050c0"; g.fillRect(0, 0, 5000, 2500); g.fillStyle = "#fc2"; g.fillRect(0, 0, 1250, 625);
    const blob = await c.convertToBlob({ type: "image/jpeg", quality: 0.8 }), x = await CUPictures.prepare({ name: "huge.jpg", blob }); return { ok: x.ok, w: x.width, h: x.height, changed: x.changed };
  });
  assert.deepEqual(r, { ok: true, w: 3840, h: 1920, changed: true });
});

console.log("\nIn the Slides tab:");
await page.evaluate(() => { const t = document.querySelector('[data-tab="slides"]'); t.hidden = false; t.click(); });
await page.waitForSelector("#slHead");
const slideNames = () => page.evaluate(() => { const st = CUSlides.state(), d = st.decks.find((x) => x.id === st.activeDeck); return d ? d.slides.map((s) => s.name) : []; });
await check("ten pictures picked at once become ten slides, in name order (2 before 10), one picture filling each", async () => {
  const order = [3, 1, 10, 7, 2, 9, 4, 8, 6, 5];
  const r = await page.evaluate(async (order) => {
    const items = []; for (const i of order) { const c = new OffscreenCanvas(192, 108), g = c.getContext("2d"); g.fillStyle = "rgb(" + i * 20 + ",80,120)"; g.fillRect(0, 0, 192, 108); items.push({ name: "slide " + i + ".jpg", bytes: new Uint8Array(await (await c.convertToBlob({ type: "image/jpeg" })).arrayBuffer()) }); }
    const ms = await CUSlides.importPictures(items); return ms.map((m) => m.name);
  }, order);
  assert.deepEqual(r, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => "slide " + i));
  const names = await slideNames(); assert.deepEqual(names.slice(-10), r);
  const els = await page.evaluate(() => { const st = CUSlides.state(), d = st.decks.find((x) => x.id === st.activeDeck), s = d.slides[d.slides.length - 1]; return s.els.map((e) => [e.type, e.w, e.h, /^media:/.test(e.media)]); });
  assert.deepEqual(els, [["image", 1920, 1080, true]]);
});
await check("a file that isn't a picture is said plainly, and the good ones still come in", async () => {
  const before = (await slideNames()).length;
  await page.evaluate(async ([a, b]) => { await CUSlides.importPictures([{ name: "not-a-picture.jpg", bytes: Uint8Array.from(atob(a), (c) => c.charCodeAt(0)) }, { name: "phone-rotated.jpg", bytes: Uint8Array.from(atob(b), (c) => c.charCodeAt(0)) }]); }, [file("not-a-picture.jpg"), file("phone-rotated.jpg")]);
  assert.equal((await slideNames()).length, before + 1);
  const msg = await page.evaluate(() => Array.from(document.querySelectorAll(".sl-toast, .role-toast, [role=status]")).map((e) => e.textContent).join(" | "));
  assert.match(msg, /not-a-picture\.jpg: That file isn't a picture we can read\. Try a JPEG or PNG\./);
});
await check("drop pictures onto the slides list: a slide each; paste one from the clipboard: another slide", async () => {
  const before = (await slideNames()).length;
  await page.evaluate(async ([png, webp]) => {
    const dt = new DataTransfer(); dt.items.add(new File([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], "dropped logo.png", { type: "image/png" })); dt.items.add(new File([Uint8Array.from(atob(webp), (c) => c.charCodeAt(0))], "dropped photo.webp", { type: "image/webp" }));
    const zone = document.querySelector(".sl-thumbs") || document.querySelector("#slidesRoot"); zone.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, [file("logo.png"), file("photo.webp")]);
  await page.waitForFunction((n) => { const st = CUSlides.state(), d = st.decks.find((x) => x.id === st.activeDeck); return d && d.slides.length >= n; }, before + 2, { timeout: 5000 });
  const n2 = (await slideNames()).length; assert.equal(n2, before + 2);
  await page.evaluate(async (png) => { document.activeElement && document.activeElement.blur && document.activeElement.blur(); const dt = new DataTransfer(); dt.items.add(new File([Uint8Array.from(atob(png), (c) => c.charCodeAt(0))], "image.png", { type: "image/png" })); document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })); }, file("logo.png"));
  await page.waitForFunction((n) => { const st = CUSlides.state(), d = st.decks.find((x) => x.id === st.activeDeck); return d && d.slides.length >= n; }, n2 + 1, { timeout: 5000 });
});
await check("a prepared picture is saved once, by its contents (lyric backgrounds and the Central Pedal use it by its path)", () => {
  const dir = fs.mkdtempSync(path.join((require("node:os")).tmpdir(), "cu-pics-")), a = native.save(dir, Buffer.from("abc"), "x.jpg"), b2 = native.save(dir, Buffer.from("abc"), "x.jpg"), c = native.save(dir, Buffer.from("abd"), "../../evil:name.jpg");
  assert.equal(a, b2); assert.notEqual(a, c); assert.equal(path.dirname(c), dir, "stays in its folder"); assert.equal(fs.readdirSync(dir).length, 2);
});
await check("no errors on the page", () => assert.deepEqual(errs, []));
await b.close();
console.log(failures ? "\n" + failures + " FAILED" : "\nall passed"); process.exit(failures ? 1 : 0);
