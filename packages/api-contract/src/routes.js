/**
 * The route table: the single source of truth for the Desi-Event HTTP API.
 *
 * The Fastify server registers handlers against these descriptors, the OpenAPI
 * document is generated from them, and the browser client is generated from
 * them too. A route that is not in this file does not exist as far as the rest
 * of the monorepo is concerned.
 *
 * @module @desi-event/api-contract/routes
 */

import { z } from 'zod'
import {
  authResponseSchema,
  checkInRequestSchema,
  checkInResponseSchema,
  createEventRequestSchema,
  createHoldRequestSchema,
  createOrderRequestSchema,
  createTicketTypeRequestSchema,
  cuidSchema,
  errorResponseSchema,
  eventDetailResponseSchema,
  eventListResponseSchema,
  healthResponseSchema,
  holdResponseSchema,
  idParamSchema,
  joinWaitlistRequestSchema,
  listEventsQuerySchema,
  listQuerySchema,
  loginRequestSchema,
  okResponseSchema,
  orderReferenceSchema,
  orderResponseSchema,
  orderWithItemsSchema,
  paginationMetaSchema,
  publicUserSchema,
  publishEventRequestSchema,
  registerRequestSchema,
  slugParamSchema,
  ticketTypeListResponseSchema,
  ticketTypeSchema,
  updateEventRequestSchema,
  waitlistEntrySchema,
} from '@desi-event/schemas'

import { ApiContractError } from './errors.js'
import { pathParamNames } from './path.js'

/** Version prefix every business endpoint sits behind. */
export const API_VERSION_PREFIX = '/v1'

/** Authentication modes a route may declare. */
export const AUTH_MODES = Object.freeze(['none', 'bearer', 'optional'])

/** HTTP methods the contract is allowed to use. */
export const HTTP_METHODS = Object.freeze(['GET', 'POST', 'PATCH', 'PUT', 'DELETE'])

/** Tag names used to group operations in the generated document. */
export const API_TAGS = Object.freeze([
  { name: 'health', description: 'Liveness and readiness probes.' },
  { name: 'auth', description: 'Registration, sign-in and the current session.' },
  { name: 'events', description: 'Public event discovery and organiser event management.' },
  { name: 'ticket-types', description: 'Ticket tiers belonging to an event.' },
  { name: 'holds', description: 'Short-lived inventory reservations taken during checkout.' },
  { name: 'orders', description: 'Checkout and order retrieval.' },
  { name: 'tickets', description: 'Door scanning and attendance.' },
  { name: 'waitlist', description: 'Waitlist sign-up for sold-out events.' },
])

/**
 * A documented failure mode.
 *
 * @typedef {object} ApiErrorDescriptor
 * @property {number} status HTTP status code.
 * @property {string} code Machine-readable code carried in `error.code`.
 * @property {string} description What causes this response.
 */

/**
 * The catalogue of failures routes may declare. Keeping them in one frozen map
 * means the same status never picks up two different descriptions.
 *
 * @type {Readonly<Record<string, ApiErrorDescriptor>>}
 */
export const API_ERRORS = Object.freeze({
  validation: Object.freeze({
    status: 400,
    code: 'VALIDATION_ERROR',
    description: 'The request failed schema validation; `error.issues` lists the offending fields.',
  }),
  unauthorized: Object.freeze({
    status: 401,
    code: 'UNAUTHORIZED',
    description: 'The bearer token is missing, malformed or expired.',
  }),
  forbidden: Object.freeze({
    status: 403,
    code: 'FORBIDDEN',
    description: 'The caller is authenticated but lacks the required capability.',
  }),
  notFound: Object.freeze({
    status: 404,
    code: 'NOT_FOUND',
    description: 'No such resource, or it is not visible to this caller.',
  }),
  conflict: Object.freeze({
    status: 409,
    code: 'CONFLICT',
    description: 'The request collides with current state, e.g. a duplicate slug or a released hold.',
  }),
  gone: Object.freeze({
    status: 410,
    code: 'HOLD_EXPIRED',
    description: 'The inventory hold referenced by the request has already expired.',
  }),
  unprocessable: Object.freeze({
    status: 422,
    code: 'UNPROCESSABLE',
    description: 'Well-formed but not actionable, e.g. sold out or outside the sales window.',
  }),
  rateLimited: Object.freeze({
    status: 429,
    code: 'RATE_LIMITED',
    description: 'Too many attempts; retry after the interval in the `Retry-After` header.',
  }),
  unavailable: Object.freeze({
    status: 503,
    code: 'SERVICE_UNAVAILABLE',
    description: 'A dependency (database or Redis) is unreachable.',
  }),
})

