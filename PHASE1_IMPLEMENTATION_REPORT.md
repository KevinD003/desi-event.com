# Phase 1 implementation report

**Status: COMPLETE.** Every Phase 1 surface is built, tested and verified
against the original Phase 1 acceptance criteria. Production card payments were
never among them: they are a Phase 2 prerequisite, and their absence is now
enforced rather than assumed — see
[Why this is COMPLETE](#why-this-is-complete).

This file did not exist before the post-`efda577` corrective cycle; it is
written from the repository as it actually stands, not from a plan. It was
re-stated at the final closure cycle, whose evidence is in
`PHASE1_FINAL_CLOSURE_REPORT.md`.

|                            |                                                    |
| -------------------------- | -------------------------------------------------- |
| Head                       | `728ca3a`                                          |
| Branch                     | `claude/desi-event-js-stack-gb4uqe`                |
| Unit and integration tests | 2,160 across 13 workspaces                         |
| End-to-end tests           | 89 against `next dev`, 19 against a compiled build |
| Migrations                 | 4                                                  |
| Verification               | every code-owned command exits 0                   |

## What Desi-Event is

Event discovery and ticketing for the South Asian community: organisers publish
events and ticket tiers, buyers hold inventory during checkout and pay for it,
door staff scan tickets on the night.

## The stack, and the constraint

JavaScript everywhere. No TypeScript: no `.ts`, no `.tsx`, no `tsconfig.json`,
no hand-written declarations, no TypeScript-specific tooling. The full statement
is `docs/language-policy.md`; the reasoning and the cost are in
`docs/adr/0001-javascript-only-stack.md`.

The policy is executable. `scripts/check-language-policy.mjs` asks git what the
repository contains — not the filesystem, which would mean skipping build
directories by name, and skipping by name is exactly what lets committed
TypeScript hide in a directory called `build`. Eleven tests in
`packages/config/tests/language-policy.test.js` plant real violations in the
real repository and confirm the checker catches them, including that case.

| Surface  | Technology                                                       |
| -------- | ---------------------------------------------------------------- |
| API      | Fastify 5 on Node 22, Zod validation, OpenAPI 3.1                |
| Web      | Next.js 16 App Router, React 19, JSX, Tailwind v4, Framer Motion |
| Worker   | BullMQ 6 on Redis                                                |
| Database | PostgreSQL 16 via Prisma 7 with a driver adapter                 |
| Monorepo | pnpm workspaces, Turborepo                                       |
| Tests    | Vitest, React Testing Library, Playwright                        |

Prisma 7 defaults to a TypeScript config file. `packages/db/prisma.config.mjs`
is plain JavaScript and is verified working for generate, migrate and live
queries — the policy holds at the one place it was most likely to break.

## Layout

```
apps/
  api/        Fastify REST API
  web/        Next.js App Router front end
  worker/     BullMQ processors
packages/
  api-contract/  Route descriptors -> OpenAPI document and typed client
  config/        ESLint, Vitest and Tailwind presets; policy-checker tests
  db/            Prisma schema, migrations, seed, client wrapper
  inventory/     Availability, hold lifecycle, hold ownership
  logger/        Pino with redaction
  permissions/   Capability-based RBAC
  pricing/       Integer-cent money, fees, promos, tax policy
  providers/     Payment/email/SMS/storage interfaces and in-memory fakes
  schemas/       Zod contracts
  ui/            Accessible React primitives
```

## What is implemented

**Identity and access.** Registration and login with bcrypt and JWT.
Capability-based RBAC scoped per organisation: a `MANAGER` of one organisation
has no authority over another. Platform `ADMIN` passes everything; `ORGANIZER`
is deliberately empty, because its authority comes from memberships.

**Events and ticketing.** Events, venues, ticket tiers with sales windows,
promo codes. Publication requires `event:publish` and an on-sale tier — and
cannot be reached through `PATCH`, which no longer accepts `status`.

**Checkout.** Holds reserve inventory under a row lock, so two concurrent
buyers cannot exceed the tier. Every hold has exactly one owner — an
authenticated buyer or a hashed guest token — enforced by a database check
constraint, and only that owner (or an audited `hold:release_any` override) can
release or spend it.

Payment is two-phase. The provider is never called while a transaction is open:
a `PENDING` order and payment attempt are committed first, the capture happens
with no locks held, and a short second transaction records the outcome.
Fulfilment is driven by the provider webhook rather than the browser redirect,
and settlement is conditional on the order still being `PENDING`, so two
workers cannot fulfil one payment. `docs/architecture.md` walks the flow.

**Money.** Integer minor units throughout, ceiling matched to the database
column. Discount before fees, fees on the discounted subtotal, then tax.
Allocation across lines is exact at any supported size. Fixed-amount promos are
denominated and never converted.

**Tax.** Resolved by jurisdiction, never by currency. Every shipped rate is
marked `DEMO` and production fails closed unless a deployment opts in
explicitly. Orders record a pricing snapshot so the receipt and any refund
recompute from what the buyer was quoted under.

**Search.** Facets are counted in the database over every published event, so
pagination changes which rows a visitor sees and never which filter options
exist.

**Accessibility.** Reduced motion is honoured in CSS — the only layer that
cannot disagree with the server, which is what the original defect turned on.
Filter changes preserve keyboard focus and announce the new result count
politely rather than moving the visitor. Covered by 89 end-to-end tests,
including a no-JavaScript pass.

**Background work.** BullMQ processors for hold expiry, email, ticket issuance
and search indexing. The expiry sweep reclaims abandoned holds, verified
against live Redis and PostgreSQL.

## What is not implemented

- **Refunds.** The allocation primitive and the pricing snapshot exist; the
  endpoint does not.
- **Real payments.** One in-memory provider, and no way to reach another.
  A Phase 2 prerequisite rather than an unfinished Phase 1 task; the kill
  switch that makes that true is described below.
- **Mobile.** React Native with Expo is Phase 3. `docs/architecture.md`
  describes how it shares `schemas`, `pricing`, `permissions` and
  `api-contract`; nothing is scaffolded.
- **Search indexing.** The queue and processor exist as a documented
  integration point that logs; there is no index behind it.

## Why this is COMPLETE

Phase 1's acceptance criteria are the ones it was scoped against: discovery,
ticketing, holds, checkout against a deterministic provider, door scanning,
and the operational surface around them. All of it is built, tested and
verified. Production card processing was never a Phase 1 criterion, so its
absence is not a Phase 1 failure — provided the absence is real, which is the
part that had to be proved rather than asserted.

It is proved. There is one payment mode, no code in the repository opens a
socket to a payment service provider, no manifest depends on a payment SDK, and
a full checkout under test opens no socket and calls no `fetch`. A deployment
that asks for production payments — through `PAYMENT_PROVIDER`,
`ENABLE_PRODUCTION_PAYMENTS`, eight other variables, or a live-looking
credential anywhere in its environment — is refused at boot by both the API and
the worker rather than quietly downgraded, so nobody can believe they enabled
card payments when they have not. Every artefact the mock produces says `DEMO`:
intents, captures, refunds, order confirmations, ticket emails, the checkout
page and the liveness probe. `PHASE1_FINAL_CLOSURE_REPORT.md` carries the
evidence.

What remains for Phase 2 is listed under
[What is not implemented](#what-is-not-implemented) and, in full, in
`PHASE1_FINAL_CLOSURE_REPORT.md` — production Stripe, signed webhooks, payment
reconciliation operations, real refunds, a real tax determination and real
payouts. None of them is started, and none of them should be described as an
unfinished Phase 1 task.

The corrective cycle that produced this state is documented in
`POST_EFDA577_CORRECTIVE_REPORT.md`; the 34 review findings behind it reconcile
in `docs/ADVERSARIAL_REVIEW_FINDINGS.md`, which also records the two findings
raised after that review closed.

## Running it

```bash
nvm use                 # Node from .nvmrc
pnpm install            # regenerates the Prisma client via postinstall
cp .env.example .env
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Seeded sign-in: any seeded address with `DesiEvent!2026` (development only).
API docs at `/docs`.

```bash
pnpm verify             # policy, secrets, format, lint, tests, build
pnpm test:e2e           # Playwright, against next dev
pnpm test:e2e:prod      # the not-found suite, against a freshly compiled build
pnpm db:verify:fresh    # migrations and seed on a disposable database
```

## Verification at this head

Run in one sweep on Node v22.22.2, pnpm 10.33.0, PostgreSQL 16.13, Redis 7.0.15.
No command was skipped, and none was retried. `test` and `build` were run
with `turbo --force`, so their durations are real executions rather than
cache hits.

| Command                    | Exit | Duration | Result                                       |
| -------------------------- | ---: | -------: | -------------------------------------------- |
| `pnpm run policy:check`    |    0 |     0.4s | 348 files scanned via git, no violations     |
| `pnpm run secrets:scan`    |    0 |     3.0s | 347 tracked files, nothing credential-shaped |
| `pnpm run format:check`    |    0 |     4.5s | all files Prettier-clean                     |
| `pnpm run lint`            |    0 |     4.9s | 0 errors, 0 warnings                         |
| `pnpm run contract:check`  |    0 |     0.9s | 20 routes, 20 operations, 17 paths           |
| `pnpm run test`            |    0 |    39.4s | 2,160 passed, 0 failed, 0 skipped            |
| `pnpm run db:verify:fresh` |    0 |     8.3s | 22/22 checks on a disposable database        |
| `pnpm run build`           |    0 |     5.6s | 3/3 tasks                                    |
| `pnpm audit`               |    0 |     0.7s | no known vulnerabilities                     |
| `pnpm run test:e2e`        |    0 |    60.2s | 89 passed                                    |
| `pnpm run test:e2e:prod`   |    0 |    10.2s | 19 passed against a freshly compiled build   |
