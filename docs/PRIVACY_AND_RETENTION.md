# Privacy and retention

What this system holds about a person, what happens to it when they ask to be
removed, and how long the rest of it is kept.

**This document is not legal advice.** Every duration in it is marked
**PROPOSED — REQUIRES LEGAL/PRIVACY REVIEW** and no claim of compliance with any
statute or regime is made anywhere in this repository. Nothing here has been
reviewed by counsel.

Status labels are used strictly, and they are the repository's own vocabulary: a
declared constant, a schema field or a paragraph in a document is not evidence
that a feature works.

---

## 1. The organising decision: a person is redacted, never deleted

Deleting a `User` row would remove the counterparty from financial records that
must keep balancing. The database refuses it, twice over and for two different
reasons — the posted-ledger triggers refuse the `SET NULL` that a delete becomes,
and since Phase 3 `desi_audit_log_immutable` refuses the same thing on the audit
trail. Neither refusal is a policy anybody can relax from the application.

So erasure here is **redaction**: the row, its id and every financial reference
survive, and the personal fields inside them are replaced by deterministic
placeholders derived from the row id.

That makes it irreversible on purpose. The approved rule, verbatim:

> Redaction replaces personal fields with deterministic, non-identifying
> placeholders derived from the relevant row ID. Redaction is irreversible. No
> reversal path, original value, backup field, encrypted copy, recoverable
> mapping, or hidden lookup may be stored. Repeating the same redaction is
> idempotent and produces the same safe result.

One consequence worth naming, because it rules out the obvious shortcut:
`pseudonymize` already exists in `packages/auth/src/tokens.js`, it is tested, and
it is **not** the placeholder mechanism. A keyed digest is reversible by whoever
holds the key, and a redaction a key undoes is not a redaction.

---

## 2. What is built, and what is not

