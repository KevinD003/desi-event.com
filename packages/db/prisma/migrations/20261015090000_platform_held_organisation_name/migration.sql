-- The platform-held organisation that imported events belong to is renamed
-- "The Desi Events", at the web address "the-desi-events", with a description
-- that names no other site (the owner's request, 2026-10-15: no page a visitor
-- or an administrator reads names the site the events are listed on).
--
-- A migration rather than waiting for the next import, which also brings the
-- organisation up to date (`ensurePlatformHeldOrganization` in
-- apps/api/src/lib/organization-provisioning.js): the organiser page is public,
-- and an import may not run for weeks. This file changes data only, no schema.
--
-- Only the organisation that holds imported events is touched, and in it only
-- what still has the value the first build gave it: the name, a web address
-- that is the first one or that one made unique, and the description, each
-- compared exactly. Nobody else writes these columns of that organisation (it
-- has no members and no route edits it). When another organisation already has
-- "the-desi-events", the address is made unique from the organisation's id, as
-- the API makes one unique; a clash on that too fails the migration as a whole,
-- and nothing is changed. A database that never imported anything has no such
-- organisation, and nothing is changed. Running it again changes nothing.
--
-- The old web address is not redirected: it names the site. No audit row is
-- written here; the API audits the same change as
-- `organization.platform_held_updated` when an import makes it.
--
-- No BEGIN/COMMIT inside: Prisma wraps the file in one transaction.
--
-- Rollback (manual): set "name", "slug" and "description" of the organisation
-- whose "platformHeldSource" is 'SULEKHA' back to the values compared below.
UPDATE "Organization" AS o
SET
  "name" = CASE WHEN o."name" = 'Sulekha Events' THEN 'The Desi Events' ELSE o."name" END,
  "slug" = CASE
    WHEN o."slug" = 'sulekha-events' OR o."slug" ~ '^sulekha-events-[0-9a-z]{4,8}$' THEN
      CASE
        WHEN EXISTS (
          SELECT 1 FROM "Organization" AS t WHERE t."slug" = 'the-desi-events' AND t."id" <> o."id"
        ) THEN 'the-desi-events-' || substr(md5(o."id"), 1, 6)
        ELSE 'the-desi-events'
      END
    ELSE o."slug"
  END,
  "description" = CASE
    WHEN o."description" = 'Events listed on Sulekha.com and shown on The Desi Events by its team. Each event page names the organiser who runs it. Tickets for these events are sold on Sulekha.'
      THEN 'Events imported from organisers'' public ticket listings and shown on The Desi Events by its team. Each event page names the organiser who presents it. Tickets for these events are sold on The Desi Events, and can also be reserved on WhatsApp.'
    ELSE o."description"
  END,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE o."platformHeldSource" = 'SULEKHA'
  AND (
    o."name" = 'Sulekha Events'
    OR o."slug" = 'sulekha-events'
    OR o."slug" ~ '^sulekha-events-[0-9a-z]{4,8}$'
    OR o."description" = 'Events listed on Sulekha.com and shown on The Desi Events by its team. Each event page names the organiser who runs it. Tickets for these events are sold on Sulekha.'
  );
