import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import * as barrel from './index.js'
import {
  CREDENTIAL_PARAMETERS,
  PLATFORM_HOSTS,
  PRIVATE_HOST_SUFFIXES,
  WEBSITE_LIMITS,
  WEBSITE_PROBLEMS,
  credentialParameterProblem,
  normaliseWebsiteUrl,
  publicWebsiteLinkSchema,
  websiteHost,
  websiteRedirectDecisionSchema,
  websiteRedirectStateSchema,
  websiteUrlProblem,
  websiteUrlSchema,
} from './website.js'

const here = path.dirname(fileURLToPath(import.meta.url))

describe('websiteUrlProblem accepts a public https address', () => {
  it.each([
    ['https://www.example.com', 'https://www.example.com/'],
    [
      'HTTPS://Example.COM:443/Path?utm_source=desi#tickets',
      'https://example.com/Path?utm_source=desi#tickets',
    ],
    ['https://bücher.example/', 'https://xn--bcher-kva.example/'],
    ['https://gamma-abc.test/', 'https://gamma-abc.test/'],
    ['https://a.example/?ref=x', 'https://a.example/?ref=x'],
    ['https://mirrorwork.example/', 'https://mirrorwork.example/'],
  ])('%s, stored as %s', (input, stored) => {
    expect(websiteUrlProblem(input)).toBeNull()
    expect(normaliseWebsiteUrl(input)).toBe(stored)
    expect(websiteUrlSchema.parse(input)).toBe(stored)
  })

  it('stores a form the database CHECK accepts', () => {
    // `event_website_url_shape`, in JavaScript: the floor under this rule.
    const floor = /^https:\/\/([a-z0-9-]+\.)+([a-z]{2,63}|xn--[a-z0-9-]+)\/[!-~]*$/

    for (const input of ['https://www.Example.com', 'https://bücher.example/a?c=ü']) {
      const stored = websiteUrlSchema.parse(input)

      expect(stored, input).toMatch(floor)
      expect(stored.length).toBeGreaterThanOrEqual(12)
    }
  })
})

describe('websiteUrlProblem refuses, each with its own sentence', () => {
  it.each([
    ['http://a.example/', WEBSITE_PROBLEMS.protocol],
    ['javascript:alert(1)', WEBSITE_PROBLEMS.protocol],
    ['ftp://a.example/', WEBSITE_PROBLEMS.protocol],
    ['//evil.example', WEBSITE_PROBLEMS.unparseable],
    ['https:evil', WEBSITE_PROBLEMS.unparseable],
    ['www.example.com', WEBSITE_PROBLEMS.unparseable],
    ['https://u:p@a.example/', WEBSITE_PROBLEMS.signIn],
    ['https://user@a.example/', WEBSITE_PROBLEMS.signIn],
    ['https://a.example:8443/', WEBSITE_PROBLEMS.port],
    ['https://127.0.0.1/', WEBSITE_PROBLEMS.numeric],
    ['https://0x7f.1/', WEBSITE_PROBLEMS.numeric],
    ['https://[::1]/', WEBSITE_PROBLEMS.numeric],
    ['https://localhost/', WEBSITE_PROBLEMS.name],
    ['https://intranet/', WEBSITE_PROBLEMS.name],
    ['https://a.example./', WEBSITE_PROBLEMS.name],
    ['https://under_score.example/', WEBSITE_PROBLEMS.name],
    ['https://a.b2/', WEBSITE_PROBLEMS.name],
    ['https://printer.local/', WEBSITE_PROBLEMS.privateNetwork],
    ['https://x.onion/', WEBSITE_PROBLEMS.privateNetwork],
    ['https://files.corp/', WEBSITE_PROBLEMS.privateNetwork],
    ['https://thedesievents.com/', WEBSITE_PROBLEMS.platform],
    ['https://www.thedesievents.com/e/x', WEBSITE_PROBLEMS.platform],
    ['https://a.example/?token=1', credentialParameterProblem('token')],
    ['https://a.example/?Access_Token=1', credentialParameterProblem('Access_Token')],
    ['https://a.example/#access_token=1', credentialParameterProblem('access_token')],
    ['https://a.example/?ref=x&code=X', credentialParameterProblem('code')],
    ['https://a.example/a b', WEBSITE_PROBLEMS.whitespace],
    ['https://a.\nexample/', WEBSITE_PROBLEMS.whitespace],
    ['https://a.example/\u0000', WEBSITE_PROBLEMS.whitespace],
    [
      `https://a.example/${'x'.repeat(2049 - 'https://a.example/'.length)}`,
      WEBSITE_PROBLEMS.tooLong,
    ],
    ['', WEBSITE_PROBLEMS.blank],
    ['   ', WEBSITE_PROBLEMS.blank],
  ])('%j', (input, problem) => {
    expect(websiteUrlProblem(input)).toBe(problem)
  })

  it('refuses a value that is not a string', () => {
    expect(websiteUrlProblem(undefined)).toBe(WEBSITE_PROBLEMS.blank)
    expect(websiteUrlProblem(42)).toBe(WEBSITE_PROBLEMS.blank)
  })

  it('holds the stored form to the limit, after percent-encoding has lengthened it', () => {
    // 1,000 two-byte characters fit in 2,048 typed, and become 6,000 encoded.
    const input = `https://a.example/${'é'.repeat(1000)}`

    expect(input.length).toBeLessThanOrEqual(WEBSITE_LIMITS.url)
    expect(websiteUrlProblem(input)).toBe(WEBSITE_PROBLEMS.tooLong)
  })

  it('names every credential parameter, private suffix and platform host it relies on', () => {
    expect(CREDENTIAL_PARAMETERS).toContain('token')
    expect(CREDENTIAL_PARAMETERS).toContain('access_token')
    expect(PRIVATE_HOST_SUFFIXES).toContain('localhost')
    expect(PLATFORM_HOSTS).toEqual(['thedesievents.com'])
    expect(Object.isFrozen(CREDENTIAL_PARAMETERS)).toBe(true)
    expect(Object.isFrozen(WEBSITE_PROBLEMS)).toBe(true)
  })

  it('never says soon, yet or planned', () => {
    const copy = [...Object.values(WEBSITE_PROBLEMS), credentialParameterProblem('p')].join(' ')

    expect(copy).not.toMatch(/\b(soon|yet|planned)\b/i)
  })
})

