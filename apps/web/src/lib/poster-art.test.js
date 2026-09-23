import { describe, expect, it } from 'vitest'

import {
  POSTER_ELEMENTS,
  POSTER_VIEWBOX,
  describePoster,
  motifFor,
  posterArt,
  toSvgString,
} from './poster-art.js'

/** Slugs from the sample catalogue, so the properties below hold for real posters. */
const SLUGS = [
  'navratri-night-one-edison',
  'mirrorwork-nine-nights-pass',
  'dandiya-dhol-houston',
  'lakeshore-raas-opening-night',
  'bay-lights-garba-opening',
  'peachtree-garba-saturday',
  'beginner-garba-workshop-jersey-city',
  'navratri-mela-queens',
  'mirrorwork-live-band-night',
  'garba-warm-up-night-atlanta',
]

/** One category per motif, plus one the drawing has no special case for. */
const CATEGORIES = ['GARBA_DANDIYA', 'WORKSHOP', 'CULTURAL_FESTIVAL', 'MUSIC_CONCERT', undefined]

/**
 * Every node in a drawing, depth first.
 *
 * @param {Array<object>} nodes The drawing's top-level nodes.
 * @returns {Array<object>} All of them, and all of their descendants.
 */
function walk(nodes) {
  return nodes.flatMap((node) => [node, ...walk(node.children)])
}

/**
 * The ids a drawing defines, and the ids its `url(#…)` paints refer to.
 *
 * @param {Array<object>} nodes The drawing's top-level nodes.
 * @returns {{defined: string[], referenced: string[]}} Both lists.
 */
