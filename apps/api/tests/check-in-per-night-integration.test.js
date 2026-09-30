/**
 * Admission per night, against a real database.
 *
 * A ticket for one night admits once, on that night, and is refused on any
 * other. A ticket good for every night — its tier names no night, on an event
 * of more than one — admits once on each night and stays VALID between them.
 * The door names the night it is admitting to, and without it a lookup on such
 * an event is refused rather than guessed.
 *
 * What only PostgreSQL can answer is here: whether the unique
 * `CheckIn(ticketId, eventSessionId)`, the partial `CheckIn_ticketId_no_night_key`
 * and the rewritten `desi_check_in_ticket_admissible` hold the rules for any
 * writer; whether two stewards scanning one season pass on one night — by the
 * single door, the group door, or straight into the table — produce one
 * admission; and whether a season pass let in on one night can still be handed
 * on (it cannot: `desi_ticket_status_transition` refuses it too).
 *
 * Nothing is deleted afterwards, as in the sibling suites: every row carries a
 * per-run suffix and is a shape the services produce.
 *
 * Runs against `TEST_DATABASE_URL`. With `REQUIRE_DATABASE` set it fails rather
 * than skips.
 *
 * @module @desi-event/api/tests/check-in-per-night-integration
 */

import { createHash } from 'node:crypto'

import { afterAll, expect, it } from 'vitest'

import { loadActor } from '../src/lib/actor.js'
import { confirmAdmission, listAdmissionEvents, previewAdmission } from '../src/lib/admission.js'
import { checkInProgress } from '../src/lib/analytics.js'
import { confirmGroupAdmission, previewGroupAdmission } from '../src/lib/group-admission.js'
import { retrieveGroupPass } from '../src/lib/group-passes.js'
import { SEAT_POLICIES, settleRefund } from '../src/lib/refunds.js'
import {
  TICKET_STATES,
  acceptTransfer,
  mintTransferToken,
  startTransfer,
} from '../src/lib/tickets.js'
import { issueTicketCredential } from '../src/lib/ticket-credentials.js'
import { connectTestDatabase } from './helpers/database.js'

const { prisma, when } = await connectTestDatabase('the admission-per-night suite')

