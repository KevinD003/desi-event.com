-- Admission per night.
--
-- A ticket for one night admits once, on that night. A ticket good for every
-- night — a tier with no night of its own, on an event of more than one night —
-- admits once on each night. Before this migration `CheckIn.ticketId` was
-- unique, so a season pass admitted on its first night was "already in" on
-- every night after, and nothing recorded which night a ticket was let in on.
--
-- Four pieces:
--
-- 1. Uniqueness moves from the ticket to the ticket and the night. A second
--    admission on the same night is a unique violation, as it always was; and
--    a partial index keeps a ticket to one admission recorded with no night.
-- 2. `desi_check_in_ticket_admissible` keeps refusing a ticket that does not
--    admit, and now also refuses an admission on a night that is not the
--    ticket's own, on a night of another event, with no night for a ticket
--    good for every night, or a second admission of a ticket that admits once
--    (on any other night, or none). It locks the ticket row first, so two
--    admissions of one ticket take turns here and each sees the other's row.
-- 3. `desi_ticket_status_transition` refuses to hand on a ticket that has been
--    let in on any night: a successor starts with no admissions, and could be
--    let in again on a night the ticket already was.
-- 4. Admissions recorded before this migration are brought under these rules:
--    each gets a night, and a ticket good for every night that the old rules
--    made CHECKED_IN at its first admission admits again on the others.
--
-- A ticket good for every night stays VALID (or TRANSFER_PENDING) after each
-- night's admission; only a ticket that admits once becomes CHECKED_IN. The
-- application does both (apps/api/src/lib/tickets.js `admit`); the triggers are
-- what make them true for code that has not been written yet.
--
-- No BEGIN/COMMIT inside: Prisma wraps the file in one transaction.
--
-- Rollback (only while every ticket still has at most one CheckIn row):
--   DROP INDEX "CheckIn_ticketId_no_night_key";
--   DROP INDEX "CheckIn_ticketId_eventSessionId_key";
--   CREATE UNIQUE INDEX "CheckIn_ticketId_key" ON "CheckIn"("ticketId");
--   and re-create both functions from 20260916130000_commerce_services.
--   Section 4's nights may stay (the old rules ignore them). A ticket it made
--   VALID again is listed, with its old checkedInAt, by
--     SELECT "entityId", "metadata" FROM "AuditLog"
--      WHERE "action" = 'ticket.admission_night_backfilled'
--        AND ("metadata"->>'restoredToValid')::boolean;

-- ============================================================================
-- 1. One admission per ticket per night
-- ============================================================================

-- DropIndex
DROP INDEX "CheckIn_ticketId_key";

-- CreateIndex
CREATE UNIQUE INDEX "CheckIn_ticketId_eventSessionId_key" ON "CheckIn"("ticketId", "eventSessionId");

-- Nulls are distinct in a unique index, so the one above lets any number of
-- rows with no night through. This partial index is the other half: at most
-- one admission of a ticket recorded without a night. Prisma's schema language
-- cannot express it; verify-fresh-database probes it.
CREATE UNIQUE INDEX "CheckIn_ticketId_no_night_key" ON "CheckIn"("ticketId")
  WHERE "eventSessionId" IS NULL;

-- ============================================================================
-- 2. Which night a ticket may be let in on, and how often
-- ============================================================================

CREATE OR REPLACE FUNCTION desi_check_in_ticket_admissible() RETURNS trigger AS $$
DECLARE
  ticket_status "TicketStatus";
  ticket_night TEXT;
  ticket_event TEXT;
  nights INTEGER;
  every_night BOOLEAN;
