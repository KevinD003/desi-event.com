# Phase 2 status — the authoritative current record

**Status: `PARTIAL`.** Phase 3 has not been started.

**As of `8661bbf`.** The repository-state table in §1 is measured at `a949cb7`,
the commit this cycle started from; §10 records the state at the end.

This document is the single current-status record for Phase 2. Where it
disagrees with any other file in this repository, this one is right and the
other is historical.

The other four Phase 2 documents remain, and remain useful, but they are
_accounts of cycles_ rather than statements of the present. Each records what a
particular cycle did and what was true when it was written. Sections of them
that time has overtaken are marked `HISTORICAL STATUS — SUPERSEDED` and point
here. Nothing in them has been rewritten, because a report that quietly
rewrites what it said last time is not a record.

| Document                              | What it is                                                      |
| ------------------------------------- | --------------------------------------------------------------- |
| `PHASE2_STATUS.md`                    | **This file. Current status. Authoritative.**                   |
| `PHASE2_IMPLEMENTATION_REPORT.md`     | Account of the `7777322`…`926d1a3` cycle                        |
| `PHASE2_COMPLETION_REPORT.md`         | Account of the `e93d4e9`…`b37b242` cycle, plus the gate scoring |
| `PHASE2_REQUIREMENTS_TRACEABILITY.md` | Requirement → implementation → evidence matrix, kept current    |
| `PHASE2_FINAL_VERIFICATION_REPORT.md` | Account of the `3f5add0`…`e1b2069` cycle and its verification   |
| `docs/ADVERSARIAL_REVIEW_FINDINGS.md` | The 34-finding review and the 19-agent browser-exposure audit   |

---

## 1. Repository state

Measured, not recalled. Every value below is the output of the command named.

| Fact                        | Value                                                | Command                                |
| --------------------------- | ---------------------------------------------------- | -------------------------------------- |
| Branch                      | `claude/desi-event-js-stack-gb4uqe`                  | `git rev-parse --abbrev-ref HEAD`      |
| Local HEAD                  | `a949cb7be1043f3576d608b1b1159e27a30c2099`           | `git rev-parse HEAD`                   |
| Upstream ref                | `origin/claude/desi-event-js-stack-gb4uqe`           | `git rev-parse --abbrev-ref @{u}`      |
| Upstream HEAD               | `a949cb7be1043f3576d608b1b1159e27a30c2099`           | `git rev-parse @{u}` after `git fetch` |
| Local equals upstream       | **yes**                                              | the two hashes above                   |
| Working tree                | **clean** — `git status --porcelain` printed nothing | `git status --porcelain`               |
| Worktrees                   | one, the repository itself                           | `git worktree list`                    |
| Last executable-code commit | `e1b2069`                                            | see below                              |

**Last executable-code commit.** `a949cb7` and `fe60872` change only Markdown.
`e1b2069` is the newest commit touching a `.js`, `.jsx`, `.mjs`, `.cjs`, `.sql`,
`.json` or `.prisma` file — one file, `apps/web/playwright.config.js`.

```
$ for c in $(git log --format=%h -10); do
    n=$(git show --name-only --format= "$c" | grep -cE '\.(js|jsx|mjs|cjs|sql|json|prisma)$')
    echo "$c code-files=$n"
  done
a949cb7 code-files=0     ← docs only
fe60872 code-files=0     ← docs only
e1b2069 code-files=1     ← last executable-code commit
02747f4 code-files=2
71a3b8e code-files=17
```

**Which commit contains each report.**

| Report                                | Introduced in | Last changed in |
| ------------------------------------- | ------------- | --------------- |
| `PHASE2_IMPLEMENTATION_REPORT.md`     | `e93d4e9`     | `fe60872`       |
| `PHASE2_REQUIREMENTS_TRACEABILITY.md` | `e93d4e9`     | `fe60872`       |
| `PHASE2_COMPLETION_REPORT.md`         | `cea7470`     | `fe60872`       |
| `PHASE2_FINAL_VERIFICATION_REPORT.md` | `fe60872`     | `a949cb7`       |
| `docs/ADVERSARIAL_REVIEW_FINDINGS.md` | `9b3dab1`     | `fe60872`       |

---

## 2. Reconciliation of disputed numbers

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

## 4. Findings NF-04 to NF-21

