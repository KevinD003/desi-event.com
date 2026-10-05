/**
 * Reading visits back: one organisation's event pages, and every event for the
 * platform's administrators.
 *
 * Only the daily totals (`TrafficDaily`) and the roll-up's state row are read
 * here — never the raw counted moments — so no screen can touch a row that
 * carries a visitor code.
 *
 * ## Days
 *
 * Visits are counted in whole UTC days. A window's `from` is the day it falls
 * on; its `to` is exclusive, so a `to` at midnight ends the day before, and it
 * is capped at today. Absent `from` means every recorded day. The per-day
 * series is capped at the latest 366 days; the totals always cover the whole
 * window.
 *
 * ## Paid orders
 *
 * "Orders paid" here are orders whose `paidAt` falls in the window's UTC days
 * and which are still paid: an order refunded later is not counted as paid.
 * This is a different measurement from the funnel's "Orders paid" (created in
 * the window, now paid), and the two are labelled apart.
 *
 * ## Deleted events
 *
 * Listed, with `deleted` set: they were seen and sold before they were taken
 * down, and their daily totals are kept.
 *
 * @module @desi-event/api/lib/traffic-report
 */

import { EVENT_STATUSES, buildPaginationMeta, toSkipTake } from '@desi-event/schemas'
import { PUBLICLY_VISIBLE_STATUSES } from '@desi-event/schemas/lifecycle'
import { CARD_PLACEMENTS, TRAFFIC_SOURCES } from '@desi-event/schemas/traffic-vocabulary'

import { dayDate, utcDay } from './traffic.js'

/** The longest per-day series a payload carries. */
export const SERIES_LIMIT_DAYS = 366

/** The most events an organisation's list carries, as the other breakdowns do. */
export const EVENT_LIST_LIMIT = 200

/** How many events the platform's "most visited" block lists. */
export const TOP_EVENTS = 10

/** Figures older than this are stale: the roll-up has stopped finishing. */
export const TRAFFIC_STALE_AFTER_MS = 2 * 60 * 60 * 1000

/** The roll-up's state row. */
export const ROLLUP_STATE_ID = 'traffic-rollup'

/** The status a deleted event carries, once the status exists. */
export const DELETED_STATUS = 'DELETED'

/** Every daily column a report adds up. */
export const TRAFFIC_SUM_FIELDS = Object.freeze([
  'views',
  'visitors',
  'anonymousViews',
  'viewsDirect',
  'viewsInternal',
  'viewsSearch',
  'viewsSocial',
  'viewsOther',
  'cardClicks',
  'cardClicksHome',
  'cardClicksListing',
  'cardClicksSearch',
  'ticketClicks',
  'seatClicks',
  'ticketClickVisitors',
  'websiteRedirects',
  'websiteRedirectVisitors',
])

/** The daily column each source's views are kept in. */
const SOURCE_COLUMNS = Object.freeze({
  DIRECT: 'viewsDirect',
  INTERNAL: 'viewsInternal',
  SEARCH: 'viewsSearch',
  SOCIAL: 'viewsSocial',
  OTHER: 'viewsOther',
})

/** The daily column each card place's clicks are kept in. */
const PLACEMENT_COLUMNS = Object.freeze({
  HOME: 'cardClicksHome',
  LISTING: 'cardClicksListing',
  SEARCH: 'cardClicksSearch',
})

const DAY_MS = 86_400_000

/** `{ field: true }` for every summed column. */
const SUM_ALL = Object.freeze(Object.fromEntries(TRAFFIC_SUM_FIELDS.map((field) => [field, true])))

/**
 * The window in whole UTC days.
 *
 * @param {object} params Inputs.
 * @param {Date|null} [params.from] Inclusive start instant.
 * @param {Date|null} [params.to] Exclusive end instant.
 * @param {Date} params.now The current instant.
 * @returns {{firstDay: string|null, lastDay: string}} The days.
 */
export function trafficWindow({ from = null, to = null, now }) {
  const today = utcDay(now)
  const asked = to ? utcDay(new Date(to.getTime() - 1)) : today

  return { firstDay: from ? utcDay(from) : null, lastDay: asked < today ? asked : today }
}

