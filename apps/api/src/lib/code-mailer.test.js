/**
 * The code mailer: each show-once code becomes the letter for its purpose,
 * addressed to the person it is bound to, naming the page where it is typed
 * and never linking it; anything else fails closed and sends nothing.
 */

import { describe, expect, it, vi } from 'vitest'

import {
  CODE_JOIN_PATHS,
  codeMailerFromEnv,
  composeCodeLetter,
  createCodeMailer,
} from './code-mailer.js'

const WEB_ORIGIN = 'https://desi-event.example'
const CODE = 'Abcdefghijklmnopqrstuvwxyz0123456789_-ABCDEFG'
const EXPIRES_AT = '2026-10-29T18:00:00.000Z'

const organizerMessage = {
  purpose: 'ORGANIZER_INVITATION',
  email: 'priya@example.com',
  token: CODE,
  organizationName: 'સંગીત સંધ્યા Arts',
  expiresAt: EXPIRES_AT,
  note: 'Welcome aboard.\nWe spoke on the phone.',
  inviterName: 'Anil',
}

const teamMessage = {
  purpose: 'TEAM_INVITATION',
  email: 'ravi@example.com',
  token: CODE,
  organizationName: 'Garba Nights',
  organizationVerified: false,
  role: 'FINANCE',
  expiresAt: EXPIRES_AT,
}

const transferMessage = {
  purpose: 'ticket-transfer',
  to: 'meera@example.com',
  token: CODE,
  expiresAt: EXPIRES_AT,
  message: 'Enjoy the show!',
}

/**
 * A provider that records what it was handed.
 *
 * @returns {{send: Function, sent: object[]}} The provider.
 */
function recordingProvider() {
  const sent = []

  return {
    sent,
    send: vi.fn(async (message) => {
      sent.push(message)

      return { id: `message-${sent.length}` }
    }),
  }
}

describe('CODE_JOIN_PATHS', () => {
  it('names one join page for each of the three purposes, and no other', () => {
    expect(CODE_JOIN_PATHS).toEqual({
      ORGANIZER_INVITATION: '/account/organizations/new',
      TEAM_INVITATION: '/account/invitations',
      'ticket-transfer': '/tickets/accept',
    })
    expect(Object.isFrozen(CODE_JOIN_PATHS)).toBe(true)
  })
})

