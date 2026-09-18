# Phase 3 — Phase 3 implementation report

**Status: PARTIAL.** Scope A (privacy operations UI) is implemented and tested.
Scopes B (export governance), C (dry-run retention) and D (the remaining
documentation) are **NOT IMPLEMENTED** at the time of writing. The word is
PARTIAL rather than COMPLETE because that is what is true, and a report that
rounded it up would be the one document nobody could trust afterwards.

Written against `main` at `650a1fda4749afdfdf90b483d13d8385549e1658`, which
direct CI run `35304257349` proved green 8/8.

---

## 1. What was delivered

| Surface                                              | Status              |
| ---------------------------------------------------- | ------------------- |
| Privacy area shell, organisation-scoped              | **IMPLEMENTED**     |
| Privacy request queue, filterable by state           | **IMPLEMENTED**     |
| Privacy request detail with scope table              | **IMPLEMENTED**     |
| Request evidence timeline                            | **IMPLEMENTED**     |
| Server-issued confirmation flow                      | **IMPLEMENTED**     |
| Cancellation, state-gated                            | **IMPLEMENTED**     |
| Hold list, place and release                         | **IMPLEMENTED**     |
| Refusal vocabulary, schema-driven and total          | **IMPLEMENTED**     |
| Export artifact governance                           | **NOT IMPLEMENTED** |
| Dry-run retention classes (pure, tested)             | **IMPLEMENTED**     |
| Dry-run retention worker wiring (queue/processor)    | **NOT IMPLEMENTED** |
| Retention operations UI                              | **NOT IMPLEMENTED** |
| Browser and accessibility suites for the new screens | **NOT IMPLEMENTED** |

139 tests were added: 48 over the refusal vocabulary, 26 over the request
commands, 16 over the hold commands, and 35 over the retention classes. The web
suite is 604 across 35 files (was 562/33); the worker suite is 250 across 16.

## 2. What the UI is not allowed to do, and how that is held down

The security argument of this phase is that the browser is given no authority it
should not have. That is asserted in tests rather than only in prose.

- **The confirm body is exactly `{confirmationPhrase}`.** A parameterised test
  proves ten forbidden fields are never sent: `confirmed`, `force`,
  `skipHolds`, `organizationId`, `state`, `policyVersion`, `idempotencyKey`,
  `confirmationDigest`, `leaseOwner`, `outcomeCode`. `privacyRequestConfirmSchema`
  omits the first three deliberately, so that a replayed request cannot erase
  somebody; sending one would invent the hole the schema was shaped to avoid.
- **The organisation id travels in the path.** Tests read the actual request URL
  rather than trusting the call site.
- **No personal values are rendered.** Opaque subject ids, counts, enum members,
  closed-vocabulary codes and timestamps only.
- **No server message is repeated verbatim.** Two tests feed an error whose
  message contains an address and assert it never reaches the screen.
- **No subject lookup exists.** Finding a person by address is the oracle this
  surface exists not to be, so no such route was added and no such field is
  offered.

### A real defect found by writing the tests

Both command components restored focus by capturing the trigger element on the
way in. Opening a panel unmounts the trigger, so the captured node was detached
by the time focus should have returned to it, and focusing a detached node
silently drops focus to the document body. A keyboard operator who opened
"Confirm erasure", read it and backed out was stranded at the top of the page.
Fixed in both by restoring focus from an effect against a live ref.

## 3. Retention-class decision table

This table is the precondition for a worker, recorded before any worker code so
that the worker is built against a decided model rather than deciding as it
goes. It is now also expressed as code in `apps/worker/src/retention/classes.js`
and held down by 35 tests.

**The worker itself is still NOT IMPLEMENTED.** What exists is the pure
decision layer: cut-off arithmetic, candidate clauses, hold counting, and the
sweep row a caller would write. The queue name, job schema, processor,
scheduler registration and activation gate are not built, and the rehearsal is
therefore not reachable from a running worker. The pure layer is testable and
tested without a database; the wiring is what remains.

Every duration below is **PROPOSED — REQUIRES LEGAL/PRIVACY REVIEW**. None is
approved, none is enforced, and nothing in this repository treats any of them as
settled policy.

