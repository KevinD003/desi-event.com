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
   against what The Desi Events holds (create, update a draft, unchanged,
   posted and kept, skipped as decided, deleted, reassigned or past, or
   invalid) and writes only the run; apply (MODERATION step-up) writes each
   event as a DRAFT and sends it for review; approve (EVENT_PUBLISH step-up,
   also needing `moderation:review`) approves, publishes and switches the
   Sulekha link on, event by event. Idempotent by `(source, sourceId)`. A posted
   event is updated only when the administrator ticks "Update from Sulekha" for
   it; the CLI never updates one and never approves.
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
   imported and who approved. For an event it covers only the importer of
   record approving their own submission: every import that sends an event
   for review names its administrator as the importer
   (`EventImportItem.importedById`), so a second administrator who re-imports
   a changed listing is recorded as its importer, and an account that only
   withdrew the import and sent it back by hand is refused `SELF_REVIEW` like
   any submitter. Approval still needs `moderation:review`, an
   EVENT_PUBLISH step-up and the revision the administrator saw; every stored
   picture bumps the revision, so a picture the administrator did not see
   cannot ride along. The approve route accepts only imported events of that
   run, so it can never publish an organiser's own event. Reassignment ends the
   exemption. Because nobody can edit a platform-held event before it is
   published, a reviewer approves or rejects it; sending it back for changes is
   409 `IMPORTED_EVENT_NO_EDITOR`. Corrections are made after publication in an
   editing session (ADR 0014).
5. **Prices without ticket types.** Sulekha's listed prices are stored on the
   import record and shown as Sulekha listed them on the collection date
   (without a sales date or a call to hurry that a price's name carries, such as
   "(Ends on 10/9)" or "(Final Call)": source notes are never public), with a
   "Buy tickets on Sulekha" button that goes through the website switch and its
   counted redirect (ADR 0012), switched on by the approving administrator with
   a fixed reason. No `TicketType` is created: that would invent quantities and
   show a sales state on The Desi Events for tickets on sale elsewhere. While an
   event is platform-held, adding tiers or opening sales is 409
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

## Addendum — 2026-10-15: the owner's North America export

The decision above is unchanged; this records a second dataset made under it.

The owner's request, verbatim:

> "Add all these events into our website. and admin can take out from the
> website anytime and reshare it on live anytime."

They uploaded their own Sulekha export: 397 listings as JSON, the same rows as
CSV, and a list of 1,049 picture addresses (the three agree: same ids, titles,
dates, statuses and pictures). As before, the owner's statement that the
listings are theirs is recorded as their statement. Taking an event off the
site and putting it back is the platform delete and restore of ADR 0014 §6;
nothing in this addendum changes it.

**The file.** `packages/db/data/imports/sulekha-north-america-2026.json`
(format `desi-event-import/1`, source `SULEKHA`, curated 2026-10-15) holds
**294 events**: 264 in the United States (23 states and DC) and 30 in Canada
(23 ON, 6 BC, 1 AB), dated 15 October 2026 to 7 May 2027. It was converted by
a deterministic script kept outside the repository, so a later export can be
converted the same way, and `packages/db/tests/import-dataset.test.js` holds
it to the same rules as the Texas file plus the ones below.

**What was left out.** 51 listings Sulekha marks Ended, 7 Cancelled, and 45
more dated before 15 October 2026 (31 Available, 9 Selling Fast, 5 Sold Out).
No listing lacked a venue, street, city or time, and no two listings shared a
title, date and venue. Sold Out, Selling Fast and Open Soon events (43) are
kept, the status recorded in a note for the administrator only.

**Curation rules.**

- **Collection time.** The export carries no time, so `scrapedAt`,
  `collectedFrom` and `collectedTo` are 2026-10-15T00:00:00Z.
- **Times.** The listing's date and start time are read as wall-clock time in
  the venue's IANA zone and written with that zone's offset on that date, so
  daylight saving is right on both sides of 1 November 2026 and 14 March 2027
  where the zone still changes its clocks. British Columbia (from 2026, tzdata
  2026b) and Alberta (2026c) no longer do: they stay at -07:00 and -06:00, so
  the six BC events are at -07:00 in November and December too. The offsets come
  from the converting Node's time-zone data, and the site formats times through
  Node as well, so both need tzdata 2026c or later: Node 22.23.3 (`.nvmrc`, and
  the `engines` floor). The converter refuses older data, and the dataset test
  and a web formatting test fail on it. A page's own label (EDT, PST…) is not
  trusted: 71 events carry a note on a label of the wrong season (or MDT in
  Arizona), 1 a PST label in British Columbia, which no longer uses -08:00, and
  4 a label of another zone; each is imported as local clock time. Unlike the
  Texas file's one case (401388), times labelled in another zone are kept as
  clock times rather than converted, because the converted times (for example
  3:30 PM in Surrey for "6:30 PM EDT") are the implausible ones. An end time is
  kept when it is after the start; one earlier than the start is read as after
  midnight only after an evening start (5 PM or later) with an end before 6 AM
  and at most ten hours on (26 events, each noted); an end the export marks
  estimated or derived from a duration is not imported (14), nor one that is not
  after the start (2). 94 events have no end time.
