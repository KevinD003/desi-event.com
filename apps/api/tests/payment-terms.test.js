/**
 * An event's booking fee and its pay-at-the-venue switch, against the stub
 * (SPEC3 §7, §9.1, §14.2; SPEC3-XI §1.2): who may set them, in which states,
 * the compare-and-set, the refusals, the audit rows and history, what an
 * organiser and the public read, and the one currency an event's own fee
 * holds its tiers to (DF3).
 *
 * @module @desi-event/api/tests/payment-terms
 */

import { describe, expect, it } from 'vitest'

import { computeOrderTotals } from '@desi-event/pricing'
import { EVENT_STATUSES } from '@desi-event/schemas'

import { setVenuePayment } from '../src/lib/payment-terms.js'
import { bearer, createTestApp, feeConfig, signIn, stepUp, taxRateBps } from './helpers/app.js'
import {
  addRows,
  makeWorld,
  paymentTermsAccountsFixture,
  platformHeldImportFixture,
  venueCancellationAccountsFixture,
} from './helpers/fixtures.js'
import { createPrismaStub, cuid } from './helpers/prisma-stub.js'

/** A reason inside the 10-500 character bounds. */
const REASON = 'The organiser asked for a lower booking fee.'

/** The site default for INR in the test environment: 5.90% and 99 paise a ticket. */
const SITE_DEFAULT = Object.freeze({ percentageBps: 590, flatCentsPerTicket: 99 })

/**
 * A world with SPEC3's and SPEC3-XI's extra accounts, and a SUPPORT account.
 *
 * @returns {Promise<{seed: object, ids: object}>} The world.
 */
async function world() {
  const built = await makeWorld()
  const support = {
    id: cuid(),
    email: 'sunil-support@desi-event.example',
    passwordHash: built.ids.attendee.passwordHash,
    displayName: 'Sunil Support',
    phone: null,
    locale: 'en-IN',
    role: 'SUPPORT',
    emailVerified: true,
    createdAt: new Date('2025-01-02T00:00:00.000Z'),
    updatedAt: new Date('2025-01-02T00:00:00.000Z'),
  }

  addRows(built.seed, paymentTermsAccountsFixture(built.ids).rows)
  addRows(built.seed, venueCancellationAccountsFixture(built.ids).rows)
  addRows(built.seed, { user: [support] })

  return built
}

/**
 * Sign in and confirm a second factor.
 *
 * @param {object} app The app.
 * @param {string} email Who.
 * @returns {Promise<object>} The request headers.
 */
async function as(app, email) {
  const headers = bearer(await signIn(app, email))

  await stepUp(app, email, headers)

  return headers
}

/**
 * Set an event's booking fee.
 *
 * @param {object} app The app.
 * @param {string} eventId The event.
 * @param {object} headers Whose request.
 * @param {object} body The body.
 * @returns {Promise<object>} The response.
 */
function setFee(app, eventId, headers, body) {
  return app.inject({
    method: 'POST',
    url: `/v1/platform/events/${eventId}/platform-fee`,
    headers,
    payload: { reason: REASON, ...body },
  })
}

/**
 * Switch paying at the venue.
 *
 * @param {object} app The app.
 * @param {string} eventId The event.
 * @param {object} headers Whose request.
 * @param {object} body The body.
 * @returns {Promise<object>} The response.
 */
function setVenue(app, eventId, headers, body) {
  return app.inject({
    method: 'POST',
    url: `/v1/platform/events/${eventId}/venue-payment`,
    headers,
    payload: { reason: REASON, ...body },
  })
}

/**
 * Read an event's payment terms as an administrator.
 *
 * @param {object} app The app.
 * @param {string} eventId The event.
 * @param {object} headers Whose request.
 * @param {string} [query] A query string.
 * @returns {Promise<object>} The response.
 */
function terms(app, eventId, headers, query = '') {
  return app.inject({
    method: 'GET',
    url: `/v1/platform/events/${eventId}/payment-terms${query}`,
    headers,
  })
}

/**
 * An event row in the stub.
 *
 * @param {object} prisma The stub.
 * @param {string} id The event.
 * @returns {object} The row.
 */
function eventRow(prisma, id) {
  return prisma._store.event.find((row) => row.id === id)
}

