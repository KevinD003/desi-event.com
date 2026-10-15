/**
 * The traffic roll-up's control flow, against a recording fake client.
 *
 * What PostgreSQL does with the statements — the sums, the CHECKs, the purge,
 * two workers racing for the lease — is proven against a real database in
 * `apps/worker/tests/traffic-rollup-postgres.test.js`. This file pins the
 * decisions the module makes itself: which clock each step reads, which days
 * are purged, and what happens when the lease goes.
 */

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_LEASE_MS,
  PURGE_BATCH_ROWS,
  RAW_KEEP_DAYS,
  ROLLUP_STATE_ID,
  claimTrafficRollupLease,
  dayDate,
  releaseTrafficRollupLease,
  rollupTransactionOptions,
  runTrafficRollup,
  utcDay,
} from '../src/traffic-rollup.js'

/**
 * A fake Prisma client that records every call.
 *
 * @param {object} [options] Behaviour.
 * @param {string[]} [options.days] Days the raw table holds.
 * @param {boolean} [options.claim] Whether the claim succeeds.
 * @param {number} [options.renewFailsOnDay] The 0-based renewal that finds the lease gone: one
 *   renewal per day, plus one per further purge batch of a busy day.
 * @param {Error} [options.failOnDay] An error thrown by the second renewal's upsert (the second
 *   day's, when no day needs a further purge batch).
 * @param {number[]} [options.purgeResults] Rows each purge statement reports, in order; 7 after.
 * @returns {object} The fake, with `calls` and the `transactions` options it was given.
 */
function fakePrisma({
  days = [],
  claim = true,
  renewFailsOnDay = -1,
  failOnDay = null,
  purgeResults = [],
} = {}) {
  const calls = []
  const transactions = []
  const purges = [...purgeResults]
  let dayIndex = -1

  const tx = {
    trafficRollupState: {
      updateMany: async (args) => {
        dayIndex += 1
        calls.push({ op: 'renew', args, day: days[dayIndex] })

        return { count: dayIndex === renewFailsOnDay ? 0 : 1 }
      },
    },
    $executeRaw: async (strings, ...values) => {
      const sql = Array.from(strings).join('?')

      if (sql.includes('INSERT INTO "TrafficDaily"')) {
        calls.push({ op: 'upsert', values })
        if (failOnDay && dayIndex === 1) throw failOnDay
        return 2
      }

      calls.push({ op: 'purge', values })
      return purges.length > 0 ? purges.shift() : 7
    },
  }

  return {
    calls,
    transactions,
    trafficRollupState: {
      createMany: async (args) => {
        calls.push({ op: 'ensure', args })
        return { count: 0 }
      },
      updateMany: async (args) => {
        const releasing = args.data.leaseOwner === null

        calls.push({ op: releasing ? 'release' : 'claim', args })

        return { count: releasing || claim ? 1 : 0 }
      },
    },
    trafficSalt: {
      deleteMany: async (args) => {
        calls.push({ op: 'salts', args })
        return { count: 3 }
      },
    },
    $queryRaw: async (strings) => {
      calls.push({ op: 'days', sql: Array.from(strings).join('?') })
      return days.map((day) => ({ day }))
    },
    $transaction: async (fn, options) => {
      transactions.push(options)
      return fn(tx)
    },
  }
}

const LEASE_CLOCK = new Date('2026-10-01T12:00:00.000Z')

describe('utcDay and dayDate', () => {
  it('turn an instant into its UTC day and back to that day’s midnight', () => {
    expect(utcDay(new Date('2026-09-30T23:59:59.999Z'))).toBe('2026-09-30')
    expect(dayDate('2026-09-30').toISOString()).toBe('2026-09-30T00:00:00.000Z')
  })
})

