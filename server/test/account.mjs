// Forgot password, invite reminders, moving people between teams, and Central Services' day-before reminders,
// against a real Postgres: node test/account.mjs postgres://... [port]. Email goes to a stand-in for Resend here.
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const db = process.argv[2] || "postgres://postgres@127.0.0.1:55432/ma", port = Number(process.argv[3] || 18894), base = "http://127.0.0.1:" + port;
const S = Date.now(), STAFF = "staff" + S + "@motion.test";
const mails = [];
const mailSrv = http.createServer((req, res) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => { mails.push(JSON.parse(b || "{}")); res.writeHead(200, { "Content-Type": "application/json" }); res.end('{"id":"x"}'); }); });
await new Promise((r) => mailSrv.listen(0, "127.0.0.1", r));
process.env.DATABASE_URL = db;
const srv = spawn(process.execPath, [path.join(here, "..", "src", "index.js")], { env: Object.assign({}, process.env, { PORT: String(port), STRIPE_SECRET_KEY: "", RESEND_API_KEY: "re_test", MAIL_FROM: "Motion Audio <team@motion.test>",
  RESEND_API_URL: "http://127.0.0.1:" + mailSrv.address().port + "/emails", PUBLIC_URL: "https://motion.test", ADMIN_EMAILS: STAFF, REMINDERS: "off", TIME_ZONE: "America/Chicago" }), stdio: ["ignore", "pipe", "pipe"] });
let log = ""; srv.stdout.on("data", (d) => { log += d; }); srv.stderr.on("data", (d) => { log += d; });
for (let i = 0; i < 100 && !/Motion Audio server on/.test(log); i++) await new Promise((r) => setTimeout(r, 100));

