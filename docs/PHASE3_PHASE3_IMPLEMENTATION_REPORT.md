# Phase 3 — Phase 3 implementation report

**Status: PARTIAL.** Scope A (privacy operations UI) is implemented and tested.
Scopes B (export governance), C (dry-run retention) and D (documentation and
runbooks) are **partially** implemented, with every gap named in §6B below.

Three things this phase set out to do are **not** done and must not be read as
done:

- **Browser and accessibility suites for the new screens.** Blocker 3 below: a
  new browser job would imply a ninth required CI status context, and branch
  protection pins eight with `bypass_actors: []`. Changing branch protection is
  out of scope. Folding the privacy journeys into an existing browser job is the
  remaining work.
- **Everything the ten owner decisions in §4 block**, plus the four added in
  §6A. Those are decisions, not engineering, and the safe defaults remain
  applied.
- **The gaps in §6B.** Chief among them: nothing anywhere writes an
  `ExportArtifactSubject` row, so the export-invalidation path cannot match in
  production; the retention worker has no lease and no idempotency; there is no
  real-Redis or real-PostgreSQL retention test; and six of the ten documents
  this phase was to update were never touched.

Written against `main` at `650a1fda4749afdfdf90b483d13d8385549e1658`, which
direct CI run `35304257349` proved green 8/8.

> **Correction — 2026-09-18, second revision.** This line said
> **"Status: COMPLETE for the four scopes"** for part of one morning. That was
> wrong, and it is the single most important thing in this document to get
> right, so the claim is recorded here rather than quietly replaced.
>
> An eleven-agent read-only audit checked every requirement of the phase brief
> against the code, and a second adversarial pass tried to refute each
> "implemented" claim. It overturned **nine**. Scopes B, C and D are real work
> that is genuinely partial, not finished work. §6B below lists what is
> missing, item by item.
>
> It also found two defects in this phase's own new screens, both since fixed:
> a refusal rendered as "nothing has ever run", and pagination fetched and then
> discarded. The first is described in §6C because it is instructive — the page
> written to keep three readings apart was the page that conflated them.
>
> The first revision of this line (also 2026-09-18) replaced the original
> "Status: PARTIAL — Scope A is implemented, B, C and D are NOT IMPLEMENTED",
> which was true when written and had been overtaken by scopes B, C and D
> landing. The status table in §1 is a live index and is updated in place;
> §§3–6 are the record of past observations and are unchanged.

---

## 1. What was delivered

| Surface                                              | Status                                                              |
| ---------------------------------------------------- | ------------------------------------------------------------------- |
| Privacy area shell, organisation-scoped              | **IMPLEMENTED**                                                     |
| Privacy request queue, filterable by state           | **IMPLEMENTED**                                                     |
| Privacy request detail with scope table              | **IMPLEMENTED**                                                     |
| Request evidence timeline                            | **IMPLEMENTED**                                                     |
| Server-issued confirmation flow                      | **IMPLEMENTED**                                                     |
| Cancellation, state-gated                            | **IMPLEMENTED**                                                     |
| Hold list, place and release                         | **IMPLEMENTED**                                                     |
| Refusal vocabulary, schema-driven and total          | **IMPLEMENTED**                                                     |
| Export register, written by both CSV routes          | **IMPLEMENTED**                                                     |
| Export invalidation on redaction                     | **PARTIAL** — nothing writes the subject link it matches on         |
| Export register UI                                   | **PARTIAL** — list only, no detail screen                           |
| Dry-run retention classes (pure, tested)             | **IMPLEMENTED**                                                     |
| Dry-run retention worker wiring (queue/processor)    | **PARTIAL** — no lease, no idempotency, no real-infrastructure test |
| Retention operations UI                              | **PARTIAL** — history only, no detail or candidate rollup           |
| Retention runbook and privacy documentation          | **PARTIAL** — 4 of the 10 named documents                           |
| Retention **execution** (deletion of any kind)       | **NOT IMPLEMENTED — BY DESIGN**                                     |
| Export **deletion**                                  | **NOT IMPLEMENTED**                                                 |
| Browser and accessibility suites for the new screens | **NOT IMPLEMENTED**                                                 |

### Test counts

