/**
 * Booking fees, referral codes and paying at the venue (SPEC3, SPEC3-XI): the
 * limits, the vocabulary and every request body of the fifteen routes the
 * Desi-Event team and organisers use, and the two fields checkout gains.
 *
 * Browser-safe, at `@desi-event/schemas/payment-terms`: it imports only `zod`
 * and `./primitives.js`, so the admin and checkout forms validate with the same
 * schemas the server does. The responses are in `responses.js`.
 *
 * Words (SPEC3 §0.5): buyers and organisers read "booking fee"; the
 * administrators' screens say "booking fee (the platform fee)" once. The text of
 * a referral code travels only under the name `referralCode` — never `code` —
 * so the logger redacts it by name (SPEC3 §0.2).
 *
 * The views the responses are built from are here too, rather than in
 * `responses.js`: the event detail in `entities.js` carries them, and
 * `entities.js` cannot import `responses.js`, which imports it.
 *
 * @module @desi-event/schemas/payment-terms
 */

import { z } from 'zod'

import {
  POSTGRES_INT_MAX,
  centsSchema,
  cuidSchema,
  currencySchema,
  orderReferenceSchema,
  pageSchema,
  paginationQuerySchema,
  queryDateTimeSchema,
  timestampSchema,
  withoutControlCharacters,
} from './primitives.js'

/**
 * The bounds of an event's own booking fee: 30.00% and 100.00 per ticket in the
 * event's currency. Guards against typing mistakes (open question 8); the
 * database holds the same (`event_fee_shape`).
 */
export const FEE_LIMITS = Object.freeze({ maxPercentageBps: 3000, maxFlatCentsPerTicket: 10000 })

/**
 * Paying at the venue's limits: the most unpaid pay-at-the-venue tickets an
 * administrator may allow on one event across all buyers, and what the form
 * suggests. There is no limit per account (the owner's answer to open question
 * 1): the event's own limit, which the administrator sets, is the only one.
 */
export const VENUE_PAYMENT_LIMITS = Object.freeze({
  maxEventLimit: 100000,
  suggestedEventLimit: 50,
})

/**
 * Cancelling unpaid pay-at-the-venue tickets (SPEC3-XI XU3): at most 100
 * tickets of one booking in one request, as `VenueBookingCancellation`'s
 * `ticketCount` allows.
 */
export const VENUE_CANCEL_LIMITS = Object.freeze({ maxTickets: 100 })

/** A referral code's bounds: its length, its scope, its total limit and its label. */
export const REFERRAL_LIMITS = Object.freeze({
  minLength: 6,
  maxLength: 32,
  maxEvents: 50,
  maxUses: 1000000,
  labelMax: 120,
})

/**
 * How many of a referral code's events one row of the administrators' list
 * names (SPEC3 §8.4); one code's own answer names every one of them.
 */
export const REFERRAL_LIST_EVENTS = 3

/** Every reason box of this area: 10 to 500 characters (SPEC3 §0.6). */
export const REASON_LIMITS = Object.freeze({ min: 10, max: 500 })

/** How an order's ticket price is paid. The same names as `OrderPaymentMethod`. */
export const PAYMENT_METHODS = Object.freeze({ CARD: 'CARD', AT_VENUE: 'AT_VENUE' })

/**
 * The letters a generated referral code is drawn from: no 0, O, 1, I or L, so a
 * code read aloud or off a poster is not mistyped.
 */
export const REFERRAL_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

/** A generated code: two groups of five from {@link REFERRAL_ALPHABET}. */
export const GENERATED_REFERRAL_CODE_PATTERN = /^[A-HJKMNP-Z2-9]{5}-[A-HJKMNP-Z2-9]{5}$/u

/**
 * A referral code as stored: 6 to 32 of A-Z, 0-9 and '-', beginning and ending
 * with a letter or digit (`referral_code_shape`). No '--' is checked apart.
 */
export const REFERRAL_CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{4,30}[A-Z0-9]$/u

/** Where a referral code stands, as the administrators' list filters it. */
export const REFERRAL_STATUSES = Object.freeze(['ON', 'OFF', 'EXPIRED', 'USED_UP'])

/** Why a quote did not apply a referral code. One answer for every cause of refusal. */
export const REFERRAL_QUOTE_REASONS = Object.freeze(['NOT_ACCEPTED', 'NOTHING_TO_WAIVE'])

