-- An event that moves to another organisation takes no door scope with it
-- (ADR 0019, review of 2026-10-16).
--
-- A door scope names an event of its own organisation: a member's
-- `ScannerScope` (desi_scanner_scope_same_organization) and a waiting
-- invitation's `InvitationScope` (desi_invitation_scope_same_organization).
-- Both triggers fire when a scope row is written, not when its event's
-- `organizationId` changes. Since ADR 0019 the platform-held organisation has
-- door scanners, so moving one of its imported events to an organiser's
-- organisation (`reassignImportedEvent`) could leave their scopes, and its
-- waiting scanner invitations' scopes, naming another organisation's event.
-- Every later rescope of such a scanner, and every new code for such an
-- invitation, was then refused with 422.
--
-- 1. Repair: delete every door scope that already names another
--    organisation's event. It admitted nobody (the door reads the event's own
--    organisation), so nothing anybody could do changes.
-- 2. Guard: `desi_event_move_leaves_no_door_scope` refuses to change an
--    event's `organizationId` while any door scope of another organisation
--    still names it. `reassignImportedEvent` deletes those scopes first, in
--    the same transaction, and records how many in its audit row; any other
--    writer has to do the same.
--
-- No BEGIN/COMMIT inside: Prisma wraps the file in one transaction. PL/pgSQL
-- per ADR 0004.
--
-- Rollback (manual):
--   DROP TRIGGER desi_event_move_leaves_no_door_scope ON "Event";
--   DROP FUNCTION desi_event_move_leaves_no_door_scope();
--   The deleted scopes are not restored: they opened no door.

-- ============================================================================
-- 1. Door scopes that name another organisation's event
-- ============================================================================

DELETE FROM "ScannerScope" AS s
USING "Membership" AS m, "Event" AS e
WHERE m."id" = s."membershipId"
  AND e."id" = s."eventId"
  AND m."organizationId" IS DISTINCT FROM e."organizationId";

DELETE FROM "InvitationScope" AS s
USING "Invitation" AS i, "Event" AS e
WHERE i."id" = s."invitationId"
  AND e."id" = s."eventId"
  AND i."organizationId" IS DISTINCT FROM e."organizationId";

-- ============================================================================
-- 2. An event moves only once no other organisation's door scope names it
-- ============================================================================

CREATE OR REPLACE FUNCTION desi_event_move_leaves_no_door_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."organizationId" IS NOT DISTINCT FROM OLD."organizationId" THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
       SELECT 1
       FROM "ScannerScope" AS s
       JOIN "Membership" AS m ON m."id" = s."membershipId"
       WHERE s."eventId" = NEW."id"
         AND m."organizationId" IS DISTINCT FROM NEW."organizationId"
     )
     OR EXISTS (
       SELECT 1
       FROM "InvitationScope" AS s
       JOIN "Invitation" AS i ON i."id" = s."invitationId"
       WHERE s."eventId" = NEW."id"
         AND i."organizationId" IS DISTINCT FROM NEW."organizationId"
     ) THEN
    RAISE EXCEPTION
      'event % cannot move to organisation % while a door scope of another organisation names it (event_move_leaves_no_door_scope)',
      NEW."id", NEW."organizationId"
      USING ERRCODE = 'check_violation', CONSTRAINT = 'event_move_leaves_no_door_scope';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER desi_event_move_leaves_no_door_scope
  AFTER UPDATE OF "organizationId" ON "Event"
  FOR EACH ROW EXECUTE FUNCTION desi_event_move_leaves_no_door_scope();
