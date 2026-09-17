/**
 * What stops a redaction: legal holds, fraud holds, and open processes.
 *
 * Three refusal grounds, evaluated server-side before anything is written, and
 * fail-closed: a ground that cannot be evaluated refuses rather than proceeds.
 *
 * **Legal and fraud holds** are rows somebody placed deliberately. They are the
 * governance answer, and they override the data subject's request until whoever
 * placed them lifts it.
 *
 * **Open processes** are the operational answer, and they are the reason
 * `PrivacyHoldDecision.OPEN_PROCESS` exists. Some of this system's flows match
 * on a personal value rather than on a row id, so redacting mid-flight would not
 * anonymise a person — it would break a transaction that is still running. The
 * sharpest case is a ticket transfer: `apps/api/src/routes/tickets.js:406`
 * compares `request.actor.email` against `TicketTransfer.toEmail` to decide
 * whether the person clicking the link is the person invited. Replace either
 * side while the invitation is `PENDING` and the ticket becomes unclaimable by
 * anybody, including its rightful recipient. Refusing until the transfer settles
 * costs the subject a delay; redacting anyway costs somebody a ticket they paid
 * for.
 *
 * An open process is a **temporary** refusal, and the distinction matters to the
 * person waiting: a legal hold ends when counsel says so, an open process ends
 * by itself.
 *
 * @module @desi-event/api/lib/privacy-holds
 */

/**
 * The hold decision vocabulary, mirroring the `PrivacyHoldDecision` enum.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const HOLD_DECISIONS = Object.freeze({
  NOT_EVALUATED: 'NOT_EVALUATED',
  NONE_ACTIVE: 'NONE_ACTIVE',
  LEGAL_HOLD_ACTIVE: 'LEGAL_HOLD_ACTIVE',
  FRAUD_HOLD_ACTIVE: 'FRAUD_HOLD_ACTIVE',
  OPEN_PROCESS: 'OPEN_PROCESS',
})

/**
 * Why an open process blocked the request, from a closed vocabulary.
 *
 * Codes rather than sentences, and coarse on purpose. "A ticket transfer is
 * still open" is what an operator needs; which ticket, to which address, is the
 * personal data this whole subsystem exists to stop handing out.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const OPEN_PROCESS_CODES = Object.freeze({
  TRANSFER_PENDING: 'TRANSFER_PENDING',
  REFUND_IN_FLIGHT: 'REFUND_IN_FLIGHT',
  DISPUTE_OPEN: 'DISPUTE_OPEN',
  RECONCILIATION_OPEN: 'RECONCILIATION_OPEN',
  ADMISSION_UNSPENT: 'ADMISSION_UNSPENT',
  NOTIFICATION_UNDELIVERED: 'NOTIFICATION_UNDELIVERED',
})

/** Refund states where money is still moving or a decision is still owed. */
const REFUND_IN_FLIGHT = Object.freeze([
  'REQUESTED',
  'APPROVED',
  'SUBMITTED',
  'PROCESSING',
  'TIMEOUT',
  'RECONCILIATION_REQUIRED',
])

/** Dispute states where the organisation still owes the provider an answer. */
const DISPUTE_OPEN = Object.freeze([
  'OPENED',
  'NEEDS_RESPONSE',
  'UNDER_REVIEW',
  'WARNING_NEEDS_RESPONSE',
])

/** Reconciliation states that still need a human or a provider answer. */
const RECONCILIATION_OPEN = Object.freeze(['OPEN', 'IN_PROGRESS', 'ESCALATED'])

/** Outbox states where the message has not yet been delivered or abandoned. */
const NOTIFICATION_UNDELIVERED = Object.freeze(['QUEUED', 'CLAIMED', 'SENDING', 'RETRY_SCHEDULED'])

/**
 * Find the active hold blocking this subject, if there is one.
 *
 * Legal before fraud, deliberately. Both refuse, so the order changes only which
 * one is named — and a legal obligation is the one an operator must escalate.
 *
 * @param {object} prisma A Prisma client or transaction client.
 * @param {object} params Parameters.
 * @param {string} params.organizationId The organisation named in the path.
 * @param {string} params.subjectUserId The data subject.
 * @returns {Promise<{id: string, kind: string}|null>} The hold, or null.
 */
