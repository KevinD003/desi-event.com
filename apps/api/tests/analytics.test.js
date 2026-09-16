/**
 * Organiser analytics, and the two questions it keeps apart.
 *
 * "May you see this organisation's numbers" and "may you see its money" are
 * different questions with different answers, and the second is not answered by
 * leaving a section out of the markup. The properties below are about what the
 * *payload* contains, because the payload is what a caller with `curl` gets.
 *
 * The other half is the export, which is the same data on its way into a
 * spreadsheet — so it is the same allow list, plus the rule that a cell
 * beginning `=` is text.
 *
 * @module @desi-event/api/tests/analytics
 */

import { describe, expect, it } from 'vitest'

import { ACCOUNTS, CREDIT, DEBIT } from '@desi-event/ledger'

import { bearer, createTestApp, signIn, stepUp } from './helpers/app.js'
import { LEDGER_ACCOUNTS, makeWorld } from './helpers/fixtures.js'
import { cuid } from './helpers/prisma-stub.js'

/** What the ledger says was taken. */
const COLLECTED_CENTS = 800_000

/** The platform fee inside it. */
const FEE_CENTS = 80_000

/** The organisation's owner: holds `finance:view`. */
const OWNER = 'owner@rangoli.example'

/** A VIEWER: holds `report:view` and nothing financial. */
const VIEWER = 'finance@rangoli.example'

/** Somebody else's owner. */
const OUTSIDER = 'rival@dhol.example'

/** An attendee, with no membership at all. */
const ATTENDEE = 'priya@example.com'

/**
 * The id of a ledger account by its code.
 *
 * @param {string} code The account code.
 * @returns {string} Its id.
 */
function accountId(code) {
  return LEDGER_ACCOUNTS.find((account) => account.code === code).id
}

/**
 * A world with one paid order, its ledger batch, and a hostile event title.
 *
 * The event is titled beginning with `=` on purpose: it is the organiser's own
 * text, it reaches the analytics breakdown by name, and the breakdown reaches a
 * spreadsheet. The order totals are deliberately absurd, so that any money
 * figure agreeing with them would be a figure read off the order rather than
 * out of the ledger.
 *
 * @returns {Promise<object>} The harness, plus its ids.
 */
async function worldWithSales() {
  const world = await makeWorld()
  const { seed, ids } = world

  const orderId = cuid()
  const orderItemId = cuid()
  const batchId = cuid()
  const paidAt = new Date('2026-09-01T10:00:00.000Z')

  ids.publishedEvent.title = '=HYPERLINK("http://attacker.example","Diwali Nights")'

  seed.order = [
    {
      id: orderId,
      reference: 'DE-ANALYT',
      eventId: ids.publishedEvent.id,
      eventSessionId: null,
      userId: ids.attendee.id,
      buyerEmail: 'priya@example.com',
      buyerName: 'Priya Sharma',
      status: 'PAID',
      currency: 'INR',
      subtotalCents: 240_000,
      feesCents: 0,
      taxCents: 0,
      discountCents: 0,
      // Nonsense on purpose: nothing monetary may agree with this.
      totalCents: 999_999_999,
      refundedCents: 0,
      refundPendingCents: 0,
      paidAt,
      createdAt: paidAt,
      updatedAt: paidAt,
    },
  ]

  seed.orderItem = [
    {
      id: orderItemId,
      orderId,
      ticketTypeId: ids.generalAdmission.id,
      eventSeatId: null,
      name: ids.generalAdmission.name,
      quantity: 3,
      unitPriceCents: 80_000,
      subtotalCents: 240_000,
      feesCents: 0,
      taxCents: 0,
      discountCents: 0,
      refundedQuantity: 1,
      refundedCents: 80_000,
      createdAt: paidAt,
      updatedAt: paidAt,
    },
  ]

  seed.ticket = [{ status: 'VALID' }, { status: 'CHECKED_IN' }, { status: 'REVOKED' }].map(
    (ticket, index) => ({
      id: cuid(),
      orderItemId,
      eventSeatId: null,
      serial: `ANL-${index}`,
      status: ticket.status,
      credentialHash: `hash-${index}`,
      credentialVersion: 1,
      issuedAt: paidAt,
      createdAt: paidAt,
      updatedAt: paidAt,
    }),
  )

  seed.checkIn = [
    {
      id: cuid(),
      ticketId: seed.ticket[1].id,
      eventSessionId: null,
      scannedById: ids.staff.id,
      deviceLabel: 'Gate A',
      result: 'ADMITTED',
      createdAt: paidAt,
    },
  ]

  seed.ledgerBatch = [
    {
      id: batchId,
      reference: 'OR-ANALYT',
      kind: 'ORDER_PAID',
      status: 'POSTED',
      currency: 'INR',
      debitCents: COLLECTED_CENTS,
      creditCents: COLLECTED_CENTS,
      sourceType: 'ORDER',
      sourceId: orderId,
      idempotencyKey: 'ORDER_PAID:ORDER:analyt:',
      orderId,
      paymentId: null,
      refundId: null,
      disputeId: null,
      transferId: null,
      payoutId: null,
      compensatesBatchId: null,
      actorId: null,
      createdAt: paidAt,
      postedAt: paidAt,
    },
  ]

  seed.ledgerEntry = [
    [ACCOUNTS.PROCESSOR_CLEARING, DEBIT, COLLECTED_CENTS, 'Order ANALYT taken'],
    [ACCOUNTS.ORGANIZER_PAYABLE, CREDIT, COLLECTED_CENTS - FEE_CENTS, 'Owed to the organiser'],
    [ACCOUNTS.PLATFORM_FEE_REVENUE, CREDIT, FEE_CENTS, 'Platform fee'],
  ].map(([account, direction, amountCents, memo]) => ({
    id: cuid(),
    batchId,
    accountId: accountId(account),
    direction,
    amountCents,
    currency: 'INR',
    memo,
    organizationId: ids.organization.id,
    createdAt: paidAt,
  }))

  const harness = await createTestApp({ seed, ids })

  return { ...harness, ids, orderId }
}

