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
phase is obtained by dispatching the workflow against the exact pushed SHA. The
run id and its job conclusions are recorded in
`docs/PHASE3_IMPLEMENTATION_REPORT.md` §3 once the run is terminal, which is one
commit later: a commit cannot carry the id of a run that does not exist until it
is pushed, and amending a pushed commit to insert one would be a force push.

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

Three paths write raw addresses into audit metadata: ticket transfer, checkout
and team invitation. The authorised rule is that existing audit rows are retained
unchanged, and the new trigger enforces exactly that, so those historical
addresses cannot be redacted in place.

The options are (a) accept the exclusion and record it, (b) stop writing
addresses going forward and accept the historical rows, or (c) permit a
metadata-only update under a named condition. Only (a) and (b) are consistent
with an append-only audit trail. Phase 3 has not chosen unilaterally.

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

## 9. Statement

**No user data was redacted in Phase 1.** No retention deletion ran. No
production configuration changed. Payment mode remains `MOCK`, the production
kill switch is intact and proven by its own test, and every real Stripe and
Stripe Connect operation remains **EXTERNAL VERIFICATION PENDING**.
