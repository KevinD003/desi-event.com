# ADR 0015 — Importing listed events

- **Status:** Accepted
- **Date:** 2026-10-06
- **Supersedes:** nothing.
- **Related:** ADR 0010 (reviewer independence, which this relaxes for one
  organisation), ADR 0012 (the "Buy tickets on Sulekha" link goes through the
  website switch), ADR 0014 (editing once published), ADR 0009 (the upload
  sanitiser every copied picture passes); `docs/SECURITY.md` ("Import SSRF" and
  "Review independence for imports"); README ("Importing listed events");
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
   `packages/db/data/imports/texas-2026.json` (format
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

**The file.** `packages/db/data/imports/north-america-2026.json`
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

## Note — 2026-10-15: public and admin wording no longer names the source

The owner asked, verbatim:

> "Does, any event description or any image or anything contains the name of
> Sulekha? If yes, I want to remove that."

So, from this date, no public page and no administrator screen names the site
the events are listed on, in any case; the history above is left as it was
written. What changed, per the owner's answers:

- **Public pages.** The ticket button reads "Buy tickets", with a note, part of
  its accessible description, that it opens the organiser's ticket page on
  another site; listing cards read "From $25.00". Each imported event still
  says "Presented by" its real organiser, still says its tickets are sold on
  another site through the organiser's ticket page (never here), and still
  gives the listing's prices as the listing showed them on the day it was read.
  The footer and the limitations page say the same without the name.
- **The platform-held organisation** (decision 3) is renamed **"The Desi
  Events"**, at the web address `the-desi-events` (made unique, as any derived
  address is, if another organisation has it), with a description that names no
  other site. Migration `20261015090000_platform_held_organisation_name`
  renames one made under its first name when the database is migrated, rather
  than waiting for the next import, because its organiser page is public and an
  import may not run for weeks; it compares each old value exactly, changes data
  only and does nothing a second time. `ensurePlatformHeldOrganization` brings
  an existing one to the same name, address and description on every import
  too, idempotently, audited `organization.platform_held_updated` with the
  changed column names, never the old values. The old address is not
  redirected, since it names the site.
