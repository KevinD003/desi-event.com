/**
 * The browser's copy of the website address rule is the server's, and the
 * redirect's request checks say what they mean.
 */

import { describe, expect, it } from 'vitest'

import * as server from '@desi-event/schemas/website'

import * as browser from './website.js'

/** Addresses that pass and fail, in every way the rule distinguishes. */
const INPUTS = [
  'https://www.example.com',
  'https://www.example.com/',
  'HTTPS://Example.COM:443/Path?utm_source=desi#tickets',
  'https://bücher.example/',
  'https://gamma-abc.test/',
  'https://a.example/?ref=x',
  'https://a.example/a%20b',
  'https://www.rangoli.example/nights/2026?lang=gu',
  'http://a.example/',
  'javascript:alert(1)',
  '//evil.example',
  'https:evil',
  'https://u:p@a.example/',
  'https://user@a.example/',
  'https://a.example:8443/',
  'https://127.0.0.1/',
  'https://0x7f.1/',
  'https://[::1]/',
  'https://localhost/',
  'https://intranet/',
  'https://printer.local/',
  'https://x.onion/',
  'https://router.home/',
  'https://desi-event.com/',
  'https://www.desi-event.com/e/x',
  'https://a.example/?token=1',
  'https://a.example/?Access_Token=1',
  'https://a.example/#access_token=1',
  'https://a.example/?code=X',
  'https://a.example/?key=',
  'https://a example/',
  'https://a.example/\n',
  `https://a.example/${'x'.repeat(2048)}`,
  'https://a.example./',
  'https://-.example/',
  'https://a.e/',
  'https://a.xn--p1ai/',
  '',
  '   ',
  'ftp://a.example/',
  'mailto:a@b.example',
  'https://a.example/\u0000',
]

describe('the browser’s address rule is the server’s', () => {
  it('keeps the same limits, lists and sentences', () => {
    expect(browser.WEBSITE_LIMITS).toEqual(server.WEBSITE_LIMITS)
    expect(browser.PLATFORM_HOSTS).toEqual(server.PLATFORM_HOSTS)
    expect(browser.PRIVATE_HOST_SUFFIXES).toEqual(server.PRIVATE_HOST_SUFFIXES)
    expect(browser.CREDENTIAL_PARAMETERS).toEqual(server.CREDENTIAL_PARAMETERS)
    expect(browser.WEBSITE_PROBLEMS).toEqual(server.WEBSITE_PROBLEMS)
    expect(browser.credentialParameterProblem('token')).toBe(
      server.credentialParameterProblem('token'),
    )
  })

  it.each(INPUTS)('says the same about %j', (input) => {
    expect(browser.websiteUrlProblem(input)).toBe(server.websiteUrlProblem(input))
    expect(browser.normaliseWebsiteUrl(input)).toBe(server.normaliseWebsiteUrl(input))
    expect(browser.websiteHost(input)).toBe(server.websiteHost(input))
  })

  it('answers the non-strings the same', () => {
    for (const value of [undefined, null, 42, {}, []]) {
      expect(browser.websiteUrlProblem(value)).toBe(server.websiteUrlProblem(value))
      expect(browser.normaliseWebsiteUrl(value)).toBe(server.normaliseWebsiteUrl(value))
      expect(browser.websiteHost(value)).toBe(server.websiteHost(value))
    }
  })

  it('shows a host without its www.', () => {
    expect(browser.websiteHost('https://www.rangoli.example/x')).toBe('rangoli.example')
    expect(browser.normaliseWebsiteUrl(' https://Rangoli.example ')).toBe(
      'https://rangoli.example/',
    )
  })
})

describe('what the redirect decides about a request before asking anything', () => {
  it('knows a prefetch or a prerender', () => {
    expect(browser.isPrefetch({ 'sec-purpose': 'prefetch' })).toBe(true)
    expect(browser.isPrefetch({ 'sec-purpose': 'prefetch;prerender' })).toBe(true)
    expect(browser.isPrefetch({ purpose: 'prefetch' })).toBe(true)
    expect(browser.isPrefetch({ 'next-router-prefetch': '1' })).toBe(true)
    expect(browser.isPrefetch(new Headers({ 'Sec-Purpose': 'prerender' }))).toBe(true)
    expect(browser.isPrefetch({})).toBe(false)
    expect(browser.isPrefetch({ 'sec-fetch-dest': 'document' })).toBe(false)
  })

  it('serves a top-level page, or a request with no fetch metadata, and nothing else', () => {
    expect(browser.isServableRequest({})).toBe(true)
    expect(browser.isServableRequest({ 'sec-fetch-dest': 'document' })).toBe(true)
    expect(browser.isServableRequest({ 'sec-fetch-dest': 'Document' })).toBe(true)

    for (const dest of ['image', 'iframe', 'empty', 'script', 'style', 'audio']) {
      expect(browser.isServableRequest({ 'sec-fetch-dest': dest }), dest).toBe(false)
    }
  })

  /** Every combination of the three headers, each present or absent. */
  const DESTS = [null, 'document', 'image', 'empty']
  const MODES = [null, 'navigate', 'no-cors', 'cors']
  const SITES = [null, 'same-origin', 'none', 'same-site', 'cross-site']

  it('counts only a document navigation from this site or typed in', () => {
    for (const dest of DESTS) {
      for (const mode of MODES) {
        for (const site of SITES) {
          const headers = {
            ...(dest ? { 'sec-fetch-dest': dest } : {}),
            ...(mode ? { 'sec-fetch-mode': mode } : {}),
            ...(site ? { 'sec-fetch-site': site } : {}),
          }
          const expected =
            dest === 'document' &&
            mode === 'navigate' &&
            (site === 'same-origin' || site === 'none')

          expect(browser.isCountableNavigation(headers), JSON.stringify(headers)).toBe(expected)
        }
      }
    }
  })

  it('lets count=no stop a count, and nothing in the query start one', () => {
    const click = {
      'sec-fetch-dest': 'document',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-site': 'same-origin',
    }

    expect(browser.isCountableNavigation(click, new URLSearchParams('count=no'))).toBe(false)
    expect(browser.isCountableNavigation(click, new URLSearchParams('count=yes'))).toBe(true)
    expect(browser.isCountableNavigation({}, new URLSearchParams('count=yes'))).toBe(false)
  })
})
