/**
 * Bringing a postponed event back with a new date, and reworking a rejected one.
 *
 * Rescheduling is one command in one transaction: the dates, the sessions, the
 * status, the notices and the audit row commit together or not at all, so
 * there is never a live event carrying the date it was postponed from.
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc
 * namepath.
 *
 * @file @desi-event/api/tests/event-reschedule
 */

import { describe, expect, it } from 'vitest'

import { bearer, createTestApp, signIn, stepUp } from './helpers/app.js'
import { auditRows, seedOrder } from './helpers/authoring-world.js'
import { minutesFromNow } from './helpers/fixtures.js'
import { cuid } from './helpers/prisma-stub.js'

/**
 * The published event, postponed, with two paid orders and the owner stepped up.
 *
 * @param {object} [options] Options.
 * @param {boolean} [options.stepUp] Whether to step up first.
 * @param {string} [options.email] Who signs in.
 * @param {boolean} [options.enrol] Give the account a second factor first, for a
 *   fixture member the world does not enrol because its role is not privileged.
 * @returns {Promise<object>} The harness.
 */
async function postponedHarness({
  stepUp: stepped = true,
  email = 'owner@rangoli.example',
  enrol = false,
} = {}) {
  const { app, prisma, ids } = await createTestApp()

  if (enrol) {
    // The same sealed test secret every enrolled fixture holds, so the helpers
    // can produce a code for this account too.
    const user = prisma._store.user.find((row) => row.email === email)
    const template = prisma._store.mfaFactor.find((row) => row.type === 'TOTP' && row.confirmedAt)

    prisma._store.mfaFactor.push({ ...template, id: cuid(), userId: user.id, lastUsedAt: null })
    app.testEnrolledEmails.add(email)
  }
  const event = prisma._store.event.find((row) => row.id === ids.publishedEvent.id)

  event.status = 'POSTPONED'
  event.previousStartsAt = event.startsAt
  event.revision = 3

  const session = prisma._store.eventSession.find((row) => row.eventId === event.id)
  const orders = [
    seedOrder(prisma, { eventId: event.id, ticketTypeId: ids.generalAdmission.id }),
    seedOrder(prisma, { eventId: event.id, ticketTypeId: ids.vip.id }),
  ]
  const headers = bearer(await signIn(app, email))

  if (stepped) {
    await stepUp(app, email, headers)
  } else {
    // Signing in with a second factor counts as a fresh step-up; an hour on,
    // it no longer does.
    for (const row of prisma._store.session) {
      row.mfaSatisfiedAt = new Date(Date.now() - 60 * 60 * 1000)
    }
  }

  const startsAt = minutesFromNow(60 * 24 * 90)
  const endsAt = minutesFromNow(60 * 24 * 90 + 300)

  /**
   * A coherent reschedule body.
   *
   * @param {object} [overrides] Fields to change.
   * @returns {object} The body.
   */
  const body = (overrides = {}) => ({
    revision: 3,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    sessions: [{ id: session.id, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() }],
    resume: 'ON_SALE',
    confirm: true,
    reason: 'The venue is ready again.',
    ...overrides,
  })

  /**
   * POST the reschedule.
   *
   * @param {object} payload The body.
   * @returns {Promise<object>} The response.
   */
  const reschedule = (payload) =>
    app.inject({
      method: 'POST',
      url: `/v1/events/${event.id}/reschedule`,
      headers,
      payload,
    })

  return { app, prisma, ids, event, session, orders, headers, body, reschedule, startsAt, endsAt }
}

