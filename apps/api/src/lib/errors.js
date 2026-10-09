/**
 * Error normalisation: one place that turns anything thrown inside a route
 * into the `errorResponseSchema` envelope.
 *
 * Every domain package ships its own error class (`ValidationError`,
 * `PermissionError`, `InventoryError`, `PricingError`, `ProviderError`) and
 * each already carries a `statusCode` and a machine-readable `code`. This
 * module deliberately does **not** re-derive those: it reads what the package
 * decided. Recognition is duck-typed on `name`/`code` rather than `instanceof`
 * because a pnpm workspace can legitimately load two physical copies of the
 * same module, and an `instanceof` check would then silently fall through to a
 * 500 for a perfectly ordinary 403.
 *
 * @module @desi-event/api/lib/errors
 */

import { WEBSITE_LIMITS } from '@desi-event/schemas/website'

/** Fallback code used when nothing more specific is known. */
export const INTERNAL_ERROR_CODE = 'INTERNAL_SERVER_ERROR'

/** Message sent in production instead of an unexpected error's own message. */
export const INTERNAL_ERROR_MESSAGE = 'An unexpected error occurred.'

/** Default code per status, used when an error carries a status but no code. */
const CODE_BY_STATUS = Object.freeze({
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHORIZED',
  402: 'PAYMENT_REQUIRED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  406: 'NOT_ACCEPTABLE',
  409: 'CONFLICT',
  410: 'HOLD_EXPIRED',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE',
  429: 'RATE_LIMITED',
  500: INTERNAL_ERROR_CODE,
  503: 'SERVICE_UNAVAILABLE',
})

/** Error `name` values owned by the domain packages. */
const DOMAIN_ERROR_NAMES = Object.freeze([
  'ValidationError',
  'PermissionError',
  'InventoryError',
  'PricingError',
  'ProviderError',
])

/**
 * `@fastify/jwt` and `fast-jwt` codes that mean "the credential is the
 * problem". They arrive with assorted statuses (401, 400, 500 for a bad
 * secret), so the status is normalised to 401 rather than trusted.
 *
 * @type {ReadonlySet<string>}
 */
const JWT_ERROR_CODES = new Set([
  'FST_JWT_NO_AUTHORIZATION_IN_HEADER',
  'FST_JWT_AUTHORIZATION_TOKEN_EXPIRED',
  'FST_JWT_AUTHORIZATION_TOKEN_INVALID',
  'FST_JWT_AUTHORIZATION_TOKEN_UNTRUSTED',
  'FST_JWT_BAD_REQUEST',
  'FAST_JWT_MALFORMED',
  'FAST_JWT_INVALID_SIGNATURE',
  'FAST_JWT_EXPIRED',
])

/**
 * An HTTP error as the API reports it.
 *
 * @typedef {object} NormalisedError
 * @property {number} statusCode HTTP status to answer with.
 * @property {string} code Machine-readable code carried in `error.code`.
 * @property {string} message Human-readable message safe to send to a client.
 * @property {Array<{path: string, code: string, message: string}>} [issues] Field-level validation issues.
 * @property {string[]} [problems] Business-rule reasons, for a 4xx.
 * @property {string} [reason] A closed-vocabulary refusal code, for a 4xx.
 * @property {string} [orderReference] The order a checkout answer is about, when one was placed and the caller has to find it (see `orderReferenceOf`).
 * @property {{currentWebsiteUrl?: string|null, enabled?: boolean}} [details] The facts a few refusals name, from a closed list (see `exposedDetailsOf`).
 * @property {number} [retryAfterSeconds] When the caller may try again, for the `Retry-After` header of a 503 (see {@link isOutOfTime}).
 * @property {boolean} expected Whether this is an anticipated 4xx rather than a bug.
 */

/**
 * Whether a value is a whole, non-negative number a database integer holds.
 *
 * @param {unknown} value A detail.
 * @returns {boolean} True for 0 to 2,147,483,647.
 */
function isCount(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 2_147_483_647
}

/**
 * The few refusals whose `details` reach the caller, and which keys of them.
 *
 * `details` is otherwise context for whoever reads the code, never sent. These
 * name what the caller has to know to act without reading the page again:
 * the address an organiser changed the website to while an administrator was
 * deciding on the old one, and where the website link's switch stands when a
 * decision changed nothing. Both come from an administrators-only route, and
 * the address is what that route's own reads show the same reader in full.
 * Each key has one type; a value of another type is left out.
 */
const EXPOSED_DETAILS = Object.freeze({
  WEBSITE_CHANGED: Object.freeze({
    currentWebsiteUrl: (value) =>
      value === null || (typeof value === 'string' && value.length <= WEBSITE_LIMITS.url),
  }),
  WEBSITE_REDIRECT_UNCHANGED: Object.freeze({
    enabled: (value) => typeof value === 'boolean',
  }),
  // SPEC3: what a checkout, an administrator's booking-fee form and a door
  // need to act on a refusal without reading the page again. Amounts are the
  // caller's own order's or ticket's; the sequence is the administrators'
  // own history; the ids are the events the administrator named.
  PRICE_CHANGED: Object.freeze({
    totalCents: isCount,
    venueDueCents: isCount,
    feesCents: isCount,
  }),
  PAYMENT_TERMS_CHANGED: Object.freeze({ currentSequence: isCount }),
  PAYMENT_DUE: Object.freeze({
    dueCents: isCount,
    booking: (value) =>
      Boolean(value) &&
      typeof value === 'object' &&
      Object.keys(value).every(
        (key) => key === 'otherUnpaidTickets' || key === 'otherUnpaidCents',
      ) &&
      isCount(value.otherUnpaidTickets) &&
      isCount(value.otherUnpaidCents),
  }),
  REFERRAL_EVENT_NOT_ELIGIBLE: Object.freeze({
    eventIds: (value) =>
      Array.isArray(value) &&
      value.length <= 50 &&
      value.every((id) => typeof id === 'string' && /^[a-z0-9]{20,40}$/u.test(id)),
  }),
})

