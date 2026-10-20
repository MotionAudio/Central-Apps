// 8.13 against a real Postgres: confirm email, the admins' phone code (Twilio stand-in), delete my account, the main
// admin's controls (roles, hand over), church billing, blockout dates, song lists, error alerts, Contact support and
// the nightly backup with a restore into an empty database.
//   node test/v813.mjs postgres://.../ma [port]      (it makes and drops a database next to it for the restore)
import { spawn, execFileSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const db = process.argv[2] || "postgres://postgres@127.0.0.1:55432/ma", port = Number(process.argv[3] || 18896), base = "http://127.0.0.1:" + port;
const S = Date.now(), STAFF = "staff" + S + "@motion.test", HELP = "help" + S + "@motion.test", files = fs.mkdtempSync(path.join(os.tmpdir(), "ma813-"));
const mails = [], texts = [];
const stub = http.createServer((req, res) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => {
  if (req.url.includes("/Messages.json")) { const p = new URLSearchParams(b); texts.push({ to: p.get("To"), body: p.get("Body"), auth: req.headers.authorization }); res.writeHead(201); return res.end("{}"); }
  mails.push(JSON.parse(b || "{}")); res.writeHead(200, { "Content-Type": "application/json" }); res.end('{"id":"x"}'); }); });
await new Promise((r) => stub.listen(0, "127.0.0.1", r));
const SB = "http://127.0.0.1:" + stub.address().port;
process.env.DATABASE_URL = db; process.env.LOCAL_STORAGE_DIR = files;
const env = Object.assign({}, process.env, { PORT: String(port), STRIPE_SECRET_KEY: "", RESEND_API_KEY: "re_test", MAIL_FROM: "Motion Audio <team@motion.test>", RESEND_API_URL: SB + "/emails",
  PUBLIC_URL: "https://motion.test", ADMIN_EMAILS: STAFF, REMINDERS: "off", TIME_ZONE: "America/Chicago", SUPPORT_EMAIL: HELP,
  TWILIO_ACCOUNT_SID: "AC_test", TWILIO_AUTH_TOKEN: "tok", TWILIO_FROM: "+15550000000", TWILIO_API_URL: SB, LOCAL_STORAGE_DIR: files });
const srv = spawn(process.execPath, [path.join(here, "..", "src", "index.js")], { env, stdio: ["ignore", "pipe", "pipe"] });
let log = ""; srv.stdout.on("data", (d) => { log += d; }); srv.stderr.on("data", (d) => { log += d; });
for (let i = 0; i < 100 && !/Motion Audio server on/.test(log); i++) await new Promise((r) => setTimeout(r, 100));

