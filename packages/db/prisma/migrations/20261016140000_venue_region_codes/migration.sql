-- Venue regions and countries stored as codes (ADR 0020, review of
-- 2026-10-16). The listing's State/Province filter reads a state back only as
-- its ISO 3166-2 code (`US-TX`), so a venue whose region an organiser typed
-- by name ("Texas", "New Jersey") or whose country was typed in lower case
-- ("us") was offered as an option that filtered nothing. Venue writes now
-- store both as codes (`venueRegionCode` and `countrySchema` in
-- @desi-event/schemas); this rewrites the venues written before. Data only,
-- no schema.
--
-- 1. `country`: trimmed and in capitals.
-- 2. `region`: a United States or Canadian state, province or territory
--    named in full, in any case and spacing, becomes its code (the table is
--    `SUBDIVISIONS_BY_COUNTRY`, with "Québec" beside "Quebec").
-- 3. `region`: one to three letters or digits ("tx", " on ") are trimmed
--    and put in capitals.
--
-- Any other region ("Maharashtra", "Tex.") is left exactly as it is: it is
-- still the venue's address, it is just not a State/Province option. Events,
-- orders and audit rows are not touched. A venue's `updatedAt` is left as it
-- was: nobody edited it.
--
-- Idempotent: a second run finds nothing to change. No BEGIN/COMMIT inside:
-- Prisma wraps the file in one transaction.
--
-- Rollback: none. The values written are the same places, spelt as codes.

-- ============================================================================
-- 1. Countries in capitals
-- ============================================================================

UPDATE "Venue"
SET "country" = upper(btrim("country"))
WHERE "country" <> upper(btrim("country"))
  AND upper(btrim("country")) ~ '^[A-Z]{2}$';

-- ============================================================================
-- 2. A state, province or territory named in full, as its code
-- ============================================================================

UPDATE "Venue" AS v
SET "region" = names.code
FROM (
  VALUES
    ('AL', 'alabama'),
    ('AK', 'alaska'),
    ('AB', 'alberta'),
    ('AS', 'american samoa'),
    ('AZ', 'arizona'),
    ('AR', 'arkansas'),
    ('BC', 'british columbia'),
    ('CA', 'california'),
    ('CO', 'colorado'),
    ('CT', 'connecticut'),
    ('DE', 'delaware'),
    ('DC', 'district of columbia'),
    ('FL', 'florida'),
    ('GA', 'georgia'),
    ('GU', 'guam'),
    ('HI', 'hawaii'),
    ('ID', 'idaho'),
    ('IL', 'illinois'),
    ('IN', 'indiana'),
    ('IA', 'iowa'),
    ('KS', 'kansas'),
    ('KY', 'kentucky'),
    ('LA', 'louisiana'),
    ('ME', 'maine'),
    ('MB', 'manitoba'),
    ('MD', 'maryland'),
    ('MA', 'massachusetts'),
    ('MI', 'michigan'),
    ('MN', 'minnesota'),
    ('MS', 'mississippi'),
    ('MO', 'missouri'),
    ('MT', 'montana'),
    ('NE', 'nebraska'),
    ('NV', 'nevada'),
    ('NB', 'new brunswick'),
    ('NH', 'new hampshire'),
    ('NJ', 'new jersey'),
    ('NM', 'new mexico'),
    ('NY', 'new york'),
    ('NL', 'newfoundland and labrador'),
    ('NC', 'north carolina'),
    ('ND', 'north dakota'),
    ('MP', 'northern mariana islands'),
    ('NT', 'northwest territories'),
    ('NS', 'nova scotia'),
    ('NU', 'nunavut'),
    ('OH', 'ohio'),
    ('OK', 'oklahoma'),
    ('ON', 'ontario'),
    ('OR', 'oregon'),
    ('PA', 'pennsylvania'),
    ('PE', 'prince edward island'),
    ('PR', 'puerto rico'),
    ('QC', 'quebec'),
    ('QC', 'québec'),
    ('RI', 'rhode island'),
    ('SK', 'saskatchewan'),
    ('SC', 'south carolina'),
    ('SD', 'south dakota'),
    ('TN', 'tennessee'),
    ('TX', 'texas'),
    ('VI', 'u.s. virgin islands'),
    ('UT', 'utah'),
    ('VT', 'vermont'),
    ('VA', 'virginia'),
    ('WA', 'washington'),
    ('WV', 'west virginia'),
    ('WI', 'wisconsin'),
    ('WY', 'wyoming'),
    ('YT', 'yukon')
) AS names (code, name)
WHERE lower(regexp_replace(btrim(v."region"), '\s+', ' ', 'g')) = names.name
  AND v."region" <> names.code;

-- ============================================================================
-- 3. A typed code in capitals
-- ============================================================================

UPDATE "Venue"
SET "region" = upper(btrim("region"))
WHERE btrim("region") ~ '^[A-Za-z0-9]{1,3}$'
  AND "region" <> upper(btrim("region"));