/** Path parameters for the routes nested under an event id. */
const eventIdParamSchema = z.object({ eventId: cuidSchema })

/** Path parameters for the customer-facing order lookup. */
const orderReferenceParamSchema = z.object({ reference: orderReferenceSchema })

/** `GET /v1/auth/me`. */
const currentUserResponseSchema = z.object({ data: publicUserSchema })

/** `POST /v1/events/:eventId/ticket-types`. */
const ticketTypeResponseSchema = z.object({ data: ticketTypeSchema })

/** `GET /v1/orders`. */
const orderListResponseSchema = z.object({
  data: z.array(orderWithItemsSchema),
  pagination: paginationMetaSchema,
})

/** `POST /v1/events/:eventId/waitlist`. */
const waitlistResponseSchema = z.object({ data: waitlistEntrySchema })

/**
 * A single endpoint of the API.
 *
 * `params`, `query`, `body` and `response` are Zod schemas from
 * `@desi-event/schemas`; `null` means the route has no such part.
 *
 * @typedef {object} ApiRoute
 * @property {string} id Dotted identifier, e.g. `events.list`. Also the OpenAPI `operationId`.
 * @property {'GET'|'POST'|'PATCH'|'PUT'|'DELETE'} method HTTP method.
 * @property {string} path Fastify-style path, e.g. `/v1/events/:slug`.
 * @property {string} summary One-line description shown in the operation list.
 * @property {string} description Longer prose explaining semantics and side effects.
 * @property {string[]} tags Tag names grouping this operation.
 * @property {'none'|'bearer'|'optional'} auth Whether a bearer token is required, optional or unused.
 * @property {ZodType|null} params Schema for the path parameters.
 * @property {ZodType|null} query Schema for the query string.
 * @property {ZodType|null} body Schema for the request body.
 * @property {ZodType} response Schema for the success response body.
 * @property {number} successStatus HTTP status returned on success.
 * @property {ApiErrorDescriptor[]} errors Documented failure modes.
 */

/**
 * Every endpoint of the Desi-Event API.
 *
 * @type {Array<ApiRoute>}
 */
