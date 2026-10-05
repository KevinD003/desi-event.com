/**
 * Runtime mirrors of the Prisma enums.
 *
 * These are hand-written rather than derived from `@desi-event/db` on purpose:
 * the browser bundle imports schemas but must never pull in `@prisma/client`.
 *
 * `enums.test.js` guards the two definitions against drifting apart, and since
 * Phase 2 it does so by **parsing `schema.prisma`** rather than comparing this
 * file against a second hand-written copy of the same lists. The old guard could
 * not detect drift at all: when the corrective cycle added `PENDING` and
 * `TIMEOUT` to the Prisma `PaymentStatus`, neither this file nor the test's
 * expectation was updated, both sides still agreed with each other, and the
 * suite stayed green while `paymentStatusSchema` rejected two states the
 * application actually writes. Recorded as NF-03.
 *
 * Every Prisma enum must either appear here or be listed in the test's
 * `NOT_MIRRORED` map with a reason.
 *
 * @module @desi-event/schemas/enums
 */

import { z } from 'zod'

import { TRAFFIC_EVENT_KINDS, TRAFFIC_PLACEMENTS, TRAFFIC_SOURCES } from './traffic-vocabulary.js'

/**
 * Event statuses that are visible to the public.
 *
 * The single list every public query reads. Phase 1 had one publicly visible
 * status and filtered on the literal `'PUBLISHED'` in five places; Phase 2 has
 * four, and a literal in five places is four opportunities to leak a draft.
 *
 * `SALES_PAUSED` and `SOLD_OUT` are public because a visitor who followed a
 * link to a sold-out show should see the show, not a 404 — they differ from
 * `ON_SALE` only in whether the buy button does anything.
 *
 * @type {string[]}
 */
export const PUBLIC_EVENT_STATUSES = Object.freeze([
  'PUBLISHED',
  'ON_SALE',
  'SALES_PAUSED',
  'SOLD_OUT',
])

/**
 * Platform roles. `ADMIN` is the platform administrator (it invites organisers,
 * reviews, and switches website links), not Phase 1's catch-all, which became
 * `SUPER_ADMIN`.
 */
export const USER_ROLES = Object.freeze([
  'ATTENDEE',
  'ORGANIZER',
  'SUPPORT',
  'MODERATOR',
  'FINANCE_ADMIN',
  'ADMIN',
  'SUPER_ADMIN',
])

export const ORG_ROLES = Object.freeze([
  'OWNER',
  'ADMIN',
  'EVENT_MANAGER',
  'FINANCE',
  'MANAGER',
  'STAFF',
  'SCANNER',
  'VIEWER',
])

export const EVENT_CATEGORIES = Object.freeze([
  'MUSIC_CONCERT',
  'GARBA_DANDIYA',
  'BOLLYWOOD_NIGHT',
  'CLASSICAL_DANCE',
  'COMEDY',
  'FILM_SCREENING',
  'CULTURAL_FESTIVAL',
  'FOOD_FESTIVAL',
  'WEDDING_EXPO',
  'RELIGIOUS',
  'THEATRE',
  'WORKSHOP',
  'NETWORKING',
  'SPORTS',
])

export const EVENT_STATUSES = Object.freeze([
  'DRAFT',
  'REVIEW_PENDING',
  'CHANGES_REQUIRED',
  'APPROVED',
  'PUBLISHED',
  'ON_SALE',
  'SALES_PAUSED',
  'SOLD_OUT',
  'COMPLETED',
  'POSTPONED',
  'CANCELLED',
  'REJECTED',
  'ARCHIVED',
  // Taken off the site by its organiser or the Desi-Event team, and kept. On
  // none of the allow-lists (public, bookable, indexable, live, editable), and
  // private by derivation: PRIVATE_EVENT_STATUSES is everything not public.
  'DELETED',
])

/**
 * What deleting an event did, as the database stores it. The wire names of the
 * three outcomes are `DELETION_OUTCOMES` in `./lifecycle.js`
 * (`REMOVE | CANCEL_AND_REFUND | REMOVE_AFTER_EVENT`).
 */
export const EVENT_DELETION_OUTCOMES = Object.freeze([
  'REMOVED',
  'CANCELLED_AND_REFUNDED',
  'REMOVED_AFTER_EVENT',
])

/** Whose authority a change to an event was made under. */
export const EVENT_AUTHORITIES = Object.freeze(['ORGANIZATION', 'PLATFORM'])

