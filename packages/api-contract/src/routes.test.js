import { describe, expect, it } from 'vitest'

import { ApiContractError } from './errors.js'
import {
  API_ERRORS,
  API_TAGS,
  AUTH_MODES,
  HTTP_METHODS,
  apiRoutes,
  findRoute,
  routeById,
  routeIds,
  routeKey,
  routeParamNames,
  routesByTag,
} from './routes.js'

/** Every route id the rest of the monorepo is entitled to call. */
const REQUIRED_IDS = [
  'health.get',
  'auth.register',
  'auth.login',
  'auth.me',
  'events.list',
  'events.get',
  'events.create',
  'events.update',
  'events.publish',
  'ticketTypes.listForEvent',
  'ticketTypes.create',
  'holds.create',
  'holds.release',
  'orders.create',
  'orders.get',
  'orders.listMine',
  'tickets.checkIn',
  'waitlist.join',
]

describe('apiRoutes', () => {
  it('covers every route the contract promises', () => {
    for (const id of REQUIRED_IDS) {
      expect(routeIds, `missing route ${id}`).toContain(id)
    }
  })

  it('places each required route at the agreed method and path', () => {
    const expected = {
      'health.get': 'GET /health',
      'auth.register': 'POST /v1/auth/register',
      'auth.login': 'POST /v1/auth/login',
      'auth.me': 'GET /v1/auth/me',
      'events.list': 'GET /v1/events',
      'events.get': 'GET /v1/events/:slug',
      'events.create': 'POST /v1/events',
      'events.update': 'PATCH /v1/events/:id',
      'events.publish': 'POST /v1/events/:id/publish',
      'ticketTypes.listForEvent': 'GET /v1/events/:eventId/ticket-types',
      'ticketTypes.create': 'POST /v1/events/:eventId/ticket-types',
      'holds.create': 'POST /v1/holds',
      'holds.release': 'DELETE /v1/holds/:id',
      'orders.create': 'POST /v1/orders',
      'orders.get': 'GET /v1/orders/:reference',
      'orders.listMine': 'GET /v1/orders',
      'tickets.checkIn': 'POST /v1/tickets/check-in',
      'waitlist.join': 'POST /v1/events/:eventId/waitlist',
      'events.media': 'GET /v1/events/:id/media',
      'events.addMedia': 'POST /v1/events/:id/media',
      'events.updateMedia': 'PATCH /v1/events/:id/media/:mediaId',
      'events.reorderMedia': 'PUT /v1/events/:id/media/order',
      'events.removeMedia': 'DELETE /v1/events/:id/media/:mediaId',
      'media.get': 'GET /v1/media/:id',
      'moderation.decideMedia': 'POST /v1/moderation/media/:id/decision',
    }

    for (const [id, key] of Object.entries(expected)) {
      expect(routeKey(routeById(id)), id).toBe(key)
    }
  })

  it('never claims one method and path twice', () => {
    const keys = apiRoutes.map(routeKey)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('never reuses a route id', () => {
    expect(new Set(routeIds).size).toBe(routeIds.length)
  })

  it('uses only supported methods and auth modes', () => {
    for (const route of apiRoutes) {
      expect(HTTP_METHODS).toContain(route.method)
      expect(AUTH_MODES).toContain(route.auth)
    }
  })

  it('tags every route with a tag the document declares', () => {
    const known = new Set(API_TAGS.map((tag) => tag.name))

    for (const route of apiRoutes) {
      expect(route.tags.length).toBeGreaterThan(0)
      for (const tag of route.tags) expect(known, route.id).toContain(tag)
    }
  })

  it('declares a params schema exactly when the path has parameters', () => {
    for (const route of apiRoutes) {
      const hasParams = routeParamNames(route).length > 0
      expect(Boolean(route.params), route.id).toBe(hasParams)
    }
  })

  it('never puts a body on a GET or DELETE', () => {
    for (const route of apiRoutes.filter((r) => r.method === 'GET' || r.method === 'DELETE')) {
      expect(route.body, route.id).toBeNull()
    }
  })

  it('documents 401 on every bearer-only route', () => {
    for (const route of apiRoutes.filter((r) => r.auth === 'bearer')) {
      const statuses = route.errors.map((error) => error.status)
      expect(statuses, route.id).toContain(401)
    }
  })

  it('never documents 401 on a route that takes no credentials', () => {
    // `auth: 'none'` means "no session is required", not "no secret is
    // presented". These four take one in the body — a password, or a single-use
    // link — so 401 is the honest answer when it does not check out. Every other
    // anonymous route is a read, and a read that can 401 is a read somebody has
    // put a credential check into by mistake.
    const carriesCredentialInBody = new Set([
      'auth.login',
      'auth.verifyEmail',
      'auth.resetPassword',
    ])

    for (const route of apiRoutes.filter((r) => r.auth === 'none')) {
      if (carriesCredentialInBody.has(route.id)) continue

      const statuses = route.errors.map((error) => error.status)
      expect(statuses, route.id).not.toContain(401)
    }
  })

  it('returns 201 from the routes that create a resource', () => {
    const created = [
      'auth.register',
      'events.create',
      'ticketTypes.create',
      'holds.create',
      'orders.create',
      'waitlist.join',
      'events.addMedia',
      'teams.invite',
      'teams.reissueInvitation',
      // Kept in the contract, documented as always 403: see the describe below.
      'organizations.create',
      'organizerInvitations.create',
      'organizerInvitations.reissue',
      // A platform editing sitting is a resource: it is opened, and later closed.
      'platformEvents.openEdit',
    ]

    for (const id of created) {
      expect(routeById(id).successStatus, id).toBe(201)
    }
  })

  it('freezes descriptors so a consumer cannot mutate the shared table', () => {
    const route = routeById('events.list')
    expect(Object.isFrozen(route)).toBe(true)
    expect(Object.isFrozen(apiRoutes)).toBe(true)
    expect(() => {
      route.path = '/hacked'
    }).toThrow(TypeError)
  })

  it('never documents the same error status twice on one route', () => {
    for (const route of apiRoutes) {
      const statuses = route.errors.map((error) => error.status)
      expect(new Set(statuses).size, route.id).toBe(statuses.length)
    }
  })

  it('draws every documented error from the shared catalogue', () => {
    const known = new Set(Object.values(API_ERRORS))

    for (const route of apiRoutes) {
      for (const error of route.errors) expect(known, route.id).toContain(error)
    }
  })
})

describe('event picture routes', () => {
  it('take the upload as raw bytes of the three picture types, never as JSON', () => {
    const upload = routeById('events.addMedia')

    expect(upload.body).toBeNull()
    expect(upload.consumes).toEqual([
      'image/jpeg',
      'image/png',
      'image/webp',
      'application/octet-stream',
    ])
    expect(Object.isFrozen(upload.consumes)).toBe(true)
    expect(upload.errors).toContain(API_ERRORS.payloadTooLarge)
    expect(upload.errors).toContain(API_ERRORS.unsupportedMediaType)
    expect(upload.errors).toContain(API_ERRORS.rateLimited)
  })

  it('declare 413 and 415 in the shared catalogue', () => {
    expect(API_ERRORS.payloadTooLarge).toMatchObject({ status: 413, code: 'PAYLOAD_TOO_LARGE' })
    expect(API_ERRORS.unsupportedMediaType).toMatchObject({
      status: 415,
      code: 'UNSUPPORTED_MEDIA_TYPE',
    })
  })

  it('serve bytes under their own tag, with optional auth', () => {
    const read = routeById('media.get')

    expect(read.auth).toBe('optional')
    expect(read.produces).toBe('image/*')
    expect(read.tags).toEqual(['media'])
    expect(API_TAGS.map((tag) => tag.name)).toContain('media')
  })

  it('leave organisation authority to the handler and take a moderator decision on step-up', () => {
    for (const id of [
      'events.media',
      'events.addMedia',
      'events.updateMedia',
      'events.reorderMedia',
      'events.removeMedia',
      'media.get',
    ]) {
      expect(routeById(id).capability ?? null, id).toBeNull()
    }

    const decide = routeById('moderation.decideMedia')

    expect(decide.capability).toBe('moderation:review')
    expect(decide.capabilityScope).toBeUndefined()
    expect(decide.stepUp).toBe('MODERATION')
  })
})

describe('routeById', () => {
  it('returns the descriptor', () => {
    expect(routeById('events.list').method).toBe('GET')
  })

  it('throws for an unknown id and names the alternatives', () => {
    expect(() => routeById('events.nope')).toThrow(ApiContractError)

    try {
      routeById('events.nope')
    } catch (error) {
      expect(error.code).toBe('UNKNOWN_ROUTE')
      expect(error.details.known).toContain('events.list')
    }
  })
})

describe('findRoute', () => {
  it('returns undefined instead of throwing', () => {
    expect(findRoute('events.nope')).toBeUndefined()
    expect(findRoute('events.get')?.id).toBe('events.get')
  })
})

describe('routesByTag', () => {
  it('collects every route tagged `events`, and nothing else', () => {
    // The set, not a hand-kept list in declaration order. An ordered literal
    // has to be edited every time a route is inserted anywhere in the table,
    // which makes it a chore rather than a check — and a chore gets updated
    // reflexively, which is how a check stops checking.
    const tagged = apiRoutes.filter((route) => route.tags.includes('events')).map((r) => r.id)

    expect(routesByTag('events').map((route) => route.id)).toEqual(tagged)
    expect(tagged.length).toBeGreaterThan(15)
    expect(tagged).toContain('events.list')
    expect(tagged).toContain('events.publish')
    expect(tagged).toContain('moderation.decide')
  })

  it('preserves declaration order', () => {
    // What `routesByTag` is actually for: a stable order a document can render.
    const positions = routesByTag('events').map((route) => apiRoutes.indexOf(route))

    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })

  it('returns an empty array for an unused tag', () => {
    expect(routesByTag('nope')).toEqual([])
  })
})

describe('organiser onboarding routes', () => {
  /** id → [method, path, tag, capability, step-up]. */
  const EXPECTED = {
    'organizerInvitations.list': [
      'GET',
      '/v1/platform/organizer-invitations',
      'platform',
      'organizer:invite',
      undefined,
    ],
    'organizerInvitations.create': [
      'POST',
      '/v1/platform/organizer-invitations',
      'platform',
      'organizer:invite',
      'SECURITY_ROLE',
    ],
    'organizerInvitations.revoke': [
      'POST',
      '/v1/platform/organizer-invitations/:id/revoke',
      'platform',
      'organizer:invite',
      undefined,
    ],
    'organizerInvitations.reissue': [
      'POST',
      '/v1/platform/organizer-invitations/:id/reissue',
      'platform',
      'organizer:invite',
      'SECURITY_ROLE',
    ],
    'organizerInvitations.accept': [
      'POST',
      '/v1/organizer-invitations/accept',
      'organizers',
      null,
      undefined,
    ],
  }

  it.each(Object.entries(EXPECTED))(
    '%s has its method, path, tag, capability and step-up',
    (id, [method, path, tag, capability, stepUp]) => {
      const route = routeById(id)

      expect(route.method).toBe(method)
      expect(route.path).toBe(path)
      expect(route.tags).toEqual([tag])
      expect(route.auth).toBe('session')
      expect(route.capability ?? null).toBe(capability)
      expect(route.stepUp).toBe(stepUp)
      expect(route.mfaExempt).toBeUndefined()
    },
  )

  it('documents a failed email on the routes that send codes, and only there', () => {
    const sending = [
      'organizerInvitations.create',
      'organizerInvitations.reissue',
      'teams.invite',
      'teams.reissueInvitation',
      'tickets.startTransfer',
    ]

    for (const route of apiRoutes) {
      expect(route.errors.includes(API_ERRORS.deliveryFailed), route.id).toBe(
        sending.includes(route.id),
      )
    }
    expect(API_ERRORS.deliveryFailed).toMatchObject({ status: 503, code: 'DELIVERY_FAILED' })
  })

  it('keeps the platform organisation search on platform:admin', () => {
    expect(routeById('platform.searchOrganizations').capability).toBe('platform:admin')
  })

  it('keeps organizations.create, which takes no body and is documented as refused', () => {
    const route = routeById('organizations.create')

    expect(route.body).toBeNull()
    expect(route.errors).toEqual([API_ERRORS.unauthorized, API_ERRORS.forbidden])
    expect(route.description).toMatch(/ORGANIZER_INVITATION_REQUIRED/u)
  })

  it('requires the reviewed revision on an approval, and says reviewers are independent', () => {
    const decide = routeById('moderation.decide')

    expect(decide.body.safeParse({ decision: 'approve' }).success).toBe(false)
    expect(decide.body.safeParse({ decision: 'approve', revision: 2 }).success).toBe(true)
    expect(decide.description).toMatch(/CONFLICT_OF_INTEREST/u)
    expect(decide.description).toMatch(/SELF_REVIEW/u)
  })

  it('registers attendees only', () => {
    const register = routeById('auth.register')

    expect(
      register.body.safeParse({
        email: 'a@example.com',
        password: 'garba-nights-2026',
        displayName: 'A',
        role: 'ORGANIZER',
      }).success,
    ).toBe(false)
  })

  it('names the platform tag after what it now holds', () => {
    expect(API_TAGS.find((tag) => tag.name === 'platform').description).toMatch(
      /organiser invitations/u,
    )
  })
})

describe('full control of posted events (SPEC2-XI X)', () => {
  /** id → [method, path, capability, step-up]. */
  const EXPECTED = {
    'events.deletionPreview': ['GET', '/v1/events/:id/deletion', undefined, undefined],
    'events.delete': ['POST', '/v1/events/:id/delete', undefined, 'EVENT_CANCEL'],
    'events.finishRefunds': ['POST', '/v1/events/:id/refunds/finish', undefined, 'EVENT_CANCEL'],
    'events.sessionCancellationPreview': [
      'GET',
      '/v1/events/:id/sessions/:sessionId/cancellation',
      undefined,
      undefined,
    ],
    'events.cancelSession': [
      'POST',
      '/v1/events/:id/sessions/:sessionId/cancel',
      undefined,
      'EVENT_CANCEL',
    ],
    'events.platformEdits': ['GET', '/v1/events/:id/platform-edits', undefined, undefined],
    'platformEvents.list': ['GET', '/v1/platform/events', 'event:platform_edit', undefined],
    'platformEvents.openEdit': [
      'POST',
      '/v1/platform/events/:id/edit',
      'event:platform_edit',
      'MODERATION',
    ],
    'platformEvents.closeEdit': [
      'POST',
      '/v1/platform/events/:id/edit/close',
      'event:platform_edit',
      undefined,
    ],
    'platformEvents.restore': [
      'POST',
      '/v1/platform/events/:id/restore',
      'event:platform_delete',
      'EVENT_PUBLISH',
    ],
    'moderation.mediaQueue': ['GET', '/v1/moderation/media', 'moderation:review', undefined],
  }

  it('places the eleven routes at their method and path, with their capability and step-up', () => {
    for (const [id, [method, path, capability, stepUp]] of Object.entries(EXPECTED)) {
      const route = routeById(id)

      expect(routeKey(route), id).toBe(`${method} ${path}`)
      expect(route.auth, id).toBe('session')
      expect(route.capability ?? undefined, id).toBe(capability)
      expect(route.stepUp ?? undefined, id).toBe(stepUp)
    }
  })

  it('tags none of them `platform`, so the closed platform list stays as it is', () => {
    for (const id of Object.keys(EXPECTED)) {
      expect(routeById(id).tags, id).toEqual(['events'])
    }
  })

  it('declares a step-up on every POST but closing a sitting', () => {
    for (const id of Object.keys(EXPECTED)) {
      const route = routeById(id)

      if (route.method !== 'POST' || id === 'platformEvents.closeEdit') continue

      expect(route.stepUp, id).toBeTruthy()
    }
  })

  it('leaves the authority of the event routes to the handler, which knows the organisation', () => {
    // The organisation is only known once the event is loaded: membership or a
    // platform capability is asserted in the handler, never by a scope.
    for (const id of [
      'events.deletionPreview',
      'events.delete',
      'events.finishRefunds',
      'events.sessionCancellationPreview',
      'events.cancelSession',
      'events.platformEdits',
    ]) {
      expect(routeById(id).capability ?? null, id).toBeNull()
      expect(routeById(id).capabilityScope ?? null, id).toBeNull()
    }
  })
})

describe('importing listed events (SPEC2-XI I)', () => {
  /** id → [method, path, step-up, success status]. */
  const EXPECTED = {
    'eventImports.list': ['GET', '/v1/platform/imports', undefined, 200],
    'eventImports.preview': ['POST', '/v1/platform/imports', undefined, 201],
    'eventImports.get': ['GET', '/v1/platform/imports/:runId', undefined, 200],
    'eventImports.apply': ['POST', '/v1/platform/imports/:runId/apply', 'MODERATION', 200],
    'eventImports.retryImages': [
      'POST',
      '/v1/platform/imports/:runId/images/retry',
      'MODERATION',
      200,
    ],
    'eventImports.approve': ['POST', '/v1/platform/imports/:runId/approve', 'EVENT_PUBLISH', 200],
    'eventImports.targets': ['GET', '/v1/platform/import-targets', undefined, 200],
    'eventImports.reassign': [
      'POST',
      '/v1/platform/imports/events/:eventId/reassign',
      'EVENT_PUBLISH',
      200,
    ],
  }

  it('places the eight routes at their method and path, each held by event:import', () => {
    const declared = apiRoutes.filter((route) => route.id.startsWith('eventImports.'))

    expect(declared.map((route) => route.id).sort()).toEqual(Object.keys(EXPECTED).sort())

    for (const [id, [method, path, stepUp, status]] of Object.entries(EXPECTED)) {
      const route = routeById(id)

      expect(routeKey(route), id).toBe(`${method} ${path}`)
      expect(route.auth, id).toBe('session')
      expect(route.capability, id).toBe('event:import')
      expect(route.capabilityScope ?? null, id).toBeNull()
      expect(route.stepUp ?? undefined, id).toBe(stepUp)
      expect(route.successStatus, id).toBe(status)
    }
  })

  it('tags them `imports`, never `platform`, and describes the tag', () => {
    for (const id of Object.keys(EXPECTED)) {
      expect(routeById(id).tags, id).toEqual(['imports'])
    }

    expect(API_TAGS.find((tag) => tag.name === 'imports').description).toBe(
      'Bringing events listed on another site onto The Desi Events, by its own team.',
    )
  })

  it('declares a step-up on every POST but the preview, which writes only the run', () => {
    for (const id of Object.keys(EXPECTED)) {
      const route = routeById(id)

      if (route.method !== 'POST' || id === 'eventImports.preview') continue

      expect(route.stepUp, id).toBeTruthy()
    }
  })

  it('declares 409 on every write that refuses a run or an event in the wrong state', () => {
    // Apply and retry refuse a run applied, expired or not applied; approve
    // refuses a run not applied (`NOT_EDITABLE`); reassign refuses an event
    // not imported or a target not eligible.
    for (const id of [
      'eventImports.apply',
      'eventImports.retryImages',
      'eventImports.approve',
      'eventImports.reassign',
    ]) {
      expect(
        routeById(id).errors.map((error) => error.status),
        id,
      ).toContain(409)
    }
  })

  it('never lets the apply body ask for anything but the digest and the listings to update', () => {
    const body = routeById('eventImports.apply').body

    expect(body.safeParse({ planDigest: 'a'.repeat(64) }).data).toEqual({
      planDigest: 'a'.repeat(64),
      updateFromSource: [],
    })
    expect(body.safeParse({ planDigest: 'a'.repeat(64), approve: true }).success).toBe(false)
    expect(body.safeParse({ planDigest: 'not-a-digest' }).success).toBe(false)
  })
})

describe('booking fees, referral codes and paying at the venue (SPEC3 §11)', () => {
  /** id → [method, path, capability, step-up, success status, tag]. */
  const EXPECTED = {
    'paymentTerms.get': [
      'GET',
      '/v1/platform/events/:id/payment-terms',
      'payment_terms:manage',
      undefined,
      200,
      'events',
    ],
    'paymentTerms.setFee': [
      'POST',
      '/v1/platform/events/:id/platform-fee',
      'payment_terms:manage',
      'PAYMENT_TERMS',
      200,
      'events',
    ],
    'paymentTerms.setVenuePayment': [
      'POST',
      '/v1/platform/events/:id/venue-payment',
      'payment_terms:manage',
      'PAYMENT_TERMS',
      200,
      'events',
    ],
    'referralCodes.list': [
      'GET',
      '/v1/platform/referral-codes',
      'referral_code:manage',
      undefined,
      200,
      'referral-codes',
    ],
    'referralCodes.byAdministrator': [
      'GET',
      '/v1/platform/referral-codes/by-administrator',
      'referral_code:manage',
      undefined,
      200,
      'referral-codes',
    ],
    'referralCodes.create': [
      'POST',
      '/v1/platform/referral-codes',
      'referral_code:manage',
      'PAYMENT_TERMS',
      201,
      'referral-codes',
    ],
    'referralCodes.get': [
      'GET',
      '/v1/platform/referral-codes/:id',
      'referral_code:manage',
      undefined,
      200,
      'referral-codes',
    ],
    'referralCodes.update': [
      'PATCH',
      '/v1/platform/referral-codes/:id',
      'referral_code:manage',
      'PAYMENT_TERMS',
      200,
      'referral-codes',
    ],
    'referralCodes.switchOff': [
      'POST',
      '/v1/platform/referral-codes/:id/switch-off',
      'referral_code:manage',
      undefined,
      200,
      'referral-codes',
    ],
    'referralCodes.switchOn': [
      'POST',
      '/v1/platform/referral-codes/:id/switch-on',
      'referral_code:manage',
      'PAYMENT_TERMS',
      200,
      'referral-codes',
    ],
    'platformFees.preview': [
      'GET',
      '/v1/platform/orders/:reference/fee',
      'platform_fee:refund',
      undefined,
      200,
      'orders',
    ],
    'platformFees.refund': [
      'POST',
      '/v1/platform/orders/:reference/fee-refund',
      'platform_fee:refund',
      'FINANCE_ACTION',
      200,
      'orders',
    ],
    'venuePayments.report': [
      'GET',
      '/v1/events/:id/venue-payments',
      undefined,
      'FINANCE_VIEW',
      200,
      'events',
    ],
  }

  it('places the thirteen routes at their method and path, with their capability, step-up and status', () => {
    expect(Object.keys(EXPECTED)).toHaveLength(13)

    for (const [id, [method, path, capability, stepUp, status, tag]] of Object.entries(EXPECTED)) {
      const route = routeById(id)

      expect(routeKey(route), id).toBe(`${method} ${path}`)
      expect(route.auth, id).toBe('session')
      expect(route.capability ?? undefined, id).toBe(capability)
      expect(route.capabilityScope ?? undefined, id).toBeUndefined()
      expect(route.stepUp ?? undefined, id).toBe(stepUp)
      expect(route.successStatus, id).toBe(status)
      expect(route.tags, id).toEqual([tag])
    }
  })

  it('declares the referral-codes tag and tags none of the routes `platform`', () => {
    expect(API_TAGS.find((tag) => tag.name === 'referral-codes')?.description).toBe(
      'Codes the team at The Desi Events hands out that remove the booking fee from an order. Made, changed and reported by platform administrators.',
    )

    for (const id of Object.keys(EXPECTED)) {
      expect(routeById(id).tags, id).not.toContain('platform')
    }
  })

  it('never takes a referral code in a path or a query', () => {
    // A code is a bearer discount on the booking fee: it travels only in the
    // POST bodies of a quote and an order, never in a URL (SPEC3 §8.3).
    for (const route of apiRoutes) {
      expect(route.path, route.id).not.toMatch(/referralCode|:code\b/u)

      const query = route.query?.shape ?? {}

      expect(Object.keys(query), route.id).not.toContain('referralCode')
      expect(Object.keys(query), route.id).not.toContain('code')
    }
  })

  it('documents 503 on the writes that wait behind a row, and 429 on every budgeted write', () => {
    const statuses = (id) => routeById(id).errors.map((error) => error.status)

    for (const id of [
      'paymentTerms.setFee',
      'paymentTerms.setVenuePayment',
      'platformFees.refund',
    ]) {
      expect(statuses(id), id).toContain(503)
    }

    for (const id of [
      'paymentTerms.setFee',
      'paymentTerms.setVenuePayment',
      'referralCodes.create',
      'referralCodes.update',
      'referralCodes.switchOff',
      'referralCodes.switchOn',
      'platformFees.refund',
    ]) {
      expect(statuses(id), id).toContain(429)
    }
  })

  it('takes the payment method and the referral code in the quote and order bodies', () => {
    const quote = routeById('orders.quote').body.shape
    const order = routeById('orders.create').body.shape

    expect(Object.keys(quote)).toEqual(expect.arrayContaining(['paymentMethod', 'referralCode']))
    expect(Object.keys(order)).toEqual(
      expect.arrayContaining(['paymentMethod', 'referralCode', 'expectedVenueDueCents']),
    )
    expect(routeById('orders.create').errors.map((error) => error.status)).toContain(401)
  })

  it('names no per-account limit, no hand-on refusal and no completed uses anywhere (SPEC3-XI §1.2, §1.3, §8.4)', () => {
    for (const route of apiRoutes) {
      expect(route.description, route.id).not.toMatch(
        /VENUE_PAYMENT_LIMIT|PAID_AT_VENUE_NOT_TRANSFERABLE/u,
      )
      expect(route.description, route.id).not.toMatch(/completedUses/u)
    }
  })

  it('takes a payment with the door confirmations and documents the amount refusal', () => {
    expect(Object.keys(routeById('tickets.checkIn').body.shape ?? {})).toContain('payment')
    expect(Object.keys(routeById('tickets.checkInGroup').body.shape ?? {})).toContain(
      'paymentCents',
    )

    for (const id of ['tickets.checkIn', 'tickets.checkInGroup']) {
      expect(
        routeById(id).errors.map((error) => error.status),
        id,
      ).toEqual(expect.arrayContaining([409, 422]))
    }
  })
})

describe('unpaid pay-at-the-venue tickets cancelled (SPEC3-XI §11)', () => {
  /** id → [method, path, step-up, tag, error statuses]. */
  const EXPECTED = {
    'venueBookings.unpaid': [
      'GET',
      '/v1/events/:id/venue-bookings',
      'FINANCE_VIEW',
      'events',
      [400, 401, 403, 404, 409],
    ],
    'venueBookings.cancel': [
      'POST',
      '/v1/orders/:reference/venue-cancellations',
      'FINANCE_ACTION',
      'orders',
      [400, 401, 403, 404, 409, 422, 429, 503],
    ],
  }

  it('places the two routes, with their step-up before any handler, and no capability of their own', () => {
    expect(Object.keys(EXPECTED)).toHaveLength(2)

    for (const [id, [method, path, stepUp, tag, statuses]] of Object.entries(EXPECTED)) {
      const route = routeById(id)

      expect(routeKey(route), id).toBe(`${method} ${path}`)
      expect(route.auth, id).toBe('session')
      // The authority is decided in the handler: a membership that grants
      // `order:refund`, or the platform-only `venue_booking:cancel` (XU2).
      expect(route.capability ?? undefined, id).toBeUndefined()
      expect(route.stepUp, id).toBe(stepUp)
      expect(route.successStatus, id).toBe(200)
      expect(route.tags, id).toEqual([tag])
      expect(
        route.errors.map((error) => error.status),
        id,
      ).toEqual(statuses)
    }
  })

  it('brings SPEC3’s thirteen routes to fifteen', () => {
    const spec3 = apiRoutes.filter((route) =>
      /^(paymentTerms|referralCodes|platformFees|venuePayments|venueBookings)\./u.test(route.id),
    )

    expect(spec3).toHaveLength(15)
  })

  it('takes 1 to 100 distinct tickets and a reason, and pages or names one booking', () => {
    const cancel = routeById('venueBookings.cancel').body

    expect(Object.keys(cancel.shape).sort()).toEqual(['reason', 'ticketIds'])
    expect(
      cancel.safeParse({ ticketIds: ['c000000000000000000000001'], reason: 'Never paid' }).success,
    ).toBe(true)
    expect(cancel.safeParse({ ticketIds: [], reason: 'Never paid' }).success).toBe(false)

    const query = routeById('venueBookings.unpaid').query

    expect(Object.keys(query.shape)).toEqual(expect.arrayContaining(['page', 'perPage', 'order']))
  })

  it('answers whether the freed places are on sale as ALL, SOME or NONE, and never a kept tax', () => {
    const data = routeById('venueBookings.cancel').response.shape.data.shape

    expect(data.placesOnSale.options).toEqual(['ALL', 'SOME', 'NONE'])
    expect(Object.keys(data)).toEqual(
      expect.arrayContaining(['feeKeptCents', 'eventSalesStopped', 'replayed', 'placesReturned']),
    )
    expect(Object.keys(data).filter((key) => /tax/iu.test(key))).toEqual([])
  })

  it('says each refusal by its code', () => {
    const description = routeById('venueBookings.cancel').description

    for (const code of [
      'NOT_A_VENUE_BOOKING',
      'TICKET_NOT_IN_BOOKING',
      'VENUE_CANCEL_NOT_LIVE',
      'VENUE_NIGHT_OVER',
      'VENUE_BOOKING_CHANGED',
      'REFUND_IN_PROGRESS',
      'VENUE_CANCEL_TAXED',
      'CONFLICT_OF_INTEREST',
      // What the API sends when the cancellation waited too long behind
      // another change: `budgetedTransaction`'s 503, with `Retry-After`.
      'SERVICE_UNAVAILABLE',
    ]) {
      expect(description, code).toContain(code)
    }

    // The busy refusal is named by the code the API sends, never by one it
    // does not (SPEC3-XI XU10 called it TRY_AGAIN).
    expect(description).not.toContain('TRY_AGAIN')
  })
})

describe('the busy refusal, named by the code the API sends', () => {
  it('is 503 SERVICE_UNAVAILABLE on every route whose change waits behind another', () => {
    for (const id of [
      'paymentTerms.setFee',
      'paymentTerms.setVenuePayment',
      'platformFees.refund',
      'venueBookings.cancel',
      // The final door review (finding 2): each waits behind a row another
      // change can hold for its whole budget, and answers a bounded 503.
      'referralCodes.update',
      'referralCodes.switchOff',
      'referralCodes.switchOn',
      'tickets.revoke',
      'tickets.checkIn',
      'tickets.checkInGroup',
    ]) {
      const route = routeById(id)

      expect(route.description, id).toContain('503 `SERVICE_UNAVAILABLE` with `Retry-After`')
      expect(route.description, id).not.toContain('TRY_AGAIN')
      expect(
        route.errors.some((error) => error.code === 'SERVICE_UNAVAILABLE'),
        id,
      ).toBe(true)
    }
  })

  it('stays TRY_AGAIN only where the API still sends it: a run of clashing generated referral codes', () => {
    expect(routeById('referralCodes.create').description).toContain('503 `TRY_AGAIN`')
  })
})
