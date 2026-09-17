# Phase 3 — Phase 1: privacy authorization, policy enforcement and schema

**No user data was redacted in Phase 1.**

Nothing in this phase redacts anything, and nothing in it can. What it builds is
the floor an irreversible action needs before it is safe to write: a capability
narrow enough to grant to one role, a step-up policy that says what it protects,
a data model whose constraints refuse the mistakes, and an audit trail the
database will not let anybody rewrite.

---

## 1. Commit and CI

|                           |                                                                  |
| ------------------------- | ---------------------------------------------------------------- |
| Branch                    | `claude/desi-event-js-stack-gb4uqe`                              |
| Parent                    | `f7cbe25f9636a7651b75a43a8704d33622367011`                       |
| Baseline CI on the parent | run `35185073072`, `workflow_dispatch`, **success, 8 of 8 jobs** |

A feature-branch push triggers no workflow in this repository — `ci.yml` fires on
`push` to `main`, on `pull_request` and on `workflow_dispatch` — so CI for this
phase is obtained by dispatching the workflow against the exact pushed SHA.

### 1.1 The first push failed CI, and why

|                 |                                                                                                       |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| Commit          | `aeb65d6133e6c1daf5ddc0e8980544b962756884`                                                            |
| Run             | `35187664416`, `workflow_dispatch`, attempt 1                                                         |
| Conclusion      | **failure**                                                                                           |
| Jobs            | 7 of 8 `success`; `Browser — organiser venue maps` **failure** at step 10, `Run organiser venue maps` |
| Cancellations   | none                                                                                                  |
| Within that job | 8 passed, 2 failed, 3 did not run                                                                     |

Two failures, and they are not the same thing.

**The first was not reproducible and no mechanism connects it to this change.**
Test 9, `publishes a map, which then refuses to change, clones, and keeps
history`, timed out after 10 seconds waiting for `State: Frozen`. The publish
call had already returned `200`; what never happened was the page request the
following `page.reload()` should have made — no `GET /organizer/map-versions/...`
appears in the log for those ten seconds, so the browser's reload produced no
server request rather than producing a wrong answer. The runner logged
`Slow filesystem detected` on the same job. The suite was run four times
locally against real PostgreSQL 16 and Redis 7 with this change applied and
passed 13 of 13 every time, and nothing in this phase touches the publish path,
the map-version page, or any code the reload reaches.

That is **not** a claim that it was a flake. It is the state of the evidence:
this job had succeeded on six consecutive prior runs, so the coincidence is
recorded rather than explained away, and the next run is the test.

**The second failure was caused by this change, and is fixed.** Test 10 failed
at 0 ms with `Unique constraint failed on the constraint: User_email_key`,
thrown from `seedOrganizer` inside `beforeAll`. The chain is exact: Playwright
discards a worker after a test fails and starts a fresh one, `afterAll` runs on
the way out, and `beforeAll` runs again in the new worker with the same run tag.
`cleanupOrganizer` deletes sessions, factors, memberships and organisations —
and, until this phase, the user. It no longer can, because
`desi_audit_log_immutable` refuses the `SET NULL` update that deleting an actor
makes to their audit rows. So the re-seed's `user.create` collided.

The effect was worse than one extra failure: it turned a single failing test
into a suite that could not continue, and three tests did not run at all.

The fix is to make seeding idempotent rather than dependent on deletion, which
is the better contract anyway: the three e2e seeds now `upsert` their users by
e-mail. Proven by seeding, cleaning up and re-seeding the same tag — exactly
what a worker restart does — for all three suites, and by running the organiser,
events and refusals suites in full against a real stack.

### 1.2 The recorded run for this phase

|                       |                                                         |
| --------------------- | ------------------------------------------------------- |
| Commit                | `d177e2de1e1c4c390dcc6080f305d728939f05fa`              |
| Run                   | `35189099797`, `workflow_dispatch`, attempt 1           |
| Conclusion            | **success**                                             |
| Jobs                  | **8 of 8 success**                                      |
| Steps                 | 145 — **137 success, 8 skipped, 0 other**               |
| Skipped steps         | the eight `if: failure()` artefact uploads, one per job |
| Check runs on the SHA | 8, every one `success`                                  |
| Cancellations         | none                                                    |

The eight skipped steps are the only steps skipped, and they are skipped on
every green run by construction: an upload guarded by `if: failure()` cannot run
when nothing failed. That is worth stating rather than glossing, because a green
run is exactly the run that never exercises them — the previous, failing run did,
and it succeeded.

Test 9, the one failure that could not be attributed to this change, passed on
this run without any test being skipped, any timeout raised, any retry added, or
the previous run being re-run to obtain a green.

### 1.3 Phase 1 status: PARTIAL

Complete against every item of the approved Phase 1 scope, with one deliberate
deviation and one deliberate deferral. Both are named here rather than rounded
away, which is why the word is PARTIAL and not COMPLETE.

**Deferred — Connect audit action constants.** `docs/PHASE3_IMPLEMENTATION_PLAN.md`
§15 places "redaction **and Connect** audit action constants" in Phase 1. The
redaction constants are here; the Connect ones are not. They would have no
writer until Phase 4, and this repository's own evidence culture treats a
declared-but-uncalled constant as a defect rather than preparation — four
existing `AUDIT_ACTIONS` entries are already unused and are recorded as a smell.
They land with the Connect work that writes them. Nothing depends on them in the
meantime.

**Added — two read routes.** The same plan section says Phase 1 excludes "any
route, UI or redaction logic". Two `GET` routes ship here, because the approving
instruction asked for "route-contract, service-level, and authorization
validation needed for future privacy actions" and for route contract tests, and
because `apps/api/tests/contract.test.js` asserts that every contract route is
registered — so a descriptor cannot exist without a handler. Neither route
redacts anything, neither has a side effect, and no user-data redaction route was
created.

Every check below was run locally against real PostgreSQL 16 and Redis 7 before
the push.

| Check                 | Result                                                            |
| --------------------- | ----------------------------------------------------------------- |
| `policy:check`        | OK — 623 files, no violations                                     |
| `ci:check`            | invariants hold                                                   |
| `secrets:scan`        | OK — 622 tracked files, nothing credential-shaped                 |
| `format:check`        | clean                                                             |
| `lint`                | clean                                                             |
| `contract:check`      | valid: 120 routes, 120 operations, 108 paths; artefact up to date |
| `test`                | 19 packages, **4,633 cases, 0 failed, 0 skipped**                 |
| `test:coverage`       | every floor met                                                   |
| `db:verify:fresh`     | **93 of 93 checks passed**                                        |
| `db:verify:upgrade`   | **24 of 24 checks passed**                                        |
| `build`               | 3 tasks successful                                                |
| `bundle:scan`         | 297 browser-deliverable files, nothing server-only present        |
| `payment-kill-switch` | 12 passed                                                         |
| `check-skipped-tests` | 4,633 cases, 0 skipped, 0 undeclared                              |

