/**
 * The processor registry: job name to handler.
 *
 * Every processor is a *factory* taking its dependencies and returning
 * `async (job) => result`. Nothing in `processors/` imports a live Prisma
 * client, a Redis connection or a real email adapter — `main.js` owns those and
 * passes them in. That is what makes the whole directory unit-testable with
 * plain objects and no infrastructure, and it is also what lets a deployment
 * swap an adapter without touching job logic.
 *
 * @module @desi-event/worker/processors
 */

import { JOB_NAMES } from '@desi-event/schemas/jobs'

import { createExpireHoldsProcessor } from './expire-holds.js'
import { createIssueTicketsProcessor } from './issue-tickets.js'
import { createSendEmailProcessor } from './send-email.js'
import { createIndexEventProcessor } from './index-event.js'
import { createDrainOutboxProcessor } from './drain-outbox.js'
import { createRetentionSweepProcessor } from './sweep-retention.js'

export { createExpireHoldsProcessor } from './expire-holds.js'
export { createIssueTicketsProcessor } from './issue-tickets.js'
export { createSendEmailProcessor } from './send-email.js'
export { createIndexEventProcessor } from './index-event.js'
export { createDrainOutboxProcessor } from './drain-outbox.js'
export { createRetentionSweepProcessor } from './sweep-retention.js'

/**
 * @typedef {object} ProcessorDeps
 * @property {object} prisma A Prisma client.
 * @property {object} providers A provider registry, or at least `{ email }`.
 * @property {object} [logger] Logger; each processor gets a child bound to its job name.
 * @property {object} [index] A search index implementation, when one exists.
 * @property {string} [workerId] Who this process is, for the outbox leases it takes.
 * @property {boolean} [retentionActivated] Whether this environment may run a retention rehearsal. Defaults to false.
 */

/**
 * Build every processor, keyed by job name.
 *
 * Each processor receives a child logger bound to its job name, so a line in
 * production always says which job produced it without every call site
 * repeating the field.
 *
 * @param {ProcessorDeps} deps Injected dependencies.
 * @returns {Record<string, function(object): Promise<object>>} A map of job name to processor.
 * @throws {TypeError} When `prisma` is missing.
 * @throws {ProviderError} When `providers.email` does not implement the email interface.
 */
export function createProcessors({
  prisma,
  providers,
  logger,
  index,
  workerId,
  retentionActivated = false,
}) {
  /**
   * Derive a logger bound to one job name.
   *
   * @param {string} jobName The job the logger belongs to.
   * @returns {(object|undefined)} A child logger, or `undefined` when no logger was supplied.
   */
  const childFor = (jobName) => logger?.child?.({ job: jobName }) ?? logger

  return {
    [JOB_NAMES.EXPIRE_HOLDS]: createExpireHoldsProcessor({
      prisma,
      logger: childFor(JOB_NAMES.EXPIRE_HOLDS),
    }),
    [JOB_NAMES.ISSUE_TICKETS]: createIssueTicketsProcessor({
      prisma,
      logger: childFor(JOB_NAMES.ISSUE_TICKETS),
    }),
    [JOB_NAMES.SEND_EMAIL]: createSendEmailProcessor({
      email: providers?.email ?? providers,
      logger: childFor(JOB_NAMES.SEND_EMAIL),
    }),
    [JOB_NAMES.INDEX_EVENT]: createIndexEventProcessor({
      index,
      logger: childFor(JOB_NAMES.INDEX_EVENT),
    }),
    [JOB_NAMES.DRAIN_OUTBOX]: createDrainOutboxProcessor({
      prisma,
      providers,
      // Distinct per process, because it is the name on the lease: two
      // processes sharing one would each think they held the other's claims.
      workerId: workerId ?? `worker-${process.pid}`,
      logger: childFor(JOB_NAMES.DRAIN_OUTBOX),
    }),
    [JOB_NAMES.SWEEP_RETENTION]: createRetentionSweepProcessor({
      prisma,
      // Defaulted to false one layer up rather than read from the environment
      // here, so that a caller who forgets to pass it gets the refusing
      // behaviour instead of the counting one. Nothing in `processors/` reads
      // `process.env`, and this is the field most worth keeping that way.
      activated: retentionActivated,
      logger: childFor(JOB_NAMES.SWEEP_RETENTION),
    }),
  }
}
