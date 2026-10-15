/**
 * The traffic roll-up against real PostgreSQL.
 *
 * The control flow is pinned with a fake in `packages/db/tests/traffic-rollup.test.js`.
 * What only the database can say is said here: that the upsert's sums are
 * exact and satisfy every CHECK on `TrafficDaily`; that running it twice
 * changes nothing; that a purged day keeps its totals and is never zeroed;
 * that the lease admits exactly one worker; that a worker whose lease was
 * taken over mid-run stops before writing or deleting anything more; that a
 * day's transaction may outlast Prisma's five-second default; and that a purge
 * cut short between batches neither shrinks the day's totals nor holds back
 * the days after it.
 *
 * ## Isolation
 *
 * The roll-up reads every raw row in the table, so the days this suite counts
 * are sixty days in the past and belong to events it creates; another suite's
 * rows for today are added up by these runs too, harmlessly, and never purged
 * by them. The lease is a single row shared by every caller, so a test that
 * needs it free waits for it rather than taking it by force.
 *
 * @module worker/tests/traffic-rollup-postgres.test
 */

import { randomBytes, randomUUID } from 'node:crypto'

import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'

import {
  ROLLUP_STATE_ID,
  claimTrafficRollupLease,
  dayDate,
  releaseTrafficRollupLease,
  runTrafficRollup,
  utcDay,
} from '@desi-event/db/traffic-rollup'

import { connectTestDatabase } from './helpers/database.js'

const { prisma, when } = await connectTestDatabase('the traffic roll-up PostgreSQL suite')

const TAG = `tr${randomUUID().slice(0, 8)}`
const DAY_MS = 86_400_000

/** Midnight UTC sixty days ago: the first counted day. */
const DAY0_MS = Date.parse(`${utcDay(new Date(Date.now() - 60 * DAY_MS))}T00:00:00.000Z`)
const DAY0 = utcDay(new Date(DAY0_MS))
const DAY1 = utcDay(new Date(DAY0_MS + DAY_MS))
const DAY2 = utcDay(new Date(DAY0_MS + 2 * DAY_MS))

/** The business instant on a day: mid-morning, so it is plainly that day. */
const onDay = (offset) => new Date(DAY0_MS + offset * DAY_MS + 10 * 3_600_000)

/** A fresh 128-bit visitor code. */
const code = () => randomBytes(16).toString('hex')

/** A fresh dedupe digest. */
const digest = () => randomBytes(32).toString('hex')

const ids = { organizationId: null, eventA: null, eventB: null }

/**
 * One raw row.
 *
 * @param {string} eventId The event.
 * @param {string} day The UTC day.
 * @param {string} kind The kind.
 * @param {string} placement The place.
 * @param {string|null} visitorHash The visitor's code, or null without one.
 * @param {string|null} [source] For a page view.
 * @returns {object} The row.
 */
function raw(eventId, day, kind, placement, visitorHash, source = null) {
  return {
    eventId,
    day: dayDate(day),
    kind,
    placement,
    source,
    visitorHash,
    dedupeKey: visitorHash ? digest() : null,
  }
}

/**
 * Wait until nobody holds the lease (or the holder's has expired).
 *
 * @returns {Promise<void>}
 */
async function leaseIsFree() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const state = await prisma.trafficRollupState.findUnique({ where: { id: ROLLUP_STATE_ID } })

    if (!state?.leaseOwner || state.leaseExpiresAt.getTime() < Date.now()) return

    await new Promise((resolve) => setTimeout(resolve, 200))
  }

  throw new Error('the traffic roll-up lease stayed held by another caller for 20 seconds')
}

/**
 * This suite's daily rows, by event and day.
 *
 * @returns {Promise<Map<string, object>>} `${eventId}:${day}` → row.
 */
async function dailyRows() {
  const rows = await prisma.trafficDaily.findMany({
    where: { eventId: { in: [ids.eventA, ids.eventB] } },
  })

  return new Map(rows.map((row) => [`${row.eventId}:${utcDay(row.day)}`, row]))
}