BEGIN
  -- The ticket's row first, locked: every admission of one ticket waits here
  -- for the one before it to commit or roll back, so the checks below see
  -- each other's rows rather than racing past them. The application locks the
  -- same row before it writes, so for it this lock is already held.
  SELECT t."status" INTO ticket_status
    FROM "Ticket" t WHERE t."id" = NEW."ticketId"
    FOR UPDATE;

  IF ticket_status IS NULL THEN
    RAISE EXCEPTION 'check-in refused: ticket % does not exist', NEW."ticketId";
  END IF;

  IF ticket_status NOT IN ('VALID', 'TRANSFER_PENDING') THEN
    RAISE EXCEPTION 'check-in refused: ticket % is %, which does not admit',
      NEW."ticketId", ticket_status;
  END IF;

  -- The ticket's own night: its seat's, else its tier's. Null for a ticket
  -- whose tier names no night.
  SELECT COALESCE(es."eventSessionId", tt."eventSessionId"), o."eventId"
    INTO ticket_night, ticket_event
    FROM "Ticket" t
    JOIN "OrderItem" oi ON oi."id" = t."orderItemId"
    JOIN "Order" o ON o."id" = oi."orderId"
    LEFT JOIN "TicketType" tt ON tt."id" = oi."ticketTypeId"
    LEFT JOIN "EventSeat" es ON es."id" = t."eventSeatId"
    WHERE t."id" = NEW."ticketId";

  SELECT count(*) INTO nights FROM "EventSession" WHERE "eventId" = ticket_event;

  every_night := ticket_night IS NULL AND nights > 1;

  IF NEW."eventSessionId" IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM "EventSession"
      WHERE "id" = NEW."eventSessionId" AND "eventId" = ticket_event
    ) THEN
      RAISE EXCEPTION 'check-in refused: night % is not a night of ticket %''s event',
        NEW."eventSessionId", NEW."ticketId";
    END IF;

    IF ticket_night IS NOT NULL AND NEW."eventSessionId" <> ticket_night THEN
      RAISE EXCEPTION 'check-in refused: ticket % is for another night', NEW."ticketId";
    END IF;
  ELSIF every_night THEN
    RAISE EXCEPTION 'check-in refused: ticket % is good for every night, so its admission names the night',
      NEW."ticketId";
  END IF;

  -- A ticket that admits once has one admission. The same night again is left
  -- to the unique index (a duplicate, as it always was); any other key is
  -- refused here.
  IF NOT every_night AND EXISTS (
    SELECT 1 FROM "CheckIn" c
    WHERE c."ticketId" = NEW."ticketId"
      AND c."eventSessionId" IS DISTINCT FROM NEW."eventSessionId"
  ) THEN
    RAISE EXCEPTION 'check-in refused: ticket % admits once and was already admitted',
      NEW."ticketId";
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 3. A ticket let in on any night is not handed on
-- ============================================================================
--
-- The function from 20260916130000_commerce_services, unchanged but for the
-- last check.

CREATE OR REPLACE FUNCTION desi_ticket_status_transition() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = NEW."status" THEN
    RETURN NEW;
  END IF;

  -- Terminal states. Once a ticket is one of these it is finished, and the only
  -- honest way to give somebody admission is to issue a new ticket.
  IF OLD."status" IN ('TRANSFERRED', 'SUPERSEDED', 'REVOKED', 'REFUNDED', 'VOID') THEN
    RAISE EXCEPTION 'ticket % is %, which is terminal; it cannot become %',
      OLD."id", OLD."status", NEW."status";
  END IF;

  -- A ticket that has been used can still be marked refunded or cancelled —
  -- money and the event are separate questions from attendance — but it cannot
  -- go back to being unused, and it cannot be handed on.
  IF OLD."status" = 'CHECKED_IN'
     AND NEW."status" NOT IN ('REFUNDED', 'CANCELLED') THEN
    RAISE EXCEPTION 'ticket % has been checked in; it cannot become %',
      OLD."id", NEW."status";
  END IF;

  IF NEW."status" = 'VALID' AND OLD."status" <> 'TRANSFER_PENDING' THEN
    RAISE EXCEPTION 'ticket % cannot return to VALID from %', OLD."id", OLD."status";
  END IF;

  -- A ticket good for every night stays VALID after a night's admission, so
  -- the check above does not catch it. Handing it on would give the recipient
  -- a new ticket with no admissions, which could be let in again on a night
  -- this one already was.
  IF NEW."status" IN ('TRANSFER_PENDING', 'TRANSFERRED')
     AND EXISTS (SELECT 1 FROM "CheckIn" WHERE "ticketId" = OLD."id") THEN
    RAISE EXCEPTION 'ticket % has been let in on a night; it cannot be handed on', OLD."id";
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 4. Admissions recorded before this migration
-- ============================================================================
--
-- Until now an admission recorded no night, and a ticket good for every night
-- became CHECKED_IN at its first. Left that way, the rules above refuse such a
-- ticket on every later night: its status does not admit, and its one
-- admission names no night, which an every-night ticket's may not. So, on each
-- event of more than one night (an event of one night needs no nights, and is
-- left alone):
--
-- a. Each admission with no night is given one: the ticket's own night (its
--    seat's, else its tier's) when it has one; otherwise the night whose window
--    — doors, or the start when no door time is set, to the end — holds the
--    moment it was scanned; otherwise the night nearest that moment. Ties go
--    to the earlier start, then the lower id, so every run chooses alike. Each
--    ticket had at most one admission, so no ticket gets a night twice.
-- b. A ticket good for every night that is CHECKED_IN, was let in, and has a
--    night of its event it was not let in on, is VALID again with no
--    checkedInAt: what the rules above would have left it, with the admission
--    row as the record of the night it was let in. The status trigger refuses
--    CHECKED_IN -> VALID, rightly, for everything else, so it is switched off
--    for this one statement and on again.
-- c. Every ticket touched is written to the audit log, with no actor: action
--    `ticket.admission_night_backfilled`, entity the ticket, metadata
--    { checkInId, eventId, eventSessionId, chosenBy (OWN_NIGHT, WINDOW or
--    NEAREST), scannedAt, restoredToValid, previousCheckedInAt, migration }.
--    The ids are derived, so they are stable and cannot collide.
--
-- Plain temporary tables, dropped at the end, rather than ON COMMIT DROP: the
-- file must work whether or not it runs inside one transaction.

