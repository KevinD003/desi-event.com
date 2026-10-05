/**
 * Reviewers are independent of what they review (SPEC2 §6, P-17).
 *
 * An event is public only after somebody on the Desi-Event team other than
 * the people running it has approved it. Two refusals make that true:
 *
 *   - `CONFLICT_OF_INTEREST`: the reviewer is a member of the organisation —
 *     for event decisions, picture decisions and verification decisions;
 *   - `SELF_REVIEW`: the reviewer sent the event for review — so a super
 *     administrator, who holds both `event:submit_review` and
 *     `moderation:review`, cannot submit, approve and publish alone.
 *
 * Each is tried through the routes, and the move list a reviewer reads says
 * why the move is not theirs.
 *
 * @module @desi-event/api/tests/moderation-independence
 */

import { describe, expect, it } from 'vitest'

import { REVIEW_INDEPENDENCE, reviewIndependence } from '../src/lib/review-independence.js'
import { makeWorld } from './helpers/fixtures.js'
import { bearer, createTestApp, signIn, stepUp } from './helpers/app.js'
import { seedPicture } from './helpers/media-world.js'
import { cuid } from './helpers/prisma-stub.js'

const MODERATOR = 'maya@desi-event.example'
const SUPER_ADMIN = 'ops@desi-event.example'
const ADMIN = 'anil@desi-event.example'

/**
 * A world in which a platform account also holds a membership.
 *
 * @param {object} [options] Inputs.
 * @param {string} [options.email] The platform account given a membership.
 * @param {function(object): string} [options.organization] Which organisation.
 * @returns {Promise<object>} The harness.
 */
async function worldWithMember({
  email = MODERATOR,
  organization = (ids) => ids.organization.id,
} = {}) {
  const world = await makeWorld()
  const user = world.seed.user.find((row) => row.email === email)

  world.seed.membership.push({
    id: cuid(),
    userId: user.id,
    organizationId: organization(world.ids),
    role: 'VIEWER',
    createdAt: new Date(),
  })

  return createTestApp({ seed: world.seed, ids: world.ids })
}

/**
 * Sign in with a fresh second factor.
 *
 * @param {object} app The instance.
 * @param {string} email Who.
 * @returns {Promise<object>} Headers.
 */
async function reviewer(app, email) {
  const headers = bearer(await signIn(app, email))

  await stepUp(app, email, headers)

  return headers
}

/**
 * Decide on an event.
 *
 * @param {object} app The instance.
 * @param {object} headers Whose session.
 * @param {object} event The event row.
 * @param {object} [payload] The decision.
 * @returns {Promise<object>} The inject result.
 */
function decide(app, headers, event, payload = { decision: 'approve' }) {
  return app.inject({
    method: 'POST',
    url: `/v1/moderation/events/${event.id}/decision`,
    headers,
    payload: { revision: event.revision, ...payload },
  })
}

/**
 * The moves a caller is offered for an event.
 *
 * @param {object} app The instance.
 * @param {object} headers Whose session.
 * @param {string} eventId The event.
 * @returns {Promise<object[]>} The transitions.
 */
async function transitions(app, headers, eventId) {
  const response = await app.inject({
    method: 'GET',
    url: `/v1/events/${eventId}/transitions`,
    headers,
  })

  expect(response.statusCode).toBe(200)

  return response.json().data.transitions
}

