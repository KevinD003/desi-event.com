/**
 * The capability guard, tested directly rather than through a route.
 *
 * Finding NF-05 was an authorization *inversion*: a guard that could not find
 * the organisation asserted with none, which refuses every organiser and passes
 * every platform admin. The contract checker now makes that unregisterable —
 * every organisation-scoped capability must name where its organisation is, and
 * the named key must exist in the route's own schema and be required.
 *
 * These tests cover the guard's own behaviour anyway, because a guard that is
 * only correct while a checker it cannot see keeps holding is one refactor from
 * being wrong, and the failure is silent.
 */

import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'

import { apiEnvSchema, parseOrThrow } from '@desi-event/schemas'

import { registerAuth } from '../src/plugins/auth.js'
import { registerErrorHandler } from '../src/plugins/error-handler.js'
import { createPrismaStub } from './helpers/prisma-stub.js'
import { makeWorld } from './helpers/fixtures.js'
import { bearer, createTestApp, signIn, testEnv } from './helpers/app.js'

/**
 * A Fastify instance with the auth decorators and nothing else.
 *
 * @param {object} actor The actor to attach, standing in for a completed sign-in.
 * @returns {Promise<object>} The instance.
 */
async function harness(actor) {
  const world = await makeWorld()
  const app = Fastify({ logger: false })

  await registerErrorHandler(app, { nodeEnv: 'test' })

  // Through the real schema, because `AUTH_SECRET` is derived there when it is
  // not supplied and the sealing key depends on it.
  const env = parseOrThrow(apiEnvSchema, testEnv(), 'Invalid API environment')

  await registerAuth(app, { prisma: createPrismaStub(world.seed), env })

  // Stand in for the guards that would have run first. The point of these tests
  // is what `requireCapability` does with an actor it has been given, not how the
  // actor was built.
  app.addHook('onRequest', async (request) => {
    request.actor = actor
  })

  return app
}

/** An organiser: powers inside one organisation, none outside it. */
const organiser = {
  id: 'user_org',
  role: 'USER',
  email: 'organiser@example.test',
  memberships: [{ organizationId: 'org_1', role: 'OWNER' }],
}

/** A platform administrator: every capability, no membership anywhere. */
const platformAdmin = {
  id: 'user_admin',
  role: 'SUPER_ADMIN',
  email: 'admin@example.test',
  memberships: [],
}

describe('an organisation-scoped capability with a declared scope', () => {
  it('admits the organiser of the organisation named in the path', async () => {
    const app = await harness(organiser)

    app.get(
      '/orgs/:id/thing',
      { preHandler: app.requireCapability('team:invite', 'params.id') },
      async () => ({ ok: true }),
    )

    const response = await app.inject({ method: 'GET', url: '/orgs/org_1/thing' })

    expect(response.statusCode).toBe(200)

    await app.close()
  })

  it('refuses the same organiser for a different organisation', async () => {
    const app = await harness(organiser)

    app.get(
      '/orgs/:id/thing',
      { preHandler: app.requireCapability('team:invite', 'params.id') },
      async () => ({ ok: true }),
    )

    const response = await app.inject({ method: 'GET', url: '/orgs/org_other/thing' })

    expect(response.statusCode).toBe(403)

    await app.close()
  })
})

describe('an organisation-scoped capability with no scope', () => {
  // This is the NF-05 failure. The old guard fell back to hunting for an
  // `organizationId` in the body, query or params; a path that spells it `id`
  // produced no match, and the assertion ran unscoped.

  it('refuses the organiser rather than asserting with no organisation', async () => {
    const app = await harness(organiser)

    app.get('/orgs/:id/thing', { preHandler: app.requireCapability('team:invite') }, async () => ({
      ok: true,
    }))

    const response = await app.inject({ method: 'GET', url: '/orgs/org_1/thing' })

    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('CAPABILITY_SCOPE_MISSING')

    await app.close()
  })

  it('refuses the platform admin too, so the check cannot invert', async () => {
    // The dangerous half: unscoped, `assertCan` would *pass* a platform admin.
    // A guard that refuses an organiser and admits an admin is worse than one
    // that refuses both, because only the second is noticed.
    const app = await harness(platformAdmin)

    app.get('/orgs/:id/thing', { preHandler: app.requireCapability('team:invite') }, async () => ({
      ok: true,
    }))

    const response = await app.inject({ method: 'GET', url: '/orgs/org_1/thing' })

    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('CAPABILITY_SCOPE_MISSING')

    await app.close()
  })
})

describe('a scope that names a field the request does not carry', () => {
  it('refuses rather than degrading to a platform-level check', async () => {
    const app = await harness(organiser)

    app.get(
      '/orgs/:id/thing',
      { preHandler: app.requireCapability('team:invite', 'params.organizationId') },
      async () => ({ ok: true }),
    )

    const response = await app.inject({ method: 'GET', url: '/orgs/org_1/thing' })

    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('CAPABILITY_SCOPE_MISSING')

    await app.close()
  })

  it('refuses an empty string, which is not an organisation', async () => {
    const app = await harness(organiser)

    app.get(
      '/orgs/thing',
      { preHandler: app.requireCapability('team:invite', 'query.organizationId') },
      async () => ({ ok: true }),
    )

    const response = await app.inject({ method: 'GET', url: '/orgs/thing?organizationId=' })

    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('CAPABILITY_SCOPE_MISSING')

    await app.close()
  })
})

