/**
 * The organiser verification routes, and the public page they gate.
 *
 * The state machine itself is tested in `verification.test.js`. These tests are
 * about the four things only the route layer can get wrong:
 *
 *   1. **Who may move it.** An organiser submits; a moderator decides; neither
 *      can do the other's job, and a member of one organisation cannot touch
 *      another's.
 *   2. **Whether the decision is recorded.** A reason is mandatory, the history
 *      is append-only, and the audit row is written in the same transaction.
 *   3. **What the public page says.** The badge comes from the state, not from
 *      the denormalised column, so a row where the two disagree shows no badge.
 *   4. **What a suspended organisation leaks.** Nothing, and as a 404 rather
 *      than a 403 — a 403 confirms the organisation exists.
 *
 * @module @desi-event/api/tests/organizers
 */

import { describe, expect, it } from 'vitest'

import { bearer, createTestApp, mfaCodeFor, signIn } from './helpers/app.js'
import { minutesFromNow, makeWorld } from './helpers/fixtures.js'
import { cuid } from './helpers/prisma-stub.js'

/** The organisation every test acts in. */
const org = (ids) => ids.organization.id

/** The account that speaks for the organisation. */
const OWNER = 'owner@rangoli.example'

/**
 * The shared world, plus an OWNER of the main organisation.
 *
 * Verification is the organisation speaking for itself, and
 * `organization:submit_verification` is granted at ADMIN. The fixture world's
 * most senior member is a MANAGER, so the account that can submit has to be
 * added — which also makes the MANAGER available as the negative case.
 *
 * @returns {Promise<object>} The harness.
 */
async function createOrganizerApp() {
  const world = await makeWorld()
  const { seed, ids } = world
  const template = seed.user.find((row) => row.email === 'arun@rangoli.example')
  const owner = { ...template, id: cuid(), email: OWNER, displayName: 'Rangoli Owner' }

  seed.user.push(owner)
  seed.membership.push({
    id: cuid(),
    userId: owner.id,
    organizationId: ids.organization.id,
    role: 'OWNER',
    createdAt: new Date('2025-01-02T00:00:00.000Z'),
  })

  return createTestApp({ seed, ids })
}

/**
 * A signed-in platform moderator, with a fresh step-up.
 *
 * The decision route declares `stepUp: 'SECURITY_ROLE'`, so a token alone is not
 * enough — which is the point of the policy and is therefore exercised here
 * rather than worked around.
 *
 * @param {object} app The Fastify instance.
 * @param {string} [email] The staff account.
 * @returns {Promise<object>} Headers carrying the bearer token.
 */
async function moderator(app, email = 'ops@desi-event.example') {
  const token = await signIn(app, email)
  const headers = bearer(token)

  const stepUp = await app.inject({
    method: 'POST',
    url: '/v1/auth/step-up',
    headers,
    payload: { code: mfaCodeFor(app, email) },
  })

  expect(stepUp.statusCode).toBe(200)

  return headers
}

/**
 * Put the fixture organisation into a given verification state.
 *
 * @param {object} prisma The stub client.
 * @param {string} organizationId Which organisation.
 * @param {string} status The state to start from.
 * @returns {object} The organisation row.
 */
function startAt(prisma, organizationId, status) {
  const organization = prisma._store.organization.find((row) => row.id === organizationId)

  organization.verificationStatus = status
  organization.verified = status === 'VERIFIED'

  return organization
}

