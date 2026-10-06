/**
 * Copying an imported listing's pictures: the API's one outbound fetcher
 * (SPEC2-XI §5.I-D).
 *
 * An import file is uploaded by a person, and every picture address in it is a
 * request this server will make. So nothing here trusts the address: it must be
 * `https:` on the one allowed host, the name is resolved here and every address
 * it resolves to must be a public one, and the connection is pinned to the
 * address that was checked, so a second resolution (DNS rebinding) cannot send
 * it somewhere else. A redirect is a new request through every one of those
 * rules again. Bodies are capped at the upload limit, the whole fetch at ten
 * seconds, and what arrives must be a JPEG, PNG or WebP by its first bytes and
 * pass the upload sanitiser before anything stores it.
 *
 * Three details make the pin real on Node 22:
 *
 * - **The lookup honours `options.all`.** Node enables `autoSelectFamily` by
 *   default and then calls the lookup with `all: true`, expecting an array;
 *   the pinned lookup answers with the one checked address either way.
 * - **Its own agent.** Every request uses a fresh `https.Agent` without
 *   keep-alive, never `https.globalAgent`, so no proxy setting (`HTTPS_PROXY`,
 *   `NODE_USE_ENV_PROXY`) can route it through a host that would connect to an
 *   address this code never checked. The importer therefore needs direct
 *   outbound access to `usimg.sulekha.io:443`.
 * - **Certificate checks stay on.** No `rejectUnauthorized: false` and no
 *   custom `checkServerIdentity`; `servername` is the host, so the certificate
 *   must match it.
 *
 * Only the host and a failure code are ever logged. The address itself is kept
 * only on `EventImportImage`, which administrators read.
 *
 * With `IMPORT_IMAGE_SOURCE=fixtures` (tests and the browser suites) the URL
 * rules still apply, and the picture is read from a directory by the address's
 * file name, with no network at all. That mode is refused in production.
 *
 * No other module under `apps/api/src` imports an HTTP client or opens a
 * socket (SPEC2-XI §0 rule 6).
 */

import { lookup as dnsLookup } from 'node:dns'
import { realpath, readFile, stat } from 'node:fs/promises'
import https from 'node:https'
import { BlockList, isIP } from 'node:net'
import path from 'node:path'

import { MEDIA_CONTENT_TYPES, MEDIA_LIMITS, sniffImageType } from '@desi-event/schemas/media'

import { MediaRefusal } from './media/refusal.js'
import { sanitiseImage } from './media/sanitise.js'

/** The only host pictures are copied from. It is the only picture host in the Sulekha data. */
export const IMPORT_IMAGE_HOSTS = Object.freeze(['usimg.sulekha.io'])

/** Where pictures come from: the network, or a directory of fixtures (never in production). */
export const IMPORT_IMAGE_SOURCES = Object.freeze(['network', 'fixtures'])

/** The whole fetch, redirects and name resolution included, in milliseconds. */
export const IMPORT_IMAGE_TIMEOUT_MS = 10_000

/** Redirects followed at most, each to an allowed host. */
export const IMPORT_IMAGE_MAX_REDIRECTS = 2

/** The longest picture address accepted. */
export const IMPORT_IMAGE_URL_MAX = 2048

/** The headers every request sends, and nothing else: no cookie, no credential. */
export const IMPORT_IMAGE_REQUEST_HEADERS = Object.freeze({
  accept: 'image/jpeg, image/png, image/webp',
  'accept-encoding': 'identity',
  'user-agent': 'Desi-Event importer',
})

/**
 * Why a picture was not copied. `HTTP_<status>` and `SANITISER_REFUSED:<code>`
 * carry the status or the sanitiser's refusal code after the prefix.
 */
export const IMPORT_IMAGE_FAILURES = Object.freeze([
  'HOST_NOT_ALLOWED',
  'ADDRESS_NOT_PUBLIC',
  'NETWORK_UNAVAILABLE',
  'TIMEOUT',
  'REDIRECT_OFF_LIST',
  'TOO_MANY_REDIRECTS',
  'NOT_AN_IMAGE',
  'TOO_LARGE',
  'HTTP_',
  'SANITISER_REFUSED:',
])

