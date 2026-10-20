/* Desktop updater, shared by Central Control and Central Pedal (PC). It looks at the Releases page of a
 * GitHub repository every time the app opens and once a day. When the app opens and finds a newer version it installs
 * it by itself (cfg.autoInstall, on by default - never while something plays; the app asks instead); otherwise it
 * installs when the person says so. Songs, setlists and settings live in the app's settings folder, which an update
 * never touches:
 *  - Linux, running as an AppImage: the new AppImage replaces this one and the app restarts;
 *  - Linux, installed from the .deb: the new .deb is installed with the system's password prompt (pkexec
 *    apt-get), or, without pkexec, opened in the software installer;
 *  - Windows: the new installer (central-usage-<v>-win-x64.exe) runs silently and starts the app again;
 *  - macOS: the new .dmg (arm64 or x64, for this Mac) is opened, its app replaces this one and the app
 *    restarts; if this app's folder can't be written, the .dmg is shown so it can be dragged to Applications.
 * Every download is checked against the release's SHA256SUMS before anything is replaced. */
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const https = require("node:https");
const http = require("node:http");
const crypto = require("node:crypto");
const { execFile, spawn } = require("node:child_process");

function tenthsOf(v) { const n = versionTuple(v); return n[0] * 10 + Math.min(9, n[1]); }   // 9.4.2 -> 94
function fmtTenths(t) { return Math.floor(t / 10) + "." + (t % 10); }
function versionTuple(v) { const n = String(v || "").match(/\d+/g) || []; return [0, 1, 2].map((i) => Number(n[i] || 0)); }
function newer(a, b) { const x = versionTuple(a), y = versionTuple(b); for (let i = 0; i < 3; i++) { if (x[i] !== y[i]) return x[i] > y[i]; } return false; }

// the system's DNS first; when it can't find the server (a router without DNS, a captive network), public DNS servers
const dns = require("node:dns");
const publicDns = new dns.Resolver(); publicDns.setServers(["1.1.1.1", "8.8.8.8", "9.9.9.9"]);
function lookup(host, opts, cb) {
  if (typeof opts === "function") { cb = opts; opts = {}; }
  dns.lookup(host, opts, (err, addr, fam) => {
    if (!err) return cb(null, addr, fam);
    publicDns.resolve4(host, (e2, ips) => {
      if (e2 || !ips || !ips.length) return cb(err);
      if (opts && opts.all) return cb(null, ips.map((a) => ({ address: a, family: 4 })));
      cb(null, ips[0], 4);
    });
  });
}
function explain(e) {
  const m = String(e && e.message || e);
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/.test(m)) return "no internet here: could not find github.com (DNS) - connect this computer to the internet, then Check now";
  if (/ENETUNREACH|EHOSTUNREACH/.test(m)) return "no internet here (network unreachable)";
  if (/timed out|ETIMEDOUT/.test(m)) return "the update server did not answer in time (slow or no internet) - it tries again by itself";
  return "could not reach the update server (" + m + ")";
}
function get(url, { json = false, timeout = 30000, maxBytes = 900 * 1024 * 1024, onProgress } = {}, redirects = 0) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https:") ? https : http;
    const req = mod.get(url, { lookup, headers: { "User-Agent": "CentralControl-updater", Accept: json ? "application/vnd.github+json" : "application/octet-stream" }, timeout }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 6) { res.resume(); return resolve(get(new URL(res.headers.location, url).toString(), { json, timeout, maxBytes, onProgress }, redirects + 1)); }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error("HTTP " + res.statusCode + " from " + new URL(url).host)); }
      const total = Number(res.headers["content-length"]) || 0, chunks = []; let n = 0;
      res.on("data", (c) => { n += c.length; if (n > maxBytes) { req.destroy(new Error("download too large")); return; } chunks.push(c); if (onProgress && total) onProgress(n / total); });
      res.on("end", () => { const buf = Buffer.concat(chunks); if (!json) return resolve(buf); try { resolve(JSON.parse(buf.toString("utf8") || "null")); } catch (e) { reject(e); } });
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", reject);
  });
}

