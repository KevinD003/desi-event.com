import { describe, expect, it } from 'vitest'

import { bearer, createTestApp, signIn } from './helpers/app.js'
import { minutesFromNow } from './helpers/fixtures.js'

describe('GET /v1/events/:eventId/ticket-types', () => {
  it('lists tiers with availability that already subtracts live holds', async () => {
    const { app, ids } = await createTestApp()

    await app.inject({
      method: 'POST',
      url: '/v1/holds',
      payload: { ticketTypeId: ids.generalAdmission.id, quantity: 3 },
    })

    const response = await app.inject({
      method: 'GET',
      url: `/v1/events/${ids.publishedEvent.id}/ticket-types`,
    })

    expect(response.statusCode).toBe(200)

    const tiers = response.json().data
    const general = tiers.find((tier) => tier.id === ids.generalAdmission.id)

    expect(general.quantityTotal).toBe(10)
    expect(general.quantitySold).toBe(0)
    // 10 total, none sold, three in somebody's cart.
    expect(general.availableQuantity).toBe(7)
    expect(general.isSoldOut).toBe(false)

    await app.close()
  })

  it('reports sold out when holds and sales together exhaust the tier', async () => {
    const { app, prisma, ids } = await createTestApp()

    prisma._store.ticketType.find((tier) => tier.id === ids.vip.id).quantitySold = 2
    await app.inject({
      method: 'POST',
      url: '/v1/holds',
      payload: { ticketTypeId: ids.vip.id, quantity: 2 },
    })

    const response = await app.inject({
      method: 'GET',
      url: `/v1/events/${ids.publishedEvent.id}/ticket-types`,
    })

    const vip = response.json().data.find((tier) => tier.id === ids.vip.id)
    expect(vip).toMatchObject({ availableQuantity: 0, isSoldOut: true })

    await app.close()
  })

  it('ignores a lapsed hold when reporting availability', async () => {
    const { app, prisma, ids } = await createTestApp()

    prisma._store.ticketHold.push({
      id: 'cstaleholdrow00000000000z',
      ticketTypeId: ids.vip.id,
      orderId: null,
      quantity: 4,
      status: 'ACTIVE',
      expiresAt: minutesFromNow(-5),
      createdAt: minutesFromNow(-30),
      updatedAt: minutesFromNow(-30),
    })

    const response = await app.inject({
      method: 'GET',
      url: `/v1/events/${ids.publishedEvent.id}/ticket-types`,
    })

    expect(response.json().data.find((tier) => tier.id === ids.vip.id).availableQuantity).toBe(4)

    await app.close()
  })

  it('hides the tiers of a draft event from anyone who may not see it', async () => {
    const { app, ids } = await createTestApp()
    const memberToken = await signIn(app, 'finance@rangoli.example')

    const anonymous = await app.inject({
      method: 'GET',
      url: `/v1/events/${ids.draftEvent.id}/ticket-types`,
    })
    const member = await app.inject({
      method: 'GET',
      url: `/v1/events/${ids.draftEvent.id}/ticket-types`,
      headers: bearer(memberToken),
    })

    expect(anonymous.statusCode).toBe(404)
    expect(member.statusCode).toBe(200)
    expect(member.json().data).toHaveLength(1)

    await app.close()
  })
})

