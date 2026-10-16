/* Desktop updater, shared by Central Usage and Central Control (PC). It looks at the Releases page of a
 * GitHub repository once a day, and only installs when the person says so:
 *  - running as an AppImage: the new AppImage replaces this one and the app restarts;
 *  - installed from the .deb: the new .deb is installed with the system's password prompt (pkexec apt-get),
 *    or, without pkexec, opened in the software installer.
 * Every download is checked against the release's SHA256SUMS before anything is replaced. */
"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const https = require("node:https");
const http = require("node:http");
const crypto = require("node:crypto");
const { execFile, spawn } = require("node:child_process");

function versionTuple(v) { const n = String(v || "").match(/\d+/g) || []; return [0, 1, 2].map((i) => Number(n[i] || 0)); }
function newer(a, b) { const x = versionTuple(a), y = versionTuple(b); for (let i = 0; i < 3; i++) { if (x[i] !== y[i]) return x[i] > y[i]; } return false; }

function get(url, { json = false, timeout = 30000, maxBytes = 400 * 1024 * 1024, onProgress } = {}, redirects = 0) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https:") ? https : http;
    const req = mod.get(url, { headers: { "User-Agent": "CentralControl-updater", Accept: json ? "application/vnd.github+json" : "application/octet-stream" }, timeout }, (res) => {
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
  /** product: "central-usage" or "central-control"; current: this app's version; dir: where to keep settings */
  constructor({ product, current, dir, api }) {
    this.product = product; this.current = current; this.api = api || process.env.CC_UPDATE_API || "https://api.github.com";
    this.file = path.join(dir, "updates.json");
    this.cfg = { repo: "", auto: true, lastCheck: 0 };
    try { Object.assign(this.cfg, JSON.parse(fs.readFileSync(this.file, "utf8"))); } catch (_) { }
    if (!this.cfg.repo) this.cfg.repo = process.env.CC_UPDATE_REPO != null ? process.env.CC_UPDATE_REPO : "MotionAudio/Central-Apps";   // the official releases
    this.latest = null; this.error = null; this.busy = false; this.progress = 0;
  }
  save(cfg) {
    if (cfg && "repo" in cfg) this.cfg.repo = String(cfg.repo || "").trim().replace(/^https?:\/\/github\.com\//, "").replace(/\/+$/, "");
    if (cfg && "auto" in cfg) this.cfg.auto = !!cfg.auto;
    try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.cfg)); } catch (_) { }
    return this.status();
  }
  kind() { return process.env.APPIMAGE ? "appimage" : process.platform === "linux" ? "deb" : "other"; }
  asset() {
    const a = (this.latest && this.latest.assets) || {}, names = Object.keys(a), want = this.kind() === "appimage" ? /\.AppImage$/ : /\.deb$/;
    const arch = process.arch === "arm64" ? /arm64|aarch64/ : /amd64|x86_64|x64/;
    const name = names.filter((n) => n.startsWith(this.product + "-") && want.test(n) && arch.test(n))[0] || null;
    return name ? { name, url: a[name] } : null;
  }
  status() {
    const lt = this.latest || {};
    return { current: this.current, repo: this.cfg.repo, auto: this.cfg.auto, lastCheck: this.cfg.lastCheck, latest: lt.version || null, notes: (lt.notes || "").slice(0, 2000),
      available: !!(lt.version && newer(lt.version, this.current) && this.asset()), error: this.error, busy: this.busy, progress: this.progress, kind: this.kind() };
  }
  due() { return this.cfg.auto && this.cfg.repo && Date.now() / 1000 - (this.cfg.lastCheck || 0) > 20 * 3600; }
  async check() {
    if (!/^[^/\s]+\/[^/\s]+$/.test(this.cfg.repo || "")) { this.error = "Set the update source first (owner/repo on GitHub)."; return this.status(); }
    try {
      const rel = await get(this.api + "/repos/" + this.cfg.repo + "/releases/latest", { json: true, timeout: 15000 });
      const assets = {}; (rel.assets || []).forEach((a) => { assets[a.name] = a.browser_download_url; });
      this.latest = { version: String(rel.tag_name || rel.name || "").replace(/^v/i, ""), notes: rel.body || "", assets };
      this.error = null;
    } catch (e) { this.error = "Could not reach the update server (" + e.message + ")"; }
    this.cfg.lastCheck = Math.floor(Date.now() / 1000); this.save({});
    return this.status();
  }
  async download(onProgress) {
    const asset = this.asset(); if (!asset) throw new Error("this release has no " + (this.kind() === "appimage" ? "AppImage" : ".deb") + " for this computer");
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
  /** returns "restart" when the app should relaunch itself, "opened" when an installer window took over */
  async install(onProgress) {
    this.busy = true; this.progress = 0;
    try {
      const file = await this.download((p) => { this.progress = p; if (onProgress) onProgress(p); });
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

module.exports = { Updater, newer, versionTuple };