Coverage, with margins against the enforced floors:

| Package                | Lines | Branches  | Floor | Margin    |
| ---------------------- | ----- | --------- | ----- | --------- |
| `apps/api`             | 89.54 | **76.01** | 75    | **+1.01** |
| `packages/schemas`     | 96.00 | 79.24     | 75    | +4.24     |
| `packages/permissions` | 96.36 | 90.47     | 75    | +15.47    |
| `packages/auth`        | 99.60 | 95.61     | 75    | +20.61    |

The `apps/api` branch margin was the thinnest in the repository at `+0.83` before
this phase. Every file added here is at 100% line coverage and the margin went
**up**, which is the obligation this phase was under rather than a happy accident.

### 1.4 Clarification pass — the checks re-run on 2026-09-17

The table in §1.3 was measured before the push of `9fa5318`. It is left as
written, because it records what was true at that moment. This table is a fresh
measurement taken while producing §10–§13, against the same HEAD, with real
PostgreSQL 16 started locally for the database checks.

| Check                 | Result now                                                             |
| --------------------- | ---------------------------------------------------------------------- |
| `format:check`        | clean                                                                  |
| `policy:check`        | OK — **624** files scanned via git, no violations                      |
| `ci:check`            | invariants hold — 2 workflow files, 2 test tasks order their own build |
| `secrets:scan`        | OK — **623** tracked files, nothing credential-shaped                  |
| `lint`                | clean, no output                                                       |
| `contract:check`      | valid: 120 routes, 120 operations, 108 paths; artefact up to date      |
| `test`                | 19 tasks successful; `apps/api` 53 files, 1,037 cases                  |
| `check-skipped-tests` | **4,770** cases across 16 reports; 0 skipped, 0 undeclared             |
| `test:coverage`       | 18 tasks successful; floors met, table below                           |
| `db:verify:fresh`     | **93 of 93** checks passed                                             |
| `db:verify:upgrade`   | **24 of 24** checks passed                                             |
| `manifest:emit`       | regenerated; `git diff --exit-code` clean, no drift                    |
| `build`               | 3 tasks successful                                                     |
| `bundle:scan`         | 297 browser-deliverable files, nothing server-only present             |

| Package                | Lines | Branches  | Floor | Margin    |
| ---------------------- | ----- | --------- | ----- | --------- |
| `apps/api`             | 89.54 | **76.04** | 75    | **+1.04** |
| `packages/schemas`     | 96.00 | 79.24     | 75    | +4.24     |
| `packages/permissions` | 96.36 | 90.47     | 75    | +15.47    |
| `packages/auth`        | 99.60 | 95.61     | 75    | +20.61    |

**Two figures in §1.3 do not reproduce, and the current ones are the reliable
ones.**

- §1.3 records **4,633** cases; the run above counts **4,770** across all 16
  reports, itemised per package and summing exactly. No test file changed between
  `aeb65d6` and now — `d177e2d` touched only the Playwright seeds, which are not
  vitest cases, and `9fa5318` touched only documentation. The 4,633 figure could
  not be reproduced and its provenance could not be established. It is superseded
  rather than explained, which is the honest description.
- §1.3 records `apps/api` branches at **76.01**; the run above reports **76.04**.
  The difference is v8 counting, not a change in the code. Both clear the floor of
  75; the margin is `+1.04`, not `+1.01`.

Neither correction changes any conclusion. They are recorded because a report
that quietly replaces its own numbers is worth less than one that says which it
could not reproduce.

`skips:check` as a bare `pnpm` script exits 2 with a usage message: it takes
report paths as arguments and CI supplies them from `find`. That is its contract,
not a failure. Invoked the way CI invokes it, it passes.

---

### 1.5 What PARTIAL now depends on

Phase 1 remains **PARTIAL**. Nothing found in this clarification pass reopens any
completed item; what it adds is one more owner decision. The full list of what is
waiting on the owner, and nothing else is:

| #   | Decision                                                                                                                                       | Where                | Cost of choosing either way                                                                                         |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 1   | Add a test that asserts a `GET` on either privacy route leaves the store byte-for-byte unchanged                                               | §10.6                | Small. It closes the one gap §10.6 names honestly; nothing depends on it                                            |
| 2   | Stop writing `toEmail` into audit metadata at `tickets.js:374` and `:540`, or keep it                                                          | §11.6 item 2         | Keeping it keeps evidence the transfer flow was designed to hold. Stopping it trades that for a smaller PII surface |
| 3   | Adopt `safeAuditMetadataSchema` as a guard inside `recordAudit`                                                                                | §11.7                | Closes the structured class permanently. Cannot be switched on until decision 2 is taken                            |
| 4   | Move operator free text off audit metadata and onto the mutable domain row that already stores it, or accept that operator notes are unbounded | §11.2a, §11.6 item 5 | **New in this pass.** Up to twenty call sites. Accepting it means the retention policy must say so plainly          |
| 5   | Add the five Connect audit constants now, or leave them to Phase 4 with their writers                                                          | §12                  | Adding them now puts five unwritten constants in the map, which this repository treats as a defect                  |

Decisions 2, 3 and 4 are all about the same table and are best taken together.
None of the five blocks Phase 2 from starting; all five change what Phase 2 should
build.

**No application behaviour was changed in this pass.** The only files touched are
the three documents listed in §1.4's commit.

---

## 2. Authorization

### The capability

`privacy:redact`, in `packages/permissions/src/capabilities.js`. Thirty-seventh
in the vocabulary.

| Question                      | Answer                                                                                                                       |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Scope                         | Organisation-scoped. Not in `PLATFORM_ONLY_CAPABILITIES`                                                                     |
| Organisation roles holding it | **`OWNER` only**                                                                                                             |
| Platform roles holding it     | `SUPER_ADMIN` only, and only because that role is `[...ALL_CAPABILITIES]` by construction                                    |
| Permitted                     | Raising, confirming and executing a redaction for a subject inside the caller's own organisation; reading the request record |
| Prohibited                    | Any cross-organisation action, any platform-wide sweep, any change to retention policy                                       |

`OWNER` inherits `ADMIN`, so granting anywhere lower in the graph would hand the
authority to a superset by inheritance. Granting at `OWNER` is the narrowest the
table can express, and
`packages/permissions/src/capabilities.test.js` asserts that **exactly one**
organisation role holds it, so a future widening fails rather than ships.

### Why not something that already existed

