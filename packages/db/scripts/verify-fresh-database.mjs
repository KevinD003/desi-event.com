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
import { runPhase2Probes } from './phase2-probes.mjs'
import { runSeatConcurrencyProbes } from './seat-concurrency.mjs'

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

  // ---------------------------------------------------------------------------
  // Personal data: the invariants an irreversible redaction rests on.
  //
  // Each of these is a statement the application must not be trusted with,
  // because getting it wrong destroys something that cannot be restored or
  // rewrites the record of having destroyed it.
  // ---------------------------------------------------------------------------

  const request = {
    organizationId: organization.id,
    subjectUserId: user.id,
    requestedById: user.id,
    reason: 'SUBJECT_REQUEST',
    confirmationHash: 'a'.repeat(64),
    confirmationExpiresAt: new Date(Date.now() + 120_000),
    policyVersion: 'probe',
    correlationId: `probe-${Date.now()}`,
  }

  // The floor under the whole workstream. A request that reached execution
  // without a hold evaluation would be a redaction performed without asking
  // whether it was allowed.
  results.push(
    await probe(
      prisma,
      'a redaction may not be queued before its holds are evaluated',
      /privacy_request_executes_only_when_clear/,
      (tx) =>
        tx.privacyRequest.create({
          data: {
            ...request,
            idempotencyKey: `probe-unclear-${Date.now()}`,
            state: 'QUEUED',
            confirmedAt: new Date(),
          },
        }),
    ),
  )

  // Two operators confirming the same screen would otherwise start two
  // redactions of one person, and the second would find placeholders where it
  // expected values.
  results.push(
    await probe(
      prisma,
      'one subject has at most one redaction in flight',
      duplicateKey,
      async (tx) => {
        await tx.privacyRequest.create({
          data: { ...request, idempotencyKey: `probe-first-${Date.now()}` },
        })
        await tx.privacyRequest.create({
          data: { ...request, idempotencyKey: `probe-second-${Date.now()}` },
        })
      },
    ),
  )

  results.push(
    await probe(
      prisma,
      'a terminal redaction request must say what happened',
      /privacy_request_terminal_has_outcome/,
      async (tx) => {
        const created = await tx.privacyRequest.create({
          data: { ...request, idempotencyKey: `probe-outcome-${Date.now()}` },
        })

        await tx.privacyRequest.update({
          where: { id: created.id },
          data: { state: 'CANCELLED', cancelledAt: new Date() },
        })
      },
    ),
  )

  results.push(
    await probe(
      prisma,
      'a redaction request cannot skip from requested to processing',
      /cannot move from REQUESTED to PROCESSING/,
      async (tx) => {
        const created = await tx.privacyRequest.create({
          data: { ...request, idempotencyKey: `probe-skip-${Date.now()}` },
        })

        await tx.privacyRequest.update({
          where: { id: created.id },
          data: { state: 'PROCESSING', startedAt: new Date() },
        })
      },
    ),
  )

  // An audit trail assembled by correlation id has to describe the request that
  // actually ran, so what a request is about is fixed once the row exists.
  results.push(
    await probe(
      prisma,
      'a redaction request cannot change which person it is about',
      /cannot change what it is about/,
      async (tx) => {
        const created = await tx.privacyRequest.create({
          data: { ...request, idempotencyKey: `probe-identity-${Date.now()}` },
        })

        await tx.privacyRequest.update({
          where: { id: created.id },
          data: { policyVersion: 'rewritten' },
        })
      },
    ),
  )

  // Phase 2 makes "withdrawn before execution" a promise the service keeps. This
  // is the half the database keeps: once a personal field may already have been
  // replaced, CANCELLED would claim nothing happened.
  results.push(
    await probe(
      prisma,
      'a redaction already in progress cannot be withdrawn',
      /already processing/,
      async (tx) => {
        const created = await tx.privacyRequest.create({
          data: {
            ...request,
            idempotencyKey: `probe-cancel-${Date.now()}`,
            state: 'REQUESTED',
            holdDecision: 'NONE_ACTIVE',
          },
        })

        const confirmed = new Date()

        await tx.privacyRequest.update({
          where: { id: created.id },
          data: { state: 'QUEUED', confirmedAt: confirmed },
        })

        await tx.privacyRequest.update({
          where: { id: created.id },
          data: { state: 'PROCESSING', startedAt: confirmed },
        })

        await tx.privacyRequest.update({
          where: { id: created.id },
          data: { state: 'CANCELLED', cancelledAt: new Date(), outcomeCode: 'WITHDRAWN' },
        })
      },
    ),
  )

  // A hold that says it is released without saying who released it is a hold
  // nobody can be asked about.
  results.push(
    await probe(prisma, 'a released hold must name who lifted it', /privacy_hold_release/, (tx) =>
      tx.privacyHold.create({
        data: {
          organizationId: organization.id,
          subjectUserId: user.id,
          kind: 'LEGAL',
          state: 'RELEASED',
          matterReference: `probe-${Date.now()}`,
          placedById: user.id,
        },
      }),
    ),
  )

  // The redaction engine derives `User.email` placeholders from the row id, so
  // two subjects can never collide. This proves the constraint that would catch
  // it if a future derivation stopped being row-scoped.
  results.push(
    await probe(
      prisma,
      'two accounts cannot end up at the same redacted address',
      /User_email_key|Unique constraint/,
      async (tx) => {
        const shared = `redacted-collision-${Date.now()}@redacted.invalid`

        await tx.user.create({
          data: {
            email: shared,
            passwordHash: 'x'.repeat(60),
            displayName: 'Redacted person one',
          },
        })

        await tx.user.create({
          data: {
            email: shared,
            passwordHash: 'x'.repeat(60),
            displayName: 'Redacted person two',
          },
        })
      },
    ),
  )

  const auditEvent = {
    action: 'privacy.request_raised',
    organizationId: organization.id,
    targetId: user.id,
    targetType: 'User',
    policyVersion: 'probe',
    reasonCode: 'SUBJECT_REQUEST',
    holdDecision: 'NOT_EVALUATED',
    result: 'REQUESTED',
    correlationId: `probe-${Date.now()}`,
  }

  results.push(
    await probe(
      prisma,
      'privacy audit evidence cannot be edited',
      /privacy audit events are append-only/,
      async (tx) => {
        const created = await tx.privacyAuditEvent.create({ data: auditEvent })

        await tx.privacyAuditEvent.update({
          where: { id: created.id },
          data: { action: 'privacy.nothing_happened' },
        })
      },
    ),
  )
  results.push(
    await probe(
      prisma,
      'privacy audit evidence cannot be deleted',
      /privacy audit events are append-only/,
      async (tx) => {
        const created = await tx.privacyAuditEvent.create({ data: auditEvent })

        await tx.privacyAuditEvent.delete({ where: { id: created.id } })
      },
    ),
  )

  // Until Phase 3 this was convention: `docs/DATA_MODEL.md` said audit rows
  // could not be pruned selectively and nothing enforced it.
  results.push(
    await probe(
      prisma,
      'an audit row cannot be edited',
      /audit rows are append-only/,
      async (tx) => {
        const created = await tx.auditLog.create({
          data: { action: 'probe.written', entityType: 'User', entityId: user.id },
        })

        await tx.auditLog.update({ where: { id: created.id }, data: { action: 'probe.rewritten' } })
      },
    ),
  )
  results.push(
    await probe(
      prisma,
      'an audit row cannot be deleted',
      /audit rows are append-only/,
      async (tx) => {
        const created = await tx.auditLog.create({
          data: { action: 'probe.written', entityType: 'User', entityId: user.id },
        })

        await tx.auditLog.delete({ where: { id: created.id } })
      },
    ),
  )

  // The consequence of audit immutability, stated as a probe rather than left
  // to be discovered: a person who has acted cannot be deleted, because the
  // actor foreign key's ON DELETE SET NULL is an UPDATE of their audit rows.
  // Erasure in this system is redaction; the row survives it.
  results.push(
    await probe(
      prisma,
      'a person who has acted cannot be deleted, only redacted',
      /audit rows are append-only/,
      async (tx) => {
        const actor = await tx.user.create({
          data: {
            email: `probe-delete-${Date.now()}@example.test`,
            passwordHash: 'x',
            displayName: 'Probe',
          },
        })

        await tx.auditLog.create({
          data: {
            actorId: actor.id,
            action: 'probe.acted',
            entityType: 'User',
            entityId: actor.id,
          },
        })
        await tx.user.delete({ where: { id: actor.id } })
      },
    ),
  )

  // A rehearsal that reports changes is not a rehearsal.
  results.push(
    await probe(
      prisma,
      'a dry-run retention sweep cannot report having changed anything',
      /retention_sweep_dry_run_changes_nothing/,
      (tx) =>
        tx.retentionSweep.create({
          data: {
            retentionClass: 'login_attempt',
            mode: 'DRY_RUN',
            olderThan: new Date(),
            examinedCount: 10,
            affectedCount: 5,
          },
        }),
    ),
  )

  // A sweep cannot claim it reached more than it looked at. Unlike the probe
  // above this one is not about DRY_RUN — it holds for an EXECUTE row too, and
  // nothing in this repository writes one. It is checked precisely because
  // nothing does: the day something adds an execute path, this is the
  // constraint standing between a bug and a deletion count nobody can explain.
  results.push(
    await probe(
      prisma,
      'a retention sweep cannot affect more rows than it examined',
      /retention_sweep_affected_within_examined/,
      (tx) =>
        tx.retentionSweep.create({
          data: {
            retentionClass: 'login_attempt',
            mode: 'EXECUTE',
            olderThan: new Date(),
            examinedCount: 1,
            affectedCount: 2,
          },
        }),
    ),
  )

  // No negative counts. A count is a count of rows, and a negative one is a
  // bug that would otherwise be stored and later rendered to an operator as a
  // figure they would have to decide how to interpret.
  //
  // It is `heldCount` that is negative here, and that choice is the point. The
  // obvious probe sets `examinedCount: -1`, which trips
  // `retention_sweep_affected_within_examined` instead — `affectedCount: 0` is
  // not `<= -1` — and PostgreSQL reports whichever constraint it evaluates
  // first. The probe would have passed while naming a constraint it never
  // reached. `heldCount` appears in the non-negative check and in no other, so
  // this row can only fail the one it claims to be about.
  results.push(
    await probe(
      prisma,
      'a retention sweep cannot record a negative count',
      /retention_sweep_counts_non_negative/,
      (tx) =>
        tx.retentionSweep.create({
          data: {
            retentionClass: 'login_attempt',
            mode: 'DRY_RUN',
            olderThan: new Date(),
            examinedCount: 0,
            affectedCount: 0,
            heldCount: -1,
          },
        }),
    ),
  )

  // Half a lease. Nothing writes `leaseOwner` or `leaseExpiresAt` — the
  // retention rehearsal deliberately has no lease, because it counts and then
  // inserts an already-finished row, so there is no window for a second worker
  // to steal. This is the constraint that would catch a future lease written
  // badly: an owner with no expiry is a claim nobody can ever time out.
  results.push(
    await probe(
      prisma,
      'a retention sweep lease cannot have an owner without an expiry',
      /retention_sweep_lease_has_owner/,
      (tx) =>
        tx.retentionSweep.create({
          data: {
            retentionClass: 'login_attempt',
            mode: 'DRY_RUN',
            state: 'CLAIMED',
            olderThan: new Date(),
            leaseOwner: 'worker-probe',
          },
        }),
    ),
  )

  // A hold with no reference to the matter outside this system blocks a
  // person's redaction indefinitely and gives nobody a way to resolve it.
  results.push(
    await probe(
      prisma,
      'a privacy hold must name the matter holding the data',
      /privacy_hold_names_its_matter/,
      (tx) =>
        tx.privacyHold.create({
          data: {
            organizationId: organization.id,
            subjectUserId: user.id,
            kind: 'LEGAL',
            matterReference: '   ',
            placedById: user.id,
          },
        }),
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

    // The Phase 2 invariants: cross-table triggers, the frozen seat map, and
    // the ledger's balance-at-posting and posted-immutability guarantees. These
    // probes commit a posted ledger batch, so they run after the seed
    // comparison above — nothing downstream counts rows.
    ok = (await runPhase2Probes(prisma, { probe, record })) && ok

    // Concurrency, against real transactions rather than a stub that agrees with
    // whoever wrote it. These commit, so they run last among the probes and
    // before the row comparison is done with.
    ok = (await runSeatConcurrencyProbes(prisma, { record })) && ok

    await prisma.$disconnect()
    prisma = null

    const dbSuite = await run('npx', ['vitest', 'run'], { env: childEnv })
    ok = record('the @desi-event/db integration suite passes against it', dbSuite.code === 0) && ok

    // REQUIRE_DATABASE turns an unreachable database from a skip into a
    // failure. Without it, a suite that could not connect reports zero tests,
    // and zero failing tests reads exactly like success.
    const apiSuite = await run(
      'npx',
      [
        'vitest',
        'run',
        'tests/facets-integration.test.js',
        'tests/ledger-integration.test.js',
        'tests/reserved-seat-concurrency.test.js',
        'tests/refund-concurrency.test.js',
        'tests/ticket-concurrency.test.js',
        'tests/privacy-redaction-integration.test.js',
        'tests/privacy-lifecycle-integration.test.js',
        'tests/payout-currency-trigger.test.js',
        // The door, the operator's outbox actions, and the seat-transfer block:
        // each depends on a lock, a trigger or a constraint only a real, freshly
        // migrated database has.
        'tests/admission-integration.test.js',
        'tests/notification-lease-integration.test.js',
        'tests/seat-transfer-block-integration.test.js',
      ],
      {
        cwd: path.join(REPO_ROOT, 'apps', 'api'),
        env: { ...childEnv, REQUIRE_DATABASE: '1' },
      },
    )
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