/** The note a cover picture gets when it is stored in the gallery because it is too small. */
export const TOO_SMALL_FOR_COVER_NOTE = 'Too small for a cover'

/** Redirect statuses that are followed (within the list). */
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

/** A fixture's file name: the last segment of the address, as written. */
const FIXTURE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/u

/** Whitespace and control characters, anywhere in an address. */
const WHITESPACE_OR_CONTROL = /[\s\p{Cc}]/u

/**
 * IPv4 ranges that are not the public internet: this network, private,
 * shared (carrier-grade NAT), loopback, link-local, IETF protocol
 * assignments, the three documentation networks, the deprecated 6to4 relay,
 * benchmarking, multicast and reserved (with broadcast).
 */
export const REFUSED_IPV4_RANGES = Object.freeze([
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
])

/**
 * IPv6 ranges refused even though most lie outside global unicast anyway:
 * unspecified, loopback, IPv4-compatible, IPv4-mapped, NAT64 (well-known and
 * local), discard, Teredo, documentation, 6to4 (which embeds an IPv4
 * address), unique local, link-local and multicast.
 */
export const REFUSED_IPV6_RANGES = Object.freeze([
  ['::', 128],
  ['::1', 128],
  ['::', 96],
  ['::ffff:0:0', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 32],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
])

/**
 * A block list for one family. The families are kept apart on purpose: Node's
 * `BlockList` matches an IPv4 address against an IPv4-mapped IPv6 rule, so one
 * shared list holding `::ffff:0:0/96` would refuse every IPv4 address.
 *
 * @param {ReadonlyArray<Array<string|number>>} ranges Network and prefix length.
 * @param {'ipv4'|'ipv6'} family The family of every range.
 * @returns {BlockList} The list.
 */
function blockListOf(ranges, family) {
  const list = new BlockList()

  for (const [network, prefix] of ranges) list.addSubnet(network, prefix, family)

  return list
}

const REFUSED_IPV4 = blockListOf(REFUSED_IPV4_RANGES, 'ipv4')
const REFUSED_IPV6 = blockListOf(REFUSED_IPV6_RANGES, 'ipv6')

/** IPv6 global unicast, `2000::/3`: everything outside it is refused. */
const GLOBAL_UNICAST_IPV6 = blockListOf([['2000::', 3]], 'ipv6')

/**
 * Whether an address is on the public internet, so a request to it cannot
 * reach this server, its network or its cloud's metadata service.
 *
 * @param {unknown} address An IP address as a resolver returns it.
 * @returns {boolean} True only for a public unicast address.
 */
export function isPublicAddress(address) {
  // A zone index (`fe80::1%eth0`) names an interface on this machine.
  if (typeof address !== 'string' || address.includes('%')) return false

  const family = isIP(address)

  if (family === 4) return !REFUSED_IPV4.check(address, 'ipv4')

  if (family === 6) {
    return GLOBAL_UNICAST_IPV6.check(address, 'ipv6') && !REFUSED_IPV6.check(address, 'ipv6')
  }

  return false
}

/**
 * Check a picture address against the URL rules: `https:` only, no user
 * information, port empty or 443, the host lower-cased with no trailing dot,
 * not an IP literal, exactly one of {@link IMPORT_IMAGE_HOSTS}, and at most
 * {@link IMPORT_IMAGE_URL_MAX} characters.
 *
 * @param {unknown} value The address as the dataset or a `Location` gives it.
 * @returns {{ok: true, url: URL} | {ok: false, code: 'HOST_NOT_ALLOWED'}} The parsed address, or the refusal.
 */
