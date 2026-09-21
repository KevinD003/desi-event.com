/**
 * How a rehearsal reports the step that gave way, without carrying what the
 * database said while it gave way.
 *
 * ## Why a dedicated error rather than a tagged one
 *
 * The obvious implementation is to catch whatever the driver threw and attach
 * a code to it:
 *
 * ```js
 * catch (error) {
 *   error.retentionFailureCode = 'CANDIDATE_COUNT_FAILED'   // don't
 *   throw error
 * }
 * ```
 *
 * That mutates a value of unknown type. ES modules are strict, so assigning to
 * a frozen object raises a `TypeError`, and assigning to a thrown string or
 * `null` raises one too — and the `TypeError` then *replaces* the real failure,
 * so the evidence row records `UNEXPECTED` for a cause the code had already
 * identified correctly. A failure path that destroys its own diagnosis under
 * load is worse than no diagnosis.
 *
 * So the cause is wrapped, never written to. The original is kept on `cause`
 * where a logger can reach it, and it is the wrapper — not the original — that
 * decides what the operator's row will say.
 *
 * ## Why the driver message never reaches the row
 *
 * `RetentionSweep.failureCode` is rendered on `/retention`. A message from a
 * failed count against a table of sessions or login attempts is exactly the
 * kind of string that arrives carrying a fragment of a row, and a column that
 * is sometimes a vocabulary and sometimes a sentence is a column nobody can
 * filter on. The message stays in the logs.
 *
 * @module worker/retention/failures
 */

import { RETENTION_FAILURE_CODES } from '@desi-event/schemas'

export { RETENTION_FAILURE_CODES }

/**
 * A step of the rehearsal that did not complete.
 *
 * Not one of the worker's `PermanentJobError` / `RetryableJobError` pair, and
 * on purpose: those answer "should BullMQ retry this job", which is decided
 * once for the whole job after every class has had its turn. This answers "what
 * does the operator's row say about this class", which is decided per class.
 *
 * @augments Error
 */
export class RetentionStepError extends Error {
  /**
   * @param {string} message What failed, in words, for the log.
   * @param {object} options Options.
   * @param {string} options.failureCode One of {@link RETENTION_FAILURE_CODES}.
   * @param {unknown} [options.cause] The error underneath, kept rather than copied from.
   */
  constructor(message, { failureCode, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'RetentionStepError'
    /** @type {string} */
    this.failureCode = failureCode ?? RETENTION_FAILURE_CODES.UNEXPECTED
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, RetentionStepError)
    }
  }
}

/**
 * The code to record for a failure, whatever was actually thrown.
 *
 * Total by construction: anything that is not one of ours is `UNEXPECTED`,
 * because a failure with no row is the one outcome this surface cannot afford.
 *
 * @param {unknown} error Whatever was caught.
 * @returns {string} One of {@link RETENTION_FAILURE_CODES}.
 */
export function failureCodeFor(error) {
  const code = error instanceof RetentionStepError ? error.failureCode : null

  return typeof code === 'string' && code in RETENTION_FAILURE_CODES
    ? code
    : RETENTION_FAILURE_CODES.UNEXPECTED
}

/**
 * Run a step, and rewrap anything it throws with the code for that step.
 *
 * A `RetentionStepError` passes through unchanged: the inner step already knows
 * what it was doing better than its caller does.
 *
 * @param {string} failureCode One of {@link RETENTION_FAILURE_CODES}.
 * @param {string} what The step, in words, for the message.
 * @param {function(): Promise<any>} step The step.
 * @returns {Promise<any>} Whatever the step returned.
 */
export async function inStep(failureCode, what, step) {
  try {
    return await step()
  } catch (error) {
    if (error instanceof RetentionStepError) throw error

    throw new RetentionStepError(what, { failureCode, cause: error })
  }
}