describe('who sets an event’s booking fee and pay-at-the-venue switch', () => {
  it('lets ADMIN and SUPER_ADMIN, and nobody else', async () => {
    const { seed, ids } = await world()
    const { app } = await createTestApp({ seed, ids })
    const eventId = ids.publishedEvent.id

    for (const [email, sequence] of [
      ['anil@desi-event.example', 0],
      ['ops@desi-event.example', 1],
    ]) {
      const headers = await as(app, email)

      expect((await terms(app, eventId, headers)).statusCode, email).toBe(200)
      expect(
        (
          await setFee(app, eventId, headers, {
            source: 'EVENT',
            percentageBps: 300 + sequence,
            flatCentsPerTicket: 149,
            expectedSequence: sequence,
          })
        ).statusCode,
        email,
      ).toBe(200)
    }

    for (const email of [
      'maya@desi-event.example',
      'farah-finance@desi-event.example',
      'sunil-support@desi-event.example',
      'owner@rangoli.example',
      'priya@example.com',
    ]) {
      const headers = bearer(await signIn(app, email))

      for (const response of [
        await terms(app, eventId, headers),
        await setFee(app, eventId, headers, { source: 'SITE_DEFAULT', expectedSequence: 2 }),
        await setVenue(app, eventId, headers, {
          enabled: true,
          limit: 50,
          seen: { enabled: false, limit: null },
        }),
      ]) {
        expect(response.statusCode, email).toBe(403)
      }
    }

    await app.close()
  })

  it('asks for a second factor within the PAYMENT_TERMS window to change either, and none to read', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = bearer(await signIn(app, 'anil@desi-event.example'))

    // The factor given at sign-in, moved back past the ten-minute window.
    for (const session of prisma._store.session) {
      session.mfaSatisfiedAt = new Date(Date.now() - 11 * 60_000)
    }

    expect((await terms(app, ids.publishedEvent.id, headers)).statusCode).toBe(200)

    for (const response of [
      await setFee(app, ids.publishedEvent.id, headers, {
        source: 'SITE_DEFAULT',
        expectedSequence: 0,
      }),
      await setVenue(app, ids.publishedEvent.id, headers, {
        enabled: true,
        limit: 50,
        seen: { enabled: false, limit: null },
      }),
    ]) {
      expect(response.statusCode).toBe(403)
      expect(response.json().error.code).toBe('STEP_UP_REQUIRED')
    }

    expect(eventRow(prisma, ids.publishedEvent.id).venuePaymentEnabled).toBe(false)

    await app.close()
  })

  it('refuses a member of the event’s organisation with CONFLICT_OF_INTEREST, changing nothing', async () => {
    const { seed, ids } = await world()
    const { app, prisma } = await createTestApp({ seed, ids })
    // A platform ADMIN who is also a VIEWER of the organisation.
    const headers = await as(app, 'neha-admin@desi-event.example')

    for (const response of [
      await setFee(app, ids.publishedEvent.id, headers, {
        source: 'EVENT',
        percentageBps: 300,
        flatCentsPerTicket: 0,
        expectedSequence: 0,
      }),
      await setVenue(app, ids.publishedEvent.id, headers, {
        enabled: true,
        limit: 50,
        seen: { enabled: false, limit: null },
      }),
    ]) {
      expect(response.statusCode).toBe(403)
      expect(response.json().error.code).toBe('CONFLICT_OF_INTEREST')
    }

    expect(eventRow(prisma, ids.publishedEvent.id)).toMatchObject({
      feeSource: 'SITE_DEFAULT',
      venuePaymentEnabled: false,
    })
    expect(prisma._store.eventFeeSetting).toHaveLength(0)
    expect(prisma._store.eventVenuePaymentChange).toHaveLength(0)

    await app.close()
  })

  it('takes a reason of 10 to 500 characters', async () => {
    const { app, ids } = await createTestApp()
    const headers = await as(app, 'anil@desi-event.example')
    const body = { source: 'EVENT', percentageBps: 300, flatCentsPerTicket: 0, expectedSequence: 0 }

    expect(
      (await setFee(app, ids.publishedEvent.id, headers, { ...body, reason: 'Too short' }))
        .statusCode,
    ).toBe(400)
    expect(
      (await setFee(app, ids.publishedEvent.id, headers, { ...body, reason: 'x'.repeat(501) }))
        .statusCode,
    ).toBe(400)
    expect(
      (await setFee(app, ids.publishedEvent.id, headers, { ...body, reason: 'Ten chars.' }))
        .statusCode,
    ).toBe(200)

    await app.close()
  })
})

