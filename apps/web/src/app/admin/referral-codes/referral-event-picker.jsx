'use client'

/**
 * Choosing events for a referral code, or one event to filter the list by
 * (SPEC3 §12.5).
 *
 * A search box over every organisation's events (`platformEvents.list`, the
 * list of the team at The Desi Events; deleted events left out, because a code cannot name
 * one) with a "Search events" button, and the results as a list of "Add"
 * buttons. What is chosen is a list of chips, each with a "Remove" button of at
 * least 24 by 24 CSS pixels (WCAG 2.5.8). In single mode — the list page's
 * filter — choosing an event replaces the one chosen.
 *
 * The search does not run on every key press: an administrator presses the
 * button, or Enter in the box. Enter is kept from submitting the form the
 * picker sits in. What happened is said once in the picker's own polite live
 * region: how many events were found, or that one was added or removed.
 *
 * With `name`, the chosen ids are also hidden inputs of that name, so a GET
 * form carries them. Event ids are not secrets; a referral code's text never
 * passes through here.
 *
 * @module app/admin/referral-codes/referral-event-picker
 */

import { useId, useRef, useState } from 'react'

import { Button } from '../../../components/ui.jsx'
import { apiFetch } from '../../../lib/api-fetch.js'
import { parseRetryAfter, refusalSentence } from '../../../lib/refusal.js'

/** How many events one search shows. */
const RESULTS = 20

/** The search box's longest text, as the API takes it. */
const SEARCH_MAX = 120

/** The classes of the search box. */
const CONTROL =
  'min-h-11 w-full rounded-control border border-line-strong bg-surface-raised px-3 text-sm text-ink focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus'

/**
 * @typedef {object} PickedEvent
 * @property {string} id The event's id.
 * @property {string} title Its title.
 */

/**
 * @typedef {object} ReferralEventPickerProps
 * @property {PickedEvent[]} selected What is chosen.
 * @property {function(PickedEvent[]): void} onChange Given the new choice.
 * @property {string} [label] The search box's label.
 * @property {string} [hint] A sentence under the label.
 * @property {number} [max] The most events that can be chosen.
 * @property {boolean} [single] Whether choosing one replaces the one chosen.
 * @property {string} [name] When given, the chosen ids are hidden inputs of this name.
 * @property {string|null} [error] What is wrong with the choice.
 * @property {string} [errorId] The id the error's text takes, for the form's summary.
 * @property {boolean} [disabled] Whether the picker takes input.
 */

/**
 * The picker.
 *
 * @param {ReferralEventPickerProps} props Component props.
 * @returns {JSX.Element} The picker.
 */