/** What a ticket holder is told changed about an event. */
export const EVENT_CHANGE_KINDS = Object.freeze([
  'MATERIAL_CHANGE',
  'SESSION_CHANGE',
  'RESCHEDULED',
  'POSTPONED',
  'CANCELLED',
  'SESSION_CANCELLED',
  'DELETED',
])

/** How a platform edit sitting ended. */
export const PLATFORM_EDIT_ENDS = Object.freeze([
  'CLOSED',
  'SUPERSEDED',
  'EVENT_DELETED',
  'EXPIRED',
])

/** Where an imported event was listed first. */
export const EVENT_IMPORT_SOURCES = Object.freeze(['SULEKHA'])

/** An import run: planned, applied once, or expired. */
export const EVENT_IMPORT_RUN_STATUSES = Object.freeze(['PREVIEWED', 'APPLIED', 'EXPIRED'])

/** Whether an imported event's picture has been copied yet. */
export const EVENT_IMPORT_IMAGE_STATUSES = Object.freeze(['WAITING', 'STORED', 'FAILED'])

/** What the source listed a picture as. */
export const EVENT_IMPORT_IMAGE_ROLES = Object.freeze(['COVER', 'GALLERY'])

export const TICKET_TYPE_STATUSES = Object.freeze([
  'DRAFT',
  'ON_SALE',
  'PAUSED',
  'SOLD_OUT',
  'CLOSED',
])

/**
 * Who can see a ticket type on the public event page. HIDDEN is not listed
 * publicly and is bookable only by members holding `ticketType:manage`; every
 * complimentary tier is HIDDEN.
 */
export const TICKET_TYPE_VISIBILITIES = Object.freeze(['PUBLIC', 'HIDDEN'])

export const HOLD_STATUSES = Object.freeze(['ACTIVE', 'CONVERTED', 'RELEASED', 'EXPIRED'])

export const ORDER_STATUSES = Object.freeze(['PENDING', 'PAID', 'CANCELLED', 'REFUNDED', 'EXPIRED'])

export const TICKET_STATUSES = Object.freeze([
  'VALID',
  'TRANSFER_PENDING',
  'REVOKED',
  'CHECKED_IN',
  'VOID',
  'REFUNDED',
  'TRANSFERRED',
  'SUPERSEDED',
  'CANCELLED',
])

export const PAYMENT_STATUSES = Object.freeze([
  'INITIATED',
  'PENDING',
  'SUCCEEDED',
  'FAILED',
  'TIMEOUT',
  'REQUIRES_ACTION',
  'CANCELLED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
])

export const WEBHOOK_STATES = Object.freeze([
  'RECEIVED',
  'PROCESSING',
  'PROCESSED',
  'IGNORED',
  'FAILED',
  'DEAD_LETTER',
])

export const PROMO_TYPES = Object.freeze(['PERCENTAGE', 'FIXED_AMOUNT'])

export const MFA_FACTOR_TYPES = Object.freeze(['TOTP', 'RECOVERY_CODE', 'WEBAUTHN'])

export const AUTH_TOKEN_PURPOSES = Object.freeze([
  'EMAIL_VERIFICATION',
  'PASSWORD_RESET',
  'TICKET_CLAIM',
  'TICKET_TRANSFER',
  'CONNECT_ONBOARDING',
])

export const VERIFICATION_STATUSES = Object.freeze([
  'UNVERIFIED',
  'PENDING',
  'REQUIRES_INFORMATION',
  'VERIFIED',
  'REJECTED',
  'SUSPENDED',
  'REVOKED',
])

export const INVITATION_STATUSES = Object.freeze(['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED'])

/**
 * How an invitation's code reached the invitee: EMAIL through the provider, or
 * MANUAL, shown once to the inviter. An invitation issued before delivery
 * modes existed has none.
 */
export const INVITATION_DELIVERY_MODES = Object.freeze(['EMAIL', 'MANUAL'])

export const SECTION_KINDS = Object.freeze(['SEATED', 'STANDING', 'TABLE'])

export const EVENT_SESSION_STATUSES = Object.freeze([
  'SCHEDULED',
  'ON_SALE',
  'SALES_PAUSED',
  'SOLD_OUT',
  'CANCELLED',
  'COMPLETED',
])

export const EVENT_SEAT_STATUSES = Object.freeze([
  'AVAILABLE',
  'HELD',
  'SOLD',
  'BLOCKED',
  'COMPLIMENTARY',
  'KILLED',
])

