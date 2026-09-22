# Payments

## Production payments are unreachable

Not "disabled", not "not configured". **Unreachable.** `PAYMENT_MODE=live`, or a
credential that looks live in any variable anywhere in the environment, refuses
the boot. A deployment that believes it has card payments is stopped before
Fastify is constructed, so it finds out from a boot log rather than from a
buyer.

The gate is `packages/providers/src/payment-mode.js`, and it is the first thing
the API and the worker call. Its rules:

| Situation                                     | What happens                                               |
| --------------------------------------------- | ---------------------------------------------------------- |
| No credentials at all                         | Mock mode. A fresh clone, CI and a demo all work           |
| A complete set of Stripe **test** keys        | `stripe_test`, and only then                               |
| `sk_live_`, `pk_live_` or `rk_live_` anywhere | **Refuses to boot**, in any mode                           |
| `PAYMENT_MODE=live`                           | **Refuses to boot** rather than being downgraded           |
| Test and live credentials mixed               | **Refuses to boot** — that is somebody mid-migration       |
| A secret key with no webhook secret           | **Refuses to boot** — it would take money and never hear   |
| A mode or a secret in `NEXT_PUBLIC_*`         | Not authority. A browser-readable variable decides nothing |

Credential _values_ never leave that module. Everything it reports names the
variable and nothing else, and the resolved credentials hang off the result as a
non-enumerable property so logging or serialising the resolution cannot leak
them.

`apps/api/tests/payment-kill-switch.test.js` asserts all of it, and CI runs that
file on its own as a named step so a failure is unmissable.

---

## Card data never enters this application

There is no field anywhere — request schema, database column, log, audit row,
analytics event or test fixture — that holds a card number, a CVC,
magnetic-stripe data or a payment cryptogram. There is no code path that could
receive one.

The PCI boundary is therefore the browser's connection to the provider, and this
application is outside it. In `stripe_test` mode the card details go from the
buyer's browser to Stripe's Payment Element; this server sees an intent
identifier and an amount. In mock mode there is no card at all.

`scripts/scan-secrets.mjs` runs in CI over every tracked file, and
`scripts/scan-browser-bundle.mjs` runs over every browser-deliverable artefact.

---

## The two-phase boundary

**A provider is never called inside a database transaction.** Checkout is three
steps and the boundaries are the whole design:

1. **Reserve and commit.** A transaction takes the inventory, writes a `PENDING`
   order and a payment attempt, and commits. Nothing has been charged.
2. **Capture, with nothing open.** `captureOutsideTransaction` calls the
   provider. No row is locked; a slow provider is slow and not a held lock.
3. **Record, in a short transaction.** `settleCheckout` moves the order to
   `PAID`, sells the seats, mints the tickets, posts the ledger and updates the
   payment — conditional on the order still being `PENDING`, so a webhook and
   this path cannot both settle it.

The same shape appears in refunds and in payouts, for the same reason.

### Why a browser redirect is never proof of payment

Because a buyer can close the tab, replay the URL, or forge it. Fulfilment is
driven from the provider's callback — `POST /v1/payments/webhook` — and from
nothing else. The redirect target reads the order back and shows whatever the
server already believes.

---

## Timeout is not failure

A provider that does not answer has not said the charge failed. Reading silence
as failure cancels an order somebody may have paid for; reading it as success
gives away tickets nobody paid for. So a timeout is its own state:

- The order stays `PENDING`.
- The payment becomes `TIMEOUT` with `reconciliationRequired`.
- A `ReconciliationTask` of kind `PAYMENT_TIMEOUT` is opened, carrying what this
  system believed at the time, verbatim.

A person resolves it through the reconciliation queue, which re-queries the
provider and applies the answer through the ordinary domain commands. See
`docs/RECONCILIATION_RUNBOOK.md`.

---

## Mock mode, and how it says so

Every artefact the mock provider produces carries `mode: 'MOCK'`, `demo: true`
and a notice: _"DEMO — no money moved, no card was charged, and this is not a
valid receipt."_ That includes intents, captures, **refund receipts**, transfers
and payouts — a refund receipt especially, because it is the artefact somebody
is most likely to be shown as proof that money came back.

