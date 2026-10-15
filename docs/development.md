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

| Variable            | Default       | What it does                                                                                                                                                                                                                          |
| ------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`          | `development` | `development`, `test` or `production`. Production tightens error bodies and rejects placeholder secrets. Note: `next build` refuses a non-standard `NODE_ENV`, so build with `NODE_ENV=production pnpm build` when `.env` is exported |
| `LOG_LEVEL`         | `info`        | Pino level: `trace`…`fatal`. `.env.example` uses `debug`                                                                                                                                                                              |
| `DATABASE_URL`      | —             | PostgreSQL connection string. Required by the API, the worker and every Prisma command                                                                                                                                                |
| `REDIS_URL`         | —             | Redis connection string. Required by the worker                                                                                                                                                                                       |
| `TEST_DATABASE_URL` | —             | Database the integration tests connect to and truncate freely. Never point this at a database you care about                                                                                                                          |

### API (`apps/api`)

| Variable                                                                                               | Default                             | What it does                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `API_HOST`                                                                                             | `0.0.0.0`                           | Interface Fastify binds to                                                                                                                                                                           |
| `API_PORT`                                                                                             | `4000`                              | Port Fastify binds to                                                                                                                                                                                |
| `JWT_SECRET`                                                                                           | —                                   | Signing key for bearer tokens. At least 32 characters; known placeholders are refused when `NODE_ENV=production`                                                                                     |
| `JWT_EXPIRES_IN`                                                                                       | `7d`                                | Token lifetime, as `30m`, `12h` or `7d`                                                                                                                                                              |
| `CORS_ORIGIN`                                                                                          | `*`                                 | `*` for any origin, or a comma-separated allow-list                                                                                                                                                  |
| `PLATFORM_FEE_BPS`                                                                                     | `590`                               | Platform fee in basis points; 590 = 5.90% of the discounted subtotal                                                                                                                                 |
| `PLATFORM_FEE_FLAT_CENTS`                                                                              | `99`                                | Flat fee per ticket, in integer cents, for INR orders only: every other currency takes the currency table (99 cents for USD), whatever this says. An event's own booking fee replaces both           |
| `TICKET_HOLD_TTL_SECONDS`                                                                              | `600`                               | How long a checkout hold reserves inventory                                                                                                                                                          |
| `DELIVERY_MODE`                                                                                        | `MANUAL`                            | How single-use codes reach people: `MANUAL` shows each once to whoever issued it; `EMAIL` sends it through `SMTP_HOST` (see "Emailing codes locally")                                                |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_REQUIRE_TLS`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | port `587`, `SMTP_REQUIRE_TLS=true` | The mail server for `EMAIL` delivery. `SMTP_FROM` is required with it; user and password go together or not at all; production refuses a server that is neither `SMTP_SECURE` nor `SMTP_REQUIRE_TLS` |
| `WEB_ORIGIN`                                                                                           | —                                   | The site's own origin, for the join link in an emailed letter (the code is never in it). Required with `EMAIL`; https in production                                                                  |
| `TRAFFIC_TRUSTED_FORWARDERS`                                                                           | `127.0.0.1,::1,::ffff:127.0.0.1`    | IP addresses whose `x-desi-client-address` header the API believes: the web servers. Keep the API port private when loopback is trusted                                                              |
| `TRAFFIC_BEACON_MAX_PER_MINUTE`                                                                        | `60`                                | Visit beacons one visitor may send a minute                                                                                                                                                          |
| `IMPORT_IMAGE_SOURCE`                                                                                  | `network`                           | Where imported pictures are copied from: `network` (only `usimg.sulekha.io`, directly, no proxy) or `fixtures` (a directory; refused in production)                                                  |
| `IMPORT_IMAGE_FIXTURE_DIR`                                                                             | —                                   | The directory `fixtures` reads pictures from, by file name. Required with `fixtures`                                                                                                                 |

### Worker (`apps/worker`)

| Variable                     | Default      | What it does                                                                                                                 |
| ---------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `QUEUE_PREFIX`               | `desi-event` | Namespace for every BullMQ key. Change it to run two workers against one Redis without them stealing each other's jobs       |
| `WORKER_CONCURRENCY`         | `5`          | Jobs each worker runs at once. The hold sweep is pinned to 1 regardless                                                      |
| `EXPIRE_HOLDS_INTERVAL_MS`   | `30000`      | How often the hold sweep is enqueued                                                                                         |
| `TRAFFIC_ROLLUP_INTERVAL_MS` | `600000`     | How often the traffic roll-up adds visits up into daily totals (and deletes raw visit rows two days old); 1 minute to 1 hour |