export const MEDIA_MODERATION_STATUSES = Object.freeze(['PENDING', 'APPROVED', 'REJECTED'])

/** What an event picture is for: the one cover, or one of up to eight gallery pictures. */
export const MEDIA_KINDS = Object.freeze(['EVENT_COVER', 'EVENT_GALLERY'])

export const MEDIA_SCAN_STATUSES = Object.freeze(['PENDING', 'CLEAN', 'INFECTED', 'ERROR'])

export const CONNECT_ONBOARDING_STATUSES = Object.freeze([
  'NOT_STARTED',
  'IN_PROGRESS',
  'REQUIREMENTS_DUE',
  'COMPLETE',
  'DISABLED',
])

export const REFUND_STATUSES = Object.freeze([
  'REQUESTED',
  'APPROVED',
  'SUBMITTED',
  'SUCCEEDED',
  'DECLINED',
  'FAILED',
  'TIMEOUT',
  'RECONCILIATION_REQUIRED',
  'CANCELLED',
  // Retained spellings from the Phase 2 schema. No code writes them; a row
  // that already carries one stays readable, and dropping an enum label is
  // the one schema change PostgreSQL cannot do without rewriting the type.
  'PROCESSING',
  'REJECTED',
])

export const REFUND_REASONS = Object.freeze([
  'EVENT_CANCELLED',
  'EVENT_POSTPONED',
  'DUPLICATE_ORDER',
  'CUSTOMER_REQUEST',
  'ORGANIZER_GOODWILL',
  'FRAUDULENT',
  'OTHER',
])

export const DISPUTE_STATUSES = Object.freeze([
  'OPENED',
  'NEEDS_RESPONSE',
  'UNDER_REVIEW',
  'CHARGE_REFUNDED',
  'WON',
  'LOST',
  'CLOSED',
  'WARNING_NEEDS_RESPONSE',
  'WARNING_CLOSED',
])

export const TRANSFER_STATUSES = Object.freeze([
  'PENDING',
  'SUBMITTED',
  /** Retained spelling, superseded by SUBMITTED. */
  'SENT',
  'PAID',
  'FAILED',
  'REVERSED',
  'PARTIALLY_REVERSED',
  'RECONCILIATION_REQUIRED',
])

export const PAYOUT_STATUSES = Object.freeze([
  'SCHEDULED',
  'SUBMITTED',
  'PAID',
  'FAILED',
  'REVERSED',
  'HELD',
  'RECONCILIATION_REQUIRED',
  'CANCELLED',
  // Retained spellings. No code writes them.
  'PENDING',
  'IN_TRANSIT',
])

export const LEDGER_ACCOUNT_TYPES = Object.freeze([
  'ASSET',
  'LIABILITY',
  'REVENUE',
  'EXPENSE',
  'CONTRA_REVENUE',
])

export const LEDGER_BATCH_STATUSES = Object.freeze(['DRAFT', 'POSTED', 'VOID'])

export const LEDGER_BATCH_KINDS = Object.freeze([
  'ORDER_PAID',
  'REFUND',
  'DISPUTE_OPENED',
  'DISPUTE_RESOLVED',
  'TRANSFER',
  'TRANSFER_REVERSAL',
  'PAYOUT',
  'PLATFORM_FEE',
  'CORRECTION',
])

export const LEDGER_DIRECTIONS = Object.freeze(['DEBIT', 'CREDIT'])

export const TICKET_TRANSFER_STATUSES = Object.freeze([
  'PENDING',
  'ACCEPTED',
  'DECLINED',
  'CANCELLED',
  'EXPIRED',
])

/**
 * Every value the database's `CheckInMethod` type declares.
 *
 * `MANUAL_CODE` was `MANUAL_LOOKUP` until the Phase 4 admission work renamed it
 * in place, so existing rows kept their meaning. `ASSISTED` is declared and
 * written by nothing: the server cannot tell a code a steward read aloud from
 * one they typed, so there is no truthful way to record it. See
 * {@link RECORDED_CHECK_IN_METHODS}.
 */
export const CHECK_IN_METHODS = Object.freeze(['QR_SCAN', 'MANUAL_CODE', 'ASSISTED'])

/**
 * The methods an admission can actually be recorded with.
 *
 * Derived by the server from what was presented — the secure credential from a
 * pass, or the printed reference — and never chosen by the client. A browser
 * that could label its own admissions could call a typed code a QR scan.
 */
