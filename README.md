# Desi-Event

Event discovery and ticketing for the South Asian community. Garba nights,
Bollywood concerts, classical dance recitals, comedy tours, film screenings,
food and wedding expos: the kind of event that today lives on a WhatsApp
forward and a Google Form. Desi-Event gives organisers a real ticketing system
and gives attendees one place to find what is on near them.

The platform is three deployable applications — a Fastify REST API, a Next.js
storefront and a BullMQ worker — sitting on ten shared packages, PostgreSQL and
Redis, in one pnpm workspace.

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
│   ├── inventory      Availability maths and the checkout hold lifecycle
│   ├── logger         Structured Pino logger
│   ├── permissions    Roles, capabilities and authorization checks
│   ├── pricing        Integer-cent fees, taxes, promo codes and order totals
│   ├── providers      Payment/email/SMS/storage interfaces with in-memory adapters
│   ├── schemas        Zod schemas: the single source of truth for validation
│   └── ui             Accessible React component primitives (JSX, Tailwind)
├── docs               Architecture, development, API and policy documents
└── scripts            Repository tooling (language policy check, clean)
```

## Tech stack

| Layer | Choice | Version |
| --- | --- | --- |
| Runtime | Node.js | 22.22.2 (`.nvmrc`) |
| Package manager | pnpm | 10.33.0 |
| Monorepo tasks | Turborepo | 2.10.12 |
| API framework | Fastify | 5.12.4 |
| Web framework | Next.js App Router | 16.3.5 |
| UI | React | 19.3.0 |
| Styling | Tailwind CSS (CSS-first) | 4.3.3 |
| Animation | Framer Motion | 13.3.0 |
| Database | PostgreSQL via Prisma | Prisma 7.10.0 |
| Cache and queues | Redis via BullMQ | BullMQ 6.3.6, ioredis 6.0.0 |
| Validation | Zod | 4.6.5 |
| Logging | Pino | 10.3.1 |
| Unit and component tests | Vitest, React Testing Library | Vitest 5.0.0 |
| End-to-end tests | Playwright | 1.63.0 |
| Linting | ESLint (flat config) | 9.39.5 |

## Prerequisites

* **Node.js 22.22.2** — the exact version is in `.nvmrc`; `nvm use` picks it up.
  `.npmrc` sets `engine-strict=true`, so an unsupported runtime fails at
  install rather than at runtime.
* **pnpm 10.33.0** — pinned in `packageManager`. `corepack enable` installs it.
* **PostgreSQL 16+** — listening on `127.0.0.1:5432`.
* **Redis 7+** — listening on `127.0.0.1:6379`.

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

| Process | URL | Notes |
| --- | --- | --- |
| Web | http://127.0.0.1:3000 | Next.js dev server |
| API | http://127.0.0.1:4000 | Fastify; `/health`, `/docs`, `/openapi.json` |
| Worker | — | BullMQ; sweeps expired holds every 30 seconds |

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

| Script | What it does |
| --- | --- |
| `pnpm dev` | Start api, web and worker in watch mode (`turbo run dev`) |
| `pnpm build` | Build every workspace: Prisma client, `openapi.json`, `next build` |
| `pnpm start` | Run the built applications |
| `pnpm lint` | ESLint across the whole repository |
| `pnpm lint:fix` | The same, with `--fix` |
| `pnpm format` | Prettier over js/jsx/json/md/css/yaml |
| `pnpm format:check` | Prettier in check mode |
| `pnpm test` | Vitest in every workspace |
| `pnpm test:watch` | Vitest in watch mode |
| `pnpm test:coverage` | Vitest with coverage and thresholds |
| `pnpm test:e2e` | Playwright end-to-end suite (`@desi-event/web`) |
| `pnpm policy:check` | Enforce the JavaScript-only language policy |
| `pnpm contract:check` | Structurally validate the API contract and OpenAPI document |
| `pnpm verify` | `policy:check` → `lint` → `test` → `build`. The pre-push gate |
| `pnpm db:generate` | `prisma generate` |
| `pnpm db:migrate` | `prisma migrate dev` — create and apply a migration |
| `pnpm db:migrate:deploy` | `prisma migrate deploy` — apply existing migrations |
| `pnpm db:reset` | Drop, recreate, migrate and re-seed the database |
| `pnpm db:seed` | Idempotent development seed |
| `pnpm db:studio` | Prisma Studio |
| `pnpm openapi:emit` | Regenerate `apps/api/openapi.json` from the contract |
| `pnpm clean` | Remove node_modules, .next, .turbo, dist, coverage and test output |

`pnpm clean --dry-run` lists what it would delete without touching anything.

Two caveats worth knowing before you hit them:

`pnpm build` (and therefore `pnpm verify`) fails while `NODE_ENV=development` is
exported, which it is if you sourced `.env`. `next build` refuses a
non-standard `NODE_ENV` and dies prerendering the global error page. Run
`NODE_ENV=production pnpm build`, or `env -u NODE_ENV pnpm build`.

`pnpm format` currently runs Prettier with no configuration file, so it applies
Prettier's defaults — double quotes and semicolons — which contradict the style
the rest of the repository is written in. Leave it alone until a `.prettierrc`
matching the house style exists; ESLint is the enforced gate either way.

To run one workspace on its own, filter it:

```bash
pnpm --filter @desi-event/api dev
pnpm --filter @desi-event/pricing test
```

## API documentation

The API describes itself. With the API running:

* **http://127.0.0.1:4000/docs** — Swagger UI, generated from the route
  contract in `@desi-event/api-contract`.
* **http://127.0.0.1:4000/openapi.json** — the raw OpenAPI 3.1 document.

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

* **Vitest units** in every package, co-located as `src/<name>.test.js`. Pure
  logic packages enforce 80% line and function coverage.
* **React Testing Library** component tests in `@desi-event/ui` and `apps/web`.
* **Playwright** end-to-end specs in `apps/web/e2e`, which start their own
  Next.js server on port 3210.

The suites that need PostgreSQL or Redis — `packages/db/tests/client.test.js`
and `apps/worker/tests/redis-integration.test.js` — probe for the service and
skip themselves when it is not reachable, so `pnpm test` passes on a laptop
with nothing running and still tests the real wiring where it exists.

## Documentation

| Document | Contents |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | Request flow, the checkout and hold lifecycle, package graph, trust boundaries |
| [docs/development.md](docs/development.md) | Day-to-day workflow: services, env vars, migrations, debugging, testing |
| [docs/api.md](docs/api.md) | REST reference: auth, errors, pagination, every endpoint |
| [docs/language-policy.md](docs/language-policy.md) | The JavaScript-only policy and the exception process |
| [docs/adr/](docs/adr/) | Architecture decision records |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Branches, commits, the verify gate, definition of done |