describe('a postponed event comes back with a new date', () => {
  it('moves the event and its session, reopens sales, queues one notice per order and records it', async () => {
    const { app, prisma, event, session, orders, body, reschedule, startsAt } =
      await postponedHarness()
    const before = prisma._store.notificationOutbox.length

    const response = await reschedule(body())

    expect(response.statusCode).toBe(200)
    expect(response.json().data.status).toBe('ON_SALE')
    expect(new Date(response.json().data.startsAt).getTime()).toBe(startsAt.getTime())
    expect(session.startsAt.getTime()).toBe(startsAt.getTime())
    expect(event.revision).toBe(4)

    const notices = prisma._store.notificationOutbox.slice(before)

    expect(notices).toHaveLength(2)
    expect(notices.map((row) => row.template)).toEqual(['event.changed', 'event.changed'])
    expect(new Set(notices.map((row) => row.recipient))).toEqual(
      new Set(orders.map(({ order }) => order.buyerEmail)),
    )
    expect(notices[0].payload.sessions).toEqual([
      expect.objectContaining({ id: session.id, fields: expect.arrayContaining(['startsAt']) }),
    ])

    const [audit] = auditRows(prisma, 'event.rescheduled')

    expect(audit.metadata).toMatchObject({
      from: 'POSTPONED',
      to: 'ON_SALE',
      revision: 4,
      ordersAffected: 2,
      notificationsQueued: 2,
      reason: 'The venue is ready again.',
    })
    expect(prisma._store.eventModerationAction.at(-1)).toMatchObject({
      fromStatus: 'POSTPONED',
      toStatus: 'ON_SALE',
    })

    await app.close()
  })

  it('can come back published with sales closed', async () => {
    const { app, body, reschedule } = await postponedHarness()

    const response = await reschedule(body({ resume: 'PUBLISHED' }))

    expect(response.statusCode).toBe(200)
    expect(response.json().data.status).toBe('PUBLISHED')

    await app.close()
  })

  it('says which nights moved when the event keeps its own dates', async () => {
    const { app, prisma, event, session, body, reschedule } = await postponedHarness()
    const before = prisma._store.notificationOutbox.length
    const hour = 60 * 60 * 1000

    const response = await reschedule(
      body({
        startsAt: event.startsAt.toISOString(),
        endsAt: event.endsAt.toISOString(),
        sessions: [
          {
            id: session.id,
            startsAt: new Date(session.startsAt.getTime() + hour).toISOString(),
            endsAt: new Date(session.endsAt.getTime() + hour).toISOString(),
          },
        ],
      }),
    )

    expect(response.statusCode).toBe(200)

    const notices = prisma._store.notificationOutbox.slice(before)

    expect(notices).toHaveLength(2)

    for (const notice of notices) {
      expect(notice.payload.changedFields).toEqual([])
      expect(notice.payload.changed).toEqual([
        'the start time of one night',
        'the end time of one night',
      ])
    }

    await app.close()
  })

  it('moves each ticket type’s own sales window with what it is sold for', async () => {
    // A tier for every night moves with the event's start; a tier for one
    // night moves with that night. Left at the old dates, a window that closed
    // at the postponed date would keep the tier off sale after the event came
    // back.
    const { app, prisma, ids, event, session, body, reschedule, startsAt } =
      await postponedHarness()
    const hour = 60 * 60 * 1000
    const day = 24 * hour
    const everyNight = prisma._store.ticketType.find((row) => row.id === ids.generalAdmission.id)
    const oneNight = prisma._store.ticketType.find((row) => row.id === ids.vip.id)
    const oldEventStart = event.startsAt.getTime()
    const oldNightStart = session.startsAt.getTime()

    everyNight.salesStartAt = new Date(oldEventStart - 20 * day)
    everyNight.salesEndAt = new Date(oldEventStart - hour)
    oneNight.eventSessionId = session.id
    oneNight.salesStartAt = null
    oneNight.salesEndAt = new Date(oldNightStart)

    const response = await reschedule(body())

    expect(response.statusCode).toBe(200)

    const eventDelta = startsAt.getTime() - oldEventStart
    const nightDelta = startsAt.getTime() - oldNightStart

    expect(everyNight.salesStartAt.getTime()).toBe(oldEventStart - 20 * day + eventDelta)
    expect(everyNight.salesEndAt.getTime()).toBe(oldEventStart - hour + eventDelta)
    expect(oneNight.salesStartAt).toBeNull()
    expect(oneNight.salesEndAt.getTime()).toBe(oldNightStart + nightDelta)

    // The every-night tier sells again: its window now closes an hour before
    // the new start, which is in the future.
    expect(everyNight.salesEndAt.getTime()).toBeGreaterThan(Date.now())

    const [row] = auditRows(prisma, 'event.rescheduled')
    expect(row.metadata.ticketTypes).toEqual(
      expect.arrayContaining([
        {
          id: everyNight.id,
          before: {
            salesStartAt: new Date(oldEventStart - 20 * day).toISOString(),
            salesEndAt: new Date(oldEventStart - hour).toISOString(),
          },
          after: {
            salesStartAt: everyNight.salesStartAt.toISOString(),
            salesEndAt: everyNight.salesEndAt.toISOString(),
          },
        },
        expect.objectContaining({ id: oneNight.id }),
      ]),
    )

    await app.close()
  })

  it('moves a night’s tier with its night, and an every-night tier not at all, when only the night moves', async () => {
    const { app, prisma, ids, event, session, body, reschedule } = await postponedHarness()
    const hour = 60 * 60 * 1000
    const everyNight = prisma._store.ticketType.find((row) => row.id === ids.generalAdmission.id)
    const oneNight = prisma._store.ticketType.find((row) => row.id === ids.vip.id)
    const everyNightEnd = new Date(event.startsAt.getTime() - hour)
    const oneNightEnd = new Date(session.startsAt.getTime())

    everyNight.salesEndAt = everyNightEnd
    oneNight.eventSessionId = session.id
    oneNight.salesEndAt = oneNightEnd

    const response = await reschedule(
      body({
        startsAt: event.startsAt.toISOString(),
        endsAt: event.endsAt.toISOString(),
        sessions: [
          {
            id: session.id,
            startsAt: new Date(session.startsAt.getTime() + hour).toISOString(),
            endsAt: new Date(session.endsAt.getTime() + hour).toISOString(),
          },
        ],
      }),
    )

    expect(response.statusCode).toBe(200)
    expect(everyNight.salesEndAt.getTime()).toBe(everyNightEnd.getTime())
    expect(oneNight.salesEndAt.getTime()).toBe(oneNightEnd.getTime() + hour)

    await app.close()
  })

  it('refuses a move that would leave a night’s tier selling after the night, and changes nothing', async () => {
    const { app, prisma, ids, event, session, body, reschedule, startsAt } =
      await postponedHarness()
    const hour = 60 * 60 * 1000
    const oneNight = prisma._store.ticketType.find((row) => row.id === ids.vip.id)
    const duration = session.endsAt.getTime() - session.startsAt.getTime()
    const oldEnd = new Date(session.endsAt.getTime())

    // Sales close as the night ends; the night comes back an hour shorter.
    oneNight.eventSessionId = session.id
    oneNight.salesEndAt = oldEnd

    const shorter = new Date(startsAt.getTime() + duration - hour)
    const response = await reschedule(
      body({
        endsAt: shorter.toISOString(),
        sessions: [
          { id: session.id, startsAt: startsAt.toISOString(), endsAt: shorter.toISOString() },
        ],
      }),
    )

    expect(response.statusCode).toBe(422)
    expect(response.json().error.problems).toEqual([
      'Ticket type "VIP Table": its sales window moves with its session, and would then close after the session has finished. Change its sales window first, or give the session a later end.',
    ])
    expect(event.status).toBe('POSTPONED')
    expect(oneNight.salesEndAt.getTime()).toBe(oldEnd.getTime())

    await app.close()
  })

  it('asks for a recent step-up', async () => {
    const { app, event, body, reschedule } = await postponedHarness({ stepUp: false })

    const response = await reschedule(body())

    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('STEP_UP_REQUIRED')
    expect(event.status).toBe('POSTPONED')

    await app.close()
  })

  it('refuses a stepped-up member without the authority, and changes nothing', async () => {
    // A VIEWER holding a second factor and a fresh step-up: the step-up guard
    // lets the request through, so the refusal can only be the handler's own
    // authority check. Without one, this would be a reschedule.
    const { app, prisma, event, session, body, reschedule } = await postponedHarness({
      email: 'finance@rangoli.example',
      enrol: true,
    })
    const startsBefore = event.startsAt.getTime()
    const sessionBefore = session.startsAt.getTime()
    const outbox = prisma._store.notificationOutbox.length

    const response = await reschedule(body())

    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('FORBIDDEN')

    const stored = prisma._store.event.find((row) => row.id === event.id)
    const storedSession = prisma._store.eventSession.find((row) => row.id === session.id)

    expect(stored.status).toBe('POSTPONED')
    expect(stored.revision).toBe(3)
    expect(stored.startsAt.getTime()).toBe(startsBefore)
    expect(storedSession.startsAt.getTime()).toBe(sessionBefore)
    expect(prisma._store.notificationOutbox.length).toBe(outbox)
    expect(auditRows(prisma, 'event.rescheduled')).toHaveLength(0)

    await app.close()
  })

  it('refuses a stale revision and changes nothing, status included', async () => {
    const { app, prisma, event, session, body, reschedule } = await postponedHarness()
    const startsBefore = event.startsAt.getTime()
    const sessionBefore = session.startsAt.getTime()
    const outbox = prisma._store.notificationOutbox.length

    const response = await reschedule(body({ revision: 2 }))

    expect(response.statusCode).toBe(409)
    expect(response.json().error.code).toBe('STALE_REVISION')

    // Re-read from the store: a rolled-back transaction restores rows as copies.
    const stored = prisma._store.event.find((row) => row.id === event.id)
    const storedSession = prisma._store.eventSession.find((row) => row.id === session.id)

    expect(stored.status).toBe('POSTPONED')
    expect(stored.revision).toBe(3)
    expect(stored.startsAt.getTime()).toBe(startsBefore)
    expect(storedSession.startsAt.getTime()).toBe(sessionBefore)
    expect(prisma._store.notificationOutbox.length).toBe(outbox)
    expect(auditRows(prisma, 'event.rescheduled')).toHaveLength(0)
    expect(prisma._store.eventModerationAction.some((row) => row.toStatus === 'ON_SALE')).toBe(
      false,
    )

    await app.close()
  })

  it('refuses a start in the past, even with every night in the future', async () => {
    const { app, body, reschedule } = await postponedHarness()

    // Only the event's own start is past: the nights keep the harness's future
    // dates, so the refusal can come from nothing but the event-level check.
    const response = await reschedule(
      body({
        startsAt: minutesFromNow(-60).toISOString(),
        endsAt: minutesFromNow(60).toISOString(),
      }),
    )

    expect(response.statusCode).toBe(422)
    expect(response.json().error.problems).toContain('The new start is in the past.')
    expect(response.json().error.problems.join(' ')).not.toMatch(/The session starting/u)

    await app.close()
  })

  it('refuses a night left in the past, even with the event’s start in the future', async () => {
    const { app, session, body, reschedule } = await postponedHarness()
    const past = minutesFromNow(-60)

    const response = await reschedule(
      body({
        sessions: [
          {
            id: session.id,
            startsAt: past.toISOString(),
            endsAt: minutesFromNow(60).toISOString(),
          },
        ],
      }),
    )

    expect(response.statusCode).toBe(422)
    expect(response.json().error.problems).toContain(
      `The session starting ${past.toISOString()} is in the past. Give it a new date too.`,
    )
    expect(response.json().error.problems).not.toContain('The new start is in the past.')

    await app.close()
  })

  it('refuses a session of another event', async () => {
    const { app, prisma, ids, body, reschedule, startsAt, endsAt } = await postponedHarness()
    const foreign = prisma._store.eventSession.find((row) => row.eventId === ids.draftEvent.id)

    const response = await reschedule(
      body({
        sessions: [
          { id: foreign.id, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() },
        ],
      }),
    )

    expect(response.statusCode).toBe(422)
    expect(response.json().error.problems.join(' ')).toMatch(/different event/)

    await app.close()
  })

  it('refuses to reopen sales with nothing on sale, naming why', async () => {
    const { app, prisma, event, body, reschedule } = await postponedHarness()

    for (const tier of prisma._store.ticketType.filter((row) => row.eventId === event.id)) {
      tier.status = 'PAUSED'
    }

    const response = await reschedule(body())

    expect(response.statusCode).toBe(422)
    expect(response.json().error.problems.join(' ')).toMatch(/Put at least one ticket type on sale/)
    expect(event.status).toBe('POSTPONED')

    await app.close()
  })

  it('refuses an event that is not postponed', async () => {
    const { app, event, body, reschedule } = await postponedHarness()

    event.status = 'ON_SALE'

    const response = await reschedule(body())

    expect(response.statusCode).toBe(409)
    expect(response.json().error.code).toBe('ILLEGAL_TRANSITION')

    await app.close()
  })
})

