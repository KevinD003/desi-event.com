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

import { createLogger } from '@desi-event/logger'
import { describe, expect, it } from 'vitest'

import { bearer, claim, createTestApp, signIn } from './helpers/app.js'
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
