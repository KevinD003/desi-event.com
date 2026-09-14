import { describe, expect, it } from 'vitest'

import {
  EVENT_CATEGORIES,
  EVENT_STATUSES,
  HOLD_STATUSES,
  LOG_LEVELS,
  NODE_ENVS,
  ORDER_STATUSES,
  ORG_ROLES,
  PAYMENT_STATUSES,
  PROMO_TYPES,
  TICKET_STATUSES,
  TICKET_TYPE_STATUSES,
  USER_ROLES,
  eventCategorySchema,
  eventStatusSchema,
  holdStatusSchema,
  logLevelSchema,
  nodeEnvSchema,
  orderStatusSchema,
  orgRoleSchema,
  paymentStatusSchema,
  promoTypeSchema,
  ticketStatusSchema,
  ticketTypeStatusSchema,
  userRoleSchema,
} from './enums.js'

// Restated literally so that editing enums.js without updating the database
// schema (or vice versa) fails here instead of in production.
const PRISMA_ENUMS = {
  UserRole: ['ATTENDEE', 'ORGANIZER', 'ADMIN'],
  OrgRole: ['OWNER', 'ADMIN', 'MANAGER', 'STAFF', 'VIEWER'],
  EventCategory: [
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
  ],
  EventStatus: ['DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED'],
  TicketTypeStatus: ['DRAFT', 'ON_SALE', 'PAUSED', 'SOLD_OUT', 'CLOSED'],
  HoldStatus: ['ACTIVE', 'CONVERTED', 'RELEASED', 'EXPIRED'],
  OrderStatus: ['PENDING', 'PAID', 'CANCELLED', 'REFUNDED', 'EXPIRED'],
  TicketStatus: ['VALID', 'CHECKED_IN', 'VOID', 'REFUNDED'],
  PaymentStatus: ['INITIATED', 'SUCCEEDED', 'FAILED', 'REFUNDED'],
  PromoType: ['PERCENTAGE', 'FIXED_AMOUNT'],
}

const cases = [
  ['UserRole', USER_ROLES, userRoleSchema],
  ['OrgRole', ORG_ROLES, orgRoleSchema],
  ['EventCategory', EVENT_CATEGORIES, eventCategorySchema],
  ['EventStatus', EVENT_STATUSES, eventStatusSchema],
  ['TicketTypeStatus', TICKET_TYPE_STATUSES, ticketTypeStatusSchema],
  ['HoldStatus', HOLD_STATUSES, holdStatusSchema],
  ['OrderStatus', ORDER_STATUSES, orderStatusSchema],
  ['TicketStatus', TICKET_STATUSES, ticketStatusSchema],
  ['PaymentStatus', PAYMENT_STATUSES, paymentStatusSchema],
  ['PromoType', PROMO_TYPES, promoTypeSchema],
]

describe.each(cases)('%s', (name, values, schema) => {
  it('matches the Prisma enum exactly, in order', () => {
    expect([...values]).toEqual(PRISMA_ENUMS[name])
  })

  it('accepts every member', () => {
    for (const value of values) {
      expect(schema.parse(value)).toBe(value)
    }
  })

  it('rejects unknown members and the lower-cased form', () => {
    expect(schema.safeParse('NOT_A_MEMBER').success).toBe(false)
    expect(schema.safeParse(values[0].toLowerCase()).success).toBe(false)
    expect(schema.safeParse(undefined).success).toBe(false)
  })

  it('exposes its options and is frozen', () => {
    expect(schema.options).toEqual(PRISMA_ENUMS[name])
    expect(Object.isFrozen(values)).toBe(true)
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
