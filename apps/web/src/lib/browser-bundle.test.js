/**
 * What the browser is given, checked at the import graph rather than the bundle.
 *
 * Finding NF-15 shipped the platform's password hashing to every visitor and
 * crashed the checkout page, and nothing in the repository noticed either half.
 * These tests are that missing notice. They walk the real import graph from the
 * files a browser actually loads and fail with the chain named, so the next
 * time somebody imports a barrel for one constant the failure says which
 * constant and which barrel.
 *
 * @module lib/browser-bundle.test
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  FORBIDDEN,
  FORBIDDEN_CLIENT_LITERALS,
  REQUIRED_CLIENT_MODULES,
  addressBarWrites,
  declaresUseClient,
  forbiddenLiteralsIn,
  forbiddenReason,
  reachableFrom,
  referralNamesIn,
  resolveSpecifier,
  specifiersIn,
  usesBrowserStorage,
} from './browser-bundle.js'

/** The workspace root. */
const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '../../../..')

/**
 * Every file under a directory, recursively.
 *
 * @param {string} directory A repo-relative directory.
 * @returns {string[]} Repo-relative file paths.
 */
function filesUnder(directory) {
  const found = []

  for (const entry of readdirSync(resolve(ROOT, directory))) {
    const path = join(directory, entry)

    if (statSync(resolve(ROOT, path)).isDirectory()) {
      found.push(...filesUnder(path))
      continue
    }

    found.push(path)
  }

  return found
}

/**
 * Every module a browser loads: the client components, and what the pages hand
 * them.
 *
 * Derived by reading the `'use client'` directive rather than from a list, so a
 * component added tomorrow is covered without anybody remembering to add it
 * here — which is the failure mode that let NF-15 through in the first place.
 *
 * @returns {string[]} Repo-relative entry points.
 */
function browserEntryPoints() {
  const sources = filesUnder('apps/web/src').filter(
    (file) => (file.endsWith('.js') || file.endsWith('.jsx')) && !file.includes('.test.'),
  )

  return sources.filter((file) => declaresUseClient(readFileSync(resolve(ROOT, file), 'utf8')))
}