/**
 * What a pay-at-the-venue order's buyer-facing state reads from
 * (`venuePaymentStateOf`), by precedence: the buyer's own tickets still to pay;
 * some paid at the door (by the buyer or by people they passed tickets to);
 * tickets passed on and still owing; tickets cancelled unpaid; nothing (and
 * always nothing for a card order). SPEC3-XI §4.6.
 */
export const VENUE_PAYMENT_STATES = Object.freeze([
  'TO_PAY',
  'PAID',
  'PASSED_ON',
  'CANCELLED',
  'NONE',
])

/**
 * Why an order's referral use was given back: the order ended without being
 * used (SPEC3-XI XR4). The same names as `ReferralUseReturnCause`.
 */
export const REFERRAL_RETURN_CAUSES = Object.freeze([
  'PAYMENT_FAILED',
  'NOT_COMPLETED',
  'UNPAID_ORDER_CANCELLED',
  'REFUNDED',
  'VENUE_UNPAID_CANCELLED',
  'EVENT_CANCELLED',
  'EVENT_DELETED',
  'SESSION_CANCELLED',
  'TICKETS_REVOKED',
])

/**
 * Whether the places freed by cancelling unpaid tickets are on sale at that
 * moment (SPEC3-XI XU5): every one, none, or some. A freed place sells only
 * while the event is bookable, its tier's sales window is open and its night's
 * is too.
 */
export const PLACES_ON_SALE = Object.freeze(['ALL', 'SOME', 'NONE'])

/** Who cancelled unpaid tickets, as a buyer, a holder and the reports read it. */
export const VENUE_CANCELLED_BY = Object.freeze(['ORGANISER', 'DESI_EVENT'])

/**
 * The description of the reason for cancelling unpaid tickets (SPEC3-XI §12.14,
 * §9.11): the buyer and the tickets' holders read it.
 */
export const VENUE_CANCEL_REASON_DESCRIPTION =
  "Shown to the buyer and to anybody holding these tickets. Do not include anybody's personal details. At least 10 characters."

/** What an order's tax was charged on. */
export const TAX_APPLIED_TO = Object.freeze(['TICKETS_AND_FEE', 'BOOKING_FEE', 'NOTHING'])

/**
 * The description of a free-text reason (SPEC2-XI §0.8): kept as written, and
 * not rewritten by the privacy process.
 */
export const REASON_DESCRIPTION =
  "Shown with the event's history. Do not include anybody's personal details."

/**
 * The description of the fee's and the switch's reasons, which the organiser
 * also reads with the administrator's name (SPEC3 §0.6, §12.3).
 */
export const ORGANISER_VISIBLE_REASON_DESCRIPTION =
  "Shown to the organiser with your name. Do not include anybody's personal details. At least 10 characters."

/** The hint under a referral code's label (SPEC3 §12.5). */
export const REFERRAL_LABEL_DESCRIPTION =
  "For the Desi-Event team only, for example the partner organisation or the campaign it is for. Do not include anybody's personal details."

/** What the forms say when a field is out of bounds (SPEC3 §12.3, §12.5). */
export const PAYMENT_TERMS_MESSAGES = Object.freeze({
  percentage: 'Enter a percentage from 0 to 30, with at most two decimal places.',
  amount: 'Enter an amount from 0.00 to 100.00.',
  reasonShort: 'Give a reason of at least 10 characters.',
  reasonLong: '500 characters at most.',
  limit: 'Enter a whole number from 1 to 100,000.',
  limitRequired: 'Set the most tickets that can be waiting to be paid at the door.',
  referralCode:
    '6 to 32 letters, numbers or single hyphens, starting and ending with a letter or number.',
  label: '120 characters at most.',
  maxUses: 'From 1 to 1,000,000.',
  eventsRequired: 'Choose at least one event.',
  eventsTooMany: 'Choose 50 events at most.',
})

/** A non-negative integer the database's `integer` columns hold. */
const intPrecondition = z.int().min(0).max(POSTGRES_INT_MAX)

/**
 * A reason for a fee change, a switch change, a switch-off or a booking-fee
 * refund: 10 to 500 characters once trimmed, with no control character.
 */
