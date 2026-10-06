/**
 * The importer's picture fetcher (`lib/import-images.js`, SPEC2-XI §5.I-D):
 * the API's only outbound caller, and so the place a server-side request
 * forgery would happen.
 *
 * No test here leaves this machine. The resolver and the request function are
 * stand-ins with Node's own signatures, so every rule can be driven: the URL
 * rules, name resolution and the public-address check (one address from every
 * refused range), the pinned connection that DNS rebinding cannot move, each
 * redirect hop re-checked from the start, the status, encoding, type and size
 * rules, the time limit, and the fixture directory's traversal guards. One test
 * hands the real `https.request` the fetcher's options, to prove Node itself
 * asks the pinned lookup for every address (`all: true`) and gets the checked
 * one.
 *
 * The refused ranges are written out here from the specification, not read
 * from the module, so dropping one from the module fails a test. One block
 * sends the fetcher's requests through Node's own `http.request` to a server on
 * 127.0.0.1, so the answers are real `IncomingMessage`s: they behave unlike a
 * stand-in stream when they are cut off.
 */

import { EventEmitter } from 'node:events'
import { mkdtemp, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { readFileSync } from 'node:fs'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { MEDIA_LIMITS } from '@desi-event/schemas/media'

import {
  IMPORT_IMAGE_HOSTS,
  IMPORT_IMAGE_MAX_REDIRECTS,
  IMPORT_IMAGE_REQUEST_HEADERS,
  REFUSED_IPV4_RANGES,
  REFUSED_IPV6_RANGES,
  TOO_SMALL_FOR_COVER_NOTE,
  checkImportImageUrl,
  fetchImportImage,
  isPublicAddress,
  pinnedLookup,
  sanitiseImportedImage,
} from '../src/lib/import-images.js'
import { solidPng } from './helpers/images.js'

const URL_OK = 'https://usimg.sulekha.io/cdn/events/images/garba-night_2026-09-26_62.webp?ver=0.06'
const PUBLIC_V4 = '93.184.215.14'
const PUBLIC_V6 = '2606:2800:21f:cb07:6820:80da:af6b:8b2c'
const PICTURE = solidPng(400, 400)
const PNG_HEADERS = Object.freeze({ 'content-type': 'image/png' })

/**
 * A resolver that answers from a list, one answer per call (the last repeats).
 *
 * @param {...(Array<string>|Error)} answers Addresses per call, or an error.
 * @returns {Function} A `dns.lookup` stand-in; `calls` records each host and options.
 */
function resolver(...answers) {
  const calls = []
  const resolve = (host, options, callback) => {
    const answer = answers[Math.min(calls.length, answers.length - 1)]

    calls.push({ host, options })
    setImmediate(() => {
      if (answer instanceof Error) callback(answer)
      else
        callback(
          null,
          answer.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })),
        )
    })
  }

  resolve.calls = calls

  return resolve
}

/**
 * A request function standing in for `https.request`, answering each request
 * with what `handler` says.
 *
 * @param {function(object, number): (object|null)} handler Given the options and the request's index; returns a reply, or null to never answer.
 * @returns {Function} The stand-in; `calls` records each request's options.
 */
function server(handler) {
  const calls = []
  const request = (options, onResponse) => {
    const req = new EventEmitter()
    const index = calls.length

    req.destroyed = false
    req.destroy = () => {
      req.destroyed = true

      return req
    }
    req.end = () => {
      setImmediate(() => {
        const reply = handler(options, index, req)

        if (!reply) return
        if (reply.error) {
          req.emit('error', reply.error)
          return
        }
        if (reply.timeout) {
          req.emit('timeout')
          return
        }

        const response = new PassThrough()

        response.statusCode = reply.status ?? 200
        response.headers = reply.headers ?? {}
        response.complete = reply.complete ?? true
        onResponse(response)

        if (reply.hang) return
        for (const chunk of reply.chunks ?? [reply.body ?? Buffer.alloc(0)]) {
          if (response.destroyed) break
          response.write(chunk)
        }
        if (!response.destroyed) response.end()
      })
    }
    calls.push({ options, req })

    return req
  }

  request.calls = calls

  return request
}

/**
 * Fetch over the stand-ins.
 *
 * @param {string} url The address.
 * @param {object} options The resolver, the request function and anything else.
 * @returns {Promise<object>} The outcome.
 */
function fetchWith(url, options) {
  return fetchImportImage(url, { source: 'network', timeoutMs: 2000, ...options })
}

/**
 * A request function that must never be called: it records the call and
 * throws, so a test that expects no request sees one.
 *
 * @returns {Function} The stand-in; `calls` records any call.
 */
function never() {
  const request = (options) => {
    request.calls.push({ options })
    throw new Error('no request may be made')
  }

  request.calls = []

  return request
}

describe('IMPORT_IMAGE_HOSTS', () => {
  it('is the one picture host in the Sulekha data, and frozen', () => {
    expect(IMPORT_IMAGE_HOSTS).toEqual(['usimg.sulekha.io'])
    expect(Object.isFrozen(IMPORT_IMAGE_HOSTS)).toBe(true)
  })

  it('admits every picture address in the committed dataset', () => {
    const dataset = JSON.parse(
      readFileSync(
        new URL('../../../packages/db/data/imports/sulekha-texas-2026.json', import.meta.url),
        'utf8',
      ),
    )
    const urls = dataset.events.flatMap((event) => event.images.map((image) => image.url))

    expect(urls).toHaveLength(86)
    expect(urls.filter((url) => checkImportImageUrl(url).ok)).toHaveLength(86)
  })
})