> **HISTORICAL STATUS — SUPERSEDED IN PART, 2026-09-17.** The table below was
> written before Phase 3's Phase 2 and is preserved unchanged, because it is the
> record of what was true then. **Two of its rows are now wrong:** "Raising,
> confirming or executing a redaction" and "The redaction engine itself" are no
> longer `NOT IMPLEMENTED`. A third, "Reading redaction requests — `API-TESTED
ONLY`", is no longer the whole story: the privacy surface is now nine
> operations, four reads and five commands.
>
> **Four rows are still exactly true and must not be read as superseded:**
>
> | Still true                                   | Status                              |
> | -------------------------------------------- | ----------------------------------- |
> | The retention sweeper                        | `NOT IMPLEMENTED`                   |
> | Export invalidation and deletion             | `SCHEMA ONLY`                       |
> | Retention durations approved by counsel      | `BLOCKED — REQUIRES OWNER DECISION` |
> | Personal data redacted outside test fixtures | **None**                            |
>
> So is the sentence below the table: no personal data has been redacted by this
> system, and no retention deletion has run. The per-category matrix in §4
> carries the same caveat.
>
> **What this does and does not mean, stated so the gap is not misread:**
>
> - **Implemented:** the redaction service and its nine-operation API, tested
>   against real PostgreSQL.
> - **Not implemented:** any privacy **user interface**. There is no screen for
>   this; it is API-only.
> - **Not implemented:** export governance. `ExportArtifact` and
>   `ExportArtifactSubject` are schema; nothing invalidates or deletes an export.
> - **Not implemented:** retention **execution**. Nothing anywhere creates a
>   `RetentionSweep` row — the only `retentionSweep.create` in the tree is a
>   negative probe in `packages/db/scripts/verify-fresh-database.mjs` that expects
>   rejection and rolls back. Its `mode` column has no default, so there is no
>   "default mode" to rely on either. Nothing is scheduled and nothing deletes.
> - **Blocked, not merely undone:** retention durations remain
>   `PROPOSED — REQUIRES LEGAL/PRIVACY REVIEW`. This is a legal decision and no
>   engineering work substitutes for it.
> - **A standing limitation, not a defect:** historic `AuditLog` rows are
>   immutable by database trigger and may contain personal data in identifiers
>   and free text. They cannot be redacted or rewritten. **A data subject
>   therefore cannot truthfully be told their erasure is complete** while those
>   rows stand. That is an owner and legal decision, recorded and unresolved.
>
> No compliance claim is made here for GDPR, CCPA/CPRA, PCI DSS, HIPAA or any
> other regime.

> **Update — 2026-09-21, after Phase 3's Phase 3 remainder.** Three of the
> bullets above have gone out of date. They are corrected here rather than
> rewritten, because the block is the record of what was true when it was
> written, and this document's own house rule is that a dated record gets a
> dated correction.
>
> **"Not implemented: any privacy user interface" is no longer true.** Five
> screens exist: the request queue, a request's detail, holds, the export
> register and the retention rehearsal log. All of them are read-only except
> the request and hold commands, and none of them can start a retention sweep
> or activate enforcement — see §5C.
>
> **"Not implemented: export governance" is half true and the half that changed
> is the important one.** `recordExport` writes an `ExportArtifact` row, called
> from both CSV routes before the body is returned, and
> `invalidateExportsForSubject` runs inside the redaction transaction. What is
> still absent is the _subject link_: no export links a person, because both
> exports are aggregates — so invalidation matches nothing today, and a source
> scan in `apps/api/tests/export-register.test.js` asserts that nothing shipped
> in this repository writes an `ExportArtifactSubject` row. That absence is a
> finding rather than a gap, and §5B says why at length.
>
> **"Not implemented: retention execution. Nothing anywhere creates a
> `RetentionSweep` row" is no longer true.** The worker writes one row per
> evaluated class. What the bullet was protecting is intact and is worth
> restating in the narrower form: **no retention sweep is scheduled and the
> retention job deletes nothing.** The retention machinery has no deletion
> path, the API holds no queue client so no browser can start a sweep, no
> repeatable retention job exists and a test asserts the scheduler never
> mentions it. (Updated by SPEC2: the one deletion on a timer in this
> repository is the traffic roll-up's, of raw visit rows it has already added
> up — see "Visit counting" below. It is not a retention sweep.)
>
> The three bullets that did **not** change are the three that matter most: the
> durations remain `PROPOSED — REQUIRES LEGAL/PRIVACY REVIEW`, historic
> `AuditLog` rows remain unredactable, and **no personal data has been redacted
> by this system outside test fixtures.**

| Thing                                              | Status                                |
| -------------------------------------------------- | ------------------------------------- |
| `privacy:redact` capability, granted to OWNER only | `IMPLEMENTED`, `AUTOMATICALLY TESTED` |
| `PRIVACY_ERASURE` step-up policy, two minutes      | `IMPLEMENTED`, `AUTOMATICALLY TESTED` |
| Redaction data model and its constraints           | `DB-ENFORCED`                         |
| `AuditLog` immutability                            | `DB-ENFORCED`                         |
| `PrivacyAuditEvent` immutability                   | `DB-ENFORCED`                         |
| Reading redaction requests                         | `API-TESTED ONLY`                     |
| Raising, confirming or executing a redaction       | `NOT IMPLEMENTED`                     |
| The redaction engine itself                        | `NOT IMPLEMENTED`                     |
| Export invalidation and deletion                   | `SCHEMA ONLY`                         |
| The retention sweeper                              | `NOT IMPLEMENTED`                     |
| Retention durations approved by counsel            | `BLOCKED — REQUIRES OWNER DECISION`   |

**No personal data has been redacted by this system.** No retention deletion has
run. The tables above the line exist so that the work below the line can be done
safely; they are not that work.

> **Correction — 2026-09-18, Phase 3 / Phase 3.** Three more rows of the table
> above are now out of date, and one sentence of the superseded banner with them.
> The table is left unedited because it is the record of what was true when it
> was written; what follows is what is true now.
>
> | Row, as written above                            | Status now                                        |
> | ------------------------------------------------ | ------------------------------------------------- |
> | Reading redaction requests — `API-TESTED ONLY`   | There is now a browser surface. See below.        |
> | Export invalidation and deletion — `SCHEMA ONLY` | Invalidation is implemented; deletion is not.     |
> | The retention sweeper — `NOT IMPLEMENTED`        | A **rehearsal** is implemented. Execution is not. |
>
> **What is now implemented:**
>
> - **A privacy user interface.** The banner's "there is no screen for this; it
>   is API-only" is no longer true. `/privacy` carries the request queue, request
>   detail with its scope table and evidence timeline, the confirmation flow,
>   cancellation, the hold list, and the export register.
> - **An export register.** Both CSV export routes now write an `ExportArtifact`
>   row before returning a body, and a failure to record fails the export. A
>   redaction invalidates every live artefact linked to its subject, inside the
>   same transaction.
> - **A retention rehearsal.** `sweep-retention` counts what each proposed
>   duration would reach and writes one `RetentionSweep` row per class. It is
>   enqueued deliberately by an operator and is on no schedule.
>
> **What is still not implemented, and must not be read as done:**
>
> - **Retention execution.** The retention job deletes nothing. It has no
>   deletion path, `RETENTION_ENFORCEMENT_ACTIVATED` defaults to false, and
>   `retention_sweep_dry_run_changes_nothing` refuses a `DRY_RUN` row claiming a
>   non-zero `affectedCount` whatever any code believes. The only deletion on a
>   timer is the traffic roll-up's, of raw visit rows (see "Visit counting").
> - **Export deletion.** An artefact can be invalidated. Nothing deletes one,
>   because nothing stores one: every export is streamed and no bytes are kept.
> - **Approved durations.** Still `BLOCKED — REQUIRES OWNER DECISION`. No
>   engineering work substitutes for a legal decision.
> - **Historic `AuditLog` personal data.** Unchanged, immutable, and still the
>   reason a subject cannot truthfully be told their erasure is complete.
>
> No compliance claim is made for GDPR, CCPA/CPRA, PCI DSS, HIPAA or any other
> regime. No personal data has been redacted outside test fixtures. No retention
> deletion has run.

---

## 3. Who may redact, and why not somebody else

`privacy:redact`, granted to the organisation `OWNER` and to nobody else. OWNER
inherits ADMIN, so granting anywhere lower in the role graph would hand the
authority to a superset by inheritance — this is the narrowest grant the table
can express. A standing test asserts that exactly one organisation role holds
it, so a future edit that widens it fails rather than ships.

It is **organisation-scoped**, not platform-only. Every route asserting it names
an organisation, and one request never spans two.

### Why not an existing capability

**`organization:manage`** authorises routine administration — the organisation
record, its members, its settings — and is held by people who should be able to
rename the company without also being able to destroy somebody's personal data
irreversibly. Widening it would have granted this authority to every existing
holder with no review and no migration.

**`platform:admin`** is the key to everything. Granting redaction through it
would make the decision unauditable as a distinct one and ungrantable narrowly.

**`attendee:export`** is a bulk _read_. Reading and destroying are not the same
decision and the vocabulary should not pretend they are.

### Why not an existing step-up policy

**`CREDENTIAL`** and **`SECURITY_ROLE`** both gate authentication authority —
removing a factor, granting a role — and both of those are reversible. A factor
can be re-enrolled; a role can be granted back. A redaction cannot be undone, so
a policy whose name says "credential" would misdescribe what the control
protects, and a control whose name misdescribes what it protects is one nobody
can reason about.

`PRIVACY_ERASURE` is two minutes, the shortest tier in the table, matching the
scale the codebase already uses for what a person does while looking at the
screen.

### Why a step-up window is not, by itself, enough

Nothing consumes `mfaSatisfiedAt`. One step-up therefore authorises every action
inside its window, and for an irreversible one that is too much: two minutes of
authority to destroy an unbounded number of people is not what "confirm your
identity again" means to the person doing it.

So a redaction additionally requires a **single-use, server-issued confirmation**
spent on one request, and a **server-generated idempotency key**. The step-up
proves somebody is still at the keyboard; the confirmation proves they meant this
particular subject. Neither is ever accepted from a browser: a caller-chosen
idempotency key is a caller-chosen replay, and a caller-chosen confirmation is
not a confirmation.

### Cross-organisation redaction is refused at two layers

The capability check confines an organiser to the organisation in the path. It
does **not** confine a platform `SUPER_ADMIN`, which holds every capability
platform-wide and is granted it before an organisation id is consulted at all.
`assertSubjectBelongsToOrganization` is the second layer, and it applies to
everybody rather than special-casing a role: a subject counts only when the
organisation holds a membership, an order, a ticket or a waitlist entry for
them. A subject out of scope and a subject who does not exist get the same 404
with the same sentence.

---

## 4. Per-category treatment

The unit is a **category**, not a table. A table-keyed policy cannot answer a
per-field question, and the question a redaction asks is always per-field.

Categories are also what an operator is asked to confirm. A column list is a map
of where the personal data is, and handing one to a browser would be a worse leak
than the fields it describes.

| Category                 | Fields it covers                                                                   | Treatment                                        | Status            |
| ------------------------ | ---------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------- |
| `ACCOUNT_IDENTITY`       | `User.email`, `User.displayName`, `User.phone`                                     | Redact to a placeholder derived from the row id  | `NOT IMPLEMENTED` |
| `BUYER_IDENTITY`         | `Order.buyerEmail`, `Order.buyerName`                                              | Retain the order, redact the identity in it      | `NOT IMPLEMENTED` |
| `TICKET_HOLDER_IDENTITY` | `Ticket.attendeeName`, `TicketTransfer.toEmail`                                    | Retain the ticket and its state, redact identity | `NOT IMPLEMENTED` |
| `NOTIFICATION_DELIVERY`  | `NotificationOutbox.recipient`, personal keys in `NotificationOutbox.payload`      | Redact after a terminal send state only          | `NOT IMPLEMENTED` |
| `SECURITY_METADATA`      | `Session.userAgent`, `Session.ipHash`, `LoginAttempt.emailHash`/`ipHash`, `Device` | Delete on a retention schedule, not on request   | `NOT IMPLEMENTED` |
| `EXPORTS`                | Rows in `ExportArtifact` naming the subject                                        | Invalidate, then delete where bytes were stored  | `SCHEMA ONLY`     |

### Retained unchanged, and why

Tax totals, `LedgerEntry`, `LedgerBatch`, `LedgerAccount`, existing `AuditLog`
rows, ticket inventory, ticket state and admission state are **not** touched by a
redaction. Amounts, dates, currency, transaction states and non-personal
references are the financial fact; the name inside the row is not.

An active legal hold or fraud investigation overrides everything above until it
is released.

### What the placeholders have to satisfy

Three constraints, all real and all discovered from the schema rather than
assumed:

1. `User.email`, `User.displayName`, `Order.buyerEmail`, `Order.buyerName`,
   `NotificationOutbox.recipient`, `Invitation.email`, `TicketTransfer.toEmail`
   and `WaitlistEntry.email` are **NOT NULL**. A redaction cannot write null.
2. `User_email_key` and `WaitlistEntry_eventId_email_key` are **unique and not
   nullable**, so a shared constant collides the moment two people are redacted.
   The placeholder must be per-row unique, which is why it is derived from the
   row id.
3. `emailSchema` is `z.email()` and `nonEmptyStringSchema` is `min(1)`. A
   placeholder that is not a syntactically valid address, or is empty, would make
   an existing presenter return a 500 rather than a redacted payload.

---

## 5. Retention

Every duration below is **PROPOSED — REQUIRES LEGAL/PRIVACY REVIEW**. None is
enforced. The sweeper that would enforce them is `NOT IMPLEMENTED`, and
`retention_sweep_dry_run_changes_nothing` means the database refuses a rehearsal
that claims to have changed something.

> **Correction — 2026-09-18.** This paragraph previously said the sweeper's
> "default mode is `DRY_RUN`". That was false and is removed. `RetentionSweep.mode`
> has **no** `@default` in `schema.prisma` and no `DEFAULT` in the migration, so
> any writer must pass it explicitly on every insert — a forgotten field is a
> runtime error, not a silent `DRY_RUN`. The banner earlier in this document
> already said so, and the two statements contradicted each other. The same
> incorrect wording still appears in `schema.prisma`'s `RetentionSweep`
> doc-comment and in the Phase 1 migration's commentary; the migration is applied
> history and is not edited. Corrected here because it would otherwise mislead
> whoever writes the retention worker.

| Data                                      | Proposed retention                      | Basis                                         |
| ----------------------------------------- | --------------------------------------- | --------------------------------------------- |
| `LoginAttempt`                            | 30 days — **PROPOSED**                  | It exists for rate limiting, not history      |
| `Session`, `AuthToken` after expiry       | 30 days — **PROPOSED**                  | Nothing needs a spent token                   |
| `Session.userAgent`, `Session.ipHash`     | 90 days — **PROPOSED**                  | Security metadata, already hashed             |
| `NotificationOutbox.recipient` after send | Redact on send + 30 days — **PROPOSED** | The evidence is that it went, not where       |
| `ExportArtifact` bytes                    | 7 days — **PROPOSED**                   | An export is a working copy, not a record     |
| `Order`, `Refund`, `Payout`, ledger       | Indefinite                              | The counterpart of the ledger; not a proposal |
| `AuditLog`, `PrivacyAuditEvent`           | Indefinite                              | Append-only at the database                   |

Nobody has supplied a jurisdiction, a statutory minimum for financial records, or
a maximum for non-evidential personal data. Until somebody does, **no scheduled
deletion runs in production**, and the sweeper refuses to execute unless a
documented activation condition says otherwise.

### 5A. The rehearsal — added 2026-09-18, Phase 3 / Phase 3

A rehearsal exists. It counts what each proposed duration **would** reach and
writes one `RetentionSweep` row per class recording the cut-off it used, how many
rows were in scope, and how many of those an active hold protected.
`affectedCount` is 0 on every row.

**It cannot delete, and that is structural rather than careful.** Three
independent things stop it, only the first of which depends on the code being
right:

1. `retention_sweep_dry_run_changes_nothing` — a CHECK constraint refusing any
   `DRY_RUN` row that claims a non-zero `affectedCount`.
2. No deletion path exists in `apps/worker/src/retention/classes.js` or in
   `apps/worker/src/processors/sweep-retention.js`. The unit tests prove it
   with a Prisma stub whose `delete`, `deleteMany`, `update`, `updateMany` and
   both raw-SQL escapes throw. The one deletion on a timer elsewhere in the
   repository is the traffic roll-up's (`packages/db/src/traffic-rollup.js`),
   of raw visit rows it has already added up; it is not a retention class.
3. `RETENTION_ENFORCEMENT_ACTIVATED` defaults to false, and defaults to false
   again in `createProcessors`, so a caller who forgets it gets the refusing
   worker rather than the counting one.

**An unactivated environment records a row rather than doing nothing.** The state
is `SKIPPED_DISABLED`, with the cut-off it would have used. "Nothing happened"
and "we were told not to" are different answers, and an operator who cannot tell
them apart goes looking for a broken worker.

**There is no schedule, deliberately.** A retention sweep on a timer is the first
step towards a retention sweep that deletes on a timer, and every duration here
is a proposal nobody has approved. A test asserts that `scheduler.js` never
mentions the job. It is enqueued by an operator through `enqueueSweepRetention`
and by nothing else; the API exposes no route that starts one, because the API
holds no queue client.

#### Which classes are evaluated, and which is not

Four are: `login_attempt`, `session`, `session_metadata` and
`notification_recipient`. The proposals live in `@desi-event/schemas/retention`,
shared by the worker that counts and the API that describes; the queries live in
the worker alone, because a module holding both would be one bad edit from being
able to delete.

`session_metadata` is a fifth class the schema's own vocabulary does not name.
The table above proposes different durations for a session row (30 days) and for
the security metadata on it (90 days), and the two expire on different clocks;
folding them into one class would sweep one of them on the wrong proposal.

`export_artifact` is reported **NOT EVALUATED** rather than swept. The proposed
seven days is a duration for export **bytes**, and no bytes are kept: both CSV
routes stream to the caller and record the artefact with `ephemeral: true` and a
null `storageKey`. The table holds the record _that_ an export happened, and
sweeping it would delete evidence rather than a working copy.

> **Correction — 2026-09-21.** This paragraph originally read "Nothing in the
> repository has ever written an `ExportArtifact` row for bytes, so a count
> there would report an emptiness meaning 'no writer exists'". That was written
> in the same pull request that added the export register, and the register
> falsified it immediately — §5B above describes both CSV routes writing a row.
> The conclusion is unchanged and the reason is replaced. Recorded rather than
> silently swapped because the same sentence had been copied into
> `packages/schemas/src/retention.js`, where it rendered verbatim on the
> `/retention` operator screen until 2026-09-21.

#### Reading a rehearsal

`GET /v1/operations/retention/sweeps`, and `/retention` in the browser. Requires
`retention:view`, which is platform-only — no organisation role can carry it,
because `RetentionSweep` has no `organizationId` and a sweep counts across every
tenant at once. **Which platform role should hold it is an owner decision that
has not been made**; only `SUPER_ADMIN` has it, through `ALL_CAPABILITIES`.

Each row carries its own approval status rather than the page stating it once, so
a number lifted into a ticket or a screenshot brings `PROPOSED — REQUIRES
LEGAL/PRIVACY REVIEW` with it.

### 5B. The export register — added 2026-09-18, Phase 3 / Phase 3

**This section is the export-governance document.** A separate
`docs/EXPORT_GOVERNANCE.md` was named in the Phase 3–3 brief and deliberately
not created: it could only duplicate what is below or split the export story
across two files, and in a repository that keeps a `STATUS_READING_GUIDE.md` to
stop figures being quoted from the wrong place, a thin redirect is worse than no
file — because a file that exists gets cited as the authority. The reasoning at
the point of change is in `apps/api/src/lib/export-register.js`.

§8 below says a downloaded export cannot be recalled. That is still true. What
has changed is that the system now knows an export happened.

Both CSV routes write an `ExportArtifact` row **before** returning a body, and a
failure to record fails the request: an export that happened with no record of it
is what the register exists to prevent, and a best-effort register is empty
exactly when somebody needs it. `ephemeral` is true and `storageKey` is null,
stated explicitly rather than defaulted, so a future stored export has to say so
rather than inheriting a claim that stopped being true.

**No export in this system contains a person.** Both routes emit aggregate
figures under explicit column allow lists — no name, no address, no e-mail, no
card, no provider reference. So nothing links an `ExportArtifactSubject`, and the
`EXPORTS` redaction category answers `NOTHING_TO_DO` rather than the `DEFERRED`
it answered before. A test asserts that nothing ever writes a subject link; the
first export that does carry a person fails that test rather than slipping past
the redaction path.

A redaction invalidates every live artefact linked to its subject, in the same
transaction as the rest of the redaction, so there is no moment in which a person
is redacted while the register still advertises an artefact containing them.
Invalidated rather than deleted: the bytes were never stored, so what changes is
the register's claim that the artefact is good.

**Stated limitations.**

- A **platform-wide finance export is not recorded at all.**
  `ExportArtifact.organizationId` is NOT NULL and an export belonging to no
  organisation cannot be written without a migration. Attributing an
  everybody-export to one tenant would make the register actively wrong, which is
  worse than visibly incomplete, so it is skipped and logged. Whether to widen
  the column is an owner decision.
- **`attendee:export` is a capability with no route.** Nothing in the API asserts
  it. No route was invented for it here; it is recorded as a finding.
- **Nothing deletes an artefact row.** `DELETED` and `DELETION_FAILED` remain
  states nothing writes.

---

## 6. Legal and fraud holds

`PrivacyHold` names a matter outside this system by reference — a case number, a
counsel's reference — and never its contents, never an allegation, never a third
party. `privacy_hold_names_its_matter` refuses a blank reference, because a hold
nobody can resolve blocks a person's redaction indefinitely.

Nothing expires a hold. A hold that lapsed on its own would be a legal obligation
with a timer nobody checked. `expectedUntil` is advisory and a release is an act.

An active hold **refuses** a redaction and records the refusal. "Nothing
happened" and "we were told not to" are different answers, and only one of them
is evidence.

---

## 7. Auditability

Two tables, deliberately.

`AuditLog` gets a row for every privacy action, in the vocabulary an operator
already reads, so the surface does not go quiet about the most consequential
action the system can take.

`PrivacyAuditEvent` is the evidence. Every column is an opaque id, an enum, a
hash or a count: action, actor, organisation, request, target, policy version,
reason code, hold decision, an idempotency key **hash**, result, correlation id
and timestamps. It exists separately because `AuditLog` has no organisation
column and no correlation column, so the questions this evidence is for — every
redaction in one organisation over a period, every refusal and its reason code,
every event of one run — are not expressible against it.

It carries **no personal data, no old or new values, no raw email, phone,
address, token, secret, card reference or message body.** There is no redaction
path into it because there is nothing there to redact.

---

## 8. Known limitations, stated rather than discovered

### `AuditLog.metadata` already contains e-mail addresses

**BLOCKED — REQUIRES OWNER DECISION.**

**Corrected 2026-09-17.** This paragraph first said three code paths write raw
addresses into audit metadata — ticket transfer, checkout and team invitation.
Two of the three were wrong. `apps/api/src/lib/checkout.js:70` is the payment
provider's intent metadata, not an audit row, and
`apps/api/src/routes/teams.js:292` records only
`{ organizationId, role, requestedEventIds }`.

Measured rather than estimated: **68 `recordAudit` call sites across
`apps/api/src` and `apps/worker/src` were scanned, and exactly two name a
personal field.** Both are `toEmail`, both in `apps/api/src/lib/tickets.js`, on
the `ticket.transfer_started` and `ticket.transfer_ended` actions.

A second measurement, over the metadata **values** rather than their keys, found
a class the first pass missed: up to twenty of those 68 call sites write an
operator's free-text `reason`, `reasonNote` or `note` into audit metadata, and the
schemas behind those fields bound length only — `z.string().trim().min(4).max(500)`
and similar. Eight are proven by reading `request.body` at the call site; the other
twelve take the value as a parameter and were not individually traced. Nothing rejects a name, an address or a telephone number typed into a
refund reason or an escalation note. `docs/PHASE3_PHASE1_IMPLEMENTATION_REPORT.md`
§11.2a lists every site.

The authorised rule is that existing audit rows are retained unchanged, and
`desi_audit_log_immutable` now enforces exactly that — so those historical
addresses **cannot be redacted in place**, and a redaction that rewrote them
would be the audit rewrite this design exists to prevent. The same is true of
anything an operator typed into a `reason` before today.

The options are (a) accept the exclusion and say so in the policy, (b) stop
writing addresses into audit metadata going forward and accept the historical
rows, or (c) relax the immutability rule for a metadata-only update under a named
condition. Only (a) and (b) are consistent with an append-only audit trail. This
has not been decided and Phase 3 has not decided it unilaterally.

For the free-text class there is a fourth option, (d): keep the operator's note
on the mutable domain row that already stores it — `Refund.reasonNote`,
`ReconciliationNote.body` and `EventStatusChange.reason` all exist — and put only
its identifier in the audit metadata. That leaves the note redactable while the
audit row still points at it. It is the option this document recommends, and it
is also the one that changes the most call sites, so it is put to the owner
rather than taken.

### `LedgerEntry.memo` can never be redacted

`desi_ledger_entry_immutable` refuses any update once the owning batch is
`POSTED`. If a memo ever carried a person's name, no mechanism in this system can
remove it. Financial immutability is the stronger control and is preserved.

### A downloaded export cannot be recalled

`ExportArtifact` makes "delete the exports containing this person" answerable for
bytes this system still holds. It says nothing about a copy somebody already
downloaded, and nothing in this design pretends otherwise.

### Backups predate the redaction

A restore from a backup taken before a redaction reinstates the values the
redaction removed. The operational runbook has to require re-running every
completed redaction since the backup point, and that window is a real exposure
rather than a theoretical one.

### The organisation side is out of scope

`Organization.contactEmail` is NOT NULL and `Organization.legalName` is personal
data whenever the organiser is a sole trader. Redacting an organisation is a
different problem with different financial constraints — `Transfer` and `Payout`
both reference it with `onDelete: Restrict` — and Phase 3 does not attempt it.

### Event pictures are outside redaction

An organiser's cover and gallery pictures can show identifiable people, and
the redaction engine does not reach them: a picture is not linked to a data
subject, so there is nothing for a subject-scoped redaction to find. What
exists instead is removal. The organiser can delete a picture in almost every
event state, which deletes its bytes rather than hiding them, and a moderator
can take one down at once. EXIF location and camera details are stripped at
upload, so a stored picture carries no coordinates. A picture that was public
can survive in caches that fetched it for up to a day
([MEDIA.md](MEDIA.md#how-long-a-taken-down-picture-can-linger)).

---

## Phase 2: what is now implemented

Added 2026-09-17, when the redaction service shipped. Everything above this line
described a design; this section describes running code, and
`docs/PHASE3_PHASE2_IMPLEMENTATION_REPORT.md` holds the evidence.

### The placeholder

`sha256(field + "\0" + rowId)` truncated to twelve hex characters, rendered as
`redacted-<token>@redacted.invalid` for an address and `Redacted person <token>`
for a name. It takes no secret and no clock, so re-running a redaction produces
byte-identical rows. It never reads the value it replaces, so there is nothing to
invert — and `.invalid` is reserved by RFC 2606, so a placeholder address can
never resolve or be delivered to.

**No original value, backup column, encrypted copy, reversal table or recoverable
mapping is stored anywhere.**

### What the engine touches

`User.email`, `User.displayName`, `User.phone` (nulled), `Order.buyerEmail`,
`Order.buyerName`, `Ticket.attendeeName`, `TicketTransfer.toEmail` on settled
transfers, `WaitlistEntry.email`, `NotificationOutbox.recipient` and its payload
on settled rows, and `Organization.contactEmail` / `Event.contactEmail` **only
when the stored address is the subject's own**. Since 2026-10-07 also
`OrganizerInvitation.email` and `OrganizerInvitation.note` (nulled) on settled
organiser invitations, counted under `ACCOUNT_IDENTITY` — see
[Organiser invitations](#organiser-invitations--2026-10-07).

That last narrowing is a deliberate departure from the matrix above. Read
literally, the matrix would have an attendee's erasure request blank the
organiser's public contact address and break their ability to be contacted about
their own events. The implemented rule replaces those columns only where they
hold personal data about the subject.

### What it never touches

Amounts, currency, tax, fees, discounts, order status, payment status, refund
state, payout state, dispute state, reconciliation evidence, every ledger entry
and batch, ticket status, ticket code, credential digest, seat assignment,
check-in state, `dedupeKey`, and every foreign key.

### Two scoping rules

**Organisation-scoped data is redacted.** Orders, tickets, transfers, waitlist
entries and notifications belonging to this organisation.

**Account-wide data is redacted only when this organisation is the last one.**
`User.email` serves every organisation a person deals with, so an organiser who
could blank it would be erasing that person from organisations they hold no
authority over. When another organisation still holds something, the category
reports `OUT_OF_SCOPE` and the preview says so before the operator confirms.

**A person who deals with two organisations therefore cannot have their account
identity removed by either one alone.** Whether a platform-level path should
exist for that is an owner decision, and no such path was built.

### When a redaction refuses

A legal hold or a fraud-investigation hold refuses it until somebody lifts the
hold. An **open process** refuses it temporarily and lets the operator retry once
the process settles: a pending ticket invitation, a refund still moving, an open
dispute, an open reconciliation task, an unspent admission for an event that has
not finished, a message still waiting to go out, or — while the account itself
would be redacted — an organiser invitation still waiting for the subject.

The pending-invitation case is the sharpest and is worth naming. Accepting a
ticket invitation is authorised by comparing the signed-in address against the
address the invitation was sent to. Redacting either side mid-flight makes the
invitation unacceptable by anybody, including its rightful recipient, and the
ticket is stranded until it lapses. Refusing costs the subject a wait; redacting
anyway costs somebody a ticket they paid for.

### What a subject can be told, and what they cannot

They can be told that their identity has been replaced everywhere this
organisation holds it, that the financial record of what they bought survives
without their name on it, and that the replacement cannot be reversed.

**They cannot be told the erasure is complete**, for as long as the historic
`AuditLog` addresses described above remain. That is not a wording problem to be
solved by better phrasing; it is a fact about the data, and it stays true until
the owner takes one of the options in the section above.

## Guests' names, and the online joining link — 2026-09-29

**A guest's name is personal data the buyer typed.** Checkout asks, optionally,
who is going: one name per ticket, or per seat. The person named may have no
account here and has agreed to nothing, so the name is kept to where it is
needed:

- **On the ticket**, as `Ticket.attendeeName`, which is where the door reads it.
  It is redacted with the ticket's holder, like any other ticket field.
- **Staged on the order's lines until settlement** (`OrderItem.attendeeNames`,
  `HoldItem.attendeeName`), and cleared the moment the tickets are issued, when a
  declined payment cancels the order, and when a buyer-identity redaction reaches
  an order still waiting to be paid. The staging is never sent back to a client.
- **Never in a log, an audit record or an outbox row.** The logger redacts
  `attendees`, `attendeeName` and `attendeeNames`.

The door shows the name with anything address-shaped removed, the same scrubber
the API applies elsewhere; the checkout refuses a name that is an email address
before it is sent.

A named guest without an account cannot make an erasure request of their own:
there is no identity here to match it to. Their name goes when the ticket's
holder's identity is redacted — the buyer's, for a ticket the buyer still holds —
so a guest who wants it gone has to ask the buyer or the organiser to act. This
is a limit of the current model, recorded rather than worked around.

**The online joining link is for ticket holders.** `events.get` used to put an
online event's `onlineUrl` in every response, anonymous ones included, and the
page's structured data used it as the event's location. It is now in the
payload only for a member of the owning organisation (who edits it), and the
public page and its JSON-LD name the event's own page instead. A buyer receives
it as `onlineJoinUrl` on their wallet, their ticket and their order, and only
while a ticket they hold admits — the same decision the door makes. Links that
were published before this change were public for as long as they were; an
organiser who used one should rotate it.

## Visit counting — 2026-10-06

First-party visit counting (ADR 0013) records visits to event pages without
recording who made them.

- **What a raw visit row holds** (`TrafficEvent`): the event, the UTC day, what
  happened (a page view, an event-card click, a ticket or seat press, a visit
  through the website link), where, for a page view the category of the
  referring site (from its host name, never a URL), and a visitor code. **No
  address, no browser string, no account.** A request that arrives without an
  address is not stored at all.
- **The visitor code** is an HMAC of the connection and browser under a random
  secret for that day (`TrafficSalt`). The secret is deleted from the live
  database when the day ends, after which the code cannot be recomputed from an
  address. **Backups taken during the day keep that secret for as long as the
  backups are kept**, so a restored backup could link that day's codes to
  addresses again. Browsers sending Global Privacy Control or Do Not Track get
  no code at all and are counted as page views only.
- **Who is not counted:** robots and automated tools, the organisation's own
  members and staff at The Desi Events while signed in.
- **Deleted on a timer, by the roll-up — not by retention.** The worker's
  traffic roll-up adds raw rows into daily totals (`TrafficDaily`) and deletes
  each raw row two days after its day, and each day's secret once the day is
  over. This is the one deletion on a timer in the repository. It is data
  minimisation decided in ADR 0013, not a retention decision: the retention
  sweep still cannot delete anything (§5 and `RETENTION_RUNBOOK.md`), and
  `traffic_event` was deliberately not made a retention class.
- **What is kept:** the daily totals, which are counts per event per day and
  identify nobody. They cascade with their event.
- **Who sees them:** an organisation's members holding `report:view` see their
  own events' totals; the platform list of the team at The Desi Events
  (`analytics:view_all`)
  shows counts for every event. Nobody sees a visitor code.
- **Website visits** through an event's switched link are recorded as a
  `TrafficEvent` of kind `WEBSITE_REDIRECT`, with no address, browser string or
  account, and follow the same rules.
- **Demonstration rows.** The development seed writes fourteen days of totals
  marked `demonstration` for two events; they are not counted visits, and every
  screen that sums one says so.

Privacy redaction does not touch these rows: they hold nothing a subject could
be found by.

## Free-text reasons — 2026-10-06

Full control of posted events (ADR 0014) and the import (ADR 0015) add reason
boxes: deleting an event, restoring one, cancelling a night, opening a platform
editing sitting and moving an imported event to another organisation. Each
reason is **stored as typed**, wherever it lands:

- the event's deletion columns (`Event.deletionReason`), its history
  (`EventModerationAction`), the sitting (`EventPlatformEdit`), the change
  notice shown to ticket holders (`EventChangeNotice`), the import record, and
  audit metadata;
- for a deletion that cancels and refunds a live event, `Event.cancellationReason`;
  for a cancelled night, `EventSession.cancellationReason`;
- the notice queued for every buyer (`NotificationOutbox.payload.reason` of
  `event.cancelled` and `event.session_cancelled`), which the message templates
  print. This build's worker hands messages to an in-memory provider, so these
  notices are not emailed today (the `Email` limitation); a deployment that
  wires a real mail provider would put the reason in every buyer's mailbox,
  beyond anything this site can change afterwards;
- `Refund.reasonNote` on every refund the deletion or the night's cancellation
  asks for.

**The privacy process does not redact any of these**: redaction replaces known
personal fields by their placeholders, and it cannot know what somebody typed
into free text. On a settled notification it drops only the named personal
keys of the payload (`PERSONAL_PAYLOAD_KEYS`), and `reason` is not one of them.

So the forms say, under every one of those boxes: "Shown with the event's
history. Do not include anybody's personal details." The limitations page says
the same in `deleted-events-kept`. A reason that does name somebody can be
found only by reading it; there is no tool here that searches or rewrites
reasons, and an audit row cannot be changed at all (`desi_audit_log_immutable`).

The same holds for the reason recorded with a website-link decision (shown to
the organiser). The administrator's note on an organiser invitation (never
public, shown to the recipient with the code) is the one exception: it is
written to one person, so erasing that person drops it (below).

## Organiser invitations — 2026-10-07

An organiser invitation (`OrganizerInvitation`) holds the address it was sent to
and the inviting administrator's note to that person, and the list of the team
at The Desi Events shows both for every invitation, whatever its status. Once
accepted it is linked to the organisation it created.

- **Erased with the person.** Erasing somebody replaces the address on their
  settled invitations — accepted, withdrawn or expired — with a placeholder
  derived from the invitation's id, and nulls the note. The status, the dates,
  who invited and accepted, the organisation's name, description and website
  and the link to the organisation stay: they are the team's record of who was
  invited to start what, and the organisation's own details. Matched by the
  account that accepted it or by the address.
- **The same two scoping rules.** The invitation an organisation was created
  from is that organisation's record, and is always reached, like its contact
  address. Any other invitation to the person is account-wide, and is reached
  only when their account identity is — when no other organisation holds
  anything about them. The scope preview counts both under `ACCOUNT_IDENTITY`.
- **A waiting invitation refuses the erasure.** Accepting an invitation
  compares the signed-in account's address with the invitation's. While one
  waits for the person and their account would be erased, the erasure is
  refused as an open process (`ORGANIZER_INVITATION_PENDING`) until it is
  accepted, withdrawn or expires; the caller hears the same refusal as for any
  open process. While another organisation keeps the account, nothing is
  stranded, so it does not refuse.
- **Not sent again.** An expired invitation whose address was erased cannot be
  reissued (409 `NOT_OUTSTANDING`): there is nobody to send a code to.

The policy version stamped on requests moved to `2026-10-07.1` with this
change.

## Deleted events and their personal data — 2026-10-06

Deleting an event is not erasure. A deleted event keeps its record, orders,
tickets, refunds, history and pictures so the team at The Desi Events can
restore it and so money stays accounted for; nothing on the site erases one.
Removing a person's data from it goes through the privacy process as for any
event: redaction writes `Event` and order columns other than `status`, which no
deletion trigger blocks. A deleted event's pictures stop being served at once,
though a copy already in somebody's browser cache can stay there for up to a
day.

## Imported events — 2026-10-06

The Sulekha dataset (ADR 0015) was collected and committed credential-free:
its validator refuses email addresses and phone numbers anywhere in it, and no
phone number or email address was kept from the listings. It names organisers
as their listings did ("Presented by"), which is public business information,
not an account. Nobody belongs to the organisation that holds imported events.

## Booking fees, referral codes and paying at the venue — 2026-10-09

ADRs 0016 and 0017 add reason boxes, a label and three kinds of record.

**More free-text reasons, kept as typed.** Each takes 10–500 characters (a
code's switch-off reason is optional) and is not redacted by the privacy
process, for the reasons above:

- an event's booking-fee decision (`EventFeeSetting.reason`, the audit row),
  shown to the organiser with the administrator's name;
- a pay-at-the-venue change (`EventVenuePaymentChange.reason`,
  `Event.venuePaymentReason`, the audit row), shown the same way;
- a booking fee refunded by hand (`Refund.reasonNote`, the refund's audits);
- a referral code switched off (the audit row);
- a cancellation of unpaid tickets (`VenueBookingCancellation.reason`, the audit
  row, and the `venue_booking.cancelled` notice queued for the buyer and each
  other holder, which prints it). It is shown to the buyer on their order page
  and to every holder of a cancelled ticket on its wallet card and its page
  (`venuePayment.cancelled.reason`), never with who wrote it, and its box says
  so.

**Referral codes' labels** are notes for administrators (1–120 characters),
never copied into an audit row, and kept as typed.

**What the boxes say.** The fee and switch reasons: "Shown to the organiser with
your name. Do not include anybody's personal details. At least 10 characters."
The cancellation reason: "Shown to the buyer and to anybody holding these
tickets. Do not include anybody's personal details. At least 10 characters." A
referral code's label: "For the team at The Desi Events only, for example the
partner organisation or the campaign it is for. Do not include anybody's
personal details." The other reasons keep "Shown with the event's history. Do
not include anybody's personal details."

**No buyer data where it is not needed.**

- Referral-code reports name orders by reference, event, date, payment method,
  status and fee waived — never a buyer's name, address or account.
- A payment taken at the door records the order, the night, the door authority
  and the steward's account, not the buyer; its audit row never names the
  buyer.
- A cancellation of unpaid tickets and a referral return marker hold no buyer
  data. The administrators' list of bookings waiting to be paid at the door has
  no buyer or attendee names; the organiser's page shows them as their order
  pages already do.
- Notices carry ids, amounts and prose only; no notice carries a code or an
  address beyond the recipient's own.
