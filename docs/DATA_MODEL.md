# The data model

55 models, 45 enums, 23 plpgsql triggers and 59 CHECK constraints. This document
is about the parts where the shape encodes a decision — not a field-by-field
listing, which `packages/db/prisma/schema.prisma` already is and keeps current.

---

## The organising idea: the database is the last line, not the only one

Application code enforces almost everything. The database enforces the things
application code cannot be trusted with — which means, specifically, the things
that must still hold when somebody writes a new route next year and forgets.

Three tools, used for three different jobs:

| Tool             | For                                                 |
| ---------------- | --------------------------------------------------- |
| Unique index     | "This happens once", under concurrency              |
| CHECK constraint | An arithmetic invariant over one row                |
| plpgsql trigger  | An invariant spanning rows, or an immutability rule |

ADR 0004 covers why plpgsql exists at all in a JavaScript-only stack, and why it
is confined to migrations.

---

## Tenancy

Everything an organiser owns hangs off `Organization`, and every query against
it is scoped by `organizationId`. `Membership` carries the `OrgRole`, and
capabilities are derived from the role **in that organisation** — never from a
global role, which is the NF-05 inversion this codebase has a standing
regression test for.

`Event → Organization` is the spine. `Order`, `Ticket`, `Refund`, `Payout`,
`Transfer` and every reconciliation item reach an organisation through it or
carry one directly, so "may this person see this row?" is always answerable
without a join the caller controls.

---

## Money

### Orders are a snapshot, not a calculation

`Order` stores the prices, taxes, fees and discounts **as they were at
checkout**. A ticket type whose price changes later does not retroactively
change what somebody paid. The pricing package computes; the order records.

### `Order.refundedCents + Order.refundPendingCents <= totalCents`

A CHECK (`order_refund_within_total`), with the per-line equivalent
(`order_item_refund_within_line`) and a trigger
(`desi_refund_within_order_total`). The two-column split is what makes the
constraint correct _during_ a refund, not only after it: an amount is reserved
into `refundPendingCents` before the provider is called and moved to
`refundedCents` on settlement.

### The ledger is append-only, and the database says so

`desi_ledger_batch_immutable` and `desi_ledger_entry_immutable` refuse an
`UPDATE` to a posted batch or any of its entries. `desi_ledger_batch_balance`
refuses a posted batch whose debits and credits disagree. `LedgerBatch` stores
both totals as columns so the check is a comparison at write time rather than an
aggregate.

Correction happens by adding a `CORRECTION` batch pointing at the original via
`compensatesBatchId`, never by editing. See `docs/FINANCIAL_LEDGER.md`.

### Idempotency is a unique index

`LedgerBatch.idempotencyKey`, `IdempotencyRecord.key`, `WebhookEvent`'s provider
identifier, `Dispute.providerDisputeId`, `Payout.providerPayoutId` — each unique.
"This posted once" is a constraint, not code remembering.

`Payout.providerPayoutId` is nullable **and** unique, which works because
PostgreSQL treats NULLs as distinct in a unique index (`NULLS DISTINCT`, the
default). Many scheduled payouts have no provider reference yet; no two paid
ones share one.

---

## Inventory and seating

### Two shapes, one primitive

General admission is a counter on `TicketType`. Reserved seating is a row per
seat in `EventSeat`. Both are taken by a **conditional `UPDATE` whose affected
row count decides the race** — the universal concurrency primitive in this
codebase. Nothing takes inventory by reading a count and then writing one.

### The map is frozen once published

A `VenueMapVersion` is editable until it is published and immutable after.
Seven triggers enforce it: `desi_map_version_frozen`, `desi_section_frozen`,
`desi_seat_row_frozen`, `desi_price_zone_frozen`,
`desi_seat_frozen_and_coherent`, `desi_map_version_publish_once` and
`desi_map_version_revision_forward`.

The reason is that a seat's identity is what a ticket refers to. Renumbering row
G after tickets are sold does not move anybody's seat; it changes what their
ticket claims. So a change to a published map is a new version, and an event
session is pinned to the version it was published against
(`desi_event_session_map_frozen`).

### Rows must agree with each other

`desi_event_seat_map_matches`, `desi_hold_item_session_matches`,
`desi_hold_item_line_matches`, `desi_order_item_event_matches` and
`desi_ticket_type_session_matches` each refuse a row whose foreign keys point at
things from different events or sessions. These are the mistakes a plausible-
looking service function makes, and each would be a seat sold for the wrong
event.

### `TicketHold` has one owner

`ticket_hold_single_owner`: exactly one of `userId` or a guest reference, never
both and never neither. A hold with ambiguous ownership is a hold whose
authorisation check has two answers.

---

## Tickets

`Ticket.status` transitions are enforced by `desi_ticket_status_transition` —
the table also written in `apps/api/src/lib/tickets.js`, in the database as
well because it must hold for code that does not exist yet.

`Ticket.credentialHash` holds a SHA-256 and never a credential.
`ticket_credential_version_positive` guards the rotation counter. A transfer
clears the old hash so the old pass matches nothing.

`CheckIn` is unique on `(ticketId, eventSessionId)`, with the partial index
`CheckIn_ticketId_no_night_key` for a row with no night, and
`desi_check_in_ticket_admissible` locks the ticket and refuses a row for a ticket
that is not admissible, on a night that is not its own, or a second row for a
ticket that admits once. Together those make "admitted once" — once each night,
for a ticket good for every night — true under two scanners racing rather than
merely under one steward retrying. See `docs/CHECK_IN.md` and "Admission per
night" below.

`CheckIn.deviceId` is a **foreign key to a registered `Device`**. The scanner's
own free-text identifier goes into the audit metadata instead; putting it in the
column was a guaranteed 500 at a door, found by the load suite.

### One live ticket per seat — 2026-09-29