/**
 * Whether a thrown value is one of the domain error classes.
 *
 * @param {unknown} error The thrown value.
 * @returns {boolean} True when the error was raised deliberately by a package.
 */
export function isDomainError(error) {
  return error instanceof Error && DOMAIN_ERROR_NAMES.includes(error.name)
}

/**
 * Whether a thrown value is a JWT/credential failure.
 *
 * @param {unknown} error The thrown value.
 * @returns {boolean} True when the error concerns the bearer token itself.
 */
export function isAuthError(error) {
  const code = /** @type {{code?: unknown}} */ (error)?.code
  return typeof code === 'string' && JWT_ERROR_CODES.has(code)
}

/**
 * PostgreSQL's SQLSTATEs for a character it cannot store.
 *
 * - `22021` `character_not_in_repertoire`: a NUL (0x00) in a text value.
 * - `22P05` `untranslatable_character`: the `\u0000` escape in a `json` or
 *   `jsonb` value ("unsupported Unicode escape sequence"), which is how a NUL
 *   in a JSON column, an audit row's metadata or an outbox payload arrives.
 *
 * @type {ReadonlySet<string>}
 */
const UNSTORABLE_CHARACTER_CODES = new Set(['22021', '22P05'])

/**
 * Whether a database error is a JSON column refusing a string it cannot hold.
 *
 * A lone UTF-16 surrogate (U+D800 to U+DFFF without its pair) is the one
 * string `JSON.parse` accepts and a `jsonb` column refuses: PostgreSQL answers
 * `22P02` ("invalid input syntax for type json"), which Prisma reports as
 * `P2007`. `22P02` alone is any malformed literal — an integer, a UUID — so
 * the JSON message is required as well, and anything else under that code is
 * still a fault.
 *
 * @param {unknown} error The thrown value.
 * @returns {boolean} True for one.
 */
function isUnstorableJson(error) {
  if (!error || typeof error !== 'object') return false

  const { codes, text } = databaseRefusalParts(error)

  return (
    (codes.has('22P02') || codes.has('P2007')) &&
    text.includes('invalid input syntax for type json')
  )
}

/**
 * PostgreSQL's SQLSTATEs, and Prisma's code, for a value outside what its
 * column or type holds.
 *
 * - `22003` `numeric_value_out_of_range`, which Prisma reports as `P2020`: a
 *   number past an `integer` column's 2147483647, such as a revision sent as
 *   a precondition and compared with one.
 * - `22008` `datetime_field_overflow`: a date PostgreSQL's calendar does not
 *   have, such as one in year 0, compared with a `timestamp` or `date`.
 *
 * @type {ReadonlySet<string>}
 */
const OUT_OF_RANGE_CODES = new Set(['22003', '22008', 'P2020'])

/** What a caller is told when they sent one. Names the fix, not the database. */
export const OUT_OF_RANGE_MESSAGE =
  'A number or date in the request is outside the range that can be stored. Check it and try again.'

/**
 * Whether a database error is a value outside its column's range.
 *
 * @param {unknown} error The thrown value.
 * @returns {boolean} True for one.
 */
function isOutOfRange(error) {
  if (!error || typeof error !== 'object') return false

  const { codes } = databaseRefusalParts(error)

  return [...codes].some((code) => OUT_OF_RANGE_CODES.has(code))
}

/** What a caller is told when they sent one. Names the fix, not the database. */
export const UNSTORABLE_CHARACTER_MESSAGE =
  'The request contains a character that cannot be stored, such as a NUL. Remove it and try again.'

/**
 * What a caller is told when the database refuses to make an unreviewed event
 * public (the `desi_event_status_requires_review` trigger).
 *
 * @type {string}
 */
export const REVIEW_REQUIRED_SENTENCE =
  'This event has not been approved by the Desi-Event team, so it cannot be made public.'

/**
 * What a member is told when they try to give somebody a role that creates or
 * publishes events.
 *
 * @type {string}
 */
export const POSTING_ROLE_SENTENCE =
  'Roles that create or publish events — event manager, manager, administrator and owner — are given by the Desi-Event team, not from this page. Ask the Desi-Event team to add this person to your organisation.'

/**
 * What a caller is told when their write lost a deadlock or a write conflict
 * to another change being saved at the same moment (PostgreSQL `40P01`, Prisma
 * `P2034`). Nothing of their write was kept, so trying again is the remedy.
 *
 * @type {string}
 */
export const TRY_AGAIN_SENTENCE =
  'Another change to this event was being saved at the same moment. Try again.'

/**
 * What a caller is told when a picture write met a change to the pictures it
 * depended on (SPEC2-XI X-P): a replacement cover's current cover removed, a
 * replacement already pointing somewhere, a row gone.
 *
 * @type {string}
 */
export const MEDIA_CHANGED_SENTENCE =
  'The pictures changed while this was being saved. Reload and try again.'

/**
 * What a caller is told when a database guard on deletion, restore or a
 * cancelled night refuses a write the service should never have made. Only a
 * bug reaches these; the caller hears a conflict, not a 500.
 *
 * @type {string}
 */
export const EVENT_CONTROL_CONFLICT_SENTENCE =
  'This event changed while that was being saved, so nothing was changed. Reload and try again.'

/**
 * What a caller is told when a membership or a team invitation would put
 * somebody into the organisation that holds imported events (SPEC2-XI I-B),
 * which the database refuses (`platform_held_organization_has_no_members`).
 *
 * @type {string}
 */
export const PLATFORM_HELD_ORGANIZATION_SENTENCE =
  "This organisation holds imported events for the Desi-Event team and has no members. Move the event to the organiser's own organisation instead."

// --- Booking fees, referral codes and paying at the venue (SPEC3 §4.5, §5.5) --

/**
 * What an administrator is told when a database guard on an event's booking
 * fee or pay-at-the-venue setting refuses a write: another change was saved at
 * the same moment (SPEC3 §5.5).
 *
 * @type {string}
 */
export const PAYMENT_TERMS_RACE_SENTENCE =
  "This event's booking fee or payment settings changed at the same moment. Reload to see them; nothing was changed."

