// Central Control / Central Usage on a computer - the sound libraries (9.8): installs a library zip (from the website's
// list, or a file) into the instrument's own sound folders (<userData>/instrument/sounds/sf2 and .../ir - the ones the
// built-in rig cu-rig and, on Linux, the Central Pedal's instrument host read). The same rules as the Central Pedal
// (libraries.py next to its driver):
//   * a download is checked against the sha256 the website lists before anything is unpacked (a mismatch is refused),
//     every file against the sha256 in the library's manifest.json;
//   * every item keeps its library's plan: sounds and IRs get a line in their folder's tiers.txt
//     ("<bank>|<plan>|<license>|<library id>"), which applyTiers() puts on the rig's sound and IR lists - so they show
//     locked without the plan, though anyone can download them; presets and boards go to the Instrument page with the plan;
//   * a newer version replaces the older one; Remove takes everything the library added away again.
// What's installed is kept in <userData>/libraries/<id>.json.
// (10.1) Community plugins (kind "plugin", from Make & sell: checked and reviewed by Motion Audio) unpack into
// <userData>/libraries/community-plugins/<id>/ only while this computer's "Allow community plugins" switch is on (off by
// default), every program file matching the sha256 the review recorded; the rig loads them walled off
// (community-sandbox.js). revoke() takes away what the website's revoke list names.
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");
const https = require("node:https");
const http = require("node:http");

const PLANS = ["keys", "instrument", "plugins", "pedals", "pads"];
const KINDS = ["sound", "board", "preset", "ir", "click", "pad", "loop", "plugin"];
const PLUGIN_FORMATS = ["lv2", "vst3", "clap", "component"], MAX_PLUGIN = 300 * 1024 * 1024;
const PAD_KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const MAX_DOWNLOAD = 2 * 1024 ** 3, MAX_ITEM = 700 * 1024 * 1024, MAX_TOTAL = 2 * 1024 ** 3;
const INDEX_URL = process.env.CC_LIBRARIES_INDEX || "https://github.com/MotionAudio/Central-Apps/releases/download/libraries/libraries-index.json";
const ID_RE = /^[a-z0-9-]{3,60}$/, VERSION_RE = /^\d+(\.\d+){0,3}$/, SHA_RE = /^[0-9a-f]{64}$/;

// ---------------------------------------------------------------- a small zip reader (stored / deflated entries)
function readZip(file) {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size, tail = Math.min(size, 65557), buf = Buffer.alloc(tail);
    fs.readSync(fd, buf, 0, tail, size - tail);
    let eocd = -1;
    for (let i = tail - 22; i >= 0; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error("not a zip");
    const count = buf.readUInt16LE(eocd + 10), cdSize = buf.readUInt32LE(eocd + 12), cdOff = buf.readUInt32LE(eocd + 16);
    if (cdOff === 0xffffffff || count === 0xffff) throw new Error("zip64 libraries aren't supported");
    const cd = Buffer.alloc(cdSize); fs.readSync(fd, cd, 0, cdSize, cdOff);
    const entries = new Map();
    for (let p = 0, n = 0; n < count && p + 46 <= cd.length; n++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) throw new Error("a damaged zip");
      const method = cd.readUInt16LE(p + 10), csize = cd.readUInt32LE(p + 20), usize = cd.readUInt32LE(p + 24);
      const nlen = cd.readUInt16LE(p + 28), xlen = cd.readUInt16LE(p + 30), clen = cd.readUInt16LE(p + 32), off = cd.readUInt32LE(p + 42);
      const name = cd.toString("utf8", p + 46, p + 46 + nlen), attr = cd.readUInt32LE(p + 38);
      entries.set(name, { name, method, csize, usize, off, link: ((attr >>> 16) & 0o170000) === 0o120000 });
      p += 46 + nlen + xlen + clen;
    }
    return {
      names: () => Array.from(entries.keys()),
      has: (n) => entries.has(n),
      isLink: (n) => !!(entries.get(n) || {}).link,
      size: (n) => (entries.get(n) || {}).usize || 0,
      read(n) {
        const e = entries.get(n); if (!e) throw new Error("no " + n + " in the zip");
        const lh = Buffer.alloc(30); fs.readSync(fd, lh, 0, 30, e.off);
        if (lh.readUInt32LE(0) !== 0x04034b50) throw new Error("a damaged zip");
        const start = e.off + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28), raw = Buffer.alloc(e.csize);
        fs.readSync(fd, raw, 0, e.csize, start);
        if (e.method === 0) return raw;
        if (e.method === 8) return zlib.inflateRawSync(raw, { maxOutputLength: MAX_ITEM + 1 });
        throw new Error("a zip packed in a way this app can't read");
      },
      close: () => { try { fs.closeSync(fd); } catch (_) { } },   // (the file stays open for read() until then)
    };
  } catch (e) { fs.closeSync(fd); throw e; }
}

