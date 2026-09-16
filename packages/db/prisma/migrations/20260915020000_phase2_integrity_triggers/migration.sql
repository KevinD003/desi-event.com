-- Phase 2: cross-table integrity the schema cannot express.
--
-- Everything here is an invariant that spans two tables, so a CHECK constraint
-- cannot see it and a foreign key cannot state it. Each one is also enforced in
-- application code; these exist for the code path nobody thought of, and for
-- the day somebody fixes data by hand.
--
-- No trigger here does any work. Every one of them either allows the write or
-- raises, so the cost is a couple of indexed lookups per row.

-- ===========================================================================
-- 1. An order line must sell a tier from the order's own event
--
-- NF-04. Nothing stopped an OrderItem referencing a TicketType belonging to a
-- different event, and under the Connect charge model the payee is derived from
-- the order's event — so a line from another organiser's event would attribute
-- money to the wrong account. The one-organiser-per-order invariant that ADR
-- 0003 rests on is only structural if this holds.
-- ===========================================================================

CREATE OR REPLACE FUNCTION desi_order_item_event_matches() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  order_event TEXT;
  tier_event  TEXT;
BEGIN
  SELECT "eventId" INTO order_event FROM "Order"      WHERE "id" = NEW."orderId";
  SELECT "eventId" INTO tier_event  FROM "TicketType" WHERE "id" = NEW."ticketTypeId";

  IF order_event IS NULL THEN
    RAISE EXCEPTION 'order % does not exist', NEW."orderId"
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF tier_event IS DISTINCT FROM order_event THEN
    RAISE EXCEPTION
      'order line sells ticket type % from event %, but the order is for event %',
      NEW."ticketTypeId", tier_event, order_event
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER desi_order_item_event_matches
  BEFORE INSERT OR UPDATE ON "OrderItem"
  FOR EACH ROW EXECUTE FUNCTION desi_order_item_event_matches();

-- ===========================================================================
-- 2. A session's seat inventory must come from the session's own seat map
--
-- Without this, an EventSeat could point at a seat in another venue's layout,
-- and "seat A12 is sold" would be true of a seat that does not exist in the
-- room the audience is standing in.
-- ===========================================================================

CREATE OR REPLACE FUNCTION desi_event_seat_map_matches() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  session_version TEXT;
  seat_version    TEXT;
BEGIN
  SELECT "venueMapVersionId" INTO session_version
  FROM "EventSession" WHERE "id" = NEW."eventSessionId";

  SELECT "venueMapVersionId" INTO seat_version
  FROM "Seat" WHERE "id" = NEW."seatId";

  IF session_version IS NULL THEN
    RAISE EXCEPTION
      'session % has no seat map, so it cannot hold reserved seats',
      NEW."eventSessionId"
      USING ERRCODE = 'check_violation';
  END IF;

  IF seat_version IS DISTINCT FROM session_version THEN
    RAISE EXCEPTION
      'seat % belongs to map version %, but session % sells map version %',
      NEW."seatId", seat_version, NEW."eventSessionId", session_version
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER desi_event_seat_map_matches
  BEFORE INSERT OR UPDATE ON "EventSeat"
  FOR EACH ROW EXECUTE FUNCTION desi_event_seat_map_matches();

-- ===========================================================================
-- 3. A hold line must reserve a seat from the hold's own session
-- ===========================================================================

CREATE OR REPLACE FUNCTION desi_hold_item_session_matches() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  hold_session TEXT;
  seat_session TEXT;
BEGIN
  IF NEW."eventSeatId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT "eventSessionId" INTO hold_session FROM "TicketHold" WHERE "id" = NEW."holdId";
  SELECT "eventSessionId" INTO seat_session FROM "EventSeat"  WHERE "id" = NEW."eventSeatId";

  IF hold_session IS NULL THEN
    RAISE EXCEPTION
      'hold % has no session, so it cannot reserve a named seat', NEW."holdId"
      USING ERRCODE = 'check_violation';
  END IF;

  IF seat_session IS DISTINCT FROM hold_session THEN
    RAISE EXCEPTION
      'seat % is in session % but the hold is for session %',
      NEW."eventSeatId", seat_session, hold_session
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER desi_hold_item_session_matches
  BEFORE INSERT OR UPDATE ON "HoldItem"
  FOR EACH ROW EXECUTE FUNCTION desi_hold_item_session_matches();

-- ===========================================================================
-- 4. A session may only sell a published seat map, and not change it once it
--    has sold anything
--
-- This is what makes "the layout a ticket was sold under" a fact rather than a
-- hope. A venue can redraw its room next season; the row somebody bought keeps
-- pointing at the geometry it was bought in.
-- ===========================================================================

CREATE OR REPLACE FUNCTION desi_event_session_map_frozen() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  published TIMESTAMP(3);
  sold_count INT;
