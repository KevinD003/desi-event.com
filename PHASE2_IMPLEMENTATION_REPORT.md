# Phase 2 implementation report

**Status: `PARTIAL`.**

> **Superseded in part.** A later cycle corrected three claims in this document
> (see §3a) and continued the work. `PHASE2_COMPLETION_REPORT.md` is the current
> record and scores the twenty completion gates; this document remains the account
> of the cycle that produced commits `7777322` through `926d1a3`.

Phase 2 as specified spans twenty-one work items. Thirteen commits landed six of
them to a standard I would defend, and the rest are not started. That is the headline,
and the rest of this document says exactly which are which, because a report whose
status has to be inferred from its length is not a report.

Nothing here claims a Stripe sandbox was exercised. No test credentials were
available; every Stripe test in this repository runs against a double with the
real call shapes, and the sandbox execution is marked **EXTERNAL VERIFICATION
PENDING** wherever it appears.

---

## 1. Scope actually delivered

| Work item | Subject                                      | State                                                                                                                                                      |
| --------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WI1       | Authentication, authorization, sessions, MFA | **Delivered**                                                                                                                                              |
| WI2       | Organisations, team management, invitations  | **Partial** — membership and invitations delivered; organiser verification state machine, public organiser/venue pages and venue-map authoring not started |
| WI3       | Event lifecycle and moderation               | **Not started**                                                                                                                                            |
| WI4       | GA and reserved-seat inventory               | **Delivered**                                                                                                                                              |
| WI5       | Pricing and tax                              | **Carried from Phase 1**, not extended                                                                                                                     |
| WI6       | Stripe test integration                      | **Delivered, externally unverified**                                                                                                                       |
| WI7       | Signed webhooks                              | **Delivered**                                                                                                                                              |
| WI8       | Payment saga and reconciliation              | **Partial** — reconciliation tasks are opened by the webhook path; the checkout-side saga is not written                                                   |
| WI9       | Refunds, cancellations, disputes             | **Not started**                                                                                                                                            |
| WI10      | Financial ledger                             | **Schema and database enforcement delivered**; no service writes to it yet                                                                                 |
| WI11      | Transfers and payouts                        | **Schema only**                                                                                                                                            |
| WI12      | Tickets and check-in                         | **Schema only**                                                                                                                                            |
| WI13      | Notifications                                | **Seam only** — a `deliver` hook the auth and team routes call                                                                                             |
| WI14      | Organiser analytics                          | **Not started**                                                                                                                                            |
| WI15      | API and data contracts                       | **Partial** — 45 routes documented and contract-checked; the ~40-endpoint target is not met because the endpoints do not exist                             |
| WI16      | Security hardening                           | **Partial** — see §12                                                                                                                                      |
| WI17      | Accessibility and responsive UX              | **Not started** — no Phase 2 screens were built                                                                                                            |
| WI18      | Reliability and load testing                 | **Not started**                                                                                                                                            |
| WI19      | Database and migration proof                 | **Delivered, and extended beyond the brief**                                                                                                               |
| WI20      | Testing and proof                            | **Partial** — see §20                                                                                                                                      |
| WI21      | CI/CD                                        | **Not started**                                                                                                                                            |

## 2. Commits

Starting commit `efdd640` (Phase 1 closure). Thirteen commits, the last of which
is this report and the traceability matrix.

```
7777322  feat(db): the Phase 2 data model, and a drift guard that can see drift
6622881  feat(payments): two credential modes, and a kill switch that knows the difference
9044b09  test(db): prove the Phase 2 invariants, including the ones only rows can show
e22b807  feat(auth): credential primitives, and a move off bcrypt
a43fcdc  feat(api): sessions that can be revoked, and the routes around them
d814177  feat(api): team management, and the five ways it is attacked
e56e9a4  feat(inventory): reserved seating, and a race run against real PostgreSQL
6fa5a1e  feat(api): seat map and seat reservation routes
d2b7013  feat(providers): the Stripe test adapter, and webhook verification that means it
f1803b4  feat(api): webhook endpoints that verify bytes, store, then acknowledge
6714f1a  fix(api): emit the webhook routes into the OpenAPI document
289e4a0  test(db): probe the hold-item session check, which had none
926d1a3  docs: record the decision to use plpgsql inside migrations
```

