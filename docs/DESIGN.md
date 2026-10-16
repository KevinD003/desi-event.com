# The Desi Events design system: Poster House+

The best poster on the community-centre noticeboard, set with modern restraint.
Bollywood hand-painted film posters, desi concert flyers and mela banners share
one vernacular: huge compressed type on flat ink plates, with gold used like
foil. The site borrows that vernacular and stops there. It is typographic, flat
and confident, rooted in print rather than in app chrome, and it belongs to the
whole calendar (comedy, concerts, Durga Puja, Diwali, Holi, garba, bhangra,
sangeet, Bollywood nights, classical, family days), not to one festival.

This document describes the system as it is built. Where it names a file, that
file is the source of truth and this page explains it.

| Layer                                       | Where                                                                  |
| ------------------------------------------- | ---------------------------------------------------------------------- |
| Tokens (colour, type, shape, depth, motion) | `packages/config/src/tailwind.css`                                     |
| App-wide base styles                        | `apps/web/src/app/globals.css`                                         |
| Primitives                                  | `packages/ui/src` (`@desi-event/ui`, `/classes`, `/icons`)             |
| Motion components                           | `apps/web/src/components/motion.jsx`                                   |
| App furniture                               | `apps/web/src/components/` (`workspace-kit.jsx`, `link-classes.js`, …) |
| Brand files                                 | `docs/BRAND.md`                                                        |

---

## 1. Colour

### The kit is the anchor

The four colours of the brand kit (`docs/BRAND.md`) are declared as ramps and
every semantic token is built around them. The kit swatch is the named step.

| Ramp            | Steps           | Kit swatch                         | oklch (kit step)   |
| --------------- | --------------- | ---------------------------------- | ------------------ |
| `brand-magenta` | 300 500 600 700 | Magenta `#B0004A` = 600            | `0.485 0.194 7.9`  |
| `brand-purple`  | 800 900 950     | Royal Purple `#32105E` = 900       | `0.28 0.127 297.1` |
| `brand-gold`    | 300 400 500     | Gold `#D4A529` = 500               | `0.746 0.141 86.1` |
| `brand-orange`  | 400 500         | Celebration Orange `#F47A1F` = 500 | `0.708 0.176 50.6` |

A component never writes `bg-brand-gold-400`: `semantic-classes.test.js`
forbids the ramps by name, exactly as it forbids Tailwind's palette. Components
speak only the semantic layer below, which is what the contrast test measures.

### Roles

