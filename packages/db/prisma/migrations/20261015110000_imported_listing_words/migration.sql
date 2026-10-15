-- What an import wrote before 2026-10-15 in words a visitor or an
-- administrator reads, put in the words this build writes (the owner,
-- 2026-10-15: "There should be no connection with [that site]"; tickets for
-- imported events are sold on The Desi Events). Data only, no schema.
--
-- Migration 20261015100000_imported_events_sold_here took the addresses out;
-- this one takes out the words, on the rows an import wrote:
--
-- 1. An imported event (one with an `EventImportItem`), in one UPDATE so its
--    revision moves on once (an editor open on the old words must reload):
--    a. its terms (`policies`): the entry and refund sentences the importer
--       wrote, which named that site and said tickets were sold there, become
--       the importer's present ones (`IMPORT_POLICIES` in
--       apps/api/src/lib/event-import.js), the listing's age limit kept. A
--       sentence anybody changed since is left as it is;
--    b. its FAQ (`faq`): an entry that names that site is removed, and so is
--       an entry the import wrote (it is in a stored run's file for the same
--       listing, word for word as far as the event's limits kept it) about
--       that site's terms of sale: refunds, cancelling, buying or going on
--       sale, or that site, its fees, its app or its pages. Tickets are sold
--       here under the event's own terms, which those answers contradicted.
--       An entry an administrator or an organiser wrote is kept;
--    c. its website switch's reason, where it still names that site.
-- 2. The moderation history of an imported event: the notes the import wrote
--    ("Imported from …, run …", "Updated from its … listing, run …").
-- 3. The change notices of an imported event: "Updated from its … listing by
--    the team at …" (public: the event page lists its changes).
-- 4. The administrators' notes on each import record (`importNotes`), in the
--    converter's present words ("The source listing …"), each held to 500
--    characters.
-- 5. The files runs stored: each listing's FAQ and notes, by the same rules.
--
-- Audit rows are history and are left as they were written. The source's enum
-- value (`SULEKHA`) and a run's file name are identifiers and stay.
--
-- Idempotent: a second run finds nothing to change (every pattern it rewrites
-- is gone after the first, and the rows it changes are those whose new value
-- differs). No BEGIN/COMMIT inside: Prisma wraps the file in one transaction.
--
-- Rollback: none. The words replaced named another site and are not restored.

-- ============================================================================
-- 1. Imported events: terms, FAQ and the website switch's reason
-- ============================================================================

UPDATE "Event" AS e
SET
  "policies" = f."policies",
  "faq" = f."faq",
  "websiteRedirectReason" = f."reason",
  "revision" = e."revision" + 1,
  "updatedAt" = CURRENT_TIMESTAMP
FROM (
  SELECT
    ev."id",
    CASE
      WHEN jsonb_typeof(ev."policies") = 'object' THEN
        ev."policies"
        || CASE
          WHEN (ev."policies" ->> 'entry' = 'Entry is run by the organiser. Check the Sulekha listing for their rules.' OR starts_with(ev."policies" ->> 'entry', 'Entry is run by the organiser. Check the Sulekha listing for their rules. Age: '))
            THEN jsonb_build_object('entry', 'Entry is run by the organiser who presents this event. Bring the ticket you bought on The Desi Events.' || substr(ev."policies" ->> 'entry', 74))
          ELSE '{}'::jsonb
        END
        || CASE
          WHEN ev."policies" ->> 'refund' IN ('Tickets for this event are sold on Sulekha, not on The Desi Events. Refunds follow Sulekha''s and the organiser''s terms.', 'Tickets for this event are sold on Sulekha, not on Desi-Event. Refunds follow Sulekha''s and the organiser''s terms.')
            THEN jsonb_build_object('refund', 'Tickets for this event are sold on The Desi Events. If the event is cancelled, every ticket bought here is refunded. For anything else, contact The Desi Events before the event.')
          ELSE '{}'::jsonb
        END
      ELSE ev."policies"
    END AS "policies",
    CASE
      WHEN jsonb_typeof(ev."faq") = 'array' THEN COALESCE(
        (
          SELECT jsonb_agg(el ORDER BY pos)
          FROM jsonb_array_elements(ev."faq") WITH ORDINALITY AS t(el, pos)
          WHERE NOT (
            jsonb_typeof(el) = 'object'
            AND (
              (COALESCE(el ->> 'question', '') || ' ' || COALESCE(el ->> 'answer', '')) ~* 'sulekha'
              OR EXISTS (
                SELECT 1
                FROM "EventImportRun" AS r
                CROSS JOIN LATERAL jsonb_array_elements(
                  CASE WHEN jsonb_typeof(r."dataset" -> 'events') = 'array' THEN r."dataset" -> 'events' ELSE '[]'::jsonb END
                ) AS l(listing)
                CROSS JOIN LATERAL jsonb_array_elements(
                  CASE WHEN jsonb_typeof(l.listing -> 'faq') = 'array' THEN l.listing -> 'faq' ELSE '[]'::jsonb END
                ) AS w(written)
                WHERE r."source" = i."source"
                  AND l.listing ->> 'sourceId' = i."sourceId"
                  AND jsonb_typeof(w.written) = 'object'
                  AND COALESCE(el ->> 'question', '') <> ''
                  AND starts_with(COALESCE(w.written ->> 'q', ''), el ->> 'question')
                  AND starts_with(COALESCE(w.written ->> 'a', ''), COALESCE(el ->> 'answer', ''))
                  AND (COALESCE(w.written ->> 'q', '') ~* '\m(refunds?|cancel(led|lation)?|purchase|buy|go(es)? on sale)\M' OR (COALESCE(w.written ->> 'q', '') || ' ' || COALESCE(w.written ->> 'a', '')) ~* '(ticket(ing)? site|\m(transaction|service) fees?\M|face value|\mour website\M|\mapp\M|\mdropdown\M|sulekha)')
              )
            )
          )
        ),
        '[]'::jsonb
      )
      ELSE ev."faq"
    END AS "faq",
    CASE
      WHEN ev."websiteRedirectReason" ~* 'sulekha' THEN
        regexp_replace(
          regexp_replace(
            regexp_replace(ev."websiteRedirectReason", 'The Sulekha ticket link is off until', 'Its website link is off until', 'g'),
            'sold on its Sulekha page, which this link opens\.', 'sold on its listing.', 'g'
          ),
          'sulekha', 'the source site', 'gi'
        )
      ELSE ev."websiteRedirectReason"
    END AS "reason"
  FROM "Event" AS ev
  JOIN "EventImportItem" AS i ON i."eventId" = ev."id"
) AS f
WHERE e."id" = f."id"
  AND (
    f."policies" IS DISTINCT FROM e."policies"
    OR f."faq" IS DISTINCT FROM e."faq"
    OR f."reason" IS DISTINCT FROM e."websiteRedirectReason"
  );

-- ============================================================================
-- 2. An imported event's moderation history
-- ============================================================================

UPDATE "EventModerationAction" AS m
SET "reason" = regexp_replace(
  regexp_replace(
    regexp_replace(m."reason", 'Imported from Sulekha, run ', 'Imported from its listing, run ', 'g'),
    'from its Sulekha listing', 'from its source listing', 'g'
  ),
  'sulekha', 'the source site', 'gi'
)
WHERE m."reason" ~* 'sulekha'
  AND EXISTS (SELECT 1 FROM "EventImportItem" AS i WHERE i."eventId" = m."eventId");

-- ============================================================================
-- 3. An imported event's change notices
-- ============================================================================

UPDATE "EventChangeNotice" AS c
SET "reason" = regexp_replace(
  regexp_replace(c."reason", 'from its Sulekha listing', 'from its source listing', 'g'),
  'sulekha', 'the source site', 'gi'
)
WHERE c."reason" ~* 'sulekha'
  AND EXISTS (SELECT 1 FROM "EventImportItem" AS i WHERE i."eventId" = c."eventId");

-- ============================================================================
-- 4. The administrators' notes on each import record
-- ============================================================================
--
-- One rule per regexp_replace, innermost first: the converter's own words
-- (neutral-words.mjs), then the file names, then any name left.

UPDATE "EventImportItem" AS i
SET "importNotes" = ARRAY(
  SELECT CASE WHEN char_length(w.note) > 500 THEN left(w.note, 499) || '…' ELSE w.note END
  FROM unnest(i."importNotes") WITH ORDINALITY AS u(note, pos)
  CROSS JOIN LATERAL (
    SELECT
      regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
      regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
        u.note,
        '; the link still goes to the Sulekha page\.', ', the organiser''s own site; on The Desi Events they are sold through this event''s own ticket types.', 'g'),
        'Its Sulekha description', 'Its description on the source listing', 'g'),
        'The Sulekha page', 'The source listing', 'g'),
        'the Sulekha page', 'the source listing', 'g'),
        'Sulekha lists this as ([^;]+);', 'The source listing''s category is \1;', 'g'),
        'Sulekha lists this event twice', 'The source site lists this event twice', 'g'),
        'Sulekha''s export', 'The source listing''s export', 'g'),
        'Sulekha''s "no image" placeholder', 'The source listing''s "no image" placeholder', 'g'),
        'Sulekha''s age field', 'The source listing''s age field', 'g'),
        '"Update from Sulekha"', '"Update from the source listing"', 'g'),
        '\mSulekha (gives|says|shows|marks|labels|lists)\M', 'The source listing \1', 'g'),
        'sulekha-texas-[0-9]{4}\.json', 'the Texas file', 'g'),
        'sulekha-north-america-[0-9]{4}\.json', 'the North America file', 'g'),
        'sulekha''s', 'the source listing''s', 'gi'),
        'sulekha\.com', 'the source site', 'gi'),
        'sulekha', 'the source site', 'gi') AS note
  ) AS w
  ORDER BY u.pos
)
WHERE EXISTS (SELECT 1 FROM unnest(i."importNotes") AS u(note) WHERE u.note ~* 'sulekha');