export const RECORDED_CHECK_IN_METHODS = Object.freeze(['QR_SCAN', 'MANUAL_CODE'])

/**
 * Why a door refused a ticket, in words a scanner can branch on.
 *
 * A closed vocabulary rather than sentences, so a scanner screen can choose its
 * own wording and an audit query can count refusals by kind. The first seven
 * come from the ticket, its order or its event; the rest from the
 * admission workflow itself.
 */
export const ADMISSION_REFUSAL_REASONS = Object.freeze([
  'REFUNDED',
  'REVOKED',
  'TRANSFERRED',
  'CANCELLED',
  'SUPERSEDED',
  'VOID',
  'NOT_ADMISSIBLE',
  'ORDER_NOT_PAID',
  'EVENT_CANCELLED',
  'WRONG_EVENT',
  /**
   * The ticket is for one night and the door is admitting to another, or the
   * door named a night that is not one of the event's.
   */
  'WRONG_NIGHT',
  /**
   * The event has more than one night and the door did not say which it is
   * admitting to. Nothing is guessed from the clock.
   */
  'NIGHT_REQUIRED',
  'PREVIEW_EXPIRED',
  'PREVIEW_INVALID',
  'PREVIEW_MISMATCH',
  /**
   * A group confirmation found that a ticket it named stopped admitting after
   * the lookup — refunded, withdrawn, handed on. Nothing was admitted; the
   * group is looked up again.
   */
  'GROUP_CHANGED',
])

/** What an admission preview found. */
export const ADMISSION_PREVIEW_OUTCOMES = Object.freeze([
  'ADMISSIBLE',
  'ALREADY_CHECKED_IN',
  'REFUSED',
])

/** What a confirmed admission did. Refusals are 409s and carry a reason instead. */
export const CHECK_IN_OUTCOMES = Object.freeze(['ADMITTED', 'ALREADY_CHECKED_IN'])

/**
 * Where the authority for an admission came from.
 *
 * `PLATFORM_ROLE` is a platform super administrator admitting at an event of
 * an organisation it holds no membership in (ADR 0007). Recorded distinctly so
 * the organisation can see it.
 */
export const ADMISSION_AUTHORITIES = Object.freeze([
  'ORGANIZATION_ROLE',
  'EVENT_SCOPE',
  'PLATFORM_ROLE',
])

/**
 * The role an admission authority rests on: an organisation role, or the one
 * platform role that may admit.
 */
export const ADMISSION_ROLES = Object.freeze([...ORG_ROLES, 'SUPER_ADMIN'])

/**
 * Whose door events a list covers: the caller's own memberships, or every
 * organisation on the platform (a super administrator).
 */
export const ADMISSION_EVENT_SCOPES = Object.freeze(['MEMBERSHIPS', 'PLATFORM'])

/** The fewest tickets a group pass covers. One ticket has its own pass. */
export const GROUP_PASS_MIN_TICKETS = 2

/**
 * The most tickets a group pass covers.
 *
 * The order-line bound (`quantitySchema`), and the most one admitting
 * transaction is asked to lock.
 */
export const GROUP_PASS_MAX_TICKETS = 50

/** Why an order has no group pass to show. */
export const GROUP_PASS_UNAVAILABLE_REASONS = Object.freeze([
  'TOO_FEW_TICKETS',
  'TOO_MANY_TICKETS',
  'ORDER_NOT_PAID',
  'EVENT_CANCELLED',
])

export const NOTIFICATION_CHANNELS = Object.freeze(['EMAIL', 'SMS', 'PUSH'])

export const NOTIFICATION_STATUSES = Object.freeze([
  'QUEUED',
  'CLAIMED',
  'SENT',
  'RETRY_SCHEDULED',
  'CANCELLED',
  'FAILED',
  'DEAD_LETTER',
  'SUPPRESSED',
  /** Retained spelling, superseded by CLAIMED. */
  'SENDING',
])

export const RECONCILIATION_STATES = Object.freeze(['OPEN', 'IN_PROGRESS', 'RESOLVED', 'ESCALATED'])

export const RECONCILIATION_KINDS = Object.freeze([
  'PAYMENT_TIMEOUT',
  'PROVIDER_MISMATCH',
  'REFUND_UNKNOWN',
  'WEBHOOK_DEAD_LETTER',
  'TRANSFER_STUCK',
])

// ---------------------------------------------------------------------------
// Zod enums
//
// One per mirrored list, so a schema can never accept a value the database
// would reject.
// ---------------------------------------------------------------------------

