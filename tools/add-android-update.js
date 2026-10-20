#!/usr/bin/env node
/* Puts the Android update check (tools/android-update.js) into a phone app's www/ before Capacitor copies it:
 *   node tools/add-android-update.js <www dir> "<app name>" <its package.json> "<asset regex with the version as group 1>"
 * Writes www/app-update-config.js (window.APP_UPDATE: name, version, repo, asset) and adds both scripts to the top of
 * www/index.html (once). */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const [www, name, pkg, asset] = process.argv.slice(2);
if (!www || !name || !pkg || !asset) { console.error("usage: add-android-update.js <www> <name> <package.json> <asset regex>"); process.exit(2); }
const version = JSON.parse(fs.readFileSync(pkg, "utf8")).version;
const repo = process.env.CC_UPDATE_REPO || "MotionAudio/Central-Apps";
fs.writeFileSync(path.join(www, "app-update-config.js"), "window.APP_UPDATE = " + JSON.stringify({ name, version, repo, asset }) + ";\n");
fs.copyFileSync(path.join(__dirname, "android-update.js"), path.join(www, "android-update.js"));
const idx = path.join(www, "index.html");
let html = fs.readFileSync(idx, "utf8");
if (!html.includes("android-update.js")) {
  const tags = '\n  <script src="app-update-config.js"></script>\n  <script src="android-update.js"></script>';
  html = /<meta charset[^>]*>/i.test(html) ? html.replace(/(<meta charset[^>]*>)/i, "$1" + tags) : html.replace(/<head>/i, "<head>" + tags);
  fs.writeFileSync(idx, html);
}
console.log(name + " " + version + ": Android update check added (" + repo + ")");