describe('POST /v1/events/:eventId/ticket-types', () => {
  /** A valid tier payload. */
  const payload = {
    eventId: 'cignoredbybackend0000000z',
    name: 'Balcony',
    priceCents: 250_000,
    quantityTotal: 50,
  }

  it('creates a tier and ignores an eventId smuggled in the body', async () => {
    const { app, ids } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.publishedEvent.id}/ticket-types`,
      headers: bearer(token),
      payload,
    })

    expect(response.statusCode).toBe(201)
    expect(response.json().data).toMatchObject({
      eventId: ids.publishedEvent.id,
      name: 'Balcony',
      priceCents: 250_000,
      currency: 'INR',
      status: 'DRAFT',
      quantitySold: 0,
    })

    await app.close()
  })

  it('refuses a caller without ticketType:manage and a caller from another organisation', async () => {
    const { app, ids } = await createTestApp()
    const viewerToken = await signIn(app, 'finance@rangoli.example')
    const outsiderToken = await signIn(app, 'rival@dhol.example')

    const viewer = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.publishedEvent.id}/ticket-types`,
      headers: bearer(viewerToken),
      payload,
    })
    const outsider = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.publishedEvent.id}/ticket-types`,
      headers: bearer(outsiderToken),
      payload,
    })

    expect(viewer.statusCode).toBe(403)
    expect(outsider.statusCode).toBe(403)

    await app.close()
  })

  it('rejects a negative price and a maximum below the minimum', async () => {
    const { app, ids } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')

    const negative = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.publishedEvent.id}/ticket-types`,
      headers: bearer(token),
      payload: { ...payload, priceCents: -1 },
    })
    const inverted = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.publishedEvent.id}/ticket-types`,
      headers: bearer(token),
      payload: { ...payload, minPerOrder: 5, maxPerOrder: 2 },
    })

    expect(negative.statusCode).toBe(400)
    expect(inverted.statusCode).toBe(400)
    expect(inverted.json().error.issues[0].path).toBe('maxPerOrder')

    await app.close()
  })

  it('records who added the tier, in the same write', async () => {
    const { app, prisma, ids } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.publishedEvent.id}/ticket-types`,
      headers: bearer(token),
      payload,
    })

    expect(response.statusCode).toBe(201)

    const audit = prisma._store.auditLog.find(
      (row) =>
        row.action === 'event.ticket_type_added' &&
        row.metadata?.tierId === response.json().data.id,
    )

    expect(audit).toMatchObject({ entityType: 'Event', entityId: ids.publishedEvent.id })
    expect(audit.actorId).toBeTruthy()

    await app.close()
  })

  it('prices a tier given no currency in the event’s own, and refuses another one with 422', async () => {
    const { app, prisma, ids } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')

    for (const row of prisma._store.ticketType.filter((t) => t.eventId === ids.publishedEvent.id)) {
      row.currency = 'USD'
    }

    const defaulted = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.publishedEvent.id}/ticket-types`,
      headers: bearer(token),
      payload,
    })

    expect(defaulted.statusCode).toBe(201)
    expect(defaulted.json().data.currency).toBe('USD')

    const before = prisma._store.ticketType.length
    const mixed = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.publishedEvent.id}/ticket-types`,
      headers: bearer(token),
      payload: { ...payload, name: 'Rupee row', currency: 'INR' },
    })

    expect(mixed.statusCode).toBe(422)
    expect(mixed.json().error.problems).toEqual([
      'The other ticket types on this event are priced in USD, and an order is paid in one currency, so price this one in USD too.',
    ])
    expect(prisma._store.ticketType).toHaveLength(before)

    await app.close()
  })

  it('refuses a name another tier on the event has with 409 TIER_NAME_TAKEN, not a 500', async () => {
    const { app, prisma, ids } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')
    const before = prisma._store.ticketType.length

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.publishedEvent.id}/ticket-types`,
      headers: bearer(token),
      payload: { ...payload, name: ids.vip.name },
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().error.code).toBe('TIER_NAME_TAKEN')
    expect(response.json().error.message).toBe(
      `Another ticket type on this event is already called "${ids.vip.name}". Give this one a different name.`,
    )
    expect(prisma._store.ticketType).toHaveLength(before)

    await app.close()
  })

  it('answers 409 TIER_NAME_TAKEN when the index refuses a name taken since the check', async () => {
    const { app, prisma, ids } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')

    // The namesake lands between the route's read and its insert: the read
    // sees none, and the unique index is what refuses.
    const findFirst = prisma.ticketType.findFirst

    prisma.ticketType.findFirst = async (args) => {
      const row = await findFirst(args)

      prisma._store.ticketType.push({
        ...ids.vip,
        id: 'cracingnamesake0000000000',
        name: 'Balcony',
      })
      prisma.ticketType.findFirst = findFirst

      return row
    }

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.publishedEvent.id}/ticket-types`,
      headers: bearer(token),
      payload,
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().error.code).toBe('TIER_NAME_TAKEN')

    await app.close()
  })

  it('answers 404 for an unknown event', async () => {
    const { app } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')

    const response = await app.inject({
      method: 'POST',
      url: '/v1/events/cnosucheventatall000000z/ticket-types',
      headers: bearer(token),
      payload,
    })

    expect(response.statusCode).toBe(404)

    await app.close()
  })
})

