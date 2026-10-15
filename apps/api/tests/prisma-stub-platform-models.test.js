/**
 * The Prisma stub's models for organiser invitations, the event website switch
 * and visit counting, and the fixtures built on them.
 *
 * The stub is what most API tests run against. A unique index it forgets, or a
 * `groupBy` it answers wrongly, lets a broken route pass its tests, so each rule
 * the database holds for these models is held here too, and checked here.
 *
 * @module @desi-event/api/tests/prisma-stub-platform-models
 */

import { hashToken } from '@desi-event/auth'
import { describe, expect, it } from 'vitest'

import { enrolPrivilegedUsers, makeWorld, organizerInvitationFixture } from './helpers/fixtures.js'
import { createPrismaStub } from './helpers/prisma-stub.js'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/**
 * A stub over the default world.
 *
 * @returns {Promise<{prisma: object, ids: object}>} The stub and the world's ids.
 */
async function world() {
  const { seed, ids } = await makeWorld()

  return { prisma: createPrismaStub(seed), ids }
}

describe('organiser invitations in the stub', () => {
  it('fills the defaults and keeps one waiting invitation per address, whatever its case', async () => {
    const { prisma, ids } = await world()
    const first = organizerInvitationFixture({ invitedById: ids.platformAdministrator.id })
    const { status: _status, note: _note, organizationId: _organization, ...given } = first.row
    const created = await prisma.organizerInvitation.create({ data: given })

    expect(created.status).toBe('PENDING')
    expect(created.note).toBeNull()
    expect(created.organizationId).toBeNull()

    const second = organizerInvitationFixture({
      invitedById: ids.platformAdministrator.id,
      email: 'New-Organiser@Example.com',
    })

    // The fixture lower-cases, as the route does; the index compares lower-cased.
    await expect(
      prisma.organizerInvitation.create({
        data: { ...second.row, email: 'New-Organiser@Example.com' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' })

    await prisma.organizerInvitation.update({
      where: { id: created.id },
      data: { status: 'REVOKED', revokedAt: new Date() },
    })
    await expect(prisma.organizerInvitation.create({ data: second.row })).resolves.toMatchObject({
      status: 'PENDING',
    })
  })

  it('names one invitation by its digest, and lets one invitation replace one other', async () => {
    const { prisma, ids } = await world()
    const original = organizerInvitationFixture({
      invitedById: ids.platformAdministrator.id,
      status: 'REVOKED',
      revokedAt: new Date(),
    })

    await prisma.organizerInvitation.create({ data: original.row })

    await expect(
      prisma.organizerInvitation.create({
        data: {
          ...organizerInvitationFixture({
            invitedById: ids.platformAdministrator.id,
            email: 'someone-else@example.com',
          }).row,
          tokenHash: original.row.tokenHash,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' })

    const reissued = organizerInvitationFixture({
      invitedById: ids.platformAdministrator.id,
      supersedesId: original.row.id,
    })
    await prisma.organizerInvitation.create({ data: reissued.row })

    await expect(
      prisma.organizerInvitation.create({
        data: {
          ...organizerInvitationFixture({
            invitedById: ids.platformAdministrator.id,
            email: 'third@example.com',
          }).row,
          supersedesId: original.row.id,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' })

    const loaded = await prisma.organizerInvitation.findUnique({
      where: { id: reissued.row.id },
      include: { supersedes: true, invitedBy: true },
    })
    expect(loaded.supersedes.id).toBe(original.row.id)
    expect(loaded.invitedBy.email).toBe('anil@desi-event.example')
  })

  it('keeps one membership per organiser invitation, and follows the relation both ways', async () => {
    const { prisma, ids } = await world()
    const invitation = organizerInvitationFixture({ invitedById: ids.platformAdministrator.id })
    await prisma.organizerInvitation.create({ data: invitation.row })

    const membership = await prisma.membership.create({
      data: {
        userId: ids.attendee.id,
        organizationId: ids.grandfatheredOrganization.id,
        role: 'OWNER',
        organizerInvitationId: invitation.row.id,
      },
    })

    await expect(
      prisma.membership.create({
        data: {
          userId: ids.outsider.id,
          organizationId: ids.grandfatheredOrganization.id,
          role: 'OWNER',
          organizerInvitationId: invitation.row.id,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' })

    // Two memberships with no organiser invitation are not a collision.
    await expect(
      prisma.membership.create({
        data: { userId: ids.outsider.id, organizationId: ids.grandfatheredOrganization.id },
      }),
    ).resolves.toMatchObject({ organizerInvitationId: null })

    const back = await prisma.organizerInvitation.findUnique({
      where: { id: invitation.row.id },
      include: { membership: true },
    })
    expect(back.membership.id).toBe(membership.id)
  })
})

describe('the event website switch in the stub', () => {
  it('starts every event with no address and the link off', async () => {
    const { prisma, ids } = await world()
    const event = await prisma.event.create({
      data: {
        organizationId: ids.organization.id,
        title: 'Website probe',
        slug: 'website-probe',
        summary: 's',
        description: 'd',
        category: 'COMEDY',
        startsAt: new Date(),
        endsAt: new Date(),
      },
    })

    expect(event).toMatchObject({
      websiteUrl: null,
      websiteRedirectEnabled: false,
      websiteDecidedUrl: null,
      websiteDecisionPending: false,
      websiteSubmittedAt: null,
      websiteRedirectChangedAt: null,
      websiteRedirectChangedById: null,
      websiteRedirectReason: null,
    })
  })

  it('follows the deciding administrator for the name an insider is shown', async () => {
    const { prisma, ids } = await world()

    await prisma.event.update({
      where: { id: ids.publishedEvent.id },
      data: {
        websiteUrl: 'https://rangoli.example/',
        websiteDecidedUrl: 'https://rangoli.example/',
        websiteRedirectEnabled: true,
        websiteRedirectChangedAt: new Date(),
        websiteRedirectChangedById: ids.platformAdministrator.id,
      },
    })

    const event = await prisma.event.findUnique({
      where: { id: ids.publishedEvent.id },
      include: { websiteRedirectChangedBy: { select: { displayName: true } } },
    })
    expect(event.websiteRedirectChangedBy.displayName).toBe('Anil Administrator')
  })
})

describe('visits in the stub', () => {
  const DAY = new Date('2026-09-30T00:00:00.000Z')

  it('gives a counted moment a random UUID, never a cuid that carries its time', async () => {
    const { prisma, ids } = await world()
    const row = await prisma.trafficEvent.create({
      data: {
        eventId: ids.publishedEvent.id,
        kind: 'PAGE_VIEW',
        placement: 'EVENT_PAGE',
        source: 'DIRECT',
        day: DAY,
      },
    })

    expect(row.id).toMatch(UUID_V4)
    expect(row).toMatchObject({ visitorHash: null, dedupeKey: null })
  })

  it('counts a visitor once per slot, and two visits without a code twice', async () => {
    const { prisma, ids } = await world()
    const view = {
      eventId: ids.publishedEvent.id,
      kind: 'PAGE_VIEW',
      placement: 'EVENT_PAGE',
      source: 'DIRECT',
      day: DAY,
    }

    await prisma.trafficEvent.create({
      data: { ...view, visitorHash: 'a'.repeat(32), dedupeKey: 'b'.repeat(64) },
    })
    await expect(
      prisma.trafficEvent.create({
        data: { ...view, visitorHash: 'a'.repeat(32), dedupeKey: 'b'.repeat(64) },
      }),
    ).rejects.toMatchObject({ code: 'P2002' })

    await prisma.trafficEvent.create({ data: view })
    await prisma.trafficEvent.create({ data: view })
    expect(await prisma.trafficEvent.count()).toBe(3)
  })

  it('keeps one row of totals per event per day, comparing days by instant', async () => {
    const { prisma, ids } = await world()
    const key = { eventId: ids.publishedEvent.id, day: new Date(DAY) }

    const created = await prisma.trafficDaily.create({ data: { ...key, computedAt: new Date() } })
    expect(created).not.toHaveProperty('id')
    expect(created).toMatchObject({ views: 0, cardClicksSearch: 0, demonstration: false })

    await expect(
      prisma.trafficDaily.create({ data: { ...key, day: new Date(DAY), computedAt: new Date() } }),
    ).rejects.toMatchObject({ code: 'P2002' })

    const upserted = await prisma.trafficDaily.upsert({
      where: { eventId_day: { eventId: key.eventId, day: new Date(DAY) } },
      update: { views: 4, viewsDirect: 4 },
      create: { ...key, computedAt: new Date() },
    })
    expect(upserted.views).toBe(4)
    expect(await prisma.trafficDaily.count()).toBe(1)
  })

  it('keeps one salt per day, and the state row by its own id', async () => {
    const { prisma } = await world()

    await prisma.trafficSalt.create({ data: { day: new Date(DAY), salt: 'c'.repeat(64) } })
    await expect(
      prisma.trafficSalt.create({ data: { day: new Date(DAY), salt: 'd'.repeat(64) } }),
    ).rejects.toMatchObject({ code: 'P2002' })

    const state = await prisma.trafficRollupState.create({ data: { id: 'traffic-rollup' } })
    expect(state).toEqual({
      id: 'traffic-rollup',
      leaseOwner: null,
      leaseExpiresAt: null,
      lastCompletedAt: null,
    })
  })

  it('sums by group, orders by a sum or a grouped column, and pages', async () => {
    const { prisma, ids } = await world()
    const rows = [
      [ids.publishedEvent.id, '2026-09-28', 5],
      [ids.publishedEvent.id, '2026-09-29', 7],
      [ids.onlineEvent.id, '2026-09-29', 20],
      [ids.draftEvent.id, '2026-09-29', 1],
    ]

    for (const [eventId, day, views] of rows) {
      await prisma.trafficDaily.create({
        data: {
          eventId,
          day: new Date(`${day}T00:00:00Z`),
          views,
          viewsDirect: views,
          computedAt: new Date(),
        },
      })
    }

    const byEvent = await prisma.trafficDaily.groupBy({
      by: ['eventId'],
      _sum: { views: true, cardClicks: true },
      orderBy: { _sum: { views: 'desc' } },
    })
    expect(
      byEvent.map((group) => [group.eventId, group._sum.views, group._sum.cardClicks]),
    ).toEqual([
      [ids.onlineEvent.id, 20, 0],
      [ids.publishedEvent.id, 12, 0],
      [ids.draftEvent.id, 1, 0],
    ])
    expect(byEvent[0]).not.toHaveProperty('_count')

    const paged = await prisma.trafficDaily.groupBy({
      by: ['eventId'],
      _sum: { views: true },
      orderBy: { _sum: { views: 'desc' } },
      skip: 1,
      take: 1,
    })
    expect(paged.map((group) => group.eventId)).toEqual([ids.publishedEvent.id])

    const byDay = await prisma.trafficDaily.groupBy({
      by: ['day'],
      where: { day: { gte: new Date('2026-09-29T00:00:00Z') } },
      _sum: { views: true },
      _count: true,
      orderBy: { day: 'asc' },
    })
    expect(byDay).toHaveLength(1)
    expect(byDay[0]._sum.views).toBe(28)
    expect(byDay[0]._count._all).toBe(3)

    await expect(
      prisma.trafficDaily.groupBy({ by: ['eventId'], _sum: { views: true }, having: {} }),
    ).rejects.toThrow(/does not implement having/)
  })

  it('reports a null sum for a group whose values are all null, as Prisma does', async () => {
    const { prisma, ids } = await world()

    await prisma.trafficEvent.create({
      data: {
        eventId: ids.publishedEvent.id,
        kind: 'PAGE_VIEW',
        placement: 'EVENT_PAGE',
        source: 'DIRECT',
        day: DAY,
      },
    })

    const [group] = await prisma.trafficEvent.groupBy({
      by: ['eventId'],
      _sum: { visitorHash: true },
    })
    expect(group._sum.visitorHash).toBeNull()
  })

  it('records a raw statement apart from a raw query, and changes nothing', async () => {
    const { prisma } = await world()

    expect(await prisma.$executeRaw`DELETE FROM "TrafficSalt" WHERE "day" < ${DAY}`).toBe(0)
    expect(prisma._rawStatements).toEqual([
      { sql: 'DELETE FROM "TrafficSalt" WHERE "day" < ?', values: [DAY] },
    ])
    expect(prisma._rawQueries).toEqual([])
  })
})

describe('the platform administrator and the grandfathered organisation in the world', () => {
  it('seeds anil@ as ADMIN with no membership, and the harness enrols a second factor', async () => {
    const { seed, ids } = await makeWorld()

    expect(ids.platformAdministrator).toMatchObject({
      email: 'anil@desi-event.example',
      displayName: 'Anil Administrator',
      role: 'ADMIN',
    })
    expect(seed.membership.some((row) => row.userId === ids.platformAdministrator.id)).toBe(false)

    const { enrolled } = enrolPrivilegedUsers(seed)
    expect(enrolled.has('anil@desi-event.example')).toBe(true)
    expect(
      seed.mfaFactor.filter(
        (factor) => factor.userId === ids.platformAdministrator.id && factor.confirmedAt,
      ),
    ).toHaveLength(1)
  })

  it('keeps an UNVERIFIED organisation made before invitations, with nobody in it', async () => {
    const { seed, ids } = await makeWorld()

    expect(ids.grandfatheredOrganization).toMatchObject({
      verified: false,
      verificationStatus: 'UNVERIFIED',
    })
    expect(
      seed.membership.some((row) => row.organizationId === ids.grandfatheredOrganization.id),
    ).toBe(false)
  })

  it('hands back a code made at run time, and stores only its digest', () => {
    const first = organizerInvitationFixture({ invitedById: 'cadmin00000000000000000000' })
    const second = organizerInvitationFixture({ invitedById: 'cadmin00000000000000000000' })

    expect(first.code).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(first.row.tokenHash).toBe(hashToken(first.code))
    expect(first.row.tokenHash).toMatch(/^[0-9a-f]{64}$/)
    expect(JSON.stringify(first.row)).not.toContain(first.code)
    expect(second.code).not.toBe(first.code)
    expect(first.row.expiresAt.getTime()).toBeGreaterThan(first.row.createdAt.getTime())
  })
})
