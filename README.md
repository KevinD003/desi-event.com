# Desi-Event

Event discovery and ticketing for the South Asian community. Garba nights,
Bollywood concerts, classical dance recitals, comedy tours, film screenings,
food and wedding expos: the kind of event that today lives on a WhatsApp
forward and a Google Form. Desi-Event gives organisers a real ticketing system
and gives attendees one place to find what is on near them.

The platform is three deployable applications — a Fastify REST API, a Next.js
storefront and a BullMQ worker — sitting on thirteen shared packages,
PostgreSQL and Redis, in one pnpm workspace.

## Payments are in mock mode, and production payments are unreachable

Read this before anything else. **No money can move through this repository.**
`PAYMENT_MODE=live`, or a live-looking credential anywhere in the environment,
**refuses the boot** — it is not a disabled feature, it is an unreachable one.
With no credentials at all the in-memory provider runs, and every artefact it
produces carries `demo: true` and says so.

No Stripe API call has ever been made from this code. That status is recorded as
**EXTERNAL VERIFICATION PENDING** wherever it applies, and there is no
fabricated Stripe identifier, receipt or transcript anywhere in the repository.

[docs/PAYMENTS.md](docs/PAYMENTS.md) has the rules and the reasoning.

## JavaScript only

There is no TypeScript in this repository, and adding some will fail CI. No
`.ts`, no `tsconfig.json`, no `.d.ts`, no `@types/*`, no `@typescript-eslint`.
Source files are `.js`, `.mjs`, `.cjs` and `.jsx`, and every package is
`"type": "module"`.

What replaces the compiler is not optimism. Zod schemas validate every value
crossing a trust boundary, JSDoc annotations give editors the shapes, ESLint
catches the mistakes a compiler would, tests carry coverage thresholds on the
pure-logic packages, and the OpenAPI document is generated from the same
schemas the server validates with so the contract cannot drift.

The rule, its reasoning and the process for introducing another language are in
[docs/language-policy.md](docs/language-policy.md). The executable version is
`scripts/check-language-policy.mjs`, which runs as the first step of both
`pnpm verify` and CI.

## Repository layout

```
desi-event.com
├── apps
│   ├── api            Fastify REST API: auth, events, holds, checkout, check-in
│   ├── web            Next.js App Router storefront for attendees
│   └── worker         BullMQ processors: hold sweep, ticket issue, email, search index
├── packages
│   ├── api-contract   Route descriptors, OpenAPI generator and the browser client
│   ├── config         Shared ESLint, Vitest and Tailwind presets
│   ├── db             Prisma schema, migrations, seed data and the shared client
│   ├── auth           Sessions, passwords, TOTP, sealing and step-up policies
│   ├── inventory      Availability maths and the checkout hold lifecycle
│   ├── ledger         Double-entry accounts and the batches each event posts
│   ├── logger         Structured Pino logger
│   ├── notifications  Outbox message kinds and rendering
│   ├── permissions    Roles, capabilities and authorization checks
│   ├── pricing        Integer-cent fees, taxes, promo codes and order totals
│   ├── providers      Payment/email/SMS/storage interfaces with in-memory adapters
│   ├── schemas        Zod schemas: the single source of truth for validation
│   └── ui             Accessible React component primitives (JSX, Tailwind)
├── docs               Architecture, security, payments, operations and policy documents
└── scripts            Repository tooling (policy, secret and bundle scans, load suite)
```

## Tech stack

| Layer                    | Choice                        | Version                     |
| ------------------------ | ----------------------------- | --------------------------- |
| Runtime                  | Node.js                       | 22.22.2 (`.nvmrc`)          |
| Package manager          | pnpm                          | 10.33.0                     |
| Monorepo tasks           | Turborepo                     | 2.10.12                     |
| API framework            | Fastify                       | 5.12.4                      |
| Web framework            | Next.js App Router            | 16.3.5                      |
| UI                       | React                         | 19.3.0                      |
| Styling                  | Tailwind CSS (CSS-first)      | 4.3.3                       |
| Animation                | Framer Motion                 | 13.3.0                      |
| Database                 | PostgreSQL via Prisma         | Prisma 7.10.0               |
| Cache and queues         | Redis via BullMQ              | BullMQ 6.3.6, ioredis 6.0.0 |
| Validation               | Zod                           | 4.6.5                       |
| Logging                  | Pino                          | 10.3.1                      |
| Unit and component tests | Vitest, React Testing Library | Vitest 5.0.0                |
| End-to-end tests         | Playwright                    | 1.63.0                      |
| Linting                  | ESLint (flat config)          | 9.39.5                      |

