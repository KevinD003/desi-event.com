'use client'

/**
 * The listing's filter bar.
 *
 * This is a real `<form method="get" action="/events">`. With JavaScript
 * disabled, or before hydration finishes, submitting it navigates to exactly
 * the URL the enhanced version would have produced — the filter state lives in
 * the query string either way. Hydration only adds conveniences: the selects
 * and the switches apply themselves on change instead of waiting for a submit,
 * changing the state or province clears the city, and the navigation is
 * client-side.
 *
 * Where comes first: a state or province, then a city within it. The State
 * select groups the catalogue's states under their country (United States,
 * Canada) with how many events each has; the City select lists the chosen
 * state's cities, or every city when no state is chosen. Without JavaScript
 * the city list cannot follow a new state choice, so the page drops a city
 * that is not in the chosen state rather than finding nothing.
 *
 * The rest — when, language, format, price and whether tickets are on sale —
 * sits behind a "More filters" disclosure, a native `<details>`, which opens
 * and closes from the keyboard and without JavaScript, and starts open when
 * one of them is chosen.
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

import { buildEventsHref, countMoreFilters, regionValue } from '../lib/search-params.js'

/**
 * @typedef {object} RegionFacet
 * @property {string} country ISO 3166-1 alpha-2, e.g. `US`.
 * @property {string} region The state or province code, e.g. `TX`.
 * @property {string} name "Texas"; the code when it is not a known one.
 * @property {number} count How many listed events it has.
 */

/**
 * @typedef {object} EventFiltersProps
 * @property {Array<{value: string, label: string}>} categories Categories offered in the select.
 * @property {RegionFacet[]} [regions] States and provinces offered, from the facets.
 * @property {string[]} cities Cities offered: the chosen state's, or all of them.
 * @property {string[]} [languages] Languages offered, from the facets.
 * @property {object} filters Current filter state, used for the initial values.
 * @property {boolean} [anyActive] Whether to offer the "clear filters" control.
 * @property {number} [resultCount] How many events match, announced politely when it changes.
 */

/** A field's label: the small uppercase eyebrow, in the muted ink. */
const LABEL = 'pl-1 text-micro font-bold tracking-eyebrow text-ink-muted uppercase'

/** A field's hint, under it. */
const HINT = 'text-xs text-ink-subtle'

/** Countries whose states are listed first, in this order; any other follows by code. */
const COUNTRY_ORDER = Object.freeze(['US', 'CA'])

/** What each country's group is called above its states. */
const COUNTRY_GROUP = Object.freeze({ US: 'United States', CA: 'Canada' })

/** The When choices, in the order the select offers them. */
const WHEN_CHOICES = Object.freeze([
  { value: '', label: 'Any time' },
  { value: 'today', label: 'Today' },
  { value: 'weekend', label: 'This weekend' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'dates', label: 'Choose dates' },
])

/** The fields a change applies at once, so a choice made before hydration is replayed. */
const SELF_APPLYING = Object.freeze(['category', 'region', 'city', 'language', 'format'])

/**
 * Read the filter values out of a form element.
 *
 * @param {HTMLFormElement} form The filter form.
 * @returns {object} The current selection, in the shape `buildEventsHref` takes.
 */
function readFilters(form) {
  const data = new FormData(form)
  const text = (name) => String(data.get(name) ?? '').trim()

  return {
    category: text('category'),
    region: text('region'),
    city: text('city'),
    q: text('q'),
    language: text('language'),
    when: text('when'),
    from: text('from'),
    to: text('to'),
    format: text('format'),
    free: data.get('free') === 'true',
    onSale: data.get('onSale') === 'true',
  }
}

/**
 * The states and provinces as `<optgroup>`s: the United States, then Canada,
 * then any other country by code; each group's states A to Z.
 *
 * @param {RegionFacet[]} regions The facets.
 * @returns {Array<{country: string, label: string, regions: RegionFacet[]}>} The groups.
 */
function groupRegions(regions) {
  const groups = new Map()

  for (const entry of regions ?? []) {
    const group = groups.get(entry.country) ?? []
    group.push(entry)
    groups.set(entry.country, group)
  }

  const rank = (country) => {
    const index = COUNTRY_ORDER.indexOf(country)

    return index === -1 ? COUNTRY_ORDER.length : index
  }

  return [...groups.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([country, entries]) => ({
      country,
      label: COUNTRY_GROUP[country] ?? country,
      regions: [...entries].sort((a, b) => a.name.localeCompare(b.name)),
    }))
}

/**
 * Category, place, free-text and "more" filters for the event listing.
 *
 * @param {EventFiltersProps} props Component props.
 * @returns {JSX.Element} The rendered filter form.
 */
