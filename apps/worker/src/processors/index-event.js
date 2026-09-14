/**
 * Search indexing — deliberately a stub, deliberately real.
 *
 * Desi-Event has no search index yet; event discovery is served by PostgreSQL
 * queries. When that stops scaling the answer will be an external index
 * (OpenSearch, Typesense, Meilisearch), and the expensive part of adopting one
 * is never the client library — it is finding every write path that should have
 * told the index something and retrofitting a queue into it.
 *
 * So the queue exists now, the API can enqueue against it now, and this
 * processor logs what it *would* have done. Wiring a real index later is
 * implementing one function: pass an `index` with `upsert(eventId)` and
 * `delete(eventId)` to the factory. Nothing upstream changes.
 *
 * @module @desi-event/worker/processors/index-event
 */

import { JOB_NAMES, indexEventJobSchema } from '@desi-event/schemas'

import { RetryableJobError, WORKER_ERROR_CODES, parseJobPayload } from '../errors.js'

/**
 * @typedef {object} SearchIndex
 * @property {function(string, object=): Promise<unknown>} upsert Add or refresh one event document.
 * @property {function(string): Promise<unknown>} delete Remove one event document.
 */

/**
 * @typedef {object} IndexEventResult
 * @property {string} eventId The event the job named.
 * @property {string} action `UPSERT` or `DELETE`.
 * @property {boolean} indexed Whether a real index was actually written to.
 * @property {(string|undefined)} reason The producer's stated reason, carried through for debugging.
 */

/**
 * Build the `index-event` processor.
 *
 * @param {object} [deps] Injected dependencies.
 * @param {object} [deps.logger] Logger; the stub's only observable effect.
 * @param {SearchIndex} [deps.index] A real index. Omitted, the job is a logged no-op.
 * @returns {function(object): Promise<IndexEventResult>} An async BullMQ processor.
 */
export function createIndexEventProcessor({ logger, index } = {}) {
  /**
   * Record (and, when an index is wired in, perform) one index update.
   *
   * @param {object} job The BullMQ job; only `job.data` is read.
   * @returns {Promise<IndexEventResult>} What was done, or would have been done.
   * @throws {PermanentJobError} When the payload does not satisfy `indexEventJobSchema`.
   * @throws {RetryableJobError} When a wired-in index failed; index writes are always worth retrying.
   */
  return async function indexEvent(job) {
    const payload = parseJobPayload(indexEventJobSchema, job?.data ?? {}, JOB_NAMES.INDEX_EVENT)
    const { eventId, action, reason } = payload

    if (!index) {
      logger?.info?.(
        { eventId, action, reason, indexed: false },
        'search index update skipped — no index is configured (see processors/index-event.js)',
      )
      return { eventId, action, indexed: false, reason }
    }

    try {
      if (action === 'DELETE') await index.delete(eventId)
      else await index.upsert(eventId, payload)
    } catch (error) {
      // A search index is a cache. Every failure here is transient by
      // definition: the next write re-enqueues the same event anyway.
      throw new RetryableJobError(
        `Search index ${action} failed for event "${eventId}": ${/** @type {Error} */ (error).message}`,
        {
          code: WORKER_ERROR_CODES.PROVIDER_UNAVAILABLE,
          jobName: JOB_NAMES.INDEX_EVENT,
          details: { eventId, action },
          cause: error,
        },
      )
    }

    logger?.info?.({ eventId, action, reason, indexed: true }, 'search index updated')

    return { eventId, action, indexed: true, reason }
  }
}