describe('a reviewer who belongs to the organisation (CONFLICT_OF_INTEREST)', () => {
  it('cannot decide its event, and the event is untouched', async () => {
    const { app, prisma, ids } = await worldWithMember()
    const event = prisma._store.event.find((row) => row.id === ids.reviewPendingEvent.id)

    for (const decision of [
      { decision: 'approve' },
      { decision: 'reject', reason: 'Not suitable.' },
      { decision: 'request_changes', reason: 'Add the venue rules.' },
    ]) {
      const response = await decide(app, await reviewer(app, MODERATOR), event, decision)

      expect(response.statusCode, decision.decision).toBe(403)
      expect(response.json().error).toEqual(
        expect.objectContaining({
          code: 'CONFLICT_OF_INTEREST',
          message: REVIEW_INDEPENDENCE.CONFLICT_OF_INTEREST.message,
        }),
      )
    }

    expect(event.status).toBe('REVIEW_PENDING')
    expect(
      prisma._store.eventModerationAction.filter(
        (row) => row.eventId === event.id && row.toStatus !== 'REVIEW_PENDING',
      ),
    ).toHaveLength(0)

    // Somebody else on the team decides it.
    const independent = await decide(app, await reviewer(app, ADMIN), event)

    expect(independent.statusCode).toBe(200)
    expect(event.status).toBe('APPROVED')

    await app.close()
  })

  it('is shown the decision as not theirs, with the reason', async () => {
    const { app, ids } = await worldWithMember()

    const moves = await transitions(
      app,
      bearer(await signIn(app, MODERATOR)),
      ids.reviewPendingEvent.id,
    )
    const decisions = moves.filter((move) => move.actor === 'moderator')

    expect(decisions.length).toBeGreaterThan(0)

    for (const move of decisions) {
      expect(move.entitled, move.to).toBe(false)
      expect(move.blockers).toContain(REVIEW_INDEPENDENCE.CONFLICT_OF_INTEREST.message)
    }

    const independent = await transitions(
      app,
      bearer(await signIn(app, ADMIN)),
      ids.reviewPendingEvent.id,
    )

    const offered = independent.filter((move) => move.actor === 'moderator')

    expect(offered.length).toBeGreaterThan(0)
    expect(offered.every((move) => move.entitled)).toBe(true)

    await app.close()
  })

  it("cannot decide one of its event's pictures", async () => {
    const { app, prisma, ids } = await worldWithMember()
    const picture = seedPicture(prisma, {
      event: ids.publishedEvent,
      moderationStatus: 'PENDING',
    })

    const response = await app.inject({
      method: 'POST',
      url: `/v1/moderation/media/${picture.id}/decision`,
      headers: await reviewer(app, MODERATOR),
      payload: { decision: 'reject', reason: 'Blurry.' },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('CONFLICT_OF_INTEREST')
    expect(prisma._store.mediaAsset.find((row) => row.id === picture.id).moderationStatus).toBe(
      'PENDING',
    )

    await app.close()
  })

  it("cannot decide the organisation's verification", async () => {
    const { app, prisma, ids } = await worldWithMember({
      email: SUPER_ADMIN,
      organization: (worldIds) => worldIds.grandfatheredOrganization.id,
    })
    const organization = prisma._store.organization.find(
      (row) => row.id === ids.grandfatheredOrganization.id,
    )

    organization.verificationStatus = 'PENDING'

    const url = `/v1/organizations/${organization.id}/verification/decision`
    const payload = { decision: 'VERIFIED', reason: 'Registry record matches the legal name.' }

    const member = await app.inject({
      method: 'POST',
      url,
      headers: await reviewer(app, SUPER_ADMIN),
      payload,
    })

    expect(member.statusCode).toBe(403)
    expect(member.json().error.code).toBe('CONFLICT_OF_INTEREST')
    expect(organization.verificationStatus).toBe('PENDING')
    expect(prisma._store.organizationVerificationEvent).toHaveLength(0)

    const independent = await app.inject({
      method: 'POST',
      url,
      headers: await reviewer(app, MODERATOR),
      payload,
    })

    expect(independent.statusCode).toBe(200)
    expect(organization.verificationStatus).toBe('VERIFIED')

    await app.close()
  })
})

describe('a reviewer who sent the event for review (SELF_REVIEW)', () => {
  /**
   * Record that an account sent the event for review, as the submit route does.
   *
   * @param {object} prisma The stub.
   * @param {string} eventId The event.
   * @param {string} actorId Who sent it.
   * @param {Date} [createdAt] When.
   * @returns {void} Nothing.
   */
  function submittedBy(prisma, eventId, actorId, createdAt = new Date()) {
    prisma._store.eventModerationAction.push({
      id: cuid(),
      eventId,
      actorId,
      fromStatus: 'DRAFT',
      toStatus: 'REVIEW_PENDING',
      reason: null,
      requestedChanges: null,
      createdAt,
    })
  }

  it('cannot approve it, even holding every capability; another reviewer can', async () => {
    const { app, prisma, ids } = await createTestApp()
    const event = prisma._store.event.find((row) => row.id === ids.reviewPendingEvent.id)

    submittedBy(prisma, event.id, ids.platformAdmin.id)

    const self = await decide(app, await reviewer(app, SUPER_ADMIN), event)

    expect(self.statusCode).toBe(403)
    expect(self.json().error).toEqual(
      expect.objectContaining({
        code: 'SELF_REVIEW',
        message: REVIEW_INDEPENDENCE.SELF_REVIEW.message,
      }),
    )
    expect(event.status).toBe('REVIEW_PENDING')

    const moves = await transitions(app, bearer(await signIn(app, SUPER_ADMIN)), event.id)

    const decisions = moves.filter((candidate) => candidate.actor === 'moderator')

    expect(decisions.length).toBeGreaterThan(0)

    for (const move of decisions) {
      expect(move.entitled, move.to).toBe(false)
      expect(move.blockers).toContain(REVIEW_INDEPENDENCE.SELF_REVIEW.message)
    }

    const other = await decide(app, await reviewer(app, MODERATOR), event)

    expect(other.statusCode).toBe(200)
    expect(event.status).toBe('APPROVED')

    await app.close()
  })

  it('is judged by the latest submission: an earlier one by somebody else does not excuse it', async () => {
    const { app, prisma, ids } = await createTestApp()
    const event = prisma._store.event.find((row) => row.id === ids.reviewPendingEvent.id)

    submittedBy(prisma, event.id, ids.manager.id, new Date(Date.now() - 60 * 60 * 1000))
    submittedBy(prisma, event.id, ids.platformAdmin.id)

    const self = await decide(app, await reviewer(app, SUPER_ADMIN), event)

    expect(self.statusCode).toBe(403)
    expect(self.json().error.code).toBe('SELF_REVIEW')

    await app.close()
  })

  it('lets the same account decide once somebody else has sent it in since', async () => {
    const { app, prisma, ids } = await createTestApp()
    const event = prisma._store.event.find((row) => row.id === ids.reviewPendingEvent.id)

    submittedBy(prisma, event.id, ids.platformAdmin.id, new Date(Date.now() - 60 * 60 * 1000))
    submittedBy(prisma, event.id, ids.manager.id)

    const response = await decide(app, await reviewer(app, SUPER_ADMIN), event)

    expect(response.statusCode).toBe(200)

    await app.close()
  })
})

describe('reviewIndependence', () => {
  /**
   * A client that answers the one query the check makes.
   *
   * @param {object|null} submission The latest submission row.
   * @returns {{calls: object[], eventModerationAction: {findFirst: Function}}} The client.
   */
  function client(submission) {
    const calls = []

    return {
      calls,
      eventModerationAction: {
        findFirst: async (query) => {
          calls.push(query)

          return submission
        },
      },
    }
  }

  it('refuses a member before it looks at the submission', async () => {
    const prisma = client({ actorId: 'someone-else' })
    const answer = await reviewIndependence(prisma, {
      actor: { id: 'reviewer', memberships: [{ organizationId: 'org-1' }] },
      organizationId: 'org-1',
      eventId: 'event-1',
    })

    expect(answer).toEqual({
      independent: false,
      code: 'CONFLICT_OF_INTEREST',
      reason: REVIEW_INDEPENDENCE.CONFLICT_OF_INTEREST.message,
    })
    expect(prisma.calls).toHaveLength(0)
  })

  it('asks for the latest move into review only', async () => {
    const prisma = client({ actorId: 'reviewer' })
    const answer = await reviewIndependence(prisma, {
      actor: { id: 'reviewer', memberships: [{ organizationId: 'org-2' }] },
      organizationId: 'org-1',
      eventId: 'event-1',
    })

    expect(answer.code).toBe('SELF_REVIEW')
    expect(prisma.calls[0]).toMatchObject({
      where: { eventId: 'event-1', toStatus: 'REVIEW_PENDING' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    })
  })

  it('is independent with no membership and no submission of theirs, and without an event', async () => {
    expect(
      await reviewIndependence(client(null), {
        actor: { id: 'reviewer', memberships: [] },
        organizationId: 'org-1',
        eventId: 'event-1',
      }),
    ).toEqual({ independent: true, code: null, reason: null })

    const noEvent = client({ actorId: 'reviewer' })

    expect(
      (
        await reviewIndependence(noEvent, {
          actor: { id: 'reviewer' },
          organizationId: 'org-1',
        })
      ).independent,
    ).toBe(true)
    expect(noEvent.calls).toHaveLength(0)
  })
})
