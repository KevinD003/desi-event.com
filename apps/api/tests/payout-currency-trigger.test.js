/**
 * `desi_payout_currency_matches`, against a real database.
 *
 * This trigger shipped in `20260916130000_commerce_services` reading a column
 * called `"payoutCurrency"` from `"ConnectedAccount"`. No such column exists —
 * the account's currency is `"defaultCurrency"` — and plpgsql plans a function
 * body when the function runs rather than when it is created, so the migration
 * applied cleanly and the mistake waited in the schema until a payout fired it.
 *
 * What it did then was not a guard that failed open. The bad `SELECT` sits
 * *after* the early return for a payout with no connected account, so the
 * trigger split cleanly in two: a payout without an account was accepted having
 * skipped the lookup, and a payout naming any account was refused outright with
 * SQLSTATE 42703, whatever currency it was in. The comparison the trigger
 * exists to make had never run once. `20260921090000_payout_currency_trigger_repair`
 * corrects the column name and changes nothing else.
 *
 * None of this is reachable through the stub in `./helpers/prisma-stub.js`,
 * which is exactly why it survived: a trigger is a claim about PostgreSQL, and
 * only PostgreSQL can answer it. The existing payout probes in
 * `packages/db/scripts/phase2-probes.mjs` all leave `connectedAccountId` null,
 * so every one of them took the early return and none reached the defect.
 *
 * Runs against `TEST_DATABASE_URL`. With `REQUIRE_DATABASE` set it fails rather
 * than skips, because a suite that skipped reads exactly like a suite that
 * passed.
 *
 * @module @desi-event/api/tests/payout-currency-trigger
 */

import { expect, it } from 'vitest'

import { connectTestDatabase } from './helpers/database.js'

const { prisma, when } = await connectTestDatabase('the payout currency trigger suite')

