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

## Current-status update — 2026-09-17

The table and the paragraph above understate the gap in four places. Each is
corrected here rather than edited above, and the direction of every error is the
same: the document is **more** optimistic than the code.

**No `ConnectedAccount` row reaches the database at all — not even by seeding.**
There is no `create`, `upsert`, `createMany` or raw `INSERT` for that model
anywhere in the repository. `packages/db/scripts/seed.mjs` upserts fourteen
models and `connectedAccount` is not among them; none of the four end-to-end
seeds touch it either. The only writers are two `updateMany` calls in
`apps/api/src/lib/webhook-handlers.js`, and `updateMany` cannot create a row.
The payout path's destination lookup is therefore permanently null in practice.

**Transfers and disputes are not "mock mode" — they are unreachable in any
mode.** Nothing creates a `Transfer` row at runtime (`transfer.create` appears
only in a database constraint probe). `settleTransfer`, `reverseTransfer`,
`openDispute` and `resolveDispute` in `apps/api/src/lib/payouts.js` are imported
by exactly one file, their own unit test, whose header says plainly that no route
calls them; `transfer.created` and the `charge.dispute.*` events are not
dispatched anywhere in `apps/api/src`. **Payouts are the exception** and are
genuinely reachable: `payouts.schedule`, `payouts.send` and `payouts.reverse` are
real routes against the in-memory provider.

**The webhook handling row says `Implemented` without a caveat, and should not.**
The route exists and verifies signatures, but no handler runs in a deployment:
dispatch happens only when `processInline` is true, which defaults to false and
is set only by tests, and the out-of-band consumer does not exist. The Connect
endpoint additionally refuses every delivery with a 400 unless the mode is
`STRIPE_TEST` with a Connect signing secret, which is not part of the required
credential set. No real Stripe webhook delivery has ever been verified.

**The `account.application.deauthorized` behaviour described below is very
likely inert.** That branch matches on `object.id ?? row.accountContext`, but for
this event Stripe's `data.object` is the Application — its id is a `ca_…`, not
the connected account — so `object.id` is truthy, the fallback never fires, and
the `updateMany` matches nothing. Unlike the `account.updated` path it returns
`processed` without checking the affected count, so the delivery is recorded as
handled while nothing changed. It has no test coverage. **This is a code
observation recorded here, not a fix**; nothing in this update changes behaviour.

### The verification boundary, stated plainly

Because the rows above say `Implemented` in several places, this is spelled out
rather than left to inference:

- **Stripe credentials have never been supplied to this project.** No
  `sk_test_`, `pk_test_`, `whsec_` or live credential has been provided, and none
  is present in anything this repository commits.
- **No real Stripe or Stripe Connect API operation has ever been run** from this
  code, in live mode or test mode. The sole `import('stripe')` sits in
  `packages/providers/src/stripe.js` and is reached by no call site outside that
  adapter's own tests, which inject a hand-written double.
- **Payment mode is `MOCK`**, and production payment processing is **disabled**
  by a boot-time kill switch that runs before the HTTP server is constructed.
- **Real Stripe and real Stripe Connect remain `EXTERNAL VERIFICATION
PENDING`.**
- **An adapter method, a schema model, a state machine and a mocked flow are not
  operational Connect onboarding.** Everything on this page was written and
  tested against this project's own contracts, never against Stripe.
- **The repository owner intends to provide Stripe access only at the final
  external-verification stage**, after the mock-mode implementation, security,
  testing, documentation and operational-readiness work is otherwise complete.
- **This update claims no behaviour and no external verification.** It is a
  documentation correction and nothing was executed to produce it.

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

---

## Mock-mode Connect foundation — design, 2026-09-21

The design for the repository-owned half of the closure plan above: items 2 and
3, built in **mock mode only**. Recorded before implementation, and critiqued
adversarially before any code was written.

Nothing in this section describes a Stripe integration. It describes a
simulation this repository runs against itself, and the whole point of writing
it down first is that a simulation which _looks_ like onboarding is the easiest
thing in this project to mistake for the real thing.

### What exists already, and what does not

Established by reading the code rather than this document, because four of this
document's own claims were found stale while doing so (corrected below).

