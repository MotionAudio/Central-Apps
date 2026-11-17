// Rev E: the CM5 pedals' and control boxes' codes (server/src/pedals.js, with burn.js's code list) through the API.
// The burner gives a board its code and a one-time pass; the device checks in with them and its one-time chip's serial
// (the pass ties the code to that chip for good; the same chip again is fine, another chip or an old pass isn't); its
// update checks need its code from that chip (or, before it has checked in, the board the code was burned on): the
// build marked to ship (a .deb, newer), its SHA-256 and a link that gives the same file; a control box gets its job's
// build, never the pedal's; updates off; a freed code gets nothing; taking one off the list doesn't stop it.
//   node test/reve-pedals.mjs postgres://.../ma [port]
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const db = process.argv[2] || "postgres://postgres@127.0.0.1:55432/ma", port = Number(process.argv[3] || 18943), base = "http://127.0.0.1:" + port;
const S = Date.now(), OWNER = "owner" + S + "@motion.test", STAFF = "staff" + S + "@motion.test";
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
  return (await j("POST", "/login/code", { ticket: st.ticket, code: codes[0], emailCode: codes[codes.length - 1], device: "t2" })).body.token;
}
const blob = (n, seed) => { const b = Buffer.alloc(n); for (let i = 0; i < n; i++) b[i] = (i * 31 + seed) & 255; return b; };
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const put = (url, b) => fetch(url, { method: "PUT", body: b, headers: { "Content-Type": "application/octet-stream" } });
const hex = (n) => crypto.randomBytes(n).toString("hex");

