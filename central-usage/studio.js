// Central Usage - the Studio tab's side in the main process:
//   the sound list (every SoundFont bank on this computer, with its plan from tiers.txt), reading parts of a bank
//   (the renderer loads only the samples a sound uses), the projects (<userData>/studio/<id>/project.json + audio/),
//   saving an export (a mix or stems) where you choose, and cu-studio - the native program that plays what you play
//   on a MIDI keyboard with almost no delay.
"use strict";
const fs = require("node:fs"), path = require("node:path"), os = require("node:os");
const { spawn } = require("node:child_process");

const EXE = process.platform === "win32" ? ".exe" : "";
const LINUX_DIRS = ["/opt/pad-pedal/sounds", "/usr/share/sounds/sf2", "/usr/share/sounds/sf3", "/usr/share/soundfonts"];

// a bank's preset names (phdr) without reading its samples
function sf2Presets(file) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const head = Buffer.alloc(12); fs.readSync(fd, head, 0, 12, 0);
    if (head.toString("latin1", 0, 4) !== "RIFF" || head.toString("latin1", 8, 12) !== "sfbk") return null;
    const size = fs.fstatSync(fd).size; let pos = 12; const h = Buffer.alloc(12);
    while (pos + 12 <= size) {
      fs.readSync(fd, h, 0, 12, pos); const id = h.toString("latin1", 0, 4), len = h.readUInt32LE(4);
      if (id === "LIST" && h.toString("latin1", 8, 12) === "pdta") {
        let p = pos + 12; const end = pos + 8 + len;
        while (p + 8 <= end) {
          fs.readSync(fd, h, 0, 8, p); const cid = h.toString("latin1", 0, 4), clen = h.readUInt32LE(4);
          if (cid === "phdr") {
            const b = Buffer.alloc(clen); fs.readSync(fd, b, 0, clen, p + 8); const out = [];
            for (let o = 0; o + 38 <= clen - 38; o += 38) { const name = b.toString("latin1", o, o + 20).replace(/\0.*$/s, "").trim(); out.push({ name: name || path.basename(file, path.extname(file)), prog: b.readUInt16LE(o + 20), bank: b.readUInt16LE(o + 22) }); }
            return out.sort((a, c) => a.bank - c.bank || a.prog - c.prog);
          }
          p += 8 + clen + (clen & 1);
        }
        return null;
      }
      pos += 8 + len + (len & 1);
    }
    return null;
  } catch (_) { return null; } finally { if (fd != null) try { fs.closeSync(fd); } catch (_) { } }
}
function tiersOf(dir) {   // tiers.txt: "<file prefix>|<tier>|<license>|<name>" (get-sounds.sh, the sound libraries)
  const out = {}; try { for (const line of fs.readFileSync(path.join(dir, "tiers.txt"), "utf8").split(/\r?\n/)) { const f = line.split("|"); if (f.length >= 2 && f[0].trim()) out[f[0].trim()] = f[1].trim(); } } catch (_) { }
  return out;
}

