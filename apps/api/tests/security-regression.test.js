/**
 * The Phase 2 security findings, re-checked against every surface added since.
 *
 * ## Why this file exists separately from the suites that already test each route
 *
 * Because a finding is a *class* of mistake, and the next route makes it again.
 * NF-05 was a capability asserted without an organisation; NF-12 was a
 * privileged account reaching a guarded route with no second factor; NF-23 was
 * a generated artefact carrying more than the browser needed. Each was fixed in
 * the route that had it, and each could return in the route written next month.
 *
 * So these read the *contract* — every route, not a chosen one — and the
 * presenters, and assert the property rather than the instance. A route added
 * without a `capabilityScope` fails this file on the day it is added, which is
 * the only time the fix is cheap.
 *
 * ## What is not here
 *
 * Anything a single route's own suite already covers better. This is about
 * properties that hold across the whole surface; a test that a particular
 * refund returns a particular status belongs where that refund is tested.
 *
 * @module @desi-event/api/tests/security-regression
 */

import { readFileSync, readdirSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { apiRoutes, buildOpenApiDocument } from '@desi-event/api-contract'
import { apiRouteManifest } from '@desi-event/api-contract/manifest'
import { PLATFORM_ONLY_CAPABILITIES } from '@desi-event/permissions'
import { STEP_UP_POLICIES } from '@desi-event/auth'
import { analyticsTrafficSchema, trafficEventListResponseSchema } from '@desi-event/schemas'
import {
  ACTORS,
  GATES,
  PUBLICLY_VISIBLE_STATUSES,
  TRANSITIONS,
  restoreTarget,
} from '@desi-event/schemas/lifecycle'

import { EXPORT_COLUMNS as ANALYTICS_EXPORT_COLUMNS } from '../src/routes/analytics.js'
import { toConnectStatus } from '../src/lib/connect.js'
import { toDispute, toEvidence, toPayout, toRefund, toTransfer } from '../src/lib/presenters.js'
import { mediaReadRateLimit, mediaUploadRateLimit } from '../src/plugins/rate-limit.js'
import { bearer, createTestApp, signIn } from './helpers/app.js'
import {
  WRITE_OPERATIONS,
  delegateCalls,
  functionRange,
  namesColumn,
  rawWrites,
  readCode,
  relationsTo,
  routeRegistrations,
  sourceFiles,
  withoutComments,
  writesTo,
  writtenFields,
} from './helpers/source-scan.js'

/** The organisation's owner, who holds `finance:view`. */
const OWNER = 'owner@rangoli.example'

/**
 * Sign the owner in.
 *
 * Signing in with a second factor *is* a step-up, so the session starts fresh
 * and the test has to age it to prove the window is enforced.
 *
 * @param {object} app The Fastify instance.
 * @returns {Promise<object>} Authenticated headers.
 */
async function asOwner(app) {
  return bearer(await signIn(app, OWNER))
}

/** Routes that move money, decide who may, or read what somebody is owed. */
const MONEY_TAGS = new Set(['analytics', 'finance', 'refunds'])

describe('NF-05: no capability is asserted without knowing whose organisation it is', () => {
  it('gives every organisation-scoped capability a scope the schema declares', () => {
    for (const route of apiRoutes) {
      if (!route.capability) continue
      if (PLATFORM_ONLY_CAPABILITIES.includes(route.capability)) continue

      // Unscoped, an organisation capability becomes a platform check — which
      // refuses every organiser and passes every platform admin. That inversion
      // is the finding, and it is silent.
      expect(
        route.capabilityScope,
        `${route.id} asserts ${route.capability} with no capabilityScope`,
      ).toMatch(/^(params|query|body)\.[A-Za-z][A-Za-z0-9_]*$/u)
    }
  })

  it('never scopes a platform-only capability, which would be ignored', () => {
    for (const route of apiRoutes) {
      if (!route.capability) continue
      if (!PLATFORM_ONLY_CAPABILITIES.includes(route.capability)) continue

      expect(route.capabilityScope, `${route.id} scopes a platform capability`).toBeUndefined()
    }
  })
})

describe('NF-11: every step-up window is a named policy the server owns', () => {
  it('names a policy that exists', () => {
    for (const route of apiRoutes) {
      if (!route.stepUp) continue

      expect(
        STEP_UP_POLICIES[route.stepUp],
        `${route.id} names a step-up policy that does not exist: ${route.stepUp}`,
      ).toBeTypeOf('number')
    }
  })

  it('demands one on every route that moves money or decides who may', () => {
    const exempt = new Set([
      // A provider callback. It is authenticated by signature over the exact
      // bytes sent, and there is nobody to challenge for a second factor.
      'payments.webhook',
      'webhooks.stripe',
      // The two analytics routes carry money *conditionally*. A route-level
      // gate would refuse the reader who was never going to be shown any — a
      // VIEWER or a door steward holds `report:view` and no second factor,
      // because the system only compels enrolment for privileged roles — so the
      // window is applied to the money branch instead, out of the same
      // `STEP_UP_POLICIES` table, in `routes/analytics.js`. The next test
      // proves the branch is actually gated; without it this exemption would be
      // a hole rather than a design.
      'analytics.summary',
      'analytics.export',
    ])

    for (const route of apiRoutes) {
      if (exempt.has(route.id)) continue
      if (!route.tags.some((tag) => MONEY_TAGS.has(tag))) continue

      expect(route.stepUp, `${route.id} touches money with no step-up policy`).toBeTruthy()
    }
  })

  it('demands the privacy policy on every privacy command', () => {
    // A companion to the money-tag rule, and a narrower one. An irreversible
    // redaction must not be gated by a five-minute finance window or a
    // credential window that says it protects something else; there is exactly
    // one policy for it, and a command on this surface that named another —
    // or none — would be an authority nobody reviewed.
    //
    // Scoped to commands. A read does not destroy anything, and demanding a
    // second factor to look at a list would train operators to keep one to
    // hand, which is the opposite of what the control is for.
    for (const route of apiRoutes) {
      if (!route.tags.includes('privacy')) continue
      if (route.method === 'GET') continue

      expect(
        route.stepUp,
        `${route.id} destroys personal data under the ${route.stepUp ?? 'no'} policy`,
      ).toBe('PRIVACY_ERASURE')
    }
  })

  it('demands SECURITY_ROLE on every platform-tag command, and on handing ownership on', () => {
    // Every write on the platform surface changes who can do what, across the
    // whole platform or inside an organisation from outside it — an organiser
    // invitation is the grant of a new organisation's ownership. The one POST
    // that is not a write is the account search, which takes its query in a
    // body only so that an email address never lands in a URL, a log line or
    // a browser's history. The one write without a step-up is withdrawing an
    // organiser invitation, which only reduces what is on offer.
    const readsOverPost = new Set(['platform.searchUsers'])
    const reducesOnly = new Set(['organizerInvitations.revoke'])
    const platform = apiRoutes.filter((route) => route.tags.includes('platform'))

    expect(platform.map((route) => route.id).sort()).toEqual([
      'organizerInvitations.create',
      'organizerInvitations.list',
      'organizerInvitations.reissue',
      'organizerInvitations.revoke',
      'platform.grantMembership',
      'platform.searchOrganizations',
      'platform.searchUsers',
      'platform.setUserRole',
    ])

    for (const route of platform) {
      // Super administrators hold the platform surface; organiser invitations
      // are also held by platform administrators, and by nobody else.
      expect(
        ['platform:admin', 'organizer:invite'],
        `${route.id} is held by ${route.capability}`,
      ).toContain(route.capability)
      expect(route.id.startsWith('organizerInvitations.'), route.id).toBe(
        route.capability === 'organizer:invite',
      )

      if (route.method === 'GET' || readsOverPost.has(route.id)) {
        expect(route.stepUp ?? null, `${route.id} is a read`).toBeNull()
        continue
      }

      if (reducesOnly.has(route.id)) {
        expect(route.stepUp ?? null, `${route.id} only withdraws`).toBeNull()
        continue
      }

      expect(route.stepUp, `${route.id} changes a role under the wrong policy`).toBe(
        'SECURITY_ROLE',
      )
    }

    expect(apiRoutes.find((route) => route.id === 'teams.transferOwnership').stepUp).toBe(
      'SECURITY_ROLE',
    )
  })

  it('reserves the privacy policy for the privacy surface', () => {
    // The other half of the same claim: a policy named for one thing must not
    // quietly start gating another, or its name stops describing what it
    // protects.
    for (const route of apiRoutes) {
      if (route.stepUp !== 'PRIVACY_ERASURE') continue

      expect(
        route.tags,
        `${route.id} uses the privacy erasure policy without being a privacy route`,
      ).toContain('privacy')
    }
  })

  it('never lets a privacy route be asserted without an organisation', () => {
    // `privacy:redact` is organisation-scoped. A route asserting it unscoped
    // would refuse every organiser and pass every platform admin — finding
    // NF-05 — which on this surface means redacting across tenants.
    for (const route of apiRoutes) {
      if (route.capability !== 'privacy:redact') continue

      expect(route.capabilityScope, `${route.id} asserts privacy:redact unscoped`).toMatch(
        /^(params|query|body)\.[A-Za-z][A-Za-z0-9_]*$/,
      )
    }
  })

  it('stamps every outbox row with the organisation that sent it', () => {
    // Not a tidiness rule. `NotificationOutbox.organizationId` is what an
    // organisation-scoped privacy redaction matches delivery evidence on, and
    // the column sat nullable and unwritten from the Phase 2 commerce migration
    // until Phase 3 — so a scrub of a person's delivery evidence matched zero
    // rows while their address sat in `recipient`, and reported success. A new
    // writer that forgets the column reopens exactly that hole, silently.
    const root = new URL('../src/', import.meta.url)
    const files = []

    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const next = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir)

        if (entry.isDirectory()) walk(next)
        else if (entry.name.endsWith('.js')) files.push(next)
      }
    }

    walk(root)

    const offenders = []

    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      const lines = source.split('\n')

      for (let index = 0; index < lines.length; index += 1) {
        if (!/notificationOutbox\.(create|createMany|upsert)\b/.test(lines[index])) continue

        // The call's own object literal, bounded generously; every writer in
        // this repository closes well inside forty lines.
        const block = lines.slice(index, index + 40).join('\n')

        if (!/organizationId\s*:/.test(block)) {
          offenders.push(`${file.pathname.split('/src/')[1]}:${index + 1}`)
        }
      }
    }

    expect(offenders, `outbox writers with no organisationId: ${offenders.join(', ')}`).toEqual([])
  })

  it('never accepts an authority-bearing field from a browser on the privacy surface', () => {
    // `docs/PHASE3_IMPLEMENTATION_PLAN.md` §10 names the fields a browser must
    // never be able to send. Each one is an answer the server has to produce:
    // a caller-supplied organisation is a caller-supplied authority, a
    // caller-supplied idempotency key is a caller-supplied replay, and a
    // caller-supplied hold decision or outcome is a caller-supplied verdict on
    // whether somebody's data may be destroyed.
    const forbidden = [
      'organizationId',
      'actorId',
      'capability',
      'stepUp',
      'idempotencyKey',
      'outcome',
      'outcomeCode',
      'holdDecision',
      'heldByHoldId',
      'state',
      'policyVersion',
      'confirmationHash',
      'correlationId',
      'confirmed',
      'force',
      'skipHolds',
    ]

    // Widened by route id, never by tag. Widening to `finance` or to MONEY_TAGS
    // would trip immediately on `payouts.schedule`, whose body legitimately
    // carries `organizationId` — its capability guard scopes on
    // `body.organizationId` — and `idempotencyKey`, which is what makes a
    // retried payout a no-op. The connect routes carry the `finance` tag for the
    // step-up invariant's sake and are named here by id for this one.
    for (const route of apiRoutes) {
      if (!route.tags.includes('privacy') && !route.id.startsWith('connect.')) continue
      if (!route.body) continue

      const keys = Object.keys(route.body.shape ?? {})

      for (const key of keys) {
        expect(forbidden, `${route.id} accepts "${key}" from the browser`).not.toContain(key)
      }
    }
  })

  it('never returns a personal value from the privacy surface', () => {
    // The whole surface describes a subject by opaque id and the work by counts.
    // A field named for a person's address or name would be one somebody later
    // fills in, so the name is refused before the value can exist.
    const personal =
      /^(email|phone|address|displayName|buyerName|buyerEmail|attendeeName|toEmail|recipient|subjectEmail|subjectName|name)$/

    const walk = (schema, path, routeId, seen) => {
      if (!schema || seen.has(schema)) return

      seen.add(schema)

      const shape = schema.shape ?? schema._def?.shape
      const resolved = typeof shape === 'function' ? shape() : shape

      if (resolved) {
        for (const [key, value] of Object.entries(resolved)) {
          expect(
            personal.test(key),
            `${routeId} returns "${[...path, key].join('.')}", which names a person`,
          ).toBe(false)

          walk(value, [...path, key], routeId, seen)
        }
      }

      const inner = schema._def?.innerType ?? schema._def?.type ?? schema._def?.element

      if (inner && typeof inner === 'object') walk(inner, path, routeId, seen)
    }

    for (const route of apiRoutes) {
      if (!route.tags.includes('privacy')) continue

      walk(route.response, [], route.id, new Set())
    }
  })

  it('gives every privacy command a body, so nothing destroys data on an empty POST', () => {
    // A command with no body is a command a bare POST reaches. On this surface
    // the body is where the confirmation phrase lives, and a route that did not
    // require one would be a redaction without a confirmation.
    for (const route of apiRoutes) {
      if (!route.tags.includes('privacy')) continue
      if (route.method === 'GET') continue

      expect(route.body, `${route.id} destroys data without requiring a body`).toBeTruthy()
    }
  })

  it('applies the same window to the analytics money branch, in the handler', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await asOwner(app)

    const fresh = await app.inject({
      method: 'GET',
      url: `/v1/analytics/summary?organizationId=${ids.organization.id}&currency=INR`,
      headers,
    })

    expect(fresh.json().data.moneyVisible).toBe(true)

    // Older than `FINANCE_VIEW`'s window, which is the server's number.
    for (const session of prisma._store.session) {
      session.mfaSatisfiedAt = new Date(Date.now() - STEP_UP_POLICIES.FINANCE_VIEW - 1000)
    }

    const stale = await app.inject({
      method: 'GET',
      url: `/v1/analytics/summary?organizationId=${ids.organization.id}&currency=INR`,
      headers,
    })

    const view = stale.json().data

    expect(view.moneyVisible).toBe(false)
    expect(view.moneyWithheld).toBe('STEP_UP')
    expect(view.money).toBeNull()

    await app.close()
  })
})

