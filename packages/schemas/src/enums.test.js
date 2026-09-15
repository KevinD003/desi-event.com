/**
 * The enum drift guard.
 *
 * `enums.js` mirrors the Prisma enums by hand, because the browser bundle must
 * not pull in `@prisma/client` to read a list of strings. The mirror is only
 * worth having if something notices when it stops matching.
 *
 * Phase 1's version of this file did not. It compared `enums.js` against a
 * second hand-written copy of the same lists, sitting a few lines above the
 * assertions — so when the corrective cycle added `PENDING` and `TIMEOUT` to the
 * Prisma `PaymentStatus`, both copies stayed stale together, every assertion
 * passed, and `paymentStatusSchema` quietly rejected two states the application
 * writes on every timed-out payment. Recorded as NF-03.
 *
 * So this version reads `schema.prisma` off disk and parses it. The test is the
 * only place in the repository that does, and it is allowed to because a test
 * is not bundled: nothing here reaches the browser. Every Prisma enum must
 * either be mirrored in `enums.js` or be named in {@link NOT_MIRRORED} with a
 * reason, so adding one and forgetting the mirror fails here rather than in a
 * response validator.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import * as enums from './enums.js'
import { LOG_LEVELS, NODE_ENVS, logLevelSchema, nodeEnvSchema } from './enums.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const schemaPath = path.resolve(here, '..', '..', 'db', 'prisma', 'schema.prisma')

/**
 * Every enum declared in the Prisma schema, as a name-to-values map.
 *
 * A deliberately small parser: `enum Name { ... }` with one bare
 * SCREAMING_SNAKE member per line. Comment lines and `///` doc comments are
 * dropped, which is what keeps it from mistaking documentation for a member.
 *
 * @param {string} source The contents of `schema.prisma`.
 * @returns {Record<string, string[]>} Enum name to its members, in declaration order.
 */
export function parsePrismaEnums(source) {
  /** @type {Record<string, string[]>} */
  const found = {}
  const pattern = /^enum\s+(\w+)\s*\{([^}]*)\}/gm
  let match

  while ((match = pattern.exec(source))) {
    found[match[1]] = match[2]
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, '').trim())
      .filter((line) => /^[A-Z][A-Z0-9_]*$/.test(line))
  }

  return found
}

/**
 * Which exported constant mirrors which Prisma enum.
 *
 * @type {Record<string, string>}
 */
const MIRRORS = {
  UserRole: 'USER_ROLES',
  OrgRole: 'ORG_ROLES',
  VerificationStatus: 'VERIFICATION_STATUSES',
  InvitationStatus: 'INVITATION_STATUSES',
  MfaFactorType: 'MFA_FACTOR_TYPES',
  AuthTokenPurpose: 'AUTH_TOKEN_PURPOSES',
  EventCategory: 'EVENT_CATEGORIES',
  EventStatus: 'EVENT_STATUSES',
  EventSessionStatus: 'EVENT_SESSION_STATUSES',
  SectionKind: 'SECTION_KINDS',
  EventSeatStatus: 'EVENT_SEAT_STATUSES',
  TicketTypeStatus: 'TICKET_TYPE_STATUSES',
  HoldStatus: 'HOLD_STATUSES',
  OrderStatus: 'ORDER_STATUSES',
  TicketStatus: 'TICKET_STATUSES',
  TicketTransferStatus: 'TICKET_TRANSFER_STATUSES',
  CheckInMethod: 'CHECK_IN_METHODS',
  PaymentStatus: 'PAYMENT_STATUSES',
  WebhookState: 'WEBHOOK_STATES',
  ConnectOnboardingStatus: 'CONNECT_ONBOARDING_STATUSES',
  RefundStatus: 'REFUND_STATUSES',
  RefundReason: 'REFUND_REASONS',
  DisputeStatus: 'DISPUTE_STATUSES',
  TransferStatus: 'TRANSFER_STATUSES',
  PayoutStatus: 'PAYOUT_STATUSES',
  LedgerAccountType: 'LEDGER_ACCOUNT_TYPES',
  LedgerBatchStatus: 'LEDGER_BATCH_STATUSES',
  LedgerBatchKind: 'LEDGER_BATCH_KINDS',
  LedgerDirection: 'LEDGER_DIRECTIONS',
  NotificationChannel: 'NOTIFICATION_CHANNELS',
  NotificationStatus: 'NOTIFICATION_STATUSES',
  ReconciliationState: 'RECONCILIATION_STATES',
  ReconciliationKind: 'RECONCILIATION_KINDS',
  MediaModerationStatus: 'MEDIA_MODERATION_STATUSES',
  MediaScanStatus: 'MEDIA_SCAN_STATUSES',
  PromoType: 'PROMO_TYPES',
}

