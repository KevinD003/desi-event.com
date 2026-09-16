/**
 * What the scenarios contend over.
 *
 * Built once per run and tagged with that run's suffix, so two runs against one
 * database do not fight each other and neither has to clean up after itself.
 *
 * ## Why the scarce tier is genuinely scarce
 *
 * The contention scenarios exist to provoke the failure they are named after. A
 * tier with a thousand tickets would never contend, so the run would measure
 * throughput and prove nothing about correctness. The scarce tier has a handful
 * — fewer than the worker count — which is what makes "no overselling" a claim
 * rather than a formality.
 *
 * @module scripts/load/world
 */

import { createHash, randomBytes } from 'node:crypto'

import { hashPasswordSync, seal, totp } from '@desi-event/auth'

import { issueTicketCredential } from '../../apps/api/src/lib/ticket-credentials.js'

/** How many tickets the contended tier has. Fewer than any profile's workers. */
const SCARCE_TOTAL = 6

/** How many seats the seated session lays out. */
const SEAT_COUNT = 8

/** How many tickets the check-in scenario has to scan. */
const DOOR_TICKETS = 12

/**
 * The alphabet a TOTP secret is written in.
 *
 * RFC 4648 base32, which is what every authenticator app expects and what this
 * application's own sealing and verification assume.
 */
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

/**
 * A working second factor for this run, generated rather than stored.
 *
 * A privileged account cannot sign in without a code — finding NF-12 — so a
 * harness that skipped enrolment gets a 401 for every authenticated scenario,
 * which is exactly what the first version of this file did for a whole run
 * before anybody noticed the 100% error rate was its own fault rather than the
 * product's.
 *
 * Generated per run rather than written down: a working credential checked into
 * a repository is a working credential whoever clones it also has, however
 * clearly its name says "test". Nothing here survives the process.
 *
 * @returns {string} A 32-character base32 secret.
 */
function freshTotpSecret() {
  return Array.from(randomBytes(32), (byte) => BASE32[byte % BASE32.length]).join('')
}

/** This run's second factor. Lives in memory, and nowhere else. */
const LOAD_MFA_SECRET = freshTotpSecret()

let sequence = 0

/**
 * A CUID-shaped identifier derived from this run's tag.
 *
 * Shaped rather than readable for the reason the concurrency suites record: the
 * API's own id schema refuses anything that is not cuid-shaped, so a row seeded
 * with a readable id is a row it cannot serialise.
 *
 * @param {string} tag This run's suffix.
 * @param {string} kind What it names.
 * @returns {string} A 25-character identifier.
 */
function id(tag, kind) {
  sequence += 1

  const digest = createHash('sha256').update(`load-${tag}-${kind}-${sequence}`).digest('hex')
  const body = BigInt(`0x${digest}`)
    .toString(36)
    .replace(/[^a-z0-9]/gu, '')

  return `c${body.padEnd(24, '0').slice(0, 24)}`
}

/**
 * Sign an account in and return headers that speak for it.
 *
 * Through the real endpoint rather than by minting a token: a load run that
 * forged its own credentials would be exercising a path nobody uses.
 *
 * @param {object} app The Fastify instance.
 * @param {string} email Which account.
 * @param {string} password Its password.
 * @returns {Promise<object|null>} Bearer headers, or null when sign-in failed.
 */
async function signIn(app, email, password, enrolled) {
  const payload = { email, password, ...(enrolled ? { code: totp(LOAD_MFA_SECRET) } : {}) }
  const response = await app.inject({ method: 'POST', url: '/v1/auth/login', payload })
  const body = response.json?.()

  if (response.statusCode !== 200 || !body?.token) {
    // Loud rather than silent. A harness whose caller is anonymous measures the
    // 401 path at full speed and reports it as the product being broken.
    throw new Error(
      `The load suite could not sign ${email} in: ${response.statusCode} ${response.body}`,
    )
  }

  return { authorization: `Bearer ${body.token}` }
}

/**
 * Give an account a confirmed second factor.
 *
 * Sealed the way the API seals one, so the code this harness computes is a code
 * the API will accept. Nothing here bypasses verification — it enrols, and then
 * signs in through the ordinary endpoint with a real code.
 *
 * @param {object} prisma A Prisma client.
 * @param {string} tag This run's suffix.
 * @param {object} user The account.
 * @param {string} authSecret The deployment's `AUTH_SECRET`.
 * @returns {Promise<void>} Resolves once the factor exists.
 */