/**
 * The Prisma filter for a window's days.
 *
 * @param {{firstDay: string|null, lastDay: string}} window The days.
 * @returns {object} A `day` filter.
 */
function dayFilter({ firstDay, lastDay }) {
  return { ...(firstDay ? { gte: dayDate(firstDay) } : {}), lte: dayDate(lastDay) }
}

/**
 * The Prisma filter for orders paid on a window's days.
 *
 * @param {{firstDay: string|null, lastDay: string}} window The days.
 * @returns {object} A `paidAt` filter.
 */
function paidFilter({ firstDay, lastDay }) {
  return {
    ...(firstDay ? { gte: dayDate(firstDay) } : {}),
    lt: new Date(dayDate(lastDay).getTime() + DAY_MS),
  }
}

/**
 * A share as a percentage with one decimal.
 *
 * @param {number} part The numerator.
 * @param {number} whole The denominator.
 * @returns {number|null} The percentage, or null when there is nothing to divide by.
 */
export function percent1(part, whole) {
  return whole === 0 ? null : Math.round((part / whole) * 1000) / 10
}

/**
 * A grouped `_sum` as plain numbers: Prisma gives null for a group with no values.
 *
 * @param {object|undefined} sum A `_sum` block.
 * @returns {Record<string, number>} Every summed field, as a number.
 */
function sumsOf(sum) {
  return Object.fromEntries(TRAFFIC_SUM_FIELDS.map((field) => [field, Number(sum?.[field] ?? 0)]))
}

/**
 * Every day from the start to `lastDay`, with zeros where nothing was counted.
 *
 * @param {Array<{day: string}>} rows Per-day figures, by UTC day.
 * @param {object} params Inputs.
 * @param {string|null} params.firstDay The window's first day, if it has one.
 * @param {string} params.lastDay The window's last day.
 * @param {function(string): object} [params.zero] The figures of an empty day.
 * @returns {{byDay: Array<object>, seriesTruncated: boolean}} The series.
 */
export function zeroFilledSeries(rows, { firstDay, lastDay, zero = () => ({}) }) {
  const byKey = new Map(rows.map((row) => [row.day, row]))
  const earliest = rows.reduce(
    (least, row) => (least === null || row.day < least ? row.day : least),
    null,
  )
  let start = firstDay ?? earliest ?? lastDay
  let seriesTruncated = false

  const end = dayDate(lastDay).getTime()
  const oldestDrawn = end - (SERIES_LIMIT_DAYS - 1) * DAY_MS

  if (dayDate(start).getTime() < oldestDrawn) {
    start = utcDay(new Date(oldestDrawn))
    seriesTruncated = true
  }

  const byDay = []

  for (let at = dayDate(start).getTime(); at <= end; at += DAY_MS) {
    const day = utcDay(new Date(at))

    byDay.push({ ...zero(day), ...byKey.get(day), day })
  }

  return { byDay, seriesTruncated }
}

/**
 * How fresh the daily totals are.
 *
 * @param {object} prisma A Prisma client.
 * @param {Date} now The current instant.
 * @returns {Promise<{updatedAt: Date|null, stale: boolean}>} When they were last brought up to date.
 */
async function freshness(prisma, now) {
  const state = await prisma.trafficRollupState.findUnique({
    where: { id: ROLLUP_STATE_ID },
    select: { lastCompletedAt: true },
  })
  const updatedAt = state?.lastCompletedAt ?? null

  return {
    updatedAt,
    stale: updatedAt !== null && now.getTime() - updatedAt.getTime() > TRAFFIC_STALE_AFTER_MS,
  }
}

/**
 * Whether any daily row being summed was written by the development seed.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} where A `TrafficDaily` filter.
 * @returns {Promise<boolean>} True when one was.
 */
async function anyDemonstration(prisma, where) {
  const row = await prisma.trafficDaily.findFirst({
    where: { ...where, demonstration: true },
    select: { eventId: true },
  })

  return Boolean(row)
}

/**
 * One event's row, as both lists carry it.
 *
 * @param {object} event The event's columns.
 * @param {Record<string, number>} sums Its window sums.
 * @param {number} ordersPaid Its paid orders in the window.
 * @returns {object} The row.
 */
