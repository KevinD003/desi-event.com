/**
 * Door access given by invitation, against PostgreSQL (ADR 0018, ADR 0019).
 *
 * `team-door-invitations.test.js` proves the routes' rules against the stub.
 * What is here is what only the real database and the real door can answer:
 *
 *   - an organiser invites any address as a door scanner for one event, the
 *     invitee accepts, and then admits at that event and at no other;
 *   - a manager can give door access only for the events it is scoped to;
 *   - the `InvitationScope` trigger refuses another organisation's event and a
 *     role that does not admit by event, and its rows go with the invitation;
 *   - a platform administrator invites a door scanner for an imported event in
 *     the platform-held organisation, and the scanner admits there;
 *   - the platform-held organisation still refuses every other role, as a
 *     membership, as an invitation, and as a scanner moved to another role;
 *   - a platform administrator (ADMIN) admits on platform authority, recorded
 *     as ADMIN on the event's own record.
 *
 * Runs against `TEST_DATABASE_URL`. With `REQUIRE_DATABASE` set it fails rather
 * than skips.
 *
 * @module @desi-event/api/tests/door-grants-integration
 */

import { createHash } from 'node:crypto'

import { createInMemoryProviderRegistry } from '@desi-event/providers'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { buildApp } from '../src/app.js'
import { loadActor } from '../src/lib/actor.js'
import { confirmAdmission, listAdmissionEvents, previewAdmission } from '../src/lib/admission.js'
import { ensurePlatformHeldOrganization } from '../src/lib/organization-provisioning.js'
import { startSession } from '../src/lib/sessions.js'
import { TICKET_STATES } from '../src/lib/tickets.js'
import { connectTestDatabase } from './helpers/database.js'
import { testEnv } from './helpers/app.js'

const { prisma, reachable, when } = await connectTestDatabase('the door grants suite')