/** A suffix unique to this run. */
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`

/** Long enough for the key derivations, and obviously not a real one. */
const SECRET = 'test-only-fake-value-for-deriving-passes-0123456789'

const ENV = Object.freeze({ AUTH_SECRET: SECRET })

/** What each ticket costs. */
const PRICE_CENTS = 40_000

let sequence = 0

/**
 * A CUID-shaped identifier unique to this run.
 *
 * @param {string} kind What it names.
 * @returns {string} The identifier.
 */
function id(kind) {
  sequence += 1

  const digest = createHash('sha256').update(`nights-${RUN}-${kind}-${sequence}`).digest('hex')

  return `c${BigInt(`0x${digest}`).toString(36).padEnd(24, '0').slice(0, 24)}`
}

/**
 * A short unique token.
 *
 * @returns {string} The token.
 */
function unique() {
  sequence += 1

  return `${RUN}${sequence.toString(36)}`
}

/**
 * A user.
 *
 * @param {string} label What they are for, and their display name.
 * @param {string} [role] Their platform role.
 * @returns {Promise<object>} The user.
 */
function user(label, role = 'ORGANIZER') {
  return prisma.user.create({
    data: {
      id: id(`user-${label}`),
      email: `${label}-${unique()}@nights.example`,
      displayName: label,
      passwordHash: 'not-a-hash-this-suite-never-signs-in',
      role,
      emailVerified: true,
    },
  })
}

/**
 * The actor a request from this user would carry, read now.
 *
 * @param {object} who The user.
 * @returns {Promise<object>} The actor.
 */
async function actorFor(who) {
  return (await loadActor(prisma, who.id)).actor
}

/**
 * An event of three nights, with a season tier (no night of its own) and a
 * Night 1 tier; a paid order of two season passes and one Night 1 ticket, one
 * line each, held by the buyer's account; two scoped stewards; and the
 * order's group pass.
 *
 * @returns {Promise<object>} Everything.
 */
async function world() {
  const tag = unique()
  const organization = await prisma.organization.create({
    data: {
      id: id('org'),
      name: `Nine Nights ${tag}`,
      slug: `nights-home-${tag}`,
      contactEmail: `nights-${tag}@nights.example`,
    },
  })
  const venue = await prisma.venue.create({
    data: {
      id: id('venue'),
      organizationId: organization.id,
      name: 'Garba Ground',
      slug: `nights-venue-${tag}`,
      addressLine1: '1 Dandiya Road',
      city: 'Houston',
      region: 'TX',
      postalCode: '77001',
      country: 'US',
      timezone: 'America/Chicago',
    },
  })
  const firstStart = new Date(Date.now() + 48 * 3_600_000)
  const event = await prisma.event.create({
    data: {
      id: id('event'),
      organizationId: organization.id,
      venueId: venue.id,
      title: `Navratri ${tag}`,
      slug: `nights-event-${tag}`,
      category: 'MUSIC_CONCERT',
      summary: 'Built by the admission-per-night suite.',
      description: 'Three nights, one season pass, and a door that counts them.',
      status: 'PUBLISHED',
      startsAt: firstStart,
      endsAt: new Date(firstStart.getTime() + (2 * 24 + 5) * 3_600_000),
      timezone: 'America/Chicago',
    },
  })

  const nights = []

  for (let index = 0; index < 3; index += 1) {
    const startsAt = new Date(firstStart.getTime() + index * 24 * 3_600_000)

    nights.push(
      await prisma.eventSession.create({
        data: {
          id: id(`night-${index + 1}`),
          eventId: event.id,
          label: `Night ${index + 1}`,
          startsAt,
          endsAt: new Date(startsAt.getTime() + 5 * 3_600_000),
          timezone: 'America/Chicago',
          sortOrder: index,
        },
      }),
    )
  }

  const tier = (name, eventSessionId) =>
    prisma.ticketType.create({
      data: {
        id: id(`tier-${name}`),
        eventId: event.id,
        eventSessionId,
        name: `${name} ${tag}`,
        priceCents: PRICE_CENTS,
        currency: 'USD',
        quantityTotal: 10,
        status: 'ON_SALE',
      },
    })
  const season = await tier('Season', null)
  const nightOne = await tier('Night one', nights[0].id)

  const holder = await user('holder', 'ATTENDEE')
  const recipient = await user('recipient', 'ATTENDEE')
  const totalCents = PRICE_CENTS * 3
  const order = await prisma.order.create({
    data: {
      id: id('order'),
      reference: `DE-N${tag.toUpperCase()}`,
      eventId: event.id,
      userId: holder.id,
      buyerEmail: holder.email,
      buyerName: 'holder',
      status: 'PAID',
      currency: 'USD',
      subtotalCents: totalCents,
      totalCents,
      paidAt: new Date(),
    },
  })
  const payment = await prisma.payment.create({
    data: {
      id: id('payment'),
      orderId: order.id,
      provider: 'in-memory-payments',
      providerRef: `pi_nights_${unique()}`,
      status: 'SUCCEEDED',
      amountCents: totalCents,
      currency: 'USD',
    },
  })

  const lines = []
  const tickets = []

  for (const [index, ticketType] of [season, season, nightOne].entries()) {
    const line = await prisma.orderItem.create({
      data: {
        id: id(`line-${index}`),
        orderId: order.id,
        ticketTypeId: ticketType.id,
        quantity: 1,
        unitPriceCents: PRICE_CENTS,
        subtotalCents: PRICE_CENTS,
      },
    })
    const ticketId = id(`ticket-${index}`)
    const { credential, credentialHash } = issueTicketCredential({
      secret: SECRET,
      ticketId,
      version: 1,
    })
    const ticket = await prisma.ticket.create({
      data: {
        id: ticketId,
        orderItemId: line.id,
        code: `DET-N${unique().toUpperCase()}`,
        credentialHash,
        credentialVersion: 1,
        credentialIssuedAt: new Date(),
        attendeeName: `Guest ${index + 1}`,
        ownerUserId: holder.id,
        status: TICKET_STATES.VALID,
      },
    })

    lines.push(line)
    tickets.push({ ...ticket, credential })
  }

  const steward = await user('steward')
  const secondSteward = await user('second-steward')

  for (const who of [steward, secondSteward]) {
    const membership = await prisma.membership.create({
      data: {
        id: id('membership'),
        userId: who.id,
        organizationId: organization.id,
        role: 'SCANNER',
      },
    })

    await prisma.scannerScope.create({ data: { membershipId: membership.id, eventId: event.id } })
  }

  const pass = await retrieveGroupPass({
    prisma,
    env: ENV,
    actor: await actorFor(holder),
    reference: order.reference,
  })

  return {
    organization,
    event,
    nights,
    season,
    nightOne,
    holder,
    recipient,
    order,
    payment,
    lines,
    // Two season passes, then the Night 1 ticket.
    seasonPasses: tickets.slice(0, 2),
    nightOneTicket: tickets[2],
    tickets,
    steward,
    secondSteward,
    pass,
  }
}

/**
 * Run a door call and describe what came back, error or not.
 *
 * @param {Promise<object>} call A preview or confirmation.
 * @returns {Promise<{status: number, data?: object, reason?: string, message?: string}>} The outcome.
 */
async function outcome(call) {
  try {
    return { status: 200, data: await call }
  } catch (error) {
    if (typeof error?.statusCode !== 'number') throw error

    return { status: error.statusCode, reason: error.details?.reason, message: error.message }
  }
}

/**
 * Look a ticket up as a user.
 *
 * @param {object} who The user.
 * @param {object} body The request body.
 * @returns {Promise<object>} From {@link outcome}.
 */
async function previewAs(who, body) {
  return outcome(previewAdmission({ prisma, env: ENV, actor: await actorFor(who), body }))
}

/**
 * Confirm as a user.
 *
 * @param {object} who The user.
 * @param {object} body The request body.
 * @returns {Promise<object>} From {@link outcome}.
 */
async function confirmAs(who, body) {
  return outcome(confirmAdmission({ prisma, env: ENV, actor: await actorFor(who), body }))
}

/**
 * Look a ticket up on a night, assert it is admissible, and hand back the body
 * a confirmation would send.
 *
 * @param {object} who The user.
 * @param {object} presentation `{ code }` or `{ credential }`.
 * @param {object} night The night.
 * @returns {Promise<object>} The confirmation body.
 */
async function previewed(who, presentation, night) {
  const body = { ...presentation, eventSessionId: night.id }
  const looked = await previewAs(who, body)

  expect(looked.status, looked.message).toBe(200)
  expect(looked.data.outcome, JSON.stringify(looked.data.refusal)).toBe('ADMISSIBLE')

  return { ...body, previewReference: looked.data.previewReference }
}

/**
 * Admit a ticket on a night, through the door.
 *
 * @param {object} who The user.
 * @param {object} ticket The ticket.
 * @param {object} night The night.
 * @returns {Promise<object>} From {@link outcome}.
 */
async function admitOn(who, ticket, night) {
  return confirmAs(who, await previewed(who, { code: ticket.code }, night))
}

/**
 * The admission rows of a ticket, oldest first.
 *
 * @param {{id: string}} ticket The ticket.
 * @returns {Promise<Array<object>>} Its `CheckIn` rows.
 */
function admissionsOf(ticket) {
  return prisma.checkIn.findMany({
    where: { ticketId: ticket.id },
    orderBy: [{ scannedAt: 'asc' }, { id: 'asc' }],
  })
}

/**
 * The ticket's stored status.
 *
 * @param {{id: string}} ticket The ticket.
 * @returns {Promise<string>} Its status.
 */
async function statusOf(ticket) {
  return (await prisma.ticket.findUnique({ where: { id: ticket.id }, select: { status: true } }))
    .status
}

/**
 * Insert an admission row straight into the table, as a writer that skipped
 * the service would, inside its own transaction.
 *
 * @param {{id: string}} ticket The ticket.
 * @param {string|null} night The night, or null.
 * @returns {Promise<object>} The row.
 */
function insertAdmission(ticket, night) {
  return prisma.checkIn.create({
    data: { ticketId: ticket.id, eventSessionId: night, method: 'MANUAL_CODE' },
  })
}

/**
 * What PostgreSQL said when it refused a write.
 *
 * @param {Promise<unknown>} write The write.
 * @returns {Promise<string>} The message, or `'written'` when it was not refused.
 */
async function refusal(write) {
  try {
    await write

    return 'written'
  } catch (error) {
    return String(error?.meta?.driverAdapterError?.cause?.originalMessage ?? error?.message)
  }
}

afterAll(async () => {
  await prisma.$disconnect().catch(() => {})
})

when()('what the migration put in the database', () => {
  it('replaced the unique ticket with the ticket and the night, plus one row with no night', async () => {
    const indexes = await prisma.$queryRaw`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = current_schema() AND tablename = 'CheckIn'`
    const byName = new Map(indexes.map((row) => [row.indexname, row.indexdef]))

    expect(byName.has('CheckIn_ticketId_key')).toBe(false)
    expect(byName.get('CheckIn_ticketId_eventSessionId_key')).toMatch(
      /UNIQUE INDEX .*\("ticketId", "eventSessionId"\)/u,
    )
    expect(byName.get('CheckIn_ticketId_no_night_key')).toMatch(
      /UNIQUE INDEX .*\("ticketId"\) WHERE \("eventSessionId" IS NULL\)/u,
    )
  })
})

when()('the door, night by night', () => {
  it('lists the event with its three nights, soonest first', async () => {
    const w = await world()
    const { entries } = await listAdmissionEvents({ prisma, actor: await actorFor(w.steward) })
    const entry = entries.find((row) => row.event.id === w.event.id)

    expect(entry.sessions.map((night) => night.label)).toEqual(['Night 1', 'Night 2', 'Night 3'])
    expect(entry.sessions.map((night) => night.id)).toEqual(w.nights.map((night) => night.id))
  })

  it('refuses a lookup that names no night, rather than guessing one', async () => {
    const w = await world()
    const looked = await previewAs(w.steward, { code: w.seasonPasses[0].code })

    expect(looked.data).toMatchObject({
      outcome: 'REFUSED',
      refusal: 'NIGHT_REQUIRED',
      previewReference: null,
    })
    expect(await admissionsOf(w.seasonPasses[0])).toHaveLength(0)
  })

  it('admits a season pass once on each night, and it stays VALID', async () => {
    const w = await world()
    const [pass] = w.seasonPasses

    for (const night of w.nights) {
      const admitted = await admitOn(w.steward, pass, night)

      expect(admitted.status, admitted.message).toBe(200)
      expect(admitted.data).toMatchObject({ outcome: 'ADMITTED', checkedInByYou: true })
      expect(await statusOf(pass)).toBe('VALID')

      // The same night again: already in, with tonight's instant.
      const again = await previewAs(w.secondSteward, { code: pass.code, eventSessionId: night.id })

      expect(again.data).toMatchObject({ outcome: 'ALREADY_CHECKED_IN', previewReference: null })
      expect(new Date(again.data.checkedInAt).getTime()).toBe(
        new Date(admitted.data.checkedInAt).getTime(),
      )
    }

    const rows = await admissionsOf(pass)

    expect(rows.map((row) => row.eventSessionId)).toEqual(w.nights.map((night) => night.id))
    expect(
      await prisma.auditLog.count({
        where: { action: 'ticket.checked_in', entityId: pass.id },
      }),
    ).toBe(3)
  })

  it('refuses a Night 1 ticket on Night 2, admits it on Night 1, and then only once', async () => {
    const w = await world()
    const ticket = w.nightOneTicket

    const wrong = await previewAs(w.steward, { code: ticket.code, eventSessionId: w.nights[1].id })

    expect(wrong.data).toMatchObject({
      outcome: 'REFUSED',
      refusal: 'WRONG_NIGHT',
      session: expect.objectContaining({ label: 'Night 1' }),
      previewReference: null,
    })

    const admitted = await admitOn(w.steward, ticket, w.nights[0])

    expect(admitted.data.outcome).toBe('ADMITTED')
    expect(await statusOf(ticket)).toBe('CHECKED_IN')
    expect((await admissionsOf(ticket)).map((row) => row.eventSessionId)).toEqual([w.nights[0].id])

    const again = await previewAs(w.steward, { code: ticket.code, eventSessionId: w.nights[0].id })

    expect(again.data.outcome).toBe('ALREADY_CHECKED_IN')
  })

  it('refuses a confirmation that switches nights after the lookup', async () => {
    const w = await world()
    const [pass] = w.seasonPasses
    const body = await previewed(w.steward, { credential: pass.credential }, w.nights[0])

    const switched = await confirmAs(w.steward, { ...body, eventSessionId: w.nights[1].id })

    expect(switched).toMatchObject({ status: 409, reason: 'PREVIEW_MISMATCH' })
    expect(await admissionsOf(pass)).toHaveLength(0)
  })

  it('admits a group each night by its group pass, naming each ticket’s night', async () => {
    const w = await world()

    for (const night of w.nights.slice(0, 2)) {
      const looked = await outcome(
        previewGroupAdmission({
          prisma,
          env: ENV,
          actor: await actorFor(w.steward),
          body: { credential: w.pass.credential, eventSessionId: night.id },
        }),
      )

      expect(looked.status, looked.message).toBe(200)

      const byId = new Map(looked.data.tickets.map((ticket) => [ticket.ticketId, ticket]))

      for (const pass of w.seasonPasses) {
        expect(byId.get(pass.id)).toMatchObject({ outcome: 'ADMISSIBLE', session: null })
      }

      // The Night 1 ticket is admissible on Night 1 only, and says which it is.
      expect(byId.get(w.nightOneTicket.id)).toMatchObject({
        outcome: night === w.nights[0] ? 'ADMISSIBLE' : 'REFUSED',
        refusal: night === w.nights[0] ? null : 'WRONG_NIGHT',
        session: expect.objectContaining({ label: 'Night 1' }),
      })

      const admitted = await outcome(
        confirmGroupAdmission({
          prisma,
          env: ENV,
          actor: await actorFor(w.steward),
          body: {
            credential: w.pass.credential,
            eventSessionId: night.id,
            previewReference: looked.data.previewReference,
            ticketIds: w.seasonPasses.map((pass) => pass.id),
          },
        }),
      )

      expect(admitted.status, admitted.message).toBe(200)
      expect(admitted.data).toMatchObject({ outcome: 'ADMITTED', admitted: 2 })
      expect(admitted.data.tickets.every((ticket) => ticket.session === null)).toBe(true)

      // And the buyer can still show the group pass for the nights left.
      const shown = await retrieveGroupPass({
        prisma,
        env: ENV,
        actor: await actorFor(w.holder),
        reference: w.order.reference,
      })

      expect(shown.admits).toBe(3)
    }

    for (const pass of w.seasonPasses) {
      expect((await admissionsOf(pass)).map((row) => row.eventSessionId)).toEqual([
        w.nights[0].id,
        w.nights[1].id,
      ])
    }
  })

  it('counts a season pass let in on three nights as one ticket through the door', async () => {
    const w = await world()
    const [pass] = w.seasonPasses

    for (const night of w.nights) {
      expect((await admitOn(w.steward, pass, night)).status).toBe(200)
    }

    const progress = await checkInProgress(prisma, {
      organizationId: w.organization.id,
      eventId: w.event.id,
    })

    expect(progress).toMatchObject({ admitted: 1, live: 3 })
  })
})

when()('stewards racing on one night', () => {
  it('two confirmations of one season pass on one night admit it once; the loser is told it is in', async () => {
    for (let round = 0; round < 5; round += 1) {
      const w = await world()
      const [pass] = w.seasonPasses
      const night = w.nights[1]
      const first = await previewed(w.steward, { code: pass.code }, night)
      const second = await previewed(w.secondSteward, { credential: pass.credential }, night)

      const results = await Promise.all([
        confirmAs(w.steward, first),
        confirmAs(w.secondSteward, second),
      ])

      expect(results.map((result) => result.status)).toEqual([200, 200])
      expect(results.map((result) => result.data.outcome).sort()).toEqual([
        'ADMITTED',
        'ALREADY_CHECKED_IN',
      ])
      expect(await admissionsOf(pass)).toHaveLength(1)
      expect(await statusOf(pass)).toBe('VALID')
    }
  })

  it('two stewards on two different nights both admit a season pass, once each', async () => {
    const w = await world()
    const [pass] = w.seasonPasses
    const first = await previewed(w.steward, { code: pass.code }, w.nights[0])
    const second = await previewed(w.secondSteward, { code: pass.code }, w.nights[2])

    const results = await Promise.all([
      confirmAs(w.steward, first),
      confirmAs(w.secondSteward, second),
    ])

    expect(results.map((result) => result.data?.outcome)).toEqual(['ADMITTED', 'ADMITTED'])
    expect((await admissionsOf(pass)).map((row) => row.eventSessionId).sort()).toEqual(
      [w.nights[0].id, w.nights[2].id].sort(),
    )
  })

  it('a single scan and a group scan of one season pass on one night admit it once', async () => {
    for (let round = 0; round < 5; round += 1) {
      const w = await world()
      const [pass] = w.seasonPasses
      const night = w.nights[0]
      const single = await previewed(w.steward, { code: pass.code }, night)
      const looked = await previewGroupAdmission({
        prisma,
        env: ENV,
        actor: await actorFor(w.secondSteward),
        body: { code: w.pass.groupCode, eventSessionId: night.id },
      })

      const [singly, grouped] = await Promise.all([
        confirmAs(w.steward, single),
        outcome(
          confirmGroupAdmission({
            prisma,
            env: ENV,
            actor: await actorFor(w.secondSteward),
            body: {
              code: w.pass.groupCode,
              eventSessionId: night.id,
              previewReference: looked.previewReference,
              ticketIds: [pass.id],
            },
          }),
        ),
      ])

      expect(singly.status, singly.message).toBe(200)
      expect(grouped.status, grouped.message).toBe(200)
      expect([singly.data.outcome, grouped.data.outcome].sort()).toEqual([
        'ADMITTED',
        'ALREADY_CHECKED_IN',
      ])
      expect(await admissionsOf(pass)).toHaveLength(1)
    }
  })

  it('two writers inserting straight into the table admit a ticket that admits once only once, whatever night they name', async () => {
    for (let round = 0; round < 5; round += 1) {
      const w = await world()
      const ticket = w.nightOneTicket

      // One with its night and one with none: different keys, so only the
      // trigger's lock and its check stand between them.
      const results = await Promise.allSettled([
        insertAdmission(ticket, w.nights[0].id),
        insertAdmission(ticket, null),
      ])

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      expect(await admissionsOf(ticket)).toHaveLength(1)
    }
  })

  it('two writers inserting one season pass on one night straight into the table produce one row', async () => {
    const w = await world()
    const [pass] = w.seasonPasses

    const results = await Promise.allSettled([
      insertAdmission(pass, w.nights[2].id),
      insertAdmission(pass, w.nights[2].id),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(String(results.find((result) => result.status === 'rejected').reason)).toMatch(
      /unique constraint|duplicate key|P2002/iu,
    )
    expect(await admissionsOf(pass)).toHaveLength(1)
  })
})

when()('the trigger, for any writer', () => {
  it('refuses a season pass admitted with no night', async () => {
    const w = await world()

    expect(await refusal(insertAdmission(w.seasonPasses[0], null))).toMatch(
      /good for every night, so its admission names the night/u,
    )
  })

  it('refuses a Night 1 ticket recorded on Night 2, and a night of another event', async () => {
    const w = await world()
    const other = await world()

    expect(await refusal(insertAdmission(w.nightOneTicket, w.nights[1].id))).toMatch(
      /is for another night/u,
    )
    expect(await refusal(insertAdmission(w.seasonPasses[0], other.nights[0].id))).toMatch(
      /is not a night of ticket/u,
    )
    expect(await admissionsOf(w.nightOneTicket)).toHaveLength(0)
  })

  it('refuses a second admission of a ticket that admits once, on any other key', async () => {
    const w = await world()

    await insertAdmission(w.nightOneTicket, w.nights[0].id)

    expect(await refusal(insertAdmission(w.nightOneTicket, null))).toMatch(
      /admits once and was already admitted/u,
    )
  })

  it('still refuses a ticket that does not admit, whatever the night', async () => {
    const w = await world()
    const [pass] = w.seasonPasses

    await prisma.ticket.update({ where: { id: pass.id }, data: { status: 'REVOKED' } })

    expect(await refusal(insertAdmission(pass, w.nights[0].id))).toMatch(/does not admit/u)
  })
})

when()('a season pass after a night', () => {
  it('cannot be offered to somebody else once it has let somebody in', async () => {
    const w = await world()
    const [pass] = w.seasonPasses

    expect((await admitOn(w.steward, pass, w.nights[0])).status).toBe(200)

    const offered = await outcome(
      prisma.$transaction((tx) =>
        startTransfer(tx, {
          ticket: { ...pass, status: 'VALID' },
          toEmail: w.recipient.email,
          fromUserId: w.holder.id,
          tokenHash: mintTransferToken().tokenHash,
          expiresAt: new Date(Date.now() + 3_600_000),
          now: new Date(),
        }),
      ),
    )

    expect(offered).toMatchObject({ status: 409, reason: 'ALREADY_ADMITTED' })
    expect(await statusOf(pass)).toBe('VALID')
    expect(await prisma.ticketTransfer.count({ where: { ticketId: pass.id } })).toBe(0)

    // Nor by a writer that skips the service.
    expect(
      await refusal(
        prisma.ticket.update({ where: { id: pass.id }, data: { status: 'TRANSFER_PENDING' } }),
      ),
    ).toMatch(/has been let in on a night; it cannot be handed on/u)
  })

  it('offered before a night and let in that night, cannot then be accepted', async () => {
    const w = await world()
    const [pass] = w.seasonPasses
    const { tokenHash } = mintTransferToken()

    await prisma.$transaction((tx) =>
      startTransfer(tx, {
        ticket: pass,
        toEmail: w.recipient.email,
        fromUserId: w.holder.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 3_600_000),
        now: new Date(),
      }),
    )

    // The holder can still walk in while the offer stands.
    expect((await admitOn(w.steward, pass, w.nights[0])).data.outcome).toBe('ADMITTED')
    expect(await statusOf(pass)).toBe('TRANSFER_PENDING')

    const transfer = await prisma.ticketTransfer.findUnique({ where: { tokenHash } })
    const pending = await prisma.ticket.findUnique({ where: { id: pass.id } })
    const accepted = await outcome(
      prisma.$transaction((tx) =>
        acceptTransfer(tx, {
          transfer,
          ticket: pending,
          recipient: w.recipient,
          credentialSecret: SECRET,
          generateTicketCode: () => `DET-NX${unique().toUpperCase()}`,
          now: new Date(),
        }),
      ),
    )

    expect(accepted).toMatchObject({ status: 409, reason: 'TICKET_CHANGED' })
    expect(await prisma.ticket.count({ where: { supersedesTicketId: pass.id } })).toBe(0)
    expect((await prisma.ticketTransfer.findUnique({ where: { tokenHash } })).status).toBe(
      'PENDING',
    )
  })

  it('an acceptance racing a night’s admission: exactly one of them happens', async () => {
    for (let round = 0; round < 5; round += 1) {
      const w = await world()
      const [pass] = w.seasonPasses
      const { tokenHash } = mintTransferToken()

      await prisma.$transaction((tx) =>
        startTransfer(tx, {
          ticket: pass,
          toEmail: w.recipient.email,
          fromUserId: w.holder.id,
          tokenHash,
          expiresAt: new Date(Date.now() + 3_600_000),
          now: new Date(),
        }),
      )

      const body = await previewed(w.steward, { code: pass.code }, w.nights[1])
      const transfer = await prisma.ticketTransfer.findUnique({ where: { tokenHash } })
      const pending = await prisma.ticket.findUnique({ where: { id: pass.id } })

      const [door, handover] = await Promise.all([
        confirmAs(w.steward, body),
        outcome(
          prisma.$transaction((tx) =>
            acceptTransfer(tx, {
              transfer,
              ticket: pending,
              recipient: w.recipient,
              credentialSecret: SECRET,
              generateTicketCode: () => `DET-NR${unique().toUpperCase()}`,
              now: new Date(),
            }),
          ),
        ),
      ])

      const admissions = (await admissionsOf(pass)).length
      const successors = await prisma.ticket.count({ where: { supersedesTicketId: pass.id } })

      expect(admissions + successors, JSON.stringify([door, handover])).toBe(1)
      expect([200, 409]).toContain(door.status)
      expect([200, 409]).toContain(handover.status)
    }
  })

  it('refunded after a night, is refused on the nights left', async () => {
    const w = await world()
    const [pass] = w.seasonPasses

    expect((await admitOn(w.steward, pass, w.nights[0])).status).toBe(200)

    await prisma.order.update({
      where: { id: w.order.id },
      data: { refundPendingCents: { increment: PRICE_CENTS } },
    })

    const refund = await prisma.refund.create({
      data: {
        id: id('refund'),
        orderId: w.order.id,
        paymentId: w.payment.id,
        provider: 'in-memory-payments',
        amountCents: PRICE_CENTS,
        currency: 'USD',
        reason: 'CUSTOMER_REQUEST',
        status: 'SUBMITTED',
        idempotencyKey: id('refund-key'),
        submittedAt: new Date(),
        items: {
          create: [{ orderItemId: w.lines[0].id, quantity: 1, amountCents: PRICE_CENTS }],
        },
      },
    })

    await prisma.$transaction(async (tx) =>
      settleRefund(tx, {
        refund,
        order: await tx.order.findUnique({ where: { id: w.order.id } }),
        result: { providerRefundId: `re_${id('provider-refund')}`, rawStatus: 'SUCCEEDED' },
        organizationId: w.organization.id,
        seatPolicy: SEAT_POLICIES.RESELL,
        eventStartsAt: w.event.startsAt,
        actorId: null,
        now: new Date(),
      }),
    )

    expect(await statusOf(pass)).toBe('REFUNDED')

    const looked = await previewAs(w.steward, { code: pass.code, eventSessionId: w.nights[1].id })

    expect(looked.data).toMatchObject({ outcome: 'REFUSED', refusal: 'REFUNDED' })
    expect(await admissionsOf(pass)).toHaveLength(1)
  })
})
