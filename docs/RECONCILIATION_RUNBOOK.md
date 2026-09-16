# Reconciliation runbook

This is the queue for the cases where nobody knows what happened. It is written
as a runbook because the person working it is usually working it at a bad
moment, and a design document is not what they need then.

---

## The one rule

**An operator never edits a payment or an order.** There is no route that takes
a status. There is no handler that writes one from a request body. What an
operator can do is ask the provider again and then tell the system to apply
whatever the provider said.

The reason is arithmetic rather than policy. An operator who could set
`status = 'PAID'` would be able to mint tickets, post a ledger batch and create a
payable — for money nobody was ever charged. Establishing the fact and letting
the system draw the consequence keeps every invariant that the ordinary path
keeps, because it is the ordinary path: `applyVerdict` calls `settleCheckout`,
`compensateCheckout`, `settleRefund` and `recordRefundFailure`, the same
functions checkout and the webhook handler call, each conditional on the state
it expects.

---

## What lands here

| Kind                | What happened                                                         |
| ------------------- | --------------------------------------------------------------------- |
| `PAYMENT_TIMEOUT`   | The provider did not answer a capture. The order is still `PENDING`   |
| `REFUND_UNKNOWN`    | The provider did not answer a refund. The reservation is still held   |
| `PROVIDER_MISMATCH` | A webhook contradicts the stored payment, or names one we do not have |

Nothing else opens a task, and a task is never opened as a way of flagging
something for attention: the queue is for money in an unknown state, and
diluting it with advisories is how a queue stops being read.

---

## Working an item

1. **Claim it.** `POST /v1/operations/reconciliation/:id/claim` moves `OPEN` to
   `IN_PROGRESS` under a conditional `UPDATE`. If somebody else got there first
   you are told so rather than both doing the work.
2. **Re-query.** `POST /v1/operations/reconciliation/:id/requery` asks the provider, with
   no database transaction open, and returns a **verdict** with a sentence
   saying why. It writes nothing except the attempt.
3. **Resolve.** `POST /v1/operations/reconciliation/:id/resolve` applies the verdict and
   closes the item — but only a resolution the verdict supports (below).
4. Or **escalate.** `POST /v1/operations/reconciliation/:id/escalate` says you cannot
   decide this alone. The item stays open work; the reason is recorded so the
   next person does not start from nothing.
5. **Note** anything worth the next reader's time. Notes append — a JSON array
   added to, never replaced — because a note that can be edited is not a record.

Claiming, re-querying, resolving, escalating and noting each require
`reconciliation:manage`, MFA, and a step-up inside five minutes
(`FINANCE_ACTION`). Reading needs `FINANCE_VIEW`. Each action writes an audit
row naming the actor, the previous state and what the provider said.

---

## The five verdicts

`compareEvidence` is pure, and exhaustively tested, because what a verdict _is_
should be readable without a database.

| Verdict        | Meaning                                  | What resolving it does            |
| -------------- | ---------------------------------------- | --------------------------------- |
| `SETTLE`       | The money moved                          | Completes what was left half-done |
| `RELEASE`      | It did not move                          | Releases the reservation          |
| `ALREADY_DONE` | Something else already finished it       | Nothing. Closes the item          |
| `CONFLICT`     | The provider and local evidence disagree | **Nothing. Cannot be resolved**   |
| `UNKNOWN`      | The provider could not say               | **Nothing. Cannot be resolved**   |

`RESOLUTIONS_FOR_VERDICT` maps each verdict to the resolutions it permits, and
`CONFLICT` and `UNKNOWN` map to the empty list. An operator marking an item
"settled from the provider" when the provider said nothing of the sort is
precisely the failure this queue exists to prevent, so it is refused at the
route rather than found in a report six months later.

### Amount before status

`compareEvidence` checks the amount and currency **before** it looks at the
status. A provider answer for the right reference but the wrong amount is not a
reason to settle an order — it is the strongest available evidence that the
reference is wrong, and settling on it would charge a buyer for somebody else's
order. That case is `CONFLICT`, always.

### Unknown is never failure

A provider that says "I do not recognise that intent" has not said the charge
failed. It may be a lookup against the wrong account, a reference recorded
wrongly, or an object that has not propagated. `REQUIRES_CAPTURE` — authorised,
not captured — is the same: neither a charge nor a failure. Both are `UNKNOWN`,
and `UNKNOWN` resolves nothing.

This is the single most consequential line in the module. Reading silence as
failure cancels orders people paid for.

---

## Who may do what

| Caller                             | Sees                      | May act |
| ---------------------------------- | ------------------------- | ------- |
| `finance:view` in an organisation  | That organisation's items | No      |
| `reconciliation:manage` (platform) | Everything                | Yes     |

The actions are platform-only. Applying a verdict completes an order, posts a
ledger batch and mints tickets; an organiser resolving their own organisation's
ambiguous charges is a conflict of interest whatever their capability says.

A task carries an organisation when the code that opened it knew one. When it
does not — a webhook for an intent with no local payment — only the platform can
read it, because there is nobody else it could belong to.

---

## Ageing

Three bands, not a number: `FRESH`, `AGING` at 24 hours, `OVERDUE` at 72. The
queue already shows the age; what a band adds is agreement about when something
is late. The operations screen shows the band as a **word as well as a colour**,
so it survives being read by somebody who cannot distinguish the colours.

Ordering is unresolved first, then oldest — the opposite of the notification
queue, deliberately. Money that has been in an unknown state longest is the most
urgent item, not the stalest one.

---

## When it will not resolve

**`CONFLICT` on a `PAYMENT_TIMEOUT`.** The provider reports a refunded charge
against an order that was never completed. Escalate; this needs somebody with
access to the provider dashboard to establish what object the reference actually
points at.

**`UNKNOWN` that will not clear on retry.** Note the attempts and escalate.
Retrying an unexplained answer until it changes is the habit this repository
refuses everywhere else and refuses here too.

**Resolve returns 409.** Somebody resolved it while you were working. Re-read
the item; the audit row says who and what they applied.

**Resolve returns 422 naming the verdict.** You asked for a resolution the
provider's answer does not support. Re-query and act on what comes back.

---

## Mock mode

In mock mode the provider being re-queried is the in-memory one, and every
receipt it returns carries `demo: true`. The queue, the verdicts, the
resolution-matching and the audit trail are all real code exercised by real
tests — what is simulated is the provider's answer, not the decision made on it.

**Real Stripe re-query is EXTERNAL VERIFICATION PENDING.** No reconciliation in
this repository has ever queried Stripe.

---

## Where to look

| Question                       | File                                    |
| ------------------------------ | --------------------------------------- |
| What does a verdict mean?      | `apps/api/src/lib/reconciliation.js`    |
| Which resolution may I record? | `apps/api/src/routes/reconciliation.js` |
| What opened this task?         | `apps/api/src/lib/webhook-handlers.js`  |
| What did the operator do?      | The `AuditLog` rows for the task's id   |
