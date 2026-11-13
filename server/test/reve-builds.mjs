// Rev E: the pedal's private builds (Account → Pedal builds), through the API: only the owner sees them (not other
// staff, not anyone signed out); a build is checked (kind, version, file type, size), uploaded straight to storage
// through its signed link, checked again when it's there (the size), and gets its SHA-256; one per kind ships; notes;
// an hour's download link; a short upload is caught; deleting removes the file and moves "ships" on.
//   node test/reve-builds.mjs postgres://.../ma [port]
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));
const db = process.argv[2] || "postgres://postgres@127.0.0.1:55432/ma", port = Number(process.argv[3] || 18941), base = "http://127.0.0.1:" + port;
const S = Date.now(), V = "1." + (S % 1000000), OWNER = "owner" + S + "@motion.test", STAFF = "staff" + S + "@motion.test";
const mails = [];
const stub = http.createServer((req, res) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => { mails.push(JSON.parse(b || "{}")); res.end('{"id":"x"}'); }); });
await new Promise((r) => stub.listen(0, "127.0.0.1", r));
const srv = spawn(process.execPath, [path.join(here, "..", "src", "index.js")], { env: Object.assign({}, process.env, { DATABASE_URL: db, PORT: String(port), STRIPE_SECRET_KEY: "", RESEND_API_KEY: "re_test", MAIL_FROM: "M <t@motion.test>",
  RESEND_API_URL: "http://127.0.0.1:" + stub.address().port + "/emails", PUBLIC_URL: base, ADMIN_EMAILS: STAFF, OWNER_EMAILS: OWNER, REMINDERS: "off", STATUS_CHECKS: "off", CC_UPDATE_API: "http://127.0.0.1:9", R2_ENDPOINT: "" }), stdio: ["ignore", "pipe", "pipe"] });
let log = ""; srv.stdout.on("data", (d) => (log += d)); srv.stderr.on("data", (d) => (log += d));
for (let i = 0; i < 150 && !/Motion Audio server on/.test(log); i++) await new Promise((r) => setTimeout(r, 100));
// (a fresh start: the builds left by an earlier run would change which build ships)
{ const c = new pg.Client({ connectionString: db }); await c.connect(); await c.query("DELETE FROM builds").catch(() => { }); await c.end(); }
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

