/**
 * No sentence in the web app claims the site sends no email.
 *
 * The site can email invitation and ticket-transfer codes when its operator
 * configures a mail server (`DELIVERY_MODE=EMAIL`), so "this site sends no
 * email" is false in that deployment. What is true in every deployment is
 * narrower: receipts, address confirmation, password resets and change notices
 * are never emailed. The copy says exactly that, and where a page's words
 * depend on how codes go out it reads the delivery mode the session reports.
 *
 * This walks every source module under `apps/web/src` — tests excepted, since
 * they name the old sentences to make sure they are gone — and fails on the
 * blanket claims, naming the file and line. A sentence is read as a reader
 * would see it, not line by line: Prettier wraps long JSX text across lines,
 * and a claim split over two lines is still the same claim.
 *
 * @module lib/email-copy.test
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

/** The web app's source directory. */
const SRC = resolve(dirname(new URL(import.meta.url).pathname), '..')

/** A sentence that is false in a deployment that emails codes. */
const BLANKET_CLAIM =
  /sends no email|does not send email|delivers no email|has no email (service|provider)/i

/**
 * Every source module under a directory, recursively, tests left out.
 *
 * @param {string} directory An absolute directory.
 * @returns {string[]} Absolute paths of the `.js` and `.jsx` modules.
 */
function sourceModules(directory) {
  const found = []

  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)

    if (statSync(path).isDirectory()) {
      found.push(...sourceModules(path))
      continue
    }

    if (!/\.(js|jsx)$/u.test(entry)) continue
    if (/\.test\.(js|jsx)$/u.test(entry)) continue

    found.push(path)
  }

  return found
}

/**
 * Whatever may stand between two words of one sentence in source text: white
 * space (line breaks and indentation included), a JSX `{' '}`, or the seam of
 * a string concatenation (`'… does not ' +` on one line, `'send email'` on the
 * next).
 */
const SEAM = /(?:\s|\{\s*(?:' '|" ")\s*\}|['"`]\s*\+\s*['"`])+/gu

/**
 * Each blanket claim a module makes, with the line it starts on.
 *
 * The module is read with every seam between words closed to one space, so a
 * sentence wrapped across lines is matched whole.
 *
 * @param {string} source The module's text.
 * @returns {Array<{line: number, text: string}>} Each claim: the line it starts
 *   on and the sentence around it, white space collapsed.
 */
export function blanketClaims(source) {
  let text = ''
  // Where each run of the collapsed text came from: `at` in the text, `from`
  // in the source. A seam's single space maps to where the seam began.
  const runs = []
  let from = 0

  for (const seam of source.matchAll(SEAM)) {
    runs.push({ at: text.length, from })
    text += source.slice(from, seam.index)
    runs.push({ at: text.length, from: seam.index })
    text += ' '
    from = seam.index + seam[0].length
  }
  runs.push({ at: text.length, from })
  text += source.slice(from)

  /** The source line a position in the collapsed text came from. */
  const lineAt = (position) => {
    const run = runs.findLast(({ at }) => at <= position)
    const offset = run.from + (position - run.at)

    return source.slice(0, offset).split('\n').length
  }

  return [...text.matchAll(new RegExp(BLANKET_CLAIM.source, 'giu'))].map((claim) => ({
    line: lineAt(claim.index),
    text: text.slice(Math.max(0, claim.index - 40), claim.index + claim[0].length + 40).trim(),
  }))
}

describe('email copy', () => {
  it('walks the real source tree', () => {
    const modules = sourceModules(SRC).map((path) => relative(SRC, path))

    expect(modules.length).toBeGreaterThan(100)
    expect(modules).toContain('lib/limitations.js')
    expect(modules).toContain('components/register-form.jsx')
    expect(modules.some((path) => path.endsWith('.test.js'))).toBe(false)
  })

  it('makes no blanket claim that the site sends no email, in any module', () => {
    const offending = sourceModules(SRC).flatMap((path) =>
      blanketClaims(readFileSync(path, 'utf8')).map(
        ({ line, text }) => `${relative(SRC, path)}:${line}: ${text}`,
      ),
    )

    expect(offending).toEqual([])
  })

  it('would catch each of the old sentences', () => {
    for (const sentence of [
      'This site sends no email, so it is not confirmed.',
      'This build does not send email, so tell ticket holders yourself as well.',
      'This build delivers no email: no receipts.',
      'this build has no email service to deliver the link',
      'This build has no email provider.',
    ]) {
      expect(blanketClaims(sentence), sentence).toHaveLength(1)
    }
  })

  it('reads a sentence wrapped across lines as one sentence, and names the line it starts on', () => {
    // As Prettier lays out long JSX text: the claim split between two lines.
    const wrapped = [
      '      <p className="text-sm text-ink-muted">',
      '        A notice is recorded for every current order. This build does not',
      '        send email, so tell ticket holders yourself as well.',
      '      </p>',
    ].join('\n')

    expect(blanketClaims(wrapped)).toEqual([
      {
        line: 2,
        text: expect.stringContaining('This build does not send email, so tell ticket holders'),
      },
    ])

    // A JSX `{' '}` at the end of a line, and a string concatenation split
    // over two lines, are seams of the same kind.
    expect(blanketClaims("This site sends{' '}\n  no email.")).toHaveLength(1)
    expect(blanketClaims("const copy =\n  'This build has no email ' +\n  'service.'")).toEqual([
      { line: 2, text: expect.stringContaining('has no email service') },
    ])
    // Two claims in one module are two findings, each on its own line.
    expect(
      blanketClaims('One sends no email.\nTwo\ndelivers no email.').map(({ line }) => line),
    ).toEqual([1, 3])
  })

  it('lets through what is true in every deployment', () => {
    for (const sentence of [
      'Notices are not emailed, so tell ticket holders yourself as well.',
      'Tickets are kept in your account; receipts are not emailed.',
      'You sign in with it. Addresses are not confirmed by email on this site.',
      'This site does not email receipts, confirmation links or password resets.',
      'The code is emailed to that address. You will not see it.',
    ]) {
      expect(blanketClaims(sentence), sentence).toHaveLength(0)
    }
  })
})
