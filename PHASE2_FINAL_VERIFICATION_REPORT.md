# Phase 2 final verification report

> **Scope.** This is the account of the `3f5add0`…`e1b2069` cycle. A later cycle
> (`09a27cb`…`8661bbf`) reconciled the evidence and built the event lifecycle;
> its account is in `PHASE2_STATUS.md` §§2, 9 and 10.
> `PHASE2_STATUS.md` is the authoritative current record and is where the
> numbers below should be read against.

**Status: `PARTIAL`.** Phase 2 is not complete and this report does not claim
it is. Fourteen of the twenty completion gates remain unmet or partial, §9 lists
each one, and no work on Phase 3 has begun.

What this cycle did: reconciled the browser-exposure audit down to the last
agent, independently re-verified NF-15 and NF-16 against a clean
production build rather than against a claim, and built the venue and
venue-map vertical slice end to end — database, service, contract, API,
organiser screens, public page and twelve browser journeys.

|                                |                                                              |
| ------------------------------ | ------------------------------------------------------------ |
| Starting commit                | `3f5add0`                                                    |
| Last executable commit         | `e1b2069`                                                    |
| This report's commit           | `fe60872`                                                    |
| Final pushed HEAD              | the closing commit — §11                                     |
| Branch                         | `claude/desi-event-js-stack-gb4uqe`                          |
| Upstream                       | `origin/claude/desi-event-js-stack-gb4uqe`                   |
| Working tree                   | clean — §10                                                  |
| Audit agents reconciled        | **19 of 19** — §2                                            |
| NF-15 / NF-16 on a clean build | **no leak, 173 browser-deliverable files** — §3              |
| Unit, integration and database | **3,836 passed, 0 failed, 0 skipped**, 135 files             |
| Browser journeys               | **118** dev, **19** compiled build, **13** organiser         |
| Database checks                | **68/68** fresh, **19/19** populated-upgrade                 |
| Stripe test credentials        | **none supplied**                                            |
| Real Stripe operations         | **none, and none claimed** — `EXTERNAL VERIFICATION PENDING` |
| Production payments            | **disabled and technically unreachable**                     |

---

## 1. How the verifiers were run

The brief required that no verifier operate in the shared working tree. None
did.

Every verification agent ran in its own throwaway artefact — a `git worktree`
or a disposable clone — created from the same commit, and every one was removed
before the browser suites ran. Verifiers reported; they did not edit and they
did not push. The primary branch was written only by this session, in the
working tree, between verifier runs.

```
$ git worktree list
/home/user/desi-event.com  e1b2069 [claude/desi-event-js-stack-gb4uqe]
```

One worktree, the real one. Nothing left behind.

This mattered, and §8 records why: an earlier round of concurrent verifiers in
their own worktrees starved the machine and the browser suite failed with
`ERR_CONNECTION_REFUSED`. That was resource contention, not a passing test, and
it is written up as a failure.

## 2. The audit, reconciled to the last agent

Nineteen agents ran in workflow `wf_cd65607b-d6d`. Nine findings were
confirmed, six refuted. The remaining four were the question the brief asked to
be answered explicitly, and the answer is that they are not findings at all.

**The arithmetic.** Four audit agents surveyed four vectors and emitted
findings. Fifteen verify agents each took one finding and tried to refute it.
4 + 15 = 19. An audit agent produces claims, not verdicts, so it can be neither
confirmed nor refuted; the nine-and-six split describes the fifteen verifiers
and nothing else. There is no twentieth agent and no unclassified remainder.

