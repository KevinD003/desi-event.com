-- The organiser's website and the switch only a platform administrator turns.
--
-- The organiser writes `websiteUrl`. An administrator decides about one address
-- at a time: turning the link on records that address in `websiteDecidedUrl`,
-- and while the switch is on the public link goes there. An organiser's later
-- change never moves the switch, the decided address or the reason; it only
-- puts the new address on the administrators' list (`websiteDecisionPending`),
-- so an approved address stays linked until an administrator decides on the
-- new one or turns the link off.
--
-- No BEGIN/COMMIT inside: Prisma wraps the file in one transaction (see
-- verify-populated-upgrade.mjs). PL/pgSQL per ADR 0004.
--
-- Rollback (in order):
--   DROP TRIGGER desi_event_website_change ON "Event";
--   DROP FUNCTION desi_event_website_change();
--   DROP INDEX "Event_website_pending_idx"; DROP INDEX "Event_website_redirect_on_idx";
--   ALTER TABLE "Event" DROP CONSTRAINT "event_website_redirect_consistency",
--     DROP CONSTRAINT "event_website_url_shape";
--   ALTER TABLE "Event" DROP CONSTRAINT "event_social_links_shape";
--   ALTER TABLE "Event" ADD CONSTRAINT "event_social_links_shape"
--     CHECK ("socialLinks" IS NULL OR jsonb_typeof("socialLinks") = 'object');
--   UPDATE "Event" SET "socialLinks" = COALESCE("socialLinks", '{}'::jsonb)
--     || jsonb_build_object('website', "websiteUrl") WHERE "websiteUrl" IS NOT NULL;
--   ALTER TABLE "Event" DROP CONSTRAINT "Event_websiteRedirectChangedById_fkey";
--   DROP INDEX "Event_websiteRedirectChangedById_idx";
--   ALTER TABLE "Event" DROP COLUMN "websiteUrl", DROP COLUMN "websiteRedirectEnabled",
--     DROP COLUMN "websiteDecidedUrl", DROP COLUMN "websiteDecisionPending",
--     DROP COLUMN "websiteSubmittedAt", DROP COLUMN "websiteRedirectChangedAt",
--     DROP COLUMN "websiteRedirectChangedById", DROP COLUMN "websiteRedirectReason";
--   (Legacy addresses the backfill dropped are not restorable.)

-- ============================================================================
-- 1. Columns
-- ============================================================================

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "websiteDecidedUrl" TEXT,
ADD COLUMN     "websiteDecisionPending" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "websiteRedirectChangedAt" TIMESTAMP(3),
ADD COLUMN     "websiteRedirectChangedById" TEXT,
ADD COLUMN     "websiteRedirectEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "websiteRedirectReason" TEXT,
ADD COLUMN     "websiteSubmittedAt" TIMESTAMP(3),
ADD COLUMN     "websiteUrl" TEXT;

-- CreateIndex
CREATE INDEX "Event_websiteRedirectChangedById_idx" ON "Event"("websiteRedirectChangedById");

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_websiteRedirectChangedById_fkey" FOREIGN KEY ("websiteRedirectChangedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- 2. Carry socialLinks.website over to websiteUrl
-- ============================================================================
--
-- Normalised the way the API stores it: "/" after a bare host, the scheme and
-- host lower-cased. A value is carried only when it already has the stored
-- shape: https, a dotted public name with an alphabetic or punycode top level,
-- "/" straight after the name (so no sign-in and no port), only characters an
-- address may carry unescaped, not a numeric address, and no "." or ".."
-- path segment. Anything else is dropped, counted in a NOTICE and never
-- printed. A value with a credential parameter (`?token=`) is carried: the
-- administrators' screen shows why it cannot be turned on. A carried address
-- waits for an administrator's decision; the switch starts off everywhere.

WITH legacy AS (
  SELECT "id", btrim("socialLinks"->>'website') AS href
    FROM "Event"
   WHERE jsonb_typeof("socialLinks") = 'object'
     AND jsonb_typeof("socialLinks"->'website') = 'string'
), shaped AS (
  -- "/" after the host when the address has none: "https://a.example",
  -- "https://a.example?x=1" and "https://a.example#t" all gain one, as
  -- `new URL().href` would give them.
  SELECT "id",
         regexp_replace(href, '^([A-Za-z]+://[^/?#]+)($|[?#])', '\1/\2') AS href
    FROM legacy
)
UPDATE "Event" e
   SET "websiteUrl" = lower(substring(s.href FROM '^[A-Za-z]+://[^/?#]+'))
                      || substring(s.href FROM '^[A-Za-z]+://[^/?#]+(.*)$'),
       "websiteDecisionPending" = true,
       "websiteSubmittedAt" = now()
  FROM shaped s
 WHERE e."id" = s."id"
   AND e."websiteUrl" IS NULL
   AND char_length(s.href) BETWEEN 12 AND 2048
   AND s.href ~* '^https://([a-z0-9-]+\.)+([a-z]{2,63}|xn--[a-z0-9-]+)/[A-Za-z0-9._~!$&()*+,;=:@%/?#-]*$'
   AND s.href !~ '^[A-Za-z]+://[0-9.]+/'
   AND s.href !~ '/\.\.?(/|$|[?#])';

