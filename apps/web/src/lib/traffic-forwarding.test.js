import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CLIENT_ADDRESS_HEADER,
  HOPS_ZERO_IN_PRODUCTION_WARNING,
  MAX_FORWARDED_USER_AGENT,
  clientAddressFrom,
  resetForwardingWarnings,
  trafficForwardHeaders,
  trustedProxyHops,
} from './traffic-forwarding.js'

const XFF = (value) => new Headers({ 'x-forwarded-for': value })

beforeEach(() => resetForwardingWarnings())

describe('trustedProxyHops', () => {
  it('reads a whole number from 0 to 5, and defaults to 0', () => {
    const warn = vi.fn()

    expect(trustedProxyHops({}, { warn })).toBe(0)
    expect(trustedProxyHops({ TRAFFIC_TRUSTED_PROXY_HOPS: '2' }, { warn })).toBe(2)
    expect(trustedProxyHops({ TRAFFIC_TRUSTED_PROXY_HOPS: ' 5 ' }, { warn })).toBe(5)
    expect(warn).not.toHaveBeenCalled()
  })

  it.each(['6', '-1', '1.5', 'two', 'Infinity'])('takes %j as 0, and says so once', (value) => {
    const warn = vi.fn()

    expect(trustedProxyHops({ TRAFFIC_TRUSTED_PROXY_HOPS: value }, { warn })).toBe(0)
    expect(trustedProxyHops({ TRAFFIC_TRUSTED_PROXY_HOPS: value }, { warn })).toBe(0)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('warns once, and keeps running, when production takes addresses from the connection', () => {
    const warn = vi.fn()
    const production = { NODE_ENV: 'production' }

    expect(trustedProxyHops(production, { warn })).toBe(0)
    expect(trustedProxyHops(production, { warn })).toBe(0)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain(HOPS_ZERO_IN_PRODUCTION_WARNING)
    expect(HOPS_ZERO_IN_PRODUCTION_WARNING).toBe(
      'Visitor addresses are taken from the connection; set TRAFFIC_TRUSTED_PROXY_HOPS behind a proxy.',
    )
  })

  it('says nothing in production behind a configured proxy, or outside production', () => {
    const warn = vi.fn()

    trustedProxyHops({ NODE_ENV: 'production', TRAFFIC_TRUSTED_PROXY_HOPS: '1' }, { warn })
    trustedProxyHops({ NODE_ENV: 'development' }, { warn })

    expect(warn).not.toHaveBeenCalled()
  })
})

describe('clientAddressFrom', () => {
  it('takes the last entry with no proxy or one, and the one before it with two', () => {
    const headers = XFF('203.0.113.1, 198.51.100.2, 192.0.2.3')

    expect(clientAddressFrom(headers, { hops: 0 })).toBe('192.0.2.3')
    expect(clientAddressFrom(headers, { hops: 1 })).toBe('192.0.2.3')
    expect(clientAddressFrom(headers, { hops: 2 })).toBe('198.51.100.2')
    expect(clientAddressFrom(headers, { hops: 3 })).toBe('203.0.113.1')
  })

  it('reads nothing when there are fewer entries than proxies', () => {
    expect(clientAddressFrom(XFF('192.0.2.3'), { hops: 2 })).toBeNull()
  })

  it('drops an IPv6 zone and lower-cases the address', () => {
    expect(clientAddressFrom(XFF('FE80::1%eth0'), { hops: 0 })).toBe('fe80::1')
    expect(clientAddressFrom(XFF('2001:DB8::7'), { hops: 0 })).toBe('2001:db8::7')
  })

  it.each(['garbage', 'unknown', '192.0.2.3:443', '', ' , ', '<script>'])(
    'reads no address from %j',
    (value) => {
      expect(clientAddressFrom(XFF(value), { hops: 0 })).toBeNull()
    },
  )

  it('reads no address without the header', () => {
    expect(clientAddressFrom(new Headers(), { hops: 0 })).toBeNull()
  })
})

describe('trafficForwardHeaders', () => {
  const env = { TRAFFIC_TRUSTED_PROXY_HOPS: '0' }

  it('forwards the agent, the address and the two privacy signals, and nothing else', () => {
    const request = new Request('http://web.test/api/v1/traffic/beacons', {
      method: 'POST',
      headers: {
        'user-agent': 'Mozilla/5.0 Chrome/130',
        'x-forwarded-for': '198.51.100.7',
        'sec-gpc': '1',
        dnt: '1',
        cookie: 'a=b',
        authorization: 'Bearer x',
        referer: 'https://web.test/events/x',
        'x-desi-client-address': '203.0.113.250',
      },
    })

    expect(trafficForwardHeaders(request, { env })).toEqual({
      'user-agent': 'Mozilla/5.0 Chrome/130',
      [CLIENT_ADDRESS_HEADER]: '198.51.100.7',
      'sec-gpc': '1',
      dnt: '1',
    })
  })

  it('cuts an overlong agent to one past the maximum, and leaves out signals that are not "1"', () => {
    const request = new Request('http://web.test/x', {
      headers: { 'user-agent': 'A'.repeat(2000), 'sec-gpc': '0', dnt: 'yes' },
    })
    const headers = trafficForwardHeaders(request, { env })

    // Still longer than the API allows, so the API counts it as a robot's;
    // cut to exactly the maximum it would pass as a browser.
    expect(headers['user-agent']).toHaveLength(MAX_FORWARDED_USER_AGENT + 1)
    expect(Object.keys(headers)).toEqual(['user-agent'])
  })

  it('forwards an agent of exactly the maximum length whole', () => {
    const agent = `Mozilla/5.0 ${'x'.repeat(MAX_FORWARDED_USER_AGENT - 12)}`
    const request = new Request('http://web.test/x', { headers: { 'user-agent': agent } })

    expect(agent).toHaveLength(MAX_FORWARDED_USER_AGENT)
    expect(trafficForwardHeaders(request, { env })['user-agent']).toBe(agent)
  })

  it('works on a plain headers object too', () => {
    expect(
      trafficForwardHeaders(
        { headers: { 'user-agent': 'Mozilla/5.0', 'x-forwarded-for': '192.0.2.9' } },
        { env },
      ),
    ).toEqual({ 'user-agent': 'Mozilla/5.0', [CLIENT_ADDRESS_HEADER]: '192.0.2.9' })
  })
})