describe('GET /v1/organizations/:id/verification', () => {
  it('returns the state, whether it is eligible, and the history', async () => {
    const { app, prisma, ids } = await createOrganizerApp()
    const token = await signIn(app, OWNER)

    prisma._store.organizationVerificationEvent.push({
      id: cuid(),
      organizationId: org(ids),
      fromStatus: 'PENDING',
      toStatus: 'VERIFIED',
      actorId: null,
      reason: 'Registry record matches',
      createdAt: new Date('2025-01-02T00:00:00.000Z'),
    })

    const response = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${org(ids)}/verification`,
      headers: bearer(token),
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data).toMatchObject({
      organizationId: org(ids),
      status: 'VERIFIED',
      eligible: true,
    })
    expect(response.json().data.history).toHaveLength(1)

    await app.close()
  })

  it('refuses a member of another organisation', async () => {
    const { app, ids } = await createTestApp()
    const token = await signIn(app, 'rival@dhol.example')

    const response = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${org(ids)}/verification`,
      headers: bearer(token),
    })

    expect(response.statusCode).toBe(403)

    await app.close()
  })

  it('refuses an anonymous caller', async () => {
    const { app, ids } = await createTestApp()

    const response = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${org(ids)}/verification`,
    })

    expect(response.statusCode).toBe(401)

    await app.close()
  })
})

describe('POST /v1/organizations/:id/verification', () => {
  it('moves an unverified organisation into PENDING and records who asked', async () => {
    const { app, prisma, ids } = await createOrganizerApp()
    startAt(prisma, org(ids), 'UNVERIFIED')

    const token = await signIn(app, OWNER)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${org(ids)}/verification`,
      headers: bearer(token),
      payload: { legalName: 'Rangoli Collective Private Limited' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data).toMatchObject({ status: 'PENDING', eligible: false })

    const [event] = prisma._store.organizationVerificationEvent

    expect(event).toMatchObject({ fromStatus: 'UNVERIFIED', toStatus: 'PENDING' })
    expect(event.actorId).toBeTruthy()
    expect(prisma._store.organization.find((row) => row.id === org(ids)).legalName).toBe(
      'Rangoli Collective Private Limited',
    )

    await app.close()
  })

  it('writes an audit row alongside the transition', async () => {
    const { app, prisma, ids } = await createOrganizerApp()
    startAt(prisma, org(ids), 'UNVERIFIED')

    const token = await signIn(app, OWNER)

    await app.inject({
      method: 'POST',
      url: `/v1/organizations/${org(ids)}/verification`,
      headers: bearer(token),
      payload: {},
    })

    expect(
      prisma._store.auditLog.filter((row) => row.action === 'organization.verification_submitted'),
    ).toHaveLength(1)

    await app.close()
  })

  it('refuses a submission from a state that cannot submit', async () => {
    const { app, prisma, ids } = await createOrganizerApp()
    startAt(prisma, org(ids), 'VERIFIED')

    const token = await signIn(app, OWNER)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${org(ids)}/verification`,
      headers: bearer(token),
      payload: {},
    })

    expect(response.statusCode).toBe(409)
    expect(response.json().error.code).toBe('VERIFICATION_INVALID_TRANSITION')
    // The refusal says what is possible from here rather than only that this is
    // not.
    expect(response.json().error.message).toMatch(/SUSPENDED|REVOKED/)

    await app.close()
  })

  it('lets an organiser answer a REQUIRES_INFORMATION question', async () => {
    const { app, prisma, ids } = await createOrganizerApp()
    const organization = startAt(prisma, org(ids), 'REQUIRES_INFORMATION')
    organization.verificationNote = 'Send proof of address.'

    const token = await signIn(app, OWNER)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${org(ids)}/verification`,
      headers: bearer(token),
      payload: { note: 'Utility bill attached to the support thread.' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.status).toBe('PENDING')
    // A question that has been answered should not still be on the screen.
    expect(response.json().data.note).toBeNull()

    await app.close()
  })

  it('refuses a member who cannot submit for the organisation', async () => {
    // A MANAGER can see the team and invite people, and still cannot speak for
    // the organisation. Verification is the organisation speaking for itself.
    const { app, prisma, ids } = await createOrganizerApp()
    startAt(prisma, org(ids), 'UNVERIFIED')

    const token = await signIn(app, 'arun@rangoli.example')

    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${org(ids)}/verification`,
      headers: bearer(token),
      payload: {},
    })

    expect(response.statusCode).toBe(403)
    expect(prisma._store.organization.find((row) => row.id === org(ids)).verificationStatus).toBe(
      'UNVERIFIED',
    )

    await app.close()
  })

  it("refuses a submission for somebody else's organisation", async () => {
    const { app, prisma, ids } = await createOrganizerApp()
    const other = prisma._store.organization.find((row) => row.id !== org(ids))

    other.verificationStatus = 'UNVERIFIED'

    const token = await signIn(app, OWNER)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${other.id}/verification`,
      headers: bearer(token),
      payload: {},
    })

    expect(response.statusCode).toBe(403)
    expect(other.verificationStatus).toBe('UNVERIFIED')

    await app.close()
  })
})

