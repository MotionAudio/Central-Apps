// electron-builder afterPack: on macOS the app is not signed with an Apple certificate (no Developer ID), but
// Apple Silicon only runs signed code - so the app is signed "ad hoc" (a local signature, no identity).
// First the programs it carries in Resources (cu-mixer, cu-rig, cu-video, ffmpeg, the bundled driver and its
// libraries, the speech model's onnxruntime / sharp libraries), which --deep doesn't reach, then the app.
// People open it the first time with System Settings -> Privacy & Security -> Open Anyway.
"use strict";
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
function machO(file) {
  try { const fd = fs.openSync(file, "r"), b = Buffer.alloc(4); fs.readSync(fd, b, 0, 4, 0); fs.closeSync(fd); const m = b.readUInt32BE(0); return [0xfeedfacf, 0xcffaedfe, 0xfeedface, 0xcefaedfe, 0xcafebabe, 0xbebafeca].includes(m); } catch (_) { return false; }
}
function walk(dir, out) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isSymbolicLink()) continue; if (e.isDirectory()) { if (!/\.app$/.test(e.name)) walk(p, out); } else if (e.isFile() && machO(p)) out.push(p); } return out; }
exports.default = async function afterPack(ctx) {
  if (ctx.electronPlatformName !== "darwin") return;
  const app = path.join(ctx.appOutDir, ctx.packager.appInfo.productFilename + ".app");
  const inner = walk(path.join(app, "Contents", "Resources"), []);
  for (const f of inner) execFileSync("codesign", ["--force", "--sign", "-", f], { stdio: "inherit" });
  console.log("  • ad-hoc signed " + inner.length + " programs / libraries in Resources");
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
  execFileSync("codesign", ["--verify", "--deep", "--verbose=1", app], { stdio: "inherit" });
};
