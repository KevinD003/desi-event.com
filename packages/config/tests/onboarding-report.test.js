/**
 * `docs/PHASE4_ONBOARDING_ANALYTICS_REPORT.md`, checked against the tree.
 *
 * The report is written for the site's owner, who acts on it without reading
 * the code. Three of its promises are mechanical, so they are held here:
 *
 * 1. Its §Limitations table is the public limitations page "word for word" —
 *    the page's name, status and sentence for every entry, in the page's order.
 * 2. Every control it, the README or the development guide tells a reader to
 *    choose, tick or press is a label the web app really shows. The first
 *    version told the owner to choose "Reissue" on the invitations list, whose
 *    button says "Issue a new code".
 * 3. Its list of what needs the owner's own accounts or machines names each
 *    one this build cannot provide: a mail server, somewhere to host the site,
 *    a Stripe account for real payments. Since 2026-10-15 importing listed
 *    events needs no machine of its own (nothing is fetched), so the list must
 *    no longer send the owner to set one up.
 *
 * What this does not check: whether a sentence is true. A reader comparing the
 * report with the code catches that; this catches the drift a reader cannot
 * see from the report alone.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/**
 * A repository file, as text.
 *
 * @param {...string} parts Path segments from the repository root.
 * @returns {string} Its contents.
 */
function read(...parts) {
  return readFileSync(path.join(repoRoot, ...parts), 'utf8')
}

const report = read('docs', 'PHASE4_ONBOARDING_ANALYTICS_REPORT.md')

/**
 * One section of a Markdown document: from its `## ` heading to the next.
 *
 * @param {string} text The document.
 * @param {string} heading The heading's words, after `## `.
 * @returns {string} The section, heading included.
 */
function section(text, heading) {
  const start = text.indexOf(`\n## ${heading}\n`)

  expect(start, `no "## ${heading}" section`).toBeGreaterThan(-1)

  const end = text.indexOf('\n## ', start + 1)

  return text.slice(start, end === -1 ? undefined : end)
}

/**
 * Every source file of the web app that is not a test, as one text.
 *
 * @returns {string} Their contents, joined.
 */
function webSource() {
  const texts = []
  const walk = (directory) => {
    for (const entry of readdirSync(directory)) {
      const full = path.join(directory, entry)

      if (statSync(full).isDirectory()) walk(full)
      else if (/\.(?:js|jsx)$/u.test(entry) && !/\.test\.(?:js|jsx)$/u.test(entry)) {
        texts.push(readFileSync(full, 'utf8'))
      }
    }
  }

  walk(path.join(repoRoot, 'apps', 'web', 'src'))

  return texts.join('\n')
}

describe('the onboarding and analytics report', () => {
  it('mirrors the limitations page, entry by entry and word for word', async () => {
    const { LIMITATIONS } = await import(
      pathToFileURL(path.join(repoRoot, 'apps', 'web', 'src', 'lib', 'limitations.js')).href
    )
    const rows = section(report, '§Limitations')
      .split('\n')
      .filter((line) => line.startsWith('| ') && !line.startsWith('| Capability'))
      .filter((line) => !/^\|\s*-/u.test(line))
      .slice(0, LIMITATIONS.length)
      .map((line) =>
        line
          .split('|')
          .slice(1, -1)
          .map((cell) => cell.trim()),
      )

    expect(rows).toEqual(
      LIMITATIONS.map((limitation) => [
        limitation.name,
        `**${limitation.status}**`,
        limitation.meaning,
      ]),
    )
  })

  it('names only controls the web app shows when it tells the reader what to choose', () => {
    const source = webSource()
    const documents = {
      'docs/PHASE4_ONBOARDING_ANALYTICS_REPORT.md': report,
      'docs/development.md': read('docs', 'development.md'),
      'README.md': read('README.md'),
    }
    const named = []

    for (const [name, text] of Object.entries(documents)) {
      const prose = text.replace(/\s+/gu, ' ')

      for (const match of prose.matchAll(
        /\b(?:choose|chooses|tick|ticks|press|presses)\s+["“]([^"”]+)["”]/gu,
      )) {
        named.push([name, match[1]])
      }
    }

    // Not vacuous: the seeded invitation's instructions name its button.
    expect(named.map(([, label]) => label)).toContain('Issue a new code')
    for (const [name, label] of named) {
      expect(source.includes(label), `${name} names "${label}", which no screen shows`).toBe(true)
    }
  })

  it('names each account or machine this build cannot provide', () => {
    const needs = section(report, 'What needs your accounts or your machines')

    expect(needs).toMatch(/SMTP/u)
    // The importer makes no outbound request (2026-10-15), so no machine that
    // reaches the source's picture host is needed any more, and none is named.
    expect(needs).not.toMatch(/usimg|sulekha|Retry pictures/iu)
    expect(needs).toMatch(/no\s+outbound\s+request/u)
    expect(needs).toMatch(/\bhost(?:ing)?\b/iu)
    expect(needs).toMatch(/\bStripe\b/u)
  })
})