All eighteen are closed. NF-04 to NF-16 were re-verified against the code at
`a949cb7`, not against the prose that claimed them; NF-17 to NF-21 were found,
reproduced and closed in this cycle.

| ID        | Finding                                                                       | Closed in            | Evidence at `a949cb7`                                                                                                                        | Status                 |
| --------- | ----------------------------------------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| **NF-04** | An `OrderItem` could reference a `TicketType` from a different event          | `7777322`            | Trigger `desi_order_item_event_matches` in `20260915020000_phase2_integrity_triggers/migration.sql`                                          | `DB-ENFORCED`          |
| **NF-05** | Capability guard asserted with no organisation scope                          | `3a2d4ff`            | `packages/api-contract/src/validate.js:211` refuses a scoped capability declared without a `capabilityScope`                                 | `AUTOMATICALLY TESTED` |
| **NF-06** | `contract:check` could not see a stale OpenAPI artefact                       | `0786fdf`, `6714f1a` | `apps/api/src/lib/openapi-artifact.js`; `build` runs `--check` and never writes; `apps/api/tests/openapi-artifact.test.js`                   | `AUTOMATICALLY TESTED` |
| **NF-07** | `desi_hold_item_session_matches` had no probe                                 | `289e4a0`            | Two probes in `packages/db/scripts/phase2-probes.mjs`, one per trigger branch, asserting the refusal messages                                | `DB-ENFORCED`          |
| **NF-08** | The other half of the capability-scope hole                                   | `3a2d4ff`            | `validate.js:202-216` — the comment names the half that was left open                                                                        | `AUTOMATICALLY TESTED` |
| **NF-09** | Scheduled rotation locked out bearer clients                                  | `b37b242`            | `apps/api/src/lib/sessions.js:127` — "A bearer caller is deliberately _not_ rotated"                                                         | `AUTOMATICALLY TESTED` |
| **NF-10** | Rotation claimed on every privilege change, delivered only on password change | `02e4571`            | `apps/api/src/lib/sessions.js` `rotateSession`, called from every privilege-changing route                                                   | `AUTOMATICALLY TESTED` |
| **NF-11** | `requireStepUp` always used the module default window                         | `12ebd07`            | `apps/api/src/plugins/auth.js:495-506` — `stepUpWindowFor(policy)`, which throws on an unknown policy                                        | `AUTOMATICALLY TESTED` |
| **NF-12** | Step-up for a privileged account with no factor was a re-typed password       | `51feced`            | `PRIVILEGED_ORG_ROLES` in `packages/auth/src/sessions.js`; `mfaExempt` in the route contract keeps enrolment reachable                       | `AUTOMATICALLY TESTED` |
| **NF-13** | Acyclicity check caught only reciprocal edges                                 | `12ebd07`            | `packages/permissions/src/capabilities.js:324` `findRoleCycle` — depth-first, returns the loop                                               | `AUTOMATICALLY TESTED` |
| **NF-14** | Event detail served an organiser's contact address to anonymous callers       | `33c78ff`            | `apps/api/src/lib/presenters.js:80` `toPublicOrganizer` — an allow-list, not a row                                                           | `AUTOMATICALLY TESTED` |
| **NF-15** | Platform password hashing reached the production client bundle                | `3e9a327`, `62d3e66` | `apps/web/src/lib/browser-bundle.js` import-graph guard; `pnpm run bundle:scan` finds `scrypt` absent from all 173 browser-deliverable files | `AUTOMATICALLY TESTED` |
| **NF-16** | The API and worker deployment contract shipped in the browser bundle          | `33f2d7d`, `a894258` | `pnpm run bundle:scan` finds `DATABASE_URL`, `JWT_SECRET`, `AUTH_SECRET`, `PLACEHOLDER_SECRETS` absent from all 173                          | `AUTOMATICALLY TESTED` |

