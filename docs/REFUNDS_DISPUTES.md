# Refunds, disputes, transfers and payouts

A refund is the one commerce action where every failure mode costs somebody
money. Over-refund gives away money that was never taken; under-refund keeps
money that is owed; a refund settled twice does both.

---

## The refund lifecycle

```
REQUESTED ──► APPROVED ──► SUBMITTED ──► SUCCEEDED
                                │
                                ├──► DECLINED ──► (APPROVED again)
                                ├──► FAILED   ──► (APPROVED again)
                                ├──► TIMEOUT  ──► SUCCEEDED | FAILED | RECONCILIATION_REQUIRED
                                └──► RECONCILIATION_REQUIRED

REQUESTED / APPROVED / DECLINED / FAILED ──► CANCELLED
```

The table is written out in `apps/api/src/lib/refunds.js` as
`REFUND_TRANSITIONS`, because "can a declined refund be resubmitted?" otherwise
gets three different answers in three places. Every transition goes through one
function, and every one is a conditional `UPDATE` whose affected-row count
decides a race.

### Why four steps rather than one

1. **REQUESTED** — somebody asked. The amount is reserved against the order's
   remaining balance _in the same transaction_, which is what stops two requests
   from together exceeding the total. Nothing has been sent anywhere.
2. **APPROVED** — policy was satisfied. Still nothing sent.
3. **SUBMITTED** — written _before_ the provider is called, so a process that
   dies mid-call leaves durable evidence that a refund may exist. The
   alternative is an approved row and a refund nobody knows about.
4. **SUCCEEDED** — a short transaction recording the outcome, revoking the
   tickets, posting the ledger and moving the reservation from pending to
   settled. Conditional on the refund still being SUBMITTED, so two workers
   racing produce one settlement.

---

## The ceiling is a database constraint

`Order.refundedCents + Order.refundPendingCents <= totalCents` is a CHECK. This
application reserves into `refundPendingCents` before any provider call and
moves it to `refundedCents` on settlement, so the sum is correct at every
instant in between.

Two concurrent requests for the whole order do not both succeed: PostgreSQL
serialises them on the row and the second violates the constraint. That check
could have been done in application code — read the balance, compare, write —
and it would be wrong under concurrency in a way that is almost impossible to
notice in testing and expensive in production.

### Refunding by line

A request may name an amount, or name order items and quantities. The amount
follows from the order's own unit prices in both cases; **no price is ever taken
from a request**. A caller who could name what a ticket cost could refund more
than was paid.

A line's remaining quantity counts what has settled _and_ what unresolved
refunds have already spoken for. The money ceiling alone would let two pending
refunds between them revoke one ticket and pay for two.

---

## Timeout is not failure

The single most expensive thing this module could get wrong. On a timeout:

- the refund becomes `TIMEOUT`;
- **the reservation stays**;
- a `ReconciliationTask` of kind `REFUND_UNKNOWN` is opened, naming the refund.

Releasing the reservation would let somebody refund the same money again while
the first attempt is still possibly in flight. A refusal is different — nothing
moved, so the reservation is released and the order is refundable again.

---

## Separation of duties

Three capabilities, because in most organisations three different people:

| Capability             | What it allows                                      |
| ---------------------- | --------------------------------------------------- |
| `order:refund_request` | Ask. Under a policy requiring approval, that is all |
| `order:refund_approve` | Approve somebody else's request                     |
| `order:refund`         | Do both, and submit to the provider                 |

An approver holding only `order:refund_approve` may not wave through their own
request. Somebody holding `order:refund` may, because that capability is what
says one person may do both — which is how a one-person finance team works,
without the separation being quietly absent for everybody else.

Every refund route requires MFA. Reading one needs a `FINANCE_VIEW` step-up
(fifteen minutes); requesting, approving, submitting or cancelling needs
`FINANCE_ACTION` (five minutes). The windows are named server policies — a route
never names a number.

### The screen

`/finance/refunds/:id`, reached from the queue on `/operations`. It shows what
goes back and how it divides across face value, fee and tax; which order lines
it came from; why; whether the tickets are revoked and the inventory returned;
the provider's reference if there is one; and how many times it has been tried.

