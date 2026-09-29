/**
 * `/v1/organizations/:id/promo-codes`: an organiser's discount codes.
 *
 * What these pin down: only `promo:manage` reaches them (EVENT_MANAGER and up),
 * making or resuming a code needs a recent second factor, every write is
 * audited without the code's text, a code of another organisation answers 404,
 * and a code somebody has used can be paused but never deleted.
 *
 * @module @desi-event/api/tests/promo-codes
 */

import { describe, expect, it } from 'vitest'

import { bearer, createTestApp, signIn, stepUp } from './helpers/app.js'
import { makeWorld, minutesFromNow, passwordHash } from './helpers/fixtures.js'
import { cuid } from './helpers/prisma-stub.js'

/**
 * The fixture world, plus one member for each role the tests ask about.
 *
 * @returns {Promise<{seed: object, ids: object}>} The world.
 */
async function promoWorld() {
  const world = await makeWorld()
  const hash = await passwordHash()
  const { organization, otherOrganization } = world.ids

  /**
   * A member of the fixture organisation with a given role.
   *
   * @param {string} email The address.
   * @param {string} role The `OrgRole`.
   * @returns {object} The user row.
   */
  const member = (email, role) => {
    const user = {
      id: cuid(),
      email,
      passwordHash: hash,
      displayName: role,
      phone: null,
      locale: 'en-IN',
      role: 'ORGANIZER',
      emailVerified: true,
      createdAt: new Date('2025-01-02T00:00:00.000Z'),
      updatedAt: new Date('2025-01-02T00:00:00.000Z'),
    }

    world.seed.user.push(user)
    world.seed.membership.push({
      id: cuid(),
      userId: user.id,
      organizationId: organization.id,
      role,
      createdAt: new Date('2025-01-02T00:00:00.000Z'),
    })

    return user
  }

  member('events@rangoli.example', 'EVENT_MANAGER')
  member('money@rangoli.example', 'FINANCE')
  member('scanner@rangoli.example', 'SCANNER')

  // A code that belongs to the other organisation, to be reached for by id.
  world.ids.foreignPromo = {
    id: cuid(),
    organizationId: otherOrganization.id,
    eventId: null,
    code: 'DHOL20',
    type: 'PERCENTAGE',
    value: 2000,
    currency: null,
    maxRedemptions: null,
    redemptionCount: 0,
    startsAt: null,
    endsAt: null,
    active: true,
    createdAt: new Date('2025-02-01T00:00:00.000Z'),
    updatedAt: new Date('2025-02-01T00:00:00.000Z'),
  }
  world.seed.promoCode.push(world.ids.foreignPromo)

  return world
}

/**
 * A signed-in member who has just stepped up.
 *
 * @param {object} app The Fastify instance.
 * @param {string} email The member's address.
 * @returns {Promise<object>} Authenticated headers.
 */
async function steppedUp(app, email) {
  const headers = bearer(await signIn(app, email))
  await stepUp(app, email, headers)
  return headers
}

/**
 * Let every signed-in session's second factor go stale.
 *
 * Signing in with a second factor counts as a fresh step-up; an hour on, it no
 * longer does. This is how a test reaches the step-up refusal honestly.
 *
 * @param {object} prisma The stub.
 * @returns {void}
 */
function ageSecondFactor(prisma) {
  for (const row of prisma._store.session) {
    row.mfaSatisfiedAt = new Date(Date.now() - 60 * 60 * 1000)
  }
}

/**
 * The base path for an organisation's codes.
 *
 * @param {string} organizationId The organisation.
 * @returns {string} The path.
 */
function codes(organizationId) {
  return `/v1/organizations/${organizationId}/promo-codes`
}

