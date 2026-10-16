-- The owner confirmed on 2026-10-16 that Canadian prices are in CAD ("Yes
-- works"). The North America file's note on each of its seven Canadian
-- listings with prices asked the administrator to check the currency with the
-- organiser; the file now says the owner confirmed it, and this puts the same
-- words where an import already stored the old ones. Data only, no schema.
--
-- 1. The administrators' notes on each import record (`importNotes`).
-- 2. The files runs stored: each listing's `importNotes`.
-- 3. The plans runs stored, which the run's page reads its notes from: each
--    row's `importNotes`.
--
-- Only that one sentence, word for word, is replaced; any other note, and a
-- note somebody reworded, is left as it is. Audit rows are history and are
-- left as they were written. A stored file's SHA-256 stays that of the file as
-- it was uploaded, as migration 20261015110000_imported_listing_words left it.
-- A run previewed and not applied when this runs is refused at apply because
-- its plan no longer matches its digest, and is uploaded again; a run expires
-- an hour after it is previewed in any case.
--
-- Idempotent: a second run finds the old sentence nowhere. No BEGIN/COMMIT
-- inside: Prisma wraps the file in one transaction.
--
-- Rollback: none. The sentence replaced asked for a check the owner has made.

-- ============================================================================
-- 1. The import records' notes
-- ============================================================================

UPDATE "EventImportItem"
SET "importNotes" = array_replace(
  "importNotes",
  'The source listing shows these prices with a plain $ sign and no currency; the venue is in Canada, so they are imported as Canadian dollars (CAD). Check the currency with the organiser.',
  'The source listing shows these prices with a plain $ sign and no currency; the venue is in Canada, so they are imported as Canadian dollars (CAD). The owner confirmed on 2026-10-16 that Canadian prices are in CAD.'
)
WHERE 'The source listing shows these prices with a plain $ sign and no currency; the venue is in Canada, so they are imported as Canadian dollars (CAD). Check the currency with the organiser.' = ANY("importNotes");

-- ============================================================================
-- 2. The files runs stored, and 3. the plans runs stored
-- ============================================================================
--
-- One function for both: a JSON array of objects, each of whose
-- `importNotes` array has the old sentence replaced. Anything else in the
-- array, or any element that is not an object with such an array, is kept as
-- it is. Dropped at the end: it is this migration's tool, not the schema's.

CREATE FUNCTION "confirm_cad_note_in"(items jsonb) RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    jsonb_agg(
      CASE
        WHEN jsonb_typeof(item) = 'object' AND jsonb_typeof(item -> 'importNotes') = 'array' THEN
          item || jsonb_build_object(
            'importNotes',
            COALESCE(
              (
                SELECT jsonb_agg(
                  CASE
                    WHEN note = to_jsonb('The source listing shows these prices with a plain $ sign and no currency; the venue is in Canada, so they are imported as Canadian dollars (CAD). Check the currency with the organiser.'::text)
                      THEN to_jsonb('The source listing shows these prices with a plain $ sign and no currency; the venue is in Canada, so they are imported as Canadian dollars (CAD). The owner confirmed on 2026-10-16 that Canadian prices are in CAD.'::text)
                    ELSE note
                  END
                  ORDER BY position
                )
                FROM jsonb_array_elements(item -> 'importNotes') WITH ORDINALITY AS n(note, position)
              ),
              '[]'::jsonb
            )
          )
        ELSE item
      END
      ORDER BY position
    ),
    '[]'::jsonb
  )
  FROM jsonb_array_elements(items) WITH ORDINALITY AS i(item, position)
$$;

UPDATE "EventImportRun"
SET "dataset" = "dataset" || jsonb_build_object('events', "confirm_cad_note_in"("dataset" -> 'events'))
WHERE jsonb_typeof("dataset" -> 'events') = 'array'
  AND ("dataset" -> 'events')::text LIKE '%Check the currency with the organiser.%';

UPDATE "EventImportRun"
SET "plan" = "confirm_cad_note_in"("plan")
WHERE jsonb_typeof("plan") = 'array'
  AND "plan"::text LIKE '%Check the currency with the organiser.%';

DROP FUNCTION "confirm_cad_note_in"(jsonb);
