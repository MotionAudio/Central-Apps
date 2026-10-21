// 9.0 against a real Postgres: version numbers and update coverage, renewals, discount codes (once per church, not the
// pedal), free trials (TRIALRUN, 7FREE: unlimited keys, Central Services, Central Tracks; then the keys stop), Central
// Services slots, the 9.3 packs (Lite, Regular, Plus, Ultra), and the staff price page.
//   node test/v90.mjs postgres://.../ma [port]
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const db = process.argv[2] || "postgres://postgres@127.0.0.1:55432/ma", port = Number(process.argv[3] || 18898), base = "http://127.0.0.1:" + port;
const S = Date.now(), STAFF = "staff90" + S + "@motion.test";
const mails = [];
const stub = http.createServer((req, res) => { let b = ""; req.on("data", (d) => (b += d)); req.on("end", () => { mails.push(JSON.parse(b || "{}")); res.end('{"id":"x"}'); }); });
await new Promise((r) => stub.listen(0, "127.0.0.1", r));
process.env.DATABASE_URL = db; process.env.CURRENT_VERSION = "9.0";
const gh = http.createServer((req, res) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify([{ tag_name: "v9.2.0", name: "9.2", published_at: "2026-12-01T00:00:00Z" }, { tag_name: "v9.1.1", name: "9.1.1 fix", published_at: "2026-11-15T00:00:00Z" }])); });
await new Promise((r) => gh.listen(0, "127.0.0.1", r));
const srv = spawn(process.execPath, [path.join(here, "..", "src", "index.js")], { env: Object.assign({}, process.env, { CC_UPDATE_API: "http://127.0.0.1:" + gh.address().port, PORT: String(port), STRIPE_SECRET_KEY: "", RESEND_API_KEY: "re_test", MAIL_FROM: "M <t@motion.test>",
  RESEND_API_URL: "http://127.0.0.1:" + stub.address().port + "/emails", PUBLIC_URL: "https://motion.test", ADMIN_EMAILS: STAFF, REMINDERS: "off", CURRENT_VERSION: "9.0" }), stdio: ["ignore", "pipe", "pipe"] });
let log = ""; srv.stdout.on("data", (d) => { log += d; }); srv.stderr.on("data", (d) => { log += d; });
for (let i = 0; i < 100 && !/Motion Audio server on/.test(log); i++) await new Promise((r) => setTimeout(r, 100));

