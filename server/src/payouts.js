// Monthly publisher payouts: sends each publisher's unpaid earnings (75% of sales + $3 per subscriber add) to their
// Stripe Connect account. Runs as a Render cron job (render.yaml) on the 1st of each month: `npm run payouts`.
// Balances under MIN_PAYOUT_CENTS wait for next month.
import { fileURLToPath } from "node:url";
import { q, pool } from "./db.js";
import { stripe } from "./payments.js";
import { MIN_PAYOUT_CENTS } from "./config.js";

export async function runPayouts() {
  if (!stripe) throw new Error("STRIPE_SECRET_KEY is missing");
  const due = await q(`SELECT u.id, u.email, u.connect_account, SUM(e.cents)::int AS cents
    FROM earnings e JOIN users u ON u.id=e.publisher_id
    WHERE e.transfer_id IS NULL AND u.connect_ready AND u.connect_account IS NOT NULL
    GROUP BY u.id HAVING SUM(e.cents) >= $1`, [MIN_PAYOUT_CENTS]);
  const done = [];
  for (const p of due) {
    try {
      const tr = await stripe.transfers.create({ amount: p.cents, currency: "usd", destination: p.connect_account, description: "Central Tracks earnings" }, { idempotencyKey: "payout-" + p.id + "-" + new Date().toISOString().slice(0, 7) });
      await q("UPDATE earnings SET transfer_id=$1 WHERE publisher_id=$2 AND transfer_id IS NULL", [tr.id, p.id]);
      done.push({ email: p.email, cents: p.cents, transfer: tr.id });
    } catch (e) { done.push({ email: p.email, cents: p.cents, error: e.message }); }
  }
  return done;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runPayouts().then((r) => { console.log(JSON.stringify(r, null, 2)); return pool.end(); }).catch((e) => { console.error(e.message); process.exit(1); });
}
