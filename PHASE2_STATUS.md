# Phase 2 status — the authoritative current record

**Status: `PARTIAL`.** Phase 3 has not been started.

### Four different "current" facts, kept apart on purpose

They are not the same commit and never have been. Treating them as one is
exactly how the run tally in this file came to be wrong twice, so they are now
stated separately and each says what it is a fact _about_.

| What                                         | Value                                                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Commit §1's measurements were taken at       | **`6eb6030`** — unchanged. §1 is measured there and nowhere else                                              |
| Commit the coverage figures were measured at | **`79ff795`** — cold run, `Tasks: 18 successful, 18 total`, exit 0                                            |
| Latest corrective commit                     | **`354e66f`** — documentation only; the executable-code fix preceding it is **`79ff795`**                     |
| Latest GitHub Actions run                    | **`35127103320`**, testing exactly `354e66f` — **8 jobs, all `success`**, 137 steps `success`, 8 skipped      |
| Repository protection state                  | **UNPROTECTED.** `GET /rulesets` → `200 []`; `GET /branches/main/protection` → `403`. Re-queried at `354e66f` |

`79ff795..354e66f` changes four Markdown files and nothing else, so the coverage
figures measured at `79ff795` describe the executable code at the current HEAD.

> **`HISTORICAL STATUS — SUPERSEDED`** — an earlier revision of this header said
> only "As of `6eb6030`" and named run `35115541656` as the current run. Both
> statements were true when written and are left standing above in the table,
> reattributed to the commit each is actually a fact about, rather than deleted.

**Nineteen of the twenty gates are `MET`. One is `PARTIAL`. None is
`NOT MET`.** Gates 13 and 14 closed in the closeout cycle; gate 17 did not, and
the reason is not code. A real workflow run exists and all eight of its jobs
pass — and **nothing on GitHub requires them before a merge.** Configuring that
needs write access to the repository's protection settings, which this session's
outbound proxy refuses regardless of the token's permissions. See §5,
`docs/BRANCH_PROTECTION.md` for the exact JSON, and
`PHASE2_POST_CLOSEOUT_VERIFICATION.md` for the API responses recorded verbatim.

Phase 2 therefore stays `PARTIAL`, the exit rule requires all twenty, and the
one remaining item is an external configuration action rather than work in the
tree.

This document is the single current-status record for Phase 2. Where it
disagrees with any other file in this repository, this one is right and the
other is historical.

The other four Phase 2 documents remain, and remain useful, but they are
_accounts of cycles_ rather than statements of the present. Each records what a
particular cycle did and what was true when it was written. Sections of them
that time has overtaken are marked `HISTORICAL STATUS — SUPERSEDED` and point
here. Nothing in them has been rewritten, because a report that quietly
rewrites what it said last time is not a record.

| Document                              | What it is                                                          |
| ------------------------------------- | ------------------------------------------------------------------- |
| `PHASE2_STATUS.md`                    | **This file. Current status. Authoritative.**                       |
| `PHASE2_IMPLEMENTATION_REPORT.md`     | Account of the `7777322`…`926d1a3` cycle                            |
| `PHASE2_COMPLETION_REPORT.md`         | Account of the `e93d4e9`…`b37b242` cycle, plus the gate scoring     |
| `PHASE2_REQUIREMENTS_TRACEABILITY.md` | Requirement → implementation → evidence matrix, kept current        |
| `PHASE2_FINAL_VERIFICATION_REPORT.md` | Account of the `3f5add0`…`e1b2069` cycle and its verification       |
| `PHASE2_COMMERCE_CYCLE_REPORT.md`     | Account of the `cfb654c`…`910538b` cycle and its verification       |
| `PHASE2_FINAL_CLOSEOUT_REPORT.md`     | Account of the `66495c0`…`6eb6030` closeout cycle, and its evidence |
| `docs/ADVERSARIAL_REVIEW_FINDINGS.md` | The 34-finding review and the 19-agent browser-exposure audit       |

---

## 1. Repository state

Measured, not recalled, **at `6eb6030`** — one commit, every row. Each value is
the output of the command named beside it.

A file cannot contain the hash of the commit that edits it, so §13 records the
final pushed HEAD after this document's own commit, and the rule is that §1 is
always re-measured at the commit named in this paragraph.

| Fact                        | Value                                                | Command                                |
| --------------------------- | ---------------------------------------------------- | -------------------------------------- |
| Branch                      | `claude/desi-event-js-stack-gb4uqe`                  | `git rev-parse --abbrev-ref HEAD`      |
| Local HEAD                  | `6eb6030b2895078ee64c720e1552a5420e7970b9`           | `git rev-parse HEAD`                   |
| Upstream ref                | `origin/claude/desi-event-js-stack-gb4uqe`           | `git rev-parse --abbrev-ref @{u}`      |
| Upstream HEAD               | `6eb6030b2895078ee64c720e1552a5420e7970b9`           | `git rev-parse @{u}` after `git fetch` |
| Local equals upstream       | **yes**                                              | the two hashes above                   |
| Working tree                | **clean** — `git status --porcelain` printed nothing | `git status --porcelain`               |
| Worktrees                   | one, the repository itself                           | `git worktree list`                    |
| Last executable-code commit | `6eb6030`                                            | see below                              |
| Pull request                | #1, open against `main`                              | GitHub API                             |
| Latest workflow run         | `35115541656` — 8 jobs, all `success` (at `6eb6030`) | GitHub API                             |

**The closeout cycle.** Fourteen code commits from `66495c0` to `6eb6030`.
Newest first:

| Commit    | What it changed                                                             | Code? |
| --------- | --------------------------------------------------------------------------- | ----- |
| `6eb6030` | The four refund and transfer commands a screen calls and no test did        | yes   |
| `c5e98da` | The four detail specs joined the public suite; the branch-protection record | yes   |
| `bdefff9` | Four behaviour suites, a zero-test guard, a seventh browser job             | yes   |
| `cd1544a` | Fourteen bundle needles and seven contract properties                       | yes   |
| `fc3f15a` | The sweep over five new surfaces, and the `dl` it found broken              | yes   |
| `33eeea9` | `tickets.get`, and the ticket, transfer and invitation screens              | yes   |
| `d48e18a` | The refund detail screen, and the organisation a refund names               | yes   |
| `aef9332` | The reconciliation detail screen and its five commands                      | yes   |
| `d7435a7` | Reconciliation evidence projected onto an allow list                        | yes   |
| `7ce0a72` | The organiser analytics screen and the five page states                     | yes   |
| `759e00a` | The money branch gated on capability **and** a fresh factor                 | yes   |
| `699715a` | The Prisma stub honours relation selects                                    | yes   |
| `d71d60f` | The `analytics` tag the new routes carry                                    | yes   |
| `66495c0` | Organiser analytics, and the five-second clock failing two gates            | yes   |

**The commerce cycle.** Twenty commits from `cfb654c` to `910538b`, 164 files
changed, 74 files added, +42,106 / −3,323 lines. Newest first:

| Commit    | What it changed                                                       | Code? |
| --------- | --------------------------------------------------------------------- | ----- |
| `910538b` | One catalogue snapshot, because another suite published mid-assertion | yes   |
| `7d73fd1` | The suppressibility list, the writers that ignored it, coverage in CI | yes   |
| `a02eb2f` | The fifteen named documents                                           | no    |
| `8e84654` | NF-05, NF-11, NF-12 and NF-23 re-checked across every new surface     | yes   |
| `11b0c11` | CI asserts correctness under contention on every push                 | yes   |
| `9d95eea` | The load suite, and the three defects it found                        | yes   |
| `b33682e` | The dashboard shell's capability check, and two WCAG failures         | yes   |
| `e1f19ae` | The finance view, the operations board, the CSV export                | yes   |
| `962385e` | Ticket transfer, revocation, and admission exactly once               | yes   |
| `97d6918` | Payouts, transfers and disputes, and a balance nobody can overdraw    | yes   |
| `351baae` | The reconciliation queue and its six operator actions                 | yes   |
| `b53c8ad` | Refunds: four steps, five refusals, twelve races                      | yes   |
| `cb735e6` | A handler may choose a status the contract does not declare           | yes   |
| `e202ced` | Partial refunds in the mock, receipts stamped as a demonstration      | yes   |
| `192c694` | The accessibility scanner, and four contrast failures                 | yes   |
| `38f839c` | A build that skips a test stops reading as a build that passed        | yes   |
| `e840102` | The four refusals, walked in a browser                                | yes   |
| `a47e19d` | The notification outbox worker                                        | yes   |
| `54b13b6` | A reserved seat is priced by the seat, not by the tier                | yes   |
| `cfb654c` | The lifecycle enums the commerce services stand on                    | yes   |

**Last executable-code commit.** `6eb6030` is HEAD and it changes a `.js` file,
so the two coincide. The closeout cycle has no documentation-only commit before
the one adding this revision; `a02eb2f` was the commerce cycle's.

**Scale at this commit:**

| Thing                         |     Count |
| ----------------------------- | --------: |
| API routes in the contract    |       118 |
| OpenAPI operations / paths    | 118 / 106 |
| Prisma models                 |        49 |
| Enums                         |        36 |
| plpgsql triggers              |        20 |
| CHECK constraints             |        34 |
| Migrations                    |        12 |
| Unit and integration tests    |     4,642 |
| Browser cases (seven configs) |       242 |

Three routes are new this cycle — `analytics.summary`, `analytics.export` and
`tickets.get` — and the schema is untouched, so models, enums, triggers,
constraints and migrations are the commerce cycle's figures re-measured rather
than restated. The two totals are never added together and never will be: one
counts assertions in a process, the other counts pages driven in a browser.

**Services and toolchain**, as the verification ran against them:

| Thing      | Version                                        | Command                   |
| ---------- | ---------------------------------------------- | ------------------------- |
| Node       | `v22.22.2`                                     | `node --version`          |
| pnpm       | `10.33.0`                                      | `pnpm --version`          |
| PostgreSQL | 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1), running | `pg_isready`, `psql -V`   |
| Redis      | 7.0.15, running                                | `redis-cli ping` → `PONG` |

Neither service was running when the closeout cycle began — the container had
restarted — and both were started before anything was measured. That is
environmental rather than a finding, and it is recorded because a verification
that began against a database that was not there would have produced skips
reported as passes.

---

## 2. Reconciliation of disputed numbers

> **HISTORICAL — settled at `09a27cb`.** This section records a disagreement
> between earlier reports about six numbers, and how each was resolved against a
> reproducible command. It is kept because the resolutions are still the
> authority on what those earlier reports meant. The _current_ figures are in
> §6 and §9; where they differ from anything below, the difference is the six
> cycles of work between then and now.

Six discrepancies were raised. Each is settled below against a command whose
output anybody can reproduce.

### 2.1 3,951 versus 3,836 unit and integration tests

**The authoritative number is 3,836**, from a cold run at `a949cb7` with
PostgreSQL and Redis up:

```
$ rm -rf .turbo apps/*/.turbo packages/*/.turbo apps/web/.next
$ pnpm run test
 Tasks:    16 successful, 16 total
Cached:    0 cached, 16 total
  Time:    1m0.339s
```

| Workspace                  |   Files |     Tests |
| -------------------------- | ------: | --------: |
| `@desi-event/permissions`  |       3 |       557 |
| `@desi-event/schemas`      |      10 |       542 |
| `@desi-event/api`          |      27 |       534 |
| `@desi-event/providers`    |      12 |       478 |
| `@desi-event/auth`         |       7 |       353 |
| `@desi-event/web`          |      21 |       292 |
| `@desi-event/inventory`    |       8 |       291 |
| `@desi-event/api-contract` |       7 |       184 |
| `@desi-event/worker`       |      14 |       183 |
| `@desi-event/pricing`      |       5 |       116 |
| `@desi-event/db`           |       3 |       102 |
| `@desi-event/ui`           |      12 |        97 |
| `@desi-event/logger`       |       4 |        63 |
| `@desi-event/ledger`       |       1 |        33 |
| `@desi-event/config`       |       1 |        11 |
| **Total**                  | **135** | **3,836** |

**3,951 has no provenance that can be reproduced here.** The string does not
appear in any file in the repository, and no run log in this workspace — every
`*.log` under the session scratchpad was summed — produces it. The highest unit
total any log records is 3,836; the previous cycle's baseline at `3f5add0`
records 3,731.

The nearest defensible arithmetic is **3,836 unit + 118 development browser =
3,954**, which is three away and is a different kind of number anyway: mixing
unit tests and browser journeys into one figure is what made this ambiguous.
That sum is offered as the likely origin, not asserted as the fact.

This repository has corrected a phantom total before — `PHASE2_COMPLETION_REPORT.md`
§2 records that "the 2,769 figure had no provenance". The same discipline applies
here: **the unit and integration total is 3,836, and browser journeys are counted
separately and never added to it.**

### 2.2 105 versus 118 development browser tests

Both are correct, at different commits. The suite grew.

| Commit    | `pnpm run test:e2e` | Composition                                     |
| --------- | ------------------: | ----------------------------------------------- |
| `3f5add0` |                 105 | 6 spec files; `venue.spec.js` did not exist yet |
| `a949cb7` |                 118 | 7 spec files                                    |

Verified by listing rather than inferring:

```
$ pnpm exec playwright test --list
Total: 118 tests in 7 files
```

| Spec file                |   Tests |
| ------------------------ | ------: |
| `accessibility.spec.js`  |      52 |
| `reduced-motion.spec.js` |      30 |
| `filter-focus.spec.js`   |      10 |
| `venue.spec.js`          |       8 |
| `filters.spec.js`        |       7 |
| `organizer.spec.js`      |       6 |
| `journey.spec.js`        |       5 |
| **Total**                | **118** |

The +13 delta is `venue.spec.js` (+8, a new file introduced by `ef5f03d`) and
five tests added to the pre-existing files for the venue page.

### 2.3 Twelve venue journeys versus thirteen organiser tests

Both are correct; they count different things.

- **Twelve** is the number of _named journeys_ the brief required, numbered 1
  to 12 in the `describe` titles of `apps/web/e2e/organizer-venue-maps.spec.js`.
- **Thirteen** is the number of _Playwright test cases_ that implement them.

Three `describe` blocks hold more than one `test`, and two journey numbers share
one block:

| Journey(s)      | `describe` title                                 | Test cases |
| --------------- | ------------------------------------------------ | ---------: |
| 1               | an organiser creates a private venue             |          1 |
| 2               | an organiser authors a valid reserved-seat map   |          2 |
| 3               | a keyboard-only user creates and edits seats     |          1 |
| 4               | an invalid whole-layout save writes nothing      |          1 |
| 5               | organiser cannot edit another organisation venue |          1 |
| 6               | shared venue selectable, not editable            |          2 |
| 7, 8, 9, 10     | publish, freeze, clone, and history              |          1 |
| 11              | public venue page renders without JavaScript     |          1 |
| 12              | reduced motion and responsive behaviour          |          3 |
| **12 journeys** |                                                  |     **13** |

```
$ pnpm exec playwright test --list --config playwright.organizer.config.js
Total: 13 tests in 1 file
```

### 2.4 Are the thirteen organiser tests inside the 118?

**No.** They are three disjoint suites, and the configs prove it rather than
the prose:

| Suite                         | Config                            | Selection                                                     | Tests |
| ----------------------------- | --------------------------------- | ------------------------------------------------------------- | ----: |
| `pnpm run test:e2e`           | `playwright.config.js`            | all `*.spec.js` except `not-found` and `organizer-venue-maps` |   118 |
| `pnpm run test:e2e:prod`      | `playwright.production.config.js` | `not-found.spec.js` only                                      |    19 |
| `pnpm run test:e2e:organizer` | `playwright.organizer.config.js`  | `organizer-venue-maps.spec.js` only                           |    13 |

`testIgnore: ['**/not-found.spec.js', '**/organizer-venue-maps.spec.js']` in the
default config is the line that makes 118 and 13 disjoint. It was added in
`e1b2069`; **before that commit the three suites overlapped**, which is why the
run immediately preceding it reported "118 passed, 2 failed" — the organiser
spec was being run by a config that starts no API, its `beforeAll` sign-in
failed, and the other eleven of its thirteen cases were skipped rather than run.

**Total browser coverage is 118 + 19 + 13 = 150 test cases across three suites.**
Any single number smaller than 150 describes one suite, not the whole.

### 2.5 Which commits implement organiser verification

The traceability matrix previously attributed this to `3f5add0`. **That was
wrong** — `3f5add0` is the venue-records commit and touches no organiser file.
Corrected attribution, each line verified with `git log --diff-filter=A`:

| Component                                                                                                                                                                                                                                                                | Commit    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------- |
| `Organization.verificationStatus` column and enum (Phase 2 data model)                                                                                                                                                                                                   | `7777322` |
| State machine, audit trail, `apps/api/src/lib/verification.js`, `apps/api/src/routes/organizers.js`, `packages/schemas/src/verification.js`, migration `20260915120000_verification_revoked`, `apps/api/tests/organizers.test.js`, `apps/api/tests/verification.test.js` | `77b3040` |
| `toPublicOrganizer` allow-list presenter — the NF-14 fix                                                                                                                                                                                                                 | `33c78ff` |
| Public organiser page `/organizers/[slug]`, its unit test and `apps/web/e2e/organizer.spec.js`                                                                                                                                                                           | `b6cffb8` |

```
$ git log --oneline --diff-filter=A -- apps/api/src/routes/organizers.js
77b3040 feat(organizers): make verification a state machine with an audit trail

$ git show --name-only --format= 3f5add0 | grep -i organiz
(no output)
```

### 2.6 Historical versus current

Three passages in the existing reports describe a world that has moved on. They
are **not** rewritten; they are marked.

| Passage                                                      | Says                                                      | Actually                                                                                                          |
| ------------------------------------------------------------ | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `PHASE2_COMPLETION_REPORT.md` §9, the NF-10…NF-13 paragraphs | "open"                                                    | All four closed in `12ebd07`, `02e4571`, `51feced`. The section already says so immediately below the paragraphs. |
| `PHASE2_COMPLETION_REPORT.md` §14, third bullet              | "NF-10 through NF-13 were recorded, not fixed"            | Closed. Now marked `HISTORICAL STATUS — SUPERSEDED`.                                                              |
| `PHASE2_COMPLETION_REPORT.md` §15, item 5                    | "Fourteen of the sixteen required documents do not exist" | Twelve do not exist; four were written or updated. Now marked `HISTORICAL STATUS — SUPERSEDED`.                   |
| `PHASE2_IMPLEMENTATION_REPORT.md` §20                        | "3,449 tests"                                             | True at `926d1a3`. The document is an account of that cycle and carries a superseded banner at the top.           |

---

## 3. Status vocabulary

Used below with exactly these meanings and nothing softer.

