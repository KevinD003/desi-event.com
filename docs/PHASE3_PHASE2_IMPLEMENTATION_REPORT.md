# Phase 3 — Phase 2 implementation report

Privacy redaction service, database integrity, and audit evidence.

A record kept as the evidence was produced. Where something is unproven it says
so; where a claim made earlier in this workstream turned out to be wrong, the
correction is here rather than quietly in place of it.

---

## 1. Commit and CI

| Fact                    | Value                                                                        |
| ----------------------- | ---------------------------------------------------------------------------- |
| Branch                  | `claude/desi-event-js-stack-gb4uqe`                                          |
| Starting HEAD           | `8274f28799929b135afb7be0653e695ed795e2e7`                                   |
| CI on the starting HEAD | run `35216479645`, `workflow_dispatch`, attempt 1, **8 of 8 jobs `success`** |
| Working tree at start   | clean, 0 entries                                                             |
| Worktrees               | 1                                                                            |
| Open pull requests      | none                                                                         |

The starting SHA was CI-verified before any Phase 2 file was written, which is
what §2.6 of the authorisation required. The eight skipped steps in that run are
the `if: failure()` artefact uploads, one per job, which a green run never
executes.

**Final SHA `0508da199dbb379403cacf38397dff77d874ea1d`**, CI run `35223710945`,
**8 of 8 jobs `success`** on attempt 1. §12.3 has the job-by-job record. This
paragraph was written after the push, because it could not honestly be written
before.

---

## 2. What Phase 2 added

**No migration.** Phase 1 laid down all six privacy models, nine enums, the
partial unique index, twenty-five CHECK constraints and three triggers. Phase 2
needed none of them changed and added no new ones, so `packages/db/prisma`
carries **zero** new migrations and `schema.prisma` is untouched. That is worth
stating plainly rather than leaving as an absence: a phase that builds a
redaction engine without needing a schema change is a phase whose schema was
designed for it.

### 2.1 New modules

| File                                       | Lines | What it is                                                              |
| ------------------------------------------ | ----- | ----------------------------------------------------------------------- |
| `apps/api/src/lib/privacy-placeholders.js` | ~200  | The one-way guarantee: deterministic, collision-free, visibly synthetic |
| `apps/api/src/lib/privacy-holds.js`        | ~400  | Legal holds, fraud holds, open processes; placing and lifting           |
| `apps/api/src/lib/privacy-redaction.js`    | ~600  | The engine — what each category touches, and what it must not           |
| `apps/api/src/lib/privacy-requests.js`     | ~600  | The lifecycle: raise, confirm, execute, cancel, and the evidence        |

### 2.2 Changed modules

| File                                            | Change                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------ |
| `apps/api/src/routes/privacy.js`                | five new handlers beside the two Phase 1 reads                                 |
| `packages/api-contract/src/routes.js`           | seven privacy route descriptors, up from two; 127 routes, 113 paths            |
| `packages/schemas/src/privacy.js`               | request, confirmation, cancel, hold and audit-event schemas; `status` on scope |
| `packages/auth/src/sessions.js`                 | `REVOCATION_REASONS.PRIVACY_REDACTION`                                         |
| `apps/api/src/lib/event-cancellation.js`        | stamps `NotificationOutbox.organizationId` — see §7.4                          |
| `apps/api/src/lib/event-material-change.js`     | the same                                                                       |
| `apps/api/src/routes/tickets.js`                | the same, and loads the organisation to do it                                  |
| `packages/db/scripts/verify-fresh-database.mjs` | three probes, and the two new integration suites wired in                      |
| `apps/api/tests/helpers/prisma-stub.js`         | `@default(now())` columns the double was missing                               |

---

## 3. The privacy request state machine

Phase 1 shipped seven states. The authorisation's §6.1 lists eleven. The
difference is not an omission, and the instruction that resolves it is in §6.1
itself — "use only states justified by actual code and documented
state-transition rules". Here is the mapping, so the owner can object to it
rather than discover it:

