/**
 * An event's website address, and the switch only the team at The Desi Events turns.
 *
 * One rule for what may be an event's website, {@link websiteUrlProblem}, used
 * by the API when an organiser saves an address and again when an administrator
 * turns the link on, by the redirect before it sends anybody anywhere, and by
 * the browser (through a mirror held equal by a parity test) before a form is
 * sent. The address is stored as `new URL(...).href`, so the stored, displayed
 * and redirected forms are byte-identical; the database's CHECK
 * `event_website_url_shape` is the floor under it.
 *
 * Imports only zod and `./primitives.js`, never the barrel, so a server
 * component or a web test can import `@desi-event/schemas/website` cheaply.
 *
 * @module @desi-event/schemas/website
 */

import { z } from 'zod'

import { timestampSchema } from './primitives.js'

/** Lengths the address, its host, the reason and the list search are held to. */
export const WEBSITE_LIMITS = Object.freeze({
  url: 2048,
  host: 253,
  label: 63,
  reasonMin: 3,
  reason: 500,
  searchMin: 2,
  search: 100,
})

/** The Desi Events itself. A "visit the organiser's website" link here is a loop or an impersonation. */
export const PLATFORM_HOSTS = Object.freeze(['thedesievents.com'])

/**
 * The site the imported listings came from, under any of its domains and any
 * name beneath them (`events.…`, `usimg.…`, `www.…`): the owner asked, on
 * 2026-10-15, that nothing on The Desi Events links, redirects or connects
 * there. A regular expression rather than a list of names, so that no string
 * in the code spells the site.
 *
 * @type {RegExp}
 */
export const RETIRED_SOURCE_HOST = /(?:^|\.)sulekha\.[a-z]{2,63}(?:\.[a-z]{2,63})?$/iu

/**
 * What {@link websiteUrlProblem} says about an address on
 * {@link RETIRED_SOURCE_HOST}. Kept apart from `WEBSITE_PROBLEMS`, which the
 * browser's mirror repeats word for word.
 */
export const RETIRED_SOURCE_PROBLEM =
  'The Desi Events does not link to that site. Use the organiser’s own website.'

/**
 * Whether a host is on the site the imported listings came from.
 *
 * @param {unknown} host A host name.
 * @returns {boolean} True for the retired source's domains.
 */
export function isRetiredSourceHost(host) {
  return typeof host === 'string' && RETIRED_SOURCE_HOST.test(host.replace(/\.$/u, ''))
}

/** Names that resolve only on somebody's own network, or nowhere. */
export const PRIVATE_HOST_SUFFIXES = Object.freeze([
  'localhost',
  'local',
  'internal',
  'intranet',
  'lan',
  'home',
  'corp',
  'invalid',
  'onion',
  'arpa',
])

/** Query or fragment parameter names that carry a sign-in, a key or a code. Compared lower-cased. */
export const CREDENTIAL_PARAMETERS = Object.freeze([
  'access_token',
  'api_key',
  'apikey',
  'auth',
  'authorization',
  'client_secret',
  'code',
  'id_token',
  'key',
  'otp',
  'pass',
  'passwd',
  'password',
  'pwd',
  'refresh_token',
  'secret',
  'session',
  'sessionid',
  'sid',
  'sig',
  'signature',
  'token',
])

/** What {@link websiteUrlProblem} says, word for word. The web mirror says the same. */
export const WEBSITE_PROBLEMS = Object.freeze({
  blank: 'Give the full address of your website, starting https://.',
  tooLong: 'Keep the address to 2,048 characters.',
  whitespace: 'An address has no spaces or line breaks in it.',
  unparseable: 'Use a full address that starts https://, such as https://www.example.com/.',
  protocol: 'Use an address that starts https://. Other kinds of link are not accepted.',
  signIn:
    'Take the name and password out of the address. A link for the public never carries a sign-in.',
  port: 'Use the site’s usual address, without a port number.',
  numeric: 'Use the site’s name, such as www.example.com, rather than a numeric address.',
  name: 'Use the site’s full name, such as www.example.com.',
  privateNetwork: 'That name only works on a private network. Use your website’s public address.',
  platform: 'That address is on The Desi Events itself. Use your own website’s address.',
})

