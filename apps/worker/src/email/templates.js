/**
 * Transactional email bodies.
 *
 * Deliberately plain: every message is a subject, a few lines of text and the
 * same text wrapped in minimal HTML. There is no template engine, no layout
 * inheritance and no CSS framework, because the thing that actually breaks
 * transactional email is not typography — it is an unescaped name, a missing
 * value rendering as `undefined`, or a body that never got sent at all.
 *
 * Two rules hold everywhere in this file:
 *
 *  * **Every interpolated value is escaped for HTML.** `data` comes from the
 *    job payload, which comes from user input: a buyer called
 *    `<script>alert(1)</script>` must not become one.
 *  * **A missing value degrades to a readable fallback**, never to the string
 *    `undefined`. A confirmation that says "your order" is fine; one that says
 *    "order undefined" is a support ticket.
 *
 * @module @desi-event/worker/email/templates
 */

import { DEMO_LABEL, DEMO_PAYMENT_NOTICE, DEMO_TICKET_NOTICE } from '@desi-event/providers'

/** Sender name shown to recipients. */
export const BRAND_NAME = 'Desi-Event'

/** HTML entities that must never survive interpolation. */
const HTML_ESCAPES = Object.freeze({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
})

/**
 * Escape a value for inclusion in HTML text or an attribute.
 *
 * @param {unknown} value Any value; non-strings are stringified first.
 * @returns {string} The escaped string.
 */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => HTML_ESCAPES[character])
}

/**
 * Read a field from the job payload's `data` bag with a fallback.
 *
 * @param {Record<string, unknown>} data The payload's `data` object.
 * @param {string} key Field to read.
 * @param {string} fallback Value used when the field is absent or blank.
 * @returns {string} A trimmed, non-empty string.
 */
export function field(data, key, fallback) {
  const value = data?.[key]
  if (value === undefined || value === null) return fallback
  const text = String(value).trim()
  return text === '' ? fallback : text
}

/**
 * Format an amount of integer cents for display.
 *
 * Money is integer cents everywhere in this system; this is the one place it
 * becomes a decimal string, and it does so by integer division rather than by
 * dividing a float, so a total of `2999` can never render as `29.990000000001`.
 *
 * @param {unknown} cents Integer cents.
 * @param {string} [currency] ISO-4217 code shown before the amount.
 * @returns {(string|null)} A formatted amount, or `null` when `cents` is not an integer.
 */
export function formatCents(cents, currency = 'INR') {
  if (!Number.isInteger(cents)) return null

  const negative = cents < 0
  const absolute = Math.abs(/** @type {number} */ (cents))
  const major = Math.floor(absolute / 100)
  const minor = String(absolute % 100).padStart(2, '0')

  return `${currency} ${negative ? '-' : ''}${major}.${minor}`
}

/**
 * Turn a list of text lines into a minimal HTML document.
 *
 * @param {string} heading The `<h1>` text, escaped here.
 * @param {string[]} lines Body paragraphs, escaped here.
 * @returns {string} A complete, self-contained HTML body.
 */
function toHtml(heading, lines) {
  const paragraphs = lines
    .filter((line) => line !== '')
    .map((line) => `    <p>${escapeHtml(line)}</p>`)
    .join('\n')

  return [
    '<div style="font-family:system-ui,sans-serif;line-height:1.5;max-width:40rem">',
    `    <h1 style="font-size:1.25rem">${escapeHtml(heading)}</h1>`,
    paragraphs,
    `    <p style="color:#666;font-size:0.875rem">— ${escapeHtml(BRAND_NAME)}</p>`,
    '</div>',
  ].join('\n')
}

/**
 * @typedef {object} RenderedEmail
 * @property {string} subject The subject line.
 * @property {string} text The plain-text body.
 * @property {string} html The HTML body.
 */

/**
 * @callback TemplateRenderer
 * @param {Record<string, unknown>} data The job payload's `data` bag.
 * @returns {{subject: string, heading: string, lines: string[]}} Subject, heading and body lines.
 */

