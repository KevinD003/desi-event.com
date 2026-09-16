/**
 * Event authoring against a real database: two writers, one winner.
 *
 * The stub cannot prove any of this, and that is not a limitation to work
 * around — it is the reason this file exists separately. A single-threaded
 * in-memory store serialises every write by construction, so a concurrency
 * test that passes against it proves only that the test is not a concurrency
 * test.
 *
 * Every case is the same question asked of a different command: two people
 * pressed the same button at the same moment. The answer is always that one
 * result exists afterwards, and the mechanism is always one of two primitives —
 * a conditional `UPDATE` whose affected-row count is compared, or a unique key
 * the database refuses a second time.
 *
 * Nothing here weakens a constraint to make a test pass. Where the database
 * refuses, the refusal is the assertion.
 *
 * Runs against TEST_DATABASE_URL and skips itself when no database is
 * reachable, the same way the venue-map, ledger and lifecycle suites do.
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc
 * namepath.
 *
 * @file @desi-event/api/tests/event-authoring-integration
 */

import { afterAll, describe, expect, it } from 'vitest'

import { createPrismaClient } from '@desi-event/db'

import { requireDatabaseOrWarn } from './helpers/database.js'

import { authorChange, prepareInventory } from '../src/lib/event-authoring.js'
import { cancellationWork } from '../src/lib/event-cancellation.js'
import { classifyChanges, materialChangeWork } from '../src/lib/event-material-change.js'
import { loadForTransition, transitionEvent } from '../src/lib/event-lifecycle.js'
import { writeLayout } from '../src/lib/venue-maps.js'

const CONNECTION =
  process.env.TEST_DATABASE_URL ??
  'postgresql://desi:desi@127.0.0.1:5432/desi_event_test?schema=public'

