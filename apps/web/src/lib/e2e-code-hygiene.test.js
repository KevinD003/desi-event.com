/**
 * Where an end-to-end spec may show an invitation code.
 *
 * An invitation code is a credential: whoever types it first, signed in as the
 * invited address, joins the organisation in the role it names. In the
 * default delivery mode (MANUAL, the one the end-to-end runs use) the code is
 * shown once, in the page, to whoever invited somebody
 * (`components/one-time-code-panel.jsx`), and the API answers it in the
 * response body as `delivery.invitationCode`. A spec that invites
 * somebody against the real API therefore draws a working code on the screen
 * and holds it in a response.
 *
 * Playwright keeps pictures of the screen (`screenshot`), a recording of the
 * page and its network (`trace`) and a film of everything (`video`). Any one of
 * them would keep the code in a test artefact, which is uploaded from CI. They
 * are worker-scoped options, so `test.use` can set them only at the top of a
 * file. The rule is the stricter half of the entry-pass rule next door
 * (`e2e-pass-hygiene.test.js`): a spec that names the code at all turns all
 * three off at its top level. There is no per-case alternative, because the
 * code comes back in the same response that creates the invitation, and a spec
 * that answered that response itself would not be testing the invitation.
 *
 * ## What this reads, and where it stops
 *
 * The text of each spec, with whole-line comments removed. A spec "reaches the
 * code" when its code, in any letter case, names the API's `invitationCode`
 * field, an `/invitations` path (the invite and reissue routes, and the page
 * where a code is typed), or a control that issues or shows one: **Invite
 * them**, **Issue a new code**, **Copy the code**, **I have handed it over**.
 * An organiser invitation (SPEC2 §4.P) is the same credential one step up — it
 * makes its holder an organisation's owner — and is reached by the
 * administrators' `organizer-invitations` page and routes, by its own name
 * ("organiser invitation code"), or by **Copy the message**, which copies a
 * letter with the code in it.
 *
 * The words "invitation code" alone are not enough, because a ticket transfer
 * has an invitation code of its own, with its own rule, and the transfer specs
 * type made-up ones into a field of that name. A spec that reached a team code
 * some other way — a label built at run time — is not seen; that is why the
 * last case pins each name to the component or contract that uses it, so a
 * rename fails here rather than letting the rule pass by seeing nothing.
 *
 * @module lib/e2e-code-hygiene.test
 */

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  GENERATED_REFERRAL_CODE_PATTERN,
  REFERRAL_CODE_PATTERN,
} from '@desi-event/schemas/payment-terms'

import { reachableFrom } from './browser-bundle.js'

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const e2e = join(webRoot, 'e2e')

/**
 * What means a spec reaches a team or organiser invitation code: the API field,
 * the paths, the controls, and the organiser code's own name and letter.
 */
const NAMES_THE_CODE =
  /invitationCode|\/invitations\b|invite them|issue a new code|copy the code|i have handed it over|organizer-invitations|organiser invitation code|copy the message/iu

/** A `test.use({ … })` at the top level of the file, where worker options may go. */
const FILE_LEVEL_USE = /^test\.use\(\s*\{([^}]*)\}\s*\)/gmu

/**
 * The file with its whole-line comments removed.
 *
 * @param {string} text The file contents.
 * @returns {string} The same text with those comments blanked.
 */
