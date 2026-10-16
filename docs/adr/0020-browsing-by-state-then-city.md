# ADR 0020 — Browsing by state, then city, and the other listing filters

- **Status:** Accepted
- **Date:** 2026-10-16
- **Supersedes:** nothing.
- **Related:** ADR 0015 (the imported listings that make most of the
  catalogue, every one with a two-letter state or province code); `docs/api.md`
  (Events: the `GET /v1/events` query and `GET /v1/events/facets`);
  `apps/web/src/components/listing-filters.jsx`.

## Context

The owner's decisions of 2026-10-16, verbatim:

> "Go state wise and go in depth with the city, add both the filters"

> "Add all other filters and etc into it."

Before this, the public listing offered category, city and free text. City was
one flat list of names, so the catalogue's two Springfields (Illinois and
Missouri) were one option, and a visitor in Texas had to read past every city
in North America to find theirs. The API had no filter for a state, a
country, a language, a price or a day, although the venue already stored its
state or province (`Venue.region`) and country, and the event its languages.

## Decision

1. **Where: state or province, then city.** `GET /v1/events` takes `country`
   (ISO 3166-1 alpha-2) and `region` (the second half of an ISO 3166-2 code,
   `TX`, `ON`; any case). With `city`, the three are one condition on the
   venue, so a city is looked for _within_ the state. The facets gain
   `regions`: one entry per state with its code, country, display name, count
   and its cities with theirs, grouped by country, region and city — so a city
   name two states share is one entry in each. A region stored in another case
   or with spaces (an organiser's `tx`) is counted with its code. The flat
   `cities` list stays for callers that read it.
2. **One table of names.** `@desi-event/schemas/subdivisions` holds the US
   states (with DC and the five inhabited territories) and the Canadian
   provinces and territories, by ISO 3166-2 code. The API names each facet
   with it; the web labels its offline facets the same way. A code the table
   does not know is shown as the code: a raw code is honest, a guessed name is
   not.
3. **The other filters.** `language` (one language, any case: the route looks
   up the spellings stored for it, since an array column matches only
   exactly), `free=true` (the card's "from" price is $0, by the rule
   `toEventSummary` uses: the cheapest public tier on sale is free, or with
   none on sale the cheapest public tier is; a hidden $0 guest list never
   counts), `onSale=true` (status `ON_SALE`), the existing `isOnline` as
   "Format", and days (below). Sorting by price stays refused: prices are in
   two currencies.
4. **Days are read where each event happens.** A card states the start in the
   event's own timezone, so a filter for the 17th finds the events a card puts
   on the 17th, and "Today" is today where the event is. `fromDate`/`toDate`
   (calendar days, inclusive) and `when` (`today`, `weekend` Friday to Sunday,
   `week` today to Sunday, `month` today to its last day) become one
   `startsAt` range per timezone the catalogue uses, computed in the API at
   the moment of the request with `Intl` arithmetic
   (`@desi-event/schemas/calendar-days`), so the answer does not depend on the
   timezone the server runs in. The existing `startsAfter`/`startsBefore`
   instants are unchanged.
5. **The page.** `/events` keeps its real GET form, uncontrolled and never
   remounted. Category, State or province (grouped by country with
   `<optgroup>`, United States then Canada, each state with its count), City
   and Search are always shown; When (with From and To date fields), Language,
   Format, "Free only" and "Tickets on sale now" sit in a native `<details>`
   "More filters" that starts open when one of them is chosen. Selects and
   switches apply themselves once hydrated; a new state clears the city; days
   and the search wait for Apply. Before hydration and without JavaScript the
   City select cannot follow a new state, so the page drops a city that is not
   in the chosen state (and a state, city or language the facets do not have)
   rather than finding nothing. The polite status region still announces only
   changes to the count, and focus never moves by itself. "Clear filters"
   clears every field.
6. **Cards say "City, ST".** The event summary carries `region` and `country`,
   and a card reads "Lamplight Expo Hall · Edison, NJ".
7. **Venues store codes** (review of 2026-10-16, answering the open question
   below). A venue's `region` is written as its subdivision code wherever one
   can be told (`venueRegionCode`: a US or Canadian name in any case, spacing
   or accents, or a typed code of one to three letters or digits, in
   capitals) and its `country` in capitals (`countrySchema`), on venue create
   and update and on import. Any other region is kept as typed. Migration
   `20261016140000_venue_region_codes` rewrites the venues written before. The
   facets count the country in capitals too, and leave out of `regions` any
   region that is still no code (`isFilterableRegion`), so the State/Province
   select never offers an option that filters nothing; such a venue's city is
   still in `cities` and its events still list. `country` is matched in any
   case.
8. **A shared link keeps its filters when only the facets fail.** When the
   facets fall back to the sample catalogue and the listing does not, the
   URL's state, city and language stand and are added to the selects'
   options, uncounted (`withChosenOptions`).
9. **The City select names the place.** Its first option reads "Every city in
   Ontario" (the chosen state's or province's name), or "Every city in this
   state or province" when the facets have no name for it.

## Consequences

- One more raw read per listing request with a language (its spellings) and
  one more facet query; the security regression inventory of raw statements
  records both.
- A day filter adds one branch per timezone in use. The catalogue uses a
  handful; each branch is a `startsAt` range the `[status, startsAt]` index
  serves.
- The URL carries a state as its whole ISO 3166-2 code (`region=US-TX`),
  because one select submits one value; the web sends the API the two halves.
- Venue regions are rewritten to codes (decision 7). A region that is no
  code even so (an Indian state typed by name) is not a State/Province
  option; its events are found by city, search and the other filters.

## Open questions

- "This weekend" is Friday to Sunday. If the owner means Saturday and Sunday,
  it is one line in `presetDays`.
- Answered by decision 7: a venue's region is stored as its code when it is
  written, and a data migration rewrote the rows that held a name.
