# Phase 1 final closure report

**Status: COMPLETE.**

Phase 1 is judged against the acceptance criteria Phase 1 was scoped against —
discovery, ticketing, holds, checkout, door scanning and the operational surface
around them. Production card processing was never among them. Calling Phase 1
incomplete because a Phase 2 prerequisite is absent was the wrong test, and the
right test is stricter: the absence has to be _enforced_, not assumed. This
cycle enforces it, and proves the enforcement.

|                       |                                                    |
| --------------------- | -------------------------------------------------- |
| Starting commit       | `773296089f4584189be83fa13f073f3c21f1bf4b`         |
| Final code commit     | `728ca3a`                                          |
| Branch                | `claude/desi-event-js-stack-gb4uqe`                |
| Working tree at start | clean, 0 entries, identical to `origin`            |
| Working tree at end   | clean, pushed                                      |
| Diff                  | 46 files, +2,903 −74                               |
| Unit and integration  | 2,160 passed, 0 failed, 0 skipped, 13 workspaces   |
| End-to-end            | 89 against `next dev`, 19 against a compiled build |
| Fresh-database checks | 22 of 22                                           |
| Commands run          | 11, all exit 0, none skipped, none retried         |

This report is the closure cycle's own evidence. The cycle before it is in
`POST_EFDA577_CORRECTIVE_REPORT.md`; the review that started all of it is in
`docs/ADVERSARIAL_REVIEW_FINDINGS.md`.

## Branch and clean-tree proof

At the start of the cycle:

```
$ git rev-parse HEAD
773296089f4584189be83fa13f073f3c21f1bf4b
$ git rev-parse --abbrev-ref HEAD
claude/desi-event-js-stack-gb4uqe
$ git status --porcelain | wc -l
0
```

`origin/claude/desi-event-js-stack-gb4uqe` was at the same commit. At the end,
the working tree is clean again and every change is committed and pushed. The
four code commits are:

| Commit    | Subject                                                         |
| --------- | --------------------------------------------------------------- |
| `a8baf43` | server-render the not-found page for missing resources          |
| `bdfd4e0` | prove the schema on a database that has never seen this project |
| `5c62ec3` | prove no production payment can happen, and fix a boot failure  |
| `728ca3a` | record the not-found status the journey spec now sees           |

## 1. The not-found defect: reproduction, cause, correction

### Reproduced before anything was edited

Against `next start` over a freshly compiled `.next`, using `curl`, so no
JavaScript is involved at any point:

| URL                                     | Status |  Bytes | `__next_error__` | `<h1>` | `<main>` | Visible text                   |
| --------------------------------------- | -----: | -----: | ---------------: | -----: | -------: | ------------------------------ |
| `/events/no-such-event-at-all`          |    404 | 18,418 |                1 |      0 |        0 | the `<title>` and nothing else |
| `/events/no-such-event-at-all/checkout` |    404 | 18,921 |                1 |      0 |        0 | the `<title>` and nothing else |
| `/organizers/nobody`                    |    404 | 26,970 |                0 |      1 |        1 | the complete not-found page    |
| `/venues/nowhere`                       |    404 | 26,970 |                0 |      1 |        1 | the complete not-found page    |
| `/totally-unmatched-url`                |    404 | 26,970 |                0 |      1 |        1 | the complete not-found page    |

The broken body was literally `<body><div hidden=""><!--$--><!--/$--></div>`
followed by inlined Flight data. The copy existed only inside a `<script>`.

Headers on the broken case: `HTTP/1.1 404 Not Found`,
`Transfer-Encoding: chunked`,
`Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate`,
`Content-Type: text/html; charset=utf-8`. `noindex` was present. No canonical,
no structured data.

Two facts worth stating plainly, because both were assumed otherwise:

- The status was **already a genuine 404**. The defect was only ever the body.
- **`/organizers/*` and `/venues/*` have no route in Phase 1.** Those URLs match
  nothing, so they were already answered correctly by the router. They are
  tested because they are the URLs a reviewer will try, not because they
  exercise a dynamic segment.

### Root cause

`notFound()` never server-renders its UI in Next.js 16.3.5. The signal is
handled by app-render's error-recovery path
(`getErrorRSCPayload`), whose seed data is a hard-coded
`<html id="__next_error__"><head/><body/></html>`; the not-found UI is deferred
to client hydration.