describe('what reaches the browser', () => {
  it('finds the client components rather than trusting a list', () => {
    const entries = browserEntryPoints()

    expect(entries.length).toBeGreaterThan(3)
    expect(entries).toContain('apps/web/src/components/checkout-basket.jsx')
  })

  it('gives the browser nothing it must not have', () => {
    // The whole finding in one assertion. `api-client.js` is included as an
    // entry point in its own right: it is imported by client components and is
    // the exact path NF-15 travelled.
    const entries = [...browserEntryPoints(), 'apps/web/src/lib/api-client.js']
    const reached = reachableFrom(entries)

    const leaks = [...reached]
      .map(([file, chain]) => ({ file, chain, reason: forbiddenReason(file) }))
      .filter((candidate) => candidate.reason)

    expect(
      leaks.map(
        (leak) => `${leak.file}\n  reached by: ${leak.chain.join(' -> ')}\n  ${leak.reason}`,
      ),
    ).toEqual([])
  })

  it('reaches the contract client, so the walk is really walking', () => {
    // A guard that silently reaches nothing would pass forever. This asserts
    // the walk arrives where it should before the assertion above means much.
    const reached = reachableFrom(['apps/web/src/lib/api-client.js'])

    expect([...reached.keys()]).toContain('packages/api-contract/src/client.js')
    expect([...reached.keys()]).toContain('packages/api-contract/src/route-manifest.js')
  })

  it('stops before the schemas the contract is built from', () => {
    // The client used to import the barrel, which re-exports `routes.js`,
    // which holds every request and response schema. The browser therefore
    // carried the column names of every entity — `Organization.contactEmail`,
    // `Organization.payoutCurrency` — in every production build. It reads a
    // generated manifest now: ids, methods, paths, and whether a route takes a
    // body.
    const reached = [...reachableFrom(['apps/web/src/lib/api-client.js']).keys()]

    expect(reached).not.toContain('packages/api-contract/src/routes.js')
    expect(reached).not.toContain('packages/api-contract/src/index.js')
    expect(reached).not.toContain('packages/schemas/src/entities.js')
    expect(reached).not.toContain('packages/schemas/src/requests.js')
    expect(reached).not.toContain('packages/schemas/src/responses.js')
  })

  it('would catch the defect it was written for', () => {
    // The adversarial half: feed the walker the module that leaked and confirm
    // it is still recognised. Without this, a later edit to FORBIDDEN could
    // empty the rule set and every other test here would still pass.
    const reached = reachableFrom(['packages/api-contract/src/validate.js'])

    expect(forbiddenReason('packages/auth/src/password.js')).toMatch(/scrypt/)
    expect(forbiddenReason('packages/auth/src/index.js')).toMatch(/barrel/)
    // And the fixed module no longer arrives there.
    expect([...reached.keys()]).not.toContain('packages/auth/src/index.js')
  })

  it('refuses the role and capability tables, which the platform-role screens are likeliest to reach for', () => {
    // The artefact scan forbids PLATFORM_ROLE_CAPABILITIES and platform:admin
    // in built chunks, but only after a build. This refuses the import itself.
    expect(forbiddenReason('packages/permissions/src/capabilities.js')).toMatch(/capability/)
    expect(forbiddenReason('packages/permissions/src/index.js')).toMatch(/barrel/)
  })

  it('names a reason for every rule, so a refusal can be acted on', () => {
    for (const [prefix, reason] of Object.entries(FORBIDDEN)) {
      expect(reason.length, prefix).toBeGreaterThan(20)
    }
  })

  it('gives no client module a privileged capability name', () => {
    // SPEC2 §0.2: client components receive booleans. A capability name in a
    // module the browser loads is in the bundle, comments aside.
    const entries = [...browserEntryPoints(), 'apps/web/src/lib/api-client.js']
    const carriers = []

    for (const file of reachableFrom(entries).keys()) {
      const found = forbiddenLiteralsIn(readFileSync(resolve(ROOT, file), 'utf8'))

      if (found.length > 0) carriers.push(`${file}: ${found.join(', ')}`)
    }

    expect(carriers).toEqual([])
  })

  it('finds a capability name in code and not in a comment', () => {
    // The adversarial half, so the rule above cannot pass by matching nothing.
    expect(forbiddenLiteralsIn("const can = session.can('organizer:invite')")).toEqual([
      'organizer:invite',
    ])
    expect(
      forbiddenLiteralsIn(
        "/** For `analytics:view_all` holders. */\n// website_redirect:manage decides this\nconst url = 'https://a.example/'",
      ),
    ).toEqual([])
    expect(Object.keys(FORBIDDEN_CLIENT_LITERALS)).toEqual(
      expect.arrayContaining([
        'platform:admin',
        'organizer:invite',
        'website_redirect:manage',
        'analytics:view_all',
      ]),
    )
  })

  it('keeps the invitation, mail and visitor-address code on the server, and allows the letter', () => {
    // The letter a code panel shows is built from `code-letters`, which imports
    // nothing; the schemas and the sender behind it are the server's.
    expect(forbiddenReason('packages/schemas/src/organizer-invitations.js')).toMatch(/invitation/)
    expect(forbiddenReason('packages/providers/src/smtp.js')).toMatch(/SMTP/)
    expect(forbiddenReason('apps/api/src/lib/code-mailer.js')).toMatch(/email/)
    expect(forbiddenReason('apps/web/src/lib/traffic-forwarding.js')).toMatch(/address/)
    expect(forbiddenReason('packages/schemas/src/code-letters.js')).toBeNull()

    const reached = reachableFrom([
      'apps/web/src/app/admin/organizer-invitations/organizer-invite-form.jsx',
    ])

    expect([...reached.keys()]).toContain('packages/schemas/src/code-letters.js')
    expect(
      [...reachableFrom(['packages/schemas/src/code-letters.js']).keys()].filter(
        (file) => file !== 'packages/schemas/src/code-letters.js',
      ),
    ).toEqual([])
  })
})

