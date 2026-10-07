# ADR 0014 — Full control of posted events

- **Status:** Accepted
- **Date:** 2026-10-06
- **Supersedes:** in part, ADR 0009's rule that a published event takes no new
  picture (its "Consequences" now point here); the first plan's list of what a
  live event may change (SPEC2 P-19), which ADR 0010 §6 restates in its new
  form.
- **Related:** ADR 0010 (the review gate), ADR 0009 (pictures),
  `docs/REFUNDS_DISPUTES.md` ("Deleting events and cancelling nights"),
  `docs/MEDIA.md`, `docs/SECURITY.md` ("Platform editing" and "Deletion");
  the binding addendum SPEC2-XI §1.1, §1.2 and §5.X.

## Context

The owner's second request (B):

> "also the organizer, admin, superadmin should be able to edit or update or
> delete the event which has been posted, it should be fully flexible."

Before this, a published event could be edited within limits (a sold tier kept
its price, a published event took no new picture), only a super administrator
could touch another organisation's event, and nothing could delete a posted
event at all. The refund code that deleting would drive had nine defects of its
own (below), which had to be fixed first.

## Decision

### 1. No second review (X-2)

Edits to a published, on-sale, paused, sold-out or postponed event are public
when they save, as the owner chose. Review still decides whether an event may be
posted at all, once, before its first publication (ADR 0010). Mitigations for
"approved, then changed into something else": every write is audited with its
fields; the Desi-Event team's list of every event sorts by "recently changed";
and administrators can edit or delete any posted event. The full statement is
`live-changes-not-reviewed`, quoted in ADR 0010 §6.

What changed, so that "fully flexible" is true within what sold tickets
require: a sold tier may be re-priced (buyers keep what they paid); nights can
be added, moved, re-mapped while unsold, removed if unused, or cancelled one at a
time with their tickets refunded; a finished or cancelled event keeps its words
and pictures editable. The venue cannot change while a night uses a seating map
(409 `VENUE_HAS_SEATING`).

### 2. Pictures on posted events wait for somebody else's approval (X-3)

A new gallery picture or a replacement cover on a posted event is stored
PENDING and is public only after somebody on the Desi-Event team **other than
its uploader** approves it (403 `SELF_REVIEW` for the uploader). A replacement
cover leaves the old one on the page until it is approved; approval swaps them
in one locked transaction. Reviewers find them at `/moderation/pictures`
(`moderation.mediaQueue`). Pictures are the one kind of content the site already
reviews item by item, and approving them holds nothing else up. This can be
made immediate in one line if the owner prefers.

### 3. Administrators edit in a sitting (X-7) and lifecycle moves follow Rule L

