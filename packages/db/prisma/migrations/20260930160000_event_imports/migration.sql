-- Events imported from another site (Sulekha), by the Desi-Event team.
--
-- Imported events belong to one platform-held organisation per source
-- ("Sulekha Events"), which has no members and takes no team invitations: the
-- trigger below refuses both, so nobody can come to run those events except by
-- an administrator moving an event to the organiser's own organisation. The
-- three import tables record each upload and its plan, where every imported
-- event came from, and each listed picture.
--
-- No BEGIN/COMMIT inside: Prisma wraps the file in one transaction (see
-- verify-populated-upgrade.mjs). PL/pgSQL per ADR 0004. No existing row is
-- changed: every organisation keeps a null platformHeldSource and every night
-- an end time that was listed.
--
-- Rollback (manual, in order):
--   DROP TRIGGER desi_platform_held_has_no_members ON "Invitation";
--   DROP TRIGGER desi_platform_held_has_no_members ON "Membership";
--   DROP FUNCTION desi_platform_held_has_no_members();
--   DROP TABLE "EventImportImage"; DROP TABLE "EventImportItem"; DROP TABLE "EventImportRun";
--   ALTER TABLE "EventSession" DROP COLUMN "endTimeListed";
--   DROP INDEX "Organization_platformHeldSource_key";
--   ALTER TABLE "Organization" DROP COLUMN "platformHeldSource";
--   DROP TYPE "EventImportImageRole"; DROP TYPE "EventImportImageStatus";
--   DROP TYPE "EventImportRunStatus"; DROP TYPE "EventImportSource";

-- ============================================================================
-- 1. Enums
-- ============================================================================

-- CreateEnum
CREATE TYPE "EventImportSource" AS ENUM ('SULEKHA');

