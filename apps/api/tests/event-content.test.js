/**
 * The event page's own content, the online-link rule, and what the public
 * payloads say about hidden and legacy tiers.
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc
 * namepath.
 *
 * @file @desi-event/api/tests/event-content
 */

import { describe, expect, it } from 'vitest'

import { eventDetailResponseSchema } from '@desi-event/schemas'

import { bearer, createTestApp, signIn } from './helpers/app.js'
import { auditRows, seedOrder } from './helpers/authoring-world.js'
import { cuid } from './helpers/prisma-stub.js'

const CONTENT = Object.freeze({
  faq: [{ question: 'Is there parking?', answer: 'Yes, on the north side.' }],
  performers: [
    { name: 'Asha Rao', role: 'Lead vocals', bio: 'Trained in Pune; ten years of garba nights.' },
    { name: 'The Dhol Collective', role: null, bio: null },
  ],
  runningOrder: [
    { time: '19:00', title: 'Doors open', note: null },
    { time: '19:30', title: 'First set', note: 'Beginners welcome.' },
  ],
  sponsors: [{ name: 'Chai Co', url: 'https://chai.example', level: 'Gold' }],
  socialLinks: {
    instagram: 'https://www.instagram.com/rangoli',
    website: 'https://rangoli.example',
  },
  dressCode: 'Festive; comfortable shoes for dancing.',
  directions: 'Use the east gate; parking on Level 2.',
  publicEmail: 'Box.Office@Rangoli.example',
  publicPhone: '+1 555 010 2000',
})

/**
 * PATCH an event with its current revision.
 *
 * @param {object} app The Fastify instance.
 * @param {object} prisma The stub.
 * @param {string} eventId The event.
 * @param {object} headers Authenticated headers.
 * @param {object} patch The change.
 * @returns {Promise<object>} The response.
 */
function patchEvent(app, prisma, eventId, headers, patch) {
  const revision = prisma._store.event.find((row) => row.id === eventId).revision

  return app.inject({
    method: 'PATCH',
    url: `/v1/events/${eventId}`,
    headers,
    payload: { revision, ...patch },
  })
}

describe('the event page content', () => {
  it('saves every content field on a draft and reads it back', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = bearer(await signIn(app, 'arun@rangoli.example'))

    const response = await patchEvent(app, prisma, ids.draftEvent.id, headers, CONTENT)

    expect(response.statusCode).toBe(200)

    const read = await app.inject({
      method: 'GET',
      url: `/v1/events/${ids.draftEvent.id}`,
      headers,
    })
    const data = read.json().data

    expect(data.faq).toEqual(CONTENT.faq)
    expect(data.performers).toEqual(CONTENT.performers)
    expect(data.runningOrder).toEqual(CONTENT.runningOrder)
    expect(data.sponsors).toEqual(CONTENT.sponsors)
    expect(data.socialLinks).toEqual(CONTENT.socialLinks)
    expect(data).toMatchObject({
      dressCode: CONTENT.dressCode,
      directions: CONTENT.directions,
      publicEmail: 'box.office@rangoli.example',
      publicPhone: '+1 555 010 2000',
    })

    // Stored in the public contact columns, never the private one.
    const row = prisma._store.event.find((event) => event.id === ids.draftEvent.id)

    expect(row.publicContactEmail).toBe('box.office@rangoli.example')
    expect(row.contactEmail ?? null).toBeNull()

    // The audit row names the fields, not their contents.
    const [audit] = auditRows(prisma, 'event.updated')

    expect(audit.metadata.fields).toEqual(
      expect.arrayContaining(['faq', 'performers', 'publicContactEmail']),
    )
    expect(JSON.stringify(audit.metadata)).not.toMatch(/parking|Asha|box\.office/i)

    await app.close()
  })

  it('keeps the names in artists in step with the line-up', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = bearer(await signIn(app, 'arun@rangoli.example'))
    const row = () => prisma._store.event.find((event) => event.id === ids.draftEvent.id)

    await patchEvent(app, prisma, ids.draftEvent.id, headers, { performers: CONTENT.performers })

    expect(row().artists).toEqual(['Asha Rao', 'The Dhol Collective'])

    // An older client that only knows the names keeps the bio it did not send.
    const artistsOnly = await patchEvent(app, prisma, ids.draftEvent.id, headers, {
      artists: ['The Dhol Collective', 'asha rao', 'A New Act'],
    })

    expect(artistsOnly.statusCode).toBe(200)
    expect(row().performers).toEqual([
      { name: 'The Dhol Collective', role: null, bio: null },
      { name: 'asha rao', role: 'Lead vocals', bio: 'Trained in Pune; ten years of garba nights.' },
      { name: 'A New Act', role: null, bio: null },
    ])

    await app.close()
  })

  it('treats the content of a live event as housekeeping: no confirmation, no notices', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = bearer(await signIn(app, 'arun@rangoli.example'))

    seedOrder(prisma, { eventId: ids.publishedEvent.id, ticketTypeId: ids.generalAdmission.id })

    const before = prisma._store.notificationOutbox.length
    const response = await patchEvent(app, prisma, ids.publishedEvent.id, headers, CONTENT)

    expect(response.statusCode).toBe(200)
    expect(prisma._store.notificationOutbox.length).toBe(before)

    await app.close()
  })

  it('refuses an http social link, a bad running-order time and an unknown network', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = bearer(await signIn(app, 'arun@rangoli.example'))

    for (const patch of [
      { socialLinks: { instagram: 'http://instagram.com/x' } },
      { socialLinks: { instagram: 'https://evil.example/instagram' } },
      { socialLinks: { tiktok: 'https://tiktok.com/@x' } },
      { runningOrder: [{ time: '7:30pm', title: 'Set' }] },
      { sponsors: [{ name: 'Bad', url: 'javascript:alert(1)' }] },
    ]) {
      const response = await patchEvent(app, prisma, ids.draftEvent.id, headers, patch)

      expect(response.statusCode, JSON.stringify(patch)).toBe(400)
    }

    await app.close()
  })
})

