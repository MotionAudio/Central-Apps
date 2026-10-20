// Teams, invites by email, keys on two devices, settings that follow the account, and Central Services (scheduling),
// against a real Postgres: node test/teams.mjs postgres://... [port]. Email goes to a stand-in for Resend here.
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const db = process.argv[2] || "postgres://postgres@127.0.0.1:55432/ma", port = Number(process.argv[3] || 18893), base = "http://127.0.0.1:" + port;
const mails = [];
const mailSrv = http.createServer((req, res) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => { mails.push({ auth: req.headers.authorization, body: JSON.parse(b || "{}") }); res.writeHead(200, { "Content-Type": "application/json" }); res.end('{"id":"x"}'); }); });
await new Promise((r) => mailSrv.listen(0, "127.0.0.1", r));
process.env.DATABASE_URL = db;
const srv = spawn(process.execPath, [path.join(here, "..", "src", "index.js")], { env: Object.assign({}, process.env, { PORT: String(port), STRIPE_SECRET_KEY: "", RESEND_API_KEY: "re_test", MAIL_FROM: "Motion Audio <team@motion.test>", RESEND_API_URL: "http://127.0.0.1:" + mailSrv.address().port + "/emails", PUBLIC_URL: "https://motion.test" }), stdio: ["ignore", "pipe", "pipe"] });
let log = ""; srv.stdout.on("data", (d) => { log += d; }); srv.stderr.on("data", (d) => { log += d; });
for (let i = 0; i < 100 && !/Motion Audio server on/.test(log); i++) await new Promise((r) => setTimeout(r, 100));

