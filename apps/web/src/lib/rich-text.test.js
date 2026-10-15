import { describe, expect, it } from 'vitest'

import { LINK_REL, isSafeHref, parseInline, parseRichText, plainText } from './rich-text.js'

describe('blocks', () => {
  it('splits paragraphs on blank lines and keeps single line breaks', () => {
    expect(parseRichText('One\ntwo\n\nThree')).toEqual([
      {
        type: 'paragraph',
        lines: [[{ type: 'text', value: 'One' }], [{ type: 'text', value: 'two' }]],
      },
      { type: 'paragraph', lines: [[{ type: 'text', value: 'Three' }]] },
    ])
  })

  it('reads - and * lines as a list, next to a paragraph', () => {
    const blocks = parseRichText('Bring:\n- water\n* a shawl\n\nDone')

    expect(blocks.map((block) => block.type)).toEqual(['paragraph', 'list', 'paragraph'])
    expect(blocks[1].items).toEqual([
      [{ type: 'text', value: 'water' }],
      [{ type: 'text', value: 'a shawl' }],
    ])
  })

  it('gives nothing for nothing', () => {
    expect(parseRichText('')).toEqual([])
    expect(parseRichText('   \n  ')).toEqual([])
    expect(parseRichText(null)).toEqual([])
  })
})

describe('inline marks', () => {
  it('reads bold and both italics', () => {
    expect(parseInline('a **bold** b *it* c _also_')).toEqual([
      { type: 'text', value: 'a ' },
      { type: 'strong', children: [{ type: 'text', value: 'bold' }] },
      { type: 'text', value: ' b ' },
      { type: 'em', children: [{ type: 'text', value: 'it' }] },
      { type: 'text', value: ' c ' },
      { type: 'em', children: [{ type: 'text', value: 'also' }] },
    ])
  })

  it('leaves unterminated and spaced markers as literal text', () => {
    expect(parseInline('**open and 2 * 3 * 4 and snake_case_name')).toEqual([
      { type: 'text', value: '**open and 2 * 3 * 4 and snake_case_name' },
    ])
  })

  it('makes an https link from a label and from a bare address', () => {
    expect(parseInline('See [the site](https://example.com/a) or https://example.org.')).toEqual([
      { type: 'text', value: 'See ' },
      {
        type: 'link',
        href: 'https://example.com/a',
        children: [{ type: 'text', value: 'the site' }],
      },
      { type: 'text', value: ' or ' },
      {
        type: 'link',
        href: 'https://example.org',
        children: [{ type: 'text', value: 'https://example.org' }],
      },
      { type: 'text', value: '.' },
    ])
  })

  it.each([
    '[x](javascript:alert(1))',
    '[x](data:text/html,<b>hi</b>)',
    '[x](http://example.com)',
    '[x](mailto:a@example.com)',
    'http://example.com',
  ])('keeps %s as literal text', (source) => {
    const nodes = parseInline(source)

    expect(nodes.some((node) => node.type === 'link')).toBe(false)
    expect(nodes.map((node) => node.value).join('')).toBe(source)
  })

  it('keeps markup as text', () => {
    expect(parseInline('<script>alert(1)</script>')).toEqual([
      { type: 'text', value: '<script>alert(1)</script>' },
    ])
  })
})

describe('the link rule', () => {
  it('passes only https with a host', () => {
    expect(isSafeHref('https://example.com')).toBe(true)
    expect(isSafeHref('HTTPS://example.com')).toBe(true)
    expect(isSafeHref('javascript:alert(1)')).toBe(false)
    expect(isSafeHref('https:evil')).toBe(false)
    expect(isSafeHref('//example.com')).toBe(false)
    expect(isSafeHref(undefined)).toBe(false)
  })

  it('names the relation every link carries', () => {
    expect(LINK_REL).toBe('nofollow ugc noopener noreferrer')
  })
})

describe('plain text', () => {
  it('drops the marks and keeps the words', () => {
    expect(plainText('**Live** music.\n\n- dhol\n- [tabla](https://t.example)')).toBe(
      'Live music. dhol; tabla',
    )
  })
})