None of the suspected causes was the cause. Each variant below was built and
measured against a compiled production build:

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

So: not `force-dynamic`, not streaming, not Suspense placement, not a
client-only data path, not an unawaited lookup, not a misplaced `not-found.js`
boundary. The pristine-app row is what makes this a measurement about the
framework rather than an opinion about this codebase.

**`global-not-found.js` is deliberately not used.** The installed version
supports it behind `experimental.globalNotFound`, and its bundled documentation
scopes it to apps with multiple root layouts or a top-level dynamic segment —
neither applies here. Enabling it and adding `app/global-not-found.jsx` changed
only the unmatched-URL path, which already worked; `notFound()` from a segment
was unchanged. It solves no demonstrated routing problem here, so it was
removed.

### Correction

Routes that discover a missing _resource_ render
`apps/web/src/components/not-found-view.jsx` instead of calling `notFound()`.
`app/not-found.jsx` renders the same component, so the router's 404 page and the
in-segment one are the same page.

The view has no client component in its tree, no motion, and **no props** — so
its wording cannot vary by reason, and it cannot be used to probe whether a
resource is unpublished, withdrawn by moderation, private or deleted. It carries
a heading, a short explanation, and links to event discovery (`/events`), search
(`/events#filter-q`) and home (`/`).

### HTTP status: what this repository actually does

| URL kind                            | Before         | After          |
| ----------------------------------- | -------------- | -------------- |
| Missing resource on a matched route | 404, no body   | 200, full page |
| URL matching no route at all        | 404, full page | 404, full page |

The 200 is a deliberate, documented trade. In Next.js 16.3.5 the status and the
body are mutually exclusive for `notFound()`: the 404 exists _because_ the shell
render failed, and a failed shell has no body. The only way to keep both was to
probe the API from middleware on every event-page request, which doubles the
requests on the busiest route and — because the whole data layer is designed to
fail soft — would have to fail open when the API is unreachable, making the
status non-deterministic. A page a visitor can read beats a status code no
visitor sees, and a deterministic 200 beats an intermittent 404.

Everything the status would have bought is bought another way, and asserted:

- `robots: { index: false, follow: false }` on every missing-resource response.
- No canonical for a resource that does not exist.
- No `application/ld+json` at all, so no `Event` structured data for a missing
  event.
- `apps/web/src/app/sitemap.js` lists only events the API reports as
  `PUBLISHED`, and deliberately does **not** fall back to the sample catalogue
  when the API is unreachable — everywhere else a dead API is answered with
  sample data so a visitor still sees a page, but a sitemap built that way would
  publish URLs that do not exist. Drafts, private, cancelled-and-removed and
  deleted events are absent from the API's `PUBLISHED` response and therefore
  cannot reach it.

### Tests

`apps/web/e2e/not-found.spec.js` — 19 cases, run by
`playwright.production.config.js` against `next start` over a freshly compiled
`.next`, with `reuseExistingServer: false` so the run refuses to start if
anything already owns the port:

| Required case                            | Where                                                                  |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| Unknown event slug, JavaScript enabled   | `in a browser › unknown event slug …`                                  |
| Unknown event slug, JavaScript disabled  | `without client-side JavaScript › unknown event slug …`                |
| Unknown organiser slug                   | all three describes, `unknown organiser slug`                          |
| Unknown venue slug                       | all three describes, `unknown venue slug`                              |
| Completely unmatched URL                 | all three describes, `completely unmatched URL`                        |
| Mobile viewport                          | `on a phone › a missing resource is legible …`                         |
| `prefers-reduced-motion`                 | `with reduced motion › a missing resource is fully visible …`          |
| Visible not-found text in first response | `the initial response › …` (scripts stripped first)                    |
| Correct noindex metadata                 | `the initial response › …`                                             |
| No Event JSON-LD                         | `the initial response › …`                                             |
| No blank document before hydration       | `the initial response › …` asserts no `__next_error__`                 |
| No console or page errors                | `in a browser › … no console or page errors`                           |
| Valid routes unaffected                  | `a valid event page is untouched by the fix`, `the site still works …` |

The initial-response assertions strip every `<script>` before looking for the
copy, because the Flight payload is exactly what the broken version had.

