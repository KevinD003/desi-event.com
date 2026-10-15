-- Organiser invitations, the posting-role rule for team invitations, and the
-- review gate on Event.status.
--
-- No BEGIN/COMMIT inside: Prisma wraps the file in one transaction (see
-- verify-populated-upgrade.mjs). PL/pgSQL per ADR 0004.
--
-- Rollback (in order):
--   DROP TRIGGER desi_event_status_requires_review ON "Event";
--   DROP FUNCTION desi_event_status_requires_review();
--   ALTER TABLE "Invitation" DROP CONSTRAINT "invitation_pending_role_is_owner_grantable";
--   (Team invitations the backfill withdrew stay REVOKED: their codes are not restorable.)
--   ALTER TABLE "Membership" DROP CONSTRAINT "Membership_organizerInvitationId_fkey";
--   DROP INDEX "Membership_organizerInvitationId_key";
--   ALTER TABLE "Membership" DROP COLUMN "organizerInvitationId";
--   DROP TABLE "OrganizerInvitation";

-- ============================================================================
-- 1. Organiser invitations
-- ============================================================================
--
-- One kind: start a new organisation as its OWNER. The organisation does not
-- exist until the invitation is accepted, so `organizationId` is null until
-- then. Its public description and website are written by the administrator
-- here, never by the recipient.

-- CreateTable
CREATE TABLE "OrganizerInvitation" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "organizationName" TEXT NOT NULL,
    "organizationDescription" TEXT,
    "organizationWebsiteUrl" TEXT,
    "note" TEXT,
    "organizationId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "deliveryMode" "InvitationDelivery" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptedByUserId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "supersedesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizerInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrganizerInvitation_tokenHash_key" ON "OrganizerInvitation"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizerInvitation_supersedesId_key" ON "OrganizerInvitation"("supersedesId");

-- CreateIndex
CREATE INDEX "OrganizerInvitation_status_createdAt_idx" ON "OrganizerInvitation"("status", "createdAt");

-- CreateIndex
CREATE INDEX "OrganizerInvitation_email_status_idx" ON "OrganizerInvitation"("email", "status");

-- CreateIndex
CREATE INDEX "OrganizerInvitation_organizationId_idx" ON "OrganizerInvitation"("organizationId");

-- CreateIndex
CREATE INDEX "OrganizerInvitation_invitedById_idx" ON "OrganizerInvitation"("invitedById");

-- CreateIndex
CREATE INDEX "OrganizerInvitation_expiresAt_idx" ON "OrganizerInvitation"("expiresAt");