| Class                    | Source                                    | Proposed duration                       | Approval                                    | Hold / refusal conditions                                    | Dry-run candidate query                                                     | Measurable without reading personal values? | Why no mutation                     |
| ------------------------ | ----------------------------------------- | --------------------------------------- | ------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------- | ------------------------------------------- | ----------------------------------- |
| `login_attempt`          | `LoginAttempt`                            | 30 days — **PROPOSED**                  | **BLOCKED — REQUIRES LEGAL/PRIVACY REVIEW** | None. No subject link, so no hold can attach                 | Count rows older than the cut-off                                           | **Yes** — a count, no column read           | `DRY_RUN` writes only the sweep row |
| `session`                | `Session`, `AuthToken` after expiry       | 30 days after expiry — **PROPOSED**     | **BLOCKED**                                 | None                                                         | Count expired rows older than the cut-off                                   | **Yes** — a count                           | As above                            |
| `session_metadata`       | `Session.userAgent`, `Session.ipHash`     | 90 days — **PROPOSED**                  | **BLOCKED**                                 | None                                                         | Count rows with either column non-null older than the cut-off               | **Yes** — presence, not content             | As above                            |
| `notification_recipient` | `NotificationOutbox.recipient` after send | Redact on send + 30 days — **PROPOSED** | **BLOCKED**                                 | Subject-linked, so an active `PrivacyHold` must be consulted | Count sent rows older than the cut-off **with a non-null `organizationId`** | **Yes** — a count                           | As above                            |
| `export_artifact`        | `ExportArtifact` bytes                    | 7 days — **PROPOSED**                   | **BLOCKED**                                 | Linked to a subject through `ExportArtifactSubject`          | —                                                                           | —                                           | **NOT EVALUATED** (see below)       |

### Classes excluded from the dry run, and why

Per the instruction that a class lacking a defensible duration or a safe
candidate query is reported as `NOT EVALUATED` rather than as retained or
deleted:

- **`export_artifact` — `NOT EVALUATED`.** Nothing in the repository has ever
  written an `ExportArtifact` row. Both export routes stream CSV directly to the
  caller and register nothing, so the table is empty by construction and a sweep
  over it would report a zero that means "no writer exists", not "nothing is old
  enough". Reporting that zero as a retention finding would be the vacuous
  measurement this project has already been bitten by once.
- **A known gap inside `notification_recipient`.** Pre-fix `NotificationOutbox`
  rows carry a null `organizationId` and are therefore unreachable by any
  organisation-scoped sweep. The candidate query above excludes them explicitly
  rather than silently missing them. Whether to backfill is owner decision #3.

### Why a dry run cannot mutate anything

Three independent reasons, and the database one is the only one that does not
depend on code being correct:

1. `retention_sweep_dry_run_changes_nothing` is a CHECK constraint. A row
   claiming `mode = 'DRY_RUN'` with a non-zero `affectedCount` is refused by
   PostgreSQL.
2. The intended worker issues no `UPDATE` or `DELETE` against any swept table —
   only `count` queries and one insert into `RetentionSweep`.
3. `RetentionSweepState.SKIPPED_DISABLED` exists for an environment where
   retention enforcement has not been activated, and no activation mechanism is
   implemented, so no other state is reachable in production.

### `RetentionSweep.mode` has no default — corrected

`mode` has **no** `@default` in `schema.prisma` and no `DEFAULT` in the
migration. Any writer must pass it explicitly on every insert; a forgotten field
is a runtime error, not a silent `DRY_RUN`. Three places in the repository
currently assert otherwise, and this is recorded as a correction rather than
silently edited — see §5.

## 4. Owner decisions — recorded, not invented

| #   | Decision                                          | Current state                                                                 | Blocks                     | Does not block                | Owner         | Safe default applied                                           |
| --- | ------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------- | ----------------------------- | ------------- | -------------------------------------------------------------- |
| 1   | Retention durations                               | All five `PROPOSED`                                                           | Any real deletion          | A dry-run worker, the UI      | Legal         | Nothing deletes; durations labelled at every surface           |
| 2   | Historic immutable `AuditLog` PII                 | Two `toEmail` writes are permanent under the immutability trigger             | A "complete erasure" claim | Organisation-scoped redaction | Owner + Legal | UI never claims complete erasure                               |
| 3   | `NotificationOutbox.organizationId` backfill      | Pre-fix rows null                                                             | Reaching those rows        | Everything else               | Owner         | Sweep query excludes them explicitly                           |
| 4   | Platform-wide erasure for shared identities       | `ACCOUNT_IDENTITY` reports `OUT_OF_SCOPE` when the subject is known elsewhere | Cross-organisation erasure | This organisation's own rows  | Owner         | Scope table explains the status in words                       |
| 5   | `PrivacyRequest.HELD` constraint vs documentation | They contradict each other                                                    | Nothing today              | The UI                        | Owner         | Neither changed; recorded in §5                                |
| 6   | Export download policy                            | No policy                                                                     | Export governance design   | Everything else               | Owner         | No export surface built                                        |
| 7   | Operator free-text in audit metadata              | Up to twenty call sites                                                       | A closed-vocabulary guard  | This phase                    | Owner         | No new free-text field added; `matterReference` warns at entry |
| 8   | Subject lookup                                    | None exists                                                                   | Operator ergonomics        | Security                      | Owner         | No lookup route added                                          |
| 9   | Standalone scope preview                          | Only reachable by raising a request                                           | Preview-before-commit      | The detail screen             | Owner         | No preview route added                                         |
| 10  | Replay nonce store                                | Not implemented                                                               | Closing the 300s window    | Current replay safety         | Owner         | Existing uniqueness + `PENDING` gate retained                  |

