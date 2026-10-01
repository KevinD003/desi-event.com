-- Visits to event pages: counted moments, daily totals, the day's salt and the
-- roll-up's lease.
--
-- No BEGIN/COMMIT inside: Prisma wraps the file in one transaction (see
-- verify-populated-upgrade.mjs). Plain SQL; no PL/pgSQL.
--
-- Nothing is backfilled: no visit was recorded before this migration, and the
-- analytics screens say so rather than estimating one. The one row written is
-- the roll-up's state, which is structure: a second state row would be a
-- second lease.
--
-- Rollback (in order):
--   DROP TABLE "TrafficDaily";
--   DROP TABLE "TrafficEvent";
--   DROP TABLE "TrafficSalt";
--   DROP TABLE "TrafficRollupState";
--   DROP TYPE "TrafficSource"; DROP TYPE "TrafficPlacement"; DROP TYPE "TrafficEventKind";

-- ============================================================================
-- 1. Vocabulary
-- ============================================================================

-- CreateEnum
CREATE TYPE "TrafficEventKind" AS ENUM ('PAGE_VIEW', 'CARD_CLICK', 'TICKETS_CLICK', 'SEATS_CLICK', 'WEBSITE_REDIRECT');

-- CreateEnum
CREATE TYPE "TrafficPlacement" AS ENUM ('HOME', 'LISTING', 'SEARCH', 'EVENT_PAGE');

-- CreateEnum
CREATE TYPE "TrafficSource" AS ENUM ('DIRECT', 'INTERNAL', 'SEARCH', 'SOCIAL', 'OTHER');

-- ============================================================================
-- 2. Counted moments
-- ============================================================================

-- CreateTable
CREATE TABLE "TrafficEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "kind" "TrafficEventKind" NOT NULL,
    "placement" "TrafficPlacement" NOT NULL,
    "source" "TrafficSource",
    "day" DATE NOT NULL,
    "visitorHash" CHAR(32),
    "dedupeKey" CHAR(64),

    CONSTRAINT "TrafficEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrafficEvent_dedupeKey_key" ON "TrafficEvent"("dedupeKey");

-- CreateIndex
CREATE INDEX "TrafficEvent_day_eventId_idx" ON "TrafficEvent"("day", "eventId");

-- CreateIndex
CREATE INDEX "TrafficEvent_eventId_idx" ON "TrafficEvent"("eventId");

-- AddForeignKey
ALTER TABLE "TrafficEvent" ADD CONSTRAINT "TrafficEvent_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A category is where a page view came from; a click has none.
ALTER TABLE "TrafficEvent" ADD CONSTRAINT "traffic_event_source_only_on_views"
  CHECK (("kind" = 'PAGE_VIEW') = ("source" IS NOT NULL));

-- A card is clicked on a listing; everything else happens on the event page.
ALTER TABLE "TrafficEvent" ADD CONSTRAINT "traffic_event_placement_fits_kind" CHECK (
  ("kind" = 'CARD_CLICK' AND "placement" IN ('HOME', 'LISTING', 'SEARCH'))
  OR ("kind" <> 'CARD_CLICK' AND "placement" = 'EVENT_PAGE'));

-- The visitor code is a 128-bit lower-case hex digest and nothing else: a
-- column that could take an address, a browser string or an email address is
-- a column somebody will eventually put one in.
ALTER TABLE "TrafficEvent" ADD CONSTRAINT "traffic_event_visitor_hash_shape"
  CHECK ("visitorHash" IS NULL OR "visitorHash" ~ '^[0-9a-f]{32}$');

-- The dedupe digest exists exactly when there is a visitor code, and is a digest.
ALTER TABLE "TrafficEvent" ADD CONSTRAINT "traffic_event_dedupe_key_shape" CHECK (
  (("dedupeKey" IS NULL) = ("visitorHash" IS NULL))
  AND ("dedupeKey" IS NULL OR "dedupeKey" ~ '^[0-9a-f]{64}$'));

-- ============================================================================
-- 3. Daily totals
-- ============================================================================

