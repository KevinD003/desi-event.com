-- Admission: a scope that names a real event of the scanner's own
-- organisation, and a check-in method that says what was presented.
--
-- ============================================================================
-- 1. CheckInMethod: MANUAL_LOOKUP becomes MANUAL_CODE
-- ============================================================================
--
-- A rename in place, not the drop-and-recreate block `prisma migrate diff`
-- generates. That block carries its own BEGIN/COMMIT, and inside Prisma's
-- per-file transaction the inner COMMIT ends it early — the defect
-- verify-populated-upgrade.mjs exists to catch. RENAME VALUE changes only the
-- label: existing rows keep their value, no table is rewritten, and the end
-- state is exactly the type schema.prisma declares.
--
-- No row has ever held MANUAL_LOOKUP (every admission was recorded as QR_SCAN,
-- the default, whatever was presented), so nothing's meaning changes.
--
-- Rollback: ALTER TYPE "CheckInMethod" RENAME VALUE 'MANUAL_CODE' TO 'MANUAL_LOOKUP';

ALTER TYPE "CheckInMethod" RENAME VALUE 'MANUAL_LOOKUP' TO 'MANUAL_CODE';

-- ============================================================================
-- 2. ScannerScope.eventId becomes a foreign key
-- ============================================================================
--
-- Before this, a scope was a membership id and a bare string, and nothing
-- stopped the string naming an event that did not exist. Such a row grants
-- nothing — admission resolves the ticket's event from the database and
-- compares — so removing it loses no authority anybody had. It is removed so
-- the constraint can be added, not to change behaviour.
--
-- Rollback: ALTER TABLE "ScannerScope" DROP CONSTRAINT "ScannerScope_eventId_fkey";
-- (Rows deleted here named no event and cannot be meaningfully restored.)

DELETE FROM "ScannerScope" s
WHERE NOT EXISTS (SELECT 1 FROM "Event" e WHERE e."id" = s."eventId");

ALTER TABLE "ScannerScope"
  ADD CONSTRAINT "ScannerScope_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- 3. A scope may name only an event of the membership's own organisation
-- ============================================================================
--
-- The team route has always filtered requested event ids by organisation, and
-- now refuses a foreign one outright. This makes the rule the table's rather
-- than one route's: a scope crossing organisations would be a door scanner
-- hired by one organiser admitting to another's event, and no code path should
-- be able to write one by mistake.
--
-- A cross-organisation row would be exactly that hole, so any found is removed
-- before the trigger is created; the application filter means none is expected.
--
-- Rollback: DROP TRIGGER desi_scanner_scope_same_organization ON "ScannerScope";
--           DROP FUNCTION desi_scanner_scope_same_organization();

DELETE FROM "ScannerScope" s
USING "Membership" m, "Event" e
WHERE s."membershipId" = m."id"
  AND e."id" = s."eventId"
  AND e."organizationId" <> m."organizationId";

CREATE OR REPLACE FUNCTION desi_scanner_scope_same_organization() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  membership_organization TEXT;
  event_organization      TEXT;
BEGIN
  SELECT "organizationId" INTO membership_organization
  FROM "Membership" WHERE "id" = NEW."membershipId";

  SELECT "organizationId" INTO event_organization
  FROM "Event" WHERE "id" = NEW."eventId";

  IF membership_organization IS DISTINCT FROM event_organization THEN
    RAISE EXCEPTION
      'scanner scope refused: event % belongs to another organisation than membership %',
      NEW."eventId", NEW."membershipId"
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER desi_scanner_scope_same_organization
  BEFORE INSERT OR UPDATE ON "ScannerScope"
  FOR EACH ROW EXECUTE FUNCTION desi_scanner_scope_same_organization();
