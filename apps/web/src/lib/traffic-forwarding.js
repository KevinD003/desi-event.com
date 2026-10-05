/**
 * What the web tier tells the API about a visitor, and nothing more.
 *
 * Server-only: the API proxy and the website-link route import it; no client
 * component may (it reads `node:net` and the server's environment).
 *
 * Every browser request reaches the API through this server, so the API sees
 * this server's address, not the visitor's. For counting visits — and only for
 * that — this module works out the visitor's address from `X-Forwarded-For`
 * and hands it on as `x-desi-client-address`, with the browser's user agent and
 * its privacy signals. The API believes that header only from the addresses in
 * its `TRAFFIC_TRUSTED_FORWARDERS`, makes a one-day code from it, and keeps
 * neither the address nor the agent.
 *
 * ## Which entry of X-Forwarded-For
 *
 * `TRAFFIC_TRUSTED_PROXY_HOPS` is the number of proxies in front of this server
 * that append to the header (0 to 5, default 0). The visitor is the entry that
 * many from the end; with 0 it is the last one, which is the connection Next
 * saw — or, when the client sent the header itself, whatever the client said.
 * So with no proxy configured a visitor can choose their address and appear as
 * many visitors; the API's dedupe and ceilings bound that, the copy calls the
 * figures a guide, and a production server running with 0 says so once in its
 * log. It keeps running: an analytics setting is no reason to take a site down.
 *
 * @module lib/traffic-forwarding
 */

import { isIP } from 'node:net'

/** The header the API reads the visitor's address from. */
export const CLIENT_ADDRESS_HEADER = 'x-desi-client-address'

/**
 * The longest user agent a browser can have; the API treats a longer one as a
 * robot's and counts nothing for it. A longer agent is therefore forwarded cut
 * to one character past this, so it stays bounded and the API still sees it
 * as too long. Cutting it to exactly this would turn a robot into a visitor.
 */
export const MAX_FORWARDED_USER_AGENT = 512

/** The most proxies the setting may name. */
export const MAX_TRUSTED_PROXY_HOPS = 5

/** What a production server with no proxy setting says, once. */
export const HOPS_ZERO_IN_PRODUCTION_WARNING =
  'Visitor addresses are taken from the connection; set TRAFFIC_TRUSTED_PROXY_HOPS behind a proxy.'

/** What a server with an unusable setting says, once. */
export const INVALID_HOPS_WARNING =
  'TRAFFIC_TRUSTED_PROXY_HOPS must be a whole number from 0 to 5; visitor addresses are taken from the connection.'

const warned = { invalid: false, productionZero: false }

/**
 * Forget the warnings already given. Tests only.
 *
 * @returns {void}
 */
export function resetForwardingWarnings() {
  warned.invalid = false
  warned.productionZero = false
}

/**
 * How many proxies in front of this server append to `X-Forwarded-For`.
 *
 * @param {Record<string, string|undefined>} [env] The environment.
 * @param {{warn?: function(string): void}} [options] Where a warning goes.
 * @returns {number} 0 to 5.
 */
export function trustedProxyHops(env = process.env, { warn = console.warn } = {}) {
  const raw = env.TRAFFIC_TRUSTED_PROXY_HOPS
  let hops = 0

  if (raw !== undefined && String(raw).trim() !== '') {
    const parsed = Number(String(raw).trim())

    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= MAX_TRUSTED_PROXY_HOPS) {
      hops = parsed
    } else if (!warned.invalid) {
      warned.invalid = true
      warn(`[desi-event/web] ${INVALID_HOPS_WARNING}`)
    }
  }

  if (hops === 0 && env.NODE_ENV === 'production' && !warned.productionZero) {
    warned.productionZero = true
    warn(`[desi-event/web] ${HOPS_ZERO_IN_PRODUCTION_WARNING}`)
  }

  return hops
}

/**
 * One header's value from a `Headers` object or a plain one.
 *
 * @param {Headers|Record<string, string>} headers The headers.
 * @param {string} name A lower-case name.
 * @returns {string|null} The value.
 */
function headerOf(headers, name) {
  if (typeof headers?.get === 'function') return headers.get(name)

  const value = headers?.[name]

  return typeof value === 'string' ? value : null
}

/**
 * The visitor's address, as far as this server can tell.
 *
 * @param {Headers|Record<string, string>} headers The incoming request's headers.
 * @param {{hops?: number}} [options] Proxies in front of this server.
 * @returns {string|null} An IP literal, or null when none can be read.
 */
export function clientAddressFrom(headers, { hops = trustedProxyHops() } = {}) {
  const forwarded = headerOf(headers, 'x-forwarded-for')

  if (!forwarded) return null

  const list = forwarded
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
  const candidate = list[list.length - Math.max(1, hops)]

  if (!candidate) return null

  // An IPv6 zone (`fe80::1%eth0`) names an interface on the machine that saw
  // it, which is no part of who the visitor is.
  const address = candidate.replace(/%[^%]*$/u, '')

  return isIP(address) === 0 ? null : address.toLowerCase()
}

/**
 * The headers a visit is forwarded to the API with.
 *
 * Only these: the user agent (an overlong one cut to one character past the
 * maximum, so the API still refuses it), the visitor's address when one can be
 * read, and the two privacy signals when the browser sent them. No
 * cookie, no authorization, no referer.
 *
 * @param {Request|{headers: Headers|Record<string, string>}} request The incoming request.
 * @param {{env?: Record<string, string|undefined>, warn?: function(string): void}} [options] The environment, and where a warning goes.
 * @returns {Record<string, string>} Header names and values.
 */
export function trafficForwardHeaders(request, { env = process.env, warn } = {}) {
  const headers = request?.headers ?? {}
  const forward = {}
  const agent = headerOf(headers, 'user-agent')
  const address = clientAddressFrom(headers, { hops: trustedProxyHops(env, { warn }) })

  if (agent) forward['user-agent'] = agent.slice(0, MAX_FORWARDED_USER_AGENT + 1)
  if (address) forward[CLIENT_ADDRESS_HEADER] = address
  if (headerOf(headers, 'sec-gpc')?.trim() === '1') forward['sec-gpc'] = '1'
  if (headerOf(headers, 'dnt')?.trim() === '1') forward.dnt = '1'

  return forward
}