- **Zones.** By region, with city exceptions where a region spans two zones:

  | Region                                         | Zone                           |
  | ---------------------------------------------- | ------------------------------ |
  | CT, DC, FL, GA, MA, MD, NC, NJ, NY, OH, PA, VA | `America/New_York`             |
  | MI                                             | `America/Detroit`              |
  | IN                                             | `America/Indiana/Indianapolis` |
  | IN, Gary                                       | `America/Chicago`              |
  | KY, Louisville                                 | `America/Kentucky/Louisville`  |
  | IL, MN, TN, TX                                 | `America/Chicago`              |
  | CO                                             | `America/Denver`               |
  | AZ (no daylight saving time)                   | `America/Phoenix`              |
  | CA, NV, WA                                     | `America/Los_Angeles`          |
  | ON                                             | `America/Toronto`              |
  | BC                                             | `America/Vancouver`            |
  | AB                                             | `America/Edmonton`             |

  The script also knows the exceptions this export did not need (the Florida
  panhandle, western Kentucky, eastern Tennessee, Michigan's western Upper
  Peninsula, El Paso, northern Idaho, Malheur County, western Nebraska,
  Kansas and the Dakotas, Kenora, eastern British Columbia, QC as
  `America/Toronto`).

- **Venues.** Two-letter regions ("Ontario" became ON), countries US and CA,
  Canadian postal codes as `A1A 1A1`, and venue names that were entirely lower
  case title-cased, as in the Texas file.
- **Currency.** Prices at US venues are USD and at Canadian venues CAD. Where
  Sulekha writes `CA$` the currency is stated; where it writes a plain `$` or
  a bare number at a Canadian venue, **CAD is an assumption**, recorded in that
  event's note with "check the currency with the organiser" (20 Canadian events
  with prices carry a currency note; 50 prices are CAD).
- **Prices.** As listed, `priceCents` = the amount × 100, the first 20 of each
  listing (none had more). A price name loses a bracketed or trailing part that
  speaks of a sales date or scarcity ("(Limited Quantity)", "(Ends on 10/9)"),
  as `publicPriceName` does at display; "@" becomes "at". A day a pass covers is
  not a sales date: "Durga Puja Saturday 10/17" keeps "Saturday" and loses only
  "10/17", which the public page would otherwise take out with the whole part
  (402111, 7 names, noted with the Saturday passes being for the day before the
  imported date). A price's note is "Sold Out" when Sulekha says so (36) and
  otherwise null. Prices Sulekha gives as text ("Free", "$27.08 incl. $3.08
  fee", "From $25", "$1,500 plus taxes") are imported as the amount and noted;
  prices without an amount are left out and noted. Some listed prices include
  Sulekha's booking fee; they are imported as listed.
- **Categories,** by the first rule any of a listing's Sulekha categories
  matches: Navratri/Dandiya → Garba & Dandiya, but only when the listing's own
  title or description says garba, dandiya, raas or Navratri, because Sulekha
  tags Durga and Kali Pujas Navratri/Dandiya too (otherwise the next rule
  decides, noted on each: 7); Diwali → Melas & Festivals; Comedy; Drama, Drama
  Events, Theater → Theatre; Poetry → Theatre (noted); Devotional, Religious,
  Spiritual → Religious & Devotional; Classical Music Concerts, Classical, Live
  Concert, Live in Concert → Live Music; Bollywood Party, Night Party, Bollywood
  → Bollywood Nights; Music, Singing → Live Music; Food & Drink → Food
  Festivals; Christmas, New Year Eve, Exhibition, Fashion Show, Dance, Fusion →
  Melas & Festivals (noted); Magic Show → Theatre (noted). Live concerts come
  before parties and generic "Music" after them because most parties are also
  tagged Music. Six listings are exceptions, each noted: a Halloween costume
  party tagged Comedy (402162) and a "Bollywood Style DDLJ Party" tagged only
  Dance (402195) are Bollywood Nights, a matchmaking event (401497) is
  Networking, a Kali Puja (400992) and a Sashti Puja (401397) are Religious &
  Devotional, and a concert by the band Chandrabindoo (401860) is Live Music.
  Result: 73 Garba & Dandiya, 66 Live Music, 61 Melas & Festivals, 43 Comedy, 33
  Bollywood Nights, 10 Theatre, 7 Religious & Devotional, 1 Networking.
- **Text.** The description is the export's own prose; the summary is its
  first sentence (two when the first is short). Sentences that state ticket
  availability ("a sell-out is expected"), remarks about the Sulekha page
  ("conflicts with the date shown elsewhere") and one asking buyers to pay the
  organiser directly were moved out of the public text into notes (9). The
  refund policy, when given, is the one FAQ entry ("What is the refund
  policy?"). Age limits are normalised ("All Ages", "Family-friendly" → "All
  ages"); "Not specified…" is no age limit, with the export's words in a note
  when they say more. Performers are names only.
- **Pictures.** Only `usimg.sulekha.io`: Sulekha's "no image" placeholder (7)
  is left out. A thumbnail that is a smaller copy of the listing's banner (260)
  and organisers' logos (59) are left out, as the Texas file left them out.
  The first picture kept is the cover. 497 pictures, 286 covers; 8 events have
  none and show a generated poster.
- **Overlap with the Texas file.** Ten listings are in both files (400647,
  400972, 400973, 401212, 401453, 401558, 401676, 401721, 401885, 402109).
  They stay in the new file; the importer plans them as updates of the drafts
  the Texas file wrote, or keeps a posted one unless "Update from Sulekha" is
  ticked. Each carries a note naming what the newer export changes (its
  descriptions are shorter, and 400647 starts at 8:30 PM, not 7:00 PM).

Notes: 285 on 197 events, for the administrator only.

**Consequences of the addendum.**

- After 7 May 2027 the North America file imports nothing.
- The CAD assumption and the times read against a wrong zone label are
  unconfirmed until an administrator checks them with the organiser.
- The pictures still need a machine with direct HTTPS to `usimg.sulekha.io`;
  in this build's environment the events show generated posters until "Retry
  pictures" runs where the host is reachable.
