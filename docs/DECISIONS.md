# Decisions

The authoritative index of architectural decisions. An ADR in `docs/adr/` is the
record; this page says which ones exist, what each settled, and where the
decisions that never warranted an ADR are written down instead.

**An ADR is amended only by a superseding ADR.** None here has been rewritten,
and none will be: a decision record that can be edited is a decision record that
cannot be trusted about what was known at the time.

---

## The architecture decision records

| #                                               | Decision                                       | Status                                          |
| ----------------------------------------------- | ---------------------------------------------- | ----------------------------------------------- |
| [0001](adr/0001-javascript-only-stack.md)       | JavaScript everywhere, TypeScript nowhere      | Accepted, 2026-09-14                            |
| [0002](adr/0002-polyglot-exception-process.md)  | When another language may enter the repository | Accepted, 2026-09-14                            |
| [0003](adr/0003-stripe-connect-charge-model.md) | Stripe Connect charge model                    | Accepted for Phase 2 (sandbox only), 2026-09-15 |
| [0004](adr/0004-plpgsql-in-migrations.md)       | Procedural SQL inside migrations               | Accepted, 2026-09-15                            |

Nothing is superseded. Nothing is deprecated.

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
hold against code not yet written. 20 triggers today. The ADR bounds where it
may live and why a JavaScript-only stack still needs it.

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