| Status                          | Meaning                                                                   |
| ------------------------------- | ------------------------------------------------------------------------- |
| `AUTOMATICALLY TESTED`          | Implemented, and a test in this repository fails if it stops working.     |
| `IMPLEMENTED`                   | Code exists and is exercised, but no test asserts this specific property. |
| `API-TESTED ONLY`               | An API or database test refuses it. No browser performs the act itself.   |
| `MANUALLY TESTED`               | Exercised by hand, with the evidence recorded. No automated assertion.    |
| `DB-ENFORCED`                   | The database refuses the violation, proven by a probe that attempts it.   |
| `MOCK-ONLY`                     | Exercised only against a double. The real integration has never run.      |
| `EXTERNAL VERIFICATION PENDING` | Code complete; requires credentials this repository has never held.       |
| `SCHEMA ONLY`                   | Tables, constraints and enums exist. No code reads or writes them.        |
| `SEAM ONLY`                     | An injection point exists. Nothing is behind it.                          |
| `DISABLED`                      | Deliberately impossible, and something asserts it stays impossible.       |
| `CARRIED`                       | Delivered in Phase 1, still standing, not extended in Phase 2.            |
| `NOT IMPLEMENTED`               | Nothing was built.                                                        |

---

## 4. Findings NF-01 to NF-23

All twenty-three are closed. NF-04 to NF-16 were re-verified against the code
at `a949cb7`, not against the prose that claimed them; NF-17 to NF-21 were found
in the lifecycle cycle; NF-22 and NF-23 were found in this one.

| ID        | Finding                                                                                               | Closed in            | Evidence                                                                                                                                                                                               | Status                 |
| --------- | ----------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- |
| **NF-01** | A missing resource answered 404 with a body empty until hydration                                     | `9b3dab1`            | Every segment renders the shared not-found view itself; `apps/web/e2e/not-found.spec.js` holds both halves — 19 tests against a compiled build                                                         | `AUTOMATICALLY TESTED` |
| **NF-02** | The API could not start in any environment: the schema rejected its own output                        | `5c62ec3`            | `apps/api/tests/startup-safety.test.js` binds a port in a spawned process; `packages/schemas/src/env.test.js` parses an environment twice                                                              | `AUTOMATICALLY TESTED` |
| **NF-03** | `paymentStatusSchema` rejected `PENDING` and `TIMEOUT`; the drift guard restated the enums by hand    | `7777322`            | Both guards parse `schema.prisma` off disk; `packages/schemas/src/enums.test.js`                                                                                                                       | `AUTOMATICALLY TESTED` |
| **NF-04** | An `OrderItem` could reference a `TicketType` from a different event                                  | `7777322`            | Trigger `desi_order_item_event_matches` in `20260915020000_phase2_integrity_triggers/migration.sql`                                                                                                    | `DB-ENFORCED`          |
| **NF-05** | Capability guard asserted with no organisation scope                                                  | `3a2d4ff`            | `packages/api-contract/src/validate.js:211` refuses a scoped capability declared without a `capabilityScope`                                                                                           | `AUTOMATICALLY TESTED` |
| **NF-06** | `contract:check` could not see a stale OpenAPI artefact                                               | `0786fdf`, `6714f1a` | `apps/api/src/lib/openapi-artifact.js`; `build` runs `--check` and never writes; `apps/api/tests/openapi-artifact.test.js`                                                                             | `AUTOMATICALLY TESTED` |
| **NF-07** | `desi_hold_item_session_matches` had no probe                                                         | `289e4a0`            | Two probes in `packages/db/scripts/phase2-probes.mjs`, one per trigger branch, asserting the refusal messages                                                                                          | `DB-ENFORCED`          |
| **NF-08** | The other half of the capability-scope hole                                                           | `3a2d4ff`            | `validate.js:202-216` — the comment names the half that was left open                                                                                                                                  | `AUTOMATICALLY TESTED` |
| **NF-09** | Scheduled rotation locked out bearer clients                                                          | `b37b242`            | `apps/api/src/lib/sessions.js:127` — "A bearer caller is deliberately _not_ rotated"                                                                                                                   | `AUTOMATICALLY TESTED` |
| **NF-10** | Rotation claimed on every privilege change, delivered only on password change                         | `02e4571`            | `apps/api/src/lib/sessions.js` `rotateSession`, called from every privilege-changing route                                                                                                             | `AUTOMATICALLY TESTED` |
| **NF-11** | `requireStepUp` always used the module default window                                                 | `12ebd07`            | `apps/api/src/plugins/auth.js:495-506` — `stepUpWindowFor(policy)`, which throws on an unknown policy                                                                                                  | `AUTOMATICALLY TESTED` |
| **NF-12** | Step-up for a privileged account with no factor was a re-typed password                               | `51feced`            | `PRIVILEGED_ORG_ROLES` in `packages/auth/src/sessions.js`; `mfaExempt` in the route contract keeps enrolment reachable                                                                                 | `AUTOMATICALLY TESTED` |
| **NF-13** | Acyclicity check caught only reciprocal edges                                                         | `12ebd07`            | `packages/permissions/src/capabilities.js:324` `findRoleCycle` — depth-first, returns the loop                                                                                                         | `AUTOMATICALLY TESTED` |
| **NF-14** | Event detail served an organiser's contact address to anonymous callers                               | `33c78ff`            | `apps/api/src/lib/presenters.js:80` `toPublicOrganizer` — an allow-list, not a row                                                                                                                     | `AUTOMATICALLY TESTED` |
| **NF-15** | Platform password hashing reached the production client bundle                                        | `3e9a327`, `62d3e66` | `apps/web/src/lib/browser-bundle.js` import-graph guard; `pnpm run bundle:scan` finds `scrypt` absent from every browser-deliverable file — 173 at closure, **222** at `9be3c79`                       | `AUTOMATICALLY TESTED` |
| **NF-16** | The API and worker deployment contract shipped in the browser bundle                                  | `33f2d7d`, `a894258` | `pnpm run bundle:scan` finds `DATABASE_URL`, `JWT_SECRET`, `AUTH_SECRET`, `PLACEHOLDER_SECRETS` absent from all of them; NF-23 is the follow-up that found what the scan was not yet asked to look for | `AUTOMATICALLY TESTED` |
| **NF-17** | Creating an event accepted a caller-supplied `status`, skipping review                                | `8661bbf`            | `apps/api/tests/event-lifecycle.test.js` — "ignores a status the caller supplies"                                                                                                                      | `AUTOMATICALLY TESTED` |
| **NF-18** | The publish route wrote any of thirteen statuses with no transition check                             | `8661bbf`            | `packages/schemas/src/lifecycle.js` table; `apps/api/src/lib/event-lifecycle.js`; 34 + 20 + 11 tests                                                                                                   | `AUTOMATICALLY TESTED` |
| **NF-19** | Every pre-publication state was served to anonymous callers, `moderationNote` too                     | `8661bbf`            | Three fixtures in non-public states; `apps/api/tests/event-lifecycle.test.js` — "what a stranger may see"                                                                                              | `AUTOMATICALLY TESTED` |
| **NF-20** | A `TicketType` could name an `EventSession` from a different event                                    | `8661bbf`            | Trigger `desi_ticket_type_session_matches`; `apps/api/tests/event-lifecycle-integration.test.js`                                                                                                       | `DB-ENFORCED`          |
| **NF-21** | An `Event` could end before it started                                                                | `8661bbf`            | CHECK `event_ends_after_start`; same integration suite                                                                                                                                                 | `DB-ENFORCED`          |
| **NF-22** | The public event payload advertised ticket types the organiser was still holding back                 | `9be3c79`            | `toEventDetail(event, { includeDraftTiers })`; `apps/api/tests/events.test.js` — "does not advertise a ticket type the organiser is still holding back"                                                | `AUTOMATICALLY TESTED` |
| **NF-23** | The browser carried the shape of every private column, `contactEmail` and `payoutCurrency` among them | `9be3c79`            | `packages/api-contract/src/route-manifest.js`, generated and drift-checked; `pnpm run bundle:scan`; `apps/web/src/lib/browser-bundle.test.js` — "stops before the schemas the contract is built from"  | `AUTOMATICALLY TESTED` |

Full accounts of all twenty-three are in `docs/ADVERSARIAL_REVIEW_FINDINGS.md`.
NF-17 through NF-23 were each reproduced with a failing test or a failing scan
before being fixed, and those tests stay as regression cover.

**NF-23 is the NF-15/NF-16 follow-up, and it was found by looking rather than by
luck.** The brief for this cycle asked for a search of every browser-deliverable
artefact for private organiser data. Adding `contactEmail` and `payoutCurrency`
to the scan's needles turned two clean builds red: the API client was importing
the contract's route table to ask whether a route takes a body, and the route
table holds every request and response schema. The values were never in the
bundle. The description of every column was, in every production build, since
before NF-14 named those two fields as private.

The temptation was to delete the needle, since a field _name_ is not a
credential and the OpenAPI document is published anyway. That would have been
weakening the test to get a green result. The client reads a generated manifest
now — id, method, path, auth, and two booleans — and the schemas stay on the
server.

---

## 5. The twenty completion gates