module.exports.setup = function setup({ ipcMain, app, getWin, binDir, soundsDir }) {
  const userData = app.getPath("userData"), root = path.join(userData, "studio"), userSf2 = path.join(userData, "instrument", "sounds", "sf2");
  const send = (ch, m) => { const w = getWin(); if (w && !w.isDestroyed()) w.webContents.send(ch, m); };
  let allowed = new Set();

  function catalog() {
    const dirs = [soundsDir, userSf2].concat(process.platform === "linux" ? LINUX_DIRS : []), out = [], seen = new Set();
    for (const d of dirs) {
      let names = []; try { names = fs.readdirSync(d); } catch (_) { continue; }
      const tiers = tiersOf(d);
      for (const fn of names.sort()) {
        if (!/\.sf[23]$/i.test(fn)) continue;
        const file = path.join(d, fn); let real = file; try { real = fs.realpathSync(file); } catch (_) { }
        if (seen.has(real)) continue; seen.add(real);
        const presets = sf2Presets(file); if (!presets || !presets.length) continue;
        const base = fn.replace(/\.sf[23]$/i, ""), prefix = base.includes(" - ") ? base.split(" - ")[0] : null, tier = prefix ? tiers[prefix] || null : null;
        let name = (prefix || base).replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
        if (/^(fluidr3 gm|default gm)$/i.test(name)) name = "General MIDI (FluidR3)"; else if (/musescore/i.test(name)) name = "MuseScore General";
        out.push({ file, name, presets: presets.slice(0, 512), tier, user: d === userSf2 && !tier });
        allowed.add(file);
      }
    }
    if (out.some((b) => b.name === "General MIDI (FluidR3)")) return out.filter((b) => !/timgm/i.test(b.name));
    return out;
  }
  ipcMain.handle("studio-catalog", () => catalog());
  ipcMain.handle("studio-read", (_e, file, offset, length) => {
    if (!allowed.has(file)) catalog();
    if (!allowed.has(file)) throw new Error("not a sound bank on this computer");
    const fd = fs.openSync(file, "r"); try { const n = Math.max(0, Math.min(Number(length) || 0, 512 * 1024 * 1024)), b = Buffer.alloc(n); const got = fs.readSync(fd, b, 0, n, Math.max(0, Number(offset) || 0)); return got === n ? b : b.subarray(0, got); } finally { fs.closeSync(fd); }
  });

  // ---- projects
  const safe = (s) => String(s || "").replace(/[^\w.-]+/g, "_").slice(0, 80);
  const dirOf = (id) => path.join(root, safe(id));
  ipcMain.handle("studio-list", () => {
    let ids = []; try { ids = fs.readdirSync(root); } catch (_) { }
    return ids.map((id) => { try { const p = JSON.parse(fs.readFileSync(path.join(root, id, "project.json"), "utf8")); return { id: p.id || id, name: p.name || "Untitled", savedAt: p.savedAt || fs.statSync(path.join(root, id, "project.json")).mtimeMs, bpm: p.bpm, key: p.key }; } catch (_) { return null; } })
      .filter(Boolean).sort((a, b) => b.savedAt - a.savedAt);
  });
  ipcMain.handle("studio-load", (_e, id) => { try { return JSON.parse(fs.readFileSync(path.join(dirOf(id), "project.json"), "utf8")); } catch (_) { return null; } });
  ipcMain.handle("studio-save", (_e, id, json, audio) => {
    const d = dirOf(id); fs.mkdirSync(path.join(d, "audio"), { recursive: true });
    for (const [name, data] of Object.entries(audio || {})) if (data) fs.writeFileSync(path.join(d, "audio", safe(name)), Buffer.from(data));
    const tmp = path.join(d, "project.json.tmp"); fs.writeFileSync(tmp, json); fs.renameSync(tmp, path.join(d, "project.json"));
    // audio no clip uses any more goes
    try { const used = new Set((JSON.parse(json).audioFiles || []).map(safe)); for (const f of fs.readdirSync(path.join(d, "audio"))) if (!used.has(f)) fs.unlinkSync(path.join(d, "audio", f)); } catch (_) { }
    return { ok: true, dir: d };
  });
  ipcMain.handle("studio-audio", (_e, id, name) => { try { return fs.readFileSync(path.join(dirOf(id), "audio", safe(name))); } catch (_) { return null; } });
  ipcMain.handle("studio-remove", (_e, id) => { try { fs.rmSync(dirOf(id), { recursive: true, force: true }); return true; } catch (_) { return false; } });
  ipcMain.handle("studio-export", async (_e, suggested, files) => {   // files: [{ name, data }] - one: a save dialog; several: pick a folder
    const { dialog } = require("electron"), w = getWin();
    if (files.length === 1) {
      const r = await dialog.showSaveDialog(w, { defaultPath: path.join(app.getPath("music") || os.homedir(), files[0].name), filters: [{ name: "WAV audio", extensions: ["wav"] }] });
      if (r.canceled || !r.filePath) return null; fs.writeFileSync(r.filePath, Buffer.from(files[0].data)); return r.filePath;
    }
    const r = await dialog.showOpenDialog(w, { title: "Pick a folder for the stems", defaultPath: app.getPath("music") || os.homedir(), properties: ["openDirectory", "createDirectory"] });
    if (r.canceled || !r.filePaths[0]) return null;
    const dir = path.join(r.filePaths[0], safe(suggested) || "Stems"); fs.mkdirSync(dir, { recursive: true });
    for (const f of files) fs.writeFileSync(path.join(dir, safe(f.name)), Buffer.from(f.data));
    return dir;
  });

  // ---- cu-studio: the live sound
  let mon = null, monBuf = "";
  function monStart() {
    if (mon && mon.exitCode == null) return { ok: true };
    const bin = path.join(binDir, "cu-studio" + EXE);
    if (!fs.existsSync(bin)) return { ok: false, error: "The low-delay player isn't installed on this computer." };
    try { fs.chmodSync(bin, 0o755); } catch (_) { }
    mon = spawn(bin, ["--block", "128"], { stdio: ["pipe", "pipe", "ignore"] }); monBuf = "";
    mon.stdout.on("data", (b) => { monBuf += b; let i; while ((i = monBuf.indexOf("\n")) >= 0) { const line = monBuf.slice(0, i); monBuf = monBuf.slice(i + 1); try { send("studio-monitor", JSON.parse(line)); } catch (_) { } } });
    mon.on("exit", () => { send("studio-monitor", { type: "studioMonitor", ok: false, stopped: true }); mon = null; });
    mon.on("error", () => { mon = null; });
    return { ok: true };
  }
  ipcMain.handle("studio-monitor-start", () => monStart());
  ipcMain.on("studio-monitor-send", (_e, m) => { if (mon && mon.stdin.writable) try { mon.stdin.write(JSON.stringify(m) + "\n"); } catch (_) { } });
  ipcMain.handle("studio-monitor-stop", () => { if (mon) { try { mon.stdin.write('{"action":"quit"}\n'); } catch (_) { } const m = mon; setTimeout(() => { try { m.kill(); } catch (_) { } }, 800); mon = null; } return true; });
  app.on("before-quit", () => { if (mon) try { mon.kill(); } catch (_) { } });
};
module.exports.sf2Presets = sf2Presets;
