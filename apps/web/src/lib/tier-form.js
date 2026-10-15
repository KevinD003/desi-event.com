/**
 * The ticket-type form's values, its checks, and the body it sends.
 *
 * Kept apart from the component so the rules can be tested without a
 * browser. Every rule mirrors one the API applies — `ticketTypeProblems` on
 * the server, which answers 422 with the same sentences — so a form that
 * passes here and is refused there is a bug, not a normal outcome. The server
 * is still the one that decides.
 *
 * Prices are typed in the currency's major unit ("35.00") and sent in minor
 * units (3500); see `lib/money.js`.
 *
 * @module lib/tier-form
 */

import { parseMoneyInput, toMoneyInput } from './money.js'

/**
 * Limits the API holds a ticket type to, mirrored from
 * `@desi-event/schemas/event-content` (`EVENT_CONTENT_LIMITS`). A test holds the
 * two equal; importing the schemas package here would put it in the browser.
 */
export const TIER_LIMITS = Object.freeze({
  tierName: 120,
  tierDescription: 500,
  perOrderMax: 50,
  sortOrderMax: 1000,
})

/**
 * Blank values for a new tier.
 *
 * @param {string} [currency] The currency to start in.
 * @returns {object} Form values.
 */
export function blankTierForm(currency = 'USD') {
  return {
    name: '',
    description: '',
    price: '',
    currency,
    quantityTotal: '',
    minPerOrder: '1',
    maxPerOrder: '10',
    eventSessionId: '',
    reserved: false,
    priceZoneId: '',
    salesStartAt: '',
    salesEndAt: '',
    visibility: 'PUBLIC',
    complimentary: false,
    sortOrder: '0',
    status: 'DRAFT',
  }
}

/**
 * A stored tier as form values.
 *
 * @param {object} tier The tier from `GET /v1/events/:id/tiers`.
 * @returns {object} Form values.
 */
export function toTierForm(tier) {
  const currency = tier.currency ?? 'USD'

  return {
    name: tier.name ?? '',
    description: tier.description ?? '',
    price: toMoneyInput(tier.priceCents, currency),
    currency,
    quantityTotal: tier.quantityTotal == null ? '' : String(tier.quantityTotal),
    minPerOrder: String(tier.minPerOrder ?? 1),
    maxPerOrder: String(tier.maxPerOrder ?? 10),
    eventSessionId: tier.eventSessionId ?? '',
    reserved: Boolean(tier.reserved),
    priceZoneId: tier.priceZoneId ?? '',
    salesStartAt: tier.salesStartAt ?? '',
    salesEndAt: tier.salesEndAt ?? '',
    visibility: tier.visibility === 'HIDDEN' ? 'HIDDEN' : 'PUBLIC',
    complimentary: Boolean(tier.complimentary),
    sortOrder: String(tier.sortOrder ?? 0),
    status: tier.status ?? 'DRAFT',
  }
}

/**
 * A whole-number box, or NaN.
 *
 * @param {string} raw The box's contents.
 * @returns {number} The integer, or NaN.
 */
function whole(raw) {
  const text = String(raw ?? '').trim()

  return /^\d+$/u.test(text) ? Number(text) : Number.NaN
}

/**
 * @typedef {object} TierFormContext
 * @property {object[]} [sessions] The event's sessions, with `priceZones`.
 * @property {'draft'|'live'} [mode] The editing mode.
 * @property {{sold: number, held: number}} [usage] What is using the tier being edited.
 */

/**
 * What is wrong with the form, field by field.
 *
 * @param {object} values Form values.
 * @param {TierFormContext} [context] What the rules read besides the values.
 * @returns {Array<{field: string, message: string}>} One entry per problem.
 */
