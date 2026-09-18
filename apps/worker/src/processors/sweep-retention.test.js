/**
 * The rehearsal must count, record, and never delete — including when told to.
 *
 * @module worker/processors/sweep-retention.test
 */

import { describe, expect, it, vi } from 'vitest'

import { RETENTION_CLASSES, cutOffFor } from '../retention/classes.js'
import { createRetentionSweepProcessor } from './sweep-retention.js'

/** A fixed instant, so cut-offs are checkable. */
const NOW = new Date('2026-09-18T00:00:00.000Z')

/**
 * A Prisma stand-in that counts, records sweeps, and throws on any mutation of
 * a swept table.
 *
 * `retentionSweep.create` is allowed — that is the evidence the job exists to
 * write. Everything that could touch a person's rows throws.
 *
 * @param {number} [count] What every count returns.
 * @returns {object} The stub, carrying the rows it was asked to create.
 */
function sweepingPrisma(count = 4) {
  const created = []
  const forbid = (name) => () => {
    throw new Error(`a retention rehearsal must not call ${name}`)
  }

  const swept = () => ({
    count: vi.fn(async () => count),
    delete: forbid('delete'),
    deleteMany: forbid('deleteMany'),
    update: forbid('update'),
    updateMany: forbid('updateMany'),
  })

  return {
    created,
    loginAttempt: swept(),
    session: swept(),
    notificationOutbox: swept(),
    privacyHold: swept(),
    retentionSweep: {
      create: vi.fn(async ({ data }) => {
        created.push(data)
        return { id: `sweep-${created.length}`, ...data }
      }),
    },
    $executeRaw: forbid('$executeRaw'),
    $executeRawUnsafe: forbid('$executeRawUnsafe'),
  }
}

/** A logger that records rather than prints. */
function recordingLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

describe('when retention enforcement is not activated', () => {
  it('records SKIPPED_DISABLED rather than doing nothing silently', async () => {
    // "Nothing happened" and "we were told not to" are different answers, and
    // an operator who cannot tell them apart goes looking for a broken worker.
    const prisma = sweepingPrisma()
    const process = createRetentionSweepProcessor({
      prisma,
      logger: recordingLogger(),
      activated: false,
      clock: () => NOW,
    })

    const result = await process({ data: {} })

    expect(result.activated).toBe(false)
    expect(prisma.created).toHaveLength(RETENTION_CLASSES.length)
    for (const row of prisma.created) {
      expect(row.state).toBe('SKIPPED_DISABLED')
      expect(row.mode).toBe('DRY_RUN')
      expect(row.affectedCount).toBe(0)
    }
  })

  it('examines nothing at all', async () => {
    const prisma = sweepingPrisma()

    await createRetentionSweepProcessor({
      prisma,
      logger: recordingLogger(),
      activated: false,
      clock: () => NOW,
    })({ data: {} })

    expect(prisma.loginAttempt.count).not.toHaveBeenCalled()
    expect(prisma.session.count).not.toHaveBeenCalled()
    expect(prisma.notificationOutbox.count).not.toHaveBeenCalled()
    for (const row of prisma.created) expect(row.examinedCount).toBe(0)
  })

  it('still records the cut-off it would have used', async () => {
    // So the refusal can be reasoned about later rather than being a blank.
    const prisma = sweepingPrisma()

    await createRetentionSweepProcessor({
      prisma,
      logger: recordingLogger(),
      activated: false,
      clock: () => NOW,
    })({ data: {} })

    const [first] = prisma.created

    expect(first.olderThan).toEqual(cutOffFor(RETENTION_CLASSES[0], NOW))
  })

  it('warns, so the reason is in the log as well as the database', async () => {
    const logger = recordingLogger()

    await createRetentionSweepProcessor({
      prisma: sweepingPrisma(),
      logger,
      activated: false,
      clock: () => NOW,
    })({ data: {} })

    expect(logger.warn).toHaveBeenCalled()
    expect(logger.warn.mock.calls[0][1]).toMatch(/not activated/iu)
  })
})

describe('when activated, it counts and records', () => {
  it('writes one completed sweep per class, all with affectedCount 0', async () => {
    const prisma = sweepingPrisma(9)

    const result = await createRetentionSweepProcessor({
      prisma,
      logger: recordingLogger(),
      activated: true,
      clock: () => NOW,
    })({ data: {} })

    expect(result.swept).toBe(RETENTION_CLASSES.length)
    expect(result.affectedCount).toBe(0)
    for (const row of prisma.created) {
      expect(row.state).toBe('COMPLETED')
      expect(row.mode).toBe('DRY_RUN')
      expect(row.affectedCount).toBe(0)
      expect(row.examinedCount).toBe(9)
    }
  })

  it('mutates nothing, proven by a client that throws on every write path', async () => {
    // Reaching the end at all is the assertion: the stub throws on delete,
    // deleteMany, update, updateMany and both raw-SQL escapes.
    const prisma = sweepingPrisma()

    await expect(
      createRetentionSweepProcessor({
        prisma,
        logger: recordingLogger(),
        activated: true,
        clock: () => NOW,
      })({ data: {} }),
    ).resolves.toBeDefined()
  })

  it('logs the approval status on every line', async () => {
    // A count that reaches an operator without PROPOSED attached is a count
    // somebody eventually mistakes for policy.
    const logger = recordingLogger()

    await createRetentionSweepProcessor({
      prisma: sweepingPrisma(),
      logger,
      activated: true,
      clock: () => NOW,
    })({ data: {} })

    for (const call of logger.info.mock.calls) {
      expect(call[0].approval).toMatch(/REQUIRES LEGAL\/PRIVACY REVIEW/u)
    }
  })

  it('says in the log that nothing was changed', async () => {
    const logger = recordingLogger()

    await createRetentionSweepProcessor({
      prisma: sweepingPrisma(),
      logger,
      activated: true,
      clock: () => NOW,
    })({ data: {} })

    expect(logger.info.mock.calls[0][1]).toMatch(/nothing was changed/iu)
  })
})

describe('narrowing to one class', () => {
  it('rehearses only the class named', async () => {
    const prisma = sweepingPrisma()

    await createRetentionSweepProcessor({
      prisma,
      logger: recordingLogger(),
      activated: true,
      clock: () => NOW,
    })({ data: { retentionClass: 'login_attempt' } })

    expect(prisma.created).toHaveLength(1)
    expect(prisma.created[0].retentionClass).toBe('login_attempt')
    expect(prisma.session.count).not.toHaveBeenCalled()
  })

  it('refuses a class it does not evaluate rather than silently sweeping all', async () => {
    // Quietly widening a narrowed request would report a full sweep as though
    // the narrowing had been honoured.
    const prisma = sweepingPrisma()

    await expect(
      createRetentionSweepProcessor({
        prisma,
        logger: recordingLogger(),
        activated: true,
        clock: () => NOW,
      })({ data: { retentionClass: 'export_artifact' } }),
    ).rejects.toThrow(/no retention class named export_artifact/u)

    expect(prisma.created).toHaveLength(0)
  })
})

describe('the clock', () => {
  it('honours an explicit instant from the payload', async () => {
    const prisma = sweepingPrisma()
    const stated = new Date('2026-01-01T00:00:00.000Z')

    await createRetentionSweepProcessor({
      prisma,
      logger: recordingLogger(),
      activated: true,
      clock: () => NOW,
    })({ data: { now: stated.toISOString(), retentionClass: 'login_attempt' } })

    expect(prisma.created[0].olderThan).toEqual(cutOffFor(RETENTION_CLASSES[0], stated))
  })
})
