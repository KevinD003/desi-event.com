/**
 * The privacy commands, over HTTP.
 *
 * The integration suites prove the engine against real PostgreSQL. This one
 * proves the part in front of it: that the guards installed from the route
 * contract actually run, that a command refuses without a fresh step-up, that a
 * caller cannot reach another organisation's subject, and that the response a
 * browser receives carries counts rather than values.
 *
 * Step-up is taken through `/v1/auth/step-up` rather than by setting a flag,
 * because a test that went around the challenge would be testing a system
 * nobody runs.
 */

import { describe, expect, it } from 'vitest'

import { createTestApp, bearer, signIn, stepUp } from './helpers/app.js'

/** The organisation owner, the only role holding `privacy:redact`. */
const OWNER = 'owner@rangoli.example'

/** An organisation manager: runs the organisation, may not destroy a person. */
const MANAGER = 'arun@rangoli.example'

/**
 * Sign in, step up, and hand back headers a privacy command will accept.
 *
 * @param {object} app The Fastify instance.
 * @param {string} email Which account.
 * @returns {Promise<object>} Authenticated, stepped-up headers.
 */
async function authorised(app, email = OWNER) {
  const token = await signIn(app, email)
  const headers = bearer(token)

  await stepUp(app, email, headers)

  return headers
}

/**
 * Push a session's step-up outside the `PRIVACY_ERASURE` window.
 *
 * Signing in with a second factor sets `mfaSatisfiedAt` to that moment
 * (`apps/api/src/routes/auth.js:522`), so a freshly signed-in operator is
 * legitimately stepped up — for two minutes. That is the behaviour, and it means
 * "refuses without a step-up" cannot be tested by simply not stepping up. What
 * has to be tested is the *window*: a session whose last identity confirmation
 * is older than two minutes must be refused.
 *
 * @param {object} prisma The stub client.
 * @param {string} userId Whose sessions to age.
 * @returns {void} Nothing.
 */
function ageStepUp(prisma, userId) {
  const stale = new Date(Date.now() - 10 * 60 * 1000)

  for (const session of prisma._store.session) {
    if (session.userId !== userId) continue

    session.mfaSatisfiedAt = stale
  }
}

/**
 * Put a subject inside the organisation, so scope checks pass.
 *
 * A waitlist entry is the cheapest of the four relationships that count, and it
 * is also the one that carries an address of its own — which is what makes it
 * worth using here rather than a whole order graph.
 *
 * @param {object} prisma The stub client.
 * @param {object} ids The seeded identifiers.
 * @returns {object} The subject.
 */
function subjectInOrganisation(prisma, ids) {
  const subject = prisma._store.user.find((row) => row.id === ids.attendee.id)

  prisma._store.waitlistEntry.push({
    id: `wl-${subject.id}`,
    eventId: ids.publishedEvent.id,
    userId: subject.id,
    email: subject.email,
    quantity: 1,
    notified: false,
    createdAt: new Date(),
  })

  return subject
}