The worker also reads `PLATFORM_FEE_BPS`, `PLATFORM_FEE_FLAT_CENTS` and
`TICKET_HOLD_TTL_SECONDS`, so the two processes agree on pricing and expiry.

### Web (`apps/web`)

| Variable                     | Default                 | What it does                                                                                                                                                                                    |
| ---------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WEB_PORT`                   | `3000`                  | Port `next dev` and `next start` listen on                                                                                                                                                      |
| `NEXT_PUBLIC_API_URL`        | `http://127.0.0.1:4000` | API origin the client is built against. Inlined into browser bundles — never put a secret in a `NEXT_PUBLIC_*` variable                                                                         |
| `NEXT_PUBLIC_SITE_URL`       | `http://127.0.0.1:3000` | Canonical site origin, used for metadata                                                                                                                                                        |
| `WEB_E2E_PORT`               | `3210`                  | Port the Playwright suite starts its own dev server on, deliberately not 3000                                                                                                                   |
| `TRAFFIC_TRUSTED_PROXY_HOPS` | `0`                     | Proxies in front of the web server that append to `x-forwarded-for`; the visitor's address is that many entries from the end. `0` takes the connection's address, and production logs a warning |

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
above) or every Prisma command fails with _"The datasource.url property is
required"_.

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

### Verifying against a database that has never seen this project

```bash
pnpm db:verify:fresh                    # create, migrate, seed, probe, drop
pnpm db:verify:fresh --keep             # leave it behind to inspect
pnpm db:verify:fresh --report=out.json  # machine-readable results
```

A development database accumulates history: a column added by hand, rows left
by an earlier schema, a migration applied out of order. Verifying against it
proves that _that_ database works, which is not the claim anyone cares about.

So this creates a new one named `desi_event_disposable_<16 hex digits>`, applies
every migration into it from zero, seeds it twice to prove the seed is
idempotent, probes the constraints the application relies on but cannot enforce
(single hold owner, denominated fixed-amount promos, order and payment
idempotency keys, provider charge references, webhook deliveries, ticket
codes), runs both database integration suites against it, and drops it.

It will only ever touch a database whose name matches that pattern:
`DATABASE_URL`, `TEST_DATABASE_URL` and anything else are refused before a
single statement runs, and there is no flag that overrides it. `DATABASE_URL`
is read only to learn which _server_ to create the database on. Nothing it
prints contains a credential — the connection is reported as
`postgresql://<redacted>@<redacted>/<database>`.

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

It produces the USA garba catalogue the site's sample data shows: 26 users
(a super administrator, a platform administrator and a moderator among them),
11 organisations (one waiting in the verification queue), 11 venues, 24 events
(21 across every public lifecycle state, 2 drafts and 1 deleted; 1 online), 39
ticket types and 17 orders in USD at the demo's 0% US tax, plus 10 sessions (the
nine nights of the season pass and the live-band evening), a published 24-seat
balcony plan sold through a reserved tier, holds, promo codes, waitlist entries
and audit logs. Every name, address and email is invented, on `.example`
domains. Every seeded account shares the password `DesiEvent!2026`; override it
with `SEED_PASSWORD`. No account is seeded with a second factor: every account
whose role needs one — the super administrator, the platform administrator, the
moderator, and the organisations' owners, administrators and managers — is
asked to set up two-step sign-in the first time it signs in.

**Accounts for the team at The Desi Events:**