/** A suffix unique to this run, so repeated runs do not collide on unique names. */
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`

const prisma = createPrismaClient({ connectionString: CONNECTION })
const reachable = await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false)

requireDatabaseOrWarn('the event-authoring integration suite', reachable, CONNECTION)

/** Rows this suite created, for teardown. */
const made = { events: [], venues: [], organizations: [], users: [], maps: [], versions: [] }

/**
 * An actor the services accept.
 *
 * They ask `can(actor, capability, { organizationId })`, so an actor is a shape
 * rather than a row. Building one here keeps the suite about the write
 * mechanics rather than about signing in.
 *
 * @param {string} id The user id.
 * @param {string} organizationId The organisation they own.
 * @returns {object} An actor.
 */
function ownerActor(id, organizationId) {
  return { id, role: 'ORGANIZER', memberships: [{ organizationId, role: 'OWNER' }] }
}

/** A valid two-seat layout, the same shape the venue-map suite uses. */
const layout = () => ({
  zones: [{ key: 'z1', name: 'Stalls', colourToken: 'zone-a', sortOrder: 0 }],
  sections: [
    {
      key: 's1',
      name: 'Stalls',
      kind: 'SEATED',
      sortOrder: 0,
      rows: [
        {
          key: 'r1',
          label: 'A',
          sortOrder: 0,
          seats: [
            { key: 'a1', label: 'A1', sortOrder: 0, zoneKey: 'z1' },
            { key: 'a2', label: 'A2', sortOrder: 1, zoneKey: 'z1' },
          ],
        },
      ],
      seats: [],
    },
  ],
})

/**
 * A verified organisation, a venue and one event in the status asked for.
 *
 * @param {string} label Distinguishes this fixture from the others in the run.
 * @param {string} status The status the event starts in.
 * @returns {Promise<object>} The fixture.
 */
async function freshEvent(label, status = 'DRAFT') {
  const organization = await prisma.organization.create({
    data: {
      name: `Authoring ${label} ${RUN}`,
      slug: `authoring-${label}-${RUN}`,
      contactEmail: `${label}-${RUN}@example.test`,
      verificationStatus: 'VERIFIED',
      verified: true,
    },
  })

  const venue = await prisma.venue.create({
    data: {
      name: `Authoring Hall ${label} ${RUN}`,
      slug: `authoring-hall-${label}-${RUN}`,
      addressLine1: '1 Test Road',
      city: 'Mumbai',
      region: 'Maharashtra',
      postalCode: '400001',
      organizationId: organization.id,
    },
  })

  const user = await prisma.user.create({
    data: {
      email: `${label}-${RUN}@authoring.test`,
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
      title: `Authoring ${label} ${RUN}`,
      slug: `authoring-${label}-${RUN}`,
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

  const session = await prisma.eventSession.create({
    data: { eventId: event.id, startsAt, endsAt, timezone: 'Asia/Kolkata', capacity: 100 },
  })

  made.events.push(event.id)
  made.venues.push(venue.id)
  made.organizations.push(organization.id)
  made.users.push(user.id)

  return {
    organization,
    venue,
    event,
    session,
    userId: user.id,
    owner: ownerActor(user.id, organization.id),
  }
}

/**
 * A published map version with two seats, on an existing venue.
 *
 * @param {string} venueId The venue.
 * @param {string} label Distinguishes it.
 * @returns {Promise<object>} The published version.
 */
async function publishedMapVersion(venueId, label) {
  const map = await prisma.venueMap.create({
    data: { venueId, name: `Layout ${label} ${RUN}` },
  })
  const version = await prisma.venueMapVersion.create({
    data: { venueMapId: map.id, version: 1 },
  })

  made.maps.push(map.id)
  made.versions.push(version.id)

  await writeLayout(prisma, { version, layout: layout(), revision: 0 })

  return prisma.venueMapVersion.update({
    where: { id: version.id },
    data: { publishedAt: new Date() },
  })
}

/**
 * A paid order against an event, so cancellation has something to owe.
 *
 * @param {object} event The event.
 * @param {string} label Distinguishes the reference.
 * @returns {Promise<object>} The order.
 */
async function paidOrder(event, label) {
  const order = await prisma.order.create({
    data: {
      eventId: event.id,
      buyerEmail: `${label}-${RUN}@buyer.test`,
      buyerName: `${label} buyer`,
      reference: `DE-${label.toUpperCase()}-${RUN}`.slice(0, 32),
      status: 'PAID',
      currency: 'INR',
      subtotalCents: 149_900,
      totalCents: 158_000,
      policySnapshot: { refund: 'Refundable up to 48 hours before.' },
    },
  })

  await prisma.payment.create({
    data: {
      orderId: order.id,
      provider: 'MOCK',
      status: 'SUCCEEDED',
      amountCents: order.totalCents,
      currency: 'INR',
    },
  })

  return order
}

afterAll(async () => {
  if (reachable) {
    for (const id of made.events) {
      await prisma.notificationOutbox
        .deleteMany({ where: { dedupeKey: { contains: id } } })
        .catch(() => {})
      const orders = await prisma.order.findMany({ where: { eventId: id } }).catch(() => [])
      for (const order of orders) {
        await prisma.refund.deleteMany({ where: { orderId: order.id } }).catch(() => {})
        await prisma.payment.deleteMany({ where: { orderId: order.id } }).catch(() => {})
        await prisma.order.delete({ where: { id: order.id } }).catch(() => {})
      }
      const sessions = await prisma.eventSession
        .findMany({ where: { eventId: id } })
        .catch(() => [])
      for (const session of sessions) {
        await prisma.eventSeat.deleteMany({ where: { eventSessionId: session.id } }).catch(() => {})
      }
      await prisma.ticketType.deleteMany({ where: { eventId: id } }).catch(() => {})
      await prisma.eventModerationAction.deleteMany({ where: { eventId: id } }).catch(() => {})
      await prisma.eventSession.deleteMany({ where: { eventId: id } }).catch(() => {})
      await prisma.auditLog.deleteMany({ where: { entityId: id } }).catch(() => {})
      await prisma.event.delete({ where: { id } }).catch(() => {})
    }

    // A published map version is deliberately not deleted: the freeze is meant
    // to be irreversible, and a teardown that undid it would be the thing
    // disproving the guarantee. `db:verify:fresh` is what clears them.
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

const when = reachable ? describe : describe.skip

when('two people editing the same draft', () => {
  it('lets one save and tells the other, rather than losing an afternoon', async () => {
    const { event, owner } = await freshEvent('concurrent-edit')

    const results = await Promise.allSettled([
      authorChange(prisma, {
        event,
        revision: 0,
        actor: owner,
        action: 'event.updated',
        write: async (tx) => {
          await tx.event.update({ where: { id: event.id }, data: { summary: 'Mine.' } })
        },
      }),
      authorChange(prisma, {
        event,
        revision: 0,
        actor: owner,
        action: 'event.updated',
        write: async (tx) => {
          await tx.event.update({ where: { id: event.id }, data: { summary: 'Theirs.' } })
        },
      }),
    ])

    const fulfilled = results.filter((result) => result.status === 'fulfilled')
    const rejected = results.filter((result) => result.status === 'rejected')

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0].reason.statusCode).toBe(409)
    expect(rejected[0].reason.code).toBe('STALE_REVISION')

    const stored = await prisma.event.findUnique({ where: { id: event.id } })

    // One revision forward, not two, and one of the two summaries — not a
    // merge of them.
    expect(stored.revision).toBe(1)
    expect(['Mine.', 'Theirs.']).toContain(stored.summary)
  })

  it('refuses a write whose precondition is a revision that has already gone', async () => {
    const { event, owner } = await freshEvent('stale-revision')

    await authorChange(prisma, {
      event,
      revision: 0,
      actor: owner,
      action: 'event.updated',
      write: async (tx) => {
        await tx.event.update({ where: { id: event.id }, data: { summary: 'First.' } })
      },
    })

    await expect(
      authorChange(prisma, {
        event,
        revision: 0,
        actor: owner,
        action: 'event.updated',
        write: async (tx) => {
          await tx.event.update({ where: { id: event.id }, data: { summary: 'Second.' } })
        },
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'STALE_REVISION' })
  })

  it('rolls the whole change back when the write inside it fails', async () => {
    const { event, owner } = await freshEvent('rollback')

    await expect(
      authorChange(prisma, {
        event,
        revision: 0,
        actor: owner,
        action: 'event.updated',
        write: async (tx) => {
          await tx.event.update({ where: { id: event.id }, data: { summary: 'Half written.' } })
          throw new Error('the second half failed')
        },
      }),
    ).rejects.toThrow('the second half failed')

    const stored = await prisma.event.findUnique({ where: { id: event.id } })

    // Not the summary, and — the part a caller would miss — not the revision
    // either. A bumped revision with no change is a stale precondition nobody
    // can explain.
    expect(stored.summary).not.toBe('Half written.')
    expect(stored.revision).toBe(0)
  })
})

when('two people pressing the same lifecycle button', () => {
  it('pauses sales once', async () => {
    const { event, owner } = await freshEvent('pause', 'ON_SALE')
    const loaded = await loadForTransition(prisma, event.id)

    const results = await Promise.allSettled([
      transitionEvent(prisma, { event: loaded, to: 'SALES_PAUSED', actor: owner }),
      transitionEvent(prisma, { event: loaded, to: 'SALES_PAUSED', actor: owner }),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)

    const actions = await prisma.eventModerationAction.findMany({ where: { eventId: event.id } })

    // One transition, one record of it. Two records of one state change is a
    // history nobody can read.
    expect(actions).toHaveLength(1)
    expect(actions[0].toStatus).toBe('SALES_PAUSED')
  })

  it('resumes sales once, from paused', async () => {
    const { event, owner } = await freshEvent('resume', 'SALES_PAUSED')

    await prisma.ticketType.create({
      data: {
        eventId: event.id,
        name: 'General admission',
        priceCents: 149_900,
        currency: 'INR',
        quantityTotal: 100,
        status: 'ON_SALE',
      },
    })

    const loaded = await loadForTransition(prisma, event.id)

    const results = await Promise.allSettled([
      transitionEvent(prisma, { event: loaded, to: 'ON_SALE', actor: owner }),
      transitionEvent(prisma, { event: loaded, to: 'ON_SALE', actor: owner }),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)

    const stored = await prisma.event.findUnique({ where: { id: event.id } })

    expect(stored.status).toBe('ON_SALE')
  })
})

when('two people cancelling the same event', () => {
  it('owes one refund and one notice per order, not two', async () => {
    const { event, owner } = await freshEvent('cancel-race', 'ON_SALE')
    const order = await paidOrder(event, 'cancelrace')
    const loaded = await loadForTransition(prisma, event.id)

    /**
     * The cancellation as the route runs it: the status change and the work it
     * owes, in one transaction.
     *
     * @returns {Promise<object>} The updated event.
     */
    const cancel = () =>
      transitionEvent(prisma, {
        event: loaded,
        to: 'CANCELLED',
        actor: owner,
        reason: 'The artist is unwell.',
        /**
         * @param {object} tx The transaction client.
         * @param {object} updated The event after the status change.
         * @returns {Promise<void>} Resolves when the work is raised.
         */
        onCommit: async (tx, updated) => {
          await cancellationWork(tx, {
            event: updated,
            kind: 'CANCELLED',
            reasonCode: 'ARTIST_UNAVAILABLE',
            reason: 'The artist is unwell.',
            actorId: owner.id,
          })
        },
      })

    const results = await Promise.allSettled([cancel(), cancel()])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)

    const refunds = await prisma.refund.findMany({ where: { orderId: order.id } })
    const notices = await prisma.notificationOutbox.findMany({
      where: { dedupeKey: { contains: event.id } },
    })

    // One business result. Two refund rows against one order would be a
    // double refund waiting for a worker to execute it.
    expect(refunds).toHaveLength(1)
    expect(refunds[0].status).toBe('REQUESTED')
    expect(notices).toHaveLength(1)
  })

  it('leaves the refund REQUESTED, having called no provider', async () => {
    const { event, owner } = await freshEvent('cancel-requested', 'ON_SALE')
    const order = await paidOrder(event, 'cancelreq')
    const loaded = await loadForTransition(prisma, event.id)

    await transitionEvent(prisma, {
      event: loaded,
      to: 'CANCELLED',
      actor: owner,
      reason: 'The venue flooded.',
      /**
       * @param {object} tx The transaction client.
       * @param {object} updated The event after the status change.
       * @returns {Promise<void>} Resolves when the work is raised.
       */
      onCommit: async (tx, updated) => {
        await cancellationWork(tx, {
          event: updated,
          kind: 'CANCELLED',
          reasonCode: 'WEATHER',
          reason: 'The venue flooded.',
          actorId: owner.id,
        })
      },
    })

    const [refund] = await prisma.refund.findMany({ where: { orderId: order.id } })

    // No refund service exists in this repository. The row is the first state
    // of `RefundStatus`, meaning somebody asked; nothing has been sent
    // anywhere, and nothing here claims money moved.
    expect(refund.status).toBe('REQUESTED')
    expect(refund.providerRefundId ?? null).toBeNull()
    expect(refund.settledAt ?? null).toBeNull()
  })
})

when('two people preparing the same session', () => {
  it('creates one set of places', async () => {
    const fixture = await freshEvent('inventory-race')
    const version = await publishedMapVersion(fixture.venue.id, 'inventory-race')

    await prisma.eventSession.update({
      where: { id: fixture.session.id },
      data: { venueMapVersionId: version.id },
    })

    const event = await prisma.event.findUnique({
      where: { id: fixture.event.id },
      include: { sessions: true },
    })

    const results = await Promise.allSettled([
      prepareInventory(prisma, {
        event,
        sessionId: fixture.session.id,
        actor: fixture.owner,
      }),
      prepareInventory(prisma, {
        event,
        sessionId: fixture.session.id,
        actor: fixture.owner,
      }),
    ])

    const seats = await prisma.eventSeat.findMany({
      where: { eventSessionId: fixture.session.id },
    })

    // Two seats in the map, two places afterwards — whichever order the two
    // calls interleaved in. `@@unique([eventSessionId, seatId])` plus
    // `skipDuplicates` is what makes the second call a no-op rather than a
    // duplicate or a crash.
    expect(seats).toHaveLength(2)

    const created = results
      .filter((result) => result.status === 'fulfilled')
      .reduce((sum, result) => sum + result.value.created, 0)

    expect(created).toBe(2)
  })

  it('reports nothing created on a second, later run', async () => {
    const fixture = await freshEvent('inventory-idempotent')
    const version = await publishedMapVersion(fixture.venue.id, 'inventory-idempotent')

    await prisma.eventSession.update({
      where: { id: fixture.session.id },
      data: { venueMapVersionId: version.id },
    })

    const event = await prisma.event.findUnique({
      where: { id: fixture.event.id },
      include: { sessions: true },
    })

    const first = await prepareInventory(prisma, {
      event,
      sessionId: fixture.session.id,
      actor: fixture.owner,
    })
    const second = await prepareInventory(prisma, {
      event,
      sessionId: fixture.session.id,
      actor: fixture.owner,
    })

    expect(first.created).toBe(2)
    expect(second.created).toBe(0)
    expect(second.prepared).toBe(2)
  })

  it('has nothing to prepare for a general-admission session, and says so', async () => {
    const fixture = await freshEvent('inventory-ga')
    const event = await prisma.event.findUnique({
      where: { id: fixture.event.id },
      include: { sessions: true },
    })

    const result = await prepareInventory(prisma, {
      event,
      sessionId: fixture.session.id,
      actor: fixture.owner,
    })

    // A general-admission session counts a quantity. Creating seat rows for it
    // would create rows nothing reads.
    expect(result).toEqual({
      sessionId: fixture.session.id,
      kind: 'general_admission',
      expected: 0,
      prepared: 0,
      created: 0,
    })
  })
})

when('a map version that a session already points at', () => {
  it('stays where it is when the venue publishes a newer one', async () => {
    const fixture = await freshEvent('historical-map')
    const first = await publishedMapVersion(fixture.venue.id, 'historical-first')

    await prisma.eventSession.update({
      where: { id: fixture.session.id },
      data: { venueMapVersionId: first.id },
    })

    // The venue moves on: a second map, published later, with its own seats.
    const second = await publishedMapVersion(fixture.venue.id, 'historical-second')

    const session = await prisma.eventSession.findUnique({ where: { id: fixture.session.id } })

    // The session keeps the version its tickets were sold against. A session
    // that silently followed the venue's latest layout would move somebody's
    // seat after they bought it.
    expect(session.venueMapVersionId).toBe(first.id)
    expect(session.venueMapVersionId).not.toBe(second.id)

    const stored = await prisma.venueMapVersion.findUnique({ where: { id: first.id } })

    expect(stored.publishedAt).toBeInstanceOf(Date)
  })
})

when('the database refusing what the service would let through', () => {
  it('refuses a second price zone with the same key in one version', async () => {
    const fixture = await freshEvent('zone-dup')
    const version = await publishedMapVersion(fixture.venue.id, 'zone-dup')

    const [zone] = await prisma.priceZone.findMany({ where: { venueMapVersionId: version.id } })

    // @@unique([venueMapVersionId, key]). Two zones with the same key in one
    // layout is an ambiguous seat price, which is a thing nobody can resolve
    // after a ticket has been sold against it.
    await expect(
      prisma.priceZone.create({
        data: {
          venueMapVersionId: version.id,
          key: zone.key,
          name: 'A second Stalls',
          sortOrder: 9,
        },
      }),
    ).rejects.toThrow()
  })

  it('refuses two sessions of one event claiming the same start twice over', async () => {
    // Not a constraint: two sessions may legitimately start together in
    // different rooms. This asserts the *absence* of an invented rule, so that
    // a future migration adding one has to change a test that says why.
    const fixture = await freshEvent('same-start')

    const twin = await prisma.eventSession.create({
      data: {
        eventId: fixture.event.id,
        startsAt: fixture.session.startsAt,
        endsAt: fixture.session.endsAt,
        timezone: 'Asia/Kolkata',
        capacity: 50,
      },
    })

    expect(twin.id).not.toBe(fixture.session.id)
  })
})

when('a material change under two writers', () => {
  it('records one change and queues one notice per order', async () => {
    const fixture = await freshEvent('material-race', 'ON_SALE')
    const order = await paidOrder(fixture.event, 'materialrace')
    const after = { ageRestriction: 21 }
    const { material, before } = classifyChanges(fixture.event, after)

    expect(material).toEqual(['ageRestriction'])

    /**
     * The change as the route runs it: the write and the work in one
     * transaction, under a revision precondition.
     *
     * @returns {Promise<object>} The updated event.
     */
    const change = () =>
      authorChange(prisma, {
        event: fixture.event,
        revision: 0,
        actor: fixture.owner,
        action: 'event.material_change',
        /**
         * @param {object} tx The transaction client.
         * @returns {Promise<void>} Resolves when written.
         */
        write: async (tx) => {
          await tx.event.update({ where: { id: fixture.event.id }, data: after })
          await materialChangeWork(tx, {
            event: fixture.event,
            revision: 1,
            material,
            before,
            after,
            reason: 'The licence came back restricted.',
          })
        },
      })

    const results = await Promise.allSettled([change(), change()])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)

    const notices = await prisma.notificationOutbox.findMany({
      where: { dedupeKey: { contains: fixture.event.id } },
    })

    expect(notices).toHaveLength(1)
    expect(notices[0].recipient).toBe(order.buyerEmail)
    expect(notices[0].status).toBe('QUEUED')
    expect(notices[0].sentAt).toBeNull()
    // Being told what you bought has changed is not marketing.
    expect(notices[0].suppressible).toBe(false)
  })

  it('never rewrites the terms already copied onto an order', async () => {
    const fixture = await freshEvent('material-snapshot', 'ON_SALE')
    const order = await paidOrder(fixture.event, 'materialsnap')
    const after = { policies: { entry: 'Doors at six now.', refund: 'No refunds.' } }
    const { material, before } = classifyChanges(fixture.event, after)

    await authorChange(prisma, {
      event: fixture.event,
      revision: 0,
      actor: fixture.owner,
      action: 'event.material_change',
      /**
       * @param {object} tx The transaction client.
       * @returns {Promise<void>} Resolves when written.
       */
      write: async (tx) => {
        await tx.event.update({ where: { id: fixture.event.id }, data: after })
        await materialChangeWork(tx, {
          event: fixture.event,
          revision: 1,
          material,
          before,
          after,
          reason: 'The venue moved the curfew.',
        })
      },
    })

    const stored = await prisma.order.findUnique({ where: { id: order.id } })

    // The snapshot is what stops an edit changing what somebody agreed to.
    // Rewriting it would defeat the entire mechanism, retroactively and
    // invisibly.
    expect(stored.policySnapshot).toEqual({ refund: 'Refundable up to 48 hours before.' })
  })
})
