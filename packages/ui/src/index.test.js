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
  'Spinner',
  'Skeleton',
  'EmptyState',
  'VisuallyHidden',
  'Modal',
  'Tabs',
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
