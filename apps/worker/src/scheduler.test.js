import { describe, it, expect } from 'vitest'
import { QUEUE_NAMES } from '@desi-event/schemas'

import {
  DEFAULT_EXPIRE_HOLDS_INTERVAL_MS,
  EXPIRE_HOLDS_SCHEDULER_ID,
  listRepeatableJobs,
  registerRepeatableJobs,
  removeRepeatableJobs,
} from './scheduler.js'
import { createFakeLogger } from '../tests/helpers/fakes.js'

/**
 * A holds queue that records scheduler upserts in memory.
 *
 * @returns {{queues: Record<string, object>, schedulers: Map<string, object>}} The fake and its store.
 */
function createFakeQueues() {
  /** @type {Map<string, object>} */
  const schedulers = new Map()

  const holds = {
    name: QUEUE_NAMES.HOLDS,
    upsertJobScheduler: async (id, repeat, template) => {
      schedulers.set(id, { id, repeat, template })
      return { id: `${id}:1` }
    },
    removeJobScheduler: async (id) => schedulers.delete(id),
    getJobSchedulers: async () => [...schedulers.values()],
  }

  return { queues: { [QUEUE_NAMES.HOLDS]: holds }, schedulers }
}

describe('registerRepeatableJobs', () => {
  it('registers the hold sweep on the holds queue', async () => {
    const { queues, schedulers } = createFakeQueues()

    const registered = await registerRepeatableJobs({ queues })

    expect(registered).toEqual([
      {
        id: EXPIRE_HOLDS_SCHEDULER_ID,
        queue: QUEUE_NAMES.HOLDS,
        everyMs: DEFAULT_EXPIRE_HOLDS_INTERVAL_MS,
      },
    ])

    const scheduler = schedulers.get(EXPIRE_HOLDS_SCHEDULER_ID)
    expect(scheduler.repeat).toEqual({ every: DEFAULT_EXPIRE_HOLDS_INTERVAL_MS })
    expect(scheduler.template.name).toBe('expire-holds')
  })

  it('sweeps at most once a minute by default', () => {
    expect(DEFAULT_EXPIRE_HOLDS_INTERVAL_MS).toBe(60_000)
  })

  it('never bakes a `now` into the template, which would freeze the sweep forever', async () => {
    const { queues, schedulers } = createFakeQueues()

    await registerRepeatableJobs({ queues })

    const { data } = schedulers.get(EXPIRE_HOLDS_SCHEDULER_ID).template
    expect(data).not.toHaveProperty('now')
    expect(data).toEqual({ batchSize: 250 })
  })

  it('is idempotent across restarts: upserting twice leaves one scheduler', async () => {
    const { queues, schedulers } = createFakeQueues()

    await registerRepeatableJobs({ queues })
    await registerRepeatableJobs({ queues, intervalMs: 30_000 })

    expect(schedulers.size).toBe(1)
    expect(schedulers.get(EXPIRE_HOLDS_SCHEDULER_ID).repeat).toEqual({ every: 30_000 })
  })

  it('honours a configured interval and batch size', async () => {
    const { queues, schedulers } = createFakeQueues()

    const registered = await registerRepeatableJobs({ queues, intervalMs: 15_000, batchSize: 50 })

    expect(registered[0].everyMs).toBe(15_000)
    expect(schedulers.get(EXPIRE_HOLDS_SCHEDULER_ID).template.data.batchSize).toBe(50)
  })

  it('retains the scheduler jobs it mints, but not forever', async () => {
    const { queues, schedulers } = createFakeQueues()

    await registerRepeatableJobs({ queues })

    const { opts } = schedulers.get(EXPIRE_HOLDS_SCHEDULER_ID).template
    expect(opts.removeOnComplete.count).toBeGreaterThan(0)
    expect(opts.removeOnFail.count).toBeGreaterThan(0)
  })

  it('rejects a template payload the job schema would refuse', async () => {
    const { queues } = createFakeQueues()

    await expect(registerRepeatableJobs({ queues, batchSize: 100_000 })).rejects.toThrow()
  })

  it('fails loudly when the holds queue is missing', async () => {
    await expect(registerRepeatableJobs({ queues: {} })).rejects.toThrow(TypeError)
  })

  it('logs the registration so a boot log shows the schedule', async () => {
    const logger = createFakeLogger()
    const { queues } = createFakeQueues()

    await registerRepeatableJobs({ queues, logger })

    expect(logger.at('info')[0].fields).toMatchObject({ scheduler: EXPIRE_HOLDS_SCHEDULER_ID })
  })
})

describe('removeRepeatableJobs and listRepeatableJobs', () => {
  it('removes a registered scheduler and reports what went', async () => {
    const { queues, schedulers } = createFakeQueues()
    await registerRepeatableJobs({ queues })

    await expect(listRepeatableJobs({ queues })).resolves.toHaveLength(1)
    await expect(removeRepeatableJobs({ queues })).resolves.toEqual([EXPIRE_HOLDS_SCHEDULER_ID])
    expect(schedulers.size).toBe(0)
  })

  it('reports nothing when there was nothing to remove', async () => {
    const { queues } = createFakeQueues()

    await expect(removeRepeatableJobs({ queues })).resolves.toEqual([])
    await expect(removeRepeatableJobs({ queues: {} })).resolves.toEqual([])
    await expect(listRepeatableJobs({ queues: {} })).resolves.toEqual([])
  })
})