| §6.1 state                   | Implemented as                                             |
| ---------------------------- | ---------------------------------------------------------- |
| `REQUESTED`                  | `REQUESTED`                                                |
| `AWAITING_CONFIRMATION`      | `REQUESTED` with `confirmedAt IS NULL`                     |
| `AUTHORIZED`                 | `QUEUED`                                                   |
| `BLOCKED_LEGAL_HOLD`         | `HELD` + `holdDecision = LEGAL_HOLD_ACTIVE`                |
| `BLOCKED_FRAUD_HOLD`         | `HELD` + `holdDecision = FRAUD_HOLD_ACTIVE`                |
| `BLOCKED_OPERATIONAL_HOLD`   | refused before a row exists; `holdDecision = OPEN_PROCESS` |
| `QUEUED`                     | `QUEUED`                                                   |
| `PROCESSING`                 | `PROCESSING`                                               |
| `COMPLETED`                  | `COMPLETED`                                                |
| `FAILED_SAFE`                | `FAILED_SAFE`                                              |
| `CANCELLED_BEFORE_EXECUTION` | `CANCELLED`, and the database refuses it after execution   |

Three BLOCKED states collapse into one `HELD` plus a `holdDecision` because the
two are different dimensions: a state that encoded both would permit a row
reading `state = BLOCKED_LEGAL_HOLD, holdDecision = FRAUD_HOLD_ACTIVE`, which
means nothing. `privacy_request_executes_only_when_clear` already couples them.

### 3.1 The transitions, and who enforces them

`desi_privacy_request_state_transition` enforces all of this at the database, so
the service's agreement with it is checked on every write rather than assumed:

```
REQUESTED  → QUEUED | HELD | FAILED_SAFE | CANCELLED
QUEUED     → PROCESSING | HELD | FAILED_SAFE | CANCELLED
PROCESSING → COMPLETED | FAILED_SAFE          (never CANCELLED, never HELD)
COMPLETED | HELD | FAILED_SAFE | CANCELLED → nothing
```

`PROCESSING → CANCELLED` is refused because once a personal field may already
have been replaced, "withdrawn" would claim nothing happened. That is what makes
"cancellation only before execution" a property of the schema rather than a
promise the service makes, and §8 records the probe that proves it.

`executeRedaction` walks `QUEUED` and `PROCESSING` inside the transaction even
though no observer outside it can see either. That is deliberate: each write
engages the trigger, so a future refactor that skips a step fails loudly.

---

## 4. What is redacted, and what is not

### 4.1 Redacted

| Field                          | Placeholder                          | Notes                                               |
| ------------------------------ | ------------------------------------ | --------------------------------------------------- |
| `User.email`                   | `redacted-<12 hex>@redacted.invalid` | `@unique`; collision-free by construction           |
| `User.displayName`             | `Redacted person <12 hex>`           | visibly synthetic                                   |
| `User.phone`                   | `NULL`                               | a synthetic number is one somebody eventually dials |
| `Order.buyerEmail`             | per-order placeholder                | derived from the order id, not the person's         |
| `Order.buyerName`              | per-order placeholder                | same                                                |
| `Ticket.attendeeName`          | per-ticket placeholder               | status, code and credential untouched               |
| `TicketTransfer.toEmail`       | per-transfer placeholder             | **settled transfers only** — see §5                 |
| `WaitlistEntry.email`          | per-entry placeholder                | `@@unique([eventId, email])` satisfied per row      |
| `NotificationOutbox.recipient` | per-row placeholder                  | **settled rows only** — see §5                      |
| `NotificationOutbox.payload`   | personal keys removed                | a deny list; the key is dropped, not replaced       |
| `Organization.contactEmail`    | per-row placeholder                  | **only when it is the subject's own address**       |
| `Event.contactEmail`           | per-row placeholder                  | the same                                            |

Every placeholder is `sha256(field + "\0" + rowId)` truncated to twelve hex
characters. It takes no secret and no clock, so a re-run is byte-identical; it
never reads the value it replaces, so there is nothing to invert. Addresses land
in `.invalid`, which RFC 2606 reserves as unresolvable.

**The contact-address narrowing is a deliberate deviation from the approved
matrix.** `docs/PHASE3_IMPLEMENTATION_PLAN.md` §5 lists `Organization.contactEmail`
and `Event.contactEmail` as "Redact/anonymize" without qualification. Taken
literally, an attendee's erasure request would blank the organiser's public
contact address and break their ability to be contacted about their own events.
The implemented rule replaces those columns **only when the stored address is
the subject's own**, which is exactly the case where the column holds personal
data about them. Recorded as a deviation rather than silently applied.

