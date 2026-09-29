/**
 * `FormField` is built only inside client modules.
 *
 * `FormField` (from `@desi-event/ui`, through `./ui.jsx`) clones the one
 * control it is given, to give it an id and its descriptions. A Server
 * Component that renders `<FormField><Select … /></FormField>` hands that
 * control across the server–client boundary, and React may deliver it to
 * `FormField` as a lazy reference rather than an element — which cannot be
 * cloned. `FormField` then throws "FormField expects a single control element
 * or a render function as children", and the page renders the error screen.
 *
 * That is not hypothetical. The platform administrator's door filter
 * (`door-event-filter.jsx`) was a Server Component, and the browser journey in
 * `e2e/detail-platform-door.spec.js` found every server render of the door
 * page falling back to client rendering, and the filter's own Clear link — a
 * client-side navigation back to the unfiltered door — showing "Something
 * went wrong at our end" instead of the door. Unit tests could not see it:
 * they render in one environment, where every child is an element.
 *
 * So the rule is checked on the source: a module that renders `<FormField`
 * starts with the `'use client'` directive.
 *
 * @module components/form-field-boundary.test
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/** `apps/web/src`. */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Every JSX source file under the web app, tests excluded.
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
    } else if (/\.jsx$/u.test(entry) && !/\.test\.jsx$/u.test(entry)) {
      found.push(path.normalize(relative))
    }
  }

  return found
}

/**
 * Whether a module's first statement is the `'use client'` directive.
 *
 * Leading comments and blank lines are skipped, as the bundler skips them.
 *
 * @param {string} source The module's text.
 * @returns {boolean} True for a client module.
 */
function isClientModule(source) {
  const code = source.replace(/^(?:\s*(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/))*\s*/u, '')

  return /^(['"])use client\1;?/u.test(code)
}

/**
 * Whether a module renders `FormField` as a JSX element.
 *
 * @param {string} source The module's text.
 * @returns {boolean} True when it does.
 */
function rendersFormField(source) {
  return /<FormField[\s>]/u.test(source)
}

const FILES = sources()

describe('where FormField may be built', () => {
  it('finds modules that render it, so the rule below is not empty', () => {
    const rendering = FILES.filter((file) =>
      rendersFormField(readFileSync(path.join(ROOT, file), 'utf8')),
    )

    expect(rendering.length).toBeGreaterThan(0)
    expect(rendering).toContain(path.join('components', 'door-event-filter.jsx'))
  })

  it.each(FILES)('%s renders FormField only as a client module', (file) => {
    const source = readFileSync(path.join(ROOT, file), 'utf8')

    if (!rendersFormField(source)) return

    expect(isClientModule(source), `${file} renders <FormField> without 'use client'`).toBe(true)
  })
})

describe('the invariant itself', () => {
  it('takes a directive after a leading comment', () => {
    expect(isClientModule("// note\n/** doc */\n'use client'\n\nexport function A() {}")).toBe(true)
    expect(isClientModule('"use client";\nexport function A() {}')).toBe(true)
  })

  it('does not take a directive that is not the first statement', () => {
    expect(isClientModule("import x from 'y'\n'use client'\n")).toBe(false)
    expect(isClientModule("/** 'use client' is not here */\nexport function A() {}")).toBe(false)
  })

  it('sees FormField rendered, and not merely named', () => {
    expect(rendersFormField('<FormField label="x">')).toBe(true)
    expect(rendersFormField('<FormField\n  label="x"\n>')).toBe(true)
    expect(rendersFormField("import { FormField } from './ui.jsx'")).toBe(false)
    expect(rendersFormField('<FormFieldset>')).toBe(false)
  })
})
