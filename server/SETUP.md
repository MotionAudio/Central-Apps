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
4. Turn on **Identity** (left menu → *More* → *Identity*): publishers verify their ID with it once before their first
   upload. And **Billing → Customer portal** (*Settings* → *Billing* → *Customer portal* → *Activate*): it's the
   "Billing: card & receipts" and "Manage subscription" buttons.
5. Get your keys: *Developers* → *API keys*. You need the **Publishable key** (`pk_...`, the payment form on the
   page) and a server key. Stripe recommends a **restricted key** (`rk_...`, *Create restricted key*) instead of the
   secret key: give it write access to Checkout Sessions, Customers, Refunds, Subscriptions, Billing portal, Identity,
   Accounts v2, Account Links, Account Sessions and Transfers, and read access to Payment Intents, Charges, Invoices and
   Invoice Payments. For testing first, use your sandbox keys (`pk_test_` / `rk_test_` or `sk_test_`). No real money
   moves there.
6. You don't need to make products in Stripe: the store's prices live on the website (Account → Prices, staff only)
   and every checkout tells Stripe the names and prices. Each price includes tax.
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

## 2b. Resend — email (invites, reminders, Forgot password)

Without it the website can't send email: Teams invites show a link to copy instead, and **Forgot password** and the
reminders don't work.

1. Go to **resend.com** → sign up (free up to 3,000 emails a month).
2. *Domains* → **Add domain** → your web address (for example `motionaudio.com`) → add the DNS records it shows at
   whoever sells you the domain, and wait for *Verified*.
3. *API Keys* → **Create API key** (Sending access) → copy it (`re_…`).

What it sends by itself, every hour (nothing to set up): a reminder to anyone added on a Teams page who hasn't made
their account after 3 days, and again after 7; and Central Services' day-before email (from 9 a.m. in `TIME_ZONE`) to
everyone serving tomorrow, and to anyone who hasn't answered yet.

## 2c. Twilio — text messages for admins' sign-in codes

The main admin and admins sign in with email, password **and a 6-digit code texted to their phone** (once per device,
then the device is trusted for 30 days). Until Twilio is set up, the code goes to their email instead.

1. Go to **twilio.com** → sign up → buy a phone number that can send SMS (about $1.15/month; each text about 1¢).
2. In the US, texting from an app number needs **A2P 10DLC registration** (Twilio walks you through it: your business,
   and "account verification codes" as the use). Approval takes a few days.
3. Copy the **Account SID**, **Auth Token** and the number (`+1…`) for step 3.
4. Codes are texted to US and Canada numbers only (`+1`), and at most 10 a day per account and 8 a day per number, so
   nobody can run up your Twilio bill. For other countries, set `SMS_COUNTRIES` (calling codes, e.g. `1,44`) and allow
   them in Twilio → Messaging → Geo permissions.

## 2d. A support email

Pick the address for technical support (for example `support@your-domain.com`; a Gmail address works too). The Contact
support form on the website and in every app sends there (Reply goes straight to the person), and so do the **error
alerts**: an email for each new kind of error the website or an app runs into (repeats at most once a day). Staff see
them all on the website: Account → *Errors, support, backups*.

## 3. Render — runs the website, the API and the database

1. Go to **render.com** → *Get started* → **sign up with GitHub** (use the MotionAudio account) and let it see the
   `Central-Apps` repository.
2. *New* → **Blueprint** → pick `Central-Apps` → it reads `render.yaml` and shows the website, the database
   and the monthly payout job.