export function ReferralEventPicker({
  selected,
  onChange,
  label = 'Find an event',
  hint = 'Search by title, web address or organisation.',
  max = 50,
  single = false,
  name,
  error = null,
  errorId,
  disabled = false,
}) {
  const id = useId()
  const searchId = errorId ?? `${id}-search`
  const hintId = `${id}-hint`
  const errorTextId = `${id}-error`
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState(null)
  const [announcement, setAnnouncement] = useState('')
  const searchRef = useRef(null)

  const chosenIds = new Set(selected.map((event) => event.id))
  const full = !single && selected.length >= max

  /**
   * Ask for the events that match.
   *
   * @returns {Promise<void>} Resolves once the results are shown.
   */
  async function search() {
    const text = query.trim()

    if (!text) {
      setAnnouncement('Type part of an event’s title to search.')
      return
    }

    setBusy(true)
    setRefusal(null)

    try {
      const response = await apiFetch('/v1/platform/events', {
        query: { q: text.slice(0, SEARCH_MAX), perPage: RESULTS, deleted: 'exclude' },
      })
      const body = await response.json().catch(() => null)

      if (!response.ok) {
        setResults(null)
        setRefusal(
          refusalSentence(
            response.status,
            body,
            'The events could not be searched.',
            parseRetryAfter(response.headers?.get?.('retry-after') ?? null),
          ),
        )
        return
      }

      const found = (body?.data ?? []).map((event) => ({ id: event.id, title: event.title }))

      setResults(found)
      setAnnouncement(
        found.length === 0
          ? 'No event matches.'
          : `${found.length} ${found.length === 1 ? 'event' : 'events'} found.`,
      )
    } catch {
      setResults(null)
      setRefusal('The service is not responding. The events could not be searched.')
    } finally {
      setBusy(false)
    }
  }

  /**
   * Choose an event.
   *
   * @param {PickedEvent} event The event.
   * @returns {void}
   */
  function add(event) {
    if (chosenIds.has(event.id) || full) return

    onChange(single ? [event] : [...selected, event])
    setAnnouncement(`Added ${event.title}.`)
  }

  /**
   * Stop choosing an event, and put focus back in the search box.
   *
   * @param {PickedEvent} event The event.
   * @returns {void}
   */
  function remove(event) {
    onChange(selected.filter((each) => each.id !== event.id))
    setAnnouncement(`Removed ${event.title}.`)
    searchRef.current?.focus()
  }

  return (
    <div className="space-y-3">
      {name
        ? selected.map((event) => (
            <input key={event.id} type="hidden" name={name} value={event.id} />
          ))
        : null}

      {selected.length > 0 ? (
        <ul aria-label={single ? 'Chosen event' : 'Chosen events'} className="flex flex-wrap gap-2">
          {selected.map((event) => (
            <li
              key={event.id}
              className="inline-flex max-w-full items-center gap-1 rounded-full border border-line-strong bg-surface-subtle py-1 pr-1 pl-3 text-sm text-ink"
            >
              <span className="min-w-0 break-words">{event.title}</span>
              <button
                type="button"
                onClick={() => remove(event)}
                disabled={disabled}
                aria-label={`Remove ${event.title}`}
                className="inline-flex min-h-6 min-w-6 items-center justify-center rounded-full px-2 text-xs font-semibold text-ink-muted hover:bg-surface-raised hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus disabled:opacity-60"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div>
        <label htmlFor={searchId} className="block text-sm font-medium text-ink">
          {label}
        </label>
        <p id={hintId} className="mt-1 text-sm text-ink-muted">
          {hint}
          {!single ? ` Up to ${max.toLocaleString('en-US')} events.` : ''}
        </p>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1 basis-56">
            <input
              ref={searchRef}
              id={searchId}
              type="search"
              value={query}
              maxLength={SEARCH_MAX}
              autoComplete="off"
              disabled={disabled}
              aria-invalid={error ? 'true' : undefined}
              aria-describedby={`${hintId}${error ? ` ${errorTextId}` : ''}`}
              onChange={(changed) => setQuery(changed.target.value)}
              onKeyDown={(pressed) => {
                if (pressed.key === 'Enter') {
                  // The picker sits inside another form: Enter searches,
                  // and never submits that form.
                  pressed.preventDefault()
                  search()
                }
              }}
              className={CONTROL}
            />
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={search}
            loading={busy}
            disabled={disabled || busy}
          >
            Search events
          </Button>
        </div>
        {error ? (
          <p id={errorTextId} className="mt-1 text-sm font-medium text-status-danger">
            {error}
          </p>
        ) : null}
      </div>

      {refusal ? <p className="text-sm font-medium text-status-danger">{refusal}</p> : null}

      {results && results.length > 0 ? (
        <ul aria-label="Events found" className="space-y-2">
          {results.map((event) => {
            const chosen = chosenIds.has(event.id)

            return (
              <li key={event.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 text-sm break-words text-ink">{event.title}</span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => add(event)}
                  disabled={disabled || chosen || full}
                  aria-label={`${chosen ? 'Added' : 'Add'} ${event.title}`}
                >
                  {chosen ? 'Added' : 'Add'}
                </Button>
              </li>
            )
          })}
        </ul>
      ) : null}

      {full ? (
        <p className="text-sm text-ink-muted">
          {max.toLocaleString('en-US')} {max === 1 ? 'event is' : 'events are'} chosen, the most a
          code can name.
        </p>
      ) : null}

      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  )
}

/**
 * The list page's event filter: one event, carried by a GET form as `eventId`.
 *
 * @param {object} props Component props.
 * @param {PickedEvent|null} props.initial The event the list is filtered by now.
 * @returns {JSX.Element} The picker in single mode.
 */
export function EventFilterField({ initial }) {
  const [selected, setSelected] = useState(initial ? [initial] : [])

  return (
    <ReferralEventPicker
      selected={selected}
      onChange={setSelected}
      single
      name="eventId"
      label="Event"
      hint="Only codes that work for this event. Search, add one, then press Show."
    />
  )
}