class Updater {
  /** product: "central-usage" (Central Control), "CentralUsage" (Central Usage), "central-pedal-control"; current: this app's version; dir: where to keep settings */
  constructor({ product, current, dir, api }) {
    this.product = product; this.current = current; this.api = api || process.env.CC_UPDATE_API || "https://api.github.com";
    this.file = path.join(dir, "updates.json");
    this.cfg = { repo: "", auto: true, autoInstall: true, lastCheck: 0, limit: null, limitText: "", everyone: [] };   // everyone: releases Motion Audio sent to every device (installed even past the limit)   // limit: the last full release this key gets (tenths, 94 = 9.4); null = any
    try { Object.assign(this.cfg, JSON.parse(fs.readFileSync(this.file, "utf8"))); } catch (_) { }
    if (!this.cfg.repo) this.cfg.repo = process.env.CC_UPDATE_REPO != null ? process.env.CC_UPDATE_REPO : "MotionAudio/Central-Apps";   // the official releases
    this.latest = null; this.error = null; this.busy = false; this.progress = 0;
  }
  save(cfg) {
    if (cfg && "repo" in cfg) this.cfg.repo = String(cfg.repo || "").trim().replace(/^https?:\/\/github\.com\//, "").replace(/\/+$/, "") || (process.env.CC_UPDATE_REPO || "MotionAudio/Central-Apps");   // empty = the official releases
    if (cfg && "auto" in cfg) this.cfg.auto = !!cfg.auto;
    if (cfg && "autoInstall" in cfg) this.cfg.autoInstall = !!cfg.autoInstall;
    if (cfg && "limit" in cfg) { this.cfg.limit = cfg.limit == null || cfg.limit === "" ? null : Number(cfg.limit); this.cfg.limitText = String(cfg.limitText || ""); }
    if (cfg && Array.isArray(cfg.everyone)) this.cfg.everyone = cfg.everyone.map(String).slice(0, 50);
    if (this.latest && !this.allowed(this.latest.version)) { this.beyond = this.latest.version; this.latest = null; }   // (found before the key's coverage was known)
    try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.cfg)); } catch (_) { }
    return this.status();
  }
  // a version this app may install: within its key's updates, or one Motion Audio sent to every device
  allowed(v) { return this.cfg.limit == null || tenthsOf(v) <= this.cfg.limit || (this.cfg.everyone || []).includes(String(v)); }
  kind() { return process.platform === "win32" ? "win" : process.platform === "darwin" ? "mac" : process.env.APPIMAGE ? "appimage" : "deb"; }
  asset() {
    const a = (this.latest && this.latest.assets) || {}, names = Object.keys(a), k = this.kind();
    const want = k === "win" ? /-win-x64\.exe$/ : k === "mac" ? (process.arch === "arm64" ? /-mac-arm64\.dmg$/ : /-mac-x64\.dmg$/) : k === "appimage" ? /\.AppImage$/ : /\.deb$/;
    const arch = k === "win" || k === "mac" ? /./ : process.arch === "arm64" ? /arm64|aarch64/ : /amd64|x86_64|x64/;
    const mineRe = new RegExp("^" + this.product.replace(/[^A-Za-z0-9]/g, "\\$&") + "-\\d");   // (this app's files only: central-usage-2.5.0-…, not central-usage-anything-else)
    const name = names.filter((n) => mineRe.test(n) && want.test(n) && arch.test(n))[0] || null;
    return name ? { name, url: a[name] } : null;
  }
  status() {
    const lt = this.latest || {};
    return { current: this.current, repo: this.cfg.repo, auto: this.cfg.auto, autoInstall: this.cfg.autoInstall !== false, lastCheck: this.cfg.lastCheck, latest: lt.version || null, notes: (lt.notes || "").slice(0, 2000),
      available: !!(lt.version && newer(lt.version, this.current) && this.asset()), error: this.error, busy: this.busy, progress: this.progress, kind: this.kind(),
      beyond: this.beyond || null, limitText: this.cfg.limit == null ? "" : (this.cfg.limitText || fmtTenths(this.cfg.limit)) };
  }
  // once a day; after a failed look (no internet yet) again in 10 minutes
  due() { return this.cfg.auto && this.cfg.repo && Date.now() / 1000 - (this.cfg.lastCheck || 0) > (this.error ? 600 : 20 * 3600); }
  async check() {
    if (!/^[^/\s]+\/[^/\s]+$/.test(this.cfg.repo || "")) { this.error = "Set the update source first (owner/repo on GitHub)."; return this.status(); }
    try {
      // the newest release this key covers (its updates go through cfg.limit; past that, the app keeps working as it is)
      const list = await get(this.api + "/repos/" + this.cfg.repo + "/releases?per_page=40", { json: true, timeout: 15000 });
      const found = [];
      for (const rel of Array.isArray(list) ? list : [list]) {
        if (!rel || rel.draft || rel.prerelease) continue;
        const assets = {}; (rel.assets || []).forEach((a) => { assets[a.name] = a.browser_download_url; });
        // one release carries every app; this app's own version is in its file name (central-usage-9.1.0-amd64.deb)
        const mine = Object.keys(assets).map((n) => (n.match(new RegExp("^" + this.product + "-(\\d+(?:\\.\\d+)*)-")) || [])[1]).filter(Boolean)[0];
        const version = mine || String(rel.tag_name || rel.name || "").replace(/^v/i, "");
        if (version) found.push({ version, notes: rel.body || "", assets });
      }
      found.sort((a, b) => (newer(a.version, b.version) ? -1 : newer(b.version, a.version) ? 1 : 0));
      const ok = found.filter((f) => this.allowed(f.version));
      this.latest = ok[0] || null;
      this.beyond = found[0] && !this.allowed(found[0].version) && newer(found[0].version, this.current) ? found[0].version : null;
      this.error = null;
    } catch (e) { this.error = explain(e); }
    this.cfg.lastCheck = Math.floor(Date.now() / 1000); this.save({});
    return this.status();
  }
  async download(onProgress) {
    if (this.latest && !this.allowed(this.latest.version)) throw new Error("this key's updates go through " + (this.cfg.limitText || fmtTenths(this.cfg.limit)) + "; renew it on the website to get " + this.latest.version);
    const asset = this.asset(); if (!asset) throw new Error("this release has no " + ({ appimage: "AppImage", deb: ".deb", win: "Windows installer", mac: "Mac disk image" })[this.kind()] + " for this computer");
    const data = await get(asset.url, { timeout: 120000, onProgress });
    const sumsUrl = this.latest.assets.SHA256SUMS;
    if (!sumsUrl) throw new Error("the release has no SHA256SUMS - not installing an unchecked file");
    const sums = (await get(sumsUrl, { timeout: 20000 })).toString("utf8");
    const line = sums.split(/\r?\n/).map((l) => l.trim().split(/\s+/)).filter((p) => p.length >= 2 && p[p.length - 1].replace(/^\*/, "") === asset.name)[0];
    if (!line) throw new Error("SHA256SUMS has no line for " + asset.name);
    if (crypto.createHash("sha256").update(data).digest("hex") !== line[0].toLowerCase()) throw new Error("the download is damaged (checksum mismatch) - nothing was changed");
    const file = path.join(os.tmpdir(), asset.name);
    fs.writeFileSync(file, data);
    return file;
  }
  /** returns "restart" when the app should relaunch itself, "quit" when it should close (the Windows installer
   * starts it again), "opened" when an installer window took over */
  async install(onProgress) {
    this.busy = true; this.progress = 0;
    try {
      const file = await this.download((p) => { this.progress = p; if (onProgress) onProgress(p); });
      if (this.kind() === "win") {   // NSIS: /S silent, --force-run starts the app when it is done
        spawn(file, ["/S", "--force-run"], { detached: true, stdio: "ignore", windowsHide: true }).unref();
        return "quit";
      }
      if (this.kind() === "mac") return await this.installMac(file);
      if (this.kind() === "appimage") {
        const target = process.env.APPIMAGE, tmp = target + ".new";
        fs.copyFileSync(file, tmp); fs.chmodSync(tmp, 0o755); fs.renameSync(tmp, target);
        return "restart";
      }
      const pk = await new Promise((r) => execFile("sh", ["-c", "command -v pkexec"], (err, out) => r(!err && out.trim())));
      if (pk) {
        await new Promise((resolve, reject) => { const p = spawn(pk, ["apt-get", "install", "-y", "--allow-downgrades", file], { stdio: "ignore" }); p.on("exit", (code) => code === 0 ? resolve() : reject(new Error(code === 126 || code === 127 ? "the password prompt was closed" : "apt-get stopped with code " + code))); p.on("error", reject); });
        return "restart";
      }
      spawn("xdg-open", [file], { detached: true, stdio: "ignore" }).unref();
      return "opened";
    } finally { this.busy = false; }
  }
}