async function enrol(prisma, tag, user, authSecret) {
  await prisma.mfaFactor.create({
    data: {
      id: id(tag, `factor-${user.id}`),
      userId: user.id,
      type: 'TOTP',
      label: 'Load suite authenticator',
      secretSealed: seal(LOAD_MFA_SECRET, { secret: authSecret, purpose: 'mfa-totp' }),
      confirmedAt: new Date(),
    },
  })
}

/**
 * Build everything the scenarios need.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} app The Fastify instance, for signing the fixture accounts in.
 * @param {string} tag This run's suffix.
 * @returns {Promise<object>} The world.
 */
export async function buildWorld(prisma, app, tag) {
  const startsAt = new Date(Date.now() + 30 * 86_400_000)
  const endsAt = new Date(startsAt.getTime() + 4 * 3_600_000)

  const organization = await prisma.organization.create({
    data: {
      id: id(tag, 'org'),
      name: `Load Collective ${tag}`,
      slug: `load-${tag}-org`,
      contactEmail: `load-${tag}@desi-event.example`,
      verified: true,
      verificationStatus: 'VERIFIED',
    },
  })

  const venue = await prisma.venue.create({
    data: {
      id: id(tag, 'venue'),
      organizationId: organization.id,
      name: `Load Hall ${tag}`,
      slug: `load-${tag}-venue`,
      addressLine1: '1 Test Road',
      city: 'Chennai',
      region: 'TN',
      postalCode: '600001',
      country: 'IN',
      timezone: 'Asia/Kolkata',
    },
  })

  const event = await prisma.event.create({
    data: {
      id: id(tag, 'event'),
      organizationId: organization.id,
      venueId: venue.id,
      title: `Load Night ${tag}`,
      slug: `load-${tag}-event`,
      category: 'MUSIC_CONCERT',
      summary: 'A garba night with more buyers than tickets, on purpose.',
      description: 'Built by the load suite. Every row here carries this run’s tag.',
      status: 'PUBLISHED',
      startsAt,
      endsAt,
      timezone: 'Asia/Kolkata',
      publishedAt: new Date(),
    },
  })

  const scarce = await prisma.ticketType.create({
    data: {
      id: id(tag, 'scarce'),
      eventId: event.id,
      name: 'Front row',
      priceCents: 250_000,
      currency: 'INR',
      // Fewer than any profile's workers, so contention is real rather than
      // theoretical and "no overselling" is a claim rather than a formality.
      quantityTotal: SCARCE_TOTAL,
      status: 'ON_SALE',
    },
  })

  const roomy = await prisma.ticketType.create({
    data: {
      id: id(tag, 'roomy'),
      eventId: event.id,
      name: 'Standing',
      priceCents: 100_000,
      currency: 'INR',
      quantityTotal: 100_000,
      status: 'ON_SALE',
    },
  })

  const session = await prisma.eventSession.create({
    data: {
      id: id(tag, 'session'),
      eventId: event.id,
      startsAt,
      endsAt,
      timezone: 'Asia/Kolkata',
    },
  })

  const authSecret = process.env.AUTH_SECRET ?? process.env.JWT_SECRET

  const seated = await buildSeatedSession(prisma, { tag, organization, venue, startsAt, endsAt })
  const door = await buildDoorTickets(prisma, { tag, event, session, roomy, authSecret })
  const refundable = await buildRefundableOrder(prisma, { tag, event, session, roomy })

  // Signed in through the real endpoints, with the real second factor. Nothing
  // here mints a token: a harness that forged its own credentials would be
  // exercising a path nobody uses, and would not notice if sign-in broke.
  const doorHeaders = await signIn(app, door.scannerEmail, door.password, door.scannerEnrolled)
  const operatorHeaders = await signIn(app, door.operatorEmail, door.password, true)

  return {
    tag,
    organizationId: organization.id,
    eventId: event.id,
    eventSlug: event.slug,
    scarceTicketTypeId: scarce.id,
    roomyTicketTypeId: roomy.id,
    sessionId: session.id,
    seatedEventId: seated.eventId,
    seatedSessionId: seated.sessionId,
    seatIds: seated.seatIds,
    ticketCodes: door.codes,
    doorHeaders,
    operatorHeaders,
    financeHeaders: operatorHeaders,
    refundableReference: refundable.reference,
    webhookEventId: `evt_load_${tag}`,
    intentId: refundable.intentId,
  }
}