### 4.2 Retained, and proven retained

Amounts, currency, tax, discount, fees, order status, paid/cancelled timestamps,
refunded and refund-pending totals, every ledger entry and batch, ticket status,
ticket code, credential digest, credential version, seat assignment, check-in
state, `dedupeKey`, outbox status and attempt counts, waitlist quantity and
notification flag, and every foreign key.

The test `replaces every approved field and leaves the money exactly as it was`
captures eleven financial facts plus the ledger entry count before the redaction
and asserts the whole object is equal afterwards. It is an equality assertion on
a captured snapshot rather than a field-by-field spot check, so a field added to
`Order` later is covered without anybody remembering to add it.

### 4.3 Not attempted, and why

| Category                                | Status         | Why                                                            |
| --------------------------------------- | -------------- | -------------------------------------------------------------- |
| `SECURITY_METADATA`                     | `DEFERRED`     | The plan's §5 assigns it to retention, not redaction. Phase 3. |
| `EXPORTS`                               | `DEFERRED`     | Excluded from Phase 2 by the plan's §15.                       |
| `ACCOUNT_IDENTITY` for a shared subject | `OUT_OF_SCOPE` | See §4.4.                                                      |

### 4.4 Account identity is not organisation-scoped, and is treated as such

`User.email` is one row serving every organisation a person deals with. An
organiser who could blank it would be erasing that person's account from
organisations they hold no authority over — a cross-tenant write dressed up as a
privacy control.

So account identity is redacted **only when no other organisation holds anything
about the subject**, tested by `subjectBelongsElsewhere` across the same four
relationships that put a subject in scope in the first place. Otherwise the
category reports `OUT_OF_SCOPE`, the scope preview says so before the operator
confirms, and this organisation's own rows are still redacted.

This is a limitation with a consequence for what a subject can be told: a person
who deals with two organisations cannot have their account identity removed by
either one alone. **It is an owner decision whether a platform-level path should
exist for that, and no such path was built.**

---

## 5. Holds, and the operational refusals

Three refusal grounds, all evaluated server-side, all fail-closed.

| Ground                   | Source                              | Terminal?                                             |
| ------------------------ | ----------------------------------- | ----------------------------------------------------- |
| Legal hold               | a `PrivacyHold` row, `kind = LEGAL` | yes — `HELD`, a new request may be raised once lifted |
| Fraud investigation hold | `kind = FRAUD_INVESTIGATION`        | yes                                                   |
| Open process             | computed, no row                    | no — the request stays open                           |

Holds are evaluated **twice**: when the request is raised, so an operator is not
invited to confirm something that cannot proceed, and again at the moment of
execution. Only the second is load-bearing; the interval between them is exactly
when counsel places a hold.

### 5.1 The open processes, and what each one protects

| Code                       | Condition                                                                                       |
| -------------------------- | ----------------------------------------------------------------------------------------------- |
| `TRANSFER_PENDING`         | an unexpired `PENDING` invitation involving the subject                                         |
| `REFUND_IN_FLIGHT`         | a refund in `REQUESTED`/`APPROVED`/`SUBMITTED`/`PROCESSING`/`TIMEOUT`/`RECONCILIATION_REQUIRED` |
| `DISPUTE_OPEN`             | a dispute the organisation still owes the provider an answer on                                 |
| `RECONCILIATION_OPEN`      | an `OPEN`/`IN_PROGRESS`/`ESCALATED` task, reached both by payment and by order id               |
| `ADMISSION_UNSPENT`        | a `VALID`/`TRANSFER_PENDING` ticket for an event that has not finished                          |
| `NOTIFICATION_UNDELIVERED` | a message queued, claimed, sending or waiting to retry                                          |

Every probe is scoped to the organisation as well as the subject. An open refund
in a _different_ organisation is not this organisation's reason to refuse, and
letting it be one would disclose that the subject has business elsewhere. That is
asserted by `does not treat another organisation's open process as this one's
reason to refuse`.

### 5.2 The transfer case, stated at length because it cost a paid ticket

