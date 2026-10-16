# ADR 0018 — Browsing by state, then city, and the other listing filters

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

## Consequences

- One more raw read per listing request with a language (its spellings) and
  one more facet query; the security regression inventory of raw statements
  records both.
- A day filter adds one branch per timezone in use. The catalogue uses a
  handful; each branch is a `startsAt` range the `[status, startsAt]` index
  serves.
- The URL carries a state as its whole ISO 3166-2 code (`region=US-TX`),
  because one select submits one value; the web sends the API the two halves.
- Venue regions are not rewritten: matching and counting ignore case and
  surrounding space, and every bundled listing already uses the code. A venue
  whose region is a name ("Texas") is its own facet entry until somebody
  corrects it.

## Open questions

- "This weekend" is Friday to Sunday. If the owner means Saturday and Sunday,
  it is one line in `presetDays`.
- Should a venue's region be normalised to its ISO code when it is written
  (venue create/update and import), with a data migration for rows that hold
  a name? Not done here; the filter and facets tolerate case and spacing only.