CREATE TEMPORARY TABLE desi_admission_backfill AS
SELECT
  a.check_in_id,
  a.ticket_id,
  a.event_id,
  a.scanned_at,
  COALESCE(a.own_night, pick."id") AS night,
  CASE
    WHEN a.own_night IS NOT NULL THEN 'OWN_NIGHT'
    WHEN pick.distance = 0 THEN 'WINDOW'
    ELSE 'NEAREST'
  END AS chosen_by
FROM (
  SELECT
    c."id" AS check_in_id,
    c."ticketId" AS ticket_id,
    c."scannedAt" AS scanned_at,
    o."eventId" AS event_id,
    COALESCE(es."eventSessionId", tt."eventSessionId") AS own_night
  FROM "CheckIn" c
  JOIN "Ticket" t ON t."id" = c."ticketId"
  JOIN "OrderItem" oi ON oi."id" = t."orderItemId"
  JOIN "Order" o ON o."id" = oi."orderId"
  LEFT JOIN "TicketType" tt ON tt."id" = oi."ticketTypeId"
  LEFT JOIN "EventSeat" es ON es."id" = t."eventSeatId"
  WHERE c."eventSessionId" IS NULL
    AND (SELECT count(*) FROM "EventSession" s WHERE s."eventId" = o."eventId") > 1
) a
LEFT JOIN LATERAL (
  SELECT
    s."id",
    GREATEST(
      EXTRACT(EPOCH FROM (LEAST(COALESCE(s."doorsOpenAt", s."startsAt"), s."startsAt") - a.scanned_at)),
      EXTRACT(EPOCH FROM (a.scanned_at - s."endsAt")),
      0
    ) AS distance
  FROM "EventSession" s
  WHERE s."eventId" = a.event_id
  ORDER BY distance, s."startsAt", s."id"
  LIMIT 1
) pick ON true;

UPDATE "CheckIn" c
SET "eventSessionId" = b.night
FROM desi_admission_backfill b
WHERE c."id" = b.check_in_id;

CREATE TEMPORARY TABLE desi_admission_restored AS
SELECT t."id" AS ticket_id, t."checkedInAt" AS previous_checked_in_at
FROM "Ticket" t
JOIN "OrderItem" oi ON oi."id" = t."orderItemId"
JOIN "Order" o ON o."id" = oi."orderId"
LEFT JOIN "TicketType" tt ON tt."id" = oi."ticketTypeId"
LEFT JOIN "EventSeat" es ON es."id" = t."eventSeatId"
WHERE t."status" = 'CHECKED_IN'
  AND COALESCE(es."eventSessionId", tt."eventSessionId") IS NULL
  AND (SELECT count(*) FROM "EventSession" s WHERE s."eventId" = o."eventId") > 1
  AND EXISTS (SELECT 1 FROM "CheckIn" c WHERE c."ticketId" = t."id")
  AND EXISTS (
    SELECT 1 FROM "EventSession" s
    WHERE s."eventId" = o."eventId"
      AND NOT EXISTS (
        SELECT 1 FROM "CheckIn" c WHERE c."ticketId" = t."id" AND c."eventSessionId" = s."id"
      )
  );

ALTER TABLE "Ticket" DISABLE TRIGGER desi_ticket_status_transition;

UPDATE "Ticket" t
SET "status" = 'VALID', "checkedInAt" = NULL, "updatedAt" = now()
FROM desi_admission_restored r
WHERE t."id" = r.ticket_id;

ALTER TABLE "Ticket" ENABLE TRIGGER desi_ticket_status_transition;

INSERT INTO "AuditLog" ("id", "actorId", "action", "entityType", "entityId", "metadata", "createdAt")
SELECT
  'c' || substr(md5(COALESCE(b.ticket_id, r.ticket_id) || ':admission-night-backfilled'), 1, 24),
  NULL,
  'ticket.admission_night_backfilled',
  'Ticket',
  COALESCE(b.ticket_id, r.ticket_id),
  jsonb_build_object(
    'checkInId', b.check_in_id,
    'eventId', b.event_id,
    'eventSessionId', b.night,
    'chosenBy', b.chosen_by,
    'scannedAt', b.scanned_at,
    'restoredToValid', r.ticket_id IS NOT NULL,
    'previousCheckedInAt', r.previous_checked_in_at,
    'migration', '20260929100000_check_in_per_night'
  ),
  now()
FROM desi_admission_backfill b
FULL JOIN desi_admission_restored r ON r.ticket_id = b.ticket_id;

DROP TABLE desi_admission_restored;
DROP TABLE desi_admission_backfill;