/** `USER_ROLES` as a Zod enum. */
export const userRoleSchema = z.enum([...USER_ROLES])

/**
 * The kinds of counted visit, as a list. The vocabulary itself, with the
 * placements, sources and their words, lives in `./traffic-vocabulary.js`,
 * which the browser imports without zod.
 */
export const TRAFFIC_EVENT_KIND_VALUES = Object.freeze(Object.values(TRAFFIC_EVENT_KINDS))

export { TRAFFIC_PLACEMENTS, TRAFFIC_SOURCES }

/** `TRAFFIC_EVENT_KIND_VALUES` as a Zod enum. */
export const trafficEventKindSchema = z.enum([...TRAFFIC_EVENT_KIND_VALUES])

/** `TRAFFIC_PLACEMENTS` as a Zod enum. */
export const trafficPlacementSchema = z.enum([...TRAFFIC_PLACEMENTS])

/** `TRAFFIC_SOURCES` as a Zod enum. */
export const trafficSourceSchema = z.enum([...TRAFFIC_SOURCES])

/** `ORG_ROLES` as a Zod enum. */
export const orgRoleSchema = z.enum([...ORG_ROLES])

/** `EVENT_CATEGORIES` as a Zod enum. */
export const eventCategorySchema = z.enum([...EVENT_CATEGORIES])

/** `EVENT_STATUSES` as a Zod enum. */
export const eventStatusSchema = z.enum([...EVENT_STATUSES])

/** `EVENT_DELETION_OUTCOMES` as a Zod enum. */
export const eventDeletionOutcomeSchema = z.enum([...EVENT_DELETION_OUTCOMES])

/** `EVENT_AUTHORITIES` as a Zod enum. */
export const eventAuthoritySchema = z.enum([...EVENT_AUTHORITIES])

/** `EVENT_CHANGE_KINDS` as a Zod enum. */
export const eventChangeKindSchema = z.enum([...EVENT_CHANGE_KINDS])

/** `PLATFORM_EDIT_ENDS` as a Zod enum. */
export const platformEditEndSchema = z.enum([...PLATFORM_EDIT_ENDS])

/** `EVENT_IMPORT_SOURCES` as a Zod enum. */
export const eventImportSourceSchema = z.enum([...EVENT_IMPORT_SOURCES])

/** `EVENT_IMPORT_RUN_STATUSES` as a Zod enum. */
export const eventImportRunStatusSchema = z.enum([...EVENT_IMPORT_RUN_STATUSES])

/** `EVENT_IMPORT_IMAGE_STATUSES` as a Zod enum. */
export const eventImportImageStatusSchema = z.enum([...EVENT_IMPORT_IMAGE_STATUSES])

/** `EVENT_IMPORT_IMAGE_ROLES` as a Zod enum. */
export const eventImportImageRoleSchema = z.enum([...EVENT_IMPORT_IMAGE_ROLES])

/** `TICKET_TYPE_STATUSES` as a Zod enum. */
export const ticketTypeStatusSchema = z.enum([...TICKET_TYPE_STATUSES])

/** `TICKET_TYPE_VISIBILITIES` as a Zod enum. */
export const ticketTypeVisibilitySchema = z.enum([...TICKET_TYPE_VISIBILITIES])

/** `HOLD_STATUSES` as a Zod enum. */
export const holdStatusSchema = z.enum([...HOLD_STATUSES])

/** `ORDER_STATUSES` as a Zod enum. */
export const orderStatusSchema = z.enum([...ORDER_STATUSES])

/** `TICKET_STATUSES` as a Zod enum. */
export const ticketStatusSchema = z.enum([...TICKET_STATUSES])

/** `PAYMENT_STATUSES` as a Zod enum. */
export const paymentStatusSchema = z.enum([...PAYMENT_STATUSES])

/** `WEBHOOK_STATES` as a Zod enum. */
export const webhookStateSchema = z.enum([...WEBHOOK_STATES])

/** `PROMO_TYPES` as a Zod enum. */
export const promoTypeSchema = z.enum([...PROMO_TYPES])

/** `MFA_FACTOR_TYPES` as a Zod enum. */
export const mfaFactorTypeSchema = z.enum([...MFA_FACTOR_TYPES])

/** `AUTH_TOKEN_PURPOSES` as a Zod enum. */
export const authTokenPurposeSchema = z.enum([...AUTH_TOKEN_PURPOSES])

