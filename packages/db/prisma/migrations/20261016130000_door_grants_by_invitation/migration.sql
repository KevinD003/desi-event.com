-- Door grants by invitation (ADR 0019, the owner's decision of 2026-10-16:
-- "organizer gives access to anyone to scan the tickets").
--
-- 1. A team invitation for a door role carries the events it will admit at:
--    `InvitationScope`, one row per invitation and event, copied into
--    `ScannerScope` rows by the transaction that accepts the invitation. A
--    trigger refuses an event of another organisation than the invitation's,
--    and an invitation whose role does not admit by scope.
-- 2. The platform-held organisation ("The Desi Events", imported events) may
--    hold door scanners: SCANNER memberships and SCANNER team invitations, and
--    nothing else. Every other role is refused with the same error as before
--    (platform_held_organization_has_no_members), and the trigger now also
--    fires on a role change, so a scanner there cannot be moved to another
--    role. A SCANNER edits nothing, so imported events still have no editor.
--
-- No BEGIN/COMMIT inside: Prisma wraps the file in one transaction. PL/pgSQL
-- per ADR 0004. No existing row is changed.
--
-- Rollback (manual, in order):
--   DROP TRIGGER desi_invitation_scope_same_organization ON "InvitationScope";
--   DROP FUNCTION desi_invitation_scope_same_organization();
--   DROP TABLE "InvitationScope";
--   then delete every SCANNER membership and invitation of the platform-held
--   organisation, and restore desi_platform_held_has_no_members() and its two
--   triggers from 20260930160000_event_imports (BEFORE INSERT OR UPDATE OF
--   "organizationId").

-- ============================================================================
-- 1. The events a team invitation scopes its door role to
-- ============================================================================

-- CreateTable
CREATE TABLE "InvitationScope" (
    "id" TEXT NOT NULL,
    "invitationId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvitationScope_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InvitationScope_eventId_idx" ON "InvitationScope"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "InvitationScope_invitationId_eventId_key" ON "InvitationScope"("invitationId", "eventId");

-- AddForeignKey
ALTER TABLE "InvitationScope" ADD CONSTRAINT "InvitationScope_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "Invitation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvitationScope" ADD CONSTRAINT "InvitationScope_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The rule `desi_scanner_scope_same_organization` holds for a member's scope,
-- held for an invitation's: the event is the invitation's organisation's, and
-- the role is one that admits only where a scope says.
CREATE OR REPLACE FUNCTION desi_invitation_scope_same_organization() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  invitation_organization TEXT;
  invitation_role         TEXT;
  event_organization      TEXT;
BEGIN
  SELECT "organizationId", "role"::text INTO invitation_organization, invitation_role
  FROM "Invitation" WHERE "id" = NEW."invitationId";

  SELECT "organizationId" INTO event_organization
  FROM "Event" WHERE "id" = NEW."eventId";

  IF invitation_organization IS DISTINCT FROM event_organization THEN
    RAISE EXCEPTION
      'invitation scope refused: event % belongs to another organisation than invitation % (invitation_scope_same_organization)',
      NEW."eventId", NEW."invitationId"
      USING ERRCODE = 'check_violation', CONSTRAINT = 'invitation_scope_same_organization';
  END IF;

  IF invitation_role NOT IN ('MANAGER', 'STAFF', 'SCANNER') THEN
    RAISE EXCEPTION
      'invitation scope refused: invitation % offers %, which does not admit by event (invitation_scope_door_role)',
      NEW."invitationId", invitation_role
      USING ERRCODE = 'check_violation', CONSTRAINT = 'invitation_scope_door_role';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER desi_invitation_scope_same_organization
  BEFORE INSERT OR UPDATE ON "InvitationScope"
  FOR EACH ROW EXECUTE FUNCTION desi_invitation_scope_same_organization();

-- ============================================================================
-- 2. The platform-held organisation holds door scanners and nobody else
-- ============================================================================
--
-- The API maps the refusal (23514, constraint
-- platform_held_organization_has_no_members, also written into the message) to
-- 409 PLATFORM_HELD_ORGANIZATION, as before.
CREATE OR REPLACE FUNCTION desi_platform_held_has_no_members() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  held "EventImportSource";
BEGIN
  SELECT "platformHeldSource" INTO held FROM "Organization" WHERE "id" = NEW."organizationId";

  IF held IS NOT NULL AND NEW."role"::text <> 'SCANNER' THEN
    RAISE EXCEPTION 'organisation % holds imported events for the Desi-Event team and has no members but door scanners (platform_held_organization_has_no_members)',
      NEW."organizationId"
      USING ERRCODE = '23514', CONSTRAINT = 'platform_held_organization_has_no_members';
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER desi_platform_held_has_no_members ON "Membership";
DROP TRIGGER desi_platform_held_has_no_members ON "Invitation";

CREATE TRIGGER desi_platform_held_has_no_members
  BEFORE INSERT OR UPDATE OF "organizationId", "role" ON "Membership"
  FOR EACH ROW EXECUTE FUNCTION desi_platform_held_has_no_members();

CREATE TRIGGER desi_platform_held_has_no_members
  BEFORE INSERT OR UPDATE OF "organizationId", "role" ON "Invitation"
  FOR EACH ROW EXECUTE FUNCTION desi_platform_held_has_no_members();