function ids(nodes) {
  const all = walk(nodes)

  return {
    defined: all.filter((node) => node.attrs.id).map((node) => node.attrs.id),
    referenced: all.flatMap((node) =>
      Object.values(node.attrs)
        .map((value) => /^url\(#([^)]+)\)$/.exec(String(value))?.[1])
        .filter(Boolean),
    ),
  }
}

describe('motifFor', () => {
  it.each([
    ['GARBA_DANDIYA', 'circle'],
    ['CLASSICAL_DANCE', 'circle'],
    ['WORKSHOP', 'sticks'],
    ['SPORTS', 'sticks'],
    ['CULTURAL_FESTIVAL', 'mandala'],
    ['MUSIC_CONCERT', 'mandala'],
    [undefined, 'mandala'],
    ['NOT_A_CATEGORY', 'mandala'],
  ])('draws %s as %s', (category, motif) => {
    expect(motifFor(category)).toBe(motif)
  })
})

describe('describePoster', () => {
  it('says what each motif shows, in words a screen reader can announce', () => {
    expect(describePoster('GARBA_DANDIYA')).toBe(
      'Illustration of garba dancers circling a lit lamp under festival lights',
    )
    expect(describePoster('WORKSHOP')).toBe('Illustration of crossed dandiya sticks over a mandala')
    expect(describePoster('CULTURAL_FESTIVAL')).toBe(
      'Illustration of a festival mandala under a toran of bunting',
    )
  })

  it('never calls the drawing a photograph', () => {
    for (const category of CATEGORIES) {
      expect(describePoster(category)).toMatch(/^Illustration of /)
    }
  })
})

describe('posterArt', () => {
  it('draws the same poster for the same event, every time', () => {
    for (const seed of SLUGS) {
      for (const category of CATEGORIES) {
        expect(posterArt({ seed, category })).toEqual(posterArt({ seed, category }))
        expect(toSvgString({ title: seed, seed, category, variant: 'hero' })).toBe(
          toSvgString({ title: seed, seed, category, variant: 'hero' }),
        )
      }
    }
  })

  it('varies the palette across events, so a page of cards is not one colour', () => {
    const palettes = new Set(SLUGS.map((seed) => posterArt({ seed }).palette))

    expect(palettes.size).toBeGreaterThanOrEqual(3)
  })

  it('draws a different scene for each motif', () => {
    const seed = SLUGS[0]
    const circle = posterArt({ seed, category: 'GARBA_DANDIYA' })
    const sticks = posterArt({ seed, category: 'WORKSHOP' })
    const mandala = posterArt({ seed, category: 'CULTURAL_FESTIVAL' })

    expect(circle).not.toEqual(sticks)
    expect(sticks).not.toEqual(mandala)
    expect(mandala).not.toEqual(circle)
  })

  it('draws a fuller scene for a hero than for a card', () => {
    const seed = SLUGS[0]
    const card = walk(posterArt({ seed, category: 'GARBA_DANDIYA' }).children)
    const hero = walk(posterArt({ seed, category: 'GARBA_DANDIYA', variant: 'hero' }).children)

    expect(hero.length).toBeGreaterThan(card.length)
  })

  it('draws in the 3:2 space the containers crop from', () => {
    expect(POSTER_VIEWBOX).toEqual({ width: 600, height: 400 })
    expect(posterArt({ seed: SLUGS[0] }).viewBox).toBe('0 0 600 400')
  })

  it('builds a tree of drawing elements only, with plain attribute values', () => {
    const allowed = new Set(POSTER_ELEMENTS)

    for (const seed of SLUGS) {
      for (const category of CATEGORIES) {
        for (const variant of ['card', 'hero']) {
          const nodes = walk(posterArt({ seed, category, variant }).children)

          expect(nodes.length).toBeGreaterThan(50)

          for (const node of nodes) {
            expect(allowed.has(node.tag), node.tag).toBe(true)
            expect(Array.isArray(node.children)).toBe(true)

            for (const [name, value] of Object.entries(node.attrs)) {
              // SVG attribute spelling, and nothing that is an event handler.
              expect(name).toMatch(/^[a-z][a-z0-9-]*$/)
              expect(name.startsWith('on')).toBe(false)
              expect(['string', 'number'].includes(typeof value), `${name}=${value}`).toBe(true)
              if (typeof value === 'number') expect(Number.isFinite(value), name).toBe(true)
              expect(String(value)).not.toMatch(/[<>"]|javascript:/i)
            }
          }
        }
      }
    }
  })

  it('defines every gradient it paints with, under the prefix it was given', () => {
    for (const seed of SLUGS) {
      for (const category of CATEGORIES) {
        const { defined, referenced } = ids(
          posterArt({ seed, category, idPrefix: 'poster-R7' }).children,
        )

        expect(defined.length).toBeGreaterThan(0)
        expect(new Set(defined).size).toBe(defined.length)
        expect(defined.every((id) => id.startsWith('poster-R7-'))).toBe(true)
        expect(referenced.filter((id) => !defined.includes(id))).toEqual([])
      }
    }
  })

  it('gives two posters of the same event on one page no id in common', () => {
    const seed = SLUGS[0]
    const first = ids(posterArt({ seed, idPrefix: 'poster-R1' }).children).defined
    const second = ids(posterArt({ seed, idPrefix: 'poster-R2' }).children).defined

    expect(first.filter((id) => second.includes(id))).toEqual([])
  })
})

describe('toSvgString', () => {
  it('writes a standalone, titled SVG document', () => {
    const svg = toSvgString({
      title: 'Navratri Night One',
      seed: SLUGS[0],
      category: 'GARBA_DANDIYA',
    })

    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400"')).toBe(
      true,
    )
    expect(svg).toContain('role="img"')
    expect(svg).toContain('<title>Navratri Night One</title>')
    expect(svg.endsWith('</svg>')).toBe(true)
  })

  it('escapes the title, so an event name cannot become markup', () => {
    const svg = toSvgString({ title: 'Raas & "Garba" <script>', seed: SLUGS[0] })

    expect(svg).toContain('<title>Raas &amp; &quot;Garba&quot; &lt;script></title>')
    expect(svg).not.toContain('<script>')
  })
})
