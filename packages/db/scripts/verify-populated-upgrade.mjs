#!/usr/bin/env node
/**
 * Prove the Phase 2 migrations apply to a database that already holds rows.
 *
 * `verify-fresh-database.mjs` walks every migration into an empty database.
 * That is the right check for "does the schema build", and it is blind to the
 * entire class of defect that only a populated table can show. Both migration
 * defects found while writing Phase 2 were in that class:
 *
 *   1. `@updatedAt` generates `ADD COLUMN ... NOT NULL` with no default.
 *      PostgreSQL accepts that on an empty table and refuses it on a populated
 *      one. `Membership` had eight rows, and the migration failed on them.
 *   2. Prisma's generated enum-replacement block carries its own
 *      `BEGIN;`/`COMMIT;`. Prisma already wraps the file in a transaction, so
 *      the inner `COMMIT` ended it early and every later statement ran
 *      auto-committed — leaving a half-applied database that could not be
 *      retried. A fresh database never notices, because the first run succeeds.
 *
 * So this script does the thing an upgrade actually is: apply the migrations
 * that existed before Phase 2, fill every table they created with a row, then
 * apply the Phase 2 migrations on top and check that the data survived and the
 * result matches `schema.prisma` exactly.
 *
 * The migration files are applied with `psql --single-transaction
 * -v ON_ERROR_STOP=1`, which is how Prisma applies them: one transaction per
 * file, aborting on the first error. That is deliberate — it is the behaviour
 * that makes defect (2) visible rather than silent.
 *
 * The same two rules as the fresh verifier are enforced rather than documented:
 * the target's name must be disposable, and only a database this run created is
 * ever dropped. Nothing printed contains a credential.
 *
 * Usage:
 *   pnpm db:verify:upgrade
 *   pnpm db:verify:upgrade --keep
 *   pnpm db:verify:upgrade --report=out.json
 *
 * @module @desi-event/db/scripts/verify-populated-upgrade
 */