describe('when they may be set', () => {
  it('in every status but DELETED, iterated from the enum, never frozen at go-live', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await as(app, 'anil@desi-event.example')
    const eventId = ids.publishedEvent.id
    let sequence = 0
    let enabled = false

    for (const status of EVENT_STATUSES.filter((value) => value !== 'DELETED')) {
      eventRow(prisma, eventId).status = status

      const fee = await setFee(app, eventId, headers, {
        source: 'EVENT',
        percentageBps: 100 + sequence,
        flatCentsPerTicket: 50,
        expectedSequence: sequence,
      })

      expect(fee.statusCode, status).toBe(200)
      expect(fee.json().data.eventStatus).toBe(status)
      sequence += 1

      const venue = await setVenue(app, eventId, headers, {
        enabled: !enabled,
        limit: 20,
        seen: { enabled, limit: enabled ? 20 : sequence === 1 ? null : 20 },
      })

      expect(venue.statusCode, status).toBe(200)
      enabled = !enabled
    }

    await app.close()
  })

  it('refuses a deleted event with NOT_EDITABLE, keeping its settings for a restore', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await as(app, 'anil@desi-event.example')
    const eventId = ids.publishedEvent.id

    expect(
      (
        await setFee(app, eventId, headers, {
          source: 'EVENT',
          percentageBps: 300,
          flatCentsPerTicket: 149,
          expectedSequence: 0,
        })
      ).statusCode,
    ).toBe(200)

    Object.assign(eventRow(prisma, eventId), {
      status: 'DELETED',
      statusBeforeDeletion: 'PUBLISHED',
    })

    for (const response of [
      await setFee(app, eventId, headers, { source: 'SITE_DEFAULT', expectedSequence: 1 }),
      await setVenue(app, eventId, headers, {
        enabled: true,
        limit: 50,
        seen: { enabled: false, limit: null },
      }),
    ]) {
      expect(response.statusCode).toBe(409)
      expect(response.json().error.code).toBe('NOT_EDITABLE')
      expect(response.json().error.message).toBe(
        'This event was deleted. Restore it first; its booking fee comes back as it was.',
      )
    }

    // Still readable, and as it was.
    const read = await terms(app, eventId, headers)

    expect(read.statusCode).toBe(200)
    expect(read.json().data.fee).toMatchObject({
      source: 'EVENT',
      percentageBps: 300,
      flatCentsPerTicket: 149,
      sequence: 1,
    })
    expect(read.json().data.posted).toBe(true)

    await app.close()
  })

  it('sets the booking fee of an import the team holds like any event’s, and never turns paying at its door on', async () => {
    // Imported events are sold on The Desi Events (2026-10-15): the booking
    // fee and its rules apply to them as to any event, so SOLD_ON_SOURCE is
    // gone. Nobody takes money at their door, so paying there stays off.
    const built = await makeWorld()
    const imported = platformHeldImportFixture(built.ids, { status: 'PUBLISHED' })

    addRows(built.seed, imported.rows)

    const { app } = await createTestApp({ seed: built.seed, ids: built.ids })
    const headers = await as(app, 'anil@desi-event.example')

    const fee = await setFee(app, imported.event.id, headers, {
      source: 'EVENT',
      percentageBps: 300,
      flatCentsPerTicket: 0,
      expectedSequence: 0,
    })

    expect(fee.statusCode, fee.body).toBe(200)

    const venue = await setVenue(app, imported.event.id, headers, {
      enabled: true,
      limit: 50,
      seen: { enabled: false, limit: null },
    })

    expect(venue.statusCode).toBe(409)
    expect(venue.json().error.code).toBe('VENUE_PAYMENT_UNAVAILABLE')

    const read = (await terms(app, imported.event.id, headers)).json().data

    // The fee is the event's own, in the currency its tiers are priced in.
    expect(read.fee).toMatchObject({ source: 'EVENT', percentageBps: 300, currency: 'USD' })
    expect(read.venuePayment.enabled).toBe(false)
    expect(read).not.toHaveProperty('soldOnSource')

    await app.close()
  })

  it('answers 404 for an event that does not exist', async () => {
    const { app } = await createTestApp()
    const headers = await as(app, 'anil@desi-event.example')
    const eventId = cuid()

    expect((await terms(app, eventId, headers)).statusCode).toBe(404)
    expect(
      (await setFee(app, eventId, headers, { source: 'SITE_DEFAULT', expectedSequence: 0 }))
        .statusCode,
    ).toBe(404)

    await app.close()
  })
})