/**
 * What an administrator is told when a referral code's own CHECK refuses a
 * write another change raced (SPEC3 §5.5).
 *
 * @type {string}
 */
export const REFERRAL_CODE_RACE_SENTENCE = 'This code changed at the same moment. Reload to see it.'

/**
 * What a buyer is told when the order names a referral code that cannot be
 * used for this booking — it expired, was switched off, ran out or left the
 * event's scope since the quote, or the database refused its last use: the
 * buyer's sentence of SPEC3 §6.5, which §5.5 names for the database refusal
 * too. One sentence for every cause, so a guesser learns nothing from it
 * (SPEC3 DR10).
 *
 * @type {string}
 */
export const REFERRAL_NOT_ACCEPTED_SENTENCE =
  'Your referral code can no longer be used for this booking, so the booking fee is back. Nothing has been charged. Check the new total, then pay.'

/**
 * What a buyer is told when a database guard on an order's money refuses the
 * order being written (SPEC3 §5.5).
 *
 * @type {string}
 */
export const ORDER_PRICE_RACE_SENTENCE =
  'The price changed while this order was being placed. Nothing was charged. Check the total and try again.'

/**
 * What a steward is told when the database refuses to let in a ticket whose
 * payment at the door is not recorded (SPEC3 §5.5).
 *
 * @type {string}
 */
export const PAYMENT_DUE_SENTENCE = 'Take the payment for this ticket before letting it in.'

/**
 * What a steward is told when a payment at the door could not be recorded
 * because the booking changed at the same moment (SPEC3 §5.5).
 *
 * @type {string}
 */
export const PAYMENT_NOT_RECORDED_SENTENCE =
  'The payment was not recorded because the booking changed at the same moment. Look the ticket up again; nothing was recorded and nobody was let in.'

/**
 * Every refusal SPEC3 adds (§4.5), with its status and the sentence the
 * caller reads. A sentence with `{…}` is completed by the service that raises
 * it, which knows the amount, the currency or the count; the rest are used as
 * they stand. Only a sentence written here is sent: the services pick one by
 * code (`paymentTermsRefusal`).
 *
 * There is deliberately no per-account limit on unpaid pay-at-the-venue
 * tickets (the owner's answer to open question 1): only the event's own limit,
 * `VENUE_PAYMENT_FULL`. And a ticket booked to pay at the venue may be handed
 * on (open question 7), so no refusal exists for that either.
 *
 * @type {Readonly<Record<string, {statusCode: number, message: string}>>}
 */
export const PAYMENT_TERMS_REFUSALS = Object.freeze({
  SIGN_IN_REQUIRED: Object.freeze({
    statusCode: 401,
    message: 'Sign in to pay at the venue or to use a referral code.',
  }),
  VENUE_PAYMENT_OFF: Object.freeze({
    statusCode: 409,
    message:
      'Paying at the venue is switched off for this event. Nothing has been charged. You can pay by card.',
  }),
  VENUE_PAYMENT_UNAVAILABLE: Object.freeze({
    statusCode: 409,
    message: "Paying at the venue isn't offered for this event.",
  }),
  NOTHING_TO_PAY_AT_VENUE: Object.freeze({
    statusCode: 422,
    message:
      'These tickets have no ticket price to pay at the door, so there is nothing to pay at the venue. Book them without choosing to pay at the venue. Nothing has been charged.',
  }),
  VENUE_PAYMENT_FULL: Object.freeze({
    statusCode: 409,
    message: 'Paying at the venue is full for this event. You can still pay by card.',
  }),
  VENUE_PAYMENT_ONLINE_EVENT: Object.freeze({
    statusCode: 422,
    message: 'This is an online event, so there is no venue to pay at.',
  }),
  VENUE_PAYMENT_UNCHANGED: Object.freeze({
    statusCode: 409,
    message: 'Paying at the venue is already set like that. Nothing was changed.',
  }),
  VENUE_LIMIT_REQUIRED: Object.freeze({
    statusCode: 422,
    message: 'Set the most tickets that can be waiting to be paid at the door.',
  }),
  PAYMENT_TERMS_CHANGED: Object.freeze({
    statusCode: 409,
    message:
      "Another administrator changed this event's booking fee after you opened the page. Reload to see it. Nothing was changed.",
  }),
  PLATFORM_FEE_UNCHANGED: Object.freeze({
    statusCode: 409,
    message: 'The booking fee is already set to that. Nothing was changed.',
  }),
  FEE_TERMS_CURRENCY: Object.freeze({
    statusCode: 409,
    message:
      "The Desi-Event team set this event's booking fee in {currency}. Ask them to change it before pricing tickets in another currency.",
  }),
  REFERRAL_NOT_ACCEPTED: Object.freeze({
    statusCode: 409,
    message: REFERRAL_NOT_ACCEPTED_SENTENCE,
  }),
  REFERRAL_CODE_TAKEN: Object.freeze({
    statusCode: 409,
    message: 'That code is already in use. Choose another, or generate one.',
  }),
  REFERRAL_CODE_EXPIRED: Object.freeze({
    statusCode: 409,
    message: "This code's expiry has passed. Change its expiry first, or make a new code.",
  }),
  REFERRAL_LIMIT_BELOW_USES: Object.freeze({
    statusCode: 422,
    message: "It has been used {n} times already, so its limit can't be lower than that.",
  }),
  REFERRAL_EVENT_NOT_ELIGIBLE: Object.freeze({
    statusCode: 422,
    message:
      "A referral code can't name a deleted event, or one that does not exist. Remove it and try again.",
  }),
  REFERRAL_CODE_CHANGED: Object.freeze({
    statusCode: 409,
    message: 'Another administrator changed this code after you opened it. Reload to see it.',
  }),
  PAYMENT_DUE: Object.freeze({
    statusCode: 409,
    message: 'Take {amount} for this ticket before letting it in.',
  }),
  PAYMENT_AMOUNT_MISMATCH: Object.freeze({
    statusCode: 422,
    message: "The amount doesn't match what this ticket owes ({amount}). Look the ticket up again.",
  }),
  PAYMENT_NOT_RECORDED: Object.freeze({
    statusCode: 409,
    message: PAYMENT_NOT_RECORDED_SENTENCE,
  }),
  NO_FEE_TO_REFUND: Object.freeze({
    statusCode: 409,
    message: 'Only a booking fee that was paid online can be refunded.',
  }),
  AMOUNT_REFUND_NOT_FOR_VENUE_ORDERS: Object.freeze({
    statusCode: 422,
    message:
      'Refund tickets by choosing them, or the whole order. A booking fee on its own is refunded by the Desi-Event team.',
  }),
})

