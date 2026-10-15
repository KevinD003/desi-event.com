import { describe, expect, it } from 'vitest'
import { createInMemoryProviderRegistry } from '@desi-event/providers'
import { JOB_NAMES } from '@desi-event/schemas/jobs'

import { createProcessors } from './index.js'
import { createRollUpTrafficProcessor } from './roll-up-traffic.js'
import { createFakeLogger } from '../../tests/helpers/fakes.js'

const PRISMA = Object.freeze({ fake: true })

/**
 * A fake roll-up that records what it was asked and answers a fixed summary.
 *
 * @param {object} summary What to answer.
 * @returns {{rollUp: Function, calls: Array<object>}} The fake and its calls.
 */
function fakeRollUp(summary) {
  const calls = []

  return {
    calls,
    rollUp: async (prisma, options) => {
      calls.push({ prisma, options })
      return summary
    },
  }
}

const DONE = Object.freeze({
  claimed: true,
  leaseLost: false,
  days: 3,
  rowsPurged: 120,
  saltsDiscarded: 2,
})

describe('createRollUpTrafficProcessor', () => {
  it('needs a Prisma client and a worker id, which is the name on the lease', () => {
    expect(() => createRollUpTrafficProcessor({ workerId: 'w1' })).toThrow(TypeError)

    for (const workerId of [undefined, '', '   ']) {
      expect(() => createRollUpTrafficProcessor({ prisma: PRISMA, workerId })).toThrow(TypeError)
    }
  })

  it('runs the roll-up with the payload’s business instant and lease', async () => {
    const { rollUp, calls } = fakeRollUp(DONE)
    const processor = createRollUpTrafficProcessor({ prisma: PRISMA, workerId: 'w1', rollUp })

    await expect(
      processor({ data: { now: '2026-09-28T06:00:00.000Z', leaseMs: '60000' } }),
    ).resolves.toEqual(DONE)

    expect(calls).toHaveLength(1)
    expect(calls[0].prisma).toBe(PRISMA)
    expect(calls[0].options.workerId).toBe('w1')
    expect(calls[0].options.now.toISOString()).toBe('2026-09-28T06:00:00.000Z')
    expect(calls[0].options.leaseMs).toBe(60_000)
  })

  it('uses the wall clock and the default lease when the payload names neither', async () => {
    const { rollUp, calls } = fakeRollUp(DONE)
    const processor = createRollUpTrafficProcessor({ prisma: PRISMA, workerId: 'w1', rollUp })
    const before = Date.now()

    await processor({ data: {} })

    expect(calls[0].options.now.getTime()).toBeGreaterThanOrEqual(before)
    expect(calls[0].options.leaseMs).toBe(300_000)
  })

  it.each([{ leaseMs: 5 }, { leaseMs: 10_000_000 }, { now: 'yesterday' }])(
    'refuses the payload %j before touching the database',
    async (data) => {
      const { rollUp, calls } = fakeRollUp(DONE)
      const processor = createRollUpTrafficProcessor({ prisma: PRISMA, workerId: 'w1', rollUp })

      await expect(processor({ data })).rejects.toThrow(/roll-up-traffic/u)
      expect(calls).toHaveLength(0)
    },
  )

  it('logs counts and nothing else', async () => {
    const logger = createFakeLogger()
    const { rollUp } = fakeRollUp(DONE)
    const processor = createRollUpTrafficProcessor({
      prisma: PRISMA,
      workerId: 'w1',
      rollUp,
      logger,
    })

    await processor({ data: {} })

    const [line] = logger.at('info')

    expect(logger.at('info')).toHaveLength(1)
    expect(line.message).toBe('traffic added up')
    expect(line.fields).toEqual({ days: 3, rowsPurged: 120, saltsDiscarded: 2, leaseLost: false })
  })

  it('says nothing at info when there was nothing to add up', async () => {
    const logger = createFakeLogger()
    const { rollUp } = fakeRollUp({ ...DONE, days: 0, rowsPurged: 0, saltsDiscarded: 0 })
    const processor = createRollUpTrafficProcessor({
      prisma: PRISMA,
      workerId: 'w1',
      rollUp,
      logger,
    })

    await processor({ data: {} })

    expect(logger.at('info')).toHaveLength(0)
  })

  it('notes at debug, not info, when another worker holds the lease', async () => {
    const logger = createFakeLogger()
    const { rollUp } = fakeRollUp({ ...DONE, claimed: false, days: 0 })
    const processor = createRollUpTrafficProcessor({
      prisma: PRISMA,
      workerId: 'w1',
      rollUp,
      logger,
    })

    const summary = await processor({ data: {} })

    expect(summary.claimed).toBe(false)
    expect(logger.at('info')).toHaveLength(0)
    expect(logger.at('debug')[0].message).toMatch(/another worker holds the lease/u)
  })
})

describe('the processor registry', () => {
  it('registers the roll-up under its job name', () => {
    const processors = createProcessors({
      prisma: PRISMA,
      providers: createInMemoryProviderRegistry(),
      workerId: 'w1',
    })

    expect(typeof processors[JOB_NAMES.ROLL_UP_TRAFFIC]).toBe('function')
  })
})
