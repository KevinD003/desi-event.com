/**
 * What the logs hold after every show-once code has been issued, used, refused
 * and sent back malformed.
 *
 * A team invitation and a ticket offer each hand their code back exactly once,
 * in the 201 that made it (`DELIVERY_MODE` MANUAL, this build's only mode).
 * The code is the credential: whoever holds it, signed in at the right
 * address, joins the team or takes the ticket. So it must never reach a log
 * line, where it would outlive the response by the log's retention and be read
 * by whoever reads logs.
 *
 * The same stub-database application every route suite builds, with a real
 * `@desi-event/logger` at `debug` writing into memory. It invites, reissues,
 * offers, declines, accepts, withdraws, and sends the codes back in every
 * wrong shape a client could manage — the code as the wrong type, under the
 * wrong name or padded past its length, a body that is not JSON, the code from
 * somebody it was not for, a spent code and a superseded one. Then every line
 * is searched for every code.
 *
 * Nothing in the API logs a request body today, and the logger's redaction
 * list names `invitationCode` and `token` besides
 * (`packages/logger/src/redaction.test.js` pins them). A clean log therefore
 * proves both lines hold for these routes; the two log messages checked first
 * prove the log was being written at all.
 */

import { hashToken } from '@desi-event/auth'
import { createLogger } from '@desi-event/logger'
import { describe, expect, it } from 'vitest'

import { resetTrafficMemory } from '../src/lib/traffic.js'
import { bearer, claim, createTestApp, signIn, stepUp } from './helpers/app.js'
import { generatedReferralText } from './helpers/fee-orders.js'
import { makeWorld } from './helpers/fixtures.js'
import { expectNoSecret } from './helpers/payloads.js'

/** The attendee who buys, offers, and is invited to the team. */
const HOLDER = 'priya@example.com'

/** Whoever is offered a ticket: an organiser elsewhere, with an account. */
const RECIPIENT = 'rival@dhol.example'

/** The owner of the fixture organisation, who invites. */
const OWNER = 'owner@rangoli.example'

/**
 * An in-memory pino destination.
 *
 * @returns {{write: function(string): void, raw: function(): string, lines: function(): object[]}} The stream and its readers.
 */
function captureStream() {
  /** @type {string[]} */
  const chunks = []

  return {
    write(chunk) {
      chunks.push(String(chunk))
    },
    raw() {
      return chunks.join('')
    },
    lines() {
      return chunks
        .join('')
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line))
    },
  }
}

/**
 * Send a JSON request as the given account.
 *
 * @param {object} app The application.
 * @param {string} token A bearer token.
 * @param {string} url The path.
 * @param {object|undefined} payload The body.
 * @returns {Promise<object>} The injected response.
 */
function post(app, token, url, payload) {
  return app.inject({ method: 'POST', url, headers: bearer(token), payload })
}

/**
 * Send a body that is not valid JSON but says it is.
 *
 * @param {object} app The application.
 * @param {string} token A bearer token.
 * @param {string} url The path.
 * @param {string} text The raw body.
 * @returns {Promise<object>} The injected response.
 */
function postRaw(app, token, url, text) {
  return app.inject({
    method: 'POST',
    url,
    headers: { ...bearer(token), 'content-type': 'application/json' },
    payload: text,
  })
}

/**
 * Every wrong shape a client could send a code back in.
 *
 * @param {string} code The code.
 * @returns {Array<{label: string, raw?: string, json?: object}>} The bodies.
 */
function malformed(code) {
  return [
    { label: 'the code in an array', json: { token: [code] } },
    { label: 'the code under the wrong name', json: { invitationCode: code } },
    { label: 'the code padded past its length', json: { token: `${code}${'x'.repeat(600)}` } },
    // V8 quotes the start of the text in a JSON syntax error, so the code
    // is in the parser's message.
    { label: 'a body that is not JSON', raw: `x{"token":"${code}"}` },
    { label: 'a body cut short', raw: `{"token":"${code}` },
  ]
}

/**
 * Send every malformed body to a route and check each is refused.
 *
 * @param {object} app The application.
 * @param {string} token A bearer token.
 * @param {string} url The route.
 * @param {string} code The code to wrap.
 * @returns {Promise<void>}
 */
async function sendMalformed(app, token, url, code) {
  for (const shape of malformed(code)) {
    const response = shape.raw
      ? await postRaw(app, token, url, shape.raw)
      : await post(app, token, url, shape.json)

    expect(response.statusCode, `${url}: ${shape.label}`).toBeGreaterThanOrEqual(400)
    expect(response.statusCode, `${url}: ${shape.label}`).toBeLessThan(500)
  }
}

