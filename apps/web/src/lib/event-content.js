/**
 * The event page's extra content, as the editor holds it and sends it.
 *
 * The line-up with roles and bios, a running order, questions people ask,
 * sponsors, social links, a dress code, parking and arrival notes, and a
 * public contact. The server's rules live in `@desi-event/schemas/event-content`;
 * this file mirrors the limits and the checks so a counter and a refusal agree
 * before anything is sent. A test holds the two copies equal. The schemas
 * package is not imported here, because this file goes to the browser and the
 * package does not (finding NF-16).
 *
 * The JSON columns cannot hold null, so clearing a list sends `[]` and clearing
 * the social links sends `{}`. A row whose boxes are all empty is dropped rather
 * than refused: it is an "Add" somebody pressed and did not use.
 *
 * `@file` rather than `@module`: `event` is a reserved token in a JSDoc
 * namepath.
 *
 * @file lib/event-content
 */

/**
 * Every bound on the content, mirrored from `EVENT_CONTENT_LIMITS`.
 *
 * @type {Readonly<Record<string, number>>}
 */
export const CONTENT_LIMITS = Object.freeze({
  faqItems: 30,
  faqQuestion: 200,
  faqAnswer: 2000,
  performers: 64,
  performerName: 500,
  performerRole: 80,
  performerBio: 600,
  runningOrderItems: 40,
  runningOrderTitle: 160,
  runningOrderNote: 300,
  sponsors: 30,
  sponsorName: 120,
  sponsorLevel: 60,
  dressCode: 500,
  directions: 2000,
  url: 2048,
  tierName: 120,
  tierDescription: 500,
  perOrderMax: 50,
})

/** The longest description the server takes (`richTextSchema`). */
export const DESCRIPTION_LIMIT = 20_000

/** The social networks, in the order the page lists them. */
export const SOCIAL_NETWORKS = Object.freeze([
  'website',
  'instagram',
  'facebook',
  'youtube',
  'x',
  'whatsapp',
])

/** How each network is named to a person. */
export const SOCIAL_NETWORK_LABELS = Object.freeze({
  website: 'Website',
  instagram: 'Instagram',
  facebook: 'Facebook',
  youtube: 'YouTube',
  x: 'X',
  whatsapp: 'WhatsApp',
})

/**
 * The hosts each network's link may point at. `website` takes any https host.
 *
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
export const SOCIAL_HOSTS = Object.freeze({
  instagram: Object.freeze(['instagram.com', 'www.instagram.com']),
  facebook: Object.freeze([
    'facebook.com',
    'www.facebook.com',
    'm.facebook.com',
    'fb.com',
    'www.fb.com',
  ]),
  youtube: Object.freeze(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be']),
  x: Object.freeze(['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com']),
  whatsapp: Object.freeze([
    'wa.me',
    'chat.whatsapp.com',
    'api.whatsapp.com',
    'whatsapp.com',
    'www.whatsapp.com',
  ]),
})

/** A running-order time: local 24-hour `HH:mm`. */
const RUNNING_ORDER_TIME = /^([01]\d|2[0-3]):[0-5]\d$/u

/** The server's email check, loosely: something, an at sign, a dotted domain. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u

/** The server's phone check (`phoneSchema`). */
const PHONE = /^\+?[0-9][0-9 ()-]{4,}$/u

/** The fields of each kind of row, in the order the form shows them. */
export const ROW_FIELDS = Object.freeze({
  performers: Object.freeze(['name', 'role', 'bio']),
  runningOrder: Object.freeze(['time', 'title', 'note']),
  faq: Object.freeze(['question', 'answer']),
  sponsors: Object.freeze(['name', 'url', 'level']),
})

/**
 * Whether a string is an absolute https address. `new URL()` decides, not a pattern.
 *
 * @param {string} value The candidate.
 * @returns {boolean} True for an https URL with a host.
 */
export function isHttpsAddress(value) {
  try {
    const url = new URL(value)

    return url.protocol === 'https:' && url.hostname.length > 0
  } catch {
    return false
  }
}

/**
 * A blank row of one kind.
 *
 * @param {'performers'|'runningOrder'|'faq'|'sponsors'} kind The list.
 * @returns {object} A row whose every field is empty.
 */
export function blankRow(kind) {
  return Object.fromEntries(ROW_FIELDS[kind].map((field) => [field, '']))
}

/**
 * Rows from the API as form rows, every field a string.
 *
 * @param {unknown} list The stored list.
 * @param {'performers'|'runningOrder'|'faq'|'sponsors'} kind Which list.
 * @returns {object[]} Form rows.
 */
function toRows(list, kind) {
  if (!Array.isArray(list)) return []

  return list.map((row) =>
    Object.fromEntries(ROW_FIELDS[kind].map((field) => [field, row?.[field] ?? ''])),
  )
}