describe('POST /v1/organizations/:id/privacy/requests', () => {
  it('raises a request and returns the confirmation phrase exactly once', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await authorised(app)
    const subject = subjectInOrganisation(prisma, ids)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${ids.organization.id}/privacy/requests`,
      headers,
      payload: { subjectId: subject.id, reason: 'SUBJECT_REQUEST' },
    })

    expect(response.statusCode).toBe(201)

    const body = response.json()

    expect(body.data.state).toBe('REQUESTED')
    expect(body.data.subjectId).toBe(subject.id)
    expect(body.confirmation.phrase).toMatch(/^[0-9a-f]{18}$/)

    // Counts and categories, never a value.
    expect(JSON.stringify(body)).not.toContain(subject.email)
    expect(JSON.stringify(body)).not.toContain(subject.displayName)

    // And re-reading the request does not hand the phrase back.
    const reread = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${ids.organization.id}/privacy/requests/${body.data.id}`,
      headers,
    })

    expect(reread.body).not.toContain(body.confirmation.phrase)

    await app.close()
  })

  it('refuses once the step-up is older than two minutes', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await authorised(app)
    const subject = subjectInOrganisation(prisma, ids)

    // Signed in, holds the capability, confirmed their identity ten minutes ago.
    ageStepUp(prisma, ids.owner.id)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${ids.organization.id}/privacy/requests`,
      headers,
      payload: { subjectId: subject.id, reason: 'SUBJECT_REQUEST' },
    })

    expect(response.statusCode).toBe(403)
    expect(prisma._store.privacyRequest).toHaveLength(0)

    await app.close()
  })

  it('refuses a manager, who may run the organisation but not destroy a person', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await authorised(app, MANAGER)
    const subject = subjectInOrganisation(prisma, ids)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${ids.organization.id}/privacy/requests`,
      headers,
      payload: { subjectId: subject.id, reason: 'SUBJECT_REQUEST' },
    })

    expect(response.statusCode).toBe(403)
    expect(prisma._store.privacyRequest).toHaveLength(0)

    await app.close()
  })

  it('refuses a caller with no session at all', async () => {
    const { app, ids } = await createTestApp()

    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${ids.organization.id}/privacy/requests`,
      payload: { subjectId: 'ckaaaaaaaaaaaaaaaaaaaaaa', reason: 'SUBJECT_REQUEST' },
    })

    expect(response.statusCode).toBe(401)

    await app.close()
  })

  it('refuses a subject this organisation holds nothing about, without saying so', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await authorised(app)

    // Somebody who deals only with the neighbouring organisation.
    const stranger = prisma._store.user.find((row) => row.id === ids.outsider.id)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${ids.organization.id}/privacy/requests`,
      headers,
      payload: { subjectId: stranger.id, reason: 'SUBJECT_REQUEST' },
    })

    expect(response.statusCode).toBe(404)
    // The same sentence a subject who does not exist gets.
    expect(response.json().error.message).toMatch(/no such person/i)

    await app.close()
  })

  it('refuses a body that names an organisation, a state or an outcome', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await authorised(app)
    const subject = subjectInOrganisation(prisma, ids)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${ids.organization.id}/privacy/requests`,
      headers,
      payload: {
        subjectId: subject.id,
        reason: 'SUBJECT_REQUEST',
        organizationId: 'ckccccccccccccccccccccc',
        state: 'COMPLETED',
        outcomeCode: 'REDACTED',
      },
    })

    // Accepted, because the schema strips what it does not name — and the
    // stripped fields changed nothing.
    expect(response.statusCode).toBe(201)

    const stored = prisma._store.privacyRequest[0]

    expect(stored.organizationId).toBe(ids.organization.id)
    expect(stored.state).toBe('REQUESTED')
    expect(stored.outcomeCode).toBe(null)

    await app.close()
  })

  it('refuses an unknown reason rather than storing it', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await authorised(app)
    const subject = subjectInOrganisation(prisma, ids)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${ids.organization.id}/privacy/requests`,
      headers,
      payload: { subjectId: subject.id, reason: 'BECAUSE_I_SAID_SO' },
    })

    expect(response.statusCode).toBe(400)
    expect(prisma._store.privacyRequest).toHaveLength(0)

    await app.close()
  })
})