describe('show-once codes and the logs', () => {
  it('writes no invitation code to any log line, whatever happens to it', async () => {
    const capture = captureStream()
    const logger = createLogger({ name: 'api', level: 'debug', destination: capture })
    const { app, prisma, ids } = await createTestApp({ logger })
    const organizationId = ids.organization.id

    /** @type {Record<string, string>} */
    const codes = {}

    // ----------------------------------------------------------- the team
    const owner = await signIn(app, OWNER)
    const invited = await post(app, owner, `/v1/organizations/${organizationId}/invitations`, {
      email: HOLDER,
      role: 'STAFF',
    })

    expect(invited.statusCode, invited.body).toBe(201)
    codes.invitation = invited.json().data.delivery.invitationCode

    const reissued = await post(
      app,
      owner,
      `/v1/organizations/${organizationId}/invitations/${invited.json().data.id}/reissue`,
    )

    expect(reissued.statusCode, reissued.body).toBe(201)
    codes.reissued = reissued.json().data.delivery.invitationCode

    const holder = await signIn(app, HOLDER)
    const recipient = await signIn(app, RECIPIENT)

    await sendMalformed(app, holder, '/v1/invitations/accept', codes.reissued)

    // The superseded code, and the live one from somebody it was not for.
    const superseded = await post(app, holder, '/v1/invitations/accept', {
      token: codes.invitation,
    })
    const notYours = await post(app, recipient, '/v1/invitations/accept', {
      token: codes.reissued,
    })

    expect(superseded.statusCode).toBeGreaterThanOrEqual(400)
    expect(notYours.statusCode).toBe(403)

    const joined = await post(app, holder, '/v1/invitations/accept', { token: codes.reissued })

    expect(joined.statusCode, joined.body).toBe(200)

    // Spent: a second use is refused.
    const again = await post(app, holder, '/v1/invitations/accept', { token: codes.reissued })

    expect(again.statusCode).toBeGreaterThanOrEqual(400)

    // ------------------------------------------------------ the ticket offer
    const bought = await app.inject({
      method: 'POST',
      url: '/v1/orders',
      payload: {
        eventId: ids.publishedEvent.id,
        buyerEmail: HOLDER,
        buyerName: 'Priya Sharma',
        items: [{ ticketTypeId: ids.generalAdmission.id, quantity: 2 }],
      },
    })

    expect(bought.statusCode, bought.body).toBe(201)

    const tickets = bought.json().data.tickets

    claim(prisma, tickets, ids.attendee.id)

    const buyer = await signIn(app, HOLDER)
    const offer = (ticketId) =>
      post(app, buyer, `/v1/tickets/${ticketId}/transfers`, { toEmail: RECIPIENT })

    // Offered, then turned down.
    const first = await offer(tickets[0].id)

    expect(first.statusCode, first.body).toBe(201)
    codes.declined = first.json().data.delivery.invitationCode

    await sendMalformed(app, recipient, '/v1/ticket-transfers/decline', codes.declined)

    const declined = await post(app, recipient, '/v1/ticket-transfers/decline', {
      token: codes.declined,
    })

    expect(declined.statusCode, declined.body).toBe(200)

    // Offered again, refused to the wrong person, then taken.
    const second = await offer(tickets[0].id)

    expect(second.statusCode, second.body).toBe(201)
    codes.accepted = second.json().data.delivery.invitationCode

    await sendMalformed(app, recipient, '/v1/ticket-transfers/accept', codes.accepted)

    const wrongPerson = await post(app, owner, '/v1/ticket-transfers/accept', {
      token: codes.accepted,
    })

    expect(wrongPerson.statusCode).toBe(403)

    const accepted = await post(app, recipient, '/v1/ticket-transfers/accept', {
      token: codes.accepted,
    })

    expect(accepted.statusCode, accepted.body).toBe(200)

    // A declined code, sent again: refused.
    const stale = await post(app, recipient, '/v1/ticket-transfers/accept', {
      token: codes.declined,
    })

    expect(stale.statusCode).toBeGreaterThanOrEqual(400)

    // Offered and withdrawn by the sender.
    const third = await offer(tickets[1].id)

    expect(third.statusCode, third.body).toBe(201)
    codes.withdrawn = third.json().data.delivery.invitationCode

    const withdrawn = await post(app, buyer, `/v1/tickets/${tickets[1].id}/transfers/cancel`)

    expect(withdrawn.statusCode, withdrawn.body).toBe(200)

    await app.close()

    // The log was being written, and at the level where a careless body dump
    // would land: the issuing lines and the refusals are all there.
    const lines = capture.lines()

    expect(lines.some((line) => line.msg === 'issued a team invitation')).toBe(true)
    expect(lines.some((line) => line.msg === 'issued a ticket transfer invitation')).toBe(true)
    expect(lines.filter((line) => line.msg === 'request rejected').length).toBeGreaterThanOrEqual(
      malformed('x').length * 3,
    )
    expect(new Set(Object.values(codes)).size).toBe(5)

    const raw = capture.raw()

    for (const [name, code] of Object.entries(codes)) {
      expect(code, name).toEqual(expect.any(String))
      expectNoSecret(expect, raw, code)
    }

    // Nor the audit trail or the outbox, which outlive a log.
    for (const code of Object.values(codes)) {
      expectNoSecret(expect, JSON.stringify(prisma._store.auditLog), code)
      expectNoSecret(expect, JSON.stringify(prisma._store.notificationOutbox ?? []), code)
    }
  })
})