| Agent                                  | Kind   | Disposition                            |
| -------------------------------------- | ------ | -------------------------------------- |
| `audit:import-graph`                   | audit  | emitted 2 findings (1 severity `none`) |
| `audit:built-chunks`                   | audit  | emitted 8 findings (1 severity `none`) |
| `audit:secrets`                        | audit  | emitted 3 findings (1 severity `none`) |
| `audit:guards`                         | audit  | emitted 5 findings                     |
| `verify:import-graph:env.js`           | verify | **CONFIRMED**                          |
| `verify:built-chunks:tokens.js`        | verify | **REFUTED**                            |
| `verify:built-chunks:password.js`      | verify | **CONFIRMED**                          |
| `verify:built-chunks:totp.js`          | verify | **REFUTED**                            |
| `verify:built-chunks:sessions.js`      | verify | **REFUTED**                            |
| `verify:built-chunks:throttle.js`      | verify | **CONFIRMED**                          |
| `verify:built-chunks:env.js`           | verify | **CONFIRMED**                          |
| `verify:built-chunks:capabilities.js`  | verify | **CONFIRMED**                          |
| `verify:secrets:env.js`                | verify | **CONFIRMED**                          |
| `verify:secrets:browser-bundle.js`     | verify | **CONFIRMED**                          |
| `verify:guards:browser-bundle.test.js` | verify | **CONFIRMED**                          |
| `verify:guards:browser-bundle.js`      | verify | **REFUTED**                            |
| `verify:guards:eslint.js`              | verify | **CONFIRMED**                          |
| `verify:guards:package.json`           | verify | **REFUTED**                            |
| `verify:guards:next.config.mjs`        | verify | **REFUTED**                            |

Three further audit claims carried severity `none` — an agent explicitly
reporting that it looked and found nothing. They were not sent to verification
because there was nothing to refute:

- `packages/auth/src/index.js` — the auth barrel had been reachable; it was
  fixed mid-session before the audit finished.
- `packages/db`, `packages/providers`, `apps/api` — verified absent from the
  client bundle in both builds.
- `apps/web/.next/static/**` — no secret or configuration _value_ reached the
  client bundle in any of the 17 files then present.

18 raw claims − 3 severity-`none` = 15 verified. The books balance.

**Every confirmed finding, and what closed it.**

| #   | Finding                                                                         | Fixing commit | Regression test                                                     | Clean-build proof                                                                            | Status    |
| --- | ------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------- |
| 1   | `packages/schemas/src/env.js` reachable from the browser import graph           | `3e9a327`     | `apps/web/src/lib/browser-bundle.test.js`                           | `DATABASE_URL` absent — §3                                                                   | **Fixed** |
| 2   | `packages/auth/src/password.js` (scrypt + tuning) compiled into a client chunk  | `3e9a327`     | `apps/web/src/lib/browser-bundle.test.js`                           | `scrypt`, `maxmem`, `keyLength` absent — §3                                                  | **Fixed** |
| 3   | `packages/auth/src/throttle.js` lockout thresholds in a client chunk            | `3e9a327`     | `apps/web/src/lib/browser-bundle.test.js`                           | `LOCKOUT_THRESHOLD` absent — §3                                                              | **Fixed** |
| 4   | `packages/schemas/src/env.js` still in the built bundle, guard did not cover it | `3e9a327`     | `apps/web/src/lib/browser-bundle.test.js` (`FORBIDDEN` entry added) | `JWT_SECRET`, `AUTH_SECRET` absent — §3                                                      | **Fixed** |
| 5   | `packages/permissions/src/capabilities.js` role tables in a client chunk        | `3e9a327`     | `apps/web/src/lib/browser-bundle.test.js`                           | `ORG_ROLE_GRANTS`, `PLATFORM_ROLE_CAPABILITIES` absent, `moderation:review` **present** — §3 | **Fixed** |
| 6   | Server env-validation module compiled into the client bundle (secrets vector)   | `3e9a327`     | `apps/web/src/lib/browser-bundle.test.js`                           | `PLACEHOLDER_SECRETS` absent — §3                                                            | **Fixed** |
| 7   | Guard's `FORBIDDEN` list had no entry for the server env schema                 | `3e9a327`     | `apps/web/src/lib/browser-bundle.test.js`                           | list now names it; §3 scan agrees                                                            | **Fixed** |
| 8   | Guard read only the first 200 bytes, so a docstring hid `'use client'`          | `62d3e66`     | `apps/web/src/lib/browser-bundle.test.js` — `declaresUseClient`     | the probe file that slipped past now fails it                                                | **Fixed** |
| 9   | No ESLint import-boundary rule anywhere in the monorepo                         | `a3fa449`     | `pnpm run lint`, which now fails on a forbidden import              | §4 — lint clean with the rule in force                                                       | **Fixed** |