describe('websiteUrlSchema', () => {
  it('turns blank into null, which clears the field', () => {
    expect(websiteUrlSchema.parse('')).toBeNull()
    expect(websiteUrlSchema.parse('   ')).toBeNull()
    expect(websiteUrlSchema.parse(null)).toBeNull()
  })

  it('trims before checking and storing', () => {
    expect(websiteUrlSchema.parse('  https://www.example.com  ')).toBe('https://www.example.com/')
  })

  it('reports the problem as the issue message, once', () => {
    const result = websiteUrlSchema.safeParse('http://a.example/')

    expect(result.success).toBe(false)
    expect(result.error.issues.map((issue) => issue.message)).toEqual([WEBSITE_PROBLEMS.protocol])

    const long = websiteUrlSchema.safeParse(`https://a.example/${'x'.repeat(2100)}`)
    expect(long.error.issues.map((issue) => issue.message)).toEqual([WEBSITE_PROBLEMS.tooLong])
  })

  it('refuses a non-string', () => {
    expect(websiteUrlSchema.safeParse(42).success).toBe(false)
  })

  it('renders to JSON Schema as a plain nullable string', () => {
    expect(() => z.toJSONSchema(websiteUrlSchema, { target: 'openapi-3.0' })).not.toThrow()
  })
})

describe('websiteHost', () => {
  it('shows the name without a leading www.', () => {
    expect(websiteHost('https://www.example.com/a?b=c')).toBe('example.com')
    expect(websiteHost('https://shop.example.com/')).toBe('shop.example.com')
    expect(websiteHost('https://bücher.example/')).toBe('xn--bcher-kva.example')
  })

  it('is null for anything that does not parse', () => {
    expect(websiteHost('not an address')).toBeNull()
    expect(websiteHost(null)).toBeNull()
  })
})

