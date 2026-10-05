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

import { EXPORT_COLUMNS as ANALYTICS_EXPORT_COLUMNS } from '../src/routes/analytics.js'
import { toConnectStatus } from '../src/lib/connect.js'
import { toDispute, toEvidence, toPayout, toRefund, toTransfer } from '../src/lib/presenters.js'
import { mediaReadRateLimit, mediaUploadRateLimit } from '../src/plugins/rate-limit.js'
import { bearer, createTestApp, signIn } from './helpers/app.js'

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