let fails = 0;
const ok = (c, m, d) => { console.log((c ? "  ✓ " : "  ✗ ") + m + (c || d === undefined ? "" : "   -- " + JSON.stringify(d).slice(0, 600))); if (!c) fails++; };
let ipN = 0;
const j = async (method, p, body, tok) => { const r = await fetch(base + "/v1" + p, { method, headers: { "Content-Type": "application/json", "X-Forwarded-For": "10.9" + (++ipN % 9) + ".1.1", ...(tok ? { Authorization: "Bearer " + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }); return Object.assign(await r.json().catch(() => ({})), { _status: r.status }); };
const to = (who) => mails.filter((m) => m.to && m.to[0] === who);
const E = (n) => n + S + "@nine.test";
async function finish(r, email) {   // (admins: the code by email here - no Twilio)
  if (!r.step) return r;
  if (r.step === "phone") Object.assign(r, await j("POST", "/login/phone", { ticket: r.ticket, phone: "555-090-" + String(S).slice(-4) }));
  const m = to(email).filter((x) => /sign-in code/.test(x.subject)).pop();
  return Object.assign({}, r, { token: (await j("POST", "/login/code", { ticket: r.ticket, code: m.subject.match(/(\d{6})/)[1] })).token });
}
const confirm = async (email) => { const m = to(email).filter((x) => /Confirm your email/.test(x.subject)).pop(); return j("POST", "/account/confirm", { token: m.text.match(/#confirm-([A-Za-z0-9_-]+)/)[1] }); };
try {
  const { q, one } = await import("../src/db.js");
  const V = await import("../src/versions.js"), C = await import("../src/config.js"), pay = await import("../src/payments.js");

  // ---------------------------------------------------------------- versions and coverage
  ok(V.tenths("9.4.2") === 94 && V.tenths("v10.0.0") === 100 && V.fmt(104) === "10.4" && V.fmt(90) === "9.0", "versions: 9.4.2 is release 9.4; 9.9 then 10.0");
  const cfg = await j("GET", "/config"), P0 = cfg.products, pk = (id) => [P0[id].cents / 100, P0[id].keys.A, P0[id].keys.U, P0[id].keys.P, P0[id].slots].join("/");
  ok(pk("pack-lite") === "250/3/6/1/15" && pk("pack-regular") === "350/4/8/1/18" && pk("pack-plus") === "500/5/10/1/20" && pk("pack-ultra") === "700/6/16/1/30" && !P0["pack-lite"].ships,
    "packs (1 main admin + admins, users, 1 Pedal Control, Services slots): Lite $250 3/6/15, Regular $350 4/8/18, Plus $500 5/10/20, Ultra $700 6/16/30; no pedal", P0);
  ok(P0["ultra-plus10"].cents === 3500 && P0["ultra-plus10"].slots === 10 && P0["ultra-plus10"].addonFor === "pack-ultra" && P0["services-slot"].cents === 500 && P0["services-slot"].slots === 1
    && P0.admin.cents === 5000 && P0.user.cents === 2000 && P0["pedal-control"].cents === 5000 && P0.pedal.cents === 25000 && P0.pedal.hardware && cfg.subscription.cents === 7700 && cfg.renewal.cents === 2000 && cfg.mainAdminsMax === 2,
    "singles: Ultra +10 slots $35, a Services slot $5, admin $50, user $20, Pedal Control $50, the pedal $250, Central Tracks Unlimited $77/month, renewal $20; up to 2 main admins");

  // ---------------------------------------------------------------- a church with keys bought at 9.0
  const own = await finish(await j("POST", "/signup", { email: E("own"), password: "password123", name: "Owner", churchName: "Nine " + S }), E("own"));
  await confirm(E("own"));
  const T = own.token, c = await one("SELECT c.* FROM churches c JOIN church_members m ON m.church_id=c.id JOIN users u ON u.id=m.user_id WHERE u.email=$1", [E("own")]);
  await pay.recordOrder({ id: "cs_90_" + S, amount_total: 30000, customer_details: { email: "o@nine.test" }  }, { church_id: String(c.id), user_id: null, items: { "pack-lite": "1" } });
  const keys = await q("SELECT key, kind, updates_until FROM licenses WHERE church_id=$1", [c.id]);
  ok(keys.filter((k) => k.kind === "P").every((k) => k.updates_until === null) && keys.filter((k) => k.kind !== "P").every((k) => k.updates_until === 100), "bought at 9.0: admin and user keys get updates through 10.0; Pedal Control forever", keys.map((k) => k.kind + ":" + k.updates_until));
  const A = keys.find((k) => k.kind === "A").key, P = keys.find((k) => k.kind === "P").key;
  const act = await j("POST", "/license/activate", { key: A, device: "dev-a-" + S, deviceName: "Booth", app: "control" });
  const actP = await j("POST", "/license/activate", { key: P, device: "dev-p-" + S, deviceName: "Laptop", app: "pedal-control" });
  ok(act.updatesUntil === 100 && act.updatesUntilText === "10.0" && actP.updatesUntil === null && actP.updatesUntilText === "forever", "the apps are told how far their updates go", [act.updatesUntilText, actP.updatesUntilText]);
  const ch = await j("GET", "/church", null, T);
  ok(ch.current === "9.0" && ch.keys.some((k) => k.kind === "A" && k.updatesUntil === "10.0" && k.renewable) && ch.keys.some((k) => k.kind === "P" && k.updatesUntil === "forever" && !k.renewable), "the church page shows each key's updates and which can be renewed", ch.keys.slice(0, 2));

  // ---------------------------------------------------------------- renewals ($20 a key: one version past where it ended)
  ok((await j("POST", "/checkout/renew", { keys: [P] }, T))._status === 400, "Pedal Control keys aren't renewed (forever)");
  ok((await j("POST", "/checkout/renew", { keys: [A] }, T))._status === 503, "renewing an admin key goes to Stripe (here: payments aren't set up, so it says so)");
  await pay.recordRenewal({ id: "cs_ren_" + S, amount_total: 1000, customer_details: {} }, { user_id: null, church_id: c.id, items: { keys: [A] }, code: "BETATEST" });
  await pay.recordRenewal({ id: "cs_ren_" + S, amount_total: 1000, customer_details: {} }, { user_id: null, church_id: c.id, items: { keys: [A] }, code: "BETATEST" });
  ok((await one("SELECT updates_until FROM licenses WHERE key=$1", [A])).updates_until === 110, "a renewal adds one version past where it ended (10.0 → 11.0), once per payment", (await one("SELECT updates_until FROM licenses WHERE key=$1", [A])));

  // ---------------------------------------------------------------- discount codes
  const db = await j("GET", "/discount/betatest"), dt = await j("GET", "/discount/TRIALRUN"), d7 = await j("GET", "/discount/7free");
  ok(db.percent === 50 && dt.trial && dt.days === 183 && d7.trial && d7.days === 7 && (await j("GET", "/discount/NOPE"))._status === 404 && (await j("GET", "/discount/USAGE10"))._status === 404 && (await j("GET", "/discount/TESTRUN"))._status === 404,
    "codes: BETATEST 50% off, TRIALRUN 6 months free, 7FREE 7 days (any capitals); the old ones (USAGE10, 2026, TESTRUN) are gone");
  ok((await j("GET", "/discount/BETATEST", null, T)).used === true, "...BETATEST shows as used for this church (it was on the renewal)");
  const u10 = await j("POST", "/checkout/store", { items: { user: 2 }, code: "BETATEST" }, T);
  ok(u10._status === 409 && /already used BETATEST/.test(u10.error), "a % code works once per church", u10);
  ok((await j("POST", "/checkout/store", { items: { user: 2 } }, T))._status === 503, "without a code it's fine (then Stripe; not set up here)");
  ok((await j("POST", "/checkout/store", { items: { user: 1 }, code: "7FREE" }, T)).trialCode === "7FREE", "a free code in the checkout box says to start the trial instead");
  const { percentCode } = pay; const off = (cents, d) => Math.round(cents * (100 - d.percent) / 100);
  const d = await percentCode("BETATEST", null);
  ok(off(C.PRODUCTS.admin.cents, d) === 2500 && off(C.PRODUCTS["pack-ultra"].cents, d) === 35000 && off(C.PRODUCTS["services-slot"].cents, d) === 250 && C.PRODUCTS.pedal.hardware, "50% off: admin $25, Ultra $350, a slot $2.50; the built pedal is never discounted (and monthly plans aren't either)");

  // ---------------------------------------------------------------- free trials
  const tr = await finish(await j("POST", "/signup", { email: E("trial"), password: "password123", name: "Trial", churchName: "Trial " + S }), E("trial"));
  const t0 = await j("POST", "/trial", { code: "7FREE" }, tr.token);
  ok(t0._status === 403, "a trial needs a confirmed email", t0);
  await confirm(E("trial"));
  const t1 = await j("POST", "/trial", { code: "7free" }, tr.token);
  ok(t1.ok && !t1.keys && Math.abs(new Date(t1.until) - Date.now() - 7 * 864e5) < 60e3, "7FREE: a 7-day trial starts (unlimited keys, made as they're needed)", t1);
  const tA = (await j("POST", "/church/trial-key", { kind: "A" }, tr.token)).key, tU = (await j("POST", "/church/trial-key", { kind: "U" }, tr.token)).key;
  const meT = await j("GET", "/me", null, tr.token);
  ok(meT.subscribed && meT.church.hasServices && meT.church.trialUntil, "...with Central Services and Central Tracks Unlimited", meT.church);
  const many = await j("POST", "/church/team", { section: "admin", members: Array.from({ length: 9 }, (_, i) => ({ name: "A" + i, email: E("ad" + i) })) }, tr.token);
  ok(many.results.every((x) => x.ok), "unlimited: 9 more admins get keys on the Teams page", many.results.filter((x) => !x.ok));
  const mk = await j("POST", "/church/trial-key", { kind: "U" }, tr.token);
  ok(mk.ok && /^U/.test(mk.key), "Make a key: another user key, any time during the trial");
  const tk = await j("POST", "/license/activate", { key: tA, device: "dev-t-" + S, deviceName: "Trial desk", app: "control" });
  ok(tk.ok && tk.trial && tk.expiresAt, "a trial key works, and the app knows when it ends", tk);
  ok((await j("POST", "/trial", { code: "TRIALRUN" }, tr.token))._status === 409, "one free code per church (7FREE used: TRIALRUN is refused)");
  // the trial ends
  await q("UPDATE churches SET trial_until=now() - interval '1 minute' WHERE name=$1", ["Trial " + S]);
  await q("UPDATE licenses SET expires_at=now() - interval '1 minute' WHERE church_id=(SELECT id FROM churches WHERE name=$1)", ["Trial " + S]);
  const chk = await j("POST", "/license/check", { key: tA, device: "dev-t-" + S });
  ok(chk.ok === false && chk.reason === "expired", "after the trial, its keys stop (the app locks until a bought key is entered)", chk);
  ok((await j("POST", "/license/activate", { key: tU, device: "dev-u-" + S, app: "usage" }))._status === 403, "...and can't be entered on a new device");
  const meE = await j("GET", "/me", null, tr.token);
  ok(!meE.subscribed && !meE.church.hasServices && !meE.church.trialUntil && meE.church.trialUsed, "...Central Services and Central Tracks stop too", meE.church);
  ok((await j("POST", "/church/team", { section: "user", members: [{ email: E("late") }] }, tr.token)).results[0].ok === false, "...and no more free keys");
  ok((await j("POST", "/trial", { code: "7FREE" }, tr.token))._status === 409, "...and no second trial");
  const tr2 = await finish(await j("POST", "/signup", { email: E("test"), password: "password123", churchName: "Test run " + S }), E("test"));
  await confirm(E("test"));
  const t2 = await j("POST", "/trial", { code: "TRIALRUN" }, tr2.token);
  ok(t2.ok && Math.abs(new Date(t2.until) - Date.now() - 183 * 864e5) < 60e3, "TRIALRUN: another church gets everything free for 6 months", t2.until);

  // ---------------------------------------------------------------- Central Services slots
  const sl = await j("GET", "/services/slots", null, T);
  ok(sl.slots === 15 && sl.used === 0 && sl.free === 15 && sl.on, "Central Services: a Lite pack comes with 15 slots, none used yet", sl);
  const bare = await finish(await j("POST", "/signup", { email: E("bare"), password: "password123", churchName: "Bare " + S }), E("bare"));
  ok((await j("GET", "/services/board", null, bare.token))._status === 402 && !(await j("GET", "/services/slots", null, bare.token)).on, "without slots (and no trial), the schedule says how to get them");
  ok((await j("POST", "/checkout/store", { items: { "ultra-plus10": 1 } }, T))._status === 400, "Ultra's 10 more slots need an Ultra pack");

  // ---------------------------------------------------------------- the staff price page
  const staff = await finish(await j("POST", "/signup", { email: STAFF, password: "password123" }), STAFF);
  const pr = await j("GET", "/admin/prices", null, staff.token);
  ok(pr.prices && pr.prices.PRODUCTS.admin.cents === 5000 && pr.prices.DISCOUNTS.BETATEST && !pr.prices.SERVICES_PLAN, "staff see every price, pack and code");
  ok((await j("GET", "/admin/prices", null, T))._status === 403, "...staff only");
  const np = JSON.parse(JSON.stringify(pr.prices));
  np.PRODUCTS.user.cents = 2500; np.PRODUCTS["pack-lite"].keys.U = 8; np.PRODUCTS["pack-lite"].slots = 16; np.DISCOUNTS.SPRING20 = { percent: 20, label: "Spring" }; np.DISCOUNTS.BETATEST.on = false;
  np.RENEWAL.cents = 2500; np.STAR_PRICE_CENTS[5] = 3500;
  const saved = await j("POST", "/admin/prices", { prices: np }, staff.token);
  const cfg2 = await j("GET", "/config");
  ok(saved.ok && cfg2.products.user.cents === 2500 && cfg2.products["pack-lite"].keys.U === 8 && cfg2.products["pack-lite"].slots === 16 && cfg2.products["ultra-plus10"].addonFor === "pack-ultra" && cfg2.renewal.cents === 2500 && cfg2.starPrices[5] === 3500, "saving changes prices, pack contents (keys and slots), renewal and star prices at once");
  ok((await j("GET", "/discount/SPRING20")).percent === 20 && (await j("GET", "/discount/BETATEST"))._status === 404, "...a new code works, a switched-off code doesn't");
  ok((await j("POST", "/admin/prices", { prices: Object.assign({}, np, { DISCOUNTS: { "x!": { percent: 5 } } }) }, staff.token))._status === 400, "a bad code is refused (nothing changes)");
  await j("POST", "/admin/prices", { reset: true }, staff.token);
  ok((await j("GET", "/config")).products.user.cents === 2000, "Reset goes back to the starting prices");

  // ---------------------------------------------------------------- the codes page, and "Release to all devices"
  const codes = await j("GET", "/admin/codes", null, staff.token);
  const c7 = codes.codes.find((x) => x.code === "7FREE"), cb = codes.codes.find((x) => x.code === "BETATEST"), cr = codes.codes.find((x) => x.code === "TRIALRUN");
  ok(c7 && c7.used >= 1 && c7.uses.some((u) => u.church === "Trial " + S) && cb.uses.some((u) => u.church === "Nine " + S) && cb.percent === 50 && cr && cr.days === 183, "the codes page lists every code and the churches that used it", { c7: c7 && c7.used, cb: cb && cb.used });
  ok((await j("GET", "/admin/codes", null, T))._status === 403, "...staff only");
  const rel = await j("GET", "/admin/releases", null, staff.token);
  ok(rel.releases.length === 2 && rel.releases[0].version === "9.2.0" && !rel.releases[0].everyone, "the releases page lists the releases from GitHub", rel.releases);
  await j("POST", "/admin/releases", { version: "9.1.1", everyone: true }, staff.token);
  const vers = await j("GET", "/versions");
  ok(vers.everyone.includes("9.1.1") && (await j("GET", "/admin/releases", null, staff.token)).releases.find((x) => x.version === "9.1.1").everyone, "Release to all devices: the apps read 9.1.1 as for everyone", vers);
  await j("POST", "/admin/releases", { version: "9.1.1", everyone: false }, staff.token);
  ok(!(await j("GET", "/versions")).everyone.includes("9.1.1"), "...and Stop takes it back");
  ok((await j("POST", "/admin/releases", { version: "nine" }, staff.token))._status === 400, "a version that isn't one is refused");
} finally { srv.kill(); stub.close(); gh.close(); }
console.log(fails ? "\n" + fails + " 9.0 CHECK(S) FAILED\n" + log.slice(-2500) : "\nALL 9.0 CHECKS PASSED");
process.exit(fails ? 1 : 0);
