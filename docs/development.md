# Development

Day-to-day workflow: getting the services up, what each environment variable
does, running one application at a time, migrations, seeding, debugging,
testing, and adding a shared package.

The one-page version of first-time setup is in the
[README quickstart](../README.md#quickstart). This document is what you come
back to afterwards.

## Starting PostgreSQL and Redis

Both must be listening before the API or the worker will start. The defaults in
`.env.example` expect PostgreSQL on `127.0.0.1:5432` with a `desi` role and
password `desi`, and Redis on `127.0.0.1:6379`.

### With Docker

```bash
docker run -d --name desi-postgres \
  -e POSTGRES_USER=desi -e POSTGRES_PASSWORD=desi -e POSTGRES_DB=desi_event \
  -p 5432:5432 postgres:16

docker run -d --name desi-redis -p 6379:6379 redis:7
```

`docker start desi-postgres desi-redis` brings them back after a reboot. The
same two images are what CI runs (`.github/workflows/ci.yml`), so a failure
that reproduces locally reproduces there.

### With local services

```bash
# macOS, Homebrew
brew services start postgresql@16
brew services start redis

# Debian/Ubuntu
sudo systemctl start postgresql redis-server
```

Then create the role and databases once:

```bash
createuser --createdb desi
psql -c "ALTER ROLE desi WITH PASSWORD 'desi' LOGIN"
createdb -O desi desi_event
createdb -O desi desi_event_test
```

### Checking they are up

```bash
pg_isready -h 127.0.0.1 -p 5432          # → accepting connections
redis-cli -u redis://127.0.0.1:6379 ping  # → PONG
curl -s http://127.0.0.1:4000/health      # → {"status":"ok",…} once the API runs
```

`desi_event_test` is optional but worth creating: without it,
`packages/db/tests/client.test.js` skips its integration cases instead of
running them.

## Environment variables

`cp .env.example .env`, then export the file into your shell before running
anything — each application reads `.env` relative to its own directory, and
pnpm runs scripts from the package that owns them:

```bash
set -a; . ./.env; set +a
```

[direnv](https://direnv.net) with an `.envrc` containing `dotenv` automates
this. `pnpm db:seed` is the exception: it loads the root `.env` itself.

Each process parses its own variables at boot through a Zod schema in
`@desi-event/schemas` (`apiEnvSchema`, `workerEnvSchema`, `webEnvSchema`), so a
missing or malformed value is an immediate crash that names the variable rather
than a confusing failure an hour later.

### Shared

| Variable | Default | What it does |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development`, `test` or `production`. Production tightens error bodies and rejects placeholder secrets. Note: `next build` refuses a non-standard `NODE_ENV`, so build with `NODE_ENV=production pnpm build` when `.env` is exported |
| `LOG_LEVEL` | `info` | Pino level: `trace`…`fatal`. `.env.example` uses `debug` |
| `DATABASE_URL` | — | PostgreSQL connection string. Required by the API, the worker and every Prisma command |
| `REDIS_URL` | — | Redis connection string. Required by the worker |
| `TEST_DATABASE_URL` | — | Database the integration tests connect to and truncate freely. Never point this at a database you care about |

### API (`apps/api`)

| Variable | Default | What it does |
| --- | --- | --- |
| `API_HOST` | `0.0.0.0` | Interface Fastify binds to |
| `API_PORT` | `4000` | Port Fastify binds to |
| `JWT_SECRET` | — | Signing key for bearer tokens. At least 32 characters; known placeholders are refused when `NODE_ENV=production` |
| `JWT_EXPIRES_IN` | `7d` | Token lifetime, as `30m`, `12h` or `7d` |
| `CORS_ORIGIN` | `*` | `*` for any origin, or a comma-separated allow-list |
| `PLATFORM_FEE_BPS` | `590` | Platform fee in basis points; 590 = 5.90% of the discounted subtotal |
| `PLATFORM_FEE_FLAT_CENTS` | `99` | Flat fee per ticket, in integer cents |
| `TICKET_HOLD_TTL_SECONDS` | `600` | How long a checkout hold reserves inventory |

### Worker (`apps/worker`)

| Variable | Default | What it does |
| --- | --- | --- |
| `QUEUE_PREFIX` | `desi-event` | Namespace for every BullMQ key. Change it to run two workers against one Redis without them stealing each other's jobs |
| `WORKER_CONCURRENCY` | `5` | Jobs each worker runs at once. The hold sweep is pinned to 1 regardless |
| `EXPIRE_HOLDS_INTERVAL_MS` | `30000` | How often the hold sweep is enqueued |

The worker also reads `PLATFORM_FEE_BPS`, `PLATFORM_FEE_FLAT_CENTS` and
`TICKET_HOLD_TTL_SECONDS`, so the two processes agree on pricing and expiry.

### Web (`apps/web`)

| Variable | Default | What it does |
| --- | --- | --- |
| `WEB_PORT` | `3000` | Port `next dev` and `next start` listen on |
| `NEXT_PUBLIC_API_URL` | `http://127.0.0.1:4000` | API origin the client is built against. Inlined into browser bundles — never put a secret in a `NEXT_PUBLIC_*` variable |
| `NEXT_PUBLIC_SITE_URL` | `http://127.0.0.1:3000` | Canonical site origin, used for metadata |
| `WEB_E2E_PORT` | `3210` | Port the Playwright suite starts its own dev server on, deliberately not 3000 |

## Running individual apps

`pnpm dev` runs all three through Turborepo with interleaved, prefixed logs.
When you want one:

```bash
pnpm --filter @desi-event/api dev      # node --watch src/server.js
pnpm --filter @desi-event/web dev      # next dev
pnpm --filter @desi-event/worker dev   # node --watch src/main.js
```

Any root script can be filtered the same way:

```bash
pnpm --filter @desi-event/pricing test
pnpm --filter @desi-event/ui lint
pnpm --filter @desi-event/web test:e2e:ui   # Playwright's interactive runner
```

The API and the worker restart on file changes via `node --watch`; no
nodemon, no build step. The web app uses Next's own dev server.

You rarely need all three. The web app renders a bundled sample catalogue when
the API is unreachable, so front-end work needs only `pnpm --filter
@desi-event/web dev`. The worker is only needed when you are changing a queue
processor or want abandoned holds swept in the table.

## Migrations

Prisma 7 reads its connection details from `packages/db/prisma.config.mjs`,
which takes `DATABASE_URL` from the environment. Export your `.env` first (see
above) or every Prisma command fails with *"The datasource.url property is
required"*.

### Creating one

Edit `packages/db/prisma/schema.prisma`, then:

```bash
pnpm db:migrate            # prisma migrate dev — prompts for a migration name
```

That generates SQL under `packages/db/prisma/migrations/<timestamp>_<name>/`,
applies it, and regenerates the client. Commit the migration directory together
with the schema change; a schema change without its migration is an incomplete
commit.

### Applying existing ones

```bash
pnpm db:migrate:deploy     # prisma migrate deploy — no prompts, no generation
```

This is what CI and deployments run. It only applies migrations that are
already committed; it never creates one.

### Checking state

```bash
pnpm --filter @desi-event/db run migrate:status
```

### Resetting

```bash
pnpm db:reset              # drop, recreate, migrate, then re-seed
```

Destructive and unconditional (`--force`). It is the right answer to a drifted
development database and the wrong answer to anything with data in it.

### Regenerating the client

```bash
pnpm db:generate
```

`pnpm build` does this as part of building `@desi-event/db`, so it is rarely
needed by hand — mostly after switching branches onto a different schema.

## Seeding

```bash
pnpm db:seed
```

Idempotent: every write is an `upsert` keyed on a natural unique column, and
models without one get stable `seed-` prefixed primary keys, so running it
twice leaves the database exactly as running it once did. There are no blind
`create` calls.

It produces 15 users, 2 organisations, 6 venues, 12 events (10 published, 2
draft, 2 online), 31 ticket types, 12 orders across INR and CAD, plus holds,
promo codes, waitlist entries and audit logs. Every seeded account shares the
password `DesiEvent!2026`; override it with `SEED_PASSWORD`.

The dataset is built by a pure function of "now", which is what lets the
arithmetic — order totals, `quantitySold`, promo redemption counts — be
verified by `packages/db/tests/seed-data.test.js` without a database.

## Debugging

**Logs.** Both Node processes log through Pino. Outside production they pipe
through `pino-pretty`, so `LOG_LEVEL=debug pnpm --filter @desi-event/api dev`
gives readable, coloured output. Every API log line carries the request id,
which is also returned to the client as `error.requestId` on a failure — quote
it and grep for it.

**A debugger.**

```bash
pnpm --filter @desi-event/api exec node --inspect --watch src/server.js
pnpm --filter @desi-event/worker exec node --inspect --watch src/main.js
```

Then open `chrome://inspect`, or attach your editor to port 9229.

**One test, with a debugger.**

```bash
pnpm --filter @desi-event/pricing exec vitest run src/totals.test.js
pnpm --filter @desi-event/api exec vitest run tests/orders.test.js -t 'oversell'
```

**The database.** `pnpm db:studio` opens Prisma Studio; `psql "$DATABASE_URL"`
if you would rather write SQL.

**The API surface.** With the API running, http://127.0.0.1:4000/docs is
Swagger UI generated from the same route descriptors the server enforces, and
every operation there is executable against your local instance.

**Queues.** The worker logs every job's completion and failure with its queue,
job name and duration. `redis-cli --scan --pattern 'desi-event:*'` shows the
raw keys; failed jobs are retained for days on purpose so there is something to
look at after the fact.

**Turborepo caching.** If a task's output looks stale, `pnpm clean --dry-run`
shows what caches exist and `pnpm clean` removes them. `turbo run build
--force` skips the cache for one run.

## Testing

Three layers, each with a different job.

### Vitest units

Every package. Tests are co-located as `src/<name>.test.js`, plus `tests/` for
integration suites. Imports are explicit — the shared preset runs with
`globals: false`:

```js
import { describe, it, expect } from 'vitest'
```

```bash
pnpm test                                   # everything
pnpm --filter @desi-event/inventory test    # one package
pnpm --filter @desi-event/inventory exec vitest      # watch mode
pnpm test:coverage                          # with thresholds
```

Pure-logic packages (`pricing`, `permissions`, `inventory`, `schemas`) enforce
80% lines and functions and 75% branches. That is the deal the language policy
makes: no compiler, so the tests carry the weight.

Two suites touch real infrastructure and skip themselves when it is absent:
`packages/db/tests/client.test.js` (needs `TEST_DATABASE_URL`) and
`apps/worker/tests/redis-integration.test.js` (needs `REDIS_URL`). A suite that
fails for environmental reasons trains people to ignore red, so they skip
instead — but they are the only check that the queue and the worker agree on a
key prefix, so make sure Redis is up when you touch `apps/worker`.

The API tests need neither: `buildApp()` takes its Prisma client and providers
as arguments, so the entire HTTP surface is exercised with `app.inject()`
against a stub and the in-memory providers.

### React Testing Library components

`@desi-event/ui` and `apps/web`, using `@vitejs/plugin-react`, jsdom and a
`vitest.setup.js` that registers the jest-dom matchers, installs cleanup and
stubs `IntersectionObserver` for Framer Motion's `whileInView`.

Query by role and accessible name, not by class or test id — that is the point
of testing the components this way:

```js
screen.getByRole('button', { name: 'Add to basket' })
```

### Playwright end-to-end

`apps/web/e2e/*.spec.js`: the visitor journey, listing filters, and
accessibility.

```bash
pnpm test:e2e                                # headless
pnpm --filter @desi-event/web test:e2e:ui    # interactive
```

The suite starts its own `next dev` on port 3210 so it cannot hijack — or
silently test — whatever you have running on 3000. It deliberately starts **no
API**: these specs exercise the site in the degraded state the fallback
catalogue exists for.

## Adding a shared package

Say the new package is `@desi-event/notifications`.

1. **Create the directory** `packages/notifications/` with `src/index.js`. It
   is picked up automatically: `pnpm-workspace.yaml` globs `packages/*`.

2. **Write `package.json`.** Copy the shape of a comparable existing package —
   `packages/inventory/package.json` for pure logic, `packages/providers` for
   one with dependencies:

   ```json
   {
     "name": "@desi-event/notifications",
     "version": "0.1.0",
     "private": true,
     "type": "module",
     "description": "One line saying what this package owns.",
     "main": "./src/index.js",
     "exports": {
       ".": "./src/index.js",
       "./package.json": "./package.json"
     },
     "files": ["src"],
     "scripts": {
       "lint": "eslint .",
       "test": "vitest run",
       "test:watch": "vitest",
       "test:coverage": "vitest run --coverage"
     },
     "devDependencies": {
       "@desi-event/config": "workspace:*",
       "@vitest/coverage-v8": "^5.0.0",
       "vite": "^8.3.0",
       "vitest": "^5.0.0"
     }
   }
   ```

   `"type": "module"` and the `./package.json` export are not optional; several
   tools resolve the latter.

3. **Add `vitest.config.js`.** Node packages:

   ```js
   import { defineConfig } from 'vitest/config'
   import { nodeTestConfig } from '@desi-event/config/vitest-node'

   export default defineConfig({ test: nodeTestConfig() })
   ```

   React packages use `reactTestConfig()` from
   `@desi-event/config/vitest-react`, add `@vitejs/plugin-react` to `plugins`,
   and point `setupFiles` at a `vitest.setup.js` that imports
   `@testing-library/jest-dom/vitest`.

4. **Do not add an ESLint config.** The root `eslint.config.js` already covers
   every workspace. A per-package config is drift waiting to happen.

5. **Wire up consumers.** Add `"@desi-event/notifications": "workspace:*"` to
   the consuming package's `dependencies`, then `pnpm install` to link it.

6. **Write the code.** JSDoc on every export with `@param`, `@returns` and
   `@throws`; `@typedef` for object shapes. Errors get a `statusCode` and a
   machine-readable `code`, like `PermissionError` and `InventoryError` do.
   Money is integer cents. Keep I/O at the edges so the logic stays testable.

7. **Keep the graph shallow.** A shared package that imports `@desi-event/db`
   drags a database into everything that touches it. Take the data as an
   argument instead; that is why `pricing`, `permissions` and `inventory`
   depend on nothing.

8. **Verify** before opening a pull request:

   ```bash
   pnpm --filter @desi-event/notifications lint
   pnpm --filter @desi-event/notifications test
   pnpm verify
   ```

If the package exposes an HTTP surface, the routes belong in
`@desi-event/api-contract` rather than in the package, so the OpenAPI document
and the generated client pick them up. See [api.md](api.md).
