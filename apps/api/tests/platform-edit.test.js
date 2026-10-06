import { describe, expect, it } from 'vitest'

import { bearer, createTestApp, signIn, stepUp } from './helpers/app.js'
import {
  addRows,
  makeWorld,
  platformHeldImportFixture,
  threeNightEventFixture,
} from './helpers/fixtures.js'
import { seedPicture } from './helpers/media-world.js'

/**
 * The Desi-Event team editing an organisation's posted event (SPEC2-XI X-A):
 * one reasoned, audited sitting at a time, bound to the browser session that
 * opened it, with a second factor within the MODERATION window for every
 * write.
 *
 * @file @desi-event/api/tests/platform-edit
 */

/** The reason a sitting is opened with. */
const REASON = 'The organiser asked us to fix the title.'

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
 * Open a sitting.
 *
 * @param {object} app The app.
 * @param {string} eventId The event.
 * @param {object} headers The administrator's headers.
 * @param {string} [reason] The reason.
 * @returns {Promise<object>} The response.
 */
function open(app, eventId, headers, reason = REASON) {
  return app.inject({
    method: 'POST',
    url: `/v1/platform/events/${eventId}/edit`,
    headers,
    payload: { reason },
  })
}

/**
 * Rename an event.
 *
 * @param {object} app The app.
 * @param {object} prisma The stub.
 * @param {string} eventId The event.
 * @param {object} headers Whose request.
 * @param {string} title The new title.
 * @returns {Promise<object>} The response.
 */
function rename(app, prisma, eventId, headers, title) {
  const revision = prisma._store.event.find((row) => row.id === eventId).revision

  return app.inject({
    method: 'PATCH',
    url: `/v1/events/${eventId}`,
    headers,
    payload: { revision, title },
  })
}

describe('POST /v1/platform/events/:id/edit', () => {
  it('opens a sitting with a reason, audited, never cached', async () => {
    const { app, prisma, ids } = await createTestApp()
    const response = await open(
      app,
      ids.publishedEvent.id,
      await as(app, 'anil@desi-event.example'),
    )

    expect(response.statusCode).toBe(201)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json().data).toMatchObject({
      open: true,
      mine: true,
      reason: REASON,
      endedBy: null,
      administratorName: 'Anil Administrator',
    })

    const { openedAt, expiresAt } = response.json().data

    expect(new Date(expiresAt) - new Date(openedAt)).toBe(60 * 60_000)

    const audit = prisma._store.auditLog.find(
      (entry) => entry.action === 'event.platform_edit_opened',
    )

    expect(audit.metadata).toMatchObject({
      organizationId: ids.organization.id,
      platformEditId: response.json().data.id,
      reason: REASON,
    })

    await app.close()
  })

  it('refuses a moderator, a short reason and an event that is not posted', async () => {
    const { app, ids } = await createTestApp()

    const moderator = await open(
      app,
      ids.publishedEvent.id,
      await as(app, 'maya@desi-event.example'),
    )

    expect(moderator.statusCode).toBe(403)

    const anil = await as(app, 'anil@desi-event.example')
    const short = await open(app, ids.publishedEvent.id, anil, 'Too short')

    expect(short.statusCode).toBe(400)

    for (const event of [ids.draftEvent, ids.reviewPendingEvent, ids.approvedEvent]) {
      const refused = await open(app, event.id, anil)

      expect(refused.statusCode, event.status).toBe(409)
      expect(refused.json().error.code).toBe('NOT_POSTED')
    }

    await app.close()
  })

  it('supersedes the administrator’s earlier sitting on the event', async () => {
    const { app, prisma, ids } = await createTestApp()
    const anil = await as(app, 'anil@desi-event.example')

    const first = await open(app, ids.publishedEvent.id, anil)
    const second = await open(app, ids.publishedEvent.id, anil, 'A second reason for editing.')

    expect(second.statusCode).toBe(201)

    const rows = prisma._store.eventPlatformEdit.filter(
      (row) => row.eventId === ids.publishedEvent.id,
    )

    expect(rows).toHaveLength(2)
    expect(rows.find((row) => row.id === first.json().data.id)).toMatchObject({
      endedBy: 'SUPERSEDED',
    })
    expect(rows.filter((row) => row.closedAt === null)).toHaveLength(1)

    await app.close()
  })
})