describe('making a promo code', () => {
  it('makes a percentage code and a fixed amount, audited without the code', async () => {
    const world = await promoWorld()
    const { app, prisma, ids } = await createTestApp(world)
    const headers = await steppedUp(app, 'arun@rangoli.example')

    const percent = await app.inject({
      method: 'POST',
      url: codes(ids.organization.id),
      headers,
      payload: { code: ' early15 ', type: 'PERCENTAGE', value: 1500, maxRedemptions: 50 },
    })

    expect(percent.statusCode).toBe(201)
    expect(percent.json().data).toMatchObject({
      code: 'EARLY15',
      type: 'PERCENTAGE',
      value: 1500,
      currency: null,
      maxRedemptions: 50,
      redemptionCount: 0,
      status: 'ACTIVE',
      event: null,
      ordersCount: 0,
    })

    const fixed = await app.inject({
      method: 'POST',
      url: codes(ids.organization.id),
      headers,
      payload: {
        code: 'FLAT500',
        type: 'FIXED_AMOUNT',
        value: 50_000,
        currency: 'INR',
        eventId: ids.publishedEvent.id,
        active: false,
      },
    })

    expect(fixed.statusCode).toBe(201)
    expect(fixed.json().data).toMatchObject({
      currency: 'INR',
      status: 'PAUSED',
      event: { id: ids.publishedEvent.id, slug: 'navratri-garba-night' },
    })

    const audits = prisma._store.auditLog.filter((row) => row.action === 'promo.created')
    expect(audits).toHaveLength(2)
    expect(audits[0].metadata).toMatchObject({
      organizationId: ids.organization.id,
      type: 'PERCENTAGE',
      value: 1500,
      maxRedemptions: 50,
    })
    for (const audit of audits) {
      expect(JSON.stringify(audit.metadata)).not.toMatch(/EARLY15|FLAT500/)
    }

    await app.close()
  })

  it('lets an event manager make one', async () => {
    const world = await promoWorld()
    const { app, ids } = await createTestApp(world)
    const headers = await steppedUp(app, 'events@rangoli.example')

    const response = await app.inject({
      method: 'POST',
      url: codes(ids.organization.id),
      headers,
      payload: { code: 'NAVRATRI', type: 'PERCENTAGE', value: 500 },
    })

    expect(response.statusCode).toBe(201)

    await app.close()
  })

  it('needs a recent second factor', async () => {
    const world = await promoWorld()
    const { app, prisma, ids } = await createTestApp(world)
    const headers = bearer(await signIn(app, 'arun@rangoli.example'))
    const before = prisma._store.promoCode.length
    ageSecondFactor(prisma)

    const response = await app.inject({
      method: 'POST',
      url: codes(ids.organization.id),
      headers,
      payload: { code: 'NOSTEPUP', type: 'PERCENTAGE', value: 500 },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('STEP_UP_REQUIRED')
    expect(prisma._store.promoCode).toHaveLength(before)

    await app.close()
  })

  it('refuses the roles that do not manage promotions', async () => {
    const world = await promoWorld()
    const { app, ids } = await createTestApp(world)

    for (const email of [
      'finance@rangoli.example',
      'money@rangoli.example',
      'scanner@rangoli.example',
      'door@rangoli.example',
    ]) {
      const headers = bearer(await signIn(app, email))

      const create = await app.inject({
        method: 'POST',
        url: codes(ids.organization.id),
        headers,
        payload: { code: 'NOTYOURS', type: 'PERCENTAGE', value: 500 },
      })
      const list = await app.inject({ method: 'GET', url: codes(ids.organization.id), headers })

      expect(create.statusCode, email).toBe(403)
      expect(list.statusCode, email).toBe(403)
    }

    await app.close()
  })

  it('refuses a fixed amount with no currency, before the route runs', async () => {
    const world = await promoWorld()
    const { app, ids } = await createTestApp(world)
    const headers = await steppedUp(app, 'arun@rangoli.example')

    const response = await app.inject({
      method: 'POST',
      url: codes(ids.organization.id),
      headers,
      payload: { code: 'NOCURRENCY', type: 'FIXED_AMOUNT', value: 500 },
    })

    expect(response.statusCode).toBe(400)

    await app.close()
  })

  it('answers 404 for an event of another organisation, 422 for a currency the event does not sell in', async () => {
    const world = await promoWorld()
    const { app, ids } = await createTestApp(world)
    const headers = await steppedUp(app, 'arun@rangoli.example')

    const foreign = await app.inject({
      method: 'POST',
      url: codes(ids.organization.id),
      headers,
      payload: {
        code: 'THEIRS',
        type: 'PERCENTAGE',
        value: 500,
        eventId: ids.onlineEvent.id,
      },
    })

    expect(foreign.statusCode).toBe(404)

    const currency = await app.inject({
      method: 'POST',
      url: codes(ids.organization.id),
      headers,
      payload: {
        code: 'DOLLARSOFF',
        type: 'FIXED_AMOUNT',
        value: 500,
        currency: 'USD',
        eventId: ids.publishedEvent.id,
      },
    })

    expect(currency.statusCode).toBe(422)
    expect(currency.json().error.message).toMatch(/INR/)

    const ended = await app.inject({
      method: 'POST',
      url: codes(ids.organization.id),
      headers,
      payload: {
        code: 'TOOLATE',
        type: 'PERCENTAGE',
        value: 500,
        startsAt: new Date(Date.now() - 7_200_000).toISOString(),
        endsAt: new Date(Date.now() - 3_600_000).toISOString(),
      },
    })

    expect(ended.statusCode).toBe(422)

    await app.close()
  })

  it('refuses a code the organiser already has, whatever case it was typed in', async () => {
    const world = await promoWorld()
    const { app, ids } = await createTestApp(world)
    const headers = await steppedUp(app, 'arun@rangoli.example')

    const response = await app.inject({
      method: 'POST',
      url: codes(ids.organization.id),
      headers,
      payload: { code: 'garba10', type: 'PERCENTAGE', value: 500 },
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().error.code).toBe('PROMO_CODE_TAKEN')

    await app.close()
  })
})

describe('listing promo codes', () => {
  it('lists this organisation’s codes only, with a computed status', async () => {
    const world = await promoWorld()
    const { ids } = world

    world.seed.promoCode.push(
      {
        ...ids.foreignPromo,
        id: cuid(),
        organizationId: ids.organization.id,
        code: 'USEDUP',
        maxRedemptions: 1,
        redemptionCount: 1,
      },
      {
        ...ids.foreignPromo,
        id: cuid(),
        organizationId: ids.organization.id,
        code: 'NEXTWEEK',
        startsAt: minutesFromNow(60 * 24 * 7),
      },
    )

    const { app } = await createTestApp(world)
    const headers = bearer(await signIn(app, 'arun@rangoli.example'))

    const response = await app.inject({ method: 'GET', url: codes(ids.organization.id), headers })

    expect(response.statusCode).toBe(200)

    const byCode = Object.fromEntries(response.json().data.map((row) => [row.code, row.status]))
    expect(byCode).toEqual({ GARBA10: 'ACTIVE', USEDUP: 'USED_UP', NEXTWEEK: 'SCHEDULED' })
    expect(response.json().pagination.total).toBe(3)

    const scheduled = await app.inject({
      method: 'GET',
      url: `${codes(ids.organization.id)}?status=SCHEDULED`,
      headers,
    })
    expect(scheduled.json().data.map((row) => row.code)).toEqual(['NEXTWEEK'])

    const forEvent = await app.inject({
      method: 'GET',
      url: `${codes(ids.organization.id)}?eventId=${ids.draftEvent.id}`,
      headers,
    })
    // GARBA10 is the published event's; the other two are for every event.
    expect(
      forEvent
        .json()
        .data.map((row) => row.code)
        .sort(),
    ).toEqual(['NEXTWEEK', 'USEDUP'])

    await app.close()
  })
})

describe('pausing, resuming and deleting', () => {
  it('pauses once, and a second pause writes nothing', async () => {
    const world = await promoWorld()
    const { app, prisma, ids } = await createTestApp(world)
    const headers = bearer(await signIn(app, 'arun@rangoli.example'))
    const url = `${codes(ids.organization.id)}/${ids.promoCode.id}/pause`

    const first = await app.inject({ method: 'POST', url, headers })
    const second = await app.inject({ method: 'POST', url, headers })

    expect(first.statusCode).toBe(200)
    expect(first.json().data.status).toBe('PAUSED')
    expect(second.statusCode).toBe(200)
    expect(prisma._store.auditLog.filter((row) => row.action === 'promo.paused')).toHaveLength(1)

    await app.close()
  })

  it('resumes only with a recent second factor, and never a code that has ended', async () => {
    const world = await promoWorld()
    const { ids } = world
    const ended = {
      ...ids.foreignPromo,
      id: cuid(),
      organizationId: ids.organization.id,
      code: 'SUMMER',
      active: false,
      startsAt: new Date('2025-06-01T00:00:00.000Z'),
      endsAt: new Date('2025-07-01T00:00:00.000Z'),
    }
    world.seed.promoCode.push(ended)
    ids.promoCode.active = false

    const { app, prisma } = await createTestApp(world)
    const headers = bearer(await signIn(app, 'arun@rangoli.example'))
    ageSecondFactor(prisma)
    const resume = (id) =>
      app.inject({
        method: 'POST',
        url: `${codes(ids.organization.id)}/${id}/resume`,
        headers,
      })

    const withoutFactor = await resume(ids.promoCode.id)
    expect(withoutFactor.statusCode).toBe(403)
    expect(withoutFactor.json().error.code).toBe('STEP_UP_REQUIRED')

    await stepUp(app, 'arun@rangoli.example', headers)

    const resumed = await resume(ids.promoCode.id)
    expect(resumed.statusCode).toBe(200)
    expect(resumed.json().data.status).toBe('ACTIVE')
    expect(prisma._store.auditLog.filter((row) => row.action === 'promo.resumed')).toHaveLength(1)

    const refused = await resume(ended.id)
    expect(refused.statusCode).toBe(409)
    expect(refused.json().error.code).toBe('PROMO_ENDED')
    expect(prisma._store.promoCode.find((row) => row.id === ended.id).active).toBe(false)

    await app.close()
  })

  it('deletes an unused code, and refuses one used or named by an order', async () => {
    const world = await promoWorld()
    const { ids } = world
    const unused = {
      ...ids.foreignPromo,
      id: cuid(),
      organizationId: ids.organization.id,
      code: 'NEVERUSED',
    }
    const named = { ...unused, id: cuid(), code: 'PENDINGONE' }
    world.seed.promoCode.push(unused, named)
    ids.promoCode.redemptionCount = 3

    world.seed.order = [
      {
        id: cuid(),
        reference: 'DE-PEND1NG',
        eventId: ids.publishedEvent.id,
        userId: null,
        buyerEmail: 'someone@example.com',
        buyerName: 'Someone',
        status: 'PENDING',
        currency: 'INR',
        subtotalCents: 100,
        discountCents: 10,
        feesCents: 0,
        taxCents: 0,
        totalCents: 90,
        promoCodeId: named.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]

    const { app, prisma } = await createTestApp(world)
    const headers = bearer(await signIn(app, 'arun@rangoli.example'))
    const remove = (id) =>
      app.inject({ method: 'DELETE', url: `${codes(ids.organization.id)}/${id}`, headers })

    const deleted = await remove(unused.id)
    expect(deleted.statusCode).toBe(200)
    expect(prisma._store.promoCode.some((row) => row.id === unused.id)).toBe(false)

    const used = await remove(ids.promoCode.id)
    expect(used.statusCode).toBe(409)
    expect(used.json().error).toMatchObject({
      code: 'PROMO_IN_USE',
      message: 'Used 3 times, so it can be paused but not deleted.',
    })

    const pending = await remove(named.id)
    expect(pending.statusCode).toBe(409)
    expect(pending.json().error.code).toBe('PROMO_IN_USE')

    const audits = prisma._store.auditLog.filter((row) => row.action === 'promo.deleted')
    expect(audits).toHaveLength(1)
    expect(JSON.stringify(audits[0].metadata)).not.toContain('NEVERUSED')

    await app.close()
  })

  it('answers 404 for a code of another organisation reached through this one', async () => {
    const world = await promoWorld()
    const { app, prisma, ids } = await createTestApp(world)
    const headers = await steppedUp(app, 'arun@rangoli.example')
    const base = `${codes(ids.organization.id)}/${ids.foreignPromo.id}`

    for (const request of [
      { method: 'POST', url: `${base}/pause` },
      { method: 'POST', url: `${base}/resume` },
      { method: 'DELETE', url: base },
    ]) {
      const response = await app.inject({ ...request, headers })
      expect(response.statusCode, request.url).toBe(404)
    }

    expect(prisma._store.promoCode.find((row) => row.id === ids.foreignPromo.id).active).toBe(true)

    await app.close()
  })
})