Acceptance of a ticket invitation is gated by comparing the signed-in address
against `TicketTransfer.toEmail` (`apps/api/src/routes/tickets.js:407`; the
decline path at `:444` does the same). `toUserId` is resolved by an address
lookup when the invitation is sent and is **null when the recipient had no
account yet**; it is written only _after_ the gate has already passed, so it is
never what authorised anything.

A hold check that matched only `fromUserId` and `toUserId` would therefore pass
for somebody invited before they registered. Redacting their `User.email`
afterwards makes the gate unmatchable from either side, and the ticket sits in
`TRANSFER_PENDING` until the invitation lapses — acceptable to nobody, including
the person who paid for it.

**The first implementation had this bug.** An adversarial read of the finished
code found it, and `findOpenProcess` now matches `{ toEmail: subjectEmail }` as
well. The regression test is `blocks on an invitation addressed to somebody who
had no account yet`.

---

## 6. Authorization

| Control                   | Value                                                                                                                                         |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Capability                | `privacy:redact`, held by the organisation `OWNER` and no other org role                                                                      |
| Platform holders          | `SUPER_ADMIN` only, and only because that role is all capabilities                                                                            |
| Capability scope          | `params.id` on every one of the seven routes                                                                                                  |
| Step-up                   | `PRIVACY_ERASURE`, 120 000 ms, on every command; no read requires it                                                                          |
| Fields a browser may send | `subjectId`, `reason`, `confirmationPhrase`, `reasonCode`, `kind`, `matterReference`, `expectedUntil`, `releaseReasonCode` — and nothing else |

### 6.1 What the browser cannot do, proven by test

- Name an organisation: no body schema has an `organizationId` field, asserted
  across the whole contract by `never accepts an authority-bearing field from a
browser on the privacy surface`, which also refuses `state`, `outcomeCode`,
  `holdDecision`, `idempotencyKey`, `policyVersion`, `confirmed`, `force` and
  `skipHolds`.
- Choose an idempotency key: the server mints a UUID.
- Choose a confirmation: the server mints an 18-hex phrase and stores only its
  digest.
- Widen a step-up window: a route names a policy, never a number.
- Reach another tenant's subject: `assertSubjectBelongsToOrganization`.
- Learn whether an identifier is real: cross-tenant and non-existent answer the
  same 404 with the same sentence, asserted byte-for-byte.

### 6.2 The two-minute window, tested as a window

Signing in with a second factor sets `mfaSatisfiedAt` to that moment
(`apps/api/src/routes/auth.js:522`), so a freshly signed-in operator is
legitimately stepped up — for two minutes. A test that simply omitted the step-up
would therefore prove nothing. The three step-up tests age `mfaSatisfiedAt` by
ten minutes and assert `403`, which is the guarantee that actually matters.

---

## 7. The four findings an adversarial read produced

After the implementation was complete and its tests were green, thirteen agents
re-read the subsystems independently. Four conflicts came back. Three were real
defects in code that was already passing its own tests; all three are fixed, each
with a regression test. The fourth is the standing `AuditLog` limitation.

### 7.1 The invitation addressed by e-mail — **fixed**

§5.2 above. Would have stranded a paid ticket permanently.

### 7.2 Historic `AuditLog` personal data — **unchanged, and still an owner decision**

`apps/api/src/lib/tickets.js:374` and `:540` write `toEmail` into audit metadata,
and `desi_audit_log_immutable` refuses every `UPDATE` and `DELETE`. Those
addresses cannot be redacted, now or ever, without rewriting an append-only
trail.

Phase 2 does not make this worse and does not claim to have solved it. The four
lettered options are in `docs/PRIVACY_AND_RETENTION.md`; none has been taken.
The related free-text class — up to twenty `recordAudit` call sites writing an
operator's `reason` or `note` under schemas that bound length and not content —
is recorded in `docs/PHASE3_PHASE1_IMPLEMENTATION_REPORT.md` §11.2a and is also
untouched.

**A subject cannot truthfully be told their erasure is complete while those rows
stand.** That sentence belongs in whatever the organisation tells them.

### 7.3 The preview undercounted what the redaction wrote — **fixed**