| #   | Gate                                                                       | Status                                        | Evidence                                                                                                                                                                                                                                                                                                     |
| --- | -------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | NF-06 fixed and proven                                                     | **MET**                                       | §4; `apps/api/tests/openapi-artifact.test.js`; the drift check is command 13 of §9                                                                                                                                                                                                                           |
| 2   | Report inconsistencies reconciled                                          | **MET**                                       | §2; the 19-agent audit in `docs/ADVERSARIAL_REVIEW_FINDINGS.md`                                                                                                                                                                                                                                              |
| 3   | Organizer verification, public routes, venues, venue maps, event lifecycle | **MET**                                       | Verification `77b3040`; venues and maps `98dd142`…`71a3b8e`; lifecycle `8661bbf`; authoring `d1a2acf`; organiser UI `1b5e9b9`; moderation UI `2ef2172`                                                                                                                                                       |
| 4   | GA and reserved inventory concurrency-safe                                 | **MET**                                       | 15 reserved-seat races (`reserved-seat-concurrency.test.js`); probes in `db:verify:fresh`; two load scenarios asserting against the database                                                                                                                                                                 |
| 5   | Attendee completes mock checkout through order, payment, ledger, tickets   | **MET**                                       | GA in `checkout-ledger.test.js`; **a reserved seat end to end** in `reserved-seat-checkout.test.js` — 17 properties of one purchase, across two price zones                                                                                                                                                  |
| 6   | Provider calls outside database transactions                               | **MET**                                       | The three-phase boundary in checkout, refunds, payouts and reconciliation; `docs/PAYMENTS.md`                                                                                                                                                                                                                |
| 7   | Timeouts enter durable reconciliation and can be resolved safely           | **MET**                                       | `apps/api/src/lib/reconciliation.js`, 31 tests; a verdict is applied through the same domain commands, and `CONFLICT`/`UNKNOWN` resolve nothing                                                                                                                                                              |
| 8   | Full and partial refunds, no over-refund                                   | **MET**                                       | `apps/api/src/lib/refunds.js`; 19 route tests, 28 arithmetic tests, **12 races against real PostgreSQL**; the ceiling is a CHECK                                                                                                                                                                             |
| 9   | Dispute, transfer, payout state machines in mock mode                      | **MET**                                       | `apps/api/src/lib/payouts.js`; 27 finance tests and 17 covering the four webhook-path functions no route calls                                                                                                                                                                                               |
| 10  | Every completed commerce action posts balanced protected ledger entries    | **MET**                                       | Nine batch kinds; `desi_ledger_batch_balance` and the two immutability triggers; `findImbalances` runs above the totals and after every load scenario                                                                                                                                                        |
| 11  | Ticket transfer, revocation, check-in concurrency-safe                     | **MET**                                       | `apps/api/src/lib/tickets.js`; 34 lifecycle tests, **11 races**, a load scenario at sixteen concurrent scanners                                                                                                                                                                                              |
| 12  | Notifications use an idempotent outbox                                     | **MET**                                       | `apps/worker/src/outbox/dispatcher.js` claims under a lease and sends; dedupe is a unique index; a load scenario asserts the outbox drains faster than it fills                                                                                                                                              |
| 13  | Organizer and operations dashboards                                        | **MET**                                       | The four that were missing are built, tested and swept: organiser analytics (`/analytics`), the reconciliation item (`/operations/reconciliation/:id`), the refund (`/finance/refunds/:id`) and the ticket and its transfers (`/tickets/:id`, `/tickets/accept`). 26 behaviour cases against real rows; §5.2 |
| 14  | Phase 2 UI passes accessibility and responsive tests                       | **MET**                                       | §6.2 — **42** browser cases, WCAG 2.1 A and AA, no rule disabled, ten screens × three viewports plus 200% zoom, reduced motion and keyboard-only. The scanner found one serious defect on the new screens and it is recorded before its fix                                                                  |
| 15  | All 20 required E2E journeys pass                                          | **MET**                                       | §6 — nineteen walked in a browser; journey 11's required end state is unreachable by construction and its refusal is proven earlier and more strongly. §5.1 records why this returned from `PARTIAL`                                                                                                         |
| 16  | Load and reliability tests exist                                           | **MET**                                       | `scripts/load/`; 11 scenarios, 4 profiles, 7 database-side invariants; `docs/LOAD_AND_CAPACITY.md` states plainly what it does not measure                                                                                                                                                                   |
| 17  | CI enforces the Phase 2 gates                                              | **PARTIAL — EXTERNAL CONFIGURATION REQUIRED** | **8 jobs, all green**: run `35115541656` on `6eb6030`, and again run `35127103320` on the current HEAD `354e66f`, event `pull_request`, PR #1. Nothing on GitHub _requires_ them before a merge, and applying that is refused by this session’s proxy. See below                                             |
| 18  | All required documentation complete                                        | **MET**                                       | §7 — every named document exists and describes implemented behaviour                                                                                                                                                                                                                                         |
| 19  | Production payments technically disabled                                   | **MET**                                       | The kill switch refuses the boot; `payment-kill-switch.test.js` (12) runs as its own named step, command 18 of §9                                                                                                                                                                                            |
| 20  | All code-owned checks pass, committed, pushed, clean tree                  | **MET**                                       | §9 — 28 of 28 at exit 0; §1                                                                                                                                                                                                                                                                                  |

**Nineteen met, one partial, none not met.** The revision before this said
seventeen, three and none; the one before that said eight, six and six.

### Why gate 17 is `PARTIAL` and not `MET`

The first half of the gate is now satisfied, and by evidence from GitHub rather
than by reading the workflow file.

| Fact          | Value                                                               |
| ------------- | ------------------------------------------------------------------- |
| Workflow      | `CI`, id `359635192`, `.github/workflows/ci.yml`                    |
| Run           | `35115541656`                                                       |
| Trigger       | `pull_request`, pull request #1                                     |
| Commit tested | `6eb6030b2895078ee64c720e1552a5420e7970b9` — the commit §1 measures |
| Jobs          | 8, every one `success`                                              |
| Skipped steps | one per job, each an `if: failure()` artefact upload                |

Ten runs preceded it on this pull request: five succeeded, three failed and two
were cancelled by the workflow's own `concurrency` group when a later push
superseded them. No failure was retried until it passed.

Two of the three were fixed at the root: run 1 on a contract tag the new routes
carried and the document did not declare, and run 7 on four new browser specs
that had joined the public suite because nobody had excluded them. **The third
was misdiagnosed**, and this file said so for several commits. Run 4 failed in
the step named `Coverage thresholds`, and that name was the whole of the error:
nothing breached a threshold. `@desi-event/db#test:coverage` crashed importing a
Prisma client while `prisma generate` rewrote it, because a package's tests were
not ordered against that package's own build. It is fixed at the root in
`79ff795`; the closeout report's §9A sets out the evidence and what the
misdiagnosis cost.

**What is missing is enforcement, and it is not code.** Nothing on GitHub
requires those eight checks before a merge:

```
GET  /repos/KevinD003/desi-event.com/rulesets                  → 200 []
GET  /repos/KevinD003/desi-event.com/branches/main/protection  → 403 "Resource not accessible by integration"
PUT  /repos/KevinD003/desi-event.com/branches/main/protection  → 403 "Write access to this GitHub API path is not permitted through this proxy."
POST /repos/KevinD003/desi-event.com/rulesets                  → 403 "Write access to this GitHub API path is not permitted through this proxy."
```

The two refusals are different and the difference matters. The _read_ is refused
by GitHub because the app installation lacks `administration`. The _writes_ are
refused before they reach GitHub, by this session's outbound proxy — and the
same token reports `{"admin": true, "maintain": true, "push": true}` on this
repository, so that is neither a missing GitHub permission nor a plan
limitation. It is the execution environment declining to let an agent change a
repository's protection settings.

So the gate is **`PARTIAL` — external configuration required**, and the action
is precisely specified rather than described: `docs/BRANCH_PROTECTION.md`
carries the ruleset JSON, the classic-protection equivalent, and the eight
check-context names read back from GitHub's own jobs endpoint. The dash in the
browser job names is an em dash, because that is what the workflow produces; a
hyphen there matches nothing, and a required check that matches nothing blocks
every merge forever.

### 5.2 What closed gates 13 and 14

Four surfaces, three new routes, and the tests that make the claim checkable.

| Surface                          | Route                                   | Behaviour cases | Swept |
| -------------------------------- | --------------------------------------- | --------------: | ----- |
| Organiser analytics              | `analytics.summary`, `analytics.export` |               7 | yes   |
| Reconciliation item              | existing `reconciliation.*`             |               6 | yes   |
| Refund                           | existing `refunds.*`                    |               6 | yes   |
| Ticket, transfers and invitation | `tickets.get` and existing `tickets.*`  |               7 | yes   |

Four defects were found by the work itself, each recorded with its fix:

1. **The money branch was unreachable for the accounts it was written for.** A
   route-level step-up gate refused every VIEWER and door steward — roles the
   system does not compel to enrol a second factor — in order to protect a
   ledger total they were never going to be sent. The window now applies to the
   branch rather than to the request, from the same server-held policy table.
2. **The sales breakdowns carried money outside the money branch.** A reader
   told the money was not for them still got a table headed "sales by event"
   printing what each event took.
3. **Reconciliation evidence was not allow-listed.** `localState` and
   `providerState` were `z.unknown()`, so nothing was stripped. Every writer
   happened to store a small summary; that was a habit, and it is now a
   projection onto a reviewed key list that also drops an object hiding under an
   allowed key.
4. **A refund payload did not say whose refund it was**, so a screen asking
   `order:refund_approve` had no organisation to ask it in — NF-05 arriving by
   the back door.

The scanner found a fifth, in markup: a definition list whose entries carried a
third sibling `p`, which axe fails under WCAG 1.3.1 and a screen reader renders
as three unassociated paragraphs. All five are recorded before their fixes in
`PHASE2_FINAL_CLOSEOUT_REPORT.md`, which holds this cycle's full evidence.

### 5.1 Gate 15, and why it returned to `MET`

The revision before last moved gate 15 to `MET` on the strength of
`pnpm run test:e2e:events` reporting twenty passed. That was an overstatement
and was corrected:

> Passing 20 Playwright cases is not automatically the same as passing the 20
> specifically required journeys.

Five rows in §6 had been scored on evidence that was an API test, a database
probe, or a browser assertion about something adjacent. The correction named the
exact condition for each returning:

| Required journey                                              | Condition stated at the time                                  | Now                                |
| ------------------------------------------------------------- | ------------------------------------------------------------- | ---------------------------------- |
| 5 — unauthorized organization member cannot submit for review | A browser must attempt the submission as that member          | **refusals journey A**             |
| 10 — unverified organizer cannot publish                      | A browser must press publish as an unverified organizer       | **refusals journey B**             |
| 11 — reserved event cannot publish with a draft map           | A browser must select or reference a draft map and be refused | **refusals journey C** — see below |
| 16 — three viewports, zoom, reduced motion                    | The sweep must run                                            | **22 cases, and they pass** (§6.2) |
| 20 — cross-organization edit and publication denied           | A browser must attempt both as a user of another organization | **refusals journey D**             |

Journey 16 was the last of the five, and it is what moved gate 15. The sweep now
covers the finance and operations screens as well as the event screens.

**Journey 11 stays `DB-ENFORCED`, and gate 15 is scored `MET` with that stated
rather than hidden.** The gate names a state — a reserved event with a draft
map, at the point of publication — that this product cannot reach, because
`desi_event_session_map_frozen` refuses a session referencing an unpublished map
version on insert _and_ on update. The browser proves the refusal at the point
of reference, which is strictly earlier and strictly stronger. What no test can
show is a publication refusal, because there is no way to arrive at one, and
describing a test that could not have run is the thing this document exists to
stop.

**Gate 14 is deliberately not dragged along by gate 15.** Journey 16 names the
event screens, and those are swept. Gate 14 names the whole Phase 2 UI including
surfaces that do not exist, so it stays `PARTIAL` until they do.

---

## 6. The twenty required end-to-end journeys

**All twenty required journeys are now covered.** Nineteen are walked in a
browser; journey 11's required end state is unreachable by construction and its
refusal is proven earlier — §5.1 and §6.1 say why, at length, rather than
letting the count imply something simpler.

`apps/web/e2e/event-lifecycle.spec.js`, run by
`pnpm run test:e2e:events` against a real API, a real browser and a disposable
database, with both accounts going through the second factor their roles require
rather than around it.

The `Status` column answers one question only: **does a browser walk the
required journey?** A row scored `API-TESTED ONLY` is implemented and defended —
an API test, a database trigger, or both, fail if it regresses — but no browser
performs the act the journey names, so it does not count toward gate 15.

| #   | Journey                                                         | Status                 | Browser journey                                                                                    |
| --- | --------------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------- |
| 1   | Verified organizer creates a draft event                        | `AUTOMATICALLY TESTED` | journey 1 — create from an empty list                                                              |
| 2   | Organizer configures sessions and GA inventory                  | `AUTOMATICALLY TESTED` | journeys 7 and 9                                                                                   |
| 3   | Organizer selects a published reserved-seat map version         | `AUTOMATICALLY TESTED` | journey 7 — the select lists published versions only                                               |
| 4   | Organizer submits event for review                              | `AUTOMATICALLY TESTED` | journey 11                                                                                         |
| 5   | Unauthorized organization member cannot submit it               | `AUTOMATICALLY TESTED` | refusals journey A — Beta's owner navigates to Alpha's draft and attempts the submission           |
| 6   | Moderator requests changes                                      | `AUTOMATICALLY TESTED` | journey 13                                                                                         |
| 7   | Organizer updates and resubmits                                 | `AUTOMATICALLY TESTED` | journey 14                                                                                         |
| 8   | Moderator approves                                              | `AUTOMATICALLY TESTED` | journey 14                                                                                         |
| 9   | Authorized organizer publishes                                  | `AUTOMATICALLY TESTED` | journey 16                                                                                         |
| 10  | Unverified organizer cannot publish                             | `AUTOMATICALLY TESTED` | refusals journey B — the control is disabled, and the command is refused when issued anyway        |
| 11  | Reserved event cannot publish with a draft map                  | `DB-ENFORCED`          | refusals journey C — the browser references one and is refused; see §6.1, the state is unreachable |
| 12  | Published event appears publicly                                | `AUTOMATICALLY TESTED` | journey 16                                                                                         |
| 13  | Draft and rejected events remain private                        | `AUTOMATICALLY TESTED` | journeys 2 and 15                                                                                  |
| 14  | Public page works without JavaScript                            | `AUTOMATICALLY TESTED` | journeys 16–18 read server-rendered HTML and its JSON-LD                                           |
| 15  | Event editor works by keyboard                                  | `AUTOMATICALLY TESTED` | journey 4 (summary, links, focus); unit tests for the rest                                         |
| 16  | Event screens pass phone, tablet, desktop, zoom, reduced motion | `AUTOMATICALLY TESTED` | sweep suite — 22 cases: five screens × 320/768/1280, 200% zoom, reduced motion, keyboard; see §6.2 |
| 17  | Material post-publication change requires confirmation          | `AUTOMATICALLY TESTED` | journey 19                                                                                         |
| 18  | Sales can be paused and resumed                                 | `AUTOMATICALLY TESTED` | journeys 17 and 18                                                                                 |
| 19  | Cancellation creates notification/refund work exactly once      | `AUTOMATICALLY TESTED` | journey 20; concurrency in `event-authoring-integration.test.js`                                   |
| 20  | Cross-organization edit and publication attempts are denied     | `AUTOMATICALLY TESTED` | refusals journey D — Beta's owner attempts both against Alpha's event, from a signed-in session    |

**Nineteen proven in a browser. One `DB-ENFORCED` and browser-refused at the
point of reference.** Nothing is left `IMPLEMENTED`.

### 6.1 The four that were corrected, and what was built for them

`apps/web/e2e/refusals.spec.js`, run by `pnpm run test:e2e:refusals` against a
real API, a real browser and a disposable database, with a cast the lifecycle
suite deliberately does not have: two verified organisations, an unverified one
holding a publication-ready event, and a venue map that was never published.

Each journey attempts the act with a real signed-in session and then checks that
nothing was written. Two of them issue a command the interface correctly does
not offer to that person, using `page.request` — which carries the browser's own
session cookies. That is a determined user opening the developer console, not an
API test with a forged token: there is no credential there the browser did not
earn by signing in.

| Journey | What the browser does                                                          | What it observes                                                                                                                                                                                                       |
| ------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A       | Beta's owner opens Alpha's draft, then submits it for review                   | The editor refuses to open it **in the same words it uses for an id that does not exist**, so the refusal cannot be used to enumerate other organisations' drafts. The command is refused. The draft is still a draft. |
| B       | An unverified organiser opens a complete, approved event and presses publish   | The control is **disabled** and the reason is on screen — the refusal arrives before the press. Issuing the command anyway is refused. The event has no public page.                                                   |
| C       | The organiser references a draft venue map on a session                        | The select never offers it, and naming it anyway is refused.                                                                                                                                                           |
| D       | Beta's owner opens Alpha's published event and attempts to edit and publish it | No lifecycle command is rendered for them at all. Both commands are refused. The title the owner sees is unchanged.                                                                                                    |

Journey 11 is scored `DB-ENFORCED` rather than `AUTOMATICALLY TESTED`, and the
distinction is deliberate. The gate names a state — a reserved event with a
draft map, at the point of publication — that this product cannot reach.
`desi_event_session_map_frozen` refuses a session referencing an unpublished map
version, on insert _and_ on update, so an event can never get into the state the
gate describes. The browser journey proves the refusal happens at the point of
reference, which is strictly earlier and strictly stronger. What it cannot show
is a publication refusal, because there is no way to arrive at one — and
describing a test that could not have run is the thing this document exists to
stop.

### 6.2 The responsive and accessibility sweep

`apps/web/e2e/accessibility-sweep.spec.js`, run by `pnpm run test:e2e:sweep`.
**Forty-two cases**, all passing at `6eb6030` — twenty-two at `910538b`, plus
twenty for the five surfaces the closeout cycle added:

- **Thirty clean scans** — ten screens at three widths each, at 320, 768 and
  1280 CSS pixels. The organiser event list, the seven-step editor, the public
  event page, the finance overview, the operations board, **organiser
  analytics**, **the reconciliation detail screen**, **the refund detail
  screen**, **the ticket detail screen** and **the invitation screen**.
- The editor at **200% zoom**, with no sideways scrolling, and the four new
  detail screens at the same 640-pixel effective viewport.
- Nothing left permanently invisible under `prefers-reduced-motion`, on the
  organiser list and on the refund screen — the one where an invisible element
  would be somebody's money.
- The editor reachable and operable **by keyboard alone**, and a reconciliation
  item likewise, reaching its skip link first.
- A visible focus indicator on **every** focusable control.
- The moderation queue and decision screen.
- Touch targets large enough to hit.
- The finance screen stating what produced its figures **before** any of them.
- The invitation field typed into without the code reaching the address bar.
- The refund screen mentioning no card, and holding no field that could take
  one.

Every new screen is scanned with real rows behind it — a paid order with two
tickets, a refund with lines and an allocation, a reconciliation item with both
sides of its evidence, and a ledger batch that balances. A screen rendered from
a static array would prove that the markup compiles, which is not what this
suite is for.

320 rather than 360, because WCAG 1.4.10 names 320 as the reflow width and a
layout that only works at 360 fails the criterion for anybody on a small phone
or a zoomed desktop.

**axe-core runs on every page, with the WCAG 2.1 A and AA rule sets and no rule
disabled.** The only exclusion is Next's development overlay, which the
framework injects and no deployment ships.

**It found a serious defect on its first run over the new screens, and the
defect is recorded before its fix.** `definition-list`, WCAG 2.1 A (1.3.1): the
reconciliation screen's "Where it stands" list wrapped each entry in a `div`
holding `dt`, `dd` **and an explanatory `p`**. A `div` inside a `dl` is allowed;
a `p` as a third sibling is not, and a screen reader walking the list gets three
unassociated paragraphs where it should get three definitions. The hints now
live inside their `dd`. The same mistake had been made once before, on the
`Figure` component, and the comment left there then is repeated on the new
one — twice is a pattern, and the second is the one worth writing down.

