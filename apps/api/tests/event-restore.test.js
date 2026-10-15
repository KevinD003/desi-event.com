import { describe, expect, it } from 'vitest'

import { bearer, createTestApp, signIn, stepUp } from './helpers/app.js'
import { addRows, deletedEventFixture, makeWorld } from './helpers/fixtures.js'

/**
 * Restoring a deleted event (SPEC2-XI X-T): the team at The Desi Events only, to the
 * status `restoreTarget` gives (an on-sale event comes back paused), with its
 * web address back if nobody took it.
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc namepath.
 *
 * @file @desi-event/api/tests/event-restore
 */

/** A reason long enough for every reason box. */
const REASON = 'Deleted by mistake; the organiser asked for it back.'

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
 * The app with a deleted event added.
 *
 * @param {object} [options] `deletedEventFixture` options.
 * @param {function(object): void} [shape] Changes the world before seeding.
 * @returns {Promise<object>} The harness and the fixture.
 */
async function deletedApp(options = {}, shape = () => {}) {
  const world = await makeWorld()
  const fixture = deletedEventFixture(world.ids, options)

  shape(world, fixture)
  addRows(world.seed, fixture.rows)

  return { ...(await createTestApp({ seed: world.seed, ids: world.ids })), fixture }
}

/**
 * Ask for a restore.
 *
 * @param {object} app The app.
 * @param {object} event The deleted event.
 * @param {object} headers Whose request.
 * @param {object} [extra] Body overrides.
 * @returns {Promise<object>} The response.
 */
function restore(app, event, headers, extra = {}) {
  return app.inject({
    method: 'POST',
    url: `/v1/platform/events/${event.id}/restore`,
    headers,
    payload: { revision: event.revision ?? 0, reason: REASON, ...extra },
  })
}

