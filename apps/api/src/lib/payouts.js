/**
 * Money leaving: transfers, payouts, and the disputes that stop both.
 *
 * Three state machines and one balance rule. The machines are written out as
 * tables because "can a failed payout be retried?" is a question that otherwise
 * gets three different answers in three places. The balance rule is the part
 * that actually protects an organiser's money, and it is worth stating plainly.
 *
 * ## The balance rule
 *
 * What an organiser may be paid is not a column. It is derived from the
 * append-only ledger — `organizer_payable` credits minus debits — less
 * everything already committed against it:
 *
 *   - **In flight.** A transfer or payout that has been decided but has not
 *     posted its ledger batch yet. The batch posts when the money actually
 *     moves, so until then the payable still shows money that is already spoken
 *     for, and two payouts could otherwise each claim it.
 *   - **Refund liability.** `Order.refundPendingCents` across the organisation:
 *     money a buyer has been promised back and which must not be paid out to
 *     the organiser first.
 *   - **Dispute liability.** Every open dispute's amount. A dispute is somebody
 *     claiming the money was never theirs to take, and paying it out while that
 *     is unresolved is how a marketplace ends up chasing an organiser for funds
 *     it already sent them.
 *
 * A negative available balance is never paid. Neither is an amount above it.
 *
 * ## Why the ledger and not a column
 *
 * A column can be wrong and nothing notices. The ledger is append-only, every
 * batch is balanced by a database check, and a reversal posts compensating
 * entries rather than editing history — so a figure derived from it is a figure
 * that can be defended line by line. That is the whole reason the ledger exists.
 *
 * @module @desi-event/api/lib/payouts
 */

import {
  ACCOUNTS,
  CREDIT,
  DEBIT,
  disputeOpenedBatch,
  disputeResolvedBatch,
  payoutBatch,
  transferBatch,
  transferReversalBatch,
} from '@desi-event/ledger'

import { AUDIT_ACTIONS, recordAudit } from './audit.js'
import { conflict, notFound, unprocessable } from './errors.js'
import { postBatch } from './ledger.js'
import { openReconciliation } from './webhook-handlers.js'

/**
 * The transfer lifecycle.
 *
 * `SENT` and `PARTIALLY_REVERSED` exist in the enum and are not in this table:
 * they are retained spellings from the Phase 2 schema and nothing writes them.
 * A partial reversal leaves a transfer PAID with `reversedCents` set, because a
 * transfer that is half back is still a transfer that happened.
 *
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
export const TRANSFER_TRANSITIONS = Object.freeze({
  PENDING: Object.freeze(['SUBMITTED', 'FAILED']),
  SUBMITTED: Object.freeze(['PAID', 'FAILED', 'RECONCILIATION_REQUIRED']),
  PAID: Object.freeze(['REVERSED']),
  // A failure may be tried again once whatever caused it is fixed, which is
  // what an operator does after correcting a connected account.
  FAILED: Object.freeze(['SUBMITTED']),
  RECONCILIATION_REQUIRED: Object.freeze(['PAID', 'FAILED']),
  REVERSED: Object.freeze([]),
})

/**
 * The payout lifecycle.
 *
 * `HELD` is not a failure and not an exception path — it is the ordinary
 * outcome of scheduling a payout against a balance that cannot support it, and
 * it goes back to SCHEDULED when it can.
 *
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
export const PAYOUT_TRANSITIONS = Object.freeze({
  SCHEDULED: Object.freeze(['SUBMITTED', 'HELD', 'CANCELLED']),
  SUBMITTED: Object.freeze(['PAID', 'FAILED', 'RECONCILIATION_REQUIRED']),
  PAID: Object.freeze(['REVERSED']),
  FAILED: Object.freeze(['SCHEDULED', 'CANCELLED']),
  HELD: Object.freeze(['SCHEDULED', 'CANCELLED']),
  RECONCILIATION_REQUIRED: Object.freeze(['PAID', 'FAILED']),
  REVERSED: Object.freeze([]),
  CANCELLED: Object.freeze([]),
})

/**
 * The dispute lifecycle.
 *
 * `NEEDS_RESPONSE`, `CHARGE_REFUNDED` and the two warning states are retained
 * provider spellings; the lifecycle this system drives is the four below.
 *
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
export const DISPUTE_TRANSITIONS = Object.freeze({
  OPENED: Object.freeze(['UNDER_REVIEW', 'WON', 'LOST', 'CLOSED']),
  UNDER_REVIEW: Object.freeze(['WON', 'LOST']),
  WON: Object.freeze(['CLOSED']),
  LOST: Object.freeze(['CLOSED']),
  CLOSED: Object.freeze([]),
})

/** Transfer states where the money is committed but the ledger has not moved. */
export const TRANSFER_IN_FLIGHT = Object.freeze(['PENDING', 'SUBMITTED', 'RECONCILIATION_REQUIRED'])