3. Fill in what it asks for:
   | Setting | Value |
   |---|---|
   | `ADMIN_EMAILS` | your email (lets you see reports and take tracks down) |
   | `STRIPE_SECRET_KEY` | the server key from Stripe step 5 (asked twice: website and payout job) |
   | `STRIPE_PUBLISHABLE_KEY` | the publishable key from Stripe step 5 (`pk_...`) |
   | `STRIPE_WEBHOOK_SECRET` | type `later` for now |
   | `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | from Cloudflare step 5 (`R2_BUCKET` = `central-tracks`) |
   | `RESEND_API_KEY` | from Resend step 3 |
   | `MAIL_FROM` | `Motion Audio <team@your-domain.com>` (the domain you verified in Resend) |
   | `SUPPORT_EMAIL` | the support address from step 2d |
   | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | from Twilio step 2c (leave empty for now to send codes by email) |
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
4. (Publishers' payout setup is checked with Stripe directly, so no events from connected accounts are needed.)
5. *Add endpoint* → copy the **Signing secret** (`whsec_...`).
6. Render → the `motion-audio` service → *Environment* → set `STRIPE_WEBHOOK_SECRET` to it → *Save* (it restarts).
7. Stripe → *Settings* → *Billing* → **Customer portal** → *Activate*, so subscribers can cancel or change cards
   (the "Manage subscription" button).

## 5. Check it

- Open the site, make an account, publish a short WAV, and see it graded and listed.
- In test mode, buy a pack with card `4242 4242 4242 4242`, any future date, any CVC: the payment form opens on the
  page, and the keys and Central Services slots show up on the thank-you screen and on your church's page.
- `4000 0000 0000 0259` pays, then gets disputed: the keys stop working. Refunding an order in Stripe does the same.
- In Central Pedal or Central Pedal Control: **+ Add songs → Central Tracks → Central Tracks server** = your site
  address → sign in → add a track.
- When it all works, switch Stripe out of test mode: put the live keys (`pk_live_`, `rk_live_` or `sk_live_`) and a
  live webhook secret in Render.

## 6. Turn the license keys on in the apps

Until then the apps don't ask for a key. Once the site works, send your site's address (for example
`https://motion-audio.onrender.com`) to be put into the apps (`SERVER` at the top of `js/license.js`). The next
release then asks for a key the first time each app opens: the internet (Wi-Fi on the pedal), the production's
name, the key, then the account.

## Churches and license keys

- **Everything in the store comes with keys**, and keys belong to a church. You buy signed in. Your first purchase
  makes your church's account, with you as its **main admin**.
- **Keys:** 16 letters and digits, shown as `P7K3-9QXM-2HDA-VW8F`.
  - **P** keys are for Central Pedal and Central Pedal Control.
  - **A** keys are for Central Control (admins).
  - **U** keys are for Central Usage (users).

  Each key works on one device at a time.
- **Joining.** The main admin's Account page shows the **admin code** and the **user code**. Admins and users pick
  "Join my church" when they make an account and type the code. Admins can all share one account; each user has
  their own. An account signed in on a device with a key also joins that key's church.
- **Everyone in the church** sees how many keys are left. The main admin and admins also see every key, the device
  it's on, the people, and a **Release** button (for a lost or broken device). On a working device: Settings →
  License → Release key.
- **Prices** are at the top of `src/config.js` (`PRODUCTS`): the built pedal $250, Central Pedal Control $50, admin
  $50, user $20 ($10 for churches with a pack), Small / Medium / Large church packs $400 / $600 / $850.
