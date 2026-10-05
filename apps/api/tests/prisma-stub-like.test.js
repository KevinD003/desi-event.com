/**
 * The Prisma stub reads a pattern operator's value as PostgreSQL's `LIKE` does.
 *
 * Prisma runs `contains`, `startsWith` and `endsWith` as `LIKE` (`ILIKE` with
 * `mode: 'insensitive'`), and a case-insensitive `equals` as `ILIKE`, and
 * escapes none of them. The routes therefore escape what a person types
 * (`likeLiteral`, `equalsIgnoringCase`). A stub that compared literally would
 * find nothing for an escaped `San\_Jose` and could never show the over-match
 * an unescaped one gives, so most route tests would disagree with the database
 * in both directions.
 *
 * Each case below is run against the stub and, when it is reachable, against
 * PostgreSQL, and both must give the same rows.
 *
 * @module @desi-event/api/tests/prisma-stub-like
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { equalsIgnoringCase, likeLiteral } from '../src/lib/like-pattern.js'
import { connectTestDatabase } from './helpers/database.js'
import { createPrismaStub } from './helpers/prisma-stub.js'

const { prisma, when } = await connectTestDatabase('the stub LIKE parity suite')

/** Venue ids in a CUID shape, unique to this file so a shared database is safe. */
const EXACT = 'cstublikeexact000000000000'
const LOOSE = 'cstublikeloose000000000000'
const SLASH = 'cstublikeslash000000000000'

/** Rows that differ only where a pattern is loose. */
const VENUES = [
  { id: EXACT, name: 'Hall 100% Plaza', city: 'San_Jose', region: 'C_A' },
  { id: LOOSE, name: 'Hall 1000 Plaza', city: 'SanXJose', region: 'CxA' },
  { id: SLASH, name: 'Back\\slash Hall', city: 'Austin', region: 'TX' },
].map((venue) => ({
  ...venue,
  addressLine1: '1 Pattern Road',
  postalCode: '77002',
  country: 'US',
}))

/**
 * Each case: its name, the filter, and the ids PostgreSQL gives for it.
 *
 * @type {Array<Array<*>>}
 */
const CASES = [
  // Escaped: character for character.
  ['an escaped exact city', { city: equalsIgnoringCase('San_Jose') }, [EXACT]],
  ['an escaped exact city in another case', { city: equalsIgnoringCase('SAN_jose') }, [EXACT]],
  [
    'an escaped name fragment with a percent sign',
    { name: { contains: likeLiteral('100%'), mode: 'insensitive' } },
    [EXACT],
  ],
  ['an escaped start', { name: { startsWith: likeLiteral('Hall 100%') } }, [EXACT]],
  ['an escaped end', { city: { endsWith: likeLiteral('_Jose') } }, [EXACT]],
  ['an escaped backslash', { name: { contains: likeLiteral('k\\s') } }, [SLASH]],
  // Unescaped: the wildcards are live, exactly as on PostgreSQL.
  [
    'an unescaped insensitive equals',
    { city: { equals: 'san_jose', mode: 'insensitive' } },
    [EXACT, LOOSE],
  ],
  ['an unescaped percent sign', { name: { contains: '100%' } }, [EXACT, LOOSE]],
  ['an unescaped underscore at the end', { region: { endsWith: '_A' } }, [EXACT, LOOSE]],
  ['an unescaped backslash, which escapes the next character', { name: { contains: 'k\\s' } }, []],
  [
    'an unescaped percent alone',
    { city: { contains: '%', mode: 'insensitive' } },
    [EXACT, LOOSE, SLASH],
  ],
  // A case-sensitive `equals` is `=`: no pattern at all.
  ['a plain equals', { city: { equals: 'San_Jose' } }, [EXACT]],
  ['a bare value', { city: 'San_Jose' }, [EXACT]],
  ['a plain equals is case-sensitive', { city: { equals: 'san_jose' } }, []],
]

/**
 * The ids a filter finds among this file's venues.
 *
 * @param {object} client A Prisma client or the stub.
 * @param {object} where The filter.
 * @returns {Promise<string[]>} The ids, sorted.
 */
async function found(client, where) {
  const rows = await client.venue.findMany({
    where: { AND: [{ id: { in: VENUES.map((venue) => venue.id) } }, where] },
    select: { id: true },
  })

  return rows.map((row) => row.id).sort()
}

describe('the stub’s pattern operators', () => {
  it.each(CASES)('%s', async (_label, where, expected) => {
    const stub = createPrismaStub({ venue: VENUES.map((venue) => ({ ...venue })) })

    expect(await found(stub, where)).toEqual([...expected].sort())
  })
})

when()('the same filters on PostgreSQL', () => {
  beforeAll(async () => {
    for (const venue of VENUES) {
      await prisma.venue.upsert({ where: { id: venue.id }, update: venue, create: venue })
    }
  })

  afterAll(async () => {
    await prisma.venue.deleteMany({ where: { id: { in: VENUES.map((venue) => venue.id) } } })
  })

  it.each(CASES)('%s', async (_label, where, expected) => {
    expect(await found(prisma, where)).toEqual([...expected].sort())
  })
})

afterAll(async () => {
  await prisma.$disconnect()
})
