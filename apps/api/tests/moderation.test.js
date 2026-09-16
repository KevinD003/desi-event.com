import { describe, expect, it } from 'vitest'

import { bearer, createTestApp, signIn, stepUp } from './helpers/app.js'

/**
 * Sign in as the platform moderator the fixtures provide.
 *
 * @param {object} app The Fastify instance.
 * @returns {Promise<object>} Authorization headers.
 */
async function asModerator(app) {
  const token = await signIn(app, 'maya@desi-event.example')

  return bearer(token)
}

describe('the review queue', () => {
  it('answers with the counters its own contract requires', async () => {
    // It used to put them under `meta`, which is not the field
    // `eventListResponseSchema` names — so the serialiser refused the whole
    // response and the queue page showed an error instead of a queue. Nothing
    // had called this route, so nothing had noticed.
    const { app } = await createTestApp()

    const response = await app.inject({
      method: 'GET',
      url: '/v1/moderation/events',
      headers: await asModerator(app),
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().pagination).toMatchObject({
      page: 1,
      perPage: expect.any(Number),
      total: expect.any(Number),
    })

    await app.close()
  })

  it('shows what is waiting for review, and nothing else, by default', async () => {
    const { app, ids } = await createTestApp()

    const { data } = (
      await app.inject({
        method: 'GET',
        url: '/v1/moderation/events',
        headers: await asModerator(app),
      })
    ).json()

    expect(data.map((event) => event.id)).toEqual([ids.reviewPendingEvent.id])

    await app.close()
  })

  it('filters to a named state', async () => {
    const { app, ids } = await createTestApp()

    const { data } = (
      await app.inject({
        method: 'GET',
        url: '/v1/moderation/events?status=REJECTED',
        headers: await asModerator(app),
      })
    ).json()

    expect(data.map((event) => event.id)).toEqual([ids.rejectedEvent.id])

    await app.close()
  })

  it('is not open to an organiser, however senior', async () => {
    const { app } = await createTestApp()
    const token = await signIn(app, 'owner@rangoli.example')

    const response = await app.inject({
      method: 'GET',
      url: '/v1/moderation/events',
      headers: bearer(token),
    })

    // Moderation is a platform job. An organisation role, even OWNER, is
    // authority over that organisation's events and not over anybody else's.
    expect(response.statusCode).toBe(403)

    await app.close()
  })

  it('is not open to an anonymous caller', async () => {
    const { app } = await createTestApp()

    const response = await app.inject({ method: 'GET', url: '/v1/moderation/events' })

    expect(response.statusCode).toBe(401)

    await app.close()
  })
})

describe('a moderator deciding', () => {
  it('asks for a second factor confirmed recently', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await asModerator(app)

    // Signing in *is* confirming your identity, so a decision taken straight
    // afterwards goes through. The control is about what happens an hour
    // later, so an hour is what the session is given.
    for (const session of prisma._store.session) {
      session.mfaSatisfiedAt = new Date(Date.now() - 60 * 60 * 1000)
    }

    const response = await app.inject({
      method: 'POST',
      url: `/v1/moderation/events/${ids.reviewPendingEvent.id}/decision`,
      headers,
      payload: { decision: 'approve' },
    })

    // NF-11: the window comes from the route's contract entry, server-side,
    // and the browser can neither see it nor ask for a longer one.
    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('STEP_UP_REQUIRED')

    await app.close()
  })

  it('approves once the identity is confirmed, without publishing', async () => {
    const { app, ids } = await createTestApp()
    const headers = await asModerator(app)

    await stepUp(app, 'maya@desi-event.example', headers)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/moderation/events/${ids.reviewPendingEvent.id}/decision`,
      headers,
      payload: { decision: 'approve' },
    })

    expect(response.statusCode).toBe(200)

    // Approved is not published. Publishing is the organiser's decision and
    // their timing, and a moderator saying yes must not take it from them.
    expect(response.json().data.status).toBe('APPROVED')
    expect(response.json().data.publishedAt).toBeNull()

    await app.close()
  })

  it('records the reason and the specific changes asked for', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await asModerator(app)

    await stepUp(app, 'maya@desi-event.example', headers)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/moderation/events/${ids.reviewPendingEvent.id}/decision`,
      headers,
      payload: {
        decision: 'request_changes',
        reason: 'The description does not say which language the show is in.',
        requestedChanges: { description: 'Name the language.' },
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.status).toBe('CHANGES_REQUIRED')

    const [action] = prisma._store.eventModerationAction.filter(
      (row) => row.eventId === ids.reviewPendingEvent.id,
    )

    expect(action.fromStatus).toBe('REVIEW_PENDING')
    expect(action.toStatus).toBe('CHANGES_REQUIRED')
    expect(action.reason).toMatch(/which language/i)
    expect(action.requestedChanges).toEqual({ description: 'Name the language.' })
    expect(action.createdAt).toBeTruthy()

    await app.close()
  })

  it('accepts field notes without a paragraph, because they are the useful half', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await asModerator(app)

    await stepUp(app, 'maya@desi-event.example', headers)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/moderation/events/${ids.reviewPendingEvent.id}/decision`,
      headers,
      payload: {
        decision: 'request_changes',
        requestedChanges: { description: 'Name the language the show is in.' },
      },
    })

    expect(response.statusCode).toBe(200)

    const [action] = prisma._store.eventModerationAction.filter(
      (row) => row.eventId === ids.reviewPendingEvent.id,
    )

    expect(action.requestedChanges).toEqual({
      description: 'Name the language the show is in.',
    })

    await app.close()
  })

  it('still refuses a refusal that says nothing at all', async () => {
    // The rule was never "write a paragraph"; it was "say something the
    // organiser can act on". With neither prose nor a note, nothing was said.
    const { app, ids } = await createTestApp()
    const headers = await asModerator(app)

    await stepUp(app, 'maya@desi-event.example', headers)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/moderation/events/${ids.reviewPendingEvent.id}/decision`,
      headers,
      payload: { decision: 'request_changes' },
    })

    expect(response.statusCode).toBe(400)
    expect(JSON.stringify(response.json())).toMatch(/cannot be acted on/i)

    await app.close()
  })

  it('refuses a rejection with no reason, which has no field to point at', async () => {
    const { app, ids } = await createTestApp()
    const headers = await asModerator(app)

    await stepUp(app, 'maya@desi-event.example', headers)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/moderation/events/${ids.reviewPendingEvent.id}/decision`,
      headers,
      payload: { decision: 'reject', requestedChanges: { description: 'Not enough.' } },
    })

    expect(response.statusCode).toBe(400)

    await app.close()
  })

  it('refuses a decision on an event that is not waiting for one', async () => {
    const { app, ids } = await createTestApp()
    const headers = await asModerator(app)

    await stepUp(app, 'maya@desi-event.example', headers)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/moderation/events/${ids.publishedEvent.id}/decision`,
      headers,
      payload: { decision: 'approve' },
    })

    expect(response.statusCode).toBe(409)

    await app.close()
  })

  it('refuses an organiser pretending to be a moderator', async () => {
    const { app, ids } = await createTestApp()
    const token = await signIn(app, 'owner@rangoli.example')

    const response = await app.inject({
      method: 'POST',
      url: `/v1/moderation/events/${ids.reviewPendingEvent.id}/decision`,
      headers: bearer(token),
      payload: { decision: 'approve' },
    })

    expect(response.statusCode).toBe(403)

    await app.close()
  })
})
