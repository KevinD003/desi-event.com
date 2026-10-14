import { describe, expect, it } from 'vitest'

import { normaliseError } from '../src/lib/errors.js'
import { bearer, createTestApp, signIn, stepUp } from './helpers/app.js'
import {
  addRows,
  deletedEventFixture,
  makeWorld,
  minutesFromNow,
  threeNightEventFixture,
} from './helpers/fixtures.js'

/**
 * What a posted event takes, and who may make its lifecycle moves (SPEC2-XI
 * X-1, X-4, X-V, X-11, Rule L, X-E).
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc namepath.
 *
 * @file @desi-event/api/tests/event-live-editing
 */

/**
 * Sign in and confirm a second factor when the account has one.
 *
 * @param {object} app The app.
 * @param {string} email Who.
 * @param {object} [options] Options.
 * @param {boolean} [options.step] Whether to step up.
 * @returns {Promise<object>} The request headers.
 */
async function as(app, email, { step = true } = {}) {
  const headers = bearer(await signIn(app, email))

  if (step) await stepUp(app, email, headers)

  return headers
}

/**
 * PATCH an event at its current revision.
 *
 * @param {object} app The app.
 * @param {object} prisma The stub.
 * @param {string} eventId The event.
 * @param {object} headers Whose request.
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

describe('a finished or cancelled event takes its words and pictures only', () => {
  it.each(['COMPLETED', 'CANCELLED'])(
    'a %s event takes a new title, and refuses its date (409 naming it)',
    async (status) => {
      const { app, prisma, ids } = await createTestApp()

      prisma._store.event.find((row) => row.id === ids.publishedEvent.id).status = status

      const headers = await as(app, 'arun@rangoli.example', { step: false })
      const retitled = await patchEvent(app, prisma, ids.publishedEvent.id, headers, {
        title: 'Navratri Garba Night, as it was',
      })

      expect(retitled.statusCode).toBe(200)
      expect(retitled.json().data.title).toBe('Navratri Garba Night, as it was')

      const moved = await patchEvent(app, prisma, ids.publishedEvent.id, headers, {
        startsAt: minutesFromNow(60 * 24 * 40).toISOString(),
        endsAt: minutesFromNow(60 * 24 * 40 + 300).toISOString(),
        confirmMaterialChange: true,
        changeReason: 'Moved after the fact',
      })

      expect(moved.statusCode).toBe(409)
      expect(moved.json().error.code).toBe('NOT_EDITABLE')
      expect(moved.json().error.message).toMatch(/final for its nights and tickets/)
      // Naming what stays as it was.
      expect(moved.json().error.message).toMatch(
        /These stay as ticket holders were told them: .+\./,
      )

      // Its nights and tickets are closed.
      const tier = await app.inject({
        method: 'POST',
        url: `/v1/events/${ids.publishedEvent.id}/tiers`,
        headers,
        payload: {
          revision: prisma._store.event.find((row) => row.id === ids.publishedEvent.id).revision,
          name: 'Late entry',
          priceCents: 1000,
          quantityTotal: 10,
        },
      })

      expect(tier.statusCode).toBe(409)
      expect(tier.json().error.message).toMatch(/final/)

      await app.close()
    },
  )
})

describe('the venue of an event with seated nights', () => {
  it('refuses a new venue while a night has a seating map (VENUE_HAS_SEATING)', async () => {
    const { app, prisma, ids } = await createTestApp()

    prisma._store.eventSession.find((row) => row.eventId === ids.draftEvent.id).venueMapVersionId =
      'cmapversionplaceholder0000'

    const response = await patchEvent(
      app,
      prisma,
      ids.draftEvent.id,
      await as(app, 'arun@rangoli.example', { step: false }),
      { venueId: ids.otherVenue.id },
    )

    expect(response.statusCode).toBe(409)
    expect(response.json().error.code).toBe('VENUE_HAS_SEATING')
    expect(response.json().error.message).toMatch(
      /^The nights of this event use Nehru Centre's seating map\./,
    )

    await app.close()
  })
})

describe('a deleted event’s web address', () => {
  it('stays retired for a rename too (SLUG_RETIRED)', async () => {
    const world = await makeWorld()
    const fixture = deletedEventFixture(world.ids)

    addRows(world.seed, fixture.rows)

    const { app, prisma, ids } = await createTestApp({ seed: world.seed, ids: world.ids })
    const response = await patchEvent(
      app,
      prisma,
      ids.draftEvent.id,
      await as(app, 'arun@rangoli.example', { step: false }),
      { slug: fixture.event.slug },
    )

    expect(response.statusCode).toBe(409)
    expect(response.json().error.code).toBe('SLUG_RETIRED')

    await app.close()
  })
})

describe('a cancelled night', () => {
  /**
   * The three-night event with its second night cancelled.
   *
   * @returns {Promise<object>} The harness and the fixture.
   */
  async function cancelledNight() {
    const world = await makeWorld()
    const fixture = threeNightEventFixture(world.ids)

    Object.assign(fixture.nights[1], {
      status: 'CANCELLED',
      cancelledAt: new Date(),
      cancellationReason: 'The band could not travel.',
    })
    addRows(world.seed, fixture.rows)

    return { ...(await createTestApp({ seed: world.seed, ids: world.ids })), fixture }
  }

  it('takes no change, no new tier and no seats', async () => {
    const { app, prisma, fixture } = await cancelledNight()
    const headers = await as(app, 'arun@rangoli.example', { step: false })
    const revision = () => prisma._store.event.find((row) => row.id === fixture.event.id).revision

    const renamed = await app.inject({
      method: 'PATCH',
      url: `/v1/events/${fixture.event.id}/sessions/${fixture.nights[1].id}`,
      headers,
      payload: { revision: revision(), label: 'Night two, again' },
    })

    expect(renamed.statusCode).toBe(409)
    expect(renamed.json().error.code).toBe('NOT_EDITABLE')

    const tier = await app.inject({
      method: 'POST',
      url: `/v1/events/${fixture.event.id}/tiers`,
      headers,
      payload: {
        revision: revision(),
        name: 'Night 2 late entry',
        priceCents: 1000,
        quantityTotal: 10,
        eventSessionId: fixture.nights[1].id,
      },
    })

    expect(tier.statusCode).toBe(409)
    expect(tier.json().error.message).toBe('This night was cancelled.')

    const seats = await app.inject({
      method: 'POST',
      url: `/v1/events/${fixture.event.id}/prepare-inventory`,
      headers,
      payload: { eventSessionId: fixture.nights[1].id },
    })

    expect(seats.statusCode).toBe(409)

    await app.close()
  })

  it('is not counted as a night the event still has', async () => {
    const world = await makeWorld()
    const fixture = threeNightEventFixture(world.ids)

    // Two nights cancelled, and nothing sold for the third: it is the last.
    for (const night of fixture.nights.slice(0, 2)) {
      Object.assign(night, { status: 'CANCELLED', cancelledAt: new Date() })
    }
    fixture.rows.order = []
    fixture.rows.orderItem = []
    fixture.rows.payment = []
    fixture.rows.ticket = []
    for (const tier of fixture.rows.ticketType) tier.quantitySold = 0
    addRows(world.seed, fixture.rows)

    const { app, prisma } = await createTestApp({ seed: world.seed, ids: world.ids })
    const revision = prisma._store.event.find((row) => row.id === fixture.event.id).revision
    const response = await app.inject({
      method: 'DELETE',
      url: `/v1/events/${fixture.event.id}/sessions/${fixture.nights[2].id}?revision=${revision}`,
      headers: await as(app, 'arun@rangoli.example', { step: false }),
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().error.code).toBe('LAST_SESSION')

    await app.close()
  })
})

