import { afterEach, describe, expect, it, vi } from 'vitest'

import { allTimeZones, zoneGroups } from './time-zones.js'
import { COMMON_ZONES } from './zoned-time.js'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('every time zone', () => {
  it('lists the runtime’s zones, well beyond the common ones', () => {
    const zones = allTimeZones()

    expect(zones).toEqual(
      expect.arrayContaining(['America/Chicago', 'Asia/Kolkata', 'Europe/London']),
    )
    expect(zones.length).toBeGreaterThan(COMMON_ZONES.length)
    expect(zones).toContain('UTC')
  })

  it('falls back to the common zones when the runtime cannot list them', () => {
    vi.spyOn(Intl, 'supportedValuesOf').mockImplementation(() => {
      throw new RangeError('unsupported')
    })

    expect(allTimeZones()).toEqual([...COMMON_ZONES].sort())
  })
})

describe('the two groups', () => {
  it('puts the common zones first and leaves them out of the rest', () => {
    const { common, others } = zoneGroups('America/Chicago', allTimeZones())

    expect(common).toEqual([...COMMON_ZONES])
    expect(others).not.toContain('America/Chicago')
    expect(others).toContain('Asia/Tokyo')
  })

  it('keeps a zone the runtime does not list', () => {
    const { common } = zoneGroups('Mars/Olympus_Mons', ['UTC'])

    expect(common[0]).toBe('Mars/Olympus_Mons')
  })
})
