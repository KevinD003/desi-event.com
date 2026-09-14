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
  // Env
  'apiEnvSchema',
  'workerEnvSchema',
  'webEnvSchema',
  // Jobs
  'sendEmailJobSchema',
  'expireHoldsJobSchema',
  'issueTicketsJobSchema',
  'indexEventJobSchema',
]

describe('package entry point', () => {
  it.each(CONTRACT_EXPORTS)('exports %s as a parseable schema', (name) => {
    const schema = schemas[name]
    expect(schema, `${name} is missing from @desi-event/schemas`).toBeDefined()
    expect(typeof schema.safeParse).toBe('function')
  })

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
