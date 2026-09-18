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
  RETENTION: 'retention',
})

/** Job names within those queues. */
export const JOB_NAMES = Object.freeze({
  SEND_EMAIL: 'send-email',
  EXPIRE_HOLDS: 'expire-holds',
  ISSUE_TICKETS: 'issue-tickets',
  INDEX_EVENT: 'index-event',
  DRAIN_OUTBOX: 'drain-outbox',
  SWEEP_RETENTION: 'sweep-retention',
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

/**
 * Send whatever the notification outbox has waiting.
 *
 * No message id in the payload, deliberately. A job that named one row would
 * have to be enqueued per message, which puts the queue between the domain and
 * the outbox and gives two things the chance to disagree about what is due. The
 * outbox is the queue; this job is only the clock that reads it.
 */
export const drainOutboxJobSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(50),
  leaseMs: z.coerce.number().int().min(1000).max(600_000).default(60_000),
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

/**
 * A retention rehearsal.
 *
 * Deliberately minimal, and deliberately without a `mode`. A dry run is the
 * only thing this job can ask for: a payload that could request execution would
 * be a payload somebody could enqueue by hand, and the durations it would apply
 * are proposals awaiting legal review rather than settled policy. The processor
 * hard-codes `DRY_RUN` and the database refuses a rehearsal that claims to have
 * changed anything.
 *
 * `retentionClass` narrows the run to one class when given. Absent, every
 * evaluated class is rehearsed.
 */
export const sweepRetentionJobSchema = z.object({
  now: timestampSchema.optional(),
  retentionClass: nonEmptyStringSchema.optional(),
})

/** Map of job name to payload schema, for a worker's dispatch table. */
export const JOB_SCHEMAS = Object.freeze({
  [JOB_NAMES.SEND_EMAIL]: sendEmailJobSchema,
  [JOB_NAMES.EXPIRE_HOLDS]: expireHoldsJobSchema,
  [JOB_NAMES.ISSUE_TICKETS]: issueTicketsJobSchema,
  [JOB_NAMES.INDEX_EVENT]: indexEventJobSchema,
  [JOB_NAMES.DRAIN_OUTBOX]: drainOutboxJobSchema,
  [JOB_NAMES.SWEEP_RETENTION]: sweepRetentionJobSchema,
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
