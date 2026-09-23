/**
 * Only the door interrupts.
 *
 * An assertive live region cuts the screen reader off mid-sentence. That is
 * right for a steward who must not wave somebody through on a refused ticket,
 * and wrong for a failed save, a refused filter or a finance notice: a page
 * that interrupts for everything teaches people to stop listening. So the rule
 * is written down here, as a check on the source, rather than left to each
 * component's author:
 *
 * - no `role="alert"` and no `aria-live="assertive"` anywhere in the web app;
 * - `Alert`'s `urgent` — the one way to get an assertive region — only in the
 *   door workspace, whose outcomes are the urgent ones.
 *
 * @module components/live-region-policy.test
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/** `apps/web/src`. */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** The one module allowed to interrupt. */
const DOOR = path.join('components', 'door-workspace.jsx')

/**
 * Every source file under the web app, tests excluded.
 *
 * @param {string} directory Where to start, relative to {@link ROOT}.
 * @returns {string[]} Paths relative to {@link ROOT}.
 */
function sources(directory = '.') {
  const found = []

  for (const entry of readdirSync(path.join(ROOT, directory))) {
    const relative = path.join(directory, entry)

    if (statSync(path.join(ROOT, relative)).isDirectory()) {
      found.push(...sources(relative))
    } else if (/\.(jsx?|mjs)$/u.test(entry) && !/\.test\.(jsx?|mjs)$/u.test(entry)) {
      found.push(path.normalize(relative))
    }
  }

  return found
}

const FILES = sources()

/**
 * A file's code, its comments removed: a comment explaining why a region is
 * polite names the role it is not.
 *
 * @param {string} file A path relative to {@link ROOT}.
 * @returns {string} The code.
 */
function code(file) {
  return readFileSync(path.join(ROOT, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/gu, '')
    .replace(/^\s*\/\/.*$/gmu, '')
}

describe('the live-region policy', () => {
  it('reads the source it is about', () => {
    expect(FILES.length).toBeGreaterThan(50)
    expect(FILES).toContain(DOOR)
  })

  it('declares no assertive region by hand', () => {
    const offenders = FILES.filter((file) =>
      /role=["']alert["']|aria-live=["']assertive["']/u.test(code(file)),
    )

    expect(offenders).toEqual([])
  })

  it('marks an Alert urgent only at the door', () => {
    const offenders = FILES.filter(
      (file) => file !== DOOR && /<Alert\b[^>]*\surgent\b/su.test(code(file)),
    )

    expect(offenders).toEqual([])
  })

  it('does mark the door’s refusals urgent, so the rule has something to protect', () => {
    const door = readFileSync(path.join(ROOT, DOOR), 'utf8')

    expect(door.match(/<Alert\b[^>]*\surgent\b/gsu)?.length ?? 0).toBeGreaterThanOrEqual(4)
  })
})
