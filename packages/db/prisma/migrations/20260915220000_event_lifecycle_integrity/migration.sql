-- ===========================================================================
-- Event lifecycle integrity: two invariants the application cannot be trusted
-- with, found while building the lifecycle service and its integration suite.
--
-- Both are the same shape as NF-04 and are enforced the same way. ADR 0004
-- covers the use of plpgsql inside migrations.
-- ===========================================================================

-- ===========================================================================
-- NF-20. A TicketType could name an EventSession belonging to a *different*
-- event.
--
-- `TicketType.eventSessionId` references `EventSession(id)` and nothing more,
-- so a tier sold for event A could be scoped to a session of event B. The
-- consequences separate: inventory would count against B's session while the
-- order, the ticket and the door list all say A. NF-04 closed exactly this hole
-- one level down, between an order line and its tier; this is the same mistake
-- one level up, and it was found by an integration test that expected the
-- database to refuse and discovered it did not.
--
-- A null `eventSessionId` is legitimate and untouched: it means "every session
-- of this event", which is how a Phase 1 single-session event migrates without
-- inventing a session.
-- ===========================================================================

CREATE OR REPLACE FUNCTION desi_ticket_type_session_matches() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  session_event TEXT;
BEGIN
  IF NEW."eventSessionId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT "eventId" INTO session_event
    FROM "EventSession" WHERE "id" = NEW."eventSessionId";

  IF session_event IS NULL THEN
    RAISE EXCEPTION 'event session % does not exist', NEW."eventSessionId"
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF session_event IS DISTINCT FROM NEW."eventId" THEN
    RAISE EXCEPTION
      'ticket type for event % names session %, which belongs to event %',
      NEW."eventId", NEW."eventSessionId", session_event
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER desi_ticket_type_session_matches
  BEFORE INSERT OR UPDATE ON "TicketType"
  FOR EACH ROW EXECUTE FUNCTION desi_ticket_type_session_matches();

-- ===========================================================================
-- NF-21. An Event could end before it started.
--
-- `EventSession` has carried `event_session_ends_after_start` since the Phase 2
-- migration. `Event` never got the same check, so the parent could hold a
-- window its own children were forbidden. The API validates it on create and on
-- update — but "the API validates it" is the sentence that precedes every one
-- of these findings, and a backfill, a console fix or a future route does not
-- go through the API.
--
-- NOT VALID, then VALIDATE: the check is enforced for every new and updated row
-- immediately, and existing rows are verified in a second pass that takes a
-- weaker lock. A deployment with a bad row fails the VALIDATE and is told which
-- invariant it breaks, rather than failing the ADD and being told nothing.
-- ===========================================================================

ALTER TABLE "Event"
  ADD CONSTRAINT "event_ends_after_start"
  CHECK ("endsAt" > "startsAt") NOT VALID;

ALTER TABLE "Event" VALIDATE CONSTRAINT "event_ends_after_start";
