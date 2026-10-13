# UX and accessibility

What the product does in front of a person, and what has actually been checked
in a real browser as opposed to asserted in a unit test. Those two are reported
separately here, on purpose.

---

## The screens that exist

| Surface                | Route                                               |
| ---------------------- | --------------------------------------------------- |
| Catalogue and search   | `/events`                                           |
| Event page             | `/events/[slug]`                                    |
| Checkout               | `/events/[slug]/checkout`                           |
| Organiser event list   | `/organizer/events`                                 |
| Event editor (9 steps) | `/organizer/events/[id]`                            |
| Venues and maps        | `/organizer/venues`, `/organizer/map-versions/[id]` |
| Moderation queue       | `/moderation/events`                                |
| Finance overview       | `/finance`                                          |
| Operations board       | `/operations`                                       |
| Organiser analytics    | `/analytics`                                        |
| Reconciliation item    | `/operations/reconciliation/[id]`                   |
| Refund                 | `/finance/refunds/[id]`                             |
| My tickets             | `/tickets`                                          |
| One ticket             | `/tickets/[id]`                                     |
| Accept an invitation   | `/tickets/accept`                                   |
| Organiser profile      | `/organizers/[slug]`                                |
| Venue page             | `/venues/[slug]`                                    |

_Added 2026-09-29, by the feature-completion work:_

| Surface                                                                        | Route                                                         |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------- |
| Seat picker and seated checkout                                                | `/events/[slug]/seats/[sessionId]`                            |
| Accept an organiser invitation (was "Create an organisation" until 2026-10-06) | `/account/organizations/new`                                  |
| Join an organisation (invitation code)                                         | `/account/invitations`                                        |
| The organisation's profile                                                     | `/organizer/organization`                                     |
| Team, with invite form and codes                                               | `/organizer/team`                                             |
| Promo codes                                                                    | `/organizer/promo-codes`                                      |
| Door check-in, group passes included                                           | `/organizer/check-in`                                         |
| Verification queue and one review                                              | `/moderation/organizations`, `/moderation/organizations/[id]` |
| Platform accounts and roles                                                    | `/admin/users`                                                |
| An order, with its group pass                                                  | `/account/orders/[reference]`                                 |

The editor's Media step (cover and gallery upload, descriptions, order) and
its two content steps are inside `/organizer/events/[id]`.

The last revision of this document said refunds, reconciliation detail and
ticket transfer were API-only and that no page for them existed. **All three
exist now**, along with organiser analytics and an invitation screen, and each
is in the sweep. The sentence stayed accurate for exactly as long as it was
true, which is the property that matters more than which way it reads.

---

## The principles the markup actually follows

**A refusal explains itself.** "Still to do before this can be published" names
each reason — unverified organiser, draft map, missing session — and links to
the field that fixes it.
A refusal that says only _forbidden_ trains people to retry, and retrying is
never the fix.

**A figure says where it came from before it says what it is.** On the finance
screen the mode banner and the ledger-integrity result appear **above** the
totals, not in a footnote. A batch that does not add up is a reason to stop
reading the totals, not an annotation on them.

**Colour is never the only carrier.** The ageing badge on the operations board
reads `OVERDUE` as a word as well as in red. A status is a word. A ticket says
**Admits** or **Does not admit** in bold before the colour of its panel says
anything; an oversold tier says `Oversold — investigate` rather than turning
amber.

**An absence explains which kind of absence it is.** "No refunds" and "the
refund service is down" look identical if both render as a blank area, and only
one of them is a reason to telephone somebody. The five states every
authenticated screen can be in — loading, empty, failed, forbidden, stale — are
written once, in `components/page-state.jsx`, so that four surfaces cannot drift
into four different vocabularies for the same five facts.

**A refusal says nothing about what it is refusing.** Asking for another
organisation's refund and asking for an identifier nobody has ever used produce
the same words. A refusal that distinguished them would be an enumeration
oracle: feed in a thousand identifiers, keep the ones that come back "not
yours".

**A secret is never in a web address.** The invitation that transfers a ticket
is typed into a password field and sent in a request body. A link carrying it
would leave it in the browser's history, in the next request's `Referer`, in
every proxy log along the way, and in any screenshot of the address bar — and
it would still be there after the invitation was spent.

**Nothing is measured in "tests".** Unit tests and browser journeys are
different evidence and are counted separately everywhere in this repository.

---

## Accessibility: what was run

`axe-core` via `@axe-core/playwright`, **WCAG 2.1 A and AA, with no disabled
rules**. There is no exclusion list; the only selector exclusion is Next's own
development overlay, which is not the site's markup and is not shipped.

Where the scanner found something, the component was fixed. Three real failures
have come out of this markup, and the third is the interesting one:

- a definition list whose hint text sat outside its `<dd>`;
- a scrollable region that could not be reached by keyboard
  (`scrollable-region-focusable`), fixed with `tabIndex={0}` and a
  `role="region"` with an accessible name;
- **the same definition-list mistake again**, on the reconciliation detail
  screen's "Where it stands" list, where each entry wrapped `dt`, `dd` **and an
  explanatory `p`** in one `div`. A `div` inside a `dl` is allowed; a `p` as a
  third sibling is not, and a screen reader walking the list gets three
  unassociated paragraphs where it should get three definitions. Made twice
  means it is a pattern rather than a slip, so the comment explaining it now
  sits on both components.

### The sweep: 42 browser cases

`apps/web/e2e/accessibility-sweep.spec.js`, run under
`playwright.sweep.config.js`:

- **Ten screens × three viewports = 30 clean scans.** The organiser event list,
  the seven-step editor, the public event page, the finance overview, the
  operations board, organiser analytics, the reconciliation detail screen, the
  refund detail screen, the ticket detail screen and the invitation screen, at
  **320**, **768** and **1280** CSS pixels.
- Reflow at **200% zoom** with no sideways scrolling — the editor, and the four
  detail screens together.
- Nothing left permanently invisible under `prefers-reduced-motion`, on the
  organiser list and on the refund screen.
- The editor reachable and operable **by keyboard alone**, and a reconciliation
  item likewise, reaching its skip link first.
- A visible focus indicator on **every** focusable control.
- The moderation queue and decision screen scanned.
- Touch targets large enough to hit.
- The finance screen stating what produced its figures before any of them.
- The invitation code typed in without ever entering the address bar.
- The refund screen mentioning no card and holding no field that could take one.

**Every new screen is scanned with real rows behind it** — a paid order with
two tickets, a refund with lines and an allocation, a reconciliation item with
both sides of its evidence, a ledger batch that balances. A screen rendered from
a static array proves that the markup compiles, which is a different and much
weaker claim.

**320, not 360.** WCAG 1.4.10 names 320 CSS pixels as the reflow width, and a
layout that only works at 360 fails the criterion for anybody on a small phone
or a zoomed desktop.

### Covered, and not

Covered: every Phase 2 screen that exists, in the list above — all ten of them.

Not covered, because no such screen exists: Connect onboarding, and a data
erasure request. Both are recorded as unbuilt in `PHASE2_STATUS.md` §10 and in
`docs/STRIPE_CONNECT.md`. Naming a surface as swept would report a coverage this
suite does not have, which is the same reason the three rows that used to be
here are now in the table above instead.

> **Update — 2026-09-21.** Half of that second sentence is no longer true, and
> the half that changed is worth being precise about rather than striking the
> whole line.
>
> **The erasure screens exist**, and there are five of them: the privacy request
> queue, a request's detail with the scope it would touch, holds, the export
> register and the retention rehearsal log. `PHASE2_STATUS.md` §10 recorded them
> as unbuilt because they were, at the time it was written.
>
> **They are covered now**, and this sentence is dated so that a later reader
> can check it rather than trust it. Three of them — the queue, the register and
> the retention log — are swept at all three widths with the scanner and the
> reflow check, in `accessibility-sweep.spec.js`. The register additionally has
> a case asserting its table is named and its headers scoped, because axe
> requires neither and deleting both leaves a clean scan; and a case asserting
> the table scrolls in its own container rather than widening the page, which is
> what "reflow" means for six columns of counts that will never fold.
>
> **Connect onboarding is still not covered, and still does not exist.** That
> half of the sentence stands unchanged.

---

## Browser journeys, counted honestly

Seven Playwright configurations, because they need different fixtures and
different servers. Case counts are from the last full run of all seven (see the
2026-09-30 update below):

| Configuration                     | Cases   | What it covers                                                                                     |
| --------------------------------- | ------- | -------------------------------------------------------------------------------------------------- |
| `playwright.config.js` (default)  | 119     | Public catalogue, event, venue, checkout, filters, focus, reduced motion, structural accessibility |
| `playwright.sweep.config.js`      | 114     | The responsive and accessibility sweep                                                             |
| `playwright.detail.config.js`     | 174     | The 22 `detail-*` specs, as behaviour rather than as markup                                        |
| `playwright.events.config.js`     | 30      | The event lifecycle end to end                                                                     |
| `playwright.production.config.js` | 19      | Not-found behaviour in a production build                                                          |
| `playwright.organizer.config.js`  | 13      | Venue maps and versions                                                                            |
| `playwright.refusals.config.js`   | 4       | Four product refusals (below)                                                                      |
| **Total**                         | **473** |                                                                                                    |

**473 browser cases is not "473 of the required journeys".** Passing a number of
Playwright cases is not the same as passing a specific list of required
journeys, and this document does not use the first as evidence for the second.
The per-journey status lives in `PHASE2_STATUS.md` and nowhere else.

> **Update — 2026-09-21.** The sweep went 42 → 53 and the detail suite 26 → 37,
> for the privacy and retention screens; the total is 264. Every figure in this
> table is from `npx playwright test --config <file> --list`, run against the
> working tree rather than remembered — which is the only way a count in a
> document stays true, and is why the three unchanged rows were re-run too.

> **Update — 2026-09-22.** The sweep went 53 → 56 and the detail suite 37 → 48,
> for the simulated payout-setup screen; the total is 278, and the detail row now
> covers **six** surfaces rather than five. The deltas are exactly what PR #12
> added: eleven journeys in `apps/web/e2e/detail-connect.spec.js`, and one sweep
> case multiplied by the three viewports the loop runs. Every figure was re-read
> from `npx playwright test --config <file> --list` against this commit, the four
> unchanged rows included.
>
> The 2026-09-21 block above is left as written, including its "the total is
> 264", because it was true on its date. Two dated blocks disagreeing about a
> total is the house rule working: the later one is current, and the earlier one
> still records what was counted when.

> **Update — 2026-09-30.** The total is 473: default 118 → 119, sweep 56 → 114,
> detail 48 → 174 and events 20 → 30; production, organizer and refusals are
> unchanged. The additions are the feature-completion work's browser journeys,
> in the end-to-end stage's two commits (`999f7b3`, `5eb42f4`): ten new
> `detail-*` specs (team access and organisations, event pictures, event
> authoring, the platform door, the group pass, transfer codes, the seat
> picker, promo codes, promo checkout and an online event), the authoring
> journeys in `event-lifecycle.spec.js`, and sweep cases for every new screen.
> These figures are the collected counts of that stage's last full run of all
> seven configurations, on 2026-09-29 between 19:35 and 19:56 UTC against the
> tree committed as `5eb42f4`, each on a fresh database: 473 collected, 473
> passed, none flaky and none skipped. They were not re-read with `--list` for
> this update.

