import { describe, expect, it } from 'vitest'

import { classifyReferrer, hostIs } from './traffic-sources.js'

describe('classifyReferrer', () => {
  it.each([
    ['google.co.uk', 'SEARCH'],
    ['www.google.com', 'SEARCH'],
    ['google.de', 'SEARCH'],
    ['duckduckgo.com', 'SEARCH'],
    ['search.brave.com', 'SEARCH'],
    ['yandex.ru', 'SEARCH'],
    ['l.instagram.com', 'SOCIAL'],
    ['t.co', 'SOCIAL'],
    ['m.facebook.com', 'SOCIAL'],
    ['web.whatsapp.com', 'SOCIAL'],
    ['in.pinterest.com', 'SOCIAL'],
    ['notgoogle.com', 'OTHER'],
    ['evil-facebook.com', 'OTHER'],
    ['facebook.com.evil.example', 'OTHER'],
    ['google.com.attacker.example', 'OTHER'],
    ['sulekha.com', 'OTHER'],
    ['SAME_SITE', 'INTERNAL'],
    ['OTHER_SITE', 'OTHER'],
  ])('puts %s under %s', (referrer, category) => {
    expect(classifyReferrer(referrer)).toBe(category)
  })

  it('calls a view with no referrer direct', () => {
    expect(classifyReferrer(null)).toBe('DIRECT')
    expect(classifyReferrer(undefined)).toBe('DIRECT')
    expect(classifyReferrer('')).toBe('DIRECT')
  })

  it('answers only with a category, never the host', () => {
    expect(['DIRECT', 'INTERNAL', 'SEARCH', 'SOCIAL', 'OTHER']).toContain(
      classifyReferrer('news.example'),
    )
  })
})

describe('hostIs', () => {
  it('matches a domain and its subdomains, label by label', () => {
    expect(hostIs('facebook.com', 'facebook.com')).toBe(true)
    expect(hostIs('m.facebook.com', 'facebook.com')).toBe(true)
    expect(hostIs('notfacebook.com', 'facebook.com')).toBe(false)
  })
})
