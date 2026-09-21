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
  // The stored table, keyed the way PostgreSQL keys it. `created` still records
  // every *attempt*, which is what separates a constraint-enforced write from a
  // read-then-write that merely looks the same from outside.
  const rows = new Map()
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
    rows,
    loginAttempt: swept(),
    session: swept(),
    notificationOutbox: swept(),
    privacyHold: swept(),
    retentionSweep: {
      create: vi.fn(async ({ data }) => {
        created.push(data)

        if (data.id !== undefined && rows.has(data.id)) {
          // Prisma's unique-constraint violation, which is what the primary key
          // raises when a redelivery writes the same row again.
          const conflict = new Error('Unique constraint failed on the fields: (`id`)')

          conflict.code = 'P2002'
          throw conflict
        }

        const row = { id: data.id ?? `sweep-${created.length}`, ...data }

        rows.set(row.id, row)

        return row
      }),
      findUnique: vi.fn(async ({ where }) => rows.get(where.id) ?? null),
    },
    $executeRaw: forbid('$executeRaw'),
    $executeRawUnsafe: forbid('$executeRawUnsafe'),
  }
}

/**
 * A Prisma stand-in whose counts fail.
 *
 * @param {object} [options] Options.
 * @param {ReadonlyArray<string>} [options.failing] Which models throw on `count`.
 * @param {Error} [options.error] What they throw.
 * @returns {object} The stub.
 */
