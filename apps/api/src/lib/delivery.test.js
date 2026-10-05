/**
 * Delivery mode: the truth table, and the headers that keep a show-once code
 * out of every cache.
 */

import { randomBytes } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import {
  DELIVERY_FAILED_SENTENCE,
  DELIVERY_MODES,
  RECIPIENT_DAILY_LIMIT_SENTENCE,
  addressCandidates,
  assertRecipientDailyCap,
  deliverCode,
  deliverOrWithdraw,
  isSameAddress,
  noStore,
  resolveDeliveryMode,
} from './delivery.js'

const provider = async () => {}

describe('resolveDeliveryMode', () => {
  it('is MANUAL when nothing is named and no provider is wired in, which is the default', () => {
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
    // And says what to set to fix it.
    expect(() => resolveDeliveryMode({ env: { DELIVERY_MODE: 'EMAIL' } })).toThrow(
      /Set SMTP_HOST and SMTP_FROM/u,
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

/**
 * A logger double that records every line.
 *
 * @returns {{lines: Array<{level: string, fields: object, message: string}>, warn: Function, error: Function, info: Function}} The double.
 */
function recordingLog() {
  const lines = []
  const at = (level) => (fields, message) => lines.push({ level, fields, message })

  return { lines, warn: at('warn'), error: at('error'), info: at('info') }
}

describe('deliverOrWithdraw', () => {
  const SECRET = randomBytes(32).toString('base64url')
  const MESSAGE = { purpose: 'ORGANIZER_INVITATION', email: 'new@example.com' }

  it('never sends or withdraws anything in MANUAL', async () => {
    const deliver = vi.fn()
    const withdraw = vi.fn()

    const block = await deliverOrWithdraw({
      mode: 'MANUAL',
      secret: SECRET,
      reply: fakeReply(),
      deliver,
      message: MESSAGE,
      withdraw,
    })

    expect(block).toEqual({ mode: 'MANUAL', invitationCode: SECRET })
    expect(deliver).not.toHaveBeenCalled()
    expect(withdraw).not.toHaveBeenCalled()
  })

  it('sends in EMAIL, and withdraws nothing when the send succeeds', async () => {
    const deliver = vi.fn(async () => {})
    const withdraw = vi.fn()

    const block = await deliverOrWithdraw({
      mode: 'EMAIL',
      secret: SECRET,
      reply: fakeReply(),
      deliver,
      message: MESSAGE,
      withdraw,
    })

    expect(block).toEqual({ mode: 'EMAIL', invitationCode: null })
    expect(deliver).toHaveBeenCalledOnce()
    expect(withdraw).not.toHaveBeenCalled()
  })

  it('withdraws once and answers 503 DELIVERY_FAILED when the send fails', async () => {
    const withdraw = vi.fn(async () => {})
    const log = recordingLog()

    const error = await deliverOrWithdraw({
      mode: 'EMAIL',
      secret: SECRET,
      reply: fakeReply(),
      deliver: async () => {
        throw Object.assign(new Error(`refused ${SECRET} for new@example.com`), {
          code: 'SEND_FAILED',
        })
      },
      message: MESSAGE,
      withdraw,
      log,
    }).catch((caught) => caught)

    expect(withdraw).toHaveBeenCalledOnce()
    expect(error).toMatchObject({
      statusCode: 503,
      code: 'DELIVERY_FAILED',
      message: DELIVERY_FAILED_SENTENCE,
      // Reaches the caller in production too.
      expose: true,
    })
    expect(log.lines).toEqual([
      expect.objectContaining({
        level: 'warn',
        fields: { purpose: 'ORGANIZER_INVITATION', deliveryMode: 'EMAIL', reason: 'SEND_FAILED' },
      }),
    ])
    expect(JSON.stringify(log.lines)).not.toContain(SECRET)
    expect(JSON.stringify(log.lines)).not.toContain('new@example.com')
  })

  it('still answers 503, and logs it, when the withdrawal fails too', async () => {
    const log = recordingLog()

    const error = await deliverOrWithdraw({
      mode: 'EMAIL',
      secret: SECRET,
      reply: fakeReply(),
      deliver: async () => {
        throw new Error('connection refused')
      },
      message: MESSAGE,
      withdraw: async () => {
        throw Object.assign(new Error('database gone'), { code: 'P1001' })
      },
      log,
      failureMessage: 'The offer was withdrawn.',
    }).catch((caught) => caught)

    expect(error).toMatchObject({ statusCode: 503, message: 'The offer was withdrawn.' })
    expect(log.lines.map((line) => line.level)).toEqual(['error', 'warn'])
    expect(log.lines[0].fields.reason).toBe('P1001')
    // A failure with no code of its own is logged as SEND_FAILED, not its prose.
    expect(log.lines[1].fields.reason).toBe('SEND_FAILED')
    expect(JSON.stringify(log.lines)).not.toContain(SECRET)
  })
})

describe('assertRecipientDailyCap', () => {
  const NOW = new Date('2026-10-01T12:00:00.000Z')
  const hoursAgo = (hours) => ({ createdAt: new Date(NOW.getTime() - hours * 3_600_000) })

  /**
   * A database double answering with the rows a day holds. A row names no
   * address unless the test gives one; it is then `a@example.com`.
   *
   * @param {object[]} invitations Team invitations sent by email.
   * @param {object[]} transfers Ticket transfers.
   * @returns {object} The double, recording the queries.
   */
  function database(invitations, transfers) {
    const calls = []

    return {
      calls,
      invitation: {
        findMany: async (query) => {
          calls.push(['invitation', query])
          return invitations.map((row) => ({ email: 'a@example.com', ...row }))
        },
      },
      ticketTransfer: {
        findMany: async (query) => {
          calls.push(['ticketTransfer', query])
          return transfers.map((row) => ({ toEmail: 'a@example.com', ...row }))
        },
      },
    }
  }

  it('lets a second and a third code through', async () => {
    await expect(
      assertRecipientDailyCap(database([hoursAgo(1)], [hoursAgo(2)]), {
        email: 'a@example.com',
        now: NOW,
      }),
    ).resolves.toBeUndefined()
  })

  it('refuses a fourth within a day, counting both kinds, with the seconds until one frees up', async () => {
    const error = await assertRecipientDailyCap(
      database([hoursAgo(20), hoursAgo(1)], [hoursAgo(3)]),
      { email: 'a@example.com', now: NOW },
    ).catch((caught) => caught)

    expect(error).toMatchObject({
      statusCode: 429,
      code: 'RECIPIENT_DAILY_LIMIT',
      message: RECIPIENT_DAILY_LIMIT_SENTENCE,
      // The oldest, sent twenty hours ago, is a day old in four hours.
      retryAfterSeconds: 4 * 3600,
    })
  })

  it('asks only for the last day, emailed team invitations, and any case of the address', async () => {
    const db = database([], [])

    await assertRecipientDailyCap(db, { email: 'a@example.com', now: NOW })

    const since = new Date(NOW.getTime() - 24 * 3_600_000)

    expect(db.calls).toEqual([
      [
        'invitation',
        {
          where: {
            email: { equals: 'a@example.com', mode: 'insensitive' },
            deliveryMode: 'EMAIL',
            createdAt: { gte: since },
          },
          select: { createdAt: true, email: true },
        },
      ],
      [
        'ticketTransfer',
        {
          where: {
            toEmail: { equals: 'a@example.com', mode: 'insensitive' },
            createdAt: { gte: since },
          },
          select: { createdAt: true, toEmail: true },
        },
      ],
    ])
  })

  it('counts the address itself in any case, and never a look-alike the query also found', async () => {
    // What PostgreSQL answers for `j_doe@example.com`: the `_` matched any one
    // character, so `jxdoe@example.com`'s three codes came back too.
    const lookAlike = 'jxdoe@example.com'
    const db = database(
      [
        { ...hoursAgo(1), email: lookAlike },
        { ...hoursAgo(2), email: lookAlike },
        { ...hoursAgo(3), email: 'J_Doe@Example.com' },
      ],
      [{ ...hoursAgo(4), toEmail: lookAlike }],
    )

    await expect(
      assertRecipientDailyCap(db, { email: 'j_doe@example.com', now: NOW }),
    ).resolves.toBeUndefined()

    // Three to the address itself, whatever their case, are the cap.
    const own = database(
      [
        { ...hoursAgo(1), email: 'j_doe@example.com' },
        { ...hoursAgo(2), email: 'J_DOE@example.com' },
        { ...hoursAgo(3), email: lookAlike },
      ],
      [{ ...hoursAgo(4), toEmail: 'j_doe@example.com' }],
    )

    await expect(
      assertRecipientDailyCap(own, { email: 'j_doe@example.com', now: NOW }),
    ).rejects.toMatchObject({ statusCode: 429, code: 'RECIPIENT_DAILY_LIMIT' })
  })
})

describe('isSameAddress', () => {
  it('ignores case and nothing else', () => {
    expect(isSameAddress('J_Doe@Example.com', 'j_doe@example.com')).toBe(true)
    expect(isSameAddress('jxdoe@example.com', 'j_doe@example.com')).toBe(false)
    expect(isSameAddress('j_doe@example.com ', 'j_doe@example.com')).toBe(false)
    expect(isSameAddress(null, 'j_doe@example.com')).toBe(false)
    expect(isSameAddress(undefined, undefined)).toBe(false)
  })

  it('is what addressCandidates only narrows towards', () => {
    expect(addressCandidates('j_doe@example.com')).toEqual({
      equals: 'j_doe@example.com',
      mode: 'insensitive',
    })
  })
})
