/**
 * The request lifecycle and its evidence, against a real database.
 *
 * This suite tests the parts that only PostgreSQL can refuse: the state
 * transitions the trigger enforces, the partial unique index that permits one
 * live request per subject, and the append-only rules on both audit tables. The
 * service's own checks are asserted alongside them, and where the two overlap
 * that is deliberate — a rule enforced in one place is a rule a refactor can
 * remove.
 *
 * ## The two properties worth stating plainly
 *
 * **A confirmation is single-use, server-issued and short-lived.** The phrase
 * never exists in the database; only its digest does. So a test that wants to
 * confirm has to carry the phrase from the creation call, which is exactly the
 * constraint a real operator is under.
 *
 * **Evidence cannot be edited.** Every refusal, every confirmation and every
 * completion writes a `PrivacyAuditEvent`, and
 * `desi_privacy_audit_event_immutable` refuses `UPDATE` and `DELETE` on that
 * table unconditionally. The suite proves the refusal rather than trusting it.
 *
 * There is deliberately no teardown, for the reason given in
 * `privacy-redaction-integration.test.js`.
 *
 * @module @desi-event/api/tests/privacy-lifecycle-integration
 */

import { randomUUID } from 'node:crypto'

import { expect, it } from 'vitest'

import { isRedactedValue } from '../src/lib/privacy-placeholders.js'
import { HOLD_DECISIONS, placeHold, releaseHold } from '../src/lib/privacy-holds.js'
import {
  cancelPrivacyRequest,
  confirmPrivacyRequest,
  raisePrivacyRequest,
} from '../src/lib/privacy-requests.js'
import { connectTestDatabase } from './helpers/database.js'

/** Marks every row this suite creates. */
const TAG = `plc${randomUUID().slice(0, 8)}`

const { prisma, when } = await connectTestDatabase('the privacy lifecycle integration suite')

/** An event already finished, so an admission never blocks these cases. */
const PAST_START = new Date('2020-05-01T18:00:00Z')
const PAST_END = new Date('2020-05-01T22:00:00Z')

let counter = 0

/**
 * A unique fragment.
 *
 * @param {string} label What it is.
 * @returns {string} The fragment.
 */
function unique(label) {
  counter += 1

  return `${label}-${TAG}-${counter}`
}

/**
 * An organisation, a finished event, a subject with a paid order, and an actor.
 *
 * @returns {Promise<object>} The graph.
 */
async function scenario() {
  const slug = unique('org')

  const org = await prisma.organization.create({
    data: {
      name: `Org ${slug}`,
      slug,
      contactEmail: `${slug}@example.test`,
      verified: true,
      verificationStatus: 'VERIFIED',
    },
  })

  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      title: `Event ${slug}`,
      slug: unique('event'),
      summary: 'Seeded for the privacy lifecycle suite.',
      description: 'Seeded by the privacy lifecycle integration suite.',
      category: 'COMEDY',
      status: 'PUBLISHED',
      startsAt: PAST_START,
      endsAt: PAST_END,
    },
  })

  const ticketType = await prisma.ticketType.create({
    data: {
      eventId: event.id,
      name: 'General',
      priceCents: 100_000,
      currency: 'INR',
      quantityTotal: 50,
    },
  })

  const make = async (label) => {
    const who = unique(label)

    return prisma.user.create({
      data: {
        email: `${who}@people.test`,
        passwordHash: 'x'.repeat(60),
        displayName: `Person ${who}`,
        role: 'ATTENDEE',
        emailVerified: true,
      },
    })
  }

  const subject = await make('subject')
  const actor = await make('actor')

  const order = await prisma.order.create({
    data: {
      reference: unique('DE').toUpperCase(),
      eventId: event.id,
      userId: subject.id,
      buyerEmail: subject.email,
      buyerName: subject.displayName,
      status: 'PAID',
      currency: 'INR',
      subtotalCents: 100_000,
      feesCents: 0,
      taxCents: 0,
      discountCents: 0,
      totalCents: 100_000,
      paidAt: new Date('2026-01-01T00:00:00Z'),
    },
  })

  const item = await prisma.orderItem.create({
    data: {
      orderId: order.id,
      ticketTypeId: ticketType.id,
      quantity: 1,
      unitPriceCents: 100_000,
      subtotalCents: 100_000,
    },
  })

  await prisma.ticket.create({
    data: {
      orderItemId: item.id,
      code: unique('DET').toUpperCase(),
      status: 'REFUNDED',
      attendeeName: subject.displayName,
      ownerUserId: subject.id,
    },
  })

  return { org, event, subject, actor, order }
}