describe('POST /v1/organizations/:id/privacy/requests/:requestId/confirm', () => {
  it('redacts on the right phrase and leaves the order’s money alone', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await authorised(app)
    const subject = subjectInOrganisation(prisma, ids)

    const created = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${ids.organization.id}/privacy/requests`,
      headers,
      payload: { subjectId: subject.id, reason: 'SUBJECT_REQUEST' },
    })

    const { data, confirmation } = created.json()

    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${ids.organization.id}/privacy/requests/${data.id}/confirm`,
      headers,
      payload: { confirmationPhrase: confirmation.phrase },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.state).toBe('COMPLETED')
    expect(response.json().data.outcomeCode).toBe('REDACTED')

    const entry = prisma._store.waitlistEntry.find((row) => row.userId === subject.id)

    expect(entry.email).not.toBe(subject.email)
    expect(entry.email).toMatch(/@redacted\.invalid$/)

    await app.close()
  })

  it('refuses the wrong phrase and redacts nothing', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await authorised(app)
    const subject = subjectInOrganisation(prisma, ids)
    const before = subject.email

    const created = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${ids.organization.id}/privacy/requests`,
      headers,
      payload: { subjectId: subject.id, reason: 'SUBJECT_REQUEST' },
    })

    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${ids.organization.id}/privacy/requests/${created.json().data.id}/confirm`,
      headers,
      payload: { confirmationPhrase: 'deadbeefdeadbeefde' },
    })

    expect(response.statusCode).toBe(422)

    const stored = prisma._store.user.find((row) => row.id === subject.id)

    expect(stored.email).toBe(before)

    await app.close()
  })

  it('refuses once the step-up has gone stale between raising and confirming', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await authorised(app)
    const subject = subjectInOrganisation(prisma, ids)
    const before = subject.email

    const created = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${ids.organization.id}/privacy/requests`,
      headers,
      payload: { subjectId: subject.id, reason: 'SUBJECT_REQUEST' },
    })

    const { data, confirmation } = created.json()

    // The operator walked away. This is the case the two-minute window exists
    // for: the right phrase, in the right session, too long afterwards.
    ageStepUp(prisma, ids.owner.id)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${ids.organization.id}/privacy/requests/${data.id}/confirm`,
      headers,
      payload: { confirmationPhrase: confirmation.phrase },
    })

    expect(response.statusCode).toBe(403)

    const stored = prisma._store.user.find((row) => row.id === subject.id)

    expect(stored.email).toBe(before)

    await app.close()
  })

  it('answers the same 404 for another organisation’s request as for one that never existed', async () => {
    const { app, ids } = await createTestApp()
    const headers = await authorised(app)

    const invented = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${ids.organization.id}/privacy/requests/ckzzzzzzzzzzzzzzzzzzzzzz/confirm`,
      headers,
      payload: { confirmationPhrase: 'a'.repeat(18) },
    })

    expect(invented.statusCode).toBe(404)
    expect(invented.json().error.message).toMatch(/no such privacy request/i)

    await app.close()
  })
})

describe('POST /v1/organizations/:id/privacy/requests/:requestId/cancel', () => {
  it('withdraws a request that has not run', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await authorised(app)
    const subject = subjectInOrganisation(prisma, ids)

    const created = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${ids.organization.id}/privacy/requests`,
      headers,
      payload: { subjectId: subject.id, reason: 'SUBJECT_REQUEST' },
    })

    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${ids.organization.id}/privacy/requests/${created.json().data.id}/cancel`,
      headers,
      payload: { reasonCode: 'RAISED_IN_ERROR' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data.state).toBe('CANCELLED')

    const stored = prisma._store.user.find((row) => row.id === subject.id)

    expect(stored.email).toBe(subject.email)

    await app.close()
  })

  it('refuses to withdraw one that already finished', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await authorised(app)
    const subject = subjectInOrganisation(prisma, ids)

    const created = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${ids.organization.id}/privacy/requests`,
      headers,
      payload: { subjectId: subject.id, reason: 'SUBJECT_REQUEST' },
    })

    const { data, confirmation } = created.json()

    await app.inject({
      method: 'POST',
      url: `/v1/organizations/${ids.organization.id}/privacy/requests/${data.id}/confirm`,
      headers,
      payload: { confirmationPhrase: confirmation.phrase },
    })

    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${ids.organization.id}/privacy/requests/${data.id}/cancel`,
      headers,
      payload: { reasonCode: 'NO_LONGER_REQUIRED' },
    })

    expect(response.statusCode).toBe(409)

    await app.close()
  })
})

describe('the evidence timeline', () => {
  it('lists every recorded step, oldest first, with no personal value', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await authorised(app)
    const subject = subjectInOrganisation(prisma, ids)

    const created = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${ids.organization.id}/privacy/requests`,
      headers,
      payload: { subjectId: subject.id, reason: 'SUBJECT_REQUEST' },
    })

    const { data, confirmation } = created.json()

    await app.inject({
      method: 'POST',
      url: `/v1/organizations/${ids.organization.id}/privacy/requests/${data.id}/confirm`,
      headers,
      payload: { confirmationPhrase: confirmation.phrase },
    })

    const response = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${ids.organization.id}/privacy/requests/${data.id}/events`,
      headers,
    })

    expect(response.statusCode).toBe(200)

    const results = response.json().data.map((row) => row.result)

    expect(results).toEqual(['REQUESTED', 'CONFIRMED', 'COMPLETED'])
    expect(response.body).not.toContain(subject.email)
    expect(response.body).not.toContain(confirmation.phrase)

    await app.close()
  })

  it('answers 404 for a request this organisation does not own', async () => {
    const { app, ids } = await createTestApp()
    const headers = await authorised(app)

    const response = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${ids.organization.id}/privacy/requests/ckyyyyyyyyyyyyyyyyyyyyyy/events`,
      headers,
    })

    expect(response.statusCode).toBe(404)

    await app.close()
  })
})