/**
 * How many raw rows this suite has on one day.
 *
 * @param {string} day The UTC day.
 * @returns {Promise<number>} The count.
 */
function rawCount(day) {
  return prisma.trafficEvent.count({
    where: { eventId: { in: [ids.eventA, ids.eventB] }, day: dayDate(day) },
  })
}

/**
 * A row's figures without its bookkeeping columns.
 *
 * @param {object} row A `TrafficDaily` row.
 * @returns {object} Its counts and flag.
 */
function figures(row) {
  const { computedAt: _computedAt, ...rest } = row

  return rest
}

when()('the traffic roll-up against real PostgreSQL', () => {
  const v1 = code()
  const v2 = code()
  const v3 = code()

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: `Roll-up ${TAG}`, slug: `rollup-${TAG}`, contactEmail: `${TAG}@example.com` },
    })

    ids.organizationId = organization.id

    for (const key of ['eventA', 'eventB']) {
      const event = await prisma.event.create({
        data: {
          organizationId: organization.id,
          title: `Roll-up ${key} ${TAG}`,
          slug: `rollup-${key.toLowerCase()}-${TAG}`,
          summary: 'A test event.',
          description: 'A test event for the traffic roll-up.',
          category: 'MUSIC_CONCERT',
          startsAt: new Date(DAY0_MS + 90 * DAY_MS),
          endsAt: new Date(DAY0_MS + 90 * DAY_MS + 3 * 3_600_000),
        },
      })

      ids[key] = event.id
    }

    const { eventA: a, eventB: b } = ids

    await prisma.trafficEvent.createMany({
      data: [
        // Day 0, event A: every kind, source and place.
        raw(a, DAY0, 'PAGE_VIEW', 'EVENT_PAGE', v1, 'DIRECT'),
        raw(a, DAY0, 'PAGE_VIEW', 'EVENT_PAGE', v1, 'SEARCH'),
        raw(a, DAY0, 'PAGE_VIEW', 'EVENT_PAGE', v2, 'SOCIAL'),
        raw(a, DAY0, 'PAGE_VIEW', 'EVENT_PAGE', null, 'INTERNAL'),
        raw(a, DAY0, 'PAGE_VIEW', 'EVENT_PAGE', null, 'OTHER'),
        raw(a, DAY0, 'CARD_CLICK', 'HOME', v1),
        raw(a, DAY0, 'CARD_CLICK', 'LISTING', v2),
        raw(a, DAY0, 'CARD_CLICK', 'SEARCH', null),
        raw(a, DAY0, 'TICKETS_CLICK', 'EVENT_PAGE', v1),
        raw(a, DAY0, 'SEATS_CLICK', 'EVENT_PAGE', v1),
        raw(a, DAY0, 'SEATS_CLICK', 'EVENT_PAGE', v2),
        raw(a, DAY0, 'WEBSITE_REDIRECT', 'EVENT_PAGE', v1),
        raw(a, DAY0, 'WEBSITE_REDIRECT', 'EVENT_PAGE', v1),
        raw(a, DAY0, 'WEBSITE_REDIRECT', 'EVENT_PAGE', null),
        // Day 0, event B: one view, so the groups are per event.
        raw(b, DAY0, 'PAGE_VIEW', 'EVENT_PAGE', v1, 'INTERNAL'),
        // Day 1.
        raw(a, DAY1, 'PAGE_VIEW', 'EVENT_PAGE', v3, 'DIRECT'),
        raw(a, DAY1, 'PAGE_VIEW', 'EVENT_PAGE', v3, 'DIRECT'),
        raw(b, DAY1, 'PAGE_VIEW', 'EVENT_PAGE', null, 'OTHER'),
        // Day 2.
        raw(a, DAY2, 'CARD_CLICK', 'SEARCH', v2),
      ],
    })

    // A demonstration row on a day that has real visits: a real count must
    // replace it and clear the flag.
    await prisma.trafficDaily.create({
      data: {
        eventId: a,
        day: dayDate(DAY1),
        views: 40,
        visitors: 30,
        viewsDirect: 40,
        demonstration: true,
        computedAt: new Date(DAY0_MS),
      },
    })

    // A salt for a day long over, which every run discards.
    await prisma.trafficSalt.createMany({
      data: [{ day: new Date(DAY0_MS - DAY_MS), salt: randomBytes(32).toString('hex') }],
      skipDuplicates: true,
    })
  })

  beforeEach(leaseIsFree)

  afterAll(async () => {
    await prisma.event.deleteMany({ where: { organizationId: ids.organizationId ?? '' } })
    await prisma.organization.deleteMany({ where: { slug: `rollup-${TAG}` } })
    await prisma.trafficSalt.deleteMany({ where: { day: new Date(DAY0_MS - DAY_MS) } })
    await prisma.trafficRollupState.updateMany({
      where: { id: ROLLUP_STATE_ID, leaseOwner: { startsWith: TAG } },
      data: { leaseOwner: null, leaseExpiresAt: null },
    })
    await prisma.$disconnect()
  })

  it('adds every day up exactly, within every CHECK, purging nothing the day after', async () => {
    const summary = await runTrafficRollup(prisma, { workerId: `${TAG}-1`, now: onDay(1) })

    expect(summary.claimed).toBe(true)
    expect(summary.leaseLost).toBe(false)
    expect(summary.days).toBeGreaterThanOrEqual(3)
    expect(await rawCount(DAY0)).toBe(15)

    const rows = await dailyRows()

    expect(figures(rows.get(`${ids.eventA}:${DAY0}`))).toEqual({
      eventId: ids.eventA,
      day: dayDate(DAY0),
      views: 5,
      visitors: 2,
      anonymousViews: 2,
      viewsDirect: 1,
      viewsInternal: 1,
      viewsSearch: 1,
      viewsSocial: 1,
      viewsOther: 1,
      cardClicks: 3,
      cardClicksHome: 1,
      cardClicksListing: 1,
      cardClicksSearch: 1,
      ticketClicks: 1,
      seatClicks: 2,
      ticketClickVisitors: 2,
      websiteRedirects: 3,
      websiteRedirectVisitors: 1,
      demonstration: false,
    })
    expect(rows.get(`${ids.eventB}:${DAY0}`)).toMatchObject({
      views: 1,
      visitors: 1,
      viewsInternal: 1,
      cardClicks: 0,
    })
    // The demonstration row is replaced by the real count, flag cleared.
    expect(rows.get(`${ids.eventA}:${DAY1}`)).toMatchObject({
      views: 2,
      visitors: 1,
      viewsDirect: 2,
      demonstration: false,
    })
    expect(rows.get(`${ids.eventB}:${DAY1}`)).toMatchObject({
      views: 1,
      visitors: 0,
      anonymousViews: 1,
      viewsOther: 1,
    })
    expect(rows.get(`${ids.eventA}:${DAY2}`)).toMatchObject({
      views: 0,
      cardClicks: 1,
      cardClicksSearch: 1,
    })
    expect(rows.get(`${ids.eventA}:${DAY0}`).computedAt.getTime()).toBe(onDay(1).getTime())

    const salt = await prisma.trafficSalt.findUnique({ where: { day: new Date(DAY0_MS - DAY_MS) } })

    expect(salt).toBeNull()
  })

  it('gives the same totals when run again', async () => {
    const before = await dailyRows()

    await runTrafficRollup(prisma, { workerId: `${TAG}-2`, now: onDay(1) })

    const after = await dailyRows()

    expect(after.size).toBe(before.size)

    for (const [key, row] of before) expect(figures(after.get(key))).toEqual(figures(row))
  })

  it('purges a day two days old after adding it up, with a past business day and the real lease clock', async () => {
    const before = await dailyRows()

    const summary = await runTrafficRollup(prisma, { workerId: `${TAG}-3`, now: onDay(2) })

    expect(summary.rowsPurged).toBeGreaterThanOrEqual(15)
    expect(await rawCount(DAY0)).toBe(0)
    expect(await rawCount(DAY1)).toBe(3)

    const after = await dailyRows()

    expect(figures(after.get(`${ids.eventA}:${DAY0}`))).toEqual(
      figures(before.get(`${ids.eventA}:${DAY0}`)),
    )
  })

  it('never zeroes a purged day: a day with no raw rows is not touched', async () => {
    const before = await dailyRows()

    await runTrafficRollup(prisma, { workerId: `${TAG}-4`, now: onDay(3) })

    const after = await dailyRows()

    expect(await rawCount(DAY1)).toBe(0)
    expect(figures(after.get(`${ids.eventA}:${DAY0}`))).toEqual(
      figures(before.get(`${ids.eventA}:${DAY0}`)),
    )
    expect(after.get(`${ids.eventA}:${DAY0}`).computedAt.getTime()).toBe(
      before.get(`${ids.eventA}:${DAY0}`).computedAt.getTime(),
    )
    expect(figures(after.get(`${ids.eventA}:${DAY1}`))).toEqual(
      figures(before.get(`${ids.eventA}:${DAY1}`)),
    )
  })

  it('records when a run finished, on the real clock, and leaves the lease free', async () => {
    const started = Date.now()

    await runTrafficRollup(prisma, { workerId: `${TAG}-5`, now: onDay(3) })

    const state = await prisma.trafficRollupState.findUnique({ where: { id: ROLLUP_STATE_ID } })

    expect(state.lastCompletedAt.getTime()).toBeGreaterThanOrEqual(started - 1000)
    expect(state.leaseOwner).toBeNull()
    expect(state.leaseExpiresAt).toBeNull()
  })

  it('lets exactly one of two workers claim the lease at once', async () => {
    const results = await Promise.all([
      claimTrafficRollupLease(prisma, { workerId: `${TAG}-a`, leaseMs: 30_000 }),
      claimTrafficRollupLease(prisma, { workerId: `${TAG}-b`, leaseMs: 30_000 }),
    ])

    expect(results.filter(Boolean)).toHaveLength(1)

    const holder = results[0] ? `${TAG}-a` : `${TAG}-b`
    const other = await runTrafficRollup(prisma, { workerId: `${TAG}-c`, now: onDay(3) })

    expect(other).toEqual({
      claimed: false,
      leaseLost: false,
      days: 0,
      rowsPurged: 0,
      saltsDiscarded: 0,
    })

    // Only the holder can give it back.
    await expect(
      releaseTrafficRollupLease(prisma, { workerId: `${TAG}-c`, completed: true }),
    ).resolves.toBe(false)
    await expect(
      releaseTrafficRollupLease(prisma, { workerId: holder, completed: false }),
    ).resolves.toBe(true)
  })

  it('takes over a lease that has expired', async () => {
    await prisma.trafficRollupState.update({
      where: { id: ROLLUP_STATE_ID },
      data: { leaseOwner: `${TAG}-ghost`, leaseExpiresAt: new Date(Date.now() - 1000) },
    })

    const summary = await runTrafficRollup(prisma, { workerId: `${TAG}-d`, now: onDay(3) })

    expect(summary.claimed).toBe(true)
  })

  it('stops when another worker takes the lease mid-run, before writing or deleting anything more', async () => {
    // Day 2 still has its raw row; day 3 gets one. With the business day at
    // day 5 both would be added up and purged, day 2 first.
    const DAY3 = utcDay(new Date(DAY0_MS + 3 * DAY_MS))

    await prisma.trafficEvent.createMany({
      data: [raw(ids.eventA, DAY3, 'PAGE_VIEW', 'EVENT_PAGE', code(), 'DIRECT')],
    })

    const before = await dailyRows()
    const lastCompleted = (
      await prisma.trafficRollupState.findUnique({ where: { id: ROLLUP_STATE_ID } })
    ).lastCompletedAt
    let transactions = 0

    // The real client, except that just before the second day's transaction
    // another worker takes the lease over.
    const stolenMidway = new Proxy(prisma, {
      get(target, property) {
        if (property !== '$transaction') return Reflect.get(target, property)

        return async (fn) => {
          transactions += 1

          if (transactions === 2) {
            await target.trafficRollupState.update({
              where: { id: ROLLUP_STATE_ID },
              data: { leaseOwner: `${TAG}-thief`, leaseExpiresAt: new Date(Date.now() + 60_000) },
            })
          }

          return target.$transaction(fn)
        }
      },
    })

    const summary = await runTrafficRollup(stolenMidway, {
      workerId: `${TAG}-victim`,
      now: onDay(5),
    })

    expect(summary.claimed).toBe(true)
    expect(summary.leaseLost).toBe(true)
    expect(summary.days).toBe(1)
    // Day 2 was added up and purged before the theft; day 3 is neither added
    // up nor deleted.
    expect(await rawCount(DAY2)).toBe(0)
    expect(await rawCount(DAY3)).toBe(1)

    const after = await dailyRows()

    expect(figures(after.get(`${ids.eventA}:${DAY2}`))).toEqual(
      figures(before.get(`${ids.eventA}:${DAY2}`)),
    )
    expect(after.has(`${ids.eventA}:${DAY3}`)).toBe(false)

    const state = await prisma.trafficRollupState.findUnique({ where: { id: ROLLUP_STATE_ID } })

    // The thief's lease is untouched, and the victim recorded no completion.
    expect(state.leaseOwner).toBe(`${TAG}-thief`)
    expect(state.lastCompletedAt?.getTime() ?? null).toBe(lastCompleted?.getTime() ?? null)

    await prisma.trafficRollupState.update({
      where: { id: ROLLUP_STATE_ID },
      data: { leaseOwner: null, leaseExpiresAt: null },
    })
    await prisma.trafficEvent.deleteMany({ where: { eventId: ids.eventA, day: dayDate(DAY3) } })
  })

  it('gives a busy day’s transaction more than Prisma’s five-second default', async () => {
    const DAY = utcDay(new Date(DAY0_MS - 10 * DAY_MS))

    await prisma.trafficEvent.createMany({
      data: [raw(ids.eventA, DAY, 'PAGE_VIEW', 'EVENT_PAGE', code(), 'DIRECT')],
    })

    // Prisma's default really is five seconds on this client: a transaction
    // that outlasts it is refused, which is what held a busy day back for good.
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_sleep(5.5)`

        return tx.trafficRollupState.count()
      }),
    ).rejects.toMatchObject({ code: 'P2028' })

    let slowed = false
    // The real client, except that the first transaction of the run takes
    // five and a half seconds before it starts its work, as a busy day's sums do.
    const busy = new Proxy(prisma, {
      get(target, property) {
        if (property !== '$transaction') return Reflect.get(target, property)

        return (fn, options) =>
          target.$transaction(async (tx) => {
            if (!slowed) {
              slowed = true
              await tx.$executeRaw`SELECT pg_sleep(5.5)`
            }

            return fn(tx)
          }, options)
      },
    })

    const summary = await runTrafficRollup(busy, { workerId: `${TAG}-busy`, now: onDay(-5) })

    expect(slowed).toBe(true)
    expect(summary).toMatchObject({ claimed: true, leaseLost: false })
    expect(summary.days).toBeGreaterThanOrEqual(1)
    expect(await rawCount(DAY)).toBe(0)
    expect((await dailyRows()).get(`${ids.eventA}:${DAY}`)).toMatchObject({
      views: 1,
      visitors: 1,
      viewsDirect: 1,
    })
  })

  it('leaves a day’s totals whole when its purge is cut short, and carries on with the later days', async () => {
    const DAY_A = utcDay(new Date(DAY0_MS - 9 * DAY_MS))
    const DAY_B = utcDay(new Date(DAY0_MS - 8 * DAY_MS))

    await prisma.trafficEvent.createMany({
      data: [
        ...Array.from({ length: 5 }, () =>
          raw(ids.eventA, DAY_A, 'PAGE_VIEW', 'EVENT_PAGE', code(), 'DIRECT'),
        ),
        raw(ids.eventA, DAY_B, 'PAGE_VIEW', 'EVENT_PAGE', code(), 'SEARCH'),
      ],
    })

    const lastCompleted = (
      await prisma.trafficRollupState.findUnique({ where: { id: ROLLUP_STATE_ID } })
    ).lastCompletedAt
    const fault = Object.assign(new Error('connection lost mid-purge'), { code: 'P1017' })
    let transactions = 0
    // The real client, except that the run's second transaction — day A's
    // first further purge batch, two rows a batch — fails.
    const cutShort = new Proxy(prisma, {
      get(target, property) {
        if (property !== '$transaction') return Reflect.get(target, property)

        return async (fn, options) => {
          transactions += 1

          if (transactions === 2) throw fault

          return target.$transaction(fn, options)
        }
      },
    })

    await expect(
      runTrafficRollup(cutShort, { workerId: `${TAG}-cut`, now: onDay(-5), purgeBatchRows: 2 }),
    ).rejects.toBe(fault)

    // Day A: added up whole, two of its five raw rows deleted. Day B, after
    // it: added up and purged all the same.
    expect(await rawCount(DAY_A)).toBe(3)
    expect(await rawCount(DAY_B)).toBe(0)

    let rows = await dailyRows()

    expect(rows.get(`${ids.eventA}:${DAY_A}`)).toMatchObject({ views: 5, visitors: 5 })
    expect(rows.get(`${ids.eventA}:${DAY_B}`)).toMatchObject({ views: 1, viewsSearch: 1 })

    let state = await prisma.trafficRollupState.findUnique({ where: { id: ROLLUP_STATE_ID } })

    // The lease is given back, and an unfinished run is not a completion.
    expect(state.leaseOwner).toBeNull()
    expect(state.lastCompletedAt?.getTime() ?? null).toBe(lastCompleted?.getTime() ?? null)

    // The next run finds three raw rows of a day whose totals are final: it
    // deletes them and keeps the sums of all five.
    const summary = await runTrafficRollup(prisma, {
      workerId: `${TAG}-finish`,
      now: onDay(-4),
      purgeBatchRows: 2,
    })

    expect(summary.rowsPurged).toBeGreaterThanOrEqual(3)
    expect(await rawCount(DAY_A)).toBe(0)

    rows = await dailyRows()

    expect(rows.get(`${ids.eventA}:${DAY_A}`)).toMatchObject({ views: 5, visitors: 5 })
    expect(rows.get(`${ids.eventA}:${DAY_A}`).computedAt.getTime()).toBe(onDay(-5).getTime())

    state = await prisma.trafficRollupState.findUnique({ where: { id: ROLLUP_STATE_ID } })

    expect(state.lastCompletedAt).not.toBeNull()
  })

  it('deletes an event’s visits with it', async () => {
    await prisma.trafficEvent.createMany({
      data: [raw(ids.eventB, DAY2, 'PAGE_VIEW', 'EVENT_PAGE', code(), 'DIRECT')],
    })

    await prisma.event.delete({ where: { id: ids.eventB } })

    expect(await prisma.trafficEvent.count({ where: { eventId: ids.eventB } })).toBe(0)
    expect(await prisma.trafficDaily.count({ where: { eventId: ids.eventB } })).toBe(0)
  })
})
