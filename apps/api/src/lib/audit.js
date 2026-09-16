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
  RECONCILIATION_CLAIMED: 'reconciliation.claimed',
  RECONCILIATION_REQUERIED: 'reconciliation.requeried',
  RECONCILIATION_RESOLVED: 'reconciliation.resolved',
  RECONCILIATION_ESCALATED: 'reconciliation.escalated',
  RECONCILIATION_NOTED: 'reconciliation.noted',
  PAYOUT_SCHEDULED: 'payout.scheduled',
  PAYOUT_HELD: 'payout.held',
  PAYOUT_SUBMITTED: 'payout.submitted',
  PAYOUT_PAID: 'payout.paid',
  PAYOUT_FAILED: 'payout.failed',
  PAYOUT_REVERSED: 'payout.reversed',
  PAYOUT_RECONCILIATION_REQUIRED: 'payout.reconciliation_required',
  TRANSFER_PAID: 'transfer.paid',
  TRANSFER_REVERSED: 'transfer.reversed',
  DISPUTE_OPENED: 'dispute.opened',
  DISPUTE_WON: 'dispute.won',
  DISPUTE_LOST: 'dispute.lost',
  TICKET_CHECKED_IN: 'ticket.checked_in',
  TICKET_REVOKED: 'ticket.revoked',
  TICKET_TRANSFER_STARTED: 'ticket.transfer_started',
  TICKET_TRANSFER_ACCEPTED: 'ticket.transfer_accepted',
  TICKET_TRANSFER_ENDED: 'ticket.transfer_ended',
  NOTIFICATION_REQUEUED: 'notification.requeued',
  NOTIFICATION_CANCELLED: 'notification.cancelled',
  REFUND_REQUESTED: 'refund.requested',
  REFUND_APPROVED: 'refund.approved',
  REFUND_SETTLED: 'refund.settled',
  REFUND_FAILED: 'refund.failed',
  REFUND_TIMEOUT: 'refund.timeout',
  REFUND_CANCELLED: 'refund.cancelled',
  VERIFICATION_SUBMITTED: 'organization.verification_submitted',
  VENUE_CREATED: 'venue.created',
  VENUE_UPDATED: 'venue.updated',
  VENUE_MERGED: 'venue.merged',
  VENUE_MAP_CREATED: 'venueMap.created',
  VENUE_MAP_VERSION_CREATED: 'venueMap.version_created',
  VENUE_MAP_LAYOUT_WRITTEN: 'venueMap.layout_written',
  VENUE_MAP_PUBLISHED: 'venueMap.published',
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
