# The data model

49 models, 36 enums, 20 plpgsql triggers and 34 CHECK constraints. This document
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

`CheckIn.ticketId` is unique, and `desi_check_in_ticket_admissible` refuses a row
for a ticket that is not admissible. Together those make "admitted once" true
under two scanners racing rather than merely under one steward retrying. See
`docs/CHECK_IN.md`.

`CheckIn.deviceId` is a **foreign key to a registered `Device`**. The scanner's
own free-text identifier goes into the audit metadata instead; putting it in the
column was a guaranteed 500 at a door, found by the load suite.

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

## Identity

`Session`, `Device`, `MfaFactor`, `AuthToken`, `LoginAttempt`. Sessions carry
their own expiry (`session_expires_after_creation`) and are rotated or revoked on
every privilege change. `AuthToken` rows are single-purpose
(`AuthTokenPurpose`), so a token minted for one thing cannot be spent on
another. `ScannerScope` narrows a membership to particular events — a steward at
one door is not an organisation-wide capability.

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

### Erasure is NOT IMPLEMENTED

Stated plainly rather than implied by a policy paragraph. **There is no user
erasure or redaction route, no redaction command and no scheduled retention
job.** The table above describes what each row is _for_ and the retention its
purpose implies; it does not describe an enforcement mechanism, because there
is not one yet. Rows that "expire" are expired by the code that reads them
(a spent session is refused, a lapsed hold is released) rather than deleted by
a sweeper.

The design constraint erasure will have to satisfy is already fixed by the
schema: removing a `User` row would remove the counterparty from financial
records that must keep balancing, so erasure will have to be redaction of
personal fields with the row, its identifiers and every ledger reference
surviving. That is the shape of the work, not a description of code that
exists.

---

## What the browser sees of any of this

Nothing. Responses are built by allow-list presenters, the response schema
strips unknown keys, and the generated route manifest carries a path, a method
and two booleans. A field name in this document is a server contract, and
`scripts/scan-browser-bundle.mjs` asserts that the shipped bundle does not
contain the ones the browser has no need for.
