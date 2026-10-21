// 9.3.1: the church account - the church signs up with its own email; that account pays, holds the keys and slots, adds
// the main admins (up to 2, with their own accounts), admins and users, and uses no Central Services slot.
//   node test/v931.mjs postgres://... [port]
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const db = process.argv[2] || "postgres://postgres@127.0.0.1:55432/ma", port = Number(process.argv[3] || 18931), base = "http://127.0.0.1:" + port;
const mails = [];
const mailSrv = http.createServer((req, res) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => { mails.push(JSON.parse(b || "{}")); res.writeHead(200, { "Content-Type": "application/json" }); res.end('{"id":"x"}'); }); });
await new Promise((r) => mailSrv.listen(0, "127.0.0.1", r));
process.env.DATABASE_URL = db;
const srv = spawn(process.execPath, [path.join(here, "..", "src", "index.js")], { env: Object.assign({}, process.env, { PORT: String(port), STRIPE_SECRET_KEY: "", RESEND_API_KEY: "re_test", MAIL_FROM: "Motion Audio <team@motion.test>", RESEND_API_URL: "http://127.0.0.1:" + mailSrv.address().port + "/emails", PUBLIC_URL: "https://motion.test" }), stdio: ["ignore", "pipe", "pipe"] });
let log = ""; srv.stdout.on("data", (d) => { log += d; }); srv.stderr.on("data", (d) => { log += d; });
for (let i = 0; i < 100 && !/Motion Audio server on/.test(log); i++) await new Promise((r) => setTimeout(r, 100));