/**
 * The other sentences SPEC3's services send under codes that already exist
 * (§4.5, §7.1, §7.4, §9.1): the same codes, worded for what was refused here.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const PAYMENT_TERMS_SENTENCES = Object.freeze({
  /** 403 `CONFLICT_OF_INTEREST`, on the booking fee, the switch and a fee refund. */
  conflictOfInterest:
    "You belong to this event's organisation, so another administrator has to make this change.",
  /** 409 `NOT_EDITABLE`, on a deleted event's booking fee or switch. */
  deletedEvent: 'This event was deleted. Restore it first; its booking fee comes back as it was.',
  /** 409 `SOLD_ON_SOURCE`, on an event sold on its listing's own site. */
  soldOnSource: 'Tickets for this event are sold on Sulekha, so it has no booking fee here.',
  /** 503 `TRY_AGAIN`, when a change to the booking fee waited too long. */
  feeTryAgain:
    'Another change to this event was being saved at the same moment, so the booking fee was not changed. Try again in a moment.',
  /** 409 `NO_FEE_TO_REFUND`, when the fee was paid online and nothing of it is left. */
  noFeeLeft: 'There is no booking fee left to refund on this order.',
  /** 429, when the wrong referral codes budget is spent (SPEC3 §4.4). */
  referralRateLimited: 'Too many referral codes were tried. Wait a few minutes, then try again.',
  /** 409 `PAYMENT_TERMS_CHANGED`, when the switch or its limit moved since it was read. */
  venuePaymentChanged:
    "Another administrator changed this event's payment settings after you opened the page. Reload to see them. Nothing was changed.",
})

/**
 * One of {@link PAYMENT_TERMS_REFUSALS} as an error to throw.
 *
 * @param {string} code A key of {@link PAYMENT_TERMS_REFUSALS}.
 * @param {object} [options] What the service knows.
 * @param {Record<string, string|number>} [options.values] Values for the sentence's `{…}` places.
 * @param {object} [options.details] Details; only the keys `EXPOSED_DETAILS` names reach the caller.
 * @returns {Error} The error, with the catalogue's status and the completed sentence.
 * @throws {TypeError} For a code the catalogue does not have, or a place left empty.
 */
export function paymentTermsRefusal(code, { values = {}, details } = {}) {
  const refusal = Object.hasOwn(PAYMENT_TERMS_REFUSALS, code) ? PAYMENT_TERMS_REFUSALS[code] : null

  if (!refusal) throw new TypeError(`No SPEC3 refusal is called ${JSON.stringify(code)}`)

  const message = refusal.message.replace(/\{([a-z]+)\}/gu, (_place, name) => {
    if (!Object.hasOwn(values, name)) {
      throw new TypeError(`The ${code} sentence needs a value for {${name}}`)
    }

    return String(values[name])
  })

  return httpError(refusal.statusCode, code, message, details)
}

/**
 * Database refusals the API answers with a sentence instead of a 500.
 *
 * Each is a rule the service already keeps, held again by the database for a
 * code path that forgets it: a trigger or CHECK raising SQLSTATE `23514`. The
 * driver adapter passes on the SQLSTATE and the message but not the constraint
 * field, so the constraint is recognised by its name, which the migration
 * writes into the message as well (`event_public_requires_review`).
 *
 * @type {ReadonlyArray<{constraint: string, statusCode: number, code: string, message: string}>}
 */
export const DATABASE_REFUSALS = Object.freeze([
  Object.freeze({
    constraint: 'event_public_requires_review',
    statusCode: 409,
    code: 'REVIEW_REQUIRED',
    message: REVIEW_REQUIRED_SENTENCE,
  }),
  Object.freeze({
    constraint: 'invitation_pending_role_is_owner_grantable',
    statusCode: 403,
    code: 'POSTING_ROLE_NEEDS_PLATFORM',
    message: POSTING_ROLE_SENTENCE,
  }),
  // Deletion, restore and cancelled nights (SPEC2-XI X-E): guards under rules
  // `lib/event-deletion.js` and `lib/session-cancellation.js` already keep.
  ...[
    'event_restore_returns_prior_status',
    'event_deletion_records_prior_status',
    'event_deletion_consistency',
    'event_session_cancellation_final',
  ].map((constraint) =>
    Object.freeze({
      constraint,
      statusCode: 409,
      code: 'CONFLICT',
      message: EVENT_CONTROL_CONFLICT_SENTENCE,
    }),
  ),
  // The organisation holding imported events has no members and takes no
  // team invitation (trigger `desi_platform_held_has_no_members`, SPEC2-XI
  // §4.3): every writer of `Membership` or `Invitation` meets it.
  Object.freeze({
    constraint: 'platform_held_organization_has_no_members',
    statusCode: 409,
    code: 'PLATFORM_HELD_ORGANIZATION',
    message: PLATFORM_HELD_ORGANIZATION_SENTENCE,
  }),
  // A replacement cover's CHECK and trigger (`media_asset_replacement_shape`,
  // `media_asset_replacement_matches`): the cover it pointed at moved.
  Object.freeze({
    constraint: 'media_asset_replacement_',
    statusCode: 409,
    code: 'MEDIA_CHANGED',
    message: MEDIA_CHANGED_SENTENCE,
  }),
  // SPEC3 §5.5: every CHECK and trigger the booking fee, referral codes and
  // paying at the venue add, so none can reach a 500 (and the refused row is
  // never logged). Several names contain others (`event_venue_payment_shape`
  // contains `venue_payment_shape`): `databaseRefusal` takes the longest name
  // the error carries, so the order here does not decide.
  ...[
    'event_fee_shape',
    'event_fee_setting_shape',
    'event_venue_payment_shape',
    'event_venue_payment_change_shape',
    'event_fee_setting_append_only',
  ].map((constraint) =>
    Object.freeze({
      constraint,
      statusCode: 409,
      code: 'PAYMENT_TERMS_CHANGED',
      message: PAYMENT_TERMS_RACE_SENTENCE,
    }),
  ),
  Object.freeze({
    constraint: 'referral_code_shape',
    statusCode: 409,
    code: 'REFERRAL_CODE_CHANGED',
    message: REFERRAL_CODE_RACE_SENTENCE,
  }),
  // A count past the code's limit, whatever path got there: the buyer's answer.
  Object.freeze({
    constraint: 'referral_code_use_within_limit',
    statusCode: 409,
    code: 'REFERRAL_NOT_ACCEPTED',
    message: REFERRAL_NOT_ACCEPTED_SENTENCE,
  }),
  ...[
    'order_fee_parts',
    'order_fee_waiver_whole',
    'order_fee_terms_shape',
    'order_venue_payment_shape',
    'order_item_venue_due_shape',
  ].map((constraint) =>
    Object.freeze({
      constraint,
      statusCode: 409,
      code: 'PRICE_CHANGED',
      message: ORDER_PRICE_RACE_SENTENCE,
    }),
  ),
  Object.freeze({
    constraint: 'check_in_payment_due',
    statusCode: 409,
    code: 'PAYMENT_DUE',
    message: PAYMENT_DUE_SENTENCE,
  }),
  ...[
    'ticket_venue_due_shape',
    'venue_payment_shape',
    'ticket_venue_payment_fixed',
    'venue_payment_order',
    'venue_payment_append_only',
    'venue_payment_sum',
  ].map((constraint) =>
    Object.freeze({
      constraint,
      statusCode: 409,
      code: 'PAYMENT_NOT_RECORDED',
      message: PAYMENT_NOT_RECORDED_SENTENCE,
    }),
  ),
])

