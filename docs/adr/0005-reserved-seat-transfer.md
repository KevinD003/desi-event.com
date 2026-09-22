# ADR 0005 — Reserved-seat transfer stays blocked, and the block is made real

- **Status:** Accepted for Phase 4 (Phase 3 of the Phase 4 programme)
- **Date:** 2026-09-22
- **Supersedes:** nothing
- **Related:** ADR 0004; finding S-1 in `docs/PHASE4_IMPLEMENTATION_REPORT.md`

## Context

A transfer does not move a ticket; it retires it. Accepting an invitation
marks the old ticket `TRANSFERRED`, clears its pass, and inserts a new ticket
for the recipient that points back at it through `supersedesTicketId`
(`apps/api/src/lib/tickets.js`, `acceptTransfer`). For a reserved-seat ticket
the new row copies `eventSeatId`, and `Ticket.eventSeatId` carries a **full**
unique index (`Ticket_eventSeatId_key`). The old row still holds the pointer,
so the insert fails.

What that looked like before this decision:

- nothing refused a seated ticket at the start of a transfer: the invitation
  was sent, and the ticket moved to `TRANSFER_PENDING`;
- the web screen offered the transfer for any `VALID` ticket;
- every attempt to accept answered **500**, and no sweep ever ended the
  invitation — the ticket stayed pending until the sender withdrew it;
- the Phase 2 report called seated transfer "blocked". It was not blocked; it
  was broken at the last step.

### The questions the brief asked, answered from the code

| Question                         | Answer today                                                                                                                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Seat history                     | None of its own. Seat display joins `Ticket → EventSeat → Seat → Section/Row`; no ticket or audit row snapshots it. Published geometry is frozen by trigger, so the join is stable while the pointer exists.        |
| Which ticket owns the live seat? | `EventSeat` records the _line_ (`orderItemId`), not the ticket. `Ticket.eventSeatId` is the only ticket-level link, and after a transfer the predecessor and successor share the line.                              |
| Atomic release and reassignment  | A transfer needs no `EventSeat` write: the seat stays `SOLD` on the same line. The whole problem is the ticket-level uniqueness.                                                                                    |
| Two acceptances at once          | Serialised by the conditional `PENDING → ACCEPTED` update.                                                                                                                                                          |
| Cancellation and expiry          | `endTransfer` returns the ticket to `VALID`; no seat involvement. Nothing calls it with `EXPIRED`.                                                                                                                  |
| Check-in racing a transfer       | The admission locks the ticket row; an acceptance that read the ticket before the admission finds it changed. That acceptance used to **commit `ACCEPTED` with no successor** (S-2) — fixed here, see below.        |
| Refund or revocation             | A refund releases the seat (`AVAILABLE` or `BLOCKED`) but leaves `eventSeatId` on the `REFUNDED` row; a revocation touches neither. The first leaves a latent collision when the seat is resold (see Consequences). |
| Audit                            | No transfer, refund or revocation audit row names a seat.                                                                                                                                                           |
| Seat snapshot                    | None.                                                                                                                                                                                                               |

## Options

**A. Move the pointer and snapshot the seat.** Null the predecessor's
`eventSeatId` in the same transition that retires it, copy it to the
successor, and add write-once `seatSection`/`seatRow`/`seatLabel` columns to
every ticket, backfilled, with a new trigger protecting them. Refunds would
also have to null the pointer. History disappears silently on any path that
nulls without snapshotting. The brief forbids the first half without the
second.

**B. Make the index say what the system needs: one _live_ ticket per seat.**
Replace the full unique index with a partial one over
`VALID`, `TRANSFER_PENDING` and `CHECKED_IN`. `acceptTransfer` needs no change
(the predecessor leaves the predicate before the successor is inserted), the
predecessor keeps its pointer so history is free, and the resale-after-refund
collision goes away too. But it is only safe together with: serialising
acceptance against refund on the order line (`OrderItem FOR UPDATE` on both
paths — today a refund that reads before an acceptance commits refunds the
predecessor and leaves the successor live), changing the `EventSeat.ticket`
back-relation to a list, teaching the test stub predicate uniqueness,
removing `TRANSFERRED` from analytics' `LIVE_TICKET_STATES` (it would count a
seat twice), rewriting settlement Case 14, and real-PostgreSQL tests for four
races. That is a migration plus changes in refunds, analytics, the stub and
two test suites.

**C. Keep it blocked, and make the block real.** Refuse a seated ticket where
a transfer starts, refuse a pre-existing seated invitation where it is
accepted, and stop the screen offering it.

## Decision

**C for this phase.** Option B is the right end state and is recorded as the
plan, but it is not narrow: it changes the refund path's locking and the
analytics definition of a live ticket, both outside the scope this phase was
authorised to change, and a partial fix — the index without the refund lock —
would trade a loud 500 for a quiet double admission.

What was implemented:

1. `startTransfer` refuses a ticket with a reserved seat (**422**,
   `error.reason: RESERVED_SEAT`) before anything is written or sent.
2. `acceptTransfer` refuses one (**409**, `RESERVED_SEAT`) before anything is
   written, so an invitation sent before this change fails cleanly and the
   sender can withdraw it.
3. `GET /v1/tickets/:id` carries `transferBlockedReason`, and the ticket
   screen shows "reserved-seat tickets cannot be handed on yet" in place of
   the offer button. Withdrawing an existing offer is still available.
4. Separately, because it sits on the same path and is not about seats:
   `acceptTransfer` now **throws** when the ticket changed under it, so the
   invitation's `ACCEPTED` flip rolls back with everything else (S-2).

`apps/api/tests/seat-transfer-block-integration.test.js` proves each against
PostgreSQL, including that the full unique index is still there — so whoever
implements option B has to change that case on purpose.

## Consequences

- Reserved-seat transfer is **BLOCKED — UNIQUE-SEAT TRANSFER DEFECT**. It is
  not fixed, and nothing in the UI advertises it.
- **Latent, and not fixed here:** a refund with the `RESELL` seat policy makes
  the seat `AVAILABLE` but leaves `eventSeatId` on the `REFUNDED` ticket. A new
  buyer's settlement would then fail on the same unique index after payment
  capture, and the webhook path would misreport it as a duplicate delivery.
  Found by reading (`refunds.js` `revokeAndReturn`, `checkout.js`
  `issueTicket`, `payments.js`); no test demonstrates it. Option B removes it.
- A refund picks which tickets of a line to refund by creation order and
  ignores `RefundItem.ticketId`. Recorded with the above.
