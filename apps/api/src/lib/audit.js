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
  // Written by no route: migration 20260929100000_check_in_per_night writes
  // one, with no actor, for each ticket whose earlier admission it gave a night
  // (and, for a pass good for every night, made VALID again). The metadata says
  // which night, how it was chosen, and the checkedInAt it cleared. Named here
  // so a query for those rows spells the action the same.
  TICKET_ADMISSION_NIGHT_BACKFILLED: 'ticket.admission_night_backfilled',
  /**
   * A door looked a ticket up without admitting it.
   *
   * Written for every preview the caller was authorised to make, whatever it
   * found, so a scanner that previews hundreds of tickets it never admits is
   * visible. The presented pass or code is never recorded.
   */
  TICKET_ADMISSION_PREVIEWED: 'ticket.admission_previewed',
  /**
   * A door was refused — for want of authority, or because the ticket may not
   * be admitted. Recorded against the ticket when one resolved, so a refused
   * attempt on a real ticket by somebody out of scope is on that ticket's record
   * even though the somebody was told nothing.
   */
  TICKET_ADMISSION_REFUSED: 'ticket.admission_refused',
  TICKET_REVOKED: 'ticket.revoked',
  TICKET_TRANSFER_STARTED: 'ticket.transfer_started',
  TICKET_TRANSFER_ACCEPTED: 'ticket.transfer_accepted',
  TICKET_TRANSFER_ENDED: 'ticket.transfer_ended',
  /// A holder asked for their own admission pass. The credential is not in the row.
  TICKET_PASS_ISSUED: 'ticket.pass_issued',
  /**
   * A platform super administrator looked up or admitted a ticket on its own
   * platform authority, at an event of an organisation it is not a member of.
   * Written on the Event, so the organisation's record shows platform presence
   * at its door. Ids, the operation and the outcome — never a credential,
   * code or preview reference.
   */
  TICKET_ADMISSION_PLATFORM_AUTHORITY: 'ticket.admission_platform_authority',
  /**
   * A buyer took their order's group pass out. The version and instant are
   * recorded; the QR content and the printed group code never are.
   */
  TICKET_GROUP_PASS_ISSUED: 'ticket.group_pass_issued',
  /**
   * A buyer replaced their order's group pass. The versions are recorded; the
   * old and new QR content and codes never are.
   */
  TICKET_GROUP_PASS_ROTATED: 'ticket.group_pass_rotated',
  /**
   * A door looked a group pass up without admitting anybody. Counts and the
   * method are recorded; the pass, its code and the preview reference never are.
   */
  TICKET_GROUP_ADMISSION_PREVIEWED: 'ticket.group_admission_previewed',
  /**
   * A door admitted people through a group pass, in one transaction, alongside
   * each ticket's own `ticket.checked_in` row. The ticket ids and counts are
   * recorded; the pass, its code and the preview reference never are.
   */
  TICKET_GROUP_ADMITTED: 'ticket.group_admitted',
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

  // --- Teams, organisations and platform roles -------------------------------
  //
  // An invitation's metadata records how its code went out (`deliveryMode`)
  // and never the code or its digest. A platform change records the reason the
  // administrator wrote. The first and third literals predate this map and are
  // unchanged, so a query over past rows still matches.
  TEAM_INVITED: 'team.invited',
  TEAM_INVITATION_REISSUED: 'team.invitation_reissued',
  TEAM_INVITATION_ACCEPTED: 'team.invitation_accepted',
  TEAM_OWNERSHIP_TRANSFERRED: 'team.ownership_transferred',
  ORGANIZATION_CREATED: 'organization.created',
  PLATFORM_ROLE_CHANGED: 'platform.role_changed',
  PLATFORM_MEMBERSHIP_GRANTED: 'platform.membership_granted',

  // --- Event pictures ----------------------------------------------------------
  //
  // Metadata carries the asset id, kind, type, size, dimensions, checksum and
  // how long the description is. Never the description, never the bytes, and
  // never where the bytes are kept.
  EVENT_MEDIA_ADDED: 'event.media_added',
  EVENT_MEDIA_DESCRIBED: 'event.media_described',
  EVENT_MEDIA_REORDERED: 'event.media_reordered',
  EVENT_MEDIA_REMOVED: 'event.media_removed',
  // Written by no route: migration 20260928130000_event_media writes one, with
  // no actor, for each event whose external cover address it dropped. The
  // metadata keeps the address without its user name, password, query string
  // or fragment. Named here so a query for those rows spells the action the same.
  EVENT_COVER_ADDRESS_DROPPED: 'event.cover_address_dropped',
  MEDIA_APPROVED: 'moderation.media_approved',
  MEDIA_REJECTED: 'moderation.media_rejected',

  // --- Event authoring ----------------------------------------------------------
  //
  // Tier and session writes carry the changed field names, never their values;
  // a material change keeps its before and after, as the event's own does.
  EVENT_RESCHEDULED: 'event.rescheduled',
  EVENT_SESSION_MATERIAL_CHANGE: 'event.session_material_change',
  /**
   * Seats assigned to, or taken back from, the reserved ticket type pricing
   * their zone. Counts and the session, never a seat list.
   */
  SEATS_BOUND: 'event.seats_bound',

  // Commerce. Promo code writes carry ids, the discount's terms and its
  // window, never the code's text; a hold reclaimed on the way to a new seat
  // hold carries the seats' count, never who held them.
  PROMO_CREATED: 'promo.created',
  PROMO_PAUSED: 'promo.paused',
  PROMO_RESUMED: 'promo.resumed',
  PROMO_DELETED: 'promo.deleted',
  HOLD_RECLAIMED: 'hold.reclaimed',
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
