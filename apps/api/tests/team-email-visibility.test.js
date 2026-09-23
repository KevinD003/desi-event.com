/**
 * Who sees a colleague's address on the team list.
 *
 * The matrix, one role at a time, against the route:
 *
 * - OWNER and ADMIN see addresses in full, but only with a second factor
 *   confirmed inside the `MEMBER_EMAIL_VIEW` window. Outside it they get
 *   `STEP_UP_REQUIRED`, with no address.
 * - MANAGER, EVENT_MANAGER, FINANCE, STAFF and VIEWER get `HIDDEN`: no address
 *   field and no stand-in.
 * - A SCANNER cannot read the list.
 * - A platform super-administrator who is not a member gets `HIDDEN`. This
 *   list is not the explicit, audited path such a person would need.
 * - A member of another organisation sees nothing.
 *
 * Every case without addresses also searches the whole body. That covers every
 * address in the organisation, members' and invitee's alike, and every
 * distinctive local part. It also checks for any `@` at all, because a schema
 * that stripped the field while a name or a message carried the address would
 * pass a narrower assertion. The server's response is what is checked, not a
 * page: nothing here depends on a stylesheet hiding a column.
 *
 * `team-email-integration.test.js` proves the same rule against PostgreSQL,
 * with real sessions.
 *
 * @module @desi-event/api/tests/team-email-visibility
 */

import { describe, expect, it } from 'vitest'

import { makeWorld } from './helpers/fixtures.js'
import { bearer, createTestApp, signIn, stepUp } from './helpers/app.js'
import { cuid } from './helpers/prisma-stub.js'

const INVITEE = 'new.colleague@rangoli.example'

/**
 * Members added to the shared world, with local parts that appear nowhere else
 * in a team response, so a search for them means something.
 */
const ADDED = [
  ['anjali.admin@rangoli.example', 'Anjali', 'ADMIN'],
  ['kiran.money@rangoli.example', 'Kiran', 'FINANCE'],
  ['devika.events@rangoli.example', 'Devika', 'EVENT_MANAGER'],
  ['sunil.scan@rangoli.example', 'Sunil', 'SCANNER'],
  // Somebody who typed their address as their name.
  ['typed.name@rangoli.example', 'typed.name@rangoli.example', 'VIEWER'],
]

/** Local parts that would identify an address if they reached the body. */
const LOCAL_PARTS = [
  'anjali.admin',
  'kiran.money',
  'devika.events',
  'sunil.scan',
  'typed.name',
  'new.colleague',
]

/**
 * The shared world plus one member of every role, and a pending invitation.
 *
 * @returns {Promise<object>} The harness and every address in the organisation.
 */
