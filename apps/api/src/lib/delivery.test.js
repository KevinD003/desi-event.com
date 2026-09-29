/**
 * Delivery mode: the truth table, and the headers that keep a show-once code
 * out of every cache.
 */

import { randomBytes } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import { DELIVERY_MODES, deliverCode, noStore, resolveDeliveryMode } from './delivery.js'

const provider = async () => {}

describe('resolveDeliveryMode', () => {
  it('is MANUAL when nothing is named and no provider is wired in, which is this build', () => {
    expect(resolveDeliveryMode({ env: {} })).toBe('MANUAL')
    expect(resolveDeliveryMode({ env: { DELIVERY_MODE: '' } })).toBe('MANUAL')
    expect(resolveDeliveryMode()).toBe('MANUAL')
  })

  it('is EMAIL when nothing is named and a provider is wired in', () => {
    expect(resolveDeliveryMode({ env: {}, deliver: provider })).toBe('EMAIL')
  })

  it('is MANUAL when MANUAL is named, even with a provider', () => {
    expect(resolveDeliveryMode({ env: { DELIVERY_MODE: 'MANUAL' }, deliver: provider })).toBe(
      'MANUAL',
    )
    expect(resolveDeliveryMode({ env: { DELIVERY_MODE: 'MANUAL' } })).toBe('MANUAL')
  })

  it('is EMAIL when EMAIL is named and a provider is wired in', () => {
    expect(resolveDeliveryMode({ env: { DELIVERY_MODE: 'EMAIL' }, deliver: provider })).toBe(
      'EMAIL',
    )
  })

  it('refuses EMAIL with no provider, naming what is missing, rather than drop every code', () => {
    expect(() => resolveDeliveryMode({ env: { DELIVERY_MODE: 'EMAIL' } })).toThrow(
      /no delivery provider is configured/u,
    )
    // A provider that is not a function is not a provider.
    expect(() =>
      resolveDeliveryMode({ env: { DELIVERY_MODE: 'EMAIL' }, deliver: 'smtp://x' }),
    ).toThrow(TypeError)
  })

  it('refuses a mode it does not know', () => {
    expect(() => resolveDeliveryMode({ env: { DELIVERY_MODE: 'SMS' } })).toThrow(/MANUAL or EMAIL/u)
  })

  it('names exactly the two modes the database enum holds', () => {
    expect(Object.values(DELIVERY_MODES).sort()).toEqual(['EMAIL', 'MANUAL'])
  })
})

/**
 * A reply double that records headers.
 *
 * @returns {{headers: Record<string, string>, header: Function}} The double.
 */
function fakeReply() {
  const headers = {}

  return {
    headers,
    header(name, value) {
      headers[name.toLowerCase()] = value

      return this
    },
  }
}

describe('noStore', () => {
  it('marks a response private and uncacheable, for HTTP/1.0 caches too', () => {
    const reply = fakeReply()

    expect(noStore(reply)).toBe(reply)
    expect(reply.headers['cache-control']).toBe('no-store, private')
    expect(reply.headers.pragma).toBe('no-cache')
  })
})

describe('deliverCode', () => {
  // Made at run time, the way the API makes one, so no code-shaped literal sits in the tree.
  const SECRET = randomBytes(32).toString('base64url')

  it('returns the code once in MANUAL and hands it to nobody else', async () => {
    const deliver = vi.fn()
    const reply = fakeReply()

    const block = await deliverCode({ mode: 'MANUAL', secret: SECRET, reply, deliver })

    expect(block).toEqual({ mode: 'MANUAL', invitationCode: SECRET })
    expect(deliver).not.toHaveBeenCalled()
    expect(reply.headers['cache-control']).toBe('no-store, private')
  })

  it('hands the code to the provider in EMAIL and returns none', async () => {
    const deliver = vi.fn(async () => {})
    const reply = fakeReply()

    const block = await deliverCode({
      mode: 'EMAIL',
      secret: SECRET,
      reply,
      deliver,
      message: { purpose: 'TEAM_INVITATION', email: 'new@example.com' },
    })

    expect(block).toEqual({ mode: 'EMAIL', invitationCode: null })
    expect(deliver).toHaveBeenCalledWith({
      purpose: 'TEAM_INVITATION',
      email: 'new@example.com',
      token: SECRET,
    })
    expect(reply.headers['cache-control']).toBe('no-store, private')
    expect(JSON.stringify(block)).not.toContain(SECRET)
  })
})
