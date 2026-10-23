// 9.5: the default keys (P, A, U and the S package key) - accepted while staff keep them on, each for its own kind,
// on any number of devices; switched off, the apps are told it was a temporary key.
//   node test/defaultkeys.mjs postgres://... [port]
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const db = process.argv[2] || "postgres://postgres@127.0.0.1:55432/ma", port = Number(process.argv[3] || 18996), base = "http://127.0.0.1:" + port;
const S = Date.now(), STAFF = "staffdk" + S + "@motion.test";
const mails = [];
const mailSrv = http.createServer((req, res) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => { mails.push(JSON.parse(b || "{}")); res.end('{"id":"x"}'); }); });
await new Promise((r) => mailSrv.listen(0, "127.0.0.1", r));
process.env.DATABASE_URL = db;
const srv = spawn(process.execPath, [path.join(here, "..", "src", "index.js")], { env: Object.assign({}, process.env, { DATABASE_URL: db, PORT: String(port), STRIPE_SECRET_KEY: "", RESEND_API_KEY: "re_test", MAIL_FROM: "M <t@motion.test>",
  RESEND_API_URL: "http://127.0.0.1:" + mailSrv.address().port + "/emails", PUBLIC_URL: "https://motion.test", ADMIN_EMAILS: STAFF, REMINDERS: "off" }), stdio: ["ignore", "pipe", "pipe"] });
let log = ""; srv.stdout.on("data", (d) => { log += d; }); srv.stderr.on("data", (d) => { log += d; });
for (let i = 0; i < 100 && !/Motion Audio server on/.test(log); i++) await new Promise((r) => setTimeout(r, 100));