let fails = 0;
const ok = (c, m, d) => { console.log((c ? "  ✓ " : "  ✗ ") + m + (c || d === undefined ? "" : "   -- " + JSON.stringify(d).slice(0, 600))); if (!c) fails++; };
const j = async (method, p, body, tok) => { const r = await fetch(base + "/v1" + p, { method, headers: { "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); return Object.assign(await r.json().catch(() => ({})), { _status: r.status }); };
const S = Date.now(), E = (n) => n + S + "@grace931.test", mail = (to) => mails.filter((m) => m.to && m.to[0] === to);
async function finish(r, email) {   // (staff finish signing in with a code: here it comes by email)
  if (!r.step) return r;
  if (r.step === "phone") Object.assign(r, await j("POST", "/login/phone", { ticket: r.ticket, phone: "555-011-" + String(S).slice(-4) }));
  const m = mail(email).filter((x) => /sign-in code/.test(x.subject)).pop();
  const t = await j("POST", "/login/code", { ticket: r.ticket, code: m.subject.match(/(\d{6})/)[1] });
  return Object.assign({}, r, { token: t.token });
}
const invTok = (who) => (mail(who).map((m) => m.text).join("\n").match(/#invite-([A-Za-z0-9_-]+)/g) || []).pop().split("#invite-")[1];

try {
  const { one, q } = await import("../src/db.js");
  // ---- the church signs up with its own email
  const office = await finish(await j("POST", "/signup", { email: E("office"), password: "password123", name: "Grace Church", churchName: "Grace Church" }), E("office"));
  let me = await j("GET", "/me", null, office.token);
  ok(me.church && me.church.name === "Grace Church" && me.church.role === "church", "signing up with the church's name makes the church account (role: church)", me.church);
  const cid = (await one("SELECT id, owner_id FROM churches WHERE name='Grace Church' AND owner_id=(SELECT id FROM users WHERE email=$1)", [E("office")]));
  ok(!!cid, "the church account is the billing contact (receipts go to the church's email)");
  const O = office.token;

  // ---- the church account invites its first main admin (their own email)
  const sameEmail = await j("POST", "/church/owner", { name: "Office", email: E("office") }, O);
  ok(sameEmail._status === 400 && /church account/.test(sameEmail.error), "a main admin can't be the church's own email", sameEmail);
  const inv1 = await j("POST", "/church/owner", { name: "Pastor Dan", email: E("dan") }, O);
  ok(inv1.ok && inv1.sent && /a main admin of Grace Church/.test(mail(E("dan"))[0].subject), "the church account invites a main admin; the email says they're a main admin of the church", inv1);
  const dan = await finish(await j("POST", "/signup", { email: E("dan"), password: "password123", name: "Dan", invite: invTok(E("dan")) }), E("dan"));
  me = await j("GET", "/me", null, dan.token);
  const meO = await j("GET", "/me", null, O);
  ok(me.church.role === "owner" && meO.church.role === "church", "Dan is a main admin; the church account stays the church account", [me.church.role, meO.church.role]);
  ok((await one("SELECT owner_id FROM churches WHERE id=$1", [cid.id])).owner_id === cid.owner_id, "...and the billing stays with the church account");
  const D = dan.token;

  // ---- people: the church account can't be changed or taken out; it isn't one of the 2 main admins
  const ch = await j("GET", "/church", null, O);
  const roles = Object.fromEntries(ch.members.map((m) => [m.email, m.role]));
  ok(roles[E("office")] === "church" && roles[E("dan")] === "owner" && ch.members[0].role === "church" && ch.church.adminCode, "People lists the church account first, then the main admins; the church account sees the admin code", ch.members);
  ok((await j("POST", "/church/role", { email: E("office"), role: "user" }, D))._status === 400, "a main admin can't change the church account's role");
  ok((await j("POST", "/church/remove", { email: E("office") }, D))._status === 400, "...or take it out");
  ok((await j("POST", "/church/main-admin", { email: E("office"), on: false }, D))._status === 400, "...or make it 'back to admin'");
  const ho = await j("POST", "/church/handover", { email: E("dan"), password: "password123" }, O);
  ok(ho._status === 400 && /church account keeps/.test(ho.error), "the church account doesn't hand itself over", ho);

  // ---- a second main admin: an admin promoted by the church account; a third is refused
  const amy = await finish(await j("POST", "/signup", { email: E("amy"), password: "password123", name: "Amy", churchCode: ch.church.adminCode, churchRole: "admin" }), E("amy"));
  const tim = await finish(await j("POST", "/signup", { email: E("tim"), password: "password123", name: "Tim", churchCode: ch.church.adminCode, churchRole: "admin" }), E("tim"));
  ok(amy.token && tim.token, "two admins join with the admin code");
  const p2 = await j("POST", "/church/main-admin", { email: E("amy"), on: true }, O);
  ok(p2.ok && p2.mainAdmins === 2, "the church account makes Amy the second main admin", p2);
  const p3 = await j("POST", "/church/main-admin", { email: E("tim"), on: true }, D);
  ok(p3._status === 409 && /2 main admins already/.test(p3.error), "a third main admin is refused (the church account doesn't count toward the 2)", p3);
  const inv3 = await j("POST", "/church/owner", { name: "Tim", email: E("tim2") }, O);
  ok(inv3._status === 409, "...and so is a third main admin invite", inv3);

  // ---- with a church account, the main admins can all step down: the church keeps going
  ok((await j("POST", "/church/main-admin", { email: E("amy"), on: false }, D)).ok, "Amy back to admin");
  const down = await j("POST", "/church/main-admin", { email: E("dan"), on: false }, D);
  ok(down.ok && down.mainAdmins === 0, "Dan steps down too: the church account still has the controls", down);
  ok((await j("POST", "/church/main-admin", { email: E("dan"), on: true }, O)).ok, "the church account makes Dan a main admin again");

  // ---- Central Services: everyone on a team uses a slot, except the church account
  await q("UPDATE churches SET services_slots=2 WHERE id=$1", [cid.id]);
  const board = await j("GET", "/services/board", null, O);
  ok(board.role === "scheduler", "the church account schedules (with the main admins) until someone picks schedulers", board.role);
  const t = await j("POST", "/services/teams", { kind: "worship", name: "Band" }, O);
  const teamId = t.id;
  const add = await j("POST", "/services/teams/" + teamId + "/members", { members: [{ email: E("office"), name: "Church office" }, { email: E("dan"), name: "Dan" }, { email: E("amy"), name: "Amy" }] }, O);
  ok(add.ok !== false && add._status === 200, "with 2 slots: the church account, Dan and Amy all fit on the band (the church account is free)", add);
  const slots = await j("GET", "/services/slots", null, O);
  ok(slots.slots === 2 && slots.used === 2 && slots.free === 0, "the slots card counts 2 of 2 in use, not 3", slots);
  const over = await j("POST", "/services/teams/" + teamId + "/members", { members: [{ email: E("tim"), name: "Tim" }] }, O);
  ok(over._status === 402 && /2 Central Services slots and 2 are in use/.test(over.error), "a third person needs a slot", over);
  const sch = await j("POST", "/services/schedulers", { emails: [E("dan")] }, O);
  ok(sch.ok, "the church account picks the schedulers", sch);

  // ---- buying: the church account, the main admins and admins buy; a user doesn't
  const u = await j("POST", "/signup", { email: E("ula"), password: "password123", name: "Ula", churchCode: ch.church.userCode, churchRole: "user" });
  await q("UPDATE users SET email_confirmed=TRUE WHERE email LIKE $1", ["%" + S + "@grace931.test"]);
  for (const [who, tok, want] of [["church account", O, true], ["main admin", D, true], ["admin", tim.token, true], ["user", u.token, false]]) {
    const r = await j("POST", "/checkout/store/check", { items: { user: 1 } }, tok);
    ok(want ? r._status === 200 && !r.error : r._status === 403, "the " + who + (want ? " can" : " can't") + " buy for the church", r);
  }

  // ---- deleting: the church account with nobody else as main admin can't leave the church without a main admin
  await j("POST", "/church/main-admin", { email: E("dan"), on: false }, O);
  const del = await j("POST", "/account/delete", { password: "password123" }, O);
  ok(del._status === 409 && /church account/.test(del.error), "the church account can't delete itself while people are in the church and nobody else is a main admin", del);
  await j("POST", "/church/main-admin", { email: E("dan"), on: true }, O);
  const del2 = await j("POST", "/account/delete", { password: "password123" }, O);
  ok(del2.ok, "with a main admin, it can: Dan carries on", del2);
  ok((await one("SELECT owner_id FROM churches WHERE id=$1", [cid.id])).owner_id === (await one("SELECT id FROM users WHERE email=$1", [E("dan")])).id, "...and Dan is the billing contact now");
} catch (e) { console.error(e); fails++; }
finally { srv.kill(); mailSrv.close(); if (fails) console.log(log.slice(-3000)); console.log(fails ? "\n" + fails + " CHECK(S) FAILED" : "\nALL CHECKS PASSED"); process.exit(fails ? 1 : 0); }
