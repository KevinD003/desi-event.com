# Phase 4 feature completion report

- **Date:** 2026-09-29
- **Branch:** `claude/phase4-frontend-ui-ux-completion`
- **Base:** `a6bd5e4` (CI green). The work is in four commits on top of it —
  `5f01676` (database foundation), `3c6e4f9` (team access and event
  pictures), `140b79a` (event authoring, the door's group pass, super-admin
  door authority and transfer codes), `0dfb1bd` (seat picker, promo codes,
  guests' names, nights and private joining links) — plus the integration
  stage recorded here.
- **Payment mode:** `PAYMENT_MODE=MOCK` throughout. No real payment, card
  capture, Connect onboarding or payout happens anywhere in this work.
- **Binding decisions:** ADR 0006 to ADR 0009 (`docs/adr/`), indexed in
  [`DECISIONS.md`](DECISIONS.md).

This report answers the four questions the owner asked, lists what each area
delivered with its route ids and pages, the refusals and safeguards, the
migrations and the tests, and then says what is still limited. The limitations
page (`/limitations`) mirrors the §Limitations table below word for word;
`apps/web/src/lib/limitations.js` cites this section.

Historical reports are not rewritten. Where this report and
`PHASE4_IMPLEMENTATION_REPORT.md` §P4-17 or §P4-20 disagree, this report is
the later one.

---

## The four questions, answered again

### 1. Can an organiser post events?

**Yes, starting from any account.**

- **Anybody signed in can create an organisation** at
  `/account/organizations/new` (`organizations.create`,
  `POST /v1/organizations`) and becomes its OWNER. A new organisation starts
  **unverified**: once the owner has set up two-step sign-in it can draft
  events straight away, and it can publish them only after the platform has
  verified it. The owner asks for verification from `/organizer/organization`
  (`organizers.submitVerification`); a moderator decides from the queue at
  `/moderation/organizations` (`organizers.verificationQueue`,
  `organizers.verificationReview`, and the existing
  `organizers.moderateVerification` under a `SECURITY_ROLE` step-up).
- **An event goes draft → review → approved → published → on sale**, through
  the existing lifecycle and moderation. A rejected event can now be reworked
  as a draft (`events.rework`), and a postponed event brought back with new
  dates in one step (`events.reschedule`).
- **A team can be built without email.** An OWNER, ADMIN or MANAGER invites an
  address to a role at `/organizer/team` (`teams.invite`); the invitation code is shown
  to them once and they hand it over; the invitee joins at
  `/account/invitations` (`teams.accept`). A lost code is replaced
  (`teams.reissueInvitation`), and ownership can be handed on
  (`teams.transferOwnership`).
- **A super administrator can put an existing account into any organisation**,
  OWNER included, for an organisation whose only owner has left, and can
  change platform roles, at `/admin/users` (`platform.*`).

### 2. UI, animation and posters — including cover pictures?

**Organisers now upload their own cover and gallery; the generated poster is
the fallback.**

- In the editor's **Media** step an organiser uploads a cover and up to eight
  gallery pictures (JPEG, PNG or WebP, up to 10 MiB), describes each one (the
  description is required: it is the picture's alternative text), reorders the
  gallery and removes pictures (`events.addMedia`, `events.media`,
  `events.updateMedia`, `events.reorderMedia`, `events.removeMedia`).
- Every picture is **rebuilt from an allow-list** of its format's structures,
  so camera and location details, comments, embedded thumbnails and anything
  hidden after the image are gone before anybody sees it, and a **moderator
  approves it with the event** before it is public. A moderator can take one
  picture down at any time (`moderation.decideMedia`).
- An approved cover appears on the **event page hero, listing cards, the
  social preview images** (`opengraph-image`, `twitter-image`) and the page's
  structured data; the gallery appears on the event page. Pictures are served
  by `media.get` and resized by the web image optimiser.
- **Without a cover, the generated poster** (`components/poster.jsx`) is drawn
  everywhere, as before. The site's look and motion are the redesign's and are
  unchanged by this work; motion is removed under `prefers-reduced-motion`
  without hiding content ([`UX.md`](UX.md), "Reduced motion").

### 3. Can an organiser put in every detail they need?

**Yes, and change it after publishing.**

- **Content:** a formatted description with a preview; a line-up with roles and
  short bios (up to 64 people); a running order with times (up to 40 items);
  questions and answers (up to 30); dress code; getting there; a public contact
  email and phone; links to a website, Instagram, Facebook, YouTube, X and
  WhatsApp (https only, each checked against its own network's domains);
  sponsors (up to 30). These are steps 7 and 8 of the nine-step editor, and the
  public event page shows each section when it has content.
- **Dates and places:** a time-zone picker with the common zones first and
  every other zone after; several **nights** (sessions), each with its own
  label, times, sales window and capacity, shown on the event page and on every
  ticket.
- **Tickets:** prices typed in dollars; per-tier sales windows; 1 to 50 per
  order; **hidden** tiers the public never sees and **complimentary** tiers
  that are free and hidden; **reserved seating** by price zone per night, sold
  through a seat picker; **promo codes** — a percentage or an amount off, for
  every event of the organisation or one of them, capped in uses and limited to
  a window (`/organizer/promo-codes`, `promoCodes.*`).
- **Guests' names:** a buyer can name each guest on their ticket at checkout.
- **After publishing:** content keeps saving as the organiser types. A change to
  the date, time zone, place, age limit, online status or terms asks for a
  reason and a confirmation, and records a notice for every current order.
  Tiers and nights can still be added and edited, and a change that would take
  something from a buyer is refused with the reason.

### 4. Individual and group QR codes, and super-admin scanning and verification

**All three exist.**

- **Individual pass:** each ticket's own QR, drawn on request on the ticket
  page for its holder, as before (`tickets.pass`).
- **Group pass:** a buyer holding two to fifty tickets on a paid order can show
  **one QR, or one printed `DEG-` code, for everybody on the order** that they
  still hold (`orders.groupPass`, on `/account/orders/[reference]`). At the
  door the steward sees every person in the group, ticks who is there, and
  admits them in one press, each exactly once
  (`tickets.previewGroupAdmission`, `tickets.checkInGroup`). The rest can come
  in later with the same pass. The buyer can replace a pass that was shared by
  mistake (`orders.rotateGroupPass`).
- **Super-admin scanning:** a platform `SUPER_ADMIN` sees **Check-in** in the
  navigation and can look up and admit tickets at **any** event
  (`/organizer/check-in`, `tickets.admissionEvents`,
  `tickets.previewAdmission`, `tickets.checkIn` and the group routes). Every
  such lookup and admission is written to that event's own audit record, and
  the other platform roles are still refused (ADR 0007).
- **Verification:** at the door, "verify" is the preview — a lookup that shows
  the event, tier, seat, night and name and whether the ticket admits, and
  writes nothing. For organisations, verification is the moderators' queue
  described under question 1; a super administrator holds
  `moderation:review`, so it can decide there too.

---

## What was delivered, by area

Route ids are the contract's (`packages/api-contract/src/routes.js`). The
contract grew from 134 to **164 operations across 22 tags** (146 paths);
`docs/api.md` describes each new route.

### T — Team access, organisations and platform roles

| Capability                                 | Route ids                                                                                                  | Pages                                                         |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Create an organisation, as its OWNER       | `organizations.create`                                                                                     | `/account/organizations/new`                                  |
| Read the organisation's profile            | `organizations.get`                                                                                        | `/organizer/organization`                                     |
| Invite to a role, code shown once          | `teams.invite` (changed), `teams.reissueInvitation`                                                        | `/organizer/team`                                             |
| Join with a code                           | `teams.accept` (changed: `joined`, `session`)                                                              | `/account/invitations`                                        |
| Hand ownership on                          | `teams.transferOwnership`                                                                                  | `/organizer/team`                                             |
| Verification queue and review              | `organizers.verificationQueue`, `organizers.verificationReview`                                            | `/moderation/organizations`, `/moderation/organizations/[id]` |
| Platform accounts, roles and direct grants | `platform.searchUsers`, `platform.setUserRole`, `platform.searchOrganizations`, `platform.grantMembership` | `/admin/users`                                                |

### M — Event pictures

| Capability                            | Route ids                                                                            | Pages                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------- |
| Upload, describe, reorder and remove  | `events.addMedia`, `events.updateMedia`, `events.reorderMedia`, `events.removeMedia` | The editor's Media step, `/organizer/events/[id]` |
| The organiser's and moderator's view  | `events.media`                                                                       | Media step; `/moderation/events/[id]`             |
| Serving the bytes                     | `media.get`                                                                          | Event page, cards, social images                  |
| Take one picture down, or put it back | `moderation.decideMedia`; `moderation.decide` approves waiting pictures              | `/moderation/events/[id]`                         |

### A — Event authoring

| Capability                                              | Route ids                                                                                                    | Pages                                  |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| Content fields and their public sections                | `events.update`, `events.get` (both changed)                                                                 | Editor steps 7 and 8; `/events/[slug]` |
| Editing a live event, with material-change confirmation | `events.update` (`confirmMaterialChange`, `changeReason`)                                                    | Editor, "Change date, place or terms…" |
| Tiers: hidden, complimentary, reserved, limits, windows | `events.ticketTypes`, `events.addTicketType`, `events.updateTicketType`, `events.removeTicketType` (changed) | Editor step 4                          |
| Nights                                                  | `events.addSession`, `events.updateSession`, `events.removeSession` (changed)                                | Editor step 3                          |
| Rework a rejected event; reschedule a postponed one     | `events.rework`, `events.reschedule`                                                                         | Editor, Review step                    |

### D — Admission and transfers

| Capability                                        | Route ids                                                                          | Pages                                                       |
| ------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Group pass                                        | `orders.groupPass`, `orders.rotateGroupPass`                                       | `/account/orders/[reference]`; links from `/tickets`        |
| Group admission                                   | `tickets.previewGroupAdmission`, `tickets.checkInGroup`                            | `/organizer/check-in`                                       |
| Super-admin door authority                        | `tickets.admissionEvents`, `tickets.previewAdmission`, `tickets.checkIn` (changed) | `/organizer/check-in`, with organisation and search filters |
| Ticket offer with a show-once code                | `tickets.startTransfer` (changed)                                                  | `/tickets/[id]`, `/tickets/accept`, `/account/transfers`    |
| Reserved-seat tickets can be handed on (ADR 0006) | `tickets.startTransfer`, `tickets.acceptTransfer` (changed)                        | `/tickets/[id]`                                             |

### C — Checkout: nights, seats, promo codes and guests' names

| Capability                                           | Route ids                                                                                            | Pages                                        |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Seat picker and seated checkout                      | `sessions.seats`, `sessions.hold` (both changed)                                                     | `/events/[slug]/seats/[sessionId]`           |
| One price for the quote and the charge               | `orders.quote`; `orders.create` (`expectedTotalCents`, 409 `PRICE_CHANGED`)                          | Checkout, seated checkout                    |
| Promo codes                                          | `promoCodes.list`, `promoCodes.create`, `promoCodes.pause`, `promoCodes.resume`, `promoCodes.remove` | `/organizer/promo-codes`; checkout promo box |
| Guests' names on tickets                             | `orders.create` (`attendees`), `sessions.hold` (seat names)                                          | Checkout                                     |
| Nights on sale separately; hidden tiers not bookable | `holds.create`, `orders.create` (changed)                                                            | `/events/[slug]`                             |
| The joining link for holders only                    | `events.get`, `tickets.get`, `orders.get` (changed)                                                  | Ticket and order pages                       |
| Seats freed when a hold is released or lapses        | `holds.release` (changed); the worker's expire-holds job                                             | —                                            |

### H — Honesty, guards and scaffolding

- **The limitations page** was rewritten to match the build (§Limitations
  below); the footer, the home page and the account pages were brought into
  line.
- **Every browser spec is collected by exactly one CI job**, checked by
  `pnpm ci:check` through `scripts/lib/spec-collection.mjs`; it also refuses a
  skipped, `fixme`, `fail` or `only` test anywhere under `apps/web/e2e`, and a
  CI-run config that narrows what it collects.
- **End-to-end scaffolding** for the new features: `seed-feature-world.mjs`
  (a verified organisation `gamma-<tag>` with a general-admission event over two
  nights, a seated event, promo codes, a group order and a pending
  organisation), three more saved sessions in the detail global setup, and the
  shared `step-up.mjs` helpers.
- **Secret guards** (`apps/api/tests/security-regression.test.js`,
  "the surfaces added for feature completion"): every response in the OpenAPI
  document is walked for secret-bearing fields, each allowed only on the routes
  that must return it, and an allowance no route uses any more fails too; an
  invitation code may sit only at `data.delivery.invitationCode`.
  `apps/api/tests/show-once-logging.test.js` issues, reissues, offers, declines,
  accepts and withdraws codes, and sends malformed bodies, and finds none of
  them in any log line, audit row or outbox row. `expectNoSecret`
  (`apps/api/tests/helpers/payloads.js`) never prints the secret it looks for.
- **Browser bundle guards:** `apps/web/src/lib/browser-bundle.js` forbids the
  permissions barrel and its capability tables in client code, and
  `scripts/scan-browser-bundle.mjs` gains a "feature completion (server-only)"
  group — show-once helpers, the group-pass and door purpose strings and
  derivers, the platform door roles, the picture rebuilders and storage, and
  the checkout pricing, session locks, seat binder and quote budget — plus the
  client paths each new screen must reach.
- **Control characters in searches:** every free-text search or filter field
  that reaches PostgreSQL refuses control characters in its schema
  (`withoutControlCharacters`, `packages/schemas/src/primitives.js`), and the
  error handler answers PostgreSQL's invalid-byte error (22021) with a 400
  instead of a 500.

---

## Refusals and safeguards

Each is enforced on the server and covered by a test named in the ADR or doc
it links.

**Show-once codes** (ADR 0008, [`SECURITY.md`](SECURITY.md) "Show-once codes")

- The code is in the one 201 that minted it, `no-store, private`; only its
  SHA-256 is stored; it is never logged, audited, queued or put in a URL.
- `DELIVERY_MODE=EMAIL` with no provider refuses to boot.
- The recipient must be signed in at the invited address; codes are
  single-use, expire (14 days, 72 hours) and can be withdrawn; one live
  invitation per address, enforced by the database.

**Roles and organisations** ([`SECURITY.md`](SECURITY.md), "Platform roles")

- A new organisation cannot publish or be paid until verified; its request
  cannot set verification, suspension, payout currency, contact address or
  owner. Five attempts an hour and three organisations a day per account.
- Platform role changes and direct grants need `platform:admin` and a
  `SECURITY_ROLE` step-up, never touch the caller's own account, refuse to
  leave no super administrator (`LAST_SUPER_ADMIN`) or an organisation with no
  owner, and end the target's sessions in the same transaction.
- Owner changes lock every owner row first, so two demotions cannot leave an
  organisation with none.
- Gaining a role ends the caller's other sessions (`role_changed`); a
  privileged role must set up a second factor before it can work.

**The door** (ADR 0007, [`CHECK_IN.md`](CHECK_IN.md))

- Only `SUPER_ADMIN` among platform roles admits, on its own recorded
  authority, re-read inside the admitting transaction; the others get a 403 and
  an audit row. A module-load assertion keeps it that way.
- A group admission admits each named ticket once; any ticket that changed
  since the lookup admits nobody (`GROUP_CHANGED`); a trigger refuses a ticket
  from another order or no longer held by the buyer.
- The group pass is the buyer's alone; every other caller gets the same 404.

**Reserved seats** (ADR 0006)

- One live ticket per seat, by a partial unique index; acceptance and refund
  lock the order line in turn, so a refund cannot leave a live successor.

**Pictures** (ADR 0009, [`MEDIA.md`](MEDIA.md))

- The bytes decide the format; SVG, HTML and everything else are 415.
  Authorisation, status, gallery room and quota are checked before a byte of
  the body is read; the body is capped at 10 MiB while it is read.
- Pictures are rebuilt from an allow-list and moderated; a private picture is
  a 404 to anybody who may not see it; storage keys never leave the API.

**Authoring** ([`UX.md`](UX.md), "The event editor")

- A material change to a live event needs a reason and a confirmation, and
  records a notice per order.
- A sold tier keeps its price (`TIER_SOLD`); a held one too (`TIER_IN_USE`);
  quantity cannot go below sold and held; the last night of a live event
  cannot be removed (`LAST_SESSION`); tier names are unique per event.
- Sales refuse to open for a reserved tier with no seats bound to it.

**Checkout** ([`PAYMENTS.md`](PAYMENTS.md))

- The quote and the charge are one function; a different total is 409
  `PRICE_CHANGED` before anything is written.
- A promo code with one use left gives one discount however many race for it;
  making or resuming a code needs a `PROMO_ACTION` step-up; audit rows never
  hold a code's text.
- A seat hold is all or nothing, keeps companions together, and respects each
  tier's minimum and maximum; a hidden tier is 404 to anybody outside the team;
  the joining link reaches holders only.

**Honesty** — the limitations page, footer and home page match the build, and
no user-facing copy says "soon", "yet" or "planned".

---

## Migrations

Six, in this order, each listed in `PHASE3_MIGRATIONS` in
`packages/db/scripts/verify-populated-upgrade.mjs` so the populated-upgrade
verifier applies them over pre-existing rows.

| #   | Directory                                                  | What it does                                                                                                                                                                                                                                                                                                                                                                    |
| --- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `20260928090000_event_authoring_content_and_tier_rules`    | `TicketTypeVisibility` and `TicketType.visibility` (complimentary tiers backfilled hidden); per-order bounds clamped to 1–50 and checked; complimentary must be free and hidden; tier description cap by trigger; `TicketType_reserved_session_zone_key`; triggers keeping a reserved tier's zone on its night's map, from both sides; nine `Event` content columns with CHECKs |
| 2   | `20260928100000_live_seat_ticket_index`                    | `Ticket_eventSeatId_live_key` replaces the full `Ticket_eventSeatId_key` (ADR 0006)                                                                                                                                                                                                                                                                                             |
| 3   | `20260928110000_group_pass`                                | `GroupPass`, `CheckIn.groupPassId`, the digest CHECKs and `desi_check_in_group_pass_matches`                                                                                                                                                                                                                                                                                    |
| 4   | `20260928120000_team_delivery_and_organisation_provenance` | `InvitationDelivery` and `Invitation.deliveryMode`; `Organization.createdById`; older duplicate pending invitations revoked; `Invitation_one_pending_per_address`                                                                                                                                                                                                               |
| 5   | `20260928130000_event_media`                               | `MediaKind`; new `MediaAsset` columns; `MediaBlob`; one cover per event; the gallery cap trigger (eight, locking the event `FOR NO KEY UPDATE`); `Event.coverImageUrl` dropped                                                                                                                                                                                                  |
| 6   | `20260929090000_checkout_promos_attendees_nights`          | `EventSession.label`; `OrderItem.attendeeNames` and `HoldItem.attendeeName`; `PromoCode` CHECKs after normalising backfills                                                                                                                                                                                                                                                     |

Details: [`DATA_MODEL.md`](DATA_MODEL.md).

---

## Tests

Counted by `pnpm verify:tests:fresh` on the working tree at the end of the
integration stage (2026-09-29), with every report proved fresh, the API, worker
and database suites against a freshly migrated private PostgreSQL database, and
`REQUIRE_DATABASE=1`. Nothing failed, was skipped or was left as a todo.

| Suite                                                    | Files | Cases | Result     |
| -------------------------------------------------------- | ----- | ----- | ---------- |
| `apps/api` (real PostgreSQL, `REQUIRE_DATABASE=1`)       | 110   | 2,223 | all passed |
| `apps/web`                                               | 174   | 2,632 | all passed |
| `apps/worker` (real PostgreSQL and Redis)                | 21    | 328   | all passed |
| `packages/db` (real PostgreSQL)                          | 3     | 133   | all passed |
| `packages/schemas`                                       | 23    | 1,121 | all passed |
| `packages/permissions`                                   | 4     | 618   | all passed |
| `packages/providers`                                     | 12    | 494   | all passed |
| `packages/config` (language policy, docs, CI invariants) | 8     | 373   | all passed |
| `packages/auth`                                          | 7     | 359   | all passed |
| `packages/inventory`                                     | 9     | 296   | all passed |
| `packages/api-contract`                                  | 9     | 201   | all passed |
| `packages/ui`                                            | 14    | 126   | all passed |
| `packages/pricing`                                       | 5     | 116   | all passed |
| `packages/logger`                                        | 4     | 75    | all passed |
| `packages/notifications`                                 | 2     | 56    | all passed |
| `packages/ledger`                                        | 1     | 33    | all passed |
| **Total**                                                | 406   | 9,184 | all passed |

An earlier full API run in this stage failed one case, "a refund racing a
ticket transfer"; its cause is closed (see "Closed in the integration stage"
under "Still limited"), and the figures above are from after that fix.

**Real-PostgreSQL suites added by this work** (each also runs in
`pnpm db:verify:fresh`): `team-invitation-integration`,
`platform-roles-integration`, `organization-create-integration`,
`event-media-integration`, `event-authoring-live-integration`,
`group-admission-integration`, `seat-transfer-integration` (renamed from
`seat-transfer-block-integration`, every case restated),
`promo-redemption-integration` and `seat-purchase-integration`.

**Browser suites:** the new end-to-end journeys belong to the end-to-end stage
and were not run in this stage. No browser result is claimed here.

---

## §Limitations

The recorded list, in the order `/limitations` shows it. **Name and status are
the page's, word for word**; the third column is the page's own sentence for the
person using the site.

| Capability                                | Status                                   | What it means for somebody using the site                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Real payments, Stripe and Connect payouts | **EXTERNAL VERIFICATION PENDING**        | Payments on this site are simulated. No card is asked for, nothing is charged, no refund returns money and no organiser is paid out. The connection to a real payment provider has not been verified against that provider, so this build runs on the simulation alone.                                                                                                                                                                                                    |
| Splitting payment for a group             | **NOT IMPLEMENTED**                      | Every order is paid for by one person. There is no way to split an order, or for each guest to pay their own share, and a group gets no discount of its own: a lower price comes only from a promo code the organiser has made. The buyer can put each guest’s name on their ticket, and while they hold between two and fifty tickets on an order that still admit, they can show one group pass at the door for all of them.                                             |
| Check-in without a connection             | **NOT IMPLEMENTED**                      | The door check-in asks this site about every ticket. A steward’s device without a connection cannot admit anybody, and nothing is stored on the device to decide entry later.                                                                                                                                                                                                                                                                                              |
| Ticket passes on real phones              | **EXTERNAL DEVICE VERIFICATION PENDING** | Neither a ticket’s pass nor the group pass has been tried with a real phone held up to a real camera. The pass and the door scanner have been tested in a simulated browser only. At the door, a steward can type the code printed on the ticket or on the group pass instead.                                                                                                                                                                                             |
| Door scanning in Safari and Firefox       | **EXTERNAL DEVICE VERIFICATION PENDING** | Scanning with the camera has been checked in Chromium-based browsers only. Where the camera does not work, the door page takes the code typed in.                                                                                                                                                                                                                                                                                                                          |
| Virus scanning of uploaded pictures       | **NOT IMPLEMENTED**                      | Pictures an organiser uploads are checked to be a real JPEG, PNG or WebP, rebuilt from their image data alone and stripped of camera, location and other hidden details before anyone sees them. They are not run through an antivirus engine; a moderator reviews each one before it appears on a public page.                                                                                                                                                            |
| Adding pictures to a published event      | **NOT IMPLEMENTED**                      | Once an event is published its pictures can be described again, reordered or removed, but a new picture cannot be added or swapped in, because every new picture is reviewed with the event.                                                                                                                                                                                                                                                                               |
| Email                                     | **NOT IMPLEMENTED**                      | This site sends no email: no receipts, no address confirmation and no password resets. A forgotten password cannot be reset from here. When you invite somebody to your team or offer somebody a ticket, you are shown its invitation code once, and passing it on is up to you. When an event’s date, place or terms change, or it is postponed or cancelled, a notice is recorded against each order and not sent. Orders and tickets are on your account pages instead. |
| Text messages                             | **NOT IMPLEMENTED**                      | This site sends no text messages.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Automatic deletion after a set time       | **DISABLED**                             | Nothing is deleted automatically. The retention job counts what a policy would remove, and removes nothing.                                                                                                                                                                                                                                                                                                                                                                |

The page also says, under the recorded list:

- An organisation you create for yourself starts unverified. Once you have set
  up two-step sign-in it can draft events, and it can publish them only after
  the platform has verified it.
- A promo code takes its discount off the ticket prices, and the booking fee is
  then worked out on what is left.
- US sales tax is not calculated: checkout shows it as $0.00 for an event in the
  United States.
- There is no self-service copy of your data and no self-service account
  deletion.
- Every event, organiser and price on this site is fictional.

**Left the list in this work, with the change that built each:**

| Was                                                                                      | Now                                                                                                   |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Reserved-seat transfer — **BLOCKED — UNIQUE-SEAT TRANSFER DEFECT**                       | A reserved seat goes with its ticket (ADR 0006, `seat-transfer-integration`)                          |
| Group booking — **NOT IMPLEMENTED**                                                      | Renamed "Splitting payment for a group": guests' names and a group pass exist; split payment does not |
| Email: "no team invitations, and no invitation codes for a ticket that has been offered" | Codes are shown once to whoever issues them (ADR 0008); the site still sends no email                 |
| "There is no seat picker for buyers"                                                     | `/events/[slug]/seats/[sessionId]`                                                                    |
| "There is no way to create an organisation for yourself"                                 | `/account/organizations/new`, with verification before publishing                                     |

### Screens now built

Superseding the items of `PHASE4_IMPLEMENTATION_REPORT.md` §P4-20 that this
work built: the seat picker; inviting a team member; organisation
self-service creation; reserved-seat transfer; and `/tickets/accept`, which is
now useful because the person who made the offer is shown the code. Still not
built, as §P4-20 says: password reset and address confirmation, self-service
data export and account deletion, an offline door, a split-payment flow and an
SMS channel.

---

## Still limited

Stated plainly, so nobody reads a working screen as more than it is:

- **Payments are simulated.** `PAYMENT_MODE=MOCK`: no card is asked for,
  nothing is charged, no refund returns money, no organiser is paid. The
  connection to a real provider is **EXTERNAL VERIFICATION PENDING**.
- **No email provider.** Team invitation and ticket offer codes are handed over
  by the person who made them, shown to them once. Notices of a changed,
  postponed or cancelled event are **recorded against each order and not
  sent**; the organiser is told to tell ticket holders themselves. There is no
  password reset and no address confirmation — so, as ADR 0008 records,
  somebody who obtains a code and registers the invited address first can use
  it.
- **No antivirus scanning of pictures.** They are rebuilt from an allow-list
  and reviewed by a moderator instead. No pixel is re-encoded, and a taken-down
  picture can stay in caches for up to a day.
- **A published event takes no new picture**; its pictures can be described
  again, reordered or removed.
- **No split payment** for a group, and no group discount beyond a promo code.
- **Check-in needs a connection.** No pass, a ticket's own or a group pass, has
  been tried with a real phone at a real door (**EXTERNAL DEVICE VERIFICATION
  PENDING**). A ticket's own pass and the door scanner have been tested in a
  simulated Chromium browser; no browser suite exercised the group pass in this
  stage (the new browser journeys belong to the end-to-end stage).
- **No text messages**; **automatic deletion is DISABLED** (the retention job
  counts and removes nothing).
- **US sales tax is not calculated.**

Recorded and not changed here:

- A refund settling after every ticket on an order has been admitted — by a
  group pass or one at a time — returns the money and revokes no ticket
  (`ticketsRevoked` 0), because an admitted ticket is terminal
  ([`CHECK_IN.md`](CHECK_IN.md), "`CHECKED_IN` is terminal").
- A refund chooses which of a line's tickets to refund by creation order and
  does not read `RefundItem.ticketId` (ADR 0005, Consequences).
- `moderation.decide` takes the reviewed event `revision` as optional: a client
  that leaves it out approves whatever is waiting ([`MEDIA.md`](MEDIA.md)). The
  web review page always sends it.
- The checkout quote tells a signed-in buyer that a promo code exists but has
  ended, paused or been used up; guessing is limited to 30 quotes a minute per
  account ([`SECURITY.md`](SECURITY.md), "Promo codes").

Closed in the integration stage:

- **A refund racing the start of a ticket offer no longer leaves that ticket
  live.** Starting an offer takes no order-line lock, and the refund's revoking
  update was conditional on the exact status it had read, so a ticket that
  became `TRANSFER_PENDING` between the read and the write was skipped and the
  money went back with the ticket still admitting. The real-PostgreSQL case "a
  refund racing a ticket transfer" (`refund-concurrency.test.js`) reached that
  window by chance and failed once in one full API run. The update is now
  conditional on the ticket still being refundable (`VALID` or
  `TRANSFER_PENDING`), so either order of arrival ends with the ticket
  refunded, and a new case holds the offer's transaction open so the window is
  reached every time (ADR 0006, Consequences).
- **The reliability step's "no overselling" invariant judged a seated tier by
  its quantity column.** Authoring creates a reserved tier with a quantity of
  0, because its stock is its seats; the seat-purchase suite's correct seated
  sales, left in the test database as every real-PostgreSQL suite leaves its
  rows, then read as "1 sold against 0 available", and the database-wide
  check-in scenario of `pnpm run load` failed. `scripts/load/invariants.js` now
  measures a reserved tier against the seats it prices or has sold, as the
  listing and analytics already do; case 15 of `settlement-invariants.test.js`
  shows a sale within the seats passing and a sale past them still refused.

---

## Verification

**To be filled in by the integrator.** Nothing below is a result; each line is
a place for one.

- Local gate (`pnpm verify` and its steps): _(integrator)_
- `pnpm db:verify:fresh`: _(integrator)_
- `pnpm db:verify:upgrade`: _(integrator)_
- Browser suites, one line per CI leg: _(integrator)_
- Commit SHA and exact-SHA CI run: _(integrator)_
