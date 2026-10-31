// Creators (10.1): what an upload really is. Every file a creator sends is read and checked here before anyone can
// download it, and turned into the library zip the apps already install (libraries.py on the pedal,
// central-usage/libraries.js on computers) - so a community item installs exactly like a Motion Audio library item.
//   samples / instruments: an .sf2 as it is, or a zip of WAVs (named by note: "Piano C4.wav", "F#3.wav", "60.wav"),
//     or a zip with an .sfz and its WAVs - made into one .sf2 here (kind "sound")
//   loops: WAV files (kind "loop", with bpm / key / bars)       pads: 12 WAVs, one per key (kind "pad")
//   boards (pedals): a pedal board preset, JSON with a chain (kind "board")
//   plugins: a zip per platform holding one plugin bundle (LV2 on Linux / the Pi, VST3 / CLAP / AU on Mac and Windows)
import crypto from "node:crypto";
import path from "node:path";
import { listZip, readEntry, ZipError } from "./zipfile.js";

export class CheckError extends Error { constructor(m) { super(m); this.status = 400; } }
const bad = (m) => new CheckError(m);
export const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");

export const KEYS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT = { DB: "C#", EB: "D#", GB: "F#", AB: "G#", BB: "A#", CB: "B", FB: "E" };
export function keyName(s) {
  const t = String(s || "").trim().toUpperCase().replace("♯", "#").replace("♭", "B");
  if (KEYS.includes(t)) return t;
  if (FLAT[t]) return FLAT[t];
  return null;
}
// "C4" / "f#3" / "Bb2" / "60" -> MIDI note (C4 = 60), or null
export function noteNumber(s) {
  const t = String(s || "").trim();
  if (/^\d{1,3}$/.test(t)) { const n = Number(t); return n >= 0 && n <= 127 ? n : null; }
  const m = /^([A-Ga-g])([#b♯♭]?)(-?\d)$/.exec(t);
  if (!m) return null;
  let k = KEYS.indexOf(m[1].toUpperCase());
  if (m[2] === "#" || m[2] === "♯") k++; else if (m[2] === "b" || m[2] === "♭") k--;
  const n = (Number(m[3]) + 1) * 12 + k;
  return n >= 0 && n <= 127 ? n : null;
}
function noteFromFileName(name) {
  const base = path.basename(name).replace(/\.[^.]+$/, "");
  const parts = base.split(/[\s_\-.]+/).reverse();
  for (const p of parts) { const n = noteNumber(p); if (n != null) return n; }
  return null;
}

// ---------------------------------------------------------------- audio
export function sniffAudio(b) {
  if (!b || b.length < 12) return null;
  const a = b.toString("latin1", 0, 4);
  if (a === "RIFF" && b.toString("latin1", 8, 12) === "WAVE") return "wav";
  if (a === "fLaC") return "flac";
  if (a === "OggS") return "ogg";
  if (a === "FORM" && /AIF[FC]/.test(b.toString("latin1", 8, 12))) return "aiff";
  if (b.toString("latin1", 0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return "mp3";
  return null;
}
// a WAV's facts and its samples as 16-bit mono (for the .sf2), with any loop points from its smpl chunk
export function readWav(b, wantSamples) {
  if (sniffAudio(b) !== "wav") throw bad("that isn't a WAV file");
  let p = 12, fmt = null, data = null, loop = null;
  while (p + 8 <= b.length) {
    const id = b.toString("latin1", p, p + 4), len = b.readUInt32LE(p + 4), body = p + 8;
    if (id === "fmt ") {
      fmt = { tag: b.readUInt16LE(body), ch: b.readUInt16LE(body + 2), rate: b.readUInt32LE(body + 4), bits: b.readUInt16LE(body + 14) };
      if (fmt.tag === 0xfffe && len >= 26) fmt.tag = b.readUInt16LE(body + 24);   // (WAVE_FORMAT_EXTENSIBLE: the real format is in its sub-format)
    }
    else if (id === "data") data = b.subarray(body, Math.min(b.length, body + len));
    else if (id === "smpl" && len >= 60 && b.readUInt32LE(body + 28) > 0) loop = { start: b.readUInt32LE(body + 44), end: b.readUInt32LE(body + 48) };
    p = body + len + (len & 1);
  }
  if (!fmt || !data) throw bad("that WAV file is damaged (no format or no sound in it)");
  if (!((fmt.tag === 1 && [16, 24, 32].includes(fmt.bits)) || (fmt.tag === 3 && fmt.bits === 32))) throw bad("WAV files need to be 16-bit, 24-bit or 32-bit (got " + fmt.bits + "-bit)");
  if (fmt.ch < 1 || fmt.ch > 2) throw bad("WAV files need to be mono or stereo");
  if (fmt.rate < 22050 || fmt.rate > 192000) throw bad("WAV files need a sample rate between 22050 and 192000 Hz");
  const bps = fmt.bits / 8, frames = Math.floor(data.length / (bps * fmt.ch));
  const info = { rate: fmt.rate, channels: fmt.ch, bits: fmt.bits, frames, seconds: frames / fmt.rate, loop };
  if (!wantSamples) return info;
  const mono = new Int16Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let c = 0; c < fmt.ch; c++) {
      const o = (i * fmt.ch + c) * bps;
      s += fmt.tag === 3 ? data.readFloatLE(o) : bps === 2 ? data.readInt16LE(o) / 32768 : bps === 3 ? data.readIntLE(o, 3) / 8388608 : data.readInt32LE(o) / 2147483648;
    }
    mono[i] = Math.max(-32768, Math.min(32767, Math.round((s / fmt.ch) * 32767)));
  }
  return Object.assign(info, { samples: mono });
}

// ---------------------------------------------------------------- .sf2 writer
function chunk(id, body) { const h = Buffer.alloc(8); h.write(id, 0, "latin1"); h.writeUInt32LE(body.length, 4); return Buffer.concat([h, body, body.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]); }
function list(type, kids) { return chunk("LIST", Buffer.concat([Buffer.from(type, "latin1"), ...kids])); }
function zstr(s, n) { const b = Buffer.alloc(n); b.write(String(s).replace(/[^\x20-\x7e]/g, "").slice(0, n - 1), 0, "latin1"); return b; }
// zones: [{ name, samples: Int16Array, rate, root, lo, hi, vlo, vhi, loop }] -> an .sf2 with one preset
export function makeSf2(presetName, zones) {
  if (!zones.length) throw bad("there's no sound to make the instrument from");
  const smplParts = [], shdr = [];
  let at = 0;
  zones.forEach((z, i) => {
    const pcm = Buffer.from(z.samples.buffer, z.samples.byteOffset, z.samples.byteLength);
    smplParts.push(pcm, Buffer.alloc(92));   // (46 zero samples after each, as the format asks)
    const start = at, end = at + z.samples.length;
    const ls = z.loop && z.loop.end > z.loop.start && z.loop.end <= z.samples.length ? start + z.loop.start : start, le = z.loop && z.loop.end > z.loop.start && z.loop.end <= z.samples.length ? start + z.loop.end : end;
    const h = Buffer.alloc(46); zstr(z.name || "s" + i, 20).copy(h, 0);
    h.writeUInt32LE(start, 20); h.writeUInt32LE(end, 24); h.writeUInt32LE(ls, 28); h.writeUInt32LE(le, 32); h.writeUInt32LE(z.rate, 36);
    h.writeUInt8(z.root & 127, 40); h.writeInt8(0, 41); h.writeUInt16LE(0, 42); h.writeUInt16LE(1, 44);   // (mono)
    shdr.push(h);
    at = end + 46;
  });
  const eos = Buffer.alloc(46); zstr("EOS", 20).copy(eos, 0); shdr.push(eos);
  // generators: 43 keyRange, 44 velRange, 54 sampleModes, 58 overridingRootKey, 53 sampleID; 41 instrument
  const igen = [], ibag = [];
  const gen = (op, a) => { const g = Buffer.alloc(4); g.writeUInt16LE(op, 0); if (Array.isArray(a)) { g.writeUInt8(a[0], 2); g.writeUInt8(a[1], 3); } else g.writeUInt16LE(a & 0xffff, 2); return g; };
  zones.forEach((z, i) => {
    const b = Buffer.alloc(4); b.writeUInt16LE(igen.length, 0); b.writeUInt16LE(0, 2); ibag.push(b);
    igen.push(gen(43, [z.lo, z.hi]), gen(44, [z.vlo == null ? 0 : z.vlo, z.vhi == null ? 127 : z.vhi]), gen(58, z.root & 127), gen(54, z.loop ? 1 : 0), gen(53, i));
  });
  { const b = Buffer.alloc(4); b.writeUInt16LE(igen.length, 0); ibag.push(b); }
  const inst = Buffer.alloc(44); zstr(presetName, 20).copy(inst, 0); inst.writeUInt16LE(0, 20); zstr("EOI", 20).copy(inst, 22); inst.writeUInt16LE(zones.length, 42);
  const pbag = Buffer.alloc(8); pbag.writeUInt16LE(0, 0); pbag.writeUInt16LE(1, 4);
  const pgen = Buffer.concat([gen(41, 0), Buffer.alloc(4)]);
  const phdr = Buffer.alloc(76); zstr(presetName, 20).copy(phdr, 0); zstr("EOP", 20).copy(phdr, 38); phdr.writeUInt16LE(1, 38 + 24);
  const info = list("INFO", [chunk("ifil", Buffer.from([2, 0, 1, 0])), chunk("isng", zstr("EMU8000", 8)), chunk("INAM", zstr(presetName, 64))]);
  const sdta = list("sdta", [chunk("smpl", Buffer.concat(smplParts))]);
  const pdta = list("pdta", [chunk("phdr", phdr), chunk("pbag", pbag), chunk("pmod", Buffer.alloc(10)), chunk("pgen", pgen),
    chunk("inst", inst), chunk("ibag", Buffer.concat(ibag)), chunk("imod", Buffer.alloc(10)), chunk("igen", Buffer.concat([...igen, Buffer.alloc(4)])), chunk("shdr", Buffer.concat(shdr))]);
  return chunk("RIFF", Buffer.concat([Buffer.from("sfbk", "latin1"), info, sdta, pdta]));
}

// ---------------------------------------------------------------- .sfz (the regions we need)
export function parseSfz(text) {
  const regions = [];
  let control = {}, global = {}, group = {}, cur = null, section = "";
  const clean = String(text).replace(/\/\/[^\n]*/g, "");
  const tokens = clean.split(/(<[a-z_]+>)/);
  for (const t of tokens) {
    const h = /^<([a-z_]+)>$/.exec(t);
    if (h) {
      section = h[1];
      if (section === "region") { cur = Object.assign({}, global, group); regions.push(cur); }
      else if (section === "group" || section === "master") { group = {}; cur = group; }
      else if (section === "global") { global = {}; cur = global; }
      else if (section === "control") { control = {}; cur = control; }
      else cur = null;
      continue;
    }
    if (!cur) continue;
    // key=value pairs; sample= may hold spaces up to the next opcode
    const re = /([a-z_0-9]+)=((?:(?![a-z_0-9]+=).)*)/g;
    let m; while ((m = re.exec(t.replace(/\s+/g, " ")))) cur[m[1]] = m[2].trim();
  }
  return regions.map((r) => Object.assign({ default_path: control.default_path || "" }, r));
}

// zip entries of plain files (no folders), refusing anything unsafe
function zipFiles(buf, maxTotal) {
  let entries;
  try { entries = listZip(buf); } catch (e) { throw bad(e instanceof ZipError ? e.message : "that isn't a zip file"); }
  let total = 0;
  for (const e of entries) {
    if (e.isLink) throw bad("that zip holds a link (" + e.name + ") - zip the real files instead");
    if (/^\/|(^|\/)\.\.(\/|$)|\\/.test(e.name)) throw bad("that zip has a file outside its own folder (" + e.name + ")");
    total += e.size;
  }
  if (total > maxTotal) throw bad("that zip is too big once unpacked");
  return entries.filter((e) => !e.isDir && !/(^|\/)(__MACOSX|\.DS_Store|Thumbs\.db)/.test(e.name));
}

// ---------------------------------------------------------------- the kinds
export const KINDS = {
  sample: { name: "Samples", packs: ["keys", "instrument"], what: "an .sf2, or a zip of WAVs named by note (C4.wav), or a zip with an .sfz", max: 1024 ** 3 },
  instrument: { name: "Instrument", packs: ["keys", "instrument"], what: "an .sf2, or a zip of WAVs named by note (C4.wav), or a zip with an .sfz", max: 1024 ** 3 },
  loop: { name: "Loops", packs: ["pads"], what: "WAV files, or a zip of WAVs", max: 500 * 1024 ** 2 },
  pad: { name: "Pad", packs: ["pads"], what: "a zip of 12 WAV loops, one per key, named by key (C.wav, C#.wav ... B.wav)", max: 800 * 1024 ** 2 },
  board: { name: "Pedal board", packs: ["pedals"], what: "a pedal board preset (.json) exported from the pedal board", max: 1024 ** 2 },
  plugin: { name: "Plugin", packs: ["plugins"], what: "a zip per platform with one plugin bundle", max: 300 * 1024 ** 2 },
};
export const PLATFORMS = { "linux-x64": "Linux (64-bit PC)", "linux-arm64": "Central Pedal (Raspberry Pi) / Linux ARM", mac: "Mac", "win-x64": "Windows (64-bit)" };

function check(list, ok, text) { list.push({ ok: !!ok, text }); return !!ok; }

// a sound (sample / instrument) -> { sf2, checks, presetName }
export function buildSound(fileName, buf, title) {
  const checks = [], ext = path.extname(fileName).toLowerCase();
  if (ext === ".sf2" || ext === ".sf3") {
    if (!(buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "sfbk")) throw bad("that isn't a SoundFont (.sf2) file");
    check(checks, true, "A SoundFont (" + Math.round(buf.length / 1e6) + " MB)");
    return { sf2: buf, checks };
  }
  if (ext !== ".zip") throw bad("upload " + KINDS.instrument.what);
  const files = zipFiles(buf, 1.5 * 1024 ** 3), byName = new Map(files.map((e) => [e.name.toLowerCase(), e]));
  const sfz = files.find((e) => /\.sfz$/i.test(e.name));
  const zones = [];
  if (sfz) {
    const regions = parseSfz(readEntry(buf, sfz).toString("utf8")), dir = path.posix.dirname(sfz.name);
    for (const r of regions.slice(0, 512)) {
      if (!r.sample) continue;
      const rel = path.posix.normalize(path.posix.join(dir === "." ? "" : dir, (r.default_path || "").replace(/\\/g, "/"), r.sample.replace(/\\/g, "/")));
      const e = byName.get(rel.toLowerCase());
      if (!e) throw bad("the .sfz uses " + r.sample + ", which isn't in the zip");
      if (!/\.wav$/i.test(e.name)) throw bad("only WAV samples can be used (" + r.sample + ")");
      const w = readWav(readEntry(buf, e), true);
      const key = r.key != null ? noteNumber(r.key) : null, root = noteNumber(r.pitch_keycenter) ?? key ?? noteFromFileName(e.name) ?? 60;
      zones.push({ name: path.basename(e.name), samples: w.samples, rate: w.rate, root, lo: noteNumber(r.lokey) ?? key ?? root, hi: noteNumber(r.hikey) ?? key ?? root,
        vlo: Number(r.lovel) || 0, vhi: r.hivel != null ? Number(r.hivel) : 127, loop: r.loop_mode && /loop/.test(r.loop_mode) && r.loop_start ? { start: Number(r.loop_start), end: Number(r.loop_end) } : w.loop });
    }
    check(checks, zones.length, "An .sfz with " + zones.length + " samples");
  } else {
    const wavs = files.filter((e) => /\.wav$/i.test(e.name));
    if (!wavs.length) throw bad("that zip has no WAV files (or an .sfz) in it");
    const named = wavs.map((e) => ({ e, root: noteFromFileName(e.name) }));
    const unnamed = named.filter((x) => x.root == null);
    if (unnamed.length && unnamed.length !== named.length) throw bad(unnamed[0].e.name + " isn't named by its note (like C4.wav) - name every file by note, or none (then they're laid out from C2 up)");
    if (unnamed.length) named.forEach((x, i) => { x.root = Math.min(127, 36 + i); });   // (one-shots: one key each, from C2 up)
    named.sort((a, b) => a.root - b.root);
    named.forEach((x, i) => {
      const w = readWav(readEntry(buf, x.e), true), prev = named[i - 1], next = named[i + 1];
      const lo = unnamed.length ? x.root : prev ? Math.floor((prev.root + x.root) / 2) + 1 : 0, hi = unnamed.length ? x.root : next ? Math.floor((x.root + next.root) / 2) : 127;
      zones.push({ name: path.basename(x.e.name), samples: w.samples, rate: w.rate, root: x.root, lo, hi, loop: w.loop });
    });
    check(checks, true, zones.length + " WAV samples, " + (unnamed.length ? "one key each from C2 up" : "spread across the keyboard by their notes"));
  }
  const total = zones.reduce((a, z) => a + z.samples.length, 0);
  if (!check(checks, total > 0, "Has sound in it")) throw bad("those samples are empty");
  return { sf2: makeSf2(title || "Community sound", zones), checks };
}

// loops: [{ name, data(WAV), bpm, key, bars }]
export function buildLoops(files, meta) {
  const checks = [], out = [];
  for (const f of files) {
    if (path.extname(f.name).toLowerCase() === ".zip") {
      for (const e of zipFiles(f.data, 800 * 1024 ** 2)) if (/\.wav$/i.test(e.name)) out.push({ name: path.basename(e.name), data: readEntry(f.data, e) });
    } else out.push({ name: f.name, data: f.data });
  }
  if (!out.length) throw bad("upload WAV loops");
  for (const l of out) {
    const w = readWav(l.data, false);
    if (w.seconds < 0.5 || w.seconds > 120) throw bad(l.name + " is " + w.seconds.toFixed(1) + " s long - a loop is between half a second and two minutes");
    l.seconds = Math.round(w.seconds * 100) / 100;
  }
  check(checks, true, out.length + " WAV loop" + (out.length === 1 ? "" : "s") + (meta.bpm ? " at " + meta.bpm + " BPM" : "") + (meta.key ? " in " + meta.key : ""));
  return { loops: out, checks };
}

// a pad: 12 WAVs, one per key
export function buildPad(fileName, buf) {
  const checks = [];
  if (path.extname(fileName).toLowerCase() !== ".zip") throw bad("a pad is " + KINDS.pad.what);
  const byKey = {};
  for (const e of zipFiles(buf, 1.5 * 1024 ** 3)) {
    if (!/\.wav$/i.test(e.name)) continue;
    const base = path.basename(e.name).replace(/\.wav$/i, "").split(/[\s_\-.]+/).reverse();
    const k = base.map((p) => keyName(p.replace(/s$/i, "#"))).find(Boolean);
    if (k) byKey[k] = { name: path.basename(e.name), data: readEntry(buf, e) };
  }
  const missing = KEYS.filter((k) => !byKey[k]);
  if (missing.length) throw bad("a pad needs all 12 keys - missing " + missing.join(", ") + " (name each WAV by its key: C.wav, C#.wav ... B.wav)");
  for (const k of KEYS) { const w = readWav(byKey[k].data, false); if (w.seconds < 4) throw bad(byKey[k].name + " is only " + w.seconds.toFixed(1) + " s - a pad loop should be at least 4 seconds"); }
  check(checks, true, "All 12 keys, each a WAV loop");
  return { keys: byKey, checks };
}

// a pedal board preset
export function buildBoard(buf) {
  let b; try { b = JSON.parse(buf.toString("utf8")); } catch { throw bad("that board isn't readable JSON - export it again from the pedal board"); }
  if (!b || typeof b !== "object" || Array.isArray(b) || !Array.isArray(b.chain) || !b.chain.length) throw bad("a board is a pedal board preset with its pedals (a \"chain\")");
  if (b.chain.length > 24) throw bad("a board can have up to 24 pedals");
  return { board: { name: String(b.name || "Board").slice(0, 60), kind: b.kind || null, chain: b.chain, sound: typeof b.sound === "string" ? b.sound : null }, checks: [{ ok: true, text: "A board with " + b.chain.length + " pedals" }] };
}

// ---------------------------------------------------------------- plugins
const ELF_MACHINE = { "linux-x64": 62, "linux-arm64": 183 };
function binKind(b) {
  if (!b || b.length < 64) return null;
  if (b.readUInt32BE(0) === 0x7f454c46) return { type: "elf", machine: b.readUInt16LE(18), cls: b[4] };
  const m = b.readUInt32BE(0);
  if ([0xfeedfacf, 0xcffaedfe, 0xfeedface, 0xcefaedfe].includes(m)) return { type: "macho" };
  if (m === 0xcafebabe || m === 0xbebafeca) return { type: "macho-fat" };
  if (b.toString("latin1", 0, 2) === "MZ") { const pe = b.readUInt32LE(0x3c); if (pe + 6 < b.length && b.readUInt32LE(pe) === 0x00004550) return { type: "pe", machine: b.readUInt16LE(pe + 4) }; return { type: "pe?" }; }
  return null;
}
const SCRIPT_EXT = /\.(sh|bash|zsh|command|py|pl|rb|js|bat|cmd|ps1|vbs|scr|exe|msi|app|pkg|dmg|jar|desktop|service|plist)$/i;

// one platform's zip -> { checks, bundle, format, binaries: [{ name, sha256 }] }; blocked: Set of banned sha256
export function checkPlugin(platform, fileName, buf, blocked) {
  const checks = [];
  if (!PLATFORMS[platform]) throw bad("unknown platform " + platform);
  if (buf.length > KINDS.plugin.max) throw bad("a plugin zip can be up to " + Math.round(KINDS.plugin.max / 1024 ** 2) + " MB");
  if (path.extname(fileName).toLowerCase() !== ".zip") throw bad("upload each platform's plugin as a zip");
  check(checks, true, "Size: " + (buf.length / 1e6).toFixed(1) + " MB (limit " + Math.round(KINDS.plugin.max / 1024 ** 2) + " MB)");
  const whole = sha256(buf);
  if (blocked && blocked.has(whole)) throw bad("this file is on our list of known harmful files");
  const files = zipFiles(buf, 1024 ** 3);
  check(checks, true, "No links and nothing outside its own folder");
  // the bundle: the top folder ending .lv2 / .vst3 / .clap / .component
  const tops = new Set(files.map((e) => e.name.split("/")[0]));
  const bundles = [...tops].filter((t) => /\.(lv2|vst3|clap|component)$/i.test(t));
  if (bundles.length !== 1) throw bad("the zip must hold exactly one plugin bundle (a folder ending .lv2, .vst3, .clap or .component) and nothing else");
  const bundle = bundles[0], format = bundle.split(".").pop().toLowerCase();
  const allowed = { "linux-x64": ["lv2", "vst3", "clap"], "linux-arm64": ["lv2"], mac: ["vst3", "clap", "component"], "win-x64": ["vst3", "clap"] }[platform];
  if (!allowed.includes(format)) throw bad("a ." + format + " plugin can't be used on " + PLATFORMS[platform] + " (there: " + allowed.map((x) => "." + x).join(", ") + ")");
  if ([...tops].some((t) => t !== bundle)) throw bad("the zip has other files next to the plugin (" + [...tops].filter((t) => t !== bundle)[0] + ") - zip just the plugin bundle");
  check(checks, true, "One " + format.toUpperCase() + " bundle: " + bundle);
  const binaries = [];
  let ttl = false;
  for (const e of files) {
    if (SCRIPT_EXT.test(e.name)) throw bad("the plugin holds a program or script that isn't the plugin (" + e.name + ") - that isn't allowed");
    if (/manifest\.ttl$/i.test(e.name)) ttl = true;
    const data = readEntry(buf, e), k = binKind(data.subarray(0, 4096));
    if (!k) continue;
    const h = sha256(data);
    if (blocked && blocked.has(h)) throw bad(e.name + " is on our list of known harmful files");
    if (platform.startsWith("linux")) {
      if (k.type !== "elf") throw bad(e.name + " isn't a Linux program file");
      if (k.machine !== ELF_MACHINE[platform]) throw bad(e.name + " is built for the wrong processor for " + PLATFORMS[platform]);
      if (!/\.so(\.\d+)*$/i.test(e.name)) throw bad(e.name + " is a program, not a plugin library (.so)");
    } else if (platform === "mac") {
      if (!/^macho/.test(k.type)) throw bad(e.name + " isn't a Mac program file");
      if (!/\/Contents\/MacOS\/[^/]+$/.test(e.name)) throw bad(e.name + " is a program file outside the bundle's Contents/MacOS folder");
    } else if (platform === "win-x64") {
      if (k.type !== "pe" || k.machine !== 0x8664) throw bad(e.name + " isn't a 64-bit Windows plugin file");
      if (!/\.(vst3|clap|dll)$/i.test(e.name)) throw bad(e.name + " is a program, not a plugin library");
    }
    binaries.push({ name: e.name, sha256: h, bytes: data.length });
  }
  if (format === "lv2" && !check(checks, ttl, "Has its manifest.ttl")) throw bad("an LV2 bundle needs its manifest.ttl");
  if (!check(checks, binaries.length > 0 && binaries.length <= 8, binaries.length + " plugin library file" + (binaries.length === 1 ? "" : "s") + " for the right processor")) throw bad("the bundle has no plugin library for " + PLATFORMS[platform]);
  check(checks, true, "Not on our list of known harmful files");
  return { checks, bundle, format, binaries, sha256: whole };
}
