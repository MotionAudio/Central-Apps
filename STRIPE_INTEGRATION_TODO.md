# Stripe integration: what's left to do

The Motion Audio website takes payments with Stripe's **embedded payment form** (Checkout Studio, `ui_mode: "form"`).
Customers pay inside a pop-up on your own site; Stripe hosts the card fields in a secure frame.

## Values to Replace

None. The integration already had real values for the `sample_only` parameters, so they were kept:

**Files containing these values:**
- [server/src/payments.js](server/src/payments.js)

| Field | Current Value | Where it comes from |
|-------|---------------|---------------------|
| mode | `payment` (store, single tracks), `subscription` (Central Tracks Unlimited) | Set per checkout in the code |
| line_items[].price | Your real Stripe Price IDs | Read from your active products in the Stripe Dashboard; the subscription uses the price with lookup key `ma_subscription`. Single tracks use `price_data` (each track's price comes from its quality grade). |

## Configured Parameters

These parameters were configured in Checkout Studio and are set on all three Checkout Sessions (store, single
track, subscription).

**Files containing these parameters:**
- [server/src/payments.js](server/src/payments.js) (the `STUDIO` settings)

| Parameter | Value |
|-----------|-------|
| ui_mode | `form` |
| billing_address_collection | `auto` |
| phone_number_collection | `{ enabled: false }` |
| automatic_tax | `{ enabled: false }` |
| payment_method_collection | `always` (subscription only, as Stripe requires) |
| submit_type | `auto` |
| integration_identifier | `custom_embedded_web_0001` |

Kept because the business needs them (they aren't Checkout Studio settings): `customer` (links the payment to the
church's account), `shipping_address_collection` (only when the cart has the physical pedal), `discounts` (codes and
sales), `subscription_data.trial_period_days` (code 7FREE), and `return_url` (required by the embedded form; it
replaces `success_url` / `cancel_url`).

## Setup and next steps

### Environment variables (server)
| Variable | Value |
|---|---|
| `STRIPE_SECRET_KEY` | Server key. Use a restricted key (`rk_...`) in production; see [server/SETUP.md](server/SETUP.md) for its permissions. |
| `STRIPE_PUBLISHABLE_KEY` | `pk_...`, used by the payment form in the browser and the payout settings |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` from Developers → Webhooks |

Never put keys in code or commit them. On Render they go in the service's Environment settings.

### Products and codes
Run `node scripts/setup-stripe.mjs` in `server/` with your key. It creates the packs, singles, the pedal, the
subscription and the codes TRIALRUN and BETATEST. 7FREE is handled by the website. Prices include tax.

### How it works
1. The browser asks the server for a checkout (`POST /v1/checkout/store`, `/v1/checkout/subscription`, or
   `/v1/tracks/:id/purchase?web=1`).
2. The server creates a Checkout Session and returns its `client_secret`.
3. The page loads Stripe.js (`https://js.stripe.com/dahlia/stripe.js`), calls `initCheckoutFormSdk`, mounts the
   form in `#checkout-form`, and confirms the payment.
4. Stripe sends the result to `/stripe/webhook`. Only the webhook fulfills: license keys, Services accounts,
   track access, the subscription. Refunds, disputes and Radar fraud warnings take those back.

New files: [server/scripts/setup-stripe.mjs](server/scripts/setup-stripe.mjs) (catalog and codes),
[server/STRIPE-PLAN.md](server/STRIPE-PLAN.md) (how every Stripe product is used).

### Testing
- Card `4242 4242 4242 4242`, any future date, any CVC, any ZIP: succeeds.
- `4000 0000 0000 0259`: succeeds, then gets disputed (the keys are revoked).
- `4000 0025 0000 3155`: asks for 3D Secure.
- Use a sandbox while testing; switch to live keys only at launch.

### Before going live
- Stripe Tax is off (`automatic_tax: false`). To turn it on: add your head office address (Tax → Settings) and a
  registration for each place you must collect tax (Tax → Locations), then set `automatic_tax` to `true` in
  Checkout Studio and in `server/src/payments.js`. Your prices include tax, so the tax comes out of the price.
- Confirm the product tax codes with your tax advisor (in `server/scripts/setup-stripe.mjs`).
- Activate the Customer portal (Settings → Billing) for "Manage subscription".
- Run `setup-stripe.mjs` with the live key, add the live webhook, and swap the live keys into Render.

### Resources
- https://support.stripe.com
- https://docs.stripe.com/mcp
