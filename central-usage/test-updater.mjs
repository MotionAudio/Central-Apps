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
// Central Control since 9.2.1: its files are CentralControl-*, and releases also carry central-usage-* copies for older installs
{
  const both = Object.assign({}, assets); ["CentralControl-2.1.0-amd64.deb", "CentralControl-2.1.0-win-x64.exe", "CentralControl-2.1.0-mac-arm64.dmg"].forEach((n) => { both[n] = "https://example/" + n; });
  const tryPick = (asset, platform, arch, want, label) => { as(platform, arch, false); const u = new Updater({ product: ["CentralControl", "central-usage"], current: "1.0.0", dir: os.tmpdir() }); u.latest = { version: "9", assets: asset }; const a = u.asset();
    try { assert.equal(a && a.name, want); console.log("  ✓ Central Control (" + label + ") on " + platform + " -> " + want); } catch (e) { failures++; console.error("  ✗ Central Control (" + label + "): " + (a && a.name) + " (wanted " + want + ")"); } };
  tryPick(both, "linux", "x64", "CentralControl-2.1.0-amd64.deb", "new name first");
  tryPick(both, "win32", "x64", "CentralControl-2.1.0-win-x64.exe", "new name first");
  tryPick(both, "darwin", "arm64", "CentralControl-2.1.0-mac-arm64.dmg", "new name first");
  tryPick(assets, "darwin", "x64", "central-usage-2.1.0-mac-x64.dmg", "an older release: the old name");
}
as(real.platform, real.arch, real.appimage);

