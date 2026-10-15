/**
 * The ranked page lays one window across two tiers.
 *
 * Checked against a delegate that records what it was asked, so the window
 * arithmetic — the page that straddles the boundary, the page wholly in the
 * second tier — is pinned without a database. The PostgreSQL suite proves the
 * same thing against real enum columns.
 *
 * @module @desi-event/api/lib/ranked-page.test
 */

import { describe, expect, it } from 'vitest'

import { readRankedPage } from './ranked-page.js'

/**
 * A delegate over an array, honouring the filters the helper sends.
 *
 * @param {Array<{id: string, status: string}>} rows The table, already in the order within a tier.
 * @returns {object} A `count`/`findMany` pair.
 */
function delegateOver(rows) {
  const matches = (where) => {
    const [, tier] = where.AND
    const { in: included, notIn: excluded } = tier.status

    return rows.filter((row) =>
      included ? included.includes(row.status) : !excluded.includes(row.status),
    )
  }

  return {
    count: async ({ where }) => matches(where).length,
    findMany: async ({ where, skip, take }) => matches(where).slice(skip, skip + take),
  }
}

/** Five rows, the two open ones declared last, as an enum might put them. */
const ROWS = [
  { id: 'r1', status: 'RESOLVED' },
  { id: 'r2', status: 'RESOLVED' },
  { id: 'o1', status: 'OPEN' },
  { id: 'r3', status: 'RESOLVED' },
  { id: 'o2', status: 'ESCALATED' },
]

/**
 * Read a page of {@link ROWS}.
 *
 * @param {number} skip Rows before the page.
 * @param {number} take Rows on it.
 * @returns {Promise<string[]>} The ids on the page.
 */
async function page(skip, take) {
  const rows = await readRankedPage(delegateOver(ROWS), {
    where: {},
    field: 'status',
    first: ['OPEN', 'ESCALATED'],
    orderBy: [],
    skip,
    take,
  })

  return rows.map((row) => row.id)
}

describe('readRankedPage', () => {
  it('puts the first tier first', async () => {
    expect(await page(0, 5)).toEqual(['o1', 'o2', 'r1', 'r2', 'r3'])
  })

  it('fills a page that straddles the boundary from both tiers', async () => {
    expect(await page(1, 2)).toEqual(['o2', 'r1'])
  })

  it('reads a page wholly in the second tier from the right offset', async () => {
    expect(await page(3, 2)).toEqual(['r2', 'r3'])
  })

  it('returns nothing past the end', async () => {
    expect(await page(5, 2)).toEqual([])
  })

  it('keeps the list’s own filter on both reads', async () => {
    const seen = []
    const delegate = {
      count: async (args) => (seen.push(args.where), 0),
      findMany: async (args) => (seen.push(args.where), []),
    }

    await readRankedPage(delegate, {
      where: { organizationId: 'org_1' },
      field: 'state',
      first: ['OPEN'],
      orderBy: [],
      skip: 0,
      take: 10,
    })

    for (const where of seen) expect(where.AND[0]).toEqual({ organizationId: 'org_1' })
  })
})