import { spawn } from 'node:child_process'
import { readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { config as loadDotenv } from 'dotenv'

import { createPrismaClient } from '../src/index.js'

import {
  assertDisposable,
  databaseName,
  disposableDatabaseName,
  redactedIdentifier as redacted,
  resolveDisposableTarget,
  withDatabase,
} from './disposable-database.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = path.resolve(HERE, '..')
const REPO_ROOT = path.resolve(PACKAGE_ROOT, '..', '..')
const MIGRATIONS = path.join(PACKAGE_ROOT, 'prisma', 'migrations')

loadDotenv({ path: path.join(REPO_ROOT, '.env'), override: false, quiet: true })

/**
 * The migrations Phase 2 added.
 *
 * Everything else is the pre-Phase-2 schema — the state a deployment carrying
 * real rows is upgrading *from*. Listed by name rather than by date range so
 * that adding a Phase 3 migration does not silently move the cut point.
 *
 * @type {string[]}
 */
const PHASE2_MIGRATIONS = Object.freeze([
  '20260915010000_phase2_commerce_and_operations',
  '20260915020000_phase2_integrity_triggers',
  '20260915120000_verification_revoked',
  '20260915180000_map_version_revision',
  '20260915220000_event_lifecycle_integrity',
  // Adds `Event.revision` and constraints on `EventSession` and `TicketType`,
  // both of which are Phase 2 tables. Classified as pre-Phase-2 it ran against
  // a schema that does not have them yet, which is what this verifier is for:
  // it caught its own list being out of date.
  '20260916000000_event_draft_revision',
  // Enum labels only, split from the migration that uses them: PostgreSQL will
  // not let a transaction use a label it added.
  '20260916120000_commerce_lifecycle_enums',
  '20260916130000_commerce_services',
])

/**
 * The migrations Phase 3 added.
 *
 * Listed separately for the reason the Phase 2 list gives: a date range would
 * move the cut point on its own. Without this list a Phase 3 migration is
 * classified as pre-Phase-2 and applied *before* the schema it was written
 * against, which is not an upgrade path anybody will ever run — and the generic
 * filler then tries to populate its tables against constraints designed to
 * refuse a minimum row.
 *
 * They are applied after the Phase 2 group, which is the real order, and
 * proving they apply over existing rows is the same claim this script makes
 * about Phase 2.
 *
 * @type {string[]}
 */
const PHASE3_MIGRATIONS = Object.freeze([
  '20260917060000_privacy_redaction_foundation',
  // Repairs the `desi_payout_currency_matches` function that
  // `20260916130000_commerce_services` installed with a wrong column name.
  // Belongs in this list for a sharper reason than tidiness: the repair is a
  // `CREATE OR REPLACE FUNCTION`, so classified as pre-Phase-2 it installs
  // first and `commerce_services` then re-installs the *broken* body on top of
  // it. The upgraded database silently keeps the defect the migration exists to
  // remove, which is exactly the difference the catalogue comparison below
  // reported.
  '20260921090000_payout_currency_trigger_repair',
  // The Phase 4 admission work: renames a `CheckInMethod` label in place, makes
  // `ScannerScope.eventId` a real foreign key, and adds a trigger refusing a
  // scope that names another organisation's event. It deletes scope rows that
  // name no event or a foreign one before adding either, and applying it over a
  // populated database is exactly the claim this group exists to check.
  '20260922200000_admission_scope_and_method',
  // The listing search's trigram indexes on venue and organiser names. Adds
  // the pg_trgm extension and three GIN indexes; building them over tables
  // that already hold rows is the upgrade case this group proves.
  '20260923210000_search_trigram_indexes',
  // The same kind of index on the event's own title, summary and description,
  // so the whole search is served from indexes.
  '20260923220000_event_search_trigram_indexes',
  // Tier visibility, per-order bounds clamped then checked, the reserved-tier partial index, event content fields.
  '20260928090000_event_authoring_content_and_tier_rules',
  // Replaces the full unique Ticket.eventSeatId index with "one live ticket per seat" (ADR 0006).
  '20260928100000_live_seat_ticket_index',
  // The lazily created GroupPass table and CheckIn.groupPassId, with its admission trigger.
  '20260928110000_group_pass',
  // Invitation.deliveryMode, Organization.createdById, and one pending invitation per address.
  '20260928120000_team_delivery_and_organisation_provenance',
  // MediaAsset.kind to an enum, MediaBlob, the media CHECKs and cover index, and Event.coverImageUrl dropped.
  '20260928130000_event_media',
  // EventSession.label, staged attendee names, and promo code CHECKs after normalising backfills.
  '20260929090000_checkout_promos_attendees_nights',
  // Admission per night: CheckIn unique on (ticketId, eventSessionId) plus one row with no night,
  // and the two ticket triggers rewritten. Swapping a unique index over rows is the upgrade case.
  '20260929100000_check_in_per_night',
  // The listing search's upkeep: Event.venueId indexed, and the six trigram indexes set to
  // fastupdate = off with their pending lists merged, over rows already queued in them.
  '20260929110000_search_index_upkeep',
  // SPEC2: the platform ADMIN role, an enum label on its own because a transaction
  // cannot use a label it added. No row is changed.
  '20260930090000_platform_admin_role',
  // OrganizerInvitation and Membership.organizerInvitationId; waiting team invitations
  // to roles that post events withdrawn, then refused by a CHECK; the review-gate trigger.
  '20260930100000_organiser_invitations_and_review_gate',
  // The event's website and its switch: socialLinks.website carried into websiteUrl
  // (or dropped) over existing rows, the CHECKs and the trigger that keeps "waiting" in step.
  '20260930120000_event_website_link',
  // Visits to event pages: four tables, three enums, and the roll-up's one state row.
  '20260930130000_event_traffic_analytics',
  // SPEC2-XI: the DELETED event status, an enum label on its own because a
  // transaction cannot use a label it added. No row is changed.
  '20260930140000_event_deleted_status',
  // Full control of posted events: deletion columns and their guard, the review
  // gate's restore clause, cancelled nights stamped over existing rows,
  // replacement covers (the one-cover index swapped over existing pictures),
  // platform edit sittings and change notices.
  '20260930150000_event_full_control',
  // Events imported from another site: the platform-held organisation column
  // and its no-members trigger, nights with no listed end, and three tables.
  '20260930160000_event_imports',
  // Indexes on the four foreign keys into tiers and nights that had none, so a
  // tier's or a night's deletion stops reading every order line, hold line and
  // order. Building them over tables that already hold rows is the upgrade case.
  '20261008090000_foreign_key_indexes',
  // SPEC3: the refund reason for a booking fee refunded by hand, alone (a new
  // enum label is not used in the transaction that adds it).
  '20261009090000_refund_reason_booking_fee',
  // Per-event booking fees and referral codes: the Event and Order columns over
  // existing rows, the backfill of each order's fee terms from its snapshot,
  // and the CHECKs every existing row must already satisfy; with SPEC3-XI, the
  // referral return marker and its trigger.
  '20261009100000_payment_terms_and_referral_codes',
  // Paying at the venue: the order, line and ticket columns over existing rows,
  // the door's payment table, and the admission trigger replaced; with
  // SPEC3-XI, the unpaid-cancellation table, columns and triggers, and the
  // sold-count CHECK validated over existing tiers.
  '20261009110000_pay_at_the_venue',
  // The platform-held organisation renamed "The Desi Events" (2026-10-15):
  // data only, over an organisation that still has the first build's name, web
  // address and description, with another organisation already at the new
  // address.
  '20261015090000_platform_held_organisation_name',
  // Imported events sold here, linked to nothing of the source (2026-10-15):
  // two tier columns and their index over existing tiers, every imported
  // event's link to the source cleared, the import record's address and the
  // pictures' table dropped over rows that hold them, the stored datasets and
  // the imported venues' provenance rewritten.
  '20261015100000_imported_events_sold_here',
  // What imports wrote in words naming that site (2026-10-15): data only,
  // over imported events' terms and FAQ, their records' notes, their history
  // and change notices, and a stored file, beside an event nobody imported.
  '20261015110000_imported_listing_words',
  // The owner confirmed Canadian prices are in CAD (2026-10-16): data only,
  // the one note asking to check the currency reworded on an import record,
  // a stored file and a stored plan, beside notes it leaves alone.
  '20261016100000_canadian_prices_confirmed_cad',
  // Door grants by invitation (2026-10-16, ADR 0019): the invitation scope
  // table and its trigger, and the platform-held organisation's no-members
  // trigger replaced so it holds door scanners, over memberships and waiting
  // invitations that already exist.
  '20261016130000_door_grants_by_invitation',
  // Venue regions and countries stored as codes (2026-10-16, ADR 0020): data
  // only, over venues whose state was typed by name or whose code or country
  // was typed in lower case, beside one whose region is no code at all.
  '20261016140000_venue_region_codes',
  // An event moves only without another organisation's door scope (2026-10-16,
  // ADR 0019): the stale scopes deleted and the guard trigger added, over a
  // member's and a waiting invitation's scope on an event that was moved,
  // beside scopes that are their own organisation's.
  '20261016150000_event_move_leaves_no_door_scope',
])

/**
 * The first migration written against the schema the API at a6bd5e4 wrote to.
 *
 * The generic filler runs once, before Phase 2, and gives every column its
 * default — so every backfill after this point used to match no row at all,
 * and a data change that went wrong passed. {@link seedLegacyRows} puts in the
 * rows that API could really write, just before this migration, and
 * {@link checkLegacyBackfills} checks what the migrations made of them.
 */
const FIRST_FEATURE_MIGRATION = '20260928090000_event_authoring_content_and_tier_rules'

/**
 * Rows put in immediately before one migration, because that migration
 * rewrites them.
 *
 * {@link seedLegacyRows} runs once, before the first feature migration, which
 * is right for the backfills written against the schema of that moment. A later
 * migration that rewrites a column added after that moment needs its rows put
 * in against the schema just before it runs, and nothing else can: the column
 * it reads did not exist earlier, and the generic filler gives every column its
 * default. Each fixture receives a fresh client connected to the upgrading
 * database, writes with SQL against the schema as it stands, and returns the
 * rows it added per table so the row-count comparison can expect them. What the
 * migration made of them is checked by {@link checkSpec2Backfills}.
 *
 * @type {Readonly<Record<string, function(object): Promise<Record<string, number>>>>}
 */
const BEFORE_MIGRATION_FIXTURES = Object.freeze({
  // Two waiting team invitations for the filler's organisation: one to a role
  // that posts events, which the migration withdraws, and one it leaves alone.
  '20260930100000_organiser_invitations_and_review_gate': async (prisma) => {
    for (const [id, role, email] of LEGACY_TEAM_INVITATIONS) {
      await prisma.$executeRawUnsafe(
        'INSERT INTO "Invitation" ("id", "organizationId", "email", "role", "tokenHash", ' +
          '"invitedById", "status", "deliveryMode", "createdAt", "expiresAt") VALUES (' +
          `'${id}', 'upgrade-fixture-Organization', '${email}', '${role}', '${id}-digest', ` +
          "'upgrade-fixture-User', 'PENDING', 'MANUAL', '2026-09-20T10:00:00Z', " +
          "'2026-10-04T10:00:00Z')",
      )
    }

    return { Invitation: LEGACY_TEAM_INVITATIONS.length }
  },
  // The filler's event cloned once per legacy website value, each with its own
  // id and slug, carrying the socialLinks the case is about.
  '20260930120000_event_website_link': async (prisma) => {
    const columns = (
      await prisma.$queryRawUnsafe(
        'SELECT column_name FROM information_schema.columns ' +
          "WHERE table_schema = 'public' AND table_name = 'Event' ORDER BY ordinal_position",
      )
    ).map((row) => row.column_name)

    for (const legacy of LEGACY_WEBSITES) {
      const literal = (text) => `'${text.replaceAll("'", "''")}'`
      const values = columns.map((column) => {
        if (column === 'id' || column === 'slug') return literal(legacy.id)
        if (column === 'socialLinks') return `${literal(JSON.stringify(legacy.socialLinks))}::jsonb`

        return `"${column}"`
      })

      await prisma.$executeRawUnsafe(
        `INSERT INTO "Event" (${columns.map((column) => `"${column}"`).join(', ')}) ` +
          `SELECT ${values.join(', ')} FROM "Event" WHERE "id" = 'upgrade-fixture-Event'`,
      )
    }

    const [{ n }] = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM "Event" WHERE "id" LIKE 'legacy-website-%'`,
    )
    if (n !== LEGACY_WEBSITES.length) {
      throw new Error(`expected ${LEGACY_WEBSITES.length} cloned events, found ${n}`)
    }

    return { Event: LEGACY_WEBSITES.length }
  },
  // A night cancelled before nights carried a cancellation stamp: the legacy
  // first night cloned with status CANCELLED and a known updatedAt, which the
  // migration's backfill must copy into cancelledAt before its CHECK goes on.
  '20260930150000_event_full_control': async (prisma) => {
    const columns = (
      await prisma.$queryRawUnsafe(
        'SELECT column_name FROM information_schema.columns ' +
          "WHERE table_schema = 'public' AND table_name = 'EventSession' ORDER BY ordinal_position",
      )
    ).map((row) => row.column_name)
    const values = columns.map((column) => {
      if (column === 'id') return `'${LEGACY_CANCELLED_NIGHT.id}'`
      if (column === 'status') return "'CANCELLED'"
      if (column === 'updatedAt') return `'${LEGACY_CANCELLED_NIGHT.updatedAt}'`

      return `"${column}"`
    })

    await prisma.$executeRawUnsafe(
      `INSERT INTO "EventSession" (${columns.map((column) => `"${column}"`).join(', ')}) ` +
        `SELECT ${values.join(', ')} FROM "EventSession" WHERE "id" = '${LEGACY_CANCELLED_NIGHT.from}'`,
    )

    const [{ n }] = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM "EventSession" WHERE "id" = '${LEGACY_CANCELLED_NIGHT.id}' ` +
        `AND "status" = 'CANCELLED'`,
    )
    if (n !== 1) throw new Error(`expected the cancelled night to be cloned, found ${n}`)

    return { EventSession: 1 }
  },
  // Orders placed before the payment-terms migration, each cloned from the
  // filler's: one whose snapshot carries the site default's terms (5.90% +
  // $0.99, a $3.35 fee on $40), one with no snapshot and no fee, and one whose
  // snapshot carries a percentage that is not a whole number, which the
  // backfill must leave unrecorded rather than fail on.
  '20261009100000_payment_terms_and_referral_codes': async (prisma) => {
    const columns = (
      await prisma.$queryRawUnsafe(
        'SELECT column_name FROM information_schema.columns ' +
          "WHERE table_schema = 'public' AND table_name = 'Order' ORDER BY ordinal_position",
      )
    ).map((row) => row.column_name)

    for (const legacy of LEGACY_FEE_ORDERS) {
      const literal = (text) => `'${text.replaceAll("'", "''")}'`
      const values = columns.map((column) => {
        if (column === 'id' || column === 'reference') return literal(legacy.id)
        if (column === 'idempotencyKey') return 'NULL'
        if (column === 'pricingSnapshot') {
          return legacy.snapshot === null
            ? 'NULL'
            : `${literal(JSON.stringify(legacy.snapshot))}::jsonb`
        }
        if (column === 'subtotalCents') return String(legacy.subtotalCents)
        if (column === 'feesCents') return String(legacy.feesCents)
        if (column === 'totalCents') return String(legacy.subtotalCents + legacy.feesCents)

        return `"${column}"`
      })

      await prisma.$executeRawUnsafe(
        `INSERT INTO "Order" (${columns.map((column) => `"${column}"`).join(', ')}) ` +
          `SELECT ${values.join(', ')} FROM "Order" WHERE "id" = 'upgrade-fixture-Order'`,
      )
    }

    const [{ n }] = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM "Order" WHERE "id" LIKE 'legacy-fee-order-%'`,
    )
    if (n !== LEGACY_FEE_ORDERS.length) {
      throw new Error(`expected ${LEGACY_FEE_ORDERS.length} cloned orders, found ${n}`)
    }

    return { Order: LEGACY_FEE_ORDERS.length }
  },
  // As a database made before 2026-10-15 holds an import: events cloned from
  // the filler's, one imported with its link to the source on, one imported
  // with the source's address waiting, one imported whose decided link is the
  // organiser's own while its address is the source's, and one nobody
  // imported that names the source; their import records with the listing's
  // address and a copied picture's row; an imported venue; and a run that
  // stored the old file.
  '20261015100000_imported_events_sold_here': async (prisma) => {
    const columns = (
      await prisma.$queryRawUnsafe(
        'SELECT column_name FROM information_schema.columns ' +
          "WHERE table_schema = 'public' AND table_name = 'Event' ORDER BY ordinal_position",
      )
    ).map((row) => row.column_name)
    const literal = (text) => (text === null ? 'NULL' : `'${text.replaceAll("'", "''")}'`)

    for (const legacy of LEGACY_IMPORTED_EVENTS) {
      const values = columns.map((column) => {
        if (column === 'id' || column === 'slug') return literal(legacy.id)
        if (column in legacy.website) {
          const value = legacy.website[column]

          if (typeof value === 'boolean') return String(value)

          return value === null ? 'NULL' : literal(value)
        }
        if (column === 'websiteRedirectChangedById') {
          return legacy.website.websiteRedirectEnabled || legacy.website.websiteDecidedUrl
            ? "'upgrade-fixture-User'"
            : 'NULL'
        }

        return `"${column}"`
      })

      await prisma.$executeRawUnsafe(
        `INSERT INTO "Event" (${columns.map((column) => `"${column}"`).join(', ')}) ` +
          `SELECT ${values.join(', ')} FROM "Event" WHERE "id" = 'upgrade-fixture-Event'`,
      )
    }

    let items = 0

    for (const [index, legacy] of LEGACY_IMPORTED_EVENTS.entries()) {
      if (!legacy.imported) continue

      items += 1
      await prisma.$executeRawUnsafe(
        'INSERT INTO "EventImportItem" ("id", "source", "sourceId", "sourceUrl", "eventId", ' +
          '"scrapedAt", "prices", "importNotes") VALUES (' +
          `${literal(`${legacy.id}-item`)}, 'SULEKHA', '${9100000000 + index}', ` +
          `${literal(LEGACY_SOURCE_LINK(index))}, ${literal(legacy.id)}, '2026-09-29T21:25:00Z', ` +
          "'[]'::jsonb, ARRAY[]::text[])",
      )
    }

    await prisma.$executeRawUnsafe(
      'INSERT INTO "EventImportImage" ("id", "itemId", "url", "role", "alt", "position", "status") ' +
        `VALUES ('legacy-import-picture', '${LEGACY_IMPORTED_EVENTS[0].id}-item', ` +
        "'https://usimg.sulekha.io/cdn/events/images/legacy.webp', 'COVER', 'A poster', 0, 'WAITING')",
    )

    const venueColumns = (
      await prisma.$queryRawUnsafe(
        'SELECT column_name FROM information_schema.columns ' +
          "WHERE table_schema = 'public' AND table_name = 'Venue' ORDER BY ordinal_position",
      )
    ).map((row) => row.column_name)
    const venueValues = venueColumns.map((column) => {
      if (column === 'id') return `'${LEGACY_IMPORTED_VENUE}'`
      if (column === 'slug') return 'NULL'
      if (column === 'provenance') return "'import:sulekha'"

      return `"${column}"`
    })

    await prisma.$executeRawUnsafe(
      `INSERT INTO "Venue" (${venueColumns.map((column) => `"${column}"`).join(', ')}) ` +
        `SELECT ${venueValues.join(', ')} FROM "Venue" WHERE "id" = 'upgrade-fixture-Venue'`,
    )
    await prisma.$executeRawUnsafe(
      'INSERT INTO "EventImportRun" ("id", "source", "status", "fileName", "datasetSha256", ' +
        '"dataset", "plan", "planDigest", "eventCount", "createdAt", "expiresAt") VALUES (' +
        `'${LEGACY_IMPORT_RUN}', 'SULEKHA', 'PREVIEWED', 'sulekha-texas-2026.json', '${'e'.repeat(64)}', ` +
        `${literal(JSON.stringify(LEGACY_IMPORT_DATASET))}::jsonb, '[]'::jsonb, '${'f'.repeat(64)}', 1, ` +
        "'2026-10-15T00:00:00Z', '2026-10-16T00:00:00Z')",
    )

    const [{ n }] = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM "Event" WHERE "id" LIKE 'legacy-import-%'`,
    )
    if (n !== LEGACY_IMPORTED_EVENTS.length) {
      throw new Error(`expected ${LEGACY_IMPORTED_EVENTS.length} cloned events, found ${n}`)
    }

    return {
      Event: LEGACY_IMPORTED_EVENTS.length,
      EventImportItem: items,
      EventImportImage: 1,
      EventImportRun: 1,
      Venue: 1,
    }
  },
  // The words an import wrote before 2026-10-15, on the rows the 2026-10-15
  // fixture above put in: an imported event's terms and FAQ (the import's own
  // and one an administrator added), its record's notes, its history and its
  // change notice, and the stored file's FAQ and notes; and the same terms on
  // the event nobody imported.
  '20261015110000_imported_listing_words': async (prisma) => {
    const literal = (text) => `'${text.replaceAll("'", "''")}'`
    const json = (value) => `${literal(JSON.stringify(value))}::jsonb`
    const imported = LEGACY_IMPORTED_EVENTS[0].id

    await prisma.$executeRawUnsafe(
      `UPDATE "Event" SET "policies" = ${json(LEGACY_IMPORT_WORDS.policies)}, ` +
        `"faq" = ${json(LEGACY_IMPORT_WORDS.faq)} WHERE "id" = ${literal(imported)}`,
    )
    await prisma.$executeRawUnsafe(
      `UPDATE "Event" SET "policies" = ${json(LEGACY_IMPORT_WORDS.policies)} ` +
        `WHERE "id" = 'legacy-import-not-imported'`,
    )
    await prisma.$executeRawUnsafe(
      'UPDATE "EventImportItem" SET "importNotes" = ARRAY[' +
        `${LEGACY_IMPORT_WORDS.notes.map(literal).join(', ')}]::text[] ` +
        `WHERE "eventId" = ${literal(imported)}`,
    )

    for (const [index, reason] of LEGACY_IMPORT_WORDS.history.entries()) {
      await prisma.$executeRawUnsafe(
        'INSERT INTO "EventModerationAction" ("id", "eventId", "fromStatus", "toStatus", "reason") ' +
          `VALUES ('legacy-import-history-${index}', ${literal(imported)}, 'DRAFT', ` +
          `'REVIEW_PENDING', ${literal(reason)})`,
      )
    }

    await prisma.$executeRawUnsafe(
      'INSERT INTO "EventChangeNotice" ("id", "eventId", "kind", "reason", "byPlatform") ' +
        `VALUES ('legacy-import-notice', ${literal(imported)}, 'MATERIAL_CHANGE', ` +
        `${literal(LEGACY_IMPORT_WORDS.notice)}, true)`,
    )
    await prisma.$executeRawUnsafe(
      `UPDATE "EventImportRun" SET "dataset" = jsonb_set("dataset", '{events,0}', ` +
        `("dataset" #> '{events,0}') || ${json({
          faq: LEGACY_IMPORT_WORDS.fileFaq,
          importNotes: [LEGACY_IMPORT_WORDS.notes[0]],
        })}) WHERE "id" = '${LEGACY_IMPORT_RUN}'`,
    )

    return {
      EventModerationAction: LEGACY_IMPORT_WORDS.history.length,
      EventChangeNotice: 1,
    }
  },
  // The note asking to check a Canadian listing's currency, as the North
  // America file wrote it before 2026-10-16: on an import record beside a
  // note in other words and an unrelated one, and in a stored run's file and
  // plan beside a listing with no notes at all.
  '20261016100000_canadian_prices_confirmed_cad': async (prisma) => {
    const literal = (text) => `'${text.replaceAll("'", "''")}'`
    const json = (value) => `${literal(JSON.stringify(value))}::jsonb`

    await prisma.$executeRawUnsafe(
      'UPDATE "EventImportItem" SET "importNotes" = ARRAY[' +
        `${[CAD_NOTE.other, CAD_NOTE.before, CAD_NOTE.reworded].map(literal).join(', ')}]::text[] ` +
        `WHERE "eventId" = ${literal(LEGACY_IMPORTED_EVENTS[1].id)}`,
    )
    await prisma.$executeRawUnsafe(
      'INSERT INTO "EventImportRun" ("id", "source", "status", "fileName", "datasetSha256", ' +
        '"dataset", "plan", "planDigest", "eventCount", "createdAt", "expiresAt", "appliedAt") VALUES (' +
        `'${LEGACY_CAD_RUN}', 'SULEKHA', 'APPLIED', 'north-america-2026.json', '${'c'.repeat(64)}', ` +
        `${json({
          format: 'desi-event-import/1',
          source: 'SULEKHA',
          events: [
            {
              sourceId: '9100000101',
              title: 'A Canadian listing',
              importNotes: [CAD_NOTE.before, CAD_NOTE.other],
            },
            { sourceId: '9100000102', title: 'A listing with no notes' },
          ],
        })}, ` +
        `${json([
          { sourceId: '9100000101', action: 'CREATE', importNotes: [CAD_NOTE.before] },
          { sourceId: '9100000102', action: 'CREATE', importNotes: [] },
        ])}, '${'d'.repeat(64)}', 2, '2026-10-15T00:00:00Z', '2026-10-15T01:00:00Z', '2026-10-15T00:30:00Z')`,
    )

    return { EventImportRun: 1 }
  },
  // Venues as an organiser could type them before venue writes stored codes,
  // cloned from the filler's venue.
  '20261016140000_venue_region_codes': async (prisma) => {
    const columns = (
      await prisma.$queryRawUnsafe(
        'SELECT column_name FROM information_schema.columns ' +
          "WHERE table_schema = 'public' AND table_name = 'Venue' ORDER BY ordinal_position",
      )
    ).map((row) => row.column_name)

    for (const legacy of LEGACY_TYPED_VENUES) {
      const values = columns.map((column) => {
        if (column === 'id') return literalSql(legacy.id)
        if (column === 'slug') return 'NULL'
        if (column === 'region') return literalSql(legacy.region)
        if (column === 'country') return literalSql(legacy.country)

        return `"${column}"`
      })

      await prisma.$executeRawUnsafe(
        `INSERT INTO "Venue" (${columns.map((column) => `"${column}"`).join(', ')}) ` +
          `SELECT ${values.join(', ')} FROM "Venue" WHERE "id" = 'upgrade-fixture-Venue'`,
      )
    }

    return { Venue: LEGACY_TYPED_VENUES.length }
  },
  // Two events of the filler's organisation, each with a member's door scope
  // and a waiting STAFF invitation's; then one of them is moved to another
  // organisation, as an imported event's reassignment did before the guard.
  '20261016150000_event_move_leaves_no_door_scope': async (prisma) => {
    const columns = (
      await prisma.$queryRawUnsafe(
        'SELECT column_name FROM information_schema.columns ' +
          "WHERE table_schema = 'public' AND table_name = 'Event' ORDER BY ordinal_position",
      )
    ).map((row) => row.column_name)

    for (const id of [LEGACY_DOOR.kept, LEGACY_DOOR.moved]) {
      const values = columns.map((column) =>
        column === 'id' || column === 'slug' ? literalSql(id) : `"${column}"`,
      )

      await prisma.$executeRawUnsafe(
        `INSERT INTO "Event" (${columns.map((column) => `"${column}"`).join(', ')}) ` +
          `SELECT ${values.join(', ')} FROM "Event" WHERE "id" = 'upgrade-fixture-Event'`,
      )
    }

    const [membership] = await prisma.$queryRawUnsafe(
      'SELECT "id" FROM "Membership" WHERE "organizationId" = ' +
        `(SELECT "organizationId" FROM "Event" WHERE "id" = 'upgrade-fixture-Event') ORDER BY "id" LIMIT 1`,
    )

    if (!membership) throw new Error('no membership of the filler event’s organisation')

    for (const id of [LEGACY_DOOR.kept, LEGACY_DOOR.moved]) {
      await prisma.$executeRawUnsafe(
        'INSERT INTO "ScannerScope" ("id", "membershipId", "eventId") VALUES (' +
          `${literalSql(`${id}-member`)}, ${literalSql(membership.id)}, ${literalSql(id)})`,
      )
      await prisma.$executeRawUnsafe(
        'INSERT INTO "InvitationScope" ("id", "invitationId", "eventId") VALUES (' +
          `${literalSql(`${id}-invitation`)}, 'upgrade-invite-staff', ${literalSql(id)})`,
      )
    }

    await prisma.$executeRawUnsafe(
      `UPDATE "Event" SET "organizationId" = ${literalSql(LEGACY_ORGANISATIONS[1].id)} ` +
        `WHERE "id" = ${literalSql(LEGACY_DOOR.moved)}`,
    )

    // The moved event's two scopes go; the kept event's stay.
    return { Event: 2, ScannerScope: 1, InvitationScope: 1 }
  },
  // The platform-held organisation as the first build made it, and an ordinary
  // organisation that already has the address it is renamed to, both cloned
  // from the filler's organisation.
  '20261015090000_platform_held_organisation_name': async (prisma) => {
    const columns = (
      await prisma.$queryRawUnsafe(
        'SELECT column_name FROM information_schema.columns ' +
          "WHERE table_schema = 'public' AND table_name = 'Organization' ORDER BY ordinal_position",
      )
    ).map((row) => row.column_name)
    const literal = (text) => (text === null ? 'NULL' : `'${text.replaceAll("'", "''")}'`)

    for (const legacy of LEGACY_ORGANISATIONS) {
      const values = columns.map((column) => {
        if (column === 'id') return literal(legacy.id)
        if (column === 'slug') return literal(legacy.slug)
        if (column === 'name') return literal(legacy.name)
        if (column === 'description') return literal(legacy.description)
        if (column === 'platformHeldSource') {
          return legacy.platformHeldSource ? `'${legacy.platformHeldSource}'` : 'NULL'
        }

        return `"${column}"`
      })

      await prisma.$executeRawUnsafe(
        `INSERT INTO "Organization" (${columns.map((column) => `"${column}"`).join(', ')}) ` +
          `SELECT ${values.join(', ')} FROM "Organization" WHERE "id" = 'upgrade-fixture-Organization'`,
      )
    }

    const [{ n }] = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM "Organization" WHERE "id" LIKE 'legacy-organisation-%'`,
    )
    if (n !== LEGACY_ORGANISATIONS.length) {
      throw new Error(`expected ${LEGACY_ORGANISATIONS.length} cloned organisations, found ${n}`)
    }

    return { Organization: LEGACY_ORGANISATIONS.length }
  },
})

/**
 * The organisations {@link BEFORE_MIGRATION_FIXTURES} puts in before the
 * platform-held organisation is renamed. The first is the platform-held one as
 * the first build made it (these are the values the migration compares; no
 * page shows them now). The second is an ordinary organisation that already
 * has the new address, so the migration must make the renamed one's unique.
 */
const LEGACY_ORGANISATIONS = Object.freeze([
  Object.freeze({
    id: 'legacy-organisation-platform-held',
    slug: 'sulekha-events',
    name: 'Sulekha Events',
    description:
      'Events listed on Sulekha.com and shown on The Desi Events by its team. Each event page names the organiser who runs it. Tickets for these events are sold on Sulekha.',
    platformHeldSource: 'SULEKHA',
  }),
  Object.freeze({
    id: 'legacy-organisation-address-taken',
    slug: 'the-desi-events',
    name: 'Desi Events of Ohio',
    description: null,
    platformHeldSource: null,
  }),
])

/**
 * A listing's own page on the source's site, as files before 2026-10-15 named
 * it: test data for the migration that clears such links.
 *
 * @param {number} index Which listing.
 * @returns {string} The address.
 */
const LEGACY_SOURCE_LINK = (index) =>
  `https://events.sulekha.com/garba-night_event-in_irving-tx_${9100000000 + index}`

/** The organiser's own page, which the migration must leave alone. */
const LEGACY_ORGANISER_SITE = 'https://dfw-garba.example/tickets'

/**
 * The events {@link BEFORE_MIGRATION_FIXTURES} puts in before
 * `20261015100000_imported_events_sold_here`, with their website columns, and
 * whether each was imported.
 */
const LEGACY_IMPORTED_EVENTS = Object.freeze([
  Object.freeze({
    id: 'legacy-import-on',
    imported: true,
    website: {
      websiteUrl: LEGACY_SOURCE_LINK(0),
      websiteRedirectEnabled: true,
      websiteDecidedUrl: LEGACY_SOURCE_LINK(0),
      websiteDecisionPending: false,
      websiteSubmittedAt: null,
      websiteRedirectChangedAt: '2026-10-01T12:00:00Z',
      websiteRedirectReason: 'Tickets for this event are sold on its listing.',
    },
  }),
  Object.freeze({
    id: 'legacy-import-waiting',
    imported: true,
    website: {
      websiteUrl: LEGACY_SOURCE_LINK(1),
      websiteRedirectEnabled: false,
      websiteDecidedUrl: null,
      websiteDecisionPending: true,
      websiteSubmittedAt: '2026-10-01T12:00:00Z',
      websiteRedirectChangedAt: null,
      websiteRedirectReason: null,
    },
  }),
  Object.freeze({
    id: 'legacy-import-mixed',
    imported: true,
    website: {
      websiteUrl: LEGACY_SOURCE_LINK(2),
      websiteRedirectEnabled: true,
      websiteDecidedUrl: LEGACY_ORGANISER_SITE,
      websiteDecisionPending: true,
      websiteSubmittedAt: '2026-10-01T12:00:00Z',
      websiteRedirectChangedAt: '2026-10-01T12:00:00Z',
      websiteRedirectReason: 'The organiser’s own page.',
    },
  }),
  Object.freeze({
    id: 'legacy-import-not-imported',
    imported: false,
    website: {
      websiteUrl: LEGACY_SOURCE_LINK(3),
      websiteRedirectEnabled: false,
      websiteDecidedUrl: null,
      websiteDecisionPending: true,
      websiteSubmittedAt: '2026-10-01T12:00:00Z',
      websiteRedirectChangedAt: null,
      websiteRedirectReason: null,
    },
  }),
])

/** The imported venue and the run the same fixture puts in. */
const LEGACY_IMPORTED_VENUE = 'legacy-import-venue'
const LEGACY_IMPORT_RUN = 'legacy-import-run'

/** The file that run stored, as files were before 2026-10-15. */
const LEGACY_IMPORT_DATASET = Object.freeze({
  format: 'desi-event-import/1',
  source: 'SULEKHA',
  sourceName: 'Sulekha',
  sourceSite: 'https://events.sulekha.com/',
  imageHosts: ['usimg.sulekha.io'],
  events: [
    {
      sourceId: '9100000000',
      sourceUrl: LEGACY_SOURCE_LINK(0),
      ticketUrl: LEGACY_SOURCE_LINK(0),
      images: [{ url: 'https://usimg.sulekha.io/cdn/events/images/legacy.webp' }],
      title: 'Kept as it was',
    },
  ],
})

/**
 * The words an import wrote before 2026-10-15, as
 * {@link BEFORE_MIGRATION_FIXTURES} puts them in before
 * `20261015110000_imported_listing_words`, and what that migration must make
 * of them ({@link checkImportedListingWords}).
 */
const LEGACY_IMPORT_WORDS = Object.freeze({
  policies: {
    entry: 'Entry is run by the organiser. Check the Sulekha listing for their rules. Age: 21+.',
    refund:
      "Tickets for this event are sold on Sulekha, not on The Desi Events. Refunds follow Sulekha's and the organiser's terms.",
    conduct: "The organiser's and the venue's rules apply.",
  },
  faq: [
    {
      question: "What is Sulekha's Refund Policy?",
      answer: 'Sulekha refunds only the face value.',
    },
    { question: 'What is the refund policy?', answer: 'All sales are final.' },
    { question: 'Where is it happening?', answer: 'At the hall.' },
    { question: 'Is there parking?', answer: 'Yes, on site, written by the team.' },
  ],
  fileFaq: [
    { q: "What is Sulekha's Refund Policy?", a: 'Sulekha refunds only the face value.' },
    { q: 'What is the refund policy?', a: 'All sales are final.' },
    { q: 'Where is it happening?', a: 'At the hall.' },
  ],
  notes: [
    'Sulekha shows these prices in Canadian dollars (CA$); they are imported as CAD.',
    'This listing is also in sulekha-texas-2026.json (collected 29-30 September 2026).',
  ],
  history: [
    'Imported from Sulekha, run legacy-import-run.',
    'Updated from its Sulekha listing, run legacy-import-run.',
  ],
  notice: 'Updated from its Sulekha listing by the team at The Desi Events, run legacy-import-run.',
})

/**
 * The note `20261016100000_canadian_prices_confirmed_cad` rewrites, what it
 * becomes, and a note in other words it must leave alone.
 */
const CAD_NOTE = Object.freeze({
  before:
    'The source listing shows these prices with a plain $ sign and no currency; the venue is in Canada, so they are imported as Canadian dollars (CAD). Check the currency with the organiser.',
  after:
    'The source listing shows these prices with a plain $ sign and no currency; the venue is in Canada, so they are imported as Canadian dollars (CAD). The owner confirmed on 2026-10-16 that Canadian prices are in CAD.',
  reworded: 'Prices look Canadian. Check the currency with the organiser.',
  other: 'Kids under 5 free.',
})

/** The run that fixture stores, with a file and a plan holding the note. */
const LEGACY_CAD_RUN = 'legacy-import-run-cad'

/**
 * Venues as typed before venue writes stored codes, and what
 * `20261016140000_venue_region_codes` must make of each.
 */
const LEGACY_TYPED_VENUES = Object.freeze([
  { id: 'legacy-venue-texas', region: 'Texas', country: 'us', after: ['TX', 'US'] },
  { id: 'legacy-venue-jersey', region: ' new  JERSEY ', country: 'US', after: ['NJ', 'US'] },
  { id: 'legacy-venue-quebec', region: 'Québec', country: 'CA', after: ['QC', 'CA'] },
  { id: 'legacy-venue-code', region: ' on ', country: 'ca', after: ['ON', 'CA'] },
  { id: 'legacy-venue-other', region: 'Maharashtra', country: 'IN', after: ['Maharashtra', 'IN'] },
])

/** The events `20261016150000_event_move_leaves_no_door_scope`'s fixture scopes. */
const LEGACY_DOOR = Object.freeze({ kept: 'legacy-door-kept', moved: 'legacy-door-moved' })

/** What the rename migration makes of the platform-held organisation. */
const RENAMED_PLATFORM_HELD = Object.freeze({
  name: 'The Desi Events',
  description:
    "Events imported from organisers' public ticket listings and shown on The Desi Events by its team. Each event page names the organiser who presents it. Tickets for these events are sold on The Desi Events, and can also be reserved on WhatsApp.",
})

/**
 * Orders cloned before the payment-terms migration, and the fee terms its
 * backfill must record for each (null when the snapshot carries none usable).
 */
const LEGACY_FEE_ORDERS = Object.freeze([
  {
    id: 'legacy-fee-order-snapshot',
    snapshot: {
      currency: 'USD',
      feeConfig: { percentageBps: 590, flatCents: 99, currency: 'USD' },
      tax: { jurisdiction: 'US', rateBps: 0, source: 'DEMO' },
    },
    subtotalCents: 4000,
    feesCents: 335,
    percentageBps: 590,
    flatCentsPerTicket: 99,
  },
  {
    id: 'legacy-fee-order-none',
    snapshot: null,
    subtotalCents: 4000,
    feesCents: 0,
    percentageBps: null,
    flatCentsPerTicket: null,
  },
  {
    id: 'legacy-fee-order-fractional',
    snapshot: {
      currency: 'USD',
      feeConfig: { percentageBps: 590.5, flatCents: 99, currency: 'USD' },
    },
    subtotalCents: 4000,
    feesCents: 335,
    percentageBps: null,
    flatCentsPerTicket: null,
  },
])

/**
 * The night cloned before the full-control migration with status CANCELLED, and
 * the `updatedAt` its backfilled `cancelledAt` must equal.
 */
const LEGACY_CANCELLED_NIGHT = Object.freeze({
  id: 'legacy-night-cancelled',
  from: 'legacy-night-1',
  updatedAt: '2026-09-20T12:34:56.000Z',
})

/** Waiting team invitations before the posting-role rule: id, role, address. */
const LEGACY_TEAM_INVITATIONS = Object.freeze([
  ['upgrade-invite-admin', 'ADMIN', 'posting.role@example.test'],
  ['upgrade-invite-staff', 'STAFF', 'staff.role@example.test'],
])

/**
 * Legacy `socialLinks.website` values, and what the website migration must make
 * of each: the stored address, or null when the value is dropped.
 */
const LEGACY_WEBSITES = Object.freeze([
  {
    id: 'legacy-website-mixed-case',
    socialLinks: { website: 'HTTPS://Example.ORG', instagram: 'https://instagram.com/x' },
    carried: 'https://example.org/',
  },
  {
    id: 'legacy-website-sign-in',
    socialLinks: { website: 'https://u:p@a.example/' },
    carried: null,
  },
  { id: 'legacy-website-port', socialLinks: { website: 'https://a.example:8443/' }, carried: null },
  { id: 'legacy-website-ip', socialLinks: { website: 'https://1.2.3.4/' }, carried: null },
  { id: 'legacy-website-null', socialLinks: { website: null }, carried: null },
  {
    id: 'legacy-website-token',
    socialLinks: { website: 'https://a.example/?token=x' },
    carried: 'https://a.example/?token=x',
  },
  { id: 'legacy-website-pipe', socialLinks: { website: 'https://a.example/a|b' }, carried: null },
  {
    id: 'legacy-website-dot-segment',
    socialLinks: { website: 'https://a.example/x/../y' },
    carried: null,
  },
])

/**
 * Rows the generic filler cannot produce, because a CHECK constraint means the
 * minimum legal row is not the minimum row.
 *
 * `TicketHold` is the clearest case: ownership is exactly one of a signed-in
 * user or a hashed guest token, and a row with neither — or with both — is
 * refused. The filler would supply neither, and it populates nullable foreign
 * keys, so it would then supply both. `'NULL'` says "leave this one empty".
 *
 * @type {Readonly<Record<string, Record<string, string>>>}
 */
const OVERRIDES = Object.freeze({
  TicketHold: { guestTokenHash: `'${'c'.repeat(64)}'`, userId: 'NULL' },
  // `event_ends_after_start`, added by the lifecycle migration. The filler
  // gives every timestamp the same value, which is fine until a constraint
  // says one has to be strictly later than another. An event that ends at the
  // moment it starts is exactly what the constraint exists to refuse.
  Event: { startsAt: `'2026-01-01T18:00:00Z'`, endsAt: `'2026-01-01T21:00:00Z'` },
})

/** Steps recorded for the report, in the order they ran. */
const steps = []

/**
 * Record a step's outcome.
 *
 * @param {string} name What was checked.
 * @param {boolean} ok Whether it passed.
 * @param {object} [detail] Anything worth quoting in the report.
 * @returns {boolean} `ok`, so callers can branch on it.
 */
function record(name, ok, detail = {}) {
  steps.push({ name, ok, ...detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail.note ? ` — ${detail.note}` : ''}`)

  return ok
}

/**
 * Run a command and resolve with its exit code and combined output.
 *
 * @param {string} command The executable.
 * @param {string[]} args Its arguments.
 * @param {object} [options] Spawn options; `env` is merged over the current environment.
 * @returns {Promise<{code: number, output: string}>} Exit code and output.
 */
function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? PACKAGE_ROOT,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let output = ''
    child.stdout.on('data', (chunk) => {
      output += chunk
    })
    child.stderr.on('data', (chunk) => {
      output += chunk
    })

    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? 1, output }))
  })
}

/**
 * A connection string `psql` will accept.
 *
 * Prisma's URLs carry parameters libpq has never heard of — `schema=public`
 * above all — and psql refuses the whole URI rather than ignoring them. Only
 * the parameters libpq understands survive.
 *
 * @param {string} url A Prisma connection string.
 * @returns {string} The same connection, spelled for libpq.
 */
function libpqUrl(url) {
  const next = new URL(url)
  const allowed = new Set([
    'sslmode',
    'sslrootcert',
    'sslcert',
    'sslkey',
    'connect_timeout',
    'application_name',
  ])

  for (const key of [...next.searchParams.keys()]) {
    if (!allowed.has(key)) next.searchParams.delete(key)
  }

  return next.toString()
}

/**
 * Apply one migration file the way Prisma applies it: one transaction, aborting
 * on the first error.
 *
 * @param {string} target The disposable connection string.
 * @param {string} migration The migration directory name.
 * @returns {Promise<{code: number, output: string}>} Exit code and output.
 */
function applyMigration(target, migration) {
  return run(
    'psql',
    [
      libpqUrl(target),
      '--single-transaction',
      '--quiet',
      '-v',
      'ON_ERROR_STOP=1',
      '-f',
      path.join(MIGRATIONS, migration, 'migration.sql'),
    ],
    { env: { PGOPTIONS: '--client-min-messages=warning' } },
  )
}

/**
 * Create the disposable database.
 *
 * @param {string} template A connection string on the target server.
 * @param {string} name The database to create.
 * @returns {Promise<void>} Resolves once the database exists.
 */
async function createDatabase(template, name) {
  assertDisposable(name)

  const admin = createPrismaClient({ connectionString: withDatabase(template, 'postgres') })

  try {
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`)
  } finally {
    await admin.$disconnect()
  }
}

/**
 * Drop the disposable database.
 *
 * @param {string} template A connection string on the target server.
 * @param {string} name The database to drop. Must be disposable.
 * @returns {Promise<void>} Resolves once the database is gone.
 * @throws {Error} When asked to drop anything that is not a disposable database.
 */
async function dropDatabase(template, name) {
  assertDisposable(name)

  const admin = createPrismaClient({ connectionString: withDatabase(template, 'postgres') })

  try {
    await admin.$executeRawUnsafe(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
      name,
    )
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}"`)
  } finally {
    await admin.$disconnect()
  }
}

/**
 * Every table, with its columns and its outgoing foreign keys.
 *
 * @param {object} prisma A client connected to the disposable database.
 * @returns {Promise<Map<string, {columns: object[], references: Map<string, string>}>>} The shape of the database.
 */
async function describe(prisma) {
  const columns = await prisma.$queryRawUnsafe(
    'SELECT table_name, column_name, is_nullable, column_default, data_type, udt_name ' +
      "FROM information_schema.columns WHERE table_schema = 'public' " +
      "AND table_name <> '_prisma_migrations' ORDER BY table_name, ordinal_position",
  )

  const keys = await prisma.$queryRawUnsafe(
    'SELECT source.relname AS from_table, attribute.attname AS from_column, ' +
      'target.relname AS to_table FROM pg_constraint constraint_ ' +
      'JOIN pg_class source ON source.oid = constraint_.conrelid ' +
      'JOIN pg_class target ON target.oid = constraint_.confrelid ' +
      'JOIN unnest(constraint_.conkey) AS key(attnum) ON true ' +
      'JOIN pg_attribute attribute ON attribute.attrelid = source.oid AND attribute.attnum = key.attnum ' +
      "WHERE constraint_.contype = 'f' " +
      "AND connamespace = 'public'::regnamespace",
  )

  /** @type {Map<string, {columns: object[], references: Map<string, string>}>} */
  const tables = new Map()

  for (const column of columns) {
    if (!tables.has(column.table_name)) {
      tables.set(column.table_name, { columns: [], references: new Map() })
    }
    tables.get(column.table_name).columns.push(column)
  }

  for (const key of keys) {
    tables.get(key.from_table)?.references.set(key.from_column, key.to_table)
  }

  return tables
}

/**
 * Tables ordered so that every table comes after the tables it references.
 *
 * @param {Map<string, {references: Map<string, string>}>} tables The shape of the database.
 * @returns {string[]} Table names in insertion order.
 */
function inDependencyOrder(tables) {
  const ordered = []
  const placed = new Set()

  /**
   * Place one table after everything it depends on.
   *
   * @param {string} table The table to place.
   * @param {Set<string>} visiting Tables on the current path, to break cycles.
   * @returns {void}
   */
  const place = (table, visiting) => {
    if (placed.has(table) || visiting.has(table)) return
    visiting.add(table)

    for (const target of tables.get(table).references.values()) {
      if (target !== table) place(target, visiting)
    }

    visiting.delete(table)
    placed.add(table)
    ordered.push(table)
  }

  for (const table of [...tables.keys()].sort()) place(table, new Set())

  return ordered
}

/**
 * A literal for one column, or null when the column should be left out.
 *
 * @param {object} column An `information_schema.columns` row.
 * @param {string} table The table the column belongs to.
 * @param {number} index A counter, so text values are distinct across tables.
 * @param {Map<string, string>} identifiers The id already inserted for each table.
 * @param {Map<string, string>} references This table's foreign keys.
 * @param {Map<string, string[]>} enums Labels for each enum type.
 * @returns {string|null} A SQL literal, or null to omit the column.
 */
function literalFor(column, table, index, identifiers, references, enums) {
  const name = column.column_name
  const override = OVERRIDES[table]?.[name]
  if (override) return override

  const referenced = references.get(name)
  if (referenced) {
    const identifier = identifiers.get(referenced)

    return identifier ? `'${identifier}'` : null
  }

  // Nullable or defaulted columns are left to the database. `updatedAt` is
  // neither: Prisma maintains it in the client, so the row has to carry a value
  // like any other NOT NULL column.
  if (column.is_nullable === 'YES' || column.column_default !== null) return null

  if (enums.has(column.udt_name)) return `'${enums.get(column.udt_name)[0]}'`

  switch (column.data_type) {
    case 'text':
    case 'character varying':
      return `'upgrade-fixture-${table}-${name}-${index}'`
    case 'integer':
    case 'bigint':
    case 'smallint':
      return '1'
    case 'numeric':
    case 'double precision':
    case 'real':
      return '1'
    case 'boolean':
      return 'false'
    case 'timestamp with time zone':
    case 'timestamp without time zone':
      return "'2026-09-15T00:00:00Z'"
    case 'date':
      return "'2026-09-15'"
    case 'jsonb':
    case 'json':
      return `'{}'::${column.data_type}`
    case 'ARRAY':
      return "'{}'"
    default:
      return null
  }
}

/**
 * Every enum type's labels, in their declared order.
 *
 * @param {object} prisma A client connected to the disposable database.
 * @returns {Promise<Map<string, string[]>>} Labels by type name.
 */
async function enumLabels(prisma) {
  const enumRows = await prisma.$queryRawUnsafe(
    'SELECT type.typname AS name, label.enumlabel AS label FROM pg_enum label ' +
      'JOIN pg_type type ON type.oid = label.enumtypid ORDER BY label.enumsortorder',
  )

  /** @type {Map<string, string[]>} */
  const enums = new Map()
  for (const row of enumRows) {
    if (!enums.has(row.name)) enums.set(row.name, [])
    enums.get(row.name).push(row.label)
  }

  return enums
}

/**
 * Put one row in every table, in an order that satisfies the foreign keys.
 *
 * Every NOT NULL column without a default gets a value; everything else is left
 * to the database, so a defaulted column that stops being defaulted shows up
 * here as a failure rather than as a silently different row.
 *
 * @param {object} prisma A client connected to the disposable database.
 * @returns {Promise<{filled: string[], skipped: object[]}>} What was filled and what was not.
 */
async function populate(prisma) {
  const tables = await describe(prisma)
  const enums = await enumLabels(prisma)

  /** @type {Map<string, string>} */
  const identifiers = new Map()
  const filled = []
  const skipped = []
  let index = 0

  for (const table of inDependencyOrder(tables)) {
    const { columns, references } = tables.get(table)
    const names = []
    const values = []
    index += 1

    const identifier = `upgrade-fixture-${table}`
    const hasId = columns.some((column) => column.column_name === 'id')

    for (const column of columns) {
      // The primary key is named rather than synthesised, because every foreign
      // key pointing at this table has to be able to predict it.
      if (column.column_name === 'id') {
        names.push('"id"')
        values.push(`'${identifier}'`)
        continue
      }

      const literal = literalFor(column, table, index, identifiers, references, enums)
      if (literal === null) continue
      names.push(`"${column.column_name}"`)
      values.push(literal)
    }

    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "${table}" (${names.join(', ')}) VALUES (${values.join(', ')})`,
      )
      if (hasId) identifiers.set(table, identifier)
      filled.push(table)
    } catch (error) {
      skipped.push({
        table,
        reason: String(error?.message ?? error)
          .replace(/\s+/g, ' ')
          .slice(0, 200),
      })
    }
  }

  return { filled, skipped }
}

/** A 2000-character tier description: longer than today's limit, and legal before it. */
const LONG_DESCRIPTION = 'A long tier description. '.repeat(80)

/** A cover address with a password, a signature and a fragment, as an organiser could paste one. */
const SIGNED_COVER = 'https://photos:hunter2@img.example.net/c/42.png?X-Amz-Signature=deadbeef#top'

/** A plain cover address. */
const PLAIN_COVER = 'https://cdn.example.com/covers/garba-night.jpg'

/**
 * Put in the rows the API at a6bd5e4 could write and the feature migrations
 * rewrite: the data their backfills exist for.
 *
 * Each row names only the columns the case is about; every other NOT NULL
 * column is filled the way {@link populate} fills it, and foreign keys point at
 * its rows. Two reserved tiers on one session and zone are not among them: the
 * API at a6bd5e4 refused that pair, and the migration refuses it by design.
 *
 * @param {object} prisma A client connected to the disposable database.
 * @param {string[]} filled The tables {@link populate} put a row in.
 * @returns {Promise<{added: Record<string, number>, refused: object[]}>} Rows added per table, and any refused.
 */
async function seedLegacyRows(prisma, filled) {
  const tables = await describe(prisma)
  const enums = await enumLabels(prisma)
  const identifiers = new Map(filled.map((table) => [table, `upgrade-fixture-${table}`]))
  /** @type {Record<string, number>} */
  const added = {}
  const refused = []
  let index = 1000

  /**
   * Insert one row: the given literals, and the filler's for the rest.
   *
   * @param {string} table The table.
   * @param {Record<string, string>} given Column to SQL literal; must name `id`.
   * @returns {Promise<void>} Resolves once inserted, or recorded as refused.
   */
  const insert = async (table, given) => {
    const { columns, references } = tables.get(table)
    const names = []
    const values = []
    index += 1

    for (const column of columns) {
      const literal =
        given[column.column_name] ??
        literalFor(column, table, index, identifiers, references, enums)

      if (literal === null) continue
      names.push(`"${column.column_name}"`)
      values.push(literal)
    }

    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "${table}" (${names.join(', ')}) VALUES (${values.join(', ')})`,
      )
      added[table] = (added[table] ?? 0) + 1
    } catch (error) {
      refused.push({
        table,
        id: given.id,
        reason: String(error?.message ?? error)
          .replace(/\s+/g, ' ')
          .slice(0, 200),
      })
    }
  }

  const quote = (text) => `'${text.replaceAll("'", "''")}'`
  const event = "'upgrade-fixture-Event'"
  const organization = "'upgrade-fixture-Organization'"

  // Events: a line-up to become performers, and two cover addresses to drop.
  await insert('Event', {
    id: "'legacy-event-lineup'",
    slug: "'legacy-event-lineup'",
    artists: "ARRAY['Falguni Pathak', 'Aishwarya Majmudar']::text[]",
    coverImageUrl: quote(PLAIN_COVER),
  })
  await insert('Event', {
    id: "'legacy-event-signed-cover'",
    slug: "'legacy-event-signed-cover'",
    coverImageUrl: quote(SIGNED_COVER),
  })

  // Tiers: a comp, bounds over the ceiling, a blank and a long description.
  await insert('TicketType', {
    id: "'legacy-tier-comp'",
    eventId: event,
    name: "'Legacy comp'",
    complimentary: 'true',
    priceCents: '0',
  })
  await insert('TicketType', {
    id: "'legacy-tier-public'",
    eventId: event,
    name: "'Legacy public'",
    complimentary: 'false',
  })
  await insert('TicketType', {
    id: "'legacy-tier-bounds'",
    eventId: event,
    name: "'Legacy bounds'",
    minPerOrder: '60',
    maxPerOrder: '100',
  })
  await insert('TicketType', {
    id: "'legacy-tier-blank'",
    eventId: event,
    name: "'Legacy blank description'",
    description: "''",
  })
  await insert('TicketType', {
    id: "'legacy-tier-long'",
    eventId: event,
    name: "'Legacy long description'",
    description: quote(LONG_DESCRIPTION),
  })

  // Invitations: two live ones to one address in different case, and another.
  const invitation = (id, email, createdAt) =>
    insert('Invitation', {
      id: `'${id}'`,
      organizationId: organization,
      email: quote(email),
      role: "'STAFF'",
      tokenHash: `'${id}-digest'`,
      invitedById: "'upgrade-fixture-User'",
      status: "'PENDING'",
      expiresAt: "'2027-01-01T00:00:00Z'",
      createdAt: `'${createdAt}'`,
    })

  await invitation('legacy-invite-older', 'Asha.Rao@Example.com', '2026-09-01T10:00:00Z')
  await invitation('legacy-invite-newer', 'asha.rao@example.com', '2026-09-02T10:00:00Z')
  await invitation('legacy-invite-other', 'ben@example.com', '2026-09-01T10:00:00Z')

  // Promo codes outside the ranges the new CHECKs hold them to.
  const promo = (id, fields) =>
    insert('PromoCode', {
      id: `'${id}'`,
      organizationId: organization,
      code: `'${id.toUpperCase()}'`,
      type: "'PERCENTAGE'",
      value: '1000',
      ...fields,
    })

  await promo('legacy-promo-pct-currency', { currency: "'USD'" })
  await promo('legacy-promo-pct-over', { value: '15000' })
  await promo('legacy-promo-negative', {
    type: "'FIXED_AMOUNT'",
    value: '-500',
    currency: "'USD'",
  })
  await promo('legacy-promo-negative-count', { redemptionCount: '-2' })
  await promo('legacy-promo-cap-zero', { maxRedemptions: '0', redemptionCount: '0' })
  await promo('legacy-promo-over-cap', { maxRedemptions: '5', redemptionCount: '7' })
  await promo('legacy-promo-window', {
    startsAt: "'2026-10-02T00:00:00Z'",
    endsAt: "'2026-10-01T00:00:00Z'",
  })

  // Admissions as the API at a6bd5e4 recorded them: no night, and a pass good
  // for every night CHECKED_IN at its first. `20260929100000_check_in_per_night`
  // gives each a night and lets the passes in again on the others.
  await seedLegacyAdmissions(insert, prisma)

  return { added, refused }
}

