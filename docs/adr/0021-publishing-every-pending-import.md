# ADR 0021 — Publishing every pending imported event at once

- **Status:** Accepted
- **Date:** 2026-10-16
- **Supersedes:** ADR 0015 in part: its approval, which was one run's events at
  a time and at most 100 per request, gains a second way in that takes every
  pending imported event across runs. Nothing else in ADR 0015 changes.
- **Related:** ADR 0010 (the review gate, and the reviewer-independence
  exemption ADR 0015 made for the platform-held organisation, which this keeps
  as it is), ADR 0007 (platform authority at the door, as amended by ADR 0018;
  untouched here),
  ADR 0020 (the catalogue these events are browsed in); `docs/api.md`
  ("Imports"); README ("Importing listed events").

## Context

The owner's decisions of 2026-10-16, verbatim:

> "Add all the events and publish all of them on live."

> Canadian prices are in CAD: "Yes works".

Two bundled files hold 339 listings (45 in Texas, 294 across North America;
10 in both). Before this, getting them live took, per file, a plan and an
apply on the command line, then on each run's page in the web "Tick the first
100", "Approve and publish", repeated until the run was done — and the ten
listings both files carry could be approved only from the later run's page
(`NOT_IN_RUN` from the earlier one). The README's example imported the newer
North America file first, so importing Texas after it put the older words
back on those ten. A posted event whose imported tiers were all closed (every
price sold out on its listing) was ticked by "Tick all" and refused
`NOT_EDITABLE` every time.

## Decision

1. **One list, one confirmation.** `GET /v1/platform/imports/pending` lists
   every imported event an approval would act on, whichever run last wrote
   it: not moved to an organiser, still in the platform-held organisation,
   its run applied, and REVIEW_PENDING or APPROVED, or PUBLISHED with an
   imported tier still a DRAFT. Only events that start more than a minute
   from now are listed (`past` counts the rest). It says how many approving
   puts on sale and how many it publishes with nothing to sell, and gives a
   digest over each event's id, revision and last run.
   `POST /v1/platform/imports/approve-pending {digest}` works the list out
   again, refuses 409 `IMPORT_PENDING_CHANGED` unless the digest is the same,
   and approves each event through the same `approveOne` a run's page uses:
   one transaction per event, the lifecycle's gates, the exemption, and the
   `event.approved` and `event.published` rows. A refusal is that event's
   alone, reported with its code and sentence; the rest go on. One
   `event_import.bulk_approved` audit row records the request: the digest,
   the counts, the runs, and each refusal's event and code — nothing secret.
2. **The same people, the same second factor.** Both routes are held by
   `event:import` and `moderation:review`; the approval needs a second factor
   within the EVENT_PUBLISH window and shares the import budget (twenty an
   hour with previews and applies). On `/admin/imports` a panel shows the
   counts and one button, which asks for the factor through `StepUpPrompt`
   when the API does, and reports how many went on sale, how many were
   published with nothing to sell, how many were left as past, and each
   refusal.
3. **The command line imports both files, in order, and approves nothing.**
   `pnpm import:events:all --as <email> [--apply]` runs `pnpm import:events`
   on `texas-2026.json` and then `north-america-2026.json`, so the newer
   file's words are the ones left and its run is the one the shared listings
   are approved from. ADR 0015's rule stands: approval is a person with a
   second factor, in the web.
4. **A run's page no longer ticks what cannot be approved.** The run view
   says how many of an event's imported tiers still wait to go on sale
   (`ticketTypes.waiting`), and a posted event is offered for approval only
   when one does.
5. **Canadian prices are CAD, confirmed.** The seven North America notes
   that asked the administrator to check the currency with the organiser now
   say the owner confirmed CAD on 2026-10-16; migration
   `20261016100000_canadian_prices_confirmed_cad` puts the same words on
   import records, stored files and stored plans that hold the old sentence.

## Consequences

- One request approves every pending event: about 310 for the bundled files,
  each its own short transaction. It takes as long as they do, and nothing
  is held across them; an event refused for a race (`TRY_AGAIN`) is left as
  it was and is on the next list.
- An event with nothing to sell is published, not put on sale: it has no
  prices, or every price is sold out on its listing. It goes on sale once
  somebody adds a ticket type in an editing session.
- An event approved after it has started is not listed; one that starts
  within the minute is not either, since nothing could be sold for it.
- The list is global. The integration suites, which share a database, test
  the library with a `runIds` scope the routes never pass, and the routes on
  the stub.

## Open questions

- Should the approval run as a background job, with progress on the page,
  if the catalogue grows to thousands of pending events? At today's size one
  request is enough.
- Should events with nothing to sell be held back from publication instead?
  The owner asked for all of them live; this publishes them.
