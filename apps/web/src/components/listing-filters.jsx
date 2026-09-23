'use client'

/**
 * The listing's filter bar.
 *
 * This is a real `<form method="get" action="/events">`. With JavaScript
 * disabled, or before hydration finishes, submitting it navigates to exactly
 * the URL the enhanced version would have produced — the filter state lives in
 * the query string either way. Hydration only adds two conveniences: the
 * selects apply themselves on change instead of waiting for a submit, and the
 * navigation is client-side.
 *
 * The form is uncontrolled: the server passes the current filters as
 * `defaultValue`s and the browser's own form state is the source of truth
 * between navigations.
 *
 * It is deliberately NOT remounted when the filters change. It used to be —
 * the parent gave it a `key` derived from the filter values — which meant every
 * change destroyed and rebuilt the form, throwing keyboard focus back to the
 * document body in the middle of the interaction. A keyboard or screen-reader
 * user who changed the category select was dropped at the top of the page with
 * no idea what had happened. Reconciling in place keeps focus where the visitor
 * put it, and a polite live region tells them what changed instead of moving
 * them.
 *
 * @module components/listing-filters
 */

import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Input, Select } from './ui.jsx'
import { SearchIcon } from './icons.jsx'

import { buildEventsHref } from '../lib/search-params.js'

/**
 * @typedef {object} EventFiltersProps
 * @property {Array<{value: string, label: string}>} categories Categories offered in the select.
 * @property {string[]} cities Cities offered in the select.
 * @property {object} filters Current filter state, used for the initial values.
 * @property {boolean} [anyActive] Whether to offer the "clear filters" control.
 * @property {number} [resultCount] How many events match, announced politely when it changes.
 */

/** A field's label: the small uppercase eyebrow, in the muted ink. */
const LABEL = 'pl-1 text-micro font-bold tracking-eyebrow text-ink-muted uppercase'

/**
 * Read the filter values out of a form element.
 *
 * @param {HTMLFormElement} form The filter form.
 * @returns {{category: string, city: string, q: string}} The current selection.
 */
function readFilters(form) {
  const data = new FormData(form)

  return {
    category: String(data.get('category') ?? ''),
    city: String(data.get('city') ?? ''),
    q: String(data.get('q') ?? '').trim(),
  }
}

/**
 * Category, city and free-text filters for the event listing.
 *
 * @param {EventFiltersProps} props Component props.
 * @returns {JSX.Element} The rendered filter form.
 */