DO $$
DECLARE
  dropped integer;
BEGIN
  SELECT count(*) INTO dropped
    FROM "Event"
   WHERE jsonb_typeof("socialLinks") = 'object'
     AND jsonb_typeof("socialLinks"->'website') = 'string'
     AND "websiteUrl" IS NULL;

  IF dropped > 0 THEN
    RAISE NOTICE 'event website link: % socialLinks.website value(s) did not have the shape of a public https address and were not carried over', dropped;
  END IF;
END;
$$;

UPDATE "Event" SET "socialLinks" = "socialLinks" - 'website'
 WHERE jsonb_typeof("socialLinks") = 'object' AND "socialLinks" ? 'website';

-- The key can never come back.
ALTER TABLE "Event" DROP CONSTRAINT "event_social_links_shape";
ALTER TABLE "Event" ADD CONSTRAINT "event_social_links_shape"
  CHECK ("socialLinks" IS NULL
         OR (jsonb_typeof("socialLinks") = 'object' AND NOT ("socialLinks" ? 'website')));

-- ============================================================================
-- 3. The address's stored shape, and the switch's invariants
-- ============================================================================
--
-- The shape the API stores (`new URL(...).href` of an address that passed
-- `websiteUrlProblem`): https, a lower-case dotted name with no sign-in and no
-- port, "/" after it, printable ASCII. The API's rule is stricter (private
-- network names, credential parameters, Desi-Event's own domain); this is the
-- floor nothing may go below. `organizer_invitation_website_shape` uses the
-- same pattern.

ALTER TABLE "Event" ADD CONSTRAINT "event_website_url_shape" CHECK (
  ("websiteUrl" IS NULL OR (
    char_length("websiteUrl") BETWEEN 12 AND 2048
    AND "websiteUrl" ~ '^https://([a-z0-9-]+\.)+([a-z]{2,63}|xn--[a-z0-9-]+)/[!-~]*$'))
  AND ("websiteDecidedUrl" IS NULL OR (
    char_length("websiteDecidedUrl") BETWEEN 12 AND 2048
    AND "websiteDecidedUrl" ~ '^https://([a-z0-9-]+\.)+([a-z]{2,63}|xn--[a-z0-9-]+)/[!-~]*$')));

-- On means an administrator decided about an address, at a known time.
-- Waiting means there is something to decide, since a known time. Nothing
-- waits without a time, and a decided address always has its time.
ALTER TABLE "Event" ADD CONSTRAINT "event_website_redirect_consistency" CHECK (
  (NOT "websiteRedirectEnabled" OR ("websiteDecidedUrl" IS NOT NULL AND "websiteRedirectChangedAt" IS NOT NULL))
  AND (NOT "websiteDecisionPending" OR (("websiteUrl" IS NOT NULL OR "websiteRedirectEnabled") AND "websiteSubmittedAt" IS NOT NULL))
  AND ("websiteDecisionPending" OR "websiteSubmittedAt" IS NULL)
  AND ("websiteDecidedUrl" IS NULL OR "websiteRedirectChangedAt" IS NOT NULL)
  AND ("websiteRedirectReason" IS NULL OR char_length("websiteRedirectReason") BETWEEN 1 AND 500));

-- ============================================================================
-- 4. Whether a decision is waiting, kept by the database too
-- ============================================================================
--
-- The API computes the same on every write of `websiteUrl`; this is the
-- backstop for every other writer. Waiting means the current address differs
-- from the decided one and there is something to decide: an address, or a
-- switch that is on (an address cleared while the link is on). It never
-- touches the switch, the decided address or the reason.

CREATE OR REPLACE FUNCTION desi_event_website_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW."websiteDecisionPending" :=
    NEW."websiteUrl" IS DISTINCT FROM NEW."websiteDecidedUrl"
    AND (NEW."websiteUrl" IS NOT NULL OR NEW."websiteRedirectEnabled");

  IF NEW."websiteDecisionPending" THEN
    NEW."websiteSubmittedAt" := COALESCE(NEW."websiteSubmittedAt", now());
  ELSE
    NEW."websiteSubmittedAt" := NULL;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER desi_event_website_change
  BEFORE INSERT OR UPDATE OF "websiteUrl" ON "Event"
  FOR EACH ROW EXECUTE FUNCTION desi_event_website_change();

-- ============================================================================
-- 5. The administrators' worklist
-- ============================================================================

CREATE INDEX "Event_website_pending_idx" ON "Event" ("websiteSubmittedAt", "id")
  WHERE "websiteDecisionPending";
CREATE INDEX "Event_website_redirect_on_idx" ON "Event" ("websiteRedirectChangedAt")
  WHERE "websiteRedirectEnabled";