| **NF-17** | Creating an event accepted a caller-supplied `status`, skipping review | `8661bbf` | `apps/api/tests/event-lifecycle.test.js` — "ignores a status the caller supplies" | `AUTOMATICALLY TESTED` |
| **NF-18** | The publish route wrote any of thirteen statuses with no transition check | `8661bbf` | `packages/schemas/src/lifecycle.js` table; `apps/api/src/lib/event-lifecycle.js`; 34 + 20 + 11 tests | `AUTOMATICALLY TESTED` |
| **NF-19** | Every pre-publication state was served to anonymous callers, `moderationNote` too | `8661bbf` | Three fixtures in non-public states; `apps/api/tests/event-lifecycle.test.js` — "what a stranger may see" | `AUTOMATICALLY TESTED` |
| **NF-20** | A `TicketType` could name an `EventSession` from a different event | `8661bbf` | Trigger `desi_ticket_type_session_matches`; `apps/api/tests/event-lifecycle-integration.test.js` | `DB-ENFORCED` |
| **NF-21** | An `Event` could end before it started | `8661bbf` | CHECK `event_ends_after_start`; same integration suite | `DB-ENFORCED` |

NF-01 through NF-03 predate this range and are recorded in
`docs/ADVERSARIAL_REVIEW_FINDINGS.md`. NF-17 through NF-21 were found and closed
in this cycle; each was reproduced with a failing test first.

---

## 5. The twenty completion gates

| #   | Gate                                                                       | Status      | Evidence                                                                                                            |
| --- | -------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------- |
| 1   | NF-06 fixed and proven                                                     | **MET**     | §4; `apps/api/tests/openapi-artifact.test.js`                                                                       |
| 2   | Report inconsistencies reconciled                                          | **MET**     | §2 of this document; the 19-agent audit in `docs/ADVERSARIAL_REVIEW_FINDINGS.md`                                    |
| 3   | Organizer verification, public routes, venues, venue maps, event lifecycle | **PARTIAL** | Verification `77b3040`; venues and venue maps `98dd142`…`71a3b8e`. **Event lifecycle and moderation: not started.** |
| 4   | GA and reserved inventory concurrency-safe                                 | **MET**     | Nine real-PostgreSQL probes in `db:verify:fresh`                                                                    |
| 5   | Attendee completes mock checkout through order, payment, ledger, tickets   | **PARTIAL** | General admission end to end in `apps/api/tests/checkout-ledger.test.js`; no seated order bought end to end         |
| 6   | Provider calls outside database transactions                               | **MET**     | Proven by instrumentation                                                                                           |
| 7   | Timeouts enter durable reconciliation and can be resolved safely           | **PARTIAL** | They enter it; nothing can resolve it                                                                               |
| 8   | Full and partial refunds, no over-refund                                   | **NOT MET** | Database ceilings exist; no refund service                                                                          |
| 9   | Dispute, transfer, payout state machines in mock mode                      | **NOT MET** | Ledger composition exists; no services                                                                              |
| 10  | Every completed commerce action posts balanced protected ledger entries    | **PARTIAL** | True for a paid order; the other actions do not exist to post                                                       |
| 11  | Ticket transfer, revocation, check-in concurrency-safe                     | **NOT MET** | Phase 1 check-in carried; no transfer, no revocation                                                                |
| 12  | Notifications use an idempotent outbox                                     | **NOT MET** | Table exists, nothing writes it                                                                                     |
| 13  | Organizer and operations dashboards                                        | **NOT MET** | The venue screens are the only authenticated surface                                                                |
| 14  | Phase 2 UI passes accessibility and responsive tests                       | **PARTIAL** | Venue and map screens at phone, tablet and desktop, with reduced motion; the rest do not exist                      |
| 15  | All 20 required E2E journeys pass                                          | **NOT MET** | §6 — none of the twenty exist                                                                                       |
| 16  | Load and reliability tests exist                                           | **NOT MET** | —                                                                                                                   |
| 17  | CI enforces the Phase 2 gates                                              | **NOT MET** | No workflow                                                                                                         |
| 18  | All required documentation complete                                        | **NOT MET** | §7 — twelve of the named documents do not exist                                                                     |
| 19  | Production payments technically disabled                                   | **MET**     | Kill switch, asserted in a real process                                                                             |
| 20  | All code-owned checks pass, committed, pushed, clean tree                  | **MET**     | §8; §1                                                                                                              |

**Six met, five partial, nine not met.**

Gate 15 is scored `NOT MET` here rather than `PARTIAL`. The twelve venue
journeys are real and passing, but they are not among the twenty the brief
names; counting them toward gate 15 would be scoring the wrong test.

---

## 6. The twenty required end-to-end journeys