- ADMIN and SUPER_ADMIN (`event:platform_edit`) edit another organisation's
  event only once it is posted, and only inside an **editing sitting**: opened
  with a reason (10–500 characters, shown to the organiser without the
  administrator's name) and a MODERATION step-up; bound to the browser session
  that opened it; lasting at most 60 minutes; and asking for the second factor
  again every ten minutes of writes. The in-transaction re-check reads the
  sitting `FOR SHARE`, and every write is audited with the sitting and the
  reason. Membership is read first, so a SUPER_ADMIN who is also a member edits
  as a member and never silently through `ALL_CAPABILITIES`.
- **Rule L.** Publishing, sales, postponing, cancelling the whole event and
  rescheduling stay the organiser's (403 `ORGANIZER_ONLY` for an ADMIN). A
  non-member SUPER_ADMIN keeps those moves without a sitting, as before; each is
  audited `authority: 'PLATFORM'` and shown as "by the Desi-Event team". The
  imported-event publish is the one platform publish by an ADMIN (ADR 0015).

### 4. Deleting is a status, `DELETED` (X-8)

Not a hard delete, which would destroy orders, refunds and the ledger's
history, and not a flag column, which every status query would have to
remember. A DELETED event leaves every public surface (page, listings, search,
sitemap, pictures, checkout, the door) and is kept with its orders, tickets,
refunds, history and pictures. Seven deletion columns record when, by whom,
why, the outcome, the authority, the status it had and a released slug; CHECK
`event_deletion_consistency` keeps them together, and only
`lib/event-deletion.js` writes them (a source scan). Trigger
`desi_event_deletion_moves` makes the recorded prior status the real one and
lets the row leave DELETED only for its restore target.

### 5. What deleting does depends on what was sold (X-9, X-10)

The outcome is decided on the server, previewed first, and must be named back
by the request:

- **REMOVE** — nobody holds a paid order: the event leaves the site, its holds
  and unpaid orders end.
- **CANCEL_AND_REFUND** — paid orders for an event that has not taken place
  (or was postponed or cancelled): the event is cancelled with its notices,
  every paid order whose payment is not disputed gets a reserved whole-remainder
  refund (fee and tax included), its tickets are withdrawn, then it is deleted.
  Disputed orders are left to finance.
- **REMOVE_AFTER_EVENT** — it has taken place: only the page comes down;
  orders and tickets stay. If nobody was checked in through Desi-Event, the
  person deleting confirms it took place.

Who may: an organisation member holding `event:delete_unsold` (EVENT_MANAGER
and up) for an unsold event; `event:delete` and `event:cancel` (organisation
administrators and owners) for a sold one; ADMIN and SUPER_ADMIN
(`event:platform_delete`) for any — including ADMINs deleting sold events,
which refunds every order in full. Refused while a payment is in flight, while
the event is in progress, and for a deleted event. The typed slug is checked on
the server; the lock order is Event, tiers, sessions.

**Refunds are sent after the commit, in batches by payment mode**
(`REFUND_DRIVER_BATCH`: 500 a request with simulated payments, 25 with a
provider). Any left over are sent by `events.finishRefunds` ("Finish refunds"),
or by the organisation's finance team. Cancelling one night uses the same
driver; a ticket valid for every night is not refunded in part.

### 6. Slugs (X-11) and restore (X-12)

An event that was ever public keeps its slug, retired: its URL answers 404 and
nobody can take it, so a shared link never shows a different event. One never
public has its slug released. **Only the platform restores**
(`event:platform_delete`, EVENT_PUBLISH step-up, a reason): an event under
review or approved comes back as a DRAFT, one on sale or sold out comes back
**paused** so the organiser decides when to sell again, and one deleted with
its refunds stays CANCELLED. One SQL function, `desi_event_restore_target`,
holds the rule for both triggers.

### 7. The refund repair came first (R1–R9)

Nine existing defects were fixed before any of the above, each proven on real
PostgreSQL with orders priced with the booking fee, tax and a promo code
(`docs/REFUNDS_DISPUTES.md`, "Fees, tax and retries — 2026-09-30"): a full
amount refund of any USD order failed to settle (R1); a discounted full refund
left tickets valid (R2); a sub-ticket partial refund withdrew a ticket (R3); a
retry after a failure broke the refund counter (R4); cancellation refunds could
never complete (R5, with legacy rows repaired on first touch); a lines refund
returned face value only (R6); a payment confirmed after its order closed was
recorded silently (R7, now a reconciliation task); a refund could be sent on a
disputed payment (R8, now 409 `PAYMENT_DISPUTED`); and the submit steps lived
only in a route (R9, now `submitRefund`).

## Consequences

- **Deleted events are kept, not erased.** Reasons people type are kept as
  written and are not rewritten by the privacy process; the forms say so. The
  limitations page lists `deleted-events-kept`.
- **Refunds may finish in more than one pass** for a large event
  (`event-refunds-batch`).
- **Every-night tickets keep their place** when one night is cancelled
  (`night-cancellation-passes`).
- **Change notices are recorded, not emailed**, for date, place and terms
  changes, night cancellations, postponements, cancellations and deletions.
- **Admin names are shown for the website link but not for edits** (ADR 0012).
- **A deleted event's pictures leave the quota.** Whether they are ever purged
  is left open for review.
