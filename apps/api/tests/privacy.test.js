/**
 * The privacy surface: who may read the record of a redaction, and what it says.
 *
 * Phase 1 of the privacy workstream ships the authorization, the policy and the
 * data model. These tests are about the two properties that have to hold before
 * any of it is safe to build on: the capability is narrow, and the surface does
 * not leak.
 *
 * "Does not leak" means three separate things here, and each has its own test.
 * A caller who holds nothing is refused. A caller who holds the capability in
 * one organisation learns nothing about another — not whether a request exists,
 * not whether an identifier is real, and not through a pagination total. And a
 * caller who is entitled to everything on this surface still never sees a name
 * or an address, because a redaction record that quoted the person would be the
 * one record most worth stealing.
 */

import { describe, expect, it } from 'vitest'

import { createTestApp, bearer, signIn } from './helpers/app.js'
import { cuid } from './helpers/prisma-stub.js'

/** The policy revision a fixture request is stamped with. */
const POLICY_VERSION = '2026-09-17.1'

/**
 * Put one redaction request into the store.
 *
 * Written directly rather than through a route, because no route creates one
 * until Phase 2 — which is the point of Phase 1 having nothing that redacts.
 *
 * @param {object} prisma The stub client.
 * @param {object} fields Overrides.
 * @returns {object} The stored row.
 */
function seedRequest(prisma, fields) {
  const row = {
    id: fields.id,
    organizationId: fields.organizationId,
    subjectUserId: fields.subjectUserId,
    requestedById: fields.requestedById,
    state: fields.state ?? 'REQUESTED',
    reason: fields.reason ?? 'SUBJECT_REQUEST',
    holdDecision: fields.holdDecision ?? 'NOT_EVALUATED',
    idempotencyKey: `key-${fields.id}`,
    confirmationHash: 'a'.repeat(64),
    confirmationExpiresAt: new Date(Date.now() + 120_000),
    confirmedAt: null,
    policyVersion: POLICY_VERSION,
    correlationId: `DE-${fields.id.slice(0, 8).toUpperCase()}`,
    heldByHoldId: null,
    outcomeCode: fields.outcomeCode ?? null,
    scope: fields.scope ?? null,
    leaseOwner: null,
    leaseExpiresAt: null,
    attempts: 0,
    maxAttempts: 3,
    lastAttemptAt: null,
    failureCode: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    createdAt: fields.createdAt ?? new Date(),
    updatedAt: new Date(),
  }

  prisma._store.privacyRequest.push(row)

  return row
}

