/**
 * The needle scan that three security assertions depend on.
 *
 * `reconciliation.test.js`, `analytics.test.js` and `refunds.test.js` all prove
 * the same thing about different payloads: no buyer identity, no card data, no
 * provider key. They prove it by searching the serialised body for short
 * needles, and this file is the test of the search itself.
 *
 * It exists because the search was wrong once, in a way that took a CI failure
 * to notice. A cuid is twenty-five random base-36 characters, so it contains any
 * three-letter needle roughly one time in two thousand — and on CI run
 * `35227997764` it contained `cvc`:
 *
 * ```
 * "organizationid":"caqg3dml7cvcjm00000000000"
 * ```
 *
 * Masking identifiers fixes that, and the interesting half of this file is the
 * other one: proving the mask did not also blind the scan. A fix that stopped
 * the false positive by weakening the assertion would be worse than the flake.
 */

import { createHash, randomBytes } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { bearer, createTestApp, signIn, stepUp } from './helpers/app.js'
import { generatedReferralText } from './helpers/fee-orders.js'
import {
  expectNoKeys,
  expectNoNeedles,
  expectNoSecret,
  keysIn,
  valuesOf,
  withoutIdentifiers,
} from './helpers/payloads.js'

/** The needles the reconciliation detail route is scanned for. */
const NEEDLES = Object.freeze(['priya', '4242', 'receipt_email', 'payment_method', 'cvc'])

/**
 * A body shaped like the route's, with whatever is passed folded in.
 *
 * @param {object} extra Fields to add.
 * @returns {string} The serialised payload.
 */
function body(extra = {}) {
  return JSON.stringify({
    data: {
      id: 'cbquwdxdh005pt00000000000',
      organizationId: 'caqg3dml7cvcjm00000000000',
      orderReference: 'DE-RECON1',
      ...extra,
    },
  })
}

/**
 * Whether the scan would fail on this body.
 *
 * @param {string} payload The serialised payload.
 * @returns {boolean} True when a needle survives the mask.
 */
function caught(payload) {
  try {
    expectNoNeedles(expect, payload, NEEDLES)

    return false
  } catch {
    return true
  }
}

describe('withoutIdentifiers', () => {
  it('removes the identifier that broke CI run 35227997764', () => {
    // The literal id from the failure. `caqg3dml7cvcjm…` contains `cvc`.
    expect(body().toLowerCase()).toContain('cvc')
    expect(withoutIdentifiers(body()).toLowerCase()).not.toContain('cvc')
  })

  it('removes any identifier-shaped run, not just that one', () => {
    for (const id of [
      'cbquwdxdh005pt00000000000',
      'caqg3dml7cvcjm00000000000',
      'ck1234567890abcdefghijklm',
      'abcdefghij0123456789',
    ]) {
      expect(withoutIdentifiers(`"${id}"`)).toBe('""')
    }
  })

  it('leaves a short reference alone, because it is content', () => {
    // An order reference is meaningful and far below the twenty-character floor.
    expect(withoutIdentifiers('"DE-RECON1"')).toBe('"DE-RECON1"')
  })

  it('leaves an address alone — the thing the scan exists to find', () => {
    const address = 'priya@example.com'

    expect(withoutIdentifiers(`"${address}"`)).toContain(address)
  })
})

describe('expectNoNeedles', () => {
  it('passes a payload whose only match is a coincidence inside an identifier', () => {
    expect(caught(body())).toBe(false)
  })

  it.each([
    ['a provider key', { receipt_email: 'someone@example.test' }],
    ['a card fragment', { last4: '4242' }],
    ['a buyer name', { buyer: 'Priya Sharma' }],
    ['a literal cvc field', { cvc: '123' }],
    ['a payment method', { payment_method: 'pm_1' }],
  ])('still catches %s', (_label, leak) => {
    expect(caught(body(leak))).toBe(true)
  })

  it('catches a needle in a field name as readily as in a value', () => {
    expect(caught(body({ receipt_email: null }))).toBe(true)
  })

  it('names the needle it found, so a failure does not mean diffing two blobs', () => {
    let message = ''

    try {
      expectNoNeedles(expect, body({ last4: '4242' }), NEEDLES)
    } catch (error) {
      message = String(error.message)
    }

    expect(message).toContain('4242')
  })

  it('is case-insensitive in both directions', () => {
    expect(caught(body({ note: 'PRIYA' }))).toBe(true)
    expect(caught(body({ note: 'Receipt_Email' }))).toBe(true)
  })
})

/**
 * A fresh code of `length` lower-case letters and digits, made at run time.
 *
 * The shape `withoutIdentifiers` masks, which is the point: a show-once code
 * could come out looking exactly like this.
 *
 * @param {number} length How many characters.
 * @returns {string} The code.
 */
