/**
 * The finance view, and the export nobody can weaponise.
 *
 * Two properties this file exists for:
 *
 *   - **The figures come from the ledger.** An order total that disagrees with
 *     the entries does not move the numbers, because the numbers never read it.
 *   - **A cell cannot become a formula.** A title beginning `=` in an export is
 *     a working formula in Excel, LibreOffice and Google Sheets, and the person
 *     harmed is whoever opened the file.
 *
 * @module @desi-event/api/tests/finance-reporting
 */

import { describe, expect, it } from 'vitest'

import { ACCOUNTS, CREDIT, DEBIT } from '@desi-event/ledger'

import { FORMULA_PREFIXES, csvCell, csvFilename, toCsv } from '../src/lib/csv.js'
import { REPORTED_ACCOUNTS, balanceOf } from '../src/lib/finance-reporting.js'
import { bearer, createTestApp, signIn, stepUp } from './helpers/app.js'
import { LEDGER_ACCOUNTS, makeWorld } from './helpers/fixtures.js'
import { cuid } from './helpers/prisma-stub.js'

/** What the ledger says was collected. */
const COLLECTED_CENTS = 1_000_000

/** The platform operations account. */
const OPERATOR = 'ops@desi-event.example'

/** The organisation's owner. */
const OWNER = 'owner@rangoli.example'

/** An organiser of a different organisation. */
const OUTSIDER = 'rival@dhol.example'

describe('csvCell', () => {
  it.each(FORMULA_PREFIXES)('neutralises a cell beginning %j', (prefix) => {
    const cell = csvCell(`${prefix}HYPERLINK("http://attacker.example")`)

    // Prefixed, not stripped. Removing the character would change the data — a
    // negative amount really does begin with a minus — and a report that
    // quietly rewrites figures is worse than one showing an apostrophe.
    expect(cell.startsWith("'") || cell.startsWith('"\'')).toBe(true)
    expect(cell).toContain('HYPERLINK')
  })

  it('quotes a field containing a comma, a quote or a newline', () => {
    expect(csvCell('Ragas, live')).toBe('"Ragas, live"')
    expect(csvCell('He said "no"')).toBe('"He said ""no"""')
    expect(csvCell('two\nlines')).toBe('"two\nlines"')
  })

  it('writes nothing for null and undefined', () => {
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
  })

  it('renders a date as an instant rather than as prose', () => {
    expect(csvCell(new Date('2026-09-16T12:00:00Z'))).toBe('2026-09-16T12:00:00.000Z')
  })

  it('leaves an ordinary number alone', () => {
    expect(csvCell(240_000)).toBe('240000')
  })
})

describe('toCsv', () => {
  it('writes a header row and CRLF line endings', () => {
    const csv = toCsv({
      columns: [
        { key: 'a', header: 'First' },
        { key: 'b', header: 'Second' },
      ],
      rows: [{ a: 1, b: 2 }],
    })

    expect(csv).toBe('First,Second\r\n1,2\r\n')
  })

  it('exports only the columns it was given', () => {
    const csv = toCsv({
      columns: [{ key: 'amountCents', header: 'Amount' }],
      rows: [{ amountCents: 100, buyerEmail: 'priya@example.com' }],
    })

    // The allow list is the point. A row that grew a field does not start
    // appearing in exports because nobody remembered to remove it.
    expect(csv).not.toContain('priya@example.com')
  })

  it('refuses an export with no column list', () => {
    expect(() => toCsv({ columns: [], rows: [] })).toThrow(/explicit column list/i)
  })
})

describe('csvFilename', () => {
  it('cannot carry a quote or a path separator into a header', () => {
    expect(csvFilename('finance"; rm -rf /', '2026-09-16T00:00:00.000Z')).toBe(
      'finance-rm-rf-2026-09-16.csv',
    )
  })

  it('falls back to a name rather than producing one that is only a date', () => {
    expect(csvFilename('!!!', '2026-09-16T00:00:00.000Z')).toBe('export-2026-09-16.csv')
  })
})

describe('balanceOf', () => {
  it('reads an asset in the direction it grows', () => {
    expect(balanceOf({ debitCents: 500, creditCents: 200 }, DEBIT)).toBe(300)
  })

  it('reads a liability in the direction it grows', () => {
    expect(balanceOf({ debitCents: 200, creditCents: 500 }, CREDIT)).toBe(300)
  })
})

describe('REPORTED_ACCOUNTS', () => {
  it('names only accounts the chart actually has', () => {
    const known = new Set(Object.values(ACCOUNTS))

    for (const account of REPORTED_ACCOUNTS) {
      expect(known, `${account.code} is not in the chart of accounts`).toContain(account.code)
    }
  })
})