-- CreateEnum
CREATE TYPE "EventImportRunStatus" AS ENUM ('PREVIEWED', 'APPLIED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "EventImportImageStatus" AS ENUM ('WAITING', 'STORED', 'FAILED');

-- CreateEnum
CREATE TYPE "EventImportImageRole" AS ENUM ('COVER', 'GALLERY');

-- ============================================================================
-- 2. The platform-held organisation, and nights with no listed end
-- ============================================================================

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "platformHeldSource" "EventImportSource";

-- One organisation per source.
-- CreateIndex
CREATE UNIQUE INDEX "Organization_platformHeldSource_key" ON "Organization"("platformHeldSource");

-- False when the source listed no end time, so "endsAt" (the night's and the
-- event's, both NOT NULL) is a planning estimate no public page shows.
-- AlterTable
ALTER TABLE "EventSession" ADD COLUMN     "endTimeListed" BOOLEAN NOT NULL DEFAULT true;

-- ============================================================================
-- 3. Import runs
-- ============================================================================

-- CreateTable
CREATE TABLE "EventImportRun" (
    "id" TEXT NOT NULL,
    "source" "EventImportSource" NOT NULL,
    "status" "EventImportRunStatus" NOT NULL DEFAULT 'PREVIEWED',
    "fileName" TEXT NOT NULL,
    "datasetSha256" TEXT NOT NULL,
    "dataset" JSONB NOT NULL,
    "plan" JSONB NOT NULL,
    "planDigest" TEXT NOT NULL,
    "eventCount" INTEGER NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "appliedAt" TIMESTAMP(3),
    "appliedById" TEXT,
    "summary" JSONB,

    CONSTRAINT "EventImportRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventImportRun_createdAt_idx" ON "EventImportRun"("createdAt");

-- CreateIndex
CREATE INDEX "EventImportRun_createdById_idx" ON "EventImportRun"("createdById");

-- CreateIndex
CREATE INDEX "EventImportRun_appliedById_idx" ON "EventImportRun"("appliedById");

-- AddForeignKey
ALTER TABLE "EventImportRun" ADD CONSTRAINT "EventImportRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventImportRun" ADD CONSTRAINT "EventImportRun_appliedById_fkey" FOREIGN KEY ("appliedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EventImportRun" ADD CONSTRAINT "event_import_run_shape" CHECK (
  "datasetSha256" ~ '^[0-9a-f]{64}$'
  AND "planDigest" ~ '^[0-9a-f]{64}$'
  AND char_length("fileName") BETWEEN 1 AND 200
  AND "eventCount" BETWEEN 1 AND 500
  AND "expiresAt" > "createdAt"
  AND ("status" <> 'APPLIED' OR "appliedAt" IS NOT NULL)
  AND octet_length("dataset"::text) <= 2097152
);

-- ============================================================================
-- 4. Imported events
-- ============================================================================

-- CreateTable
CREATE TABLE "EventImportItem" (
    "id" TEXT NOT NULL,
    "source" "EventImportSource" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "lastRunId" TEXT,
    "importedById" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scrapedAt" TIMESTAMP(3) NOT NULL,
    "presentedBy" TEXT,
    "prices" JSONB NOT NULL DEFAULT '[]',
    "priceText" TEXT,
    "importNotes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "reassignedAt" TIMESTAMP(3),
    "reassignedById" TEXT,
    "reassignedFromOrganizationId" TEXT,
    "reassignedToOrganizationId" TEXT,

    CONSTRAINT "EventImportItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EventImportItem_eventId_key" ON "EventImportItem"("eventId");

-- CreateIndex
CREATE INDEX "EventImportItem_lastRunId_idx" ON "EventImportItem"("lastRunId");

-- CreateIndex
CREATE INDEX "EventImportItem_importedById_idx" ON "EventImportItem"("importedById");

-- CreateIndex
CREATE INDEX "EventImportItem_approvedById_idx" ON "EventImportItem"("approvedById");

-- CreateIndex
CREATE INDEX "EventImportItem_reassignedById_idx" ON "EventImportItem"("reassignedById");

-- CreateIndex
CREATE INDEX "EventImportItem_reassignedFromOrganizationId_idx" ON "EventImportItem"("reassignedFromOrganizationId");

-- CreateIndex
CREATE INDEX "EventImportItem_reassignedToOrganizationId_idx" ON "EventImportItem"("reassignedToOrganizationId");

-- A re-import of the same listing updates its event rather than duplicating it.
-- CreateIndex
CREATE UNIQUE INDEX "EventImportItem_source_sourceId_key" ON "EventImportItem"("source", "sourceId");

-- AddForeignKey
ALTER TABLE "EventImportItem" ADD CONSTRAINT "EventImportItem_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventImportItem" ADD CONSTRAINT "EventImportItem_lastRunId_fkey" FOREIGN KEY ("lastRunId") REFERENCES "EventImportRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventImportItem" ADD CONSTRAINT "EventImportItem_importedById_fkey" FOREIGN KEY ("importedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventImportItem" ADD CONSTRAINT "EventImportItem_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventImportItem" ADD CONSTRAINT "EventImportItem_reassignedById_fkey" FOREIGN KEY ("reassignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventImportItem" ADD CONSTRAINT "EventImportItem_reassignedFromOrganizationId_fkey" FOREIGN KEY ("reassignedFromOrganizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventImportItem" ADD CONSTRAINT "EventImportItem_reassignedToOrganizationId_fkey" FOREIGN KEY ("reassignedToOrganizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The prices check reads the array's length only once it is known to be an
-- array: a CHECK's AND does not promise to stop early, and the length of a
-- non-array is an error rather than a refusal.
ALTER TABLE "EventImportItem" ADD CONSTRAINT "event_import_item_shape" CHECK (
  "sourceId" ~ '^[0-9]{1,12}$'
  AND "sourceUrl" ~ '^https://'
  AND char_length("sourceUrl") <= 2048
  AND ("presentedBy" IS NULL OR char_length("presentedBy") <= 200)
  AND ("priceText" IS NULL OR char_length("priceText") <= 200)
  AND CASE
    WHEN jsonb_typeof("prices") = 'array' THEN jsonb_array_length("prices") <= 20
    ELSE false
  END
  AND cardinality("importNotes") <= 20
  AND ("approvedById" IS NULL OR "approvedAt" IS NOT NULL)
  AND ("reassignedToOrganizationId" IS NULL OR "reassignedAt" IS NOT NULL)
);

-- ============================================================================
-- 5. Pictures the source listed
-- ============================================================================
--
-- There is deliberately no coupling between STORED and "mediaAssetId": the
-- organiser may remove the picture later, and SET NULL must not violate a CHECK.

-- CreateTable
CREATE TABLE "EventImportImage" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "role" "EventImportImageRole" NOT NULL,
    "alt" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "status" "EventImportImageStatus" NOT NULL DEFAULT 'WAITING',
    "failureCode" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastTriedAt" TIMESTAMP(3),
    "mediaAssetId" TEXT,

    CONSTRAINT "EventImportImage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventImportImage_mediaAssetId_idx" ON "EventImportImage"("mediaAssetId");

-- CreateIndex
CREATE UNIQUE INDEX "EventImportImage_itemId_url_key" ON "EventImportImage"("itemId", "url");

-- AddForeignKey
ALTER TABLE "EventImportImage" ADD CONSTRAINT "EventImportImage_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "EventImportItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventImportImage" ADD CONSTRAINT "EventImportImage_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EventImportImage" ADD CONSTRAINT "event_import_image_shape" CHECK (
  "url" ~ '^https://'
  AND char_length("url") <= 2048
  AND char_length(btrim("alt")) BETWEEN 1 AND 300
  AND "position" >= 0
  AND "attempts" >= 0
  AND ("status" <> 'FAILED' OR "failureCode" IS NOT NULL)
);

-- ============================================================================
-- 6. The platform-held organisation has no members
-- ============================================================================
--
-- Fired on a new membership or team invitation, and on one moved to another
-- organisation. The API maps the refusal (23514, constraint
-- platform_held_organization_has_no_members, also written into the message) to
-- 409 PLATFORM_HELD_ORGANIZATION.
CREATE OR REPLACE FUNCTION desi_platform_held_has_no_members() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  held "EventImportSource";
BEGIN
  SELECT "platformHeldSource" INTO held FROM "Organization" WHERE "id" = NEW."organizationId";

  IF held IS NOT NULL THEN
    RAISE EXCEPTION 'organisation % holds imported events for the Desi-Event team and has no members (platform_held_organization_has_no_members)',
      NEW."organizationId"
      USING ERRCODE = '23514', CONSTRAINT = 'platform_held_organization_has_no_members';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER desi_platform_held_has_no_members
  BEFORE INSERT OR UPDATE OF "organizationId" ON "Membership"
  FOR EACH ROW EXECUTE FUNCTION desi_platform_held_has_no_members();

CREATE TRIGGER desi_platform_held_has_no_members
  BEFORE INSERT OR UPDATE OF "organizationId" ON "Invitation"
  FOR EACH ROW EXECUTE FUNCTION desi_platform_held_has_no_members();
