import { describe, expect, it } from 'vitest'

import {
  TEAM_ROLE_PHRASES,
  assertJoinUrl,
  formatLetterExpiry,
  organizerInvitationLetter,
  teamInvitationLetter,
  ticketTransferLetter,
} from './code-letters.js'

/** A code shaped exactly as `issueToken` mints one: 43 url-safe characters. */
const CODE = 'Ab3_dE6-gH9iJ2kL5mN8oP1qR4sT7uV0wX3yZ6aB9cD'

const EXPIRES = '2026-10-29T18:00:00.000Z'

const ORGANIZER = {
  code: CODE,
  email: 'new-organiser@example.com',
  organizationName: 'Kathiawar Folk Nights',
  expiresAt: EXPIRES,
  joinUrl: 'https://desi-event.example/account/organizations/new',
}

const TEAM = {
  code: CODE,
  email: 'door@example.com',
  organizationName: 'Rangoli Collective',
  organizationVerified: true,
  role: 'STAFF',
  expiresAt: EXPIRES,
  joinUrl: 'https://desi-event.example/account/invitations',
}

const TRANSFER = {
  code: CODE,
  to: 'friend@example.com',
  expiresAt: EXPIRES,
  joinUrl: 'https://desi-event.example/tickets/accept',
}

/** Every letter, built from its minimal fields. */
const LETTERS = [
  ['organiser invitation', () => organizerInvitationLetter(ORGANIZER)],
  ['team invitation', () => teamInvitationLetter(TEAM)],
  ['ticket transfer', () => ticketTransferLetter(TRANSFER)],
]