describe('websiteRedirectDecisionSchema', () => {
  const ON = {
    enabled: true,
    reason: 'Checked: it is their own site.',
    websiteUrl: 'https://a.example/',
  }

  it('accepts a decision in either direction, with the address on the screen', () => {
    expect(websiteRedirectDecisionSchema.parse(ON)).toEqual(ON)
    expect(
      websiteRedirectDecisionSchema.parse({
        enabled: false,
        reason: 'Not their site.',
        websiteUrl: null,
      }),
    ).toEqual({ enabled: false, reason: 'Not their site.', websiteUrl: null })
  })

  it('requires the address in both directions, null when the screen showed none', () => {
    const { websiteUrl: _omitted, ...withoutAddress } = ON
    const result = websiteRedirectDecisionSchema.safeParse(withoutAddress)

    expect(result.success).toBe(false)
    expect(result.error.issues[0].path).toEqual(['websiteUrl'])
    expect(
      websiteRedirectDecisionSchema.safeParse({ ...withoutAddress, enabled: false }).success,
    ).toBe(false)
  })

  it('leaves "may this address be turned on" to the handler, which answers 422', () => {
    // Not a malformed request: the handler refuses with NO_WEBSITE or
    // WEBSITE_NOT_ACCEPTABLE.
    expect(websiteRedirectDecisionSchema.safeParse({ ...ON, websiteUrl: null }).success).toBe(true)
    expect(
      websiteRedirectDecisionSchema.safeParse({ ...ON, websiteUrl: 'http://a.example/' }).success,
    ).toBe(true)
  })

  it('trims the reason and holds it to 3 to 500 characters with no control characters', () => {
    expect(websiteRedirectDecisionSchema.parse({ ...ON, reason: '  Fine.  ' }).reason).toBe('Fine.')
    expect(websiteRedirectDecisionSchema.safeParse({ ...ON, reason: 'ok' }).success).toBe(false)
    expect(
      websiteRedirectDecisionSchema.safeParse({ ...ON, reason: 'x'.repeat(501) }).success,
    ).toBe(false)
    expect(
      websiteRedirectDecisionSchema.safeParse({ ...ON, reason: 'x'.repeat(500) }).success,
    ).toBe(true)
    expect(
      websiteRedirectDecisionSchema.safeParse({ ...ON, reason: 'bad\u0007bell' }).success,
    ).toBe(false)
    expect(
      websiteRedirectDecisionSchema.safeParse({ ...ON, reason: 'two\nlines are fine' }).success,
    ).toBe(true)
    expect(
      websiteRedirectDecisionSchema.safeParse({ ...ON, reason: 'two\r\nlines\tand a tab' }).success,
    ).toBe(true)
    for (const control of ['\u0000', '\u001b', '\u007f', '\u009b']) {
      expect(
        websiteRedirectDecisionSchema.safeParse({ ...ON, reason: `bad${control}one` }).success,
        JSON.stringify(control),
      ).toBe(false)
    }
  })

  it('is strict: an unknown key is refused', () => {
    expect(websiteRedirectDecisionSchema.safeParse({ ...ON, websiteDecidedUrl: 'x' }).success).toBe(
      false,
    )
  })
})

describe('websiteRedirectStateSchema', () => {
  const STATE = {
    enabled: true,
    pending: true,
    decidedUrl: 'https://a.example/',
    submittedAt: '2026-09-30T10:00:00.000Z',
    changedAt: '2026-09-29T10:00:00.000Z',
    reason: 'Checked.',
    changedByName: 'Anil Administrator',
    websiteProblem: null,
  }

  it('carries the decided address, when it waits, who decided and why', () => {
    expect(websiteRedirectStateSchema.parse(STATE)).toEqual(STATE)
  })

  it('is strict, and every field is present', () => {
    expect(
      websiteRedirectStateSchema.safeParse({ ...STATE, cause: 'ADMIN_DECISION' }).success,
    ).toBe(false)

    const { decidedUrl: _omitted, ...missing } = STATE
    expect(websiteRedirectStateSchema.safeParse(missing).success).toBe(false)
  })
})

describe('publicWebsiteLinkSchema', () => {
  it('carries a host and nothing else', () => {
    expect(publicWebsiteLinkSchema.parse({ host: 'example.com' })).toEqual({ host: 'example.com' })
    expect(
      publicWebsiteLinkSchema.safeParse({ host: 'example.com', url: 'https://example.com/' })
        .success,
    ).toBe(false)
    expect(publicWebsiteLinkSchema.safeParse({ host: '' }).success).toBe(false)
  })
})

describe('the module', () => {
  it('imports only zod and ./primitives.js', () => {
    const source = readFileSync(path.join(here, 'website.js'), 'utf8')
    const imports = [...source.matchAll(/^import .* from '([^']+)'/gmu)].map((match) => match[1])

    expect(imports.sort()).toEqual(['./primitives.js', 'zod'])
  })

  it('is on the barrel and at its own entry point', async () => {
    const subpath = await import('@desi-event/schemas/website')

    expect(barrel.websiteUrlProblem).toBe(websiteUrlProblem)
    expect(subpath.websiteUrlSchema).toBe(websiteUrlSchema)
  })
})
