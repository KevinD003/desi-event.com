/**
 * A loading boundary must not sit above a page that changes its status code.
 *
 * A `loading.jsx` wraps every page and nested layout below it in a Suspense
 * boundary, and once its fallback has streamed the response headers are gone:
 * a `notFound()` or `redirect()` underneath it can no longer set a 404 or a
 * 307, only draw one into a 200. The public event pages depend on real 404s
 * (finding WI1 of an earlier phase), so this pins the rule for every boundary
 * that exists, including ones added later.
 *
 * The segment's own `layout.jsx` is outside its boundary, which is why the area
 * layouts may still redirect a signed-out visitor.
 *
 * @module app/loading-boundaries.test
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const appDir = path.dirname(fileURLToPath(import.meta.url))

/**
 * Every file under a directory, recursively.
 *
 * @param {string} dir The directory.
 * @returns {string[]} Absolute paths.
 */
function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)

    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

/**
 * Source with comments removed, so an explanation that names `notFound()` is
 * not mistaken for a call.
 *
 * @param {string} source The file.
 * @returns {string} The code.
 */
function code(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const boundaries = walk(appDir).filter((file) => path.basename(file) === 'loading.jsx')

describe('loading boundaries', () => {
  it('exist for the signed-in areas', () => {
    const areas = boundaries.map((file) => path.basename(path.dirname(file))).sort()

    expect(areas).toEqual(
      expect.arrayContaining([
        'account',
        'analytics',
        'finance',
        'moderation',
        'operations',
        'organizer',
        'privacy',
        'retention',
        'tickets',
      ]),
    )
  })

  it.each(boundaries.map((file) => [path.relative(appDir, file)]))(
    '%s wraps no page or nested layout that sets a status by notFound() or redirect()',
    (relative) => {
      const segment = path.dirname(path.join(appDir, relative))
      const ownLayout = path.join(segment, 'layout.jsx')
      const wrapped = walk(segment).filter(
        (file) => /(^|\/)(page|layout)\.jsx$/.test(file) && file !== ownLayout,
      )
      const offenders = wrapped.filter((file) =>
        /\b(notFound|redirect|permanentRedirect)\s*\(/.test(code(readFileSync(file, 'utf8'))),
      )

      expect(offenders.map((file) => path.relative(appDir, file))).toEqual([])
    },
  )

  it('would catch a wrapped page that 404s', () => {
    // Proves the pattern can fail, not only that it passes today.
    expect(/\b(notFound|redirect|permanentRedirect)\s*\(/.test(code('  notFound()\n'))).toBe(true)
    expect(/\b(notFound|redirect|permanentRedirect)\s*\(/.test(code('  // notFound()\n'))).toBe(
      false,
    )
  })
})