describe('an online event and its joining link', () => {
  it('lets a draft be online before its link is typed', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = bearer(await signIn(app, 'arun@rangoli.example'))

    const response = await patchEvent(app, prisma, ids.draftEvent.id, headers, {
      isOnline: true,
      onlineUrl: null,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.isOnline).toBe(true)

    await app.close()
  })

  it('refuses a live online event without its link (422)', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = bearer(await signIn(app, 'arun@rangoli.example'))

    const response = await patchEvent(app, prisma, ids.publishedEvent.id, headers, {
      isOnline: true,
      onlineUrl: null,
      confirmMaterialChange: true,
      changeReason: 'Moving online.',
    })

    expect(response.statusCode).toBe(422)
    expect(response.json().error.message).toBe('A published online event needs its joining link.')
    expect(prisma._store.event.find((row) => row.id === ids.publishedEvent.id).isOnline).toBe(false)

    await app.close()
  })
})

describe('what a stranger sees of the tiers', () => {
  it('serves a legacy tier the page can hold: description cut at 500, per order clamped', async () => {
    const { app, prisma, ids } = await createTestApp()
    const legacy = prisma._store.ticketType.find((row) => row.id === ids.generalAdmission.id)

    Object.assign(legacy, { description: 'd'.repeat(900), maxPerOrder: 100, minPerOrder: 60 })

    const response = await app.inject({ method: 'GET', url: '/v1/events/navratri-garba-night' })

    expect(response.statusCode).toBe(200)
    expect(eventDetailResponseSchema.safeParse(response.json()).success).toBe(true)

    const tier = response.json().data.ticketTypes.find((row) => row.id === ids.generalAdmission.id)

    expect(tier.description).toHaveLength(500)
    expect(tier.description.endsWith('…')).toBe(true)
    expect(tier).toMatchObject({ maxPerOrder: 50, minPerOrder: 50 })

    await app.close()
  })

  it('leaves a hidden tier off the public page and shows it to the organiser', async () => {
    const { app, prisma, ids } = await createTestApp()
    const hiddenId = cuid()

    prisma._store.ticketType.push({
      ...ids.generalAdmission,
      id: hiddenId,
      name: 'Guest list',
      priceCents: 0,
      complimentary: true,
      visibility: 'HIDDEN',
    })

    const anonymous = await app.inject({ method: 'GET', url: '/v1/events/navratri-garba-night' })

    expect(anonymous.json().data.ticketTypes.map((row) => row.id)).not.toContain(hiddenId)
    expect(anonymous.body).not.toMatch(/Guest list/)

    const headers = bearer(await signIn(app, 'arun@rangoli.example'))
    const insider = await app.inject({
      method: 'GET',
      url: '/v1/events/navratri-garba-night',
      headers,
    })

    expect(insider.json().data.ticketTypes.map((row) => row.id)).toContain(hiddenId)

    // The listing's "from" price is not the $0 guest list.
    const list = await app.inject({ method: 'GET', url: '/v1/events' })
    const card = list.json().data.find((row) => row.id === ids.publishedEvent.id)

    expect(card.minPriceCents).toBe(150_000)

    await app.close()
  })

  it('never publishes a redacted placeholder as a contact', async () => {
    const { app, prisma, ids } = await createTestApp()
    const row = prisma._store.event.find((event) => event.id === ids.publishedEvent.id)

    row.publicContactEmail = 'redacted-abc123@redacted.invalid'

    const response = await app.inject({ method: 'GET', url: '/v1/events/navratri-garba-night' })

    expect(response.json().data.publicEmail).toBeNull()

    await app.close()
  })
})