23 unit tests cover the view, both page branches, the metadata and the sitemap.

**Why this survived the original review:** the one end-to-end test covering a
missing event asserted on the heading, and Playwright runs JavaScript, so the
heading appeared after hydration. The test passed against the broken behaviour.

## 2. Fresh-database evidence

`pnpm db:verify:fresh` creates a PostgreSQL database named
`desi_event_disposable_<16 hex digits>` on the server `DATABASE_URL` names.
`DATABASE_URL` is read only to learn _which server_; its own database is never
the target.

**The guard.** `packages/db/scripts/disposable-database.mjs` holds the rule and
nothing else, so it is tested without running any of the destructive work it
protects: the target's name must match the disposable pattern, and must not be
`DATABASE_URL` or `TEST_DATABASE_URL` whatever those happen to be called. There
is no flag that overrides either half, and only a database the run created is
ever dropped. 19 unit tests; three end-to-end refusals checked by hand
(development database, test database, `postgres` — each exits 2 with a message
naming the database and nothing else).

**Prisma's AI safety guard is untouched.** Nothing resets, truncates or drops an
existing database. The development database was verified unchanged before and
after: same databases on the server, same row counts.

**Redaction.** The run prints
`postgresql://<redacted>@<redacted>/desi_event_disposable_9931b9261ad30d3c` and
nothing else. No user, no host, no password.

**Results — 22 of 22 checks, 8.3s:**

| Check                                                    | Result                                                 |
| -------------------------------------------------------- | ------------------------------------------------------ |
| A disposable database was created                        | `desi_event_disposable_9931b9261ad30d3c`               |
| Every migration applied from zero                        | 4 migrations                                           |
| `prisma migrate status`                                  | schema up to date                                      |
| Applied set is exactly the repository's, in order        | `20260914155112_init` … `20260914213145_facet_indexes` |
| No migration rolled back or left unfinished              | pass                                                   |
| No rows from any earlier schema                          | 15 tables, all empty before seeding                    |
| Schema is the current one, not a pre-corrective snapshot | 10 of 10 post-review columns present                   |
| Seed on an empty database                                | 162 rows                                               |
| Seed a second time                                       | 162 rows, every table identical                        |
| `ticket_hold_single_owner` — two owners                  | rejected                                               |
| `ticket_hold_single_owner` — no owner                    | rejected                                               |
| `ticket_hold_single_owner` — exactly one owner           | accepted, then rolled back                             |
| `promo_code_fixed_amount_currency`                       | rejected                                               |
| Order idempotency key is unique                          | rejected on duplicate                                  |
| Payment idempotency key is unique                        | rejected on duplicate                                  |
| Provider charge reference recorded once                  | rejected on duplicate                                  |
| Provider webhook delivery recorded once                  | rejected on duplicate                                  |
| Ticket code issued once                                  | rejected on duplicate                                  |
| `@desi-event/db` integration suite                       | 94 passed                                              |
| API database integration suite                           | 6 passed                                               |
| The disposable database was destroyed                    | dropped                                                |

Seeded row counts, per table: AuditLog 4, Event 12, Membership 8, Order 12,
OrderItem 15, Organization 2, Payment 12, PromoCode 4, Ticket 25, TicketHold 12,
TicketType 31, User 15, Venue 6, WaitlistEntry 4, WebhookEvent 0. Identical on
the second run.

Each constraint probe runs in its own transaction, which is always rolled back,
so nothing a probe writes survives whether it was accepted or rejected.

**On the constraint list as specified.** Three of the named constraints exist
under different names, and one does not exist at all. Stated rather than
implied:

- **External source uniqueness** — Phase 1 ingests nothing from third parties
  (no scraping, no feeds). The external identifiers this system does hold come
  from a payment provider: `Payment(provider, providerRef)` and
  `WebhookEvent(provider, providerEventId)`. Both are probed.
- **Seat uniqueness** — Phase 1 sells general admission; there is no seating
  model. The issued-once unit is the pass, `Ticket.code`. Probed.
- **Immutable or protected financial records** — **not implemented.** There is
  no trigger, no append-only table and no row-level protection on `Order`,
  `Payment` or `Ticket`. The schema carries exactly two `CHECK` constraints
  (`ticket_hold_single_owner`, `promo_code_fixed_amount_currency`) and no
  triggers. Listed as a Phase 2 entry criterion below.