let fails = 0, ipN = 0;
const ok = (c, m, d) => { console.log((c ? "  ✓ " : "  ✗ ") + m + (c || d === undefined ? "" : "   -- " + JSON.stringify(d).slice(0, 600))); if (!c) fails++; };
const j = async (method, p, body, tok) => { const r = await fetch(base + "/v1" + p, { method, headers: { "Content-Type": "application/json", "X-Forwarded-For": "10.96." + (++ipN % 200) + ".1", ...(tok ? { Authorization: "Bearer " + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); return Object.assign(await r.json().catch(() => ({})), { _status: r.status }); };
async function finish(r, email) {
  if (!r.step) return r;
  if (r.step === "phone") Object.assign(r, await j("POST", "/login/phone", { ticket: r.ticket, phone: "555-096-" + String(S).slice(-4) }));
  const m = mails.filter((x) => x.to && x.to[0] === email && /sign-in code/.test(x.subject)).pop();
  return Object.assign({}, r, { token: (await j("POST", "/login/code", { ticket: r.ticket, code: m.subject.match(/(\d{6})/)[1] })).token });
}
const P = "PDEF-AULT-KEY0-2026", A = "ADEF-AULT-KEY0-2026", U = "UDEF-AULT-KEY0-2026", SK = "SDEF-AULT-KEY0-2026";
const dev = (n) => "dev-dk-" + S + "-" + n;

try {
  const { q } = await import("../src/db.js");
  await q("DELETE FROM site_settings WHERE name='default_keys'");   // (on by default)
  const a1 = await j("POST", "/license/activate", { key: A, device: dev(1), app: "control" });
  ok(a1.ok && a1.key === A && a1.kind === "A" && a1.church === "Motion Audio (default key)" && a1.updatesUntil === null && a1.updatesUntilText === "forever" && a1.expiresAt === null && a1.tracksUnlimited === false && a1.trial === false,
    "the default A key works in Central Control: no church of its own, updates always, no end, no Central Tracks Unlimited", a1);
  const many = await Promise.all([2, 3, 4, 5].map((n) => j("POST", "/license/activate", { key: "udef-ault-key0-2026", device: dev(n), app: "usage" })));
  ok(many.every((x) => x.ok && x.kind === "U"), "the default U key works on any number of devices (and in any capitals)", many.map((x) => x.ok));
  const pc = await j("POST", "/license/activate", { key: P, device: dev(6), app: "pedal-control" });
  ok(pc.ok && pc.kind === "P", "the default P key works in Central Pedal Control", pc);
  const wrong = await j("POST", "/license/activate", { key: U, device: dev(7), app: "control" });
  const wrong2 = await j("POST", "/license/activate", { key: SK, device: dev(7), app: "usage" });
  ok(wrong._status === 400 && /Central Control needs an A key/.test(wrong.error) && wrong2._status === 404, "each only for its own app (U isn't for Central Control; S is a package, not a license key)", { wrong, wrong2 });
  const c1 = await j("POST", "/license/check", { key: A, device: dev(99) });
  ok(c1.ok && c1.kind === "A" && c1.recheckDays === 30 && c1.updatesUntil === null && c1.tracksUnlimited === false && !("key" in c1), "the check: ok, on any device", c1);
  const p1 = await j("POST", "/package/activate", { key: SK, deviceId: dev(8), app: "usage" });
  ok(p1.ok && ["keys", "plugins", "instrument", "pedals"].every((id) => p1.plans[id] === "2099-12-31T00:00:00.000Z") && p1.church === "Motion Audio (default key)" && p1.key === SK, "the default S package key: all four sound plans", p1);
  const p2 = await j("POST", "/package/check", { keys: [SK], deviceId: dev(9) });
  ok(p2.packages[0].ok && p2.packages[0].plans.keys && p2.packages[0].end === "2099-12-31T00:00:00.000Z", "...on any device", p2);
  ok((await j("POST", "/package/release", { key: SK, deviceId: dev(8) })).ok && (await j("POST", "/license/release", { key: A, device: dev(1) })).ok, "release: ok (nothing to free)");
  const u = await j("POST", "/signup", { email: "dkuser" + S + "@grace.test", password: "password123", name: "U" });
  ok((await j("POST", "/license/link", { key: U, device: dev(2) }, u.token)).ok, "signing in with a default key changes nothing (it's nobody's)");
  ok(!(await q("SELECT 1 FROM licenses WHERE regexp_replace(key,'-','','g') LIKE '%DEFAULTKEY02026'")).length, "no rows: the default keys aren't in the database");

  // ---- staff switch them off
  const st = (await finish(await j("POST", "/signup", { email: STAFF, password: "password123" }), STAFF)).token;
  ok((await j("GET", "/admin/default-keys", null, u.token))._status === 403, "only Motion Audio staff see the switch");
  const g = await j("GET", "/admin/default-keys", null, st);
  ok(g.on === true && g.keys.P === P && g.keys.A === A && g.keys.U === U && g.keys.S === SK, "the staff card: on, with the four keys", g);
  ok((await j("POST", "/admin/default-keys", { on: false }, st)).on === false, "Switch them off");
  const off1 = await j("POST", "/license/check", { key: A, device: dev(1) });
  ok(off1.ok === false && off1.reason === "invalid" && /This was a temporary key\. Ask your church for its own key, or buy one at https:\/\/motion\.test\./.test(off1.message), "off: the check says invalid - it was a temporary key", off1);
  const off2 = await j("POST", "/license/activate", { key: U, device: dev(10), app: "usage" });
  ok(off2._status === 403 && /temporary key/.test(off2.error), "...and it can't be entered again", off2);
  const off3 = await j("POST", "/package/check", { keys: [SK], deviceId: dev(9) }), off4 = await j("POST", "/package/activate", { key: SK, deviceId: dev(11), app: "usage" });
  ok(off3.packages[0].ok === false && /temporary key/.test(off3.packages[0].error) && off4.ok === false && /temporary key/.test(off4.error), "...the package key too", { off3, off4 });
  ok((await j("POST", "/admin/default-keys", { on: true }, st)).on && (await j("POST", "/license/check", { key: A, device: dev(1) })).ok, "Switch them on again: they work again");
} catch (e) { console.error(e); fails++; }
finally { srv.kill(); mailSrv.close(); if (fails) console.log(log.slice(-3000)); console.log(fails ? "\n" + fails + " CHECK(S) FAILED" : "\nALL CHECKS PASSED"); process.exit(fails ? 1 : 0); }
