// Renders every icon and splash screen of the five apps, and the Motion Audio mark, from glyphs.mjs.
//   node tools/brand/make-brand.mjs        (needs Playwright: npm i -g playwright)
import fs from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { icon, GLYPHS, C } from "./glyphs.mjs";
import { chromium } from "./pw.mjs";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const font = (f) => "data:font/woff2;base64," + fs.readFileSync(path.join(ROOT, "fonts", f)).toString("base64");
const FONT = `@font-face{font-family:Archivo;font-weight:100 900;font-stretch:62% 125%;src:url(${font("archivo-latin.woff2")}) format("woff2")}`;

const browser = await chromium.launch(); const page = await browser.newPage();
async function shot(file, w, h, html, transparent) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<!doctype html><html><head><style>${FONT}html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden;background:${transparent ? "transparent" : C.bg}}svg{display:block}</style></head><body>${html}</body></html>`);
  await page.evaluate(() => document.fonts.ready);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file, omitBackground: !!transparent });
  console.log(path.relative(ROOT, file), w + "x" + h);
}
const P = (...a) => path.join(ROOT, ...a);
const splash = (glyph, name, w, h) => {
  const s = Math.round(Math.min(w, h) * 0.2), t = Math.max(16, Math.round(s * 0.2));
  const svg = icon(glyph, s, "plain", "s");
  return `<div style="position:absolute;inset:0;background:radial-gradient(120% 80% at 50% 40%, #232830 0%, ${C.bg} 60%);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${Math.round(s * 0.28)}px">${svg}<div style="font:600 ${t}px/1 Archivo;font-stretch:118%;letter-spacing:.01em;color:${C.ink}">${name}</div></div>`;
};

// ---- the brand sheet (docs/brand) and the website
const sheet = { "central-pedal": "pedal", "central-pedal-control": "pedalControl", "central-control": "control", "central-usage": "usage", "central-services": "services", "motion-audio": "mark" };
for (const [slug, g] of Object.entries(sheet)) {
  await shot(P("docs/brand", slug + ".png"), 1024, 1024, icon(g, 1024, "mac"), true);
  fs.writeFileSync(P("docs/brand", slug + ".svg"), icon(g, 1024, "mac"));
}
fs.writeFileSync(P("docs/brand/motion-audio-mark.svg"), icon("mark", 100, "plain").replace(/width="100" height="100"/, 'width="100" height="100"'));
for (const [slug, g] of Object.entries(sheet)) for (const dir of ["server/public/brand", "docs/brand/tile"]) { fs.mkdirSync(P(dir), { recursive: true }); fs.writeFileSync(P(dir, slug + ".svg"), icon(g, 96, "legacy", slug.replace(/-/g, "") + "_")); }
for (const [slug, g] of Object.entries(sheet)) for (const dir of ["server/public/brand", "docs/brand/tile"]) fs.writeFileSync(P(dir, "glyph-" + slug + ".svg"), icon(g, 100, "plain", slug.replace(/-/g, "") + "_g_"));
for (const dir of ["server/public", "docs"]) { fs.writeFileSync(P(dir, "favicon.svg"), icon("mark", 64, "square")); await shot(P(dir, "apple-touch-icon.png"), 180, 180, icon("mark", 180, "square")); }

// ---- desktop apps (electron-builder makes .ico / .icns from these)
await shot(P("central-pedal-control/build/icon.png"), 1024, 1024, icon("pedalControl", 1024, "mac"), true);
await shot(P("central-usage/build/icon.png"), 1024, 1024, icon("control", 1024, "mac"), true);
await shot(P("central-usage/build/icon-usage.png"), 1024, 1024, icon("usage", 1024, "mac"), true);
await shot(P("central-services/build/icon.png"), 1024, 1024, icon("services", 1024, "mac"), true);
await shot(P("central-services/src/icon.png"), 256, 256, icon("services", 256, "mac"), true);
await shot(P("server/public/services/icon.png"), 256, 256, icon("services", 256, "mac"), true);

// ---- phones and tablets
const mobile = { "central-pedal-control-mobile": ["pedalControl", "Central Pedal Control"], "central-usage-mobile": ["usage", "Central Usage"], "central-services-mobile": ["services", "Central Services"] };
const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
for (const [app, [g, name]] of Object.entries(mobile)) {
  const res = P(app, "android/app/src/main/res");
  for (const [d, k] of Object.entries(dens)) {
    await shot(path.join(res, "mipmap-" + d, "ic_launcher.png"), 48 * k, 48 * k, icon(g, 48 * k, "legacy"), true);
    await shot(path.join(res, "mipmap-" + d, "ic_launcher_round.png"), 48 * k, 48 * k, icon(g, 48 * k, "round"), true);
    await shot(path.join(res, "mipmap-" + d, "ic_launcher_foreground.png"), 108 * k, 108 * k, icon(g, 108 * k, "fg"), true);
  }
  fs.writeFileSync(path.join(res, "values/ic_launcher_background.xml"), `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${C.bg}</color>\n</resources>\n`);
  for (const dir of fs.readdirSync(res).filter((x) => /^drawable/.test(x))) {
    const f = path.join(res, dir, "splash.png"); if (!fs.existsSync(f)) continue;
    const [w, h] = sizeOf(f); await shot(f, w, h, splash(g, name, w, h));
  }
  const ios = P(app, "ios/App/App/Assets.xcassets");
  const ai = path.join(ios, "AppIcon.appiconset/AppIcon-512@2x.png");
  await shot(ai, 1024, 1024, icon(g, 1024, "square"));
  try { execSync(`convert "${ai}" -alpha off PNG24:"${ai}"`); } catch (_) { console.log("  (install ImageMagick: the App Store wants this icon without an alpha channel)"); }
  for (const f of ["splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"]) await shot(path.join(ios, "Splash.imageset", f), 2732, 2732, splash(g, name, 2732, 2732));
}
await browser.close();

function sizeOf(f) { const b = fs.readFileSync(f); return [b.readUInt32BE(16), b.readUInt32BE(20)]; }