/** `VERIFICATION_STATUSES` as a Zod enum. */
export const verificationStatusSchema = z.enum([...VERIFICATION_STATUSES])

/** `INVITATION_STATUSES` as a Zod enum. */
export const invitationStatusSchema = z.enum([...INVITATION_STATUSES])

/** `INVITATION_DELIVERY_MODES` as a Zod enum. */
export const invitationDeliveryModeSchema = z.enum([...INVITATION_DELIVERY_MODES])

/** `SECTION_KINDS` as a Zod enum. */
export const sectionKindSchema = z.enum([...SECTION_KINDS])

/** `EVENT_SESSION_STATUSES` as a Zod enum. */
export const eventSessionStatusSchema = z.enum([...EVENT_SESSION_STATUSES])

/** `EVENT_SEAT_STATUSES` as a Zod enum. */
export const eventSeatStatusSchema = z.enum([...EVENT_SEAT_STATUSES])

/** `MEDIA_MODERATION_STATUSES` as a Zod enum. */
export const mediaModerationStatusSchema = z.enum([...MEDIA_MODERATION_STATUSES])

/** `MEDIA_KINDS` as a Zod enum. */
export const mediaKindSchema = z.enum([...MEDIA_KINDS])

/** `MEDIA_SCAN_STATUSES` as a Zod enum. */
export const mediaScanStatusSchema = z.enum([...MEDIA_SCAN_STATUSES])

/** `CONNECT_ONBOARDING_STATUSES` as a Zod enum. */
export const connectOnboardingStatusSchema = z.enum([...CONNECT_ONBOARDING_STATUSES])

/** `REFUND_STATUSES` as a Zod enum. */
export const refundStatusSchema = z.enum([...REFUND_STATUSES])

/** `REFUND_REASONS` as a Zod enum. */
export const refundReasonSchema = z.enum([...REFUND_REASONS])

/** `DISPUTE_STATUSES` as a Zod enum. */
export const disputeStatusSchema = z.enum([...DISPUTE_STATUSES])

/** `TRANSFER_STATUSES` as a Zod enum. */
export const transferStatusSchema = z.enum([...TRANSFER_STATUSES])

/** `PAYOUT_STATUSES` as a Zod enum. */
export const payoutStatusSchema = z.enum([...PAYOUT_STATUSES])

/** `LEDGER_ACCOUNT_TYPES` as a Zod enum. */
export const ledgerAccountTypeSchema = z.enum([...LEDGER_ACCOUNT_TYPES])

/** `LEDGER_BATCH_STATUSES` as a Zod enum. */
export const ledgerBatchStatusSchema = z.enum([...LEDGER_BATCH_STATUSES])

/** `LEDGER_BATCH_KINDS` as a Zod enum. */
export const ledgerBatchKindSchema = z.enum([...LEDGER_BATCH_KINDS])

/** `LEDGER_DIRECTIONS` as a Zod enum. */
export const ledgerDirectionSchema = z.enum([...LEDGER_DIRECTIONS])

/** `TICKET_TRANSFER_STATUSES` as a Zod enum. */
export const ticketTransferStatusSchema = z.enum([...TICKET_TRANSFER_STATUSES])

/** `CHECK_IN_METHODS` as a Zod enum. */
export const checkInMethodSchema = z.enum([...CHECK_IN_METHODS])

/** `RECORDED_CHECK_IN_METHODS` as a Zod enum. */
export const recordedCheckInMethodSchema = z.enum([...RECORDED_CHECK_IN_METHODS])

/** `ADMISSION_REFUSAL_REASONS` as a Zod enum. */
export const admissionRefusalReasonSchema = z.enum([...ADMISSION_REFUSAL_REASONS])

/** `ADMISSION_PREVIEW_OUTCOMES` as a Zod enum. */
export const admissionPreviewOutcomeSchema = z.enum([...ADMISSION_PREVIEW_OUTCOMES])

/** `CHECK_IN_OUTCOMES` as a Zod enum. */
export const checkInOutcomeSchema = z.enum([...CHECK_IN_OUTCOMES])

/** `ADMISSION_AUTHORITIES` as a Zod enum. */
export const admissionAuthoritySchema = z.enum([...ADMISSION_AUTHORITIES])

/** `ADMISSION_ROLES` as a Zod enum. */
export const admissionRoleSchema = z.enum([...ADMISSION_ROLES])

