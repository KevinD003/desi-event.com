'use client'

/**
 * The seat map as a set of grids: one per section, rows in order, seats in
 * order along each row.
 *
 * The map has no coordinates, so this is not a floor plan and does not pretend
 * to be one; it says so. What it is, is a grid a keyboard can drive:
 *
 *   - one Tab stop per section (roving tabindex), arrows to move, Home and End
 *     to the ends of a row, PageUp and PageDown to the first and last row,
 *     Space or Enter to choose;
 *   - every seat a `<button aria-pressed>` whose name reads the seat, its row,
 *     section, zone, price, what kind of seat it is and whether it can be had;
 *   - a seat nobody can take stays focusable, `aria-disabled`, so a screen
 *     reader user hears why it is not on offer rather than skipping it.
 *
 * State is never carried by colour alone: a chosen seat has a tick, a taken one
 * a hatch and a cross, a wheelchair space a wheelchair, a companion seat a C,
 * an obstructed one a struck-through eye, a restricted one a ! tied to its note.
 * The legend says what each means. Zones are words and a filter, not colours.
 *
 * Presentational: the selection lives in the caller, which also enforces the
 * companion rule and the per-order limit (`lib/seat-map.js`).
 *
 * @module components/seat-picker
 */

import { useId, useMemo, useRef, useState } from 'react'

import {
  NOT_TO_SCALE,
  effectiveSeatPrice,
  nextCell,
  seatAccessibleName,
  sectionRows,
} from '../lib/seat-map.js'
import { CheckIcon, CrossIcon, EyeOffIcon, WheelchairIcon } from './icons.jsx'

/** The keys a section grid answers to. */
const GRID_KEYS = new Set([
  'ArrowRight',
  'ArrowLeft',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'PageUp',
  'PageDown',
])

/**
 * Whether a seat passes the filters.
 *
 * @param {object} seat A public seat.
 * @param {{zoneId: string, accessibleOnly: boolean}} filters The filters.
 * @returns {boolean} True when it is shown.
 */
function passes(seat, filters) {
  if (filters.zoneId && seat.priceZoneId !== filters.zoneId) return false
  if (filters.accessibleOnly && !seat.accessible && !seat.companionOfSeatId) return false

  return true
}

/**
 * The glyphs on a seat, which say what the colour also says.
 *
 * @param {object} props Component props.
 * @param {object} props.seat The seat.
 * @param {boolean} props.selected Whether it is chosen.
 * @returns {JSX.Element} The glyphs.
 */
function SeatGlyphs({ seat, selected }) {
  return (
    <span aria-hidden="true" className="flex items-center gap-0.5">
      {selected ? <CheckIcon className="h-3.5 w-3.5" /> : null}
      {!seat.available && !selected ? <CrossIcon className="h-3.5 w-3.5" /> : null}
      {seat.accessible ? <WheelchairIcon className="h-3.5 w-3.5" /> : null}
      {seat.companionOfSeatId ? <span className="text-[0.625rem] font-bold">C</span> : null}
      {seat.obstructedView ? <EyeOffIcon className="h-3.5 w-3.5" /> : null}
      {seat.restricted ? <span className="text-[0.75rem] font-bold">!</span> : null}
    </span>
  )
}

/**
 * The classes a seat's state draws with: semantic seat tokens only.
 *
 * @param {boolean} selected Whether it is chosen.
 * @param {boolean} available Whether it can be had.
 * @returns {string} Classes.
 */
function seatClasses(selected, available) {
  if (selected) return 'border-seat-selected bg-seat-selected text-seat-selected-ink'
  if (!available) return 'seat-hatch border-line text-seat-unavailable-ink cursor-not-allowed'

  return 'border-seat-available-line bg-seat-available text-seat-available-ink hover:bg-surface-subtle'
}

/**
 * One section's grid.
 *
 * @param {object} props Component props.
 * @param {object} props.section The section.
 * @param {object[][]} props.rows Its rows, filtered.
 * @param {Set<string>} props.selected Chosen `Seat` ids.
 * @param {Map<string, object>} props.tiersById Tiers by id.
 * @param {Map<string, object>} props.zonesById Zones by id.
 * @param {string} props.currency The prices' currency.
 * @param {function(string): void} props.onToggle Choose or unchoose a seat.
 * @param {boolean} props.disabled Whether choosing is paused.
 * @returns {JSX.Element} The grid.
 */
