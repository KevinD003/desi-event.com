# ADR 0015 — Importing listed events

- **Status:** Accepted
- **Date:** 2026-10-06
- **Supersedes:** nothing.
- **Related:** ADR 0010 (reviewer independence, which this relaxes for one
  organisation), ADR 0012 (the "Buy tickets on Sulekha" link goes through the
  website switch), ADR 0014 (editing once published), ADR 0009 (the upload
  sanitiser every copied picture passes); `docs/SECURITY.md` ("Import SSRF" and
  "Review independence for imports"); README ("Importing the Sulekha events");
  the binding addendum SPEC2-XI §1.3 and §5.I.

## Context

The owner's third request (C), verbatim:

> "Scrap the events from Sulekha.com all USA events specifically Texas events
> of Garba, Bollywood songs, concerts and etc. scrap all this with the photos
> and etc. because I own the Sulekha.com …"

**The owner's statement that they own Sulekha.com is recorded here as their
statement.** Nothing in this repository verified it, and the site does not
claim it publicly: imported events say only that they were copied from their
Sulekha listings and which organiser presents them.

The listings were collected on 29–30 September 2026: 48 upcoming events in
Texas (the Dallas–Fort Worth, Houston and Austin areas, 2 October to 22
November 2026). Events in other states were not collected. The collection had
three listings duplicated on Sulekha, one gallery picture belonging to another
event, a time-zone label wrong for a Texas venue, conflicting times, and
descriptions that had to be rebuilt from page fields. No phone numbers or email
addresses were kept.

## Decision

1. **A curated, committed dataset.**
   `packages/db/data/imports/sulekha-texas-2026.json` (format
   `desi-event-import/1`, source `SULEKHA`) holds **45 events**: the three
   duplicates dropped, the wrong picture removed, and every known data problem
   recorded on its event as an import note for the reviewing administrator
   (22 events carry notes). A validator test holds the file to its schema:
   listing and ticket links only on `events.sulekha.com`, pictures only on
   `usimg.sulekha.io`, and no email or phone patterns anywhere.
2. **An importer, with the administrator as reviewer.** `lib/event-import.js`
   behind the `imports` routes, the screen `/admin/imports`, and the CLI
   `pnpm import:events <file> --as <email> [--apply]`, all held by the new
   capability `event:import` (ADMIN, SUPER_ADMIN). Upload plans the file
   against what Desi-Event holds (create, update a draft, unchanged, posted and
   kept, skipped as decided, deleted, reassigned or past, or invalid) and
   writes only the run; apply (MODERATION step-up) writes each event as a DRAFT
   and sends it for review; approve (EVENT_PUBLISH step-up, also needing
   `moderation:review`) approves, publishes and switches the Sulekha link on,
   event by event. Idempotent by `(source, sourceId)`. A posted event is updated
   only when the administrator ticks "Update from Sulekha" for it; the CLI never
   updates one and never approves.
3. **A platform-held organisation that nobody can join.** Imported events
   belong to "Sulekha Events", created VERIFIED by a platform operation (not
   `organizations.create`, which stays 403) and marked
   `Organization.platformHeldSource = 'SULEKHA'`. A trigger refuses memberships
   and team invitations into it; not even the importing administrator belongs.
   Each event page says "Presented by" the real organiser.
4. **The review exemption.** Reviewer independence (ADR 0010) would stop the
   importing administrator approving what they submitted. It is relaxed for
   imported events and their pictures **of a platform-held organisation
   only**: `assertIndependentReviewer` returns
   `{ exemption: 'PLATFORM_HELD_IMPORT' }`, and the approval records who
   imported and who approved. Approval still needs `moderation:review`, an
   EVENT_PUBLISH step-up and the revision the administrator saw; every stored
   picture bumps the revision, so a picture the administrator did not see
   cannot ride along. The approve route accepts only imported events of that
   run, so it can never publish an organiser's own event. Reassignment ends the
   exemption. Because nobody can edit a platform-held event before it is
   published, a reviewer approves or rejects it; sending it back for changes is
   409 `IMPORTED_EVENT_NO_EDITOR`. Corrections are made after publication in an
   editing session (ADR 0014).
5. **Prices without ticket types.** Sulekha's listed prices are stored on the
   import record and shown as Sulekha listed them on the collection date, with
   a "Buy tickets on Sulekha" button that goes through the website switch and
   its counted redirect (ADR 0012), switched on by the approving administrator
   with a fixed reason. No `TicketType` is created: that would invent
   quantities and show a Desi-Event sales state for tickets on sale elsewhere.
   While an event is platform-held, adding tiers or opening sales is 409
   `SOLD_ON_SOURCE`, even for a super administrator, because that organisation
   has no payout account.
6. **One outbound fetcher.** Pictures are copied at import time by
   `lib/import-images.js`, the only module under `apps/api/src` allowed to make
   an outbound request (a source scan): one code-level host allow-list
   (`usimg.sulekha.io`), https on 443 only, every resolved address checked to be
   public and the connection pinned to it, its own `https.Agent` so no proxy
   setting reroutes it, every redirect hop validated afresh (at most two), a 10
   second timeout, a 10 MiB cap, identity encoding, a type check and then the
   upload sanitiser. Each copied picture is stored waiting for approval and is
   approved with its event. Failures are reported per picture and "Retry
   pictures" tries again; an event without pictures shows a generated poster.
   Public pages never carry a Sulekha picture address.
7. **Only what the source listed is shown.** No quantity, availability, end
   time or price is invented. The schema needs an end time, so a listing
   without one stores start plus three hours, flagged
   `EventSession.endTimeListed = false` and never shown publicly.
8. **Reassignment.** An administrator can move an imported event to an invited
   organiser's organisation (EVENT_PUBLISH step-up, a reason, audited). Moving
   it switches the Sulekha link off so the page never sends buyers to Sulekha
   under the organiser's name by mistake; the organisation is not asked first.
9. **The development seed does not import.** `pnpm import:events` loads the
   file after seeding, as the README says.

## Consequences

- **Not kept up to date.** A change on Sulekha shows here only when an
  administrator imports a newer listing. Events already past are skipped, so
  after 22 November 2026 this file imports nothing.
- **The importing machine needs direct HTTPS to `usimg.sulekha.io`.** The
  fetcher ignores proxy settings deliberately, so it can check the address it
  connects to. This build's own environment has no such access, so its imported
  events show generated posters until "Retry pictures" runs somewhere that can
  reach the host.
- **Sulekha gives no end time for 43 of the 45 events**; those pages show only
  a start time.
- **One administrator can import and publish** these events alone. A second
  administrator could be required instead.
- The limitations page states this as `imported-events`, and the footer says
  the catalogue is fictional except events copied from Sulekha.com listings.
