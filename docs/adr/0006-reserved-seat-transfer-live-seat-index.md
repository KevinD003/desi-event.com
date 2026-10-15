# ADR 0006 — One live ticket per seat: reserved-seat tickets can be handed on

- **Status:** Accepted
- **Date:** 2026-09-29
- **Supersedes:** ADR 0005 (its decision; its context and options stand as the
  record of what was known on 2026-09-22)
- **Related:** ADR 0004; migration
  `20260928100000_live_seat_ticket_index`

## Context

ADR 0005 found that a reserved-seat ticket could not be handed on. Accepting a
transfer retires the old ticket and inserts a successor that copies its
`eventSeatId`, and a **full** unique index on `Ticket.eventSeatId`
(`Ticket_eventSeatId_key`) refused the insert while the old row still pointed at
the seat. It chose option C — refuse a seated transfer at both ends and say so
on the ticket screen — and recorded option B as the right end state:

> Replace the full unique index with a partial one over `VALID`,
> `TRANSFER_PENDING` and `CHECKED_IN` … only safe together with: serialising
> acceptance against refund on the order line (`OrderItem FOR UPDATE` on both
> paths) … changing the `EventSeat.ticket` back-relation to a list, teaching the
> test stub predicate uniqueness, removing `TRANSFERRED` from analytics'
> `LIVE_TICKET_STATES` …, rewriting settlement Case 14, and real-PostgreSQL
> tests for four races.

The feature-completion work was authorised to change the refund path's locking
and the analytics definition of a live ticket, which is what ADR 0005 said it
lacked. The index alone, without the refund lock, would have traded a loud 500
for a quiet double admission, so the decision below is taken only as the whole
of option B.

## Decision

**Option B, in full.** The invariant is "at most one ticket that can still
admit holds a seat", and the database now says exactly that.

1. **The index.** `Ticket_eventSeatId_live_key` is a partial unique index on
   `"eventSeatId"` `WHERE "eventSeatId" IS NOT NULL AND "status" IN ('VALID',
'TRANSFER_PENDING', 'CHECKED_IN')`. The migration builds it before dropping
   `Ticket_eventSeatId_key`, so the table is never without a guarantee, and
   adds a plain `Ticket_eventSeatId_idx` for the foreign key and history
   lookups. Prisma's schema language cannot express a partial index, so
   `schema.prisma` carries a comment pointing at the migration and the
   migration carries its rollback.
2. **History is free.** A handed-on (`TRANSFERRED`) or `REFUNDED` row keeps its
   `eventSeatId` as the record of who held the seat; only live rows compete for
   it. `EventSeat` has a list of tickets rather than one.
3. **Acceptance and refund take turns on the order line.** `acceptTransfer`
   locks the `OrderItem` row `FOR UPDATE` before it retires the predecessor and
   issues the successor, and `revokeAndReturn` takes the same lock for each
   refunded line before it reads the line's tickets. Whichever commits first,
   the other sees it: a refund can no longer read the predecessor, return the
   money and leave a live successor admitting. The same lock closes the
   general-admission half of the race, which ADR 0005 did not name.
4. **Analytics counts a handed-on ticket once.** `LIVE_TICKET_STATES` in
   `apps/api/src/lib/analytics.js` is `VALID`, `TRANSFER_PENDING` and
   `CHECKED_IN`; `TRANSFERRED` was removed, so a transfer no longer counts the
   predecessor and the successor.
5. **The block is removed.** `startTransfer` offers a reserved-seat ticket like
   any other, acceptance moves the seat with the ticket, and the ticket screen
   no longer carries the "cannot be handed on" sentence or the
   `transferBlockedReason` field.
6. **The test stub models the predicate.** `apps/api/tests/helpers/prisma-stub.js`
   enforces `Ticket_eventSeatId_live_key` as a partial unique rule, so a stub
   test cannot pass on a write the database would refuse.

## Evidence

- `apps/api/tests/seat-transfer-integration.test.js` (real PostgreSQL; renamed
  from `seat-transfer-block-integration.test.js`, every case restated rather
  than deleted): a seated ticket can be offered with the seat untouched;
  accepting moves the live seat and keeps the old row as history; a second live
  ticket on the seat is refused while a handed-on or refunded row is not; an
  acceptance then a refund (the refund waits, then refunds the successor); a
  refund then an acceptance (the acceptance waits, then refuses, and the
  invitation stays pending); two acceptances issue one successor; a check-in
  racing an acceptance lets exactly one happen; a seat refunded with `RESELL`
  can be sold and ticketed again; withdrawal still works; a failed acceptance
  rolls back entirely. It runs in `pnpm db:verify:fresh`.
- `apps/api/tests/settlement-invariants.test.js` case 14 is rewritten to the
  new rule, and case 14b proves a second live ticket for a seat is still
  refused by `Ticket_eventSeatId_live_key`.
- `apps/api/tests/refund-concurrency.test.js` adds the general-admission race,
  and a settlement racing the start of an offer (see Consequences).
- `packages/db/scripts/phase2-probes.mjs` and
  `packages/db/scripts/verify-fresh-database.mjs` probe the index by name: a
  seat has one live ticket, and a handed-on seat's history row does not block
  its successor.

## Consequences

- **Reserved-seat transfer works.** The limitations page no longer lists
  "BLOCKED — UNIQUE-SEAT TRANSFER DEFECT", and the entry left in the same change
  as the tests above.
- **The latent resale collision ADR 0005 recorded is gone.** A refund with the
  `RESELL` seat policy leaves `eventSeatId` on the `REFUNDED` row, and the
  partial index no longer counts that row, so a new buyer's settlement no longer
  collides with it. The integration suite sells and tickets such a seat again.
- **One lock order everywhere a line's tickets change:** Refund, Order,
  OrderItem, Tickets. A new writer that changes a ticket's liveness without
  taking the line lock first reopens the race this ADR closes.
- **Still recorded, not changed:** a refund chooses which of a line's tickets
  to refund by creation order and does not read `RefundItem.ticketId` (ADR
  0005, Consequences). And a refund settling after a group pass has admitted
  every ticket on the order returns the money with `ticketsRevoked` of 0,
  because admitted tickets are terminal (`docs/CHECK_IN.md`,
  "`CHECKED_IN` is terminal"); that is a money decision recorded against the
  order, not an admission to undo.
- **Starting an offer takes no order-line lock, and a settling refund no
  longer depends on it.** `startTransfer` moves a ticket from `VALID` to
  `TRANSFER_PENDING` with its own conditional update and nothing else. The
  refund's revoking update used to be conditional on the exact status it had
  read, so a refund that read `VALID` just before an offer committed matched no
  row, skipped the ticket, and returned the money with the ticket still
  admitting. The real-PostgreSQL case "a refund racing a ticket transfer" in
  `refund-concurrency.test.js` reached that window by chance and failed once in
  one full API run during integration (2026-09-29). **Closed in the
  integration stage** (`revokeAndReturn` in `apps/api/src/lib/refunds.js`): the
  update is now conditional on the ticket still being refundable (`VALID` or
  `TRANSFER_PENDING`), which PostgreSQL re-checks against the row as the offer
  left it, so either order of arrival ends with the ticket `REFUNDED`; an offer
  started after the settlement finds `REFUNDED` and moves nothing, and a ticket
  checked in meanwhile still matches nothing and is left alone. "A refund
  settling while an offer is being started on the line's ticket" holds the
  offer's transaction open so the window is reached every time; it fails
  against the old condition and passes against the new one.