/** Distinguishes this run's rows from every other run's. */
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`

/** The domain every address in this suite shares. */
const DOMAIN = `door-${RUN}.example`

/** Long enough for the key derivations, and obviously not a real one. */
const ENV = Object.freeze({ AUTH_SECRET: 'test-only-fake-value-for-door-grants-0123456789' })

let sequence = 0

/**
 * A CUID-shaped identifier unique to this run.
 *
 * @param {string} kind What it names.
 * @returns {string} The identifier.
 */
function id(kind) {
  sequence += 1

  const digest = createHash('sha256').update(`door-${RUN}-${kind}-${sequence}`).digest('hex')
  const body = BigInt(`0x${digest}`)
    .toString(36)
    .replace(/[^a-z0-9]/g, '')

  return `c${body.padEnd(24, '0').slice(0, 24)}`
}

/**
 * A short token unique to this run, for slugs, codes and addresses.
 *
 * @returns {string} The token.
 */
function unique() {
  sequence += 1

  return `${RUN}${sequence.toString(36)}`
}

/**
 * A user, with a confirmed second factor so a privileged role can work.
 *
 * @param {string} local The address's local part.
 * @param {string} [role] The platform role.
 * @returns {Promise<object>} The user row.
 */
async function user(local, role = 'ORGANIZER') {
  const row = await prisma.user.create({
    data: {
      id: id(`user-${local}`),
      email: `${local}.${unique()}@${DOMAIN}`,
      displayName: local,
      passwordHash: 'not-a-hash-this-suite-never-signs-in-with-a-password',
      role,
      emailVerified: true,
    },
  })

  await prisma.mfaFactor.create({
    data: {
      id: id(`factor-${local}`),
      userId: row.id,
      type: 'TOTP',
      secretSealed: 'placeholder-the-enrolment-gate-counts-rows-and-never-reads-this',
      confirmedAt: new Date(),
    },
  })

  return row
}

/**
 * A real session for a user, and its bearer header.
 *
 * @param {object} who The user.
 * @returns {Promise<object>} The headers.
 */
async function headersFor(who) {
  const fresh = await prisma.user.findUnique({ where: { id: who.id } })
  const memberships = await prisma.membership.findMany({ where: { userId: who.id } })
  const { secret } = await startSession(prisma, {
    actor: { id: fresh.id, role: fresh.role, memberships },
    request: { headers: {}, ip: '127.0.0.1' },
    key: 'door-grants-suite-pseudonymisation-key',
    mfaSatisfied: true,
  })

  return { authorization: `Bearer ${secret}` }
}

/**
 * An organisation with a venue.
 *
 * @param {string} label Its name.
 * @returns {Promise<{organization: object, venue: object}>} The rows.
 */
async function organisation(label) {
  const organization = await prisma.organization.create({
    data: {
      id: id(`org-${label}`),
      name: `${label} ${RUN}`,
      slug: `door-${label.toLowerCase()}-${unique()}`,
      contactEmail: `${label.toLowerCase()}.${unique()}@${DOMAIN}`,
    },
  })

  return { organization, venue: await venueOf(organization.id, label) }
}

/**
 * A venue of an organisation.
 *
 * @param {string} organizationId The organisation.
 * @param {string} label Its name.
 * @returns {Promise<object>} The venue.
 */
function venueOf(organizationId, label) {
  return prisma.venue.create({
    data: {
      id: id(`venue-${label}`),
      organizationId,
      name: `${label} Hall`,
      slug: `door-venue-${unique()}`,
      addressLine1: '1 Door Street',
      city: 'Toronto',
      region: 'ON',
      postalCode: 'M5V 1A1',
      country: 'CA',
      timezone: 'America/Toronto',
    },
  })
}

/**
 * A published event with one paid ticket.
 *
 * @param {{organization: object, venue: object}} home Where.
 * @param {object} holder Who holds the ticket.
 * @param {string} title Its title.
 * @returns {Promise<object>} The rows, `{ event, ticket }`.
 */
async function eventWithTicket(home, holder, title) {
  const startsAt = new Date(Date.now() + 3_600_000)
  const endsAt = new Date(startsAt.getTime() + 3 * 3_600_000)

  const event = await prisma.event.create({
    data: {
      id: id('event'),
      organizationId: home.organization.id,
      venueId: home.venue.id,
      title: `${title} ${unique()}`,
      slug: `door-event-${unique()}`,
      category: 'MUSIC_CONCERT',
      summary: 'Built by the door grants suite.',
      description: 'A queue, some scanners, and the tickets they check.',
      status: 'PUBLISHED',
      startsAt,
      endsAt,
      timezone: 'America/Toronto',
    },
  })
  const session = await prisma.eventSession.create({
    data: { id: id('session'), eventId: event.id, startsAt, endsAt, timezone: 'America/Toronto' },
  })
  const ticketType = await prisma.ticketType.create({
    data: {
      id: id('tier'),
      eventId: event.id,
      name: 'Standing',
      priceCents: 2500,
      currency: 'CAD',
      quantityTotal: 1,
      status: 'ON_SALE',
    },
  })
  const order = await prisma.order.create({
    data: {
      id: id('order'),
      reference: `DE-${unique().toUpperCase()}`,
      eventId: event.id,
      eventSessionId: session.id,
      userId: holder.id,
      buyerEmail: holder.email,
      buyerName: holder.displayName,
      status: 'PAID',
      currency: 'CAD',
      subtotalCents: 2500,
      totalCents: 2500,
      paidAt: new Date(),
    },
  })
  const orderItem = await prisma.orderItem.create({
    data: {
      id: id('line'),
      orderId: order.id,
      ticketTypeId: ticketType.id,
      quantity: 1,
      unitPriceCents: 2500,
      subtotalCents: 2500,
    },
  })
  const ticket = await prisma.ticket.create({
    data: {
      id: id('ticket'),
      orderItemId: orderItem.id,
      code: `DET-${unique().toUpperCase()}`,
      credentialHash: createHash('sha256').update(unique()).digest('hex'),
      credentialVersion: 1,
      credentialIssuedAt: new Date(),
      attendeeName: 'Asha Door',
      ownerUserId: holder.id,
      status: TICKET_STATES.VALID,
    },
  })

  return { event, ticket }
}

/**
 * Preview, then confirm, a printed code at the door, as a user.
 *
 * @param {object} who The user at the door.
 * @param {object} ticket The ticket presented.
 * @returns {Promise<{status: number, data?: object, message?: string}>} How the preview, or the admission, ended.
 */
async function admitAs(who, ticket) {
  const { actor } = await loadActor(prisma, who.id)

  try {
    const looked = await previewAdmission({ prisma, env: ENV, actor, body: { code: ticket.code } })
    const confirmed = await confirmAdmission({
      prisma,
      env: ENV,
      actor: (await loadActor(prisma, who.id)).actor,
      body: { code: ticket.code, previewReference: looked.previewReference },
    })

    return { status: 200, data: confirmed }
  } catch (error) {
    if (typeof error?.statusCode !== 'number') throw error

    return { status: error.statusCode, message: error.message }
  }
}

/**
 * Invite an address as somebody, over HTTP.
 *
 * @param {object} as Who invites.
 * @param {string} organizationId Where.
 * @param {object} payload The body.
 * @returns {Promise<object>} The inject result.
 */
async function invite(as, organizationId, payload) {
  return app.inject({
    method: 'POST',
    url: `/v1/organizations/${organizationId}/invitations`,
    headers: await headersFor(as),
    payload,
  })
}

/**
 * Accept a code as somebody, over HTTP.
 *
 * @param {object} as Who accepts.
 * @param {string} code The code.
 * @returns {Promise<object>} The inject result.
 */
async function accept(as, code) {
  return app.inject({
    method: 'POST',
    url: '/v1/invitations/accept',
    headers: await headersFor(as),
    payload: { token: code },
  })
}

/**
 * How many admissions a ticket has.
 *
 * @param {object} ticket The ticket.
 * @returns {Promise<number>} The `CheckIn` count.
 */
function admissions(ticket) {
  return prisma.checkIn.count({ where: { ticketId: ticket.id } })
}

/**
 * The platform-held organisation, made by this suite when no import has made it.
 *
 * @param {object} actor The administrator it is made for.
 * @returns {Promise<object>} The organisation.
 */
async function platformHeld(actor) {
  const existing = await prisma.organization.findUnique({
    where: { platformHeldSource: 'SULEKHA' },
  })

  if (existing) return existing

  try {
    return (
      await prisma.$transaction((tx) =>
        ensurePlatformHeldOrganization(tx, { source: 'SULEKHA', actor, now: new Date() }),
      )
    ).organization
  } catch {
    // Another suite made it at the same moment: the unique index decided.
    return prisma.organization.findUnique({ where: { platformHeldSource: 'SULEKHA' } })
  }
}

let app
let world

/** Every user this suite made, whose platform-held memberships it removes. */
const made = []

beforeAll(async () => {
  if (!reachable) return

  app = await buildApp({
    prisma,
    providers: createInMemoryProviderRegistry(),
    env: testEnv(),
    docs: false,
    processEnv: {},
    rateLimit: { global: { max: 10_000, timeWindow: '1 minute' }, auth: { max: 1000 } },
  })
  await app.ready()

  const home = await organisation('Home')
  const rival = await organisation('Rival')
  const holder = await user('holder', 'ATTENDEE')
  const owner = await user('owner')
  const manager = await user('manager')
  const admin = await user('platform-admin', 'ADMIN')

  const x = await eventWithTicket(home, holder, 'Garba Night')
  const y = await eventWithTicket(home, holder, 'Diwali Mela')
  const rivalEvent = await eventWithTicket(rival, holder, 'Rival Night')

  await prisma.membership.create({
    data: { userId: owner.id, organizationId: home.organization.id, role: 'OWNER' },
  })

  const managerMembership = await prisma.membership.create({
    data: { userId: manager.id, organizationId: home.organization.id, role: 'MANAGER' },
  })

  await prisma.scannerScope.create({
    data: { membershipId: managerMembership.id, eventId: x.event.id },
  })

  const held = await platformHeld(admin)
  const heldVenue = await venueOf(held.id, 'Imported')
  const imported = await eventWithTicket(
    { organization: held, venue: heldVenue },
    holder,
    'Toronto Garba',
  )

  made.push(holder, owner, manager, admin)

  world = { home, rival, holder, owner, manager, admin, x, y, rivalEvent, held, imported }
})

afterAll(async () => {
  if (reachable && world) {
    // The platform-held organisation is shared by every run against this
    // database: what this suite put in it does not stay there.
    await prisma.membership.deleteMany({
      where: { organizationId: world.held.id, userId: { in: made.map((row) => row.id) } },
    })
    await prisma.invitation.deleteMany({
      where: { organizationId: world.held.id, email: { endsWith: `@${DOMAIN}` } },
    })
  }

  await app?.close()
  await prisma.$disconnect()
})

const describeWhen = when()

describeWhen('an organiser gives anyone door access for one event', () => {
  it('invites an address as a scanner for one event; once accepted it admits there and nowhere else', async () => {
    const invitee = await user('invitee', 'ATTENDEE')

    made.push(invitee)

    const issued = await invite(world.owner, world.home.organization.id, {
      email: invitee.email,
      role: 'SCANNER',
      eventIds: [world.x.event.id],
    })

    expect(issued.statusCode, issued.body).toBe(201)
    expect(issued.json().data.events).toEqual([
      { id: world.x.event.id, title: world.x.event.title },
    ])
    expect(
      await prisma.invitationScope.findMany({
        where: { invitationId: issued.json().data.id },
        select: { eventId: true },
      }),
    ).toEqual([{ eventId: world.x.event.id }])

    // Before accepting, the address admits nobody.
    expect((await admitAs(invitee, world.x.ticket)).status).toBe(403)

    const accepted = await accept(invitee, issued.json().data.delivery.invitationCode)

    expect(accepted.statusCode, accepted.body).toBe(200)
    expect(accepted.json().data).toMatchObject({
      role: 'SCANNER',
      joined: true,
      events: [{ id: world.x.event.id, title: world.x.event.title }],
    })

    const listed = await listAdmissionEvents({
      prisma,
      actor: (await loadActor(prisma, invitee.id)).actor,
    })

    expect(listed.entries.map((entry) => entry.event.id)).toEqual([world.x.event.id])

    const atX = await admitAs(invitee, world.x.ticket)

    expect(atX.status, atX.message).toBe(200)
    expect(atX.data.outcome).toBe('ADMITTED')
    expect(await admissions(world.x.ticket)).toBe(1)

    const recorded = await prisma.auditLog.findFirst({
      where: { action: 'ticket.checked_in', entityId: world.x.ticket.id, actorId: invitee.id },
    })

    expect(recorded.metadata).toMatchObject({ authority: 'EVENT_SCOPE', role: 'SCANNER' })

    // The other event of the same organisation: told nothing, admits nobody.
    const atY = await admitAs(invitee, world.y.ticket)

    expect(atY.status).toBe(404)
    expect(await admissions(world.y.ticket)).toBe(0)

    // No row this flow wrote carries the code.
    const code = issued.json().data.delivery.invitationCode
    const rows = await prisma.$queryRaw`
      SELECT "metadata"::text AS "metadata" FROM "AuditLog"
       WHERE "entityId" IN (${issued.json().data.id}, ${accepted.json().data.organizationId})`

    for (const row of rows) expect(row.metadata ?? '').not.toContain(code)
  })

  it('lets a manager give door access only for the events it is scoped to', async () => {
    const somebody = await user('manager-invitee', 'ATTENDEE')

    made.push(somebody)

    const beyond = await invite(world.manager, world.home.organization.id, {
      email: somebody.email,
      role: 'SCANNER',
      eventIds: [world.y.event.id],
    })

    expect(beyond.statusCode).toBe(403)
    expect(
      await prisma.invitation.count({
        where: { organizationId: world.home.organization.id, email: somebody.email },
      }),
    ).toBe(0)

    const own = await invite(world.manager, world.home.organization.id, {
      email: somebody.email,
      role: 'SCANNER',
      eventIds: [world.x.event.id],
    })

    expect(own.statusCode, own.body).toBe(201)
    expect(own.json().data.events.map((event) => event.id)).toEqual([world.x.event.id])
  })

  it('refuses events of another organisation, and on a role that does not work a door', async () => {
    const somebody = await user('refused-invitee', 'ATTENDEE')

    const foreign = await invite(world.owner, world.home.organization.id, {
      email: somebody.email,
      role: 'SCANNER',
      eventIds: [world.rivalEvent.event.id],
    })

    expect(foreign.statusCode).toBe(422)

    const viewer = await invite(world.owner, world.home.organization.id, {
      email: somebody.email,
      role: 'VIEWER',
      eventIds: [world.x.event.id],
    })

    expect(viewer.statusCode).toBe(422)
    expect(
      await prisma.invitation.count({
        where: { organizationId: world.home.organization.id, email: somebody.email },
      }),
    ).toBe(0)
  })
})

describeWhen('the invitation scope table, in the database', () => {
  /**
   * A waiting invitation, written directly.
   *
   * @param {string} organizationId Where.
   * @param {string} role Its role.
   * @returns {Promise<object>} The row.
   */
  function waiting(organizationId, role) {
    return prisma.invitation.create({
      data: {
        organizationId,
        email: `raw.${unique()}@${DOMAIN}`,
        role,
        tokenHash: createHash('sha256').update(unique()).digest('hex'),
        invitedById: world.owner.id,
        expiresAt: new Date(Date.now() + 86_400_000),
        deliveryMode: 'MANUAL',
      },
    })
  }

  it('refuses another organisation’s event and a role that does not admit by event', async () => {
    const scanner = await waiting(world.home.organization.id, 'SCANNER')

    await expect(
      prisma.invitationScope.create({
        data: { invitationId: scanner.id, eventId: world.rivalEvent.event.id },
      }),
    ).rejects.toThrow(/invitation_scope_same_organization/u)

    const viewer = await waiting(world.home.organization.id, 'VIEWER')

    await expect(
      prisma.invitationScope.create({
        data: { invitationId: viewer.id, eventId: world.x.event.id },
      }),
    ).rejects.toThrow(/invitation_scope_door_role/u)

    // One row per invitation and event.
    await prisma.invitationScope.create({
      data: { invitationId: scanner.id, eventId: world.x.event.id },
    })
    await expect(
      prisma.invitationScope.create({
        data: { invitationId: scanner.id, eventId: world.x.event.id },
      }),
    ).rejects.toThrow(/Unique constraint|InvitationScope_invitationId_eventId_key/u)

    // And the scopes go with the invitation.
    await prisma.invitation.delete({ where: { id: scanner.id } })

    expect(await prisma.invitationScope.count({ where: { invitationId: scanner.id } })).toBe(0)
  })
})

describeWhen('door scanners for imported events', () => {
  it('a platform ADMIN invites a scanner for an imported event; once accepted it admits there', async () => {
    const scanner = await user('imported-scanner', 'ATTENDEE')

    made.push(scanner)

    const issued = await invite(world.admin, world.held.id, {
      email: scanner.email,
      role: 'SCANNER',
      eventIds: [world.imported.event.id],
    })

    expect(issued.statusCode, issued.body).toBe(201)

    const accepted = await accept(scanner, issued.json().data.delivery.invitationCode)

    expect(accepted.statusCode, accepted.body).toBe(200)
    expect(accepted.json().data).toMatchObject({
      organizationId: world.held.id,
      role: 'SCANNER',
      events: [{ id: world.imported.event.id, title: world.imported.event.title }],
    })

    const admitted = await admitAs(scanner, world.imported.ticket)

    expect(admitted.status, admitted.message).toBe(200)
    expect(admitted.data.outcome).toBe('ADMITTED')
    expect(
      (
        await prisma.auditLog.findFirst({
          where: {
            action: 'ticket.checked_in',
            entityId: world.imported.ticket.id,
            actorId: scanner.id,
          },
        })
      ).metadata,
    ).toMatchObject({ authority: 'EVENT_SCOPE', role: 'SCANNER' })

    // A scanner of the platform-held organisation stays a scanner.
    const membership = await prisma.membership.findUnique({
      where: { userId_organizationId: { userId: scanner.id, organizationId: world.held.id } },
    })

    await expect(
      prisma.membership.update({ where: { id: membership.id }, data: { role: 'STAFF' } }),
    ).rejects.toThrow(/platform_held_organization_has_no_members/u)
  })

  it.each(['OWNER', 'ADMIN', 'MANAGER', 'STAFF', 'VIEWER'])(
    'the platform-held organisation still refuses a %s membership and invitation',
    async (role) => {
      const somebody = await user(`held-${role.toLowerCase()}`, 'ATTENDEE')

      made.push(somebody)

      await expect(
        prisma.membership.create({
          data: { userId: somebody.id, organizationId: world.held.id, role },
        }),
      ).rejects.toThrow(/platform_held_organization_has_no_members/u)

      await expect(
        prisma.invitation.create({
          data: {
            organizationId: world.held.id,
            email: somebody.email,
            role,
            tokenHash: createHash('sha256').update(unique()).digest('hex'),
            invitedById: world.admin.id,
            expiresAt: new Date(Date.now() + 86_400_000),
            deliveryMode: 'MANUAL',
          },
        }),
      ).rejects.toThrow(/platform_held_organization_has_no_members/u)
    },
  )

  it('answers a direct grant of OWNER there with 409, as before', async () => {
    const somebody = await user('held-grant', 'ATTENDEE')

    made.push(somebody)

    const response = await app.inject({
      method: 'POST',
      url: `/v1/platform/organizations/${world.held.id}/members`,
      headers: await headersFor(world.admin),
      payload: {
        userId: somebody.id,
        role: 'OWNER',
        reason: 'Trying to put an owner into the platform-held organisation.',
      },
    })

    expect(response.statusCode, response.body).toBe(409)
    expect(response.json().error.code).toBe('PLATFORM_HELD_ORGANIZATION')
  })
})

describeWhen('a platform administrator at the door (ADR 0018)', () => {
  it('admits at any organisation’s event on platform authority, recorded as ADMIN', async () => {
    const holder = world.holder
    const fresh = await eventWithTicket(world.rival, holder, 'Platform Night')

    const admitted = await admitAs(world.admin, fresh.ticket)

    expect(admitted.status, admitted.message).toBe(200)
    expect(admitted.data.outcome).toBe('ADMITTED')

    const checkedIn = await prisma.auditLog.findFirst({
      where: { action: 'ticket.checked_in', entityId: fresh.ticket.id, actorId: world.admin.id },
    })

    expect(checkedIn.metadata).toMatchObject({ authority: 'PLATFORM_ROLE', role: 'ADMIN' })

    const onTheEvent = await prisma.auditLog.findMany({
      where: {
        action: 'ticket.admission_platform_authority',
        entityType: 'Event',
        entityId: fresh.event.id,
      },
    })

    expect(onTheEvent.map((row) => row.metadata.operation).sort()).toEqual(['check_in', 'preview'])
    expect(onTheEvent.every((row) => row.metadata.role === 'ADMIN')).toBe(true)

    const listed = await listAdmissionEvents({
      prisma,
      actor: (await loadActor(prisma, world.admin.id)).actor,
    })

    expect(listed.meta.scope).toBe('PLATFORM')
    expect(listed.entries.every((entry) => entry.role === 'ADMIN')).toBe(true)
  })

  it('a platform ADMIN demoted between preview and confirmation is refused at confirmation', async () => {
    const somebody = await user('demoted-admin', 'ADMIN')
    const fresh = await eventWithTicket(world.rival, world.holder, 'Demotion Night')
    const { actor } = await loadActor(prisma, somebody.id)
    const looked = await previewAdmission({
      prisma,
      env: ENV,
      actor,
      body: { code: fresh.ticket.code },
    })

    await prisma.user.update({ where: { id: somebody.id }, data: { role: 'MODERATOR' } })

    await expect(
      confirmAdmission({
        prisma,
        env: ENV,
        actor,
        body: { code: fresh.ticket.code, previewReference: looked.previewReference },
      }),
    ).rejects.toMatchObject({ statusCode: 403 })
    expect(await admissions(fresh.ticket)).toBe(0)
  })
})