describe('POST /v1/organizations/:id/verification/decision', () => {
  it('lets a moderator verify a pending submission, with a reason', async () => {
    const { app, prisma, ids } = await createOrganizerApp()
    startAt(prisma, org(ids), 'PENDING')

    const headers = await moderator(app)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${org(ids)}/verification/decision`,
      headers,
      payload: { decision: 'VERIFIED', reason: 'Registry record matches the legal name.' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data).toMatchObject({ status: 'VERIFIED', eligible: true })
    expect(prisma._store.organization.find((row) => row.id === org(ids)).verified).toBe(true)

    const [event] = prisma._store.organizationVerificationEvent

    expect(event.reason).toBe('Registry record matches the legal name.')

    await app.close()
  })

  it('refuses a decision with no reason', async () => {
    const { app, prisma, ids } = await createOrganizerApp()
    startAt(prisma, org(ids), 'PENDING')

    const headers = await moderator(app)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${org(ids)}/verification/decision`,
      headers,
      payload: { decision: 'REJECTED' },
    })

    expect(response.statusCode).toBe(400)
    expect(prisma._store.organizationVerificationEvent).toHaveLength(0)

    await app.close()
  })

  it('refuses REQUIRES_INFORMATION without saying what is required', async () => {
    const { app, ids, prisma } = await createOrganizerApp()
    startAt(prisma, org(ids), 'PENDING')

    const headers = await moderator(app)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${org(ids)}/verification/decision`,
      headers,
      payload: { decision: 'REQUIRES_INFORMATION', reason: 'Not enough evidence.' },
    })

    expect(response.statusCode).toBe(400)

    await app.close()
  })

  it('carries the note through to the organisation when asking for information', async () => {
    const { app, prisma, ids } = await createOrganizerApp()
    startAt(prisma, org(ids), 'PENDING')

    const headers = await moderator(app)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${org(ids)}/verification/decision`,
      headers,
      payload: {
        decision: 'REQUIRES_INFORMATION',
        reason: 'The legal name does not match the registry.',
        note: 'Send the certificate of incorporation.',
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.note).toBe('Send the certificate of incorporation.')

    await app.close()
  })

  it('refuses an organiser, however senior', async () => {
    const { app, prisma, ids } = await createOrganizerApp()
    startAt(prisma, org(ids), 'PENDING')

    const token = await signIn(app, OWNER)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${org(ids)}/verification/decision`,
      headers: bearer(token),
      payload: { decision: 'VERIFIED', reason: 'Trust me.' },
    })

    expect(response.statusCode).toBe(403)
    expect(prisma._store.organization.find((row) => row.id === org(ids)).verified).toBe(false)

    await app.close()
  })

  it('refuses a moderator whose second factor has gone stale', async () => {
    // The capability is held; the *recent* second factor is not. Signing in with
    // a code counts as one, so the window is aged out here rather than skipped —
    // which is the thing under test: SECURITY_ROLE lasts two minutes, and a
    // moderator who authenticated an hour ago confirms again.
    const { app, prisma, ids } = await createOrganizerApp()
    startAt(prisma, org(ids), 'PENDING')

    const token = await signIn(app, 'ops@desi-event.example')

    for (const session of prisma._store.session) {
      session.mfaSatisfiedAt = new Date(Date.now() - 60 * 60 * 1000)
    }

    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${org(ids)}/verification/decision`,
      headers: bearer(token),
      payload: { decision: 'VERIFIED', reason: 'Looks fine.' },
    })

    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('STEP_UP_REQUIRED')

    await app.close()
  })

  it('refuses a decision the state machine has no edge for', async () => {
    const { app, prisma, ids } = await createOrganizerApp()
    startAt(prisma, org(ids), 'UNVERIFIED')

    const headers = await moderator(app)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${org(ids)}/verification/decision`,
      headers,
      payload: { decision: 'VERIFIED', reason: 'Skipping the queue.' },
    })

    expect(response.statusCode).toBe(409)
    expect(prisma._store.organizationVerificationEvent).toHaveLength(0)

    await app.close()
  })

  it('takes the badge down on a revocation', async () => {
    const { app, prisma, ids } = await createOrganizerApp()
    startAt(prisma, org(ids), 'VERIFIED')

    const headers = await moderator(app)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${org(ids)}/verification/decision`,
      headers,
      payload: { decision: 'REVOKED', reason: 'The organisation has stopped trading.' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data).toMatchObject({ status: 'REVOKED', eligible: false })
    expect(prisma._store.organization.find((row) => row.id === org(ids)).verified).toBe(false)

    await app.close()
  })

  it('appends to the history rather than editing it', async () => {
    const { app, prisma, ids } = await createOrganizerApp()
    startAt(prisma, org(ids), 'PENDING')

    const headers = await moderator(app)

    await app.inject({
      method: 'POST',
      url: `/v1/organizations/${org(ids)}/verification/decision`,
      headers,
      payload: { decision: 'VERIFIED', reason: 'Registry record matches.' },
    })

    const second = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${org(ids)}/verification/decision`,
      headers,
      payload: { decision: 'SUSPENDED', reason: 'Chargeback rate above threshold.' },
    })

    expect(second.statusCode).toBe(200)

    const history = second.json().data.history

    expect(history).toHaveLength(2)
    expect(history.map((entry) => entry.toStatus)).toEqual(['VERIFIED', 'SUSPENDED'])
    // The first decision's reason is still the reason it was taken for.
    expect(history[0].reason).toBe('Registry record matches.')

    await app.close()
  })

  it('does not exist for an organisation that does not', async () => {
    const { app } = await createTestApp()
    const headers = await moderator(app)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${cuid()}/verification/decision`,
      headers,
      payload: { decision: 'VERIFIED', reason: 'Nobody is there.' },
    })

    expect(response.statusCode).toBe(404)

    await app.close()
  })
})