export async function findActiveHold(prisma, { organizationId, subjectUserId }) {
  const holds = await prisma.privacyHold.findMany({
    where: { organizationId, subjectUserId, state: 'ACTIVE' },
    select: { id: true, kind: true },
    orderBy: { placedAt: 'asc' },
  })

  return holds.find((hold) => hold.kind === 'LEGAL') ?? holds[0] ?? null
}

/**
 * Find an operational process that still needs this subject's personal data.
 *
 * Every probe is scoped to the organisation as well as the subject, because a
 * redaction is organisation-scoped: an open refund in a *different* organisation
 * is not this organisation's reason to refuse, and letting it be one would leak
 * that the subject has business elsewhere.
 *
 * Ordered cheapest-and-most-likely first. Each returns on the first match; this
 * is a yes-or-no question and enumerating a person's whole history to answer it
 * would be the opposite of data minimisation.
 *
 * @param {object} prisma A Prisma client or transaction client.
 * @param {object} params Parameters.
 * @param {string} params.organizationId The organisation named in the path.
 * @param {string} params.subjectUserId The data subject.
 * @param {string|null} [params.subjectEmail] The subject's address, lower-cased.
 * @param {Date} params.now The instant, so an expired invitation does not block.
 * @returns {Promise<string|null>} An `OPEN_PROCESS_CODES` value, or null.
 */
export async function findOpenProcess(
  prisma,
  { organizationId, subjectUserId, subjectEmail = null, now },
) {
  const withinOrganization = { orderItem: { order: { event: { organizationId } } } }

  // A PENDING invitation, in every direction it can reach the subject.
  //
  // The third clause is the one that is easy to miss and expensive to omit.
  // Acceptance is gated solely by comparing the signed-in address against
  // `toEmail` (`apps/api/src/routes/tickets.js:407`, and the decline path at
  // `:444`); `toUserId` is resolved by an address lookup when the invitation is
  // sent and is **null when the recipient had no account yet**, and it is
  // written only after the gate has already passed. So an invitation sent to
  // somebody before they registered is invisible to a `toUserId` probe — and
  // redacting that person's `User.email` afterwards makes the gate unmatchable
  // from either side. The ticket then sits in `TRANSFER_PENDING` until the
  // invitation lapses, acceptable to nobody, including the person who paid.
  const addressed = subjectEmail ? [{ toEmail: subjectEmail }] : []

  const transfer = await prisma.ticketTransfer.findFirst({
    where: {
      status: 'PENDING',
      expiresAt: { gt: now },
      ticket: withinOrganization,
      OR: [{ fromUserId: subjectUserId }, { toUserId: subjectUserId }, ...addressed],
    },
    select: { id: true },
  })

  if (transfer) return OPEN_PROCESS_CODES.TRANSFER_PENDING

  const refund = await prisma.refund.findFirst({
    where: {
      status: { in: [...REFUND_IN_FLIGHT] },
      order: { userId: subjectUserId, event: { organizationId } },
    },
    select: { id: true },
  })

  if (refund) return OPEN_PROCESS_CODES.REFUND_IN_FLIGHT

  const dispute = await prisma.dispute.findFirst({
    where: {
      status: { in: [...DISPUTE_OPEN] },
      payment: { order: { userId: subjectUserId, event: { organizationId } } },
    },
    select: { id: true },
  })

  if (dispute) return OPEN_PROCESS_CODES.DISPUTE_OPEN

  // Two probes, because `ReconciliationTask` reaches an order two different
  // ways: through `payment`, which is a real relation, and through `orderId`,
  // which is a bare column with no relation behind it (schema.prisma:2138). A
  // task opened against an order that never reached a payment carries only the
  // second, so a single probe through `payment` would miss it.
  const taskByPayment = await prisma.reconciliationTask.findFirst({
    where: {
      state: { in: [...RECONCILIATION_OPEN] },
      payment: { order: { userId: subjectUserId, event: { organizationId } } },
    },
    select: { id: true },
  })

  if (taskByPayment) return OPEN_PROCESS_CODES.RECONCILIATION_OPEN

  const orders = await prisma.order.findMany({
    where: { userId: subjectUserId, event: { organizationId } },
    select: { id: true },
  })

  if (orders.length > 0) {
    const taskByOrderId = await prisma.reconciliationTask.findFirst({
      where: {
        state: { in: [...RECONCILIATION_OPEN] },
        orderId: { in: orders.map((order) => order.id) },
      },
      select: { id: true },
    })

    if (taskByOrderId) return OPEN_PROCESS_CODES.RECONCILIATION_OPEN
  }

  // An admission that has not been used, for an event that has not finished.
  // The ticket survives redaction — only the name on it goes — but a door that
  // checks a name against a list would stop matching, so the safe rule is to
  // wait until the event is over.
  const admission = await prisma.ticket.findFirst({
    where: {
      status: { in: ['VALID', 'TRANSFER_PENDING'] },
      ownerUserId: subjectUserId,
      orderItem: { order: { event: { organizationId, endsAt: { gt: now } } } },
    },
    select: { id: true },
  })

  if (admission) return OPEN_PROCESS_CODES.ADMISSION_UNSPENT

  // The dispatcher renders from the stored row rather than from source
  // (`apps/worker/src/outbox/dispatcher.js:167`), so scrubbing a row that has
  // not been sent does not redact a person — it sends them a message with holes
  // in it, or fails delivery outright.
  const undelivered = await prisma.notificationOutbox.findFirst({
    where: {
      status: { in: [...NOTIFICATION_UNDELIVERED] },
      organizationId,
      OR: [
        { userId: subjectUserId },
        ...(subjectEmail ? [{ recipient: { equals: subjectEmail, mode: 'insensitive' } }] : []),
      ],
    },
    select: { id: true },
  })

  if (undelivered) return OPEN_PROCESS_CODES.NOTIFICATION_UNDELIVERED

  return null
}