describe('a night whose listing gave no end time', () => {
  // An imported night stores `startsAt + 3 h` as its end and is flagged
  // `endTimeListed = false`; no public page shows that estimate (SPEC2-XI §0
  // rule 9). Moving the whole night keeps it an estimate; an end set apart
  // from the start is the organiser's, and the public page shows it.

  it('stays an estimate when the night moves whole', async () => {
    const { app, session, body, reschedule } = await postponedHarness()
    const length = 3 * 60 * 60 * 1000

    session.endsAt = new Date(session.startsAt.getTime() + length)
    session.endTimeListed = false

    const startsAt = minutesFromNow(60 * 24 * 90)
    const endsAt = new Date(startsAt.getTime() + length)
    const response = await reschedule(
      body({
        sessions: [
          { id: session.id, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() },
        ],
      }),
    )

    expect(response.statusCode, response.body).toBe(200)
    expect(session.endsAt.getTime()).toBe(endsAt.getTime())
    expect(session.endTimeListed).toBe(false)

    await app.close()
  })

  it('becomes the listed end when the organiser sets a different one', async () => {
    const { app, session, body, reschedule, startsAt, endsAt } = await postponedHarness()

    session.endsAt = new Date(session.startsAt.getTime() + 3 * 60 * 60 * 1000)
    session.endTimeListed = false

    // The harness's night runs five hours, not the estimate's three.
    const response = await reschedule(body())

    expect(response.statusCode, response.body).toBe(200)
    expect(session.startsAt.getTime()).toBe(startsAt.getTime())
    expect(session.endsAt.getTime()).toBe(endsAt.getTime())
    expect(session.endTimeListed).toBe(true)

    await app.close()
  })
})

