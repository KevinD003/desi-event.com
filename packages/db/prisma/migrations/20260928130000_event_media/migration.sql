-- Event pictures: a cover and a gallery, uploaded, sanitised and stored in
-- Postgres, and the end of the external cover address.
--
-- No BEGIN/COMMIT inside: Prisma wraps the file in one transaction (see the
-- 20260922200000_admission_scope_and_method header).
--
-- Rollback (manual):
--   DROP TRIGGER desi_media_gallery_cap ON "MediaAsset"; DROP FUNCTION desi_media_gallery_cap();
--   DROP INDEX "MediaAsset_one_cover_per_event_key"; drop the five media_asset_* CHECKs;
--   DROP TABLE "MediaBlob";
--   ALTER TABLE "MediaAsset" DROP COLUMN "altText", DROP COLUMN "position",
--     DROP COLUMN "moderatedAt", DROP COLUMN "moderatedById", DROP COLUMN "moderationNote";
--   ALTER TABLE "MediaAsset" ALTER COLUMN "kind" TYPE TEXT; DROP TYPE "MediaKind";
--   ALTER TABLE "Event" ADD COLUMN "coverImageUrl" TEXT; (dropped addresses are not restorable)

-- ============================================================================
-- 1. MediaKind, and MediaAsset.kind from free text to the enum
-- ============================================================================
--
-- Converted in place rather than by the drop-and-add `prisma migrate diff`
-- generates, which would discard every existing row's kind. Nothing has ever
-- written MediaAsset, but the guard makes that a checked fact rather than an
-- assumption: a row with any other kind stops the migration, by name.

-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('EVENT_COVER', 'EVENT_GALLERY');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "MediaAsset" WHERE "kind" NOT IN ('EVENT_COVER', 'EVENT_GALLERY')) THEN
    RAISE EXCEPTION 'MediaAsset rows with a kind outside MediaKind exist; classify them before this migration';
  END IF;
END $$;

ALTER TABLE "MediaAsset" ALTER COLUMN "kind" TYPE "MediaKind" USING ("kind"::"MediaKind");

-- ============================================================================
-- 2. New MediaAsset columns: alt text, gallery position, moderation stamp
-- ============================================================================

-- AlterTable
ALTER TABLE "MediaAsset" ADD COLUMN     "altText" TEXT,
ADD COLUMN     "moderatedAt" TIMESTAMP(3),
ADD COLUMN     "moderatedById" TEXT,
ADD COLUMN     "moderationNote" TEXT,
ADD COLUMN     "position" INTEGER;

-- CreateIndex
CREATE INDEX "MediaAsset_eventId_kind_position_idx" ON "MediaAsset"("eventId", "kind", "position");

-- CreateIndex
CREATE INDEX "MediaAsset_moderatedById_idx" ON "MediaAsset"("moderatedById");

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_moderatedById_fkey" FOREIGN KEY ("moderatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- 3. MediaBlob: the bytes, for the Postgres storage adapter
-- ============================================================================

-- CreateTable
CREATE TABLE "MediaBlob" (
    "storageKey" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaBlob_pkey" PRIMARY KEY ("storageKey")
);

-- AddForeignKey
ALTER TABLE "MediaBlob" ADD CONSTRAINT "MediaBlob_storageKey_fkey" FOREIGN KEY ("storageKey") REFERENCES "MediaAsset"("storageKey") ON DELETE CASCADE ON UPDATE CASCADE;

-- JPEG, PNG and WebP are already compressed: keep them out of line, but skip
-- the pglz attempt that would only cost CPU.
ALTER TABLE "MediaBlob" ALTER COLUMN "bytes" SET STORAGE EXTERNAL;

ALTER TABLE "MediaBlob" ADD CONSTRAINT "media_blob_size_matches"
  CHECK ("byteSize" = octet_length("bytes") AND "byteSize" BETWEEN 1 AND 10485760);
ALTER TABLE "MediaBlob" ADD CONSTRAINT "media_blob_checksum_shape"
  CHECK ("checksum" ~ '^[0-9a-f]{64}$');

-- ============================================================================
-- 4. Event-media invariants on MediaAsset
-- ============================================================================

ALTER TABLE "MediaAsset" ADD CONSTRAINT "media_asset_event_media_shape" CHECK (
  "kind" NOT IN ('EVENT_COVER', 'EVENT_GALLERY') OR (
    "ownerType" = 'EVENT' AND "eventId" IS NOT NULL AND "ownerId" = "eventId"
    AND "altText" IS NOT NULL AND char_length(btrim("altText")) BETWEEN 1 AND 300
    AND "contentType" IN ('image/jpeg', 'image/png', 'image/webp')
    AND "width" BETWEEN 1 AND 8000 AND "height" BETWEEN 1 AND 8000
    AND "byteSize" <= 10485760
    AND "checksum" ~ '^[0-9a-f]{64}$'));