/**
 * The codes of a transaction that ran out of time, which PostgreSQL or Prisma
 * rolled back whole.
 *
 * - `P2028`: Prisma's interactive transaction outlived its `timeout`, or could
 *   not start within its `maxWait`. Prisma rolls it back, and the next
 *   statement in it is refused. A statement already waiting on a row lock is
 *   not interrupted by this: it waits until the lock is let go.
 * - `55P03` `lock_not_available`: a statement waited past the transaction's
 *   `lock_timeout` for a row another transaction holds
 *   (`lib/transaction-budget.js` sets one on every transaction that can wait
 *   behind another). PostgreSQL cancels the statement, which ends the
 *   transaction, and lets go of everything it had locked.
 * - `57014` `query_canceled`: a statement ran past the transaction's
 *   `statement_timeout`, which the same module sets to the transaction's
 *   budget (a statement queued behind another waiter waits for two locks, so
 *   `lock_timeout` alone does not bound it). The same: cancelled, ended,
 *   every lock let go.
 *
 * None leaves anything of the transaction behind, so trying again is the
 * remedy, and the answer is a 503 rather than a fault.
 *
 * @type {ReadonlySet<string>}
 */
const OUT_OF_TIME_CODES = Object.freeze(new Set(['P2028', '55P03', '57014']))

/** Seconds a caller is told to wait, in `Retry-After`, before trying again. */
export const OUT_OF_TIME_RETRY_AFTER_SECONDS = 5

/**
 * What a caller is told when a transaction ran out of time and no service
 * said more precisely what was not done. True of every route, including one
 * that saved something in an earlier transaction: only what it was doing
 * when it stopped is said to be unsaved.
 *
 * @type {string}
 */
export const OUT_OF_TIME_SENTENCE =
  'Another change was being saved at the same moment and this request ran out of time waiting for it, so what it was doing when it stopped was not saved. Try again in a moment.'

/**
 * Whether a database error is a transaction that ran out of time (`P2028`),
 * a lock wait past its `lock_timeout` (`55P03`) or a statement past its
 * `statement_timeout` (`57014`), wherever the driver put the code.
 *
 * @param {unknown} error The thrown value.
 * @returns {boolean} True for one.
 */
export function isOutOfTime(error) {
  if (!error || typeof error !== 'object') return false

  const { codes } = databaseRefusalParts(error)

  return [...codes].some((code) => OUT_OF_TIME_CODES.has(code))
}

/** The SQLSTATE and Prisma codes of a lost deadlock or write conflict. */
const RETRYABLE_CODES = Object.freeze(new Set(['40P01', 'P2034']))

/**
 * Whether a database error is a deadlock or a write conflict that a retry
 * would get past (`40P01`, `P2034`), wherever the driver put the code.
 *
 * @param {unknown} error The thrown value.
 * @returns {boolean} True for one.
 */
export function isRetryableConflict(error) {
  if (!error || typeof error !== 'object') return false

  const { codes } = databaseRefusalParts(error)

  return [...codes].some((code) => RETRYABLE_CODES.has(code))
}

/**
 * The SQLSTATE and the text a database refusal arrived with, wherever the
 * driver adapter and Prisma put them.
 *
 * @param {unknown} error The thrown value.
 * @returns {{codes: Set<string>, text: string}} Every code found, and every message joined.
 */
function databaseRefusalParts(error) {
  const cause = /** @type {any} */ (error)?.meta?.driverAdapterError?.cause
  const codes = new Set(
    [
      /** @type {any} */ (error)?.code,
      cause?.originalCode,
      cause?.code,
      /** @type {any} */ (error)?.cause?.code,
    ].filter((code) => typeof code === 'string'),
  )
  const text = [
    /** @type {any} */ (error)?.message,
    cause?.originalMessage,
    cause?.constraint,
    typeof cause?.constraint === 'object' ? JSON.stringify(cause.constraint) : null,
    /** @type {any} */ (error)?.meta?.constraint,
    /** @type {any} */ (error)?.constraint,
  ]
    .filter((part) => typeof part === 'string')
    .join('\n')

  return { codes, text }
}