The last three landed while writing this report and the traceability matrix,
which is what they were for: `6714f1a` because the checked-in OpenAPI artefact
described 43 operations while the API served 45; `289e4a0` because one of the ten
trigger functions had no probe; `926d1a3` because technology rule 7 requires the
decision to introduce plpgsql to be documented and it was not.

97 files changed, 29,937 insertions, 2,704 deletions through `926d1a3`. Phase 1
history is untouched; nothing was rewritten, squashed or force-pushed.

## 3. Verification results

Every command below was re-run at `926d1a3`, the last commit before this report,
with `--force` for the test suite and the production build so nothing came from a
Turborepo cache (`0 cached, 15 total` and `0 cached, 3 total` respectively).

| Command                  | Result                                            |
| ------------------------ | ------------------------------------------------- |
| `pnpm policy:check`      | OK — 394 tracked files, no violations             |
| `pnpm secrets:scan`      | OK — 393 tracked files, nothing credential-shaped |
| `pnpm format:check`      | OK                                                |
| `pnpm lint`              | OK                                                |
| `pnpm contract:check`    | OK — 45 routes, 45 operations, 42 paths           |
| `pnpm test`              | **3,444 passed, 5 skipped, 0 failed**, 14 suites  |
| `pnpm db:verify:fresh`   | **68/68 checks passed**                           |
| `pnpm db:verify:upgrade` | **17/17 checks passed**                           |
| `pnpm build`             | OK — 3 tasks                                      |
| `pnpm audit`             | No known vulnerabilities                          |
| `pnpm test:e2e`          | **Not run in that cycle; 89 passed since**        |
| `pnpm test:e2e:prod`     | **Not run in that cycle; 19 passed since**        |
| Phase 2 load tests       | **Do not exist**                                  |

The two end-to-end commands and the load tests were listed as not run rather than
omitted. Both suites have since been run at `e93d4e9`: 89 specs against `next
dev` and 19 against a compiled build, all passing, with no stale server on
either port. The load tests still do not exist.

### 3a. Test counts by workspace, then and now

Both columns were measured by running the suites, not carried over from a
previous document. The `efdd640` column was produced in a throwaway git worktree
at that commit.

| Workspace                  | `efdd640` (Phase 1 end) | `e93d4e9` (Phase 2 report) |
| -------------------------- | ----------------------- | -------------------------- |
| `@desi-event/permissions`  | 134                     | 530                        |
| `@desi-event/schemas`      | 338                     | 527                        |
| `@desi-event/providers`    | 336                     | 478                        |
| `@desi-event/auth`         | — (no such package)     | 348                        |
| `@desi-event/api`          | 196                     | 342                        |
| `@desi-event/inventory`    | 197                     | 254                        |
| `@desi-event/web`          | 235                     | 235                        |
| `@desi-event/worker`       | 183                     | 183                        |
| `@desi-event/api-contract` | 160                     | 163                        |
| `@desi-event/pricing`      | 116                     | 116                        |
| `@desi-event/db`           | 94                      | 102                        |
| `@desi-event/ui`           | 97                      | 97                         |
| `@desi-event/logger`       | 63                      | 63                         |
| `@desi-event/config`       | 11                      | 11                         |
| **Total**                  | **2,160** (13)          | **3,449** (14)             |