## Prerequisites

- **Node.js 22.22.2** — the exact version is in `.nvmrc`; `nvm use` picks it up.
  `.npmrc` sets `engine-strict=true`, so an unsupported runtime fails at
  install rather than at runtime.
- **pnpm 10.33.0** — pinned in `packageManager`. `corepack enable` installs it.
- **PostgreSQL 16+** — listening on `127.0.0.1:5432`.
- **Redis 7+** — listening on `127.0.0.1:6379`.

The default connection strings in `.env.example` expect a `desi` role with
password `desi` and a `desi_event` database. Create them once:

```bash
createuser --createdb desi 2>/dev/null || true
psql -c "ALTER ROLE desi WITH PASSWORD 'desi' LOGIN"
createdb -O desi desi_event
createdb -O desi desi_event_test   # used by the integration tests
```

## Quickstart

```bash
git clone <repository-url> desi-event.com
cd desi-event.com

nvm use                    # Node 22.22.2, from .nvmrc
corepack enable            # pnpm 10.33.0, from packageManager
pnpm install

cp .env.example .env
set -a; . ./.env; set +a   # export the variables into this shell — see below

pnpm db:migrate            # create the schema
pnpm db:seed               # 15 users, 2 organisations, 12 events, 12 orders
pnpm dev                   # api, web and worker together
```

That leaves three processes running:

| Process | URL                   | Notes                                         |
| ------- | --------------------- | --------------------------------------------- |
| Web     | http://127.0.0.1:3000 | Next.js dev server                            |
| API     | http://127.0.0.1:4000 | Fastify; `/health`, `/docs`, `/openapi.json`  |
| Worker  | —                     | BullMQ; sweeps expired holds every 30 seconds |

Seeded accounts all share the password `DesiEvent!2026`.