The earlier cycle's four contrast failures, all real, all fixed in the
components rather than by silencing the rule:

| What                                     | Was      | Now      | Fix                                 |
| ---------------------------------------- | -------- | -------- | ----------------------------------- |
| White on the primary button              | 3.12 : 1 | 4.70 : 1 | `marigold-600` → `marigold-700`     |
| Footer note on the indigo-night footer   | 3.74 : 1 | 6.78 : 1 | `slate-500` → `slate-400`           |
| Secondary text on the page background    | 4.43 : 1 | 7.05 : 1 | `slate-500` → `slate-600`, 16 files |
| The editor's step numbers at 70% opacity | 4.14 : 1 | 6.92 : 1 | dropped the opacity                 |

Two structural failures came out of the Phase 2 dashboard markup on its first
run, both fixed in the components: a definition list whose hint sat outside its
`<dd>`, and a scrollable region that could not be reached by keyboard
(`scrollable-region-focusable`), fixed with `tabIndex={0}` and a named
`role="region"`.

**What is not swept, and why it is not swept quietly.** The gate also names
reconciliation-detail, refund and ticket surfaces. Those are not in the suite
because **they are not built** — they are API-only in this cycle. A sweep that
skipped them silently would report a coverage it does not have, so gate 14 stays
`PARTIAL` until they exist and are swept too.

---

**Browser coverage by suite**, and these five are disjoint — each config names
its own spec files, so no test is counted twice:

| Suite                         | Config                            | Covers                                                               |   Tests |
| ----------------------------- | --------------------------------- | -------------------------------------------------------------------- | ------: |
| `pnpm run test:e2e`           | `playwright.config.js`            | Public catalogue, filters, accessibility, reduced motion, venue page |     118 |
| `pnpm run test:e2e:prod`      | `playwright.production.config.js` | Not-found behaviour against a compiled build                         |      19 |
| `pnpm run test:e2e:organizer` | `playwright.organizer.config.js`  | The twelve venue and venue-map journeys                              |      13 |
| `pnpm run test:e2e:events`    | `playwright.events.config.js`     | Twenty event-lifecycle cases                                         |      20 |
| `pnpm run test:e2e:refusals`  | `playwright.refusals.config.js`   | The four refusals the previous scoring overstated                    |       4 |
| `pnpm run test:e2e:sweep`     | `playwright.sweep.config.js`      | The responsive and accessibility sweep                               |      22 |
| **Total**                     |                                   |                                                                      | **196** |

That total is Playwright cases, not required journeys. The two numbers are
counted separately everywhere in this document and never added together.
---

## 7. The required documents

Every one exists. Verified by `test -f` on each path and by reading each for
Phase 2 content rather than by trusting the filename.

| Document                                  | Status                                                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `README.md`                               | **UPDATED** — payments-unreachable notice first, thirteen packages, every script, a documentation index |
| `docs/architecture.md`                    | **UPDATED** — the money subsystems, the concurrency primitive, the ledger package                       |
| `docs/api.md`                             | **UPDATED** — 115 operations, the Phase 2 groups, the four properties every route has                   |
| `docs/DATA_MODEL.md`                      | **WRITTEN** — where the schema encodes a decision; retention, and erasure marked NOT IMPLEMENTED        |
| `docs/SECURITY.md`                        | **WRITTEN** — auth, MFA, ten step-up policies, authorization, audit, rotation, incident response        |
| `docs/UX.md`                              | **WRITTEN** — screens, the sweep, browser journeys counted separately                                   |
| `docs/PROVIDERS.md`                       | **WRITTEN** — the four adapters, mock mode, webhook intake and dispatch                                 |
| `docs/DECISIONS.md`                       | **WRITTEN** — the authoritative index, plus decisions that live in code and three that were reversed    |
| `docs/PAYMENTS.md`                        | **WRITTEN** — unreachability, the PCI boundary, the two-phase boundary, timeout                         |
| `docs/STRIPE_CONNECT.md`                  | **WRITTEN** — the charge model, and a status table whose first rows say what is not built               |
| `docs/FINANCIAL_LEDGER.md`                | **WRITTEN** — ten accounts, nine batch kinds, why reversal never edits history                          |
| `docs/REFUNDS_DISPUTES.md`                | **WRITTEN** — four steps, seat policy, and the twelve named races                                       |
| `docs/RECONCILIATION_RUNBOOK.md`          | **WRITTEN** — written as a runbook, because its reader is having a bad day                              |
| `docs/CHECK_IN.md`                        | **WRITTEN** — three mechanisms for admitted-once, and the ordering that matters                         |
| `docs/PHASE2_THREAT_MODEL.md`             | **WRITTEN** — assets, actors, thirteen attacks, and what is out of scope                                |
| `apps/api/openapi.json`                   | **CURRENT** — generated from the route table and drift-checked in CI and in §9                          |
| `docs/adr/0001`…`0004`                    | **WRITTEN** — indexed by `docs/DECISIONS.md`                                                            |
| `docs/language-policy.md`, `.env.example` | **CURRENT**                                                                                             |
| `docs/LOAD_AND_CAPACITY.md`               | **WRITTEN** — and says in its first paragraph what it does not measure                                  |
| `docs/BRANCH_PROTECTION.md`               | **WRITTEN** — and now records the measured state: nothing is configured                                 |

### What the documents are not allowed to do, and were checked against

Each was written against the code rather than against the plan, and writing them
corrected six claims that turned out to be wrong:

| Claim that was assumed                       | What the code says                                                                                                            |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Argon2id passwords                           | **scrypt**, and `password.js` says why bcrypt was dropped                                                                     |
| 35 capabilities                              | **36**, five of them platform-only                                                                                            |
| Connect onboarding works                     | Adapter methods exist; **no route and no screen**                                                                             |
| Personal data is redactable                  | **No erasure mechanism exists.** The retention table says what each row is for; a separate heading says enforcement is absent |
| Reconciliation lives at `/v1/reconciliation` | `/v1/operations/reconciliation`, under `FINANCE_ACTION` not `OPERATIONS`                                                      |
| CSP is strict                                | `script-src` and `style-src` permit `'unsafe-inline'`; recorded as a gap                                                      |

Mock-only operations, the externally pending Stripe verification, the disabled
production path, the provider calls outside transactions, the PCI boundary and
the card data that must never enter are each labelled in the document that owns
them, not in a footnote.

---

## 8. The clean baseline at `a949cb7`

> **HISTORICAL — superseded by §9.** The baseline this cycle started from. Kept
> so the deltas in §9 have something to be deltas from.

Run with PostgreSQL 16.13 and Redis 7.0.15 up, caches deleted first, on a
four-core machine with nothing else running.

| #   | Command                       | Exit | Elapsed | Result                                                     | Cache                     |
| --- | ----------------------------- | ---: | ------- | ---------------------------------------------------------- | ------------------------- |
| 1   | `pnpm run policy:check`       |    0 | 0s      | 455 files scanned, no violations                           | n/a                       |
| 2   | `pnpm run secrets:scan`       |    0 | 4s      | 454 files, nothing credential-shaped                       | n/a                       |
| 3   | `pnpm run format:check`       |    0 | 8s      | all files Prettier-clean                                   | n/a                       |
| 4   | `pnpm run lint`               |    0 | 10s     | no problems                                                | n/a                       |
| 5   | `pnpm run contract:check`     |    0 | 2s      | 61 routes, 61 operations, 54 paths; artefact current       | n/a                       |
| 6   | `pnpm run test`               |    0 | 61s     | **3,836 passed, 0 failed, 0 skipped**, 135 files, 16 tasks | **0 of 16 cached** (cold) |
| 7   | `pnpm run db:verify:fresh`    |    0 | 13s     | **68/68**, disposable database destroyed                   | n/a                       |
| 8   | `pnpm run db:verify:upgrade`  |    0 | 4s      | **19/19**, both disposable databases destroyed             | n/a                       |
| 9   | `pnpm run build`              |    0 | 16s     | 3 tasks                                                    | **0 of 3 cached** (cold)  |
| 10  | `pnpm audit`                  |    0 | 1s      | no known vulnerabilities                                   | n/a                       |
| 11  | `pnpm run bundle:scan`        |    0 | 1s      | 173 browser-deliverable files, nothing server-only         | n/a                       |
| 12  | `pnpm run test:e2e`           |    0 | 101s    | **118 passed**                                             | n/a                       |
| 13  | `pnpm run test:e2e:prod`      |    0 | 14s     | **19 passed**                                              | n/a                       |
| 14  | `pnpm run test:e2e:organizer` |    0 | 35s     | **13 passed**                                              | n/a                       |

**No retries were needed and nothing failed.** The three browser suites were run
one at a time, deliberately: this machine has four cores, so the workflow
concurrency cap is two, and the `ERR_CONNECTION_REFUSED` episode recorded in
`PHASE2_FINAL_VERIFICATION_REPORT.md` §8 was caused by exactly this box being
asked to build in several worktrees while a dev server was starting.

**Environment note.** The container restarted immediately before this baseline
and neither PostgreSQL nor Redis was running. Both were started with
`service postgresql start` and `service redis-server start` before any command
in the table. The Redis init script prints
`ulimit: error setting limit (Operation not permitted)` in this sandbox and
starts anyway; `redis-cli ping` returns `PONG`. That is an environment quirk,
not a repository defect, and the baseline was not begun until both services
answered.

---

## 9. Verification at `910538b`

Twenty-eight commands, in order, nothing cached. `.turbo`, every package's
`.turbo`, `apps/web/.next` and `apps/web/test-results` were deleted first, so
`test`, `test:coverage` and `build` all report **0 cached**.

PostgreSQL 16.13 and Redis 7.0.15 on the same machine, both up throughout.