**Corrected.** An earlier draft of this report said Phase 1 ended at 2,769 and
Phase 2 added 680. Both numbers were wrong and the 2,769 had no provenance. The
measured Phase 1 total is 2,160, which is exactly what
`PHASE1_FINAL_CLOSURE_REPORT.md` recorded at `728ca3a` — the commit `efdd640`
sits on, and from which `efdd640` changed no code at all: it touched five
documentation files and `.gitignore`. So **Phase 2 added 1,289 tests**, not 680,
and the fourteenth workspace is `@desi-event/auth`.

**Corrected.** The same draft reported `pnpm test` as "3,449 passed, 0 failed".
Five of those 3,449 were **skipped**, not passed: `apps/worker/tests/redis-integration.test.js`
skips itself when Redis is unreachable, and no Redis was running. The honest
reading of that run is **3,444 passed, 5 skipped, 0 failed**. Reporting a skip as
a pass is the specific thing a verification table exists to prevent, so it is
recorded here rather than quietly fixed.

With Redis started, the same suite is 183 passed and 0 skipped. Every later
verification in this repository runs with both PostgreSQL and Redis up, and says
so.

## 4. Credential modes

Three states, as specified, with the third one absent from the code by design.

| Mode          | Reached by                                                                                   | What happens                                                                                                                                       |
| ------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mock`        | The default. No configuration.                                                               | In-memory provider. No socket opens. Every artefact labelled `DEMO`.                                                                               |
| `stripe_test` | `PAYMENT_MODE=stripe_test` plus a coherent set of `sk_test_`/`pk_test_`/`whsec_` credentials | Stripe's sandbox. Artefacts labelled `SANDBOX`.                                                                                                    |
| `live`        | Nothing                                                                                      | There is no `LIVE` constant. `PAYMENT_MODE=live` (and `production`, `prod`, `real`, `stripe`, `stripe_live`) is refused before the server listens. |

`packages/schemas/src/payments.js` says why the third is absent rather than
present-and-disabled: a constant called `LIVE` is a constant somebody eventually
tries to use.

The gate (`packages/providers/src/payment-mode.js`) refuses a live secret or
publishable key, a live restricted or Connect key, a placeholder, a mixed
test/live set, an incomplete sandbox set, two endpoints sharing one signing
secret, and any payment secret in a `NEXT_PUBLIC_` variable. It runs in the API
and the worker before either connects to anything, and `buildApp` re-checks a
supplied resolution so that a test cannot become a way past it.

One Phase 1 over-classification was corrected: `whsec_` is spelled identically by
Stripe in test and live mode, so it is no longer treated as evidence of live
credentials. It is checked for coherence with the keys beside it instead.

## 5. Production payments

**Disabled, and unreachable.** No code path constructs a live Stripe client. The
adapter refuses to build unless the resolved mode is `STRIPE_TEST`. A repository
guard asserts that only `packages/providers/src/stripe.js` imports `stripe` at
all, so there is one place where an API version, an amount and an idempotency key
are decided.

## 6. Stripe integration

Delivered as code; **EXTERNAL VERIFICATION PENDING**.

- API version pinned in code (`2025-08-27.basil`), passed explicitly to the SDK,
  recorded on every stored webhook row.
- SDK pinned (`stripe@^22.6.2`), asserted by a test.
- Destination charges per ADR 0003: `on_behalf_of`,
  `transfer_data.destination`, one disclosed `application_fee_amount`.
- Idempotency keys scoped by operation, subject and attempt.
- `requires_action` is not a failure; `processing` is not a success; an
  unrecognised status falls back to `PENDING`, never to `PAID`.
- A card error is a decline; a connection error, API error or rate limit is an
  _unknown outcome_ mapped to `PAYMENT_TIMEOUT`.
- Errors carry four named fields. A serialised Stripe error carries `raw`, which
  carries the request; a test asserts none of that survives.
- Card metadata is brand, last four, expiry month and year. Nothing else.

What has **not** happened: no PaymentIntent has been created, no 3-D Secure flow
has been exercised, no Connect account has been onboarded, no `stripe listen` has
delivered an event, and no dashboard object exists. There are no fabricated
dashboard identifiers, request logs or screenshots anywhere in this repository.

## 7. Webhooks

Two endpoints, one per signing secret. Verify over the exact bytes, store, then
acknowledge — with processing from the stored row.

The raw body is read with a content-type parser installed on a _scoped_ Fastify
instance, so the rest of the API keeps its parsed, validated bodies. There is no
path that accepts a parsed object, and `verifyWebhook` refuses a string, an
object or a `Uint8Array` with a log reason saying the body was re-encoded.

There is no unsigned mode and no bypass. Mock mode refuses every delivery rather
than accepting unsigned ones.

Proven by test: a tampered byte is refused; a duplicate stores one row and pays
once; an out-of-order failure after a success does not un-pay; the same event id
for two connected accounts is two rows; drift in amount, currency or account
opens a reconciliation task and changes nothing; an unhandled type is stored,
marked `IGNORED` and acknowledged.

Stored payloads are stripped of `receipt_email`, `shipping`, `billing_details`,
`payment_method_details` and `client_secret`, recursively, with the digest of the
original bytes kept.

## 8. Reserved seating

Two modules, split on purpose: `packages/inventory/src/seating.js` decides what
should happen and is pure; `apps/api/src/lib/seating.js` is one conditional
`UPDATE` per transition and decides whether it did.

The atomicity claim is not a comment. `packages/db/scripts/seat-concurrency.mjs`
runs real transactions against a real disposable PostgreSQL:

- twelve buyers race for one seat — exactly one wins;
- two overlapping selections — at most one wins, and no half-taken booking;
- a late expiry sweep releases nothing from a seat that has since sold;
- twelve concurrent GA buyers sell exactly five of five (bounded _and_ sold out,
  asserted as two claims);
- four concurrent inserts of one seat into one session produce one row.

Accessibility is structural: an accessible seat and its companion are taken
together in both directions, before availability is checked, so a taken companion
fails the whole selection rather than producing a half-booking.

A buyer is told a seat is unavailable and never why. An organiser who may see that
organisation's drafts gets the real status.

## 9. Authentication

Sessions are rows, not claims. Phase 1's seven-day JWT could not be revoked; sign
out was a gesture and "sign out everywhere" was not implementable.

- 256-bit secret, stored as a SHA-256 digest. A database dump cannot sign in.
- `__Host-` httpOnly cookie for browsers; the same secret as a bearer token for
  scripts. One session, two presentations, one thing to revoke.
- Absolute expiry, separate idle timeout, scheduled rotation, and rotation on
  every privilege change.
- Passwords move from bcrypt to scrypt (N=2^15, r=8, ~32 MiB per guess).
  Argon2id was considered and rejected: every Node implementation is a native
  addon, and a native addon in the login path is a build matrix for the one
  function that must never stop working. Phase 1 hashes are recognised and
  upgraded on a correct sign-in.
- TOTP implemented against RFC 6238 and verified against all six SHA-1 vectors in
  Appendix B. `verifyTotp` returns the counter so the caller can refuse a replay
  within the window.
- CSRF answered three ways: `SameSite`, an origin check on every unsafe method,
  and a double-submit token.
- Throttling with two counters (per address, per source), backed by
  `LoginAttempt` with both values keyed-digested. Deliberately not an account
  state: a persistent lock is a denial of service anybody can inflict on anybody.

## 10. Authorization

34 capabilities across 8 organisation roles and 6 platform roles, resolved on
every request rather than baked into a token.

Team management is where the adversarial work is. Five attacks, each with tests
that _run the attack_:

1. self-escalation — a caller cannot change their own membership, in either
   direction;
2. escalation through a third party — the grantable set comes from
   `canAssignOrgRole`, which compares capability sets rather than a seniority
   number (so `FINANCE` and `EVENT_MANAGER`, peers with disjoint powers, cannot
   grant each other);
3. acting on somebody above you — a separate check, because granting `STAFF` is a
   power a manager may have and using it on the organisation's `ADMIN` is not;
4. last-owner removal — counted inside the transaction that would change it;
5. invitation replay and forwarding — conditional update on `PENDING`, and the
   accepting session must be signed in as the invited address.

## 11. Database and migrations

Two migrations, applied from zero and over populated tables.

`db:verify:fresh` (68 checks) builds a disposable database, walks every migration
from zero, seeds twice, and runs three probe suites: Phase 1's constraint probes,
36 Phase 2 probes, and 9 real-transaction concurrency probes.

`db:verify:upgrade` (17 checks) is new and is the check a fresh-database
workflow structurally cannot make. It applies the pre-Phase-2 migrations, fills
every table with a row, applies the Phase 2 migrations on top, and then compares
the result against a database built from zero — 1,203 catalogue entries across
columns, constraints, indexes, triggers, enum labels and function bodies.

The database enforces, in the database: balanced ledger batches at posting,
append-only posted entries and their lines, seat label uniqueness per map
version, seat uniqueness per session, published-map immutability, session-to-map
coherence, order-line-to-event coherence (NF-04), refund ceilings including
in-flight refunds, QR credential uniqueness, one check-in per ticket,
idempotency-key uniqueness per scope, and webhook uniqueness per account context.

## 12. Security

Delivered: the credential gate, the session and CSRF work above, capability
scoping validated at contract level, per-route rate limits on credential
endpoints, PII-stripped webhook payloads, keyed pseudonymisation of email and IP
in `LoginAttempt`, audit records on every state change, step-up authentication
for factor removal, and the repository guards (no TypeScript, no standalone HTML,
no secrets, only the official Stripe SDK, one Stripe import site).

Not delivered: CSP and the wider secure-header review for Phase 2 screens (there
are none), circuit breakers, least-privilege database users, and the threat model
document.

## 13. Documentation

`docs/adr/0003-stripe-connect-charge-model.md` is new. It compares destination
charges, direct charges and separate charges/transfers against the actual
business invariant (one order carries tickets from one organiser, structurally),
chooses destination charges, states plainly that Option C is _not_ chosen because
flexibility is not a requirement, and lists what the decision does **not** make
Desi-Event: merchant of record, agent, escrow provider, money transmitter, tax
remitter, or legal seller.

`docs/adr/0004-plpgsql-in-migrations.md` is also new, and was written because
writing the traceability matrix exposed an undocumented decision: Phase 2
introduced ten plpgsql functions and twelve triggers, and technology rule 7
requires the decision to introduce another language to be documented _before_ it
is introduced. It was not. The ADR records the reasoning and the boundary — a
trigger may only refuse a write, never compute a business result — and
`docs/language-policy.md` section 6 now says why this is not a polyglot-service
exception. Writing it also found a trigger with no probe
(`desi_hold_item_session_matches`); it now has two, and `db:verify:fresh` went
from 66 checks to 68.

`.env.example` documents all three credential modes by name and description only.

The other thirteen required documents are **not written**.

## 14. Failed tests encountered during development

Kept, as instructed, rather than erased after the final green run.

| Failure                                                                    | Root cause                                                                                                                                                                                                  | Fix                                                                                                                                                  |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prisma migrate diff --shadow-database-url` unknown option                 | Prisma 7 removed the flag                                                                                                                                                                                   | Used `--from-schema`/`--to-schema`, which needs no database                                                                                          |
| Fresh-DB "no rows from an earlier schema" failed across 49 tables          | The migration inserts 10 structural `LedgerAccount` rows                                                                                                                                                    | Taught the verifier the difference between structure and residue                                                                                     |
| Seed failed: `invalid input value for enum "UserRole": "ADMIN"`            | The role rename to `SUPER_ADMIN`                                                                                                                                                                            | Updated the seed and its test                                                                                                                        |
| Migration failed: `column "updatedAt" ... contains null values`            | `@updatedAt` generates `ADD COLUMN ... NOT NULL` with no default, which PostgreSQL refuses on a populated table — invisible to a fresh-database check                                                       | Added with a default, backfilled, dropped the default. **This is why `db:verify:upgrade` exists.**                                                   |
| Retry failed: `type "WebhookState" already exists`                         | Prisma's generated enum block carries its own `BEGIN;`/`COMMIT;`, ending Prisma's transaction early and leaving a half-applied database                                                                     | Stripped the inner transaction; recovered with `migrate resolve --rolled-back` and a guarded rebuild that refuses any database but `desi_event_test` |
| NF-03: `paymentStatusSchema` rejected `PENDING` and `TIMEOUT`              | The drift guard restated the Prisma enums by hand, so it could not detect drift                                                                                                                             | Regenerated from the schema; both guards now parse `schema.prisma` off disk                                                                          |
| `capabilities.test.js`: "each role is a strict superset of the role below" | No longer true — `SCANNER` inherits nothing                                                                                                                                                                 | Replaced with a property stated against the inheritance graph, plus an acyclicity check                                                              |
| 5 `can.test.js` failures using `role: 'ADMIN'` as a platform role          | The rename                                                                                                                                                                                                  | Renamed, and rewrote the union test to use a meaningful pair                                                                                         |
| `payment-mode.test.js` × 8 after the two-mode rewrite                      | Expected behaviour change                                                                                                                                                                                   | Rewrote the suite (87 tests)                                                                                                                         |
| Placeholder detection missed `sk_test_xxxxxxxx`                            | `\bxxx+\b` cannot match after an underscore                                                                                                                                                                 | Added two more patterns; made every fixture self-identifying                                                                                         |
| Seat concurrency probe: `event_seat_status_coherent` violated              | The probe took a shortcut — a SOLD seat with no order line and a lingering hold id                                                                                                                          | The database was stricter than the probe. Sold the seat properly through a real order item                                                           |
| Team routes 403 for an owner listing their own team                        | **A real defect.** The contract's capability guard read `organizationId` from body/query/params, and these routes carry it as `params.id` — so it asserted with _no scope_, which is a platform-level check | Added a declared `capabilityScope`, validated by the contract checker against the route's own schemas                                                |
| Webhook processing `FAILED`: `unknown relation payment.order`              | The stub had no `payment.order` relation                                                                                                                                                                    | Added it — and the failure surfaced cleanly through the retry path, which is what that path is for                                                   |
| `duplicate` missing from the webhook response                              | The contract's response schema correctly stripped an undeclared field                                                                                                                                       | Declared it, rather than asserting an undeclared field                                                                                               |
| `depends on no payment SDK`                                                | Phase 1's guard, now false by design                                                                                                                                                                        | Changed shape: official Stripe SDKs allowed, everything else still refused, plus three new assertions                                                |
| eslint `require-atomic-updates` on the Stripe client cache                 | Two concurrent calls could both build a client                                                                                                                                                              | Cached the promise rather than the value                                                                                                             |

