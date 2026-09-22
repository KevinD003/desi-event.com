# Providers

Everything outside this application reaches it through one of four adapters.
Nothing else in the codebase imports a vendor SDK.

---

## The registry

```js
createProviderRegistry({ payments, email, sms, storage })
```

One frozen object carrying all four. Routes and worker jobs take the registry
rather than importing a provider, which is what lets a test swap the whole
outside world in a line.

Construction **validates every slot**. A half-configured deployment fails at
boot with a message naming the missing adapter, rather than at 2am on the first
refund. `INCOMPLETE_REGISTRY` lists every absent kind at once; `INVALID_PROVIDER`
names a slot that is filled but does not satisfy its interface.

### The contracts

| Kind       | Methods                                          |
| ---------- | ------------------------------------------------ |
| `payments` | `createIntent`, `capture`, `refund`, `getStatus` |
| `email`    | `send`                                           |
| `sms`      | `send`                                           |
| `storage`  | `put`, `getUrl`, `delete`                        |

The payment interface is the **minimum** every payment adapter must satisfy. The
in-memory provider additionally offers `createTransfer`, `reverseTransfer`,
`createPayout` and `getMovement`; the Stripe adapter offers
`createConnectedAccount`, `createOnboardingLink`, `getConnectedAccount` and
`reverseTransfer`. Callers check for a capability rather than assuming it,
because an interface that demanded every method would refuse an adapter that is
perfectly usable for checkout.

---

## Default: everything in memory

A fresh clone works. `pnpm install && pnpm run dev` gives you a working
catalogue, checkout, refund, transfer, payout, email and SMS without a single
credential, because every default adapter is in-process.

That is a deliberate property, not a convenience. A project whose test suite
needs somebody's sandbox account is a project whose test suite stops working
when that account expires, and a demo that needs live credentials is a demo
nobody can safely run.

### Everything it produces says what it is

`mode: 'MOCK'`, `demo: true`, and a notice: _"DEMO — no money moved, no card was
charged, and this is not a valid receipt."_ On intents, captures, refund
receipts, transfers and payouts alike — the refund receipt especially, since it
is the artefact somebody is most likely to be shown as proof that money came
back.

### Deterministic, not random

Failures are triggered **by amount**, so a test asks for the failure it wants:

| Lever                        | Produces                              |
| ---------------------------- | ------------------------------------- |
| `declineAmountCents`         | A refused capture                     |
| `timeoutAmountCents`         | A capture nobody knows the outcome of |
| `refundDeclineAmountCents`   | A refused refund                      |
| `refundTimeoutAmountCents`   | A refund nobody knows the outcome of  |
| `transferFailAmountCents`    | A failed transfer                     |
| `transferTimeoutAmountCents` | A transfer in an unknown state        |
| `payoutFailAmountCents`      | A failed payout                       |
| `payoutTimeoutAmountCents`   | A payout in an unknown state          |

Per-operation on purpose: a test that wants a refused refund should not have to
arrange a refused capture first.

Idempotency keys are honoured — a retried request returns the first result
rather than producing a second movement — because that is the property the
application depends on and an untested dependency is a guess.

`createInMemoryEmailProvider` and `createInMemorySmsProvider` expose a bounce
address and a failing number for the same reason.

---

## The Stripe adapter

`packages/providers/src/stripe.js`, and **it is the only file in the repository
that imports the Stripe SDK**. A test asserts the list has exactly one entry.

A second import site would be a second place where the amount, the idempotency
key and the API version get decided, and those three are exactly what must never
be decided twice.

**Both versions are pinned in code** rather than left to a default: the API
version in `packages/schemas/src/payments.js`, the SDK in
`packages/providers/package.json`. Both are recorded on every `WebhookEvent`
row, because a webhook payload is only interpretable against the version that
produced it.

### Test mode, or nothing