Scope A added 139: 48 over the refusal vocabulary, 26 over the request commands,
16 over the hold commands, and 35 over the retention classes. At that point the
web suite was 604 across 35 files (was 562/33) and the worker suite 250 across 16.

Scopes B and C added 82 more. As of 2026-09-18, against a live PostgreSQL and
Redis with **nothing skipped**:

| Suite       | Tests | Files |
| ----------- | ----- | ----- |
| api         | 1,185 | 61    |
| web         | 649   | 39    |
| schemas     | 651   | 12    |
| permissions | 600   | 3     |
| worker      | 266   | 17    |

All 19 packages pass. Gates: `lint`, `format:check`, `policy:check`,
`ci:check`, `contract:check`, `openapi:check`, `secrets:scan`, `bundle:scan` and
`build`.

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

  > **Correction — 2026-09-21.** The bullet above is left as written because it
  > is the record of what was true when §3 was observed. It stopped being true
  > later in the same phase: Scope B added the export register, and both CSV
  > routes now call `recordExport`. The class is still `NOT EVALUATED`, and the
  > reason is now that the proposed seven days is a duration for export **bytes**
  > while no bytes are kept — every row is written `ephemeral: true` with a null
  > `storageKey`, so the table holds the record that an export happened, and
  > sweeping it would delete evidence rather than a working copy.
  >
  > This mattered beyond the report. The same sentence had been copied into
  > `packages/schemas/src/retention.js` as the `reason` field, which the
  > `/retention` screen renders verbatim, so operators were shown a false
  > explanation for a correct conclusion. Corrected there, in
  > `apps/worker/src/retention/classes.js`, in `PRIVACY_AND_RETENTION.md` §5A and
  > in `RETENTION_RUNBOOK.md`, with a regression guard in
  > `apps/worker/src/retention/classes.test.js` asserting the reason no longer
  > claims nothing writes the table.

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

## 6A. Scopes B, C and D — added 2026-09-18

### What Scope C delivered, and the three absences that are its design

The rehearsal counts and records. `apps/worker/src/processors/sweep-retention.js`
writes one `RetentionSweep` row per evaluated class, and three independent things
stop it deleting: the `retention_sweep_dry_run_changes_nothing` CHECK constraint,
the absence of any deletion path in the tree, and `RETENTION_ENFORCEMENT_ACTIVATED`
defaulting to false in both the environment schema and `createProcessors`.

Three deliberate absences, each pinned by a test:

1. **No schedule.** `scheduler.js` never registers it, and a test asserts its
   source never mentions the job. A sweep on a timer is the first step towards a
   deletion on a timer.
2. **No route that starts one.** The API holds no queue client. A test asserts
   against the whole contract that exactly one `/retention` route exists and its
   method is `GET`.
3. **No payload that can request execution.** `sweepRetentionJobSchema` has no
   `mode` and no `execute`; an unknown key is stripped, and a test asserts it.

An unactivated environment writes `SKIPPED_DISABLED` with the cut-off it would
have used, rather than doing nothing. Blocker 1 above is why that row is the only
evidence: the worker cannot write an audit row, and per blocker 2
`PrivacyAuditEvent` could not carry a platform-wide sweep in any case.
`AUDIT_ACTIONS.PRIVACY_RETENTION_SWEEP_RAN` therefore still has no writer, which
is recorded rather than resolved by giving it a dishonest one.

### A finding that changed what Scope B is

Nothing had ever written an `ExportArtifact` row, and the reason turned out to
matter more than the gap. **Both CSV export routes emit aggregate figures under
explicit column allow lists** — analytics is section/item/code/quantity/amount/
currency/note, finance is section/item/code/debits/credits/balance/count/currency
— with no name, address, e-mail, card or provider reference anywhere.

So **no export in this system contains a person.** `ExportArtifactSubject` has
nothing to link, and a redaction finding no artefact to invalidate is correct
rather than unimplemented. A test asserts that nothing ever writes a subject
link, so the first export that does carry a person fails the suite instead of
slipping past the redaction path.

The `EXPORTS` redaction category was `DEFERRED` with rows 0 under a test whose
own name said "a later phase owns". This is that phase; it now answers
`NOTHING_TO_DO`. "Nothing to reach" and "nobody has looked" are different claims
and only one is true now.

### New findings, recorded rather than fixed

