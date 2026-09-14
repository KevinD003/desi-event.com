-- Indexes supporting catalogue facet aggregation.
--
-- Facets are counted over every PUBLISHED event rather than over a page of
-- results, so these aggregates run against the whole table and need to be
-- cheap. Written by hand because Prisma's schema language cannot express a
-- partial index or a GIN index on an array column.

-- Every facet query filters on status first. A partial index keeps it small:
-- drafts, cancelled and completed events are never counted.
CREATE INDEX IF NOT EXISTS "Event_published_category_idx"
  ON "Event" ("category")
  WHERE "status" = 'PUBLISHED';

-- The city facet joins Event to Venue on venueId.
CREATE INDEX IF NOT EXISTS "Event_published_venue_idx"
  ON "Event" ("venueId")
  WHERE "status" = 'PUBLISHED';

-- `languages` is a text[]; GIN is what makes containment and unnest-based
-- aggregation over it affordable.
CREATE INDEX IF NOT EXISTS "Event_languages_gin_idx"
  ON "Event" USING GIN ("languages");

-- The format facet groups on isOnline.
CREATE INDEX IF NOT EXISTS "Event_published_is_online_idx"
  ON "Event" ("isOnline")
  WHERE "status" = 'PUBLISHED';