let fails = 0;
const ok = (c, m, d) => { console.log((c ? "  ✓ " : "  ✗ ") + m + (c || d === undefined ? "" : "   -- " + JSON.stringify(d).slice(0, 600))); if (!c) fails++; };
let ipN = 0;   // (each call from its own address, so the brake on password guessing doesn't stop the test)
const j = async (method, p, body, tok) => { const r = await fetch(base + "/v1" + p, { method, headers: { "Content-Type": "application/json", "X-Forwarded-For": "10.9." + (++ipN >> 8 & 255) + "." + (ipN & 255), ...(tok ? { Authorization: "Bearer " + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); return Object.assign(await r.json().catch(() => ({})), { _status: r.status }); };
const to = (who) => mails.filter((m) => m.to && m.to[0] === who), last = (who) => to(who).pop();
const E = (n) => n + S + "@grace.test";
async function finish(r, email) {   // admins and staff finish signing in with a code (by email here: no Twilio)
  if (!r.step) return r;
  if (r.step === "phone") Object.assign(r, await j("POST", "/login/phone", { ticket: r.ticket, phone: "555-010-" + String(S).slice(-4) }));
  const m = to(email).filter((x) => /sign-in code/.test(x.subject)).pop();
  const t = await j("POST", "/login/code", { ticket: r.ticket, code: m.subject.match(/(\d{6})/)[1] });
  return Object.assign({}, r, { token: t.token });
}
try {
  const { q, one } = await import("../src/db.js");
  const { recordOrder } = await import("../src/payments.js");
  const staff = await finish(await j("POST", "/signup", { email: STAFF, password: "password123", name: "Staff" }), STAFF);

  // ---------------------------------------------------------------- forgot password
  const ana0 = await j("POST", "/signup", { email: E("ana"), password: "old-password", name: "Ana" });
  const older = ana0.token;
  await new Promise((r) => setTimeout(r, 15));
  const f1 = await j("POST", "/password/forgot", { email: E("ana").toUpperCase() });
  const f2 = await j("POST", "/password/forgot", { email: "nobody" + S + "@grace.test" });
  const resetMail = last(E("ana"));
  ok(f1.ok && f2.ok && f1.message === f2.message && resetMail && /Reset your Motion Audio password/.test(resetMail.subject) && /#reset-/.test(resetMail.text) && !to("nobody" + S + "@grace.test").length,
    "Forgot password: a link goes to the account's email; an unknown email gets the same answer and no email", [f1, f2]);
  const rtok = resetMail.text.match(/#reset-([A-Za-z0-9_-]+)/)[1];
  ok((await j("GET", "/password/reset/" + rtok)).email === E("ana"), "the link shows whose password it sets");
  ok((await j("POST", "/password/reset", { token: rtok, password: "short" }))._status === 400, "a short password is refused (and the link still works)");
  const done = await j("POST", "/password/reset", { token: rtok, password: "new-password-1" });
  ok(done.ok && done.token && (await j("GET", "/me", null, done.token)).email === E("ana"), "the new password is saved and this device is signed in", done);
  ok((await j("GET", "/me", null, older))._status === 401, "sign-ins from before the reset stop working (every other device signs in again)");
  ok((await j("POST", "/login", { email: E("ana"), password: "old-password" }))._status === 401 && !!(await j("POST", "/login", { email: E("ana"), password: "new-password-1" })).token, "the old password stops working; the new one works");
  ok((await j("POST", "/password/reset", { token: rtok, password: "another-pass" }))._status === 404 && (await j("GET", "/password/reset/" + rtok))._status === 404, "the link works once");
  await q("UPDATE password_resets SET expires_at = now() - interval '1 minute' WHERE user_id=(SELECT id FROM users WHERE email=$1)", [E("ana")]);
  const n0 = to(E("ana")).length;
  for (let i = 0; i < 4; i++) await j("POST", "/password/forgot", { email: E("ana") });
  ok(to(E("ana")).length === n0 + 2, "at most 3 links an hour per account", to(E("ana")).length - n0);
  const expired = last(E("ana")).text.match(/#reset-([A-Za-z0-9_-]+)/)[1];
  await q("UPDATE password_resets SET expires_at = now() - interval '1 minute' WHERE user_id=(SELECT id FROM users WHERE email=$1)", [E("ana")]);
  ok((await j("POST", "/password/reset", { token: expired, password: "another-pass" }))._status === 404, "a link older than an hour doesn't work");

  // ---------------------------------------------------------------- a church with keys and a team
  const pastor = await finish(await j("POST", "/signup", { email: E("pastor"), password: "password123", name: "Pastor", churchName: "Grace Church" }), E("pastor"));
  const T = pastor.token, cid = (await one("SELECT church_id FROM church_members WHERE user_id=(SELECT id FROM users WHERE email=$1)", [E("pastor")])).church_id;
  await recordOrder({ id: "cs_a_" + S, metadata: { items: JSON.stringify({ "pack-small": "1" }), church_id: String(cid) }, amount_total: 30000, customer_details: { email: "p@grace.test" } }, null);
  await q("UPDATE churches SET has_services=TRUE WHERE id=$1", [cid]);   // (Central Services' monthly plan)
  const addU = await j("POST", "/church/team", { section: "user", members: [{ name: "Cal", email: E("cal"), role: "Drums" }, { name: "Dee", email: E("dee"), role: "Vocals" }] }, T);
  const addA = await j("POST", "/church/team", { section: "admin", members: [{ name: "Eli", email: E("eli"), role: "Lights" }] }, T);
  ok(addU.results.every((r) => r.ok) && addA.results[0].ok, "Teams: two users and an admin added", [addU, addA]);

  // ---------------------------------------------------------------- move between teams
  const cal = await j("POST", "/signup", { email: E("cal"), password: "password123", name: "Cal", invite: to(E("cal"))[0].text.match(/#invite-([A-Za-z0-9_-]+)/)[1] });
  const oldKey = addU.results[0].key;
  await j("POST", "/license/activate", { key: oldKey, device: "dev-cal-" + S, deviceName: "Cal's tablet", app: "usage" });
  await j("POST", "/license/link", { key: oldKey, device: "dev-cal-" + S }, cal.token);
  let team = await j("GET", "/church/team", null, T);
  const calId = team.sections.user.find((m) => m.name === "Cal").id, freeA = team.free.admin, freeU = team.free.user;
  const mv = await j("POST", "/church/team/move", { id: calId, section: "admin" }, T);
  team = await j("GET", "/church/team", null, T);
  const calNow = team.sections.admin.find((m) => m.name === "Cal");
  ok(mv.ok && /^A/.test(mv.key) && calNow && calNow.status === "joined" && !team.sections.user.some((m) => m.name === "Cal"), "Move: Cal goes from Users to Admins with a new A key", mv);
  ok(team.free.admin === freeA - 1 && team.free.user === freeU + 1, "...his old U key is free again, one fewer A key left", team.free);
  ok((await j("POST", "/license/check", { key: oldKey, device: "dev-cal-" + S })).ok === false, "...and the old key stops working on his tablet");
  ok((await j("GET", "/me", null, cal.token)).church.role === "admin", "...he's an admin in the church now");
  const mvMail = last(E("cal"));
  ok(/moved you to Central Control/.test(mvMail.subject) && mvMail.text.includes(mv.key) && /#control\b/.test(mvMail.text) && /Sign in with your account/.test(mvMail.text), "...and his email has Central Control's download, the new key, and says to sign in", mvMail.subject);
  ok((await j("POST", "/license/activate", { key: mv.key, device: "dev-cal-" + S, deviceName: "Cal's laptop", app: "control" })).ok && (await j("POST", "/license/link", { key: mv.key, device: "dev-cal-" + S }, cal.token)).ok, "...the new key works in Central Control with his account");
  const back = await j("POST", "/church/team/move", { id: calId, section: "user" }, T);
  ok(back.ok && /^U/.test(back.key) && (await j("GET", "/me", null, cal.token)).church.role === "user", "moving back to Users makes him a user again", back);
  ok((await j("POST", "/church/team/move", { id: calId, section: "user" }, T))._status === 400, "moving to the team they're on is refused");
  const p1 = await j("POST", "/church/team/move", { id: calId, section: "pedal" }, T);
  const p3 = await j("POST", "/church/team/move", { id: team.sections.admin.find((m) => m.name === "Eli").id, section: "pedal" }, T);
  ok(p1.ok && p3._status === 409 && /No P keys left/.test(p3.error), "with no keys of the new kind left, Move says so and nothing changes", [p1.ok, p3]);
  ok((await j("GET", "/church/team", null, T)).sections.admin.some((m) => m.name === "Eli"), "...Eli is still an admin");
  ok((await j("POST", "/church/team/move", { id: calId, section: "admin" }, cal.token))._status === 403, "users can't move people");

  // ---------------------------------------------------------------- invite reminders
  const run = () => j("POST", "/admin/reminders", null, staff.token);
  ok((await j("POST", "/admin/reminders", null, T))._status === 403, "only Motion Audio staff can send the reminders by hand (they go out by themselves every hour)");
  await q("UPDATE invites SET reminders=0, reminded_at=NULL WHERE church_id=$1", [cid]);
  let r0 = await run(), eliN = to(E("eli")).length;
  ok(r0.invites === 0, "a fresh invite gets no reminder", r0);
  await q("UPDATE invites SET sent_at = now() - interval '4 days' WHERE church_id=$1 AND email=$2", [cid, E("eli")]);
  await q("UPDATE invites SET sent_at = now() - interval '4 days' WHERE church_id=$1 AND email=$2", [cid, E("cal")]);   // (Cal made his account: none for him)
  r0 = await run();
  ok(r0.invites === 1 && to(E("eli")).length === eliN + 1 && /^Reminder: /.test(last(E("eli")).subject) && /key is waiting/.test(last(E("eli")).text) && last(E("eli")).text.includes(addA.results[0].key), "3 days with no account: a reminder with the same link and key (not for people who joined)", r0);
  ok((await run()).invites === 0, "...only once");
  await q("UPDATE invites SET reminded_at = now() - interval '5 days' WHERE church_id=$1 AND email=$2", [cid, E("eli")]);
  ok((await run()).invites === 1, "a second reminder after 7 days");
  await q("UPDATE invites SET reminded_at = now() - interval '30 days', sent_at = now() - interval '40 days' WHERE church_id=$1 AND email=$2", [cid, E("eli")]);
  ok((await run()).invites === 0, "...then no more");
  ok((await j("GET", "/church/team", null, T)).sections.admin.find((m) => m.name === "Eli").reminders === 2, "the Teams page shows how many reminders went out");

  // ---------------------------------------------------------------- Central Services: the day before
  const w = await j("POST", "/services/teams", { kind: "worship", name: "Band" }, T);
  await j("POST", "/services/teams/" + w.id + "/members", { members: [{ name: "Cal", email: E("cal"), role: "Drums" }, { name: "Dee", email: E("dee"), role: "Vocals" }, { name: "Fay", email: E("fay"), role: "Keys" }] }, T);
  const soon = await j("POST", "/services/events", { title: "Evening service", startsAt: new Date(Date.now() + 10 * 3600e3).toISOString(), teams: [w.id] }, T);
  const later = await j("POST", "/services/events", { title: "Next month", startsAt: new Date(Date.now() + 30 * 864e5).toISOString(), teams: [w.id] }, T);
  let board = await j("GET", "/services/board", null, T);
  const reqs = board.services.find((s) => s.title === "Evening service").requests, byName = (n) => reqs.find((r) => r.name === n);
  await j("POST", "/services/requests/" + byName("Cal").id, { status: "accepted" }, cal.token);
  const fay = await j("POST", "/signup", { email: E("fay"), password: "password123", name: "Fay" });
  await q("UPDATE service_requests SET status='declined' WHERE id=$1", [byName("Fay").id]);
  ok((await run()).services === 0, "nobody asked in the last hour gets a reminder (they just got the ask)");
  await q("UPDATE service_requests SET asked_at = now() - interval '2 hours' WHERE service_id = ANY($1)", [[soon.id, later.id].map(Number)]);
  const calN = to(E("cal")).length, deeN = to(E("dee")).length, fayN = to(E("fay")).length;
  const rs = await run();
  ok(rs.services === 2, "the day before: two reminders (not for a service a month away)", rs);
  ok(/^Reminder: you're serving at Evening service/.test(last(E("cal")).subject) && /as Drums/.test(last(E("cal")).text) && to(E("cal")).length === calN + 1, "accepted: \"you're serving\", with the role", last(E("cal")).subject);
  ok(/^Please answer: Evening service/.test(last(E("dee")).subject) && /haven't answered/.test(last(E("dee")).text) && to(E("dee")).length === deeN + 1, "not answered yet: \"please answer\"", last(E("dee")).subject);
  ok(to(E("fay")).length === fayN, "declined: nothing");
  ok((await run()).services === 0, "...each only once");
  void fay; void later;
} finally { srv.kill(); mailSrv.close(); }
console.log(fails ? "\n" + fails + " ACCOUNT CHECK(S) FAILED\n" + log.slice(-2500) : "\nALL ACCOUNT & REMINDER CHECKS PASSED");
process.exit(fails ? 1 : 0);