**The amount is not a field on it.** It was computed from the order's own lines
when the refund was requested, and the database will not accept a refund that
takes an order past what it was paid. A screen that could propose a figure is a
screen where "the browser said 90,000" decides how much of somebody's money goes
back, and no amount of validation makes that safe. A test asserts the request
body contains no `amountCents`.

**No card number, no CVC, no expiry, no token, and nothing that asks for one.**
Giving money back uses the payment this system already holds a reference to. A
refund screen with a card field would be a phishing page with a legitimate URL,
and the developer having meant well would not help whoever typed into it. A
browser case reads the whole rendered page and asserts none of those words
appear, and that no input on it would accept a number.

What is drawn depends on the refund's state and on what the account holds —
neither of which is the authorisation. Sending is not offered on a refund nobody
has approved; cancelling is not offered on one already sent, because by then the
question is what the provider did rather than what we intended. Separation of
duties is not worked out on the page: the command goes, and the refusal comes
back with its own code and is repeated rather than routed around.

---

## What happens to the seats

Explicit, never assumed. `seatPolicyFor` decides:

- **`RESELL`** — back to `AVAILABLE`. The default when the event is more than 24
  hours away.
- **`WITHHOLD`** — `BLOCKED`, with a reason an organiser can read. The default
  inside the cutoff.

Both directions have a wrong answer: resell a seat for an event starting in an
hour and two people arrive at it; withhold one from an event three months away
and the organiser loses a sale. An organiser may override, and the choice is
recorded in the audit row either way.

Whole tickets only. A refund of half a ticket's value does not revoke half a
ticket, and rounding up would revoke one the buyer still paid for.

---

## Disputes

```
OPENED ──► UNDER_REVIEW ──► WON | LOST ──► CLOSED
```

Opening one is idempotent on the provider's own identifier, because a dispute
webhook is delivered more than once as a matter of routine and opening two would
hold the money twice. Opening posts a batch moving the amount from
`organizer_payable` to `dispute_clearing`; resolving posts another, back to the
organiser on a win and out on a loss.

An open dispute is held out of what an organiser may be paid. See
`docs/FINANCIAL_LEDGER.md`.

---

## Transfers

```
PENDING ──► SUBMITTED ──► PAID ──► REVERSED
              │
              ├──► FAILED ──► (SUBMITTED again)
              └──► RECONCILIATION_REQUIRED ──► PAID | FAILED
```

A partial reversal leaves the transfer `PAID` with `reversedCents` set: a
transfer that is half back is still a transfer that happened, and calling it
`REVERSED` would say the whole thing came back. The update is conditional on
that counter, so two partial reversals cannot together take back more than was
sent.

---

## Payouts

```
SCHEDULED ──► SUBMITTED ──► PAID ──► REVERSED
    │                         │
    │                         ├──► FAILED ──► (SCHEDULED again)
    │                         └──► RECONCILIATION_REQUIRED ──► PAID | FAILED
    │
    ├──► HELD ──► SCHEDULED
    └──► CANCELLED
```

`HELD` is not an exception path. It is the ordinary outcome of scheduling a
payout against a balance that cannot support it, and the reason is stored —
_"only 300000 of 700000 is available"_ — because a payout that did not go and
cannot say why is the complaint this surface exists to prevent.

**No route accepts a destination.** Where an organiser's money goes is a
property of their connected account, changed through onboarding with its own
step-up. A payout request that could name a bank account is the shape of every
marketplace payout fraud there has ever been.

Sending has the same three-phase boundary a refund does: SUBMITTED first in its
own transaction, the provider called with nothing open, a short transaction
recording the answer and posting the ledger. A provider that does not answer is
`RECONCILIATION_REQUIRED` and the amount stays counted as in flight.

---

## Mock mode

Every one of these paths runs against the in-memory provider. Refund receipts,
transfer receipts and payout receipts all carry `demo: true` and a notice saying
no money moved.

**Real Stripe execution of any of it is EXTERNAL VERIFICATION PENDING.** No
Stripe refund, transfer or payout has been made from this code, and no
identifier for one has been invented to make a row look complete.

---

## Concurrency, proved rather than asserted

`apps/api/tests/refund-concurrency.test.js` runs twelve races against real
PostgreSQL, wired into `pnpm run db:verify:fresh`:

two full requests · a retried request · full against partial · five quarters
against the ceiling · a line refund against one already spoken for · a duplicate
provider answer · a timeout then a webhook saying it worked · a refund then a
chargeback · a refund against a transfer · a refund against a check-in, in both
orders · a refusal that rolls back completely.

## A line refund on a discounted order — 2026-09-29

A promo code takes money off the order as a whole. Checkout spreads that
discount over the order's lines in proportion to their subtotals
(`allocateProportionally`), and a refund by line now nets each line's share off
what it gives back: a ticket is refunded what was paid for it, not its face
value. The share is counted ticket by ticket — the first `n` tickets of a line
carry `floor(share × n / quantity)` of it — from the tickets already refunded or
asked for, so several partial refunds of one line add up to exactly its share
and never a cent more. `allocateNamedLines` in `apps/api/src/lib/refunds.js`;
the cases are in `apps/api/tests/refund-allocation.test.js`. The order's money
ceiling is unchanged: the total paid, which is already net of the discount.

## Fees, tax and retries — 2026-09-30

Nine defects in the refund service, all present before this date and all found
by reading the code against orders that carry the USD fee (99¢ a ticket), tax
and a promo code. Every test that existed used fee-free orders, so none of them
showed. They are fixed in `apps/api/src/lib/refunds.js` and around it, and
proved on real PostgreSQL in `apps/api/tests/refund-fees-integration.test.js`
against orders priced by `computeOrderTotals` (`apps/api/tests/helpers/fee-orders.js`):
2 × $50 and 1 × $20, 50 % off, the fee, and 825 basis points of tax — $72.00.

### What a refund is made of

An order's money has three parts: face value net of the discount, the platform
fee and the tax (`orderParts`). They must add up to the total; an order whose
stored parts do not is refused `409 ORDER_TOTALS_INCONSISTENT` rather than
refunded from numbers that disagree.

`Refund.allocation` records the refund's share of each part:
`{ faceValueCents, feeCents, taxCents, form, whole }`. The ledger batch is
posted from it, as before. **Only the face value goes onto order lines**:
`RefundItem.amountCents` and `OrderItem.refundedCents` count face value, which
is what the line CHECK (`refundedCents <= subtotalCents`) means. Before, the
whole amount — fee and tax included — was spread over the lines, so a full
refund of any order with a fee failed that CHECK in settlement, after the
provider had already paid, and stayed `SUBMITTED`.

| Form   | How it is asked for                                                 | What it gives back                                                                                                                                                                |
| ------ | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| whole  | `amountCents` equal to everything left (or `whole: true` from code) | everything left of each part                                                                                                                                                      |
| amount | any smaller `amountCents`                                           | fee and tax in proportion, rounded and capped by what is left of each; face value is the rest, never negative                                                                     |
| lines  | `lines`                                                             | the named tickets' face value net of the discount, plus their share of the fee and tax, floored cumulatively so successive line refunds add up to exactly the order's fee and tax |

### Which tickets go

- A **whole** refund withdraws every ticket still standing on every line, free
  lines included. On a discounted order the old rule, `floor(amount / unit
price)`, left one of two half-price tickets valid after a "full" refund.
- A **partial** refund withdraws only the tickets its share pays for in full,
  counted at what was paid for them after the discount, ticket by ticket. The
  line is given what those tickets cost and no more; the rest of its share is
  money-only (below), so a later refund of the line's other tickets by name
  finds their full price still there.
- A share that pays for no whole ticket writes **no** refund line: the money is
  recorded on the order and in the split, and the audit row's `moneyOnlyCents`
  says how much. The old `Math.max(1, …)` withdrew a ticket the buyer still
  paid for.

### Retries reserve again