export const reasonSchema = withoutControlCharacters(
  z
    .string()
    .trim()
    .min(REASON_LIMITS.min, PAYMENT_TERMS_MESSAGES.reasonShort)
    .max(REASON_LIMITS.max, PAYMENT_TERMS_MESSAGES.reasonLong),
)

/** `CARD` or `AT_VENUE`. */
export const paymentMethodSchema = z.enum([PAYMENT_METHODS.CARD, PAYMENT_METHODS.AT_VENUE])

/**
 * A referral code as an administrator types it: trimmed and upper-cased, then 6
 * to 32 of A-Z, 0-9 and single hyphens, beginning and ending with a letter or
 * digit. A value with any character outside printable ASCII is left as it is,
 * so it fails rather than being folded into one that passes (`ı` and `ß` both
 * upper-case to ASCII).
 */
export const referralCodeStringSchema = z.preprocess(
  (value) => {
    if (typeof value !== 'string') return value

    const trimmed = value.trim()

    return /^[\x20-\x7E]*$/u.test(trimmed) ? trimmed.toUpperCase() : trimmed
  },
  z
    .string()
    .regex(REFERRAL_CODE_PATTERN, PAYMENT_TERMS_MESSAGES.referralCode)
    .refine((code) => !code.includes('--'), PAYMENT_TERMS_MESSAGES.referralCode),
)

/**
 * A referral code as a buyer sends it to a quote or an order: any 1 to 64
 * characters without a control character. Deliberately loose (SPEC3 §8.2): a
 * malformed code gets the same answer as an unknown one, never a 400 of its
 * own that would tell a guesser the shape.
 */
export const referralCodeEntrySchema = withoutControlCharacters(z.string().trim().min(1).max(64))

/** An event's percentage, in basis points: 0 to 3000. */
const percentageBpsSchema = z
  .int(PAYMENT_TERMS_MESSAGES.percentage)
  .min(0, PAYMENT_TERMS_MESSAGES.percentage)
  .max(FEE_LIMITS.maxPercentageBps, PAYMENT_TERMS_MESSAGES.percentage)

/** An event's amount per ticket, in minor units: 0 to 10000. */
const flatCentsPerTicketSchema = z
  .int(PAYMENT_TERMS_MESSAGES.amount)
  .min(0, PAYMENT_TERMS_MESSAGES.amount)
  .max(FEE_LIMITS.maxFlatCentsPerTicket, PAYMENT_TERMS_MESSAGES.amount)

/**
 * `paymentTerms.setFee`: the site default, or the event's own percentage and
 * amount per ticket. No currency: an event's own fee is in the currency the
 * event sells in (SPEC3 DF3). `expectedSequence` is the newest decision's
 * sequence the administrator read (0 when there is none), a compare-and-set.
 */
export const setPlatformFeeRequestSchema = z.discriminatedUnion('source', [
  z.strictObject({
    source: z.literal('SITE_DEFAULT'),
    reason: reasonSchema,
    expectedSequence: intPrecondition,
  }),
  z.strictObject({
    source: z.literal('EVENT'),
    percentageBps: percentageBpsSchema,
    flatCentsPerTicket: flatCentsPerTicketSchema,
    reason: reasonSchema,
    expectedSequence: intPrecondition,
  }),
])

/** The most pay-at-the-venue tickets all buyers together may hold unpaid. */
const venueLimitSchema = z
  .int(PAYMENT_TERMS_MESSAGES.limit)
  .min(1, PAYMENT_TERMS_MESSAGES.limit)
  .max(VENUE_PAYMENT_LIMITS.maxEventLimit, PAYMENT_TERMS_MESSAGES.limit)

/**
 * `paymentTerms.setVenuePayment`: switch paying at the venue on or off, or
 * change its limit. `seen` is the switch and limit the administrator read, a
 * compare-and-set. A limit is required to turn it on; turning it off keeps the
 * limit as it was.
 */
export const setVenuePaymentRequestSchema = z
  .strictObject({
    enabled: z.boolean(),
    limit: venueLimitSchema.optional(),
    seen: z.strictObject({
      enabled: z.boolean(),
      limit: intPrecondition.nullable(),
    }),
    reason: reasonSchema,
  })
  .superRefine((value, ctx) => {
    if (value.enabled && value.limit === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['limit'],
        message: PAYMENT_TERMS_MESSAGES.limitRequired,
      })
    }
  })