> **Update — 2026-09-30, the review's fix round.** The total is 483: sweep
> 114 → 121 and detail 174 → 177; the other five rows are unchanged. The sweep
> gained the reschedule form at three widths, three surfaces (an unverified
> organisation's page as its owner sees it, people and roles with both forms
> open, and the decision to verify an organisation open) and the seat picker
> with motion reduced; the detail suite gained the seat picker's wheelchair
> space, companion and unavailable seats by keyboard, and two team journeys
> (a platform role put back to attendee, and an organisation made by an
> attendee with no second factor). The sweep's two keyboard walks now judge
> what focus adds rather than what a control draws at rest. All seven ran on
> 2026-09-30 between 14:28 and 14:50 UTC against the working tree on top of
> `5eb42f4`, uncommitted, each on a fresh database: 483 collected, 483 passed,
> none flaky and none skipped. The table above keeps the earlier figures,
> which were true for `5eb42f4`.

The detail configuration runs four specs that are also separately runnable —
`test:e2e:analytics`, `test:e2e:reconciliation`, `test:e2e:refunds`,
`test:e2e:transfers` — under one pair of servers, because four configurations
would be four API processes and four Next servers on a two-core CI runner. It
seeds once and signs in once for the whole run: the first draft signed in eight
times inside a minute and the credential limiter refused the last of them,
correctly, and the right answer to being refused by a security control is to
stop doing the thing rather than to widen the control.

### The four refusals, in a browser

`e2e/refusals.spec.js` exists because four of the required journeys are about
the product **refusing** something, and an API test asserting a 403 does not
show that a person is refused through the product:

- **A** — a member of another organisation cannot submit your draft for review.
- **B** — an unverified organiser cannot publish, however ready the event is.
- **C** — a draft venue map cannot be referenced, so it can never back a sale.
- **D** — a member of another organisation can neither edit nor publish your
  event.

Each drives a real browser as the wrong person and observes the refusal.

---

## Responsive behaviour

Three widths, asserted rather than eyeballed: **320**, **768**, **1280**. At
every one, for every swept screen: no horizontal scrolling of the document, the
scan clean, and every interactive control still reachable.

Wide data tables — the finance ledger view, the operations queue — scroll
**inside a focusable region with an accessible name** rather than pushing the
page sideways. That is the `ScrollableTable` component, and it is why the
`scrollable-region-focusable` rule fired on the first draft.

---

## Reduced motion

`prefers-reduced-motion: reduce` removes transitions. It does **not** remove
content: a case asserts that nothing animated is left permanently invisible,
because the usual mistake is an entry animation whose end state is the visible
one and whose start state is `opacity: 0`.

---

## Mock mode in front of a person

Where money is shown and no money moved, the screen says so **above** the
figures: _"DEMO — no money moved, no card was charged, and this is not a valid
receipt."_ The CSV export carries the same notice on its first row, because an
exported file outlives the screen it came from.

The banner is `role="status"`, so it is announced rather than merely present.

---

## CSV exports

Every exported cell is escaped against **spreadsheet injection**: a value
beginning `=`, `+`, `-`, `@`, tab or carriage return is prefixed with an
apostrophe. The value is never stripped — a ticket type genuinely called
`-Premium` still reads as `-Premium` when the file is opened, which a stripping
implementation would silently corrupt.

Columns are an explicit allow list. An export cannot widen because a model
gained a field.

---

## The event editor: draft, live and locked

Nine steps, in this order: Details, When and where, Sessions, Tickets, Policies
and access, Media, Line-up and running order, Guest information, Review. Media
stays sixth because the pictures arrived before the two content steps did; the
lifecycle commands are on the last step, beside the readiness checklist.

The editor is in one of three modes, from the event's status:

- **Draft** (`DRAFT`, `CHANGES_REQUIRED`): every field is editable and
  autosaves about a second after typing stops.
- **Live** (`PUBLISHED`, `ON_SALE`, `SALES_PAUSED`, `SOLD_OUT`, `POSTPONED`): an
  alert headed "This event is public" says the description, line-up, questions
  and other details still save as you type, and the date, place and terms do
  not. Those fields are read-only on their steps, beside a "Change date, place or
  terms…" button that opens a panel. The panel says "You are changing: …" in
  words, asks "Why this is changing" (required, up to 2,000 characters) and a
  tick — "I understand this changes what people bought, and a notice will be
  recorded for every current order." — and sends only the fields that changed.
  Tiers and sessions are still added and edited; a change that would take
  something from a buyer (a sold tier's price, a quantity below what is sold and
  held, a seating layout, the only night of the event) is refused with the
  reason.
- **Locked** (every other status): "This event is not open for editing", with
  what happens next, and every field disabled.

A lifecycle command on the Review step — rework, reschedule, publish and the
rest — hands the event the server returned back to the editor. The editor takes
its status, its revision and any field the command changed, so a reworked event
unlocks at once and the next save after a reschedule carries the new revision
rather than being refused as somebody else's edit. Removing a session re-reads
the ticket types, because the ones priced for that night go with it.

