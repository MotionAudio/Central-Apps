// Central I/O control boxes on the same calls as the pedals (server/src/pedals.js, kind "controller"): registering
// with their own message (a pedal's is refused), the owner's approval by the code, a certificate over
// "central-io-cert-v1|..." that isn't a pedal's, a pedal claiming a control box's number refused, update checks signed
// over "central-io-update|..." with the job, answered with the ship build of that job (never the pedal's), and the
// burner's code and one-time pass (a stand-in code list: test/controllers-claim-server.mjs) approving one at once.
//   node test/reve-controllers.mjs postgres://.../ma [port]
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const db = process.argv[2] || "postgres://postgres@127.0.0.1:55432/ma", port = Number(process.argv[3] || 18947), base = "http://127.0.0.1:" + port;
const S = Date.now(), V = "1." + (S % 1000000), OWNER = "owner" + S + "@motion.test", STAFF = "staff" + S + "@motion.test";
const mails = [];
const stub = http.createServer((req, res) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => { mails.push(JSON.parse(b || "{}")); res.end('{"id":"x"}'); }); });
await new Promise((r) => stub.listen(0, "127.0.0.1", r));
const PASS = crypto.randomBytes(18).toString("base64url");
const srv = spawn(process.execPath, [path.join(here, "controllers-claim-server.mjs")], { env: Object.assign({}, process.env, { TEST_PASS: PASS, DATABASE_URL: db, PORT: String(port), STRIPE_SECRET_KEY: "", RESEND_API_KEY: "re_test", MAIL_FROM: "M <t@motion.test>",
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



function device() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jw = publicKey.export({ format: "jwk" });
  const pub = Buffer.concat([Buffer.from(jw.x, "base64url"), Buffer.from(jw.y, "base64url")]).toString("hex");
  return { pub, sign: (m) => crypto.sign("sha256", Buffer.from(m), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("hex") };
}
const keyOf = (hex) => { const b = Buffer.from(hex, "hex"); return crypto.createPublicKey({ key: { kty: "EC", crv: "P-256", x: b.subarray(0, 32).toString("base64url"), y: b.subarray(32).toString("base64url") }, format: "jwk" }); };

const serial = crypto.randomBytes(9).toString("hex");
const msg = (what, a, b) => "central-io-" + what + "|" + a + "|" + b;
const reg = (c, s = serial, extra = {}) => j("POST", "/pedals/register", Object.assign({ kind: "controller", serial: s, publicKey: c.pub, signature: c.sign(msg("register", s, c.pub)), version: "11.0.0" }, extra));
const verifies = (m, sigHex, keyHex) => crypto.verify("sha256", Buffer.from(m), { key: keyOf(keyHex), dsaEncoding: "ieee-p1363" }, Buffer.from(sigHex, "hex"));
const rows = [];

try {
  const owner = await token(OWNER, 1), staff = await token(STAFF, 2);
  ok(!!owner && !!staff, "the owner and a staff member signed in");
  const A = device();
  rows.push(serial);
  // ---- registering: its own message
  ok((await reg(A, serial, { signature: A.sign("central-pedal-register|" + serial + "|" + A.pub) })).status === 403, "a pedal's registration message doesn't register a control box");
  const r1 = await reg(A);
  ok(r1.status === 200 && r1.body.status === "pending" && /^[A-Z2-9]{3}-[A-Z2-9]{4}$/.test(r1.body.code), "registered: waiting, with a code to approve", r1.body);
  const l1 = await j("GET", "/admin/pedals", null, owner);
  const mine = (l1.body.pedals || []).find((p) => p.serial === serial);
  ok(mine && mine.kind === "controller" && mine.status === "pending", "the owner's list says it's a control box", mine);
  ok((await j("POST", "/admin/pedals/approve", { code: r1.body.code }, staff)).status === 403, "other staff can't approve it");
  const ap = await j("POST", "/admin/pedals/approve", { code: r1.body.code }, owner);
  ok(ap.status === 200 && ap.body.pedal.status === "approved" && ap.body.pedal.kind === "controller", "approved by its code", ap.body);
  const got = await j("GET", "/pedals/register/" + r1.body.ticket);
  ok(got.body.status === "approved" && verifies(msg("cert-v1", serial, A.pub), got.body.certificate, got.body.serverKey), "its certificate: the website's signature over the control box's message", got.body);
  ok(!verifies("central-pedal-cert-v1|" + serial + "|" + A.pub, got.body.certificate, got.body.serverKey), "...which isn't a pedal's certificate");
  const asPedal = await j("POST", "/pedals/register", { serial, publicKey: A.pub, signature: A.sign("central-pedal-register|" + serial + "|" + A.pub), version: "10.7.0" });
  ok(asPedal.status === 409 && /control box/.test(asPedal.body.error), "the same device calling itself a pedal: refused", asPedal.body);

  // ---- builds: the control box's jobs and the pedal's
  const up = async (kind, name, version, seed) => {
    const b = blob(120000, seed);
    const nb = await j("POST", "/admin/builds", { kind, version, name, size: b.length, notes: kind + " notes" }, owner);
    await put(nb.body.uploadUrl, b);
    await j("POST", "/admin/builds/" + nb.body.build.id + "/done", {}, owner);
    for (let i = 0; i < 50; i++) { const x = (await j("GET", "/admin/builds", null, owner)).body.builds.find((y) => y.id === nb.body.build.id); if (x && x.sha256) break; await new Promise((r) => setTimeout(r, 100)); }
    return b;
  };
  const kinds = (await j("GET", "/admin/builds", null, owner)).body.kinds.map((k) => k.id);
  ok(["io-pedal", "io-inears", "io-wave"].every((k) => kinds.includes(k)), "the builds page has the control box's three programs", kinds);
  const wave = await up("io-wave", "central-io-wave_11.4.0_arm64.deb", "11.4.0", 3);
  await up("pedal", "central-pedal_99.0.0_arm64.deb", "99.0.0", 4);

  // ---- updates: signed over its own message, with its job
  const upd = async (signer, job, extra = {}) => {
    const ch = await j("POST", "/pedals/challenge", { serial });
    return j("POST", "/pedals/update", Object.assign({ serial, nonce: ch.body.nonce, signature: signer(ch.body.nonce), version: "11.0.0", job }, extra));
  };
  const own = (n) => A.sign(msg("update", n, serial)), pedalStyle = (n) => A.sign("central-pedal-update|" + n + "|" + serial);
  ok((await upd(pedalStyle, "wave")).status === 403, "an update check signed like a pedal's: refused");
  ok((await upd(own, "")).status === 400, "an update check that doesn't say its job: refused");
  const u = await upd(own, "wave");
  ok(u.status === 200 && u.body.update && u.body.update.version === "11.4.0" && u.body.update.sha256 === sha(wave) && /central-io-wave/.test(u.body.update.name), "Central Wave's build to ship, never the pedal's", u.body);
  ok(sha(Buffer.from(await (await fetch(u.body.update.url)).arrayBuffer())) === sha(wave), "its link gives that file");
  const none = await upd(own, "inears");
  ok(none.status === 200 && none.body.upToDate === true, "a job with no build yet: up to date", none.body);

  // ---- the burner's code and pass: approved at once, and its update checks carry the code
  const B = device(), sb = crypto.randomBytes(9).toString("hex");
  rows.push(sb);
  const rb = await reg(B, sb, { code: "cc-00007", pass: PASS });
  ok(rb.status === 200 && rb.body.status === "approved" && rb.body.deviceCode === "CC-00007" && verifies(msg("cert-v1", sb, B.pub), rb.body.certificate, rb.body.serverKey), "the burner's code and pass: approved straight away", rb.body);
  const chb = await j("POST", "/pedals/challenge", { serial: sb });
  const noCode = await j("POST", "/pedals/update", { serial: sb, nonce: chb.body.nonce, signature: B.sign(msg("update", chb.body.nonce, sb)), version: "11.0.0", job: "wave" });
  ok(noCode.status === 403, "its update check without the code: refused", noCode.body);
  const chc = await j("POST", "/pedals/challenge", { serial: sb });
  const withCode = await j("POST", "/pedals/update", { serial: sb, nonce: chc.body.nonce, signature: B.sign(msg("update", chc.body.nonce, sb)), version: "11.0.0", job: "wave", code: "CC-00007" });
  ok(withCode.status === 200 && withCode.body.update && withCode.body.update.version === "11.4.0", "with its code: answered", withCode.body);
} catch (e) {
  ok(false, "the test crashed: " + e.stack);
} finally {
  for (const s of rows) await sql("DELETE FROM pedals WHERE serial=$1", [s]).catch(() => { });
  await sql("DELETE FROM builds").catch(() => { });
  srv.kill();
  stub.close();
}
console.log(fails ? fails + " FAILED" : "all passed");
if (fails) console.log(log.slice(-2000));
process.exit(fails ? 1 : 0);