/**
 * Raise a request and hand back everything a confirmation needs.
 *
 * @param {object} graph A scenario.
 * @param {Date} [now] The instant.
 * @returns {Promise<object>} The request and its phrase.
 */
function raise(graph, now = new Date()) {
  return raisePrivacyRequest(prisma, {
    organizationId: graph.org.id,
    subjectUserId: graph.subject.id,
    actor: graph.actor,
    reason: 'SUBJECT_REQUEST',
    now,
  })
}

when()('raising a request', () => {
  it('writes nothing about the subject and returns a phrase exactly once', async () => {
    const graph = await scenario()
    const { request, confirmationPhrase } = await raise(graph)

    expect(request.state).toBe('REQUESTED')
    expect(request.holdDecision).toBe('NONE_ACTIVE')
    expect(confirmationPhrase).toMatch(/^[0-9a-f]{18}$/)

    // The phrase is not in the row. Only its digest is.
    const stored = await prisma.privacyRequest.findUnique({ where: { id: request.id } })

    expect(stored.confirmationHash).not.toBe(confirmationPhrase)
    expect(JSON.stringify(stored)).not.toContain(confirmationPhrase)

    // Nothing has been redacted yet.
    const subject = await prisma.user.findUnique({ where: { id: graph.subject.id } })

    expect(subject.email).toBe(graph.subject.email)
  })

  it('mints its own idempotency key, so a caller cannot choose a replay', async () => {
    const graph = await scenario()
    const { request } = await raise(graph)

    expect(request.idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )
  })

  it('permits one live request per subject and refuses the second', async () => {
    const graph = await scenario()

    await raise(graph)

    await expect(raise(graph)).rejects.toThrow(/already open/i)
  })

  it('refuses while a legal hold is active, and records the refusal', async () => {
    const graph = await scenario()

    await placeHold(prisma, {
      organizationId: graph.org.id,
      subjectUserId: graph.subject.id,
      kind: 'LEGAL',
      matterReference: unique('matter'),
      placedById: graph.actor.id,
    })

    await expect(raise(graph)).rejects.toThrow(/cannot be redacted/i)

    // No row was created, so the subject is not locked out of asking later.
    const requests = await prisma.privacyRequest.count({
      where: { subjectUserId: graph.subject.id },
    })

    expect(requests).toBe(0)

    // The refusal is nonetheless permanent evidence.
    const events = await prisma.privacyAuditEvent.findMany({
      where: { targetId: graph.subject.id },
    })

    expect(events).toHaveLength(1)
    expect(events[0].result).toBe('REFUSED_HOLD')
    expect(events[0].holdDecision).toBe('LEGAL_HOLD_ACTIVE')
  })
})

