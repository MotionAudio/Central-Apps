// A small zip reader and writer (no dependencies): reads what creators upload (to check it file by file, never
// unpacking to disk) and writes the library zips the apps install (stored, not compressed - audio doesn't shrink).
import zlib from "node:zlib";

const crc32 = zlib.crc32 || ((buf) => {   // (Node 22 has zlib.crc32)
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
});

export class ZipError extends Error { }

// [{ name, size, csize, method, offset, isDir, isLink, external }] from the central directory; throws on a damaged zip
export function listZip(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new ZipError("that isn't a zip file");
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new ZipError("that zip is damaged (no table of contents)");
  const count = buf.readUInt16LE(eocd + 10), cdSize = buf.readUInt32LE(eocd + 12), cdOff = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOff === 0xffffffff) throw new ZipError("zip64 files aren't supported - keep each upload under 4 GB");
  if (cdOff + cdSize > buf.length) throw new ZipError("that zip is damaged (its table of contents is cut off)");
  const out = [];
  let p = cdOff;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new ZipError("that zip is damaged");
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), size = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const madeBy = buf.readUInt16LE(p + 4) >> 8, external = buf.readUInt32LE(p + 38), offset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nlen);
    const mode = madeBy === 3 ? (external >>> 16) & 0xffff : 0;   // (made on Unix: the file's mode)
    out.push({ name, size, csize, method, offset, isDir: name.endsWith("/"), isLink: (mode & 0o170000) === 0o120000, mode });
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

export function readEntry(buf, e) {
  const p = e.offset;
  if (buf.readUInt32LE(p) !== 0x04034b50) throw new ZipError("that zip is damaged");
  const start = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28), raw = buf.subarray(start, start + e.csize);
  if (e.method === 0) return Buffer.from(raw);
  if (e.method === 8) return zlib.inflateRawSync(raw, { maxOutputLength: Math.max(1, e.size) });
  throw new ZipError("that zip uses a packing method we don't read (use a normal zip)");
}

// files: [{ name, data }] -> a zip (stored)
export function writeZip(files) {
  const parts = [], cd = [];
  let off = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8"), data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(f.data), crc = crc32(data);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(0, 8);
    h.writeUInt32LE(0, 10); h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22);
    h.writeUInt16LE(name.length, 26); h.writeUInt16LE(0, 28);
    parts.push(h, name, data);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(0, 10);
    c.writeUInt32LE(0, 12); c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(name.length, 28); c.writeUInt32LE(off, 42);
    cd.push(c, name);
    off += 30 + name.length + data.length;
  }
  const cdBuf = Buffer.concat(cd), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10);
  e.writeUInt32LE(cdBuf.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cdBuf, e]);
}
