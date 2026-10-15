/**
 * An event's booking fee (the platform fee) and its pay-at-the-venue switch:
 * the decisions of the team at The Desi Events about what buyers pay for an event and how
 * they may pay it (SPEC3 §7, §9.1).
 *
 * The only writer of `Event.feeSource`, `feePercentageBps`,
 * `feeFlatCentsPerTicket`, `feeCurrency`, `feeSettingId`, the
 * `venuePayment*` columns, `EventFeeSetting` and `EventVenuePaymentChange`
 * (source scan, SPEC3 §13).
 *
 * ## The rules both setters keep
 *
 * - **Never frozen.** Every status but DELETED may be changed, before the event
 *   is posted, while it sells, after it ends, after it is cancelled (owner's
 *   R4). A deleted event keeps its settings as they were, so a restore brings
 *   them back (`NOT_EDITABLE`). An event sold on its listing's own site has no
 *   booking fee here (`SOLD_ON_SOURCE`).
 * - **Independent.** An administrator who holds any membership in the event's
 *   organisation is refused (`CONFLICT_OF_INTEREST`, DF6).
 * - **New orders only.** Checkout reads the terms in its pricing transaction
 *   and takes no lock on the event row; the setters take `FOR NO KEY UPDATE`,
 *   which serialises them with every other event writer and never blocks an
 *   order insert's `FOR KEY SHARE` (W1). An order priced before a change
 *   completes as priced and records its terms; a buyer whose figure moved is
 *   asked to confirm the new one (`PRICE_CHANGED`, SPEC3 §6.5).
 * - **Compare-and-set.** The fee on the newest decision's sequence, the switch
 *   on the values the administrator saw. The event's revision is not changed,
 *   so an organiser's open editor is not made stale (DF7).
 * - **Bounded.** Each setter's own transaction waits behind whatever holds the
 *   event's row for a bounded time and answers 503 when it runs out
 *   (`lib/transaction-budget.js`), changing nothing.
 *
 * @module @desi-event/api/lib/payment-terms
 */

import { CAPABILITIES, can } from '@desi-event/permissions'

import { AUDIT_ACTIONS, recordAudit } from './audit.js'
import { eventFeeConfig, feeConfigFor } from './checkout-pricing.js'
import {
  PAYMENT_TERMS_SENTENCES,
  forbidden,
  httpError,
  notFound,
  paymentTermsRefusal,
} from './errors.js'
import { defaultTierCurrency } from './event-authoring.js'
import { maySeeDrafts } from './event-insiders.js'
import { TRANSACTION_BUDGETS, budgetedTransaction } from './transaction-budget.js'
import { isTransactionClient } from './transaction-client.js'
import { venuePaymentAvailable } from './venue-booking-limits.js'
import { EVENT_STILL_ON_WHERE, UNPAID_VENUE_TICKET_WHERE } from './venue-payment-filters.js'
import { FORMER_ADMINISTRATOR_NAME } from './website-redirect.js'

// Whether paying at the venue is offered lives beside its limit, so the
// presenters can ask it without importing the writers.
export { venuePaymentAvailable }

/** `EventStatus.DELETED`. */
const DELETED = 'DELETED'

/** `EventStatus.DRAFT`. */
const DRAFT = 'DRAFT'

/** How many history entries one read returns (`PAYMENT_TERMS_HISTORY_PAGE`). */
export const HISTORY_PAGE = 50

/** An event's own booking fee columns, for pricing and for the views. */
export const EVENT_FEE_SELECT = Object.freeze({
  feeSource: true,
  feePercentageBps: true,
  feeFlatCentsPerTicket: true,
  feeCurrency: true,
  feeSettingId: true,
})

/** An event's pay-at-the-venue columns. */
export const VENUE_PAYMENT_SELECT = Object.freeze({
  venuePaymentEnabled: true,
  venuePaymentLimit: true,
  venuePaymentChangedAt: true,
  venuePaymentChangedById: true,
  venuePaymentReason: true,
})

/** What the views read of an event, in one query. */
const VIEW_SELECT = Object.freeze({
  id: true,
  status: true,
  statusBeforeDeletion: true,
  organizationId: true,
  isOnline: true,
  ...EVENT_FEE_SELECT,
  ...VENUE_PAYMENT_SELECT,
  venuePaymentChangedBy: { select: { displayName: true } },
  organization: { select: { platformHeldSource: true, payoutCurrency: true } },
  ticketTypes: { select: { currency: true } },
})