describe('NF-12: a privileged route cannot be reached without a second factor', () => {
  it('exempts only routes that are about getting one', () => {
    const exempt = apiRoutes.filter((route) => route.mfaExempt).map((route) => route.id)

    // The list is small on purpose and is read rather than trusted: every entry
    // is a route an un-enrolled privileged user must still reach, and anything
    // else on it is a hole.
    for (const id of exempt) {
      expect(
        id,
        `${id} is MFA-exempt but is not about enrolling, reading yourself, or signing out`,
      ).toMatch(/^auth\.|^sessions\./u)
    }
  })
})

describe('NF-23: the generated route manifest carries no schema', () => {
  it('gives the browser a path, a method and nothing else', () => {
    // `body` and `query` are booleans saying whether to send one. That is how
    // to place a request, which is what the manifest is for; the *shape* of
    // either would be the entity description this file exists to keep out.
    const allowed = new Set(['id', 'method', 'path', 'auth', 'body', 'query'])

    for (const route of apiRouteManifest) {
      for (const key of Object.keys(route)) {
        // A capability name, an error catalogue or a body schema in here is a
        // server contract the browser did not need and an attacker did.
        expect(allowed, `the manifest entry for ${route.id} carries "${key}"`).toContain(key)
      }
    }
  })

  it('describes exactly the routes the contract does', () => {
    expect(apiRouteManifest.map((route) => route.id).sort()).toEqual(
      apiRoutes.map((route) => route.id).sort(),
    )
  })
})

describe('allow-list presenters: what a money payload carries', () => {
  /**
   * A row with every field the model has, plus fields it must never emit.
   *
   * The extras are the point. A presenter written as a spread would pass them
   * through, and a presenter written as an allow list drops them — which is the
   * difference this test exists to keep.
   *
   * @param {object} extra The model's own fields.
   * @returns {object} A row to present.
   */
  const rowWith = (extra) => ({
    ...extra,
    buyerEmail: 'priya@example.com',
    buyerName: 'Priya Sharma',
    cardLast4: '4242',
    rawProviderPayload: { object: 'everything the provider sent' },
    internalNote: 'not for anybody outside',
    idempotencyKey: 'not-the-client-s-business',
    createdAt: new Date('2026-09-01T10:00:00Z'),
  })

  /** What must never appear in any of these payloads. */
  const NEVER = [
    'priya@example.com',
    'Priya Sharma',
    '4242',
    'everything the provider sent',
    // The simulated connected account's own three. A provider-shaped identifier
    // in a payload is one in a log; the provider name and mode describe how this
    // deployment is wired rather than anything a caller can act on; and the
    // currency is a column a simulated row deliberately leaves null, so a
    // payload carrying one would be carrying a fabrication.
    'mockacct_',
    'individual.id_number',
    'CAD',
  ]

  it.each([
    [
      'refund',
      toRefund,
      rowWith({
        id: 'c1',
        orderId: 'c2',
        paymentId: 'c3',
        provider: 'in-memory-payments',
        amountCents: 100,
        currency: 'INR',
        reason: 'CUSTOMER_REQUEST',
        status: 'REQUESTED',
        ticketsRevoked: false,
        inventoryReturned: false,
      }),
    ],
    [
      'payout',
      toPayout,
      rowWith({
        id: 'c1',
        organizationId: 'c2',
        provider: 'in-memory-payments',
        amountCents: 100,
        currency: 'INR',
        status: 'SCHEDULED',
      }),
    ],
    [
      'transfer',
      toTransfer,
      rowWith({
        id: 'c1',
        organizationId: 'c2',
        provider: 'in-memory-payments',
        amountCents: 100,
        currency: 'INR',
        status: 'PENDING',
      }),
    ],
    [
      'dispute',
      toDispute,
      rowWith({
        id: 'c1',
        paymentId: 'c2',
        provider: 'in-memory-payments',
        providerDisputeId: 'dp_1',
        amountCents: 100,
        currency: 'INR',
        status: 'OPENED',
        fundsWithheld: true,
      }),
    ],
    [
      'connect status',
      toConnectStatus,
      rowWith({
        id: 'c1',
        organizationId: 'c2',
        provider: 'in-memory-payments',
        providerAccountId: 'mockacct_deadbeefdeadbeefdeadbeef',
        providerMode: 'mock',
        country: 'IN',
        defaultCurrency: 'CAD',
        onboardingStatus: 'REQUIREMENTS_DUE',
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
        disabledReason: 'requirements.past_due',
        requirementsDue: ['individual.id_number'],
      }),
    ],
  ])('the %s presenter drops what it was not asked for', (_name, present, row) => {
    const serialised = JSON.stringify(present(row))

    for (const needle of NEVER) {
      expect(serialised, `a ${_name} payload carried "${needle}"`).not.toContain(needle)
    }

    // The idempotency key is a client's own retry token for the request that
    // created the row, not something a later read hands out.
    expect(serialised).not.toContain('not-the-client-s-business')
    expect(serialised).not.toContain('internalNote')
  })
})

describe('the surfaces added for gate 13', () => {
  /** The route ids this cycle added. */
  const ADDED = ['analytics.summary', 'analytics.export', 'tickets.get']

  it('gives every new route an entry in the published contract', () => {
    // A route that exists without a contract entry is a route nothing reviews,
    // and `defineRoute` is what makes that impossible — but only for routes
    // registered through it. This is the check that the three added this cycle
    // went through the front door.
    for (const id of ADDED) {
      expect(
        apiRoutes.find((route) => route.id === id),
        `${id} is registered but not in the contract`,
      ).toBeTruthy()
    }
  })

  it('scopes every organisation capability the new routes assert', () => {
    for (const id of ['analytics.summary', 'analytics.export']) {
      const route = apiRoutes.find((candidate) => candidate.id === id)

      // `report:view` is an organisation capability. Asserted with no
      // organisation it becomes a platform check, which refuses every organiser
      // and passes every platform admin.
      expect(route.capability).toBe('report:view')
      expect(route.capabilityScope, `${id} asserts report:view unscoped`).toBe(
        'query.organizationId',
      )
      expect(
        route.query.shape.organizationId.def.type,
        `${id} lets the organisation be omitted`,
      ).not.toBe('optional')
    }
  })

  it('branches the ticket read in the handler rather than leaving it open', () => {
    const route = apiRoutes.find((candidate) => candidate.id === 'tickets.get')

    // Two readers with two different rights, so there is no single capability
    // to declare. What the contract must still say is that it needs a session
    // and that a refusal is one of its documented outcomes; the branch itself
    // is asserted in `ticket-lifecycle.test.js` against a real request.
    expect(route.capability).toBeUndefined()
    expect(route.auth).toBe('session')
    expect(route.errors.map((error) => error.code)).toContain('FORBIDDEN')
  })

  it('exports nothing from analytics that names a person or a provider', () => {
    // The column list is the allow list. Read from the module rather than
    // restated, so a column added there fails here rather than being exported
    // quietly — and the field most likely to be added to an analytics row is
    // the one identifying somebody.
    const headers = ANALYTICS_EXPORT_COLUMNS.map((column) => column.key.toLowerCase())

    for (const key of headers) {
      expect(key).not.toMatch(/email|name$|buyer|address|card|provider|token|secret|payment/u)
    }

    expect(headers).toEqual([
      'section',
      'label',
      'code',
      'quantity',
      'amountcents',
      'currency',
      'note',
    ])
  })

  it('keeps counts and money in different export columns', () => {
    // A single "value" column would let a spreadsheet sum two hundred tickets
    // and two hundred rupees into four hundred of something.
    const keys = ANALYTICS_EXPORT_COLUMNS.map((column) => column.key)

    expect(keys).toContain('quantity')
    expect(keys).toContain('amountCents')
  })

  it('drops a provider payload from reconciliation evidence, however it arrives', () => {
    const projected = toEvidence({
      status: 'succeeded',
      receipt_email: 'priya@example.com',
      payment_method_details: { card: { last4: '4242' } },
      charges: { data: [{ billing_details: { name: 'Priya Sharma' } }] },
    })

    expect(JSON.stringify(projected)).not.toMatch(/priya|4242|billing|receipt/iu)
    expect(Object.keys(projected)).toEqual(['status'])
  })

  it('names the organisation on a refund, so a screen cannot ask unscoped', () => {
    const presented = toRefund({
      id: 'c1',
      orderId: 'c2',
      paymentId: 'c3',
      provider: 'in-memory-payments',
      amountCents: 100,
      currency: 'INR',
      reason: 'CUSTOMER_REQUEST',
      status: 'REQUESTED',
      ticketsRevoked: false,
      inventoryReturned: false,
      order: { reference: 'DE-1', event: { organizationId: 'org1' } },
      createdAt: new Date('2026-09-01T10:00:00Z'),
    })

    expect(presented.organizationId).toBe('org1')
  })
})

