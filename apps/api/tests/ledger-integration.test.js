/**
 * Ledger posting, against a real database.
 *
 * The stub cannot prove any of this. What is being tested is the agreement
 * between the service and the database's own rules: the balance trigger that
 * fires at posting, the append-only triggers on posted batches and entries, and
 * the unique index that makes a retry a no-op instead of a second payment. A
 * stub that agrees with the service proves only that the service agrees with
 * itself.
 *
 * Runs against TEST_DATABASE_URL and skips itself when no database is reachable,
 * the same way the facets suite does. It is wired into `pnpm db:verify:fresh`, so
 * a build that skips it is still reported as a skip rather than a pass.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createPrismaClient } from '@desi-event/db'
import {
  ACCOUNTS,
  CREDIT,
  DEBIT,
  composeBatch,
  correctionBatch,
  entry,
  orderPaidBatch,
} from '@desi-event/ledger'

import { findPostedBatch, postBatch, resetAccountCache } from '../src/lib/ledger.js'

const CONNECTION =
  process.env.TEST_DATABASE_URL ??
  'postgresql://desi:desi@127.0.0.1:5432/desi_event_test?schema=public'

/** Marks every row this suite creates, so cleanup cannot touch anything else. */
const TAG = 'ledgertest'

/**
 * A suffix unique to this run.
 *
 * Nothing is deleted afterwards — see the note on teardown — so every reference
 * and every source id has to be new, or the second run of the suite collides
 * with the first. That is not a testing inconvenience: it is what append-only
 * feels like from the outside.
 */
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`

/**
 * Ids this suite posted.
 *
 * Kept for assertions, not for cleanup — see the note on teardown below.
 */
const created = []

/**
 * The client, and whether the database answered.
 *
 * Probed at module scope rather than in `beforeAll`, because `describe.skip` is
 * decided while the file is being collected — a flag set in `beforeAll` is still
 * false at that point, and every test would skip even against a live database.
 * Top-level await is the only way to make the skip mean what it says.
 */
const prisma = createPrismaClient({ connectionString: CONNECTION })
const reachable = await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false)

if (!reachable) {
  console.warn(
    `[api] skipping the ledger integration suite: ${CONNECTION.replace(/:[^:@/]*@/, ':***@')} is unreachable`,
  )
}

/**
 * A representative order split, in minor units.
 *
 * @param {string} reference A unique reference.
 * @returns {object} A composed `ORDER_PAID` batch.
 */
function orderBatch(reference) {
  return orderPaidBatch({
    capturedCents: 10_000,
    organizerNetCents: 8_500,
    platformFeeCents: 690,
    taxCents: 810,
    currency: 'INR',
    organizationId: `${TAG}-org`,
    reference,
  })
}

/**
 * Post a batch and remember it for cleanup.
 *
 * @param {object} batch A composed batch.
 * @param {object} context Posting context.
 * @returns {Promise<object>} The result of `postBatch`.
 */
async function post(batch, context) {
  const result = await postBatch(prisma, batch, context)

  if (result.batch?.id) created.push(result.batch.id)

  return result
}

beforeAll(() => {
  resetAccountCache()
})

// There is deliberately no teardown.
//
// The first version of this suite deleted its rows afterwards and every case
// failed in cleanup: `desi_ledger_entry_immutable` refuses a DELETE of a posted
// batch's entries even through raw SQL. That is the invariant working, and the
// right response was to stop trying rather than to find a way around it — a test
// that disables a guard in order to tidy up has quietly disabled the guard.
//
// So the rows stay. `pnpm db:verify:fresh` builds a fresh database per run, and
// every row is tagged, so nothing accumulates anywhere that matters. An
// append-only ledger is append-only for tests too.

afterAll(async () => {
  if (prisma) await prisma.$disconnect().catch(() => {})
})

/** `describe` when the database answered, `describe.skip` when it did not. */
const when = () => (reachable ? describe : describe.skip)

when()('posting a balanced batch', () => {
  it('writes the entries and marks the batch posted', async () => {
    const reference = `${TAG}-${RUN}-ok`
    const { batch, posted } = await post(orderBatch(reference), {
      sourceType: 'ORDER',
      sourceId: `${TAG}-${RUN}-order-1`,
      reference,
    })

    expect(posted).toBe(true)
    expect(batch.status).toBe('POSTED')
    expect(batch.postedAt).toBeInstanceOf(Date)
    expect(batch.entries).toHaveLength(4)
    expect(batch.debitCents).toBe(batch.creditCents)
  })

  it('resolves account codes to the rows the migration created', async () => {
    const reference = `${TAG}-${RUN}-codes`
    const { batch } = await post(orderBatch(reference), {
      sourceType: 'ORDER',
      sourceId: `${TAG}-${RUN}-order-codes`,
      reference,
    })

    const accounts = await prisma.ledgerAccount.findMany({
      where: { id: { in: batch.entries.map((line) => line.accountId) } },
      select: { code: true },
    })

    expect(accounts.map((row) => row.code).sort()).toEqual(
      [
        ACCOUNTS.ORGANIZER_PAYABLE,
        ACCOUNTS.PLATFORM_FEE_REVENUE,
        ACCOUNTS.PROCESSOR_CLEARING,
        ACCOUNTS.TAX_PAYABLE,
      ].sort(),
    )
  })
})

when()('posting the same source event twice', () => {
  it('posts once and reports the second attempt as already done', async () => {
    // The property that makes a webhook retry safe. Without it, a delivery
    // Stripe sent twice would credit the organiser twice.
    const sourceId = `${TAG}-${RUN}-order-idem`
    const first = await post(orderBatch(`${TAG}-${RUN}-idem-1`), {
      sourceType: 'ORDER',
      sourceId,
      reference: `${TAG}-${RUN}-idem-1`,
    })
    const second = await post(orderBatch(`${TAG}-${RUN}-idem-2`), {
      sourceType: 'ORDER',
      sourceId,
      reference: `${TAG}-${RUN}-idem-2`,
    })

    expect(first.posted).toBe(true)
    expect(second.posted).toBe(false)
    expect(second.batch.id).toBe(first.batch.id)

    const all = await prisma.ledgerBatch.findMany({ where: { sourceId } })

    expect(all).toHaveLength(1)
  })

  it('survives two concurrent attempts, posting exactly one', async () => {
    const sourceId = `${TAG}-${RUN}-order-race`

    const results = await Promise.all(
      Array.from({ length: 6 }, (_unused, index) =>
        post(orderBatch(`${TAG}-${RUN}-race-${index}`), {
          sourceType: 'ORDER',
          sourceId,
          reference: `${TAG}-${RUN}-race-${index}`,
        }),
      ),
    )

    expect(results.filter((result) => result.posted)).toHaveLength(1)

    const all = await prisma.ledgerBatch.findMany({ where: { sourceId } })

    expect(all).toHaveLength(1)
  })

  it('lets one order post different kinds, because an order is paid then refunded', async () => {
    const sourceId = `${TAG}-${RUN}-order-kinds`
    const paid = await post(orderBatch(`${TAG}-${RUN}-kind-paid`), {
      sourceType: 'ORDER',
      sourceId,
      reference: `${TAG}-${RUN}-kind-paid`,
    })

    const correction = await post(
      correctionBatch(orderBatch(`${TAG}-${RUN}-x`), 'duplicate capture'),
      {
        sourceType: 'ORDER',
        sourceId,
        reference: `${TAG}-${RUN}-kind-corr`,
        compensatesBatchId: paid.batch.id,
      },
    )

    expect(paid.posted).toBe(true)
    expect(correction.posted).toBe(true)
    expect(correction.batch.compensatesBatchId).toBe(paid.batch.id)
  })
})

when()('a colliding reference, which is not a retry', () => {
  it('is refused rather than mistaken for an already-posted batch', async () => {
    // Found by running this suite twice. `reference` is unique as well as
    // `idempotencyKey`, and the first version of `postBatch` treated *any*
    // unique violation as "somebody already posted this" — so a reference
    // collision returned a different, unrelated batch and the caller carried on
    // believing its money had been recorded.
    const reference = `${TAG}-${RUN}-shared-reference`

    await post(orderBatch(reference), {
      sourceType: 'ORDER',
      sourceId: `${TAG}-${RUN}-order-ref-a`,
      reference,
    })

    await expect(
      post(orderBatch(reference), {
        sourceType: 'ORDER',
        // A different source event, so the idempotency key differs and this is
        // genuinely a second batch — it just picked a reference already in use.
        sourceId: `${TAG}-${RUN}-order-ref-b`,
        reference,
      }),
    ).rejects.toThrow(/references must be unique/)
  })
})

when()('the database refusing what the service would let through', () => {
  it('refuses an unbalanced batch even when the totals claim it balances', async () => {
    // Composed by hand rather than through `composeBatch`, because that would
    // refuse it first. The point is that the *database* refuses it too: the
    // trigger is true for every writer, and this module is only true for callers
    // who come through it.
    const reference = `${TAG}-${RUN}-unbalanced`

    await expect(
      post(
        {
          kind: 'ORDER_PAID',
          currency: 'INR',
          // Claims to balance; the entries do not.
          debitCents: 10_000,
          creditCents: 10_000,
          entries: [
            entry(ACCOUNTS.PROCESSOR_CLEARING, DEBIT, 10_000, 'in'),
            entry(ACCOUNTS.ORGANIZER_PAYABLE, CREDIT, 9_000, 'out'),
          ],
        },
        {
          sourceType: 'ORDER',
          sourceId: `${TAG}-${RUN}-order-unbalanced`,
          reference,
        },
      ),
    ).rejects.toThrow(/balance/i)
  })

  it('refuses an update to a posted batch', async () => {
    const reference = `${TAG}-${RUN}-immutable`
    const { batch } = await post(orderBatch(reference), {
      sourceType: 'ORDER',
      sourceId: `${TAG}-${RUN}-order-immutable`,
      reference,
    })

    await expect(
      prisma.ledgerBatch.update({ where: { id: batch.id }, data: { debitCents: 1 } }),
    ).rejects.toThrow(/posted/i)
  })

  it('refuses a raw SQL delete of a posted entry, not just a Prisma one', async () => {
    // Discovered by trying to clean up after this suite. A service-layer rule
    // would not have stopped it; the trigger does, which is the difference
    // between a promise and an invariant.
    const reference = `${TAG}-${RUN}-raw-delete`
    const { batch } = await post(orderBatch(reference), {
      sourceType: 'ORDER',
      sourceId: `${TAG}-${RUN}-order-raw-delete`,
      reference,
    })

    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM "LedgerEntry" WHERE "batchId" = $1`, batch.id),
    ).rejects.toThrow(/posted/i)

    await expect(
      prisma.$executeRawUnsafe(`DELETE FROM "LedgerBatch" WHERE "id" = $1`, batch.id),
    ).rejects.toThrow(/posted/i)

    const still = await prisma.ledgerEntry.count({ where: { batchId: batch.id } })

    expect(still).toBe(4)
  })

  it('refuses a change to a posted batch entry', async () => {
    const reference = `${TAG}-${RUN}-entry-immutable`
    const { batch } = await post(orderBatch(reference), {
      sourceType: 'ORDER',
      sourceId: `${TAG}-${RUN}-order-entry-immutable`,
      reference,
    })

    await expect(
      prisma.ledgerEntry.update({
        where: { id: batch.entries[0].id },
        data: { amountCents: 1 },
      }),
    ).rejects.toThrow(/posted/i)
  })
})

when()('reading back what was posted', () => {
  it('finds a batch by its source event', async () => {
    const sourceId = `${TAG}-${RUN}-order-find`
    const reference = `${TAG}-${RUN}-find`

    await post(orderBatch(reference), { sourceType: 'ORDER', sourceId, reference })

    const found = await findPostedBatch(prisma, 'ORDER_PAID', 'ORDER', sourceId)

    expect(found?.reference).toBe(reference)
    expect(found?.entries).toHaveLength(4)
  })

  it('returns null for a source event that posted nothing', async () => {
    expect(await findPostedBatch(prisma, 'ORDER_PAID', 'ORDER', `${TAG}-${RUN}-never`)).toBeNull()
  })
})

when()('a batch composed from an inconsistent split', () => {
  it('never reaches the database, because composition refuses it first', async () => {
    expect(() =>
      composeBatch({
        kind: 'ORDER_PAID',
        currency: 'INR',
        entries: [
          entry(ACCOUNTS.PROCESSOR_CLEARING, DEBIT, 10_000, 'in'),
          entry(ACCOUNTS.ORGANIZER_PAYABLE, CREDIT, 9_999, 'out'),
        ],
      }),
    ).toThrow(/does not balance/)
  })
})