/** `ADMISSION_EVENT_SCOPES` as a Zod enum. */
export const admissionEventScopeSchema = z.enum([...ADMISSION_EVENT_SCOPES])

/** `GROUP_PASS_UNAVAILABLE_REASONS` as a Zod enum. */
export const groupPassUnavailableReasonSchema = z.enum([...GROUP_PASS_UNAVAILABLE_REASONS])

/** `NOTIFICATION_CHANNELS` as a Zod enum. */
export const notificationChannelSchema = z.enum([...NOTIFICATION_CHANNELS])

/** `NOTIFICATION_STATUSES` as a Zod enum. */
export const notificationStatusSchema = z.enum([...NOTIFICATION_STATUSES])

/** `RECONCILIATION_STATES` as a Zod enum. */
export const reconciliationStateSchema = z.enum([...RECONCILIATION_STATES])

/** `RECONCILIATION_KINDS` as a Zod enum. */
export const reconciliationKindSchema = z.enum([...RECONCILIATION_KINDS])

/**
 * Event statuses that must never appear in a public listing, in metadata, in
 * structured data or in the sitemap.
 *
 * Derived from {@link PUBLIC_EVENT_STATUSES} rather than listed, so adding a
 * status to the enum without deciding its visibility makes it private by
 * default — which is the safe direction to be wrong in.
 *
 * @type {string[]}
 */
export const PRIVATE_EVENT_STATUSES = Object.freeze(
  EVENT_STATUSES.filter((status) => !PUBLIC_EVENT_STATUSES.includes(status)),
)

/** `PUBLIC_EVENT_STATUSES` as a Zod enum, for query parameters. */
export const publicEventStatusSchema = z.enum([...PUBLIC_EVENT_STATUSES])

// ---------------------------------------------------------------------------
// Personal data
//
// Phase 3. Mirrors of the Prisma enums behind redaction, holds, exports and
// retention. They live here with every other Prisma mirror so the drift guard
// in `enums.test.js` covers them: an enum added to the database and forgotten
// here fails that suite rather than surfacing as a 500 the first time somebody
// asks to be removed.
// ---------------------------------------------------------------------------

/** Why a redaction was asked for. Closed, so nobody records circumstances. */
export const PRIVACY_REQUEST_REASONS = Object.freeze([
  'SUBJECT_REQUEST',
  'ORGANIZER_REQUEST',
  'RETENTION_POLICY',
  'DATA_MINIMISATION',
])

/**
 * Where a redaction request is in its lifecycle.
 *
 * `PROCESSING` and `FAILED_SAFE` are distinct from `COMPLETED` because a
 * redaction that stopped halfway is the one case where a system must not round
 * its answer.
 */
export const PRIVACY_REQUEST_STATES = Object.freeze([
  'REQUESTED',
  'QUEUED',
  'PROCESSING',
  'COMPLETED',
  'HELD',
  'FAILED_SAFE',
  'CANCELLED',
])

/** What kind of matter is holding a subject's data in place. */
export const PRIVACY_HOLD_KINDS = Object.freeze(['LEGAL', 'FRAUD_INVESTIGATION'])

/** Whether a hold is still in force. Nothing expires one; a release is an act. */
export const PRIVACY_HOLD_STATES = Object.freeze(['ACTIVE', 'RELEASED'])

/**
 * What the hold evaluation concluded.
 *
 * A caller learns that a legal hold is active, never what it is about.
 */
export const PRIVACY_HOLD_DECISIONS = Object.freeze([
  'NOT_EVALUATED',
  'NONE_ACTIVE',
  'LEGAL_HOLD_ACTIVE',
  'FRAUD_HOLD_ACTIVE',
  'OPEN_PROCESS',
])

/** The outcome one privacy audit event records. */
export const PRIVACY_AUDIT_RESULTS = Object.freeze([
  'REQUESTED',
  'CONFIRMED',
  'REFUSED_HOLD',
  'REFUSED_AUTHORIZATION',
  'REFUSED_CONFLICT',
  'STARTED',
  'COMPLETED',
  'FAILED_SAFE',
  'CANCELLED',
])

/**
 * Whether a generated export still exists.
 *
 * `DELETION_FAILED` is the one state here that waits for a human, so that a
 * failed deletion is never reported as a deletion.
 */
export const EXPORT_ARTIFACT_STATES = Object.freeze([
  'AVAILABLE',
  'INVALIDATED',
  'DELETED',
  'DELETION_FAILED',
])