/**
 * A payload with its identifiers blanked, ready for a needle scan.
 *
 * A cuid is twenty-five random alphanumerics, so it will eventually contain
 * `card`, `priya` or any other short needle by chance, and a test that scans the
 * raw body for those is a test that fails on a Tuesday for no reason. The ids
 * are not what the scan is about \u2014 a leaked *field* is \u2014 so they go first.
 *
 * @param {string} body The response body.
 * @returns {string} The same JSON with every identifier-shaped string emptied.
 */
function withoutIdentifiers(body) {
  return body.replace(/\b[a-z0-9]{20,32}\b/gu, '')
}

/**
 * Sign somebody in and step them up.
 *
 * @param {object} app The Fastify instance.
 * @param {string} email Which account.
 * @returns {Promise<object>} Bearer headers with a fresh step-up.
 */
async function asUser(app, email) {
  const token = await signIn(app, email)
  const headers = bearer(token)

  await stepUp(app, email, headers)

  return headers
}

describe('GET /v1/analytics/summary', () => {
  it('counts tickets from the tickets, and money from the ledger', async () => {
    const { app, ids } = await worldWithSales()

    const response = await app.inject({
      method: 'GET',
      url: `/v1/analytics/summary?organizationId=${ids.organization.id}&currency=INR`,
      headers: await asUser(app, OWNER),
    })

    expect(response.statusCode).toBe(200)

    const view = response.json().data

    // Two live, one revoked — not the three the order line says were sold.
    expect(view.tickets.live).toBe(2)
    expect(view.tickets.byLostState.find((row) => row.state === 'REVOKED').count).toBe(1)

    expect(view.moneyVisible).toBe(true)
    expect(view.moneyWithheld).toBeNull()
    expect(view.money.totals.grossCollectedCents).toBe(COLLECTED_CENTS)
    expect(JSON.stringify(view.money)).not.toContain('999999999')
  })

  it('omits the money from the payload for a viewer, rather than from the page', async () => {
    const { app, ids } = await worldWithSales()

    const response = await app.inject({
      method: 'GET',
      url: `/v1/analytics/summary?organizationId=${ids.organization.id}&currency=INR`,
      headers: bearer(await signIn(app, VIEWER)),
    })

    expect(response.statusCode).toBe(200)

    const view = response.json().data

    expect(view.moneyVisible).toBe(false)
    expect(view.moneyWithheld).toBe('CAPABILITY')
    expect(view.money).toBeNull()
    // The counts a door steward may legitimately see are still there.
    expect(view.tickets.live).toBe(2)
    expect(view.checkIns.admitted).toBe(1)
    // And no monetary figure has leaked in through a breakdown: a table headed
    // "sales by event" printing what each event took would be the same
    // disclosure by another route.
    for (const groups of Object.values(view.sales)) {
      for (const group of groups) {
        expect(group.lineValueCents).toBeNull()
        expect(group.refundedCents).toBeNull()
        expect(group.quantity).toBeTypeOf('number')
      }
    }
  })

  it('refuses another organisation outright', async () => {
    const { app, ids } = await worldWithSales()

    const response = await app.inject({
      method: 'GET',
      url: `/v1/analytics/summary?organizationId=${ids.organization.id}&currency=INR`,
      headers: await asUser(app, OUTSIDER),
    })

    expect(response.statusCode).toBe(403)
    expect(response.body).not.toContain('Rangoli')
  })

  it('refuses somebody with no membership anywhere', async () => {
    const { app, ids } = await worldWithSales()

    const response = await app.inject({
      method: 'GET',
      url: `/v1/analytics/summary?organizationId=${ids.organization.id}&currency=INR`,
      headers: bearer(await signIn(app, ATTENDEE)),
    })

    expect(response.statusCode).toBe(403)
  })

  it('will not answer without an organisation, so the check cannot invert', async () => {
    const { app } = await worldWithSales()

    const response = await app.inject({
      method: 'GET',
      url: '/v1/analytics/summary?currency=INR',
      headers: await asUser(app, OWNER),
    })

    // An organisation capability asserted with no organisation becomes a
    // platform question, and a platform question passes for platform staff and
    // fails for every organiser. The schema refuses the request first.
    expect(response.statusCode).toBe(400)
  })

  it('withholds the money from a stale session, and keeps the counts', async () => {
    const { app, prisma, ids } = await worldWithSales()
    const headers = await asUser(app, OWNER)

    // Signing in *is* confirming your identity, so the figures come straight
    // afterwards. The control is about what happens an hour later, so an hour
    // is what the session is given. The window itself is the server's, out of
    // `STEP_UP_POLICIES` — nothing in the request can lengthen it.
    for (const session of prisma._store.session) {
      session.mfaSatisfiedAt = new Date(Date.now() - 60 * 60 * 1000)
    }

    const response = await app.inject({
      method: 'GET',
      url: `/v1/analytics/summary?organizationId=${ids.organization.id}&currency=INR`,
      headers,
    })

    // Not refused: an attendance figure is not a financial action, and refusing
    // the page would punish the door steward to protect a ledger total.
    expect(response.statusCode).toBe(200)

    const view = response.json().data

    expect(view.moneyVisible).toBe(false)
    expect(view.moneyWithheld).toBe('STEP_UP')
    expect(view.money).toBeNull()
    expect(view.tickets.live).toBe(2)

    for (const groups of Object.values(view.sales)) {
      for (const group of groups) expect(group.lineValueCents).toBeNull()
    }
  })

  it('returns the money again once the factor is presented', async () => {
    const { app, prisma, ids } = await worldWithSales()
    const headers = await asUser(app, OWNER)

    for (const session of prisma._store.session) {
      session.mfaSatisfiedAt = new Date(Date.now() - 60 * 60 * 1000)
    }

    await stepUp(app, OWNER, headers)

    const response = await app.inject({
      method: 'GET',
      url: `/v1/analytics/summary?organizationId=${ids.organization.id}&currency=INR`,
      headers,
    })

    const view = response.json().data

    expect(view.moneyVisible).toBe(true)
    expect(view.moneyWithheld).toBeNull()
    expect(view.money.totals.grossCollectedCents).toBe(COLLECTED_CENTS)
  })

  it('withholds the money from a stale session in the export too', async () => {
    const { app, prisma, ids } = await worldWithSales()
    const headers = await asUser(app, OWNER)

    for (const session of prisma._store.session) {
      session.mfaSatisfiedAt = new Date(Date.now() - 60 * 60 * 1000)
    }

    const response = await app.inject({
      method: 'GET',
      url: `/v1/analytics/export.csv?organizationId=${ids.organization.id}&currency=INR`,
      headers,
    })

    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('Money figures included,no')
    expect(response.body).toMatch(/has not confirmed a second factor recently enough/u)
    expect(response.body).not.toContain(String(COLLECTED_CENTS))
  })

  it('says which mode the figures describe, and names the funnel step it cannot show', async () => {
    const { app, ids } = await worldWithSales()

    const response = await app.inject({
      method: 'GET',
      url: `/v1/analytics/summary?organizationId=${ids.organization.id}&currency=INR`,
      headers: await asUser(app, OWNER),
    })

    const view = response.json().data

    expect(view.mode).toBe('MOCK')
    expect(view.modeNotice).toMatch(/no money moved/i)
    expect(view.timeZone).toBe('UTC')
    expect(view.funnel.missing.join(' ')).toMatch(/page views/i)
    expect(view.funnel.steps.map((step) => step.key)).toEqual([
      'holds',
      'ordersCreated',
      'ordersPaid',
    ])
  })

  it('carries no buyer, no card and no provider identifier', async () => {
    const { app, ids } = await worldWithSales()

    const response = await app.inject({
      method: 'GET',
      url: `/v1/analytics/summary?organizationId=${ids.organization.id}&currency=INR`,
      headers: await asUser(app, OWNER),
    })

    const scanned = withoutIdentifiers(response.body).toLowerCase()

    for (const needle of ['priya', 'buyeremail', 'buyername', 'pi_', 'card', 'cvc', 'pan']) {
      expect(scanned, `the payload carries ${needle}`).not.toContain(needle)
    }
  })
})