The finance screens repeat it above the figures rather than below them, and the
CSV export carries it on its first row. So does the analytics screen, and so
does its export — whose first three rows say the payment mode, the time zone,
and whether money was included at all and why not. A figure a reader cannot
attribute is a figure they will attribute wrongly.

### What the mock models, and why each

| Behaviour             | Why it is modelled                                                       |
| --------------------- | ------------------------------------------------------------------------ |
| Partial refunds       | Ceiling arithmetic that is never exercised is arithmetic that is wrong   |
| Decline by amount     | A reproducible refusal, rather than a random one                         |
| Timeout by amount     | The case where nobody knows whether the money moved                      |
| Transfers and payouts | A marketplace that cannot test a failed payout finds out in production   |
| Idempotency keys      | A retried request returns the first result rather than a second movement |

Levers are per-operation: `declineAmountCents`, `timeoutAmountCents`,
`refundDeclineAmountCents`, `refundTimeoutAmountCents`,
`transferFailAmountCents`, `payoutFailAmountCents`. A test that wants a refused
refund should not have to arrange a refused capture first.

---

## Stripe: EXTERNAL VERIFICATION PENDING

No Stripe credentials are available to this project, so **no Stripe API call has
ever been made from this code**. The adapter in
`packages/providers/src/stripe.js` is written and unit-tested against its own
contract; it has not been run against Stripe's sandbox.

That status is recorded rather than worked around. This repository contains no
fabricated Stripe object identifier, no invented webhook payload, no screenshot
and no CLI transcript. Where a document would otherwise claim Stripe works, it
says EXTERNAL VERIFICATION PENDING instead.

What would close it: a Stripe test-mode account, `sk_test_`/`pk_test_` keys and
a `whsec_` webhook secret in an environment somebody controls, then the sandbox
checkout, refund, transfer and payout paths exercised and recorded.

**Only `packages/providers/src/stripe.js` imports the Stripe SDK.** A second
import site would be a second place where the amount, the idempotency key and
the API version get decided. A test asserts the list has exactly one entry.

---

## Where to look

| Question                                   | File                                         |
| ------------------------------------------ | -------------------------------------------- |
| Which mode will this environment start in? | `packages/providers/src/payment-mode.js`     |
| What does the mock actually do?            | `packages/providers/src/payments.js`         |
| Where is the transaction boundary?         | `apps/api/src/lib/checkout.js`               |
| What happens when nobody knows?            | `apps/api/src/lib/reconciliation.js`         |
| Is production really unreachable?          | `apps/api/tests/payment-kill-switch.test.js` |

## Simulated connected accounts — 2026-09-22

A mock-mode payout-setup sequence exists at `/finance/connect`, backed by
`connect.status` and `connect.start`. It is a state machine over a row and
nothing else: no payment provider is contacted by it, no account exists at one,
no onboarding link is created and no money can move through anything it writes.

Two properties matter for this document.

**It cannot run outside the mock.** Both routes refuse unless
`app.payments.mode === MOCK` **and** `providers.payments.name === 'in-memory-payments'`.
Both halves, because this repository holds two notions of payment mode that can
disagree — the boot gate's resolution, and the provider-name sniff that
`finance.js` and `analytics.js` use and that reaches buyers through
`money-figure.jsx`. The gate is authoritative here; the provider name is the
second lock, and it is what stops the surface simulating after a real adapter is
wired into the registry.

**A simulated account is not a payout destination, and its currency is null for
that reason.** `apps/api/src/routes/finance.js:277-287` already attaches whatever
connected account it finds to every payout it schedules, with no filter on
lifecycle state. There were no `ConnectedAccount` rows before this change, so
that lookup always returned null; it does not any more. A simulated row
therefore leaves `defaultCurrency` NULL, which is the repaired
`desi_payout_currency_matches` trigger's documented "declares no currency, so
there is nothing to compare against" path. A fabricated currency would refuse
real payouts for any organisation whose currency differed, as a bare 500 — a
PL/pgSQL `RAISE` is not a Prisma `P2002` and is caught nowhere in the payout
path.

Whether payout scheduling should filter on lifecycle state is an owner decision
recorded in `docs/STRIPE_CONNECT.md` and deliberately not taken here, because it
changes real payout behaviour.

Production payments remain disabled. Real Stripe and real Stripe Connect remain
`EXTERNAL VERIFICATION PENDING`.