function eventRow(event, sums, ordersPaid) {
  return {
    eventId: event.id,
    title: event.title,
    slug: event.slug,
    status: event.status,
    deleted: event.status === DELETED_STATUS,
    startsAt: event.startsAt,
    views: sums.views,
    visitors: sums.visitors,
    cardClicks: sums.cardClicks,
    ticketClicks: sums.ticketClicks,
    seatClicks: sums.seatClicks,
    websiteRedirects: sums.websiteRedirects,
    websiteLinkOn: event.websiteRedirectEnabled === true,
    ordersPaid,
  }
}

/** The event columns a row needs. */
const EVENT_ROW_SELECT = Object.freeze({
  id: true,
  title: true,
  slug: true,
  status: true,
  startsAt: true,
  websiteRedirectEnabled: true,
})

/**
 * The `traffic` branch of the organiser's analytics.
 *
 * Scoped to the organisation's events. An `eventId` narrows it and never
 * widens it: an event of another organisation matches nothing, so the figures
 * are zero and `event` is null.
 *
 * The route also passes `administrator` (whether the reader holds
 * `website_redirect:manage`). It is area W's to read, in
 * `websiteRedirectState(event, { administrator })`, once that exists; until
 * then `event.websiteRedirect` is null and nothing here depends on it.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} params Inputs.
 * @param {string} params.organizationId Whose events.
 * @param {string|null} [params.eventId] One of them.
 * @param {Date|null} [params.from] Window start.
 * @param {Date|null} [params.to] Window end, exclusive.
 * @param {Date} params.now The current instant.
 * @returns {Promise<object>} The `analyticsTrafficSchema` object.
 */
