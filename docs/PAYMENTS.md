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

The buyer is told so, in words production does not mask: a 502
`PAYMENT_TIMEOUT` (or, when the capture succeeded and the order still could not
be completed, a 500 `ORDER_NOT_COMPLETED`) says whether they were charged is
being checked and not to pay again, and `error.orderReference` names the order.
The site shows that sentence, takes Pay away, and links to the order's page,
which says "Waiting for payment" until the task is resolved.

---

## A retry is the same attempt

Checkout takes an `Idempotency-Key`, and the site mints one per attempt and
sends it again on a retry, so a lost answer cannot book twice. What a retry is
told matters as much as what it does. It used to be told 201 with whatever
order the key had placed, so a retry after a timeout received a `PENDING` order
with no tickets under a success status, and the checkout showed "Booked".

A retry now answers with the attempt's own outcome, read from the order as it
stands, and never places a second order or charges twice:

- **Sold** (`PAID`, or `REFUNDED` since): 201 and the order.
- **Still being checked** (`PENDING`: the first request still running, a
  capture that timed out, or one captured and not completed): 409
  `ORDER_PENDING` with `error.orderReference`. The attempt is not finished;
  answering with a success would say it was, and answering with a new charge
  would pay twice.
- **Declined** (`CANCELLED` with a failed payment): 402 `PAYMENT_DECLINED`, as
  the attempt was. Trying again is a new attempt with a new key, and the holds
  are still the buyer's for it.
- **Cancelled otherwise** (a free order whose settlement refused) or
  **expired**: 409 `ORDER_CANCELLED`. Nothing was charged; reserve again.

A 201 is therefore always a sale. The site checks the order's status all the
same, and shows anything but `PAID` as not booked. Two requests with one key
that both miss the opening read, a double submission, meet on the key's unique
index; the second is answered as a retry, not with a 500.

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

## One price for the quote and the charge — 2026-09-29

`POST /v1/orders/quote` and `POST /v1/orders` price a basket with the same
function, `priceCheckout` in `apps/api/src/lib/checkout-pricing.js`. The quote
calls it read-only (`lock: false`) inside a transaction that writes nothing; the
order calls it with `lock: true` inside the transaction that writes the order.
There is no second pricing path, so the figure a buyer is shown and the figure
they are charged cannot come from different rules.

**The quoted total is a precondition.** The order carries `expectedTotalCents`,
the total the buyer saw. When the locked recomputation disagrees — a code was
paused, used up or ended, a tier's price changed — the order is refused with
`409 PRICE_CHANGED` before anything is written, and nothing is charged. The
refusal's body carries its code and message only, so the checkout asks for a
fresh quote, shows the new total and asks the buyer to pay again with a new
attempt key.

**A promo code is locked before it is counted.** Rows are locked in one order —
ticket types, then event sessions, then the promo code (`SELECT … FOR UPDATE`) —
and the code is read again under its lock, so two checkouts racing for the last
use of a capped code cannot both take it. The database is the backstop: the
`promo_code_redemptions_within_cap` CHECK refuses a `redemptionCount` above
`maxRedemptions` whatever the application does.

**A use is given back when the payment fails.** `compensateCheckout`, which
cancels an order whose (mock) payment was declined, decrements the code's
`redemptionCount` in the same transaction, conditionally so it never goes below
zero: a declined card does not use up a capped code. It also clears the guests'
names staged on the order's lines.

A code is a bearer discount. It travels in request bodies only, never in a URL,
a log line (the logger redacts `promoCode`), an audit record's metadata or an
outbox row. Payments remain `PAYMENT_MODE=MOCK`.

**Pay is offered only against a quote.** The checkouts never send an order
without the server's own figure: until a quote answers — after a network
failure, a 429 from the quote limit or a refusal — the Pay button names no
amount and cannot be pressed, the reason is shown with a way to ask again, and
the code sent with an order is the one the quote priced, never a code chosen
since.

**A hold an order is waiting on stays with that order.** `orders.create`
attaches the buyer's holds to the PENDING order before it calls the payment
provider, and a capture that times out leaves the order PENDING for
reconciliation, possibly past the holds' own time. The expiry sweep, the
reclaim of lapsed holds when another buyer chooses the same seats, and
`DELETE /v1/holds/:id` (409) all leave such a hold, and its seats, alone until
the order is paid or cancelled; a declined card cancels the order, after which
the hold lapses as usual. Settlement is the backstop: `settleCheckout` refuses,
and rolls back, when an order reserved seats that are no longer held for it,
rather than issue tickets with no seat behind them while those seats are back on
sale. Lock order for a seat hold: the paths that give seats back lock the
`TicketHold` and then its `EventSeat` rows, settlement the other way round; they
never meet on one hold because settlement touches only its own PENDING order's
holds, which the other paths skip.

## Booking fees, referral codes and paying at the venue — 2026-10-09

ADRs 0016 and 0017 add a second way to pay and a way to waive the booking fee.
Everything here runs in `PAYMENT_MODE=MOCK`; every pay button says
"(simulated)".

### Two payment methods

`Order.paymentMethod` is `CARD` or `AT_VENUE`, chosen at checkout with "Pay by
card now" or "Pay at the venue" when the event offers both.

| Method     | Paid online (`totalCents`)                                          | Paid at the door (`venueDueCents`)                  |
| ---------- | ------------------------------------------------------------------- | --------------------------------------------------- |
| `CARD`     | ticket price after the promo, the booking fee, and tax on both      | nothing                                             |
| `AT_VENUE` | the booking fee and any tax on it — no tax on it in this build (R1) | the ticket price after the promo, shared per ticket |

CHECK `order_venue_payment_shape` holds the second row:
`totalCents = feesCents + taxCents` and
`venueDueCents = subtotalCents − discountCents > 0`. The door part never
reaches the payment provider or the ledger (ADR 0017 §8).

### The online part, and when it is nothing

A pay-at-the-venue order becomes PAID when its online part settles, through the
same two-phase boundary as a card order: the mock provider captures the booking
fee exactly as it captures a card order's total. When that part is 0 — the
booking fee waived by a referral code (ADR 0016), or an event whose own fee is
0% and $0 — no `Payment` row exists; the order is settled in its own
transaction, as a free order is. The checkout button then reads "Book now — pay
{amount} at the door" instead of "Pay booking fee {amount} (simulated)".

### The fee, and what the buyer agreed to

`priceCheckout` prices the quote and the charge with one function, now with the
event's own terms when it has them, and records them on the order
(`feeSource`, `feeSettingId`, `feePercentageBps`, `feeFlatCentsPerTicket`,
`feeGrossCents`, `feeWaivedCents`). The order refuses with 409 `PRICE_CHANGED`
when the buyer's figures no longer match — the online total
(`expectedTotalCents`) and, for a booking to pay at the venue, the door price
(`expectedVenueDueCents`) — so a fee changed while a buyer was paying is shown
to them before anything is charged. The site default's flat part comes from
`PLATFORM_FEE_FLAT_CENTS` for INR orders only; every other currency takes the
currency table, so a USD order pays $0.99 a ticket whatever that variable says.

### A future real-payments stage

The online booking fee of a pay-at-the-venue order is Desi-Event's revenue, with
no organiser share. A stage that switches on real payments must charge it as a
platform charge — no `on_behalf_of`, no `transfer_data` — and refund it with
`reverseTransfer: false`, so the fee is never routed to, or clawed back from,
the organiser's connected account (ADR 0017 §8, ADR 0003). No code here makes
such a call: production payments stay unreachable, as above.