describe('GET /v1/organizations/:id/privacy/requests', () => {
  it('answers an owner with an empty list before anything has been asked for', async () => {
    const { app, ids } = await createTestApp()
    const token = await signIn(app, 'owner@rangoli.example')

    const response = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${ids.organization.id}/privacy/requests`,
      headers: bearer(token),
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data).toEqual([])
    expect(response.json().pagination).toMatchObject({ page: 1, perPage: 20, total: 0 })

    await app.close()
  })

  it('refuses a manager, who may run the organisation but not destroy a person', async () => {
    const { app, ids } = await createTestApp()
    const token = await signIn(app, 'arun@rangoli.example')

    const response = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${ids.organization.id}/privacy/requests`,
      headers: bearer(token),
    })

    // Not 404: the organisation is one they belong to and may already read in
    // other ways. What they lack is this capability, and saying so is correct.
    expect(response.statusCode).toBe(403)
    expect(response.json().error.code).toBe('FORBIDDEN')

    await app.close()
  })

  it('refuses a caller with no session at all', async () => {
    const { app, ids } = await createTestApp()

    const response = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${ids.organization.id}/privacy/requests`,
    })

    expect(response.statusCode).toBe(401)

    await app.close()
  })

  it('refuses an owner of a different organisation', async () => {
    const { app, ids } = await createTestApp()
    const token = await signIn(app, 'rival@dhol.example')

    const response = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${ids.organization.id}/privacy/requests`,
      headers: bearer(token),
    })

    // They hold `privacy:redact` — in their own organisation. The capability is
    // asserted against the organisation in the path, which is the whole reason
    // it is organisation-scoped rather than platform-wide.
    expect(response.statusCode).toBe(403)

    await app.close()
  })

  it('counts only this organisation into the pagination total', async () => {
    const { app, prisma, ids } = await createTestApp()

    const mine = cuid()
    seedRequest(prisma, {
      id: mine,
      organizationId: ids.organization.id,
      subjectUserId: ids.attendee.id,
      requestedById: ids.owner.id,
    })
    seedRequest(prisma, {
      id: cuid(),
      organizationId: ids.otherOrganization.id,
      subjectUserId: ids.attendee.id,
      requestedById: ids.outsider.id,
    })

    const token = await signIn(app, 'owner@rangoli.example')
    const response = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${ids.organization.id}/privacy/requests`,
      headers: bearer(token),
    })

    expect(response.statusCode).toBe(200)
    // A total is a leak in its own right: "there are three" tells a caller
    // something about rows they may not read.
    expect(response.json().pagination.total).toBe(1)
    expect(response.json().data.map((row) => row.id)).toEqual([mine])

    await app.close()
  })

  it('filters by state and by subject id', async () => {
    const { app, prisma, ids } = await createTestApp()

    const open = cuid()
    const held = cuid()
    seedRequest(prisma, {
      id: open,
      organizationId: ids.organization.id,
      subjectUserId: ids.attendee.id,
      requestedById: ids.owner.id,
      state: 'REQUESTED',
    })
    seedRequest(prisma, {
      id: held,
      organizationId: ids.organization.id,
      subjectUserId: ids.manager.id,
      requestedById: ids.owner.id,
      state: 'HELD',
      outcomeCode: 'REFUSED_LEGAL_HOLD',
    })

    const token = await signIn(app, 'owner@rangoli.example')

    const byState = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${ids.organization.id}/privacy/requests?state=HELD`,
      headers: bearer(token),
    })

    expect(byState.json().data.map((row) => row.id)).toEqual([held])

    const bySubject = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${ids.organization.id}/privacy/requests?subjectId=${ids.attendee.id}`,
      headers: bearer(token),
    })

    expect(bySubject.json().data.map((row) => row.id)).toEqual([open])

    await app.close()
  })

  it('refuses a subject filter that is an address rather than an id', async () => {
    const { app, ids } = await createTestApp()
    const token = await signIn(app, 'owner@rangoli.example')

    const response = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${ids.organization.id}/privacy/requests?subjectId=priya%40example.com`,
      headers: bearer(token),
    })

    // Searching by address would make this endpoint a way to confirm that a
    // named person is in the system, which is the question a redaction exists
    // to stop answering.
    expect(response.statusCode).toBe(400)
    expect(response.json().error.code).toBe('VALIDATION_ERROR')

    await app.close()
  })

  it('answers 404 for an organisation that does not exist', async () => {
    const { app } = await createTestApp()
    const token = await signIn(app, 'ops@desi-event.example')

    const response = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${cuid()}/privacy/requests`,
      headers: bearer(token),
    })

    expect(response.statusCode).toBe(404)

    await app.close()
  })
})

describe('GET /v1/organizations/:id/privacy/requests/:requestId', () => {
  it('returns a request the organisation owns', async () => {
    const { app, prisma, ids } = await createTestApp()

    const readable = cuid()
    seedRequest(prisma, {
      id: readable,
      organizationId: ids.organization.id,
      subjectUserId: ids.attendee.id,
      requestedById: ids.owner.id,
      scope: [{ category: 'ACCOUNT_IDENTITY', rows: 1 }],
    })

    const token = await signIn(app, 'owner@rangoli.example')
    const response = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${ids.organization.id}/privacy/requests/${readable}`,
      headers: bearer(token),
    })

    expect(response.statusCode).toBe(200)
    expect(response.json().data).toMatchObject({
      id: readable,
      subjectId: ids.attendee.id,
      state: 'REQUESTED',
      reason: 'SUBJECT_REQUEST',
      holdDecision: 'NOT_EVALUATED',
      policyVersion: POLICY_VERSION,
      scope: [{ category: 'ACCOUNT_IDENTITY', rows: 1 }],
    })

    await app.close()
  })

  it('gives the same answer for another organisation’s request as for one that never existed', async () => {
    const { app, prisma, ids } = await createTestApp()

    const theirs = cuid()
    seedRequest(prisma, {
      id: theirs,
      organizationId: ids.otherOrganization.id,
      subjectUserId: ids.attendee.id,
      requestedById: ids.outsider.id,
    })

    const token = await signIn(app, 'owner@rangoli.example')

    const real = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${ids.organization.id}/privacy/requests/${theirs}`,
      headers: bearer(token),
    })
    const imaginary = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${ids.organization.id}/privacy/requests/${cuid()}`,
      headers: bearer(token),
    })

    // Byte-for-byte the same refusal. A caller who could tell these apart could
    // confirm that an identifier is real without being allowed to read it.
    expect(real.statusCode).toBe(404)
    expect(imaginary.statusCode).toBe(404)
    expect(real.json().error.code).toBe(imaginary.json().error.code)
    expect(real.json().error.message).toBe(imaginary.json().error.message)

    await app.close()
  })

  it('never carries the subject’s name, address or any redactable value', async () => {
    const { app, prisma, ids } = await createTestApp()

    const quiet = cuid()
    seedRequest(prisma, {
      id: quiet,
      organizationId: ids.organization.id,
      subjectUserId: ids.attendee.id,
      requestedById: ids.owner.id,
    })

    const token = await signIn(app, 'owner@rangoli.example')
    const response = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${ids.organization.id}/privacy/requests/${quiet}`,
      headers: bearer(token),
    })
    const body = response.payload

    expect(body).not.toContain('priya@example.com')
    expect(body).not.toContain('Priya Sharma')
    // Nor the machinery a browser must never hold: a confirmation an API hands
    // back is not a confirmation, and an idempotency key a caller can read is a
    // key a caller can replay.
    expect(body).not.toContain('confirmationHash')
    expect(body).not.toContain('idempotencyKey')
    expect(body).not.toContain('leaseOwner')

    await app.close()
  })
})