Migration `20260928100000_live_seat_ticket_index` (ADR 0006).
`Ticket.eventSeatId` is no longer fully unique. The partial unique index
`Ticket_eventSeatId_live_key` covers `"eventSeatId"` only while
`"eventSeatId" IS NOT NULL AND "status" IN ('VALID', 'TRANSFER_PENDING',
'CHECKED_IN')`, and a plain `Ticket_eventSeatId_idx` serves the foreign key and
history lookups. A handed-on (`TRANSFERRED`) or `REFUNDED` row keeps its seat as
the record of who held it; `EventSeat.tickets` is therefore a list, of which at
most one is live. Prisma cannot express a partial index, so `schema.prisma`
carries a comment above `Ticket` pointing at the migration, and
`apps/api/tests/helpers/prisma-stub.js` enforces the same predicate for the
stub-based tests. The fresh-database verifier probes the index by name.

### The group pass — 2026-09-29

Migration `20260928110000_group_pass`.

| Column                        | Holds                                               | Constraint                                 |
| ----------------------------- | --------------------------------------------------- | ------------------------------------------ |
| `GroupPass.orderId`           | The order it covers; one pass per order             | unique; `ON DELETE CASCADE` from `Order`   |
| `GroupPass.credentialHash`    | SHA-256 of the QR content, never the content        | unique; `group_pass_digests_are_sha256`    |
| `GroupPass.codeHash`          | SHA-256 of the printed `DEG-` code, never the code  | unique; `group_pass_digests_are_sha256`    |
| `GroupPass.credentialVersion` | Bumped when the buyer replaces the pass             | `group_pass_version_positive`              |
| (both digests)                | Issued together or not at all                       | `group_pass_digests_together`              |
| `CheckIn.groupPassId`         | Which group pass admitted this ticket, when one did | foreign key, `ON DELETE SET NULL`; indexed |

The row has no holder column: the order's `userId` is the one source of truth
for whose pass it is. The row is created on the buyer's first request for it,
so checkout, the webhook and existing orders needed no backfill.

`desi_check_in_group_pass_matches` refuses a `CheckIn` that names a group pass
for a ticket on another order, or for a ticket whose owner is no longer the
order's buyer. The unique `CheckIn(ticketId, eventSessionId)` still makes each
admission happen once (once each night, for a ticket good for every night),
whether it came through a group or alone.

---

## Lifecycle and moderation

`Event.status` is a state machine (`EventStatus`) with
`desi_event_revision_forward` refusing a revision counter that goes backwards —
which is how a stale editor tab is stopped from overwriting a newer draft.
`EventModerationAction` records every review decision as its own row rather than
as a mutable column, so "who approved this, and when?" survives the next
approval.

`event_ends_after_start`, `event_session_ends_after_start`,
`event_session_sales_window_ordered` and `ticket_type_sales_window_ordered` are
the arithmetic that a form could get wrong and a database should not accept.

---

## Event authoring: tiers and the event page

Migration `20260928090000_event_authoring_content_and_tier_rules`. The rules
the organiser's editor and the authoring routes keep are in
`apps/api/src/lib/event-authoring.js`; these are the floor underneath them.

`TicketTypeVisibility` is `PUBLIC` or `HIDDEN`, and `TicketType.visibility`
defaults to `PUBLIC`. A `HIDDEN` tier is left out of every public read — the
event page, its lowest price and its structured data — and is meant to be
booked only by the organisation's own team. Every complimentary tier that
existed before the migration was made `HIDDEN`.

