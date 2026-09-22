/**
 * The simulated connected-account lifecycle, against a real database.
 *
 * Everything here is a claim only PostgreSQL can answer. The stub in
 * `./helpers/prisma-stub.js` now models `organizationId @unique`, which it did
 * not before this change, but a stub that models a constraint is still a stub
 * agreeing with itself — and the two properties that matter most are about what
 * happens when two statements reach one row at the same time.
 *
 * Three of these cases were the reason the design chose what it chose:
 *
 * A replayed `START` must not walk a later state backwards. An upsert would,
 * because its update branch is unconditional, and the row it produced would
 * report capabilities its own state does not mean.
 *
 * Two concurrent first-starts must collapse to one row. That is the unique
 * constraint doing it, not application logic, and the loser must get the
 * winner's row rather than an error.
 *
 * Two concurrent *different* actions must not compose into a path the
 * transition table does not contain. Under read-then-write they do:
 * `SIMULATE_DISABLE` and `SIMULATE_READY` against one `IN_PROGRESS` row land on
 * `COMPLETE`, having passed through `DISABLED` and back out.
 *
 * Runs against `TEST_DATABASE_URL`. With `REQUIRE_DATABASE` set it fails rather
 * than skips, because a suite that skipped reads exactly like a suite that
 * passed.
 *
 * @module @desi-event/api/tests/connect-lifecycle-integration
 */

import { CONNECT_ACTIONS } from '@desi-event/schemas'
import { afterAll, expect, it } from 'vitest'

import {
  advanceMockConnect,
  findConnectedAccount,
  mockConnectAccountId,
  startMockConnect,
  toConnectStatus,
} from '../src/lib/connect.js'
import { connectTestDatabase } from './helpers/database.js'

const { prisma, when } = await connectTestDatabase('the connect lifecycle suite')