describe('the URL rules', () => {
  it.each([
    ['plain http', 'http://usimg.sulekha.io/a.png'],
    ['no slashes after the scheme', 'https:usimg.sulekha.io/a.png'],
    ['a user name', 'https://admin@usimg.sulekha.io/a.png'],
    ['a user and password', 'https://a:b@usimg.sulekha.io/a.png'],
    ['the allowed host as a user name', 'https://usimg.sulekha.io@example.net/a.png'],
    ['another port', 'https://usimg.sulekha.io:8443/a.png'],
    ['port 80', 'https://usimg.sulekha.io:80/a.png'],
    ['a trailing dot', 'https://usimg.sulekha.io./a.png'],
    ['an IPv4 literal', 'https://127.0.0.1/a.png'],
    ['a decimal IPv4 literal', 'https://2130706433/a.png'],
    ['an IPv6 literal', 'https://[::1]/a.png'],
    ['another host', 'https://example.net/a.png'],
    ['a look-alike host', 'https://usimg.sulekha.io.example.net/a.png'],
    ['a sub-domain', 'https://cdn.usimg.sulekha.io/a.png'],
    ['the CloudFront host the brief named', 'https://d3aew4oo17ml6.cloudfront.net/a.png'],
    ['a space', 'https://usimg.sulekha.io/a b.png'],
    ['a line break', 'https://usimg.sulekha.io/a\n.png'],
    ['too long', `https://usimg.sulekha.io/${'a'.repeat(2048)}.png`],
    ['nothing', ''],
    ['not a string', 42],
  ])('refuses %s as HOST_NOT_ALLOWED, before any lookup or request', async (_label, url) => {
    const resolve = resolver([PUBLIC_V4])
    const request = never()

    expect(checkImportImageUrl(url)).toEqual({ ok: false, code: 'HOST_NOT_ALLOWED' })
    expect(await fetchWith(url, { resolve, request })).toEqual({
      ok: false,
      code: 'HOST_NOT_ALLOWED',
    })
    expect(resolve.calls).toHaveLength(0)
    expect(request.calls).toHaveLength(0)
  })

  it('accepts the host in any case and an explicit :443', () => {
    expect(checkImportImageUrl('https://USIMG.Sulekha.IO/a.png')).toMatchObject({ ok: true })
    expect(checkImportImageUrl('https://usimg.sulekha.io:443/a.png')).toMatchObject({ ok: true })
    expect(checkImportImageUrl(URL_OK).url.hostname).toBe('usimg.sulekha.io')
  })
})

