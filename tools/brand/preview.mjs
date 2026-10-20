import { icon, APPS, GLYPHS } from "./glyphs.mjs";
import { chromium } from "./pw.mjs";
const out = process.argv[2];
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1500, height: 700 } });
const cells = ["mark", ...APPS.map((a) => a.glyph)].map((g) => `<div>${icon(g, 220, "mac", g+"a")}<br>${icon(g, 64, "mac", g+"b")}${icon(g, 32, "mac", g+"c")}${icon(g, 16, "mac", g+"d")}</div>`).join("");
const light = ["mark", ...APPS.map((a) => a.glyph)].map((g) => `<div>${icon(g, 120, "round", g+"e")}${icon(g, 120, "square", g+"f")}</div>`).join("");
await p.setContent(`<body style="margin:0;background:#e9ebee;font:14px sans-serif"><div style="display:flex;gap:10px;padding:20px">${cells}</div><div style="display:flex;gap:10px;padding:20px;background:#fff">${light}</div></body>`);
await p.screenshot({ path: out }); await b.close();
