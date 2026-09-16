import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import * as schemas from './index.js'

/**
 * Every name the cross-package contract promises. The API, the web app, the
 * worker and `@desi-event/api-contract` import these by name, so a rename here
 * is a breaking change for four other packages.
 */
const CONTRACT_EXPORTS = [
  // Primitives
  'cuidSchema',
  'emailSchema',
  'slugSchema',
  'currencySchema',
  'centsSchema',
  'isoDateTimeSchema',
  'timezoneSchema',
  'paginationQuerySchema',
  // Enum mirrors
  'userRoleSchema',
  'orgRoleSchema',
  'eventCategorySchema',
  'eventStatusSchema',
  'ticketTypeStatusSchema',
  'holdStatusSchema',
  'orderStatusSchema',
  'ticketStatusSchema',
  'paymentStatusSchema',
  'promoTypeSchema',
  // Entities
  'userSchema',
  'publicUserSchema',
  'organizationSchema',
  'venueSchema',
  'eventSchema',
  'eventSummarySchema',
  'ticketTypeSchema',
  'orderSchema',
  'orderItemSchema',
  'ticketSchema',
  'promoCodeSchema',
  // Requests
  'registerRequestSchema',
  'loginRequestSchema',
  'createEventRequestSchema',
  'updateEventRequestSchema',
  'listEventsQuerySchema',
  'createTicketTypeRequestSchema',
  'createHoldRequestSchema',
  'createOrderRequestSchema',
  'checkInRequestSchema',
  'joinWaitlistRequestSchema',
  // Responses
  'authResponseSchema',
  'eventListResponseSchema',
  'eventDetailResponseSchema',
  'orderResponseSchema',
  'errorResponseSchema',
  'healthResponseSchema',
]

/**
 * Schemas that must NOT be on the barrel, and the entry point that serves them.
 *
 * Finding NF-16: this barrel is imported by the API contract's route table,
 * which is imported by the browser, and a barrel is all-or-nothing. Every name
 * here describes how a server or the worker is deployed, and none of it was
 * ever wanted in a client bundle.
 */
const OFF_BARREL = Object.freeze({
  './env.js': [
    'apiEnvSchema',
    'workerEnvSchema',
    'webEnvSchema',
    'loadApiEnv',
    'isInsecureJwtSecret',
  ],
  './jobs.js': [
    'sendEmailJobSchema',
    'expireHoldsJobSchema',
    'issueTicketsJobSchema',
    'indexEventJobSchema',
    'JOB_NAMES',
    'QUEUE_NAMES',
  ],
})

describe('package entry point', () => {
  it.each(CONTRACT_EXPORTS)('exports %s as a parseable schema', (name) => {
    const schema = schemas[name]
    expect(schema, `${name} is missing from @desi-event/schemas`).toBeDefined()
    expect(typeof schema.safeParse).toBe('function')
  })

  it.each(Object.entries(OFF_BARREL))(
    'keeps %s off the barrel, where the browser would find it',
    (_module, names) => {
      for (const name of names) {
        expect(schemas[name], `${name} is back on the barrel — see finding NF-16`).toBeUndefined()
      }
    },
  )

  it.each(Object.entries(OFF_BARREL))(
    'still serves %s from its own entry point',
    async (module, names) => {
      const loaded = await import(module)

      for (const name of names) {
        expect(loaded[name], `${name} is missing from ${module}`).toBeDefined()
      }
    },
  )

  it('exports the validation helpers', () => {
    expect(typeof schemas.parseOrThrow).toBe('function')
    expect(typeof schemas.ValidationError).toBe('function')
    expect(new schemas.ValidationError('x').statusCode).toBe(400)
  })

  it('renders every exported schema to JSON Schema for the OpenAPI document', () => {
    const failures = []

    for (const [name, value] of Object.entries(schemas)) {
      if (!value || typeof value !== 'object' || typeof value.safeParse !== 'function') continue
      try {
        z.toJSONSchema(value, { target: 'openapi-3.0' })
      } catch (error) {
        failures.push(`${name}: ${error.message}`)
      }
    }

    expect(failures).toEqual([])
  })
})