/**
 * Name an order, degrading to a generic phrase when the reference is missing.
 *
 * @param {Record<string, unknown>} data The payload data bag.
 * @param {boolean} [capitalised] Whether the phrase starts a sentence.
 * @returns {string} Either `order DE-8F3K2Q` or `your order`.
 */
function orderPhrase(data, capitalised = false) {
  const reference = field(data, 'orderReference', '')
  if (reference === '') return capitalised ? 'Your order' : 'your order'
  return `${capitalised ? 'Order' : 'order'} ${reference}`
}

/**
 * The event line shared by most templates.
 *
 * @param {Record<string, unknown>} data The payload data bag.
 * @returns {string} A human-readable event description.
 */
function eventLine(data) {
  const title = field(data, 'eventTitle', 'your event')
  const startsAt = field(data, 'eventStartsAt', '')
  const venue = field(data, 'venueName', '')

  return [`Event: ${title}`, startsAt && `starts ${startsAt}`, venue && `at ${venue}`]
    .filter(Boolean)
    .join(' — ')
}

/**
 * The total line, omitted entirely when the payload carries no usable total.
 *
 * @param {Record<string, unknown>} data The payload data bag.
 * @returns {string} A formatted total, or `''` when there is nothing to show.
 */
function totalLine(data) {
  const total = formatCents(data?.totalCents, field(data, 'currency', 'INR'))
  return total === null ? '' : `Total paid: ${total}`
}

/**
 * The date an event used to start, when a postponement moved it.
 *
 * Omitted entirely rather than rendered as "undefined" when the payload does
 * not carry one, because a notice that names a wrong date is worse than one
 * that names none.
 *
 * @param {Record<string, unknown>} data The payload data bag.
 * @returns {string} A line, or `''`.
 */
function previousDateLine(data) {
  const previous = field(data, 'previousStartsAt', '')

  return previous === '' ? '' : `It was due to start ${previous}.`
}

/**
 * Which details changed, when a material change names them.
 *
 * @param {Record<string, unknown>} data The payload data bag.
 * @returns {string} A line, or `''`.
 */
function changedFieldsLine(data) {
  const changed = data?.changed

  if (!Array.isArray(changed) || changed.length === 0) return ''

  return `What changed: ${changed.map((entry) => String(entry)).join(', ')}.`
}

/**
 * One renderer per template in `EMAIL_TEMPLATES`.
 *
 * @type {Readonly<Record<string, TemplateRenderer>>}
 */