describe('the Stripe boundary', () => {
  // "Only the adapter imports the Stripe SDK" is asserted in
  // `payment-kill-switch.test.js`, which also checks that nothing reaches a
  // provider's hostname. Repeating it here would be a second copy to keep in
  // step — and the first attempt at one flagged that very test as an offender,
  // because its own source contains the pattern it searches for.

  it('has no route that selects a payment mode', () => {
    for (const route of apiRoutes) {
      const shape = route.body?._def?.shape ?? route.body?.shape
      const keys = typeof shape === 'function' ? Object.keys(shape()) : Object.keys(shape ?? {})

      for (const key of keys) {
        // A request that could name a mode is a request that could ask for the
        // one the kill switch exists to refuse.
        expect(key.toLowerCase(), `${route.id} accepts "${key}"`).not.toMatch(
          /paymentmode|livemode|stripemode/u,
        )
      }
    }
  })
})

describe('event pictures', () => {
  /** Every route the picture surface added. */
  const MEDIA_ROUTES = [
    'events.media',
    'events.addMedia',
    'events.updateMedia',
    'events.reorderMedia',
    'events.removeMedia',
    'media.get',
    'moderation.decideMedia',
  ]

  /**
   * Every property name a JSON Schema fragment declares, at any depth.
   *
   * @param {unknown} node The fragment.
   * @param {Set<string>} [names] Where to collect them.
   * @returns {Set<string>} The names.
   */
  function propertyNames(node, names = new Set()) {
    if (Array.isArray(node)) {
      for (const item of node) propertyNames(item, names)
    } else if (node && typeof node === 'object') {
      for (const [key, value] of Object.entries(node)) {
        if (key === 'properties' && value && typeof value === 'object') {
          for (const name of Object.keys(value)) names.add(name)
        }

        propertyNames(value, names)
      }
    }

    return names
  }

  it('declares no response anywhere that could carry where bytes are kept, how they were checked, or who uploaded them', () => {
    const document = buildOpenApiDocument()
    const declared = propertyNames({ paths: document.paths, components: document.components })

    for (const forbidden of ['storageKey', 'scanNote', 'uploadedById', 'moderatedById']) {
      expect(declared.has(forbidden), forbidden).toBe(false)
    }
  })

  it('leaves organisation authority to the handler, and decides on a picture only with a platform capability and a step-up', () => {
    for (const id of MEDIA_ROUTES) {
      const route = apiRoutes.find((candidate) => candidate.id === id)

      expect(route, id).toBeDefined()
      expect(route.capabilityScope, id).toBeUndefined()

      if (id === 'moderation.decideMedia') {
        expect(PLATFORM_ONLY_CAPABILITIES).toContain(route.capability)
        expect(route.stepUp).toBe('MODERATION')
      } else {
        expect(route.capability ?? null, id).toBeNull()
      }
    }
  })

  it('refuses an upload before its body: the gate and the budget both run at onRequest', () => {
    const source = readFileSync(new URL('../src/routes/media.js', import.meta.url), 'utf8')

    expect(source).toMatch(
      /onRequest: \[app\.requireMfaEnrolment, uploadGate, refuseNonPictureBody\]/u,
    )
    expect(mediaUploadRateLimit().hook).toBe('onRequest')
    expect(mediaReadRateLimit().hook).toBe('preHandler')

    const upload = apiRoutes.find((route) => route.id === 'events.addMedia')
    const statuses = upload.errors.map((error) => error.status)

    expect(statuses).toEqual(expect.arrayContaining([401, 403, 409, 413, 415, 422, 429]))
  })

  it('never answers a picture request with a storage key, whoever asks', async () => {
    const { app, ids } = await createTestApp()
    const headers = bearer(await signIn(app, 'arun@rangoli.example'))
    const { solidPng } = await import('./helpers/images.js')

    const uploaded = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.draftEvent.id}/media?kind=EVENT_COVER&altText=Stage%20at%20dusk&revision=0`,
      headers: { ...headers, 'content-type': 'image/png' },
      payload: solidPng(1200, 630),
    })

    expect(uploaded.statusCode).toBe(201)

    const bodies = [
      uploaded.body,
      (await app.inject({ method: 'GET', url: `/v1/events/${ids.draftEvent.id}/media`, headers }))
        .body,
      (await app.inject({ method: 'GET', url: `/v1/events/${ids.draftEvent.id}`, headers })).body,
      (await app.inject({ method: 'GET', url: '/v1/events' })).body,
    ]

    for (const body of bodies)
      expect(body).not.toMatch(/storageKey|pg\/[0-9a-f]{8}-|scanNote|uploadedById/u)

    await app.close()
  })
})

describe('the door, group-pass and manual-transfer surfaces', () => {
  /** The route ids this work added. */
  const ADDED = [
    'tickets.previewGroupAdmission',
    'tickets.checkInGroup',
    'orders.groupPass',
    'orders.rotateGroupPass',
  ]

  it('puts every new route in the contract, session-only and authorised in its handler', () => {
    // Door authority and group-pass ownership are both decided against rows
    // read from the database — the order's event, the order's buyer — so there
    // is no capability to declare, exactly like `tickets.get`. What the
    // contract must say is that a session is needed.
    for (const id of ADDED) {
      const route = apiRoutes.find((candidate) => candidate.id === id)

      expect(route, `${id} is not in the contract`).toBeTruthy()
      expect(route.auth, id).toBe('session')
      expect(route.capability ?? null, id).toBeNull()
      expect(route.stepUp ?? null, id).toBeNull()
    }
  })

  it('documents the uniform 404 and the 403 on the group preview, and the 409 reasons on the pass', () => {
    const codes = (id) =>
      apiRoutes.find((candidate) => candidate.id === id).errors.map((error) => error.code)

    expect(codes('tickets.previewGroupAdmission')).toEqual(
      expect.arrayContaining(['FORBIDDEN', 'NOT_FOUND', 'RATE_LIMITED']),
    )
    expect(codes('tickets.checkInGroup')).toEqual(
      expect.arrayContaining(['FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'RATE_LIMITED']),
    )
    expect(codes('orders.groupPass')).toEqual(
      expect.arrayContaining(['NOT_FOUND', 'CONFLICT', 'RATE_LIMITED']),
    )
    // Holder-only by a 404, never a 403: a 403 would tell an organiser the
    // order has a buyer account.
    expect(codes('orders.groupPass')).not.toContain('FORBIDDEN')
    expect(codes('orders.rotateGroupPass')).not.toContain('FORBIDDEN')
  })

  it('rate-limits the group door per scanner and the group pass per account', () => {
    const tickets = readFileSync(new URL('../src/routes/tickets.js', import.meta.url), 'utf8')
    const orders = readFileSync(new URL('../src/routes/orders.js', import.meta.url), 'utf8')

    for (const id of ['tickets.previewGroupAdmission', 'tickets.checkInGroup']) {
      const at = tickets.indexOf(`'${id}'`)

      expect(at, id).toBeGreaterThan(-1)
      expect(tickets.slice(at, at + 200), id).toMatch(/admissionRateLimit\(admissionLimit\)/u)
    }

    for (const id of ['orders.groupPass', 'orders.rotateGroupPass']) {
      const at = orders.indexOf(`'${id}'`)

      expect(at, id).toBeGreaterThan(-1)
      expect(orders.slice(at, at + 200), id).toMatch(/passRateLimit\(passLimit\)/u)
    }
  })

  it('names the show-once transfer code invitationCode, never token, in the offer’s response', () => {
    const route = apiRoutes.find((candidate) => candidate.id === 'tickets.startTransfer')
    const data = route.response.shape.data

    expect(data.shape.delivery).toBeDefined()
    expect(data.shape.token).toBeUndefined()
    expect(data.shape.tokenHash).toBeUndefined()
  })
})

describe('the surfaces added for feature completion', () => {
  /**
   * Every route the feature-completion work added: team invitations and
   * organisations, platform roles and the verification queue, event pictures,
   * authoring after publication, promo codes and the checkout quote, and the
   * group pass at the door.
   */
  const ADDED = [
    'events.addMedia',
    'events.media',
    'events.removeMedia',
    'events.reorderMedia',
    'events.reschedule',
    'events.rework',
    'events.ticketTypes',
    'events.updateMedia',
    'media.get',
    'moderation.decideMedia',
    'orders.groupPass',
    'orders.quote',
    'orders.rotateGroupPass',
    'organizations.create',
    'organizations.get',
    'organizers.verificationQueue',
    'organizers.verificationReview',
    'platform.grantMembership',
    'platform.searchOrganizations',
    'platform.searchUsers',
    'platform.setUserRole',
    'promoCodes.create',
    'promoCodes.list',
    'promoCodes.pause',
    'promoCodes.remove',
    'promoCodes.resume',
    'teams.reissueInvitation',
    'teams.transferOwnership',
    'tickets.checkInGroup',
    'tickets.previewGroupAdmission',
    // Invite-only organisers, the website link and visit counting (SPEC2 §3.3).
    'moderation.setWebsiteRedirect',
    'moderation.websiteLinks',
    'organizerInvitations.accept',
    'organizerInvitations.create',
    'organizerInvitations.list',
    'organizerInvitations.reissue',
    'organizerInvitations.revoke',
    'traffic.beacon',
    'traffic.events',
    'traffic.websiteVisit',
  ]

  /**
   * Response keys that carry a bearer secret: something that, held, lets its
   * holder sign in, act as a guest, pass a door, or join a team or take a
   * ticket. Each is returned once, to the one party it is for.
   */
  const SECRET_KEY =
    /^(token|csrfToken|secret|recoveryCodes|guestToken|credential|invitationCode|groupCode)$/u

  /**
   * Where each may appear, and nowhere else. A route that starts returning one
   * of these fails here until somebody decides it should and adds it, which
   * turns "a new route leaked a secret" from a review catch into a failure.
   */
  const SHOW_ONCE = {
    credential: ['orders.groupPass', 'tickets.acceptTransfer', 'tickets.pass'],
    csrfToken: ['auth.login', 'auth.register'],
    groupCode: ['orders.groupPass'],
    guestToken: ['holds.create', 'sessions.hold'],
    invitationCode: [
      'organizerInvitations.create',
      'organizerInvitations.reissue',
      'teams.invite',
      'teams.reissueInvitation',
      'tickets.startTransfer',
    ],
    recoveryCodes: ['auth.confirmTotp'],
    secret: ['auth.enrollTotp'],
    token: ['auth.login', 'auth.register'],
  }

  /**
   * Every secret-shaped property a response of each operation can carry, with
   * the dotted path it sits at. `$ref`s into the components are followed, once
   * per chain, so a shared schema is read wherever it is used.
   *
   * @returns {Map<string, Array<{key: string, path: string}>>} By operation id.
   */
  function secretsByRoute() {
    const document = buildOpenApiDocument()
    const components = document.components?.schemas ?? {}
    /** @type {Map<string, Array<{key: string, path: string}>>} */
    const found = new Map()

    /**
     * @param {unknown} node A JSON Schema fragment.
     * @param {string} path Where it sits in the body.
     * @param {Array<{key: string, path: string}>} into Where to record hits.
     * @param {Set<string>} expanding The `$ref`s on this chain.
     * @returns {void}
     */
    function walk(node, path, into, expanding) {
      if (Array.isArray(node)) {
        for (const item of node) walk(item, path, into, expanding)

        return
      }

      if (!node || typeof node !== 'object') return

      if (typeof node.$ref === 'string') {
        const name = node.$ref.split('/').at(-1)

        if (!expanding.has(name)) {
          walk(components[name], path, into, new Set([...expanding, name]))
        }
      }

      for (const [key, value] of Object.entries(node)) {
        if (key === 'properties' && value && typeof value === 'object') {
          for (const [name, child] of Object.entries(value)) {
            const at = path ? `${path}.${name}` : name

            if (SECRET_KEY.test(name)) into.push({ key: name, path: at })
            walk(child, at, into, expanding)
          }
        } else if (key === 'items') {
          walk(value, `${path}[]`, into, expanding)
        } else if (key !== '$ref') {
          walk(value, path, into, expanding)
        }
      }
    }

    for (const operations of Object.values(document.paths)) {
      for (const operation of Object.values(operations)) {
        const hits = []

        walk(operation.responses ?? {}, '', hits, new Set())
        if (hits.length > 0) found.set(operation.operationId, hits)
      }
    }

    return found
  }

  it('puts every added route in the contract and the manifest, and exempts none from a second factor', () => {
    const manifest = new Set(apiRouteManifest.map((route) => route.id))

    for (const id of ADDED) {
      const route = apiRoutes.find((candidate) => candidate.id === id)

      expect(route, `${id} is not in the contract`).toBeTruthy()
      expect(manifest.has(id), `${id} is not in the manifest`).toBe(true)
      expect(route.mfaExempt ?? false, `${id} is MFA-exempt`).toBe(false)
    }
  })

  it('returns a bearer secret only from the routes allowed to, and every allowance is still used', () => {
    const found = secretsByRoute()
    /** @type {Record<string, string[]>} */
    const observed = {}

    for (const [routeId, hits] of found) {
      for (const { key } of hits) {
        observed[key] = [...new Set([...(observed[key] ?? []), routeId])].sort()
      }
    }

    // Both directions: a new carrier fails, and so does an allowance nothing
    // uses any more, so the list cannot drift into permitting more than it says.
    expect(observed).toEqual(SHOW_ONCE)
  })

  it('carries an invitation code only as data.delivery.invitationCode, and never as a token', () => {
    const found = secretsByRoute()

    for (const id of SHOW_ONCE.invitationCode) {
      const hits = found.get(id) ?? []

      // Once per branch of the delivery union, and always at the same place.
      const paths = new Set(
        hits.filter((hit) => hit.key === 'invitationCode').map((hit) => hit.path),
      )

      expect([...paths], id).toEqual(['data.delivery.invitationCode'])
      expect(
        hits.some((hit) => hit.key === 'token'),
        `${id} returns a token`,
      ).toBe(false)
    }
  })

  it('never lets the creator of an organisation name its state, its owner or its contact', () => {
    // Nobody creates one from a body any more: the self-service route takes no
    // body at all, and an organisation is made by accepting an organiser
    // invitation, whose body names only the code, the web address and the
    // time zone. What goes public, and what the platform decides, is sealed.
    expect(apiRoutes.find((candidate) => candidate.id === 'organizations.create').body).toBeNull()

    const accept = apiRoutes.find((candidate) => candidate.id === 'organizerInvitations.accept')
    const acceptKeys = Object.keys(accept.body.shape)

    expect(acceptKeys.sort()).toEqual(['slug', 'timezone', 'token'])

    for (const sealed of [
      'name',
      'description',
      'websiteUrl',
      'verificationStatus',
      'verified',
      'suspendedAt',
      'suspendedReason',
      'ownerUserId',
      'createdById',
      'createdByUserId',
      'organizationId',
      'role',
      'contactEmail',
      'payoutCurrency',
    ]) {
      expect(acceptKeys, `organizerInvitations.accept accepts ${sealed}`).not.toContain(sealed)
    }

    // And the administrator issuing one names the organisation and its public
    // face, never the role, the state, the digest or an existing organisation.
    const create = apiRoutes.find((candidate) => candidate.id === 'organizerInvitations.create')
    const createKeys = Object.keys(create.body.shape)

    for (const sealed of [
      'role',
      'kind',
      'status',
      'tokenHash',
      'organizationId',
      'invitedById',
      'verificationStatus',
    ]) {
      expect(createKeys, `organizerInvitations.create accepts ${sealed}`).not.toContain(sealed)
    }
  })

  it('rate-limits both places a promo code can be tried: the quote, and a checkout that names one', () => {
    const orders = readFileSync(new URL('../src/routes/orders.js', import.meta.url), 'utf8')

    // The quote, per account. And the charge: it answers an unknown code and a
    // known one differently before anything is written, and it takes guests,
    // so a checkout carrying a code spends from a budget of the same size.
    for (const [id, limiter] of [
      ['orders.quote', /rateLimit: quoteRateLimit\(/u],
      ['orders.create', /rateLimit: promoAttemptRateLimit\(/u],
    ]) {
      const at = orders.indexOf(`'${id}'`)

      expect(at, id).toBeGreaterThan(-1)
      expect(orders.slice(at, at + 200), id).toMatch(limiter)
      expect(
        apiRoutes.find((candidate) => candidate.id === id).errors.map((error) => error.code),
        id,
      ).toContain('RATE_LIMITED')
    }
  })
})

/**
 * Every key a zod schema can produce, at any depth.
 *
 * Walks the definition generically — object shapes, and every child schema a
 * wrapper, an array, a union or a pipe holds — so a key added three levels down
 * in a nullable array of objects is still seen.
 *
 * @param {unknown} schema A zod schema.
 * @param {Set<string>} [keys] Where to collect.
 * @param {Set<unknown>} [seen] Schemas already walked.
 * @returns {Set<string>} The keys.
 */
function schemaKeys(schema, keys = new Set(), seen = new Set()) {
  if (!schema || typeof schema !== 'object' || seen.has(schema)) return keys

  seen.add(schema)

  const definition = schema._zod?.def ?? schema._def

  if (!definition) return keys

  const shape = typeof definition.shape === 'function' ? definition.shape() : definition.shape

  if (shape) {
    for (const [key, child] of Object.entries(shape)) {
      keys.add(key)
      schemaKeys(child, keys, seen)
    }
  }

  for (const [name, value] of Object.entries(definition)) {
    if (name === 'shape') continue

    for (const child of Array.isArray(value) ? value : [value]) {
      if (child && typeof child === 'object' && (child._zod || child._def)) {
        schemaKeys(child, keys, seen)
      }
    }
  }

  if (typeof definition.getter === 'function') schemaKeys(definition.getter(), keys, seen)

  return keys
}

/**
 * A contract route by id.
 *
 * @param {string} id The route id.
 * @returns {object} The route.
 */
function routeById(id) {
  const route = apiRoutes.find((candidate) => candidate.id === id)

  expect(route, `${id} is not in the contract`).toBeDefined()

  return route
}

describe('the source scans themselves', () => {
  // A scan that silently matches nothing passes forever. Each detector is fed
  // the mistake it exists for, and the read it must not mistake for a write.
  it('finds a write, with the columns in its data, and not a read', () => {
    const code = withoutComments(`
      // prisma.event.create({ data: { status: 'PUBLISHED' } }) in a comment is no call.
      await tx.event.update({ where: { status: 'DRAFT' }, data: { websiteRedirectEnabled: true } })
      await prisma.event.findUnique({ where: { id }, select: { websiteRedirectEnabled: true } })
      await db.event.upsert({ where: { slug }, create: { status }, update: { title: '(x)' } })
    `)
    const writes = delegateCalls(code, 'event', WRITE_OPERATIONS)

    expect(writes.map((call) => call.operation)).toEqual(['update', 'upsert'])
    expect([...writtenFields(writes[0].args).fields]).toEqual(['websiteRedirectEnabled'])
    // `where: { status }` is a read; `create: { status }` (shorthand) is a write.
    expect(writtenFields(writes[1].args).fields.has('status')).toBe(true)
    expect(writtenFields(writes[1].args).fields.has('slug')).toBe(false)
  })

  it('says when a write is built elsewhere, rather than guessing', () => {
    const [call] = delegateCalls(
      'tx.event.updateMany({ where: { id }, data: stampsFor({ to }) })',
      'event',
      WRITE_OPERATIONS,
    )

    expect(writtenFields(call.args)).toEqual({ fields: new Set(), opaque: true })
  })

  it('takes a shorthand row, a spread, a computed key or an argument that is no literal as built elsewhere', () => {
    for (const code of [
      'tx.event.update({ where: { id }, data })',
      'prisma.event.create({ data, include: EVENT_INCLUDE })',
      "db.event.upsert({ where: { slug }, create, update: { title: 'x' } })",
      "tx.event.update({ where: { id }, data: { ...changes, title: 'x' } })",
      "tx.event.update({ where: { id }, data: { [column]: 'PUBLISHED' } })",
      'tx.event.update(params)',
      'tx.event.update({ ...params })',
      'tx.event.createMany({ data: rows })',
      "tx.event.createMany({ data: [first, { title: 'x' }] })",
    ]) {
      const [call] = delegateCalls(code, 'event', WRITE_OPERATIONS)

      expect(writtenFields(call.args).opaque, code).toBe(true)
    }

    // A spread in what is read, and an array of literal rows, are not.
    for (const code of [
      "tx.event.updateMany({ where: { ...scope }, data: { title: 'x' } })",
      "tx.event.createMany({ data: [{ title: 'a' }, { title: 'b', status: 'DRAFT' }] })",
    ]) {
      const [call] = delegateCalls(code, 'event', WRITE_OPERATIONS)

      expect(writtenFields(call.args).opaque, code).toBe(false)
    }
  })

  it('finds a call on a delegate named in brackets', () => {
    const [call] = delegateCalls(
      "tx['event'].update({ where: { id }, data: { status: 'PUBLISHED' } })",
      'event',
      WRITE_OPERATIONS,
    )

    expect([call.model, call.operation]).toEqual(['event', 'update'])
    expect(writtenFields(call.args).fields.has('status')).toBe(true)
  })

  it('follows a relation into the rows a nested write makes, and not into a JSON column', () => {
    const code = withoutComments(`
      await tx.organization.update({ where: { id }, data: { events: { create: { title: 'x', status: 'PUBLISHED' } } } })
      await tx.organization.update({ where: { id }, data: { events: { updateMany: { where: { status: 'DRAFT' }, data: { status: 'PUBLISHED' } } } } })
      await tx.eventSession.update({ where: { id }, data: { event: { update: { websiteRedirectEnabled: true } } } })
      await tx.venue.update({ where: { id }, data: { organization: { update: { events: { create: rows } } } } })
      await tx.order.create({ data: { event: { connect: { id } }, buyerEmail } })
      await tx.auditLog.create({ data: { metadata: { event: { update: { status: 'PUBLISHED' } } } } })
    `)
    const writes = writesTo(code, 'Event')

    expect(writes.map((write) => [write.via, write.operation, write.opaque])).toEqual([
      ['organization.events', 'create', false],
      ['organization.events', 'updateMany', false],
      ['eventSession.event', 'update', false],
      ['venue.organization.update.events', 'create', true],
    ])
    expect(writes[0].fields.has('status')).toBe(true)
    // `where: { status: 'DRAFT' }` is a read; `data: { status }` is the write.
    expect([...writes[1].fields]).toEqual(['status'])
    expect(writes[2].fields.has('websiteRedirectEnabled')).toBe(true)
    // The relations come from the schema, so the walk has something to follow.
    expect(relationsTo('Event')).toEqual(expect.arrayContaining(['event', 'events']))
    expect(relationsTo('TrafficEvent')).toEqual(['trafficEvents'])
  })

  it('finds a raw write however its table and columns are spelled, and reads only its statement', () => {
    const code = withoutComments(`
      await tx.$executeRaw\`UPDATE public."Event" SET status = \${to} WHERE id = \${id}\`
      await tx.$executeRawUnsafe('UPDATE ONLY "Event" SET "Status" = $1', to)
      await tx.$executeRaw\`INSERT INTO "public"."Event" (id, title) VALUES (\${id}, 'x')\`
      await tx.$executeRaw\`MERGE INTO "Event" e USING x ON true WHEN MATCHED THEN UPDATE SET "websiteRedirectEnabled" = true\`
      const status = 'not a column'
    `)
    const writes = rawWrites(code)

    expect(
      writes.map((write) => [write.verb, write.table, namesColumn(write.text, 'status')]),
    ).toEqual([
      ['UPDATE', 'Event', true],
      ['UPDATE', 'Event', true],
      // The statement ends with its template: the name on the next line is not in it.
      ['INSERT INTO', 'Event', false],
      ['MERGE INTO', 'Event', false],
    ])
    expect(namesColumn(writes[3].text, 'websiteRedirectEnabled')).toBe(true)
  })

  it('reads past strings, templates and regular expressions that hold brackets', () => {
    const code = withoutComments(
      "tx.event.update({ data: { title: ')', note: `${'}'}`, slug: s.replace(/[)}]/g, '') }, where: { id } })",
    )
    const [call] = delegateCalls(code, 'event', WRITE_OPERATIONS)

    expect([...writtenFields(call.args).fields].sort()).toEqual(['note', 'slug', 'title'])
  })

  it('finds a raw write and the route a call sits in', () => {
    expect(rawWrites('await tx.$executeRaw`UPDATE "Event" SET "status" = ${to}`')).toMatchObject([
      { verb: 'UPDATE', table: 'Event' },
    ])

    const routes = routeRegistrations(
      "defineRoute(app, 'a.one', { handler: () => command(request, 'X') })\ndefineRoute(app, 'a.two', { handler: () => 1 })",
    )

    expect(routes.map((route) => [route.id, /command\(/u.test(route.body)])).toEqual([
      ['a.one', true],
      ['a.two', false],
    ])
  })

  it('reads the application, the worker and the web, and leaves tests and seeds out', () => {
    const files = sourceFiles({ packages: true })

    expect(files).toContain('apps/api/src/routes/events.js')
    expect(files).toContain('apps/worker/src/main.js')
    expect(files).toContain('packages/db/src/traffic-rollup.js')
    expect(files.some((file) => /\.(test|spec)\./u.test(file))).toBe(false)
    expect(files.some((file) => file.includes('/scripts/') || file.includes('/e2e/'))).toBe(false)
  })
})