/** Payout states where the money is committed but the ledger has not moved. */
export const PAYOUT_IN_FLIGHT = Object.freeze([
  'SCHEDULED',
  'SUBMITTED',
  'HELD',
  'RECONCILIATION_REQUIRED',
])

/** Dispute states where the money is still being claimed back. */
export const DISPUTE_OPEN = Object.freeze(['OPENED', 'NEEDS_RESPONSE', 'UNDER_REVIEW'])

/**
 * Whether a transition is in a table.
 *
 * @param {Readonly<Record<string, ReadonlyArray<string>>>} table One of the three above.
 * @param {string} from The current state.
 * @param {string} to The proposed state.
 * @returns {boolean} True when the table allows it.
 */
export function canTransition(table, from, to) {
  return (table[from] ?? []).includes(to)
}

/**
 * Move a row to a new state, conditionally, refusing a transition off the table.
 *
 * One function for all three machines rather than three near-identical ones:
 * the delegate and the table differ, and nothing else does.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Inputs.
 * @param {object} params.delegate The Prisma delegate, e.g. `tx.payout`.
 * @param {Readonly<Record<string, ReadonlyArray<string>>>} params.table The transition table.
 * @param {object} params.row The row as it was read.
 * @param {string} params.to The new state.
 * @param {object} [params.data] Extra columns.
 * @param {string} [params.label] What to call it in a refusal message.
 * @param {string} [params.column] Which column holds the state; defaults to `status`.
 * @returns {Promise<boolean>} Whether this call performed the transition.
 * @throws {Error} 409 when the transition is not in the table.
 */
export async function transition(
  tx,
  { delegate, table, row, to, data = {}, label = 'row', column = 'status' },
) {
  // `column` exists so the mock connected-account lifecycle can use this same
  // compare-and-set rather than grow a second copy of it: its state lives in
  // `onboardingStatus`. Everything else about the function is unchanged, and the
  // default keeps every existing caller — six here, four in tickets.js, two in
  // reconciliation.js — passing exactly what it passed before.
  const from = row[column]

  if (!canTransition(table, from, to)) {
    throw conflict(
      `A ${String(from).toLowerCase().replace(/_/g, ' ')} ${label} cannot become ${to.toLowerCase().replace(/_/g, ' ')}.`,
      { from, to },
    )
  }

  // The `where` names the state it was read against, which is what makes this a
  // compare-and-set. Two concurrent callers both pass the table check; only the
  // one whose read is still true updates a row, and `count === 1` is how the
  // caller learns which it was.
  const { count } = await delegate.updateMany({
    where: { id: row.id, [column]: from },
    data: { [column]: to, ...data },
  })

  return count === 1
}

/**
 * What the ledger says an organisation is owed.
 *
 * Derived from the entries rather than read off a column, because the entries
 * are what a balanced batch and an append-only table guarantee. Two aggregates
 * rather than one, so the direction is explicit in the query instead of being
 * implied by a sign convention somebody has to remember.
 *
 * @param {object} prisma A Prisma client or transaction client.
 * @param {object} params Inputs.
 * @param {string} params.organizationId Whose balance.
 * @param {string} params.currency Which currency.
 * @returns {Promise<number>} Integer cents. May be negative.
 */