/** A suffix unique to this run, so two runs cannot collide on a slug or an id. */
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`

/** How many worlds this file has built, so each one gets its own identifiers. */
let worlds = 0

/**
 * An organisation, optionally with a connected account declaring a currency.
 *
 * Every row is created inside one interactive transaction that the caller
 * rolls back, so the suite leaves nothing behind and two cases cannot see each
 * other's accounts.
 *
 * @param {object} tx A Prisma transaction client.
 * @param {(string|null|undefined)} defaultCurrency The account's declared currency, `null` for an account that declares none, or `undefined` for no account at all.
 * @returns {Promise<{organizationId: string, connectedAccountId: (string|null)}>} The identifiers the payout will need.
 */
async function buildWorld(tx, defaultCurrency) {
  const n = (worlds += 1)
  const organization = await tx.organization.create({
    data: {
      name: `Payout trigger world ${n}`,
      slug: `payout-trigger-${RUN}-${n}`,
      contactEmail: `payout-trigger-${RUN}-${n}@example.test`,
    },
  })

  if (defaultCurrency === undefined) {
    return { organizationId: organization.id, connectedAccountId: null }
  }

  const account = await tx.connectedAccount.create({
    data: {
      organizationId: organization.id,
      provider: 'probe',
      providerAccountId: `mockacct_${RUN}_${n}`,
      providerMode: 'test',
      country: 'IN',
      defaultCurrency,
    },
  })

  return { organizationId: organization.id, connectedAccountId: account.id }
}

/**
 * Run one case inside a transaction that is always rolled back.
 *
 * The rollback is the cleanup. It also means a case that *should* be refused
 * can be asserted on without leaving a half-built world behind, because the
 * refusal aborts the same transaction the fixtures were built in.
 *
 * @param {function(object): Promise<unknown>} body What to do with the transaction client.
 * @returns {Promise<unknown>} Whatever `body` resolved to, when it resolved.
 */
function inRolledBackTransaction(body) {
  const rollback = Symbol('rollback')

  return prisma
    .$transaction(async (tx) => {
      const value = await body(tx)

      throw Object.assign(new Error('rollback'), { [rollback]: true, value })
    })
    .catch((error) => {
      if (error?.[rollback]) return error.value

      throw error
    })
}

when()('desi_payout_currency_matches', () => {
  it('accepts a payout that names no connected account', async () => {
    const created = await inRolledBackTransaction(async (tx) => {
      const world = await buildWorld(tx, undefined)

      return tx.payout.create({
        data: {
          organizationId: world.organizationId,
          provider: 'probe',
          amountCents: 1000,
          currency: 'INR',
        },
      })
    })

    expect(created.connectedAccountId).toBeNull()
    expect(created.currency).toBe('INR')
  })

  it('accepts a payout in the currency its connected account declares', async () => {
    const created = await inRolledBackTransaction(async (tx) => {
      const world = await buildWorld(tx, 'INR')

      return tx.payout.create({
        data: {
          organizationId: world.organizationId,
          connectedAccountId: world.connectedAccountId,
          provider: 'probe',
          amountCents: 1000,
          currency: 'INR',
        },
      })
    })

    expect(created.connectedAccountId).not.toBeNull()
    expect(created.currency).toBe('INR')
  })

  it('refuses a payout in a currency its connected account does not declare', async () => {
    const attempt = inRolledBackTransaction(async (tx) => {
      const world = await buildWorld(tx, 'INR')

      return tx.payout.create({
        data: {
          organizationId: world.organizationId,
          connectedAccountId: world.connectedAccountId,
          provider: 'probe',
          amountCents: 1000,
          currency: 'USD',
        },
      })
    })

    // The message, not just "it threw": before the repair this line threw too,
    // with `column "payoutCurrency" does not exist`, and a bare rejection
    // assertion would have called the defect a passing test.
    await expect(attempt).rejects.toThrow(/is in USD, but its connected account declares INR/u)
  })

  it('accepts any currency when the connected account declares none', async () => {
    const created = await inRolledBackTransaction(async (tx) => {
      const world = await buildWorld(tx, null)

      return tx.payout.create({
        data: {
          organizationId: world.organizationId,
          connectedAccountId: world.connectedAccountId,
          provider: 'probe',
          amountCents: 1000,
          currency: 'USD',
        },
      })
    })

    expect(created.currency).toBe('USD')
  })

  it('refuses an update that walks a payout off its account currency', async () => {
    const attempt = inRolledBackTransaction(async (tx) => {
      const world = await buildWorld(tx, 'INR')
      const payout = await tx.payout.create({
        data: {
          organizationId: world.organizationId,
          connectedAccountId: world.connectedAccountId,
          provider: 'probe',
          amountCents: 1000,
          currency: 'INR',
        },
      })

      // The trigger is BEFORE INSERT OR UPDATE. An insert-only guard would let
      // this through and leave the row in breach of its own rule.
      return tx.payout.update({ where: { id: payout.id }, data: { currency: 'USD' } })
    })

    await expect(attempt).rejects.toThrow(/is in USD, but its connected account declares INR/u)
  })

  it('reads defaultCurrency, the column that exists on ConnectedAccount', async () => {
    // The structural half of the same point. The five cases above would all
    // still pass if some later migration reintroduced a "payoutCurrency"
    // column and pointed the trigger back at it; this one says which column the
    // installed body actually names, and that the name is one the table has.
    const [{ prosrc }] = await prisma.$queryRaw`
      SELECT prosrc FROM pg_proc WHERE proname = 'desi_payout_currency_matches'
    `
    const columns = await prisma.$queryRaw`
      SELECT column_name FROM information_schema.columns
       WHERE table_schema = current_schema() AND table_name = 'ConnectedAccount'
    `
    const names = columns.map((row) => row.column_name)

    expect(prosrc).toContain('"defaultCurrency"')
    expect(prosrc).not.toContain('"payoutCurrency"')
    expect(names).toContain('defaultCurrency')
    expect(names).not.toContain('payoutCurrency')
  })
})