-- AddForeignKey
ALTER TABLE "OrganizerInvitation" ADD CONSTRAINT "OrganizerInvitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizerInvitation" ADD CONSTRAINT "OrganizerInvitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizerInvitation" ADD CONSTRAINT "OrganizerInvitation_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizerInvitation" ADD CONSTRAINT "OrganizerInvitation_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizerInvitation" ADD CONSTRAINT "OrganizerInvitation_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "OrganizerInvitation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Shape rules the application also keeps. Hand-written: Prisma cannot say them.
-- The website pattern is the floor `event_website_url_shape` uses
-- (20260930120000_event_website_link): https, a lower-case dotted public name,
-- "/" after it, printable ASCII. The API's rule is stricter and stores
-- `new URL().href`.
ALTER TABLE "OrganizerInvitation"
  ADD CONSTRAINT "organizer_invitation_email_lower"
    CHECK ("email" = lower("email") AND char_length("email") BETWEEN 3 AND 254),
  ADD CONSTRAINT "organizer_invitation_name_length"
    CHECK (char_length("organizationName") BETWEEN 2 AND 120),
  ADD CONSTRAINT "organizer_invitation_description_length"
    CHECK ("organizationDescription" IS NULL
           OR char_length("organizationDescription") BETWEEN 1 AND 2000),
  ADD CONSTRAINT "organizer_invitation_website_shape"
    CHECK ("organizationWebsiteUrl" IS NULL OR (
      char_length("organizationWebsiteUrl") BETWEEN 12 AND 2048
      AND "organizationWebsiteUrl" ~ '^https://([a-z0-9-]+\.)+([a-z]{2,63}|xn--[a-z0-9-]+)/[!-~]*$')),
  ADD CONSTRAINT "organizer_invitation_note_length"
    CHECK ("note" IS NULL OR char_length("note") BETWEEN 1 AND 1000),
  ADD CONSTRAINT "organizer_invitation_token_is_digest"
    CHECK ("tokenHash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "organizer_invitation_expires_after_creation"
    CHECK ("expiresAt" > "createdAt"),
  ADD CONSTRAINT "organizer_invitation_accepted_shape"
    CHECK ("status" <> 'ACCEPTED' OR "acceptedAt" IS NOT NULL),
  ADD CONSTRAINT "organizer_invitation_revoked_shape"
    CHECK ("status" <> 'REVOKED' OR "revokedAt" IS NOT NULL),
  -- The organisation exists only once the invitation has been accepted.
  ADD CONSTRAINT "organizer_invitation_org_only_when_accepted"
    CHECK ("status" = 'ACCEPTED' OR "organizationId" IS NULL);

-- One live invitation per address. The routes answer 409 when this refuses.
CREATE UNIQUE INDEX "OrganizerInvitation_one_pending_per_address"
  ON "OrganizerInvitation" (lower("email"))
  WHERE "status" = 'PENDING';

-- ============================================================================
-- 2. Membership provenance
-- ============================================================================

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "organizerInvitationId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Membership_organizerInvitationId_key" ON "Membership"("organizerInvitationId");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organizerInvitationId_fkey" FOREIGN KEY ("organizerInvitationId") REFERENCES "OrganizerInvitation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- 3. Team invitations offer only roles that neither create nor publish events
-- ============================================================================
--
-- Outstanding ones that do are withdrawn first (they were issued by an
-- organisation, not by the Desi-Event team), then the rule is held by the
-- database for every live invitation.

UPDATE "Invitation"
   SET "status" = 'REVOKED', "revokedAt" = COALESCE("revokedAt", now())
 WHERE "status" = 'PENDING'
   AND "role" IN ('OWNER', 'ADMIN', 'MANAGER', 'EVENT_MANAGER');

ALTER TABLE "Invitation"
  ADD CONSTRAINT "invitation_pending_role_is_owner_grantable"
    CHECK ("status" <> 'PENDING' OR "role" IN ('FINANCE', 'STAFF', 'SCANNER', 'VIEWER'));

-- ============================================================================
-- 4. The review gate
-- ============================================================================
--
-- An event is APPROVED only from REVIEW_PENDING (a moderator's decision), and
-- becomes publicly visible only from APPROVED or from a status that is already
-- public. The service table says the same; this is what holds when a code path
-- forgets it. Inserts are not covered: only seeds and tests insert anything but
-- DRAFT, and events.create forces DRAFT.
--
-- The constraint name is in the message as well as in CONSTRAINT: Prisma's
-- PostgreSQL adapter passes on the SQLSTATE and the message of a raised error
-- but not its constraint field, and the API maps 23514 with this name to 409
-- REVIEW_REQUIRED by reading the message.
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
     AND OLD."status" <> 'APPROVED' THEN
    RAISE EXCEPTION 'event % cannot become % from %: it has not been approved (event_public_requires_review)',
      NEW."id", NEW."status", OLD."status"
      USING ERRCODE = '23514', CONSTRAINT = 'event_public_requires_review';
  END IF;

  RETURN NEW;
END
$$;

CREATE TRIGGER desi_event_status_requires_review
  BEFORE UPDATE OF "status" ON "Event"
  FOR EACH ROW
  WHEN (OLD."status" IS DISTINCT FROM NEW."status")
  EXECUTE FUNCTION desi_event_status_requires_review();
