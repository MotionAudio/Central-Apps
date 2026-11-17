// Device codes and the Central Burner (burn.js), through the API: only the owner and the Burners the owner adds can
// burn; a code is the kind's letter and 15-25 random numbers (an output box: 15); the same chip keeps its code (the
// CM5's serial read 8 or 16 digits long); the newest zips come from GitHub (a stand-in here) with a short-lived link;
// a pedal or control box registers its number chip with the code and one-time pass (pedals.js asks burn.js) and its
// update checks need that code; an output box's code is signed with the loader key; a freed code stops working and is
// never given out again.
//   node test/burn.mjs postgres://.../ma [port]
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import crypto from "node:crypto";
import { newCode, cleanChip, sameChip, SLOTS, boxMessage } from "../src/burn.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const db = process.argv[2] || "postgres://postgres@127.0.0.1:55432/ma", port = Number(process.argv[3] || 18951), base = "http://127.0.0.1:" + port;
const S = Date.now(), OWNER = "owner" + S + "@motion.test", STAFF = "burn" + S + "@motion.test", OTHER = "other" + S + "@motion.test";
let fails = 0;
const ok = (c, m, d) => { console.log((c ? "  ✓ " : "  ✗ ") + m + (c || d === undefined ? "" : "   -- " + JSON.stringify(d).slice(0, 400))); if (!c) fails++; };

// ---- the code itself (no server)
{
  const lens = new Set(); let allOk = true;
  for (let i = 0; i < 4000; i++) { const c = newCode(["pedal", "control", "input", "output"][i % 4]); lens.add(c.length - 1); if (!/^[PCIO]\d{15,25}$/.test(c) || c[0] !== "PCIO"[i % 4]) allOk = false; }
  ok(allOk, "codes are P/C/I/O and 15-25 numbers");
  ok(lens.has(15) && lens.has(25) && lens.size === 11, "every length from 15 to 25 turns up", [...lens].sort());
  ok(Array.from({ length: 200 }, () => newCode("output")).every((c) => /^O\d{15}$/.test(c)), "an output box's code is O and 15 numbers (it keeps 16 characters)");
  ok(cleanChip("0x0000ABCD1234") === "abcd1234" && cleanChip("d8:3a:dd") === "d83add", "chip IDs cleaned the same way");
  ok(sameChip({ chip: "abcd1234" }, "10000000abcd1234") && !sameChip({ chip: "abcd1234" }, "abcd1235") && !sameChip({ chip: "1234" }, "991234"), "8 vs 16 digits of one serial match; others don't");
  ok(sameChip({ chip: "aaaa0000", mac: "d8:3a:dd:01:02:03" }, "bbbb1111", "D8-3A-DD-01-02-03"), "the same Ethernet address matches");
  ok(SLOTS[0].match.test("central-pedal-11.0.0.zip") && !SLOTS[0].match.test("central-pedal-control-11.0.0.zip"), "the pedal slot doesn't take Central Pedal Control");
}

// ---- a stand-in for GitHub's releases API
const ghCalls = [];
const gh = http.createServer((req, res) => {
  ghCalls.push({ url: req.url, auth: req.headers.authorization || "", accept: req.headers.accept || "" });
  const rel = (tag, assets) => ({ tag_name: tag, draft: false, prerelease: false, published_at: "2026-11-16T10:00:00Z", assets });
  const a = (id, name, size, digest) => ({ id, name, size, updated_at: "2026-11-16T10:00:00Z", browser_download_url: "https://example.invalid/" + name, digest });
  if (/\/repos\/MotionAudio\/central-native\/releases\?/.test(req.url)) {
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify([
      rel("pedal-v11.1.0", [a(11, "central-pedal-11.1.0.zip", 1200, "sha256:" + "a".repeat(64)), a(12, "central-pedal-control-11.1.0.zip", 99), a(13, "central-burner-1.0.0-amd64.deb", 500)]),
      rel("v11.0.0", [a(1, "central-pedal-11.0.0.zip", 1000), a(2, "central-io-pedal-11.0.0.zip", 800), a(3, "central-io-inears-11.0.0.zip", 801), a(4, "central-io-wave-11.0.0.zip", 802), a(5, "central-input-1.0.0.zip", 90), a(6, "central-output-1.0.2.zip", 93), a(7, "notes.txt", 1)]),
    ]));
  }
  const m = req.url.match(/\/releases\/assets\/(\d+)$/);
  if (m && /octet-stream/.test(req.headers.accept || "")) { res.statusCode = 302; res.setHeader("Location", "https://objects.example.invalid/asset/" + m[1] + "?sig=x"); return res.end(); }
  res.statusCode = 404; res.end("{}");
});
await new Promise((r) => gh.listen(0, "127.0.0.1", r));
const mails = [];
const stub = http.createServer((req, res) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => { mails.push(JSON.parse(b || "{}")); res.end('{"id":"x"}'); }); });
await new Promise((r) => stub.listen(0, "127.0.0.1", r));
const srv = spawn(process.execPath, [path.join(here, "..", "src", "index.js")], { env: Object.assign({}, process.env, { DATABASE_URL: db, PORT: String(port), STRIPE_SECRET_KEY: "", RESEND_API_KEY: "re_test", MAIL_FROM: "M <t@motion.test>",
  RESEND_API_URL: "http://127.0.0.1:" + stub.address().port + "/emails", PUBLIC_URL: base, ADMIN_EMAILS: "", OWNER_EMAILS: OWNER, REMINDERS: "off", STATUS_CHECKS: "off", CC_UPDATE_API: "http://127.0.0.1:9", R2_ENDPOINT: "",
  BURN_GITHUB_API: "http://127.0.0.1:" + gh.address().port, GITHUB_TOKEN: "ghp_test", BURN_REPO: "" }), stdio: ["ignore", "pipe", "pipe"] });
