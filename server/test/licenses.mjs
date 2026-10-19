// Church accounts and license keys, against a real Postgres: node test/licenses.mjs postgres://... [port]
// Starts the server itself (no Stripe: orders are recorded the way the webhook records them).
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const db = process.argv[2] || "postgres://postgres@127.0.0.1:55432/ma", port = Number(process.argv[3] || 18890), base = "http://127.0.0.1:" + port;
process.env.DATABASE_URL = db;
const srv = spawn(process.execPath, [path.join(here, "..", "src", "index.js")], { env: Object.assign({}, process.env, { PORT: String(port), ADMIN_EMAILS: "boss@motion.test", STRIPE_SECRET_KEY: "" }), stdio: ["ignore", "pipe", "pipe"] });
let log = ""; srv.stdout.on("data", (d) => { log += d; }); srv.stderr.on("data", (d) => { log += d; });
for (let i = 0; i < 100 && !/Motion Audio server on/.test(log); i++) await new Promise((r) => setTimeout(r, 100));

let fails = 0;
const ok = (c, m, d) => { console.log((c ? "  ✓ " : "  ✗ ") + m + (c || d === undefined ? "" : "   -- " + JSON.stringify(d).slice(0, 400))); if (!c) fails++; };
const j = async (method, p, body, tok) => { const r = await fetch(base + "/v1" + p, { method, headers: { "Content-Type": "application/json", ...(tok ? { Authorization: "Bearer " + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const stamp = Date.now();
try {
  // the main user makes the church when signing up
  const own = await j("POST", "/signup", { email: "main" + stamp + "@church.test", password: "password123", name: "Main", churchName: "Grace Church" });
  ok(own.body.token && own.body.church === "Grace Church", "the main user makes the church account when signing up", own.body);
  const T = own.body.token;
  let ch = (await j("GET", "/church", null, T)).body;
  ok(ch.church && ch.church.role === "owner" && ch.church.adminCode && ch.church.userCode && ch.church.adminCode !== ch.church.userCode, "the main admin sees the admin and user codes", ch);

  // a Small church pack bought by the church: the webhook records it -> 2 P, 2 A, 6 U keys for the church
  const { recordOrder } = await import("../src/payments.js");
  const { one } = await import("../src/db.js");
  const cid = (await one("SELECT church_id FROM church_members m JOIN users u ON u.id=m.user_id WHERE u.email=$1", ["main" + stamp + "@church.test"])).church_id;
  await recordOrder({ id: "cs_test_" + stamp, metadata: { items: JSON.stringify({ "pack-small": "1", "user-pack": "2" }), church_id: String(cid) }, amount_total: 42000, customer_details: { email: "main@church.test" } }, null);
  ch = (await j("GET", "/church", null, T)).body;
  ok(ch.counts.P.total === 2 && ch.counts.A.total === 2 && ch.counts.U.total === 8 && ch.counts.U.free === 8 && ch.church.hasPack, "a Small pack (+2 extra users) gives 2 P, 2 A and 8 U keys, all free; the church now has a pack", ch.counts);
  const keys = ch.keys.map((k) => k.key), P = ch.keys.find((k) => k.kind === "P").key, A = ch.keys.find((k) => k.kind === "A").key, U = ch.keys.filter((k) => k.kind === "U").map((k) => k.key);
  ok(keys.every((k) => /^[PAU][A-Z2-9]{3}(-[A-Z2-9]{4}){3}$/.test(k) && !/[IL0O1]/.test(k)), "keys are 16 characters, start with P, A or U, no look-alike characters: " + P);
  const o = await j("GET", "/orders/cs_test_" + stamp);
  ok(o.body.licenses && o.body.licenses.length === 12 && o.body.licenses[0].key.length === 19, "the order page lists the keys", o.body);

  // apps: activate, the wrong kind, a second device, check, release
  const dev1 = "dev-" + stamp + "-one", dev2 = "dev-" + stamp + "-two";
  let a = await j("POST", "/license/activate", { key: A.toLowerCase().replace(/-/g, " "), device: dev1, deviceName: "Sound booth Mac", app: "control" });
  ok(a.status === 200 && a.body.ok && a.body.kind === "A" && a.body.church === "Grace Church" && a.body.recheckDays === 30, "Central Control activates an A key (typed in lower case, with spaces) and gets the church", a.body);
  a = await j("POST", "/license/activate", { key: A, device: dev1, deviceName: "Sound booth Mac", app: "control" });
  ok(a.status === 200, "the same device can activate again (a reinstall)");
  a = await j("POST", "/license/activate", { key: A, device: dev2, deviceName: "Laptop", app: "control" });
  ok(a.status === 409 && /Sound booth Mac/.test(a.body.error), "another device can't use it while it's in use - it says where", a.body);
  a = await j("POST", "/license/activate", { key: U[0], device: dev2, app: "control" });
  ok(a.status === 400 && /U key|user/.test(a.body.error), "a U key isn't accepted by Central Control", a.body);
  a = await j("POST", "/license/activate", { key: "PAAAA-BBBB-CCCC-DDDD", device: dev2, app: "pedal" });
  ok(a.status === 404, "a made-up key is refused");
  let c = await j("POST", "/license/check", { key: A, device: dev1 });
  ok(c.body.ok === true, "the 30-day check: still this device's");
  c = await j("POST", "/license/check", { key: A, device: dev2 });
  ok(c.body.ok === false && c.body.reason === "elsewhere", "the check on another device says it's used elsewhere", c.body);
  await j("POST", "/license/release", { key: A, device: dev2 });
  ok((await j("POST", "/license/check", { key: A, device: dev1 })).body.ok, "another device can't release it");
  await j("POST", "/license/release", { key: A, device: dev1 });
  c = await j("POST", "/license/check", { key: A, device: dev1 });
  ok(c.body.ok === false && c.body.reason === "released", "Release key in the app frees it", c.body);
  a = await j("POST", "/license/activate", { key: A, device: dev2, deviceName: "Laptop", app: "control" });
  ok(a.status === 200, "...and it works on the next device");

  // the account on the device joins the church; admins can share one account; users have their own
  const usr = await j("POST", "/signup", { email: "singer" + stamp + "@church.test", password: "password123", name: "Singer" });
  await j("POST", "/license/activate", { key: U[0], device: dev1, deviceName: "Singer's iPhone", app: "usage" });
  const l1 = await j("POST", "/license/link", { key: U[0], device: dev1 }, usr.body.token);
  ok(l1.body.ok && l1.body.role === "user" && l1.body.church === "Grace Church", "a user's own account joins the church as a user", l1.body);
  const adm = await j("POST", "/license/link", { key: A, device: dev2 }, T);
  ok(adm.body.ok && adm.body.role === "owner", "the main admin's account on an admin device stays the owner", adm.body);
  ch = (await j("GET", "/church", null, T)).body;
  ok(ch.counts.A.inUse === 1 && ch.counts.U.inUse === 1 && ch.members.length === 2 && ch.keys.find((k) => k.inUse && k.kind === "U").device === "Singer's iPhone", "everyone on the church sees keys in use and left; the main admin sees the devices", ch.counts);
  const seen = (await j("GET", "/church", null, usr.body.token)).body;
  ok(seen.counts.U.free === 7 && !seen.church.adminCode && !seen.church.userCode && seen.keys.every((k) => k.mine || k.key.startsWith("••••")), "a user sees how many keys are left, but not the keys or the codes", seen.church);
  const rel = await j("POST", "/church/release", { key: A }, usr.body.token);
  ok(rel.status === 403, "a user can't release someone else's key on the website");
  ok((await j("GET", "/church", null, usr.body.token)).body.keys.some((k) => k.mine && k.key === U[0]), "...but sees their own key in full");
  const rel2 = await j("POST", "/church/release", { key: U[0] }, T);
  ok(rel2.body.ok && (await j("POST", "/license/check", { key: U[0], device: dev1 })).body.reason === "released", "the main admin releases a lost phone's key on the website");

  // joining with the codes when making an account
  const j1 = await j("POST", "/signup", { email: "adm" + stamp + "@church.test", password: "password123", churchCode: ch.church.userCode, churchRole: "admin" });
  ok(j1.body.token && /admin code/.test(j1.body.churchError || ""), "the users' code can't make an admin", j1.body);
  const j2 = await j("POST", "/signup", { email: "adm2" + stamp + "@church.test", password: "password123", churchCode: ch.church.adminCode.toLowerCase(), churchRole: "admin" });
  ok(j2.body.church === "Grace Church" && (await j("GET", "/me", null, j2.body.token)).body.church.role === "admin", "an admin joins with the admin code (and picks admin)", j2.body);
  const j3 = await j("POST", "/signup", { email: "x" + stamp + "@church.test", password: "password123", churchCode: "NOPE1234" });
  ok(j3.status === 404 && !(await one("SELECT 1 FROM users WHERE email=$1", ["x" + stamp + "@church.test"])), "a wrong code doesn't leave a half-made account", j3.body);
  const other = await j("POST", "/signup", { email: "o" + stamp + "@else.test", password: "password123", churchName: "Other Church" });
  const cross = await j("POST", "/license/link", { key: A, device: dev2 }, other.body.token);
  ok(cross.status === 409, "an account from another church can't take this church's device", cross.body);

  // a P key on a musician's Pedal Control makes them a user, not an admin
  const mus = await j("POST", "/signup", { email: "mus" + stamp + "@church.test", password: "password123" });
  await j("POST", "/license/activate", { key: P, device: "dev-" + stamp + "-mus", deviceName: "Musician's iPad", app: "pedal-control" });
  const ml = await j("POST", "/license/link", { key: P, device: "dev-" + stamp + "-mus" }, mus.body.token);
  ok(ml.body.role === "user", "a P key's account joins as a user (admins need an A key or the admin code)", ml.body);
  const ownRel = await j("POST", "/church/release", { key: P }, mus.body.token);
  ok(ownRel.body.ok, "a user releases their own device's key on the website (a lost phone)", ownRel.body);
  // the main admin: new codes, take someone out
  const codes0 = (await j("GET", "/church", null, T)).body.church;
  await j("POST", "/church/codes", null, T);
  const codes1 = (await j("GET", "/church", null, T)).body.church;
  ok(codes1.adminCode !== codes0.adminCode && codes1.userCode !== codes0.userCode && (await j("POST", "/church/codes", null, usr.body.token)).status === 403, "the main admin makes new codes (nobody else can)");
  ok((await j("POST", "/church/remove", { email: "mus" + stamp + "@church.test" }, T)).body.ok && !(await j("GET", "/me", null, mus.body.token)).body.church, "...and takes someone out");

  // the store: sign in first, and the $10 user price needs a pack
  const anon = await fetch(base + "/v1/checkout/store", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: { user: 1 } }) });
  ok(anon.status === 401, "buying needs an account (the keys go to a church)");
  const nopack = await j("POST", "/signup", { email: "np" + stamp + "@church.test", password: "password123", churchName: "No Pack Church" });
  const cheat = await j("POST", "/checkout/store", { items: { "pack-small": "0.5", "user-pack": 50 } }, nopack.body.token);
  ok(cheat.status === 400 && /church pack/.test(cheat.body.error), "half a pack doesn't unlock the $10 user price", cheat.body);
  const cfgj = (await j("GET", "/config")).body;
  ok(cfgj.products["pack-small"].cents === 40000 && cfgj.products.pedal.cents === 25000 && cfgj.products["pedal-control"].cents === 5000 && cfgj.products.admin.cents === 5000 && cfgj.products.user.cents === 2000 && cfgj.products["user-pack"].cents === 1000 && cfgj.products["pack-large"].keys.U === 20, "prices: pedal $250, Pedal Control $50, admin $50, user $20 ($10 with a pack), packs $400 / $600 / $850", cfgj.products);

  // Motion Audio staff make a P key for a pedal they build (and only they can)
  let boss = await j("POST", "/signup", { email: "boss@motion.test", password: "password123" });
  if (!boss.body.token) boss = await j("POST", "/login", { email: "boss@motion.test", password: "password123" });   // (a second run)
  const made = await j("POST", "/admin/keys", { kind: "P", count: 2, church: (await j("GET", "/church", null, T)).body.church.adminCode, note: "pedal #12" }, boss.body.token);
  ok(made.body.keys && made.body.keys.length === 2 && made.body.keys[0][0] === "P", "staff make P keys for a pedal they build, for a church", made.body);
  ok((await j("POST", "/admin/keys", { kind: "P" }, T)).status === 403, "...nobody else can");
  const pk = await j("POST", "/license/activate", { key: made.body.keys[0], device: "pedal-" + stamp, deviceName: "Central Pedal", app: "pedal" });
  ok(pk.body.ok && pk.body.church === "Grace Church", "the pedal activates its key", pk.body);
  await j("POST", "/admin/keys/" + made.body.keys[1] + "/revoke", null, boss.body.token);
  ok((await j("POST", "/license/activate", { key: made.body.keys[1], device: dev1, app: "pedal-control" })).status === 404, "a revoked key (a refund) stops working");
} finally {
  srv.kill();
}
console.log(fails ? "\n" + fails + " LICENSE CHECK(S) FAILED\n" + log.slice(-2000) : "\nALL LICENSE CHECKS PASSED");
process.exit(fails ? 1 : 0);
