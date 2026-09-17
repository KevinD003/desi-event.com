/**
 * The privacy request lifecycle: raise, confirm, execute, cancel.
 *
 * Everything irreversible in this system passes through here, so the module is
 * written around what must be true rather than around what is convenient.
 *
 * **The browser decides nothing.** It supplies a subject id and, later, a
 * confirmation phrase the server itself issued. Organisation, authority,
 * eligibility, hold outcome, idempotency key, policy version and final state are
 * all produced on this side. There is deliberately no field a caller can send
 * that shortens the step-up window, names a different organisation, asserts that
 * a hold was cleared, or declares the outcome.
 *
 * **Holds are evaluated twice.** Once when the request is raised, so an operator
 * is not invited to confirm something that cannot proceed, and again at the
 * moment of execution, because the interval between the two is exactly when
 * counsel places a hold. Only the second evaluation is load-bearing.
 *
 * **A refusal is a record, not an exception.** Every refusal writes a
 * `PrivacyAuditEvent` carrying opaque ids, a reason code and a decision — and no
 * value, no address, no sentence. Refusals to callers are non-enumerating: a
 * subject who is not in this organisation and a subject who does not exist get
 * the same 404 with the same words.
 *
 * **One transaction.** The redaction itself commits or it does not; there is no
 * half-redacted person to reconcile afterwards. That is affordable only because
 * nothing on this path calls a provider. The `PrivacyRequest` lease columns
 * exist for the asynchronous path Phase 3 adds; this phase leaves them null and
 * does not pretend otherwise.
 *
 * @module @desi-event/api/lib/privacy-requests
 */

import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'

import { AUDIT_ACTIONS } from './audit.js'
import { conflict, notFound, unprocessable } from './errors.js'
import {
  PRIVACY_OUTCOMES,
  PRIVACY_POLICY_VERSION,
  assertSubjectBelongsToOrganization,
  loadOrganizationForPrivacy,
} from './privacy.js'
import { HOLD_DECISIONS, evaluateHolds } from './privacy-holds.js'
import { previewScope, redactSubject, subjectAddress } from './privacy-redaction.js'

/**
 * How long a server-issued confirmation phrase stays usable.
 *
 * Ten minutes, and the number is chosen against the step-up window rather than
 * independently of it. `PRIVACY_ERASURE` gives two minutes of fresh
 * authentication, so a phrase that outlived it would let an operator confirm
 * long after the authentication that authorised them had gone stale; a phrase
 * that expired faster would make the step-up window unusable. Ten minutes is the
 * outer bound on the whole exchange, and the two-minute step-up is re-checked at
 * confirm time regardless.
 *
 * @type {number}
 */
export const CONFIRMATION_WINDOW_MS = 10 * 60 * 1000

/**
 * Bytes of entropy in a confirmation phrase.
 *
 * Nine bytes rendered as eighteen hex characters. The phrase is displayed and
 * retyped, so length is a usability cost; it is also single-use, short-lived and
 * only accepted from an already-authenticated, already-stepped-up,
 * already-authorised caller, so its job is to stop an accidental confirmation
 * rather than to resist an offline search.
 *
 * @type {number}
 */
const CONFIRMATION_BYTES = 9

/**
 * Failure codes, from a closed vocabulary.
 *
 * A driver's message quotes the row that failed, and the row that failed is the
 * person. These never do.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const PRIVACY_FAILURE_CODES = Object.freeze({
  REDACTION_WRITE_FAILED: 'REDACTION_WRITE_FAILED',
  HOLD_APPEARED_DURING_EXECUTION: 'HOLD_APPEARED_DURING_EXECUTION',
})

/**
 * Hash a confirmation phrase.
 *
 * @param {string} phrase The phrase.
 * @returns {string} Its SHA-256 digest, hex.
 */
export function confirmationDigest(phrase) {
  return createHash('sha256').update(String(phrase)).digest('hex')
}

/**
 * Compare two digests without leaking where they first differ.
 *
 * @param {string} left One digest.
 * @param {string} right The other.
 * @returns {boolean} Whether they match.
 */
function digestsMatch(left, right) {
  const a = Buffer.from(String(left), 'utf8')
  const b = Buffer.from(String(right), 'utf8')

  if (a.length !== b.length) return false

  return timingSafeEqual(a, b)
}