let log = ""; srv.stdout.on("data", (d) => (log += d)); srv.stderr.on("data", (d) => (log += d));
for (let i = 0; i < 150 && !/Motion Audio server on/.test(log); i++) await new Promise((r) => setTimeout(r, 100));
const j = async (method, p, body, tok) => { const r = await fetch(base + "/v1" + p, { method, headers: Object.assign({ "Content-Type": "application/json" }, tok ? { Authorization: "Bearer " + tok } : {}), body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const waitMail = async (who, re) => { for (let i = 0; i < 50; i++) { const m = mails.filter((x) => x.to && x.to[0] === who && (!re || re.test(x.subject))).pop(); if (m) return m; await new Promise((r) => setTimeout(r, 100)); } return null; };
const codeIn = (m) => (m && (m.subject.match(/(\d{6})/) || m.text.match(/(\d{6})/)) || [])[1];
async function token(email, n) {
  const pw = "pass-" + S + "-" + n;
  await j("POST", "/signup", { email, password: pw, name: ["", "Sam", "Pat", "Lee"][n], device: "t" });
  const conf = await waitMail(email, /Confirm your email/), t = String((conf && conf.text) || "").match(/#confirm-([A-Za-z0-9_-]+)/);
  if (t) await j("POST", "/account/confirm", { token: t[1] });
  const before = mails.length;
  let st = (await j("POST", "/login", { email, password: pw, device: "t2" })).body;
  if (st.token && !st.step) return st.token;
  if (st.step === "phone") st = (await j("POST", "/login/phone", { ticket: st.ticket, phone: "555-01" + n + "-" + String(S).slice(-4) })).body;
  for (let i = 0; i < 50 && !mails.slice(before).some((x) => x.to && x.to[0] === email && /code/i.test(x.subject)); i++) await new Promise((r) => setTimeout(r, 100));
  const codes = mails.slice(before).filter((x) => x.to && x.to[0] === email && /code/i.test(x.subject)).map(codeIn);
  return (await j("POST", "/login/code", { ticket: st.ticket, code: codes[0], emailCode: codes[codes.length - 1], device: "t2" })).body.token;
}
try {
  const owner = await token(OWNER, 1), staff = await token(STAFF, 2), other = await token(OTHER, 3);
  ok(owner && staff && other, "three accounts signed in");

  // ---- who can burn
  ok((await j("GET", "/burn/me")).status === 401, "signed out: no");
  ok((await j("GET", "/burn/me", null, other)).body.canBurn === false, "an ordinary account can't burn");
  ok((await j("GET", "/burn/software", null, other)).status === 403 && (await j("POST", "/burn/claim", { kind: "pedal", chip: "abcd1234" }, other)).status === 403, "…and gets nothing");
  const me = (await j("GET", "/burn/me", null, owner)).body;
  ok(me.canBurn && me.owner, "the owner can burn");
  ok((await j("GET", "/me", null, owner)).body.burn === true && (await j("GET", "/me", null, other)).body.burn === false, "/me says who can burn (the Account page's card)");
  ok((await j("GET", "/burn/me", null, staff)).body.canBurn === false, "staff can't until they're added");
  ok((await j("POST", "/admin/burners", { email: STAFF.toUpperCase() }, owner)).body.ok, "the owner adds a Burner");
  ok((await j("GET", "/burn/me", null, staff)).body.canBurn === true, "now they can");
  ok((await j("POST", "/admin/burners", { email: OTHER }, staff)).status === 403 && (await j("GET", "/admin/burners", null, staff)).status === 403, "a Burner can't add or list Burners");
  const bl = (await j("GET", "/admin/burners", null, owner)).body.burners;
  ok(bl.length >= 1 && bl.some((b) => b.email === STAFF && b.hasAccount && b.name === "Pat"), "the owner sees the list", bl);

  // ---- the zips on GitHub
  const sw = (await j("GET", "/burn/software", null, staff)).body;
  const slot = (id) => (sw.slots || []).find((x) => x.slot === id) || {};
  ok(sw.repo === "MotionAudio/central-native", "from the private repo by default", sw.repo);
  ok(slot("pedal").name === "central-pedal-11.1.0.zip" && slot("pedal").version === "11.1.0" && slot("pedal").sha256 === "a".repeat(64), "the newest pedal zip (and its SHA-256)", slot("pedal"));
  ok(slot("control-pedal").name === "central-io-pedal-11.0.0.zip" && slot("control-inears").asset === 3 && slot("control-wave").asset === 4, "the control box's three jobs", sw.slots);
  ok(slot("input").name === "central-input-1.0.0.zip" && slot("output").version === "1.0.2", "the input and output boxes");
  ok(slot("burner").name === "central-burner-1.0.0-amd64.deb", "and the burner app");
  ok(ghCalls.every((c) => c.auth === "Bearer ghp_test"), "GitHub is asked with the website's token");
  const link = (await j("GET", "/burn/software/11/link", null, staff)).body;
  ok(link.url === "https://objects.example.invalid/asset/11?sig=x" && link.name === "central-pedal-11.1.0.zip", "a short-lived link to the file", link);
  ok((await j("GET", "/burn/software/7/link", null, staff)).status === 404, "only the burner's files get links");

  // ---- codes
  ok((await j("POST", "/burn/claim", { kind: "pedal", chip: "12" }, staff)).status === 400, "a chip ID that didn't come through is refused");
  ok((await j("POST", "/burn/claim", { kind: "control", chip: "abcd12345678" }, staff)).status === 400, "a control box needs its job");
  const peek0 = (await j("POST", "/burn/claim", { kind: "pedal", chip: "0x0000ABCD" + String(S).slice(-4), peek: true }, staff)).body;
  ok(peek0.code === null, "peek: a new chip has no code yet (nothing made)");
  const chipP = "abcd" + String(S).slice(-4);
  const p1 = (await j("POST", "/burn/claim", { kind: "pedal", chip: "0x0000" + chipP.toUpperCase(), mac: "D8:3A:DD:00:00:01", software: "central-pedal-11.1.0.zip" }, staff)).body;
  ok(/^P\d{15,25}$/.test(p1.code) && p1.kept === false, "a pedal gets P and 15-25 numbers", p1);
  const p2 = (await j("POST", "/burn/claim", { kind: "pedal", chip: "10000000" + chipP }, owner)).body;
  ok(p2.code === p1.code && p2.kept, "the same CM5 burned again keeps its code (serial read 16 digits long)", p2);
  const p3 = (await j("POST", "/burn/claim", { kind: "pedal", chip: "ffff" + String(S).slice(-4) }, staff)).body;
  ok(p3.code && p3.code !== p1.code, "another pedal gets another code");
  const c1 = (await j("POST", "/burn/claim", { kind: "control", use: "inears", chip: "c0ffee" + String(S).slice(-6) }, staff)).body;
  ok(/^C\d{15,25}$/.test(c1.code) && c1.device.use === "inears", "a control box gets C, with its job", c1);
  const c2 = (await j("POST", "/burn/claim", { kind: "control", use: "wave", chip: "c0ffee" + String(S).slice(-6) }, staff)).body;
  ok(c2.code === c1.code && c2.device.use === "wave", "burned for another job: same code, new job", c2);
  const uid = "2f0041000f51333233373731"; const i1 = (await j("POST", "/burn/claim", { kind: "input", chip: uid.slice(0, 18) + String(S).slice(-6) }, staff)).body;
  const k0 = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" }).publicKey.export({ format: "jwk" });
  const o1 = (await j("POST", "/burn/claim", { kind: "output", serial: "01" + crypto.randomBytes(8).toString("hex"), publicKey: Buffer.concat([Buffer.from(k0.x, "base64url"), Buffer.from(k0.y, "base64url")]).toString("hex") }, staff)).body;
  ok(/^I\d{15,25}$/.test(i1.code) && /^O\d{15,25}$/.test(o1.code), "input box I, output box O (each kind counts its own chips)", [i1.code, o1.code]);
  const par = await Promise.all([1, 2, 3, 4, 5].map(() => j("POST", "/burn/claim", { kind: "input", chip: "9999" + String(S).slice(-8) }, staff)));
  ok(new Set(par.map((r) => r.body.code)).size === 1 && par.every((r) => r.status === 200), "five burns of one chip at once still give it one code", par.map((r) => r.body.code || r.body.error));

  // ---- the history
  ok((await j("POST", "/burn/done", { code: p1.code, chip: "deadbeef00", software: "x" }, staff)).status === 409, "a finished burn with the wrong chip is refused");
  const d1 = (await j("POST", "/burn/done", { code: p1.code, chip: chipP, software: "central-pedal-11.1.0.zip", sha256: "A".repeat(64), ok: true }, staff)).body;
  ok(d1.ok && d1.device.burns === 1 && d1.device.burnedBy === "Pat" && d1.device.software === "central-pedal-11.1.0.zip", "a finished burn is kept, with who did it", d1);
  await j("POST", "/burn/done", { code: p1.code, chip: chipP, software: "central-pedal-11.1.0.zip", ok: false, notes: "unplugged" }, staff);
  const hist = (await j("GET", "/burn/devices/" + p1.code.toLowerCase(), null, owner)).body;
  ok(hist.burns.length === 2 && hist.burns[0].ok === false && hist.burns[0].notes === "unplugged" && hist.device.burns === 1, "a failed burn shows in its history but isn't counted", hist);
  const list = (await j("GET", "/burn/devices?q=" + p1.code.slice(0, 9), null, staff)).body;
  ok(list.devices.some((x) => x.code === p1.code) && list.owner === false, "codes can be found", list.devices.length);
  ok((await j("GET", "/burn/devices", null, owner)).body.counts.pedal >= 2, "counted by kind");

  // ---- a pedal registers its number chip with the code and the one-time pass the burner left (pedals.js → burn.js)
  const c = new pg.Client({ connectionString: db }); await c.connect();
  ok(typeof p2.pass === "string" && /^[A-Za-z0-9_-]{32}$/.test(p2.pass) && typeof c1.pass === "string", "pedals and control boxes get a one-time pass with their code");
  const chipKey = () => { const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" }); const jw = publicKey.export({ format: "jwk" }); return { privateKey, pub: Buffer.concat([Buffer.from(jw.x, "base64url"), Buffer.from(jw.y, "base64url")]).toString("hex") }; };
  const signed = (k, msg) => crypto.sign("sha256", Buffer.from(msg), { key: k.privateKey, dsaEncoding: "ieee-p1363" }).toString("hex");
  const reg = (k, serial, kind, code, pass) => j("POST", "/pedals/register", { kind, serial, publicKey: k.pub, signature: signed(k, (kind === "controller" ? "central-io" : "central-pedal") + "-register|" + serial + "|" + k.pub), version: "11.0.0", code, pass });
  const A = chipKey(), B = chipKey(), sA = "01" + crypto.randomBytes(8).toString("hex"), sB = "01" + crypto.randomBytes(8).toString("hex");
  const pass = p2.pass;   // (the newest pass for p1's code: the second burn's)
  ok((await reg(A, sA, "pedal", p1.code, p1.pass)).status === 403, "an old pass (from an earlier burn) is turned down");
  const r1 = await reg(A, sA, "pedal", p1.code, pass);
  ok(r1.status === 200 && r1.body.status === "approved" && r1.body.deviceCode === p1.code, "the right pass: approved straight away, with its code", r1.body);
  ok((await reg(A, sA, "pedal", p1.code, pass)).body.status === "approved", "the same chip asking again (a dropped network) gets yes again");
  const rB = await reg(B, sB, "pedal", p1.code, pass);
  ok(rB.status >= 400 && rB.status < 500, "another chip with the same code and pass is turned down", rB.body);
  ok((await reg(B, sB, "controller", c1.code, p1.pass)).status === 403, "a pedal's pass doesn't fit a control box's code");
  const rc = await reg(B, sB.replace(/^01/, "02"), "controller", c1.code, c2.pass);
  ok(rc.status === 200 && rc.body.deviceCode === c1.code, "a control box registers the same way (kind controller)", rc.body);
  const row = (await c.query("SELECT number_serial, registered_at FROM device_codes WHERE code=$1", [p1.code])).rows[0];
  ok(row.number_serial === sA && row.registered_at, "the code is tied to that number chip");
  // its update checks need its chip's signature and its code
  const upd = async (k, serial, code) => {
    const n = (await j("POST", "/pedals/challenge", { serial })).body.nonce;
    return j("POST", "/pedals/update", { serial, nonce: n, signature: signed(k, "central-pedal-update|" + n + "|" + serial), version: "11.0.0", code });
  };
  ok((await upd(A, sA, "P123")).status === 403, "an update check with the wrong code is refused");
  const u1 = await upd(A, sA, p1.code);
  ok(u1.status === 200 && (u1.body.upToDate || u1.body.update), "with its code it's answered", u1.body);
  const listed = (await j("GET", "/burn/devices?q=" + p1.code, null, owner)).body.devices.find((x) => x.code === p1.code);
  ok(listed && listed.numberChip === sA && listed.approved === true && listed.lastSeen, "the codes list shows its number chip, that it's approved and its last check", listed);

  // ---- an output box: its number chip's serial and key → a code signed with the loader key
  const box = chipKey(), boxSerial = "01" + crypto.randomBytes(8).toString("hex");
  ok((await j("POST", "/burn/claim", { kind: "output", chip: boxSerial }, staff)).status === 400, "an output box without its chip's key is refused");
  const o2 = (await j("POST", "/burn/claim", { kind: "output", serial: boxSerial, publicKey: box.pub, software: "central-output-1.0.2.zip" }, staff)).body;
  ok(/^O\d{15}$/.test(o2.code) && /^[0-9a-f]{128}$/.test(o2.signature), "an output box gets O + 15 numbers and a signature", o2);
  ok((await j("GET", "/burn/loader-key", null, staff)).status === 403, "only the owner sees the loader key");
  const lk = (await j("GET", "/burn/loader-key", null, owner)).body;
  ok(/^[0-9a-f]{128}$/.test(lk.publicKey) && /IDENT_LOADER_KEY\[64\]/.test(lk.header) && (lk.header.match(/0x/g) || []).length === 64, "the owner gets the key for ident_key.h", lk.header);
  const lkObj = crypto.createPublicKey({ key: { kty: "EC", crv: "P-256", x: Buffer.from(lk.publicKey.slice(0, 64), "hex").toString("base64url"), y: Buffer.from(lk.publicKey.slice(64), "hex").toString("base64url") }, format: "jwk" });
  ok(crypto.verify("sha256", boxMessage(boxSerial, box.pub, o2.code), { key: lkObj, dsaEncoding: "ieee-p1363" }, Buffer.from(o2.signature, "hex")), "the signature checks out: serial + key + code (16 bytes)");
  const o3 = (await j("POST", "/burn/claim", { kind: "output", serial: boxSerial, publicKey: box.pub }, staff)).body;
  ok(o3.code === o2.code && o3.kept, "the same box asking again keeps its code");
  ok((await j("POST", "/burn/claim", { kind: "output", serial: boxSerial, publicKey: chipKey().pub }, staff)).status === 409, "the same serial with another key is refused");

  // ---- freeing a code
  ok((await j("POST", "/burn/devices/" + p1.code + "/free", { why: "x" }, staff)).status === 403, "a Burner can't free codes");
  ok((await j("POST", "/burn/devices/" + p1.code + "/free", { why: "scrapped" }, owner)).body.device.freed, "the owner frees a scrapped board's code");
  ok((await upd(A, sA, p1.code)).status === 403, "its pedal gets no more updates");
  ok((await reg(B, "03" + sB.slice(2), "pedal", p1.code, pass)).status >= 400, "and nothing can register with it");
  const p4 = (await j("POST", "/burn/claim", { kind: "pedal", chip: chipP }, staff)).body;
  ok(p4.code && p4.code !== p1.code && p4.kept === false, "that chip burned again gets a new code (the old one is never reused)", p4);
  ok((await j("POST", "/burn/done", { code: p1.code, chip: chipP }, staff)).status === 409, "a freed code can't be burned");
  ok((await c.query("SELECT count(*)::int AS n FROM device_codes WHERE code=$1", [p1.code])).rows[0].n === 1, "the freed code stays on the list");

  // ---- removing a Burner
  await j("POST", "/admin/burners/delete", { email: STAFF }, owner);
  ok((await j("GET", "/burn/software", null, staff)).status === 403, "a removed Burner can't burn any more");
  await c.end();
} catch (e) { ok(false, "crashed: " + e.stack); }
srv.kill(); gh.close(); stub.close();
if (fails) { console.log(log.split("\n").slice(-30).join("\n")); }
console.log(fails ? "\n" + fails + " failed" : "\nall passed");
process.exit(fails ? 1 : 0);
