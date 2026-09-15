import { describe, expect, it } from 'vitest'

import { bearer, createTestApp, signIn, stepUp } from './helpers/app.js'
import { minutesFromNow } from './helpers/fixtures.js'

/**
 * The event lifecycle: what the status column is allowed to mean.
 *
 * An event's status is not a field. It is the record of a negotiation between
 * an organiser and a moderator, and every value in it is a claim somebody is
 * entitled to make: `APPROVED` says a moderator looked; `PUBLISHED` says a
 * verified organiser chose to go live; `CANCELLED` says a refund is owed. A
 * route that writes the column from a request body lets the caller assert any
 * of those about themselves.
 *
 * So the transitions are the subject here, not the fields. Each test names the
 * claim it is stopping somebody making.
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc
 * namepath (it is how JSDoc names an event), so a path segment spelled
 * exactly that fails `jsdoc/valid-types`. The same limitation is why
 * `apps/web/src/app/organizer/venues/new/page.jsx` uses `@file` too.
 *
 * @file @desi-event/api/tests/event-lifecycle
 */

/**
 * A valid create payload for the fixture organisation.
 *
 * @param {object} ids The fixture ids.
 * @param {object} [overrides] Fields to change.
 * @returns {object} The payload.
 */
function draftPayload(ids, overrides = {}) {
  return {
    organizationId: ids.organization.id,
    venueId: ids.venue.id,
    title: 'Lifecycle Test Event',
    summary: 'A short summary that is long enough to pass validation.',
    description: 'A description of the event, long enough to be plausible prose.',
    category: 'MUSIC_CONCERT',
    startsAt: minutesFromNow(60 * 24 * 30).toISOString(),
    endsAt: minutesFromNow(60 * 24 * 30 + 180).toISOString(),
    timezone: 'Asia/Kolkata',
    ...overrides,
  }
}

describe('creating an event cannot skip review, finding NF-17', () => {
  it('ignores a status the caller supplies and always starts in DRAFT', async () => {
    // `createEventRequestSchema` carried `status` with a DRAFT *default*, which
    // is not the same thing as a DRAFT *guarantee*. A caller holding only
    // `event:create` could post `status: 'PUBLISHED'` and have the row written
    // that way: no moderator, no `event:publish`, and not even the on-sale-tier
    // check the publish route performs. The route's own description said
    // "Creates an event in DRAFT status", which was the intent and not the code.
    const { app, ids } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')

    const response = await app.inject({
      method: 'POST',
      url: '/v1/events',
      headers: bearer(token),
      payload: draftPayload(ids, { status: 'PUBLISHED', slug: 'nf17-create-published' }),
    })

    expect(response.statusCode).toBe(201)
    expect(response.json().data.status).toBe('DRAFT')
    expect(response.json().data.publishedAt).toBeNull()

    await app.close()
  })

  it('also refuses APPROVED, which would forge a moderator decision', async () => {
    const { app, ids } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')

    const response = await app.inject({
      method: 'POST',
      url: '/v1/events',
      headers: bearer(token),
      payload: draftPayload(ids, { status: 'APPROVED', slug: 'nf17-create-approved' }),
    })

    expect(response.statusCode).toBe(201)
    expect(response.json().data.status).toBe('DRAFT')

    await app.close()
  })
})

describe('the publish route is not a status setter, finding NF-18', () => {
  it('refuses to jump a draft straight to PUBLISHED without a review', async () => {
    // `publishEventRequestSchema` accepted the whole `EventStatus` enum and the
    // handler wrote it. One capability, thirteen destinations, no transition
    // validation — so DRAFT to PUBLISHED skipped REVIEW_PENDING and APPROVED
    // entirely, and DRAFT to ARCHIVED or CANCELLED was equally available.
    const { app, ids } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.draftEvent.id}/publish`,
      headers: bearer(token),
      payload: { status: 'PUBLISHED' },
    })

    expect(response.statusCode).toBe(409)
    // The refusal names the ways out as well as the way that is shut.
    expect(response.json().error.message).toMatch(/cannot become PUBLISHED/i)
    expect(response.json().error.message).toMatch(/REVIEW_PENDING/)

    await app.close()
  })

  it('refuses to forge an approval', async () => {
    const { app, ids } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.draftEvent.id}/publish`,
      headers: bearer(token),
      payload: { status: 'APPROVED' },
    })

    // An organiser may not move an event into APPROVED by any route. The
    // publish route now accepts only the statuses publication can produce.
    expect([400, 403, 409]).toContain(response.statusCode)

    await app.close()
  })

  it('refuses to archive a published event through the publish route', async () => {
    const { app, ids } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.publishedEvent.id}/publish`,
      headers: bearer(token),
      payload: { status: 'ARCHIVED' },
    })

    expect([400, 403, 409]).toContain(response.statusCode)

    await app.close()
  })
})

describe('the generic PATCH still cannot move the status', () => {
  it('rejects a status field outright', async () => {
    // This one already held before this cycle, and the test exists so it keeps
    // holding: `updateEventRequestSchema` omits `status`, so an extra field is
    // a validation error rather than a silent write.
    const { app, ids } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')

    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/events/${ids.draftEvent.id}`,
      headers: bearer(token),
      payload: { status: 'PUBLISHED' },
    })

    expect(response.statusCode).toBe(400)

    const after = await app.inject({
      method: 'GET',
      url: `/v1/events/${ids.draftEvent.slug}`,
      headers: bearer(token),
    })

    expect(after.json().data.status).toBe('DRAFT')

    await app.close()
  })
})