describe('isPublicAddress', () => {
  /**
   * An address inside a range: the network address with its last group set.
   *
   * @param {string} network The range's network address.
   * @param {number} prefix The range's prefix length.
   * @returns {string} An address in it.
   */
  function inside(network, prefix) {
    if (prefix === 128 || prefix === 32) return network
    if (network.includes(':')) return network.endsWith('::') ? `${network}5` : network

    const parts = network.split('.')

    parts[3] = String(Number(parts[3]) + 5)

    return parts.join('.')
  }

  it.each(
    REFUSED_IPV4_RANGES.map(([network, prefix]) => [
      `${network}/${prefix}`,
      inside(network, prefix),
    ]),
  )('refuses an IPv4 address in %s', (_range, address) => {
    expect(isPublicAddress(address)).toBe(false)
  })

  it.each(
    REFUSED_IPV6_RANGES.map(([network, prefix]) => [
      `${network}/${prefix}`,
      inside(network, prefix),
    ]),
  )('refuses an IPv6 address in %s', (_range, address) => {
    expect(isPublicAddress(address)).toBe(false)
  })

  it('holds every range SPEC2-XI §5.I-D lists, written out here and not read from the module', () => {
    expect(REFUSED_IPV4_RANGES.map(([network, prefix]) => `${network}/${prefix}`)).toEqual([
      '0.0.0.0/8',
      '10.0.0.0/8',
      '100.64.0.0/10',
      '127.0.0.0/8',
      '169.254.0.0/16',
      '172.16.0.0/12',
      '192.0.0.0/24',
      '192.0.2.0/24',
      // Beyond the specification's list: the deprecated 6to4 relay anycast.
      '192.88.99.0/24',
      '192.168.0.0/16',
      '198.18.0.0/15',
      '198.51.100.0/24',
      '203.0.113.0/24',
      '224.0.0.0/4',
      '240.0.0.0/4',
    ])
    expect(REFUSED_IPV6_RANGES.map(([network, prefix]) => `${network}/${prefix}`)).toEqual([
      '::/128',
      '::1/128',
      '::/96',
      '::ffff:0:0/96',
      '64:ff9b::/96',
      '64:ff9b:1::/48',
      '100::/64',
      '2001::/32',
      '2001:db8::/32',
      '2002::/16',
      'fc00::/7',
      'fe80::/10',
      'ff00::/8',
    ])
  })

  // One literal address from every range the specification lists, so a range
  // missing from the module cannot take its own test case with it.
  it.each([
    ['0/8', '0.1.2.3'],
    ['10/8', '10.200.3.4'],
    ['100.64/10', '100.64.0.1'],
    ['127/8', '127.8.9.10'],
    ['169.254/16', '169.254.10.20'],
    ['172.16/12', '172.20.1.1'],
    ['192.0.0/24', '192.0.0.9'],
    ['192.0.2/24', '192.0.2.7'],
    ['192.168/16', '192.168.1.1'],
    ['192.168/16, its end', '192.168.255.254'],
    ['198.18/15', '198.18.0.1'],
    ['198.18/15, its second half', '198.19.255.254'],
    ['198.51.100/24', '198.51.100.7'],
    ['203.0.113/24', '203.0.113.7'],
    ['224/4', '224.0.0.1'],
    ['224/4, its end', '239.255.255.250'],
    ['240/4', '240.0.0.1'],
    ['192.88.99/24 (beyond the list)', '192.88.99.1'],
    ['::', '::'],
    ['::1', '::1'],
    ['fc00::/7', 'fd12:3456:789a::1'],
    ['fe80::/10', 'febf::1'],
    ['ff00::/8', 'ff02::1'],
    ['IPv4-mapped 192.168/16', '::ffff:192.168.1.1'],
    ['IPv4-mapped 198.18/15', '::ffff:198.18.0.1'],
    ['NAT64 of 192.168/16', '64:ff9b::c0a8:101'],
    ['NAT64 of 224/4', '64:ff9b::e000:1'],
    ['outside 2000::/3, below it', '1fff::1'],
    ['outside 2000::/3, above it', '4000::1'],
    ['2001::/32', '2001:0:4136:e378:8000:63bf:3fff:fdd2'],
    ['2001:db8::/32', '2001:db8:85a3::8a2e:370:7334'],
    ['2002::/16', '2002:c0a8:101::1'],
    ['64:ff9b:1::/48', '64:ff9b:1::a00:1'],
    ['::/96', '::c0a8:101'],
    ['100::/64', '100::1'],
  ])('refuses an address in the listed range %s (%s)', (_range, address) => {
    expect(isPublicAddress(address)).toBe(false)
  })

  // Addresses just outside the ranges, so no range is wider than it is listed.
  it.each([
    '1.0.0.1',
    '11.0.0.1',
    '100.63.255.254',
    '100.128.0.1',
    '126.255.255.254',
    '128.0.0.1',
    '169.253.255.254',
    '169.255.0.1',
    '172.15.255.254',
    '172.32.0.1',
    '192.0.1.1',
    '192.0.3.1',
    '192.167.255.254',
    '192.169.0.1',
    '198.17.255.254',
    '198.20.0.1',
    '198.51.99.1',
    '198.51.101.1',
    '203.0.112.1',
    '203.0.114.1',
    '223.255.255.254',
    '2003:e0::1',
    '2a00:1450:4001::1',
  ])('admits %s, just outside a refused range', (address) => {
    expect(isPublicAddress(address)).toBe(true)
  })

  it.each([
    ['the cloud metadata service', '169.254.169.254'],
    ['the end of 172.16/12', '172.31.255.255'],
    ['the end of 100.64/10', '100.127.255.254'],
    ['broadcast', '255.255.255.255'],
    ['::', '::'],
    ['::1', '::1'],
    ['IPv4-mapped loopback', '::ffff:127.0.0.1'],
    ['IPv4-mapped private', '::ffff:10.1.2.3'],
    ['IPv4-mapped metadata', '::ffff:169.254.169.254'],
    ['IPv4-mapped, hexadecimal', '::ffff:a00:1'],
    ['NAT64 of loopback', '64:ff9b::7f00:1'],
    ['NAT64 of a private address', '64:ff9b::a00:1'],
    ['local NAT64', '64:ff9b:1::a00:1'],
    ['IPv4-compatible', '::7f00:1'],
    ['discard', '100::1'],
    ['Teredo', '2001:0:4136:e378:8000:63bf:3fff:fdd2'],
    ['documentation', '2001:db8::1'],
    ['6to4 of a private address', '2002:a00:1::1'],
    ['unique local, fc', 'fc00::1'],
    ['unique local, fd', 'fd12:3456:789a::1'],
    ['link-local', 'fe80::1'],
    ['link-local with a zone', 'fe80::1%eth0'],
    ['multicast', 'ff02::1'],
    ['outside global unicast', '4000::1'],
    ['not an address', 'usimg.sulekha.io'],
    ['a short IPv4 spelling', '127.1'],
    ['nothing', ''],
    ['not a string', null],
  ])('refuses %s (%s)', (_label, address) => {
    expect(isPublicAddress(address)).toBe(false)
  })

  it.each([PUBLIC_V4, '8.8.8.8', '1.1.1.1', '13.107.246.45', PUBLIC_V6, '2620:1ec:bdf::45'])(
    'admits the public address %s',
    (address) => {
      expect(isPublicAddress(address)).toBe(true)
    },
  )
})

describe('name resolution', () => {
  it('asks for every address of the host, and refuses when any one is not public', async () => {
    const resolve = resolver([PUBLIC_V4, '10.0.0.7'])
    const request = never()

    expect(await fetchWith(URL_OK, { resolve, request })).toEqual({
      ok: false,
      code: 'ADDRESS_NOT_PUBLIC',
    })
    expect(resolve.calls).toEqual([{ host: 'usimg.sulekha.io', options: { all: true } }])
    expect(request.calls).toHaveLength(0)
  })

  it.each(['127.0.0.1', '10.20.30.40', '169.254.169.254', '::1', 'fc00::7', 'fd00::1'])(
    'refuses a host resolving to %s without connecting',
    async (address) => {
      const request = never()

      expect(await fetchWith(URL_OK, { resolve: resolver([address]), request })).toEqual({
        ok: false,
        code: 'ADDRESS_NOT_PUBLIC',
      })
      expect(request.calls).toHaveLength(0)
    },
  )

  it('answers NETWORK_UNAVAILABLE when the name does not resolve, or resolves to nothing', async () => {
    const failing = Object.assign(new Error('getaddrinfo EAI_AGAIN'), { code: 'EAI_AGAIN' })

    expect(await fetchWith(URL_OK, { resolve: resolver(failing), request: never() })).toEqual({
      ok: false,
      code: 'NETWORK_UNAVAILABLE',
    })
    expect(await fetchWith(URL_OK, { resolve: resolver([]), request: never() })).toEqual({
      ok: false,
      code: 'NETWORK_UNAVAILABLE',
    })
  })

  it('answers TIMEOUT when the resolver never answers', async () => {
    const started = Date.now()
    const result = await fetchWith(URL_OK, {
      resolve: () => {},
      request: never(),
      timeoutMs: 60,
    })

    expect(result).toEqual({ ok: false, code: 'TIMEOUT' })
    expect(Date.now() - started).toBeLessThan(1500)
  })

  it('accepts a promise-returning resolver too', async () => {
    const request = server(() => ({ headers: PNG_HEADERS, body: PICTURE }))
    const result = await fetchWith(URL_OK, {
      resolve: async () => [{ address: PUBLIC_V4, family: 4 }],
      request,
    })

    expect(result).toMatchObject({ ok: true, contentType: 'image/png' })
  })
})