| #   | Finding                                                                                                                                               | Disposition                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 10  | `attendee:export` is a capability with no route asserting it. Nothing in the API uses it.                                                             | Recorded. No route was invented for it.                                         |
| 11  | A platform-wide finance export cannot be registered: `ExportArtifact.organizationId` is NOT NULL and an export belonging to no organisation has none. | Skipped and logged rather than attributed to a tenant. Owner decision to widen. |
| 12  | `ExportArtifactState` has `DELETED` and `DELETION_FAILED`, which nothing writes, because nothing stores export bytes to delete.                       | Recorded. Invalidation is implemented; deletion is not.                         |

### New owner decisions

| #   | Decision                                                                           | Current state                                                       |
| --- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 11  | Which platform role should carry `retention:view`.                                 | Only `SUPER_ADMIN`, via `ALL_CAPABILITIES`. No role was granted it. |
| 12  | Whether `ExportArtifact.organizationId` should become nullable.                    | Not changed. Platform-wide exports go unrecorded and are logged.    |
| 13  | Whether a retention rehearsal should ever be scheduled, and in which environments. | No schedule exists. `RETENTION_ENFORCEMENT_ACTIVATED` is false.     |

`retention:view` is a new capability and the first added since `privacy:redact`.
It is platform-only — `PLATFORM_ONLY_CAPABILITIES` asserts at module load that no
organisation role carries it — for the same reason `privacy:redact` is its own
capability rather than folded into `platform:admin`: an authority inside the key
to everything cannot be granted narrowly.

### Scope D

`docs/RETENTION_RUNBOOK.md` is new. `docs/PRIVACY_AND_RETENTION.md` gained two
dated sections (5A, the rehearsal; 5B, the export register) and a dated
correction to its status table — three more of its rows were out of date, and the
table is left unedited beside the correction because it is the record of what was
true when written.

### Contract and artefacts

Two routes added: `retention.listSweeps` and `privacy.listExports`. The contract
went from 127 routes to 129; `openapi.json` and the browser route manifest were
regenerated and both drift checks pass. **No migration was added.** No CI
workflow changed, and no new required status context was created.

## 6B. What the audit found missing — 2026-09-18

Verified against the code, not against this document. Each is open work, tracked
separately.

### Export governance (Scope B)

| Gap                                                                   | Consequence                                                                                           |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Nothing writes `ExportArtifactSubject`**                            | `invalidateExportsForSubject` cannot match in production; only a hand-built test fixture exercises it |
| `AUDIT_ACTIONS.PRIVACY_EXPORT_INVALIDATED` is declared with no writer | The same constant-with-no-writer defect recorded elsewhere in this project                            |
| No audit row on register read or on invalidation                      | No operator evidence that the register was consulted or an artefact voided                            |
| No artifact detail screen                                             | The register is a list only                                                                           |
| No step-up on the surface                                             | Capability alone gates it                                                                             |
| No expiry state, no `PrivacyRequest` linkage                          | Both were in the brief                                                                                |

The register itself — both CSV routes recording before returning a body, the
read API, the list UI, invalidation inside the redaction transaction — is real
and tested. It is the link between register and subject that nothing writes.

### Retention (Scope C)

| Gap                                                          | Consequence                                                      |
| ------------------------------------------------------------ | ---------------------------------------------------------------- |
| `RetentionSweep.leaseOwner` / `leaseExpiresAt` never written | No lease protection                                              |
| No idempotency                                               | A retried job writes duplicate sweep rows at a new instant       |
| No real-Redis worker test for the retention job              | The wiring is proved only against fakes                          |
| No real-PostgreSQL retention integration test                | The counts are proved only against a stub                        |
| No before/after database snapshot assertion                  | A stub that throws on mutation is not the same proof             |
| Nothing writes `state: FAILED` or `failureCode`              | A failed rehearsal has no terminal record                        |
| Held-count is a coarse global `ACTIVE` count                 | Not related to the class or subject; the UI gives no explanation |
| No sweep detail screen, no candidate-summary rollup          | Both were in the brief                                           |
| `db:verify:fresh` / `db:verify:upgrade` never updated        | The retention work is outside the database verification gates    |

Deliberate and to be preserved: **no scheduler is registered**, and **no route
or UI control can start a sweep**. Whether the UI should be able to initiate a
dry run is owner decision 14 in §6A.

