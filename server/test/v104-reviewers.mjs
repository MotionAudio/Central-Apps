// 10.4.x: the reviewer discount. 10 different uploads reviewed in 30 days puts 10% on a reviewer's own subscriptions on
// Stripe (a stand-in here), keeping any other discount; falling below takes it off; a church's subscription never gets it.
//   node test/v104-reviewers.mjs postgres://postgres@127.0.0.1:55432/postgres
import http from "node:http";
import pg from "pg";
const admin = process.argv[2], name = "rv" + Date.now();
const root = new pg.Client({ connectionString: admin }); await root.connect(); await root.query("CREATE DATABASE " + name);
const calls = [], subs = { sub_rev: { discounts: [{ id: "di_code", source: { coupon: "MA-CODE" } }] }, sub_plan: { discounts: [] }, sub_low: { discounts: [] }, sub_church: { discounts: [] } };
const srv = http.createServer((req, res) => { let raw = ""; req.on("data", (d) => (raw += d)); req.on("end", () => {
  const p = new URL(req.url, "http://x").pathname, b = Object.fromEntries(new URLSearchParams(raw)); calls.push({ m: req.method, p, b });
  const send = (o) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
  if (p === "/v1/coupons") return send({ id: b.id, object: "coupon" });
  const id = p.split("/")[3];
  if (req.method === "POST" && p.startsWith("/v1/subscriptions/")) {
    const list = Object.entries(b).filter(([k]) => /^discounts\[\d+\]/.test(k));
    subs[id].discounts = list.map(([k, v]) => (k.endsWith("[coupon]") ? { id: "di_" + v, source: { coupon: v } } : subs[id].discounts.find((d) => d.id === v)));
  }
  return send({ id, object: "subscription", status: "active", discounts: subs[id] ? subs[id].discounts : [] });
}); });
await new Promise((r) => srv.listen(0, "127.0.0.1", r));
Object.assign(process.env, { DATABASE_URL: admin.replace(/\/[^/]*$/, "/" + name), TOKEN_SECRET: "t", STRIPE_SECRET_KEY: "sk_test_x", STRIPE_API_URL: "http://127.0.0.1:" + srv.address().port, ADMIN_EMAILS: "main@t.dev" });
const { migrate, q, one, pool } = await import("../src/db.js");
await migrate();
const { syncReviewerDiscounts } = await import("../src/payments.js");
const { reviewerStatus } = await import("../src/creators.js");
let fails = 0; const ok = (c, m) => { console.log((c ? "  ✓ " : "  ✗ ") + m); if (!c) fails++; };
const user = async (email, sub) => one("INSERT INTO users (email,pass_hash,subscribed,subscription_id,email_confirmed) VALUES ($1,'x',$2,$3,TRUE) RETURNING *", [email, !!sub, sub]);
const rev = await user("rev@t.dev", "sub_rev"), low = await user("low@t.dev", "sub_low"), other = await user("other@t.dev", null);
await q("INSERT INTO review_admins (email,added_by) VALUES ('rev@t.dev','main@t.dev'),('low@t.dev','main@t.dev')");
await q("INSERT INTO plan_subs (kind,user_id,plans,seats,cents,stripe_sub,status,period_end) VALUES ('person',$1,'{keys}',1,7000,'sub_plan','active',now()+interval '100 days')", [rev.id]);
const log = async (email, n, age = "1 hour") => { for (let i = 1; i <= n; i++) await q("INSERT INTO review_log (email,what,item_id,action,created_at) VALUES ($1,'track',$2,'approve',now()-$3::interval)", [email, i, age]); };
await log("rev@t.dev", 9);
await log("rev@t.dev", 9);   // (the same 9 again: they count once)
ok(!(await reviewerStatus(rev)).active && (await reviewerStatus(rev)).reviews === 9, "9 different uploads: not yet");
await syncReviewerDiscounts(); ok(!calls.some((c) => c.m === "POST" && c.p.startsWith("/v1/subscriptions/")), "nothing sent to Stripe yet");
await q("INSERT INTO review_log (email,what,item_id,action) VALUES ('rev@t.dev','item',1,'stars')");
ok((await reviewerStatus(rev)).active, "the 10th makes them active");
ok((await reviewerStatus(other)).reviewer === false, "someone else isn't a reviewer");
const r1 = await syncReviewerDiscounts();
ok(r1.added === 2, "added to their Tracks subscription and sound plan");
ok(subs.sub_rev.discounts.map((d) => d.source.coupon).join() === "MA-CODE,MA-REVIEWER-10", "another discount stays on");
ok(subs.sub_plan.discounts.length === 1 && !subs.sub_low.discounts.length && !subs.sub_church.discounts.length, "only their own");
const n = calls.length; const r2 = await syncReviewerDiscounts(); ok(!r2.added && !r2.removed && calls.length === n, "nothing to do the next hour");
await q("UPDATE review_log SET created_at=now()-interval '31 days' WHERE email='rev@t.dev'");
const r3 = await syncReviewerDiscounts();
ok(r3.removed === 2, "over 30 days: taken off");
ok(subs.sub_rev.discounts.map((d) => d.source.coupon).join() === "MA-CODE" && !subs.sub_plan.discounts.length, "the other discount still stays");
await log("rev@t.dev", 10); await syncReviewerDiscounts();
await q("DELETE FROM review_admins WHERE email='rev@t.dev'");
const r4 = await syncReviewerDiscounts(); ok(r4.removed === 2, "no longer a reviewer: taken off");
await pool.end(); srv.close(); await root.query("DROP DATABASE " + name); await root.end();
console.log(fails ? fails + " failed" : "all passed"); process.exit(fails ? 1 : 0);
