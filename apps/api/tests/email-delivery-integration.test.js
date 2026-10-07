/**
 * Show-once codes emailed through a real SMTP conversation, against
 * PostgreSQL.
 *
 * The API is built the way a deployment builds it with `DELIVERY_MODE=EMAIL`
 * and an SMTP server named — no `deliver` hook passed in, so `buildApp` makes
 * the mailer from the environment — and the server is a local sink on a
 * loopback port. Nothing leaves the machine.
 *
 * What only this end-to-end path can answer:
 *
 *   - the letter the recipient receives carries the code, alone on its line,
 *     and the code it carries is the one whose digest the database holds;
 *   - the join address in the letter is the bare page, with no code in it;
 *   - organiser invitations, team invitations and ticket transfers each go
 *     out, to the address they are bound to, and the response shows none;
 *   - registering and asking for a password reset send nothing, in any mode;
 *   - one address is emailed at most three codes a day even when the requests
 *     arrive together: transfers from several holders, team invitations from
 *     two organisations and a reissued code all wait on one lock for that
 *     address and count what the one before them committed;
 *   - when the mail server cannot be reached an organiser invitation, a team
 *     invitation and a ticket transfer are each withdrawn, and the caller is
 *     told 503 `DELIVERY_FAILED`;
 *   - no code that was emailed is in the audit log, the notification outbox
 *     or a log line.
 *
 * Runs against `TEST_DATABASE_URL`. With `REQUIRE_DATABASE` set it fails rather
 * than skips.
 *
 * @module @desi-event/api/tests/email-delivery-integration
 */

import { createHash } from 'node:crypto'

import { createLogger } from '@desi-event/logger'
import { createInMemoryProviderRegistry } from '@desi-event/providers'
import { SMTPServer } from 'smtp-server'
import { afterAll, beforeAll, expect, it } from 'vitest'

import { buildApp } from '../src/app.js'
import { RECIPIENT_LOCK_CLASS } from '../src/lib/delivery.js'
import { startSession } from '../src/lib/sessions.js'
import { TICKET_STATES, transferTokenDigest } from '../src/lib/tickets.js'
import { connectTestDatabase } from './helpers/database.js'
import { testEnv } from './helpers/app.js'
import { untilWaiting } from './helpers/row-locks.js'

const { prisma, reachable, when } = await connectTestDatabase('the email delivery suite')