/**
 * Prisma enums deliberately not mirrored, and why.
 *
 * Empty today. It exists so that a future decision not to mirror something is a
 * recorded decision rather than an omission.
 *
 * @type {Record<string, string>}
 */
const NOT_MIRRORED = {}

/** Which Zod schema corresponds to which mirrored constant. */
const SCHEMAS = {
  USER_ROLES: 'userRoleSchema',
  ORG_ROLES: 'orgRoleSchema',
  VERIFICATION_STATUSES: 'verificationStatusSchema',
  INVITATION_STATUSES: 'invitationStatusSchema',
  MFA_FACTOR_TYPES: 'mfaFactorTypeSchema',
  AUTH_TOKEN_PURPOSES: 'authTokenPurposeSchema',
  EVENT_CATEGORIES: 'eventCategorySchema',
  EVENT_STATUSES: 'eventStatusSchema',
  EVENT_SESSION_STATUSES: 'eventSessionStatusSchema',
  SECTION_KINDS: 'sectionKindSchema',
  EVENT_SEAT_STATUSES: 'eventSeatStatusSchema',
  TICKET_TYPE_STATUSES: 'ticketTypeStatusSchema',
  HOLD_STATUSES: 'holdStatusSchema',
  ORDER_STATUSES: 'orderStatusSchema',
  TICKET_STATUSES: 'ticketStatusSchema',
  TICKET_TRANSFER_STATUSES: 'ticketTransferStatusSchema',
  CHECK_IN_METHODS: 'checkInMethodSchema',
  PAYMENT_STATUSES: 'paymentStatusSchema',
  WEBHOOK_STATES: 'webhookStateSchema',
  CONNECT_ONBOARDING_STATUSES: 'connectOnboardingStatusSchema',
  REFUND_STATUSES: 'refundStatusSchema',
  REFUND_REASONS: 'refundReasonSchema',
  DISPUTE_STATUSES: 'disputeStatusSchema',
  TRANSFER_STATUSES: 'transferStatusSchema',
  PAYOUT_STATUSES: 'payoutStatusSchema',
  LEDGER_ACCOUNT_TYPES: 'ledgerAccountTypeSchema',
  LEDGER_BATCH_STATUSES: 'ledgerBatchStatusSchema',
  LEDGER_BATCH_KINDS: 'ledgerBatchKindSchema',
  LEDGER_DIRECTIONS: 'ledgerDirectionSchema',
  NOTIFICATION_CHANNELS: 'notificationChannelSchema',
  NOTIFICATION_STATUSES: 'notificationStatusSchema',
  RECONCILIATION_STATES: 'reconciliationStateSchema',
  RECONCILIATION_KINDS: 'reconciliationKindSchema',
  MEDIA_MODERATION_STATUSES: 'mediaModerationStatusSchema',
  MEDIA_SCAN_STATUSES: 'mediaScanStatusSchema',
  PROMO_TYPES: 'promoTypeSchema',
}

const prismaSource = readFileSync(schemaPath, 'utf8')
const prismaEnums = parsePrismaEnums(prismaSource)
const prismaNames = Object.keys(prismaEnums).sort()

describe('the parser this guard depends on', () => {
  it('finds enums and their members', () => {
    const parsed = parsePrismaEnums(`
enum Colour {
  RED
  /// A doc comment that is not a member.
  GREEN
  // An ordinary comment.
  BLUE
}

model NotAnEnum {
  id String @id
}
`)

    expect(parsed).toEqual({ Colour: ['RED', 'GREEN', 'BLUE'] })
  })

  it('found a plausible number of enums in the real schema', () => {
    // A parser that silently matched nothing would make every assertion below
    // vacuous, which is the failure mode the old guard had.
    expect(prismaNames.length).toBeGreaterThan(20)
  })
})