/** Nights of the three-night legacy event, and the one-night one. */
const LEGACY_NIGHTS = Object.freeze({
  one: {
    id: 'legacy-night-1',
    startsAt: '2026-10-01T18:00:00Z',
    endsAt: '2026-10-01T23:00:00Z',
    doorsOpenAt: '2026-10-01T17:00:00Z',
  },
  two: {
    id: 'legacy-night-2',
    startsAt: '2026-10-02T18:00:00Z',
    endsAt: '2026-10-02T23:00:00Z',
    doorsOpenAt: null,
  },
  three: {
    id: 'legacy-night-3',
    startsAt: '2026-10-03T18:00:00Z',
    endsAt: '2026-10-03T23:00:00Z',
    doorsOpenAt: null,
  },
  only: {
    id: 'legacy-night-only',
    startsAt: '2026-10-05T18:00:00Z',
    endsAt: '2026-10-05T23:00:00Z',
    doorsOpenAt: null,
  },
})

/**
 * The legacy admissions, each with the ticket it admitted and where its scan
 * falls, and what the per-night migration should make of it.
 *
 * `night` is the night the admission should end up on (null: left without
 * one), `chosenBy` how, and `status` the ticket's status afterwards.
 */
const LEGACY_ADMISSIONS = Object.freeze([
  // A pass scanned after night 1's doors opened: night 1, by its window.
  {
    ticket: 'legacy-ticket-pass-window',
    tier: 'legacy-tier-every-night',
    scannedAt: '2026-10-01T17:30:00Z',
    finally: 'CHECKED_IN',
    night: 'legacy-night-1',
    chosenBy: 'WINDOW',
    status: 'VALID',
  },
  // A pass scanned between nights, nearer night 2's start than night 1's end.
  {
    ticket: 'legacy-ticket-pass-nearest',
    tier: 'legacy-tier-every-night',
    scannedAt: '2026-10-02T12:00:00Z',
    finally: 'CHECKED_IN',
    night: 'legacy-night-2',
    chosenBy: 'NEAREST',
    status: 'VALID',
  },
  // A night-2 ticket let in during night 1's window: its own night wins, and it admitted once.
  {
    ticket: 'legacy-ticket-night-two',
    tier: 'legacy-tier-night-two',
    scannedAt: '2026-10-01T20:00:00Z',
    finally: 'CHECKED_IN',
    night: 'legacy-night-2',
    chosenBy: 'OWN_NIGHT',
    status: 'CHECKED_IN',
  },
  // A pass let in and refunded since: it gets its night, and stays refunded.
  {
    ticket: 'legacy-ticket-pass-refunded',
    tier: 'legacy-tier-every-night',
    scannedAt: '2026-10-01T19:00:00Z',
    finally: 'REFUNDED',
    night: 'legacy-night-1',
    chosenBy: 'WINDOW',
    status: 'REFUNDED',
  },
  // An admission on an event of one night needs no night, and is left alone.
  {
    ticket: 'legacy-ticket-one-night',
    tier: 'legacy-tier-one-night',
    scannedAt: '2026-10-05T19:00:00Z',
    finally: 'CHECKED_IN',
    night: null,
    chosenBy: null,
    status: 'CHECKED_IN',
  },
])