BEGIN
  IF NEW."venueMapVersionId" IS NOT NULL THEN
    SELECT "publishedAt" INTO published
    FROM "VenueMapVersion" WHERE "id" = NEW."venueMapVersionId";

    IF published IS NULL THEN
      RAISE EXCEPTION
        'map version % is still editable and cannot back a session',
        NEW."venueMapVersionId"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD."venueMapVersionId" IS DISTINCT FROM NEW."venueMapVersionId" THEN
    SELECT count(*) INTO sold_count
    FROM "EventSeat"
    WHERE "eventSessionId" = OLD."id" AND "status" IN ('SOLD', 'COMPLIMENTARY');

    IF sold_count > 0 THEN
      RAISE EXCEPTION
        'session % has % sold seats; its seat map is frozen', OLD."id", sold_count
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER desi_event_session_map_frozen
  BEFORE INSERT OR UPDATE ON "EventSession"
  FOR EACH ROW EXECUTE FUNCTION desi_event_session_map_frozen();

-- ===========================================================================
-- 5. A published seat map is immutable
--
-- `publishedAt` is the freeze. Before it, a layout may be edited freely; after
-- it, editing means publishing a new version. Without this the "immutable
-- version" in the schema comments would be a naming convention rather than a
-- property, and a seat could be renamed under a ticket that had already been
-- sold for it.
-- ===========================================================================

CREATE OR REPLACE FUNCTION desi_map_version_frozen() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  version_id TEXT;
  published  TIMESTAMP(3);
BEGIN
  version_id := COALESCE(
    CASE WHEN TG_OP = 'DELETE' THEN OLD."venueMapVersionId" ELSE NEW."venueMapVersionId" END,
    CASE WHEN TG_OP = 'DELETE' THEN OLD."venueMapVersionId" ELSE NEW."venueMapVersionId" END
  );

  SELECT "publishedAt" INTO published FROM "VenueMapVersion" WHERE "id" = version_id;

  IF published IS NOT NULL THEN
    RAISE EXCEPTION
      'map version % was published at % and cannot be changed; publish a new version instead',
      version_id, published
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER desi_section_frozen
  BEFORE INSERT OR UPDATE OR DELETE ON "Section"
  FOR EACH ROW EXECUTE FUNCTION desi_map_version_frozen();

CREATE TRIGGER desi_seat_row_frozen
  BEFORE INSERT OR UPDATE OR DELETE ON "SeatRow"
  FOR EACH ROW EXECUTE FUNCTION desi_map_version_frozen();

CREATE TRIGGER desi_price_zone_frozen
  BEFORE INSERT OR UPDATE OR DELETE ON "PriceZone"
  FOR EACH ROW EXECUTE FUNCTION desi_map_version_frozen();

-- The seat trigger additionally checks that a companion seat is in the same
-- layout, which is a cross-row rule a CHECK cannot see.
CREATE OR REPLACE FUNCTION desi_seat_frozen_and_coherent() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  version_id       TEXT;
  published        TIMESTAMP(3);
  companion_version TEXT;
BEGIN
  version_id := CASE WHEN TG_OP = 'DELETE' THEN OLD."venueMapVersionId" ELSE NEW."venueMapVersionId" END;

  SELECT "publishedAt" INTO published FROM "VenueMapVersion" WHERE "id" = version_id;

  IF published IS NOT NULL THEN
    RAISE EXCEPTION
      'map version % was published at % and its seats cannot be changed', version_id, published
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;

  IF NEW."companionOfSeatId" IS NOT NULL THEN
    SELECT "venueMapVersionId" INTO companion_version
    FROM "Seat" WHERE "id" = NEW."companionOfSeatId";

    IF companion_version IS DISTINCT FROM NEW."venueMapVersionId" THEN
      RAISE EXCEPTION
        'companion seat % is in map version %, not %',
        NEW."companionOfSeatId", companion_version, NEW."venueMapVersionId"
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER desi_seat_frozen_and_coherent
  BEFORE INSERT OR UPDATE OR DELETE ON "Seat"
  FOR EACH ROW EXECUTE FUNCTION desi_seat_frozen_and_coherent();

-- A version's freeze is one-way. Clearing `publishedAt` would unfreeze a layout
-- that tickets have already been sold against.
CREATE OR REPLACE FUNCTION desi_map_version_publish_once() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."publishedAt" IS NOT NULL AND NEW."publishedAt" IS DISTINCT FROM OLD."publishedAt" THEN
    RAISE EXCEPTION
      'map version % was published at % and cannot be unpublished or re-dated',
      OLD."id", OLD."publishedAt"
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD."publishedAt" IS NOT NULL AND NEW."version" IS DISTINCT FROM OLD."version" THEN
    RAISE EXCEPTION 'map version % is published; its number cannot change', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER desi_map_version_publish_once
  BEFORE UPDATE ON "VenueMapVersion"
  FOR EACH ROW EXECUTE FUNCTION desi_map_version_publish_once();
