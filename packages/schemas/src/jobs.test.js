import { describe, expect, it } from 'vitest'

import {
  EMAIL_TEMPLATES,
  JOB_NAMES,
  JOB_SCHEMAS,
  QUEUE_NAMES,
  expireHoldsJobSchema,
  indexEventJobSchema,
  issueTicketsJobSchema,
  jobSchemaFor,
  sendEmailJobSchema,
} from './jobs.js'

const ORDER_ID = 'ckl1a2b3c4d5e6f7g8h9i0jp'
const EVENT_ID = 'ckl1a2b3c4d5e6f7g8h9i0jn'

describe('queue and job names', () => {
  it('are frozen so a typo cannot be patched in at runtime', () => {
    expect(Object.isFrozen(QUEUE_NAMES)).toBe(true)
    expect(Object.isFrozen(JOB_NAMES)).toBe(true)
  })

  it('map every job name to a schema', () => {
    for (const jobName of Object.values(JOB_NAMES)) {
      expect(JOB_SCHEMAS[jobName]).toBeDefined()
    }
    expect(Object.keys(JOB_SCHEMAS)).toHaveLength(Object.values(JOB_NAMES).length)
  })
})

describe('jobSchemaFor', () => {
  it('returns the schema registered for a job name', () => {
    expect(jobSchemaFor(JOB_NAMES.SEND_EMAIL)).toBe(sendEmailJobSchema)
    expect(jobSchemaFor(JOB_NAMES.EXPIRE_HOLDS)).toBe(expireHoldsJobSchema)
  })

  it('returns undefined for an unknown job name', () => {
    expect(jobSchemaFor('not-a-job')).toBeUndefined()
  })

  it('does not fall through to Object.prototype', () => {
    expect(jobSchemaFor('toString')).toBeUndefined()
    expect(jobSchemaFor('constructor')).toBeUndefined()
  })
})

describe('sendEmailJobSchema', () => {
  it('normalises the recipient and defaults locale and data', () => {
    expect(
      sendEmailJobSchema.parse({ to: '  Priya@Example.COM ', template: 'ORDER_CONFIRMATION' }),
    ).toEqual({
      to: 'priya@example.com',
      template: 'ORDER_CONFIRMATION',
      locale: 'en-IN',
      data: {},
    })
  })

  it('accepts template data and related ids', () => {
    const parsed = sendEmailJobSchema.parse({
      to: 'a@b.com',
      template: 'TICKETS_ISSUED',
      subject: 'Your tickets',
      data: { orderReference: 'DE-8F3K2Q', ticketCount: 2 },
      orderId: ORDER_ID,
      eventId: EVENT_ID,
    })
    expect(parsed.data.ticketCount).toBe(2)
    expect(parsed.orderId).toBe(ORDER_ID)
  })

  it('accepts every declared template', () => {
    for (const template of EMAIL_TEMPLATES) {
      expect(sendEmailJobSchema.safeParse({ to: 'a@b.com', template }).success).toBe(true)
    }
  })

  it('rejects an unknown template and a malformed recipient', () => {
    expect(sendEmailJobSchema.safeParse({ to: 'a@b.com', template: 'SPAM' }).success).toBe(false)
    expect(
      sendEmailJobSchema.safeParse({ to: 'nope', template: 'ORDER_CONFIRMATION' }).success,
    ).toBe(false)
  })
})

describe('expireHoldsJobSchema', () => {
  it('defaults the batch size and accepts an empty payload', () => {
    expect(expireHoldsJobSchema.parse({})).toEqual({ batchSize: 100 })
  })

  it('coerces the batch size and normalises now', () => {
    const parsed = expireHoldsJobSchema.parse({
      batchSize: '250',
      now: new Date('2026-08-10T12:00:00Z'),
    })
    expect(parsed).toEqual({ batchSize: 250, now: '2026-08-10T12:00:00.000Z' })
  })

  it('rejects a batch size outside its bounds', () => {
    expect(expireHoldsJobSchema.safeParse({ batchSize: 0 }).success).toBe(false)
    expect(expireHoldsJobSchema.safeParse({ batchSize: 1001 }).success).toBe(false)
  })
})

describe('issueTicketsJobSchema', () => {
  it('requires an order id and defaults the attempt counter', () => {
    expect(issueTicketsJobSchema.parse({ orderId: ORDER_ID })).toEqual({
      orderId: ORDER_ID,
      attempt: 1,
    })
  })

  it('rejects a missing or malformed order id', () => {
    expect(issueTicketsJobSchema.safeParse({}).success).toBe(false)
    expect(issueTicketsJobSchema.safeParse({ orderId: 'nope' }).success).toBe(false)
  })

  it('bounds the retry counter', () => {
    expect(issueTicketsJobSchema.parse({ orderId: ORDER_ID, attempt: '3' }).attempt).toBe(3)
    expect(issueTicketsJobSchema.safeParse({ orderId: ORDER_ID, attempt: 11 }).success).toBe(false)
  })
})

describe('indexEventJobSchema', () => {
  it('defaults the action to UPSERT', () => {
    expect(indexEventJobSchema.parse({ eventId: EVENT_ID })).toEqual({
      eventId: EVENT_ID,
      action: 'UPSERT',
    })
  })

  it('accepts DELETE and rejects anything else', () => {
    expect(indexEventJobSchema.parse({ eventId: EVENT_ID, action: 'DELETE' }).action).toBe('DELETE')
    expect(indexEventJobSchema.safeParse({ eventId: EVENT_ID, action: 'REBUILD' }).success).toBe(
      false,
    )
  })
})