describe('writing as the Desi-Event team', () => {
  it('needs a sitting, even for a SUPER_ADMIN who is not a member', async () => {
    const { app, prisma, ids } = await createTestApp()

    for (const email of ['anil@desi-event.example', 'ops@desi-event.example']) {
      const response = await rename(
        app,
        prisma,
        ids.publishedEvent.id,
        await as(app, email),
        'Navratri Garba Night (corrected)',
      )

      expect(response.statusCode, email).toBe(403)
      expect(response.json().error.code).toBe('PLATFORM_EDIT_NOT_OPEN')
    }

    await app.close()
  })

  it('writes in a sitting, audited with it and its reason; the organiser’s audit names neither', async () => {
    const { app, prisma, ids } = await createTestApp()
    const anil = await as(app, 'anil@desi-event.example')
    const sitting = await open(app, ids.publishedEvent.id, anil)

    const response = await rename(
      app,
      prisma,
      ids.publishedEvent.id,
      anil,
      'Navratri Garba Night (corrected)',
    )

    expect(response.statusCode).toBe(200)

    const platform = prisma._store.auditLog.find(
      (entry) => entry.action === 'event.updated' && entry.actorId === ids.platformAdministrator.id,
    )

    expect(platform.metadata).toMatchObject({
      authority: 'PLATFORM',
      platformEditId: sitting.json().data.id,
      reason: REASON,
      fields: ['title'],
    })

    const owner = await as(app, 'owner@rangoli.example')
    const organiser = await rename(
      app,
      prisma,
      ids.publishedEvent.id,
      owner,
      'Navratri Garba Night',
    )

    expect(organiser.statusCode).toBe(200)

    const own = prisma._store.auditLog.find(
      (entry) => entry.action === 'event.updated' && entry.actorId === ids.owner.id,
    )

    expect(own.metadata).not.toHaveProperty('authority')
    expect(own.metadata).not.toHaveProperty('platformEditId')

    await app.close()
  })

  it('adds and changes tiers and nights in a sitting', async () => {
    const { app, prisma, ids } = await createTestApp()
    const anil = await as(app, 'anil@desi-event.example')

    await open(app, ids.publishedEvent.id, anil)

    const revision = () =>
      prisma._store.event.find((row) => row.id === ids.publishedEvent.id).revision

    // The legacy route takes the authoring path, sitting and all.
    const legacy = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.publishedEvent.id}/ticket-types`,
      headers: anil,
      payload: {
        eventId: ids.publishedEvent.id,
        name: 'Late entry',
        priceCents: 10_000,
        quantityTotal: 20,
      },
    })

    expect(legacy.statusCode).toBe(201)

    const tier = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.publishedEvent.id}/tiers`,
      headers: anil,
      payload: { revision: revision(), name: 'Balcony', priceCents: 50_000, quantityTotal: 10 },
    })

    expect(tier.statusCode).toBe(201)

    const raised = await app.inject({
      method: 'PATCH',
      url: `/v1/events/${ids.publishedEvent.id}/tiers/${tier.json().data.id}`,
      headers: anil,
      payload: { revision: revision(), quantityTotal: 30 },
    })

    expect(raised.statusCode).toBe(200)

    const audits = prisma._store.auditLog.filter(
      (entry) =>
        entry.actorId === ids.platformAdministrator.id && entry.metadata?.authority === 'PLATFORM',
    )

    expect(audits.map((entry) => entry.action).sort()).toEqual([
      'event.ticket_type_added',
      'event.ticket_type_added',
      'event.ticket_type_updated',
    ])

    await app.close()
  })

  it('refuses another browser session of the same administrator, a lapsed factor, and a closed sitting', async () => {
    const { app, prisma, ids } = await createTestApp()
    const first = await as(app, 'anil@desi-event.example')

    await open(app, ids.publishedEvent.id, first)

    const second = await as(app, 'anil@desi-event.example')
    const elsewhere = await rename(app, prisma, ids.publishedEvent.id, second, 'Another title here')

    expect(elsewhere.statusCode).toBe(403)
    expect(elsewhere.json().error.code).toBe('PLATFORM_EDIT_NOT_OPEN')

    // The sitting's session, its factor older than the MODERATION window.
    const sitting = prisma._store.eventPlatformEdit.find((row) => row.closedAt === null)
    const session = prisma._store.session.find((row) => row.id === sitting.sessionId)
    const satisfied = session.mfaSatisfiedAt

    session.mfaSatisfiedAt = new Date(Date.now() - 11 * 60_000)

    const lapsed = await rename(app, prisma, ids.publishedEvent.id, first, 'Another title here')

    expect(lapsed.statusCode).toBe(403)
    expect(lapsed.json().error.code).toBe('STEP_UP_REQUIRED')

    // Confirmed again, it writes.
    session.mfaSatisfiedAt = satisfied

    const recovered = await rename(app, prisma, ids.publishedEvent.id, first, 'Another title here')

    expect(recovered.statusCode).toBe(200)

    const closed = await app.inject({
      method: 'POST',
      url: `/v1/platform/events/${ids.publishedEvent.id}/edit/close`,
      headers: first,
    })

    expect(closed.statusCode).toBe(200)
    expect(closed.json().data).toMatchObject({ open: false, endedBy: 'CLOSED' })

    const after = await rename(app, prisma, ids.publishedEvent.id, first, 'A third title here')

    expect(after.statusCode).toBe(403)
    expect(after.json().error.code).toBe('PLATFORM_EDIT_NOT_OPEN')

    // Closing again answers the same sitting, as it stands, and audits nothing new.
    const again = await app.inject({
      method: 'POST',
      url: `/v1/platform/events/${ids.publishedEvent.id}/edit/close`,
      headers: first,
    })

    expect(again.json().data.id).toBe(closed.json().data.id)
    expect(
      prisma._store.auditLog.filter((entry) => entry.action === 'event.platform_edit_closed'),
    ).toHaveLength(1)

    await app.close()
  })

  it('refuses a sitting that ran out', async () => {
    const { app, prisma, ids } = await createTestApp()
    const anil = await as(app, 'anil@desi-event.example')

    await open(app, ids.publishedEvent.id, anil)

    const sitting = prisma._store.eventPlatformEdit.find((row) => row.closedAt === null)

    sitting.openedAt = new Date(Date.now() - 2 * 60 * 60_000)
    sitting.expiresAt = new Date(Date.now() - 60 * 60_000)

    const response = await rename(app, prisma, ids.publishedEvent.id, anil, 'Too late a title')

    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('PLATFORM_EDIT_NOT_OPEN')

    await app.close()
  })

  it('lets a SUPER_ADMIN who is a member edit as the organisation, without a sitting', async () => {
    const { app, prisma, ids } = await createTestApp()

    prisma._store.membership.push({
      id: 'cmembershipopsmember000000',
      userId: ids.platformAdmin.id,
      organizationId: ids.organization.id,
      role: 'OWNER',
      createdAt: new Date(),
      updatedAt: new Date(),
    })

    const response = await rename(
      app,
      prisma,
      ids.publishedEvent.id,
      await as(app, 'ops@desi-event.example'),
      'Navratri Garba Night (by a member)',
    )

    expect(response.statusCode).toBe(200)

    const audit = prisma._store.auditLog.find(
      (entry) => entry.action === 'event.updated' && entry.actorId === ids.platformAdmin.id,
    )

    expect(audit.metadata).not.toHaveProperty('authority')

    await app.close()
  })
})

