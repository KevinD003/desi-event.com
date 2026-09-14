# Phase 1 implementation report

**Status: PARTIAL.** Every Phase 1 surface is built, tested and verified.
Production payments remain prohibited, which is the single reason this is not
COMPLETE. See [Why PARTIAL](#why-partial).

This file did not exist before the corrective cycle; it is written here from
the repository as it actually stands, not from a plan.

|                            |                                     |
| -------------------------- | ----------------------------------- |
| Head                       | `5fedb03`                           |
| Branch                     | `claude/desi-event-js-stack-gb4uqe` |
| Unit and integration tests | 2,029 across 13 workspaces          |
| End-to-end tests           | 89                                  |
| Migrations                 | 4                                   |
| Verification               | every code-owned command exits 0    |

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
- **Real payments.** Mock provider only. See below.
- **Mobile.** React Native with Expo is Phase 3. `docs/architecture.md`
  describes how it shares `schemas`, `pricing`, `permissions` and
  `api-contract`; nothing is scaffolded.
- **Search indexing.** The queue and processor exist as a documented
  integration point that logs; there is no index behind it.

## Why PARTIAL

Production payments are prohibited, and three things must land first:

1. Provider signature verification on `POST /v1/payments/webhook`. It accepts
   unsigned callbacks — correct for a deterministic mock, unacceptable for
   anything real.
2. An operator surface or job for `TIMEOUT` payments flagged
   `reconciliationRequired`. The state is recorded; nothing consumes it.
3. The refund path.

Everything else in Phase 1 is complete and verified. The corrective cycle that
produced this state is documented in `POST_EFDA577_CORRECTIVE_REPORT.md`, and
the 34 review findings behind it reconcile in
`docs/ADVERSARIAL_REVIEW_FINDINGS.md`.

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
pnpm test:e2e           # Playwright
```

## Verification at this head

| Command                   | Exit | Result                   |
| ------------------------- | ---: | ------------------------ |
| `pnpm run policy:check`   |    0 | 327 files, no violations |
| `pnpm run secrets:scan`   |    0 | 326 files, clean         |
| `pnpm run format:check`   |    0 | All formatted            |
| `pnpm run lint`           |    0 | 0 errors, 0 warnings     |
| `pnpm run contract:check` |    0 | 20 routes                |
| `pnpm run test`           |    0 | 2,029 tests, 14/14 tasks |
| `pnpm run build`          |    0 | 3/3 tasks                |
| `pnpm audit`              |    0 | No known vulnerabilities |
| `pnpm db:seed` ×2         |    0 | Idempotent               |
| `npx playwright test`     |    0 | 89 passed                |
