# Stripe Connect

The charge model, what is built against it, and — stated first because it is the
most important thing on this page — what is **not** built.

The decision itself is ADR 0003
(`docs/adr/0003-stripe-connect-charge-model.md`). This document is what follows
from it in the code.

---

## Status

| Piece                                                                                                        | Status                                       |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| Charge model chosen and recorded                                                                             | Decided (ADR 0003)                           |
| `ConnectedAccount` model, constraints, relations                                                             | Implemented                                  |
| Adapter methods (`createConnectedAccount`, `createOnboardingLink`, `getConnectedAccount`, `reverseTransfer`) | Implemented, **never called against Stripe** |
| `account.updated` / `account.application.deauthorized` handling                                              | Implemented                                  |
| Transfers, payouts, disputes as state machines                                                               | Implemented, mock mode                       |
| **An API route that starts onboarding**                                                                      | **NOT IMPLEMENTED**                          |
| **A screen an organiser onboards through**                                                                   | **NOT IMPLEMENTED**                          |
| Any Stripe API call, ever                                                                                    | **EXTERNAL VERIFICATION PENDING**            |

The onboarding gap is real and is not softened here. The Stripe adapter can
create a connected account and an onboarding link; nothing in `apps/api`
calls either. A `ConnectedAccount` row reaches the database today only by
seeding, and is kept current by the `account.updated` webhook handler. Payouts
read it; no product surface creates it.

---

## The charge model: destination charges

Chosen: **destination charges with `on_behalf_of` and an application fee.**

```
buyer ──charge on the PLATFORM account──┐
                                        ├─ transfer_data.destination → organiser's connected account
                                        └─ application_fee_amount    → Desi-Event
      on_behalf_of = the connected account (settlement merchant)
```

### Why, in one paragraph each

**Not direct charges**, because the platform then cannot read a charge without
acting as the connected account on every request. Every support lookup, every
reconciliation query and every finance report becomes a per-account API call,
and `Stripe-Account` becomes a correctness-critical parameter on hundreds of
calls where getting it wrong reads another tenant's data. The publishable key
would also become per-organiser, giving the checkout page a failure mode before
it can render a card field.

**Not separate charges and transfers**, because the money would land in the
platform balance — which makes Desi-Event a holder of other people's funds, with
negative-balance exposure, a balance to monitor, and a materially larger
regulatory surface. Nothing in Phase 2 needs the flexibility it buys, and taking
custody of other people's money to get a feature nobody asked for is a bad
trade.

### The invariant it rests on

**One order carries tickets from exactly one organiser.** Structural, not a
convention: `Order.eventId` → one `Event` → `Event.organizationId` → one
`Organization`. There is no split-organiser cart in the schema and no route that
could create one.

One hole in that was closed in the same migration as the decision: nothing
stopped an `OrderItem` referencing a `TicketType` from a _different_ event. The
database now refuses it (`desi_order_item_event_matches`), because under any
Connect model the organiser is derived from the order, and a line from another
organiser's event would attribute money to the wrong account. Recorded as
**NF-04**.

---

## What this does NOT make Desi-Event

Repeated from the ADR because it is the part most likely to be assumed:

- **Not merchant of record.** `on_behalf_of` names the connected account as the
  settlement merchant. What that means commercially and legally has not been
  decided, and no code here asserts it.
- **Not an agent, escrow provider or money transmitter.** Funds are never held.
  There is no balance to hold them in.
- **Not a tax remitter or determiner.** Every tax rate shipped here is marked
  `DEMO`, and production fails closed without a real determination.
- **Not the legal seller.** The organiser sells; Desi-Event provides the
  platform.

---

## Connected account state

What is stored, and deliberately no more:

| Field              | Why                                                   |
| ------------------ | ----------------------------------------------------- |
| `chargesEnabled`   | Whether this organiser can take money                 |
| `payoutsEnabled`   | Whether they can be paid                              |
| `detailsSubmitted` | Whether onboarding was finished                       |
| `disabledReason`   | Why not, when not                                     |
| `requirementsDue`  | **Counts** of currently-due and past-due requirements |
| `syncedAt`         | When this was last true                               |

`requirementsDue` holds counts, never contents. This system needs to know
whether an organiser can be paid; _which_ identity documents Stripe is still
waiting for is Stripe's hosted page to say, and keeping that list in a row here
would be storing somebody's onboarding paperwork status for no operational
reason.

`account.application.deauthorized` sets both enabled flags false with
`disabledReason: 'deauthorized'`. An organiser who disconnects stops being
payable immediately rather than at the next sync.

---

## Payouts never name a destination

**No route accepts a payout destination.** Where an organiser's money goes is a
property of their connected account, changed through onboarding with its own
step-up.

A payout request that could name a bank account is the shape of every
marketplace payout fraud there has ever been, and the defence is structural: the
field does not exist, so no authorization bug can expose it.

`desi_payout_currency_matches` refuses a payout in a currency the account does
not settle in. `payout_paid_has_provider_reference` refuses a paid payout with no
provider reference — a payout marked paid that cannot be traced is worse than
one that failed.

---

## Refunds against a transfer

With destination charges the organiser's share has already moved. A refund
therefore has two decisions, and both are explicit per refund rather than
implied:

- **`reverse_transfer`** — claw the organiser's share back out of their balance.
- **`refund_application_fee`** — whether the platform gives its fee back.

A partial reversal leaves the transfer `PAID` with `reversedCents` set: a
transfer that is half back is still a transfer that happened, and calling it
`REVERSED` would say the whole thing came back. The update is conditional on
that counter, so two partial reversals cannot together take back more than was
sent (`transfer_reversal_within_amount`).

---

## Liability, stated rather than implied

With destination charges the charge lives on the **platform** account, so a
dispute is raised against the platform and the platform is the respondent unless
`on_behalf_of` shifts it. What Phase 2 models:

- A dispute withholds the disputed amount from organiser funds
  (`Dispute.fundsWithheld` defaults to true), and an open dispute is subtracted
  from what an organiser may be paid.
- A refund after payout can leave the connected account short — which is what
  `Transfer.reversedCents` and the reconciliation queue exist for.
- **Negative balances are an exit criterion, not a solved problem.** Nothing
  here decides who absorbs one.

None of this has been exercised with real money, and none of it is claimed to be
operationally proven.

---

## The fee must agree with the ledger

The application fee is the only place the platform's revenue appears on the
charge, so Stripe's `application_fee_amount` and the ledger's
`platform_fee_revenue` account must agree. Comparing them is a reconciliation
task, described in `docs/RECONCILIATION_RUNBOOK.md`.

---

## What would close the pending items

1. A Stripe test-mode account with `sk_test_`/`pk_test_` keys and a `whsec_`
   webhook secret, in an environment somebody controls.
2. Routes for `connect.start` and `connect.status`, calling the adapter methods
   that already exist, behind `connect:manage` and a `PAYOUT` step-up.
3. An organiser screen that sends somebody to the hosted onboarding link and
   shows them what Stripe still wants.
4. The sandbox checkout, refund, transfer and payout paths exercised and
   recorded.

Items 2 and 3 are code this repository could write today; item 1 is the external
dependency, and item 4 needs all three.