when()('confirming a request', () => {
  it('redacts, and records a confirmation and a completion', async () => {
    const graph = await scenario()
    const { request, confirmationPhrase } = await raise(graph)

    const completed = await confirmPrivacyRequest(prisma, {
      organizationId: graph.org.id,
      requestId: request.id,
      confirmationPhrase,
      actor: graph.actor,
      now: new Date(),
    })

    expect(completed.state).toBe('COMPLETED')
    expect(completed.outcomeCode).toBe('REDACTED')
    expect(completed.confirmedAt).not.toBe(null)
    expect(completed.startedAt).not.toBe(null)
    expect(completed.completedAt).not.toBe(null)

    const subject = await prisma.user.findUnique({ where: { id: graph.subject.id } })

    expect(isRedactedValue(subject.email)).toBe(true)

    const results = (
      await prisma.privacyAuditEvent.findMany({
        where: { privacyRequestId: request.id },
        orderBy: { occurredAt: 'asc' },
      })
    ).map((row) => row.result)

    expect(results).toEqual(['REQUESTED', 'CONFIRMED', 'COMPLETED'])
  })

  it('refuses a phrase that does not match, and redacts nothing', async () => {
    const graph = await scenario()
    const { request } = await raise(graph)

    await expect(
      confirmPrivacyRequest(prisma, {
        organizationId: graph.org.id,
        requestId: request.id,
        confirmationPhrase: 'f'.repeat(18),
        actor: graph.actor,
        now: new Date(),
      }),
    ).rejects.toThrow(/does not match/i)

    const subject = await prisma.user.findUnique({ where: { id: graph.subject.id } })

    expect(subject.email).toBe(graph.subject.email)

    const still = await prisma.privacyRequest.findUnique({ where: { id: request.id } })

    expect(still.state).toBe('REQUESTED')
  })

  it('refuses a phrase whose window has closed', async () => {
    const graph = await scenario()
    const { request, confirmationPhrase } = await raise(graph)

    const tooLate = new Date(request.confirmationExpiresAt.getTime() + 1_000)

    await expect(
      confirmPrivacyRequest(prisma, {
        organizationId: graph.org.id,
        requestId: request.id,
        confirmationPhrase,
        actor: graph.actor,
        now: tooLate,
      }),
    ).rejects.toThrow(/expired/i)
  })

  it('is idempotent — confirming twice returns the first outcome and writes nothing', async () => {
    const graph = await scenario()
    const { request, confirmationPhrase } = await raise(graph)

    const confirm = () =>
      confirmPrivacyRequest(prisma, {
        organizationId: graph.org.id,
        requestId: request.id,
        confirmationPhrase,
        actor: graph.actor,
        now: new Date(),
      })

    const first = await confirm()
    const eventsAfterFirst = await prisma.privacyAuditEvent.count({
      where: { privacyRequestId: request.id },
    })

    const second = await confirm()
    const eventsAfterSecond = await prisma.privacyAuditEvent.count({
      where: { privacyRequestId: request.id },
    })

    expect(second.id).toBe(first.id)
    expect(second.completedAt.toISOString()).toBe(first.completedAt.toISOString())
    expect(eventsAfterSecond).toBe(eventsAfterFirst)
  })

  it('refuses a request belonging to another organisation with the same 404 as one that never existed', async () => {
    const mine = await scenario()
    const theirs = await scenario()
    const { request } = await raise(theirs)

    const crossTenant = confirmPrivacyRequest(prisma, {
      organizationId: mine.org.id,
      requestId: request.id,
      confirmationPhrase: 'a'.repeat(18),
      actor: mine.actor,
      now: new Date(),
    }).catch((error) => error)

    const invented = confirmPrivacyRequest(prisma, {
      organizationId: mine.org.id,
      requestId: 'ckdoesnotexist0000000000',
      confirmationPhrase: 'a'.repeat(18),
      actor: mine.actor,
      now: new Date(),
    }).catch((error) => error)

    const [a, b] = await Promise.all([crossTenant, invented])

    // Byte-identical. A caller must not be able to learn that an identifier is
    // real from the shape of the refusal.
    expect(a.message).toBe(b.message)
    expect(a.statusCode).toBe(b.statusCode)
  })

  it('stops when a hold appears between raising and confirming', async () => {
    const graph = await scenario()
    const { request, confirmationPhrase } = await raise(graph)

    const hold = await placeHold(prisma, {
      organizationId: graph.org.id,
      subjectUserId: graph.subject.id,
      kind: 'LEGAL',
      matterReference: unique('late-matter'),
      placedById: graph.actor.id,
    })

    const held = await confirmPrivacyRequest(prisma, {
      organizationId: graph.org.id,
      requestId: request.id,
      confirmationPhrase,
      actor: graph.actor,
      now: new Date(),
    })

    expect(held.state).toBe('HELD')
    expect(held.heldByHoldId).toBe(hold.id)
    expect(held.holdDecision).toBe('LEGAL_HOLD_ACTIVE')
    expect(held.outcomeCode).toBe('REFUSED_LEGAL_HOLD')

    const subject = await prisma.user.findUnique({ where: { id: graph.subject.id } })

    expect(subject.email).toBe(graph.subject.email)
  })

  it('can proceed on a fresh request once the hold is lifted', async () => {
    const graph = await scenario()

    const hold = await placeHold(prisma, {
      organizationId: graph.org.id,
      subjectUserId: graph.subject.id,
      kind: 'FRAUD_INVESTIGATION',
      matterReference: unique('case'),
      placedById: graph.actor.id,
    })

    await expect(raise(graph)).rejects.toThrow(/cannot be redacted/i)

    const { released } = await releaseHold(prisma, {
      organizationId: graph.org.id,
      holdId: hold.id,
      releasedById: graph.actor.id,
      releaseReasonCode: 'INVESTIGATION_CLOSED',
      now: new Date(),
    })

    expect(released).toBe(true)

    const { request, confirmationPhrase } = await raise(graph)
    const completed = await confirmPrivacyRequest(prisma, {
      organizationId: graph.org.id,
      requestId: request.id,
      confirmationPhrase,
      actor: graph.actor,
      now: new Date(),
    })

    expect(completed.state).toBe('COMPLETED')
  })

  it('refuses a second release of the same hold rather than overwriting the first releaser', async () => {
    const graph = await scenario()

    const hold = await placeHold(prisma, {
      organizationId: graph.org.id,
      subjectUserId: graph.subject.id,
      kind: 'LEGAL',
      matterReference: unique('once'),
      placedById: graph.actor.id,
    })

    const args = {
      organizationId: graph.org.id,
      holdId: hold.id,
      releasedById: graph.actor.id,
      releaseReasonCode: 'MATTER_CLOSED',
      now: new Date(),
    }

    expect((await releaseHold(prisma, args)).released).toBe(true)
    expect((await releaseHold(prisma, args)).released).toBe(false)
  })
})

