/**
 * Every destination the navigation offers is drawn with a glyph the icon
 * family really has.
 *
 * @module lib/nav-icons.test
 */

import { GLYPHS } from '@desi-event/ui/icons'
import { describe, expect, it } from 'vitest'

import { FALLBACK_NAV_ICON, NAV_ICONS, navIcon } from './nav-icons.js'
import { WORKSPACE_GROUPS, accountItems } from './navigation.js'

describe('the navigation’s icons', () => {
  it('name only glyphs the family draws', () => {
    for (const [href, name] of Object.entries(NAV_ICONS)) {
      expect(GLYPHS, `${href} is drawn with "${name}"`).toHaveProperty(name)
    }
    expect(GLYPHS).toHaveProperty(FALLBACK_NAV_ICON)
  })

  it('give every workspace destination and every account page a glyph of its own', () => {
    const destinations = [
      ...WORKSPACE_GROUPS.flatMap((group) => group.destinations.map((each) => each.href)),
      ...accountItems({ user: {} }).map((item) => item.href),
      '/admin',
    ]

    for (const href of destinations) {
      expect(NAV_ICONS, href).toHaveProperty([href])
    }
  })

  it('falls back to an arrow for a destination with none', () => {
    expect(navIcon('/somewhere-new')).toBe(FALLBACK_NAV_ICON)
    expect(navIcon('/organizer/check-in')).toBe('scan')
  })
})
