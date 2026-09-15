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
  acceptInvitationRequestSchema,
  acceptedInvitationResponseSchema,
  acceptedResponseSchema,
  changePasswordRequestSchema,
  checkInRequestSchema,
  confirmTotpRequestSchema,
  currentSessionResponseSchema,
  deviceListResponseSchema,
  disableMfaRequestSchema,
  enrollTotpRequestSchema,
  forgotPasswordRequestSchema,
  holdSeatsRequestSchema,
  inviteMemberRequestSchema,
  invitationResponseSchema,
  memberListResponseSchema,
  mfaFactorListResponseSchema,
  removeMemberRequestSchema,
  registerAccountRequestSchema,
  resendVerificationRequestSchema,
  seatHoldResponseSchema,
  seatMapResponseSchema,
  resetPasswordRequestSchema,
  revokeRequestSchema,
  sessionListResponseSchema,
  signInRequestSchema,
  signInResponseSchema,
  signOutRequestSchema,
  stepUpRequestSchema,
  totpConfirmedResponseSchema,
  totpEnrollmentResponseSchema,
  moderateVerificationRequestSchema,
  organizerSlugParamSchema,
  publicOrganizerResponseSchema,
  submitVerificationRequestSchema,
  updateMemberRequestSchema,
  verificationStateResponseSchema,
  verifyEmailRequestSchema,
  webhookAckResponseSchema,
  checkInResponseSchema,
  createEventRequestSchema,
  createHoldRequestSchema,
  createOrderRequestSchema,
  createTicketTypeRequestSchema,
  cuidSchema,
  errorResponseSchema,
  eventDetailResponseSchema,
  eventFacetsResponseSchema,
  eventListResponseSchema,
  healthResponseSchema,
  holdResponseSchema,
  idParamSchema,
  joinWaitlistRequestSchema,
  paymentWebhookRequestSchema,
  listEventsQuerySchema,
  listQuerySchema,
  okResponseSchema,
  orderReferenceSchema,
  orderResponseSchema,
  orderWithItemsSchema,
  paginationMetaSchema,
  publishEventRequestSchema,
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

/**
 * Authentication modes a route may declare.
 *
 *   - `none` — no credential is read. A public route.
 *   - `optional` — a credential is read if present, and a malformed one is still
 *     refused. Used where the response differs for a signed-in caller.
 *   - `session` — a credential is required, and either a session cookie or a
 *     bearer token satisfies it. This is what almost every authenticated route
 *     uses: the browser sends a cookie, a script sends a bearer token.
 *   - `bearer` — a bearer token is required and a cookie will not do. Reserved
 *     for routes that must not be reachable by a browser carrying an ambient
 *     session, whatever the origin says.
 *
 * @type {string[]}
 */
export const AUTH_MODES = Object.freeze(['none', 'bearer', 'optional', 'session'])

/** Modes under which a route requires a credential. */
export const AUTHENTICATED_MODES = Object.freeze(['bearer', 'session'])

/** HTTP methods the contract is allowed to use. */
export const HTTP_METHODS = Object.freeze(['GET', 'POST', 'PATCH', 'PUT', 'DELETE'])

