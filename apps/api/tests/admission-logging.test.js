/**
 * What the logs hold after a pass has been taken out and used at the door.
 *
 * The same stub-database application every route suite builds, but with a real
 * `@desi-event/logger` instance behind it at `debug`, writing into memory. A
 * holder takes out their pass, a scanner scoped to the event previews it and
 * admits it, previews the second ticket by its printed code, is refused twice
 * and sends one malformed body. Then every line those requests produced is
 * searched for the three secrets a door handles: the credential, the printed
 * code and the preview reference.
 *
 * Nothing in the product logs a request body today, so a clean log proves only
 * that nobody does. For the credential and the preview reference, the redaction
 * set in `@desi-event/logger` is the second line on the day somebody does;
 * `packages/logger/src/redaction.test.js` pins those keys. The printed code has
 * no key there (a root-level `code` would censor the error handler's own
 * `code`), so for it this test is the only line.
 */

import { createLogger } from '@desi-event/logger'
import { describe, expect, it } from 'vitest'

import { credentialDigest } from '../src/lib/ticket-credentials.js'

import { bearer, claim, createTestApp, signIn } from './helpers/app.js'

const PREVIEW_URL = '/v1/tickets/admission/preview'
const CHECK_IN_URL = '/v1/tickets/check-in'

/** The buyer, who holds both tickets once the purchase is claimed. */
const HOLDER = 'priya@example.com'

/** Door staff, scoped by the fixture world to the published event only. */
const DOOR = 'door@rangoli.example'

/** A printed code in the right shape that names no ticket. */
const UNKNOWN_CODE = 'DET-NOTAREALCODE'

/**
 * An in-memory pino destination: anything with a `write` method will do.
 *
 * @returns {{write: function(string): void, raw: function(): string, lines: function(): object[]}} The stream and its readers.
 */
function captureStream() {
  /** @type {string[]} */
  const chunks = []

  return {
    write(chunk) {
      chunks.push(chunk)
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
 * Send a request as the given account.
 *
 * @param {object} app The application.
 * @param {string} token A bearer token.
 * @param {string} method The HTTP method.
 * @param {string} url The path.
 * @param {object} [payload] The request body.
 * @returns {Promise<object>} The injected response.
 */
function send(app, token, method, url, payload) {
  return app.inject({ method, url, headers: bearer(token), payload })
}

describe('the door and the logs', () => {
  it('writes no credential, printed code or preview reference to any log line', async () => {
    const capture = captureStream()
    const logger = createLogger({ name: 'api', level: 'debug', destination: capture })
    const { app, prisma, ids } = await createTestApp({ logger })

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

    // The holder takes their pass out, which is the one response it lives in.
    const pass = await send(
      app,
      await signIn(app, HOLDER),
      'GET',
      `/v1/tickets/${tickets[0].id}/pass`,
    )

    expect(pass.statusCode, pass.body).toBe(200)

    const { credential } = pass.json().data

    expect(credential).toEqual(expect.any(String))

    const door = await signIn(app, DOOR)

    const scanned = await send(app, door, 'POST', PREVIEW_URL, { credential })

    expect(scanned.statusCode, scanned.body).toBe(200)
    expect(scanned.json().data.outcome).toBe('ADMISSIBLE')

    const scannedReference = scanned.json().data.previewReference

    const admitted = await send(app, door, 'POST', CHECK_IN_URL, {
      credential,
      previewReference: scannedReference,
    })

    expect(admitted.statusCode, admitted.body).toBe(200)
    expect(admitted.json().data.outcome).toBe('ADMITTED')

    const typed = await send(app, door, 'POST', PREVIEW_URL, { code: tickets[1].code })

    expect(typed.statusCode, typed.body).toBe(200)
    expect(typed.json().data.outcome).toBe('ADMISSIBLE')

    const typedReference = typed.json().data.previewReference

    // Refused: the pass is real, the door is at another event.
    const wrongEvent = await send(app, door, 'POST', PREVIEW_URL, {
      credential,
      expectedEventId: ids.draftEvent.id,
    })

    expect(wrongEvent.statusCode, wrongEvent.body).toBe(200)
    expect(wrongEvent.json().data).toMatchObject({ outcome: 'REFUSED', refusal: 'WRONG_EVENT' })

    // Refused: a code that names nothing, which is the one path in the preview
    // that writes a log line of its own.
    const unknown = await send(app, door, 'POST', PREVIEW_URL, { code: UNKNOWN_CODE })

    expect(unknown.statusCode, unknown.body).toBe(404)

    // Malformed: the method is the server's to derive, so a body naming one is
    // refused before anything is looked up.
    const malformed = await send(app, door, 'POST', PREVIEW_URL, {
      credential,
      method: 'QR_SCAN',
    })

    expect(malformed.statusCode, malformed.body).toBe(400)

    // Every secret was real and was sent, so its absence below means something.
    expect(scannedReference).toEqual(expect.any(String))
    expect(typedReference).toEqual(expect.any(String))

    const secrets = {
      credential,
      // What a handler that logged a whole ticket row would write.
      credentialDigest: credentialDigest(credential),
      firstPrintedCode: tickets[0].code,
      secondPrintedCode: tickets[1].code,
      unknownCode: UNKNOWN_CODE,
      scannedReference,
      typedReference,
    }

    // A refusal and a validation error say why, not what was presented.
    for (const response of [wrongEvent, unknown, malformed]) {
      expect(response.body).not.toContain(credential)
    }

    expect(unknown.body).not.toContain(UNKNOWN_CODE)

    await app.close()

    // Not vacuous: the requests reached the capture, the door's own lines with
    // them, so a secret in any of them would have been here to find.
    const lines = capture.lines()
    const completed = lines.filter((line) => line.msg === 'request completed')

    expect(completed.map((line) => line.res.statusCode)).toEqual(
      expect.arrayContaining([200, 400, 404]),
    )
    expect(lines.filter((line) => line.req?.url === PREVIEW_URL).length).toBeGreaterThanOrEqual(5)
    expect(lines.some((line) => line.req?.url === CHECK_IN_URL)).toBe(true)
    expect(lines.some((line) => line.req?.url === `/v1/tickets/${tickets[0].id}/pass`)).toBe(true)
    expect(lines.some((line) => line.msg === 'ticket admitted')).toBe(true)
    expect(lines.some((line) => line.msg === 'admission preview: nothing resolved')).toBe(true)
    expect(lines.some((line) => line.msg === 'request rejected')).toBe(true)

    const raw = capture.raw()

    for (const [name, value] of Object.entries(secrets)) {
      expect(raw, `${name} reached a log line`).not.toContain(value)
    }

    // The claims half of a reference names a ticket, a scanner and an instant
    // without its MAC, so it is searched for on its own as well.
    expect(raw).not.toContain(scannedReference.split('.')[0])
    expect(raw).not.toContain(typedReference.split('.')[0])
  })
})