/**
 * The sentence for an address that carries a credential parameter.
 *
 * @param {string} name The parameter as it was written.
 * @returns {string} The problem.
 */
export function credentialParameterProblem(name) {
  return `Take “${name}” out of the address. A public link never carries a password, key or code.`
}

/** Whitespace and control characters, anywhere in an address. */
const WHITESPACE_OR_CONTROL = /[\s\p{Cc}]/u

/** A dotted-quad host, as the URL parser leaves every IPv4 spelling. */
const IPV4_HOST = /^\d{1,3}(?:\.\d{1,3}){3}$/

/** One label of a host name. */
const HOST_LABEL = /^[a-z0-9-]{1,63}$/

/** The last label: letters, or an internationalised name in punycode. */
const TOP_LEVEL_LABEL = /^(?:[a-z]{2,63}|xn--[a-z0-9-]+)$/

/**
 * The parameter names in a query or a fragment written like one.
 *
 * @param {string} text `search` or `hash`, with its leading `?` or `#`.
 * @returns {string[]} The names, as written.
 */
function parameterNames(text) {
  if (!text || text.length < 2) return []

  return [...new URLSearchParams(text.slice(1)).keys()]
}

/**
 * Why a value may not be an event's website, or null when it may.
 *
 * The checks run in a fixed order and the first that fails is reported: blank,
 * too long, whitespace, does not parse, not https, a sign-in, a port, a numeric
 * address, not a dotted public name, a private network's name, The Desi Events' own
 * domain, and a parameter named like a credential. Blank is a problem here;
 * clearing the field is the caller's business (see {@link websiteUrlSchema}).
 *
 * @param {unknown} value The address as typed, already trimmed by the caller.
 * @returns {string|null} The problem in words, or null.
 */
