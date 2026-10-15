# Decisions

The authoritative index of architectural decisions. An ADR in `docs/adr/` is the
record; this page says which ones exist, what each settled, and where the
decisions that never warranted an ADR are written down instead.

**An ADR is amended only by a superseding ADR.** None here has been rewritten,
and none will be: a decision record that can be edited is a decision record that
cannot be trusted about what was known at the time. The one line that changes
when a record is superseded is its **Status**, which names the record that
replaced it; everything under that line stays as written.

---

## The architecture decision records

| #                                                                             | Decision                                                                       | Status                                                   |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------- |
| [0001](adr/0001-javascript-only-stack.md)                                     | JavaScript everywhere, TypeScript nowhere                                      | Accepted, 2026-09-14                                     |
| [0002](adr/0002-polyglot-exception-process.md)                                | When another language may enter the repository                                 | Accepted, 2026-09-14                                     |
| [0003](adr/0003-stripe-connect-charge-model.md)                               | Stripe Connect charge model                                                    | Accepted for Phase 2 (sandbox only), 2026-09-15          |
| [0004](adr/0004-plpgsql-in-migrations.md)                                     | Procedural SQL inside migrations                                               | Accepted, 2026-09-15                                     |
| [0005](adr/0005-reserved-seat-transfer.md)                                    | Reserved-seat transfer stays blocked                                           | Superseded by 0006, 2026-09-29                           |
| [0006](adr/0006-reserved-seat-transfer-live-seat-index.md)                    | One live ticket per seat: reserved-seat tickets can be handed on               | Accepted, 2026-09-29                                     |
| [0007](adr/0007-platform-door-authority.md)                                   | A platform super administrator may admit at any event                          | Accepted, 2026-09-29                                     |
| [0008](adr/0008-show-once-codes.md)                                           | Invitation and transfer codes are shown once to whoever issues them            | Accepted, 2026-09-29; `EMAIL` wording superseded by 0011 |
| [0009](adr/0009-media-in-postgres-allow-list-sanitiser.md)                    | Event pictures: bytes in PostgreSQL, rebuilt from an allow-list                | Accepted, 2026-09-29; superseded in part by 0014         |
| [0010](adr/0010-invite-only-organisers-platform-administrator-review-gate.md) | Invite-only organisers, the platform administrator and the review gate         | Accepted, 2026-10-06                                     |
| [0011](adr/0011-smtp-delivery-of-show-once-codes.md)                          | SMTP delivery of show-once codes                                               | Accepted, 2026-10-06                                     |
| [0012](adr/0012-event-website-link.md)                                        | An event's website link, switched by administrators and counted on the way out | Accepted, 2026-10-06                                     |
| [0013](adr/0013-first-party-visit-counting.md)                                | First-party visit counting, without cookies or stored addresses                | Accepted, 2026-10-06                                     |
| [0014](adr/0014-full-control-of-posted-events.md)                             | Full control of posted events                                                  | Accepted, 2026-10-06                                     |
| [0015](adr/0015-importing-listed-events.md)                                   | Importing listed events                                                        | Accepted, 2026-10-06                                     |
| [0016](adr/0016-per-event-booking-fee-and-referral-codes.md)                  | Per-event booking fee and referral codes                                       | Accepted, 2026-10-09                                     |
| [0017](adr/0017-paying-at-the-venue-outside-the-ledger.md)                    | Paying at the venue: money at the door outside the ledger                      | Accepted, 2026-10-09                                     |

One record is superseded: 0005, by 0006. Two are superseded in part: 0008's
`EMAIL` wording by 0011, and 0009's "a published event takes no new picture" by
0014; each keeps its text and says so on its Status line (0009 also carries a
marked note beside the superseded consequence). Nothing is deprecated.

### 0001 — JavaScript everywhere, TypeScript nowhere

The stack constraint. JavaScript with JSDoc, ESM only, no `.ts`, `.tsx`,
`.d.ts` or `tsconfig.json` anywhere. Enforced by `pnpm run policy:check` rather
than by agreement, because a constraint nobody checks is a preference.

Types are expressed as JSDoc and checked where it pays — the contract, the
schemas — without the build step and the second language a TypeScript
compilation would add.

### 0002 — When another language may enter the repository

The exception process for 0001. A second language needs a recorded reason, a
bounded location and a named owner; `docs/language-policy.md` and
`docs/language-exceptions.json` are the machine-readable half, and the policy
check reads them.

