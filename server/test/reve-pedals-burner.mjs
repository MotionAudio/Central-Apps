// Rev E with the burner app: a pedal registers with the device code and one-time pass the burner gave it, the code
// list (a stand-in here: test/pedals-claim-server.mjs) says yes, and the website approves it straight away and keeps
// its code; a wrong pass, or the same pass on another chip, is turned down; update checks have to carry the code.
//   node test/reve-pedals-burner.mjs postgres://.../ma [port]
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const db = process.argv[2] || "postgres://postgres@127.0.0.1:55432/ma", port = Number(process.argv[3] || 18945), base = "http://127.0.0.1:" + port;
const S = Date.now(), V = "1." + (S % 1000000), OWNER = "owner" + S + "@motion.test", STAFF = "staff" + S + "@motion.test";
const mails = [];
const stub = http.createServer((req, res) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => { mails.push(JSON.parse(b || "{}")); res.end('{"id":"x"}'); }); });
await new Promise((r) => stub.listen(0, "127.0.0.1", r));
const PASS = crypto.randomBytes(18).toString("base64url");
const srv = spawn(process.execPath, [path.join(here, "pedals-claim-server.mjs")], { env: Object.assign({}, process.env, { TEST_PASS: PASS, DATABASE_URL: db, PORT: String(port), STRIPE_SECRET_KEY: "", RESEND_API_KEY: "re_test", MAIL_FROM: "M <t@motion.test>",
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



function chip() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jw = publicKey.export({ format: "jwk" });
  const pub = Buffer.concat([Buffer.from(jw.x, "base64url"), Buffer.from(jw.y, "base64url")]).toString("hex");
  return { pub, sign: (m) => crypto.sign("sha256", Buffer.from(m), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("hex") };
}
const keyOf = (hex) => { const b = Buffer.from(hex, "hex"); return crypto.createPublicKey({ key: { kty: "EC", crv: "P-256", x: b.subarray(0, 32).toString("base64url"), y: b.subarray(32).toString("base64url") }, format: "jwk" }); };
const reg = (c, s, extra = {}) => j("POST", "/pedals/register", Object.assign({ serial: s, publicKey: c.pub, signature: c.sign("central-pedal-register|" + s + "|" + c.pub), version: "11.0.0" }, extra));

try {
  await sql("DELETE FROM pedals WHERE device_code='CP-00042'");
  const owner = await token(OWNER, 1);
  const A = chip(), sa = crypto.randomBytes(9).toString("hex");
  const wrong = await reg(A, sa, { code: "CP-00042", pass: "x".repeat(24) });
  ok(wrong.status === 403 && /doesn't match/.test(wrong.body.error), "a wrong pass: turned down", wrong.body);
  ok((await reg(A, sa, { code: "CP-00099", pass: PASS })).status === 404, "a code the list doesn't have: turned down");
  const r = await reg(A, sa, { code: "cp-00042", pass: PASS });
  ok(r.status === 200 && r.body.status === "approved" && r.body.deviceCode === "CP-00042" && !r.body.ticket, "the burner's code and pass: approved straight away, no code to type", r.body);
  const key = (await j("GET", "/pedals/key")).body.serverKey;
  ok(crypto.verify("sha256", Buffer.from("central-pedal-cert-v1|" + sa + "|" + A.pub), { key: keyOf(key), dsaEncoding: "ieee-p1363" }, Buffer.from(r.body.certificate, "hex")), "its certificate is the website's");
  const again = await reg(A, sa, { code: "CP-00042", pass: PASS });
  ok(again.status === 200 && again.body.certificate === r.body.certificate && again.body.deviceCode === "CP-00042", "the same pedal asking again (the network dropped): the same answer");
  const plain = await reg(A, sa);
  ok(plain.body.status === "approved" && plain.body.deviceCode === "CP-00042", "registering again without the pass (after a reset): its code comes back", plain.body);
  const B = chip(), sb = crypto.randomBytes(9).toString("hex");
  const copy = await reg(B, sb, { code: "CP-00042", pass: PASS });
  ok(copy.status === 403 && /another pedal/.test(copy.body.error), "the same pass on another chip: turned down", copy.body);
  ok((await reg(B, sb)).body.status === "pending", "...that chip can still ask the owner to approve it");
  const list = (await j("GET", "/admin/pedals", null, owner)).body.pedals;
  const row = list.find((p) => p.serial === sa);
  ok(row && row.deviceCode === "CP-00042" && row.status === "approved" && row.note === "Loaded with the burner", "the owner's list shows the code", row);
  // ---- update checks carry the code
  const upd = async (c, s, code) => { const n = (await j("POST", "/pedals/challenge", { serial: s })).body.nonce; return j("POST", "/pedals/update", Object.assign({ serial: s, nonce: n, signature: c.sign("central-pedal-update|" + n + "|" + s), version: "11.0.0" }, code === undefined ? {} : { code })); };
  const none = await upd(A, sa);
  ok(none.status === 403 && /code doesn't match/.test(none.body.error), "an update check without the code: turned down", none.body);
  ok((await upd(A, sa, "CP-00041")).status === 403, "...or with another code");
  const good = await upd(A, sa, "CP-00042");
  ok(good.status === 200 && (good.body.upToDate || good.body.update), "with its code: answered", good.body);
  await sql("DELETE FROM pedals WHERE serial = ANY($1)", [[sa, sb]]);
} catch (e) { console.error(e); fails++; }
finally { srv.kill(); stub.close(); }
if (fails) console.log(log.split("\n").slice(-30).join("\n"));
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