export function websiteUrlProblem(value) {
  if (typeof value !== 'string' || value.trim() === '') return WEBSITE_PROBLEMS.blank
  if (value.length > WEBSITE_LIMITS.url) return WEBSITE_PROBLEMS.tooLong
  if (WHITESPACE_OR_CONTROL.test(value)) return WEBSITE_PROBLEMS.whitespace

  let url

  try {
    url = new URL(value)
  } catch {
    return WEBSITE_PROBLEMS.unparseable
  }

  if (url.protocol !== 'https:') return WEBSITE_PROBLEMS.protocol
  // `https:evil` parses (as https://evil/); an address somebody can read has
  // the two slashes.
  if (!/^https:\/\//iu.test(value)) return WEBSITE_PROBLEMS.unparseable
  if (url.username !== '' || url.password !== '') return WEBSITE_PROBLEMS.signIn
  if (url.port !== '') return WEBSITE_PROBLEMS.port

  const host = url.hostname

  if (host.startsWith('[') || IPV4_HOST.test(host)) return WEBSITE_PROBLEMS.numeric

  const labels = host.split('.')

  if (
    host.length > WEBSITE_LIMITS.host ||
    labels.length < 2 ||
    !labels.every((label) => HOST_LABEL.test(label)) ||
    !TOP_LEVEL_LABEL.test(labels.at(-1))
  ) {
    return WEBSITE_PROBLEMS.name
  }

  if (PRIVATE_HOST_SUFFIXES.includes(labels.at(-1))) return WEBSITE_PROBLEMS.privateNetwork

  if (PLATFORM_HOSTS.some((platform) => host === platform || host.endsWith(`.${platform}`))) {
    return WEBSITE_PROBLEMS.platform
  }

  if (isRetiredSourceHost(host)) return RETIRED_SOURCE_PROBLEM

  for (const name of [...parameterNames(url.search), ...parameterNames(url.hash)]) {
    if (CREDENTIAL_PARAMETERS.includes(name.toLowerCase())) return credentialParameterProblem(name)
  }

  // Percent-encoding can lengthen what was typed; the stored form is the one
  // held to the limit.
  if (url.href.length > WEBSITE_LIMITS.url) return WEBSITE_PROBLEMS.tooLong

  return null
}

/**
 * The stored form of an address: `new URL(value.trim()).href`.
 *
 * Lower-cases the host, turns an internationalised name into punycode, drops
 * `:443` and always puts `/` after the host.
 *
 * @param {unknown} value An address.
 * @returns {string|null} The stored form, or null when it does not parse.
 */
export function normaliseWebsiteUrl(value) {
  if (typeof value !== 'string') return null

  try {
    return new URL(value.trim()).href
  } catch {
    return null
  }
}

/**
 * The host a person is shown for an address: its name without a leading `www.`.
 *
 * @param {unknown} value An address.
 * @returns {string|null} The host, or null when it does not parse.
 */
export function websiteHost(value) {
  if (typeof value !== 'string') return null

  try {
    return new URL(value.trim()).hostname.replace(/^www\./u, '')
  } catch {
    return null
  }
}

/**
 * The organiser's website field.
 *
 * Blank clears it (null). Anything else must pass {@link websiteUrlProblem} and
 * leaves as its stored form. Normalised in `preprocess`, as every schema in
 * this package is, so the rendered JSON Schema stays a plain string.
 */
export const websiteUrlSchema = z.preprocess(
  (value) => {
    if (typeof value !== 'string') return value

    const text = value.trim()

    if (text === '') return null

    return websiteUrlProblem(text) === null ? normaliseWebsiteUrl(text) : text
  },
  z
    .string()
    .max(WEBSITE_LIMITS.url, WEBSITE_PROBLEMS.tooLong)
    .nullable()
    .superRefine((value, ctx) => {
      if (value === null || value.length > WEBSITE_LIMITS.url) return

      const problem = websiteUrlProblem(value)

      if (problem) ctx.addIssue({ code: 'custom', message: problem })
    }),
)

/**
 * A control character a reason may not carry. Line breaks and tabs are allowed.
 *
 * @type {RegExp}
 */
const REASON_CONTROL = /(?![\t\n\r])\p{Cc}/u

/**
 * An administrator's decision about an event's website link.
 *
 * `websiteUrl` is the address on the administrator's screen, required in both
 * directions: turning the link on is a compare-and-set on it, so an address the
 * organiser changed since cannot be turned on unseen, and turning it off records
 * which address the decision was about. Null means the screen showed no
 * address. Whether it may be turned on (an address that passes today's rules)
 * is the handler's answer, a 422, not a malformed request.
 */
export const websiteRedirectDecisionSchema = z
  .object({
    enabled: z.boolean(),
    reason: z.preprocess(
      (value) => (typeof value === 'string' ? value.trim() : value),
      z
        .string()
        .min(WEBSITE_LIMITS.reasonMin, 'Give a reason of at least 3 characters.')
        .max(WEBSITE_LIMITS.reason, 'Keep the reason to 500 characters.')
        .refine(
          (value) => !REASON_CONTROL.test(value),
          'Take the control characters out of the reason.',
        ),
    ),
    websiteUrl: z
      .string({ error: 'Send the address you looked at, or null when there was none.' })
      .min(1)
      .max(WEBSITE_LIMITS.url)
      .nullable(),
  })
  .strict()

/**
 * The switch as an insider reads it: the event's own team and the team at
 * The Desi Events. Never part of a public payload.
 */
export const websiteRedirectStateSchema = z
  .object({
    enabled: z.boolean(),
    /** An address differs from the decided one and waits for an administrator. */
    pending: z.boolean(),
    /** Where the link goes while it is on: the address the last decision was about. */
    decidedUrl: z.string().max(WEBSITE_LIMITS.url).nullable(),
    /** When the decision started waiting. */
    submittedAt: timestampSchema.nullable(),
    /** When an administrator last decided. */
    changedAt: timestampSchema.nullable(),
    reason: z.string().max(WEBSITE_LIMITS.reason).nullable(),
    /** The administrator's display name, or "An administrator at The Desi Events" once the account is gone. */
    changedByName: z.string().max(200).nullable(),
    /** Set when the stored address no longer passes {@link websiteUrlProblem} (a legacy row). */
    websiteProblem: z.string().max(300).nullable(),
  })
  .strict()

/** What a stranger's page needs: where the link goes, as a host, never the address. */
export const publicWebsiteLinkSchema = z
  .object({
    host: z.string().min(1).max(WEBSITE_LIMITS.host),
  })
  .strict()