describe('a platform-only capability', () => {
  it('asserts with no organisation, which is what platform-only means', async () => {
    const app = await harness(platformAdmin)

    app.get('/admin/thing', { preHandler: app.requireCapability('platform:admin') }, async () => ({
      ok: true,
    }))

    const response = await app.inject({ method: 'GET', url: '/admin/thing' })

    expect(response.statusCode).toBe(200)

    await app.close()
  })

  it('refuses an organiser, however senior in their own organisation', async () => {
    const app = await harness(organiser)

    app.get('/admin/thing', { preHandler: app.requireCapability('platform:admin') }, async () => ({
      ok: true,
    }))

    const response = await app.inject({ method: 'GET', url: '/admin/thing' })

    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).not.toBe('CAPABILITY_SCOPE_MISSING')

    await app.close()
  })
})

describe('the MFA enrolment gate, finding NF-12', () => {
  // `sessionPolicyFor` has always returned `mfaRequired` for anybody who can
  // moderate, refund, pay out or publish, and its docstring said such an account
  // "cannot reach a privileged route until it has" enrolled. Nothing implemented
  // that, so a finance administrator with no factor held every capability their
  // role granted.

  /**
   * Build a world whose organiser deliberately has no second factor.
   *
   * @returns {Promise<object>} The harness.
   */
  async function unenrolledOrganiser() {
    const world = await makeWorld()

    // Built, then stripped: `createTestApp` enrols every privileged account, so
    // the only way to test the gate is to take the factor away again.
    const harness = await createTestApp({ seed: world.seed, ids: world.ids })

    harness.prisma._store.mfaFactor = harness.prisma._store.mfaFactor.filter(
      (factor) => factor.type === 'RECOVERY_CODE',
    )

    return harness
  }

  it('refuses a privileged caller who has enrolled nothing', async () => {
    const { app, ids } = await unenrolledOrganiser()
    const token = await signIn(app, 'arun@rangoli.example')

    const response = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${ids.organization.id}/members`,
      headers: bearer(token),
    })

    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('MFA_ENROLMENT_REQUIRED')

    await app.close()
  })

  it('lets the same caller through once a factor is confirmed', async () => {
    const { app, ids } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')

    const response = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${ids.organization.id}/members`,
      headers: bearer(token),
    })

    expect(response.statusCode).toBe(200)

    await app.close()
  })

  it('leaves the enrolment route itself reachable', async () => {
    // Otherwise a privileged user could never enrol, which would be a lockout
    // rather than a control.
    const { app } = await unenrolledOrganiser()
    const token = await signIn(app, 'arun@rangoli.example')

    const started = await app.inject({
      method: 'POST',
      url: '/v1/auth/mfa/totp',
      headers: bearer(token),
      payload: {},
    })

    expect(started.statusCode).toBe(201)

    await app.close()
  })

  it('leaves profile, session management and sign-out reachable', async () => {
    const { app } = await unenrolledOrganiser()
    const token = await signIn(app, 'arun@rangoli.example')

    for (const url of ['/v1/auth/me', '/v1/auth/sessions', '/v1/auth/devices', '/v1/auth/mfa']) {
      const response = await app.inject({ method: 'GET', url, headers: bearer(token) })

      expect(response.statusCode, url).toBe(200)
    }

    await app.close()
  })

  it('does not fire for an attendee, who holds no privileged role', async () => {
    const { app } = await unenrolledOrganiser()
    const token = await signIn(app, 'priya@example.com')

    const response = await app.inject({
      method: 'GET',
      url: '/v1/orders',
      headers: bearer(token),
    })

    expect(response.statusCode).toBe(200)

    await app.close()
  })

  it('does not count recovery codes as enrolment', async () => {
    // A printed list is a way back in after losing the authenticator, not a
    // second factor to rely on.
    const { app, ids, prisma } = await createTestApp()

    // Signed in while the authenticator still existed, then it is removed and
    // only recovery codes remain — which is what happens when somebody loses a
    // phone. The gate is evaluated per request, so the session continues to exist
    // and stops being able to do privileged work.
    const token = await signIn(app, 'arun@rangoli.example')
    const organiser = prisma._store.user.find((row) => row.email === 'arun@rangoli.example')

    prisma._store.mfaFactor = prisma._store.mfaFactor.filter(
      (factor) => factor.userId !== organiser.id,
    )
    prisma._store.mfaFactor.push({
      id: 'recovery-only',
      userId: organiser.id,
      type: 'RECOVERY_CODE',
      secretSealed: 'fake-sealed-recovery-code',
      confirmedAt: new Date(),
      disabledAt: null,
      usedAt: null,
      lastUsedAt: null,
      createdAt: new Date(),
    })

    const response = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${ids.organization.id}/members`,
      headers: bearer(token),
    })

    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('MFA_ENROLMENT_REQUIRED')

    await app.close()
  })
})

describe('step-up without an enrolled factor, finding NF-12', () => {
  it('refuses a password for a privileged account with no factor', async () => {
    // The sharp end of the finding: step-up used to accept a password whenever
    // the account had no factor, so the challenge on the account most in need of
    // a second factor was a re-typed first one.
    const world = await makeWorld()
    const { app, prisma } = await createTestApp({ seed: world.seed, ids: world.ids })

    prisma._store.mfaFactor = []

    const token = await signIn(app, 'arun@rangoli.example')
    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/step-up',
      headers: bearer(token),
      payload: { password: 'correct-horse-battery' },
    })

    expect(response.statusCode).toBe(401)
    expect(response.json().error.code).toBe('MFA_ENROLMENT_REQUIRED')

    await app.close()
  })

  it('still accepts a password for an attendee, who needs no second factor', async () => {
    const { app } = await createTestApp()
    const token = await signIn(app, 'priya@example.com')

    const response = await app.inject({
      method: 'POST',
      url: '/v1/auth/step-up',
      headers: bearer(token),
      payload: { password: 'correct-horse-battery' },
    })

    expect(response.statusCode).toBe(200)

    await app.close()
  })
})
