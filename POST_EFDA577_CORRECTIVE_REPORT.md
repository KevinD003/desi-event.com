# Corrective verification cycle — post-`efda577`

**Status: Phase 1 is COMPLETE, as of the closure cycle that followed this
one.** Every defect listed below is fixed and tested, and every code-owned
verification command passes. This report described Phase 1 as PARTIAL on the
grounds that production payments remain prohibited; that judgement has been
corrected. Production card processing was never a Phase 1 acceptance criterion,
so its absence is a Phase 2 prerequisite rather than a Phase 1 failure —
provided the absence is enforced rather than assumed, which is what
[the closure cycle](#the-closure-cycle-after-7732960) added and proved.

|                       |                                            |
| --------------------- | ------------------------------------------ |
| Starting commit       | `efda5778699ec66908391209c416bb75e1e0a6ca` |
| Ending commit         | `5fedb03`                                  |
| Branch                | `claude/desi-event-js-stack-gb4uqe`        |
| Working tree at start | clean, in sync with `origin`               |
| Working tree at end   | clean, pushed                              |
| Commits               | 8                                          |
| Diff                  | 165 files, +6,943 −1,549                   |

## What was examined, and what was actually wrong

Each defect below was reproduced against the code at `efda577` before being
changed. Where a fix guards a security or correctness property, the test was
run against the vulnerable implementation to confirm it fails, and against the
corrected one to confirm it passes.

---

### 1. Hold release had no ownership check

**Root cause.** `DELETE /v1/holds/:id` loaded the hold and released it. It never
consulted the caller. `TicketHold` had no owner column, so there was nothing to
consult. The same omission existed in checkout: `resolveHolds` accepted any
hold id supplied in the request body.

**Impact.** Anyone who learned or guessed a hold id could free another buyer's
reservation, or spend it — converting someone else's held inventory into their
own order. Taking a hold is open to anyone, which is correct; releasing one is
not, and was.

**Fix.** Two ownership paths, exactly one per hold:

- an authenticated buyer, recorded from the verified server actor;
- a guest, recorded as the SHA-256 of a 256-bit token returned once at
  creation and never persisted in plaintext.

Enforced by the `ticket_hold_single_owner` check constraint, not application
code alone: a hold with neither owner is releasable by nobody, and one with
both has two authorization paths where the schema promises one.

Release verifies ownership and performs the transition inside one transaction,
so a hold cannot be converted between the check and the write. A missing hold
and one the caller may not touch answer identically, so the endpoint is not an
oracle for which ids exist. An override requires `hold:release_any`, which
`MANAGER` does not have. Actor, mode, request id, timestamp and previous/new
state are recorded — including for denials.

**Files.** `packages/inventory/src/ownership.js` (new),
`apps/api/src/routes/holds.js`, `apps/api/src/routes/orders.js`,
`apps/api/src/lib/audit.js` (new), `packages/permissions/src/capabilities.js`,
`packages/db/prisma/schema.prisma`, `packages/db/scripts/seed.mjs`.

**Schema.** `TicketHold` gains `userId`, `guestTokenHash`, `releasedAt`,
`releasedBy`, `releaseReason`; indexes on `(userId, status)` and
`guestTokenHash`; the single-owner check constraint. Legacy holds are
backfilled with an unguessable digest, so the constraint holds without granting
anyone the ability to release them.

**Tests.** `apps/api/tests/hold-ownership.test.js` — 16 tests covering owner
release, a different authenticated user, guest-versus-guest, anonymous against
an authenticated hold, body `userId` manipulation, an organizer without the
capability, an audited administrative override, non-enumeration, concurrent
release, release racing expiry, replay, checkout spending another buyer's hold,
and the expiry sweep remaining a system action.

**Old-code failure proof.**

```
$ # ownership check disabled, as it was before this cycle
$ npx vitest run tests/hold-ownership.test.js
  × refuses a different authenticated user, without revealing the hold exists
  × refuses one guest presenting another guest token
  × refuses an anonymous request against an authenticated hold
  × ignores a userId in the request body
  × denies an organizer who lacks hold:release_any
  × answers identically for a nonexistent hold and one the caller may not touch
  × records a denial in the audit trail even though the caller cannot tell
  Tests  7 failed | 9 passed (16)

$ # corrected implementation restored
$ npx vitest run tests/hold-ownership.test.js
  Tests  16 passed (16)
```

The working tree was restored byte-for-byte afterwards (`diff -q` against the
saved copy; zero occurrences of the temporary marker).

---

### 2. The payment provider was called inside a database transaction

**Root cause.** Capture ran inside the checkout transaction so that a declined
card left nothing behind. It also meant an external network call was made while
row locks were held, with Prisma's five-second interactive-transaction timeout
running against it.

**Impact.** A gateway that was merely slow would exhaust the timeout, the
surrounding transaction would roll back, and the money would still have moved —
a charge with no order and no tickets against it. The previous cycle widened the
timeout, which makes the window bigger rather than closing it.

**Fix.** Three phases:

1. **Begin** (transaction): validate, lock the tiers, price, reserve inventory,
   write a `PENDING` order and an `INITIATED` payment attempt, commit. Durable
   evidence that a charge is about to be attempted exists before anyone is
   called, which is what makes a process that dies mid-call recoverable.
2. **Capture** (no transaction open): call the provider with no locks held.
3. **Settle or compensate** (short transaction): record the outcome.

Inventory stays reserved across phase 2 — quantity not already covered by a
hold gets one created for it — so nothing in the cart becomes purchasable by
somebody else while the card is authorising.

| Provider says     | Order                  | Payment                             | Inventory                               |
| ----------------- | ---------------------- | ----------------------------------- | --------------------------------------- |
| Captured          | `PAID`, tickets issued | `SUCCEEDED`                         | `quantitySold` moved, holds `CONVERTED` |
| Declined          | `CANCELLED`            | `FAILED` with the code              | Untouched; holds stay `ACTIVE` to retry |
| Nothing (timeout) | stays `PENDING`        | `TIMEOUT`, `reconciliationRequired` | Stays reserved                          |

A timeout is not a decline. A decline means no money moved; a timeout means
nobody knows. Cancelling an order whose charge may have succeeded either strands
a buyer who paid or refunds money never taken, so the ambiguous case is left for
reconciliation.

Fulfilment is driven by the provider webhook, not the browser redirect — a
redirect is a message from the buyer's user agent and can be closed, replayed or
forged. `WebhookEvent` records each delivery against a unique
`(provider, providerEventId)`. Settlement is conditional on the order still
being `PENDING`, which is what stops two workers fulfilling one payment. A
retried checkout carrying the same `Idempotency-Key` resolves to the original
order.

**Files.** `apps/api/src/lib/checkout.js` (new),
`apps/api/src/routes/payments.js` (new), `apps/api/src/routes/orders.js`,
`packages/providers/src/payments.js`, `packages/api-contract/src/routes.js`.

**Schema.** `Payment` gains `idempotencyKey`, `attemptNumber`,
`reconciliationRequired`, `rawProviderStatus`, `settledAt`; `PaymentStatus`
gains `PENDING` and `TIMEOUT`; `Order` gains `idempotencyKey`; `WebhookEvent`
is new.

**Tests.** `apps/api/tests/payment-flow.test.js` — 11 tests. The first counts
open transactions at the moment the provider is called and asserts zero, which
is the property the whole change exists to establish. The rest cover
deterministic success, decline, timeout, webhook settlement, duplicate
delivery, a delayed webhook after a synchronous success, an unknown order, a
provider-reported failure, idempotent retry, and inventory reservation.

---

### 3. Financial correctness

**`allocateProportionally` rejected legitimate orders.** The intermediate
`total × weight` was computed in doubles. Each operand was individually valid to
1e12, but their product overflowed `Number.MAX_SAFE_INTEGER`, putting the real
ceiling at about 9.4e7 minor units. Reproduced: a ₹1,000,000 discount threw
`AMOUNT_OUT_OF_RANGE`. Now computed in BigInt and exact at every supported size.

**Allocation could lose money.** Allocating a non-zero amount across zero total
weight returned zeros — the amount vanished from the breakdown while still
reducing the order total. It throws now.

**The money ceiling exceeded the column.** `MAX_CENTS` was 1e12 while every
money column is a PostgreSQL `integer`. A line total the engine happily computed
was larger than the column it was about to be written to: validation passed and
the `INSERT` failed, turning a bad request into a driver error. The ceiling is
now the column's maximum, and raising it requires widening the columns in the
same change.

**Fixed-amount promos were not denominated.** A "500 off" campaign applied at
face value to any currency, taking CA$500 off a CAD order for a ₹500 campaign.
`PromoCode.currency` is required for `FIXED_AMOUNT` (check constraint), and a
mismatch yields no discount rather than a silent conversion — there is no
exchange-rate policy here, and inventing one would be worse than refusing.

**Inapplicable promos consumed redemption capacity.** A code that was expired,
paused or exhausted yielded no discount but still burned a redemption and was
stamped on the order. Fixed in the previous cycle; the atomic `increment` that
replaced the read-modify-write also closes the concurrency case.

**Refund allocation.** The documented policy is that a refund allocates across
face value, fees, tax and discount in proportion to the original line
subtotals, using the order's stored pricing snapshot. The allocation primitive
and the snapshot are in place and tested; **the refund endpoint itself is not
implemented in Phase 1** and is listed under Phase 2 prerequisites.

**Tests.** `packages/pricing/src/totals.test.js` (allocation at scale, zero
weight, adversarial inputs), `packages/pricing/src/money.test.js` (the ceiling
matches the column), `packages/pricing/src/discount.test.js` (denominated
promos).

---

### 4. Tax was treated as settled policy, and keyed off currency

**Root cause.** Rates were looked up by currency. Tax follows the jurisdiction
of the supply, not the denomination of the price. Separately, the rates were
adopted because the seed and the checkout page already used them — which is
agreement, not verification.

**Impact.** A Toronto event priced in rupees would have been charged Indian GST.
A US event priced in CAD would have been charged Ontario HST. And every buyer
was charged a rate nobody had confirmed.

**Fix.** `packages/pricing/src/tax.js` resolves by country and region, with
Ontario distinguished from Canada generally and a province with no policy of its
own inheriting nothing. Every shipped rate is marked `DEMO`. Production refuses
to price an order under a `DEMO` policy unless `ALLOW_DEMO_TAX_IN_PRODUCTION` is
set deliberately. The United States entry is deliberately zero with a note: sales
tax on admissions varies by state, county and city and cannot be one national
rate.

Orders record a pricing snapshot — fee terms, tax policy, policy version — so
the receipt, a refund and the ledger recompute from what the buyer was quoted
under. The checkout page resolves from the same table by the same rule.

**Schema.** `Order.pricingSnapshot` (JSONB).

**Tests.** `packages/pricing/src/tax.test.js` — including an explicit assertion
that Indian GST is never applied to a US or Canadian event, and that every
shipped rate reads `DEMO`.

---

### 5. Search facets were computed from 48 events

**Root cause.** Filter options were derived from `loadCatalogueOverview()`,
which fetches one page of 48 summaries ordered by start date.

**Impact.** A city whose events all started later than the forty-eighth was not
merely hidden from the select — it was unselectable, and every event in it
unreachable through filtering. Pagination was deciding the filter universe.

**Fix.** `GET /v1/events/facets` counts categories, cities, languages and
formats in the database over every `PUBLISHED` event, with the scope stated in
the response. No table is loaded into application memory. Partial indexes on the
published rows and a GIN index on the `languages` array support the aggregates.

**Tests.** `apps/api/tests/facets-integration.test.js` builds 60 events against
a real database, with the last five in their own city, category and language,
and proves those five appear — the exact case the old implementation missed.
Also covers deterministic ordering and the exclusion of drafts.

---

### 6. Filter changes destroyed keyboard focus

**Root cause.** The listing passed `EventFilters` a `key` derived from the
filter values, remounting the form on every change.

**Impact.** A keyboard or screen-reader user who changed the category select was
dropped at the document body mid-interaction, with no indication of what had
happened. Invisible to a screenshot and to every unit test.

**Fix.** The form reconciles in place. A polite live region reports the new
result count instead of moving focus. "Skip to results" moves focus deliberately
when asked.

**Tests.** `apps/web/e2e/filter-focus.spec.js` — 10 tests asserting
`document.activeElement`, at desktop and mobile widths and under
`prefers-reduced-motion`.

**Old-code failure proof.**

```
$ # remount key restored, as it was before this cycle
$ npx playwright test e2e/filter-focus.spec.js
  ✘ the category select keeps focus after the listing updates (desktop)
  ✘ the search box keeps focus and its caret after submitting (desktop)
  ✘ a keyboard-only visitor can filter without ever touching the mouse (desktop)
  ✘ the category select keeps focus after the listing updates (mobile)
  ✘ the search box keeps focus and its caret after submitting (mobile)
  ✘ a keyboard-only visitor can filter without ever touching the mouse (mobile)
  6 failed, 4 passed

$ # corrected implementation restored
$ npx playwright test e2e/filter-focus.spec.js
  10 passed
```

---

### 7. Smaller defects, each reproduced first

| Defect                                 | Was                                         | Now                                                                |
| -------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------ |
| Title with no ASCII characters         | 500 with an internal message                | 422 naming the field; succeeds when a slug is supplied             |
| Unknown `venueId` in the body          | Foreign key violation reported as a 500     | Resolved first, answers 422                                        |
| Sample catalogue in the browser bundle | All 10 sample events in a client chunk      | Client plumbing split into `lib/api-client.js`; rebuild confirms 0 |
| Policy checker, case sensitivity       | A tracked `Sneaky.TS` passed                | Names and extensions compared in lower case                        |
| `pnpm format:check`                    | Had never passed — Prettier had no config   | Config matches the house style; all files formatted                |
| `pnpm audit`                           | 3 advisories in Prisma's bundled drivers    | Pinned past them; clean                                            |
| `pnpm db:seed`                         | Only worked on a database it created itself | Ids resolved from the database; idempotent on both                 |
| Prisma client after `pnpm install`     | Wiped, next import fails confusingly        | `postinstall` regenerates it                                       |

---

## Findings reconciliation

The full 34-finding ledger is in
[`docs/ADVERSARIAL_REVIEW_FINDINGS.md`](docs/ADVERSARIAL_REVIEW_FINDINGS.md).
Summary:

|                                | Count |
| ------------------------------ | ----: |
| Raw findings in the journal    |    34 |
| Fixed                          |    32 |
| Refuted — no defect, no action |     1 |
| Accepted risk — documented     |     1 |

**The previously reported "20 refuted" was wrong.** Only 3 verifiers returned
`refuted: true`. The other 17 never ran — they died on the session usage limit —
and the workflow's arithmetic (`total − confirmed`) filed them as refuted. Every
one of those 17 has since been reproduced or refuted by hand. They included the
single highest-severity finding in the run: reduced-motion visitors were served
a permanently invisible page, reproduced in a real browser as 21 elements stuck
at `opacity: 0` including the hero.

The same summary said "six lower-severity items" and named four. The two it
implied but never named were **F22** (money values could exceed the column
holding them) and **F34** (the fallback catalogue shipped to the browser). Both
are fixed.

## Verification

All commands run from the repository root on the corrective-cycle head.

**Environment.** Node v22.22.2 · pnpm 10.33.0 · PostgreSQL 16.13 · Redis 7.0.15
· Chromium (preinstalled, `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`) · Linux
6.18.44 x86_64.

| Command                             | Exit | Duration | Result                               |
| ----------------------------------- | ---: | -------: | ------------------------------------ |
| `pnpm run policy:check`             |    0 |       1s | 327 tracked files, no violations     |
| `pnpm run secrets:scan`             |    0 |       0s | 326 files, nothing credential-shaped |
| `pnpm run format:check`             |    0 |       4s | All matched files formatted          |
| `pnpm run lint`                     |    0 |       4s | 0 errors, 0 warnings                 |
| `pnpm run contract:check`           |    0 |       1s | 20 routes, 20 operations, 17 paths   |
| `pnpm run test`                     |    0 |      12s | 14/14 workspace tasks                |
| `pnpm run build`                    |    0 |       2s | 3/3 build tasks                      |
| `pnpm audit --audit-level moderate` |    0 |       1s | No known vulnerabilities             |
| `prisma migrate status`             |    0 |       2s | 4 migrations, none pending           |
| `prisma migrate deploy` (test db)   |    0 |       1s | Applied                              |
| `pnpm run db:seed`                  |    0 |       1s | 15 users, 12 events, 31 tiers        |
| `pnpm run db:seed` (re-run)         |    0 |       2s | Identical counts — idempotent        |
| `npx playwright test`               |    0 |      56s | 89 passed                            |

**Unit and integration tests: 2,029 passing across 13 workspaces.**

| Workspace    | Tests |     | Workspace   | Tests |
| ------------ | ----: | --- | ----------- | ----: |
| schemas      |   334 |     | api         |   181 |
| providers    |   279 |     | worker      |   176 |
| web          |   206 |     | permissions |   134 |
| inventory    |   197 |     | pricing     |   116 |
| api-contract |   160 |     | ui          |    97 |
| db           |    75 |     | logger      |    63 |
| config       |    11 |     |             |       |

**End-to-end: 89 Playwright tests** — journey, filters, accessibility, filter
focus, and reduced motion across every public page at two widths, with and
without JavaScript.

**Skips.** Suites that need PostgreSQL or Redis skip themselves when neither is
reachable. Both were running for this report, so none skipped.

**Flakiness.** The reduced-motion no-preference case was flaky when written
against a fixed sleep: below-the-fold reveals are real animations, and stepping
past an element does not reliably trigger its observer. Rewritten to scroll each
candidate into view individually and re-check, which tests the actual property —
content that never appears — rather than timing. Stable across repeated runs. No
other flakiness observed.

## Production payments

**Production payments remain prohibited**, and since the closure cycle that
prohibition is enforced rather than assumed: a deployment carrying a
live-looking credential, or asking for production payments through any of
nine environment variables, is refused at boot by both the API and the worker.
See [the closure cycle](#6-payment-kill-switch-evidence). The provider is the
deterministic in-memory mock; no real credentials are configured, and none
were requested. Before a live gateway is connected:

1. The webhook endpoint needs provider signature verification. It currently
   accepts unsigned callbacks, which is correct for the mock and unacceptable
   for anything real.
2. `PaymentStatus.TIMEOUT` rows with `reconciliationRequired` need an operator
   surface or a reconciliation job. The state is recorded; nothing consumes it.
3. The refund path is unimplemented.

## Known limitations and accepted risks

**`notFound()` does not server-render — fixed in the closure cycle.** Recorded
here as a limitation at the time, and corrected afterwards. The diagnosis in
this paragraph was half right: the blank document is real, but it is not
specific to `force-dynamic`, and it was not fixable by moving a boundary. The
cause, the experiment matrix that found it and the correction are in
[the closure cycle](#1-the-not-found-body--root-cause); the finding is **NF-01**
in `docs/ADVERSARIAL_REVIEW_FINDINGS.md`.

**Content is not inspected for jQuery or DOM-as-architecture** (finding F28).
Enforced through dependency names only. A content check would have to tell
application architecture apart from legitimate React — `ref` callbacks, focus
management and measurement all touch the DOM and are correct — and a rule that
flagged them would be turned off within a week. The realistic route into a
repository is installing the package, and that is caught.

**Demo tax rates.** Every shipped rate is `DEMO` and production fails closed.
This is a deliberate gate, not an oversight: a real deployment must supply a
determination.

**The development database carries pre-`efda577` rows.** Venue and ticket-type
counts there are roughly double a clean seed, because those models are keyed by
id and the legacy rows remain. Prisma blocks `migrate reset` for AI agents
without explicit human consent; that guard was respected rather than worked
around, so the local database was left as found. `pnpm db:reset` clears it.

The closure cycle removed the reason this mattered for verification: rather than
reasoning about what a dirty database proves, `pnpm db:verify:fresh` builds a
disposable one, walks every migration into it from zero and seeds it twice.
See [the closure cycle](#5-disposable-database-method-migrations-and-seed).

## Phase 2 prerequisites

1. Provider signature verification on the webhook endpoint.
2. A reconciliation surface for `TIMEOUT` payments.
3. The refund endpoint, allocating through the stored pricing snapshot.
4. A real tax determination, or an explicit decision to run on demo rates.
5. ~~Server-rendered `notFound()`.~~ Closed by the closure cycle, though not in
   the way this list expected — see **NF-01**.
6. Hold ownership for the mobile client, which will need the guest-token flow.

## Manual reviewer checklist

- [ ] `packages/db/prisma/migrations/20260914210155_*/migration.sql` — the
      backfill runs before the check constraint, and the legacy-hold digest is
      unguessable.
- [ ] `packages/inventory/src/ownership.js` — `authorizeHoldRelease` returns a
      decision rather than throwing, so "missing" and "not yours" stay
      indistinguishable at the route.
- [ ] `apps/api/src/lib/checkout.js` — confirm no `prisma`/`tx` reference
      appears between the phase-1 commit and the phase-3 transaction.
- [ ] `apps/api/src/routes/payments.js` — the webhook claims the event row
      before doing any work, so a duplicate delivery loses the race.
- [ ] `packages/pricing/src/tax.js` — every entry reads `DEMO`; the US rate is
      zero on purpose.
- [ ] `apps/api/src/lib/facets.js` — the SQL filters on `status = 'PUBLISHED'`
      in every aggregate.
- [ ] `apps/web/src/app/events/page.jsx` — no `key` on `EventFilters`.
- [ ] `scripts/scan-secrets.mjs` — the `ALLOWED` list names a reason per entry.

## The closure cycle, after `7732960`

A second corrective cycle ran on top of this one. It was commissioned to close
Phase 1, and it is reported here because two of its three work items are
continuations of the work above. Its full evidence is in
`PHASE1_FINAL_CLOSURE_REPORT.md`.

|                       |                                            |
| --------------------- | ------------------------------------------ |
| Starting commit       | `773296089f4584189be83fa13f073f3c21f1bf4b` |
| Ending commit (code)  | `728ca3a`                                  |
| Branch                | `claude/desi-event-js-stack-gb4uqe`        |
| Working tree at start | clean, in sync with `origin`               |
| Working tree at end   | clean, pushed                              |
| Commits               | 4 code commits plus documentation          |
| Diff                  | 46 files, +2,903 −74                       |

### 1. The not-found body — root cause

`notFound()` never server-renders its UI in Next.js 16.3.5. The signal is
handled by the renderer's error-recovery path, which emits
`<html id="__next_error__">` with an empty `<body>` and defers the not-found
UI to client hydration.

None of the suspected causes was the cause. Each of these was built and
measured against a compiled production build before anything was changed:

| Variant                                                       | Status | Body                                |
| ------------------------------------------------------------- | -----: | ----------------------------------- |
| `force-dynamic`, awaits, then `notFound()`                    |    404 | empty                               |
| Statically prerendered, awaits, then `notFound()`             |    404 | empty                               |
| `force-dynamic`, `notFound()` with no await at all            |    404 | empty                               |
| The above, plus a segment-local `not-found.jsx`               |    404 | empty                               |
| Dynamic by `await connection()`                               |    404 | empty                               |
| `notFound()` thrown from a Client Component during SSR        |    404 | empty                               |
| The above, after the page had already rendered the view       |    404 | empty                               |
| `experimental.globalNotFound` with `app/global-not-found.jsx` |    404 | empty                               |
| `notFound()` inside a `<Suspense>` boundary                   |    200 | the Suspense fallback, not the view |
| A pristine minimal app on the same installed Next.js          |    404 | empty                               |

So it is not `force-dynamic`, not streaming, not Suspense placement, not a
client-only data path, not an unawaited lookup, and not a misplaced
`not-found.js` boundary. It is the framework, and the pristine-app row is what
makes that a measurement rather than an opinion.

`global-not-found.js` exists in this version behind
`experimental.globalNotFound`, and the bundled documentation scopes it to
multiple root layouts or a top-level dynamic segment — neither of which applies
here. Enabling it changed only the unmatched-URL path, which already worked. It
is therefore **not** used.

### 2. The not-found body — reproduction evidence

Against `next start` over a freshly compiled `.next`, with `curl`, so no
JavaScript is involved at any point:

| URL                                     | Status |  Bytes | `__next_error__` | `<h1>` | Visible text                   |
| --------------------------------------- | -----: | -----: | ---------------: | -----: | ------------------------------ |
| `/events/no-such-event-at-all`          |    404 | 18,418 |                1 |      0 | the `<title>` and nothing else |
| `/events/no-such-event-at-all/checkout` |    404 | 18,921 |                1 |      0 | the `<title>` and nothing else |
| `/totally-unmatched-url`                |    404 | 26,970 |                0 |      1 | the complete not-found page    |

The body of the broken case was literally
`<body><div hidden=""><!--$--><!--/$--></div>` plus inlined Flight data. The
copy existed only inside a `<script>`.

### 3. The not-found body — correction

Routes that discover a missing _resource_ render a shared server component
(`apps/web/src/components/not-found-view.jsx`) instead of calling `notFound()`.
It has no client component in its tree, no motion, and no props — so the wording
cannot vary by reason, and the page cannot be used to probe whether a resource
is unpublished, withdrawn, private or deleted. It carries a heading, an
explanation, and links to discovery, search and home.

`app/not-found.jsx` renders the same component, so the router's own 404 page and
the in-segment one are the same page.

**HTTP behaviour, measured and documented rather than assumed:**

| URL kind                            | Before         | After          |
| ----------------------------------- | -------------- | -------------- |
| Missing resource on a matched route | 404, no body   | 200, full page |
| URL matching no route at all        | 404, full page | 404, full page |

The 200 is deliberate. In this version of Next.js the status and the body are
mutually exclusive for `notFound()`: the 404 exists _because_ the shell render
failed, and a failed shell has no body. A genuine 404 was achievable only by
probing the API from middleware on every event-page request — doubling the
requests on the busiest route, and _failing open_ when the API is unreachable,
which would have made the status non-deterministic. A page a visitor can read,
with `noindex, nofollow`, no canonical and no structured data, was judged worth
more than a status code no visitor sees.

**Without JavaScript:** every missing-resource URL renders the complete page,
its links work, and the requested URL is unchanged. Asserted in the browser with
`javaScriptEnabled: false`, not inferred.

`apps/web/src/app/sitemap.js` was added at the same time: it lists only events
the API reports as `PUBLISHED`, and deliberately does **not** fall back to the
sample catalogue when the API is down — everywhere else a dead API is answered
with sample data so a visitor still sees a page, but a sitemap built that way
would publish URLs that do not exist.

### 4. Files changed and tests added

| Area                        | Added                                                                                                   |               Tests |
| --------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------: |
| Not-found view and routing  | `not-found-view.jsx`, `sitemap.js`, rewired event and checkout pages, `app/not-found.jsx`               |             23 unit |
| Not-found browser evidence  | `e2e/not-found.spec.js`, `playwright.production.config.js`, `e2e/support/chromium.js`                   |              19 e2e |
| Fresh-database verification | `verify-fresh-database.mjs`, `disposable-database.mjs`                                                  | 19 unit + 22 checks |
| Payment kill switch         | `packages/schemas/src/payments.js`, `packages/providers/src/payment-mode.js`, `payment-mode-notice.jsx` |      52 + 9 + 6 + 5 |
| Environment idempotence     | `packages/schemas/src/env.js`                                                                           |               4 + 2 |

### 5. Disposable database method, migrations and seed

`pnpm db:verify:fresh` creates a PostgreSQL database named
`desi_event_disposable_<16 hex digits>` on the server `DATABASE_URL` names —
`DATABASE_URL`'s own database is never the target — walks every migration into
it from zero, seeds it twice, probes the constraints, runs both database
integration suites against it, and drops it. The guard lives in its own module
so it can be tested without running any of the destructive work it protects:
the target's name must match the disposable pattern and must not be
`DATABASE_URL` or `TEST_DATABASE_URL` whatever those are called, and there is no
flag that overrides either half. Prisma's AI-agent guard is untouched: nothing
here resets, truncates or drops an existing database.

Results, 22 of 22 checks:

- 4 migrations applied from zero; `prisma migrate status` reports the schema up
  to date; the applied set is exactly the repository's, in order, none rolled
  back or unfinished.
- 15 tables, all empty before seeding — so no pre-`efda577` residual rows are
  possible — and all ten columns added by the corrective cycle present, which
  is what makes "this is the current schema" a measurement.
- Seed once: 162 rows. Seed twice: 162 rows, every table identical.
- Constraint probes, each in its own rolled-back transaction: a hold may not
  have two owners; a hold may not be ownerless; a hold with exactly one owner is
  accepted; a fixed-amount promo may not be currency-less; order and payment
  idempotency keys are unique; a provider charge reference and a provider
  webhook delivery are each recorded once; a ticket code is issued once.
- `@desi-event/db` integration suite and the API's database integration suite
  both pass against it.
- The disposable database is destroyed. The development database was verified
  untouched before and after: same row counts, same databases on the server.

Refusal was checked too: pointing the command at the development database, the
test database, or `postgres` exits 2 with a message naming the database and
nothing else.

### 6. Payment kill-switch evidence

- **Default.** One mode exists — `MOCK`. `LIVE` is not present-and-disabled, it
  is absent, because there is no code path that reaches it.
- **Live credentials.** `sk_live_`, `pk_live_`, `rk_live_`, `whsec_`,
  `rzp_live_` and Adyen-shaped values anywhere in the environment refuse the
  boot, for the API and the worker alike. The refusal names the variable and
  never the value.
- **Mode requests.** `PAYMENT_PROVIDER`, `PAYMENTS_PROVIDER`, `PAYMENT_MODE`,
  `PAYMENTS_MODE`, `ENABLE_PRODUCTION_PAYMENTS`, `ENABLE_LIVE_PAYMENTS`,
  `STRIPE_LIVE_MODE` and `PAYMENTS_LIVE` refuse the boot when they ask for
  anything real — rather than being ignored, so nobody believes it worked.
- **Sandbox credentials.** Reported as unused and ignored; they activate
  nothing.
- **No outbound call.** A full checkout under test opens no socket
  (`net.Socket.prototype.connect` and `tls.connect` instrumented) and calls no
  `fetch`. No manifest depends on a payment SDK. No shipped file names a
  payment-provider endpoint.
- **Nothing to select.** There is no payment-method control anywhere, and a
  checkout body carrying `provider`, `paymentProvider`, `paymentMethod` or
  `mode` changes nothing.
- **Nothing reads as real.** Intents, captures and refunds carry `mode`, `demo`
  and a notice; order confirmations, ticket deliveries and cancellations are
  prefixed `[DEMO]` with the reason on the first line, and the marker survives a
  caller-supplied subject; checkout says
  `Production payments disabled — Phase 2 integration required.` above the
  basket; `GET /health` reports the mode.

No partial production webhook endpoint was added. No PCI or Stripe readiness is
claimed.

### 7. A boot failure found on the way

Writing the kill-switch startup tests surfaced a defect nothing else had: the
API could not start in any environment. `loadApiEnv()` parses `process.env` and
`buildApp` parses the result again, so the schema is applied to its own output —
and `ALLOW_DEMO_TAX_IN_PRODUCTION`, added during the cycle above, read a string
and produced a boolean the second pass rejected. Eleven startup tests passed
throughout, because each supplied a deliberately broken environment and failed
earlier, on the secret. None covered the case where nothing is wrong.

Recorded as **NF-02** in `docs/ADVERSARIAL_REVIEW_FINDINGS.md`.

### 8. Verification totals

Run in one sweep, no command skipped and none retried:

| Command                    | Exit | Duration | Result                                       |
| -------------------------- | ---: | -------: | -------------------------------------------- |
| `pnpm run policy:check`    |    0 |     0.4s | 348 files scanned via git, no violations     |
| `pnpm run secrets:scan`    |    0 |     3.0s | 347 tracked files, nothing credential-shaped |
| `pnpm run format:check`    |    0 |     4.5s | all files Prettier-clean                     |
| `pnpm run lint`            |    0 |     4.9s | 0 errors, 0 warnings                         |
| `pnpm run contract:check`  |    0 |     0.9s | 20 routes, 20 operations, 17 paths           |
| `pnpm run test`            |    0 |    39.4s | 2,160 passed, 0 failed, 0 skipped            |
| `pnpm run db:verify:fresh` |    0 |     8.3s | 22/22 checks                                 |
| `pnpm run build`           |    0 |     5.6s | 3/3 tasks                                    |
| `pnpm audit`               |    0 |     0.7s | no known vulnerabilities                     |
| `pnpm run test:e2e`        |    0 |    60.2s | 89 passed                                    |
| `pnpm run test:e2e:prod`   |    0 |    10.2s | 19 passed against a freshly compiled build   |

`pnpm run test` and `pnpm run build` were re-run with `turbo --force`, so the
durations above are real executions rather than Turborepo cache hits. Every
other command does its own work on every invocation.

### 9. Phase 2 prerequisites after this cycle

Unchanged by this cycle, and none of them a Phase 1 failure: production Stripe,
signed webhooks, payment reconciliation operations, real refunds, a real tax
determination, and real payouts.

## Honesty notes

No secrets appear in this report. Every number in the verification table came
from a command run during this cycle; none is estimated. Where a fix could not
be fully verified — the refund policy, which has no endpoint — that is stated
rather than implied. The one destructive operation this cycle needed
(`prisma migrate reset` on the development database) was blocked by Prisma's
AI-agent guard and was not circumvented. The closure cycle did not circumvent
it either: it builds its own disposable database rather than resetting an
existing one, and the guard that keeps it there is tested separately from the
destructive work it protects.