describe('GET /v1/events/:id/platform-edits', () => {
  it('shows the organiser the reason and the fields, not the administrator; the team sees the name', async () => {
    const { app, prisma, ids } = await createTestApp()
    const anil = await as(app, 'anil@desi-event.example')

    await open(app, ids.publishedEvent.id, anil)
    await rename(app, prisma, ids.publishedEvent.id, anil, 'Navratri Garba Night (fixed)')

    const owner = await app.inject({
      method: 'GET',
      url: `/v1/events/${ids.publishedEvent.id}/platform-edits`,
      headers: await as(app, 'owner@rangoli.example'),
    })

    expect(owner.statusCode).toBe(200)
    expect(owner.headers['cache-control']).toBe('no-store')
    expect(owner.json().data).toHaveLength(1)
    expect(owner.json().data[0]).toMatchObject({
      reason: REASON,
      administratorName: null,
      mine: false,
      changes: [{ action: 'event.updated', fields: ['title'] }],
    })

    const team = await app.inject({
      method: 'GET',
      url: `/v1/events/${ids.publishedEvent.id}/platform-edits`,
      headers: anil,
    })

    expect(team.json().data[0]).toMatchObject({
      administratorName: 'Anil Administrator',
      mine: true,
    })

    const rival = await app.inject({
      method: 'GET',
      url: `/v1/events/${ids.publishedEvent.id}/platform-edits`,
      headers: await as(app, 'rival@dhol.example'),
    })

    expect(rival.statusCode).toBe(404)

    await app.close()
  })
})