/**
 * Report a list of event ids that is not 1 to 50 distinct ids.
 *
 * @param {string[]} ids The ids.
 * @param {z.RefinementCtx} ctx Zod refinement context.
 * @returns {void}
 */
function distinctEventIds(ids, ctx) {
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: 'custom', path: ['eventIds'], message: 'Name each event once.' })
  }
}

/** The events of a SELECTED_EVENTS code: 1 to 50 ids. */
const scopeEventIdsSchema = z
  .array(cuidSchema)
  .min(1, PAYMENT_TERMS_MESSAGES.eventsRequired)
  .max(REFERRAL_LIMITS.maxEvents, PAYMENT_TERMS_MESSAGES.eventsTooMany)

/** A referral code's label: 1 to 120 characters, no control character. */
const referralLabelSchema = withoutControlCharacters(
  z.string().trim().min(1).max(REFERRAL_LIMITS.labelMax, PAYMENT_TERMS_MESSAGES.label),
)

/** A referral code's total limit: 1 to 1,000,000 orders. */
const maxUsesSchema = z
  .int(PAYMENT_TERMS_MESSAGES.maxUses)
  .min(1, PAYMENT_TERMS_MESSAGES.maxUses)
  .max(REFERRAL_LIMITS.maxUses, PAYMENT_TERMS_MESSAGES.maxUses)

/** `ALL_EVENTS` or `SELECTED_EVENTS`. */
const referralScopeSchema = z.enum(['ALL_EVENTS', 'SELECTED_EVENTS'])

/**
 * `referralCodes.create`: exactly one of a typed `referralCode` or `generate:
 * true`; the events named for, and only for, a SELECTED_EVENTS code. Whether
 * the expiry is in the future and the events may be named is the handler's
 * answer (422), because it reads the clock and the events.
 */
export const createReferralCodeRequestSchema = z
  .strictObject({
    referralCode: referralCodeStringSchema.optional(),
    generate: z.literal(true).optional(),
    label: referralLabelSchema.optional(),
    scope: referralScopeSchema,
    eventIds: scopeEventIdsSchema.optional(),
    expiresAt: timestampSchema.optional(),
    maxUses: maxUsesSchema.optional(),
  })
  .superRefine((value, ctx) => {
    const typed = value.referralCode !== undefined
    const generated = value.generate === true

    if (typed === generated) {
      ctx.addIssue({
        code: 'custom',
        path: ['referralCode'],
        message: 'Type a code or ask for one to be generated, not both.',
      })
    }

    if (value.scope === 'SELECTED_EVENTS' && value.eventIds === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['eventIds'],
        message: PAYMENT_TERMS_MESSAGES.eventsRequired,
      })
    }

    if (value.scope === 'ALL_EVENTS' && value.eventIds !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['eventIds'],
        message: 'A code for all events names no events.',
      })
    }

    if (value.eventIds) distinctEventIds(value.eventIds, ctx)
  })

/**
 * `referralCodes.update`: the label, the scope and its events, the expiry and
 * the limit (null removes the label, the expiry or the limit). The text is not
 * editable. `expectedUpdatedAt` is when the administrator read the code, a
 * compare-and-set. Naming `eventIds` alone changes a SELECTED_EVENTS code's
 * events; the handler refuses it for an ALL_EVENTS code.
 */
export const updateReferralCodeRequestSchema = z
  .strictObject({
    label: referralLabelSchema.nullable().optional(),
    scope: referralScopeSchema.optional(),
    eventIds: scopeEventIdsSchema.optional(),
    expiresAt: timestampSchema.nullable().optional(),
    maxUses: maxUsesSchema.nullable().optional(),
    expectedUpdatedAt: timestampSchema,
  })
  .superRefine((value, ctx) => {
    const changes = ['label', 'scope', 'eventIds', 'expiresAt', 'maxUses'].filter(
      (key) => value[key] !== undefined,
    )

    if (changes.length === 0) {
      ctx.addIssue({ code: 'custom', path: [], message: 'Change at least one thing.' })
    }

    if (value.scope === 'SELECTED_EVENTS' && value.eventIds === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['eventIds'],
        message: PAYMENT_TERMS_MESSAGES.eventsRequired,
      })
    }

    if (value.scope === 'ALL_EVENTS' && value.eventIds !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['eventIds'],
        message: 'A code for all events names no events.',
      })
    }

    if (value.eventIds) distinctEventIds(value.eventIds, ctx)
  })

