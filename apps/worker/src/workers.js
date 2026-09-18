/**
 * `Worker` construction: concurrency, lock durations, and the event logging
 * that makes a background process observable at all.
 *
 * One BullMQ `Worker` per queue. They share the single Redis connection — BullMQ
 * duplicates it internally for its blocking reads — and each one dispatches to
 * exactly one processor, because a queue in this system holds exactly one kind
 * of job.
 *
 * @module @desi-event/worker/workers
 */

import { Worker } from 'bullmq'
import { JOB_NAMES, QUEUE_NAMES } from '@desi-event/schemas/jobs'

import { DEFAULT_QUEUE_PREFIX, QUEUE_FOR_JOB, jobOptionsFor } from './queues.js'

/**
 * Concurrency per queue, expressed as a function of the configured default so
 * that `WORKER_CONCURRENCY` remains a single meaningful dial.
 *
 * The hold sweep is pinned to 1 on purpose: it is a batch job over a shared
 * table, so a second copy running concurrently would select the same rows, lose
 * the `status: ACTIVE` guard race, and do nothing but add database load.
 *
 * The retention rehearsal is pinned to 1 for a different reason. It cannot race
 * anything — it only counts — but two copies counting the same classes at the
 * same instant write two sweep rows apiece, and the evidence table is meant to
 * read as a history of runs rather than a history of workers. One at a time
 * also keeps a rehearsal's count queries off the same tables the site is
 * serving from, which is the whole reason it is a background job.
 *
 * The rest are I/O-bound on things that parallelise fine — an SMTP round trip,
 * a short transaction, an index write.
 *
 * @param {string} queueName The queue.
 * @param {number} configured The value of `WORKER_CONCURRENCY`.
 * @returns {number} Jobs this worker may process at once.
 */
export function concurrencyFor(queueName, configured) {
  if (queueName === QUEUE_NAMES.HOLDS) return 1
  if (queueName === QUEUE_NAMES.RETENTION) return 1
  return Math.max(1, configured)
}

/**
 * Per-queue worker options beyond concurrency.
 *
 * `lockDuration` is how long BullMQ believes a job is still being worked on
 * before declaring it stalled and handing it to another worker. The default of
 * 30s is fine for email but too tight for ticket issuance, which holds a row
 * lock and may queue behind another transaction; a stalled-and-reclaimed job
 * there means two workers minting tickets for one order, which the processor
 * survives but should not have to.
 *
 * @type {Readonly<Record<string, Record<string, unknown>>>}
 */
export const QUEUE_WORKER_OPTIONS = Object.freeze({
  [QUEUE_NAMES.TICKETS]: Object.freeze({ lockDuration: 60_000, maxStalledCount: 2 }),
  [QUEUE_NAMES.HOLDS]: Object.freeze({ lockDuration: 60_000 }),
})

/**
 * @typedef {object} WorkerHandle
 * @property {string} name The queue this worker consumes.
 * @property {Function} close Stop accepting jobs and wait for in-flight ones.
 * @property {Function} on Subscribe to worker events.
 */

/**
 * Attach the logging every deployment wants: one line per completion, one per
 * failure with the error, and one per worker-level error.
 *
 * @param {WorkerHandle} worker The worker to instrument.
 * @param {string} queueName The queue name, bound onto every line.
 * @param {object} [logger] The logger.
 * @returns {WorkerHandle} The same worker.
 */
