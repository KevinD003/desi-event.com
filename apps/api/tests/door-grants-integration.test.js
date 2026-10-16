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
import { untilWaiting } from './helpers/row-locks.js'

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

/**
 * An import record for an event, so it can be moved as an imported one.
 *
 * @param {object} event The event, in the platform-held organisation.
 * @returns {Promise<object>} The `EventImportItem` row.
 */
function importRecordFor(event) {
  return prisma.eventImportItem.create({
    data: {
      id: id('import-item'),
      source: 'SULEKHA',
      // Digits only (`event_import_item_shape`), and unique per source.
      sourceId: `9${String(Math.floor(Math.random() * 1e11)).padStart(11, '0')}`,
      eventId: event.id,
      importedById: world.admin.id,
      scrapedAt: new Date('2026-10-01T00:00:00Z'),
      presentedBy: 'Door Suite Presenters',
    },
  })
}

describeWhen('an imported event moved to an organiser (review of 2026-10-16)', () => {
  it('takes the platform-held scanners’ and waiting invitations’ door scopes on it with it, so they can still be rescoped and reissued', async () => {
    const heldHome = { organization: world.held, venue: await venueOf(world.held.id, 'Moving') }
    const moving = await eventWithTicket(heldHome, world.holder, 'Moving Garba')
    const staying = await eventWithTicket(heldHome, world.holder, 'Staying Garba')
    const target = await organisation('Target')

    await prisma.organization.update({
      where: { id: target.organization.id },
      data: { verified: true, verificationStatus: 'VERIFIED' },
    })
    await importRecordFor(moving.event)

    const member = await user('moving-scanner', 'ATTENDEE')
    const waiting = await user('moving-invitee', 'ATTENDEE')

    made.push(member, waiting)

    const both = [moving.event.id, staying.event.id]
    const issued = await invite(world.admin, world.held.id, {
      email: member.email,
      role: 'SCANNER',
      eventIds: both,
    })

    expect(issued.statusCode, issued.body).toBe(201)
    expect((await accept(member, issued.json().data.delivery.invitationCode)).statusCode).toBe(200)

    const pending = await invite(world.admin, world.held.id, {
      email: waiting.email,
      role: 'SCANNER',
      eventIds: both,
    })

    expect(pending.statusCode, pending.body).toBe(201)

    const current = await prisma.event.findUnique({ where: { id: moving.event.id } })
    const moved = await app.inject({
      method: 'POST',
      url: `/v1/platform/imports/events/${moving.event.id}/reassign`,
      headers: await headersFor(world.admin),
      payload: {
        organizationId: target.organization.id,
        reason: 'The organiser runs this event themselves.',
        revision: current.revision,
      },
    })

    expect(moved.statusCode, moved.body).toBe(200)

    // The platform-held organisation keeps its scanner and its invitation,
    // scoped now only to the event it still holds.
    const membership = await prisma.membership.findUnique({
      where: { userId_organizationId: { userId: member.id, organizationId: world.held.id } },
      include: { scannerScopes: { select: { eventId: true } } },
    })

    expect(membership.scannerScopes).toEqual([{ eventId: staying.event.id }])
    expect(
      await prisma.invitationScope.findMany({
        where: { invitationId: pending.json().data.id },
        select: { eventId: true },
      }),
    ).toEqual([{ eventId: staying.event.id }])

    const [audit] = await prisma.auditLog.findMany({
      where: { action: 'event.import_reassigned', entityId: moving.event.id },
    })

    // One member's scope; two invitations' (the accepted one keeps its rows
    // as a record of what it offered, and the waiting one).
    expect(audit.metadata).toMatchObject({ scannerScopesRemoved: 1, invitationScopesRemoved: 2 })

    // No door scope anywhere names another organisation's event.
    const [crossing] = await prisma.$queryRaw`
      SELECT
        (SELECT count(*)::int FROM "ScannerScope" s
           JOIN "Membership" m ON m."id" = s."membershipId"
           JOIN "Event" e ON e."id" = s."eventId"
          WHERE m."organizationId" <> e."organizationId") AS members,
        (SELECT count(*)::int FROM "InvitationScope" s
           JOIN "Invitation" i ON i."id" = s."invitationId"
           JOIN "Event" e ON e."id" = s."eventId"
          WHERE i."organizationId" <> e."organizationId") AS invitations`

    expect(crossing).toEqual({ members: 0, invitations: 0 })

    // The team page sends the scanner's scopes back on every rescope, and a
    // new code for the invitation carries its events over: both work.
    const rescoped = await app.inject({
      method: 'PATCH',
      url: `/v1/organizations/${world.held.id}/members/${membership.id}`,
      headers: await headersFor(world.admin),
      payload: {
        role: 'SCANNER',
        eventIds: membership.scannerScopes.map((scope) => scope.eventId),
      },
    })

    expect(rescoped.statusCode, rescoped.body).toBe(200)

    const reissued = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${world.held.id}/invitations/${pending.json().data.id}/reissue`,
      headers: await headersFor(world.admin),
    })

    expect(reissued.statusCode, reissued.body).toBe(201)
    expect(reissued.json().data.events.map((event) => event.id)).toEqual([staying.event.id])

    // And the moved event's door is the new organiser's to give: the
    // platform-held scanner admits there no more.
    expect((await admitAs(member, moving.ticket)).status).not.toBe(200)
    expect(await admissions(moving.ticket)).toBe(0)
  })

  it('refuses at the database to move an event a door scope of its old organisation still names', async () => {
    const heldHome = { organization: world.held, venue: await venueOf(world.held.id, 'Guarded') }
    const guarded = await eventWithTicket(heldHome, world.holder, 'Guarded Garba')
    const scanner = await user('guarded-scanner', 'ATTENDEE')

    made.push(scanner)

    const membership = await prisma.membership.create({
      data: { userId: scanner.id, organizationId: world.held.id, role: 'SCANNER' },
    })

    await prisma.scannerScope.create({
      data: { membershipId: membership.id, eventId: guarded.event.id },
    })

    await expect(
      prisma.event.update({
        where: { id: guarded.event.id },
        data: { organizationId: world.home.organization.id },
      }),
    ).rejects.toThrow(/event_move_leaves_no_door_scope/u)
  })
})

describeWhen('a manager’s door invitation once the manager has lost the door (ADR 0019)', () => {
  /**
   * A manager of the home organisation, scoped to the events given.
   *
   * @param {string} label Who.
   * @param {string[]} eventIds Its door scope.
   * @returns {Promise<{manager: object, membership: object}>} The rows.
   */
  async function scopedManager(label, eventIds) {
    const manager = await user(label)
    const membership = await prisma.membership.create({
      data: { userId: manager.id, organizationId: world.home.organization.id, role: 'MANAGER' },
    })

    for (const eventId of eventIds) {
      await prisma.scannerScope.create({ data: { membershipId: membership.id, eventId } })
    }

    made.push(manager)

    return { manager, membership }
  }

  it('opens at acceptance only the events its manager is still scoped to', async () => {
    const { manager, membership } = await scopedManager('narrowed-manager', [
      world.x.event.id,
      world.y.event.id,
    ])
    const invitee = await user('narrowed-invitee', 'ATTENDEE')

    made.push(invitee)

    const issued = await invite(manager, world.home.organization.id, {
      email: invitee.email,
      role: 'SCANNER',
      eventIds: [world.x.event.id, world.y.event.id],
    })

    expect(issued.statusCode, issued.body).toBe(201)

    // The owner takes Y away from the manager before the code is used.
    const narrowed = await app.inject({
      method: 'PATCH',
      url: `/v1/organizations/${world.home.organization.id}/members/${membership.id}`,
      headers: await headersFor(world.owner),
      payload: { role: 'MANAGER', eventIds: [world.x.event.id] },
    })

    expect(narrowed.statusCode, narrowed.body).toBe(200)

    const accepted = await accept(invitee, issued.json().data.delivery.invitationCode)

    expect(accepted.statusCode, accepted.body).toBe(200)
    expect(accepted.json().data).toMatchObject({
      joined: true,
      events: [{ id: world.x.event.id, title: world.x.event.title }],
      withdrawnEventCount: 1,
    })

    const joined = await prisma.membership.findUnique({
      where: {
        userId_organizationId: { userId: invitee.id, organizationId: world.home.organization.id },
      },
      include: { scannerScopes: { select: { eventId: true } } },
    })

    expect(joined.scannerScopes).toEqual([{ eventId: world.x.event.id }])

    const recorded = await prisma.auditLog.findFirst({
      where: { action: 'team.invitation_accepted', entityId: joined.id },
    })

    expect(recorded.metadata).toMatchObject({
      scopedEventIds: [world.x.event.id],
      withdrawnEventIds: [world.y.event.id],
    })
  })

  it('opens no door at acceptance once its manager was removed', async () => {
    const { manager, membership } = await scopedManager('removed-manager', [world.x.event.id])
    const invitee = await user('removed-invitee', 'ATTENDEE')

    made.push(invitee)

    const issued = await invite(manager, world.home.organization.id, {
      email: invitee.email,
      role: 'SCANNER',
      eventIds: [world.x.event.id],
    })

    expect(issued.statusCode, issued.body).toBe(201)

    const removed = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${world.home.organization.id}/members/${membership.id}/remove`,
      headers: await headersFor(world.owner),
      payload: {},
    })

    expect(removed.statusCode, removed.body).toBe(200)

    const accepted = await accept(invitee, issued.json().data.delivery.invitationCode)

    expect(accepted.statusCode, accepted.body).toBe(200)
    expect(accepted.json().data).toMatchObject({ events: [], withdrawnEventCount: 1 })

    const before = await admissions(world.x.ticket)

    expect((await admitAs(invitee, world.x.ticket)).status).not.toBe(200)
    expect(await admissions(world.x.ticket)).toBe(before)
  })

  it('keeps every event an owner named, who may give any door', async () => {
    const invitee = await user('owner-invitee', 'ATTENDEE')

    made.push(invitee)

    const issued = await invite(world.owner, world.home.organization.id, {
      email: invitee.email,
      role: 'STAFF',
      eventIds: [world.x.event.id, world.y.event.id],
    })

    expect(issued.statusCode, issued.body).toBe(201)

    const accepted = await accept(invitee, issued.json().data.delivery.invitationCode)

    expect(accepted.statusCode, accepted.body).toBe(200)
    expect(
      accepted
        .json()
        .data.events.map((event) => event.id)
        .sort(),
    ).toEqual([world.x.event.id, world.y.event.id].sort())
    expect(accepted.json().data.withdrawnEventCount).toBe(0)
  })
})

