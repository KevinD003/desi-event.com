-- Full control of posted events: deletion and restore, cancelled nights,
-- replacement covers waiting for review, platform edit sittings and the
-- change notices ticket holders read.
--
-- No BEGIN/COMMIT inside: Prisma wraps the file in one transaction (see
-- verify-populated-upgrade.mjs). PL/pgSQL per ADR 0004. Every trigger raising
-- 23514 also writes its constraint name into the message, because the driver
-- adapter passes on the SQLSTATE and the message but not the constraint field.
--
-- Rollback (manual, in order):
--   DROP TABLE "EventChangeNotice"; DROP TABLE "EventPlatformEdit";
--   DROP TRIGGER desi_media_replacement_matches ON "MediaAsset";
--   DROP FUNCTION desi_media_replacement_matches();
--   ALTER TABLE "MediaAsset" DROP CONSTRAINT "media_asset_replacement_shape";
--   DELETE FROM "MediaAsset" WHERE "replacesMediaId" IS NOT NULL;
--   DROP INDEX "MediaAsset_one_current_cover_per_event_key";
--   CREATE UNIQUE INDEX "MediaAsset_one_cover_per_event_key" ON "MediaAsset" ("eventId")
--     WHERE "kind" = 'EVENT_COVER';
--   ALTER TABLE "MediaAsset" DROP CONSTRAINT "MediaAsset_replacesMediaId_fkey";
--   DROP INDEX "MediaAsset_replacesMediaId_key"; ALTER TABLE "MediaAsset" DROP COLUMN "replacesMediaId";
--   DROP TRIGGER desi_event_session_cancel_is_final ON "EventSession";
--   DROP FUNCTION desi_event_session_cancel_is_final();
--   ALTER TABLE "EventSession" DROP CONSTRAINT "event_session_cancellation_stamped",
--     DROP COLUMN "cancelledAt", DROP COLUMN "cancellationReason";
--   Restore desi_event_status_requires_review() to the body in
--     20260930100000_organiser_invitations_and_review_gate.
--   DROP TRIGGER desi_event_deletion_moves ON "Event"; DROP FUNCTION desi_event_deletion_moves();
--   (Restore or remove every DELETED event first.)
--   ALTER TABLE "Event" DROP CONSTRAINT "event_deletion_consistency";
--   DROP INDEX "Event_deleted_idx"; DROP INDEX "Event_deletedById_idx";
--   ALTER TABLE "Event" DROP CONSTRAINT "Event_deletedById_fkey";
--   ALTER TABLE "Event" DROP COLUMN "deletedAt", DROP COLUMN "deletedById",
--     DROP COLUMN "deletionReason", DROP COLUMN "deletionOutcome",
--     DROP COLUMN "deletionAuthority", DROP COLUMN "statusBeforeDeletion",
--     DROP COLUMN "deletedSlug";
--   DROP FUNCTION desi_event_restore_target("EventStatus");
--   DROP TYPE "PlatformEditEnd"; DROP TYPE "EventChangeKind";
--   DROP TYPE "EventAuthority"; DROP TYPE "EventDeletionOutcome";

-- ============================================================================
-- 1. Enums
-- ============================================================================

-- CreateEnum
CREATE TYPE "EventDeletionOutcome" AS ENUM ('REMOVED', 'CANCELLED_AND_REFUNDED', 'REMOVED_AFTER_EVENT');

-- CreateEnum
CREATE TYPE "EventAuthority" AS ENUM ('ORGANIZATION', 'PLATFORM');

-- CreateEnum
CREATE TYPE "EventChangeKind" AS ENUM ('MATERIAL_CHANGE', 'SESSION_CHANGE', 'RESCHEDULED', 'POSTPONED', 'CANCELLED', 'SESSION_CANCELLED', 'DELETED');

-- CreateEnum
CREATE TYPE "PlatformEditEnd" AS ENUM ('CLOSED', 'SUPERSEDED', 'EVENT_DELETED', 'EXPIRED');