/**
 * Decide whether a redaction may proceed, and say why when it may not.
 *
 * The single entry point, so no caller can evaluate one ground and forget the
 * other. Returns a decision rather than throwing, because both refusals are
 * ordinary outcomes that have to be recorded rather than exceptions to report.
 *
 * @param {object} prisma A Prisma client or transaction client.
 * @param {object} params Parameters.
 * @param {string} params.organizationId The organisation named in the path.
 * @param {string} params.subjectUserId The data subject.
 * @param {string|null} [params.subjectEmail] The subject's address, lower-cased.
 * @param {Date} params.now The instant.
 * @returns {Promise<{decision: string, holdId: (string|null), openProcessCode: (string|null)}>} The evaluation.
 */
export async function evaluateHolds(
  prisma,
  { organizationId, subjectUserId, subjectEmail = null, now },
) {
  const hold = await findActiveHold(prisma, { organizationId, subjectUserId })

  if (hold) {
    return {
      decision:
        hold.kind === 'LEGAL' ? HOLD_DECISIONS.LEGAL_HOLD_ACTIVE : HOLD_DECISIONS.FRAUD_HOLD_ACTIVE,
      holdId: hold.id,
      openProcessCode: null,
    }
  }

  const openProcessCode = await findOpenProcess(prisma, {
    organizationId,
    subjectUserId,
    subjectEmail,
    now,
  })

  if (openProcessCode) {
    return { decision: HOLD_DECISIONS.OPEN_PROCESS, holdId: null, openProcessCode }
  }

  return { decision: HOLD_DECISIONS.NONE_ACTIVE, holdId: null, openProcessCode: null }
}

/**
 * Does this decision permit execution?
 *
 * One function so that "clear" is defined once. The database says the same thing
 * in `privacy_request_executes_only_when_clear`; this is the application's half
 * of the same rule, and the two are tested against each other.
 *
 * @param {string} decision A `HOLD_DECISIONS` value.
 * @returns {boolean} Whether a redaction may run.
 */
