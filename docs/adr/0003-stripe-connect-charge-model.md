# ADR 0003 — Stripe Connect charge model

**Status:** Accepted for Phase 2 (sandbox only).
**Date:** 2026-09-15.
**Supersedes:** nothing. **Superseded by:** nothing.

Phase 2 integrates Stripe in **test mode only**. Nothing in this decision
authorises live payments; the kill switch in
`packages/providers/src/payment-mode.js` refuses them, and the Phase 2 exit
criteria list what must exist before that changes.

## The business invariant this rests on

**One order carries tickets from exactly one organiser.** This is structural,
not a convention:

- `Order.eventId` references one `Event`.
- `Event.organizationId` references one `Organization`.

There is no split-organiser cart in the schema, no route that would create one,
and no product requirement for one. So every order has exactly one payee, and
the question "who gets this money" always has a single answer.

One hole in that, closed in the same migration as this decision: nothing stopped
an `OrderItem` referencing a `TicketType` belonging to a _different_ event from
its order's. The database now rejects that
(`desi_order_item_event_matches`), because under any Connect model the
organiser is derived from the order, and a line from another organiser's event
would attribute money to the wrong account. Recorded as **NF-04**.

## Options

### A. Destination charges — `transfer_data.destination` plus `on_behalf_of`

The charge is created on the **platform** account, with the connected account as
the transfer destination and as the settlement merchant.

- The platform sees every charge without Connect read permissions, so support,
  reconciliation and the finance view are one query on our own account.
- The platform fee is `application_fee_amount`, one disclosed number on the
  charge, refundable with `refund_application_fee`.
- Attribution is `transfer_data.destination`, and `on_behalf_of` makes the
  connected account the merchant of record for the charge — which is what puts
  the organiser's name on the cardholder's statement and applies the organiser's
  country's rules for settlement.
- Refunds: `reverse_transfer` claws the organiser's share back out of their
  balance; `refund_application_fee` decides whether the platform gives its fee
  back. Both are explicit per refund rather than implied.
- Payout timing stays the connected account's own schedule. Desi-Event never
  holds organiser funds.
- One Payment Element integration, initialised against the platform account, so
  the web app has one code path.

### B. Direct charges — created on the connected account

- The charge belongs to the organiser. Disputes and refunds are theirs, which is
  the cleanest liability story of the three.
- But the platform cannot read the charge without acting as the connected
  account on every request, so every support lookup, every reconciliation query
  and every finance report becomes a per-account API call — and the
  `Stripe-Account` header becomes a correctness-critical parameter on hundreds
  of calls, where getting it wrong reads another tenant's data.
- The browser must initialise Stripe.js with `stripeAccount`, so the publishable
  key becomes per-organiser and the checkout page has an extra failure mode
  before it can render a card field.

### C. Separate charges and transfers

- Maximum flexibility: charge now, decide the split later, split across several
  destinations.
- But the money lands in the **platform balance**, which makes Desi-Event a
  holder of other people's funds. That brings negative-balance exposure on
  refunds and disputes, a balance to monitor, and a materially larger regulatory
  and accounting surface.
- Every order needs an explicit transfer, and every refund needs an explicit
  reversal, with their own idempotency, retry and reconciliation paths.
- Nothing in Phase 2 needs it. There is no split-organiser cart, and a
  single-payee order is exactly the case destination charges are for.

## Decision

**Option A: destination charges with `on_behalf_of` and an application fee.**

Chosen because it is the simplest model that correctly supports everything Phase
2 must do — one organiser per order, a disclosed platform fee, connected-account
attribution, full and partial refunds, an explicit application-fee refund
policy, transfer reversal, disputes, provider-scheduled payouts and complete
reconciliation — while keeping the platform out of the business of holding
organiser money.

Option C is explicitly **not** chosen. It is more flexible, and flexibility is
not a requirement; taking on custody of other people's funds to get it would be
a bad trade for a feature nobody has asked for.

## What this decision does not do

It does not make Desi-Event any of the following, and no code in this repository
may be read as asserting them:

- **Merchant of record.** `on_behalf_of` names the connected account as the
  settlement merchant for the charge. What that means commercially and legally
  is a decision for outside the code, and it has not been taken.
- **Agent, escrow provider or money transmitter.** Funds are never held. There
  is no balance to hold them in, and Option C was rejected partly to keep it
  that way.
- **Tax remitter or tax determiner.** Every tax rate shipped here is marked
  `DEMO` and production fails closed without a real determination. See
  `packages/pricing/src/tax.js`.
- **Legal seller of the ticket.** The organiser sells; Desi-Event provides the
  platform. Nothing in the schema or the pricing engine encodes a different
  arrangement.

## Liability, stated rather than implied

With destination charges the **platform** account is where the charge lives, so
a dispute is raised against the platform and the platform is the respondent
unless `on_behalf_of` shifts it. The practical consequences Phase 2 models:

- A dispute withholds the disputed amount from organiser funds
  (`Dispute.fundsWithheld` defaults to true).
- A refund after payout can leave the connected account short, which is what
  `Transfer.reversedCents` and the reconciliation queue exist for.
- Negative balances are a Phase 2 exit criterion, not a solved problem: nothing
  here decides who absorbs one.

None of this is exercised with real money, and none of it is claimed to be
operationally proven.

## Versions

Pinned, and pinned in code rather than left to the SDK default, because a
webhook payload is only interpretable against the version that produced it:

- Stripe API version: `STRIPE_API_VERSION` in
  `packages/schemas/src/payments.js`.
- Stripe Node SDK: pinned in `packages/providers/package.json`.

Both are recorded on every `WebhookEvent` row, so a payload stored today stays
interpretable after an upgrade.

## Consequences

- One Stripe integration path in the web app, against the platform publishable
  key.
- Reconciliation reads the platform account, which is one account rather than
  one per organiser.
- The application fee is the only place the platform's revenue appears on the
  charge, so the ledger's `platform_fee_revenue` account and Stripe's
  application fee must agree — and the reconciliation runbook compares them.
- Moving to Option C later would require a balance, a transfer per order and a
  reversal path. It is not a configuration change, and this ADR should be
  superseded rather than amended if it is ever wanted.