export function tierFormProblems(values, { sessions = [], mode = 'draft', usage = null } = {}) {
  const problems = []
  const add = (field, message) => problems.push({ field, message })
  const name = values.name.trim()

  if (!name) add('name', 'Give the ticket type a name.')
  else if (name.length > TIER_LIMITS.tierName) {
    add('name', `Keep the name to ${TIER_LIMITS.tierName} characters (it is ${name.length}).`)
  }

  const description = values.description.trim()

  if (description.length > TIER_LIMITS.tierDescription) {
    add(
      'description',
      `Keep the description to ${TIER_LIMITS.tierDescription} characters (it is ${description.length}).`,
    )
  }

  const price = values.complimentary ? { cents: 0 } : parseMoneyInput(values.price, values.currency)

  if ('error' in price) add('price', price.error)

  const least = whole(values.minPerOrder)
  const most = whole(values.maxPerOrder)

  for (const [field, value, label] of [
    ['minPerOrder', least, 'The least per order'],
    ['maxPerOrder', most, 'The most per order'],
  ]) {
    if (!Number.isInteger(value) || value < 1 || value > TIER_LIMITS.perOrderMax) {
      add(field, `${label} is a whole number from 1 to ${TIER_LIMITS.perOrderMax}.`)
    }
  }

  if (Number.isInteger(least) && Number.isInteger(most) && least > most) {
    add('minPerOrder', 'The least per order cannot be more than the most per order.')
  }

  const session = sessions.find((candidate) => candidate.id === values.eventSessionId) ?? null

  if (values.reserved) {
    if (!session) add('eventSessionId', 'Choose the session this reserved ticket type sells.')
    else if (!session.venueMapVersionId) {
      add('eventSessionId', 'That session has no seating map. Choose one that does.')
    }
    if (!values.priceZoneId) add('priceZoneId', 'Choose the price zone this ticket type sells.')
  } else {
    const quantity = whole(values.quantityTotal)
    const floor = mode === 'live' && usage ? usage.sold + usage.held : 0

    if (!Number.isInteger(quantity) || quantity < 1) {
      add('quantityTotal', 'Say how many there are: a whole number above zero.')
    } else if (quantity < floor) {
      add(
        'quantityTotal',
        `At least ${floor}: ${usage.sold} sold and ${usage.held} in baskets right now.`,
      )
    } else if (Number.isInteger(least) && least > quantity) {
      add('minPerOrder', 'The least per order is more than there are.')
    }
  }

  const opens = values.salesStartAt ? new Date(values.salesStartAt) : null
  const closes = values.salesEndAt ? new Date(values.salesEndAt) : null

  if (opens && closes && closes <= opens) {
    add('salesEndAt', 'Sales have to close after they open.')
  }

  if (closes && session?.endsAt && closes > new Date(session.endsAt)) {
    add('salesEndAt', 'Sales cannot close after the session has finished.')
  }

  const position = whole(values.sortOrder)

  if (!Number.isInteger(position) || position > TIER_LIMITS.sortOrderMax) {
    add('sortOrder', `The position is a whole number from 0 to ${TIER_LIMITS.sortOrderMax}.`)
  }

  if (values.complimentary && values.visibility !== 'HIDDEN') {
    add('visibility', 'A complimentary ticket type is hidden from the public page.')
  }

  return problems
}

/**
 * The form's values as the API's create body, without the revision.
 *
 * @param {object} values Form values that passed {@link tierFormProblems}.
 * @returns {object} The body.
 */
export function toTierBody(values) {
  const price = values.complimentary ? { cents: 0 } : parseMoneyInput(values.price, values.currency)

  return {
    name: values.name.trim(),
    description: values.description.trim() || null,
    priceCents: 'cents' in price ? price.cents : 0,
    currency: values.currency,
    // A reserved tier's stock is its seats; its quantity says nothing.
    quantityTotal: values.reserved ? 0 : whole(values.quantityTotal),
    minPerOrder: whole(values.minPerOrder),
    maxPerOrder: whole(values.maxPerOrder),
    eventSessionId: values.eventSessionId || null,
    reserved: Boolean(values.reserved),
    priceZoneId: values.reserved ? values.priceZoneId || null : null,
    salesStartAt: values.salesStartAt || null,
    salesEndAt: values.salesEndAt || null,
    visibility: values.complimentary ? 'HIDDEN' : values.visibility,
    complimentary: Boolean(values.complimentary),
    sortOrder: whole(values.sortOrder),
    status: values.status,
  }
}

/**
 * Only what an edit changed, for a PATCH.
 *
 * A PATCH that resends every field asks the server to re-check fields nobody
 * touched — and on a tier that has sold, a resent price reads as an attempt to
 * change it.
 *
 * @param {object} original The form values the edit started from.
 * @param {object} values The form values now.
 * @returns {object} The changed keys of the body; empty when nothing changed.
 */
export function diffTierBody(original, values) {
  const before = toTierBody(original)
  const after = toTierBody(values)
  /** @type {Record<string, unknown>} */
  const changed = {}

  for (const [key, value] of Object.entries(after)) {
    const previous = before[key]
    const same =
      previous === value ||
      (typeof previous === 'string' &&
        typeof value === 'string' &&
        !Number.isNaN(Date.parse(previous)) &&
        /T/u.test(previous) &&
        Date.parse(previous) === Date.parse(value))

    if (!same) changed[key] = value
  }

  return changed
}

/**
 * How a session reads in a select: its own label, or its date and time where it is held.
 *
 * @param {object} session The session.
 * @param {number} index Its position.
 * @returns {string} For example `Session 2 — Sat, Oct 4, 7:00 PM EDT`.
 */
export function sessionLabel(session, index) {
  let when = ''

  try {
    when = new Intl.DateTimeFormat('en-US', {
      timeZone: session.timezone || 'UTC',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(new Date(session.startsAt))
  } catch {
    when = String(session.startsAt ?? '')
  }

  return `${session.label || `Session ${index + 1}`} — ${when}`
}
