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
| Organiser profile      | `/organizers/[slug]`                                |
| Venue page             | `/venues/[slug]`                                    |

**Refunds, reconciliation detail and ticket transfer are API-only in this
cycle.** There is no screen for them, they are exercised by request-level
suites, and no document here describes a page for them. Listing a surface that
does not exist is how a coverage claim becomes untrue.

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
reads `OVERDUE` as a word as well as in red. A status is a word.

**Nothing is measured in "tests".** Unit tests and browser journeys are
different evidence and are counted separately everywhere in this repository.

---

## Accessibility: what was run

`axe-core` via `@axe-core/playwright`, **WCAG 2.1 A and AA, with no disabled
rules**. There is no exclusion list; the only selector exclusion is Next's own
development overlay, which is not the site's markup and is not shipped.

Where the scanner found something, the component was fixed. Two real failures
came out of the Phase 2 markup:

- a definition list whose hint text sat outside its `<dd>`;
- a scrollable region that could not be reached by keyboard
  (`scrollable-region-focusable`), fixed with `tabIndex={0}` and a
  `role="region"` with an accessible name.

### The sweep: 22 browser cases

`apps/web/e2e/accessibility-sweep.spec.js`, run under
`playwright.sweep.config.js`:

- **Five screens × three viewports = 15 clean scans.** The organiser event
  list, the seven-step editor, the public event page, the finance overview and
  the operations board, at **320**, **768** and **1280** CSS pixels.
- Reflow at **200% zoom** with no sideways scrolling.
- Nothing left permanently invisible under `prefers-reduced-motion`.
- The editor reachable and operable **by keyboard alone**.
- A visible focus indicator on **every** focusable control.
- The moderation queue and decision screen scanned.
- Touch targets large enough to hit.
- The finance screen stating what produced its figures before any of them.

**320, not 360.** WCAG 1.4.10 names 320 CSS pixels as the reflow width, and a
layout that only works at 360 fails the criterion for anybody on a small phone
or a zoomed desktop.

### Covered, and not

Covered: every Phase 2 screen that exists, in the list above.

Not covered, because no such screen exists: a reconciliation detail page, a
refund decision page, a ticket transfer page. Naming them as swept would report
a coverage this suite does not have.

---

## Browser journeys, counted honestly

Five Playwright configurations, because they need different fixtures and
different servers. Case counts are from `--list`:

| Configuration                     | Cases   | What it covers                                                                                     |
| --------------------------------- | ------- | -------------------------------------------------------------------------------------------------- |
| `playwright.config.js` (default)  | 118     | Public catalogue, event, venue, checkout, filters, focus, reduced motion, structural accessibility |
| `playwright.events.config.js`     | 20      | The event lifecycle end to end                                                                     |
| `playwright.sweep.config.js`      | 22      | The responsive and accessibility sweep                                                             |
| `playwright.organizer.config.js`  | 13      | Venue maps and versions                                                                            |
| `playwright.production.config.js` | 19      | Not-found behaviour in a production build                                                          |
| `playwright.refusals.config.js`   | 4       | Four product refusals (below)                                                                      |
| **Total**                         | **196** |                                                                                                    |

**196 browser cases is not "196 of the required journeys".** Passing a number of
Playwright cases is not the same as passing a specific list of required
journeys, and this document does not use the first as evidence for the second.
The per-journey status lives in `PHASE2_STATUS.md` and nowhere else.

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