export function EventFilters({ categories, cities, filters, anyActive = false, resultCount }) {
  const router = useRouter()
  const formRef = useRef(null)

  // Announced rather than focused. Moving focus on every filter change is its
  // own accessibility problem: it interrupts whatever the visitor was doing.
  // The count is held in state and only published after the first render so a
  // screen reader announces the *change*, not the initial page content it is
  // already reading.
  const [announcement, setAnnouncement] = useState('')
  const announced = useRef(false)

  useEffect(() => {
    if (!announced.current) {
      announced.current = true
      return
    }

    if (typeof resultCount !== 'number') return

    setAnnouncement(
      resultCount === 1
        ? '1 event matches your filters'
        : `${resultCount} events match your filters`,
    )
  }, [resultCount])

  /**
   * Navigate to the listing URL described by the form's current values.
   *
   * @returns {void}
   */
  function applyFilters() {
    if (!formRef.current) return
    router.push(buildEventsHref(readFilters(formRef.current)))
  }

  // Until hydration the form is the plain GET form: a submit loads a new page.
  // `data-enhanced` marks the moment it starts navigating in place instead.
  const [enhanced, setEnhanced] = useState(false)

  // A select changed before hydration found no handler: the box moved and the
  // listing did not. Apply that choice as soon as the handler exists, so the
  // box and the listing never disagree. Only the selects, which apply
  // themselves once hydrated; a half-typed search still waits for a submit.
  const applyChoiceMadeBeforeHydration = useEffectEvent(() => {
    if (!formRef.current) return

    const { category, city } = readFilters(formRef.current)

    if (category !== (filters.category ?? '') || city !== (filters.city ?? '')) applyFilters()
  })

  // Mount only: from then on each change applies itself.
  useEffect(() => {
    setEnhanced(true)
    applyChoiceMadeBeforeHydration()
  }, [])

  /**
   * Handle the form's submit event without a full page load.
   *
   * @param {SubmitEvent} event The submit event.
   * @returns {void}
   */
  function handleSubmit(event) {
    event.preventDefault()
    applyFilters()
  }

  /**
   * Clear every filter, resetting the form's own state as well as the URL.
   *
   * The form is uncontrolled and no longer remounts, so its DOM values have to
   * be cleared explicitly — otherwise the inputs would keep showing filters
   * that are no longer applied.
   *
   * @returns {void}
   */
  function clearFilters() {
    formRef.current?.reset()

    for (const field of formRef.current?.elements ?? []) {
      if (field.name === 'category' || field.name === 'city' || field.name === 'q') {
        field.value = ''
      }
    }

    router.push('/events')
  }

  return (
    <form
      ref={formRef}
      action="/events"
      method="get"
      onSubmit={handleSubmit}
      aria-label="Filter events"
      data-enhanced={enhanced ? 'true' : undefined}
      className="grid grid-cols-1 gap-4 rounded-card bg-surface-raised p-4 shadow-dialog sm:grid-cols-2 sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.6fr)_auto] lg:items-start lg:gap-5 lg:p-6"
    >
      <div className="flex flex-col gap-2">
        <label htmlFor="filter-category" className={LABEL}>
          Category
        </label>
        <Select
          id="filter-category"
          name="category"
          defaultValue={filters.category ?? ''}
          onChange={applyFilters}
          className="h-13 font-semibold"
          options={[
            { value: '', label: 'All categories' },
            ...categories.map((category) => ({ value: category.value, label: category.label })),
          ]}
        />
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="filter-city" className={LABEL}>
          City
        </label>
        <Select
          id="filter-city"
          name="city"
          defaultValue={filters.city ?? ''}
          onChange={applyFilters}
          className="h-13 font-semibold"
          options={[
            { value: '', label: 'Every city' },
            ...cities.map((city) => ({ value: city, label: city })),
          ]}
        />
      </div>

      <div className="flex flex-col gap-2 sm:col-span-2 lg:col-span-1">
        <label htmlFor="filter-q" className={LABEL}>
          Search
        </label>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3.5 h-5 w-5 -translate-y-1/2 text-ink-subtle" />
          <Input
            id="filter-q"
            type="search"
            name="q"
            defaultValue={filters.q ?? ''}
            placeholder="Event, venue or organiser"
            autoComplete="off"
            aria-describedby="filter-q-description"
            className="h-13 pl-11"
          />
        </div>
        <p id="filter-q-description" className="text-xs text-ink-subtle">
          Searches events, venues, cities and organisers. Every word has to match, so “garba
          houston” finds the garba nights in Houston.
        </p>
      </div>

      {/*
        Polite, atomic, and never focused: the count is read out after whatever
        the visitor is currently doing, rather than interrupting them.
      */}
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </p>

      <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-1 lg:pt-6">
        <Button type="submit" size="lg" className="h-13">
          <SearchIcon className="h-4.5 w-4.5" />
          Apply
        </Button>
        {anyActive ? (
          <Button type="button" variant="ghost" size="lg" className="h-13" onClick={clearFilters}>
            Clear
          </Button>
        ) : null}
        {/*
          A deliberate way to reach the results, for a keyboard user who has
          just changed a filter and does not want to tab through the rest of
          the bar. Focus moves only when they ask for it.
        */}
        <a
          href="#event-results"
          className="inline-flex min-h-11 items-center rounded-control px-2 text-sm font-bold text-accent-strong underline underline-offset-4 hover:decoration-2"
        >
          Skip to results
        </a>
      </div>
    </form>
  )
}