let fails = 0;
const ok = (c, m, d) => { console.log((c ? "  ✓ " : "  ✗ ") + m + (c || d === undefined ? "" : "   -- " + JSON.stringify(d).slice(0, 600))); if (!c) fails++; };
let ipN = 0;
const j = async (method, p, body, tok) => { const r = await fetch(base + "/v1" + p, { method, headers: { "Content-Type": "application/json", "X-Forwarded-For": "10.8." + (++ipN >> 8 & 255) + "." + (ipN & 255), ...(tok ? { Authorization: "Bearer " + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); return Object.assign(await r.json().catch(() => ({})), { _status: r.status }); };
const to = (who) => mails.filter((m) => m.to && m.to[0] === who), last = (who) => to(who).pop();
const E = (n) => n + S + "@hope.test", PHONE = "(555) 010-" + String(S).slice(-4), PHONE2 = "555-020-" + String(S).slice(-4);
const codeFor = (phone) => { const t = texts.filter((x) => x.to === phone).pop(); return t && t.body.match(/^(\d{6})/)[1]; };
const plus = (p) => "+1" + p.replace(/\D/g, "");
const emailCode = (who) => { const m = to(who).filter((x) => /sign-in code/.test(x.subject)).pop(); return m && m.subject.match(/(\d{6})/)[1]; };
// an admin finishing a sign-in: the phone (if asked), then the texted code (and the emailed one when adding a phone)
async function adminIn(r, email, phone) {
  if (!r.step) return r;
  if (r.step === "phone") Object.assign(r, await j("POST", "/login/phone", { ticket: r.ticket, phone }));
  const t = await j("POST", "/login/code", { ticket: r.ticket, code: codeFor(plus(phone)), emailCode: r.both ? emailCode(email) : undefined });
  return Object.assign({}, r, { token: t.token, codeAnswer: t });
}
try {
  const { q, one } = await import("../src/db.js");
  const { recordOrder } = await import("../src/payments.js");

  // ---------------------------------------------------------------- confirm email
  const u1 = await j("POST", "/signup", { email: E("una"), password: "password123", name: "Una" });
  let me = await j("GET", "/me", null, u1.token);
  ok(u1.token && me.emailConfirmed === false && /Confirm your email/.test(last(E("una")).subject), "a new account gets a confirm link and isn't confirmed yet", me);
  const co = await j("POST", "/checkout/store", { items: { user: 1 }, church: "X" }, u1.token);
  ok(co._status === 403 && co.needConfirm, "checkout waits for a confirmed email (receipts and keys go there)", co);
  const ctok = last(E("una")).text.match(/#confirm-([A-Za-z0-9_-]+)/)[1];
  ok((await j("POST", "/account/confirm", { token: ctok })).ok && (await j("GET", "/me", null, u1.token)).emailConfirmed === true, "the link confirms it");
  ok((await j("POST", "/account/confirm", { token: ctok }))._status === 404, "...once");

  // ---------------------------------------------------------------- the main admin: email, password and a code to the phone
  const p0 = await j("POST", "/signup", { email: E("pastor"), password: "password123", name: "Pastor", churchName: "Hope " + S, device: "dev-desk-" + S });
  ok(p0.step === "phone" && p0.ticket && !p0.token && p0.by === "text", "making a church (main admin): before signing in, they add their phone", p0);
  ok((await j("POST", "/login/phone", { ticket: p0.ticket, phone: "12" }))._status === 400, "a phone number that isn't one is refused");
  const ph = await j("POST", "/login/phone", { ticket: p0.ticket, phone: PHONE });
  ok(ph.step === "code" && ph.both && ph.to.endsWith(PHONE.slice(-4)) && texts.length === 1 && texts[0].to === plus(PHONE) && /^Basic /.test(texts[0].auth) && emailCode(E("pastor")), "adding the phone: a code is texted to it (through Twilio) and another is emailed", [ph, texts[0]]);
  ok((await j("POST", "/login/code", { ticket: p0.ticket, code: codeFor(plus(PHONE)) }))._status === 401, "the texted code alone isn't enough to add a phone (the password and a phone aren't proof of the email)");
  const bad1 = await j("POST", "/login/code", { ticket: p0.ticket, code: "000000" === codeFor(plus(PHONE)) ? "111111" : "000000", emailCode: emailCode(E("pastor")) });
  ok(bad1._status === 401 && /3 tries left/.test(bad1.error), "a wrong code says how many tries are left", bad1);
  const done = await j("POST", "/login/code", { ticket: p0.ticket, code: codeFor(plus(PHONE)), emailCode: emailCode(E("pastor")) });
  me = await j("GET", "/me", null, done.token);
  ok(done.token && me.phoneConfirmed && me.twoStep && me.church.role === "owner" && /A phone was added/.test(to(E("pastor")).filter((m) => /phone was added/.test(m.subject)).pop().subject), "both codes sign them in; the phone is confirmed, and an email says a phone was added", me);
  const T = done.token;
  const again = await j("POST", "/login", { email: E("pastor"), password: "password123", device: "dev-desk-" + S });
  ok(again.token && !again.step, "the same device is trusted for 30 days: email and password are enough", again);
  const nd = await j("POST", "/login", { email: E("pastor"), password: "password123", device: "dev-laptop-" + S });
  ok(nd.step === "code" && !nd.token && texts.length === 2, "a new device: email, password, and a code to the phone", nd);
  const nd2 = await j("POST", "/login/resend", { ticket: nd.ticket });
  ok(nd2.step === "code" && !nd2.both && texts.length === 3 && (await j("POST", "/login/code", { ticket: nd.ticket, code: codeFor(plus(PHONE)) })).token, "Send again sends a new code, and it works (a confirmed phone: just the text)", nd2);
  const race = await j("POST", "/login", { email: E("pastor"), password: "password123", device: "dev-race-" + S });
  const guesses = await Promise.all(Array.from({ length: 40 }, (_, i) => j("POST", "/login/code", { ticket: race.ticket, code: String(100000 + i) })));
  ok(guesses.filter((g) => g._status === 401).length <= 5 && guesses.every((g) => !g.token), "guesses sent all at once still get only 5 tries", guesses.map((g) => g._status).join(","));
  ok((await j("POST", "/login", { email: E("una"), password: "password123", device: "dev-x-" + S })).token, "users (not admins) just use email and password");
  ok((await j("POST", "/account/phone", { phone: PHONE2, password: "nope" }, T))._status === 403, "changing the phone needs the password");
  const chg = await j("POST", "/account/phone", { phone: PHONE2, password: "password123" }, T);
  ok(chg.step === "code" && chg.to.endsWith(PHONE2.slice(-4)) && (await j("GET", "/me", null, T)).phone.endsWith(PHONE.slice(-4)), "...with it, a code goes to the new number (the old one stays until it's confirmed)", chg);
  const cf = await j("POST", "/account/phone/confirm", { ticket: chg.ticket, code: codeFor(plus(PHONE2)) }, T);
  ok(cf.ok && (await j("GET", "/me", null, T)).phone.endsWith(PHONE2.slice(-4)), "the code confirms the new number", cf);
  const np = await j("POST", "/login", { email: E("pastor"), password: "password123", device: "dev-desk-" + S });
  ok(np.step === "code" && np.to.endsWith(PHONE2.slice(-4)), "...then every device confirms with a code to it at the next sign-in", np);
  ok(!!(await j("POST", "/login/code", { ticket: np.ticket, code: codeFor(plus(PHONE2)) })).token, "...and that works");
  const hacker = await j("POST", "/login", { email: E("pastor"), password: "password123", device: "dev-evil-" + S });
  ok((await j("POST", "/login/phone", { ticket: hacker.ticket, phone: "555-099-0000" }))._status === 409, "someone with only the password can't put their own phone on an admin's account");

  // ---------------------------------------------------------------- keys, people, and the main admin's controls
  const cid = (await one("SELECT church_id FROM church_members WHERE user_id=(SELECT id FROM users WHERE email=$1)", [E("pastor")])).church_id;
  await recordOrder({ id: "cs_813_" + S, metadata: { items: JSON.stringify({ "pack-small": "1" }), church_id: String(cid) }, amount_total: 30000, customer_details: { email: "p@hope.test" } }, null);
  await q("UPDATE churches SET has_services=TRUE WHERE id=$1", [cid]);   // (Central Services' monthly plan)
  await j("POST", "/church/team", { section: "user", members: [{ name: "Ana", email: E("ana"), role: "Bass" }, { name: "Ben", email: E("ben"), role: "Keys" }, { name: "Cy", email: E("cy"), role: "Drums" }] }, T);
  const signupInvite = async (n, name) => j("POST", "/signup", { email: E(n), password: "password123", name, invite: to(E(n))[0].text.match(/#invite-([A-Za-z0-9_-]+)/)[1] });
  const ana = await signupInvite("ana", "Ana"), ben = await signupInvite("ben", "Ben"), cy = await signupInvite("cy", "Cy");
  ok(ana.token && (await j("GET", "/me", null, ana.token)).emailConfirmed, "an account made from an invite's email link is confirmed already");
  ok((await j("POST", "/church/role", { email: E("ana"), role: "admin" }, ana.token))._status === 403, "only the main admin changes roles");
  ok((await j("POST", "/church/role", { email: E("ana"), role: "admin" }, T)).ok && (await j("GET", "/me", null, ana.token)).church.role === "admin", "the main admin makes Ana an admin");
  ok((await j("POST", "/church/role", { email: E("pastor"), role: "user" }, T))._status === 400, "...but can't make the main admin a user (hand it over instead)");
  const anaIn = await j("POST", "/login", { email: E("ana"), password: "password123", device: "dev-ana-" + S });
  ok(anaIn.step === "phone", "Ana is an admin now: her next sign-in asks for her phone too", anaIn);
  ok((await j("POST", "/church/role", { email: E("ana"), role: "user" }, T)).ok && (await j("POST", "/login", { email: E("ana"), password: "password123", device: "dev-ana-" + S })).token, "back to user: email and password again");
  ok((await j("POST", "/church/billing", null, T))._status === 503, "Billing opens Stripe's page for the church's card (here: payments aren't set up, so it says so)");
  ok((await j("POST", "/church/billing", null, ana.token))._status === 403, "...only for the main admin");
  ok((await j("POST", "/church/handover", { email: E("ben"), password: "wrong" }, T))._status === 403, "handing over the main admin role needs the password");
  const ho = await j("POST", "/church/handover", { email: E("ben"), password: "password123" }, T);
  const bm = await j("GET", "/me", null, ben.token), pm = await j("GET", "/me", null, T);
  ok(ho.ok && bm.church.role === "owner" && pm.church.role === "admin" && /now the main admin/.test(last(E("ben")).subject), "the main admin hands it to Ben: Ben is main admin, they stay an admin, Ben gets an email", [bm.church, pm.church]);
  ok((await one("SELECT owner_id FROM churches WHERE id=$1", [cid])).owner_id === (await one("SELECT id FROM users WHERE email=$1", [E("ben")])).id, "...the church (and its billing) stays the same church, now with Ben as main admin");
  ok((await j("POST", "/church/remove", { email: E("cy") }, ben.token))._status === 401, "Ben's sign-in from before he was main admin can't use the admin tools (he signs in again, with a code)");
  const BEN_PH = "555-040-" + String(S).slice(-4);
  const BTok = (await adminIn(await j("POST", "/login", { email: E("ben"), password: "password123", device: "dev-ben-" + S }), E("ben"), BEN_PH)).token;
  ok(!!BTok, "Ben (main admin now) signs in with his phone");
  ok((await j("POST", "/church/remove", { email: E("cy") }, BTok)).ok, "the main admin removes someone");

  // ---------------------------------------------------------------- delete my account
  ok((await j("POST", "/account/delete", { password: "nope" }, ana.token))._status === 403, "Delete my account needs the password (a wrong one doesn't sign you out)");
  const anaKey = (await one("SELECT key FROM licenses WHERE assigned_email=$1", [E("ana")])).key;
  ok((await j("POST", "/account/delete", { password: "password123" }, ana.token)).ok, "Ana deletes her account");
  ok((await j("GET", "/me", null, ana.token))._status === 401 && (await j("POST", "/login", { email: E("ana"), password: "password123" }))._status === 401, "...she's signed out everywhere and can't sign in");
  const k = await one("SELECT user_id, assigned_email FROM licenses WHERE key=$1", [anaKey]), gone = await one("SELECT email, name, phone FROM users WHERE email LIKE 'deleted-%' AND deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 1");
  ok(!k.user_id && !k.assigned_email && gone && gone.name === "" && !gone.phone && /Your Motion Audio account is deleted/.test(last(E("ana")).subject), "...her key is free, her details are gone, she gets a goodbye email", [k, gone]);
  ok(!(await one("SELECT 1 FROM church_members m JOIN users u ON u.id=m.user_id WHERE u.email=$1", [E("ana")])), "...and she's out of the church");
  const bdel = await j("POST", "/account/delete", { password: "password123" }, ben.token);
  ok(bdel._status === 409 && /Make someone else the main admin first/.test(bdel.error), "the main admin of a church with people in it hands over first", bdel);
  const solo = await j("POST", "/signup", { email: E("solo"), password: "password123", churchName: "Solo " + S });
  const soloIn = await adminIn(solo, E("solo"), "555-030-" + String(S).slice(-4));
  const sd = await j("POST", "/account/delete", { password: "password123" }, soloIn.token);
  ok(sd._status === 409 && sd.needClose, "alone in a church: it asks to close the church too", sd);
  const sd2 = await j("POST", "/account/delete", { password: "password123", closeChurch: true }, soloIn.token);
  ok(sd2.ok && sd2.closedChurch && (await one("SELECT closed_at FROM churches WHERE name=$1", ["Solo " + S])).closed_at, "...and with that, the account is deleted and the church closed", sd2);

  // ---------------------------------------------------------------- Central Services: blockout dates and songs
  const PT = (await j("POST", "/login", { email: E("pastor"), password: "password123", device: "dev-desk-" + S })).token;   // (an admin now, trusted device)
  await j("POST", "/services/schedulers", { emails: [E("ben"), E("pastor")] }, BTok);
  const team = await j("POST", "/services/teams", { kind: "worship", name: "Band" }, PT);
  await j("POST", "/services/teams/" + team.id + "/members", { members: [{ name: "Ben", email: E("ben"), role: "Keys" }, { name: "Una", email: E("una"), role: "Vocals" }, { name: "Dee", email: E("dee"), role: "Bass" }] }, PT);
  const day = (n) => new Date(Date.now() + n * 864e5).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const at = (n) => new Date(new Date(day(n) + "T10:00:00-05:00").getTime()).toISOString();
  const early = await j("POST", "/services/events", { title: "Early", startsAt: at(9), teams: [team.id], songs: [{ title: "Way Maker", key: "E", bpm: 68 }, { title: "", key: "x" }] }, PT);
  ok(early.ok && early.asked === 3, "a service is made with a song list (empty rows dropped)");
  const bo = await j("POST", "/services/blockouts", { from: day(8), to: day(12), note: "Vacation" }, BTok);
  let board = await j("GET", "/services/board", null, PT);
  const benReq = board.services.find((s) => s.title === "Early").requests.find((r) => r.name === "Ben");
  ok(bo.ok && bo.declined === 1 && benReq.status === "declined" && /Away/.test(benReq.note), "Ben marks the days he's away: a service he hadn't answered on those days becomes a no", [bo, benReq]);
  ok(board.blockouts.some((b) => b.name === "Ben" && b.from === day(8) && b.to === day(12) && b.note === "Vacation"), "everyone sees who's away when", board.blockouts);
  const sun = await j("POST", "/services/events", { title: "Sunday", startsAt: at(10), teams: [team.id], songs: [{ title: "Goodness of God", key: "Ab", bpm: 63, notes: "Capo 1" }] }, PT);
  ok(sun.asked === 2 && sun.away.includes("Ben"), "asking the whole team for a day he's away skips him (and says so)", sun);
  ok(/Goodness of God \(Ab\) 63 BPM/.test(last(E("una")).text), "the request email has the song list");
  ok((await j("POST", "/services/blockouts", { from: day(5), to: day(3) }, BTok))._status === 400 && (await j("POST", "/services/blockouts", { from: "soon" }, BTok))._status === 400, "a last day before the first, or no date, is refused");
  const sg = await j("POST", "/services/events/" + sun.id + "/songs", { songs: [{ title: "Goodness of God", key: "Ab", bpm: 63 }, { title: "Build My Life", key: "G", bpm: 68 }] }, PT);
  board = await j("GET", "/services/board", null, PT);
  ok(sg.ok && board.services.find((s) => s.id === sun.id).songs.length === 2 && board.services.find((s) => s.id === sun.id).songs[1].title === "Build My Life", "schedulers change the song list; everyone sees it");
  ok((await j("POST", "/services/events/" + sun.id + "/songs", { songs: [] }, (await j("POST", "/login", { email: E("una"), password: "password123" })).token))._status === 403, "team members can't change the songs");
  const boId = board.blockouts.find((b) => b.name === "Ben").id;
  ok((await j("POST", "/services/blockouts/" + boId + "/remove", null, (await j("POST", "/login", { email: E("una"), password: "password123" })).token))._status === 403, "someone else can't remove Ben's dates");
  ok((await j("POST", "/services/blockouts/" + boId + "/remove", null, BTok)).ok, "Ben removes them");
  ok((await j("POST", "/services/blockouts", { from: day(20), to: day(20), email: E("una") }, PT)).ok && (await j("GET", "/services/board", null, PT)).blockouts.some((b) => b.email === E("una")), "a scheduler can mark someone away");

  // ---------------------------------------------------------------- the guessing brake: failures only
  const same = async (body) => { const r = await fetch(base + "/v1/login", { method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": "10.66.0.1" }, body: JSON.stringify(body) }); return r.status; };
  const okRuns = []; for (let i = 0; i < 25; i++) okRuns.push(await same({ email: E("una"), password: "password123" }));
  ok(okRuns.every((x) => x === 200), "25 good sign-ins from one address (a whole church on one Wi-Fi) aren't slowed down", okRuns.join(","));
  const badRuns = []; for (let i = 0; i < 22; i++) badRuns.push(await same({ email: E("una"), password: "wrong" + i }));
  ok(badRuns.slice(0, 20).every((x) => x === 401) && badRuns[20] === 429 && (await same({ email: E("una"), password: "password123" })) === 429, "20 wrong passwords from one address, then it waits", badRuns.join(","));

  // ---------------------------------------------------------------- error alerts and Contact support
  const RUN = S.toString(36).replace(/[0-9]/g, "q");   // (a new kind of error each run: the database is shared between runs)
  const e1 = { source: "central-usage", version: "2.12.0", message: "TypeError: cannot read " + RUN + " of undefined at line 12", stack: "TypeError\n    at draw (app://cu/app.js:120:7)", url: "app://cu/", platform: "Windows" };
  const a0 = to(HELP).length;
  ok((await j("POST", "/errors", e1)).ok && to(HELP).length === a0 + 1 && /New error in central-usage 2\.12\.0/.test(last(HELP).subject), "an app's error reaches the website and the support email hears about it right away", last(HELP) && last(HELP).subject);
  await j("POST", "/errors", Object.assign({}, e1, { message: "TypeError: cannot read " + RUN + " of undefined at line 99", stack: "TypeError\n    at draw (app://cu/app.js:133:9)" }));
  ok(to(HELP).length === a0 + 1, "the same kind of error again doesn't send another email (at most one a day)");
  const errs = await j("GET", "/admin/errors", null, (await adminIn(await j("POST", "/signup", { email: STAFF, password: "password123" }), STAFF, "555-050-" + String(S).slice(-4))).token);
  const mine = errs.errors && errs.errors.find((x) => x.source === "central-usage" && x.message.includes(RUN));
  ok(mine && mine.count === 2, "staff see each kind of error with how many times it happened", mine);
  ok((await j("GET", "/admin/errors", null, PT))._status === 403, "...staff only");
  const sup = await j("POST", "/support", { message: "My pedal won't pair with the main admin.", subject: "Pairing", app: "Central Pedal", version: "8.13.0", platform: "Raspberry Pi" }, ben.token);
  const sm = last(HELP), copy = last(E("ben"));
  ok(sup.ok && sup.sent && /\[Support #\d+\] Pairing/.test(sm.subject) && sm.reply_to === E("ben") && /Church: Hope/.test(sm.text) && /Central Pedal 8\.13\.0/.test(sm.text), "Contact support: the message goes to the support email (Reply goes to the person, with their church and app)", sm);
  ok(/We got your message/.test(copy.subject) && copy.reply_to === HELP, "...and they get a copy");
  ok((await j("POST", "/support", { email: "x@y.test", message: "" }))._status === 400, "an empty message is refused");
  ok((await j("GET", "/config")).supportEmail === HELP, "the support email is on the website (and the policy pages)");

  // ---------------------------------------------------------------- backups, and a restore into an empty database
  const STAFF_T = (await j("POST", "/login", { email: STAFF, password: "password123" }));
  const bk = await (await import("../src/backup.js")).makeBackup();
  const list = await (await import("../src/backup.js")).listBackups();
  ok(bk.rows > 10 && bk.tables > 20 && list.some((f) => f.key === bk.key) && fs.existsSync(path.join(files, bk.key)), "a backup has every table and row, in the file storage", bk);
  const fresh = db.replace(/\/[^/]+$/, "/ma_restore_" + S), admin = db.replace(/\/[^/]+$/, "/postgres");
  const pg = (await import("pg")).default, c0 = new pg.Client({ connectionString: admin }); await c0.connect(); await c0.query("CREATE DATABASE ma_restore_" + S); await c0.end();
  try {
    const out = execFileSync(process.execPath, [path.join(here, "..", "src", "backup.js"), "restore", path.join(files, bk.key)], { env: Object.assign({}, env, { DATABASE_URL: fresh }) }).toString();
    const c1 = new pg.Client({ connectionString: fresh }); await c1.connect();
    const n1 = (await c1.query("SELECT COUNT(*)::int AS n FROM users")).rows[0].n, n0 = (await one("SELECT COUNT(*)::int AS n FROM users")).n;
    const k1 = (await c1.query("SELECT COUNT(*)::int AS n FROM licenses")).rows[0].n, k0 = (await one("SELECT COUNT(*)::int AS n FROM licenses")).n;
    const nextId = (await c1.query("INSERT INTO users (email,name,pass_hash) VALUES ('new@x','', '!') RETURNING id")).rows[0].id;
    await c1.end();
    ok(JSON.parse(out).rows === bk.rows && n1 === n0 && k1 === k0 && Number(nextId) > n0, "restore puts every row back (accounts, keys...) and new ids carry on after the old ones", { out, n0, n1, k0, k1 });
    let refused = false; try { execFileSync(process.execPath, [path.join(here, "..", "src", "backup.js"), "restore", path.join(files, bk.key)], { env: Object.assign({}, env, { DATABASE_URL: fresh }), stdio: "pipe" }); } catch (_) { refused = true; }
    ok(refused, "a restore into a database that already has accounts is refused");
  } finally { const c2 = new pg.Client({ connectionString: admin }); await c2.connect(); await c2.query("DROP DATABASE IF EXISTS ma_restore_" + S); await c2.end(); }
  void STAFF_T; void cy;
} finally { srv.kill(); stub.close(); }
console.log(fails ? "\n" + fails + " 8.13 CHECK(S) FAILED\n" + log.slice(-2500) : "\nALL 8.13 CHECKS PASSED");
process.exit(fails ? 1 : 0);
