/**
 * BullMQ job payload schemas.
 *
 * A queued job outlives the process that enqueued it, so the worker validates
 * every payload it pulls off Redis with these schemas rather than trusting the
 * producer. Queue and job names live here too so producer and consumer cannot
 * drift apart over a typo.
 *
 * @module @desi-event/schemas/jobs
 */

import { z } from 'zod'

import { cuidSchema, emailSchema, nonEmptyStringSchema, timestampSchema } from './primitives.js'

/** Queue names, shared by the API (producer) and the worker (consumer). */
export const QUEUE_NAMES = Object.freeze({
  EMAIL: 'email',
  HOLDS: 'holds',
  TICKETS: 'tickets',
  SEARCH: 'search',
})

/** Job names within those queues. */
export const JOB_NAMES = Object.freeze({
  SEND_EMAIL: 'send-email',
  EXPIRE_HOLDS: 'expire-holds',
  ISSUE_TICKETS: 'issue-tickets',
  INDEX_EVENT: 'index-event',
})

/** Transactional email templates the worker knows how to render. */
export const EMAIL_TEMPLATES = Object.freeze([
  'ORDER_CONFIRMATION',
  'TICKETS_ISSUED',
  'ORDER_CANCELLED',
  'EVENT_REMINDER',
  'WAITLIST_AVAILABLE',
  'EMAIL_VERIFICATION',
  'PASSWORD_RESET',
])

/** Template identifier for a transactional email. */
export const emailTemplateSchema = z.enum([...EMAIL_TEMPLATES])

/** Send one transactional email. */
export const sendEmailJobSchema = z.object({
  to: emailSchema,
  template: emailTemplateSchema,
  subject: nonEmptyStringSchema.optional(),
  locale: z.string().min(2).max(16).default('en-IN'),
  data: z.record(z.string(), z.unknown()).default({}),
  orderId: cuidSchema.optional(),
  eventId: cuidSchema.optional(),
})

/** Sweep expired checkout holds back into availability. */
export const expireHoldsJobSchema = z.object({
  now: timestampSchema.optional(),
  batchSize: z.coerce.number().int().min(1).max(1000).default(100),
  ticketTypeId: cuidSchema.optional(),
})

/** Materialise `Ticket` rows for every item of a paid order. */
export const issueTicketsJobSchema = z.object({
  orderId: cuidSchema,
  attempt: z.coerce.number().int().min(1).max(10).default(1),
  requestedBy: cuidSchema.optional(),
})

/** Add, refresh or drop an event in the search index. */
export const indexEventJobSchema = z.object({
  eventId: cuidSchema,
  action: z.enum(['UPSERT', 'DELETE']).default('UPSERT'),
  reason: nonEmptyStringSchema.optional(),
})

/** Map of job name to payload schema, for a worker's dispatch table. */
export const JOB_SCHEMAS = Object.freeze({
  [JOB_NAMES.SEND_EMAIL]: sendEmailJobSchema,
  [JOB_NAMES.EXPIRE_HOLDS]: expireHoldsJobSchema,
  [JOB_NAMES.ISSUE_TICKETS]: issueTicketsJobSchema,
  [JOB_NAMES.INDEX_EVENT]: indexEventJobSchema,
})

/**
 * Look up the payload schema for a job name.
 *
 * @param {string} jobName One of the values in {@link JOB_NAMES}.
 * @returns {object|undefined} The matching Zod schema, or `undefined` if unknown.
 */
export function jobSchemaFor(jobName) {
  return Object.prototype.hasOwnProperty.call(JOB_SCHEMAS, jobName)
    ? JOB_SCHEMAS[jobName]
    : undefined
}
