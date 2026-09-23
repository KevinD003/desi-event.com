/**
 * Who sees a colleague's address on the team list.
 *
 * The matrix, one role at a time, against the route: managers of the team see
 * addresses in full; everybody else who may read the list sees them masked;
 * a SCANNER cannot read the list; a platform super-administrator sees them in
 * full; a member of another organisation sees nothing. Each masked case also
 * checks that no full address — a member's or an invitee's — appears anywhere
 * in the body, because a schema that stripped the field while a message or
 * another field carried it would pass a narrower assertion.
 *
 * @module @desi-event/api/tests/team-email-visibility
 */

import { describe, expect, it } from 'vitest'

import { makeWorld } from './helpers/fixtures.js'
import { bearer, createTestApp, signIn } from './helpers/app.js'
import { cuid } from './helpers/prisma-stub.js'

const INVITEE = 'new.colleague@rangoli.example'

/**
 * The shared world plus one member of every role, and a pending invitation.
 *
 * @returns {Promise<object>} The harness and every address in the organisation.
 */
async function teamWorld() {
  const { seed, ids } = await makeWorld()
  const hash = seed.user.find((user) => user.email === 'priya@example.com').passwordHash

  for (const [email, role] of [
    ['admin@rangoli.example', 'ADMIN'],
    ['money@rangoli.example', 'FINANCE'],
    ['events@rangoli.example', 'EVENT_MANAGER'],
    ['scanner@rangoli.example', 'SCANNER'],
  ]) {
    const userId = cuid()

    seed.user.push({
      id: userId,
      email,
      passwordHash: hash,
      displayName: email.split('@')[0],
      locale: 'en-IN',
      role: 'ORGANIZER',
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    seed.membership.push({
      id: cuid(),
      userId,
      organizationId: ids.organization.id,
      role,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
  }

  const harness = await createTestApp({ seed, ids })

  // A pending invitation, made the way an owner makes one.
  const invited = await harness.app.inject({
    method: 'POST',
    url: `/v1/organizations/${ids.organization.id}/invitations`,
    headers: bearer(await signIn(harness.app, 'owner@rangoli.example')),
    payload: { email: INVITEE, role: 'STAFF' },
  })

  expect(invited.statusCode).toBe(201)

  const addresses = harness.prisma._store.membership
    .filter((row) => row.organizationId === ids.organization.id)
    .map((row) => harness.prisma._store.user.find((user) => user.id === row.userId).email)

  return { ...harness, addresses: [...addresses, INVITEE] }
}

/**
 * The team list, as one account.
 *
 * @param {object} world From {@link teamWorld}.
 * @param {string} email Who asks.
 * @returns {Promise<object>} The response.
 */
async function listAs(world, email) {
  return world.app.inject({
    method: 'GET',
    url: `/v1/organizations/${world.ids.organization.id}/members`,
    headers: bearer(await signIn(world.app, email)),
  })
}

describe('the team list, by role', () => {
  it.each([
    ['OWNER', 'owner@rangoli.example'],
    ['ADMIN', 'admin@rangoli.example'],
    ['MANAGER', 'arun@rangoli.example'],
  ])('shows %s every address in full: they manage the team', async (_role, email) => {
    const world = await teamWorld()
    const response = await listAs(world, email)
    const { data } = response.json()

    expect(response.statusCode).toBe(200)
    expect(data.emailVisibility).toBe('FULL')
    expect(data.members.every((member) => member.email && !('emailMasked' in member))).toBe(true)
    expect(data.invitations.map((invitation) => invitation.email)).toContain(INVITEE)

    await world.app.close()
  })

  it.each([
    ['VIEWER', 'finance@rangoli.example'],
    ['STAFF', 'door@rangoli.example'],
    ['EVENT_MANAGER', 'events@rangoli.example'],
    ['FINANCE', 'money@rangoli.example'],
  ])('shows %s every address masked, invitees included', async (_role, email) => {
    const world = await teamWorld()
    const response = await listAs(world, email)
    const { data } = response.json()

    expect(response.statusCode).toBe(200)
    expect(data.emailVisibility).toBe('MASKED')

    for (const entry of [...data.members, ...data.invitations]) {
      expect(entry).not.toHaveProperty('email')
      expect(entry.emailMasked).toMatch(/\*/u)
    }

    // Not in any field, not in any message: nowhere in the body.
    for (const address of world.addresses) {
      expect(response.body, address).not.toContain(address)
    }

    // Still a usable list: who is on the team, and in what role.
    expect(data.members.map((member) => member.role)).toContain('OWNER')
    expect(data.invitations).toHaveLength(1)

    await world.app.close()
  })

  it('does not let a SCANNER read the list at all', async () => {
    const world = await teamWorld()
    const response = await listAs(world, 'scanner@rangoli.example')

    expect(response.statusCode).toBe(403)

    for (const address of world.addresses) {
      expect(response.body, address).not.toContain(address)
    }

    await world.app.close()
  })

  it('shows a platform super-administrator every address in full', async () => {
    // Platform operations resolve support cases on any tenant; the capability
    // is unscoped and the second factor is required for the role.
    const world = await teamWorld()
    const response = await listAs(world, 'ops@desi-event.example')

    expect(response.statusCode).toBe(200)
    expect(response.json().data.emailVisibility).toBe('FULL')

    await world.app.close()
  })

  it('shows a member of another organisation nothing', async () => {
    const world = await teamWorld()
    const response = await listAs(world, 'rival@dhol.example')

    expect(response.statusCode).toBe(403)

    for (const address of world.addresses) {
      expect(response.body, address).not.toContain(address)
    }

    await world.app.close()
  })

  it('never puts an address into a door response', async () => {
    // The door routes carry an attendee's name for a steward to check a face
    // against, and nothing about the buyer or the team.
    const world = await teamWorld()

    // A SCANNER admits only where a scope says so, and an unscoped one is
    // given an empty list — a body with nothing in it to search.
    const scanner = world.prisma._store.user.find(
      (user) => user.email === 'scanner@rangoli.example',
    )
    const membership = world.prisma._store.membership.find((row) => row.userId === scanner.id)

    await world.prisma.scannerScope.create({
      data: { membershipId: membership.id, eventId: world.ids.publishedEvent.id },
    })

    const events = await world.app.inject({
      method: 'GET',
      url: '/v1/tickets/admission/events',
      headers: bearer(await signIn(world.app, 'scanner@rangoli.example')),
    })

    expect(events.statusCode).toBe(200)
    expect(events.json().data.map((entry) => entry.event.id)).toEqual([world.ids.publishedEvent.id])
    expect(events.body).not.toMatch(/@/u)

    await world.app.close()
  })
})