/**
 * Map a hold decision to the outcome code that records it.
 *
 * @param {string} decision A `HOLD_DECISIONS` value.
 * @returns {string} A `PRIVACY_OUTCOMES` value.
 */
function outcomeForDecision(decision) {
  if (decision === HOLD_DECISIONS.LEGAL_HOLD_ACTIVE) return PRIVACY_OUTCOMES.REFUSED_LEGAL_HOLD
  if (decision === HOLD_DECISIONS.FRAUD_HOLD_ACTIVE) return PRIVACY_OUTCOMES.REFUSED_FRAUD_HOLD

  return PRIVACY_OUTCOMES.REFUSED_OPEN_PROCESS
}

/**
 * Write one privacy audit event.
 *
 * `PrivacyAuditEvent` is append-only at the database
 * (`desi_privacy_audit_event_immutable`), so this function is the only way a row
 * ever enters the table and there is no path that edits one afterwards.
 *
 * `detail` is restricted by convention here and by test in
 * `apps/api/tests/privacy-audit.test.js`: category names, counts, closed-
 * vocabulary codes. Never a value, never a message, never a payload.
 *
 * @param {object} tx A Prisma client or transaction client.
 * @param {object} params The event.
 * @param {string} params.action One of the privacy actions in `AUDIT_ACTIONS`.
 * @param {string|null} params.actorId Who acted, or null for the system.
 * @param {string} params.organizationId The organisation.
 * @param {string|null} [params.privacyRequestId] The request, when there is one.
 * @param {string} params.targetId The subject's row id.
 * @param {string} params.reasonCode From a closed vocabulary.
 * @param {string} params.holdDecision A `HOLD_DECISIONS` value.
 * @param {string|null} [params.idempotencyKey] Hashed before storage, never stored raw.
 * @param {string} params.result A `PrivacyAuditResult` value.
 * @param {string} params.correlationId Ties one attempt's events together.
 * @param {object|null} [params.detail] Counts and codes only.
 * @returns {Promise<object>} The written row.
 */
export async function recordPrivacyAudit(tx, params) {
  const {
    action,
    actorId,
    organizationId,
    privacyRequestId = null,
    targetId,
    reasonCode,
    holdDecision,
    idempotencyKey = null,
    result,
    correlationId,
    detail = null,
  } = params

  return tx.privacyAuditEvent.create({
    data: {
      action,
      actorId,
      organizationId,
      privacyRequestId,
      targetId,
      targetType: 'User',
      policyVersion: PRIVACY_POLICY_VERSION,
      reasonCode,
      holdDecision,
      idempotencyKeyHash: idempotencyKey ? confirmationDigest(idempotencyKey) : null,
      result,
      correlationId,
      detail,
    },
  })
}

/**
 * Raise a privacy request.
 *
 * Refuses before creating a row when a hold or an open process already blocks
 * the subject, and records the refusal. Creating a row that could never proceed
 * would be worse than refusing: `PrivacyRequest_one_in_flight_per_subject_key`
 * permits one live request per subject, so a stuck row would lock the subject
 * out of asking again.
 *
 * Returns the confirmation phrase **once**, in this response and nowhere else.
 * Only its digest is stored, so a leaked row cannot be used to confirm anything.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} params Parameters.
 * @param {string} params.organizationId The organisation named in the path.
 * @param {string} params.subjectUserId The data subject.
 * @param {object} params.actor The authenticated caller.
 * @param {string} params.reason A `PRIVACY_REASONS` value.
 * @param {Date} params.now The instant.
 * @returns {Promise<{request: object, confirmationPhrase: string}>} The request and its phrase.
 * @throws {Error} 404 for an unknown organisation or an out-of-scope subject; 409 when blocked or already in flight.
 */