| Role             | Token(s)                                                                   | Value (poster register)                        | Use                                                                                           |
| ---------------- | -------------------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Page             | `page`, `surface`, `surface-raised`                                        | white                                          | The ground. Never cream or ivory. A card is told from the page by its keyline, not a tint.    |
| Subtle / sunken  | `surface-subtle`, `surface-sunken`                                         | faint purple-grey, one step deeper             | A band inside the page; a well (camera frame, code, quiet strip).                             |
| Plate            | `surface-inverse`                                                          | the kit's Royal Purple exactly                 | The hero band, a featured strip, the footer.                                                  |
| Ink              | `ink`, `ink-muted`, `ink-subtle`                                           | deepened purple, `0.24 0.11 300`               | Three levels of text, no more.                                                                |
| Ink on the plate | `ink-inverse`, `ink-inverse-muted`                                         | white, lavender                                | Never grey on a coloured field.                                                               |
| Action           | `action-primary(-hover,-ink)`                                              | the kit's Magenta, white text                  | The one thing a screen most wants done.                                                       |
| Accent           | `accent`, `accent-strong`, `accent-soft`, `accent-line`                    | magenta                                        | The 2px brand rule (decorative `accent`), links (`accent-strong`).                            |
| Foil             | `highlight` + `highlight-ink`, `accent-inverse`                            | gold `brand-gold-400`                          | Owned, verified, VIP; headings and links on the plate. Never text on a light ground (2.3:1).  |
| Tonight          | `celebration`                                                              | the kit's orange                               | "Tonight", "live", "doors open" plates, in `highlight-ink`. Never white text, never a status. |
| Secondary        | `accent-secondary(-soft)`                                                  | the purple at text strength                    | Secondary chips, a poster's category.                                                         |
| Status           | `status-{success,pending,warning,danger,refusal,info,mock,neutral}(-soft)` | green, berry, amber, vermilion, purples        | Always with an icon and a word. `refusal` is not `danger`; `mock` is its own state.           |
| Availability     | `availability-{open,limited,closed}(-soft)`                                | green, amber, purple grey                      | On sale, "Only N left" (the API's own words, at 25 or fewer), nothing to buy.                 |
| Seats            | `seat-*`                                                                   |                                                | Each state has a fill, an ink and a non-colour cue.                                           |
| Rail             | `opsnav-*`                                                                 | white, purple tint, magenta marker             | The workspace navigation.                                                                     |
| Ticket           | `ticket-paper`, `ticket-ink`                                               | white with a hint of card stock                | The pass as an object. The QR itself is always black on white.                                |
| Door verdicts    | `door-admit`, `door-refuse`, `door-warn` (+ `-ink`)                        | green / red with white, orange with purple ink | Full-width solid bands read at arm's length, with icon and word.                              |
| Scrim            | `scrim`                                                                    | deepest purple, used at `/60`                  | Behind a dialog.                                                                              |
| Focus            | `focus`                                                                    | a pink between magenta and light               | One outline everywhere (section 6).                                                           |
| Charts           | `chart-views`, `chart-visitors`                                            | purple bars, orange line                       | Marks only.                                                                                   |

### Three registers

A component never asks which register it is in; the register redefines the
variables and every utility follows.

- **Poster** (the theme itself): public discovery, event pages, checkout,
  sign-in. Colour is committed: magenta and purple plates own whole regions.
- **Quiet Courtyard** (`[data-register='courtyard']`): every signed-in area.
  A faintly purple off-white page, cool lines, and a Royal Purple accent and
  primary action. Colour is restrained: it means a status or the one action.
- **Showtime** (`[data-register='door']`): the door's own region. A dark
  purple ground for a phone at a dim entrance, light lavender ink, gold for the
  primary action and the focus ring, every status redrawn as a light word on a
  dark chip, `color-scheme: dark`. Composed, not inverted: each name a door
  component can render has its own dark value.

The root layout sets `data-register` on `<body>` from the request path, and
`components/register-sync.jsx` keeps it in step across soft navigations. The
door register is applied by the door screen to its own region.

### Measured, not eyeballed

`packages/config/tests/token-contrast.test.js` parses the stylesheet and
measures every declared pairing in all three registers at WCAG 2 AA (4.5:1
text; 3:1 focus, boundaries and chart marks) with 0.1 of headroom. A new token
that will be text, a ring or a ground gets a pairing there. The test also pins
the kit anchors, the plate equal to the kit purple, the action next to the kit
magenta, and the dark grounds of the door.

---

## 2. Type

| Face                                                                | Package                                    | Job                                                                                                                                                                              |
| ------------------------------------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Anek Latin** (Ek Type, Mumbai), variable width 75–125% and weight | `@fontsource-variable/anek-latin/wdth.css` | Display and headings, set bold and condensed like a poster title. Sister families exist for Devanagari, Gujarati, Gurmukhi and more, for event titles in their own script later. |
| **Mukta** (Ek Type), 400 500 600 700, Latin                         | `@fontsource/mukta/latin-*.css`            | Everything read at text size.                                                                                                                                                    |

Both are self-hosted from npm and SIL OFL; `self-hosted-fonts.test.js` pins the
exact stylesheets imported and forbids every font service.

**Scale** (`--text-*`, fluid between 375 and ~1280px, in rem):

| Step      | Size                     | Leading | Use                                       |
| --------- | ------------------------ | ------- | ----------------------------------------- |
| `display` | 44 → 96px (ceiling 6rem) | 0.95    | The poster title. One per page.           |
| `h1`      | 36 → 60px                | 1.0     | Page title.                               |
| `h2`      | 28 → 40px                | 1.08    | Section title.                            |
| `h3`      | 24px                     | 30px    | Sub-section, card title.                  |
| `title`   | 18px                     | 26px    | Workspace panel and section titles.       |
| `body`    | 17px                     | 28px    | Reading text.                             |
| `label`   | 15px                     | 20px    | Control labels, nav entries, table cells. |
| `caption` | 13px                     | 18px    | Metadata and helper text. The floor.      |
| `micro`   | 12px                     | 16px    | A chip's word only.                       |

**Setting.** Headings are Anek at 80% width (h1), 86% (h2) and 92% (h3 and
`.font-display`), bold. Tracking tightens with size and never past -0.02em
(`--tracking-display`); `type-scale.test.js` holds the ceiling, the floor, the
order of the steps and a leading for each. Headings balance (`text-wrap:
balance`), paragraphs wrap pretty. `time`, `td`, `th`, `data` and `output` set
tabular figures; use `tabular-nums` for any other price, time or count. Condensed
type is for 20px and up; never set body text condensed. No italic display (Anek
has none), no accent word in another face or colour.

---

## 3. Space and layout

- A 4px base. Section gaps clearly exceed internal gaps: Persuade pages
  120–220px between sections on a desk and 72–112px on a phone; Operate pages
  16–24px inside a panel and 32–48px between regions.
- Two or three left edges per page. Centre at most one moment.
- `--container-content` (75rem) for Operate and reading columns; posters and
  colour fields may run to the edges, with only the text measure (45–75ch)
  constrained.
- The phone is its own composition: 16px gutters, one dominant thing on the
  first screen, primary actions in the thumb zone, 44px targets, no sideways
  scroll at 320px.
- Repeated modules only where the content is a list: the event listing, a
  schedule, the wallet. Equal-card grids are not page structure.

## 4. Shape and depth

| Token               | Value                      | Use                                                               |
| ------------------- | -------------------------- | ----------------------------------------------------------------- |
| `rounded-plate`     | 4px                        | Poster plates, key caps, skeleton bars.                           |
| `rounded-control`   | 10px                       | Buttons, inputs, menus' entries, toasts.                          |
| `rounded-card`      | 16px                       | A card, only where a card is the right object; popovers, dialogs. |
| `rounded-full`      |                            | Chips and badges.                                                 |
| `shadow-card`       | a 1px ink keyline at 8%    | A card at rest. Flat.                                             |
| `shadow-card-hover` | keyline + soft offset      | A card under the pointer.                                         |
| `shadow-control`    | 1px                        | A control's seat.                                                 |
| `shadow-floating`   | keyline + 12px offset blur | Menus, popovers, tooltips, sheets, toasts.                        |
| `shadow-dialog`     | deeper offset blur         | Dialogs.                                                          |

Shadows are tinted with the ink, always have an offset and a soft blur, and are
only for things that float. No glows, no glass on cards, no gradients (a scrim
under text on a photo is the only exception). `theme.test.jsx` pins both sets
exactly, so a new radius or shadow is a decision written down.

---

## 5. Motion

**Grammar:** mechanical and print-like. Things slot into place on one axis,
with a hard ease-out; no bounce, no blur, no scale from zero.

| Token              | Value                             | Use                                                        |
| ------------------ | --------------------------------- | ---------------------------------------------------------- |
| `--duration-fast`  | 120ms                             | Press, colour, small state changes.                        |
| `--duration-base`  | 180ms                             | Menus, popovers, tooltips, hover.                          |
| `--duration-slow`  | 250ms                             | Entrances, dialogs. The ceiling for interface feedback.    |
| `--duration-sheet` | 400ms                             | A sheet sliding from an edge.                              |
| `--duration-page`  | 300ms                             | A view transition between pages.                           |
| `--ease-standard`  | `cubic-bezier(0.2, 0, 0, 1)`      | Existing transitions.                                      |
| `--ease-out`       | `cubic-bezier(0.23, 1, 0.32, 1)`  | Anything entering or leaving (also Tailwind's `ease-out`). |
| `--ease-in-out`    | `cubic-bezier(0.77, 0, 0.175, 1)` | Something moving or morphing on screen.                    |
| `--ease-drawer`    | `cubic-bezier(0.32, 0.72, 0, 1)`  | Sheets and drawers.                                        |

`motion.test.jsx` holds `DURATION` (120–250ms) and `DURATION_EXPRESSIVE`
(sheet and page, above 250 and at most 500ms) equal to the tokens, under
separate bounds.

**How things move** (`apps/web/src/components/motion.jsx`):

- **Entrances are CSS.** `FadeIn` and a `Stagger trigger="mount"` render plain
  markup marked `data-motion="enter"`; the theme rises it 12px over 250ms
  inside `prefers-reduced-motion: no-preference`. Nothing is inlined by the
  server, so the hero heading (the LCP text) paints with the first frame.
  Delays come in 40ms steps (`data-motion-delay`), never as inline styles.
- **Reveals never leave a blank band.** `Reveal` is visible as sent; only
  after hydration, and only when below the fold, does it hold itself 12px low
  and transparent until an IntersectionObserver (threshold 0) sees it.
  Reduced motion, no observer, no scripting and print never hide it.
- **Framer Motion is for gestures and springs**, loaded through `LazyMotion`
  (`domAnimation`, strict) with `m` components under `MotionConfig
reducedMotion="user"`. Today: the poster zoom (1.04 inside its own frame).
  Cards do not lift.
- **Dialogs, sheets, popovers** enter by CSS: `@starting-style` (Tailwind's
  `starting:`), scale 0.96 (dialog) or 0.95 (popover, from the trigger's
  `--transform-origin`) plus opacity; sheets translate 8px from their edge.
- **Press:** `scale(0.98)` under `motion-safe:` on buttons and button links.
- **Hover** only changes colour or a poster's zoom, only on a fine pointer, and
  never changes weight.
- **Nothing animates on keyboard-frequency actions** (tab switches in a table,
  the next scan at the door, focus).

**Reduced motion** keeps the global rule: every transition and animation is cut
to 0.01ms, `[data-motion]` is forced to its final state, and every
`::view-transition-*` animation is stopped. The browser sweep depends on all
three; "gentler, not zero" would be a policy change for the owner.

---

## 6. Focus and accessibility

- **One focus indicator:** a 2px outline in `--color-focus`, offset 2px
  (`focus-visible:outline-2 focus-visible:outline-offset-2
focus-visible:outline-focus`). It survives forced-colours mode; a box-shadow
  ring does not. The only ring left is the seat on the seat map, which the
  sweep pins as a box-shadow; `apps/web/src/focus-outline.test.js` fails on any
  other.
- 44px targets for every control (`sm` controls grow to 44px under a finger).
- Colour is never the only carrier: a status is a word and an icon; a verdict
  is a word, an icon and a band.
- Live regions are polite. `<Alert urgent>` is reserved for the door and once
  per checkout (`live-region-policy.test.js`); toasts are polite and never take
  focus.
- Exactly one `h1`, `banner`, `main` and `contentinfo` per page; the skip link
  is the first Tab stop.

---

## 7. Components (`@desi-event/ui`)

| Component                                                                                                                                      | Notes                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`                                                                                                                                       | `primary`, `secondary`/`outline`, `ghost`, `danger`, `accent`, `ink`, `inverse`; `sm`/`md`/`lg`; `loading` is a real state.                                                                     |
| `ButtonLink`                                                                                                                                   | An anchor (or the router's `Link` via `as`) drawn exactly like the button. Navigation is a link, never a button.                                                                                |
| `buttonClasses()`, `textLinkClasses()`                                                                                                         | The class lists, pure, at `@desi-event/ui/classes` for Server Components. `link-classes.js` and the workspace kit's `PRIMARY_LINK` etc. are aliases over them.                                  |
| `TextLink`                                                                                                                                     | Underlined running-text link: `accent`, `ink`, `inverse`.                                                                                                                                       |
| `Card`, `Badge`, `Alert`, `EmptyState`, `Input`, `Select`, `Textarea`, `Label`, `FormField`, `Spinner`, `StatusIcon`, `VisuallyHidden`, `Tabs` | As before, in the new tokens.                                                                                                                                                                   |
| `Modal`                                                                                                                                        | Hand-rolled focus trap, scroll freeze with a stable scrollbar gutter, CSS entrance, drawn close icon. Only for a task that needs protected focus; destructive confirmations are inline regions. |
| `Sheet`                                                                                                                                        | In place, never portalled: the header menu's sheet must stay inside the banner. Focus in on open, back to the trigger on Escape.                                                                |
| `Popover`, `Menu`, `Tooltip`                                                                                                                   | Base UI behind this library's API; portalled; origin-aware; Menu entries are 44px `menuitem`s and destinations render as real links. Tooltip only repeats a control's accessible name.          |
| `Toaster`, `toast()`                                                                                                                           | Sonner, mounted once in the root layout. Non-critical confirmations only ("Copied", "Saved"); never a code, a token or an outcome a reader must act on.                                         |
| `Stat`                                                                                                                                         | A figure with its label, tabular, optional roll on a real change (off under reduced motion, hidden from screen readers mid-roll).                                                               |
| `Skeleton`                                                                                                                                     | `text`, `title`, `block`, `circle`, `button`, `lines`, `rows`; matches the shape of what is coming.                                                                                             |
| `Kbd`                                                                                                                                          | A key cap in running text.                                                                                                                                                                      |
| `SegmentedControl`                                                                                                                             | Native radios in a fieldset: keyboard and form submission for free.                                                                                                                             |
| `Icon`                                                                                                                                         | The self-drawn family, at `@desi-event/ui/icons`.                                                                                                                                               |

`cn()` is `clsx` plus `tailwind-merge` configured with this theme's type
steps, radii, shadows, easings and tracking, so a caller's class wins a
conflict and `text-h2` survives beside `text-ink`.

### Icons

One family: a 24 grid, 1.75 strokes, round caps and joins, `currentColor`,
strokes only. Decoration by default (`aria-hidden`); give `label` only when the
icon stands alone. The operational set covers navigation, actions, status,
tickets, the door and money; every event category the API has its own glyph
(mic, dandiya sticks, a Bollywood star, ghungroo, a comedy bubble, film, a
kandil, a thali, rings, a diya, theatre curtains, a notebook, a network, a
cricket bat). `CategoryIcon` maps them, and a test holds the map equal to
`EVENT_CATEGORIES`. No emoji or unicode glyphs as icons, anywhere.

---

## 8. Per-surface modes

| Surface                                                                                       | Mode                                       | Register                  | What carries the brand                                                                                                          |
| --------------------------------------------------------------------------------------------- | ------------------------------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Home, `/events`, event page, categories, cities, organisers, venues                           | Persuade (the event page leans Experience) | Poster                    | Purple and magenta plates own regions; one plate moment per page; the working action (search, tier choice) on the first screen. |
| Checkout, seats, sign-in, register                                                            | Operate inside the poster frame            | Poster                    | Clarity: fee-transparent totals, the simulated-payment notice once per screen.                                                  |
| Tickets and account                                                                           | Operate with one Experience moment         | Courtyard                 | The ticket as an object on `ticket-paper`, with its stub.                                                                       |
| Organiser, admin, super admin, moderation, finance, operations, analytics, privacy, retention | Operate                                    | Courtyard                 | Type, palette and density; status colour; gold marks super-administrator authority.                                             |
| The door (check-in)                                                                           | Operate, high frequency                    | Showtime                  | Dark ground, gold brackets and actions, full-width verdict bands.                                                               |
| API docs, limitations, policy pages                                                           | Read                                       | Poster frame, calm column | The masthead and method plates; a 60–75ch column.                                                                               |

---

## 9. Do and don't

**Do**

- Use the semantic tokens; add a pairing to the contrast test for any new
  text, ring or ground.
- Use `ButtonLink` for navigation that looks like an action, `Button` for an
  action.
- Put the word beside the icon and the colour.
- Keep money, times and counts in tabular figures.
- Write human, specific copy in North American English; say plainly, once per
  screen, that payments are simulated.

**Don't**

- Write `oklch()`, hex or palette classes in a component (the literal-class
  test fails), or `bg-brand-*` (also forbidden).
- Use gradients, glows, glass on cards, resting shadows, eyebrows above
  headings, equal-card grids as page structure, or hover lift.
- Animate from `scale(0)`, ease in, exceed 250ms for interface feedback, or
  put `data-motion` on an element with a static transform.
- Portal the header sheet, add a `role="alert"`, or put decoration inside a
  QR code's SVG.
- Use em dashes, "unlock", "seamless", "elevate", "coming soon" or invented
  counts and urgency in visible copy.

---

## 10. The guards

| Test                                                                  | Holds                                                                                                                  |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `packages/config/tests/token-contrast.test.js`                        | Every pairing, three registers, AA + 0.1; kit anchors; the door is dark.                                               |
| `packages/config/tests/semantic-classes.test.js`                      | No palette or ramp classes, no hex, no `oklch()` in components; tokens-only hexes equal a token.                       |
| `packages/config/tests/self-hosted-fonts.test.js`                     | Anek Latin and Mukta, file by file, from npm; no font service.                                                         |
| `packages/config/tests/type-scale.test.js`                            | 6rem ceiling, -0.02em floor, 13px floor, step order, leadings.                                                         |
| `packages/ui/src/theme.test.jsx`                                      | Every class a primitive renders names a declared token; shadow and radius sets exact; Button's press, focus and sizes. |
| `packages/ui/src/cn.test.js`                                          | Configured merging, scales equal to the stylesheet.                                                                    |
| `apps/web/src/components/motion.test.jsx`, `motion-viewport.test.jsx` | CSS-first entrances, reveals that never hide content, durations and curves equal to tokens.                            |
| `apps/web/src/focus-outline.test.js`                                  | No box-shadow focus ring outside the seat.                                                                             |
| `apps/web/e2e/*`                                                      | Reduced motion, the focus walk, the header contract, landmarks, axe at four widths.                                    |
