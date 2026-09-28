import { describe, expect, it } from 'vitest'

import {
  EVENT_CONTENT_LIMITS,
  SOCIAL_HOSTS,
  SOCIAL_NETWORKS,
  SOCIAL_NETWORK_LABELS,
  dressCodeSchema,
  eventDirectionsSchema,
  eventFaqSchema,
  eventPerformersSchema,
  eventRunningOrderSchema,
  eventSocialLinksSchema,
  eventSponsorsSchema,
  httpsUrlSchema,
  isAllowedSocialHost,
  isHttpsUrl,
  publicEmailSchema,
  publicPhoneSchema,
} from './event-content.js'

/**
 * The paths of every issue a failed parse reported.
 *
 * @param {object} result A `safeParse` result.
 * @returns {string[]} Dotted paths.
 */
function issuePaths(result) {
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'))
}

describe('questions people ask', () => {
  const item = { question: 'Is there parking?', answer: 'Yes, on the north side.' }

  it('allows thirty and refuses a thirty-first', () => {
    expect(eventFaqSchema.safeParse(Array.from({ length: 30 }, () => item)).success).toBe(true)
    expect(eventFaqSchema.safeParse(Array.from({ length: 31 }, () => item)).success).toBe(false)
  })

  it('bounds a question at 200 characters and an answer at 2,000', () => {
    expect(eventFaqSchema.safeParse([{ ...item, question: 'q'.repeat(200) }]).success).toBe(true)
    expect(eventFaqSchema.safeParse([{ ...item, question: 'q'.repeat(201) }]).success).toBe(false)
    expect(eventFaqSchema.safeParse([{ ...item, answer: 'a'.repeat(2000) }]).success).toBe(true)
    expect(eventFaqSchema.safeParse([{ ...item, answer: 'a'.repeat(2001) }]).success).toBe(false)
  })

  it('refuses a question without an answer and an unknown key', () => {
    expect(issuePaths(eventFaqSchema.safeParse([{ question: 'Why?', answer: '  ' }]))).toEqual([
      '0.answer',
    ])
    expect(eventFaqSchema.safeParse([{ ...item, extra: 1 }]).success).toBe(false)
  })
})

describe('the line-up', () => {
  it('allows 64 performers, a 500-character name and a 600-character bio', () => {
    const many = Array.from({ length: 64 }, (_, index) => ({ name: `Act ${index}` }))

    expect(eventPerformersSchema.safeParse(many).success).toBe(true)
    expect(eventPerformersSchema.safeParse([...many, { name: 'One more' }]).success).toBe(false)
    expect(eventPerformersSchema.safeParse([{ name: 'n'.repeat(500) }]).success).toBe(true)
    expect(eventPerformersSchema.safeParse([{ name: 'n'.repeat(501) }]).success).toBe(false)
    expect(eventPerformersSchema.safeParse([{ name: 'A', bio: 'b'.repeat(600) }]).success).toBe(
      true,
    )
    expect(eventPerformersSchema.safeParse([{ name: 'A', bio: 'b'.repeat(601) }]).success).toBe(
      false,
    )
    expect(eventPerformersSchema.safeParse([{ name: 'A', role: 'r'.repeat(81) }]).success).toBe(
      false,
    )
  })

  it('reads a blank role or bio as none', () => {
    expect(eventPerformersSchema.parse([{ name: ' Asha ', role: ' ', bio: '' }])).toEqual([
      { name: 'Asha', role: null, bio: null },
    ])
  })
})

describe('the running order', () => {
  it('takes 24-hour HH:mm from 00:00 to 23:59', () => {
    for (const time of ['00:00', '07:05', '19:30', '23:59']) {
      expect(eventRunningOrderSchema.safeParse([{ time, title: 'Doors' }]).success, time).toBe(true)
    }
  })

  it('refuses 7:30pm, 24:00 and 19:60', () => {
    for (const time of ['7:30pm', '24:00', '19:60', '7:30', '']) {
      expect(eventRunningOrderSchema.safeParse([{ time, title: 'Doors' }]).success, time).toBe(
        false,
      )
    }
  })

  it('allows forty slots and refuses a forty-first', () => {
    const slot = { time: '19:00', title: 'Set' }

    expect(eventRunningOrderSchema.safeParse(Array.from({ length: 40 }, () => slot)).success).toBe(
      true,
    )
    expect(eventRunningOrderSchema.safeParse(Array.from({ length: 41 }, () => slot)).success).toBe(
      false,
    )
  })
})

