-- ===========================================================================
-- Optimistic concurrency for the event draft editor.
--
-- The multi-step editor autosaves. Two people editing one draft — or one person
-- with two tabs open, which is commoner — would otherwise silently overwrite
-- each other: last write wins and the loser is never told. `revision` is the
-- precondition. A client sends the revision it read; the write applies only if
-- that is still the current one, and a mismatch is reported rather than
-- resolved by luck.
--
-- Same mechanism as `VenueMapVersion.revision`, deliberately. A second way of
-- doing this would be a second thing to get right.
--
-- Additive with a default, so existing rows migrate without a backfill pass.
-- ===========================================================================

ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "revision" INTEGER NOT NULL DEFAULT 0;

-- The revision only ever moves forward. A write that lowered it would let a
-- stale client's next attempt succeed against a precondition it should fail.
CREATE OR REPLACE FUNCTION desi_event_revision_forward() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."revision" < OLD."revision" THEN
    RAISE EXCEPTION
      'event % revision cannot move backwards (% -> %)',
      OLD."id", OLD."revision", NEW."revision"
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER desi_event_revision_forward
  BEFORE UPDATE ON "Event"
  FOR EACH ROW EXECUTE FUNCTION desi_event_revision_forward();

-- ===========================================================================
-- A ticket type's name is its identity to a buyer.
--
-- Two tiers called "Early bird" on one event are indistinguishable in a
-- checkout list, and an organiser who created the second by accident has no way
-- to tell which is which afterwards. Scoped to the event, so two different
-- events may both have an "Early bird".
-- ===========================================================================

CREATE UNIQUE INDEX IF NOT EXISTS "TicketType_eventId_name_key"
  ON "TicketType" ("eventId", "name");

-- ===========================================================================
-- A sales window that closes before it opens sells nothing, and says nothing
-- about why. The API validates it; this is the floor underneath.
-- ===========================================================================

ALTER TABLE "TicketType"
  ADD CONSTRAINT "ticket_type_sales_window_ordered"
  CHECK ("salesEndAt" IS NULL OR "salesStartAt" IS NULL OR "salesEndAt" > "salesStartAt") NOT VALID;

ALTER TABLE "TicketType" VALIDATE CONSTRAINT "ticket_type_sales_window_ordered";

ALTER TABLE "EventSession"
  ADD CONSTRAINT "event_session_sales_window_ordered"
  CHECK ("salesEndAt" IS NULL OR "salesStartAt" IS NULL OR "salesEndAt" > "salesStartAt") NOT VALID;

ALTER TABLE "EventSession" VALIDATE CONSTRAINT "event_session_sales_window_ordered";