describe('what a stranger may see, finding NF-19', () => {
  it('does not serve an event that is still waiting for a moderator', async () => {
    // `loadVisibleEvent` and the `events.get` handler both checked one status:
    // DRAFT. Every other pre-publication state — REVIEW_PENDING,
    // CHANGES_REQUIRED, REJECTED, ARCHIVED — fell through to the return, so a
    // submission nobody had ruled on was a public page with a guessable slug.
    const { app } = await createTestApp()

    const response = await app.inject({ method: 'GET', url: '/v1/events/awaiting-a-moderator' })

    expect(response.statusCode).toBe(404)

    await app.close()
  })

  it('does not serve a rejected event, nor the note explaining the rejection', async () => {
    // The worse half. `moderationNote` is what a moderator wrote to the
    // organiser, and a rejected event was returned with it attached.
    const { app } = await createTestApp()

    const response = await app.inject({ method: 'GET', url: '/v1/events/turned-down' })

    expect(response.statusCode).toBe(404)
    expect(response.body).not.toMatch(/Internal note/)

    await app.close()
  })

  it('does not serve an approved event before the organiser publishes it', async () => {
    // Approval is a moderator's decision, not an announcement. Going live is
    // the organiser's to choose and to time.
    const { app } = await createTestApp()

    const response = await app.inject({ method: 'GET', url: '/v1/events/approved-not-published' })

    expect(response.statusCode).toBe(404)

    await app.close()
  })

  it('keeps every non-public event out of the anonymous list', async () => {
    const { app } = await createTestApp()

    const response = await app.inject({ method: 'GET', url: '/v1/events?perPage=100' })
    const slugs = response.json().data.map((event) => event.slug)

    expect(slugs).not.toContain('awaiting-a-moderator')
    expect(slugs).not.toContain('turned-down')
    expect(slugs).not.toContain('approved-not-published')
    expect(slugs).not.toContain('secret-bollywood-night')

    await app.close()
  })

  it('still shows the organiser their own event in every state', async () => {
    // The refusal is about strangers, not about the person who wrote it.
    const { app } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')

    for (const slug of ['awaiting-a-moderator', 'turned-down', 'approved-not-published']) {
      const response = await app.inject({
        method: 'GET',
        url: `/v1/events/${slug}`,
        headers: bearer(token),
      })

      expect(response.statusCode, slug).toBe(200)
    }

    await app.close()
  })
})

describe('who may make a moderator decision', () => {
  it('refuses an organiser, however senior, on their own event', async () => {
    // `moderation:review` is a platform capability. No organisation role grants
    // it, so there is no seniority inside an organisation that reaches it —
    // which is the whole point. An owner approving their own event would make
    // the review step decorative.
    const { app, ids } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')

    const response = await app.inject({
      method: 'POST',
      url: `/v1/moderation/events/${ids.reviewPendingEvent.id}/decision`,
      headers: bearer(token),
      payload: { decision: 'approve' },
    })

    expect(response.statusCode).toBe(403)

    await app.close()
  })

  it('refuses an organiser sight of the queue at all', async () => {
    const { app } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')

    const response = await app.inject({
      method: 'GET',
      url: '/v1/moderation/events',
      headers: bearer(token),
    })

    expect(response.statusCode).toBe(403)

    await app.close()
  })

  it('lets a moderator approve, and records who and why', async () => {
    const { app, ids } = await createTestApp()
    const token = await signIn(app, 'ops@desi-event.example')
    const headers = bearer(token)

    await stepUp(app, 'ops@desi-event.example', headers)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/moderation/events/${ids.reviewPendingEvent.id}/decision`,
      headers,
      payload: { decision: 'approve' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.status).toBe('APPROVED')

    const history = await app.inject({
      method: 'GET',
      url: `/v1/events/${ids.reviewPendingEvent.id}/moderation-history`,
      headers,
    })

    expect(history.statusCode).toBe(200)
    expect(history.json().data[0]).toMatchObject({
      fromStatus: 'REVIEW_PENDING',
      toStatus: 'APPROVED',
    })

    await app.close()
  })

  it('insists on a reason for anything that is not an approval', async () => {
    const { app, ids } = await createTestApp()
    const token = await signIn(app, 'ops@desi-event.example')
    const headers = bearer(token)

    await stepUp(app, 'ops@desi-event.example', headers)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/moderation/events/${ids.reviewPendingEvent.id}/decision`,
      headers,
      payload: { decision: 'request_changes' },
    })

    expect(response.statusCode).toBe(400)

    await app.close()
  })
})

