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

import { describe, expect, it } from 'vitest'

import { apiRoutes } from '@desi-event/api-contract'
import { apiRouteManifest } from '@desi-event/api-contract/manifest'
import { PLATFORM_ONLY_CAPABILITIES } from '@desi-event/permissions'
import { STEP_UP_POLICIES } from '@desi-event/auth'

import { toDispute, toPayout, toRefund, toTransfer } from '../src/lib/presenters.js'
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

  /** What must never appear in any of the four payloads. */
  const NEVER = ['priya@example.com', 'Priya Sharma', '4242', 'everything the provider sent']

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
