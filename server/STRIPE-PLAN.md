# Motion Audio on Stripe

MotionAudio.org sells audio software and equipment to churches and production companies, runs the Central Tracks
library (subscription plus single-track sales), and pays the people who publish tracks.

**Model: marketplace, separate charges and transfers.** Motion Audio is the merchant of record for everything.
Publishers are paid later, once a month: 75% of their sales plus their share of the subscriber pool.

| Stripe product | How it's used | Code |
|---|---|---|
| **Payments** | Checkout Sessions with the embedded form (`ui_mode: "form"`, Checkout Studio settings). Dynamic payment methods (cards, Link, Apple/Google Pay, Klarna, Affirm, Cash App). No `payment_method_types`. | `src/payments.js` `storeCheckout`, `trackCheckout` |
| **Billing** | Central Tracks Unlimited, $77/month, through Checkout in subscription mode; the Customer portal handles cancelling and cards. `invoice.paid` feeds the publisher pool. | `subscriptionCheckout`, `billingPortal`, webhook |
| **Connect** | Publishers get Accounts v2 accounts with the recipient configuration (`stripe_transfers`), the Express dashboard, and `fees_collector` / `losses_collector` = application. Onboarding via v2 Account Links. Before each payout the v2 `stripe_transfers` capability must be `active`. Embedded components on the account page: notification banner, payouts, account management. | `connectLink`, `transfersActive`, `connectSession`, `payouts.js` |
| **Identity** | Publishers verify a photo ID plus selfie once before their first upload. `identity.verification_session.*` webhooks set the status. | `identitySession`, `/v1/publish` gate |
| **Radar** | Runs on every Checkout payment. Early fraud warnings: digital orders are refunded at once; a pedal order is held for review. Disputes and refunds revoke keys and Services accounts, remove tracks, and claw back publisher earnings (unpaid ones are dropped; already paid ones come off the next payout). | `earlyFraudWarning`, `reverse` |
| **Tax** | Off for now (`automatic_tax: false`, as set in Checkout Studio). Every product has a proposed tax code and every price is tax-inclusive, so turning Tax on later needs no price changes, only a head office address and registrations. | `scripts/setup-stripe.mjs` |

**Webhook events:** `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
`checkout.session.async_payment_failed`, `customer.subscription.created|updated|deleted`, `invoice.paid`,
`invoice.payment_failed`, `charge.refunded`, `charge.dispute.created`, `radar.early_fraud_warning.created`,
`identity.verification_session.verified|requires_input|canceled`. Every event's signature is checked.
Fulfillment happens only in the webhook; each Checkout Session is recorded when it's created, so events are matched
to our records through Stripe objects, not metadata.

**API version:** `2026-09-30.endive`, stripe-node 23.0.0.

**Keys:** use a restricted key (`rk_`) in production (permissions listed in `SETUP.md`), stored in Render's
environment, never in code.

**Tested in the "MotionAudio sandbox" (Oct 20 2026):**
- test-card purchase through the embedded form, with the webhook issuing keys
- refund revoking keys
- disputed track purchase removing access and the publisher's share
- ID verification gating publishing, and forged webhooks rejected
- subscription recording pool income
- BETATEST taking 50% off; 7FREE and TRIALRUN starting $0 checkouts
- Ultra add-on rules
- a sale previewed by an admin and then published
