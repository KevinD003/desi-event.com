/**
 * Where an end-to-end spec may show an entry pass.
 *
 * A pass is a bearer credential: whoever presents it first is admitted, and a
 * picture of it is as good as the screen it came from. Playwright takes
 * pictures. Under `screenshot: 'only-on-failure'` it screenshots every page in
 * a context as that context closes and keeps the picture if the test failed,
 * and on a timeout it screenshots every page still open. A trace records the
 * page, and a video records everything. So a spec that presses **Show my entry
 * pass** against the real API can leave a working ticket in a test artefact,
 * and closing the context in a `finally` does not prevent it.
 *
 * A group pass is the same kind of credential for a whole order: its QR and
 * printed `DEG-` code admit every ticket the buyer still holds. **Show group
 * pass** (`components/group-pass.jsx`) fetches and draws it, so the same rule
 * applies to that control, with its own endpoint.
 *
 * `screenshot`, `trace` and `video` are worker-scoped options. `test.use` can
 * set them only at the top of a file, never for one case inside a `describe`.
 * That leaves two safe ways to press the control, and this file accepts either:
 *
 * - The file turns all three off at its top level:
 *   `test.use({ screenshot: 'off', trace: 'off', video: 'off' })`.
 *   `detail-organizer-checkin.spec.js`, which draws a real pass and scans it,
 *   does this.
 * - Every case that presses the control answers the pass request itself, with
 *   `route(…/pass…)` (for a group pass, `route(…/group-pass…)`) and
 *   `fulfill(…)`, so the real pass is never fetched. A route for one kind of
 *   pass does not guard a press of the other.
 *
 * This became a rule after the sweep's pass case was found showing a live pass
 * under `only-on-failure`, with a comment claiming the `finally` protected it
 * (audit finding QRC-9f).
 *
 * ## What this reads, and where it stops
 *
 * It reads the text of each spec. It does not run or parse it, so it is
 * deliberately conservative, and each limit below errs towards failing:
 *
 * - Whole-line comments and comment blocks that start a line are removed
 *   first, so a commented-out route or `test.use` does not count. A comment
 *   after code on the same line is not removed: if it names the control, the
 *   file is treated as pressing it.
 * - A spec "presses the control" when its code names it, ignoring letter
 *   case. A press written some other way — a looser regular expression, a
 *   label built at run time — is not seen. That is why `names the control the
 *   way the component labels it` pins the label to the component: if the
 *   button is renamed, this file has to be revisited.
 * - A case is the text from one `test('…'` to the next case, hook, `describe`
 *   or top-level declaration. A route has to be written in the case that
 *   presses the control, before the press: one set up in a hook or a helper is
 *   not seen, and the case fails. Its handler is the text from the route to the
 *   next route or the press; it has to fulfil there and must not continue,
 *   fall back or fetch. A press in a helper, a hook or anywhere outside a case
 *   cannot be tied to a route at all, so it is accepted only under the
 *   file-level `test.use`.
 * - The endpoint is pinned to the component too, so a moved fetch cannot leave
 *   a route guarding a path nothing requests.
 * - Replacing a group pass (`…/group-pass/rotate`) answers no secret; the new
 *   pass is drawn by the same fetch as **Show group pass**, and that control is
 *   the only way to reach **Replace group pass**, so the press is what counts.
 *
 * @module lib/e2e-pass-hygiene.test
 */

import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const e2e = join(webRoot, 'e2e')

/**
 * Each control that fetches and draws a pass, the route that has to answer
 * its request instead of the server, and where the component labels it and
 * fetches it.
 */