describe('the pinned connection', () => {
  it('answers with the checked address whether or not Node asks for all of them', () => {
    const lookup = pinnedLookup(PUBLIC_V4, 4)
    const single = vi.fn()
    const all = vi.fn()
    const bare = vi.fn()

    lookup('usimg.sulekha.io', { family: 0 }, single)
    lookup('usimg.sulekha.io', { all: true, family: 0 }, all)
    lookup('anything.example', bare)

    expect(single).toHaveBeenCalledWith(null, PUBLIC_V4, 4)
    expect(all).toHaveBeenCalledWith(null, [{ address: PUBLIC_V4, family: 4 }])
    expect(bare).toHaveBeenCalledWith(null, PUBLIC_V4, 4)
  })

  it('cannot be moved by DNS rebinding: the connect path gets the address that was checked', async () => {
    // The first answer is public; every later one is loopback, as a rebinding
    // name server would do between the check and the connection.
    const resolve = resolver([PUBLIC_V4], ['127.0.0.1'])
    const request = server(() => ({ headers: PNG_HEADERS, body: PICTURE }))

    expect(await fetchWith(URL_OK, { resolve, request })).toMatchObject({ ok: true })
    expect(resolve.calls).toHaveLength(1)

    const [{ options }] = request.calls
    const single = vi.fn()
    const all = vi.fn()

    options.lookup(options.hostname, {}, single)
    options.lookup(options.hostname, { all: true }, all)

    expect(single).toHaveBeenCalledWith(null, PUBLIC_V4, 4)
    expect(all).toHaveBeenCalledWith(null, [{ address: PUBLIC_V4, family: 4 }])
  })

  it('pins an IPv6 address with its family', async () => {
    const request = server(() => ({ headers: PNG_HEADERS, body: PICTURE }))

    await fetchWith(URL_OK, { resolve: resolver([PUBLIC_V6]), request })

    const all = vi.fn()

    request.calls[0].options.lookup('usimg.sulekha.io', { all: true }, all)
    expect(all).toHaveBeenCalledWith(null, [{ address: PUBLIC_V6, family: 6 }])
  })

  it('sends a plain GET on its own agent, never the global one, with the certificate checked', async () => {
    const request = server(() => ({ headers: PNG_HEADERS, body: PICTURE }))

    await fetchWith(URL_OK, { resolve: resolver([PUBLIC_V4]), request })

    const [{ options }] = request.calls

    expect(options).toMatchObject({
      protocol: 'https:',
      hostname: 'usimg.sulekha.io',
      servername: 'usimg.sulekha.io',
      port: 443,
      method: 'GET',
      path: '/cdn/events/images/garba-night_2026-09-26_62.webp?ver=0.06',
    })
    expect(options.headers).toEqual({ ...IMPORT_IMAGE_REQUEST_HEADERS })
    expect(options.headers).toEqual({
      accept: 'image/jpeg, image/png, image/webp',
      'accept-encoding': 'identity',
      'user-agent': 'Desi-Event importer',
    })
    expect(options.agent).toBeInstanceOf(https.Agent)
    expect(options.agent).not.toBe(https.globalAgent)
    expect(options.agent.keepAlive).toBe(false)
    for (const key of ['auth', 'rejectUnauthorized', 'checkServerIdentity', 'ca', 'proxy']) {
      expect(options, key).not.toHaveProperty(key)
    }
  })

  it('uses a fresh agent for every request', async () => {
    const request = server(() => ({ headers: PNG_HEADERS, body: PICTURE }))
    const resolve = resolver([PUBLIC_V4])

    await fetchWith(URL_OK, { resolve, request })
    await fetchWith(URL_OK, { resolve, request })

    expect(request.calls[0].options.agent).not.toBe(request.calls[1].options.agent)
  })

  it('is asked by Node itself for every address (all: true) and answers with the checked one', async () => {
    const asked = []
    const answered = []
    // The real https.request, with the fetcher's own options. The wrapper
    // records what Node passes to the pinned lookup and what it answers, then
    // stops the connection there, so nothing leaves this machine.
    const request = (options, onResponse) =>
      https.request(
        {
          ...options,
          lookup: (hostname, lookupOptions, callback) => {
            asked.push({ hostname, all: lookupOptions?.all === true })
            options.lookup(hostname, lookupOptions, (error, ...answer) => {
              answered.push(answer)
              callback(Object.assign(new Error('stopped by the test'), { code: 'ESTOPPED' }))
            })
          },
        },
        onResponse,
      )

    const result = await fetchWith(URL_OK, { resolve: resolver([PUBLIC_V4]), request })

    expect(result).toEqual({ ok: false, code: 'NETWORK_UNAVAILABLE' })
    expect(asked).toEqual([{ hostname: 'usimg.sulekha.io', all: true }])
    expect(answered).toEqual([[[{ address: PUBLIC_V4, family: 4 }]]])
  })
})

