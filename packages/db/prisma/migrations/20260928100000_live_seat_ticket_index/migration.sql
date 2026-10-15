-- One LIVE ticket per seat (ADR 0006; supersedes ADR 0005's option C).
--
-- The full unique index on "Ticket"."eventSeatId" made a reserved seat
-- impossible to hand on: accepting a transfer mints the successor with the
-- predecessor's seat while the predecessor still points at it. The invariant
-- that matters is narrower — at most one ticket that can still admit holds a
-- seat — and a handed-on or refunded row keeps its pointer as history.
--
-- Partial, so Prisma's schema language cannot express it (same approach as
-- 20260914213145_facet_indexes and PrivacyRequest_one_in_flight_per_subject_key);
-- schema.prisma carries a comment above model Ticket pointing here, and a
-- future `prisma migrate diff` does not see it.
--
-- The old full unique index already guarantees there are no duplicates, so
-- building the partial one over populated data cannot fail. It is built before
-- the old one is dropped, so the table is never without the guarantee.
--
-- Rollback (only while no seat has two rows):
--   CREATE UNIQUE INDEX "Ticket_eventSeatId_key" ON "Ticket"("eventSeatId");
--   DROP INDEX "Ticket_eventSeatId_live_key"; DROP INDEX "Ticket_eventSeatId_idx";

CREATE UNIQUE INDEX "Ticket_eventSeatId_live_key"
  ON "Ticket" ("eventSeatId")
  WHERE "eventSeatId" IS NOT NULL
    AND "status" IN ('VALID', 'TRANSFER_PENDING', 'CHECKED_IN');

-- DropIndex
DROP INDEX "Ticket_eventSeatId_key";

-- CreateIndex: the plain index for the foreign key and history lookups
-- (matches @@index([eventSeatId])). The foreign key "Ticket_eventSeatId_fkey"
-- (ON DELETE SET NULL) is unchanged.
CREATE INDEX "Ticket_eventSeatId_idx" ON "Ticket"("eventSeatId");
