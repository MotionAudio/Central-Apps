# Putting the Motion Audio site and Central Tracks online

This folder is the whole thing: the website, the Central Tracks library, accounts, uploads with automatic star
grading, Stripe payments (store, the $77/month subscription, single tracks) and monthly publisher payouts.

You need **3 accounts**. Do them in this order.

---

## 1. Stripe — payments and publisher payouts

1. Go to **stripe.com** → *Start now*. Sign up with your email.
2. *Activate payments*: Stripe asks for your business details (you can sign up as an individual / sole
   proprietor), your bank account, and your SSN or EIN. This is how you get paid.
3. Turn on **Connect** (left menu → *Connect* → *Get started*). Choose **Platform or marketplace**. This is what
   lets you pay publishers their 75% of sales and their share of the subscriber pool.
4. Turn on **Identity** (left menu → *More* → *Identity*) and **Billing → Customer portal** (*Settings* → *Billing*).
5. Get your keys: *Developers* → *API keys*. You need the **Publishable key** (`pk_...`) and a server key. Stripe
   recommends a **restricted key** (`rk_...`, *Create restricted key*) instead of the secret key: give it write access
   to Checkout Sessions, Customers, Products, Prices, Coupons, Promotion Codes, Refunds, Subscriptions, Billing portal,
   Identity, Accounts v2, Account Links, Account Sessions and Transfers, and read access to Invoices and Tax.
   For testing first, use your sandbox keys (`pk_test_` / `sk_test_`). No real money moves there.
6. Make the products and codes: on your computer, in this folder, run
   `STRIPE_SECRET_KEY=sk_... node scripts/setup-stripe.mjs` (sandbox first, then once with the live key at launch).
   It's safe to run again; it only changes what's different.
7. The webhook comes after step 3 below, once your site has an address.

## 2. Cloudflare — storage for the audio files (R2)

1. Go to **cloudflare.com** → *Sign up*. Free.
2. Left menu → **R2 Object Storage** → *Purchase R2* / *Get started*. It asks for a card, but the first 10 GB are
   free and downloads are always free.
3. **Create bucket** → name it `central-tracks` → *Create*.
4. Open the bucket → *Settings* → **CORS policy** → *Edit* → paste this (put your site address in place of the
   Render one once you have it):
   ```json
   [
     { "AllowedOrigins": ["https://motion-audio.onrender.com"], "AllowedMethods": ["PUT"], "AllowedHeaders": ["*"], "MaxAgeSeconds": 3600 },
     { "AllowedOrigins": ["*"], "AllowedMethods": ["GET"], "AllowedHeaders": ["*"], "MaxAgeSeconds": 3600 }
   ]
   ```
   (The first lets the website upload; the second lets Central Pedal and Central Pedal Control download.)
5. Back on the R2 page → **Manage R2 API Tokens** → *Create API token* → permission **Object Read & Write**,
   apply to the `central-tracks` bucket → *Create*. Copy the **Access Key ID**, **Secret Access Key**, and the
   **endpoint** (`https://<account-id>.r2.cloudflarestorage.com`). The secret is shown once.

## 3. Render — runs the website, the API and the database

1. Go to **render.com** → *Get started* → **sign up with GitHub** (use the MotionAudio account) and let it see the
   `Central-Apps` repository.
2. *New* → **Blueprint** → pick `Central-Apps` → it reads `render.yaml` and shows the website, the database
   and the monthly payout job.
3. Fill in what it asks for:
   | Setting | Value |
   |---|---|
   | `ADMIN_EMAILS` | your email (lets you see reports and take tracks down) |
   | `STRIPE_SECRET_KEY` | from Stripe step 5 (asked twice: website and payout job) |
   | `STRIPE_PUBLISHABLE_KEY` | from Stripe step 5 (`pk_...`) |
   | `STRIPE_WEBHOOK_SECRET` | type `later` for now |
   | `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | from Cloudflare step 5 (`R2_BUCKET` = `central-tracks`) |
4. *Apply*. The first build takes a few minutes. Your site is then at `https://motion-audio.onrender.com`
   (Render shows the exact address).
5. Cost: about $7/month for the website, $6–7 for the database, and about $1 for the payout job.

## 4. Connect Stripe to the site (webhook)

1. Stripe → *Developers* → **Webhooks** → *Add endpoint*.
2. Endpoint URL: `https://<your site>/stripe/webhook`
3. Events (your account): `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`, `charge.refunded`,
   `charge.dispute.created`, `radar.early_fraud_warning.created`, `identity.verification_session.verified`,
   `identity.verification_session.requires_input`, `identity.verification_session.canceled`.
5. *Add endpoint* → copy the **Signing secret** (`whsec_...`).
6. Render → the `motion-audio` service → *Environment* → set `STRIPE_WEBHOOK_SECRET` to it → *Save* (it restarts).
7. Stripe → *Settings* → *Billing* → **Customer portal** → *Activate*, so subscribers can cancel or change cards
   (the "Manage subscription" button).

## 5. Check it

- Open the site, make an account, publish a short WAV, and see it graded and listed.
- In test mode, buy a pack with card `4242 4242 4242 4242`, any future date, any CVC. `4000 0000 0000 0259` makes a
  payment that gets disputed (the keys are taken back). Try the codes TRIALRUN, BETATEST and 7FREE.
- In Central Pedal or Central Pedal Control: **+ Add songs → Central Tracks → Central Tracks server** = your site
  address → sign in → add a track.
- When it all works, switch Stripe out of test mode, put the `sk_live_` key and a live webhook secret in Render.

## Your own web address (optional)

Buy a domain (for example `motionaudio.com`) from Cloudflare or any registrar, then Render → the service →
*Settings* → **Custom domains**. Update the R2 CORS origin and `PUBLIC_URL` to the new address.

---

### How the money works
- The store shows whatever products are active in Stripe (`scripts/setup-stripe.mjs` makes the Motion Audio ones).
  All prices include tax. Packs: Lite $250, Regular $350, Plus $500, Ultra $700 (+10 Services accounts for $35);
  singles: Central Admin $50, Central User $20, Central Pedal Control $50, Central Services account $5; the pedal $250.
- License keys are made when Stripe confirms payment, shown after checkout and on the account page. Services
  accounts are added to the church's account (no keys). Keys are good for one major version (updates 8.0-8.9);
  the next major is a new purchase. Raise `APP_MAJOR` in `src/config.js` when you ship a new major.
- Codes work on everything except the pedal itself: TRIALRUN (100% off for 6 months), BETATEST (50% off once),
  7FREE (7-day free trial of Central Tracks, first-time subscribers). Make more on the website: Account → Admin.
- Sales: Account → Admin → Sale. "Save and preview" shows it only to you; "Put it live" shows it to everyone.
- Central Tracks Unlimited: $77/month. Track prices come from the grade: 1★ $5 · 2★ $10 · 3★ $15 · 4★ $20 · 5★ $30
  (codes and sales don't apply to single tracks, because publishers get 75% of the price).
- Publishers: 75% of each sale, plus the subscriber pool: half of each month's subscription money, split by how many
  times subscribers added each publisher's tracks that month (each subscriber counts once per track). Paid on the 1st
  of the month to their Stripe Connect account once they're owed $10 or more. Change the half with `POOL_SHARE`.

### Running it on your Ubuntu PC
```bash
sudo apt install postgresql ffmpeg nodejs npm
sudo -u postgres createdb motionaudio
cd server && cp .env.example .env    # edit it; leave R2 empty to store files locally
npm install && set -a && . ./.env && set +a && npm start
```
Then open http://localhost:8080.