/** What a setter reads of the event under its row lock. */
const SETTER_SELECT = Object.freeze({
  id: true,
  status: true,
  organizationId: true,
  isOnline: true,
  ...EVENT_FEE_SELECT,
  ...VENUE_PAYMENT_SELECT,
  organization: { select: { platformHeldSource: true, payoutCurrency: true } },
  ticketTypes: { select: { currency: true } },
})

/** What a fee change is told when it waited too long behind another change. */
const FEE_BUDGET = Object.freeze({
  budget: TRANSACTION_BUDGETS.ROW,
  refusal: PAYMENT_TERMS_SENTENCES.feeTryAgain,
})

/** What a change of the switch is told when it waited too long behind another change. */
const VENUE_BUDGET = Object.freeze({
  budget: TRANSACTION_BUDGETS.ROW,
  refusal:
    'Another change to this event was being saved at the same moment, so paying at the venue was not changed. Try again in a moment.',
})

/**
 * The currency an event sells in: its own fee's when it has one, else its
 * tiers', else its organisation's (`defaultTierCurrency`, SPEC3 DF3).
 *
 * @param {object} event An event with its fee columns, tiers and organisation.
 * @returns {string} An ISO 4217 code.
 */
export function sellingCurrency(event) {
  if (event.feeSource === 'EVENT' && event.feeCurrency) return event.feeCurrency

  return defaultTierCurrency(event)
}

/**
 * Whether an account belongs to the event's organisation in any role (the
 * conflict-of-interest rule, DF6).
 *
 * @param {object|null} actor The request actor.
 * @param {string} organizationId The event's organisation.
 * @returns {boolean} True for a member.
 */
function isMember(actor, organizationId) {
  return (actor?.memberships ?? []).some(
    (membership) => membership.organizationId === organizationId,
  )
}

/**
 * The refusals both setters give before they compare anything: no such event,
 * a deleted one, one sold on its listing's own site, or a member of its
 * organisation deciding.
 *
 * @param {object|null} event The event as read under its row lock.
 * @param {object} actor The administrator.
 * @returns {void}
 * @throws {Error} 404, 409 `NOT_EDITABLE`, 409 `SOLD_ON_SOURCE` or 403 `CONFLICT_OF_INTEREST`.
 */
function refuseUnsettable(event, actor) {
  if (!event) throw notFound('No such event.')

  if (event.status === DELETED) {
    throw httpError(409, 'NOT_EDITABLE', PAYMENT_TERMS_SENTENCES.deletedEvent)
  }

  if (event.organization?.platformHeldSource) {
    throw httpError(409, 'SOLD_ON_SOURCE', PAYMENT_TERMS_SENTENCES.soldOnSource)
  }

  if (isMember(actor, event.organizationId)) {
    throw forbidden(PAYMENT_TERMS_SENTENCES.conflictOfInterest, 'CONFLICT_OF_INTEREST')
  }
}

/**
 * Take the event's row the way every event writer does: `FOR NO KEY UPDATE`,
 * which an order insert's foreign-key check (`FOR KEY SHARE`) is not blocked by.
 *
 * @param {object} tx A transaction client.
 * @param {string} eventId The event.
 * @returns {Promise<void>} Resolves once held (or at once, for no such row).
 */
