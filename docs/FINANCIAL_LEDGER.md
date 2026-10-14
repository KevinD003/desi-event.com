# The ledger

## Why there is one at all

Because a marketplace holds other people's money, and `Order.totalCents` cannot
tell you how much. That column is written once at checkout and never corrected:
it does not know about a refund, a chargeback, a waived fee or a partial return.
Summing it gives a number that looks like revenue and is not one, and a platform
that pays organisers from it eventually pays somebody money it already gave
back.

So every amount that matters is derived from `LedgerEntry`: double-entry,
append-only, balanced by a database check, and corrected by compensating entries
rather than by editing. A figure from it can be traced to the rows that make it
up, which is the only property that matters when somebody disputes one.

---

## The chart of accounts

Ten accounts. The _kind_ of each is what makes the arithmetic readable —
`ORGANIZER_PAYABLE` is a liability, so a credit increases what is owed.

| Account                | Kind           | What it is                                                   |
| ---------------------- | -------------- | ------------------------------------------------------------ |
| `processor_clearing`   | Asset          | Money the processor holds for us. Ours, not in our bank      |
| `organizer_payable`    | Liability      | What we owe organisers. **Not revenue**                      |
| `platform_fee_revenue` | Revenue        | The Desi Events' fee. The only part of an order that is ours |
| `tax_payable`          | Liability      | Collected for an authority. **Never revenue**                |
| `refund_clearing`      | Liability      | A refund decided but not yet settled                         |
| `dispute_clearing`     | Liability      | Funds held back while a dispute is open                      |
| `transfer_clearing`    | Asset          | A transfer to a connected account, in flight                 |
| `payout_clearing`      | Asset          | A payout to a bank, in flight                                |
| `promotional_discount` | Contra-revenue | Discounts given. Reduces what was earned; costs nothing      |
| `payment_fee_expense`  | Expense        | What the processor charges us                                |

The single most consequential mistake a marketplace ledger can make is treating
the buyer's money as revenue. `organizer_payable` and `tax_payable` are
liabilities for that reason, and nothing posts either to a revenue account.

---

## Batches

An entry never exists alone. A **batch** is a set of entries that balance, and
the database refuses a posted batch whose `debitCents` and `creditCents`
disagree. Both columns are stored so the check is a column comparison rather
than an aggregate at write time.

Every batch carries an `idempotencyKey` derived from what caused it — the order,
the refund, the payout — and that key is unique. A source event that somehow
posted twice posts once, and "organiser payable cannot be reduced twice" is a
unique index rather than code remembering.

### The batches this application posts

| Kind                | When                          | Movement                                                |
| ------------------- | ----------------------------- | ------------------------------------------------------- |
| `ORDER_PAID`        | Checkout settles              | Processor clearing ← buyer; payable, fee, tax split out |
| `REFUND`            | A refund settles              | Payable, fee and tax reversed to refund clearing        |
| `REFUND_SETTLED`    | The same moment               | Refund clearing → processor clearing                    |
| `DISPUTE_OPENED`    | A chargeback arrives          | Payable → dispute clearing                              |
| `DISPUTE_RESOLVED`  | Won or lost                   | Dispute clearing → payable, or out                      |
| `TRANSFER`          | A transfer pays               | Payable → transfer clearing                             |
| `TRANSFER_REVERSAL` | A transfer is clawed back     | Transfer clearing → payable                             |
| `PAYOUT`            | A payout pays                 | Transfer clearing → payout clearing                     |
| `CORRECTION`        | A posted batch must be undone | Every entry of the original, flipped                    |

**Two batches for one refund**, not one. "We owe this back" and "it has gone" are
different facts, and a report that conflates them overstates what has left the
account.

---

## Reversal never edits history

A posted batch cannot be changed — the database refuses it. The only way history
changes is by adding to it: a compensating batch in the opposite direction, so
the record says _the money went and then came back_, which is what happened,
rather than _it never went_.

That matters for a payout in particular. An organiser who was paid and then had
it clawed back has a right to see both events; a ledger that quietly removed the
first would be a ledger that lied to them.

---

## What an organiser may actually be paid

Not `organizer_payable`. That figure is what is owed, and some of it is already
spoken for:

```
available = payable
          − transfers and payouts in flight
          − refunds promised to buyers  (Order.refundPendingCents)
          − every open dispute's amount
```

Each subtraction has a failure it prevents:

- **In flight.** A batch posts when the money actually moves, so until then the
  payable still shows money a payout has already claimed. Two payouts could
  otherwise each take it.
- **Refund liability.** Money a buyer has been promised must not reach the
  organiser first.