/** `referralCodes.switchOff`: an optional reason of 10 to 500 characters. */
export const switchOffReferralCodeRequestSchema = z.strictObject({
  reason: reasonSchema.optional(),
})

/** How many referral codes, or uses of one, a page holds: fifty, and no more (SPEC3 §8.4). */
export const REFERRAL_PAGE_SIZE = 50

/**
 * A page of referral codes or of one code's uses: fifty unless fewer are
 * asked for, never more.
 */
const referralPageQuerySchema = z.object({
  page: pageSchema,
  perPage: z.coerce.number().int().min(1).max(REFERRAL_PAGE_SIZE).default(REFERRAL_PAGE_SIZE),
})

/**
 * `referralCodes.list`: by status, by the administrator who made it, by an
 * event in its scope. Never by its text, which stays out of a URL; finding a
 * code by its text is a filter in the browser over the page.
 */
export const listReferralCodesQuerySchema = referralPageQuerySchema.extend({
  status: z.enum([...REFERRAL_STATUSES]).optional(),
  creatorId: cuidSchema.optional(),
  eventId: cuidSchema.optional(),
})

/** `referralCodes.get`: a page of the code's uses. */
export const referralCodeUsesQuerySchema = referralPageQuerySchema

/**
 * `platformFees.refund`: why, and the amount the administrator was shown as
 * refundable, a precondition (409 `PRICE_CHANGED` when it moved).
 */
export const platformFeeRefundRequestSchema = z.strictObject({
  reason: reasonSchema,
  expectedRefundableCents: centsSchema,
})

/** `venuePayments.report`: a page of payments and unpaid bookings. */
export const venuePaymentsQuerySchema = paginationQuerySchema

/**
 * Report a list of ticket ids that names a ticket twice.
 *
 * @param {string[]} ids The ids.
 * @param {z.RefinementCtx} ctx Zod refinement context.
 * @returns {void}
 */
function distinctTicketIds(ids, ctx) {
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: 'custom', path: [], message: 'Name each ticket once.' })
  }
}

/**
 * `venueBookings.cancel` (SPEC3-XI XU3, XU10): the unpaid tickets of one
 * booking to cancel, 1 to 100 distinct ids, and why, 10 to 500 characters. The
 * reason is shown to the buyer and to anybody holding those tickets.
 */
export const cancelUnpaidVenueTicketsRequestSchema = z.strictObject({
  ticketIds: z
    .array(cuidSchema)
    .min(1, 'Choose at least one ticket.')
    .max(
      VENUE_CANCEL_LIMITS.maxTickets,
      `Choose ${VENUE_CANCEL_LIMITS.maxTickets} tickets at most.`,
    )
    .superRefine(distinctTicketIds),
  reason: reasonSchema.describe(VENUE_CANCEL_REASON_DESCRIPTION),
})

/**
 * `venueBookings.unpaid`: a page of an event's bookings with unpaid tickets,
 * or the one booking named by `order` (the cancel dialog's loader).
 */
export const venueBookingsQuerySchema = paginationQuerySchema.extend({
  order: orderReferenceSchema.optional(),
})

/** `paymentTerms.get`: the history before an instant, for "Show older changes". */
export const paymentTermsQuerySchema = z.strictObject({
  before: queryDateTimeSchema.optional(),
})

/** A ticket's payment at the door, sent with its admission (`tickets.checkIn`). */
export const doorPaymentRequestSchema = z.strictObject({
  amountCents: centsSchema.min(1),
})

// ---------------------------------------------------------------------------
// Views the responses are built from (SPEC3 §11.2)
// ---------------------------------------------------------------------------

/** A count of tickets or records. */
const countSchema = z.int().min(0)

/** A percentage in basis points as the site's or an event's terms may hold it. */
const termsPercentageBpsSchema = z.int().min(0).max(10_000)

/** An amount per ticket as the site's or an event's terms may hold it. */
const termsFlatCentsSchema = z.int().min(0).max(100_000)

/**
 * An event's booking fee as administrators and the event's team read it: the
 * effective numbers and where they come from, the newest decision's sequence
 * (0 when there is none) and who made it, when and why.
 */
