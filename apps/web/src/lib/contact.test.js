/**
 * The company's channels hold together: every link goes where its name says,
 * every name holds the words a visitor sees, and the structured data says the
 * same as the links.
 *
 * @module lib/contact.test
 */

import { describe, expect, it } from 'vitest'

import {
  BRAND_NAME,
  CONTACT_CHANNELS,
  CONTACT_EMAIL,
  CONTACT_PHONE_E164,
  FACEBOOK_URL,
  INSTAGRAM_URL,
  RESERVE_ON_WHATSAPP_LABEL,
  RESERVE_ON_WHATSAPP_NAME,
  WHATSAPP_URL,
  organizationJsonLd,
  pageLabel,
  reserveMessage,
  reserveOnWhatsAppUrl,
} from './contact.js'

describe('the company’s channels', () => {
  it('writes the name as it is written everywhere', () => {
    expect(BRAND_NAME).toBe('The Desi Events')
  })

  it('lists email, phone, WhatsApp, Facebook and Instagram, in that order', () => {
    expect(CONTACT_CHANNELS.map((channel) => [channel.kind, channel.href])).toEqual([
      ['Email', 'mailto:info@thedesievents.com'],
      ['Phone', 'tel:+19726949043'],
      ['WhatsApp', 'https://wa.me/19726949043'],
      ['Facebook', 'https://www.facebook.com/the.desievents'],
      ['Instagram', 'https://www.instagram.com/the.desievents'],
    ])
  })

  it('names each footer link for where it goes, holding the words a visitor sees', () => {
    expect(CONTACT_CHANNELS.map((channel) => channel.label)).toEqual([
      'Email info@thedesievents.com',
      'Call +1 972 694 9043',
      'WhatsApp +1 972 694 9043',
      'The Desi Events on Facebook',
      'The Desi Events on Instagram',
    ])

    for (const channel of CONTACT_CHANNELS) {
      expect(channel.label).toContain(channel.text)
    }
  })

  it('names each contact-page link with the address it shows', () => {
    for (const channel of CONTACT_CHANNELS) {
      expect(pageLabel(channel) ?? channel.address).toContain(channel.address)
    }
    expect(CONTACT_CHANNELS.map(pageLabel)).toEqual([
      'Email info@thedesievents.com',
      'Call +1 972 694 9043',
      'WhatsApp +1 972 694 9043',
      undefined,
      undefined,
    ])
  })

  it('carries only https, mailto and tel addresses, with nothing in a query', () => {
    for (const { href } of CONTACT_CHANNELS) {
      const url = new URL(href)

      expect(['https:', 'mailto:', 'tel:']).toContain(url.protocol)
      expect(url.search).toBe('')
      expect(url.hash).toBe('')
    }
  })

  it('is frozen, so no page can change what another shows', () => {
    expect(Object.isFrozen(CONTACT_CHANNELS)).toBe(true)
    expect(CONTACT_CHANNELS.every((channel) => Object.isFrozen(channel))).toBe(true)
  })
})

describe('organizationJsonLd', () => {
  it('says the same as the links, and nothing they do not, beside the logo', () => {
    expect(organizationJsonLd('https://example.test')).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'The Desi Events',
      url: 'https://thedesievents.com',
      logo: 'https://example.test/brand/logo-square-512.png',
      email: CONTACT_EMAIL,
      telephone: CONTACT_PHONE_E164,
      sameAs: [FACEBOOK_URL, INSTAGRAM_URL],
    })
  })

  it('names the logo at the deployment’s own origin, absolutely, whatever path it is given', () => {
    expect(organizationJsonLd('http://127.0.0.1:3000').logo).toBe(
      'http://127.0.0.1:3000/brand/logo-square-512.png',
    )
    expect(organizationJsonLd(new URL('https://www.example.test/some/page')).logo).toBe(
      'https://www.example.test/brand/logo-square-512.png',
    )
  })
})

describe('Reserve on WhatsApp', () => {
  const event = {
    title: 'Raga Night',
    startsAt: '2026-11-07T01:30:00.000Z',
    timezone: 'America/Chicago',
    venue: { name: 'Stafford Centre', city: 'Houston' },
  }

  it('opens the company’s own WhatsApp chat with the event’s title, day and place', () => {
    expect(reserveMessage(event)).toBe(
      'Hi! I\'d like to reserve tickets for "Raga Night" on Friday, November 6 at Stafford Centre, Houston.',
    )
    expect(reserveOnWhatsAppUrl(event)).toBe(
      `${WHATSAPP_URL}?text=Hi!%20I'd%20like%20to%20reserve%20tickets%20for%20%22Raga%20Night%22%20on%20Friday%2C%20November%206%20at%20Stafford%20Centre%2C%20Houston.`,
    )
    expect(new URL(reserveOnWhatsAppUrl(event)).searchParams.get('text')).toBe(
      reserveMessage(event),
    )
  })

  it('reads the day in the venue’s zone, not the visitor’s or UTC', () => {
    expect(reserveMessage({ ...event, timezone: 'UTC' })).toContain('on Saturday, November 7 at')
  })

  it('encodes a title with an ampersand or a hash, so the message cannot be cut short', () => {
    const url = new URL(reserveOnWhatsAppUrl({ ...event, title: 'Dandiya & Garba #2' }))

    expect(url.searchParams.get('text')).toContain('"Dandiya & Garba #2"')
    expect(url.hash).toBe('')
  })

  it('has an accessible name that holds its visible words and says it opens WhatsApp', () => {
    expect(RESERVE_ON_WHATSAPP_LABEL).toBe('Reserve on WhatsApp')
    expect(RESERVE_ON_WHATSAPP_NAME.startsWith(RESERVE_ON_WHATSAPP_LABEL)).toBe(true)
    expect(RESERVE_ON_WHATSAPP_NAME).toMatch(/opens WhatsApp/u)
  })
})