/**
 * The event's content as form values.
 *
 * An event saved before performers existed has only names; those become rows
 * with no role or bio, so the line-up is not lost on the first save.
 *
 * @param {object} event The event as the API returned it.
 * @returns {object} Form values for the content fields.
 */
export function fromEventContent(event) {
  const performers =
    Array.isArray(event.performers) && event.performers.length > 0
      ? toRows(event.performers, 'performers')
      : (event.artists ?? []).map((name) => ({ name, role: '', bio: '' }))

  return {
    performers,
    runningOrder: toRows(event.runningOrder, 'runningOrder'),
    faq: toRows(event.faq, 'faq'),
    sponsors: toRows(event.sponsors, 'sponsors'),
    socialLinks: Object.fromEntries(
      SOCIAL_NETWORKS.map((network) => [network, event.socialLinks?.[network] ?? '']),
    ),
    dressCode: event.dressCode ?? '',
    directions: event.directions ?? '',
    publicEmail: event.publicEmail ?? '',
    publicPhone: event.publicPhone ?? '',
  }
}

/**
 * Whether every box in a row is empty.
 *
 * @param {object} row The row.
 * @returns {boolean} True when nothing was typed.
 */
function isEmptyRow(row) {
  return Object.values(row).every((value) => !String(value ?? '').trim())
}

/**
 * The rows somebody actually filled in.
 *
 * @param {object[]} rows Form rows.
 * @returns {Array<{row: object, index: number}>} Each used row with its position.
 */
function usedRows(rows = []) {
  return rows.map((row, index) => ({ row, index })).filter(({ row }) => !isEmptyRow(row))
}

/**
 * Why a social link is refused, or null.
 *
 * @param {string} network The network.
 * @param {string} href The address.
 * @returns {string|null} The sentence, or null when it is fine.
 */
export function socialLinkProblem(network, href) {
  const text = String(href ?? '').trim()

  if (!text) return null
  if (text.length > CONTENT_LIMITS.url) {
    return `Keep the address to ${CONTENT_LIMITS.url} characters.`
  }
  if (!isHttpsAddress(text)) return 'Use a full https:// address.'
  if (network === 'website') return null

  const hosts = SOCIAL_HOSTS[network] ?? []

  if (!hosts.includes(new URL(text).hostname.toLowerCase())) {
    return `That address is not on ${SOCIAL_NETWORK_LABELS[network]}. Use a link that starts https://${hosts[0]}/.`
  }

  return null
}

/**
 * What is wrong with the content, field by field.
 *
 * Mirrors the server: lengths, required parts of a used row, HH:mm times,
 * https links on the right hosts, and a well-formed email and phone. The field
 * names are the ids the boxes carry, without the `event-` prefix, so the
 * summary can link to each one.
 *
 * @param {object} values Form values; any content field may be missing.
 * @returns {Array<{field: string, message: string}>} One entry per problem.
 */