describe('POST /v1/platform/events/:id/restore', () => {
  it('brings an event deleted on sale back paused, with its record cleared, audited', async () => {
    const { app, prisma, fixture } = await deletedApp()

    const response = await restore(app, fixture.event, await as(app, 'anil@desi-event.example'))

    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json().data.status).toBe('SALES_PAUSED')
    expect(response.json().data.deletion).toBeUndefined()

    expect(prisma._store.event.find((row) => row.id === fixture.event.id)).toMatchObject({
      status: 'SALES_PAUSED',
      deletedAt: null,
      deletedById: null,
      deletionReason: null,
      deletionOutcome: null,
      deletionAuthority: null,
      statusBeforeDeletion: null,
      deletedSlug: null,
      revision: fixture.event.revision + 1,
    })

    expect(
      prisma._store.eventModerationAction.find((row) => row.eventId === fixture.event.id),
    ).toMatchObject({ fromStatus: 'DELETED', toStatus: 'SALES_PAUSED', reason: REASON })

    const audit = prisma._store.auditLog.find((entry) => entry.action === 'event.restored')

    expect(audit.metadata).toMatchObject({
      from: 'DELETED',
      to: 'SALES_PAUSED',
      statusBefore: 'ON_SALE',
      authority: 'PLATFORM',
      reason: REASON,
    })

    await app.close()
  })

  it('brings one deleted under review back as a draft, and one deleted with its refunds back cancelled', async () => {
    const review = await deletedApp({
      overrides: { statusBeforeDeletion: 'REVIEW_PENDING', publishedAt: null },
    })
    const first = await restore(
      review.app,
      review.fixture.event,
      await as(review.app, 'anil@desi-event.example'),
    )

    expect(first.json().data.status).toBe('DRAFT')
    await review.app.close()

    const refunded = await deletedApp({
      overrides: { statusBeforeDeletion: 'CANCELLED', deletionOutcome: 'CANCELLED_AND_REFUNDED' },
    })
    const second = await restore(
      refunded.app,
      refunded.fixture.event,
      await as(refunded.app, 'ops@desi-event.example'),
    )

    expect(second.json().data.status).toBe('CANCELLED')
    await refunded.app.close()
  })

  it('takes the released web address back, or makes a new one from it when it was taken', async () => {
    const released = {
      overrides: {
        statusBeforeDeletion: 'DRAFT',
        publishedAt: null,
        slug: 'deleted-placeholder',
        deletedSlug: 'diwali-mela-on-the-lawn',
      },
    }
    const free = await deletedApp(released)
    const back = await restore(
      free.app,
      free.fixture.event,
      await as(free.app, 'anil@desi-event.example'),
    )

    expect(back.json().data).toMatchObject({ status: 'DRAFT', slug: 'diwali-mela-on-the-lawn' })
    await free.app.close()

    const taken = await deletedApp(released, (world) => {
      world.seed.event.push({
        ...world.ids.draftEvent,
        id: 'cdiwalinamesake00000000000',
        slug: 'diwali-mela-on-the-lawn',
      })
    })
    const moved = await restore(
      taken.app,
      taken.fixture.event,
      await as(taken.app, 'anil@desi-event.example'),
    )

    expect(moved.statusCode).toBe(200)
    expect(moved.json().data.slug).toMatch(/^diwali-mela-on-the-lawn-[a-z0-9]{4}$/u)
    await taken.app.close()
  })

  it('refuses a public return for an organisation that is not verified, and allows a draft', async () => {
    const unverified = (world) => {
      world.seed.organization[0].verificationStatus = 'SUSPENDED'
      world.seed.organization[0].verified = false
    }
    const publicReturn = await deletedApp({}, unverified)
    const refused = await restore(
      publicReturn.app,
      publicReturn.fixture.event,
      await as(publicReturn.app, 'anil@desi-event.example'),
    )

    expect(refused.statusCode).toBe(409)
    expect(refused.json().error.code).toBe('ORGANIZER_NOT_VERIFIED')
    await publicReturn.app.close()

    const draftReturn = await deletedApp(
      { overrides: { statusBeforeDeletion: 'DRAFT', publishedAt: null } },
      unverified,
    )
    const allowed = await restore(
      draftReturn.app,
      draftReturn.fixture.event,
      await as(draftReturn.app, 'anil@desi-event.example'),
    )

    expect(allowed.statusCode).toBe(200)
    await draftReturn.app.close()
  })

  it('refuses a public return for a verified organisation that is suspended', async () => {
    const suspendedAt = new Date('2026-09-01T00:00:00.000Z')
    const { app, prisma, fixture } = await deletedApp({}, (world) => {
      world.seed.organization[0].verificationStatus = 'VERIFIED'
      world.seed.organization[0].suspendedAt = suspendedAt
    })

    const refused = await restore(app, fixture.event, await as(app, 'anil@desi-event.example'))

    expect(refused.statusCode).toBe(409)
    expect(refused.json().error).toMatchObject({
      code: 'ORGANIZER_NOT_VERIFIED',
      message: expect.stringMatching(/organisation is suspended/),
    })
    // Nothing moved.
    expect(prisma._store.event.find((row) => row.id === fixture.event.id).status).toBe('DELETED')

    await app.close()
  })

  it('is for the team at The Desi Events alone, needs the EVENT_PUBLISH factor, and refuses what is not deleted', async () => {
    const { app, prisma, fixture, ids } = await deletedApp()

    for (const email of [
      'owner@rangoli.example',
      'arun@rangoli.example',
      'maya@desi-event.example',
    ]) {
      const refused = await restore(app, fixture.event, await as(app, email))

      expect(refused.statusCode, email).toBe(403)
    }

    const anil = bearer(await signIn(app, 'anil@desi-event.example'))

    for (const session of prisma._store.session) {
      if (session.userId === ids.platformAdministrator.id) {
        session.mfaSatisfiedAt = new Date(Date.now() - 11 * 60_000)
      }
    }

    const stale = await restore(app, fixture.event, anil)

    expect(stale.statusCode).toBe(403)
    expect(stale.json().error.code).toBe('STEP_UP_REQUIRED')

    const headers = await as(app, 'anil@desi-event.example')
    const wrongRevision = await restore(app, fixture.event, headers, { revision: 99 })

    expect(wrongRevision.statusCode).toBe(409)
    expect(wrongRevision.json().error.code).toBe('STALE_REVISION')

    const live = await restore(app, ids.publishedEvent, headers)

    expect(live.statusCode).toBe(409)
    expect(live.json().error.code).toBe('NOT_DELETED')

    await app.close()
  })
})
