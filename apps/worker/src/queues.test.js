import { readFileSync } from 'node:fs'

import { describe, it, expect } from 'vitest'
import { isValidationError } from '@desi-event/schemas'
import { JOB_NAMES, QUEUE_NAMES } from '@desi-event/schemas/jobs'

import {
  DEFAULT_JOB_OPTIONS,
  QUEUE_FOR_JOB,
  closeQueues,
  enqueue,
  enqueueExpireHolds,
  enqueueIndexEvent,
  enqueueIssueTickets,
  enqueueSendEmail,
  enqueueSweepRetention,
  jobOptionsFor,
  validateJobPayload,
} from './queues.js'
import { EVENT_ID, ORDER_ID, TICKET_TYPE_ID } from '../tests/helpers/fakes.js'

/**
 * The scheduler's own source, read so that "retention is never on a clock" can
 * be asserted against the file rather than against a claim about it.
 */
const schedulerSource = readFileSync(new URL('./scheduler.js', import.meta.url), 'utf8')

/**
 * Build a queue map whose `add` records rather than enqueues.
 *
 * @returns {{queues: Record<string, object>, added: Array<object>, closed: string[]}} The fakes and their call logs.
 */
function createFakeQueues() {
  /** @type {Array<object>} */
  const added = []
  /** @type {string[]} */
  const closed = []
  /** @type {Record<string, object>} */
  const queues = {}

  for (const name of Object.values(QUEUE_NAMES)) {
    queues[name] = {
      name,
      add: async (jobName, data, options) => {
        added.push({ queue: name, jobName, data, options })
        return { id: String(added.length), name: jobName, data }
      },
      close: async () => closed.push(name),
    }
  }

  return { queues, added, closed }
}

describe('job option policy', () => {
  it('keeps failures far longer than completions, everywhere', () => {
    for (const name of Object.values(QUEUE_NAMES)) {
      const options = jobOptionsFor(name)
      const completedAge = options.removeOnComplete === true ? 0 : options.removeOnComplete.age
      expect(options.removeOnFail.age).toBeGreaterThanOrEqual(completedAge)
    }
  })

  it('gives every queue retries with a backoff', () => {
    for (const name of Object.values(QUEUE_NAMES)) {
      const options = jobOptionsFor(name)
      expect(options.attempts).toBeGreaterThan(1)
      expect(options.backoff.delay).toBeGreaterThan(0)
      expect(['exponential', 'fixed']).toContain(options.backoff.type)
    }
  })

  it('gives ticket issuance the most attempts, because a buyer has already paid', () => {
    const tickets = jobOptionsFor(QUEUE_NAMES.TICKETS).attempts
    for (const name of Object.values(QUEUE_NAMES)) {
      expect(tickets).toBeGreaterThanOrEqual(jobOptionsFor(name).attempts)
    }
  })

  it('falls back to the shared defaults for an unknown queue', () => {
    expect(jobOptionsFor('not-a-queue')).toEqual(DEFAULT_JOB_OPTIONS)
  })

  it('maps every job to a queue that exists', () => {
    for (const jobName of Object.values(JOB_NAMES)) {
      expect(Object.values(QUEUE_NAMES)).toContain(QUEUE_FOR_JOB[jobName])
    }
  })
})

describe('validateJobPayload', () => {
  it('applies schema defaults so the stored payload is fully resolved', () => {
    expect(validateJobPayload(JOB_NAMES.EXPIRE_HOLDS, {})).toEqual({ batchSize: 100 })
    expect(validateJobPayload(JOB_NAMES.INDEX_EVENT, { eventId: EVENT_ID })).toEqual({
      eventId: EVENT_ID,
      action: 'UPSERT',
    })
  })

  it('rejects an unknown job name', () => {
    expect(() => validateJobPayload('not-a-job', {})).toThrow(TypeError)
  })

  it('throws a ValidationError naming the bad field', () => {
    const error = (() => {
      try {
        validateJobPayload(JOB_NAMES.SEND_EMAIL, { to: 'nope', template: 'ORDER_CONFIRMATION' })
        return null
      } catch (thrown) {
        return thrown
      }
    })()

    expect(isValidationError(error)).toBe(true)
    expect(error.issues.map((issue) => issue.path)).toContain('to')
  })
})