describeWhen('a direct grant decides from a locked read (ADR 0018)', () => {
  it('refuses a platform administrator once the account is promoted to super administrator while the grant waits', async () => {
    const target = await user('promoted-target', 'ATTENDEE')
    const headers = await headersFor(world.admin)

    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    let held
    const heldPid = new Promise((resolve) => {
      held = resolve
    })

    // A promotion, written and not yet committed, holding the account's row.
    const promotion = prisma.$transaction(
      async (tx) => {
        const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`

        await tx.user.update({ where: { id: target.id }, data: { role: 'SUPER_ADMIN' } })
        held(pid)
        await gate
      },
      { timeout: 20_000, maxWait: 10_000 },
    )
    const pid = await heldPid

    const granting = app.inject({
      method: 'POST',
      url: `/v1/platform/organizations/${world.home.organization.id}/members`,
      headers,
      payload: {
        userId: target.id,
        role: 'VIEWER',
        reason: 'Granting a role while the account is being promoted.',
      },
    })

    try {
      await untilWaiting(prisma, () => [pid], 1, 'the grant')
    } finally {
      release()
      await promotion
    }

    const response = await granting

    expect(response.statusCode, response.body).toBe(403)
    expect(response.json().error.message).toMatch(/Only a super administrator/u)
    expect(
      await prisma.membership.count({
        where: { userId: target.id, organizationId: world.home.organization.id },
      }),
    ).toBe(0)

    // Not left a super administrator for any other suite to count.
    await prisma.user.update({ where: { id: target.id }, data: { role: 'ATTENDEE' } })
  })
})