/** A suffix unique to this run, so two runs cannot collide on a slug. */
const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`

/** How many worlds this file has built. */
let worlds = 0

/** Every organisation this file created, named in failures rather than cleaned up. */
const created = []

/** Stands in for a signed-in actor; nothing here reads anything else off it. */
const ACTOR = { id: null }

/**
 * A fresh organisation with no connected account.
 *
 * @returns {Promise<string>} The organisation id.
 */
async function world() {
  const n = (worlds += 1)
  const organization = await prisma.organization.create({
    data: {
      name: `Connect lifecycle world ${n}`,
      slug: `connect-lifecycle-${RUN}-${n}`,
      contactEmail: `connect-lifecycle-${RUN}-${n}@example.test`,
    },
  })

  created.push(organization.id)

  return organization.id
}

/**
 * Run `startMockConnect` with this suite's fixed actor.
 *
 * @param {string} organizationId Whose account.
 * @returns {Promise<object>} The outcome.
 */
function start(organizationId) {
  return startMockConnect(prisma, {
    organizationId,
    actor: ACTOR,
    requestId: `req-${RUN}-${organizationId.slice(-6)}`,
    now: new Date(),
  })
}

/**
 * Run `advanceMockConnect` with this suite's fixed actor.
 *
 * @param {string} organizationId Whose account.
 * @param {string} action Which action.
 * @returns {Promise<object>} The outcome.
 */
function advance(organizationId, action) {
  return advanceMockConnect(prisma, {
    organizationId,
    action,
    actor: ACTOR,
    requestId: `req-${RUN}-${action}`,
    now: new Date(),
  })
}

afterAll(async () => {
  // Nothing is deleted, for the reason `refund-concurrency.test.js` gives and
  // one more this suite discovered. `db:verify:fresh` builds a new database per
  // run and every organisation here carries a per-run suffix, so nothing
  // collides. And the audit rows *cannot* be deleted: an attempt returns
  // `23514 — audit rows are append-only; DELETE on … is refused`, which is the
  // immutability the privacy work put in place doing its job. A cleanup that
  // tried would fail the suite on its way out and tell whoever read the failure
  // that the lifecycle was broken.
  await prisma.$disconnect()
})

when()('the simulated lifecycle against PostgreSQL', () => {
  it('creates exactly one row, carrying its own nature in its columns', async () => {
    const organizationId = await world()

    const { account, created: madeIt } = await start(organizationId)

    expect(madeIt).toBe(true)
    expect(account.onboardingStatus).toBe('IN_PROGRESS')
    expect(account.providerMode).toBe('mock')
    expect(account.provider).toBe('in-memory-payments')
    expect(account.providerAccountId).toBe(mockConnectAccountId(organizationId))
    expect(account.providerAccountId).toMatch(/^mockacct_/u)
    // Null on purpose. payouts.schedule stamps whatever account it finds onto
    // every payout it writes, and the repaired currency trigger compares that
    // account's currency against the payout's — a fabricated value here would
    // refuse real payouts for any organisation whose currency differed.
    expect(account.defaultCurrency).toBeNull()
    expect(account.chargesEnabled).toBe(false)
    expect(account.payoutsEnabled).toBe(false)
  })

  it('refuses a second row for the same organisation at the database', async () => {
    const organizationId = await world()

    await start(organizationId)

    await expect(
      prisma.connectedAccount.create({
        data: {
          organizationId,
          provider: 'probe',
          providerAccountId: `mockacct_probe_${RUN}`,
          providerMode: 'mock',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' })
  })

  it('returns the existing row unchanged when START is replayed against COMPLETE', async () => {
    const organizationId = await world()

    await start(organizationId)
    await advance(organizationId, CONNECT_ACTIONS.SIMULATE_READY)

    const replay = await start(organizationId)

    // The defect an upsert would have shipped. Its update branch is
    // unconditional, so this would have become IN_PROGRESS with both capability
    // flags left true: an unlisted transition and a row contradicting itself.
    expect(replay.created).toBe(false)
    expect(replay.state).toBe('COMPLETE')
    expect(replay.account.chargesEnabled).toBe(true)

    const row = await findConnectedAccount(prisma, organizationId)

    expect(row.onboardingStatus).toBe('COMPLETE')
  })

  it('collapses two concurrent first-starts to one row, and both callers get it', async () => {
    const organizationId = await world()

    const [first, second] = await Promise.all([start(organizationId), start(organizationId)])

    // One created it, one replayed. Which is which is the race's business; that
    // exactly one row exists is the database's, via organizationId @unique.
    expect([first.created, second.created].filter(Boolean)).toHaveLength(1)
    expect(first.account.id).toBe(second.account.id)

    const rows = await prisma.connectedAccount.findMany({ where: { organizationId } })

    expect(rows).toHaveLength(1)
  })

  it('lets only one of two concurrent conflicting actions win', async () => {
    const organizationId = await world()

    await start(organizationId)

    const outcomes = await Promise.allSettled([
      advance(organizationId, CONNECT_ACTIONS.SIMULATE_DISABLE),
      advance(organizationId, CONNECT_ACTIONS.SIMULATE_READY),
    ])

    const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled')

    expect(fulfilled).toHaveLength(1)

    const row = await findConnectedAccount(prisma, organizationId)

    // The point of the compare-and-set. Under read-then-write both would have
    // applied and the row would read COMPLETE having passed through DISABLED —
    // a DISABLED -> COMPLETE move that is not in the table, and one that
    // re-enables an account somebody switched off.
    expect(['DISABLED', 'COMPLETE']).toContain(row.onboardingStatus)
    expect(row.onboardingStatus).toBe(fulfilled[0].value.state)

    if (row.onboardingStatus === 'DISABLED') {
      expect(row.chargesEnabled).toBe(false)
      expect(row.payoutsEnabled).toBe(false)
    }
  })

  it('walks the states and derives the flags at each one', async () => {
    const organizationId = await world()

    await start(organizationId)

    const due = await advance(organizationId, CONNECT_ACTIONS.SIMULATE_REQUIREMENTS)

    expect(due.state).toBe('REQUIREMENTS_DUE')
    expect(due.account.requirementsDue).toHaveLength(1)
    expect(due.account.payoutsEnabled).toBe(false)

    const ready = await advance(organizationId, CONNECT_ACTIONS.SIMULATE_READY)

    expect(ready.state).toBe('COMPLETE')
    expect(ready.account.chargesEnabled).toBe(true)
    expect(ready.account.payoutsEnabled).toBe(true)
    expect(ready.account.detailsSubmitted).toBe(true)
    expect(ready.account.requirementsDue).toEqual([])

    const off = await advance(organizationId, CONNECT_ACTIONS.SIMULATE_DISABLE)

    expect(off.state).toBe('DISABLED')
    expect(off.account.chargesEnabled).toBe(false)
    expect(off.account.payoutsEnabled).toBe(false)
  })

  it('refuses every move out of DISABLED', async () => {
    const organizationId = await world()

    await start(organizationId)
    await advance(organizationId, CONNECT_ACTIONS.SIMULATE_DISABLE)

    for (const action of [
      CONNECT_ACTIONS.SIMULATE_REQUIREMENTS,
      CONNECT_ACTIONS.SIMULATE_READY,
      CONNECT_ACTIONS.SIMULATE_DISABLE,
    ]) {
      await expect(advance(organizationId, action), action).rejects.toThrow(/final state/iu)
    }

    const row = await findConnectedAccount(prisma, organizationId)

    expect(row.onboardingStatus).toBe('DISABLED')
  })

  it('writes audit evidence for the refusal as well as the move', async () => {
    const organizationId = await world()

    await start(organizationId)
    await advance(organizationId, CONNECT_ACTIONS.SIMULATE_DISABLE)
    await advance(organizationId, CONNECT_ACTIONS.SIMULATE_READY).catch(() => null)

    const account = await findConnectedAccount(prisma, organizationId)
    const rows = await prisma.auditLog.findMany({
      where: { entityType: 'ConnectedAccount', entityId: account.id },
      orderBy: { createdAt: 'asc' },
    })

    expect(rows.map((row) => row.action)).toEqual([
      'connect.mock_account_created',
      'connect.mock_state_advanced',
      'connect.mock_action_refused',
    ])
    // The refusal is evidence in its own right: an operator reconstructing what
    // happened needs to see the attempt, not only the moves that succeeded.
    expect(rows.at(-1).metadata.reason).toBe('TERMINAL_STATE')
    expect(rows.at(-1).metadata.organizationId).toBe(organizationId)
  })

  it('presents a row without its provider identifier or currency', async () => {
    const organizationId = await world()

    const { account } = await start(organizationId)
    const presented = toConnectStatus(account)

    expect(Object.keys(presented).sort()).toEqual([
      'accountExists',
      'detailsSubmitted',
      'requirementsDueCount',
      'simulated',
      'simulatedChargesEnabled',
      'simulatedPayoutsEnabled',
      'state',
      'stateDescription',
      'terminal',
      'updatedAt',
    ])
  })

  it('leaves a real payout for the same organisation unaffected', async () => {
    // The one interaction this phase creates with money that already moves.
    // payouts.schedule attaches whatever connected account it finds, and the
    // repaired trigger compares currencies — so a simulated row with a null
    // currency has to leave a payout in any currency alone.
    const organizationId = await world()
    const { account } = await start(organizationId)

    const payout = await prisma.payout.create({
      data: {
        organizationId,
        connectedAccountId: account.id,
        provider: 'probe',
        amountCents: 1000,
        currency: 'CAD',
      },
    })

    expect(payout.connectedAccountId).toBe(account.id)

    await prisma.payout.delete({ where: { id: payout.id } })
  })
})
