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

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, FormField, Input, Select } from './ui.jsx'

import { buildEventsHref } from '../lib/search-params.js'

/**
 * @typedef {object} EventFiltersProps
 * @property {Array<{value: string, label: string}>} categories Categories offered in the select.
 * @property {string[]} cities Cities offered in the select.
 * @property {object} filters Current filter state, used for the initial values.
 * @property {boolean} [anyActive] Whether to offer the "clear filters" control.
 * @property {number} [resultCount] How many events match, announced politely when it changes.
 */

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
      resultCount === 1 ? '1 event matches your filters' : `${resultCount} events match your filters`,
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
      className="grid grid-cols-1 gap-4 rounded-card border border-slate-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_2fr_auto] lg:items-end"
    >
      <FormField label="Category" id="filter-category">
        <Select
          name="category"
          defaultValue={filters.category ?? ''}
          onChange={applyFilters}
          options={[
            { value: '', label: 'All categories' },
            ...categories.map((category) => ({ value: category.value, label: category.label })),
          ]}
        />
      </FormField>

      <FormField label="City" id="filter-city">
        <Select
          name="city"
          defaultValue={filters.city ?? ''}
          onChange={applyFilters}
          options={[
            { value: '', label: 'Every city' },
            ...cities.map((city) => ({ value: city, label: city })),
          ]}
        />
      </FormField>

      <FormField
        label="Search"
        id="filter-q"
        description="Try an artist, a venue or something like “garba toronto”."
      >
        <Input
          type="search"
          name="q"
          defaultValue={filters.q ?? ''}
          placeholder="Search events"
          autoComplete="off"
        />
      </FormField>

      {/*
        Polite, atomic, and never focused: the count is read out after whatever
        the visitor is currently doing, rather than interrupting them.
      */}
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </p>

      <div className="flex items-center gap-2">
        <Button type="submit">Apply</Button>
        {/*
          A deliberate way to reach the results, for a keyboard user who has
          just changed a filter and does not want to tab through the rest of
          the bar. Focus moves only when they ask for it.
        */}
        <a
          href="#event-results"
          className="rounded-lg px-3 py-2 text-sm font-medium text-indigo-night-700 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-marigold-500"
        >
          Skip to results
        </a>
        {anyActive ? (
          <Button type="button" variant="ghost" onClick={clearFilters}>
            Clear
          </Button>
        ) : null}
      </div>
    </form>
  )
}
