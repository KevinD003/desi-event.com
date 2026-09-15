'use client'

/**
 * The seating-map editor.
 *
 * The decision that shapes everything else: **the list is not the fallback.**
 *
 * A drag-and-drop canvas with an "accessible alternative" bolted on produces
 * two editors, one of which is always behind. So the structure here is a tree
 * of real controls — sections, rows, seats, each a button in the tab order with
 * a name a screen reader can read — and the plan view is a second presentation
 * of that same tree, not a separate thing. Both views drive the same state and
 * the same keyboard model, so neither can drift.
 *
 * Keyboard model, which is the whole authoring surface:
 *
 *   - Arrow keys move between seats in the plan, wrapping at row ends.
 *   - Enter or Space selects a seat, opening its properties.
 *   - The properties panel is ordinary form controls, so everything a seat has
 *     is reachable by Tab alone.
 *   - Every structural action — add a section, add a row, add or remove a seat
 *     — is a button, never a gesture. A gesture that has no keyboard equivalent
 *     is a feature that does not exist for some of the people who need it.
 *
 * Saving is explicit rather than automatic, and that is deliberate for this
 * artefact: an autosave that raced another author would produce the revision
 * conflict silently and repeatedly. The revision the editor loaded is sent with
 * every save, and a stale one is reported as somebody else's work rather than
 * overwritten.
 *
 * The validator is the same module the server runs — imported from
 * `@desi-event/inventory/layout`, which is a subpath precisely so the browser
 * does not receive the inventory barrel and the `node:crypto` behind it.
 * Client-side validation is a courtesy; the server validates again and its
 * answer is the one that counts.
 *
 * @module components/map-editor
 */

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'

import { validateLayout } from '@desi-event/inventory/layout'

import { Alert, Badge, Button, Card, CardBody, FormField, Input, Select } from './ui.jsx'

/** A key that is unique within this editing session. */
let counter = 0

/**
 * Mint a key for a newly added entity.
 *
 * Keys only need to be unique within one payload, so a counter is enough and is
 * stable across re-renders in a way a random value would not be.
 *
 * @param {string} prefix What it is.
 * @returns {string} The key.
 */
function newKey(prefix) {
  counter += 1
  return `${prefix}-new-${counter}`
}

/**
 * The seats of a section, in the order a person reads them.
 *
 * @param {object} section A section.
 * @returns {object[]} Its seats, row seats first.
 */
function seatsOf(section) {
  return [...(section.rows ?? []).flatMap((row) => row.seats ?? []), ...(section.seats ?? [])]
}

/**
 * @typedef {object} MapEditorProps
 * @property {object} version The map version being edited.
 * @property {object} initialLayout The layout as loaded.
 * @property {boolean} readOnly Whether this version is frozen.
 */

/**
 * The editor.
 *
 * @param {MapEditorProps} props Component props.
 * @returns {JSX.Element} The rendered editor.
 */