export async function raisePrivacyRequest(prisma, params) {
  const { organizationId, subjectUserId, actor, reason, now } = params

  await loadOrganizationForPrivacy(prisma, organizationId)
  await assertSubjectBelongsToOrganization(prisma, { organizationId, subjectUserId })

  const correlationId = randomUUID()

  // The address goes into the evaluation because one of the refusal grounds is
  // matched on it rather than on an id: an invitation sent to somebody who had
  // no account yet carries only `toEmail`. See `findOpenProcess`.
  const subjectEmail = await subjectAddress(prisma, subjectUserId)
  const evaluation = await evaluateHolds(prisma, {
    organizationId,
    subjectUserId,
    subjectEmail,
    now,
  })

  if (evaluation.decision !== HOLD_DECISIONS.NONE_ACTIVE) {
    await recordPrivacyAudit(prisma, {
      action: AUDIT_ACTIONS.PRIVACY_REQUEST_REFUSED,
      actorId: actor.id,
      organizationId,
      targetId: subjectUserId,
      reasonCode: outcomeForDecision(evaluation.decision),
      holdDecision: evaluation.decision,
      result: 'REFUSED_HOLD',
      correlationId,
      detail: evaluation.openProcessCode ? { openProcess: evaluation.openProcessCode } : null,
    })

    throw conflict('That person’s data cannot be redacted at the moment.', {
      code: outcomeForDecision(evaluation.decision),
    })
  }

  const confirmationPhrase = randomBytes(CONFIRMATION_BYTES).toString('hex')
  const scope = await previewScope(prisma, { organizationId, subjectUserId })

  let request

  try {
    request = await prisma.privacyRequest.create({
      data: {
        organizationId,
        subjectUserId,
        requestedById: actor.id,
        state: 'REQUESTED',
        reason,
        idempotencyKey: randomUUID(),
        confirmationHash: confirmationDigest(confirmationPhrase),
        confirmationExpiresAt: new Date(now.getTime() + CONFIRMATION_WINDOW_MS),
        policyVersion: PRIVACY_POLICY_VERSION,
        correlationId,
        holdDecision: HOLD_DECISIONS.NONE_ACTIVE,
        scope,
      },
    })
  } catch (error) {
    // `PrivacyRequest_one_in_flight_per_subject_key` is a partial unique index
    // over the three live states. Hitting it means somebody else raised a
    // request for this subject first, which is a conflict rather than a fault.
    if (error?.code === 'P2002') {
      await recordPrivacyAudit(prisma, {
        action: AUDIT_ACTIONS.PRIVACY_REQUEST_REFUSED,
        actorId: actor.id,
        organizationId,
        targetId: subjectUserId,
        reasonCode: 'ALREADY_IN_FLIGHT',
        holdDecision: HOLD_DECISIONS.NONE_ACTIVE,
        result: 'REFUSED_CONFLICT',
        correlationId,
      })

      throw conflict('A redaction request for that person is already open.', {
        code: 'ALREADY_IN_FLIGHT',
      })
    }

    throw error
  }

  await recordPrivacyAudit(prisma, {
    action: AUDIT_ACTIONS.PRIVACY_REQUEST_RAISED,
    actorId: actor.id,
    organizationId,
    privacyRequestId: request.id,
    targetId: subjectUserId,
    reasonCode: reason,
    holdDecision: HOLD_DECISIONS.NONE_ACTIVE,
    idempotencyKey: request.idempotencyKey,
    result: 'REQUESTED',
    correlationId,
    detail: { categories: scope.length },
  })

  return { request, confirmationPhrase }
}

/**
 * Load a request this organisation owns, or refuse indistinguishably.
 *
 * @param {object} prisma A Prisma client or transaction client.
 * @param {object} params Parameters.
 * @param {string} params.organizationId The organisation named in the path.
 * @param {string} params.requestId The request.
 * @returns {Promise<object>} The request row.
 * @throws {Error} 404 when it belongs to another organisation or does not exist.
 */
export async function loadPrivacyRequest(prisma, { organizationId, requestId }) {
  const request = await prisma.privacyRequest.findFirst({
    where: { id: requestId, organizationId },
  })

  if (!request) throw notFound('No such privacy request.')

  return request
}