describe('GET /v1/analytics/export.csv', () => {
  it('is served as a downloadable CSV', async () => {
    const { app, ids } = await worldWithSales()

    const response = await app.inject({
      method: 'GET',
      url: `/v1/analytics/export.csv?organizationId=${ids.organization.id}&currency=INR`,
      headers: await asUser(app, OWNER),
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toBe('text/csv; charset=utf-8')
    expect(response.headers['content-disposition']).toMatch(/^attachment; filename="analytics-\d/)
  })

  it('exports exactly its allow list of columns', async () => {
    const { app, ids } = await worldWithSales()

    const response = await app.inject({
      method: 'GET',
      url: `/v1/analytics/export.csv?organizationId=${ids.organization.id}&currency=INR`,
      headers: await asUser(app, OWNER),
    })

    const [header] = response.body.split('\r\n')

    expect(header).toBe('Section,Item,Code,Quantity,Amount (minor units),Currency,Note')
  })

  it('neutralises an organiser-supplied title that begins like a formula', async () => {
    const { app, ids } = await worldWithSales()

    const response = await app.inject({
      method: 'GET',
      url: `/v1/analytics/export.csv?organizationId=${ids.organization.id}&currency=INR`,
      headers: await asUser(app, OWNER),
    })

    // Present, so nothing was silently rewritten; quoted and apostrophed, so no
    // spreadsheet will evaluate it.
    expect(response.body).toContain('HYPERLINK')
    expect(response.body).not.toMatch(/(^|,)=HYPERLINK/mu)
    expect(response.body).toMatch(/"'=HYPERLINK/u)
  })

  it('exports no money at all for a viewer, and says why', async () => {
    const { app, ids } = await worldWithSales()

    const response = await app.inject({
      method: 'GET',
      url: `/v1/analytics/export.csv?organizationId=${ids.organization.id}&currency=INR`,
      headers: bearer(await signIn(app, VIEWER)),
    })

    expect(response.statusCode).toBe(200)
    expect(response.body).toContain('Money figures included,no')
    expect(response.body).not.toContain(String(COLLECTED_CENTS))
    // The counts still export, because those are what the capability grants.
    expect(response.body).toContain('Live tickets')
  })

  it('refuses another organisation', async () => {
    const { app, ids } = await worldWithSales()

    const response = await app.inject({
      method: 'GET',
      url: `/v1/analytics/export.csv?organizationId=${ids.organization.id}&currency=INR`,
      headers: await asUser(app, OUTSIDER),
    })

    expect(response.statusCode).toBe(403)
  })
})