/** How many audit rows the per-night migration writes for them: one per ticket it touches. */
const LEGACY_ADMISSION_AUDITS = LEGACY_ADMISSIONS.filter((admission) => admission.night).length

/**
 * Put in a three-night event and a one-night one, with tickets let in the way
 * the API at a6bd5e4 let them in: a `CheckIn` with no night, and the ticket
 * moved to CHECKED_IN (then, for one, to REFUNDED).
 *
 * @param {function(string, Record<string, string>): Promise<void>} insert The row writer from {@link seedLegacyRows}.
 * @param {object} prisma A client connected to the disposable database.
 * @returns {Promise<void>} Resolves once every row is in or recorded as refused.
 */
async function seedLegacyAdmissions(insert, prisma) {
  const at = (value) => (value ? `'${value}'` : 'NULL')

  await insert('Event', {
    id: "'legacy-event-nights'",
    slug: "'legacy-event-nights'",
    startsAt: at(LEGACY_NIGHTS.one.startsAt),
    endsAt: at(LEGACY_NIGHTS.three.endsAt),
  })
  await insert('Event', {
    id: "'legacy-event-one-night'",
    slug: "'legacy-event-one-night'",
    startsAt: at(LEGACY_NIGHTS.only.startsAt),
    endsAt: at(LEGACY_NIGHTS.only.endsAt),
  })

  for (const [key, night] of Object.entries(LEGACY_NIGHTS)) {
    await insert('EventSession', {
      id: `'${night.id}'`,
      eventId: key === 'only' ? "'legacy-event-one-night'" : "'legacy-event-nights'",
      startsAt: at(night.startsAt),
      endsAt: at(night.endsAt),
      doorsOpenAt: at(night.doorsOpenAt),
      venueMapVersionId: 'NULL',
      capacity: 'NULL',
    })
  }

  const tier = (id, eventId, night) =>
    insert('TicketType', {
      id: `'${id}'`,
      eventId: `'${eventId}'`,
      name: `'${id}'`,
      eventSessionId: at(night),
      priceZoneId: 'NULL',
      complimentary: 'false',
    })

  await tier('legacy-tier-every-night', 'legacy-event-nights', null)
  await tier('legacy-tier-night-two', 'legacy-event-nights', 'legacy-night-2')
  await tier('legacy-tier-one-night', 'legacy-event-one-night', null)

  for (const eventId of ['legacy-event-nights', 'legacy-event-one-night']) {
    await insert('Order', {
      id: `'${eventId}-order'`,
      eventId: `'${eventId}'`,
      reference: `'${eventId.toUpperCase()}'`,
      status: "'PAID'",
      promoCodeId: 'NULL',
      eventSessionId: 'NULL',
    })
  }

  for (const admission of LEGACY_ADMISSIONS) {
    const eventId =
      admission.tier === 'legacy-tier-one-night' ? 'legacy-event-one-night' : 'legacy-event-nights'

    await insert('OrderItem', {
      id: `'${admission.ticket}-item'`,
      orderId: `'${eventId}-order'`,
      ticketTypeId: `'${admission.tier}'`,
      quantity: '1',
    })
    await insert('Ticket', {
      id: `'${admission.ticket}'`,
      orderItemId: `'${admission.ticket}-item'`,
      status: "'VALID'",
      eventSeatId: 'NULL',
      supersedesTicketId: 'NULL',
      transferredFromId: 'NULL',
    })
    await insert('CheckIn', {
      id: `'${admission.ticket}-admission'`,
      ticketId: `'${admission.ticket}'`,
      eventSessionId: 'NULL',
      scannedAt: at(admission.scannedAt),
    })

    // What the old API did next: the ticket admitted, so it was used up.
    await prisma.$executeRawUnsafe(
      `UPDATE "Ticket" SET "status" = 'CHECKED_IN', "checkedInAt" = '${admission.scannedAt}' WHERE "id" = '${admission.ticket}'`,
    )

    if (admission.finally !== 'CHECKED_IN') {
      await prisma.$executeRawUnsafe(
        `UPDATE "Ticket" SET "status" = '${admission.finally}' WHERE "id" = '${admission.ticket}'`,
      )
    }
  }
}

/**
 * Check what the feature migrations made of the rows {@link seedLegacyRows} put in.
 *
 * @param {object} prisma A client connected to the upgraded database.
 * @returns {Promise<boolean>} Whether every check passed.
 */
async function checkLegacyBackfills(prisma) {
  let ok = true
  const one = async (sql) => (await prisma.$queryRawUnsafe(sql))[0] ?? null
  const tiers = Object.fromEntries(
    (
      await prisma.$queryRawUnsafe(
        'SELECT "id", "visibility"::text AS visibility, "minPerOrder", "maxPerOrder", ' +
          'char_length("description") AS "descriptionLength", "description" IS NULL AS "noDescription" ' +
          `FROM "TicketType" WHERE "id" LIKE 'legacy-tier-%'`,
      )
    ).map((row) => [row.id, row]),
  )

  ok =
    record(
      'a complimentary tier written before the migration is hidden, and a paid one is not',
      tiers['legacy-tier-comp']?.visibility === 'HIDDEN' &&
        tiers['legacy-tier-public']?.visibility === 'PUBLIC',
      {
        note: `comp ${tiers['legacy-tier-comp']?.visibility}, paid ${tiers['legacy-tier-public']?.visibility}`,
      },
    ) && ok

  const bounds = tiers['legacy-tier-bounds']
  ok =
    record(
      'per-order bounds of 60 to 100 are clamped to the ceiling of 50',
      bounds?.minPerOrder === 50 && bounds?.maxPerOrder === 50,
      { note: `${bounds?.minPerOrder} to ${bounds?.maxPerOrder}` },
    ) && ok

  ok =
    record(
      'a blank tier description becomes no description',
      tiers['legacy-tier-blank']?.noDescription === true,
      { note: `NULL=${tiers['legacy-tier-blank']?.noDescription}` },
    ) && ok

  // Kept whole, and a sale on its tier still records: the 500-character limit
  // is checked only when the text itself changes.
  let sold = 0
  try {
    sold = await prisma.$executeRawUnsafe(
      `UPDATE "TicketType" SET "quantitySold" = "quantitySold" + 1 WHERE "id" = 'legacy-tier-long'`,
    )
  } catch {
    sold = 0
  }
  ok =
    record(
      'a legacy 2000-character description is kept, and a sale on its tier still records',
      Number(tiers['legacy-tier-long']?.descriptionLength) === LONG_DESCRIPTION.length &&
        sold === 1,
      { note: `${tiers['legacy-tier-long']?.descriptionLength} characters, ${sold} row updated` },
    ) && ok

  const lineup = await one(`SELECT "performers" FROM "Event" WHERE "id" = 'legacy-event-lineup'`)
  const unbilled = await one(
    `SELECT "performers" FROM "Event" WHERE "id" = 'legacy-event-signed-cover'`,
  )
  ok =
    record(
      'the line-up becomes performers in billing order, and no line-up stays none',
      JSON.stringify(lineup?.performers) ===
        JSON.stringify([{ name: 'Falguni Pathak' }, { name: 'Aishwarya Majmudar' }]) &&
        unbilled?.performers === null,
      { note: JSON.stringify(lineup?.performers) },
    ) && ok

  const invitations = Object.fromEntries(
    (
      await prisma.$queryRawUnsafe(
        'SELECT "id", "status"::text AS status, "revokedAt" IS NOT NULL AS revoked ' +
          `FROM "Invitation" WHERE "id" LIKE 'legacy-invite-%'`,
      )
    ).map((row) => [row.id, row]),
  )
  ok =
    record(
      'of two live invitations to one address in different case, the older is withdrawn',
      invitations['legacy-invite-older']?.status === 'REVOKED' &&
        invitations['legacy-invite-older']?.revoked === true &&
        invitations['legacy-invite-newer']?.status === 'PENDING' &&
        invitations['legacy-invite-other']?.status === 'PENDING',
      {
        note: ['older', 'newer', 'other']
          .map((key) => `${key} ${invitations[`legacy-invite-${key}`]?.status}`)
          .join(', '),
      },
    ) && ok

  const promos = Object.fromEntries(
    (
      await prisma.$queryRawUnsafe(
        'SELECT "id", "value", "currency", "redemptionCount", "maxRedemptions", "active", ' +
          `"startsAt" FROM "PromoCode" WHERE "id" LIKE 'legacy-promo-%'`,
      )
    ).map((row) => [row.id, row]),
  )
  const expectations = {
    'legacy-promo-pct-currency': (row) => row.currency === null && row.value === 1000,
    'legacy-promo-pct-over': (row) => row.value === 10000,
    'legacy-promo-negative': (row) => row.value === 0 && row.currency === 'USD',
    'legacy-promo-negative-count': (row) => row.redemptionCount === 0,
    'legacy-promo-cap-zero': (row) => row.active === false && row.maxRedemptions === 1,
    'legacy-promo-over-cap': (row) =>
      row.active === true && row.maxRedemptions === 7 && row.redemptionCount === 7,
    'legacy-promo-window': (row) => row.active === false && row.startsAt === null,
  }
  const wrong = Object.entries(expectations)
    .filter(([id, holds]) => !promos[id] || !holds(promos[id]))
    .map(([id]) => id)
  ok =
    record(
      'promo codes out of range are brought into range without opening one that was closed',
      wrong.length === 0,
      {
        wrong,
        note: `${Object.keys(expectations).length - wrong.length} of ${Object.keys(expectations).length} as expected`,
      },
    ) && ok

  ok = (await checkLegacyAdmissions(prisma)) && ok

  const dropped = await prisma.$queryRawUnsafe(
    'SELECT "entityId", "entityType", "actorId", "metadata" FROM "AuditLog" ' +
      `WHERE "action" = 'event.cover_address_dropped' ORDER BY "entityId"`,
  )
  const kept = Object.fromEntries(dropped.map((row) => [row.entityId, row]))
  const keptText = JSON.stringify(dropped)
  ok =
    record(
      'every dropped cover address is kept in an audit row, without its password or signature',
      dropped.length === 2 &&
        dropped.every((row) => row.entityType === 'Event' && row.actorId === null) &&
        kept['legacy-event-lineup']?.metadata?.coverImageUrl === PLAIN_COVER &&
        kept['legacy-event-signed-cover']?.metadata?.coverImageUrl ===
          'https://img.example.net/c/42.png' &&
        dropped.every((row) => row.metadata?.organizationId === 'upgrade-fixture-Organization') &&
        !/hunter2|Signature|deadbeef/u.test(keptText),
      { note: dropped.map((row) => `${row.entityId}: ${row.metadata?.coverImageUrl}`).join('; ') },
    ) && ok

  return ok
}