/** Tag names used to group operations in the generated document. */
export const API_TAGS = Object.freeze([
  { name: 'health', description: 'Liveness and readiness probes.' },
  { name: 'auth', description: 'Registration, sign-in and the current session.' },
  {
    name: 'teams',
    description:
      'Organisation membership: who belongs, what they may do, and how they were invited.',
  },
  {
    name: 'organizers',
    description:
      'Organiser verification, and the public page an organiser is judged by. Verification gates publishing and payouts, so its transitions are commands rather than a writable field.',
  },
  { name: 'events', description: 'Public event discovery and organiser event management.' },
  { name: 'ticket-types', description: 'Ticket tiers belonging to an event.' },
  {
    name: 'sessions',
    description: 'Performances of an event, and the seats on sale at each one.',
  },
  { name: 'holds', description: 'Short-lived inventory reservations taken during checkout.' },
  { name: 'orders', description: 'Checkout and order retrieval.' },
  {
    name: 'payments',
    description: 'Provider callbacks. The authoritative signal that money moved.',
  },
  {
    name: 'webhooks',
    description:
      'Provider callbacks. The authoritative signal that money moved, verified over the exact bytes sent.',
  },
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
  /**
   * Used *instead of* `forbidden` on a route that requires step-up
   * authentication, because a route may document each status only once. The
   * description covers both reasons a 403 can arrive there.
   */
  stepUpRequired: Object.freeze({
    status: 403,
    code: 'STEP_UP_REQUIRED',
    description:
      'The caller lacks the required capability, or holds it but has not authenticated again recently enough for an action of this kind.',
  }),
  notFound: Object.freeze({
    status: 404,
    code: 'NOT_FOUND',
    description: 'No such resource, or it is not visible to this caller.',
  }),
  conflict: Object.freeze({
    status: 409,
    code: 'CONFLICT',
    description:
      'The request collides with current state, e.g. a duplicate slug or a released hold.',
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

/** Path parameters for the routes nested under an organisation id. */
const organizationIdParamSchema = z.object({ id: cuidSchema })

/** Path parameters for the routes naming one membership or invitation within an organisation. */
const memberParamSchema = z.object({ id: cuidSchema, memberId: cuidSchema })

/** Path parameters for the routes keyed by a session id. */
const sessionIdParamSchema = z.object({ id: cuidSchema })

/** Path parameters for the routes nested under an event id. */
const eventIdParamSchema = z.object({ eventId: cuidSchema })

/** Path parameters for the customer-facing order lookup. */
const orderReferenceParamSchema = z.object({ reference: orderReferenceSchema })

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
 * @property {'none'|'bearer'|'optional'|'session'} auth Which credential the route requires.
 * @property {string|null} [capability] The capability the guard asserts before the handler runs. Null for a route whose authorization is about the caller's own records rather than a granted power.
 * @property {string} [capabilityScope] Where the guard finds the organisation the capability is asserted in, as `params.x`, `query.x` or `body.x`. Defaults to an `organizationId` in any of the three. A capability asserted with no scope is a platform-level check, which is almost never what an organisation route means.
 * @property {boolean} [stepUp] Whether the caller must have authenticated again recently. For actions whose damage is not undoable.
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
export const apiRoutes = Object.freeze(
  [
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
        'Self-service sign-up. Only the ATTENDEE and ORGANIZER roles may be requested; every other role is granted out of band, and a request naming one is refused by schema. A session is established immediately, but `emailVerificationRequired` is true until the address is confirmed, and the routes that need a verified address say so.',
      tags: ['auth'],
      auth: 'none',
      capability: null,
      params: null,
      query: null,
      body: registerAccountRequestSchema,
      response: signInResponseSchema,
      successStatus: 201,
      errors: [API_ERRORS.validation, API_ERRORS.conflict, API_ERRORS.rateLimited],
    },
    {
      id: 'auth.login',
      method: 'POST',
      path: '/v1/auth/login',
      summary: 'Sign in',
      description:
        'Exchange email and password for a session, returned both as a cookie and as a bearer token carrying the same secret. A wrong password and an unknown email answer identically, and both pay the same hashing cost, so neither the body nor the response time enumerates accounts. An account with a second factor and no code supplied answers 200 with `mfaRequired` rather than an error — an error would have to distinguish "wrong password" from "right password, now show a code", which tells an attacker which passwords are correct. Failures are counted per address and per source, and a caller past either threshold gets 429 with no indication of which counter tripped.',
      tags: ['auth'],
      auth: 'none',
      capability: null,
      params: null,
      query: null,
      body: signInRequestSchema,
      response: signInResponseSchema,
      successStatus: 200,
      errors: [API_ERRORS.validation, API_ERRORS.unauthorized, API_ERRORS.rateLimited],
    },
    {
      id: 'auth.logout',
      method: 'POST',
      path: '/v1/auth/logout',
      summary: 'Sign out',
      description:
        'Revoke the session behind this request and clear its cookies. With `everywhere`, revoke every other session this account holds as well. Idempotent: signing out of an already-revoked session succeeds.',
      tags: ['auth'],
      auth: 'session',
      mfaExempt: true,
      capability: null,
      params: null,
      query: null,
      body: signOutRequestSchema,
      response: okResponseSchema,
      successStatus: 200,
      errors: [API_ERRORS.validation, API_ERRORS.unauthorized],
    },
    {
      id: 'auth.me',
      method: 'GET',
      path: '/v1/auth/me',
      summary: 'Current session',
      description:
        'Who the caller is, what they may do, and the state of their session. Capabilities are resolved on every request rather than baked into a token, so a role revoked at 09:00 stops working at 09:00. Never includes the password hash, the session token, or any credential.',
      tags: ['auth'],
      auth: 'session',
      mfaExempt: true,
      capability: null,
      params: null,
      query: null,
      body: null,
      response: currentSessionResponseSchema,
      successStatus: 200,
      errors: [API_ERRORS.unauthorized],
    },
    {
      id: 'auth.verifyEmail',
      method: 'POST',
      path: '/v1/auth/verify-email',
      summary: 'Confirm an email address',
      description:
        'Redeem a verification link. The token is single-use, enforced by a conditional update rather than by a read-then-write, so two simultaneous redemptions cannot both succeed. A token issued for any other purpose is refused even if it is otherwise valid.',
      tags: ['auth'],
      auth: 'none',
      capability: null,
      params: null,
      query: null,
      body: verifyEmailRequestSchema,
      response: okResponseSchema,
      successStatus: 200,
      errors: [API_ERRORS.validation, API_ERRORS.unauthorized, API_ERRORS.rateLimited],
    },
    {
      id: 'auth.resendVerification',
      method: 'POST',
      path: '/v1/auth/resend-verification',
      summary: 'Send the verification email again',
      description:
        'Answers identically whether the address has an account, has already been verified, or has never been seen. Rate-limited, because an endpoint that sends mail on demand is an endpoint that sends mail to somebody else on demand.',
      tags: ['auth'],
      auth: 'none',
      capability: null,
      params: null,
      query: null,
      body: resendVerificationRequestSchema,
      response: acceptedResponseSchema,
      successStatus: 202,
      errors: [API_ERRORS.validation, API_ERRORS.rateLimited],
    },
    {
      id: 'auth.forgotPassword',
      method: 'POST',
      path: '/v1/auth/forgot-password',
      summary: 'Request a password reset',
      description:
        'Issue a single-use reset link with a short lifetime. Answers identically for a known and an unknown address. Any reset token already outstanding for the account is revoked, so a link requested twice leaves exactly one usable link.',
      tags: ['auth'],
      auth: 'none',
      capability: null,
      params: null,
      query: null,
      body: forgotPasswordRequestSchema,
      response: acceptedResponseSchema,
      successStatus: 202,
      errors: [API_ERRORS.validation, API_ERRORS.rateLimited],
    },
    {
      id: 'auth.resetPassword',
      method: 'POST',
      path: '/v1/auth/reset-password',
      summary: 'Set a new password from a reset link',
      description:
        'Redeem a reset token and replace the password. The token is single-use. Every session the account holds is revoked, including the one that may be making this request: a session established with the old password must stop working, or resetting the password because somebody else knows it accomplishes nothing.',
      tags: ['auth'],
      auth: 'none',
      capability: null,
      params: null,
      query: null,
      body: resetPasswordRequestSchema,
      response: okResponseSchema,
      successStatus: 200,
      errors: [API_ERRORS.validation, API_ERRORS.unauthorized, API_ERRORS.rateLimited],
    },
    {
      id: 'auth.changePassword',
      method: 'POST',
      path: '/v1/auth/change-password',
      summary: 'Change the password',
      description:
        'Requires the current password even though the caller is already authenticated: a session is evidence of who they were when they signed in, not evidence that the person at the keyboard now knows the password. On success every other session is revoked and this one is rotated.',
      tags: ['auth'],
      auth: 'session',
      mfaExempt: true,
      capability: null,
      params: null,
      query: null,
      body: changePasswordRequestSchema,
      response: okResponseSchema,
      successStatus: 200,
      errors: [API_ERRORS.validation, API_ERRORS.unauthorized, API_ERRORS.rateLimited],
    },
    {
      id: 'auth.stepUp',
      method: 'POST',
      path: '/v1/auth/step-up',
      summary: 'Authenticate again for a sensitive action',
      description:
        'Prove possession of the password or a second factor, marking the session as recently authenticated for a bounded window. Required by routes whose damage is not undoable. An account whose roles require a second factor must supply a code here; a password alone will not do.',
      tags: ['auth'],
      auth: 'session',
      mfaExempt: true,
      capability: null,
      params: null,
      query: null,
      body: stepUpRequestSchema,
      response: okResponseSchema,
      successStatus: 200,
      errors: [API_ERRORS.validation, API_ERRORS.unauthorized, API_ERRORS.rateLimited],
    },
    {
      id: 'auth.listSessions',
      method: 'GET',
      path: '/v1/auth/sessions',
      summary: 'List active sessions',
      description:
        'Every session this account currently holds, with the current one flagged. Carries no token digests and no raw IP addresses — enough to recognise a session as yours or not, and nothing more.',
      tags: ['auth'],
      auth: 'session',
      mfaExempt: true,
      capability: null,
      params: null,
      query: null,
      body: null,
      response: sessionListResponseSchema,
      successStatus: 200,
      errors: [API_ERRORS.unauthorized],
    },
    {
      id: 'auth.revokeSession',
      method: 'POST',
      path: '/v1/auth/sessions/:id/revoke',
      summary: 'End a session',
      description:
        "End one session, which may be the caller's own. A session belonging to another account answers 404 rather than 403, so the endpoint cannot be used to discover whether a session id exists. Idempotent.",
      tags: ['auth'],
      auth: 'session',
      mfaExempt: true,
      capability: null,
      params: idParamSchema,
      query: null,
      body: revokeRequestSchema,
      response: okResponseSchema,
      successStatus: 200,
      errors: [API_ERRORS.validation, API_ERRORS.unauthorized, API_ERRORS.notFound],
    },
    {
      id: 'auth.listDevices',
      method: 'GET',
      path: '/v1/auth/devices',
      summary: 'List known devices',
      description:
        'Browsers and apps this account has signed in from, with how many live sessions each currently has. The stored fingerprint digest is never returned.',
      tags: ['auth'],
      auth: 'session',
      mfaExempt: true,
      capability: null,
      params: null,
      query: null,
      body: null,
      response: deviceListResponseSchema,
      successStatus: 200,
      errors: [API_ERRORS.unauthorized],
    },
    {
      id: 'auth.revokeDevice',
      method: 'POST',
      path: '/v1/auth/devices/:id/revoke',
      summary: 'Revoke a device',
      description:
        'Revoke a device and every session established from it. A device belonging to another account answers 404. Idempotent.',
      tags: ['auth'],
      auth: 'session',
      mfaExempt: true,
      capability: null,
      params: idParamSchema,
      query: null,
      body: revokeRequestSchema,
      response: okResponseSchema,
      successStatus: 200,
      errors: [API_ERRORS.validation, API_ERRORS.unauthorized, API_ERRORS.notFound],
    },
    {
      id: 'auth.listFactors',
      method: 'GET',
      path: '/v1/auth/mfa',
      summary: 'List second factors',
      description:
        "This account's enrolled factors, whether its roles require one, and whether that requirement is satisfied. Never returns a secret or a recovery code.",
      tags: ['auth'],
      auth: 'session',
      mfaExempt: true,
      capability: null,
      params: null,
      query: null,
      body: null,
      response: mfaFactorListResponseSchema,
      successStatus: 200,
      errors: [API_ERRORS.unauthorized],
    },
    {
      id: 'auth.enrollTotp',
      method: 'POST',
      path: '/v1/auth/mfa/totp',
      summary: 'Begin TOTP enrolment',
      description:
        'Generate a TOTP secret and return it once, with the provisioning URI an authenticator app scans. The factor is unusable until confirmed, so an abandoned enrolment leaves an unconfirmed row rather than a second factor nobody can produce a code for. The secret is sealed at rest and never returned again.',
      tags: ['auth'],
      auth: 'session',
      mfaExempt: true,
      capability: null,
      params: null,
      query: null,
      body: enrollTotpRequestSchema,
      response: totpEnrollmentResponseSchema,
      successStatus: 201,
      errors: [API_ERRORS.validation, API_ERRORS.unauthorized, API_ERRORS.rateLimited],
    },
    {
      id: 'auth.confirmTotp',
      method: 'POST',
      path: '/v1/auth/mfa/totp/confirm',
      summary: 'Confirm TOTP enrolment',
      description:
        'Prove the authenticator holds the secret, activating the factor and returning a set of single-use recovery codes. The codes appear once: they are stored as digests, so losing them means generating a new set. Every other session is revoked, because adding a factor is a privilege change.',
      tags: ['auth'],
      auth: 'session',
      mfaExempt: true,
      capability: null,
      params: null,
      query: null,
      body: confirmTotpRequestSchema,
      response: totpConfirmedResponseSchema,
      successStatus: 200,
      errors: [
        API_ERRORS.validation,
        API_ERRORS.unauthorized,
        API_ERRORS.notFound,
        API_ERRORS.rateLimited,
      ],
    },
    {
      id: 'auth.disableFactor',
      method: 'POST',
      path: '/v1/auth/mfa/:id/disable',
      summary: 'Remove a second factor',
      description:
        'Disable a factor. Gated on the current password and on a recent step-up, because removing a factor is the action an attacker who has stolen a session would most like to perform. Removing the last confirmed factor from an account whose roles require one is refused: the account would keep its authority and lose its second factor.',
      tags: ['auth'],
      auth: 'session',
      mfaExempt: true,
      capability: null,
      stepUp: 'CREDENTIAL',
      params: idParamSchema,
      query: null,
      body: disableMfaRequestSchema,
      response: okResponseSchema,
      successStatus: 200,
      errors: [
        API_ERRORS.validation,
        API_ERRORS.unauthorized,
        API_ERRORS.stepUpRequired,
        API_ERRORS.notFound,
        API_ERRORS.unprocessable,
      ],
    },
    {
      id: 'teams.list',
      method: 'GET',
      path: '/v1/organizations/:id/members',
      summary: 'List the team',
      description:
        "Everybody in this organisation, the invitations still outstanding, and the roles the caller may grant. The role list is computed from what the caller holds rather than fixed, because a member cannot grant a power they do not have. Carries each person's name and address and nothing else about their account: managing a team is not the same as reading a colleague's profile.",
      tags: ['teams'],
      auth: 'session',
      capability: 'organization:view_members',
      capabilityScope: 'params.id',
      params: organizationIdParamSchema,
      query: null,
      body: null,
      response: memberListResponseSchema,
      successStatus: 200,
      errors: [API_ERRORS.unauthorized, API_ERRORS.forbidden, API_ERRORS.notFound],
    },
    {
      id: 'teams.invite',
      method: 'POST',
      path: '/v1/organizations/:id/invitations',
      summary: 'Invite somebody to the team',
      description:
        'Issue a single-use invitation to an email address, for a role bounded by what the caller holds: a member cannot invite somebody to a role that carries powers they lack, and OWNER cannot be invited at all. An address that already belongs to the organisation answers 409, and a second invitation to the same address supersedes the first rather than leaving two live links.',
      tags: ['teams'],
      auth: 'session',
      capability: 'team:invite',
      capabilityScope: 'params.id',
      params: organizationIdParamSchema,
      query: null,
      body: inviteMemberRequestSchema,
      response: invitationResponseSchema,
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
      id: 'teams.accept',
      method: 'POST',
      path: '/v1/invitations/accept',
      summary: 'Accept an invitation',
      description:
        'Join an organisation with an invitation link. The caller must be signed in as the address the invitation names — a link forwarded to somebody else does not work, which is what stops an invitation becoming a transferable key. Single-use, enforced by a conditional update, so two simultaneous acceptances produce one membership.',
      tags: ['teams'],
      auth: 'session',
      capability: null,
      params: null,
      query: null,
      body: acceptInvitationRequestSchema,
      response: acceptedInvitationResponseSchema,
      successStatus: 200,
      errors: [
        API_ERRORS.validation,
        API_ERRORS.unauthorized,
        API_ERRORS.forbidden,
        API_ERRORS.conflict,
      ],
    },
    {
      id: 'teams.revokeInvitation',
      method: 'POST',
      path: '/v1/organizations/:id/invitations/:memberId/revoke',
      summary: 'Withdraw an invitation',
      description:
        'Stop an outstanding invitation from being accepted. Idempotent, and an invitation belonging to another organisation answers 404 rather than 403.',
      tags: ['teams'],
      auth: 'session',
      capability: 'team:invite',
      capabilityScope: 'params.id',
      params: memberParamSchema,
      query: null,
      body: null,
      response: okResponseSchema,
      successStatus: 200,
      errors: [API_ERRORS.unauthorized, API_ERRORS.forbidden, API_ERRORS.notFound],
    },
    {
      id: 'teams.updateMember',
      method: 'PATCH',
      path: '/v1/organizations/:id/members/:memberId',
      summary: "Change a member's role",
      description:
        'Bounded three ways. The caller must be able to grant the new role and must already hold power over the old one, so nobody can promote somebody past themselves or demote somebody above them. Nobody may change their own role, which is what stops a MANAGER making themselves an ADMIN. And the last OWNER cannot be demoted: an organisation with no owner is one nobody can fix.',
      tags: ['teams'],
      auth: 'session',
      capability: 'team:role_manage',
      capabilityScope: 'params.id',
      params: memberParamSchema,
      query: null,
      body: updateMemberRequestSchema,
      response: okResponseSchema,
      successStatus: 200,
      errors: [
        API_ERRORS.validation,
        API_ERRORS.unauthorized,
        API_ERRORS.forbidden,
        API_ERRORS.notFound,
        API_ERRORS.unprocessable,
      ],
    },
    {
      id: 'teams.removeMember',
      method: 'POST',
      path: '/v1/organizations/:id/members/:memberId/remove',
      summary: 'Remove somebody from the team',
      description:
        'Bounded like a role change, and with the same last-owner rule. Removing somebody revokes their scanner scopes with them. A membership in another organisation answers 404.',
      tags: ['teams'],
      auth: 'session',
      capability: 'team:remove',
      capabilityScope: 'params.id',
      params: memberParamSchema,
      query: null,
      body: removeMemberRequestSchema,
      response: okResponseSchema,
      successStatus: 200,
      errors: [
        API_ERRORS.validation,
        API_ERRORS.unauthorized,
        API_ERRORS.forbidden,
        API_ERRORS.notFound,
        API_ERRORS.unprocessable,
      ],
    },
    {
      id: 'organizers.verification',
      method: 'GET',
      path: '/v1/organizations/:id/verification',
      summary: 'Read the verification state and its history',
      description:
        'The current state, whether the organisation may publish and be paid, and every transition it has been through with the reason recorded at the time. The history is append-only: a later decision is a new row, never an edit to an old one, because an audit trail that can be rewritten is a story rather than a record.',
      tags: ['organizers'],
      auth: 'session',
      capability: 'organization:view_members',
      capabilityScope: 'params.id',
      params: idParamSchema,
      query: null,
      body: null,
      response: verificationStateResponseSchema,
      successStatus: 200,
      errors: [API_ERRORS.unauthorized, API_ERRORS.forbidden, API_ERRORS.notFound],
    },
    {
      id: 'organizers.submitVerification',
      method: 'POST',
      path: '/v1/organizations/:id/verification',
      summary: 'Submit the organisation for verification',
      description:
        'Moves the organisation into PENDING from UNVERIFIED, REQUIRES_INFORMATION, REJECTED or REVOKED. The body carries no target state: PENDING is the only place an organiser can go, and offering a field would imply a choice they do not have. A moderator decides what happens next.',
      tags: ['organizers'],
      auth: 'session',
      capability: 'organization:submit_verification',
      capabilityScope: 'params.id',
      params: idParamSchema,
      query: null,
      body: submitVerificationRequestSchema,
      response: verificationStateResponseSchema,
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
      id: 'organizers.moderateVerification',
      method: 'POST',
      path: '/v1/organizations/:id/verification/decision',
      summary: 'Decide a verification submission',
      description:
        'Platform staff only, and a reason is required for every outcome: a verification decision nobody recorded a rationale for is one nobody can review or appeal. Requires a recent second factor under the SECURITY_ROLE policy, because verification is what gates publishing and payouts.',
      tags: ['organizers'],
      auth: 'session',
      capability: 'moderation:review',
      stepUp: 'SECURITY_ROLE',
      params: idParamSchema,
      query: null,
      body: moderateVerificationRequestSchema,
      response: verificationStateResponseSchema,
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
      id: 'organizers.get',
      method: 'GET',
      path: '/v1/organizers/:slug',
      summary: 'Read a public organiser profile',
      description:
        'The page an organiser is judged by: who they are, what they have on sale, what they have run before, and their refund policy. The verified badge is derived from the verification state server-side rather than from the denormalised column, so a stale badge cannot be served. A suspended organisation is not found here at all.',
      tags: ['organizers'],
      auth: 'none',
      params: organizerSlugParamSchema,
      query: null,
      body: null,
      response: publicOrganizerResponseSchema,
      successStatus: 200,
      errors: [API_ERRORS.notFound],
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
      id: 'events.facets',
      method: 'GET',
      path: '/v1/events/facets',
      summary: 'Filter facets for the catalogue',
      description:
        'Counts for every filterable dimension, computed over the complete eligible set — all PUBLISHED events — rather than over the page currently being displayed. Pagination changes which rows a visitor sees, never which options exist: a city whose events all fall beyond page one must still be selectable, or the filters silently hide part of the catalogue. Aggregated in the database; no table is loaded into application memory.',
      tags: ['events'],
      auth: 'none',
      params: null,
      query: null,
      body: null,
      response: eventFacetsResponseSchema,
      successStatus: 200,
      errors: [],
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
      auth: 'session',
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
        'Partial update; at least one field must be supplied. The owning organisation is immutable, and `status` cannot be changed here — use `POST /v1/events/:id/publish`, which requires `event:publish`. Requires `event:update`.',
      tags: ['events'],
      auth: 'session',
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
      auth: 'session',
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
      auth: 'session',
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
        "Returns held inventory to the pool. Ownership is verified on the server: an authenticated caller must own the hold, an anonymous one must present the one-time token from `X-Hold-Token` that was returned when the hold was taken, and releasing somebody else's hold requires the `hold:release_any` capability. A hold that does not exist and one the caller may not release both answer 404, so the endpoint cannot be used to discover hold ids. Idempotent for a hold that has already expired or been released; only a hold already converted into a paid order answers 409.",
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
      id: 'sessions.seats',
      method: 'GET',
      path: '/v1/sessions/:id/seats',
      summary: 'Seat map for a session',
      description:
        'Every seat on sale at this session, grouped into sections and rows in the order somebody reading a ticket expects. A seat carries whether it is available and never why it is not: "held by another buyer" teaches a buyer to refresh, and "blocked" says something about the production. Accessibility attributes are published to everybody, because somebody who needs an accessible seat has to be able to find one; they describe the seat and never the person in it. A caller who may see drafts for this organisation additionally gets each seat\'s real status.',
      tags: ['sessions'],
      auth: 'optional',
      capability: null,
      params: sessionIdParamSchema,
      query: null,
      body: null,
      response: seatMapResponseSchema,
      successStatus: 200,
      errors: [API_ERRORS.notFound],
    },
    {
      id: 'sessions.hold',
      method: 'POST',
      path: '/v1/sessions/:id/holds',
      summary: 'Reserve seats',
      description:
        'Take a set of seats for a bounded time. The request names seats and nothing else: the price, the ticket type, the hold duration and whether the buyer may have these seats are all decided server-side. Choosing an accessible seat also takes its companion seat, and choosing a companion also takes the accessible seat — in both directions, because selling either alone strands the other. All or nothing: if somebody takes one of the seats first, none of them is reserved, and the response says which seat went. The hold is owned by the signed-in buyer, or by a one-time guest token returned once and never again.',
      tags: ['sessions', 'holds'],
      auth: 'optional',
      capability: null,
      params: sessionIdParamSchema,
      query: null,
      body: holdSeatsRequestSchema,
      response: seatHoldResponseSchema,
      successStatus: 201,
      errors: [
        API_ERRORS.validation,
        API_ERRORS.notFound,
        API_ERRORS.conflict,
        API_ERRORS.unprocessable,
        API_ERRORS.rateLimited,
      ],
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
      auth: 'session',
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
      auth: 'session',
      params: null,
      query: listQuerySchema,
      body: null,
      response: orderListResponseSchema,
      successStatus: 200,
      errors: [API_ERRORS.validation, API_ERRORS.unauthorized],
    },
    {
      id: 'payments.webhook',
      method: 'POST',
      path: '/v1/payments/webhook',
      summary: 'Payment provider callback',
      description:
        'The authoritative signal that money moved. A browser redirect is not: a buyer can close the tab, replay it or forge it, so fulfilment is driven from here. Processing is idempotent on `(provider, providerEventId)` — a replayed or duplicated delivery is acknowledged and changes nothing. In production this endpoint is authenticated by the provider signature; the Phase 1 mock provider posts unsigned callbacks and real payments remain disabled.',
      tags: ['payments'],
      auth: 'none',
      params: null,
      query: null,
      body: paymentWebhookRequestSchema,
      response: okResponseSchema,
      successStatus: 200,
      errors: [API_ERRORS.validation, API_ERRORS.notFound],
    },
    {
      id: 'webhooks.stripe',
      method: 'POST',
      path: '/v1/webhooks/stripe',
      summary: 'Stripe account webhook',
      description:
        'Receives platform-account events. The body is read as raw bytes and the `Stripe-Signature` header is verified against them before anything else happens — a parsed body is a body whose bytes are gone, and the signature is over the bytes. A verified delivery is stored durably and acknowledged; the work happens afterwards from the stored row, so that a provider retry cannot repeat a side effect. A duplicate delivery answers 2xx without storing a second row, because the unique index on (provider, account context, event id) is what makes replay a no-op. Every refusal answers a bare 400: which part of a forgery was wrong goes to the log only. There is no mode that skips verification, and a deployment with no Stripe credentials refuses every delivery rather than accepting unsigned ones.',
      tags: ['webhooks'],
      auth: 'none',
      capability: null,
      params: null,
      query: null,
      body: null,
      response: webhookAckResponseSchema,
      successStatus: 200,
      errors: [API_ERRORS.validation, API_ERRORS.rateLimited],
    },
    {
      id: 'webhooks.stripeConnect',
      method: 'POST',
      path: '/v1/webhooks/stripe/connect',
      summary: 'Stripe Connect webhook',
      description:
        "Receives connected-account events, verified against the Connect endpoint's own signing secret. A separate endpoint with a separate secret on purpose: a Connect event names an account, and verifying it with the platform secret would let a platform event impersonate one. The same event id arriving for two different accounts is two facts, not a duplicate.",
      tags: ['webhooks'],
      auth: 'none',
      capability: null,
      params: null,
      query: null,
      body: null,
      response: webhookAckResponseSchema,
      successStatus: 200,
      errors: [API_ERRORS.validation, API_ERRORS.rateLimited],
    },
    {
      id: 'tickets.checkIn',
      method: 'POST',
      path: '/v1/tickets/check-in',
      summary: 'Check a ticket in',
      description:
        'Scans a ticket at the door. Re-scanning an already-admitted ticket answers 200 with `alreadyCheckedIn: true` rather than an error, so a flaky scanner never blocks the queue. Requires `ticket:check_in`.',
      tags: ['tickets'],
      auth: 'session',
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
  ].map((route) =>
    Object.freeze({
      ...route,
      tags: Object.freeze([...route.tags]),
      errors: Object.freeze([...route.errors]),
    }),
  ),
)

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
