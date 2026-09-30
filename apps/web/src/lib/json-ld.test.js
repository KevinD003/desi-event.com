import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { JsonLd } from '../components/json-ld.jsx'
import { eventJsonLd } from './event-jsonld.js'
import { serializeJsonLd } from './json-ld.js'

const LINE_SEPARATOR = String.fromCharCode(0x2028)
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029)

/** An organiser's words that close the element they are inlined in. */
const breakout = '</script><script>window.__pwned = 1</script>'

describe('structured data inlined in a script element', () => {
  it('writes <, >, & and the two line separators as JSON escapes', () => {
    const text = serializeJsonLd({
      name: `a${breakout}<!--&${LINE_SEPARATOR}${PARAGRAPH_SEPARATOR}`,
    })

    expect(text).not.toMatch(/[<>&]/u)
    expect(text).not.toContain(LINE_SEPARATOR)
    expect(text).not.toContain(PARAGRAPH_SEPARATOR)
    expect(text).toContain('\\u003c/script\\u003e')
    expect(text).toContain('\\u0026')
    expect(text).toContain('\\u2028\\u2029')
  })

  it('changes nothing a JSON reader sees', () => {
    const data = {
      '@type': 'Event',
      name: `Garba ${breakout} & Dandiya <3 >_<`,
      nested: [{ label: `Night 1 ${LINE_SEPARATOR}${PARAGRAPH_SEPARATOR}` }],
      price: '25.00',
      count: 3,
      flag: true,
      nothing: null,
    }

    expect(JSON.parse(serializeJsonLd(data))).toEqual(data)
  })

  it('leaves ordinary text as it was', () => {
    const data = { name: 'Qawwali Under the Banyan — Night 2', price: '25.00' }

    expect(serializeJsonLd(data)).toBe(JSON.stringify(data))
  })

  it('renders one script element, whatever an event’s own words hold', () => {
    const event = {
      slug: 'hostile',
      title: `Title ${breakout}`,
      summary: `Summary ${breakout}`,
      status: 'ON_SALE',
      startsAt: '2026-11-01T14:30:00.000Z',
      endsAt: '2026-11-01T17:30:00.000Z',
      isOnline: false,
      performers: [{ name: `Performer ${breakout}` }],
      venue: { name: `Venue ${breakout}`, city: 'Edison' },
      organization: { name: `Organiser ${breakout}`, slug: 'org' },
      ticketTypes: [{ name: `Tier ${breakout}`, priceCents: 2_500, currency: 'USD' }],
      sessions: [1, 2].map((night) => ({
        label: `Night ${night} ${breakout}`,
        startsAt: `2026-11-0${night}T23:00:00.000Z`,
        endsAt: `2026-11-0${night + 1}T02:00:00.000Z`,
        timezone: 'America/New_York',
        status: 'SCHEDULED',
      })),
    }
    const data = eventJsonLd(event, { siteUrl: 'https://example.test' })
    const html = renderToStaticMarkup(createElement(JsonLd, { data }))
    const scripts = new DOMParser().parseFromString(html, 'text/html').querySelectorAll('script')

    expect(html.match(/<\/script>/giu)).toHaveLength(1)
    expect(scripts).toHaveLength(1)
    expect(JSON.parse(scripts[0].textContent)).toEqual(JSON.parse(JSON.stringify(data)))
  })

  it('renders nothing when there is nothing to say', () => {
    expect(renderToStaticMarkup(createElement(JsonLd, { data: null }))).toBe('')
  })
})

describe('every script element the web app writes', () => {
  const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

  /**
   * Every source file under `src`, tests left out.
   *
   * @param {string} directory Where to start.
   * @returns {string[]} Absolute paths.
   */
  function sources(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(directory, entry.name)

      if (entry.isDirectory()) return sources(full)

      return /\.(?:jsx?|mjs)$/u.test(entry.name) && !/\.test\.jsx?$/u.test(entry.name) ? [full] : []
    })
  }

  // What the code does, not what its comments say about script elements.
  const files = sources(src).map((file) => ({
    file: path.relative(src, file),
    text: readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//gu, '')
      .replace(/(^|\s)\/\/.*$/gmu, '$1'),
  }))

  it('found the pages it is meant to be checking', () => {
    const names = files.map(({ file }) => file)

    expect(names).toContain(path.join('app', 'events', '[slug]', 'page.jsx'))
    expect(names).toContain(path.join('app', 'venues', '[slug]', 'page.jsx'))
  })

  it('writes raw markup in one place only, the JsonLd component', () => {
    const writers = files
      .filter(({ text }) => /dangerouslySetInnerHTML\s*[=:]|__html\s*:/u.test(text))
      .map(({ file }) => file)

    expect(writers).toEqual([path.join('components', 'json-ld.jsx')])
  })

  it('opens a script element in one place only, the JsonLd component', () => {
    const openers = files
      .filter(({ text }) => /<script\b|['"]script['"]\s*,|next\/script/u.test(text))
      .map(({ file }) => file)

    expect(openers).toEqual([path.join('components', 'json-ld.jsx')])
  })

  it('publishes the event and venue structured data through it', () => {
    for (const page of [
      path.join('app', 'events', '[slug]', 'page.jsx'),
      path.join('app', 'venues', '[slug]', 'page.jsx'),
    ]) {
      const { text } = files.find(({ file }) => file === page)

      expect(text, page).toMatch(/<JsonLd data=\{/u)
    }
  })
})