| #   | Command                               | Exit | Seconds | Result                                                                   |
| --- | ------------------------------------- | ---: | ------: | ------------------------------------------------------------------------ |
| 1   | `pnpm run policy:check`               |    0 |     0.4 | 575 files scanned via git, no violations                                 |
| 2   | `pnpm run secrets:scan`               |    0 |     0.7 | 574 tracked files, nothing credential-shaped                             |
| 3   | `pnpm run format:check`               |    0 |     9.9 | every matched file Prettier-clean                                        |
| 4   | `pnpm run lint`                       |    0 |     9.8 | no problems                                                              |
| 5   | contract validate                     |    0 |     0.6 | **115 routes, 115 OpenAPI operations, 103 paths**                        |
| 6   | `db:migrate:deploy` (test database)   |    0 |     2.0 | 12 migrations applied                                                    |
| 7   | `pnpm run test`                       |    0 |    76.5 | **4,536 passed, 0 failed, 0 skipped**, 167 files, 17 tasks, **0 cached** |
| 8   | `check-skipped-tests.mjs`             |    0 |     0.2 | no undeclared skip                                                       |
| 9   | `pnpm run test:coverage`              |    0 |    84.4 | every threshold met, 16 tasks, **0 cached**                              |
| 10  | `pnpm run db:verify:fresh`            |    0 |    13.7 | **81/81**, disposable database destroyed                                 |
| 11  | `pnpm run db:verify:upgrade`          |    0 |     4.1 | **23/23**, 20 triggers, 12 migrations, both databases destroyed          |
| 12  | `pnpm run build`                      |    0 |    12.0 | 3 tasks, **0 of 3 cached**                                               |
| 13  | `pnpm run openapi:check`              |    0 |     1.0 | artefact current with the route table                                    |
| 14  | `pnpm run manifest:emit`              |    0 |     0.9 | regenerated                                                              |
| 15  | manifest and OpenAPI drift            |    0 |     0.0 | no difference                                                            |
| 16  | `pnpm run bundle:scan`                |    0 |     0.5 | **240 browser-deliverable files**, nothing server-only present           |
| 17  | `pnpm audit --audit-level moderate`   |    0 |     0.6 | no known vulnerabilities                                                 |
| 18  | payment kill switch, on its own       |    0 |     2.6 | **12 passed**                                                            |
| 19  | `pnpm run test:e2e`                   |    0 |    85.1 | **118 passed**                                                           |
| 20  | `pnpm run test:e2e:events`            |    0 |    53.0 | **20 passed**                                                            |
| 21  | `pnpm run test:e2e:sweep`             |    0 |    35.7 | **22 passed**                                                            |
| 22  | `pnpm run test:e2e:organizer`         |    0 |    29.6 | **13 passed**                                                            |
| 23  | `pnpm run test:e2e:refusals`          |    0 |    16.5 | **4 passed**                                                             |
| 24  | `pnpm run test:e2e:prod`              |    0 |     9.9 | **19 passed**                                                            |
| 25  | load — GA hold contention, ramp       |    0 |    12.1 | 1/1 scenario, every invariant held                                       |
| 26  | load — reserved-seat contention, ramp |    0 |    12.1 | 1/1 scenario                                                             |
| 27  | load — check-in concurrency, ramp     |    0 |    13.4 | 1/1 scenario                                                             |
| 28  | load — every scenario, steady         |    0 |   125.9 | **11/11 scenarios**                                                      |

**Twenty-eight of twenty-eight at exit 0.**

### 9.1 Unit and integration totals, by package

**4,536 across 167 files**, summed from what the run printed:

| Package                   | Tests | Package                     |     Tests |
| ------------------------- | ----: | --------------------------- | --------: |
| `@desi-event/api`         |   940 | `@desi-event/worker`        |       216 |
| `@desi-event/schemas`     |   580 | `@desi-event/api-contract`  |       191 |
| `@desi-event/permissions` |   570 | `@desi-event/pricing`       |       116 |
| `@desi-event/providers`   |   494 | `@desi-event/db`            |       102 |
| `@desi-event/web`         |   423 | `@desi-event/ui`            |        97 |
| `@desi-event/auth`        |   353 | `@desi-event/logger`        |        63 |
| `@desi-event/inventory`   |   291 | `@desi-event/notifications` |        56 |
|                           |       | `@desi-event/ledger`        |        33 |
|                           |       | `@desi-event/config`        |        11 |
| **Total**                 |       |                             | **4,536** |

Turbo reports seventeen tasks and sixteen packages print a total; the
seventeenth produces no test output of its own. Recorded rather than smoothed.

**196 browser cases across six configurations** are counted in §6 and are never
added to the figure above.

### 9.2 The three failures in earlier runs of this sequence

The sequence was run three times. Each failure was diagnosed and corrected
rather than re-run until it passed.

| Run | Command                       | Failure                                          | Root cause                                                                                                                                                                                                                                                                                                                                                                                                              | Fixed in          |
| --- | ----------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| 1   | `test:coverage`               | `@desi-event/notifications` 75% functions vs 80% | Two exported functions nothing called — and they disagreed with every call site that should have called them                                                                                                                                                                                                                                                                                                            | `7d73fd1`         |
| 1   | `db:migrate:deploy` (**dev**) | `P3009`, a migration left unfinished             | **Local development database only.** An interrupted run earlier in the container left `20260916000000_event_draft_revision` recorded as started while its statements had already run. Not a product defect: a fresh database applies all twelve (`db:verify:fresh`, 81/81) and a populated one accepts them too (`db:verify:upgrade`, 23/23). The final sequence migrates the **test** database, which every suite uses | not a code change |
| 2   | `test`                        | `facets-integration` expected 1186 to be 1185    | Two catalogue reads differenced across a concurrent publish by `event-lifecycle-integration` in another worker on the same database. Reproduced at about one contended round in four before the fix; six after                                                                                                                                                                                                          | `910538b`         |

The coverage failure is the one worth keeping, because of what it exposed:
**nothing ran the coverage thresholds.** Neither `pnpm verify` nor CI did, so
every floor in the repository was decorative. CI runs `test:coverage` now, and
adding it immediately found `apps/api` branch coverage below its own floor and
four money functions — `settleTransfer`, `reverseTransfer`, `openDispute`,
`resolveDispute` — with no test at all.

---

## 9A. Verification at `9be3c79`

> **HISTORICAL — superseded by §9.** Kept unedited so the deltas above have
> something to be deltas from.

Sixteen commands, in this order, one after another, nothing cached. Every cache
was deleted first — `.turbo`, each package's `.turbo`, `apps/web/.next`, and
Playwright's `test-results` — so `test` and `build` report **0 of 16** and **0
of 3** cached.

Run against PostgreSQL 16.13 and Redis 7.0.15 on the same machine, both started
before the sequence and both up throughout.

| #   | Command                                               | Exit | Duration | Result                                                                   |
| --- | ----------------------------------------------------- | ---: | -------- | ------------------------------------------------------------------------ |
| 1   | `pnpm run policy:check`                               |    0 | 0s       | 501 files scanned via git, no violations                                 |
| 2   | `pnpm run secrets:scan`                               |    0 | 1s       | 500 tracked files, nothing credential-shaped                             |
| 3   | `pnpm run format:check`                               |    0 | 10s      | every matched file Prettier-clean                                        |
| 4   | `pnpm run lint`                                       |    0 | 10s      | no problems                                                              |
| 5   | `pnpm --filter @desi-event/api-contract run validate` |    0 | 1s       | **81 routes, 81 OpenAPI operations, 71 paths**                           |
| 6   | `pnpm run openapi:check`                              |    0 | 1s       | `apps/api/openapi.json` current with the route table                     |
| 7   | `pnpm run test`                                       |    0 | 71s      | **4,099 passed, 0 failed, 0 skipped**, 148 files, 16 tasks, **0 cached** |
| 8   | `pnpm run db:verify:fresh`                            |    0 | 12s      | **68/68**, disposable database destroyed                                 |
| 9   | `pnpm run db:verify:upgrade`                          |    0 | 4s       | **21/21**, 15 triggers, 10 migrations, both databases destroyed          |
| 10  | `pnpm run build`                                      |    0 | 15s      | 3 tasks, **0 of 3 cached**                                               |
| 11  | `pnpm audit`                                          |    0 | 1s       | no known vulnerabilities                                                 |
| 12  | `pnpm run bundle:scan`                                |    0 | 1s       | **222 browser-deliverable files**, nothing server-only present           |
| 13  | `pnpm run test:e2e`                                   |    0 | 97s      | **118 passed**                                                           |
| 14  | `pnpm run test:e2e:prod`                              |    0 | 12s      | **19 passed**                                                            |
| 15  | `pnpm run test:e2e:organizer`                         |    0 | 33s      | **13 passed**                                                            |
| 16  | `pnpm run test:e2e:events`                            |    0 | 57s      | **20 passed**                                                            |

**Sixteen of sixteen at exit 0.**

### 9A.1 Unit and integration totals, by package

4,099 across 148 files. Reconciled by summing the per-package figures the run
printed, not by recalling a total:

| Package                    | Tests | Package              |     Tests |
| -------------------------- | ----: | -------------------- | --------: |
| `@desi-event/api`          |   633 | `@desi-event/db`     |       102 |
| `@desi-event/schemas`      |   576 | `@desi-event/ui`     |        97 |
| `@desi-event/permissions`  |   557 | `@desi-event/logger` |        63 |
| `@desi-event/providers`    |   478 | `@desi-event/ledger` |        33 |
| `@desi-event/web`          |   415 | `@desi-event/config` |        11 |
| `@desi-event/auth`         |   353 |                      |           |
| `@desi-event/inventory`    |   291 |                      |           |
| `@desi-event/api-contract` |   191 |                      |           |
| `@desi-event/worker`       |   183 |                      |           |
| `@desi-event/pricing`      |   116 |                      |           |
| **Total**                  |       |                      | **4,099** |