when()('withdrawing a request', () => {
  it('cancels one that has not run', async () => {
    const graph = await scenario()
    const { request } = await raise(graph)

    const cancelled = await cancelPrivacyRequest(prisma, {
      organizationId: graph.org.id,
      requestId: request.id,
      actor: graph.actor,
      now: new Date(),
    })

    expect(cancelled.state).toBe('CANCELLED')
    expect(cancelled.cancelledAt).not.toBe(null)
    expect(cancelled.outcomeCode).toBe('WITHDRAWN_BY_OPERATOR')

    const subject = await prisma.user.findUnique({ where: { id: graph.subject.id } })

    expect(subject.email).toBe(graph.subject.email)
  })

  it('refuses to withdraw one that has already finished', async () => {
    const graph = await scenario()
    const { request, confirmationPhrase } = await raise(graph)

    await confirmPrivacyRequest(prisma, {
      organizationId: graph.org.id,
      requestId: request.id,
      confirmationPhrase,
      actor: graph.actor,
      now: new Date(),
    })

    await expect(
      cancelPrivacyRequest(prisma, {
        organizationId: graph.org.id,
        requestId: request.id,
        actor: graph.actor,
        now: new Date(),
      }),
    ).rejects.toThrow(/no longer be withdrawn/i)
  })

  it('frees the subject to be asked about again', async () => {
    const graph = await scenario()
    const first = await raise(graph)

    await cancelPrivacyRequest(prisma, {
      organizationId: graph.org.id,
      requestId: first.request.id,
      actor: graph.actor,
      now: new Date(),
    })

    // CANCELLED is outside the partial unique index, so a new request is allowed.
    const second = await raise(graph)

    expect(second.request.id).not.toBe(first.request.id)
  })
})

