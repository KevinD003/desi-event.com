-- Event authoring: hidden and complimentary tiers, per-order bounds, bounded
-- descriptions, one reserved tier per session and zone, positive GA capacity,
-- and the event page's public content fields.
--
-- No BEGIN/COMMIT inside: Prisma wraps the file in one transaction (see
-- verify-populated-upgrade.mjs). Every constraint added to an existing table
-- normalises the rows it would refuse first, or is NOT VALID and then
-- VALIDATEd, so a deployment with rows fails loudly on a row nothing could
-- have written through the API rather than silently.

-- ============================================================================
-- 1. Ticket type visibility (hidden tiers and comps)
-- ============================================================================
--
-- HIDDEN is not listed publicly and is bookable only by members holding
-- ticketType:manage. A complimentary tier was never meant for the public page,
-- so every existing one becomes HIDDEN.
--
-- Rollback: ALTER TABLE "TicketType" DROP COLUMN "visibility"; DROP TYPE "TicketTypeVisibility";

-- CreateEnum
CREATE TYPE "TicketTypeVisibility" AS ENUM ('PUBLIC', 'HIDDEN');

-- AlterTable
ALTER TABLE "TicketType" ADD COLUMN     "visibility" "TicketTypeVisibility" NOT NULL DEFAULT 'PUBLIC';

UPDATE "TicketType" SET "visibility" = 'HIDDEN' WHERE "complimentary" = true;

-- ============================================================================
-- 2. Per-order bounds
-- ============================================================================
--
-- The checkout's quantity ceiling is 50. Existing rows are clamped first, so
-- the constraint can only refuse a row written after this migration.
--
-- Rollback: ALTER TABLE "TicketType" DROP CONSTRAINT "ticket_type_per_order_bounds";
-- (Clamped values are not restorable.)

UPDATE "TicketType" SET "maxPerOrder" = LEAST(GREATEST("maxPerOrder", 1), 50)
  WHERE "maxPerOrder" < 1 OR "maxPerOrder" > 50;
UPDATE "TicketType" SET "minPerOrder" = LEAST(GREATEST("minPerOrder", 1), "maxPerOrder")
  WHERE "minPerOrder" < 1 OR "minPerOrder" > "maxPerOrder";

ALTER TABLE "TicketType" ADD CONSTRAINT "ticket_type_per_order_bounds"
  CHECK ("minPerOrder" >= 1 AND "maxPerOrder" <= 50 AND "minPerOrder" <= "maxPerOrder") NOT VALID;
ALTER TABLE "TicketType" VALIDATE CONSTRAINT "ticket_type_per_order_bounds";

-- ============================================================================
-- 3. A complimentary tier is free and hidden
-- ============================================================================
--
-- The API has always refused a priced complimentary tier, so no row written
-- through it can fail the VALIDATE; a hand-written one does, loudly.
--
-- Rollback: ALTER TABLE "TicketType" DROP CONSTRAINT "ticket_type_complimentary_free_and_hidden";

ALTER TABLE "TicketType" ADD CONSTRAINT "ticket_type_complimentary_free_and_hidden"
  CHECK (NOT "complimentary" OR ("priceCents" = 0 AND "visibility" = 'HIDDEN')) NOT VALID;
ALTER TABLE "TicketType" VALIDATE CONSTRAINT "ticket_type_complimentary_free_and_hidden";

-- ============================================================================
-- 4. Descriptions
-- ============================================================================
--
-- A blank description becomes NULL. The 500-character limit is enforced only
-- on INSERT or when the text changes, so a legacy longer row stays readable and
-- settlement's quantitySold update on it never fails.
--
-- Rollback: DROP TRIGGER desi_ticket_type_description_length ON "TicketType";
--           DROP FUNCTION desi_ticket_type_description_length();

UPDATE "TicketType" SET "description" = NULL
  WHERE "description" IS NOT NULL AND btrim("description") = '';

CREATE OR REPLACE FUNCTION desi_ticket_type_description_length() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."description" IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW."description" IS DISTINCT FROM OLD."description")
     AND char_length(NEW."description") > 500 THEN
    RAISE EXCEPTION 'ticket type % description is % characters; the limit is 500',
      NEW."id", char_length(NEW."description")
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER desi_ticket_type_description_length
  BEFORE INSERT OR UPDATE ON "TicketType"
  FOR EACH ROW EXECUTE FUNCTION desi_ticket_type_description_length();