-- ============================================================================
-- 2. Where a restore lands
-- ============================================================================
--
-- One function, used by both triggers below, so the deletion guard and the
-- review gate cannot disagree. It equals `restoreTarget` in
-- `@desi-event/schemas/lifecycle` (a test pins the two equal):
--   - REVIEW_PENDING and APPROVED come back as DRAFT: a review decision was
--     about a version that was then deleted, and only a review approves;
--   - ON_SALE and SOLD_OUT come back as SALES_PAUSED: the organiser decides
--     when to sell again;
--   - anything else comes back as it was.
CREATE OR REPLACE FUNCTION desi_event_restore_target(prior "EventStatus") RETURNS "EventStatus"
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN prior IN ('REVIEW_PENDING'::"EventStatus", 'APPROVED'::"EventStatus") THEN 'DRAFT'::"EventStatus"
    WHEN prior IN ('ON_SALE'::"EventStatus", 'SOLD_OUT'::"EventStatus") THEN 'SALES_PAUSED'::"EventStatus"
    ELSE prior
  END
$$;

-- ============================================================================
-- 3. Event deletion
-- ============================================================================

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedById" TEXT,
ADD COLUMN     "deletedSlug" TEXT,
ADD COLUMN     "deletionAuthority" "EventAuthority",
ADD COLUMN     "deletionOutcome" "EventDeletionOutcome",
ADD COLUMN     "deletionReason" TEXT,
ADD COLUMN     "statusBeforeDeletion" "EventStatus";

-- CreateIndex
CREATE INDEX "Event_deletedById_idx" ON "Event"("deletedById");

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The platform's list of deleted events. Partial, so Prisma's schema language
-- cannot express it; schema.prisma carries a comment above model Event.
CREATE INDEX "Event_deleted_idx" ON "Event" ("deletedAt") WHERE "status" = 'DELETED';

-- The deletion columns are set together with status DELETED and cleared
-- together when the event leaves it. Only an event that was cancelled (with its
-- refunds) can have been deleted as CANCELLED_AND_REFUNDED.
ALTER TABLE "Event" ADD CONSTRAINT "event_deletion_consistency" CHECK (
  (
    "status" = 'DELETED'
    AND "deletedAt" IS NOT NULL
    AND "statusBeforeDeletion" IS NOT NULL
    AND "statusBeforeDeletion" <> 'DELETED'
    AND "deletionOutcome" IS NOT NULL
    AND "deletionAuthority" IS NOT NULL
    AND "deletionReason" IS NOT NULL
    AND char_length(btrim("deletionReason")) BETWEEN 10 AND 500
    AND ("deletionOutcome" <> 'CANCELLED_AND_REFUNDED' OR "statusBeforeDeletion" = 'CANCELLED')
  )
  OR (
    "status" <> 'DELETED'
    AND "deletedAt" IS NULL AND "deletedById" IS NULL AND "deletionReason" IS NULL
    AND "deletionOutcome" IS NULL AND "deletionAuthority" IS NULL
    AND "statusBeforeDeletion" IS NULL AND "deletedSlug" IS NULL
  )
);

-- Entering DELETED records the status the row really had; while DELETED that
-- record cannot be rewritten; leaving DELETED goes only to
-- desi_event_restore_target(statusBeforeDeletion). This is what lets the
-- review gate below trust statusBeforeDeletion.
CREATE OR REPLACE FUNCTION desi_event_deletion_moves() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target "EventStatus";
BEGIN
  IF NEW."status" = 'DELETED' AND OLD."status" <> 'DELETED' THEN
    IF NEW."statusBeforeDeletion" IS DISTINCT FROM OLD."status" THEN
      RAISE EXCEPTION 'event % must record % as its status before deletion (event_deletion_records_prior_status)',
        OLD."id", OLD."status"
        USING ERRCODE = '23514', CONSTRAINT = 'event_deletion_records_prior_status';
    END IF;
  ELSIF OLD."status" = 'DELETED' AND NEW."status" = 'DELETED' THEN
    IF NEW."statusBeforeDeletion" IS DISTINCT FROM OLD."statusBeforeDeletion" THEN
      RAISE EXCEPTION 'event % is deleted; its prior status cannot change (event_deletion_records_prior_status)',
        OLD."id"
        USING ERRCODE = '23514', CONSTRAINT = 'event_deletion_records_prior_status';
    END IF;
  ELSIF OLD."status" = 'DELETED' THEN
    target := desi_event_restore_target(OLD."statusBeforeDeletion");

    IF NEW."status" IS DISTINCT FROM target THEN
      RAISE EXCEPTION 'event % can only be restored to %, not % (event_restore_returns_prior_status)',
        OLD."id", target, NEW."status"
        USING ERRCODE = '23514', CONSTRAINT = 'event_restore_returns_prior_status';
    END IF;
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER desi_event_deletion_moves
  BEFORE UPDATE ON "Event"
  FOR EACH ROW EXECUTE FUNCTION desi_event_deletion_moves();