describe('full control of posted events and the import (SPEC2-XI §0.7, §7)', () => {
  /** The capability names SPEC2-XI adds, each forbidden in a client module. */
  const NEW_LITERALS = [
    'event:platform_edit',
    'event:platform_delete',
    'event:import',
    'event:delete_unsold',
  ]

  /** The importer's server-only modules. */
  const IMPORT_MODULES = ['apps/api/src/lib/event-import.js', 'apps/api/src/lib/import-dataset.js']

  it('has no picture fetcher left to refuse: an import contacts no other site', () => {
    // ADR 0015, addendum 2026-10-15 (2): the importer copies no pictures, so
    // its outbound fetcher, once the third module here, is gone.
    expect(existsSync(resolve(ROOT, 'apps/api/src/lib/import-images.js'))).toBe(false)
    expect(Object.keys(FORBIDDEN)).not.toContain('apps/api/src/lib/import-images.js')
  })

  it('forbids the four capability names in a client module, in code and not in a comment', () => {
    for (const literal of NEW_LITERALS) {
      expect(Object.keys(FORBIDDEN_CLIENT_LITERALS), literal).toContain(literal)
      expect(forbiddenLiteralsIn(`const may = membershipCan(session, '${literal}', id)`)).toEqual([
        literal,
      ])
      expect(forbiddenLiteralsIn(`// Held by \`${literal}\` holders.\nconst a = 1`)).toEqual([])
    }
  })

  it('names those capabilities only in server modules, which no client module reaches', () => {
    const entries = [...browserEntryPoints(), 'apps/web/src/lib/api-client.js']
    const reached = new Set(reachableFrom(entries).keys())
    const namers = []

    for (const file of filesUnder('apps/web/src').filter(
      (path) => /\.jsx?$/u.test(path) && !path.includes('.test.'),
    )) {
      const source = readFileSync(resolve(ROOT, file), 'utf8')
      const found = forbiddenLiteralsIn(source).filter((literal) => NEW_LITERALS.includes(literal))

      if (found.length === 0) continue

      namers.push(file)
      expect(declaresUseClient(source), `${file} is a client module naming ${found}`).toBe(false)
      expect(reached.has(file), `${file} is reached from a client module`).toBe(false)
    }

    // The pages and libraries that decide, so the rule is not passing on nothing.
    expect(namers).toEqual(
      expect.arrayContaining([
        'apps/web/src/app/admin/events/[id]/page.jsx',
        'apps/web/src/app/admin/imports/page.jsx',
        'apps/web/src/app/organizer/events/[id]/page.jsx',
      ]),
    )
  })

  it('refuses the importer’s modules by name, and none of them reaches the browser', () => {
    for (const file of IMPORT_MODULES) {
      const reason = forbiddenReason(file)

      expect(reason, file).toBeTruthy()
      // Its own rule, not only the catch-all for the API.
      expect(reason, file).not.toBe(FORBIDDEN['apps/api/'])
    }

    // The importer pulls the other two in; the walk follows it there.
    const fromImporter = [...reachableFrom(['apps/api/src/lib/event-import.js']).keys()]

    expect(fromImporter).toEqual(expect.arrayContaining(IMPORT_MODULES))

    // And the import screens, client and server, reach none of them.
    const screens = filesUnder('apps/web/src/app/admin/imports').filter(
      (path) => /\.jsx?$/u.test(path) && !path.includes('.test.'),
    )

    expect(screens.length).toBeGreaterThan(2)

    const reached = [
      ...reachableFrom([...screens, 'apps/web/src/components/reassign-event-dialog.jsx']).keys(),
    ]

    for (const file of IMPORT_MODULES) expect(reached, file).not.toContain(file)
  })
})