describe('the booking fee', () => {
  it('sets the event’s own terms in its currency, then returns them to the site default', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await as(app, 'anil@desi-event.example')
    const eventId = ids.publishedEvent.id
    const revisionBefore = eventRow(prisma, eventId).revision

    const own = await setFee(app, eventId, headers, {
      source: 'EVENT',
      percentageBps: 300,
      flatCentsPerTicket: 149,
      expectedSequence: 0,
    })

    expect(own.statusCode).toBe(200)
    expect(own.headers['cache-control']).toBe('no-store, private')
    expect(own.json().data.fee).toMatchObject({
      source: 'EVENT',
      percentageBps: 300,
      flatCentsPerTicket: 149,
      currency: 'INR',
      sequence: 1,
      changedByName: 'Anil Administrator',
      reason: REASON,
    })
    expect(own.json().data.siteDefault).toEqual({ currency: 'INR', ...SITE_DEFAULT })

    const setting = prisma._store.eventFeeSetting[0]

    expect(eventRow(prisma, eventId)).toMatchObject({
      feeSource: 'EVENT',
      feePercentageBps: 300,
      feeFlatCentsPerTicket: 149,
      feeCurrency: 'INR',
      feeSettingId: setting.id,
    })
    expect(setting).toMatchObject({
      eventId,
      sequence: 1,
      source: 'EVENT',
      currency: 'INR',
      setById: ids.platformAdministrator.id,
    })

    const back = await setFee(app, eventId, headers, {
      source: 'SITE_DEFAULT',
      expectedSequence: 1,
    })

    expect(back.statusCode).toBe(200)
    expect(back.json().data.fee).toMatchObject({ source: 'SITE_DEFAULT', ...SITE_DEFAULT })
    expect(eventRow(prisma, eventId)).toMatchObject({
      feeSource: 'SITE_DEFAULT',
      feePercentageBps: null,
      feeFlatCentsPerTicket: null,
      feeCurrency: null,
      feeSettingId: null,
    })
    // DF7: an organiser's open editor is not made stale.
    expect(eventRow(prisma, eventId).revision).toBe(revisionBefore)

    await app.close()
  })

  it('compares and sets on the newest decision’s sequence, and refuses the same terms again', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await as(app, 'anil@desi-event.example')
    const eventId = ids.publishedEvent.id
    const body = { source: 'EVENT', percentageBps: 300, flatCentsPerTicket: 149 }

    expect((await setFee(app, eventId, headers, { ...body, expectedSequence: 0 })).statusCode).toBe(
      200,
    )

    const stale = await setFee(app, eventId, headers, {
      ...body,
      percentageBps: 250,
      expectedSequence: 0,
    })

    expect(stale.statusCode).toBe(409)
    expect(stale.json().error).toMatchObject({
      code: 'PAYMENT_TERMS_CHANGED',
      details: { currentSequence: 1 },
    })

    const same = await setFee(app, eventId, headers, { ...body, expectedSequence: 1 })

    expect(same.statusCode).toBe(409)
    expect(same.json().error).toMatchObject({
      code: 'PLATFORM_FEE_UNCHANGED',
      message: 'The booking fee is already set to that. Nothing was changed.',
    })

    const siteAgain = await setFee(app, ids.draftEvent.id, headers, {
      source: 'SITE_DEFAULT',
      expectedSequence: 0,
    })

    expect(siteAgain.json().error.code).toBe('PLATFORM_FEE_UNCHANGED')
    expect(prisma._store.eventFeeSetting).toHaveLength(1)

    await app.close()
  })

  it('takes 0% and nothing per ticket as an event with no booking fee, and the bounds as bounds', async () => {
    const { app, ids } = await createTestApp()
    const headers = await as(app, 'anil@desi-event.example')
    const eventId = ids.publishedEvent.id

    for (const [percentageBps, flatCentsPerTicket, status] of [
      [3001, 0, 400],
      [0, 10_001, 400],
      [-1, 0, 400],
      [0, 0, 200],
    ]) {
      const response = await setFee(app, eventId, headers, {
        source: 'EVENT',
        percentageBps,
        flatCentsPerTicket,
        expectedSequence: 0,
      })

      expect(response.statusCode, `${percentageBps} ${flatCentsPerTicket}`).toBe(status)
    }

    expect(
      (
        await setFee(app, eventId, headers, {
          source: 'EVENT',
          percentageBps: 3000,
          flatCentsPerTicket: 10_000,
          expectedSequence: 1,
        })
      ).statusCode,
    ).toBe(200)

    await app.close()
  })

  it('audits the change with the previous terms, never more', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await as(app, 'anil@desi-event.example')
    const eventId = ids.publishedEvent.id

    await setFee(app, eventId, headers, {
      source: 'EVENT',
      percentageBps: 300,
      flatCentsPerTicket: 149,
      expectedSequence: 0,
    })
    await setFee(app, eventId, headers, { source: 'SITE_DEFAULT', expectedSequence: 1 })

    const audits = prisma._store.auditLog.filter(
      (row) => row.action === 'event.platform_fee_changed',
    )

    expect(audits).toHaveLength(2)
    expect(audits[0]).toMatchObject({
      entityType: 'Event',
      entityId: eventId,
      actorId: ids.platformAdministrator.id,
    })
    expect(audits[0].metadata).toEqual({
      sequence: 1,
      source: 'EVENT',
      percentageBps: 300,
      flatCentsPerTicket: 149,
      currency: 'INR',
      previous: null,
      reason: REASON,
      eventStatus: 'PUBLISHED',
      platformRole: 'ADMIN',
    })
    expect(audits[1].metadata).toEqual({
      sequence: 2,
      source: 'SITE_DEFAULT',
      percentageBps: null,
      flatCentsPerTicket: null,
      currency: null,
      previous: {
        sequence: 1,
        source: 'EVENT',
        percentageBps: 300,
        flatCentsPerTicket: 149,
        currency: 'INR',
      },
      reason: REASON,
      eventStatus: 'PUBLISHED',
      platformRole: 'ADMIN',
    })

    await app.close()
  })
})