### Documentation (Scope D)

Delivered: `RETENTION_RUNBOOK.md` (new), `PRIVACY_AND_RETENTION.md` (§§5A, 5B
and a status correction), this report.

Never touched: `EXPORT_GOVERNANCE.md` (does not exist), `DATA_MODEL.md`,
`SECURITY.md`, `api.md`, `architecture.md`, `UX.md`, `DECISIONS.md`.

### Browser and accessibility

Zero files under `apps/web/e2e/` changed across this entire phase, and no spec
navigates to any privacy or retention route. The jsdom component tests use
accessible role queries, which is real but is not browser or axe coverage.

The audit identified where the journeys can fold in without a ninth CI context,
and one hazard worth recording: `playwright.config.js` matches `**/*.spec.js`
with only six exclusions, so a new privacy spec not added to its `testIgnore`
is silently picked up by "Browser — public catalogue", which does not start the
API — the exact failure that hit the four detail specs on `bdefff9`.

## 6C. Two defects this phase shipped and then fixed — 2026-09-18

Both were in code this phase wrote, and neither was caught by the tests this
phase wrote. Recorded because the shape of the miss is more useful than the fix.

**A refusal rendered as "nothing has ever run."** `apps/web/src/app/retention/page.jsx`
left `sweeps` null when the fetch threw, then passed `sweeps ?? []` to
`summariseSweeps`, which answers `NONE_RECORDED` for an empty list. A 403, a
lapsed step-up or a 500 therefore printed _"No retention rehearsal has been
recorded. Nothing has run here"_ in the statement-of-fact panel, above the error
alert. The page written to keep "nothing happened", "we were told not to" and
"nothing has ever run" apart was the page that conflated a fourth thing with the
third. The existing test asserted only that the heading survived a refusal — it
never looked at what else was on the screen.

**Pagination fetched and discarded.** Neither new page read `answer.pagination`,
so both truncated at the server's page size while looking complete. The Scope A
queue already did this correctly; the two later pages did not follow it.

Seven regression tests replace the one that missed them, and all seven were
confirmed to fail against the unfixed source before the fix was restored.

## 6D. A CI failure this phase caused — 2026-09-18

Run `35319113778` failed `redis-integration.test.js` with `Job wait send-email
timed out ... after 30000ms`, on a commit whose diff was two web pages. The job
was an `EVENT_REMINDER` the in-memory provider completes on the first attempt,
and the preceding test had round-tripped a job in 41ms — so no retry was due and
the worker was alive. The job was never picked up.

Every BullMQ `Worker` duplicates the shared connection for a blocking read, and
that suite starts one per entry in the processor map. The map had grown from
four to six as `drain-outbox` and then this phase's `sweep-retention` joined it:
six blocking readers on two cores already running nineteen Turborepo tasks. The
file's own note records the suite going red once before at a smaller worker
count, on a commit that changed nothing but Markdown.

The suite now starts workers only for the three jobs it enqueues. No timeout was
raised, no retry, sleep, serial mode, skip or quarantine added, no assertion
relaxed, and nothing removed from the processor map. A guard test pins the
count, and against the unfixed setup it reports `expected [ …(6) ] to have a
length of 3 but got 6` — which is also the evidence for the diagnosis.

## 7. What is explicitly not claimed

- No real Stripe or Stripe Connect operation occurred; both remain
  `EXTERNAL VERIFICATION PENDING`.
- Payment mode remains `MOCK` and production payments remain disabled.
- No retention deletion, destructive or otherwise, was implemented or run. A
  rehearsal that counts is not a sweep that deletes, and this report does not
  present it as one.
- No retention duration is approved. Every one remains
  `PROPOSED — REQUIRES LEGAL/PRIVACY REVIEW`.
- No export was deleted, and no export was recalled. An artefact record can be
  invalidated; bytes that left the building are gone.
- No browser or accessibility suite covers the new screens. Blocker 3 stands.
- No legal, privacy, PCI, GDPR, CCPA, HIPAA or SOC 2 compliance is claimed.
- No migration was added.
- Journey 14 remains `NOT REPRODUCED — ROOT CAUSE STILL UNKNOWN` and none of its
  paths were touched.