-- ============================================================================
-- 5. Reserved tiers: one per (session, zone), on the session's own map
-- ============================================================================
--
-- A partial unique index, which Prisma's schema language cannot express (same
-- approach as 20260914213145_facet_indexes); schema.prisma carries a comment
-- above model TicketType pointing here. NULLs are distinct, so a tier that
-- names no session or no zone never collides. Created ONCE, here: the commerce
-- migration relies on it rather than adding a second index with the same
-- meaning. A database already holding two reserved tiers on one zone and
-- session fails here, by design: that is the ambiguity the index removes.
--
-- Two triggers keep a tier's zone on the map version its session sells, which
-- would otherwise bind seats nobody can reach. The invariant has two sides,
-- and each side has its own trigger:
--
--  * desi_ticket_type_zone_matches_session refuses a tier written with a zone
--    from another version;
--  * desi_event_session_map_keeps_tier_zones refuses moving a session to
--    another version, or to general admission, while a tier on it prices a
--    zone of the version it has.
--
-- The zone's own side needs nothing new: a session sells only a published
-- version, and desi_price_zone_frozen already refuses any change to a zone of
-- a published version.
--
-- The tier trigger reads the session row FOR SHARE, which conflicts with the
-- row lock an UPDATE of the session takes. The two writes therefore run one
-- after the other, and whichever runs second sees the first one's committed
-- row. Without the lock, a tier insert and a session move could each check
-- the other's old state and both commit. FOR SHARE is taken only on the
-- authoring writes that set a tier's zone or session, never on a checkout's
-- quantitySold update, so checkout does not wait on it.
--
-- Rollback: DROP INDEX "TicketType_reserved_session_zone_key";
--           DROP TRIGGER desi_ticket_type_zone_matches_session ON "TicketType";
--           DROP FUNCTION desi_ticket_type_zone_matches_session();
--           DROP TRIGGER desi_event_session_map_keeps_tier_zones ON "EventSession";
--           DROP FUNCTION desi_event_session_map_keeps_tier_zones();

CREATE UNIQUE INDEX "TicketType_reserved_session_zone_key"
  ON "TicketType" ("eventSessionId", "priceZoneId")
  WHERE "reserved";

CREATE OR REPLACE FUNCTION desi_ticket_type_zone_matches_session() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  zone_version TEXT;
  session_version TEXT;
BEGIN
  IF NEW."priceZoneId" IS NULL OR NEW."eventSessionId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT "venueMapVersionId" INTO zone_version FROM "PriceZone" WHERE "id" = NEW."priceZoneId";
  SELECT "venueMapVersionId" INTO session_version FROM "EventSession" WHERE "id" = NEW."eventSessionId"
    FOR SHARE;

  IF zone_version IS DISTINCT FROM session_version THEN
    RAISE EXCEPTION
      'ticket type % prices zone % from map version %, but session % sells map version %',
      NEW."id", NEW."priceZoneId", zone_version, NEW."eventSessionId", session_version
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER desi_ticket_type_zone_matches_session
  BEFORE INSERT OR UPDATE OF "priceZoneId", "eventSessionId" ON "TicketType"
  FOR EACH ROW EXECUTE FUNCTION desi_ticket_type_zone_matches_session();

-- BEFORE triggers run after the row lock is taken, so a tier insert holding
-- FOR SHARE on this row has committed by the time this reads "TicketType".
CREATE OR REPLACE FUNCTION desi_event_session_map_keeps_tier_zones() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  stranded_tier TEXT;
  stranded_version TEXT;
