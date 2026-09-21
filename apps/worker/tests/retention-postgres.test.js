/**
 * The rehearsal against real PostgreSQL: it counts, and it changes nothing.
 *
 * ## Why this cannot be proved against a fake
 *
 * Two of the three claims this suite makes are claims about the *database*, not
 * about the code:
 *
 *   - **The primary key is what deduplicates a redelivery.** The unit test
 *     proves the processor's half by counting attempts against an in-memory
 *     unique-index emulation. Whether PostgreSQL actually raises `P2002` for a
 *     supplied `cuid()` id — that is, whether a Prisma default really does
 *     defer to a provided value — is a property of Prisma and PostgreSQL, and a
 *     fake that emulated it would be proving the emulation.
 *   - **`retention_sweep_dry_run_changes_nothing` refuses a dishonest row.**
 *     That constraint is the one guarantee in the whole retention surface that
 *     does not depend on this code being correct, which makes it the one most
 *     worth checking against the thing that enforces it.
 *
 * The third is the claim the surface exists to make: after a rehearsal, every
 * swept table is byte-for-byte what it was.
 *
 * ## Why the digests are scoped rather than table-wide
 *
 * A digest over all of `Session` would be a digest over whatever every other
 * suite in this repository happens to be doing at that moment — nineteen
 * Turborepo tasks share one database. It would fail for reasons that have
 * nothing to do with retention, and the person who hit it would rightly stop
 * trusting it.
 *
 * So every row this suite creates is tagged, and every digest is taken over the
 * tagged rows only. That is a weaker statement than "the sweep changed nothing
 * anywhere", and it is the strongest one that can be made honestly here. The
 * *unconditional* version — that no delete path exists at all — is asserted
 * where it can be: by the source, by the stub whose mutators throw, and by the
 * constraint below.
 *
 * @module worker/tests/retention-postgres.test
 */

import { createHash, randomUUID } from 'node:crypto'

import { afterAll, beforeAll, expect, it, vi } from 'vitest'

import { createRetentionSweepProcessor } from '../src/processors/sweep-retention.js'
import { RETENTION_CLASSES } from '../src/retention/classes.js'
import { SWEEP_ROW_KINDS, sweepRowId } from '../src/retention/run-key.js'
import { connectTestDatabase } from './helpers/database.js'

/** Marks every row this suite creates, so nothing else is ever touched. */
const TAG = `ret${randomUUID().slice(0, 8)}`

/** A fixed instant, so cut-offs and ids are predictable. */
const NOW = new Date('2026-09-18T00:00:00.000Z')

/** Comfortably older than every proposed duration. */
const LONG_AGO = new Date('2020-01-01T00:00:00.000Z')

const { prisma, when } = await connectTestDatabase('the retention PostgreSQL suite')

/**
 * A digest over the rows this suite created, and nothing else.
 *
 * @returns {Promise<string>} A hash of the tagged login attempts.
 */
async function taggedDigest() {
  const rows = await prisma.loginAttempt.findMany({
    where: { emailHash: { startsWith: TAG } },
    orderBy: { id: 'asc' },
  })

  return createHash('sha256').update(JSON.stringify(rows)).digest('hex')
}

/**
 * The processor, wired to the real database.
 *
 * @param {boolean} activated Whether enforcement is activated.
 * @returns {function(object): Promise<object>} The processor.
 */
function processor(activated) {
  return createRetentionSweepProcessor({
    prisma,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    activated,
    clock: () => NOW,
  })
}

