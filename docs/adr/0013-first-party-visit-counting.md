# ADR 0013 — First-party visit counting, without cookies or stored addresses

- **Status:** Accepted
- **Date:** 2026-10-06
- **Supersedes:** nothing. Before this, nothing recorded a page view, and the
  analytics funnel said so.
- **Related:** ADR 0012 (website visits are counted through this),
  `docs/PRIVACY_AND_RETENTION.md` ("Visit counting"), `docs/SECURITY.md`
  ("Visit counting and the traffic trust chain"); SPEC2 §1 D7 and §4.N.

## Context

The owner asked that organisers see "number of click, number of people visited
event page, how many redirected to the main website … and many other", and
that only the organiser see their own event's figures.

A third-party analytics script would send every visitor's address and browser
to somebody else and set cookies; the site has a consent banner for neither.
Raw page-view logs keyed by address are personal data the site has no reason to
keep.

## Decision

1. **Beacons from the site's own pages.** `traffic.beacon` records a page view,
   an event-card click (home, events list, search) or a "Choose tickets" /
   "Choose seats" press, for a publicly visible event only. A page view carries
   the referring site's host name, never a URL, sorted into five sources:
   direct, The Desi Events pages, search, social, other. The answer is always
   202, counted or not, so it reveals nothing about events that are not public.
   No session is read.
2. **Nothing about the visitor is stored.** A raw `TrafficEvent` row holds the
   event, the kind, the place, the day and a visitor code — no address, no
   browser string, no account. The code is an HMAC of the connection and
   browser under a random **secret for that day** (`TrafficSalt`), which is
   deleted from the live database when the day ends; a row without an address
   is not stored at all. A visitor is recognised for one day and one event only.
   The dedupe key is keyed by the day's secret too, so it cannot be recomputed
   from the row.
3. **Who is not counted.** Robots and automated tools (an agent pattern with
   word boundaries), the organisation's own members and staff at The Desi Events
   while signed in (the page decides from its session and sends no beacon), and
   browsers sending Global Privacy Control or Do Not Track, which count as page
   views but never as visitors.
4. **A trust chain for the address.** The web tier computes the visitor's
   address from `TRAFFIC_TRUSTED_PROXY_HOPS` and forwards it in
   `x-desi-client-address`; the API believes that header only from
   `TRAFFIC_TRUSTED_FORWARDERS` (loopback by default), and never forwards one a
   browser sent.
5. **Daily totals, rolled up by the worker.** The `roll-up-traffic` job (every
   ten minutes by default, `TRAFFIC_ROLLUP_INTERVAL_MS`, under a lease) adds raw
   rows into `TrafficDaily`, one row per event per UTC day, with CHECKs that the
   parts add up. Screens read only `TrafficDaily`, never raw rows, and show when
   the figures run to and when they are stale (over two hours).
6. **The roll-up deletes what it has added up.** Raw rows are deleted two days
   after their day, and day secrets once the day is over, by the roll-up itself.
   This is data minimisation, not a retention decision: the retention machinery
   is built so it cannot delete (`docs/RETENTION_RUNBOOK.md`), and giving it a
   delete path for one table would undo that. No `traffic_event` retention class
   was added.
7. **Who sees what.** An organisation's figures are in `analytics.summary` and
   its CSV (`report:view` in that organisation). The platform's list of every
   event (`traffic.events`) needs `analytics:view_all` (ADMIN, SUPER_ADMIN) and
   carries counts only. Deleted events stay listed, marked, because money was
   taken for them; beacons for them are not recorded.
8. **Demonstration figures are marked.** `TrafficDaily.demonstration` is true
   only for rows the development seed writes; the roll-up always writes false,
   and any screen summing one says "Demonstration figures".
9. **Limits.** 60 beacons a minute per visitor; beyond 3,000 a minute for one
   event or 6,000 for one API process, beacons are answered and not counted.

## Consequences

- **A guide, not an audit.** Somebody returning tomorrow counts again; a
  browser without JavaScript is not counted; without a trusted proxy in front
  of the web server one person can pose as many visitors. The copy says so.
- **No time of day, device, location, returning-visitor or referring-URL
  data**, deliberately.
- **Backups keep each day's secret** for as long as the backups are kept, so a
  restored backup could link that day's codes to addresses again.
- **Figures lag the roll-up**, which runs every ten minutes by default; a
  stopped worker shows as stale figures.
- The limitations page states this as `visit-counts`, and the retention entry
  names the roll-up as the one deletion on a timer.

## Alternatives considered

- **A third-party analytics product:** rejected for the privacy reasons above
  and because it would put a cross-site script on every page.
- **Purging raw rows through the retention sweep:** rejected (point 6).
- **A per-visitor cookie for returning visitors:** rejected; it would need
  consent and is more than the owner asked for.
