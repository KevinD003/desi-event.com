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
enforced. The sweeper that would enforce them is `NOT IMPLEMENTED`, its default
mode is `DRY_RUN`, and `retention_sweep_dry_run_changes_nothing` means the
database refuses a rehearsal that claims to have changed something.

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

Three code paths write raw addresses into audit metadata: the ticket-transfer
path, the checkout path and the team-invitation path. The authorised rule is that
existing audit rows are retained unchanged, and `desi_audit_log_immutable` now
enforces exactly that — so those historical addresses **cannot be redacted in
place**, and a redaction that rewrote them would be the audit rewrite this design
exists to prevent.

The options are (a) accept the exclusion and say so in the policy, (b) stop
writing addresses into audit metadata going forward and accept the historical
rows, or (c) relax the immutability rule for a metadata-only update under a named
condition. Only (a) and (b) are consistent with an append-only audit trail. This
has not been decided and Phase 3 has not decided it unilaterally.

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