/**
 * The refusal a database error means, or null when it is not one of ours.
 *
 * `23514` (a CHECK or a trigger raising it, which Prisma may also report as
 * `P2004`) together with one of {@link DATABASE_REFUSALS}' constraint names.
 * Both are required, so an unrelated check violation is still a fault.
 *
 * @param {unknown} error The thrown value.
 * @returns {Error|null} A 4xx carrying the refusal's code and sentence, or null.
 */
export function databaseRefusal(error) {
  if (!error || typeof error !== 'object') return null

  const { codes, text } = databaseRefusalParts(error)

  if (!codes.has('23514') && !codes.has('P2004')) return null

  // The longest name the error carries wins: `event_venue_payment_shape`
  // contains `venue_payment_shape`, and `order_venue_payment_shape` does too,
  // and each means something different to the caller.
  const refusal = DATABASE_REFUSALS.filter((candidate) => text.includes(candidate.constraint)).sort(
    (left, right) => right.constraint.length - left.constraint.length,
  )[0]

  return refusal ? httpError(refusal.statusCode, refusal.code, refusal.message) : null
}

/**
 * Pick a sensible status for a thrown value.
 *
 * @param {unknown} error The thrown value.
 * @returns {number} An HTTP status between 400 and 599.
 */
function statusOf(error) {
  const raw = /** @type {{statusCode?: unknown, status?: unknown}} */ (error) ?? {}
  const candidate = typeof raw.statusCode === 'number' ? raw.statusCode : raw.status

  if (typeof candidate !== 'number' || !Number.isInteger(candidate)) return 500
  if (candidate < 400 || candidate > 599) return 500

  return candidate
}

/**
 * Translate a thrown value into the response envelope's `error` object.
 *
 * Internals are only exposed when `exposeInternals` is true (i.e. outside
 * production): an unexpected 5xx otherwise answers with a fixed message so a
 * stack trace, a SQL fragment or a connection string can never reach a client.
 *
 * @param {unknown} error The thrown value.
 * @param {object} [options] Behaviour switches.
 * @param {boolean} [options.exposeInternals] Whether to send an unexpected error's own message.
 * @returns {NormalisedError} The normalised error.
 */
export function normaliseError(error, options = {}) {
  const { exposeInternals = false } = options

  // A character PostgreSQL cannot store — a NUL above all, which every text
  // and JSON column refuses, and a lone surrogate, which every JSON column
  // refuses — is a bad request, not a fault. The request validator refuses
  // both in every string of a validated request (`lib/validation.js`), so
  // this is the backstop for one that arrives by another road: the caller
  // hears 400 and what to change, and the log is not given a 500.
  if (UNSTORABLE_CHARACTER_CODES.has(databaseErrorCode(error)) || isUnstorableJson(error)) {
    return {
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: UNSTORABLE_CHARACTER_MESSAGE,
      expected: true,
    }
  }

  // A number or a date outside what its column holds — a revision past an
  // integer column, a date in year 0 — is a bad request too. The request
  // schemas bound the ones they know of (a revision, a query's dates), so
  // this is the backstop for a field that forgets to.
  if (isOutOfRange(error)) {
    return {
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: OUT_OF_RANGE_MESSAGE,
      expected: true,
    }
  }

  // A transaction that ran out of time: past its budget, or past its lock
  // wait behind another transaction. It was rolled back whole, so this is a
  // 503 to try again, never a 500 carrying the driver's message. A service
  // that knows what was not done says so itself (`lib/transaction-budget.js`);
  // this is the floor for every other path.
  if (isOutOfTime(error)) {
    return {
      statusCode: 503,
      code: CODE_BY_STATUS[503],
      message: OUT_OF_TIME_SENTENCE,
      expected: true,
      retryAfterSeconds: OUT_OF_TIME_RETRY_AFTER_SECONDS,
    }
  }

  // A deadlock or write conflict lost to a change saved at the same moment
  // (SPEC2-XI X-E). Nothing of this write was kept; trying again is the fix.
  if (isRetryableConflict(error)) {
    return { statusCode: 409, code: 'TRY_AGAIN', message: TRY_AGAIN_SENTENCE, expected: true }
  }

  // A rule the database holds for the service — the review gate, the posting-
  // role rule on team invitations — refusing a write a code path forgot to
  // check. The caller hears the rule, not a 500.
  const refusal = databaseRefusal(error)

  if (refusal) {
    return {
      statusCode: refusal.statusCode,
      code: refusal.code,
      message: refusal.message,
      expected: true,
    }
  }

  if (isAuthError(error)) {
    return {
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'A valid bearer token is required.',
      expected: true,
    }
  }

  if (isDomainError(error)) {
    const statusCode = statusOf(error)
    /** @type {NormalisedError} */
    const normalised = {
      statusCode,
      code: /** @type {{code?: string}} */ (error).code ?? CODE_BY_STATUS[statusCode] ?? 'ERROR',
      message: /** @type {Error} */ (error).message,
      expected: statusCode < 500,
    }

    const issues = /** @type {{issues?: unknown}} */ (error).issues
    if (Array.isArray(issues) && issues.length > 0 && normalised.code === 'VALIDATION_ERROR') {
      normalised.issues = issues
    }

    // Coherence reasons a business rule collected. Forwarded only below 500:
    // a refusal the caller can act on is worth explaining, and an internal
    // fault's details are not theirs to read.
    const problems = /** @type {{details?: {problems?: unknown}}} */ (error).details?.problems
    if (Array.isArray(problems) && problems.length > 0 && statusCode < 500) {
      normalised.problems = problems.map(String)
    }

    const reason = refusalReasonOf(error)
    if (reason && statusCode < 500) normalised.reason = reason

    // A provider wiring mistake is a 500: do not leak the adapter's own words.
    if (statusCode >= 500 && !exposeInternals) {
      normalised.message = INTERNAL_ERROR_MESSAGE
      normalised.code = INTERNAL_ERROR_CODE
    }

    return normalised
  }

  const statusCode = statusOf(error)

  // A 5xx the API raised on purpose, with a sentence the caller must read:
  // "your payment may have been taken; do not pay again" is not an internal
  // detail, and replacing it with "An unexpected error occurred" is how a
  // buyer comes to pay twice. Only an error built by `exposedServerError`
  // carries `expose`, so an unexpected failure is still masked.
  if (statusCode >= 500 && /** @type {{expose?: unknown}} */ (error)?.expose === true) {
    /** @type {NormalisedError} */
    const exposed = {
      statusCode,
      code: /** @type {{code?: string}} */ (error).code ?? INTERNAL_ERROR_CODE,
      message: /** @type {Error} */ (error).message,
      expected: false,
    }

    const orderReference = orderReferenceOf(error)
    if (orderReference) exposed.orderReference = orderReference

    return exposed
  }

  if (statusCode >= 500) {
    return {
      statusCode,
      code: exposeInternals
        ? /** @type {{code?: string}} */ (error?.code ?? INTERNAL_ERROR_CODE)
        : INTERNAL_ERROR_CODE,
      message: exposeInternals
        ? /** @type {Error} */ (error?.message ?? INTERNAL_ERROR_MESSAGE)
        : INTERNAL_ERROR_MESSAGE,
      expected: false,
    }
  }

  const rawCode = /** @type {{code?: unknown}} */ (error)?.code
  const code =
    typeof rawCode === 'string' && !rawCode.startsWith('FST_')
      ? rawCode
      : (CODE_BY_STATUS[statusCode] ?? 'ERROR')

  /** @type {NormalisedError} */
  const normalised = {
    statusCode,
    code,
    message: /** @type {Error} */ (error)?.message ?? 'Request failed.',
    expected: true,
  }

  const validation = /** @type {{validation?: unknown}} */ (error)?.validation
  if (Array.isArray(validation) && validation.length > 0) {
    normalised.issues = validation.map((issue) => ({
      path: String(issue?.instancePath ?? issue?.path ?? ''),
      code: String(issue?.keyword ?? issue?.code ?? 'invalid'),
      message: String(issue?.message ?? 'Invalid value'),
    }))
  }

  // The API's own refusals arrive here rather than above: `httpError` builds a
  // plain `Error` with a `statusCode`, not one of the packages' domain classes.
  // This branch is where a 422 from `unprocessable(message, { problems })`
  // actually lands, so it is where the reasons have to be picked up.
  const problems = /** @type {{details?: {problems?: unknown}}} */ (error)?.details?.problems
  if (Array.isArray(problems) && problems.length > 0) {
    normalised.problems = problems.map(String)
  }

  const reason = refusalReasonOf(error)
  if (reason) normalised.reason = reason

  const orderReference = orderReferenceOf(error)
  if (orderReference) normalised.orderReference = orderReference

  const details = exposedDetailsOf(error, code)
  if (details) normalised.details = details

  return normalised
}