BEGIN
  IF NEW."venueMapVersionId" IS NOT DISTINCT FROM OLD."venueMapVersionId" THEN
    RETURN NEW;
  END IF;

  SELECT tt."id", pz."venueMapVersionId" INTO stranded_tier, stranded_version
    FROM "TicketType" tt
    JOIN "PriceZone" pz ON pz."id" = tt."priceZoneId"
   WHERE tt."eventSessionId" = NEW."id"
     AND pz."venueMapVersionId" IS DISTINCT FROM NEW."venueMapVersionId"
   ORDER BY tt."id"
   LIMIT 1;

  IF stranded_tier IS NOT NULL THEN
    RAISE EXCEPTION
      'session % cannot move to map version %: ticket type % prices a zone from map version %',
      NEW."id", COALESCE(NEW."venueMapVersionId", '(general admission)'), stranded_tier,
      stranded_version
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER desi_event_session_map_keeps_tier_zones
  BEFORE UPDATE OF "venueMapVersionId" ON "EventSession"
  FOR EACH ROW EXECUTE FUNCTION desi_event_session_map_keeps_tier_zones();

-- ============================================================================
-- 6. A general-admission capacity is positive
-- ============================================================================
--
-- Rollback: ALTER TABLE "EventSession" DROP CONSTRAINT "event_session_capacity_positive";

ALTER TABLE "EventSession" ADD CONSTRAINT "event_session_capacity_positive"
  CHECK ("capacity" IS NULL OR "capacity" > 0) NOT VALID;
ALTER TABLE "EventSession" VALIDATE CONSTRAINT "event_session_capacity_positive";

-- ============================================================================
-- 7. Event content
-- ============================================================================
--
-- Public by the organiser's choice and distinct from the private contactEmail.
-- Every new column is NULL, so the checks validate instantly.
--
-- Rollback: drop the six constraints below, then the nine columns.

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "directions" TEXT,
ADD COLUMN     "dressCode" TEXT,
ADD COLUMN     "faq" JSONB,
ADD COLUMN     "performers" JSONB,
ADD COLUMN     "publicContactEmail" TEXT,
ADD COLUMN     "publicContactPhone" TEXT,
ADD COLUMN     "runningOrder" JSONB,
ADD COLUMN     "socialLinks" JSONB,
ADD COLUMN     "sponsors" JSONB;

ALTER TABLE "Event" ADD CONSTRAINT "event_faq_shape"
  CHECK ("faq" IS NULL OR (jsonb_typeof("faq") = 'array' AND jsonb_array_length("faq") <= 30));
ALTER TABLE "Event" ADD CONSTRAINT "event_performers_shape"
  CHECK ("performers" IS NULL OR (jsonb_typeof("performers") = 'array' AND jsonb_array_length("performers") <= 64));
ALTER TABLE "Event" ADD CONSTRAINT "event_running_order_shape"
  CHECK ("runningOrder" IS NULL OR (jsonb_typeof("runningOrder") = 'array' AND jsonb_array_length("runningOrder") <= 40));
ALTER TABLE "Event" ADD CONSTRAINT "event_sponsors_shape"
  CHECK ("sponsors" IS NULL OR (jsonb_typeof("sponsors") = 'array' AND jsonb_array_length("sponsors") <= 30));
ALTER TABLE "Event" ADD CONSTRAINT "event_social_links_shape"
  CHECK ("socialLinks" IS NULL OR jsonb_typeof("socialLinks") = 'object');
ALTER TABLE "Event" ADD CONSTRAINT "event_content_text_lengths" CHECK (
  ("dressCode" IS NULL OR char_length("dressCode") <= 500) AND
  ("directions" IS NULL OR char_length("directions") <= 2000) AND
  ("publicContactEmail" IS NULL OR char_length("publicContactEmail") <= 254) AND
  ("publicContactPhone" IS NULL OR char_length("publicContactPhone") <= 24));

-- ============================================================================
-- 8. Backfill performers from the existing line-up
-- ============================================================================
--
-- Names only, billing order kept, capped at 64 (the performers CHECK). An event
-- with no artists keeps NULL. The update never touches "revision", so
-- desi_event_revision_forward has nothing to refuse.

UPDATE "Event" e SET "performers" = sub.list
FROM (
  SELECT ev."id", jsonb_agg(jsonb_build_object('name', t.a) ORDER BY t.ord) AS list
  FROM "Event" ev, unnest(ev."artists") WITH ORDINALITY AS t(a, ord)
  WHERE t.ord <= 64
  GROUP BY ev."id"
) sub
WHERE e."id" = sub."id" AND cardinality(e."artists") > 0;