async function lockEvent(tx, eventId) {
  await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${eventId} FOR NO KEY UPDATE`
}

/**
 * The event's newest fee decision, or null.
 *
 * @param {object} db A Prisma client or transaction client.
 * @param {string} eventId The event.
 * @returns {Promise<object|null>} The `EventFeeSetting` row, with `setBy`.
 */
function latestFeeSetting(db, eventId) {
  return db.eventFeeSetting.findFirst({
    where: { eventId },
    orderBy: { sequence: 'desc' },
    include: { setBy: { select: { displayName: true } } },
  })
}

/**
 * Set an event's own booking fee, or return it to the site default (SPEC3
 * §7.1), inside a transaction.
 *
 * @param {object} tx A transaction client.
 * @param {object} params See {@link setEventFee}.
 * @returns {Promise<{eventId: string, sequence: number}>} The event and the new decision's sequence.
 */
async function setEventFeeInTransaction(tx, params) {
  const {
    eventId,
    source,
    percentageBps = null,
    flatCentsPerTicket = null,
    reason,
    expectedSequence,
    actor,
  } = params

  if (source !== 'SITE_DEFAULT' && source !== 'EVENT') {
    throw new TypeError('A booking fee is the site default or the event’s own.')
  }
  if (!actor?.id) throw new TypeError('A booking fee is set by an administrator.')

  await lockEvent(tx, eventId)

  const event = await tx.event.findUnique({ where: { id: eventId }, select: SETTER_SELECT })

  refuseUnsettable(event, actor)

  const latest = await tx.eventFeeSetting.findFirst({
    where: { eventId },
    orderBy: { sequence: 'desc' },
  })
  const currentSequence = latest?.sequence ?? 0

  if (expectedSequence !== currentSequence) {
    throw paymentTermsRefusal('PAYMENT_TERMS_CHANGED', { details: { currentSequence } })
  }

  // The event's own fee is in the currency it sells in; the request names none.
  const currency = source === 'EVENT' ? defaultTierCurrency(event) : null
  const unchanged =
    event.feeSource === source &&
    (source === 'SITE_DEFAULT' ||
      (event.feePercentageBps === percentageBps &&
        event.feeFlatCentsPerTicket === flatCentsPerTicket &&
        event.feeCurrency === currency))

  if (unchanged) throw paymentTermsRefusal('PLATFORM_FEE_UNCHANGED')

  const own = source === 'EVENT'
  const setting = await tx.eventFeeSetting.create({
    data: {
      eventId,
      sequence: currentSequence + 1,
      source,
      percentageBps: own ? percentageBps : null,
      flatCentsPerTicket: own ? flatCentsPerTicket : null,
      currency,
      reason,
      setById: actor.id,
    },
  })

  // The event's own terms point at the decision they came from; the site
  // default stores no numbers and no pointer (CHECK `event_fee_shape`).
  await tx.event.update({
    where: { id: eventId },
    data: {
      feeSource: source,
      feePercentageBps: own ? percentageBps : null,
      feeFlatCentsPerTicket: own ? flatCentsPerTicket : null,
      feeCurrency: own ? currency : null,
      feeSettingId: own ? setting.id : null,
    },
  })

  await recordAudit(tx, {
    action: AUDIT_ACTIONS.EVENT_PLATFORM_FEE_CHANGED,
    entityType: 'Event',
    entityId: eventId,
    actorId: actor.id,
    metadata: {
      sequence: setting.sequence,
      source,
      percentageBps: setting.percentageBps,
      flatCentsPerTicket: setting.flatCentsPerTicket,
      currency: setting.currency,
      previous: latest
        ? {
            sequence: latest.sequence,
            source: latest.source,
            percentageBps: latest.percentageBps,
            flatCentsPerTicket: latest.flatCentsPerTicket,
            currency: latest.currency,
          }
        : null,
      reason,
      eventStatus: event.status,
      platformRole: actor.role ?? null,
    },
  })

  return { eventId, sequence: setting.sequence }
}

/**
 * Set an event's own booking fee, or return it to the site default.
 *
 * Given a transaction client it runs there and opens none; otherwise in its
 * own bounded transaction. Authority is the caller's: the route requires
 * `payment_terms:manage` and the PAYMENT_TERMS step-up first.
 *
 * @param {object} db A Prisma client, or a transaction client already open.
 * @param {object} params Inputs.
 * @param {string} params.eventId The event.
 * @param {'SITE_DEFAULT'|'EVENT'} params.source The site default, or the event's own.
 * @param {number|null} [params.percentageBps] The event's percentage (EVENT only).
 * @param {number|null} [params.flatCentsPerTicket] The event's amount per ticket (EVENT only).
 * @param {string} params.reason Why, 10 to 500 characters.
 * @param {number} params.expectedSequence The newest decision's sequence the administrator read.
 * @param {object} params.actor The administrator: `id`, `role`, `memberships`.
 * @returns {Promise<{eventId: string, sequence: number}>} The event and the new decision's sequence.
 * @throws {Error} 404; 409 `NOT_EDITABLE`, `SOLD_ON_SOURCE`, `PAYMENT_TERMS_CHANGED`, `PLATFORM_FEE_UNCHANGED`; 403 `CONFLICT_OF_INTEREST`; 503 when it waited too long.
 */
export function setEventFee(db, params) {
  return isTransactionClient(db)
    ? setEventFeeInTransaction(db, params)
    : budgetedTransaction(db, FEE_BUDGET, (tx) => setEventFeeInTransaction(tx, params))
}

/**
 * Switch paying at the venue on or off, or change its limit (SPEC3 §9.1),
 * inside a transaction.
 *
 * @param {object} tx A transaction client.
 * @param {object} params See {@link setVenuePayment}.
 * @returns {Promise<{eventId: string}>} The event.
 */
async function setVenuePaymentInTransaction(tx, params) {
  const { eventId, enabled, limit = null, reason, seen, actor, now = new Date() } = params

  if (typeof enabled !== 'boolean') {
    throw new TypeError('Paying at the venue is switched on (true) or off (false).')
  }
  if (!actor?.id) throw new TypeError('Paying at the venue is switched by an administrator.')

  await lockEvent(tx, eventId)

  const event = await tx.event.findUnique({ where: { id: eventId }, select: SETTER_SELECT })

  refuseUnsettable(event, actor)

  const current = {
    enabled: event.venuePaymentEnabled === true,
    limit: event.venuePaymentLimit ?? null,
  }

  if (enabled && event.isOnline === true && !current.enabled) {
    throw paymentTermsRefusal('VENUE_PAYMENT_ONLINE_EVENT')
  }

  if (enabled && (limit === null || limit === undefined)) {
    throw paymentTermsRefusal('VENUE_LIMIT_REQUIRED')
  }

  if (current.enabled !== seen?.enabled || current.limit !== (seen?.limit ?? null)) {
    throw httpError(409, 'PAYMENT_TERMS_CHANGED', PAYMENT_TERMS_SENTENCES.venuePaymentChanged)
  }

  // Turning it off keeps the limit as it was, so turning it back on starts
  // from the figure the administrator last chose.
  const nextLimit = enabled ? limit : current.limit
  const unchanged = enabled
    ? current.enabled && current.limit === nextLimit
    : current.enabled === false

  if (unchanged) throw paymentTermsRefusal('VENUE_PAYMENT_UNCHANGED')

  await tx.event.update({
    where: { id: eventId },
    data: {
      venuePaymentEnabled: enabled,
      venuePaymentLimit: nextLimit,
      venuePaymentChangedAt: now,
      venuePaymentChangedById: actor.id,
      venuePaymentReason: reason,
    },
  })

  await tx.eventVenuePaymentChange.create({
    data: { eventId, enabled, limit: nextLimit, reason, changedById: actor.id },
  })

  await recordAudit(tx, {
    action: AUDIT_ACTIONS.EVENT_VENUE_PAYMENT_CHANGED,
    entityType: 'Event',
    entityId: eventId,
    actorId: actor.id,
    metadata: {
      enabled,
      limit: nextLimit,
      previousEnabled: current.enabled,
      previousLimit: current.limit,
      reason,
      eventStatus: event.status,
      platformRole: actor.role ?? null,
    },
  })

  return { eventId }
}

/**
 * Switch paying at the venue on or off for an event, or change its limit.
 *
 * Turning it off, or lowering the limit, leaves every booking already made as
 * it is. Given a transaction client it runs there; otherwise in its own bounded
 * transaction.
 *
 * @param {object} db A Prisma client, or a transaction client already open.
 * @param {object} params Inputs.
 * @param {string} params.eventId The event.
 * @param {boolean} params.enabled On or off.
 * @param {number|null} [params.limit] The most unpaid tickets all buyers may hold; required to turn it on.
 * @param {string} params.reason Why, 10 to 500 characters.
 * @param {{enabled: boolean, limit: number|null}} params.seen The switch and limit the administrator read.
 * @param {object} params.actor The administrator: `id`, `role`, `memberships`.
 * @param {Date} [params.now] The moment.
 * @returns {Promise<{eventId: string}>} The event.
 * @throws {Error} 404; 409 `NOT_EDITABLE`, `SOLD_ON_SOURCE`, `PAYMENT_TERMS_CHANGED`, `VENUE_PAYMENT_UNCHANGED`; 422 `VENUE_PAYMENT_ONLINE_EVENT`, `VENUE_LIMIT_REQUIRED`; 403 `CONFLICT_OF_INTEREST`; 503 when it waited too long.
 */
export function setVenuePayment(db, params) {
  return isTransactionClient(db)
    ? setVenuePaymentInTransaction(db, params)
    : budgetedTransaction(db, VENUE_BUDGET, (tx) => setVenuePaymentInTransaction(tx, params))
}

/**
 * An event's bookings to pay at the door: whether any were made, how many
 * tickets still wait for their payment, and what was taken at the door.
 *
 * @param {object} db A Prisma client or transaction client.
 * @param {string} eventId The event.
 * @returns {Promise<{hasOrders: boolean, unpaidTickets: number, paidAtDoorTickets: number, paidAtDoorCents: number}>} The counts.
 */
export async function venueBookingCounts(db, eventId) {
  const [orders, unpaidTickets, payments] = await Promise.all([
    db.order.count({
      where: { eventId, paymentMethod: 'AT_VENUE', status: { in: ['PAID', 'REFUNDED'] } },
    }),
    db.ticket.count({
      where: {
        ...UNPAID_VENUE_TICKET_WHERE,
        orderItem: {
          order: {
            eventId,
            paymentMethod: 'AT_VENUE',
            status: 'PAID',
            event: EVENT_STILL_ON_WHERE,
          },
        },
      },
    }),
    db.venuePayment.aggregate({
      where: { eventId },
      _sum: { amountCents: true, ticketCount: true },
    }),
  ])

  return {
    hasOrders: orders > 0,
    unpaidTickets,
    paidAtDoorTickets: payments?._sum?.ticketCount ?? 0,
    paidAtDoorCents: payments?._sum?.amountCents ?? 0,
  }
}

/**
 * An administrator's display name for a decision, or the stand-in once the
 * account is gone (SPEC2 W6).
 *
 * @param {{displayName?: string|null}|null|undefined} user The user, when loaded.
 * @returns {string} The name.
 */
function deciderName(user) {
  return user?.displayName ?? FORMER_ADMINISTRATOR_NAME
}

/**
 * The view of an event's booking fee and pay-at-the-venue switch that its own
 * team and administrators read (`paymentTermsViewSchema`, SPEC3 §7.2).
 *
 * @param {object} db A Prisma client or transaction client.
 * @param {string} eventId The event.
 * @param {object} options Options.
 * @param {object} options.env The parsed API environment, for the site default.
 * @returns {Promise<object|null>} `{ view, event }`: the view and the event as read; null for no such event.
 */
async function readView(db, eventId, { env }) {
  const event = await db.event.findUnique({ where: { id: eventId }, select: VIEW_SELECT })

  if (!event) return null

  const [latest, counts] = await Promise.all([
    latestFeeSetting(db, eventId),
    venueBookingCounts(db, eventId),
  ])
  const currency = sellingCurrency(event)
  const effective = eventFeeConfig(env, event, currency)
  const site = feeConfigFor(env, currency)

  return {
    event,
    view: {
      fee: {
        source: event.feeSource,
        percentageBps: effective.percentageBps,
        flatCentsPerTicket: effective.flatCents,
        currency,
        sequence: latest?.sequence ?? 0,
        changedAt: latest ? new Date(latest.createdAt).toISOString() : null,
        changedByName: latest ? deciderName(latest.setBy) : null,
        reason: latest?.reason ?? null,
      },
      siteDefault: {
        currency,
        percentageBps: site.percentageBps,
        flatCentsPerTicket: site.flatCents,
      },
      venuePayment: {
        enabled: event.venuePaymentEnabled === true,
        limit: event.venuePaymentLimit ?? null,
        offered: venuePaymentAvailable(event),
        changedAt: event.venuePaymentChangedAt
          ? new Date(event.venuePaymentChangedAt).toISOString()
          : null,
        changedByName: event.venuePaymentChangedAt
          ? deciderName(event.venuePaymentChangedBy)
          : null,
        reason: event.venuePaymentReason ?? null,
        ...counts,
      },
    },
  }
}

/**
 * Whether a reader gets an event's `paymentTerms` on its detail: its own team
 * and the team at The Desi Events (every insider read), and the administrators who set
 * them (SPEC3 §7.2, §11.3). Nobody else, ever.
 *
 * @param {object|null} actor The request actor.
 * @param {object} event The event, with its `organizationId`.
 * @returns {boolean} True for such a reader.
 */
export function mayReadPaymentTerms(actor, event) {
  if (!actor) return false

  return can(actor, CAPABILITIES.PAYMENT_TERMS_MANAGE) || maySeeDrafts(event, actor)
}

/**
 * An event's `paymentTerms` for its detail, when the reader may have them
 * (see {@link mayReadPaymentTerms}); undefined otherwise, so the key stays out
 * of the payload.
 *
 * @param {object} db A Prisma client.
 * @param {object} event The event, with its `id` and `organizationId`.
 * @param {object} options Options.
 * @param {object|null} options.actor The request actor.
 * @param {object|undefined} options.env The parsed API environment; without it, none.
 * @returns {Promise<object|undefined>} A `paymentTermsViewSchema` payload, or undefined.
 */
export async function eventPaymentTerms(db, event, { actor, env }) {
  if (!env || !event || !mayReadPaymentTerms(actor, event)) return undefined

  const read = await readView(db, event.id, { env })

  return read?.view
}

/**
 * The administrators' read of an event's booking fee and switch (SPEC3 §7.2):
 * the view, what decides whether it may be changed, and the newest decisions
 * of both kinds, newest first.
 *
 * @param {object} db A Prisma client or transaction client.
 * @param {string} eventId The event.
 * @param {object} options Options.
 * @param {object} options.env The parsed API environment.
 * @param {Date|null} [options.before] Only decisions made before this instant.
 * @returns {Promise<object>} A `paymentTermsAdminResponseSchema` `data` payload.
 * @throws {Error} 404 for no such event.
 */
export async function paymentTermsAdminView(db, eventId, { env, before = null }) {
  const read = await readView(db, eventId, { env })

  if (!read) throw notFound('No such event.')

  const { event, view } = read
  const when = before ? { createdAt: { lt: new Date(before) } } : {}
  const [fees, switches] = await Promise.all([
    db.eventFeeSetting.findMany({
      where: { eventId, ...when },
      orderBy: [{ createdAt: 'desc' }, { sequence: 'desc' }],
      take: HISTORY_PAGE + 1,
      include: { setBy: { select: { displayName: true } } },
    }),
    db.eventVenuePaymentChange.findMany({
      where: { eventId, ...when },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: HISTORY_PAGE + 1,
      include: { changedBy: { select: { displayName: true } } },
    }),
  ])

  const entries = [
    ...fees.map((row) => ({
      at: new Date(row.createdAt),
      entry: {
        kind: 'FEE',
        at: new Date(row.createdAt).toISOString(),
        byName: deciderName(row.setBy),
        reason: row.reason,
        source: row.source,
        percentageBps: row.percentageBps ?? null,
        flatCentsPerTicket: row.flatCentsPerTicket ?? null,
        currency: row.currency ?? null,
        sequence: row.sequence,
      },
    })),
    ...switches.map((row) => ({
      at: new Date(row.createdAt),
      entry: {
        kind: 'VENUE_PAYMENT',
        at: new Date(row.createdAt).toISOString(),
        byName: deciderName(row.changedBy),
        reason: row.reason,
        enabled: row.enabled,
        limit: row.limit ?? null,
      },
    })),
  ].sort((left, right) => right.at.getTime() - left.at.getTime())

  return {
    ...view,
    eventId: event.id,
    eventStatus: event.status,
    isOnline: event.isOnline === true,
    soldOnSource: Boolean(event.organization?.platformHeldSource),
    posted:
      event.status === DELETED
        ? Boolean(event.statusBeforeDeletion) && event.statusBeforeDeletion !== DRAFT
        : event.status !== DRAFT,
    history: entries.slice(0, HISTORY_PAGE).map(({ entry }) => entry),
    historyHasMore: entries.length > HISTORY_PAGE,
  }
}