const PASSES = [
  {
    name: 'entry pass',
    label: 'Show my entry pass',
    control: /show my entry pass/iu,
    route: /\.route\(\s*[^,\n]*\/pass\b/u,
    component: 'ticket-pass.jsx',
    fetch: /apiFetch\(`\/v1\/tickets\/\$\{[^}]+\}\/pass`/u,
  },
  {
    name: 'group pass',
    label: 'Show group pass',
    control: /show group pass/iu,
    route: /\.route\(\s*[^,\n]*\/group-pass\b/u,
    component: 'group-pass.jsx',
    fetch: /`\/v1\/orders\/\$\{encodeURIComponent\(reference\)\}\/group-pass`/u,
  },
]

/** Any control that fetches and draws a pass. */
const PASS_CONTROL = new RegExp(PASSES.map(({ control }) => control.source).join('|'), 'iu')

/** Where a case starts: `test('…'`, and its `only`, `skip`, `fixme` and `fail` forms. */
const CASE_START = /^[ \t]*test(?:\.(?:only|skip|fixme|fail))?\(\s*(['"`])(.*?)\1/gmu

/**
 * Where something that is not a case starts: a hook, a `describe`, or a
 * top-level declaration. Each ends the case before it.
 */
const OTHER_START =
  /^(?:[ \t]*test\.(?:describe(?:\.\w+)?|beforeAll|beforeEach|afterAll|afterEach)\(|(?:export\s+)?(?:async\s+)?function\b|(?:const|let)\s)/gmu

/** A route answered in the test, rather than continued to the server. */
const FULFIL = /\.fulfill\(/u

/** A route handler that sends the request on to the server after all. */
const PASS_THROUGH = /\.(?:continue|fallback|fetch)\(/u

/** Where any route is set up. */
const ANY_ROUTE = /\.route\(/u

/** A `test.use({ … })` at the top level of the file, where worker options may go. */
const FILE_LEVEL_USE = /^test\.use\(\s*\{([^}]*)\}\s*\)/gmu

/**
 * The file with its whole-line comments removed.
 *
 * Only comments that start a line: a `/*` inside a string on a line of code,
 * such as a glob, is left alone rather than taken for the start of a comment
 * that would swallow the code after it.
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
 * The file cut into cases and everything else.
 *
 * @param {string} source The file, comments removed.
 * @returns {Array<{title: string|null, text: string}>} Each piece; `title` is null outside a case.
 */
function pieces(source) {
  const starts = [
    ...[...source.matchAll(CASE_START)].map((match) => ({ at: match.index, title: match[2] })),
    ...[...source.matchAll(OTHER_START)].map((match) => ({ at: match.index, title: null })),
  ].sort((a, b) => a.at - b.at)

  return [
    { title: null, text: source.slice(0, starts[0]?.at ?? source.length) },
    ...starts.map((start, index) => ({
      title: start.title,
      text: source.slice(start.at, starts[index + 1]?.at ?? source.length),
    })),
  ]
}

/**
 * Whether a case answers one kind of pass request itself before it presses
 * that control: a route naming that pass's endpoint, set up before the press,
 * whose handler — the text from that route to the next route or the next press
 * of any pass control, whichever comes first — fulfils the request and never
 * sends it on. A fulfil anywhere else in the case, for some other request, does
 * not count, and neither does a route for the other kind of pass.
 *
 * @param {string} text One case, comments removed.
 * @param {{control: RegExp, route: RegExp}} pass The kind of pass: its control and the route that answers it.
 * @returns {boolean} True when the real pass cannot be fetched by the press.
 */
function answersFirst(text, pass) {
  const press = text.search(pass.control)
  const at = text.search(pass.route)

  if (at < 0 || press < 0 || at > press) return false

  const after = text.slice(at + 1)
  const ends = [after.search(ANY_ROUTE), after.search(PASS_CONTROL)].filter((end) => end >= 0)
  const handler = after.slice(0, Math.min(after.length, ...ends))

  return FULFIL.test(handler) && !PASS_THROUGH.test(handler)
}

/**
 * Whether a case answers every pass request it causes before it presses the
 * control that causes it.
 *
 * @param {string} text One case, comments removed.
 * @returns {boolean} True when no real pass can be fetched by the case.
 */
function answersPassFirst(text) {
  return PASSES.filter(({ control }) => control.test(text)).every((pass) =>
    answersFirst(text, pass),
  )
}

/**
 * Where a spec presses the pass control with nothing keeping the pass out of
 * an artefact.
 *
 * @param {string} raw The spec, as written.
 * @returns {string[]} The case titles, or `outside any case`, that do so.
 */
function unguardedPresses(raw) {
  const source = withoutComments(raw)

  if (!PASS_CONTROL.test(source) || turnsArtefactsOff(source)) return []

  return pieces(source)
    .filter(({ text }) => PASS_CONTROL.test(text))
    .filter(({ title, text }) => title === null || !answersPassFirst(text))
    .map(({ title }) => title ?? 'outside any case')
}

/** Every Playwright spec, by file name. */
const SPECS = readdirSync(e2e)
  .filter((name) => name.endsWith('.spec.js'))
  .sort()

describe('the entry pass in end-to-end specs', () => {
  it.each(SPECS)('%s never shows a real pass where an artefact could keep it', (file) => {
    expect(unguardedPresses(readFileSync(join(e2e, file), 'utf8'))).toEqual([])
  })

  it.each(PASSES)('has specs that press the $name control, so the rule is not empty', (pass) => {
    const pressing = SPECS.filter((file) =>
      pass.control.test(withoutComments(readFileSync(join(e2e, file), 'utf8'))),
    )

    expect(pressing.length).toBeGreaterThan(0)
  })

  it.each(PASSES)('names the $name control the way the component labels it', (pass) => {
    // If the button is relabelled, every pattern above stops matching and the
    // rule passes by seeing nothing. This makes the rename fail here instead.
    const component = readFileSync(join(webRoot, 'src', 'components', pass.component), 'utf8')

    expect(component).toContain(pass.label)
    expect(pass.control.test(pass.label)).toBe(true)
    // And the endpoint a route has to answer: if the component fetched the pass
    // from somewhere else, a route on the old path would let the real pass
    // through while this file still saw a guarded case.
    expect(component).toMatch(pass.fetch)
  })
})

describe('the invariant itself', () => {
  const press = `    await page.getByRole('button', { name: 'Show my entry pass' }).click()`
  const route = [
    '    await context.route(`**/api/v1/tickets/${id}/pass`, (route) =>',
    "      route.fulfill({ status: 200, body: '{}' }),",
    '    )',
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
      "test.describe('door', () => {",
      "  test('shows it', async ({ page }) => {",
      press,
      '  })',
      '})',
    )

    expect(unguardedPresses(raw)).toEqual([])
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
    const raw = spec(use, "test('shows it', async ({ page }) => {", press, '})')

    expect(unguardedPresses(raw)).toEqual(['shows it'])
  })

  it('does not count a test.use inside a describe, where Playwright refuses one anyway', () => {
    const raw = spec(
      "test.describe('door', () => {",
      "  test.use({ screenshot: 'off', trace: 'off', video: 'off' })",
      "  test('shows it', async ({ page }) => {",
      press,
      '  })',
      '})',
    )

    expect(unguardedPresses(raw)).toEqual(['shows it'])
  })

  it('accepts a case that answers the pass request itself', () => {
    const raw = spec("test('shows a stand-in', async ({ page }) => {", route, press, '})')

    expect(unguardedPresses(raw)).toEqual([])
  })

  it('refuses a case that presses the control and routes nothing', () => {
    const raw = spec(
      "test('shows a stand-in', async ({ page }) => {",
      route,
      press,
      '})',
      '',
      "test('shows the real one', async ({ page }) => {",
      press,
      '})',
    )

    expect(unguardedPresses(raw)).toEqual(['shows the real one'])
  })

  it('refuses a route that passes the request through to the server', () => {
    const raw = spec(
      "test('shows it', async ({ page }) => {",
      "  await page.route('**/api/v1/tickets/*/pass', (route) => route.continue())",
      press,
      '})',
    )

    expect(unguardedPresses(raw)).toEqual(['shows it'])
  })

  it('refuses a pass route set up only after the control was pressed', () => {
    const raw = spec("test('shows it', async ({ page }) => {", press, route, '})')

    expect(unguardedPresses(raw)).toEqual(['shows it'])
  })

  it('does not take a fulfil for some other request as answering the pass', () => {
    const raw = spec(
      "test('shows it', async ({ page, context }) => {",
      "  await page.route('**/api/v1/tickets/*/pass', (route) => route.continue())",
      "  await context.route('**/favicon.ico', (route) => route.fulfill({ status: 204 }))",
      press,
      '})',
    )

    expect(unguardedPresses(raw)).toEqual(['shows it'])
  })

  it('does not count a route or a test.use that has been commented out', () => {
    const raw = spec(
      "// test.use({ screenshot: 'off', trace: 'off', video: 'off' })",
      "test('shows it', async ({ page }) => {",
      route.replace(/^/gmu, '// '),
      press,
      '})',
    )

    expect(unguardedPresses(raw)).toEqual(['shows it'])
  })

  it('refuses a press in a helper, which no route in a case can be tied to', () => {
    const raw = spec(
      'async function showPass(page) {',
      press,
      '}',
      '',
      "test('shows it', async ({ page }) => {",
      route,
      '  await showPass(page)',
      '})',
    )

    expect(unguardedPresses(raw)).toEqual(['outside any case'])
  })

  describe('for a group pass', () => {
    const groupPress = `    await page.getByRole('button', { name: 'Show group pass' }).click()`
    const groupRoute = [
      '    await page.route(`**/api/v1/orders/${reference}/group-pass`, (route) =>',
      "      route.fulfill({ status: 200, body: '{}' }),",
      '    )',
    ].join('\n')

    it('refuses a case that presses Show group pass with nothing guarding it', () => {
      const raw = spec("test('shows the group', async ({ page }) => {", groupPress, '})')

      expect(unguardedPresses(raw)).toEqual(['shows the group'])
    })

    it('accepts a file that turns all three artefacts off at the top', () => {
      const raw = spec(
        "test.use({ screenshot: 'off', trace: 'off', video: 'off' })",
        "test('shows the group', async ({ page }) => {",
        groupPress,
        '})',
      )

      expect(unguardedPresses(raw)).toEqual([])
    })

    it('accepts a case that answers the group pass request itself', () => {
      const raw = spec(
        "test('shows a stand-in group', async ({ page }) => {",
        groupRoute,
        groupPress,
        '})',
      )

      expect(unguardedPresses(raw)).toEqual([])
    })

    it('does not take an entry-pass route as guarding the group pass', () => {
      const raw = spec("test('shows the group', async ({ page }) => {", route, groupPress, '})')

      expect(unguardedPresses(raw)).toEqual(['shows the group'])
    })

    it('does not take a group-pass route as guarding an entry pass', () => {
      const raw = spec("test('shows a ticket', async ({ page }) => {", groupRoute, press, '})')

      expect(unguardedPresses(raw)).toEqual(['shows a ticket'])
    })

    it('needs both routes in a case that presses both controls', () => {
      const raw = spec(
        "test('shows both', async ({ page }) => {",
        route,
        press,
        groupPress,
        '})',
        '',
        "test('guards both', async ({ page }) => {",
        route,
        groupRoute,
        press,
        groupPress,
        '})',
      )

      expect(unguardedPresses(raw)).toEqual(['shows both'])
    })

    it('refuses a group-pass route that passes the request through', () => {
      const raw = spec(
        "test('shows the group', async ({ page }) => {",
        "  await page.route('**/api/v1/orders/*/group-pass', (route) => route.continue())",
        groupPress,
        '})',
      )

      expect(unguardedPresses(raw)).toEqual(['shows the group'])
    })
  })

  it('does not treat a comment that names the control as a press', () => {
    const raw = spec(
      "// The case below never presses 'Show my entry pass'.",
      "test('lists tickets', async ({ page }) => {",
      "  await page.goto('/tickets')",
      '})',
    )

    expect(unguardedPresses(raw)).toEqual([])
  })
})