| Piece                                                                | State                                                                                                                                                                                                                        |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ConnectedAccount` model, constraints, relations                     | Exists. `organizationId` is `@unique`                                                                                                                                                                                        |
| `ConnectOnboardingStatus` enum, five members                         | Exists. **Written by nothing**                                                                                                                                                                                               |
| `connect:manage` capability                                          | Exists. Held by `FINANCE`, and by `ADMIN` and `OWNER` through inheritance; `SUPER_ADMIN` platform-wide. **Used by nothing**                                                                                                  |
| A `CONNECT_ONBOARDING` step-up policy                                | **Does not exist.** `CONNECT_ONBOARDING` is an `AuthTokenPurpose` lifetime (`packages/auth/src/tokens.js:44`), not a step-up policy. The policy for this surface is `PAYOUT`, 5 minutes (`packages/auth/src/sessions.js:87`) |
| Adapter methods (`createConnectedAccount`, `getConnectedAccount`, …) | Exist on the Stripe adapter only                                                                                                                                                                                             |
| The in-memory provider's Connect surface                             | **Does not exist**                                                                                                                                                                                                           |
| Any writer that can create a `ConnectedAccount` row                  | **Does not exist**                                                                                                                                                                                                           |
| `connect.start` / `connect.status` routes                            | **Do not exist**                                                                                                                                                                                                             |
| Any organiser Connect screen                                         | **Does not exist**                                                                                                                                                                                                           |

The last four are what this work adds. The first four are why it is mostly
wiring.

### The one blocking defect, and why it is repaired here

`desi_payout_currency_matches` reads `"payoutCurrency"` from `ConnectedAccount`.
That column does not exist; the column is `defaultCurrency`. PL/pgSQL plans
function bodies lazily, so the migration applied cleanly and the trigger has
never executed.

It has never executed because its first statement returns early when
`connectedAccountId` is null — and no payout has ever carried one, because
nothing could create a `ConnectedAccount` row. **This phase is precisely what
makes that path reachable.** Verified by execution against PostgreSQL 16: an
INSERT on `Payout` with a non-null `connectedAccountId` fails with SQLSTATE
42703, `column "payoutCurrency" does not exist`, from the function's line 9.

The repair is a new forward migration replacing the function body, one
identifier. The early return is preserved, the invariant is preserved, and the
trigger is not broadened.

Two adjacent facts recorded rather than fixed, because fixing them would be the
financial-policy redesign this work is not:

- The same migration's comment says the rule covers "a transfer or payout", but
  `CREATE TRIGGER` attaches to `"Payout"` only. **Transfers have no currency
  check at all.** Owner decision.
- The trigger compares currencies with `<>` and does not case-fold. The writer
  added here normalises to upper case, matching the Stripe adapter's existing
  precedent, so the comparison is safe from _this_ writer. A future writer that
  stores `inr` would trip it. Owner decision.

### The lifecycle, and why it reuses the existing vocabulary

`ConnectOnboardingStatus` is already a closed, server-authoritative, indexed
Prisma enum. Minting a parallel `MOCK_*` vocabulary would cost a migration, a
second enum for readers to learn, and a parity test — to express the same five
states.

So the states are the existing five. What makes them unmistakably a simulation
is carried in three other places, none of which is the state name:

1. `ConnectedAccount.providerMode` is written `'mock'`. The row itself records
   that it is not a real account.
2. The API response carries a server-authoritative `simulated: true` the UI is
   required to render. It is not derived in the browser.
3. The screen never prints the raw enum. It prints mock-qualified wording, and a
   standing block saying what the state does **not** mean.

All four actions arrive on `connect.start`, which is the **one** state-changing
route this phase adds; `connect.status` is a read and changes nothing. `action`
is a closed enum validated in the contract, and it is the only field either body
carries. The destination state is never in the request: the server reads the
current row, looks the pair up in the table below, and refuses anything absent
from it.

That is a weaker claim than "never a state supplied in a request body", and the
weaker claim is the true one. The vocabulary maps one-to-one onto destination
states, so a body saying `SIMULATE_READY` is a body asking for `COMPLETE` — the
one state that sets `chargesEnabled` and `payoutsEnabled` true. What actually
holds the line is that the _legality_ of the move is decided server-side from
the row, not the spelling of the field. The forbidden-body-field list in
"Scoping" bans `state`; it deliberately does not ban `action`, and this is why.

The transitions, every pair applied as a compare-and-set against the state it
was validated against:

| From               | Action                  | To                 |
| ------------------ | ----------------------- | ------------------ |
| `NOT_STARTED`      | `START`                 | `IN_PROGRESS`      |
| `IN_PROGRESS`      | `SIMULATE_REQUIREMENTS` | `REQUIREMENTS_DUE` |
| `IN_PROGRESS`      | `SIMULATE_READY`        | `COMPLETE`         |
| `REQUIREMENTS_DUE` | `SIMULATE_READY`        | `COMPLETE`         |
| `COMPLETE`         | `SIMULATE_DISABLE`      | `DISABLED`         |
| `REQUIREMENTS_DUE` | `SIMULATE_DISABLE`      | `DISABLED`         |
| `IN_PROGRESS`      | `SIMULATE_DISABLE`      | `DISABLED`         |

Every other pair is invalid and refused with a closed reason code. In
particular `DISABLED` is terminal in this phase: re-onboarding a disabled
account is a real-provider concern, and inventing a mock path for it would be
inventing policy.

**A table of legal pairs is not a state machine unless every write is
conditional on the state it was read against.** Under a read-then-update
handler — the shape an implementer writes when nothing says otherwise — two
individually legal actions compose into a pair that is not in the table. Run
concurrently against one `IN_PROGRESS` row, `SIMULATE_DISABLE` and
`SIMULATE_READY` land on `COMPLETE` with both flags true: the account passed
through `DISABLED` and came back out, which is `DISABLED` → `COMPLETE`, unlisted,
and the end of the terminality asserted a paragraph above.

So every transition is written as
`updateMany({ where: { id, onboardingStatus: <from> }, data: { onboardingStatus: <to>, ...derived } })`
with `count === 1` as the success test and a 409 otherwise. The repository
already has this shape — `apps/api/src/lib/payouts.js:155-167` `transition()` —
but its `where` hardcodes `status`, so this surface takes a small column
parameter on that helper rather than growing a second copy of it.

`START` is the exception, and it is create-only rather than an upsert. An upsert
looked right — one account per organisation, keyed on `organizationId @unique` —
but its update branch is unconditional, so a replayed `START` against a
`COMPLETE` row rewrites it to `IN_PROGRESS` while leaving `chargesEnabled` and
`payoutsEnabled` true: an unlisted transition _and_ a row whose flags contradict
its own state, which is the one thing the derivation rule below exists to
prevent. It ends `DISABLED`'s terminality by the same route. Putting the state
in the upsert's `where` does not rescue it — Prisma then leaves the native
upsert path, attempts a create, and raises P2002. `START` therefore creates,
catches P2002, re-reads and returns the existing row **unchanged**.

`chargesEnabled` and `payoutsEnabled` are derived from the state, never set
independently — `COMPLETE` implies both true, every other state implies both
false. A mock that could report "payouts enabled" in any state but `COMPLETE`
would be the exact false claim this design exists to prevent.

### Scoping, authorization and step-up

- One `ConnectedAccount` per organisation, enforced by `organizationId @unique`
  at the database. The writer is an upsert keyed on it.
- Reads and writes are organisation-scoped from the path, resolved server-side.
  The organisation in the path is **refused with 403** whether it belongs to
  another tenant or does not exist at all — identical status, code and message
  template either way, so the refusal is not an existence oracle. That is the
  repository's rule for a path organisation (`apps/api/tests/privacy.test.js:120-137`)
  and it is **not** the rule for an identifier nested underneath one. Should a
  nested id ever be added here, it follows `apps/api/src/routes/privacy.js:166-168`
  instead and answers a **404 indistinguishable from a nonexistent id**, because
  "not yours" and "not there" must not be tellable apart below the tenant
  boundary. `ConnectedAccount` is keyed on `organizationId` alone, so this
  surface has no nested subject today; the distinction is written down because
  it is the one an implementer would otherwise generalise wrongly.
- Neither request body carries an `organizationId`, `actorId`, `state`,
  `capability`, `stepUp` or `idempotencyKey` field. The guard reads
  `params.organizationId` and the upsert reads that same value — a guard on the
  path and a writer on the body would be a cross-tenant write, which is why the
  two must be the one field. `payouts.schedule` scopes on `body.organizationId`
  and is the counter-precedent that makes saying so necessary. The invariant at
  `apps/api/tests/security-regression.test.js:239` that forbids those fields is
  filtered to the `privacy` tag, so this change widens the filter to cover the
  connect surface rather than leaving the rule merely asserted here.
- Both routes carry the **`finance`** tag. That is load-bearing, not cosmetic:
  `MONEY_TAGS` at `apps/api/tests/security-regression.test.js:56` is
  `{analytics, finance, refunds}`, and every route carrying one must declare a
  step-up. Tagging them `finance` puts both under that invariant automatically.
  A new `connect` tag would have placed a money-adjacent surface outside it
  without anyone deciding that, and was rejected for exactly that reason.
- The screen picks its organisation the way every comparable screen does:
  `connectOrganizations(session)` in `apps/web/src/lib/session.js`, filtered on
  `connect:manage`, then
  `organizations.find((o) => o.organizationId === params.organizationId) ?? organizations[0]`
  — the shape used at `apps/web/src/app/privacy/page.jsx:70` and three siblings.
  The API's 403 is the control; the intersection is what stops the screen from
  provoking one. The new web API module applies `encodeURIComponent` to the
  organisation id before putting it in a path, as `apps/web/src/lib/organizer-api.js:84`
  does. `apps/web/src/lib/privacy-api.js` interpolates unencoded at `:77`, `:88`,
  `:110`, `:133` and `:194`; the value it passes is server-resolved from session
  memberships rather than caller-supplied, so it is not reachable today, but the
  new module does not copy the pattern. Fixing the privacy module is a change to
  a surface this phase was not asked to touch and is noted, not made.
- The mock mints a `providerAccountId` unique per organisation and prefixed so
  it **cannot be mistaken for a Stripe account id** — not `acct_`. These are the
  first `ConnectedAccount` rows this repository has ever held, and the Connect
  webhook handler at `apps/api/src/lib/webhook-handlers.js:330` matches on
  `providerAccountId` alone, with no provider, mode or organisation in the
  `where`. That unscoped match is inert today (`apps/api/src/routes/webhooks.js:93`
  refuses every Connect delivery outside `STRIPE_TEST`) and is recorded here as
  a known gap for whoever adds real webhooks, not repaired in this phase.
- Both routes require `connect:manage`, organisation-scoped from the path.
- `connect.start` requires a fresh **`PAYOUT`** step-up (5 minutes,
  `packages/auth/src/sessions.js:87`); `connect.status` requires a fresh
  **`FINANCE_VIEW`** one (15 minutes, `:83`). Both are gated — leaving the read
  ungated would make it the only money-adjacent read in the repository without a
  step-up — but they are gated at the tier the repository already uses for each
  kind of call. Every finance read carries `FINANCE_VIEW` (eight routes,
  `packages/api-contract/src/routes.js:1823` and on); every finance action
  carries `PAYOUT` (`:2091`, `:2136`, `:2160`). An earlier draft put `PAYOUT` on
  both, which would have made a five-minute window the gate on simply opening
  the page.
- Both routes declare `API_ERRORS.stepUpRequired`, so the screen's
  retry-after-step-up path is discoverable from the contract rather than by
  trial. The contract checker does not require this of a step-up route, so it
  has to be done deliberately.

**Correction, made during design critique.** An earlier draft of this section
proposed a `CONNECT_ONBOARDING` step-up instead, on the reasoning that it "has
its own 10-minute window and is named for this surface". That reasoning was
wrong, and the fact it rested on was false. `CONNECT_ONBOARDING` is an
`AuthTokenPurpose` lifetime (`packages/auth/src/tokens.js:44`) — the expiry of a
single-use `AuthToken` — and not a step-up policy at all. `STEP_UP_POLICIES`
(`packages/auth/src/sessions.js:81-146`) contains ten members and that is not one
of them, so `stepUpWindowFor('CONNECT_ONBOARDING')` throws and, because
`apps/api/src/lib/register.js:75` resolves the window at registration rather than
per request, the API would have failed to boot. `PAYOUT` is not merely the
fallback: its docstring reads "A payout, **or a change to a connected account's
payout destination**", which is this surface exactly, and it is what closure
item 2, `docs/PHASE3_IMPLEMENTATION_PLAN.md:191-193`, `PHASE2_STATUS.md:1146` and
`docs/PHASE3_PHASE1_IMPLEMENTATION_REPORT.md:945` have each already said.

Two consequences worth stating, because both cut against the earlier draft:
the approved window is _shorter_ (5 minutes, not 10) on the surface that decides
where an organiser's money lands, and the read is gated too. Putting
`connect.status` behind capability alone would have made it the only
money-adjacent read in the repository with no step-up — every one of the ten
finance-tagged routes carries one.

Adding a `CONNECT_ONBOARDING` member to `STEP_UP_POLICIES` was considered and
rejected. It is a change to a shared security table outside this phase's scope,
and it would put one string on two unrelated controls — the precise collision
`packages/auth/src/sessions.test.js:343-348` records for `PRIVACY_ERASURE`
against `CREDENTIAL`.

### Idempotency and concurrency

`START` on an account already past `NOT_STARTED` returns the current state and
records nothing new — the same answer a first call would give, so a replay is
indistinguishable from a repeat. The upsert on a unique organisation id makes
two concurrent first-starts collapse to one row at the database rather than in
application logic.

### Audit evidence

Closed action and reason vocabularies. A row carries the actor in `actorId`,
the account in `entityType`/`entityId`, and the organisation, from-state,
to-state and action in `metadata`. The organisation goes in `metadata` because
`AuditLog` has **no `organizationId` column** (`packages/db/prisma/schema.prisma:809-822`:
id, actorId, action, entityType, entityId, metadata, createdAt) and the only
migration this scope authorises is the trigger repair. That is also what the
existing finance writer does — `apps/api/src/routes/finance.js:337-344` puts
`organizationId` in `metadata`. No schema change is required, and an earlier
draft of this section that said rows "carry the organisation" without saying
where would have invited one.

Rows carry **no** request body, no free text, no provider payload, no financial
figure and no identity field — there are none to carry, because none is
collected.

### The screen

The design critique found this section missing entirely, which meant an
implementer had nothing to build against and a reviewer nothing to review
against. It is specified here.

**Route and files.** `apps/web/src/app/finance/connect/page.jsx`, a
`dynamic = 'force-dynamic'` server component, plus a client component beside it
for the actions. It sits under `/finance` because `connect:manage` travels with
the finance roles and the nav grouping already exists.

**Degrading, not recovering.** The `h1` renders **outside** the `try`, and the
gated read sits inside it, so a stale step-up produces a page with its heading,
its description and a refusal in the body — never a thrown page. That is exactly
what `apps/web/src/app/finance/page.jsx:88-98` does, which is why `/finance` is
already in the accessibility sweep and passes: `page.goto('/finance')` always
finds `heading "Finance" level 1` whether or not the window is fresh. The same
shape makes a Connect case safe anywhere in the sweep file, at any runner speed,
with no step-up machinery in the spec and no dependence on case ordering.
Recovery on the _action_ is `StepUpPrompt` plus `router.refresh()`, the pair
already used at `apps/web/src/components/reconciliation-actions.jsx:242` and
`apps/web/src/app/privacy/request-actions.jsx:150`.

**There is no link to send anybody to.** In mock mode the screen's only outbound
action is a POST to `connect.start`. `What would close the pending items` item 2
describes a screen that "sends somebody to the hosted onboarding link"; that
describes the real-provider phase, not this one, and the non-goals below forbid
it outright. Nothing on this screen navigates off-site.

**Structure.** One `h1`, "Payout onboarding". Sections below it as `h2` with
`aria-labelledby`, matching the finance screens. The five
`ConnectOnboardingStatus` values each render as a named state with
mock-qualified wording, never the raw enum, and every state carries the standing
block saying what it does **not** mean.

**Actions.** Each is a button, never a link, because each is a POST. A
state-changing action is confirmed before it fires, and `SIMULATE_DISABLE` is
confirmed with its own wording because it is terminal. On completion focus
returns to the control that opened the confirmation, as the privacy screens do.
Errors land in a `role="alert"` region; state changes are announced in a polite
live region.

**Reach.** axe clean at the sweep's viewports, no sideways overflow at 320px, no
loss of function at 200% zoom, every control reachable and operable by keyboard
with a visible focus ring, and no motion that ignores `prefers-reduced-motion`.
The case lives in `apps/web/e2e/accessibility-sweep.spec.js` itself, because
`playwright.sweep.config.js` pins `testMatch` to that one file.

### Data minimisation

The screen has **no inputs**. No bank details, tax identifiers, government IDs,
dates of birth, addresses, legal names, payout instructions or documents are
collected, stored, rendered or logged, because a mock that collected them would
have acquired the exact risk it exists to avoid carrying.

`requirementsDue` stores **counts**, never contents — matching the only existing
writer. This document said so already; `schema.prisma`'s own comment said the
opposite ("stored verbatim") and is corrected in this change, because an
implementer reading the schema would otherwise store requirement strings.

### What must not move

- `providers.payments.name` stays `'in-memory-payments'`. `finance.js:176`,
  `finance.js:178` and `analytics.js:269` sniff that exact string to decide the
  payment mode, and `money-figure.jsx:41` turns the result into wording shown to
  **buyers**: renaming the provider would relabel every money figure in the
  product from "Demonstration data" to "Sandbox data". The Connect surface is
  added as methods on the existing provider object, not as a new provider.
- No Stripe SDK import, no Stripe URL, no network call, no credential read.
- Nothing here creates, schedules, executes, reverses or reconciles a movement
  of money.
- Payout semantics are **not** unchanged, and an earlier draft claiming they
  were was wrong. `apps/api/src/routes/finance.js:277-287` already looks up the
  organisation's connected account and stamps `connectedAccountId` onto every
  payout it schedules. There are no `ConnectedAccount` rows in this repository
  today, so that lookup has always returned null and the currency trigger has
  always taken its early return. This phase mints the first such rows, so from
  here on a payout for an onboarded organisation carries an account id and is
  subject to the trigger this change just repaired.

  That is why the mock writer leaves `defaultCurrency` **NULL**. It is the
  migration's own documented "declares no currency, so there is nothing to
  compare against" path, already covered by the new suite. Storing a fabricated
  currency instead would arm the repaired trigger against real payout rows: the
  seed ships a CAD organisation (`packages/db/scripts/seed.mjs:395`) beside INR
  ones, a PL/pgSQL `RAISE` is not a Prisma `P2002` and is not caught anywhere in
  the payout path, so a mismatch would surface as a bare 500. Adding a mapped
  422 in `payouts.schedule` would also work and was rejected: it changes real
  payout behaviour to accommodate a mock, which is the wrong direction.

### Non-goals

No onboarding URL, redirect handler, return handler, hosted link, login link,
account lookup, provider webhook trigger, background reconciler or provider
synchronisation. No re-onboarding from `DISABLED`. No transfer currency check.
No change to payout behaviour when an account is absent.

### Owner decisions this does not take

Real Stripe credentials and account setup; jurisdictions; Connect account type;
organiser eligibility; payout countries and currencies; KYC/KYB; tax reporting;
sanctions and AML; dispute and refund obligations; privacy and retention
implications of connected-account data; webhook, incident and reconciliation
ownership; legal review and launch criteria. Plus the two trigger-adjacent
decisions recorded above, and one more that the design critique surfaced:

**The `FINANCE_ADMIN` platform role can move payouts it cannot see the account
for.** `FINANCE_ADMIN` holds `payout:manage` (`packages/permissions/src/capabilities.js:537`)
but not `connect:manage` (`:533-542`), while `payouts.schedule` authorizes on
`payout:manage` scoped to the body's organisation, which a platform grant
satisfies for any organisation. So a platform finance administrator can
schedule, send and reverse an organisation's payouts while being refused the
connected-account state those payouts depend on. This is pre-existing and is
left exactly as it is: granting `connect:manage` to `FINANCE_ADMIN` widens a
platform authority, which is a separate, named change with its own review and
not a side effect of a mock-mode phase. Recorded here so the asymmetry is a
decision somebody took rather than one nobody noticed.
