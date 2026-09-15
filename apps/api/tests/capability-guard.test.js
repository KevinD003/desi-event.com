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
import { testEnv } from './helpers/app.js'

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
