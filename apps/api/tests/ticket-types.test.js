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
})
