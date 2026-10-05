/**
 * The letters that carry a show-once code: an organiser invitation, a team
 * invitation and a ticket transfer.
 *
 * One module for both roads a code travels. In `EMAIL` mode the API's mailer
 * sends these words through SMTP; in `MANUAL` mode the browser composes the
 * same words for whoever issued the code to copy and send themselves. Sharing
 * the module is what stops the two from drifting.
 *
 * Rules every letter keeps:
 *
 *   - **The code is never in a link.** The letter names the page where the code
 *     is typed, and {@link assertJoinUrl} refuses an address with a query or a
 *     fragment, so nothing can be appended to it.
 *   - **The code sits alone on its own line**, indented four spaces. It is
 *     ASCII (the url-safe alphabet), so it reads the same in any mail client
 *     and survives any transfer encoding.
 *   - **Letters are UTF-8 plain text.** Organisation names and notes keep their
 *     script — Gujarati, Devanagari, anything — and plain text means no markup
 *     from a name or a note can do anything.
 *   - **Words somebody else wrote are quoted.** An administrator's note or a
 *     ticket sender's message appears under a rule, introduced as theirs, with
 *     every line prefixed `> `, so it cannot pass for Desi-Event's own words.
 *   - **Nothing is guessed.** Each letter refuses to be written when a field it
 *     needs is missing (`TypeError`), so a mailer fails closed and sends
 *     nothing rather than a letter with a blank where the expiry should be.
 *
 * Pure, with no imports: safe in the browser bundle.
 *
 * @module @desi-event/schemas/code-letters
 */

/** The url-safe alphabet a code is written in, and its bounds. */
const CODE_PATTERN = /^[A-Za-z0-9_-]{16,512}$/u

/** Hosts a plain-http join address may name: a developer's own machine. */
const LOCAL_HOSTS = Object.freeze(['localhost', '127.0.0.1', '[::1]'])

/** English month names, so a date reads the same wherever the letter is composed. */
const MONTHS = Object.freeze([
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
])

/** The rule a quoted passage sits under. */
const RULE = '----------------------------------------'

/** The closing line of every letter. */
const IGNORE_LINE =
  'If you were not expecting this, you can ignore it. Nothing happens unless the code is used.'

/**
 * How a team role reads in a sentence ("as {label}").
 *
 * @type {Readonly<Record<string, string>>}
 */
export const TEAM_ROLE_PHRASES = Object.freeze({
  OWNER: 'its owner',
  ADMIN: 'an administrator',
  MANAGER: 'a manager',
  EVENT_MANAGER: 'an event manager',
  FINANCE: 'a member of its finance team',
  STAFF: 'a member of its staff',
  SCANNER: 'a ticket scanner',
  VIEWER: 'a viewer',
})

/**
 * Throw unless a required field is present.
 *
 * @param {string} letter Which letter, for the message.
 * @param {object} fields The fields given.
 * @param {string[]} names The fields the letter needs.
 * @returns {void}
 * @throws {TypeError} Naming the first missing field.
 */
function requireFields(letter, fields, names) {
  for (const name of names) {
    const value = fields?.[name]
    const missing =
      value === undefined || value === null || (typeof value === 'string' && value.trim() === '')

    if (missing) throw new TypeError(`The ${letter} letter needs "${name}".`)
  }
}

/**
 * Throw unless a code is one the letter can carry on its own ASCII line.
 *
 * @param {unknown} code The code.
 * @returns {string} The code.
 * @throws {TypeError} When it is not a url-safe code.
 */
function assertCode(code) {
  if (typeof code !== 'string' || !CODE_PATTERN.test(code)) {
    throw new TypeError('A code must be written in the url-safe alphabet, 16 to 512 characters.')
  }

  return code
}

/**
 * Throw unless a join address is safe to print beside a code.
 *
 * Absolute, `https:` — or `http:` only for a developer's own machine — and with
 * no query string or fragment, so neither the code nor anything else can ride
 * along in it.
 *
 * @param {unknown} joinUrl The address of the page where the code is typed.
 * @returns {string} The address, as given.
 * @throws {TypeError} When it is not one.
 */