export const feeTermsViewSchema = z.object({
  source: z.enum(['SITE_DEFAULT', 'EVENT']),
  percentageBps: termsPercentageBpsSchema,
  flatCentsPerTicket: termsFlatCentsSchema,
  currency: currencySchema,
  sequence: z.int().min(0),
  changedAt: timestampSchema.nullable(),
  changedByName: z.string().nullable(),
  reason: z.string().nullable(),
})

/**
 * An event's pay-at-the-venue switch as administrators and the event's team
 * read it: the switch and its limit, whether buyers are offered it now, the last
 * change, and the event's bookings (whether any exist, unpaid tickets, and what
 * was taken at the door).
 */
export const venuePaymentViewSchema = z.object({
  enabled: z.boolean(),
  limit: z.int().min(1).max(VENUE_PAYMENT_LIMITS.maxEventLimit).nullable(),
  offered: z.boolean(),
  changedAt: timestampSchema.nullable(),
  changedByName: z.string().nullable(),
  reason: z.string().nullable(),
  hasOrders: z.boolean(),
  unpaidTickets: countSchema,
  paidAtDoorTickets: countSchema,
  paidAtDoorCents: centsSchema,
})

/**
 * `paymentTerms` on an event detail read by its team or an administrator:
 * the fee, the site default for the event's currency, and the switch.
 */
export const paymentTermsViewSchema = z.object({
  fee: feeTermsViewSchema,
  siteDefault: z.object({
    currency: currencySchema,
    percentageBps: termsPercentageBpsSchema,
    flatCentsPerTicket: termsFlatCentsSchema,
  }),
  venuePayment: venuePaymentViewSchema,
})

/** What everybody reads about paying at the venue: whether it is offered. */
export const publicVenuePaymentSchema = z.object({ available: z.boolean() })

/**
 * The booking fee terms an order or a quote was priced with, as its buyer reads
 * them: the numbers, never where they came from (SPEC3 §7.2, A13).
 */
export const orderFeeTermsSchema = z.object({
  percentageBps: termsPercentageBpsSchema,
  flatCentsPerTicket: termsFlatCentsSchema,
})

/** What an order's tax was charged on, and why not when it was not. */
export const orderTaxViewSchema = z.object({
  applied: z.boolean(),
  appliedTo: z.enum([...TAX_APPLIED_TO]),
  notAppliedReason: z.enum(['PAID_AT_VENUE']).nullable().optional(),
})

/** A quote's answer about a referral code. The code itself is never echoed back. */
export const quoteReferralSchema = z.object({
  applied: z.boolean(),
  reason: z.enum([...REFERRAL_QUOTE_REASONS]).nullable(),
})

/**
 * A pay-at-the-venue order's state at the door (`venuePaymentStateOf`,
 * SPEC3-XI §4.6): what it owes there in all; what the buyer paid at the door
 * for the tickets they hold (`paidCents`, `paidTickets`), apart from what
 * people they passed tickets to paid (`paidByOthers*`, XT7); the buyer's own
 * standing tickets still unpaid (`unpaid*`) apart from those passed on and
 * still owing (`passedOnUnpaid*`); the tickets cancelled unpaid and the
 * booking fee Desi-Event kept for them.
 */
export const orderVenuePaymentSchema = z.object({
  dueCents: centsSchema,
  paidCents: centsSchema,
  unpaidTickets: countSchema,
  unpaidCents: centsSchema,
  paidTickets: countSchema,
  paidByOthersTickets: countSchema,
  paidByOthersCents: centsSchema,
  passedOnUnpaidTickets: countSchema,
  passedOnUnpaidCents: centsSchema,
  cancelledTickets: countSchema,
  cancelledCents: centsSchema,
  feeKeptCents: centsSchema,
  state: z.enum([...VENUE_PAYMENT_STATES]),
})

/**
 * One cancellation of unpaid tickets on an order, as the buyer reads it
 * (SPEC3-XI §11.2): when, by the organiser or the Desi-Event team, how many,
 * the door price no longer owed, the booking fee kept, and the reason given.
 * Organisation readers also get `byName` (SPEC2 W6); buyers never do.
 */
export const orderVenueCancellationSchema = z.object({
  at: timestampSchema,
  by: z.enum([...VENUE_CANCELLED_BY]),
  byName: z.string().nullable().optional(),
  ticketCount: z.int().min(1).max(VENUE_CANCEL_LIMITS.maxTickets),
  basisCents: centsSchema,
  feeKeptCents: centsSchema,
  reason: z.string(),
})