export async function payableCents(prisma, { organizationId, currency }) {
  const account = await prisma.ledgerAccount.findUnique({
    where: { code: ACCOUNTS.ORGANIZER_PAYABLE },
  })

  if (!account) return 0

  const where = { accountId: account.id, organizationId, currency }

  const [credits, debits] = await Promise.all([
    prisma.ledgerEntry.aggregate({
      where: { ...where, direction: CREDIT },
      _sum: { amountCents: true },
    }),
    prisma.ledgerEntry.aggregate({
      where: { ...where, direction: DEBIT },
      _sum: { amountCents: true },
    }),
  ])

  // A liability: credits increase what is owed, debits settle it.
  return (credits._sum.amountCents ?? 0) - (debits._sum.amountCents ?? 0)
}

/**
 * What an organisation may actually be paid, and everything held against it.
 *
 * Returns the components rather than only the answer, because "why is my
 * balance lower than my sales?" is the question an organiser asks, and a figure
 * that cannot be broken down is a figure they cannot trust.
 *
 * @param {object} prisma A Prisma client or transaction client.
 * @param {object} params Inputs.
 * @param {string} params.organizationId Whose balance.
 * @param {string} params.currency Which currency.
 * @returns {Promise<{payableCents: number, inFlightCents: number, refundLiabilityCents: number, disputeLiabilityCents: number, availableCents: number}>} The breakdown.
 */
export async function availableBalance(prisma, { organizationId, currency }) {
  const payable = await payableCents(prisma, { organizationId, currency })

  const [transfers, payoutRows, orders, disputes] = await Promise.all([
    prisma.transfer.aggregate({
      where: { organizationId, currency, status: { in: [...TRANSFER_IN_FLIGHT] } },
      _sum: { amountCents: true },
    }),
    prisma.payout.aggregate({
      where: { organizationId, currency, status: { in: [...PAYOUT_IN_FLIGHT] } },
      _sum: { amountCents: true },
    }),
    prisma.order.aggregate({
      where: { currency, event: { organizationId } },
      _sum: { refundPendingCents: true },
    }),
    prisma.dispute.aggregate({
      where: {
        currency,
        status: { in: [...DISPUTE_OPEN] },
        // Three hops — dispute to payment to order to event — walked as a
        // relation filter rather than summed in application code, so the
        // database does the work and the set never has to fit in memory.
        payment: { order: { event: { organizationId } } },
      },
      _sum: { amountCents: true },
    }),
  ])

  const disputeLiabilityCents = disputes._sum.amountCents ?? 0
  const inFlightCents = (transfers._sum.amountCents ?? 0) + (payoutRows._sum.amountCents ?? 0)
  const refundLiabilityCents = orders._sum.refundPendingCents ?? 0

  return {
    payableCents: payable,
    inFlightCents,
    refundLiabilityCents,
    disputeLiabilityCents,
    availableCents: payable - inFlightCents - refundLiabilityCents - disputeLiabilityCents,
  }
}

/**
 * Schedule a payout, or refuse to.
 *
 * The balance is read inside the caller's transaction and the row is created in
 * the same one, so a second request racing this one sees this payout's amount
 * in `inFlightCents` and is refused by the ceiling rather than by luck.
 *
 * A payout whose amount exceeds what is available is not an error to be
 * retried: it is `HELD`, with the reason recorded, because an organiser is
 * entitled to see that a payout was considered and why it did not go.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Inputs.
 * @param {string} params.organizationId Who is being paid.
 * @param {string|null} [params.connectedAccountId] Where.
 * @param {number} params.amountCents How much.
 * @param {string} params.currency Which currency.
 * @param {string} params.provider The provider's name.
 * @param {string} params.idempotencyKey Unique per logical payout.
 * @param {string|null} [params.actorId] Who asked.
 * @param {string|null} [params.requestId] For the audit trail.
 * @param {Date} params.now The instant.
 * @returns {Promise<{payout: object, created: boolean, balance: object}>} What was written.
 * @throws {Error} 422 for a non-positive amount.
 */