/**
 * Confirm a request and, if everything still holds, execute it.
 *
 * The order of checks is the security argument, and it is deliberate:
 *
 * 1. **Already finished** — a replay returns the original outcome and writes
 *    nothing. This comes first so a duplicate submission can never be read as a
 *    fresh attempt at a stale phrase.
 * 2. **Still confirmable** — a terminal or already-confirmed request refuses.
 * 3. **Phrase valid and unexpired** — compared as digests, in constant time.
 * 4. **Holds, re-evaluated** — the load-bearing one. Whatever was true when the
 *    request was raised is irrelevant; what matters is now.
 * 5. **Redact** — inside one transaction, with the state machine walked through
 *    `QUEUED` and `PROCESSING` so the database's own transition trigger checks
 *    every step.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} params Parameters.
 * @param {string} params.organizationId The organisation named in the path.
 * @param {string} params.requestId The request.
 * @param {string} params.confirmationPhrase What the operator typed.
 * @param {object} params.actor The authenticated caller.
 * @param {Date} params.now The instant.
 * @returns {Promise<object>} The request in its final state.
 * @throws {Error} 404, 409 or 422 as described above.
 */
export async function confirmPrivacyRequest(prisma, params) {
  const { organizationId, requestId, confirmationPhrase, actor, now } = params

  const request = await loadPrivacyRequest(prisma, { organizationId, requestId })

  // A replay. Return what happened the first time; do not redact twice and do
  // not report a stale phrase against a request that is already finished.
  if (request.state === 'COMPLETED') return request

  if (request.state !== 'REQUESTED') {
    throw conflict('That request is no longer awaiting confirmation.', { state: request.state })
  }

  if (request.confirmedAt) {
    throw conflict('That confirmation was already used.', { state: request.state })
  }

  if (request.confirmationExpiresAt <= now) {
    await recordPrivacyAudit(prisma, {
      action: AUDIT_ACTIONS.PRIVACY_REQUEST_REFUSED,
      actorId: actor.id,
      organizationId,
      privacyRequestId: request.id,
      targetId: request.subjectUserId,
      reasonCode: PRIVACY_OUTCOMES.CONFIRMATION_LAPSED,
      holdDecision: request.holdDecision,
      result: 'REFUSED_CONFLICT',
      correlationId: request.correlationId,
    })

    throw conflict('That confirmation has expired. Raise the request again.', {
      code: PRIVACY_OUTCOMES.CONFIRMATION_LAPSED,
    })
  }

  if (!digestsMatch(confirmationDigest(confirmationPhrase), request.confirmationHash)) {
    await recordPrivacyAudit(prisma, {
      action: AUDIT_ACTIONS.PRIVACY_REQUEST_REFUSED,
      actorId: actor.id,
      organizationId,
      privacyRequestId: request.id,
      targetId: request.subjectUserId,
      reasonCode: 'CONFIRMATION_MISMATCH',
      holdDecision: request.holdDecision,
      result: 'REFUSED_CONFLICT',
      correlationId: request.correlationId,
    })

    throw unprocessable('That confirmation does not match.', { field: 'confirmationPhrase' })
  }

  const evaluation = await evaluateHolds(prisma, {
    organizationId,
    subjectUserId: request.subjectUserId,
    subjectEmail: await subjectAddress(prisma, request.subjectUserId),
    now,
  })

  if (evaluation.decision !== HOLD_DECISIONS.NONE_ACTIVE) {
    return refuseOnHold(prisma, { request, evaluation, actor, now })
  }

  return executeRedaction(prisma, { request, actor, now })
}

/**
 * Record a hold that appeared between raising and confirming.
 *
 * A **legal or fraud** hold ends the request: `HELD` is terminal, it names the
 * hold that caused it, and a new request may be raised once the hold is lifted.
 *
 * An **open process** does not end it. The condition is transient by nature — an
 * invitation settles, a refund completes — so the request stays `REQUESTED` and
 * the operator may confirm again once it clears. Ending it would throw away a
 * confirmation the operator has already been given, for a reason that will stop
 * being true on its own.
 *
 * There is a second reason the two are treated differently, and it is worth
 * recording rather than leaving to be discovered: the Phase 1 constraint
 * `privacy_request_held_names_its_hold` requires `heldByHoldId IS NOT NULL`
 * whenever the state is `HELD`, and an open process has no hold row to name. The
 * `PrivacyRequestState.HELD` documentation says the state covers "a legal or
 * fraud hold **or an open process**", so the constraint and the enum's own
 * comment disagree. This code obeys the constraint. The disagreement is reported
 * in the Phase 2 report as a defect for the owner rather than resolved here by
 * rewriting a database constraint.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} params Parameters.
 * @param {object} params.request The request row.
 * @param {object} params.evaluation The hold evaluation.
 * @param {object} params.actor The caller.
 * @param {Date} params.now The instant.
 * @returns {Promise<object>} The request row.
 * @throws {Error} 409 for an open process, which leaves the request open.
 */