describe('the lease', () => {
  it('is claimed against the lease clock, only when free or expired', async () => {
    const prisma = fakePrisma()

    await expect(
      claimTrafficRollupLease(prisma, { workerId: 'w1', clock: () => LEASE_CLOCK, leaseMs: 1000 }),
    ).resolves.toBe(true)

    const claim = prisma.calls.find((call) => call.op === 'claim').args

    expect(claim.where).toEqual({
      id: ROLLUP_STATE_ID,
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: LEASE_CLOCK } }],
    })
    expect(claim.data).toEqual({
      leaseOwner: 'w1',
      leaseExpiresAt: new Date(LEASE_CLOCK.getTime() + 1000),
    })
  })

  it('is released only by its holder, recording the real completion time', async () => {
    const prisma = fakePrisma()

    await releaseTrafficRollupLease(prisma, {
      workerId: 'w1',
      completed: true,
      clock: () => LEASE_CLOCK,
    })
    await releaseTrafficRollupLease(prisma, { workerId: 'w1', completed: false })

    const [done, failed] = prisma.calls.filter((call) => call.op === 'release')

    expect(done.args.where).toEqual({ id: ROLLUP_STATE_ID, leaseOwner: 'w1' })
    expect(done.args.data).toEqual({
      leaseOwner: null,
      leaseExpiresAt: null,
      lastCompletedAt: LEASE_CLOCK,
    })
    expect(failed.args.data).toEqual({ leaseOwner: null, leaseExpiresAt: null })
  })
})