export function MapEditor({ version, initialLayout, readOnly }) {
  const router = useRouter()
  const [layout, setLayout] = useState(initialLayout)
  const [revision, setRevision] = useState(version.revision)
  const [view, setView] = useState('plan')
  const [selected, setSelected] = useState(null)
  const [status, setStatus] = useState(null)
  const [conflict, setConflict] = useState(null)
  const [serverIssues, setServerIssues] = useState([])
  const [busy, setBusy] = useState(false)
  const [confirmingPublish, setConfirmingPublish] = useState(false)
  const [dirty, setDirty] = useState(false)

  const summaryRef = useRef(null)
  const dialogRef = useRef(null)
  const headingId = useId()

  // The same rules the server applies, run here so an author sees a problem
  // while they are looking at the thing that caused it.
  const verdict = useMemo(() => validateLayout(layout), [layout])
  const issues = serverIssues.length > 0 ? serverIssues : verdict.issues

  /**
   * Replace the layout and mark it unsaved.
   *
   * @param {Function} update Produces the next layout.
   * @returns {void}
   */
  const change = useCallback((update) => {
    setLayout((current) => update(structuredClone(current)))
    setDirty(true)
    setServerIssues([])
  }, [])

  useEffect(() => {
    if (!confirmingPublish) return

    // Focus into the dialog, and put Escape back where a person expects it.
    dialogRef.current?.focus()

    /**
     * Close on Escape.
     *
     * @param {KeyboardEvent} event The key event.
     * @returns {void}
     */
    const onKey = (event) => {
      if (event.key === 'Escape') setConfirmingPublish(false)
    }

    window.addEventListener('keydown', onKey)

    return () => window.removeEventListener('keydown', onKey)
  }, [confirmingPublish])

  /** Save the whole draft. */
  async function save() {
    setBusy(true)
    setStatus(null)
    setConflict(null)
    setServerIssues([])

    try {
      const response = await fetch(
        `/api/v1/venue-map-versions/${encodeURIComponent(version.id)}/layout`,
        {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ revision, ...layout }),
        },
      )

      const body = await response.json().catch(() => null)

      if (response.ok) {
        setRevision(body.data.revision)
        setDirty(false)
        setStatus(`Saved. ${body.data.seatCount} seats, revision ${body.data.revision}.`)
        return
      }

      if (response.status === 409) {
        // Somebody else saved while this editor was open. Nothing of theirs is
        // overwritten and nothing of ours is lost — the author decides.
        setConflict(body?.error?.message ?? 'This draft has moved on since you loaded it.')
        return
      }

      if (response.status === 422) {
        setServerIssues(body?.error?.issues ?? [])
        setStatus(null)
        queueMicrotask(() => summaryRef.current?.focus())
        return
      }

      setStatus(body?.error?.message ?? 'Could not save.')
    } catch {
      setStatus('The ticketing service is not responding. Nothing has been saved.')
    } finally {
      setBusy(false)
    }
  }

  /** Publish, which freezes the version for good. */
  async function publish() {
    setBusy(true)
    setConfirmingPublish(false)

    try {
      const response = await fetch(
        `/api/v1/venue-map-versions/${encodeURIComponent(version.id)}/publish`,
        { method: 'POST' },
      )

      if (response.ok) {
        router.refresh()
        setStatus('Published. This version is now frozen.')
        return
      }

      const body = await response.json().catch(() => null)

      setStatus(body?.error?.message ?? 'Could not publish.')
    } catch {
      setStatus('The ticketing service is not responding. Nothing has been published.')
    } finally {
      setBusy(false)
    }
  }

  const sections = layout.sections ?? []

  return (
    <div>
      <div role="status" aria-live="polite" className="sr-only">
        {status ?? ''}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={headingId} className="text-xl font-bold text-indigo-night-900">
          Layout
          {readOnly ? (
            <Badge variant="success" className="ml-3" srLabel="State:">
              Frozen
            </Badge>
          ) : (
            <Badge variant="neutral" className="ml-3" srLabel="State:">
              Draft · revision {revision}
            </Badge>
          )}
        </h2>

        <div className="flex flex-wrap items-center gap-2">
          <fieldset className="flex items-center gap-1">
            <legend className="sr-only">How to show the layout</legend>
            {[
              ['plan', 'Plan'],
              ['list', 'List'],
            ].map(([value, label]) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={view === value ? 'primary' : 'outline'}
                aria-pressed={view === value}
                onClick={() => setView(value)}
              >
                {label}
              </Button>
            ))}
          </fieldset>

          {!readOnly ? (
            <>
              <Button type="button" onClick={save} disabled={busy || !dirty}>
                {busy ? 'Saving…' : dirty ? 'Save draft' : 'Saved'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setConfirmingPublish(true)}
                disabled={busy || dirty || !verdict.valid}
              >
                Publish
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {readOnly ? (
        <div className="mt-4">
          <Alert variant="info" title="This version is frozen">
            A published map is what somebody bought a seat on, so it cannot change. Start a new
            version from it to make changes; everything already sold stays pointing here.
          </Alert>
        </div>
      ) : null}

      {conflict ? (
        <div className="mt-4">
          <Alert variant="warning" title="Somebody else saved first">
            <p>{conflict}</p>
            <p className="mt-2">
              Nothing of yours has been saved and nothing of theirs has been overwritten. Reload to
              take their version, or copy your changes somewhere before you do.
            </p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mt-3"
              onClick={() => router.refresh()}
            >
              Reload their version
            </Button>
          </Alert>
        </div>
      ) : null}

      {status ? (
        <p className="mt-4 text-sm text-slate-700" aria-hidden="true">
          {status}
        </p>
      ) : null}

      {issues.length > 0 ? (
        <div className="mt-4" ref={summaryRef} tabIndex={-1} role="alert">
          <Alert
            variant="danger"
            title={`${issues.length} problem${issues.length === 1 ? '' : 's'} to fix`}
          >
            <p>Nothing has been saved. Each problem links to the thing that caused it.</p>
            <ul className="mt-3 list-disc space-y-1 pl-5">
              {issues.map((issue, index) => (
                <li key={`${issue.code}-${issue.path}-${index}`}>
                  {issue.key ? (
                    <button
                      type="button"
                      className="rounded-sm text-left underline underline-offset-4 hover:text-marigold-700 focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:outline-none"
                      onClick={() => {
                        setSelected(issue.key)
                        document.getElementById(`seat-${issue.key}`)?.focus()
                      }}
                    >
                      {issue.message}
                    </button>
                  ) : (
                    issue.message
                  )}
                </li>
              ))}
            </ul>
          </Alert>
        </div>
      ) : null}

      {view === 'plan' ? (
        <PlanView
          sections={sections}
          selected={selected}
          onSelect={setSelected}
          readOnly={readOnly}
        />
      ) : (
        <ListView sections={sections} selected={selected} onSelect={setSelected} />
      )}

      {!readOnly ? <StructureControls layout={layout} change={change} newKey={newKey} /> : null}

      {selected ? (
        <SeatProperties
          layout={layout}
          seatKey={selected}
          change={change}
          readOnly={readOnly}
          onClose={() => setSelected(null)}
        />
      ) : null}

      {confirmingPublish ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="publish-title"
            tabIndex={-1}
            className="w-full max-w-lg rounded-card bg-white p-6 shadow-lg"
          >
            <h3 id="publish-title" className="text-xl font-bold text-indigo-night-900">
              Publish this version?
            </h3>
            <div className="mt-3 space-y-3 text-slate-700">
              <p>
                Publishing freezes this layout permanently. After it, no section, row or seat in
                this version can be changed, renamed or removed — by you or by anybody else.
              </p>
              <p>
                That is not a policy we could relax later: once a session sells against a version,
                its seats are what people bought, and the database refuses to alter them.
              </p>
              <p>
                To change the layout afterwards you start a new version from this one. Everything
                already sold keeps pointing at this version.
              </p>
              <p className="font-medium">
                {verdict.seatCount.toLocaleString('en-IN')} seats will be frozen.
              </p>
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <Button type="button" onClick={publish} disabled={busy}>
                Publish and freeze
              </Button>
              <Button type="button" variant="outline" onClick={() => setConfirmingPublish(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/**
 * The plan: seats laid out as they sit in the hall.
 *
 * A grid of buttons rather than a canvas. Every seat is in the accessibility
 * tree with a name, arrow keys move between them, and the selected seat is the
 * only tab stop — the roving-tabindex pattern, so Tab leaves the plan rather
 * than walking through four hundred seats.
 *
 * @param {object} props Component props.
 * @param {object[]} props.sections The sections.
 * @param {string|null} props.selected The selected seat key.
 * @param {Function} props.onSelect Selects a seat.
 * @param {boolean} props.readOnly Whether editing is possible.
 * @returns {JSX.Element} The rendered plan.
 */
function PlanView({ sections, selected, onSelect, readOnly }) {
  /**
   * Move the selection with the arrow keys.
   *
   * @param {object} event The key event.
   * @param {object[]} seats The seats in this row.
   * @param {number} index Where we are.
   * @returns {void}
   */
  function onKeyDown(event, seats, index) {
    const moves = { ArrowRight: 1, ArrowLeft: -1 }
    const step = moves[event.key]

    if (step === undefined) return

    event.preventDefault()

    const next = seats[(index + step + seats.length) % seats.length]

    onSelect(next.key)
    document.getElementById(`seat-${next.key}`)?.focus()
  }

  return (
    <div className="mt-6 space-y-8 overflow-x-auto">
      {sections.map((section) => (
        <section key={section.key} aria-labelledby={`section-${section.key}`}>
          <h3
            id={`section-${section.key}`}
            className="font-display text-lg font-semibold text-indigo-night-900"
          >
            {section.name}{' '}
            <span className="text-sm font-normal text-slate-600">
              ({section.kind.toLowerCase()})
            </span>
          </h3>

          {section.kind === 'STANDING' ? (
            <p className="mt-2 text-slate-700">
              Standing, capacity {section.standingCapacity ?? '—'}. No numbered seats.
            </p>
          ) : null}

          {(section.rows ?? []).map((row) => (
            <div key={row.key} className="mt-3 flex items-center gap-3">
              <span className="w-12 shrink-0 text-sm font-medium text-slate-600">{row.label}</span>
              <div role="group" aria-label={`Row ${row.label}`} className="flex flex-wrap gap-1">
                {(row.seats ?? []).map((seat, index) => (
                  <SeatButton
                    key={seat.key}
                    seat={seat}
                    section={section}
                    row={row}
                    selected={selected === seat.key}
                    tabIndex={selected === seat.key || (!selected && index === 0) ? 0 : -1}
                    onSelect={onSelect}
                    onKeyDown={(event) => onKeyDown(event, row.seats ?? [], index)}
                    readOnly={readOnly}
                  />
                ))}
              </div>
            </div>
          ))}

          {(section.seats ?? []).length > 0 ? (
            <div
              role="group"
              aria-label={`${section.name} seats`}
              className="mt-3 flex flex-wrap gap-1"
            >
              {(section.seats ?? []).map((seat, index) => (
                <SeatButton
                  key={seat.key}
                  seat={seat}
                  section={section}
                  row={null}
                  selected={selected === seat.key}
                  tabIndex={selected === seat.key ? 0 : -1}
                  onSelect={onSelect}
                  onKeyDown={(event) => onKeyDown(event, section.seats ?? [], index)}
                  readOnly={readOnly}
                />
              ))}
            </div>
          ) : null}
        </section>
      ))}
    </div>
  )
}

/**
 * One seat in the plan.
 *
 * The accessible name carries everything the colour and shape carry, because
 * colour alone is not a status and a shape is not a label.
 *
 * @param {object} props Component props.
 * @param {object} props.seat The seat.
 * @param {object} props.section The section it sits in.
 * @param {object|null} props.row The row it sits in, when it has one.
 * @param {boolean} props.selected Whether it is the selected seat.
 * @param {number} props.tabIndex Roving tabindex: 0 for the one tab stop, -1 otherwise.
 * @param {Function} props.onSelect Selects this seat.
 * @param {Function} props.onKeyDown Handles arrow-key movement.
 * @param {boolean} props.readOnly Whether the layout is frozen.
 * @returns {JSX.Element} The rendered seat.
 */
function SeatButton({ seat, section, row, selected, tabIndex, onSelect, onKeyDown, readOnly }) {
  const traits = [
    seat.accessible ? 'accessible space' : null,
    seat.companionOfKey ? 'companion seat' : null,
    seat.obstructedView ? 'obstructed view' : null,
    seat.restricted ? 'restricted' : null,
  ].filter(Boolean)

  const name = [seat.label, row ? `row ${row.label}` : null, section.name, ...traits]
    .filter(Boolean)
    .join(', ')

  return (
    <button
      type="button"
      id={`seat-${seat.key}`}
      aria-label={name}
      aria-pressed={selected}
      tabIndex={tabIndex}
      onClick={() => onSelect(seat.key)}
      onKeyDown={onKeyDown}
      className={[
        'h-9 min-w-9 rounded border px-1 text-xs font-medium transition-colors',
        'focus-visible:ring-2 focus-visible:ring-marigold-500 focus-visible:ring-offset-1 focus-visible:outline-none',
        selected
          ? 'border-marigold-600 bg-marigold-100 text-indigo-night-900'
          : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
      ].join(' ')}
    >
      {/* A marker as well as the colour, so the state survives greyscale. */}
      {seat.accessible ? '♿ ' : ''}
      {seat.label}
      {readOnly ? '' : ''}
    </button>
  )
}

/**
 * The list: the same tree as a table.
 *
 * Equivalent authoring capability, not a summary. Every seat is here with every
 * attribute the plan shows, and selecting one opens the same properties panel.
 *
 * @param {object} props Component props.
 * @param {object[]} props.sections The sections.
 * @param {string|null} props.selected The selected seat key.
 * @param {Function} props.onSelect Selects a seat.
 * @returns {JSX.Element} The rendered list.
 */
function ListView({ sections, selected, onSelect }) {
  return (
    <div className="mt-6 overflow-x-auto">
      <table className="w-full min-w-[40rem] border-collapse text-sm">
        <caption className="sr-only">
          Every seat in this layout, with its section, row and attributes.
        </caption>
        <thead>
          <tr className="border-b border-slate-300 text-left">
            <th scope="col" className="py-2 pr-4">
              Seat
            </th>
            <th scope="col" className="py-2 pr-4">
              Section
            </th>
            <th scope="col" className="py-2 pr-4">
              Row
            </th>
            <th scope="col" className="py-2 pr-4">
              Zone
            </th>
            <th scope="col" className="py-2 pr-4">
              Attributes
            </th>
            <th scope="col" className="py-2">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sections.flatMap((section) =>
            [
              ...(section.rows ?? []).flatMap((row) =>
                (row.seats ?? []).map((seat) => ({ seat, section, row })),
              ),
              ...(section.seats ?? []).map((seat) => ({ seat, section, row: null })),
            ].map(({ seat, row }) => (
              <tr key={seat.key} className="border-b border-slate-200">
                <th scope="row" className="py-2 pr-4 text-left font-medium text-indigo-night-900">
                  {seat.label}
                </th>
                <td className="py-2 pr-4">{section.name}</td>
                <td className="py-2 pr-4">{row?.label ?? '—'}</td>
                <td className="py-2 pr-4">{seat.zoneKey ?? '—'}</td>
                <td className="py-2 pr-4">
                  {[
                    seat.accessible ? 'Accessible space' : null,
                    seat.companionOfKey ? 'Companion' : null,
                    seat.obstructedView ? 'Obstructed view' : null,
                    seat.restricted ? 'Restricted' : null,
                  ]
                    .filter(Boolean)
                    .join(', ') || '—'}
                </td>
                <td className="py-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={selected === seat.key ? 'primary' : 'outline'}
                    onClick={() => onSelect(seat.key)}
                  >
                    Edit<span className="sr-only"> {seat.label}</span>
                  </Button>
                </td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </div>
  )
}

/**
 * Adding sections, rows and seats.
 *
 * Buttons, not gestures. A drag that has no keyboard equivalent is a feature
 * that does not exist for some of the people who need it.
 *
 * @param {object} props Component props.
 * @param {object} props.layout The whole layout.
 * @param {Function} props.change Applies a change to the layout.
 * @returns {JSX.Element} The rendered controls.
 */
function StructureControls({ layout, change }) {
  return (
    <Card className="mt-8">
      <CardBody>
        <h3 className="font-display text-lg font-semibold text-indigo-night-900">Structure</h3>

        <div className="mt-4 flex flex-wrap gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              change((draft) => {
                draft.sections.push({
                  key: newKey('section'),
                  name: `Section ${draft.sections.length + 1}`,
                  kind: 'SEATED',
                  sortOrder: draft.sections.length,
                  rows: [],
                  seats: [],
                })
                return draft
              })
            }
          >
            Add a section
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              change((draft) => {
                draft.zones.push({
                  key: newKey('zone'),
                  name: `Zone ${draft.zones.length + 1}`,
                  colourToken: 'zone-default',
                  sortOrder: draft.zones.length,
                })
                return draft
              })
            }
          >
            Add a price zone
          </Button>
        </div>

        <ul className="mt-5 space-y-4">
          {(layout.sections ?? []).map((section, sIndex) => (
            <li key={section.key} className="rounded border border-slate-200 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <FormField label={`Section ${sIndex + 1} name`} id={`section-name-${section.key}`}>
                  <Input
                    id={`section-name-${section.key}`}
                    value={section.name}
                    onChange={(event) =>
                      change((draft) => {
                        draft.sections[sIndex].name = event.target.value
                        return draft
                      })
                    }
                  />
                </FormField>

                <FormField label="Kind" id={`section-kind-${section.key}`}>
                  <Select
                    id={`section-kind-${section.key}`}
                    value={section.kind}
                    onChange={(event) =>
                      change((draft) => {
                        draft.sections[sIndex].kind = event.target.value
                        return draft
                      })
                    }
                  >
                    <option value="SEATED">Seated</option>
                    <option value="STANDING">Standing</option>
                    <option value="TABLE">Tables</option>
                  </Select>
                </FormField>
              </div>

              {section.kind === 'STANDING' ? (
                <FormField
                  label="Standing capacity"
                  id={`section-capacity-${section.key}`}
                  description="How many people fit. A standing section has no numbered seats."
                >
                  <Input
                    id={`section-capacity-${section.key}`}
                    type="number"
                    min={1}
                    value={section.standingCapacity ?? ''}
                    onChange={(event) =>
                      change((draft) => {
                        const value = Number.parseInt(event.target.value, 10)
                        draft.sections[sIndex].standingCapacity = Number.isNaN(value) ? null : value
                        return draft
                      })
                    }
                  />
                </FormField>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      change((draft) => {
                        const rows = draft.sections[sIndex].rows
                        rows.push({
                          key: newKey('row'),
                          label: String.fromCharCode(65 + (rows.length % 26)),
                          sortOrder: rows.length,
                          seats: [],
                        })
                        return draft
                      })
                    }
                  >
                    Add a row to {section.name}
                  </Button>
                </div>
              )}

              {(section.rows ?? []).map((row, rIndex) => (
                <div key={row.key} className="mt-3 border-t border-slate-200 pt-3">
                  <div className="flex flex-wrap items-end gap-3">
                    <FormField label="Row label" id={`row-label-${row.key}`}>
                      <Input
                        id={`row-label-${row.key}`}
                        value={row.label}
                        onChange={(event) =>
                          change((draft) => {
                            draft.sections[sIndex].rows[rIndex].label = event.target.value
                            return draft
                          })
                        }
                      />
                    </FormField>

                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        change((draft) => {
                          const target = draft.sections[sIndex].rows[rIndex]
                          const index = target.seats.length + 1

                          target.seats.push({
                            key: newKey('seat'),
                            label: `${target.label}${index}`,
                            sortOrder: target.seats.length,
                            accessible: false,
                            obstructedView: false,
                            restricted: false,
                          })
                          return draft
                        })
                      }
                    >
                      Add a seat to row {row.label}
                    </Button>

                    <Button
                      type="button"
                      size="sm"
                      variant="danger"
                      onClick={() =>
                        change((draft) => {
                          draft.sections[sIndex].rows.splice(rIndex, 1)
                          return draft
                        })
                      }
                    >
                      Remove row {row.label}
                    </Button>
                  </div>
                  <p className="mt-2 text-sm text-slate-600">
                    {(row.seats ?? []).length} seat{(row.seats ?? []).length === 1 ? '' : 's'}
                  </p>
                </div>
              ))}

              <Button
                type="button"
                size="sm"
                variant="danger"
                className="mt-4"
                onClick={() =>
                  change((draft) => {
                    draft.sections.splice(sIndex, 1)
                    return draft
                  })
                }
              >
                Remove {section.name}
              </Button>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  )
}

/**
 * Everything one seat is.
 *
 * Ordinary form controls, so the whole of a seat is reachable by Tab. The
 * companion field is a select over the accessible spaces in the same section,
 * because those are the only valid targets and offering the others would be
 * offering a mistake.
 *
 * @param {object} props Component props.
 * @param {object} props.layout The whole layout.
 * @param {string} props.seatKey Which seat.
 * @param {Function} props.change Applies a change to the layout.
 * @param {boolean} props.readOnly Whether the layout is frozen.
 * @param {Function} props.onClose Closes the panel.
 * @returns {JSX.Element|null} The rendered panel, or null when the seat is gone.
 */
function SeatProperties({ layout, seatKey, change, readOnly, onClose }) {
  const found = useMemo(() => {
    for (const [sIndex, section] of (layout.sections ?? []).entries()) {
      for (const [rIndex, row] of (section.rows ?? []).entries()) {
        const index = (row.seats ?? []).findIndex((seat) => seat.key === seatKey)
        if (index >= 0) return { seat: row.seats[index], section, sIndex, rIndex, index }
      }

      const index = (section.seats ?? []).findIndex((seat) => seat.key === seatKey)
      if (index >= 0) return { seat: section.seats[index], section, sIndex, rIndex: null, index }
    }

    return null
  }, [layout, seatKey])

  if (!found) return null

  const { seat, section, sIndex, rIndex, index } = found

  /**
   * Change one field of this seat.
   *
   * @param {string} field The field.
   * @param {unknown} value The new value.
   * @returns {void}
   */
  const set = (field, value) =>
    change((draft) => {
      const target =
        rIndex === null
          ? draft.sections[sIndex].seats[index]
          : draft.sections[sIndex].rows[rIndex].seats[index]

      target[field] = value
      return draft
    })

  const companions = seatsOf(section).filter(
    (candidate) => candidate.accessible && candidate.key !== seat.key,
  )

  return (
    <Card className="mt-8">
      <CardBody>
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-display text-lg font-semibold text-indigo-night-900">
            Seat {seat.label}
          </h3>
          <Button type="button" size="sm" variant="ghost" onClick={onClose}>
            Close<span className="sr-only"> seat properties</span>
          </Button>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField label="Label" id={`seat-label-${seat.key}`}>
            <Input
              id={`seat-label-${seat.key}`}
              value={seat.label}
              disabled={readOnly}
              onChange={(event) => set('label', event.target.value)}
            />
          </FormField>

          <FormField label="Price zone" id={`seat-zone-${seat.key}`}>
            <Select
              id={`seat-zone-${seat.key}`}
              value={seat.zoneKey ?? ''}
              disabled={readOnly}
              onChange={(event) => set('zoneKey', event.target.value || null)}
            >
              <option value="">No zone</option>
              {(layout.zones ?? []).map((zone) => (
                <option key={zone.key} value={zone.key}>
                  {zone.name}
                </option>
              ))}
            </Select>
          </FormField>
        </div>

        <fieldset className="mt-4">
          <legend className="text-sm font-medium text-slate-700">Attributes</legend>
          <div className="mt-2 space-y-2">
            {[
              ['accessible', 'Wheelchair space', 'Never inferred from the label.'],
              ['obstructedView', 'Obstructed view', 'The stage is partly hidden from here.'],
              ['restricted', 'Restricted', 'A house seat, a camera platform, a fire lane.'],
            ].map(([field, label, hint]) => (
              <label key={field} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={Boolean(seat[field])}
                  disabled={readOnly}
                  onChange={(event) => set(field, event.target.checked)}
                />
                <span>
                  <span className="font-medium text-slate-800">{label}</span>
                  <span className="block text-slate-600">{hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {seat.restricted ? (
          <FormField
            label="Why is it restricted?"
            id={`seat-note-${seat.key}`}
            description="Required. A restricted seat that does not say why cannot be saved."
          >
            <Input
              id={`seat-note-${seat.key}`}
              value={seat.restrictionNote ?? ''}
              disabled={readOnly}
              onChange={(event) => set('restrictionNote', event.target.value || null)}
            />
          </FormField>
        ) : null}

        <FormField
          label="Companion of"
          id={`seat-companion-${seat.key}`}
          description="Only wheelchair spaces in this section can be chosen. The pair is held and released together."
        >
          <Select
            id={`seat-companion-${seat.key}`}
            value={seat.companionOfKey ?? ''}
            disabled={readOnly || seat.accessible}
            onChange={(event) => set('companionOfKey', event.target.value || null)}
          >
            <option value="">Not a companion seat</option>
            {companions.map((candidate) => (
              <option key={candidate.key} value={candidate.key}>
                {candidate.label}
              </option>
            ))}
          </Select>
        </FormField>
      </CardBody>
    </Card>
  )
}