/** Whether a retention sweep was a rehearsal or the real thing. */
export const RETENTION_SWEEP_MODES = Object.freeze(['DRY_RUN', 'EXECUTE'])

/**
 * Where a retention sweep got to.
 *
 * `SKIPPED_DISABLED` is recorded rather than silent, because a sweeper that
 * quietly declined is indistinguishable from one that found nothing — and the
 * difference is whether a retention policy is being enforced at all.
 */
export const RETENTION_SWEEP_STATES = Object.freeze([
  'SCHEDULED',
  'CLAIMED',
  'COMPLETED',
  'FAILED',
  'SKIPPED_DISABLED',
])

/** `PRIVACY_REQUEST_REASONS` as a Zod enum. */
export const privacyRequestReasonSchema = z.enum([...PRIVACY_REQUEST_REASONS])

/** `PRIVACY_REQUEST_STATES` as a Zod enum. */
export const privacyRequestStateSchema = z.enum([...PRIVACY_REQUEST_STATES])

/** `PRIVACY_HOLD_KINDS` as a Zod enum. */
export const privacyHoldKindSchema = z.enum([...PRIVACY_HOLD_KINDS])

/** `PRIVACY_HOLD_STATES` as a Zod enum. */
export const privacyHoldStateSchema = z.enum([...PRIVACY_HOLD_STATES])

/** `PRIVACY_HOLD_DECISIONS` as a Zod enum. */
export const privacyHoldDecisionSchema = z.enum([...PRIVACY_HOLD_DECISIONS])

/** `PRIVACY_AUDIT_RESULTS` as a Zod enum. */
export const privacyAuditResultSchema = z.enum([...PRIVACY_AUDIT_RESULTS])

/** `EXPORT_ARTIFACT_STATES` as a Zod enum. */
export const exportArtifactStateSchema = z.enum([...EXPORT_ARTIFACT_STATES])

/** `RETENTION_SWEEP_MODES` as a Zod enum. */
export const retentionSweepModeSchema = z.enum([...RETENTION_SWEEP_MODES])

/** `RETENTION_SWEEP_STATES` as a Zod enum. */
export const retentionSweepStateSchema = z.enum([...RETENTION_SWEEP_STATES])

// ---------------------------------------------------------------------------
// Operational enums
//
// Not Prisma enums, so the drift guard above does not cover them. They live
// here because they are the same kind of thing: a closed vocabulary that a
// schema should validate against rather than accept as free text.
// ---------------------------------------------------------------------------

/** Log levels accepted by `@desi-event/logger`, in pino's order of severity. */
export const LOG_LEVELS = Object.freeze(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])

/** Node environments the applications are configured for. */
export const NODE_ENVS = Object.freeze(['development', 'test', 'production'])

/** Log level accepted by `@desi-event/logger`. */
export const logLevelSchema = z.enum([...LOG_LEVELS])

/** `NODE_ENV`, defaulting to development so local tooling needs no setup. */
export const nodeEnvSchema = z.enum([...NODE_ENVS]).default('development')

// ---------------------------------------------------------------------------
// Promo codes, as an organiser and a buyer see them
//
// Not Prisma enums: a code's status is derived from its row and the clock, and
// a quote's reason is why a known code gave no discount.
// ---------------------------------------------------------------------------

/**
 * What a promo code is doing now, computed from `active`, its window and its
 * redemptions. `PAUSED` wins over the rest because it is the organiser's own
 * choice; `ENDED` and `USED_UP` are final unless the organiser makes a new code.
 */
export const PROMO_STATUSES = Object.freeze(['ACTIVE', 'PAUSED', 'SCHEDULED', 'ENDED', 'USED_UP'])

/**
 * Why a quote applied no discount for a code.
 *
 * `UNKNOWN` is a code this organiser does not have for this event; the rest
 * mirror `PROMO_REJECTION_REASONS` in `@desi-event/pricing`.
 */
export const PROMO_QUOTE_REASONS = Object.freeze([
  'UNKNOWN',
  'INACTIVE',
  'NOT_STARTED',
  'EXPIRED',
  'EXHAUSTED',
  'CURRENCY_MISMATCH',
  'CURRENCY_MISSING',
])

/** `PROMO_STATUSES` as a Zod enum. */
export const promoStatusSchema = z.enum([...PROMO_STATUSES])

/** `PROMO_QUOTE_REASONS` as a Zod enum. */
export const promoQuoteReasonSchema = z.enum([...PROMO_QUOTE_REASONS])