/** Distinguishes this run's rows from every other run's. */
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`

/** The domain every address in this suite shares. */
const DOMAIN = `mail-${RUN}.example`

/** The web origin the letters name. */
const WEB_ORIGIN = 'https://desi-event.test'

/** The address codes are sent from. */
const SENDER = 'codes@desi-event.test'

/** A code as `issueToken` and `mintTransferToken` write it, alone on its line. */
const CODE_LINE = /^ {4}([A-Za-z0-9_-]{16,512})$/mu

let sequence = 0

/** Every code the sink received, collected as the letters arrive. */
const emailedCodes = []

/** Everything the API logged, at every level. */
const logLines = []

/**
 * A CUID-shaped identifier unique to this run.
 *
 * @param {string} kind What it names.
 * @returns {string} The identifier.
 */
function id(kind) {
  sequence += 1

  const digest = createHash('sha256').update(`email-${RUN}-${kind}-${sequence}`).digest('hex')
  const body = BigInt(`0x${digest}`)
    .toString(36)
    .replace(/[^a-z0-9]/g, '')

  return `c${body.padEnd(24, '0').slice(0, 24)}`
}

/**
 * SHA-256, hex: what `hashToken` stores.
 *
 * @param {string} value The code.
 * @returns {string} Its digest.
 */
function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

/**
 * Decode a quoted-printable body into UTF-8 text.
 *
 * @param {string} body The encoded body.
 * @returns {string} The decoded text.
 */
function decodeQuotedPrintable(body) {
  const joined = body.replace(/=\r?\n/gu, '')
  const bytes = []

  for (let index = 0; index < joined.length; index += 1) {
    const char = joined[index]

    if (char === '=' && /^[0-9A-F]{2}$/iu.test(joined.slice(index + 1, index + 3))) {
      bytes.push(Number.parseInt(joined.slice(index + 1, index + 3), 16))
      index += 2
    } else {
      bytes.push(...Buffer.from(char, 'utf8'))
    }
  }

  return Buffer.from(bytes).toString('utf8')
}

/**
 * Split a received message into lower-cased headers and a decoded body.
 *
 * @param {string} raw The message as the sink received it.
 * @returns {{headers: Record<string, string>, body: string}} The parts.
 */
function parseMessage(raw) {
  const split = raw.indexOf('\r\n\r\n')
  const head = raw.slice(0, split).replace(/\r\n[ \t]+/gu, ' ')
  const rawBody = raw.slice(split + 4)
  /** @type {Record<string, string>} */
  const headers = {}

  for (const line of head.split('\r\n')) {
    const colon = line.indexOf(':')

    headers[line.slice(0, colon).toLowerCase()] = line.slice(colon + 1).trim()
  }

  const encoding = (headers['content-transfer-encoding'] ?? '7bit').toLowerCase()
  const body =
    encoding === 'quoted-printable'
      ? decodeQuotedPrintable(rawBody)
      : encoding === 'base64'
        ? Buffer.from(rawBody.replace(/\s/gu, ''), 'base64').toString('utf8')
        : rawBody

  return { headers, body: body.replace(/\r\n/gu, '\n') }
}

/**
 * A local SMTP sink on a free loopback port.
 *
 * @returns {Promise<{port: number, messages: object[], close: function(): Promise<void>}>} The sink.
 */
async function startSink() {
  const messages = []
  const server = new SMTPServer({
    secure: false,
    disabledCommands: ['STARTTLS', 'AUTH'],
    authOptional: true,
    logger: false,
    onData(stream, session, callback) {
      const chunks = []

      stream.on('data', (chunk) => chunks.push(chunk))
      stream.on('end', () => {
        messages.push({
          to: session.envelope.rcptTo.map((entry) => entry.address),
          from: session.envelope.mailFrom?.address,
          ...parseMessage(Buffer.concat(chunks).toString('utf8')),
        })
        callback()
      })
    },
  })

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))

  return {
    port: server.server.address().port,
    messages,
    close: () => new Promise((resolve) => server.close(resolve)),
  }
}

/**
 * A user, with a confirmed second factor when asked.
 *
 * @param {string} local The address's local part.
 * @param {object} [options] Options.
 * @param {string} [options.role] The platform role.
 * @param {boolean} [options.secondFactor] Whether to give them a factor.
 * @returns {Promise<object>} The user row.
 */
async function user(local, { role = 'ATTENDEE', secondFactor = true } = {}) {
  const row = await prisma.user.create({
    data: {
      id: id(`user-${local}`),
      email: `${local}.${RUN}@${DOMAIN}`,
      displayName: local,
      passwordHash: 'not-a-hash-this-suite-never-signs-in-with-a-password',
      role,
      emailVerified: true,
    },
  })

  if (secondFactor) {
    await prisma.mfaFactor.create({
      data: {
        id: id(`factor-${local}`),
        userId: row.id,
        type: 'TOTP',
        secretSealed: 'placeholder-the-enrolment-gate-counts-rows-and-never-reads-this',
        confirmedAt: new Date(),
      },
    })
  }

  return row
}

/**
 * Bearer headers for a real session with a second factor confirmed just now.
 *
 * @param {object} who The user.
 * @returns {Promise<object>} Headers.
 */
async function headersFor(who) {
  const memberships = await prisma.membership.findMany({ where: { userId: who.id } })
  const { secret } = await startSession(prisma, {
    actor: { id: who.id, role: who.role, memberships },
    request: { headers: {}, ip: '127.0.0.1' },
    key: 'email-delivery-suite-pseudonymisation-key',
    mfaSatisfied: true,
  })

  return { authorization: `Bearer ${secret}` }
}

/**
 * The messages the sink has received for one address.
 *
 * @param {string} address The recipient.
 * @returns {object[]} The messages.
 */
function mailFor(address) {
  return sink.messages.filter((message) => message.to.includes(address))
}

let sink
let app
let world

beforeAll(async () => {
  if (!reachable) return

  sink = await startSink()
  app = await buildApp({
    prisma,
    providers: createInMemoryProviderRegistry(),
    env: testEnv({
      WEB_ORIGIN,
      DELIVERY_MODE: 'EMAIL',
      SMTP_HOST: '127.0.0.1',
      SMTP_PORT: String(sink.port),
      SMTP_FROM: SENDER,
      // The sink speaks plain SMTP on loopback; production refuses this.
      SMTP_REQUIRE_TLS: 'false',
    }),
    docs: false,
    processEnv: {},
    // Every level, into memory, so the last test can read what was written.
    logger: createLogger({
      name: 'email-delivery-suite',
      level: 'trace',
      destination: { write: (line) => logLines.push(String(line)) },
    }),
    rateLimit: {
      global: { max: 10_000, timeWindow: '1 minute' },
      auth: { max: 1000 },
      organizerInvite: { max: 1000 },
    },
  })
  await app.ready()

  const administrator = await user('anil.admin', { role: 'ADMIN' })
  const owner = await user('meera.owner', { role: 'ORGANIZER' })
  const organization = await prisma.organization.create({
    data: {
      id: id('org'),
      name: `Rangoli ${RUN}`,
      slug: `rangoli-${RUN}`,
      contactEmail: owner.email,
    },
  })

  await prisma.membership.create({
    data: {
      id: id('membership'),
      userId: owner.id,
      organizationId: organization.id,
      role: 'OWNER',
    },
  })

  world = {
    administrator,
    owner,
    organization,
    adminHeaders: await headersFor(administrator),
    ownerHeaders: await headersFor(owner),
  }
})

afterAll(async () => {
  await app?.close()
  await sink?.close()
  await prisma.$disconnect()
})

/**
 * A ticket a holder owns, on a published event, written directly.
 *
 * @param {object} holder The holder.
 * @returns {Promise<object>} The ticket row.
 */
async function ownedTicket(holder) {
  const tag = `${RUN}${(sequence += 1).toString(36)}`
  const startsAt = new Date(Date.now() + 86_400_000)
  const endsAt = new Date(startsAt.getTime() + 3_600_000)
  const venue = await prisma.venue.create({
    data: {
      id: id('venue'),
      organizationId: world.organization.id,
      name: 'Mail Hall',
      slug: `mail-venue-${tag}`,
      addressLine1: '1 Test Road',
      city: 'Austin',
      region: 'TX',
      postalCode: '78701',
      country: 'US',
      timezone: 'America/Chicago',
    },
  })
  const event = await prisma.event.create({
    data: {
      id: id('event'),
      organizationId: world.organization.id,
      venueId: venue.id,
      title: `Mail Night ${tag}`,
      slug: `mail-event-${tag}`,
      category: 'MUSIC_CONCERT',
      summary: 'Built by the email delivery suite.',
      description: 'One ticket, one holder, one person they would like to give it to.',
      status: 'PUBLISHED',
      startsAt,
      endsAt,
      timezone: 'America/Chicago',
    },
  })
  const ticketType = await prisma.ticketType.create({
    data: {
      id: id('tier'),
      eventId: event.id,
      name: 'General',
      priceCents: 2_500,
      currency: 'USD',
      quantityTotal: 1,
      status: 'ON_SALE',
    },
  })
  const session = await prisma.eventSession.create({
    data: { id: id('session'), eventId: event.id, startsAt, endsAt, timezone: 'America/Chicago' },
  })
  const order = await prisma.order.create({
    data: {
      id: id('order'),
      reference: `DE-ML${tag.toUpperCase()}`,
      eventId: event.id,
      eventSessionId: session.id,
      userId: holder.id,
      buyerEmail: holder.email,
      buyerName: 'holder',
      status: 'PAID',
      currency: 'USD',
      subtotalCents: 2_500,
      totalCents: 2_500,
      paidAt: new Date(),
    },
  })
  const orderItem = await prisma.orderItem.create({
    data: {
      id: id('line'),
      orderId: order.id,
      ticketTypeId: ticketType.id,
      quantity: 1,
      unitPriceCents: 2_500,
      subtotalCents: 2_500,
    },
  })

  return prisma.ticket.create({
    data: {
      id: id('ticket'),
      orderItemId: orderItem.id,
      code: `DET-ML${tag.toUpperCase()}`,
      ownerUserId: holder.id,
      attendeeName: 'holder',
      status: TICKET_STATES.VALID,
    },
  })
}

/**
 * A second organisation, with its own owner signed in, so team invitations can
 * come from two organisations at once.
 *
 * @param {string} tag Distinguishes this organisation's rows.
 * @returns {Promise<{organization: object, headers: object}>} The organisation and its owner's headers.
 */
async function anotherOrganisation(tag) {
  const owner = await user(`owner.${tag}`)
  const organization = await prisma.organization.create({
    data: {
      id: id(`org-${tag}`),
      name: `Garba ${tag} ${RUN}`,
      slug: `garba-${tag}-${RUN}`,
      contactEmail: owner.email,
    },
  })

  await prisma.membership.create({
    data: {
      id: id(`membership-${tag}`),
      userId: owner.id,
      organizationId: organization.id,
      role: 'OWNER',
    },
  })

  return { organization, headers: await headersFor(owner) }
}

/**
 * Offer a ticket to an address.
 *
 * @param {object} ticket The ticket.
 * @param {object} headers Its holder's headers.
 * @param {string} toEmail To whom.
 * @returns {Promise<object>} The inject result.
 */
function offerTicket(ticket, headers, toEmail) {
  return app.inject({
    method: 'POST',
    url: `/v1/tickets/${ticket.id}/transfers`,
    headers,
    payload: { toEmail },
  })
}

/**
 * Invite an address to an organisation's team, as a member of staff.
 *
 * @param {object} organization The organisation.
 * @param {object} headers Its owner's headers.
 * @param {string} email To whom.
 * @returns {Promise<object>} The inject result.
 */
function inviteToTeam(organization, headers, email) {
  return app.inject({
    method: 'POST',
    url: `/v1/organizations/${organization.id}/invitations`,
    headers,
    payload: { email, role: 'STAFF' },
  })
}

/**
 * The codes one address has been sent today, as the cap counts them: team
 * invitations sent by email and ticket transfers.
 *
 * @param {string} email The address.
 * @returns {Promise<number>} How many rows.
 */
async function codeRowsFor(email) {
  const [invitations, transfers] = await Promise.all([
    prisma.invitation.count({ where: { email, deliveryMode: 'EMAIL' } }),
    prisma.ticketTransfer.count({ where: { toEmail: email } }),
  ])

  return invitations + transfers
}

/**
 * Tally a set of responses by status.
 *
 * @param {object[]} responses Inject results.
 * @returns {Record<number, number>} How many of each status.
 */
function tally(responses) {
  /** @type {Record<number, number>} */
  const counts = {}

  for (const response of responses) {
    counts[response.statusCode] = (counts[response.statusCode] ?? 0) + 1
  }

  return counts
}

/**
 * Every refusal is the recipient cap's, with a day's `retry-after`.
 *
 * @param {object[]} responses Inject results.
 * @returns {void} Nothing.
 */
function expectCapRefusals(responses) {
  for (const response of responses.filter((each) => each.statusCode !== 201)) {
    expect(response.statusCode, response.body).toBe(429)
    expect(response.json().error.code).toBe('RECIPIENT_DAILY_LIMIT')
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(23 * 60 * 60)
    expect(Number(response.headers['retry-after'])).toBeLessThanOrEqual(24 * 60 * 60)
  }
}

const describeWhen = when()

describeWhen('codes emailed through SMTP', () => {
  it('runs in EMAIL mode, built from the environment', () => {
    expect(app.deliveryMode).toBe('EMAIL')
  })

  it('emails an organiser invitation whose code is the one the database holds the digest of', async () => {
    const email = `new.organiser.${RUN}@${DOMAIN}`
    const response = await app.inject({
      method: 'POST',
      url: '/v1/platform/organizer-invitations',
      headers: world.adminHeaders,
      payload: {
        email,
        organizationName: `સંગીત સંધ્યા ${RUN}`,
        note: 'We spoke on the phone.\nWelcome.',
      },
    })

    expect(response.statusCode, response.body).toBe(201)
    expect(response.json().data.delivery).toEqual({ mode: 'EMAIL', invitationCode: null })

    const [letter] = mailFor(email)

    expect(letter).toBeDefined()
    expect(letter.from).toBe(SENDER)
    expect(letter.headers['content-type']).toMatch(/text\/plain; charset=utf-8/iu)
    expect(letter.body).toContain(`"સંગીત સંધ્યા ${RUN}"`)
    expect(letter.body).toContain('> We spoke on the phone.\n> Welcome.')
    expect(letter.body).toContain(`1. Open ${WEB_ORIGIN}/account/organizations/new\n`)

    const code = letter.body.match(CODE_LINE)?.[1]
    const row = await prisma.organizerInvitation.findUnique({
      where: { id: response.json().data.id },
    })

    expect(code).toBeDefined()
    emailedCodes.push(code)
    expect(sha256(code)).toBe(row.tokenHash)
    expect(row.deliveryMode).toBe('EMAIL')
    expect(response.body).not.toContain(code)

    // Every address in the letter is the bare join page.
    for (const url of letter.body.match(/https?:\/\/\S+/gu) ?? []) {
      expect(url).not.toContain(code)
      expect(url).not.toMatch(/[?#]/u)
    }

    // And the code the letter carried works, for the address it was sent to.
    const recipient = await prisma.user.create({
      data: {
        id: id('recipient'),
        email,
        displayName: 'New Organiser',
        passwordHash: 'not-a-hash-this-suite-never-signs-in-with-a-password',
        role: 'ATTENDEE',
        emailVerified: true,
      },
    })
    const accepted = await app.inject({
      method: 'POST',
      url: '/v1/organizer-invitations/accept',
      headers: await headersFor(recipient),
      payload: { token: code, slug: `sangeet-${RUN}` },
    })

    expect(accepted.statusCode, accepted.body).toBe(200)
  })

  it('emails a team invitation, and says when the organisation is not verified', async () => {
    const email = `door.${RUN}@${DOMAIN}`
    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${world.organization.id}/invitations`,
      headers: world.ownerHeaders,
      payload: { email, role: 'STAFF' },
    })

    expect(response.statusCode, response.body).toBe(201)
    expect(response.json().data.delivery).toEqual({ mode: 'EMAIL', invitationCode: null })

    const [letter] = mailFor(email)

    expect(letter.headers.subject).toContain('You are invited to join')
    expect(letter.body).toContain('as a member of its staff.')
    expect(letter.body).toContain('This organisation has not been verified by the Desi-Event team.')
    expect(letter.body).toContain(`1. Open ${WEB_ORIGIN}/account/invitations\n`)

    const code = letter.body.match(CODE_LINE)?.[1]
    const row = await prisma.invitation.findUnique({ where: { id: response.json().data.id } })

    expect(code).toBeDefined()
    emailedCodes.push(code)
    expect(sha256(code)).toBe(row.tokenHash)
    expect(row.deliveryMode).toBe('EMAIL')
  })

  it('emails a ticket transfer to the address the holder typed', async () => {
    const holder = await user('ticket.holder', { secondFactor: false })
    const ticket = await ownedTicket(holder)
    const email = `friend.${RUN}@${DOMAIN}`

    const response = await app.inject({
      method: 'POST',
      url: `/v1/tickets/${ticket.id}/transfers`,
      headers: await headersFor(holder),
      payload: { toEmail: email, message: 'Enjoy the show!' },
    })

    expect(response.statusCode, response.body).toBe(201)
    expect(response.json().data.delivery).toEqual({ mode: 'EMAIL', invitationCode: null })

    const [letter] = mailFor(email)

    expect(letter.body).toContain(`1. Open ${WEB_ORIGIN}/tickets/accept\n`)
    expect(letter.body).toContain(
      'Message from the sender (written by them, not by Desi-Event):\n> Enjoy the show!',
    )

    const code = letter.body.match(CODE_LINE)?.[1]
    const transfer = await prisma.ticketTransfer.findUnique({
      where: { id: response.json().data.id },
    })

    expect(code).toBeDefined()
    emailedCodes.push(code)
    expect(transferTokenDigest(code)).toBe(transfer.tokenHash)
    expect(response.body).not.toContain(code)
  })

  it('sends nothing for a registration or a password reset, even in EMAIL mode', async () => {
    const before = sink.messages.length
    const email = `register.${RUN}@${DOMAIN}`

    const registered = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { email, password: 'a-long-enough-test-password-for-the-suite', displayName: 'Reg' },
    })

    expect(registered.statusCode, registered.body).toBe(201)

    const forgot = await app.inject({
      method: 'POST',
      url: '/v1/auth/forgot-password',
      payload: { email },
    })

    expect(forgot.statusCode).toBeLessThan(300)
    expect(sink.messages).toHaveLength(before)
  })

  it('caps, supersedes and refuses by the address itself, never by one an underscore away', async () => {
    // A case-insensitive Prisma `equals` runs as an ILIKE, where `_` matches
    // any one character: each pair below differs only there.
    const lookAlike = `jxdoe.${RUN}@${DOMAIN}`
    const email = `j_doe.${RUN}@${DOMAIN}`
    const invite = (address) =>
      app.inject({
        method: 'POST',
        url: `/v1/organizations/${world.organization.id}/invitations`,
        headers: world.ownerHeaders,
        payload: { email: address, role: 'STAFF' },
      })

    // The look-alike is sent its three codes for the day, and no fourth.
    for (let sent = 0; sent < 3; sent += 1) {
      const response = await invite(lookAlike)

      expect(response.statusCode, response.body).toBe(201)
    }

    const fourth = await invite(lookAlike)

    expect(fourth.statusCode).toBe(429)
    expect(fourth.json().error.code).toBe('RECIPIENT_DAILY_LIMIT')

    // This address has been sent nothing, so it is not capped by those...
    const own = await invite(email)

    expect(own.statusCode, own.body).toBe(201)
    expect(mailFor(email)).toHaveLength(1)

    // ...and inviting it leaves the look-alike's waiting invitation alone.
    const waiting = await prisma.invitation.findMany({
      where: { organizationId: world.organization.id, email: lookAlike, status: 'PENDING' },
    })

    expect(waiting).toHaveLength(1)

    // A staff account an underscore away is somebody else: an organiser
    // invitation to this address is issued, and the staff address itself is
    // still refused.
    const staff = await user('zz.staff1', { role: 'ADMIN', secondFactor: false })
    const outsider = `zz.staff_.${RUN}@${DOMAIN}`
    const organiserInvite = (address, organizationName) =>
      app.inject({
        method: 'POST',
        url: '/v1/platform/organizer-invitations',
        headers: world.adminHeaders,
        payload: { email: address, organizationName },
      })

    // An expired, still-waiting organiser invitation to a look-alike is the
    // look-alike's; issuing one to this address does not touch it.
    const lapsed = await prisma.organizerInvitation.create({
      data: {
        id: id('lapsed-organiser-invitation'),
        email: `zz.staffx.${RUN}@${DOMAIN}`,
        organizationName: `Lapsed ${RUN}`,
        tokenHash: sha256(`lapsed-${RUN}`),
        invitedById: world.administrator.id,
        deliveryMode: 'EMAIL',
        createdAt: new Date(Date.now() - 2 * 86_400_000),
        expiresAt: new Date(Date.now() - 86_400_000),
      },
    })

    const issued = await organiserInvite(outsider, `Look-alike ${RUN}`)

    expect(issued.statusCode, issued.body).toBe(201)
    expect(mailFor(outsider)).toHaveLength(1)
    expect((await prisma.organizerInvitation.findUnique({ where: { id: lapsed.id } })).status).toBe(
      'PENDING',
    )

    const refused = await organiserInvite(staff.email, `Staff ${RUN}`)

    expect(refused.statusCode).toBe(422)
    expect(refused.json().error.code).toBe('STAFF_ACCOUNT')
  })

  it('emails one address three codes, not six, when three holders offer it tickets at once', async () => {
    const email = `crowded.${RUN}@${DOMAIN}`
    const offers = []

    // Three holders, two tickets each: within every sender's own hourly
    // budget, so only the recipient cap stands between the address and six
    // letters.
    for (let holderIndex = 0; holderIndex < 3; holderIndex += 1) {
      const holder = await user(`crowd.holder${holderIndex}`, { secondFactor: false })
      const headers = await headersFor(holder)

      for (let ticketIndex = 0; ticketIndex < 2; ticketIndex += 1) {
        offers.push({ ticket: await ownedTicket(holder), headers })
      }
    }

    const responses = await Promise.all(
      offers.map(({ ticket, headers }) => offerTicket(ticket, headers, email)),
    )

    expect(tally(responses)).toEqual({ 201: 3, 429: 3 })
    expectCapRefusals(responses)
    expect(mailFor(email)).toHaveLength(3)
    expect(await codeRowsFor(email)).toBe(3)

    // A refused offer wrote nothing: its ticket is still its holder's.
    for (const [index, response] of responses.entries()) {
      if (response.statusCode !== 429) continue

      const { ticket } = offers[index]
      const after = await prisma.ticket.findUnique({ where: { id: ticket.id } })

      expect(after.status).toBe(TICKET_STATES.VALID)
      expect(await prisma.ticketTransfer.count({ where: { ticketId: ticket.id } })).toBe(0)
    }
  })

  it('counts team invitations from two organisations and transfers arriving together as one address', async () => {
    const email = `mixed.${RUN}@${DOMAIN}`
    const second = await anotherOrganisation('mixed')
    const holders = [
      await user('mixed.holder0', { secondFactor: false }),
      await user('mixed.holder1', { secondFactor: false }),
    ]
    const holderHeaders = await Promise.all(holders.map((holder) => headersFor(holder)))
    const tickets = [
      await ownedTicket(holders[0]),
      await ownedTicket(holders[0]),
      await ownedTicket(holders[1]),
    ]

    const responses = await Promise.all([
      inviteToTeam(world.organization, world.ownerHeaders, email),
      inviteToTeam(second.organization, second.headers, email),
      offerTicket(tickets[0], holderHeaders[0], email),
      offerTicket(tickets[1], holderHeaders[0], email),
      offerTicket(tickets[2], holderHeaders[1], email),
    ])

    expect(tally(responses)).toEqual({ 201: 3, 429: 2 })
    expectCapRefusals(responses)
    expect(mailFor(email)).toHaveLength(3)
    expect(await codeRowsFor(email)).toBe(3)
  })

  it('makes an invitation, a reissue and a transfer wait for the address, then count what the one before wrote', async () => {
    const email = `queued.${RUN}@${DOMAIN}`
    const second = await anotherOrganisation('queued')
    const holder = await user('queued.holder', { secondFactor: false })
    const ticket = await ownedTicket(holder)
    // A code handed over by hand before EMAIL was switched on: not one of the
    // three, and the invitation a reissue replaces.
    const handed = await prisma.invitation.create({
      data: {
        id: id('handed-invitation'),
        organizationId: world.organization.id,
        email,
        role: 'STAFF',
        tokenHash: sha256(`handed-${RUN}`),
        invitedById: world.owner.id,
        expiresAt: new Date(Date.now() + 86_400_000),
        deliveryMode: 'MANUAL',
      },
    })

    // Another issuing transaction holds the address, the way each request's
    // own transaction does while it counts and writes.
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    let held
    const heldPid = new Promise((resolve) => {
      held = resolve
    })
    const holding = prisma.$transaction(
      async (tx) => {
        const [{ pid }] = await tx.$queryRaw`SELECT pg_backend_pid() AS pid`

        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${RECIPIENT_LOCK_CLASS}::int4, hashtext(${email}))`
        held(pid)
        await gate

        // Three codes this address was emailed, committed as the lock goes.
        for (let index = 0; index < 3; index += 1) {
          await tx.invitation.create({
            data: {
              id: id(`emailed-invitation-${index}`),
              organizationId: world.organization.id,
              email,
              role: 'STAFF',
              tokenHash: sha256(`emailed-${RUN}-${index}`),
              invitedById: world.owner.id,
              status: 'REVOKED',
              revokedAt: new Date(),
              expiresAt: new Date(Date.now() + 86_400_000),
              deliveryMode: 'EMAIL',
            },
          })
        }
      },
      { timeout: 20_000, maxWait: 10_000 },
    )
    const holderPid = await heldPid

    const pending = Promise.all([
      offerTicket(ticket, await headersFor(holder), email),
      inviteToTeam(second.organization, second.headers, email),
      app.inject({
        method: 'POST',
        url: `/v1/organizations/${world.organization.id}/invitations/${handed.id}/reissue`,
        headers: world.ownerHeaders,
      }),
    ])

    // All three are queued on the address. Counted before taking it, each
    // would have found nothing and sent a letter.
    await untilWaiting(prisma, () => [holderPid], 3, 'three issuing requests')

    release()
    await holding

    const responses = await pending

    expect(tally(responses)).toEqual({ 429: 3 })
    expectCapRefusals(responses)
    expect(mailFor(email)).toHaveLength(0)

    // Nothing any of them would have written is there.
    expect(await prisma.ticketTransfer.count({ where: { ticketId: ticket.id } })).toBe(0)
    expect((await prisma.ticket.findUnique({ where: { id: ticket.id } })).status).toBe(
      TICKET_STATES.VALID,
    )
    expect(
      await prisma.invitation.count({ where: { organizationId: second.organization.id } }),
    ).toBe(0)
    expect((await prisma.invitation.findUnique({ where: { id: handed.id } })).status).toBe(
      'PENDING',
    )
  })

  it('withdraws the invitation and answers 503 when the mail server cannot be reached', async () => {
    await sink.close()

    const email = `unreachable.${RUN}@${DOMAIN}`
    const response = await app.inject({
      method: 'POST',
      url: '/v1/platform/organizer-invitations',
      headers: world.adminHeaders,
      payload: { email, organizationName: `Unreachable ${RUN}` },
    })

    expect(response.statusCode).toBe(503)
    expect(response.json().error.code).toBe('DELIVERY_FAILED')

    const rows = await prisma.organizerInvitation.findMany({ where: { email } })

    expect(rows.map((row) => row.status)).toEqual(['REVOKED'])
    expect(
      await prisma.auditLog.count({
        where: { action: 'organizer_invitation.delivery_failed', entityId: rows[0].id },
      }),
    ).toBe(1)
  })

  // The sink stays closed from here on: the test above shut it.

  it('withdraws a team invitation the mail server could not take, and answers 503', async () => {
    const email = `unreachable.door.${RUN}@${DOMAIN}`
    const response = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${world.organization.id}/invitations`,
      headers: world.ownerHeaders,
      payload: { email, role: 'STAFF' },
    })

    expect(response.statusCode).toBe(503)
    expect(response.json().error.code).toBe('DELIVERY_FAILED')

    // Withdrawn in the database, where the CHECKs on a revoked invitation
    // hold: nobody holds the code, so nothing is left that could be accepted.
    const rows = await prisma.invitation.findMany({
      where: { email, organizationId: world.organization.id },
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'REVOKED', deliveryMode: 'EMAIL' })
    expect(rows[0].revokedAt).toBeInstanceOf(Date)

    const [audit] = await prisma.auditLog.findMany({
      where: { action: 'team.invitation_delivery_failed', entityId: rows[0].id },
    })

    expect(audit).toMatchObject({ actorId: world.owner.id, entityType: 'Invitation' })
    expect(JSON.stringify(audit.metadata)).not.toContain(email)
  })

  it('withdraws a ticket transfer the mail server could not take, and gives the ticket back', async () => {
    const holder = await user('unreachable.holder', { secondFactor: false })
    const ticket = await ownedTicket(holder)
    const email = `unreachable.friend.${RUN}@${DOMAIN}`

    const response = await app.inject({
      method: 'POST',
      url: `/v1/tickets/${ticket.id}/transfers`,
      headers: await headersFor(holder),
      payload: { toEmail: email },
    })

    expect(response.statusCode).toBe(503)
    expect(response.json().error.code).toBe('DELIVERY_FAILED')

    const transfers = await prisma.ticketTransfer.findMany({ where: { ticketId: ticket.id } })

    expect(transfers.map((row) => row.status)).toEqual(['CANCELLED'])

    const after = await prisma.ticket.findUnique({ where: { id: ticket.id } })

    expect(after.status).toBe(TICKET_STATES.VALID)
    expect(after.ownerUserId).toBe(holder.id)
    expect(
      await prisma.auditLog.count({
        where: { action: 'ticket.transfer_delivery_failed', entityId: ticket.id },
      }),
    ).toBe(1)
  })

  it('leaves no emailed code in the audit log, the outbox or a log line', async () => {
    // One from each kind of letter, collected above as the sink received them.
    expect(emailedCodes).toHaveLength(3)

    const logged = logLines.join('')

    // The log was written to, failures included: the absence below is not an
    // empty file.
    expect(logged).toContain('issued an organiser invitation')
    expect(logged).toContain('a code could not be emailed; what was issued has been withdrawn')

    for (const code of emailedCodes) {
      const pattern = `%${code}%`
      const [audits] = await prisma.$queryRaw`
        SELECT count(*)::int AS "count" FROM "AuditLog" WHERE "metadata"::text LIKE ${pattern}`
      const [outbox] = await prisma.$queryRaw`
        SELECT count(*)::int AS "count" FROM "NotificationOutbox" WHERE "payload"::text LIKE ${pattern}`

      expect(audits.count).toBe(0)
      expect(outbox.count).toBe(0)
      expect(logged).not.toContain(code)
    }
  })
})