Two invisible control characters written into source files (a device fingerprint
separator and a NUL in a password fixture) were replaced with named constants.
Both were behaving correctly and neither was visible to a reader.

## 15. New findings

**NF-04** — an `OrderItem` could reference a `TicketType` belonging to a
_different_ event from its order's. Under any Connect model the organiser is
derived from the order, so a line from another organiser's event would attribute
money to the wrong account. Closed with a database trigger
(`desi_order_item_event_matches`) in the same migration as ADR 0003.

**NF-05** — the contract's capability guard asserted with no organisation scope
on any route whose organisation is not spelled `organizationId`. It would have
refused every organiser and passed every super-admin. Found by a test that ran
the ordinary case. Closed with a declared, contract-validated `capabilityScope`.

**NF-06** — `contract:check` could not see a stale OpenAPI artefact. It validated
the route table against the OpenAPI document _it generated from that same route
table_, so the two always agreed and the committed `apps/api/openapi.json` could
drift silently. Worse, `pnpm build` ran the emitter, so a stale artefact was
rewritten rather than reported and the only symptom was a dirty working tree. It
had drifted: the two webhook routes landed in `f1803b4` and the artefact still
described 43 operations. Regenerated in `6714f1a`.

**Closed.** `apps/api/src/lib/openapi-artifact.js` compares the committed file
against a freshly generated document two ways — byte-identical, and semantically
after sorting object keys — and reports which failed, because "the API changed"
and "somebody reformatted the file" need different responses. `pnpm build` now
runs `--check` and never writes; `pnpm openapi:emit` is the only thing that
writes; `pnpm contract:check` runs both the structural validation and the drift
check. Proven by restoring the defect: a one-word change to a route summary makes
`openapi:check` exit 1 and `apps/api/tests/openapi-artifact.test.js` fail, while
the old `contract validate` alone still exits **0** — the blind spot, demonstrated
rather than asserted. The file was restored and both SHA-256 hashes verified
identical.