Turbo reports sixteen tasks and fifteen packages print a total; the sixteenth
task produces no test output of its own. That discrepancy is recorded rather
than smoothed: the fifteen figures above are what the run printed, and they sum
to 4,099.

Adding the four browser suites gives **4,269 automated assertions** in total.

### 9A.2 The one failure in the first run, and what it was

The sequence was run twice. The first run, at the commit before `9be3c79`,
failed at command 9:

```
FAIL  the pre-Phase-2 migration 20260916000000_event_draft_revision applied
      — ERROR: relation "EventSession" does not exist
```

**Root cause.** `packages/db/scripts/verify-populated-upgrade.mjs` keeps an
explicit list of which migrations belong to Phase 2, because the whole point of
that verifier is to apply the pre-Phase-2 ones, fill every table with rows, and
_then_ apply the Phase 2 ones over real data. `20260916000000_event_draft_revision`
was not on the list, so it was classified as pre-Phase-2 and ran against a
schema that does not have `EventSession` yet.

The verifier caught its own list being out of date, which is what it is for.
**Fixed in `9be3c79`** by adding the migration at the list's documented
extension point. Nothing was relaxed; the second run reports 21/21.

No other command failed in either run.

---

## 10. What this cycle built, and what it did not

### Built

| Thing                                             | Where                                                                 | Status                                                                  |
| ------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| A reserved seat bought end to end, priced by seat | `apps/api/src/lib/seated-checkout.js`; 17 properties of one purchase  | `AUTOMATICALLY TESTED`                                                  |
| The notification outbox worker                    | `apps/worker/src/outbox/dispatcher.js`                                | `AUTOMATICALLY TESTED`                                                  |
| Refunds: request, approve, submit, settle         | `apps/api/src/lib/refunds.js`, `routes/refunds.js`                    | `AUTOMATICALLY TESTED`                                                  |
| Refund ceilings under concurrency                 | 12 races against real PostgreSQL, in `db:verify:fresh`                | `DB-ENFORCED`                                                           |
| The reconciliation queue and its six actions      | `apps/api/src/lib/reconciliation.js`, `routes/reconciliation.js`      | `AUTOMATICALLY TESTED`                                                  |
| Disputes, transfers and payouts                   | `apps/api/src/lib/payouts.js`, `routes/finance.js`                    | `AUTOMATICALLY TESTED`                                                  |
| A balance nobody can overdraw                     | `availableBalance`, read inside the transaction that creates a payout | `AUTOMATICALLY TESTED`                                                  |
| Ticket transfer, revocation and admission once    | `apps/api/src/lib/tickets.js`; 11 races                               | `AUTOMATICALLY TESTED`                                                  |
| The finance overview and the operations board     | `apps/web/src/app/finance/`, `apps/web/src/app/operations/`           | `AUTOMATICALLY TESTED`                                                  |
| A CSV export that cannot be weaponised            | `apps/api/src/lib/csv.js` — escapes, never strips                     | `AUTOMATICALLY TESTED`                                                  |
| Ledger reporting derived from entries             | `apps/api/src/lib/finance-reporting.js`, incl. `findImbalances`       | `AUTOMATICALLY TESTED`                                                  |
| Partial refunds and movement levers in the mock   | `packages/providers/src/payments.js`                                  | `AUTOMATICALLY TESTED`                                                  |
| The load and reliability suite                    | `scripts/load/` — 11 scenarios, 4 profiles, 7 invariants              | `AUTOMATICALLY TESTED`                                                  |
| The responsive and accessibility sweep            | `apps/web/e2e/accessibility-sweep.spec.js` — 22 cases                 | `AUTOMATICALLY TESTED`                                                  |
| The four product refusals, in a browser           | `apps/web/e2e/refusals.spec.js`                                       | `AUTOMATICALLY TESTED`                                                  |
| The security regression suite                     | `apps/api/tests/security-regression.test.js` — 12 cases               | `AUTOMATICALLY TESTED`                                                  |
| A CI workflow covering every gate                 | `.github/workflows/ci.yml` — 8 jobs                                   | `IMPLEMENTED` — see gate 17                                             |
| The fifteen named documents                       | `docs/`                                                               | `AUTOMATICALLY TESTED` (existence and format are checked; prose is not) |

### Still not built — and one of them is what keeps Phase 2 `PARTIAL`

| Thing                     | Gate | What exists instead                                                                                                           |
| ------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Branch protection**     | 17   | Eight green checks that nothing requires. Externally verified absent: no ruleset, no classic protection. This is the one gate |
| Connect onboarding        | —    | Adapter methods exist; **no route calls them and no screen sends anybody to one**. `docs/STRIPE_CONNECT.md` opens with that   |
| Data erasure or redaction | —    | A retention policy in `docs/DATA_MODEL.md` under a heading that says the mechanism does not exist                             |
| Any Stripe API call       | —    | §11                                                                                                                           |

The four rows this table carried last revision — organiser analytics, and the
reconciliation, refund and ticket transfer screens — are built, and §5.2 says
what they are and what finding their defects cost.

---

## 11. Stripe and external verification

No Stripe credentials have ever been supplied to this repository, and none were
requested as a blocker. Every Stripe test runs against a double with the real
call shapes. No Stripe object ID, dashboard screenshot, CLI transcript, refund,
transfer or payout has been fabricated anywhere in this repository.

| Item                           | Status                          |
| ------------------------------ | ------------------------------- |
| Stripe test-mode credentials   | **none supplied**               |
| Real Stripe sandbox operations | `EXTERNAL VERIFICATION PENDING` |
| Stripe adapter call shapes     | `MOCK-ONLY`                     |
| Production payments            | `DISABLED` — and asserted so    |

---

## 12. Remaining code-owned work, and what Phase 3 needs first

### 12.1 What is code-owned and still outstanding

"Code-owned" means it can be finished in this repository with no credential, no
account and no decision from outside. **The list is now two items, and neither
is a gate.**

| #   | Work                                                           | Gate | Why it is next                                                                                                                  |
| --- | -------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Connect onboarding routes and a screen                         | —    | `connect.start` and `connect.status` calling adapter methods that already exist, behind `connect:manage` and a `PAYOUT` step-up |
| 2   | Data erasure as redaction, with its own route and audit action | —    | The schema already forces the shape: redact the person, keep the ledger references                                              |

The five rows before these are done: the reconciliation, refund and ticket
screens, organiser analytics, and the sweep over all of them.

### 12.2 What is not code-owned

Recorded so it is not mistaken for work anybody here can finish:

- **Branch protection.** A run now exists and its eight jobs pass; requiring
  them before a merge needs write access to the repository's protection
  settings, which this session's proxy refuses whatever the token holds.
  `docs/BRANCH_PROTECTION.md` carries the exact JSON, the exact check names, and
  the two refusals verbatim. **Gate 17 cannot be closed from inside this
  repository**, and this document does not pretend otherwise.
- **Real Stripe sandbox operations.** Needs test credentials this repository has
  never held. `EXTERNAL VERIFICATION PENDING`, not "nearly done".
- **Production card processing.** Needs a merchant account, a tax
  determination, reconciliation operations and real payout destinations. It is a
  Phase 2 exit criterion and it is deliberately unreachable from this code.

### 12.3 Phase 3 prerequisites

Phase 3 has not been started and should not be. The conditions, stated as tests:

1. **Every gate in §5 is `MET`.** Nineteen are. One is `PARTIAL`, and its row
   names what is missing and who can supply it.
2. **A CI run exists.** ✅ Run `35115541656`, eight jobs, all green, on the
   commit §1 measures, and run `35127103320`, eight jobs, all green, on the
   current HEAD `354e66f`. **As of run `35117010156` there had been twelve runs
   on pull request #1 — seven green, three failed, two cancelled** by the
   concurrency group; a cancelled run is not a failed one, and neither
   cancellation hid a job that concluded `failure`. All three failures are fixed
   at the root rather than re-run; the third only after this file had
   misattributed it to a coverage threshold for several commits.
3. **Branch protection is configured**, and the claim is made by somebody who
   looked. **Still absent, measured.** This is the remaining prerequisite.
4. **The four missing screens exist and are swept.** ✅ All four, plus the
   invitation screen, at three widths, at 200% zoom, with motion reduced and by
   keyboard.
5. **Nothing claims a Stripe operation happened.** Every such claim in this
   repository is marked `EXTERNAL VERIFICATION PENDING`, and that must stay true
   until credentials exist.
6. **Production payments remain unreachable, and something still asserts it.**
   The kill switch is a Phase 2 property that Phase 3 inherits rather than
   retires. ✅ Twelve cases, as its own named CI step.

---

## 13. Closing state

A file cannot contain the hash of the commit that introduces it, so what is
recorded here is the property rather than the number. After this document's own
commit is pushed:

```
$ git rev-parse HEAD && git rev-parse @{u}
(the two agree)

$ git status --porcelain
(no output)

$ git worktree list
/home/user/desi-event.com  <HEAD>  [claude/desi-event-js-stack-gb4uqe]
```

Branch `claude/desi-event-js-stack-gb4uqe`, upstream
`origin/claude/desi-event-js-stack-gb4uqe`, every commit of every cycle pushed,
no history rewritten, squashed or force-pushed, and one worktree.

**The last executable-code commit is `6eb6030`, and it is named separately from
this report's own commit** — a documentation commit is not a change to the
system. The closeout cycle's thirty-two commands were run against `c5e98da`,
one commit earlier.
`PHASE2_FINAL_CLOSEOUT_REPORT.md` records all thirty-two with their exit codes
and durations, and records the final pushed HEAD that no file can contain.
