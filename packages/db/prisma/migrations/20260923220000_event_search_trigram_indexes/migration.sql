-- Trigram indexes on the event's own text, for the listing search.
--
-- The search matches every word against the event's title, summary and
-- description as well as its venue and organiser. `ILIKE '%word%'` on those
-- three columns read every event row: on a catalogue of about twenty
-- thousand events that was most of the search's cost, and left it within a
-- few tens of milliseconds of its 500ms p95 budget under steady load. With a
-- trigram index on each, every branch of the search's OR can use an index and
-- Postgres answers it with one bitmap scan.
--
-- pg_trgm is created by `20260923210000_search_trigram_indexes`.

-- CreateIndex
CREATE INDEX "Event_title_trgm_idx" ON "Event" USING GIN ("title" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Event_summary_trgm_idx" ON "Event" USING GIN ("summary" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Event_description_trgm_idx" ON "Event" USING GIN ("description" gin_trgm_ops);