function lowerCaseCode(length) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'

  return [...randomBytes(length)].map((byte) => alphabet[byte % alphabet.length]).join('')
}

/**
 * Whether `expectNoSecret` would fail on this body, and with what message.
 *
 * @param {string|object} payload The payload.
 * @param {string} secret The secret.
 * @returns {{caught: boolean, message: string}} The outcome.
 */
function secretOutcome(payload, secret) {
  try {
    expectNoSecret(expect, payload, secret)

    return { caught: false, message: '' }
  } catch (error) {
    return { caught: true, message: String(error?.message ?? error) }
  }
}

describe('expectNoSecret', () => {
  it('is needed: a 24-character lower-case code is masked, so the needle scan misses it', () => {
    const code = lowerCaseCode(24)
    const leaked = body({ invitationCode: code })

    expect(withoutIdentifiers(leaked)).not.toContain(code)
    expect(() => expectNoNeedles(expect, leaked, [code])).not.toThrow()
  })

  it('catches that same code, which the needle scan let through', () => {
    const code = lowerCaseCode(24)

    expect(secretOutcome(body({ invitationCode: code }), code).caught).toBe(true)
  })

  it('catches a url-safe base64 code like the one a transfer offer returns', () => {
    const code = randomBytes(32).toString('base64url')

    expect(secretOutcome(body({ delivery: { invitationCode: code } }), code).caught).toBe(true)
    // Wherever it sits: in a field that is not called anything like a code.
    expect(secretOutcome(`request rejected ${code} for /v1/x`, code).caught).toBe(true)
  })

  it('never puts the secret in its failure message', () => {
    const code = randomBytes(32).toString('base64url')
    const { caught, message } = secretOutcome(body({ invitationCode: code }), code)

    expect(caught).toBe(true)
    expect(message).toContain('the payload carries the one-time secret')
    expect(message).not.toContain(code)
  })

  it('passes a body that carries only the code’s digest', () => {
    const code = randomBytes(32).toString('base64url')
    const digest = createHash('sha256').update(code).digest('hex')

    expect(secretOutcome(body({ tokenHash: digest }), code).caught).toBe(false)
  })

  it('is case-sensitive, because a code is', () => {
    const code = `${lowerCaseCode(12)}ABC${lowerCaseCode(12)}`

    expect(secretOutcome(body({ note: code.toLowerCase() }), code).caught).toBe(false)
    expect(secretOutcome(body({ note: code }), code).caught).toBe(true)
  })

  it('serialises an object body rather than reading "[object Object]"', () => {
    const code = lowerCaseCode(24)

    expect(secretOutcome({ data: { invitationCode: code } }, code).caught).toBe(true)
  })

  it('refuses an empty or missing secret, which every payload would pass', () => {
    expect(() => expectNoSecret(expect, body(), '')).toThrow(TypeError)
    expect(() => expectNoSecret(expect, body(), undefined)).toThrow(TypeError)
  })
})

describe('keysIn, expectNoKeys and valuesOf', () => {
  const payload = {
    data: {
      bookings: [{ orderReference: 'DE-A', tickets: [{ ticketId: 'x', referralCodeId: null }] }],
      fee: { percentageBps: 300 },
    },
  }

  it('finds a key at any depth, whatever its value, and says where', () => {
    expect([...keysIn(payload).get('referralCodeId')]).toEqual([
      'data.bookings[].tickets[].referralCodeId',
    ])
  })

  it('fails on a key that is there, naming where, and passes one that is not', () => {
    let named = null

    try {
      expectNoKeys(expect, payload, ['referralCodeId'])
    } catch (error) {
      named = error.actual
    }

    expect(named).toEqual(['referralCodeId at data.bookings[].tickets[].referralCodeId'])
    expect(() => expectNoKeys(expect, JSON.stringify(payload), ['referralCode'])).not.toThrow()
  })

  it('collects every value under a key', () => {
    expect(valuesOf(payload, 'fee')).toEqual([{ percentageBps: 300 }])
  })
})

/**
 * What buyers and the public are answered about booking fees, referral codes
 * and paying at the venue (SPEC3 §13, SPEC3-XI §13), driven through the API
 * on the stub with a referral code, a fee of the event's own and paying at the
 * venue switched on.
 */