| Candidate               | Why not                                                                                                                                                                                                                        |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `organization:manage`   | Routine administration — record, members, settings. Held by people who should rename the company without being able to destroy personal data. Widening it grants this to every existing holder with no review and no migration |
| `platform:admin`        | The key to everything. Redaction through it is unauditable as a distinct decision and ungrantable narrowly                                                                                                                     |
| `attendee:export`       | A bulk read. Reading and destroying are not one decision                                                                                                                                                                       |
| `CREDENTIAL` step-up    | Gates authentication authority, which is reversible: a factor can be re-enrolled                                                                                                                                               |
| `SECURITY_ROLE` step-up | Gates role changes, also reversible, and its name already describes something else                                                                                                                                             |

### The step-up policy

`PRIVACY_ERASURE = 2 * 60 * 1000`, in `packages/auth/src/sessions.js`. Two
minutes, the shortest tier in the table, matching the scale the codebase already
uses for what somebody does while looking at the screen.

A test asserts it is no wider than **any** other policy, so the table cannot
drift into gating an irreversible action more loosely than a reversible one.

**A window is not by itself sufficient, and the code says so.** Nothing consumes
`mfaSatisfiedAt`, so one step-up authorises every action inside its window.
Phase 2 therefore additionally requires a single-use server-issued confirmation
and a server-generated idempotency key; the schema already carries
`confirmationHash`, `confirmationExpiresAt` and a unique `idempotencyKey` for
exactly that.

### Server-side enforcement, in four layers

1. **Contract.** `capability: 'privacy:redact'` with `capabilityScope: 'params.id'`
   on both routes. Contract validation refuses an organisation-scoped capability
   with no scope, and refuses a scope naming an optional or absent key.
2. **Route guard.** `requireCapability` reads the scope from the path and throws
   `CAPABILITY_SCOPE_MISSING` rather than asserting unscoped — finding NF-05.
3. **Query.** The organisation is in the same `where` that finds the rows, so
   another tenant's requests are not counted into `pagination.total`. A total is
   a leak in its own right.
4. **Service.** `assertSubjectBelongsToOrganization` refuses a subject the
   organisation holds nothing about. **This is the layer the capability check
   cannot replace for a platform administrator**, who holds every capability
   platform-wide and is granted it before an organisation id is consulted at
   all. It applies to every actor rather than special-casing a role.

---

## 3. Schema changes

Six models and nine enums, in
`packages/db/prisma/migrations/20260917060000_privacy_redaction_foundation/`.

| Model                   | What it is                                                   | Status                      |
| ----------------------- | ------------------------------------------------------------ | --------------------------- |
| `PrivacyRequest`        | One request to redact one person inside one organisation     | `DB-ENFORCED`               |
| `PrivacyHold`           | A legal or fraud matter keeping a subject's data in place    | `DB-ENFORCED`               |
| `PrivacyAuditEvent`     | Append-only, PII-free evidence of every privacy decision     | `DB-ENFORCED`               |
| `ExportArtifact`        | A generated export, and whether its bytes still exist        | `SCHEMA ONLY` until Phase 3 |
| `ExportArtifactSubject` | Which people an export is known to contain                   | `SCHEMA ONLY` until Phase 3 |
| `RetentionSweep`        | One run of the retention sweeper, including one that refused | `SCHEMA ONLY` until Phase 3 |

Enums: `PrivacyRequestReason`, `PrivacyRequestState`, `PrivacyHoldKind`,
`PrivacyHoldState`, `PrivacyHoldDecision`, `PrivacyAuditResult`,
`ExportArtifactState`, `RetentionSweepMode`, `RetentionSweepState`. All nine are
mirrored in `packages/schemas/src/enums.js`, which the standing drift guard in
`enums.test.js` requires — it caught them the first time the suite ran.

Counts moved: **49 → 55 models, 36 → 45 enums, 20 → 23 triggers, 34 → 59 CHECK
constraints.** Each verified by querying the database rather than by counting the
diff.

### What the database refuses

Twenty-five CHECK constraints, one partial unique index and three triggers. The
ones that carry the design:

| Rule                                                      | Mechanism                                                                                                 |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| A redaction cannot execute before its holds are evaluated | `privacy_request_executes_only_when_clear`                                                                |
| One subject has at most one redaction in flight           | `PrivacyRequest_one_in_flight_per_subject_key` — partial, so a `HELD` request does not block the next one |
| A terminal request must say what happened                 | `privacy_request_terminal_has_outcome`                                                                    |
| The state machine only moves forward                      | `desi_privacy_request_state_transition`                                                                   |
| A request cannot change which person it is about          | same trigger — identity columns frozen after insert                                                       |
| Privacy evidence cannot be edited or deleted              | `desi_privacy_audit_event_immutable`, unconditional                                                       |
| **Audit rows cannot be edited or deleted**                | `desi_audit_log_immutable`, unconditional                                                                 |
| A hold must name the matter holding the data              | `privacy_hold_names_its_matter`                                                                           |
| A dry-run sweep cannot claim to have changed anything     | `retention_sweep_dry_run_changes_nothing`                                                                 |

Every one of these has a probe in `packages/db/scripts/verify-fresh-database.mjs`
that asserts the write is refused **and** that the refusal names the constraint.

### The one consequence worth stating loudly

`AuditLog.actorId` is `ON DELETE SET NULL`, so deleting a `User` is an `UPDATE`
of every audit row that person produced — and that `UPDATE` is now refused.
**A person who has acted cannot be deleted.**

That is the intended design: erasure here is redaction and the `User` row
survives it. No route has ever deleted a user, so production behaviour is
unchanged. What it does change is fixture teardown, in five places, and those
are reworked to leave the rows with a comment saying why — mirroring the
existing precedent where a published venue-map version is deliberately not torn
down because "a teardown that undid it would be the thing disproving the
guarantee".

The seed also had to change: it upserted its sample audit rows by id, and the
second run's `UPDATE` is now refused. It creates the missing ones and leaves the
rest. `db:verify:fresh` asserts that seeding twice still leaves exactly the rows
seeding once did, and it does.

And the three Playwright seeds had to become idempotent, which the first CI run
is what proved — see §1.1. They `upsert` their users by e-mail rather than
creating them, so re-seeding a tag whose user survived cleanup works. That is a
better contract than the one it replaces: a seed that only worked because a
teardown had deleted its rows was a seed that could not be run twice.

---

## 4. Two pre-existing defects, fixed

### `AUDIT_ACTIONS.VERIFICATION_DECIDED` did not exist

`apps/api/src/routes/organizers.js` reads it when a moderator decides a
verification. It was never defined, so that call site passed `action: undefined`
into a `NOT NULL` column: against real PostgreSQL the whole moderation
transaction would have rolled back at a moderator's desk.

It survived two phases because the Prisma test double applies no required-column
checks and no integration suite covers that route.

Fixed by defining it, and — more usefully — by two guards that would have caught
it the day it was introduced. `recordAudit` now refuses a missing or blank
action and names the caller in the message. And `apps/api/tests/audit.test.js`
scans every `.js` file under `apps/api/src` for `AUDIT_ACTIONS.X` references and
asserts each one resolves to a string.