| Account                             | Role          | What it is for                                                                                                                                                                            |
| ----------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admin@desi-event.example`          | `SUPER_ADMIN` | Everything, People and roles (`/admin/users`) included                                                                                                                                    |
| `platform-admin@desi-event.example` | `ADMIN`       | The platform administrator: organiser invitations, event and picture review, website links, every event's visits, editing and deleting posted events, imports. Belongs to no organisation |
| `moderator@desi-event.example`      | `MODERATOR`   | Event, picture and organisation reviews only                                                                                                                                              |

**What else it seeds for the new screens (2026-10-06):**

- **One organiser invitation waiting** to `new-organiser@desi-event.example` for
  "Kathiawar Folk Nights", issued by the platform administrator. Its code was
  made at seed time and thrown away — only its digest is stored, as for every
  code — so nobody can use it as it is. To try the join flow, sign in as
  `platform-admin@desi-event.example`, open `/admin/organizer-invitations` and
  choose "Issue a new code" on it: that withdraws the seeded one and shows a
  usable code once. Register `new-organiser@desi-event.example`, sign in as it,
  and type the code at `/account/organizations/new`.
- **One deleted event**, "Sharad Purnima Garba Showcase" (Mirrorwork Events),
  deleted from on sale by the platform administrator with nothing sold
  (outcome REMOVED). It is on `/admin/events` with "Deleted", in Mirrorwork's own
  events list, and can be restored by the platform administrator. Its web
  address stays retired.
- **One picture waiting for review** on Mirrorwork's beginner garba workshop,
  uploaded by its owner Nisha Patel, at `/moderation/pictures`. Nisha cannot
  approve it; the moderator or the platform administrator can.
- **Fourteen days of demonstration visit totals** (`TrafficDaily` rows marked
  `demonstration`) for two of Mirrorwork's public events, Navratri Night One
  and the live-band night, ending yesterday, and the roll-up's last completion
  set to the moment the seed ran. `/analytics` says "Demonstration figures"
  while any of them is summed.
- **No imported events**: run `pnpm import:events` after seeding (README,
  "Importing the Sulekha events").

**What else it seeds for booking fees, referral codes and paying at the venue
(2026-10-13, ADRs 0016 and 0017):**

- **An event with its own booking fee.** "Navratri Night One: Garba Under the
  Lights" (Mirrorwork Events) charges 3.00% + $1.49 a ticket, set two days
  before the seed by the platform administrator with the reason "Demo: this
  event’s own booking fee". Its older order keeps the site default it was
  placed with; the newer one, DE-US-200014, was priced with the event's fee and
  had it waived by a referral code.
- **Two referral codes**, made by the platform administrator: "Demo: every
  event, 100 uses" (every event, up to 100 uses, used twice) and "Demo:
  Navratri Night One only" (that event only, stopping 60 days after the first
  seed). Their texts are drawn when the rows are first written, never written in
  this repository and never printed: sign in as
  `platform-admin@desi-event.example` and read them at `/admin/referral-codes`.
  A code's maker cannot use it, so try one as `aarav.shah@mail.example`.
- **Paying at the venue, on two events,** with a limit of 50 and the reason
  "Demo: paying at the door":
  - "Dandiya Raas with a Live Dhol Ensemble" (Chaniya Collective, Houston), on sale:
    Aarav Shah's two bookings to pay at the door, DE-US-200016 (two tickets, its
    booking fee paid online) and DE-US-200017 (one ticket, its booking fee
    waived by the all-events code, so nothing was paid online). Every ticket
    still owes $30.00 at the door, so the organiser's "Payments at the venue"
    page and the administrators' "Bookings waiting to be paid at the door" list
    them, and "Cancel unpaid tickets" works on them.
  - "Garba Warm-Up Night" (Peachtree Raas Club), which has happened:
    Diya Patel's booking DE-US-200015, three tickets at $15.00. One was paid for
    at the door and let in by the club's owner during the night (a
    `VenuePayment` with its admission), one was cancelled unpaid by the
    platform administrator once the doors had opened, with the reason "Demo: not
    paid before the doors opened" (its place freed, $1.87 of the booking fee
    kept), and one was never paid: its holder did not come.
- **Their history:** the fee decision, both switches, both codes, the payment
  and the cancellation each have their audit row.

**Trying it.** Sign in as `aarav.shah@mail.example` and book the Houston
dandiya night with "Pay at the venue": the checkout shows the booking fee paid
now and the ticket price at the door; type a referral code from
`/admin/referral-codes` into "Referral code (optional)" to see the booking fee waived. As
`anjali.desai@chaniya.example` (Chaniya's owner) open the event's "Payments at
the venue" page to see the bookings and cancel unpaid tickets; the door
(`/organizer/check-in`) takes the payment and lets the ticket in. As the
platform administrator, the event's page under `/admin/events` has its "Booking
fee and payment" section, and `/admin/fee-refunds` refunds a booking fee by
hand. Refunding a **seeded** order — its booking fee by hand included —
answers that the refund failed, because its payment was never made through the
API process's in-memory provider; place an order on the site first and refund
that one.

A re-seed leaves three things as it finds them: a deleted event (seeded, or
deleted by you since) with everything under it; the invitation and the picture,
which are created once; and any day the traffic roll-up has written real totals
for. The booking-fee decision, the pay-at-the-venue switches, the referral codes,
the payment taken at the door and the cancelled unpaid ticket are made once and
then left as they are: a fee or switch you change afterwards stays yours, and a
code's text is never drawn again.

The seed only adds and updates rows. A database seeded by an older version
keeps that version's rows beside the new ones until `pnpm db:reset`.

The dataset is built by a pure function of "now", which is what lets the
arithmetic — order totals, `quantitySold`, promo redemption counts — be
verified by `packages/db/tests/seed-data.test.js` without a database.

## Emailing codes locally

By default (`DELIVERY_MODE=MANUAL`) every single-use code is shown once to
whoever issued it, and nothing is emailed. To see the `EMAIL` path, point the
API at any SMTP server you run yourself — for example a capture tool such as
MailHog or Mailpit on `localhost:1025` (you install it; this repository does not
ship one):

```bash
DELIVERY_MODE=EMAIL
SMTP_HOST=127.0.0.1
SMTP_PORT=1025
SMTP_REQUIRE_TLS=false      # a local capture server has no TLS; refused in production
SMTP_FROM=no-reply@thedesievents.com
WEB_ORIGIN=http://127.0.0.1:3000
```

Restart the API. Organiser invitations, team invitations and ticket transfers
then answer without a code and send a UTF-8 letter with the code on its own line
and a link to the page where it is typed — never a link carrying the code. A
refused send withdraws the invitation or transfer and answers 503
`DELIVERY_FAILED`. At most three codes a day go to one address. The automated
proof is `packages/providers/src/smtp.test.js` and
`apps/api/tests/email-delivery-integration.test.js`, which run against
`smtp-server` on loopback.

## Visit counting locally

The web server sends beacons for page views and clicks; the API stores raw
visits without addresses; the worker's `roll-up-traffic` job adds them into
`TrafficDaily` every `TRAFFIC_ROLLUP_INTERVAL_MS` (ten minutes by default). So
`/analytics` changes only after the worker has run: start it with
`pnpm --filter @desi-event/worker dev`. Visits you make while signed in as a
member of the event's organisation, or as staff, are not counted. With the web
and API on one machine the defaults (`TRAFFIC_TRUSTED_FORWARDERS` loopback,
`TRAFFIC_TRUSTED_PROXY_HOPS=0`) are right.

## Importing the Sulekha events locally

See the README section "Importing the Sulekha events". In short:
`pnpm import:events packages/db/data/imports/sulekha-texas-2026.json --as
platform-admin@desi-event.example` plans the file; add `--apply` to import the
events into review. Approving and publishing is done in the browser at
`/admin/imports`. Picture copying needs direct outbound HTTPS to
`usimg.sulekha.io` (no proxy is used); without it, set
`IMPORT_IMAGE_SOURCE=fixtures` and `IMPORT_IMAGE_FIXTURE_DIR` to a directory of
pictures named as in the listing addresses, or accept generated posters and use
"Retry pictures" later. Events whose date has passed are skipped.

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

The suites that do start an API (`test:e2e:detail`, `:events`, `:organizer`,
`:refusals`, `:sweep`) write to a database of their own, `E2E_DATABASE_URL`,
by default `desi_event_e2e` on the local server; they do not read
`TEST_DATABASE_URL`. Each one's API server migrates it before it serves,
creating it when it is missing, so there is nothing to set up. They refuse the
unit suites' databases (`desi_event_test` and private `desi_event_test_…`
ones): a browser run rolls visits up and purges old ones across the whole
database, which fails the worker's roll-up suite when the two share one
(`apps/web/e2e/support/e2e-database.mjs`).

Every suite on the development server starts it through
`apps/web/e2e/support/next-dev.mjs` and proves its routes before the first
test, and `pnpm ci:check` refuses one that does not. Next 16.3.8's `next dev`
could start with part of its route table missing; `patches/next@16.3.8.patch`
fixes that at the root, and `apps/web/e2e/support/dev-routes.mjs` tells the
story.

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
