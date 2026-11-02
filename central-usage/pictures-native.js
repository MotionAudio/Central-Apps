// Central Control (10.2) - the pictures the page can't read itself (TIFF, HEIC / HEIF), turned into a PNG by the ffmpeg
// that comes with the app (9.x reads HEIC, an iPhone's tiled ones too), at most 3840 px on the longest side; and saving a
// prepared picture where the lyric backgrounds and the Central Pedal can use it by its path.
//   convert(ffmpeg, bytes, kind) -> Promise<{ bytes, mime } | { error }>
//   save(dir, bytes, name)       -> the path it was saved to (named by its contents, so the same picture is kept once)
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const NOT_READ = "That file isn't a picture we can read. Try a JPEG or PNG.";
function run(bin, args, ms) {
  return new Promise((resolve) => {
    let err = "", done = false; const p = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    const t = setTimeout(() => { if (!done) { try { p.kill("SIGKILL"); } catch (_) { } } }, ms || 60000);
    p.stderr.on("data", (d) => { err += d; if (err.length > 8000) err = err.slice(-8000); });
    p.on("error", (e) => { done = true; clearTimeout(t); resolve({ code: -1, err: String(e && e.message || e) }); });
    p.on("close", (code) => { done = true; clearTimeout(t); resolve({ code, err }); });
  });
}
async function convert(ffmpeg, bytes, kind) {
  if (!ffmpeg) return { error: kind === "heic" ? "Central Control needs its ffmpeg to open HEIC pictures, and it isn't here. Reinstall Central Control, or save the picture as a JPEG first." : "Central Control needs its ffmpeg to open TIFF pictures, and it isn't here. Reinstall Central Control, or save the picture as a JPEG or PNG first." };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cu-pic-")), inp = path.join(dir, "in." + (kind === "heic" ? "heic" : "tif")), out = path.join(dir, "out.png");
  try {
    fs.writeFileSync(inp, Buffer.from(bytes));
    const scale = ["-vf", "scale=w='min(3840,iw)':h='min(3840,ih)':force_original_aspect_ratio=decrease"];
    // an iPhone HEIC is a grid of tiles (a stream group: 0:g:0); a plain one is a single picture
    const tries = kind === "heic" ? [["-map", "0:g:0"], ["-map", "0:v:0"]] : [["-map", "0:v:0"]];
    for (const m of tries) {
      try { fs.rmSync(out, { force: true }); } catch (_) { }
      const r = await run(ffmpeg, ["-hide_banner", "-v", "error", "-y", "-i", inp, ...m, "-frames:v", "1", ...scale, "-c:v", "png", "-pix_fmt", "rgba", "-update", "1", out]);
      if (r.code === 0 && fs.existsSync(out) && fs.statSync(out).size > 0) return { bytes: fs.readFileSync(out), mime: "image/png" };
    }
    return { error: NOT_READ };
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { } }
}
function save(dir, bytes, name) {
  fs.mkdirSync(dir, { recursive: true });
  const buf = Buffer.from(bytes), h = crypto.createHash("sha256").update(buf).digest("hex").slice(0, 12);
  const clean = String(name || "picture").replace(/[\\/:*?"<>|\x00-\x1f]+/g, "_").slice(-80) || "picture", file = path.join(dir, h + "-" + clean);
  if (!fs.existsSync(file)) fs.writeFileSync(file, buf);
  return file;
}
module.exports = { convert, save, NOT_READ };