## 3. Production-payment kill switch

**Default.** One payment mode exists: `MOCK`. `LIVE` is not present-and-disabled
— it is absent, because there is no code path that reaches it. The adapter is
`in-memory-payments`, a name no payment service provider uses.

**Live credentials fail safely.** `sk_live_`, `pk_live_`, `rk_live_`, `whsec_`,
`rzp_live_` and Adyen-shaped values anywhere in the environment — not only under
a known variable name — refuse the boot for the API and the worker alike. The
refusal names the variable and never the value; asserted both in-process and by
spawning the real server and grepping its output.

**Production mode is rejected even when asked for.** `PAYMENT_PROVIDER`,
`PAYMENTS_PROVIDER`, `PAYMENT_MODE`, `PAYMENTS_MODE`,
`ENABLE_PRODUCTION_PAYMENTS`, `ENABLE_LIVE_PAYMENTS`, `STRIPE_LIVE_MODE` and
`PAYMENTS_LIVE` refuse the boot when they ask for anything real — rather than
being ignored, because somebody who believes they have enabled card payments
must find out from the boot log rather than from a buyer. Values that ask for
what already happens (`mock`, `demo`, `none`, `false`, `0`, `off`, empty) are
accepted.

**Sandbox credentials activate nothing.** A leftover `sk_test_…` is reported as
unused, logged once, and ignored. It does not start a Stripe integration,
because there is none to start.

**No outbound payment call is possible.**

- A full checkout under test opens no socket and calls no `fetch`.
  `net.Socket.prototype.connect` and `tls.connect` are instrumented for the
  duration and asserted to record nothing.
- No manifest in the repository depends on a payment SDK (`stripe`, `razorpay`,
  `braintree`, `square`, `adyen`, `@stripe/*`, `paypal*`), asserted over
  `git ls-files`.
- No shipped file names `api.stripe.com`, `checkout.stripe.com`,
  `api.razorpay.com` or `api.adyen.com`.

**A browser cannot select a provider.** There is no payment-method control
anywhere in the checkout UI, asserted both as "no control named after a
provider, method, mode or card" and as "the word Stripe does not appear". A
checkout body carrying `provider`, `paymentProvider`, `paymentMethod` or `mode`
changes nothing: the recorded provider stays `in-memory-payments`.

**Administrative status.** `GET /health` reports
`payments: { mode: 'MOCK', demo: true, message: 'Production payments disabled — Phase 2 integration required.' }`,
in the liveness payload rather than behind a separate endpoint, because the
person checking whether an instance is healthy is exactly the person who needs
to know it cannot take money. The same sentence appears above the basket on
every checkout visit, server-rendered.

**Nothing a mock produces reads as real.** Intents, captures and refunds carry
`mode`, `demo: true` and a notice. Order confirmations, ticket deliveries and
cancellations are prefixed `[DEMO]` with the reason on the first line of the
body, and the marker survives a caller-supplied subject — otherwise the one
field an operator controls would be the one that removes the warning. The ticket
email says the pass admits nobody; the receipt says no money moved and that it
is not a valid receipt.

**Not done, deliberately:** no partial production webhook endpoint was added,
and no PCI or Stripe readiness is claimed.

72 tests cover this: 52 on the kill switch itself, 9 in the API (including the
network guard and the repository-wide assertions), 6 on the checkout notice, 5
on the DEMO stamping of intents, and the worker's template assertions.

## 4. The original 34 findings

Unchanged, and deliberately so:

| Disposition                          |  Count |
| ------------------------------------ | -----: |
| Fixed                                |     32 |
| Refuted — no defect, no action (F04) |      1 |
| Accepted risk — documented (F28)     |      1 |
| **Total**                            | **34** |

The historical record is preserved as it stands: 17 verifier agents died when
the review session hit its usage limit, their findings were silently filed as
"refuted" by arithmetic, and every one was later reproduced or refuted by hand.
Nothing in this cycle rewrites that.

## 5. New findings after the original 34

Recorded in their own section of `docs/ADVERSARIAL_REVIEW_FINDINGS.md` so the
original run's totals stay exactly as reconciled.