describe('GET /v1/organizers/:slug', () => {
  it('serves the public profile to an anonymous caller', async () => {
    const { app } = await createTestApp()

    const response = await app.inject({ method: 'GET', url: '/v1/organizers/rangoli-collective' })

    expect(response.statusCode).toBe(200)
    expect(response.json().data).toMatchObject({
      slug: 'rangoli-collective',
      name: 'Rangoli Collective',
      verified: true,
      timezone: 'Asia/Kolkata',
    })

    await app.close()
  })

  it('lists upcoming published events and leaves drafts out', async () => {
    const { app } = await createTestApp()

    const response = await app.inject({ method: 'GET', url: '/v1/organizers/rangoli-collective' })
    const slugs = response.json().data.upcomingEvents.map((event) => event.slug)

    expect(slugs).toContain('navratri-garba-night')
    expect(slugs).not.toContain('secret-bollywood-night')

    await app.close()
  })

  it('separates past events from upcoming ones, newest first', async () => {
    const world = await makeWorld()
    const { seed, ids } = world
    const template = seed.event.find((event) => event.slug === 'navratri-garba-night')

    for (const [index, ago] of [60 * 24 * 40, 60 * 24 * 10].entries()) {
      seed.event.push({
        ...template,
        id: cuid(),
        slug: `past-show-${index}`,
        title: `Past Show ${index}`,
        status: 'COMPLETED',
        startsAt: minutesFromNow(-ago),
        endsAt: minutesFromNow(-ago + 120),
      })
    }

    const { app } = await createTestApp({ seed, ids })

    const response = await app.inject({ method: 'GET', url: '/v1/organizers/rangoli-collective' })
    const past = response.json().data.pastEvents

    expect(past.map((event) => event.slug)).toEqual(['past-show-1', 'past-show-0'])
    expect(response.json().data.upcomingEvents.map((event) => event.slug)).not.toContain(
      'past-show-0',
    )

    await app.close()
  })

  it('leaves a cancelled event off the page entirely', async () => {
    const world = await makeWorld()
    const { seed, ids } = world
    const template = seed.event.find((event) => event.slug === 'navratri-garba-night')

    seed.event.push({
      ...template,
      id: cuid(),
      slug: 'called-off',
      title: 'Called Off',
      status: 'CANCELLED',
      startsAt: minutesFromNow(60 * 24 * 5),
    })

    const { app } = await createTestApp({ seed, ids })

    const response = await app.inject({ method: 'GET', url: '/v1/organizers/rangoli-collective' })
    const { upcomingEvents, pastEvents } = response.json().data

    expect([...upcomingEvents, ...pastEvents].map((event) => event.slug)).not.toContain(
      'called-off',
    )

    await app.close()
  })

  it('shows no badge when the column and the state disagree', async () => {
    // The defect this guards: `verified` is denormalised, so a row that missed a
    // transition would serve a badge the organisation never earned. The page
    // derives it from the state, so the stale column loses.
    const { app, prisma, ids } = await createTestApp()
    const organization = prisma._store.organization.find((row) => row.id === org(ids))

    organization.verified = true
    organization.verificationStatus = 'REVOKED'

    const response = await app.inject({ method: 'GET', url: '/v1/organizers/rangoli-collective' })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.verified).toBe(false)

    await app.close()
  })

  it('is not found for a suspended organisation', async () => {
    const { app, prisma, ids } = await createTestApp()
    const organization = prisma._store.organization.find((row) => row.id === org(ids))

    organization.suspendedAt = new Date()
    organization.suspendedReason = 'Under investigation'

    const response = await app.inject({ method: 'GET', url: '/v1/organizers/rangoli-collective' })

    // 404 rather than 403: a 403 would confirm the organisation exists, and a
    // suspension is not news we owe the internet.
    expect(response.statusCode).toBe(404)
    expect(response.body).not.toMatch(/investigation/i)

    await app.close()
  })

  it('stays not found for a suspended organisation even with staff credentials', async () => {
    // The route is anonymous, so there is no actor to make an exception for —
    // and inventing one would mean an anonymous route that reads a token.
    const { app, prisma, ids } = await createTestApp()
    const organization = prisma._store.organization.find((row) => row.id === org(ids))

    organization.suspendedAt = new Date()

    const token = await signIn(app, 'ops@desi-event.example')

    const response = await app.inject({
      method: 'GET',
      url: '/v1/organizers/rangoli-collective',
      headers: bearer(token),
    })

    expect(response.statusCode).toBe(404)

    await app.close()
  })

  it('is not found for a slug nobody has', async () => {
    const { app } = await createTestApp()

    const response = await app.inject({ method: 'GET', url: '/v1/organizers/nobody-at-all' })

    expect(response.statusCode).toBe(404)

    await app.close()
  })

  it('never carries a contact address, a suspension reason or a legal name', async () => {
    // The public shape is an allow-list, so this is a regression test for the
    // day somebody returns the row instead of building the payload.
    const { app, prisma, ids } = await createTestApp()
    const organization = prisma._store.organization.find((row) => row.id === org(ids))

    organization.legalName = 'Rangoli Collective Private Limited'
    organization.verificationNote = 'Send the certificate of incorporation.'

    const response = await app.inject({ method: 'GET', url: '/v1/organizers/rangoli-collective' })

    expect(response.body).not.toMatch(/hello@rangoli/)
    expect(response.body).not.toMatch(/Private Limited/)
    expect(response.body).not.toMatch(/certificate of incorporation/)
    expect(Object.keys(response.json().data).sort()).toEqual([
      'description',
      'name',
      'pastEvents',
      'refundPolicy',
      'slug',
      'timezone',
      'upcomingEvents',
      'verified',
      'websiteUrl',
    ])

    await app.close()
  })
})