/**
 * The id of a ledger account in the fixture chart.
 *
 * @param {string} code One of {@link ACCOUNTS}.
 * @returns {string} The account's id.
 */
function accountId(code) {
  return LEDGER_ACCOUNTS.find((account) => account.code === code).id
}

/**
 * A world whose ledger says money was taken, however the order rows read.
 *
 * The order's own totals are deliberately wrong here: nothing in the finance
 * view reads them, and a fixture where they agreed would not prove that.
 *
 * @param {object} [options] Options.
 * @param {boolean} [options.imbalanced] Post a batch whose entries do not add up.
 * @returns {Promise<object>} The harness.
 */
async function worldWithLedger({ imbalanced = false } = {}) {
  const world = await makeWorld()
  const { seed, ids } = world

  const orderId = cuid()
  const batchId = cuid()

  seed.order = [
    {
      id: orderId,
      reference: 'DE-FINRPT',
      eventId: ids.publishedEvent.id,
      eventSessionId: null,
      userId: ids.attendee.id,
      buyerEmail: 'priya@example.com',
      buyerName: 'Priya Sharma',
      status: 'PAID',
      currency: 'INR',
      // Nonsense on purpose: if any figure below matched this, the view would
      // be reading the order rather than the ledger.
      subtotalCents: 999_999_999,
      feesCents: 0,
      taxCents: 0,
      discountCents: 0,
      totalCents: 999_999_999,
      refundedCents: 0,
      refundPendingCents: 0,
      paidAt: new Date('2026-09-01T10:00:00Z'),
      createdAt: new Date('2026-09-01T10:00:00Z'),
      updatedAt: new Date('2026-09-01T10:00:00Z'),
    },
  ]

  seed.ledgerBatch = [
    {
      id: batchId,
      reference: 'OR-FINRPT',
      kind: 'ORDER_PAID',
      status: 'POSTED',
      currency: 'INR',
      debitCents: COLLECTED_CENTS,
      creditCents: COLLECTED_CENTS,
      sourceType: 'ORDER',
      sourceId: orderId,
      idempotencyKey: 'ORDER_PAID:ORDER:finrpt:',
      orderId,
      paymentId: null,
      refundId: null,
      disputeId: null,
      transferId: null,
      payoutId: null,
      compensatesBatchId: null,
      actorId: null,
      createdAt: new Date('2026-09-01T10:00:00Z'),
      postedAt: new Date('2026-09-01T10:00:00Z'),
    },
  ]

  seed.ledgerEntry = [
    {
      id: cuid(),
      batchId,
      accountId: accountId(ACCOUNTS.PROCESSOR_CLEARING),
      direction: DEBIT,
      amountCents: COLLECTED_CENTS,
      currency: 'INR',
      memo: 'Order FINRPT taken',
      organizationId: ids.organization.id,
      createdAt: new Date('2026-09-01T10:00:00Z'),
    },
    {
      id: cuid(),
      batchId,
      accountId: accountId(ACCOUNTS.ORGANIZER_PAYABLE),
      direction: CREDIT,
      // Deliberately short when `imbalanced`, so the entries do not sum to the
      // batch's own columns.
      amountCents: imbalanced ? COLLECTED_CENTS - 1 : COLLECTED_CENTS - 100_000,
      currency: 'INR',
      memo: 'Owed to the organiser',
      organizationId: ids.organization.id,
      createdAt: new Date('2026-09-01T10:00:00Z'),
    },
    ...(imbalanced
      ? []
      : [
          {
            id: cuid(),
            batchId,
            accountId: accountId(ACCOUNTS.PLATFORM_FEE_REVENUE),
            direction: CREDIT,
            amountCents: 100_000,
            currency: 'INR',
            memo: 'Platform fee',
            organizationId: ids.organization.id,
            createdAt: new Date('2026-09-01T10:00:00Z'),
          },
        ]),
  ]

  return createTestApp({ seed, ids }).then((harness) => ({ ...harness, ids }))
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

describe('GET /v1/finance/summary', () => {
  it('reports what the ledger says, not what the order says', async () => {
    const { app, ids } = await worldWithLedger()

    const response = await app.inject({
      method: 'GET',
      url: `/v1/finance/summary?organizationId=${ids.organization.id}&currency=INR`,
      headers: await asUser(app, OWNER),
    })

    expect(response.statusCode, response.body).toBe(200)

    const { data } = response.json()

    expect(data.totals.grossCollectedCents).toBe(COLLECTED_CENTS)
    expect(data.totals.organizerPayableCents).toBe(COLLECTED_CENTS - 100_000)
    expect(data.totals.platformFeeRevenueCents).toBe(100_000)
    // The order says 999,999,999. Nothing here does.
    expect(response.body).not.toContain('999999999')

    await app.close()
  })

  it('says which mode produced the figures, first', async () => {
    const { app, ids } = await worldWithLedger()

    const response = await app.inject({
      method: 'GET',
      url: `/v1/finance/summary?organizationId=${ids.organization.id}`,
      headers: await asUser(app, OWNER),
    })

    const { data } = response.json()

    expect(data.mode).toBe('MOCK')
    expect(data.modeNotice).toMatch(/no money moved/i)
    expect(data.modeNotice).toMatch(/not an accounting record/i)

    await app.close()
  })

  it('reports a batch whose entries do not add up', async () => {
    const { app, ids } = await worldWithLedger({ imbalanced: true })

    const response = await app.inject({
      method: 'GET',
      url: `/v1/finance/summary?organizationId=${ids.organization.id}`,
      headers: await asUser(app, OWNER),
    })

    const { data } = response.json()

    expect(data.integrity.imbalances).toHaveLength(1)
    expect(data.integrity.imbalances[0].problem).toBe('ENTRIES_UNBALANCED')
    expect(data.integrity.imbalances[0].reference).toBe('OR-FINRPT')

    await app.close()
  })

  it('finds nothing wrong with a batch that balances', async () => {
    const { app, ids } = await worldWithLedger()

    const response = await app.inject({
      method: 'GET',
      url: `/v1/finance/summary?organizationId=${ids.organization.id}`,
      headers: await asUser(app, OWNER),
    })

    expect(response.json().data.integrity.imbalances).toEqual([])
    // And it says how many it looked at, so "none found" is never "we stopped
    // looking".
    expect(response.json().data.integrity.examined).toBeGreaterThan(0)

    await app.close()
  })

  it('refuses an organiser asking for the whole platform', async () => {
    const { app } = await worldWithLedger()

    const response = await app.inject({
      method: 'GET',
      url: '/v1/finance/summary',
      headers: await asUser(app, OWNER),
    })

    expect(response.statusCode).toBe(403)

    await app.close()
  })

  it('shows the platform everything', async () => {
    const { app } = await worldWithLedger()

    const response = await app.inject({
      method: 'GET',
      url: '/v1/finance/summary',
      headers: await asUser(app, OPERATOR),
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(response.json().data.organizationId).toBeNull()

    await app.close()
  })

  it('refuses an organiser of another organisation', async () => {
    const { app, ids } = await worldWithLedger()

    const response = await app.inject({
      method: 'GET',
      url: `/v1/finance/summary?organizationId=${ids.organization.id}`,
      headers: await asUser(app, OUTSIDER),
    })

    expect(response.statusCode).toBe(403)

    await app.close()
  })
})

describe('GET /v1/finance/export.csv', () => {
  it('downloads a spreadsheet with the mode on its first row', async () => {
    const { app, ids } = await worldWithLedger()

    const response = await app.inject({
      method: 'GET',
      url: `/v1/finance/export.csv?organizationId=${ids.organization.id}`,
      headers: await asUser(app, OWNER),
    })

    expect(response.statusCode, response.body).toBe(200)
    expect(response.headers['content-type']).toContain('text/csv')
    expect(response.headers['content-disposition']).toMatch(/attachment; filename="finance-/)
    expect(response.headers['cache-control']).toBe('no-store')

    const [header, mode] = response.body.split('\r\n')

    expect(header).toBe(
      'Section,Item,Code,Debits (minor units),Credits (minor units),Balance (minor units),Count,Currency',
    )
    expect(mode).toContain('Mode')
    expect(mode).toContain('MOCK')

    await app.close()
  })

  it('carries no buyer, no address and no provider reference', async () => {
    const { app, ids } = await worldWithLedger()

    const response = await app.inject({
      method: 'GET',
      url: `/v1/finance/export.csv?organizationId=${ids.organization.id}`,
      headers: await asUser(app, OWNER),
    })

    expect(response.body).not.toContain('priya@example.com')
    expect(response.body).not.toContain('Priya Sharma')
    expect(response.body).not.toContain('pi_')

    await app.close()
  })

  it('refuses an organiser of another organisation', async () => {
    const { app, ids } = await worldWithLedger()

    const response = await app.inject({
      method: 'GET',
      url: `/v1/finance/export.csv?organizationId=${ids.organization.id}`,
      headers: await asUser(app, OUTSIDER),
    })

    expect(response.statusCode).toBe(403)

    await app.close()
  })
})