A refusal (`DECLINED`) or a failure (`FAILED`) releases the reservation,
because nothing moved. Approving such a refund again now takes the reservation
back in the same transaction (`reserveAgain`, under the order's row lock): the
tickets on its lines, each part of its allocation and the money must all still
be there. When another refund has taken some of it since, the approval is
refused `409 REFUND_BALANCE_GONE` and nothing changes — cancel it and ask for
what is left. Before, the retry settled into a negative `refundPendingCents`,
which the Order CHECK refused after the provider had paid. The approval's audit
row carries `reReserved: true`.

### Event cancellation reserves

`events.cancel` now asks the refund service for a whole refund of every paid
order (`requestRefund`, key `event-cancelled:<event>:<order>`): reserved, with
its lines and its split, so finance approves and submits it like any other and
it settles. It still sends nothing. A paid order with nothing left, or whose
payment is disputed, gets no refund and is counted instead; the counts and the
disputed orders' ids are in the `event.cancelled` audit row (`refundWork`), and
each disputed order gets a reconciliation task (below).

Cancellation refunds written before this change (`REQUESTED` or `APPROVED`,
reason `EVENT_CANCELLED`, no allocation, no lines) reserved nothing and could
never settle. They are repaired the first time `refunds.approve` or
`refunds.submit` touches them (`repairUnreservedRefund`, audited
`refund.reservation_repaired`):

- the order still has the amount left — it is reserved in place, with lines and
  split, and keeps its status;
- the order has less left, because some was refunded since — the old row is
  withdrawn without touching the counters ("Replaced: the order had less left
  to refund than this request named") and a whole refund of what is left is
  asked for under `<old key>:repaired`, approved when the old row was;
- nothing is left — the old row is withdrawn.

`refunds.cancel` of such a row releases nothing, because nothing was reserved.

### Money taken on a closed order

A `payment_intent.succeeded` for an order that is no longer `PENDING` (cancelled
or expired while the payment was in flight) used to record `order.paid` and
nothing else, so the money was lost from view. Now the
order is left as it is, a `PROVIDER_MISMATCH` reconciliation task is opened for
the organisation — "The money was taken: refund it from the order, then note
this task." — and `payment.succeeded_after_close` is recorded instead. The
refund goes through `refunds.request` on that order: its payment is
`SUCCEEDED` and its whole total is refundable.

### Disputed payments are not refunded here

A refund request, a retry and a legacy repair all refuse a payment with a
dispute in `OPENED`, `NEEDS_RESPONSE`, `UNDER_REVIEW`, `CHARGE_REFUNDED`, `LOST`
or `CLOSED`: `409 PAYMENT_DISPUTED`. Event cancellation asks for no refund of
such an order and counts it instead (`skippedDisputed`). The dispute decides
where that money goes, and a refund beside a chargeback pays the buyer twice.
`WON`, `WARNING_NEEDS_RESPONSE` and `WARNING_CLOSED` do not block.

### One submit path

`refunds.submit`'s three steps — `SUBMITTED` in its own transaction, the
provider with nothing open, a short transaction recording the answer — are
`submitRefund(prisma, providers, …)`, so every caller shares them. Settlement
decides whether the order is now refunded in full from the counters its own
update returns, not from the caller's copy of the order.

A refund that gives back fee or tax and no face value (a one-cent refund of a
$1.00 ticket, say) now settles: its ledger batch leaves out the organiser's
line, which a ledger entry of zero cannot carry.

### Review corrections — 2026-09-30

A review of the repair above drove the refund routes on real PostgreSQL and
found nine more ways for money to go wrong. Each is fixed and has a case in
`apps/api/tests/refund-fees-integration.test.js` (cases 1, 14–23) that fails
without it.

- **Everything is decided under the order's row lock.** `requestRefund` reads
  the order, its lines and what unresolved refunds hold on each line after
  taking the lock, and uses the caller's copy for its id only. Deciding from a
  copy read before the lock let two requests for the last ticket on a line both
  be reserved and both settle (the buyer paid twice for one ticket), and let a
  whole refund put a ticket on a line another refund had just emptied.
- **No line is asked for more than it has left.** A refund by ticket takes the
  named tickets' price, capped by what the line still has to give back; a line
  an older refund gave more than its tickets cost is asked only for the rest.
- **Nothing is sent that cannot settle.** Before `SUBMITTED` is written, in
  the same transaction and under the refund's and the order's row locks,
  `assertRefundSendable` checks what settlement relies on and refuses with a
  409 while nothing has moved:
  - `PAYMENT_DISPUTED` — a chargeback opened after the refund was asked for
    decides where the money goes just as much as one opened before. Approval
    refuses it too. The refund keeps its reservation and its state: send it once
    the dispute is won, or cancel it;
  - `REFUND_NOT_RESERVED` — the order's `refundPendingCents` does not hold the
    amount, so settlement would take it below zero;
  - `REFUND_LINES_INVALID` — the refund would take a line past its subtotal,
    counting refunds already with the provider, or it spreads fee and tax over
    the lines. Refunds asked for before this date and still `REQUESTED` or
    `APPROVED` on an order with a fee are of that kind: cancel them and ask for
    what is left, and the new refund settles. Before, such a refund was paid by
    the provider and then failed the line CHECK, and stayed `SUBMITTED`.
- **A refund takes back what the organiser was credited.** Checkout credits the
  organiser the whole subtotal and carries the discount in
  `promotional_discount`. A refund now debits the organiser's payable by the
  face value it returns plus the discount that face value carried, and credits
  `promotional_discount` with that discount — cumulatively, from what earlier
  refunds of the order already reversed, and all of it once the order is
  refunded in full. Before, a fully refunded discounted order left the
  organiser owed the discount, and it could be paid out.
- **Money taken on a closed order is owed back to the buyer from the start.**
  The webhook that records it (`payment.succeeded_after_close`) posts processor
  clearing up and refund clearing owing the amount (`LC-<payment>`), because
  checkout never credited the organiser, the fee or the tax for that order. Its
  refund posts only the settlement, so nobody's payable moves; before, it
  debited the organiser, the fee and the tax for money they never had.
- **A withdrawal and a repair of the same row take turns.** `refunds.cancel`
  and the legacy repair both take the refund's row lock and then the order's —
  the order settlement takes them in — and `cancelRefund` decides whether the
  row holds a reservation from the row as it stands under them. Before, a
  withdrawal that read the row before a repair reserved it cancelled it without
  releasing the reservation, and the order could never be refunded again.
- **The order becomes `REFUNDED` when it is.** Settlement reads the counters
  off its own update. Two partial refunds that together covered the order,
  settling from the same earlier read, each missed the other's money and left
  the order `PAID` with nothing left to refund.

### Second review corrections — 2026-09-30

- **A big event can be cancelled.** Cancellation reserves a refund for every
  paid order in the same transaction as the status change, about 15 ms an
  order on a local database. Prisma's default of five seconds ran out at about
  320 paid orders: the request answered 500, the event stayed on sale and no
  refund was reserved. The transaction now has a budget sized to the event's
  orders (`cancellationTransactionOptions`: 10 s plus 100 ms an order), and a
  transition that still outruns its budget is rolled back whole and refused
  `503 SERVICE_UNAVAILABLE` — "nothing was changed: it is still ON_SALE" —
  rather than a 500. Case 28 cancels 500 paid fee orders.
- **A double-submitted request makes one refund and answers both.**
  `requestRefund` looks its idempotency key up again after taking the order's
  row lock, so the second copy of a request finds the first's refund (200)
  instead of failing on the key's unique index (a 500 carrying the database's
  message). A key already used for another order's refund is refused `409`,
  rather than answered with that order's refund (case 24).
- **Reconciliation of a refund counts the payment's other refunds.** The
  provider reports one total given back across every refund of a charge. A
  timed-out refund was settled whenever that total covered its amount, so once
  any earlier refund of the payment had settled, a refund that never reached
  the provider was marked `SUCCEEDED` and the buyer got nothing. Now what was
  settled here is taken off first, and the rest is matched against this refund
  and any other unanswered refund of the payment: settled when every match
  includes it, released (the truthful answer, which lets it be approved and
  sent again) when none does, and a conflict for a person when the total cannot
  say (case 26).
- **Tickets that take everything left are a whole refund.** A refund by ticket
  whose share of the fee and tax comes to everything the order has left — the
  paid tickets beside free ones, whose 99¢ fee goes back with the paid ones'
  share, or the last ticket a deep promo left worth nothing — is stored as a
  whole refund and withdraws every ticket still standing. Before, the free
  tickets stayed valid on an order marked `REFUNDED`, and nothing could ever
  withdraw them (case 25).
- **Cancellation says what it did not refund.** A free order is counted in
  `skippedZeroValue` (it has no payment, so it was dropped before being
  counted). The `event.cancelled` audit row carries `refundWork`: the counts
  and `disputedOrderIds`. Each disputed order gets a `PROVIDER_MISMATCH`
  reconciliation task — "If the dispute is won, refund what is left of the
  order, then note this task." — so a buyer of a cancelled event whose dispute
  is won is not forgotten. Cancellation refunds now carry the request's id in
  their audit rows (case 27).

Still open, and outside this repair: an order paid by a webhook alone (not by
checkout's own settlement) posts no `ORDER_PAID` batch, and its refund debits
the organiser as usual; and `availableBalance` holds a pending refund's whole
amount — fee and tax included — against the organiser, including a refund of
money taken on a closed order, until it settles.

## Deleting events and cancelling nights — 2026-10-06

Full control of posted events (ADR 0014) adds two ways an event's refunds are
asked for, beside cancelling the whole event. All three go through the same
service, `apps/api/src/lib/refunds.js`, with the repairs of 2026-09-30 above
in force: every refund is reserved under the order's CHECKs when it is asked
for, a retry reserves again, and a whole-remainder refund returns exactly what
is left of each part — face value net of the discount, booking fee and tax.

### Deleting an event that sold tickets

When the deletion preview's outcome is **CANCEL_AND_REFUND** (paid orders, and
the event has not taken place, or was postponed or cancelled), the deletion's
one transaction cancels the event first — through the same `cancellationWork`
as `events.cancel`, with its notices — reserves a whole-remainder refund for
every paid order whose payment is not disputed, withdraws every ticket, and
only then marks the event DELETED. A REMOVE outcome (nobody holds a paid
order) refunds nothing; a REMOVE_AFTER_EVENT outcome (it has taken place)
leaves orders and tickets as they are and refunds nobody.

Who may: organisation administrators and owners (`event:delete` and
`event:cancel`), or the Desi-Event team (`event:platform_delete`: ADMIN and
SUPER_ADMIN) for any event. No caller chooses an amount, an order or a
recipient: these refunds are always whole-order.

### Cancelling one night

`events.cancelSession` cancels one night of a multi-night event, in one
transaction that locks the event, then the night's ticket types, then the
night: the night becomes CANCELLED (final), its tiers close, its holds are
released, its unpaid orders are cancelled, its tickets are withdrawn, and each
paid order touching it gets a reserved refund — the whole order when every line
is for that night, otherwise its lines for that night with their share of fee
and tax. Nothing is refunded for zero-value lines, for a disputed payment, or
for a ticket valid for every night: its holder keeps it for the other nights
and is shown a notice, and the organiser can refund those orders one at a time
(`night-cancellation-passes` on the limitations page). One change notice per
touched order is shown on its order page; nothing is emailed.

Corrections of 2026-10-07, each with a case in
`apps/api/tests/event-full-control-integration.test.js` (XR-1 to XR-3) that
fails without it:

- **The order's other nights are kept.** A night's refund of an order's lines
  is never turned into a refund of everything (`promoteToWhole: false`), even
  when it comes to all the order has left — which it does whenever the order's
  other tickets are free, since a free ticket carries no share of the fee.
  Before, that refund withdrew the same order's free tickets for nights still
  on, every-night passes included. Settlement now marks an order REFUNDED only
  once its money is all back **and** none of its tickets still admits (VALID or
  TRANSFER_PENDING): the door refuses every ticket of an order that is not
  PAID, so an order whose kept tickets stand stays PAID with nothing left to
  refund, like a free order.
- **A sum refunded earlier does not block the night.** A refund given as a sum
  (the amount form) gives back face value without withdrawing the tickets it
  does not pay for in full, so a night's tickets can cost more face value than
  the order has left. Their refund asks for what is left instead
  (`capFaceToLeft`): the tickets are withdrawn and each line's amount is scaled
  down, because that sum already paid part of them back. Before, the request
  was refused with a 409 that named no order, and the night could not be
  cancelled at all. The preview works the amount out the same way.
- **The order is read again under its lock.** The night's orders are read
  before each order's row lock is taken; a refund of the same order that
  settled in between changed its lines. The refund is now worked out from the
  order as it stands under the lock, and lines worth nothing are decided before
  asking. Any refusal of the request itself fails the whole cancellation,
  where before it was taken for "nothing owed" and left a withdrawn ticket
  without its refund.

### The driver sends them after the commit

`apps/api/src/lib/event-refunds.js` runs after the transaction has committed,
never inside one with a provider call. It leaves a payment whose dispute is
open to the finance team (counted `disputed`), repairs a refund written before
refunds reserved anything, approves REQUESTED (and approves DECLINED or FAILED
again, which reserves again or answers `REFUND_BALANCE_GONE`), then sends and
settles each through `submitRefund`, with the seats withheld — a cancelled
event's or night's seats never go back on sale.

It sends the never-tried first, then the oldest, **in batches by payment
mode**: 500 a request with simulated payments, where a settlement is only a
write, and 25 with a real provider, so one request never makes hundreds of
provider calls. The rest wait for **`events.finishRefunds`** ("Finish refunds"
on the event, EVENT_CANCEL step-up, audited `event.refunds_driven`), or for the
organisation's finance team at the refund screens. A deletion or night
cancellation whose transaction committed stays done even if the pass after it
fails; the answer says what the pass did.

In this build payments are simulated (`PAYMENT_MODE=MOCK`): no money moves.
The limitations page states the batch as `event-refunds-batch`.

## Booking fees, referral codes and paying at the venue — 2026-10-09

ADRs 0016 and 0017. Card orders refund exactly as before; what follows is what
changed for an order paid at the venue, and the new booking-fee refund.

### What a pay-at-the-venue order is made of

`orderParts` splits an order into face value, booking fee and tax. For a
pay-at-the-venue order the face value is 0 — the ticket price was never paid
online — so its parts are the fee and the tax on it, and they add up to its
online total. Shares of fee and tax are apportioned by **basis**, the net
ticket price (`subtotalCents − discountCents`), door or card, and every refund
now stores `allocation.basisCents`: the face value for a card order (so card
orders compute as before), the basis left for a whole refund, the named
tickets' basis for a lines refund, and 0 for a booking-fee refund.

### The forms, for an order paid at the venue

| What happens                                                             | Refunded online                                                                                                 | Tickets                              | Money taken at the door                                                    |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------- |
| Refunded whole (event cancelled, event deleted, `refunds.request` whole) | what is left of the fee and its tax; nothing left online makes it a zero-value withdrawal, with no `Refund` row | every standing ticket withdrawn      | stays with the organiser; the dialog, the order page and the notice say so |
| A night cancelled                                                        | that night's tickets' share                                                                                     | that night's tickets withdrawn       | as above                                                                   |
| `refunds.request` lines                                                  | the named tickets' share                                                                                        | the named tickets withdrawn          | as above                                                                   |
| `refunds.request` amount                                                 | refused 422 `AMOUNT_REFUND_NOT_FOR_VENUE_ORDERS`                                                                | —                                    | —                                                                          |
| The booking fee refunded by hand                                         | the fee and its tax                                                                                             | none                                 | none                                                                       |
| No-show                                                                  | nothing                                                                                                         | stay valid, reported after the event | none taken                                                                 |

An amount refund is refused so an organiser can never refund Desi-Event's fee
without withdrawing tickets, and so no amount is ever promoted to a whole refund
on such an order. A lines share that rounds to 0 is a zero-value withdrawal in
the drivers and a 422 through `refunds.request`.

### The booking fee refunded by hand (`fee` form)

`platformFees.refund` asks for, approves and submits a refund of one order's
booking fee left and the tax that fee carried — `{ face 0, fee, taxOnFee }`,
basis 0, no `RefundItem` — with the same administrator as requester and
approver, a reason and `FINANCE_ACTION` step-up (ADR 0016 §2). It withdraws no
ticket, returns no place and never moves the order to REFUNDED, so a buyer let
in at the door keeps a PAID order. Since 2026-10-13 its `Refund` row records
that, `ticketsRevoked: false` and `inventoryReturned: false`, and the answer
says the same; every other form still records what settling it did.

**The tax pool.** For a pay-at-the-venue order all its tax is on the fee, so
`taxOnFee` is the tax left. For a card order it is the fee's share of the tax,
`min(taxLeft, floor(taxCents × feeLeft / (basis + fee)))` — 0 for every US
order. A FEE refund's tax is then kept out of later lines refunds' tax shares.

### Disputes and payouts

A dispute on a fee-only payment is taken from `platform_fee_revenue`, not from
an organiser who never received that money (`heldFrom`, `docs/FINANCIAL_LEDGER.md`).
An organiser's available balance holds back only what is theirs to cover: the
pending refunds of **card** orders, less pending booking-fee refunds on them,
and disputes on card orders. For an organisation with card orders only and no
booking-fee refunds every figure is what it was.

### In the simulation

Refunds settle through the mock provider as before. Refunding a seeded order —
its booking fee by hand included — answers that the refund failed: the seeded
payments were never made through the API process's in-memory provider, which
has no record of them. An order placed through the site refunds normally
(`docs/development.md`, "Seeding").

## Unpaid tickets cancelled, kept fees and referral returns — 2026-10-09

SPEC3-XI. Cancelling unpaid tickets (ADR 0017 §5) is not a refund, but every
refund now has to stay out of what it keeps.

### Kept money is out of reach of every refund

- `refundableCents(order) = max(0, totalCents − refundedCents −
refundPendingCents − venueFeeKeptCents)`.
- `partsSpokenFor` adds the kept part — fee `venueFeeKeptCents`, basis
  `venueCancelledBasisCents` — to what settled and pending refunds hold, so
  every form (whole, lines, fee, a night's quote, the drivers) computes from
  what is left after kept shares, and every later share stays exact.
- CHECK `order_venue_kept_within_total` refuses any reservation that would reach
  into kept money (`FEE_KEPT` on a race). A booking whose whole remaining fee is
  kept answers `NO_FEE_TO_REFUND` to a booking-fee refund.
- The quantity left on a line subtracts its cancelled tickets wherever a refund
  counts them, `refunds.summary` included (`cancelledQuantity`), so the refund
  dialog never offers a cancelled ticket.
- `settleRefund` marks an order REFUNDED when `refundedCents +
venueFeeKeptCents ≥ totalCents` and no ticket stands.
- A cancellation is refused while a refund of the booking is pending
  (`REFUND_IN_PROGRESS`): a pending reservation could still fail and release
  money the kept share must not overlap.

The kept share of a first cancellation is `floor(fee × basis cancelled /
booking basis)`, capped at the fee still held; later ones are cumulative floors,
as a lines refund's are. Examples: two $40 tickets at 3.00% + $1.49 (fee 538)
keep 269 for one, and the other's later refund is 269; $40 + $25 + $25 at the
site default (fee 828) keep 230 and 230 for the two $25s, then 368.

### A referral use given back

When an order that used a referral code ends without being used — refunded in
full, cancelled, its unpaid tickets all cancelled, its event or night called
off with nothing of it left, or every ticket withdrawn with nothing left to
refund — the code gets that use back once, by a marker on the order (ADR 0016
§6). `settleRefund` gives it back after its REFUNDED decision; the multi-order
paths (event cancellation, deletion, a night's cancellation) give theirs back in
one batch after their last order, line, ticket and seat write, codes locked
last in ascending id order. Partial refunds and the booking fee refunded by hand
keep the use. Promo codes are unchanged.

### Proved on PostgreSQL

`venue-booking-cancellation-integration.test.js` (C1–C15, with C3c, C7b and C7c
added by the gate and its fixers) races cancel-unpaid against the door, a
night's cancellation, deletion, refunds, transfer acceptance and offers,
checkout, settlement, another cancellation and event cancellation, and proves
no oversell after places return. `referral-returns-integration.test.js` (R1–R13,
with R12b) proves every return happens once and no code is held while waiting
for an order. The lock order they rely on is ADR 0017 §9.

### Not repaired: a payment completed after its event was cancelled

A card order whose settlement starts only after its event's cancellation has
committed ends up PAID on a cancelled event, and nothing asks for its refund
until the event is deleted (`refundWhatIsLeft`) or the finance team refunds it.
It predates this work; its referral use is given back when that refund settles.
The limitations page lists it (`payment-after-cancellation`).