export const TEMPLATES = Object.freeze({
  ORDER_CONFIRMATION: (data) => ({
    subject: `Your ${BRAND_NAME} order ${field(data, 'orderReference', 'is confirmed')}`,
    heading: 'Thanks for your order',
    lines: [
      `Hi ${field(data, 'buyerName', 'there')},`,
      `We have received ${orderPhrase(data)}.`,
      eventLine(data),
      totalLine(data),
      'Your tickets follow in a separate email as soon as they are issued.',
    ],
  }),

  TICKETS_ISSUED: (data) => ({
    subject: `Your tickets for ${field(data, 'eventTitle', 'your event')}`,
    heading: 'Your tickets are ready',
    lines: [
      `Hi ${field(data, 'buyerName', 'there')},`,
      `${field(data, 'ticketCount', 'Your')} ticket(s) have been issued for ${orderPhrase(data)}.`,
      eventLine(data),
      'Show the QR code in your account at the door. Screenshots work too.',
    ],
  }),

  ORDER_CANCELLED: (data) => ({
    subject: `Your ${BRAND_NAME} order was cancelled`,
    heading: 'Order cancelled',
    lines: [
      `Hi ${field(data, 'buyerName', 'there')},`,
      `${orderPhrase(data, true)} has been cancelled.`,
      field(
        data,
        'reason',
        'If you did not expect this, reply to this email and we will look into it.',
      ),
      eventLine(data),
    ],
  }),

  EVENT_REMINDER: (data) => ({
    subject: `Coming up: ${field(data, 'eventTitle', 'your event')}`,
    heading: 'See you soon',
    lines: [
      `Hi ${field(data, 'buyerName', 'there')},`,
      eventLine(data),
      `Doors: ${field(data, 'doorsAt', 'see your ticket')}.`,
      'Bring your ticket QR code and arrive a little early — entry queues build up.',
    ],
  }),

  WAITLIST_AVAILABLE: (data) => ({
    subject: `Tickets are available for ${field(data, 'eventTitle', 'an event you wanted')}`,
    heading: 'A spot opened up',
    lines: [
      `Hi ${field(data, 'buyerName', 'there')},`,
      `${field(data, 'quantity', 'Tickets')} became available for ${field(data, 'eventTitle', 'the event you joined the waitlist for')}.`,
      eventLine(data),
      `Claim them here: ${field(data, 'claimUrl', 'open the event page on Desi-Event')}`,
      'Waitlist spots are first come, first served, so they may not last long.',
    ],
  }),

  EMAIL_VERIFICATION: (data) => ({
    subject: `Confirm your ${BRAND_NAME} email address`,
    heading: 'Confirm your email address',
    lines: [
      `Hi ${field(data, 'displayName', 'there')},`,
      `Confirm your address to finish setting up your account: ${field(data, 'verifyUrl', 'see your account settings')}`,
      'If you did not create a Desi-Event account, you can ignore this email.',
    ],
  }),

  PASSWORD_RESET: (data) => ({
    subject: `Reset your ${BRAND_NAME} password`,
    heading: 'Reset your password',
    lines: [
      `Hi ${field(data, 'displayName', 'there')},`,
      `Use this link to choose a new password: ${field(data, 'resetUrl', 'request a new link from the sign-in page')}`,
      `The link expires in ${field(data, 'expiresIn', '60 minutes')}.`,
      'If you did not ask for this, nothing has changed and you can ignore this email.',
    ],
  }),

  // ---------------------------------------------------------------------
  // Outbox templates.
  //
  // The keys above are the SCREAMING_CASE members of the send-email job's
  // enum. The keys below are the dotted names written into
  // `NotificationOutbox.template` by the event lifecycle, and they keep that
  // spelling on purpose: the column is what an operator reads in a database
  // client, and renaming it here would mean two names for one message.
  // ---------------------------------------------------------------------

  'event.cancelled': (data) => ({
    subject: `${field(data, 'eventTitle', 'An event you booked')} has been cancelled`,
    heading: 'The event has been cancelled',
    lines: [
      'Hello,',
      `${field(data, 'eventTitle', 'The event')} has been cancelled by the organiser.`,
      field(data, 'reason', ''),
      `This affects ${orderPhrase(data)}.`,
      'A refund has been requested. Nothing further is needed from you.',
    ],
  }),

  'event.postponed': (data) => ({
    subject: `${field(data, 'eventTitle', 'An event you booked')} has been postponed`,
    heading: 'The event has been postponed',
    lines: [
      'Hello,',
      `${field(data, 'eventTitle', 'The event')} will no longer take place as planned.`,
      field(data, 'reason', ''),
      previousDateLine(data),
      `Your tickets from ${orderPhrase(data)} remain valid for the new date.`,
    ],
  }),

  'event.changed': (data) => ({
    subject: `Something changed about ${field(data, 'eventTitle', 'an event you booked')}`,
    heading: 'A detail of your event has changed',
    lines: [
      'Hello,',
      `The organiser has changed something about ${field(data, 'eventTitle', 'your event')}.`,
      changedFieldsLine(data),
      field(data, 'reason', ''),
      `Your tickets from ${orderPhrase(data)} are unaffected.`,
    ],
  }),

  'ticket.issued': (data) => ({
    subject: `Your ticket for ${field(data, 'eventTitle', 'your event')}`,
    heading: 'Your ticket is ready',
    lines: [
      'Hello,',
      `A ticket has been issued for ${orderPhrase(data)}.`,
      eventLine(data),
      'Open it in your account to show the pass at the door.',
    ],
  }),

  'ticket.transfer.invited': (data) => ({
    subject: `${field(data, 'fromName', 'Somebody')} wants to send you a ticket`,
    heading: 'A ticket is waiting for you',
    lines: [
      'Hello,',
      `${field(data, 'fromName', 'Somebody')} has offered you a ticket for ${field(data, 'eventTitle', 'an event')}.`,
      'Open your account to accept it. The offer expires, and until you accept it the ticket stays with them.',
    ],
  }),

  'ticket.transfer.completed': (data) => ({
    subject: `Your ticket for ${field(data, 'eventTitle', 'your event')} has been handed on`,
    heading: 'The transfer is complete',
    lines: [
      'Hello,',
      `The ticket you offered for ${field(data, 'eventTitle', 'your event')} has been accepted.`,
      'Your old pass no longer admits anybody. Nothing further is needed from you.',
    ],
  }),

  'ticket.revoked': (data) => ({
    subject: `Your ticket for ${field(data, 'eventTitle', 'your event')} has been withdrawn`,
    heading: 'Your ticket has been withdrawn',
    lines: [
      'Hello,',
      `The organiser has withdrawn a ticket issued for ${orderPhrase(data)}.`,
      field(data, 'reason', 'Contact the organiser if you believe this is a mistake.'),
    ],
  }),

  'refund.settled': (data) => ({
    subject: `Your refund for ${orderPhrase(data)}`,
    heading: 'Your refund has been settled',
    lines: [
      'Hello,',
      `A refund of ${formatCents(data?.amountCents, field(data, 'currency', 'INR')) ?? 'the amount paid'} has been settled against ${orderPhrase(data)}.`,
      'How long it takes to appear depends on your bank.',
    ],
  }),

  'security.alert': (data) => ({
    subject: `A security change on your ${BRAND_NAME} account`,
    heading: 'Something changed on your account',
    lines: [
      'Hello,',
      field(data, 'summary', 'A security-relevant change was made to your account.'),
      'If this was not you, change your password and revoke your sessions now.',
    ],
  }),
})

