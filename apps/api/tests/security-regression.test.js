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

import { execFile } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { createServer, isIP } from 'node:net'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

import { apiRoutes, buildOpenApiDocument } from '@desi-event/api-contract'
import { apiRouteManifest } from '@desi-event/api-contract/manifest'
import { PLATFORM_ONLY_CAPABILITIES } from '@desi-event/permissions'
import { STEP_UP_POLICIES } from '@desi-event/auth'
import { SENSITIVE_FIELD_KEYS, WILDCARD_KEYS } from '@desi-event/logger'
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
import { fetchImportImage } from '../src/lib/import-images.js'
import { mediaReadRateLimit, mediaUploadRateLimit } from '../src/plugins/rate-limit.js'
import { bearer, createTestApp, signIn, stepUp } from './helpers/app.js'
import { addRows, makeWorld, platformHeldImportFixture } from './helpers/fixtures.js'
import { cuid } from './helpers/prisma-stub.js'
import {
  REPO_ROOT,
  WRITE_OPERATIONS,
  balancedEnd,
  braceStarts,
  delegateCalls,
  functionRange,
  lineOf,
  moduleLoads,
  namesColumn,
  objectEntries,
  patternFilters,
  rawCalls,
  rawWrites,
  readCode,
  relationsTo,
  routeRegistrations,
  rowLockOf,
  sourceFiles,
  withoutComments,
  writesTo,
  writtenFields,
} from './helpers/source-scan.js'