export async function schedulePayout(tx, params) {
  const {
    organizationId,
    connectedAccountId = null,
    amountCents,
    currency,
    provider,
    idempotencyKey,
    actorId = null,
    requestId = null,
    now,
  } = params

  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw unprocessable('A payout has to be for a positive whole number of cents.', { amountCents })
  }

  const existing = await tx.payout.findUnique({ where: { idempotencyKey } })

  if (existing) {
    return {
      payout: existing,
      created: false,
      balance: await availableBalance(tx, { organizationId, currency }),
    }
  }

  const balance = await availableBalance(tx, { organizationId, currency })

  // Held rather than refused, and the reason is stored. "It did not go and
  // nobody can say why" is the complaint this exists to prevent.
  const holdReason =
    balance.availableCents <= 0
      ? `nothing available: ${balance.payableCents} owed, ${balance.inFlightCents} in flight, ${balance.refundLiabilityCents} owed back to buyers, ${balance.disputeLiabilityCents} disputed`
      : amountCents > balance.availableCents
        ? `only ${balance.availableCents} of ${amountCents} is available`
        : null

  const payout = await tx.payout.create({
    data: {
      organizationId,
      connectedAccountId,
      provider,
      amountCents,
      currency,
      status: holdReason ? 'HELD' : 'SCHEDULED',
      holdReason,
      idempotencyKey,
    },
  })

  await recordAudit(tx, {
    action: holdReason ? AUDIT_ACTIONS.PAYOUT_HELD : AUDIT_ACTIONS.PAYOUT_SCHEDULED,
    entityType: 'Payout',
    entityId: payout.id,
    actorId,
    metadata: {
      requestId,
      at: now.toISOString(),
      organizationId,
      amountCents,
      currency,
      holdReason,
      balance,
      source: actorId ? 'operator' : 'system',
    },
  })

  return { payout, created: true, balance }
}

/** What the provider said about a movement, once we are out of the transaction. */
export const MOVEMENT_OUTCOMES = Object.freeze({
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  /** No definite answer. The money may or may not have moved. */
  TIMEOUT: 'TIMEOUT',
})

/**
 * Send a payout to the provider. No transaction may be open when this runs.
 *
 * @param {object} payments The payment provider.
 * @param {object} payout The SUBMITTED payout.
 * @param {string|null} destination The connected account reference.
 * @returns {Promise<{outcome: string, providerPayoutId: string|null, failureCode: string|null, rawStatus: string|null}>} What happened.
 * @throws {Error} 422 when the provider cannot pay out at all.
 */
export async function payOutsideTransaction(payments, payout, destination) {
  if (typeof payments.createPayout !== 'function') {
    throw unprocessable('This payment provider cannot make payouts.', {
      provider: payments.name,
    })
  }

  try {
    const result = await payments.createPayout({
      amountCents: payout.amountCents,
      currency: payout.currency,
      destination,
      idempotencyKey: payout.idempotencyKey,
    })

    return {
      outcome: MOVEMENT_OUTCOMES.SUCCEEDED,
      providerPayoutId: result?.id ?? null,
      failureCode: null,
      rawStatus: result?.status ?? null,
    }
  } catch (error) {
    if (error?.code === 'PAYMENT_TIMEOUT') {
      return {
        outcome: MOVEMENT_OUTCOMES.TIMEOUT,
        providerPayoutId: null,
        failureCode: null,
        rawStatus: 'TIMEOUT',
      }
    }

    return {
      outcome: MOVEMENT_OUTCOMES.FAILED,
      providerPayoutId: null,
      failureCode: error?.details?.failureCode ?? error?.code ?? 'PAYOUT_FAILED',
      rawStatus: 'FAILED',
    }
  }
}

/**
 * Record a payout the provider paid.
 *
 * The ledger batch posts here and only here, which is what makes "organiser
 * payable cannot be reduced twice" true: the batch's idempotency key is derived
 * from the payout, so a second settlement of one payout is refused by a unique
 * index rather than by this code remembering.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Inputs.
 * @param {object} params.payout The SUBMITTED payout.
 * @param {object} params.result What the provider said.
 * @param {string|null} [params.actorId] For the audit trail.
 * @param {string|null} [params.requestId] For the audit trail.
 * @param {Date} params.now The instant.
 * @returns {Promise<{settled: boolean}>} Whether this call settled it.
 */
