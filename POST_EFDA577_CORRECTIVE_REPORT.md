# Corrective verification cycle — post-`efda577`

**Status: Phase 1 is PARTIAL.** Every defect listed below is fixed and tested,
and every code-owned verification command passes. Phase 1 is not COMPLETE
because production payments remain prohibited: the payment flow is exercised
only against a deterministic mock, and the webhook endpoint has no provider
signature verification. That is a deliberate scope boundary, not an unfinished
task — see [Production payments](#production-payments).

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

**Production payments remain prohibited.** The provider is the deterministic
in-memory mock; no real credentials are configured, and none were requested.
Before a live gateway is connected:

1. The webhook endpoint needs provider signature verification. It currently
   accepts unsigned callbacks, which is correct for the mock and unacceptable
   for anything real.
2. `PaymentStatus.TIMEOUT` rows with `reconciliationRequired` need an operator
   surface or a reconciliation job. The state is recorded; nothing consumes it.
3. The refund path is unimplemented.

## Known limitations and accepted risks

**`notFound()` does not server-render on a force-dynamic page.** Discovered
while writing the no-JavaScript tests, and not one of the 34 findings. Next
emits `<html id="__next_error__">` with the content in the RSC payload only, so
a visitor or crawler without JavaScript gets a blank document for a dead event
link. Next's own unrouted 404 does server-render — `e2e/reduced-motion.spec.js`
pins that contrast. Worth fixing for SEO; not a security or correctness defect.

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
id and the legacy rows remain. The seed is idempotent from that state onward and
verified against a clean database. Prisma blocks `migrate reset` for AI agents
without explicit human consent; that guard was respected rather than worked
around, so the local database was left as found. `pnpm db:reset` clears it.

## Phase 2 prerequisites

1. Provider signature verification on the webhook endpoint.
2. A reconciliation surface for `TIMEOUT` payments.
3. The refund endpoint, allocating through the stored pricing snapshot.
4. A real tax determination, or an explicit decision to run on demo rates.
5. Server-rendered `notFound()`.
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

## Honesty notes

No secrets appear in this report. Every number in the verification table came
from a command run during this cycle; none is estimated. Where a fix could not
be fully verified — the refund policy, which has no endpoint — that is stated
rather than implied. The one destructive operation this cycle needed
(`prisma migrate reset` on the development database) was blocked by Prisma's
AI-agent guard and was not circumvented.