function failingPrisma({ failing = ['session'], error } = {}) {
  const prisma = sweepingPrisma()

  for (const model of failing) {
    prisma[model].count = vi.fn(async () => {
      throw error ?? Object.assign(new Error('connection terminated'), { code: 'P1001' })
    })
  }

  return prisma
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

describe('a second delivery of the same rehearsal', () => {
  it('writes no new rows, and lets the database be the one that says so', async () => {
    // The assertion that matters is the second one. A read-then-write
    // implementation — findUnique first, create only if absent — would satisfy
    // "four rows exist" identically while attempting only four creates.
    //
    // Counting the attempts is what distinguishes the two, and the distinction
    // is the whole design: a read-then-write is a race two replicas can both
    // lose, and the primary key answers atomically.
    const prisma = sweepingPrisma()
    const process = createRetentionSweepProcessor({
      prisma,
      logger: recordingLogger(),
      activated: true,
      clock: () => NOW,
    })

    const first = await process({ data: { now: NOW.toISOString() } })
    const second = await process({ data: { now: NOW.toISOString() } })

    expect(prisma.rows.size).toBe(RETENTION_CLASSES.length)
    expect(prisma.retentionSweep.create).toHaveBeenCalledTimes(RETENTION_CLASSES.length * 2)

    expect(first.deduplicated).toBe(0)
    expect(second.deduplicated).toBe(RETENTION_CLASSES.length)
    // Still reports what it swept. A redelivery is not a smaller rehearsal.
    expect(second.swept).toBe(RETENTION_CLASSES.length)
  })

  it('reports the rows the first delivery wrote, not nulls', async () => {
    const prisma = sweepingPrisma()
    const process = createRetentionSweepProcessor({
      prisma,
      logger: recordingLogger(),
      activated: true,
      clock: () => NOW,
    })

    await process({ data: { now: NOW.toISOString() } })
    await process({ data: { now: NOW.toISOString() } })

    expect(prisma.retentionSweep.findUnique).toHaveBeenCalledTimes(RETENTION_CLASSES.length)
    for (const row of prisma.rows.values()) expect(row.state).toBe('COMPLETED')
  })
})

describe('a refusal and a count at the same instant', () => {
  it('are two rows, because they are two different facts', async () => {
    // The failure this prevents: an operator rehearses against an environment
    // where enforcement is off, then activates it and re-runs at the same
    // `now` deliberately, so the two can be compared at one cut-off.
    //
    // Were the ids shared, every insert in the second run would conflict, the
    // run that actually counted would record nothing, and the table would
    // report "we were told not to" about a run that examined rows.
    const prisma = sweepingPrisma()
    const payload = { data: { now: NOW.toISOString() } }

    await createRetentionSweepProcessor({
      prisma,
      logger: recordingLogger(),
      activated: false,
      clock: () => NOW,
    })(payload)

    await createRetentionSweepProcessor({
      prisma,
      logger: recordingLogger(),
      activated: true,
      clock: () => NOW,
    })(payload)

    const states = [...prisma.rows.values()].map((row) => row.state).sort()

    expect(prisma.rows.size).toBe(RETENTION_CLASSES.length * 2)
    expect(states.filter((state) => state === 'SKIPPED_DISABLED')).toHaveLength(
      RETENTION_CLASSES.length,
    )
    expect(states.filter((state) => state === 'COMPLETED')).toHaveLength(RETENTION_CLASSES.length)
  })
})

describe('when a count fails', () => {
  it('records a FAILED row for that class rather than leaving a blank', async () => {
    // Before this, a failure threw and left nothing — which on the screen is
    // the same empty table as "no rehearsal has ever run here" and as "it ran
    // and declined". A blank is the one answer this surface cannot afford.
    const prisma = failingPrisma({ failing: ['session'] })
    const process = createRetentionSweepProcessor({
      prisma,
      logger: recordingLogger(),
      activated: true,
      clock: () => NOW,
    })

    await expect(process({ data: {} })).rejects.toThrow(/retention rehearsal failed/u)

    const failed = [...prisma.rows.values()].filter((row) => row.state === 'FAILED')

    // `session` and `session_metadata` both count the session table.
    expect(failed.map((row) => row.retentionClass).sort()).toEqual(['session', 'session_metadata'])
    for (const row of failed) {
      expect(row.failureCode).toBe('CANDIDATE_COUNT_FAILED')
      expect(row.examinedCount).toBe(0)
      expect(row.affectedCount).toBe(0)
      expect(row.mode).toBe('DRY_RUN')
    }
  })

  it('carries on to the other classes instead of abandoning the run', async () => {
    // Aborting at the first failure leaves the remaining classes with no row,
    // which the screen renders with the same words it uses for a class no
    // sweep has ever covered. An operator could not tell "never rehearsed"
    // from "the run gave up two classes before reaching it".
    const prisma = failingPrisma({ failing: ['session'] })

    await expect(
      createRetentionSweepProcessor({
        prisma,
        logger: recordingLogger(),
        activated: true,
        clock: () => NOW,
      })({ data: {} }),
    ).rejects.toThrow()

    // Every class has a row: two failed, two counted.
    expect(prisma.rows.size).toBe(RETENTION_CLASSES.length)

    const completed = [...prisma.rows.values()]
      .filter((row) => row.state === 'COMPLETED')
      .map((row) => row.retentionClass)
      .sort()

    expect(completed).toEqual(['login_attempt', 'notification_recipient'])
  })

  it('still fails the job, so a rehearsal that could not count is not a green one', async () => {
    const prisma = failingPrisma({ failing: ['session'] })

    await expect(
      createRetentionSweepProcessor({
        prisma,
        logger: recordingLogger(),
        activated: true,
        clock: () => NOW,
      })({ data: {} }),
    ).rejects.toThrow(/session \(CANDIDATE_COUNT_FAILED\)/u)
  })

  it('never writes the driver message to the row', async () => {
    // `failureCode` is rendered on /retention. A message from a failed count
    // against a table of sessions is exactly the kind of string that arrives
    // carrying a fragment of a row.
    const prisma = failingPrisma({
      failing: ['session'],
      error: new Error('could not read row for priya@example.com at 10.0.0.4'),
    })

    await expect(
      createRetentionSweepProcessor({
        prisma,
        logger: recordingLogger(),
        activated: true,
        clock: () => NOW,
      })({ data: {} }),
    ).rejects.toThrow()

    const stored = JSON.stringify([...prisma.rows.values()])

    expect(stored).not.toMatch(/priya/iu)
    expect(stored).not.toMatch(/10\.0\.0\.4/u)
  })

  it('logs the driver message, so the cause is not lost', async () => {
    const prisma = failingPrisma({ failing: ['session'] })
    const logger = recordingLogger()

    await expect(
      createRetentionSweepProcessor({
        prisma,
        logger,
        activated: true,
        clock: () => NOW,
      })({ data: {} }),
    ).rejects.toThrow()

    expect(logger.error).toHaveBeenCalled()
    const [context] = logger.error.mock.calls[0]

    expect(context.failureCode).toBe('CANDIDATE_COUNT_FAILED')
    expect(context.err).toBeInstanceOf(Error)
  })

  it('survives a thrown value it cannot attach anything to', async () => {
    // The reason the failure path wraps rather than tags. Assigning a code onto
    // a frozen object raises a TypeError in strict mode, and that TypeError
    // would replace the real failure — so the row would say UNEXPECTED for a
    // cause the code had already identified.
    const prisma = failingPrisma({
      failing: ['session'],
      error: Object.freeze(new Error('frozen')),
    })

    await expect(
      createRetentionSweepProcessor({
        prisma,
        logger: recordingLogger(),
        activated: true,
        clock: () => NOW,
      })({ data: {} }),
    ).rejects.toThrow(/retention rehearsal failed/u)

    const failed = [...prisma.rows.values()].filter((row) => row.state === 'FAILED')

    expect(failed).toHaveLength(2)
    for (const row of failed) expect(row.failureCode).toBe('CANDIDATE_COUNT_FAILED')
  })

  it('records the hold count failing as a different thing from the candidates failing', async () => {
    // Two different facts. A candidate count that failed examined nothing; a
    // hold count that failed means the candidates were counted and the figure
    // could not be qualified — and an examined count nobody could qualify
    // reads as "this many would be deleted" when nothing checked what was
    // forbidden.
    const prisma = failingPrisma({ failing: ['privacyHold'] })

    await expect(
      createRetentionSweepProcessor({
        prisma,
        logger: recordingLogger(),
        activated: true,
        clock: () => NOW,
      })({ data: {} }),
    ).rejects.toThrow()

    const failed = [...prisma.rows.values()].filter((row) => row.state === 'FAILED')

    // Only the subject-linked class asks about holds at all.
    expect(failed.map((row) => row.retentionClass)).toEqual(['notification_recipient'])
    expect(failed[0].failureCode).toBe('HOLD_COUNT_FAILED')
  })
})