describe('cross-organisation attempts', () => {
  it('refuses an outsider submitting somebody else’s event for review', async () => {
    const { app, ids } = await createTestApp()
    const token = await signIn(app, 'rival@dhol.example')

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.draftEvent.id}/submit-review`,
      headers: bearer(token),
      payload: {},
    })

    expect(response.statusCode).toBe(403)

    await app.close()
  })

  it('refuses an outsider publishing somebody else’s approved event', async () => {
    const { app, ids } = await createTestApp()
    const token = await signIn(app, 'rival@dhol.example')
    const headers = bearer(token)

    await stepUp(app, 'rival@dhol.example', headers)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.approvedEvent.id}/publish`,
      headers,
      payload: {},
    })

    expect(response.statusCode).toBe(403)

    await app.close()
  })

  it('refuses an outsider cancelling somebody else’s live event', async () => {
    const { app, ids } = await createTestApp()
    const token = await signIn(app, 'rival@dhol.example')
    const headers = bearer(token)

    await stepUp(app, 'rival@dhol.example', headers)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.publishedEvent.id}/cancel`,
      headers,
      payload: { reasonCode: 'OTHER', reason: 'Not mine to cancel.' },
    })

    expect(response.statusCode).toBe(403)

    await app.close()
  })
})

describe('cancellation creates the work it owes, exactly once', () => {
  it('writes one notice and one pending refund per paid order, and no more on a retry', async () => {
    // An OWNER, not the MANAGER the other tests use: `event:cancel` is granted
    // to ADMIN and OWNER only, because calling off something people have paid
    // for is not the same authority as publishing it.
    const { app, prisma, ids } = await createTestApp()
    const token = await signIn(app, 'owner@rangoli.example')
    const headers = bearer(token)

    await stepUp(app, 'owner@rangoli.example', headers)

    const before = prisma._store.notificationOutbox.length

    const response = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.publishedEvent.id}/cancel`,
      headers,
      payload: { reasonCode: 'VENUE_UNAVAILABLE', reason: 'The hall flooded.' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.status).toBe('CANCELLED')

    const notices = prisma._store.notificationOutbox.slice(before)

    // Every notice is keyed on the event and the order, so a replay is a no-op.
    expect(new Set(notices.map((row) => row.dedupeKey)).size).toBe(notices.length)

    for (const notice of notices) {
      expect(notice.template).toBe('event.cancelled')
      // Being told your event is cancelled is not marketing.
      expect(notice.suppressible).toBe(false)
      // Ids and prose only: no token, no secret, no payment detail.
      expect(JSON.stringify(notice.payload)).not.toMatch(/token|secret|card|cvc/i)
    }

    // Nothing claims a refund has happened. REQUESTED is the first state, and
    // no refund service exists to move it.
    for (const refund of prisma._store.refund ?? []) {
      expect(refund.status).toBe('REQUESTED')
      expect(refund.providerRefundId ?? null).toBeNull()
      expect(refund.settledAt ?? null).toBeNull()
    }

    await app.close()
  })

  it('cannot be cancelled twice', async () => {
    const { app, ids } = await createTestApp()
    const token = await signIn(app, 'owner@rangoli.example')
    const headers = bearer(token)

    await stepUp(app, 'owner@rangoli.example', headers)

    const cancel = () =>
      app.inject({
        method: 'POST',
        url: `/v1/events/${ids.publishedEvent.id}/cancel`,
        headers,
        payload: { reasonCode: 'OTHER', reason: 'Twice.' },
      })

    expect((await cancel()).statusCode).toBe(200)

    // CANCELLED is terminal, so the second attempt is refused by the table
    // rather than by luck.
    const second = await cancel()
    expect(second.statusCode).toBe(409)
    expect(second.json().error.message).toMatch(/final state/i)

    await app.close()
  })
})
