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

| Decision                                                               | Where the reasoning is                   |
| ---------------------------------------------------------------------- | ---------------------------------------- |
| Production payments refuse the boot rather than being disabled         | `packages/providers/src/payment-mode.js` |
| A provider is never called inside a database transaction               | `apps/api/src/lib/checkout.js`           |
| Timeout is its own state, never failure                                | `apps/api/src/lib/reconciliation.js`     |
| Conditional `UPDATE` + affected-row count as the concurrency primitive | `apps/api/src/lib/inventory.js`          |
| An operator never edits a payment or an order                          | `apps/api/src/routes/reconciliation.js`  |
| Money is derived from the ledger, never from order summaries           | `apps/api/src/lib/finance-reporting.js`  |
| Reversal posts compensating entries; it never edits history            | `packages/ledger/src/batches.js`         |
| A route cannot exist without being in the published contract           | `apps/api/src/lib/register.js`           |
| The response schema is an allow list                                   | `apps/api/src/lib/validation.js`         |
| A ticket credential is derived, never stored                           | `apps/api/src/lib/ticket-credentials.js` |
| `CHECKED_IN` is terminal                                               | `apps/api/src/lib/tickets.js`            |
| Step-up windows are server-owned named policies                        | `packages/auth/src/sessions.js`          |
| scrypt rather than bcrypt                                              | `packages/auth/src/password.js`          |
| Spreadsheet-injection escaping never strips a value                    | `apps/api/src/lib/csv.js`                |
| Latency budgets scale with a profile; correctness does not             | `scripts/load/config.js`                 |

Each of those is a module-level comment answering _why_, not a line comment
restating _what_.

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