- **A pedal you build and ship.** A store order for a pedal or a pack already has its P key (on the order and on the
  church's page): use that one. For a pedal sold another way, sign in with an `ADMIN_EMAILS` address, go to Account
  → *Keys · Motion Audio staff* and make a P key for the customer's church (their admin code). Then put the key on
  the pedal's card:
  - build the image with `PEDAL_KEY=PXXX-XXXX-XXXX-XXXX` added to the `sudo ... bash build-image.sh` line, or
  - copy a file `pad-pedal-key.txt` holding the key onto the card's boot partition from any computer.

  The pedal fills it in when it first opens. A pack's order makes its P keys by itself: use one of them.
- **Refunds:** on the same staff card, **Revoke** a key; it stops working at the app's next check.
- **Make your own account first** with the email in `ADMIN_EMAILS`, right after the site goes up: whoever signs up
  with that email gets the staff card.

## Your own web address (optional)

Buy a domain (for example `motionaudio.com`) from Cloudflare or any registrar, then Render → the service →
*Settings* → **Custom domains**. Update the R2 CORS origin and `PUBLIC_URL` to the new address.

---

### How the money works (all in `src/config.js`)
- Prices include tax. Packs (each with 1 main admin, admins, users, 1 Central Pedal Control and Central Services
  slots): Lite $250 (2 admins, 6 users, 15 slots), Regular $350 (3, 8, 18), Plus $500 (4, 10, 20), Ultra $700
  (5, 16, 30; 10 more slots for $35). Single keys: admin $50, user $20, Pedal Control $50. A Central Services slot is
  $5, once (one per person on the church's teams; taking someone off frees it). The built pedal is $250.
- Codes: BETATEST 50% off, TRIALRUN everything free for 6 months, 7FREE everything free for 7 days. None of them
  apply to the built pedal. Staff change all of this, and run sales, on the website (Account → Prices, Sale).
- Up to 2 main admins per church: a main admin makes one of the admins a main admin (Account → People).
- Keys are made when Stripe confirms payment, shown on the thank-you screen, and taken back on a refund or dispute.
- Central Tracks Unlimited: $77/month.
- Track prices come from the grade: 1★ $5 · 2★ $10 · 3★ $15 · 4★ $20 · 5★ $30.
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

## Backups

Every night (the `motion-audio-backup` job in `render.yaml`) the whole database is saved to R2 under `backups/`, kept
30 days. Staff see them on the website (Account → *Errors, support, backups*) and can press **Back up now** before a big
change. Render's paid Postgres also keeps its own daily backups.

**To restore** (the database is lost or broken):
1. Render → *New* → **PostgreSQL** (an empty one).
2. In R2, download the backup you want from `backups/` (the newest is at the top).
3. On a computer with Node 20 and this repository: `cd server && npm ci`, then
   `DATABASE_URL=<the new database's External URL> node src/backup.js restore <the downloaded .jsonl.gz>`
   It refuses a database that already has accounts in it.
4. Render → the website → *Environment* → point `DATABASE_URL` at the new database → *Save* (it restarts).

## Policies

The website has a **privacy policy** (`/privacy`), **terms** (`/terms`) and a **refund policy** (`/refunds`), linked from
the footer, the sign-up form and every app's Settings → License. They're written to match how the apps work; have
them read by someone who knows your state's rules before you launch, and change the refund terms if yours differ
(`server/public/*.html`).

## Prices, discount codes and versions

**The price page.** Sign in with an `ADMIN_EMAILS` address: Account → *Prices · Motion Audio staff*. From there you can
change:
- every store price and what each pack includes (or hide a product);
- the $20 renewal, Central Tracks Unlimited's monthly price, and Central Services' monthly sizes;
- discount codes (add, change, switch off, delete);
- the Central Tracks star prices.

A change takes effect as soon as you save. **Back to the starting prices** undoes everything.

**Codes it starts with.** USAGE10 (10% off the software), 2026 (50% off the software), 7FREE (everything free for 7
days), BETATEST (everything free for 3 months) and TESTRUN (everything free for 6 months). % codes work once per church
and never on the built pedal or monthly plans. Each church or production company gets one free trial, ever. A trial
gives unlimited keys, made as they're needed.

**The codes page** (Account → *Codes*): every code, what it does, whether it's on, and every church that used it (and
which trials are running now).

**Release to all devices** (Account → *Releases*): lets every app install that version, even apps whose key's updates
ended before it. Use it for an emergency fix. Apps pick it up when they next open, or within 6 hours. **Stop** takes it back.

**Versions.** Releases go 9.0, 9.1 … 9.9, then 10.0. A fix is the third number (9.4.1). Admin and user keys get ten full
releases of updates from when they were bought (9.4 → 10.4); renewing adds ten more. The website reads the current
version from the newest GitHub release. To pin it instead, set `CURRENT_VERSION` (for example `9.0`).


## Editing the website

Motion Audio staff (the emails in `ADMIN_EMAILS`) can edit the website itself:
1. Sign in.
2. Press **Edit this page** (bottom left).

What you can change:
- the words (click and type);
- prices (click and type);
- pictures (Replace picture);
- sections (Hide this section, or **+ Add a section after**: text, questions and answers, quotes, a picture).

Press **Save changes** and it's live for everyone. Prices go to the same price list as the price page.

To let other people edit, add their emails on Account → **Website editors**. They change words, pictures and sections, but not prices.

Where things are kept:
- The edits are in the database (`site_settings`: `content` and `editors`).
- Pictures go to storage under `site-media/` and are served from `/site-media/`.
