// The Central Pedal app served for a test from a local web address that isn't the pedal's own (127.0.0.2): to the app
// that's Central Pedal Control, just as when it's opened from a file. Tests that save and reload use this: opened from
// file://, headless Chromium now and then never passes the page's saved project on to the browser's storage, and a
// reload comes back to an older project (or none).
//   const site = await serveApp(dir); await page.goto(site.url("index.html")); ... site.close();
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".wasm": "application/wasm", ".wav": "audio/wav", ".mp3": "audio/mpeg", ".sf2": "application/octet-stream" };
export async function serveApp(root) {
  root = path.resolve(root);
  const site = http.createServer((req, res) => {
    const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (u === "/__blank.html") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end("<!doctype html><title>storage</title>"); }
    const f = path.join(root, path.normalize(u).replace(/^[/\\]+/, ""));
    if (!f.startsWith(root) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(f).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store" }); fs.createReadStream(f).pipe(res);
  });
  await new Promise((ok) => site.listen(0, "127.0.0.2", ok));
  const base = "http://127.0.0.2:" + site.address().port + "/";
  return { url: (rel) => base + String(rel || "").replace(/^\/+/, ""), close: () => site.close() };
}