describe('links are https only', () => {
  it.each(['http://example.com', 'javascript:alert(1)', 'data:text/html,hi', '//example.com'])(
    'refuses %s',
    (href) => {
      expect(isHttpsUrl(href)).toBe(false)
      expect(httpsUrlSchema.safeParse(href).success).toBe(false)
      expect(eventSponsorsSchema.safeParse([{ name: 'Sponsor', url: href }]).success).toBe(false)
      expect(eventSocialLinksSchema.safeParse({ website: href }).success).toBe(false)
    },
  )

  it('accepts an https sponsor, and a blank one as none', () => {
    expect(
      eventSponsorsSchema.parse([{ name: 'Chai Co', url: 'https://chai.example', level: 'Gold' }]),
    ).toEqual([{ name: 'Chai Co', url: 'https://chai.example', level: 'Gold' }])
    expect(eventSponsorsSchema.parse([{ name: 'Chai Co', url: '' }])).toEqual([
      { name: 'Chai Co', url: null },
    ])
  })
})

describe('social links name the network they point at', () => {
  it('refuses an instagram link on another host', () => {
    expect(
      issuePaths(eventSocialLinksSchema.safeParse({ instagram: 'https://evil.example/instagram' })),
    ).toEqual(['instagram'])
  })

  it('accepts each network on its own hosts', () => {
    expect(
      eventSocialLinksSchema.safeParse({ instagram: 'https://www.instagram.com/x' }).success,
    ).toBe(true)
    expect(
      eventSocialLinksSchema.safeParse({ whatsapp: 'https://wa.me/15551234567' }).success,
    ).toBe(true)
    expect(
      eventSocialLinksSchema.safeParse({ whatsapp: 'https://chat.whatsapp.com/AbCd' }).success,
    ).toBe(true)
    expect(eventSocialLinksSchema.safeParse({ x: 'https://twitter.com/desi' }).success).toBe(true)
    expect(eventSocialLinksSchema.safeParse({ youtube: 'https://youtu.be/abc' }).success).toBe(true)
    expect(eventSocialLinksSchema.safeParse({ facebook: 'https://fb.com/desi' }).success).toBe(true)
    expect(eventSocialLinksSchema.safeParse({ website: 'https://any.example/page' }).success).toBe(
      true,
    )
  })

  it('refuses an unknown network rather than dropping it', () => {
    expect(eventSocialLinksSchema.safeParse({ tiktok: 'https://tiktok.com/@x' }).success).toBe(
      false,
    )
  })

  it('checks every network the page lists', () => {
    for (const network of SOCIAL_NETWORKS) {
      expect(SOCIAL_NETWORK_LABELS[network]).toBeTruthy()
      if (network !== 'website') expect(SOCIAL_HOSTS[network].length).toBeGreaterThan(0)
    }
    expect(isAllowedSocialHost('instagram', 'https://INSTAGRAM.com/x')).toBe(true)
    expect(isAllowedSocialHost('unknown', 'https://example.com')).toBe(false)
  })
})

describe('public contact and the text fields', () => {
  it('lower-cases the email and reads a blank one as none', () => {
    expect(publicEmailSchema.parse('  Box.Office@Example.COM ')).toBe('box.office@example.com')
    expect(publicEmailSchema.parse('')).toBeNull()
    expect(publicEmailSchema.safeParse('not an address').success).toBe(false)
  })

  it('reuses the platform phone rule', () => {
    expect(publicPhoneSchema.parse('+1 (555) 010-2000')).toBe('+1 (555) 010-2000')
    expect(publicPhoneSchema.safeParse('call me').success).toBe(false)
    expect(publicPhoneSchema.parse(' ')).toBeNull()
  })

  it('bounds the dress code and the directions', () => {
    expect(dressCodeSchema.safeParse('d'.repeat(EVENT_CONTENT_LIMITS.dressCode)).success).toBe(true)
    expect(dressCodeSchema.safeParse('d'.repeat(EVENT_CONTENT_LIMITS.dressCode + 1)).success).toBe(
      false,
    )
    expect(eventDirectionsSchema.safeParse('d'.repeat(2001)).success).toBe(false)
    expect(eventDirectionsSchema.parse('   ')).toBeNull()
  })
})