describe('redirects', () => {
  it('follows one on the allowed host, resolving and checking the name again', async () => {
    const resolve = resolver([PUBLIC_V4])
    const request = server((options, index) =>
      index === 0
        ? { status: 302, headers: { location: '/cdn/events/images/moved.png' } }
        : { headers: PNG_HEADERS, body: PICTURE },
    )

    expect(await fetchWith(URL_OK, { resolve, request })).toMatchObject({ ok: true })
    expect(resolve.calls).toHaveLength(2)
    expect(request.calls.map((call) => call.options.path)).toEqual([
      '/cdn/events/images/garba-night_2026-09-26_62.webp?ver=0.06',
      '/cdn/events/images/moved.png',
    ])
    // Nothing from the first hop's connection is reused.
    expect(request.calls[0].options.agent).not.toBe(request.calls[1].options.agent)
  })

  it.each([301, 302, 303, 307, 308])('follows a %i within the list', async (status) => {
    const request = server((options, index) =>
      index === 0
        ? { status, headers: { location: 'https://usimg.sulekha.io/b.png' } }
        : { headers: PNG_HEADERS, body: PICTURE },
    )

    expect(await fetchWith(URL_OK, { resolve: resolver([PUBLIC_V4]), request })).toMatchObject({
      ok: true,
    })
  })

  it.each([
    ['another host', 'https://example.net/a.png'],
    ['the metadata service', 'http://169.254.169.254/latest/meta-data/'],
    ['plain http on the same host', 'http://usimg.sulekha.io/a.png'],
    ['a protocol-relative address elsewhere', '//example.net/a.png'],
    ['another port', 'https://usimg.sulekha.io:8443/a.png'],
    ['a sign-in', 'https://user@usimg.sulekha.io/a.png'],
    ['a file', 'file:///etc/passwd'],
  ])(
    'refuses one to %s as REDIRECT_OFF_LIST, without a second request',
    async (_label, location) => {
      const resolve = resolver([PUBLIC_V4])
      const request = server(() => ({ status: 302, headers: { location } }))

      expect(await fetchWith(URL_OK, { resolve, request })).toEqual({
        ok: false,
        code: 'REDIRECT_OFF_LIST',
      })
      expect(request.calls).toHaveLength(1)
      expect(resolve.calls).toHaveLength(1)
    },
  )

  it('refuses a hop whose name now resolves to a private address', async () => {
    const resolve = resolver([PUBLIC_V4], ['10.0.0.9'])
    const request = server(() => ({
      status: 307,
      headers: { location: 'https://usimg.sulekha.io/again.png' },
    }))

    expect(await fetchWith(URL_OK, { resolve, request })).toEqual({
      ok: false,
      code: 'ADDRESS_NOT_PUBLIC',
    })
    expect(resolve.calls).toHaveLength(2)
    expect(request.calls).toHaveLength(1)
  })

  it(`follows at most ${IMPORT_IMAGE_MAX_REDIRECTS} and refuses the next as TOO_MANY_REDIRECTS`, async () => {
    const twice = server((options, index) =>
      index < 2
        ? { status: 302, headers: { location: `/hop-${index}.png` } }
        : { headers: PNG_HEADERS, body: PICTURE },
    )

    expect(
      await fetchWith(URL_OK, { resolve: resolver([PUBLIC_V4]), request: twice }),
    ).toMatchObject({ ok: true })

    const forever = server((options, index) => ({
      status: 302,
      headers: { location: `/hop-${index}.png` },
    }))

    expect(await fetchWith(URL_OK, { resolve: resolver([PUBLIC_V4]), request: forever })).toEqual({
      ok: false,
      code: 'TOO_MANY_REDIRECTS',
    })
    expect(forever.calls).toHaveLength(3)
  })

  it('answers HTTP_<status> for a redirect with no Location', async () => {
    const request = server(() => ({ status: 302, headers: {} }))

    expect(await fetchWith(URL_OK, { resolve: resolver([PUBLIC_V4]), request })).toEqual({
      ok: false,
      code: 'HTTP_302',
    })
  })
})

describe('the answer', () => {
  it('returns the picture and its type, sniffed from its bytes', async () => {
    const request = server(() => ({
      headers: { 'content-type': 'IMAGE/PNG; charset=binary', 'content-length': '999' },
      chunks: [PICTURE.subarray(0, 10), PICTURE.subarray(10)],
    }))
    const result = await fetchWith(URL_OK, { resolve: resolver([PUBLIC_V4]), request })

    expect(result).toEqual({ ok: true, bytes: PICTURE, contentType: 'image/png' })
  })

  it.each([404, 403, 500, 204, 206])('answers HTTP_%i for any status but 200', async (status) => {
    const request = server(() => ({ status, headers: PNG_HEADERS, body: PICTURE }))

    expect(await fetchWith(URL_OK, { resolve: resolver([PUBLIC_V4]), request })).toEqual({
      ok: false,
      code: `HTTP_${status}`,
    })
  })

  it.each(['gzip', 'br', 'deflate', 'gzip, identity'])(
    'refuses a %s-encoded answer as NOT_AN_IMAGE',
    async (encoding) => {
      const request = server(() => ({
        headers: { ...PNG_HEADERS, 'content-encoding': encoding },
        body: PICTURE,
      }))

      expect(await fetchWith(URL_OK, { resolve: resolver([PUBLIC_V4]), request })).toEqual({
        ok: false,
        code: 'NOT_AN_IMAGE',
      })
    },
  )

  it('accepts an identity encoding', async () => {
    const request = server(() => ({
      headers: { ...PNG_HEADERS, 'content-encoding': 'identity' },
      body: PICTURE,
    }))

    expect(await fetchWith(URL_OK, { resolve: resolver([PUBLIC_V4]), request })).toMatchObject({
      ok: true,
    })
  })

  it.each([
    ['a web page', { 'content-type': 'text/html' }],
    ['an SVG', { 'content-type': 'image/svg+xml' }],
    ['a GIF', { 'content-type': 'image/gif' }],
    ['no type', {}],
  ])('refuses %s by its declared type as NOT_AN_IMAGE', async (_label, headers) => {
    const request = server(() => ({ headers, body: PICTURE }))

    expect(await fetchWith(URL_OK, { resolve: resolver([PUBLIC_V4]), request })).toEqual({
      ok: false,
      code: 'NOT_AN_IMAGE',
    })
  })

  it('refuses bytes that are not a picture whatever the header says', async () => {
    const request = server(() => ({
      headers: PNG_HEADERS,
      body: Buffer.from('<!doctype html><title>not a picture</title>'),
    }))

    expect(await fetchWith(URL_OK, { resolve: resolver([PUBLIC_V4]), request })).toEqual({
      ok: false,
      code: 'NOT_AN_IMAGE',
    })
  })

  it('passes the picture through the upload sanitiser, which refuses one too small to show', async () => {
    const request = server(() => ({ headers: PNG_HEADERS, body: solidPng(40, 40) }))

    expect(await fetchWith(URL_OK, { resolve: resolver([PUBLIC_V4]), request })).toEqual({
      ok: false,
      code: 'SANITISER_REFUSED:IMAGE_TOO_SMALL',
    })
  })

  it('refuses a declared length over the limit before reading any of it', async () => {
    const request = server(() => ({
      headers: { ...PNG_HEADERS, 'content-length': String(MEDIA_LIMITS.maxBytes + 1) },
      hang: true,
    }))

    expect(await fetchWith(URL_OK, { resolve: resolver([PUBLIC_V4]), request })).toEqual({
      ok: false,
      code: 'TOO_LARGE',
    })
  })

  it('stops a body that streams past the limit with no length declared', async () => {
    const mebibyte = Buffer.alloc(1024 * 1024, 0)
    const request = server(() => ({
      headers: PNG_HEADERS,
      chunks: [PICTURE.subarray(0, 16), ...Array.from({ length: 11 }, () => mebibyte)],
    }))

    expect(await fetchWith(URL_OK, { resolve: resolver([PUBLIC_V4]), request })).toEqual({
      ok: false,
      code: 'TOO_LARGE',
    })
  })

  it('answers NETWORK_UNAVAILABLE for a body cut short, a refused connection or a TLS failure', async () => {
    const cut = server(() => ({
      headers: PNG_HEADERS,
      body: PICTURE.subarray(0, 30),
      complete: false,
    }))

    expect(await fetchWith(URL_OK, { resolve: resolver([PUBLIC_V4]), request: cut })).toEqual({
      ok: false,
      code: 'NETWORK_UNAVAILABLE',
    })

    for (const code of ['ECONNREFUSED', 'ECONNRESET', 'ERR_TLS_CERT_ALTNAME_INVALID']) {
      const refused = server(() => ({ error: Object.assign(new Error(code), { code }) }))

      expect(await fetchWith(URL_OK, { resolve: resolver([PUBLIC_V4]), request: refused })).toEqual(
        { ok: false, code: 'NETWORK_UNAVAILABLE' },
      )
    }
  })
})