describe('every Prisma enum is accounted for', () => {
  it.each(prismaNames)('%s is mirrored or explicitly excused', (name) => {
    const decided = name in MIRRORS || name in NOT_MIRRORED
    expect(decided, `Prisma enum ${name} is neither mirrored nor listed in NOT_MIRRORED`).toBe(true)
  })

  it('mirrors nothing that the schema does not declare', () => {
    const stale = Object.keys(MIRRORS).filter((name) => !(name in prismaEnums))
    expect(stale).toEqual([])
  })
})

const mirrored = Object.entries(MIRRORS).filter(([name]) => name in prismaEnums)

describe.each(mirrored)('%s', (prismaName, constantName) => {
  const values = enums[constantName]
  const schema = enums[SCHEMAS[constantName]]

  it('is exported', () => {
    expect(Array.isArray(values), `${constantName} is not exported from enums.js`).toBe(true)
    expect(typeof schema?.safeParse, `${SCHEMAS[constantName]} is not exported`).toBe('function')
  })

  it('holds exactly the members the database allows', () => {
    // Compared as sorted sets: a Prisma enum's declaration order affects the
    // PostgreSQL type, not what a schema should accept, and ordering the mirror
    // by hand is one more thing to get wrong.
    expect([...values].sort()).toEqual([...prismaEnums[prismaName]].sort())
  })

  it('accepts every member', () => {
    for (const value of values) expect(schema.parse(value)).toBe(value)
  })

  it('rejects unknown members and the lower-cased form', () => {
    expect(schema.safeParse('NOT_A_MEMBER').success).toBe(false)
    expect(schema.safeParse(values[0].toLowerCase()).success).toBe(false)
    expect(schema.safeParse(undefined).success).toBe(false)
  })

  it('is frozen, and its options match', () => {
    expect(Object.isFrozen(values)).toBe(true)
    expect([...schema.options].sort()).toEqual([...values].sort())
  })
})

describe('the states this guard was written for', () => {
  it('accepts a payment that is pending or timed out', () => {
    // The exact regression: both states were added to the database by the
    // post-efda577 corrective cycle and never reached the mirror.
    expect(enums.paymentStatusSchema.safeParse('PENDING').success).toBe(true)
    expect(enums.paymentStatusSchema.safeParse('TIMEOUT').success).toBe(true)
  })
})

describe('public and private event statuses', () => {
  it('partitions the event statuses with nothing left over', () => {
    expect([...enums.PUBLIC_EVENT_STATUSES, ...enums.PRIVATE_EVENT_STATUSES].sort()).toEqual(
      [...enums.EVENT_STATUSES].sort(),
    )
  })

  it('does not overlap', () => {
    const overlap = enums.PUBLIC_EVENT_STATUSES.filter((status) =>
      enums.PRIVATE_EVENT_STATUSES.includes(status),
    )
    expect(overlap).toEqual([])
  })

  it('keeps every pre-sale and withdrawn status private', () => {
    for (const status of [
      'DRAFT',
      'REVIEW_PENDING',
      'CHANGES_REQUIRED',
      'APPROVED',
      'REJECTED',
      'ARCHIVED',
      'CANCELLED',
    ]) {
      expect(enums.PRIVATE_EVENT_STATUSES, `${status} must not be public`).toContain(status)
    }
  })

  it('shows a sold-out or paused show rather than hiding it', () => {
    expect(enums.PUBLIC_EVENT_STATUSES).toContain('SOLD_OUT')
    expect(enums.PUBLIC_EVENT_STATUSES).toContain('SALES_PAUSED')
  })

  it('makes a newly added status private until somebody decides otherwise', () => {
    // PRIVATE is derived by subtraction, so this is structural rather than a
    // property somebody has to remember.
    expect(Object.isFrozen(enums.PRIVATE_EVENT_STATUSES)).toBe(true)
    expect(enums.PRIVATE_EVENT_STATUSES.length).toBeGreaterThan(0)
  })
})

describe('operational enums', () => {
  it('covers the pino log levels', () => {
    expect([...LOG_LEVELS]).toEqual(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    expect(logLevelSchema.parse('debug')).toBe('debug')
    expect(logLevelSchema.safeParse('verbose').success).toBe(false)
  })

  it('defaults NODE_ENV to development', () => {
    expect([...NODE_ENVS]).toEqual(['development', 'test', 'production'])
    expect(nodeEnvSchema.parse(undefined)).toBe('development')
    expect(nodeEnvSchema.parse('production')).toBe('production')
    expect(nodeEnvSchema.safeParse('staging').success).toBe(false)
  })
})