describe('holds', () => {
  it('places a hold, lists it, and refuses a redaction while it stands', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await authorised(app)
    const subject = subjectInOrganisation(prisma, ids)

    const placed = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${ids.organization.id}/privacy/holds`,
      headers,
      payload: {
        subjectId: subject.id,
        kind: 'LEGAL',
        matterReference: 'MATTER-2026-0001',
      },
    })

    expect(placed.statusCode).toBe(201)
    expect(placed.json().data.state).toBe('ACTIVE')
    expect(placed.json().data.matterReference).toBe('MATTER-2026-0001')

    const listed = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${ids.organization.id}/privacy/holds`,
      headers,
    })

    expect(listed.statusCode).toBe(200)
    expect(listed.json().data).toHaveLength(1)

    const refused = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${ids.organization.id}/privacy/requests`,
      headers,
      payload: { subjectId: subject.id, reason: 'SUBJECT_REQUEST' },
    })

    expect(refused.statusCode).toBe(409)

    await app.close()
  })

  it('lifts a hold, and refuses to lift it twice', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await authorised(app)
    const subject = subjectInOrganisation(prisma, ids)

    const placed = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${ids.organization.id}/privacy/holds`,
      headers,
      payload: { subjectId: subject.id, kind: 'FRAUD_INVESTIGATION', matterReference: 'CASE-77' },
    })

    const holdId = placed.json().data.id

    const released = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${ids.organization.id}/privacy/holds/${holdId}/release`,
      headers,
      payload: { releaseReasonCode: 'INVESTIGATION_CLOSED' },
    })

    expect(released.statusCode).toBe(200)
    expect(released.json().data.state).toBe('RELEASED')
    expect(released.json().data.releaseReasonCode).toBe('INVESTIGATION_CLOSED')

    const again = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${ids.organization.id}/privacy/holds/${holdId}/release`,
      headers,
      payload: { releaseReasonCode: 'MATTER_CLOSED' },
    })

    expect(again.statusCode).toBe(409)

    await app.close()
  })

  it('refuses a free-text release reason', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await authorised(app)
    const subject = subjectInOrganisation(prisma, ids)

    const placed = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${ids.organization.id}/privacy/holds`,
      headers,
      payload: { subjectId: subject.id, kind: 'LEGAL', matterReference: 'MATTER-2' },
    })

    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${ids.organization.id}/privacy/holds/${placed.json().data.id}/release`,
      headers,
      payload: { releaseReasonCode: 'counsel said it was fine, Priya agreed' },
    })

    expect(response.statusCode).toBe(400)

    await app.close()
  })

  it('refuses a hold over somebody this organisation holds nothing about', async () => {
    const { app, ids } = await createTestApp()
    const headers = await authorised(app)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${ids.organization.id}/privacy/holds`,
      headers,
      payload: {
        subjectId: 'ckwwwwwwwwwwwwwwwwwwwwww',
        kind: 'LEGAL',
        matterReference: 'MATTER-3',
      },
    })

    expect(response.statusCode).toBe(404)

    await app.close()
  })

  it('refuses a hold once the step-up is stale', async () => {
    const { app, prisma, ids } = await createTestApp()
    const headers = await authorised(app)
    const subject = subjectInOrganisation(prisma, ids)

    ageStepUp(prisma, ids.owner.id)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${ids.organization.id}/privacy/holds`,
      headers,
      payload: { subjectId: subject.id, kind: 'LEGAL', matterReference: 'MATTER-4' },
    })

    expect(response.statusCode).toBe(403)
    expect(prisma._store.privacyHold).toHaveLength(0)

    await app.close()
  })
})
