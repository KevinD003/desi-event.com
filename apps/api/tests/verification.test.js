/**
 * The organiser verification state machine.
 *
 * Verification gates publishing an event and being paid for it, so the tests
 * that matter are the ones about the shape of the graph rather than the happy
 * path: who may make each move, which moves do not exist, and what the badge
 * means.
 */

import { describe, expect, it } from 'vitest'

import {
  ACTORS,
  BADGED_STATES,
  TRANSITIONS,
  VERIFICATION_STATES,
  applyTransition,
  canTransition,
  isEligible,
} from '../src/lib/verification.js'
import { bearer, createTestApp, signIn } from './helpers/app.js'
import { cuid } from './helpers/prisma-stub.js'

const S = VERIFICATION_STATES

describe('the transition graph', () => {
  it('lets an organiser submit from UNVERIFIED, and nobody else', () => {
    expect(canTransition(S.UNVERIFIED, S.PENDING, ACTORS.ORGANISER).allowed).toBe(true)
    expect(canTransition(S.UNVERIFIED, S.PENDING, ACTORS.MODERATOR).allowed).toBe(false)
  })

  it('does not let a moderator verify something nobody submitted', () => {
    // The evidence was never gathered. Approving it anyway is the whole
    // verification process skipped in one call.
    const verdict = canTransition(S.UNVERIFIED, S.VERIFIED, ACTORS.MODERATOR)

    expect(verdict.allowed).toBe(false)
    expect(verdict.reason).toBe('NO_SUCH_TRANSITION')
    expect(verdict.permitted).toEqual([S.PENDING])
  })

  it('lets a moderator decide a pending submission three ways', () => {
    for (const to of [S.REQUIRES_INFORMATION, S.VERIFIED, S.REJECTED]) {
      expect(canTransition(S.PENDING, to, ACTORS.MODERATOR).allowed, to).toBe(true)
    }
  })

  it('does not let an organiser verify themselves', () => {
    const verdict = canTransition(S.PENDING, S.VERIFIED, ACTORS.ORGANISER)

    expect(verdict.allowed).toBe(false)
    expect(verdict.reason).toBe('WRONG_ACTOR')
  })

  it('puts REQUIRES_INFORMATION in the organiser hands, which is what distinguishes it', () => {
    expect(canTransition(S.REQUIRES_INFORMATION, S.PENDING, ACTORS.ORGANISER).allowed).toBe(true)
    expect(canTransition(S.PENDING, S.PENDING, ACTORS.ORGANISER).allowed).toBe(false)
  })

  it('separates a suspension from a revocation', () => {
    // A hold that is expected to lift, and a withdrawal that is not.
    expect(canTransition(S.SUSPENDED, S.VERIFIED, ACTORS.MODERATOR).allowed).toBe(true)
    expect(canTransition(S.REVOKED, S.VERIFIED, ACTORS.MODERATOR).allowed).toBe(false)
  })

  it('leaves a way back from REJECTED and REVOKED', () => {
    // A permanent refusal with no route back is a support ticket wearing a
    // state machine's clothes.
    expect(canTransition(S.REJECTED, S.PENDING, ACTORS.ORGANISER).allowed).toBe(true)
    expect(canTransition(S.REVOKED, S.PENDING, ACTORS.ORGANISER).allowed).toBe(true)
  })

  it('names every state the graph can be in', () => {
    for (const state of Object.values(S)) {
      expect(TRANSITIONS[state], state).toBeDefined()
    }
  })

  it('only ever points at states that exist', () => {
    for (const [from, edges] of Object.entries(TRANSITIONS)) {
      for (const edge of edges) {
        expect(Object.values(S), `${from} -> ${edge.to}`).toContain(edge.to)
        expect(Object.values(ACTORS), `${from} -> ${edge.to}`).toContain(edge.actor)
      }
    }
  })

  it('reaches every state from UNVERIFIED', () => {
    // A state nothing can reach is a state that will never be tested in
    // production either.
    const seen = new Set([S.UNVERIFIED])
    const queue = [S.UNVERIFIED]

    while (queue.length > 0) {
      for (const edge of TRANSITIONS[queue.shift()] ?? []) {
        if (seen.has(edge.to)) continue
        seen.add(edge.to)
        queue.push(edge.to)
      }
    }

    expect([...seen].sort()).toEqual(Object.values(S).sort())
  })
})

