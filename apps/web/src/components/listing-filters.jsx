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
 * The form is uncontrolled. The server component that renders it passes the
 * current filters as `defaultValue`s and remounts it with a `key` derived from
 * those filters, so the browser's own form state is the single source of truth
 * between navigations and there is no controlled-input state to fall out of
 * sync with the URL.
 *
 * @module components/listing-filters
 */

import { useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Button, FormField, Input, Select } from './ui.jsx'

import { buildEventsHref } from '../lib/search-params.js'

/**
 * @typedef {object} EventFiltersProps
 * @property {Array<{value: string, label: string}>} categories Categories offered in the select.
 * @property {string[]} cities Cities offered in the select.
 * @property {object} filters Current filter state, used for the initial values.
 * @property {boolean} [anyActive] Whether to offer the "clear filters" control.
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
export function EventFilters({ categories, cities, filters, anyActive = false }) {
  const router = useRouter()
  const formRef = useRef(null)

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

      <div className="flex items-center gap-2">
        <Button type="submit">Apply</Button>
        {anyActive ? (
          <Button type="button" variant="ghost" onClick={() => router.push('/events')}>
            Clear
          </Button>
        ) : null}
      </div>
    </form>
  )
}
