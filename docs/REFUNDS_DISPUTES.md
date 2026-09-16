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