export async function settlePayout(tx, { payout, result, actorId = null, requestId = null, now }) {
  const settled = await transition(tx, {
    delegate: tx.payout,
    table: PAYOUT_TRANSITIONS,
    row: payout,
    to: 'PAID',
    label: 'payout',
    data: {
      providerPayoutId: result.providerPayoutId,
      rawProviderStatus: result.rawStatus,
      arrivalDate: now,
    },
  })

  if (!settled) return { settled: false }

  await postBatch(
    tx,
    payoutBatch({
      amountCents: payout.amountCents,
      currency: payout.currency,
      organizationId: payout.organizationId,
      reference: payout.id,
    }),
    {
      sourceType: 'PAYOUT',
      sourceId: payout.id,
      reference: `PO-${payout.id}`,
      payoutId: payout.id,
      actorId,
      now,
    },
  )

  await recordAudit(tx, {
    action: AUDIT_ACTIONS.PAYOUT_PAID,
    entityType: 'Payout',
    entityId: payout.id,
    actorId,
    metadata: {
      requestId,
      at: now.toISOString(),
      organizationId: payout.organizationId,
      amountCents: payout.amountCents,
      currency: payout.currency,
      providerPayoutId: result.providerPayoutId,
      source: actorId ? 'operator' : 'system',
    },
  })

  return { settled: true }
}

/**
 * Record a payout the provider refused.
 *
 * No ledger batch. A failure posts nothing, because nothing moved — and a
 * `payoutBatch({ failed: true })` here would be posting the *return* of money
 * that never left.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Inputs.
 * @param {object} params.payout The SUBMITTED payout.
 * @param {object} params.result What the provider said.
 * @param {string|null} [params.actorId] For the audit trail.
 * @param {string|null} [params.requestId] For the audit trail.
 * @param {Date} params.now The instant.
 * @returns {Promise<{applied: boolean}>} Whether this call recorded it.
 */
export async function failPayout(tx, { payout, result, actorId = null, requestId = null, now }) {
  const applied = await transition(tx, {
    delegate: tx.payout,
    table: PAYOUT_TRANSITIONS,
    row: payout,
    to: 'FAILED',
    label: 'payout',
    data: { failureCode: result.failureCode, rawProviderStatus: result.rawStatus },
  })

  if (!applied) return { applied: false }

  await recordAudit(tx, {
    action: AUDIT_ACTIONS.PAYOUT_FAILED,
    entityType: 'Payout',
    entityId: payout.id,
    actorId,
    metadata: {
      requestId,
      at: now.toISOString(),
      organizationId: payout.organizationId,
      amountCents: payout.amountCents,
      failureCode: result.failureCode,
      source: actorId ? 'operator' : 'system',
    },
  })

  return { applied: true }
}

/**
 * Record a payout the provider did not answer.
 *
 * `RECONCILIATION_REQUIRED`, and the amount stays counted as in flight. Reading
 * silence as failure would free the balance for a second payout while the first
 * may still be on its way.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Inputs.
 * @param {object} params.payout The SUBMITTED payout.
 * @param {object} params.result What the provider said.
 * @param {string|null} [params.actorId] For the audit trail.
 * @param {string|null} [params.requestId] For the audit trail.
 * @param {Date} params.now The instant.
 * @returns {Promise<{applied: boolean}>} Whether this call recorded it.
 */
export async function holdPayoutForReconciliation(
  tx,
  { payout, result, actorId = null, requestId = null, now },
) {
  const applied = await transition(tx, {
    delegate: tx.payout,
    table: PAYOUT_TRANSITIONS,
    row: payout,
    to: 'RECONCILIATION_REQUIRED',
    label: 'payout',
    data: { rawProviderStatus: result.rawStatus },
  })

  if (!applied) return { applied: false }

  await openReconciliation(tx, {
    kind: 'TRANSFER_STUCK',
    payoutId: payout.id,
    organizationId: payout.organizationId,
    providerRef: null,
    localState: {
      payoutStatus: 'RECONCILIATION_REQUIRED',
      amountCents: payout.amountCents,
      currency: payout.currency,
      at: now.toISOString(),
    },
    lastError: 'the provider did not answer; the payout may or may not have gone',
  })

  await recordAudit(tx, {
    action: AUDIT_ACTIONS.PAYOUT_RECONCILIATION_REQUIRED,
    entityType: 'Payout',
    entityId: payout.id,
    actorId,
    metadata: {
      requestId,
      at: now.toISOString(),
      organizationId: payout.organizationId,
      amountCents: payout.amountCents,
      reason: 'PROVIDER_TIMEOUT_REQUIRES_RECONCILIATION',
      stillInFlight: true,
      source: actorId ? 'operator' : 'system',
    },
  })

  return { applied: true }
}

