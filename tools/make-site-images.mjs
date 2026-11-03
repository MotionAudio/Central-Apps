// The website's pictures that come from the apps themselves (10.3), drawn with Playwright:
//   * Central Utility's backgrounds and slide themes (server/public/img/utility/), drawn by the same code the apps use
//     (central-usage/app/backgrounds.js and backgrounds-seasons.js), so the website shows what you really get;
//   * Central Production's screenshot (server/public/img/apps/production.webp), from the real /production/ page;
//   * a picture to share for every page (server/public/img/og/<page>.jpg, 1200 x 630), from tools/make-site.py's list.
//   node tools/make-site-images.mjs [http://127.0.0.1:PORT]     (the address of a running website, for Production)
// Then run python3 tools/make-site.py again (it reads img/utility/utility.json).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const pub = path.join(repo, "server", "public");
let pw; try { pw = createRequire(import.meta.url)("playwright"); } catch (_) { pw = createRequire(execSync("npm root -g").toString().trim() + "/")("playwright"); }
const browser = await pw.chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const base = process.argv[2] || "";
const webp = async (page, pngBuf, w, h, q = 0.82) => Buffer.from((await page.evaluate(async ([b64, w, h, q]) => {
  const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
  const c = document.createElement("canvas"); c.width = w; c.height = h; c.getContext("2d").drawImage(img, 0, 0, w, h); return c.toDataURL("image/webp", q);
}, [pngBuf.toString("base64"), w, h, q])).split(",")[1], "base64");