export function assertJoinUrl(joinUrl) {
  if (typeof joinUrl !== 'string' || joinUrl.trim() === '') {
    throw new TypeError('A join address is required.')
  }

  if (/[?#]/u.test(joinUrl)) {
    throw new TypeError(
      'A join address cannot carry a query string or a fragment: the code is typed, never linked.',
    )
  }

  let url

  try {
    url = new URL(joinUrl)
  } catch {
    throw new TypeError('A join address must be absolute.')
  }

  if (url.protocol === 'https:') return joinUrl

  if (url.protocol === 'http:' && LOCAL_HOSTS.includes(url.hostname)) return joinUrl

  throw new TypeError('A join address must use https (http only on this machine).')
}

/**
 * When a code stops working, in words: `29 October 2026, 18:00 UTC`.
 *
 * @param {Date|string|number} value The instant.
 * @returns {string} The formatted instant.
 * @throws {TypeError} When it is not a date.
 */
export function formatLetterExpiry(value) {
  const date = value instanceof Date ? value : new Date(value)

  if (Number.isNaN(date.getTime())) throw new TypeError('An expiry must be a date.')

  const hours = String(date.getUTCHours()).padStart(2, '0')
  const minutes = String(date.getUTCMinutes()).padStart(2, '0')

  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}, ${hours}:${minutes} UTC`
}

/**
 * Text somebody wrote, quoted: control characters other than line breaks
 * dropped, and every line prefixed `> `.
 *
 * @param {string} text Their words.
 * @returns {string} The quoted block.
 */
function quote(text) {
  return String(text)
    .replace(/\r\n?/gu, '\n')
    .replace(/(?!\n)\p{Cc}/gu, '')
    .trim()
    .split('\n')
    .map((line) => (line.trim() === '' ? '>' : `> ${line}`))
    .join('\n')
}

/**
 * A name inside quotation marks, on one line.
 *
 * @param {string} name The name.
 * @returns {string} The name, with line breaks and control characters removed.
 */
function oneLine(name) {
  return String(name)
    .replace(/\p{Cc}+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
}

/**
 * The block every letter shares: the code on its own line, how to use it, and
 * how long it lasts.
 *
 * @param {object} options Inputs.
 * @param {string} options.noun "invitation code" or "transfer code".
 * @param {string} options.code The code.
 * @param {string} options.email The address it is bound to.
 * @param {string} options.joinUrl Where it is typed.
 * @param {string} options.action What accepting it does, after "To ".
 * @param {Date|string} options.expiresAt When it stops working.
 * @returns {string[]} The lines.
 */
function codeBlock({ noun, code, email, joinUrl, action, expiresAt }) {
  return [
    `Your ${noun} is:`,
    '',
    `    ${assertCode(code)}`,
    '',
    `To ${action}:`,
    `1. Open ${assertJoinUrl(joinUrl)}`,
    `2. Sign in, or create an account, with this email address: ${email}`,
    `3. Type the ${noun} above.`,
    '',
    `The code works once, only for an account using ${email}, until ${formatLetterExpiry(expiresAt)}.`,
    'Keep it to yourself, as you would a password.',
  ]
}

/**
 * The letter that carries an organiser invitation.
 *
 * @param {object} fields What to say.
 * @param {string} fields.code The invitation code.
 * @param {string} fields.email The address it was sent to.
 * @param {string} fields.organizationName The organisation it starts.
 * @param {Date|string} fields.expiresAt When the code stops working.
 * @param {string} fields.joinUrl The join page, without the code.
 * @param {string|null} [fields.note] The administrator's note for the recipient.
 * @param {string|null} [fields.inviterName] The inviting administrator's name.
 * @returns {{subject: string, text: string}} The letter.
 * @throws {TypeError} When a required field is missing or unusable.
 */
export function organizerInvitationLetter(fields) {
  requireFields('organiser invitation', fields, [
    'code',
    'email',
    'organizationName',
    'expiresAt',
    'joinUrl',
  ])

  const { code, email, organizationName, expiresAt, joinUrl, note, inviterName } = fields
  const lines = [
    'Hello,',
    '',
    `The Desi-Event team has invited you to run events on Desi-Event as the owner of "${oneLine(organizationName)}".`,
    '',
    ...codeBlock({
      noun: 'invitation code',
      code,
      email,
      joinUrl,
      action: 'accept it',
      expiresAt,
    }),
  ]

  if (typeof note === 'string' && note.trim() !== '') {
    const who =
      typeof inviterName === 'string' && inviterName.trim() !== ''
        ? `${oneLine(inviterName)} of the Desi-Event team`
        : 'the Desi-Event team'

    lines.push('', RULE, `A note from ${who}:`, quote(note), RULE)
  }

  lines.push(
    '',
    'Your organisation starts verified, because the Desi-Event team invited you. Each event you create is reviewed by the team before it can be published.',
    '',
    IGNORE_LINE,
  )

  return { subject: 'Your organiser invitation from Desi-Event', text: `${lines.join('\n')}\n` }
}

/**
 * The letter that carries a team invitation.
 *
 * @param {object} fields What to say.
 * @param {string} fields.code The invitation code.
 * @param {string} fields.email The address it was sent to.
 * @param {string} fields.organizationName The organisation.
 * @param {boolean} fields.organizationVerified Whether the Desi-Event team has verified it.
 * @param {string} fields.role The role offered.
 * @param {Date|string} fields.expiresAt When the code stops working.
 * @param {string} fields.joinUrl The join page, without the code.
 * @returns {{subject: string, text: string}} The letter.
 * @throws {TypeError} When a required field is missing or unusable.
 */
export function teamInvitationLetter(fields) {
  requireFields('team invitation', fields, [
    'code',
    'email',
    'organizationName',
    'organizationVerified',
    'role',
    'expiresAt',
    'joinUrl',
  ])

  if (typeof fields.organizationVerified !== 'boolean') {
    throw new TypeError('The team invitation letter needs "organizationVerified" as true or false.')
  }

  const { code, email, organizationName, organizationVerified, role, expiresAt, joinUrl } = fields
  const name = oneLine(organizationName)
  const phrase = TEAM_ROLE_PHRASES[role] ?? oneLine(role)
  const lines = [
    'Hello,',
    '',
    `You have been invited to join "${name}" on Desi-Event as ${phrase}.`,
  ]

  if (!organizationVerified) {
    lines.push('This organisation has not been verified by the Desi-Event team.')
  }

  lines.push(
    '',
    ...codeBlock({
      noun: 'invitation code',
      code,
      email,
      joinUrl,
      action: 'accept it',
      expiresAt,
    }),
    '',
    IGNORE_LINE,
  )

  return {
    subject: `You are invited to join ${name} on Desi-Event`,
    text: `${lines.join('\n')}\n`,
  }
}

/**
 * The letter that carries a ticket transfer.
 *
 * @param {object} fields What to say.
 * @param {string} fields.code The transfer code.
 * @param {string} fields.to The address the ticket was offered to.
 * @param {Date|string} fields.expiresAt When the code stops working.
 * @param {string} fields.joinUrl The page where the code is typed, without it.
 * @param {string|null} [fields.message] The sender's own message.
 * @returns {{subject: string, text: string}} The letter.
 * @throws {TypeError} When a required field is missing or unusable.
 */
export function ticketTransferLetter(fields) {
  requireFields('ticket transfer', fields, ['code', 'to', 'expiresAt', 'joinUrl'])

  const { code, to, expiresAt, joinUrl, message } = fields
  const lines = [
    'Hello,',
    '',
    'Somebody has offered you a ticket on Desi-Event.',
    '',
    ...codeBlock({
      noun: 'transfer code',
      code,
      email: to,
      joinUrl,
      action: 'take the ticket',
      expiresAt,
    }),
  ]

  if (typeof message === 'string' && message.trim() !== '') {
    lines.push(
      '',
      RULE,
      'Message from the sender (written by them, not by Desi-Event):',
      quote(message),
      RULE,
    )
  }

  lines.push('', IGNORE_LINE)

  return {
    subject: 'A ticket has been offered to you on Desi-Event',
    text: `${lines.join('\n')}\n`,
  }
}