Two exceptions exist and are both in that file: SQL in migrations (see 0004) and
the shell in CI configuration.

### 0003 — Stripe Connect charge model

Destination charges with `on_behalf_of` and an application fee. Direct charges
and separate charges-and-transfers were both considered and both rejected, for
reasons the ADR states in full. It also states, explicitly, what the decision
does **not** make The Desi Events: not merchant of record, not an escrow
provider, not a tax remitter, not the legal seller.

Follow-through in code: `docs/STRIPE_CONNECT.md`.

### 0004 — Procedural SQL inside migrations

plpgsql exists in this repository, in migrations only, for invariants that must
hold against code not yet written. The migrations create 29 triggers as of
2026-09-29, five of them added by the feature-completion work; this line said
20 when it was written. The ADR bounds where
it may live and why a JavaScript-only stack still needs it.

### 0005 — Reserved-seat transfer stays blocked (superseded)

A full unique index on `Ticket.eventSeatId` made accepting a seated transfer
a 500. The record chose to refuse a seated transfer at both ends and to say so on
the ticket screen, and recorded "one live ticket per seat" as the right end
state, safe only together with a refund-path lock and an analytics change it was
not authorised to make. Kept as the record of that reasoning; 0006 carries it
out.

### 0006 — One live ticket per seat

`Ticket_eventSeatId_live_key`, a partial unique index over `VALID`,
`TRANSFER_PENDING` and `CHECKED_IN`, replaces the full index. A handed-on or
refunded row keeps its seat as history. Acceptance and refund both lock the
order line `FOR UPDATE`, so a refund can never return the money and leave a live
successor admitting, and analytics counts a handed-on ticket once. A reserved
seat now goes with its ticket.

### 0007 — A platform super administrator may admit at any event

`SUPER_ADMIN` admits on a third authority, `PLATFORM_ROLE`, after any membership
it holds. Every platform lookup and admission writes an audit row on the event,
the role is re-read inside the admitting transaction, and a module-load
assertion keeps every other platform role away from the door. Reverses the
earlier "platform roles admit nobody".

### 0008 — Show-once codes

With no delivery provider (`DELIVERY_MODE=MANUAL`, this build), a team
invitation's or a ticket offer's single-use code is returned once, `no-store`,
to whoever issued it, who hands it over themselves. Only its digest is stored;
it is never logged, audited or put in a URL. Naming `EMAIL` with no provider
refuses to boot. Reverses "the token is delivered out of band and never appears
in a response".

### 0009 — Event pictures in PostgreSQL, rebuilt from an allow-list

Picture bytes live in `MediaBlob`, committed in the same transaction as the row
that names them, behind a `MediaStorage` interface. Each upload is sniffed from
its bytes, rebuilt from an allow-list of its format's structures without
decoding pixels, and reviewed by a moderator before it is public. No antivirus
engine runs, and the record and the limitations page both say so.

---

### 0010 — Invite-only organisers, the platform administrator and the review gate

Nobody makes themselves an organiser: an ADMIN or SUPER_ADMIN invites an address
to start a new organisation, created VERIFIED, and only the team at
The Desi Events grants roles that create or publish events; inside an
organisation a poster may only be moved down. A new platform role, `ADMIN`,
holds exactly ten capabilities by an allow-list checked at load. A database
trigger makes every public status follow a review decision, approval names the
revision seen, and a reviewer may not decide their own organisation's event or
one they submitted. It also records what a published event may change without
another review.

### 0011 — SMTP delivery of show-once codes

`DELIVERY_MODE=EMAIL` with an SMTP server emails organiser-invitation,
team-invitation and ticket-transfer codes; nothing else is ever emailed. Opt-in,
TLS required in production, a failed send withdraws what it issued, codes never
in a link, per-recipient and per-sender caps. Proven only against a local test
mail server.

### 0012 — The event website link

Only administrators turn an event's website link on or off, with a reason the
organiser sees with their name. An organiser's address change waits for a
decision and never moves the switch. The redirect is a web-tier 302 to the
decided address of a public event, counted from fetch metadata.

### 0013 — First-party visit counting

Page views, card clicks, ticket presses and website visits are counted by the
site's own beacons, with no cookie and no stored address, browser or account: a
visitor code made with a secret deleted when the day ends. A worker job rolls
raw rows into daily totals and deletes them two days later — data minimisation,
not retention, which still cannot delete.