// ---------------------------------------------------------------- Central Utility
{
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.setContent("<!doctype html><html><head><style>@font-face{font-family:Archivo;src:url(data:font/woff2;base64," + fs.readFileSync(path.join(pub, "fonts", "archivo-latin.woff2")).toString("base64") + ")}</style></head><body></body></html>");
  await page.addScriptTag({ path: path.join(repo, "central-usage", "app", "backgrounds.js") });
  await page.addScriptTag({ path: path.join(repo, "central-usage", "app", "backgrounds-seasons.js") });
  await page.evaluate(() => document.fonts.load("800 32px Archivo"));
  const out = path.join(pub, "img", "utility"); fs.mkdirSync(out, { recursive: true });
  const got = await page.evaluate(() => {
    const B = window.CUBackgrounds, S = window.CUSeasons, T = window.CUSeasonThemes, W = 640, H = 360;
    const shot = (draw) => { const c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d"); draw(g); return c.toDataURL("image/webp", 0.82); };
    // a background from each season of the church year, in its order
    const bgs = [], seen = new Set();
    for (const o of S.ORDER) { const season = Array.isArray(o) ? o[0] : o, b = S.list(season)[0]; if (b && !seen.has(b.id)) { seen.add(b.id); bgs.push(b); } }
    for (const b of S.list()) { if (bgs.length >= 12) break; if (!seen.has(b.id)) { seen.add(b.id); bgs.push(b); } }
    const backgrounds = bgs.slice(0, 12).map((b) => ({ id: b.id, name: b.name, season: S.NAMES[b.season] || "", data: shot((g) => B.draw(b.id, g, W, H, 12)) }));
    // slide themes: the background, dimmed, with a title, a verse and its reference, and the lower third
    const words = { "u-advent": ["O Come, O Come, Emmanuel", "Rejoice! Rejoice!", "Advent"], "u-christmas-red": ["Joy to the World", "The Lord is come", "Psalm 98"], "u-easter": ["He Is Risen", "He is not here; he has risen, just as he said.", "Matthew 28:6"],
      "u-pentecost": ["Come, Holy Spirit", "They were all filled with the Holy Spirit.", "Acts 2:4"], "u-lent": ["Create in Me a Clean Heart", "Renew a right spirit within me.", "Psalm 51:10"], "u-communion": ["The Lord's Supper", "Do this in remembrance of me.", "Luke 22:19"],
      "u-baptism": ["Baptism Sunday", "Buried with him in baptism, raised to walk in newness of life.", "Romans 6:4"], "u-every-glass": ["Holy, Holy, Holy", "Lord God Almighty", "Revelation 4:8"], "u-thanks": ["Give Thanks", "Give thanks to the Lord, for he is good.", "Psalm 107:1"], "u-every-dawn": ["Great Is Thy Faithfulness", "Morning by morning new mercies I see", "Lamentations 3:23"] };
    const pickT = T.filter((t) => words[t.id]).slice(0, 8);
    const themes = pickT.map((t) => ({ id: t.id, name: t.name, data: shot((g) => {
      B.draw(t.bg.bgId, g, W, H, 12); g.fillStyle = "rgba(0,0,0," + (t.bg.dim || 0.25) + ")"; g.fillRect(0, 0, W, H);
      const k = W / 1920, [title, body, ref] = words[t.id];
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillStyle = t.title.color; g.font = "800 " + Math.round(t.title.size * k * 1.15) + "px Archivo, sans-serif"; g.fillText(title, W / 2, H * 0.36, W * 0.9);
      g.fillStyle = t.body.color; g.font = "600 " + Math.round(t.body.size * k * 1.05) + "px Archivo, sans-serif"; g.fillText(body, W / 2, H * 0.52, W * 0.9);
      g.fillStyle = t.ref.color; g.font = "600 " + Math.round(t.ref.size * k * 1.1) + "px Archivo, sans-serif"; g.fillText(ref, W / 2, H * 0.62, W * 0.9);
      // the lower third, as it sits over the stream
      g.fillStyle = t.lower.box; g.globalAlpha = 0.92; g.fillRect(W * 0.05, H * 0.8, W * 0.46, H * 0.11); g.globalAlpha = 1;
      g.fillStyle = t.lower.accent; g.fillRect(W * 0.05, H * 0.8, 4, H * 0.11);
      g.fillStyle = t.lower.text; g.textAlign = "left"; g.font = "700 15px Archivo, sans-serif"; g.fillText("Pastor Grace Lee", W * 0.05 + 14, H * 0.835); g.font = "500 11px Archivo, sans-serif"; g.fillText("Sunday service", W * 0.05 + 14, H * 0.875);
    }) }));
    return { backgrounds, themes };
  });
  const list = { backgrounds: [], themes: [] };
  for (const k of ["backgrounds", "themes"]) for (const x of got[k]) {
    const file = (k === "backgrounds" ? "bg-" : "theme-") + x.id + ".webp";
    fs.writeFileSync(path.join(out, file), Buffer.from(x.data.split(",")[1], "base64"));
    list[k].push({ id: x.id, name: x.name + (x.season && x.season !== x.name ? " · " + x.season : ""), file, alt: (k === "backgrounds" ? "Central Utility background: " : "Central Utility slide theme: ") + x.name });
  }
  fs.writeFileSync(path.join(out, "utility.json"), JSON.stringify(list, null, 1) + "\n");
  console.log("utility:", list.backgrounds.length, "backgrounds,", list.themes.length, "themes");
  await page.close();
}

// ---------------------------------------------------------------- Central Production's screenshot
if (base) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(base + "/production/", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  // a closed welcome or start dialog shows the studio itself
  // a new Track project: the arrange view, the mixer and the browser, as people see it while they work
  const track = await page.$('[data-new="track"]');
  if (track) { await track.click().catch(() => {}); await page.waitForTimeout(1500); }
  // (it may ask a question or two first: take the first answer each time)
  for (let i = 0; i < 4; i++) { const go = await page.$(".cp-modal button.primary, .modal button.primary, .cp-modal [data-go], #npGo"); if (!go || !(await go.isVisible())) break; await go.click().catch(() => {}); await page.waitForTimeout(900); }
  for (const sel of ["[data-close]", "button:has-text('Skip')", "button:has-text('Not now')"]) { const b = await page.$(sel); if (b && (await b.isVisible())) await b.click().catch(() => {}); }
  await page.waitForTimeout(800);
  const png = await page.screenshot({ type: "png" });
  fs.writeFileSync(path.join(pub, "img", "apps", "production.webp"), await webp(page, png, 1440, 900));
  console.log("production.webp");
  await page.close();
}

// ---------------------------------------------------------------- a picture to share for every page
{
  const pages = JSON.parse(fs.readFileSync(path.join(pub, "img", "og", "pages.json"), "utf8"));
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  const font = fs.readFileSync(path.join(pub, "fonts", "archivo-latin.woff2")).toString("base64");
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  for (const p of pages) {
    const shot = path.join(pub, "img", "apps", (p.shot || "cc-lights") + ".webp"), img = fs.existsSync(shot) ? "data:image/webp;base64," + fs.readFileSync(shot).toString("base64") : "";
    await page.setContent(`<!doctype html><html><head><style>@font-face{font-family:Archivo;src:url(data:font/woff2;base64,${font})}
      body{margin:0;width:1200px;height:630px;overflow:hidden;background:radial-gradient(90% 120% at 80% 0%,#232933 0%,#15181D 62%);color:#ECE7DD;font-family:Archivo,sans-serif;position:relative}
      .t{position:absolute;left:64px;top:64px;width:560px}.b{display:flex;align-items:center;gap:12px;color:#E2C27E;font-weight:650;font-size:26px}
      h1{font-size:${p.title.length > 40 ? 52 : 62}px;line-height:1.04;font-weight:650;font-stretch:116%;letter-spacing:-.02em;margin:34px 0 0}p{font-size:23px;line-height:1.35;color:#A2A9B3;margin:22px 0 0}
      img{position:absolute;left:660px;top:92px;width:760px;border-radius:14px;border:1px solid #343A44;box-shadow:0 30px 70px -20px #000}</style></head>
      <body><div class="t"><div class="b"><svg width="40" height="40" viewBox="0 0 100 100"><g fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round"><path d="M6,80 C24,80 22.2,20 36,20 C49.8,20 48,80 66,80"/><path d="M34,80 C52,80 50.2,20 64,20 C77.8,20 76,80 94,80"/></g></svg>Motion Audio</div>
      <h1>${esc(p.title)}</h1><p>${esc(p.kicker.length > 120 ? p.kicker.slice(0, 117).replace(/\s+\S*$/, "") + "…" : p.kicker)}</p></div>${img ? `<img src="${img}">` : ""}</body></html>`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(80);
    fs.writeFileSync(path.join(pub, "img", "og", p.id + ".jpg"), await page.screenshot({ type: "jpeg", quality: 80 }));
  }
  console.log("og:", pages.length, "pictures");
}
await browser.close();
