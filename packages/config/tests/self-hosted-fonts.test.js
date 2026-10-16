/**
 * The two faces are self-hosted, openly licensed, and the theme names them.
 *
 * ## Why this exists
 *
 * The easy way to get Anek Latin and Mukta is a `<link>` to a font service,
 * and it would work — while telling a third party about every page view, and
 * making first paint wait on somebody else's server. The site's rule is that
 * the browser asks nobody but us for anything. So the faces come from npm
 * (`@fontsource-variable/anek-latin`, `@fontsource/mukta`), their
 * `@font-face` rules are inlined into the app's stylesheet by Tailwind, and
 * the build serves the files itself.
 *
 * This pins each link of that chain: the dependency is declared, the
 * stylesheet imports exactly the files the design uses (Anek's width axis,
 * Mukta's four Latin weights), the theme's stacks lead with the family names
 * the packages declare (a stack naming a family nobody defines silently falls
 * back to the system face), the licence is one we may ship, the faces they
 * replaced are gone, and no source in the web app mentions a font service at
 * all.
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

/**
 * The packages, the family each declares in its `@font-face` rules, and the
 * stylesheets of each the app imports — no more and no fewer.
 */
const FACES = Object.freeze([
  {
    pkg: '@fontsource-variable/anek-latin',
    family: 'Anek Latin Variable',
    token: '--font-display',
    // The width axis as well as the weight: `index.css` would carry weight only.
    stylesheets: ['wdth.css'],
  },
  {
    pkg: '@fontsource/mukta',
    family: 'Mukta',
    token: '--font-sans',
    // Latin only, and only the four weights the design sets.
    stylesheets: ['latin-400.css', 'latin-500.css', 'latin-600.css', 'latin-700.css'],
  },
])

const theme = read('packages/config/src/tailwind.css')
const globals = read('apps/web/src/app/globals.css')
const web = JSON.parse(read('apps/web/package.json'))
const imports = [...globals.matchAll(/@import\s+'([^']+)'/g)].map(([, source]) => source)

describe.each(FACES)('$family', ({ pkg, family, token, stylesheets }) => {
  it('is a runtime dependency of the web app', () => {
    expect(web.dependencies[pkg]).toMatch(/^\^?\d+\.\d+\.\d+$/)
  })

  it('is imported by the app stylesheet, file by file, not linked from a font service', () => {
    expect(imports.filter((source) => source === pkg || source.startsWith(`${pkg}/`))).toEqual(
      stylesheets.map((sheet) => `${pkg}/${sheet}`),
    )
  })

  it('leads its stack in the theme, under the family name the package declares', () => {
    const stack = new RegExp(`${token}:\\s*'([^']+)'`).exec(theme)?.[1]

    expect(stack).toBe(family)

    const manifest = path.join(repoRoot, 'apps/web/node_modules', pkg, 'package.json')

    // Installed in every job that runs this suite; the check is skipped only
    // in a checkout that has never been installed, where nothing else runs.
    if (existsSync(manifest)) {
      for (const sheet of stylesheets) {
        const css = readFileSync(path.join(path.dirname(manifest), sheet), 'utf8')

        expect(css, sheet).toContain(`font-family: '${family}'`)
        // Served from the package's own files, which the build copies.
        expect(css, sheet).toMatch(/src: url\(\.\/files\/[^)]+\.woff2\)/)
      }
    }
  })

  it('is under the SIL Open Font License', () => {
    const manifest = path.join(repoRoot, 'apps/web/node_modules', pkg, 'package.json')

    if (!existsSync(manifest)) return

    expect(JSON.parse(readFileSync(manifest, 'utf8')).license).toBe('OFL-1.1')
  })
})

describe('the display face', () => {
  it('imports the width axis, and the headings use it', () => {
    const manifest = path.join(repoRoot, 'apps/web/node_modules/@fontsource-variable/anek-latin')

    if (existsSync(manifest)) {
      // The stylesheet the app imports really carries the width range a
      // condensed heading asks for.
      expect(readFileSync(path.join(manifest, 'wdth.css'), 'utf8')).toContain(
        'font-stretch: 75% 125%',
      )
    }

    // Condensed at the top of the scale, never narrower than the axis allows.
    const stretches = [...globals.matchAll(/font-stretch:\s*(\d+)%/g)].map(([, value]) =>
      Number(value),
    )

    expect(stretches.length).toBeGreaterThan(0)
    expect(stretches.every((value) => value >= 75 && value <= 100)).toBe(true)
  })

  it('falls back to a narrow system sans, and the text face to the system sans', () => {
    expect(theme).toMatch(/--font-display:[^;]*'Arial Narrow'[^;]*sans-serif;/)
    expect(theme).toMatch(/--font-sans:[^;]*sans-serif;/)
  })
})

describe('the faces they replaced', () => {
  it('are neither installed for the web app nor imported', () => {
    // Fraunces and Manrope were the Garba Nights faces. A stale import would
    // ship 270 KB nobody renders, and a stale stack would name a family that
    // no longer has a file behind it.
    for (const pkg of ['@fontsource-variable/fraunces', '@fontsource-variable/manrope']) {
      expect(web.dependencies[pkg], pkg).toBeUndefined()
      expect(
        imports.some((source) => source.startsWith(pkg)),
        pkg,
      ).toBe(false)
    }

    expect(theme).not.toMatch(/Fraunces|Manrope/)
    expect(globals).not.toMatch(/'SOFT'|'WONK'/)
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