// ---------------------------------------------------------------- helpers
const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
function sha256File(file) {
  const h = crypto.createHash("sha256"), fd = fs.openSync(file, "r"), b = Buffer.alloc(1 << 20);
  try { let n; while ((n = fs.readSync(fd, b, 0, b.length, null)) > 0) h.update(b.subarray(0, n)); } finally { fs.closeSync(fd); }
  return h.digest("hex");
}
function safeName(name, dflt) { const b = path.basename(String(name || "").replace(/\\/g, "/")).replace(/[^\w.\- ]+/g, "").replace(/^[ .]+|[ .]+$/g, ""); return b.slice(0, 120) || dflt; }
const vkey = (v) => String(v || "0").split(".").map((x) => parseInt(x, 10) || 0);
function newer(a, b) { const x = vkey(a), y = vkey(b); for (let i = 0; i < Math.max(x.length, y.length); i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; }
function tiersSet(folder, owner, lines) {
  fs.mkdirSync(folder, { recursive: true });
  const file = path.join(folder, "tiers.txt");
  let keep = [];
  try { keep = fs.readFileSync(file, "utf8").split("\n").filter((l) => l && !(l.split("|").length >= 4 && l.split("|")[3] === owner)); } catch (_) { }
  const body = keep.concat(lines).join("\n");
  fs.writeFileSync(file + ".part", body + (body ? "\n" : "")); fs.renameSync(file + ".part", file);
}
function readTiers(folder) {
  const out = {};
  try { for (const line of fs.readFileSync(path.join(folder, "tiers.txt"), "utf8").split("\n")) { const p = line.trim().split("|"); if (p.length >= 2 && p[0] && p[0][0] !== "#" && ["free"].concat(PLANS).includes(p[1])) out[p[0]] = p[1]; } } catch (_) { }
  return out;
}

class Libraries {
  // dir: <userData>; send(msg): to the instrument engine (a rescan after adding sounds)
  constructor({ dir, send } = {}) {
    this.instDir = path.join(dir, "instrument");
    this.sf2Dir = path.join(this.instDir, "sounds", "sf2");
    this.irDir = path.join(this.instDir, "sounds", "ir");
    this.root = path.join(dir, "libraries");
    this.send = send || (() => {});
    this.progress = {};
    fs.mkdirSync(this.root, { recursive: true });
  }
  record(id) { try { return JSON.parse(fs.readFileSync(path.join(this.root, id + ".json"), "utf8")); } catch (_) { return null; } }
  installed() { return fs.readdirSync(this.root).filter((f) => f.endsWith(".json")).map((f) => this.record(f.slice(0, -5))).filter((r) => r && r.id); }
  listing() { return this.installed().map((r) => ({ id: r.id, plan: r.plan, version: r.version, title: r.title, summary: r.summary, installedAt: r.installedAt, counts: r.counts, boards: r.boards, presets: r.presets, source: r.source, community: r.community, plugins: r.plugins })); }

  // ----- (10.1) community plugins: this computer's switch, and the website's revoke list
  pluginsDir() { return path.join(this.root, "community-plugins"); }
  pluginsAllowed() { try { return JSON.parse(fs.readFileSync(path.join(this.root, "community-plugins.json"), "utf8")).on === true; } catch (_) { return false; } }
  setPluginsAllowed(on) { fs.writeFileSync(path.join(this.root, "community-plugins.json"), JSON.stringify({ on: on === true, changed: new Date().toISOString().slice(0, 19) })); return this.pluginsAllowed(); }
  revoke(ids, hashes) {
    const named = new Set(ids || []), bad = new Set((hashes || []).map((h) => String(h).toLowerCase()).filter((h) => SHA_RE.test(h))), gone = [];
    for (const r of this.installed()) {
      const hit = named.has(r.id) || (bad.size && (r.plugins || []).some((pl) => (pl.binaries || []).some((b) => bad.has(b.sha256))));
      if (hit) { try { this.remove(r.id); gone.push(r.id); } catch (_) { } }
    }
    return gone;
  }
  _unpackPlugin(id, it, data) {
    if (!this.pluginsAllowed()) throw new Error("community plugins are off on this computer - switch on Allow community plugins first");
    const fmt = String(it.format || ""), bundle = safeName(it.bundle, "");
    if (!PLUGIN_FORMATS.includes(fmt) || !bundle) throw new Error("a plugin in that library isn't a plugin bundle");
    const want = new Map((Array.isArray(it.binaries) ? it.binaries : []).filter((b) => b && b.name).map((b) => [String(b.name), String(b.sha256 || "").toLowerCase()]));
    if (!want.size) throw new Error("a plugin in that library has no checked program files");
    const dest = path.join(this.pluginsDir(), id), tmp = path.join(this.root, ".plugin-" + crypto.randomBytes(6).toString("hex") + ".zip");
    fs.rmSync(dest, { recursive: true, force: true }); fs.mkdirSync(dest, { recursive: true });
    const real = fs.realpathSync(dest), seen = new Map();
    fs.writeFileSync(tmp, data);
    let z = null;
    try {
      try { z = readZip(tmp); } catch (_) { throw new Error("a plugin in that library can't be unpacked"); }
      let total = 0;
      for (const n of z.names()) {
        if (n.endsWith("/")) continue;
        if (z.isLink(n)) throw new Error("a plugin in that library has a link in it");
        const parts = n.replace(/\\/g, "/").split("/").filter(Boolean);
        if (!parts.length || n.startsWith("/") || parts.some((x) => x === "." || x === "..")) throw new Error("a plugin in that library has a file outside its folder");
        total += z.size(n); if (total > MAX_PLUGIN) throw new Error("a plugin in that library is too big");
        const out = path.resolve(dest, ...parts); if (!out.startsWith(real + path.sep)) throw new Error("a plugin in that library has a file outside its folder");
        const body = z.read(n); fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, body, { mode: want.has(parts.join("/")) ? 0o755 : 0o644 });
        seen.set(parts.join("/"), sha256(body));
      }
      for (const [n, h] of want) if (seen.get(n) !== h) throw new Error("a plugin's program file doesn't match what Motion Audio checked - nothing was installed");
    } catch (e) { fs.rmSync(dest, { recursive: true, force: true }); throw e; } finally { if (z) z.close(); try { fs.unlinkSync(tmp); } catch (_) { } }
    return { name: String(it.name || bundle).slice(0, 80), format: fmt, platform: String(it.platform || ""), bundle, path: path.join(dest, bundle), binaries: Array.from(want, ([name, sha]) => ({ name, sha256: sha })) };
  }

  // the plans on the engine's sound and IR lists (the rig doesn't read tiers.txt itself)
  applyTiers(msg) {
    if (!msg || msg.type !== "instrumentStatus") return msg;
    const cache = {}, tiersOf = (file) => { const d = path.dirname(file || ""); if (!(d in cache)) cache[d] = readTiers(d); return cache[d]; };
    for (const b of msg.keysCatalog || []) {
      const base = path.basename(b.file || "").replace(/\.sf[23]$/i, ""), t = base.includes(" - ") ? tiersOf(b.file)[base.split(" - ")[0]] : null;
      if (t && !b.tier) { b.tier = t; b.user = false; }
    }
    for (const ir of msg.irs || []) { const t = tiersOf(ir.file)[path.basename(ir.file || "").replace(/\.[^.]+$/, "")]; if (t && !ir.tier) ir.tier = t; }
    return msg;
  }

  // ----- (10.0.1) the published list: while the website isn't open, straight from the "libraries" release (its index has
  // each zip's size and sha256); the website's own list wins once it's open (js/libraries.js asks it first)
  index(url) {
    url = String(url || INDEX_URL);
    if (this._index && this._index.url === url && Date.now() - this._index.at < 10 * 60e3) return Promise.resolve(this._index.data);
    return new Promise((resolve, reject) => {
      const get = (u, hops) => {
        const lib = u.startsWith("https:") ? https : http;
        const req = lib.get(u, { headers: { "User-Agent": "central-control" }, timeout: 20000 }, (res) => {
          if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && hops < 6) { res.resume(); return get(new URL(res.headers.location, u).toString(), hops + 1); }
          if (res.statusCode !== 200) { res.resume(); return reject(new Error("the library list answered " + res.statusCode)); }
          const parts = []; let n = 0;
          res.on("data", (b) => { n += b.length; if (n > 4 << 20) { req.destroy(); return reject(new Error("the library list is too big")); } parts.push(b); });
          res.on("end", () => {
            let j; try { j = JSON.parse(Buffer.concat(parts).toString("utf8")); } catch (_) { return reject(new Error("the library list can't be read")); }
            const base = String(j.base || u.replace(/[?#].*$/, "").replace(/\/[^/]*$/, ""));   // (the zips sit next to the index, where the redirect ended)
            const list = (Array.isArray(j.libraries) ? j.libraries : []).filter((l) => l && ID_RE.test(l.id || "") && PLANS.includes(l.plan) && SHA_RE.test(String(l.sha256 || "").toLowerCase()) && l.file)
              .map((l) => ({ id: l.id, plan: l.plan, title: l.title || l.id, version: String(l.version || ""), summary: l.summary || "", file: l.file, size: Number(l.size) || 0, sha256: String(l.sha256).toLowerCase(), url: base.replace(/\/$/, "") + "/" + encodeURIComponent(l.file), ready: true }));
            const data = { ok: true, source: "release", built: j.built || "", libraries: list };
            this._index = { url, at: Date.now(), data }; resolve(data);
          });
        });
        req.on("timeout", () => req.destroy(new Error("no answer")));
        req.on("error", (e) => reject(new Error("the library list didn't come (" + e.message + ") - check the internet")));
      };
      get(url, 0);
    });
  }

  // ----- install
  download(url, sha, id, sizeHint, onProgress) {
    if (!/^https?:\/\//.test(String(url || ""))) return Promise.reject(new Error("not a download address"));
    if (!SHA_RE.test(String(sha || ""))) return Promise.reject(new Error("this library isn't published yet (no checksum to check it against)"));
    const tmp = path.join(this.root, ".download-" + crypto.randomBytes(6).toString("hex") + ".zip");
    const prog = (this.progress[id] = { done: 0, total: sizeHint || 0, state: "downloading" });
    return new Promise((resolve, reject) => {
      const fail = (e) => { try { fs.unlinkSync(tmp); } catch (_) { } prog.state = "failed"; reject(e); };
      const get = (u, hops) => {
        const lib = u.startsWith("https:") ? https : http;
        const req = lib.get(u, { headers: { "User-Agent": "central-control" }, timeout: 60000 }, (res) => {
          if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && hops < 6) { res.resume(); return get(new URL(res.headers.location, u).toString(), hops + 1); }
          if (res.statusCode !== 200) { res.resume(); return fail(new Error("the download answered " + res.statusCode)); }
          prog.total = Number(res.headers["content-length"]) || prog.total;
          const h = crypto.createHash("sha256"), out = fs.createWriteStream(tmp);
          res.on("data", (b) => { prog.done += b.length; if (prog.done > MAX_DOWNLOAD) { req.destroy(); out.destroy(); return fail(new Error("that download is too big for a library")); } h.update(b); if (onProgress) onProgress(prog); });
          res.on("error", (e) => fail(new Error("the download didn't finish (" + e.message + ")")));
          res.pipe(out);
          out.on("finish", () => {
            if (h.digest("hex") !== String(sha).toLowerCase()) return fail(new Error("the download doesn't match its checksum (it may be damaged or incomplete) - nothing was installed"));
            prog.state = "installing"; resolve(tmp);
          });
        });
        req.on("timeout", () => req.destroy(new Error("no answer")));
        req.on("error", (e) => fail(new Error("the download didn't finish (" + e.message + ") - check the internet and try again")));
      };
      get(String(url), 0);
    });
  }
  async installUrl(url, sha, id, sizeHint, onProgress) {
    const tmp = await this.download(url, sha, id || "library", sizeHint, onProgress);
    try { return this.installFile(tmp, sha, "website"); } finally { delete this.progress[id || "library"]; try { fs.unlinkSync(tmp); } catch (_) { } }
  }
  installFile(file, expectSha, source) {
    if (expectSha != null) {
      if (!SHA_RE.test(String(expectSha).toLowerCase())) throw new Error("no checksum to check the library against");
      if (sha256File(file) !== String(expectSha).toLowerCase()) throw new Error("the library doesn't match its checksum (it may be damaged or incomplete) - nothing was installed");
    }
    let z; try { z = readZip(file); } catch (_) { throw new Error("that isn't a library file (a .zip from the Downloads page)"); }
    try { return this._checkAndInstall(z, source); } finally { z.close(); }
  }
  _checkAndInstall(z, source) {
    let man;
    if (!z.has("manifest.json")) throw new Error("that zip isn't a sound library (no manifest.json)");
    try { man = JSON.parse(z.read("manifest.json").toString("utf8")); } catch (_) { throw new Error("that library's manifest.json can't be read"); }
    if (!man || !ID_RE.test(man.id || "") || !PLANS.includes(man.plan) || !VERSION_RE.test(String(man.version || ""))) throw new Error("that library's manifest.json is missing its id, plan or version");
    if ((Number(man.format) || 1) > 1) throw new Error("that library needs a newer version of the app - update it first");
    if (!Array.isArray(man.items) || !man.items.length) throw new Error("that library has nothing in it");
    let total = 0;
    for (const it of man.items) {
      if (!it || typeof it.kind !== "string" || typeof it.file !== "string" || !z.has(it.file)) throw new Error("that library lists a file it doesn't have");   // (a kind a newer version knows is left out below)
      if (z.size(it.file) > MAX_ITEM) throw new Error("a file in that library is too big");
      total += z.size(it.file);
    }
    if (total > MAX_TOTAL) throw new Error("that library is too big to unpack");
    return this._install(z, man, source || "file");
  }
  _install(z, man, source) {
    const id = man.id, tier = man.plan;
    if (this.record(id)) this.remove(id, true);
    const rec = { id, plan: tier, version: String(man.version), title: String(man.title || id).slice(0, 80), summary: String(man.summary || "").slice(0, 400), installedAt: new Date().toISOString().slice(0, 19),
      source: source === "file" ? "file" : "website", sounds: [], irs: [], clicks: [], pads: [], loops: [], boards: [], presets: [], plugins: [], tier };
    if (man.community && typeof man.community === "object") rec.community = { item: man.community.item, creator: String(man.community.creator || "").slice(0, 80), kind: String(man.community.kind || "").slice(0, 20) };   // (10.1: from Make & sell)
    const soundLines = [], irLines = [], sounds = [], irs = [];
    for (const it of man.items) {
      if (!KINDS.includes(it.kind)) continue;   // (from a newer library: left out)
      const data = z.read(it.file);
      if (it.sha256 && sha256(data) !== String(it.sha256).toLowerCase()) throw new Error((it.name || it.file) + " in that library is damaged (its checksum doesn't match) - nothing was installed");
      const lic = String(it.license || "").replace(/[|\r\n]+/g, " ").slice(0, 60);
      if (it.kind === "sound") {
        let name = safeName(it.file, id + ".sf2");
        if (!/\.sf[23]$/i.test(name)) throw new Error("a sound in that library isn't a SoundFont");
        if (!name.replace(/\.sf[23]$/i, "").includes(" - ")) name = safeName(it.name || name.replace(/\.sf[23]$/i, ""), "Sound") + " - " + id + ".sf2";
        if (!(data.slice(0, 4).toString() === "RIFF" && data.slice(8, 12).toString() === "sfbk")) throw new Error("a sound in that library isn't a SoundFont");
        soundLines.push(name.replace(/\.sf[23]$/i, "").split(" - ")[0] + "|" + tier + "|" + lic + "|" + id); sounds.push([name, data]);
      } else if (it.kind === "ir") {
        const name = safeName(it.file, id + ".wav");
        if (!(data.slice(0, 4).toString() === "RIFF" && data.slice(8, 12).toString() === "WAVE")) throw new Error("an impulse response in that library isn't a WAV");
        irLines.push(name.replace(/\.[^.]+$/, "") + "|" + tier + "|" + lic + "|" + id); irs.push([name, data]);
      } else if (it.kind === "board" || it.kind === "preset") {
        let b; try { b = JSON.parse(data.toString("utf8")); } catch (_) { throw new Error("a board in that library can't be read"); }
        if (!b || !Array.isArray(b.chain)) throw new Error("a board in that library has no pedals");
        rec[it.kind === "board" ? "boards" : "presets"].push({ name: String(b.name || it.name || "Board").slice(0, 60), kind: b.kind, chain: b.chain.slice(0, 24), sound: typeof b.sound === "string" ? b.sound : null, library: id, tier });
      } else if (it.kind === "click") {
        const dir = path.join(this.root, id, "clicks"); fs.mkdirSync(dir, { recursive: true });
        const f = path.join(dir, safeName(it.file, "click.wav")); fs.writeFileSync(f, data); rec.clicks.push({ name: String(it.name || "").slice(0, 60), file: f, tier });
      } else if (it.kind === "pad") {   // (Central Pads: one loop per style and key, for the pad pedal)
        const key = String(it.key || ""), style = String(it.name || "Pad").slice(0, 60);
        if (!PAD_KEYS.includes(key) || data.slice(0, 4).toString() !== "RIFF") throw new Error("a pad in that library isn't a key's WAV loop");
        const dir = path.join(this.root, id, "pads", safeName(style.replace(/ /g, "-"), "pad")); fs.mkdirSync(dir, { recursive: true });
        const f = path.join(dir, key.replace("#", "s") + ".wav"); fs.writeFileSync(f, data); rec.pads.push({ name: style, key, file: f, tier });
      } else if (it.kind === "loop") {   // (10.0: drum loops at a tempo, ambient loops in a key - kept with the library)
        if (data.slice(0, 4).toString() !== "RIFF") throw new Error("a loop in that library isn't a WAV file");
        const set = safeName(String(it.set || "loops"), "loops"), dir = path.join(this.root, id, "loops", set); fs.mkdirSync(dir, { recursive: true });
        const f = path.join(dir, safeName(it.file, "loop.wav")); fs.writeFileSync(f, data);
        const e = { name: String(it.name || "Loop").slice(0, 60), set, group: String(it.group || "Loops").slice(0, 40), file: f, tier };
        ["bpm", "meter", "bars", "seconds"].forEach((k) => { if (typeof it[k] === "number" && it[k] > 0 && it[k] < 1000) e[k] = it[k]; });
        if (PAD_KEYS.includes(it.key)) e.key = it.key;
        rec.loops.push(e);
      } else if (it.kind === "plugin") {   // (10.1: a community plugin - only with the switch on)
        rec.plugins.push(this._unpackPlugin(id, it, data));
      }
    }
    if (sounds.length) tiersSet(this.sf2Dir, id, soundLines);   // (the plans first: the engine sees each sound locked as it arrives)
    if (irs.length) tiersSet(this.irDir, id, irLines);
    fs.mkdirSync(this.sf2Dir, { recursive: true }); fs.mkdirSync(this.irDir, { recursive: true });
    for (const [name, data] of sounds) { const f = path.join(this.sf2Dir, name); fs.writeFileSync(f + ".part", data); fs.renameSync(f + ".part", f); rec.sounds.push(f); }
    for (const [name, data] of irs) { const f = path.join(this.irDir, name); fs.writeFileSync(f + ".part", data); fs.renameSync(f + ".part", f); rec.irs.push(f); }
    rec.counts = { sound: rec.sounds.length, ir: rec.irs.length, board: rec.boards.length, preset: rec.presets.length, click: rec.clicks.length, pad: new Set(rec.pads.map((x) => x.name)).size,
      loop: new Set(rec.loops.map((x) => x.set + "/" + x.name)).size };
    if (rec.plugins.length) rec.counts.plugin = rec.plugins.length;   // (10.1: community plugins)
    const rf = path.join(this.root, id + ".json"); fs.writeFileSync(rf + ".part", JSON.stringify(rec, null, 1)); fs.renameSync(rf + ".part", rf);
    this.send({ type: "instrument", action: "rescan" }); this.send({ type: "instrument", action: "status" });
    return rec;
  }
  remove(id, keepRecord) {
    if (!ID_RE.test(String(id || ""))) throw new Error("no such library");
    const rec = this.record(id); if (!rec) throw new Error("that library isn't installed");
    const ok = [path.resolve(this.sf2Dir), path.resolve(this.irDir)];
    for (const f of (rec.sounds || []).concat(rec.irs || [])) { const r = path.resolve(f); if (ok.some((d) => r.startsWith(d + path.sep))) try { fs.unlinkSync(r); } catch (_) { } }
    tiersSet(this.sf2Dir, id, []); tiersSet(this.irDir, id, []);
    fs.rmSync(path.join(this.root, id), { recursive: true, force: true });
    fs.rmSync(path.join(this.pluginsDir(), id), { recursive: true, force: true });
    if (!keepRecord) try { fs.unlinkSync(path.join(this.root, id + ".json")); } catch (_) { }
    this.send({ type: "instrument", action: "rescan" }); this.send({ type: "instrument", action: "status" });
    return { ok: true, id };
  }
}

module.exports = { Libraries, readZip, newer, readTiers };