export const apiRoutes = Object.freeze([
  {
    id: 'health.get',
    method: 'GET',
    path: '/health',
    summary: 'Service health',
    description:
      'Unversioned liveness probe. Reports the database and Redis checks so a load balancer can drain an instance whose dependencies are down.',
    tags: ['health'],
    auth: 'none',
    params: null,
    query: null,
    body: null,
    response: healthResponseSchema,
    successStatus: 200,
    errors: [API_ERRORS.unavailable],
  },
  {
    id: 'auth.register',
    method: 'POST',
    path: '/v1/auth/register',
    summary: 'Create an account',
    description:
      'Self-service sign-up. Only the ATTENDEE and ORGANIZER roles may be requested; ADMIN is granted out of band. Returns a bearer token so the caller is signed in immediately.',
    tags: ['auth'],
    auth: 'none',
    params: null,
    query: null,
    body: registerRequestSchema,
    response: authResponseSchema,
    successStatus: 201,
    errors: [API_ERRORS.validation, API_ERRORS.conflict, API_ERRORS.rateLimited],
  },
  {
    id: 'auth.login',
    method: 'POST',
    path: '/v1/auth/login',
    summary: 'Sign in',
    description:
      'Exchange email and password for a bearer token. A wrong password and an unknown email both answer 401 so the endpoint cannot be used to enumerate accounts.',
    tags: ['auth'],
    auth: 'none',
    params: null,
    query: null,
    body: loginRequestSchema,
    response: authResponseSchema,
    successStatus: 200,
    errors: [API_ERRORS.validation, API_ERRORS.unauthorized, API_ERRORS.rateLimited],
  },
  {
    id: 'auth.me',
    method: 'GET',
    path: '/v1/auth/me',
    summary: 'Current user',
    description: 'Resolve the bearer token to its user record. Never includes the password hash.',
    tags: ['auth'],
    auth: 'bearer',
    params: null,
    query: null,
    body: null,
    response: currentUserResponseSchema,
    successStatus: 200,
    errors: [API_ERRORS.unauthorized],
  },
  {
    id: 'events.list',
    method: 'GET',
    path: '/v1/events',
    summary: 'List events',
    description:
      'Paginated, filterable event discovery. Anonymous callers only ever see PUBLISHED events; a token widens the result set to drafts the caller may view.',
    tags: ['events'],
    auth: 'optional',
    params: null,
    query: listEventsQuerySchema,
    body: null,
    response: eventListResponseSchema,
    successStatus: 200,
    errors: [API_ERRORS.validation],
  },
  {
    id: 'events.get',
    method: 'GET',
    path: '/v1/events/:slug',
    summary: 'Get an event by slug',
    description:
      'Full event detail including venue, organisation and ticket types. A draft event answers 404 unless the caller holds `event:view_draft` for its organisation.',
    tags: ['events'],
    auth: 'optional',
    params: slugParamSchema,
    query: null,
    body: null,
    response: eventDetailResponseSchema,
    successStatus: 200,
    errors: [API_ERRORS.validation, API_ERRORS.notFound],
  },
  {
    id: 'events.create',
    method: 'POST',
    path: '/v1/events',
    summary: 'Create an event',
    description:
      'Creates an event in DRAFT status. Requires `event:create` for the target organisation. The slug must be unique across the platform.',
    tags: ['events'],
    auth: 'bearer',
    params: null,
    query: null,
    body: createEventRequestSchema,
    response: eventDetailResponseSchema,
    successStatus: 201,
    errors: [
      API_ERRORS.validation,
      API_ERRORS.unauthorized,
      API_ERRORS.forbidden,
      API_ERRORS.conflict,
    ],
  },
  {
    id: 'events.update',
    method: 'PATCH',
    path: '/v1/events/:id',
    summary: 'Update an event',
    description:
      'Partial update; at least one field must be supplied. The owning organisation is immutable. Requires `event:update`.',
    tags: ['events'],
    auth: 'bearer',
    params: idParamSchema,
    query: null,
    body: updateEventRequestSchema,
    response: eventDetailResponseSchema,
    successStatus: 200,
    errors: [
      API_ERRORS.validation,
      API_ERRORS.unauthorized,
      API_ERRORS.forbidden,
      API_ERRORS.notFound,
      API_ERRORS.conflict,
    ],
  },
  {
    id: 'events.publish',
    method: 'POST',
    path: '/v1/events/:id/publish',
    summary: 'Change publication status',
    description:
      'Moves an event between DRAFT, PUBLISHED, CANCELLED and COMPLETED. Publishing an event with no on-sale ticket type answers 422. Requires `event:publish`.',
    tags: ['events'],
    auth: 'bearer',
    params: idParamSchema,
    query: null,
    body: publishEventRequestSchema,
    response: eventDetailResponseSchema,
    successStatus: 200,
    errors: [
      API_ERRORS.validation,
      API_ERRORS.unauthorized,
      API_ERRORS.forbidden,
      API_ERRORS.notFound,
      API_ERRORS.conflict,
      API_ERRORS.unprocessable,
    ],
  },
  {
    id: 'ticketTypes.listForEvent',
    method: 'GET',
    path: '/v1/events/:eventId/ticket-types',
    summary: 'List an event’s ticket types',
    description:
      'Ticket tiers with live availability folded in. `availableQuantity` already subtracts active holds, so it can fall below `quantityTotal - quantitySold`.',
    tags: ['ticket-types'],
    auth: 'optional',
    params: eventIdParamSchema,
    query: null,
    body: null,
    response: ticketTypeListResponseSchema,
    successStatus: 200,
    errors: [API_ERRORS.validation, API_ERRORS.notFound],
  },
  {
    id: 'ticketTypes.create',
    method: 'POST',
    path: '/v1/events/:eventId/ticket-types',
    summary: 'Create a ticket type',
    description:
      'Adds a tier to an event. Prices are integer minor units (cents/paise). Requires `ticketType:manage`.',
    tags: ['ticket-types'],
    auth: 'bearer',
    params: eventIdParamSchema,
    query: null,
    body: createTicketTypeRequestSchema,
    response: ticketTypeResponseSchema,
    successStatus: 201,
    errors: [
      API_ERRORS.validation,
      API_ERRORS.unauthorized,
      API_ERRORS.forbidden,
      API_ERRORS.notFound,
      API_ERRORS.conflict,
    ],
  },
  {
    id: 'holds.create',
    method: 'POST',
    path: '/v1/holds',
    summary: 'Hold inventory',
    description:
      'Reserves seats for a few minutes while the buyer completes checkout. The reservation is released automatically at `expiresAt`, so clients must be ready for a later order to still fail.',
    tags: ['holds'],
    auth: 'optional',
    params: null,
    query: null,
    body: createHoldRequestSchema,
    response: holdResponseSchema,
    successStatus: 201,
    errors: [
      API_ERRORS.validation,
      API_ERRORS.notFound,
      API_ERRORS.conflict,
      API_ERRORS.unprocessable,
    ],
  },
  {
    id: 'holds.release',
    method: 'DELETE',
    path: '/v1/holds/:id',
    summary: 'Release a hold',
    description:
      'Returns held inventory to the pool. Idempotent for a hold that has already expired or been released; only a hold already converted into a paid order answers 409.',
    tags: ['holds'],
    auth: 'optional',
    params: idParamSchema,
    query: null,
    body: null,
    response: okResponseSchema,
    successStatus: 200,
    errors: [API_ERRORS.validation, API_ERRORS.notFound, API_ERRORS.conflict, API_ERRORS.gone],
  },
  {
    id: 'orders.create',
    method: 'POST',
    path: '/v1/orders',
    summary: 'Place an order',
    description:
      'Converts holds into a PENDING order and computes totals server-side. Client-supplied prices are ignored: only the ticket type id and quantity are trusted.',
    tags: ['orders'],
    auth: 'optional',
    params: null,
    query: null,
    body: createOrderRequestSchema,
    response: orderResponseSchema,
    successStatus: 201,
    errors: [
      API_ERRORS.validation,
      API_ERRORS.notFound,
      API_ERRORS.conflict,
      API_ERRORS.gone,
      API_ERRORS.unprocessable,
    ],
  },
  {
    id: 'orders.get',
    method: 'GET',
    path: '/v1/orders/:reference',
    summary: 'Get an order by reference',
    description:
      'Looks an order up by its customer-facing reference (e.g. `DE-8F3K2Q`). Visible to the buyer and to organisation members holding `order:view`.',
    tags: ['orders'],
    auth: 'bearer',
    params: orderReferenceParamSchema,
    query: null,
    body: null,
    response: orderResponseSchema,
    successStatus: 200,
    errors: [
      API_ERRORS.validation,
      API_ERRORS.unauthorized,
      API_ERRORS.forbidden,
      API_ERRORS.notFound,
    ],
  },
  {
    id: 'orders.listMine',
    method: 'GET',
    path: '/v1/orders',
    summary: 'List my orders',
    description: 'Orders belonging to the authenticated user, newest first.',
    tags: ['orders'],
    auth: 'bearer',
    params: null,
    query: listQuerySchema,
    body: null,
    response: orderListResponseSchema,
    successStatus: 200,
    errors: [API_ERRORS.validation, API_ERRORS.unauthorized],
  },
  {
    id: 'tickets.checkIn',
    method: 'POST',
    path: '/v1/tickets/check-in',
    summary: 'Check a ticket in',
    description:
      'Scans a ticket at the door. Re-scanning an already-admitted ticket answers 200 with `alreadyCheckedIn: true` rather than an error, so a flaky scanner never blocks the queue. Requires `ticket:check_in`.',
    tags: ['tickets'],
    auth: 'bearer',
    params: null,
    query: null,
    body: checkInRequestSchema,
    response: checkInResponseSchema,
    successStatus: 200,
    errors: [
      API_ERRORS.validation,
      API_ERRORS.unauthorized,
      API_ERRORS.forbidden,
      API_ERRORS.notFound,
      API_ERRORS.conflict,
    ],
  },
  {
    id: 'waitlist.join',
    method: 'POST',
    path: '/v1/events/:eventId/waitlist',
    summary: 'Join the waitlist',
    description:
      'Registers interest in a sold-out event. The `eventId` in the path wins over any value in the body. Joining twice with the same email returns the existing entry rather than creating a duplicate.',
    tags: ['waitlist'],
    auth: 'optional',
    params: eventIdParamSchema,
    query: null,
    body: joinWaitlistRequestSchema,
    response: waitlistResponseSchema,
    successStatus: 201,
    errors: [API_ERRORS.validation, API_ERRORS.notFound, API_ERRORS.conflict],
  },
].map((route) => Object.freeze({ ...route, tags: Object.freeze([...route.tags]), errors: Object.freeze([...route.errors]) })))

