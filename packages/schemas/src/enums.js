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

export const USER_ROLES = Object.freeze([
  'ATTENDEE',
  'ORGANIZER',
  'SUPPORT',
  'MODERATOR',
  'FINANCE_ADMIN',
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
])

export const TICKET_TYPE_STATUSES = Object.freeze([
  'DRAFT',
  'ON_SALE',
  'PAUSED',
  'SOLD_OUT',
  'CLOSED',
])

export const HOLD_STATUSES = Object.freeze(['ACTIVE', 'CONVERTED', 'RELEASED', 'EXPIRED'])

export const ORDER_STATUSES = Object.freeze(['PENDING', 'PAID', 'CANCELLED', 'REFUNDED', 'EXPIRED'])

export const TICKET_STATUSES = Object.freeze([
  'VALID',
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
  'PROCESSING',
  'SUCCEEDED',
  'FAILED',
  'RECONCILIATION_REQUIRED',
  'REJECTED',
  'CANCELLED',
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
  'NEEDS_RESPONSE',
  'UNDER_REVIEW',
  'CHARGE_REFUNDED',
  'WON',
  'LOST',
  'WARNING_NEEDS_RESPONSE',
  'WARNING_CLOSED',
])

export const TRANSFER_STATUSES = Object.freeze([
  'PENDING',
  'SENT',
  'PAID',
  'FAILED',
  'REVERSED',
  'PARTIALLY_REVERSED',
  'RECONCILIATION_REQUIRED',
])

export const PAYOUT_STATUSES = Object.freeze([
  'PENDING',
  'IN_TRANSIT',
  'PAID',
  'FAILED',
  'CANCELLED',
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

export const CHECK_IN_METHODS = Object.freeze(['QR_SCAN', 'MANUAL_LOOKUP', 'ASSISTED'])

export const NOTIFICATION_CHANNELS = Object.freeze(['EMAIL', 'SMS', 'PUSH'])

export const NOTIFICATION_STATUSES = Object.freeze([
  'QUEUED',
  'SENDING',
  'SENT',
  'FAILED',
  'DEAD_LETTER',
  'SUPPRESSED',
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

/** `ORG_ROLES` as a Zod enum. */
export const orgRoleSchema = z.enum([...ORG_ROLES])

/** `EVENT_CATEGORIES` as a Zod enum. */
export const eventCategorySchema = z.enum([...EVENT_CATEGORIES])

/** `EVENT_STATUSES` as a Zod enum. */
export const eventStatusSchema = z.enum([...EVENT_STATUSES])

/** `TICKET_TYPE_STATUSES` as a Zod enum. */
export const ticketTypeStatusSchema = z.enum([...TICKET_TYPE_STATUSES])

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

/** `SECTION_KINDS` as a Zod enum. */
export const sectionKindSchema = z.enum([...SECTION_KINDS])

/** `EVENT_SESSION_STATUSES` as a Zod enum. */
export const eventSessionStatusSchema = z.enum([...EVENT_SESSION_STATUSES])

/** `EVENT_SEAT_STATUSES` as a Zod enum. */
export const eventSeatStatusSchema = z.enum([...EVENT_SEAT_STATUSES])

/** `MEDIA_MODERATION_STATUSES` as a Zod enum. */
export const mediaModerationStatusSchema = z.enum([...MEDIA_MODERATION_STATUSES])

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
