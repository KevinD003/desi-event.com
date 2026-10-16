# The Desi Events

> The product is **The Desi Events**, at
> [thedesievents.com](https://thedesievents.com). It was called Desi-Event
> during development, and code identifiers such as the `@desi-event/*` package
> scope, the repository name and the database names keep that name.

Event discovery and ticketing for the South Asian community. Garba nights,
Bollywood concerts, classical dance recitals, comedy tours, film screenings,
food and wedding expos: the kind of event that today lives on a WhatsApp
forward and a Google Form. The Desi Events gives organisers a real ticketing
system and gives attendees one place to find what is on near them.

The platform is three deployable applications — a Fastify REST API, a Next.js
storefront and a BullMQ worker — sitting on thirteen shared packages,
PostgreSQL and Redis, in one pnpm workspace.

The booking fee buyers pay is the charge of The Desi Events. The team at
The Desi Events can set it for each event at any time, for new orders only, and
the team hands out referral codes that remove it from one order. Where the team
switches it on for an event, buyers can pay the ticket price at the door
instead: the booking fee is paid online (simulated), no sales tax is added, and
the steward records the payment in the same step that lets the ticket in. Money
taken at the door stays with the organiser and never enters the platform's
ledger; unpaid tickets can be cancelled by the organiser or the team, freeing
their places
([ADR 0016](docs/adr/0016-per-event-booking-fee-and-referral-codes.md),
[ADR 0017](docs/adr/0017-paying-at-the-venue-outside-the-ledger.md),
[the owner's report](docs/PHASE4_FEES_AND_VENUE_PAYMENTS_REPORT.md)).

## Contact

The Desi Events can be reached on these public channels, as published on
[thedesievents.com](https://thedesievents.com):

| Channel   | Address                                                                  |
| --------- | ------------------------------------------------------------------------ |
| Email     | [info@thedesievents.com](mailto:info@thedesievents.com)                  |
| Phone     | [+1 972 694 9043](tel:+19726949043)                                      |
| WhatsApp  | [+1 972 694 9043](https://wa.me/19726949043)                             |
| Facebook  | [facebook.com/the.desievents](https://www.facebook.com/the.desievents)   |
| Instagram | [instagram.com/the.desievents](https://www.instagram.com/the.desievents) |

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
| Runtime                  | Node.js                       | 22.23.3 (`.nvmrc`)          |
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

- **Node.js 22.23.3** — the exact version is in `.nvmrc`; `nvm use` picks it up.
  `.npmrc` sets `engine-strict=true`, so an unsupported runtime fails at
  install rather than at runtime. `engines` asks for 22.23.3 or later because
  event times are read through Node's own time-zone data, and only that data
  (tzdata 2026c) knows British Columbia and Alberta keep one offset all year;
  older Node prints their winter times an hour early.
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

nvm use                    # Node 22.23.3, from .nvmrc
corepack enable            # pnpm 10.33.0, from packageManager
pnpm install

cp .env.example .env
set -a; . ./.env; set +a   # export the variables into this shell — see below

pnpm db:migrate            # create the schema
pnpm db:seed               # 26 users, 11 organisations, 24 events, 17 orders (USD)
pnpm dev                   # api, web and worker together
```

That leaves three processes running:

| Process | URL                   | Notes                                         |
| ------- | --------------------- | --------------------------------------------- |
| Web     | http://127.0.0.1:3000 | Next.js dev server                            |
| API     | http://127.0.0.1:4000 | Fastify; `/health`, `/docs`, `/openapi.json`  |
| Worker  | —                     | BullMQ; sweeps expired holds every 30 seconds |

Seeded accounts all share the password `DesiEvent!2026`. Among them are the
platform administrator `platform-admin@desi-event.example`, who invites
organisers and reviews events, and the super administrator
`admin@desi-event.example`; [docs/development.md](docs/development.md) lists
every account and what else the seed writes.

**Why the `set -a` line.** Each application reads `.env` relative to its own
working directory, and pnpm runs every script from the package that owns it. A
`.env` at the repository root is therefore not visible to `apps/api` or to
Prisma in `packages/db` unless it is exported into the shell first. `set -a`
marks subsequent assignments for export, `. ./.env` sources the file, `set +a`
turns the marking off again. [direnv](https://direnv.net) with an `.envrc` of
`dotenv` does the same thing automatically. `pnpm db:seed` is the exception —
it reads the root `.env` itself — but the rest need the export.

## Importing listed events

The seed does not import anything. Two files of events copied from organisers'
public ticket listings are in `packages/db/data/imports/` (their file names and
the source identifier `SULEKHA` are identifiers only):

- `texas-2026.json`: 45 Texas events, collected on 29–30 September
  2026, dated 2 October to 22 November 2026.
- `north-america-2026.json`: 294 events in 23 US states, DC and 3
  Canadian provinces, from the owner's own export of 397 listings, curated on
  15 October 2026, dated 15 October 2026 to 7 May 2027.

**Getting every event live (2026-10-16, ADR 0019).** Four steps, the last
one a person with a second factor:

```bash
pnpm db:migrate:deploy                       # 1. the schema
pnpm db:seed                                 # 2. the accounts, including the administrator
pnpm import:events:all \
  --as platform-admin@desi-event.example      #    (plan only: writes the runs, imports nothing)
pnpm import:events:all \
  --as platform-admin@desi-event.example --apply   # 3. both files, into review
```

4. Sign in at `/admin/imports` as that administrator (enrol the second factor
   the first time) and press **"Approve and publish all pending imported
   events"**. The panel says how many events wait, how many go on sale and
   how many are published with nothing to sell (no prices, or every price
   sold out), and asks for the second factor. Each event is approved on its
   own; one that cannot be is reported with its reason, and the rest go on.
   Events that have already started are left as they are.

`pnpm import:events:all` imports `texas-2026.json` first and
`north-america-2026.json` second, through `pnpm import:events` for each. The
two files share ten listings (all in Texas), and the North America file is
the newer: imported second, its words are the ones left on those ten, and its
run is the one they are approved from. Each of the ten carries a note saying
how the newer export differs. The command never approves or publishes.

One file at a time works as before, by an account that holds `event:import`
(a platform administrator or super administrator):

```bash
pnpm import:events packages/db/data/imports/texas-2026.json \
  --as platform-admin@desi-event.example            # plan only; writes the run
pnpm import:events packages/db/data/imports/texas-2026.json \
  --as platform-admin@desi-event.example --apply    # import into review
```

Import the Texas file before the North America one, or the older Texas words
go back over the ten listings both carry. Each listing is imported once, by
its source id: the second file plans those ten as updates of the drafts the
first one wrote (or leaves a posted one as it is unless "Update from the
listing" is ticked).

The file can also be uploaded at `/admin/imports`, which shows the same plan.
Applying writes each event as a draft waiting for review, with one ticket type
per listed price. Approving is done only in the browser, at `/admin/imports`
(every pending event at once, or a run's events from its own page), with a
second factor; it publishes the event and opens its ticket sales. The command
line never approves and never changes an event that is already posted.

Canadian prices are in Canadian dollars (CAD): the owner confirmed it on
16 October 2026, and the notes on those listings say so.

**Tickets are sold on The Desi Events (15 October 2026).** At the owner's
request nothing links, redirects or connects to the site the listings came
from: an imported event has no website link, the files carry no web address
and no picture, and the importer makes no outbound request at all (nothing is
copied; an imported event shows a generated poster until someone adds a
picture). Visitors buy tickets here, through the ordinary checkout, and the
event page also offers to reserve them on WhatsApp.

- **One ticket type per listed price,** in the event's currency (US dollars at
  US venues, Canadian dollars at Canadian ones), 1 to 10 per order. Each starts
  with an **allowance of 100**, which is not the organiser's count, so no page
  shows "tickets left" from it; an administrator changes it in the ticket-type
  editor, and it becomes a real count once the organiser edits it. A price the
  listing marks sold out becomes a ticket type that is closed, not on sale,
  and so does every price of a listing the export shows sold out as a whole
  (seven in the North America file): approving such an event opens nothing.
- **Approving opens sales** from the moment of approval until the event
  starts. An event already posted before this change gets its ticket types
  when it is next updated from its listing, and its sales open when an
  administrator approves it again.
- **Importing again never touches a ticket type that has sales** (an order,
  a hold or a ticket): it is kept as it is. The import locks each ticket type
  before it reads what is held, as the ticket-type editor does, so a hold made
  at that moment is counted, never repriced. A ticket type nobody has bought
  takes the listing's new price and order, and is closed if the listing now
  says sold out; one whose price left the listing is removed. Names,
  allowances and order limits an administrator set are kept.
- **Payments are simulated** in this build (`PAYMENT_MODE=MOCK`): checkout,
  tickets, the door, refunds and the finance views work for these events, and
  no money moves. Paying at the venue is not offered for them (409
  `VENUE_PAYMENT_UNAVAILABLE`). The platform administrators open and pause
  sales in an editing session; only a super administrator admits at the door.
- **Reserve on WhatsApp.** Every imported event page, and only those, has a
  "Reserve on WhatsApp" button beside the checkout. It opens a chat with the
  company's WhatsApp number (`apps/web/src/lib/contact.js`) in a new tab, with
  the message "Hi! I'd like to reserve tickets for "<title>" on <weekday,
  month day> at <venue>, <city>." ready to send. It is shown while the event
  is announced, on sale, paused or sold out and has not started; not on a
  cancelled, postponed or finished one. The page also says the prices are as
  the organiser listed them on the date the listing was read.
- **No other site's terms.** The files carry no FAQ answer about refunds,
  cancelling, buying or when tickets go on sale: those answers gave the
  listing site's terms, and the event's own terms apply here (a cancelled
  event's tickets are refunded). The page's structured data says a closed or
  sold-out ticket type is not in stock, as its line on the page does.
- **Events already past are skipped.** The Texas file imports nothing after
  22 November 2026; the North America file nothing after 7 May 2027.
- **What the North America file left out, and why.** Of the 397 listings in
  the export, 51 were marked Ended, 7 Cancelled, and 45 more were dated
  before 15 October 2026; none were duplicates. Sold Out, Selling Fast and
  Open Soon events are kept, with that status in a note for the administrator
  only. The export gives no collection time, so 15 October 2026 00:00 UTC
  stands for it. Prices at the 30 Canadian venues are imported in Canadian
  dollars: where the listing shows a plain `$`, that is an assumption, said in
  each event's note. ADR 0015's addendum lists every curation rule.
- **Nothing is kept up to date.** A change to a listing shows here only when
  the file is updated and imported again, and a posted event is updated only
  when an administrator ticks "Update from the listing" for it.

**Databases made before then.** Migration
`20261015100000_imported_events_sold_here` switches off and clears every
imported event's website link to that site, drops the import's own links and
its table of pictures, removes the addresses from the files runs stored, and
renames an imported venue's provenance `import:listing`. Pictures already
copied stay as ordinary pictures of their events. The address rule refuses
that site for every event from now on. Migration
`20261015110000_imported_listing_words` then rewords what imports wrote: an
imported event's entry and refund terms become the importer's present ones
(the age limit kept), FAQ entries naming that site or giving its terms of sale
are removed when the import wrote them (an entry a person added stays), and
the notes, moderation history, change notices and stored files say "the
source listing" instead of its name. Both are safe to run twice.

No public page and no administrator screen names that site, in any case. The
platform-held organisation the events belong to is "The Desi Events", at
`/organizers/the-desi-events`; each event still says "Presented by" its real
organiser. `packages/db/tests/import-dataset.test.js` fails if a file names the
site or carries an address, and `apps/api/tests/import-no-outbound.test.js` if
an import makes any request.

[ADR 0015](docs/adr/0015-importing-listed-events.md) records why it works this
way, and [docs/development.md](docs/development.md) how to try it locally.

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
`test:e2e:sweep`, `test:e2e:detail` and `test:e2e:prod`. Every spec must be
collected by exactly one CI job, and `pnpm ci:check` refuses one that is not
(see [CONTRIBUTING.md](CONTRIBUTING.md#browser-specs)).

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

**The figures at `5eb42f4`**, as `pnpm verify:tests:fresh` counted them on
2026-09-30 in a clean copy of that commit, against a freshly migrated private
database with `REQUIRE_DATABASE=1`: **9,413** unit and integration cases across
407 files, none failed or skipped. A later commit that adds or removes a case
changes them; recount with the same command rather than trusting this line.
Browser cases, across seven Playwright configurations, are counted by their own
runs and never added to these: the last full run of all seven, against the tree
committed as `5eb42f4`, collected and passed 473
([`docs/PHASE4_FEATURE_COMPLETION_REPORT.md`](docs/PHASE4_FEATURE_COMPLETION_REPORT.md),
"Tests").

## Documentation

Start with the one that matches what you are doing.

### Where the project stands

| Document                                                                                 | Contents                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [PHASE2_STATUS.md](PHASE2_STATUS.md)                                                     | **Authoritative current status**: the twenty gates, in one table                                                                                                                    |
| [PHASE2_FINAL_CLOSEOUT_REPORT.md](PHASE2_FINAL_CLOSEOUT_REPORT.md)                       | The closeout cycle, its verification, and the one thing left                                                                                                                        |
| [PHASE2_REQUIREMENTS_TRACEABILITY.md](PHASE2_REQUIREMENTS_TRACEABILITY.md)               | Requirement → implementation → evidence, row by row                                                                                                                                 |
| [docs/PHASE4_FEATURE_COMPLETION_REPORT.md](docs/PHASE4_FEATURE_COMPLETION_REPORT.md)     | The feature-completion work: what each area built, its safeguards, and what is still limited                                                                                        |
| [docs/PHASE4_ONBOARDING_ANALYTICS_REPORT.md](docs/PHASE4_ONBOARDING_ANALYTICS_REPORT.md) | Organiser invitations, the website link, visit counts, full control of posted events and the import of listed events: what was built, what was checked and what needs your accounts |

### The system

| Document                                     | Contents                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------ |
| [docs/architecture.md](docs/architecture.md) | Request flow, the checkout and hold lifecycle, package graph, trust boundaries |
| [docs/DATA_MODEL.md](docs/DATA_MODEL.md)     | Where the schema encodes a decision: tenancy, money, seating, retention        |
| [docs/api.md](docs/api.md)                   | REST reference: auth, errors, pagination, every endpoint                       |
| [docs/PROVIDERS.md](docs/PROVIDERS.md)       | The four adapters, mock mode, webhook intake and dispatch                      |
| [docs/DECISIONS.md](docs/DECISIONS.md)       | The authoritative decision index, including decisions that live in code        |
| [docs/adr/](docs/adr/)                       | Architecture decision records, 0001 to 0015                                    |
| [docs/MEDIA.md](docs/MEDIA.md)               | Event pictures: upload, sanitising, storage, moderation and serving            |

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
| [docs/PHASE2_THREAT_MODEL.md](docs/PHASE2_THREAT_MODEL.md) | Assets, actors, fourteen attacks, and what is out of scope            |
| [docs/CHECK_IN.md](docs/CHECK_IN.md)                       | The door: credentials, idempotence, group passes, transfers           |
| [docs/UX.md](docs/UX.md)                                   | Screens, accessibility sweep, browser journeys counted honestly       |
| [docs/LOAD_AND_CAPACITY.md](docs/LOAD_AND_CAPACITY.md)     | What the load suite measures, and why it is not capacity              |

### Working here

| Document                                               | Contents                                                                            |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| [docs/development.md](docs/development.md)             | Day-to-day workflow: services, env vars, migrations, debugging, testing             |
| [docs/language-policy.md](docs/language-policy.md)     | The JavaScript-only policy and the exception process                                |
| [docs/BRANCH_PROTECTION.md](docs/BRANCH_PROTECTION.md) | What CI enforces, the run that proves it, and the one setting nobody here can apply |
| [CONTRIBUTING.md](CONTRIBUTING.md)                     | Branches, commits, the verify gate, definition of done                              |
