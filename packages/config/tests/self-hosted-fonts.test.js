/**
 * The two faces are self-hosted, openly licensed, and the theme names them.
 *
 * ## Why this exists
 *
 * The easy way to get Fraunces and Manrope is a `<link>` to a font service,
 * and it would work — while telling a third party about every page view, and
 * making first paint wait on somebody else's server. The site's rule is that
 * the browser asks nobody but us for anything. So the faces come from npm
 * (`@fontsource-variable/*`), their `@font-face` rules are inlined into the
 * app's stylesheet by Tailwind, and the build serves the files itself.
 *
 * This pins each link of that chain: the dependency is declared, the
 * stylesheet imports it, the theme's stacks lead with the family names the
 * packages declare (a stack naming a family nobody defines silently falls
 * back to Georgia), the licence is one we may ship, and no source in the web
 * app mentions a font service at all.
 *
 * @module
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/**
 * A repository file's contents.
 *
 * @param {string} file Repository-relative path.
 * @returns {string} The file.
 */
function read(file) {
  return readFileSync(path.join(repoRoot, file), 'utf8')
}

/** The packages, and the family each declares in its `@font-face` rules. */
const FACES = Object.freeze([
  { pkg: '@fontsource-variable/fraunces', family: 'Fraunces Variable', token: '--font-display' },
  { pkg: '@fontsource-variable/manrope', family: 'Manrope Variable', token: '--font-sans' },
])

const theme = read('packages/config/src/tailwind.css')
const globals = read('apps/web/src/app/globals.css')
const web = JSON.parse(read('apps/web/package.json'))

describe.each(FACES)('$family', ({ pkg, family, token }) => {
  it('is a runtime dependency of the web app', () => {
    expect(web.dependencies[pkg]).toMatch(/^\^?\d+\.\d+\.\d+$/)
  })

  it('is imported by the app stylesheet, not linked from a font service', () => {
    const imports = [...globals.matchAll(/@import\s+'([^']+)'/g)].map(([, source]) => source)

    expect(imports.some((source) => source === pkg || source.startsWith(`${pkg}/`))).toBe(true)
  })

  it('leads its stack in the theme, under the family name the package declares', () => {
    const stack = new RegExp(`${token}:\\s*'([^']+)'`).exec(theme)?.[1]

    expect(stack).toBe(family)

    const manifest = path.join(repoRoot, 'apps/web/node_modules', pkg, 'package.json')

    // Installed in every job that runs this suite; the check is skipped only
    // in a checkout that has never been installed, where nothing else runs.
    if (existsSync(manifest)) {
      const css = readFileSync(path.join(path.dirname(manifest), 'index.css'), 'utf8')

      expect(css).toContain(`font-family: '${family}'`)
    }
  })

  it('is under the SIL Open Font License', () => {
    const manifest = path.join(repoRoot, 'apps/web/node_modules', pkg, 'package.json')

    if (!existsSync(manifest)) return

    expect(JSON.parse(readFileSync(manifest, 'utf8')).license).toBe('OFL-1.1')
  })
})

describe('the display face', () => {
  it('imports the stylesheet with the opsz and SOFT axes the headings use', () => {
    // `index.css` carries only the weight axis; `full.css` carries opsz,
    // SOFT and WONK, which the headings' `font-variation-settings` need.
    expect(globals).toContain("@import '@fontsource-variable/fraunces/full.css'")
    expect(globals).toMatch(/font-variation-settings:\s*'SOFT' 50/)
  })

  it('falls back to a serif, and the text face to the system sans', () => {
    expect(theme).toMatch(/--font-display:[^;]*serif;/)
    expect(theme).toMatch(/--font-sans:[^;]*sans-serif;/)
  })
})

describe('no source in the web app reaches for a font service', () => {
  it('names no font host in any tracked source, stylesheet or config', () => {
    const files = execFileSync(
      'git',
      ['ls-files', '--', 'apps/web/src', 'apps/web/next.config.mjs', 'packages/ui/src'],
      { cwd: repoRoot, encoding: 'utf8' },
    )
      .split('\n')
      .filter((file) => /\.(jsx?|mjs|css)$/.test(file))

    // The globals are read directly too, so the check holds while they are
    // being edited and before they are committed.
    const sources = [...new Set([...files, 'apps/web/src/app/globals.css'])]
    const offences = sources.filter((file) =>
      /fonts\.googleapis\.com|fonts\.gstatic\.com|use\.typekit\.net|fonts\.bunny\.net/.test(
        read(file),
      ),
    )

    expect(sources.length).toBeGreaterThan(100)
    expect(offences).toEqual([])
  })
})
