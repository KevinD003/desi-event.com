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
  const lines = rendered.lines.map((line) => String(line).trim()).filter((line) => line !== '')

  return {
    subject: subject ?? rendered.subject,
    text: [...lines, '', `— ${BRAND_NAME}`].join('\n\n'),
    html: toHtml(rendered.heading, lines),
  }
}