export function checkImportImageUrl(value) {
  const refused = { ok: false, code: 'HOST_NOT_ALLOWED' }

  if (typeof value !== 'string' || value.length === 0 || value.length > IMPORT_IMAGE_URL_MAX) {
    return refused
  }
  if (WHITESPACE_OR_CONTROL.test(value)) return refused
  // `https:host/x` parses as https://host/x; an address on the list is written in full.
  if (!/^https:\/\//iu.test(value)) return refused

  let url

  try {
    url = new URL(value)
  } catch {
    return refused
  }

  const host = url.hostname

  if (url.protocol !== 'https:') return refused
  if (url.username !== '' || url.password !== '') return refused
  // The parser leaves the port empty for the default 443.
  if (url.port !== '') return refused
  if (host.endsWith('.') || host.startsWith('[') || isIP(host) !== 0) return refused
  if (host !== host.toLowerCase() || !IMPORT_IMAGE_HOSTS.includes(host)) return refused
  if (url.href.length > IMPORT_IMAGE_URL_MAX) return refused

  return { ok: true, url }
}

/**
 * The host of an address, for a log line, or null.
 *
 * @param {unknown} value An address.
 * @returns {string|null} Its host name.
 */
function hostOf(value) {
  if (typeof value !== 'string') return null

  try {
    return new URL(value).hostname.slice(0, 253) || null
  } catch {
    return null
  }
}

/**
 * A `lookup` for `https.request` that answers only with the address already
 * checked, whatever name it is asked about.
 *
 * @param {string} address The checked address.
 * @param {4|6} family Its family.
 * @returns {Function} The lookup, `(hostname, options, callback)`.
 */
export function pinnedLookup(address, family) {
  return (_hostname, options, callback) => {
    const done = typeof options === 'function' ? options : callback
    const all = typeof options === 'object' && options !== null && options.all === true

    if (all) done(null, [{ address, family }])
    else done(null, address, family)
  }
}

/**
 * Resolve a name with the resolver given, callback- or promise-style.
 *
 * @param {Function} resolve `dns.lookup`, or a stand-in with its signature.
 * @param {string} host The name.
 * @returns {Promise<unknown>} What the resolver answered.
 */
function lookupAll(resolve, host) {
  return new Promise((settle, reject) => {
    const maybe = resolve(host, { all: true }, (error, addresses) => {
      if (error) reject(error)
      else settle(addresses)
    })

    if (maybe && typeof maybe.then === 'function') maybe.then(settle, reject)
  })
}

/**
 * Wait for a promise, or for the deadline, whichever comes first.
 *
 * @param {Promise<unknown>} promise What to wait for.
 * @param {number} deadline Epoch milliseconds.
 * @returns {Promise<{timedOut: boolean, value?: unknown, error?: unknown}>} The outcome.
 */
async function beforeDeadline(promise, deadline) {
  let timer

  const timeout = new Promise((settle) => {
    timer = setTimeout(() => settle({ timedOut: true }), Math.max(0, deadline - Date.now()))
  })

  try {
    return await Promise.race([
      promise.then(
        (value) => ({ timedOut: false, value }),
        (error) => ({ timedOut: false, error }),
      ),
      timeout,
    ])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Resolve a host and check every address it has.
 *
 * @param {string} host The allowed host.
 * @param {Function} resolve The resolver.
 * @param {number} deadline Epoch milliseconds.
 * @returns {Promise<{ok: true, address: string, family: 4|6} | {ok: false, code: string}>} The address to connect to, or why not.
 */
async function resolvePublicAddress(host, resolve, deadline) {
  const outcome = await beforeDeadline(lookupAll(resolve, host), deadline)

  if (outcome.timedOut) return { ok: false, code: 'TIMEOUT' }
  if (outcome.error !== undefined) return { ok: false, code: 'NETWORK_UNAVAILABLE' }

  const answers = Array.isArray(outcome.value) ? outcome.value : [outcome.value]
  const addresses = answers
    .map((answer) => (typeof answer === 'string' ? answer : answer?.address))
    .filter((address) => address !== undefined && address !== null)

  if (addresses.length === 0) return { ok: false, code: 'NETWORK_UNAVAILABLE' }
  // Every address must pass, not only the first: a resolver that mixes a
  // public answer with a private one is not to be trusted with either.
  if (!addresses.every(isPublicAddress)) return { ok: false, code: 'ADDRESS_NOT_PUBLIC' }

  const [address] = addresses

  return { ok: true, address, family: /** @type {4|6} */ (isIP(address)) }
}

/**
 * The media type of a `Content-Type` header, lower-cased, without parameters.
 *
 * @param {unknown} header The header value.
 * @returns {string} The type, or an empty string.
 */
function mediaTypeOf(header) {
  return typeof header === 'string' ? header.split(';')[0].trim().toLowerCase() : ''
}

/**
 * The failure code for a socket or TLS error.
 *
 * @param {unknown} error What the request emitted.
 * @returns {string} `TIMEOUT` or `NETWORK_UNAVAILABLE`.
 */
function networkFailure(error) {
  const code = /** @type {{code?: unknown}} */ (error)?.code

  return code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT' ? 'TIMEOUT' : 'NETWORK_UNAVAILABLE'
}

/**
 * One request to one checked address, and what came back.
 *
 * @param {URL} url The checked address.
 * @param {{address: string, family: 4|6}} pinned The address to connect to.
 * @param {{request: Function, deadline: number}} options The request function and the deadline.
 * @returns {Promise<{ok: true, redirect: string} | {ok: true, bytes: Buffer, declaredType: string} | {ok: false, code: string}>} The outcome.
 */
function requestOnce(url, pinned, { request, deadline }) {
  return new Promise((settle) => {
    const agent = new https.Agent({ keepAlive: false })
    let finished = false
    let req = null
    let timer = null

    const finish = (result) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      settle(result)
      req?.destroy()
      agent.destroy()
    }

    const remaining = Math.max(1, deadline - Date.now())

    timer = setTimeout(() => finish({ ok: false, code: 'TIMEOUT' }), remaining)

    const onResponse = (response) => {
      const status = response.statusCode
      // Settle first, then drop the body. Destroying a real IncomingMessage
      // emits `aborted` and `close` before `destroy()` returns, and the
      // listeners below would settle that as a network failure instead.
      const stop = (result) => {
        finish(result)
        response.destroy()
      }

      if (REDIRECT_STATUSES.has(status)) {
        const location = response.headers?.location

        stop(
          typeof location === 'string' && location.length > 0
            ? { ok: true, redirect: location }
            : { ok: false, code: `HTTP_${status}` },
        )
        return
      }

      if (status !== 200) {
        stop({ ok: false, code: `HTTP_${status}` })
        return
      }

      const encoding = String(response.headers?.['content-encoding'] ?? '')
        .trim()
        .toLowerCase()
      const declaredType = mediaTypeOf(response.headers?.['content-type'])

      // Node does not decompress, so compressed bytes would reach the sanitiser as garbage.
      if (
        (encoding !== '' && encoding !== 'identity') ||
        !MEDIA_CONTENT_TYPES.includes(declaredType)
      ) {
        stop({ ok: false, code: 'NOT_AN_IMAGE' })
        return
      }

      const declaredLength = Number(response.headers?.['content-length'])

      if (Number.isFinite(declaredLength) && declaredLength > MEDIA_LIMITS.maxBytes) {
        stop({ ok: false, code: 'TOO_LARGE' })
        return
      }

      const chunks = []
      let size = 0

      response.on('data', (chunk) => {
        if (finished) return
        size += chunk.length
        if (size > MEDIA_LIMITS.maxBytes) {
          stop({ ok: false, code: 'TOO_LARGE' })
          return
        }
        chunks.push(chunk)
      })
      response.on('end', () => {
        if (response.complete === false) finish({ ok: false, code: 'NETWORK_UNAVAILABLE' })
        else finish({ ok: true, bytes: Buffer.concat(chunks, size), declaredType })
      })
      response.on('error', () => finish({ ok: false, code: 'NETWORK_UNAVAILABLE' }))
      response.on('aborted', () => finish({ ok: false, code: 'NETWORK_UNAVAILABLE' }))
      response.on('close', () => finish({ ok: false, code: 'NETWORK_UNAVAILABLE' }))
    }

    try {
      req = request(
        {
          protocol: 'https:',
          hostname: url.hostname,
          port: 443,
          path: `${url.pathname}${url.search}`,
          method: 'GET',
          headers: { ...IMPORT_IMAGE_REQUEST_HEADERS },
          agent,
          lookup: pinnedLookup(pinned.address, pinned.family),
          servername: url.hostname,
          timeout: remaining,
        },
        onResponse,
      )
    } catch {
      finish({ ok: false, code: 'NETWORK_UNAVAILABLE' })
      return
    }

    if (finished) {
      req.destroy()
      return
    }

    req.on('error', (error) => finish({ ok: false, code: networkFailure(error) }))
    req.on('timeout', () => finish({ ok: false, code: 'TIMEOUT' }))
    req.end()
  })
}

/**
 * Fetch over the network, following at most {@link IMPORT_IMAGE_MAX_REDIRECTS}
 * redirects, each through every rule again.
 *
 * @param {URL} start The checked address.
 * @param {{resolve: Function, request: Function, timeoutMs: number}} options The resolver, the request function and the time allowed.
 * @returns {Promise<{ok: true, bytes: Buffer, declaredType: string} | {ok: false, code: string}>} The body, or why not.
 */
async function fetchOverNetwork(start, { resolve, request, timeoutMs }) {
  const deadline = Date.now() + timeoutMs
  let current = start

  for (let hop = 0; ; hop += 1) {
    if (Date.now() >= deadline) return { ok: false, code: 'TIMEOUT' }

    // A fresh resolution and check on every hop: nothing from the last one is reused.
    const pinned = await resolvePublicAddress(current.hostname, resolve, deadline)

    if (!pinned.ok) return pinned

    const answer = await requestOnce(current, pinned, { request, deadline })

    if (!answer.ok || answer.redirect === undefined) return answer
    if (hop >= IMPORT_IMAGE_MAX_REDIRECTS) return { ok: false, code: 'TOO_MANY_REDIRECTS' }

    let next

    try {
      next = new URL(answer.redirect, current)
    } catch {
      return { ok: false, code: 'REDIRECT_OFF_LIST' }
    }

    const checked = checkImportImageUrl(next.href)

    if (!checked.ok) return { ok: false, code: 'REDIRECT_OFF_LIST' }

    current = checked.url
  }
}

/**
 * Read a fixture named by the address's last path segment.
 *
 * The name is taken from the raw `pathname`, never percent-decoded, and must
 * be a plain file name; the joined path must stay inside the directory, even
 * through a symbolic link. A directory that is unset, not there or not a
 * directory throws, as a configuration error.
 *
 * @param {URL} url The checked address.
 * @param {string} fixtureDir The directory.
 * @returns {Promise<{ok: true, bytes: Buffer, declaredType: null} | {ok: false, code: string}>} The bytes, or why not.
 */
async function readFixture(url, fixtureDir) {
  if (typeof fixtureDir !== 'string' || fixtureDir.trim() === '') {
    throw new Error('IMPORT_IMAGE_FIXTURE_DIR is required when IMPORT_IMAGE_SOURCE is fixtures.')
  }

  const root = path.resolve(fixtureDir)
  let realRoot = null

  try {
    const resolved = await realpath(root)

    if ((await stat(resolved)).isDirectory()) realRoot = resolved
  } catch {
    // Reported just below.
  }

  // A directory that is not there is a broken setup, not every picture
  // missing on the source, so it throws rather than answering HTTP_404.
  if (realRoot === null) {
    throw new Error('IMPORT_IMAGE_FIXTURE_DIR must name an existing directory.')
  }

  const raw = url.pathname
  const name = raw.slice(raw.lastIndexOf('/') + 1)

  if (!FIXTURE_NAME.test(name)) return { ok: false, code: 'HOST_NOT_ALLOWED' }

  const file = path.resolve(root, name)

  if (!file.startsWith(`${root}${path.sep}`)) return { ok: false, code: 'HOST_NOT_ALLOWED' }

  try {
    const realFile = await realpath(file)

    if (!realFile.startsWith(`${realRoot}${path.sep}`))
      return { ok: false, code: 'HOST_NOT_ALLOWED' }

    const info = await stat(realFile)

    if (!info.isFile()) return { ok: false, code: 'HTTP_404' }
    if (info.size > MEDIA_LIMITS.maxBytes) return { ok: false, code: 'TOO_LARGE' }

    return { ok: true, bytes: await readFile(realFile), declaredType: null }
  } catch (error) {
    // A picture that is not there answers as the server would.
    return {
      ok: false,
      code:
        /** @type {{code?: unknown}} */ (error)?.code === 'ENOENT'
          ? 'HTTP_404'
          : 'NETWORK_UNAVAILABLE',
    }
  }
}

/**
 * Run fetched bytes through the upload sanitiser for the kind of picture they
 * will be. A cover refused only because it is too small for a cover is taken
 * as a gallery picture instead, with {@link TOO_SMALL_FOR_COVER_NOTE}.
 *
 * @param {Uint8Array} bytes The fetched bytes.
 * @param {{role: string}} options `cover` or `gallery` (either case).
 * @returns {{ok: true, kind: 'EVENT_COVER'|'EVENT_GALLERY', note: string|null, image: object} | {ok: false, code: string}} What will be stored, or the refusal as `SANITISER_REFUSED:<code>`.
 */
export function sanitiseImportedImage(bytes, { role }) {
  const kind = String(role).toLowerCase() === 'cover' ? 'EVENT_COVER' : 'EVENT_GALLERY'

  try {
    return { ok: true, kind, note: null, image: sanitiseImage(bytes, { kind }) }
  } catch (error) {
    if (!(error instanceof MediaRefusal)) throw error

    if (kind === 'EVENT_COVER' && error.code === 'IMAGE_TOO_SMALL') {
      const gallery = sanitiseImportedImage(bytes, { role: 'gallery' })

      return gallery.ok ? { ...gallery, note: TOO_SMALL_FOR_COVER_NOTE } : gallery
    }

    return { ok: false, code: `SANITISER_REFUSED:${error.code}` }
  }
}

/**
 * Fetch one listed picture.
 *
 * The bytes returned are the ones that arrived; they have been sniffed as a
 * JPEG, PNG or WebP and passed the upload sanitiser as a gallery picture (the
 * least a stored picture must be), and the caller stores them through the
 * sanitiser again for the kind they will be ({@link sanitiseImportedImage}).
 *
 * @param {string} url The listed address.
 * @param {object} [options] How to fetch it.
 * @param {'network'|'fixtures'} [options.source] `IMPORT_IMAGE_SOURCE`.
 * @param {string} [options.fixtureDir] `IMPORT_IMAGE_FIXTURE_DIR`, required for fixtures.
 * @param {Function} [options.resolve] A resolver with `dns.lookup`'s signature.
 * @param {Function} [options.request] A request function with `https.request`'s signature.
 * @param {number} [options.timeoutMs] The whole fetch's time.
 * @param {string} [options.nodeEnv] `NODE_ENV`; fixtures are refused in production.
 * @param {{warn: Function}} [options.log] A logger; a failure logs its host and code only.
 * @returns {Promise<{ok: true, bytes: Buffer, contentType: string} | {ok: false, code: string}>} The picture, or why it was not copied.
 */
export async function fetchImportImage(url, options = {}) {
  const {
    source = 'network',
    fixtureDir,
    resolve = dnsLookup,
    request = https.request,
    timeoutMs = IMPORT_IMAGE_TIMEOUT_MS,
    nodeEnv = process.env.NODE_ENV,
    log,
  } = options

  if (!IMPORT_IMAGE_SOURCES.includes(source)) {
    throw new Error('IMPORT_IMAGE_SOURCE must be "network" or "fixtures".')
  }
  if (source === 'fixtures' && nodeEnv === 'production') {
    throw new Error('IMPORT_IMAGE_SOURCE=fixtures is refused in production.')
  }

  const fail = (code) => {
    log?.warn({ host: hostOf(url), code }, 'an imported picture was not copied')

    return { ok: false, code }
  }

  const checked = checkImportImageUrl(url)

  if (!checked.ok) return fail(checked.code)

  const fetched =
    source === 'fixtures'
      ? await readFixture(checked.url, fixtureDir)
      : await fetchOverNetwork(checked.url, { resolve, request, timeoutMs })

  if (!fetched.ok) return fail(fetched.code)

  const { type } = sniffImageType(fetched.bytes)

  if (!type || !MEDIA_CONTENT_TYPES.includes(type)) return fail('NOT_AN_IMAGE')

  const sanitised = sanitiseImportedImage(fetched.bytes, { role: 'gallery' })

  if (!sanitised.ok) return fail(sanitised.code)

  return { ok: true, bytes: fetched.bytes, contentType: type }
}