try {
  ok((await j("GET", "/admin/builds")).status === 401, "signed out: no builds");
  const staff = await token(STAFF, 2), owner = await token(OWNER, 1);
  ok(!!staff && !!owner, "the owner and a staff member signed in (with the codes)");
  ok((await j("GET", "/admin/builds", null, staff)).status === 403, "other staff can't see the pedal builds (the software is closed)");
  ok((await j("GET", "/me", null, staff)).body.builds === false && (await j("GET", "/me", null, owner)).body.builds === true, "the account page shows Pedal builds to the owner only");
  const list0 = await j("GET", "/admin/builds", null, owner);
  ok(list0.status === 200 && list0.body.kinds.map((k) => k.id).join() === "pedal,image,audio-fw,controls-fw,other" && list0.body.maxBytes === 4.9e9, "the owner sees the five kinds of build", list0.body);

  // ---- what gets turned away
  const tries = [
    [{ kind: "nope", version: "1.0.0", name: "a.deb", size: 10 }, /Pick what/],
    [{ kind: "pedal", version: "", name: "a.deb", size: 10 }, /version/],
    [{ kind: "pedal", version: "1.0 beta", name: "a.deb", size: 10 }, /version/],
    [{ kind: "pedal", version: "1.0.0", name: "setup.exe", size: 10 }, /kind of file/],
    [{ kind: "pedal", version: "1.0.0", name: "a.deb", size: 0 }, /empty/],
    [{ kind: "image", version: "1.0.0", name: "pedal.img", size: 6e9 }, /4\.9 GB/],
  ];
  for (const [b, re] of tries) { const r = await j("POST", "/admin/builds", b, owner); ok(r.status === 400 && re.test(r.body.error || ""), "turned away: " + JSON.stringify(b), r.body); }
  ok((await j("POST", "/admin/builds", { kind: "pedal", version: "1.0.0", name: "a.deb", size: 10 }, staff)).status === 403, "other staff can't upload");

  // ---- an upload: signed link, the file, checked, its SHA-256
  const f1 = blob(300000, 1);
  const a = await j("POST", "/admin/builds", { kind: "pedal", version: "v" + V + ".0", name: "central pedal " + V + ".0 (arm64).deb", size: f1.length, notes: "First build for rev E" }, owner);
  ok(a.status === 200 && a.body.uploadUrl && a.body.build.state === "uploading" && a.body.build.version === V + ".0" && a.body.build.name === "central-pedal-" + V + ".0-arm64.deb", "a new build: its row (the name made safe, the v dropped) and a signed upload link", a.body);
  ok(!/builds\//.test(JSON.stringify(a.body.build)), "the storage key isn't handed out");
  const early = await j("POST", "/admin/builds/" + a.body.build.id + "/done", {}, owner);
  ok(early.status === 400 && /didn't reach/.test(early.body.error), "done before the file's there: it says so", early.body);
  ok((await put(a.body.uploadUrl, f1)).ok, "the file goes straight to storage");
  const done = await j("POST", "/admin/builds/" + a.body.build.id + "/done", {}, owner);
  ok(done.status === 200 && done.body.build.state === "ready" && done.body.build.ship === true && done.body.build.bytes === f1.length, "checked when it's there: ready, and the first of its kind ships", done.body);
  let got = null;
  for (let i = 0; i < 50 && !(got && got.sha256); i++) { got = (await j("GET", "/admin/builds", null, owner)).body.builds.find((x) => x.id === a.body.build.id); if (!got.sha256) await new Promise((r) => setTimeout(r, 100)); }
  ok(got && got.sha256 === sha(f1) && got.by === "Sam" && got.notes === "First build for rev E", "its SHA-256 is worked out from the stored file; who uploaded it and what changed", got);
  const dup = await j("POST", "/admin/builds", { kind: "pedal", version: V + ".0", name: "central-pedal-" + V + ".0-arm64.deb", size: 5 }, owner);
  ok(dup.status === 400 && /already/.test(dup.body.error), "the same file in the same version twice: turned away", dup.body);

  // ---- a second build: ships when told; notes
  const f2 = blob(120000, 7);
  const b = await j("POST", "/admin/builds", { kind: "pedal", version: V + ".1", name: "central-pedal-" + V + ".1.deb", size: f2.length }, owner);
  await put(b.body.uploadUrl, f2);
  const bd = await j("POST", "/admin/builds/" + b.body.build.id + "/done", {}, owner);
  ok(bd.body.build.ship === false, "a second pedal build doesn't ship by itself");
  await j("POST", "/admin/builds/" + b.body.build.id, { ship: true, notes: "Fixes the tuner" }, owner);
  let all = (await j("GET", "/admin/builds", null, owner)).body.builds;
  ok(all.find((x) => x.id === b.body.build.id).ship && !all.find((x) => x.id === a.body.build.id).ship && all.find((x) => x.id === b.body.build.id).notes === "Fixes the tuner", "Ship this one: one per kind; notes saved");

  // ---- download link
  const link = await j("GET", "/admin/builds/" + a.body.build.id + "/link", null, owner);
  const dl = await fetch(link.body.url);
  const body = Buffer.from(await dl.arrayBuffer());
  ok(link.status === 200 && dl.ok && sha(body) === sha(f1) && link.body.sha256 === sha(f1), "Download: a signed link that gives back the same file", link.body);
  ok((await j("GET", "/admin/builds/" + a.body.build.id + "/link", null, staff)).status === 403, "...and other staff can't get one");
  ok((await fetch(link.body.url.replace(/sig=[^&]+/, "sig=forged"))).status === 403, "a link with a forged signature doesn't work");
  ok((await j("GET", "/admin/builds", null, owner)).body.builds.find((x) => x.id === a.body.build.id).downloads === 1, "downloads are counted");

  // ---- a short upload is caught
  const f3 = blob(50000, 3);
  const c = await j("POST", "/admin/builds", { kind: "image", version: V + ".2", name: "central-pedal-" + V + ".2.img.xz", size: f3.length }, owner);
  await put(c.body.uploadUrl, f3.subarray(0, 20000));
  const cd = await j("POST", "/admin/builds/" + c.body.build.id + "/done", {}, owner);
  ok(cd.status === 400 && /Only 20000 of 50000/.test(cd.body.error), "only part of the file arrived: it says so and it isn't ready", cd.body);
  ok((await j("GET", "/admin/builds/" + c.body.build.id + "/link", null, owner)).status === 404, "...and it can't be downloaded");
  await j("POST", "/admin/builds/" + c.body.build.id + "/delete", {}, owner);

  // ---- delete: the file goes too, and the other build of its kind ships
  await j("POST", "/admin/builds/" + b.body.build.id + "/delete", {}, owner);
  all = (await j("GET", "/admin/builds", null, owner)).body.builds;
  ok(all.length === 1 && all[0].id === a.body.build.id && all[0].ship, "Delete: gone, and the first build ships again", all);
  const old = await j("GET", "/admin/builds/" + b.body.build.id + "/link", null, owner);
  ok(old.status === 404, "a deleted build has no link");
  ok((await j("POST", "/admin/builds/" + a.body.build.id + "/delete", {}, staff)).status === 403, "other staff can't delete");
  await j("POST", "/admin/builds/" + a.body.build.id + "/delete", {}, owner);
  ok((await fetch(link.body.url)).status !== 200, "the deleted file is gone from storage");
} catch (e) { console.error(e); fails++; }
finally { srv.kill(); stub.close(); }
if (fails) console.log(log.split("\n").slice(-30).join("\n"));
console.log(fails ? fails + " FAILED" : "all passed");
process.exit(fails ? 1 : 0);