describe('a rejected event is reworked as a draft', () => {
  it('moves REJECTED to DRAFT and records the move', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = bearer(await signIn(app, 'arun@rangoli.example'))

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.rejectedEvent.id}/rework`,
      headers,
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.status).toBe('DRAFT')
    expect(prisma._store.eventModerationAction.at(-1)).toMatchObject({
      eventId: ids.rejectedEvent.id,
      fromStatus: 'REJECTED',
      toStatus: 'DRAFT',
    })
    expect(auditRows(prisma, 'event.draft').at(-1).entityId).toBe(ids.rejectedEvent.id)

    await app.close()
  })

  it('refuses to rework a draft (409 ILLEGAL_TRANSITION)', async () => {
    const { app, ids } = await createTestApp()
    const headers = bearer(await signIn(app, 'arun@rangoli.example'))

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.draftEvent.id}/rework`,
      headers,
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().error.code).toBe('ILLEGAL_TRANSITION')

    await app.close()
  })

  it('no longer lets withdraw-review rework a rejection', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = bearer(await signIn(app, 'arun@rangoli.example'))

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.rejectedEvent.id}/withdraw-review`,
      headers,
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().error.code).toBe('ILLEGAL_TRANSITION')
    expect(prisma._store.event.find((row) => row.id === ids.rejectedEvent.id).status).toBe(
      'REJECTED',
    )

    await app.close()
  })

  it('tells a stranger nothing', async () => {
    const { app, ids } = await createTestApp()
    const headers = bearer(await signIn(app, 'rival@dhol.example'))

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.draftEvent.id}/rework`,
      headers,
    })

    expect(response.statusCode).toBe(404)

    await app.close()
  })
})