/**
 * Claw a paid payout back.
 *
 * Compensating entries, never a rewritten batch. The original batch is posted
 * and the database refuses to edit it; a reversal is a new batch in the other
 * direction, so the history says "it went and then it came back" rather than
 * "it never went".
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Inputs.
 * @param {object} params.payout The PAID payout.
 * @param {number} params.amountCents How much came back.
 * @param {string} params.reason Why.
 * @param {string|null} [params.actorId] For the audit trail.
 * @param {string|null} [params.requestId] For the audit trail.
 * @param {Date} params.now The instant.
 * @returns {Promise<{reversed: boolean}>} Whether this call reversed it.
 * @throws {Error} 422 when the amount exceeds what was paid.
 */
export async function reversePayout(tx, params) {
  const { payout, amountCents, reason, actorId = null, requestId = null, now } = params
  const remaining = payout.amountCents - payout.reversedCents

  if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > remaining) {
    throw unprocessable(`That payout has ${remaining} cent(s) that can still come back.`, {
      requested: amountCents,
      remaining,
    })
  }

  const reversed = await transition(tx, {
    delegate: tx.payout,
    table: PAYOUT_TRANSITIONS,
    row: payout,
    to: 'REVERSED',
    label: 'payout',
    data: { reversedCents: { increment: amountCents }, failureCode: 'REVERSED' },
  })

  if (!reversed) return { reversed: false }

  await postBatch(
    tx,
    payoutBatch({
      amountCents,
      failed: true,
      currency: payout.currency,
      organizationId: payout.organizationId,
      reference: payout.id,
    }),
    {
      sourceType: 'PAYOUT',
      sourceId: payout.id,
      reference: `PR-${payout.id}`,
      discriminator: 'reversal',
      payoutId: payout.id,
      actorId,
      now,
    },
  )

  await recordAudit(tx, {
    action: AUDIT_ACTIONS.PAYOUT_REVERSED,
    entityType: 'Payout',
    entityId: payout.id,
    actorId,
    metadata: {
      requestId,
      at: now.toISOString(),
      organizationId: payout.organizationId,
      amountCents,
      currency: payout.currency,
      reason,
      source: actorId ? 'operator' : 'system',
    },
  })

  return { reversed: true }
}

/**
 * Record a transfer the provider paid.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Inputs.
 * @param {object} params.transfer The SUBMITTED transfer.
 * @param {object} params.result What the provider said.
 * @param {string|null} [params.actorId] For the audit trail.
 * @param {string|null} [params.requestId] For the audit trail.
 * @param {Date} params.now The instant.
 * @returns {Promise<{settled: boolean}>} Whether this call settled it.
 */
export async function settleTransfer(
  tx,
  { transfer, result, actorId = null, requestId = null, now },
) {
  const settled = await transition(tx, {
    delegate: tx.transfer,
    table: TRANSFER_TRANSITIONS,
    row: transfer,
    to: 'PAID',
    label: 'transfer',
    data: {
      providerTransferId: result.providerTransferId ?? null,
      rawProviderStatus: result.rawStatus,
      settledAt: now,
    },
  })

  if (!settled) return { settled: false }

  await postBatch(
    tx,
    transferBatch({
      amountCents: transfer.amountCents,
      currency: transfer.currency,
      organizationId: transfer.organizationId,
      reference: transfer.id,
    }),
    {
      sourceType: 'TRANSFER',
      sourceId: transfer.id,
      reference: `TR-${transfer.id}`,
      transferId: transfer.id,
      orderId: transfer.orderId ?? undefined,
      actorId,
      now,
    },
  )

  await recordAudit(tx, {
    action: AUDIT_ACTIONS.TRANSFER_PAID,
    entityType: 'Transfer',
    entityId: transfer.id,
    actorId,
    metadata: {
      requestId,
      at: now.toISOString(),
      organizationId: transfer.organizationId,
      amountCents: transfer.amountCents,
      currency: transfer.currency,
      providerTransferId: result.providerTransferId ?? null,
      source: actorId ? 'operator' : 'system',
    },
  })

  return { settled: true }
}

