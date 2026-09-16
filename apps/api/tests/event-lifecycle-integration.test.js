/**
 * The event lifecycle, against a real database.
 *
 * The stub cannot prove any of this. What is under test is what happens when
 * two writes race, and a single-threaded in-memory store serialises them by
 * construction — so a stub that passes a concurrency test proves only that the
 * test is not a concurrency test.
 *
 * Every case here is the same question: two people pressed the same button.
 * The answer is always that one of them wins and the other is told the truth,
 * and the mechanism is always the conditional `UPDATE` with an affected-row
 * count, which is the primitive the seat and venue-map code already uses.
 *
 * Nothing here weakens a constraint to make a test pass. Where the database
 * refuses, the refusal is the assertion.
 *
 * Runs against TEST_DATABASE_URL and skips itself when no database is
 * reachable, the same way the venue-map and ledger suites do.
 *
 * @file @desi-event/api/tests/event-lifecycle-integration
 */

import { afterAll, describe, expect, it } from 'vitest'

import { createPrismaClient } from '@desi-event/db'

import { requireDatabaseOrWarn } from './helpers/database.js'

import { loadForTransition, transitionEvent } from '../src/lib/event-lifecycle.js'

const CONNECTION =
  process.env.TEST_DATABASE_URL ??
  'postgresql://desi:desi@127.0.0.1:5432/desi_event_test?schema=public'