function withoutComments(text) {
  return text.replace(/^[ \t]*\/\*[\s\S]*?\*\//gmu, ' ').replace(/^[ \t]*\/\/.*$/gmu, ' ')
}

/**
 * Whether the file turns screenshots, traces and video off for every case.
 *
 * @param {string} source The file, comments removed.
 * @returns {boolean} True when one top-level `test.use` sets all three to `'off'`.
 */
function turnsArtefactsOff(source) {
  return [...source.matchAll(FILE_LEVEL_USE)].some(([, options]) =>
    ['screenshot', 'trace', 'video'].every((name) =>
      new RegExp(`\\b${name}\\s*:\\s*(['"\`])off\\1`, 'u').test(options),
    ),
  )
}

/**
 * Whether a spec could leave an invitation code in an artefact.
 *
 * @param {string} raw The spec, as written.
 * @returns {boolean} True when it names the code and keeps any artefact.
 */
function leavesCodeInArtefacts(raw) {
  const source = withoutComments(raw)

  return NAMES_THE_CODE.test(source) && !turnsArtefactsOff(source)
}

/** Every Playwright spec, by file name. */
const SPECS = readdirSync(e2e)
  .filter((name) => name.endsWith('.spec.js'))
  .sort()

describe('invitation codes in end-to-end specs', () => {
  it.each(SPECS)('%s never shows a code where an artefact could keep it', (file) => {
    expect(leavesCodeInArtefacts(readFileSync(join(e2e, file), 'utf8'))).toBe(false)
  })

  it('names the code the way the components and the contract do', () => {
    const read = (...parts) => readFileSync(join(webRoot, ...parts), 'utf8')
    const team = ['src', 'app', 'organizer', 'team']

    expect(read('src', 'components', 'one-time-code-panel.jsx')).toMatch(
      /Copy the code[\s\S]*I have handed it over/u,
    )
    expect(read(...team, 'invite-form.jsx')).toContain("'Invite them'")
    expect(read(...team, 'member-actions.jsx')).toContain("'Issue a new code'")
    expect(read(...team, 'team-vocabulary.js')).toContain("ACCEPT_PATH = '/account/invitations'")
    expect(read('..', '..', 'packages', 'schemas', 'src', 'teams.js')).toMatch(
      /invitationCode: invitationCodeSchema/u,
    )

    // The organiser invitation's names, where the screens use them.
    const invitations = ['src', 'app', 'admin', 'organizer-invitations']

    expect(read('src', 'components', 'one-time-code-panel.jsx')).toContain('Copy the message')
    expect(read(...invitations, 'page.jsx')).toContain("'/admin/organizer-invitations'")
    expect(read(...invitations, 'organizer-invite-form.jsx')).toContain(
      "'/v1/platform/organizer-invitations'",
    )
    expect(read(...invitations, 'organizer-invite-form.jsx')).toContain(
      'Organiser invitation code for',
    )
  })
})

describe('the full-control and import screens, which their journeys picture', () => {
  /**
   * SPEC2-XI §9 rows 11 and 12 keep screenshots, traces and video on for the
   * full-control and import journeys (`detail-event-full-control.spec.js`,
   * `detail-event-import.spec.js`), because these screens show no show-once
   * code: a step-up is a one-time TOTP, and nothing here issues an
   * invitation, a transfer code or a pass. That holds only while the screens
   * reach no code: a code panel imported into one of them, or a code named in
   * one, fails here before a journey pictures it. (A spec that reaches a code
   * anyway is still held to the rule above, like every other.)
   */
  const SCREEN_DIRECTORIES = [
    'src/app/admin/events',
    'src/app/admin/imports',
    'src/app/moderation/pictures',
  ]

  const SCREEN_COMPONENTS = [
    'cancel-session-dialog.jsx',
    'control-reason-field.jsx',
    'delete-event-dialog.jsx',
    'deleted-event-summary.jsx',
    'event-changes-list.jsx',
    'finish-refunds-button.jsx',
    'imported-event-panel.jsx',
    'open-platform-edit-form.jsx',
    'platform-changes-panel.jsx',
    'platform-edit-banner.jsx',
    'reassign-event-dialog.jsx',
    'restore-event-dialog.jsx',
    'step-up-retry.jsx',
  ].map((name) => join('src', 'components', name))

  /** The libraries those screens read and send through, which they picture too. */
  const SCREEN_LIBRARIES = [
    'event-control.js',
    'imports-api.js',
    'imports.js',
    'platform-editor.js',
  ].map((name) => join('src', 'lib', name))

  /** The components that draw a show-once code or a pass. */
  const CODE_DRAWERS = ['one-time-code-panel.jsx', 'ticket-pass.jsx', 'group-pass.jsx'].map(
    (name) => `apps/web/src/components/${name}`,
  )

  /**
   * Every module of a directory, tests left out.
   *
   * @param {string} directory Relative to `apps/web`.
   * @returns {string[]} Paths relative to `apps/web`.
   */
  function modulesUnder(directory) {
    return readdirSync(join(webRoot, directory), { recursive: true })
      .map(String)
      .filter((name) => /\.jsx?$/u.test(name) && !name.includes('.test.'))
      .map((name) => join(directory, name))
  }

  const screens = [
    ...SCREEN_DIRECTORIES.flatMap(modulesUnder),
    ...SCREEN_COMPONENTS,
    ...SCREEN_LIBRARIES,
  ]

  it('finds the screens, so the rule is not passing on nothing', () => {
    expect(screens).toEqual(
      expect.arrayContaining([
        join('src', 'app', 'admin', 'events', '[id]', 'page.jsx'),
        join('src', 'app', 'admin', 'imports', '[runId]', 'import-run-plan.jsx'),
        join('src', 'components', 'delete-event-dialog.jsx'),
      ]),
    )
    expect(screens.length).toBeGreaterThan(15)
  })

  it.each(screens)('%s names no show-once code and draws none', (screen) => {
    expect(withoutComments(readFileSync(join(webRoot, screen), 'utf8'))).not.toMatch(NAMES_THE_CODE)

    const reached = [...reachableFrom([`apps/web/${screen}`]).keys()]

    for (const drawer of CODE_DRAWERS) expect(reached, drawer).not.toContain(drawer)
  })
})

describe('the invariant itself', () => {
  const read = [
    `    await page.getByRole('button', { name: 'Invite them' }).click()`,
    `    const code = await page.getByLabel('Invitation code').inputValue()`,
  ].join('\n')

  /**
   * A spec made of the given lines.
   *
   * @param {...string} lines The lines.
   * @returns {string} The spec.
   */
  const spec = (...lines) => lines.join('\n')

  it('accepts a file that turns all three artefacts off at the top', () => {
    const raw = spec(
      "test.use({ screenshot: 'off', trace: 'off', video: 'off' })",
      "test('invites', async ({ page }) => {",
      read,
      '})',
    )

    expect(leavesCodeInArtefacts(raw)).toBe(false)
  })

  it.each([
    ['screenshot', "test.use({ trace: 'off', video: 'off' })"],
    ['trace', "test.use({ screenshot: 'off', video: 'off' })"],
    ['video', "test.use({ screenshot: 'off', trace: 'off' })"],
    [
      'a screenshot on failure',
      "test.use({ screenshot: 'only-on-failure', trace: 'off', video: 'off' })",
    ],
  ])('refuses a file-level test.use that leaves out %s', (_label, use) => {
    expect(leavesCodeInArtefacts(spec(use, "test('invites', async () => {", read, '})'))).toBe(true)
  })

  it('refuses a spec that reads the API field rather than the label', () => {
    const raw = spec(
      "test('invites', async ({ request }) => {",
      '  const { data } = await (await request.post(url, { data: body })).json()',
      '  const code = data.delivery.invitationCode',
      '})',
    )

    expect(leavesCodeInArtefacts(raw)).toBe(true)
  })

  it('does not count a test.use inside a describe, where Playwright refuses one anyway', () => {
    const raw = spec(
      "test.describe('team', () => {",
      "  test.use({ screenshot: 'off', trace: 'off', video: 'off' })",
      "  test('invites', async ({ page }) => {",
      read,
      '  })',
      '})',
    )

    expect(leavesCodeInArtefacts(raw)).toBe(true)
  })

  it('does not count a test.use that has been commented out', () => {
    const raw = spec(
      "// test.use({ screenshot: 'off', trace: 'off', video: 'off' })",
      "test('invites', async ({ page }) => {",
      read,
      '})',
    )

    expect(leavesCodeInArtefacts(raw)).toBe(true)
  })

  it.each([
    ['the administrators’ page', "  await page.goto('/admin/organizer-invitations')"],
    ['the API route', "  await request.post('/api/v1/platform/organizer-invitations', { data })"],
    [
      'the code’s name',
      '  await expect(page.getByText(/organiser invitation code/i)).toBeVisible()',
    ],
    ['the letter', "  await page.getByRole('button', { name: 'Copy the message' }).click()"],
  ])('treats an organiser invitation reached by %s as a code', (_label, line) => {
    const unguarded = spec(
      "test('invites an organiser', async ({ page, request }) => {",
      line,
      '})',
    )

    expect(leavesCodeInArtefacts(unguarded)).toBe(true)
    expect(
      leavesCodeInArtefacts(
        spec("test.use({ screenshot: 'off', trace: 'off', video: 'off' })", unguarded),
      ),
    ).toBe(false)
  })

  it('does not take a ticket transfer’s invitation code for a team one', () => {
    const raw = spec(
      "test('takes a transfer code in a field', async ({ page }) => {",
      "  await page.goto('/account/transfers')",
      "  await page.getByLabel(/invitation code/i).fill('not-a-real-code')",
      '})',
    )

    expect(leavesCodeInArtefacts(raw)).toBe(false)
  })

  it('refuses a spec that types a code on the page where one is accepted', () => {
    const raw = spec(
      "test('joins', async ({ page }) => {",
      "  await page.goto('/account/invitations')",
      "  await page.getByLabel('Invitation code').fill(code)",
      '})',
    )

    expect(leavesCodeInArtefacts(raw)).toBe(true)
  })

  it('does not treat a comment that names the code as reaching it', () => {
    const raw = spec(
      "// This spec never presses 'Invite them' or reads an invitationCode.",
      "test('lists the team', async ({ page }) => {",
      "  await page.goto('/organizer/team')",
      '})',
    )

    expect(leavesCodeInArtefacts(raw)).toBe(false)
  })
})

/**
 * Referral codes in end-to-end specs (SPEC3 §8.3, §13).
 *
 * A referral code is a bearer value worth one order's booking fee, made by the
 * Desi-Event team and read back on their screens. A spec that reaches one —
 * the checkout's field, the administrators' list, their "Copy code" button, the
 * API's `referralCode` — holds a working code, so it is held to the rule above:
 * screenshots, traces and video off at the top of the file. And the code it
 * types comes from the page or from the seed's return at run time: a code
 * written into a spec is a code in the repository, and an address with one in
 * it is a code in every log and history that sees the address.
 */
describe('referral codes in end-to-end specs (SPEC3 §13)', () => {
  /** What means a spec reaches a referral code. */
  const NAMES_A_REFERRAL_CODE =
    /referralCode|referral-codes|referral code(?!s)|copy (?:referral )?code\b/iu

  /** A `.fill(…)` whose value is written in the spec, with its quote. */
  const LITERAL_FILL = /\.fill\(\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1\s*[,)]/gu

  /**
   * Every `.fill(` in a spec that types a literal shaped like a referral code
   * into something named for one: the field's label, a test id, a variable.
   * The statement is read from its start, so a locator chained over several
   * lines is seen with its fill.
   *
   * @param {string} source The spec, comments removed.
   * @returns {string[]} The literals.
   */
  function literalCodeFills(source) {
    const found = []

    for (const match of source.matchAll(LITERAL_FILL)) {
      const value = match[2]
      const start = Math.max(
        source.lastIndexOf(';', match.index),
        source.lastIndexOf('\n\n', match.index),
        source.lastIndexOf('await ', match.index),
        0,
      )
      const statement = source.slice(start, match.index)

      if (!/referral/iu.test(statement)) continue

      const typed = value.trim().toUpperCase()

      if (REFERRAL_CODE_PATTERN.test(typed) && !typed.includes('--')) found.push(value)
    }

    return found
  }

  /**
   * Every string literal in a spec shaped like a code the API generates (two
   * groups of five): a code copied into the file from a run.
   *
   * @param {string} source The spec, comments removed.
   * @returns {string[]} The literals.
   */
  function generatedCodeLiterals(source) {
    // As the API hands one out: upper case, and (as nearly every one does) a digit.
    return [...source.matchAll(/(['"`])([A-Z0-9]{5}-[A-Z0-9]{5})\1/gu)]
      .map((match) => match[2])
      .filter((value) => GENERATED_REFERRAL_CODE_PATTERN.test(value) && /\d/u.test(value))
  }

  /**
   * Every `goto(` that opens an address with a referral code in it: a query
   * naming one, or a substitution of a value named for one.
   *
   * @param {string} source The spec, comments removed.
   * @returns {string[]} The arguments.
   */
  function gotosWithCode(source) {
    const found = []

    for (const match of source.matchAll(/\bgoto\(/gu)) {
      let depth = 0
      let end = match.index + match[0].length - 1

      for (; end < source.length; end += 1) {
        if (source[end] === '(') depth += 1
        if (source[end] === ')') depth -= 1
        if (depth === 0) break
      }

      const args = source.slice(match.index + match[0].length, end)

      if (
        /[?&](?:referralCode|referral)=/iu.test(args) ||
        /\$\{[^}]*referral[^}]*\}/iu.test(args)
      ) {
        found.push(args.trim())
      }
    }

    return found
  }

  it.each(SPECS)(
    '%s types no written code, opens no address with one, and pictures none',
    (file) => {
      const source = withoutComments(readFileSync(join(e2e, file), 'utf8'))

      expect(literalCodeFills(source), 'a referral code written into the spec').toEqual([])
      expect(generatedCodeLiterals(source), 'a generated code copied into the spec').toEqual([])
      expect(gotosWithCode(source), 'an address with a code in it').toEqual([])

      if (NAMES_A_REFERRAL_CODE.test(source)) {
        expect(turnsArtefactsOff(source), 'reaches a referral code with artefacts on').toBe(true)
      }
    },
  )

  it('names a referral code the way the field, the administrators’ screens and the contract do', () => {
    const read = (...parts) => readFileSync(join(webRoot, ...parts), 'utf8')
    const codes = ['src', 'app', 'admin', 'referral-codes']

    expect(read('src', 'components', 'referral-code-field.jsx')).toContain(
      "label: 'Referral code (optional)'",
    )
    expect(read(...codes, 'copy-code-button.jsx')).toMatch(
      /'Copy code'[\s\S]*'Copy referral code'/u,
    )
    expect(read(...codes, 'referral-code-form.jsx')).toContain('/v1/platform/referral-codes')
    expect(read('..', '..', 'packages', 'schemas', 'src', 'payment-terms.js')).toMatch(
      /referralCode: referralCodeStringSchema/u,
    )

    for (const name of [
      'Referral code (optional)',
      'Copy code',
      '/admin/referral-codes',
      'referralCode',
    ]) {
      expect(NAMES_A_REFERRAL_CODE.test(name), name).toBe(true)
    }
  })

  describe('the rules themselves', () => {
    const off = "test.use({ screenshot: 'off', trace: 'off', video: 'off' })"

    it('refuses a code typed from the spec, and takes one read from the page or the seed', () => {
      expect(
        literalCodeFills(
          "  await page.getByLabel('Referral code (optional)').fill('WAIVE-12345')\n",
        ),
      ).toEqual(['WAIVE-12345'])
      // Chained over lines, and typed in lower case as a buyer might.
      expect(
        literalCodeFills(
          "  await page\n    .getByRole('textbox', { name: /referral code/i })\n    .fill('waive-12345')\n",
        ),
      ).toEqual(['waive-12345'])
      expect(
        literalCodeFills(
          "  await page.getByLabel('Referral code (optional)').fill(seed.referralCode)\n",
        ),
      ).toEqual([])
      // A promo code is the organiser's, typed into its own field.
      expect(literalCodeFills("  await page.getByLabel('Promo code').fill('FREEALL')\n")).toEqual(
        [],
      )
      expect(generatedCodeLiterals("const code = 'K7HQ2-PX9WM'")).toEqual(['K7HQ2-PX9WM'])
      expect(generatedCodeLiterals("const night = 'night-1'")).toEqual([])
      expect(generatedCodeLiterals("headers['retry-after']")).toEqual([])
    })

    it('refuses an address with a code in it, and takes the administrators’ pages', () => {
      expect(gotosWithCode('await page.goto(`/events/diwali?referralCode=${code}`)')).toHaveLength(
        1,
      )
      expect(
        gotosWithCode('await page.goto(`/admin/referral-codes/${referralCode}`)'),
      ).toHaveLength(1)
      expect(gotosWithCode("await page.goto('/admin/referral-codes')")).toEqual([])
      expect(gotosWithCode('await page.goto(`/admin/referral-codes/${row.id}`)')).toEqual([])
      expect(gotosWithCode('await page.goto(`/events?q=${encodeURIComponent(tag)}`)')).toEqual([])
    })

    it('refuses a spec that reaches a code with artefacts on, and accepts one that turns them off', () => {
      const reaches =
        "test('copies', async ({ page }) => {\n  await page.goto('/admin/referral-codes')\n})"

      expect(NAMES_A_REFERRAL_CODE.test(withoutComments(reaches))).toBe(true)
      expect(turnsArtefactsOff(withoutComments(reaches))).toBe(false)
      expect(turnsArtefactsOff(withoutComments(`${off}\n${reaches}`))).toBe(true)
      // The limitations page's title names codes in general, and reaches none.
      expect(NAMES_A_REFERRAL_CODE.test("['Rewards for referral codes', 'NOT IMPLEMENTED']")).toBe(
        false,
      )
      // A comment naming a code reaches nothing.
      expect(
        NAMES_A_REFERRAL_CODE.test(withoutComments('// referral codes come later\nconst a = 1')),
      ).toBe(false)
    })
  })
})
