/**
 * A moderator's hand on pictures, against the Prisma stub: approving an event
 * approves what it was shown, and a single picture can be taken down or put
 * back without touching the organiser's revision.
 */

import { describe, expect, it } from 'vitest'

import { bearer, createTestApp, signIn, stepUp } from './helpers/app.js'
import { seedPicture } from './helpers/media-world.js'

const MODERATOR = 'maya@desi-event.example'

/**
 * Sign in as the moderator, with a fresh step-up.
 *
 * @param {object} app The Fastify instance.
 * @returns {Promise<object>} Authorization headers.
 */
async function asModerator(app) {
  const headers = bearer(await signIn(app, MODERATOR))

  await stepUp(app, MODERATOR, headers)

  return headers
}

/**
 * Decide on one picture.
 *
 * @param {object} app The Fastify instance.
 * @param {object} headers Auth headers.
 * @param {string} id The asset id.
 * @param {object} payload The decision.
 * @returns {Promise<object>} The response.
 */
function decide(app, headers, id, payload) {
  return app.inject({
    method: 'POST',
    url: `/v1/moderation/media/${id}/decision`,
    headers,
    payload,
  })
}

describe('a decision on one picture', () => {
  it('is refused to an organiser, however senior', async () => {
    const { app, ids, prisma } = await createTestApp()
    const picture = seedPicture(prisma, { event: ids.publishedEvent })
    const headers = bearer(await signIn(app, 'owner@rangoli.example'))

    const response = await decide(app, headers, picture.id, { decision: 'reject', reason: 'Mine' })

    expect(response.statusCode).toBe(403)
    expect(prisma._store.mediaAsset[0].moderationStatus).toBe('APPROVED')

    await app.close()
  })

  it('asks a moderator for a second factor confirmed recently', async () => {
    const { app, ids, prisma } = await createTestApp()
    const picture = seedPicture(prisma, { event: ids.publishedEvent })
    const headers = bearer(await signIn(app, MODERATOR))

    for (const session of prisma._store.session) {
      session.mfaSatisfiedAt = new Date(Date.now() - 60 * 60 * 1000)
    }

    const response = await decide(app, headers, picture.id, { decision: 'reject', reason: 'x' })

    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('STEP_UP_REQUIRED')

    await app.close()
  })

  it('needs a reason to take a picture down', async () => {
    const { app, ids, prisma } = await createTestApp()
    const picture = seedPicture(prisma, { event: ids.publishedEvent })
    const headers = await asModerator(app)

    const response = await decide(app, headers, picture.id, { decision: 'reject' })

    expect(response.statusCode).toBe(400)

    await app.close()
  })

  it('takes an approved picture down: public 404 at once, note for the organiser, audited', async () => {
    const { app, ids, prisma } = await createTestApp()
    const picture = seedPicture(prisma, { event: ids.publishedEvent })
    const headers = await asModerator(app)

    expect((await app.inject({ method: 'GET', url: `/v1/media/${picture.id}` })).statusCode).toBe(
      200,
    )

    const response = await decide(app, headers, picture.id, {
      decision: 'reject',
      reason: 'Shows a child’s face without consent.',
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data).toMatchObject({
      id: picture.id,
      moderationStatus: 'REJECTED',
      rejectionReason: 'Shows a child’s face without consent.',
      publiclyVisible: false,
    })
    expect(response.json().meta.revision).toBe(0)

    expect((await app.inject({ method: 'GET', url: `/v1/media/${picture.id}` })).statusCode).toBe(
      404,
    )
    expect(
      (await app.inject({ method: 'GET', url: '/v1/events/navratri-garba-night' })).json().data
        .coverImage,
    ).toBeNull()

    const row = prisma._store.mediaAsset[0]

    expect(row.moderatedById).toBe(ids.moderator.id)
    expect(row.moderatedAt).toBeInstanceOf(Date)
    expect(row.moderationNote).toBe('Shows a child’s face without consent.')

    const audit = prisma._store.auditLog.find(
      (entry) => entry.action === 'moderation.media_rejected',
    )

    expect(audit).toMatchObject({
      entityType: 'MediaAsset',
      entityId: picture.id,
      actorId: ids.moderator.id,
    })
    expect(audit.metadata).toMatchObject({
      eventId: ids.publishedEvent.id,
      from: 'APPROVED',
      to: 'REJECTED',
    })
    expect(JSON.stringify(audit.metadata)).not.toContain(picture.altText)

    await app.close()
  })

  it('puts a rejected picture back, clearing the note', async () => {
    const { app, ids, prisma } = await createTestApp()
    const picture = seedPicture(prisma, { event: ids.publishedEvent, moderationStatus: 'REJECTED' })
    const headers = await asModerator(app)

    const response = await decide(app, headers, picture.id, { decision: 'approve' })

    expect(response.statusCode).toBe(200)
    expect(response.json().data).toMatchObject({
      moderationStatus: 'APPROVED',
      rejectionReason: null,
      publiclyVisible: true,
    })
    expect(prisma._store.mediaAsset[0].moderationNote).toBeNull()
    expect(
      prisma._store.auditLog.some((entry) => entry.action === 'moderation.media_approved'),
    ).toBe(true)

    await app.close()
  })

  it('refuses a decision that does not apply, and one somebody else made first', async () => {
    const { app, ids, prisma } = await createTestApp()
    const picture = seedPicture(prisma, { event: ids.publishedEvent })
    const headers = await asModerator(app)

    const again = await decide(app, headers, picture.id, { decision: 'approve' })

    expect(again.statusCode).toBe(409)

    // Two moderators at once: the second reads APPROVED and writes after the
    // first has already moved it.
    const original = prisma.mediaAsset.findUnique
    prisma.mediaAsset.findUnique = async (args) => {
      const found = await original(args)

      prisma._store.mediaAsset[0].moderationStatus = 'REJECTED'
      prisma._store.mediaAsset[0].moderationNote = 'Another moderator'
      prisma.mediaAsset.findUnique = original

      return found
    }

    const raced = await decide(app, headers, picture.id, { decision: 'reject', reason: 'Mine' })

    expect(raced.statusCode).toBe(409)
    expect(raced.json().error.code).toBe('MEDIA_CHANGED')
    expect(prisma._store.mediaAsset[0].moderationNote).toBe('Another moderator')

    await app.close()
  })

  it('is a 404 for no such picture', async () => {
    const { app } = await createTestApp()
    const headers = await asModerator(app)

    expect(
      (await decide(app, headers, 'cnosuchpicture0000000000', { decision: 'approve' })).statusCode,
    ).toBe(404)

    await app.close()
  })

  it('leaves the event revision alone, so an organiser mid-edit is not interrupted', async () => {
    const { app, ids, prisma } = await createTestApp()
    const picture = seedPicture(prisma, { event: ids.draftEvent, moderationStatus: 'PENDING' })
    const headers = await asModerator(app)

    await decide(app, headers, picture.id, { decision: 'reject', reason: 'Not the event.' })

    expect(prisma._store.event.find((row) => row.id === ids.draftEvent.id).revision).toBe(0)

    const organiser = bearer(await signIn(app, 'arun@rangoli.example'))
    const edit = await app.inject({
      method: 'PATCH',
      url: `/v1/events/${ids.draftEvent.id}/media/${picture.id}`,
      headers: organiser,
      payload: { revision: 0, altText: 'The stage from the back' },
    })

    expect(edit.statusCode).toBe(200)

    await app.close()
  })
})

describe('deciding on the event decides its waiting pictures', () => {
  it('approves every picture still waiting, in the same transaction, and audits each', async () => {
    const { app, ids, prisma } = await createTestApp()
    const cover = seedPicture(prisma, {
      event: ids.reviewPendingEvent,
      moderationStatus: 'PENDING',
    })
    const gallery = seedPicture(prisma, {
      event: ids.reviewPendingEvent,
      kind: 'EVENT_GALLERY',
      moderationStatus: 'PENDING',
    })
    const rejected = seedPicture(prisma, {
      event: ids.reviewPendingEvent,
      kind: 'EVENT_GALLERY',
      position: 1,
      moderationStatus: 'REJECTED',
    })
    const headers = await asModerator(app)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/moderation/events/${ids.reviewPendingEvent.id}/decision`,
      headers,
      payload: { decision: 'approve' },
    })

    expect(response.statusCode).toBe(200)

    const status = (id) => prisma._store.mediaAsset.find((row) => row.id === id).moderationStatus

    expect(status(cover.id)).toBe('APPROVED')
    expect(status(gallery.id)).toBe('APPROVED')
    // A moderator's own takedown stands.
    expect(status(rejected.id)).toBe('REJECTED')

    const approvals = prisma._store.auditLog.filter(
      (entry) => entry.action === 'moderation.media_approved',
    )

    expect(approvals.map((entry) => entry.entityId).sort()).toEqual([cover.id, gallery.id].sort())
    expect(approvals.every((entry) => entry.metadata.via === 'event_approval')).toBe(true)
    expect(prisma._store.mediaAsset.find((row) => row.id === cover.id).moderatedById).toBe(
      ids.moderator.id,
    )

    await app.close()
  })

  it('refuses a stale approval after withdraw, upload and resubmit, and approves nothing', async () => {
    const { app, ids, prisma } = await createTestApp()
    const shown = seedPicture(prisma, {
      event: ids.reviewPendingEvent,
      moderationStatus: 'PENDING',
    })
    const moderator = await asModerator(app)
    const organiser = bearer(await signIn(app, 'arun@rangoli.example'))
    const eventRow = () => prisma._store.event.find((row) => row.id === ids.reviewPendingEvent.id)
    // What the moderator's page rendered.
    const reviewed = eventRow().revision ?? 0

    // Meanwhile the organiser pulls the event back, swaps the cover for one
    // nobody has seen, and sends it back for review.
    const withdrawn = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.reviewPendingEvent.id}/withdraw-review`,
      headers: organiser,
    })

    expect(withdrawn.statusCode).toBe(200)

    const { solidPng } = await import('./helpers/images.js')
    const uploaded = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.reviewPendingEvent.id}/media?kind=EVENT_COVER&altText=A%20different%20cover&revision=${reviewed}`,
      headers: { ...organiser, 'content-type': 'image/png' },
      payload: solidPng(1200, 630),
    })

    expect(uploaded.statusCode).toBe(201)

    const unseen = uploaded.json().data.id

    const resubmitted = await app.inject({
      method: 'POST',
      url: `/v1/events/${ids.reviewPendingEvent.id}/submit-review`,
      headers: organiser,
      payload: {},
    })

    // Back in review: to a check of the status alone, exactly as before.
    expect(resubmitted.statusCode).toBe(200)
    expect(eventRow().status).toBe('REVIEW_PENDING')

    const stale = await app.inject({
      method: 'POST',
      url: `/v1/moderation/events/${ids.reviewPendingEvent.id}/decision`,
      headers: moderator,
      payload: { decision: 'approve', revision: reviewed },
    })

    expect(stale.statusCode).toBe(409)
    expect(stale.json().error.code).toBe('STALE_REVISION')
    expect(eventRow().status).toBe('REVIEW_PENDING')
    expect(prisma._store.mediaAsset.find((row) => row.id === unseen).moderationStatus).toBe(
      'PENDING',
    )
    expect(
      prisma._store.auditLog.some((entry) => entry.action === 'moderation.media_approved'),
    ).toBe(false)
    // The replaced cover went with the organiser's write; nothing else moved.
    expect(prisma._store.mediaAsset.some((row) => row.id === shown.id)).toBe(false)

    // Reviewing the version that is waiting now, the approval goes through.
    const current = await app.inject({
      method: 'POST',
      url: `/v1/moderation/events/${ids.reviewPendingEvent.id}/decision`,
      headers: moderator,
      payload: { decision: 'approve', revision: eventRow().revision },
    })

    expect(current.statusCode).toBe(200)
    expect(prisma._store.mediaAsset.find((row) => row.id === unseen).moderationStatus).toBe(
      'APPROVED',
    )

    await app.close()
  })

  it('refuses a stale request for changes too, before any gate runs', async () => {
    const { app, ids, prisma } = await createTestApp()
    const moderator = await asModerator(app)
    const eventRow = prisma._store.event.find((row) => row.id === ids.reviewPendingEvent.id)
    const reviewed = eventRow.revision ?? 0

    eventRow.revision = reviewed + 3

    const response = await app.inject({
      method: 'POST',
      url: `/v1/moderation/events/${ids.reviewPendingEvent.id}/decision`,
      headers: moderator,
      payload: { decision: 'request_changes', reason: 'Add a map.', revision: reviewed },
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().error.code).toBe('STALE_REVISION')
    expect(eventRow.status).toBe('REVIEW_PENDING')
    expect(
      prisma._store.eventModerationAction.filter((row) => row.eventId === eventRow.id),
    ).toHaveLength(0)

    await app.close()
  })

  it.each(['request_changes', 'reject'])('leaves them waiting on %s', async (decision) => {
    const { app, ids, prisma } = await createTestApp()
    const cover = seedPicture(prisma, {
      event: ids.reviewPendingEvent,
      moderationStatus: 'PENDING',
    })
    const headers = await asModerator(app)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/moderation/events/${ids.reviewPendingEvent.id}/decision`,
      headers,
      payload: { decision, reason: 'Please add a venue map.' },
    })

    expect(response.statusCode).toBe(200)
    expect(prisma._store.mediaAsset.find((row) => row.id === cover.id).moderationStatus).toBe(
      'PENDING',
    )
    expect(
      prisma._store.auditLog.some((entry) => entry.action === 'moderation.media_approved'),
    ).toBe(false)

    await app.close()
  })
})
