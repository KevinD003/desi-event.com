import { describe, expect, it } from 'vitest'

import {
  EVENT_CONTENT_LIMITS,
  SOCIAL_HOSTS as SERVER_HOSTS,
  SOCIAL_NETWORK_LABELS as SERVER_LABELS,
  SOCIAL_NETWORKS as SERVER_NETWORKS,
  eventFaqSchema,
  eventPerformersSchema,
  eventRunningOrderSchema,
  eventSocialLinksSchema,
  eventSponsorsSchema,
} from '@desi-event/schemas/event-content'

import {
  CONTENT_LIMITS,
  SOCIAL_HOSTS,
  SOCIAL_NETWORK_LABELS,
  SOCIAL_NETWORKS,
  blankRow,
  contentProblems,
  fromEventContent,
  socialLinkProblem,
  toContentPatch,
} from './event-content.js'

/** A form with nothing in it. */
const empty = () => fromEventContent({})

describe('the mirror of the server’s rules', () => {
  it('holds the same limits, networks, labels and hosts as the schemas', () => {
    expect(CONTENT_LIMITS).toEqual(EVENT_CONTENT_LIMITS)
    expect(SOCIAL_NETWORKS).toEqual(SERVER_NETWORKS)
    expect(SOCIAL_NETWORK_LABELS).toEqual(SERVER_LABELS)
    expect(SOCIAL_HOSTS).toEqual(SERVER_HOSTS)
  })
})

describe('reading an event into the form', () => {
  it('turns an older event’s names into line-up rows, so the first save keeps them', () => {
    const values = fromEventContent({ artists: ['Nizami Bandhu', 'Warsi Brothers'] })

    expect(values.performers).toEqual([
      { name: 'Nizami Bandhu', role: '', bio: '' },
      { name: 'Warsi Brothers', role: '', bio: '' },
    ])
  })

  it('prefers the performers when there are some, and gives every box a string', () => {
    const values = fromEventContent({
      artists: ['Old name'],
      performers: [{ name: 'Falguni Pathak', role: 'Lead vocals', bio: null }],
      socialLinks: { instagram: 'https://instagram.com/desi' },
      dressCode: null,
    })

    expect(values.performers).toEqual([{ name: 'Falguni Pathak', role: 'Lead vocals', bio: '' }])
    expect(values.socialLinks).toMatchObject({
      instagram: 'https://instagram.com/desi',
      website: '',
    })
    expect(values.dressCode).toBe('')
  })
})

describe('what the content check finds', () => {
  it('finds nothing wrong with an empty form, or with rows nobody filled in', () => {
    const values = { ...empty(), faq: [blankRow('faq')], sponsors: [blankRow('sponsors')] }

    expect(contentProblems(values)).toEqual([])
    expect(contentProblems({})).toEqual([])
  })

  it('asks for the missing half of a used row', () => {
    const values = { ...empty(), faq: [{ question: 'Is there parking?', answer: '' }] }

    expect(contentProblems(values)).toEqual([
      { field: 'faq-0-answer', message: 'Answer question 1.' },
    ])
  })

  it('wants a 24-hour time in the running order', () => {
    const values = { ...empty(), runningOrder: [{ time: '7pm', title: 'Aarti', note: '' }] }

    expect(contentProblems(values)).toEqual([
      { field: 'runningOrder-0-time', message: 'Give slot 1 a time, such as 19:30.' },
    ])
  })

  it('counts a bio against its limit', () => {
    const values = {
      ...empty(),
      performers: [{ name: 'A', role: '', bio: 'x'.repeat(CONTENT_LIMITS.performerBio + 1) }],
    }

    expect(contentProblems(values)).toEqual([
      {
        field: 'performers-0-bio',
        message: "Keep performer 1's bio to 600 characters (it is 601).",
      },
    ])
  })

  it('refuses a sponsor link that is not https', () => {
    const values = {
      ...empty(),
      sponsors: [{ name: 'Patel Brothers', url: 'javascript:alert(1)', level: '' }],
    }

    expect(contentProblems(values)).toEqual([
      {
        field: 'sponsors-0-url',
        message: "Use a full https:// address for sponsor 1's website.",
      },
    ])
  })

  it('refuses an Instagram label that points somewhere else', () => {
    expect(socialLinkProblem('instagram', 'https://instagram.com.evil.example/desi')).toBe(
      'That address is not on Instagram. Use a link that starts https://instagram.com/.',
    )
    expect(socialLinkProblem('instagram', 'http://instagram.com/desi')).toBe(
      'Use a full https:// address.',
    )
    expect(socialLinkProblem('website', 'https://desi.example')).toBeNull()
    expect(socialLinkProblem('whatsapp', '')).toBeNull()
  })

  it('checks the public email and phone', () => {
    const values = { ...empty(), publicEmail: 'not an address', publicPhone: 'call us' }

    expect(contentProblems(values).map((problem) => problem.field)).toEqual([
      'publicEmail',
      'publicPhone',
    ])
  })
})

describe('the content the editor sends', () => {
  it('drops unused rows, trims, and sends blank optional boxes as null', () => {
    const patch = toContentPatch({
      ...empty(),
      performers: [
        { name: ' Falguni Pathak ', role: 'Lead vocals', bio: ' ' },
        { name: '', role: '', bio: '' },
      ],
      runningOrder: [{ time: '19:30', title: 'Aarti', note: '' }],
      sponsors: [{ name: 'Patel Brothers', url: '', level: 'Gold' }],
      socialLinks: { ...empty().socialLinks, instagram: ' https://instagram.com/desi ' },
      dressCode: '  ',
    })

    expect(patch).toMatchObject({
      performers: [{ name: 'Falguni Pathak', role: 'Lead vocals', bio: null }],
      runningOrder: [{ time: '19:30', title: 'Aarti', note: null }],
      faq: [],
      sponsors: [{ name: 'Patel Brothers', url: null, level: 'Gold' }],
      socialLinks: { instagram: 'https://instagram.com/desi' },
      dressCode: null,
      directions: null,
      publicEmail: null,
      publicPhone: null,
    })
  })

  it('sends [] and {} to clear, never null, and every list parses on the server', () => {
    const patch = toContentPatch(empty())

    expect(patch.performers).toEqual([])
    expect(patch.socialLinks).toEqual({})

    const full = toContentPatch({
      ...empty(),
      performers: [{ name: 'A', role: 'B', bio: 'C' }],
      runningOrder: [{ time: '07:05', title: 'Doors', note: 'Gate 3' }],
      faq: [{ question: 'Q?', answer: 'A.' }],
      sponsors: [{ name: 'S', url: 'https://s.example', level: '' }],
      socialLinks: { ...empty().socialLinks, youtube: 'https://youtu.be/abc' },
    })

    expect(eventPerformersSchema.safeParse(full.performers).success).toBe(true)
    expect(eventRunningOrderSchema.safeParse(full.runningOrder).success).toBe(true)
    expect(eventFaqSchema.safeParse(full.faq).success).toBe(true)
    expect(eventSponsorsSchema.safeParse(full.sponsors).success).toBe(true)
    expect(eventSocialLinksSchema.safeParse(full.socialLinks).success).toBe(true)
  })
})
