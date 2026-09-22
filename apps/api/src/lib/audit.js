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

import { CONNECT_AUDIT_ACTIONS } from '@desi-event/schemas'

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
  // Read at apps/api/src/routes/organizers.js and absent from this map until
  // Phase 3, so that call site passed `action: undefined` to a NOT NULL column.
  // It has never failed in a test because the Prisma test double applies no
  // required-column checks and no integration suite covers the decision route;
  // against real PostgreSQL the whole moderation transaction would have rolled
  // back. Added here rather than left for somebody to find at a moderator's
  // desk.
  VERIFICATION_DECIDED: 'organization.verification_decided',
  VENUE_CREATED: 'venue.created',
  VENUE_UPDATED: 'venue.updated',
  VENUE_MERGED: 'venue.merged',
  VENUE_MAP_CREATED: 'venueMap.created',
  VENUE_MAP_VERSION_CREATED: 'venueMap.version_created',
  VENUE_MAP_LAYOUT_WRITTEN: 'venueMap.layout_written',
  VENUE_MAP_PUBLISHED: 'venueMap.published',

  // --- Personal data --------------------------------------------------------
  //
  // The privacy actions are also written to `PrivacyAuditEvent`, which carries
  // them as columns rather than as free-form JSON and is immutable at the
  // database. These rows exist so that the one audit surface an operator
  // already reads does not go quiet about the most consequential action the
  // system can take.
  //
  // Their metadata carries counts, category names, reason codes and opaque ids.
  // Never a value, old or new; never an address; never a name.
  PRIVACY_REQUEST_RAISED: 'privacy.request_raised',
  PRIVACY_REQUEST_CONFIRMED: 'privacy.request_confirmed',
  PRIVACY_REQUEST_REFUSED: 'privacy.request_refused',
  PRIVACY_REQUEST_CANCELLED: 'privacy.request_cancelled',
  PRIVACY_REDACTION_STARTED: 'privacy.redaction_started',
  PRIVACY_REDACTION_COMPLETED: 'privacy.redaction_completed',
  PRIVACY_REDACTION_FAILED_SAFE: 'privacy.redaction_failed_safe',
  PRIVACY_HOLD_PLACED: 'privacy.hold_placed',
  PRIVACY_HOLD_RELEASED: 'privacy.hold_released',
  PRIVACY_EXPORT_INVALIDATED: 'privacy.export_invalidated',
  PRIVACY_EXPORT_DELETED: 'privacy.export_deleted',
  PRIVACY_RETENTION_SWEEP_RAN: 'privacy.retention_sweep_ran',
  // The simulated connected-account lifecycle. The strings come from
  // `@desi-event/schemas/connect` rather than being spelled again here, because
  // the same closed vocabulary is what the shared module asserts is closed — two
  // copies would be two things to keep in step, and the first symptom of them
  // drifting would be an audit query that quietly matches nothing.
  CONNECT_MOCK_ACCOUNT_CREATED: CONNECT_AUDIT_ACTIONS.MOCK_ACCOUNT_CREATED,
  CONNECT_MOCK_STATE_ADVANCED: CONNECT_AUDIT_ACTIONS.MOCK_STATE_ADVANCED,
  CONNECT_MOCK_ACTION_REFUSED: CONNECT_AUDIT_ACTIONS.MOCK_ACTION_REFUSED,
  CONNECT_MOCK_START_REPLAYED: CONNECT_AUDIT_ACTIONS.MOCK_START_REPLAYED,
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
  // `AuditLog.action` is NOT NULL, so a missing action is a rolled-back
  // transaction against real PostgreSQL and a silently stored row against the
  // test double — which is how `AUDIT_ACTIONS.VERIFICATION_DECIDED` being
  // undefined survived two phases. Failing here names the caller instead.
  //
  // Deliberately not a membership check against AUDIT_ACTIONS: around thirty
  // call sites still pass a bare literal, and closing that vocabulary is a
  // cross-cutting change rather than this one's job.
  if (typeof action !== 'string' || action.trim() === '') {
    throw new TypeError(
      `An audit row needs an action; ${entityType ?? 'an entity'} ${entityId ?? ''} was given ${String(action)}. Add the name to AUDIT_ACTIONS.`,
    )
  }

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