describe('the answer, as a real IncomingMessage', () => {
  // The stand-in above answers with a PassThrough. Node's own IncomingMessage
  // emits `aborted` and `close` the moment it is destroyed, before the line
  // after `destroy()` runs, so these cases send the fetcher's own options
  // through Node's `http.request` to a server on 127.0.0.1. Only the transport
  // changes (no certificate for the allowed host can be made here): the scheme,
  // the agent and the address the pinned lookup answers with.
  let server
  let port
  let handle = () => {}

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      res.on('error', () => {})
      handle(req, res)
    })
    server.on('clientError', () => {})
    await new Promise((settle) => server.listen(0, '127.0.0.1', settle))
    ;({ port } = server.address())
  })

  afterAll(async () => {
    server.closeAllConnections()
    await new Promise((settle) => server.close(settle))
  })

  /**
   * `https.request`'s stand-in: Node's `http.request` to the local server.
   *
   * @param {object} options The fetcher's options.
   * @param {Function} onResponse The fetcher's response handler.
   * @returns {http.ClientRequest} The real request.
   */
  function local(options, onResponse) {
    return http.request(
      {
        ...options,
        protocol: 'http:',
        port,
        agent: false,
        lookup: pinnedLookup('127.0.0.1', 4),
      },
      onResponse,
    )
  }

  /**
   * Fetch through the local server.
   *
   * @param {string} [url] The address.
   * @returns {Promise<object>} The outcome.
   */
  function fetchLocal(url = URL_OK) {
    return fetchWith(url, { resolve: resolver([PUBLIC_V4]), request: local, timeoutMs: 5000 })
  }

  it('returns a picture that arrives whole', async () => {
    handle = (req, res) => {
      res.writeHead(200, { 'content-type': 'image/png' })
      res.end(PICTURE)
    }

    expect(await fetchLocal()).toEqual({ ok: true, bytes: PICTURE, contentType: 'image/png' })
  })

  it('answers TOO_LARGE, not a network failure, for a body that streams past the limit', async () => {
    const mebibyte = Buffer.alloc(1024 * 1024, 0)
    let sent = 0

    handle = (req, res) => {
      // No length declared: the body is chunked and only its size can stop it.
      res.writeHead(200, { 'content-type': 'image/png' })
      res.write(PICTURE.subarray(0, 16))

      const pump = () => {
        while (sent < 12) {
          sent += 1
          if (!res.write(mebibyte)) {
            res.once('drain', pump)
            return
          }
        }
        res.end()
      }

      pump()
    }

    expect(await fetchLocal()).toEqual({ ok: false, code: 'TOO_LARGE' })
    expect(sent).toBeGreaterThan(MEDIA_LIMITS.maxBytes / mebibyte.length - 1)
  })

  it('answers TOO_LARGE for a declared length over the limit', async () => {
    handle = (req, res) => {
      res.writeHead(200, {
        'content-type': 'image/png',
        'content-length': String(MEDIA_LIMITS.maxBytes + 1),
      })
      res.write(PICTURE)
    }

    expect(await fetchLocal()).toEqual({ ok: false, code: 'TOO_LARGE' })
  })

  it('answers NETWORK_UNAVAILABLE for a body cut short', async () => {
    handle = (req, res) => {
      res.writeHead(200, { 'content-type': 'image/png', 'content-length': String(PICTURE.length) })
      res.write(PICTURE.subarray(0, 64), () => res.socket.destroy())
    }

    expect(await fetchLocal()).toEqual({ ok: false, code: 'NETWORK_UNAVAILABLE' })
  })

  it('answers by status, encoding and redirect rules when the refused answer has a body', async () => {
    const page = Buffer.from(`<!doctype html><p>${'x'.repeat(4000)}</p>`)

    handle = (req, res) => {
      res.writeHead(404, { 'content-type': 'text/html', 'content-length': String(page.length) })
      res.end(page)
    }
    expect(await fetchLocal()).toEqual({ ok: false, code: 'HTTP_404' })

    handle = (req, res) => {
      res.writeHead(200, { 'content-type': 'image/png', 'content-encoding': 'gzip' })
      res.end(PICTURE)
    }
    expect(await fetchLocal()).toEqual({ ok: false, code: 'NOT_AN_IMAGE' })

    handle = (req, res) => {
      res.writeHead(302, { location: 'https://example.net/a.png', 'content-type': 'text/html' })
      res.end(page)
    }
    expect(await fetchLocal()).toEqual({ ok: false, code: 'REDIRECT_OFF_LIST' })

    handle = (req, res) => {
      if (req.url === '/moved.png') {
        res.writeHead(200, { 'content-type': 'image/png' })
        res.end(PICTURE)
      } else {
        res.writeHead(301, { location: '/moved.png', 'content-type': 'text/html' })
        res.end(page)
      }
    }
    expect(await fetchLocal()).toMatchObject({ ok: true, contentType: 'image/png' })
  })
})