/**
 * Check what `20260929100000_check_in_per_night` made of the legacy admissions.
 *
 * @param {object} prisma A client connected to the upgraded database.
 * @returns {Promise<boolean>} Whether every check passed.
 */
async function checkLegacyAdmissions(prisma) {
  let ok = true
  const rows = Object.fromEntries(
    (
      await prisma.$queryRawUnsafe(
        'SELECT t."id", t."status"::text AS status, t."checkedInAt", c."eventSessionId" AS night ' +
          'FROM "Ticket" t JOIN "CheckIn" c ON c."ticketId" = t."id" ' +
          `WHERE t."id" LIKE 'legacy-ticket-%'`,
      )
    ).map((row) => [row.id, row]),
  )
  const wrong = LEGACY_ADMISSIONS.filter(({ ticket, night, status }) => {
    const row = rows[ticket]

    return (
      !row ||
      row.night !== night ||
      row.status !== status ||
      // A pass let in again keeps no checkedInAt, as the new rules leave it.
      (status === 'VALID' && row.checkedInAt !== null)
    )
  }).map(({ ticket }) => ticket)

  ok =
    record(
      'every admission before per-night admission has its night, and a pass let in on one night admits on the others',
      wrong.length === 0,
      {
        wrong,
        note: LEGACY_ADMISSIONS.map(
          ({ ticket }) => `${ticket}: ${rows[ticket]?.night ?? 'no night'} ${rows[ticket]?.status}`,
        ).join('; '),
      },
    ) && ok

  const audits = Object.fromEntries(
    (
      await prisma.$queryRawUnsafe(
        'SELECT "entityId", "entityType", "actorId", "metadata" FROM "AuditLog" ' +
          `WHERE "action" = 'ticket.admission_night_backfilled'`,
      )
    ).map((row) => [row.entityId, row]),
  )
  const expected = LEGACY_ADMISSIONS.filter((admission) => admission.night)
  const unaudited = expected
    .filter(({ ticket, night, chosenBy, status }) => {
      const audit = audits[ticket]

      return (
        !audit ||
        audit.entityType !== 'Ticket' ||
        audit.actorId !== null ||
        audit.metadata?.eventSessionId !== night ||
        audit.metadata?.chosenBy !== chosenBy ||
        audit.metadata?.checkInId !== `${ticket}-admission` ||
        audit.metadata?.restoredToValid !== (status === 'VALID') ||
        (status === 'VALID' && !audit.metadata?.previousCheckedInAt)
      )
    })
    .map(({ ticket }) => ticket)

  ok =
    record(
      'each admission given a night is in the audit log, with how its night was chosen and any old checkedInAt',
      unaudited.length === 0 && Object.keys(audits).length === expected.length,
      { unaudited, note: `${Object.keys(audits).length} audit rows` },
    ) && ok

  // The point of it all: the pass let in on night 1 before the migration is
  // let in on night 2 now, under the new trigger, and not twice on night 1.
  let again = 'refused'
  let twice = 'refused'
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "CheckIn" ("id", "ticketId", "eventSessionId") ` +
        `VALUES ('legacy-pass-night-two', 'legacy-ticket-pass-window', 'legacy-night-2')`,
    )
    again = 'admitted'
  } catch (error) {
    again = String(error?.message ?? error)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200)
  }
  try {
    // ON CONFLICT DO NOTHING, so the unique key's refusal is a count of none
    // rather than an error the client logs as though something broke.
    const inserted = await prisma.$executeRawUnsafe(
      `INSERT INTO "CheckIn" ("id", "ticketId", "eventSessionId") ` +
        `VALUES ('legacy-pass-night-one-again', 'legacy-ticket-pass-window', 'legacy-night-1') ` +
        'ON CONFLICT DO NOTHING',
    )
    twice = inserted === 0 ? 'refused' : 'admitted'
  } catch {
    twice = 'refused'
  }

  ok =
    record(
      'a pass let in on night 1 before the migration is let in on night 2 after it, and not twice on night 1',
      again === 'admitted' && twice === 'refused',
      { note: `night 2: ${again}; night 1 again: ${twice}` },
    ) && ok

  return ok
}

/**
 * Check what the SPEC2 migrations made of the rows {@link BEFORE_MIGRATION_FIXTURES}
 * put in, and what they left behind on a database that holds rows.
 *
 * @param {object} prisma A client connected to the upgraded database.
 * @returns {Promise<boolean>} Whether every check passed.
 */
async function checkSpec2Backfills(prisma) {
  let ok = true

  const labels = (
    await prisma.$queryRawUnsafe(
      'SELECT label.enumlabel AS label FROM pg_enum label JOIN pg_type type ON type.oid = label.enumtypid ' +
        `WHERE type.typname = 'UserRole' ORDER BY label.enumsortorder`,
    )
  ).map((row) => row.label)
  ok =
    record(
      'UserRole names ADMIN again, just below SUPER_ADMIN',
      labels.includes('ADMIN') && labels.indexOf('ADMIN') === labels.indexOf('SUPER_ADMIN') - 1,
      { note: labels.join(', ') },
    ) && ok

  const invitations = Object.fromEntries(
    (
      await prisma.$queryRawUnsafe(
        'SELECT "id", "status"::text AS status, "revokedAt" IS NOT NULL AS revoked ' +
          `FROM "Invitation" WHERE "id" LIKE 'upgrade-invite-%'`,
      )
    ).map((row) => [row.id, row]),
  )
  const [rule] = await prisma.$queryRawUnsafe(
    'SELECT count(*)::int AS n FROM pg_constraint ' +
      `WHERE conname = 'invitation_pending_role_is_owner_grantable'`,
  )
  const [posting] = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM "Invitation" WHERE "status" = 'PENDING' ` +
      `AND "role" IN ('OWNER', 'ADMIN', 'MANAGER', 'EVENT_MANAGER')`,
  )
  ok =
    record(
      'a waiting team invitation to a role that posts events is withdrawn, and a STAFF one is not',
      invitations['upgrade-invite-admin']?.status === 'REVOKED' &&
        invitations['upgrade-invite-admin']?.revoked === true &&
        invitations['upgrade-invite-staff']?.status === 'PENDING' &&
        invitations['upgrade-invite-staff']?.revoked === false &&
        rule.n === 1 &&
        posting.n === 0,
      {
        note:
          `ADMIN ${invitations['upgrade-invite-admin']?.status}, ` +
          `STAFF ${invitations['upgrade-invite-staff']?.status}, ` +
          `CHECK ${rule.n === 1 ? 'present' : 'missing'}, ${posting.n} waiting posting-role invitations`,
      },
    ) && ok

  const websites = Object.fromEntries(
    (
      await prisma.$queryRawUnsafe(
        'SELECT "id", "websiteUrl", "websiteDecisionPending" AS pending, ' +
          '"websiteSubmittedAt" IS NOT NULL AS submitted, "websiteRedirectEnabled" AS enabled, ' +
          `"socialLinks" FROM "Event" WHERE "id" LIKE 'legacy-website-%'`,
      )
    ).map((row) => [row.id, row]),
  )
  const wrong = LEGACY_WEBSITES.filter((legacy) => {
    const row = websites[legacy.id]
    const carried = legacy.carried !== null

    return (
      !row ||
      row.websiteUrl !== legacy.carried ||
      row.pending !== carried ||
      row.submitted !== carried ||
      row.enabled !== false ||
      row.socialLinks === null ||
      'website' in row.socialLinks
    )
  }).map((legacy) => legacy.id)
  const mixed = websites['legacy-website-mixed-case']
  ok =
    record(
      'legacy website links are carried normalised and waiting, or dropped, and the key is gone',
      wrong.length === 0 &&
        JSON.stringify(mixed?.socialLinks) ===
          JSON.stringify({ instagram: 'https://instagram.com/x' }),
      {
        wrong,
        note: LEGACY_WEBSITES.map(
          (legacy) =>
            `${legacy.id.replace('legacy-website-', '')}: ${websites[legacy.id]?.websiteUrl ?? 'dropped'}`,
        ).join('; '),
      },
    ) && ok

  // The events the 2026-10-15 fixture clones, long after the website-link
  // migration, carry an administrator's decision of their own on purpose;
  // `checkImportedEventsSoldHere` holds what becomes of them. Every row that
  // migration upgraded is still held to it.
  const [switchedOn] = await prisma.$queryRawUnsafe(
    'SELECT count(*)::int AS n FROM "Event" WHERE "websiteRedirectEnabled" ' +
      `AND "id" NOT LIKE 'legacy-import-%'`,
  )
  ok =
    record("no event's website link is on after the upgrade", switchedOn.n === 0, {
      note: `${switchedOn.n} on`,
    }) && ok

  const triggers = (
    await prisma.$queryRawUnsafe(
      'SELECT tgname FROM pg_trigger WHERE NOT tgisinternal ' +
        `AND tgname IN ('desi_event_status_requires_review', 'desi_event_website_change') ORDER BY tgname`,
    )
  ).map((row) => row.tgname)
  ok =
    record('the review-gate and website triggers exist', triggers.length === 2, {
      note: triggers.join(', '),
    }) && ok

  const state = await prisma.$queryRawUnsafe(
    'SELECT "id", "leaseOwner", "leaseExpiresAt", "lastCompletedAt" FROM "TrafficRollupState"',
  )
  const [visits] = await prisma.$queryRawUnsafe(
    'SELECT (SELECT count(*) FROM "TrafficEvent")::int AS events, ' +
      '(SELECT count(*) FROM "TrafficDaily")::int AS daily, ' +
      '(SELECT count(*) FROM "TrafficSalt")::int AS salts',
  )
  ok =
    record(
      'the traffic roll-up has exactly one state row with no lease, and nothing is counted',
      state.length === 1 &&
        state[0].id === 'traffic-rollup' &&
        state[0].leaseOwner === null &&
        state[0].leaseExpiresAt === null &&
        state[0].lastCompletedAt === null &&
        visits.events === 0 &&
        visits.daily === 0 &&
        visits.salts === 0,
      {
        note: `${state.length} state row(s); ${visits.events} events, ${visits.daily} daily, ${visits.salts} salts`,
      },
    ) && ok

  return ok
}

/**
 * Check what the SPEC2-XI migrations (the DELETED status, full control of posted
 * events, and imports) made of a database that holds rows.
 *
 * @param {object} prisma A client connected to the upgraded database.
 * @returns {Promise<boolean>} Whether every check passed.
 */