**NF-07** — nine of the ten plpgsql trigger functions had a probe that attempts
the violation; `desi_hold_item_session_matches` had none, so "a hold may only
reserve seats from its own session" was a claim in a migration rather than a
tested property. Two probes added in `289e4a0`, one per branch of the trigger.
Found by writing the traceability matrix, which is the argument for writing one.

**NF-08** — the capability-scope hole, found by auditing this document's own
claim that NF-05 was closed. It was half closed: a route could omit
`capabilityScope` entirely and fall back to a search for `organizationId` that
found nothing on the paths that matter, and a declared scope was checked only as
far as the request part, not the key. Closed in `3a2d4ff`; see
`PHASE2_COMPLETION_REPORT.md` §4.

**NF-09** — scheduled session rotation replaced a bearer client's secret and had
no channel to tell it, locking out API clients after an hour. Closed in
`b37b242`; see `PHASE2_COMPLETION_REPORT.md` §8.

**NF-10 to NF-13** — four smaller findings from the same audit, recorded open
rather than fixed because each needs a product decision or sits behind work that
does not exist. The most serious is NF-12: step-up authentication for a
privileged account with no enrolled factor is satisfied by the same password the
session was opened with. All four are listed in `PHASE2_COMPLETION_REPORT.md` §9.

## 16–19. Saga, refunds, ledger service, transfers