describe('GET /v1/platform/events', () => {
  it('lists every organisation’s events for the Desi-Event team, and nobody else', async () => {
    const { app, ids } = await createTestApp()

    const response = await app.inject({
      method: 'GET',
      url: '/v1/platform/events?perPage=100',
      headers: await as(app, 'anil@desi-event.example'),
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')

    const row = response.json().data.find((entry) => entry.id === ids.publishedEvent.id)

    expect(row).toMatchObject({
      status: 'PUBLISHED',
      organization: { id: ids.organization.id, name: 'Rangoli Collective' },
      paidOrders: 0,
      imported: false,
      deletion: null,
    })

    const search = await app.inject({
      method: 'GET',
      url: '/v1/platform/events?q=dhol%20nation',
      headers: await as(app, 'anil@desi-event.example'),
    })

    expect(search.json().data.every((entry) => entry.organization.name === 'Dhol Nation')).toBe(
      true,
    )

    for (const email of ['maya@desi-event.example', 'owner@rangoli.example']) {
      const refused = await app.inject({
        method: 'GET',
        url: '/v1/platform/events',
        headers: await as(app, email),
      })

      expect(refused.statusCode, email).toBe(403)
    }

    await app.close()
  })

  it('counts paid orders and waiting pictures for the page in one grouped count each, and filters imports', async () => {
    const world = await makeWorld()
    const sold = threeNightEventFixture(world.ids)
    const imported = platformHeldImportFixture(world.ids)

    addRows(world.seed, sold.rows)
    addRows(world.seed, imported.rows)

    const { app, prisma } = await createTestApp({ seed: world.seed, ids: world.ids })

    seedPicture(prisma, { event: sold.event, moderationStatus: 'PENDING' })
    seedPicture(prisma, { event: sold.event, kind: 'EVENT_GALLERY', moderationStatus: 'PENDING' })

    const headers = await as(app, 'anil@desi-event.example')
    const calls = { orderCount: 0, mediaCount: 0, importReads: [] }
    const spy = (model, name, record) => {
      const original = prisma[model][name].bind(prisma[model])

      prisma[model][name] = async (args) => {
        record(args)

        return original(args)
      }
    }

    spy('order', 'count', () => (calls.orderCount += 1))
    spy('mediaAsset', 'count', () => (calls.mediaCount += 1))
    spy('eventImportItem', 'findMany', (args) => calls.importReads.push(args))

    const response = await app.inject({
      method: 'GET',
      url: '/v1/platform/events?perPage=100',
      headers,
    })

    expect(response.statusCode).toBe(200)

    const rows = response.json().data

    expect(rows.find((row) => row.id === sold.event.id)).toMatchObject({
      paidOrders: 4,
      picturesWaiting: 2,
      imported: false,
    })
    expect(rows.find((row) => row.id === imported.event.id)).toMatchObject({ imported: true })
    // No count per row, and the import records read are the page's only.
    expect(calls.orderCount).toBe(0)
    expect(calls.mediaCount).toBe(0)
    expect(calls.importReads).toHaveLength(1)
    expect(calls.importReads[0].where.eventId.in).toHaveLength(rows.length)

    const only = await app.inject({
      method: 'GET',
      url: '/v1/platform/events?imported=only',
      headers,
    })

    expect(only.json().data.map((row) => row.id)).toEqual([imported.event.id])

    const without = await app.inject({
      method: 'GET',
      url: '/v1/platform/events?imported=exclude&perPage=100',
      headers,
    })

    expect(without.json().data.some((row) => row.id === imported.event.id)).toBe(false)
    expect(without.json().data.some((row) => row.id === sold.event.id)).toBe(true)

    await app.close()
  })
})