/**
 * Every write to event rows whose columns are built away from the call, each
 * read and pinned (SPEC2 §6).
 *
 * The scans read the columns a literal row names; they cannot see into a row
 * built elsewhere. So each such write is listed here with why it can carry
 * neither a status nor the website switch, its argument is pinned to the shape
 * that was read, and a new one fails the status and switch scans until
 * somebody has read it and added it.
 */
const OPAQUE_EVENT_WRITES = {
  'apps/api/src/routes/events.js create': {
    why: 'events.create spreads the parsed body and the website columns, then writes DRAFT after both',
    args: /^\s*\{\s*data:\s*\{\s*\.\.\.data,\s*\.\.\.websiteColumnsFor\(null,[\s\S]*?\),\s*status:\s*'DRAFT',\s*publishedAt:\s*null,?\s*\},\s*include:\s*EVENT_INCLUDE,?\s*\}\s*$/u,
  },
  'apps/api/src/routes/events.js update': {
    why: 'events.update writes the parsed body, which has no status, publication time or switch, and the website columns',
    args: /^\s*\{\s*where:\s*\{\s*id:\s*existing\.id\s*\},\s*data:\s*\{\s*\.\.\.data,\s*\.\.\.website\s*\}\s*\}\s*$/u,
  },
  'apps/api/src/lib/event-lifecycle.js updateMany': {
    why: 'the lifecycle’s compare-and-set, whose stampsFor sets the target status',
    args: /^\s*\{\s*where:\s*\{\s*id:\s*event\.id,\s*status:\s*from\s*\},\s*data:\s*stampsFor\(\{\s*to,\s*reason,\s*event\s*\}\),?\s*\}\s*$/u,
  },
  'apps/api/src/lib/privacy-redaction.js update': {
    why: 'an erasure replaces the subject’s contact addresses, and nothing else',
    args: /^\s*\{\s*where:\s*\{\s*id:\s*event\.id\s*\},\s*data\s*\}\s*$/u,
  },
  // SPEC2-XI X-D: a deletion that refunds cancels the live event first, stamped
  // exactly as a cancellation is (`lifecycleStamps` is the lifecycle's own
  // `stampsFor`), public to public; the review gate holds it on PostgreSQL.
  'apps/api/src/lib/event-deletion.js update': {
    why: 'deleteEvent cancels a live event before deleting it, with the lifecycle’s CANCELLED stamps',
    args: /^\s*\{\s*where:\s*\{\s*id:\s*event\.id\s*\},\s*data:\s*lifecycleStamps\(\{\s*to:\s*'CANCELLED',\s*reason,\s*event:\s*locked\s*\}\),?\s*\}\s*$/u,
  },
}