describe('the time limit', () => {
  it('answers TIMEOUT when the server never answers, and gives up its connection', async () => {
    const request = server(() => null)
    const started = Date.now()
    const result = await fetchWith(URL_OK, {
      resolve: resolver([PUBLIC_V4]),
      request,
      timeoutMs: 80,
    })

    expect(result).toEqual({ ok: false, code: 'TIMEOUT' })
    expect(Date.now() - started).toBeLessThan(1500)
    expect(request.calls[0].req.destroyed).toBe(true)
  })

  it('answers TIMEOUT when the body stalls part way', async () => {
    const request = server(() => ({ headers: PNG_HEADERS, hang: true }))

    expect(
      await fetchWith(URL_OK, { resolve: resolver([PUBLIC_V4]), request, timeoutMs: 80 }),
    ).toEqual({ ok: false, code: 'TIMEOUT' })
  })

  it('answers TIMEOUT for an idle socket or ETIMEDOUT', async () => {
    const idle = server(() => ({ timeout: true }))
    const late = server(() => ({ error: Object.assign(new Error('late'), { code: 'ETIMEDOUT' }) }))

    expect(await fetchWith(URL_OK, { resolve: resolver([PUBLIC_V4]), request: idle })).toEqual({
      ok: false,
      code: 'TIMEOUT',
    })
    expect(await fetchWith(URL_OK, { resolve: resolver([PUBLIC_V4]), request: late })).toEqual({
      ok: false,
      code: 'TIMEOUT',
    })
  })

  it('gives each request the time that is left as its socket timeout', async () => {
    const request = server(() => ({ headers: PNG_HEADERS, body: PICTURE }))

    await fetchWith(URL_OK, { resolve: resolver([PUBLIC_V4]), request, timeoutMs: 10_000 })

    expect(request.calls[0].options.timeout).toBeGreaterThan(9000)
    expect(request.calls[0].options.timeout).toBeLessThanOrEqual(10_000)
  })
})

describe('logging', () => {
  it('logs the host and the code of a failure, and never the address', async () => {
    const log = { warn: vi.fn() }
    const secretPath = 'https://usimg.sulekha.io/private/organiser-upload_83c1.png?sig=abc'

    await fetchWith(secretPath, {
      resolve: resolver(['10.1.1.1']),
      request: never(),
      log,
    })

    expect(log.warn).toHaveBeenCalledTimes(1)
    expect(log.warn.mock.calls[0][0]).toEqual({
      host: 'usimg.sulekha.io',
      code: 'ADDRESS_NOT_PUBLIC',
    })
    expect(JSON.stringify(log.warn.mock.calls)).not.toMatch(/organiser-upload|private|sig=/u)
  })

  it('logs nothing for a picture that was copied', async () => {
    const log = { warn: vi.fn() }
    const request = server(() => ({ headers: PNG_HEADERS, body: PICTURE }))

    await fetchWith(URL_OK, { resolve: resolver([PUBLIC_V4]), request, log })

    expect(log.warn).not.toHaveBeenCalled()
  })
})

describe('the source setting', () => {
  it('refuses fixtures in production, and an unknown source, before doing anything', async () => {
    await expect(
      fetchImportImage(URL_OK, { source: 'fixtures', fixtureDir: tmpdir(), nodeEnv: 'production' }),
    ).rejects.toThrow(/refused in production/u)
    await expect(fetchImportImage(URL_OK, { source: 'cache' })).rejects.toThrow(
      /network" or "fixtures/u,
    )
  })
})

