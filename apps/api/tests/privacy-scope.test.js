/**
 * Organisation scope for a redaction, and the presenter that keeps it quiet.
 *
 * The capability guard confines an organiser to the organisation in the path.
 * It does not confine a platform `SUPER_ADMIN`: the permission table grants
 * every capability platform-wide, and `decide` returns a platform grant before
 * it looks at an organisation id at all. So the capability check alone would let
 * a request name organisation A while targeting somebody who exists only in
 * organisation B.
 *
 * `assertSubjectBelongsToOrganization` is the layer that refuses that, and these
 * tests are what make it a control rather than an intention. They assert it for
 * every actor rather than for the platform role specially, because a rule with
 * an exception is a rule somebody will find the exception to.
 */

import { describe, expect, it } from 'vitest'

import {
  PRIVACY_CATEGORIES,
  PRIVACY_OUTCOMES,
  PRIVACY_POLICY_VERSION,
  PRIVACY_REASONS,
  assertSubjectBelongsToOrganization,
  loadOrganizationForPrivacy,
  subjectBelongsToOrganization,
  toPrivacyRequest,
} from '../src/lib/privacy.js'
import { createPrismaStub, cuid } from './helpers/prisma-stub.js'

const ORG = cuid()
const OTHER_ORG = cuid()
const EVENT = cuid()
const OTHER_EVENT = cuid()

/**
 * A store holding two organisations and one event apiece.
 *
 * @param {object} extra Rows to add on top.
 * @returns {object} A stub client.
 */
function world(extra = {}) {
  return createPrismaStub({
    organization: [
      { id: ORG, name: 'Rangoli', slug: 'rangoli', contactEmail: 'hello@rangoli.example' },
      { id: OTHER_ORG, name: 'Dhol', slug: 'dhol', contactEmail: 'hello@dhol.example' },
    ],
    event: [
      { id: EVENT, organizationId: ORG, title: 'Mine', slug: 'mine' },
      { id: OTHER_EVENT, organizationId: OTHER_ORG, title: 'Theirs', slug: 'theirs' },
    ],
    ...extra,
  })
}

describe('loadOrganizationForPrivacy', () => {
  it('returns the organisation when it exists', async () => {
    const prisma = world()

    await expect(loadOrganizationForPrivacy(prisma, ORG)).resolves.toMatchObject({ id: ORG })
  })

  it('answers 404 rather than 403 for one that does not', async () => {
    const prisma = world()

    await expect(loadOrganizationForPrivacy(prisma, cuid())).rejects.toMatchObject({
      statusCode: 404,
    })
  })
})

describe('subjectBelongsToOrganization', () => {
  it('counts a member', async () => {
    const subject = cuid()
    const prisma = world({
      membership: [{ id: cuid(), userId: subject, organizationId: ORG, role: 'VIEWER' }],
    })

    await expect(
      subjectBelongsToOrganization(prisma, { organizationId: ORG, subjectUserId: subject }),
    ).resolves.toBe(true)
  })

  it('counts a buyer, who is the usual subject and is not a member of anything', async () => {
    const subject = cuid()
    const prisma = world({
      order: [
        {
          id: cuid(),
          eventId: EVENT,
          userId: subject,
          reference: 'DE-BUYER01',
          buyerEmail: 'buyer@example.test',
          buyerName: 'Buyer',
          subtotalCents: 1000,
          totalCents: 1000,
        },
      ],
    })

    await expect(
      subjectBelongsToOrganization(prisma, { organizationId: ORG, subjectUserId: subject }),
    ).resolves.toBe(true)
  })

  it('counts a ticket holder, reached through the order the ticket came from', async () => {
    const subject = cuid()
    const order = cuid()
    const orderItem = cuid()
    const prisma = world({
      order: [
        {
          id: order,
          eventId: EVENT,
          userId: null,
          reference: 'DE-GUEST01',
          buyerEmail: 'guest@example.test',
          buyerName: 'Guest',
          subtotalCents: 1000,
          totalCents: 1000,
        },
      ],
      orderItem: [{ id: orderItem, orderId: order, ticketTypeId: cuid(), quantity: 1 }],
      ticket: [{ id: cuid(), orderItemId: orderItem, code: 'DE-TKT00001', ownerUserId: subject }],
    })

    await expect(
      subjectBelongsToOrganization(prisma, { organizationId: ORG, subjectUserId: subject }),
    ).resolves.toBe(true)
  })

  it('counts somebody who only ever joined a waitlist', async () => {
    const subject = cuid()
    const prisma = world({
      waitlistEntry: [
        { id: cuid(), eventId: EVENT, userId: subject, email: 'hopeful@example.test', quantity: 1 },
      ],
    })

    await expect(
      subjectBelongsToOrganization(prisma, { organizationId: ORG, subjectUserId: subject }),
    ).resolves.toBe(true)
  })

  it('does not count somebody the organisation holds nothing about', async () => {
    const prisma = world()

    await expect(
      subjectBelongsToOrganization(prisma, { organizationId: ORG, subjectUserId: cuid() }),
    ).resolves.toBe(false)
  })

  it('does not count a person who belongs to the other organisation', async () => {
    const subject = cuid()
    const prisma = world({
      membership: [{ id: cuid(), userId: subject, organizationId: OTHER_ORG, role: 'OWNER' }],
      order: [
        {
          id: cuid(),
          eventId: OTHER_EVENT,
          userId: subject,
          reference: 'DE-THEIRS1',
          buyerEmail: 'theirs@example.test',
          buyerName: 'Theirs',
          subtotalCents: 1000,
          totalCents: 1000,
        },
      ],
    })

    // The case the capability check cannot catch for a platform administrator:
    // they hold `privacy:redact` everywhere, so only this answer stops a request
    // naming one organisation from reaching a person in another.
    await expect(
      subjectBelongsToOrganization(prisma, { organizationId: ORG, subjectUserId: subject }),
    ).resolves.toBe(false)
  })
})