export async function trafficSummary(
  prisma,
  { organizationId, eventId = null, from = null, to = null, now },
) {
  if (!organizationId) {
    throw new TypeError('Visits are always read for one organisation.')
  }

  const window = trafficWindow({ from, to, now })
  const scope = { organizationId, ...(eventId ? { id: eventId } : {}) }
  const dailyWhere = { event: scope, day: dayFilter(window) }

  const [perDay, paid, listed, fresh, includesDemonstration, narrowed] = await Promise.all([
    prisma.trafficDaily.groupBy({
      by: ['day'],
      where: dailyWhere,
      _sum: SUM_ALL,
      orderBy: { day: 'asc' },
    }),
    // Two columns, grouped here by day and by event: a database day bucket
    // would need raw SQL, and these rows are the organisation's own.
    prisma.order.findMany({
      where: { event: scope, status: 'PAID', paidAt: paidFilter(window) },
      select: { eventId: true, paidAt: true },
    }),
    eventId
      ? []
      : prisma.event.findMany({
          where: { organizationId },
          select: EVENT_ROW_SELECT,
          orderBy: [{ startsAt: 'desc' }, { id: 'asc' }],
          take: EVENT_LIST_LIMIT,
        }),
    freshness(prisma, now),
    anyDemonstration(prisma, dailyWhere),
    eventId
      ? prisma.event.findFirst({ where: { id: eventId, organizationId }, select: EVENT_ROW_SELECT })
      : null,
  ])

  const paidByDay = new Map()
  const paidByEvent = new Map()

  for (const order of paid) {
    if (!order.paidAt) continue

    const day = utcDay(order.paidAt)

    paidByDay.set(day, (paidByDay.get(day) ?? 0) + 1)
    paidByEvent.set(order.eventId, (paidByEvent.get(order.eventId) ?? 0) + 1)
  }

  const totals = sumsOf({})
  const dayRows = perDay.map((group) => {
    const sums = sumsOf(group._sum)

    for (const field of TRAFFIC_SUM_FIELDS) totals[field] += sums[field]

    return { day: utcDay(group.day), ...sums }
  })

  const series = zeroFilledSeries(dayRows, {
    firstDay: window.firstDay,
    lastDay: window.lastDay,
    zero: () => sumsOf({}),
  })

  const perEvent =
    listed.length === 0
      ? []
      : await prisma.trafficDaily.groupBy({
          by: ['eventId'],
          where: { eventId: { in: listed.map((event) => event.id) }, day: dayFilter(window) },
          _sum: SUM_ALL,
        })
  const sumsByEvent = new Map(perEvent.map((group) => [group.eventId, sumsOf(group._sum)]))
  const ordersPaid = paid.length

  return {
    timeZone: 'UTC',
    firstDay: window.firstDay ?? dayRows[0]?.day ?? null,
    lastDay: window.lastDay,
    updatedAt: fresh.updatedAt,
    stale: fresh.stale,
    includesDemonstration,
    totals: {
      views: totals.views,
      visitors: totals.visitors,
      anonymousViews: totals.anonymousViews,
      cardClicks: totals.cardClicks,
      ticketClicks: totals.ticketClicks,
      seatClicks: totals.seatClicks,
      ticketClickVisitors: totals.ticketClickVisitors,
      websiteRedirects: totals.websiteRedirects,
      websiteRedirectVisitors: totals.websiteRedirectVisitors,
    },
    sources: TRAFFIC_SOURCES.map((source) => ({
      source,
      views: totals[SOURCE_COLUMNS[source]],
    })),
    cardPlacements: CARD_PLACEMENTS.map((placement) => ({
      placement,
      clicks: totals[PLACEMENT_COLUMNS[placement]],
    })),
    byDay: series.byDay.map((day) => ({
      day: day.day,
      views: day.views,
      visitors: day.visitors,
      cardClicks: day.cardClicks,
      ticketClicks: day.ticketClicks,
      seatClicks: day.seatClicks,
      websiteRedirects: day.websiteRedirects,
      ordersPaid: paidByDay.get(day.day) ?? 0,
    })),
    seriesTruncated: series.seriesTruncated,
    byEvent: listed.map((event) =>
      eventRow(event, sumsByEvent.get(event.id) ?? sumsOf({}), paidByEvent.get(event.id) ?? 0),
    ),
    conversion: {
      visitors: totals.visitors,
      ticketClickVisitors: totals.ticketClickVisitors,
      ordersPaid,
      visitorToOrderPercent: percent1(ordersPaid, totals.visitors),
    },
    event: narrowed
      ? {
          id: narrowed.id,
          title: narrowed.title,
          slug: narrowed.slug,
          status: narrowed.status,
          deleted: narrowed.status === DELETED_STATUS,
          startsAt: narrowed.startsAt,
          websiteLinkOn: narrowed.websiteRedirectEnabled === true,
          // The switch as insiders read it (who decided, when, why) is area W's
          // `websiteRedirectState`; until `lib/website-redirect.js` exists the
          // state is not known here and is null, which the schema allows.
          websiteRedirect: null,
        }
      : null,
  }
}

/**
 * The statuses the platform list's `public` scope covers.
 *
 * Publicly visible events, and deleted ones — they were seen and sold before
 * they were taken down — once the status exists. Read from the status
 * vocabulary rather than assumed, because naming a status the database does
 * not have makes the whole query fail.
 *
 * @param {ReadonlyArray<string>} [statuses] Every event status there is.
 * @returns {string[]} The statuses.
 */
export function publicListStatuses(statuses = EVENT_STATUSES) {
  return [
    ...PUBLICLY_VISIBLE_STATUSES,
    ...(statuses.includes(DELETED_STATUS) ? [DELETED_STATUS] : []),
  ]
}

/**
 * Every event's visits, a page at a time, for the platform's administrators.
 *
 * Counts only: no money, no buyer, no visitor code.
 *
 * @param {object} prisma A Prisma client.
 * @param {object} params The parsed `trafficEventsQuerySchema` plus `now`.
 * @param {string|null} [params.q] Matches the title, the web address or the organiser's name.
 * @param {'public'|'all'} [params.scope] Public and deleted events, or every event.
 * @param {string|null} [params.organizationId] One organisation's events only.
 * @param {string|null} [params.from] Window start, an ISO instant.
 * @param {string|null} [params.to] Window end, exclusive, an ISO instant.
 * @param {number} [params.page] The page, from 1.
 * @param {number} [params.perPage] Events a page.
 * @param {Date} params.now The current instant.
 * @returns {Promise<{data: object, pagination: object}>} The list.
 */
