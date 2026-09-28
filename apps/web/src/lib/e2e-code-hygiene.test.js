/**
 * Where an end-to-end spec may show an invitation code.
 *
 * An invitation code is a credential: whoever types it first, signed in as the
 * invited address, joins the organisation in the role it names. This build
 * sends no email, so the code is shown once, in the page, to whoever invited
 * somebody (`components/one-time-code-panel.jsx`), and the API answers it in
 * the response body as `delivery.invitationCode`. A spec that invites
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

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const e2e = join(webRoot, 'e2e')

/** What means a spec reaches a team invitation code: the API field, the paths, the controls. */
const NAMES_THE_CODE =
  /invitationCode|\/invitations\b|invite them|issue a new code|copy the code|i have handed it over/iu

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
