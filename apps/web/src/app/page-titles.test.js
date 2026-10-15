/**
 * Every page names itself, and no title can carry a credential.
 *
 * A tab strip, a history list and a screen reader's first words are all the
 * page title. Every route gives one — statically, or from `generateMetadata`
 * — and the pages that show a ticket, an order or a transfer use a fixed word
 * rather than anything read from the thing on screen: a title travels into
 * history, bookmarks and shared screenshots, where a ticket code or an order
 * reference has no business being.
 *
 * @module app/page-titles.test
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const HERE = path.dirname(fileURLToPath(import.meta.url))

/**
 * Every `page.jsx` under the app directory.
 *
 * @param {string} directory Where to look, relative to the app directory.
 * @returns {string[]} Paths relative to the app directory.
 */
function pages(directory = '.') {
  const found = []

  for (const entry of readdirSync(path.join(HERE, directory))) {
    const relative = path.join(directory, entry)

    if (statSync(path.join(HERE, relative)).isDirectory()) found.push(...pages(relative))
    else if (entry === 'page.jsx') found.push(path.normalize(relative))
  }

  return found
}

const PAGES = pages()

/** The front page takes the site's default title from the root layout. */
const DEFAULT_TITLED = new Set(['page.jsx'])

/** Pages about one ticket, order or transfer: their title is a fixed word. */
const FIXED_TITLE = [
  'tickets/page.jsx',
  path.join('tickets', '[id]', 'page.jsx'),
  path.join('tickets', 'accept', 'page.jsx'),
  path.join('account', 'orders', '[reference]', 'page.jsx'),
  path.join('account', 'transfers', 'page.jsx'),
]

describe('page titles', () => {
  it('finds the pages it is about', () => {
    expect(PAGES.length).toBeGreaterThan(40)
  })

  it.each(PAGES.filter((page) => !DEFAULT_TITLED.has(page)))('%s names itself', (page) => {
    const source = readFileSync(path.join(HERE, page), 'utf8')

    expect(/\btitle:\s*['`]|generateMetadata/u.test(source), `${page} sets no title`).toBe(true)
  })

  it.each(FIXED_TITLE)('%s titles itself with a fixed word, not with what it shows', (page) => {
    const source = readFileSync(path.join(HERE, page), 'utf8')

    expect(source).not.toMatch(/generateMetadata/u)
    expect(source).toMatch(/export const metadata = \{[^}]*title: '[^'$`]+'/u)
  })
})