describe('fixtures mode', () => {
  let dir
  let outside

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'desi-event-import-images-'))
    outside = await mkdtemp(path.join(tmpdir(), 'desi-event-import-outside-'))
    await writeFile(path.join(dir, 'garba-night.png'), PICTURE)
    await writeFile(path.join(dir, 'not-a-picture.png'), Buffer.from('plain text'))
    await writeFile(path.join(outside, 'secret.png'), PICTURE)
    await symlink(path.join(outside, 'secret.png'), path.join(dir, 'link-out.png'))
    await writeFile(path.join(dir, 'huge.png'), Buffer.alloc(0))
    await truncate(path.join(dir, 'huge.png'), MEDIA_LIMITS.maxBytes + 1)
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  })

  /**
   * Fetch in fixtures mode, with a resolver and request that must not be used.
   *
   * @param {string} url The address.
   * @returns {Promise<object>} The outcome.
   */
  function fromFixtures(url) {
    return fetchImportImage(url, {
      source: 'fixtures',
      fixtureDir: dir,
      nodeEnv: 'test',
      resolve: () => {
        throw new Error('no lookup in fixtures mode')
      },
      request: never(),
    })
  }

  it('reads the picture named by the address, with no network', async () => {
    expect(
      await fromFixtures('https://usimg.sulekha.io/cdn/events/images/garba-night.png?ver=1'),
    ).toEqual({
      ok: true,
      bytes: PICTURE,
      contentType: 'image/png',
    })
  })

  it('still applies the URL rules', async () => {
    expect(await fromFixtures('http://usimg.sulekha.io/garba-night.png')).toEqual({
      ok: false,
      code: 'HOST_NOT_ALLOWED',
    })
    expect(await fromFixtures('https://example.net/garba-night.png')).toEqual({
      ok: false,
      code: 'HOST_NOT_ALLOWED',
    })
  })

  it('answers HTTP_404 for a picture that is not there', async () => {
    expect(await fromFixtures('https://usimg.sulekha.io/cdn/missing.png')).toEqual({
      ok: false,
      code: 'HTTP_404',
    })
  })

  it.each([
    ['an encoded climb', 'https://usimg.sulekha.io/cdn/..%2F..%2Fetc%2Fpasswd'],
    ['an encoded dot-dot', 'https://usimg.sulekha.io/cdn/%2e%2e'],
    ['an encoded dot-dot with a name', 'https://usimg.sulekha.io/cdn/%2e%2e%2fsecret.png'],
    ['a name with an encoded slash', 'https://usimg.sulekha.io/cdn/a%2Fb.png'],
    ['a name with an encoded backslash', 'https://usimg.sulekha.io/cdn/a%5Cb.png'],
    ['a plain dot-dot', 'https://usimg.sulekha.io/cdn/..'],
    ['a hidden name', 'https://usimg.sulekha.io/cdn/.env'],
    ['no name', 'https://usimg.sulekha.io/cdn/'],
    ['a percent-encoded name', 'https://usimg.sulekha.io/cdn/garba%2Dnight.png'],
  ])('refuses %s as HOST_NOT_ALLOWED', async (_label, url) => {
    expect(await fromFixtures(url)).toEqual({ ok: false, code: 'HOST_NOT_ALLOWED' })
  })

  it('stays inside the directory: a climb that the URL parser resolves lands on a name inside it', async () => {
    // WHATWG URL parsing resolves `..` segments before the name is read, so
    // the most a climb can do is name a file in the directory itself.
    expect(await fromFixtures('https://usimg.sulekha.io/cdn/../../garba-night.png')).toMatchObject({
      ok: true,
    })
    expect(await fromFixtures('https://usimg.sulekha.io/../../../etc/passwd')).toEqual({
      ok: false,
      code: 'HTTP_404',
    })
  })

  it('refuses a link that points out of the directory', async () => {
    expect(await fromFixtures('https://usimg.sulekha.io/cdn/link-out.png')).toEqual({
      ok: false,
      code: 'HOST_NOT_ALLOWED',
    })
  })

  it('refuses a file over the size limit and one that is not a picture', async () => {
    expect(await fromFixtures('https://usimg.sulekha.io/huge.png')).toEqual({
      ok: false,
      code: 'TOO_LARGE',
    })
    expect(await fromFixtures('https://usimg.sulekha.io/not-a-picture.png')).toEqual({
      ok: false,
      code: 'NOT_AN_IMAGE',
    })
  })

  it('needs its directory', async () => {
    await expect(
      fetchImportImage(URL_OK, { source: 'fixtures', fixtureDir: '', nodeEnv: 'test' }),
    ).rejects.toThrow(/IMPORT_IMAGE_FIXTURE_DIR is required/u)
  })

  it.each([
    ['a directory that is not there', () => path.join(dir, 'no-such-directory')],
    ['a file named as the directory', () => path.join(dir, 'garba-night.png')],
  ])(
    'treats %s as a broken setup, not as pictures missing on the source',
    async (_label, fixtureDir) => {
      const log = { warn: vi.fn() }

      for (const url of [URL_OK, 'https://usimg.sulekha.io/cdn/..%2Fsecret.png']) {
        await expect(
          fetchImportImage(url, {
            source: 'fixtures',
            fixtureDir: fixtureDir(),
            nodeEnv: 'test',
            log,
          }),
        ).rejects.toThrow(/IMPORT_IMAGE_FIXTURE_DIR must name an existing directory/u)
      }
      expect(log.warn).not.toHaveBeenCalled()
    },
  )
})

describe('sanitiseImportedImage', () => {
  it('stores a large enough cover as the cover', () => {
    const result = sanitiseImportedImage(solidPng(1200, 630), { role: 'cover' })

    expect(result).toMatchObject({ ok: true, kind: 'EVENT_COVER', note: null })
    expect(result.image).toMatchObject({ contentType: 'image/png', width: 1200, height: 630 })
  })

  it('takes a cover too small for a cover into the gallery, with a note', () => {
    expect(sanitiseImportedImage(PICTURE, { role: 'COVER' })).toMatchObject({
      ok: true,
      kind: 'EVENT_GALLERY',
      note: TOO_SMALL_FOR_COVER_NOTE,
    })
    expect(TOO_SMALL_FOR_COVER_NOTE).toBe('Too small for a cover')
  })

  it('refuses what the sanitiser refuses, naming its code', () => {
    expect(sanitiseImportedImage(solidPng(40, 40), { role: 'cover' })).toEqual({
      ok: false,
      code: 'SANITISER_REFUSED:IMAGE_TOO_SMALL',
    })
    expect(sanitiseImportedImage(solidPng(40, 40), { role: 'gallery' })).toEqual({
      ok: false,
      code: 'SANITISER_REFUSED:IMAGE_TOO_SMALL',
    })
    expect(sanitiseImportedImage(Buffer.from('GIF89a....'), { role: 'gallery' })).toEqual({
      ok: false,
      code: 'SANITISER_REFUSED:UNSUPPORTED_MEDIA_TYPE',
    })
  })
})