when()('what the database refuses regardless of the service', () => {
  it('refuses a transition out of a terminal state', async () => {
    const graph = await scenario()
    const { request } = await raise(graph)

    await cancelPrivacyRequest(prisma, {
      organizationId: graph.org.id,
      requestId: request.id,
      actor: graph.actor,
      now: new Date(),
    })

    await expect(
      prisma.privacyRequest.update({ where: { id: request.id }, data: { state: 'QUEUED' } }),
    ).rejects.toThrow(/cannot move to/i)
  })

  it('refuses a change to what a request is about', async () => {
    const graph = await scenario()
    const other = await scenario()
    const { request } = await raise(graph)

    await expect(
      prisma.privacyRequest.update({
        where: { id: request.id },
        data: { subjectUserId: other.subject.id },
      }),
    ).rejects.toThrow(/cannot change what it is about/i)
  })

  it('refuses execution while the hold decision is not clear', async () => {
    const graph = await scenario()
    const { request } = await raise(graph)

    await expect(
      prisma.privacyRequest.update({
        where: { id: request.id },
        data: { state: 'QUEUED', holdDecision: 'NOT_EVALUATED', confirmedAt: new Date() },
      }),
    ).rejects.toThrow()
  })

  it('refuses an update to a privacy audit event', async () => {
    const graph = await scenario()
    const { request } = await raise(graph)

    const event = await prisma.privacyAuditEvent.findFirst({
      where: { privacyRequestId: request.id },
    })

    await expect(
      prisma.privacyAuditEvent.update({
        where: { id: event.id },
        data: { reasonCode: 'REWRITTEN' },
      }),
    ).rejects.toThrow()
  })

  it('refuses a delete of a privacy audit event', async () => {
    const graph = await scenario()
    const { request } = await raise(graph)

    const event = await prisma.privacyAuditEvent.findFirst({
      where: { privacyRequestId: request.id },
    })

    await expect(prisma.privacyAuditEvent.delete({ where: { id: event.id } })).rejects.toThrow()
  })
})

when()('the evidence a redaction leaves', () => {
  it('carries no personal value in any audit event', async () => {
    const graph = await scenario()
    const { request, confirmationPhrase } = await raise(graph)

    await confirmPrivacyRequest(prisma, {
      organizationId: graph.org.id,
      requestId: request.id,
      confirmationPhrase,
      actor: graph.actor,
      now: new Date(),
    })

    const events = await prisma.privacyAuditEvent.findMany({
      where: { privacyRequestId: request.id },
    })
    const serialised = JSON.stringify(events)

    expect(serialised).not.toContain(graph.subject.email)
    expect(serialised).not.toContain(graph.subject.displayName)
    expect(serialised).not.toContain(confirmationPhrase)
    // The idempotency key is stored as a digest, never raw.
    expect(serialised).not.toContain(request.idempotencyKey)

    for (const event of events) {
      expect(event.idempotencyKeyHash).toMatch(/^[0-9a-f]{64}$/)
      expect(event.targetType).toBe('User')
      expect(event.targetId).toBe(graph.subject.id)
    }
  })

  it('leaves every pre-existing AuditLog row exactly as it was', async () => {
    const graph = await scenario()

    await prisma.auditLog.create({
      data: {
        action: 'order.paid',
        entityType: 'Order',
        entityId: graph.order.id,
        actorId: graph.subject.id,
        metadata: { reference: graph.order.reference },
      },
    })

    const before = await prisma.auditLog.findMany({
      where: { entityId: graph.order.id },
      orderBy: { id: 'asc' },
    })

    const { request, confirmationPhrase } = await raise(graph)

    await confirmPrivacyRequest(prisma, {
      organizationId: graph.org.id,
      requestId: request.id,
      confirmationPhrase,
      actor: graph.actor,
      now: new Date(),
    })

    const after = await prisma.auditLog.findMany({
      where: { entityId: graph.order.id },
      orderBy: { id: 'asc' },
    })

    expect(JSON.stringify(after)).toBe(JSON.stringify(before))
  })

  it('shares one correlation id across every event of one attempt', async () => {
    const graph = await scenario()
    const { request, confirmationPhrase } = await raise(graph)

    await confirmPrivacyRequest(prisma, {
      organizationId: graph.org.id,
      requestId: request.id,
      confirmationPhrase,
      actor: graph.actor,
      now: new Date(),
    })

    const events = await prisma.privacyAuditEvent.findMany({
      where: { privacyRequestId: request.id },
    })

    expect(new Set(events.map((event) => event.correlationId)).size).toBe(1)
    expect(events[0].correlationId).toBe(request.correlationId)
  })
})

