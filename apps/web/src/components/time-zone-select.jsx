'use client'

/**
 * A time-zone select with the common zones first and every other zone after.
 *
 * The full list is filled in after the component mounts. The server renders
 * the common zones only, the browser adds the rest in an effect, and the two
 * renders therefore agree when the page hydrates — a list built during render
 * would differ between a server and a browser whose runtimes know different
 * zones, and React would throw the server's markup away.
 *
 * @module components/time-zone-select
 */

import { useEffect, useState } from 'react'

import { Select } from './ui.jsx'
import { allTimeZones, zoneGroups } from '../lib/time-zones.js'

/**
 * @typedef {object} TimeZoneSelectProps
 * @property {string} value The selected zone.
 * @property {Function} onChange Called with the change event.
 */

/**
 * The select.
 *
 * Every other prop is passed to the `select`, so a `FormField` can wire its
 * label and description to it.
 *
 * @param {TimeZoneSelectProps} props Component props, and any other the select takes.
 * @returns {JSX.Element} The select.
 */
export function TimeZoneSelect({ value, onChange, ...rest }) {
  const [all, setAll] = useState(null)

  useEffect(() => {
    setAll(allTimeZones())
  }, [])

  const { common, others } = zoneGroups(value, all ?? undefined)

  return (
    <Select value={value} onChange={onChange} {...rest}>
      <optgroup label="Common">
        {common.map((zone) => (
          <option key={zone} value={zone}>
            {zone.replace(/_/g, ' ')}
          </option>
        ))}
      </optgroup>
      {others.length > 0 ? (
        <optgroup label="All time zones">
          {others.map((zone) => (
            <option key={zone} value={zone}>
              {zone.replace(/_/g, ' ')}
            </option>
          ))}
        </optgroup>
      ) : null}
    </Select>
  )
}