/**
 * The part of a refusal's `details` its caller is told, for the codes in
 * `EXPOSED_DETAILS` only.
 *
 * @param {unknown} error The thrown value.
 * @param {string} code The code the answer carries.
 * @returns {Record<string, unknown>|null} The keys that are told, or null.
 */
function exposedDetailsOf(error, code) {
  const allowed = Object.hasOwn(EXPOSED_DETAILS, code) ? EXPOSED_DETAILS[code] : null
  const details = /** @type {{details?: unknown}} */ (error)?.details

  if (!allowed || !details || typeof details !== 'object') return null

  /** @type {Record<string, unknown>} */
  const exposed = {}

  for (const [key, accepts] of Object.entries(allowed)) {
    if (Object.hasOwn(details, key) && accepts(details[key])) exposed[key] = details[key]
  }

  return Object.keys(exposed).length > 0 ? exposed : null
}

/**
 * The order a checkout answer is about, when the service named one.
 *
 * A checkout that placed an order and could not finish it — a capture that
 * timed out, a capture the order could not be completed for, a retry of an
 * attempt whose payment is still being checked — has to tell the buyer where
 * that order is, or the only thing left to press is Pay. The service puts the
 * reference in `details.orderReference`; only a bare reference is forwarded.
 *
 * @param {unknown} error The thrown value.
 * @returns {string|null} The reference, or null.
 */
function orderReferenceOf(error) {
  const reference = /** @type {{details?: {orderReference?: unknown}}} */ (error)?.details
    ?.orderReference

  return typeof reference === 'string' && /^[A-Z0-9-]{4,32}$/u.test(reference) ? reference : null
}

/**
 * The machine-readable refusal code a service attached, if it is one.
 *
 * A door scanner has to branch on *why* a ticket was refused — refunded, wrong
 * event, preview expired — and a sentence is not something to branch on. The
 * services that refuse from a closed vocabulary (`ADMISSION_REFUSAL_REASONS`,
 * `CONNECT_REFUSAL_REASONS`) put the code in `details.reason`; it used to stop
 * there, in the log. Only a bare upper-case identifier is forwarded, so a
 * free-text reason somebody passes as detail one day cannot reach a client by
 * this route.
 *
 * @param {unknown} error The thrown value.
 * @returns {string|null} The code, or null.
 */
function refusalReasonOf(error) {
  const reason = /** @type {{details?: {reason?: unknown}}} */ (error)?.details?.reason

  return typeof reason === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/u.test(reason) ? reason : null
}

/**
 * Build the complete response body for a normalised error.
 *
 * @param {NormalisedError} normalised The normalised error.
 * @param {string} [requestId] The request id, echoed so a user can quote it in a support ticket.
 * @returns {{error: {code: string, message: string, statusCode: number, issues?: object[], problems?: string[], reason?: string, orderReference?: string, details?: object, requestId?: string}}} The response body.
 */
