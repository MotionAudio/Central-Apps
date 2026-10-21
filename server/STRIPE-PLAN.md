# How Motion Audio uses Stripe

| Stripe product | What it does here | Code |
|---|---|---|
| **Checkout (embedded form)** | Every payment opens Stripe's form in a window on the website (Checkout Studio settings: `ui_mode: "form"`, address when needed, no phone, Stripe Tax off). The store (packs, keys, Central Services slots, the built pedal), key renewals, single Central Tracks and the $77/month Central Tracks Unlimited. The apps send people to the website to pay. | `src/payments.js` (`STUDIO`, `storeCheckout`, `renewCheckout`, `trackCheckout`, `subscriptionCheckout`), `public/app.js` (`openCheckout`) |
| **Prices** | The store's prices live on the website (config.js, changed on the staff price page) and go to Stripe as `price_data` with the product's name, `tax_behavior: "inclusive"` and a tax code. Discount codes and sales are taken off the price before it goes to Stripe, never off the built pedal (unless a sale says so). | `src/config.js`, `src/prices.js` |
| **Webhooks** | Fulfilment happens only in the webhook, from the row the server wrote when it started the Checkout Session: license keys, Central Services slots, renewals, a track in the buyer's storage, the subscription. Every event's signature is checked; repeated events change nothing. | `handleWebhook`, `fulfil` |
| **Radar, refunds, disputes** | A full refund or a dispute takes back what the payment gave: keys stop working, slots come off, a renewal's releases come off, a track leaves the buyer's storage and the publisher's share is dropped (or taken off their next payout if it was already paid). A disputed Central Tracks month leaves the publisher pool and ends the subscription. An early fraud warning refunds a digital order at once; an order with the built pedal is held for review (don't ship it). | `reverse`, `earlyFraudWarning` |
| **Billing** | Central Tracks Unlimited (for one person, or for the whole church when a main admin subscribes). The customer portal: the church's card and receipts, and "Manage subscription". | `subscriptionCheckout`, `churchBillingPortal`, `billingPortal` |
| **Connect (Accounts v2)** | Publishers are recipient accounts with the Express dashboard. Motion Audio is the seller; publishers get 75% of their sales plus the monthly subscriber pool by transfer on the 1st, once they're owed $10. Before each payout the `stripe_transfers` capability must be active. The payout settings and Stripe's notices show on the website (embedded components). | `connectLink`, `transfersActive`, `connectSession`, `src/payouts.js` |
| **Identity** | Off: anyone with an account can publish. `REQUIRE_ID_TO_PUBLISH=on` makes publishers verify a photo ID and a selfie once before their first upload. | `identitySession`, `/v1/publish` |
| **Tax** | Off for now. Every price includes tax and carries a tax code, so turning Stripe Tax on later needs no price changes: add the head office address and registrations, then set `automatic_tax` to `true` in `STUDIO`. | `TAX_CODES` |

**Webhook events:** see `SETUP.md` step 4. **API version:** `2026-09-30.endive`, stripe-node 23.0.0.

**Tested** with a stand-in Stripe (`test/v93.mjs`): the form's settings, prices with tax, codes and sales, fulfilment
once per payment, forged events refused, refunds, disputes before and after fulfilment, fraud warnings, renewals,
the subscription and its pool money, Identity, payout setup, and the apps' links to the website. The embedded form
and Accounts v2 calls were first tried in the "MotionAudio sandbox" (Oct 20 2026).