let fails = 0;
const ok = (c, m, d) => { console.log((c ? "  ✓ " : "  ✗ ") + m + (c || d === undefined ? "" : "   -- " + JSON.stringify(d).slice(0, 500))); if (!c) fails++; };
const j = async (method, p, body, tok) => { const r = await fetch(base + "/v1" + p, { method, headers: { "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); return Object.assign(await r.json().catch(() => ({})), { _status: r.status }); };
const S = Date.now(), mail = (to) => mails.filter((m) => m.body.to && m.body.to[0] === to);
// admins finish signing in with a code (here it comes by email: no Twilio in the test)
async function finish(r, email) {
  if (!r.step) return r;
  if (r.step === "phone") Object.assign(r, await j("POST", "/login/phone", { ticket: r.ticket, phone: "555-010-" + String(S).slice(-4) }));
  const m = mail(email).filter((x) => /sign-in code/.test(x.body.subject)).pop();
  const t = await j("POST", "/login/code", { ticket: r.ticket, code: m.body.subject.match(/(\d{6})/)[1] });
  return Object.assign({}, r, { token: t.token });
}
try {
  // the church first, then its main admin - someone else
  const maker = await j("POST", "/signup", { email: "office" + S + "@hope.test", password: "password123", name: "Office" });
  const made = await j("POST", "/church", { name: "Hope Church", ownerEmail: "pastor" + S + "@hope.test", ownerName: "Pastor Dan" }, maker.token);
  ok(made.ok && made.invite && made.invite.sent && mail("pastor" + S + "@hope.test").length === 1, "the church is made, and its main admin (someone else) is emailed a link", made);
  const tok = made.invite.link.split("#invite-")[1];
  const inv = await j("GET", "/invite/" + tok);
  ok(inv.church === "Hope Church" && inv.section === "owner" && inv.email === "pastor" + S + "@hope.test", "the link shows the church and who it's for", inv);
  const pastor = await finish(await j("POST", "/signup", { email: "pastor" + S + "@hope.test", password: "password123", name: "Pastor Dan", invite: tok }), "pastor" + S + "@hope.test");
  const me = await j("GET", "/me", null, pastor.token), me2 = await j("GET", "/me", null, maker.token);
  ok(me.church && me.church.role === "owner" && me2.church.role === "admin", "they make their account and become the main admin; whoever made the church stays as an admin", [me.church, me2.church]);
  const T = pastor.token;

  // keys: a Small pack (2 P, 2 A, 6 U), recorded the way the webhook does
  const { recordOrder } = await import("../src/payments.js");
  const { one } = await import("../src/db.js");
  const cid = (await one("SELECT id FROM churches WHERE owner_id=(SELECT id FROM users WHERE email=$1)", ["pastor" + S + "@hope.test"])).id;
  await recordOrder({ id: "cs_t_" + S, metadata: { items: JSON.stringify({ "pack-small": "1" }), church_id: String(cid) }, amount_total: 40000, customer_details: { email: "p@hope.test" } }, null);
  await one("UPDATE churches SET has_services=TRUE WHERE id=$1 RETURNING id", [cid]);   // (Central Services' monthly plan, as Stripe's webhook records it)
  let ch = (await j("GET", "/church", null, T));
  ok(ch.counts.U.free === 6 && ch.counts.A.free === 2 && ch.counts.P.free === 1 && ch.church.hasServices, "the keys page shows how many of each are left", ch.counts);

  // Teams: add people to Users - name, email, role - Done: each gets an email with the account link, the app and the key
  const add = await j("POST", "/church/team", { section: "user", members: [{ name: "Ana", email: "ana" + S + "@hope.test", role: "Bass" }, { name: "Ben", email: "ben" + S + "@hope.test", role: "Keys" }, { name: "x", email: "nope" }] }, T);
  const anaMail = mail("ana" + S + "@hope.test")[0];
  ok(add.results.filter((r) => r.ok && r.sent).length === 2 && add.results[2].ok === false, "Done sends each new user an email (a bad address is refused)", add.results);
  ok(anaMail && anaMail.auth === "Bearer re_test" && /Central Usage/.test(anaMail.body.subject) && anaMail.body.text.includes(add.results[0].key) && /Central-Apps\/#usage\b/.test(anaMail.body.text) && /Central Services: \S+#central-services/.test(anaMail.body.text) && /#invite-/.test(anaMail.body.text) && /as Bass/.test(anaMail.body.text),
    "...with the link to make their account, the Central Usage download (its section of the page), their U key and Central Services", anaMail && anaMail.body);
  const team = await j("GET", "/church/team", null, T);
  ok(team.sections.user.length === 2 && team.sections.user.every((m) => m.status === "invited") && team.free.user === 4 && team.free.admin === 2, "the Teams page shows who's invited and how many keys are left", team);
  const adm = await j("POST", "/church/team", { section: "admin", members: [{ name: "Sam", email: "sam" + S + "@hope.test", role: "Lights" }, { name: "Liz", email: "liz" + S + "@hope.test", role: "Sound" }, { name: "Max", email: "max" + S + "@hope.test" }] }, T);
  ok(adm.results[0].ok && adm.results[1].ok && /No A keys left/.test(adm.results[2].error) && /Central Control/.test(mail("sam" + S + "@hope.test")[0].body.subject), "admins get Central Control and an A key; when the keys run out it says so", adm.results);
  const ped = await j("POST", "/church/team", { section: "pedal", members: [{ name: "Wes", email: "wes" + S + "@hope.test", role: "Worship leader" }] }, T);
  ok(ped.results[0].ok && /Central Pedal Control/.test(mail("wes" + S + "@hope.test")[0].body.text), "Pedal Control members get Pedal Control and a P key", ped.results);

  // Ana makes her account with the link, then sets up two devices (church and home); a third is refused; Ben can't use her key
  const anaTok = anaMail.body.text.match(/#invite-([A-Za-z0-9_-]+)/)[1];
  const ana = await j("POST", "/signup", { email: "ana" + S + "@hope.test", password: "password123", name: "Ana", invite: anaTok });
  const K = add.results[0].key;
  const act = (dev, name) => j("POST", "/license/activate", { key: K, device: dev, deviceName: name, app: "usage" });
  ok((await act("dev-ana-church-" + S, "Church iPad")).ok && (await j("POST", "/license/link", { key: K, device: "dev-ana-church-" + S }, ana.token)).ok, "Ana's key on her church iPad, signed in");
  ok((await act("dev-ana-home-" + S, "Ana's phone")).ok && (await j("POST", "/license/link", { key: K, device: "dev-ana-home-" + S }, ana.token)).ok, "...and on her phone at home (a U key works on two devices)");
  const third = await act("dev-ana-3-" + S, "Laptop");
  ok(third._status === 409 && /Church iPad/.test(third.error) && /Ana's phone/.test(third.error), "a third device is refused, naming the two", third);
  const ben = await j("POST", "/signup", { email: "ben" + S + "@hope.test", password: "password123", name: "Ben" });
  const confirmOf = (who) => mail(who).filter((m) => /Confirm your email/.test(m.body.subject)).pop().body.text.match(/#confirm-([A-Za-z0-9_-]+)/)[1];
  ok(!(await j("GET", "/me", null, ben.token)).church, "Ben signs up with his invited email but without the link: not in the church until his email is confirmed (so nobody can take an invite by typing an address)");
  ok((await j("POST", "/account/confirm", { token: confirmOf("ben" + S + "@hope.test") })).church === "Hope Church", "...confirming the email puts him in");
  await j("POST", "/license/release", { key: K, device: "dev-ana-home-" + S });
  await act("dev-ben-" + S, "Ben's phone");
  const cheat = await j("POST", "/license/link", { key: K, device: "dev-ben-" + S }, ben.token);
  const after = await j("POST", "/license/check", { key: K, device: "dev-ben-" + S });
  ok(cheat._status === 409 && /ana/.test(cheat.error) && after.ok === false, "someone else signing in on the second device is refused, and that device loses the key (no sharing)", [cheat, after]);
  // an admin key: one device; the shared admin account is fine on it
  const AK = adm.results[0].key;
  await j("POST", "/license/activate", { key: AK, device: "dev-booth-" + S, deviceName: "Booth", app: "control" });
  ok((await j("POST", "/license/activate", { key: AK, device: "dev-booth2-" + S, deviceName: "Laptop", app: "control" }))._status === 409, "an A key works on one device at a time");
  ok((await j("POST", "/license/link", { key: AK, device: "dev-booth-" + S }, T)).ok, "...and the main admin's account (shared by admins) can sign in on Sam's admin device");

  // settings follow the account: both of Ana's devices see the same; the newest change wins
  const s1 = await j("POST", "/settings/usage", { data: { fontSize: 22, tab: "chords" }, updated: 1000 }, ana.token);
  const s2 = await j("POST", "/settings/usage", { data: { fontSize: 18 }, updated: 900 }, ana.token);
  const s3 = await j("GET", "/settings/usage", null, ana.token);
  ok(s1.kept && !s2.kept && s3.data.fontSize === 22 && s3.updated === 1000, "settings are saved to the account; an older change doesn't overwrite a newer one", [s1, s2, s3]);
  ok((await j("GET", "/settings/usage", null, ben.token)).data === null, "...and they're Ana's only");

  // team page: Ana joined and set up; resend; remove Ben -> his key is free again
  const team2 = await j("GET", "/church/team", null, T);
  ok(team2.sections.user.find((m) => m.name === "Ana").status === "set up" && team2.sections.user.find((m) => m.name === "Ben").status === "joined", "the Teams page shows who joined and who set up their app", team2.sections.user);
  const benInv = team2.sections.user.find((m) => m.name === "Ben");
  const n0 = mail("ben" + S + "@hope.test").length;
  ok((await j("POST", "/church/team/resend", { id: benInv.id }, T)).sent && mail("ben" + S + "@hope.test").length === n0 + 1, "Resend sends the invite again");
  await j("POST", "/church/team/remove", { id: benInv.id }, T);
  ok((await j("GET", "/church/team", null, T)).free.user === 5, "removing someone frees their key right away");
  ok((await j("GET", "/church/team", null, ana.token))._status === 403, "users can't see or change the Teams page");

  // Central Services: the signed-in account says who's a scheduler
  const sm = await j("GET", "/services/me", null, T), um = await j("GET", "/services/me", null, ana.token);
  ok(sm.role === "scheduler" && sm.church === "Hope Church" && um.role === "member" && um.hasServices, "Central Services knows who signed in: the main admin schedules, Ana sees the schedule", [sm, um]);
  const w1 = await j("POST", "/services/teams", { kind: "worship", name: "Team A" }, T);
  const p1 = await j("POST", "/services/teams", { kind: "production", name: "Tech" }, T);
  for (let i = 2; i <= 4; i++) await j("POST", "/services/teams", { kind: "worship", name: "Team " + i }, T);
  ok((await j("POST", "/services/teams", { kind: "worship", name: "Team 5" }, T))._status === 400, "up to 4 worship teams (and 4 production)");
  ok((await j("POST", "/services/teams", { kind: "worship", name: "X" }, ana.token))._status === 403, "members can't make teams");
  await j("POST", "/services/teams/" + w1.id + "/members", { members: [{ name: "Ana", email: "ana" + S + "@hope.test", role: "Bass" }, { name: "Wes", email: "wes" + S + "@hope.test", role: "Worship leader" }] }, T);
  await j("POST", "/services/teams/" + p1.id + "/members", { members: [{ name: "Sam", email: "sam" + S + "@hope.test", role: "Lights" }] }, T);
  const many = Array.from({ length: 1001 }, (_, i) => ({ email: "p" + i + "-" + S + "@hope.test" }));
  ok((await j("POST", "/services/teams/" + p1.id + "/members", { members: many }, T))._status === 400, "up to 1000 people on the teams");
  const n1 = mail("ana" + S + "@hope.test").length;
  const ev = await j("POST", "/services/events", { title: "Sunday 9:00", startsAt: new Date(Date.now() + 5 * 864e5).toISOString(), teams: [w1.id, p1.id] }, T);
  ok(ev.ok && ev.asked === 3 && mail("ana" + S + "@hope.test").length === n1 + 1 && /Sunday 9:00/.test(mail("ana" + S + "@hope.test").pop().body.subject), "a service asks everyone on the chosen teams, by email", ev);
  let b = await j("GET", "/services/board", null, ana.token);
  const myReq = b.services[0].requests.find((r) => r.mine);
  ok(b.role === "member" && b.teams.length === 5 && b.services[0].requests.length === 3 && myReq && myReq.role === "Bass", "everyone sees every team and every request (name, role, status)", b.services[0]);
  ok((await j("POST", "/services/requests/" + myReq.id, { status: "accepted" }, ana.token)).ok, "Ana accepts");
  const samReq = b.services[0].requests.find((r) => r.name === "Sam");
  ok((await j("POST", "/services/requests/" + samReq.id, { status: "declined" }, ana.token))._status === 403, "...but can't answer for Sam");
  const sam = await finish(await j("POST", "/signup", { email: "sam" + S + "@hope.test", password: "password123", name: "Sam" }), "sam" + S + "@hope.test");
  const samIn = await j("POST", "/account/confirm", { token: confirmOf("sam" + S + "@hope.test") });
  ok(!sam.church && samIn.church === "Hope Church", "Sam signs up without the email's link: once he confirms his email his Teams invite counts", [sam.church, samIn]);
  ok((await j("POST", "/services/requests/" + samReq.id, { status: "declined", note: "Out of town" }, sam.token)).ok, "Sam declines");
  b = await j("GET", "/services/board", null, T);
  const st = Object.fromEntries(b.services[0].requests.map((r) => [r.name, r.status]));
  ok(st.Ana === "accepted" && st.Sam === "declined" && st.Wes === "pending", "the board shows who accepted, declined or hasn't answered", st);
  // schedulers: the main admin picks up to 4
  ok((await j("POST", "/services/schedulers", { emails: ["pastor" + S + "@hope.test", "sam" + S + "@hope.test"] }, T)).ok && (await j("GET", "/services/me", null, sam.token)).role === "scheduler", "the main admin makes Sam a scheduler");
  ok((await j("POST", "/services/schedulers", { emails: ["a@x", "b@x", "c@x", "d@x", "e@x"] }, T))._status === 400, "...up to 4");
  // a church without it
  const other = await finish(await j("POST", "/signup", { email: "o" + S + "@none.test", password: "password123", churchName: "No Services Church" }), "o" + S + "@none.test");
  ok((await j("GET", "/services/board", null, other.token))._status === 402, "without it, Central Services says to get it (a monthly plan)");
} finally { srv.kill(); mailSrv.close(); }
console.log(fails ? "\n" + fails + " TEAMS CHECK(S) FAILED\n" + log.slice(-2500) : "\nALL TEAMS & SERVICES CHECKS PASSED");
process.exit(fails ? 1 : 0);
