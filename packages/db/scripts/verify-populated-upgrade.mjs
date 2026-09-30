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