-- P-16's review gate (20260930100000_organiser_invitations_and_review_gate),
-- clauses (a) and (b) unchanged, with one addition to (b): a restore to the
-- restore target of the status the event had when it was deleted is not a move
-- into public without review (the trigger above makes statusBeforeDeletion the
-- status it genuinely had, and fixed while DELETED). An event deleted while on
-- sale comes back paused, never on sale. The trigger itself is unchanged.
CREATE OR REPLACE FUNCTION desi_event_status_requires_review() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  public_statuses CONSTANT "EventStatus"[] := ARRAY[
    'PUBLISHED', 'ON_SALE', 'SALES_PAUSED', 'SOLD_OUT', 'COMPLETED', 'POSTPONED', 'CANCELLED'
  ]::"EventStatus"[];
BEGIN
  IF NEW."status" = 'APPROVED' AND OLD."status" <> 'REVIEW_PENDING' THEN
    RAISE EXCEPTION 'event % cannot become APPROVED from %: only a review decision approves (event_public_requires_review)',
      NEW."id", OLD."status"
      USING ERRCODE = '23514', CONSTRAINT = 'event_public_requires_review';
  END IF;

  IF NEW."status" = ANY (public_statuses)
     AND NOT (OLD."status" = ANY (public_statuses))
     AND OLD."status" <> 'APPROVED'
     AND NOT (OLD."status" = 'DELETED' AND OLD."statusBeforeDeletion" IS NOT NULL AND NEW."status" = desi_event_restore_target(OLD."statusBeforeDeletion")) THEN
    RAISE EXCEPTION 'event % cannot become % from %: it has not been approved (event_public_requires_review)',
      NEW."id", NEW."status", OLD."status"
      USING ERRCODE = '23514', CONSTRAINT = 'event_public_requires_review';
  END IF;

  RETURN NEW;
END
$$;

-- ============================================================================
-- 4. Cancelled nights
-- ============================================================================

-- AlterTable
ALTER TABLE "EventSession" ADD COLUMN     "cancellationReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3);

-- A night cancelled before this migration has no stamp; the last time its row
-- changed is the best record of when.
UPDATE "EventSession" SET "cancelledAt" = "updatedAt"
  WHERE "status" = 'CANCELLED' AND "cancelledAt" IS NULL;