describe('Rule L: the organiser’s lifecycle moves', () => {
  it('refuses a platform ADMIN with ORGANIZER_ONLY, the reschedule included', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await as(app, 'anil@desi-event.example')

    prisma._store.event.find((row) => row.id === ids.publishedEvent.id).status = 'ON_SALE'

    const paused = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.publishedEvent.id}/pause-sales`,
      headers,
      payload: {},
    })

    expect(paused.statusCode).toBe(403)
    expect(paused.json().error.code).toBe('ORGANIZER_ONLY')

    prisma._store.event.find((row) => row.id === ids.publishedEvent.id).status = 'POSTPONED'

    const rescheduled = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.publishedEvent.id}/reschedule`,
      headers,
      payload: {
        revision: 0,
        startsAt: minutesFromNow(60 * 24 * 50).toISOString(),
        endsAt: minutesFromNow(60 * 24 * 50 + 300).toISOString(),
        resume: 'PUBLISHED',
        confirm: true,
        reason: 'The new date the organiser chose.',
      },
    })

    expect(rescheduled.statusCode).toBe(403)
    expect(rescheduled.json().error.code).toBe('ORGANIZER_ONLY')

    await app.close()
  })

  it('lets a SUPER_ADMIN who is not a member make the move, audited as the team at The Desi Events', async () => {
    const { app, prisma, ids } = await createTestApp()

    prisma._store.event.find((row) => row.id === ids.publishedEvent.id).status = 'ON_SALE'

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.publishedEvent.id}/pause-sales`,
      headers: await as(app, 'ops@desi-event.example'),
      payload: {},
    })

    expect(response.statusCode).toBe(200)

    const audit = prisma._store.auditLog.find((entry) => entry.action === 'event.sales_paused')

    expect(audit.metadata).toMatchObject({ authority: 'PLATFORM', from: 'ON_SALE' })

    // An owner's move names no authority.
    const resumed = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.publishedEvent.id}/open-sales`,
      headers: await as(app, 'owner@rangoli.example'),
      payload: {},
    })

    if (resumed.statusCode === 200) {
      const own = prisma._store.auditLog.find((entry) => entry.action === 'event.on_sale')

      expect(own.metadata).not.toHaveProperty('authority')
    }

    await app.close()
  })
})

describe('a write that lost to another (SPEC2-XI X-E)', () => {
  it('answers a deadlock or a write conflict with 409 TRY_AGAIN', () => {
    for (const code of ['40P01', 'P2034']) {
      expect(normaliseError(Object.assign(new Error('deadlock detected'), { code }))).toMatchObject(
        {
          statusCode: 409,
          code: 'TRY_AGAIN',
          message: 'Another change to this event was being saved at the same moment. Try again.',
        },
      )
    }

    const nested = Object.assign(new Error('Transaction failed'), {
      code: 'P2010',
      meta: { driverAdapterError: { cause: { originalCode: '40P01' } } },
    })

    expect(normaliseError(nested).code).toBe('TRY_AGAIN')
  })

  it('answers a deletion or night guard with 409 CONFLICT, and a replacement cover’s with MEDIA_CHANGED', () => {
    const refusal = (constraint) =>
      Object.assign(new Error(`violates (${constraint})`), { code: '23514' })

    expect(normaliseError(refusal('event_restore_returns_prior_status'))).toMatchObject({
      statusCode: 409,
      code: 'CONFLICT',
    })
    expect(normaliseError(refusal('event_session_cancellation_final')).code).toBe('CONFLICT')
    expect(normaliseError(refusal('media_asset_replacement_shape')).code).toBe('MEDIA_CHANGED')
  })
})