describe('enqueue helpers', () => {
  it('routes each job to its own queue', async () => {
    const { queues, added } = createFakeQueues()

    await enqueueSendEmail(queues, { to: 'buyer@example.com', template: 'ORDER_CONFIRMATION' })
    await enqueueExpireHolds(queues)
    await enqueueIssueTickets(queues, { orderId: ORDER_ID })
    await enqueueIndexEvent(queues, { eventId: EVENT_ID })

    expect(added.map((entry) => [entry.queue, entry.jobName])).toEqual([
      [QUEUE_NAMES.EMAIL, JOB_NAMES.SEND_EMAIL],
      [QUEUE_NAMES.HOLDS, JOB_NAMES.EXPIRE_HOLDS],
      [QUEUE_NAMES.TICKETS, JOB_NAMES.ISSUE_TICKETS],
      [QUEUE_NAMES.SEARCH, JOB_NAMES.INDEX_EVENT],
    ])
  })

  it('routes a retention rehearsal to its own queue', async () => {
    // Its own queue, not a neighbour's: a rehearsal arriving on the holds or
    // email queue would be a rehearsal somebody enqueued by reaching for the
    // wrong name, and the retention queue is meant to show exactly what was
    // asked for.
    const { queues, added } = createFakeQueues()

    await enqueueSweepRetention(queues)

    expect(added.map((entry) => [entry.queue, entry.jobName])).toEqual([
      [QUEUE_NAMES.RETENTION, JOB_NAMES.SWEEP_RETENTION],
    ])
  })

  it('gives the rehearsal payload no way to ask for execution', () => {
    // The mode is decided by the processor and the database, never by whoever
    // enqueued the job. An unknown key is stripped rather than honoured.
    expect(
      validateJobPayload(JOB_NAMES.SWEEP_RETENTION, { mode: 'EXECUTE', execute: true }),
    ).toEqual({})
  })

  it('never schedules retention on a clock', () => {
    // The absence is the design. A sweep on a timer is the first step towards
    // a deletion on a timer, and the durations are unapproved proposals.
    expect(QUEUE_FOR_JOB[JOB_NAMES.SWEEP_RETENTION]).toBe(QUEUE_NAMES.RETENTION)
    expect(schedulerSource).not.toMatch(/SWEEP_RETENTION/u)
  })

  it('stores the parsed payload, not the raw one', async () => {
    const { queues, added } = createFakeQueues()

    await enqueueSendEmail(queues, {
      to: '  BUYER@Example.COM ',
      template: 'ORDER_CONFIRMATION',
    })

    expect(added[0].data).toEqual({
      to: 'buyer@example.com',
      template: 'ORDER_CONFIRMATION',
      locale: 'en-IN',
      data: {},
    })
  })

  it('rejects an invalid payload before it ever reaches Redis', async () => {
    const { queues, added } = createFakeQueues()

    await expect(enqueueSendEmail(queues, { to: 'buyer@example.com' })).rejects.toThrow()
    await expect(enqueueExpireHolds(queues, { batchSize: 5000 })).rejects.toThrow()
    await expect(enqueueIssueTickets(queues, { orderId: 'nope' })).rejects.toThrow()
    await expect(enqueueIndexEvent(queues, { eventId: EVENT_ID, action: 'NOPE' })).rejects.toThrow()

    expect(added).toHaveLength(0)
  })

  it('derives a deterministic job id for ticket issuance so duplicates collapse', async () => {
    const { queues, added } = createFakeQueues()

    await enqueueIssueTickets(queues, { orderId: ORDER_ID })
    await enqueueIssueTickets(queues, { orderId: ORDER_ID })

    expect(added[0].options.jobId).toBe(`issue-tickets:${ORDER_ID}:1`)
    expect(added[1].options.jobId).toBe(added[0].options.jobId)
  })

  it('lets the caller override the derived job id', async () => {
    const { queues, added } = createFakeQueues()

    await enqueueIssueTickets(queues, { orderId: ORDER_ID }, { jobId: 'manual-replay' })

    expect(added[0].options.jobId).toBe('manual-replay')
  })

  it('forwards per-job options such as a delay', async () => {
    const { queues, added } = createFakeQueues()

    await enqueueExpireHolds(queues, { ticketTypeId: TICKET_TYPE_ID }, { delay: 5000 })

    expect(added[0].options).toEqual({ delay: 5000 })
  })

  it('fails loudly when the queue for a job was not supplied', async () => {
    await expect(
      enqueue({}, JOB_NAMES.SEND_EMAIL, { to: 'buyer@example.com', template: 'EVENT_REMINDER' }),
    ).rejects.toThrow(TypeError)
  })

  it('closes every queue, and tolerates being handed nothing', async () => {
    const { queues, closed } = createFakeQueues()

    await closeQueues(queues)
    await closeQueues(undefined)

    expect(closed.sort()).toEqual([...Object.values(QUEUE_NAMES)].sort())
  })

  it('keeps closing the rest when one queue refuses to close', async () => {
    const { queues, closed } = createFakeQueues()
    queues[QUEUE_NAMES.EMAIL].close = async () => {
      throw new Error('redis gone')
    }

    await expect(closeQueues(queues)).resolves.toBeUndefined()
    expect(closed).toHaveLength(Object.values(QUEUE_NAMES).length - 1)
  })
})