The twenty are the event-lifecycle journeys. None existed at `a949cb7`. After
`8661bbf` the lifecycle behind thirteen of them is built and tested at the API
level; no browser journey exists for any of the twenty.

| #   | Journey                                                         | Status                       | Where                                                                                       |
| --- | --------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------- |
| 1   | Verified organizer creates a draft event                        | `IMPLEMENTED` (API only)     | `apps/api/tests/event-lifecycle.test.js`; no browser journey                                |
| 2   | Organizer configures sessions and GA inventory                  | `NOT IMPLEMENTED`            | No session-authoring routes exist                                                           |
| 3   | Organizer selects a published reserved-seat map version         | `DB-ENFORCED`                | The database refuses a draft map on a session; no authoring route and no UI                 |
| 4   | Organizer submits event for review                              | `AUTOMATICALLY TESTED` (API) | `events.submitReview`; no browser journey                                                   |
| 5   | Unauthorized organization member cannot submit it               | `AUTOMATICALLY TESTED` (API) | "cross-organisation attempts"; no browser journey                                           |
| 6   | Moderator requests changes                                      | `AUTOMATICALLY TESTED` (API) | `moderation.decide`; no browser journey                                                     |
| 7   | Organizer updates and resubmits                                 | `IMPLEMENTED` (API only)     | CHANGES_REQUIRED to REVIEW_PENDING is in the table and tested                               |
| 8   | Moderator approves                                              | `AUTOMATICALLY TESTED` (API) | "lets a moderator approve, and records who and why"                                         |
| 9   | Authorized organizer publishes                                  | `AUTOMATICALLY TESTED` (API) | `events.publish`; no browser journey                                                        |
| 10  | Unverified organizer cannot publish                             | `AUTOMATICALLY TESTED` (API) | `apps/api/tests/event-lifecycle-integration.test.js` — "a failed transition writes nothing" |
| 11  | Reserved event cannot publish with a draft map                  | `AUTOMATICALLY TESTED` (API) | The service gate and the database refusal, both asserted                                    |
| 12  | Published event appears publicly                                | `AUTOMATICALLY TESTED` (API) | The visibility set; no browser journey                                                      |
| 13  | Draft and rejected events remain private                        | `AUTOMATICALLY TESTED` (API) | NF-19 regression cover; no browser journey                                                  |
| 14  | Public page works without JavaScript                            | `NOT IMPLEMENTED`            | Exists for the venue page, not for an event in a lifecycle state                            |
| 15  | Event editor works by keyboard                                  | `NOT IMPLEMENTED`            | No event editor exists                                                                      |
| 16  | Event screens pass phone, tablet, desktop, zoom, reduced motion | `NOT IMPLEMENTED`            | No event screens exist                                                                      |
| 17  | Material post-publication change requires confirmation          | `NOT IMPLEMENTED`            | `materialChanges()` exists and is tested; nothing calls it yet                              |
| 18  | Sales can be paused and resumed                                 | `IMPLEMENTED` (API only)     | `events.pauseSales`, `events.openSales`; no browser journey                                 |
| 19  | Cancellation creates notification/refund work exactly once      | `AUTOMATICALLY TESTED` (API) | "cancellation creates the work it owes, exactly once"                                       |
| 20  | Cross-organization edit and publication attempts are denied     | `AUTOMATICALLY TESTED` (API) | "cross-organisation attempts"; no browser journey                                           |

**None of the twenty exists as a browser journey.** Thirteen are asserted at the
API level, which is where the authorization and state rules actually live and is
the stronger assertion for those rules — but the brief asks for browser
journeys, and API coverage is not what it asks for. Gate 15 therefore stays
`NOT MET`. Seven are not implemented at all.

Browser coverage that **does** exist, and which these twenty are separate from:

| Suite                         | Tests | What it covers                                                       |
| ----------------------------- | ----: | -------------------------------------------------------------------- |
| `pnpm run test:e2e`           |   118 | Public catalogue, filters, accessibility, reduced motion, venue page |
| `pnpm run test:e2e:prod`      |    19 | Not-found behaviour against a compiled build                         |
| `pnpm run test:e2e:organizer` |    13 | The twelve venue and venue-map journeys                              |

---

## 7. The sixteen required documents