async function checkFullControlAndImportBackfills(prisma) {
  let ok = true

  const statuses = (
    await prisma.$queryRawUnsafe(
      'SELECT label.enumlabel AS label FROM pg_enum label JOIN pg_type type ON type.oid = label.enumtypid ' +
        `WHERE type.typname = 'EventStatus' ORDER BY label.enumsortorder`,
    )
  ).map((row) => row.label)
  const [deleted] = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM "Event" WHERE "status" = 'DELETED' ` +
      'OR "deletedAt" IS NOT NULL OR "statusBeforeDeletion" IS NOT NULL',
  )
  ok =
    record(
      'EventStatus names DELETED last, and no existing event is deleted by the upgrade',
      statuses.at(-1) === 'DELETED' && deleted.n === 0,
      { note: `${statuses.join(', ')}; ${deleted.n} deleted` },
    ) && ok

  const nights = await prisma.$queryRawUnsafe(
    'SELECT "id", "status"::text AS status, "cancelledAt", "updatedAt" FROM "EventSession"',
  )
  const cancelled = nights.find((night) => night.id === LEGACY_CANCELLED_NIGHT.id)
  const wronglyStamped = nights.filter(
    (night) => (night.status === 'CANCELLED') !== (night.cancelledAt !== null),
  )
  ok =
    record(
      'a night cancelled before the upgrade is stamped cancelled when it last changed, and no other night is',
      cancelled?.cancelledAt instanceof Date &&
        cancelled.cancelledAt.getTime() === cancelled.updatedAt.getTime() &&
        cancelled.cancelledAt.toISOString() === LEGACY_CANCELLED_NIGHT.updatedAt &&
        wronglyStamped.length === 0,
      {
        note:
          `cancelledAt ${cancelled?.cancelledAt?.toISOString() ?? 'missing'}, ` +
          `updatedAt ${cancelled?.updatedAt?.toISOString() ?? 'missing'}; ` +
          `${wronglyStamped.length} of ${nights.length} nights mis-stamped`,
      },
    ) && ok

  const coverIndexes = (
    await prisma.$queryRawUnsafe(
      "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname IN " +
        "('MediaAsset_one_cover_per_event_key', 'MediaAsset_one_current_cover_per_event_key')",
    )
  ).map((row) => row.indexname)
  ok =
    record(
      'the one-cover index is replaced by the one-current-cover index',
      coverIndexes.length === 1 && coverIndexes[0] === 'MediaAsset_one_current_cover_per_event_key',
      { note: coverIndexes.join(', ') || 'neither' },
    ) && ok

  const [gate] = await prisma.$queryRawUnsafe(
    "SELECT pg_get_functiondef('desi_event_status_requires_review'::regproc) AS body",
  )
  const body = gate?.body ?? ''
  ok =
    record(
      "the review gate keeps P's two refusals and restores only to desi_event_restore_target",
      body.includes('only a review decision approves') &&
        body.includes('it has not been approved') &&
        body.includes('desi_event_restore_target'),
      {
        note: [
          'only a review decision approves',
          'it has not been approved',
          'desi_event_restore_target',
        ]
          .map((phrase) => `${phrase}: ${body.includes(phrase) ? 'present' : 'missing'}`)
          .join('; '),
      },
    ) && ok

  // The one the rename migration's fixture put in is checked on its own.
  const [held] = await prisma.$queryRawUnsafe(
    'SELECT count(*)::int AS n FROM "Organization" WHERE "platformHeldSource" IS NOT NULL ' +
      `AND "id" <> '${LEGACY_ORGANISATIONS[0].id}'`,
  )
  const [unlisted] = await prisma.$queryRawUnsafe(
    'SELECT count(*)::int AS n FROM "EventSession" WHERE NOT "endTimeListed"',
  )
  ok =
    record(
      'no organisation is platform-held, and every night keeps the end time it was given',
      held.n === 0 && unlisted.n === 0,
      { note: `${held.n} platform-held organisations; ${unlisted.n} nights without a listed end` },
    ) && ok

  const memberGuards = (
    await prisma.$queryRawUnsafe(
      'SELECT tgrelid::regclass::text AS relation FROM pg_trigger WHERE NOT tgisinternal ' +
        "AND tgname = 'desi_platform_held_has_no_members' ORDER BY 1",
    )
  ).map((row) => row.relation)
  ok =
    record(
      'the platform-held no-members trigger guards memberships and team invitations',
      memberGuards.length === 2 &&
        memberGuards.includes('"Membership"') &&
        memberGuards.includes('"Invitation"'),
      { note: memberGuards.join(', ') || 'missing' },
    ) && ok

  // ADR 0019: it lets door scanners in and nobody else, and fires on a role
  // change as well, so a scanner there cannot be moved to another role.
  const memberGuardDefinitions = (
    await prisma.$queryRawUnsafe(
      'SELECT pg_get_triggerdef(oid) AS definition FROM pg_trigger WHERE NOT tgisinternal ' +
        "AND tgname = 'desi_platform_held_has_no_members' ORDER BY 1",
    )
  ).map((row) => row.definition)
  const [memberGuardBody] = await prisma.$queryRawUnsafe(
    "SELECT prosrc AS body FROM pg_proc WHERE proname = 'desi_platform_held_has_no_members'",
  )
  ok =
    record(
      'the platform-held trigger admits SCANNER alone and fires on a role change too',
      memberGuardDefinitions.length === 2 &&
        memberGuardDefinitions.every((definition) =>
          /UPDATE OF "organizationId", role/u.test(definition),
        ) &&
        /'SCANNER'/u.test(memberGuardBody?.body ?? ''),
      { note: memberGuardDefinitions.join(' | ') || 'missing' },
    ) && ok

  const scopeGuards = (
    await prisma.$queryRawUnsafe(
      'SELECT tgrelid::regclass::text AS relation FROM pg_trigger WHERE NOT tgisinternal ' +
        "AND tgname = 'desi_invitation_scope_same_organization' ORDER BY 1",
    )
  ).map((row) => row.relation)
  // The rows a later fixture put in on purpose (`legacy-door-*`) aside.
  const [invitationScopes] = await prisma.$queryRawUnsafe(
    'SELECT count(*)::int AS n FROM "InvitationScope" WHERE "id" NOT LIKE \'legacy-door-%\'',
  )
  ok =
    record(
      'invitation scopes start empty, guarded by their organisation-and-role trigger',
      scopeGuards.length === 1 &&
        scopeGuards[0] === '"InvitationScope"' &&
        invitationScopes.n === 0,
      { note: `${scopeGuards.join(', ') || 'no trigger'}; ${invitationScopes.n} rows` },
    ) && ok

  // The rows a later fixture put in on purpose (`legacy-import-*`) aside; the
  // pictures' table was dropped since (20261015100000).
  const [imports] = await prisma.$queryRawUnsafe(
    'SELECT (SELECT count(*) FROM "EventImportRun" WHERE "id" NOT LIKE \'legacy-import-%\')::int AS runs, ' +
      '(SELECT count(*) FROM "EventImportItem" WHERE "id" NOT LIKE \'legacy-import-%\')::int AS items, ' +
      '(SELECT count(*) FROM "EventPlatformEdit")::int AS sittings, ' +
      '(SELECT count(*) FROM "EventChangeNotice" WHERE "id" NOT LIKE \'legacy-import-%\')::int AS notices',
  )
  ok =
    record(
      'the import tables, sittings and change notices start empty',
      imports.runs === 0 && imports.items === 0 && imports.sittings === 0 && imports.notices === 0,
      {
        note:
          `${imports.runs} runs, ${imports.items} items, ` +
          `${imports.sittings} sittings, ${imports.notices} notices`,
      },
    ) && ok

  return ok
}

/**
 * Check what the SPEC3 migrations (booking fees, referral codes, paying at the
 * venue) made of a database that holds rows: each order's fee terms read from
 * its snapshot, every existing row a card order at the site default with
 * nothing due at the door, the new tables empty, the admission trigger
 * replaced with its old refusals kept, and the hand-on trigger unchanged.
 * And what SPEC3-XI adds to the same two migrations: no order with a referral
 * return marker, nothing cancelled unpaid and nothing kept, no kept-tax column
 * anywhere, the sold-count CHECK validated over existing tiers, and the
 * cancellation, due and referral triggers in place (the sums deferred).
 *
 * @param {object} prisma A client connected to the upgraded database.
 * @returns {Promise<boolean>} Whether every check passed.
 */
async function checkPaymentTermsAndVenueBackfills(prisma) {
  let ok = true

  const reasons = (
    await prisma.$queryRawUnsafe(
      'SELECT label.enumlabel AS label FROM pg_enum label JOIN pg_type type ON type.oid = label.enumtypid ' +
        `WHERE type.typname = 'RefundReason' ORDER BY label.enumsortorder`,
    )
  ).map((row) => row.label)
  ok =
    record('RefundReason names BOOKING_FEE', reasons.at(-1) === 'BOOKING_FEE', {
      note: reasons.join(', '),
    }) && ok

  const legacyOrders = await prisma.$queryRawUnsafe(
    'SELECT "id", "feesCents", "feeGrossCents", "feePercentageBps", "feeFlatCentsPerTicket" ' +
      `FROM "Order" WHERE "id" LIKE 'legacy-fee-order-%'`,
  )
  const wrongTerms = LEGACY_FEE_ORDERS.filter((legacy) => {
    const row = legacyOrders.find((order) => order.id === legacy.id)

    return (
      !row ||
      row.feeGrossCents !== legacy.feesCents ||
      row.feePercentageBps !== legacy.percentageBps ||
      row.feeFlatCentsPerTicket !== legacy.flatCentsPerTicket
    )
  })
  ok =
    record(
      "each order's gross fee is the fee it charged, and its terms are read from a usable snapshot only",
      wrongTerms.length === 0,
      {
        note:
          legacyOrders
            .map(
              (row) =>
                `${row.id}: gross ${row.feeGrossCents}, ` +
                `${row.feePercentageBps ?? 'null'} bps + ${row.feeFlatCentsPerTicket ?? 'null'}`,
            )
            .join('; ') || 'no legacy orders',
      },
    ) && ok

  const [orders] = await prisma.$queryRawUnsafe(
    'SELECT count(*)::int AS total, ' +
      `count(*) FILTER (WHERE "paymentMethod" <> 'CARD' OR "feeSource" <> 'SITE_DEFAULT' ` +
      'OR "feeWaivedCents" <> 0 OR "feeGrossCents" <> "feesCents" OR "feeSettingId" IS NOT NULL ' +
      'OR "referralCodeId" IS NOT NULL OR "venueDueCents" <> 0)::int AS changed FROM "Order"',
  )
  ok =
    record(
      'every existing order is a card order at the site default, with no waiver and nothing due at the door',
      orders.total > 0 && orders.changed === 0,
      { note: `${orders.changed} of ${orders.total} orders otherwise` },
    ) && ok

  const [events] = await prisma.$queryRawUnsafe(
    'SELECT count(*)::int AS total, ' +
      `count(*) FILTER (WHERE "feeSource" <> 'SITE_DEFAULT' OR "feePercentageBps" IS NOT NULL ` +
      'OR "feeFlatCentsPerTicket" IS NOT NULL OR "feeCurrency" IS NOT NULL OR "feeSettingId" IS NOT NULL ' +
      'OR "venuePaymentEnabled" OR "venuePaymentLimit" IS NOT NULL OR "venuePaymentChangedAt" IS NOT NULL ' +
      'OR "venuePaymentChangedById" IS NOT NULL OR "venuePaymentReason" IS NOT NULL)::int AS changed ' +
      'FROM "Event"',
  )
  ok =
    record(
      'every existing event takes the site default fee, with paying at the venue off and no limit',
      events.total > 0 && events.changed === 0,
      { note: `${events.changed} of ${events.total} events otherwise` },
    ) && ok

  const [lines] = await prisma.$queryRawUnsafe(
    'SELECT (SELECT count(*) FROM "OrderItem")::int AS lines, ' +
      '(SELECT count(*) FROM "OrderItem" WHERE "venueDueCents" <> 0)::int AS "linesDue", ' +
      '(SELECT count(*) FROM "Ticket")::int AS tickets, ' +
      '(SELECT count(*) FROM "Ticket" WHERE "venueDueCents" <> 0 OR "venuePaymentId" IS NOT NULL)::int AS "ticketsDue"',
  )
  ok =
    record(
      'every existing order line and ticket owes nothing at the door and has no door payment',
      lines.lines > 0 && lines.tickets > 0 && lines.linesDue === 0 && lines.ticketsDue === 0,
      {
        note:
          `${lines.linesDue} of ${lines.lines} lines and ${lines.ticketsDue} of ` +
          `${lines.tickets} tickets otherwise`,
      },
    ) && ok

  const [tables] = await prisma.$queryRawUnsafe(
    'SELECT (SELECT count(*) FROM "ReferralCode")::int AS codes, ' +
      '(SELECT count(*) FROM "ReferralCodeEvent")::int AS scopes, ' +
      '(SELECT count(*) FROM "EventFeeSetting")::int AS settings, ' +
      '(SELECT count(*) FROM "EventVenuePaymentChange")::int AS changes, ' +
      '(SELECT count(*) FROM "VenuePayment")::int AS payments',
  )
  ok =
    record(
      'the referral code, fee decision, switch change and door payment tables start empty',
      tables.codes === 0 &&
        tables.scopes === 0 &&
        tables.settings === 0 &&
        tables.changes === 0 &&
        tables.payments === 0,
      {
        note:
          `${tables.codes} codes, ${tables.scopes} scope rows, ${tables.settings} fee decisions, ` +
          `${tables.changes} switch changes, ${tables.payments} door payments`,
      },
    ) && ok

  const [admission] = await prisma.$queryRawUnsafe(
    "SELECT pg_get_functiondef('desi_check_in_ticket_admissible'::regproc) AS body",
  )
  const admissionPhrases = [
    'paid at the venue and its payment is not recorded',
    'which does not admit',
    'is for another night',
    'is good for every night, so its admission names the night',
    'admits once and was already admitted',
  ]
  const admissionBody = admission?.body ?? ''
  ok =
    record(
      'the admission trigger refuses an unpaid ticket and keeps every per-night refusal',
      admissionPhrases.every((phrase) => admissionBody.includes(phrase)),
      {
        note: admissionPhrases
          .map((phrase) => `${phrase}: ${admissionBody.includes(phrase) ? 'present' : 'missing'}`)
          .join('; '),
      },
    ) && ok

  const [transition] = await prisma.$queryRawUnsafe(
    "SELECT pg_get_functiondef('desi_ticket_status_transition'::regproc) AS body",
  )
  const transitionKept = ['has been let in on a night; it cannot be handed on', 'which is terminal']
  const transitionBody = transition?.body ?? ''
  // A ticket that owes a payment at the door is handed on like any other (open
  // question 7): the hand-on trigger keeps its earlier refusals and gains none
  // about the door.
  ok =
    record(
      'the hand-on trigger keeps its earlier refusals and does not refuse a ticket owing at the door',
      transitionKept.every((phrase) => transitionBody.includes(phrase)) &&
        !/venue|venueDueCents/i.test(transitionBody),
      {
        note:
          transitionKept
            .map(
              (phrase) => `${phrase}: ${transitionBody.includes(phrase) ? 'present' : 'missing'}`,
            )
            .join('; ') +
          `; mentions the venue: ${/venue|venueDueCents/i.test(transitionBody) ? 'yes' : 'no'}`,
      },
    ) && ok

  const triggers = await prisma.$queryRawUnsafe(
    'SELECT tgname, tgrelid::regclass::text AS relation, tgdeferrable, tginitdeferred, ' +
      '(tgconstraint <> 0) AS "isConstraint" FROM pg_trigger WHERE NOT tgisinternal AND tgname IN (' +
      "'desi_event_fee_setting_append_only', 'desi_ticket_venue_payment_guard', " +
      "'desi_venue_payment_append_only', 'desi_venue_payment_sum', " +
      "'desi_ticket_venue_payment_sum', 'desi_ticket_venue_payment_sum_on_delete') ORDER BY tgname",
  )
  const on = (name) => triggers.find((trigger) => trigger.tgname === name)
  ok =
    record(
      'the fee-decision, ticket-payment, payment append-only and payment-sum triggers exist where they belong',
      on('desi_event_fee_setting_append_only')?.relation === '"EventFeeSetting"' &&
        on('desi_ticket_venue_payment_guard')?.relation === '"Ticket"' &&
        on('desi_venue_payment_append_only')?.relation === '"VenuePayment"' &&
        on('desi_venue_payment_sum')?.relation === '"VenuePayment"' &&
        on('desi_ticket_venue_payment_sum')?.relation === '"Ticket"' &&
        on('desi_ticket_venue_payment_sum_on_delete')?.relation === '"Ticket"',
      { note: triggers.map((trigger) => `${trigger.tgname} on ${trigger.relation}`).join(', ') },
    ) && ok

  // The payment's own sum check, and the same check again for the payment a
  // ticket joins, changes its due under or leaves, in any later transaction.
  for (const name of [
    'desi_venue_payment_sum',
    'desi_ticket_venue_payment_sum',
    'desi_ticket_venue_payment_sum_on_delete',
  ]) {
    const sum = on(name)
    ok =
      record(
        `${name} is a constraint trigger, DEFERRABLE INITIALLY DEFERRED`,
        sum?.isConstraint === true && sum?.tgdeferrable === true && sum?.tginitdeferred === true,
        {
          note: sum
            ? `constraint=${sum.isConstraint} deferrable=${sum.tgdeferrable} initially deferred=${sum.tginitdeferred}`
            : 'missing',
        },
      ) && ok
  }

  ok = (await checkUnpaidCancellationAndReferralReturns(prisma)) && ok

  return ok
}

/**
 * Check what the rename migration made of the organisations its fixture put
 * in: the platform-held one has the new name and description and, because the
 * new address was taken, that address made unique from its id; the ordinary
 * organisation that had the address is as it was.
 *
 * @param {object} prisma A client connected to the upgraded database.
 * @returns {Promise<boolean>} Whether every check passed.
 */
async function checkPlatformHeldRename(prisma) {
  const rows = await prisma.$queryRawUnsafe(
    'SELECT "id", "name", "slug", "description", "platformHeldSource"::text AS source, ' +
      'substr(md5("id"), 1, 6) AS suffix FROM "Organization" ' +
      `WHERE "id" LIKE 'legacy-organisation-%' ORDER BY "id"`,
  )
  const held = rows.find((row) => row.id === LEGACY_ORGANISATIONS[0].id)
  const taken = rows.find((row) => row.id === LEGACY_ORGANISATIONS[1].id)
  const renamed =
    held?.name === RENAMED_PLATFORM_HELD.name &&
    held?.description === RENAMED_PLATFORM_HELD.description &&
    held?.slug === `the-desi-events-${held?.suffix}` &&
    held?.source === 'SULEKHA'
  const untouched =
    taken?.name === LEGACY_ORGANISATIONS[1].name &&
    taken?.slug === LEGACY_ORGANISATIONS[1].slug &&
    taken?.description === null &&
    taken?.source === null

  return record(
    'the platform-held organisation is renamed The Desi Events, its taken address made unique',
    renamed && untouched,
    {
      note: rows
        .map((row) => `${row.id}: ${row.slug}${row.source ? ' (platform-held)' : ''}`)
        .join('; '),
    },
  )
}

/**
 * Check what `20261015100000_imported_events_sold_here` made of a database
 * that holds an import from before it: every imported event's link to the
 * source cleared (the decided one with its switch, the current one with its
 * waiting flag worked out again), an organiser's own decided link and an event
 * nobody imported left as they were; the import record without its address,
 * the pictures' table gone; the stored file without its addresses; the
 * imported venue's provenance naming no site; and the new tier columns at
 * their defaults on every existing tier.
 *
 * @param {object} prisma A client connected to the upgraded database.
 * @returns {Promise<boolean>} Whether every check passed.
 */
async function checkImportedEventsSoldHere(prisma) {
  let ok = true
  const rows = await prisma.$queryRawUnsafe(
    'SELECT "id", "websiteUrl", "websiteRedirectEnabled", "websiteDecidedUrl", ' +
      '"websiteDecisionPending", "websiteSubmittedAt", "websiteRedirectChangedAt", ' +
      '"websiteRedirectReason", "revision" FROM "Event" ' +
      `WHERE "id" LIKE 'legacy-import-%' ORDER BY "id"`,
  )
  const byId = Object.fromEntries(rows.map((row) => [row.id, row]))
  const cleared = (row) =>
    row?.websiteUrl === null &&
    row.websiteRedirectEnabled === false &&
    row.websiteDecidedUrl === null &&
    row.websiteDecisionPending === false &&
    row.websiteSubmittedAt === null &&
    row.websiteRedirectChangedAt === null &&
    row.websiteRedirectReason === null
  const mixed = byId['legacy-import-mixed']
  const untouched = byId['legacy-import-not-imported']

  ok =
    record(
      'every imported event’s link to the source is cleared, and nothing else of anybody’s',
      cleared(byId['legacy-import-on']) &&
        cleared(byId['legacy-import-waiting']) &&
        mixed?.websiteUrl === null &&
        mixed.websiteRedirectEnabled === true &&
        mixed.websiteDecidedUrl === LEGACY_ORGANISER_SITE &&
        mixed.websiteDecisionPending === true &&
        untouched?.websiteUrl === LEGACY_SOURCE_LINK(3) &&
        untouched.websiteDecisionPending === true,
      {
        note: rows
          .map(
            (row) =>
              `${row.id}: ${row.websiteRedirectEnabled ? 'on' : 'off'}, ` +
              `${row.websiteUrl ? 'address kept' : 'no address'}`,
          )
          .join('; '),
      },
    ) && ok

  const [left] = await prisma.$queryRawUnsafe(
    'SELECT to_regclass(\'"EventImportImage"\') IS NULL AS dropped, ' +
      "NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'EventImportItem' " +
      "AND column_name = 'sourceUrl') AS address, " +
      `(SELECT count(*)::int FROM "EventImportItem" WHERE "id" LIKE 'legacy-import-%') AS items, ` +
      `(SELECT "provenance" FROM "Venue" WHERE "id" = '${LEGACY_IMPORTED_VENUE}') AS provenance, ` +
      `(SELECT "dataset" FROM "EventImportRun" WHERE "id" = '${LEGACY_IMPORT_RUN}') AS dataset, ` +
      `(SELECT "datasetSha256" FROM "EventImportRun" WHERE "id" = '${LEGACY_IMPORT_RUN}') AS sha, ` +
      '(SELECT count(*)::int FROM "TicketType" WHERE "importKey" IS NOT NULL OR "quantityIsAllowance") AS marked',
  )
  // The FAQ and notes the 20261015110000 fixture adds to the same file are
  // that migration's to check (`checkImportedListingWords`).
  const stored = left?.dataset ?? null
  const dataset = stored
    ? {
        ...stored,
        events: (stored.events ?? []).map(({ faq: _faq, importNotes: _notes, ...rest }) => rest),
      }
    : null

  ok =
    record(
      'the import keeps no address on the source: records, pictures, the stored file and the venue',
      left?.dropped === true &&
        left.address === true &&
        left.items === 3 &&
        left.provenance === 'import:listing' &&
        JSON.stringify(dataset) ===
          JSON.stringify({
            events: [{ title: 'Kept as it was', sourceId: '9100000000' }],
            format: 'desi-event-import/1',
            source: 'SULEKHA',
          }) &&
        left.sha === 'e'.repeat(64),
      {
        note:
          `pictures' table ${left?.dropped ? 'dropped' : 'still there'}; ` +
          `import address column ${left?.address ? 'dropped' : 'still there'}; ` +
          `${left?.items} records kept; venue ${left?.provenance}; stored file ${JSON.stringify(dataset)}`,
      },
    ) && ok

  return (
    record('every existing tier starts with no import key and no allowance', left?.marked === 0, {
      note: `${left?.marked} marked`,
    }) && ok
  )
}