### 0014 — Full control of posted events

Organisers, ADMINs and SUPER_ADMINs can edit, update and delete posted events.
Edits are not reviewed again; new pictures on a posted event wait for somebody
other than their uploader. Administrators edit another organisation's event in
a time-limited sitting bound to one browser session. Deleting is a status,
`DELETED`, with an outcome decided from what was sold — removed, cancelled and
refunded, or only taken down — and only the platform restores. Nine refund
defects were fixed first.

### 0015 — Importing listed events

Listings collected from another site (45 in Texas, and 294 in the United
States and Canada from the owner's own export) are imported by an administrator
into the member-less platform-held organisation "The Desi Events", reviewed and
approved by that administrator (the one exception to reviewer independence).
The owner's statement that they own the source site is recorded there as their
statement. Since its addendum "2026-10-15 (2)" nothing connects an imported
event to the source site: no link, no redirect, no copied picture and no
request of any kind. Each listed price becomes a ticket type on an allowance of
100 (a price marked sold out is created closed), sold here through the normal
checkout (simulated payment) from approval until the event starts, in USD at US
venues and CAD in Canada, and every imported event page offers "Reserve on
WhatsApp". Earlier versions showed the source's prices with a link to its
listing and copied the pictures once; those are gone.

### 0016 — Per-event booking fee and referral codes

The Desi Events team sets an event's own booking fee (a percentage and an amount
per ticket, in the event's one currency) at any time and in any status but
deleted, for new orders only, with a reason, a second factor and a history the
organiser reads; the site default stays a server setting. An administrator can
refund one order's booking fee by hand. Referral codes, made only by the team at
The Desi Events, remove an order's whole booking fee and any tax on it, are
stored in plain text but kept out of every URL, log, audit row and outbox row,
answer one refusal for every reason under a budget of wrong guesses, and give
their use back once when their order ends without being used. The platform
administrator's allow-list grows to fourteen.

### 0017 — Paying at the venue: money at the door outside the ledger

An administrator switches paying at the venue on for an event with a limit on
unpaid tickets across all buyers. Such an order pays only its booking fee
online, carries no tax, and owes each ticket's share at the door, where a
payment is recorded only in the step that admits the ticket, and never undone.
Door money never enters the ledger. Unpaid tickets can be cancelled by the
organiser or the team at The Desi Events, freeing their places (the one path
that puts general-admission stock back) and keeping their booking fee for good;
tickets owing money can be passed on. It records the lock law every path
follows.

## Decisions that live in code, not in an ADR

Not everything deserves an ADR. These are settled decisions whose reasoning is
written at the point it matters, where somebody changing the behaviour will
actually read it:

| Decision                                                                 | Where the reasoning is                                |
| ------------------------------------------------------------------------ | ----------------------------------------------------- |
| Production payments refuse the boot rather than being disabled           | `packages/providers/src/payment-mode.js`              |
| A provider is never called inside a database transaction                 | `apps/api/src/lib/checkout.js`                        |
| Timeout is its own state, never failure                                  | `apps/api/src/lib/reconciliation.js`                  |
| Conditional `UPDATE` + affected-row count as the concurrency primitive   | `apps/api/src/lib/inventory.js`                       |
| An operator never edits a payment or an order                            | `apps/api/src/routes/reconciliation.js`               |
| Money is derived from the ledger, never from order summaries             | `apps/api/src/lib/finance-reporting.js`               |
| Reversal posts compensating entries; it never edits history              | `packages/ledger/src/batches.js`                      |
| A route cannot exist without being in the published contract             | `apps/api/src/lib/register.js`                        |
| The response schema is an allow list                                     | `apps/api/src/lib/validation.js`                      |
| A ticket credential is derived, never stored                             | `apps/api/src/lib/ticket-credentials.js`              |
| `CHECKED_IN` is terminal                                                 | `apps/api/src/lib/tickets.js`                         |
| Step-up windows are server-owned named policies                          | `packages/auth/src/sessions.js`                       |
| scrypt rather than bcrypt                                                | `packages/auth/src/password.js`                       |
| Spreadsheet-injection escaping never strips a value                      | `apps/api/src/lib/csv.js`                             |
| Latency budgets scale with a profile; correctness does not               | `scripts/load/config.js`                              |
| A step-up gate refuses a request; a step-up _branch_ withholds a figure  | `apps/api/src/routes/analytics.js`                    |
| Reconciliation evidence is projected onto a reviewed key list            | `apps/api/src/lib/presenters.js`                      |
| A metric this system does not record is named, never estimated           | `apps/api/src/lib/analytics.js`                       |
| An invitation secret is pasted, never carried in a URL                   | `apps/web/src/components/ticket-transfer-actions.jsx` |
| A refusal says the same words whether the thing exists or not            | `apps/web/src/components/page-state.jsx`              |
| The API holds no queue client, so no browser can start a retention sweep | `apps/api/src/routes/retention.js`                    |
| A retention sweep has no lease, and the columns stay unwritten           | `apps/worker/src/retention/run-key.js`                |
| An export's subject link is policed by a source scan, not by a comment   | `apps/api/tests/export-register.test.js`              |
| A sweep row's identity is derived, so a redelivery writes nothing new    | `apps/worker/src/retention/run-key.js`                |
| A failed rehearsal records a row per class and does not abort the run    | `apps/worker/src/processors/sweep-retention.js`       |

Each of those is a module-level comment answering _why_, not a line comment
restating _what_.

### Two of those, in one line each

**No queue client in the API.** Adding one to gain a "run it now" button would
mean the one surface reachable from a browser had acquired the ability to start
a job whose durations nobody has approved. Initiation stays where it cannot be
reached over HTTP. This is the settled form of what the Phase 3–3 report calls
"owner decision 14"; that report references the decision in §6B but never tabled
it in §6A, so this row is where it lives.

**No lease on a retention sweep.** `RetentionSweep.leaseOwner` and
`leaseExpiresAt` are modelled on `PrivacyRequest`, where a lease protects a
mutating, resumable operation on a row that already exists. The rehearsal counts
and then inserts a row that is already finished, so there is no window for a
second worker to steal — and a lease would not cover what actually duplicates
rows, which is a retry, a restart or a stalled-job redelivery. A deterministic
primary key does. The columns stay because dropping them costs a migration and
takes a constraint and an index with it for no gain.

---

## Decisions taken and then reversed

Recorded because a reversal is the most useful kind of decision to have written
down:

**The `force` flag on check-in.** A request field that would let a scanner
override an admission refusal. Removed: a door device is the least trustworthy
caller in the system, and "let this one in anyway" is an authorization decision
that cannot be delegated to whoever is holding the phone. The test asserting the
old shape was rewritten to assert the new contract, with the reason in it.

**Reserved-seat transfer stays blocked** (ADR 0005). Reversed by ADR 0006 once
the refund-path lock and the analytics change it depended on were in scope. The
block was the right call while the index alone would have traded a loud 500 for
a quiet double admission.

**Platform roles admit nobody.** Reversed for `SUPER_ADMIN` alone by ADR 0007:
it already held every organisation capability everywhere, so refusing it at the
door was ceremony. Every other platform role is still refused, and the refusal
is still audited.

**Invitation and transfer codes never appear in a response.** Reversed by
ADR 0008. The rule assumed a delivery provider this build never had, so every team
invitation and every ticket offer minted a code nobody could receive.

**Storing full Stripe requirement lists.** Reduced to counts. The application
needs to know whether an organiser can be paid; what Stripe is waiting for is
Stripe's page to show.

**Check-then-create webhook idempotency.** Replaced with a unique index and a
caught constraint violation. The comment above the old code claimed replay was
"safe rather than merely unlikely", and it was not — nine 500s per ten-second
window under duplicate delivery, found by the load suite.

**A route-level step-up on the analytics routes.** It was the obvious reading of
"financial reads need a recent second factor", and it refused every VIEWER and
door steward — roles this system does not compel to enrol one — from reading an
attendance figure, in order to protect a ledger total they were never going to
be sent. Reversed to a branch-level check from the same server-held table: the
money is withheld, the page is not. The reversal is worth recording because the
original was not careless; it was a control applied one level too coarse.

**Falling back to your own organisation when the URL named another.** The first
draft of the analytics screen substituted `organizations[0]` for an
`organizationId` the caller could not view. No data leaked — the server scoped
to the membership actually held — but the address said one organisation and the
page showed another's figures with nothing saying so, and on a money screen that
is how somebody bookmarks, shares or screenshots a number attributed to the
wrong organisation. Reversed to a refusal in the same words the screen uses for
an identifier nobody has ever had.

---

## Where the constraints themselves are written

| Constraint                                | Enforced by                                                   |
| ----------------------------------------- | ------------------------------------------------------------- |
| No TypeScript                             | `pnpm run policy:check`                                       |
| No secrets in tracked files               | `pnpm run secrets:scan`                                       |
| No server contract in the browser bundle  | `scripts/scan-browser-bundle.mjs`                             |
| The OpenAPI artefact matches the contract | `pnpm run openapi:emit` + a drift check                       |
| Skipped tests fail CI unless allow-listed | `.github/workflows/ci.yml`                                    |
| Correctness under contention              | `pnpm run db:verify:fresh`, and the CI reliability smoke test |

## Decisions taken for the simulated connected-account surface — 2026-09-22

| Decision                                           | Instead of                                             | Why                                                                                                                                                                                              |
| -------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Reuse `ConnectOnboardingStatus`                    | A parallel `MOCK_*` vocabulary                         | A second set would need a migration to store and a mapping back to read: two vocabularies for one column. What marks a row simulated is `providerMode` and a server-set `simulated` on the wire. |
| `FINANCE_VIEW` on the read, `PAYOUT` on the action | `PAYOUT` on both, or a new `CONNECT_ONBOARDING` policy | The tiers the finance surface already uses. `CONNECT_ONBOARDING` is an `AuthTokenPurpose` lifetime, not a step-up policy, and the API would not have booted with it declared.                    |
| Create-only `START`                                | An upsert keyed on the unique organisation             | An upsert's update branch is unconditional, so a replay against `COMPLETE` rewrites it to `IN_PROGRESS` with the capability flags left true.                                                     |
| Compare-and-set on every advance                   | Read-then-write                                        | Two individually legal actions otherwise compose into a pair the table does not contain: the account passes through `DISABLED` and back out.                                                     |
| `defaultCurrency` NULL on a simulated row          | A plausible currency                                   | `payouts.schedule` attaches whatever account it finds to every payout, and the repaired trigger compares currencies. A fabricated value would refuse real payouts as a bare 500.                 |
| `finance` tag on both routes                       | A new `connect` tag                                    | `MONEY_TAGS` drives the invariant that every money route declares a step-up; a new tag would put a money-adjacent surface outside it silently.                                                   |
| Widen the body-field invariant by route id         | By tag                                                 | Widening to `finance` or `MONEY_TAGS` trips on `payouts.schedule`, whose body legitimately carries `organizationId` and `idempotencyKey`.                                                        |
| Import `@desi-event/schemas/connect`               | The barrel                                             | The barrel re-exports `entities.js`, `requests.js` and `responses.js`; a client component importing it ships every model's column names to the browser.                                          |

### Deferred to the owner, not taken

| Question                                                              | Why it is not ours                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Should payout scheduling filter on connected-account lifecycle state? | `payouts.schedule` attaches any account it finds, with no filter on `payoutsEnabled`, `chargesEnabled` or `providerMode`, so a simulated account is a payout destination in every state including disabled. Filtering changes real payout behaviour. |
| Should `paymentsOverride` re-apply the boot gate?                     | `app.js:87` replaces the gate's result wholesale and the comment above it claims the opposite. Not reachable in any deployment, but payment mode is a protected boundary.                                                                            |

## Decisions taken for checkout: nights, seats and promo codes — 2026-09-29

| Decision                                                                                                                     | Instead of                                                                               | Why                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One pricing function for the quote and the charge (`priceCheckout`)                                                          | A preview priced in the browser, or a second server path                                 | Two paths drift, and the buyer is charged by the one they were not shown. The quote is the same function read-only; the order recomputes it under lock and refuses with `PRICE_CHANGED` when it moved.                                                                                                                                                                                                                           |
| A promo code applies to every event of its organiser, or to one event                                                        | A per-tier or per-night scope                                                            | Nothing asked for it, and each extra scope is another reason a code silently gives nothing. The quote says why a code took nothing, so a narrower scope can be added when an organiser needs one.                                                                                                                                                                                                                                |
| The door admits by night: a ticket for one night on that night only, a ticket good for every night once on each (2026-09-30) | Nights as labels only, each ticket admitted once on whichever night it was first scanned | The site sells a tier with no night as "Every night", and admitting it once made that untrue; a Night 1 ticket let in on Night 2 took a place sold for Night 2. The door names the night it is admitting to, as it names the event, rather than guessing it from the clock, so a late-running night is not a false refusal; every admission records its night. A night's own capacity and sales window are enforced at checkout. |
| Seats are sold under the reserved tier that prices their zone                                                                | A tier chosen by the buyer, or stamped on each seat by hand                              | The partial unique index `TicketType_reserved_session_zone_key` allows one reserved tier per zone per night, so "which tier sells this seat" has one answer; a companion seat is sold under its own zone's tier.                                                                                                                                                                                                                 |
| A hidden tier answers 404 to anybody without `ticketType:manage`                                                             | Trusting that its id is not known                                                        | An id in a link, a log or a screenshot is known. The organiser's team can still book it, which is what hidden tiers are for.                                                                                                                                                                                                                                                                                                     |
| The joining link is for ticket holders only                                                                                  | Publishing it on the event page                                                          | It was in every anonymous `events.get` response and in the page's structured data. A holder receives it only while a ticket they hold admits, by the door's own rule.                                                                                                                                                                                                                                                            |

## Decisions taken for invite-only posting, analytics, full control and the import — 2026-10-06

Each was taken for the owner and each can be reversed; the reasons are in ADRs
0010–0015, and `docs/PHASE4_ONBOARDING_ANALYTICS_REPORT.md` ("Decisions taken
for you") states them in plain words.

- An organiser invitation always starts a **new** organisation; adding a poster
  to an existing one is a super administrator's grant.
- Owners move posting members only to lesser roles; promotions go through the
  team at The Desi Events.
- Invited organisations start Verified, with the description and website the
  administrator wrote.
- Reviewers may not decide events of their own organisation or ones they
  submitted; "may not review organisers you invited" is off. Moderators can
  approve events too.
- Team invitations already waiting that offered posting roles were withdrawn by
  the upgrade.
- Organisers see the administrator's name for the website link, but "an
  administrator at The Desi Events" for edits made in an editing sitting.
- Analytics adds a fifth source, "The Desi Events pages"; browsers asking not to
  be tracked count as page views; organiser-page card clicks are not counted.
- New pictures on live events wait for approval by somebody other than the
  uploader.
- Administrators may delete events with sales, which refunds every order in
  full; restoring an on-sale event brings it back paused; a deleted event's web
  address stays retired if it was ever public; administrators edit an
  organisation's events only once published; a venue cannot change while a
  night uses a seating map.
- Imported events belong to the member-less platform-held organisation "The
  Desi Events", get one ticket type per listed price (an allowance of 100,
  never shown as a count of tickets left), are approved or rejected rather than
  sent back, open their sales on approval, and may be moved to an organiser's
  organisation without asking it first. They carry no link to the source site
  (ADR 0015, addendum 2026-10-15 (2)).
- The new platform role is called `ADMIN` ("Platform administrator"), separate
  from an organisation's "Administrator".

## Decisions taken for booking fees, referral codes and paying at the venue — 2026-10-09

The owner answered questions 1, 2, 3 and 7 and confirmed the built answers to
4, 5, 6, 8 and 9 (`docs/PHASE4_FEES_AND_VENUE_PAYMENTS_REPORT.md`, "Decisions
taken for you"; the reasons are in ADRs 0016 and 0017). These were decided for
the owner and each can be changed without a migration:

- **A.** Only unpaid pay-at-the-venue tickets that are cancelled keep their
  booking fee; every other refund gives it back with the tickets.
- **B.** Unpaid tickets are cancelled by the organisation's owners and
  administrators and by administrators and super administrators at
  The Desi Events — not finance members, managers, door staff or finance
  administrators.
- **C.** A booking fee kept that way is never refunded afterwards, even by an
  administrator's booking-fee refund.
- **D.** Unpaid tickets can be cancelled until their night ends (the last night
  for an every-night ticket; the event's end when it lists no nights), while
  the event is live.
- **E.** A cancelled reserved seat is freed at once, even in the last 24 hours.
- **F.** If the online booking fee ever carries tax, that tax would go back to
  the buyer; until that refund is built, such a booking cannot be cancelled this
  way.
- **G.** Withdrawing every ticket of an order with nothing left to refund gives
  its referral use back.
- **H.** Buyers cannot cancel their own unpaid booking.
- **I.** Unpaid tickets can be cancelled at any time while the event is live,
  even before the doors open.