| Document                                       | Status                                                                                                              |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `apps/api/openapi.json` (the OpenAPI source)   | **CURRENT** — generated from the route table and drift-checked                                                      |
| `docs/adr/0003-stripe-connect-charge-model.md` | **WRITTEN**                                                                                                         |
| `docs/adr/0004-plpgsql-in-migrations.md`       | **WRITTEN**                                                                                                         |
| `docs/language-policy.md`                      | **UPDATED** for Phase 2 (§6)                                                                                        |
| `.env.example`                                 | **UPDATED** for Phase 2                                                                                             |
| `README.md`                                    | **NOT UPDATED** — last touched in `9b3dab1` (Phase 1); zero mentions of venue, ledger, verification, MFA or step-up |
| `docs/architecture.md`                         | **NOT UPDATED** — same commit; one incidental mention of "venue"                                                    |
| `docs/api.md`                                  | **NOT UPDATED** — same commit; no venue-map, ledger or MFA content                                                  |
| `docs/DATA_MODEL.md`                           | `NOT IMPLEMENTED`                                                                                                   |
| `docs/SECURITY.md`                             | `NOT IMPLEMENTED`                                                                                                   |
| `docs/UX.md`                                   | `NOT IMPLEMENTED`                                                                                                   |
| `docs/PROVIDERS.md`                            | `NOT IMPLEMENTED`                                                                                                   |
| `docs/DECISIONS.md`                            | `NOT IMPLEMENTED` — ADRs live in `docs/adr/` instead                                                                |
| `docs/PAYMENTS.md`                             | `NOT IMPLEMENTED`                                                                                                   |
| `docs/STRIPE_CONNECT.md`                       | `NOT IMPLEMENTED`                                                                                                   |
| `docs/FINANCIAL_LEDGER.md`                     | `NOT IMPLEMENTED`                                                                                                   |
| `docs/REFUNDS_DISPUTES.md`                     | `NOT IMPLEMENTED`                                                                                                   |
| `docs/RECONCILIATION_RUNBOOK.md`               | `NOT IMPLEMENTED`                                                                                                   |
| `docs/CHECK_IN.md`                             | `NOT IMPLEMENTED`                                                                                                   |
| `docs/PHASE2_THREAT_MODEL.md`                  | `NOT IMPLEMENTED`                                                                                                   |

Verified by `test -f` on each path, and by grepping the three existing-but-stale
files for Phase 2 vocabulary.

**Four written or updated, three present but carrying no Phase 2 content, twelve
absent, one current by construction.** The brief names sixteen documents and
this table has twenty rows, because the matrix also tracks the two ADRs, the
language policy and `.env.example`, which the brief counted differently. That
mismatch is recorded rather than smoothed over; the twelve absent documents are
the number that matters.

---

## 8. The clean baseline at `a949cb7`

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

## 9. Verification at `8661bbf`

Run with PostgreSQL 16.13 and Redis 7.0.15 up, caches deleted first, browser
suites one at a time on a four-core machine.

| #   | Command                       | Exit | Elapsed | Result                                                     | Cache                     |
| --- | ----------------------------- | ---: | ------- | ---------------------------------------------------------- | ------------------------- |
| 1   | `pnpm run policy:check`       |    0 | 1s      | 464 files, no violations                                   | n/a                       |
| 2   | `pnpm run secrets:scan`       |    0 | 1s      | 463 files, nothing credential-shaped                       | n/a                       |
| 3   | `pnpm run format:check`       |    0 | 8s      | clean                                                      | n/a                       |
| 4   | `pnpm run lint`               |    0 | 9s      | no problems                                                | n/a                       |
| 5   | `pnpm run contract:check`     |    0 | 2s      | **71 routes**, 71 operations, 64 paths; artefact current   | n/a                       |
| 6   | `pnpm run test`               |    0 | 65s     | **3,901 passed, 0 failed, 0 skipped**, 138 files, 16 tasks | **0 of 16 cached** (cold) |
| 7   | `pnpm run db:verify:fresh`    |    0 | 12s     | **68/68**                                                  | n/a                       |
| 8   | `pnpm run db:verify:upgrade`  |    0 | —       | **20/20**, 14 triggers, 9 migrations                       | n/a                       |
| 9   | `pnpm run build`              |    0 | 17s     | 3 tasks                                                    | **0 of 3 cached** (cold)  |
| 10  | `pnpm audit`                  |    0 | 0s      | no known vulnerabilities                                   | n/a                       |
| 11  | `pnpm run bundle:scan`        |    0 | 1s      | 173 browser-deliverable files, nothing server-only         | n/a                       |
| 12  | `pnpm run test:e2e`           |    0 | 91s     | **118 passed**                                             | n/a                       |
| 13  | `pnpm run test:e2e:prod`      |    0 | 13s     | **19 passed**                                              | n/a                       |
| 14  | `pnpm run test:e2e:organizer` |    0 | 36s     | **13 passed**                                              | n/a                       |