/**
 * Claw a paid transfer back, in whole or in part.
 *
 * A partial reversal leaves the transfer PAID with `reversedCents` set: a
 * transfer that is half back is still a transfer that happened, and calling it
 * REVERSED would say the whole thing came back.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Inputs.
 * @param {object} params.transfer The PAID transfer.
 * @param {number} params.amountCents How much came back.
 * @param {string} params.reason Why.
 * @param {string|null} [params.actorId] For the audit trail.
 * @param {string|null} [params.requestId] For the audit trail.
 * @param {Date} params.now The instant.
 * @returns {Promise<{reversed: boolean, whole: boolean}>} What was written.
 * @throws {Error} 422 when the amount exceeds what is left.
 */
export async function reverseTransfer(tx, params) {
  const { transfer, amountCents, reason, actorId = null, requestId = null, now } = params
  const remaining = transfer.amountCents - transfer.reversedCents

  if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > remaining) {
    throw unprocessable(`That transfer has ${remaining} cent(s) that can still come back.`, {
      requested: amountCents,
      remaining,
    })
  }

  const whole = amountCents === remaining

  // Conditional on the amount already reversed, not only on the status: two
  // partial reversals racing would otherwise both pass the ceiling check above
  // and together take back more than was sent.
  const { count } = await tx.transfer.updateMany({
    where: {
      id: transfer.id,
      status: transfer.status,
      reversedCents: transfer.reversedCents,
    },
    data: {
      reversedCents: transfer.reversedCents + amountCents,
      ...(whole ? { status: 'REVERSED' } : {}),
    },
  })

  if (count === 0) return { reversed: false, whole: false }

  await postBatch(
    tx,
    transferReversalBatch({
      amountCents,
      currency: transfer.currency,
      organizationId: transfer.organizationId,
      reference: transfer.id,
    }),
    {
      sourceType: 'TRANSFER',
      sourceId: transfer.id,
      reference: `TV-${transfer.id}-${transfer.reversedCents + amountCents}`,
      discriminator: `reversal:${transfer.reversedCents + amountCents}`,
      transferId: transfer.id,
      actorId,
      now,
    },
  )

  await recordAudit(tx, {
    action: AUDIT_ACTIONS.TRANSFER_REVERSED,
    entityType: 'Transfer',
    entityId: transfer.id,
    actorId,
    metadata: {
      requestId,
      at: now.toISOString(),
      organizationId: transfer.organizationId,
      amountCents,
      currency: transfer.currency,
      whole,
      reason,
      source: actorId ? 'operator' : 'system',
    },
  })

  return { reversed: true, whole }
}

/**
 * Record a dispute, and hold the money while it is open.
 *
 * Idempotent on the provider's own identifier, because a dispute webhook is
 * delivered more than once as a matter of routine and opening two disputes for
 * one chargeback would hold the money twice.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Inputs.
 * @param {object} params.payment The disputed payment.
 * @param {string} params.organizationId Whose event it was.
 * @param {string} params.providerDisputeId The provider's identifier.
 * @param {number} params.amountCents How much is claimed.
 * @param {string} params.currency Which currency.
 * @param {string|null} [params.reason] The provider's reason code.
 * @param {string|null} [params.actorId] For the audit trail.
 * @param {Date} params.now The instant.
 * @returns {Promise<{dispute: object, created: boolean}>} What was written.
 */