describe('paying at the venue', () => {
  it('switches on with a limit, changes the limit, and switches off keeping it', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await as(app, 'anil@desi-event.example')
    const eventId = ids.publishedEvent.id

    const on = await setVenue(app, eventId, headers, {
      enabled: true,
      limit: 50,
      seen: { enabled: false, limit: null },
    })

    expect(on.statusCode).toBe(200)
    expect(on.json().data.venuePayment).toMatchObject({
      enabled: true,
      limit: 50,
      offered: true,
      changedByName: 'Anil Administrator',
      reason: REASON,
      hasOrders: false,
      unpaidTickets: 0,
      paidAtDoorTickets: 0,
      paidAtDoorCents: 0,
    })

    expect(
      (
        await setVenue(app, eventId, headers, {
          enabled: true,
          limit: 80,
          seen: { enabled: true, limit: 50 },
        })
      ).statusCode,
    ).toBe(200)

    const off = await setVenue(app, eventId, headers, {
      enabled: false,
      seen: { enabled: true, limit: 80 },
    })

    expect(off.statusCode).toBe(200)
    expect(off.json().data.venuePayment).toMatchObject({
      enabled: false,
      limit: 80,
      offered: false,
    })
    expect(prisma._store.eventVenuePaymentChange.map((row) => [row.enabled, row.limit])).toEqual([
      [true, 50],
      [true, 80],
      [false, 80],
    ])

    const audits = prisma._store.auditLog.filter(
      (row) => row.action === 'event.venue_payment_changed',
    )

    expect(audits.map((row) => row.metadata)).toEqual([
      {
        enabled: true,
        limit: 50,
        previousEnabled: false,
        previousLimit: null,
        reason: REASON,
        eventStatus: 'PUBLISHED',
        platformRole: 'ADMIN',
      },
      {
        enabled: true,
        limit: 80,
        previousEnabled: true,
        previousLimit: 50,
        reason: REASON,
        eventStatus: 'PUBLISHED',
        platformRole: 'ADMIN',
      },
      {
        enabled: false,
        limit: 80,
        previousEnabled: true,
        previousLimit: 80,
        reason: REASON,
        eventStatus: 'PUBLISHED',
        platformRole: 'ADMIN',
      },
    ])

    await app.close()
  })

  it('refuses turning it on for an online event, and allows turning it off there', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await as(app, 'anil@desi-event.example')
    const eventId = ids.onlineEvent.id

    const on = await setVenue(app, eventId, headers, {
      enabled: true,
      limit: 50,
      seen: { enabled: false, limit: null },
    })

    expect(on.statusCode).toBe(422)
    expect(on.json().error.code).toBe('VENUE_PAYMENT_ONLINE_EVENT')

    // A switch left on when the event became online.
    Object.assign(eventRow(prisma, eventId), {
      venuePaymentEnabled: true,
      venuePaymentLimit: 10,
      venuePaymentChangedAt: new Date(),
    })

    const off = await setVenue(app, eventId, headers, {
      enabled: false,
      seen: { enabled: true, limit: 10 },
    })

    expect(off.statusCode).toBe(200)
    expect(eventRow(prisma, eventId).venuePaymentEnabled).toBe(false)

    await app.close()
  })

  it('needs a limit to turn it on: 400 at the door of the route, VENUE_LIMIT_REQUIRED in the service', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await as(app, 'anil@desi-event.example')

    expect(
      (
        await setVenue(app, ids.publishedEvent.id, headers, {
          enabled: true,
          seen: { enabled: false, limit: null },
        })
      ).statusCode,
    ).toBe(400)

    const refused = await setVenuePayment(prisma, {
      eventId: ids.publishedEvent.id,
      enabled: true,
      limit: null,
      reason: REASON,
      seen: { enabled: false, limit: null },
      actor: { id: ids.platformAdministrator.id, role: 'ADMIN', memberships: [] },
    }).catch((error) => error)

    expect(refused.statusCode).toBe(422)
    expect(refused.code).toBe('VENUE_LIMIT_REQUIRED')
    expect(eventRow(prisma, ids.publishedEvent.id).venuePaymentEnabled).toBe(false)

    await app.close()
  })

  it('compares and sets on what the administrator saw, and refuses the same setting again', async () => {
    const { app, ids } = await createTestApp()
    const headers = await as(app, 'anil@desi-event.example')
    const eventId = ids.publishedEvent.id

    await setVenue(app, eventId, headers, {
      enabled: true,
      limit: 50,
      seen: { enabled: false, limit: null },
    })

    const stale = await setVenue(app, eventId, headers, {
      enabled: true,
      limit: 60,
      seen: { enabled: false, limit: null },
    })

    expect(stale.statusCode).toBe(409)
    expect(stale.json().error.code).toBe('PAYMENT_TERMS_CHANGED')

    const same = await setVenue(app, eventId, headers, {
      enabled: true,
      limit: 50,
      seen: { enabled: true, limit: 50 },
    })

    expect(same.statusCode).toBe(409)
    expect(same.json().error.code).toBe('VENUE_PAYMENT_UNCHANGED')

    await app.close()
  })
})