**Failures during the cycle, and their causes.** Three commands failed on a
first attempt and each was a real defect rather than a flake:

1. `pnpm run test` — `routesByTag('events')` listed six route ids where there are
   now sixteen. The expectation was updated to the full list in declaration
   order, so a route inserted in the wrong place in the table is visible there.
2. `pnpm run db:verify:upgrade` — the new migration was classified as
   pre-Phase-2, so its `TicketType` trigger fired against a table that did not
   yet have `eventSessionId`, and its `Event` CHECK refused the row filler's
   zero-length window. Both were fixed at the verifier's own documented
   extension points: the migration was added to `PHASE2_MIGRATIONS`, and the
   filler was given a coherent window rather than the constraint being relaxed.
3. `pnpm run test:e2e` — a filter live-region regex read
   `/events? match your filters/`, which matches the plural phrasing only. The
   component correctly writes "1 event matches your filters" for a single
   result, so the test passed for exactly as long as the filtered count happened
   to be above one. A latent defect this run surfaced, not one this cycle
   introduced.

**No retry was needed anywhere.** Nothing was re-run in the hope of a different
answer; each failure was diagnosed and fixed, then the command was run again.

**Container restart.** The sandbox restarted at the start of this cycle and
neither PostgreSQL nor Redis was running. Both were started before any command,
and the Redis init script prints
`ulimit: error setting limit (Operation not permitted)` in this sandbox and
starts anyway. Environment quirk, not a repository defect.

---

## 10. What this cycle built, and what it did not

**Built and tested.**

- The lifecycle as a graph — `packages/schemas/src/lifecycle.js`, 34 tests
  including a reachability proof that every status is reachable from DRAFT and a
  coverage proof that the table names every member of the enum.
- The transition service — `apps/api/src/lib/event-lifecycle.js`: table, then
  entitlement, then gates, then a conditional write, in that order.
- Seven lifecycle commands and two moderation routes, all in the contract and
  the regenerated OpenAPI artefact.
- Cancellation and postponement work — idempotent notices, refund rows created
  `REQUESTED` and left there.
- 11 real-PostgreSQL integration tests covering concurrent submission,
  concurrent moderation, concurrent publication, partial-write rollback,
  illegal transitions and the two new database invariants.
- Five findings, NF-17 to NF-21, each reproduced before being fixed.

**Not built.** Stated plainly because the brief asked for it and it is not here:

| Area                                                                     | Status                                                                            |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Event authoring API: sessions, ticket types, price zones, sales windows  | `NOT IMPLEMENTED`                                                                 |
| Inventory preparation command                                            | `NOT IMPLEMENTED` — the gate that checks it exists and is tested                  |
| All-in price preview                                                     | `NOT IMPLEMENTED`                                                                 |
| Organizer event list, create workflow, multi-step editor, draft autosave | `NOT IMPLEMENTED`                                                                 |
| Organizer preview, moderator queue UI                                    | `NOT IMPLEMENTED`                                                                 |
| Event JSON-LD, canonical metadata, sitemap changes for lifecycle states  | `NOT IMPLEMENTED`                                                                 |
| The twenty browser journeys                                              | `NOT IMPLEMENTED` — §6                                                            |
| Material-change confirmation flow                                        | `NOT IMPLEMENTED` — `materialChanges()` exists and is tested; nothing calls it    |
| Attendee notification _delivery_                                         | `SEAM ONLY` — rows are written; no worker sends them                              |
| Refund execution                                                         | `NOT IMPLEMENTED` — deliberately; see NF-20's neighbours in the findings document |

Gate 3 is `PARTIAL` and gate 15 is `NOT MET` for exactly these reasons.

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