**Why the `set -a` line.** Each application reads `.env` relative to its own
working directory, and pnpm runs every script from the package that owns it. A
`.env` at the repository root is therefore not visible to `apps/api` or to
Prisma in `packages/db` unless it is exported into the shell first. `set -a`
marks subsequent assignments for export, `. ./.env` sources the file, `set +a`
turns the marking off again. [direnv](https://direnv.net) with an `.envrc` of
`dotenv` does the same thing automatically. `pnpm db:seed` is the exception —
it reads the root `.env` itself — but the rest need the export.

## pnpm scripts

Run from the repository root.

| Script                    | What it does                                                                                                      |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `pnpm dev`                | Start api, web and worker in watch mode (`turbo run dev`)                                                         |
| `pnpm build`              | Build every workspace: Prisma client, `openapi.json`, `next build`                                                |
| `pnpm start`              | Run the built applications                                                                                        |
| `pnpm lint`               | ESLint across the whole repository                                                                                |
| `pnpm lint:fix`           | The same, with `--fix`                                                                                            |
| `pnpm format`             | Prettier over js/jsx/json/md/css/yaml                                                                             |
| `pnpm format:check`       | Prettier in check mode                                                                                            |
| `pnpm test`               | Vitest in every workspace                                                                                         |
| `pnpm test:watch`         | Vitest in watch mode                                                                                              |
| `pnpm test:coverage`      | Vitest with coverage and thresholds                                                                               |
| `pnpm test:e2e`           | Playwright end-to-end suite (`@desi-event/web`)                                                                   |
| `pnpm policy:check`       | Enforce the JavaScript-only language policy                                                                       |
| `pnpm secrets:scan`       | Scan every tracked file for credentials                                                                           |
| `pnpm bundle:scan`        | Refuse server contract that leaked into a browser artefact                                                        |
| `pnpm skips:check`        | Fail an undeclared skipped test                                                                                   |
| `pnpm verify:tests:fresh` | Delete every report, run every test task with the cache refused, refuse any report not proved fresh. What CI runs |
| `pnpm contract:check`     | Structurally validate the API contract and OpenAPI document                                                       |
| `pnpm verify`             | `policy:check` → `secrets:scan` → `format:check` → `lint` → `verify:tests:fresh` → `build`. The pre-push gate     |
| `pnpm db:generate`        | `prisma generate`                                                                                                 |
| `pnpm db:migrate`         | `prisma migrate dev` — create and apply a migration                                                               |
| `pnpm db:migrate:deploy`  | `prisma migrate deploy` — apply existing migrations                                                               |
| `pnpm db:reset`           | Drop, recreate, migrate and re-seed the database                                                                  |
| `pnpm db:seed`            | Idempotent development seed                                                                                       |
| `pnpm db:studio`          | Prisma Studio                                                                                                     |
| `pnpm db:verify:fresh`    | Migrate a disposable database and run every concurrency suite                                                     |
| `pnpm db:verify:upgrade`  | Apply migrations onto a populated database                                                                        |
| `pnpm openapi:emit`       | Regenerate `apps/api/openapi.json` from the contract                                                              |
| `pnpm manifest:emit`      | Regenerate the browser route manifest from the contract                                                           |
| `pnpm load`               | The load and reliability suite (see the caveats it carries)                                                       |
| `pnpm clean`              | Remove node_modules, .next, .turbo, dist, coverage and test output                                                |

The end-to-end suites need their own Playwright configurations, because they
need different fixtures and different servers: `pnpm test:e2e`,
`test:e2e:events`, `test:e2e:organizer`, `test:e2e:refusals`,
`test:e2e:sweep` and `test:e2e:prod`.

After changing the API contract, run `pnpm openapi:emit` **and**
`pnpm manifest:emit`; both artefacts are committed and both are drift-checked.

`pnpm clean --dry-run` lists what it would delete without touching anything.

Two caveats worth knowing before you hit them:

`pnpm build` (and therefore `pnpm verify`) fails while `NODE_ENV=development` is
exported, which it is if you sourced `.env`. `next build` refuses a
non-standard `NODE_ENV` and dies prerendering the global error page. Run
`NODE_ENV=production pnpm build`, or `env -u NODE_ENV pnpm build`.

`pnpm format` reads `.prettierrc.json`, which matches the house style. It is in
`pnpm verify` as `format:check`, so formatting is an enforced gate rather than a
suggestion.

To run one workspace on its own, filter it:

```bash
pnpm --filter @desi-event/api dev
pnpm --filter @desi-event/pricing test
```

## API documentation

The API describes itself. With the API running:

- **http://127.0.0.1:4000/docs** — Swagger UI, generated from the route
  contract in `@desi-event/api-contract`.
- **http://127.0.0.1:4000/openapi.json** — the raw OpenAPI 3.1 document.

`pnpm build` also writes the document to `apps/api/openapi.json`, so it is a
build artefact rather than a file someone remembers to regenerate.
[docs/api.md](docs/api.md) covers authentication, the error envelope,
pagination and every endpoint.

## Tests

```bash
pnpm test                                  # every workspace
pnpm test:coverage                         # with thresholds
pnpm --filter @desi-event/pricing test     # one package
pnpm test:e2e                              # Playwright, from apps/web
```

Three layers:

- **Vitest units** in every package, co-located as `src/<name>.test.js`. Pure
  logic packages enforce 80% line and function coverage.
- **React Testing Library** component tests in `@desi-event/ui` and `apps/web`.
- **Playwright** end-to-end specs in `apps/web/e2e`, which start their own
  Next.js server on port 3210.

The suites that need PostgreSQL or Redis — `packages/db/tests/client.test.js`
and `apps/worker/tests/redis-integration.test.js` — probe for the service and
skip themselves when it is not reachable, so `pnpm test` passes on a laptop
with nothing running and still tests the real wiring where it exists.

## Tests, counted separately

Unit and integration tests and browser journeys are **different evidence**, and
this repository never totals them under one label. `pnpm test` reports the
first; the Playwright configurations report the second.

Concurrency is proved rather than asserted: `pnpm db:verify:fresh` migrates a
disposable database and runs every race suite against real PostgreSQL, and CI
runs a reliability smoke test on every push.

A suite that runs nothing fails. `scripts/check-skipped-tests.mjs` refuses an
undeclared skipped test _and_ a report containing zero cases — a test command
that matches no files prints a green summary and exits zero, and a required
check that can pass by running nothing eventually will.

A report that is not this run's fails too. `pnpm verify:tests:fresh` deletes
every Vitest report, runs every test task with Turborepo's cache refused, and
then refuses any report older than the run — by modification time and by the
`startTime` Vitest writes inside it — as well as any package that wrote none,
any failed case, and any skipped, pending or todo case not allow-listed. CI
runs exactly this command, and `pnpm ci:check` refuses a workflow that produces
or judges reports any other way. `pnpm verify` runs it too, in place of a plain
`pnpm test`, so the local gate needs the test database just as CI does.

**The current figures**: **4,642** unit
and integration cases across 173 files, and **242** browser cases across seven
Playwright configurations. They are never added together.

## Documentation

Start with the one that matches what you are doing.

### Where the project stands

| Document                                                                   | Contents                                                         |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [PHASE2_STATUS.md](PHASE2_STATUS.md)                                       | **Authoritative current status**: the twenty gates, in one table |
| [PHASE2_FINAL_CLOSEOUT_REPORT.md](PHASE2_FINAL_CLOSEOUT_REPORT.md)         | The closeout cycle, its verification, and the one thing left     |
| [PHASE2_REQUIREMENTS_TRACEABILITY.md](PHASE2_REQUIREMENTS_TRACEABILITY.md) | Requirement → implementation → evidence, row by row              |

### The system

| Document                                     | Contents                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------ |
| [docs/architecture.md](docs/architecture.md) | Request flow, the checkout and hold lifecycle, package graph, trust boundaries |
| [docs/DATA_MODEL.md](docs/DATA_MODEL.md)     | Where the schema encodes a decision: tenancy, money, seating, retention        |
| [docs/api.md](docs/api.md)                   | REST reference: auth, errors, pagination, every endpoint                       |
| [docs/PROVIDERS.md](docs/PROVIDERS.md)       | The four adapters, mock mode, webhook intake and dispatch                      |
| [docs/DECISIONS.md](docs/DECISIONS.md)       | The authoritative decision index, including decisions that live in code        |
| [docs/adr/](docs/adr/)                       | Architecture decision records                                                  |

### Money

| Document                                                         | Contents                                                                |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------- |
| [docs/PAYMENTS.md](docs/PAYMENTS.md)                             | Why production is unreachable, the PCI boundary, the two-phase boundary |
| [docs/FINANCIAL_LEDGER.md](docs/FINANCIAL_LEDGER.md)             | Chart of accounts, batches, why reversal never edits history            |
| [docs/REFUNDS_DISPUTES.md](docs/REFUNDS_DISPUTES.md)             | Refunds, disputes, transfers, payouts and the races each survives       |
| [docs/STRIPE_CONNECT.md](docs/STRIPE_CONNECT.md)                 | The charge model, and what is not built                                 |
| [docs/RECONCILIATION_RUNBOOK.md](docs/RECONCILIATION_RUNBOOK.md) | Working the queue for money in an unknown state                         |

### Operations and safety

| Document                                                   | Contents                                                              |
| ---------------------------------------------------------- | --------------------------------------------------------------------- |
| [docs/SECURITY.md](docs/SECURITY.md)                       | Auth, MFA, step-up, authorization, audit, rotation, incident response |
| [docs/PHASE2_THREAT_MODEL.md](docs/PHASE2_THREAT_MODEL.md) | Assets, actors, thirteen attacks, and what is out of scope            |
| [docs/CHECK_IN.md](docs/CHECK_IN.md)                       | The door: credentials, idempotence, transfers                         |
| [docs/UX.md](docs/UX.md)                                   | Screens, accessibility sweep, browser journeys counted honestly       |
| [docs/LOAD_AND_CAPACITY.md](docs/LOAD_AND_CAPACITY.md)     | What the load suite measures, and why it is not capacity              |

### Working here

| Document                                               | Contents                                                                            |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| [docs/development.md](docs/development.md)             | Day-to-day workflow: services, env vars, migrations, debugging, testing             |
| [docs/language-policy.md](docs/language-policy.md)     | The JavaScript-only policy and the exception process                                |
| [docs/BRANCH_PROTECTION.md](docs/BRANCH_PROTECTION.md) | What CI enforces, the run that proves it, and the one setting nobody here can apply |
| [CONTRIBUTING.md](CONTRIBUTING.md)                     | Branches, commits, the verify gate, definition of done                              |
