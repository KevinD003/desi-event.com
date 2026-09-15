/**
 * Audit trail writes.
 *
 * Every privileged state change records who did it, to what, why, and what the
 * state was before and after. The row is written inside the same transaction as
 * the change it describes, so an audit entry cannot exist for a change that
 * rolled back, nor a change go unrecorded.
 *
 * @module @desi-event/api/lib/audit
 */

/** Actions the audit trail records. */
export const AUDIT_ACTIONS = Object.freeze({
  HOLD_CREATED: 'hold.created',
  SEATS_HELD: 'hold.seats_held',
  HOLD_RELEASED: 'hold.released',
  HOLD_RELEASE_DENIED: 'hold.release_denied',
  ORDER_PAID: 'order.paid',
  ORDER_CANCELLED: 'order.cancelled',
  PAYMENT_TIMEOUT: 'payment.timeout',
  PAYMENT_DECLINED: 'payment.declined',
  WEBHOOK_RECEIVED: 'webhook.received',
  WEBHOOK_PROCESSED: 'webhook.processed',
  WEBHOOK_DEAD_LETTERED: 'webhook.dead_lettered',
  RECONCILIATION_OPENED: 'reconciliation.opened',
  VERIFICATION_SUBMITTED: 'organization.verification_submitted',
  VENUE_CREATED: 'venue.created',
  VENUE_UPDATED: 'venue.updated',
  VENUE_MERGED: 'venue.merged',
})

/**
 * Write one audit row.
 *
 * @param {object} tx A Prisma client or transaction client.
 * @param {object} entry The entry.
 * @param {string} entry.action One of {@link AUDIT_ACTIONS}.
 * @param {string} entry.entityType The model name, e.g. `TicketHold`.
 * @param {string} entry.entityId The row id.
 * @param {string|null} [entry.actorId] The verified actor, or null for an anonymous or system action.
 * @param {object} [entry.metadata] Context: reason, request id, previous and new state.
 * @returns {Promise<object>} The created row.
 */
export async function recordAudit(
  tx,
  { action, entityType, entityId, actorId = null, metadata = {} },
) {
  return tx.auditLog.create({
    data: {
      action,
      entityType,
      entityId,
      // A null actor is meaningful: it distinguishes a guest or the expiry
      // worker from a signed-in user, and the mode in `metadata` says which.
      actorId: actorId ?? null,
      metadata,
    },
  })
}