describe('the history', () => {
  it('lists both kinds of decision newest first, and pages back with before', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await as(app, 'anil@desi-event.example')
    const eventId = ids.publishedEvent.id

    await setFee(app, eventId, headers, {
      source: 'EVENT',
      percentageBps: 300,
      flatCentsPerTicket: 149,
      expectedSequence: 0,
    })
    await setVenue(app, eventId, headers, {
      enabled: true,
      limit: 50,
      seen: { enabled: false, limit: null },
    })
    await setFee(app, eventId, headers, { source: 'SITE_DEFAULT', expectedSequence: 1 })

    // Spread the three decisions out, oldest first, so the order is the
    // stored times' and not the insertion order.
    const base = Date.now() - 60_000
    const [first, third] = prisma._store.eventFeeSetting
    const [second] = prisma._store.eventVenuePaymentChange

    first.createdAt = new Date(base)
    second.createdAt = new Date(base + 1_000)
    third.createdAt = new Date(base + 2_000)

    const read = (await terms(app, eventId, headers)).json().data

    expect(read.history.map((entry) => entry.kind)).toEqual(['FEE', 'VENUE_PAYMENT', 'FEE'])
    expect(read.history[0]).toMatchObject({
      kind: 'FEE',
      source: 'SITE_DEFAULT',
      percentageBps: null,
      sequence: 2,
      byName: 'Anil Administrator',
      reason: REASON,
    })
    expect(read.history[1]).toMatchObject({ kind: 'VENUE_PAYMENT', enabled: true, limit: 50 })
    expect(read.historyHasMore).toBe(false)

    const older = (
      await terms(app, eventId, headers, `?before=${encodeURIComponent(read.history[1].at)}`)
    ).json().data

    expect(older.history.map((entry) => [entry.kind, entry.sequence])).toEqual([['FEE', 1]])

    await app.close()
  })

  it('names a decider whose account is gone “An administrator at The Desi Events”', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await as(app, 'anil@desi-event.example')
    const eventId = ids.publishedEvent.id

    await setFee(app, eventId, headers, {
      source: 'EVENT',
      percentageBps: 300,
      flatCentsPerTicket: 149,
      expectedSequence: 0,
    })

    prisma._store.eventFeeSetting[0].setById = null

    const read = (await terms(app, eventId, headers)).json().data

    expect(read.fee.changedByName).toBe('An administrator at The Desi Events')
    expect(read.history[0].byName).toBe('An administrator at The Desi Events')

    await app.close()
  })
})

