/* Central Usage - a local certificate authority and a server certificate for the phone-camera page.
 * Phones only give a web page their camera over HTTPS. A certificate from the internet can't name a computer on the
 * church Wi-Fi, so this computer makes its own: a small CA (installed once on a phone, it removes the warning) and a
 * server certificate signed by it for this computer's names and addresses. Written with node:crypto alone
 * (EC P-256, ECDSA-SHA256). */
"use strict";
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// ---- DER
function len(n) { if (n < 128) return Buffer.from([n]); const b = []; while (n > 0) { b.unshift(n & 255); n >>= 8; } return Buffer.from([0x80 | b.length, ...b]); }
function tlv(tag, body) { body = Buffer.isBuffer(body) ? body : Buffer.from(body); return Buffer.concat([Buffer.from([tag]), len(body.length), body]); }
const seq = (...items) => tlv(0x30, Buffer.concat(items));
const set = (...items) => tlv(0x31, Buffer.concat(items));
function int(buf) { if (typeof buf === "number") { const b = []; let n = buf; do { b.unshift(n & 255); n >>= 8; } while (n > 0); buf = Buffer.from(b); } if (buf[0] & 0x80) buf = Buffer.concat([Buffer.from([0]), buf]); return tlv(0x02, buf); }
function oid(s) {
  const p = s.split(".").map(Number), out = [40 * p[0] + p[1]];
  for (let i = 2; i < p.length; i++) { let v = p[i]; const st = [v & 127]; v >>= 7; while (v > 0) { st.unshift(0x80 | (v & 127)); v >>= 7; } out.push(...st); }
  return tlv(0x06, Buffer.from(out));
}
const utf8 = (s) => tlv(0x0c, Buffer.from(s, "utf8"));
const bits = (buf) => tlv(0x03, Buffer.concat([Buffer.from([0]), buf]));
const octets = (buf) => tlv(0x04, buf);
const bool = (v) => tlv(0x01, Buffer.from([v ? 0xff : 0]));
const ctx = (n, body, constructed = true) => tlv((constructed ? 0xa0 : 0x80) | n, body);
function time(d) {   // UTCTime until 2049, GeneralizedTime after
  const p = (n, w = 2) => String(n).padStart(w, "0"), y = d.getUTCFullYear();
  const s = p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + "Z";
  return y < 2050 ? tlv(0x17, Buffer.from(p(y % 100) + s)) : tlv(0x18, Buffer.from(p(y, 4) + s));
}
const OID = { cn: "2.5.4.3", o: "2.5.4.10", ecdsaSha256: "1.2.840.10045.4.3.2", basic: "2.5.29.19", keyUsage: "2.5.29.15", eku: "2.5.29.37", serverAuth: "1.3.6.1.5.5.7.3.1", san: "2.5.29.17", ski: "2.5.29.14", aki: "2.5.29.35" };
const name = (cn) => seq(set(seq(oid(OID.o), utf8("Central Usage"))), set(seq(oid(OID.cn), utf8(cn))));
const ext = (id, critical, value) => seq(oid(id), ...(critical ? [bool(true)] : []), octets(value));
// read back: the children of a DER SEQUENCE (to take the CA's own subject as the issuer, byte for byte)
function children(buf) {
  const out = []; let i = 0;
  while (i < buf.length) {
    const start = i; i++; let n = buf[i++];
    if (n & 0x80) { const k = n & 127; n = 0; for (let j = 0; j < k; j++) n = n * 256 + buf[i++]; }
    out.push({ tag: buf[start], all: buf.subarray(start, i + n), body: buf.subarray(i, i + n) }); i += n;
  }
  return out;
}
function subjectOf(certDer) { const tbs = children(children(certDer)[0].body)[0].body, f = children(tbs); return f[f[0].tag === 0xa0 ? 5 : 4].all; }
function keyId(spki) { return crypto.createHash("sha1").update(spki).digest(); }