| ID    | Sev      | Claim                                                                                    | Status    |
| ----- | -------- | ---------------------------------------------------------------------------------------- | --------- |
| NF-01 | high     | A URL matching a route but not a resource answers with an empty document until hydration | **Fixed** |
| NF-02 | critical | The API could not start in any environment: `apiEnvSchema` rejects its own output        | **Fixed** |

**NF-02** was found while writing NF-01's cycle tests, and it is the more
serious of the two. `loadApiEnv()` parses `process.env` and `buildApp` parses
the result again, so the schema is applied to its own output;
`ALLOW_DEMO_TAX_IN_PRODUCTION` — added by the previous corrective cycle — read a
string and produced a boolean that the second pass rejected. Because the field
carries a default it is always present in the output, so this failed for every
environment, including the one in `.env.example`. Eleven startup tests existed
and all passed, because each supplied a deliberately broken environment and
failed earlier, on the secret; none covered the case where nothing is wrong.
That case is now covered twice — a spawned process that must bind its port, and
the property that parsing an environment twice produces what parsing it once
did.

## 6. Verification

One sweep, in order. Runtime: Node v22.22.2, pnpm 10.33.0, Linux. Database:
PostgreSQL 16.13 on `127.0.0.1:5432`; Redis 7.0.15 on `127.0.0.1:6379`. The
browser suites deliberately run with **no API process**, which is the degraded
state the fallback catalogue exists for.

| Command                    | Exit | Passed | Failed | Skipped | Duration | Retries |
| -------------------------- | ---: | -----: | -----: | ------: | -------: | ------- |
| `pnpm run policy:check`    |    0 |    n/a |      0 |       0 |     0.4s | none    |
| `pnpm run secrets:scan`    |    0 |    n/a |      0 |       0 |     0.5s | none    |
| `pnpm run format:check`    |    0 |    n/a |      0 |       0 |     4.5s | none    |
| `pnpm run lint`            |    0 |    n/a |      0 |       0 |     4.9s | none    |
| `pnpm run contract:check`  |    0 |    n/a |      0 |       0 |     0.9s | none    |
| `pnpm run test`            |    0 |  2,160 |      0 |       0 |    39.4s | none    |
| `pnpm run db:verify:fresh` |    0 |     22 |      0 |       0 |     8.3s | none    |
| `pnpm run build`           |    0 |    3/3 |      0 |       0 |     5.6s | none    |
| `pnpm audit`               |    0 |    n/a |      0 |       0 |     0.7s | none    |
| `pnpm run test:e2e`        |    0 |     89 |      0 |       0 |    60.2s | none    |
| `pnpm run test:e2e:prod`   |    0 |     19 |      0 |       0 |    10.2s | none    |

`pnpm run test` and `pnpm run build` were re-run with `turbo --force`, so the
durations above are real executions rather than Turborepo cache hits. Every
other command does its own work on every invocation.

Detail:

- `policy:check` — 348 files enumerated via git, no violations. No `.ts`,
  `.tsx`, `.d.ts` or `tsconfig*.json`; no forbidden dependency.
- `secrets:scan` — 347 tracked files, nothing credential-shaped.
- `contract:check` — 20 routes, 20 OpenAPI operations, 17 paths, no drift.
- `test` — 13 workspaces: schemas 338, providers 336, web 235, inventory 197,
  api 196, worker 183, api-contract 160, permissions 134, pricing 116, ui 97,
  db 94, logger 63, config 11. Zero skipped, zero todo.
- `test:e2e` — 89 cases including the accessibility and reduced-motion suites,
  against `next dev` on port 3210.
- `test:e2e:prod` — 19 cases against `next start` on port 3220, over a `.next`
  compiled by the same command. `reuseExistingServer: false`, so the run fails
  rather than reusing a server somebody left behind; the ports were confirmed
  free before the sweep began.

**One failure occurred earlier in the cycle and is reported rather than
buried.** The first sweep after the not-found fix failed `test:e2e` with one
case: `journey.spec.js` asserted `404` for an unknown event slug. That
assertion was correct for the old behaviour and wrong for the new one. It was
changed to assert the documented `200`, with the reason in a comment — not
re-run until it passed. The sweep above is the one after that change, and the
table is its output.

## 7. Remaining limitations

1. **A missing resource answers 200, not 404.** Deliberate and documented above.
   An unmatched URL still answers a genuine 404.