describe('runTrafficRollup', () => {
  it.each([undefined, '', '   ', 7])('refuses the worker id %j', async (workerId) => {
    await expect(runTrafficRollup(fakePrisma(), { workerId })).rejects.toThrow(TypeError)
  })

  it.each([0, -1, 1.5, '300000'])('refuses the lease length %j', async (leaseMs) => {
    await expect(runTrafficRollup(fakePrisma(), { workerId: 'w1', leaseMs })).rejects.toThrow(
      TypeError,
    )
  })

  it('does nothing when another worker holds the lease', async () => {
    const prisma = fakePrisma({ days: ['2026-09-29'], claim: false })

    await expect(runTrafficRollup(prisma, { workerId: 'w2' })).resolves.toEqual({
      claimed: false,
      leaseLost: false,
      days: 0,
      rowsPurged: 0,
      saltsDiscarded: 0,
    })
    expect(prisma.calls.map((call) => call.op)).toEqual(['ensure', 'claim'])
  })

  it('adds up every day, purges only days two or more before the business day, and drops old salts', async () => {
    const prisma = fakePrisma({ days: ['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30'] })
    // A business instant in the past, with a real lease clock: the purge
    // follows the business day, and the lease still works.
    const now = new Date('2026-09-30T08:00:00.000Z')

    const summary = await runTrafficRollup(prisma, { workerId: 'w1', now })

    expect(summary).toEqual({
      claimed: true,
      leaseLost: false,
      days: 4,
      rowsPurged: 14,
      saltsDiscarded: 3,
    })

    const purged = prisma.calls.filter((call) => call.op === 'purge').map((call) => call.values[0])

    expect(purged).toEqual(['2026-09-27', '2026-09-28'])
    expect(prisma.calls.filter((call) => call.op === 'upsert').map((call) => call.values)).toEqual(
      ['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30'].map((day) => [
        now,
        day,
        RAW_KEEP_DAYS,
      ]),
    )
    expect(prisma.calls.find((call) => call.op === 'salts').args).toEqual({
      where: { day: { lt: new Date('2026-09-30T00:00:00.000Z') } },
    })

    const release = prisma.calls.at(-1)

    expect(release.op).toBe('release')
    expect(release.args.data.lastCompletedAt).toBeInstanceOf(Date)
    // Recorded on the real clock, not the injected business instant.
    expect(release.args.data.lastCompletedAt.getTime()).toBeGreaterThan(now.getTime())
  })

  it('re-checks and renews the lease on the lease clock before every day', async () => {
    const prisma = fakePrisma({ days: ['2026-09-29', '2026-09-30'] })
    let reads = 0
    const clock = () => new Date(LEASE_CLOCK.getTime() + 1000 * reads++)

    await runTrafficRollup(prisma, {
      workerId: 'w1',
      now: new Date('2020-01-01T00:00:00.000Z'),
      clock,
      leaseMs: 60_000,
    })

    const renewals = prisma.calls.filter((call) => call.op === 'renew')

    expect(renewals).toHaveLength(2)

    for (const { args } of renewals) {
      expect(args.where.id).toBe(ROLLUP_STATE_ID)
      expect(args.where.leaseOwner).toBe('w1')
      // Compared with the lease clock — never with the 2020 business instant.
      expect(args.where.leaseExpiresAt.gt.getTime()).toBeGreaterThanOrEqual(LEASE_CLOCK.getTime())
      expect(args.data.leaseExpiresAt.getTime() - args.where.leaseExpiresAt.gt.getTime()).toBe(
        60_000 + 1000,
      )
    }
  })

  it('stops at a day whose lease was taken, purging nothing more and recording no completion', async () => {
    const prisma = fakePrisma({
      days: ['2026-09-20', '2026-09-21', '2026-09-22'],
      renewFailsOnDay: 1,
    })

    const summary = await runTrafficRollup(prisma, {
      workerId: 'w1',
      now: new Date('2026-10-01T00:00:00.000Z'),
    })

    expect(summary).toEqual({
      claimed: true,
      leaseLost: true,
      days: 1,
      rowsPurged: 7,
      saltsDiscarded: 0,
    })
    expect(prisma.calls.filter((call) => call.op === 'upsert')).toHaveLength(1)
    expect(prisma.calls.filter((call) => call.op === 'purge')).toHaveLength(1)
    expect(prisma.calls.some((call) => call.op === 'release')).toBe(false)
  })

  it('gives the lease back without a completion when a day fails, and rethrows', async () => {
    const fault = Object.assign(new Error('connection lost'), { code: 'P1017' })
    const prisma = fakePrisma({ days: ['2026-09-29', '2026-09-30'], failOnDay: fault })

    await expect(runTrafficRollup(prisma, { workerId: 'w1' })).rejects.toBe(fault)

    const release = prisma.calls.at(-1)

    expect(release.op).toBe('release')
    expect(release.args.data).toEqual({ leaseOwner: null, leaseExpiresAt: null })
  })

  it('defaults to a five-minute lease', () => {
    expect(DEFAULT_LEASE_MS).toBe(300_000)
  })

  it('gives every transaction half the lease, never Prisma’s five-second default alone', async () => {
    expect(rollupTransactionOptions(DEFAULT_LEASE_MS)).toEqual({
      maxWait: 10_000,
      timeout: 150_000,
    })
    expect(rollupTransactionOptions(900_000).timeout).toBe(450_000)
    // The shortest lease a job may ask for still gets Prisma's own limit.
    expect(rollupTransactionOptions(10_000).timeout).toBe(5_000)
    expect(() => rollupTransactionOptions(0)).toThrow(TypeError)

    const prisma = fakePrisma({
      days: ['2026-09-20', '2026-09-21'],
      // The first day: two full batches, then an empty one; the second: one short batch.
      purgeResults: [3, 3, 0, 1],
    })

    await runTrafficRollup(prisma, {
      workerId: 'w1',
      now: new Date('2026-10-01T00:00:00.000Z'),
      purgeBatchRows: 3,
    })

    // Two days, the first purged in three batches: four transactions, each
    // with the limits.
    expect(prisma.transactions).toHaveLength(4)

    for (const options of prisma.transactions) {
      expect(options).toEqual({ maxWait: 10_000, timeout: 150_000 })
    }
  })

  it('purges a busy day in batches, renewing the lease before each further batch', async () => {
    const prisma = fakePrisma({ days: ['2026-09-20'], purgeResults: [3, 3, 1] })

    const summary = await runTrafficRollup(prisma, {
      workerId: 'w1',
      now: new Date('2026-10-01T00:00:00.000Z'),
      purgeBatchRows: 3,
    })

    expect(summary).toMatchObject({ claimed: true, leaseLost: false, days: 1, rowsPurged: 7 })
    // The first batch shares the day's transaction with its sums; a batch
    // shorter than the limit was the last one.
    expect(
      prisma.calls.filter((call) => call.op !== 'ensure' && call.op !== 'claim').map((c) => c.op),
    ).toEqual([
      'days',
      'renew',
      'upsert',
      'purge',
      'renew',
      'purge',
      'renew',
      'purge',
      'salts',
      'release',
    ])
    expect(prisma.calls.filter((call) => call.op === 'purge').map((call) => call.values)).toEqual([
      ['2026-09-20', 3],
      ['2026-09-20', 3],
      ['2026-09-20', 3],
    ])
    expect(prisma.calls.at(-1).args.data.lastCompletedAt).toBeInstanceOf(Date)
  })

  it('stops between purge batches when the lease goes, counting what it deleted', async () => {
    const prisma = fakePrisma({
      days: ['2026-09-20', '2026-09-21'],
      purgeResults: [3, 3],
      // The second renewal is the first further batch of the first day.
      renewFailsOnDay: 1,
    })

    const summary = await runTrafficRollup(prisma, {
      workerId: 'w1',
      now: new Date('2026-10-01T00:00:00.000Z'),
      purgeBatchRows: 3,
    })

    expect(summary).toEqual({
      claimed: true,
      leaseLost: true,
      days: 0,
      rowsPurged: 3,
      saltsDiscarded: 0,
    })
    expect(prisma.calls.filter((call) => call.op === 'upsert')).toHaveLength(1)
    expect(prisma.calls.filter((call) => call.op === 'purge')).toHaveLength(1)
    expect(prisma.calls.some((call) => call.op === 'release')).toBe(false)
  })

  it('carries on with the later days when one fails, then records no completion and rethrows', async () => {
    const fault = Object.assign(new Error('Transaction API error: expired'), { code: 'P2028' })
    const prisma = fakePrisma({
      days: ['2026-09-20', '2026-09-21', '2026-09-22'],
      failOnDay: fault,
    })
    const logged = []
    const logger = {
      error: (fields, message) => logged.push({ fields, message }),
      warn: () => {},
    }

    await expect(
      runTrafficRollup(prisma, {
        workerId: 'w1',
        now: new Date('2026-10-01T00:00:00.000Z'),
        logger,
      }),
    ).rejects.toBe(fault)

    // The day after the failing one is still added up and purged.
    expect(prisma.calls.filter((call) => call.op === 'upsert').map((c) => c.values[1])).toEqual([
      '2026-09-20',
      '2026-09-21',
      '2026-09-22',
    ])
    expect(prisma.calls.filter((call) => call.op === 'purge').map((c) => c.values[0])).toEqual([
      '2026-09-20',
      '2026-09-22',
    ])
    expect(prisma.calls.some((call) => call.op === 'salts')).toBe(true)

    const release = prisma.calls.at(-1)

    expect(release.op).toBe('release')
    expect(release.args.data).toEqual({ leaseOwner: null, leaseExpiresAt: null })
    // The log names the day and the code: nothing about who visited what.
    expect(logged).toEqual([
      {
        fields: { day: '2026-09-21', code: 'P2028' },
        message: 'traffic roll-up could not finish a day; carrying on with the later days',
      },
    ])
  })

  it('never overwrites final totals: the upsert keeps sums made two or more days after their day', async () => {
    const prisma = fakePrisma({ days: ['2026-09-30'] })
    let upsertSql = ''

    prisma.$transaction = async (fn) =>
      fn({
        trafficRollupState: { updateMany: async () => ({ count: 1 }) },
        $executeRaw: async (strings) => {
          const sql = Array.from(strings).join('?')

          if (sql.includes('INSERT INTO "TrafficDaily"')) upsertSql = sql
          return 0
        },
      })

    await runTrafficRollup(prisma, { workerId: 'w1', now: new Date('2026-09-30T08:00:00.000Z') })

    expect(upsertSql.replace(/\s+/g, ' ')).toContain(
      'WHERE "TrafficDaily"."demonstration" OR "TrafficDaily"."computedAt" < "TrafficDaily"."day" + ?::integer',
    )
  })

  it.each([0, -1, 2.5, '10'])('refuses the purge batch size %j', async (purgeBatchRows) => {
    await expect(
      runTrafficRollup(fakePrisma(), { workerId: 'w1', purgeBatchRows }),
    ).rejects.toThrow(TypeError)
  })

  it('purges fifty thousand rows a statement by default', () => {
    expect(PURGE_BATCH_ROWS).toBe(50_000)
  })
})