export function contentProblems(values) {
  const problems = []
  const add = (field, message) => problems.push({ field, message })

  /**
   * Check one box's length.
   *
   * @param {string} field The field id.
   * @param {string} value The box.
   * @param {number} max The limit.
   * @param {string} label How it is named in the message.
   * @returns {void}
   */
  const long = (field, value, max, label) => {
    const text = String(value ?? '').trim()

    if (text.length > max) {
      add(
        field,
        `Keep ${label} to ${max.toLocaleString('en-US')} characters (it is ${text.length.toLocaleString('en-US')}).`,
      )
    }
  }

  const performers = usedRows(values.performers)

  if (performers.length > CONTENT_LIMITS.performers) {
    add('performers', `List at most ${CONTENT_LIMITS.performers} performers.`)
  }

  for (const { row, index } of performers) {
    const n = index + 1

    if (!row.name.trim()) add(`performers-${index}-name`, `Give performer ${n} a name.`)
    long(
      `performers-${index}-name`,
      row.name,
      CONTENT_LIMITS.performerName,
      `performer ${n}'s name`,
    )
    long(
      `performers-${index}-role`,
      row.role,
      CONTENT_LIMITS.performerRole,
      `performer ${n}'s role`,
    )
    long(`performers-${index}-bio`, row.bio, CONTENT_LIMITS.performerBio, `performer ${n}'s bio`)
  }

  const slots = usedRows(values.runningOrder)

  if (slots.length > CONTENT_LIMITS.runningOrderItems) {
    add('runningOrder', `List at most ${CONTENT_LIMITS.runningOrderItems} running-order slots.`)
  }

  for (const { row, index } of slots) {
    const n = index + 1

    if (!RUNNING_ORDER_TIME.test(row.time.trim())) {
      add(`runningOrder-${index}-time`, `Give slot ${n} a time, such as 19:30.`)
    }
    if (!row.title.trim()) add(`runningOrder-${index}-title`, `Say what happens in slot ${n}.`)
    long(
      `runningOrder-${index}-title`,
      row.title,
      CONTENT_LIMITS.runningOrderTitle,
      `slot ${n}'s title`,
    )
    long(
      `runningOrder-${index}-note`,
      row.note,
      CONTENT_LIMITS.runningOrderNote,
      `slot ${n}'s note`,
    )
  }

  const questions = usedRows(values.faq)

  if (questions.length > CONTENT_LIMITS.faqItems) {
    add('faq', `List at most ${CONTENT_LIMITS.faqItems} questions.`)
  }

  for (const { row, index } of questions) {
    const n = index + 1

    if (!row.question.trim()) add(`faq-${index}-question`, `Write question ${n}.`)
    if (!row.answer.trim()) add(`faq-${index}-answer`, `Answer question ${n}.`)
    long(`faq-${index}-question`, row.question, CONTENT_LIMITS.faqQuestion, `question ${n}`)
    long(`faq-${index}-answer`, row.answer, CONTENT_LIMITS.faqAnswer, `answer ${n}`)
  }

  const sponsors = usedRows(values.sponsors)

  if (sponsors.length > CONTENT_LIMITS.sponsors) {
    add('sponsors', `List at most ${CONTENT_LIMITS.sponsors} sponsors.`)
  }

  for (const { row, index } of sponsors) {
    const n = index + 1
    const url = row.url.trim()

    if (!row.name.trim()) add(`sponsors-${index}-name`, `Give sponsor ${n} a name.`)
    long(`sponsors-${index}-name`, row.name, CONTENT_LIMITS.sponsorName, `sponsor ${n}'s name`)
    long(`sponsors-${index}-level`, row.level, CONTENT_LIMITS.sponsorLevel, `sponsor ${n}'s level`)

    if (url && (!isHttpsAddress(url) || url.length > CONTENT_LIMITS.url)) {
      add(`sponsors-${index}-url`, `Use a full https:// address for sponsor ${n}'s website.`)
    }
  }

  for (const network of SOCIAL_NETWORKS) {
    const problem = socialLinkProblem(network, values.socialLinks?.[network])

    if (problem) add(`social-${network}`, `${SOCIAL_NETWORK_LABELS[network]}: ${problem}`)
  }

  long('dressCode', values.dressCode, CONTENT_LIMITS.dressCode, 'the dress code')
  long('directions', values.directions, CONTENT_LIMITS.directions, 'the parking and directions')

  const email = String(values.publicEmail ?? '').trim()

  if (email && (!EMAIL.test(email) || email.length > 254)) {
    add('publicEmail', 'Use an email address such as hello@example.com.')
  }

  const phone = String(values.publicPhone ?? '').trim()

  if (phone && (!PHONE.test(phone) || phone.length < 6 || phone.length > 24)) {
    add(
      'publicPhone',
      'Use a phone number of digits, spaces, brackets and dashes, such as +1 212 555 0100.',
    )
  }

  return problems
}

/**
 * A used row's boxes, trimmed, with blank optional ones as null.
 *
 * @param {object} row The row.
 * @param {string[]} required The fields that stay strings.
 * @returns {object} The row as the API takes it.
 */
function toRow(row, required) {
  return Object.fromEntries(
    Object.entries(row).map(([field, value]) => {
      const text = String(value ?? '').trim()

      return [field, required.includes(field) ? text : text || null]
    }),
  )
}

/**
 * The content as the API's update body.
 *
 * Rows whose every box is empty are dropped. An emptied list is sent as `[]`
 * and emptied links as `{}`, because the columns cannot hold null.
 *
 * @param {object} values Form values that passed {@link contentProblems}.
 * @returns {object} The content part of an update body.
 */
export function toContentPatch(values) {
  const rows = (list, required) => usedRows(list).map(({ row }) => toRow(row, required))
  const links = {}

  for (const network of SOCIAL_NETWORKS) {
    const href = String(values.socialLinks?.[network] ?? '').trim()

    if (href) links[network] = href
  }

  return {
    performers: rows(values.performers, ['name']),
    runningOrder: rows(values.runningOrder, ['time', 'title']),
    faq: rows(values.faq, ['question', 'answer']),
    sponsors: rows(values.sponsors, ['name']),
    socialLinks: links,
    dressCode: String(values.dressCode ?? '').trim() || null,
    directions: String(values.directions ?? '').trim() || null,
    publicEmail: String(values.publicEmail ?? '').trim() || null,
    publicPhone: String(values.publicPhone ?? '').trim() || null,
  }
}