/** The platform administrator who invites organisers (fixtures: ADMIN, with a second factor). */
const PLATFORM_ADMIN = 'anil@desi-event.example'

/** Where organiser invitations are issued, listed, withdrawn and reissued. */
const ORGANIZER_INVITATIONS = '/v1/platform/organizer-invitations'

/** Where an organiser invitation's code is spent. */
const ORGANIZER_ACCEPT = '/v1/organizer-invitations/accept'

/**
 * Sign the platform administrator in with a fresh second factor, as issuing
 * and reissuing need.
 *
 * @param {object} app The application.
 * @returns {Promise<{token: string, headers: object}>} The session.
 */
async function platformAdmin(app) {
  const token = await signIn(app, PLATFORM_ADMIN)
  const headers = bearer(token)

  await stepUp(app, PLATFORM_ADMIN, headers)

  return { token, headers }
}

describe('organiser invitation codes and the logs', () => {
  it('writes no organiser invitation code, or its digest, to any log line, response or record', async () => {
    const capture = captureStream()
    const logger = createLogger({ name: 'api', level: 'debug', destination: capture })
    const { app, prisma } = await createTestApp({ logger })
    const admin = await platformAdmin(app)

    /** @type {Record<string, string>} */
    const codes = {}

    // Issued, with a note only the recipient should read.
    const issued = await post(app, admin.token, ORGANIZER_INVITATIONS, {
      email: HOLDER,
      organizationName: 'Kathiawar Folk Nights',
      note: 'A private word for the recipient.',
    })

    expect(issued.statusCode, issued.body).toBe(201)
    codes.issued = issued.json().data.delivery.invitationCode

    // The shared queue lists it without the code or anything derived from it.
    const listed = await app.inject({
      method: 'GET',
      url: ORGANIZER_INVITATIONS,
      headers: admin.headers,
    })

    expect(listed.statusCode, listed.body).toBe(200)
    expectNoSecret(expect, listed.body, codes.issued)
    expectNoSecret(expect, listed.body, hashToken(codes.issued))
    expect(listed.body).not.toContain('tokenHash')

    // Reissued: the old code dies, a new one is shown once.
    const reissued = await post(
      app,
      admin.token,
      `${ORGANIZER_INVITATIONS}/${issued.json().data.id}/reissue`,
    )

    expect(reissued.statusCode, reissued.body).toBe(201)
    codes.reissued = reissued.json().data.delivery.invitationCode
    expectNoSecret(expect, reissued.body, codes.issued)

    const holder = await signIn(app, HOLDER)
    const recipient = await signIn(app, RECIPIENT)

    await sendMalformed(app, holder, ORGANIZER_ACCEPT, codes.reissued)

    // The superseded code, and the live one from somebody it was not for.
    const superseded = await post(app, holder, ORGANIZER_ACCEPT, { token: codes.issued })
    const notYours = await post(app, recipient, ORGANIZER_ACCEPT, { token: codes.reissued })

    expect(superseded.statusCode).toBe(403)
    expect(notYours.statusCode).toBe(403)

    const accepted = await post(app, holder, ORGANIZER_ACCEPT, { token: codes.reissued })

    expect(accepted.statusCode, accepted.body).toBe(200)
    expectNoSecret(expect, accepted.body, codes.reissued)

    // Spent: a second use is refused.
    const again = await post(app, holder, ORGANIZER_ACCEPT, { token: codes.reissued })

    expect(again.statusCode).toBe(403)

    // Issued to somebody else and withdrawn: the withdrawal answers without it,
    // and the code is dead.
    const another = await post(app, admin.token, ORGANIZER_INVITATIONS, {
      email: RECIPIENT,
      organizationName: 'Dhol Collective',
    })

    expect(another.statusCode, another.body).toBe(201)
    codes.withdrawn = another.json().data.delivery.invitationCode

    const revoked = await post(
      app,
      admin.token,
      `${ORGANIZER_INVITATIONS}/${another.json().data.id}/revoke`,
    )

    expect(revoked.statusCode, revoked.body).toBe(200)
    expectNoSecret(expect, revoked.body, codes.withdrawn)
    expectNoSecret(expect, revoked.body, hashToken(codes.withdrawn))

    const dead = await post(app, recipient, ORGANIZER_ACCEPT, { token: codes.withdrawn })

    expect(dead.statusCode).toBe(403)

    const listedAfter = await app.inject({
      method: 'GET',
      url: `${ORGANIZER_INVITATIONS}?status=REVOKED`,
      headers: admin.headers,
    })

    expect(listedAfter.statusCode, listedAfter.body).toBe(200)

    await app.close()

    const lines = capture.lines()

    // The log was being written, at the level a careless body dump would use.
    expect(lines.some((line) => line.msg === 'issued an organiser invitation')).toBe(true)
    expect(lines.some((line) => line.msg === 'accepted an organiser invitation')).toBe(true)
    expect(lines.filter((line) => line.msg === 'request rejected').length).toBeGreaterThanOrEqual(
      malformed('x').length,
    )
    expect(new Set(Object.values(codes)).size).toBe(3)

    const raw = capture.raw()

    expectNoSecret(expect, raw, 'A private word for the recipient.')

    for (const [name, code] of Object.entries(codes)) {
      expect(code, name).toEqual(expect.any(String))
      expectNoSecret(expect, raw, code)
      expectNoSecret(expect, raw, hashToken(code))
      expectNoSecret(expect, listedAfter.body, code)
      // Nor the audit trail or the outbox, which outlive a log.
      expectNoSecret(expect, JSON.stringify(prisma._store.auditLog), code)
      expectNoSecret(expect, JSON.stringify(prisma._store.notificationOutbox ?? []), code)
    }
  })

  it('logs no code when the mail server refuses one, issued or reissued', async () => {
    const capture = captureStream()
    const logger = createLogger({ name: 'api', level: 'debug', destination: capture })
    /** @type {string[]} */
    const handedOver = []
    let refuse = false
    const world = await makeWorld()
    const { app, prisma } = await createTestApp({
      seed: world.seed,
      ids: world.ids,
      logger,
      // EMAIL mode: the code goes to the mail server and to nobody else. The
      // server refuses with a message that quotes the letter, as a real one
      // may, so a log of the error would carry the code.
      deliver: async (message) => {
        handedOver.push(message.token)

        if (refuse) {
          throw Object.assign(new Error(`550 rejected: ${message.token}`), {
            code: 'EENVELOPE',
            response: `550 5.7.1 message refused: ${message.token}`,
          })
        }
      },
    })
    const admin = await platformAdmin(app)

    const sent = await post(app, admin.token, ORGANIZER_INVITATIONS, {
      email: HOLDER,
      organizationName: 'Kathiawar Folk Nights',
    })

    expect(sent.statusCode, sent.body).toBe(201)
    expect(sent.json().data.delivery).toEqual({ mode: 'EMAIL', invitationCode: null })

    refuse = true

    const failedReissue = await post(
      app,
      admin.token,
      `${ORGANIZER_INVITATIONS}/${sent.json().data.id}/reissue`,
    )
    const failedIssue = await post(app, admin.token, ORGANIZER_INVITATIONS, {
      email: RECIPIENT,
      organizationName: 'Dhol Collective',
    })

    expect(failedReissue.statusCode).toBe(503)
    expect(failedIssue.statusCode).toBe(503)

    await app.close()

    // Three codes went to the mail server; two were refused and withdrawn.
    expect(handedOver).toHaveLength(3)

    const raw = capture.raw()

    expect(raw).toContain('a code could not be emailed')

    for (const code of handedOver) {
      expectNoSecret(expect, raw, code)
      expectNoSecret(expect, raw, hashToken(code))
      expectNoSecret(expect, sent.body + failedReissue.body + failedIssue.body, code)
      expectNoSecret(expect, JSON.stringify(prisma._store.auditLog), code)
      expectNoSecret(expect, JSON.stringify(prisma._store.notificationOutbox ?? []), code)
    }
  })
})