- **Dispute liability.** A dispute is somebody claiming the money was never the
  organiser's to take. Paying it out while that is unresolved is how a
  marketplace ends up chasing an organiser for funds it already sent.

A negative available balance is never paid, and neither is an amount above it —
both are `HELD` with the reason stored, because an organiser is entitled to see
that a payout was considered and why it did not go.

The derivation is `availableBalance` in `apps/api/src/lib/payouts.js`, and it
is read **inside the transaction that creates a payout**, so a second request
racing the first sees the first in flight and is stopped by the ceiling rather
than by luck.

---

## The integrity check

`findImbalances` in `apps/api/src/lib/finance-reporting.js` looks for three
things that should be impossible:

- a posted batch with **no entries**;
- a batch whose **entries do not balance** each other;
- a batch whose entries **disagree with its own stored columns**.

The first would mean entries were lost; the second that the CHECK constraint was
bypassed; the third that entries were written outside the batch that owns them.

It appears **above** the totals on the finance screen and above them in the API
payload, because a batch that does not add up is a reason to stop reading the
totals rather than a footnote to them. The scan is bounded and reports its
bound, so "no imbalances" never quietly means "we stopped looking".

The analytics screen shows the same result the same way, because it calls the
same function. Two derivations of "what is this organisation owed" would
eventually disagree, and the disagreement would surface as a support ticket
rather than as a test failure.

The load suite checks the same property after every scenario, against the
database rather than the application.

---

## Currency

Every amount is an integer in the currency's minor unit. There is no floating
point anywhere in the money path, and no implicit conversion: a batch has one
currency and entries in another currency belong to a different batch.

---

## Where to look

| Question                           | File                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------- |
| What are the accounts?             | `packages/ledger/src/accounts.js`                                         |
| What does each event post?         | `packages/ledger/src/batches.js`                                          |
| How is a batch written?            | `apps/api/src/lib/ledger.js`                                              |
| What is an organiser owed?         | `apps/api/src/lib/payouts.js`                                             |
| What does the finance screen show? | `apps/api/src/lib/finance-reporting.js`                                   |
| What does analytics add to it?     | `apps/api/src/lib/analytics.js` — counts, never a second money derivation |

## Booking fees, referral codes and paying at the venue — 2026-10-09

ADRs 0016 and 0017. The chart of accounts is unchanged; what changed is which
entries some orders post.

- **Fee-only `ORDER_PAID` batches.** A pay-at-the-venue order's online part is
  its booking fee (and any tax on it, none in this build), so its batch is
  `processor_clearing` DEBIT F against `platform_fee_revenue` CREDIT F (and
  `tax_payable` for tax). It posts **no organiser entry** — the organiser has no
  share of money that passed through the platform — and no contra-revenue for a
  promo, because a promo lowered the door price, which is not platform money. A
  zero online total (the fee waived, or an event whose own fee is nothing)
  posts no batch, as a free order never did. `orderPaidBatch` skips the
  organiser entry when its share is 0; the balance check is unchanged.
- **Waivers are not posted.** The ledger records money that moved: `feesCents`
  is what was charged. What referral codes waived is reported from
  `Order.feeWaivedCents` on the referral-code pages, labelled as not from the
  ledger. No account was added.
- **Money paid at the door is never posted.** It is recorded in `VenuePayment`
  and reported on the organiser's "Payments at the venue" page, labelled as held
  by the organiser; it is not owed to an organiser, not platform revenue, and
  never refunded by the platform. A memorandum account for it was rejected: the
  money never passes through the platform, and an account holding it would
  invite someone to pay it out (ADR 0017 §8).
- **`heldFrom`.** `disputeOpenedBatch` and `disputeResolvedBatch` take
  `heldFrom`, `organizer_payable` (as before) or `platform_fee_revenue` only. A
  dispute on a pay-at-the-venue order's payment — which is all booking fee — is
  taken from platform revenue, not from an organiser who never received it.
- **Refunds of these orders** reverse fee and tax only (`organizerShareCents`
  0, no discount reversal); the booking fee refunded by hand reverses the fee
  and the tax on it from a card or a pay-at-the-venue order alike.
- **Nothing is posted when unpaid tickets are cancelled** or when a referral use
  is given back. A kept booking fee stays where `orderPaidBatch` put it, in
  `platform_fee_revenue`; no organiser figure moves, and `findImbalances` stays
  empty (proved in C11).
- **What an organiser may be paid** is unchanged by these orders: they post no
  organiser share, and the refund and dispute liabilities held back from an
  organiser's balance count card orders only.