Not written. The schema, the database enforcement and the reconciliation-task
plumbing exist; nothing writes a ledger entry, performs a refund, or drives a
transfer. The reconciliation queue is opened by the webhook path and has no
operator interface.

## 20. Testing and proof

3,449 tests, all passing. What is **not** done:

- The "restore the vulnerable code, prove the test fails, restore byte-exact"
  procedure was performed **once** — for the `updatedAt` migration defect, where
  reintroducing it made `db:verify:upgrade` fail and the fresh verifier pass, and
  the file was restored byte-exact (hash and `git status` both verified). It was
  not performed for the other critical regressions.
- The 20 required end-to-end journeys do not exist.
- No load or reliability testing was done, and no capacity claim is made
  anywhere.
- Accessibility testing was not done, because no Phase 2 screens were built.

## 21. What is not true

Stated plainly, because the temptation in a report this long is to let length
imply completeness:

- Phase 2 is **not** complete.
- The Stripe integration has **never** contacted Stripe.
- There is no checkout that takes a Stripe payment end to end. The adapter, the
  webhook path and the seating inventory exist; the saga that joins them does
  not.
- Nothing has been reconciled, refunded, transferred or paid out.
- No ticket has been issued or scanned under Phase 2 code.
- The word "production-ready" does not apply and is not used.

## Reports

- This document.
- `PHASE2_REQUIREMENTS_TRACEABILITY.md` — every work item and acceptance
  criterion, mapped to files, tests and status, including the ones with status
  `NOT STARTED`.
