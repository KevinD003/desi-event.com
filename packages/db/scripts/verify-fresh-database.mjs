#!/usr/bin/env node
/**
 * Prove the migrations, the schema's invariants and the seed against a
 * database that has never seen this project before.
 *
 * A development database accumulates history: columns added by hand, rows left
 * behind by an earlier schema, a migration applied out of order and forgotten.
 * Verifying against it proves that *that* database works, which is not the
 * claim anyone cares about. So this script builds a new one, named
 * `desi_event_disposable_<random>`, walks every migration into it from zero,
 * seeds it twice, probes the constraints the application relies on but cannot
 * enforce, runs the integration suites against it, and drops it again.
 *
 * Two rules are enforced rather than documented:
 *
 *   1. The target database name must match {@link DISPOSABLE_NAME}. Anything
 *      else — including `DATABASE_URL` and `TEST_DATABASE_URL` — is refused
 *      before a single statement runs. There is no flag that overrides this.
 *   2. Only a database this run created is ever dropped.
 *
 * Nothing printed here contains a credential: the connection is reported as a
 * redacted identifier carrying the disposable database's name and nothing else.
 *
 * Usage:
 *   pnpm db:verify:fresh
 *   pnpm db:verify:fresh --keep          # leave the database behind to inspect
 *   pnpm db:verify:fresh --report=out.json
 *
 * @module @desi-event/db/scripts/verify-fresh-database
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
  redactedIdentifier as redacted,
  resolveDisposableTarget,
  withDatabase,
} from './disposable-database.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = path.resolve(HERE, '..')
const REPO_ROOT = path.resolve(PACKAGE_ROOT, '..', '..')

loadDotenv({ path: path.join(REPO_ROOT, '.env'), override: false, quiet: true })

/**
 * Tables a migration populates, and how many rows each should hold before the
 * seed runs.
 *
 * The chart of accounts is structure rather than sample data: without it a
 * payment cannot be recorded at all, so it is created by the migration that
 * creates the ledger. Every other table must be empty on a fresh database.
 *
 * @type {Readonly<Record<string, number>>}
 */
const STRUCTURAL_ROWS = Object.freeze({ LedgerAccount: 10 })

/** Sentinel used to roll a probe's transaction back once it has proved its point. */
const ROLLBACK = Symbol('rollback')

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
 * Run a command, streaming its output, and resolve with its exit code.
 *
 * @param {string} command The executable.
 * @param {string[]} args Its arguments.
 * @param {object} options Spawn options; `env` is merged over the current environment.
 * @returns {Promise<{code: number, output: string}>} Exit code and combined output.
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
      process.stdout.write(chunk)
    })
    child.stderr.on('data', (chunk) => {
      output += chunk
      process.stderr.write(chunk)
    })

    child.on('error', reject)
    child.on('close', (code) => resolve({ code: code ?? 1, output }))
  })
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
 * Drop the disposable database, disconnecting anything still attached to it.
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
 * Every table in the public schema, excluding Prisma's own bookkeeping.
 *
 * @param {object} prisma A client connected to the disposable database.
 * @returns {Promise<string[]>} Table names, alphabetically.
 */
async function applicationTables(prisma) {
  const rows = await prisma.$queryRawUnsafe(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' " +
      "AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations' ORDER BY table_name",
  )

  return rows.map((row) => row.table_name)
}

/**
 * Count every row in every application table.
 *
 * @param {object} prisma A client connected to the disposable database.
 * @param {string[]} tables Tables to count.
 * @returns {Promise<Record<string, number>>} Table name to row count.
 */