/**
 * A second event with a laid-out seat map.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} params Inputs.
 * @param {string} params.tag This run's suffix.
 * @param {object} params.organization The organisation.
 * @param {object} params.venue Its venue.
 * @param {Date} params.startsAt When.
 * @param {Date} params.endsAt Until.
 * @returns {Promise<{eventId: string, sessionId: string, seatIds: string[]}>} The seated world.
 */
async function buildSeatedSession(prisma, { tag, organization, venue, startsAt, endsAt }) {
  const event = await prisma.event.create({
    data: {
      id: id(tag, 'seated-event'),
      organizationId: organization.id,
      venueId: venue.id,
      title: `Load Seated ${tag}`,
      slug: `load-${tag}-seated`,
      category: 'CLASSICAL_DANCE',
      summary: 'A seated hall where everybody reaches for the same three chairs.',
      description: 'Built by the load suite.',
      status: 'PUBLISHED',
      startsAt,
      endsAt,
      timezone: 'Asia/Kolkata',
      publishedAt: new Date(),
    },
  })

  const ticketType = await prisma.ticketType.create({
    data: {
      id: id(tag, 'seated-tier'),
      eventId: event.id,
      name: 'Stalls',
      priceCents: 180_000,
      currency: 'INR',
      quantityTotal: SEAT_COUNT,
      status: 'ON_SALE',
    },
  })

  const map = await prisma.venueMap.create({
    data: { id: id(tag, 'map'), venueId: venue.id, name: `Load plan ${tag}` },
  })

  const version = await prisma.venueMapVersion.create({
    data: { id: id(tag, 'version'), venueMapId: map.id, version: 1, seatCount: SEAT_COUNT },
  })

  const section = await prisma.section.create({
    data: { id: id(tag, 'section'), venueMapVersionId: version.id, name: 'Stalls', kind: 'SEATED' },
  })

  const row = await prisma.seatRow.create({
    data: { id: id(tag, 'row'), venueMapVersionId: version.id, sectionId: section.id, label: 'A' },
  })

  const seats = []

  for (let index = 0; index < SEAT_COUNT; index += 1) {
    seats.push(
      await prisma.seat.create({
        data: {
          id: id(tag, `seat-${index}`),
          venueMapVersionId: version.id,
          sectionId: section.id,
          rowId: row.id,
          label: `A${index + 1}`,
          sortOrder: index + 1,
        },
      }),
    )
  }

  // Laid out first, published second: `desi_map_version_frozen` refuses a
  // section added to a published version, which is what publishing one means.
  await prisma.venueMapVersion.update({
    where: { id: version.id },
    data: { publishedAt: new Date() },
  })

  const session = await prisma.eventSession.create({
    data: {
      id: id(tag, 'seated-session'),
      eventId: event.id,
      startsAt,
      endsAt,
      timezone: 'Asia/Kolkata',
      venueMapVersionId: version.id,
    },
  })

  const eventSeats = []

  for (const [index, seat] of seats.entries()) {
    eventSeats.push(
      await prisma.eventSeat.create({
        data: {
          id: id(tag, `eventseat-${index}`),
          eventSessionId: session.id,
          seatId: seat.id,
          ticketTypeId: ticketType.id,
          status: 'AVAILABLE',
        },
      }),
    )
  }

  return {
    eventId: event.id,
    sessionId: session.id,
    seatIds: eventSeats.map((seat) => seat.id),
  }
}

/**
 * Issued tickets and the accounts that scan them.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} params Inputs.
 * @param {string} params.tag This run's suffix.
 * @param {object} params.event The event.
 * @param {object} params.session Its session.
 * @param {object} params.roomy The unconstrained tier.
 * @param {string} params.authSecret The deployment's `AUTH_SECRET`, for sealing the factor.
 * @returns {Promise<object>} The door world, including whether each account was enrolled.
 */