describe('the badge and eligibility', () => {
  it('is shown for exactly one state', () => {
    expect([...BADGED_STATES]).toEqual([S.VERIFIED])
  })

  it('lets a verified organisation publish and be paid', () => {
    expect(isEligible({ verificationStatus: S.VERIFIED, suspendedAt: null })).toBe(true)
  })

  it('refuses every other state', () => {
    for (const state of Object.values(S)) {
      if (state === S.VERIFIED) continue
      expect(isEligible({ verificationStatus: state, suspendedAt: null }), state).toBe(false)
    }
  })

  it('lets a suspension override verification', () => {
    // An organisation can be verified *and* suspended, and the suspension wins.
    expect(isEligible({ verificationStatus: S.VERIFIED, suspendedAt: new Date() })).toBe(false)
  })

  it('refuses a missing organisation rather than throwing', () => {
    expect(isEligible(null)).toBe(false)
    expect(isEligible(undefined)).toBe(false)
  })
})

describe('applying a transition', () => {
  /**
   * An organisation in a given state, and the stub that holds it.
   *
   * @param {string} status Where to start.
   * @returns {Promise<object>} The harness and the organisation.
   */
  async function at(status) {
    const harness = await createTestApp()
    const organization = harness.prisma._store.organization[0]

    organization.verificationStatus = status
    organization.verified = status === S.VERIFIED

    return { ...harness, organization }
  }

  it('records the move, the actor and the reason', async () => {
    const { app, prisma, organization } = await at(S.PENDING)

    await applyTransition(prisma, {
      organization,
      to: S.VERIFIED,
      actor: ACTORS.MODERATOR,
      actorId: 'moderator-1',
      reason: 'Companies House record matches',
    })

    const [event] = prisma._store.organizationVerificationEvent

    expect(event).toMatchObject({
      organizationId: organization.id,
      fromStatus: S.PENDING,
      toStatus: S.VERIFIED,
      actorId: 'moderator-1',
      reason: 'Companies House record matches',
    })

    await app.close()
  })

  it('keeps the denormalised badge in step with the state', async () => {
    const { app, prisma, organization } = await at(S.PENDING)

    await applyTransition(prisma, {
      organization,
      to: S.VERIFIED,
      actor: ACTORS.MODERATOR,
      reason: 'ok',
    })

    expect(prisma._store.organization[0].verified).toBe(true)

    const verified = prisma._store.organization[0]

    await applyTransition(prisma, {
      organization: verified,
      to: S.REVOKED,
      actor: ACTORS.MODERATOR,
      reason: 'no longer trading',
    })

    // The column is the public badge, so it has to come down with the state.
    expect(prisma._store.organization[0].verified).toBe(false)

    await app.close()
  })

  it('clears the note when the state is no longer REQUIRES_INFORMATION', async () => {
    const { app, prisma, organization } = await at(S.PENDING)

    await applyTransition(prisma, {
      organization,
      to: S.REQUIRES_INFORMATION,
      actor: ACTORS.MODERATOR,
      reason: 'need proof of address',
      note: 'Send a utility bill from the last three months.',
    })

    expect(prisma._store.organization[0].verificationNote).toMatch(/utility bill/)

    await applyTransition(prisma, {
      organization: prisma._store.organization[0],
      to: S.PENDING,
      actor: ACTORS.ORGANISER,
      reason: 'supplied',
    })

    // A question that has been answered should not still be on the screen.
    expect(prisma._store.organization[0].verificationNote).toBeNull()

    await app.close()
  })

  it('refuses a transition that does not exist, and says what does', async () => {
    const { app, prisma, organization } = await at(S.UNVERIFIED)

    await expect(
      applyTransition(prisma, { organization, to: S.VERIFIED, actor: ACTORS.MODERATOR }),
    ).rejects.toThrow(/can only move to PENDING/)

    await app.close()
  })

  it('refuses the wrong actor with a different error from the wrong move', async () => {
    const { app, prisma, organization } = await at(S.PENDING)

    await expect(
      applyTransition(prisma, { organization, to: S.VERIFIED, actor: ACTORS.ORGANISER }),
    ).rejects.toMatchObject({ statusCode: 403 })

    await expect(
      applyTransition(prisma, { organization, to: S.UNVERIFIED, actor: ACTORS.MODERATOR }),
    ).rejects.toMatchObject({ statusCode: 409 })

    await app.close()
  })

  it('writes nothing when it refuses', async () => {
    const { app, prisma, organization } = await at(S.UNVERIFIED)

    await expect(
      applyTransition(prisma, { organization, to: S.VERIFIED, actor: ACTORS.MODERATOR }),
    ).rejects.toThrow()

    expect(prisma._store.organizationVerificationEvent ?? []).toHaveLength(0)
    expect(prisma._store.organization[0].verificationStatus).toBe(S.UNVERIFIED)

    await app.close()
  })

  it('lets only one of two concurrent moderators win', async () => {
    // Both read PENDING; the update is conditional on that, so the second one
    // matches nothing and is told to reload rather than writing a second
    // history row for a move that did not happen.
    const { app, prisma, organization } = await at(S.PENDING)

    const results = await Promise.allSettled([
      applyTransition(prisma, {
        organization,
        to: S.VERIFIED,
        actor: ACTORS.MODERATOR,
        reason: 'first',
      }),
      applyTransition(prisma, {
        organization,
        to: S.REJECTED,
        actor: ACTORS.MODERATOR,
        reason: 'second',
      }),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(prisma._store.organizationVerificationEvent).toHaveLength(1)

    await app.close()
  })
})

describe('the moderators\u2019 verification queue and review', () => {
  /**
   * The shared world plus three organisations waiting in different states.
   *
   * @returns {Promise<object>} The harness and the new organisations.
   */
  async function withQueue() {
    const harness = await createTestApp()
    const { prisma } = harness
    const template = prisma._store.organization[0]

    /**
     * Add an organisation in a state.
     *
     * @param {string} name Its name.
     * @param {string} status Its verification state.
     * @param {string} since When it entered that state.
     * @returns {object} The row.
     */
    const add = (name, status, since) => {
      const row = {
        ...template,
        id: cuid(),
        name,
        slug: name.toLowerCase().replace(/\s+/gu, '-'),
        contactEmail: `${name.split(' ')[0].toLowerCase()}@owner.example`,
        verificationStatus: status,
        verified: false,
        verificationUpdatedAt: new Date(since),
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      }

      prisma._store.organization.push(row)

      return row
    }

    const newer = add('Newer Garba', 'PENDING', '2026-09-20T00:00:00.000Z')
    const older = add('Older Dandiya', 'PENDING', '2026-09-01T00:00:00.000Z')
    const asked = add('Asked Bhangra', 'REQUIRES_INFORMATION', '2026-09-10T00:00:00.000Z')

    prisma._store.organizationVerificationEvent.push(
      {
        id: cuid(),
        organizationId: older.id,
        fromStatus: 'UNVERIFIED',
        toStatus: 'PENDING',
        actorId: null,
        reason: 'First try.',
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
      },
      {
        id: cuid(),
        organizationId: older.id,
        fromStatus: 'REJECTED',
        toStatus: 'PENDING',
        actorId: null,
        reason: 'We registered the company since.',
        createdAt: new Date('2026-09-01T00:00:00.000Z'),
      },
    )

    return { ...harness, newer, older, asked }
  }

  it('refuses an organisation owner, and answers a moderator and a super administrator', async () => {
    const { app } = await withQueue()

    for (const [email, status] of [
      ['owner@rangoli.example', 403],
      ['maya@desi-event.example', 200],
      ['ops@desi-event.example', 200],
    ]) {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/moderation/organizations',
        headers: bearer(await signIn(app, email)),
      })

      expect(response.statusCode, email).toBe(status)
    }

    await app.close()
  })

  it('opens on the organisations waiting, oldest first, with what they last wrote', async () => {
    const { app, older, newer } = await withQueue()

    const response = await app.inject({
      method: 'GET',
      url: '/v1/moderation/organizations',
      headers: bearer(await signIn(app, 'maya@desi-event.example')),
    })

    const { data, pagination } = response.json()

    expect(data.map((row) => row.organizationId)).toEqual([older.id, newer.id])
    expect(data[0].organiserNote).toBe('We registered the company since.')
    expect(data[1].organiserNote).toBeNull()
    expect(data[0]).toMatchObject({ status: 'PENDING', memberCount: 0, eventCount: 0 })
    expect(pagination.total).toBe(2)

    await app.close()
  })

  it('filters by state, and refuses UNVERIFIED, which is not a queue', async () => {
    const { app, asked } = await withQueue()
    const headers = bearer(await signIn(app, 'maya@desi-event.example'))

    const needsInfo = await app.inject({
      method: 'GET',
      url: '/v1/moderation/organizations?status=REQUIRES_INFORMATION',
      headers,
    })

    expect(needsInfo.json().data.map((row) => row.organizationId)).toEqual([asked.id])

    const verified = await app.inject({
      method: 'GET',
      url: '/v1/moderation/organizations?status=VERIFIED',
      headers,
    })

    // The two fixture organisations, with their member and event counts.
    expect(verified.json().data).toHaveLength(2)
    expect(verified.json().data.some((row) => row.memberCount > 0)).toBe(true)
    expect(verified.json().data.some((row) => row.eventCount > 0)).toBe(true)

    const unverified = await app.inject({
      method: 'GET',
      url: '/v1/moderation/organizations?status=UNVERIFIED',
      headers,
    })

    expect(unverified.statusCode).toBe(400)

    await app.close()
  })

  it('carries no contact address, in the queue or the review', async () => {
    const { app, older } = await withQueue()
    const headers = bearer(await signIn(app, 'maya@desi-event.example'))

    const queue = await app.inject({ method: 'GET', url: '/v1/moderation/organizations', headers })
    const review = await app.inject({
      method: 'GET',
      url: `/v1/moderation/organizations/${older.id}`,
      headers,
    })

    for (const response of [queue, review]) {
      expect(response.statusCode).toBe(200)
      expect(response.body).not.toContain('contactEmail')
      expect(response.body).not.toContain('@owner.example')
      expect(response.body).not.toContain('payoutCurrency')
    }

    await app.close()
  })

  it('reviews one organisation with its whole history', async () => {
    const { app, older } = await withQueue()

    const response = await app.inject({
      method: 'GET',
      url: `/v1/moderation/organizations/${older.id}`,
      headers: bearer(await signIn(app, 'maya@desi-event.example')),
    })

    expect(response.statusCode).toBe(200)

    const { data } = response.json()

    expect(data.organization).toMatchObject({
      id: older.id,
      name: 'Older Dandiya',
      eligible: false,
    })
    expect(data.verification.status).toBe('PENDING')
    expect(data.verification.history.map((row) => row.reason)).toEqual([
      'First try.',
      'We registered the company since.',
    ])

    await app.close()
  })

  it('answers 404 for an organisation that does not exist, and 403 to an organiser', async () => {
    const { app, older } = await withQueue()

    const unknown = await app.inject({
      method: 'GET',
      url: `/v1/moderation/organizations/${cuid()}`,
      headers: bearer(await signIn(app, 'maya@desi-event.example')),
    })

    expect(unknown.statusCode).toBe(404)

    const organiser = await app.inject({
      method: 'GET',
      url: `/v1/moderation/organizations/${older.id}`,
      headers: bearer(await signIn(app, 'owner@rangoli.example')),
    })

    expect(organiser.statusCode).toBe(403)

    await app.close()
  })
})