/**
 * A ticket's amount due at the door, whether it was paid, whether it was
 * cancelled unpaid (when and by whom), and whether the holder reading it paid
 * it at the door themselves (XT7). Null for one that owes nothing.
 */
export const ticketVenuePaymentSchema = z.object({
  dueCents: centsSchema,
  paid: z.boolean(),
  currency: currencySchema,
  cancelled: z.object({ at: timestampSchema, by: z.enum([...VENUE_CANCELLED_BY]) }).nullable(),
  paidAtDoorByYou: z.boolean(),
})

/**
 * Where a ticket the buyer passed on stands now with whoever holds it (SPEC3-XI
 * §12.7), so the buyer's order says, row by row, whose turn it is to pay:
 *
 * - `OWES`: its holder still pays `dueCents` at the door;
 * - `PAID`: its holder paid at the door;
 * - `CANCELLED`: it was cancelled because it was not paid for;
 * - `NOTHING_DUE`: nothing is to be paid at the door for it any more (it was
 *   refunded or withdrawn, or owed nothing there);
 * - `RETURNED`: it came back to the buyer, whose later row on the order says
 *   where it stands.
 *
 * @type {ReadonlyArray<string>}
 */
export const PASSED_ON_STATES = Object.freeze([
  'OWES',
  'PAID',
  'CANCELLED',
  'NOTHING_DUE',
  'RETURNED',
])

/**
 * A passed-on ticket's state, read by the API from the ticket its holder has
 * now (the row that replaced the buyer's): `dueCents` is what its holder pays
 * at the door, above 0 exactly while it `OWES`, and 0 otherwise.
 */
export const passedOnTicketSchema = z
  .object({ state: z.enum([...PASSED_ON_STATES]), dueCents: centsSchema })
  .refine((value) => (value.state === 'OWES') === value.dueCents > 0, {
    message: 'A passed-on ticket names an amount exactly while its holder owes it.',
    path: ['dueCents'],
  })

/**
 * One ticket of a booking waiting to be paid at the door, as the cancel
 * dialog lists it (SPEC3-XI §11.2): its label ("Ticket 2 of 3"), the attendee
 * name (null for a platform reader), its night or every night, its due, who
 * holds it, whether an offer to pass it on is open, and whether it can be
 * cancelled now (not once its night is over).
 */
export const venueBookingTicketSchema = z.object({
  ticketId: cuidSchema,
  label: z.string(),
  attendeeName: z.string().nullable(),
  nightLabel: z.string().nullable(),
  everyNight: z.boolean(),
  dueCents: centsSchema.min(1),
  heldBy: z.enum(['BUYER', 'SOMEONE_ELSE']),
  offerPending: z.boolean(),
  cancellable: z.boolean(),
  notCancellable: z.enum(['NIGHT_OVER']).nullable(),
})

/**
 * What a door is told about a ticket that owes a payment: what to take and, for
 * information, what else its booking owes; or that it was paid at the door on
 * an earlier night. Null on a ticket that owes nothing.
 */
export const admissionPaymentSchema = z.union([
  z.object({
    dueCents: centsSchema.min(1),
    currency: currencySchema,
    paid: z.literal(false),
    /**
     * The order's other standing unpaid tickets held by the same account as the
     * ticket presented, and whether that account is the buyer, whose group
     * pass covers them (SPEC3-XI §9.3).
     */
    booking: z.object({
      otherUnpaidTickets: countSchema,
      otherUnpaidCents: centsSchema,
      groupPass: z.boolean(),
    }),
  }),
  z.object({
    dueCents: centsSchema.min(1),
    currency: currencySchema,
    paid: z.literal(true),
  }),
])

/** What a confirmation recorded of a payment at the door, or found already recorded. */
export const checkInPaymentResultSchema = z.object({
  recordedCents: centsSchema,
  venuePaymentId: cuidSchema,
  byThisRequest: z.boolean(),
})

/**
 * What a group preview says the named tickets owe at the door in all, and how
 * many tickets of the booking now held by other people still owe there (they
 * pay with their own tickets, SPEC3-XI §9.5).
 */
export const groupAdmissionPaymentSchema = z.object({
  dueCents: centsSchema,
  currency: currencySchema,
  handedOnUnpaidTickets: countSchema,
})