-- ============================================================================
-- 5. The files runs stored
-- ============================================================================

UPDATE "EventImportRun" AS r
SET "dataset" = f."dataset"
FROM (
  SELECT
    run."id",
    run."dataset" || jsonb_build_object(
      'events',
      COALESCE(
        (
          SELECT jsonb_agg(
            CASE
              WHEN jsonb_typeof(listing) = 'object' THEN
                listing
                || CASE
                  WHEN jsonb_typeof(listing -> 'faq') = 'array' THEN jsonb_build_object(
                    'faq',
                    COALESCE(
                      (
                        SELECT jsonb_agg(entry ORDER BY p)
                        FROM jsonb_array_elements(listing -> 'faq') WITH ORDINALITY AS q(entry, p)
                        WHERE NOT (jsonb_typeof(entry) = 'object' AND (COALESCE(entry ->> 'q', '') ~* '\m(refunds?|cancel(led|lation)?|purchase|buy|go(es)? on sale)\M' OR (COALESCE(entry ->> 'q', '') || ' ' || COALESCE(entry ->> 'a', '')) ~* '(ticket(ing)? site|\m(transaction|service) fees?\M|face value|\mour website\M|\mapp\M|\mdropdown\M|sulekha)'))
                      ),
                      '[]'::jsonb
                    )
                  )
                  ELSE '{}'::jsonb
                END
                || CASE
                  WHEN jsonb_typeof(listing -> 'importNotes') = 'array' THEN jsonb_build_object(
                    'importNotes',
                    COALESCE(
                      (
                        SELECT jsonb_agg(
                          CASE
                            WHEN w.note IS NULL THEN u.n
                            WHEN char_length(w.note) > 500 THEN to_jsonb(left(w.note, 499) || '…')
                            ELSE to_jsonb(w.note)
                          END
                          ORDER BY u.p
                        )
                        FROM jsonb_array_elements(listing -> 'importNotes') WITH ORDINALITY AS u(n, p)
                        CROSS JOIN LATERAL (
                          SELECT CASE WHEN jsonb_typeof(u.n) = 'string' THEN
                            regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
                            regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
                              (u.n #>> '{}'),
                              '; the link still goes to the Sulekha page\.', ', the organiser''s own site; on The Desi Events they are sold through this event''s own ticket types.', 'g'),
                              'Its Sulekha description', 'Its description on the source listing', 'g'),
                              'The Sulekha page', 'The source listing', 'g'),
                              'the Sulekha page', 'the source listing', 'g'),
                              'Sulekha lists this as ([^;]+);', 'The source listing''s category is \1;', 'g'),
                              'Sulekha lists this event twice', 'The source site lists this event twice', 'g'),
                              'Sulekha''s export', 'The source listing''s export', 'g'),
                              'Sulekha''s "no image" placeholder', 'The source listing''s "no image" placeholder', 'g'),
                              'Sulekha''s age field', 'The source listing''s age field', 'g'),
                              '"Update from Sulekha"', '"Update from the source listing"', 'g'),
                              '\mSulekha (gives|says|shows|marks|labels|lists)\M', 'The source listing \1', 'g'),
                              'sulekha-texas-[0-9]{4}\.json', 'the Texas file', 'g'),
                              'sulekha-north-america-[0-9]{4}\.json', 'the North America file', 'g'),
                              'sulekha''s', 'the source listing''s', 'gi'),
                              'sulekha\.com', 'the source site', 'gi'),
                              'sulekha', 'the source site', 'gi')
                          END AS note
                        ) AS w
                      ),
                      '[]'::jsonb
                    )
                  )
                  ELSE '{}'::jsonb
                END
              ELSE listing
            END
            ORDER BY position
          )
          FROM jsonb_array_elements(run."dataset" -> 'events') WITH ORDINALITY AS t(listing, position)
        ),
        '[]'::jsonb
      )
    ) AS "dataset"
  FROM "EventImportRun" AS run
  WHERE jsonb_typeof(run."dataset" -> 'events') = 'array'
) AS f
WHERE r."id" = f."id" AND f."dataset" IS DISTINCT FROM r."dataset";