async function countRows(prisma, tables) {
  /** @type {Record<string, number>} */
  const counts = {}

  for (const table of tables) {
    const [row] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "${table}"`)
    counts[table] = row.n
  }

  return counts
}

/**
 * Run one constraint probe in its own transaction, which is always rolled back.
 *
 * A rejected statement poisons the transaction it ran in, so each probe gets
 * its own. Nothing a probe writes survives, whether it was accepted or not.
 *
 * @param {object} prisma A client connected to the disposable database.
 * @param {string} name What the probe proves.
 * @param {RegExp|null} expected Pattern the rejection must match, or `null` when the write must succeed.
 * @param {Function} write Receives a transaction client and performs the write.
 * @returns {Promise<boolean>} Whether the database behaved as required.
 */
async function probe(prisma, name, expected, write) {
  try {
    await prisma.$transaction(async (tx) => {
      await write(tx)
      throw ROLLBACK
    })
  } catch (error) {
    if (error === ROLLBACK) {
      return record(name, expected === null, {
        note: expected === null ? 'accepted, then rolled back' : 'the write was accepted',
      })
    }

    const detail = `${error?.code ?? ''} ${error?.message ?? error}`.replace(/\s+/g, ' ').trim()
    const matched = expected !== null && expected.test(detail)

    return record(name, matched, { note: matched ? 'rejected' : detail.slice(0, 160) })
  }

  return record(name, false, { note: 'the transaction committed, which it must not' })
}

/**
 * Probe every invariant the database is expected to hold on its own.
 *
 * @param {object} prisma A client connected to the seeded disposable database.
 * @returns {Promise<boolean>} Whether every probe passed.
 */
async function probeConstraints(prisma) {
  const [ticketType, user, order, payment, ticket, organization, webhookProvider] =
    await Promise.all([
      prisma.ticketType.findFirst(),
      prisma.user.findFirst(),
      prisma.order.findFirst(),
      prisma.payment.findFirst({ where: { providerRef: { not: null } } }),
      prisma.ticket.findFirst(),
      prisma.organization.findFirst(),
      prisma.webhookEvent.findFirst(),
    ])

  if (!ticketType || !user || !order || !payment || !ticket || !organization) {
    return record('constraint probes have the seeded rows they need', false, {
      note: 'the seed did not produce a ticket type, user, order, payment and ticket',
    })
  }

  const hold = {
    ticketTypeId: ticketType.id,
    quantity: 1,
    expiresAt: new Date(Date.now() + 60_000),
  }
  const duplicateKey = /P2002|duplicate key|unique constraint/i

  const results = []

  // The invariant the release-authorisation model rests on: a hold is owned by
  // exactly one of a signed-in user or a guest token digest, never both and
  // never neither. Application code cannot be trusted with this on its own.
  results.push(
    await probe(prisma, 'a hold may not have two owners', /ticket_hold_single_owner/, (tx) =>
      tx.ticketHold.create({
        data: { ...hold, userId: user.id, guestTokenHash: 'a'.repeat(64) },
      }),
    ),
  )
  results.push(
    await probe(prisma, 'a hold may not be ownerless', /ticket_hold_single_owner/, (tx) =>
      tx.ticketHold.create({ data: hold }),
    ),
  )
  results.push(
    await probe(prisma, 'a hold with exactly one owner is accepted', null, (tx) =>
      tx.ticketHold.create({ data: { ...hold, guestTokenHash: 'b'.repeat(64) } }),
    ),
  )

  // A flat discount is denominated. ₹500 is not CA$500.
  results.push(
    await probe(
      prisma,
      'a fixed-amount promo code may not be currency-less',
      /promo_code_fixed_amount_currency/,
      (tx) =>
        tx.promoCode.create({
          data: {
            organizationId: organization.id,
            code: `FRESHCHECK${Date.now()}`,
            type: 'FIXED_AMOUNT',
            value: 50_000,
            currency: null,
          },
        }),
    ),
  )

  // Retried checkouts must not become second orders or second charges.
  results.push(
    await probe(prisma, 'an order idempotency key is unique', duplicateKey, async (tx) => {
      const key = `fresh-check-${Date.now()}`
      const base = {
        eventId: order.eventId,
        buyerEmail: 'fresh-check@example.com',
        buyerName: 'Fresh Check',
        subtotalCents: 1000,
        totalCents: 1000,
      }

      await tx.order.create({
        data: { ...base, reference: `FRESH-A-${Date.now()}`, idempotencyKey: key },
      })
      await tx.order.create({
        data: { ...base, reference: `FRESH-B-${Date.now()}`, idempotencyKey: key },
      })
    }),
  )
  results.push(
    await probe(prisma, 'a payment idempotency key is unique', duplicateKey, async (tx) => {
      const key = `fresh-check-payment-${Date.now()}`
      const base = { orderId: order.id, provider: 'freshcheck', amountCents: 1000 }

      await tx.payment.create({
        data: { ...base, providerRef: `a-${Date.now()}`, idempotencyKey: key },
      })
      await tx.payment.create({
        data: { ...base, providerRef: `b-${Date.now()}`, idempotencyKey: key },
      })
    }),
  )

  // The external identifiers this system takes from a payment provider: one
  // charge reference, and one webhook delivery, can each be recorded once.
  results.push(
    await probe(prisma, 'a provider charge reference is recorded once', duplicateKey, (tx) =>
      tx.payment.create({
        data: {
          orderId: order.id,
          provider: payment.provider,
          providerRef: payment.providerRef,
          amountCents: payment.amountCents,
        },
      }),
    ),
  )
  results.push(
    await probe(
      prisma,
      'a provider webhook delivery is recorded once',
      duplicateKey,
      async (tx) => {
        const identity = webhookProvider
          ? { provider: webhookProvider.provider, providerEventId: webhookProvider.providerEventId }
          : { provider: 'freshcheck', providerEventId: `evt-${Date.now()}` }
        const data = { ...identity, eventType: 'payment.succeeded', payload: {} }

        if (!webhookProvider) await tx.webhookEvent.create({ data })
        await tx.webhookEvent.create({ data })
      },
    ),
  )

  // Phase 1 sells general admission, so the issued-once unit is the pass
  // rather than a numbered seat.
  results.push(
    await probe(prisma, 'a ticket code is issued once', duplicateKey, (tx) =>
      tx.ticket.create({ data: { orderItemId: ticket.orderItemId, code: ticket.code } }),
    ),
  )

  return results.every(Boolean)
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
  console.log('Fresh-database verification')
  console.log(`  target: ${redacted(target)}`)
  console.log('  credentials are never printed; only the disposable database name is.\n')

  let created = false
  let prisma = null
  let ok = true

  try {
    await createDatabase(template, name)
    created = true
    record('a disposable database was created', true, { note: name })

    const childEnv = { DATABASE_URL: target, TEST_DATABASE_URL: target }

    const deploy = await run('npx', ['prisma', 'migrate', 'deploy'], { env: childEnv })
    const expectedMigrations = readdirSync(path.join(PACKAGE_ROOT, 'prisma', 'migrations'), {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()

    ok =
      record('every migration applied from zero', deploy.code === 0, {
        migrations: expectedMigrations.length,
        note: `${expectedMigrations.length} migrations`,
      }) && ok

    const status = await run('npx', ['prisma', 'migrate', 'status'], { env: childEnv })
    ok = record('migrate status reports the schema up to date', status.code === 0) && ok

    prisma = createPrismaClient({ connectionString: target })

    const applied = await prisma.$queryRawUnsafe(
      'SELECT migration_name, rolled_back_at, finished_at FROM _prisma_migrations ORDER BY started_at',
    )
    ok =
      record(
        'the applied migrations are exactly the ones in the repository',
        applied.length === expectedMigrations.length &&
          applied.every((row, index) => row.migration_name === expectedMigrations[index]),
        { applied: applied.map((row) => row.migration_name) },
      ) && ok
    ok =
      record(
        'no migration was rolled back or left unfinished',
        applied.every((row) => row.rolled_back_at === null && row.finished_at !== null),
      ) && ok

    const tables = await applicationTables(prisma)
    const empty = await countRows(prisma, tables)

    // Structural rows, created by a migration rather than by the seed, because
    // a payment cannot be recorded at all without a chart of accounts. Anything
    // else holding rows before the seed runs would be residue from an earlier
    // schema, which is what this check exists to catch.
    const residual = Object.entries(empty).filter(
      ([table, count]) => count > 0 && !(table in STRUCTURAL_ROWS),
    )
    const structuralWrong = Object.entries(STRUCTURAL_ROWS).filter(
      ([table, expected]) => empty[table] !== expected,
    )

    ok =
      record(
        'the database carries no rows beyond the structure a migration creates',
        residual.length === 0 && structuralWrong.length === 0,
        {
          tables: tables.length,
          note: `${tables.length} tables; only ${Object.keys(STRUCTURAL_ROWS).join(', ')} populated`,
          residual,
          structuralWrong,
        },
      ) && ok

    // Columns and tables that did not exist before the corrective cycle. Their
    // presence is what makes "this is the current schema" a statement rather
    // than an assumption.
    const post = await prisma.$queryRawUnsafe(
      "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public' " +
        "AND ((table_name = 'TicketHold' AND column_name IN ('guestTokenHash', 'userId', 'releasedAt')) " +
        "OR (table_name = 'Order' AND column_name IN ('idempotencyKey', 'pricingSnapshot')) " +
        "OR (table_name = 'Payment' AND column_name IN ('idempotencyKey', 'attemptNumber', 'reconciliationRequired')) " +
        "OR (table_name = 'PromoCode' AND column_name = 'currency') " +
        "OR (table_name = 'WebhookEvent' AND column_name = 'providerEventId'))",
    )
    ok =
      record('the schema is the current one, not a pre-corrective snapshot', post.length === 10, {
        found: post.length,
        note: `${post.length} of 10 post-review columns present`,
      }) && ok

    const firstSeed = await run('node', ['scripts/seed.mjs'], { env: childEnv })
    ok = record('the seed runs on an empty database', firstSeed.code === 0) && ok
    const afterFirst = await countRows(prisma, tables)

    const secondSeed = await run('node', ['scripts/seed.mjs'], { env: childEnv })
    ok = record('the seed runs a second time', secondSeed.code === 0) && ok
    const afterSecond = await countRows(prisma, tables)

    const drifted = tables.filter((table) => afterFirst[table] !== afterSecond[table])
    ok =
      record('seeding twice leaves exactly the rows seeding once did', drifted.length === 0, {
        rows: Object.values(afterFirst).reduce((total, count) => total + count, 0),
        counts: afterFirst,
        drifted: drifted.map((table) => ({
          table,
          once: afterFirst[table],
          twice: afterSecond[table],
        })),
        note: `${Object.values(afterFirst).reduce((total, count) => total + count, 0)} rows`,
      }) && ok

    ok = (await probeConstraints(prisma)) && ok

    await prisma.$disconnect()
    prisma = null

    const dbSuite = await run('npx', ['vitest', 'run'], { env: childEnv })
    ok = record('the @desi-event/db integration suite passes against it', dbSuite.code === 0) && ok

    const apiSuite = await run('npx', ['vitest', 'run', 'tests/facets-integration.test.js'], {
      cwd: path.join(REPO_ROOT, 'apps', 'api'),
      env: childEnv,
    })
    ok = record('the API database integration suite passes against it', apiSuite.code === 0) && ok
  } catch (error) {
    ok = record('the verification ran to completion', false, {
      note: String(error?.message ?? error).slice(0, 300),
    })
  } finally {
    if (prisma) await prisma.$disconnect().catch(() => {})

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