| Rule                                              | What it holds                                                                                                                                    |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ticket_type_per_order_bounds`                    | At least 1 and at most 50 per order, and the least never above the most (existing rows were clamped first)                                       |
| `ticket_type_complimentary_free_and_hidden`       | A complimentary tier costs 0 and is `HIDDEN`                                                                                                     |
| trigger `desi_ticket_type_description_length`     | A description of at most 500 characters, checked on insert and when the text changes, so a longer legacy row stays readable and sellable         |
| `TicketType_eventId_name_key`                     | Two tiers on one event do not share a name (hand-written in `20260916000000_event_draft_revision`; exact comparison)                             |
| `TicketType_reserved_session_zone_key`            | One reserved tier prices a zone at a session (a partial unique index `WHERE "reserved"`, so it lives in the migration)                           |
| trigger `desi_ticket_type_zone_matches_session`   | A tier's price zone is on the map version its session sells                                                                                      |
| trigger `desi_event_session_map_keeps_tier_zones` | A session does not move to another map version, or to general admission, while a tier on it prices a zone of the version it has                  |
| `event_session_capacity_positive`                 | A general-admission capacity, when set, is above zero                                                                                            |
| `event_faq_shape`, `event_performers_shape`, …    | The event page's lists are JSON arrays of at most 30 questions, 64 performers, 40 running-order entries and 30 sponsors; the links are an object |
| `event_content_text_lengths`                      | Dress code 500, directions 2,000, public email 254 and public phone 24 characters at most                                                        |

`Event` gained nine columns for the public page, every one nullable:
`performers`, `runningOrder`, `faq`, `sponsors`, `socialLinks` (JSON), and
`dressCode`, `directions`, `publicContactEmail`, `publicContactPhone` (text).
The public contact pair is the organiser's choice to publish and is distinct
from `Organization.contactEmail`, which stays private; on the wire it is
`publicEmail` and `publicPhone`. The migration filled `performers` from the old
`artists` list, names only and in billing order. The shape of each entry — a
performer's role and bio, https-only sponsor and social links, each social link
on its own network's domains — is validated by `@desi-event/schemas` before a
write; the database checks only the outer shape and the lengths.

The zone rule has two sides because either write can break it: a tier naming a
zone from another version, or a session moving versions under a tier. The tier
trigger reads the session row `FOR SHARE`, which conflicts with the lock an
update of the session takes, so the two writes run one after the other and the
second sees the first. Checkout never takes that lock.

Every one of these is refused by the API first, with a sentence rather than a
constraint name: a taken name or zone, a zone from another version, a priced or
public complimentary tier and a tier past a limit are all 422s, and a removal
something still depends on is a 409. The two unique indexes are also the net
under that check — a write racing past it is read as 409 `TIER_NAME_TAKEN` or
`TIER_ZONE_TAKEN`, never a 500. `apps/api/tests/event-authoring-live-integration.test.js`
drives those refusals through the real app on a freshly migrated database and
provokes both indexes directly; `pnpm db:verify:fresh` pushes against the zone
index beside the other partial indexes. The other checks and triggers are not
yet pushed against directly by a probe.

Removing a session deletes the ticket types priced for it (`onDelete: Cascade`)
once nothing depends on them, and the `event.session_removed` audit row names
them. A published or on-sale event keeps at least one session (409
`LAST_SESSION`); that rule is the API's, not the database's.

---

## Event pictures

Migration `20260928130000_event_media`. The pipeline around these tables is in
[MEDIA.md](MEDIA.md).

`MediaKind` is `EVENT_COVER` or `EVENT_GALLERY`; `MediaAsset.kind` was free
text and was converted in place, behind a guard that stops the migration on
any other value. `MediaAsset` gained `altText` (the organiser's description,
public), `position` (a gallery picture's place, 0–7), and the review stamp
`moderatedAt`, `moderatedById` and `moderationNote` (the reason a picture was
taken down: shown to its organiser as `rejectionReason`, never public).
`Event.coverImageUrl` is gone: an external address the organiser's browser
fetched is exactly what uploads replace, and the migration drops them rather
than fetching them. What it dropped is kept: before the column goes, it writes
one `AuditLog` row per event that had an address — action
`event.cover_address_dropped`, entity the event, no actor, metadata
`{ organizationId, coverImageUrl, migration }` — with the address's user name,
password, query string and fragment removed, since that is where a signed link
carries its secret. `pnpm db:verify:upgrade` checks these rows.

`MediaBlob` holds the bytes — `bytea`, stored `EXTERNAL` because the formats are
already compressed — one row per picture, keyed by `MediaAsset.storageKey`
with `ON DELETE CASCADE`. Deleting a picture or its event deletes the bytes.
The bytes are in their own table so that loading a picture's row never loads a
megabyte with it.

| Rule                                 | What it holds                                                                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `media_asset_event_media_shape`      | An event picture belongs to its event, has a 1–300 character description, is a JPEG, PNG or WebP of at most 8000 pixels a side and 10 MiB, with a SHA-256 checksum |
| `media_asset_position_by_kind`       | A cover has no position; a gallery picture has one from 0 to 7                                                                                                     |
| `media_asset_approved_is_servable`   | An approved picture was sanitised and passed the structural check                                                                                                  |
| `media_asset_rejection_has_note`     | A picture taken down says why                                                                                                                                      |
| `media_asset_decision_is_stamped`    | A decided picture says when                                                                                                                                        |
| `MediaAsset_one_cover_per_event_key` | One cover per event (a partial unique index, so it lives in the migration)                                                                                         |
| trigger `desi_media_gallery_cap`     | At most eight gallery pictures per event                                                                                                                           |
| `media_blob_size_matches`            | A blob's recorded size is its real size, between 1 byte and 10 MiB                                                                                                 |
| `media_blob_checksum_shape`          | A blob's checksum is SHA-256-shaped                                                                                                                                |

The gallery cap cannot be an index — a count is not a key — so the trigger
counts, after locking the event row `FOR NO KEY UPDATE` so that two parallel
uploads take turns and the second sees the first. That lock conflicts with
itself and with an authoring write's revision bump, and not with the
`FOR KEY SHARE` a checkout's foreign-key insert takes, so an upload never makes
a buyer wait. There is deliberately no unique index on `position`: a reorder
passes through a moment where two pictures share one.

`pnpm db:verify:fresh` pushes against every rule above on a fresh database —
the cover index beside the other partial indexes, the rest in
`packages/db/scripts/media-probes.mjs` — and
`apps/api/tests/event-media-integration.test.js` races ten parallel uploads
against the cap.

---

## Identity

`Session`, `Device`, `MfaFactor`, `AuthToken`, `LoginAttempt`. Sessions carry
their own expiry (`session_expires_after_creation`) and are rotated or revoked on
every privilege change. `AuthToken` rows are single-purpose
(`AuthTokenPurpose`), so a token minted for one thing cannot be spent on
another. `ScannerScope` narrows a membership to particular events — a steward at
one door is not an organisation-wide capability.

### Invitations and who created an organisation — 2026-09-29

Migration `20260928120000_team_delivery_and_organisation_provenance`.

- **`Invitation.deliveryMode`** (`InvitationDelivery`: `EMAIL`, `MANUAL`,
  nullable) records how each invitation's code went out (ADR 0008). Rows
  written before the column existed are null. The code itself is never stored;
  `Invitation.tokenHash` holds its SHA-256, as before.
- **`Invitation_one_pending_per_address`** is a partial unique index on
  `("organizationId", lower("email")) WHERE "status" = 'PENDING'`: at most one
  live invitation per address per organisation, whatever its case, so two
  issued at the same moment produce one invitation and one conflict. The
  migration first revoked older duplicate pending invitations, keeping the
  newest (ties broken by id).
- **`Organization.createdById`** names the account that created an
  organisation through `POST /v1/organizations`, with an index on
  `("createdById", "createdAt")` that serves the three-a-day limit.
  Nullable with `ON DELETE SET NULL`: seeded and platform-made organisations
  have none. It is never on the wire.

A role change of any kind ends sessions with the revocation reason
`role_changed` (NF-10), written to `Session.revokedReason` like every other
reason.

---

## Operations

`NotificationOutbox` is claimed under a lease (`notification_claim_has_lease`),
retried with a recorded time (`notification_retry_has_time`) and categorised on
failure (`notification_failure_category_known`). A worker that dies mid-send
leaves a lease that expires rather than a message nobody owns.

`ReconciliationTask` carries what this system believed at the time, the
provider's answer when one is obtained, and an **append-only** note array. See
`docs/RECONCILIATION_RUNBOOK.md`.

`AuditLog` is written inside the same transaction as the change it describes. An
audit row that can be committed separately from its change is an audit row that
can be missing for the one change somebody is asking about.

---

## Retention and deletion

What is kept, and for how long, follows from what each row is for:

| Data                         | Retention                                                     |
| ---------------------------- | ------------------------------------------------------------- |
| `LedgerEntry`, `LedgerBatch` | Indefinite. Financial records are not deletable by design     |
| `AuditLog`                   | Indefinite. Its value is that it cannot be pruned selectively |
| `Order`, `Refund`, `Payout`  | Indefinite; they are the counterpart to the ledger            |
| `Session`, `AuthToken`       | Expire and are deleted; nothing needs a spent token           |
| `LoginAttempt`               | Short-lived; it exists for rate limiting, not history         |
| `TicketHold`                 | Expires and is released                                       |
| `NotificationOutbox`         | Retained after send as delivery evidence                      |

### Erasure is NOT IMPLEMENTED — HISTORICAL STATUS, SUPERSEDED IN PART

The section below was written in Phase 2 and was accurate then. Phase 3 has
since built the foundation it describes as missing, and the honest correction is
narrower than "this is done":

- **Still true.** There is no redaction command and no scheduled retention job
  that deletes anything. Nothing in this repository has redacted a person.
- **No longer true.** There is a redaction data model — `PrivacyRequest`,
  `PrivacyHold`, `PrivacyAuditEvent`, `ExportArtifact`, `ExportArtifactSubject`
  and `RetentionSweep` — a `privacy:redact` capability, a `PRIVACY_ERASURE`
  step-up policy, and two read routes under
  `/v1/organizations/:id/privacy/requests`. See **Personal data** below.

> **Current-status update — 2026-09-17, after Phase 3's Phase 2 merged.** The two
> bullets above were written at the end of Phase 3's Phase 1. One of them has
> since become wrong and the other has become an undercount. Both are corrected
> here rather than edited in place.
>
> **"There is no redaction command" is no longer true.** The redaction engine
> exists and is tested against real PostgreSQL. What remains true, and is the
> part that matters, is narrower: **no scheduled retention job deletes anything**
> — nothing anywhere creates a `RetentionSweep` row, so the model is schema only
> — and **nothing in this repository has redacted a real person.** Every redaction
> this system has performed ran against disposable test data.
>
> **"Two read routes" is an undercount.** The privacy surface is **nine
> operations**, counted from `packages/api-contract/src/route-manifest.js`:
>
> | Method | Path                                                | Kind            |
> | ------ | --------------------------------------------------- | --------------- |
> | GET    | `/v1/organizations/:id/privacy/requests`            | read            |
> | GET    | `/v1/organizations/:id/privacy/requests/:requestId` | read            |
> | GET    | `…/requests/:requestId/events`                      | read (audit)    |
> | GET    | `/v1/organizations/:id/privacy/holds`               | read            |
> | POST   | `/v1/organizations/:id/privacy/requests`            | command (raise) |
> | POST   | `…/requests/:requestId/confirm`                     | command         |
> | POST   | `…/requests/:requestId/cancel`                      | command         |
> | POST   | `/v1/organizations/:id/privacy/holds`               | command (hold)  |
> | POST   | `…/holds/:holdId/release`                           | command (hold)  |
>
> Four reads and five commands. The two original read routes are the first two
> rows; the command and hold operations came with Phase 3's Phase 2.

> **Update — 2026-09-21, after Phase 3's Phase 3 remainder.** Two sentences in
> the block above have gone out of date, and they are corrected here rather than
> rewritten, because the block is the record of what was observed on 2026-09-17.
>
> **"Nothing anywhere creates a `RetentionSweep` row, so the model is schema
> only" is no longer true.** `apps/worker/src/processors/sweep-retention.js`
> writes one row per evaluated class on every rehearsal, and writes a
> `SKIPPED_DISABLED` row when enforcement is not activated, which is the
> expected state everywhere today. What remains true is the sentence beside it,
> and it is the one that matters: **no scheduled retention job deletes
> anything.** The retention machinery has no deletion path, the sweep issues
> `count` queries and nothing else (the one deletion on a timer in the
> repository is the traffic roll-up's, of raw `TrafficEvent` rows it has
> already added up — see "Visit counting" — which is not retention), and
> `retention_sweep_dry_run_changes_nothing` refuses to record a rehearsal that
> claims otherwise.
>
> **"Nine operations" is now ten.** `GET /v1/organizations/:id/privacy/exports`
> joined the privacy tag with the export register. Five reads and five commands,
> counted the same way from `packages/api-contract/src/route-manifest.js`.
>
> **Every one of the ten remains constrained** exactly as the block says. The
> export register read requires `privacy:redact` like the others and adds no
> command.
>
> **Every one of the nine remains constrained** by the controls that were already
> in place. All nine — the reads included — require `privacy:redact`, which is
> granted to `OWNER` and to nobody else; `apps/api/src/routes/privacy.js` explains
> why reading who has asked to be erased needs the same authority as erasing them.
> The five commands additionally require a fresh `PRIVACY_ERASURE` step-up, which
> the four reads do not (`packages/api-contract/src/routes.js`). Organization
> scoping applies throughout, holds can refuse an execution, and both `AuditLog`
> and `PrivacyAuditEvent` are immutable at the database. Adding operations did not
> widen who may use them.

The Phase 2 text, unchanged:

> Stated plainly rather than implied by a policy paragraph. **There is no user
> erasure or redaction route, no redaction command and no scheduled retention
> job.** The table above describes what each row is _for_ and the retention its
> purpose implies; it does not describe an enforcement mechanism, because there
> is not one yet. Rows that "expire" are expired by the code that reads them
> (a spent session is refused, a lapsed hold is released) rather than deleted by
> a sweeper.
>
> The design constraint erasure will have to satisfy is already fixed by the
> schema: removing a `User` row would remove the counterparty from financial
> records that must keep balancing, so erasure will have to be redaction of
> personal fields with the row, its identifiers and every ledger reference
> surviving. That is the shape of the work, not a description of code that
> exists.

That last paragraph turned out to be exactly right, and it is what the Phase 3
design implements.

---

## Personal data

Six models, and one rule they all serve: **a person is redacted, never deleted.**
Removing a `User` row would remove the counterparty from financial records that
must keep balancing, and the database refuses it twice over — once through the
posted-ledger triggers and, since Phase 3, once through `desi_audit_log_immutable`,
because the actor foreign key's `ON DELETE SET NULL` is an `UPDATE` of audit rows
that no longer happens.

| Model                   | What it is                                                               |
| ----------------------- | ------------------------------------------------------------------------ |
| `PrivacyRequest`        | One request to redact one person inside one organisation                 |
| `PrivacyHold`           | A legal or fraud matter that keeps a subject's data in place             |
| `PrivacyAuditEvent`     | Append-only evidence of every privacy decision, PII-free by construction |
| `ExportArtifact`        | A generated export, and whether its bytes still exist                    |
| `ExportArtifactSubject` | Which people an export is known to contain                               |
| `RetentionSweep`        | One run of the retention sweeper, including one that refused to run      |

### The engine that fills these models — Phase 2, 2026-09-17

The six models above described a shape. Since Phase 2 there is code that uses it,
in `apps/api/src/lib/privacy-{placeholders,holds,redaction,requests}.js`, and the
schema needed no change to carry it — no Phase 2 migration exists.

The placeholder is `sha256(field + "\0" + rowId)` truncated to twelve hex
characters. Derived from the row's own primary key, never from the value it
replaces, and taking no secret and no clock: a re-run after a crash produces
byte-identical rows, and `User.email`'s unique index is satisfied by construction
rather than by checking afterwards.

Columns replaced: `User.email`, `User.displayName`, `User.phone` (nulled),
`Order.buyerEmail`, `Order.buyerName`, `Ticket.attendeeName`,
`TicketTransfer.toEmail` on settled transfers, `WaitlistEntry.email`,
`NotificationOutbox.recipient` and the personal keys of its payload on settled
rows, and `Organization.contactEmail` / `Event.contactEmail` only where the
stored address is the subject's own.

Columns never touched: every amount, every status, every timestamp that is not a
privacy timestamp, every ledger row, every credential digest, every foreign key.

One correction to the record while this was built:
**`NotificationOutbox.organizationId` had never been written by any writer** since
the column was added in the Phase 2 commerce migration. All three call sites
omitted it, so every outbox row carried a null organisation and an
organisation-scoped scrub matched nothing. The writers now stamp it; rows written
before that change still carry null and are unreachable without a backfill.

### Redaction is irreversible, and nothing stores a way back

No original value, backup column, encrypted copy, reversal table or recoverable
mapping is kept anywhere in this schema. The absence is the design. It is also
why `pseudonymize` — which exists, and is keyed — is **not** the placeholder
mechanism: a keyed digest is reversible by whoever holds the key, and a
redaction that a key undoes is not a redaction.

### One in flight at a time

`PrivacyRequest_one_in_flight_per_subject_key` is a partial unique index over
`(organizationId, subjectUserId)` where the state is `REQUESTED`, `QUEUED` or
`PROCESSING`. Two operators confirming the same screen would otherwise start two
redactions of one person, and the second would find placeholders where it
expected values. Partial, because a terminal request must not block the next
one: a subject whose redaction was `HELD` may be redacted once the hold lifts.

### Nothing executes without a hold decision

`privacy_request_executes_only_when_clear` refuses a request in `QUEUED`,
`PROCESSING` or `COMPLETED` unless its `holdDecision` is `NONE_ACTIVE`. It is
the floor under the whole workstream: a request that reached execution while its
decision still read `NOT_EVALUATED` would be a redaction performed without
asking whether it was allowed.

`desi_privacy_request_state_transition` carries the rest — the state machine only
moves forward, a terminal request is finished, and the identity columns
(organisation, subject, idempotency key, correlation id, policy version,
confirmation hash) cannot be rewritten after the row exists.

### Privacy evidence is append-only, and the database says so

`desi_privacy_audit_event_immutable` refuses every `UPDATE` and `DELETE`
unconditionally. The ledger's equivalent is conditional because a batch is
assembled before it is posted; an audit event is final the instant it is
written, so there is no earlier state to allow.

Its references — `actorId`, `organizationId`, `privacyRequestId`, `targetId` —
are bare strings rather than foreign keys, exactly as `AuditLog.entityId` already
is. Evidence must not be deleted by a cascade from the thing it describes.

### A dry run cannot claim to have changed something

`retention_sweep_dry_run_changes_nothing` refuses a `DRY_RUN` row with a non-zero
`affectedCount`. `DRY_RUN` is the intended posture, because every duration the
sweeper would apply is a proposal awaiting legal review rather than settled
policy — see `docs/PRIVACY_AND_RETENTION.md`.

> **Correction — 2026-09-17.** This paragraph said `DRY_RUN` "is the default
> posture", which reads as a column default and is not one. `RetentionSweep.mode`
> carries **no** `@default` in `schema.prisma` and no `DEFAULT` in the migration —
> `state` does, `mode` does not — so a row would have to name its mode explicitly.
> The point stands in the only sense that matters today: **nothing creates a
> `RetentionSweep` row at all.** The single `retentionSweep.create` in the tree is
> a negative probe in `packages/db/scripts/verify-fresh-database.mjs` that expects
> rejection and rolls back. The constraint above is real and enforced; it
> constrains rows that nothing yet inserts.

> **Update — 2026-09-21.** The last sentence of the block above is no longer
> true. `apps/worker/src/processors/sweep-retention.js` inserts one row per
> evaluated class, naming `mode: 'DRY_RUN'` explicitly — which is exactly what
> the correction above says a writer would have to do, because the column has no
> default. So the constraint now constrains rows that something does insert, and
> `apps/worker/tests/retention-postgres.test.js` checks it against real
> PostgreSQL rather than only against the negative probe.
>
> The point the original block was making survives intact: `DRY_RUN` is not a
> column default, a writer must say what it is doing, and the database refuses a
> rehearsal that claims to have changed something.

---

## What the browser sees of any of this

Nothing. Responses are built by allow-list presenters, the response schema
strips unknown keys, and the generated route manifest carries a path, a method
and two booleans. A field name in this document is a server contract, and
`scripts/scan-browser-bundle.mjs` asserts that the shipped bundle does not
contain the ones the browser has no need for.

## `ConnectedAccount`, as first populated — 2026-09-22

Until 2026-09-22 this table held no rows in any environment. The simulated
payout-setup surface writes the first ones, and what it writes is constrained
more tightly than the schema is:

- `organizationId` is `@unique`, so there is one row per organisation and two
  concurrent first-starts collapse at the database rather than in application
  logic. `apps/api/tests/helpers/prisma-stub.js` now models this; before this
  change it did not, so a unit test asserting the collapse would have passed
  against a stub that stored two rows.
- `providerMode` is written `'mock'` **explicitly**, never left to the column
  default. The default is `"test"`, which reads as a real provider's test
  mode — an account that exists somewhere with a dashboard behind it — so a
  writer that merely omitted the field would produce exactly the row this
  surface must never produce.
- `provider` is `'in-memory-payments'`, matching the convention `Payment.provider`
  already uses, which also keeps the simulated row out of a real provider's
  `@@unique([provider, providerAccountId])` namespace.
- `providerAccountId` is `mockacct_` followed by a digest of the organisation
  id. Derived rather than random so that a replayed create computes the same
  value and a `P2002` is unambiguously "this organisation already has one", and
  prefixed so it cannot be mistaken for a Stripe account id.
- `defaultCurrency` is **NULL**, and that is load-bearing rather than lazy — see
  `docs/PAYMENTS.md`.
- `chargesEnabled` and `payoutsEnabled` are derived from `onboardingStatus` on
  every write, never set independently. `COMPLETE` implies both; every other
  state implies neither.
- `requirementsDue` holds a count's worth of placeholder and never a real
  requirement string, because a list of outstanding requirements is a list of
  things a real provider would want to know about a real person.

`onboardingStatus` uses the existing `ConnectOnboardingStatus` enum unchanged. A
parallel `MOCK_*` vocabulary was considered and rejected: it would need a
migration to store and a mapping back to the real one to read, which is two
vocabularies for one column.

### `desi_payout_currency_matches`, repaired

The trigger installed by `20260916130000_commerce_services` read a column called
`"payoutCurrency"` from `"ConnectedAccount"`. No such column exists — the
account's currency is `"defaultCurrency"` — and plpgsql plans a function body at
execution rather than at creation, so the migration applied cleanly and the
mistake waited in the schema until a payout fired it.

The effect was worse than a guard that failed open. The bad `SELECT` sits after
the early return for a payout with no connected account, so a payout without one
was accepted having skipped the lookup, and a payout naming **any** connected
account was refused outright with SQLSTATE 42703 whatever its currency. The
comparison the trigger exists to make had never run once.
`20260921090000_payout_currency_trigger_repair` corrects the column name and
changes nothing else. No backfill is needed, because no row naming a connected
account could ever have been written while the broken body was installed.

## Nights, guests' names and promo codes at checkout — 2026-09-29

Migration `20260929090000_checkout_promos_attendees_nights`.

**`EventSession.label`** is the organiser's short name for a night ("Night 2"),
optional, 1 to 60 characters after trimming (`event_session_label_length`).
Every surface shows it beside the night's own date. Since
`20260929100000_check_in_per_night` the door admits by night (below).

**Guests' names are staged, not stored twice.** A name typed at checkout is
personal data about somebody who may have no account. Until settlement issues
the tickets it waits on the line that will become them:

| Column                    | Holds                                                      | Constraint                                                                   |
| ------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `OrderItem.attendeeNames` | Names for a general-admission line, at most one per ticket | `order_item_attendee_names_within_quantity`: `cardinality <= quantity`       |
| `HoldItem.attendeeName`   | The name for one held seat                                 | `hold_item_attendee_name_seated`: only on a seated item, 1 to 100 characters |

Settlement copies each name onto its `Ticket.attendeeName` and clears the
staging in the same transaction. Compensation (a declined payment) clears it
too, and so does a buyer-identity redaction of an order still waiting to be
paid. Nothing reads the staging back to a client: the names are on the tickets.

**`PromoCode` is now constrained by the database**, with backfills that keep
each existing row's meaning:

| Constraint                              | Rule                                                                         |
| --------------------------------------- | ---------------------------------------------------------------------------- |
| `promo_code_value_in_range`             | `value >= 0`; a percentage (basis points) at most 10000                      |
| `promo_code_percentage_has_no_currency` | A percentage code has no currency                                            |
| `promo_code_redemptions_within_cap`     | `redemptionCount >= 0`, and when capped, `1 <= maxRedemptions` and within it |
| `promo_code_window_ordered`             | `endsAt` after `startsAt` when both are set                                  |

The cap CHECK is the backstop behind the row lock checkout takes on the code
(see `docs/PAYMENTS.md`). The code's text has no shape CHECK: the request
schemas upper-case and validate every write and every lookup instead, because an
upper-casing backfill could have collided with `@@unique([organizationId, code])`.
`PromoCode_organizationId_createdAt_idx` serves the organiser's list.

**One reserved tier per zone per night** is the partial unique index
`TicketType_reserved_session_zone_key` on `("eventSessionId", "priceZoneId")
WHERE "reserved"`, created by `20260928090000_event_authoring_content_and_tier_rules`
and relied on, not recreated, here. It is what makes "which tier sells this
seat" a question with one answer: a seat is sold under the reserved tier that
prices its zone at that night.

---

## Admission per night — 2026-09-30

Migration `20260929100000_check_in_per_night`.

On an event of more than one night, a ticket for one night — its seat's, else
its tier's — admits once, on that night; a ticket whose tier names no night is
good for every night and admits once on each. Three changes make that true in
the database rather than only in the door's code:

- **`CheckIn` is unique on `(ticketId, eventSessionId)`**, replacing the unique
  `ticketId`. Nulls are distinct in a unique index, so the partial index
  `CheckIn_ticketId_no_night_key` (`ticketId` where `eventSessionId` is null)
  keeps a ticket to one admission recorded with no night. Prisma's schema
  cannot express the partial index; `Ticket.checkIn` became `Ticket.checkIns`.
- **`desi_check_in_ticket_admissible`** locks the ticket row first, so two
  admissions of one ticket take turns, and then refuses: a ticket that does not
  admit (as before); a night that is not one of the ticket's event's; a night
  other than a single-night ticket's own; an every-night admission that names
  no night; and a second admission, on any other key, of a ticket that admits
  once. The same night twice is left to the unique index.
- **`desi_ticket_status_transition`** also refuses `TRANSFER_PENDING` and
  `TRANSFERRED` for a ticket with any admission. A ticket good for every night
  stays `VALID` between nights, so its status alone would not stop a successor
  being issued and let in again on a night it already was.

Rows written before the migration are brought under the new rules by the
migration itself. Each ticket had at most one admission, which satisfies both
indexes; but that admission named no night, and a ticket good for every night
had become `CHECKED_IN` at it, so left alone the trigger would refuse it on
every later night. So, on each event of more than one night (an event of one
night needs no nights and is left alone):

- each admission with no night is given one — the ticket's own night (its
  seat's, else its tier's) when it has one; otherwise the night whose window
  (doors, or the start, to the end) holds the moment it was scanned; otherwise
  the night nearest that moment;
- a ticket good for every night that is `CHECKED_IN`, was let in, and has a
  night it was not let in on is `VALID` again with no `checkedInAt`, as the new
  rules would have left it (the status trigger, which refuses that move, is
  switched off for that one statement);
- each ticket touched gets an `AuditLog` row with no actor — action
  `ticket.admission_night_backfilled`, metadata `{ checkInId, eventId,
eventSessionId, chosenBy, scannedAt, restoredToValid, previousCheckedInAt,
migration }`.

`pnpm db:verify:upgrade` seeds such admissions (a pass scanned in a night's
window, one scanned between nights, a one-night ticket scanned in another
night's window, a refunded pass and a one-night event) and checks each result,
the audit rows, and that the pass is then let in on its next night and not
twice on the first.

## Invite-only posting, the website link, visit counting, full control and imports — 2026-10-06

Seven migrations, in order (`PHASE3_MIGRATIONS` in
`packages/db/scripts/verify-populated-upgrade.mjs` lists them after the earlier
ones, and the upgrade verifier proves each against a populated database). The
decisions behind them are ADRs 0010–0015.

| Migration                                              | What it adds                                                                                                             |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `20260930090000_platform_admin_role`                   | `UserRole` value `ADMIN`, alone (an enum value cannot be used in the transaction that adds it)                           |
| `20260930100000_organiser_invitations_and_review_gate` | `OrganizerInvitation`, `Membership.organizerInvitationId`, the review-gate trigger                                       |
| `20260930120000_event_website_link`                    | The website link columns on `Event`, its CHECKs and trigger; `socialLinks.website` folded in                             |
| `20260930130000_event_traffic_analytics`               | `TrafficEvent`, `TrafficDaily`, `TrafficSalt`, `TrafficRollupState` and their enums                                      |
| `20260930140000_event_deleted_status`                  | `EventStatus` value `DELETED`, alone                                                                                     |
| `20260930150000_event_full_control`                    | Deletion columns, `EventPlatformEdit`, `EventChangeNotice`, cancelled nights, replacement covers                         |
| `20260930160000_event_imports`                         | `EventImportRun`, `EventImportItem`, `EventImportImage`, `Organization.platformHeldSource`, `EventSession.endTimeListed` |

### Organiser invitations

`OrganizerInvitation` has one kind: start a new organisation as its OWNER. It
holds the address (lower case, CHECK), the organisation's name (2–120), the
administrator-written public description (1–2000) and website (the event
website's address pattern), a private note (1–1000), the SHA-256 digest of the
code (`organizer_invitation_token_is_digest`; never the code), who invited,
`status` (PENDING, ACCEPTED, REVOKED, EXPIRED), `deliveryMode`, `expiresAt`
(after `createdAt`), acceptance and withdrawal stamps (each required by its
status), `organizationId` (only once ACCEPTED), and `supersedesId` (unique) for
a reissue. A partial unique index allows one PENDING invitation per address.
`Membership.organizerInvitationId` (unique) records which invitation made an
owner. Team invitations still waiting that offered a posting role were
withdrawn by the migration, and CHECK
`invitation_pending_role_is_owner_grantable` keeps new ones to roles an owner
may grant.

### The review gate

Trigger `desi_event_status_requires_review` (`BEFORE UPDATE OF "status"`):
APPROVED only from REVIEW_PENDING; a public status only from APPROVED, another
public status, or a restore to the restore target of the status the event had
when it was deleted. An INSERT is not covered (only seeds and the e2e helpers
insert events in a public status; the API creates DRAFTs and the importer
creates DRAFTs too).

### The website link

`Event.websiteUrl` (the organiser's address, normalised; CHECK
`event_website_url_shape`), `websiteRedirectEnabled`, `websiteDecidedUrl` (where
the link goes while it is on), `websiteDecisionPending`, `websiteSubmittedAt`,
`websiteRedirectChangedAt`, `websiteRedirectChangedById` (FK, SET NULL) and
`websiteRedirectReason` (1–500). CHECK `event_website_redirect_consistency`
keeps them coherent; trigger `desi_event_website_change` recomputes "pending"
on every write of `websiteUrl`, so an organiser's change never moves the
switch. `socialLinks` may no longer carry `website` (`event_social_links_shape`).
Partial indexes serve the administrators' worklist (`Event_website_pending_idx`)
and the "on" list.

### Visit counting

- **`TrafficEvent`** — one raw visit: event, UTC day, kind (`PAGE_VIEW`,
  `CARD_CLICK`, `TICKET_CLICK`, `SEAT_CLICK`, `WEBSITE_REDIRECT`), placement,
  source (page views only), a 32-hex visitor code or none (privacy signal), and
  a 64-hex dedupe key present exactly when the code is (unique). **No address,
  browser string or account.** Deleted by the roll-up two days after its day.
- **`TrafficSalt`** — the day's random secret the visitor code is made with (64
  hex); deleted once the day is over.
- **`TrafficDaily`** — the totals per event per UTC day: views and visitors,
  views without a code, the five sources, card clicks by place, ticket and seat
  clicks and their visitors, website visits and their visitors,
  `demonstration` (true only for rows the development seed writes) and
  `computedAt`. CHECKs: nothing negative; sources add up to views; places add up
  to card clicks; visitors plus uncoded views within views; click and redirect
  visitors within their clicks. Cascades with its event.
- **`TrafficRollupState`** — one row (`traffic-rollup`, inserted by the
  migration): the roll-up's lease and `lastCompletedAt`, which the screens show
  as "these figures run to".

### Deleted events

`EventStatus` gains `DELETED`. `Event` gains `deletedAt`, `deletedById` (FK,
SET NULL), `deletionReason` (10–500), `deletionOutcome` (REMOVED,
CANCELLED_AND_REFUNDED, REMOVED_AFTER_EVENT), `deletionAuthority`
(ORGANIZATION, PLATFORM), `statusBeforeDeletion` and `deletedSlug` (the slug of
a never-public event, released). CHECK `event_deletion_consistency` sets them
all with DELETED and clears them all otherwise, and allows
CANCELLED_AND_REFUNDED only from CANCELLED. Trigger `desi_event_deletion_moves`
makes `statusBeforeDeletion` the status the row really had, freezes it while
DELETED, and lets the row leave DELETED only for
`desi_event_restore_target(statusBeforeDeletion)`. Partial index
`Event_deleted_idx` serves the deleted list. Only
`apps/api/src/lib/event-deletion.js` writes these columns (a source scan); the
development seed inserts one deleted event and leaves an existing deleted row
untouched on a re-seed.

### Platform editing, change notices, cancelled nights and replacement covers

- **`EventPlatformEdit`** — one editing sitting: event, administrator, the
  browser session it answers (FK, SET NULL), reason, `openedAt`, `expiresAt`,
  and how it ended (`PlatformEditEnd`: CLOSED, SUPERSEDED, EVENT_DELETED,
  EXPIRED). One open sitting per administrator per event (a partial unique
  index); CHECK `event_platform_edit_shape`.
- **`EventChangeNotice`** — what ticket holders are shown on their order page:
  the kind (`EventChangeKind`: MATERIAL_CHANGE, SESSION_CHANGE, RESCHEDULED,
  POSTPONED, CANCELLED, SESSION_CANCELLED, DELETED), the reason and whether the
  Desi-Event team made it. Only `lib/event-change-notices.js` writes it.
- **`EventSession.cancelledAt`** and **`cancellationReason`** — a cancelled
  night (CHECK `event_session_cancellation_stamped`); trigger
  `desi_event_session_cancel_is_final` refuses bringing one back.
- **`MediaAsset.replacesMediaId`** (unique, FK SET NULL) — a replacement cover
  waiting for approval names the cover it replaces; CHECK
  `media_asset_replacement_shape` and trigger `desi_media_replacement_matches`
  keep it a cover of the same event, and the one-cover index now counts only
  current covers.

### Imports

- **`Organization.platformHeldSource`** (unique; `SULEKHA`) marks the
  organisation that holds imported events. Trigger
  `desi_platform_held_has_no_members` refuses memberships and team invitations
  into it.
- **`EventImportRun`** — one upload: who planned it, the plan and its digest,
  status, and who applied it, within its hour.
- **`EventImportItem`** — one imported listing, unique by `(source, sourceId)`
  and by event: the listed prices and price text, the curator's notes, the
  listing and ticket addresses, who imported and who approved it, the run that
  last wrote it, and a reassignment (from, to, by whom).
- **`EventImportImage`** — one picture to copy (unique by item and address):
  its role, status, failure reason and the `MediaAsset` it became.
- **`EventSession.endTimeListed`** — false when the listing gave no end time
  and the stored end is the start plus three hours, which is never shown.

Only `lib/event-import.js` writes the three import tables (a source scan).
