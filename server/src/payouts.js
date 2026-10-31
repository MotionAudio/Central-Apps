// Monthly publisher payouts, run by a Render cron job on the 1st of each month (`npm run payouts`):
//  1. Last month's subscriber pool: POOL_SHARE of the subscription money received last month, split among publishers
//     by their share of last month's subscriber adds x the track's stars (10.1: each subscriber counts once per track,
//     and a 5-star track's add weighs five times a 1-star one's).
//  1b. (10.1) Last month's sound plan pools: each pack's share (staff set it, 75% to start) split among creators by
//     downloads x stars (creators.js sharePacks).
//  2. Everything each publisher is owed (75% of their sales + pool shares, less any sale paid back after it was paid
//     out) goes to their Stripe Connect account. Balances under MIN_PAYOUT_CENTS, or for publishers whose payout setup
//     isn't finished (Stripe's transfers capability isn't active), wait for next month.
import { fileURLToPath } from "node:url";
import { q, one, pool } from "./db.js";
import { stripe, transfersActive } from "./payments.js";
import { POOL_SHARE } from "./config.js";
import { sharePacks, settings as creatorSettings } from "./creators.js";

// month = "YYYY-MM"; safe to run twice (a month's pool is only shared out once)
export async function sharePool(month) {
  if (await one("SELECT 1 FROM pool_shares WHERE month=$1 LIMIT 1", [month])) return { month, already: true };
  const range = [month + "-01", month + "-01"];
  const income = (await one("SELECT COALESCE(SUM(cents),0)::int AS c FROM subscription_payments WHERE NOT reversed AND paid_at >= $1::date AND paid_at < ($2::date + interval '1 month')", range)).c;
  const adds = await q(`SELECT e.publisher_id, COUNT(*)::int AS adds, SUM(COALESCE(t.stars, 1))::int AS weight FROM earnings e LEFT JOIN tracks t ON t.id=e.track_id
    WHERE e.reason='subscriber_add' AND e.created_at >= $1::date AND e.created_at < ($2::date + interval '1 month') GROUP BY e.publisher_id`, range);
  const total = adds.reduce((a, r) => a + r.weight, 0), pot = Math.floor(income * POOL_SHARE);
  if (!total || !pot) return { month, income, pot, adds: adds.reduce((a, r) => a + r.adds, 0), shares: [] };
  // whole cents, never more than the pot: round down, then hand the leftover cents to the biggest shares
  const shares = adds.map((r) => ({ ...r, exact: (pot * r.weight) / total })).map((r) => ({ ...r, cents: Math.floor(r.exact) }));
  let left = pot - shares.reduce((a, r) => a + r.cents, 0);
  shares.slice().sort((a, b) => (b.exact - b.cents) - (a.exact - a.cents)).forEach((r) => { if (left > 0) { r.cents++; left--; } });
  for (const r of shares) await q("INSERT INTO pool_shares (month,publisher_id,adds,cents,weight) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING", [month, r.publisher_id, r.adds, r.cents, r.weight]);
  return { month, income, pot, adds: adds.reduce((a, r) => a + r.adds, 0), weight: total, shares: shares.map((r) => ({ publisher: r.publisher_id, adds: r.adds, weight: r.weight, cents: r.cents })) };
}

export async function runPayouts(now = new Date()) {
  if (!stripe) throw new Error("STRIPE_SECRET_KEY is missing");
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  const poolResult = await sharePool(last), packs = await sharePacks(last), minCents = (await creatorSettings()).minPayoutCents;
  const cutoff = (await one("SELECT now() AS t")).t;  // only what's owed up to now is paid (and marked paid) this run
  const due = await q(`SELECT u.id, u.email, u.connect_account, SUM(x.cents)::int AS cents
    FROM (SELECT publisher_id, cents FROM earnings WHERE transfer_id IS NULL AND created_at <= $2
          UNION ALL SELECT publisher_id, cents FROM pool_shares WHERE transfer_id IS NULL AND month <= $3
          UNION ALL SELECT creator_id, cents FROM creator_shares WHERE transfer_id IS NULL AND month <= $3) x
    JOIN users u ON u.id=x.publisher_id
    WHERE u.connect_account IS NOT NULL
    GROUP BY u.id HAVING SUM(x.cents) >= $1`, [minCents, cutoff, last]);
  const paid = [];
  for (const p of due) {
    try {
      if (!(await transfersActive(p.connect_account))) { paid.push({ email: p.email, cents: p.cents, skipped: "payout setup not finished" }); continue; }
      const tr = await stripe.transfers.create({ amount: p.cents, currency: "usd", destination: p.connect_account, description: "Motion Audio earnings (Central Tracks and community items)" }, { idempotencyKey: "payout-" + p.id + "-" + now.toISOString().slice(0, 7) });
      await q("UPDATE earnings SET transfer_id=$1 WHERE publisher_id=$2 AND transfer_id IS NULL AND created_at <= $3", [tr.id, p.id, cutoff]);
      await q("UPDATE pool_shares SET transfer_id=$1 WHERE publisher_id=$2 AND transfer_id IS NULL AND month <= $3", [tr.id, p.id, last]);
      await q("UPDATE creator_shares SET transfer_id=$1 WHERE creator_id=$2 AND transfer_id IS NULL AND month <= $3", [tr.id, p.id, last]);
      paid.push({ email: p.email, cents: p.cents, transfer: tr.id });
    } catch (e) { paid.push({ email: p.email, cents: p.cents, error: e.message }); }
  }
  return { pool: poolResult, packs, paid };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runPayouts().then((r) => { console.log(JSON.stringify(r, null, 2)); return pool.end(); }).catch((e) => { console.error(e.message); process.exit(1); });
}