async function refuseOnHold(prisma, { request, evaluation, actor, now }) {
  const outcomeCode = outcomeForDecision(evaluation.decision)

  await recordPrivacyAudit(prisma, {
    action: AUDIT_ACTIONS.PRIVACY_REQUEST_REFUSED,
    actorId: actor.id,
    organizationId: request.organizationId,
    privacyRequestId: request.id,
    targetId: request.subjectUserId,
    reasonCode: outcomeCode,
    holdDecision: evaluation.decision,
    idempotencyKey: request.idempotencyKey,
    result: 'REFUSED_HOLD',
    correlationId: request.correlationId,
    detail: evaluation.openProcessCode ? { openProcess: evaluation.openProcessCode } : null,
  })

  if (evaluation.decision === HOLD_DECISIONS.OPEN_PROCESS) {
    throw conflict('That person’s data is still in use by an open process.', {
      code: outcomeCode,
    })
  }

  return prisma.privacyRequest.update({
    where: { id: request.id },
    data: {
      state: 'HELD',
      holdDecision: evaluation.decision,
      heldByHoldId: evaluation.holdId,
      outcomeCode,
      lastAttemptAt: now,
    },
  })
}

/**
 * Walk the state machine and redact, in one transaction.
 *
 * `QUEUED` and `PROCESSING` are written even though no observer can ever see
 * them from outside the transaction. That is the point: each write engages
 * `desi_privacy_request_state_transition`, so the database checks the same
 * sequence the service believes it is following, and a future refactor that
 * skips a step fails loudly instead of quietly.
 *
 * A failure rolls the whole transaction back — including the state changes — and
 * is then recorded as `FAILED_SAFE` in a **separate** transaction, because a
 * record written inside the rolled-back one would roll back with it.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} params Parameters.
 * @param {object} params.request The request row.
 * @param {object} params.actor The caller.
 * @param {Date} params.now The instant.
 * @returns {Promise<object>} The completed request.
 * @throws {Error} Rethrows after recording a safe failure.
 */
async function executeRedaction(prisma, { request, actor, now }) {
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.privacyRequest.update({
        where: { id: request.id },
        data: { state: 'QUEUED', confirmedAt: now, holdDecision: HOLD_DECISIONS.NONE_ACTIVE },
      })

      await tx.privacyRequest.update({
        where: { id: request.id },
        data: {
          state: 'PROCESSING',
          startedAt: now,
          attempts: { increment: 1 },
          lastAttemptAt: now,
        },
      })

      await recordPrivacyAudit(tx, {
        action: AUDIT_ACTIONS.PRIVACY_REQUEST_CONFIRMED,
        actorId: actor.id,
        organizationId: request.organizationId,
        privacyRequestId: request.id,
        targetId: request.subjectUserId,
        reasonCode: request.reason,
        holdDecision: HOLD_DECISIONS.NONE_ACTIVE,
        idempotencyKey: request.idempotencyKey,
        result: 'CONFIRMED',
        correlationId: request.correlationId,
      })

      const outcome = await redactSubject(tx, {
        organizationId: request.organizationId,
        subjectUserId: request.subjectUserId,
        now,
      })

      const completed = await tx.privacyRequest.update({
        where: { id: request.id },
        data: {
          state: 'COMPLETED',
          completedAt: now,
          outcomeCode: PRIVACY_OUTCOMES.REDACTED,
          scope: outcome.categories,
        },
      })

      await recordPrivacyAudit(tx, {
        action: AUDIT_ACTIONS.PRIVACY_REDACTION_COMPLETED,
        actorId: actor.id,
        organizationId: request.organizationId,
        privacyRequestId: request.id,
        targetId: request.subjectUserId,
        reasonCode: request.reason,
        holdDecision: HOLD_DECISIONS.NONE_ACTIVE,
        idempotencyKey: request.idempotencyKey,
        result: 'COMPLETED',
        correlationId: request.correlationId,
        detail: {
          categories: outcome.categories,
          sessionsRevoked: outcome.sessionsRevoked,
          tokensRevoked: outcome.tokensRevoked,
        },
      })

      return completed
    })
  } catch (error) {
    await recordSafeFailure(prisma, { request, actor, now })

    throw error
  }
}