export function instrumentWorker(worker, queueName, logger) {
  worker.on('completed', (job, result) => {
    logger?.info?.({ queue: queueName, job: job?.name, jobId: job?.id, result }, 'job completed')
  })

  worker.on('failed', (job, error) => {
    // `attemptsMade < attempts` means BullMQ will try again, so this is a
    // warning; the final failure is the one worth paging on. When the attempt
    // count is unknown the failure is treated as final, so an odd event is
    // loud rather than quietly filed as "we'll get it next time".
    const attemptsMade = job?.attemptsMade
    const willRetry = Number.isInteger(attemptsMade) && attemptsMade < (job?.opts?.attempts ?? 1)
    const level = willRetry ? 'warn' : 'error'

    logger?.[level]?.(
      {
        queue: queueName,
        job: job?.name,
        jobId: job?.id,
        attemptsMade,
        willRetry,
        err: error,
      },
      willRetry ? 'job failed; will retry' : 'job failed permanently',
    )
  })

  // Worker-level errors (a lost Redis connection, a script failure) are not
  // tied to a job. Without a listener, BullMQ's EventEmitter would make them
  // uncaught and take the process down.
  worker.on('error', (error) => {
    logger?.error?.({ queue: queueName, err: error }, 'worker error')
  })

  return worker
}

/**
 * Create one worker for a queue.
 *
 * @param {object} options Construction options.
 * @param {string} options.queueName One of {@link QUEUE_NAMES}.
 * @param {function(object): Promise<unknown>} options.processor The job handler.
 * @param {object} options.connection The shared Redis connection.
 * @param {string} [options.prefix] BullMQ key prefix; must match the queue's.
 * @param {number} [options.concurrency] Configured default concurrency.
 * @param {object} [options.logger] Logger for job events.
 * @returns {WorkerHandle} A running worker.
 * @throws {TypeError} When `processor` is not a function.
 */
export function createWorker({
  queueName,
  processor,
  connection,
  prefix = DEFAULT_QUEUE_PREFIX,
  concurrency = 5,
  logger,
}) {
  if (typeof processor !== 'function') {
    throw new TypeError(
      `Queue "${queueName}" was given a ${typeof processor} instead of a processor`,
    )
  }

  const { removeOnComplete, removeOnFail } = jobOptionsFor(queueName)

  const worker = new Worker(queueName, processor, {
    connection,
    prefix,
    concurrency: concurrencyFor(queueName, concurrency),
    // Repeated here as well as on the queue: a job added by an older producer,
    // or replayed by hand, would otherwise be retained forever.
    removeOnComplete: typeof removeOnComplete === 'object' ? removeOnComplete : undefined,
    removeOnFail: typeof removeOnFail === 'object' ? removeOnFail : undefined,
    ...(QUEUE_WORKER_OPTIONS[queueName] ?? {}),
  })

  return instrumentWorker(worker, queueName, logger)
}

/**
 * Create one worker per job in the processor map.
 *
 * @param {object} options Construction options.
 * @param {Record<string, function(object): Promise<unknown>>} options.processors Job name to processor, as built by `createProcessors`.
 * @param {object} options.connection The shared Redis connection.
 * @param {string} [options.prefix] BullMQ key prefix.
 * @param {number} [options.concurrency] Configured default concurrency.
 * @param {object} [options.logger] Logger for job events.
 * @returns {WorkerHandle[]} Every running worker.
 * @throws {TypeError} When a job name has no queue, or a processor is not a function.
 */
export function createWorkers({ processors, connection, prefix, concurrency, logger }) {
  return Object.values(JOB_NAMES)
    .filter((jobName) => processors?.[jobName])
    .map((jobName) => {
      const queueName = QUEUE_FOR_JOB[jobName]

      if (!queueName) throw new TypeError(`Job "${jobName}" has no queue`)

      return createWorker({
        queueName,
        processor: processors[jobName],
        connection,
        prefix,
        concurrency,
        logger,
      })
    })
}

/**
 * Close every worker, waiting for in-flight jobs to finish.
 *
 * `Promise.allSettled` rather than `Promise.all`: one worker failing to close
 * must not leave the others running, because the process is on its way out.
 *
 * @param {WorkerHandle[]} workers The workers to close.
 * @returns {Promise<void>} Resolves once each worker has closed or failed to.
 */
export async function closeWorkers(workers) {
  await Promise.allSettled((workers ?? []).map((worker) => worker.close()))
}