function SectionGrid({
  section,
  rows,
  selected,
  tiersById,
  zonesById,
  currency,
  onToggle,
  disabled,
}) {
  const [position, setPosition] = useState({ row: 0, column: 0 })
  const buttons = useRef(new Map())
  const id = useId()
  const headingId = `${id}-heading`
  const restricted = rows.flatMap((row) =>
    row.seats.filter((seat) => seat.restricted && seat.restrictionNote),
  )

  // A filter can shorten the grid under the focus; keep it on a real seat.
  const safeRow = Math.min(position.row, rows.length - 1)
  const safeColumn = Math.min(position.column, (rows[safeRow]?.seats.length ?? 1) - 1)

  /**
   * Move the focus, or choose, from a key.
   *
   * @param {object} pressed The keydown event.
   * @returns {void}
   */
  function onKeyDown(pressed) {
    if (!GRID_KEYS.has(pressed.key)) return

    const next = nextCell(rows, { row: safeRow, column: safeColumn }, pressed.key)

    if (!next) return

    pressed.preventDefault()
    setPosition(next)
    buttons.current.get(`${next.row}:${next.column}`)?.focus()
  }

  return (
    <section aria-labelledby={headingId} className="min-w-0">
      <h3 id={headingId} className="text-base font-bold text-ink">
        {section.name}
      </h3>
      <div role="region" aria-label={`${section.name} seats`} className="mt-3 overflow-x-auto pb-2">
        <div role="grid" aria-labelledby={headingId} onKeyDown={onKeyDown} className="w-max">
          {rows.map((row, rowIndex) => (
            <div role="row" key={row.key} className="flex items-center gap-1.5 py-0.5">
              <span role="rowheader" className="w-16 shrink-0 text-xs font-semibold text-ink-muted">
                {row.label ? `Row ${row.label}` : 'Other seats'}
              </span>
              {row.seats.map((seat, columnIndex) => {
                const chosen = selected.has(seat.seatId)
                const tier = seat.ticketTypeId ? tiersById.get(seat.ticketTypeId) : null
                const price = effectiveSeatPrice(seat, tiersById)
                const noteId =
                  seat.restricted && seat.restrictionNote ? `${id}-${seat.id}-note` : null
                const focused = rowIndex === safeRow && columnIndex === safeColumn

                return (
                  <span role="gridcell" key={seat.id}>
                    <button
                      ref={(node) => {
                        if (node) buttons.current.set(`${rowIndex}:${columnIndex}`, node)
                        else buttons.current.delete(`${rowIndex}:${columnIndex}`)
                      }}
                      type="button"
                      tabIndex={focused ? 0 : -1}
                      aria-pressed={chosen}
                      aria-disabled={!seat.available && !chosen ? 'true' : undefined}
                      aria-label={seatAccessibleName(seat, {
                        section: section.name,
                        row: row.label,
                        zone: zonesById.get(seat.priceZoneId)?.name ?? null,
                        price,
                        currency: tier?.currency ?? currency,
                        selected: chosen,
                      })}
                      aria-describedby={noteId ?? undefined}
                      onFocus={() => setPosition({ row: rowIndex, column: columnIndex })}
                      onClick={() => {
                        if (disabled) return
                        if (!seat.available && !chosen) return
                        onToggle(seat.seatId)
                      }}
                      className={`flex h-9 min-w-9 items-center justify-center gap-0.5 rounded-control border px-1 text-xs font-bold tabular-nums transition-colors duration-(--duration-fast) focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1 focus-visible:outline-none ${seatClasses(chosen, seat.available)}`}
                    >
                      <SeatGlyphs seat={seat} selected={chosen} />
                      <span aria-hidden="true">{seat.label}</span>
                    </button>
                    {noteId ? (
                      <span id={noteId} className="sr-only">
                        {seat.restrictionNote}
                      </span>
                    ) : null}
                  </span>
                )
              })}
            </div>
          ))}
        </div>
      </div>
      {restricted.length > 0 ? (
        <ul className="mt-2 space-y-1 text-sm text-ink-muted">
          {restricted.map((seat) => (
            <li key={seat.id}>
              <span className="font-semibold text-ink">! Seat {seat.label}:</span>{' '}
              {seat.restrictionNote}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

/**
 * What each symbol on the map means.
 *
 * @returns {JSX.Element} The legend.
 */
function Legend() {
  const item = 'flex items-center gap-2'
  const chip =
    'flex h-7 min-w-7 items-center justify-center gap-0.5 rounded-control border px-1 text-xs font-bold'

  return (
    <div>
      <h3 className="text-sm font-bold text-ink">What the seats show</h3>
      <ul className="mt-2 grid grid-cols-1 gap-2 text-sm text-ink sm:grid-cols-2">
        <li className={item}>
          <span aria-hidden="true" className={`${chip} ${seatClasses(false, true)}`}>
            A1
          </span>
          Available
        </li>
        <li className={item}>
          <span aria-hidden="true" className={`${chip} ${seatClasses(true, true)}`}>
            <CheckIcon className="h-3.5 w-3.5" />
            A1
          </span>
          Your choice (tick)
        </li>
        <li className={item}>
          <span aria-hidden="true" className={`${chip} ${seatClasses(false, false)}`}>
            <CrossIcon className="h-3.5 w-3.5" />
            A1
          </span>
          Not available (cross and hatching)
        </li>
        <li className={item}>
          <WheelchairIcon className="h-4.5 w-4.5" />
          Wheelchair space, sold with its companion seat
        </li>
        <li className={item}>
          <span aria-hidden="true" className="w-4.5 text-center text-xs font-bold">
            C
          </span>
          Companion seat, sold with its wheelchair space
        </li>
        <li className={item}>
          <EyeOffIcon className="h-4.5 w-4.5" />
          Obstructed view
        </li>
        <li className={item}>
          <span aria-hidden="true" className="w-4.5 text-center text-sm font-bold">
            !
          </span>
          Restricted: the note under the section says how
        </li>
      </ul>
    </div>
  )
}

/**
 * @typedef {object} SeatPickerProps
 * @property {object} map The seat map's `data`.
 * @property {string[]} selected Chosen `Seat` ids.
 * @property {function(string): void} onToggle Choose or unchoose a seat.
 * @property {boolean} [disabled] Whether choosing is paused (while reserving or paying).
 */

/**
 * The legend, the filters and a grid per section.
 *
 * @param {SeatPickerProps} props Component props.
 * @returns {JSX.Element} The picker.
 */
export function SeatPicker({ map, selected, onToggle, disabled = false }) {
  const [filters, setFilters] = useState({ zoneId: '', accessibleOnly: false })
  const id = useId()
  const tiersById = useMemo(() => new Map((map.tiers ?? []).map((tier) => [tier.id, tier])), [map])
  const zonesById = useMemo(() => new Map((map.zones ?? []).map((zone) => [zone.id, zone])), [map])
  const chosen = useMemo(() => new Set(selected), [selected])
  const currency = map.tiers?.[0]?.currency ?? 'USD'

  const sections = (map.sections ?? [])
    .map((section) => ({
      section,
      rows: sectionRows(section)
        .map((row) => ({ ...row, seats: row.seats.filter((seat) => passes(seat, filters)) }))
        .filter((row) => row.seats.length > 0),
    }))
    .filter((entry) => entry.rows.length > 0)

  return (
    <div className="space-y-6">
      <p className="text-sm text-ink-muted">{NOT_TO_SCALE}</p>

      <Legend />

      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        {(map.zones ?? []).length > 1 ? (
          <div>
            <label htmlFor={`${id}-zone`} className="block text-sm font-bold text-ink">
              Price zone
            </label>
            <select
              id={`${id}-zone`}
              value={filters.zoneId}
              onChange={(changed) =>
                setFilters((current) => ({ ...current, zoneId: changed.target.value }))
              }
              className="mt-1 min-h-11 rounded-control border border-line-strong bg-surface-raised px-3 text-ink focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
            >
              <option value="">Every zone</option>
              {map.zones.map((zone) => (
                <option key={zone.id} value={zone.id}>
                  {zone.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={filters.accessibleOnly}
            onChange={(changed) =>
              setFilters((current) => ({ ...current, accessibleOnly: changed.target.checked }))
            }
            className="h-5 w-5 accent-action-primary"
          />
          Wheelchair spaces and companion seats only
        </label>
      </div>

      {sections.length === 0 ? (
        <p className="rounded-control border border-line bg-surface-subtle px-4 py-3 text-sm text-ink-muted">
          No seats match those filters.
        </p>
      ) : (
        sections.map(({ section, rows }) => (
          <SectionGrid
            key={section.id}
            section={section}
            rows={rows}
            selected={chosen}
            tiersById={tiersById}
            zonesById={zonesById}
            currency={currency}
            onToggle={onToggle}
            disabled={disabled}
          />
        ))
      )}
    </div>
  )
}