export function EventFilters({
  categories,
  regions = [],
  cities,
  languages = [],
  filters,
  anyActive = false,
  resultCount,
}) {
  const router = useRouter()
  const formRef = useRef(null)

  // Open at first when one of its filters is chosen, and from then on only
  // the visitor opens or closes it: a prop that followed the filters would
  // shut the disclosure on the control they were using.
  const moreChosen = countMoreFilters(filters)
  const [moreStartsOpen] = useState(moreChosen > 0)

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
   * One of the form's controls, by name.
   *
   * @param {string} name The control's name.
   * @returns {HTMLInputElement|HTMLSelectElement|null} The control.
   */
  function field(name) {
    return formRef.current?.elements.namedItem(name) ?? null
  }

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
   * A new state or province: its cities are different ones, so the city
   * chosen in the last one is cleared before the listing is asked for.
   *
   * @returns {void}
   */
  function changeRegion() {
    const city = field('city')
    if (city) city.value = ''
    applyFilters()
  }

  /**
   * A new When choice. A named span applies at once and empties the days,
   * which only "Choose dates" uses; "Choose dates" waits for the days and
   * Apply, unless they are already filled in.
   *
   * @param {Event} event The change event.
   * @returns {void}
   */
  function changeWhen(event) {
    const value = event.target.value

    if (value !== 'dates') {
      for (const name of ['from', 'to']) {
        const input = field(name)
        if (input) input.value = ''
      }
      applyFilters()
      return
    }

    if (field('from')?.value || field('to')?.value) applyFilters()
  }

  /**
   * A day typed into From or To means "Choose dates", so When says so. The
   * listing waits for Apply: a date field reports a change at every complete
   * date while it is being typed.
   *
   * @returns {void}
   */
  function changeDay() {
    const when = field('when')
    if (when && when.value !== 'dates') when.value = 'dates'
  }

  // Until hydration the form is the plain GET form: a submit loads a new page.
  // `data-enhanced` marks the moment it starts navigating in place instead.
  const [enhanced, setEnhanced] = useState(false)

  // A select or a switch changed before hydration found no handler: the box
  // moved and the listing did not. Apply that choice as soon as the handler
  // exists, so the box and the listing never disagree. Only the controls that
  // apply themselves once hydrated; a half-typed search or a half-chosen
  // range of days still waits for a submit.
  const applyChoiceMadeBeforeHydration = useEffectEvent(() => {
    if (!formRef.current) return

    const current = readFilters(formRef.current)
    const differs = (name) => current[name] !== (filters[name] ?? '')
    const switched = (name) => current[name] !== Boolean(filters[name])
    const whenChanged = current.when !== 'dates' && differs('when')

    if (!SELF_APPLYING.some(differs) && !switched('free') && !switched('onSale') && !whenChanged) {
      return
    }

    // A new state with the old city still chosen: that city belongs to the
    // last state, so it goes, as it does when the state changes after.
    if (differs('region') && !differs('city')) {
      const city = field('city')
      if (city) city.value = ''
    }

    if (whenChanged) {
      for (const name of ['from', 'to']) {
        const input = field(name)
        if (input) input.value = ''
      }
    }

    applyFilters()
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

    for (const control of formRef.current?.elements ?? []) {
      if (!control.name) continue
      if (control.type === 'checkbox') control.checked = false
      else if ('value' in control) control.value = ''
    }

    router.push('/events')
  }

  const groups = groupRegions(regions)
  // Named for the place chosen — Ontario is a province, Texas a state — and
  // said of both when the facets have no name for it.
  const chosenRegion = filters.region
    ? (regions ?? []).find((entry) => regionValue(entry) === filters.region)
    : null
  const everyCityLabel = !filters.region
    ? 'Every city'
    : chosenRegion?.name
      ? `Every city in ${chosenRegion.name}`
      : 'Every city in this state or province'

  return (
    <form
      ref={formRef}
      action="/events"
      method="get"
      onSubmit={handleSubmit}
      aria-label="Filter events"
      data-enhanced={enhanced ? 'true' : undefined}
      className="rounded-card bg-surface-raised p-4 shadow-dialog sm:p-5 lg:p-6"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)] lg:items-start lg:gap-5">
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
          <label htmlFor="filter-region" className={LABEL}>
            State or province
          </label>
          <Select
            id="filter-region"
            name="region"
            defaultValue={filters.region ?? ''}
            onChange={changeRegion}
            aria-describedby="filter-region-description"
            className="h-13 font-semibold"
          >
            <option value="">Every state and province</option>
            {groups.map((group) => (
              <optgroup key={group.country} label={group.label}>
                {group.regions.map((entry) => (
                  <option key={regionValue(entry)} value={regionValue(entry)}>
                    {Number.isInteger(entry.count) ? `${entry.name} (${entry.count})` : entry.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
          <p id="filter-region-description" className={HINT}>
            The number is how many events each has listed.
          </p>
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
            aria-describedby="filter-city-description"
            className="h-13 font-semibold"
            options={[
              { value: '', label: everyCityLabel },
              ...cities.map((city) => ({ value: city, label: city })),
            ]}
          />
          <p id="filter-city-description" className={HINT}>
            {filters.region
              ? 'Cities in the state or province you chose.'
              : 'Choose a state or province to list only its cities.'}
          </p>
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
          <p id="filter-q-description" className={HINT}>
            Searches events, venues, cities and organisers. Every word has to match, so “garba
            houston” finds the garba nights in Houston.
          </p>
        </div>
      </div>

      {/*
        A visitor can open or close it before the page hydrates — it is a
        native disclosure — so the server's `open` and the DOM's may differ at
        hydration. The DOM is the visitor's choice and is left alone.
      */}
      <details
        open={moreStartsOpen}
        suppressHydrationWarning
        className="mt-4 rounded-control border border-line px-4 py-2"
      >
        <summary className="flex min-h-11 cursor-pointer items-center rounded-sm font-bold text-accent-strong focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus">
          More filters
          {moreChosen > 0 ? (
            <span className="ml-2 font-semibold text-ink-muted">· {moreChosen} chosen</span>
          ) : null}
        </summary>

        <div className="grid grid-cols-1 gap-4 pt-2 pb-3 sm:grid-cols-2 lg:grid-cols-4 lg:gap-5">
          <div className="flex flex-col gap-2">
            <label htmlFor="filter-when" className={LABEL}>
              When
            </label>
            <Select
              id="filter-when"
              name="when"
              defaultValue={filters.when ?? ''}
              onChange={changeWhen}
              aria-describedby="filter-when-description"
              className="h-13 font-semibold"
              options={WHEN_CHOICES}
            />
            <p id="filter-when-description" className={HINT}>
              Days are counted where each event happens. This weekend is Friday to Sunday; this week
              runs to Sunday.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="filter-from" className={LABEL}>
              From
            </label>
            <Input
              id="filter-from"
              type="date"
              name="from"
              defaultValue={filters.from ?? ''}
              onChange={changeDay}
              aria-describedby="filter-dates-description"
              className="h-13"
            />
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="filter-to" className={LABEL}>
              To
            </label>
            <Input
              id="filter-to"
              type="date"
              name="to"
              defaultValue={filters.to ?? ''}
              onChange={changeDay}
              aria-describedby="filter-dates-description"
              className="h-13"
            />
            <p id="filter-dates-description" className={HINT}>
              For Choose dates. Either day may be left empty; press Apply when they are set.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="filter-language" className={LABEL}>
              Language
            </label>
            <Select
              id="filter-language"
              name="language"
              defaultValue={filters.language ?? ''}
              onChange={applyFilters}
              className="h-13 font-semibold"
              options={[
                { value: '', label: 'Any language' },
                ...languages.map((language) => ({ value: language, label: language })),
              ]}
            />
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor="filter-format" className={LABEL}>
              Format
            </label>
            <Select
              id="filter-format"
              name="format"
              defaultValue={filters.format ?? ''}
              onChange={applyFilters}
              className="h-13 font-semibold"
              options={[
                { value: '', label: 'In person or online' },
                { value: 'in_person', label: 'In person' },
                { value: 'online', label: 'Online' },
              ]}
            />
          </div>

          <fieldset className="flex flex-col gap-2 sm:col-span-2 lg:col-span-3">
            <legend className={`${LABEL} mb-2`}>Price and tickets</legend>
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              <label className="flex min-h-11 items-center gap-2 text-sm font-semibold text-ink">
                <input
                  type="checkbox"
                  name="free"
                  value="true"
                  defaultChecked={Boolean(filters.free)}
                  onChange={applyFilters}
                  aria-describedby="filter-free-description"
                  className="size-5 rounded border-line-strong"
                />
                Free only
              </label>
              <label className="flex min-h-11 items-center gap-2 text-sm font-semibold text-ink">
                <input
                  type="checkbox"
                  name="onSale"
                  value="true"
                  defaultChecked={Boolean(filters.onSale)}
                  onChange={applyFilters}
                  className="size-5 rounded border-line-strong"
                />
                Tickets on sale now
              </label>
            </div>
            <p id="filter-free-description" className={HINT}>
              Free means the card’s price starts at $0.
            </p>
          </fieldset>
        </div>
      </details>

      {/*
        Polite, atomic, and never focused: the count is read out after whatever
        the visitor is currently doing, rather than interrupting them.
      */}
      <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button type="submit" size="lg" className="h-13">
          <SearchIcon className="h-4.5 w-4.5" />
          Apply
        </Button>
        {anyActive ? (
          <Button type="button" variant="ghost" size="lg" className="h-13" onClick={clearFilters}>
            Clear filters
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