ALTER TABLE "EventSession" ADD CONSTRAINT "event_session_cancellation_stamped" CHECK (
  ("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL)
  AND ("cancellationReason" IS NULL OR char_length(btrim("cancellationReason")) BETWEEN 1 AND 500)
);

CREATE OR REPLACE FUNCTION desi_event_session_cancel_is_final() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" = 'CANCELLED' AND NEW."status" <> 'CANCELLED' THEN
    RAISE EXCEPTION 'session % was cancelled; a cancelled night does not come back (event_session_cancellation_final)',
      OLD."id"
      USING ERRCODE = '23514', CONSTRAINT = 'event_session_cancellation_final';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER desi_event_session_cancel_is_final
  BEFORE UPDATE OF "status" ON "EventSession"
  FOR EACH ROW EXECUTE FUNCTION desi_event_session_cancel_is_final();

-- ============================================================================
-- 5. Replacement covers
-- ============================================================================

-- AlterTable
ALTER TABLE "MediaAsset" ADD COLUMN     "replacesMediaId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "MediaAsset_replacesMediaId_key" ON "MediaAsset"("replacesMediaId");

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_replacesMediaId_fkey" FOREIGN KEY ("replacesMediaId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One *current* cover per event; a waiting replacement is the second row.
DROP INDEX "MediaAsset_one_cover_per_event_key";
CREATE UNIQUE INDEX "MediaAsset_one_current_cover_per_event_key"
  ON "MediaAsset" ("eventId")
  WHERE "kind" = 'EVENT_COVER' AND "replacesMediaId" IS NULL;

-- A replacement is a cover and is never approved while it still points at the
-- old one: approval deletes the old cover first (which clears the pointer by
-- SET NULL) and only then approves, so no two approved covers ever coexist.
ALTER TABLE "MediaAsset" ADD CONSTRAINT "media_asset_replacement_shape" CHECK (
  "replacesMediaId" IS NULL
  OR ("kind" = 'EVENT_COVER' AND "moderationStatus" <> 'APPROVED' AND "replacesMediaId" <> "id")
);

CREATE OR REPLACE FUNCTION desi_media_replacement_matches() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  replaced_event TEXT;
  replaced_kind "MediaKind";
  replaced_pointer TEXT;
BEGIN
  IF NEW."replacesMediaId" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT "eventId", "kind", "replacesMediaId"
    INTO replaced_event, replaced_kind, replaced_pointer
    FROM "MediaAsset" WHERE "id" = NEW."replacesMediaId";

  IF replaced_event IS DISTINCT FROM NEW."eventId"
     OR replaced_kind IS DISTINCT FROM 'EVENT_COVER'
     OR replaced_pointer IS NOT NULL THEN
    RAISE EXCEPTION 'picture % can only replace the current cover of its own event (media_asset_replacement_matches)',
      NEW."id"
      USING ERRCODE = '23514', CONSTRAINT = 'media_asset_replacement_matches';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER desi_media_replacement_matches
  BEFORE INSERT OR UPDATE OF "replacesMediaId", "eventId", "kind" ON "MediaAsset"
  FOR EACH ROW EXECUTE FUNCTION desi_media_replacement_matches();

-- ============================================================================
-- 6. Platform edit sittings
-- ============================================================================

-- CreateTable
CREATE TABLE "EventPlatformEdit" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "actorId" TEXT,
    "sessionId" TEXT,
    "reason" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "endedBy" "PlatformEditEnd",

    CONSTRAINT "EventPlatformEdit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventPlatformEdit_eventId_openedAt_idx" ON "EventPlatformEdit"("eventId", "openedAt");

-- CreateIndex
CREATE INDEX "EventPlatformEdit_actorId_idx" ON "EventPlatformEdit"("actorId");

-- CreateIndex
CREATE INDEX "EventPlatformEdit_sessionId_idx" ON "EventPlatformEdit"("sessionId");

-- AddForeignKey
ALTER TABLE "EventPlatformEdit" ADD CONSTRAINT "EventPlatformEdit_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventPlatformEdit" ADD CONSTRAINT "EventPlatformEdit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A sitting answers only the browser session that opened it. One whose session
-- row is gone can never be matched, so it is effectively closed.
-- AddForeignKey
ALTER TABLE "EventPlatformEdit" ADD CONSTRAINT "EventPlatformEdit_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One open sitting per administrator per event: a double click is decided here.
CREATE UNIQUE INDEX "EventPlatformEdit_one_open_per_actor_key"
  ON "EventPlatformEdit" ("eventId", "actorId") WHERE "closedAt" IS NULL;

ALTER TABLE "EventPlatformEdit" ADD CONSTRAINT "event_platform_edit_shape" CHECK (
  char_length(btrim("reason")) BETWEEN 10 AND 500
  AND "expiresAt" > "openedAt"
  AND "expiresAt" <= "openedAt" + interval '2 hours'
  AND ("closedAt" IS NULL) = ("endedBy" IS NULL)
);

-- ============================================================================
-- 7. What ticket holders are shown changed
-- ============================================================================

-- CreateTable
CREATE TABLE "EventChangeNotice" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventSessionId" TEXT,
    "kind" "EventChangeKind" NOT NULL,
    "fields" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "changed" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "byPlatform" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventChangeNotice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventChangeNotice_eventId_createdAt_idx" ON "EventChangeNotice"("eventId", "createdAt");

-- CreateIndex
CREATE INDEX "EventChangeNotice_eventSessionId_idx" ON "EventChangeNotice"("eventSessionId");

-- AddForeignKey
ALTER TABLE "EventChangeNotice" ADD CONSTRAINT "EventChangeNotice_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventChangeNotice" ADD CONSTRAINT "EventChangeNotice_eventSessionId_fkey" FOREIGN KEY ("eventSessionId") REFERENCES "EventSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EventChangeNotice" ADD CONSTRAINT "event_change_notice_shape" CHECK (
  cardinality("fields") <= 20 AND cardinality("changed") <= 40
  AND ("reason" IS NULL OR char_length("reason") <= 2000)
  AND ("before" IS NULL OR jsonb_typeof("before") = 'object')
  AND ("after" IS NULL OR jsonb_typeof("after") = 'object')
);