export async function openDispute(tx, params) {
  const {
    payment,
    organizationId,
    providerDisputeId,
    amountCents,
    currency,
    reason = null,
    actorId = null,
    now,
  } = params

  const existing = await tx.dispute.findFirst({
    where: { provider: payment.provider, providerDisputeId },
  })

  if (existing) return { dispute: existing, created: false }

  const dispute = await tx.dispute.create({
    data: {
      paymentId: payment.id,
      provider: payment.provider,
      providerDisputeId,
      amountCents,
      currency,
      reason,
      status: 'OPENED',
      fundsWithheld: true,
    },
  })

  await postBatch(
    tx,
    disputeOpenedBatch({
      disputedCents: amountCents,
      currency,
      organizationId,
      reference: dispute.id,
    }),
    {
      sourceType: 'DISPUTE',
      sourceId: dispute.id,
      reference: `DP-${dispute.id}`,
      disputeId: dispute.id,
      paymentId: payment.id,
      actorId,
      now,
    },
  )

  await recordAudit(tx, {
    action: AUDIT_ACTIONS.DISPUTE_OPENED,
    entityType: 'Dispute',
    entityId: dispute.id,
    actorId,
    metadata: {
      at: now.toISOString(),
      organizationId,
      paymentId: payment.id,
      amountCents,
      currency,
      reason,
      providerDisputeId,
      source: actorId ? 'operator' : 'provider',
    },
  })

  return { dispute, created: true }
}

/**
 * Record how a dispute ended.
 *
 * Winning returns the held funds to the organiser's payable; losing sends them
 * to the buyer's bank and they never come back. Both post a batch, because both
 * are completed financial actions.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {object} params Inputs.
 * @param {object} params.dispute The dispute.
 * @param {string} params.organizationId Whose event it was.
 * @param {boolean} params.won Whether the organiser kept the money.
 * @param {string|null} [params.actorId] For the audit trail.
 * @param {string|null} [params.requestId] For the audit trail.
 * @param {Date} params.now The instant.
 * @returns {Promise<{resolved: boolean}>} Whether this call resolved it.
 */
export async function resolveDispute(tx, params) {
  const { dispute, organizationId, won, actorId = null, requestId = null, now } = params

  const resolved = await transition(tx, {
    delegate: tx.dispute,
    table: DISPUTE_TRANSITIONS,
    row: dispute,
    to: won ? 'WON' : 'LOST',
    label: 'dispute',
    data: { fundsWithheld: false, closedAt: now },
  })

  if (!resolved) return { resolved: false }

  await postBatch(
    tx,
    disputeResolvedBatch({
      disputedCents: dispute.amountCents,
      won,
      currency: dispute.currency,
      organizationId,
      reference: dispute.id,
    }),
    {
      sourceType: 'DISPUTE',
      sourceId: dispute.id,
      reference: `DR-${dispute.id}`,
      discriminator: 'resolved',
      disputeId: dispute.id,
      paymentId: dispute.paymentId,
      actorId,
      now,
    },
  )

  await recordAudit(tx, {
    action: won ? AUDIT_ACTIONS.DISPUTE_WON : AUDIT_ACTIONS.DISPUTE_LOST,
    entityType: 'Dispute',
    entityId: dispute.id,
    actorId,
    metadata: {
      requestId,
      at: now.toISOString(),
      organizationId,
      amountCents: dispute.amountCents,
      currency: dispute.currency,
      previousStatus: dispute.status,
      source: actorId ? 'operator' : 'provider',
    },
  })

  return { resolved: true }
}

/**
 * Load a payout with what a decision about it needs.
 *
 * @param {object} prisma A Prisma client or transaction client.
 * @param {string} payoutId Which one.
 * @returns {Promise<{payout: object, account: object|null}>} The rows.
 * @throws {Error} 404 when it is gone.
 */
export async function loadPayoutContext(prisma, payoutId) {
  const payout = await prisma.payout.findUnique({ where: { id: payoutId } })

  if (!payout) throw notFound('No such payout.')

  const account = payout.connectedAccountId
    ? await prisma.connectedAccount.findUnique({ where: { id: payout.connectedAccountId } })
    : null

  return { payout, account }
}
