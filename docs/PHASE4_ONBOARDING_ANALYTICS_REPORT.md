# Phase 4 onboarding, analytics, full control and import report

- **Date:** 2026-10-08
- **Branch:** `claude/phase4-frontend-ui-ux-completion`
- **Base:** `5eb42f4` and the fixes after it (`edbc3ea`, `340dcfa`, `efd3527`).
  This work is in the commits from `26f5b77` (the mail provider packages)
  through `a892956`. The features run to `92600b3` (guards for full control and
  the importer); `176e895` is the integration stage (the limitations page, the
  documents and the development seed's demonstration data). After it came the
  browser journeys (`20e2915`), the fixes from the whole-build review
  (`9caacba`), two test-reliability fixes (`ec0c909`), search speed (`4a01f61`),
  "try again" instead of a failure for commands that wait on a busy event, with
  four database indexes (`8d37320`), and a cancelled night's confirmation that
  stays on screen until it is closed (`a892956`).
- **Payment mode:** `PAYMENT_MODE=MOCK` throughout. No real payment, card
  capture, Connect onboarding, refund or payout happens anywhere in this work.
  Every refund it mentions is simulated.
- **Binding decisions:** ADR 0010 to ADR 0015 (`docs/adr/`), indexed in
  [`DECISIONS.md`](DECISIONS.md).

This report is written for the site's owner. It says what each of your three
requests became, what a published event can still change without another
review, what this build cannot do honestly, what was not built, what needs your
own accounts or machines, the decisions taken for you, each of which can be
reversed, and what was found and fixed after this report's first version. The
limitations page (`/limitations`) mirrors the §Limitations table below word for
word; `apps/web/src/lib/limitations.js` cites this section.

Historical reports are not rewritten. Where this report and
[`PHASE4_FEATURE_COMPLETION_REPORT.md`](PHASE4_FEATURE_COMPLETION_REPORT.md)
disagree — on who may start an organisation, on pictures after publication, on
email, on what a live event may change — this report is the later one.

---

## What you asked for, and what you get

### A. Only invited organisers post, and only reviewed events go up

- **Nobody can start an organisation for themselves any more.** An
  administrator or super administrator invites an organiser at
  `/admin/organizer-invitations`, writing the address, the organisation's name
  and, if they like, its public description, website and a private note. The
  invitation always starts a **new** organisation, which is verified from the
  start; the person invited becomes its owner when they accept at
  `/account/organizations/new` (ADR 0010).
- **The code is never in a link.** The invitation link opens the join page and
  the person types the code, which is single-use, bound to the invited address,
  lasts fourteen days and can be withdrawn or reissued. Only a digest of it is
  stored.
- **How the code reaches them.** In this environment there is no mail server,
  so the administrator sees the code once, beside a ready-to-send message to
  paste into an ordinary email. A deployment that sets `DELIVERY_MODE=EMAIL`
  and its SMTP settings has the code emailed instead, with no code shown on
  screen; a failed send withdraws the invitation (ADR 0011).
- **A new platform role, "Platform administrator" (`ADMIN`).** It holds a fixed
  list of ten capabilities — review, invitations, venues, reports, the website
  switch, everybody's visit figures, editing and deleting posted events, and
  importing — and nothing touching money. A test fails if the list changes
  without the test changing with it.
- **Posting roles come only from the Desi-Event team.** Inside an organisation,
  members can be invited or moved only to roles that do not post events, and a
  member who posts can be moved only downwards.
- **Every event is reviewed before its first publication, in the database
  itself.** A trigger refuses any move to a public status that did not pass
  through approval. The reviewer must name the version they read, and may not
  approve an event of an organisation they belong to or one they submitted.

### The website link, switched by administrators

- An event's website address is the organiser's; whether the event page links
  to it is an administrator's decision, made at `/moderation/websites` with a
  reason (ADR 0012).
- An organiser who changes the address never moves the switch. While the link
  is on, it keeps going to the address an administrator approved until one
  approves the new address or turns the link off.
- The link goes through `/events/<slug>/website`, which counts the visit and
  sends the visitor on. Organisers see who switched it, when and why.

### Visit figures for organisers

- Organisers see, for their own events only, page views, unique visitors per
  day, clicks from event cards, presses of "Choose tickets" or "Choose seats",
  visits to their website through the link, where visitors came from (direct,
  Desi-Event pages, search, social, other), and orders, at `/analytics`
  (ADR 0013).
- Administrators and super administrators see every event's counts at
  `/analytics/events`, without money figures.
- Nothing about a visitor is kept: no address, no browser description, no
  account. A visitor is recognised for one day and one event only, through a
  secret for that day which is deleted when the day ends. Raw visit records are
  deleted two days after their day, once added up.

### B. Full control of posted events

- **Organisers edit posted events freely**, with no second review, as you
  chose (ADR 0014).
  - A change to the date, time, place or terms needs a short reason, and every
    ticket holder sees it on their order page. It is not emailed.
  - A ticket price can change after sales; people who already bought keep what
    they paid.
  - A single night can be cancelled, and its tickets are refunded.
  - A finished or cancelled event can still have its words and pictures
    corrected.
- **Administrators and super administrators can edit any organisation's
  published event.** They open an editing session at `/admin/events` with a
  reason and their second factor. The session works only in the browser that
  opened it, lasts up to an hour, and asks for the second factor again every ten
  minutes while changes are being made. Every change is recorded with their
  name and the reason; the organiser sees the reason and what changed, and "a
  Desi-Event administrator" rather than the name.
- **Publishing, sales, postponing, cancelling and rescheduling stay the
  organiser's.** An administrator cannot do them; a super administrator can, as
  before, and each is shown as "by the Desi-Event team".
- **Deleting.** An event manager can delete an unsold event; an organisation
  administrator or owner can delete a sold one; administrators and super
  administrators can delete any. What it does depends on what was sold, and is
  shown before anyone confirms:
  - **Nothing sold:** the event leaves the site at once.
  - **Tickets sold for a date still to come:** the event is cancelled and every
    paid order is refunded what it paid, booking fee and tax included
    (simulated here). Orders under a payment dispute are left to finance.
  - **The event has happened:** only the page comes down. If nobody was checked
    in through Desi-Event, the person deleting says whether it took place.
  - A deleted event is kept, with its orders, tickets and history. The
    Desi-Event team can restore it; one that was on sale comes back paused, so
    the organiser decides when to sell again.
- **Pictures can be added to a live event.** Each new picture appears once
  someone on the Desi-Event team **other than the person who uploaded it**
  approves it at `/moderation/pictures`. A replaced cover stays up until its
  replacement is approved.

### Money problems found in the existing code, fixed first

Before the deleting and night-cancelling work, nine faults in the existing
refund code were fixed, each tested on a real database with orders carrying the
booking fee, tax and a promo code (`docs/REFUNDS_DISPUTES.md`, "Fees, tax and
retries — 2026-09-30"):

1. A full refund of any paid USD order, asked for by amount, was sent and then
   failed to record, because the 99¢ booking fee was charged against the ticket
   lines. The refund was left stuck as "submitted".
2. On a discounted order, a full refund left some tickets valid.
3. A partial refund smaller than one ticket withdrew a ticket anyway.
4. Trying again after a failed or declined refund broke the order's refund
   counter, and the database refused it.
5. Cancelling an event created refund requests that could never complete. Old
   ones are repaired when next touched.
6. A refund of particular tickets returned only their price. It now also returns
   their share of the booking fee and tax, as the refund policy says.
7. A payment confirmed after its order had been closed was recorded silently. It
   now opens a finance task.
8. A refund could be sent on a payment already under a chargeback, paying twice.
   It is now refused and left to finance.
9. The steps that send a refund lived only inside one route; they are now one
   shared function every refund path uses.

### C. The Sulekha events

- **45 of the 48 collected events are ready to import.** Only Texas was
  collected (the Dallas–Fort Worth, Houston and Austin areas, 2 October to 22
  November 2026); events in other states were not. Three were the same event
  listed twice on Sulekha, so one copy of each is kept; one picture that
  belonged to another event was removed; 22 events carry notes for you to check
  (time-zone oddities, conflicting times, descriptions rebuilt from the page, a
  removed phone number, and categories chosen where Desi-Event has no matching
  one). No phone numbers or email addresses were kept (ADR 0015).
- **The development seed does not import them.** You or another administrator
  import them after seeding, at `/admin/imports` or with
  `pnpm import:events` (README, "Importing the Sulekha events").
- **They belong to a new "Sulekha Events" organisation that nobody can join.**
  Each page says "Presented by" the real organiser.
- **The import screen is your review.** Upload the file, read the plan and the
  notes, import, look at each event and its pictures, then approve and publish
  in one step. The rule that a reviewer may not approve their own submission is
  relaxed only for these imported events, so one administrator can import and
  approve them; who imported and who approved each one is recorded. Because
  nobody belongs to "Sulekha Events", nobody can edit one before it is
  published, so the review is approve or reject, and a correction is made in an
  editing session once the event is up.
- **Tickets are not sold on Desi-Event for these events.** Each page shows
  Sulekha's prices as listed on 29–30 September 2026 and a "Buy tickets on
  Sulekha" button, which goes to the Sulekha event page through the counted
  website link, switched on by the administrator who approved the event. No
  Desi-Event ticket types are created, because that would mean inventing
  quantities. While an event belongs to "Sulekha Events", tickets cannot be sold
  for it here, even by a super administrator: that organisation has no payout
  account.
- **When a real organiser joins**, an administrator can move the event to their
  organisation, which then manages it and may sell tickets here. Moving it
  switches the "Buy tickets on Sulekha" link off.
- **Pictures are copied at import time from `usimg.sulekha.io`**, the only
  picture host in the data. The machine running the import must reach that host
  directly: the copier deliberately ignores proxy settings, so it can check the
  address it connects to. If it cannot, the events show a generated poster and
  "Retry pictures" copies them later.
- **Ownership.** Your statement that you own Sulekha.com is recorded in ADR 0015
  as your statement. Nothing in this repository verified it, and the site does
  not claim it publicly: imported events say only that they were copied from
  Sulekha listings.

---

## What a published event can still change without another review

This is the list as built, replacing the one in the first plan. It is the
limitations page's own sentence for `live-changes-not-reviewed`, word for word:

> On a published, on-sale, paused, sold-out or postponed event, the organiser —
> or the Desi-Event team, in an editing session opened with a reason — can
> change everything without another review, and the change is public when it
> saves. The date, time, time zone, place, joining link, age limit and entry,
> refund and conduct terms change only with a reason, and every ticket holder
> is shown the change on their order page; it is not emailed. Ticket types can
> be added, edited, re-priced (people who already bought keep what they paid),
> closed, hidden, or removed if unused. Nights can be added, moved, given
> another seating map while nothing at them is sold, removed if unused, or
> cancelled with their tickets refunded. The venue cannot be changed while a
> night uses a seating map. New pictures appear only after someone on the
> Desi-Event team other than the person who uploaded them approves each one;
> the old cover stays until then. (Pictures copied by an import are the
> exception: the administrator who reviews the import approves them with the
> event.) A finished or cancelled event keeps its words and pictures editable.
> The organisation's venue records can be edited at any time, and every event
> there shows the new details without review. An event's website address can
> be changed at any time; a new address is not linked until an administrator
> approves it. Promo codes are never reviewed.

What keeps "approved, then changed into something else" in check: every change
is recorded with its fields and who made it; the Desi-Event team's list of
every event at `/admin/events` sorts by "recently changed"; and administrators
can edit or delete any posted event.

---

## Where to find it

| Screen                                     | Who uses it                                                      | What it is for                                                                    |
| ------------------------------------------ | ---------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `/admin/organizer-invitations`             | Administrators, super administrators                             | Invite an organiser; reissue or withdraw an invitation                            |
| `/account/organizations/new`               | The person invited                                               | Type the code and start the organisation                                          |
| `/moderation/events`                       | Moderators, administrators, super administrators                 | Review events before their first publication                                      |
| `/moderation/pictures`                     | The Desi-Event team, never a picture's own uploader              | Approve or decline pictures added to posted events                                |
| `/moderation/websites`                     | Administrators, super administrators                             | Turn an event's website link on or off, or approve a changed address              |
| `/admin/events`, `/admin/events/[id]`      | Administrators, super administrators                             | Every event, sorted by recent change; open an editing session; delete or restore  |
| `/admin/imports`, `/admin/imports/[runId]` | Administrators, super administrators                             | Upload a listing file, read the plan, import, approve and publish, retry pictures |
| `/analytics`                               | An organisation's members who can see reports                    | Their own events' visits and orders                                               |
| `/analytics/events`                        | Administrators, super administrators                             | Every event's visit counts, without money figures                                 |
| `/organizer/events/[id]`                   | The organisation (or the Desi-Event team, in an editing session) | Edit a posted event, cancel a night, delete it                                    |

---

## What this build cannot do honestly

- **Email is opt-in and has been tried only against a local test mail
  server.** It needs SMTP settings the operator supplies (`DELIVERY_MODE=EMAIL`
  with `SMTP_HOST`, `SMTP_FROM` and `WEB_ORIGIN`). This environment has none,
  so the administrator sees each organiser-invitation code once, with a
  ready-to-send message. Team-invitation and ticket-transfer codes are shown
  once without a message. Receipts, address confirmations, password resets and
  change notices about an event are never emailed, in any configuration;
  password-reset and confirmation links would carry a secret in the address.
- **Email ownership is not checked.** Somebody who registers the invited
  address first and obtains the code could accept it. The code is single-use,
  expires, can be withdrawn, and every acceptance is recorded with who invited.
- **Reviewer independence cannot see one person behind two accounts.** An
  administrator could invite a second address of their own and approve its
  events from the first account. A super administrator can list the
  organisations each administrator's invitations created.
- **Visit figures are a guide, not an audit.**
  - "Unique visitors" means per event per day; somebody returning tomorrow
    counts again.
  - Visitors without JavaScript, and some blocked or automated visits, are not
    counted. Robots, the organisation's own team and Desi-Event staff are left
    out.
  - Browsers that ask not to be tracked count as page views only.
  - Without a trusted proxy configured in front of the site, one person can pose
    as many visitors.
  - Figures lag the background job that adds them up, which runs every ten
    minutes by default; a stopped worker shows as stale figures.
  - There is no time-of-day, device, location, returning-visitor or
    referring-address data. That is deliberate.
  - Raw visit records are deleted two days after their day by the job that adds
    them up, not by the retention machinery, which by design cannot delete
    anything.
  - Backups keep each day's secret for as long as the backups are kept.
- **One switched link.** The switch covers an event's main website link only.
  Links in the description, sponsors' links, social accounts and organisations'
  own websites on their organiser pages are not switched or counted. Nobody
  opens or checks the site behind a link; the administrator's checkbox is a
  prompt, not a check.
- **The organiser cannot turn their link off.** Only an administrator can, as
  you asked; the organiser asks the team.
- **Large refunds may take more than one pass.** Refunds for a deleted event or
  a cancelled night are sent while the page waits: 500 at a time here
  (simulated), 25 at a time with a real provider. Any left over are sent with
  "Finish refunds", and so is a refund whose order stayed busy with another
  change (a checkout, or finance at the refund screen) for longer than it could
  wait: it is left owed, with nothing of it half-written.
- **A ticket valid for every night is not partly refunded** when one night is
  cancelled. Its holder is told, and the organiser can refund it by hand.
- **A deleted event is kept, not erased.** Reasons people type are kept as
  written and are not rewritten by the privacy process.
- **A super administrator can still publish, pause, postpone or cancel any
  event** without opening an editing session, as before. Each such action is
  recorded and shown as "by the Desi-Event team".
- **Imported events do not follow later changes on Sulekha.** A change shows
  here only when a newer file is imported, and a posted event is updated only
  when an administrator ticks "Update from Sulekha" for it. Events already past
  are skipped, so after 22 November 2026 this file imports nothing.
- **Only Texas events were collected from Sulekha.** The importer takes any file
  in the same format, so other states can be added by collecting them the same
  way.
- **Sulekha gives no end time for 43 of the 45 events.** Those pages show only a
  start time. The database stores an estimate (start plus three hours), which
  public pages never show; the editing screens show it marked "Not listed by
  Sulekha (estimate for scheduling)". Once an editor sets a real end time, the
  page shows it; moving the whole night keeps the end an estimate.
- **Pictures for imported events need direct internet access to Sulekha's
  picture server.** This build's own environment has none, so its imported
  events show generated posters until "Retry pictures" runs somewhere that can
  reach it. Whether that server lets another server fetch its pictures has not
  been tried from here.

## Not built, and found while building

- **The organisation select box on `/admin/events` is not built.** Filtering
  that list by organisation would need a list of organisations that an
  administrator (not only a super administrator) may read, and there is none.
  Instead, each row's organisation name filters the list to that organisation,
  and the search box finds events by their title, web address or organisation
  name.
- **The import upload form's own check in the browser compares the file against
  2 MiB only.** A file just under that size can still be too large once stored;
  the server refuses it with a 422 and the reason, and the form shows that
  reason.
- **A purge of long-deleted events' pictures is not built.** A deleted event's
  pictures are kept for a restore and stop counting towards the organisation's
  1 GiB picture allowance. A second ceiling counts everything the organisation
  holds, deleted events included: 2 GiB in all. Past it, an upload is refused
  with a sentence telling the organiser to remove pictures from past events, or
  to ask the Desi-Event team to restore a deleted event and then remove its
  pictures, so deleting events and uploading again cannot grow storage without
  end.
- **The optional rule "a reviewer may not review organisers they invited" is
  not built**; it was offered as an option and left off.
- **After an imported event is moved to a real organiser, its terms still point
  to Sulekha.** Its refund terms still say tickets are sold on Sulekha, and its
  entry terms still send people to the Sulekha listing. The move does not
  change the terms; the new owner can edit them.
- **A night's cancellation and a refund of the same order settling at the same
  moment can deadlock.** The database then stops one of the two with nothing
  half-written, and that one has to be tried again; a canceller is told to try
  again. This was found by reading the code; no test has forced it.
- **An order can stay marked paid after being refunded in full.** When a
  night's cancellation refunds an order but keeps its free ticket for another
  night, the order stays paid so that ticket still admits. If that ticket is
  later withdrawn too (its own night cancelled), the whole order is recorded as
  refunded (simulated here), but it is still marked paid.
- **The ceiling of 3,000 visit records a minute for one event counts repeats
  too.** On each server process, a repeat that the database then turns away as
  already counted still takes a place under that ceiling, so in a minute that
  busy some new visitors can go uncounted. The website link's own per-minute
  limit gives such places back; this ceiling does not.

## What needs your accounts or your machines

- **Sending email:** an SMTP account with a mail provider, and its settings in
  the deployment's environment (`.env.example` lists them; the password is
  never committed). Until then everything works in `MANUAL` mode.
- **Copying the Sulekha pictures:** a machine with direct outbound HTTPS to
  `usimg.sulekha.io`, not through a proxy. Run the import there, or run "Retry
  pictures" there later.
- **Visit counting behind a proxy or load balancer:** set
  `TRAFFIC_TRUSTED_PROXY_HOPS` on the web server and
  `TRAFFIC_TRUSTED_FORWARDERS` on the API to match the deployment, or one
  person can pose as many visitors.
- **Somewhere to run the site:** hosting for the web server, the API and the
  worker, with PostgreSQL and Redis beside them, an https address for
  `WEB_ORIGIN`, and the secrets in that deployment's environment. Nothing in
  this repository deploys it.
- **Real payments:** your own Stripe account, with its Connect onboarding and
  verification, and a later change that makes live payments reachable at all.
  Payments here are simulated (`PAYMENT_MODE=MOCK`); production payments are
  unreachable in this repository, which refuses to start with a live key
  (`docs/PAYMENTS.md`), and simulated refunds return no money.
- **A second administrator,** if you want imported events approved by someone
  other than the person who imported them (decision 7 below).

## Decisions taken for you (each can be reversed)

1. **An organiser invitation always starts a new organisation.** Adding an event
   poster to an existing organisation is done by a super administrator, from
   People and roles. Invitations into existing organisations were dropped,
   because they would let an administrator put anyone, a second account of
   their own included, into any organisation without the owner agreeing.
2. **Owners can move event posters only to lesser roles.** Promotions go
   through the Desi-Event team.
3. **Invited organisations start verified**, with the public description and
   website the administrator wrote on the invitation.
4. **Reviewers may not decide events of an organisation they belong to, or
   events they submitted themselves.** The same holds for pictures: an
   uploader never approves their own.
5. **Team invitations already waiting that offered event-posting roles were
   withdrawn** by the upgrade.
6. **Moderators can approve events too.** The existing Moderator staff role
   keeps its review permission, so "reviewed by an admin or super admin" in
   practice means "by the Desi-Event team". This could be limited to
   administrators and super administrators.
7. **Imported events belong to a member-less "Sulekha Events" organisation,
   and the importing administrator may approve them.** You could require a
   second administrator instead.
8. **Imported events are approved or rejected, not sent back for changes**,
   because nobody can edit them before they are published.
9. **Imported events show Sulekha's prices without creating ticket types**, and
   their pictures are approved together with the event on the import screen,
   after the administrator has seen them.
10. **Moving an imported event into an organisation does not ask that
    organisation first**, and switches the Sulekha ticket link off.
11. **New pictures on live events wait for approval.** They could appear
    immediately instead.
12. **Administrators may delete events with sales**, which refunds every order
    in full. This could be limited to super administrators.
13. **Restoring an on-sale event brings it back paused.**
14. **A deleted event's web address stays retired** if it was ever public, so
    an old link never shows a different event.
15. **Administrators edit an organisation's events only once published.**
    Before that, the event is the organiser's draft under review.
16. **A venue cannot be changed while a night uses a seating map.**
17. **Administrators' names are shown for the website link but not for edits.**
    For the link, the organiser sees which administrator turned it on or off;
    for an edit, the reason and what changed, and "a Desi-Event administrator".
    Either can be made to match the other.
18. **Visit sources:** a fifth source, "Desi-Event pages", is counted. Browsers
    asking not to be tracked count as page views. Clicks on cards on an
    organiser's own page are not counted.
19. **The new platform role is called `ADMIN`** ("Platform administrator"), as
    you named it. It is separate from an organisation's "Administrator" role.

---

## §Limitations

The recorded list, in the order `/limitations` shows it. **Name and status are
the page's, word for word**; the third column is the page's own sentence for the
person using the site. Where the page links words to another entry, the words
are the same here.

| Capability                                                       | Status                                   | What it means for somebody using the site                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Real payments, Stripe and Connect payouts                        | **EXTERNAL VERIFICATION PENDING**        | Payments on this site are simulated. No card is asked for, nothing is charged, no refund returns money and no organiser is paid out. The connection to a real payment provider has not been verified against that provider, so this build runs on the simulation alone.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Splitting payment for a group                                    | **NOT IMPLEMENTED**                      | Every order is paid for by one person. There is no way to split an order, or for each guest to pay their own share, and a group gets no discount of its own: a lower price comes only from a promo code the organiser has made. The buyer can put each guest’s name on their ticket, and while they hold between two and fifty tickets on an order that still admit, they can show one group pass at the door for all of them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Check-in without a connection                                    | **NOT IMPLEMENTED**                      | The door check-in asks this site about every ticket. A steward’s device without a connection cannot admit anybody, and nothing is stored on the device to decide entry later.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Ticket passes on real phones                                     | **EXTERNAL DEVICE VERIFICATION PENDING** | Neither a ticket’s pass nor the group pass has been tried with a real phone held up to a real camera. The pass and the door scanner have been tested in a simulated browser only. At the door, a steward can type the code printed on the ticket or on the group pass instead.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Door scanning in Safari and Firefox                              | **EXTERNAL DEVICE VERIFICATION PENDING** | Scanning with the camera has been checked in Chromium-based browsers only. Where the camera does not work, the door page takes the code typed in.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Virus scanning of uploaded pictures                              | **NOT IMPLEMENTED**                      | Pictures an organiser uploads are checked to be a real JPEG, PNG or WebP, rebuilt from their image data alone and stripped of camera, location and other hidden details before anyone sees them. They are not run through an antivirus engine; a moderator reviews each one before it appears on a public page.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Asking to become an organiser                                    | **NOT IMPLEMENTED**                      | There is no form on this site for asking to become an organiser. The Desi-Event team invites organisers it has agreed to work with, and each invitation carries a code that works once.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Reviewing changes to a published event                           | **NOT IMPLEMENTED**                      | On a published, on-sale, paused, sold-out or postponed event, the organiser — or the Desi-Event team, in an editing session opened with a reason — can change everything without another review, and the change is public when it saves. The date, time, time zone, place, joining link, age limit and entry, refund and conduct terms change only with a reason, and every ticket holder is shown the change on their order page; it is not emailed. Ticket types can be added, edited, re-priced (people who already bought keep what they paid), closed, hidden, or removed if unused. Nights can be added, moved, given another seating map while nothing at them is sold, removed if unused, or cancelled with their tickets refunded. The venue cannot be changed while a night uses a seating map. New pictures appear only after someone on the Desi-Event team other than the person who uploaded them approves each one; the old cover stays until then. (Pictures copied by an import are the exception: the administrator who reviews the import approves them with the event.) A finished or cancelled event keeps its words and pictures editable. The organisation’s venue records can be edited at any time, and every event there shows the new details without review. An event’s website address can be changed at any time; a new address is not linked until an administrator approves it. Promo codes are never reviewed. |
| Refunding part of an every-night ticket                          | **NOT IMPLEMENTED**                      | Cancelling one night refunds the tickets bought for that night. A ticket valid for every night is not refunded in part: its holder keeps it for the other nights and is shown a notice, and the organiser can refund those orders one at a time.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Refunding a large cancelled event in the background              | **NOT IMPLEMENTED**                      | Refunds caused by deleting an event or cancelling a night are sent while the page waits: up to 500 at a time with simulated payments and 25 at a time with a payment provider. Any left over are sent with “Finish refunds” on the event, or by the organisation’s finance team. An order whose payment is disputed is left to the finance team rather than refunded, so it is not paid back twice.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Erasing a deleted event                                          | **NOT IMPLEMENTED**                      | Deleting an event takes it off the site straight away, but its record, pictures, orders and history are kept so the Desi-Event team can restore it and so money stays accounted for. Nothing on this site erases a deleted event; removing somebody’s personal data goes through the privacy process. The reasons people type when deleting, restoring, cancelling a night or editing as the Desi-Event team are kept as written, and the privacy process does not rewrite them. A deleted event’s pictures stop being served at once, but a copy already in someone’s browser can stay there for up to a day.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Keeping imported events up to date                               | **NOT IMPLEMENTED**                      | Some events were copied from their listings on Sulekha.com on 29–30 September 2026 and are shown under “Sulekha Events”, each naming the organiser who presents it. They are not updated automatically: a change made on Sulekha afterwards shows here only when a Desi-Event administrator imports a newer listing. Tickets for them are sold on Sulekha, not here, and their prices are shown as Sulekha listed them on that date. Where Sulekha gave no end time, only the start is shown. Their pictures were copied when they were imported; an event whose pictures could not be copied shows a generated poster. Only events in Texas were copied.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Checking the organiser’s website itself                          | **NOT IMPLEMENTED**                      | An event’s “Visit the organiser’s website” link appears only after a Desi-Event administrator turns it on for the address the organiser gave. If the organiser changes the address, the link keeps going to the address the administrator approved until an administrator decides on the new one or turns the link off; only administrators turn it on or off. This site checks only that an address is a well-formed https address with a public site name and no sign-in, port or key in it; it does not open, scan or keep watching the site behind it. The switch covers that one link: links written into an event’s description, sponsors’ websites and social accounts are reviewed with the listing before it is published, and changes after publication are not reviewed again; none of them is switched or counted. An organisation’s own website on its organiser page is not switched or counted either. A visit through the link is counted without recording your address, browser or account, and a visit that could not be counted still reaches the site.                                                                                                                                                                                                                                                                                                                                                                     |
| Email                                                            | **EXTERNAL VERIFICATION PENDING**        | This site can email organiser-invitation, team-invitation and ticket-transfer codes, but only when its operator has configured an SMTP mail server; that has been tested only against a local test mail server. Without one, each code is shown once to whoever issues it, and passing it on is up to them; only an organiser-invitation code comes with a ready-to-send message. Receipts, address confirmation and password resets are not emailed in any configuration, so a forgotten password cannot be reset from here. When an event’s date, place or terms change, a night is cancelled, or the event is postponed, cancelled or deleted, a notice is recorded against each order and shown on its order page; it is not emailed. Orders and tickets are on your account pages instead.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Text messages                                                    | **NOT IMPLEMENTED**                      | This site sends no text messages.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Automatic deletion of personal records after a set time          | **DISABLED**                             | Nothing about a person, an order or a ticket is deleted automatically. The retention job counts what a policy would remove, and removes nothing. The one thing removed on a timer is the raw record of visits to event pages, which holds no address, browser description or account: it is deleted two days after the day it was made, once it has been added up into daily totals.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Counting the same visitor across days, and exact visitor numbers | **NOT IMPLEMENTED**                      | Visits to event pages are counted on this site without cookies and without keeping anybody’s address or browser description. A visitor is recognised for one day and one event only, by a code made from their connection and browser with a secret that is deleted from the live database when the day ends. Backups taken during the day keep that secret for as long as the backups are kept. So somebody who comes back another day, or looks at two events, is counted again. Robots, and organisers’ teams and Desi-Event staff while signed in, are not counted at all; people whose browser asks not to be tracked are counted as page views only, never as visitors. A browser that runs no JavaScript is not counted, and neither are some blocked visits. The record of each visit is deleted two days after the day it happened, by the job that adds visits up, once it has been added up. Only the daily totals are kept. Figures are brought up to date by that background job, so the newest visits appear later, and each analytics screen says when its figures run to. Days are UTC days. Somebody determined to can make visits look like more people than they are, so the figures are a guide, not an audit.                                                                                                                                                                                                              |

The page also says, under the recorded list:

- Organisers join by an invitation from the Desi-Event team, and an
  organisation started from one is verified from the start. An organisation
  made before invitations began can publish only after the platform has
  verified it. Every event is reviewed by the Desi-Event team before it can be
  published. What can change after publication without another review is
  listed above.
- A promo code takes its discount off the ticket prices, and the booking fee is
  then worked out on what is left.
- US sales tax is not calculated: checkout shows it as $0.00 for an event in the
  United States.
- There is no self-service copy of your data and no self-service account
  deletion. What is kept, and who sees it, is on your privacy page once you are
  signed in.
- Events, organisers and prices on this site are fictional, except events
  copied from Sulekha.com listings, which name the organiser who presents them
  and show Sulekha’s prices.

**Changed since the feature-completion report's table:**

| Was                                                           | Now                                                                                                                                                              |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Adding pictures to a published event — **NOT IMPLEMENTED**    | Left the list: a new picture appears once somebody other than its uploader approves it (ADR 0014)                                                                |
| Email — **NOT IMPLEMENTED**                                   | **EXTERNAL VERIFICATION PENDING**: codes can be emailed through an operator's SMTP server, tried only against a local test server (ADR 0011)                     |
| Automatic deletion after a set time — **DISABLED**            | Renamed "Automatic deletion of personal records after a set time", still **DISABLED**; it names the one deletion on a timer, of raw visit records (ADR 0013)     |
| —                                                             | Added: asking to become an organiser, reviewing changes to a published event, the organiser's website itself, visit counting across days (ADRs 0010, 0012, 0013) |
| —                                                             | Added: refunding part of an every-night ticket, refunding a large cancelled event in the background, erasing a deleted event (ADR 0014)                          |
| —                                                             | Added: keeping imported events up to date (ADR 0015)                                                                                                             |
| "Every event, organiser and price on this site is fictional." | Except events copied from Sulekha.com listings, which are real listings; the footer says the same                                                                |
| "An organisation you create for yourself starts unverified"   | Organisers join by invitation, and an invited organisation is verified from the start                                                                            |

---

## Trying it on your own machine

`pnpm db:seed` now also writes, so every new screen has something to show
(`docs/development.md`, "What else it seeds"):

- **A platform administrator,** `platform-admin@desi-event.example`, alongside
  the super administrator `admin@desi-event.example`. Both use the shared seed
  password, and the administrator sets up two-step sign-in at first sign-in.
- **One organiser invitation waiting,** to `new-organiser@desi-event.example`
  for "Kathiawar Folk Nights", issued by the platform administrator. Its code
  was thrown away when the seed ran, as a real code would be once shown; sign
  in as the platform administrator and choose "Issue a new code" on it at
  `/admin/organizer-invitations` to get a code you can use.
- **Fourteen days of demonstration visit figures** for two public events of
  Mirrorwork Events ("Navratri Night One: Garba Under the Lights" and "Live Garba
  Band Night with the Mirrorwork Ensemble"). Every screen that sums them says "Demonstration figures"; the
  roll-up job never writes figures marked that way.
- **One deleted event,** "Sharad Purnima Garba Showcase", taken down from on
  sale by the platform administrator before anybody bought a ticket, so the
  deleted-events filter and a restore have something to show. Seeding again
  leaves any deleted event exactly as it finds it, whether the seed deleted it
  or you did; if you restored this one, seeding again deletes it again.
- **One picture waiting for approval** on "Beginner Garba Workshop", uploaded by
  the organisation's owner, so `/moderation/pictures` has something in it.
- **No imported events.** Import them with `pnpm import:events` (README,
  "Importing the Sulekha events").

The seed now writes 26 users, 11 organisations, 24 events and 13 orders.

## Choices made while writing this up

Where the specification left room, these were the readings taken. Each is a
sentence or two to change.

- **The email entry's last sentence.** The specification's new sentence about
  change notices ("When an event’s date, place or terms change, a night is
  cancelled, or the event is postponed, cancelled or deleted, a notice is
  recorded against each order and shown on its order page; it is not emailed.")
  replaces the old notice sentence, and "Orders and tickets are on your account
  pages instead." is kept after it. The entry also says that only an
  organiser-invitation code comes with a ready-to-send message, because a
  team-invitation or ticket-transfer code does not.
- **The visit-counting entry names no schedule** for how often figures are
  added up, because the interval is a setting a deployment can change.
- **"Fictional" is no longer true of everything.** Imported events are real
  listings, so the footer and the limitations page now except events copied
  from Sulekha.com listings.
- **The retention entry** names the roll-up's deletion of raw visit records as
  the one deletion on a timer, and links to the visit-counting entry, so
  "nothing is deleted automatically" is not left standing where it is no longer
  quite true.

---

## Found and fixed after the first version of this report

After the first version, the browser journeys were run (`20e2915`) and seven
independent reviews went through the whole of this work: onboarding, the
website link, visit figures, privacy and security, full control with refunds,
imports, and the tests' reliability. They found 30 faults, and all are fixed
(`9caacba`); every fault in the code is fixed with a test that fails without the
fix. What matters to you:

- **Money: cancelling a night.** A night could not be cancelled at all if one
  of its orders had earlier been given a partial refund of a set amount; it now
  refunds what is left of those tickets, and the preview shows the same amount.
  Cancelling a night no longer withdraws the same order's free tickets for
  other nights, and a refund settling at the same moment can no longer leave
  one of the night's paid tickets withdrawn but unrefunded (every refund here is
  simulated).
- **Limits.** The limit of three emailed codes a day to one address, for team
  invitations and ticket transfers when email is switched on, could be passed
  by sending many at once; it now holds however many are sent together. The
  website link's per-minute limit now counts only the visits it recorded, so
  repeated clicks cannot use it up, and the pictures an organisation holds,
  deleted events' included, now stop at 2 GiB in all (see "Not built, and found
  while building").
- **Privacy.** Erasing a person through the privacy process now also removes
  their address and the private note from the organiser invitations sent to
  them. An erasure is held back while an invitation to that address is still
  waiting to be accepted, and an invitation whose address was erased cannot be
  reissued.
- **Import details.** An imported night's real end time, once an editor sets
  one, now appears on the event page, and the editing screens mark the
  estimate. Approving an event that a second administrator re-imported now
  records the right importer, a super administrator who only resubmitted an
  imported event can no longer approve it as its importer, `pnpm import:events`
  refuses a suspended account, and public price names leave out Sulekha's sales
  dates and urgency wording ("Early Bird (Ends on 10/9)" reads "Early Bird").
- **Visit figures.** With no start date chosen, the default on `/analytics`,
  the visit-to-order figures counted orders paid before visit counting began;
  they now start on the first counted day. Day labels on charts and tables carry
  the year when a period runs into a second year.
- **Reliability.** Text with a broken character (a lone UTF-16 surrogate), a
  revision number too large to store, or a date in the year 0 made some requests
  fail with a server error; they are now refused with a reason, and nothing is
  written. A deleted event's review page offered website-link controls that
  could never work; it now says the switch is kept as it was.
- **The tests themselves.** Several unit tests depended on the date and would
  have made every CI run fail from 10 October 2026, and the development server
  behind the browser suites sometimes started with pages missing; the tests now
  freeze the clock at a set moment, and a patch used only by that development
  server, with a check of its pages before any test, closes the second. Three
  dependency advisories (sharp, fastify and source-map-js) were closed by
  updates within the ranges their packages allow.

**What the browser journeys found** (fixed in `20e2915`, not among the 30).
Confirming the second-factor prompt on the invitation and move forms reloaded
the page instead of finishing the action, some pages scrolled sideways on a
320-pixel screen, the import plan could not be reached by keyboard, some links
were smaller than the 24-pixel target, the outcome of moving or restoring an
event vanished when the page refreshed, a gallery picture added to a posted
event said "Waiting for review" while the new cover beside it said "Waiting for
approval", and a dialog opened by a button pressed just as its page finished
loading could leave the keyboard focus behind on the page; each is fixed with a
test.

The commits after the review changed four more things:

- **A busy event answers "try again" instead of failing** (`8d37320`).
  Cancelling a night while a deletion of the same event was being saved failed
  with a server error after 13 seconds. Deleting, restoring, cancelling a night,
  sending refunds, opening or closing an editing session, the website switch,
  picture decisions and imports now wait a bounded time and, if it runs out,
  keep nothing of what they were saving at that moment and answer 503 asking
  you to try again in a moment (a pass of refunds keeps every refund it had
  already sent); in a batch only the item that ran out is refused, and a refund
  is left owed for the next pass.
- **Search speed** (`4a01f61`). Public search had slowed past its half-second
  budget as the test catalogue grew, because a word naming many organisers or
  venues stopped the database using its search index; such words now keep only
  the matches that add something, with the same results. Three runs then
  measured 365 to 408 ms at the 95th percentile, and browsing 245 ms against its
  400 ms budget.
- **Database indexes** (`8d37320`, migration
  `20261008090000_foreign_key_indexes`). Four links between tables had no index
  (order lines and hold lines to ticket types, orders and holds to nights), so
  deleting a ticket type or a night, or finding a night's orders to cancel it,
  read the whole table; they are now indexed.
- **A cancelled night's confirmation stays** (`a892956`). The full browser run
  on `8d37320` failed one journey: after a night was cancelled, the list of
  nights was read again, and because that night could no longer be cancelled
  its dialog disappeared, taking the "Night cancelled" confirmation and the
  keyboard focus with it, so whether anyone saw the outcome depended on which
  finished first. The confirmation now stays, with focus on it, until it is
  closed, and focus then moves to the night; the outcome is announced once;
  and from the moment the cancellation answers, the night offers nothing more
  to edit, prepare or cancel.

## Verification

The full local gate on `a892956`, run on 2026-10-08 on a clean tree; every
step exited 0.

| Check                                       | Result                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Stale-cache check                           | Pass                                                                                                                                                                                                                                                                                                                                                                         |
| `pnpm verify:tests:fresh`                   | 12,519 cases in 530 files across 16 packages, none failed or skipped: `apps/api` 3,413 in 152 files (its whole suite, on PostgreSQL), `apps/web` 3,972 in 239 files, `apps/worker` 362, `packages/db` 212, schemas 1,559, permissions 804, providers 510, config 398, auth 362, inventory 296, api-contract 221, ui 126, pricing 116, logger 78, notifications 57, ledger 33 |
| `pnpm contract:check`                       | Valid: 193 routes, 193 OpenAPI operations, 173 paths; `openapi.json` up to date                                                                                                                                                                                                                                                                                              |
| `pnpm manifest:emit`, `pnpm openapi:emit`   | The committed files did not change                                                                                                                                                                                                                                                                                                                                           |
| `pnpm test:coverage`, every package at once | All 18 tasks pass and every threshold holds; `apps/api` 92.81 % statements, 83.78 % branches, 97.43 % functions, 95.11 % lines against floors of 80, 75, 80 and 80                                                                                                                                                                                                           |
| `pnpm db:verify:fresh`, `db:verify:upgrade` | 211 of 211 checks, and 72 of 72                                                                                                                                                                                                                                                                                                                                              |
| `pnpm bundle:scan`                          | Pass: 733 browser-deliverable files, nothing server-only                                                                                                                                                                                                                                                                                                                     |
| Dependency audit                            | No known vulnerabilities                                                                                                                                                                                                                                                                                                                                                     |
| Production payment kill switch              | Its test passes                                                                                                                                                                                                                                                                                                                                                              |
| Reliability                                 | The smoke run passes, and the suite passes 11 of 11 scenarios                                                                                                                                                                                                                                                                                                                |
| `pnpm skips:check`                          | Pass: no skipped tests                                                                                                                                                                                                                                                                                                                                                       |
| `pnpm ci:check`                             | Pass: 39 browser specs, each collected by exactly one of 7 CI browser jobs; the 6 configs that start `next dev` do so through `apps/web/e2e/support/next-dev.mjs`, with their routes proved before any test                                                                                                                                                                  |

The browser journeys for this work have been run. New journeys cover
invitation-only onboarding, the website switch and its counted link,
organisers' and administrators' visit figures, deleting, restoring and
cancelling nights of posted events, and the Sulekha import; the accessibility
sweep covers every new screen at four widths and at 200% zoom. What they found
is under "Found and fixed after the first version of this report".

The browser suites on `a892956`, each on fresh databases as CI runs them, with
nothing unexpected, flaky or skipped in any:

| Suite                                | Passed     |
| ------------------------------------ | ---------- |
| default                              | 119 of 119 |
| production                           | 19 of 19   |
| organizer                            | 13 of 13   |
| events                               | 30 of 30   |
| refusals                             | 4 of 4     |
| sweep (accessibility and responsive) | 159 of 159 |
| detail                               | 221 of 221 |

On `8d37320` the same suites passed except detail, where the night
cancellation journey failed and the six journeys after it in the same file did
not run; that failure is the one `a892956` fixes. GitHub's CI had not run on
`a892956` when this was written.

The development seed was run twice on an empty database at the integration
stage: the same row counts both times; the deleted event's row, its ticket type
and its history entry byte-for-byte unchanged by the second run; and after a
restore, a third run deleted it again. The seed has not changed since.

The integration stage's runs (2026-10-06 and 2026-10-07) found two faults, each
fixed then with a test that failed before the fix:

- **The worker's outbox tests took other suites' messages.** Every package's
  tests share one database, at once in `verify:tests:fresh` and
  `test:coverage`, and one after the other in CI. The outbox tests claimed the
  oldest due message in the whole table, so whenever the API suite had left
  due notices behind (it leaves hundreds) or was writing them at the same time,
  eight of them failed, and their clean-up sent the API suite's messages while
  it was still reading them. They now claim only the messages they wrote; with
  a stand-in for the API writing a due message every 50 ms, all 23 pass and
  none of the 762 messages it wrote is touched.
- **The fallback catalogue counted days as 24 hours.** Started within an hour
  of midnight in New York with a change of the clocks inside the nine-night
  pass, it put two nights on one date (or every night a day late), and two
  sample-data tests failed at that hour. It now adds calendar days.

In the first of that stage's two coverage runs, two `apps/web` cases went over
Vitest's default five-second limit while all eighteen coverage tasks ran at
once on four cores. The final review found why: one drew two lists of every
time zone and typed a reason a key at a time, and the other drew the full
twelve-card event listing twice to check one sentence. Both now draw less
(`9caacba`): the first uses a short zone list for that case and pastes the
reason, taking 395–427 ms instead of 1352–1710 ms; the events page's test draws
one card, 247–258 ms instead of 1189–1517 ms, and the same test on the home page
takes 381–415 ms instead of 1020–1209 ms. No time limit was raised: the web
suite keeps Vitest's five-second default.

After the review, running the gate on a busy machine showed two real-PostgreSQL
suites depending on other runs or on load: one collided with rows an earlier
run had left in a shared database, and one fixture's transaction ran past
Prisma's five-second limit while orders queued on the same tiers. Both are fixed
(`ec0c909`). The four missing indexes above were found the same way, when
deletes in a database test read whole tables and stalled the suites running
beside it (`8d37320`).