The guard is deliberately **not** a membership check against `AUDIT_ACTIONS`:
around thirty call sites still pass bare literals, and closing that vocabulary is
a cross-cutting change rather than this phase's job. It is recorded as a known
gap, not fixed quietly.

### `docs/SECURITY.md` said "ten named policies" when there were nine

Adding `PRIVACY_ERASURE` made the sentence accidentally correct. The document now
says so, and says to count from `STEP_UP_POLICIES` rather than from the prose.

---

## 5. Routes

Two, both reads, both `GET`.

| Route                  | Path                                                    |
| ---------------------- | ------------------------------------------------------- |
| `privacy.listRequests` | `GET /v1/organizations/:id/privacy/requests`            |
| `privacy.getRequest`   | `GET /v1/organizations/:id/privacy/requests/:requestId` |

**No route in this phase performs a redaction, and none has a side effect.**

The command routes are deliberately deferred to Phase 2, and the reason is a
control rather than a preference: `apps/api/tests/contract.test.js` asserts that
every route in the contract is registered on the server, so declaring a
descriptor before its handler exists either fails that test or requires shipping
the handler — which this phase forbids. The stronger control is kept; each
descriptor lands with its handler.

A read needs `privacy:redact` because reading who has asked to be removed is part
of the same decision as removing them.

---

## 6. Tests

| Suite                                        | Cases     | What it proves                                                                                                                     |
| -------------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `packages/permissions`                       | 587       | The capability exists, is held by exactly one org role, is not implied by any other, and is organisation-scoped                    |
| `packages/auth`                              | 356       | `PRIVACY_ERASURE` is two minutes, no wider than any other policy, and a step-up fresh enough for a payout is stale for a redaction |
| `packages/schemas`                           | 649       | Nine enums mirror the database exactly; the request payload names the subject by id and has no field for an address                |
| `apps/api/tests/privacy.test.js`             | 11        | Route-level authorization and non-enumeration                                                                                      |
| `apps/api/tests/privacy-scope.test.js`       | 13        | Organisation scope at the service layer, and the presenter's allow list                                                            |
| `apps/api/tests/audit.test.js`               | 11        | The audit writer refuses an action it cannot store; every referenced constant resolves                                             |
| `apps/api/tests/security-regression.test.js` | 23        | Three new whole-contract invariants (below)                                                                                        |
| `db:verify:fresh`                            | 93 checks | Every constraint and trigger, against real PostgreSQL                                                                              |
| `db:verify:upgrade`                          | 24 checks | The migration applies over a populated pre-Phase-3 database                                                                        |

Negative cases, named individually because they are the point:

- a manager, who may run the organisation, is refused
- an anonymous caller is refused
- an owner of a **different** organisation is refused
- another organisation's request and a request that never existed return the
  **same status, same code and same message**
- a subject filter that is an e-mail address is a 400, not a search
- a subject in another organisation and a subject who does not exist give the
  same 404 from the service layer
- the response carries no `confirmationHash`, no `idempotencyKey`, no
  `leaseOwner`, and neither the fixture's name nor its address
- `recordAudit` refuses `undefined` and refuses a blank string

Three new standing invariants over the whole route table:

1. Every non-`GET` route tagged `privacy` must declare `stepUp: 'PRIVACY_ERASURE'`.
2. Every route declaring `PRIVACY_ERASURE` must be tagged `privacy`, so the
   policy's name keeps describing what it protects.
3. Every route asserting `privacy:redact` must carry a `capabilityScope`.

The first two are why a Phase 2 command route cannot ship without the right
policy, and they hold today over a table that has no such command in it.

---

## 7. Documentation

- `docs/PRIVACY_AND_RETENTION.md` — new. Treatment by category, proposed
  retention, the authorization model and its rejected alternatives, holds,
  auditability, and the known limitations.
- `docs/DATA_MODEL.md` — the counts corrected, a Personal data section added, and
  the Phase 2 "Erasure is NOT IMPLEMENTED" heading marked
  **HISTORICAL STATUS, SUPERSEDED IN PART** with the Phase 2 text quoted intact
  rather than replaced. What is still true and what is no longer true are listed
  separately.
- `docs/SECURITY.md` — the new policy row, the capability count, and the audit
  immutability rule with its consequence.

Every duration in `docs/PRIVACY_AND_RETENTION.md` is marked
**PROPOSED — REQUIRES LEGAL/PRIVACY REVIEW**. No compliance claim is made
anywhere.

---

## 8. Known limitations

### `AuditLog.metadata` already contains e-mail addresses — `BLOCKED — REQUIRES OWNER DECISION`

**Corrected 2026-09-17.** The first revision of this section said "three paths
write raw addresses into audit metadata: ticket transfer, checkout and team
invitation". Two of those three were wrong, and the error was mine: it came from
reading a third-party summary rather than the call sites.

- `apps/api/src/lib/checkout.js:70` is **not** an audit row. It is the
  `metadata` handed to the payment provider's `createIntent`. No checkout audit
  row carries buyer identity — `ORDER_PAID` records reference, amounts, currency
  and status, and nothing else.
- `apps/api/src/routes/teams.js:292` writes
  `{ organizationId, role, requestedEventIds }`. The invited address goes to the
  delivery callback, never to the audit row.

The real exposure is narrower than reported, and is measured rather than
estimated: **68 `recordAudit` call sites were scanned across `apps/api/src` and
`apps/worker/src`; exactly two name a personal field.** Both are in
`apps/api/src/lib/tickets.js`. The full assessment is §11.

A second pass over the metadata **values** — as opposed to their keys — found a
further class this section did not name: up to twenty call sites write an
operator's free-text `reason` or `note` into audit metadata, under schemas that
bound length and not content, eight of them proven. That is §11.2a, and it is a separate owner decision.

### The audit action vocabulary is still open

Around thirty call sites pass bare string literals instead of `AUDIT_ACTIONS`
constants. The new guard catches an unresolved constant but not a typo'd literal.
Closing the vocabulary is a cross-cutting refactor outside this workstream.

### `LedgerEntry.memo` can never be redacted

`desi_ledger_entry_immutable` refuses any update once the batch is `POSTED`.
Financial immutability is the stronger control and is preserved.

### Two schema divergences predate this phase

`prisma migrate diff` proposes dropping `Event_languages_gin_idx` and
`TicketType_eventId_name_key`, because Prisma's schema language cannot express a
GIN index on a `text[]` or that unique index, so the generator does not see them.
Both are deliberate and hand-written in earlier migrations. **Neither drop is in
this migration**, and the file says why — the same limitation is why the partial
unique index added here is hand-written too.