async function teamWorld() {
  const { seed, ids } = await makeWorld()
  const hash = seed.user.find((user) => user.email === 'priya@example.com').passwordHash

  for (const [email, displayName, role] of ADDED) {
    const userId = cuid()

    seed.user.push({
      id: userId,
      email,
      passwordHash: hash,
      displayName,
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
 * Sign in, optionally with the step-up aged past the window.
 *
 * Signing in with a second factor sets `mfaSatisfiedAt` to that moment, so a
 * freshly signed-in owner is legitimately stepped up. "Without a recent
 * step-up" therefore has to be made, by moving that moment back.
 *
 * @param {object} world From {@link teamWorld}.
 * @param {string} email Who signs in.
 * @param {object} [options] Options.
 * @param {number} [options.stepUpMinutesAgo] How long ago the second factor was confirmed.
 * @returns {Promise<object>} Bearer headers.
 */
async function sessionFor(world, email, { stepUpMinutesAgo = 0 } = {}) {
  const headers = bearer(await signIn(world.app, email))
  const user = world.prisma._store.user.find((row) => row.email === email)

  if (stepUpMinutesAgo > 0) {
    for (const session of world.prisma._store.session) {
      if (session.userId !== user.id || !session.mfaSatisfiedAt) continue

      session.mfaSatisfiedAt = new Date(Date.now() - stepUpMinutesAgo * 60 * 1000)
    }
  }

  return headers
}

/**
 * The team list, as one session.
 *
 * @param {object} world From {@link teamWorld}.
 * @param {object} headers From {@link sessionFor}.
 * @returns {Promise<object>} The response.
 */
function list(world, headers) {
  return world.app.inject({
    method: 'GET',
    url: `/v1/organizations/${world.ids.organization.id}/members`,
    headers,
  })
}

/**
 * Assert that a response body carries no address, and nothing of one.
 *
 * @param {object} world From {@link teamWorld}.
 * @param {object} response The response.
 * @returns {void}
 */
function expectNoAddress(world, response) {
  for (const address of world.addresses) {
    expect(response.body, address).not.toContain(address)
  }

  for (const local of LOCAL_PARTS) {
    expect(response.body, local).not.toContain(local)
  }

  expect(response.body).not.toContain('@')
  expect(response.body).not.toContain('emailMasked')
  expect(response.body).not.toMatch(/"email"/u)
}

describe('the team list, by role', () => {
  it.each([
    ['OWNER', 'owner@rangoli.example'],
    ['ADMIN', 'anjali.admin@rangoli.example'],
  ])(
    'shows %s every address in full, with a second factor confirmed just now',
    async (_role, email) => {
      const world = await teamWorld()
      const response = await list(world, await sessionFor(world, email))
      const { data } = response.json()

      expect(response.statusCode).toBe(200)
      expect(data.emailVisibility).toBe('FULL')
      expect(data.members.every((member) => typeof member.email === 'string')).toBe(true)
      expect(data.members.map((member) => member.email).sort()).toEqual(
        world.addresses.filter((address) => address !== INVITEE).sort(),
      )
      expect(data.invitations.map((invitation) => invitation.email)).toContain(INVITEE)

      await world.app.close()
    },
  )

  it.each([
    ['OWNER', 'owner@rangoli.example'],
    ['ADMIN', 'anjali.admin@rangoli.example'],
  ])(
    'shows %s no address once the step-up is older than ten minutes, and says a step-up would',
    async (_role, email) => {
      const world = await teamWorld()
      const response = await list(world, await sessionFor(world, email, { stepUpMinutesAgo: 11 }))
      const { data } = response.json()

      expect(response.statusCode).toBe(200)
      expect(data.emailVisibility).toBe('STEP_UP_REQUIRED')
      expectNoAddress(world, response)
      // Still the list: who is on the team, and in what role.
      expect(data.members.map((member) => member.role)).toContain('OWNER')
      expect(data.invitations).toHaveLength(1)

      await world.app.close()
    },
  )

  it('shows the owner every address again once they confirm it is them', async () => {
    const world = await teamWorld()
    const headers = await sessionFor(world, 'owner@rangoli.example', { stepUpMinutesAgo: 11 })

    expect((await list(world, headers)).json().data.emailVisibility).toBe('STEP_UP_REQUIRED')

    await stepUp(world.app, 'owner@rangoli.example', headers)

    const response = await list(world, headers)

    expect(response.json().data.emailVisibility).toBe('FULL')
    expect(response.body).toContain(INVITEE)

    await world.app.close()
  })

  it('draws the line at the window, not before it', async () => {
    const world = await teamWorld()
    const nine = await list(
      world,
      await sessionFor(world, 'owner@rangoli.example', { stepUpMinutesAgo: 9 }),
    )

    expect(nine.json().data.emailVisibility).toBe('FULL')

    await world.app.close()
  })

  it('shows a MANAGER no address, even stepped up: inviting is not managing who stays', async () => {
    const world = await teamWorld()
    const response = await list(world, await sessionFor(world, 'arun@rangoli.example'))

    expect(response.statusCode).toBe(200)
    expect(response.json().data.emailVisibility).toBe('HIDDEN')
    expectNoAddress(world, response)

    await world.app.close()
  })

  it.each([
    ['VIEWER', 'finance@rangoli.example'],
    ['STAFF', 'door@rangoli.example'],
    ['EVENT_MANAGER', 'devika.events@rangoli.example'],
    ['FINANCE', 'kiran.money@rangoli.example'],
  ])('shows %s no address at all, invitees included', async (_role, email) => {
    const world = await teamWorld()
    const response = await list(world, await sessionFor(world, email))
    const { data } = response.json()

    expect(response.statusCode).toBe(200)
    expect(data.emailVisibility).toBe('HIDDEN')

    for (const entry of [...data.members, ...data.invitations]) {
      expect(entry).not.toHaveProperty('email')
      expect(entry).not.toHaveProperty('emailMasked')
    }

    expectNoAddress(world, response)

    // Still a usable list: who is on the team, and in what role.
    expect(data.members.map((member) => member.role)).toContain('OWNER')
    expect(data.invitations).toHaveLength(1)

    await world.app.close()
  })

  it('replaces an address somebody typed as their name, on a list without addresses', async () => {
    const world = await teamWorld()
    const hidden = await list(world, await sessionFor(world, 'finance@rangoli.example'))
    const typed = hidden
      .json()
      .data.members.find((member) => member.role === 'VIEWER' && member.displayName !== 'Finance')

    expect(typed.displayName).toBe('Hidden email')
    expectNoAddress(world, hidden)

    // Those who may see addresses see the name as it was typed.
    const full = await list(world, await sessionFor(world, 'owner@rangoli.example'))

    expect(full.json().data.members.map((member) => member.displayName)).toContain(
      'typed.name@rangoli.example',
    )

    await world.app.close()
  })

  it('does not let a SCANNER read the list at all', async () => {
    const world = await teamWorld()
    const response = await list(world, await sessionFor(world, 'sunil.scan@rangoli.example'))

    expect(response.statusCode).toBe(403)
    expectNoAddress(world, response)

    await world.app.close()
  })

  it('shows a platform super-administrator who is not a member no address, stepped up or not', async () => {
    // The capability is unscoped for this role, so `can` answers yes. Full
    // addresses need the capability through a membership of this organisation.
    const world = await teamWorld()
    const response = await list(world, await sessionFor(world, 'ops@desi-event.example'))

    expect(response.statusCode).toBe(200)
    expect(response.json().data.emailVisibility).toBe('HIDDEN')
    expectNoAddress(world, response)

    await world.app.close()
  })

  it('shows a member of another organisation nothing', async () => {
    const world = await teamWorld()
    const response = await list(world, await sessionFor(world, 'rival@dhol.example'))

    expect(response.statusCode).toBe(403)
    expectNoAddress(world, response)

    await world.app.close()
  })

  it('never puts an address into a door response', async () => {
    // The door routes carry an attendee's name for a steward to check a face
    // against, and nothing about the buyer or the team.
    const world = await teamWorld()

    // A SCANNER admits only where a scope says so, and an unscoped one is
    // given an empty list — a body with nothing in it to search.
    const scanner = world.prisma._store.user.find(
      (user) => user.email === 'sunil.scan@rangoli.example',
    )
    const membership = world.prisma._store.membership.find((row) => row.userId === scanner.id)

    await world.prisma.scannerScope.create({
      data: { membershipId: membership.id, eventId: world.ids.publishedEvent.id },
    })

    const events = await world.app.inject({
      method: 'GET',
      url: '/v1/tickets/admission/events',
      headers: bearer(await signIn(world.app, 'sunil.scan@rangoli.example')),
    })

    expect(events.statusCode).toBe(200)
    expect(events.json().data.map((entry) => entry.event.id)).toEqual([world.ids.publishedEvent.id])
    expect(events.body).not.toMatch(/@/u)

    await world.app.close()
  })
})