/**
 * Record that execution stopped without completing.
 *
 * Runs after the redaction transaction rolled back, so the request is back at
 * `REQUESTED` and this write is what moves it to `FAILED_SAFE`. No driver
 * message is stored: a failure message quotes the row that failed, and the row
 * that failed is the person.
 *
 * Best-effort on purpose. If recording the failure itself fails, the original
 * error is the one worth surfacing, and swallowing it to report a bookkeeping
 * problem would hide what actually went wrong.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} params Parameters.
 * @param {object} params.request The request row.
 * @param {object} params.actor The caller.
 * @param {Date} params.now The instant.
 * @returns {Promise<void>} Nothing.
 */
async function recordSafeFailure(prisma, { request, actor, now }) {
  try {
    await prisma.privacyRequest.update({
      where: { id: request.id },
      data: {
        state: 'FAILED_SAFE',
        outcomeCode: PRIVACY_OUTCOMES.STOPPED_SAFELY,
        failureCode: PRIVACY_FAILURE_CODES.REDACTION_WRITE_FAILED,
        lastAttemptAt: now,
      },
    })

    await recordPrivacyAudit(prisma, {
      action: AUDIT_ACTIONS.PRIVACY_REDACTION_FAILED_SAFE,
      actorId: actor.id,
      organizationId: request.organizationId,
      privacyRequestId: request.id,
      targetId: request.subjectUserId,
      reasonCode: PRIVACY_FAILURE_CODES.REDACTION_WRITE_FAILED,
      holdDecision: HOLD_DECISIONS.NONE_ACTIVE,
      idempotencyKey: request.idempotencyKey,
      result: 'FAILED_SAFE',
      correlationId: request.correlationId,
    })
  } catch {
    // Deliberately swallowed. See the note above: the caller is about to rethrow
    // the real failure, and replacing it with this one would lose it.
  }
}

/**
 * Withdraw a request before anything has been written.
 *
 * `desi_privacy_request_state_transition` refuses `PROCESSING → CANCELLED`, so
 * "before execution" is a property of the database rather than a promise this
 * function makes. The check here exists to produce a 409 instead of a 500.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} params Parameters.
 * @param {string} params.organizationId The organisation named in the path.
 * @param {string} params.requestId The request.
 * @param {object} params.actor The caller.
 * @param {Date} params.now The instant.
 * @returns {Promise<object>} The cancelled request.
 * @throws {Error} 404 when it is not this organisation's; 409 once it has begun.
 */
export async function cancelPrivacyRequest(prisma, { organizationId, requestId, actor, now }) {
  const request = await loadPrivacyRequest(prisma, { organizationId, requestId })

  if (request.state === 'CANCELLED') return request

  if (request.state !== 'REQUESTED' && request.state !== 'QUEUED') {
    throw conflict('That request can no longer be withdrawn.', { state: request.state })
  }

  const cancelled = await prisma.privacyRequest.update({
    where: { id: request.id },
    data: {
      state: 'CANCELLED',
      cancelledAt: now,
      outcomeCode: PRIVACY_OUTCOMES.WITHDRAWN_BY_OPERATOR,
    },
  })

  await recordPrivacyAudit(prisma, {
    action: AUDIT_ACTIONS.PRIVACY_REQUEST_CANCELLED,
    actorId: actor.id,
    organizationId,
    privacyRequestId: request.id,
    targetId: request.subjectUserId,
    reasonCode: PRIVACY_OUTCOMES.WITHDRAWN_BY_OPERATOR,
    holdDecision: request.holdDecision,
    idempotencyKey: request.idempotencyKey,
    result: 'CANCELLED',
    correlationId: request.correlationId,
  })

  return cancelled
}