describe('a visit and the logs', () => {
  it('logs no address, browser, referring site, visitor code or destination, counted or not', async () => {
    resetTrafficMemory()

    const capture = captureStream()
    const logger = createLogger({ name: 'api', level: 'debug', destination: capture })
    const { app, prisma, ids } = await createTestApp({ logger })
    const event = prisma._store.event.find((row) => row.id === ids.publishedEvent.id)
    const agent = 'Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0 DistinctiveVisitorAgent/7'
    const destination = 'https://rangoli.example/a-distinctive-destination'

    // The organiser's website, switched on by an administrator.
    Object.assign(event, {
      websiteUrl: destination,
      websiteRedirectEnabled: true,
      websiteDecidedUrl: destination,
      websiteDecisionPending: false,
      websiteSubmittedAt: null,
      websiteRedirectChangedAt: new Date('2026-09-30T10:00:00.000Z'),
      websiteRedirectChangedById: ids.platformAdministrator.id,
      websiteRedirectReason: 'Checked: the organiser’s own site.',
    })

    const send = (url, payload, address) =>
      app.inject({
        method: 'POST',
        url,
        headers: {
          'user-agent': agent,
          'content-type': 'application/json',
          'x-desi-client-address': address,
        },
        payload,
      })
    const view = {
      eventId: event.id,
      kind: 'PAGE_VIEW',
      placement: 'EVENT_PAGE',
      referrer: 'news.distinctive-referrer.example',
    }

    // Counted: a page view and a visit through the website link.
    expect((await send('/v1/traffic/beacons', view, '198.51.100.31')).statusCode).toBe(202)
    expect(
      (
        await send(
          '/v1/traffic/website-visits',
          { slug: event.slug, counted: true },
          '198.51.100.32',
        )
      ).statusCode,
    ).toBe(200)

    const stored = [...prisma._store.trafficEvent]

    expect(stored).toHaveLength(2)

    // Then the store fails, and both still answer.
    prisma.trafficEvent.createMany = async () => {
      throw Object.assign(new Error('connection reset'), { code: 'P1017' })
    }

    expect((await send('/v1/traffic/beacons', view, '198.51.100.33')).statusCode).toBe(202)
    expect(
      (
        await send(
          '/v1/traffic/website-visits',
          { slug: event.slug, counted: true },
          '198.51.100.34',
        )
      ).statusCode,
    ).toBe(200)

    await app.close()

    const raw = capture.raw()

    // The failures were logged, so the absences below are about what was said.
    expect(raw).toContain('traffic beacon not counted')
    expect(raw).toContain('website visit not counted')

    for (const needle of [
      '198.51.100.31',
      '198.51.100.32',
      '198.51.100.33',
      '198.51.100.34',
      'DistinctiveVisitorAgent',
      'distinctive-referrer',
      'a-distinctive-destination',
      ...stored.flatMap((row) => [row.visitorHash, row.dedupeKey].filter(Boolean)),
    ]) {
      expectNoSecret(expect, raw, needle)
    }
  })
})