export function toErrorBody(normalised, requestId) {
  /** @type {Record<string, unknown>} */
  const error = {
    code: normalised.code,
    message: normalised.message,
    statusCode: normalised.statusCode,
  }

  if (normalised.issues) error.issues = normalised.issues
  if (normalised.problems) error.problems = normalised.problems
  if (normalised.reason) error.reason = normalised.reason
  if (normalised.orderReference) error.orderReference = normalised.orderReference
  if (normalised.details) error.details = normalised.details
  if (requestId) error.requestId = String(requestId).slice(0, 64)

  return { error: /** @type {never} */ (error) }
}

/**
 * Build an error that the error handler will render with a given status.
 *
 * Used for the API's own business rejections (a duplicate email, an event that
 * is not visible) which have no package of their own.
 *
 * @param {number} statusCode HTTP status to answer with.
 * @param {string} code Machine-readable code, e.g. `CONFLICT`.
 * @param {string} message Human-readable message.
 * @param {object} [details] Extra context attached for logging.
 * @returns {Error} An error carrying `statusCode` and `code`.
 */
export function httpError(statusCode, code, message, details) {
  const error = new Error(message)

  Object.assign(error, { statusCode, code, ...(details ? { details } : {}) })

  return error
}

/**
 * A 5xx whose code and sentence reach the caller in production too.
 *
 * For the few server-side outcomes the caller has to act on — above all a
 * checkout whose payment may already have been taken, where the one thing the
 * buyer must be told is not to pay again. Everything else that fails with a
 * 5xx is still masked by `normaliseError`, so a stack trace or a SQL fragment
 * cannot leave by this road: only a message written here does.
 *
 * @param {number} statusCode HTTP status, 500 or above.
 * @param {string} code Machine-readable code, e.g. `PAYMENT_TIMEOUT`.
 * @param {string} message The sentence for the caller.
 * @param {object} [details] Extra context; `orderReference` is forwarded.
 * @returns {Error} An error carrying `statusCode`, `code` and `expose`.
 */
export function exposedServerError(statusCode, code, message, details) {
  return Object.assign(httpError(statusCode, code, message, details), { expose: true })
}

/**
 * Shorthand for a 404 that never distinguishes "absent" from "not yours".
 *
 * @param {string} [message] Message to send.
 * @returns {Error} A 404 error.
 */
export function notFound(message = 'Resource not found.') {
  return httpError(404, 'NOT_FOUND', message)
}

/**
 * Shorthand for a 409 state collision.
 *
 * @param {string} message Message to send.
 * @param {object} [details] Extra context attached for logging.
 * @returns {Error} A 409 error.
 */
export function conflict(message, details) {
  return httpError(409, 'CONFLICT', message, details)
}

/**
 * Shorthand for a 422: well-formed but not actionable.
 *
 * @param {string} message Message to send.
 * @param {object} [details] Extra context attached for logging.
 * @returns {Error} A 422 error.
 */
export function unprocessable(message, details) {
  return httpError(422, 'UNPROCESSABLE', message, details)
}

/**
 * Shorthand for a 401.
 *
 * @param {string} [message] Message to send.
 * @param {string} [code] Machine-readable code. Defaults to `UNAUTHORIZED`; a
 *   caller names its own when the remedy differs — `MFA_ENROLMENT_REQUIRED`
 *   means "enrol a factor", which is a different action from "sign in again".
 * @returns {Error} A 401 error.
 */
export function unauthorized(message = 'A valid bearer token is required.', code = 'UNAUTHORIZED') {
  return httpError(401, code, message)
}

/**
 * Shorthand for a 403: authenticated, and still not allowed.
 *
 * The code is a parameter rather than fixed because a 403 arrives for two
 * genuinely different reasons — the caller lacks a capability, or holds it and
 * has not authenticated again recently — and a client that wants to offer a
 * "confirm your identity" prompt has to be able to tell them apart.
 *
 * @param {string} message Message to send.
 * @param {string} [code] Machine-readable code.
 * @returns {Error} A 403 error.
 */
export function forbidden(message, code = 'FORBIDDEN') {
  return httpError(403, code, message)
}

/**
 * Shorthand for a 429, carrying the interval the caller should wait.
 *
 * @param {string} message Message to send.
 * @param {number} [retryAfterSeconds] Seconds to put in `Retry-After`.
 * @returns {Error} A 429 error.
 */
export function tooManyRequests(message, retryAfterSeconds) {
  const error = httpError(429, 'RATE_LIMITED', message)

  if (Number.isFinite(retryAfterSeconds)) {
    Object.assign(error, { retryAfterSeconds: Math.max(1, Math.ceil(retryAfterSeconds)) })
  }

  return error
}

/**
 * The database's own error code, wherever Prisma put it.
 *
 * A `RAISE EXCEPTION` from a trigger reaches the client as PostgreSQL's
 * `P0001`, and Prisma wraps it: the outer `error.code` is a Prisma code
 * (`P2039` at the time of writing, and not stable across versions), while the
 * original sits under `meta.driverAdapterError.cause.originalCode`. Checking
 * only the outer one is how a trigger refusal — which the application is
 * supposed to handle — arrives at a user as a 500.
 *
 * Both places are checked, and the outer one first, so an ordinary unique
 * violation (`P2002`, which Prisma does surface directly) still matches.
 *
 * @param {unknown} error Whatever was thrown.
 * @returns {string|null} The database's code, or null when there is not one.
 */
export function databaseErrorCode(error) {
  const outer = error?.code

  if (typeof outer === 'string' && outer.startsWith('P') && outer !== 'P2039') return outer

  const nested = error?.meta?.driverAdapterError?.cause?.originalCode

  return typeof nested === 'string' ? nested : typeof outer === 'string' ? outer : null
}

/**
 * What a trigger said when it refused a write.
 *
 * The message is the one the migration wrote, which is prose somebody chose to
 * be read — "check-in refused: ticket … is CHECKED_IN, which does not admit".
 * A handler that has decided to surface it has something better to say than a
 * generic conflict.
 *
 * @param {unknown} error Whatever was thrown.
 * @returns {string|null} The trigger's message, or null.
 */
export function triggerMessage(error) {
  const nested = error?.meta?.driverAdapterError?.cause?.originalMessage

  return typeof nested === 'string' ? nested : null
}
