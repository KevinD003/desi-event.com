# Decisions

The authoritative index of architectural decisions. An ADR in `docs/adr/` is the
record; this page says which ones exist, what each settled, and where the
decisions that never warranted an ADR are written down instead.

**An ADR is amended only by a superseding ADR.** None here has been rewritten,
and none will be: a decision record that can be edited is a decision record that
cannot be trusted about what was known at the time. The one line that changes
when a record is superseded is its **Status**, which names the record that
replaced it; everything under that line stays as written.

---

## The architecture decision records

| #                                                          | Decision                                                            | Status                                          |
| ---------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------- |
| [0001](adr/0001-javascript-only-stack.md)                  | JavaScript everywhere, TypeScript nowhere                           | Accepted, 2026-09-14                            |
| [0002](adr/0002-polyglot-exception-process.md)             | When another language may enter the repository                      | Accepted, 2026-09-14                            |
| [0003](adr/0003-stripe-connect-charge-model.md)            | Stripe Connect charge model                                         | Accepted for Phase 2 (sandbox only), 2026-09-15 |
| [0004](adr/0004-plpgsql-in-migrations.md)                  | Procedural SQL inside migrations                                    | Accepted, 2026-09-15                            |
| [0005](adr/0005-reserved-seat-transfer.md)                 | Reserved-seat transfer stays blocked                                | Superseded by 0006, 2026-09-29                  |
| [0006](adr/0006-reserved-seat-transfer-live-seat-index.md) | One live ticket per seat: reserved-seat tickets can be handed on    | Accepted, 2026-09-29                            |
| [0007](adr/0007-platform-door-authority.md)                | A platform super administrator may admit at any event               | Accepted, 2026-09-29                            |
| [0008](adr/0008-show-once-codes.md)                        | Invitation and transfer codes are shown once to whoever issues them | Accepted, 2026-09-29                            |
| [0009](adr/0009-media-in-postgres-allow-list-sanitiser.md) | Event pictures: bytes in PostgreSQL, rebuilt from an allow-list     | Accepted, 2026-09-29                            |

One record is superseded: 0005, by 0006. Nothing is deprecated.

### 0001 — JavaScript everywhere, TypeScript nowhere

The stack constraint. JavaScript with JSDoc, ESM only, no `.ts`, `.tsx`,
`.d.ts` or `tsconfig.json` anywhere. Enforced by `pnpm run policy:check` rather
than by agreement, because a constraint nobody checks is a preference.

Types are expressed as JSDoc and checked where it pays — the contract, the
schemas — without the build step and the second language a TypeScript
compilation would add.

### 0002 — When another language may enter the repository

The exception process for 0001. A second language needs a recorded reason, a
bounded location and a named owner; `docs/language-policy.md` and
`docs/language-exceptions.json` are the machine-readable half, and the policy
check reads them.

Two exceptions exist and are both in that file: SQL in migrations (see 0004) and
the shell in CI configuration.

### 0003 — Stripe Connect charge model

Destination charges with `on_behalf_of` and an application fee. Direct charges
and separate charges-and-transfers were both considered and both rejected, for
reasons the ADR states in full. It also states, explicitly, what the decision
does **not** make Desi-Event: not merchant of record, not an escrow provider,
not a tax remitter, not the legal seller.

Follow-through in code: `docs/STRIPE_CONNECT.md`.

### 0004 — Procedural SQL inside migrations

plpgsql exists in this repository, in migrations only, for invariants that must
hold against code not yet written. The migrations create 29 triggers as of
2026-09-29, five of them added by the feature-completion work; this line said
20 when it was written. The ADR bounds where
it may live and why a JavaScript-only stack still needs it.

### 0005 — Reserved-seat transfer stays blocked (superseded)

A full unique index on `Ticket.eventSeatId` made accepting a seated transfer
a 500. The record chose to refuse a seated transfer at both ends and to say so on
the ticket screen, and recorded "one live ticket per seat" as the right end
state, safe only together with a refund-path lock and an analytics change it was
not authorised to make. Kept as the record of that reasoning; 0006 carries it
out.

### 0006 — One live ticket per seat

`Ticket_eventSeatId_live_key`, a partial unique index over `VALID`,
`TRANSFER_PENDING` and `CHECKED_IN`, replaces the full index. A handed-on or
refunded row keeps its seat as history. Acceptance and refund both lock the
order line `FOR UPDATE`, so a refund can never return the money and leave a live
successor admitting, and analytics counts a handed-on ticket once. A reserved
seat now goes with its ticket.

