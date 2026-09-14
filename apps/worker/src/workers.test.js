import { describe, it, expect } from 'vitest'
import { EventEmitter } from 'node:events'
import { QUEUE_NAMES } from '@desi-event/schemas'

import { QUEUE_WORKER_OPTIONS, closeWorkers, concurrencyFor, instrumentWorker } from './workers.js'
import { createFakeLogger } from '../tests/helpers/fakes.js'

describe('concurrencyFor', () => {
  it('pins the hold sweep to one, because parallel sweeps fight over the same rows', () => {
    expect(concurrencyFor(QUEUE_NAMES.HOLDS, 50)).toBe(1)
  })

  it('uses the configured value for the I/O-bound queues', () => {
    for (const name of [QUEUE_NAMES.EMAIL, QUEUE_NAMES.TICKETS, QUEUE_NAMES.SEARCH]) {
      expect(concurrencyFor(name, 12)).toBe(12)
    }
  })

  it('never returns less than one, whatever it is handed', () => {
    expect(concurrencyFor(QUEUE_NAMES.EMAIL, 0)).toBe(1)
    expect(concurrencyFor(QUEUE_NAMES.EMAIL, -4)).toBe(1)
  })

  it('gives ticket issuance a lock longer than BullMQ’s 30s default', () => {
    expect(QUEUE_WORKER_OPTIONS[QUEUE_NAMES.TICKETS].lockDuration).toBeGreaterThan(30_000)
  })
})

describe('instrumentWorker', () => {
  it('logs one line per completed job, carrying the result', () => {
    const logger = createFakeLogger()
    const worker = instrumentWorker(new EventEmitter(), QUEUE_NAMES.EMAIL, logger)

    worker.emit('completed', { name: 'send-email', id: '7' }, { providerRef: 'email_1' })

    expect(logger.at('info')).toHaveLength(1)
    expect(logger.at('info')[0].fields).toMatchObject({
      queue: QUEUE_NAMES.EMAIL,
      job: 'send-email',
      jobId: '7',
      result: { providerRef: 'email_1' },
    })
  })

  it('warns while retries remain and errors on the final failure', () => {
    const logger = createFakeLogger()
    const worker = instrumentWorker(new EventEmitter(), QUEUE_NAMES.TICKETS, logger)

    worker.emit(
      'failed',
      { name: 'issue-tickets', attemptsMade: 1, opts: { attempts: 3 } },
      new Error('blip'),
    )
    worker.emit(
      'failed',
      { name: 'issue-tickets', attemptsMade: 3, opts: { attempts: 3 } },
      new Error('dead'),
    )

    expect(logger.at('warn')[0].fields.willRetry).toBe(true)
    expect(logger.at('error')[0].fields.willRetry).toBe(false)
    expect(logger.at('error')[0].message).toBe('job failed permanently')
  })

  it('treats a job with no attempts recorded as final', () => {
    const logger = createFakeLogger()
    const worker = instrumentWorker(new EventEmitter(), QUEUE_NAMES.SEARCH, logger)

    worker.emit('failed', undefined, new Error('no job'))

    expect(logger.at('error')).toHaveLength(1)
  })

  it('subscribes to worker-level errors, which would otherwise kill the process', () => {
    const logger = createFakeLogger()
    const worker = instrumentWorker(new EventEmitter(), QUEUE_NAMES.HOLDS, logger)

    expect(worker.listenerCount('error')).toBe(1)
    expect(() => worker.emit('error', new Error('connection lost'))).not.toThrow()
    expect(logger.at('error')[0].message).toBe('worker error')
  })

  it('works without a logger', () => {
    const worker = instrumentWorker(new EventEmitter(), QUEUE_NAMES.EMAIL, undefined)

    expect(() => worker.emit('completed', { name: 'send-email' }, {})).not.toThrow()
    expect(() => worker.emit('error', new Error('x'))).not.toThrow()
  })
})

describe('closeWorkers', () => {
  it('closes every worker and tolerates one refusing', async () => {
    /** @type {string[]} */
    const closed = []
    const workers = [
      { close: async () => closed.push('a') },
      {
        close: async () => {
          throw new Error('stuck')
        },
      },
      { close: async () => closed.push('c') },
    ]

    await expect(closeWorkers(workers)).resolves.toBeUndefined()
    expect(closed.sort()).toEqual(['a', 'c'])
  })

  it('tolerates being handed nothing', async () => {
    await expect(closeWorkers(undefined)).resolves.toBeUndefined()
  })
})