**Copy says "recorded", never "sent".** Change notices are never emailed, in
any delivery mode. Every place that used to say a change or a postponement was
sent to ticket holders now says a notice is recorded for every current order,
and where the organiser would otherwise assume people have been told, it adds
"Notices are not emailed, so tell ticket holders yourself as well." (Corrected
2026-10-06: the sentence used to be "This build does not send email, …", which
is false where an operator configures SMTP for codes, ADR 0011.) That covers the material-change panel,
the postpone and cancel reason field ("Recorded with the notice for every current
order…"), the postpone confirmation, the policies step and the reschedule form.

**A postponed event comes back in one step.** "Set a new date and bring it back"
opens a form with the new start and end in the event's zone, every session
prefilled and moved by the same amount unless that box is unticked — its door
time and its own sales window with it, the window shown beside the night and
set on its own when the night is — a choice of
coming back published (sales closed) or on sale — the second offered only when
the server says sales can reopen, with the reasons when they cannot — a reason
and a tick. A lapsed step-up opens the second-factor prompt beside the form, not
inside it. **A rejected event** offers "Rework as a draft", which says the
moderator's reasons stay in the history.

**Prices are typed in dollars.** "35", "$35.00", "35 USD" and "1,234.50" are
read; a stray letter anywhere else ("12x5") is refused with "Type the price as a
plain number, such as 35.00." rather than read as a different price.

**The moderator sees where every link goes.** The review page renders the
description as the public page will, and writes each link's full address after
its label, so "Official tickets" cannot point somewhere unseen. Social and
sponsor links are written out in full, and hidden and complimentary tiers are
flagged.

Checked by unit and component tests (`event-editor.test.jsx`,
`event-lifecycle-panel.test.jsx`, `material-change-panel.test.jsx`,
`event-reschedule-form.test.jsx`, the moderation page's test). When this
section was written (2026-09-29), no browser journey drove these flows and none
of these screens had been through the accessibility sweep.

> **Update — 2026-09-30.** The end-to-end stage (`999f7b3`) added browser
> journeys for them. In `e2e/event-lifecycle.spec.js`: prices typed in dollars
> (journeys 8 and 8a), a material change that has to be confirmed with a reason
> (19), a date moved only with a reason and a tick (19a), and a postponed event
> brought back with a new date through the reschedule form (19b). In
> `e2e/detail-event-authoring.spec.js`: a live event with sales keeping its
> price, and a rejected event showing why and coming back as a draft to rework.
> The sweep scans the editor — the step it opens on, and its tickets, pictures,
> line-up and guest steps — at 320, 768 and 1280 pixels, walks it at 200% zoom
> and by keyboard alone, and scans the moderation queue and decision screen. It
> does not scan the material-change panel, the postpone and cancel forms or the
> reschedule form.
>
> **Update — 2026-09-30, later.** The sentence above was wrong about the
> material-change panel: the sweep's "change of date, place or terms on a live
> event" case opens that panel and scans it at each width, and did before this
> update. The sweep now also scans, at 320, 768 and 1280 pixels, the editor's
> sessions and policies steps; its line-up and guest steps with a performer, a
> slot and a question drawn in them (seeded on the draft by `seedEventContent`,
> `e2e/support/seed-feature-world.mjs`); the reschedule form, opened on a
> postponed event; and the public event page with every content section drawn
> — the line-up with bios, the running order, the questions, the dress code,
> the way there, the contact, the links and a sponsor. The postpone and cancel
> forms are still not scanned.

---

## A code shown once — 2026-09-29

A team invitation and a ticket offer each end in a single-use code that the
person who made it must hand over themselves when the site runs in `MANUAL`
delivery, as this environment does (ADR 0008; with an SMTP server the code is
emailed instead and never shown, ADR 0011). An organiser invitation (ADR 0010)
uses the same panel, with a ready-to-send message beside the code. One component, `one-time-code-panel.jsx`, draws it on both screens:

- **It says what it is and that it will not come back.** A heading, the code in
  a read-only field with its own label, who it is for when the caller may see
  the address, when it stops working, and where the recipient types it in
  ("Your account → Join an organisation", or the ticket accept page).
- **Copying is offered, not assumed.** The clipboard is used when the browser
  allows it; when it does not, the field's text is selected and the person is
  told to copy it themselves.
- **It lives in memory only** — never in `localStorage`, `sessionStorage`, the
  address or a link — and "I have handed it over" drops it. On the team screen
  it is held above the table, so the refresh that removes the invitation row it
  replaced does not take the code with it.
- **Focus moves to its heading** when it appears, and the outcome is announced
  politely: only the door workspace interrupts.
- The recipient's side is a **password field** in a form that sends the code in
  a request body; the page reads no query parameter that could carry one.

## The door, with a group pass and a platform administrator — 2026-09-29

A group pass is recognised by its shape — the QR's `G1.` prefix, or a typed
code in the `DEG-` shape — and looked up like a ticket. The answer lists every
ticket in the group with its outcome in words, each with a tick box; everybody
admissible starts ticked, and the steward unticks whoever is not at the door.
**Admit** sends the ticked tickets; if one changed since the lookup, nobody is
admitted and the screen says to look the group up again. The session list names
a group as "First name and N more", or "Group pass" when nobody on it is named.
Urgent outcomes stay assertive, as for a single ticket; the group cards are in
`door-workspace.jsx` because that is the one file the live-region policy lets
interrupt.

On an event of more than one night the door asks **Night you are admitting
to**, starting on tonight's (the first night that has not ended), and nothing can be
presented until a night is chosen; changing it lets go of the ticket in hand.
Every lookup and admission carries the night. A ticket for another night is
refused with the night it is for; a ticket good for every night is named "Every
night" and is "already admitted on" tonight's night only when it went in
tonight. Each ticket of a group names its night the same way.

A platform super administrator sees **Check-in** in the navigation and, on the
door page, a persistent notice that every lookup and admission is recorded
against their account on the event's own record, a filter by organisation and
by search text, and a notice when the list of events was cut at 100.

The buyer's side is on the order page: **Show group pass** fetches it on the
press, draws the QR and shows the printed code only while it is shown, hides it
when the page is hidden or left, and asks for confirmation before replacing it.
An order with more than fifty tickets gets a sentence instead of a pass.

---

## What is not claimed

- No screen-reader testing with an actual screen reader.
- No user testing with disabled users.
- No performance budget enforced in a browser.
- `script-src` and `style-src` permit `'unsafe-inline'` (see
  `docs/SECURITY.md`); that is a real weakness and not an accessibility one,
  but it is a gap and belongs on a list of gaps.

Automated scanning at AA is a floor. It is what has been done, and it is not the
same as a page being good to use.

## The payout-setup screen — 2026-09-22

`/finance/connect`. One `h1`, "Payout setup", and a standing notice directly
under it saying that everything on the page is simulated, that no payment
provider has been contacted, that no account exists at one, and that there is no
setup link to follow because in this mode there is nowhere for one to lead.

### Degrading rather than throwing

The heading renders **outside** the try and the gated read inside it, so a
lapsed step-up window produces a page with its heading, its notice and a refusal
in the body — never a thrown page. That is what `/finance` already does, which is
why `/finance` survives the accessibility sweep whatever the session's age, and
it is what lets a Connect case sit anywhere in the sweep file at any runner
speed without step-up machinery in the spec.

The sweep asserts the heading **by name** rather than a bare `level: 1`, because
a bare assertion would pass against the degraded page and call an unscanned
screen clean.

### Wording

No state name is ever rendered raw. `COMPLETE` becomes "Final simulated step
reached", because "complete" is what an organiser reads as "I am done and can be
paid". Every state carries the sentence saying what it does not mean. The two
derived capability flags render as "Simulated as available" or "Not simulated",
never as enabled.

Eight phrases are forbidden outright and checked by machine rather than by
care — `Stripe verified`, `provider verified`, `KYC complete`, `payouts enabled`,
`live account`, `live onboarding`, `real onboarding link`, `real account
created`. The check runs over the vocabulary in a unit test, over every API
response in the API suite, over every string the client component can render in
its own test, and over the whole rendered body in the browser.

### Interaction

Each action is a button and never a link, because each is a POST. Each is
confirmed before it fires, and the last step has its own wording because it is
terminal. Focus moves into the confirmation panel when it opens and returns to
the exact trigger when it is dismissed — restored by effect against a live node,
never against one captured on the way in, because opening the panel unmounts the
triggers and focusing a detached node silently does nothing.

Every screen moves focus the same way: through `useFocusAfterRender`
(`apps/web/src/components/focus-after-render.jsx`), which asks for the move as a
state change and makes it in an effect once the pass that draws the target is
committed. A `queueMicrotask` does not do this. It works inside a click handler,
but after an `await` it runs before React draws the refusal, or the opener that
comes back when a panel closes, and focus falls to the page. A test in
`focus-after-render.test.jsx` fails if any component goes back to it.

There is no page-level loading state, and that is a fact about this application
rather than an omission: every screen is `force-dynamic` and server-rendered, the
shared `Loading` component is dead code, and there is no `loading.jsx` or
`Suspense` anywhere. The pending state is the button's own disabled-and-busy
label, and the outcome is announced through a polite live region.

### What the sweep found

`scrollable-region-focusable`, serious, on the first run. Every other scrolling
table in this product has links or buttons in its cells, so a keyboard user
reaches the scroll by tabbing into the content; this table is entirely static
text, which left the container unreachable — at 320px the second column sits
off-screen with no way to bring it into view without a pointer. It is now
focusable and named.

The target-size case (WCAG 2.2, 2.5.8) moved to this screen, because it is the
one introducing new buttons and axe runs the 2.1 tag set, which does not contain
that criterion. The focus-ring case now runs over this screen as well as the
event list, for the same reason.

## The seat picker — 2026-09-29

`/events/[slug]/seats/[sessionId]` (`components/seat-picker.jsx`,
`components/seat-checkout.jsx`, `lib/seat-map.js`).

**A grid, not a floor plan.** The seat map has no coordinates, so the picker
draws each section as a grid — rows in order, seats in order along each row,
loose seats (tables, boxes) as a row of their own — and says so: "Seats are
shown by section and row, not to scale." Nothing pretends to be a drawing of the
room.

**Keyboard.** Each section is one Tab stop (roving `tabindex`). Arrows move one
seat; up and down go to the same place in the next row, or its end when it is
shorter; Home and End go to the ends of the row; PageUp and PageDown to the first
and last row; Space or Enter chooses. A skip link jumps past the map to the
selection.

**Names and states.** Every seat is a `<button aria-pressed>` whose name reads
what a sighted buyer reads off the grid, state last: "Seat A12, row A, Stalls,
Front zone, $45.00, wheelchair space, available". A seat nobody can take stays
focusable with `aria-disabled`, so a screen reader user hears why it is not on
offer. A restricted seat's note is tied to it with `aria-describedby` and also
printed under its section.

**Never colour alone.** A chosen seat has a tick, a taken one a cross and a
hatch, a wheelchair space a wheelchair, a companion seat a C, an obstructed one a
struck-through eye, a restricted one a !. The legend names each. Zones are words
and a filter ("Price zone"), not colours; a second filter shows wheelchair
spaces and companion seats only. Colours are the semantic seat tokens
(`seat-available`, `seat-selected`, `seat-unavailable`); the hatch is the
`.seat-hatch` utility built from `--color-seat-unavailable-ink`.

**The companion rule is the server's.** Choosing a wheelchair space chooses its
companion seat and the other way round, removing either removes both, and a pair
whose other half is taken cannot be chosen — the same `withCompanions` the API
applies, imported from `@desi-event/inventory/seating`, the package's
browser-safe subpath.

**Each tier's own limits.** The page states them before anybody tries: the
most seats one order may hold, any zone that allows fewer ("A selection with
seats sold as “Front stalls” can have at most 2.") and any zone sold more than
one at a time. A selection is held to the smallest limit among the tiers it
includes, as `sessions.hold` is, and a selection with fewer seats of a tier than
it sells at a time — a wheelchair space's companion counts — cannot be reserved,
with the shortfall said beside the button.

**Pay names only the server's figure.** Until the quote for the held seats
answers, the button reads "Pay (simulated)" with no amount and cannot be
pressed; a failed quote is said, with "Ask for the total again". A code chosen
before the seats are held is "checked when you reserve your seats", never
"applied".

**Announcements are polite.** One status region says what each choice did
("Seat A1 added, with companion seat A2. 2 seats selected."), when the order's
limit refuses a seat, and when seats are held. When a seat goes to somebody else
between choosing and reserving, the map is read again and the seat is named:
"Seat B1 was taken by somebody else while you were choosing. Nothing was
reserved or charged."

**Targets and width.** Seats are at least 36px square, above the 24px of WCAG
2.2 (2.5.8). A wide section scrolls inside its own region; the page itself never
scrolls sideways.

**Checked in a browser (2026-09-30).** The end-to-end world's seat plan has two
sections, each its own price zone: plain balcony seats, and boxes holding a
wheelchair space with its companion seat, an obstructed seat, a restricted seat
with its note and a seat the organiser has blocked. `e2e/detail-seat-picker.spec.js`
reaches the sold seat and the blocked one with the arrow keys and hears each
called unavailable, chooses the wheelchair space by keyboard and hears the
companion come with it, and gives both back by unchoosing either. The
accessibility sweep scans the map with every symbol and the restricted note
drawn, and checks that with motion reduced no seat transitions for longer than
0.01 ms.

## Booking for the team — 2026-09-30

A hidden or complimentary tier is not on the event page for anybody, and it is
booked through the same checkout as every other tier. A member who may book it
(`ticketType:manage` in the event's organisation) finds a "Book from a hidden
tier" panel on the event's editor page once the event is on sale, with a "Book
team tickets" link to the event's checkout. There, and on the seat page, the
event is read as that member, so the hidden tiers are listed too, each marked
"Team only", under a "Booking for your team" note: the tickets are kept in the
booker's account, and each is handed on to a guest with a transfer code from
their tickets. Anybody else, signed in or not, is shown only the public tiers,
and the checkout never breaks when the team's read fails — it falls back to them.

## The promo code box — 2026-09-29

One box at checkout, labelled "Promo code", with Apply (and Remove once a code
took). The code is trimmed and upper-cased; a code of the wrong shape is refused
before anything is sent. The outcome is a polite status in words the buyer can
act on, taken from the server's quote:

| Quote says          | The box says                                                      |
| ------------------- | ----------------------------------------------------------------- |
| applied, percentage | "SAVE10 applied: 10% off."                                        |
| applied, amount     | "FIVE applied: $5.00 off."                                        |
| `UNKNOWN`           | "That code is not valid for this event."                          |
| `INACTIVE`          | "The organiser has paused that code."                             |
| `NOT_STARTED`       | "That code has not started."                                      |
| `EXPIRED`           | "That code has ended."                                            |
| `EXHAUSTED`         | "That code has been used as many times as the organiser allowed." |
| `CURRENCY_*`        | "That code cannot be used with this currency."                    |
| before reserving    | "SAVE10 is checked again when you reserve your tickets."          |
| signed out          | "You can use a promo code after signing in."                      |

An unknown code is an answer, not an error, so a typo is corrected in place. The
summary shows the discount as its own row, "Discount (SAVE10)". When the total
moved between the quote and the payment (`409 PRICE_CHANGED`), nothing is
charged; the summary is re-quoted and the page says "The total is now $X.
Nothing was charged. Check the summary and pay again."

A payment that did not end in a booking is never shown as one. "Booked" is
drawn only for an order that came back `PAID`. When an order was placed and
whether it was paid is being checked — the capture timed out (`502
PAYMENT_TIMEOUT`), it was taken and the order could not be completed (`500
ORDER_NOT_COMPLETED`), or a retry found the attempt still unsettled (`409
ORDER_PENDING`) — both checkouts show "Please do not pay again" over the API's
own sentence, disable Pay and the selection, move focus to the notice, and link
to the order ("See order DE-…"). An order that came back unpaid under a success
status gets the same treatment, titled "Not booked". A declined card
(`402 PAYMENT_DECLINED`) says so in the API's words, keeps the holds, and makes
the next Pay a new attempt with a new key. A cancelled order (`409
ORDER_CANCELLED`) gives the holds back and asks for a new reservation.

The organiser's side is `/organizer/promo-codes`: a table with each code's
discount, what it applies to, its window in a stated zone, its uses against its
cap and its status as a word beside a shape. Making a code and resuming one ask
for a recent second factor when the API does; deleting is confirmed in place and
offered only for a code nobody has used.

## Invite-only organisers, the website link, analytics, full control and imports — 2026-10-06

The decisions are ADRs 0010–0015; this section lists the surfaces and the copy
rules they follow.

| Surface                                         | Route                                          |
| ----------------------------------------------- | ---------------------------------------------- |
| Organiser invitations: issue, reissue, withdraw | `/admin/organizer-invitations`                 |
| Accept an organiser invitation (type the code)  | `/account/organizations/new`                   |
| Every event, for the Desi-Event team            | `/admin/events`, `/admin/events/[id]`          |
| Importing listed events                         | `/admin/imports`, `/admin/imports/[runId]`     |
| Website links waiting, on and off               | `/moderation/websites`                         |
| Pictures waiting on posted events               | `/moderation/pictures`                         |
| An organisation's visits, money and attendance  | `/analytics` (organisation and event views)    |
| Every event's visits, for the Desi-Event team   | `/analytics/events`                            |
| The counted way out to an organiser's website   | `/events/[slug]/website` (a 302, never a page) |

**The code panel carries a letter only for organiser invitations.** In
`MANUAL` delivery the organiser-invitation code is shown once with a
ready-to-send message (subject, body with the code on its own line, and the
join page's address) that the administrator copies into their own email.
Team-invitation and ticket-transfer codes are shown on their own. In `EMAIL`
delivery each screen says the code was emailed and shows nothing. No screen
says the site "sends no email".

**Nobody is offered what the API refuses.** The team page offers each member
exactly the roles in `roleChoices`; posting roles are explained, not offered
("Roles that create or publish events … are given by the Desi-Event team").
The organiser area offers "Accept an organiser invitation" and "Join a team
with an invitation code" to an account without an organisation.

**The website link says who decided.** The editor's website field shows the
switch's state under it in the organiser's words (`organiserSummary`), ending
"Only the Desi-Event team can turn this link on or off." The administrators'
panel shows the current and the decided address, both opening in a new tab
with "(opens in a new tab)", and asks for "I have opened this address and it is
the organiser's own site" before turning it on. The public link says "Opens
{host}, which Desi-Event does not run. Desi-Event counts the visit without
recording your address, browser or account."

**Analytics say what they are.** "Demonstration figures" when any summed row
came from the development seed; "These figures run to {time} UTC on {day}" when
fresh; an alert when the roll-up has not finished for over two hours; and "No
visits have been added up on this site" before it has ever run. No sentence
names how often figures change. The chart has a text alternative ("Visits per
day, as a table"), and the counting notes say who is not counted.

**Deleting is previewed, confirmed and explained.** The delete dialog reads the
server's preview and says what will happen — removed, cancelled and refunded,
or only taken down — from the counts, never guessed. It asks for the event's web
address typed back (paste allowed; the address is shown in a `<code>`
element), a reason, and a second factor. For a finished event nobody was
checked in at, it asks, as a radio group, whether it took place. Restore (the
Desi-Event team only) says "It comes back paused: the organiser reopens
sales." for an event that was on sale. Cancelling one night has its own dialog
with the count of orders it touches.

**Every reason box says where the reason goes**: "Shown with the event's
history. Do not include anybody's personal details."

**Editing somebody else's event looks different.** A banner headed "Editing as
the Desi-Event team" names the organisation ("This is {organisation}'s
event."), the reason and when the sitting ends, with "Confirm it's you" and
"Stop editing"; when a write needs the second factor again, the editor pauses
autosave and asks "Confirm it's you to keep editing. The Desi-Event team
confirms every 10 minutes while editing someone else's event." The organiser
sees the team's changes as "by the Desi-Event team", with the reason.

**Imported events say where they come from.** The ticket box says the tickets
are sold on Sulekha, shows the prices as Sulekha listed them on the date they
were read (or that no price is listed), and offers "Buy tickets on Sulekha"
through the counted redirect. Cards read "On Sulekha from $x", "Free, on
Sulekha" or "On Sulekha". The page says "Presented by" the organiser. A listing
without an end time shows only its start.

Every new surface is built to WCAG 2.2 AA: headings and labelled fields in
every dialog, an error summary with links, targets at least 44 px, polite live
regions, and focus returned to the opener. Their component tests check this;
the browser accessibility sweep cases for these screens belong to the end-to-end
stage that follows this documentation, and were not run when it was written.

## Booking fees, referral codes and paying at the venue — 2026-10-09

ADRs 0016 and 0017. What each screen says, and the rules behind it.

### Checkout

- **The choice.** When an event takes payment at the venue, the checkout offers
  "Pay by card now" and "Pay at the venue". Choosing the venue explains what is
  paid now (the booking fee, simulated, or nothing when a referral code removed
  it) and what at the door (the ticket price). Signing in is required for it.
- **The button says what happens:** "Pay {total} (simulated)", "Pay booking fee
  {fee} (simulated)", or "Book now — pay {amount} at the door" when nothing is
  paid online.
- **Referral code.** A "Referral code" field, separate from the promo code box,
  with "Apply referral code" and "Remove referral code". The code is never
  echoed back; a refusal is one sentence for every reason, and after too many
  wrong codes "Too many referral codes were tried. Wait a few minutes, then try
  again." keeps the last good figures. A code that stops applying between the
  quote and the order brings the fee back and asks the buyer to check the new
  total before paying.
- **The summary** names the booking fee as "Booking fee", adds "Booking fee
  waived (referral code)" when a code removed it, and keeps the tax line
  honest: $0.00 for an event in the United States, and no tax at all on tickets
  paid at the venue. The venue choice's hint says "No {tax} is added to tickets
  paid at the venue.", that the organiser or Desi-Event can cancel a ticket not
  paid for, keeping its booking fee, and that whoever holds a passed-on ticket
  pays at the door.

### What buyers read afterwards

- **The order page** derives its words from the tickets: booked and to pay at
  the door, paid at the door, passed on ("Passed on — the new holder pays at the
  door", and per row "Passed on — its new holder pays {amount} at the door"
  from the API's own figure), cancelled ("Cancelled — not paid at the door",
  with who cancelled, the reason, and the booking fee kept or "Nothing was paid
  online"). The tax row is named for the place — "Sales tax" (US), "GST"
  (India), "HST" (Ontario) — and says "No {tax} is added to tickets paid at the
  venue."; "Tax" stays only where the order does not say where the event is.
- **The wallet and the ticket page** show "Pay at the door: {amount}" on a
  ticket that owes, and "Withdrawn — this ticket no longer works at the door"
  on a withdrawn one, never the raw word "CANCELLED". A ticket cancelled unpaid
  shows "Cancelled — not paid", who cancelled it and when (never by name), and
  "Reason given: “{reason}”" — whoever holds it, so somebody it was passed to,
  who has no order page, reads the reason there (updated 2026-10-13). A holder
  who paid at the door for a passed-on ticket is told on its page that the
  money is with the organiser. The wallet's "Reason given:" line under a
  withdrawn ticket shows only an organiser's own words, never a marker the
  server wrote (a refund's, a cancelled night's, a deleted event's).
- **Passing a ticket on** tells the sender before sending that the new holder
  pays the door price; the one-time code panel says "Tell them: whoever holds
  this ticket pays {amount} at the door."; the receiver is told again after
  accepting.

### The door

The payment card says how much to take for the ticket presented, and the
button "Payment taken: {amount} — admit" records it and lets the ticket in in
one step; the result says "Payment recorded: {amount}", and only when the
lookup said the ticket owed. Group passes total the ticked tickets in "Payment
to take". A ticket cancelled unpaid shows "Cancelled — not paid".
`docs/CHECK_IN.md`, "Paying at the door — 2026-10-09", has the rest. The door's
"Recent" list shows the times of lookups made on that device during the visit,
in the device's own time zone; it is never saved, and the stewards are at the
venue.

### Organisers

- **"Booking fee and payment"** on the organiser's event page shows the event's
  booking fee and whether it can be paid at the venue, with the history of
  changes, the administrator's name and reason. Read-only.
- **"Payments at the venue"** (`/organizer/events/[id]/venue-payments`,
  `finance:view`, a second factor within fifteen minutes): payments taken at
  the door, bookings still unpaid with "Cancel unpaid tickets in booking
  {reference}" for owners and administrators, cancellations, and after the event
  "Not paid by the end of the event".
- **The cancel dialog** pre-selects every unpaid ticket with a native tri-state
  "Select all {n} unpaid tickets", says what is kept (the booking fee paid
  online for them, or nothing when none was paid), asks for a reason shown to
  the buyer and holders, and after cancelling says whether the freed places are
  on sale again (all, some or none), telling an organiser whose event is paused
  or sold out to open sales on the event page to sell them.
- **Times are in the event's time zone**, labelled: "Oct 11, 2026, 2:00 PM
  CDT". The payments page, the booking-fee panel, the unpaid-bookings list, the
  cancel dialog, the administrators' bookings page and the lifecycle panel's
  history all use it.

### Administrators

- **The event's "Booking fee and payment" section** on `/admin/events/[id]`
  opens with "Buyers pay a booking fee (the platform fee) on every ticket. It is
  Desi-Event's money, not the organiser's." Setting the fee or the switch takes
  a reason and a second factor; "This event has no booking fee." when both
  numbers are 0.
- **Referral codes** (`/admin/referral-codes`): "Make referral code" with a typed
  code or "Generate a code for me", each code shown once after making it with
  "Copy code"; the list stacks into cards at narrow widths, finds a code only
  among the rows on the page, and shows uses placed, given back and now.
  Editing keeps a chosen-events scope as it is when the answer named fewer
  events than the code holds. **The expiry is typed and shown in UTC**,
  labelled "Expires (optional, UTC)", with a hint saying how far UTC is from New
  York, as every other administrator screen writes times in UTC.
- **"Booking fee refunds"** (`/admin/fee-refunds`): "Find order" by reference,
  then "Refund {amount} booking fee (simulated)". A refund whose provider has
  not answered links to its refund page only for accounts that hold
  `finance:view`; others read "The booking fee refund has not settled".
- **"Bookings waiting to be paid at the door"** (`/admin/events/[id]/venue-bookings`):
  any event's unpaid bookings, with no buyer or attendee names, and the same
  cancel dialog.

### "Busy, try again"

A refusal is read as "busy, try again" only when the API answers 503
`SERVICE_UNAVAILABLE` with `Retry-After` — the answer every bounded wait gives
(setting the fee, setting pay-at-the-venue, cancelling unpaid tickets, refunding
a fee). SPEC3 §12.3 and SPEC3-XI XU10 name that refusal `TRY_AGAIN`; the built
API sends `SERVICE_UNAVAILABLE`, and this document records the built name.
`TRY_AGAIN` remains for two answers only: a 503 from making a referral code
after five generated codes in a row were taken, which the form shows with the
API's sentence, and a 409 from a retryable database conflict, which reads as a
conflict.
