// Rev E: the pedals' own numbers (server/src/pedals.js) through the API, with a pretend chip (a P-256 key made here):
// registering (the chip's signature checked; a code and a ticket; the same again for the same key), approving by the
// code (the owner only), the certificate (the website's signature, checked with the key it hands out), another chip
// with the same serial refused, and updates only for an approved pedal whose chip signs a fresh one-use challenge:
// the build marked to ship (a .deb, newer), its SHA-256 and a link that gives the same file; updates off; removing.
//   node test/reve-pedals.mjs postgres://.../ma [port]
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const db = process.argv[2] || "postgres://postgres@127.0.0.1:55432/ma", port = Number(process.argv[3] || 18943), base = "http://127.0.0.1:" + port;
const S = Date.now(), V = "1." + (S % 1000000), OWNER = "owner" + S + "@motion.test", STAFF = "staff" + S + "@motion.test";
const mails = [];
const stub = http.createServer((req, res) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => { mails.push(JSON.parse(b || "{}")); res.end('{"id":"x"}'); }); });
await new Promise((r) => stub.listen(0, "127.0.0.1", r));
const srv = spawn(process.execPath, [path.join(here, "..", "src", "index.js")], { env: Object.assign({}, process.env, { DATABASE_URL: db, PORT: String(port), STRIPE_SECRET_KEY: "", RESEND_API_KEY: "re_test", MAIL_FROM: "M <t@motion.test>",
  RESEND_API_URL: "http://127.0.0.1:" + stub.address().port + "/emails", PUBLIC_URL: base, ADMIN_EMAILS: STAFF, OWNER_EMAILS: OWNER, REMINDERS: "off", STATUS_CHECKS: "off", CC_UPDATE_API: "http://127.0.0.1:9", R2_ENDPOINT: "" }), stdio: ["ignore", "pipe", "pipe"] });
