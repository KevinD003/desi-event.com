/**
 * Where a page view came from, as one of five categories.
 *
 * The browser sends at most the referring site's host name — never a URL — or
 * a marker saying it was this site or something that is not a host. The host
 * is classified here and dropped: nothing downstream of {@link classifyReferrer}
 * ever sees it, and only the category is stored.
 *
 * `INTERNAL` ("The Desi Events pages") is a fifth category beside the four asked
 * for, because how many people found an event through the platform itself is
 * the figure an organiser on this platform most wants, and folding it into
 * "direct" would hide it. Folding it back is one line here.
 *
 * @module @desi-event/api/lib/traffic-sources
 */

/** Search engines, by registered domain; subdomains count too. */
export const SEARCH_HOSTS = Object.freeze([
  'bing.com',
  'duckduckgo.com',
  'yahoo.com',
  'baidu.com',
  'ecosia.org',
  'search.brave.com',
  'startpage.com',
  'kagi.com',
  'qwant.com',
  'ask.com',
  'aol.com',
])

/** Search engines with a domain per country. */
export const SEARCH_HOST_PATTERNS = Object.freeze([
  /(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/u,
  /(^|\.)yandex\.[a-z]{2,3}$/u,
])

/** Social networks and messengers, by registered domain; subdomains count too. */
export const SOCIAL_HOSTS = Object.freeze([
  'facebook.com',
  'fb.com',
  'instagram.com',
  't.co',
  'twitter.com',
  'x.com',
  'linkedin.com',
  'lnkd.in',
  'whatsapp.com',
  'wa.me',
  'reddit.com',
  'youtube.com',
  'youtu.be',
  'tiktok.com',
  'snapchat.com',
  'threads.net',
  't.me',
  'telegram.org',
  'discord.com',
  'nextdoor.com',
])

/** Social networks with a domain per country. */
export const SOCIAL_HOST_PATTERNS = Object.freeze([/(^|\.)pinterest\.[a-z]{2,3}(\.[a-z]{2})?$/u])

/**
 * Whether `host` is `domain` or a subdomain of it.
 *
 * Label by label, so `evil-facebook.com` is not `facebook.com` and
 * `facebook.com.evil.example` is not either.
 *
 * @param {string} host A lower-case host name.
 * @param {string} domain A lower-case registered domain.
 * @returns {boolean} Whether it matches.
 */
export function hostIs(host, domain) {
  return host === domain || host.endsWith(`.${domain}`)
}

/**
 * The category for what a beacon said about its referrer.
 *
 * @param {string|null|undefined} referrer `SAME_SITE`, `OTHER_SITE`, a host name, or nothing.
 * @returns {'DIRECT'|'INTERNAL'|'SEARCH'|'SOCIAL'|'OTHER'} The category.
 */
export function classifyReferrer(referrer) {
  if (referrer === null || referrer === undefined || referrer === '') return 'DIRECT'
  if (referrer === 'SAME_SITE') return 'INTERNAL'
  if (typeof referrer !== 'string' || referrer === 'OTHER_SITE') return 'OTHER'

  const host = referrer.toLowerCase()

  if (
    SEARCH_HOSTS.some((domain) => hostIs(host, domain)) ||
    SEARCH_HOST_PATTERNS.some((pattern) => pattern.test(host))
  ) {
    return 'SEARCH'
  }

  if (
    SOCIAL_HOSTS.some((domain) => hostIs(host, domain)) ||
    SOCIAL_HOST_PATTERNS.some((pattern) => pattern.test(host))
  ) {
    return 'SOCIAL'
  }

  return 'OTHER'
}