async function buildDoorTickets(prisma, { tag, event, session, roomy, authSecret }) {
  // Hashed here rather than pasted. A stored hash in a file is a hash nobody
  // can verify still matches its password, and the first version of this file
  // had one that did not — every scenario needing a signed-in caller answered
  // 401 for a whole run before anybody noticed. The cost is one derivation per
  // run, paid before the clock starts.
  // Named so it announces itself. The secret scanner's allow rule is a list of
  // markers a placeholder can carry, and a value that means "fake" without
  // saying one of them is a value the scanner is right to flag.
  const password = 'test-only-fake-load-suite-password'
  const passwordHash = hashPasswordSync(password)

  const scanner = await prisma.user.create({
    data: {
      id: id(tag, 'scanner'),
      email: `load-scanner-${tag}@desi-event.example`,
      displayName: 'Load Scanner',
      passwordHash,
      role: 'ORGANIZER',
      emailVerified: true,
    },
  })

  const operator = await prisma.user.create({
    data: {
      id: id(tag, 'operator'),
      email: `load-operator-${tag}@desi-event.example`,
      displayName: 'Load Operator',
      passwordHash,
      role: 'SUPER_ADMIN',
      emailVerified: true,
    },
  })

  await prisma.membership.create({
    data: {
      id: id(tag, 'membership'),
      userId: scanner.id,
      organizationId: event.organizationId,
      role: 'STAFF',
    },
  })

  const order = await prisma.order.create({
    data: {
      id: id(tag, 'door-order'),
      reference: `DE-LOAD${tag.toUpperCase().slice(0, 6)}`,
      eventId: event.id,
      eventSessionId: session.id,
      buyerEmail: `load-door-${tag}@desi-event.example`,
      buyerName: 'Load Buyer',
      status: 'PAID',
      currency: 'INR',
      subtotalCents: 100_000 * DOOR_TICKETS,
      totalCents: 100_000 * DOOR_TICKETS,
      paidAt: new Date(),
    },
  })

  const orderItem = await prisma.orderItem.create({
    data: {
      id: id(tag, 'door-line'),
      orderId: order.id,
      ticketTypeId: roomy.id,
      quantity: DOOR_TICKETS,
      unitPriceCents: 100_000,
      subtotalCents: 100_000 * DOOR_TICKETS,
    },
  })

  const codes = []

  for (let index = 0; index < DOOR_TICKETS; index += 1) {
    const ticketId = id(tag, `door-ticket-${index}`)
    const code = `DET-LOAD${tag.toUpperCase().slice(0, 4)}${index}`
    const { credentialHash } = issueTicketCredential({
      secret:
        process.env.AUTH_SECRET ?? process.env.JWT_SECRET ?? 'load-suite-secret-32-characters-x',
      ticketId,
      version: 1,
    })

    await prisma.ticket.create({
      data: {
        id: ticketId,
        orderItemId: orderItem.id,
        code,
        credentialHash,
        credentialVersion: 1,
        credentialIssuedAt: new Date(),
        status: 'VALID',
      },
    })

    codes.push(code)
  }

  // The platform operator is privileged and cannot sign in without a factor.
  // The scanner is enrolled too: it holds `ticket:check_in` through a
  // membership, and whether that counts as privileged is a rule this harness
  // should not be second-guessing — enrolling both is correct either way.
  await enrol(prisma, tag, operator, authSecret)
  await enrol(prisma, tag, scanner, authSecret)

  return {
    codes,
    scannerEmail: scanner.email,
    scannerEnrolled: true,
    operatorEmail: operator.email,
    password,
  }
}

/**
 * A paid order the refund scenario can contend over.
 *
 * Small on purpose: the ceiling is what the scenario is testing, and an order
 * of a million would never reach it inside a ten-second window.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} params Inputs.
 * @param {string} params.tag This run's suffix.
 * @param {object} params.event The event.
 * @param {object} params.session Its session.
 * @param {object} params.roomy The unconstrained tier.
 * @returns {Promise<{reference: string, intentId: string}>} What the scenario needs.
 */
async function buildRefundableOrder(prisma, { tag, event, session, roomy }) {
  const reference = `DE-LREF${tag.toUpperCase().slice(0, 6)}`
  const intentId = `pi_load_${tag}`

  const order = await prisma.order.create({
    data: {
      id: id(tag, 'refund-order'),
      reference,
      eventId: event.id,
      eventSessionId: session.id,
      buyerEmail: `load-refund-${tag}@desi-event.example`,
      buyerName: 'Load Buyer',
      status: 'PAID',
      currency: 'INR',
      subtotalCents: 5_000,
      totalCents: 5_000,
      paidAt: new Date(),
    },
  })

  await prisma.orderItem.create({
    data: {
      id: id(tag, 'refund-line'),
      orderId: order.id,
      ticketTypeId: roomy.id,
      quantity: 1,
      unitPriceCents: 5_000,
      subtotalCents: 5_000,
    },
  })

  await prisma.payment.create({
    data: {
      id: id(tag, 'refund-payment'),
      orderId: order.id,
      provider: 'in-memory-payments',
      providerRef: intentId,
      status: 'SUCCEEDED',
      amountCents: 5_000,
      currency: 'INR',
    },
  })

  return { reference, intentId }
}