try {
  const owner = await token(OWNER, 1), staff = await token(STAFF, 2);
  ok(!!owner && !!staff, "the owner and a staff member signed in");
  const up = async (kind, name, version, seed) => {
    const b = blob(120000, seed);
    const nb = await j("POST", "/admin/builds", { kind, version, name, size: b.length, notes: kind + " notes" }, owner);
    await put(nb.body.uploadUrl, b);
    await j("POST", "/admin/builds/" + nb.body.build.id + "/done", {}, owner);
    for (let i = 0; i < 50; i++) { const x = (await j("GET", "/admin/builds", null, owner)).body.builds.find((y) => y.id === nb.body.build.id); if (x && x.sha256) break; await new Promise((r) => setTimeout(r, 100)); }
    return { b, id: nb.body.build.id };
  };
  const ver = "99." + (S % 1000) + ".0";
  const deb = await up("pedal", "central-pedal_" + ver + "_arm64.deb", ver, 5);
  const wave = await up("io-wave", "central-io-wave_11.4.0_arm64.deb", "11.4.0", 3);

  // ---- the burner gives a pedal its code and pass (the owner can always burn)
  const board = "10000000" + hex(4), serial = "01" + hex(8);
  const p = (await j("POST", "/burn/claim", { kind: "pedal", chip: board, boardRev: "rev E", batch: "JLC-2026-11" }, owner)).body;
  ok(/^P\d{15,25}$/.test(p.code) && /^[A-Za-z0-9_-]{32}$/.test(p.pass), "the burner: a code and a one-time pass", p);
  const reg = (extra) => j("POST", "/pedals/register", Object.assign({ kind: "pedal", code: p.code, pass: p.pass, serial, version: "10.7.0" }, extra));
  const upd = (extra) => j("POST", "/pedals/update", Object.assign({ kind: "pedal", code: p.code, serial, version: "10.7.0" }, extra));

  // ---- before it's online: an update check needs the board it was burned on
  ok((await upd({ board: "deadbeef" + hex(4) })).status === 403, "before checking in, an update check from another board: refused");
  ok((await reg({ serial: "nope" })).status === 400 && (await reg({ code: "x" })).status === 400, "a bad serial or code: refused");
  ok((await reg({ pass: "A".repeat(32) })).status === 403, "a wrong pass: refused");
  ok((await reg({ code: "P" + "1".repeat(20) })).status === 404, "a code that isn't on the website: refused");
  // ---- checking in
  const r1 = await reg();
  ok(r1.status === 200 && r1.body.status === "ok" && r1.body.deviceCode === p.code, "checked in with its code and pass", r1.body);
  ok((await reg()).status === 200, "the same chip again (a dropped network): yes again");
  ok((await reg({ serial: "02" + hex(8) })).status === 403, "another chip with the same code and pass: refused");
  const row = (await sql("SELECT number_serial, registered_at, board_rev, batch FROM device_codes WHERE code=$1", [p.code]))[0];
  ok(row.number_serial === serial && row.registered_at && row.board_rev === "rev E" && row.batch === "JLC-2026-11", "the code is tied to that chip, with its board revision and batch", row);
  const again = (await j("POST", "/burn/claim", { kind: "pedal", chip: board }, owner)).body;
  ok(again.code === p.code && again.pass !== p.pass, "burned again: the same code, a new pass");
  ok((await reg({ pass: p.pass })).status === 403 && (await reg({ pass: again.pass })).status === 200, "after that, the old pass is turned down and the new one fits");

  // ---- updates: the code and that chip
  ok((await upd({ serial: "03" + hex(8) })).status === 403, "an update check from another chip: refused");
  ok((await upd({ code: "P" + "2".repeat(18) })).status === 404, "with a code that isn't on the website: refused");
  const u = await upd();
  ok(u.status === 200 && u.body.update && u.body.update.version === ver && u.body.update.sha256 === sha(deb.b) && u.body.update.notes === "pedal notes", "the update: the build to ship, newer, with its SHA-256", u.body);
  const dl = Buffer.from(await (await fetch(u.body.update.url)).arrayBuffer());
  ok(sha(dl) === sha(deb.b), "its link gives the same file");
  const same = await upd({ version: ver });
  ok(same.status === 200 && same.body.upToDate === true && !same.body.update, "already on that version: up to date", same.body);
  ok((await j("GET", "/admin/pedals")).status === 401 && (await j("GET", "/admin/pedals", null, staff)).status === 403, "the pedals list: the owner only");
  const mine = (await j("GET", "/admin/pedals", null, owner)).body.pedals.find((x) => x.serial === serial);
  ok(mine && mine.deviceCode === p.code && mine.version === ver && mine.lastSeen && mine.updates, "the owner sees it, its code and the version it last checked with", mine);
  const listed = (await j("GET", "/burn/devices?q=" + p.code, null, owner)).body.devices.find((x) => x.code === p.code);
  ok(listed && listed.numberChip === serial && listed.lastSeen && listed.boardRev === "rev E" && listed.batch === "JLC-2026-11", "Device codes shows its chip, last check, revision and batch", listed);
  // ---- updates off, then a removed one comes back
  await j("POST", "/admin/pedals/" + mine.id, { updates: false }, owner);
  const off = await upd();
  ok(off.status === 403 && /off for this pedal/.test(off.body.error), "updates turned off for this pedal", off.body);
  await j("POST", "/admin/pedals/" + mine.id, { updates: true }, owner);
  await j("POST", "/admin/pedals/" + mine.id + "/delete", {}, owner);
  ok((await upd()).status === 200 && (await j("GET", "/admin/pedals", null, owner)).body.pedals.some((x) => x.serial === serial), "taken off the list: it's back at its next update check");

  // ---- a control box: the same calls, kind controller, its job's build
  const cb = "20000000" + hex(4), cs = "01" + hex(8);
  const c = (await j("POST", "/burn/claim", { kind: "control", use: "wave", chip: cb, boardRev: "rev B" }, owner)).body;
  ok(/^C\d{15,25}$/.test(c.code) && c.pass, "the burner: a control box's code and pass", c);
  ok((await j("POST", "/pedals/register", { kind: "pedal", code: c.code, pass: c.pass, serial: cs })).status === 404, "a control box's code doesn't check in as a pedal");
  ok((await j("POST", "/pedals/register", { kind: "controller", code: c.code, pass: p.pass, serial: cs })).status === 403, "a pedal's pass doesn't fit a control box's code");
  // (before checking in, the board it was burned on is enough)
  const cu0 = await j("POST", "/pedals/update", { kind: "controller", code: c.code, serial: cs, board: cb.slice(8), version: "11.0.0", job: "wave" });
  ok(cu0.status === 200 && cu0.body.update && cu0.body.update.version === "11.4.0" && /central-io-wave/.test(cu0.body.update.name) && cu0.body.update.sha256 === sha(wave.b), "before checking in, from its own board: Central Wave's build to ship, never the pedal's", cu0.body);
  ok((await j("POST", "/pedals/update", { kind: "controller", code: c.code, serial: cs, version: "11.0.0" })).status === 400, "an update check that doesn't say its job: refused");
  const ci = await j("POST", "/pedals/update", { kind: "controller", code: c.code, serial: cs, version: "11.0.0", job: "inears" });
  ok(ci.status === 200 && ci.body.upToDate === true, "a job with no build yet: up to date", ci.body);
  ok((await j("POST", "/pedals/register", { kind: "controller", code: c.code, pass: c.pass, serial: "05" + hex(8) })).status === 403, "its code is tied to the chip that checked first");
  ok((await j("GET", "/admin/pedals", null, owner)).body.pedals.find((x) => x.deviceCode === c.code).kind === "controller", "it's on the list as a control box");

  // ---- a freed code: nothing
  ok((await j("POST", "/burn/devices/" + p.code + "/free", { why: "scrapped" }, owner)).body.device.freed, "the owner frees the pedal's code");
  ok((await upd()).status === 403 && (await reg()).status === 403, "a freed code gets no updates and can't check in");
  await j("POST", "/admin/builds/" + deb.id + "/delete", {}, owner);
  await j("POST", "/admin/builds/" + wave.id + "/delete", {}, owner);
} catch (e) { console.error(e); fails++; }
finally { srv.kill(); stub.close(); }
if (fails) console.log(log.split("\n").slice(-30).join("\n"));
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
