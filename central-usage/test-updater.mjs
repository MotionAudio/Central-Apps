// The updater picks the right file of a release for every system (no network): Linux AppImage / .deb,
// Windows installer, macOS disk image for Apple Silicon / Intel, for both apps.
//   node test-updater.mjs
import assert from "node:assert";
import os from "node:os";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Updater } = require("./updater.js");
const names = ["central-control-source.zip", "SHA256SUMS",
  "central-usage-2.1.0-amd64.deb", "central-usage-2.1.0-x86_64.AppImage", "central-usage-2.1.0-arm64.deb", "central-usage-2.1.0-win-x64.exe", "central-usage-2.1.0-mac-arm64.dmg", "central-usage-2.1.0-mac-x64.dmg",
  "central-control-8.1.0-amd64.deb", "central-control-8.1.0-x86_64.AppImage", "central-control-8.1.0-win-x64.exe", "central-control-8.1.0-mac-arm64.dmg", "central-control-8.1.0-mac-x64.dmg"];
const assets = {}; names.forEach((n) => { assets[n] = "https://example/" + n; });
const real = { platform: process.platform, arch: process.arch, appimage: process.env.APPIMAGE };
function as(platform, arch, appimage) { Object.defineProperty(process, "platform", { value: platform }); Object.defineProperty(process, "arch", { value: arch }); if (appimage) process.env.APPIMAGE = "/x.AppImage"; else delete process.env.APPIMAGE; }
let failures = 0;
function pick(product, platform, arch, appimage, want) {
  as(platform, arch, appimage);
  const u = new Updater({ product, current: "1.0.0", dir: os.tmpdir() }); u.latest = { version: "9", assets };
  const a = u.asset();
  try { assert.equal(a && a.name, want); console.log("  ✓ " + product + " on " + platform + "/" + arch + (appimage ? " (AppImage)" : "") + " -> " + want); }
  catch (e) { failures++; console.error("  ✗ " + product + " " + platform + "/" + arch + ": " + (a && a.name) + " (wanted " + want + ")"); }
}
for (const [p, v] of [["central-usage", "2.1.0"], ["central-control", "8.1.0"]]) {
  pick(p, "linux", "x64", false, p + "-" + v + "-amd64.deb");
  pick(p, "linux", "x64", true, p + "-" + v + "-x86_64.AppImage");
  pick(p, "win32", "x64", false, p + "-" + v + "-win-x64.exe");
  pick(p, "darwin", "arm64", false, p + "-" + v + "-mac-arm64.dmg");
  pick(p, "darwin", "x64", false, p + "-" + v + "-mac-x64.dmg");
}
pick("central-usage", "linux", "arm64", false, "central-usage-2.1.0-arm64.deb");
as(real.platform, real.arch, real.appimage);

// update coverage: an admin or user key gets updates through its version (limit, in tenths); past that the app keeps
// working and says a renewal would get the newer one. No limit (Pedal Control, Central Services): the newest.
const http = require("node:http");
const rel = (v) => ({ tag_name: "v" + v, body: "notes " + v, assets: [{ name: "central-usage-" + v + "-amd64.deb", browser_download_url: "https://example/" + v }, { name: "SHA256SUMS", browser_download_url: "https://example/sums" }] });
const gh = http.createServer((req, res) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(req.url.includes("/releases?") ? [rel("9.6.0"), rel("9.4.1"), rel("9.4.0"), rel("9.3.0")] : rel("9.6.0"))); });
await new Promise((r) => gh.listen(0, "127.0.0.1", r));
as("linux", "x64", false);
async function cover(limit, current, wantLatest, wantBeyond, label) {
  const u = new Updater({ product: "central-usage", current, dir: os.tmpdir(), api: "http://127.0.0.1:" + gh.address().port });
  u.cfg.repo = "x/y"; u.cfg.limit = limit;
  const st = await u.check();
  try { assert.equal(st.latest, wantLatest); assert.equal(st.beyond, wantBeyond); console.log("  ✓ " + label); }
  catch (e) { failures++; console.error("  ✗ " + label + ": latest " + st.latest + ", beyond " + st.beyond + (st.error ? " (" + st.error + ")" : "")); }
}
await cover(94, "9.3.0", "9.4.1", "9.6.0", "covered through 9.4: it installs 9.4.1 (the fix too), and says 9.6.0 needs a renewal");
await cover(null, "9.3.0", "9.6.0", null, "no limit (Pedal Control, Central Services): the newest, 9.6.0");
await cover(110, "9.3.0", "9.6.0", null, "renewed through 11.0: 9.6.0");
await cover(94, "9.4.1", "9.4.1", "9.6.0", "already on 9.4.1, covered through 9.4: nothing to install, 9.6.0 needs a renewal");
gh.close(); as(real.platform, real.arch, real.appimage);
console.log(failures ? "\n" + failures + " UPDATER CHECK(S) FAILED" : "\nALL UPDATER CHECKS PASSED"); process.exit(failures ? 1 : 0);