## 5. Contradictions found in merged source

Found by reading merged source against its documentation, each verified by an
adversarial second pass. **None is silently rewritten.** Only the first is
corrected in this phase, because it directly misleads the author of the
retention worker this phase's own §3 specifies; the rest are recorded for a
separate follow-up per the scope rule that Phase 3–Phase 3 does not become a
broad cleanup.

| #   | Contradiction                                                                                                                                                                               | Disposition                                                                                                                  |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1   | `PRIVACY_AND_RETENTION.md:226`, `schema.prisma:2561` and `migration.sql:407` all say `DRY_RUN` is the sweeper's default mode. It has no default in either the schema or the migration.      | **Corrected in this phase** (dated correction in `PRIVACY_AND_RETENTION.md`). It would cause a worker author to omit `mode`. |
| 2   | `PrivacyRequestState.HELD`'s doc-comment says it covers "an open process", but `privacy_request_held_names_its_hold` requires a non-null `heldByHoldId`, which an open process has not got. | Recorded. Owner decision #5.                                                                                                 |
| 3   | `routes.js:969` says a cross-tenant organisation id "answers 404 rather than 403". The code and its tests return 403.                                                                       | Recorded. Security-posture choice for the owner.                                                                             |
| 4   | All five step-up privacy routes declare `API_ERRORS.forbidden` rather than `stepUpRequired`, so the generated OpenAPI never mentions step-up.                                               | Recorded.                                                                                                                    |
| 5   | `confirmRequest` can return 422 but does not declare it; `placeHold` can 409 but does not declare it.                                                                                       | Recorded.                                                                                                                    |
| 6   | `PRIVACY_AND_RETENTION.md:267` says `AuditLog` gets a row for every privacy action. No privacy path calls `recordAudit`; they write only `PrivacyAuditEvent`.                               | Recorded.                                                                                                                    |
| 7   | `privacy-requests.js:134` cites `apps/api/tests/privacy-audit.test.js`. That file has never existed.                                                                                        | Recorded.                                                                                                                    |
| 8   | `previewScope`'s JSDoc declares a `count` key; the function returns `rows`. The wire contract agrees with the code.                                                                         | Recorded.                                                                                                                    |
| 9   | `UX.md` attributes a `ScrollableTable` to the operations queue, which has no table, and its screen list omits six real routes.                                                              | Recorded.                                                                                                                    |

## 6. Architectural blockers found

Three, each of which changes how the remaining scopes must be built:

1. **The worker cannot write audit rows.** `recordAudit` and
   `recordPrivacyAudit` live in `apps/api/src/lib`, and `apps/worker` cannot
   depend on `apps/api`. A sweep's evidence must therefore be its own
   `RetentionSweep` row.
2. **`PrivacyAuditEvent` cannot represent a platform-wide sweep.**
   `organizationId`, `targetId`, `targetType`, `reasonCode`, `holdDecision`,
   `result` and `correlationId` are all NOT NULL, and `RetentionSweep` has no
   `organizationId`.
3. **A new browser suite would imply a ninth required CI status context.**
   Branch protection pins eight with `bypass_actors: []`, and changing branch
   protection is out of scope. Privacy journeys must therefore fold into an
   existing browser job.

## 7. What is explicitly not claimed

- No real Stripe or Stripe Connect operation occurred; both remain
  `EXTERNAL VERIFICATION PENDING`.
- Payment mode remains `MOCK` and production payments remain disabled.
- No retention deletion, destructive or otherwise, was implemented or run.
- No legal, privacy, PCI, GDPR, CCPA, HIPAA or SOC 2 compliance is claimed.
- No migration was added.
- Journey 14 remains `NOT REPRODUCED — ROOT CAUSE STILL UNKNOWN` and none of its
  paths were touched.