### `ExportArtifact` and `RetentionSweep` have no writer yet

They are `SCHEMA ONLY` and labelled as such. Phase 3 of this workstream fills
them. A table with no writer is exactly the pattern this repository criticises
elsewhere, so it is named rather than left to be noticed.

---

## 9. A note on this document's numbering

Sections 10 to 13 were added after section 9 had been written, and section 9 was
the closing statement. Rather than renumber four sections that three other
documents already cite by number, the statement moved to the end as **section
14** and this note holds its place. Nothing was removed.

---

## 10. The two routes, in full

Both are `GET`. Neither redacts anything, neither writes anything, and there is
no third.

### 10.1 `privacy.listRequests`

| Property                  | Value                                                                         |
| ------------------------- | ----------------------------------------------------------------------------- |
| Method and path           | `GET /v1/organizations/:id/privacy/requests`                                  |
| Contract id               | `privacy.listRequests`                                                        |
| Auth                      | `session`                                                                     |
| Capability                | `privacy:redact`                                                              |
| Organisation scope        | `capabilityScope: 'params.id'` — the organisation in the path                 |
| `PRIVACY_ERASURE` step-up | **Not required, and not declared**                                            |
| Params                    | `id` (cuid, required)                                                         |
| Query                     | `page`, `perPage`, `state`, `subjectId` (all optional; `subjectId` is a cuid) |
| Body                      | `null` — a `GET` cannot declare one, and contract validation enforces that    |
| Response                  | `{ data: privacyRequest[], pagination }`                                      |
| Errors                    | 400, 401, 403, 404                                                            |

### 10.2 `privacy.getRequest`

| Property                  | Value                                                   |
| ------------------------- | ------------------------------------------------------- |
| Method and path           | `GET /v1/organizations/:id/privacy/requests/:requestId` |
| Contract id               | `privacy.getRequest`                                    |
| Auth                      | `session`                                               |
| Capability                | `privacy:redact`                                        |
| Organisation scope        | `capabilityScope: 'params.id'`                          |
| `PRIVACY_ERASURE` step-up | **Not required, and not declared**                      |
| Params                    | `id`, `requestId` (both cuid, both required)            |
| Query                     | `null`                                                  |
| Body                      | `null`                                                  |
| Response                  | `{ data: privacyRequest }`                              |
| Errors                    | 401, 403, 404                                           |

### 10.3 Why no step-up, stated rather than implied

Neither route declares `stepUp`, so **there is no expired-step-up test for them
and there cannot be one.** A read destroys nothing, and requiring a second
factor to look at a list would train operators to keep one to hand, which is the
opposite of what the control is for.

What guarantees this stays true as commands arrive is a standing whole-contract
invariant in `apps/api/tests/security-regression.test.js`: every **non-`GET`**
route tagged `privacy` must declare `stepUp: 'PRIVACY_ERASURE'`, and every route
declaring `PRIVACY_ERASURE` must be tagged `privacy`. A Phase 2 command route
cannot ship without the right policy.

`PRIVACY_ERASURE` is therefore **defined, tested and enforceable but not yet
enforced on any route**, because no route yet needs it. That is the honest
status.

### 10.4 What the response can carry

Exactly fourteen fields: `id`, `subjectId`, `state`, `reason`, `holdDecision`,
`policyVersion`, `correlationId`, `scope`, `outcomeCode`, `requestedAt`,
`confirmedAt`, `startedAt`, `completedAt`, `cancelledAt`.

Every one is an opaque row id, an enum, a timestamp, a policy string, or a list
of `{category, rows}` counts. **No direct or indirect personal information is
returned.** The subject is named by cuid and by nothing else: there is no
`subjectEmail`, no `subjectName`, no field that was or will be redacted.