### 0007 — A platform super administrator may admit at any event

`SUPER_ADMIN` admits on a third authority, `PLATFORM_ROLE`, after any membership
it holds. Every platform lookup and admission writes an audit row on the event,
the role is re-read inside the admitting transaction, and a module-load
assertion keeps every other platform role away from the door. Reverses the
earlier "platform roles admit nobody".

### 0008 — Show-once codes

With no delivery provider (`DELIVERY_MODE=MANUAL`, this build), a team
invitation's or a ticket offer's single-use code is returned once, `no-store`,
to whoever issued it, who hands it over themselves. Only its digest is stored;
it is never logged, audited or put in a URL. Naming `EMAIL` with no provider
refuses to boot. Reverses "the token is delivered out of band and never appears
in a response".

### 0009 — Event pictures in PostgreSQL, rebuilt from an allow-list

Picture bytes live in `MediaBlob`, committed in the same transaction as the row
that names them, behind a `MediaStorage` interface. Each upload is sniffed from
its bytes, rebuilt from an allow-list of its format's structures without
decoding pixels, and reviewed by a moderator before it is public. No antivirus
engine runs, and the record and the limitations page both say so.

---

## Decisions that live in code, not in an ADR

Not everything deserves an ADR. These are settled decisions whose reasoning is
written at the point it matters, where somebody changing the behaviour will
actually read it:

| Decision                                                                 | Where the reasoning is                                |
| ------------------------------------------------------------------------ | ----------------------------------------------------- |
| Production payments refuse the boot rather than being disabled           | `packages/providers/src/payment-mode.js`              |
| A provider is never called inside a database transaction                 | `apps/api/src/lib/checkout.js`                        |
| Timeout is its own state, never failure                                  | `apps/api/src/lib/reconciliation.js`                  |
| Conditional `UPDATE` + affected-row count as the concurrency primitive   | `apps/api/src/lib/inventory.js`                       |
| An operator never edits a payment or an order                            | `apps/api/src/routes/reconciliation.js`               |
| Money is derived from the ledger, never from order summaries             | `apps/api/src/lib/finance-reporting.js`               |
| Reversal posts compensating entries; it never edits history              | `packages/ledger/src/batches.js`                      |
| A route cannot exist without being in the published contract             | `apps/api/src/lib/register.js`                        |
| The response schema is an allow list                                     | `apps/api/src/lib/validation.js`                      |
| A ticket credential is derived, never stored                             | `apps/api/src/lib/ticket-credentials.js`              |
| `CHECKED_IN` is terminal                                                 | `apps/api/src/lib/tickets.js`                         |
| Step-up windows are server-owned named policies                          | `packages/auth/src/sessions.js`                       |
| scrypt rather than bcrypt                                                | `packages/auth/src/password.js`                       |
| Spreadsheet-injection escaping never strips a value                      | `apps/api/src/lib/csv.js`                             |
| Latency budgets scale with a profile; correctness does not               | `scripts/load/config.js`                              |
| A step-up gate refuses a request; a step-up _branch_ withholds a figure  | `apps/api/src/routes/analytics.js`                    |
| Reconciliation evidence is projected onto a reviewed key list            | `apps/api/src/lib/presenters.js`                      |
| A metric this system does not record is named, never estimated           | `apps/api/src/lib/analytics.js`                       |
| An invitation secret is pasted, never carried in a URL                   | `apps/web/src/components/ticket-transfer-actions.jsx` |
| A refusal says the same words whether the thing exists or not            | `apps/web/src/components/page-state.jsx`              |
| The API holds no queue client, so no browser can start a retention sweep | `apps/api/src/routes/retention.js`                    |
| A retention sweep has no lease, and the columns stay unwritten           | `apps/worker/src/retention/run-key.js`                |
| An export's subject link is policed by a source scan, not by a comment   | `apps/api/tests/export-register.test.js`              |
| A sweep row's identity is derived, so a redelivery writes nothing new    | `apps/worker/src/retention/run-key.js`                |
| A failed rehearsal records a row per class and does not abort the run    | `apps/worker/src/processors/sweep-retention.js`       |

Each of those is a module-level comment answering _why_, not a line comment
restating _what_.

