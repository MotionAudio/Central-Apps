// electron-builder afterPack: on macOS the app is not signed with an Apple certificate (no Developer ID), but
// Apple Silicon only runs signed code - so the whole app is signed "ad hoc" (a local signature, no identity).
// People open it the first time with System Settings -> Privacy & Security -> Open Anyway.
"use strict";
const { execFileSync } = require("node:child_process");
const path = require("node:path");
exports.default = async function afterPack(ctx) {
  if (ctx.electronPlatformName !== "darwin") return;
  const app = path.join(ctx.appOutDir, ctx.packager.appInfo.productFilename + ".app");
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
  execFileSync("codesign", ["--verify", "--deep", "--verbose=1", app], { stdio: "inherit" });
};