Deliberately absent, each for its own reason: `confirmationHash` and
`idempotencyKey` (a confirmation an API hands back is not a confirmation, and a
key a caller can read is a key a caller can replay), `leaseOwner` and
`leaseExpiresAt` (a browser that can see a lease is one somebody will eventually
let steer one), `organizationId` (the caller supplied it in the path; echoing it
invites a client to trust the echo) and `heldByHoldId` (which matter holds
somebody's data is a different question from whether it is held).

### 10.5 Why they were required in Phase 1

The approving instruction asked for "route-contract, service-level, and
authorization validation needed for future privacy actions" and for route
contract tests. `apps/api/tests/contract.test.js` asserts that every route in
the contract is registered on the server, so a descriptor cannot be declared
without a handler — route-contract metadata and a handler arrive together or
not at all.

A read needs `privacy:redact` because reading who has asked to be removed is
part of the same decision as removing them.

### 10.6 Why they cannot mutate, and the evidence

| Evidence                                                                                               | Strength                                                                                                                  |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Both declared `GET`; `defineRoute` registers exactly the contract's method                             | structural                                                                                                                |
| Contract validation refuses a body on a bodyless method (`BODY_ON_BODYLESS_METHOD`)                    | structural, enforced by `pnpm contract:check`                                                                             |
| `apps/api/src/routes/privacy.js` contains **zero** write calls — only `findMany`, `count`, `findFirst` | verified by grep for `create\|createMany\|update\|updateMany\|upsert\|delete\|deleteMany\|executeRaw\|queryRaw`: no match |
| `apps/api/src/lib/privacy.js` likewise — only `findUnique` and `findFirst`                             | same                                                                                                                      |
| `apps/api/tests/contract.test.js` asserts the registered route set equals the contract's               | automated                                                                                                                 |

**Gap, stated plainly: no test directly asserts that a call leaves the store
unchanged.** The guarantee today is structural and by inspection, not by
assertion. A ten-line test — call both routes, compare `prisma._store` before
and after — would close it. It is not added here because this task's scope is
documentation; it is the first item in the owner-decision list.

### 10.7 Cross-organisation, capability and validation tests that do exist

| Property                                                                        | Test                                                                                      |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| An owner of a different organisation is refused                                 | `apps/api/tests/privacy.test.js` — `refuses an owner of a different organisation` (403)   |
| Another organisation's request is indistinguishable from one that never existed | `privacy.test.js` — asserts same status, same code, **same message**                      |
| The pagination total counts only the caller's organisation                      | `privacy.test.js` — `counts only this organisation into the pagination total`             |
| A subject in another organisation is refused at the service layer               | `privacy-scope.test.js` — `does not count a person who belongs to the other organisation` |
| Absent subject and foreign subject give the same 404 message                    | `privacy-scope.test.js` — `refuses one out of scope with a 404 that names no reason`      |
| Missing capability                                                              | `privacy.test.js` — `refuses a manager` (403 `FORBIDDEN`)                                 |
| No session                                                                      | `privacy.test.js` — `refuses a caller with no session at all` (401)                       |
| A subject filter that is an address is rejected                                 | `privacy.test.js` — 400 `VALIDATION_ERROR`                                                |
| The response carries no name, address, confirmation, key or lease               | `privacy.test.js` and `privacy-scope.test.js`                                             |
| Every `privacy:redact` route carries a `capabilityScope`                        | `security-regression.test.js`, whole-contract                                             |

### 10.8 Browser and UI exposure

| Needle                 | In `.next/static` (browser-deliverable) | In `.next/server` |
| ---------------------- | --------------------------------------- | ----------------- |
| `privacy:redact`       | **absent**                              | absent            |
| `PRIVACY_ERASURE`      | **absent**                              | absent            |
| `privacy.listRequests` | present, in the route manifest chunk    | present           |

The route **id and path** ship to the browser, exactly as all 120 routes' do:
the generated manifest is the browser's route table and carries
`{id, method, path, auth, body, query}` and nothing else. The **capability and
the step-up policy do not ship**, which is the property
`packages/api-contract/src/manifest.js` exists to hold and
`apps/api/tests/security-regression.test.js` asserts.

`pnpm bundle:scan` passes: 297 browser-deliverable files, nothing server-only
present.

**No UI consumes either route.** A search of `apps/web/src` for `privacy`
returns nothing. There is no privacy screen, and none is built until Phase 3 of
this workstream.

### 10.9 Gate

Against the stop conditions: neither route exposes personal data, both were
required for the approved Phase 1 scope, neither permits mutation,
cross-organisation tests exist at two layers, and browser exposure is the same
as every other route's. **Not BLOCKED.**

---

## 11. Historic `AuditLog` personal data — decision memo

### 11.1 The decision, for the record

> Existing immutable `AuditLog.metadata` may contain historical personal data
> from transfer, checkout, and invitation workflows. Existing rows will not be
> edited, deleted, or redacted. Future audit metadata must contain no personal
> data. Future privacy-redaction actions will add a new immutable safe audit
> event rather than modifying historic audit rows.

Recorded as an unresolved decision. **No attempt has been made, and none will be
made, to redact existing `AuditLog` rows.**

Two qualifications on the wording, because the measurement disagrees with it in
both directions.

**Narrower than stated.** Checkout and invitation do **not** write personal data
into audit metadata. See §11.2. The scope the decision covers is smaller than it
assumes, which makes it easier to honour rather than harder.

**Wider than stated.** "Future audit metadata must contain no personal data" is
not a property any current check enforces, and as many as twenty call sites
write operator free text that can contain it. See §11.2a. Honouring that sentence is work that
has not been done, not a state the system is already in.

The decision stands as written. These are the two facts needed to act on it.

### 11.2 Which paths can contain personal data — measured

Every `recordAudit` call site in `apps/api/src` and `apps/worker/src` was parsed
and its `metadata` object inspected for a personal key, with comments stripped so
prose could not produce a false positive.

**68 call sites scanned. Exactly 2 name a personal field.**

> **Corrected 2026-09-17, second pass.** This line first said 69. The exact
> figure is 68: `grep -c` over `apps/api/src` and `apps/worker/src` finds 88
> occurrences of `recordAudit`, of which 19 are imports and one is the
> definition at `apps/api/src/lib/audit.js:109`. All 68 remaining occurrences
> are `await recordAudit(` invocations; none is a comment reference. Three of
> the 68 pass no `metadata` at all.

| Path                              | Action                    | Field     | Why it is there                                                                  |
| --------------------------------- | ------------------------- | --------- | -------------------------------------------------------------------------------- |
| `apps/api/src/lib/tickets.js:374` | `ticket.transfer_started` | `toEmail` | The code's own comment: "who a ticket was offered to is the point of the record" |
| `apps/api/src/lib/tickets.js:540` | `ticket.transfer_ended`   | `toEmail` | Same record, closed out                                                          |

Both deliberately exclude the transfer token; the comment at `tickets.js:383-385`
says so — "Never the token: that is a bearer secret and an audit row is read by
more people than a database row."

**Not personal data, contrary to the earlier report:**

| Claimed                            | Actual                                                                                                                                       |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/lib/checkout.js:70`  | The payment provider's `createIntent` metadata, not an audit row. The `ORDER_PAID` audit row carries reference, amounts, currency and status |
| `apps/api/src/routes/teams.js:292` | `{ organizationId, role, requestedEventIds }`. The invited address goes to the delivery callback                                             |
| `apps/api/src/routes/auth.js:946`  | `account: request.currentUser.email` is in the **TOTP URI of the response body**, not in an audit row                                        |

### 11.2a A second class the first measurement missed — operator free text

The measurement above asks whether a metadata **key** names a personal field. It
does not ask whether a metadata **value** can carry one. Re-running the scan over
the values found a second class, and the first version of this memo did not
mention it.

Twenty-five of the 68 metadata blocks carry a `reason`, `reasonNote`, `note`,
`holdReason`, `escalationReason` or `changeReason` key. Five of those are
internal literals and cannot carry anything an operator typed:

| Site                               | Value                                             |
| ---------------------------------- | ------------------------------------------------- |
| `apps/api/src/lib/checkout.js:438` | `'PAYMENT_DECLINED'`                              |
| `apps/api/src/lib/checkout.js:509` | `'PROVIDER_TIMEOUT_REQUIRES_RECONCILIATION'`      |
| `apps/api/src/lib/payouts.js:578`  | `'PROVIDER_TIMEOUT_REQUIRES_RECONCILIATION'`      |
| `apps/api/src/lib/refunds.js:996`  | `'PROVIDER_TIMEOUT_REQUIRES_RECONCILIATION'`      |
| `apps/api/src/routes/holds.js:228` | `'EXPIRED_ON_RELEASE'` or `'RELEASED_BY_' + mode` |

The other **twenty** hold a variable. Eight of the twenty are read straight off
the request body, so the value is whatever a person typed into a box:

| Site                                        | Expression                     |
| ------------------------------------------- | ------------------------------ |
| `apps/api/src/routes/auth.js:830`           | `request.body?.reason ?? null` |
| `apps/api/src/routes/auth.js:874`           | `request.body?.reason ?? null` |
| `apps/api/src/routes/events.js:428`         | `changeReason`                 |
| `apps/api/src/routes/finance.js:315`        | `request.body.reason`          |
| `apps/api/src/routes/operations.js:126`     | `request.body.reason`          |
| `apps/api/src/routes/operations.js:189`     | `request.body.reason`          |
| `apps/api/src/routes/reconciliation.js:435` | `request.body.note`            |
| `apps/api/src/routes/teams.js:548`          | `request.body?.reason ?? null` |

The remaining twelve receive the value as a function parameter. **They were not
individually traced back to a route**, and the honest reading is that some are
free text and some are not. Two spot-checks show both answers:

- `apps/api/src/lib/tickets.js:592` writes `reason` from
  `revokeTicketRequestSchema`, `z.string().trim().min(4).max(500)` at
  `packages/schemas/src/requests.js:423` — **free text**.
- `apps/api/src/lib/refunds.js:498` writes two fields. Its `reason` is
  `refundReasonSchema`, a **closed enum**, and carries nothing typed. Its
  `reasonNote` is `z.string().trim().min(1).max(500)` — **free text**. The site
  is in this class because of the note, not the reason.

So "twenty sites" is the upper bound on the free-text class and "eight" is the
proven lower bound. Tracing the remaining twelve is a task for whoever takes the
§11.6 item 5 decision; it is not needed to see that the class exists.

The schemas behind those fields bound **length, not content** —
`z.string().trim().min(4).max(500)` at `packages/schemas/src/requests.js:423`,
`:648`, `:705`, `:790`, `:796`, `min(1).max(2000)` at `:562`, `:574` and `:1012`,
and `reasonNote: z.string().trim().min(1).max(500)` at `:672`. Nothing rejects an
address, a name or a telephone number. An operator writing _"refunding because
Priya Sharma at priya@example.com asked twice"_ puts that sentence verbatim into
an `AuditLog` row that `desi_audit_log_immutable` now makes permanent.

**Why this matters to the decision.** It changes the answer to §11.7. A key
allow-list closes the `toEmail` class and does nothing about this one, because
`reason` is a legitimate key whose value is unbounded. Closing this class needs a
different move: keep the operator's note on the mutable domain row that already
stores it — `Refund.reasonNote`, `ReconciliationNote.body`,
`EventStatusChange.reason` all exist — and put only its id in the audit metadata.
That keeps the note redactable and keeps the audit row pointing at it.

**This is an owner decision, not a Phase 1 change.** It is recorded here, not
acted on: changing what those sites write is an application-behaviour change, and
this task authorises documentation only.

### 11.3 Where the raw values actually are

| Location                                             | Present?                                                                                                                                                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Database `AuditLog.metadata` rows                    | **Yes**, for any organisation that has used ticket transfer                                                                                                                                      |
| Code paths                                           | Yes — the two call sites above, which still write it today                                                                                                                                       |
| Seed data                                            | **No.** The four seeded audit rows carry `{slug, channel}`, `{reference, reason}` and `{reference, gate}`. `actorEmail` in the seed source resolves an actor **id**; it is not stored on the row |
| Test fixtures                                        | Only as a consequence of exercising the transfer path in `ticket-concurrency.test.js` and `ticket-lifecycle.test.js`, against a disposable database                                              |
| Committed artefacts (`openapi.json`, route manifest) | No                                                                                                                                                                                               |
| Backups                                              | Yes, necessarily — a backup holds what the table held                                                                                                                                            |

### 11.4 What can expose them — nothing, today

| Surface                                        | Can it read `AuditLog`?                             |
| ---------------------------------------------- | --------------------------------------------------- |
| API routes                                     | **No.** Zero audit routes in the 120-route contract |
| Published OpenAPI                              | **No.** 108 paths, none matching `audit`            |
| Exports (`analytics.export`, `finance.export`) | **No**                                              |
| Web UI                                         | **No**                                              |
| Browser bundle                                 | **No**                                              |
| Worker                                         | **No**                                              |

The evidence is a single grep and it is decisive: across `apps/api/src`,
`apps/worker/src`, `apps/web/src` and every `packages/*/src`, the only
`auditLog.` access anywhere is **one `create`**, at `apps/api/src/lib/audit.js:127`.
There is no reader. There is therefore also no presenter, and no allow list
between those rows and anybody — because nothing reads them.

### 11.5 Which roles can read them

**No application role, because no application read path exists.** The question
does not resolve to a capability.

What does reach them is direct database access — the application's own
connection string, an operator with psql, and anyone who can restore a backup.
That is the access boundary, and it is unchanged by Phase 1.

A consequence worth naming: if Phase 3 or later adds an audit read route, that
route becomes the first thing in the system capable of exposing these addresses,
and it must ship with an allow-list presenter from its first commit rather than
acquiring one later.

### 11.6 Recommended mitigation, altering no historic row

1. **Leave every existing row exactly as it is.** `desi_audit_log_immutable`
   already makes this a property of the database rather than a promise.
2. **Stop writing new ones.** Replace `toEmail` at both call sites with either
   `toEmailMasked` (the `maskRecipient` helper already exists at
   `presenters.js:244` and is already used for the notification outbox) or an
   opaque recipient reference. This is a product decision, not an obvious win:
   the code argues the address _is_ the record, and a masked form answers "was
   it offered to the right person?" only approximately.
3. **Guard the future** with the allow list in §11.7, so the question cannot
   reappear in a path nobody reviewed.
4. **Gate any future audit read route** on an allow-list presenter, as a
   condition of that route existing.

5. **Decide the free-text class in §11.2a.** Move the operator's note to the
   mutable domain row that already holds it and record only its id in the audit
   metadata, or accept that operator notes are unbounded and say so in the
   retention policy. This is separate work from item 2 and is not closed by the
   allow list.

Recommended: 1, 3 and 4 now; 2 and 5 as owner decisions, because 2 trades away
evidence the transfer flow was designed to keep, and 5 changes up to twenty call
sites.

### 11.7 Proposed allow-list for future audit metadata

A `safeAuditMetadataSchema` in `packages/schemas/src/`, and a guard inside
`recordAudit` that parses metadata through it and throws on a key that is not
allow-listed. `recordAudit` already refuses a missing action, so it is already
the one place every audit write passes through.

Allowed shapes, from what the existing 68 call sites actually use: `requestId`,
`at`, `reason`, `source`, `mode`, `from`/`to`, `previousStatus`/`newStatus`,
`organizationId`, `amountCents`, `currency`, opaque ids ending `Id`, counts,
booleans, and closed-vocabulary codes. Denied: anything matching an address
shape, and the key names `email`, `toEmail`, `recipient`, `displayName`,
`buyerName`, `attendeeName`, `phone`, `address`.

It cannot be switched on while the two transfer call sites still write `toEmail`
— which is exactly why the guard and the decision in §11.6 item 2 are one piece
of work rather than two.

**And it does not close §11.2a.** `reason` is on the allowed list above, because
so many call sites need it; an allow list over keys cannot see that the value is
free text a person typed. Stated plainly so the allow list is not mistaken for a
complete answer: it closes the structured class and leaves the free-text class
open.

### 11.8 Regression tests required before Phase 2 adds redaction

1. Every `recordAudit` metadata object parses against `safeAuditMetadataSchema`,
   asserted by a source scan like the one already proving every
   `AUDIT_ACTIONS.X` reference resolves.
2. A redaction writes a **new** audit event and modifies no existing row —
   asserted against a real database by counting rows and comparing every
   pre-existing row byte for byte.
3. `UPDATE` and `DELETE` on `AuditLog` are refused. **Already exists**, in
   `packages/db/scripts/verify-fresh-database.mjs`.
4. A redacted subject's `PrivacyAuditEvent` rows contain no value from any
   redacted field — fed a subject whose address and name are known to the test.
5. No audit metadata written during a redaction matches an address shape.
   Note the limit of this test: it proves the redaction path writes no address,
   not that no `reason` written elsewhere ever contains one.
6. If an audit read route exists by then, its presenter drops metadata keys
   outside the allow list, proven by feeding it a row containing `toEmail`.

---

## 12. Connect audit constants — deferral record

**Confirmed: intentionally deferred to Phase 4, because no Connect action writer
exists today.**

`docs/PHASE3_IMPLEMENTATION_PLAN.md` §15 places "redaction **and Connect** audit
action constants" in Phase 1. The redaction constants shipped; the Connect ones
did not.

### 12.1 The constants proposed, and who will write them first

| Constant                             | Value                                | First writer                                                                                                                               |
| ------------------------------------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `CONNECT_ONBOARDING_STARTED`         | `connect.onboarding_started`         | `apps/api/src/routes/connect.js`, the `connect.start` handler (new in Phase 4)                                                             |
| `CONNECT_ONBOARDING_LINK_ISSUED`     | `connect.onboarding_link_issued`     | same module, the account-link and refresh handlers                                                                                         |
| `CONNECT_ACCOUNT_UPDATED`            | `connect.account_updated`            | `apps/api/src/lib/webhook-handlers.js` — the `account.updated` handler, which updates `ConnectedAccount` today and writes **no** audit row |
| `CONNECT_ACCOUNT_DISCONNECTED`       | `connect.account_disconnected`       | `apps/api/src/routes/connect.js`, the disconnect handler                                                                                   |
| `CONNECT_PAYOUT_DESTINATION_CHANGED` | `connect.payout_destination_changed` | the payout-destination path, under `connect:manage` + `PAYOUT`                                                                             |

Only `CONNECT_ACCOUNT_UPDATED` has a code location that exists today, and that
location writes no audit row at all — which is itself a gap for Phase 4 rather
than an argument for adding the constant now.

### 12.2 The test that will prove each has a real writer

`apps/api/tests/audit.test.js` already scans every `.js` file under
`apps/api/src` and asserts each `AUDIT_ACTIONS.X` **reference resolves to a
string** — references to definitions.

Phase 4 adds the converse for this family: every constant whose name begins
`CONNECT_` must appear in at least one `recordAudit` call site under
`apps/api/src`. Definitions to references. A constant with no writer then fails
the suite instead of sitting in the map looking like a feature.

### 12.3 Why adding them now would be a defect

This repository treats a declared-but-uncalled symbol as a defect rather than
preparation, and says so about itself. `AUDIT_ACTIONS` already carries four
constants nothing writes — `hold.created`, `webhook.processed`,
`webhook.dead_lettered`, `reconciliation.opened` — and they are recorded as a
smell, not as readiness. `connect:manage` has sat in the capability table since
Phase 2 authorising nothing, and the Phase 3 plan had to correct a claim that
rested on the difference between a declared method and a working one.

Adding five more unused constants, three phases before anything writes them,
would enlarge exactly the problem this project keeps correcting. They land with
the code that writes them, in the same commit, with the test above.

---

## 13. Authorization semantics, verified by execution

Each row was produced by running the code, not by reading it.

| Claim                                                                          | Result                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `privacy:redact` is a separate capability from `organization:manage`           | `privacy:redact` ≠ `organization:manage`; both present as distinct entries                                                                                                                                                                                                        |
| Granting `organization:manage` to a lower role does not grant `privacy:redact` | They are **independent entries** in `ORG_ROLE_GRANTS.OWNER`. No inheritance edge carries either: `VIEWER`, `SCANNER`, `STAFF`, `EVENT_MANAGER`, `FINANCE`, `MANAGER` and `ADMIN` hold **neither**                                                                                 |
| OWNER holding both is intentional and documented                               | Yes — `capabilities.js` states the reasoning, `docs/SECURITY.md` records the grant, and `capabilities.test.js` asserts exactly one organisation role holds `privacy:redact`                                                                                                       |
| Platform roles holding `privacy:redact`                                        | `SUPER_ADMIN` only, and only because that role is `[...ALL_CAPABILITIES]` by construction                                                                                                                                                                                         |
| SUPER_ADMIN cannot redact across organisation boundaries                       | The capability check alone **would** let it, which is why it is not the only check. `assertSubjectBelongsToOrganization` refuses a subject the named organisation holds nothing about, for every actor. Tested by `does not count a person who belongs to the other organisation` |
| `PRIVACY_ERASURE` is exactly two minutes, server-side                          | `STEP_UP_POLICIES.PRIVACY_ERASURE === 120000`; `stepUpWindowFor('PRIVACY_ERASURE') === 120000`                                                                                                                                                                                    |
| An unknown policy fails closed                                                 | `stepUpWindowFor('PRIVACY_ERASUR')` throws                                                                                                                                                                                                                                        |
| No policy is tighter                                                           | `PRIVACY_ERASURE <= every` entry in `STEP_UP_POLICIES`                                                                                                                                                                                                                            |
| No new surface returns raw personal data                                       | The response schema's fourteen fields are ids, enums, timestamps and counts; tests assert the fixture's name and address are absent from the payload                                                                                                                              |

### 13.1 One claim stated more precisely than it was asked

"Organisation scope is derived from the authenticated server-side context, not
from browser-controlled input" is **not quite** what happens, and the difference
matters.

The organisation id **is** browser-supplied: it is a path segment. What is
derived server-side is the **authority** over it — `requireCapability` reads
`params.id` and asserts `privacy:redact` against the actor's memberships, which
come from `loadActor` re-reading `Membership` on every request. A caller naming
an organisation they hold nothing in is refused.

What no browser input can do:

- name an organisation **outside the path** — neither schema has an
  `organizationId` field in body or query, verified by inspecting the parsed
  schemas
- widen or supply a step-up window — a route names a policy, never a number, and
  `requireStepUp` resolves it at registration time
- reach a subject in another organisation — `assertSubjectBelongsToOrganization`
- learn whether an identifier is real — refusals are byte-identical

"Server-side" is accurate for the authority. It would be inaccurate for the
identifier, and saying so is worth more than a tick in a box.

---

## 14. Statement

**No user data was redacted in Phase 1.** No retention deletion ran. No
production configuration changed. Payment mode remains `MOCK`, the production
kill switch is intact and proven by its own test, and every real Stripe and
Stripe Connect operation remains **EXTERNAL VERIFICATION PENDING**.