/**
 * Every write to event rows under `apps/<app>/src`: the delegate's own calls
 * and the nested writes another model's write makes through a relation.
 *
 * @returns {Array<object>} The writes, each with its file and a label.
 */
function eventWrites() {
  return sourceFiles().flatMap((file) =>
    writesTo(readCode(file), 'Event').map((write) => ({
      ...write,
      file,
      label: write.via ? `${file} ${write.via}.${write.operation}` : `${file} ${write.operation}`,
    })),
  )
}

/**
 * The keys a function body assigns on its `data` object.
 *
 * @param {string} body The body's text.
 * @returns {string[]} The keys, sorted and unique.
 */
function assignedKeys(body) {
  return [
    ...new Set([...body.matchAll(/\bdata\.(\w+)\s*=(?!=)/gu)].map((match) => match[1])),
  ].sort()
}

describe('every path to a public event (SPEC2 §6)', () => {
  /**
   * Every route that moves an event's status. A duplicate, a copy, an import
   * or any new command fails here until it has been checked against the review
   * gate and named.
   */
  const STATUS_ROUTES = [
    'events.cancel',
    // SPEC2-XI §7: deletion and the platform's restore, each its own command.
    'events.delete',
    'events.openSales',
    'events.pauseSales',
    'events.postpone',
    'events.publish',
    'events.reschedule',
    'events.rework',
    'events.submitReview',
    'events.withdrawReview',
    'moderation.decide',
    'platformEvents.restore',
  ]

  /**
   * Every place the application creates event rows, with the tests that prove
   * each one makes a draft whatever it is sent (SPEC2 §6, binding rule).
   * SPEC2-XI O11 adds the importer here, with its own DRAFT test, when it lands.
   */
  const EVENT_CREATORS = {
    'apps/api/src/routes/events.js': {
      calls: 1,
      provedBy: {
        'apps/api/tests/event-lifecycle.test.js':
          'ignores a status the caller supplies and always starts in DRAFT',
        'apps/api/tests/event-review-gate-integration.test.js':
          'makes a create that asks to be public a draft',
      },
    },
  }

  /**
   * SPEC2-XI §7's one new way from a hidden status to a public one: a platform
   * restore (`platformEvents.restore`) of an event that was public when it was
   * deleted, to `restoreTarget` of that status (an on-sale one comes back
   * paused). Held by the table's gates here, by `desi_event_restore_target` in
   * the deletion trigger and the review gate on PostgreSQL, and proved by these.
   */
  const RESTORE_PROVED_BY = {
    'packages/schemas/src/lifecycle.test.js': [
      'leaves DELETED only by a platform restore, to restoreTarget',
      'never restores to APPROVED or ON_SALE',
      'gates every restore into a public status on a verified organiser',
    ],
    'packages/db/scripts/event-control-probes.mjs': [
      'leaving DELETED from statusBeforeDeletion ON_SALE to ON_SALE is refused',
      'a deleted draft cannot come back public',
      'a restore to the public status an event had passes the review gate',
    ],
  }

  it('makes a hidden event public only from APPROVED, or by a platform restore of what was public, and APPROVED only by a moderator from review', () => {
    for (const [from, moves] of Object.entries(TRANSITIONS)) {
      for (const move of moves) {
        const label = `${from} -> ${move.to}`

        if (PUBLICLY_VISIBLE_STATUSES.has(move.to) && !PUBLICLY_VISIBLE_STATUSES.has(from)) {
          if (move.actor === ACTORS.RESTORE) {
            expect(from, label).toBe('DELETED')
            expect(move.gates, label).toContain(GATES.RESTORE_TARGET)
            expect(move.gates, label).toContain(GATES.VERIFIED_ORGANIZER)

            // Only an event that was public when deleted lands here.
            const priors = Object.keys(TRANSITIONS).filter(
              (prior) => prior !== 'DELETED' && restoreTarget(prior) === move.to,
            )
            expect(priors.length, label).toBeGreaterThan(0)
            for (const prior of priors) {
              expect(PUBLICLY_VISIBLE_STATUSES.has(prior), `${label} from ${prior}`).toBe(true)
            }
            continue
          }

          expect(from, label).toBe('APPROVED')
          expect(move.actor, label).toBe(ACTORS.ORGANIZER)
        }

        if (move.to === 'APPROVED') {
          expect(from, label).toBe('REVIEW_PENDING')
          expect(move.actor, label).toBe(ACTORS.MODERATOR)
        }
      }
    }

    for (const [file, titles] of Object.entries(RESTORE_PROVED_BY)) {
      for (const title of titles) {
        expect(readCode(file), `${file} no longer proves the restore path`).toContain(`'${title}'`)
      }
    }
  })

  it('moves an event’s status from exactly these routes', () => {
    const found = []

    for (const file of sourceFiles().filter((path) => path.startsWith('apps/api/src/routes/'))) {
      for (const route of routeRegistrations(readCode(file))) {
        if (
          /\bcommand\(\s*request\b|\btransitionEvent\s*\(|\bdeleteEvent\s*\(|\brestoreEvent\s*\(/u.test(
            route.body,
          )
        ) {
          found.push(route.id)
        }
      }
    }

    expect(found.sort()).toEqual(STATUS_ROUTES)
  })

  it('calls the lifecycle move only from the two route modules that own it', () => {
    // A library calling `transitionEvent` would make every route that calls the
    // library a status route the list above cannot see.
    const callers = []

    for (const file of sourceFiles()) {
      const calls = [...readCode(file).matchAll(/(?<!function\s+)\btransitionEvent\s*\(/gu)]

      if (calls.length > 0) callers.push(file)
    }

    expect(callers).toEqual(['apps/api/src/routes/events.js', 'apps/api/src/routes/moderation.js'])
  })

  it('guards each status route in the contract, and approves only the revision the reviewer saw', () => {
    for (const id of STATUS_ROUTES) {
      expect(routeById(id).auth, id).toBe('session')
      expect(routeById(id).method, id).toBe('POST')
      expect(routeById(id).tags, id).not.toContain('platform')
    }

    expect(routeById('moderation.decide').capability).toBe('moderation:review')
    expect(routeById('moderation.decide').stepUp).toBe('MODERATION')

    for (const id of ['events.publish', 'events.openSales', 'events.reschedule']) {
      expect(routeById(id).stepUp, id).toBe('EVENT_PUBLISH')
    }

    // Deleting can move money; restoring can make something public again.
    expect(routeById('events.delete').stepUp).toBe('EVENT_CANCEL')
    expect(routeById('platformEvents.restore').stepUp).toBe('EVENT_PUBLISH')
    expect(routeById('platformEvents.restore').capability).toBe('event:platform_delete')

    const decide = routeById('moderation.decide').body
    const unseen = decide.safeParse({ decision: 'approve' })

    expect(unseen.success).toBe(false)
    expect(unseen.error.issues.map((issue) => issue.path.join('.'))).toContain('revision')
    expect(decide.safeParse({ decision: 'approve', revision: 4 }).success).toBe(true)
  })

  it('creates event rows only at the allowed call sites, each writing DRAFT last', () => {
    /** @type {Record<string, number>} */
    const found = {}
    // Every write that can make a row: the delegate's own, and a relation's
    // nested ones (`organization.update({ data: { events: { create } } })`).
    // A relation whose value is built elsewhere (operation null) might.
    const creating = new Set([
      'create',
      'createMany',
      'createManyAndReturn',
      'upsert',
      'connectOrCreate',
      null,
    ])

    for (const file of sourceFiles()) {
      const calls = writesTo(readCode(file), 'Event').filter((write) =>
        creating.has(write.operation),
      )

      if (calls.length === 0) continue

      found[file] = calls.length

      for (const call of calls) {
        const at = `${file}:${call.line}${call.via ? ` (${call.via})` : ''}`
        const { fields, opaque } = call

        // A row built elsewhere could carry any status, so it needs an
        // explicit DRAFT after its last spread: the key written last wins. A
        // row that is only a name or a call has no DRAFT at all and fails.
        if (opaque) {
          const status = call.args.search(/\bstatus\s*:\s*'DRAFT'/u)
          const lastSpread = call.args.lastIndexOf('...')

          expect(status, `${at} builds its row elsewhere with no DRAFT after it`).toBeGreaterThan(
            lastSpread,
          )
        } else if (fields.has('status')) {
          expect(call.args, at).toMatch(/\bstatus\s*:\s*'DRAFT'/u)
        }
      }
    }

    expect(found).toEqual(
      Object.fromEntries(
        Object.entries(EVENT_CREATORS).map(([file, entry]) => [file, entry.calls]),
      ),
    )

    for (const entry of Object.values(EVENT_CREATORS)) {
      for (const [file, title] of Object.entries(entry.provedBy)) {
        expect(readCode(file), `${file} no longer proves the call site writes a draft`).toContain(
          `'${title}'`,
        )
      }
    }
  })

  it('writes an event’s status after creation in one place: the lifecycle’s compare-and-set', () => {
    const writers = []
    const opaque = []

    // The delegate's own writes and every relation's nested ones.
    for (const write of eventWrites()) {
      if (write.fields.has('status')) writers.push(write.label)
      if (write.opaque) opaque.push(write.label)
    }

    // Raw SQL, however the table and the column are spelled.
    for (const file of sourceFiles()) {
      for (const write of rawWrites(readCode(file))) {
        if (
          write.table === 'Event' &&
          write.verb !== 'DELETE FROM' &&
          namesColumn(write.text, 'status')
        ) {
          writers.push(`${file} raw ${write.verb}`)
        }
      }
    }

    // The create above (always DRAFT), deletion's move to DELETED and the
    // platform's restore (SPEC2-XI §7), and nothing else names the column.
    expect(writers.sort()).toEqual([
      'apps/api/src/lib/event-deletion.js update',
      'apps/api/src/lib/event-deletion.js updateMany',
      'apps/api/src/routes/events.js create',
    ])
    // A row built elsewhere could carry a status the list above cannot see,
    // so each one has been read and is pinned (see OPAQUE_EVENT_WRITES).
    expect(opaque.sort()).toEqual(Object.keys(OPAQUE_EVENT_WRITES).sort())

    // Every move is the lifecycle's: one `updateMany` that names the status it
    // expects to replace and takes its data from `stampsFor`, which is where
    // the target status is set. The worker writes no event at all.
    const lifecycle = readCode('apps/api/src/lib/event-lifecycle.js')
    const moves = delegateCalls(lifecycle, 'event', WRITE_OPERATIONS)

    expect(moves.map((call) => call.operation)).toEqual(['updateMany'])
    expect(moves[0].args).toMatch(/where:\s*\{\s*id:\s*event\.id,\s*status:\s*from\s*\}/u)
    expect(moves[0].args).toMatch(/data:\s*stampsFor\(/u)

    for (const file of sourceFiles().filter((path) => path.startsWith('apps/worker/'))) {
      const writes = writesTo(readCode(file), 'Event')

      expect(
        writes.map((write) => `${write.via ?? 'event'}.${write.operation}`),
        file,
      ).toEqual([])
    }
  })

  it('writes DELETED only in deleteEvent, and leaves it only in restoreEvent, to restoreTarget', () => {
    const code = readCode('apps/api/src/lib/event-deletion.js')
    const remove = functionRange(code, 'deleteEvent')
    const restore = functionRange(code, 'restoreEvent')
    const writes = delegateCalls(code, 'event', WRITE_OPERATIONS)
    const named = writes.filter((call) => writtenFields(call.args).fields.has('status'))

    expect(named).toHaveLength(2)

    const [deletion, restoration] = named

    // The deletion: inside deleteEvent, to DELETED and nothing else, recording
    // the status the row had (the trigger checks it is the real one).
    expect(deletion.index).toBeGreaterThan(remove.start)
    expect(deletion.index).toBeLessThan(remove.end)
    expect(deletion.args).toMatch(/status:\s*'DELETED'/u)
    expect(deletion.args).toMatch(/statusBeforeDeletion:\s*from\b/u)

    // The restore: inside restoreEvent, a compare-and-set on DELETED, to the
    // one target `restoreTarget` gives, clearing the record.
    expect(restoration.index).toBeGreaterThan(restore.start)
    expect(restoration.index).toBeLessThan(restore.end)
    expect(restoration.operation).toBe('updateMany')
    expect(restoration.args).toMatch(
      /where:\s*\{\s*id:\s*event\.id,\s*revision,\s*status:\s*'DELETED'\s*\}/u,
    )
    expect(restoration.args).toMatch(/status:\s*to\b/u)
    expect(code.slice(restore.start, restore.end)).toMatch(
      /const to = restoreTarget\(event\.statusBeforeDeletion\)/u,
    )
    expect(restoration.args).toMatch(/statusBeforeDeletion:\s*null/u)
  })

  it('builds an event’s columns away from the write only where each has been read and pinned', () => {
    const opaque = Object.fromEntries(
      eventWrites()
        .filter((write) => write.opaque)
        .map((write) => [write.label, write]),
    )

    expect(Object.keys(opaque).sort()).toEqual(Object.keys(OPAQUE_EVENT_WRITES).sort())

    // Each still has the shape that was read: a spread, a shorthand or a
    // helper added to one of them fails here until it is read again.
    for (const [label, { args }] of Object.entries(OPAQUE_EVENT_WRITES)) {
      expect(opaque[label].args, label).toMatch(args)
    }

    // events.update: the parsed body (the schema drops status and publication
    // times, below, and the switch, in the website block) and the website
    // columns, which `websiteColumnsFor` is pinned to give.
    expect(readCode('apps/api/src/routes/events.js')).toMatch(
      /const website =\s*data\.websiteUrl === undefined\s*\?\s*\{\}\s*:\s*await applyWebsiteChange\(/u,
    )

    // The lifecycle: the status is the move's own target.
    const lifecycle = readCode('apps/api/src/lib/event-lifecycle.js')
    const stamps = functionRange(lifecycle, 'stampsFor')

    expect(lifecycle.slice(stamps.start, stamps.end)).toMatch(/const data = \{ status: to \}/u)
    expect(assignedKeys(lifecycle.slice(stamps.start, stamps.end))).not.toContain('status')

    // The erasure: a row built from nothing, holding the two contact columns.
    const privacy = readCode('apps/api/src/lib/privacy-redaction.js')
    const erasure = functionRange(privacy, 'redactContactAddresses')
    const body = privacy.slice(erasure.start, erasure.end)

    expect(body).toMatch(/const data = \{\}/u)
    expect(assignedKeys(body)).toEqual(['contactEmail', 'publicContactEmail'])
    expect(body).not.toMatch(/\bdata\s*\[|Object\.assign\(\s*data\b|\.\.\.\s*data\b/u)
  })

  it('never lets an event write carry a status or a publication time', () => {
    const update = routeById('events.update').body
    const parsed = update.safeParse({
      title: 'A title',
      status: 'PUBLISHED',
      publishedAt: '2026-01-01T00:00:00.000Z',
      approvedAt: '2026-01-01T00:00:00.000Z',
    })

    expect(parsed.success).toBe(true)
    expect(Object.keys(parsed.data)).toEqual(['title'])
    // A body that is nothing but a status is an empty update.
    expect(update.safeParse({ status: 'PUBLISHED' }).success).toBe(false)
  })
})

describe('the website link (SPEC2 §4.W, §6)', () => {
  /** The columns an administrator's decision writes, and nothing else may. */
  const SWITCH_COLUMNS = [
    'websiteRedirectEnabled',
    'websiteDecidedUrl',
    'websiteRedirectReason',
    'websiteRedirectChangedAt',
    'websiteRedirectChangedById',
  ]

  const OWNER = 'apps/api/src/lib/website-redirect.js'

  it('moves the switch in one place: decideWebsiteRedirect, inside its transaction', () => {
    const writers = []

    for (const file of sourceFiles()) {
      const code = readCode(file)

      for (const call of delegateCalls(code, '[a-z][A-Za-z]*', WRITE_OPERATIONS)) {
        const { fields } = writtenFields(call.args)

        if (SWITCH_COLUMNS.some((column) => fields.has(column))) {
          writers.push({ file, index: call.index, fields })
        }
      }

      for (const write of rawWrites(code)) {
        if (SWITCH_COLUMNS.some((column) => namesColumn(write.text, column))) {
          writers.push({ file, raw: write.verb })
        }
      }
    }

    expect(writers.map((writer) => writer.file)).toEqual([OWNER])

    // A row built elsewhere could carry the switch where the scan above cannot
    // see it: each such event write has been read and is pinned, and the
    // lifecycle's stamps never name a switch column.
    expect(
      eventWrites()
        .filter((write) => write.opaque)
        .map((write) => write.label)
        .sort(),
    ).toEqual(Object.keys(OPAQUE_EVENT_WRITES).sort())

    const lifecycle = readCode('apps/api/src/lib/event-lifecycle.js')
    const stamps = functionRange(lifecycle, 'stampsFor')

    for (const column of SWITCH_COLUMNS) {
      expect(namesColumn(lifecycle.slice(stamps.start, stamps.end), column), column).toBe(false)
    }
    // All five together: a decision is never half-written.
    expect(SWITCH_COLUMNS.every((column) => writers[0].fields.has(column))).toBe(true)

    // The write sits in the private function that only `decideWebsiteRedirect`
    // calls, so there is one door to the switch.
    const code = readCode(OWNER)
    const inner = functionRange(code, 'decideInTransaction')
    const entry = functionRange(code, 'decideWebsiteRedirect')

    expect(writers[0].index).toBeGreaterThan(inner.start)
    expect(writers[0].index).toBeLessThan(inner.end)

    const calls = [...code.matchAll(/(?<!function\s+)\bdecideInTransaction\s*\(/gu)]

    expect(calls.length).toBeGreaterThan(0)

    for (const call of calls) {
      expect(call.index).toBeGreaterThan(entry.start)
      expect(call.index).toBeLessThan(entry.end)
    }
  })

  it('is decided only from the administrators’ route', () => {
    const callers = []

    for (const file of sourceFiles()) {
      const code = readCode(file)

      if (!/(?<!function\s+)\bdecideWebsiteRedirect\s*\(/u.test(code)) continue

      const routes = routeRegistrations(code)
        .filter((route) => /\bdecideWebsiteRedirect\s*\(/u.test(route.body))
        .map((route) => route.id)

      callers.push([file, routes])
    }

    expect(callers).toEqual([
      ['apps/api/src/routes/website-redirect.js', ['moderation.setWebsiteRedirect']],
    ])

    const route = routeById('moderation.setWebsiteRedirect')

    expect(route.capability).toBe('website_redirect:manage')
    expect(route.stepUp).toBe('MODERATION')
    expect(Object.keys(route.body.shape).sort()).toEqual(['enabled', 'reason', 'websiteUrl'])
    expect(
      route.body.safeParse({
        enabled: true,
        reason: 'Checked by hand.',
        websiteUrl: 'https://a.example/',
        websiteDecidedUrl: 'https://b.example/',
      }).success,
    ).toBe(false)
  })

  it('declares website_redirect:manage on exactly the two administrators’ routes, unscoped and off the platform tag', () => {
    const holders = apiRoutes.filter((route) => route.capability === 'website_redirect:manage')

    expect(holders.map((route) => route.id).sort()).toEqual([
      'moderation.setWebsiteRedirect',
      'moderation.websiteLinks',
    ])
    expect(PLATFORM_ONLY_CAPABILITIES).toContain('website_redirect:manage')

    for (const route of holders) {
      expect(route.capabilityScope, route.id).toBeUndefined()
      expect(route.tags, route.id).not.toContain('platform')
      expect(route.auth, route.id).toBe('session')
    }

    expect(routeById('moderation.websiteLinks').method).toBe('GET')
    expect(routeById('moderation.websiteLinks').stepUp ?? null).toBeNull()
  })

  it('answers the lookup from the slug alone: no query, a strict body, its own ceiling, forged origins refused', () => {
    const route = routeById('traffic.websiteVisit')

    expect(route.auth).toBe('none')
    expect(route.capability ?? null).toBeNull()
    expect(route.query ?? null).toBeNull()
    expect(route.params ?? null).toBeNull()
    expect(Object.keys(route.body.shape).sort()).toEqual(['counted', 'slug'])
    expect(route.body.safeParse({ slug: 'garba-night', counted: true }).success).toBe(true)
    // The destination is never the caller's to name.
    expect(
      route.body.safeParse({ slug: 'garba-night', counted: true, url: 'https://evil.example/' })
        .success,
    ).toBe(false)
    expect(route.errors.map((error) => error.code)).toContain('RATE_LIMITED')

    const [registration] = routeRegistrations(
      readCode('apps/api/src/routes/website-redirect.js'),
    ).filter((candidate) => candidate.id === 'traffic.websiteVisit')

    expect(registration.body).toMatch(/rateLimit:\s*websiteVisitRateLimit\(/u)
    expect(registration.body).toMatch(/assertNotForged\(request\)/u)

    // The browser cannot reach it: the web tier's proxy refuses the path, and
    // only the web route that re-validates the destination calls it.
    const proxy = readCode('apps/web/src/app/api/v1/[...path]/route.js')

    expect(proxy).toMatch(/SERVER_ONLY_API_PATHS\s*=\s*Object\.freeze\(\[[^\]]*'website-visits'/u)
  })

  it('never lets an organiser’s write carry the switch', async () => {
    const { websiteColumnsFor } = await import('../src/lib/website-redirect.js')
    const create = routeById('events.create').body
    const update = routeById('events.update').body
    const valid = {
      organizationId: 'cl0000000000000000000org1',
      title: 'Garba Night',
      summary: 'A night of garba.',
      description: 'A long description of a night of garba and dandiya.',
      category: 'GARBA_DANDIYA',
      startsAt: '2031-10-01T18:00:00.000Z',
      endsAt: '2031-10-01T23:00:00.000Z',
    }

    expect(create.safeParse(valid).success, JSON.stringify(create.safeParse(valid).error)).toBe(
      true,
    )

    for (const schema of [create, update]) {
      const base = schema === create ? valid : { title: 'Garba Night' }

      // Refused outright, with a sentence saying who decides.
      for (const key of ['websiteRedirectEnabled', 'websiteRedirect', 'websiteDecidedUrl']) {
        expect(schema.safeParse({ ...base, [key]: true }).success, key).toBe(false)
      }

      // Stripped: never reaches a column.
      const parsed = schema.safeParse({
        ...base,
        websiteRedirectReason: 'Mine now.',
        websiteRedirectChangedAt: '2026-01-01T00:00:00.000Z',
        websiteRedirectChangedById: 'cl0000000000000000000usr1',
        websiteDecisionPending: false,
        websiteSubmittedAt: null,
        websiteRedirectCause: 'ORGANISER',
      })

      expect(parsed.success).toBe(true)
      expect(Object.keys(parsed.data).filter((key) => key.startsWith('website'))).toEqual([])
    }

    // What an organiser's save spreads into its write: the address and whether
    // it waits, never the switch, whatever state the row was in.
    for (const current of [
      null,
      { websiteRedirectEnabled: true, websiteDecidedUrl: 'https://a.example/' },
      {
        websiteRedirectEnabled: false,
        websiteDecisionPending: true,
        websiteSubmittedAt: new Date(),
      },
    ]) {
      for (const next of [null, 'https://a.example/', 'https://b.example/']) {
        expect(Object.keys(websiteColumnsFor(current, next, new Date())).sort()).toEqual([
          'websiteDecisionPending',
          'websiteSubmittedAt',
          'websiteUrl',
        ])
      }
    }
  })
})

describe('visit counting (SPEC2 §4.N, §6)', () => {
  it('takes a beacon from anybody, but only these four fields, none of them about the visitor', () => {
    const route = routeById('traffic.beacon')
    const keys = Object.keys(route.body._zod?.def?.shape ?? route.body.shape ?? {})

    expect(route.auth).toBe('none')
    expect(route.capability ?? null).toBeNull()
    expect(route.method).toBe('POST')
    expect(keys.sort()).toEqual(['eventId', 'kind', 'placement', 'referrer'])

    for (const key of keys) expect(key).not.toMatch(/url|ip|address|agent|account|user/iu)

    const beacon = { eventId: 'cevent00000001', kind: 'PAGE_VIEW', placement: 'EVENT_PAGE' }

    expect(route.body.safeParse(beacon).success).toBe(true)

    for (const extra of [
      { userAgent: 'x' },
      { ip: '203.0.113.9' },
      { userId: 'u1' },
      { url: '/' },
    ]) {
      expect(route.body.safeParse({ ...beacon, ...extra }).success, JSON.stringify(extra)).toBe(
        false,
      )
    }

    const [registration] = routeRegistrations(readCode('apps/api/src/routes/traffic.js')).filter(
      (candidate) => candidate.id === 'traffic.beacon',
    )

    expect(registration.body).toMatch(/rateLimit:\s*trafficBeaconRateLimit\(/u)
    expect(registration.body).toMatch(/assertNotForged\(request\)/u)
  })

  it('shows every event’s visits only to a platform capability, never scoped and never money-tagged', () => {
    const list = routeById('traffic.events')

    expect(list.method).toBe('GET')
    expect(list.auth).toBe('session')
    expect(list.capability).toBe('analytics:view_all')
    expect(PLATFORM_ONLY_CAPABILITIES).toContain('analytics:view_all')
    expect(list.capabilityScope).toBeUndefined()
    expect(list.tags).not.toContain('platform')

    for (const id of ['traffic.beacon', 'traffic.events', 'traffic.websiteVisit']) {
      expect(
        routeById(id).tags.some((tag) => MONEY_TAGS.has(tag)),
        `${id} carries a money tag`,
      ).toBe(false)
    }
  })

  it('answers counts only: no key that could carry a visitor code, an address, an agent or money', () => {
    const forbidden = /hash|dedupe|salt|address|agent|referrer|email|cents|amount/iu

    for (const [name, schema] of [
      ['analyticsTrafficSchema', analyticsTrafficSchema],
      ['trafficEventListResponseSchema', trafficEventListResponseSchema],
    ]) {
      const keys = schemaKeys(schema)

      // The walk really walks: keys from nested rows and a nullable object.
      expect(keys.has('websiteLinkOn'), name).toBe(true)

      for (const key of keys) expect(key, `${name} carries "${key}"`).not.toMatch(forbidden)
    }

    expect(schemaKeys(analyticsTrafficSchema).has('changedByName')).toBe(true)
  })

  it('writes raw visits in one place, and reads them only there and in the roll-up', () => {
    const recorder = 'apps/api/src/lib/traffic.js'
    const rollUp = 'packages/db/src/traffic-rollup.js'
    /** @type {Record<string, string[]>} */
    const touches = {}
    // Through a relation too: a nested write, or an `include`, `select`,
    // `_count` or `where` naming the relation, writes or reads raw rows.
    const relations = relationsTo('TrafficEvent')
    const viaRelation = new RegExp(String.raw`(?<![\w$.])(?:${relations.join('|')})\b`, 'u')
    const table = String.raw`(?:(?:"\w+"|\w+)\s*\.\s*)?"TrafficEvent"`
    const deletes = new RegExp(String.raw`\bDELETE\s+FROM\s+${table}`, 'giu')
    const reads = new RegExp(String.raw`\b(?:FROM|JOIN)\s+${table}`, 'iu')

    expect(relations).toEqual(['trafficEvents'])

    for (const file of sourceFiles({ packages: true })) {
      const code = readCode(file)
      const uses = [
        ...delegateCalls(code, 'trafficEvent').map((call) => call.operation),
        ...(viaRelation.test(code) ? ['relation'] : []),
        ...rawWrites(code)
          .filter((write) => write.table === 'TrafficEvent')
          .map((write) => `raw ${write.verb}`),
        ...(reads.test(code.replace(deletes, '')) ? ['raw SELECT'] : []),
      ]

      if (uses.length > 0) touches[file] = [...new Set(uses)].sort()
    }

    expect(Object.keys(touches).sort()).toEqual([recorder, rollUp])
    expect(touches[recorder]).toEqual(['createMany'])
    // The roll-up reads the day's rows and deletes them once added up; it
    // never writes one.
    expect(touches[rollUp]).toEqual(['raw DELETE FROM', 'raw SELECT'])
  })

  it('keeps the day’s secret and the daily totals with their owners', () => {
    /** @type {Record<string, string[]>} */
    const salts = {}
    /** @type {Record<string, string[]>} */
    const dailyWriters = {}

    for (const file of sourceFiles({ packages: true })) {
      const code = readCode(file)
      const saltUses = [
        ...delegateCalls(code, 'trafficSalt').map((call) => call.operation),
        ...(/"TrafficSalt"/u.test(code) ? ['raw'] : []),
      ]

      if (saltUses.length > 0) salts[file] = saltUses

      const dailyWrites = [
        ...delegateCalls(code, 'trafficDaily', WRITE_OPERATIONS).map((call) => call.operation),
        ...writesTo(code, 'TrafficDaily')
          .filter((write) => write.via)
          .map((write) => `nested ${write.via}.${write.operation}`),
        ...rawWrites(code)
          .filter((write) => write.table === 'TrafficDaily' && write.verb !== 'DELETE FROM')
          .map((write) => `raw ${write.verb}`),
      ]

      if (dailyWrites.length > 0) dailyWriters[file] = dailyWrites
    }

    // The salt that turns an address into a visitor code: made and read by the
    // recorder, deleted by the recorder and the roll-up. Nothing else sees it.
    expect(Object.keys(salts).sort()).toEqual([
      'apps/api/src/lib/traffic.js',
      'packages/db/src/traffic-rollup.js',
    ])
    expect(salts['packages/db/src/traffic-rollup.js']).toEqual(['deleteMany'])
    // Daily totals are written by the roll-up alone; the API only reads them.
    expect(Object.keys(dailyWriters)).toEqual(['packages/db/src/traffic-rollup.js'])
  })
})

describe('organiser invitations (SPEC2 §4.P)', () => {
  it('spends one budget on issuing and reissuing, and limits accepting', () => {
    const registrations = routeRegistrations(
      readCode('apps/api/src/routes/organizer-invitations.js'),
    )
    const byId = Object.fromEntries(registrations.map((route) => [route.id, route.body]))
    const code = readCode('apps/api/src/routes/organizer-invitations.js')

    expect(code).toMatch(/const issueBudget = organizerInviteRateLimit\(/u)

    for (const id of ['organizerInvitations.create', 'organizerInvitations.reissue']) {
      expect(byId[id], id).toMatch(/preHandler:\s*\[issueBudget\]/u)
      expect(
        routeById(id).errors.map((error) => error.code),
        id,
      ).toContain('RATE_LIMITED')
    }

    expect(byId['organizerInvitations.accept']).toMatch(/rateLimit:\s*organizerAcceptRateLimit\(/u)
    expect(routeById('organizerInvitations.accept').errors.map((error) => error.code)).toContain(
      'RATE_LIMITED',
    )
  })

  it('lets anybody signed in accept, off the platform surface, and nobody choose what they become', () => {
    const accept = routeById('organizerInvitations.accept')

    expect(accept.auth).toBe('session')
    expect(accept.capability ?? null).toBeNull()
    expect(accept.mfaExempt ?? false).toBe(false)
    expect(accept.tags).not.toContain('platform')

    // A role, an organisation, a state or the organisation's public face in the
    // body is dropped, never honoured: the invitation decides all of them.
    const parsed = accept.body.safeParse({
      token: 'A'.repeat(32),
      role: 'OWNER',
      organizationId: 'cl0000000000000000000org1',
      verificationStatus: 'VERIFIED',
      name: 'Chosen By Me',
      description: 'Written by the recipient.',
      websiteUrl: 'https://mine.example/',
    })

    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true)
    expect(
      Object.keys(parsed.data).filter((key) => !['slug', 'timezone', 'token'].includes(key)),
    ).toEqual([])
  })
})

describe('full control of posted events (SPEC2-XI X)', () => {
  /** Every route the X work added. */
  const X_ROUTES = [
    'events.cancelSession',
    'events.delete',
    'events.deletionPreview',
    'events.finishRefunds',
    'events.platformEdits',
    'events.sessionCancellationPreview',
    'moderation.mediaQueue',
    'platformEvents.closeEdit',
    'platformEvents.list',
    'platformEvents.openEdit',
    'platformEvents.restore',
  ]

  /** The one command without a second factor: closing a sitting only gives authority up. */
  const GIVES_UP_ONLY = new Set(['platformEvents.closeEdit'])

  /** Response keys that carry a bearer secret, as the feature-completion block names them. */
  const SECRET_KEY =
    /^(token|csrfToken|secret|recoveryCodes|guestToken|credential|invitationCode|groupCode)$/u

  /**
   * Every property name a JSON Schema fragment can carry, `$ref`s followed once
   * per chain.
   *
   * @param {unknown} node The fragment.
   * @param {object} components The document's component schemas.
   * @param {Set<string>} [expanding] The `$ref`s on this chain.
   * @param {Set<string>} [into] Where to record the names.
   * @returns {Set<string>} The names.
   */
  function propertyNames(node, components, expanding = new Set(), into = new Set()) {
    if (Array.isArray(node)) {
      for (const item of node) propertyNames(item, components, expanding, into)

      return into
    }

    if (!node || typeof node !== 'object') return into

    if (typeof node.$ref === 'string') {
      const name = node.$ref.split('/').at(-1)

      if (!expanding.has(name)) {
        propertyNames(components[name], components, new Set([...expanding, name]), into)
      }
    }

    for (const [key, value] of Object.entries(node)) {
      if (key === 'properties' && value && typeof value === 'object') {
        for (const [name, child] of Object.entries(value)) {
          into.add(name)
          propertyNames(child, components, expanding, into)
        }
      } else if (key !== '$ref') {
        propertyNames(value, components, expanding, into)
      }
    }

    return into
  }

  it('puts every X route in the contract and the manifest, none MFA-exempt and none on the platform tag', () => {
    const manifest = new Set(apiRouteManifest.map((route) => route.id))

    for (const id of X_ROUTES) {
      const route = apiRoutes.find((candidate) => candidate.id === id)

      expect(route, `${id} is not in the contract`).toBeTruthy()
      expect(manifest.has(id), `${id} is not in the manifest`).toBe(true)
      expect(route.auth, id).toBe('session')
      expect(route.mfaExempt ?? false, `${id} is MFA-exempt`).toBe(false)
      // The platform tag is the SECURITY_ROLE surface; these are event writes.
      expect(route.tags, id).not.toContain('platform')
    }
  })

  it('demands a second factor on every X command but closing a sitting', () => {
    for (const id of X_ROUTES) {
      const route = apiRoutes.find((candidate) => candidate.id === id)

      if (route.method === 'GET') {
        expect(route.stepUp ?? null, `${id} is a read`).toBeNull()
      } else if (GIVES_UP_ONLY.has(id)) {
        expect(route.stepUp ?? null, `${id} only gives authority up`).toBeNull()
      } else {
        expect(route.stepUp, `${id} has no second factor`).toBeTruthy()
        expect(Object.keys(STEP_UP_POLICIES), id).toContain(route.stepUp)
      }
    }

    expect(
      Object.fromEntries(
        [
          'events.delete',
          'events.finishRefunds',
          'events.cancelSession',
          'platformEvents.openEdit',
          'platformEvents.restore',
        ].map((id) => [id, apiRoutes.find((route) => route.id === id).stepUp]),
      ),
    ).toEqual({
      'events.delete': 'EVENT_CANCEL',
      'events.finishRefunds': 'EVENT_CANCEL',
      'events.cancelSession': 'EVENT_CANCEL',
      'platformEvents.openEdit': 'MODERATION',
      'platformEvents.restore': 'EVENT_PUBLISH',
    })
  })

  it('holds the Desi-Event team’s routes by platform-only capabilities, and leaves the organisers’ to the handler', () => {
    for (const id of X_ROUTES) {
      const route = apiRoutes.find((candidate) => candidate.id === id)

      if (id.startsWith('platformEvents.')) {
        expect(PLATFORM_ONLY_CAPABILITIES, id).toContain(route.capability)
      } else if (id.startsWith('events.')) {
        // Membership first, then the platform: decided per event in the handler.
        expect(route.capability ?? null, id).toBeNull()
      }
    }

    expect(apiRoutes.find((route) => route.id === 'platformEvents.restore').capability).toBe(
      'event:platform_delete',
    )
  })

  it('carries no secret-shaped key in any X response', () => {
    const document = buildOpenApiDocument()
    const components = document.components?.schemas ?? {}

    for (const operations of Object.values(document.paths)) {
      for (const operation of Object.values(operations)) {
        if (!X_ROUTES.includes(operation.operationId)) continue

        const names = [...propertyNames(operation.responses ?? {}, components)]

        expect(
          names.filter((name) => SECRET_KEY.test(name)),
          operation.operationId,
        ).toEqual([])
      }
    }
  })

  it('never lets what deleting would do, or the team’s sittings, be cached', async () => {
    const { app, ids } = await createTestApp()
    const headers = bearer(await signIn(app, 'owner@rangoli.example'))

    for (const url of [
      `/v1/events/${ids.publishedEvent.id}/deletion`,
      `/v1/events/${ids.publishedEvent.id}/platform-edits`,
    ]) {
      const response = await app.inject({ method: 'GET', url, headers })

      expect(response.statusCode, url).toBe(200)
      expect(response.headers['cache-control'], url).toBe('no-store')
    }

    await app.close()
  })
})