describe('booking fees, referral codes and paying at the venue, read from the outside', () => {
  const ADMIN = 'anil@desi-event.example'
  const BUYER = 'priya@example.com'
  const OTHER_BUYER = 'rival@dhol.example'
  const OWNER = 'owner@rangoli.example'

  /** Why the administrator set the fee and the switch: shown to organisers, never to buyers. */
  const FEE_REASON = 'A distinctive fee reason for the organiser only.'
  const VENUE_REASON = 'A distinctive switch reason for the organiser only.'

  /** A label on the code: the administrators' own note. */
  const LABEL = 'A distinctive label for the administrators only'

  /**
   * Keys no public or buyer answer may carry: the terms' decisions and who
   * made them, the code's text, id and return, and who made anything. A
   * buyer's own order does say how many of its tickets are unpaid, and a
   * night has a label, so the code's label is looked for by its text.
   */
  const NEVER_OUTSIDE = [
    'paymentTerms',
    'feeSource',
    'feeSettingId',
    'venuePaymentEnabled',
    'venuePaymentLimit',
    'venuePaymentReason',
    'venuePaymentChangedById',
    'changedByName',
    'hasOrders',
    'referralCode',
    'referralCodeId',
    'referralUseReturnedAt',
    'referralUseReturnCause',
    'useReturned',
    'usesPlaced',
    'createdBy',
    'createdById',
    'updatedById',
    'setById',
    'recordedById',
    'cancelledById',
  ]

  /**
   * The world: the published event with a fee of its own and paying at the
   * venue on (both set through the administrators' routes, with reasons), a
   * typed referral code with a label, and the buyer's quote, card order and
   * pay-at-the-venue booking naming it, and another buyer's order.
   *
   * @returns {Promise<object>} The harness and what was answered.
   */
  async function world() {
    const { app, prisma, ids } = await createTestApp()
    const admin = bearer(await signIn(app, ADMIN))

    await stepUp(app, ADMIN, admin)

    const eventId = ids.publishedEvent.id
    const fee = await app.inject({
      method: 'POST',
      url: `/v1/platform/events/${eventId}/platform-fee`,
      headers: admin,
      payload: {
        source: 'EVENT',
        percentageBps: 250,
        flatCentsPerTicket: 75,
        reason: FEE_REASON,
        expectedSequence: 0,
      },
    })

    expect(fee.statusCode, fee.body).toBe(200)

    const venue = await app.inject({
      method: 'POST',
      url: `/v1/platform/events/${eventId}/venue-payment`,
      headers: admin,
      payload: {
        enabled: true,
        limit: 50,
        seen: { enabled: false, limit: null },
        reason: VENUE_REASON,
      },
    })

    expect(venue.statusCode, venue.body).toBe(200)

    const referralCode = generatedReferralText()
    const made = await app.inject({
      method: 'POST',
      url: '/v1/platform/referral-codes',
      headers: admin,
      payload: { referralCode, label: LABEL, scope: 'ALL_EVENTS' },
    })

    expect(made.statusCode, made.body).toBe(201)

    const basket = {
      eventId,
      items: [{ ticketTypeId: ids.generalAdmission.id, quantity: 1 }],
    }
    const buyer = bearer(await signIn(app, BUYER))
    const other = bearer(await signIn(app, OTHER_BUYER))
    const post = (url, headers, payload) => app.inject({ method: 'POST', url, headers, payload })
    const quote = await post('/v1/orders/quote', buyer, { ...basket, referralCode })
    const card = await post('/v1/orders', buyer, {
      ...basket,
      buyerEmail: BUYER,
      buyerName: 'Priya Sharma',
      referralCode,
    })
    const atVenue = await post('/v1/orders', buyer, {
      ...basket,
      buyerEmail: BUYER,
      buyerName: 'Priya Sharma',
      paymentMethod: 'AT_VENUE',
      referralCode,
    })
    const others = await post('/v1/orders', other, {
      ...basket,
      buyerEmail: OTHER_BUYER,
      buyerName: 'Rival Organiser',
    })

    for (const response of [quote, card, atVenue, others]) {
      expect(response.statusCode, response.body).toBeLessThan(300)
    }

    return { app, prisma, ids, admin, buyer, other, referralCode, quote, card, atVenue, others }
  }

  it('answers a public event and the listing with venuePayment { available } alone, the fee by its numbers, and no terms, decisions or reasons', async () => {
    const { app, prisma, ids, buyer, referralCode } = await world()
    const event = prisma._store.event.find((row) => row.id === ids.publishedEvent.id)

    // The terms are set: the payload is not passing on an empty event.
    expect(event.feeSource).toBe('EVENT')
    expect(event.venuePaymentEnabled).toBe(true)

    for (const headers of [{}, buyer]) {
      const detail = await app.inject({ method: 'GET', url: `/v1/events/${event.slug}`, headers })
      const listing = await app.inject({ method: 'GET', url: '/v1/events', headers })

      for (const response of [detail, listing]) {
        expect(response.statusCode, response.body).toBe(200)
        expectNoKeys(expect, response.body, NEVER_OUTSIDE)

        for (const secret of [FEE_REASON, VENUE_REASON, LABEL, referralCode]) {
          expectNoSecret(expect, response.body, secret)
        }
      }

      const { data } = detail.json()

      expect(data.venuePayment).toEqual({ available: true })

      for (const terms of data.feeTerms) {
        expect(Object.keys(terms).sort()).toEqual(['currency', 'flatCents', 'percentageBps'])
      }
    }

    await app.close()
  })

  it('never answers a buyer the code’s text, its id or its return, where the fee came from, or who made anything', async () => {
    const { app, buyer, referralCode, quote, card, atVenue } = await world()
    const references = [card.json().data.reference, atVenue.json().data.reference]
    const reads = [
      quote,
      card,
      atVenue,
      ...(await Promise.all(
        references.map((reference) =>
          app.inject({ method: 'GET', url: `/v1/orders/${reference}`, headers: buyer }),
        ),
      )),
      await app.inject({ method: 'GET', url: '/v1/orders', headers: buyer }),
      await app.inject({ method: 'GET', url: '/v1/tickets', headers: buyer }),
    ]

    for (const response of reads) {
      expect(response.statusCode, response.body).toBe(
        response === card || response === atVenue ? 201 : 200,
      )
      expectNoKeys(expect, response.body, NEVER_OUTSIDE)

      for (const secret of [referralCode, referralCode.toLowerCase(), LABEL, FEE_REASON]) {
        expectNoSecret(expect, response.body, secret)
      }

      // The fee by its numbers, never where they came from (A13).
      for (const fee of valuesOf(response.json(), 'fee')) {
        if (fee && typeof fee === 'object') expect(Object.keys(fee)).not.toContain('source')
      }
    }

    // What a buyer is told instead: that a code was applied.
    expect(quote.json().data.referral).toEqual({ applied: true, reason: null })
    expect(reads[3].json().data.referralApplied).toBe(true)

    await app.close()
  })

  it('never answers one buyer another buyer’s order, tickets or name', async () => {
    const { app, buyer, other, others } = await world()
    const theirs = others.json().data.reference

    const read = await app.inject({ method: 'GET', url: `/v1/orders/${theirs}`, headers: buyer })

    // Refused, and nothing of the order in the refusal.
    expect([403, 404]).toContain(read.statusCode)
    expect(read.body).not.toContain(theirs)
    expectNoNeedles(expect, read.body, [OTHER_BUYER, 'Rival Organiser'])

    for (const url of ['/v1/orders', '/v1/tickets']) {
      const mine = await app.inject({ method: 'GET', url, headers: buyer })

      expect(mine.statusCode).toBe(200)
      expect(mine.body).not.toContain(theirs)
      expectNoNeedles(expect, mine.body, [OTHER_BUYER, 'Rival Organiser'])
    }

    // And the other way round.
    const theirOrders = await app.inject({ method: 'GET', url: '/v1/orders', headers: other })

    expectNoNeedles(expect, theirOrders.body, [BUYER, 'Priya Sharma'])

    await app.close()
  })

  it('answers the Desi-Event team the unpaid bookings with no buyer or attendee name, and the organisation with them (SPEC3-XI §11.2)', async () => {
    const { app, ids, admin, referralCode } = await world()
    const url = `/v1/events/${ids.publishedEvent.id}/venue-bookings`
    const team = await app.inject({ method: 'GET', url, headers: admin })

    expect(team.statusCode, team.body).toBe(200)

    const bookings = team.json().data.bookings

    // There is a booking to read, so the nulls are not an empty list's.
    expect(bookings.length).toBeGreaterThan(0)
    expect(valuesOf(bookings, 'buyerName').every((name) => name === null)).toBe(true)
    expect(valuesOf(bookings, 'tickets').flat().length).toBeGreaterThan(0)
    expect(valuesOf(bookings, 'attendeeName').every((name) => name === null)).toBe(true)
    expectNoNeedles(expect, team.body, ['Priya Sharma', BUYER])

    const owner = bearer(await signIn(app, OWNER))

    await stepUp(app, OWNER, owner)

    const organisation = await app.inject({ method: 'GET', url, headers: owner })

    expect(organisation.statusCode, organisation.body).toBe(200)
    expect(valuesOf(organisation.json().data.bookings, 'buyerName')).toContain('Priya Sharma')

    // Neither reader is answered the code, its id or its return.
    for (const response of [team, organisation]) {
      expectNoKeys(expect, response.body, [
        'referralCode',
        'referralCodeId',
        'referralUseReturnedAt',
        'referralUseReturnCause',
        'buyerEmail',
        'email',
      ])
      expectNoSecret(expect, response.body, referralCode)
    }

    await app.close()
  })
})