2. **No immutable or protected financial records.** No trigger, append-only
   table or row-level protection on `Order`, `Payment` or `Ticket`.
3. **No refund endpoint.** The allocation primitive and the pricing snapshot
   exist; the route does not.
4. **The webhook accepts unsigned callbacks.** Correct for a deterministic mock,
   unacceptable for anything real.
5. **`TIMEOUT` payments have no consumer.** `reconciliationRequired` is
   recorded; nothing acts on it.
6. **Tax rates are `DEMO`.** Production fails closed unless
   `ALLOW_DEMO_TAX_IN_PRODUCTION` is set deliberately.
7. **No organiser or venue pages.** `/organizers/*` and `/venues/*` match no
   route; they answer the router's 404.
8. **File contents are not inspected for jQuery or DOM-as-architecture**
   (finding F28, accepted risk).
9. **No search index.** The queue and processor exist and log.
10. **No mobile client.** React Native with Expo is Phase 3.

## 8. Phase 2 entry criteria

None of these is a Phase 1 failure. Each is work Phase 2 must do before real
money moves:

1. A merchant account and a production payment integration, replacing the
   in-memory adapter at the one place that constructs it.
2. Provider signature verification on `POST /v1/payments/webhook`.
3. Payment reconciliation operations: an operator surface or job for `TIMEOUT`
   rows flagged `reconciliationRequired`.
4. A real refund endpoint, allocating through the stored pricing snapshot.
5. A real tax determination — registration status, place-of-supply rules, rate
   bands — replacing the `DEMO` policy table.
6. Real payouts to organisers, in their own currency.
7. Immutable or protected financial records, so a settled order and its payment
   cannot be edited in place.
8. Removal of the kill switch, which must be a deliberate commit that reviewers
   can see, not a configuration change.

## 9. Manual reviewer checklist

- [ ] `apps/web/src/components/not-found-view.jsx` — takes no props, so the
      wording cannot vary by why the resource is missing.
- [ ] `apps/web/src/app/events/[slug]/page.jsx` — the missing-event branch
      returns the view; `generateMetadata` returns `noindex` and no canonical.
- [ ] `apps/web/src/app/sitemap.js` — the API failure path returns static routes
      only, never the sample catalogue.
- [ ] `apps/web/playwright.production.config.js` — `reuseExistingServer: false`,
      and the command builds before it tests.
- [ ] `apps/web/e2e/not-found.spec.js` — the initial-response assertions strip
      `<script>` before looking for the copy.
- [ ] `packages/db/scripts/disposable-database.mjs` — the pattern, and the
      `DATABASE_URL`/`TEST_DATABASE_URL` refusal, with no override.
- [ ] `packages/db/scripts/verify-fresh-database.mjs` — `createDatabase` and
      `dropDatabase` both call `assertDisposable`; the drop happens only when
      this run created the database.
- [ ] `packages/providers/src/payment-mode.js` — `PAYMENT_MODES` has one member;
      no refusal message or `details` object carries a credential value.
- [ ] `apps/api/src/app.js` — the kill switch runs before Fastify is
      constructed, and reads the unparsed environment.
- [ ] `apps/worker/src/main.js` — the same check, before any connection opens.
- [ ] `apps/worker/src/email/templates.js` — `DEMO_NOTICE_BY_TEMPLATE`, and that
      the marker is applied after a caller-supplied subject rather than before.
- [ ] `packages/schemas/src/env.js` — `envBoolean`, and that parsing an
      environment twice is a test rather than a comment.
- [ ] `docs/ADVERSARIAL_REVIEW_FINDINGS.md` — the original totals are 34 / 32 /
      1 / 1, and the new findings are in their own section.

## 10. Honesty notes

Every number in this report came from a command run during this cycle; none is
estimated, and the raw logs were kept while it was written. Nothing here
contains a credential: the fresh-database run prints a redacted identifier, the
kill switch names variables and never values, and the live-looking keys used as
test fixtures are self-identifying fabrications.

Where something is absent it is named as absent — immutable financial records,
seat uniqueness, external ingestion, organiser and venue pages — rather than
described in terms that imply it exists. The one status-code compromise is
stated as a compromise, with the alternative that was rejected and the reason.
The one command that failed during the cycle is reported with what was changed
and why, rather than being replaced by the passing run that followed it.