describe('every letter', () => {
  it.each(LETTERS)(
    '%s: carries the code exactly once, alone on an indented line',
    (_name, build) => {
      const { text } = build()
      const lines = text.split('\n')

      expect(text.split(CODE)).toHaveLength(2)
      expect(lines).toContain(`    ${CODE}`)
      expect(lines.filter((line) => line.includes(CODE))).toEqual([`    ${CODE}`])
    },
  )

  it.each(LETTERS)('%s: names the join page, and no link carries the code', (_name, build) => {
    const { text } = build()

    expect(text).toMatch(/https:\/\/desi-event\.example\/(account|tickets)\//u)
    for (const line of text.split('\n')) {
      if (line.includes('http')) expect(line).not.toContain(CODE)
    }
  })

  it.each(LETTERS)('%s: says until when, in UTC words', (_name, build) => {
    expect(build().text).toContain('until 29 October 2026, 18:00 UTC.')
  })

  it.each(LETTERS)('%s: ends by saying nothing happens unless the code is used', (_name, build) => {
    expect(build().text.trimEnd().split('\n').at(-1)).toBe(
      'If you were not expecting this, you can ignore it. Nothing happens unless the code is used.',
    )
  })
})

describe('organizerInvitationLetter', () => {
  it('says what the invitation does, and that the organisation starts verified', () => {
    const { subject, text } = organizerInvitationLetter(ORGANIZER)

    expect(subject).toBe('Your organiser invitation from The Desi Events')
    expect(text).toContain(
      'The Desi Events team has invited you to run events as the owner of "Kathiawar Folk Nights".',
    )
    expect(text).toContain(
      '2. Sign in, or create an account, with this email address: new-organiser@example.com',
    )
    expect(text).toContain(
      'Your organisation starts verified, because the team at The Desi Events invited you. Each event you create is reviewed by the team before it can be published.',
    )
  })

  it('includes the note only when one was written, quoted under a rule with its author', () => {
    expect(organizerInvitationLetter(ORGANIZER).text).not.toContain('A note from')

    const { text } = organizerInvitationLetter({
      ...ORGANIZER,
      note: 'Welcome aboard.\nCall me with questions.',
      inviterName: 'Anil Administrator',
    })

    expect(text).toContain(
      [
        '----------------------------------------',
        'A note from Anil Administrator of the team at The Desi Events:',
        '> Welcome aboard.',
        '> Call me with questions.',
      ].join('\n'),
    )

    expect(
      organizerInvitationLetter({ ...ORGANIZER, note: 'Hi', inviterName: null }).text,
    ).toContain('A note from the team at The Desi Events:\n> Hi')
  })

  it('keeps a Gujarati name and a Devanagari note in their own script', () => {
    const { text } = organizerInvitationLetter({
      ...ORGANIZER,
      organizationName: 'કાઠિયાવાડ ફોક નાઇટ્સ',
      note: 'आपका स्वागत है',
      inviterName: 'Anil',
    })

    expect(text).toContain('"કાઠિયાવાડ ફોક નાઇટ્સ"')
    expect(text).toContain('> आपका स्वागत है')
  })

  it('cannot let a note pass for the letter: control characters dropped, every line quoted', () => {
    const { text } = organizerInvitationLetter({
      ...ORGANIZER,
      note: 'Line one\r\n\nYour invitation code is:\u0007\n    FAKECODE',
      inviterName: 'Anil',
    })

    expect(text).not.toContain('\u0007')
    expect(text).toContain('> Line one\n>\n> Your invitation code is:\n>     FAKECODE')
    expect(text.split('\n').filter((line) => line === `    ${CODE}`)).toHaveLength(1)
  })

  it.each(['code', 'email', 'organizationName', 'expiresAt', 'joinUrl'])(
    'refuses to be written without %s',
    (field) => {
      expect(() => organizerInvitationLetter({ ...ORGANIZER, [field]: undefined })).toThrow(
        new RegExp(`needs "${field}"`, 'u'),
      )
      expect(() => organizerInvitationLetter({ ...ORGANIZER, [field]: '  ' })).toThrow(TypeError)
    },
  )

  it('refuses a code that is not a url-safe code', () => {
    expect(() => organizerInvitationLetter({ ...ORGANIZER, code: 'has spaces in it ok?' })).toThrow(
      /url-safe/u,
    )
  })
})

describe('teamInvitationLetter', () => {
  it('names the organisation and the role in words', () => {
    const { subject, text } = teamInvitationLetter(TEAM)

    expect(subject).toBe('You are invited to join Rangoli Collective on The Desi Events')
    expect(text).toContain(
      'You have been invited to join "Rangoli Collective" on The Desi Events as a member of its staff.',
    )
    expect(text).not.toContain('has not been verified')
  })

  it('says so when the organisation has not been verified', () => {
    expect(teamInvitationLetter({ ...TEAM, organizationVerified: false }).text).toContain(
      'This organisation has not been verified by the team at The Desi Events.',
    )
  })

  it('has a phrase for every organisation role', () => {
    expect(Object.keys(TEAM_ROLE_PHRASES).sort()).toEqual([
      'ADMIN',
      'EVENT_MANAGER',
      'FINANCE',
      'MANAGER',
      'OWNER',
      'SCANNER',
      'STAFF',
      'VIEWER',
    ])
  })

  it.each([
    'code',
    'email',
    'organizationName',
    'organizationVerified',
    'role',
    'expiresAt',
    'joinUrl',
  ])('refuses to be written without %s', (field) => {
    expect(() => teamInvitationLetter({ ...TEAM, [field]: undefined })).toThrow(TypeError)
  })

  it('refuses a verification flag that is not true or false', () => {
    expect(() => teamInvitationLetter({ ...TEAM, organizationVerified: 'yes' })).toThrow(
      /true or false/u,
    )
  })
})

describe('ticketTransferLetter', () => {
  it('quotes the sender as the sender, not as The Desi Events', () => {
    const { subject, text } = ticketTransferLetter({ ...TRANSFER, message: 'Enjoy the garba!' })

    expect(subject).toBe('A ticket has been offered to you on The Desi Events')
    expect(text).toContain(
      'Message from the sender (written by them, not by The Desi Events):\n> Enjoy the garba!',
    )
    expect(ticketTransferLetter(TRANSFER).text).not.toContain('Message from the sender')
  })

  it.each(['code', 'to', 'expiresAt', 'joinUrl'])('refuses to be written without %s', (field) => {
    expect(() => ticketTransferLetter({ ...TRANSFER, [field]: null })).toThrow(TypeError)
  })
})

describe('assertJoinUrl', () => {
  it('accepts https anywhere, and http only on this machine', () => {
    expect(assertJoinUrl('https://desi-event.example/account/invitations')).toBe(
      'https://desi-event.example/account/invitations',
    )
    expect(assertJoinUrl('http://localhost:3000/tickets/accept')).toBe(
      'http://localhost:3000/tickets/accept',
    )
    expect(assertJoinUrl('http://127.0.0.1:3000/tickets/accept')).toBe(
      'http://127.0.0.1:3000/tickets/accept',
    )
    expect(() => assertJoinUrl('http://desi-event.example/tickets/accept')).toThrow(/https/u)
    expect(() => assertJoinUrl('ftp://desi-event.example/')).toThrow(TypeError)
  })

  it('refuses a query or a fragment, so nothing can ride along', () => {
    expect(() => assertJoinUrl('https://desi-event.example/accept?code=x')).toThrow(/query/u)
    expect(() => assertJoinUrl('https://desi-event.example/accept?')).toThrow(/query/u)
    expect(() => assertJoinUrl('https://desi-event.example/accept#x')).toThrow(/fragment/u)
  })

  it('refuses a relative or missing address', () => {
    expect(() => assertJoinUrl('/account/invitations')).toThrow(/absolute/u)
    expect(() => assertJoinUrl('')).toThrow(TypeError)
    expect(() => assertJoinUrl(undefined)).toThrow(TypeError)
  })
})

describe('formatLetterExpiry', () => {
  it('writes an instant in UTC words', () => {
    expect(formatLetterExpiry('2026-01-05T07:04:00.000Z')).toBe('5 January 2026, 07:04 UTC')
    expect(formatLetterExpiry(new Date('2026-12-31T23:59:00.000Z'))).toBe(
      '31 December 2026, 23:59 UTC',
    )
    expect(() => formatLetterExpiry('not a date')).toThrow(TypeError)
  })
})