describe('composeCodeLetter', () => {
  it('writes the organiser invitation to the invited address, with the code alone on its line', () => {
    const letter = composeCodeLetter(organizerMessage, WEB_ORIGIN)

    expect(letter.to).toBe('priya@example.com')
    expect(letter.subject).toBe('Your organiser invitation from The Desi Events')
    expect(letter.text).toContain(`\n    ${CODE}\n`)
    expect(letter.text).toContain('1. Open https://desi-event.example/account/organizations/new\n')
    expect(letter.text).toContain('"સંગીત સંધ્યા Arts"')
    expect(letter.text).toContain('29 October 2026, 18:00 UTC')
    expect(letter.text).toContain('A note from Anil of the team at The Desi Events:')
    expect(letter.text).toContain('> Welcome aboard.\n> We spoke on the phone.')
  })

  it('writes the team invitation to the invited address, and says when the organisation is unverified', () => {
    const letter = composeCodeLetter(teamMessage, WEB_ORIGIN)

    expect(letter.to).toBe('ravi@example.com')
    expect(letter.subject).toBe('You are invited to join Garba Nights on The Desi Events')
    expect(letter.text).toContain('as a member of its finance team.')
    expect(letter.text).toContain(
      'This organisation has not been verified by the team at The Desi Events.',
    )
    expect(letter.text).toContain('1. Open https://desi-event.example/account/invitations\n')
    expect(letter.text).toContain(`\n    ${CODE}\n`)

    const verified = composeCodeLetter({ ...teamMessage, organizationVerified: true }, WEB_ORIGIN)

    expect(verified.text).not.toContain('has not been verified')
  })

  it('names the events a door role is invited for, by title (ADR 0019)', () => {
    const letter = composeCodeLetter(
      { ...teamMessage, role: 'SCANNER', events: [{ id: 'evt_1', title: 'Garba Night' }] },
      WEB_ORIGIN,
    )

    expect(letter.text).toContain('as a ticket scanner.')
    expect(letter.text).toContain(
      'You are invited to check tickets at this event:\n  - "Garba Night"\n',
    )
    expect(letter.text).not.toContain('evt_1')
    expect(composeCodeLetter(teamMessage, WEB_ORIGIN).text).not.toContain('check tickets')
  })

  it('writes the ticket transfer to the recipient, quoting the sender as the sender', () => {
    const letter = composeCodeLetter(transferMessage, WEB_ORIGIN)

    expect(letter.to).toBe('meera@example.com')
    expect(letter.subject).toBe('A ticket has been offered to you on The Desi Events')
    expect(letter.text).toContain('1. Open https://desi-event.example/tickets/accept\n')
    expect(letter.text).toContain(
      'Message from the sender (written by them, not by The Desi Events):\n> Enjoy the show!',
    )
    expect(letter.text).toContain(`\n    ${CODE}\n`)
  })

  it('never puts the code in an address: every URL in a letter is the bare join page', () => {
    for (const message of [organizerMessage, teamMessage, transferMessage]) {
      const { text } = composeCodeLetter(message, WEB_ORIGIN)
      const urls = text.match(/https?:\/\/\S+/gu) ?? []

      expect(urls).toHaveLength(1)
      expect(urls[0]).not.toContain(CODE)
      expect(urls[0]).not.toMatch(/[?#]/u)
      // The code appears once, on its own line.
      expect(text.split(CODE)).toHaveLength(2)
    }
  })

  it('refuses a purpose it has no letter for, including the account links', () => {
    for (const purpose of [
      'EMAIL_VERIFICATION',
      'PASSWORD_RESET',
      'toString',
      '__proto__',
      undefined,
    ]) {
      expect(() => composeCodeLetter({ ...teamMessage, purpose }, WEB_ORIGIN)).toThrow(
        /There is no letter for the purpose/u,
      )
    }

    expect(() => composeCodeLetter(undefined, WEB_ORIGIN)).toThrow(TypeError)
  })

  it('refuses a letter missing a field it needs, rather than writing a blank', () => {
    expect(() =>
      composeCodeLetter({ ...organizerMessage, organizationName: undefined }, WEB_ORIGIN),
    ).toThrow(TypeError)
    expect(() =>
      composeCodeLetter({ ...teamMessage, organizationVerified: undefined }, WEB_ORIGIN),
    ).toThrow(TypeError)
    expect(() =>
      composeCodeLetter({ ...transferMessage, expiresAt: undefined }, WEB_ORIGIN),
    ).toThrow(TypeError)
    expect(() => composeCodeLetter({ ...transferMessage, token: 'short' }, WEB_ORIGIN)).toThrow(
      TypeError,
    )
  })

  it('refuses an origin that is not https, except on this machine', () => {
    expect(() => composeCodeLetter(teamMessage, 'http://desi-event.example')).toThrow(/https/u)
    expect(composeCodeLetter(teamMessage, 'http://localhost:3000').text).toContain(
      '1. Open http://localhost:3000/account/invitations\n',
    )
  })
})

describe('createCodeMailer', () => {
  it('hands the provider the letter: address, subject and text, and nothing else', async () => {
    const provider = recordingProvider()
    const deliver = createCodeMailer({ provider, webOrigin: WEB_ORIGIN })

    await deliver(teamMessage)

    expect(provider.sent).toHaveLength(1)
    expect(Object.keys(provider.sent[0]).sort()).toEqual(['subject', 'text', 'to'])
    expect(provider.sent[0]).toEqual(composeCodeLetter(teamMessage, WEB_ORIGIN))
  })

  it('sends nothing for a message it cannot write, and rejects so the route withdraws the code', async () => {
    const provider = recordingProvider()
    const deliver = createCodeMailer({ provider, webOrigin: WEB_ORIGIN })

    await expect(deliver({ ...teamMessage, purpose: 'PASSWORD_RESET' })).rejects.toThrow(TypeError)
    await expect(deliver({ ...teamMessage, role: undefined })).rejects.toThrow(TypeError)
    expect(provider.send).not.toHaveBeenCalled()
  })

  it('passes a provider failure on to the caller', async () => {
    const failure = Object.assign(new Error('The mail server did not accept the message'), {
      code: 'SEND_FAILED',
    })
    const provider = {
      send: vi.fn(async () => {
        throw failure
      }),
    }
    const deliver = createCodeMailer({ provider, webOrigin: WEB_ORIGIN })

    await expect(deliver(transferMessage)).rejects.toBe(failure)
  })

  it('refuses to be built without a provider or with an unusable origin', () => {
    expect(() => createCodeMailer({ provider: null, webOrigin: WEB_ORIGIN })).toThrow(
      /email provider/u,
    )
    expect(() => createCodeMailer({ provider: {}, webOrigin: WEB_ORIGIN })).toThrow(
      /email provider/u,
    )
    expect(() =>
      createCodeMailer({ provider: recordingProvider(), webOrigin: 'http://desi-event.example' }),
    ).toThrow(TypeError)
  })
})

describe('codeMailerFromEnv', () => {
  const smtpEnv = {
    DELIVERY_MODE: 'EMAIL',
    SMTP_HOST: 'smtp.desi-event.example',
    SMTP_PORT: 587,
    SMTP_SECURE: false,
    SMTP_REQUIRE_TLS: true,
    SMTP_USER: 'mailer',
    SMTP_PASSWORD: 'not-a-real-password',
    SMTP_FROM: 'no-reply@desi-event.example',
    WEB_ORIGIN,
  }

  it('builds nothing unless the deployment asked for EMAIL and named a server', () => {
    const createProvider = vi.fn(() => recordingProvider())

    expect(codeMailerFromEnv({}, { createProvider })).toBeUndefined()
    expect(codeMailerFromEnv(undefined, { createProvider })).toBeUndefined()
    expect(
      codeMailerFromEnv({ ...smtpEnv, DELIVERY_MODE: 'MANUAL' }, { createProvider }),
    ).toBeUndefined()
    expect(
      codeMailerFromEnv({ ...smtpEnv, DELIVERY_MODE: undefined }, { createProvider }),
    ).toBeUndefined()
    expect(
      codeMailerFromEnv({ ...smtpEnv, SMTP_HOST: undefined }, { createProvider }),
    ).toBeUndefined()
    expect(createProvider).not.toHaveBeenCalled()
  })

  it('passes the SMTP settings to the provider, with credentials only when a user is named', async () => {
    const provider = recordingProvider()
    const createProvider = vi.fn(() => provider)
    const deliver = codeMailerFromEnv(smtpEnv, { createProvider })

    expect(createProvider).toHaveBeenCalledWith({
      host: 'smtp.desi-event.example',
      port: 587,
      secure: false,
      requireTLS: true,
      auth: { user: 'mailer', pass: 'not-a-real-password' },
      from: 'no-reply@desi-event.example',
    })

    await deliver(organizerMessage)
    expect(provider.sent[0].to).toBe('priya@example.com')

    codeMailerFromEnv(
      { ...smtpEnv, SMTP_USER: undefined, SMTP_PASSWORD: undefined },
      { createProvider },
    )
    expect(createProvider.mock.calls[1][0]).not.toHaveProperty('auth')
  })

  it('builds the SMTP adapter by default', () => {
    expect(typeof codeMailerFromEnv(smtpEnv)).toBe('function')
  })
})
