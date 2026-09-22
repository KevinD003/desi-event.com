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
| Event editor (7 steps) | `/organizer/events/[id]`                            |
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

The last revision of this document said refunds, reconciliation detail and
ticket transfer were API-only and that no page for them existed. **All three
exist now**, along with organiser analytics and an invitation screen, and each
is in the sweep. The sentence stayed accurate for exactly as long as it was
true, which is the property that matters more than which way it reads.

---

## The principles the markup actually follows

**A refusal explains itself.** "You cannot publish this event yet" names the
reason — unverified organiser, draft map, missing session — and where to go.
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

**An absence explains which kind of absence it is.** "No refunds yet" and "the
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
different servers. Case counts are from `--list`:

| Configuration                     | Cases   | What it covers                                                                                     |
| --------------------------------- | ------- | -------------------------------------------------------------------------------------------------- |
| `playwright.config.js` (default)  | 118     | Public catalogue, event, venue, checkout, filters, focus, reduced motion, structural accessibility |
| `playwright.sweep.config.js`      | 53      | The responsive and accessibility sweep                                                             |
| `playwright.detail.config.js`     | 37      | The five detail surfaces, as behaviour rather than as markup                                       |
| `playwright.events.config.js`     | 20      | The event lifecycle end to end                                                                     |
| `playwright.production.config.js` | 19      | Not-found behaviour in a production build                                                          |
| `playwright.organizer.config.js`  | 13      | Venue maps and versions                                                                            |
| `playwright.refusals.config.js`   | 4       | Four product refusals (below)                                                                      |
| **Total**                         | **264** |                                                                                                    |

**264 browser cases is not "264 of the required journeys".** Passing a number of
Playwright cases is not the same as passing a specific list of required
journeys, and this document does not use the first as evidence for the second.
The per-journey status lives in `PHASE2_STATUS.md` and nowhere else.

> **Update — 2026-09-21.** The sweep went 42 → 53 and the detail suite 26 → 37,
> for the privacy and retention screens; the total is 264. Every figure in this
> table is from `npx playwright test --config <file> --list`, run against the
> working tree rather than remembered — which is the only way a count in a
> document stays true, and is why the three unchanged rows were re-run too.

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