/** A suffix unique to this run, so repeated runs do not collide on unique names. */
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`

const prisma = createPrismaClient({ connectionString: CONNECTION })
const reachable = await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false)

requireDatabaseOrWarn('the event-lifecycle integration suite', reachable, CONNECTION)

/** Rows this suite created, for teardown. */
const made = { events: [], venues: [], organizations: [], users: [] }

/**
 * An actor the service will accept, with the capabilities named.
 *
 * The service asks `can(actor, capability, { organizationId })`, so an actor is
 * a shape rather than a database row. Building one here keeps the suite about
 * the transition mechanics rather than about sign-in.
 *
 * @param {object} options Options.
 * @param {string} options.id The user id.
 * @param {string} [options.organizationId] The organisation they belong to.
 * @param {string} [options.role] Their organisation role.
 * @param {string} [options.platformRole] Their platform role.
 * @returns {object} An actor.
 */
function actorFor({ id, organizationId, role = 'OWNER', platformRole = 'USER' }) {
  return {
    id,
    role: platformRole,
    memberships: organizationId ? [{ organizationId, role }] : [],
  }
}

/**
 * A verified organisation with a venue and one publishable event.
 *
 * @param {string} label Distinguishes this fixture from the others in the run.
 * @param {string} status The status the event starts in.
 * @returns {Promise<object>} The organisation, venue, event and an owner actor.
 */
async function freshEvent(label, status) {
  const organization = await prisma.organization.create({
    data: {
      name: `Lifecycle ${label} ${RUN}`,
      slug: `lifecycle-${label}-${RUN}`,
      contactEmail: `${label}-${RUN}@example.test`,
      verificationStatus: 'VERIFIED',
      verified: true,
    },
  })

  const venue = await prisma.venue.create({
    data: {
      name: `Lifecycle Hall ${label} ${RUN}`,
      slug: `lifecycle-hall-${label}-${RUN}`,
      addressLine1: '1 Test Road',
      city: 'Mumbai',
      region: 'Maharashtra',
      postalCode: '400001',
      organizationId: organization.id,
    },
  })

  const user = await prisma.user.create({
    data: {
      email: `${label}-${RUN}@lifecycle.test`,
      passwordHash: 'not-a-real-hash-this-suite-never-signs-in',
      displayName: `${label} owner`,
      role: 'ORGANIZER',
      emailVerified: true,
    },
  })

  const startsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  const endsAt = new Date(startsAt.getTime() + 3 * 60 * 60 * 1000)

  const event = await prisma.event.create({
    data: {
      organizationId: organization.id,
      venueId: venue.id,
      title: `Lifecycle ${label} ${RUN}`,
      slug: `lifecycle-${label}-${RUN}`,
      summary: 'A summary long enough to be plausible.',
      description: 'A description long enough to be plausible prose.',
      category: 'MUSIC_CONCERT',
      status,
      startsAt,
      endsAt,
      timezone: 'Asia/Kolkata',
      policies: { entry: 'Doors at seven.', refund: 'Refundable up to 48 hours before.' },
    },
  })

  await prisma.eventSession.create({
    data: {
      eventId: event.id,
      startsAt,
      endsAt,
      timezone: 'Asia/Kolkata',
      capacity: 100,
    },
  })

  made.events.push(event.id)
  made.venues.push(venue.id)
  made.organizations.push(organization.id)
  made.users.push(user.id)

  return {
    organization,
    venue,
    event,
    owner: actorFor({ id: user.id, organizationId: organization.id }),
    moderator: actorFor({ id: user.id, platformRole: 'SUPER_ADMIN' }),
  }
}

afterAll(async () => {
  if (reachable) {
    for (const id of made.events) {
      await prisma.ticketType.deleteMany({ where: { eventId: id } }).catch(() => {})
      await prisma.eventModerationAction.deleteMany({ where: { eventId: id } }).catch(() => {})
      await prisma.eventSession.deleteMany({ where: { eventId: id } }).catch(() => {})
      await prisma.event.delete({ where: { id } }).catch(() => {})
    }
    for (const id of made.venues) await prisma.venue.delete({ where: { id } }).catch(() => {})
    for (const id of made.users) {
      await prisma.auditLog.deleteMany({ where: { actorId: id } }).catch(() => {})
      await prisma.user.delete({ where: { id } }).catch(() => {})
    }
    for (const id of made.organizations) {
      await prisma.organization.delete({ where: { id } }).catch(() => {})
    }
  }

  await prisma.$disconnect()
})

describe.skipIf(!reachable)('two writers, one winner', () => {
  it('lets exactly one of two concurrent submissions land', async () => {
    const { event, owner } = await freshEvent('submit', 'DRAFT')
    const loaded = await loadForTransition(prisma, event.id)

    const results = await Promise.allSettled([
      transitionEvent(prisma, { event: loaded, to: 'REVIEW_PENDING', actor: owner }),
      transitionEvent(prisma, { event: loaded, to: 'REVIEW_PENDING', actor: owner }),
    ])

    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0].reason.statusCode).toBe(409)

    const after = await prisma.event.findUnique({ where: { id: event.id } })
    expect(after.status).toBe('REVIEW_PENDING')

    // One move, one history row. A losing writer records nothing.
    const history = await prisma.eventModerationAction.findMany({ where: { eventId: event.id } })
    expect(history).toHaveLength(1)
  })

  it('lets exactly one of two concurrent moderation decisions win', async () => {
    const { event, moderator } = await freshEvent('moderate', 'REVIEW_PENDING')
    const loaded = await loadForTransition(prisma, event.id)

    const results = await Promise.allSettled([
      transitionEvent(prisma, {
        event: loaded,
        to: 'APPROVED',
        actor: moderator,
        reason: 'Looks fine.',
      }),
      transitionEvent(prisma, {
        event: loaded,
        to: 'REJECTED',
        actor: moderator,
        reason: 'Does not look fine.',
      }),
    ])

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)

    const after = await prisma.event.findUnique({ where: { id: event.id } })

    // Whichever won, the event holds exactly one of the two decisions — never
    // a blend, and never the second overwriting the first.
    expect(['APPROVED', 'REJECTED']).toContain(after.status)

    const history = await prisma.eventModerationAction.findMany({ where: { eventId: event.id } })
    expect(history).toHaveLength(1)
    expect(history[0].toStatus).toBe(after.status)
  })

  it('lets exactly one of two concurrent publications win', async () => {
    const { event, owner } = await freshEvent('publish', 'APPROVED')
    const loaded = await loadForTransition(prisma, event.id)

    const results = await Promise.allSettled([
      transitionEvent(prisma, { event: loaded, to: 'PUBLISHED', actor: owner }),
      transitionEvent(prisma, { event: loaded, to: 'PUBLISHED', actor: owner }),
    ])

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)

    const after = await prisma.event.findUnique({ where: { id: event.id } })

    expect(after.status).toBe('PUBLISHED')
    expect(after.publishedAt).toBeInstanceOf(Date)

    // Published once, stamped once. A second publication that "succeeded" would
    // move the date an attendee was told.
    const history = await prisma.eventModerationAction.findMany({
      where: { eventId: event.id, toStatus: 'PUBLISHED' },
    })
    expect(history).toHaveLength(1)
  })
})

describe.skipIf(!reachable)('what the database refuses regardless of the service', () => {
  it('refuses a session that ends before it starts', async () => {
    const { event } = await freshEvent('session-window', 'DRAFT')
    const startsAt = new Date(Date.now() + 40 * 24 * 60 * 60 * 1000)

    await expect(
      prisma.eventSession.create({
        data: {
          eventId: event.id,
          startsAt,
          endsAt: new Date(startsAt.getTime() - 60 * 1000),
          timezone: 'Asia/Kolkata',
        },
      }),
    ).rejects.toThrow()
  })
})

describe.skipIf(!reachable)('a failed transition writes nothing', () => {
  it('leaves the row untouched when a gate refuses', async () => {
    // An unverified organisation cannot publish. The refusal happens before the
    // transaction opens, so there is nothing to roll back — which is the point
    // of checking the gates first rather than inside.
    const { event, owner, organization } = await freshEvent('gate', 'APPROVED')

    await prisma.organization.update({
      where: { id: organization.id },
      data: { verificationStatus: 'PENDING', verified: false },
    })

    const before = await prisma.event.findUnique({ where: { id: event.id } })
    const loaded = await loadForTransition(prisma, event.id)

    await expect(
      transitionEvent(prisma, { event: loaded, to: 'PUBLISHED', actor: owner }),
    ).rejects.toMatchObject({ statusCode: 422 })

    const after = await prisma.event.findUnique({ where: { id: event.id } })

    expect(after.status).toBe(before.status)
    expect(after.publishedAt).toEqual(before.publishedAt)
    expect(after.updatedAt).toEqual(before.updatedAt)

    const history = await prisma.eventModerationAction.findMany({ where: { eventId: event.id } })
    expect(history).toHaveLength(0)
  })

  it('refuses a move that is not in the table, and records nothing', async () => {
    const { event, owner } = await freshEvent('illegal', 'DRAFT')
    const loaded = await loadForTransition(prisma, event.id)

    await expect(
      transitionEvent(prisma, { event: loaded, to: 'PUBLISHED', actor: owner }),
    ).rejects.toMatchObject({ statusCode: 409 })

    const after = await prisma.event.findUnique({ where: { id: event.id } })
    expect(after.status).toBe('DRAFT')

    const history = await prisma.eventModerationAction.findMany({ where: { eventId: event.id } })
    expect(history).toHaveLength(0)
  })
})

describe.skipIf(!reachable)('a reserved session cannot rest on a draft map', () => {
  it('is refused by the database, one level earlier than the service gate', async () => {
    // The service gate in `publishabilityProblems` refuses to publish an event
    // whose reserved session names an unpublished map version. Writing this
    // test found the database refusing one step earlier still: a draft version
    // cannot be attached to a session at all.
    //
    // The database being stricter than the test is the right direction to be
    // surprised in, and the refusal is what gets asserted. The service check
    // stays as defence in depth and as a better error message.
    const { event, venue } = await freshEvent('reserved', 'APPROVED')

    const map = await prisma.venueMap.create({
      data: { venueId: venue.id, name: `Reserved layout ${RUN}` },
    })
    const version = await prisma.venueMapVersion.create({
      data: { venueMapId: map.id, version: 1 },
    })

    await expect(
      prisma.eventSession.updateMany({
        where: { eventId: event.id },
        data: { venueMapVersionId: version.id },
      }),
    ).rejects.toThrow(/still editable and cannot back a session/i)

    const sessions = await prisma.eventSession.findMany({ where: { eventId: event.id } })
    for (const session of sessions) expect(session.venueMapVersionId).toBeNull()

    await prisma.venueMapVersion.delete({ where: { id: version.id } }).catch(() => {})
    await prisma.venueMap.delete({ where: { id: map.id } }).catch(() => {})
  })
})

describe.skipIf(!reachable)(
  'a ticket type cannot borrow another event\u2019s session, finding NF-20',
  () => {
    it('is refused by the database', async () => {
      // `TicketType.eventSessionId` referenced `EventSession(id)` and nothing
      // more, so a tier sold for one event could be scoped to a session of
      // another: inventory counting against one event while the order, the ticket
      // and the door list all named the other. NF-04 closed this between an order
      // line and its tier; this is the same mistake one level up.
      const mine = await freshEvent('tt-mine', 'DRAFT')
      const theirs = await freshEvent('tt-theirs', 'DRAFT')
      const otherSession = await prisma.eventSession.findFirst({
        where: { eventId: theirs.event.id },
      })

      await expect(
        prisma.ticketType.create({
          data: {
            eventId: mine.event.id,
            eventSessionId: otherSession.id,
            name: `Cross ${RUN}`,
            priceCents: 1000,
            quantityTotal: 10,
          },
        }),
      ).rejects.toThrow(/belongs to event/i)
    })

    it('still allows a null session, which means every session of the event', async () => {
      const { event } = await freshEvent('tt-null', 'DRAFT')

      const tier = await prisma.ticketType.create({
        data: {
          eventId: event.id,
          name: `General ${RUN}`,
          priceCents: 1000,
          quantityTotal: 10,
        },
      })

      expect(tier.eventSessionId).toBeNull()

      await prisma.ticketType.delete({ where: { id: tier.id } }).catch(() => {})
    })

    it('allows a session that belongs to the same event', async () => {
      const { event } = await freshEvent('tt-same', 'DRAFT')
      const session = await prisma.eventSession.findFirst({ where: { eventId: event.id } })

      const tier = await prisma.ticketType.create({
        data: {
          eventId: event.id,
          eventSessionId: session.id,
          name: `Same session ${RUN}`,
          priceCents: 1000,
          quantityTotal: 10,
        },
      })

      expect(tier.eventSessionId).toBe(session.id)

      await prisma.ticketType.delete({ where: { id: tier.id } }).catch(() => {})
    })
  },
)

describe.skipIf(!reachable)('an event cannot end before it starts, finding NF-21', () => {
  it('is refused by the database, not only by the API', async () => {
    // EventSession has carried this check since the Phase 2 migration; Event
    // never got it, so the parent could hold a window its own children were
    // forbidden.
    const { event } = await freshEvent('window', 'DRAFT')

    await expect(
      prisma.event.update({
        where: { id: event.id },
        data: { endsAt: new Date(event.startsAt.getTime() - 60 * 1000) },
      }),
    ).rejects.toThrow(/event_ends_after_start/i)
  })
})