Finding 5 carried a caveat from its verifier worth repeating: the capability
_names_ are legitimately client-side — the client renders "you cannot do this"
from them — while the table mapping names to roles is not. The fix removes the
table and keeps the names, and §3's scan asserts both directions.

The six refutations are recorded as refutations. Four described chains that do
not exist at `HEAD`; two described real leaks already fixed by an earlier commit
in the same session, which the claimant had measured against a stale build.

## 3. NF-15 and NF-16, verified independently from a clean build

Not from the guard's opinion, and not from the audit's claim. From the bytes.

```
$ rm -rf apps/web/.next .turbo apps/*/.turbo packages/*/.turbo
$ pnpm run build            # exit 0, 16.407s, 0 cached of 3 tasks
$ pnpm run bundle:scan      # exit 0
```

`scripts/scan-browser-bundle.mjs` — added this cycle, commit `02747f4` — reads
every file the browser can fetch and searches it for markers of code that must
never leave the server.

```
browser-deliverable files scanned: 173
    22  .next/static  (served at /_next/static)
     0  public  (served at the site root)
   151  .next/server/app  (prerendered payloads and HTML sent to the browser)
  source maps: 16
  service workers: none present
```

That covers every browser-deliverable chunk, every route chunk, the build
manifests, the prerendered RSC payloads, the static HTML, the CSS, and the
sixteen source maps the build emits. There is no service worker and no PWA
artefact in this application; the scan says so rather than passing silently.
`public/` holds no textual asset.

