// Central Control / Central Usage on a computer - the sound library installer (libraries.js, 9.8), without Electron:
// a library zip (made here like tools/build-libraries.py makes them) installs into the instrument's sound folders; a
// sha256 mismatch is refused (download and file), a damaged item too; sounds and IRs keep their plan (applyTiers puts it
// on the rig's lists); an update replaces; Remove cleans up; a download is checked as it comes.
//   node test-libraries.mjs
import http from "node:http"; import crypto from "node:crypto"; import fs from "node:fs"; import os from "node:os"; import path from "node:path"; import zlib from "node:zlib"; import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { Libraries, readZip } = require("./libraries.js");
let failures = 0; async function check(label, fn) { try { await fn(); console.log("  ✓ " + label); } catch (e) { failures++; console.error("  ✗ " + label + "\n      " + String(e && e.message || e)); } }
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

// ---- a minimal zip writer (deflate), as tools/build-libraries.py writes them
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (b) => { let c = -1; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function zip(files) {
  const parts = [], cd = []; let off = 0;
  for (const [name, data] of files) {
    const comp = zlib.deflateRawSync(data), nb = Buffer.from(name), h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(8, 8); h.writeUInt32LE(crc32(data), 14); h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(nb.length, 26);
    parts.push(h, nb, comp);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10); c.writeUInt32LE(crc32(data), 16); c.writeUInt32LE(comp.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nb.length, 28); c.writeUInt32LE(off, 42);
    cd.push(c, nb); off += 30 + nb.length + comp.length;
  }
  const cdb = Buffer.concat(cd), e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10); e.writeUInt32LE(cdb.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat(parts.concat([cdb, e]));
}
const sf2 = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("sfbk"), Buffer.alloc(200, 7)]);
const wav = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE"), Buffer.alloc(100, 3)]);
const board = Buffer.from(JSON.stringify({ name: "Pedals: Edge", kind: "electric", chain: [["ir-cab", {}, { ir: "Central 1x12 Open Back" }]] }));
function library(version, { tamper, noSound } = {}) {
  const items = [];
  if (!noSound) items.push({ kind: "sound", name: "Central Keys Pianos", file: "sounds/Central Keys Pianos - central-keys-pianos.sf2", tier: "keys", sha256: sha(sf2), license: "CC0 1.0" });
  items.push({ kind: "ir", name: "Central 1x12 Open Back", file: "irs/Central 1x12 Open Back.wav", tier: "keys", sha256: sha(wav) }, { kind: "board", name: "Pedals: Edge", file: "boards/pedals-edge.json", tier: "keys", sha256: sha(board) });
  const files = [["manifest.json", Buffer.from(JSON.stringify({ format: 1, id: "central-keys-library", plan: "keys", version, title: "Central Keys Library", items }))], ["CREDITS.txt", Buffer.from("credits")]];
  if (!noSound) files.push([items[0].file, tamper ? Buffer.concat([sf2, Buffer.from("!")]) : sf2]);
  files.push(["irs/Central 1x12 Open Back.wav", wav], ["boards/pedals-edge.json", board]);
  return zip(files);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cu-libs-")), sent = [];
const libs = new Libraries({ dir, send: (m) => sent.push(m) });
const sf2Dir = path.join(dir, "instrument", "sounds", "sf2"), irDir = path.join(dir, "instrument", "sounds", "ir");
const write = (name, buf) => { const f = path.join(dir, name); fs.writeFileSync(f, buf); return f; };
try {
  await check("the zip reader reads what the builder writes", async () => { const f = write("t.zip", library("1.0")); const z = readZip(f); assert.ok(z.has("manifest.json") && z.read("irs/Central 1x12 Open Back.wav").equals(wav)); z.close(); });
  const z10 = library("1.0"), f10 = write("central-keys-library-1.0.zip", z10);
  await check("a file that doesn't match the listed sha256 is refused, nothing installed", async () => {
    assert.throws(() => libs.installFile(f10, "0".repeat(64), "file"), /checksum/); assert.deepEqual(libs.listing(), []);
  });
  await check("a library whose sound doesn't match its manifest is refused", async () => {
    assert.throws(() => libs.installFile(write("bad.zip", library("1.0", { tamper: true })), null, "file"), /damaged/); assert.ok(!fs.existsSync(path.join(sf2Dir, "Central Keys Pianos - central-keys-pianos.sf2")));
  });
  await check("not a library: refused with a plain message", async () => { assert.throws(() => libs.installFile(write("x.zip", Buffer.from("hello")), null, "file"), /isn't a library file/); });
  await check("installs: the bank into the rig's SoundFont folder, the IR into its IR folder, the board kept with its plan; the rig rescans", async () => {
    const r = libs.installFile(f10, sha(z10), "file");
    assert.deepEqual(r.counts, { sound: 1, ir: 1, board: 1, preset: 0, click: 0, pad: 0 });
    assert.ok(fs.existsSync(path.join(sf2Dir, "Central Keys Pianos - central-keys-pianos.sf2")) && fs.existsSync(path.join(irDir, "Central 1x12 Open Back.wav")));
    assert.equal(libs.listing()[0].boards[0].tier, "keys"); assert.ok(sent.some((m) => m.action === "rescan"));
  });
  await check("the plans go on the rig's lists (applyTiers): the bank and the IR locked without Central Keys, the musician's own bank untouched", async () => {
    const m = libs.applyTiers({ type: "instrumentStatus", keysCatalog: [{ file: path.join(sf2Dir, "Central Keys Pianos - central-keys-pianos.sf2"), user: true }, { file: path.join(sf2Dir, "Mine.sf2"), user: true }], irs: [{ file: path.join(irDir, "Central 1x12 Open Back.wav") }, { file: path.join(irDir, "mine.wav") }] });
    assert.deepEqual(m.keysCatalog.map((b) => [b.tier || null, b.user]), [["keys", false], [null, true]]); assert.deepEqual(m.irs.map((i) => i.tier || null), ["keys", null]);
  });
  await check("a newer version replaces the older one (what it no longer has goes)", async () => {
    const r = libs.installFile(write("v11.zip", library("1.1", { noSound: true })), null, "file");
    assert.equal(r.version, "1.1"); assert.ok(!fs.existsSync(path.join(sf2Dir, "Central Keys Pianos - central-keys-pianos.sf2")) && !/Central Keys Pianos/.test(fs.readFileSync(path.join(sf2Dir, "tiers.txt"), "utf8")));
  });
  await check("Remove takes every file and plan line away", async () => {
    libs.remove("central-keys-library");
    assert.deepEqual(libs.listing(), []); assert.ok(!fs.existsSync(path.join(irDir, "Central 1x12 Open Back.wav")) && !/central-keys-library/.test(fs.readFileSync(path.join(irDir, "tiers.txt"), "utf8")));
  });
  // downloads (a redirect, as GitHub's release downloads do)
  const srv = http.createServer((req, res) => { if (req.url === "/go") { res.writeHead(302, { Location: "/central-keys-library-1.0.zip" }); return res.end(); } res.writeHead(200, { "Content-Length": z10.length }); res.end(z10); });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const u = "http://127.0.0.1:" + srv.address().port + "/go";
  await check("a download that doesn't match its sha256 is refused (nothing installed, no file left)", async () => {
    await assert.rejects(libs.installUrl(u, "e".repeat(64), "central-keys-library", z10.length), /checksum/);
    assert.deepEqual(libs.listing(), []); assert.deepEqual(fs.readdirSync(path.join(dir, "libraries")).filter((f) => f.endsWith(".zip")), []);
  });
  await check("a library listed without a sha256 (not published yet) isn't downloaded", async () => { await assert.rejects(libs.installUrl(u, null, "central-keys-library"), /published/); });
  await check("a good download (through a redirect) installs, with its progress reported", async () => {
    const prog = []; const r = await libs.installUrl(u, sha(z10), "central-keys-library", z10.length, (p) => prog.push(p.done));
    assert.equal(r.version, "1.0"); assert.equal(r.source, "website"); assert.ok(prog.length && prog[prog.length - 1] === z10.length, prog);
  });
  srv.close();
} finally { fs.rmSync(dir, { recursive: true, force: true }); }
console.log(failures ? "\n" + failures + " FAILED" : "\nALL LIBRARY INSTALLER CHECKS PASSED");
process.exit(failures ? 1 : 0);