/**
 * Templates whose subject is money or admission, and which therefore have to
 * say so when neither is real.
 *
 * Desi-Event has no payment integration: every order is settled by an
 * in-memory mock and every ticket admits nobody. A confirmation that reads like
 * a receipt, or a pass that reads like a ticket, is the point at which a
 * demonstration starts misleading somebody — so these carry the notice in the
 * subject line and in the first line of the body, where it cannot be scrolled
 * past.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const DEMO_NOTICE_BY_TEMPLATE = Object.freeze({
  ORDER_CONFIRMATION: DEMO_PAYMENT_NOTICE,
  TICKETS_ISSUED: DEMO_TICKET_NOTICE,
  ORDER_CANCELLED: DEMO_PAYMENT_NOTICE,
  'event.cancelled': DEMO_PAYMENT_NOTICE,
  'ticket.issued': DEMO_TICKET_NOTICE,
  'ticket.transfer.invited': DEMO_TICKET_NOTICE,
  'ticket.transfer.completed': DEMO_TICKET_NOTICE,
  'ticket.revoked': DEMO_TICKET_NOTICE,
  'refund.settled': DEMO_PAYMENT_NOTICE,
})

/**
 * Render a transactional email.
 *
 * @param {object} payload A validated `sendEmailJobSchema` payload.
 * @param {string} payload.template One of the keys of {@link TEMPLATES}.
 * @param {Record<string, unknown>} [payload.data] Values interpolated into the body.
 * @param {string} [payload.subject] Overrides the template's own subject line.
 * @returns {RenderedEmail} Subject plus matching text and HTML bodies.
 * @throws {Error} When `template` has no renderer.
 */
export function renderEmail({ template, data = {}, subject }) {
  const renderer = TEMPLATES[template]

  if (!renderer) {
    throw new Error(
      `No renderer for email template "${template}"; known templates are ${Object.keys(TEMPLATES).join(', ')}`,
    )
  }

  const rendered = renderer(data)
  const notice = DEMO_NOTICE_BY_TEMPLATE[template]
  const body = notice ? [notice, ...rendered.lines] : rendered.lines
  const lines = body.map((line) => String(line).trim()).filter((line) => line !== '')
  const headline = subject ?? rendered.subject

  return {
    subject: notice ? `[${DEMO_LABEL}] ${headline}` : headline,
    text: [...lines, '', `— ${BRAND_NAME}`].join('\n\n'),
    html: toHtml(rendered.heading, lines),
  }
}