**Absent, every one** (the scan's own wording, abbreviated here):

| Group                                | Markers checked                                                                                                                                                                    |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NF-15 credential primitives          | `scrypt`, `promisify`, `timingSafeEqual`, `maxmem`, `keyLength`, `REPLAY_WINDOW`, `deriveSealingKey`, `LOCKOUT_THRESHOLD`, `pseudonymize`, `STEP_UP_WINDOWS`, `REVOCATION_REASONS` |
| NF-16 environment contract           | `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `AUTH_SECRET`, `PLACEHOLDER_SECRETS`, `isInsecureJwtSecret`, `INSECURE_JWT_SECRETS`, `SECURE_COOKIES`                                   |
| Fee settings and operational limits  | `PLATFORM_FEE_BPS`, `PLATFORM_FEE_FLAT_CENTS`, `TICKET_HOLD_TTL_SECONDS`, `ALLOW_DEMO_TAX_IN_PRODUCTION`                                                                           |
| Job definitions                      | `QUEUE_NAMES`, `JOB_NAMES`, `expire-holds`, `issue-tickets`                                                                                                                        |
| Permission tables                    | `ORG_ROLE_GRANTS`, `PLATFORM_ROLE_CAPABILITIES`, `ORG_ROLE_INHERITS`, `findRoleCycle`, `resolveAll`, `PLATFORM_ONLY_CAPABILITIES`                                                  |
| Database, provider, ledger internals | `PrismaClient`, `@prisma/adapter-pg`, `LEDGER_ACCOUNTS`, the Stripe secret-key prefix, the Stripe webhook-secret prefix                                                            |

**Present, as they must be.** A scan that only forbade things could be satisfied
by shipping an empty application, so the legitimate strings are asserted too:

| String                   | Files |
| ------------------------ | ----: |
| `moderation:review`      |     1 |
| `/v1/organizers`         |     1 |
| `/v1/venues`             |     3 |
| `/v1/auth/login`         |     2 |
| `/v1/venue-map-versions` |     2 |
| `x-desi-csrf`            |     4 |
| `STEP_FREE_ENTRANCE`     |     2 |

One capability name deliberately is **not** required: `venue:manage`. It appears
in the server render and never reaches the browser, which is correct.
Demanding it would be demanding a leak. The script says so in its own comments,
so the next reader does not "fix" it.

Authentication fallback logic, the placeholder-secret blocklist, the fee
settings and the job definitions are all absent from every browser-deliverable
file. The server-only permission tables are absent; the capability names they
key are present.

## 4. Baselines, from a clean checkout of the starting commit

Run before any of this cycle's work, in a disposable clone at `3f5add0`:

| Command                      | Result at `3f5add0`                                                                                                                 |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm run policy:check`      | OK — 424 files, no violations                                                                                                       |
| `pnpm run secrets:scan`      | OK — 423 files, nothing credential-shaped                                                                                           |
| `pnpm run format:check`      | **FAILED** — 14 files. Fixed in `10ab0d3`                                                                                           |
| `pnpm run lint`              | OK                                                                                                                                  |
| `pnpm run contract:check`    | OK — 54 routes, 54 operations, 48 paths                                                                                             |
| `pnpm run test`              | OK                                                                                                                                  |
| `pnpm run build`             | OK — 3 tasks, 0 cached, 13.9s                                                                                                       |
| `pnpm run db:verify:fresh`   | OK — 68/68                                                                                                                          |
| `pnpm run db:verify:upgrade` | OK — 18/18                                                                                                                          |
| `pnpm run test:e2e`          | OK — 105 passed                                                                                                                     |
| `pnpm run test:e2e:prod`     | **FAILED** — `/organizers/nobody` expected a 404 and now gets a 200, because the route exists. Fixed in `4c07ee3`; re-run 19 passed |

Two honest notes about that clean checkout. It had no `DATABASE_URL`, because
`.env` is gitignored — an environment gap, not a repository defect, and the
database-backed suites were run against the designated disposable test database
instead. And one command in the first pass was mistyped: `lang:check` does not
exist; the language policy check is `policy:check`. It was re-run correctly and
the mistake is recorded rather than quietly dropped.

## 5. The venue and venue-map slice

**Database and service.** Commit `98dd142`. A layout is authored whole: a
single `PUT` replaces the entire graph, and the ordering is the guarantee —
`validateLayout` is a pure function over the payload and runs _before_ any
transaction opens, so a layout that fails never touches a row. Only once it is
known good does the write begin, inside one transaction, behind a conditional
`UPDATE` on `(id, revision, publishedAt IS NULL)` whose affected-row count is
compared to 1.

Twenty-four issue codes cover duplicate identities, invalid accessible and
companion relationships, cross-map references, orphans, cycles and unknown
price-zone references. `companionCycles()` returns the actual loop, so the
editor can point at it.

`plpgsql BEFORE` triggers on every layout table enforce what application code
cannot be trusted with: a published version's seats, rows, sections and price
zones cannot be inserted, changed or removed; a version cannot be un-published
or re-dated; a revision cannot move backwards even on a draft. **No existing
trigger was weakened to make an application test pass** — the teardown in
`apps/web/e2e/support/seed-organizer.mjs` instead declines to attempt deletes
the database is right to refuse, and says why.

**Contract and API.** Twelve venue routes, every one in the route registry and
therefore in the published OpenAPI artefact — a route cannot exist in this
codebase without being in the contract.

```
GET    /v1/venues                             auth=optional
GET    /v1/venues/slug/:slug                  auth=none
GET    /v1/venues/:id                         auth=optional
POST   /v1/venues                             auth=session
PATCH  /v1/venues/:id                         auth=session
POST   /v1/venues/:id/merge                   auth=session  cap=platform:admin
GET    /v1/venues/:id/maps                    auth=session
POST   /v1/venues/:id/maps                    auth=session
POST   /v1/venue-maps/:id/versions            auth=session
GET    /v1/venue-map-versions/:id             auth=session
PUT    /v1/venue-map-versions/:id/layout      auth=session
POST   /v1/venue-map-versions/:id/publish     auth=session
```

There are no per-seat CRUD endpoints, deliberately. Publishing is its own
explicit transition; a generic `PATCH` cannot reach it, and there is a test
that says so.

```
$ pnpm run contract:check          # exit 0
✓ API contract is valid: 61 routes, 61 OpenAPI operations, 54 paths.
✓ apps/api/openapi.json is up to date with the route contract.
```

The committed artefact was regenerated explicitly with `pnpm run openapi:emit`
and the check verifies it without rewriting — `--check` compares and fails,
it does not silently fix.

**Database and service tests.** 35 in `apps/api/tests/venue-maps.test.js` and 15
in `apps/api/tests/venue-map-integration.test.js`, covering immutability,
cloning, historical references, organisation scope, shared venues, duplicate
identities, stale revisions, partial-write rollback ("leaves the prior draft
row-for-row unchanged when validation fails") and concurrent publication ("lets
exactly one of two concurrent publishes win").

**Organiser screens.** Commits `a3fa449` and `71a3b8e`. Venue list, venue
create and edit, map list with version history, the visual map editor, the
list-view alternative, validation summary, preview, publish-confirmation
dialog, clone action.

The editor's shaping decision: **the list is not the fallback.** A drag-and-drop
canvas with an "accessible alternative" bolted on produces two editors, one of
which is always behind. So the structure is a tree of real controls — each
section, row and seat a button in the tab order with a name a screen reader can
read — and the plan view is a second presentation of that same tree. Both views
drive the same state and the same keyboard model, so neither can drift. Arrow
keys move between seats with a roving tabindex; Enter selects; every structural
action is a button, never a gesture.

Saving is explicit rather than automatic, and that is a deliberate choice
recorded as one: an autosave racing another author would produce the revision
conflict silently and repeatedly. The loaded revision goes with every save and a
stale one is reported as somebody else's work, never overwritten. **Draft
autosave is therefore not implemented**; §9 counts it as outstanding rather than
claiming the explicit save satisfies it.

**Public page.** Commit `ef5f03d`. Address, directions, IANA time zone,
policies, fifteen structured accessibility claims, upcoming events, canonical
metadata and structured data, meaningful server-rendered content, and correct
behaviour with scripting off — asserted by journey 11, which loads the page in a
context with JavaScript disabled.

## 6. The twelve browser journeys

`apps/web/e2e/organizer-venue-maps.spec.js`, run by
`playwright.organizer.config.js` against a live API, PostgreSQL and Redis.
Thirteen test cases across the twelve journeys.

| #    | Journey                                                  | Result |
| ---- | -------------------------------------------------------- | ------ |
| 1    | organiser creates a private venue                        | pass   |
| 2    | organiser authors a valid reserved-seat map              | pass   |
| 2    | …and previews it as a buyer will meet it                 | pass   |
| 3    | keyboard-only user creates and edits seats               | pass   |
| 4    | invalid whole-layout save writes nothing                 | pass   |
| 5    | organiser cannot edit another organisation's venue       | pass   |
| 6    | shared venue selectable, not editable                    | pass   |
| 6    | …and publicly readable, which is how an event selects it | pass   |
| 7–10 | publish, freeze, clone, and history                      | pass   |
| 11   | public venue page renders without JavaScript             | pass   |
| 12   | usable at tablet width                                   | pass   |
| 12   | usable on a phone                                        | pass   |
| 12   | respects reduced motion, nothing permanently invisible   | pass   |

The suite signs in once and keeps the window open for the whole run. A saved
`storageState` does not work here and the reason is a feature: sessions rotate
on privilege change (NF-09, NF-10), so a snapshot is unauthenticated minutes
later. Rather than turn rotation off, the suite does what a person does.

It goes _through_ the second factor, not around it. `EVENT_MANAGER` is a
privileged organisation role and NF-12 requires a confirmed factor before any
guarded route, so the seed creates a real sealed TOTP factor and the journey
types a real code. Exempting the route, or seeding a session that skipped the
check, would have tested a system nobody runs.

## 7. Every command, exit code and duration

Services up throughout: PostgreSQL 16.13 on `127.0.0.1:5432` (`accepting
connections`), Redis 7.0.15 on `127.0.0.1:6379` (`PONG`). Node v22.22.2,
pnpm 10.33.0.

| Command                       | Exit | Duration | Result                                                     | Cache                                     |
| ----------------------------- | ---: | -------- | ---------------------------------------------------------- | ----------------------------------------- |
| `pnpm run verify`             |    0 | 1m40.8s  | policy, secrets, format, lint, 3,836 tests, build          | cold — `.turbo` and `.next` deleted first |
| ├ `policy:check`              |    0 | —        | OK — 454 files                                             | n/a                                       |
| ├ `secrets:scan`              |    0 | —        | OK — 453 files                                             | n/a                                       |
| ├ `format:check`              |    0 | —        | all files Prettier-clean                                   | n/a                                       |
| ├ `lint`                      |    0 | —        | no problems                                                | n/a                                       |
| ├ `test`                      |    0 | 1m3.3s   | **3,836 passed, 0 failed, 0 skipped**, 135 files, 16 tasks | 0 of 16 cached                            |
| └ `build`                     |    0 | 16.4s    | 3 tasks                                                    | 0 of 3 cached                             |
| `pnpm run bundle:scan`        |    0 | —        | 173 browser-deliverable files, nothing server-only         | n/a                                       |
| `pnpm run contract:check`     |    0 | 2.1s     | 61 routes, 61 operations, 54 paths; artefact current       | n/a                                       |
| `pnpm run db:verify:fresh`    |    0 | 12.5s    | **68/68**, disposable database destroyed                   | n/a                                       |
| `pnpm run db:verify:upgrade`  |    0 | 4.0s     | **19/19**, both disposable databases destroyed             | n/a                                       |
| `pnpm run test:e2e`           |    0 | 1m35.6s  | **118 passed**                                             | n/a                                       |
| `pnpm run test:e2e:prod`      |    0 | 12.9s    | **19 passed**                                              | n/a                                       |
| `pnpm run test:e2e:organizer` |    0 | 34.0s    | **13 passed**                                              | n/a                                       |

Per-workspace test totals: `api` 534, `permissions` 557, `schemas` 542,
`providers` 478, `auth` 353, `web` 292, `inventory` 291, `api-contract` 184,
`worker` 183, `pricing` 116, `db` 102, `ui` 97, `logger` 63, `ledger` 33,
`config` 11. Nothing skipped anywhere — Redis was running, so the worker's
Redis integration suite ran rather than skipping itself.

## 8. Failures, retries and their root causes

Recorded separately from the passing runs, because a failure that is summarised
away is a failure that happens again.

**`ERR_CONNECTION_REFUSED` was not a passing test.** Earlier in this cycle the
organiser browser suite failed with `ERR_CONNECTION_REFUSED` against the dev
server while several verification agents were building in their own worktrees.
Load average was 8.19 on a machine that idles near 0.5. The root cause was
resource contention: the Next dev server had not finished compiling by the time
Playwright connected, because the CPU was elsewhere. The correction was
isolation, not a retry policy — every worktree was removed, nothing else was
running, and the suite was re-run clean. That run passed 105/105 of the suite as
it then stood. The failed attempt, the diagnosis and the clean pass are three
separate facts and are recorded as three.

**`pnpm run test:e2e` failed once in the final round, and it was a real
defect.** The default Playwright config matches every `*.spec.js` under `e2e/`,
so it picked up the organiser journeys and ran them against a dev server with no
API behind it. Two failed, correctly — an organiser screen has no fallback
catalogue and must not invent one. Fixed in `e1b2069` by adding the spec to the
config's `testIgnore`, alongside the not-found specs that belong to the
production config for the same kind of reason. Re-run: 118 passed, exit 0. This
was not a flake and is not described as one.

**No other retry was needed.** Every other command in §7 passed on its first
attempt in the final round.

**Defects found and fixed while building, each by a failing test first.**

- `Alert` has no `danger` variant — it is `error`; `Badge` has `danger`. Every
  error alert written this cycle had been rendering as _informational_, with
  `role="status"` instead of `role="alert"`. Found by a browser journey, fixed
  in eight places.
- The focus wrappers around those alerts repeated `role="alert"`, which `Alert`
  already sets for urgent variants — two nested alert regions, announced twice.
  The wrappers are now focus targets and nothing more.
- `getByLabel('Address', { exact: true })` never matched, because a required
  field's accessible name carries "(required)". The fields were renamed to
  "Street address" and "Building, floor or unit" — clearer for everyone, not
  only for the test.
- "City" matched "Capacity" under substring matching.
- Every mutation returned 403: the CSRF token was not being echoed. `api-fetch.js`
  now reads the readable cookie and sets `x-desi-csrf`, which is the
  double-submit scheme working as designed.
- Still 403, for a different reason: `EVENT_MANAGER` is privileged and NF-12
  requires a factor. Fixed by seeding a real one.
- The code field never appeared, because the API answers **200** with
  `mfaRequired: true` — deliberately, since an error would separate "wrong
  password" from "right password, code needed", which is the distinction an
  attacker probes for. The form now reads the body, not the status.
- TOTP replay, login throttling and the per-IP rate limit each blocked repeated
  sign-ins. All three were right to. The suite signs in once instead.
- `loginAttempt` has no `userId` column — it is keyed by a pseudonymised email,
  which is the privacy property working. The teardown no longer pretends
  otherwise.
- The reduced-motion journey built a context with `reducedMotion: 'reduce'` and
  then asserted against the wrong page, so it had been passing without testing
  reduced motion at all. Now it uses the context it built.
- `@desi-event/auth` and `@desi-event/db` had been added as runtime
  `dependencies` of the web app for the E2E seed's benefit. They are
  `devDependencies` now; a deployment must not carry them.

## 9. What Phase 2 still requires

Phase 2 remains `PARTIAL`. The gates, restated against the current state:

| #   | Gate                                                                       | Status                                                                                                                    |
| --- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 1   | NF-06 fixed and proven                                                     | **MET**                                                                                                                   |
| 2   | Report inconsistencies reconciled                                          | **MET** — and the 19-agent audit too, §2                                                                                  |
| 3   | Organizer verification, public routes, venues, venue maps, event lifecycle | **PARTIAL** — organiser verification and the whole venue/venue-map slice are done; event lifecycle and moderation are not |
| 4   | GA and reserved inventory concurrency-safe                                 | **MET**                                                                                                                   |
| 5   | Attendee completes mock checkout through order, payment, ledger, tickets   | **PARTIAL** — general admission end to end; no seated order is bought end to end                                          |
| 6   | Provider calls outside database transactions                               | **MET**                                                                                                                   |
| 7   | Timeouts enter durable reconciliation and can be resolved safely           | **PARTIAL** — they enter it; nothing can resolve it                                                                       |
| 8   | Full and partial refunds, no over-refund                                   | **NOT MET** — database ceilings exist; no refund service                                                                  |
| 9   | Dispute, transfer, payout state machines in mock mode                      | **NOT MET**                                                                                                               |
| 10  | Every completed commerce action posts balanced protected ledger entries    | **PARTIAL** — true for a paid order                                                                                       |
| 11  | Ticket transfer, revocation, check-in concurrency-safe                     | **NOT MET**                                                                                                               |
| 12  | Notifications use an idempotent outbox                                     | **NOT MET** — table exists, nothing writes it                                                                             |
| 13  | Organizer and operations dashboards                                        | **NOT MET** — the venue screens are the first authenticated surface; no dashboard                                         |
| 14  | Phase 2 UI passes accessibility and responsive tests                       | **PARTIAL** — the venue and map screens do, at three widths and with reduced motion; the rest do not exist                |
| 15  | All 20 required E2E journeys pass                                          | **PARTIAL** — the twelve venue journeys pass, plus 118 + 19 carried; the other eight do not exist                         |
| 16  | Load and reliability tests exist                                           | **NOT MET**                                                                                                               |
| 17  | CI enforces the Phase 2 gates                                              | **NOT MET** — no workflow                                                                                                 |
| 18  | All required documentation complete                                        | **NOT MET**                                                                                                               |
| 19  | Production payments technically disabled                                   | **MET**                                                                                                                   |
| 20  | All code-owned checks pass, committed, pushed, clean tree                  | **MET** — §7, §10                                                                                                         |

Six met, six partial, eight not met. Also outstanding within the venue slice
itself: **draft autosave**, deliberately not built (§5), and the NF-15 follow-up
that would extend the artefact scan to the worker and API bundles as well as the
web one.

Stripe remains `EXTERNAL VERIFICATION PENDING`. No credentials were supplied,
none were requested as a blocker, and no Stripe object ID, screenshot, CLI
output, refund, transfer or payout has been fabricated anywhere in this report.

**Phase 3 has not been started.**

## 10. Commits, push and tree state

This cycle, from `3f5add0`:

```
10ab0d3  style: format the files this session added
4c07ee3  test(web): correct the not-found expectation for /organizers, which now has a route
98dd142  feat(venue-maps): author a seating layout whole, publish it once, clone it after
ef5f03d  feat(web): public venue page, with accessibility as fifteen claims
a3fa449  feat(web): the authenticated organiser area, and the seating-map editor
71a3b8e  feat(web): venue authoring end to end, and the browser journeys that prove it
02747f4  test(security): scan the built bundle for server-only code, not just the imports
e1b2069  fix(web): keep the organiser journeys out of the API-down browser suite
```

69 files changed, 11,888 insertions, 421 deletions. Security work and venue work
are in separate commits; nothing was combined for convenience. No history was
rewritten, squashed or force-pushed. No secret, local database, personal data,
provider payload or build cache was committed.

No secret, local database, personal data, provider payload or build cache was
committed.

## 11. Closing state

`fe60872` — the commit carrying this report — was pushed and verified:

```
$ git push -u origin claude/desi-event-js-stack-gb4uqe
   71a3b8e..fe60872  claude/desi-event-js-stack-gb4uqe -> claude/desi-event-js-stack-gb4uqe

$ git rev-parse HEAD && git rev-parse @{u}
fe6087236162dc3ab3f81c082f99be8337b25816
fe6087236162dc3ab3f81c082f99be8337b25816

$ git status --porcelain
(no output)
```

HEAD equalled upstream and the working tree was clean.

One commit sits above `fe60872`: the one that adds this section, pushed
immediately after it, and it is the final pushed HEAD of this cycle. A file
cannot contain the hash of the commit that introduces it, so the check that
matters is the property rather than the number — after that push, `git rev-parse
HEAD` and `git rev-parse @{u}` agree and `git status --porcelain` is silent. The
branch is `claude/desi-event-js-stack-gb4uqe`, its upstream is
`origin/claude/desi-event-js-stack-gb4uqe`, every commit of this cycle is
pushed, and no history was rewritten, squashed or force-pushed to get there.
