-- Imported events are sold on The Desi Events, and nothing links, redirects or
-- connects to the site their listings came from (the owner, 2026-10-15: "Make
-- sure that the links are not redirected or directed to [that] website or
-- anything. There should be no connection"; asked about copying pictures once:
-- "No contact at all").
--
-- 1. Ticket types an import makes. Each listed price becomes a ticket type
--    (`apps/api/src/lib/event-import.js`). `importKey` names the price it was
--    made from, so a re-import finds it again however an administrator renamed
--    it: unique per event among the tiers that have one. `quantityIsAllowance`
--    says its quantity is the import's allowance (100), not the organiser's
--    count, so no page shows "tickets left" from it.
-- 2. Every imported event's website link to that site is switched off and its
--    address cleared: the decided address (what the public link and the
--    redirect used) and the current address (what waited for a decision), each
--    only when its host is on that site. The redirect's switch, decision time,
--    decider and reason go with the decided address, so the event reads as
--    having no link rather than as one an administrator turned off. Its
--    revision moves on, so an editor open on the old address must reload.
--    Events nobody imported are not touched here; the address rule refuses that
--    site for every event from this build on (`websiteUrlProblem`).
-- 3. The import record keeps the source's own id only: its link to the listing
--    (`EventImportItem.sourceUrl`) is dropped, and its CHECK rewritten without it.
-- 4. Nothing is copied from the source any more, so the table of its pictures
--    and their addresses goes, with its two enums. Pictures already copied stay
--    where they are, ordinary pictures of their events (`MediaAsset`).
-- 5. The datasets runs stored lose the same addresses: the source site, its
--    picture hosts and name, and each listing's link, ticket link and pictures.
--    `datasetSha256` still names the file as it was uploaded.
-- 6. A venue an import wrote says so in words that name no site: its
--    provenance `import:sulekha` becomes `import:listing`, which the importer
--    writes from this build on (the public venue page carries the provenance).
--
-- Audit rows are history and are left as they were written.
--
-- Idempotent in effect: a second run of steps 2, 5 and 6 finds nothing to change.
-- No BEGIN/COMMIT inside: Prisma wraps the file in one transaction.
--
-- Rollback (manual, in order; steps 2, 3's data and 4's rows are not restorable):
--   DROP INDEX "TicketType_eventId_importKey_key";
--   ALTER TABLE "TicketType" DROP CONSTRAINT "ticket_type_import_key_shape";
--   ALTER TABLE "TicketType" DROP COLUMN "importKey", DROP COLUMN "quantityIsAllowance";
--   ALTER TABLE "EventImportItem" ADD COLUMN "sourceUrl" TEXT; (then restore the old CHECK)
--   and re-create "EventImportImage" with its enums from 20260930160000_event_imports.

-- ============================================================================
-- 1. Ticket types an import makes
-- ============================================================================

-- AlterTable
ALTER TABLE "TicketType" ADD COLUMN     "importKey" TEXT,
ADD COLUMN     "quantityIsAllowance" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "TicketType" ADD CONSTRAINT "ticket_type_import_key_shape" CHECK (
  "importKey" IS NULL OR char_length(btrim("importKey")) BETWEEN 1 AND 120
);

CREATE UNIQUE INDEX "TicketType_eventId_importKey_key"
  ON "TicketType" ("eventId", "importKey")
  WHERE "importKey" IS NOT NULL;

-- ============================================================================
-- 2. No imported event links to the source's site
-- ============================================================================
--
-- A stored address is `new URL(...).href` (CHECK event_website_url_shape), so
-- its host is the lower-case text between "https://" and the first "/". The
-- pattern is the API's `RETIRED_SOURCE_HOST`: that site's name under any
-- top-level domain, and any name beneath it.

