-- Keep the listing search on its indexes as the catalogue grows.
--
-- The local reliability run failed "Public search — steady" (p95 554-854ms
-- against its 500ms budget) on a 23,607-event test database. The code of
-- 24c09de, which added the Event trigram indexes, failed it on the same data
-- too. Two causes sent every search back to reading every event.
--
-- 1. GIN pending lists. With `fastupdate` on, PostgreSQL's default, a GIN
--    index queues new entries in an unsorted pending list. That list is merged
--    only by VACUUM or when it reaches the 4MB `gin_pending_list_limit`, and
--    every search reads the whole list. The planner counts that cost. With
--    2,038 entries waiting on each Event trigram index (509 pending pages in
--    all), a search cost more through the indexes than through the table.
--    Postgres then read all 23,607 events for every word, even one that
--    matched nothing, at 45-55ms per query. After the lists were merged, the
--    same query took 0.07ms. Autovacuum cannot be relied on to merge them in
--    time: on a 23,000-row table its insert trigger waits for about 5,700 new
--    rows.
--
--    With `fastupdate` off, every write goes straight into the index. A
--    search then costs the same whenever VACUUM last ran. The price is about
--    0.3ms more for each event write that changes indexed text: 500 such
--    updates took 170-195ms instead of 40-44ms. Turning the option off does
--    not merge entries already queued, so `gin_clean_pending_list` merges them
--    here. The venue and organiser trigram indexes get the same setting for
--    the same reason.
--
-- 2. No index on "Event"."venueId". A word that names venues adds
--    `"venueId" IN (...)` to the search's OR; "garba" names 74 venues called
--    Garba Ground. The only index on that column is the facet index for
--    PUBLISHED rows, and the listing asks for four statuses, so it cannot be
--    used. One branch of the OR without a usable index makes Postgres scan
--    every event: 45ms per query, against 0.7ms with this index. The foreign
--    key's ON DELETE SET NULL uses the same index when a venue is deleted.
--
-- The index matches @@index([venueId]) in schema.prisma. Prisma's schema
-- language cannot express a storage parameter, so `fastupdate` is only here;
-- tests/event-search-integration.test.js checks it on a real database.
--
-- Rollback:
--   DROP INDEX "Event_venueId_idx";
--   ALTER INDEX "<each index below>" RESET (fastupdate);

-- CreateIndex
CREATE INDEX "Event_venueId_idx" ON "Event"("venueId");

ALTER INDEX "Event_title_trgm_idx" SET (fastupdate = off);
ALTER INDEX "Event_summary_trgm_idx" SET (fastupdate = off);
ALTER INDEX "Event_description_trgm_idx" SET (fastupdate = off);
ALTER INDEX "Venue_name_trgm_idx" SET (fastupdate = off);
ALTER INDEX "Venue_city_trgm_idx" SET (fastupdate = off);
ALTER INDEX "Organization_name_trgm_idx" SET (fastupdate = off);

-- Merge whatever was already queued. Each call returns the number of pending
-- pages it merged, and the result is discarded.
SELECT
  gin_clean_pending_list('"Event_title_trgm_idx"'::regclass),
  gin_clean_pending_list('"Event_summary_trgm_idx"'::regclass),
  gin_clean_pending_list('"Event_description_trgm_idx"'::regclass),
  gin_clean_pending_list('"Venue_name_trgm_idx"'::regclass),
  gin_clean_pending_list('"Venue_city_trgm_idx"'::regclass),
  gin_clean_pending_list('"Organization_name_trgm_idx"'::regclass);