// macOS: mount the .dmg, put its app in place of this one (the old one is kept until the new one is in), unmount
Updater.prototype.installMac = async function (dmg) {
  const run = (cmd, args) => new Promise((resolve, reject) => execFile(cmd, args, { maxBuffer: 8 << 20 }, (err, out) => err ? reject(err) : resolve(String(out))));
  const bundle = process.execPath.replace(/\/Contents\/MacOS\/[^/]+$/, "");   // .../Central Usage.app
  let mount = null;
  try {
    if (!/\.app$/.test(bundle)) throw new Error("not running from an app bundle");
    const out = await run("hdiutil", ["attach", "-nobrowse", "-noautoopen", "-readonly", dmg]);
    mount = (out.split("\n").map((l) => l.split("\t").pop().trim()).filter((p) => p.startsWith("/Volumes/"))[0]) || null;
    if (!mount) throw new Error("the disk image did not mount");
    const app = fs.readdirSync(mount).filter((n) => n.endsWith(".app"))[0]; if (!app) throw new Error("no app in the disk image");
    const fresh = bundle + ".new", old = bundle + ".old";
    fs.rmSync(fresh, { recursive: true, force: true }); fs.rmSync(old, { recursive: true, force: true });
    await run("ditto", [path.join(mount, app), fresh]);
    try { await run("xattr", ["-dr", "com.apple.quarantine", fresh]); } catch (_) { }
    fs.renameSync(bundle, old); fs.renameSync(fresh, bundle);
    fs.rmSync(old, { recursive: true, force: true });
    return "restart";
  } catch (e) {
    // can't write where the app is (or something else went wrong): show the disk image - drag the app to Applications
    spawn("open", [dmg], { detached: true, stdio: "ignore" }).unref();
    this.error = "Drag " + ({ "central-usage": "Central Control", CentralUsage: "Central Usage", "central-pedal-control": "Central Pedal Control" }[this.product] || "the app") + " from the window that opened into Applications (replace the old one). (" + e.message + ")";
    return "opened";
  } finally { if (mount) { try { await run("hdiutil", ["detach", "-quiet", mount]); } catch (_) { } } }
};

module.exports = { Updater, newer, versionTuple };