describe('what an organiser and the public read', () => {
  /**
   * A world whose published event has its own fee and the switch on.
   *
   * @returns {Promise<object>} The harness.
   */
  async function decided() {
    const harness = await createTestApp()
    const headers = await as(harness.app, 'anil@desi-event.example')
    const eventId = harness.ids.publishedEvent.id

    await setFee(harness.app, eventId, headers, {
      source: 'EVENT',
      percentageBps: 300,
      flatCentsPerTicket: 149,
      expectedSequence: 0,
    })
    await setVenue(harness.app, eventId, headers, {
      enabled: true,
      limit: 50,
      seen: { enabled: false, limit: null },
    })

    return harness
  }

  it('gives the organisation’s team the terms read-only, with the administrator’s name and the counts, and no history', async () => {
    const { app, ids } = await decided()
    const headers = bearer(await signIn(app, 'owner@rangoli.example'))
    const detail = await app.inject({
      method: 'GET',
      url: `/v1/events/${ids.publishedEvent.id}`,
      headers,
    })

    expect(detail.statusCode).toBe(200)

    const { paymentTerms } = detail.json().data

    expect(paymentTerms.fee).toMatchObject({
      source: 'EVENT',
      percentageBps: 300,
      flatCentsPerTicket: 149,
      currency: 'INR',
      changedByName: 'Anil Administrator',
      reason: REASON,
    })
    expect(paymentTerms.venuePayment).toMatchObject({
      enabled: true,
      limit: 50,
      offered: true,
      changedByName: 'Anil Administrator',
      hasOrders: false,
      unpaidTickets: 0,
      paidAtDoorTickets: 0,
      paidAtDoorCents: 0,
    })
    expect(paymentTerms).not.toHaveProperty('history')

    await app.close()
  })

  it('gives everybody else the effective terms and whether paying at the venue is offered, and nothing more', async () => {
    const { app, ids } = await decided()

    for (const headers of [{}, bearer(await signIn(app, 'priya@example.com'))]) {
      const detail = await app.inject({
        method: 'GET',
        url: `/v1/events/${ids.publishedEvent.id}`,
        headers,
      })
      const data = detail.json().data

      expect(data.feeTerms).toEqual([{ currency: 'INR', percentageBps: 300, flatCents: 149 }])
      expect(data.venuePayment).toEqual({ available: true })
      expect(data).not.toHaveProperty('paymentTerms')
      expect(JSON.stringify(data)).not.toContain(REASON)
    }

    await app.close()
  })

  it('prices a listing card’s “from” price with the event’s own fee', async () => {
    const { app, ids } = await decided()
    const list = await app.inject({ method: 'GET', url: '/v1/events?perPage=50' })
    const card = list.json().data.find((event) => event.id === ids.publishedEvent.id)
    const price = (feeTerms) =>
      computeOrderTotals({
        items: [{ ticketTypeId: 'card', quantity: 1, unitPriceCents: card.minPriceCents }],
        feeConfig: feeTerms,
        taxRateBps: taxRateBps(ids.venue.country, ids.venue.region),
        currency: card.currency,
      }).totalCents

    expect(card.minTotalCents).toBe(
      price({ percentageBps: 300, flatCents: 149, currency: card.currency }),
    )
    expect(card.minTotalCents).not.toBe(price(feeConfig(card.currency)))

    await app.close()
  })

  it('lists each event’s fee and switch on the administrators’ events list', async () => {
    const { app, ids } = await decided()
    const headers = await as(app, 'anil@desi-event.example')
    const list = await app.inject({
      method: 'GET',
      url: '/v1/platform/events?perPage=50',
      headers,
    })
    const rows = list.json().data
    const decidedRow = rows.find((row) => row.id === ids.publishedEvent.id)
    const plainRow = rows.find((row) => row.id === ids.draftEvent.id)

    expect(decidedRow).toMatchObject({
      feeSource: 'EVENT',
      feePercentageBps: 300,
      feeFlatCentsPerTicket: 149,
      feeCurrency: 'INR',
      venuePaymentEnabled: true,
      venuePaymentLimit: 50,
    })
    expect(plainRow).toMatchObject({
      feeSource: 'SITE_DEFAULT',
      feePercentageBps: null,
      feeFlatCentsPerTicket: null,
      feeCurrency: null,
      venuePaymentEnabled: false,
      venuePaymentLimit: null,
    })

    await app.close()
  })
})