The adapter can only be constructed in `stripe_test`. `PAYMENT_MODE=live`, a
live-looking key anywhere in the environment, or a mixed credential set refuses
the boot — see `docs/PAYMENTS.md`. There is no configuration that produces a
live client, and no hidden path that would.

### EXTERNAL VERIFICATION PENDING

**No Stripe API call has ever been made from this code.** The adapter is written
and unit-tested against its own contract; it has not been run against Stripe's
sandbox, because no credentials are available to this project.

There is no fabricated Stripe object identifier in this repository, no invented
webhook payload, no screenshot and no CLI transcript. What would close it: a
Stripe test-mode account, `sk_test_`/`pk_test_` keys and a `whsec_` secret in an
environment somebody controls.

---

## Webhooks

Two stages, separated because they fail differently.

**Intake** (`webhook-intake.js`) verifies the signature **over the exact bytes
received** — before parsing, because a signature over a re-serialised body is a
signature over something else — and stores the delivery. Storage is idempotent
on the provider's event id, enforced by a unique index rather than by a
check-then-create. That distinction was worth nine 500s per ten-second window
under duplicate delivery until it was fixed.

**Dispatch** (`webhook-handlers.js`) acts on a stored delivery. It **returns**
for every expected outcome so the dispatcher can record the right state, and
throws only for the unexpected — a database failure, a bug — which is what
schedules a retry.

### An unhandled type is recorded, never dropped

An event with no handler returns `ignored` **with a reason**. A type nobody
handles today is evidence when somebody asks why something did not happen; an
event silently discarded, or falsely marked processed, is the absence of that
evidence.

Handled today: `payment_intent.*`, `account.updated`,
`account.application.deauthorized`. Refund, dispute, transfer and payout events
are recorded as ignored with a reason — their domain modules exist but are not
reachable from the dispatcher in this build, and saying so is more useful than
implying coverage.

### The one place a payload is trusted

`account.updated` is applied from the event's own contents rather than a fresh
read. Justified narrowly: the payload is signed, and carrying the new state is
the entire purpose of that event type. Even then only **counts** of outstanding
requirements are stored, never their contents — which identity documents Stripe
is waiting for is Stripe's hosted page to say, not a row here.

---

## Email, SMS and storage

In-memory adapters only, and no production adapter is written for any of the
three. Notifications go through `NotificationOutbox` — claimed under a lease,
retried with a recorded time, categorised on failure — so the delivery guarantee
is **at-least-once with a durable record**, not "we called an API and hoped".

A dead-lettered message can be requeued or cancelled through the operations
API (`notifications.retry`, `notifications.cancel`), both under a step-up,
because requeuing a cancellation notice sends real mail to real people and
cancelling one means somebody is never told something they were promised.
Neither touches a message a worker holds: retry refuses any `CLAIMED` row, and
cancel refuses one whose lease is live. The conditions are in the `UPDATE`
itself, so a worker's claim that lands first wins. See
`apps/api/src/lib/notification-operations.js`.

> **Correction — 2026-09-22.** This paragraph said "from the operations
> board". The board at `/operations` performs no actions; the two operations
> exist only as API routes. And until the Phase 4 work, retry accepted a
> `CLAIMED` row with a live lease, wiping it and letting a second worker send
> the same message.

Storage is in-memory, so uploaded media does not survive a restart. Stated
because a demo that loses an image is confusing if you expected otherwise.

---

## Where to look

| Question                                   | File                                     |
| ------------------------------------------ | ---------------------------------------- |
| What must an adapter implement?            | `packages/providers/src/interfaces.js`   |
| How is the registry validated?             | `packages/providers/src/registry.js`     |
| What does the mock do?                     | `packages/providers/src/payments.js`     |
| Which mode will this environment start in? | `packages/providers/src/payment-mode.js` |
| How is a delivery verified?                | `apps/api/src/lib/webhook-intake.js`     |
| What acts on a delivery?                   | `apps/api/src/lib/webhook-handlers.js`   |