describe('a referral code and the logs (SPEC3 §13)', () => {
  /** The buyer who quotes and orders with the code. */
  const BUYER = 'priya@example.com'

  it('logs no code text, no label and no PostgreSQL detail: a code made, a quote, an order, and a use the database refuses', async () => {
    const capture = captureStream()
    const logger = createLogger({ name: 'api', level: 'debug', destination: capture })
    const { app, prisma, ids } = await createTestApp({ logger })
    const admin = await platformAdmin(app)
    const label = 'A distinctive label kept out of the logs'

    // ------------------------------------------------------------ the codes
    const typed = generatedReferralText()
    const made = await app.inject({
      method: 'POST',
      url: '/v1/platform/referral-codes',
      headers: admin.headers,
      payload: { referralCode: typed, label, scope: 'ALL_EVENTS', maxUses: 3 },
    })

    expect(made.statusCode, made.body).toBe(201)
    expect(made.json().data.referralCode).toBe(typed)

    const drawn = await app.inject({
      method: 'POST',
      url: '/v1/platform/referral-codes',
      headers: admin.headers,
      payload: { generate: true, scope: 'ALL_EVENTS' },
    })

    expect(drawn.statusCode, drawn.body).toBe(201)

    const generated = drawn.json().data.referralCode
    const row = prisma._store.referralCode.find((candidate) => candidate.code === typed)

    // ------------------------------------------------- a quote and an order
    const buyer = bearer(await signIn(app, BUYER))
    const basket = {
      eventId: ids.publishedEvent.id,
      items: [{ ticketTypeId: ids.generalAdmission.id, quantity: 1 }],
    }
    const quoted = await app.inject({
      method: 'POST',
      url: '/v1/orders/quote',
      headers: buyer,
      // As a buyer types it: lower case, with spaces around it.
      payload: { ...basket, referralCode: ` ${typed.toLowerCase()} ` },
    })

    expect(quoted.statusCode, quoted.body).toBe(200)
    expect(quoted.json().data.referral).toEqual({ applied: true, reason: null })

    const order = (referralCode) =>
      app.inject({
        method: 'POST',
        url: '/v1/orders',
        headers: buyer,
        payload: { ...basket, buyerEmail: BUYER, buyerName: 'Priya Sharma', referralCode },
      })
    const placed = await order(typed)

    expect(placed.statusCode, placed.body).toBe(201)
    expect(row.useCount).toBe(1)

    // ------------------------------------- a use the database refuses (CHECK)
    // The race the code's row lock exists to stop, forced: `UPDATE
    // "ReferralCode" SET "maxUses" = "useCount"` lands after the checkout's
    // locked read of the code and before its use, so only the database's
    // `referral_code_use_within_limit` stands in the way. The stub reports the
    // refusal as the pg adapter does; PostgreSQL also puts the refused row in
    // `detail` ("Failing row contains (…)"), the code's text and label with it,
    // so that is added here exactly as the adapter carries it.
    const findUnique = prisma.referralCode.findUnique
    let racing = true

    prisma.referralCode.findUnique = async (args) => {
      const found = await findUnique(args)

      if (!racing || args?.where?.id !== row.id || !found) return found

      racing = false

      const copy = { ...found }

      row.maxUses = row.useCount

      return copy
    }

    const execute = prisma.$executeRaw
    /** @type {Error|null} */
    let refused = null

    prisma.$executeRaw = async (strings, ...values) => {
      try {
        return await execute(strings, ...values)
      } catch (error) {
        const cause = error?.meta?.driverAdapterError?.cause

        if (cause && /referral_code_use_within_limit/u.test(cause.originalMessage ?? '')) {
          cause.detail = `Failing row contains (${row.id}, ${row.code}, ${row.label}, ${row.scope}, null, ${row.maxUses}, ${row.useCount + 1}, t).`
          error.cause = { ...cause }
          refused = error
        }

        throw error
      }
    }

    let raced

    try {
      raced = await order(typed)
    } finally {
      prisma.referralCode.findUnique = findUnique
      prisma.$executeRaw = execute
    }

    // The refusal the buyer reads, and nothing the database said.
    expect(refused, 'the database refused the use').not.toBeNull()
    expect(raced.statusCode, raced.body).toBe(409)
    expect(raced.json().error.code).toBe('REFERRAL_NOT_ACCEPTED')
    expect(raced.body).not.toMatch(/referral_code_use_within_limit|23514|Failing row|SQL/u)
    expectNoSecret(expect, raced.body, typed)
    // Rolled back: still the one use.
    expect(row.useCount).toBe(1)

    // Were that error ever logged whole, the serializer drops its detail.
    app.log.error({ err: refused }, 'a referral use the database refused')

    await app.close()

    // ------------------------------------------------------------- the logs
    const raw = capture.raw()
    const lines = capture.lines()

    // The log was being written, about these requests.
    expect(lines.some((line) => line.msg === 'referral code created')).toBe(true)
    expect(
      lines.some(
        (line) => line.msg === 'request rejected' && line.code === 'REFERRAL_NOT_ACCEPTED',
      ),
    ).toBe(true)
    expect(raw).toContain('referral_code_use_within_limit')

    for (const secret of [typed, typed.toLowerCase(), generated, label]) {
      expectNoSecret(expect, raw, secret)
    }

    expect(raw).not.toMatch(/Failing row/u)
  })

  it('logs no refused code: one nobody made, one switched off and one for another event, as typed, lower-cased or padded, at the quote and at the charge', async () => {
    const capture = captureStream()
    const logger = createLogger({ name: 'api', level: 'debug', destination: capture })
    const { app, ids } = await createTestApp({
      logger,
      rateLimit: {
        global: { max: 10_000, timeWindow: '1 minute' },
        // Eighteen wrong codes from one account, past the budget's ten: the
        // budget has its own tests, and here every refusal must be answered.
        referralAttempt: {
          actorMax: 100,
          addressMax: 100,
          sharedMax: 1_000,
          timeWindow: '10 minutes',
        },
      },
    })
    const admin = await platformAdmin(app)

    /**
     * @param {object} payload The administrator's form.
     * @returns {Promise<object>} The code made.
     */
    const make = async (payload) => {
      const made = await app.inject({
        method: 'POST',
        url: '/v1/platform/referral-codes',
        headers: admin.headers,
        payload,
      })

      expect(made.statusCode, made.body).toBe(201)

      return made.json().data
    }

    // A refused code is the text most worth keeping out of a log: a guesser's
    // near miss, or a real code that was switched off or names other events.
    const unknown = generatedReferralText()
    const off = generatedReferralText()
    const elsewhere = generatedReferralText()
    const offCode = await make({ referralCode: off, scope: 'ALL_EVENTS' })
    const switched = await app.inject({
      method: 'POST',
      url: `/v1/platform/referral-codes/${offCode.id}/switch-off`,
      headers: admin.headers,
      payload: {},
    })

    expect(switched.statusCode, switched.body).toBe(200)

    await make({
      referralCode: elsewhere,
      scope: 'SELECTED_EVENTS',
      eventIds: [ids.onlineEvent.id],
    })

    const buyer = bearer(await signIn(app, BUYER))
    const basket = {
      eventId: ids.publishedEvent.id,
      items: [{ ticketTypeId: ids.generalAdmission.id, quantity: 1 }],
    }
    let refusals = 0

    for (const text of [unknown, off, elsewhere]) {
      for (const referralCode of [text, text.toLowerCase(), `  ${text.toLowerCase()} `]) {
        const quoted = await app.inject({
          method: 'POST',
          url: '/v1/orders/quote',
          headers: buyer,
          payload: { ...basket, referralCode },
        })

        expect(quoted.statusCode, quoted.body).toBe(200)
        expect(quoted.json().data.referral.reason).toBe('NOT_ACCEPTED')

        const charged = await app.inject({
          method: 'POST',
          url: '/v1/orders',
          headers: buyer,
          payload: { ...basket, buyerEmail: BUYER, buyerName: 'Priya Sharma', referralCode },
        })

        expect(charged.statusCode, charged.body).toBe(409)
        expect(charged.json().error.code).toBe('REFERRAL_NOT_ACCEPTED')
        refusals += 1
      }
    }

    await app.close()

    const raw = capture.raw()

    // The log was being written about these refusals, one line each.
    expect(
      capture
        .lines()
        .filter((line) => line.msg === 'request rejected' && line.code === 'REFERRAL_NOT_ACCEPTED'),
    ).toHaveLength(refusals)

    for (const text of [unknown, off, elsewhere]) {
      expectNoSecret(expect, raw, text)
      expectNoSecret(expect, raw, text.toLowerCase())
    }
  })
})