describe('assertSubjectBelongsToOrganization', () => {
  it('passes a subject in scope', async () => {
    const subject = cuid()
    const prisma = world({
      membership: [{ id: cuid(), userId: subject, organizationId: ORG, role: 'VIEWER' }],
    })

    await expect(
      assertSubjectBelongsToOrganization(prisma, { organizationId: ORG, subjectUserId: subject }),
    ).resolves.toBeUndefined()
  })

  it('refuses one out of scope with a 404 that names no reason', async () => {
    const prisma = world()
    const missing = cuid()
    const elsewhere = cuid()
    const withMembership = createPrismaStub({
      organization: [
        { id: ORG, name: 'Rangoli', slug: 'rangoli', contactEmail: 'hello@rangoli.example' },
        { id: OTHER_ORG, name: 'Dhol', slug: 'dhol', contactEmail: 'hello@dhol.example' },
      ],
      membership: [{ id: cuid(), userId: elsewhere, organizationId: OTHER_ORG, role: 'OWNER' }],
    })

    const absent = await assertSubjectBelongsToOrganization(prisma, {
      organizationId: ORG,
      subjectUserId: missing,
    }).catch((error) => error)
    const foreign = await assertSubjectBelongsToOrganization(withMembership, {
      organizationId: ORG,
      subjectUserId: elsewhere,
    }).catch((error) => error)

    // A person who does not exist and a person in another organisation get the
    // same sentence. A caller who could tell them apart could use this route to
    // confirm that an identifier belongs to a real person somewhere else.
    expect(absent.statusCode).toBe(404)
    expect(foreign.statusCode).toBe(404)
    expect(absent.message).toBe(foreign.message)
  })
})

describe('toPrivacyRequest', () => {
  it('names every field it returns and returns nothing else', () => {
    const row = {
      id: cuid(),
      organizationId: ORG,
      subjectUserId: cuid(),
      requestedById: cuid(),
      state: 'COMPLETED',
      reason: PRIVACY_REASONS.SUBJECT_REQUEST,
      idempotencyKey: 'secret-key',
      confirmationHash: 'a'.repeat(64),
      confirmationExpiresAt: new Date(),
      confirmedAt: new Date(),
      policyVersion: PRIVACY_POLICY_VERSION,
      correlationId: 'DE-ABCD1234',
      holdDecision: 'NONE_ACTIVE',
      heldByHoldId: null,
      outcomeCode: PRIVACY_OUTCOMES.REDACTED,
      scope: [{ category: PRIVACY_CATEGORIES.ACCOUNT_IDENTITY, rows: 1 }],
      leaseOwner: 'worker-1',
      leaseExpiresAt: new Date(),
      attempts: 1,
      maxAttempts: 3,
      lastAttemptAt: new Date(),
      failureCode: null,
      startedAt: new Date(),
      completedAt: new Date(),
      cancelledAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    const view = toPrivacyRequest(row)

    expect(Object.keys(view).sort()).toEqual([
      'cancelledAt',
      'completedAt',
      'confirmedAt',
      'correlationId',
      'holdDecision',
      'id',
      'outcomeCode',
      'policyVersion',
      'reason',
      'requestedAt',
      'scope',
      'startedAt',
      'state',
      'subjectId',
    ])
  })

  it('drops the confirmation, the idempotency key and the lease', () => {
    const view = toPrivacyRequest({
      id: cuid(),
      organizationId: ORG,
      subjectUserId: cuid(),
      state: 'REQUESTED',
      reason: PRIVACY_REASONS.SUBJECT_REQUEST,
      holdDecision: 'NOT_EVALUATED',
      policyVersion: PRIVACY_POLICY_VERSION,
      correlationId: 'DE-ABCD1234',
      idempotencyKey: 'secret-key',
      confirmationHash: 'b'.repeat(64),
      leaseOwner: 'worker-1',
      scope: null,
      createdAt: new Date(),
    })

    expect(JSON.stringify(view)).not.toContain('secret-key')
    expect(JSON.stringify(view)).not.toContain('b'.repeat(64))
    expect(JSON.stringify(view)).not.toContain('worker-1')
  })

  it('treats a scope that is not a list as absent rather than passing it through', () => {
    // `scope` is JSON, so a malformed row would otherwise reach a response
    // schema as whatever it happens to hold.
    const view = toPrivacyRequest({
      id: cuid(),
      subjectUserId: cuid(),
      state: 'REQUESTED',
      reason: PRIVACY_REASONS.SUBJECT_REQUEST,
      holdDecision: 'NOT_EVALUATED',
      policyVersion: PRIVACY_POLICY_VERSION,
      correlationId: 'DE-ABCD1234',
      scope: { category: 'ACCOUNT_IDENTITY' },
      createdAt: new Date(),
    })

    expect(view.scope).toBeNull()
  })
})