### Two of those, in one line each

**No queue client in the API.** Adding one to gain a "run it now" button would
mean the one surface reachable from a browser had acquired the ability to start
a job whose durations nobody has approved. Initiation stays where it cannot be
reached over HTTP. This is the settled form of what the Phase 3–3 report calls
"owner decision 14"; that report references the decision in §6B but never tabled
it in §6A, so this row is where it lives.

**No lease on a retention sweep.** `RetentionSweep.leaseOwner` and
`leaseExpiresAt` are modelled on `PrivacyRequest`, where a lease protects a
mutating, resumable operation on a row that already exists. The rehearsal counts
and then inserts a row that is already finished, so there is no window for a
second worker to steal — and a lease would not cover what actually duplicates
rows, which is a retry, a restart or a stalled-job redelivery. A deterministic
primary key does. The columns stay because dropping them costs a migration and
takes a constraint and an index with it for no gain.

---

## Decisions taken and then reversed

Recorded because a reversal is the most useful kind of decision to have written
down:

**The `force` flag on check-in.** A request field that would let a scanner
override an admission refusal. Removed: a door device is the least trustworthy
caller in the system, and "let this one in anyway" is an authorization decision
that cannot be delegated to whoever is holding the phone. The test asserting the
old shape was rewritten to assert the new contract, with the reason in it.

**Reserved-seat transfer stays blocked** (ADR 0005). Reversed by ADR 0006 once
the refund-path lock and the analytics change it depended on were in scope. The
block was the right call while the index alone would have traded a loud 500 for
a quiet double admission.

**Platform roles admit nobody.** Reversed for `SUPER_ADMIN` alone by ADR 0007:
it already held every organisation capability everywhere, so refusing it at the
door was ceremony. Every other platform role is still refused, and the refusal
is still audited.

**Invitation and transfer codes never appear in a response.** Reversed by
ADR 0008. The rule assumed a delivery provider this build never had, so every team
invitation and every ticket offer minted a code nobody could receive.

**Storing full Stripe requirement lists.** Reduced to counts. The application
needs to know whether an organiser can be paid; what Stripe is waiting for is
Stripe's page to show.

**Check-then-create webhook idempotency.** Replaced with a unique index and a
caught constraint violation. The comment above the old code claimed replay was
"safe rather than merely unlikely", and it was not — nine 500s per ten-second
window under duplicate delivery, found by the load suite.

**A route-level step-up on the analytics routes.** It was the obvious reading of
"financial reads need a recent second factor", and it refused every VIEWER and
door steward — roles this system does not compel to enrol one — from reading an
attendance figure, in order to protect a ledger total they were never going to
be sent. Reversed to a branch-level check from the same server-held table: the
money is withheld, the page is not. The reversal is worth recording because the
original was not careless; it was a control applied one level too coarse.

**Falling back to your own organisation when the URL named another.** The first
draft of the analytics screen substituted `organizations[0]` for an
`organizationId` the caller could not view. No data leaked — the server scoped
to the membership actually held — but the address said one organisation and the
page showed another's figures with nothing saying so, and on a money screen that
is how somebody bookmarks, shares or screenshots a number attributed to the
wrong organisation. Reversed to a refusal in the same words the screen uses for
an identifier nobody has ever had.

---

## Where the constraints themselves are written

| Constraint                                | Enforced by                                                   |
| ----------------------------------------- | ------------------------------------------------------------- |
| No TypeScript                             | `pnpm run policy:check`                                       |
| No secrets in tracked files               | `pnpm run secrets:scan`                                       |
| No server contract in the browser bundle  | `scripts/scan-browser-bundle.mjs`                             |
| The OpenAPI artefact matches the contract | `pnpm run openapi:emit` + a drift check                       |
| Skipped tests fail CI unless allow-listed | `.github/workflows/ci.yml`                                    |
| Correctness under contention              | `pnpm run db:verify:fresh`, and the CI reliability smoke test |

## Decisions taken for the simulated connected-account surface — 2026-09-22