describe('a referral code’s text outside its own row (SPEC3 §8.3)', () => {
  const ADMIN = 'anil@desi-event.example'
  const BUYER = 'priya@example.com'
  const OWNER = 'owner@rangoli.example'

  /**
   * Every table of the stub but `referralCode` itself, serialised.
   *
   * @param {object} prisma The stub.
   * @returns {Array<Array<string>>} Each table's name and its rows as lower-case JSON, in pairs.
   */
  function otherTables(prisma) {
    return Object.entries(prisma._store)
      .filter(([table]) => table !== 'referralCode')
      .map(([table, rows]) => [
        table,
        JSON.stringify(rows, (key, value) =>
          typeof value === 'bigint' ? value.toString() : value,
        ).toLowerCase(),
      ])
  }

  it('keeps the text and the label in the code’s own row: no audit row, queued notice, order, ticket or log line holds either after a card order, a pay-at-the-venue booking and the event’s cancellation', async () => {
    const capture = captureStream()
    const logger = createLogger({ name: 'api', level: 'debug', destination: capture })
    const { app, prisma, ids } = await createTestApp({ logger })
    const admin = bearer(await signIn(app, ADMIN))

    await stepUp(app, ADMIN, admin)

    const eventId = ids.publishedEvent.id
    const venue = await app.inject({
      method: 'POST',
      url: `/v1/platform/events/${eventId}/venue-payment`,
      headers: admin,
      payload: {
        enabled: true,
        limit: 50,
        seen: { enabled: false, limit: null },
        reason: 'Paying at the door for this test.',
      },
    })

    expect(venue.statusCode, venue.body).toBe(200)

    const typed = generatedReferralText()
    const label = 'A distinctive label for no table but its own'
    const made = await app.inject({
      method: 'POST',
      url: '/v1/platform/referral-codes',
      headers: admin,
      payload: { referralCode: typed, label, scope: 'ALL_EVENTS' },
    })

    expect(made.statusCode, made.body).toBe(201)

    const codeId = made.json().data.id
    const buyer = bearer(await signIn(app, BUYER))
    const basket = { eventId, items: [{ ticketTypeId: ids.generalAdmission.id, quantity: 1 }] }
    const post = (url, payload) => app.inject({ method: 'POST', url, headers: buyer, payload })
    const quoted = await post('/v1/orders/quote', {
      ...basket,
      referralCode: ` ${typed.toLowerCase()} `,
    })
    const card = await post('/v1/orders', {
      ...basket,
      buyerEmail: BUYER,
      buyerName: 'Priya Sharma',
      referralCode: typed.toLowerCase(),
    })
    const atVenue = await post('/v1/orders', {
      ...basket,
      buyerEmail: BUYER,
      buyerName: 'Priya Sharma',
      paymentMethod: 'AT_VENUE',
      referralCode: ` ${typed} `,
    })

    expect(quoted.statusCode, quoted.body).toBe(200)
    expect(quoted.json().data.referral).toEqual({ applied: true, reason: null })
    expect(card.statusCode, card.body).toBe(201)
    expect(atVenue.statusCode, atVenue.body).toBe(201)
    // Both orders named the code, by its id.
    expect(prisma._store.order.filter((order) => order.referralCodeId === codeId)).toHaveLength(2)

    // The owner cancels the event: a refund for the card order, a notice to
    // each buyer, and the code's uses given back.
    const owner = bearer(await signIn(app, OWNER))

    await stepUp(app, OWNER, owner)

    const queuedBefore = prisma._store.notificationOutbox.length
    const cancelled = await app.inject({
      method: 'POST',
      url: `/v1/events/${eventId}/cancel`,
      headers: owner,
      payload: { reasonCode: 'VENUE_UNAVAILABLE', reason: 'The hall flooded.' },
    })

    expect(cancelled.statusCode, cancelled.body).toBe(200)

    await app.close()

    // The paths ran: the orders were paid and audited, and notices queued.
    const actions = prisma._store.auditLog.map((row) => row.action)

    expect(actions.filter((action) => action === 'order.paid').length).toBeGreaterThanOrEqual(2)
    expect(prisma._store.notificationOutbox.length).toBeGreaterThan(queuedBefore)

    // The text, in either case, and the label: in the code's own row, and in
    // no other table — audit rows, queued notices, orders, tickets, refunds
    // and whatever is added later alike.
    const needles = [typed.toLowerCase(), label.toLowerCase()]
    /** @type {string[]} */
    const holders = []

    for (const [table, text] of otherTables(prisma)) {
      if (needles.some((needle) => text.includes(needle))) holders.push(table)
    }

    expect(holders).toEqual([])
    expect(prisma._store.referralCode.some((row) => row.code === typed)).toBe(true)

    // Nor any log line.
    const raw = capture.raw()

    for (const secret of [typed, typed.toLowerCase(), label]) {
      expectNoSecret(expect, raw, secret)
    }
  })

  it('finds the text wherever it is put, in either case, and leaves the code’s own row out', () => {
    const typed = generatedReferralText()
    const store = {
      referralCode: [{ id: 'r1', code: typed }],
      auditLog: [{ id: 'a1', metadata: { waiver: typed.toLowerCase() } }],
      notificationOutbox: [{ id: 'n1', payload: { size: 10n } }],
    }
    const found = otherTables({ _store: store }).filter(([, text]) =>
      text.includes(typed.toLowerCase()),
    )

    expect(found.map(([table]) => table)).toEqual(['auditLog'])
  })
})