export async function platformTraffic(
  prisma,
  {
    q = null,
    scope = 'public',
    organizationId = null,
    from = null,
    to = null,
    page = 1,
    perPage = 20,
    now,
  },
) {
  const window = trafficWindow({
    from: from ? new Date(from) : null,
    to: to ? new Date(to) : null,
    now,
  })
  const where = {
    ...(scope === 'public' ? { status: { in: publicListStatuses() } } : {}),
    ...(organizationId ? { organizationId } : {}),
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: 'insensitive' } },
            { slug: { contains: q.toLowerCase() } },
            { organization: { name: { contains: q, mode: 'insensitive' } } },
          ],
        }
      : {}),
  }
  const select = {
    ...EVENT_ROW_SELECT,
    organization: { select: { id: true, name: true, slug: true } },
  }
  const { skip, take } = toSkipTake({ page, perPage })

  const [total, events, topGroups, fresh, earliest] = await Promise.all([
    prisma.event.count({ where }),
    prisma.event.findMany({
      where,
      orderBy: [{ startsAt: 'desc' }, { id: 'asc' }],
      skip,
      take,
      select,
    }),
    prisma.trafficDaily.groupBy({
      by: ['eventId'],
      where: { day: dayFilter(window) },
      _sum: { views: true },
      orderBy: [{ _sum: { views: 'desc' } }, { eventId: 'asc' }],
      take: TOP_EVENTS,
    }),
    freshness(prisma, now),
    // With no `from` the window starts at the platform's first counted day,
    // the same rows the top list is ranked over, as `trafficSummary` does for
    // one organisation. One row by the day index.
    window.firstDay
      ? null
      : prisma.trafficDaily.findFirst({
          where: { day: dayFilter(window) },
          orderBy: { day: 'asc' },
          select: { day: true },
        }),
  ])

  // A group of only clicks sorts after every viewed event; it is not "most viewed".
  const topIds = topGroups
    .filter((group) => Number(group._sum?.views ?? 0) > 0)
    .map((group) => group.eventId)
  const pageIds = events.map((event) => event.id)
  const missingTop = topIds.filter((id) => !pageIds.includes(id))
  const everyId = [...new Set([...pageIds, ...topIds])]

  const [topEvents, sums, paid, includesDemonstration] = await Promise.all([
    missingTop.length === 0
      ? []
      : prisma.event.findMany({ where: { id: { in: missingTop } }, select }),
    everyId.length === 0
      ? []
      : prisma.trafficDaily.groupBy({
          by: ['eventId'],
          where: { eventId: { in: everyId }, day: dayFilter(window) },
          _sum: SUM_ALL,
        }),
    everyId.length === 0
      ? []
      : prisma.order.groupBy({
          by: ['eventId'],
          where: { eventId: { in: everyId }, status: 'PAID', paidAt: paidFilter(window) },
          _count: { _all: true },
        }),
    everyId.length === 0
      ? false
      : anyDemonstration(prisma, { eventId: { in: everyId }, day: dayFilter(window) }),
  ])

  const sumsByEvent = new Map(sums.map((group) => [group.eventId, sumsOf(group._sum)]))
  const paidByEvent = new Map(paid.map((group) => [group.eventId, group._count?._all ?? 0]))
  const eventsById = new Map([...events, ...topEvents].map((event) => [event.id, event]))

  /**
   * @param {object} event An event with its organisation.
   * @returns {object} Its platform row.
   */
  const platformRow = (event) => ({
    ...eventRow(event, sumsByEvent.get(event.id) ?? sumsOf({}), paidByEvent.get(event.id) ?? 0),
    organization: event.organization,
  })

  return {
    data: {
      timeZone: 'UTC',
      firstDay: window.firstDay ?? (earliest ? utcDay(earliest.day) : null),
      lastDay: window.lastDay,
      updatedAt: fresh.updatedAt,
      stale: fresh.stale,
      includesDemonstration,
      top: topIds
        .map((id) => eventsById.get(id))
        .filter(Boolean)
        .map(platformRow),
      events: events.map(platformRow),
    },
    pagination: buildPaginationMeta({ page, perPage, total }),
  }
}