| Decision                                           | Instead of                                             | Why                                                                                                                                                                                              |
| -------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Reuse `ConnectOnboardingStatus`                    | A parallel `MOCK_*` vocabulary                         | A second set would need a migration to store and a mapping back to read: two vocabularies for one column. What marks a row simulated is `providerMode` and a server-set `simulated` on the wire. |
| `FINANCE_VIEW` on the read, `PAYOUT` on the action | `PAYOUT` on both, or a new `CONNECT_ONBOARDING` policy | The tiers the finance surface already uses. `CONNECT_ONBOARDING` is an `AuthTokenPurpose` lifetime, not a step-up policy, and the API would not have booted with it declared.                    |
| Create-only `START`                                | An upsert keyed on the unique organisation             | An upsert's update branch is unconditional, so a replay against `COMPLETE` rewrites it to `IN_PROGRESS` with the capability flags left true.                                                     |
| Compare-and-set on every advance                   | Read-then-write                                        | Two individually legal actions otherwise compose into a pair the table does not contain: the account passes through `DISABLED` and back out.                                                     |
| `defaultCurrency` NULL on a simulated row          | A plausible currency                                   | `payouts.schedule` attaches whatever account it finds to every payout, and the repaired trigger compares currencies. A fabricated value would refuse real payouts as a bare 500.                 |
| `finance` tag on both routes                       | A new `connect` tag                                    | `MONEY_TAGS` drives the invariant that every money route declares a step-up; a new tag would put a money-adjacent surface outside it silently.                                                   |
| Widen the body-field invariant by route id         | By tag                                                 | Widening to `finance` or `MONEY_TAGS` trips on `payouts.schedule`, whose body legitimately carries `organizationId` and `idempotencyKey`.                                                        |
| Import `@desi-event/schemas/connect`               | The barrel                                             | The barrel re-exports `entities.js`, `requests.js` and `responses.js`; a client component importing it ships every model's column names to the browser.                                          |

### Deferred to the owner, not taken

| Question                                                              | Why it is not ours                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Should payout scheduling filter on connected-account lifecycle state? | `payouts.schedule` attaches any account it finds, with no filter on `payoutsEnabled`, `chargesEnabled` or `providerMode`, so a simulated account is a payout destination in every state including disabled. Filtering changes real payout behaviour. |
| Should `paymentsOverride` re-apply the boot gate?                     | `app.js:87` replaces the gate's result wholesale and the comment above it claims the opposite. Not reachable in any deployment, but payment mode is a protected boundary.                                                                            |

## Decisions taken for checkout: nights, seats and promo codes — 2026-09-29

| Decision                                                                                                                     | Instead of                                                                               | Why                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One pricing function for the quote and the charge (`priceCheckout`)                                                          | A preview priced in the browser, or a second server path                                 | Two paths drift, and the buyer is charged by the one they were not shown. The quote is the same function read-only; the order recomputes it under lock and refuses with `PRICE_CHANGED` when it moved.                                                                                                                                                                                                                           |
| A promo code applies to every event of its organiser, or to one event                                                        | A per-tier or per-night scope                                                            | Nothing asked for it, and each extra scope is another reason a code silently gives nothing. The quote says why a code took nothing, so a narrower scope can be added when an organiser needs one.                                                                                                                                                                                                                                |
| The door admits by night: a ticket for one night on that night only, a ticket good for every night once on each (2026-09-30) | Nights as labels only, each ticket admitted once on whichever night it was first scanned | The site sells a tier with no night as "Every night", and admitting it once made that untrue; a Night 1 ticket let in on Night 2 took a place sold for Night 2. The door names the night it is admitting to, as it names the event, rather than guessing it from the clock, so a late-running night is not a false refusal; every admission records its night. A night's own capacity and sales window are enforced at checkout. |
| Seats are sold under the reserved tier that prices their zone                                                                | A tier chosen by the buyer, or stamped on each seat by hand                              | The partial unique index `TicketType_reserved_session_zone_key` allows one reserved tier per zone per night, so "which tier sells this seat" has one answer; a companion seat is sold under its own zone's tier.                                                                                                                                                                                                                 |
| A hidden tier answers 404 to anybody without `ticketType:manage`                                                             | Trusting that its id is not known                                                        | An id in a link, a log or a screenshot is known. The organiser's team can still book it, which is what hidden tiers are for.                                                                                                                                                                                                                                                                                                     |
| The joining link is for ticket holders only                                                                                  | Publishing it on the event page                                                          | It was in every anonymous `events.get` response and in the page's structured data. A holder receives it only while a ticket they hold admits, by the door's own rule.                                                                                                                                                                                                                                                            |