export function decisionPermitsExecution(decision) {
  return decision === HOLD_DECISIONS.NONE_ACTIVE
}

/**
 * Why a hold was lifted, from a closed vocabulary.
 *
 * A sentence here would describe the matter, and the matter is usually about a
 * person. `matterReference` already points at the record that holds the detail,
 * outside this system and under whatever access control that system has.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const HOLD_RELEASE_CODES = Object.freeze({
  MATTER_CLOSED: 'MATTER_CLOSED',
  COUNSEL_INSTRUCTION: 'COUNSEL_INSTRUCTION',
  INVESTIGATION_CLOSED: 'INVESTIGATION_CLOSED',
  PLACED_IN_ERROR: 'PLACED_IN_ERROR',
})

/**
 * Place a hold over a subject's data.
 *
 * Deliberately **not** idempotent across calls: two matters concerning the same
 * person are two holds, and collapsing them would let closing one release the
 * other. `evaluateHolds` refuses while any of them is `ACTIVE`, so the subject
 * is protected until the last one is lifted.
 *
 * @param {object} prisma A Prisma client or transaction client.
 * @param {object} params Parameters.
 * @param {string} params.organizationId The organisation named in the path.
 * @param {string} params.subjectUserId The data subject.
 * @param {string} params.kind `LEGAL` or `FRAUD_INVESTIGATION`.
 * @param {string} params.matterReference An opaque reference to the matter outside this system.
 * @param {string} params.placedById Who placed it.
 * @param {Date|null} [params.expectedUntil] Advisory only; nothing expires a hold.
 * @returns {Promise<object>} The hold.
 */
export async function placeHold(prisma, params) {
  const {
    organizationId,
    subjectUserId,
    kind,
    matterReference,
    placedById,
    expectedUntil = null,
  } = params

  return prisma.privacyHold.create({
    data: {
      organizationId,
      subjectUserId,
      kind,
      state: 'ACTIVE',
      matterReference,
      placedById,
      expectedUntil,
    },
  })
}

/**
 * Lift a hold.
 *
 * Conditional on the hold still being `ACTIVE`, so two operators releasing the
 * same hold at once produce one release rather than a second one that overwrites
 * the first releaser's name. `privacy_hold_release_coherent` and
 * `privacy_hold_release_names_an_actor` make the three release columns move
 * together as a property of the database.
 *
 * @param {object} prisma A Prisma client or transaction client.
 * @param {object} params Parameters.
 * @param {string} params.organizationId The organisation named in the path.
 * @param {string} params.holdId The hold.
 * @param {string} params.releasedById Who lifted it.
 * @param {string} params.releaseReasonCode A `HOLD_RELEASE_CODES` value.
 * @param {Date} params.now The instant.
 * @returns {Promise<{released: boolean}>} Whether this call was the one that lifted it.
 */
export async function releaseHold(prisma, params) {
  const { organizationId, holdId, releasedById, releaseReasonCode, now } = params

  const { count } = await prisma.privacyHold.updateMany({
    where: { id: holdId, organizationId, state: 'ACTIVE' },
    data: { state: 'RELEASED', releasedAt: now, releasedById, releaseReasonCode },
  })

  return { released: count === 1 }
}

/**
 * Project a hold onto what an operator may see.
 *
 * An allow list. `matterReference` is included because an operator who cannot
 * see which matter is holding a person's data cannot resolve it — but note what
 * is absent: nothing here describes the matter, only points at it.
 *
 * @param {object} row A `PrivacyHold` row.
 * @returns {object} The payload described by `privacyHoldSchema`.
 */
export function toPrivacyHold(row) {
  return {
    id: row.id,
    subjectId: row.subjectUserId,
    kind: row.kind,
    state: row.state,
    matterReference: row.matterReference,
    placedAt: row.placedAt,
    expectedUntil: row.expectedUntil ?? null,
    releasedAt: row.releasedAt ?? null,
    releaseReasonCode: row.releaseReasonCode ?? null,
  }
}
