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
  // A refund row written before refunds reserved anything (event cancellation
  // wrote them with `createMany`), reserved or replaced on first touch.
  REFUND_RESERVATION_REPAIRED: 'refund.reservation_repaired',
  // A payment the provider says succeeded for an order that was no longer
  // waiting for one. Recorded instead of `order.paid`, beside a
  // PROVIDER_MISMATCH task, because the money was taken.
  PAYMENT_SUCCEEDED_AFTER_CLOSE: 'payment.succeeded_after_close',
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

  // --- Organiser invitations and code delivery -------------------------------
  //
  // An organiser invitation is how anybody comes to post events. Metadata
  // carries how the code went out (`deliveryMode`) and identifiers; never the
  // address, the note, the code or its digest. `ORGANIZATION_VERIFIED_BY_INVITATION`
  // is written with the inviting administrator as its actor: they vouched for
  // the organisation. A `*_DELIVERY_FAILED` row is written in the transaction
  // that withdrew what a failed email had issued.
  ORGANIZER_INVITATION_ISSUED: 'organizer_invitation.issued',
  ORGANIZER_INVITATION_REISSUED: 'organizer_invitation.reissued',
  ORGANIZER_INVITATION_REVOKED: 'organizer_invitation.revoked',
  ORGANIZER_INVITATION_ACCEPTED: 'organizer_invitation.accepted',
  ORGANIZER_INVITATION_DELIVERY_FAILED: 'organizer_invitation.delivery_failed',
  ORGANIZATION_VERIFIED_BY_INVITATION: 'organization.verified_by_invitation',
  TEAM_INVITATION_DELIVERY_FAILED: 'team.invitation_delivery_failed',
  TICKET_TRANSFER_DELIVERY_FAILED: 'ticket.transfer_delivery_failed',

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

  // --- Full control of posted events (SPEC2-XI X) ------------------------------
  //
  // Each written inside the transaction that made the change. A deletion's
  // metadata carries the status it left, the outcome, whose authority, the
  // sitting and its reason when it was the doing of the team at The Desi Events, the counts and
  // whether the web address was released; never a buyer, an amount per order
  // or an address. `event.refunds_driven` is the one written after the
  // provider calls, in its own transaction, with the driver's counts.
  EVENT_DELETED: 'event.deleted',
  EVENT_RESTORED: 'event.restored',
  EVENT_PLATFORM_EDIT_OPENED: 'event.platform_edit_opened',
  EVENT_PLATFORM_EDIT_CLOSED: 'event.platform_edit_closed',
  EVENT_SESSION_CANCELLED: 'event.session_cancelled',
  EVENT_REFUNDS_DRIVEN: 'event.refunds_driven',
  /**
   * A replacement cover approved: the cover it replaced was removed in the
   * same transaction, beside `moderation.media_approved`.
   */
  EVENT_MEDIA_REPLACEMENT_APPLIED: 'event.media_replacement_applied',

  // --- Importing listed events (SPEC2-XI I) -----------------------------------
  //
  // Each written inside the transaction that made the change. A run's rows
  // carry its id, the file's name and digest and the counts; an event's carry
  // the listing's id, the run and whether the web or the command line did it
  // (`via`). Never an address on the source's site, and never the dataset.
  // (`event_import.images_retried` was written until 2026-10-15, when the
  // importer stopped copying pictures; older rows keep it.)
  EVENT_IMPORT_PREVIEWED: 'event_import.previewed',
  EVENT_IMPORT_APPLIED: 'event_import.applied',
  EVENT_IMPORTED: 'event.imported',
  /** "Approve and publish" put a posted import's waiting ticket types on sale. */
  EVENT_IMPORT_SALES_OPENED: 'event_import.sales_opened',
  /**
   * "Approve and publish all pending imported events": one row for the whole
   * request, beside each event's own `event.approved` and `event.published`
   * rows. Its metadata holds the digest the administrator confirmed, how many
   * went on sale, were published with nothing to sell or were refused, the
   * runs the events came from, and each refusal's event and code. Nothing
   * secret: no session, no second factor, no address.
   */
  EVENT_IMPORT_BULK_APPROVED: 'event_import.bulk_approved',
  EVENT_IMPORT_REASSIGNED: 'event.import_reassigned',
  ORGANIZATION_PLATFORM_HELD_CREATED: 'organization.platform_held_created',
  /**
   * The platform-held organisation was brought to the name, web address or
   * description its source is given now. Carries the changed column names and
   * the new web address, never the old values.
   */
  ORGANIZATION_PLATFORM_HELD_UPDATED: 'organization.platform_held_updated',

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
  /**
   * A platform administrator turned an event's website link on or off
   * (`lib/website-redirect.js`, the only writer of the switch), in the
   * transaction that changed it. Metadata: on or off, what it was before and
   * whether a decision was waiting, the administrator's reason, the decided
   * address in full (credential-free by rule) with its host, the address
   * decided before, the actor's platform role and the event's status. Never a
   * visitor.
   */
  EVENT_WEBSITE_REDIRECT_CHANGED: 'event.website_redirect_changed',

  // --- Booking fees, referral codes and paying at the venue (SPEC3 §4.3) -----
  //
  // Each written inside the transaction that made the change. Never a referral
  // code's text and never its label's text: a label is recorded only as
  // `labelSet` or `labelChanged` (the label is free text an administrator
  // typed, and an audit row is kept for good).
  /**
   * An administrator set an event's own booking fee or returned it to the
   * site default (`lib/payment-terms.js`, the only writer). Metadata:
   * `sequence`, `source`, `percentageBps`, `flatCentsPerTicket`, `currency`,
   * `previous` (the same keys, or null), `reason`, `eventStatus`,
   * `platformRole`.
   */
  EVENT_PLATFORM_FEE_CHANGED: 'event.platform_fee_changed',
  /**
   * An administrator switched paying at the venue on or off, or changed its
   * limit (`lib/payment-terms.js`). Metadata: `enabled`, `limit`,
   * `previousEnabled`, `previousLimit`, `reason`, `eventStatus`,
   * `platformRole`.
   */
  EVENT_VENUE_PAYMENT_CHANGED: 'event.venue_payment_changed',
  /**
   * A referral code was made (`lib/referral-codes.js`). Metadata:
   * `referralCodeId`, `generated`, `scope`, `eventIds`, `expiresAt`,
   * `maxUses`, `labelSet`, `requestId`.
   */
  REFERRAL_CODE_CREATED: 'referral_code.created',
  /**
   * A referral code's scope, expiry, limit or label changed. Metadata:
   * `referralCodeId`, `changes: {field: {from, to}}` for `scope`, `eventIds`,
   * `expiresAt` and `maxUses`, and `labelChanged: true` when the label did.
   */
  REFERRAL_CODE_UPDATED: 'referral_code.updated',
  /** A referral code was switched off. Metadata: `referralCodeId`, `reason` (nullable). */
  REFERRAL_CODE_SWITCHED_OFF: 'referral_code.switched_off',
  /** A referral code was switched back on. Metadata: `referralCodeId`. */
  REFERRAL_CODE_SWITCHED_ON: 'referral_code.switched_on',
  /**
   * A payment taken at the door, recorded with the admission it paid for
   * (`lib/venue-payments.js`). Metadata: `venuePaymentId`, `orderId`,
   * `eventId`, `eventSessionId`, `ticketCount`, `amountCents`, `currency`,
   * `via`, `authority`, `role`, `organizationId`. Never the buyer.
   */
  VENUE_PAYMENT_RECORDED: 'venue_payment.recorded',

  // --- Unpaid tickets cancelled and referral uses given back (SPEC3-XI §4.3) --
  /**
   * Unpaid pay-at-the-venue tickets of one booking were cancelled by an
   * organiser or the team at The Desi Events (`lib/venue-bookings.js`, the only
   * writer), in the cancelling transaction. Metadata: `cancellationId`,
   * `orderId`, `eventId`, `organizationId`, `ticketIds`, `ticketCount`,
   * `basisCents`, `feeKeptCents`, `currency`, `seatsReturned`,
   * `placesReturned` (`{ ticketTypeId: n }`), `placesOnSale`, `authority`,
   * `role`, `reason`, `requestId`. No kept tax: only the booking fee is ever
   * kept. Never the buyer.
   */
  VENUE_BOOKING_CANCELLED: 'venue_booking.cancelled',
  /**
   * An order that used a referral code ended without being used and gave its
   * use back, once (`lib/referral-uses.js`, the only writer), one row per
   * order. Metadata: `referralCodeId`, `orderId`, `cause`, `requestId`. Never
   * a code's text or label.
   */
  REFERRAL_USE_RETURNED: 'referral_code.use_returned',

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
