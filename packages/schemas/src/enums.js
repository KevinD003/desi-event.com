/**
 * Runtime mirrors of the Prisma enums.
 *
 * These are hand-written rather than derived from `@desi-event/db` on purpose:
 * the browser bundle imports schemas but must never pull in `@prisma/client`.
 * `enums.test.js` guards the two definitions against drifting apart.
 *
 * @module @desi-event/schemas/enums
 */

import { z } from 'zod'

/** @type {string[]} */
export const USER_ROLES = Object.freeze(['ATTENDEE', 'ORGANIZER', 'ADMIN'])

/** @type {string[]} */
export const ORG_ROLES = Object.freeze(['OWNER', 'ADMIN', 'MANAGER', 'STAFF', 'VIEWER'])

/** @type {string[]} */
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

/** @type {string[]} */
export const EVENT_STATUSES = Object.freeze(['DRAFT', 'PUBLISHED', 'CANCELLED', 'COMPLETED'])

/** @type {string[]} */
export const TICKET_TYPE_STATUSES = Object.freeze([
  'DRAFT',
  'ON_SALE',
  'PAUSED',
  'SOLD_OUT',
  'CLOSED',
])

/** @type {string[]} */
export const HOLD_STATUSES = Object.freeze(['ACTIVE', 'CONVERTED', 'RELEASED', 'EXPIRED'])

/** @type {string[]} */
export const ORDER_STATUSES = Object.freeze(['PENDING', 'PAID', 'CANCELLED', 'REFUNDED', 'EXPIRED'])

/** @type {string[]} */
export const TICKET_STATUSES = Object.freeze(['VALID', 'CHECKED_IN', 'VOID', 'REFUNDED'])

/** @type {string[]} */
export const PAYMENT_STATUSES = Object.freeze(['INITIATED', 'SUCCEEDED', 'FAILED', 'REFUNDED'])

/** @type {string[]} */
export const PROMO_TYPES = Object.freeze(['PERCENTAGE', 'FIXED_AMOUNT'])

/** Pino log levels accepted by `LOG_LEVEL`. */
export const LOG_LEVELS = Object.freeze(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])

/** Node environments the applications are configured for. */
export const NODE_ENVS = Object.freeze(['development', 'test', 'production'])

/** Platform-wide role held by a `User`. */
export const userRoleSchema = z.enum([...USER_ROLES])

/** Role a user holds inside one organisation. */
export const orgRoleSchema = z.enum([...ORG_ROLES])

/** Event taxonomy used for browsing and filtering. */
export const eventCategorySchema = z.enum([...EVENT_CATEGORIES])

/** Publication lifecycle of an event. */
export const eventStatusSchema = z.enum([...EVENT_STATUSES])

/** Sale state of a ticket type. */
export const ticketTypeStatusSchema = z.enum([...TICKET_TYPE_STATUSES])

/** Lifecycle of a checkout inventory hold. */
export const holdStatusSchema = z.enum([...HOLD_STATUSES])

/** Lifecycle of an order. */
export const orderStatusSchema = z.enum([...ORDER_STATUSES])

/** Lifecycle of an individual ticket. */
export const ticketStatusSchema = z.enum([...TICKET_STATUSES])

/** Lifecycle of a payment attempt. */
export const paymentStatusSchema = z.enum([...PAYMENT_STATUSES])

/** Discount kind carried by a promo code. */
export const promoTypeSchema = z.enum([...PROMO_TYPES])

/** Log level accepted by `@desi-event/logger`. */
export const logLevelSchema = z.enum([...LOG_LEVELS])

/** `NODE_ENV`, defaulting to development so local tooling needs no setup. */
export const nodeEnvSchema = z.enum([...NODE_ENVS]).default('development')