describe('POST /v1/events/:eventId/ticket-types — the authoring path (SPEC2-XI X-A)', () => {
  /** A valid tier payload. */
  const tier = (eventId) => ({ eventId, name: 'Balcony', priceCents: 250_000, quantityTotal: 50 })

  it.each(['CANCELLED', 'COMPLETED', 'REVIEW_PENDING', 'DELETED'])(
    'refuses a %s event with 409 NOT_EDITABLE, writing nothing',
    async (status) => {
      const { app, prisma, ids } = await createTestApp()

      prisma._store.event.find((row) => row.id === ids.publishedEvent.id).status = status

      const before = prisma._store.ticketType.length
      const response = await app.inject({
        method: 'POST',
        url: `/v1/events/${ids.publishedEvent.id}/ticket-types`,
        headers: bearer(await signIn(app, 'arun@rangoli.example')),
        payload: tier(ids.publishedEvent.id),
      })

      expect(response.statusCode).toBe(409)
      expect(response.json().error.code).toBe('NOT_EDITABLE')
      expect(prisma._store.ticketType).toHaveLength(before)

      await app.close()
    },
  )

  it('refuses a SUPER_ADMIN who is not a member and has no editing sitting', async () => {
    const { app, ids } = await createTestApp()

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.publishedEvent.id}/ticket-types`,
      headers: bearer(await signIn(app, 'ops@desi-event.example')),
      payload: tier(ids.publishedEvent.id),
    })

    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('PLATFORM_EDIT_NOT_OPEN')

    await app.close()
  })

  it('bumps the event’s revision, and audits it with the new one', async () => {
    const { app, prisma, ids } = await createTestApp()
    const event = prisma._store.event.find((row) => row.id === ids.publishedEvent.id)
    const before = event.revision

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.publishedEvent.id}/ticket-types`,
      headers: bearer(await signIn(app, 'arun@rangoli.example')),
      payload: tier(ids.publishedEvent.id),
    })

    expect(response.statusCode).toBe(201)
    expect(event.revision).toBe(before + 1)

    const audit = prisma._store.auditLog.find(
      (row) =>
        row.action === 'event.ticket_type_added' &&
        row.metadata?.tierId === response.json().data.id,
    )

    expect(audit.metadata).toMatchObject({ revision: before + 1, mode: 'live' })

    await app.close()
  })
})