/**
 * Check what `20261015110000_imported_listing_words` made of the words an
 * import wrote before it: the imported event's terms in this build's words
 * with its age limit, its FAQ without the entries naming the site and the
 * import's refund answer (the team's own kept), its record's notes, history
 * and change notice reworded, the stored file's FAQ and notes the same; the
 * event nobody imported left as it was; and no imported row, record, history,
 * notice or stored file naming the site but for the source's enum and file
 * names.
 *
 * @param {object} prisma A client connected to the upgraded database.
 * @returns {Promise<boolean>} Whether every check passed.
 */
async function checkImportedListingWords(prisma) {
  let ok = true
  // jsonb keeps its own key order, so values are compared with keys sorted.
  const canonical = (value) =>
    JSON.stringify(value, (_, item) =>
      item && typeof item === 'object' && !Array.isArray(item)
        ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
        : item,
    )
  const same = (left, right) => canonical(left) === canonical(right)
  const imported = LEGACY_IMPORTED_EVENTS[0].id
  const [row] = await prisma.$queryRawUnsafe(
    'SELECT e."policies", e."faq", i."importNotes", ' +
      `(SELECT "policies" FROM "Event" WHERE "id" = 'legacy-import-not-imported') AS theirs, ` +
      `(SELECT array_agg("reason" ORDER BY "id") FROM "EventModerationAction" WHERE "id" LIKE 'legacy-import-history-%') AS history, ` +
      `(SELECT "reason" FROM "EventChangeNotice" WHERE "id" = 'legacy-import-notice') AS notice, ` +
      `(SELECT "dataset" FROM "EventImportRun" WHERE "id" = '${LEGACY_IMPORT_RUN}') AS dataset ` +
      `FROM "Event" AS e JOIN "EventImportItem" AS i ON i."eventId" = e."id" WHERE e."id" = '${imported}'`,
  )

  ok =
    record(
      'an imported event’s terms and FAQ are in this build’s words, the team’s own entry kept',
      same(row?.policies, {
        entry:
          'Entry is run by the organiser who presents this event. Bring the ticket you bought on The Desi Events. Age: 21+.',
        refund:
          'Tickets for this event are sold on The Desi Events. If the event is cancelled, every ticket bought here is refunded. For anything else, contact The Desi Events before the event.',
        conduct: LEGACY_IMPORT_WORDS.policies.conduct,
      }) &&
        same(row.faq, [LEGACY_IMPORT_WORDS.faq[2], LEGACY_IMPORT_WORDS.faq[3]]) &&
        same(row.theirs, LEGACY_IMPORT_WORDS.policies),
      { note: `faq ${JSON.stringify(row?.faq)}` },
    ) && ok

  ok =
    record(
      'its notes, history, change notice and stored file name no other site',
      same(row?.importNotes, [
        'The source listing shows these prices in Canadian dollars (CA$); they are imported as CAD.',
        'This listing is also in the Texas file (collected 29-30 September 2026).',
      ]) &&
        same(row.history, [
          'Imported from its listing, run legacy-import-run.',
          'Updated from its source listing, run legacy-import-run.',
        ]) &&
        row.notice ===
          'Updated from its source listing by the team at The Desi Events, run legacy-import-run.' &&
        same(row.dataset?.events?.[0]?.faq, [LEGACY_IMPORT_WORDS.fileFaq[2]]) &&
        same(row.dataset?.events?.[0]?.importNotes, [
          'The source listing shows these prices in Canadian dollars (CA$); they are imported as CAD.',
        ]),
      {
        note: `notes ${JSON.stringify(row?.importNotes)}; history ${JSON.stringify(row?.history)}`,
      },
    ) && ok

  const [left] = await prisma.$queryRawUnsafe(
    'SELECT ' +
      '(SELECT count(*)::int FROM "Event" AS e WHERE EXISTS (SELECT 1 FROM "EventImportItem" AS i WHERE i."eventId" = e."id") ' +
      "AND (COALESCE(e.\"policies\"::text, '') || COALESCE(e.\"faq\"::text, '') || COALESCE(e.\"websiteRedirectReason\", '')) ~* 'sulekha') AS events, " +
      '(SELECT count(*)::int FROM "EventImportItem" WHERE array_to_string("importNotes", \' \') ~* \'sulekha\') AS items, ' +
      '(SELECT count(*)::int FROM "EventModerationAction" AS m WHERE m."reason" ~* \'sulekha\' ' +
      'AND EXISTS (SELECT 1 FROM "EventImportItem" AS i WHERE i."eventId" = m."eventId")) AS history, ' +
      '(SELECT count(*)::int FROM "EventChangeNotice" AS c WHERE c."reason" ~* \'sulekha\' ' +
      'AND EXISTS (SELECT 1 FROM "EventImportItem" AS i WHERE i."eventId" = c."eventId")) AS notices, ' +
      '(SELECT count(*)::int FROM "EventImportRun" WHERE ("dataset" - \'source\')::text ~* \'sulekha\') AS files',
  )

  return (
    record(
      'no imported event, record, history, notice or stored file names the site (enum and file names aside)',
      left.events === 0 &&
        left.items === 0 &&
        left.history === 0 &&
        left.notices === 0 &&
        left.files === 0,
      { note: JSON.stringify(left) },
    ) && ok
  )
}

/**
 * Check what `20261016100000_canadian_prices_confirmed_cad` made of the note
 * asking to check a Canadian listing's currency: reworded, word for word, on
 * the import record, in the stored file and in the stored plan; the notes
 * beside it, a note in other words and a listing with no notes left as they
 * were; the stored file's SHA-256 unchanged; the old sentence nowhere; and
 * the migration's helper function gone.
 *
 * @param {object} prisma A client connected to the upgraded database.
 * @returns {Promise<boolean>} Whether every check passed.
 */
async function checkCanadianPricesConfirmed(prisma) {
  let ok = true
  // jsonb keeps its own key order, so values are compared with keys sorted.
  const canonical = (value) =>
    JSON.stringify(value, (_, item) =>
      item && typeof item === 'object' && !Array.isArray(item)
        ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
        : item,
    )
  const same = (left, right) => canonical(left) === canonical(right)
  const [row] = await prisma.$queryRawUnsafe(
    'SELECT i."importNotes" AS notes, r."dataset", r."plan", r."datasetSha256" AS sha, ' +
      "to_regproc('confirm_cad_note_in') IS NULL AS dropped " +
      `FROM "EventImportItem" AS i, "EventImportRun" AS r ` +
      `WHERE i."eventId" = '${LEGACY_IMPORTED_EVENTS[1].id}' AND r."id" = '${LEGACY_CAD_RUN}'`,
  )

  ok =
    record(
      'the note asking to check a Canadian currency says the owner confirmed CAD, and nothing else changed',
      same(row?.notes, [CAD_NOTE.other, CAD_NOTE.after, CAD_NOTE.reworded]) &&
        same(row.dataset?.events?.[0]?.importNotes, [CAD_NOTE.after, CAD_NOTE.other]) &&
        same(row.dataset?.events?.[1], {
          sourceId: '9100000102',
          title: 'A listing with no notes',
        }) &&
        same(
          (row.plan ?? []).map((entry) => entry.importNotes),
          [[CAD_NOTE.after], []],
        ) &&
        row.sha === 'c'.repeat(64) &&
        row.dropped === true,
      {
        note: `notes ${JSON.stringify(row?.notes)}; file ${JSON.stringify(row?.dataset?.events)}; plan ${JSON.stringify(row?.plan)}; helper ${row?.dropped ? 'dropped' : 'left behind'}`,
      },
    ) && ok

  const [left] = await prisma.$queryRawUnsafe(
    'SELECT ' +
      `(SELECT count(*)::int FROM "EventImportItem" WHERE ${literalSql(CAD_NOTE.before)} = ANY("importNotes")) AS items, ` +
      `(SELECT count(*)::int FROM "EventImportRun" WHERE ("dataset"::text || "plan"::text) LIKE ${literalSql(`%${CAD_NOTE.before.slice(-40)}%`)}) AS runs`,
  )

  return (
    record(
      'no import record, stored file or stored plan still asks to check the currency in the old words',
      left?.items === 0 && left.runs === 0,
      { note: JSON.stringify(left) },
    ) && ok
  )
}

/**
 * Check what `20261016140000_venue_region_codes` made of venues typed before
 * venue writes stored codes: a state named in full is its code, a typed code
 * and a country are in capitals, and a region that is no code is untouched.
 *
 * @param {object} prisma A client connected to the upgraded database.
 * @returns {Promise<boolean>} Whether every check passed.
 */
async function checkVenueRegionCodes(prisma) {
  const rows = await prisma.$queryRawUnsafe(
    'SELECT "id", "region", "country" FROM "Venue" WHERE "id" LIKE \'legacy-venue-%\' ORDER BY "id"',
  )
  const found = new Map(rows.map((row) => [row.id, [row.region, row.country]]))
  const wrong = LEGACY_TYPED_VENUES.filter(
    (legacy) => JSON.stringify(found.get(legacy.id)) !== JSON.stringify(legacy.after),
  )

  return record(
    'a venue state typed by name is its code, codes and countries are in capitals, and any other region is untouched',
    wrong.length === 0 && rows.length === LEGACY_TYPED_VENUES.length,
    { note: JSON.stringify(Object.fromEntries(found)) },
  )
}

/**
 * Check what `20261016150000_event_move_leaves_no_door_scope` made of door
 * scopes on an event that had moved to another organisation: both gone, the
 * scopes of the event that stayed kept, no door scope anywhere naming another
 * organisation's event, and the guard trigger on `Event`.
 *
 * @param {object} prisma A client connected to the upgraded database.
 * @returns {Promise<boolean>} Whether every check passed.
 */
async function checkEventMoveDoorScopes(prisma) {
  const [row] = await prisma.$queryRawUnsafe(
    'SELECT ' +
      '(SELECT array_agg("id" ORDER BY "id") FROM "ScannerScope" WHERE "id" LIKE \'legacy-door-%\') AS members, ' +
      '(SELECT array_agg("id" ORDER BY "id") FROM "InvitationScope" WHERE "id" LIKE \'legacy-door-%\') AS invitations, ' +
      '(SELECT count(*)::int FROM "ScannerScope" s JOIN "Membership" m ON m."id" = s."membershipId" ' +
      'JOIN "Event" e ON e."id" = s."eventId" WHERE m."organizationId" <> e."organizationId") AS "crossMembers", ' +
      '(SELECT count(*)::int FROM "InvitationScope" s JOIN "Invitation" i ON i."id" = s."invitationId" ' +
      'JOIN "Event" e ON e."id" = s."eventId" WHERE i."organizationId" <> e."organizationId") AS "crossInvitations", ' +
      '(SELECT count(*)::int FROM pg_trigger WHERE NOT tgisinternal ' +
      "AND tgname = 'desi_event_move_leaves_no_door_scope' AND tgrelid = '\"Event\"'::regclass) AS guards",
  )

  return record(
    'door scopes on a moved event are gone, its own organisation’s are kept, none crosses organisations, and the move guard is on Event',
    JSON.stringify(row?.members) === JSON.stringify([`${LEGACY_DOOR.kept}-member`]) &&
      JSON.stringify(row.invitations) === JSON.stringify([`${LEGACY_DOOR.kept}-invitation`]) &&
      row.crossMembers === 0 &&
      row.crossInvitations === 0 &&
      row.guards === 1,
    { note: JSON.stringify(row) },
  )
}

/**
 * A text value as an SQL string literal.
 *
 * @param {string} text The value.
 * @returns {string} It quoted, with any `'` doubled.
 */
function literalSql(text) {
  return `'${text.replaceAll("'", "''")}'`
}

/**
 * Check what SPEC3-XI added to the payment-terms and pay-at-the-venue
 * migrations, over a database that holds rows (SPEC3-XI §5.7): nothing
 * cancelled unpaid, nothing kept and no referral use given back on any existing
 * row; no kept-tax column; `ticket_type_sold_not_negative` validated over the
 * existing tiers; the due, cancellation and referral triggers on their tables,
 * the three cancellation sums deferred to commit; the payment guard refusing a
 * cancelled ticket; and the hand-on trigger still silent about paying at the
 * venue.
 *
 * @param {object} prisma A client connected to the upgraded database.
 * @returns {Promise<boolean>} Whether every check passed.
 */
async function checkUnpaidCancellationAndReferralReturns(prisma) {
  let ok = true

  const [orders] = await prisma.$queryRawUnsafe(
    'SELECT count(*)::int AS total, ' +
      'count(*) FILTER (WHERE "venueCancelledBasisCents" <> 0 OR "venueFeeKeptCents" <> 0 ' +
      'OR "referralUseReturnedAt" IS NOT NULL OR "referralUseReturnCause" IS NOT NULL)::int AS changed ' +
      'FROM "Order"',
  )
  ok =
    record(
      'every existing order has nothing cancelled unpaid, nothing kept and no referral use given back',
      orders.total > 0 && orders.changed === 0,
      { note: `${orders.changed} of ${orders.total} orders otherwise` },
    ) && ok

  const keptTax = await prisma.$queryRawUnsafe(
    "SELECT table_name || '.' || column_name AS name FROM information_schema.columns " +
      "WHERE table_schema = 'public' AND column_name IN ('venueTaxKeptCents', 'taxKeptCents')",
  )
  ok =
    record(
      'no column keeps tax: only the booking fee is ever kept (no venueTaxKeptCents, no taxKeptCents)',
      keptTax.length === 0,
      { note: keptTax.map((row) => row.name).join(', ') || 'none' },
    ) && ok

  const [rows] = await prisma.$queryRawUnsafe(
    'SELECT (SELECT count(*) FROM "OrderItem")::int AS lines, ' +
      '(SELECT count(*) FROM "OrderItem" WHERE "venueCancelledQuantity" <> 0)::int AS "linesCancelled", ' +
      '(SELECT count(*) FROM "Ticket")::int AS tickets, ' +
      '(SELECT count(*) FROM "Ticket" WHERE "venueCancellationId" IS NOT NULL)::int AS "ticketsCancelled", ' +
      '(SELECT count(*) FROM "VenueBookingCancellation")::int AS cancellations',
  )
  ok =
    record(
      'no existing line or ticket is cancelled unpaid, and the cancellation table starts empty',
      rows.lines > 0 &&
        rows.tickets > 0 &&
        rows.linesCancelled === 0 &&
        rows.ticketsCancelled === 0 &&
        rows.cancellations === 0,
      {
        note:
          `${rows.linesCancelled} of ${rows.lines} lines and ${rows.ticketsCancelled} of ` +
          `${rows.tickets} tickets cancelled; ${rows.cancellations} cancellations`,
      },
    ) && ok

  const [sold] = await prisma.$queryRawUnsafe(
    'SELECT (SELECT count(*) FROM "TicketType")::int AS tiers, ' +
      "(SELECT convalidated FROM pg_constraint WHERE conname = 'ticket_type_sold_not_negative' " +
      'AND conrelid = \'"TicketType"\'::regclass) AS validated',
  )
  ok =
    record(
      'ticket_type_sold_not_negative is validated over the existing tiers',
      sold.tiers > 0 && sold.validated === true,
      { note: `${sold.tiers} tiers; validated=${sold.validated}` },
    ) && ok

  const names = [
    'desi_order_referral_fixed',
    'desi_ticket_venue_due_guard',
    'desi_ticket_venue_cancellation_guard',
    'desi_venue_booking_cancellation_append_only',
    'desi_venue_booking_cancellation_sum',
    'desi_ticket_venue_cancellation_sum',
    'desi_ticket_venue_cancellation_sum_on_delete',
  ]
  const triggers = await prisma.$queryRawUnsafe(
    'SELECT tgname, tgrelid::regclass::text AS relation, tgdeferrable, tginitdeferred, ' +
      '(tgconstraint <> 0) AS "isConstraint" FROM pg_trigger WHERE NOT tgisinternal AND tgname IN (' +
      names.map((name) => `'${name}'`).join(', ') +
      ') ORDER BY tgname',
  )
  const on = (name) => triggers.find((trigger) => trigger.tgname === name)
  ok =
    record(
      'the referral-return, due, cancellation guard, append-only and cancellation-sum triggers exist where they belong',
      on('desi_order_referral_fixed')?.relation === '"Order"' &&
        on('desi_ticket_venue_due_guard')?.relation === '"Ticket"' &&
        on('desi_ticket_venue_cancellation_guard')?.relation === '"Ticket"' &&
        on('desi_venue_booking_cancellation_append_only')?.relation ===
          '"VenueBookingCancellation"' &&
        on('desi_venue_booking_cancellation_sum')?.relation === '"VenueBookingCancellation"' &&
        on('desi_ticket_venue_cancellation_sum')?.relation === '"Ticket"' &&
        on('desi_ticket_venue_cancellation_sum_on_delete')?.relation === '"Ticket"',
      { note: triggers.map((trigger) => `${trigger.tgname} on ${trigger.relation}`).join(', ') },
    ) && ok

  // A cancellation's own sum check, and the same check again for the
  // cancellation a ticket joins or leaves, in any later transaction.
  for (const name of [
    'desi_venue_booking_cancellation_sum',
    'desi_ticket_venue_cancellation_sum',
    'desi_ticket_venue_cancellation_sum_on_delete',
  ]) {
    const sum = on(name)
    ok =
      record(
        `${name} is a constraint trigger, DEFERRABLE INITIALLY DEFERRED`,
        sum?.isConstraint === true && sum?.tgdeferrable === true && sum?.tginitdeferred === true,
        {
          note: sum
            ? `constraint=${sum.isConstraint} deferrable=${sum.tgdeferrable} initially deferred=${sum.tginitdeferred}`
            : 'missing',
        },
      ) && ok
  }

  const [guard] = await prisma.$queryRawUnsafe(
    "SELECT pg_get_functiondef('desi_ticket_venue_payment_guard'::regproc) AS body",
  )
  ok =
    record(
      'the payment guard refuses paying a ticket cancelled unpaid (it reads venueCancellationId)',
      (guard?.body ?? '').includes('venueCancellationId'),
      { note: (guard?.body ?? '').includes('venueCancellationId') ? 'present' : 'missing' },
    ) && ok

  const [transition] = await prisma.$queryRawUnsafe(
    "SELECT pg_get_functiondef('desi_ticket_status_transition'::regproc) AS body",
  )
  ok =
    record(
      'the hand-on trigger says nothing about tickets paid at the venue',
      !/paid at the venue/i.test(transition?.body ?? ''),
      { note: /paid at the venue/i.test(transition?.body ?? '') ? 'mentions it' : 'silent' },
    ) && ok

  return ok
}

