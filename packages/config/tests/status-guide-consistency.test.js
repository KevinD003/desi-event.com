/**
 * The status reading guide, checked against itself and against the tree.
 *
 * `docs/STATUS_READING_GUIDE.md` is navigation over more than thirty
 * status-bearing documents, and it says of itself that where it and a source
 * report disagree, the guide is the one that is stale. That rule has no teeth
 * while nothing reads it.
 *
 * Two of its own claims are mechanical, so they are checked here rather than by
 * a reader who happens to scroll far enough.
 *
 * The first is internal. Three of its tables carry a status for the same phase —
 * "Current status at a glance", "Current phase index" and "Authority map" — and
 * on 2026-09-22 they did not agree: the Authority map called Phase 3's Phase 3
 * `NOT STARTED` and said its report file did not exist, while the phase index
 * twenty lines above called it `PARTIAL` and named that very file as
 * authoritative. Four days, one document, opposite answers.
 *
 * The second is external. The guide's whole job is to send a reader to a file,
 * so a file it names and the tree does not hold is a dead end.
 *
 * What this does **not** check: whether a status is *correct*. Three tables can
 * agree and all be stale together, which is exactly what the two Phase 3 —
 * Phase 4 rows were. Only a reader comparing the guide against the source report
 * catches that, and the guide already tells them to.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const guidePath = path.join(repoRoot, 'docs', 'STATUS_READING_GUIDE.md')
const guide = readFileSync(guidePath, 'utf8')

/**
 * The guide with its fenced blocks removed.
 *
 * Inline code is found by pairing backticks, and a fence is three of them — so a
 * fence shifts every pair after it by one and the scan silently stops seeing
 * real paths. It did: the first version of the check below passed against a
 * planted missing file. Fences carry shell commands and status banners, never a
 * document reference, so dropping them loses nothing.
 *
 * @type {string}
 */
const proseOnly = guide.replace(/^```[\s\S]*?^```/gm, '')

/**
 * The status vocabulary the guide uses, longest first so that
 * `COMPLETE WITH EXPLICIT OWNER DECISIONS` is never truncated to `COMPLETE`.
 *
 * @type {string[]}
 */
const STATUSES = [
  'COMPLETE WITH EXPLICIT OWNER DECISIONS',
  'EXTERNAL VERIFICATION PENDING',
  'NOT REPRODUCED',
  'NOT STARTED',
  'COMPLETE',
  'DISABLED',
  'PROPOSED',
  'PARTIAL',
  'MOCK',
]

/**
 * The three tables that carry a status, and which column holds it.
 *
 * @type {Array<{heading: string, statusColumn: number}>}
 */
const TABLES = [
  { heading: 'Current status at a glance', statusColumn: 1 },
  { heading: 'Current phase index', statusColumn: 2 },
  { heading: 'Authority map', statusColumn: 1 },
]

/**
 * Split one markdown table row into trimmed cells.
 *
 * @param {string} line A row beginning and ending with a pipe.
 * @returns {string[]} Its cells.
 */
function cells(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim())
}

/**
 * The rows of the table under a heading, header and rule excluded.
 *
 * @param {string} heading The `##` heading the table sits under.
 * @returns {string[][]} One array of cells per body row.
 */
function tableUnder(heading) {
  const start = guide.indexOf(`## ${heading}`)

  expect(start, `the guide has a "${heading}" section`).toBeGreaterThan(-1)

  const section = guide.slice(start).split('\n---')[0]
  const rows = section
    .split('\n')
    .filter((line) => line.trim().startsWith('|'))
    .map(cells)
    .filter((row) => !row.every((cell) => /^-+$/.test(cell) || cell === ''))

  expect(rows.length, `the "${heading}" table has rows`).toBeGreaterThan(1)

  return rows.slice(1)
}

/**
 * The scope a row is about, normalised so the three tables can be compared.
 *
 * The glance table qualifies its scopes in parentheses and the authority map
 * joins two with a slash; neither changes which scope is meant.
 *
 * @param {string} cell The first cell of a row.
 * @returns {string} The normalised key.
 */
function scopeKey(cell) {
  return cell
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .split(' / ')[0]
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The status a cell declares, or null when it declares none.
 *
 * Only the first backticked span counts. Prose around it explains the status
 * and regularly contains words from the vocabulary — "not a claim that its code
 * is half-finished" — which is why the search is not run over the whole cell.
 *
 * @param {string} cell The status cell.
 * @returns {string|null} The vocabulary entry it starts with.
 */
function statusIn(cell) {
  const quoted = /`([^`]+)`/.exec(cell)

  if (!quoted) return null

  return STATUSES.find((status) => quoted[1].startsWith(status)) ?? null
}

describe('the status reading guide', () => {
  it('gives one status per scope across all three of its tables', () => {
    /** @type {Map<string, Map<string, string[]>>} */
    const byScope = new Map()

    for (const { heading, statusColumn } of TABLES) {
      for (const row of tableUnder(heading)) {
        const status = statusIn(row[statusColumn] ?? '')

        if (!status) continue

        const key = scopeKey(row[0])
        const seen = byScope.get(key) ?? new Map()

        seen.set(status, [...(seen.get(status) ?? []), heading])
        byScope.set(key, seen)
      }
    }

    const disagreements = [...byScope]
      .filter(([, seen]) => seen.size > 1)
      .map(
        ([scope, seen]) =>
          `${scope}: ` +
          [...seen].map(([status, where]) => `${status} (${where.join(', ')})`).join(' vs '),
      )

    expect(disagreements).toEqual([])
  })

  it('covers every Phase 3 sub-phase in all three tables', () => {
    // The defect this suite was written for hid in a row one table had and
    // another did not bother to carry. A missing row cannot disagree.
    const phases = [
      'Phase 3 — Phase 1',
      'Phase 3 — Phase 2',
      'Phase 3 — Phase 3',
      'Phase 3 — Phase 4',
    ]

    for (const { heading } of TABLES) {
      const scopes = tableUnder(heading).map((row) => scopeKey(row[0]))

      expect(
        phases.filter((phase) => !scopes.includes(phase)),
        `missing from "${heading}"`,
      ).toEqual([])
    }
  })

  it('names no document the tree does not hold', () => {
    const named = new Set()

    for (const [, span] of proseOnly.matchAll(/`([^`]+)`/g)) {
      // Elided paths and line references are prose, not lookups.
      if (span.includes('…') || span.includes(':') || span.includes(' ')) continue
      if (!/^[\w./-]+\.(?:md|js|mjs|cjs|json|sql)$/.test(span)) continue

      named.add(span)
    }

    expect(named.size, 'the guide names documents at all').toBeGreaterThan(10)

    const missing = [...named].filter((file) => !existsSync(path.join(repoRoot, file))).sort()

    expect(missing).toEqual([])
  })
})