ALTER TABLE "MediaAsset" ADD CONSTRAINT "media_asset_position_by_kind" CHECK (
  ("kind" = 'EVENT_COVER' AND "position" IS NULL)
  OR ("kind" = 'EVENT_GALLERY' AND "position" BETWEEN 0 AND 7));
ALTER TABLE "MediaAsset" ADD CONSTRAINT "media_asset_approved_is_servable" CHECK (
  "moderationStatus" <> 'APPROVED' OR ("sanitisedAt" IS NOT NULL AND "scanStatus" = 'CLEAN'));
ALTER TABLE "MediaAsset" ADD CONSTRAINT "media_asset_rejection_has_note" CHECK (
  "moderationStatus" <> 'REJECTED' OR "moderationNote" IS NOT NULL);
ALTER TABLE "MediaAsset" ADD CONSTRAINT "media_asset_decision_is_stamped" CHECK (
  "moderationStatus" = 'PENDING' OR "moderatedAt" IS NOT NULL);

-- One cover per event. Partial, so Prisma's schema language cannot express it
-- (precedent: PrivacyRequest_one_in_flight_per_subject_key); schema.prisma
-- carries a comment above model MediaAsset pointing here.
CREATE UNIQUE INDEX "MediaAsset_one_cover_per_event_key"
  ON "MediaAsset" ("eventId")
  WHERE "kind" = 'EVENT_COVER';

-- The gallery cap, serialised on the event row so two parallel inserts cannot
-- both see seven. There is deliberately no unique index on position: a
-- reorder collides transiently, and a partial index cannot be deferred.
--
-- The lock is FOR NO KEY UPDATE, the same lock authorChange's revision UPDATE
-- takes on the event row. It conflicts with itself, so two gallery inserts
-- still take turns, and the second recount sees the first one's committed
-- row. It does not conflict with FOR KEY SHARE, which every foreign-key
-- insert takes on the referenced event (Order, EventSession, TicketType), so
-- a checkout never waits behind an upload. FOR UPDATE would block those
-- inserts for as long as the upload's transaction stays open.
CREATE OR REPLACE FUNCTION desi_media_gallery_cap() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  existing INTEGER;
BEGIN
  IF NEW."kind" <> 'EVENT_GALLERY' THEN
    RETURN NEW;
  END IF;

  PERFORM 1 FROM "Event" WHERE "id" = NEW."eventId" FOR NO KEY UPDATE;

  SELECT count(*) INTO existing FROM "MediaAsset"
   WHERE "eventId" = NEW."eventId" AND "kind" = 'EVENT_GALLERY' AND "id" <> NEW."id";

  IF existing >= 8 THEN
    RAISE EXCEPTION 'event % already has 8 gallery pictures', NEW."eventId"
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER desi_media_gallery_cap
  BEFORE INSERT OR UPDATE OF "kind", "eventId" ON "MediaAsset"
  FOR EACH ROW EXECUTE FUNCTION desi_media_gallery_cap();

-- ============================================================================
-- 5. Drop the external cover address
-- ============================================================================
--
-- Never rendered on a public page; the editor preview made the organiser's
-- browser fetch an arbitrary third-party URL. Not migrated to uploads:
-- fetching third-party bytes inside a migration is the behaviour being
-- removed.
--
-- What went is kept, one audit row per event that had an address, written
-- before the column is dropped and in the same transaction: action
-- `event.cover_address_dropped`, entity the event, no actor (the migration did
-- it), metadata { organizationId, coverImageUrl, migration }. Not a NOTICE:
-- `prisma migrate deploy` prints none, so a count said that way reached nobody.
-- Find them with
--   SELECT "entityId", "metadata" FROM "AuditLog"
--    WHERE "action" = 'event.cover_address_dropped';
--
-- The address is kept without any user name, password, query string or
-- fragment: that is where a signed or credentialed link carries its secret,
-- and a secret does not belong in an append-only table. Scheme, host and path
-- are enough to find the picture again. At most 2048 characters.
--
-- The id is derived from the event's, so it is stable and cannot collide.

INSERT INTO "AuditLog" ("id", "actorId", "action", "entityType", "entityId", "metadata", "createdAt")
SELECT
  'c' || substr(md5("id" || ':cover-address-dropped'), 1, 24),
  NULL,
  'event.cover_address_dropped',
  'Event',
  "id",
  jsonb_build_object(
    'organizationId', "organizationId",
    'coverImageUrl', left(
      regexp_replace(
        regexp_replace("coverImageUrl", '[?#].*$', ''),
        '^([A-Za-z][A-Za-z0-9+.-]*://)[^/@]*@', '\1'),
      2048),
    'migration', '20260928130000_event_media'
  ),
  now()
FROM "Event"
WHERE "coverImageUrl" IS NOT NULL;

-- AlterTable
ALTER TABLE "Event" DROP COLUMN "coverImageUrl";