UPDATE "Event" AS e
SET
  "websiteRedirectEnabled" = CASE WHEN f.decided THEN false ELSE e."websiteRedirectEnabled" END,
  "websiteDecidedUrl" = CASE WHEN f.decided THEN NULL ELSE e."websiteDecidedUrl" END,
  "websiteRedirectChangedAt" = CASE WHEN f.decided THEN NULL ELSE e."websiteRedirectChangedAt" END,
  "websiteRedirectChangedById" = CASE WHEN f.decided THEN NULL ELSE e."websiteRedirectChangedById" END,
  "websiteRedirectReason" = CASE WHEN f.decided THEN NULL ELSE e."websiteRedirectReason" END,
  -- Named in every row, so trigger desi_event_website_change recomputes
  -- whether a decision waits (and since when) from what is left.
  "websiteUrl" = CASE WHEN f.current THEN NULL ELSE e."websiteUrl" END,
  "revision" = e."revision" + 1,
  "updatedAt" = CURRENT_TIMESTAMP
FROM (
  SELECT
    ev."id",
    COALESCE(substring(ev."websiteDecidedUrl" FROM '^https://([^/]+)/') ~* '(^|\.)sulekha\.[a-z]{2,63}(\.[a-z]{2,63})?$', false) AS decided,
    COALESCE(substring(ev."websiteUrl" FROM '^https://([^/]+)/') ~* '(^|\.)sulekha\.[a-z]{2,63}(\.[a-z]{2,63})?$', false) AS current
  FROM "Event" AS ev
  WHERE EXISTS (SELECT 1 FROM "EventImportItem" AS i WHERE i."eventId" = ev."id")
) AS f
WHERE e."id" = f."id" AND (f.decided OR f.current);

-- ============================================================================
-- 3. The import record keeps the source's id, not its address
-- ============================================================================

ALTER TABLE "EventImportItem" DROP CONSTRAINT "event_import_item_shape";

-- AlterTable
ALTER TABLE "EventImportItem" DROP COLUMN "sourceUrl";

-- The prices check reads the array's length only once it is known to be an
-- array, as before.
ALTER TABLE "EventImportItem" ADD CONSTRAINT "event_import_item_shape" CHECK (
  "sourceId" ~ '^[0-9]{1,12}$'
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
-- 4. Nothing is copied from the source
-- ============================================================================

-- DropForeignKey
ALTER TABLE "EventImportImage" DROP CONSTRAINT "EventImportImage_itemId_fkey";

-- DropForeignKey
ALTER TABLE "EventImportImage" DROP CONSTRAINT "EventImportImage_mediaAssetId_fkey";

-- DropTable
DROP TABLE "EventImportImage";

-- DropEnum
DROP TYPE "EventImportImageRole";

-- DropEnum
DROP TYPE "EventImportImageStatus";

-- ============================================================================
-- 5. Stored datasets keep no address on the source's site
-- ============================================================================
--
-- `jsonb - text` removes a key that is there and ignores one that is not.

UPDATE "EventImportRun" AS r
SET "dataset" = (r."dataset" - 'sourceName' - 'sourceSite' - 'imageHosts')
  || jsonb_build_object(
    'events',
    COALESCE(
      (
        SELECT jsonb_agg(
          CASE
            WHEN jsonb_typeof(listing) = 'object' THEN listing - 'sourceUrl' - 'ticketUrl' - 'images'
            ELSE listing
          END
          ORDER BY position
        )
        FROM jsonb_array_elements(r."dataset" -> 'events') WITH ORDINALITY AS t(listing, position)
      ),
      '[]'::jsonb
    )
  )
WHERE jsonb_typeof(r."dataset" -> 'events') = 'array'
  AND (
    r."dataset" ?| ARRAY['sourceName', 'sourceSite', 'imageHosts']
    OR EXISTS (
      SELECT 1
      FROM jsonb_array_elements(r."dataset" -> 'events') AS u(listing)
      WHERE jsonb_typeof(listing) = 'object' AND listing ?| ARRAY['sourceUrl', 'ticketUrl', 'images']
    )
  );

-- ============================================================================
-- 6. An imported venue's provenance names no site
-- ============================================================================

UPDATE "Venue" SET "provenance" = 'import:listing', "updatedAt" = CURRENT_TIMESTAMP
WHERE "provenance" = 'import:sulekha';