describe('an event’s own fee holds its tiers to its currency (DF3)', () => {
  /**
   * The published event with its own fee in INR, and an organiser able to
   * change its tiers.
   *
   * @returns {Promise<object>} The harness and the organiser's headers.
   */
  async function ownFee() {
    const { seed, ids } = await world()
    const harness = await createTestApp({ seed, ids })
    const admin = await as(harness.app, 'anil@desi-event.example')

    await setFee(harness.app, ids.publishedEvent.id, admin, {
      source: 'EVENT',
      percentageBps: 300,
      flatCentsPerTicket: 149,
      expectedSequence: 0,
    })

    return { ...harness, admin, organiser: await as(harness.app, 'esha-events@rangoli.example') }
  }

  /**
   * The event's revision now.
   *
   * @param {object} prisma The stub.
   * @param {string} eventId The event.
   * @returns {number} Its revision.
   */
  function revisionOf(prisma, eventId) {
    return eventRow(prisma, eventId).revision
  }

  it('refuses an organiser’s tier in another currency with FEE_TERMS_CURRENCY, and the fee stays', async () => {
    const { app, prisma, ids, organiser } = await ownFee()
    const eventId = ids.publishedEvent.id
    const tiersBefore = prisma._store.ticketType.length

    const added = await app.inject({
      method: 'POST',
      url: `/v1/events/${eventId}/tiers`,
      headers: organiser,
      payload: {
        revision: revisionOf(prisma, eventId),
        name: 'Dollar seats',
        priceCents: 4_000,
        quantityTotal: 10,
        currency: 'USD',
      },
    })

    expect(added.statusCode).toBe(409)
    expect(added.json().error).toMatchObject({
      code: 'FEE_TERMS_CURRENCY',
      message:
        "The Desi Events team set this event's booking fee in INR. Ask them to change it before pricing tickets in another currency.",
    })

    const moved = await app.inject({
      method: 'PATCH',
      url: `/v1/events/${eventId}/tiers/${ids.vip.id}`,
      headers: organiser,
      payload: { revision: revisionOf(prisma, eventId), currency: 'USD' },
    })

    expect(moved.statusCode).toBe(409)
    expect(moved.json().error.code).toBe('FEE_TERMS_CURRENCY')

    const legacy = await app.inject({
      method: 'POST',
      url: `/v1/events/${eventId}/ticket-types`,
      headers: organiser,
      payload: {
        eventId,
        name: 'Legacy dollars',
        priceCents: 4_000,
        quantityTotal: 10,
        currency: 'USD',
      },
    })

    expect(legacy.statusCode).toBe(409)
    expect(legacy.json().error.code).toBe('FEE_TERMS_CURRENCY')

    expect(prisma._store.ticketType.length).toBe(tiersBefore)
    expect(prisma._store.ticketType.find((row) => row.id === ids.vip.id).currency).toBe('INR')
    expect(eventRow(prisma, eventId)).toMatchObject({ feeSource: 'EVENT', feeCurrency: 'INR' })

    // A tier in the event's own currency is added as ever.
    const same = await app.inject({
      method: 'POST',
      url: `/v1/events/${eventId}/tiers`,
      headers: organiser,
      payload: {
        revision: revisionOf(prisma, eventId),
        name: 'Rupee seats',
        priceCents: 40_000,
        quantityTotal: 10,
      },
    })

    expect(same.statusCode).toBe(201)

    await app.close()
  })

  it('refuses it in the editing sitting of the team at The Desi Events too', async () => {
    const { app, prisma, ids } = await ownFee()
    const eventId = ids.publishedEvent.id
    const ops = await as(app, 'ops@desi-event.example')

    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/v1/platform/events/${eventId}/edit`,
          headers: ops,
          payload: { reason: 'The organiser asked us to add a tier.' },
        })
      ).statusCode,
    ).toBe(201)

    const added = await app.inject({
      method: 'POST',
      url: `/v1/events/${eventId}/tiers`,
      headers: ops,
      payload: {
        revision: revisionOf(prisma, eventId),
        name: 'Dollar seats',
        priceCents: 4_000,
        quantityTotal: 10,
        currency: 'USD',
      },
    })

    expect(added.statusCode).toBe(409)
    expect(added.json().error.code).toBe('FEE_TERMS_CURRENCY')

    await app.close()
  })

  it('refuses nothing for an event on the site default', async () => {
    const { seed, ids } = await world()
    const { app, prisma } = await createTestApp({ seed, ids })
    const organiser = await as(app, 'esha-events@rangoli.example')

    // The event's other tiers are INR, so a dollar tier is the sibling rule's
    // 422, not the fee's 409.
    const added = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.publishedEvent.id}/tiers`,
      headers: organiser,
      payload: {
        revision: revisionOf(prisma, ids.publishedEvent.id),
        name: 'Dollar seats',
        priceCents: 4_000,
        quantityTotal: 10,
        currency: 'USD',
      },
    })

    expect(added.statusCode).toBe(422)

    await app.close()
  })
})

describe('the stub world used here', () => {
  it('starts every event on the site default with the switch off', async () => {
    const { seed } = await makeWorld()
    const prisma = createPrismaStub(seed)

    for (const event of prisma._store.event) {
      expect(event).toMatchObject({
        feeSource: 'SITE_DEFAULT',
        venuePaymentEnabled: false,
        venuePaymentLimit: null,
      })
    }
  })
})