The preview counted orders and waitlist entries by account link only, while the
engine matched account link **or** address — so guest orders, guest waitlist
entries and address-addressed transfers were redacted but never previewed, and
contact addresses had no preview line at all. An operator was confirming an
irreversible action against a number smaller than what it did.

Both sides now share `subjectMatchers()` and `countContactAddresses()`, so they
cannot drift again, and `previews exactly the number of rows it then redacts`
asserts category-by-category equality against a subject holding one linked order,
one guest order, one guest waitlist entry and one sent notification.

### 7.4 `NotificationOutbox.organizationId` was never written — **fixed**

The column has existed since the Phase 2 commerce migration. **No writer ever set
it.** All three — `event-cancellation.js`, `event-material-change.js` and the
transfer invitation in `routes/tickets.js` — omitted it, so every outbox row in
existence carries `organizationId: null`.

The consequence was precise and silent: `redactNotificationDelivery` filtered on
`{ userId, organizationId, status }` and matched **zero rows**, so the
`NOTIFICATION_DELIVERY` category reported `NOTHING_TO_DO` while the person's
address sat in `recipient`. The engine would have reported a complete redaction
that had not happened.

All three writers now stamp the column, the match is by account link **or**
address (a guest buyer's cancellation notice carries an address and no link), and
a whole-source invariant in `security-regression.test.js` fails if a future
writer forgets — it walks all 70 files under `apps/api/src`, finds all three
call sites, and checks each.

**The limitation this leaves:** rows written before this change still carry
`organizationId: null` and are therefore unreachable by an organisation-scoped
scrub. A backfill is possible — the organisation is derivable from the payload's
`eventId` — and is **not** attempted here, because it is a data migration over
existing rows and this phase's authorisation does not cover one. It is an owner
decision, recorded in §11.

---

## 8. Database integrity

No new constraints. Three new probes in `packages/db/scripts/verify-fresh-database.mjs`,
which now runs **96 checks, 96 passed** (93 before Phase 2):

| Probe                                                     | Proves                                                                  |
| --------------------------------------------------------- | ----------------------------------------------------------------------- |
| `a redaction already in progress cannot be withdrawn`     | `PROCESSING → CANCELLED` is refused by the trigger                      |
| `a released hold must name who lifted it`                 | `privacy_hold_release_*` move the three columns together                |
| `two accounts cannot end up at the same redacted address` | `User_email_key` would catch a derivation that stopped being row-scoped |

`packages/db/scripts/verify-populated-upgrade.mjs`: **24 of 24**, unchanged.

The two new integration suites are wired into the fresh-database verification, so
CI runs them against a disposable database with `REQUIRE_DATABASE=1` — a build
without PostgreSQL fails rather than skipping them.

### 8.1 One Phase 1 defect found and **not** acted on

`privacy_request_held_names_its_hold` requires `heldByHoldId IS NOT NULL`
whenever the state is `HELD`. The `PrivacyRequestState.HELD` documentation says
the state covers "a legal or fraud hold **or an open process**" — and an open
process has no hold row to name. The constraint and the enum's own comment
disagree.

The implementation obeys the constraint: an open process refuses without
creating a terminal row, which is defensible on its own merits (the condition is
transient, so a terminal state would be the wrong answer anyway). **The
constraint was not rewritten**, because the authorisation forbids replacing a
database constraint and a disagreement between a constraint and a comment is an
owner's to resolve, not something to fix by loosening the constraint.

The proposed correction, if the owner wants the enum's documented meaning:

```sql
CHECK (
  "state" <> 'HELD'
  OR ("holdDecision" IN ('LEGAL_HOLD_ACTIVE','FRAUD_HOLD_ACTIVE') AND "heldByHoldId" IS NOT NULL)
  OR ("holdDecision" = 'OPEN_PROCESS' AND "heldByHoldId" IS NULL)
)
```

It permits one case the current constraint forbids and forbids two it permits
(`HELD` with `NONE_ACTIVE`, and `HELD` with `NOT_EVALUATED`). It is not a pure
weakening and it is not a pure tightening, which is exactly why it is put to the
owner rather than taken.

---

## 9. The API surface

| Route                       | Method | Path                                                        | Step-up           |
| --------------------------- | ------ | ----------------------------------------------------------- | ----------------- |
| `privacy.listRequests`      | GET    | `/v1/organizations/:id/privacy/requests`                    | —                 |
| `privacy.getRequest`        | GET    | `/v1/organizations/:id/privacy/requests/:requestId`         | —                 |
| `privacy.createRequest`     | POST   | `/v1/organizations/:id/privacy/requests`                    | `PRIVACY_ERASURE` |
| `privacy.confirmRequest`    | POST   | `/v1/organizations/:id/privacy/requests/:requestId/confirm` | `PRIVACY_ERASURE` |
| `privacy.cancelRequest`     | POST   | `/v1/organizations/:id/privacy/requests/:requestId/cancel`  | `PRIVACY_ERASURE` |
| `privacy.listRequestEvents` | GET    | `/v1/organizations/:id/privacy/requests/:requestId/events`  | —                 |
| `privacy.listHolds`         | GET    | `/v1/organizations/:id/privacy/holds`                       | —                 |
| `privacy.placeHold`         | POST   | `/v1/organizations/:id/privacy/holds`                       | `PRIVACY_ERASURE` |
| `privacy.releaseHold`       | POST   | `/v1/organizations/:id/privacy/holds/:holdId/release`       | `PRIVACY_ERASURE` |

Nine, all `auth: 'session'`, all `capability: 'privacy:redact'`, all
`capabilityScope: 'params.id'`. Contract total: **127 routes, 127 operations,
113 paths.**

Hold routes exist in Phase 2 rather than Phase 3 because a redaction that a hold
must be able to refuse needs a hold that somebody can place. §6.3 of the
authorisation permits this and asks for the reason to be documented; this is it.
**No UI was built.**

---

## 10. Audit evidence

Every `PrivacyAuditEvent` carries: action, actor id or null, organisation id,
request id, an opaque target id and its type, policy version, a closed-vocabulary
reason code, the hold decision, a **SHA-256 of the idempotency key**, a result, a
correlation id, and a `detail` object of counts and category names.

It carries no value, old or new; no address; no name; no confirmation phrase; no
raw idempotency key; no error message; no payload.

`desi_privacy_audit_event_immutable` refuses `UPDATE` and `DELETE`
unconditionally, and two tests prove the refusal rather than trusting it.

`carries no personal value in any audit event` serialises every event of a
completed redaction and asserts the subject's address, their name, the
confirmation phrase and the raw idempotency key are all absent.

`leaves every pre-existing AuditLog row exactly as it was` captures the rows
before a redaction and compares the serialised arrays afterwards.

---

## 11. Limitations

1. **Historic `AuditLog` personal data cannot be redacted.** §7.2. Owner decision
   outstanding. A subject cannot be told their erasure is complete.
2. **Outbox rows written before this change carry `organizationId: null`** and
   are unreachable by an organisation-scoped scrub. A backfill is possible and
   was not attempted. §7.4.
3. **Account identity survives for a subject who deals with more than one
   organisation.** §4.4. No platform-level path exists.
4. **`LedgerEntry.memo` can never be redacted.** `desi_ledger_entry_immutable`
   refuses it once the batch is posted. Financial immutability is the stronger
   control and is preserved.
5. **`LoginAttempt` rows cannot be located after redaction.** They store a
   peppered hash of the address and carry no foreign key, so once `User.email`
   changes the hash cannot be recomputed. They are retention's problem, not
   redaction's, and Phase 3 owns the sweeper.
6. **A copy of a redacted name can survive in another organisation.** Accepting a
   ticket invitation copies `User.displayName` into `Ticket.attendeeName`
   (`lib/tickets.js:451`). The copy in organisation B is correctly out of
   organisation A's reach. It is correct tenant behaviour and a misleading thing
   to call a complete erasure.
7. **`Event.artists` holds performer names** with no relation to any `User`. Out
   of scope for subject redaction; recorded so nobody assumes otherwise.
8. **The migration comment at `20260917060000_…/migration.sql:555` is stale.** It
   still says addresses are written by "the ticket-transfer, checkout and
   invitation paths"; the measurement in the Phase 1 report §11.2 proved only
   ticket transfer does. The comment **cannot be corrected**: editing an applied
   migration changes its checksum and breaks `migrate deploy`.
9. **Backups taken before a redaction still contain the original values.** A
   restore requires re-running every completed request since the backup point.
   The runbook that says so is Phase 3.
10. **No UI, no exports, no retention sweeper, no Connect.** Excluded from Phase 2
    by the plan's §15.

---

## 12. Verification

Every command below was run locally against real PostgreSQL 16 before the push.

| Check                     | Result                                                     |
| ------------------------- | ---------------------------------------------------------- |
| `format:check`            | clean                                                      |
| `policy:check`            | OK — 632 files                                             |
| `secrets:scan`            | OK — 631 tracked files, nothing credential-shaped          |
| `ci:check`                | invariants hold                                            |
| `lint`                    | clean                                                      |
| `contract:check`          | 127 routes, 127 operations, 113 paths; artefact up to date |
| `test`                    | 19 tasks; `apps/api` 57 files, **1,133 cases**             |
| `check-skipped-tests`     | 0 skipped, 0 undeclared — **but see §12.0**                |
| `test:coverage`           | 18 tasks; every floor met                                  |
| `db:verify:fresh`         | **96 of 96**                                               |
| `db:verify:upgrade`       | **24 of 24**                                               |
| `manifest:emit` + openapi | regeneration-stable; no drift                              |
| `build`                   | 3 tasks                                                    |
| `bundle:scan`             | 300 browser-deliverable files, nothing server-only         |
| `payment-kill-switch`     | 12 passed                                                  |

### 12.0 Correction — the `check-skipped-tests` row above was produced by an instrument that could not fail

**Added 2026-09-17, after this report was first published.** Recorded here rather
than silently rewritten, which is this repository's established convention.

**The figure is true. The evidence for it was not.**

`0 skipped, 0 undeclared` is a correct description of what CI ran: the verify job
provides PostgreSQL and Redis as services and applies migrations before testing,
so no suite had cause to skip. CI's own log for `c512dee` confirms it directly —
all nineteen test-task summaries read `passed == total`, including
`Tests 216 passed (216)` for `apps/worker`, which contains the five Redis
integration cases, and `Tests 102 passed (102)` for `packages/db`.

What is corrected is the **weight the row carries as evidence**. Until
`c512dee`'s successor, `scripts/check-skipped-tests.mjs` matched
`assertion.status === 'pending' || 'todo'`. Vitest's JSON reporter writes
`'skipped'`. The checker therefore matched a status Vitest never emits, and
would have printed `0 skipped, 0 undeclared` no matter how many cases had been
skipped.

Demonstrated rather than inferred. Running `apps/worker/tests/redis-integration.test.js`
against an unreachable Redis produces a report the reporter describes as

```
numTotalTests 5 | numPendingTests 5 | numPassedTests 0
  status= skipped | carries a payload through Redis and runs the real processor   (and four more)
```

and the checker, reading that exact file, answered:

```
Skipped-test check: OK — 5 case(s) ran across 1 report(s); 0 skipped, 0 allow-listed, 0 undeclared.
```

**Scope of the defect.** Only skip detection was blind. The zero-test half of the
same file — which fails a report containing no cases at all — read
`numTotalTests` and worked throughout. The allow-list was empty, so nothing was
ever wrongly exempted; it was simply never consulted.

**Consequence for this repository's history.** No published claim of the form
"0 skipped" in any earlier report was _checked_ by this gate, in this report or
in any before it. Each such claim may still be true — and for the CI runs cited
here it demonstrably is, by the per-task counts above — but it rests on those
counts, not on the checker. The clearest illustration is local rather than in
CI: a local battery run with PostgreSQL stopped produced 156 skipped cases in
`apps/api` and drove branch coverage to 71.44 against a floor of 75. The coverage
floor caught that. The skipped-test gate, looking at the same reports, did not.

**Fixed, with regression coverage.** `DID_NOT_RUN` now lists `skipped`, `pending`
and `todo`, and `packages/config/tests/skipped-tests.test.js` runs the real
script against reports a real reporter could have written — nine cases, including
the whole-suite skip shape above. The fix was verified in both directions before
it was pushed: it fails the real five-skip report with exit 1, and it passes the
repository's current reports with exit 0 and an empty allow-list.

**Not claimed:** that the gate is now exhaustive. It reads Vitest JSON reports
only. A Playwright suite that skips, a job that never starts, and a test file
deleted outright are all invisible to it, and the first two of those have both
occurred on this branch.

### 12.1 Coverage

| Package                | Lines | Branches  | Floor | Margin    |
| ---------------------- | ----- | --------- | ----- | --------- |
| `apps/api`             | 89.98 | **76.09** | 75    | **+1.09** |
| `packages/schemas`     | 96.09 | 79.24     | 75    | +4.24     |
| `packages/permissions` | 96.36 | 90.47     | 75    | +15.47    |
| `packages/auth`        | 99.60 | 95.61     | 75    | +20.61    |

The `apps/api` branch margin was `+1.04` at the start of Phase 2. It fell to
`+0.53` when the engine landed without route-level tests, and the route suite
brought it back to `+1.09` — above where the phase started, which is the
obligation the plan's §12 puts on new branches.

### 12.2 Tests added

| Suite                                       | Cases | Against            |
| ------------------------------------------- | ----- | ------------------ |
| `privacy-placeholders.test.js`              | 18    | pure functions     |
| `privacy-commands.test.js`                  | 20    | HTTP, in-memory    |
| `privacy-redaction-integration.test.js`     | 28    | real PostgreSQL    |
| `privacy-lifecycle-integration.test.js`     | 26    | real PostgreSQL    |
| `security-regression.test.js` (4 new)       | 27    | the whole contract |
| `privacy.test.js` / `privacy-scope.test.js` | 24    | Phase 1, unchanged |

**92 new cases**, plus three database probes.

### 12.3 CI

| Fact             | Value                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------- |
| Final SHA        | `0508da199dbb379403cacf38397dff77d874ea1d`                                            |
| Run              | [`35223710945`](https://github.com/KevinD003/desi-event.com/actions/runs/35223710945) |
| Trigger          | `workflow_dispatch`, run number 33                                                    |
| Attempt          | 1 — nothing was re-run                                                                |
| Conclusion       | **success**                                                                           |
| Jobs             | **8 of 8 `success`**                                                                  |
| Started/finished | 2026-09-17T12:53:22Z → 13:03:02Z                                                      |

Every job by name: `Policy, lint, contract, tests, build`,
`Browser — public catalogue`, `Browser — production build`,
`Browser — organiser venue maps`, `Browser — event lifecycle`,
`Browser — refusals`, `Browser — accessibility sweep`,
`Browser — commerce and operations detail`. All `success`.

**Eight steps skipped, and all eight are the same step.** Each job ends with an
artefact upload guarded by `if: failure()` — `Upload failure artefacts` on the
first job and `Upload Playwright artefacts` on the seven browser jobs. A green
run never exercises that path by construction, so a skip there is the workflow
working rather than a gap. Nothing else was skipped and nothing was cancelled.

The steps that matter to this phase all ran and all passed on the exact SHA:
`Test` (2m56s), `Coverage thresholds` (2m54s), `Fresh-database verification`,
`Upgrade-database verification`, `OpenAPI drift`, `Route-manifest drift`,
`Browser bundle scan`, `Dependency audit`, `Production payments are unreachable`
and `Reliability smoke test`.

**No failure was observed on this SHA, so none was root-caused, and no job was
re-run to obtain a green.**

---

## 13. Statement

**Phase 2 privacy redaction was exercised only against disposable test data. No
production user data was redacted. No real Stripe or Stripe Connect operation was
executed.**

Payment mode remains `MOCK`, the production kill switch is intact and proven by
its own test, and every real Stripe and Stripe Connect operation remains
`EXTERNAL VERIFICATION PENDING`.

No retention deletion ran. No UI was built. No export was invalidated. Phase 3
and Phase 4 have not begun.

---

## 14. Phase 2 result

**COMPLETE** against the scope the plan's §15 sets for Phase 2, with ten
limitations named in §11 and three owner decisions outstanding:

1. Whether to act on the historic `AuditLog` addresses, and how (§7.2).
2. Whether to backfill `NotificationOutbox.organizationId` (§7.4).
3. Whether `privacy_request_held_names_its_hold` should be corrected to match the
   enum it constrains (§8.1).

None of the three blocks Phase 3 from starting. All three change what Phase 3
should build.
