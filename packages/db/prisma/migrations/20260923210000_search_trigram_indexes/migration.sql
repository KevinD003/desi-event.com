-- Trigram indexes for the listing search.
--
-- `GET /v1/events` needs every word of a search to appear in the event's own
-- text, its venue's name or city, or its organiser's name, and looks the
-- venues and organisers up first. Those lookups are `ILIKE '%word%'`, which
-- no B-tree can serve, so without these indexes every search scanned both
-- tables in full; under the reliability suite's steady load that pushed the
-- search's p95 past its 500ms budget.
--
-- pg_trgm ships with PostgreSQL and is a trusted extension, so the database
-- owner can create it without superuser rights.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateIndex
CREATE INDEX "Organization_name_trgm_idx" ON "Organization" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Venue_name_trgm_idx" ON "Venue" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Venue_city_trgm_idx" ON "Venue" USING GIN ("city" gin_trgm_ops);