function certificate({ subject, issuer, spki, signKey, days, ca, sans, issuerSpki }) {
  const now = new Date(Date.now() - 3600e3), until = new Date(now.getTime() + days * 86400e3);
  const serial = crypto.randomBytes(16); serial[0] &= 0x7f;
  const exts = [
    ext(OID.basic, true, ca ? seq(bool(true)) : seq()),
    ext(OID.keyUsage, true, bits(Buffer.from([ca ? 0x06 : 0x80]))),   // CA: keyCertSign + cRLSign; server: digitalSignature
    ext(OID.ski, false, octets(keyId(spki)))
  ];
  if (issuerSpki) exts.push(ext(OID.aki, false, seq(ctx(0, keyId(issuerSpki), false))));
  if (!ca) {
    exts.push(ext(OID.eku, false, seq(oid(OID.serverAuth))));
    exts.push(ext(OID.san, false, seq(...sans.map((s) => /^[\d.]+$/.test(s) ? ctx(7, Buffer.from(s.split(".").map(Number)), false) : ctx(2, Buffer.from(s), false)))));
  }
  const tbs = seq(ctx(0, int(2)), int(serial), seq(oid(OID.ecdsaSha256)), issuer, seq(time(now), time(until)), subject, spki, ctx(3, seq(...exts)));
  const sig = crypto.sign("sha256", tbs, signKey);   // DER ECDSA signature
  return seq(tbs, seq(oid(OID.ecdsaSha256)), bits(sig));
}
const pem = (der, label) => "-----BEGIN " + label + "-----\n" + der.toString("base64").match(/.{1,64}/g).join("\n") + "\n-----END " + label + "-----\n";

function addresses() {
  const out = new Set(["127.0.0.1"]);
  for (const list of Object.values(os.networkInterfaces())) for (const n of list || []) if (n.family === "IPv4" || n.family === 4) out.add(n.address);
  return [...out].sort();
}

/* The CA is made once and kept (so a phone that trusts it keeps trusting it); the server certificate is made again
 * when this computer's addresses or name change, or it is close to expiring. */
function ensure(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const f = (n) => path.join(dir, n);
  let caKey, caCert;
  try { caKey = crypto.createPrivateKey(fs.readFileSync(f("ca-key.pem"))); caCert = fs.readFileSync(f("ca.crt")); } catch (_) { caKey = null; }
  if (!caKey) {
    const kp = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const spki = kp.publicKey.export({ type: "spki", format: "der" }), nm = name("Central Usage local CA (" + os.hostname() + ")");
    caCert = Buffer.from(pem(certificate({ subject: nm, issuer: nm, spki, signKey: kp.privateKey, days: 3650, ca: true }), "CERTIFICATE"));
    fs.writeFileSync(f("ca-key.pem"), kp.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    fs.writeFileSync(f("ca.crt"), caCert); caKey = kp.privateKey;
    try { fs.unlinkSync(f("server.json")); } catch (_) { }
  }
  const host = os.hostname().replace(/\.local$/, ""), sans = [...new Set([host, host + ".local", "localhost"])].concat(addresses());
  let meta = null; try { meta = JSON.parse(fs.readFileSync(f("server.json"), "utf8")); } catch (_) { }
  const fresh = meta && meta.sans && meta.sans.join(",") === sans.join(",") && meta.until > Date.now() + 30 * 86400e3 && fs.existsSync(f("server.crt")) && fs.existsSync(f("server-key.pem"));
  if (!fresh) {
    const caX = new crypto.X509Certificate(caCert), caSpki = caX.publicKey.export({ type: "spki", format: "der" });
    const kp = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" }), spki = kp.publicKey.export({ type: "spki", format: "der" });
    const issuer = subjectOf(caX.raw);
    const der = certificate({ subject: name(host + ".local"), issuer, spki, signKey: caKey, days: 397, ca: false, sans, issuerSpki: caSpki });
    fs.writeFileSync(f("server.crt"), pem(der, "CERTIFICATE")); fs.writeFileSync(f("server-key.pem"), kp.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    fs.writeFileSync(f("server.json"), JSON.stringify({ sans, until: Date.now() + 397 * 86400e3 }));
  }
  return { key: fs.readFileSync(f("server-key.pem")), cert: Buffer.concat([fs.readFileSync(f("server.crt")), caCert]), ca: caCert, caFile: f("ca.crt"), sans, addresses: addresses().filter((a) => a !== "127.0.0.1") };
}
module.exports = { ensure, addresses, subjectOf };