let log = ""; srv.stdout.on("data", (d) => (log += d)); srv.stderr.on("data", (d) => (log += d));
for (let i = 0; i < 150 && !/Motion Audio server on/.test(log); i++) await new Promise((r) => setTimeout(r, 100));
// (a fresh start: the builds left by an earlier run would change which build ships)
const sql = async (text, params) => { const c = new pg.Client({ connectionString: db }); await c.connect(); try { return (await c.query(text, params)).rows; } finally { await c.end(); } };
await sql("DELETE FROM builds").catch(() => { });
let fails = 0;
const ok = (c, m, d) => { console.log((c ? "  ✓ " : "  ✗ ") + m + (c || d === undefined ? "" : "   -- " + JSON.stringify(d).slice(0, 400))); if (!c) fails++; };
const j = async (method, p, body, tok) => { const r = await fetch(base + "/v1" + p, { method, headers: Object.assign({ "Content-Type": "application/json" }, tok ? { Authorization: "Bearer " + tok } : {}), body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const waitMail = async (who, re) => { for (let i = 0; i < 50; i++) { const m = mails.filter((x) => x.to && x.to[0] === who && (!re || re.test(x.subject))).pop(); if (m) return m; await new Promise((r) => setTimeout(r, 100)); } return null; };
const codeIn = (m) => (m && (m.subject.match(/(\d{6})/) || m.text.match(/(\d{6})/)) || [])[1];
async function token(email, n) {
  // sign up, confirm the email (the owner's tools need it), then sign in with the codes: password, the phone, the codes
  const pw = "pass-" + S + "-" + n;
  await j("POST", "/signup", { email, password: pw, name: n === 1 ? "Sam" : "Pat", device: "t" });
  const conf = await waitMail(email, /Confirm your email/), t = String((conf && conf.text) || "").match(/#confirm-([A-Za-z0-9_-]+)/);
  if (t) await j("POST", "/account/confirm", { token: t[1] });
  const before = mails.length;
  let st = (await j("POST", "/login", { email, password: pw, device: "t2" })).body;
  if (st.token && !st.step) return st.token;
  if (st.step === "phone") st = (await j("POST", "/login/phone", { ticket: st.ticket, phone: "555-01" + n + "-" + String(S).slice(-4) })).body;
  for (let i = 0; i < 50 && !mails.slice(before).some((x) => x.to && x.to[0] === email && /code/i.test(x.subject)); i++) await new Promise((r) => setTimeout(r, 100));
  const codes = mails.slice(before).filter((x) => x.to && x.to[0] === email && /code/i.test(x.subject)).map(codeIn);
  const r = (await j("POST", "/login/code", { ticket: st.ticket, code: codes[0], emailCode: codes[codes.length - 1], device: "t2" })).body;
  return r.token;
}
const blob = (n, seed) => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = (i * 31 + seed) & 255; return b; };
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const put = (url, b) => fetch(url, { method: "PUT", body: b, headers: { "Content-Type": "application/octet-stream" } });


// the pretend chip: its own key, signing SHA-256 of a message (R then S), like the ATECC608B
function chip() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jw = publicKey.export({ format: "jwk" });
  const pub = Buffer.concat([Buffer.from(jw.x, "base64url"), Buffer.from(jw.y, "base64url")]).toString("hex");
  return { pub, sign: (m) => crypto.sign("sha256", Buffer.from(m), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("hex") };
}
const keyOf = (hex) => { const b = Buffer.from(hex, "hex"); return crypto.createPublicKey({ key: { kty: "EC", crv: "P-256", x: b.subarray(0, 32).toString("base64url"), y: b.subarray(32).toString("base64url") }, format: "jwk" }); };
const serial = crypto.randomBytes(9).toString("hex");
const reg = (c, s = serial, extra = {}) => j("POST", "/pedals/register", Object.assign({ serial: s, publicKey: c.pub, signature: c.sign("central-pedal-register|" + s + "|" + c.pub), version: "10.7.0" }, extra));

try {
  const owner = await token(OWNER, 1), staff = await token(STAFF, 2);
  ok(!!owner && !!staff, "the owner and a staff member signed in");
  const A = chip();
  // ---- registering
  ok((await reg(A, serial, { signature: A.sign("something else") })).status === 403, "a signature over anything else is refused");
  ok((await reg(A, "not-a-serial")).status === 400 && (await reg(A, serial, { publicKey: "00".repeat(64) })).status >= 400, "a bad serial or key is refused");
  const Z = chip(), sz = crypto.randomBytes(9).toString("hex");
  const rz = await reg(Z, sz, { code: "CP-00001", pass: "p".repeat(24) });
  ok(rz.status === 200 && rz.body.status === "pending", "a code and pass with no code list on the website: the usual approval by hand", rz.body);
  await sql("DELETE FROM pedals WHERE serial=$1", [sz]);
  const r1 = await reg(A);
  ok(r1.status === 200 && r1.body.status === "pending" && /^[A-Z2-9]{3}-[A-Z2-9]{4}$/.test(r1.body.code) && r1.body.ticket.length >= 30, "registered: waiting, with a code to approve and a ticket", r1.body);
  const r2 = await reg(A);
  ok(r2.body.ticket === r1.body.ticket && r2.body.code === r1.body.code, "the same chip again: the same code");
  ok((await j("GET", "/pedals/register/" + r1.body.ticket)).body.status === "pending", "asking with the ticket: still waiting");
  ok((await j("GET", "/pedals/register/nope")).status === 404, "an unknown ticket: not found");
  ok((await j("POST", "/pedals/challenge", { serial })).status === 404, "no updates before it's approved");

  // ---- the owner approves it
  ok((await j("GET", "/admin/pedals")).status === 401 && (await j("GET", "/admin/pedals", null, staff)).status === 403, "the pedals list: the owner only");
  const l1 = await j("GET", "/admin/pedals", null, owner);
  const mine = (l1.body.pedals || []).find((p) => p.serial === serial);
  ok(l1.status === 200 && mine && mine.status === "pending" && mine.code === r1.body.code && /^[0-9a-f]{128}$/.test(l1.body.serverKey), "the owner sees it waiting, with its code", l1.body);
  ok(!/PRIVATE|BEGIN/.test(JSON.stringify(l1.body)), "the website's private key is never handed out");
  ok((await j("POST", "/admin/pedals/approve", { code: "AAA-AAAA" }, owner)).status === 404, "a code nobody shows: refused");
  ok((await j("POST", "/admin/pedals/approve", { code: r1.body.code }, staff)).status === 403, "other staff can't approve");
  const ap = await j("POST", "/admin/pedals/approve", { code: r1.body.code.toLowerCase().replace("-", " "), note: "Bench pedal 1" }, owner);
  ok(ap.status === 200 && ap.body.pedal.status === "approved" && ap.body.pedal.note === "Bench pedal 1" && ap.body.pedal.code === null, "approved by its code (any case, any dash)", ap.body);
  const got = await j("GET", "/pedals/register/" + r1.body.ticket);
  const key = (await j("GET", "/pedals/key")).body.serverKey;
  ok(got.body.status === "approved" && got.body.serverKey === key && key === l1.body.serverKey, "the pedal gets its certificate and the website's key", got.body);
  ok(crypto.verify("sha256", Buffer.from("central-pedal-cert-v1|" + serial + "|" + A.pub), { key: keyOf(key), dsaEncoding: "ieee-p1363" }, Buffer.from(got.body.certificate, "hex")),
    "the certificate is the website's signature over the serial and the chip's key");
  const r3 = await reg(A);
  ok(r3.body.status === "approved" && r3.body.certificate === got.body.certificate, "registering again (after a reset): the certificate straight back");
  const B = chip();
  const r4 = await reg(B);
  ok(r4.status === 409 && /another chip/.test(r4.body.error), "another chip claiming the same serial: refused", r4.body);
  ok((await sql("SELECT count(*)::int AS n FROM pedal_signing_key"))[0].n === 1, "one signing key, kept in its own table");

  // ---- a build to ship
  const deb = blob(150000, 5);
  const ver = "99." + (S % 1000) + ".0";
  const nb = await j("POST", "/admin/builds", { kind: "pedal", version: ver, name: "central-pedal_" + ver + "_arm64.deb", size: deb.length, notes: "Faster start-up" }, owner);
  await put(nb.body.uploadUrl, deb);
  await j("POST", "/admin/builds/" + nb.body.build.id + "/done", {}, owner);
  for (let i = 0; i < 50; i++) { const b = (await j("GET", "/admin/builds", null, owner)).body.builds.find((x) => x.id === nb.body.build.id); if (b && b.sha256) break; await new Promise((r) => setTimeout(r, 100)); }

  // ---- updates: a challenge, signed by the chip
  const ch1 = await j("POST", "/pedals/challenge", { serial });
  ok(ch1.status === 200 && /^[0-9a-f]{64}$/.test(ch1.body.nonce), "a challenge for an approved pedal", ch1.body);
  const upd = (nonce, signer, version = "10.7.0") => j("POST", "/pedals/update", { serial, nonce, signature: signer.sign("central-pedal-update|" + nonce + "|" + serial), version });
  const bad1 = await upd(ch1.body.nonce, B);
  ok(bad1.status === 403, "signed by another chip: refused", bad1.body);
  ok((await upd(ch1.body.nonce, A)).status === 400, "a challenge works once, even after a wrong try");
  const ch2 = await j("POST", "/pedals/challenge", { serial });
  const u = await upd(ch2.body.nonce, A);
  ok(u.status === 200 && u.body.update && u.body.update.version === ver && u.body.update.sha256 === sha(deb) && u.body.update.notes === "Faster start-up", "the update: the build to ship, newer, with its SHA-256", u.body);
  const dl = Buffer.from(await (await fetch(u.body.update.url)).arrayBuffer());
  ok(sha(dl) === sha(deb), "its link gives the same file");
  const ch3 = await j("POST", "/pedals/challenge", { serial });
  const same = await upd(ch3.body.nonce, A, ver);
  ok(same.status === 200 && same.body.upToDate === true && !same.body.update, "already on that version: up to date", same.body);
  const seen = (await j("GET", "/admin/pedals", null, owner)).body.pedals.find((p) => p.serial === serial);
  ok(seen.version === ver && seen.lastSeen, "the owner sees the version it last checked with", seen);
  // ---- a challenge left too long
  const ch4 = await j("POST", "/pedals/challenge", { serial });
  await sql("UPDATE pedals SET challenge_at = now() - interval '6 minutes' WHERE serial=$1", [serial]);
  ok((await upd(ch4.body.nonce, A)).status === 400, "a challenge older than 5 minutes: refused");
  // ---- updates off for this pedal
  await j("POST", "/admin/pedals/" + mine.id, { updates: false }, owner);
  const ch5 = await j("POST", "/pedals/challenge", { serial });
  const off = await upd(ch5.body.nonce, A);
  ok(off.status === 403 && /off for this pedal/.test(off.body.error), "updates turned off for this pedal", off.body);
  await j("POST", "/admin/pedals/" + mine.id, { updates: true }, owner);
  // ---- a waiting pedal nobody approved goes after a week
  const C = chip(), s2 = crypto.randomBytes(9).toString("hex");
  await reg(C, s2);
  await sql("UPDATE pedals SET created_at = now() - interval '8 days' WHERE serial=$1", [s2]);
  ok(!(await j("GET", "/admin/pedals", null, owner)).body.pedals.some((p) => p.serial === s2), "a code nobody used is gone after a week");
  // ---- removed: no more updates
  await j("POST", "/admin/pedals/" + mine.id + "/delete", {}, owner);
  ok((await j("POST", "/pedals/challenge", { serial })).status === 404, "a removed pedal gets no updates");
  await j("POST", "/admin/builds/" + nb.body.build.id + "/delete", {}, owner);
} catch (e) { console.error(e); fails++; }
finally { srv.kill(); stub.close(); }
if (fails) console.log(log.split("\n").slice(-30).join("\n"));
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