-- CreateTable
CREATE TABLE "TrafficDaily" (
    "eventId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "visitors" INTEGER NOT NULL DEFAULT 0,
    "anonymousViews" INTEGER NOT NULL DEFAULT 0,
    "viewsDirect" INTEGER NOT NULL DEFAULT 0,
    "viewsInternal" INTEGER NOT NULL DEFAULT 0,
    "viewsSearch" INTEGER NOT NULL DEFAULT 0,
    "viewsSocial" INTEGER NOT NULL DEFAULT 0,
    "viewsOther" INTEGER NOT NULL DEFAULT 0,
    "cardClicks" INTEGER NOT NULL DEFAULT 0,
    "cardClicksHome" INTEGER NOT NULL DEFAULT 0,
    "cardClicksListing" INTEGER NOT NULL DEFAULT 0,
    "cardClicksSearch" INTEGER NOT NULL DEFAULT 0,
    "ticketClicks" INTEGER NOT NULL DEFAULT 0,
    "seatClicks" INTEGER NOT NULL DEFAULT 0,
    "ticketClickVisitors" INTEGER NOT NULL DEFAULT 0,
    "websiteRedirects" INTEGER NOT NULL DEFAULT 0,
    "websiteRedirectVisitors" INTEGER NOT NULL DEFAULT 0,
    "demonstration" BOOLEAN NOT NULL DEFAULT false,
    "computedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrafficDaily_pkey" PRIMARY KEY ("eventId","day")
);

-- CreateIndex
CREATE INDEX "TrafficDaily_day_idx" ON "TrafficDaily"("day");

-- AddForeignKey
ALTER TABLE "TrafficDaily" ADD CONSTRAINT "TrafficDaily_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TrafficDaily" ADD CONSTRAINT "traffic_daily_counts_not_negative" CHECK (
  LEAST("views", "visitors", "anonymousViews", "viewsDirect", "viewsInternal", "viewsSearch",
        "viewsSocial", "viewsOther", "cardClicks", "cardClicksHome", "cardClicksListing",
        "cardClicksSearch", "ticketClicks", "seatClicks", "ticketClickVisitors",
        "websiteRedirects", "websiteRedirectVisitors") >= 0);

-- Every page view has exactly one source category.
ALTER TABLE "TrafficDaily" ADD CONSTRAINT "traffic_daily_sources_add_up" CHECK (
  "views" = "viewsDirect" + "viewsInternal" + "viewsSearch" + "viewsSocial" + "viewsOther");

-- Every card click has exactly one of the three places a card is shown.
ALTER TABLE "TrafficDaily" ADD CONSTRAINT "traffic_daily_placements_add_up" CHECK (
  "cardClicks" = "cardClicksHome" + "cardClicksListing" + "cardClicksSearch");

-- A visitor made at least one of the views with a code; views without one are
-- counted apart. So visitors can never exceed the views that carried a code.
ALTER TABLE "TrafficDaily" ADD CONSTRAINT "traffic_daily_visitors_within_views"
  CHECK ("visitors" + "anonymousViews" <= "views");

ALTER TABLE "TrafficDaily" ADD CONSTRAINT "traffic_daily_click_visitors_within_clicks"
  CHECK ("ticketClickVisitors" <= "ticketClicks" + "seatClicks");

ALTER TABLE "TrafficDaily" ADD CONSTRAINT "traffic_daily_redirect_visitors_within_redirects"
  CHECK ("websiteRedirectVisitors" <= "websiteRedirects");

-- ============================================================================
-- 4. The day's salt
-- ============================================================================

-- CreateTable
CREATE TABLE "TrafficSalt" (
    "day" DATE NOT NULL,
    "salt" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrafficSalt_pkey" PRIMARY KEY ("day")
);

ALTER TABLE "TrafficSalt" ADD CONSTRAINT "traffic_salt_shape"
  CHECK ("salt" ~ '^[0-9a-f]{64}$');

-- ============================================================================
-- 5. The roll-up's lease
-- ============================================================================

-- CreateTable
CREATE TABLE "TrafficRollupState" (
    "id" TEXT NOT NULL,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "lastCompletedAt" TIMESTAMP(3),

    CONSTRAINT "TrafficRollupState_pkey" PRIMARY KEY ("id")
);

-- One row, by construction: a second state row would be a second lease.
ALTER TABLE "TrafficRollupState" ADD CONSTRAINT "traffic_rollup_state_singleton"
  CHECK ("id" = 'traffic-rollup');

-- A lease has an owner and an expiry, or neither.
ALTER TABLE "TrafficRollupState" ADD CONSTRAINT "traffic_rollup_state_lease_pair" CHECK (
  (("leaseOwner" IS NULL) = ("leaseExpiresAt" IS NULL))
  AND ("leaseOwner" IS NULL OR char_length("leaseOwner") BETWEEN 1 AND 200));

INSERT INTO "TrafficRollupState" ("id") VALUES ('traffic-rollup');