/**
 * Everything about a database's structure, and nothing about its contents.
 *
 * Six catalogues, because a migration can go wrong in six different places: a
 * column, a constraint, an index, a trigger, an enum's labels, or the body of a
 * function a trigger calls. Row data is deliberately absent — the upgraded
 * database holds fixtures and the fresh one does not.
 *
 * @param {object} prisma A client connected to the database to describe.
 * @returns {Promise<Record<string, string[]>>} One sorted list of statements per catalogue.
 */
async function catalogue(prisma) {
  const [columns, constraints, indexes, triggers, enums, functions] = await Promise.all([
    prisma.$queryRawUnsafe(
      "SELECT table_name || '.' || column_name || ' ' || data_type || ' ' || udt_name || " +
        "' null=' || is_nullable || ' default=' || coalesce(column_default, 'none') AS line " +
        "FROM information_schema.columns WHERE table_schema = 'public' " +
        "AND table_name <> '_prisma_migrations'",
    ),
    prisma.$queryRawUnsafe(
      "SELECT conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid) AS line " +
        "FROM pg_constraint WHERE connamespace = 'public'::regnamespace",
    ),
    prisma.$queryRawUnsafe(
      "SELECT indexdef AS line FROM pg_indexes WHERE schemaname = 'public' " +
        "AND tablename <> '_prisma_migrations'",
    ),
    prisma.$queryRawUnsafe(
      'SELECT pg_get_triggerdef(oid) AS line FROM pg_trigger WHERE NOT tgisinternal',
    ),
    prisma.$queryRawUnsafe(
      "SELECT type.typname || ' ' || label.enumsortorder || ' ' || label.enumlabel AS line " +
        'FROM pg_enum label JOIN pg_type type ON type.oid = label.enumtypid',
    ),
    prisma.$queryRawUnsafe(
      'SELECT pg_get_functiondef(oid) AS line FROM pg_proc ' +
        "WHERE pronamespace = 'public'::regnamespace",
    ),
  ])

  /**
   * Sorted statement text, so two databases compare as sets rather than as
   * whatever order the catalogue happened to return.
   *
   * @param {object[]} rows Rows carrying a `line` column.
   * @returns {string[]} Sorted lines.
   */
  const lines = (rows) => rows.map((row) => row.line).sort()

  return {
    columns: lines(columns),
    constraints: lines(constraints),
    indexes: lines(indexes),
    triggers: lines(triggers),
    enums: lines(enums),
    functions: lines(functions),
  }
}

/**
 * Where two catalogues disagree.
 *
 * @param {Record<string, string[]>} upgraded The catalogue of the upgraded database.
 * @param {Record<string, string[]>} fresh The catalogue of a database built from zero.
 * @returns {string[]} One line per difference, naming which side has it.
 */
function compare(upgraded, fresh) {
  const differences = []

  for (const kind of Object.keys(fresh)) {
    const onlyUpgraded = upgraded[kind].filter((line) => !fresh[kind].includes(line))
    const onlyFresh = fresh[kind].filter((line) => !upgraded[kind].includes(line))

    for (const line of onlyUpgraded) differences.push(`${kind}: only after upgrade — ${line}`)
    for (const line of onlyFresh) differences.push(`${kind}: only when fresh — ${line}`)
  }

  return differences
}

/**
 * Count every row in every application table.
 *
 * @param {object} prisma A client connected to the disposable database.
 * @returns {Promise<Record<string, number>>} Table name to row count.
 */
async function countRows(prisma) {
  const rows = await prisma.$queryRawUnsafe(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' " +
      "AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY table_name",
  )

  /** @type {Record<string, number>} */
  const counts = {}

  for (const { table_name: table } of rows) {
    const [count] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "${table}"`)
    counts[table] = count.n
  }

  return counts
}

/**
 * Run the whole verification.
 *
 * @returns {Promise<number>} A process exit code.
 */
async function main() {
  const keep = process.argv.includes('--keep')
  const reportArgument = process.argv.find((argument) => argument.startsWith('--report='))

  let target
  let template

  try {
    ;({ target, template } = resolveDisposableTarget(process.env))
  } catch (error) {
    console.error(`\n${error.message}\n`)

    return 2
  }

  const name = databaseName(target)
  const all = readdirSync(MIGRATIONS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  const before = all.filter(
    (migration) => !PHASE2_MIGRATIONS.includes(migration) && !PHASE3_MIGRATIONS.includes(migration),
  )
  const phase2 = all.filter((migration) => PHASE2_MIGRATIONS.includes(migration))
  const phase3 = all.filter((migration) => PHASE3_MIGRATIONS.includes(migration))

  console.log('Populated-upgrade verification')
  console.log(`  target: ${redacted(target)}`)
  console.log(
    `  upgrading a database holding rows: ${before.length} migrations, then ${phase2.length}, then ${phase3.length}`,
  )
  console.log('  credentials are never printed; only the disposable database name is.\n')

  let created = false
  let createdComparison = false
  let comparison = null
  let prisma = null
  let fresh = null
  let ok = true

  try {
    if (phase2.length !== PHASE2_MIGRATIONS.length) {
      return record('the Phase 2 migrations named here exist', false, {
        note: `expected ${PHASE2_MIGRATIONS.join(', ')}`,
      })
        ? 0
        : 1
    }
    if (phase3.length !== PHASE3_MIGRATIONS.length) {
      return record('the Phase 3 migrations named here exist', false, {
        note: `expected ${PHASE3_MIGRATIONS.join(', ')}`,
      })
        ? 0
        : 1
    }
    // The two checks above compare a filtered result against its own named
    // list, so they catch a migration that was renamed or deleted and can never
    // catch one that was *added*: an unclassified name simply falls into
    // `before` and gets applied against a schema written years before it. That
    // has now happened twice — see the comments on `20260916000000_event_draft_revision`
    // and `20260921090000_payout_currency_trigger_repair` — and both times the
    // symptom was a structural diff at the very end of the run with nothing in
    // it naming the cause. So the default is closed rather than open: anything
    // in `before` that sorts after the Phase 2 group is a migration nobody
    // classified, and it fails here, by name, with the one-line remedy.
    const lastPhase2 = [...PHASE2_MIGRATIONS].sort().at(-1)
    const unclassified = before.filter((migration) => migration > lastPhase2)

    if (unclassified.length > 0) {
      return record('every migration after the Phase 2 group is classified', false, {
        unclassified,
        note:
          `${unclassified.join(', ')} — add to PHASE3_MIGRATIONS, or this runs ` +
          'before the schema it was written against',
      })
        ? 0
        : 1
    }

    await createDatabase(template, name)
    created = true
    record('a disposable database was created', true, { note: name })

    for (const migration of before) {
      const applied = await applyMigration(target, migration)
      ok =
        record(`the pre-Phase-2 migration ${migration} applied`, applied.code === 0, {
          note: applied.code === 0 ? undefined : applied.output.replace(/\s+/g, ' ').slice(0, 240),
        }) && ok
    }

    if (!ok) return 1

    prisma = createPrismaClient({ connectionString: target })

    const { filled, skipped } = await populate(prisma)
    ok =
      record('every pre-Phase-2 table holds a row', skipped.length === 0, {
        filled: filled.length,
        skipped,
        note: `${filled.length} tables filled${skipped.length ? `, ${skipped.length} refused` : ''}`,
      }) && ok

    const populated = await countRows(prisma)
    const [adminBefore] = await prisma.$queryRawUnsafe(
      `UPDATE "User" SET "role" = 'ADMIN' WHERE id = 'upgrade-fixture-User' RETURNING "role"::text AS role`,
    )
    ok =
      record(
        'a pre-Phase-2 row carries the old ADMIN role, so the backfill has work to do',
        adminBefore?.role === 'ADMIN',
        { note: String(adminBefore?.role) },
      ) && ok

    await prisma.$disconnect()
    prisma = null

    // The check this script exists for. Both defects found while writing Phase 2
    // failed exactly here and nowhere else.
    for (const migration of phase2) {
      const applied = await applyMigration(target, migration)
      ok =
        record(
          `the Phase 2 migration ${migration} applied over existing rows`,
          applied.code === 0,
          {
            note:
              applied.code === 0 ? undefined : applied.output.replace(/\s+/g, ' ').slice(0, 400),
          },
        ) && ok
    }

    let legacy = null
    /** @type {Record<string, number>} Rows the per-migration fixtures added, per table. */
    const fixtureRows = {}

    for (const migration of phase3) {
      if (migration === FIRST_FEATURE_MIGRATION) {
        prisma = createPrismaClient({ connectionString: target })
        legacy = await seedLegacyRows(prisma, filled)
        await prisma.$disconnect()
        prisma = null

        ok =
          record(
            'rows the API at a6bd5e4 could write are in place before the feature migrations',
            legacy.refused.length === 0,
            {
              added: legacy.added,
              refused: legacy.refused,
              note: Object.entries(legacy.added)
                .map(([table, count]) => `${count} ${table}`)
                .join(', '),
            },
          ) && ok
      }

      const fixture = BEFORE_MIGRATION_FIXTURES[migration]

      if (fixture) {
        prisma = createPrismaClient({ connectionString: target })

        try {
          const added = await fixture(prisma)

          for (const [table, count] of Object.entries(added)) {
            fixtureRows[table] = (fixtureRows[table] ?? 0) + count
          }
          ok =
            record(`the rows ${migration} rewrites are in place before it`, true, {
              added,
              note: Object.entries(added)
                .map(([table, count]) => `${count} ${table}`)
                .join(', '),
            }) && ok
        } catch (error) {
          ok =
            record(`the rows ${migration} rewrites are in place before it`, false, {
              note: String(error?.message ?? error)
                .replace(/\s+/g, ' ')
                .slice(0, 300),
            }) && ok
        } finally {
          await prisma.$disconnect()
          prisma = null
        }
      }

      const applied = await applyMigration(target, migration)
      ok =
        record(
          `the Phase 3 migration ${migration} applied over existing rows`,
          applied.code === 0,
          {
            note:
              applied.code === 0 ? undefined : applied.output.replace(/\s+/g, ' ').slice(0, 400),
          },
        ) && ok
    }

    if (!ok) return 1

    prisma = createPrismaClient({ connectionString: target })
    const upgraded = await countRows(prisma)

    // The rows put in on purpose are expected, and so are the audit rows two
    // migrations write about what they changed; nothing else.
    const expected = { ...populated }

    for (const [table, count] of Object.entries(legacy?.added ?? {})) {
      if (table in expected) expected[table] += count
    }
    for (const [table, count] of Object.entries(fixtureRows)) {
      if (table in expected) expected[table] += count
    }
    // Two for the covers the media migration drops, and one for each legacy
    // admission the per-night migration gives a night.
    if ('AuditLog' in expected) expected.AuditLog += 2 + LEGACY_ADMISSION_AUDITS

    const lost = Object.entries(expected).filter(([table, count]) => upgraded[table] !== count)
    ok =
      record('the upgrade preserved every existing row', lost.length === 0, {
        lost: lost.map(([table, count]) => ({ table, before: count, after: upgraded[table] })),
        note: `${Object.keys(populated).length} pre-existing tables`,
      }) && ok

    if (!legacy) {
      ok = record(`the legacy rows went in before ${FIRST_FEATURE_MIGRATION}`, false) && ok
    } else {
      ok = (await checkLegacyBackfills(prisma)) && ok
    }

    ok = (await checkSpec2Backfills(prisma)) && ok
    ok = (await checkFullControlAndImportBackfills(prisma)) && ok
    ok = (await checkPaymentTermsAndVenueBackfills(prisma)) && ok
    ok = (await checkPlatformHeldRename(prisma)) && ok
    ok = (await checkImportedEventsSoldHere(prisma)) && ok
    ok = (await checkImportedListingWords(prisma)) && ok
    ok = (await checkCanadianPricesConfirmed(prisma)) && ok
    ok = (await checkVenueRegionCodes(prisma)) && ok
    ok = (await checkEventMoveDoorScopes(prisma)) && ok

    const [adminAfter] = await prisma.$queryRawUnsafe(
      `SELECT "role"::text AS role FROM "User" WHERE id = 'upgrade-fixture-User'`,
    )
    ok =
      record(
        'the platform-role rename backfilled ADMIN to SUPER_ADMIN',
        adminAfter?.role === 'SUPER_ADMIN',
        { note: String(adminAfter?.role) },
      ) && ok

    // Defect (1), stated as a check. The column has to end up NOT NULL with no
    // default — a migration that reached the end by leaving the default in place
    // would pass every other check here.
    const [updatedAt] = await prisma.$queryRawUnsafe(
      'SELECT is_nullable, column_default FROM information_schema.columns ' +
        "WHERE table_schema = 'public' AND table_name = 'Membership' AND column_name = 'updatedAt'",
    )
    ok =
      record(
        'a column added NOT NULL over existing rows kept no leftover default',
        updatedAt?.is_nullable === 'NO' && updatedAt?.column_default === null,
        {
          note: `is_nullable=${updatedAt?.is_nullable} default=${updatedAt?.column_default ?? 'none'}`,
        },
      ) && ok

    // Defect (2), stated as a check. An inner COMMIT ends Prisma's transaction
    // early, and everything after it runs auto-committed; the tail of the file
    // is where that shows.
    const [accounts] = await prisma.$queryRawUnsafe(
      'SELECT count(*)::int AS n FROM "LedgerAccount"',
    )
    const triggers = await prisma.$queryRawUnsafe(
      "SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE 'desi_%' ORDER BY tgname",
    )
    ok =
      record('the whole migration ran, tail included', accounts.n === 10 && triggers.length >= 12, {
        accounts: accounts.n,
        triggers: triggers.map((trigger) => trigger.tgname),
        note: `${accounts.n} ledger accounts, ${triggers.length} triggers`,
      }) && ok

    const upgradedCatalogue = await catalogue(prisma)
    await prisma.$disconnect()
    prisma = null

    // The claim worth making, and the one `migrate diff --to-schema` cannot
    // make: an upgraded database and a database built from zero are the same
    // database. Comparing against `schema.prisma` would report the four
    // hand-written facet indexes as differences, because Prisma's schema
    // language cannot express a partial or GIN index — so the comparison is
    // against a real fresh build, which has them.
    comparison = withDatabase(template, disposableDatabaseName())
    await createDatabase(template, databaseName(comparison))
    createdComparison = true

    let freshOk = true
    for (const migration of all) {
      const applied = await applyMigration(comparison, migration)
      freshOk = freshOk && applied.code === 0
    }
    ok =
      record('a comparison database was built from zero', freshOk, {
        note: `${all.length} migrations`,
      }) && ok

    fresh = createPrismaClient({ connectionString: comparison })
    const freshCatalogue = await catalogue(fresh)
    await fresh.$disconnect()
    fresh = null

    const differences = compare(upgradedCatalogue, freshCatalogue)
    ok =
      record(
        'the upgraded database is structurally identical to a fresh one',
        differences.length === 0,
        {
          differences: differences.slice(0, 40),
          note:
            differences.length === 0
              ? `${Object.values(freshCatalogue).reduce((total, rows) => total + rows.length, 0)} catalogue entries agree`
              : `${differences.length} differences`,
        },
      ) && ok
  } catch (error) {
    ok = record('the verification ran to completion', false, {
      note: String(error?.message ?? error).slice(0, 300),
    })
  } finally {
    if (prisma) await prisma.$disconnect().catch(() => {})
    if (fresh) await fresh.$disconnect().catch(() => {})

    if (createdComparison && !keep) {
      try {
        await dropDatabase(template, databaseName(comparison))
        record('the comparison database was destroyed', true, { note: databaseName(comparison) })
      } catch (error) {
        ok = record('the comparison database was destroyed', false, {
          note: String(error?.message ?? error).slice(0, 200),
        })
      }
    } else if (createdComparison) {
      console.log(`\nKept ${redacted(comparison)} at your request. Drop it when you are done.`)
    }

    if (created && !keep) {
      try {
        await dropDatabase(template, name)
        record('the disposable database was destroyed', true, { note: name })
      } catch (error) {
        ok = record('the disposable database was destroyed', false, {
          note: String(error?.message ?? error).slice(0, 200),
        })
      }
    } else if (created) {
      console.log(`\nKept ${redacted(target)} at your request. Drop it when you are done.`)
    }
  }

  const report = {
    target: redacted(target),
    database: name,
    ranAt: new Date().toISOString(),
    ok,
    steps,
  }

  if (reportArgument) {
    const file = path.resolve(REPO_ROOT, reportArgument.slice('--report='.length))
    writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`)
    console.log(`\nReport written to ${file}`)
  }

  const passed = steps.filter((step) => step.ok).length
  console.log(`\n${passed}/${steps.length} checks passed.`)

  return ok ? 0 : 1
}

process.exitCode = await main()