when()('two operators at once', () => {
  it('lets exactly one raise a request for the same subject', async () => {
    const graph = await scenario()

    const results = await Promise.allSettled([raise(graph), raise(graph), raise(graph)])

    const won = results.filter((result) => result.status === 'fulfilled')
    const lost = results.filter((result) => result.status === 'rejected')

    expect(won).toHaveLength(1)
    expect(lost).toHaveLength(2)

    const live = await prisma.privacyRequest.count({
      where: {
        subjectUserId: graph.subject.id,
        state: { in: ['REQUESTED', 'QUEUED', 'PROCESSING'] },
      },
    })

    expect(live).toBe(1)
  })

  it('redacts once when the same confirmation is submitted twice at the same moment', async () => {
    const graph = await scenario()
    const { request, confirmationPhrase } = await raise(graph)

    const confirm = () =>
      confirmPrivacyRequest(prisma, {
        organizationId: graph.org.id,
        requestId: request.id,
        confirmationPhrase,
        actor: graph.actor,
        now: new Date(),
      })

    const results = await Promise.allSettled([confirm(), confirm()])
    const completed = results.filter(
      (result) => result.status === 'fulfilled' && result.value.state === 'COMPLETED',
    )

    expect(completed.length).toBeGreaterThanOrEqual(1)

    // Whatever the interleaving, the request ends COMPLETED exactly once and the
    // subject is redacted exactly once.
    const final = await prisma.privacyRequest.findUnique({ where: { id: request.id } })

    expect(final.state).toBe('COMPLETED')

    const subject = await prisma.user.findUnique({ where: { id: graph.subject.id } })

    expect(isRedactedValue(subject.email)).toBe(true)

    const completions = await prisma.privacyAuditEvent.count({
      where: { privacyRequestId: request.id, result: 'COMPLETED' },
    })

    expect(completions).toBe(1)
  })
})

when()('the hold decision the database insists on', () => {
  it('agrees with the service about what "clear" means', async () => {
    const graph = await scenario()
    const { request, confirmationPhrase } = await raise(graph)

    await confirmPrivacyRequest(prisma, {
      organizationId: graph.org.id,
      requestId: request.id,
      confirmationPhrase,
      actor: graph.actor,
      now: new Date(),
    })

    const completed = await prisma.privacyRequest.findUnique({ where: { id: request.id } })

    // `privacy_request_executes_only_when_clear` would have refused the row
    // otherwise, so reaching COMPLETED is itself the proof.
    expect(completed.holdDecision).toBe(HOLD_DECISIONS.NONE_ACTIVE)
  })
})
