import { describe, it, expect } from 'vitest'
import * as ui from './index.js'

/**
 * The public surface other packages code against. Keeping this list explicit
 * means a rename shows up here rather than as a broken import in the web app.
 */
const PUBLIC_EXPORTS = [
  'cn',
  'Button',
  'Badge',
  'Card',
  'CardHeader',
  'CardBody',
  'CardFooter',
  'Input',
  'Textarea',
  'Select',
  'Label',
  'FormField',
  'Alert',
  'StatusIcon',
  'Spinner',
  'Skeleton',
  'EmptyState',
  'VisuallyHidden',
  'Modal',
  'Tabs',
  // Poster House additions.
  'ButtonLink',
  'buttonClasses',
  'textLinkClasses',
  'TextLink',
  'Sheet',
  'Popover',
  'Menu',
  'Tooltip',
  'Toaster',
  'toast',
  'Stat',
  'Kbd',
  'SegmentedControl',
  'Icon',
]

describe('@desi-event/ui entry point', () => {
  it('exports every documented name as a callable', () => {
    for (const name of PUBLIC_EXPORTS) {
      expect(typeof ui[name], `${name} should be exported`).toBe('function')
    }
  })

  it('exports nothing beyond the documented surface', () => {
    expect(Object.keys(ui).sort()).toEqual([...PUBLIC_EXPORTS].sort())
  })
})

describe('@desi-event/ui subpaths for Server Components', () => {
  it('serves the pure class helpers at ./classes, with no React in them', async () => {
    const classes = await import('./classes.js')

    expect(Object.keys(classes).sort()).toEqual(['buttonClasses', 'cn', 'textLinkClasses'])
  })

  it('serves the icon family at ./icons', async () => {
    const icons = await import('./icons/index.js')

    expect(Object.keys(icons).sort()).toEqual(['GLYPHS', 'ICON_STROKE', 'Icon', 'glyphNames'])
  })

  it('maps both subpaths in the package manifest', async () => {
    const { readFileSync } = await import('node:fs')
    const path = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const here = path.dirname(fileURLToPath(import.meta.url))
    const manifest = JSON.parse(readFileSync(path.join(here, '..', 'package.json'), 'utf8'))

    expect(manifest.exports['./classes']).toBe('./src/classes.js')
    expect(manifest.exports['./icons']).toBe('./src/icons/index.js')
  })
})