/**
 * The error envelope every documented failure uses.
 *
 * @type {ZodType}
 */
export const apiErrorResponseSchema = errorResponseSchema

/** Route descriptors keyed by id, built once so lookup stays O(1). */
const ROUTES_BY_ID = new Map(apiRoutes.map((route) => [route.id, route]))

/** Every route id, in declaration order. */
export const routeIds = Object.freeze(apiRoutes.map((route) => route.id))

/**
 * Look a route up by its dotted id.
 *
 * @param {string} id Route id, e.g. `events.list`.
 * @returns {ApiRoute} The matching descriptor.
 * @throws {ApiContractError} When no route has that id.
 */
export function routeById(id) {
  const route = ROUTES_BY_ID.get(id)

  if (!route) {
    throw new ApiContractError(`Unknown route id "${id}"`, {
      code: 'UNKNOWN_ROUTE',
      details: { id, known: routeIds },
    })
  }

  return route
}

/**
 * Look a route up without throwing.
 *
 * @param {string} id Route id, e.g. `events.list`.
 * @returns {ApiRoute|undefined} The descriptor, or `undefined` when absent.
 */
export function findRoute(id) {
  return ROUTES_BY_ID.get(id)
}

/**
 * All routes carrying a given tag.
 *
 * @param {string} tag Tag name, e.g. `events`.
 * @returns {ApiRoute[]} Matching descriptors in declaration order.
 */
export function routesByTag(tag) {
  return apiRoutes.filter((route) => route.tags.includes(tag))
}

/**
 * The `method path` key used to detect two routes claiming the same endpoint.
 *
 * @param {ApiRoute} route Route descriptor.
 * @returns {string} A stable collision key, e.g. `GET /v1/events/:slug`.
 */
export function routeKey(route) {
  return `${route.method} ${route.path}`
}

/**
 * Names of the path parameters a route declares.
 *
 * @param {ApiRoute} route Route descriptor.
 * @returns {string[]} Parameter names in order of appearance.
 */
export function routeParamNames(route) {
  return pathParamNames(route.path)
}
