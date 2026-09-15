-- A draft layout is written whole, so two authors editing the same draft would
-- otherwise silently overwrite one another: last write wins, and the loser has
-- no way to know. `revision` is the precondition. A client sends the revision it
-- read; the write applies only if that is still the current one.
--
-- Additive with a default, so existing rows migrate without a backfill pass.
ALTER TABLE "VenueMapVersion" ADD COLUMN IF NOT EXISTS "revision" INTEGER NOT NULL DEFAULT 0;

-- The revision only moves forward, and only while the version is a draft. Once
-- `publishedAt` is set the layout is frozen, so a revision bump would be a
-- change to something that must not change. The existing
-- `desi_map_version_publish_once` trigger guards `publishedAt` and `version`;
-- this guards the new column on the same principle.
CREATE OR REPLACE FUNCTION desi_map_version_revision_forward() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."revision" < OLD."revision" THEN
    RAISE EXCEPTION
      'map version % revision cannot move backwards (% -> %)',
      OLD."id", OLD."revision", NEW."revision"
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD."publishedAt" IS NOT NULL AND NEW."revision" IS DISTINCT FROM OLD."revision" THEN
    RAISE EXCEPTION
      'map version % was published at % and its layout revision cannot change',
      OLD."id", OLD."publishedAt"
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER desi_map_version_revision_forward
  BEFORE UPDATE ON "VenueMapVersion"
  FOR EACH ROW EXECUTE FUNCTION desi_map_version_revision_forward();
