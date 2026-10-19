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
   lets you pay publishers their 75% / $3.
4. Get your key: *Developers* → *API keys* → **Secret key** (starts with `sk_live_`).
   For testing first, flip *Test mode* on and use the `sk_test_` key. No real money moves in test mode.
5. The webhook comes after step 3 below, once your site has an address.

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
   | `STRIPE_SECRET_KEY` | from Stripe step 4 (asked twice: website and payout job) |
   | `STRIPE_WEBHOOK_SECRET` | type `later` for now |
   | `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | from Cloudflare step 5 (`R2_BUCKET` = `central-tracks`) |
4. *Apply*. The first build takes a few minutes. Your site is then at `https://motion-audio.onrender.com`
   (Render shows the exact address).
5. Cost: about $7/month for the website, $6–7 for the database, and about $1 for the payout job.

## 4. Connect Stripe to the site (webhook)

1. Stripe → *Developers* → **Webhooks** → *Add endpoint*.
2. Endpoint URL: `https://<your site>/stripe/webhook`
3. Tick **Listen to events on Connected accounts** as well as your account.
4. Events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`, `account.updated`.
5. *Add endpoint* → copy the **Signing secret** (`whsec_...`).
6. Render → the `motion-audio` service → *Environment* → set `STRIPE_WEBHOOK_SECRET` to it → *Save* (it restarts).
7. Stripe → *Settings* → *Billing* → **Customer portal** → *Activate*, so subscribers can cancel or change cards
   (the "Manage subscription" button).

## 5. Check it

- Open the site, make an account, publish a short WAV, and see it graded and listed.
- In test mode, buy a track with card `4242 4242 4242 4242`, any future date, any CVC.
- In Central Pedal or Central Pedal Control: **+ Add songs → Central Tracks → Central Tracks server** = your site
  address → sign in → add a track.
- When it all works, switch Stripe out of test mode, put the `sk_live_` key and a live webhook secret in Render.

## Your own web address (optional)

Buy a domain (for example `motionaudio.com`) from Cloudflare or any registrar, then Render → the service →
*Settings* → **Custom domains**. Update the R2 CORS origin and `PUBLIC_URL` to the new address.

---

### How the money works (all in `src/config.js`)
- Store: software bundle $80, Central Control $50, Central Usage $25, built pedal $250. License keys are made
  when Stripe confirms payment and shown on the thank-you screen.
- Central Tracks Unlimited: $77/month.
- Track prices come from the grade: 1★ $5 · 2★ $10 · 3★ $15 · 4★ $20 · 5★ $30.
- Publishers: 75% of each sale, $3 the first time each subscriber adds a track. Paid on the 1st of the month to
  their Stripe Connect account once they're owed $10 or more.

### Running it on your Ubuntu PC
```bash
sudo apt install postgresql ffmpeg nodejs npm
sudo -u postgres createdb motionaudio
cd server && cp .env.example .env    # edit it; leave R2 empty to store files locally
npm install && set -a && . ./.env && set +a && npm start
```
Then open http://localhost:8080.