/** `execFile`, awaited. */
const run = promisify(execFile)

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
    // Full control of posted events (SPEC2-XI X): deletion, restore, nights,
    // the sittings of the team at The Desi Events and the pictures queue.
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
    // Importing listed events (SPEC2-XI I).
    'eventImports.apply',
    'eventImports.approve',
    'eventImports.get',
    'eventImports.list',
    'eventImports.preview',
    'eventImports.reassign',
    'eventImports.retryImages',
    'eventImports.targets',
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

  it('finds every pattern filter, its value as written, and an insensitive equals only beside its mode', () => {
    const code = withoutComments(`
      // { title: { contains: q } } in a comment is no filter.
      const where = { OR: [{ title: { contains: q, mode: 'insensitive' } }, { slug: { startsWith: likeLiteral(q) } }] }
      const notes = 'a string holding { contains: q } is no filter'
      const exact = { email: { equals: email } }
      const loose = { email: { equals: email, mode: 'insensitive' } }
      const shorthand = { name: { endsWith } }
      const city = { city: { equals: likeLiteral(city), mode: "insensitive" } }
    `)

    expect(patternFilters(code).map(({ key, value }) => [key, value])).toEqual([
      ['contains', 'q'],
      ['startsWith', 'likeLiteral(q)'],
      ['equals (insensitive)', 'email'],
      ['endsWith', 'endsWith'],
      ['equals (insensitive)', 'likeLiteral(city)'],
    ])
    expect(braceStarts("const a = '{' + `${'{'}` + /{/.source")).toEqual([])
  })

  it('finds every module a file loads, and the names it takes from one', () => {
    const code = withoutComments(`
      // import https from 'node:https' in a comment loads nothing.
      import { isIP, BlockList as List } from 'node:net'
      import https from 'node:https'
      import * as http from 'http'
      import {
        request,
      } from 'undici'
      import 'node:tls'
      export { lookup } from 'node:dns'
      const later = await import('node:http2')
      const old = require("child_process")
      const text = 'require is a word'
    `)

    expect(moduleLoads(code).map(({ specifier, names }) => [specifier, names])).toEqual([
      ['node:net', ['isIP', 'BlockList']],
      ['node:https', null],
      ['http', null],
      ['undici', ['request']],
      ['node:tls', []],
      ['node:dns', null],
      ['node:http2', null],
      ['child_process', null],
    ])
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
  // SPEC2-XI I-C: the import's own organiser moves (into review, back to a
  // draft, and publication after review) of a platform-held import, stamped as
  // the lifecycle stamps them; `importMove` checks the table first.
  'apps/api/src/lib/event-import.js updateMany': {
    why: 'importMove writes the lifecycle’s stamps for one of the import’s own moves, compare-and-set on the status it read',
    args: /^\s*\{\s*where:\s*\{\s*id:\s*event\.id,\s*status:\s*from\s*\},\s*data:\s*lifecycleStamps\(\{\s*to,\s*reason:\s*null,\s*event\s*\}\),?\s*\}\s*$/u,
  },
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
    // SPEC2-XI §7: an import moves its own events into review, and approving
    // one publishes it (through `lib/event-import.js`).
    'eventImports.apply',
    'eventImports.approve',
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
   * SPEC2-XI O11 adds the importer here, with its own DRAFT tests.
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
    'apps/api/src/lib/event-import.js': {
      calls: 1,
      provedBy: {
        'apps/api/tests/event-import.test.js':
          'creates each event as a draft in the platform-held organisation and sends it for review',
        'apps/api/tests/event-import-integration.test.js':
          'creates an imported event as a draft and moves it into review through the gate',
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
          /\bcommand\(\s*request\b|\btransitionEvent\s*\(|\bdeleteEvent\s*\(|\brestoreEvent\s*\(|\bapplyImport\s*\(|\bapproveImported\s*\(/u.test(
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

    // The importer's approval is a moderator's move (SPEC2-XI I-C): its one
    // call is inside `approveOne`, to APPROVED, and only `approveImported`
    // (the approve route's, listed above) reaches it.
    expect(callers).toEqual([
      'apps/api/src/lib/event-import.js',
      'apps/api/src/routes/events.js',
      'apps/api/src/routes/moderation.js',
    ])

    const importer = readCode('apps/api/src/lib/event-import.js')
    const calls = [...importer.matchAll(/(?<!function\s+)\btransitionEvent\s*\(/gu)]
    const approval = functionRange(importer, 'approveOne')

    expect(calls).toHaveLength(1)
    expect(calls[0].index).toBeGreaterThan(approval.start)
    expect(calls[0].index).toBeLessThan(approval.end)
    expect(importer.slice(calls[0].index, calls[0].index + 200)).toMatch(/to:\s*'APPROVED'/u)
  })

  it('reaches deletion, restore and the import’s moves only from their own routes, never through a wrapper', () => {
    // The scan of route bodies above sees a direct call. These library entry
    // points move an event's status (deletion, restore, the import's own
    // moves) or its website switch (reassignment, SPEC2-XI I-F); called from a
    // wrapper in another module, or from a route somewhere else, they would
    // make a status route that list cannot see. So each is called from exactly
    // these routes, under its own name, and nowhere else.
    const DELETION = 'apps/api/src/lib/event-deletion.js'
    const IMPORTER = 'apps/api/src/lib/event-import.js'
    const ENTRY_POINTS = {
      deleteEvent: { owner: DELETION, routes: ['events.delete'] },
      restoreEvent: { owner: DELETION, routes: ['platformEvents.restore'] },
      applyImport: { owner: IMPORTER, routes: ['eventImports.apply'] },
      approveImported: { owner: IMPORTER, routes: ['eventImports.approve'] },
      reassignImportedEvent: { owner: IMPORTER, routes: ['eventImports.reassign'] },
      // Exported, though only the importer's own steps (below) may call it:
      // no route and no other module.
      importMove: { owner: IMPORTER, routes: [] },
    }
    // Inside the importer: which steps make the import's moves, and which
    // entry point reaches each step. None of the steps is exported.
    const STEPS = {
      importMove: ['confirmUnchanged', 'createImported', 'publishImported', 'updateImportedDraft'],
      createImported: ['applyImport'],
      updateImportedDraft: ['applyImport'],
      confirmUnchanged: ['applyImport'],
      publishImported: ['approveOne'],
      approveOne: ['approveImported'],
    }
    const OWNERS = /(?:^|\/)(?:event-deletion|event-import)\.js$/u
    const callsOf = (code, name) => [
      ...code.matchAll(new RegExp(`(?<!function\\s+)\\b${name}\\s*\\(`, 'gu')),
    ]
    /** @type {Record<string, string[]>} */
    const found = {}

    // The server's code; the web reaches none of `apps/api` (browser-bundle.js
    // refuses it), and its own helpers may share these names.
    for (const file of sourceFiles({ packages: true }).filter(
      (path) => !path.startsWith('apps/web/'),
    )) {
      const code = readCode(file)

      for (const load of moduleLoads(code)) {
        if (!OWNERS.test(load.specifier)) continue

        // Taken whole, a call would read `deletion.deleteEvent(`, or not at all.
        expect(load.names, `${file} takes ${load.specifier} whole`).not.toBeNull()
      }

      // What is left once the import statements are gone: every mention of
      // an entry point there must be a call, so it cannot be passed on.
      const body = code.replace(/\bimport\s*\{[^}]*\}\s*from\s*(['"])[^'"\n]+\1/gu, '')

      for (const [name, entry] of Object.entries(ENTRY_POINTS)) {
        if (file === entry.owner) continue

        expect(code, `${file} takes ${name} under another name`).not.toMatch(
          new RegExp(`\\b${name}\\s+as\\b`, 'u'),
        )

        const calls = callsOf(body, name)
        const mentions = [...body.matchAll(new RegExp(`\\b${name}\\b`, 'gu'))]

        expect(mentions.length, `${file} hands ${name} on without calling it`).toBe(calls.length)
        if (calls.length === 0) continue

        const routes = routeRegistrations(code).filter((route) => callsOf(route.body, name).length)
        const inRoutes = routes.reduce((sum, route) => sum + callsOf(route.body, name).length, 0)

        expect(inRoutes, `${file} calls ${name} outside a route`).toBe(calls.length)
        found[name] = [...(found[name] ?? []), ...routes.map((route) => route.id)].sort()
      }
    }

    expect(found).toEqual(
      Object.fromEntries(
        Object.entries(ENTRY_POINTS)
          .filter(([, entry]) => entry.routes.length > 0)
          .map(([name, entry]) => [name, entry.routes]),
      ),
    )

    // Deletion's module calls neither of its entry points itself.
    const deletion = readCode(DELETION)

    for (const name of ['deleteEvent', 'restoreEvent']) {
      expect(callsOf(deletion, name), `${DELETION} calls ${name}`).toEqual([])
    }

    // The importer's entry points call none of each other, and each step that
    // moves an import sits only where it is listed.
    const importer = readCode(IMPORTER)

    for (const name of ['applyImport', 'approveImported', 'reassignImportedEvent']) {
      expect(callsOf(importer, name), `${IMPORTER} calls ${name}`).toEqual([])
    }

    for (const [name, callers] of Object.entries(STEPS)) {
      const ranges = callers.map((caller) => [caller, functionRange(importer, caller)])
      const seen = new Set()

      for (const call of callsOf(importer, name)) {
        const inside = ranges.find(
          ([, range]) => range && call.index > range.start && call.index < range.end,
        )

        expect(inside, `${name} is called outside ${callers.join(', ')}`).toBeTruthy()
        seen.add(inside[0])
      }

      expect([...seen].sort(), name).toEqual(callers)

      if (name !== 'importMove') {
        expect(importer, `${name} is exported`).not.toMatch(
          new RegExp(`\\bexport\\s+(?:async\\s+)?function\\s+${name}\\b`, 'u'),
        )
      }
    }
  })

  it('moves an import only by its own organiser moves, of a platform-held import, publishing only after approval', () => {
    const importer = readCode('apps/api/src/lib/event-import.js')
    const move = functionRange(importer, 'importMove')
    const body = importer.slice(move.start, move.end)

    // In the table, as an organiser's move, of an import the platform holds,
    // with the move's gates run before the write.
    expect(body).toMatch(/findTransition\(from, to\)/u)
    expect(body).toMatch(/move\.actor !== ACTORS\.ORGANIZER/u)
    expect(body).toMatch(/NOT_PLATFORM_HELD/u)
    expect(body.indexOf('gateProblems(')).toBeGreaterThan(-1)
    expect(body.indexOf('gateProblems(')).toBeLessThan(body.indexOf('updateMany('))

    const targets = [...importer.matchAll(/importMove\(tx,\s*\{[^}]*?to:\s*'([A-Z_]+)'/gu)].map(
      (match) => [match[1], match.index],
    )

    expect([...new Set(targets.map(([to]) => to))].sort()).toEqual([
      'DRAFT',
      'PUBLISHED',
      'REVIEW_PENDING',
    ])

    // Publication only in `publishImported`, which only an approval calls.
    const publish = functionRange(importer, 'publishImported')

    for (const [to, index] of targets.filter(([to]) => to === 'PUBLISHED')) {
      expect(index, to).toBeGreaterThan(publish.start)
      expect(index, to).toBeLessThan(publish.end)
    }

    const approval = functionRange(importer, 'approveOne')
    const publishers = [...importer.matchAll(/(?<!function\s+)\bpublishImported\s*\(/gu)]

    expect(publishers.length).toBeGreaterThan(0)
    for (const call of publishers) {
      expect(call.index).toBeGreaterThan(approval.start)
      expect(call.index).toBeLessThan(approval.end)
    }

    // The route that approves needs the review capability and EVENT_PUBLISH.
    expect(routeById('eventImports.approve').stepUp).toBe('EVENT_PUBLISH')
    expect(readCode('apps/api/src/routes/event-imports.js')).toMatch(
      /assertCan\(request\.actor, CAPABILITIES\.MODERATION_REVIEW\)/u,
    )
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
      // The importer's create, always DRAFT (the creators test above).
      'apps/api/src/lib/event-import.js create',
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

    // The importer switches an imported event's Sulekha link on in the
    // transaction that publishes it, and off when it moves to an organiser
    // (SPEC2-XI O6, O10, I-F), through the same function; its routes are the
    // approve and reassign routes, below.
    expect(callers).toEqual([
      ['apps/api/src/lib/event-import.js', []],
      ['apps/api/src/routes/website-redirect.js', ['moderation.setWebsiteRedirect']],
    ])

    const importer = readCode('apps/api/src/lib/event-import.js')
    const decisions = [...importer.matchAll(/(?<!function\s+)\bdecideWebsiteRedirect\s*\(/gu)]
    const publish = functionRange(importer, 'publishImported')
    const reassign = functionRange(importer, 'reassignImportedEvent')

    expect(decisions).toHaveLength(2)
    expect(decisions[0].index).toBeGreaterThan(publish.start)
    expect(decisions[0].index).toBeLessThan(publish.end)
    expect(importer.slice(decisions[0].index, decisions[0].index + 160)).toMatch(
      /enabled:\s*true,\s*reason:\s*IMPORT_REDIRECT_REASON/u,
    )
    expect(decisions[1].index).toBeGreaterThan(reassign.start)
    expect(decisions[1].index).toBeLessThan(reassign.end)
    expect(importer.slice(decisions[1].index, decisions[1].index + 160)).toMatch(
      /enabled:\s*false/u,
    )

    const importRoutes = routeRegistrations(readCode('apps/api/src/routes/event-imports.js'))
      .filter((route) => /\b(approveImported|reassignImportedEvent)\s*\(/u.test(route.body))
      .map((route) => route.id)
      .sort()

    expect(importRoutes).toEqual(['eventImports.approve', 'eventImports.reassign'])

    for (const id of importRoutes) {
      expect(routeById(id).capability, id).toBe('event:import')
      expect(routeById(id).stepUp, id).toBe('EVENT_PUBLISH')
    }

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

  it('holds the routes of the team at The Desi Events by platform-only capabilities, and leaves the organisers’ to the handler', () => {
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

describe('importing listed events (SPEC2-XI I, §7)', () => {
  /** Every route the import work added, which is everything on the `imports` tag. */
  const I_ROUTES = [
    'eventImports.apply',
    'eventImports.approve',
    'eventImports.get',
    'eventImports.list',
    'eventImports.preview',
    'eventImports.reassign',
    'eventImports.retryImages',
    'eventImports.targets',
  ]

  /** The one command without a second factor: planning writes nothing but the run. */
  const PLANS_ONLY = new Set(['eventImports.preview'])

  it('names every import route, on its own tag and off the platform one, none MFA-exempt', () => {
    const manifest = new Set(apiRouteManifest.map((route) => route.id))

    expect(
      apiRoutes
        .filter((route) => route.tags.includes('imports'))
        .map((route) => route.id)
        .sort(),
    ).toEqual(I_ROUTES)

    for (const id of I_ROUTES) {
      const route = routeById(id)

      expect(manifest.has(id), `${id} is not in the manifest`).toBe(true)
      expect(route.auth, id).toBe('session')
      expect(route.mfaExempt ?? false, `${id} is MFA-exempt`).toBe(false)
      // The platform tag is the SECURITY_ROLE surface; an import is event work.
      expect(route.tags, id).not.toContain('platform')
      expect(
        route.tags.some((tag) => MONEY_TAGS.has(tag)),
        `${id} carries a money tag`,
      ).toBe(false)
    }
  })

  it('holds every import route by event:import alone, a platform-only capability, never scoped', () => {
    expect(PLATFORM_ONLY_CAPABILITIES).toContain('event:import')
    expect(
      apiRoutes
        .filter((route) => route.capability === 'event:import')
        .map((route) => route.id)
        .sort(),
    ).toEqual(I_ROUTES)

    for (const id of I_ROUTES) {
      expect(routeById(id).capabilityScope, id).toBeUndefined()
    }
  })

  it('demands a second factor on every import command but planning: MODERATION to write, EVENT_PUBLISH to publish or move', () => {
    /** @type {Record<string, string>} */
    const declared = {}

    for (const id of I_ROUTES) {
      const route = routeById(id)

      if (route.method === 'GET') {
        expect(route.stepUp ?? null, `${id} is a read`).toBeNull()
      } else if (PLANS_ONLY.has(id)) {
        expect(route.stepUp ?? null, `${id} only plans`).toBeNull()
      } else {
        expect(Object.keys(STEP_UP_POLICIES), `${id} has no second factor`).toContain(route.stepUp)
        declared[id] = route.stepUp
      }
    }

    expect(declared).toEqual({
      'eventImports.apply': 'MODERATION',
      'eventImports.approve': 'EVENT_PUBLISH',
      'eventImports.reassign': 'EVENT_PUBLISH',
      'eventImports.retryImages': 'MODERATION',
    })
  })

  it('spends one budget on planning, importing and copying pictures', () => {
    const code = readCode('apps/api/src/routes/event-imports.js')
    const registrations = Object.fromEntries(
      routeRegistrations(code).map((route) => [route.id, route.body]),
    )

    expect(Object.keys(registrations).sort()).toEqual(I_ROUTES)
    expect(code).toMatch(/const budget = eventImportRateLimit\(/u)

    for (const id of ['eventImports.apply', 'eventImports.preview', 'eventImports.retryImages']) {
      expect(registrations[id], id).toMatch(/preHandler:\s*\[budget\]/u)
      expect(
        routeById(id).errors.map((error) => error.code),
        id,
      ).toContain('RATE_LIMITED')
    }
  })
})

/**
 * Every write to one model's rows under `apps/<app>/src`: its delegate's own
 * calls, the nested writes another model's write makes through a relation, and
 * raw `UPDATE`, `INSERT` or `MERGE` statements on its table.
 *
 * @param {string} model The model (`EventPlatformEdit`).
 * @returns {Array<object>} The writes, each with its file; a raw one has `raw: true` and its statement as `text`.
 */
function modelWrites(model) {
  return sourceFiles().flatMap((file) => {
    const code = readCode(file)

    return [
      ...writesTo(code, model).map((write) => ({ ...write, file, raw: false })),
      ...rawWrites(code)
        .filter((write) => write.table === model && write.verb !== 'DELETE FROM')
        .map((write) => ({ ...write, file, raw: true, fields: new Set(), opaque: false })),
    ]
  })
}

/**
 * Whether a write names a column: in its row, or in its raw statement.
 *
 * @param {object} write A write from {@link modelWrites}.
 * @param {string} column The column.
 * @returns {boolean} True when it writes the column.
 */
function writesColumn(write, column) {
  return write.raw ? namesColumn(write.text, column) : write.fields.has(column)
}

/**
 * The files a list of writes sits in, in order and once each.
 *
 * @param {Array<{file: string}>} writes The writes.
 * @returns {string[]} The files.
 */
function filesOf(writes) {
  return [...new Set(writes.map((write) => write.file))].sort()
}

describe('the records full control and imports keep, each with one writer (SPEC2-XI §7)', () => {
  /** An event's deletion record (SPEC2-XI §5.X-D, `event_deletion_consistency`). */
  const DELETION_COLUMNS = [
    'deletedAt',
    'deletedById',
    'deletionReason',
    'deletionOutcome',
    'deletionAuthority',
    'statusBeforeDeletion',
    'deletedSlug',
  ]

  const DELETION_OWNER = 'apps/api/src/lib/event-deletion.js'

  it('records a deletion only in deleteEvent, and clears it only in restoreEvent', () => {
    const writers = modelWrites('Event').filter(
      (write) =>
        DELETION_COLUMNS.some((column) => writesColumn(write, column)) ||
        (write.raw ? /'DELETED'/u.test(write.text) : /\bstatus\s*:\s*'DELETED'/u.test(write.args)),
    )

    expect(filesOf(writers)).toEqual([DELETION_OWNER])

    const code = readCode(DELETION_OWNER)
    const remove = functionRange(code, 'deleteEvent')
    const restore = functionRange(code, 'restoreEvent')

    expect(writers).toHaveLength(2)

    const [setting, clearing] = writers

    // The whole record at once, never half of it.
    for (const write of writers) {
      expect(
        DELETION_COLUMNS.filter((column) => !writesColumn(write, column)),
        `line ${write.line}`,
      ).toEqual([])
    }

    expect(setting.index).toBeGreaterThan(remove.start)
    expect(setting.index).toBeLessThan(remove.end)
    expect(setting.args).toMatch(/\bstatus:\s*'DELETED'/u)

    expect(clearing.index).toBeGreaterThan(restore.start)
    expect(clearing.index).toBeLessThan(restore.end)
    // Out of DELETED (the `where`), to the target restoreTarget gives (the `data`).
    expect(clearing.args).toMatch(
      /where:\s*\{[^}]*\bstatus:\s*'DELETED'[^}]*\},\s*data:\s*\{[^}]*\bstatus:\s*to\b/u,
    )

    for (const column of DELETION_COLUMNS) {
      expect(clearing.args, column).toMatch(new RegExp(`\\b${column}:\\s*null\\b`, 'u'))
      expect(setting.args, column).not.toMatch(new RegExp(`\\b${column}:\\s*null\\b`, 'u'))
    }
  })

  it('lets no row built elsewhere, and no request, carry a deletion record', () => {
    // Every event row built away from its write has been read and pinned
    // (OPAQUE_EVENT_WRITES); none of the shapes read can hold these columns.
    expect(
      eventWrites()
        .filter((write) => write.opaque)
        .map((write) => write.label)
        .sort(),
    ).toEqual(Object.keys(OPAQUE_EVENT_WRITES).sort())

    const lifecycle = readCode('apps/api/src/lib/event-lifecycle.js')
    const stamps = functionRange(lifecycle, 'stampsFor')

    for (const column of DELETION_COLUMNS) {
      expect(namesColumn(lifecycle.slice(stamps.start, stamps.end), column), column).toBe(false)
    }

    // No request body anywhere names a column of the record: the server
    // writes it from the actor, the clock and what it decided.
    for (const route of apiRoutes) {
      const keys = [route.body, route.query, route.params].flatMap((schema) => [
        ...schemaKeys(schema),
      ])

      for (const column of DELETION_COLUMNS) {
        expect(keys, `${route.id} accepts ${column}`).not.toContain(column)
      }
    }

    // And the organiser's edit drops them with everything else it does not know.
    const parsed = routeById('events.update').body.safeParse({
      title: 'A title',
      ...Object.fromEntries(DELETION_COLUMNS.map((column) => [column, 'x'])),
    })

    expect(parsed.success).toBe(true)
    expect(Object.keys(parsed.data)).toEqual(['title'])
  })

  it('opens the sittings of the team at The Desi Events in the open route alone, and ends them only in the authority module and the control routes', () => {
    const writes = modelWrites('EventPlatformEdit')

    expect(filesOf(writes)).toEqual([
      'apps/api/src/lib/event-authority.js',
      'apps/api/src/routes/event-control.js',
    ])
    expect(writes.filter((write) => write.opaque || write.raw)).toEqual([])

    const opening = new Set(['create', 'createMany', 'createManyAndReturn', 'upsert', null])
    const opened = writes.filter((write) => opening.has(write.operation))

    expect(opened.map((write) => `${write.file} ${write.operation}`)).toEqual([
      'apps/api/src/routes/event-control.js create',
    ])

    // Every other write only ends a sitting.
    for (const write of writes.filter((candidate) => !opened.includes(candidate))) {
      expect([...write.fields].sort(), `${write.file}:${write.line}`).toEqual([
        'closedAt',
        'endedBy',
      ])
    }

    const openers = routeRegistrations(readCode('apps/api/src/routes/event-control.js'))
      .filter((route) => /\beventPlatformEdit\s*\.\s*create\s*\(/u.test(route.body))
      .map((route) => route.id)

    expect(openers).toEqual(['platformEvents.openEdit'])
    expect(routeById('platformEvents.openEdit').stepUp).toBe('MODERATION')
    expect(PLATFORM_ONLY_CAPABILITIES).toContain(routeById('platformEvents.openEdit').capability)
  })

  it('never lets a sitting’s authority move an event’s status (Rule L)', () => {
    // SPEC2-XI §7: a sitting edits what an event says, its nights and tiers
    // and its pictures, and cancels a night; it never publishes, opens or
    // pauses sales, postpones, cancels, deletes or restores. The lifecycle's
    // own check is `lifecycleAuthority`, which takes no sitting.
    const SITTING_READERS =
      /(?<!function\s+)\b(?:resolveEventAuthority|openSittingOf|assertSittingStillOpen)\s*\(/gu
    const readers = sourceFiles({ packages: true }).filter(
      (file) => [...readCode(file).matchAll(SITTING_READERS)].length > 0,
    )

    expect(readers).toEqual([
      'apps/api/src/lib/event-authoring.js',
      'apps/api/src/lib/event-authority.js',
      'apps/api/src/lib/event-media.js',
      'apps/api/src/lib/session-cancellation.js',
      'apps/api/src/routes/event-authoring.js',
      'apps/api/src/routes/event-control.js',
    ])

    // None of them is where a status moves, and no route that moves one
    // reads a sitting.
    for (const owner of [
      'apps/api/src/lib/event-deletion.js',
      'apps/api/src/lib/event-import.js',
      'apps/api/src/lib/event-lifecycle.js',
      'apps/api/src/routes/events.js',
      'apps/api/src/routes/moderation.js',
    ]) {
      expect(readers, owner).not.toContain(owner)
    }

    const statusRoutes = new Set([
      'eventImports.apply',
      'eventImports.approve',
      'events.delete',
      'platformEvents.restore',
    ])

    for (const file of readers.filter((path) => path.includes('/routes/'))) {
      for (const route of routeRegistrations(readCode(file))) {
        if (!statusRoutes.has(route.id)) continue

        expect([...route.body.matchAll(SITTING_READERS)], route.id).toEqual([])
      }
    }

    const lifecycle = readCode('apps/api/src/lib/event-lifecycle.js')

    expect(lifecycle).toMatch(
      /return lifecycleAuthority\(actor, event, capabilityFor\(move\.to\)\)/u,
    )
  })

  it('decides whether a picture is shown in one module', () => {
    const writes = modelWrites('MediaAsset')
    const deciders = writes.filter(
      (write) => write.opaque || writesColumn(write, 'moderationStatus'),
    )

    // A picture row built elsewhere could carry the decision unseen, so it
    // counts as one wherever it is.
    expect(filesOf(deciders)).toEqual(['apps/api/src/lib/event-media.js'])
    expect(deciders.length).toBeGreaterThan(0)
  })

  it('keeps the platform-held organisation with its provisioner, and the import records with the importer', () => {
    // SPEC2-XI §7.5 allows these two; today only the provisioner writes the
    // column, and the importer asks it (`ensurePlatformHeldOrganization`).
    const allowed = [
      'apps/api/src/lib/event-import.js',
      'apps/api/src/lib/organization-provisioning.js',
    ]
    const holders = []

    for (const file of sourceFiles()) {
      const code = readCode(file)

      for (const call of delegateCalls(code, '[a-z][A-Za-z]*', WRITE_OPERATIONS)) {
        // `writtenFields` reads nested rows too: an organisation created
        // through an event's relation names the column here as well.
        if (writtenFields(call.args).fields.has('platformHeldSource')) holders.push(file)
      }

      for (const write of rawWrites(code)) {
        if (namesColumn(write.text, 'platformHeldSource')) holders.push(`${file} raw`)
      }
    }

    expect([...new Set(holders)]).toEqual(['apps/api/src/lib/organization-provisioning.js'])
    for (const file of holders) expect(allowed, file).toContain(file)

    // An organisation row built away from its write could carry the column
    // where the scan cannot see it: there is none.
    expect(
      modelWrites('Organization')
        .filter((write) => write.opaque)
        .map((write) => `${write.file}:${write.line}`),
    ).toEqual([])

    for (const route of apiRoutes) {
      const keys = [route.body, route.query, route.params].flatMap((schema) => [
        ...schemaKeys(schema),
      ])

      expect(keys, `${route.id} accepts platformHeldSource`).not.toContain('platformHeldSource')
    }

    for (const model of ['EventImportRun', 'EventImportItem', 'EventImportImage']) {
      const writes = modelWrites(model)

      expect(filesOf(writes), model).toEqual(['apps/api/src/lib/event-import.js'])
      expect(writes.length, model).toBeGreaterThan(0)
    }
  })

  it('records change notices in one module, from the four moves that change an event under its buyers', () => {
    const owner = 'apps/api/src/lib/event-change-notices.js'
    const callers = {
      'apps/api/src/lib/event-cancellation.js': 'cancellationWork',
      'apps/api/src/lib/event-deletion.js': 'deleteEvent',
      'apps/api/src/lib/event-material-change.js': 'materialChangeWork',
      'apps/api/src/lib/session-cancellation.js': 'cancelSession',
    }

    expect(filesOf(modelWrites('EventChangeNotice'))).toEqual([owner])

    /** @type {Record<string, number>} */
    const found = {}

    for (const file of sourceFiles({ packages: true })) {
      const code = readCode(file)
      const calls = [...code.matchAll(/(?<!function\s+)\brecordChangeNotice\s*\(/gu)]

      // Taken under another name, a call would not be seen.
      expect(code, file).not.toMatch(/\brecordChangeNotice\s+as\b/u)

      for (const load of moduleLoads(code)) {
        if (!load.specifier.endsWith('event-change-notices.js')) continue

        expect(load.names, `${file} takes the whole notices module`).not.toBeNull()
      }

      if (calls.length === 0) continue

      found[file] = calls.length

      const body = functionRange(code, callers[file] ?? '\\u0000')

      for (const call of calls) {
        expect(body, `${file} records a notice outside ${callers[file]}`).not.toBeNull()
        expect(call.index).toBeGreaterThan(body.start)
        expect(call.index).toBeLessThan(body.end)
      }
    }

    expect(Object.keys(found).sort()).toEqual(Object.keys(callers).sort())
  })
})

describe('the picture fetcher, the API’s one way out (SPEC2-XI §0.6, §5.I-D)', () => {
  const FETCHER = 'apps/api/src/lib/import-images.js'

  /** Modules that are, or open, a network client. */
  const CLIENTS = /^(?:node:)?(?:http|https|http2|tls|dgram|child_process|undici)$/u

  /** What `node:net` may be asked for without opening anything. */
  const NET_HELPERS = new Set(['isIP', 'isIPv4', 'isIPv6', 'BlockList', 'SocketAddress'])

  it('is the only module under apps/api/src that loads an HTTP client or opens a socket, and nothing calls fetch', () => {
    /** @type {Record<string, string[]>} */
    const loads = {}
    const callers = []

    for (const file of sourceFiles().filter((path) => path.startsWith('apps/api/src/'))) {
      const code = readCode(file)

      for (const load of moduleLoads(code)) {
        const net = /^(?:node:)?net$/u.test(load.specifier)

        if (
          CLIENTS.test(load.specifier) ||
          (net && (load.names === null || load.names.some((name) => !NET_HELPERS.has(name))))
        ) {
          loads[file] = [...(loads[file] ?? []), load.specifier]
        }
      }

      if (
        /(?<![\w$.])fetch\s*\(|\bglobalThis\s*\.\s*fetch\b|\bnew\s+(?:WebSocket|EventSource|XMLHttpRequest)\b/u.test(
          code,
        )
      ) {
        callers.push(file)
      }
    }

    expect(loads).toEqual({ [FETCHER]: ['node:https'] })
    expect(callers).toEqual([])
  })

  it('sends nothing through a proxy, whatever the environment says', async () => {
    // A proxy would connect to wherever it resolved the name, after this code
    // checked a different answer. The listener stands in for one; the child
    // process is told to use it by every variable Node and the usual tools read.
    const seen = []
    const proxy = createServer((socket) => {
      socket.on('error', () => {})
      socket.once('data', (chunk) => {
        seen.push(chunk.toString('latin1').split('\r\n')[0])
        socket.destroy()
      })
    })

    await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve))

    const url = `http://127.0.0.1:${proxy.address().port}`

    try {
      const { stdout } = await run(
        process.execPath,
        [
          fileURLToPath(new URL('./helpers/proxy-env-probe.mjs', import.meta.url)),
          'control.invalid',
        ],
        {
          cwd: fileURLToPath(new URL('..', import.meta.url)),
          timeout: 30_000,
          env: {
            PATH: process.env.PATH ?? '',
            NODE_ENV: 'test',
            NODE_USE_ENV_PROXY: '1',
            HTTPS_PROXY: url,
            https_proxy: url,
            HTTP_PROXY: url,
            http_proxy: url,
            ALL_PROXY: url,
            all_proxy: url,
            NO_PROXY: '',
            no_proxy: '',
          },
        },
      )
      const result = JSON.parse(stdout.trim().split('\n').at(-1))

      // The control went through the proxy, so the environment was in force.
      expect(seen).toContain('CONNECT control.invalid:443 HTTP/1.1')
      // The fetcher did not: no tunnel to the picture host, one direct socket.
      expect(seen.filter((line) => /sulekha/iu.test(line))).toEqual([])
      expect(seen).toHaveLength(1)
      expect(result.direct).toBe(1)
      expect(result.fetched).not.toBe('OK')
    } finally {
      await new Promise((resolve) => proxy.close(resolve))
    }
  })

  it('refuses a picture whose host resolves to a private address before any connection, through the import route', async () => {
    const world = await makeWorld()
    const imported = platformHeldImportFixture(world.ids)
    // One address from the ranges most worth reaching, and their IPv4-mapped
    // and NAT64 forms; the full list is pinned in import-images.test.js.
    const PRIVATE = [
      '127.0.0.1',
      '10.0.0.7',
      '100.64.0.1',
      '169.254.169.254',
      '172.16.0.1',
      '192.168.1.1',
      '0.0.0.0',
      '::1',
      'fd00::1',
      'fe80::1',
      '::ffff:127.0.0.1',
      '64:ff9b::a9fe:a9fe',
    ]
    /** @type {Map<string, Array<{address: string, family: number}>>} */
    const answers = new Map([[imported.image.url, [{ address: '192.168.0.10', family: 4 }]]])
    const extra = PRIVATE.map((address, index) => {
      const url = `https://usimg.sulekha.io/cdn/events/images/private-${index}.png`

      answers.set(url, [{ address, family: isIP(address) }])

      return { ...imported.image, id: cuid(), url, role: 'GALLERY', position: index + 1 }
    })
    // A public answer beside a private one is refused too.
    const mixed = 'https://usimg.sulekha.io/cdn/events/images/mixed.png'

    answers.set(mixed, [
      { address: '93.184.216.34', family: 4 },
      { address: '10.1.2.3', family: 4 },
    ])
    extra.push({ ...imported.image, id: cuid(), url: mixed, role: 'GALLERY', position: 99 })

    // The run page answers with the plan the administrator read: a whole row.
    imported.run.plan = [
      {
        sourceId: imported.item.sourceId,
        title: imported.event.title,
        startsAt: imported.event.startsAt.toISOString(),
        city: imported.venue.city,
        action: 'CREATE',
        eventId: imported.event.id,
        eventStatus: null,
        resubmit: false,
        updatable: false,
        contentDigest: 'c'.repeat(64),
        problem: null,
        importNotes: [],
        imageCount: extra.length + 1,
        priceCount: imported.item.prices.length,
        endTimeListed: false,
      },
    ]

    addRows(world.seed, imported.rows)
    addRows(world.seed, { eventImportImage: extra })

    const connections = []
    const { app, prisma } = await createTestApp({
      seed: world.seed,
      ids: world.ids,
      // The real fetcher, with the name answered here and no socket anywhere.
      fetchImportImage: (url, options) =>
        fetchImportImage(url, {
          ...options,
          source: 'network',
          resolve: (_host, _options, callback) => callback(null, answers.get(url)),
          request: (requestOptions) => {
            connections.push(requestOptions.hostname)
            throw new Error('No connection may be opened.')
          },
        }),
    })
    const headers = bearer(await signIn(app, 'anil@desi-event.example'))

    await stepUp(app, 'anil@desi-event.example', headers)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/platform/imports/${imported.run.id}/images/retry`,
      headers,
      payload: {},
    })

    expect(response.statusCode, response.body).toBe(200)

    const images = prisma._store.eventImportImage.filter((row) => row.itemId === imported.item.id)

    expect(images).toHaveLength(PRIVATE.length + 2)

    for (const image of images) {
      expect([image.url, image.status, image.failureCode]).toEqual([
        image.url,
        'FAILED',
        'ADDRESS_NOT_PUBLIC',
      ])
    }

    expect(connections).toEqual([])
    expect(prisma._store.mediaAsset.filter((row) => row.eventId === imported.event.id)).toEqual([])

    await app.close()
  })
})

describe('what a person types is matched as typed (LIKE wildcards)', () => {
  /**
   * Every pattern filter (`contains`, `startsWith`, `endsWith`, an insensitive
   * `equals`) whose value is not `likeLiteral(…)` where it is written, each
   * read and pinned with why it cannot match more than it says. A new one fails
   * here until somebody has escaped it or read it and added it.
   */
  const UNESCAPED = {
    'apps/api/src/lib/delivery.js': {
      values: ['email'],
      why: '`addressCandidates` only narrows; `isSameAddress` decides, exactly',
      reads: /export function addressCandidates\(email\)/u,
    },
    'apps/api/src/lib/event-deletion.js': {
      values: ['base'],
      why: 'an idempotency-key prefix built from the server’s own ids',
      reads: /const base = `\$\{eventRefundPrefix\(event\.id\)\}\$\{order\.id\}`/u,
    },
    'apps/api/src/lib/event-import.js': {
      values: ['term', 'term'],
      why: 'the organisation search, escaped where `term` is made',
      reads: /const term = q \? likeLiteral\(q\) : null/u,
    },
    'apps/api/src/lib/event-refunds.js': {
      values: ['prefix'],
      why: 'the event’s and nights’ refund-key prefixes, built from ids',
      reads: /return `event-cancelled:\$\{eventId\}:`/u,
    },
    'apps/api/src/lib/notification-operations.js': {
      values: ['`@${REDACTED_EMAIL_DOMAIN}`'],
      why: 'a constant domain with no wildcard in it',
      reads: /import \{ REDACTED_EMAIL_DOMAIN \} from '\.\/privacy-placeholders\.js'/u,
    },
    'apps/api/src/lib/refunds.js': {
      values: ['prefix'],
      why: 'the withdrawn-ticket reason prefixes, constants',
      reads:
        /const WITHDRAWN_REASON_PREFIXES = Object\.freeze\(\['event-deleted:', 'session-cancelled:'\]\)/u,
    },
    'apps/api/src/lib/website-redirect.js': {
      values: ['literal', 'literal.toLowerCase()'],
      why: 'the administrators’ link search, escaped where `literal` is made',
      reads: /const literal = likeLiteral\(q\)/u,
    },
  }

  it('escapes every search a person types, and pins each value that is not escaped where it is used', () => {
    /** @type {Record<string, string[]>} */
    const unescaped = {}
    let escaped = 0

    for (const file of sourceFiles().filter(
      (path) => path.startsWith('apps/api/') || path.startsWith('apps/worker/'),
    )) {
      for (const filter of patternFilters(readCode(file))) {
        if (/^likeLiteral\(/u.test(filter.value)) {
          escaped += 1
          continue
        }

        unescaped[file] = [...(unescaped[file] ?? []), filter.value]
      }
    }

    expect(unescaped).toEqual(
      Object.fromEntries(Object.entries(UNESCAPED).map(([file, entry]) => [file, entry.values])),
    )
    // The scan reads the searches it is about (events, venues, the door, the
    // platform's people and organisations, invitations, the traffic report).
    expect(escaped).toBeGreaterThanOrEqual(12)

    for (const [file, entry] of Object.entries(UNESCAPED)) {
      expect(readCode(file), `${file}: ${entry.why}`).toMatch(entry.reads)
    }
  })
})

describe('booking fees, referral codes and paying at the venue (SPEC3 §13, SPEC3-XI §13)', () => {
  /**
   * Every route SPEC3 §11.1 (thirteen) and SPEC3-XI §11.1 (two) add, as their
   * tables declare them: method, path, tag, the capability the contract
   * asserts (null where the handler decides who may, per event) and the
   * step-up.
   */
  const ROUTES = {
    'paymentTerms.get': [
      'GET',
      '/v1/platform/events/:id/payment-terms',
      'events',
      'payment_terms:manage',
      null,
    ],
    'paymentTerms.setFee': [
      'POST',
      '/v1/platform/events/:id/platform-fee',
      'events',
      'payment_terms:manage',
      'PAYMENT_TERMS',
    ],
    'paymentTerms.setVenuePayment': [
      'POST',
      '/v1/platform/events/:id/venue-payment',
      'events',
      'payment_terms:manage',
      'PAYMENT_TERMS',
    ],
    'referralCodes.list': [
      'GET',
      '/v1/platform/referral-codes',
      'referral-codes',
      'referral_code:manage',
      null,
    ],
    'referralCodes.byAdministrator': [
      'GET',
      '/v1/platform/referral-codes/by-administrator',
      'referral-codes',
      'referral_code:manage',
      null,
    ],
    'referralCodes.create': [
      'POST',
      '/v1/platform/referral-codes',
      'referral-codes',
      'referral_code:manage',
      'PAYMENT_TERMS',
    ],
    'referralCodes.get': [
      'GET',
      '/v1/platform/referral-codes/:id',
      'referral-codes',
      'referral_code:manage',
      null,
    ],
    'referralCodes.update': [
      'PATCH',
      '/v1/platform/referral-codes/:id',
      'referral-codes',
      'referral_code:manage',
      'PAYMENT_TERMS',
    ],
    'referralCodes.switchOff': [
      'POST',
      '/v1/platform/referral-codes/:id/switch-off',
      'referral-codes',
      'referral_code:manage',
      null,
    ],
    'referralCodes.switchOn': [
      'POST',
      '/v1/platform/referral-codes/:id/switch-on',
      'referral-codes',
      'referral_code:manage',
      'PAYMENT_TERMS',
    ],
    'platformFees.preview': [
      'GET',
      '/v1/platform/orders/:reference/fee',
      'orders',
      'platform_fee:refund',
      null,
    ],
    'platformFees.refund': [
      'POST',
      '/v1/platform/orders/:reference/fee-refund',
      'orders',
      'platform_fee:refund',
      'FINANCE_ACTION',
    ],
    'venuePayments.report': [
      'GET',
      '/v1/events/:id/venue-payments',
      'events',
      null,
      'FINANCE_VIEW',
    ],
    'venueBookings.unpaid': [
      'GET',
      '/v1/events/:id/venue-bookings',
      'events',
      null,
      'FINANCE_VIEW',
    ],
    'venueBookings.cancel': [
      'POST',
      '/v1/orders/:reference/venue-cancellations',
      'orders',
      null,
      'FINANCE_ACTION',
    ],
  }

  /** The capabilities SPEC3 §4.1 and SPEC3-XI §4.1 add, every one platform-only. */
  const NEW_CAPABILITIES = [
    'payment_terms:manage',
    'referral_code:manage',
    'platform_fee:refund',
    'venue_booking:cancel',
  ]

  /** The five modules that register those routes. */
  const ROUTE_MODULES = [
    'apps/api/src/routes/payment-terms.js',
    'apps/api/src/routes/platform-fees.js',
    'apps/api/src/routes/referral-codes.js',
    'apps/api/src/routes/venue-bookings.js',
    'apps/api/src/routes/venue-payments.js',
  ]

  /** How a handler registered before it was built answered (SPEC3 §0.7), in any spelling. */
  const NOT_IMPLEMENTED =
    /\b(?:exposedServerError|httpError|createError|serverError)\s*\(\s*501\b|\.\s*(?:code|status)\s*\(\s*501\s*\)|\bstatusCode\s*[:=]\s*501\b|\bnotBuilt\b/u

  const PAYMENT_TERMS = 'apps/api/src/lib/payment-terms.js'
  const REFERRAL_CODES = 'apps/api/src/lib/referral-codes.js'
  const REFERRAL_USES = 'apps/api/src/lib/referral-uses.js'
  const VENUE_PAYMENTS = 'apps/api/src/lib/venue-payments.js'
  const VENUE_BOOKINGS = 'apps/api/src/lib/venue-bookings.js'
  const ORDERS_ROUTE = 'apps/api/src/routes/orders.js'
  const CHECKOUT = 'apps/api/src/lib/checkout.js'
  const TICKETS = 'apps/api/src/lib/tickets.js'
  const ISSUE_TICKETS = 'apps/worker/src/processors/issue-tickets.js'

  /**
   * Every write to one model's rows, as {@link modelWrites} reads them, and
   * its deletes as well: a delegate's `delete` or `deleteMany`, and a raw
   * `DELETE FROM`.
   *
   * @param {string} model The model (`ReferralCodeEvent`).
   * @returns {Array<object>} The writes, each with its file.
   */
  function everyWrite(model) {
    const delegate = `${model[0].toLowerCase()}${model.slice(1)}`

    return [
      ...modelWrites(model),
      ...sourceFiles().flatMap((file) => {
        const code = readCode(file)

        return [
          ...delegateCalls(code, delegate, ['delete', 'deleteMany']).map((call) => ({
            ...call,
            file,
            raw: false,
            fields: new Set(),
            opaque: false,
          })),
          ...rawWrites(code)
            .filter((write) => write.table === model && write.verb === 'DELETE FROM')
            .map((write) => ({ ...write, file, raw: true, fields: new Set(), opaque: false })),
        ]
      }),
    ]
  }

  /**
   * The files that write any of these columns of a model, raw statements
   * included.
   *
   * @param {string} model The model.
   * @param {string[]} columns The columns (and relation fields).
   * @returns {string[]} The files.
   */
  function writersOf(model, columns) {
    return filesOf(
      modelWrites(model).filter((write) => columns.some((column) => writesColumn(write, column))),
    )
  }

  /**
   * Every key a request can carry, at any depth, on any route.
   *
   * @returns {Map<string, string[]>} Route id to keys.
   */
  function requestKeys() {
    return new Map(
      apiRoutes.map((route) => [
        route.id,
        [route.body, route.query, route.params].flatMap((schema) => [...schemaKeys(schema)]),
      ]),
    )
  }

  it('declares each of the fifteen routes exactly as SPEC3 §11.1 and SPEC3-XI §11.1 do', () => {
    const manifest = new Set(apiRouteManifest.map((route) => route.id))

    for (const [id, [method, path, tag, capability, stepUp]] of Object.entries(ROUTES)) {
      const route = routeById(id)

      expect([route.method, route.path], id).toEqual([method, path])
      expect(route.tags, id).toContain(tag)
      // The platform tag is the SECURITY_ROLE surface; these are money and terms.
      expect(route.tags, id).not.toContain('platform')
      expect(route.auth, id).toBe('session')
      expect(route.capability ?? null, id).toBe(capability)
      // Platform capabilities, never scoped to an organisation.
      expect(route.capabilityScope ?? null, id).toBeNull()
      expect(route.stepUp ?? null, id).toBe(stepUp)
      expect(route.mfaExempt ?? false, `${id} is MFA-exempt`).toBe(false)
      expect(manifest.has(id), `${id} is not in the manifest`).toBe(true)

      if (stepUp) expect(Object.keys(STEP_UP_POLICIES), id).toContain(stepUp)
    }

    for (const capability of NEW_CAPABILITIES) {
      expect(PLATFORM_ONLY_CAPABILITIES, capability).toContain(capability)
    }

    // No other route asserts one of them: each guards exactly these routes, and
    // `venue_booking:cancel` is decided per event, in the handler (XU2).
    expect(
      apiRoutes
        .filter((route) => NEW_CAPABILITIES.includes(route.capability))
        .map((route) => route.id)
        .sort(),
    ).toEqual(
      Object.entries(ROUTES)
        .filter(([, declared]) => declared[3])
        .map(([id]) => id)
        .sort(),
    )
  })

  it('registers them in their five modules, each with a handler of its own, and leaves no stub under apps/api/src', () => {
    const registered = ROUTE_MODULES.flatMap((file) =>
      routeRegistrations(readCode(file)).map((route) => ({ ...route, file })),
    )

    expect(registered.map((route) => route.id).sort()).toEqual(Object.keys(ROUTES).sort())

    for (const route of registered) {
      expect(route.body, `${route.file}: ${route.id}`).toMatch(/\bhandler\s*:\s*async\s*\(/u)
    }

    // SPEC3 §0.7: Stage A's stubs answered 501 NOT_BUILT; Stage B replaced
    // every one. The literal is refused even in a comment, and a 501 in any
    // spelling the API has used is refused in code.
    const stubs = []

    for (const file of sourceFiles().filter((path) => path.startsWith('apps/api/src/'))) {
      if (readFileSync(`${REPO_ROOT}${file}`, 'utf8').includes('NOT_BUILT')) {
        stubs.push(`${file}: NOT_BUILT`)
      }

      if (NOT_IMPLEMENTED.test(readCode(file))) stubs.push(`${file}: 501`)
    }

    expect(stubs).toEqual([])

    // The scan sees the stub it was written for.
    expect(
      NOT_IMPLEMENTED.test(
        "throw exposedServerError(501, NOT_BUILT, 'This route has no handler in this build.')",
      ),
    ).toBe(true)
    expect(NOT_IMPLEMENTED.test('reply.code(501).send()')).toBe(true)
    expect(NOT_IMPLEMENTED.test('reply.code(503).send()')).toBe(false)
  })

  it('answers every one of them no-store once past its guards, and none with 501', async () => {
    const reason = 'Checked by the security regression suite.'
    const bodies = {
      'paymentTerms.setFee': { source: 'SITE_DEFAULT', reason, expectedSequence: 0 },
      'paymentTerms.setVenuePayment': {
        enabled: false,
        seen: { enabled: false, limit: null },
        reason,
      },
      'referralCodes.create': { generate: true, scope: 'ALL_EVENTS' },
      'referralCodes.update': { label: null, expectedUpdatedAt: '2026-10-09T10:00:00.000Z' },
      'referralCodes.switchOff': {},
      'platformFees.refund': { reason, expectedRefundableCents: 0 },
      'venueBookings.cancel': { ticketIds: [cuid()], reason },
    }
    const { app } = await createTestApp()
    const administrator = 'anil@desi-event.example'
    const headers = bearer(await signIn(app, administrator))

    await stepUp(app, administrator, headers)

    for (const id of Object.keys(ROUTES)) {
      const route = routeById(id)
      const url = route.path
        .replace(':reference', 'DE-ABCDEF')
        .replace(/:[A-Za-z]+/gu, () => cuid())
      const response = await app.inject({
        method: route.method,
        url,
        headers,
        ...(bodies[id] ? { payload: bodies[id] } : {}),
      })

      // Past the session, the capability and the step-up, whatever it then
      // answers about an id nobody knows: never a stub's 501, never a fault.
      expect([401, 403, 501], `${id} answered ${response.statusCode}`).not.toContain(
        response.statusCode,
      )
      expect(response.statusCode, `${id}: ${response.body}`).toBeLessThan(500)
      expect(response.headers['cache-control'], id).toMatch(/\bno-store\b/u)
    }

    await app.close()
  })

  it('writes an event’s booking fee and its pay-at-the-venue switch in lib/payment-terms.js alone', () => {
    const COLUMNS = [
      'feeSource',
      'feePercentageBps',
      'feeFlatCentsPerTicket',
      'feeCurrency',
      'feeSettingId',
      'feeSetting',
      'venuePaymentEnabled',
      'venuePaymentLimit',
      'venuePaymentChangedAt',
      'venuePaymentChangedById',
      'venuePaymentChangedBy',
      'venuePaymentReason',
    ]
    const writes = modelWrites('Event').filter(
      (write) =>
        COLUMNS.some((column) => writesColumn(write, column)) ||
        [...write.fields].some((field) => /^(?:fee|venuePayment)[A-Z]/u.test(field)),
    )

    expect(filesOf(writes)).toEqual([PAYMENT_TERMS])
    // One write for the fee and one for the switch, each naming its whole set.
    expect(
      writes.map((write) => [...write.fields].filter((field) => COLUMNS.includes(field)).sort()),
    ).toEqual([
      ['feeCurrency', 'feeFlatCentsPerTicket', 'feePercentageBps', 'feeSettingId', 'feeSource'],
      [
        'venuePaymentChangedAt',
        'venuePaymentChangedById',
        'venuePaymentEnabled',
        'venuePaymentLimit',
        'venuePaymentReason',
      ],
    ])

    // Every event row built away from its write has been read and pinned
    // (OPAQUE_EVENT_WRITES), and none of what those rows are built from can
    // name these: the lifecycle's stamps, the website columns, the erasure,
    // and the parsed request bodies the two event routes spread.
    expect(
      eventWrites()
        .filter((write) => write.opaque)
        .map((write) => write.label)
        .sort(),
    ).toEqual(Object.keys(OPAQUE_EVENT_WRITES).sort())

    const lifecycle = readCode('apps/api/src/lib/event-lifecycle.js')
    const stamps = functionRange(lifecycle, 'stampsFor')
    const website = readCode('apps/api/src/lib/website-redirect.js')
    const columnsFor = functionRange(website, 'websiteColumnsFor')
    const redaction = readCode('apps/api/src/lib/privacy-redaction.js')

    expect(lifecycle).toMatch(
      /export function lifecycleStamps\(options\) \{\s*return stampsFor\(options\)\s*\}/u,
    )

    for (const column of COLUMNS) {
      expect(namesColumn(lifecycle.slice(stamps.start, stamps.end), column), column).toBe(false)
      expect(namesColumn(website.slice(columnsFor.start, columnsFor.end), column), column).toBe(
        false,
      )
      expect(namesColumn(redaction, column), column).toBe(false)
    }

    for (const [id, keys] of requestKeys()) {
      for (const column of COLUMNS) expect(keys, `${id} accepts ${column}`).not.toContain(column)
    }
  })

  it('records the fee’s and the switch’s history in lib/payment-terms.js alone, one row at a time', () => {
    for (const model of ['EventFeeSetting', 'EventVenuePaymentChange']) {
      const writes = everyWrite(model)

      expect(filesOf(writes), model).toEqual([PAYMENT_TERMS])
      expect(
        writes.filter((write) => write.opaque || write.raw),
        model,
      ).toEqual([])
      // History is appended, never rewritten or removed.
      expect(
        writes.map((write) => write.operation),
        model,
      ).toEqual(['create'])
    }
  })

  it('writes referral codes and their scopes in lib/referral-codes.js alone, and a code’s use count only in lib/referral-uses.js', () => {
    const codes = everyWrite('ReferralCode')

    expect(filesOf(codes)).toEqual([REFERRAL_CODES, REFERRAL_USES])

    // The use count: two raw statements, so a use never moves `updatedAt`, the
    // administrators' compare-and-set on an edit; and nothing else.
    const counted = codes.filter((write) => write.file === REFERRAL_USES)

    expect(counted.map((write) => [write.raw, write.verb])).toEqual([
      [true, 'UPDATE'],
      [true, 'UPDATE'],
    ])

    for (const write of counted) {
      expect(write.text).toMatch(
        /^UPDATE "ReferralCode" SET "useCount" = "useCount" (?:\+ 1|- \$\{lowered\}) WHERE "id" = \$\{\w+\}`$/u,
      )
    }

    // The administrators' writes never touch it.
    for (const write of codes.filter((candidate) => candidate.file === REFERRAL_CODES)) {
      expect(write.raw, `${write.file}:${write.line}`).toBe(false)
      expect(writesColumn(write, 'useCount'), `${write.file}:${write.line}`).toBe(false)
    }

    // The one code row built away from its call is the edit's, whose `data`
    // is assigned the four columns an edit changes and nothing else.
    const opaque = codes.filter((write) => write.opaque)

    expect(opaque.map((write) => `${write.file} ${write.operation}`)).toEqual([
      `${REFERRAL_CODES} update`,
    ])
    expect(opaque[0].args).toMatch(
      /^\s*\{\s*where:\s*\{\s*id:\s*row\.id\s*\},\s*data:\s*\{\s*\.\.\.data,\s*updatedById:\s*actor\.id\s*\},?\s*\}\s*$/u,
    )

    const code = readCode(REFERRAL_CODES)
    const edit = functionRange(code, 'updateReferralCode')

    expect(assignedKeys(code.slice(edit.start, edit.end))).toEqual([
      'expiresAt',
      'label',
      'maxUses',
      'scope',
    ])

    // Nobody else's write, of any model, names a use count.
    const counters = []

    for (const file of sourceFiles({ packages: true })) {
      const text = readCode(file)

      for (const call of delegateCalls(text, '[a-z][A-Za-z]*', WRITE_OPERATIONS)) {
        if (writtenFields(call.args).fields.has('useCount')) counters.push(file)
      }

      for (const write of rawWrites(text)) {
        if (namesColumn(write.text, 'useCount')) counters.push(`${file} raw`)
      }
    }

    expect([...new Set(counters)]).toEqual([`${REFERRAL_USES} raw`])

    for (const [id, keys] of requestKeys()) {
      expect(keys, `${id} accepts useCount`).not.toContain('useCount')
    }

    // The scope rows: added and removed by the administrators' writes only.
    const scopes = everyWrite('ReferralCodeEvent')

    expect(filesOf(scopes)).toEqual([REFERRAL_CODES])
    expect(scopes.filter((write) => write.opaque || write.raw)).toEqual([])
    expect(scopes.map((write) => write.operation).sort()).toEqual([
      'create',
      'create',
      'deleteMany',
    ])
  })

  it('sets an order’s referral return marker in lib/referral-uses.js alone, once, and names its code only when the order is written', () => {
    const marked = modelWrites('Order').filter(
      (write) =>
        writesColumn(write, 'referralUseReturnedAt') ||
        writesColumn(write, 'referralUseReturnCause'),
    )

    expect(
      marked.map((write) => `${write.file} ${write.raw ? write.verb : write.operation}`),
    ).toEqual([`${REFERRAL_USES} UPDATE`])
    // Conditional on the marker being unset: the exactly-once decision (XR3).
    expect(marked[0].text).toMatch(/"referralUseReturnedAt" IS NULL/u)
    expect(marked[0].text).toMatch(/"referralCodeId" IS NOT NULL/u)

    // The code an order used is written with the order, by the order route.
    expect(
      filesOf(
        modelWrites('Order').filter(
          (write) =>
            !write.raw && (write.fields.has('referralCodeId') || write.fields.has('referralCode')),
        ),
      ),
    ).toEqual([ORDERS_ROUTE])
    // The marker's statement reads the code; it never sets it.
    expect(marked[0].text).not.toMatch(/SET[\s\S]*"referralCodeId"\s*=/u)

    for (const [id, keys] of requestKeys()) {
      for (const column of ['referralCodeId', 'referralUseReturnedAt', 'referralUseReturnCause']) {
        expect(keys, `${id} accepts ${column}`).not.toContain(column)
      }
    }
  })

  it('lets product code take only settleReferralUsesIfEnded and consumeReferralUse from lib/referral-uses.js, and no per-order return exists', () => {
    /** @type {Record<string, string[]>} */
    const importers = {}

    for (const file of sourceFiles({ packages: true })) {
      if (file === REFERRAL_USES) continue

      for (const load of moduleLoads(readCode(file))) {
        if (!/(?:^|\/)referral-uses\.js$/u.test(load.specifier)) continue

        expect(load.names, `${file} takes referral-uses.js whole`).not.toBeNull()
        importers[file] = [...(importers[file] ?? []), ...load.names].sort()
      }
    }

    const settle = ['settleReferralUsesIfEnded']

    expect(importers).toEqual({
      [CHECKOUT]: settle,
      'apps/api/src/lib/event-cancellation.js': settle,
      'apps/api/src/lib/event-deletion.js': settle,
      'apps/api/src/lib/refunds.js': settle,
      'apps/api/src/lib/session-cancellation.js': settle,
      [VENUE_BOOKINGS]: settle,
      [ORDERS_ROUTE]: ['consumeReferralUse'],
      'apps/api/src/routes/tickets.js': settle,
    })

    // Its two building blocks are exported for tests; product code never calls them.
    for (const file of sourceFiles({ packages: true })) {
      if (file === REFERRAL_USES) continue

      expect(readCode(file), file).not.toMatch(
        /\b(?:returnReferralUseOnce|orderEndedWithoutUse)\s*\(/u,
      )
    }

    // SPEC3's single-order return is gone everywhere, tests included: a use
    // goes back only through the batch (SPEC3-XI XR3, XR6).
    const perOrder = new RegExp(`\\b${['return', 'ReferralUse'].join('')}\\s*\\(`, 'u')
    const testFiles = readdirSync(`${REPO_ROOT}apps/api/tests`, { recursive: true })
      .map(String)
      .filter((name) => /\.(?:c|m)?js$/u.test(name))
      .map((name) => `apps/api/tests/${name}`)

    expect(
      [...sourceFiles({ packages: true }), ...testFiles].filter((file) =>
        perOrder.test(readCode(file)),
      ),
    ).toEqual([])
  })

  it('keeps cancelUnpaidOrders out of the referral uses, and settles a checkout under its tiers first', () => {
    const deletion = readCode('apps/api/src/lib/event-deletion.js')
    const cancel = functionRange(deletion, 'cancelUnpaidOrders')

    expect(cancel).not.toBeNull()

    const cancelling = deletion.slice(cancel.start, cancel.end)

    // It hands the ids it cancelled to its caller's one batch (XR4) instead.
    expect(cancelling).not.toMatch(
      /\b(?:settleReferralUsesIfEnded|consumeReferralUse|returnReferralUseOnce|orderEndedWithoutUse)\s*\(/u,
    )
    expect(cancelling).toMatch(/\borderIds\b/u)

    // SPEC3-XI §2.3.3: the tiers, sorted, before the order's compare-and-set.
    const checkout = readCode(CHECKOUT)
    const settle = functionRange(checkout, 'settleCheckout')
    const body = checkout.slice(settle.start, settle.end)
    const tiers = body.search(/\blockTicketTypes\s*\(/u)
    const order = body.search(/\.\s*order\s*\.\s*updateMany\s*\(/u)

    expect(tiers).toBeGreaterThan(-1)
    expect(order).toBeGreaterThan(tiers)
    // Nothing touches an order row before the tiers are held.
    expect(body.slice(0, tiers)).not.toMatch(
      /FROM\s+"Order"|\.\s*order\s*\.\s*(?:update|updateMany|upsert|findUnique)\s*\(/u,
    )
  })

  it('writes what is due at the door with the order and its lines, and on a ticket only at settlement and as its predecessor’s copy', () => {
    expect(writersOf('Order', ['venueDueCents'])).toEqual([ORDERS_ROUTE])
    expect(writersOf('OrderItem', ['venueDueCents'])).toEqual([ORDERS_ROUTE])

    const tickets = modelWrites('Ticket').filter((write) => writesColumn(write, 'venueDueCents'))

    expect(filesOf(tickets)).toEqual([CHECKOUT, TICKETS])

    // The successor copy, by name only (SPEC3-XI XT2): what its predecessor owed.
    for (const write of tickets.filter((candidate) => candidate.file === TICKETS)) {
      expect(write.args).toMatch(/\bvenueDueCents:\s*ticket\.venueDueCents\s*,/u)
      expect([...write.args.matchAll(/\bvenueDueCents\b/gu)]).toHaveLength(2)
    }

    // Every ticket row built away from its write, read and pinned: the
    // lifecycle's compare-and-set, and the worker's batch.
    const OPAQUE_TICKET_WRITES = {
      [`${TICKETS} updateMany`]:
        /^\s*\{\s*where:\s*\{\s*id:\s*ticket\.id,\s*status:\s*ticket\.status\s*\},\s*data:\s*\{\s*status:\s*to,\s*\.\.\.data\s*\},?\s*\}\s*$/u,
      [`${ISSUE_TICKETS} createMany`]: /^\s*\{\s*data:\s*rows\s*\}\s*$/u,
    }
    const opaque = modelWrites('Ticket').filter((write) => write.opaque)

    expect(opaque.map((write) => `${write.file} ${write.operation}`).sort()).toEqual(
      Object.keys(OPAQUE_TICKET_WRITES).sort(),
    )

    for (const write of opaque) {
      expect(write.args, `${write.file}:${write.line}`).toMatch(
        OPAQUE_TICKET_WRITES[`${write.file} ${write.operation}`],
      )
    }

    // What `transition` spreads comes from its callers, and none names a door column.
    const DOOR_COLUMNS = [
      'venueDueCents',
      'venuePaymentId',
      'venuePayment',
      'venueCancellationId',
      'venueCancellation',
    ]
    let transitions = 0

    for (const file of sourceFiles().filter((path) => path.startsWith('apps/api/src/'))) {
      const code = readCode(file)

      for (const match of code.matchAll(/(?<!function\s+)\btransition\(\s*tx\s*,/gu)) {
        const open = match.index + 'transition'.length
        const args = code.slice(open + 1, balancedEnd(code, open))

        transitions += 1

        for (const column of DOOR_COLUMNS) {
          expect(namesColumn(args, column), `${file}:${lineOf(code, match.index)} ${column}`).toBe(
            false,
          )
        }
      }
    }

    expect(transitions).toBeGreaterThan(4)

    // And the worker's rows are four columns, none of them a door column.
    const worker = readCode(ISSUE_TICKETS)
    const pushes = [...worker.matchAll(/\brows\.push\(\s*\{/gu)]

    expect(pushes).toHaveLength(1)
    expect(
      objectEntries(worker, pushes[0].index + pushes[0][0].length - 1).map((entry) => entry.key),
    ).toEqual(['orderItemId', 'code', 'status', 'attendeeName'])

    for (const [id, keys] of requestKeys()) {
      for (const column of DOOR_COLUMNS) {
        expect(keys, `${id} accepts ${column}`).not.toContain(column)
      }
    }
  })

  it('records a payment taken at the door in lib/venue-payments.js alone, and a cancellation of unpaid tickets in lib/venue-bookings.js alone', () => {
    expect(filesOf(everyWrite('VenuePayment'))).toEqual([VENUE_PAYMENTS])
    expect(writersOf('Ticket', ['venuePaymentId', 'venuePayment'])).toEqual([VENUE_PAYMENTS])

    // SPEC3-XI §13: the cancellation, the ticket's mark, the line's count and
    // the booking's basis and kept share, one writer for all.
    expect(filesOf(everyWrite('VenueBookingCancellation'))).toEqual([VENUE_BOOKINGS])
    expect(writersOf('Ticket', ['venueCancellationId', 'venueCancellation'])).toEqual([
      VENUE_BOOKINGS,
    ])
    expect(writersOf('OrderItem', ['venueCancelledQuantity'])).toEqual([VENUE_BOOKINGS])
    expect(writersOf('Order', ['venueCancelledBasisCents', 'venueFeeKeptCents'])).toEqual([
      VENUE_BOOKINGS,
    ])

    for (const [id, keys] of requestKeys()) {
      for (const column of [
        'venueCancelledQuantity',
        'venueCancelledBasisCents',
        'venueFeeKeptCents',
      ]) {
        expect(keys, `${id} accepts ${column}`).not.toContain(column)
      }
    }

    // Nothing but the booking fee is ever kept (XU6): no source, schema or
    // migration names a kept tax.
    const keptTax = /tax\s*kept\s*cents/iu
    const migrations = readdirSync(`${REPO_ROOT}packages/db/prisma/migrations`, {
      recursive: true,
    })
      .map(String)
      .filter((name) => name.endsWith('.sql'))
      .map((name) => `packages/db/prisma/migrations/${name}`)

    expect(
      [
        ...sourceFiles({ packages: true }),
        'packages/db/prisma/schema.prisma',
        ...migrations,
      ].filter((file) => keptTax.test(readFileSync(`${REPO_ROOT}${file}`, 'utf8'))),
    ).toEqual([])
  })

  it('takes a place back from sale only where unpaid tickets are cancelled, and sells one only at checkout', () => {
    const moves = []

    for (const write of modelWrites('TicketType')) {
      if (!writesColumn(write, 'quantitySold')) continue

      if (write.raw) {
        const kind = /"?quantitySold"?\s*=\s*"?quantitySold"?\s*-/iu.test(write.text)
          ? 'decrement'
          : /"?quantitySold"?\s*=\s*"?quantitySold"?\s*\+/iu.test(write.text)
            ? 'increment'
            : 'set'

        moves.push(`${write.file} raw ${kind}`)
        continue
      }

      const value = /\bquantitySold\s*:\s*(\{[^}]*\}|[^,}\n]+)/u.exec(write.args)?.[1] ?? ''
      const kind = /^\{\s*increment\s*:/u.test(value)
        ? 'increment'
        : /^\{\s*decrement\s*:/u.test(value)
          ? 'decrement'
          : 'set'

      moves.push(`${write.file} ${kind}`)
    }

    expect(moves.sort()).toEqual([`${CHECKOUT} increment`, `${VENUE_BOOKINGS} decrement`])

    // Every tier row built away from its write, read and pinned: none of them
    // is built from anything that names the count.
    const OPAQUE_TIER_WRITES = {
      'apps/api/src/routes/event-authoring.js update': {
        args: /\bdata:\s*toTierPatch\(patch\)/u,
        builder: ['apps/api/src/routes/event-authoring.js', 'toTierPatch'],
      },
      'apps/api/src/routes/events.js update': {
        args: /\bdata:\s*move\.data\b/u,
        builder: ['apps/api/src/routes/events.js', 'tierWindowMoves'],
      },
      'apps/api/src/routes/ticket-types.js create': { args: /\.\.\.body,/u, builder: null },
    }
    const opaque = modelWrites('TicketType').filter((write) => write.opaque)

    expect(opaque.map((write) => `${write.file} ${write.operation}`).sort()).toEqual(
      Object.keys(OPAQUE_TIER_WRITES).sort(),
    )

    for (const write of opaque) {
      const pinned = OPAQUE_TIER_WRITES[`${write.file} ${write.operation}`]

      expect(write.args, `${write.file}:${write.line}`).toMatch(pinned.args)

      if (!pinned.builder) continue

      const code = readCode(pinned.builder[0])
      const range = functionRange(code, pinned.builder[1])

      expect(range, pinned.builder[1]).not.toBeNull()
      expect(
        namesColumn(code.slice(range.start, range.end), 'quantitySold'),
        pinned.builder[1],
      ).toBe(false)
    }

    // The tier create spreads its parsed body, and no request names the count.
    for (const [id, keys] of requestKeys()) {
      expect(keys, `${id} accepts quantitySold`).not.toContain('quantitySold')
    }
  })

  it('mints tickets in the worker only in processors/issue-tickets.js, which refuses a booking to pay at the venue first', () => {
    const writes = sourceFiles()
      .filter((file) => file.startsWith('apps/worker/src/'))
      .flatMap((file) => {
        const code = readCode(file)

        return [
          ...writesTo(code, 'Ticket').map((write) => ({ ...write, file })),
          ...rawWrites(code)
            .filter((write) => write.table === 'Ticket')
            .map((write) => ({ ...write, file, operation: write.verb })),
        ]
      })

    expect(writes.map((write) => `${write.file} ${write.operation}`)).toEqual([
      `${ISSUE_TICKETS} createMany`,
    ])

    // The refusal comes first: a pay-at-the-venue booking's tickets carry the
    // door price only settlement splits, so the worker never mints one.
    const code = readCode(ISSUE_TICKETS)
    const refusal = code.search(
      /if\s*\(\s*order\.paymentMethod\s*===\s*AT_VENUE\s*\)\s*\{\s*throw new PermanentJobError\(/u,
    )

    expect(code).toMatch(/const AT_VENUE = 'AT_VENUE'/u)
    expect(refusal).toBeGreaterThan(-1)
    expect(refusal).toBeLessThan(writes[0].index)

    // A unit test proves the refusal.
    const test = readFileSync(
      `${REPO_ROOT}apps/worker/src/processors/issue-tickets.test.js`,
      'utf8',
    )

    expect(test).toMatch(
      /fails permanently for a %s order paid at the venue, and writes no ticket/u,
    )
    expect(test).toMatch(/paymentMethod: 'AT_VENUE'/u)
  })

  /**
   * Every raw row lock under `apps/<app>/src` and `packages/<package>/src`,
   * file by file in source order: the table and how strongly it is held.
   * Pinned, so a new lock fails here until it has been read against the lock
   * law (SPEC3-XI §2.1) and added.
   */
  const RAW_ROW_LOCKS = {
    'apps/api/src/lib/admission.js': [
      'Membership SHARE',
      'ScannerScope SHARE',
      'EventSession KEY SHARE',
      'Order SHARE',
      'OrderItem KEY SHARE',
      'Ticket UPDATE',
    ],
    'apps/api/src/lib/checkout-pricing.js': ['PromoCode NO KEY UPDATE'],
    'apps/api/src/lib/event-authoring.js': ['EventSession UPDATE'],
    'apps/api/src/lib/event-authority.js': ['EventPlatformEdit SHARE'],
    'apps/api/src/lib/event-cancellation.js': ['Order UPDATE', 'Order UPDATE'],
    'apps/api/src/lib/event-deletion.js': ['Order UPDATE', 'Order UPDATE', 'OrderItem KEY SHARE'],
    'apps/api/src/lib/event-import.js': ['Event UPDATE', 'Event UPDATE', 'Event UPDATE'],
    'apps/api/src/lib/event-media.js': ['Event UPDATE', 'Event UPDATE'],
    'apps/api/src/lib/group-admission.js': [
      'EventSession KEY SHARE',
      'Order SHARE',
      'GroupPass SHARE',
      'OrderItem KEY SHARE',
      'Ticket UPDATE',
    ],
    'apps/api/src/lib/inventory.js': ['TicketType UPDATE', 'TicketHold UPDATE'],
    'apps/api/src/lib/memberships.js': [
      'Membership UPDATE',
      'Membership UPDATE',
      'Membership UPDATE',
    ],
    'apps/api/src/lib/payment-terms.js': ['Event NO KEY UPDATE'],
    'apps/api/src/lib/referral-codes.js': [
      'ReferralCode NO KEY UPDATE',
      'ReferralCode NO KEY UPDATE',
    ],
    'apps/api/src/lib/referral-uses.js': ['Order UPDATE', 'ReferralCode NO KEY UPDATE'],
    'apps/api/src/lib/refunds.js': [
      'Order UPDATE',
      'Order UPDATE',
      'OrderItem UPDATE',
      'EventSession KEY SHARE',
      'Refund UPDATE',
      'Order UPDATE',
      'Refund UPDATE',
      'Order UPDATE',
      'Refund UPDATE',
      'Order UPDATE',
    ],
    'apps/api/src/lib/seating.js': ['TicketType KEY SHARE', 'EventSession KEY SHARE'],
    'apps/api/src/lib/session-cancellation.js': ['Order UPDATE', 'Order UPDATE'],
    'apps/api/src/lib/session-inventory.js': ['EventSession UPDATE'],
    'apps/api/src/lib/tickets.js': ['Ticket UPDATE', 'OrderItem UPDATE'],
    'apps/api/src/lib/venue-bookings.js': [
      'EventSession KEY SHARE',
      'Order UPDATE',
      'OrderItem UPDATE',
      'Ticket UPDATE',
    ],
    'apps/api/src/lib/website-redirect.js': ['Event UPDATE'],
    'apps/api/src/routes/platform-fees.js': ['Order UPDATE'],
    'apps/api/src/routes/platform.js': ['User UPDATE'],
    'apps/api/src/routes/tickets.js': ['Order UPDATE'],
    'apps/worker/src/processors/issue-tickets.js': ['Order UPDATE'],
  }

  /** Every raw write, by file: the referral counts and marker, and the visit roll-up. */
  const RAW_WRITES = {
    'apps/api/src/lib/referral-uses.js': [
      'UPDATE ReferralCode',
      'UPDATE Order',
      'UPDATE ReferralCode',
    ],
    'packages/db/src/traffic-rollup.js': ['INSERT INTO TrafficDaily', 'DELETE FROM TrafficEvent'],
  }

  /**
   * The raw statements that neither lock a row nor write one, by file: reads
   * (the facet counts, the ended-order predicate, the venue-booking count,
   * the roll-up's days), the two advisory locks, the transaction budget's
   * settings and its question to an expired transaction, and the health
   * checks.
   */
  const RAW_OTHER = {
    'apps/api/src/lib/delivery.js': 1,
    'apps/api/src/lib/facets.js': 4,
    'apps/api/src/lib/referral-uses.js': 1,
    'apps/api/src/lib/transaction-budget.js': 2,
    'apps/api/src/lib/venue-booking-limits.js': 2,
    'apps/api/src/routes/health.js': 1,
    'packages/db/src/index.js': 1,
    'packages/db/src/traffic-rollup.js': 1,
  }

  it('binds every raw statement, and inventories every raw lock and raw write, the refund’s night lock and the door’s line lock among them', () => {
    /** @type {Record<string, string[]>} */
    const locks = {}
    /** @type {Record<string, string[]>} */
    const writes = {}
    /** @type {Record<string, number>} */
    const other = {}
    const unbound = []

    for (const file of sourceFiles({ packages: true })) {
      const code = readCode(file)

      if (/\bPrisma\s*\.\s*raw\s*\(/u.test(code)) unbound.push(`${file}: Prisma.raw`)

      for (const call of rawCalls(code)) {
        const at = `${file}:${call.line}`

        // A tagged template binds every value; the facet counts' `Prisma.sql`
        // is a tagged template too, passed in brackets. Anything else could
        // splice text into SQL.
        if (call.unsafe) unbound.push(`${at} ${call.method}Unsafe`)
        else if (!call.tagged && !/^\(\s*Prisma\.sql`/u.test(call.text)) {
          unbound.push(`${at} ${call.method}(…)`)
        }

        const lock = rowLockOf(call.text)
        const written = rawWrites(call.text)

        if (lock) {
          locks[file] = [...(locks[file] ?? []), `${lock.table} ${lock.strength}`]

          // A lock names its rows by bound values, never by text spliced in.
          if (!/\$\{/u.test(call.text)) unbound.push(`${at} locks no bound row`)
        } else if (written.length > 0) {
          writes[file] = [
            ...(writes[file] ?? []),
            ...written.map((write) => `${write.verb} ${write.table}`),
          ]
        } else {
          other[file] = (other[file] ?? 0) + 1
        }
      }
    }

    expect(unbound).toEqual([])
    expect(locks).toEqual(RAW_ROW_LOCKS)

    // A code an order names is never locked FOR UPDATE (final door review,
    // finding 1): an order written twice in one transaction holds its codes
    // FOR KEY SHARE through PostgreSQL's foreign-key re-check, so a returner's
    // FOR UPDATE on the code waited on another returner's key share while that
    // one waited on its own (40P01). NO KEY UPDATE ignores key shares.
    expect(
      Object.entries(locks).flatMap(([file, taken]) =>
        taken
          .filter((lock) => /^(?:ReferralCode|PromoCode) UPDATE$/u.test(lock))
          .map((lock) => `${file}: ${lock}`),
      ),
    ).toEqual([])
    expect(writes).toEqual(RAW_WRITES)
    expect(other).toEqual(RAW_OTHER)

    // The refund's night (b1-open-needs: the `FOR KEY SHARE` refunds.js
    // added), on a bound id, taken by settleRefund before it writes the order.
    const refunds = readCode('apps/api/src/lib/refunds.js')
    const night = functionRange(refunds, 'lockOrderNight')

    expect(refunds.slice(night.start, night.end)).toContain(
      'tx.$queryRaw`SELECT "id" FROM "EventSession" WHERE "id" = ${eventSessionId} FOR KEY SHARE`',
    )

    const settle = functionRange(refunds, 'settleRefund')
    const settling = refunds.slice(settle.start, settle.end)
    const nightFirst = settling.search(/\blockOrderNight\(\s*tx\s*,/u)
    const orderWrite = settling.search(
      /\.\s*order\s*\.\s*(?:update|updateMany)\s*\(|FROM\s+"Order"/u,
    )

    expect(nightFirst).toBeGreaterThan(-1)
    expect(orderWrite).toBeGreaterThan(nightFirst)

    // The door, one ticket and a group: the night, the order, the ticket's
    // line, then the ticket (SPEC3-XI §2.1 rows 3, 5, 6, 7), in one function each.
    for (const [file, name, expected] of [
      [
        'apps/api/src/lib/admission.js',
        'decide',
        ['EventSession KEY SHARE', 'Order SHARE', 'OrderItem KEY SHARE', 'Ticket UPDATE'],
      ],
      [
        'apps/api/src/lib/group-admission.js',
        'decideGroup',
        [
          'EventSession KEY SHARE',
          'Order SHARE',
          'GroupPass SHARE',
          'OrderItem KEY SHARE',
          'Ticket UPDATE',
        ],
      ],
    ]) {
      const code = readCode(file)
      const range = functionRange(code, name)
      const taken = rawCalls(code.slice(range.start, range.end))
        .map((call) => rowLockOf(call.text))
        .filter(Boolean)
        .map((lock) => `${lock.table} ${lock.strength}`)

      expect(taken, `${file} ${name}`).toEqual(expected)
    }

    // The helper sees what it is for.
    expect(
      rawCalls(
        withoutComments(
          'await tx.$queryRaw`SELECT 1 FROM "Order" WHERE id = ${id} FOR NO KEY UPDATE`\nawait tx.$executeRawUnsafe(\'UPDATE "Order" SET x = 1\')\nawait db.$queryRaw(Prisma.sql`SELECT 1`)',
        ),
      ).map((call) => [
        call.method,
        call.unsafe,
        call.tagged,
        rowLockOf(call.text)?.strength ?? null,
      ]),
    ).toEqual([
      ['queryRaw', false, true, 'NO KEY UPDATE'],
      ['executeRaw', true, false, null],
      ['queryRaw', false, false, null],
    ])
  })

  /** The modules that hold a referral code's row or its text. */
  const REFERRAL_MODULES = [REFERRAL_CODES, REFERRAL_USES, 'apps/api/src/routes/referral-codes.js']

  /** Keys that would carry a code's text or its label. */
  const CODE_TEXT_KEYS = new Set(['code', 'referralCode', 'label', 'text'])

  /**
   * What, in the object literals of a call's arguments, could carry a code's
   * text or its label: a key that names one, a value read from one, or a
   * spread of something that is not an object literal.
   *
   * @param {string} args The text between the call's brackets.
   * @returns {string[]} What was found.
   */
  function codeTextIn(args) {
    const found = []

    for (const open of braceStarts(args)) {
      for (const entry of objectEntries(args, open)) {
        const value = args.slice(entry.start, entry.end).trim()

        if (
          (entry.kind === 'property' || entry.kind === 'shorthand') &&
          CODE_TEXT_KEYS.has(entry.key)
        ) {
          found.push(entry.key)
        }

        if (
          entry.kind === 'property' &&
          /^[\w$?.[\]]*\.(?:code|referralCode|label)$/u.test(value)
        ) {
          found.push(`${entry.key}: ${value}`)
        }

        // `...(labelChanged ? { labelChanged: true } : {})` is read as the
        // object literals it holds; a spread of a row or a body is not.
        if (entry.kind === 'spread' && !value.includes('{')) found.push(`...${value}`)
      }
    }

    return found
  }

  it('never writes a referral code’s text or label into an audit row from the referral modules', () => {
    let audits = 0

    for (const file of REFERRAL_MODULES) {
      const code = readCode(file)

      for (const match of code.matchAll(/(?<!function\s+)\brecordAudit\s*\(/gu)) {
        const open = match.index + match[0].length - 1
        const args = code.slice(open + 1, balancedEnd(code, open))

        audits += 1
        expect(codeTextIn(args), `${file}:${lineOf(code, match.index)}`).toEqual([])
      }
    }

    // Created, updated, switched off and on, and a use given back.
    expect(audits).toBeGreaterThanOrEqual(4)

    // The metadata helper names ids, the scope, the expiry, the limit and the switch.
    const code = readCode(REFERRAL_CODES)
    const helper = functionRange(code, 'referralAuditMetadata')
    const returned = code.indexOf('{', code.indexOf('return', helper.start))

    expect(objectEntries(code, returned).map((entry) => entry.key)).toEqual([
      'referralCodeId',
      'scope',
      'expiresAt',
      'maxUses',
      'active',
    ])

    // The scan sees the leak it is for.
    expect(codeTextIn('tx, { metadata: { referralCodeId: row.id, code: row.code } }')).toEqual([
      'code',
      'code: row.code',
    ])
    expect(codeTextIn('tx, { metadata: { ...row } }')).toEqual(['...row'])
    expect(
      codeTextIn(
        'tx, { metadata: { labelSet: Boolean(row.label), ...(changed ? { labelChanged: true } : {}) } }',
      ),
    ).toEqual([])
  })

  it('never hands a log call in the referral modules a code’s row: ids only', () => {
    const LOG_CALL =
      /\b(?:log|logger)\s*(?:\?\.|\.)\s*(?:trace|debug|info|warn|error|fatal)\s*(?:\?\.)?\s*\(/gu
    /** @type {Record<string, number>} */
    const calls = {}

    for (const file of REFERRAL_MODULES) {
      const code = readCode(file)

      for (const match of code.matchAll(LOG_CALL)) {
        const open = match.index + match[0].length - 1
        const args = code.slice(open + 1, balancedEnd(code, open)).trim()
        const at = `${file}:${lineOf(code, match.index)}`

        calls[file] = (calls[file] ?? 0) + 1

        // A message alone, or an object of ids and then a message.
        if (/^['"`]/u.test(args)) continue

        expect(args.startsWith('{'), `${at} logs something other than ids`).toBe(true)

        for (const entry of objectEntries(args, 0)) {
          expect(['property', 'shorthand'], `${at}: ${entry.kind}`).toContain(entry.kind)
          expect(entry.key, at).toMatch(/Ids?$/u)

          const value =
            entry.kind === 'shorthand' ? entry.key : args.slice(entry.start, entry.end).trim()

          expect(value, at).toMatch(
            /^(?:[\w$]+(?:\.[\w$]+)*\.id|\[\s*\.\.\.[\w$]+\s*\]|[\w$]+Ids?)$/u,
          )
        }
      }
    }

    // The two there are (XR3 step 5's warning, and the route's note that a
    // code was made), so the rule is not passing on nothing.
    expect(calls).toEqual({ [REFERRAL_USES]: 1, 'apps/api/src/routes/referral-codes.js': 1 })

    // And the logger redacts the text by key, wherever a body or a payload
    // carries it (SPEC3 §13).
    expect(SENSITIVE_FIELD_KEYS).toContain('referralCode')
    expect(WILDCARD_KEYS).toContain('referralCode')
  })

  /** A log call, by whatever logger: `request.log`, `app.log`, `logger` or a `log` handed in. */
  const ANY_LOG_CALL =
    /\b(?:log|logger)\s*(?:\?\.|\.)\s*(?:trace|debug|info|warn|error|fatal)\s*(?:\?\.)?\s*\(/gu

  /**
   * The modules, outside the referral modules, where a buyer's code arrives as
   * text or is resolved to its row: the checkout route, its pricing (which
   * reads the row), its settlement, and the wrong-codes budget (which reads
   * the body). Each log call there is pinned key by key.
   */
  const CODE_ARRIVES = [
    'apps/api/src/routes/orders.js',
    'apps/api/src/lib/checkout-pricing.js',
    'apps/api/src/lib/checkout.js',
    'apps/api/src/plugins/rate-limit.js',
  ]

  /**
   * What, in a log call's arguments, could carry a referral code's text: any
   * name with `referral` in it that is not an id (a `referralCode`, a
   * resolved `referral`, its `.row`, a `referralText`), and a request body
   * handed over whole rather than one named field of it. The words of a
   * message are left out: "referral code created" names nothing.
   *
   * @param {string} args The text between the call's brackets, comments blanked.
   * @returns {string[]} What was found.
   */
  function referralTextInLog(args) {
    const code = withoutStringText(args)
    const found = []

    for (const [name] of code.matchAll(/[\w$]*referral[\w$]*/giu)) {
      if (!/Ids?$/u.test(name)) found.push(name)
    }

    for (const [expression] of code.matchAll(
      /(?:\.\.\.\s*)?(?:[\w$]+\s*(?:\?\.|\.)\s*)*\bbody\b(?!\s*(?:\?\.|\.)\s*[\w$])/gu,
    )) {
      found.push(expression)
    }

    return found
  }

  /**
   * Code with the text of its strings dropped: a quoted string becomes `''`,
   * and a template keeps only what it substitutes, so `${referral}` inside a
   * message still counts and the message's own words do not.
   *
   * @param {string} code The text, comments blanked.
   * @returns {string} The text without string contents.
   */
  function withoutStringText(code) {
    let out = ''
    let at = 0

    while (at < code.length) {
      const char = code[at]

      if (char === "'" || char === '"') {
        let end = at + 1

        while (end < code.length && code[end] !== char) end += code[end] === '\\' ? 2 : 1
        out += "''"
        at = end + 1
      } else if (char === '`') {
        let end = at + 1

        out += '`'

        while (end < code.length && code[end] !== '`') {
          if (code[end] === '\\') {
            end += 2
          } else if (code[end] === '$' && code[end + 1] === '{') {
            const close = balancedEnd(code, end + 1)

            out += ` ${withoutStringText(code.slice(end + 2, close))} `
            end = close + 1
          } else {
            end += 1
          }
        }

        out += '`'
        at = end + 1
      } else {
        out += char
        at += 1
      }
    }

    return out
  }

  it('never hands any server log call a referral code’s text, its resolved row or a whole request body, and pins every log call where a code arrives', () => {
    /** @type {Record<string, Array<string[]|string>>} */
    const arriving = Object.fromEntries(CODE_ARRIVES.map((file) => [file, []]))
    let calls = 0

    for (const file of sourceFiles({ packages: true })) {
      if (file.startsWith('apps/web/')) continue

      const code = readCode(file)

      for (const match of code.matchAll(ANY_LOG_CALL)) {
        const open = match.index + match[0].length - 1
        const args = code.slice(open + 1, balancedEnd(code, open)).trim()
        const at = `${file}:${lineOf(code, match.index)}`

        calls += 1
        expect(referralTextInLog(args), at).toEqual([])

        if (arriving[file]) {
          arriving[file].push(
            args.startsWith('{')
              ? objectEntries(args, 0).map((entry) =>
                  entry.kind === 'spread' ? `...${args.slice(entry.start, entry.end)}` : entry.key,
                )
              : 'a message alone',
          )
        }
      }
    }

    // The rule read the server's logging, not nothing.
    expect(calls).toBeGreaterThan(100)

    // Where the buyer's text arrives, every log call says which order, never
    // what was typed (review GC D1): a new call, or a new key on one, fails
    // here until it is read and added.
    expect(arriving).toEqual({
      'apps/api/src/routes/orders.js': [
        ['orderId', 'reference', 'status'],
        ['orderId', 'reference', 'reason'],
        ['orderId', 'reference', 'paymentId', 'reason'],
        ['orderId', 'reference', 'paymentId'],
        ['orderId', 'reference', 'totalCents'],
      ],
      'apps/api/src/lib/checkout-pricing.js': [],
      'apps/api/src/lib/checkout.js': [],
      'apps/api/src/plugins/rate-limit.js': [],
    })

    // The scan sees the leaks it is for, and passes what is not one.
    expect(
      referralTextInLog("{ tried: request.body.referralCode }, 'referral code not accepted'"),
    ).toEqual(['referralCode'])
    expect(referralTextInLog("{ attempt: referral.row.code }, 'refused'")).toEqual(['referral'])
    expect(referralTextInLog("{ typed: referralText }, 'refused'")).toEqual(['referralText'])
    expect(referralTextInLog("{ request: request.body }, 'refused'")).toEqual(['request.body'])
    expect(referralTextInLog("{ ...body }, 'refused'")).toEqual(['...body'])
    expect(referralTextInLog('`refused ${priced.referral}`')).toEqual(['referral'])
    expect(
      referralTextInLog(
        "{ referralCodeId, orderIds: [...orders] }, 'a referral code had fewer uses than its orders gave back'",
      ),
    ).toEqual([])
    expect(
      referralTextInLog("{ eventId: request.params.id, source: body.source }, 'changed'"),
    ).toEqual([])
  })

  it('names a code by its id alone in an order’s audit rows: order.paid’s metadata key by key, and every audit where a code arrives free of its text', () => {
    // Every audit row written where the buyer's code arrives or is resolved.
    let audits = 0

    for (const file of CODE_ARRIVES) {
      const code = readCode(file)

      for (const match of code.matchAll(/(?<!function\s+)\brecordAudit\s*\(/gu)) {
        const open = match.index + match[0].length - 1
        const args = code.slice(open + 1, balancedEnd(code, open))

        audits += 1
        expect(codeTextIn(args), `${file}:${lineOf(code, match.index)}`).toEqual([])
      }
    }

    expect(audits).toBeGreaterThanOrEqual(5)

    // `order.paid`, wherever it is written, key by key (review GC D2): the
    // checkout's names the code by `referralCodeId` and nothing else, and a
    // new key — a code's text under any name — fails here until it is read.
    /** @type {Record<string, Array<string[]|null>>} */
    const paid = {}

    for (const file of sourceFiles({ packages: true })) {
      const code = readCode(file)

      for (const match of code.matchAll(/(?<!function\s+)\brecordAudit\s*\(/gu)) {
        const open = match.index + match[0].length - 1
        const args = code.slice(open + 1, balancedEnd(code, open))

        if (!/\bAUDIT_ACTIONS\s*\.\s*ORDER_PAID\b/u.test(args)) continue

        for (const start of braceStarts(args)) {
          for (const entry of objectEntries(args, start)) {
            if (entry.key !== 'metadata') continue

            paid[file] = [
              ...(paid[file] ?? []),
              entry.kind === 'property' && args[entry.start] === '{'
                ? objectEntries(args, entry.start).map((inner) =>
                    inner.kind === 'spread'
                      ? `...${args.slice(inner.start, inner.end)}`
                      : inner.key,
                  )
                : null,
            ]
          }
        }
      }
    }

    expect(paid).toEqual({
      'apps/api/src/lib/checkout.js': [
        [
          'requestId',
          'at',
          'previousStatus',
          'newStatus',
          'paymentId',
          'totalCents',
          'currency',
          'paymentMethod',
          'feeSource',
          'feeGrossCents',
          'feeWaivedCents',
          'referralCodeId',
          'venueDueCents',
        ],
      ],
      'apps/api/src/lib/webhook-handlers.js': [['source', 'webhookEventId', 'providerStatus']],
    })

    // And it is the code's id, read from the order.
    const checkout = readCode('apps/api/src/lib/checkout.js')
    const paidAudit = checkout.search(/\baction:\s*AUDIT_ACTIONS\s*\.\s*ORDER_PAID\b/u)
    const metadata = checkout.indexOf('{', checkout.indexOf('metadata:', paidAudit))
    const referral = objectEntries(checkout, metadata).find(
      (entry) => entry.key === 'referralCodeId',
    )

    expect(checkout.slice(referral.start, referral.end).trim()).toBe('order.referralCodeId ?? null')
  })

  /** Payload keys no queued notice may carry: a code, a token, a credential or an address. */
  const SECRET_PAYLOAD_KEY =
    /^(?:code|referralCode|referralCodeId|token|tokenHash|invitationCode|credential|groupCode|secret|email|buyerEmail|recipientEmail|toEmail|address)$/u

  /**
   * The payload object of every row an outbox write makes, with its keys at
   * every depth (a spread is reported as written), or `null` when the payload
   * is built away from the write.
   *
   * @param {string} args The write's argument text.
   * @returns {Array<string[]|null>} One entry per payload.
   */
  function payloadsIn(args) {
    const payloads = []

    for (const open of braceStarts(args)) {
      for (const entry of objectEntries(args, open)) {
        if (entry.key !== 'payload') continue

        if (entry.kind !== 'property' || args[entry.start] !== '{') {
          payloads.push(null)
          continue
        }

        const keys = []
        const visit = (at) => {
          for (const inner of objectEntries(args, at)) {
            keys.push(
              inner.kind === 'spread'
                ? `...${args.slice(inner.start, inner.end).trim()}`
                : inner.key,
            )

            if (inner.kind === 'property' && args[inner.start] === '{') visit(inner.start)
          }
        }

        visit(entry.start)
        payloads.push(keys)
      }
    }

    return payloads
  }

  it('queues no notice carrying a code, a token or an address, and the venue notices only the keys SPEC3-XI names', () => {
    /** @type {Record<string, Array<string[]|null>>} */
    const queued = {}

    for (const file of sourceFiles({ packages: true })) {
      const code = readCode(file)

      for (const write of writesTo(code, 'NotificationOutbox')) {
        const at = `${file}:${write.line}`

        expect(
          [...write.fields].filter((field) => SECRET_PAYLOAD_KEY.test(field)),
          at,
        ).toEqual([])

        if (!['create', 'createMany', 'createManyAndReturn', 'upsert'].includes(write.operation)) {
          continue
        }

        for (const keys of payloadsIn(write.args)) {
          queued[file] = [...(queued[file] ?? []), keys]

          expect(keys, `${at} builds its payload elsewhere`).not.toBeNull()
          expect(
            keys.filter(
              (key) =>
                SECRET_PAYLOAD_KEY.test(key) || /\b(?:email|referralCode|\.code)\b/u.test(key),
            ),
            at,
          ).toEqual([])
        }
      }

      for (const write of rawWrites(code)) {
        expect(write.table, `${file}:${write.line} writes the outbox raw`).not.toBe(
          'NotificationOutbox',
        )
      }
    }

    // The notices SPEC3 and SPEC3-XI add, key by key: the booking's buyer and
    // each other holder when unpaid tickets are cancelled (venue_booking.cancelled),
    // the holder variants of event.cancelled and event.session_cancelled, and
    // the transfer invitation's door price.
    expect(queued[VENUE_BOOKINGS]).toEqual([
      [
        'eventId',
        'eventTitle',
        'recipient',
        'orderReference',
        'ticketCount',
        'dueCents',
        'passedOnTickets',
        'passedOnDueCents',
        'feeKeptCents',
        'onlineFee',
        'currency',
        'reason',
        'by',
        'othersRemain',
      ],
      ['eventId', 'eventTitle', 'recipient', 'ticketCount', 'dueCents', 'currency', 'reason', 'by'],
    ])
    expect(queued['apps/api/src/lib/event-cancellation.js']?.[1]).toEqual([
      'eventId',
      'eventTitle',
      'recipient',
      'paidAtDoorCents',
      'currency',
      '...(night ? { sessionLabel: night.label ?? null } : {})',
    ])
    expect(queued['apps/api/src/routes/tickets.js']).toEqual([
      ['ticketId', 'transferId', 'expiresAt', 'venueDueCents', 'currency'],
    ])

    // The buyer's pay-at-the-venue cancellation notice adds money and nothing else.
    const cancellation = readCode('apps/api/src/lib/event-cancellation.js')
    const extra = cancellation.indexOf('{', cancellation.search(/\bextra:\s*\{/u))

    expect(objectEntries(cancellation, extra).map((entry) => entry.key)).toEqual([
      'atVenue',
      'onlineRefund',
      'paidAtDoorCents',
      'paidAtDoorByOthersCents',
      'currency',
    ])
  })

  it('pins every queued notice’s payload, key by key, in every module that writes one', () => {
    /** @type {Record<string, Array<string[]|null>>} */
    const queued = {}

    for (const file of sourceFiles({ packages: true })) {
      const code = readCode(file)

      for (const write of writesTo(code, 'NotificationOutbox')) {
        if (!['create', 'createMany', 'createManyAndReturn', 'upsert'].includes(write.operation)) {
          continue
        }

        for (const keys of payloadsIn(write.args)) {
          // A conditional spread is pinned by its whole text, its layout aside.
          queued[file] = [
            ...(queued[file] ?? []),
            keys && keys.map((key) => key.replace(/\s+/gu, ' ')),
          ]
        }
      }
    }

    // A key the notices do not have today — a code's text under a neutral
    // name included (review GC D3) — fails here until it is read and added.
    // The pay-at-the-venue keys `...extra` brings are pinned above, and it is
    // given in one place.
    expect(queued).toEqual({
      'apps/api/src/lib/event-cancellation.js': [
        [
          'eventId',
          'eventTitle',
          'orderId',
          'orderReference',
          'reasonCode',
          'reason',
          'previousStartsAt',
          'startsAt',
          'byPlatform',
          '...extra',
        ],
        [
          'eventId',
          'eventTitle',
          'recipient',
          'paidAtDoorCents',
          'currency',
          '...(night ? { sessionLabel: night.label ?? null } : {})',
        ],
      ],
      'apps/api/src/lib/event-material-change.js': [
        [
          'eventId',
          'eventTitle',
          'orderId',
          'orderReference',
          'changedFields',
          'changed',
          'before',
          'after',
          'reason',
          'byPlatform',
          '...(session ? { sessionId: session.id, sessionStartsAt: session.startsAt instanceof Date ? session.startsAt.toISOString() : (session.startsAt ?? null), } : {})',
          '...(sessions ? { sessions } : {})',
        ],
      ],
      'apps/api/src/lib/session-cancellation.js': [
        [
          'eventId',
          'eventTitle',
          'orderId',
          'orderReference',
          'sessionId',
          'sessionLabel',
          'sessionStartsAt',
          'reason',
          'outcome',
          'refunded',
          'keptEveryNight',
          'byPlatform',
          '...(venue ? { atVenue: true, onlineRefund: ONLINE_REFUND_BY_OUTCOME[outcome] ?? null, paidAtDoorCents: venue.buyerCents, paidAtDoorByOthersCents: venue.othersCents, currency: order.currency, } : {})',
        ],
      ],
      [VENUE_BOOKINGS]: [
        [
          'eventId',
          'eventTitle',
          'recipient',
          'orderReference',
          'ticketCount',
          'dueCents',
          'passedOnTickets',
          'passedOnDueCents',
          'feeKeptCents',
          'onlineFee',
          'currency',
          'reason',
          'by',
          'othersRemain',
        ],
        [
          'eventId',
          'eventTitle',
          'recipient',
          'ticketCount',
          'dueCents',
          'currency',
          'reason',
          'by',
        ],
      ],
      'apps/api/src/routes/tickets.js': [
        ['ticketId', 'transferId', 'expiresAt', 'venueDueCents', 'currency'],
      ],
    })

    const cancellation = readCode('apps/api/src/lib/event-cancellation.js')

    expect(cancellation.match(/\bextra:\s*\{/gu)).toHaveLength(1)
    expect(cancellation.match(/\.\.\.\s*extra\b/gu)).toHaveLength(1)
  })

  it('names a code’s text referralCode only in the administrators’ answers, and takes it only in a POST body', () => {
    const document = buildOpenApiDocument()
    const components = document.components?.schemas ?? {}
    /** @type {Record<string, string[]>} */
    const carriers = {}

    /**
     * @param {unknown} node A JSON Schema fragment.
     * @param {Set<string>} into Where to collect property names.
     * @param {Set<string>} expanding The `$ref`s on this chain.
     * @returns {Set<string>} The names.
     */
    const names = (node, into = new Set(), expanding = new Set()) => {
      if (Array.isArray(node)) {
        for (const item of node) names(item, into, expanding)

        return into
      }

      if (!node || typeof node !== 'object') return into

      if (typeof node.$ref === 'string') {
        const name = node.$ref.split('/').at(-1)

        if (!expanding.has(name)) names(components[name], into, new Set([...expanding, name]))
      }

      for (const [key, value] of Object.entries(node)) {
        if (key === 'properties' && value && typeof value === 'object') {
          for (const [property, child] of Object.entries(value)) {
            into.add(property)
            names(child, into, expanding)
          }
        } else if (key !== '$ref') {
          names(value, into, expanding)
        }
      }

      return into
    }

    for (const operations of Object.values(document.paths)) {
      for (const operation of Object.values(operations)) {
        const found = names(operation.responses ?? {})

        for (const key of [
          'referralCode',
          'referralCodeId',
          'referralUseReturnedAt',
          'referralUseReturnCause',
          'useReturned',
          'createdBy',
          'createdById',
        ]) {
          if (found.has(key))
            carriers[key] = [...(carriers[key] ?? []), operation.operationId].sort()
        }
      }
    }

    // The named exception list (SPEC3 §13): the administrators' code answers
    // carry the text and who made it; nothing answers an order's code id or
    // its return marker; a use's return shows only on a code's own detail.
    const ADMIN_CODE_ANSWERS = [
      'referralCodes.create',
      'referralCodes.get',
      'referralCodes.list',
      'referralCodes.switchOff',
      'referralCodes.switchOn',
      'referralCodes.update',
    ]

    expect(carriers).toEqual({
      createdBy: ADMIN_CODE_ANSWERS,
      referralCode: ADMIN_CODE_ANSWERS,
      useReturned: ['referralCodes.get'],
    })

    // Never in a URL: no path or query takes it, and only the quote, the
    // order and the administrators' create take it, in their bodies.
    const takers = []

    for (const route of apiRoutes) {
      for (const [where, schema] of [
        ['params', route.params],
        ['query', route.query],
        ['body', route.body],
      ]) {
        if (schemaKeys(schema).has('referralCode')) takers.push(`${route.id} ${where}`)
      }
    }

    expect(takers.sort()).toEqual([
      'orders.create body',
      'orders.quote body',
      'referralCodes.create body',
    ])

    for (const id of ['orders.create', 'orders.quote', 'referralCodes.create']) {
      expect(routeById(id).method, id).toBe('POST')
    }
  })
})