describe('POST /v1/events/:eventId/waitlist', () => {
  it('registers interest', async () => {
    const { app, ids } = await createTestApp()

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.publishedEvent.id}/waitlist`,
      payload: { eventId: ids.publishedEvent.id, email: 'hopeful@example.com', quantity: 2 },
    })

    expect(response.statusCode).toBe(201)
    expect(response.json().data).toMatchObject({
      eventId: ids.publishedEvent.id,
      email: 'hopeful@example.com',
      quantity: 2,
      notified: false,
    })

    await app.close()
  })

  it('returns the existing entry instead of creating a duplicate', async () => {
    const { app, prisma, ids } = await createTestApp()
    const payload = { eventId: ids.publishedEvent.id, email: 'hopeful@example.com' }
    const url = `/v1/events/${ids.publishedEvent.id}/waitlist`

    const first = await app.inject({ method: 'POST', url, payload })
    const second = await app.inject({ method: 'POST', url, payload: { ...payload, quantity: 4 } })

    expect(second.statusCode).toBe(201)
    expect(second.json().data.id).toBe(first.json().data.id)
    expect(prisma._store.waitlistEntry).toHaveLength(1)

    await app.close()
  })

  it('ignores an eventId in the body that contradicts the path', async () => {
    const { app, ids } = await createTestApp()

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.publishedEvent.id}/waitlist`,
      payload: { eventId: ids.onlineEvent.id, email: 'hopeful@example.com' },
    })

    expect(response.json().data.eventId).toBe(ids.publishedEvent.id)

    await app.close()
  })

  it('answers 404 for an unknown event', async () => {
    const { app } = await createTestApp()

    const response = await app.inject({
      method: 'POST',
      url: '/v1/events/cnosucheventatall000000z/waitlist',
      payload: { eventId: 'cnosucheventatall000000z', email: 'hopeful@example.com' },
    })

    expect(response.statusCode).toBe(404)

    await app.close()
  })

  // SPEC2-XI X-S (§8): only an event the public can see has a waiting list.
  it('answers an event that is not public, a deleted one included, as an unknown one', async () => {
    const { app, prisma, ids } = await createTestApp()

    prisma._store.event.find((row) => row.id === ids.publishedEvent.id).status = 'DELETED'

    for (const event of [ids.draftEvent, ids.reviewPendingEvent, ids.publishedEvent]) {
      const response = await app.inject({
        method: 'POST',
        url: `/v1/events/${event.id}/waitlist`,
        payload: { eventId: event.id, email: 'hopeful@example.com' },
      })

      expect(response.statusCode).toBe(404)
      expect(response.json().error.message).toBe('No such event.')
    }

    expect(prisma._store.waitlistEntry).toHaveLength(0)

    await app.close()
  })

  it('has no waiting list for an event that is over or was cancelled', async () => {
    const { app, prisma, ids } = await createTestApp()
    const event = prisma._store.event.find((row) => row.id === ids.publishedEvent.id)

    for (const status of ['CANCELLED', 'COMPLETED']) {
      event.status = status

      const response = await app.inject({
        method: 'POST',
        url: `/v1/events/${event.id}/waitlist`,
        payload: { eventId: event.id, email: 'hopeful@example.com' },
      })

      expect(response.statusCode, status).toBe(409)
      expect(response.json().error.message).toBe(
        'This event is over or was cancelled, so it has no waiting list.',
      )
    }

    await app.close()
  })
})

describe('GET /v1/events/:eventId/ticket-types, draft and hidden tiers', () => {
  /**
   * The published event with one draft tier and one hidden guest list added.
   *
   * @returns {Promise<object>} The harness and the two tier ids.
   */
  async function withPrivateTiers() {
    const harness = await createTestApp()
    const { prisma, ids } = harness
    const draftId = `${ids.generalAdmission.id.slice(0, -4)}dr01`
    const hiddenId = `${ids.generalAdmission.id.slice(0, -4)}hd01`

    prisma._store.ticketType.push(
      { ...ids.generalAdmission, id: draftId, name: 'Unannounced', status: 'DRAFT' },
      {
        ...ids.generalAdmission,
        id: hiddenId,
        name: 'Guest list',
        priceCents: 0,
        complimentary: true,
        visibility: 'HIDDEN',
      },
    )

    return { ...harness, draftId, hiddenId }
  }

  it('lists neither to a stranger', async () => {
    const { app, ids, draftId, hiddenId } = await withPrivateTiers()

    const response = await app.inject({
      method: 'GET',
      url: `/v1/events/${ids.publishedEvent.id}/ticket-types`,
    })

    expect(response.statusCode).toBe(200)

    const listed = response.json().data.map((tier) => tier.id)

    expect(listed).toContain(ids.generalAdmission.id)
    expect(listed).not.toContain(draftId)
    expect(listed).not.toContain(hiddenId)

    await app.close()
  })

  it('lists both to the organisation', async () => {
    const { app, ids, draftId, hiddenId } = await withPrivateTiers()
    const token = await signIn(app, 'arun@rangoli.example')

    const response = await app.inject({
      method: 'GET',
      url: `/v1/events/${ids.publishedEvent.id}/ticket-types`,
      headers: bearer(token),
    })

    const listed = response.json().data.map((tier) => tier.id)

    expect(listed).toEqual(expect.arrayContaining([draftId, hiddenId]))

    await app.close()
  })
})
