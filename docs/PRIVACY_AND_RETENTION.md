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
> restating in the narrower form: **nothing is scheduled and nothing deletes.**
> There is no deletion path anywhere in this repository, the API holds no queue
> client so no browser can start a sweep, no repeatable job exists and a test
> asserts the scheduler never mentions the job.
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
> - **Retention execution.** Nothing deletes. There is no deletion path in the
>   repository, `RETENTION_ENFORCEMENT_ACTIVATED` defaults to false, and
>   `retention_sweep_dry_run_changes_nothing` refuses a `DRY_RUN` row claiming a
>   non-zero `affectedCount` whatever any code believes.
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
2. No deletion path exists in `apps/worker/src/retention/classes.js`, in
   `apps/worker/src/processors/sweep-retention.js`, or anywhere else. The unit
   tests prove it with a Prisma stub whose `delete`, `deleteMany`, `update`,
   `updateMany` and both raw-SQL escapes throw.
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
when the stored address is the subject's own**.

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
not finished, or a message still waiting to go out.

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