when()('the retention rehearsal against real PostgreSQL', () => {
  beforeAll(async () => {
    // Three login attempts old enough for every proposal to reach.
    await prisma.loginAttempt.createMany({
      data: [1, 2, 3].map((n) => ({
        emailHash: `${TAG}-email-${n}`,
        ipHash: `${TAG}-ip-${n}`,
        succeeded: false,
        outcome: 'BAD_PASSWORD',
        createdAt: LONG_AGO,
      })),
    })
  })

  afterAll(async () => {
    // Only this suite's rows, by tag. The sweep rows are removed by id, which
    // is possible precisely because the ids are derived rather than generated —
    // the cleanup can name them without reading the table first.
    await prisma.loginAttempt.deleteMany({ where: { emailHash: { startsWith: TAG } } })
    await prisma.retentionSweep.deleteMany({
      where: {
        id: {
          in: RETENTION_CLASSES.flatMap((definition) =>
            Object.values(SWEEP_ROW_KINDS).map((kind) =>
              sweepRowId({ runInstant: NOW, retentionClass: definition.retentionClass, kind }),
            ),
          ),
        },
      },
    })
    await prisma.$disconnect()
  })

  it('counts the rows that are actually there', async () => {
    const result = await processor(true)({
      data: { now: NOW.toISOString(), retentionClass: 'login_attempt' },
    })

    expect(result.swept).toBe(1)

    const row = await prisma.retentionSweep.findUnique({
      where: {
        id: sweepRowId({
          runInstant: NOW,
          retentionClass: 'login_attempt',
          kind: SWEEP_ROW_KINDS.RESULT,
        }),
      },
    })

    expect(row.state).toBe('COMPLETED')
    expect(row.mode).toBe('DRY_RUN')
    expect(row.affectedCount).toBe(0)
    // At least this suite's three. Other suites' login attempts may also be old
    // enough, which is why this is a floor rather than an equality — an
    // equality here would be a test of what else is running.
    expect(row.examinedCount).toBeGreaterThanOrEqual(3)
  })

  it('leaves every row it counted exactly as it found it', async () => {
    const before = await taggedDigest()

    await processor(true)({ data: { now: NOW.toISOString() } })

    expect(await taggedDigest()).toBe(before)
    expect(await prisma.loginAttempt.count({ where: { emailHash: { startsWith: TAG } } })).toBe(3)
  })

  it('writes one row per class, and a redelivery adds none', async () => {
    // The claim the unit test can only make about the processor: here the
    // primary key is a real one, and the `P2002` is PostgreSQL's.
    const ids = RETENTION_CLASSES.map((definition) =>
      sweepRowId({
        runInstant: NOW,
        retentionClass: definition.retentionClass,
        kind: SWEEP_ROW_KINDS.RESULT,
      }),
    )

    await processor(true)({ data: { now: NOW.toISOString() } })

    const first = await prisma.retentionSweep.count({ where: { id: { in: ids } } })

    expect(first).toBe(RETENTION_CLASSES.length)

    const again = await processor(true)({ data: { now: NOW.toISOString() } })

    expect(again.deduplicated).toBe(RETENTION_CLASSES.length)
    expect(await prisma.retentionSweep.count({ where: { id: { in: ids } } })).toBe(first)
  })

  it('refuses a dry run that claims it changed something', async () => {
    // `retention_sweep_dry_run_changes_nothing`. The one guarantee here that
    // does not depend on any of this code being correct, checked against the
    // thing that actually enforces it.
    await expect(
      prisma.retentionSweep.create({
        data: {
          id: `r${createHash('sha256').update(`${TAG}-dishonest`).digest('hex').slice(0, 31)}`,
          retentionClass: 'login_attempt',
          mode: 'DRY_RUN',
          state: 'COMPLETED',
          olderThan: LONG_AGO,
          examinedCount: 5,
          affectedCount: 5,
          heldCount: 0,
        },
      }),
    ).rejects.toThrow(/retention_sweep_dry_run_changes_nothing/u)
  })

  it('refuses a sweep claiming it affected more than it examined', async () => {
    await expect(
      prisma.retentionSweep.create({
        data: {
          id: `r${createHash('sha256').update(`${TAG}-overreach`).digest('hex').slice(0, 31)}`,
          retentionClass: 'login_attempt',
          // Not DRY_RUN, so the constraint above does not fire and this one has
          // to. Nothing in this repository writes an EXECUTE row; the
          // constraint is being checked, not the code.
          mode: 'EXECUTE',
          state: 'COMPLETED',
          olderThan: LONG_AGO,
          examinedCount: 1,
          affectedCount: 2,
          heldCount: 0,
        },
      }),
    ).rejects.toThrow(/retention_sweep_affected_within_examined/u)
  })

  it('refuses half a lease, which is what keeps the unwritten columns honest', async () => {
    // Nothing writes these columns — see the schema's doc comment and the
    // processor's header for why there is no lease. This asserts the constraint
    // that would catch it if something ever wrote one badly.
    await expect(
      prisma.retentionSweep.create({
        data: {
          id: `r${createHash('sha256').update(`${TAG}-halflease`).digest('hex').slice(0, 31)}`,
          retentionClass: 'login_attempt',
          mode: 'DRY_RUN',
          state: 'CLAIMED',
          olderThan: LONG_AGO,
          leaseOwner: 'worker-1',
          leaseExpiresAt: null,
        },
      }),
    ).rejects.toThrow(/retention_sweep_lease_has_owner/u)
  })

  it('stores a failure with a code from the vocabulary and no driver message', async () => {
    const id = `r${createHash('sha256').update(`${TAG}-failed`).digest('hex').slice(0, 31)}`

    await prisma.retentionSweep.create({
      data: {
        id,
        retentionClass: 'login_attempt',
        mode: 'DRY_RUN',
        state: 'FAILED',
        olderThan: LONG_AGO,
        examinedCount: 0,
        affectedCount: 0,
        heldCount: 0,
        failureCode: 'CANDIDATE_COUNT_FAILED',
      },
    })

    const stored = await prisma.retentionSweep.findUnique({ where: { id } })

    expect(stored.failureCode).toBe('CANDIDATE_COUNT_FAILED')

    await prisma.retentionSweep.delete({ where: { id } })
  })
})