describe('booking fees, referral codes and paying at the venue (SPEC3 §0.4, §13; SPEC3-XI §13)', () => {
  /** The capability names SPEC3 and SPEC3-XI add, each forbidden in a client module. */
  const NEW_LITERALS = [
    'payment_terms:manage',
    'referral_code:manage',
    'platform_fee:refund',
    'venue_booking:cancel',
  ]

  it('forbids the four capability names in a client module, in code and not in a comment', () => {
    for (const literal of NEW_LITERALS) {
      expect(Object.keys(FORBIDDEN_CLIENT_LITERALS), literal).toContain(literal)
      expect(FORBIDDEN_CLIENT_LITERALS[literal], literal).toBeTruthy()
      expect(forbiddenLiteralsIn(`const may = sessionCan(session, '${literal}')`)).toEqual([
        literal,
      ])
      expect(forbiddenLiteralsIn(`/** For \`${literal}\` holders. */\nconst a = 1`)).toEqual([])
    }
  })

  it('names those capabilities only in server modules, which no client module reaches', () => {
    const entries = [...browserEntryPoints(), 'apps/web/src/lib/api-client.js']
    const reached = new Set(reachableFrom(entries).keys())
    const namers = []

    for (const file of filesUnder('apps/web/src').filter(
      (path) => /\.jsx?$/u.test(path) && !path.includes('.test.'),
    )) {
      const source = readFileSync(resolve(ROOT, file), 'utf8')
      const found = forbiddenLiteralsIn(source).filter((literal) => NEW_LITERALS.includes(literal))

      if (found.length === 0) continue

      namers.push(file)
      expect(declaresUseClient(source), `${file} is a client module naming ${found}`).toBe(false)
      expect(reached.has(file), `${file} is reached from a client module`).toBe(false)
    }

    // The pages that decide, so the rule is not passing on nothing.
    expect(namers).toEqual(
      expect.arrayContaining([
        'apps/web/src/app/admin/events/[id]/page.jsx',
        'apps/web/src/app/admin/events/[id]/venue-bookings/page.jsx',
        'apps/web/src/app/admin/fee-refunds/page.jsx',
        'apps/web/src/app/admin/referral-codes/page.jsx',
      ]),
    )
  })

  it('keeps every new client module a client module, walked and held to the rules', () => {
    const entries = browserEntryPoints()
    const reached = reachableFrom([...entries, 'apps/web/src/lib/api-client.js'])

    expect(Object.keys(REQUIRED_CLIENT_MODULES)).toEqual(
      expect.arrayContaining([
        'apps/web/src/components/cancel-unpaid-tickets-dialog.jsx',
        'apps/web/src/components/unpaid-venue-bookings.jsx',
      ]),
    )

    for (const [file, why] of Object.entries(REQUIRED_CLIENT_MODULES)) {
      expect(why, file).toBeTruthy()
      // Found by its directive, so the walk starts there.
      expect(entries, `${file} is no longer a client module`).toContain(file)

      // Nothing it reaches is server-only, and nothing it reaches names a capability.
      for (const [module, chain] of reachableFrom([file])) {
        expect(forbiddenReason(module), `${module} reached by ${chain.join(' -> ')}`).toBeNull()
        expect(
          forbiddenLiteralsIn(readFileSync(resolve(ROOT, module), 'utf8')),
          `${module} reached by ${chain.join(' -> ')}`,
        ).toEqual([])
      }

      expect(reached.has(file), file).toBe(true)
    }
  })

  /**
   * Where a referral code is typed, held or shown: the checkout field, the
   * administrators' screens, and the two checkouts that hold the code.
   *
   * @returns {string[]} Repo-relative modules.
   */
  function referralRoots() {
    return [
      'apps/web/src/components/referral-code-field.jsx',
      ...filesUnder('apps/web/src/app/admin/referral-codes').filter(
        (path) => /\.jsx?$/u.test(path) && !path.includes('.test.'),
      ),
      'apps/web/src/components/checkout-basket.jsx',
      'apps/web/src/components/seat-checkout.jsx',
    ]
  }

  it('keeps a referral code out of browser storage: the field, the administrators’ screens and all they reach', () => {
    const roots = referralRoots()
    const storing = []

    for (const file of reachableFrom(roots).keys()) {
      if (!file.startsWith('apps/web/')) continue

      if (usesBrowserStorage(readFileSync(resolve(ROOT, file), 'utf8'))) storing.push(file)
    }

    expect(storing).toEqual([])
    // The field says so in its own words, and the rule reads code, not comments.
    expect(readFileSync(resolve(ROOT, roots[0]), 'utf8')).toMatch(/localStorage/u)
    expect(usesBrowserStorage("window.sessionStorage.setItem('referralCode', code)")).toBe(true)
    expect(usesBrowserStorage('// never localStorage\nconst a = 1')).toBe(false)
    expect(usesBrowserStorage('document.cookie = `referral=${code}`')).toBe(true)
    expect(usesBrowserStorage('const csrf = document.cookie.match(pattern)')).toBe(false)
    // The Cookie Store, a cookie appended to, and the Cache API (review GC D4).
    expect(usesBrowserStorage("globalThis.cookieStore?.set('referral', code)")).toBe(true)
    expect(usesBrowserStorage("await cookieStore.set({ name: 'referral', value: code })")).toBe(
      true,
    )
    expect(usesBrowserStorage('document.cookie += `; referral=${code}`')).toBe(true)
    expect(usesBrowserStorage("const box = await caches.open('referral')")).toBe(true)
    expect(usesBrowserStorage('if (document.cookie === before) return')).toBe(false)
    expect(usesBrowserStorage("const copy = 'Browser caches keep pages.'")).toBe(false)
  })

  it('keeps a referral code out of the address bar: no history, router or location write in the field, the administrators’ screens or all they reach names one', () => {
    const writes = []

    for (const file of reachableFrom(referralRoots()).keys()) {
      if (!file.startsWith('apps/web/')) continue

      for (const { write, argument } of addressBarWrites(
        readFileSync(resolve(ROOT, file), 'utf8'),
      )) {
        writes.push(`${file}: ${write}(${argument})`)
        expect(referralNamesIn(argument), `${file}: ${write}(${argument})`).toEqual([])
      }
    }

    // Every write those modules make, read and listed (SPEC3 §8.3, "never in a
    // URL"): a new one fails here until it is read, so a code moved into
    // another name before it reaches the address bar is seen too.
    expect(writes).toEqual(["apps/web/src/components/sign-out-button.jsx: router.replace('/')"])

    // The rule sees the writes it is for, and what each is given.
    expect(
      addressBarWrites(
        "window.history.replaceState(null, '', `?referral=${encodeURIComponent(code)}`)",
      ),
    ).toEqual([
      {
        write: 'history.replaceState',
        argument: "null, '', `?referral=${encodeURIComponent(code)}`",
      },
    ])
    expect(addressBarWrites('router.push(`/events/${slug}?r=${referralCode}`)')).toHaveLength(1)
    expect(addressBarWrites('window.location.href = `/checkout?code=${draft}`\n')).toEqual([
      { write: 'location.href', argument: '`/checkout?code=${draft}`' },
    ])
    expect(addressBarWrites("location.assign('/')")).toHaveLength(1)
    expect(addressBarWrites('const location = usePathname()')).toEqual([])
    expect(addressBarWrites('places.map((location) => location.name)')).toEqual([])
    expect(addressBarWrites('if (location === here) return')).toEqual([])
    expect(addressBarWrites('// router.push(code)\nconst a = 1')).toEqual([])

    expect(referralNamesIn("null, '', `?referral=${encodeURIComponent(code)}`")).toEqual(['code'])
    expect(referralNamesIn('`/events/${slug}?r=${referralCode}`')).toEqual(['referralCode'])
    expect(referralNamesIn('`/checkout?code=${draft}`')).toEqual(['draft'])
    expect(referralNamesIn('`/x?r=${referral.code}`')).toEqual(['referral.code'])
    expect(referralNamesIn("'/admin/referral-codes'")).toEqual([])
    expect(referralNamesIn('`${REFERRAL_CODES_PATH}/${encodeURIComponent(code.id)}`')).toEqual([])
    expect(referralNamesIn('`/admin/events/${referralCodeId}`')).toEqual([])
  })
})