- **Administrators** read neutral words: "imported", "the listing", "the source
  listing", "the source site", "the picture host". This covers the API's
  refusals and problems (an upload's source and host problems no longer print
  the hosts), the terms an imported event is listed with, the website-switch
  and move reasons, moderation notes, the OpenAPI descriptions, and both
  datasets' notes and FAQ answers: the North America file was regenerated by
  the converter, changed to write neutral notes and to fail on any visible field
  that names the site, and the Texas file was rewritten by a reviewed script
  that touched only FAQ questions and answers and notes ("What is Sulekha's
  Refund Policy?" became "What is the refund policy?"). Tests fail if the name
  appears in a dataset's visible fields or notes, in any string of the API's,
  the worker's or the shared packages' code, in an email, or in `openapi.json`.
- **Kept, because they are identifiers and addresses, not words a person
  reads:** the enum value `SULEKHA` and `platformHeldSource 'SULEKHA'`, the
  venue provenance `import:sulekha`, the dataset file names, the host
  allow-lists (`events.sulekha.com`, `usimg.sulekha.io`), each listing's
  `sourceUrl` and `ticketUrl` (where the ticket button goes), migration files
  and this documentation. A dataset's header `sourceName` is kept too: no route
  returns a file's header, and the API's own `importedFrom.sourceName` now reads
  "Another ticket site" and is never printed.
- **Rows written before this date** keep the words they were written with:
  audit records and moderation notes are history, and an imported event's
  stored terms and FAQ change when the event is next updated from its listing
  (a draft on the next import; a posted one when "Update from the listing" is
  ticked for it).

## Addendum — 2026-10-15 (2): no link to the source, and tickets sold here

The owner, verbatim:

> "Make sure that the links are not redirected or directed to the Sulekha
> website or anything. There should be no connection with Sulekha or Sulekha
> event."

Asked how visitors should get tickets instead — sold on The Desi Events'
own checkout, or reserved on WhatsApp — they answered "Both". Asked whether
pictures could at least be copied once: "No contact at all".

This supersedes decisions 5 and 6, the link half of decision 8, and the
"kept" list of the note above. The history above is left as it was written.

**1. No link, no redirect, no contact.**

- An imported event has **no website link**. The importer writes none, and
  approval no longer switches one on (decision 5's fixed reason is gone). The
  address rule (`websiteUrlProblem`) refuses that site's hosts for every event,
  imported or not, with a sentence that does not name it
  (`RETIRED_SOURCE_PROBLEM`; the pattern `RETIRED_SOURCE_HOST` matches the
  site's name under any top-level domain and any name beneath it). A
  reassignment still turns the link off until an administrator approves the
  new organiser's own address.
- **Nothing is fetched.** `lib/import-images.js`, "Retry pictures" (the route
  `eventImports.retryImages`), the `EventImportImage` table and the
  `IMPORT_IMAGE_*` settings are removed. `apps/api/src` has no outbound caller
  at all (a source scan), and `apps/api/tests/import-no-outbound.test.js`
  plans both files, applies, approves and opens sales with `fetch`, `http`,
  `https`, `net`, `tls` and `dns` watched, and sees no call. An imported event
  shows a generated poster until someone adds a picture.
- **The files carry no address and no name of the site.** The listing fields
  `sourceUrl`, `ticketUrl` and `images`, and the header fields `sourceName`,
  `sourceSite` and `imageHosts`, are gone from the format; an upload that has
  them is refused field by field ("Import files carry no web address and no
  name of the site the listing came from. Remove this field."). The North
  America file was regenerated by the converter, changed to write none of them
  and to fail on any line naming the site except the source identifier; the
  Texas file was rewritten by a reviewed script that removes exactly those
  fields, drops its two notes about pictures and rewords the one note that
  said the ticket link went to the listing, and checks that nothing else
  moved (142 changes; a second run changes nothing). The notes are now 269 on
  195 events (North America; 270 before the sold-out rule in 4 below) and 26
  on 22 events (Texas). The source's id
  (`sourceId`), the enum value `SULEKHA` and the file names are kept: they are
  identifiers, and the importer is idempotent by `(source, sourceId)`.
- **Databases made before then.** Migration
  `20261015100000_imported_events_sold_here`, for events that have an import
  record only: clears a decided address on that site with its switch, time,
  decider and reason, and a current address on that site, moving the revision
  on; drops `EventImportItem.sourceUrl` and the pictures' table (pictures
  already copied stay as ordinary pictures of their events); removes the same
  fields from the files runs stored; renames the venue provenance
  `import:sulekha` to `import:listing`, since a venue page carries it. Events
  nobody imported are not touched; the address rule covers them from now on.
  Its data steps change nothing a second time, which the integration suite runs
  and `pnpm db:verify:upgrade` checks over rows of every shape (on, waiting, an
  organiser's own decided address beside a source one, an event never
  imported).

**2. Tickets are sold on The Desi Events.**

- **One ticket type per listed price** (`listingTiers`): the price's name as
  the public page shows it (`publicPriceName`), its amount, and the event's
  currency — USD at a US venue, CAD at a Canadian one. A listing whose price is
  in another currency is planned INVALID. Two identical prices become one; two
  prices of one name at different amounts are told apart by the amount
  ("Adult (CA$35.00)"). Each has `importKey` (which price it was made from)
  and an **allowance of 100** (`quantityIsAllowance`), 1 to 10 per order. The
  allowance is not the organiser's count, so no page may say how many are
  left from it; an administrator changes it in the ticket-type editor and it
  stays an allowance; an organiser's own edit of the quantity makes it a count.
- **A price the listing marks sold out** ("Sold Out", in any spacing or case)
  becomes a ticket type that is **closed**: listed, not on sale.
- **Approval publishes and opens sales.** Approving a run's event moves it
  through APPROVED and PUBLISHED and, when the event starts more than a minute
  from now, puts its draft import ticket types on sale from that moment until
  the start, then moves the event ON_SALE — each move the import's own, with
  the lifecycle's gates and audits. An event with no price is published and not
  put on sale. An event posted before this change gets its ticket types when an
  administrator updates it from its listing; approving it again then opens
  sales (`SALES_OPENED`, audited `event_import.sales_opened`).
- **Re-importing** (`syncListingTiers`): a ticket type with any sale, hold or
  order is never changed or removed. One nobody has bought takes the listing's
  new amount, currency and order, and is closed if the listing now says sold
  out (a draft event's closed one returns to draft when it no longer does); its
  name, allowance and order limits, which an administrator may have changed,
  are kept. A price that left the listing removes its unbought ticket type. A
  new price adds one, closed if sold out, otherwise a draft until sales are
  opened. The plan's digest has a version (`tiers-1`), so a plan made before
  this change is planned again.
- **`SOLD_ON_SOURCE` is removed.** A platform-held event gets ticket types,
  sales and a booking fee like any other. Paying at the venue stays refused
  for it (409 `VENUE_PAYMENT_UNAVAILABLE`): nobody at a platform-held
  organisation takes money at a door. Opening and pausing sales are organiser
  moves; for a platform-held event a platform administrator may make them in an
  open editing session (ADR 0014), audited with it, as a super administrator may
  under Rule L. Every other organiser move stays the organiser's
  (`ORGANIZER_ONLY`). Only a super administrator admits at the door, on
  platform authority (ADR 0007), since the organisation has no staff.
- **Payments are simulated** in this build (`PAYMENT_MODE=MOCK`). Checkout,
  holds, orders, tickets, the door, refunds and the finance and analytics views
  work for the platform-held organisation, held by
  `apps/api/tests/event-import-integration.test.js` against PostgreSQL (a US
  order with its booking fee, a Canadian one with Ontario tax, a free ticket
  type, a sold-out one refused, the allowance enforced, a ticket admitted and
  a refund approved).
- **Reserving on WhatsApp**, in the web app only (`apps/web`; the API has
  nothing for it). Every imported event page shows, beside the checkout, a
  "Reserve on WhatsApp" link to
  `https://wa.me/19726949043?text=<encodeURIComponent("Hi! I'd like to reserve tickets for "<title>" on <Weekday, Month D> at <venue>, <city>.")>`,
  the day read in the venue's time zone, built from `WHATSAPP_URL` in
  `src/lib/contact.js` (`reserveOnWhatsAppUrl`). It opens in a new tab
  (`target="_blank"`, `rel="noopener noreferrer"`) and its accessible name is
  "Reserve on WhatsApp, opens WhatsApp in a new tab". Events that were not
  imported do not show it. Beside it the page says "Prices are as the
  organiser listed them on <date>." and, as for every event, that payments on
  this site are simulated. No count of tickets left is shown for an allowance
  ticket type, nor for any ticket type of an event still held as imported.

**3. Words.** The platform-held organisation's description and an imported
event's refund and entry terms say tickets are sold on The Desi Events and can
be reserved on WhatsApp, with no other site. `importedFrom` on an event is
`{presentedBy, listedOn, prices, priceListed}`; its `sourceName` and
`ticketsOnSource` are gone. Kept, as identifiers only: `SULEKHA`,
`platformHeldSource 'SULEKHA'`, the dataset file names, migration files and
this documentation. No address on the site is kept anywhere in code
(`ALLOWED_STRINGS` in `@desi-event/config/source-name-scan` allows only the
enum value and the file names).

**4. After review, the same day.**

- **No other site's terms of sale.** The FAQ answers the files carried were
  the listing site's own terms ("only the ticket face value is refunded, not
  the transaction fee", "through the ticket site's app", "on our website"),
  and contradicted the event's terms here, where a cancelled event's paid
  orders are refunded in full (`lib/event-cancellation.js`). The converter no
  longer writes the export's refund answer (270 left out) and fails on any FAQ
  entry about refunds, cancelling, buying or going on sale, or naming a ticket
  site, its fees, its app or its pages; the Texas file was rewritten by a
  second reviewed script that removes exactly those entries (14: the refund,
  "How do I purchase tickets?" and "When do … tickets go on sale" answers) and
  checks that nothing else moved. Each concert's "Where is it happening?"
  stays. `packages/db/tests/import-dataset.test.js` fails on any such entry in
  either file, and finds one planted.
- **A listing sold out as a whole sells nothing.** Seven North America
  listings the export shows "Sold Out" had prices with no sold-out mark of
  their own, so approval would have opened 100 of each. The converter now
  marks every price of such a listing sold out (closed), and its note says
  so; 48 prices are marked sold out (36 before).
- **A re-import locks before it reads.** `syncListingTiers` takes each import
  ticket type's row lock (`lockTicketTypes`, sorted) and reads the tiers
  again before it counts sales and holds, as the ticket-type editor does: a
  hold locks only its ticket type, never the event, so without the lock one
  made at that moment was missed and its ticket type repriced or closed. The
  integration suite commits a hold while a re-import waits and sees the
  ticket type kept.
- **"Reserve on WhatsApp" only while it can be.** The button shows while the
  event is PUBLISHED, ON_SALE, SALES_PAUSED or SOLD_OUT and has not started
  (`reservableOnWhatsApp` in `apps/web/src/lib/imports.js`). A cancelled,
  postponed or finished imported event keeps the prices note and no chat link.
- **Structured data per ticket type.** Each offer's availability is read as
  its line on the page reads: a ticket type sold out by status or stock is
  `SoldOut`, a closed one `OutOfStock`, a paused or draft one `PreOrder`, and
  otherwise the event's state decides. A closed ticket type is never
  `InStock`.
- **Databases made before then: the words.** Migration
  `20261015110000_imported_listing_words`, data only, for events that have an
  import record: the entry and refund terms the importer wrote (both spellings
  of its old refund sentence; the entry with or without its " Age: …") become
  `IMPORT_POLICIES`, the age kept, and a term anybody changed is left; FAQ
  entries naming the site are removed, and so are those the import wrote (found
  in a stored run's file for the same listing) about its terms of sale, while
  an entry a person added stays; the website switch's reason, the moderation
  history's import notes ("Imported from …, run …"), the public change notices
  ("Updated from its … listing by the team …"), each record's administrator
  notes and the stored files' FAQ and notes are put in the converter's words
  ("the source listing", "the Texas file"), each note held to 500 characters.
  The revision moves on once per event changed. Audit rows, the enum and the
  file names stay. It changes nothing a second time, which the integration
  suite runs on a fixture of every shape, and `pnpm db:verify:upgrade` checks
  that no imported event, record, history, notice or stored file names the
  site afterwards.
- **Left for the owner.** An administrator's import pages show the uploaded
  file's name, `north-america-2026.json`, which names the site. The
  file names were kept as identifiers on the owner's instruction; renaming the
  two committed files (and the references to them) would remove it.
- **Not changed.** One North America listing (402033) is shown "Open Soon" by
  the export; its price opens on approval like any other. An administrator can
  hold it back by not approving it until the organiser opens sales.

**Consequences.**

- Buyers pay The Desi Events, not the organiser, for events the organiser has
  not joined. Before real payments are switched on, the platform needs an
  agreement with each organiser presenting an imported event, and a payout path
  for the platform-held organisation; neither exists. In this build no money
  moves.
- The allowance of 100 may be more than the venue holds or than the organiser
  still has. Administrators should set each to what the organiser confirms.
- Prices the listing included a booking fee in are sold at that amount plus
  this site's own fee, until an administrator corrects the price.
- Events posted before this change show no ticket types until updated from
  their listing and approved again.

### File names (2026-10-15)

The two datasets were renamed so that no administrator screen, which shows an
uploaded file's name, carries the source site's name:
`packages/db/data/imports/sulekha-north-america-2026.json` is now
`north-america-2026.json` and `sulekha-texas-2026.json` is now
`texas-2026.json`. Their content did not change in the rename. The internal
source value `SULEKHA` (an enum, never shown) is unchanged.