// update coverage: an admin or user key gets updates through its version (limit, in tenths); past that the app keeps
// working and says a renewal would get the newer one. No limit (Pedal Control, Central Services): the newest.
const http = require("node:http");
const rel = (v) => ({ tag_name: "v" + v, body: "notes " + v, assets: [{ name: "central-usage-" + v + "-amd64.deb", browser_download_url: "https://example/" + v }, { name: "SHA256SUMS", browser_download_url: "https://example/sums" }] });
const gh = http.createServer((req, res) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(req.url.includes("/releases?") ? [rel("9.6.0"), rel("9.4.1"), rel("9.4.0"), rel("9.3.0")] : rel("9.6.0"))); });
await new Promise((r) => gh.listen(0, "127.0.0.1", r));
as("linux", "x64", false);
async function cover(limit, current, wantLatest, wantBeyond, label) {
  const u = new Updater({ product: "central-usage", current, dir: require("node:fs").mkdtempSync(require("node:path").join(os.tmpdir(), "cu-upd-")), api: "http://127.0.0.1:" + gh.address().port });
  u.cfg.repo = "x/y"; u.cfg.limit = limit;
  const st = await u.check();
  try { assert.equal(st.latest, wantLatest); assert.equal(st.beyond, wantBeyond); console.log("  ✓ " + label); }
  catch (e) { failures++; console.error("  ✗ " + label + ": latest " + st.latest + ", beyond " + st.beyond + (st.error ? " (" + st.error + ")" : "")); }
}
await cover(94, "9.3.0", "9.4.1", "9.6.0", "covered through 9.4: it installs 9.4.1 (the fix too), and says 9.6.0 needs a renewal");
await cover(null, "9.3.0", "9.6.0", null, "no limit (Pedal Control, Central Services): the newest, 9.6.0");
await cover(110, "9.3.0", "9.6.0", null, "renewed through 11.0: 9.6.0");
await cover(94, "9.4.1", "9.4.1", "9.6.0", "already on 9.4.1, covered through 9.4: nothing to install, 9.6.0 needs a renewal");
{ // "Release to all devices": an emergency release installs even past the key's updates
  const u = new Updater({ product: "central-usage", current: "9.3.0", dir: require("node:fs").mkdtempSync(require("node:path").join(os.tmpdir(), "cu-upd-")), api: "http://127.0.0.1:" + gh.address().port });
  u.cfg.repo = "x/y"; u.save({ limit: 94, everyone: ["9.6.0"] }); const st = await u.check();
  try { assert.equal(st.latest, "9.6.0"); assert.equal(st.beyond, null); console.log("  ✓ covered through 9.4, but 9.6.0 was released to all devices: it installs 9.6.0"); }
  catch (e) { failures++; console.error("  ✗ everyone: latest " + st.latest + ", beyond " + st.beyond); }
}
// Linux .deb (10.0.1): the install runs one script under the password prompt; it says why when it fails. Here a stand-in
// "pkexec" runs the script with stand-in apt-get / dpkg / dpkg-deb / dpkg-query on PATH.
{
  const fs = require("node:fs"), path = require("node:path"), cp = require("node:child_process");
  const ok = (cond, label, detail) => { if (cond) console.log("  ✓ " + label); else { failures++; console.error("  ✗ " + label + (detail ? ": " + detail : "")); } };
  ok(/another software update was still running/.test(Updater.debReason("E: Could not get lock /var/lib/dpkg/lock-frontend. It is held by process 1234 (unattended-upgr)")), "a held dpkg lock says another software update is running");
  ok(/missing something it needs: .*libasound2/.test(Updater.debReason(" central-services : Depends: libasound2 but it is not installable\nE: Unable to correct problems, you have held broken packages.")), "a missing library is named");
  ok(/already has one of its files/.test(Updater.debReason("dpkg: error processing archive x.deb (--unpack):\n trying to overwrite '/usr/bin/x', which is also in package y")), "a file another package owns is explained");
  ok(/software sources is broken/.test(Updater.debReason("W: GPG error: https://ppa.example noble InRelease: NO_PUBKEY ABC\nE: The repository 'https://ppa.example noble InRelease' is not signed.")), "a broken software source is explained");
  ok(Updater.debReason("") === "", "nothing to go on: no made-up reason");
  ok(/DEBIAN_FRONTEND=noninteractive/.test(Updater.DEB_SCRIPT) && /DPkg::Lock::Timeout=300/.test(Updater.DEB_SCRIPT) && /--force-confold/.test(Updater.DEB_SCRIPT) && /--no-install-recommends/.test(Updater.DEB_SCRIPT) && /dpkg -i/.test(Updater.DEB_SCRIPT), "the script asks nothing, waits for the lock, keeps config files, and falls back to dpkg");
  if (process.platform === "linux") {
    const T = fs.mkdtempSync(path.join(os.tmpdir(), "deb-")), bin = path.join(T, "bin"); fs.mkdirSync(bin);
    const w = (n, body) => { fs.writeFileSync(path.join(bin, n), "#!/bin/sh\n" + body + "\n"); fs.chmodSync(path.join(bin, n), 0o755); };
    // state file: what's installed; APT_MODE picks how apt-get behaves
    w("dpkg-deb", 'case "$3" in Package) echo central-services;; Version) echo 10.0.1;; esac');
    w("dpkg-query", 'v="$(cat ' + T + '/installed 2>/dev/null)"; case "$2" in *Version*) printf %s "$v";; *Status*) [ -n "$v" ] && printf "install ok installed";; esac');
    w("dpkg", 'case "$1" in --configure) exit 0;; -i) [ "$APT_MODE" = dpkgworks ] && echo 10.0.1 > ' + T + '/installed; exit 1;; esac');
    w("apt-get", 'if [ "$1" = install ] && [ "$2" = -f ]; then exit 0; fi\ncase "$APT_MODE" in ok) echo "Setting up central-services (10.0.1) ..."; echo 10.0.1 > ' + T + '/installed; exit 0;; lock) echo "Waiting for cache lock: Could not get lock /var/lib/dpkg/lock-frontend. It is held by process 99 (unattended-upgr)" >&2; echo "E: Could not get lock /var/lib/dpkg/lock-frontend. It is held by process 99 (unattended-upgr)" >&2; exit 100;; *) echo "E: Sub-process /usr/bin/dpkg returned an error code (1)" >&2; exit 100;; esac');
    w("fake-pkexec", 'exec "$@"');
    w("xdg-open", 'echo opened > ' + T + '/opened');
    const deb = path.join(T, "x.deb"); fs.writeFileSync(deb, "x");
    const env0 = process.env.PATH; process.env.PATH = bin + ":" + env0;
    const run = async (mode) => { fs.rmSync(path.join(T, "installed"), { force: true }); fs.rmSync(path.join(T, "opened"), { force: true }); process.env.APT_MODE = mode; const u = new Updater({ product: "central-services", current: "10.0.0", dir: T }); const phases = []; try { await u.installDeb(path.join(bin, "fake-pkexec"), deb, () => phases.push(u.phase)); return { ok: true, phases }; } catch (e) { for (let i = 0; i < 30 && !fs.existsSync(path.join(T, "opened")); i++) await new Promise((z) => setTimeout(z, 100)); return { ok: false, msg: e.message, phases, opened: fs.existsSync(path.join(T, "opened")) }; } };
    let r = await run("ok"); ok(r.ok, "apt-get installs it: done", JSON.stringify(r));
    r = await run("dpkgworks"); ok(r.ok, "apt-get fails, dpkg -i + apt-get -f installs it: done", JSON.stringify(r));
    r = await run("lock"); ok(!r.ok && /another software update was still running/.test(r.msg) && r.phases.includes("waiting") && r.opened && /software installer/.test(r.msg), "the lock never frees: it waited, says why, and opens the software installer", JSON.stringify(r));
    r = await run("broken"); ok(!r.ok && /returned an error code/.test(r.msg), "anything else: apt-get's own words", JSON.stringify(r));
    process.env.PATH = env0; delete process.env.APT_MODE;
  }
}
gh.close(); as(real.platform, real.arch, real.appimage);
console.log(failures ? "\n" + failures + " UPDATER CHECK(S) FAILED" : "\nALL UPDATER CHECKS PASSED"); process.exit(failures ? 1 : 0);