describe('the walker itself', () => {
  it('finds the directive behind a long docstring, which is the house style', () => {
    // The bug this replaced: the first version looked at the first 200
    // characters, and every module in this repository opens with a paragraph
    // explaining itself. A client component with a fifteen-line docstring was
    // invisible to the guard, so it could import anything it liked.
    const withDocstring = ['/**', ' * '.padEnd(240, 'x'), ' */', '', "'use client'", ''].join('\n')

    expect(withDocstring.indexOf("'use client'")).toBeGreaterThan(200)
    expect(declaresUseClient(withDocstring)).toBe(true)
  })

  it('does not mistake the words for the directive', () => {
    expect(declaresUseClient("// we should 'use client' here one day\nexport const a = 1")).toBe(
      false,
    )
    expect(declaresUseClient("const note = 'use client'\n")).toBe(false)
    expect(declaresUseClient('export function Server() {}')).toBe(false)
  })

  it('accepts either quote style and a leading line comment', () => {
    expect(declaresUseClient('// a note\n"use client"\n')).toBe(true)
    expect(declaresUseClient("'use client'\n")).toBe(true)
  })

  it('sees static imports, re-exports and dynamic imports', () => {
    const source = [
      "import { a } from './a.js'",
      "export * from './b.js'",
      "export { c } from './c.js'",
      "const d = await import('./d.js')",
      "import x from '@desi-event/auth'",
    ].join('\n')

    expect(specifiersIn(source)).toEqual([
      './a.js',
      './b.js',
      './c.js',
      './d.js',
      '@desi-event/auth',
    ])
  })

  it('resolves a workspace subpath the way an exports map does', () => {
    expect(
      resolveSpecifier('@desi-event/auth/sessions', 'packages/api-contract/src/validate.js'),
    ).toBe('packages/auth/src/sessions.js')
    expect(resolveSpecifier('@desi-event/auth', 'packages/api-contract/src/validate.js')).toBe(
      'packages/auth/src/index.js',
    )
  })

  it('resolves a relative specifier against the importing file', () => {
    expect(resolveSpecifier('./client.js', 'packages/api-contract/src/index.js')).toBe(
      'packages/api-contract/src/client.js',
    )
  })

  it('ignores a third-party specifier, which is not its problem', () => {
    expect(resolveSpecifier('react', 'apps/web/src/components/ui.jsx')).toBeNull()
    expect(resolveSpecifier('zod', 'packages/schemas/src/index.js')).toBeNull()
  })

  it('uses no computed import specifier anywhere a browser can reach', () => {
    // The walker reads source text, so a specifier built at runtime would be
    // invisible to it. This asserts the assumption rather than hoping.
    const entries = [...browserEntryPoints(), 'apps/web/src/lib/api-client.js']

    for (const file of reachableFrom(entries).keys()) {
      const source = readFileSync(resolve(ROOT, file), 'utf8')

      expect(source, `${file} builds an import specifier at runtime`).not.toMatch(
        /import\(\s*(?!['"])[^)]/,
      )
    }
  })

  it('walks from a real path rather than the working directory', () => {
    // A guard that depends on the cwd passes in one runner and fails in another.
    expect(relative(ROOT, resolve(ROOT, 'apps/web'))).toBe('apps/web')
  })
})
