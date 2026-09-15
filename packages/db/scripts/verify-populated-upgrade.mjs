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
  const before = all.filter((migration) => !PHASE2_MIGRATIONS.includes(migration))
  const phase2 = all.filter((migration) => PHASE2_MIGRATIONS.includes(migration))

  console.log('Populated-upgrade verification')
  console.log(`  target: ${redacted(target)}`)
  console.log(
    `  upgrading a database holding rows: ${before.length} migrations, then ${phase2.length}`,
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

    if (!ok) return 1

    prisma = createPrismaClient({ connectionString: target })
    const upgraded = await countRows(prisma)

    const lost = Object.entries(populated).filter(([table, count]) => upgraded[table] !== count)
    ok =
      record('the upgrade preserved every existing row', lost.length === 0, {
        lost: lost.map(([table, count]) => ({ table, before: count, after: upgraded[table] })),
        note: `${Object.keys(populated).length} pre-existing tables`,
      }) && ok

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
